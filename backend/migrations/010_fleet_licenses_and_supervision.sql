CREATE TABLE IF NOT EXISTS enterprise_accounts(enterprise_id VARCHAR(64) PRIMARY KEY,name TEXT NOT NULL,active BOOLEAN DEFAULT true,created_at TIMESTAMP DEFAULT now());
ALTER TABLE enterprise_accounts ADD COLUMN IF NOT EXISTS institution_id BIGINT UNIQUE REFERENCES institutions(institution_id);
ALTER TABLE enterprise_accounts ADD COLUMN IF NOT EXISTS license_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(license_status IN ('PENDING','ACTIVE','SUSPENDED','EXPIRED'));
ALTER TABLE enterprise_accounts ADD COLUMN IF NOT EXISTS license_expires_at TIMESTAMPTZ;
ALTER TABLE enterprise_accounts ADD COLUMN IF NOT EXISTS node_limit INTEGER NOT NULL DEFAULT 0 CHECK(node_limit>=0);
ALTER TABLE enterprise_accounts ADD COLUMN IF NOT EXISTS licensed_products JSONB NOT NULL DEFAULT '[]';
CREATE TABLE IF NOT EXISTS regulator_directory(id BIGSERIAL PRIMARY KEY,regulator_code VARCHAR(32) NOT NULL UNIQUE,regulator_name TEXT NOT NULL,country_code VARCHAR(3) NOT NULL,regulator_type VARCHAR(40),active BOOLEAN DEFAULT true,metadata JSONB,created_at TIMESTAMP DEFAULT now());
ALTER TABLE regulator_directory ADD COLUMN IF NOT EXISTS institution_id BIGINT UNIQUE REFERENCES institutions(institution_id);
ALTER TABLE institution_users ADD COLUMN IF NOT EXISTS access_role TEXT NOT NULL DEFAULT 'VIEWER' CHECK(access_role IN ('VIEWER','FLEET_OPERATOR','SUPERVISOR'));
