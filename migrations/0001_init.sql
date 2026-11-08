-- Feedforward accounts and interactions. Codes and session tokens are stored only as SHA-256 hashes.
CREATE TABLE users (
  id TEXT PRIMARY KEY,                 -- public id, 10 chars
  code_hash TEXT NOT NULL UNIQUE,      -- sha256(pepper + code)
  name TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',     -- R2 key
  role TEXT NOT NULL DEFAULT 'user',   -- owner | admin | mod | contributor | user
  verified INTEGER NOT NULL DEFAULT 0, -- green check, from an owner or admin invite link
  ref_code TEXT NOT NULL UNIQUE,       -- this user's referral code
  referred_by TEXT,                    -- user id
  banned INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL
);
CREATE INDEX users_ref ON users(referred_by);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created INTEGER NOT NULL,
  seen INTEGER NOT NULL,
  device TEXT NOT NULL DEFAULT ''
);
CREATE INDEX sessions_user ON sessions(user_id);

-- Synced per-user state: history, saved, progress, days. One JSON blob per kind.
CREATE TABLE userdata (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  json TEXT NOT NULL,
  updated INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind)
);

-- item keys: v:<video> s:<short> p:<post> b:<book> r:<paper> l:<lab> d:<term>
CREATE TABLE likes (user_id TEXT NOT NULL, item TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (user_id, item));
CREATE INDEX likes_item ON likes(item);
CREATE TABLE ratings (user_id TEXT NOT NULL, item TEXT NOT NULL, stars INTEGER NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (user_id, item));
CREATE INDEX ratings_item ON ratings(item);

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  item TEXT NOT NULL,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  ts INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  reports INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX comments_item ON comments(item, ts);
CREATE TABLE reports (comment_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (comment_id, user_id));

-- Invite links made by the owner or admins. A verified invite gives the green check.
CREATE TABLE invites (
  code TEXT PRIMARY KEY,
  creator TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  uses INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER NOT NULL DEFAULT 0,  -- 0 = unlimited
  note TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL
);

-- Suggestions from contributors and everyone else: people, videos, books, papers, fixes. Admins approve.
CREATE TABLE suggestions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',  -- open | approved | declined
  ts INTEGER NOT NULL,
  decided_by TEXT
);

-- Moderation log: every role change, ban, hide and delete.
CREATE TABLE modlog (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, ts INTEGER NOT NULL);

-- Fixed-window rate limits.
CREATE TABLE rl (key TEXT PRIMARY KEY, n INTEGER NOT NULL, reset INTEGER NOT NULL);
