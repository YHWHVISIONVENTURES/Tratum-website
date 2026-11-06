CREATE TABLE IF NOT EXISTS institution_webhook_events (
  institution_id text NOT NULL,
  event_id text NOT NULL,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (institution_id, event_id)
);
