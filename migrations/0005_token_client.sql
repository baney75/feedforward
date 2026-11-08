-- Connector tokens remember which OAuth client made them, so reconnecting an app replaces only its own token.
ALTER TABLE api_tokens ADD COLUMN client_id TEXT;
CREATE UNIQUE INDEX api_tokens_client ON api_tokens(user_id, client_id) WHERE client_id IS NOT NULL;
