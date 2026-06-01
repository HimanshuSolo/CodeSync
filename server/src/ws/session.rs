use axum::extract::ws::{Message, WebSocket};
use futures::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc};
use uuid::Uuid;
use crate::{
    db,
    middleware::auth::CurrentUser,
    state::{AppState, SessionHandle},
    ws::messages::{ClientMessage, EditOp, Participant, ServerMessage},
};

/// The session actor manages one collaborative session.
/// It owns the document state and serialises all edits.
pub struct SessionActor;

impl SessionActor {
    /// Get existing session actor or create a new one.
    /// Returns a handle that any connection task can use.
    pub async fn get_or_create(
        state:      &AppState,
        session_id: Uuid,
        document:   String,
        revision:   i64,
    ) -> Arc<ActorHandle> {
        // check if actor already running for this session
        if let Some(handle) = state.sessions.get(&session_id.to_string()) {
            return Arc::new(handle.clone().into());
        }

        // create channels
        // mpsc: many connection tasks → one actor (edit ops)
        let (tx, rx)               = mpsc::channel::<ActorMessage>(256);
        // broadcast: one actor → many connection tasks (resolved ops)
        let (broadcast_tx, _)      = broadcast::channel::<ServerMessage>(256);

        let handle = ActorHandle {
            session_id,
            tx:           tx.clone(),
            broadcast_tx: broadcast_tx.clone(),
        };

        // register in session registry
        state.sessions.insert(
            session_id.to_string(),
            SessionHandle {
                session_id: session_id.to_string(),
                tx:           tx.clone(),
                broadcast_tx: broadcast_tx.clone(),
            },
        );

        // spawn the actor task
        let db   = state.db.clone();
        let sid  = session_id;
        let groq_api_key = state.config.groq_api_key.clone();
        tokio::spawn(async move {
            run_actor(sid, document, revision, rx, broadcast_tx, db, groq_api_key).await;
        });

        tracing::info!("Session actor started for {}", session_id);
        Arc::new(handle)
    }

    /// Handle a single WebSocket connection.
    pub async fn handle_connection(
        handle:       Arc<ActorHandle>,
        socket:       WebSocket,
        current_user: CurrentUser,
    ) {
        let (mut sink, mut stream) = socket.split();
        let mut broadcast_rx       = handle.broadcast_tx.subscribe();

        // notify actor that user joined
        let _ = handle.tx.send(ActorMessage::UserJoined {
            user_id:      current_user.id,
            username:     current_user.username.clone(),
            avatar_color: "#7c3aed".to_string(),
        }).await;

        // ── connection loop ───────────────────────────────
        loop {
            tokio::select! {
                // inbound: message from this client
                msg = stream.next() => {
                    match msg {
                        Some(Ok(Message::Text(text))) => {
                            match serde_json::from_str::<ClientMessage>(&text) {
                                Ok(client_msg) => {
                                    let _ = handle.tx.send(ActorMessage::ClientMsg {
                                        user_id: current_user.id,
                                        msg:     client_msg,
                                    }).await;
                                }
                                Err(e) => {
                                    tracing::warn!("Failed to parse WS message: {e}");
                                }
                            }
                        }
                        // client disconnected
                        Some(Ok(Message::Close(_))) | None => break,
                        _ => {}
                    }
                }

                // outbound: broadcast from actor to this client
                result = broadcast_rx.recv() => {
                    match result {
                        Ok(server_msg) => {
                            if let Ok(text) = serde_json::to_string(&server_msg) {
                                if sink.send(Message::Text(text)).await.is_err() {
                                    break; // client disconnected
                                }
                            }
                        }
                        Err(broadcast::error::RecvError::Lagged(n)) => {
                            tracing::warn!("Client lagged behind by {n} messages");
                        }
                        Err(_) => break,
                    }
                }
            }
        }

        // notify actor that user left
        let _ = handle.tx.send(ActorMessage::UserLeft {
            user_id: current_user.id,
        }).await;

        tracing::info!("Connection closed for user {}", current_user.username);
    }
}

