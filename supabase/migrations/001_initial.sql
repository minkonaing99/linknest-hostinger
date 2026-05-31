-- Link Nest — initial schema
-- Run this in the Supabase SQL Editor before first deploy.

-- ────────────────────────────────────────────
-- Tables
-- ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id           TEXT        PRIMARY KEY,
  username     TEXT        UNIQUE NOT NULL,
  password_hash TEXT       NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS links (
  id         TEXT        PRIMARY KEY,
  url        TEXT        UNIQUE NOT NULL,
  title      TEXT        NOT NULL DEFAULT '',
  host       TEXT        NOT NULL DEFAULT '',
  status     TEXT        NOT NULL DEFAULT 'saved'
               CHECK (status IN ('unread', 'saved', 'useful', 'archived')),
  tags       TEXT[]      NOT NULL DEFAULT '{}',
  pinned     BOOLEAN     NOT NULL DEFAULT FALSE,
  date       TEXT        NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
  id         BIGSERIAL   PRIMARY KEY,
  token      TEXT        UNIQUE NOT NULL,
  user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username   TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         BIGSERIAL   PRIMARY KEY,
  token      TEXT        UNIQUE NOT NULL,
  user_id    TEXT        NOT NULL,
  username   TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

-- ────────────────────────────────────────────
-- Indexes — links
-- ────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS links_updated_at_idx
  ON links (updated_at DESC);

CREATE INDEX IF NOT EXISTS links_created_at_idx
  ON links (created_at DESC);

CREATE INDEX IF NOT EXISTS links_date_idx
  ON links (date DESC);

CREATE INDEX IF NOT EXISTS links_deleted_at_idx
  ON links (deleted_at);

CREATE INDEX IF NOT EXISTS links_status_updated_at_idx
  ON links (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS links_pinned_idx
  ON links (pinned DESC, updated_at DESC);

-- GIN index for fast tag filtering (tag = ANY(tags))
CREATE INDEX IF NOT EXISTS links_tags_gin_idx
  ON links USING GIN (tags);

-- GIN index for full-text search across title, host, and tags
CREATE INDEX IF NOT EXISTS links_fts_idx
  ON links USING GIN (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' ||
      coalesce(host,  '') || ' ' ||
      array_to_string(tags, ' ')
    )
  );

-- ────────────────────────────────────────────
-- Indexes — auth tables
-- ────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS sessions_expires_at_idx
  ON sessions (expires_at);

CREATE INDEX IF NOT EXISTS refresh_tokens_expires_at_idx
  ON refresh_tokens (expires_at);

CREATE INDEX IF NOT EXISTS refresh_tokens_user_revoked_idx
  ON refresh_tokens (user_id, revoked_at);
