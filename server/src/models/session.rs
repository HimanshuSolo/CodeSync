use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id:         Uuid,
    pub name:       String,
    pub language:   String,
    pub document:   String,
    pub revision:   i64,
    pub owner_id:   Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateSession {
    pub name:     String,
    pub language: String,
}

/// List view — no document content (too large to send in lists)
#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id:         Uuid,
    pub name:       String,
    pub language:   String,
    pub revision:   i64,
    pub owner_id:   Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}// Phase 7 — Session model
