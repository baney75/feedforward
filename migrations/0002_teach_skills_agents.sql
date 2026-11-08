-- Teaching roles sit beside moderation roles: a professor can also be a mod, for example.
ALTER TABLE users ADD COLUMN teach TEXT NOT NULL DEFAULT '';   -- '' | tutor | professor

-- Live sessions hosted by professors and tutors.
CREATE TABLE sessions_live (
  id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  title TEXT NOT NULL,
  about TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL DEFAULT '',
  starts INTEGER NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 60,
  link TEXT NOT NULL,              -- https only
  capacity INTEGER NOT NULL DEFAULT 0,
  cancelled INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL
);
CREATE INDEX sessions_live_starts ON sessions_live(starts);
CREATE TABLE rsvps (session_id TEXT NOT NULL, user_id TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (session_id, user_id));

-- Shared agent skills (SKILL.md). Listed only after staff approve them. Always shown as plain text.
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  body TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | declined
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  reviewed_by TEXT
);
CREATE INDEX skills_status ON skills(status, updated);

-- Personal access tokens for agents (MCP and CLI). Stored hashed; shown once.
CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'read',  -- read | write
  created INTEGER NOT NULL,
  last_used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX api_tokens_user ON api_tokens(user_id);
