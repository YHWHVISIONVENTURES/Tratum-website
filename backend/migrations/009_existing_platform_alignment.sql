-- Align fresh installs with the real platform identity; never create a second ID.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='institutions' AND table_schema='public' AND column_name='id')
 AND NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='institutions' AND table_schema='public' AND column_name='institution_id') THEN
  ALTER TABLE institutions RENAME COLUMN id TO institution_id;
 END IF;
END $$;
ALTER TABLE admin_roles ADD COLUMN IF NOT EXISTS role_name TEXT;
UPDATE admin_roles SET role_name=role_code WHERE role_name IS NULL;
ALTER TABLE admin_roles ALTER COLUMN role_name SET NOT NULL;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS full_name TEXT;
UPDATE admin_users SET full_name=email WHERE full_name IS NULL;
ALTER TABLE admin_users ALTER COLUMN full_name SET NOT NULL;
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS country_code VARCHAR(3);
UPDATE institutions SET type=upper(type) WHERE upper(type) IN('BANK','CENTRAL_BANK','FINTECH','ENTERPRISE');
UPDATE institutions SET status=lower(status) WHERE lower(status) IN('active','disabled');
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_id TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS target_id TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';
DO $block$ BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='audit_log' AND table_schema='public' AND column_name='actor')
 AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='audit_log' AND table_schema='public' AND column_name='payload') THEN
  UPDATE audit_log SET actor_id=COALESCE(actor_id,actor),metadata=COALESCE(payload,metadata);
  EXECUTE $ddl$CREATE OR REPLACE FUNCTION public.tratum_audit_compatibility() RETURNS trigger LANGUAGE plpgsql AS $function$
   BEGIN
    NEW.actor_id:=COALESCE(NEW.actor_id,NEW.actor);NEW.actor:=COALESCE(NEW.actor,NEW.actor_id);
    IF NEW.metadata='{}'::jsonb AND NEW.payload IS NOT NULL THEN NEW.metadata:=NEW.payload; END IF;
    NEW.payload:=COALESCE(NEW.payload,NEW.metadata);RETURN NEW;
   END $function$$ddl$;
  DROP TRIGGER IF EXISTS tratum_audit_compatibility ON audit_log;
  CREATE TRIGGER tratum_audit_compatibility BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION public.tratum_audit_compatibility();
 END IF;
END $block$;
INSERT INTO admin_roles(role_code,role_name,permissions) VALUES('TRATUM_OPERATOR','Tratum Operator',
 '["OPS_VIEW","INSTITUTIONS_MANAGE","INSTITUTIONS_VIEW","DEVICE_ENROLL","TRUST_MANAGE","LICENSES_MANAGE","COMMERCIAL_MANAGE","TREASURY_VIEW","NODES_VIEW","SECURITY_VIEW","BILLING_VIEW","LOGS_VIEW"]')
 ON CONFLICT(role_code) DO UPDATE SET permissions=(SELECT jsonb_agg(DISTINCT item) FROM jsonb_array_elements(admin_roles.permissions || EXCLUDED.permissions) item);
UPDATE admin_roles SET permissions=(SELECT jsonb_agg(DISTINCT item) FROM jsonb_array_elements(admin_roles.permissions || '["TRUST_MANAGE","LICENSES_MANAGE","INSTITUTIONS_MANAGE","INSTITUTIONS_VIEW","DEVICE_ENROLL","OPS_VIEW"]'::jsonb) item)
 WHERE role_code='SUPER_ADMIN' AND jsonb_typeof(permissions)='array';
