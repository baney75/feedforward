-- Feedforward is invite-only. People without an invite apply; staff approve. The applicant's code is made at
-- apply time and stored hashed, so it signs them in the moment they're approved, with no email needed.
CREATE TABLE applications (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  links TEXT NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | denied
  created INTEGER NOT NULL,
  decided_by TEXT,
  decided INTEGER NOT NULL DEFAULT 0,
  user_id TEXT
);
CREATE INDEX applications_status ON applications(status, created);

-- Staff invites can carry permissions: a role and a teaching role for everyone who joins with them, and an
-- expiry. An inviter can only grant roles below their own (checked again when the invite is used).
ALTER TABLE invites ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE invites ADD COLUMN teach TEXT NOT NULL DEFAULT '';
ALTER TABLE invites ADD COLUMN expires INTEGER NOT NULL DEFAULT 0;
