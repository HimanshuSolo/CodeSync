use axum::extract::ws::{Message, WebSocket};
use futures::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc};
use uuid::Uuid;
use crate::{
    db,
    middleware::auth::CurrentUser,
    state::{AppState, SessionHandle},
    ws::messages::{ClientMessage, ServerMessage, Participant},
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
        tokio::spawn(async move {
            run_actor(sid, document, revision, rx, broadcast_tx, db).await;
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
) {
    let mut doc      = document;
    let mut rev      = revision;
    let mut participants: Vec<Participant> = Vec::new();

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

                    ClientMessage::Edit(mut op) => {
                        // apply the edit to the document
                        // (simplified — full OT in Phase 10)
                        if op.op_type == crate::ws::messages::OpType::Insert {
                            if op.position <= doc.len() {
                                doc.insert_str(op.position, &op.text);
                            }
                        } else {
                            let end = (op.position + op.text.len()).min(doc.len());
                            if op.position < doc.len() {
                                doc.drain(op.position..end);
                            }
                        }

                        // increment revision
                        rev += 1;
                        op.revision = rev as u64;

                        // persist to DB every 10 revisions
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

                        // broadcast resolved op to ALL clients
                        let _ = broadcast_tx.send(ServerMessage::Edit(op));
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
                        // Phase 11 — Groq AI streaming
                        tracing::info!(
                            "AI request from {}: {}",
                            user_id, req.prompt
                        );
                        let _ = broadcast_tx.send(ServerMessage::Error {
                            message: "AI not yet connected — coming in Phase 11".into(),
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