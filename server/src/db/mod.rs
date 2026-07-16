use sqlx::{postgres::PgPoolOptions, PgPool};
use crate::errors::AppError;

/// Create a PostgreSQL connection pool.
/// Pool manages multiple connections — you never open/close manually.
pub async fn create_pool(database_url: &str) -> Result<PgPool, AppError> {
    PgPoolOptions::new()
        .max_connections(20)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .connect(database_url)
        .await
        .map_err(|e| {
            tracing::error!("Failed to connect to database: {e}");
            AppError::Internal(e.into())
        })
}

// ── User queries ─────────────────────────────────────────────────────────────
pub mod users {
    use sqlx::PgPool;
    use uuid::Uuid;
    use crate::models::user::User;
    use crate::errors::AppResult;

    pub async fn find_by_email(pool: &PgPool, email: &str) -> AppResult<Option<User>> {
        let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = $1")
        .bind(email)
        .fetch_optional(pool)
        .await?;
        Ok(user)
    }

    pub async fn find_by_id(pool: &PgPool, id: Uuid) -> AppResult<Option<User>> {
        let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await?;
        Ok(user)
    }

    pub async fn create(
        pool:          &PgPool,
        email:         &str,
        username:      &str,
        password_hash: &str,
        avatar_color:  &str,
    ) -> AppResult<User> {
        let user = sqlx::query_as::<_, User>(
            r#"
            INSERT INTO users (email, username, password_hash, avatar_color)
            VALUES ($1, $2, $3, $4)
            RETURNING *
            "#
        )
        .bind(email)
        .bind(username)
        .bind(password_hash)
        .bind(avatar_color)
        .fetch_one(pool)
        .await?;
        Ok(user)
    }

    pub async fn email_exists(pool: &PgPool, email: &str) -> AppResult<bool> {
        let exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)"
        )
        .bind(email)
        .fetch_one(pool)
        .await?;
        Ok(exists)
    }

    pub async fn username_exists(pool: &PgPool, username: &str) -> AppResult<bool> {
        let exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM users WHERE username = $1)"
        )
        .bind(username)
        .fetch_one(pool)
        .await?;
        Ok(exists)
    }
}

// Session queries
pub mod sessions {
    use sqlx::PgPool;
    use uuid::Uuid;
    use crate::models::session::{Session, SessionSummary};
    use crate::errors::AppResult;

