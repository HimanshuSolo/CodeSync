use axum::{
    extract::{Extension, Path, State},
    Json,
};
use serde::Serialize;
use uuid::Uuid;
use std::path::Path as FilePath;
use tokio::fs;
use crate::{
    db,
    errors::{AppError, AppResult},
    middleware::auth::CurrentUser,
    models::session::{CreateSession, Session, SessionSummary},
    state::AppState,
    ws::session::ActorMessage,
};
// ── response shapes ───────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct SessionListResponse {
    pub sessions: Vec<SessionSummary>,
}

#[derive(Serialize)]
pub struct SessionResponse {
    pub session: Session,
}

#[derive(Serialize)]
pub struct DeleteResponse {
    pub message: String,
}
// ── GET /sessions ─────────────────────────────────────────────────────────────

pub async fn list_sessions(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
) -> AppResult<Json<SessionListResponse>> {
    let sessions = db::sessions::list_for_user(&state.db, current_user.id).await?;
    Ok(Json(SessionListResponse { sessions }))
}

// ── POST /sessions ────────────────────────────────────────────────────────────

pub async fn create_session(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Json(payload): Json<CreateSession>,
) -> AppResult<Json<SessionResponse>> {
    if payload.name.trim().is_empty() {
        return Err(AppError::BadRequest("Session name is required".into()));
    }

    if payload.name.trim().len() < 3 {
        return Err(AppError::BadRequest(
            "Session name must be at least 3 characters".into(),
        ));
    }

    let valid_languages = [
        "typescript",
        "javascript",
        "rust",
        "python",
        "go",
        "cpp",
        "java",
        "markdown",
    ];

    if !valid_languages.contains(&payload.language.as_str()) {
        return Err(AppError::BadRequest("Invalid language".into()));
    }

    let session = db::sessions::create(
        &state.db,
        payload.name.trim(),
        &payload.language,
        current_user.id,
    )
    .await?;

    Ok(Json(SessionResponse { session }))
}

// ── GET /sessions/:id ────────────────────────────────────────────────────────

pub async fn get_session(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<SessionResponse>> {
    let session = db::sessions::find_by_id(&state.db, id)
        .await?
        .ok_or_else(|| AppError::NotFound("Session not found".into()))?;

    let is_allowed = session.owner_id == current_user.id
        || db::sessions::is_member(&state.db, session.id, current_user.id).await?;

    if !is_allowed {
        return Err(AppError::Unauthorized(
            "You do not have access to this session".into(),
        ));
    }

    Ok(Json(SessionResponse { session }))
}

// ── DELETE /sessions/:id ─────────────────────────────────────────────────────

pub async fn delete_session(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<DeleteResponse>> {
    let deleted = db::sessions::delete(&state.db, id, current_user.id).await?;

    if !deleted {
        return Err(AppError::NotFound("Session not found".into()));
    }

    if let Some((_, handle)) = state.sessions.remove(&id.to_string()) {
        let _ = handle.tx.send(ActorMessage::Shutdown).await;
    }

    let workspace = FilePath::new(&state.config.workspace_root).join(id.to_string());
    if workspace.exists() {
        if let Err(err) = fs::remove_dir_all(&workspace).await {
            tracing::error!(
                "Failed to delete workspace for session {} at {}: {}",
                id,
                workspace.display(),
                err,
            );
        }
    }

    Ok(Json(DeleteResponse {
        message: "Session and workspace deleted successfully".into(),
    }))
}
