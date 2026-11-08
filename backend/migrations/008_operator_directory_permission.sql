-- Institution managers need to read the directory their onboarding UI uses.
UPDATE admin_roles SET permissions=permissions || '["INSTITUTIONS_VIEW"]'::jsonb
 WHERE jsonb_typeof(permissions)='array'
 AND permissions ? 'INSTITUTIONS_MANAGE' AND NOT permissions ? 'INSTITUTIONS_VIEW';
