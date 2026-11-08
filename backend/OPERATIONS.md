# Operations console

Frontend: backend/admin-ui. Run npm ci and npm run build. Set VITE_API_BASE_URL to the deployed API origin before building. Operator entry: /login. Institution credential entry: /bank. Configure the frontend host to serve index.html for application routes.

Backend: npm ci, then npm start runs the admin API; npm run start:workers runs the full worker/API process. Run only the intended worker deployment against each database. The public static website does not start the backend or workers.

Apply migrations with the deployment's migration process. Monitoring requires migrations/003_worker_observations.sql. The repository contains incremental migrations, not a complete fresh-install schema for the legacy ledger. An existing provisioned database is required. Never apply an empty schema and assume the ledger is ready.

Set ADMIN_JWT_SECRET and database connection settings through the deployment secret manager. ADMIN_UI_ORIGIN must include the frontend origin. Operator access requires existing admin_users/admin_roles records. OPS_VIEW grants global runtime observations. INSTITUTIONS_MANAGE grants institution creation and one-time API key issuance.

Institution API credentials exchange for a 30-minute in-memory browser session at POST /bank/v1/session. Every bank read reloads the active institution, derives its scope from the signed token and ignores client tenant selectors. This is credential-based institution access; named employee accounts and MFA are not implemented.

Worker monitoring reports scheduler heartbeat, running, rejected, returned and stale states. Existing workers may catch their own business errors, so a returned cycle is not proof of settlement success. Global runtime observations are restricted to OPS_VIEW and are not exposed in bank sessions. Database observations persist across worker restarts and identify hostname/process instances.

Production acceptance still requires deployment database migrations, bank A/B authorization tests against real PostgreSQL, configured rail adapters, and runtime observations from the actual worker host. API/UI compilation and unit tests do not establish those conditions.
