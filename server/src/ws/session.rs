use axum::extract::ws::{Message, WebSocket};
use futures::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc};
use uuid::Uuid;
use crate::{
    db,
    middleware::auth::CurrentUser,
    state::{AppState, SessionHandle},
    ws::messages::{ClientMessage, EditOp, Participant, ServerMessage},
};

/// The session actor manages one collaborative session.
/// It owns the document state and serialises all edits.
pub struct SessionActor;

impl SessionActor {
    /// Get existing session actor or create a new one.
    /// Returns a handle that any connection task can use.
    pub async fn get_or_create(
        state:      &AppState,
        session_id: Uuid,
        document:   String,
        revision:   i64,
    ) -> Arc<ActorHandle> {
        // check if actor already running for this session
        if let Some(handle) = state.sessions.get(&session_id.to_string()) {
            return Arc::new(handle.clone().into());
        }

        // create channels
        // mpsc: many connection tasks → one actor (edit ops)
        let (tx, rx)               = mpsc::channel::<ActorMessage>(256);
        // broadcast: one actor → many connection tasks (resolved ops)
        let (broadcast_tx, _)      = broadcast::channel::<ServerMessage>(256);

        let handle = ActorHandle {
            tx:           tx.clone(),
            broadcast_tx: broadcast_tx.clone(),
        };

        // register in session registry
        state.sessions.insert(
            session_id.to_string(),
            SessionHandle {
                tx:           tx.clone(),
                broadcast_tx: broadcast_tx.clone(),
            },
        );

        // spawn the actor task
        let db   = state.db.clone();
        let sid  = session_id;
        let groq_api_key = state.config.groq_api_key.clone();
        tokio::spawn(async move {
            run_actor(sid, document, revision, rx, broadcast_tx, db, groq_api_key).await;
        });

        tracing::info!("Session actor started for {}", session_id);
        Arc::new(handle)
    }

    /// Handle a single WebSocket connection.
    pub async fn handle_connection(
        handle:       Arc<ActorHandle>,
        socket:       WebSocket,
        current_user: CurrentUser,
    ) {
        let (mut sink, mut stream) = socket.split();
        let mut broadcast_rx       = handle.broadcast_tx.subscribe();

        // notify actor that user joined
        let _ = handle.tx.send(ActorMessage::UserJoined {
            user_id:      current_user.id,
            username:     current_user.username.clone(),
            avatar_color: current_user.avatar_color.clone(),
        }).await;

        // ── connection loop ───────────────────────────────
        loop {
            tokio::select! {
                // inbound: message from this client
                msg = stream.next() => {
                    match msg {
                        Some(Ok(Message::Text(text))) => {
                            match serde_json::from_str::<ClientMessage>(&text) {
                                Ok(client_msg) => {
                                    let _ = handle.tx.send(ActorMessage::ClientMsg {
                                        user_id: current_user.id,
                                        msg:     client_msg,
                                    }).await;
                                }
                                Err(e) => {
                                    tracing::warn!("Failed to parse WS message: {e}");
                                }
                            }
                        }
                        // client disconnected
                        Some(Ok(Message::Close(_))) | None => break,
                        _ => {}
                    }
                }

                // outbound: broadcast from actor to this client
                result = broadcast_rx.recv() => {
                    match result {
                        Ok(server_msg) => {
                            if let Ok(text) = serde_json::to_string(&server_msg) {
                                if sink.send(Message::Text(text)).await.is_err() {
                                    break; // client disconnected
                                }
                            }
                        }
                        Err(broadcast::error::RecvError::Lagged(n)) => {
                            tracing::warn!("Client lagged behind by {n} messages");
                        }
                        Err(_) => break,
                    }
                }
            }
        }

        // notify actor that user left
        let _ = handle.tx.send(ActorMessage::UserLeft {
            user_id: current_user.id,
        }).await;

        tracing::info!("Connection closed for user {}", current_user.username);
    }
}

// ── actor handle ─────────────────────────────────────────────────────────────

/// Cheap-to-clone handle — wraps the channel senders.
#[derive(Clone)]
pub struct ActorHandle {
    pub tx:           mpsc::Sender<ActorMessage>,
    pub broadcast_tx: broadcast::Sender<ServerMessage>,
}

impl ActorHandle {
    pub async fn handle_connection(self: Arc<Self>, socket: WebSocket, user: CurrentUser) {
        SessionActor::handle_connection(self, socket, user).await;
    }
}

