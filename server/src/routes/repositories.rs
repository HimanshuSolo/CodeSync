use std::{
    path::{Component, Path, PathBuf},
    process::Stdio,
};

use axum::{
    extract::{Extension, Path as AxumPath, Query, State},
    Json,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use tokio::{fs, process::Command};
use uuid::Uuid;

use crate::{
    db,
    errors::{AppError, AppResult},
    middleware::auth::CurrentUser,
    state::AppState,
};

const MAX_FILE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Deserialize)]
pub struct ImportRepositoryRequest {
    pub repo_url: String,
    pub branch: Option<String>,
    pub github_token: Option<String>,
}

#[derive(Deserialize)]
pub struct FileQuery {
    pub path: String,
}

#[derive(Deserialize)]
pub struct WriteFileRequest {
    pub path: String,
    pub content: String,
}

#[derive(Deserialize)]
pub struct CommitRequest {
    pub message: String,
}

#[derive(Deserialize)]
pub struct PushRequest {
    pub branch: Option<String>,
    pub github_token: Option<String>,
}

#[derive(Serialize)]
pub struct MessageResponse {
    pub message: String,
}

#[derive(Serialize)]
pub struct TreeResponse {
    pub files: Vec<String>,
}

#[derive(Serialize)]
pub struct FileResponse {
    pub path: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct StatusResponse {
    pub branch: String,
    pub changes: Vec<String>,
}

pub async fn import_repository(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    AxumPath(session_id): AxumPath<Uuid>,
    Json(payload): Json<ImportRepositoryRequest>,
) -> AppResult<Json<MessageResponse>> {
    require_session_access(&state, session_id, user.id).await?;
    validate_github_url(&payload.repo_url)?;

    let workspace = workspace_path(&state, session_id);
    if workspace.exists() {
        return Err(AppError::BadRequest(
            "This session already has a repository workspace".into(),
        ));
    }
    if let Some(parent) = workspace.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|err| AppError::Internal(err.into()))?;
    }

    let mut args = vec!["clone".to_string(), "--depth=1".to_string()];
    if let Some(branch) = payload.branch.filter(|branch| !branch.trim().is_empty()) {
        args.extend(["--branch".into(), branch, "--single-branch".into()]);
    }
    args.extend([
        payload.repo_url,
        workspace.to_string_lossy().to_string(),
    ]);

    run_git(None, &args, payload.github_token.as_deref()).await?;
    Ok(Json(MessageResponse { message: "Repository imported".into() }))
}

pub async fn repository_tree(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    AxumPath(session_id): AxumPath<Uuid>,
) -> AppResult<Json<TreeResponse>> {
    require_session_access(&state, session_id, user.id).await?;
    let workspace = existing_workspace(&state, session_id)?;
    let output = run_git(Some(&workspace), &["ls-files".into()], None).await?;
    let files = output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(str::to_string)
        .collect();
    Ok(Json(TreeResponse { files }))
}

pub async fn read_file(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    AxumPath(session_id): AxumPath<Uuid>,
    Query(query): Query<FileQuery>,
) -> AppResult<Json<FileResponse>> {
    require_session_access(&state, session_id, user.id).await?;
    let workspace = existing_workspace(&state, session_id)?;
    let path = safe_file_path(&workspace, &query.path)?;
    ensure_contained(&workspace, &path).await?;
    let metadata = fs::metadata(&path)
        .await
        .map_err(|_| AppError::NotFound("Repository file not found".into()))?;
    if metadata.len() as usize > MAX_FILE_BYTES {
        return Err(AppError::BadRequest("File is too large to edit in the browser".into()));
    }
    let content = fs::read_to_string(path)
        .await
        .map_err(|_| AppError::BadRequest("Only UTF-8 text files can be edited".into()))?;
    Ok(Json(FileResponse { path: query.path, content }))
}

pub async fn write_file(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    AxumPath(session_id): AxumPath<Uuid>,
    Json(payload): Json<WriteFileRequest>,
) -> AppResult<Json<MessageResponse>> {
    require_session_access(&state, session_id, user.id).await?;
    if payload.content.len() > MAX_FILE_BYTES {
        return Err(AppError::BadRequest("File is too large to save".into()));
    }
    let workspace = existing_workspace(&state, session_id)?;
    let path = safe_file_path(&workspace, &payload.path)?;
    ensure_contained(&workspace, &path).await?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|err| AppError::Internal(err.into()))?;
    }
    fs::write(path, payload.content)
        .await
        .map_err(|err| AppError::Internal(err.into()))?;
    Ok(Json(MessageResponse { message: "File saved".into() }))
}

pub async fn git_status(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    AxumPath(session_id): AxumPath<Uuid>,
) -> AppResult<Json<StatusResponse>> {
    require_session_access(&state, session_id, user.id).await?;
    let workspace = existing_workspace(&state, session_id)?;
    let branch = run_git(
        Some(&workspace),
        &["branch".into(), "--show-current".into()],
        None,
    )
    .await?
    .trim()
    .to_string();
    let status = run_git(
        Some(&workspace),
        &["status".into(), "--porcelain".into()],
        None,
    )
    .await?;
    Ok(Json(StatusResponse {
        branch,
        changes: status.lines().map(str::to_string).collect(),
    }))
}

