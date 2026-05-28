use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Messages the CLIENT sends to the server.
/// #[serde(tag = "type", content = "payload")] matches
/// the exact JSON shape your frontend ws-messages.ts produces.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
pub enum ClientMessage {
    Edit(EditOp),
    Cursor(CursorPosition),
    AiRequest(AiRequest),
    Ping,
}

/// Messages the SERVER sends to the client.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
pub enum ServerMessage {
    Edit(EditOp),
    Cursor(CursorPosition),
    AiToken    { message_id: String, token: String },
    AiDone     { message_id: String },
    UserJoined(Participant),
    UserLeft   { user_id: String },
    SessionState {
        document:     String,
        participants: Vec<Participant>,
        revision:     u64,
    },
    Error { message: String },
    Pong,
}

/// A single text edit operation.
/// Mirrors the TypeScript EditOp interface exactly.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditOp {
    pub position: usize,
    pub text:     String,
    pub op_type:  OpType,
    pub revision: u64,
    pub user_id:  String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OpType {
    Insert,
    Delete,
}

/// Cursor position broadcast
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorPosition {
    pub user_id:      String,
    pub username:     String,
    pub avatar_color: String,
    pub line:         u32,
    pub col:          u32,
}

/// Connected participant
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Participant {
    pub user_id:      String,
    pub username:     String,
    pub avatar_color: String,
    pub cursor_line:  u32,
    pub cursor_col:   u32,
    pub is_online:    bool,
}

/// AI request from client
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRequest {
    pub prompt:        String,
    pub selected_code: String,
    pub language:      String,
    pub start_line:    u32,
    pub end_line:      u32,
}