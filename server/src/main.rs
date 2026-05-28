use axum::{routing::get, Router};
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use std::net::SocketAddr;

mod ai;
mod config;
mod db;
mod errors;
mod middleware;
mod models;
mod routes;
mod state;
mod ws;

use config::Config;
use routes::health;

#[tokio::main]
async fn main() {
    // ── load .env file ───────────────────────────────────
    dotenvy::dotenv().ok();

    // ── initialise tracing (logging) ─────────────────────
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "codesync_server=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // ── load config from env ─────────────────────────────
    let config = Config::from_env();
    let addr   = format!("{}:{}", config.host, config.port);

    tracing::info!("Starting CodeSync server");
    tracing::info!("Config loaded — port {}", config.port);

    // ── CORS — allow Next.js dev server ──────────────────
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // ── build router ─────────────────────────────────────
    // Phase 8+: add auth, session, WS routes here
    let app = Router::new()
        .route("/",        get(health::root))
        .route("/healthz", get(health::health_check))
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    // ── bind + serve ──────────────────────────────────────
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|_| panic!("Failed to bind to {addr}"));

    tracing::info!("Listening on http://{addr}");

    axum::serve(listener, app)
        .await
        .expect("Server failed");
}