use std::sync::Arc;
use dashmap::DashMap;
use sqlx::PgPool;
use tokio::sync::{broadcast, mpsc};
use crate::config::Config;
use crate::ws::messages::ServerMessage;
use crate::ws::session::ActorMessage;

#[derive(Clone)]
pub struct AppState {
    pub db:       PgPool,
    pub config:   Config,
    pub sessions: Arc<SessionRegistry>,
}

pub type SessionRegistry = DashMap<String, SessionHandle>;

#[derive(Clone)]
pub struct SessionHandle {
    pub session_id:   String,
    pub tx:           mpsc::Sender<ActorMessage>,
    pub broadcast_tx: broadcast::Sender<ServerMessage>,
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