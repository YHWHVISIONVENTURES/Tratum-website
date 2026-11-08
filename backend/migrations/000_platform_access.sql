-- Minimal access schema for a fresh installation. Existing tables are left intact.
CREATE TABLE IF NOT EXISTS institutions (
 id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL,
 api_key TEXT NOT NULL UNIQUE,public_key TEXT,status TEXT NOT NULL DEFAULT 'active',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS admin_roles (
 role_code TEXT PRIMARY KEY,permissions JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE TABLE IF NOT EXISTS admin_users (
 id BIGSERIAL PRIMARY KEY,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,
 role_code TEXT NOT NULL REFERENCES admin_roles(role_code),status TEXT NOT NULL DEFAULT 'ACTIVE',
 last_login TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS audit_log (
 id BIGSERIAL PRIMARY KEY,actor_id TEXT,action TEXT NOT NULL,target_id TEXT,
 metadata JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO admin_roles(role_code,permissions)
 VALUES('TRATUM_OPERATOR','["OPS_VIEW","INSTITUTIONS_MANAGE","DEVICE_ENROLL"]'::jsonb)
 ON CONFLICT(role_code) DO NOTHING;
