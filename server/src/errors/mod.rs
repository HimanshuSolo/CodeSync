use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use thiserror::Error;

/// Every error in the app funnels through AppError.
/// thiserror generates Display + Error trait impls automatically.
#[derive(Debug, Error)]
pub enum AppError {
    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Unauthorized: {0}")]
    Unauthorized(String),

    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Internal server error")]
    Internal(#[from] anyhow::Error),

    #[error("Database error")]
    Database(#[from] sqlx::Error),
}

/// Convert AppError into an HTTP response automatically.
/// Axum calls this whenever a handler returns Err(AppError).
impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            AppError::NotFound(msg)      => (StatusCode::NOT_FOUND,            msg.clone()),
            AppError::Unauthorized(msg)  => (StatusCode::UNAUTHORIZED,         msg.clone()),
            AppError::BadRequest(msg)    => (StatusCode::BAD_REQUEST,          msg.clone()),
            AppError::Internal(_)        => (StatusCode::INTERNAL_SERVER_ERROR,"Internal server error".to_string()),
            AppError::Database(_)        => (StatusCode::INTERNAL_SERVER_ERROR,"Database error".to_string()),
        };

        // log internal errors — don't expose details to client
        if matches!(self, AppError::Internal(_) | AppError::Database(_)) {
            tracing::error!("Internal error: {:?}", self);
        }

        (status, Json(json!({ "message": message, "statusCode": status.as_u16() }))).into_response()
    }
}

/// Convenience type alias — use this as return type in handlers
pub type AppResult<T> = Result<T, AppError>;