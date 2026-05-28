use std::sync::Arc;
use dashmap::DashMap;
use sqlx::PgPool;
use tokio::sync::broadcast;
use crate::config::Config;

/// Shared application state — cloned into every request handler.
/// Arc means multiple tasks share ownership safely.
/// Clone is cheap — just increments a reference counter.
#[derive(Clone)]
pub struct AppState {
    pub db:     PgPool,
    pub config: Config,
    pub sessions: Arc<SessionRegistry>,
}

/// Maps session_id → active session actor handle
pub type SessionRegistry = DashMap<String, SessionHandle>;

/// Handle to a running session actor task.
/// Other tasks use this to send messages into the session.
#[derive(Clone)]
pub struct SessionHandle {
    pub session_id: String,
    /// send an edit op into the session actor
    pub tx: tokio::sync::mpsc::Sender<crate::ws::messages::ServerMessage>,
    /// subscribe to resolved ops broadcast
    pub broadcast_tx: broadcast::Sender<crate::ws::messages::ServerMessage>,
}

impl AppState {
    pub fn new(db: PgPool, config: Config) -> Self {
        Self {
            db,
            config,
            sessions: Arc::new(DashMap::new()),
        }
    }
}