impl From<SessionHandle> for ActorHandle {
    fn from(h: SessionHandle) -> Self {
        Self {
            tx:           h.tx,
            broadcast_tx: h.broadcast_tx,
        }
    }
}

// ── messages into the actor ───────────────────────────────────────────────────

pub enum ActorMessage {
    ClientMsg { user_id: Uuid, msg: ClientMessage },
    UserJoined { user_id: Uuid, username: String, avatar_color: String },
    UserLeft  { user_id: Uuid },
    Shutdown,
}

/// Determine which historical ops a client-submitted edit needs to be
/// transformed against.
///
/// `history[i]` always represents server revision `history_base_revision +
/// i + 1` — `history_base_revision` starts at the actor's starting
/// revision (which can be nonzero, e.g. resumed from a persisted
/// snapshot) and is bumped every time old entries are trimmed from the
/// front of `history`. This keeps `client_rev`-based lookups correct in
/// both cases, instead of assuming revision 0 lines up with index 0.
///
/// Returns `None` if `client_rev` predates everything still retained in
/// `history` — the caller should force a full resync rather than
/// transform against a partial view, which would silently corrupt the
/// shared document for every participant.
fn ops_since_client_revision<'a>(
    history: &'a [EditOp],
    history_base_revision: i64,
    client_rev: i64,
) -> Option<&'a [EditOp]> {
    if client_rev < history_base_revision {
        return None;
    }
    let skip_count = (client_rev - history_base_revision) as usize;
    Some(history.get(skip_count..).unwrap_or(&[]))
}

#[cfg(test)]
mod history_tests {
    use super::*;
    use crate::ws::messages::OpType;

    fn dummy_op(revision: u64) -> EditOp {
        EditOp {
            position:  0,
            text:      String::new(),
            op_type:   OpType::Insert,
            revision,
            user_id:   "u".into(),
            client_id: None,
        }
    }

    #[test]
    fn up_to_date_client_gets_no_ops() {
        let history = vec![dummy_op(1), dummy_op(2)];
        let ops = ops_since_client_revision(&history, 0, 2).unwrap();
        assert!(ops.is_empty());
    }

    #[test]
    fn behind_client_gets_missed_ops() {
        let history = vec![dummy_op(1), dummy_op(2), dummy_op(3)];
        let ops = ops_since_client_revision(&history, 0, 1).unwrap();
        assert_eq!(ops.len(), 2);
        assert_eq!(ops[0].revision, 2);
        assert_eq!(ops[1].revision, 3);
    }

    #[test]
    fn base_revision_offsets_correctly_after_trim() {
        // History was trimmed once: the first 100 ops are gone, so
        // history[0] is now revision 101 and the base moved to 100.
        let history = vec![dummy_op(101), dummy_op(102)];
        let ops = ops_since_client_revision(&history, 100, 100).unwrap();
        assert_eq!(ops.len(), 2);
    }

    #[test]
    fn client_older_than_retained_history_forces_resync() {
        let history = vec![dummy_op(101), dummy_op(102)];
        let ops = ops_since_client_revision(&history, 100, 50);
        assert!(ops.is_none());
    }

    #[test]
    fn nonzero_starting_revision_is_handled() {
        // Actor resumed from a persisted snapshot at revision 50 — an
        // up-to-date client's base revision is 50, not 0. Before this
        // fix, `history.iter().skip(client_rev as usize)` would have
        // skipped 50 entries of an empty/short history and silently
        // dropped ops that hadn't actually been seen by the client.
        let history: Vec<EditOp> = vec![];
        let ops = ops_since_client_revision(&history, 50, 50).unwrap();
        assert!(ops.is_empty());
    }
}

// ── actor loop ────────────────────────────────────────────────────────────────

