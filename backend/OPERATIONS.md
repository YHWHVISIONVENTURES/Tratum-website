# Integrated platform entry points

The maintained control plane is src/admin-app.js. It serves the compiled frontend and institution portal APIs. See README.md and docs/COMMAND_CENTER.md for configuration, migrations and persisted role scopes.

Operator console: /admin/network. Runtime monitoring: /admin/runtime. Institution access: /bank or /institution. Enterprise fleets: /enterprise. Supervisory institutions: /central-bank. Those pages share the persisted, cookie-based institution session system. The older API-key-to-JWT bank prototype was removed during integration.

Worker scheduler observations remain integrated for 13 legacy scheduled workers, with the separately deployed outgoing webhook worker reporting webhook-delivery cycles. Waiting, running, returned, failed and stale are monitoring states, not settlement confirmation. Missing catalog workers are shown as unobserved. Do not enable the legacy financial worker bundle solely to populate this page; the engine/schema audit identifies remaining monetary blockers.

The private partnership command Site remains a separate business workspace. It is not merged into the bank or regulatory authorization scope.

Verification of this combined branch must be distinguished from previous isolated PostgreSQL test results. Production credentials, CA material and database backups are excluded from this repository. This integration does not change production schemas or start financial workers.
