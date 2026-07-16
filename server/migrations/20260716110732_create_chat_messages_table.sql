CREATE TABLE chat_messages (
    id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id   UUID         NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id      UUID         NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    username     VARCHAR(50)  NOT NULL,
    avatar_color VARCHAR(20)  NOT NULL,
    text         TEXT         NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_messages_session ON chat_messages(session_id, created_at);