/// The core actor task — runs for the lifetime of a session.
/// Serialises all edits, maintains document state, broadcasts resolved ops.
async fn run_actor(
    session_id:   Uuid,
    document:     String,
    revision:     i64,
    mut rx:       mpsc::Receiver<ActorMessage>,
    broadcast_tx: broadcast::Sender<ServerMessage>,
    db:           sqlx::PgPool,
    groq_api_key: String,
) {
    let mut doc      = document;
    let mut rev      = revision;
    let mut active_file: Option<String> = None;
    let mut participants: Vec<Participant> = Vec::new();
    let mut history: Vec<EditOp> = Vec::new();
    // history[i] represents server revision `history_base_revision + i + 1`.
    // Starts at the actor's starting revision (see ops_since_client_revision)
    // and is bumped whenever the front of `history` is trimmed.
    let mut history_base_revision: i64 = revision;

    while let Some(msg) = rx.recv().await {
        match msg {

            // ── user connected ────────────────────────────
            ActorMessage::UserJoined { user_id, username, avatar_color } => {
                // send current document state to the new user
                let state_msg = ServerMessage::SessionState {
                    document:     doc.clone(),
                    active_file:  active_file.clone(),
                    participants: participants.clone(),
                    revision:     rev as u64,
                };
                let _ = broadcast_tx.send(state_msg);

                // add to participants list
                let participant = Participant {
                    user_id:      user_id.to_string(),
                    username:     username.clone(),
                    avatar_color: avatar_color.clone(),
                    cursor_line:  0,
                    cursor_col:   0,
                    is_online:    true,
                };
                participants.push(participant.clone());

                // broadcast join event to everyone else
                let _ = broadcast_tx.send(ServerMessage::UserJoined(participant));

                tracing::info!("User {} joined session {}", username, session_id);
            }

            // ── user disconnected ─────────────────────────
            ActorMessage::UserLeft { user_id } => {
                participants.retain(|p| p.user_id != user_id.to_string());
                let _ = broadcast_tx.send(ServerMessage::UserLeft {
                    user_id: user_id.to_string(),
                });
            }

            ActorMessage::Shutdown => {
                let _ = broadcast_tx.send(ServerMessage::SessionDeleted {
                    message: "This session was deleted by its owner".into(),
                });
                break;
            }

            // ── incoming client message ───────────────────
            ActorMessage::ClientMsg { user_id, msg } => {
                match msg {

                    ClientMessage::Edit(op) => {
    // ── OT: transform against ops since client's revision ──
    // op.revision = what the client based this edit on
    // rev         = current server revision
    // if they differ, client missed some ops — transform
    let client_rev = op.revision as i64;
    let ops_since = match ops_since_client_revision(&history, history_base_revision, client_rev) {
        Some(ops) => ops.to_vec(),
        None => {
            // The ops this client would need have already been trimmed
            // from history. Transforming against a partial view would
            // silently corrupt the document for everyone, so force a
            // full resync instead and drop this stale edit.
            tracing::warn!(
                "Session {}: client revision {} predates retained history (base {}) — forcing resync",
                session_id, client_rev, history_base_revision
            );
            let _ = broadcast_tx.send(ServerMessage::SessionState {
                document:     doc.clone(),
                active_file:  active_file.clone(),
                participants: participants.clone(),
                revision:     rev as u64,
            });
            continue;
        }
    };

    let mut transformed = op.clone();
    for past_op in &ops_since {
        transformed = ot::transform(transformed, past_op);
    }

    // ── apply transformed op to document ──────────────────
    ot::apply(&mut doc, &transformed);

    // ── increment revision ─────────────────────────────────
    rev += 1;
    transformed.revision = rev as u64;

    // ── store in history for future transforms ─────────────
    history.push(transformed.clone());

    // ── keep history bounded — last 1000 ops ──────────────
    if history.len() > 1000 {
        history.drain(0..100);
        history_base_revision += 100;
    }

    // ── persist every 10 revisions ─────────────────────────
    if rev % 10 == 0 {
        let db2 = db.clone();
        let d   = doc.clone();
        let r   = rev;
        let sid = session_id;
        tokio::spawn(async move {
            if let Err(e) = db::sessions::update_document(
                &db2, sid, &d, r
            ).await {
                tracing::error!("Failed to persist document: {e}");
            }
        });
    }

    // ── broadcast resolved op to all clients ───────────────
    let _ = broadcast_tx.send(ServerMessage::Edit(transformed));
}

                    ClientMessage::Cursor(pos) => {
                        let mut cursor = pos;
                        cursor.user_id = user_id.to_string();

                        // update participant cursor in memory
                        if let Some(p) = participants.iter_mut()
                            .find(|p| p.user_id == user_id.to_string())
                        {
                            p.cursor_line = cursor.line;
                            p.cursor_col  = cursor.col;
                            cursor.username = p.username.clone();
                            cursor.avatar_color = p.avatar_color.clone();
                        }
                        // broadcast cursor to everyone
                        let _ = broadcast_tx.send(ServerMessage::Cursor(cursor));
                    }

                    ClientMessage::AiRequest(req) => {
    tracing::info!(
        "AI request in session {}: {}",
        session_id, req.prompt
    );

    let api_key      = groq_api_key.clone();
    let broadcast_tx2 = broadcast_tx.clone();
    let message_id   = req.request_id.clone();
    let prompt       = req.prompt.clone();
    let code         = req.selected_code.clone();
    let lang         = req.language.clone();

    // spawn AI task so it doesn't block the actor loop
    tokio::spawn(async move {
        crate::ai::groq::stream_ai_response(
            &api_key,
            &prompt,
            &code,
            &lang,
            &message_id,
            &broadcast_tx2,
        ).await;
    });
}

                    ClientMessage::OpenFile(req) => {
                        doc = req.document;
                        active_file = Some(req.path);
                        rev = 0;
                        history.clear();
                        history_base_revision = 0;

                        if let Err(e) = db::sessions::update_document(
                            &db, session_id, &doc, rev
                        ).await {
                            tracing::error!("Failed to persist opened file: {e}");
                        }

                        let _ = broadcast_tx.send(ServerMessage::SessionState {
                            document: doc.clone(),
                            active_file: active_file.clone(),
                            participants: participants.clone(),
                            revision: rev as u64,
                        });
                    }

                    ClientMessage::Ping => {
                        let _ = broadcast_tx.send(ServerMessage::Pong);
                    }
                }
            }
        }
    }

    tracing::info!("Session actor stopped for {}", session_id);
}

