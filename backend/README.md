# Tratum control plane and device evidence API

This backend serves the operator network console, institution browser workspaces, authenticated bank APIs, device enrollment and signed delta evidence. `npm start` runs `src/admin-app.js`. The historical all-engine `src/app.js` remains incomplete and is not the supported deployment entry point.

## Run

1. Install Node.js 22+, PostgreSQL 18, and dependencies with `npm ci`.
2. Configure the database and secrets using `.env.example`. Use a dedicated application database. Set `PORTAL_ORIGIN` to the exact browser origin (scheme, hostname and port), and `ADMIN_UI_ORIGIN` to permitted operator origins. Set `NODE_ENV=production` behind HTTPS for production cookies.
3. Run `npm run db:plan` to inspect the migrations. Back up the target database, then run `npm run db:migrate`. Migration 000 bootstraps fresh installs; existing canonical platform tables are reused. Migrations 009–013 align the real schema and extend existing trust, license and regulator tables. The runner serializes migrations, records checksums, and applies each migration atomically. It never runs automatically on server startup.
4. Bootstrap an operator with `TRATUM_BOOTSTRAP_PASSWORD` in the process environment, then `node scripts/bootstrap-operator.js operator@example.com`. The script never overwrites an existing operator. Remove the bootstrap variable afterward.
5. In `admin-ui`, run `npm ci` and `npm run build`. Run `npm start` from the backend. The same server serves `/login`, `/admin/network`, `/admin/runtime`, and `/bank` when the UI build exists.
6. For local development, run the Vite UI on port 5173 and API on 3000; set `PORTAL_ORIGIN=http://localhost:5173`. Vite proxies `/admin` and `/portal` to the API.

## Identity and access

- Tratum operators use the existing operator JWT. Every protected request now reloads current operator status and permissions. Disabled users and removed permissions take effect immediately.
- An operator with `INSTITUTIONS_MANAGE` onboards a bank and receives its machine API key once. The database stores its hash. Machine API clients use the SDK's path/query-bound HMAC for V2 reads.
- The same operator creates bank browser users with `POST /admin/v2/institutions/:id/users`, or the institution page form. Use a 14-character minimum password, at most 72 UTF-8 bytes. Disable access with `PATCH /admin/v2/institution-users/:id/disable`.
- Bank users sign in at `/bank` using institution ID, email and password. Eight-hour opaque sessions are stored hashed; cookies are HttpOnly, SameSite Strict and Secure in production. Login and logout require the configured Origin. User and institution status are checked on every read. Session credentials do not authorize operator endpoints.
- Institution identity always comes from the stored credential/session. Caller-supplied institution IDs cannot widen bank reads. Central-bank institution accounts currently have the same tenant boundary; cross-bank supervisory access requires a separately approved access policy.
- Operator `/admin/v2/network` shows institution status, registered/active certificate counts, uploaded batch counts and webhook states. It is capped at the first 1,000 institutions; financial totals remain in the historical financial-engine endpoints.

## Provisioning and evidence

Use the operator-authorized, expiring enrollment challenge, proof of secure-element private-key possession, CA-signed V2 certificate, and signed `/device/v2/deltas` upload. `sdk/bankClient.js` and `sdk/verifyDeltaProof.js` let banks retrieve their own records and verify retained device evidence. Certificate expiry, revocation, cursor conflicts, duplicate retries and nonce reuse are checked in PostgreSQL transactions.

Acceptance is **evidence persistence**, with `financial_finality:false`. It does not attest that the historical payment signature context has been reconstructed, move funds, settle liabilities or replenish offline spending limits. Legacy unsigned enrollment/sync routes are disabled in the recovered changes.

## Outgoing webhooks

Set `WEBHOOK_ENCRYPTION_KEY` to a securely generated 32-byte key encoded as 64 lowercase hex characters. Keep the same key for decrypting existing endpoint secrets; key rotation requires re-encrypting/reconfiguring them. Set `WEBHOOK_ALLOWED_HOSTS` to an explicit comma-separated list of approved bank receiver hostnames.