pub async fn git_commit(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    AxumPath(session_id): AxumPath<Uuid>,
    Json(payload): Json<CommitRequest>,
) -> AppResult<Json<MessageResponse>> {
    require_session_access(&state, session_id, user.id).await?;
    if payload.message.trim().is_empty() {
        return Err(AppError::BadRequest("Commit message is required".into()));
    }
    let workspace = existing_workspace(&state, session_id)?;
    run_git(Some(&workspace), &["add".into(), "--all".into()], None).await?;
    run_git(
        Some(&workspace),
        &[
            "-c".into(),
            format!("user.name={}", user.username),
            "-c".into(),
            "user.email=codesync@localhost".into(),
            "commit".into(),
            "-m".into(),
            payload.message.trim().into(),
        ],
        None,
    )
    .await?;
    Ok(Json(MessageResponse { message: "Changes committed".into() }))
}

pub async fn git_push(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    AxumPath(session_id): AxumPath<Uuid>,
    Json(payload): Json<PushRequest>,
) -> AppResult<Json<MessageResponse>> {
    require_session_access(&state, session_id, user.id).await?;
    let workspace = existing_workspace(&state, session_id)?;
    let branch = match payload.branch.filter(|branch| !branch.trim().is_empty()) {
        Some(branch) => branch,
        None => run_git(
            Some(&workspace),
            &["branch".into(), "--show-current".into()],
            None,
        )
        .await?
        .trim()
        .to_string(),
    };
    run_git(
        Some(&workspace),
        &["push".into(), "origin".into(), branch],
        payload.github_token.as_deref(),
    )
    .await?;
    Ok(Json(MessageResponse { message: "Changes pushed to GitHub".into() }))
}

async fn require_session_access(state: &AppState, session_id: Uuid, user_id: Uuid) -> AppResult<()> {
    let session = db::sessions::find_by_id(&state.db, session_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Session not found".into()))?;
    if session.owner_id != user_id && !db::sessions::is_member(&state.db, session_id, user_id).await? {
        return Err(AppError::Unauthorized("You do not have access to this session".into()));
    }
    Ok(())
}

fn validate_github_url(url: &str) -> AppResult<()> {
    if !url.starts_with("https://github.com/") || !url.ends_with(".git") {
        return Err(AppError::BadRequest(
            "Use an HTTPS GitHub clone URL ending in .git".into(),
        ));
    }
    Ok(())
}

fn workspace_path(state: &AppState, session_id: Uuid) -> PathBuf {
    Path::new(&state.config.workspace_root).join(session_id.to_string())
}

fn existing_workspace(state: &AppState, session_id: Uuid) -> AppResult<PathBuf> {
    let workspace = workspace_path(state, session_id);
    if !workspace.join(".git").is_dir() {
        return Err(AppError::NotFound("No repository imported for this session".into()));
    }
    Ok(workspace)
}

fn safe_file_path(workspace: &Path, relative: &str) -> AppResult<PathBuf> {
    let path = Path::new(relative);
    if path.is_absolute()
        || path.components().any(|component| {
            !matches!(component, Component::Normal(_))
                || component.as_os_str() == ".git"
        })
    {
        return Err(AppError::BadRequest("Invalid repository file path".into()));
    }
    Ok(workspace.join(path))
}

async fn ensure_contained(workspace: &Path, path: &Path) -> AppResult<()> {
    let root = fs::canonicalize(workspace)
        .await
        .map_err(|err| AppError::Internal(err.into()))?;
    let mut existing = path;
    while !existing.exists() {
        existing = existing
            .parent()
            .ok_or_else(|| AppError::BadRequest("Invalid repository file path".into()))?;
    }
    let resolved = fs::canonicalize(existing)
        .await
        .map_err(|err| AppError::Internal(err.into()))?;
    if !resolved.starts_with(root) {
        return Err(AppError::BadRequest("Repository path escapes its workspace".into()));
    }
    Ok(())
}

async fn run_git(cwd: Option<&Path>, args: &[String], token: Option<&str>) -> AppResult<String> {
    let mut command = Command::new("git");
    command.env("GIT_TERMINAL_PROMPT", "0");
    if let Some(token) = token.filter(|token| !token.trim().is_empty()) {
        let credentials = STANDARD.encode(format!("x-access-token:{}", token.trim()));
        command
            .arg("-c")
            .arg(format!("http.extraHeader=Authorization: Basic {credentials}"));
    }
    command.args(args).stdin(Stdio::null());
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    let output = command
        .output()
        .await
        .map_err(|err| AppError::Internal(err.into()))?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::BadRequest(if message.is_empty() {
            "Git command failed".into()
        } else {
            message
        }));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_paths_outside_workspace() {
        let root = Path::new("/tmp/workspace");
        assert!(safe_file_path(root, "../secret").is_err());
        assert!(safe_file_path(root, "/etc/passwd").is_err());
        assert!(safe_file_path(root, ".git/config").is_err());
    }

    #[test]
    fn accepts_normal_repository_paths() {
        let root = Path::new("/tmp/workspace");
        assert_eq!(
            safe_file_path(root, "src/main.rs").unwrap(),
            root.join("src/main.rs"),
        );
    }
}