// ── actor handle ─────────────────────────────────────────────────────────────

/// Cheap-to-clone handle — wraps the channel senders.
#[derive(Clone)]
pub struct ActorHandle {
    pub session_id:   Uuid,
    pub tx:           mpsc::Sender<ActorMessage>,
    pub broadcast_tx: broadcast::Sender<ServerMessage>,
}

impl ActorHandle {
    pub async fn handle_connection(self: Arc<Self>, socket: WebSocket, user: CurrentUser) {
        SessionActor::handle_connection(self, socket, user).await;
    }
}

impl From<SessionHandle> for ActorHandle {
    fn from(h: SessionHandle) -> Self {
        Self {
            session_id:   Uuid::parse_str(&h.session_id).unwrap(),
            tx:           h.tx,
            broadcast_tx: h.broadcast_tx,
        }
    }
}

// ── messages into the actor ───────────────────────────────────────────────────

pub enum ActorMessage {
    ClientMsg { user_id: Uuid, msg: ClientMessage },
    UserJoined { user_id: Uuid, username: String, avatar_color: String },
    UserLeft  { user_id: Uuid },
}

// ── actor loop ────────────────────────────────────────────────────────────────

/// The core actor task — runs for the lifetime of a session.
/// Serialises all edits, maintains document state, broadcasts resolved ops.
async fn run_actor(
    session_id:   Uuid,
    document:     String,
    revision:     i64,
    mut rx:       mpsc::Receiver<ActorMessage>,
    broadcast_tx: broadcast::Sender<ServerMessage>,
    db:           sqlx::PgPool,
    groq_api_key: String,
) {
    let mut doc      = document;
    let mut rev      = revision;
    let mut participants: Vec<Participant> = Vec::new();
    let mut history: Vec<EditOp> = Vec::new();

    while let Some(msg) = rx.recv().await {
        match msg {

            // ── user connected ────────────────────────────
            ActorMessage::UserJoined { user_id, username, avatar_color } => {
                // send current document state to the new user
                let state_msg = ServerMessage::SessionState {
                    document:     doc.clone(),
                    participants: participants.clone(),
                    revision:     rev as u64,
                };
                let _ = broadcast_tx.send(state_msg);

                // add to participants list
                let participant = Participant {
                    user_id:      user_id.to_string(),
                    username:     username.clone(),
                    avatar_color: avatar_color.clone(),
                    cursor_line:  0,
                    cursor_col:   0,
                    is_online:    true,
                };
                participants.push(participant.clone());

                // broadcast join event to everyone else
                let _ = broadcast_tx.send(ServerMessage::UserJoined(participant));

                tracing::info!("User {} joined session {}", username, session_id);
            }

            // ── user disconnected ─────────────────────────
            ActorMessage::UserLeft { user_id } => {
                participants.retain(|p| p.user_id != user_id.to_string());
                let _ = broadcast_tx.send(ServerMessage::UserLeft {
                    user_id: user_id.to_string(),
                });
            }

            // ── incoming client message ───────────────────
            ActorMessage::ClientMsg { user_id, msg } => {
                match msg {

                    ClientMessage::Edit(op) => {
    // ── OT: transform against ops since client's revision ──
    // op.revision = what the client based this edit on
    // rev         = current server revision
    // if they differ, client missed some ops — transform
    let client_rev = op.revision as i64;
    let ops_since: Vec<EditOp> = history
        .iter()
        .skip(client_rev as usize)
        .cloned()
        .collect();

    let mut transformed = op.clone();
    for past_op in &ops_since {
        transformed = ot::transform(transformed, past_op);
    }

    // ── apply transformed op to document ──────────────────
    ot::apply(&mut doc, &transformed);

    // ── increment revision ─────────────────────────────────
    rev += 1;
    transformed.revision = rev as u64;

    // ── store in history for future transforms ─────────────
    history.push(transformed.clone());

    // ── keep history bounded — last 1000 ops ──────────────
    if history.len() > 1000 {
        history.drain(0..100);
    }

    // ── persist every 10 revisions ─────────────────────────
    if rev % 10 == 0 {
        let db2 = db.clone();
        let d   = doc.clone();
        let r   = rev;
        let sid = session_id;
        tokio::spawn(async move {
            if let Err(e) = db::sessions::update_document(
                &db2, sid, &d, r
            ).await {
                tracing::error!("Failed to persist document: {e}");
            }
        });
    }

    // ── broadcast resolved op to all clients ───────────────
    let _ = broadcast_tx.send(ServerMessage::Edit(transformed));
}

                    ClientMessage::Cursor(pos) => {
                        // update participant cursor in memory
                        if let Some(p) = participants.iter_mut()
                            .find(|p| p.user_id == user_id.to_string())
                        {
                            p.cursor_line = pos.line;
                            p.cursor_col  = pos.col;
                        }
                        // broadcast cursor to everyone
                        let _ = broadcast_tx.send(ServerMessage::Cursor(pos));
                    }

                    ClientMessage::AiRequest(req) => {
    tracing::info!(
        "AI request in session {}: {}",
        session_id, req.prompt
    );

    let api_key      = groq_api_key.clone();
    let broadcast_tx2 = broadcast_tx.clone();
    let message_id   = uuid::Uuid::new_v4().to_string();
    let prompt       = req.prompt.clone();
    let code         = req.selected_code.clone();
    let lang         = req.language.clone();

    // spawn AI task so it doesn't block the actor loop
    tokio::spawn(async move {
        crate::ai::groq::stream_ai_response(
            &api_key,
            &prompt,
            &code,
            &lang,
            &message_id,
            &broadcast_tx2,
        ).await;
    });
}

                    ClientMessage::Ping => {
                        let _ = broadcast_tx.send(ServerMessage::Pong);
                    }
                }
            }
        }
    }

    tracing::info!("Session actor stopped for {}", session_id);
}

