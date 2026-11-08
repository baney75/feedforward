-- Profile links (X, YouTube, Twitch, GitHub, Google Scholar, personal site, Bluesky, LinkedIn) and the X avatar.
-- An uploaded avatar always wins over the X one.
ALTER TABLE users ADD COLUMN links TEXT NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN avatar_x TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN avatar_x_ts INTEGER NOT NULL DEFAULT 0;
