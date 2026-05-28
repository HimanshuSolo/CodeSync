use axum::Json;
use serde_json::{json, Value};

/// GET /healthz
/// Used by Docker, load balancers, and uptime monitors
/// to check if the server is alive.
pub async fn health_check() -> Json<Value> {
    Json(json!({
        "status":  "ok",
        "service": "codesync-server",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

/// GET /
pub async fn root() -> Json<Value> {
    Json(json!({
        "name":    "codesync-api",
        "version": env!("CARGO_PKG_VERSION"),
        "docs":    "/healthz",
    }))
}