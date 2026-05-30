use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id:            Uuid,
    pub email:         String,
    pub username:      String,
    pub password_hash: String,
    pub avatar_color:  String,
    pub created_at:    DateTime<Utc>,
    pub updated_at:    DateTime<Utc>,
}

/// Never send password_hash to the client
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPublic {
    pub id:           Uuid,
    pub email:        String,
    pub username:     String,
    pub avatar_color: String,
    pub created_at:   DateTime<Utc>,
}

impl From<User> for UserPublic {
    fn from(u: User) -> Self {
        Self {
            id:           u.id,
            email:        u.email,
            username:     u.username,
            avatar_color: u.avatar_color,
            created_at:   u.created_at,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateUser {
    pub email:    String,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginUser {
    pub email:    String,
    pub password: String,
}// Phase 7 — User model
