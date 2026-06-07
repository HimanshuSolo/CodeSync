use axum::{
    extract::{Path, Query, State, WebSocketUpgrade},
    response::Response,
};
use serde::Deserialize;
use uuid::Uuid;
use crate::{
    db,
    errors::AppError,
    middleware::auth::{Claims, CurrentUser},
    state::AppState,
    ws::session::SessionActor,
};
use jsonwebtoken::{decode, DecodingKey, Validation, Algorithm};

#[derive(Deserialize)]
pub struct WsQuery {
    pub token: String,
}

/// GET /session/:id/ws?token=<jwt>
/// Upgrades the HTTP connection to WebSocket.
/// Auth is done via query param because browsers
/// can't set headers on WebSocket connections.
pub async fn ws_handler(
    State(state):    State<AppState>,
    Path(session_id): Path<Uuid>,
    Query(query):    Query<WsQuery>,
    ws:              WebSocketUpgrade,
) -> Result<Response, AppError> {

    // ── verify JWT from query param ───────────────────────
    let token_data = decode::<Claims>(
        &query.token,
        &DecodingKey::from_secret(state.config.jwt_secret.as_bytes()),
        &Validation::new(Algorithm::HS256),
    )
    .map_err(|_| AppError::Unauthorized("Invalid or expired token".into()))?;

    let user_id = Uuid::parse_str(&token_data.claims.sub)
        .map_err(|_| AppError::Unauthorized("Invalid user id".into()))?;

    // ── verify session exists ─────────────────────────────
    let session = db::sessions::find_by_id(&state.db, session_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Session not found".into()))?;

    // ── verify user is a member ───────────────────────────
    let is_member = db::sessions::is_member(&state.db, session_id, user_id).await?;
    if !is_member && session.owner_id != user_id {
        // auto-add as member if they have the link
        db::sessions::add_member(&state.db, session_id, user_id).await?;
    }

    let user = db::users::find_by_id(&state.db, user_id)
        .await?
        .ok_or_else(|| AppError::Unauthorized("User not found".into()))?;

    let current_user = CurrentUser {
        id:           user_id,
        username:     user.username,
        avatar_color: user.avatar_color,
    };

    tracing::info!(
        "WS upgrade: user {} joining session {}",
        current_user.username, session_id
    );

    // ── upgrade to WebSocket ──────────────────────────────
    // get or create the session actor for this session_id
    let actor_handle = SessionActor::get_or_create(
        &state,
        session_id,
        session.document,
        session.revision,
    ).await;

    Ok(ws.on_upgrade(move |socket| async move {
        actor_handle.handle_connection(socket, current_user).await;
    }))
}
