use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, Instant},
};
use tokio::{
    fs,
    io::AsyncWriteExt,
    process::Command,
    time::timeout,
};
use uuid::Uuid;

use crate::{
    errors::{AppError, AppResult},
    state::AppState,
};

const MAX_SOURCE_BYTES: usize = 500 * 1024;
const MAX_STDIN_BYTES: usize = 100 * 1024;
const RUN_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Deserialize)]
pub struct RunRequest {
    pub language: String,
    pub code: String,
    #[serde(default)]
    pub stdin: String,
}

#[derive(Debug, Serialize)]
pub struct RunResponse {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub duration_ms: u128,
    pub timed_out: bool,
}

struct LanguageRuntime {
    image: &'static str,
    file_name: &'static str,
    command: &'static str,
}

pub async fn run_code(
    State(state): State<AppState>,
    Json(payload): Json<RunRequest>,
) -> AppResult<Json<RunResponse>> {
    if payload.code.trim().is_empty() {
        return Err(AppError::BadRequest("Source code is empty".into()));
    }
    if payload.code.len() > MAX_SOURCE_BYTES {
        return Err(AppError::BadRequest("Source code is too large".into()));
    }
    if payload.stdin.len() > MAX_STDIN_BYTES {
        return Err(AppError::BadRequest("Standard input is too large".into()));
    }

    let runtime = runtime_for(&payload.language)
        .ok_or_else(|| AppError::BadRequest("This language cannot be executed".into()))?;
    let _permit = timeout(Duration::from_secs(3), state.runner_slots.acquire())
        .await
        .map_err(|_| AppError::BadRequest("Runner is busy; try again shortly".into()))?
        .map_err(|_| AppError::Internal(anyhow::anyhow!("Runner queue closed")))?;
    let id = Uuid::new_v4().simple().to_string();
    let workspace = Path::new(&state.config.runner_workspace_root).join(format!("codesync-run-{id}"));
    fs::create_dir(&workspace)
        .await
        .map_err(|err| AppError::Internal(err.into()))?;
    fs::write(workspace.join(runtime.file_name), payload.code)
        .await
        .map_err(|err| AppError::Internal(err.into()))?;

    let container_name = format!("codesync-runner-{id}");
    let started = Instant::now();
    let result = run_container(
        &container_name,
        &workspace,
        state.config.runner_volume_name.as_deref(),
        runtime,
        payload.stdin.as_bytes(),
    )
    .await;
    let duration_ms = started.elapsed().as_millis();

    let response = match result {
        Ok(output) => RunResponse {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code(),
            duration_ms,
            timed_out: false,
        },
        Err(RunError::TimedOut) => {
            stop_container(&container_name).await;
            RunResponse {
                success: false,
                stdout: String::new(),
                stderr: format!("Execution timed out after {} seconds", RUN_TIMEOUT.as_secs()),
                exit_code: None,
                duration_ms,
                timed_out: true,
            }
        }
        Err(RunError::DockerUnavailable(message)) => RunResponse {
            success: false,
            stdout: String::new(),
            stderr: message,
            exit_code: None,
            duration_ms,
            timed_out: false,
        },
        Err(RunError::Internal(err)) => {
            let _ = fs::remove_dir_all(&workspace).await;
            return Err(AppError::Internal(err));
        }
    };

    let _ = fs::remove_dir_all(&workspace).await;
    Ok(Json(response))
}