// ── Operational Transform ─────────────────────────────────────────────────────

pub mod ot {
    use crate::ws::messages::{EditOp, OpType};

    /// Transform op_a against op_b — returns adjusted op_a.
    /// Called when op_a was based on a revision that op_b
    /// has already been applied to.
    pub fn transform(mut op_a: EditOp, op_b: &EditOp) -> EditOp {
        match (&op_a.op_type, &op_b.op_type) {

            // ── insert vs insert ──────────────────────────
            (OpType::Insert, OpType::Insert) => {
                if op_b.position < op_a.position
                || (op_b.position == op_a.position
                    && op_b.user_id < op_a.user_id) // tiebreak by user_id
                {
                    op_a.position += op_b.text.len();
                }
                op_a
            }

            // ── insert vs delete ──────────────────────────
            (OpType::Insert, OpType::Delete) => {
                if op_b.position < op_a.position {
                    let shift = op_b.text.len().min(
                        op_a.position - op_b.position
                    );
                    op_a.position -= shift;
                }
                op_a
            }

            // ── delete vs insert ──────────────────────────
            (OpType::Delete, OpType::Insert) => {
                if op_b.position <= op_a.position {
                    op_a.position += op_b.text.len();
                }
                op_a
            }

            // ── delete vs delete ──────────────────────────
            (OpType::Delete, OpType::Delete) => {
                if op_b.position < op_a.position {
                    let shift = op_b.text.len().min(
                        op_a.position - op_b.position
                    );
                    op_a.position -= shift;
                } else if op_b.position == op_a.position {
                    // both deleting same position — op_a becomes no-op
                    op_a.text = String::new();
                }
                op_a
            }
        }
    }

    /// Apply an edit op to a document string.
    /// Returns the new document.
    pub fn apply(doc: &mut String, op: &EditOp) {
        match op.op_type {
            OpType::Insert => {
                let pos = op.position.min(doc.len());
                doc.insert_str(pos, &op.text);
            }
            OpType::Delete => {
                let start = op.position.min(doc.len());
                let end   = (op.position + op.text.len()).min(doc.len());
                if start < end {
                    doc.drain(start..end);
                }
            }
        }
    }
}