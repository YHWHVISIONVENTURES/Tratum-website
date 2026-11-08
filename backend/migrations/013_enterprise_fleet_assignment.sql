ALTER TABLE device_registry ADD COLUMN IF NOT EXISTS enterprise_id VARCHAR(64) REFERENCES enterprise_accounts(enterprise_id);
ALTER TABLE device_registry ADD COLUMN IF NOT EXISTS enterprise_can_suspend BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS devices_canonical_id ON devices(lower(device_id));
CREATE UNIQUE INDEX IF NOT EXISTS device_registry_canonical_id ON device_registry(lower(device_id));
CREATE UNIQUE INDEX IF NOT EXISTS device_trust_canonical_id ON device_trust_state(lower(device_id));
CREATE INDEX IF NOT EXISTS device_registry_enterprise ON device_registry(enterprise_id);
