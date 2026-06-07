use axum::{
    extract::State,
    Json,
};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};
use tokio::{fs, process::Command, time::timeout};
use uuid::Uuid;

use crate::{
    errors::{AppError, AppResult},
    state::AppState,
};

const MAX_SOURCE_BYTES: usize = 200 * 1024;
const COMPILE_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Deserialize)]
pub struct CompileRequest {
    pub code: String,
}

#[derive(Debug, Serialize)]
pub struct CompileResponse {
    pub success:     bool,
    pub stdout:      String,
    pub stderr:      String,
    pub exit_code:   Option<i32>,
    pub duration_ms: u128,
}

pub async fn compile_rust(
    State(_state): State<AppState>,
    Json(payload): Json<CompileRequest>,
) -> AppResult<Json<CompileResponse>> {
    if payload.code.trim().is_empty() {
        return Err(AppError::BadRequest("Rust source is empty".into()));
    }

    if payload.code.len() > MAX_SOURCE_BYTES {
        return Err(AppError::BadRequest("Rust source is too large".into()));
    }

    let id = Uuid::new_v4().simple().to_string();
    let source_path = temp_path(&format!("codesync-{id}.rs"));
    let output_path = temp_path(&format!("codesync-{id}"));

    fs::write(&source_path, payload.code)
        .await
        .map_err(|err| AppError::Internal(err.into()))?;

    let started = Instant::now();
    let compile = Command::new("rustc")
        .arg("--edition=2021")
        .arg("--crate-name")
        .arg("codesync_tmp")
        .arg(&source_path)
        .arg("-o")
        .arg(&output_path)
        .output();

    let result = timeout(COMPILE_TIMEOUT, compile).await;
    let duration_ms = started.elapsed().as_millis();

    let response = match result {
        Ok(Ok(output)) => CompileResponse {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code(),
            duration_ms,
        },
        Ok(Err(err)) if err.kind() == std::io::ErrorKind::NotFound => CompileResponse {
            success: false,
            stdout: String::new(),
            stderr: "rustc was not found on the server PATH".to_string(),
            exit_code: None,
            duration_ms,
        },
        Ok(Err(err)) => return Err(AppError::Internal(err.into())),
        Err(_) => CompileResponse {
            success: false,
            stdout: String::new(),
            stderr: format!("rustc timed out after {} seconds", COMPILE_TIMEOUT.as_secs()),
            exit_code: None,
            duration_ms,
        },
    };

    let _ = fs::remove_file(&source_path).await;
    let _ = fs::remove_file(&output_path).await;

    Ok(Json(response))
}

fn temp_path(file_name: &str) -> PathBuf {
    std::env::temp_dir().join(file_name)
}
