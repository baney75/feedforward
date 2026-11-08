-- People added by admins at runtime. The cron starts following them at once; the next full build backfills them.
CREATE TABLE people_extra (
  n INTEGER PRIMARY KEY AUTOINCREMENT,   -- person index on the site is 10000 + n
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  topic TEXT NOT NULL,
  why TEXT NOT NULL,
  yt TEXT NOT NULL DEFAULT '',           -- handle like @name
  yt_id TEXT NOT NULL DEFAULT '',        -- UC... channel id, resolved when added
  x TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'ai',       -- all | ai
  av TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  added_by TEXT NOT NULL,
  created INTEGER NOT NULL
);

-- OAuth 2.1 for the personal connector (claude.ai, ChatGPT). Public clients with PKCE only.
CREATE TABLE oauth_clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, redirect_uris TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  challenge TEXT NOT NULL,
  scope TEXT NOT NULL,
  expires INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
