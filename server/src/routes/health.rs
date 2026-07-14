use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use serde_json::{json, Value};
use std::time::Duration;

use crate::state::AppState;

const DB_PING_TIMEOUT: Duration = Duration::from_secs(2);

/// GET /healthz
/// Used by Docker, load balancers, and uptime monitors to check if the
/// server is alive AND can reach its database — a static 200 would report
/// healthy even while the database is unreachable.
pub async fn health_check(State(state): State<AppState>) -> impl IntoResponse {
    let db_ok = tokio::time::timeout(
        DB_PING_TIMEOUT,
        sqlx::query("SELECT 1").execute(&state.db),
    )
    .await
    .is_ok_and(|result| result.is_ok());

    let status = if db_ok { StatusCode::OK } else { StatusCode::SERVICE_UNAVAILABLE };

    (
        status,
        Json(json!({
            "status":   if db_ok { "ok" } else { "degraded" },
            "service":  "codesync-server",
            "version":  env!("CARGO_PKG_VERSION"),
            "database": if db_ok { "up" } else { "down" },
        })),
    )
}

/// GET /
pub async fn root() -> Json<Value> {
    Json(json!({
        "name":    "codesync-api",
        "version": env!("CARGO_PKG_VERSION"),
        "docs":    "/healthz",
    }))
}