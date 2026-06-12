use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use crate::ws::messages::ServerMessage;

// ── Groq API request shapes ───────────────────────────────────────────────────

#[derive(Serialize)]
struct GroqRequest {
    model:       String,
    messages:    Vec<GroqMessage>,
    max_tokens:  u32,
    stream:      bool,
    temperature: f32,
}

#[derive(Serialize)]
struct GroqMessage {
    role:    String,
    content: String,
}

// ── Groq SSE response shapes ──────────────────────────────────────────────────

#[derive(Deserialize, Debug)]
struct GroqChunk {
    choices: Vec<GroqChoice>,
}

#[derive(Deserialize, Debug)]
struct GroqChoice {
    delta: GroqDelta,
}

#[derive(Deserialize, Debug)]
struct GroqDelta {
    content: Option<String>,
}

// ── main streaming function ───────────────────────────────────────────────────

/// Call Groq API with streaming and broadcast each token
/// to all clients in the session via the broadcast channel.
pub async fn stream_ai_response(
    api_key:      &str,
    prompt:       &str,
    selected_code: &str,
    language:     &str,
    message_id:   &str,
    broadcast_tx: &broadcast::Sender<ServerMessage>,
) {
    let client = Client::new();

    // ── build the prompt ──────────────────────────────────
    let system_prompt = format!(
        "You are an expert {} developer and code assistant embedded in a \
         collaborative code editor called CodeSync. You help developers \
         understand, debug, and improve their code. Be concise and precise. \
         Format code blocks with proper markdown.",
        language
    );

    let user_prompt = if selected_code.trim().is_empty() {
        prompt.to_string()
    } else {
        format!(
            "{}\n\n```{}\n{}\n```",
            prompt, language, selected_code
        )
    };

    let request_body = GroqRequest {
        model:       "llama-3.3-70b-versatile".to_string(),
        messages:    vec![
            GroqMessage { role: "system".to_string(), content: system_prompt },
            GroqMessage { role: "user".to_string(),   content: user_prompt   },
        ],
        max_tokens:  1024,
        stream:      true,
        temperature: 0.7,
    };

    // ── make the streaming request ────────────────────────
    let response = match client
        .post("https://api.groq.com/openai/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
    {
        Ok(r)  => r,
        Err(e) => {
            tracing::error!("Groq API request failed: {e}");
            let _ = broadcast_tx.send(ServerMessage::Error {
                message: "AI request failed".into(),
            });
            let _ = broadcast_tx.send(ServerMessage::AiDone {
                message_id: message_id.to_string(),
            });
            return;
        }
    };

    if !response.status().is_success() {
        let status = response.status();
        let body   = response.text().await.unwrap_or_default();
        tracing::error!("Groq API error {}: {}", status, body);
        let _ = broadcast_tx.send(ServerMessage::Error {
            message: format!("AI error: {}", status),
        });
        let _ = broadcast_tx.send(ServerMessage::AiDone {
            message_id: message_id.to_string(),
        });
        return;
    }

    // ── stream SSE chunks ─────────────────────────────────
    use futures::StreamExt;
    let mut stream = response.bytes_stream();
    let msg_id     = message_id.to_string();
    let mut pending = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(c)  => c,
            Err(e) => {
                tracing::error!("Stream read error: {e}");
                break;
            }
        };

        pending.push_str(&String::from_utf8_lossy(&chunk).replace("\r\n", "\n"));

        while let Some(event_end) = pending.find("\n\n") {
            let event = pending[..event_end].to_string();
            pending.drain(..event_end + 2);

            for line in event.lines() {
                if !line.starts_with("data: ") { continue; }
                let data = &line["data: ".len()..];

                if data == "[DONE]" {
                    let _ = broadcast_tx.send(ServerMessage::AiDone {
                        message_id: msg_id.clone(),
                    });
                    tracing::info!("AI stream complete for message {}", msg_id);
                    return;
                }

                match serde_json::from_str::<GroqChunk>(data) {
                    Ok(chunk) => {
                        if let Some(token) = chunk.choices
                            .into_iter()
                            .next()
                            .and_then(|c| c.delta.content)
                        {
                            if !token.is_empty() {
                                let _ = broadcast_tx.send(ServerMessage::AiToken {
                                    message_id: msg_id.clone(),
                                    token,
                                });
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!("Failed to parse SSE event: {e} — data: {data}");
                    }
                }
            }
        }
    }

    // send done in case [DONE] was missed
    let _ = broadcast_tx.send(ServerMessage::AiDone {
        message_id: message_id.to_string(),
    });
}
