use serde::{Deserialize, Serialize};

/// Messages the CLIENT sends to the server.
/// #[serde(tag = "type", content = "payload")] matches
/// the exact JSON shape your frontend ws-messages.ts produces.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
pub enum ClientMessage {
    Edit(EditOp),
    Cursor(CursorPosition),
    AiRequest(AiRequest),
    OpenFile(OpenFileRequest),
    Chat(ChatInput),
    Ping,
}

/// Messages the SERVER sends to the client.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "type",
    content = "payload",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ServerMessage {
    Edit(EditOp),
    Cursor(CursorPosition),
    AiToken    { message_id: String, token: String },
    AiDone     { message_id: String },
    UserJoined(Participant),
    UserLeft   { user_id: String },
    Chat(ChatMessage),
    SessionState {
        document:     String,
        active_file:  Option<String>,
        participants: Vec<Participant>,
        revision:     u64,
        chat_history: Vec<ChatMessage>,
    },
    SessionDeleted { message: String },
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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
    pub request_id:    String,
    pub prompt:        String,
    pub selected_code: String,
    pub language:      String,
    pub start_line:    u32,
    pub end_line:      u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFileRequest {
    pub path: String,
    pub document: String,
}

/// Chat message text sent by a client. The server fills in the sender's
/// identity and timestamp before broadcasting, so the client can't spoof
/// another participant.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatInput {
    pub text: String,
}

/// Chat message broadcast to all participants.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub user_id: String,
    pub username: String,
    pub avatar_color: String,
    pub text: String,
    pub timestamp: String,
}
