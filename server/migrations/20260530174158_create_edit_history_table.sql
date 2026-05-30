CREATE TABLE edit_history (
    id         BIGSERIAL    PRIMARY KEY,
    session_id UUID         NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id    UUID         NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    position   BIGINT       NOT NULL,
    text       TEXT         NOT NULL DEFAULT '',
    op_type    VARCHAR(10)  NOT NULL CHECK (op_type IN ('insert', 'delete')),
    revision   BIGINT       NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_edit_history_session  ON edit_history(session_id);
CREATE INDEX idx_edit_history_revision ON edit_history(session_id, revision);
-- Add migration script here
