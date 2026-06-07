use axum::{
    middleware as axum_middleware,
    routing::{delete, get, post},
    Router,
};
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

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
use crate::middleware as mw;
use routes::{auth, compile, health, sessions};
use state::AppState;

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "codesync_server=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Config::from_env();
    let addr   = format!("{}:{}", config.host, config.port);

    tracing::info!("Starting CodeSync server v{}", env!("CARGO_PKG_VERSION"));

    tracing::info!("Connecting to database...");
    let pool = db::create_pool(&config.database_url)
        .await
        .expect("Failed to connect to database");
    tracing::info!("Database connected ✓");

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("Failed to run migrations");
    tracing::info!("Migrations applied ✓");

    let state = AppState::new(pool, config.clone());

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // ── public routes ─────────────────────────────────────
    let public_routes = Router::new()
        .route("/",                get(health::root))
        .route("/healthz",         get(health::health_check))
        .route("/auth/register",   post(auth::register))
        .route("/auth/login",      post(auth::login));

    // ── protected routes — JWT middleware applied ─────────
    let protected_routes = Router::new()
        .route("/auth/me",              get(auth::me))
        .route("/sessions",             get(sessions::list_sessions))
        .route("/sessions",             post(sessions::create_session))
        .route("/sessions/:id",         get(sessions::get_session))
        .route("/sessions/:id",         delete(sessions::delete_session))
        .route("/compile/rust",         post(compile::compile_rust))
        .layer(axum_middleware::from_fn_with_state(
            state.clone(),
            mw::auth::require_auth,
        ));

    let websocket_routes = Router::new()
        .route("/session/:id/ws",       get(ws::handler::ws_handler));

    let app = Router::new()
        .merge(public_routes)
        .merge(protected_routes)
        .merge(websocket_routes)
        .with_state(state)
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|_| panic!("Failed to bind to {addr}"));

    tracing::info!("Listening on http://{addr}");

    axum::serve(listener, app)
        .await
        .expect("Server failed");
}
