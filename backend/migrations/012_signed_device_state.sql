ALTER TABLE device_trust_state ADD COLUMN IF NOT EXISTS last_state_epoch BIGINT;
ALTER TABLE device_trust_state ADD COLUMN IF NOT EXISTS last_state_counter NUMERIC(20,0) CHECK(last_state_counter BETWEEN 0 AND 18446744073709551615);
ALTER TABLE device_trust_state ADD COLUMN IF NOT EXISTS last_state_hash TEXT;
ALTER TABLE device_trust_state ADD COLUMN IF NOT EXISTS last_state_body JSONB;
ALTER TABLE device_trust_state ADD COLUMN IF NOT EXISTS last_state_received_at TIMESTAMPTZ;