async fn run_container(
    container_name: &str,
    workspace: &Path,
    runner_volume_name: Option<&str>,
    runtime: LanguageRuntime,
    stdin: &[u8],
) -> Result<std::process::Output, RunError> {
    let mut command = Command::new("docker");
    command
        .arg("run")
        .arg("--rm")
        .arg("--pull")
        .arg("never")
        .arg("--name")
        .arg(container_name)
        .arg("--network")
        .arg("none")
        .arg("--memory")
        .arg("512m")
        .arg("--memory-swap")
        .arg("512m")
        .arg("--cpus")
        .arg("0.75")
        .arg("--pids-limit")
        .arg("64")
        .arg("--stop-timeout")
        .arg("1")
        .arg("--read-only")
        .arg("--cap-drop")
        .arg("ALL")
        .arg("--security-opt")
        .arg("no-new-privileges")
        .arg("--user")
        .arg("65534:65534")
        .arg("--tmpfs")
        .arg("/tmp:rw,exec,nosuid,nodev,size=256m,mode=1777")
        .arg("--workdir");

    if let Some(volume_name) = runner_volume_name {
        command
            .arg(workspace)
            .arg("--volume")
            .arg(format!("{volume_name}:{}:ro", Path::new(&workspace_root(workspace)).display()));
    } else {
        command
            .arg("/workspace")
            .arg("--volume")
            .arg(format!("{}:/workspace:ro,Z", workspace.display()));
    }

    command
        .arg("--entrypoint")
        .arg("sh")
        .arg(runtime.image)
        .arg("-c")
        .arg(runtime.command)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            RunError::DockerUnavailable("Docker is not installed on the server".into())
        } else {
            RunError::Internal(err.into())
        }
    })?;

    if let Some(mut child_stdin) = child.stdin.take() {
        child_stdin
            .write_all(stdin)
            .await
            .map_err(|err| RunError::Internal(err.into()))?;
    }

    match timeout(RUN_TIMEOUT, child.wait_with_output()).await {
        Ok(Ok(output)) => {
            if !output.status.success()
                && String::from_utf8_lossy(&output.stderr).contains("permission denied")
                && String::from_utf8_lossy(&output.stderr).contains("docker")
            {
                return Err(RunError::DockerUnavailable(
                    "The CodeSync server cannot access Docker".into(),
                ));
            }
            if !output.status.success()
                && String::from_utf8_lossy(&output.stderr).contains("No such image")
            {
                return Err(RunError::DockerUnavailable(format!(
                    "Runner image {} is not installed. Pull the CodeSync runner images first.",
                    runtime.image
                )));
            }
            Ok(output)
        }
        Ok(Err(err)) => Err(RunError::Internal(err.into())),
        Err(_) => Err(RunError::TimedOut),
    }
}

async fn stop_container(container_name: &str) {
    let _ = Command::new("docker")
        .args(["rm", "-f", container_name])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await;
}

fn runtime_for(language: &str) -> Option<LanguageRuntime> {
    match language {
        "python" => Some(LanguageRuntime {
            image: "python:3.13-alpine",
            file_name: "main.py",
            command: "python main.py",
        }),
        "javascript" => Some(LanguageRuntime {
            image: "node:22-alpine",
            file_name: "main.js",
            command: "node main.js",
        }),
        "typescript" => Some(LanguageRuntime {
            image: "denoland/deno:alpine",
            file_name: "main.ts",
            command: "DENO_DIR=/tmp/deno deno run --no-prompt main.ts",
        }),
        "rust" => Some(LanguageRuntime {
            image: "rust:1.85-alpine",
            file_name: "main.rs",
            command: "rustc --edition=2021 main.rs -o /tmp/main && /tmp/main",
        }),
        "go" => Some(LanguageRuntime {
            image: "golang:1.24-alpine",
            file_name: "main.go",
            command: "GOMAXPROCS=1 GOFLAGS=-p=1 GOCACHE=/tmp/go-cache go run main.go",
        }),
        "cpp" => Some(LanguageRuntime {
            image: "gcc:14",
            file_name: "main.cpp",
            command: "g++ -std=c++20 -O2 main.cpp -o /tmp/main && /tmp/main",
        }),
        "java" => Some(LanguageRuntime {
            image: "eclipse-temurin:21-jdk-alpine",
            file_name: "Main.java",
            command: "javac -d /tmp Main.java && java -Xmx128m -cp /tmp Main",
        }),
        _ => None,
    }
}

fn workspace_root(workspace: &Path) -> PathBuf {
    workspace.parent().unwrap_or(workspace).to_path_buf()
}

enum RunError {
    TimedOut,
    DockerUnavailable(String),
    Internal(anyhow::Error),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_supported_languages() {
        for language in [
            "python",
            "javascript",
            "typescript",
            "rust",
            "go",
            "cpp",
            "java",
        ] {
            assert!(runtime_for(language).is_some(), "{language}");
        }
        assert!(runtime_for("markdown").is_none());
    }
}