// ── Operational Transform ─────────────────────────────────────────────────────

pub mod ot {
    use crate::ws::messages::{EditOp, OpType};

    /// Op positions travel the wire as UTF-16 code-unit offsets — that's
    /// what JavaScript string indexing and Monaco's `getPositionAt` /
    /// `applyEdits` use on the frontend (see `useEditor.ts`). Transform
    /// math must shift positions by the same unit, not by `str::len()`
    /// (UTF-8 byte length), or multi-byte text (accents, CJK, emoji)
    /// desyncs positions between client and server.
    fn utf16_len(text: &str) -> usize {
        text.encode_utf16().count()
    }

    /// Convert a UTF-16 code-unit offset into a byte offset into `s`,
    /// clamping to the end of the string if the offset runs past it.
    fn utf16_offset_to_byte_offset(s: &str, utf16_offset: usize) -> usize {
        let mut utf16_count = 0;
        for (byte_idx, ch) in s.char_indices() {
            if utf16_count >= utf16_offset {
                return byte_idx;
            }
            utf16_count += ch.len_utf16();
        }
        s.len()
    }

    /// Transform op_a against op_b — returns adjusted op_a.
    /// Called when op_a was based on a revision that op_b
    /// has already been applied to.
    pub fn transform(mut op_a: EditOp, op_b: &EditOp) -> EditOp {
        match (&op_a.op_type, &op_b.op_type) {

            // ── insert vs insert ──────────────────────────
            (OpType::Insert, OpType::Insert) => {
                if op_b.position < op_a.position
                || (op_b.position == op_a.position
                    && op_b.user_id < op_a.user_id) // tiebreak by user_id
                {
                    op_a.position += utf16_len(&op_b.text);
                }
                op_a
            }

            // ── insert vs delete ──────────────────────────
            (OpType::Insert, OpType::Delete) => {
                if op_b.position < op_a.position {
                    let shift = utf16_len(&op_b.text).min(
                        op_a.position - op_b.position
                    );
                    op_a.position -= shift;
                }
                op_a
            }

            // ── delete vs insert ──────────────────────────
            (OpType::Delete, OpType::Insert) => {
                if op_b.position <= op_a.position {
                    op_a.position += utf16_len(&op_b.text);
                }
                op_a
            }

            // ── delete vs delete ──────────────────────────
            (OpType::Delete, OpType::Delete) => {
                if op_b.position < op_a.position {
                    let shift = utf16_len(&op_b.text).min(
                        op_a.position - op_b.position
                    );
                    op_a.position -= shift;
                } else if op_b.position == op_a.position {
                    // both deleting same position — op_a becomes no-op
                    op_a.text = String::new();
                }
                op_a
            }
        }
    }

