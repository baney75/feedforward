-- Dislikes: private like YouTube's. They tune the viewer's own feed and the ranking; nobody sees a count.
CREATE TABLE dislikes (user_id TEXT NOT NULL, item TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (user_id, item));
CREATE INDEX dislikes_item ON dislikes(item);
-- Staff can turn an invite link off (and back on) without deleting it.
ALTER TABLE invites ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;
