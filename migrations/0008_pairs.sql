-- Pairing codes. KV reaches other regions late, so a phone could be told no screen had a code the TV was showing.
CREATE TABLE IF NOT EXISTS pairs (
  code TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  device TEXT NOT NULL,
  check_no TEXT NOT NULL,
  at INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'waiting',
  uid TEXT,
  token TEXT
);
