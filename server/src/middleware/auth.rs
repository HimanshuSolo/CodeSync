use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use jsonwebtoken::{decode, DecodingKey, Validation, Algorithm};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use crate::state::AppState;
use crate::errors::AppError;

/// Claims stored inside the JWT token.
/// These are encoded into the token on login
/// and decoded on every protected request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub:      String,   // user id
    pub username: String,
    pub email:    String,
    pub exp:      usize,    // expiry timestamp (Unix)
    pub iat:      usize,    // issued at timestamp
}

/// A validated, typed user extracted from the JWT.
/// Injected into request extensions by the middleware.
/// Handlers pull it out with: Extension(current_user): Extension<CurrentUser>
#[derive(Debug, Clone)]
pub struct CurrentUser {
    pub id:       Uuid,
    pub username: String,
    pub email:    String,
}

/// Generate a signed JWT token for a user.
/// Called after successful login or registration.
pub fn create_token(
    user_id:  Uuid,
    username: &str,
    email:    &str,
    secret:   &str,
) -> Result<String, AppError> {
    use jsonwebtoken::{encode, EncodingKey, Header};
    use std::time::{SystemTime, UNIX_EPOCH};

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as usize;

    let claims = Claims {
        sub:      user_id.to_string(),
        username: username.to_string(),
        email:    email.to_string(),
        iat:      now,
        exp:      now + 60 * 60 * 24 * 7, // 7 days
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(e.into()))
}

/// Axum middleware — runs before every protected handler.
/// Extracts JWT from Authorization header, verifies it,
/// and injects CurrentUser into request extensions.
pub async fn require_auth(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, AppError> {
    // extract the Authorization header
    let auth_header = req
        .headers()
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::Unauthorized("Missing Authorization header".into()))?;

    // must be "Bearer <token>"
    let token = auth_header
        .strip_prefix("Bearer ")
        .ok_or_else(|| AppError::Unauthorized("Invalid Authorization format".into()))?;

    // verify and decode the token
    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(state.config.jwt_secret.as_bytes()),
        &Validation::new(Algorithm::HS256),
    )
    .map_err(|e| {
        tracing::warn!("JWT validation failed: {e}");
        AppError::Unauthorized("Invalid or expired token".into())
    })?;

    // parse user_id from claims
    let user_id = Uuid::parse_str(&token_data.claims.sub)
        .map_err(|_| AppError::Unauthorized("Invalid user id in token".into()))?;

    // inject into request extensions — handlers can extract this
    req.extensions_mut().insert(CurrentUser {
        id:       user_id,
        username: token_data.claims.username,
        email:    token_data.claims.email,
    });

    // pass to next handler
    Ok(next.run(req).await)
}// Phase 8 — JWT middleware
