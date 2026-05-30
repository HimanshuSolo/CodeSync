use axum::{
    extract::{Extension, State},
    Json,
};
use serde::Serialize;
use crate::{
    db,
    errors::{AppError, AppResult},
    middleware::auth::{create_token, CurrentUser},
    models::user::{CreateUser, LoginUser, UserPublic},
    state::AppState,
};

// ── response shapes ───────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct AuthResponse {
    pub token:    String,
    pub user:     UserPublic,
}

// ── POST /auth/register ───────────────────────────────────────────────────────

pub async fn register(
    State(state): State<AppState>,
    Json(payload): Json<CreateUser>,
) -> AppResult<Json<AuthResponse>> {

    // ── validate input ───────────────────────────────────
    if payload.email.trim().is_empty() {
        return Err(AppError::BadRequest("Email is required".into()));
    }
    if payload.username.trim().is_empty() {
        return Err(AppError::BadRequest("Username is required".into()));
    }
    if payload.password.len() < 8 {
        return Err(AppError::BadRequest("Password must be at least 8 characters".into()));
    }

    // ── check email not taken ────────────────────────────
    if db::users::email_exists(&state.db, &payload.email).await? {
        return Err(AppError::BadRequest("Email already registered".into()));
    }

    // ── check username not taken ─────────────────────────
    if db::users::username_exists(&state.db, &payload.username).await? {
        return Err(AppError::BadRequest("Username already taken".into()));
    }

    // ── hash password with argon2 ────────────────────────
    // argon2 is intentionally slow — makes brute force attacks infeasible
    let password_hash = hash_password(&payload.password)?;

    // ── pick a deterministic avatar color from username ──
    let avatar_color = pick_avatar_color(&payload.username);

    // ── insert user into database ────────────────────────
    let user = db::users::create(
        &state.db,
        &payload.email,
        &payload.username,
        &password_hash,
        &avatar_color,
    ).await?;

    // ── sign JWT ─────────────────────────────────────────
    let token = create_token(
        user.id,
        &user.username,
        &user.email,
        &state.config.jwt_secret,
    )?;

    tracing::info!("New user registered: {} ({})", user.username, user.email);

    Ok(Json(AuthResponse {
        token,
        user: user.into(),
    }))
}

// ── POST /auth/login ──────────────────────────────────────────────────────────

pub async fn login(
    State(state): State<AppState>,
    Json(payload): Json<LoginUser>,
) -> AppResult<Json<AuthResponse>> {

    // ── find user by email ───────────────────────────────
    let user = db::users::find_by_email(&state.db, &payload.email)
        .await?
        .ok_or_else(|| AppError::Unauthorized("Invalid email or password".into()))?;

    // ── verify password ──────────────────────────────────
    // use constant-time comparison to prevent timing attacks
    let valid = verify_password(&payload.password, &user.password_hash)?;
    if !valid {
        return Err(AppError::Unauthorized("Invalid email or password".into()));
    }

    // ── sign JWT ─────────────────────────────────────────
    let token = create_token(
        user.id,
        &user.username,
        &user.email,
        &state.config.jwt_secret,
    )?;

    tracing::info!("User logged in: {}", user.username);

    Ok(Json(AuthResponse {
        token,
        user: user.into(),
    }))
}

// ── GET /auth/me ──────────────────────────────────────────────────────────────
// Protected — requires valid JWT

pub async fn me(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
) -> AppResult<Json<UserPublic>> {

    // fetch fresh user data from DB
    let user = db::users::find_by_id(&state.db, current_user.id)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".into()))?;

    Ok(Json(user.into()))
}

// ── helpers ───────────────────────────────────────────────────────────────────

fn hash_password(password: &str) -> Result<String, AppError> {
    use argon2::{
        password_hash::{rand_core::OsRng, PasswordHasher, SaltString},
        Argon2,
    };

    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Password hashing failed: {e}")))?
        .to_string();

    Ok(hash)
}

fn verify_password(password: &str, hash: &str) -> Result<bool, AppError> {
    use argon2::{
        password_hash::{PasswordHash, PasswordVerifier},
        Argon2,
    };

    let parsed_hash = PasswordHash::new(hash)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Invalid password hash: {e}")))?;

    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok())
}

/// Pick one of 8 colors deterministically based on username.
/// Same username always gets the same color — no randomness.
fn pick_avatar_color(username: &str) -> String {
    let colors = [
        "#7c3aed", // violet
        "#0891b2", // cyan
        "#059669", // emerald
        "#d97706", // amber
        "#dc2626", // red
        "#7c3aed", // purple
        "#db2777", // pink
        "#2563eb", // blue
    ];
    let index = username
        .bytes()
        .fold(0usize, |acc, b| acc + b as usize)
        % colors.len();

    colors[index].to_string()
}// Phase 8 — JWT auth endpoints
