-- These are requests only. No balance is reserved, moved or credited by this table.
CREATE TABLE IF NOT EXISTS device_feature_requests (
 id UUID PRIMARY KEY,
 institution_id TEXT NOT NULL,
 device_id TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('savings_goal','airtime','data')),
 payload JSONB NOT NULL,
 status TEXT NOT NULL DEFAULT 'AWAITING_CUSTOMER_AUTHORIZATION'
  CHECK(status='AWAITING_CUSTOMER_AUTHORIZATION'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(institution_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS device_feature_requests_device
 ON device_feature_requests(institution_id,device_id,created_at DESC);
