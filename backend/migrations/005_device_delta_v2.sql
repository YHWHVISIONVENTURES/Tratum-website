-- Additive evidence intake. These tables never authorize a debit or bank settlement.
CREATE TABLE IF NOT EXISTS device_enrollment_challenges_v2 (
 challenge TEXT PRIMARY KEY CHECK(length(challenge)=64),
 device_id TEXT NOT NULL CHECK(length(device_id)=16),
 public_key TEXT NOT NULL CHECK(length(public_key)=128),
 institution_id TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 consumed_at TIMESTAMPTZ,
 created_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS device_sync_registry_v2 (
 device_id TEXT PRIMARY KEY CHECK(length(device_id)=16),
 public_key TEXT NOT NULL CHECK(length(public_key)=128),
 institution_id TEXT NOT NULL,
 key_epoch BIGINT NOT NULL DEFAULT 0 CHECK(key_epoch BETWEEN 0 AND 4294967295),
 status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUSPENDED','REVOKED')),
 certificate JSONB NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 next_index BIGINT NOT NULL DEFAULT 0 CHECK(next_index BETWEEN 0 AND 4294967295),
 sync_root TEXT NOT NULL DEFAULT repeat('0',64) CHECK(length(sync_root)=64)
);
CREATE TABLE IF NOT EXISTS device_delta_batches_v2 (
 batch_id TEXT PRIMARY KEY CHECK(length(batch_id)=64),
 device_id TEXT NOT NULL REFERENCES device_sync_registry_v2(device_id),
 institution_id TEXT NOT NULL,
 from_index BIGINT NOT NULL,
 next_index BIGINT NOT NULL,
 previous_root TEXT NOT NULL,
 sync_root TEXT NOT NULL,
 signed_payload BYTEA NOT NULL,
 signature BYTEA NOT NULL CHECK(octet_length(signature)=64),
 certificate JSONB NOT NULL,
 received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(device_id,from_index)
);
CREATE TABLE IF NOT EXISTS device_delta_records_v2 (
 device_id TEXT NOT NULL REFERENCES device_sync_registry_v2(device_id),
 ledger_index BIGINT NOT NULL,
 institution_id TEXT NOT NULL,
 batch_id TEXT NOT NULL REFERENCES device_delta_batches_v2(batch_id),
 record_hash TEXT NOT NULL,
 sender_id TEXT NOT NULL,
 nonce NUMERIC(20,0) NOT NULL CHECK(nonce BETWEEN 0 AND 18446744073709551615),
 summary JSONB NOT NULL,
 raw_record BYTEA NOT NULL CHECK(octet_length(raw_record)=176),
 PRIMARY KEY(device_id,ledger_index),
 UNIQUE(device_id,sender_id,nonce),
 UNIQUE(device_id,record_hash)
);
CREATE INDEX IF NOT EXISTS device_delta_batches_tenant_v2
 ON device_delta_batches_v2(institution_id,received_at,batch_id);
CREATE TABLE IF NOT EXISTS device_provision_audit_v2 (
 id BIGSERIAL PRIMARY KEY,
 actor_id TEXT NOT NULL,
 action TEXT NOT NULL,
 device_id TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
