CREATE TABLE IF NOT EXISTS institution_webhook_endpoints (
 institution_id TEXT PRIMARY KEY,
 url TEXT NOT NULL,
 secret_ciphertext TEXT NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT true,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS institution_webhook_outbox (
 event_id TEXT PRIMARY KEY,
 institution_id TEXT NOT NULL,
 payload JSONB NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','DELIVERING','DELIVERED','FAILED')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 lease_token TEXT,
 leased_until TIMESTAMPTZ,
 last_http_status INTEGER,
 delivered_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS institution_webhook_due ON institution_webhook_outbox(next_attempt_at) WHERE status IN ('PENDING','DELIVERING');
CREATE INDEX IF NOT EXISTS institution_webhook_tenant ON institution_webhook_outbox(institution_id,created_at);
