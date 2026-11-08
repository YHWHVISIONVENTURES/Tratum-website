-- Extend the existing identity, trust, certificate and history models.
CREATE TABLE IF NOT EXISTS devices(id BIGSERIAL PRIMARY KEY,device_id VARCHAR(16) NOT NULL UNIQUE,public_key TEXT,issuer_id TEXT,status VARCHAR(20) DEFAULT 'ACTIVE',last_seen TIMESTAMP DEFAULT now(),created_at TIMESTAMP DEFAULT now());
CREATE TABLE IF NOT EXISTS device_registry(id BIGSERIAL PRIMARY KEY,device_id VARCHAR(16) NOT NULL UNIQUE,alias TEXT,issuer_id TEXT,deployment_class TEXT DEFAULT 'RETAIL',certificate_hash TEXT NOT NULL,certificate_signature TEXT NOT NULL,status TEXT DEFAULT 'ACTIVE',created_at TIMESTAMP DEFAULT now(),updated_at TIMESTAMP DEFAULT now(),geo_code VARCHAR(20));
CREATE TABLE IF NOT EXISTS device_trust_state(device_id VARCHAR(16) PRIMARY KEY,attestation_status VARCHAR(20) NOT NULL DEFAULT 'UNVERIFIED',attestation_token TEXT,token_issued_at BIGINT,token_expiry BIGINT,last_attested_at BIGINT,firmware_hash TEXT,secure_boot BOOLEAN DEFAULT false,key_epoch BIGINT DEFAULT 0,attested_public_key TEXT,trust_score INTEGER DEFAULT 100,failure_count INTEGER DEFAULT 0,last_failure_reason TEXT,updated_at TIMESTAMP DEFAULT now());
CREATE TABLE IF NOT EXISTS device_key_history(id BIGSERIAL PRIMARY KEY,device_id VARCHAR(16) NOT NULL,old_public_key TEXT,new_public_key TEXT NOT NULL,rotated_at TIMESTAMP DEFAULT now(),rotated_by TEXT);
CREATE TABLE IF NOT EXISTS certificate_records(id BIGSERIAL PRIMARY KEY,device_id VARCHAR(16) NOT NULL,certificate_hash TEXT NOT NULL,signature TEXT NOT NULL,issued_at BIGINT NOT NULL,expiry_at BIGINT NOT NULL,status VARCHAR(20) DEFAULT 'ACTIVE',revoked_at BIGINT,revoked_reason TEXT,replaced_by TEXT,created_at TIMESTAMP DEFAULT now(),public_key TEXT,issuer_id TEXT,certificate_body JSONB,root_ca_version TEXT);
CREATE TABLE IF NOT EXISTS sync_state(id BIGSERIAL PRIMARY KEY,device_id VARCHAR(16),last_known_index INTEGER,updated_at TIMESTAMP DEFAULT now(),key TEXT,value TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS sync_state_global_key ON sync_state(key) WHERE key IS NOT NULL;
INSERT INTO sync_state(key,value) VALUES('TRATUM_TRUST_ERA','{"era_no":0,"reason":"Initial trust era"}') ON CONFLICT(key) WHERE key IS NOT NULL DO NOTHING;
ALTER TABLE device_trust_state ADD COLUMN IF NOT EXISTS era_no BIGINT NOT NULL DEFAULT 0;
ALTER TABLE device_trust_state ADD COLUMN IF NOT EXISTS active_key_slot SMALLINT CHECK(active_key_slot IN(0,1));
ALTER TABLE device_trust_state ADD COLUMN IF NOT EXISTS lifecycle_observed_at TIMESTAMPTZ;
ALTER TABLE device_sync_registry_v2 ADD COLUMN IF NOT EXISTS era_no BIGINT NOT NULL DEFAULT 0;
ALTER TABLE device_sync_registry_v2 ADD COLUMN IF NOT EXISTS active_key_slot SMALLINT NOT NULL DEFAULT 0 CHECK(active_key_slot IN(0,1));
ALTER TABLE device_key_history ADD COLUMN IF NOT EXISTS transition_id UUID UNIQUE;
ALTER TABLE device_key_history ADD COLUMN IF NOT EXISTS transition_kind TEXT CHECK(transition_kind IN('ROTATE','ACK_ERA','RENEW'));
ALTER TABLE device_key_history ADD COLUMN IF NOT EXISTS transition_status TEXT NOT NULL DEFAULT 'LEGACY' CHECK(transition_status IN('LEGACY','PENDING','COMMITTED','CANCELLED'));
ALTER TABLE device_key_history ADD COLUMN IF NOT EXISTS challenge TEXT;
ALTER TABLE device_key_history ADD COLUMN IF NOT EXISTS old_epoch BIGINT;
ALTER TABLE device_key_history ADD COLUMN IF NOT EXISTS new_epoch BIGINT;
ALTER TABLE device_key_history ADD COLUMN IF NOT EXISTS old_slot SMALLINT;
ALTER TABLE device_key_history ADD COLUMN IF NOT EXISTS new_slot SMALLINT;
ALTER TABLE device_key_history ADD COLUMN IF NOT EXISTS era_no BIGINT;
ALTER TABLE device_key_history ADD COLUMN IF NOT EXISTS expected_index BIGINT;
ALTER TABLE device_key_history ADD COLUMN IF NOT EXISTS expected_root TEXT;
ALTER TABLE device_key_history ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE device_key_history ADD COLUMN IF NOT EXISTS signed_payload BYTEA;
ALTER TABLE device_key_history ADD COLUMN IF NOT EXISTS old_signature TEXT;
ALTER TABLE device_key_history ADD COLUMN IF NOT EXISTS new_signature TEXT;
ALTER TABLE device_key_history ADD COLUMN IF NOT EXISTS certificate_body JSONB;
CREATE INDEX IF NOT EXISTS device_key_history_device_epoch ON device_key_history(device_id,new_epoch,era_no);
-- Old devices are inventoried without inventing attestation or a reported physical slot.
INSERT INTO device_trust_state(device_id,attestation_status,attested_public_key)
 SELECT device_id,'UNVERIFIED',public_key FROM devices ON CONFLICT(device_id) DO NOTHING;
