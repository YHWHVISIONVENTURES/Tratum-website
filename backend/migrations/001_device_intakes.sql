CREATE TABLE IF NOT EXISTS device_intakes (
  id BIGSERIAL PRIMARY KEY,
  serial_number TEXT NOT NULL UNIQUE,
  customer_ref TEXT NOT NULL,
  institution_id TEXT,
  status TEXT NOT NULL DEFAULT 'INTAKE_RECORDED'
    CHECK (status IN ('INTAKE_RECORDED', 'DEVICE_PROVISIONED', 'CUSTOMER_PAIRED', 'CANCELLED')),
  created_by_admin_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS device_intakes_created_at_idx
  ON device_intakes (created_at DESC);
CREATE INDEX IF NOT EXISTS device_intakes_customer_ref_idx
  ON device_intakes (customer_ref);
