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
        let user = sqlx::query_as!(
            User,
            "SELECT * FROM users WHERE email = $1",
            email
        )
        .fetch_optional(pool)
        .await?;
        Ok(user)
    }

    pub async fn find_by_id(pool: &PgPool, id: Uuid) -> AppResult<Option<User>> {
        let user = sqlx::query_as!(
            User,
            "SELECT * FROM users WHERE id = $1",
            id
        )
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
        let user = sqlx::query_as!(
            User,
            r#"
            INSERT INTO users (email, username, password_hash, avatar_color)
            VALUES ($1, $2, $3, $4)
            RETURNING *
            "#,
            email,
            username,
            password_hash,
            avatar_color
        )
        .fetch_one(pool)
        .await?;
        Ok(user)
    }

    pub async fn email_exists(pool: &PgPool, email: &str) -> AppResult<bool> {
        let row = sqlx::query!(
            "SELECT EXISTS(SELECT 1 FROM users WHERE email = $1) as exists",
            email
        )
        .fetch_one(pool)
        .await?;
        Ok(row.exists.unwrap_or(false))
    }

    pub async fn username_exists(pool: &PgPool, username: &str) -> AppResult<bool> {
        let row = sqlx::query!(
            "SELECT EXISTS(SELECT 1 FROM users WHERE username = $1) as exists",
            username
        )
        .fetch_one(pool)
        .await?;
        Ok(row.exists.unwrap_or(false))
    }
}

// ── Session queries ───────────────────────────────────────────────────────────
pub mod sessions {
    use sqlx::PgPool;
    use uuid::Uuid;
    use crate::models::session::{Session, SessionSummary};
    use crate::errors::AppResult;

    pub async fn list_for_user(pool: &PgPool, user_id: Uuid) -> AppResult<Vec<SessionSummary>> {
        let sessions = sqlx::query_as!(
            SessionSummary,
            r#"
            SELECT DISTINCT
                s.id, s.name, s.language, s.revision,
                s.owner_id, s.created_at, s.updated_at
            FROM sessions s
            LEFT JOIN session_members sm ON sm.session_id = s.id
            WHERE s.owner_id = $1 OR sm.user_id = $1
            ORDER BY s.updated_at DESC
            "#,
            user_id
        )
        .fetch_all(pool)
        .await?;
        Ok(sessions)
    }

    pub async fn find_by_id(pool: &PgPool, id: Uuid) -> AppResult<Option<Session>> {
        let session = sqlx::query_as!(
            Session,
            "SELECT * FROM sessions WHERE id = $1",
            id
        )
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
        let session = sqlx::query_as!(
            Session,
            r#"
            INSERT INTO sessions (name, language, owner_id)
            VALUES ($1, $2, $3)
            RETURNING *
            "#,
            name,
            language,
            owner_id
        )
        .fetch_one(pool)
        .await?;

        // add owner as first member
        sqlx::query!(
            "INSERT INTO session_members (session_id, user_id) VALUES ($1, $2)",
            session.id,
            owner_id
        )
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
        sqlx::query!(
            r#"
            UPDATE sessions
            SET document = $1, revision = $2, updated_at = NOW()
            WHERE id = $3
            "#,
            document,
            revision,
            session_id
        )
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn delete(pool: &PgPool, id: Uuid, owner_id: Uuid) -> AppResult<bool> {
        let result = sqlx::query!(
            "DELETE FROM sessions WHERE id = $1 AND owner_id = $2",
            id,
            owner_id
        )
        .execute(pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }
}// Phase 7 — Database connection pool
