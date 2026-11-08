-- Browser identities are separate from machine API credentials and operator roles.
CREATE TABLE IF NOT EXISTS institution_users (
 id BIGSERIAL PRIMARY KEY,
 institution_id TEXT NOT NULL,
 email TEXT NOT NULL CHECK(email=lower(email)),
 password_hash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','DISABLED')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(institution_id,email)
);
CREATE TABLE IF NOT EXISTS institution_sessions (
 token_hash TEXT PRIMARY KEY,
 user_id BIGINT NOT NULL REFERENCES institution_users(id) ON DELETE CASCADE,
 expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS institution_sessions_expiry ON institution_sessions(expires_at);
