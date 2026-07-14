use axum::{
    extract::{Request, State},
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
    pub id:           Uuid,
    pub username:     String,
    pub avatar_color: String,
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

    let user = crate::db::users::find_by_id(&state.db, user_id)
        .await?
        .ok_or_else(|| AppError::Unauthorized("User not found".into()))?;

    // inject into request extensions — handlers can extract this
    req.extensions_mut().insert(CurrentUser {
        id:           user_id,
        username:     user.username,
        avatar_color: user.avatar_color,
    });

    // pass to next handler
    Ok(next.run(req).await)
}// Phase 8 — JWT middleware

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header};
    use std::time::{SystemTime, UNIX_EPOCH};

    const SECRET: &str = "test-secret-value-not-used-in-production";

    fn decode_with(token: &str, secret: &str) -> Result<jsonwebtoken::TokenData<Claims>, jsonwebtoken::errors::Error> {
        decode::<Claims>(
            token,
            &DecodingKey::from_secret(secret.as_bytes()),
            &Validation::new(Algorithm::HS256),
        )
    }

    #[test]
    fn create_token_round_trips_claims() {
        let user_id = Uuid::new_v4();
        let token = create_token(user_id, "alice", "alice@example.com", SECRET).unwrap();

        let decoded = decode_with(&token, SECRET).expect("valid token should decode");

        assert_eq!(decoded.claims.sub, user_id.to_string());
        assert_eq!(decoded.claims.username, "alice");
        assert_eq!(decoded.claims.email, "alice@example.com");
        assert!(decoded.claims.exp > decoded.claims.iat, "token should expire after it's issued");
    }

    #[test]
    fn expired_token_is_rejected() {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as usize;
        let claims = Claims {
            sub:      Uuid::new_v4().to_string(),
            username: "bob".into(),
            email:    "bob@example.com".into(),
            iat:      now - 1000,
            exp:      now - 500, // expired 500s ago
        };
        let token = encode(&Header::default(), &claims, &EncodingKey::from_secret(SECRET.as_bytes())).unwrap();

        assert!(decode_with(&token, SECRET).is_err());
    }

    #[test]
    fn token_signed_with_wrong_secret_is_rejected() {
        let user_id = Uuid::new_v4();
        let token = create_token(user_id, "carol", "carol@example.com", "the-real-secret").unwrap();

        assert!(decode_with(&token, "a-different-secret").is_err());
    }

    #[test]
    fn tampered_token_is_rejected() {
        let user_id = Uuid::new_v4();
        let mut token = create_token(user_id, "dave", "dave@example.com", SECRET).unwrap();
        // flip one character in the payload segment — must fail signature
        // verification (or fail to parse), never silently succeed.
        let mid = token.len() / 2;
        let flipped = if token.as_bytes()[mid] == b'a' { 'b' } else { 'a' };
        token.replace_range(mid..mid + 1, &flipped.to_string());

        assert!(decode_with(&token, SECRET).is_err());
    }

    #[test]
    fn malformed_sub_claim_fails_uuid_parse() {
        // Mirrors require_auth's second validation step: a well-signed
        // token with a non-UUID `sub` decodes fine but must still be
        // rejected downstream when parsed as a Uuid.
        let claims = Claims {
            sub:      "not-a-uuid".into(),
            username: "eve".into(),
            email:    "eve@example.com".into(),
            iat:      0,
            exp:      9_999_999_999,
        };
        let token = encode(&Header::default(), &claims, &EncodingKey::from_secret(SECRET.as_bytes())).unwrap();

        let decoded = decode_with(&token, SECRET).expect("well-signed token should still decode");
        assert!(Uuid::parse_str(&decoded.claims.sub).is_err());
    }
}
