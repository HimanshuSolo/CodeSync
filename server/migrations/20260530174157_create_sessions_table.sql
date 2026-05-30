-- Add migration script here
CREATE TABLE sessions (
    id         UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    name       VARCHAR(255) NOT NULL,
    language   VARCHAR(50)  NOT NULL DEFAULT 'typescript',
    document   TEXT         NOT NULL DEFAULT '',
    revision   BIGINT       NOT NULL DEFAULT 0,
    owner_id   UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_owner ON sessions(owner_id);

CREATE TABLE session_members (
    session_id UUID        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id    UUID        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (session_id, user_id)
);