    /// Apply an edit op to a document string.
    /// `op.position` (and the length implied by `op.text`) are UTF-16
    /// code-unit offsets; convert to byte offsets right before mutating
    /// the UTF-8-backed `String`.
    pub fn apply(doc: &mut String, op: &EditOp) {
        match op.op_type {
            OpType::Insert => {
                let byte_pos = utf16_offset_to_byte_offset(doc, op.position);
                doc.insert_str(byte_pos, &op.text);
            }
            OpType::Delete => {
                let start_byte = utf16_offset_to_byte_offset(doc, op.position);
                let end_utf16  = op.position + utf16_len(&op.text);
                let end_byte   = utf16_offset_to_byte_offset(doc, end_utf16);
                if start_byte < end_byte {
                    doc.drain(start_byte..end_byte);
                }
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn op(op_type: OpType, position: usize, text: &str, user_id: &str) -> EditOp {
            EditOp {
                position,
                text: text.to_string(),
                op_type,
                revision: 0,
                user_id: user_id.to_string(),
                client_id: None,
            }
        }

        #[test]
        fn insert_insert_shifts_later_op_right() {
            // "AB" inserted at 0 by user "a" — a concurrent insert at
            // position 2 by user "b" should shift right by 2.
            let a = op(OpType::Insert, 2, "XY", "b");
            let b = op(OpType::Insert, 0, "AB", "a");
            let transformed = transform(a, &b);
            assert_eq!(transformed.position, 4);
        }

        #[test]
        fn insert_insert_tiebreaks_by_user_id() {
            // same position — lower user_id wins the earlier slot.
            let a = op(OpType::Insert, 5, "X", "b");
            let b = op(OpType::Insert, 5, "Y", "a");
            let transformed = transform(a, &b);
            assert_eq!(transformed.position, 6); // "a" < "b" so a shifts right
        }

        #[test]
        fn insert_delete_shifts_left() {
            // delete of 3 chars at 0 happened first; insert originally at 5
            // should shift left by 3.
            let a = op(OpType::Insert, 5, "X", "u1");
            let b = op(OpType::Delete, 0, "abc", "u2");
            let transformed = transform(a, &b);
            assert_eq!(transformed.position, 2);
        }

        #[test]
        fn delete_insert_shifts_right() {
            // insert of 2 chars at 0 happened first; delete originally at 5
            // should shift right by 2.
            let a = op(OpType::Delete, 5, "z", "u1");
            let b = op(OpType::Insert, 0, "hi", "u2");
            let transformed = transform(a, &b);
            assert_eq!(transformed.position, 7);
        }

        #[test]
        fn delete_delete_overlapping_becomes_noop() {
            let a = op(OpType::Delete, 3, "x", "u1");
            let b = op(OpType::Delete, 3, "y", "u2");
            let transformed = transform(a, &b);
            assert_eq!(transformed.text, "");
        }

        #[test]
        fn delete_delete_shifts_left() {
            let a = op(OpType::Delete, 5, "x", "u1");
            let b = op(OpType::Delete, 0, "abc", "u2");
            let transformed = transform(a, &b);
            assert_eq!(transformed.position, 2);
        }

        #[test]
        fn apply_insert_ascii() {
            let mut doc = "hello world".to_string();
            apply(&mut doc, &op(OpType::Insert, 5, ",", "u1"));
            assert_eq!(doc, "hello, world");
        }

        #[test]
        fn apply_delete_ascii() {
            let mut doc = "hello, world".to_string();
            apply(&mut doc, &op(OpType::Delete, 5, ",", "u1"));
            assert_eq!(doc, "hello world");
        }

        #[test]
        fn apply_insert_after_multibyte_text() {
            // "café" — 'é' is 1 UTF-16 unit but 2 UTF-8 bytes. Inserting
            // right after it (UTF-16 offset 4) must land after the 'é',
            // not mid-byte, and must not panic.
            let mut doc = "café".to_string();
            apply(&mut doc, &op(OpType::Insert, 4, "!", "u1"));
            assert_eq!(doc, "café!");
        }

        #[test]
        fn apply_insert_before_emoji_surrogate_pair() {
            // "a🎉b" — the emoji is a surrogate pair: 2 UTF-16 units,
            // 4 UTF-8 bytes. Position 3 (UTF-16) is right after it.
            let mut doc = "a🎉b".to_string();
            apply(&mut doc, &op(OpType::Insert, 3, "-", "u1"));
            assert_eq!(doc, "a🎉-b");
        }

        #[test]
        fn apply_delete_spanning_emoji() {
            let mut doc = "a🎉b".to_string();
            // delete the 2 UTF-16 units the emoji occupies (offset 1..3)
            apply(&mut doc, &op(OpType::Delete, 1, "🎉", "u1"));
            assert_eq!(doc, "ab");
        }

        #[test]
        fn apply_clamps_position_past_end() {
            let mut doc = "hi".to_string();
            apply(&mut doc, &op(OpType::Insert, 999, "!", "u1"));
            assert_eq!(doc, "hi!");
        }
    }
}
