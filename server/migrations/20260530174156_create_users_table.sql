-- Add migration script here
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    email         VARCHAR(255) NOT NULL UNIQUE,
    username      VARCHAR(50)  NOT NULL UNIQUE,
    password_hash TEXT         NOT NULL,
    avatar_color  VARCHAR(20)  NOT NULL DEFAULT '#7c3aed',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email    ON users(email);
CREATE INDEX idx_users_username ON users(username);