Configure an institution endpoint as an authorized operator:

`PUT /admin/v2/institutions/:id/webhook` with `{ "url":"https://approved-bank-host/path", "secret":"at-least-32-characters" }`.

Only HTTPS on port 443 is permitted. Delivery rejects non-public IPv4 destinations, pins the DNS-validated address, checks TLS identity and does not follow redirects. IPv6-only receivers are currently unsupported. Secrets are encrypted at rest with AES-256-GCM and never returned. `DELETE` on the same endpoint pauses delivery. Disabled institutions are also paused.

Run `npm run worker:webhooks` as a separate supervised process. It records cycle observations for the operator infrastructure screen. Every new accepted batch for a configured, enabled endpoint queues exactly one event in the same database transaction. Exact upload retries do not enqueue extra events. Past batches are not automatically backfilled when adding an endpoint.

The worker uses database leases and `SKIP LOCKED`, bounded exponential retries, a ten-second HTTP timeout and ten attempts. A timeout or worker crash can lead to redelivery; receivers must persist event IDs and process idempotently. Failed events remain visible; automatic manual replay tooling is not implemented.

Headers: `X-Tratum-Event-Id`, `X-Tratum-Timestamp` (milliseconds), `X-Tratum-Signature` (`v1=` plus hex HMAC-SHA256 of `timestamp + '.' + raw_body`). Use `sdk/verifyWebhook.js` before parsing the body; then persist the event ID and processing outcome atomically. The verifier's five-minute window does not replace receiver deduplication. Return a 2xx response only after durable acceptance. Browser users see their own endpoint and last 100 events at `/bank`; no secret is exposed.

## Verification

`npm test` runs unit/route tests. `npm run test:e2e` needs a disposable loopback PostgreSQL cluster at 127.0.0.1:55439 with superuser `tratum_test` and trust authentication, plus `g++`. It creates and drops a uniquely named test database; it never targets the application database. Tests cover operator revocation, API-key onboarding, provisioning, C++/JS wire equivalence, signature tampering, concurrent uploads, cursor/nonce replay rollback, certificate expiry/revocation, bank isolation, session expiry/logout/disablement, webhook leasing/retry/signatures and repeated migration application. `TRATUM_FIRMWARE_PATH` can point to the actual firmware tree instead of the included native fixture.

Webhook tests exercise the real outbox, concurrency and signature generation with a simulated receiver transport. They do not establish delivery to a live bank HTTPS endpoint. The GitHub workflow runs these checks and the normal UI production build on Linux when pushed; local results are not a claim that hosted CI has already passed.

## Remaining financial work

The existing QSE code has inconsistent payment signing/verification contexts and a session-binding width mismatch; monetary state spans multiple NVS writes. These require a coordinated protocol change, recovery design and physical power-failure tests. The legacy interbank worker's unconditional liquidity approval now throws `INTERBANK_LIQUIDITY_RESERVATION_NOT_IMPLEMENTED` rather than marking unbacked settlements final. Savings and airtime/data APIs record institution-owned, idempotent requests only. Customer/device consent, actual fund reservations, provider catalogs/fulfillment/reconciliation/refunds, physical firmware integration of the implemented epoch/era protocol, remaining hardware/keypad flows and complete legacy engine startup are unfinished.

NIGCOMSAT has not supplied the IP handoff. The existing proposal is outbound device HTTPS through a local gateway and VSAT/router backhaul. Carrier setup is not required for local API tests, but physical link validation requires that handoff. No external bank transfer API is required to test Tratum's own bank-facing evidence APIs.


## Command centers and device lifecycle

See [COMMAND_CENTER.md](docs/COMMAND_CENTER.md) for the Tratum operator, central-bank supervisory and enterprise fleet roles, the V3 wire contract, safe existing-database rollout and known financial-engine blockers. The private partnership/fundraising Site is a separate application and links to this API console.
