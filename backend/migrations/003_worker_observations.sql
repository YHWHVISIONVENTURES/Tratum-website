CREATE TABLE IF NOT EXISTS worker_observations (
 worker_name TEXT NOT NULL,
 instance_id TEXT NOT NULL,
 last_started_at TIMESTAMPTZ,
 last_finished_at TIMESTAMPTZ,
 last_outcome TEXT CHECK (last_outcome IN ('completed','failed')),
 observed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(worker_name,instance_id)
);