    pub async fn list_for_user(pool: &PgPool, user_id: Uuid) -> AppResult<Vec<SessionSummary>> {
        let sessions = sqlx::query_as::<_, SessionSummary>(
            r#"
            SELECT DISTINCT
                s.id, s.name, s.language, s.revision,
                s.owner_id, s.created_at, s.updated_at
            FROM sessions s
            LEFT JOIN session_members sm ON sm.session_id = s.id
            WHERE s.owner_id = $1 OR sm.user_id = $1
            ORDER BY s.updated_at DESC
            "#
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?;
        Ok(sessions)
    }

    pub async fn find_by_id(pool: &PgPool, id: Uuid) -> AppResult<Option<Session>> {
        let session = sqlx::query_as::<_, Session>("SELECT * FROM sessions WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await?;
        Ok(session)
    }

    pub async fn create(
        pool:     &PgPool,
        name:     &str,
        language: &str,
        owner_id: Uuid,
    ) -> AppResult<Session> {
        let session = sqlx::query_as::<_, Session>(
            r#"
            INSERT INTO sessions (name, language, owner_id)
            VALUES ($1, $2, $3)
            RETURNING *
            "#
        )
        .bind(name)
        .bind(language)
        .bind(owner_id)
        .fetch_one(pool)
        .await?;

        // add owner as first member
        sqlx::query("INSERT INTO session_members (session_id, user_id) VALUES ($1, $2)")
        .bind(session.id)
        .bind(owner_id)
        .execute(pool)
        .await?;

        Ok(session)
    }

    pub async fn update_document(
        pool:       &PgPool,
        session_id: Uuid,
        document:   &str,
        revision:   i64,
    ) -> AppResult<()> {
        sqlx::query(
            r#"
            UPDATE sessions
            SET document = $1, revision = $2, updated_at = NOW()
            WHERE id = $3
            "#
        )
        .bind(document)
        .bind(revision)
        .bind(session_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn delete(pool: &PgPool, id: Uuid, owner_id: Uuid) -> AppResult<bool> {
        let result = sqlx::query("DELETE FROM sessions WHERE id = $1 AND owner_id = $2")
        .bind(id)
        .bind(owner_id)
        .execute(pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }


    /// Check if a user is a member of a session
    pub async fn is_member(
        pool:       &PgPool,
        session_id: Uuid,
        user_id:    Uuid,
    ) -> AppResult<bool> {
        let exists = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM session_members
                WHERE session_id = $1 AND user_id = $2
            )
            "#
        )
        .bind(session_id)
        .bind(user_id)
        .fetch_one(pool)
        .await?;

        Ok(exists)
    }

    pub async fn add_member(
        pool:       &PgPool,
        session_id: Uuid,
        user_id:    Uuid,
    ) -> AppResult<()> {
        sqlx::query(
            r#"
            INSERT INTO session_members (session_id, user_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
            "#
        )
        .bind(session_id)
        .bind(user_id)
        .execute(pool)
        .await?;
        Ok(())
    }
}

// Chat message queries
pub mod chat_messages {
    use sqlx::PgPool;
    use uuid::Uuid;
    use chrono::{DateTime, Utc};
    use crate::errors::AppResult;
    use crate::ws::messages::ChatMessage;

    #[derive(sqlx::FromRow)]
    struct ChatMessageRow {
        id:           Uuid,
        user_id:      Uuid,
        username:     String,
        avatar_color: String,
        text:         String,
        created_at:   DateTime<Utc>,
    }

    impl From<ChatMessageRow> for ChatMessage {
        fn from(row: ChatMessageRow) -> Self {
            ChatMessage {
                id:           row.id.to_string(),
                user_id:      row.user_id.to_string(),
                username:     row.username,
                avatar_color: row.avatar_color,
                text:         row.text,
                timestamp:    row.created_at.to_rfc3339(),
            }
        }
    }

    /// Persist a chat message already broadcast to live participants, so a
    /// device that connects later (or reconnects) can load prior
    /// conversation instead of seeing an empty chat panel.
    #[allow(clippy::too_many_arguments)]
    pub async fn insert(
        pool:         &PgPool,
        id:           Uuid,
        session_id:   Uuid,
        user_id:      Uuid,
        username:     &str,
        avatar_color: &str,
        text:         &str,
        created_at:   DateTime<Utc>,
    ) -> AppResult<()> {
        sqlx::query(
            r#"
            INSERT INTO chat_messages (id, session_id, user_id, username, avatar_color, text, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            "#
        )
        .bind(id)
        .bind(session_id)
        .bind(user_id)
        .bind(username)
        .bind(avatar_color)
        .bind(text)
        .bind(created_at)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Load the most recent messages for a session, oldest first, so a
    /// newly (re)connected client can catch up on the conversation.
    pub async fn list_recent(
        pool:       &PgPool,
        session_id: Uuid,
        limit:      i64,
    ) -> AppResult<Vec<ChatMessage>> {
        let mut rows = sqlx::query_as::<_, ChatMessageRow>(
            r#"
            SELECT id, user_id, username, avatar_color, text, created_at
            FROM chat_messages
            WHERE session_id = $1
            ORDER BY created_at DESC
            LIMIT $2
            "#
        )
        .bind(session_id)
        .bind(limit)
        .fetch_all(pool)
        .await?;

        rows.reverse();
        Ok(rows.into_iter().map(ChatMessage::from).collect())
    }
}
