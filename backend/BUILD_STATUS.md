# Tratum continuation — 8 November 2026

Reviewed both Stratum Backend Architecture chats, the recent backend/platform work, the device/provisioning work, the saved end-to-end architecture and the recovered source. Tratum is the current product name.

## Completed in this continuation

- Recovered and integrated the signed device enrollment/upload/evidence API and bank SDK from the previous working folder.
- Added institution browser users, opaque session login/logout, institution-scoped overview/device/batch reads and the `/bank` workspace. Disabled/expired sessions and disabled institutions are rejected; bank sessions cannot authorize operator endpoints.
- Added the Tratum `/admin/network` overview, institution-user onboarding and current-status checks for operator permissions.
- Added an atomic outgoing webhook outbox for accepted device batches, encrypted endpoint secrets, HMAC signatures, leased concurrent workers, bounded retries and bank-visible delivery status. Public HTTPS targets must be explicitly allowed; redirects and private address destinations are rejected.
- Added a migration runner with checksums, serialized execution, per-migration transactions and a read-only planning mode, plus a GitHub CI workflow.
- Corrected nine legacy import paths to existing engines and Linux filename-case mismatches. All 161 backend source files parse. Eight legacy module references remain unresolved; see `legacy-source-audit.json`.
- Removed unconditional interbank liquidity approval. That legacy path now fails explicitly instead of declaring unbacked settlement.

## Verification

13 unit/route tests pass. The separate real-PostgreSQL integration suite passes with the native C++ encoder. It covers onboarding, proof of key possession, certificates, exact 64-bit nonces, concurrent uploads/retries, conflicts and rollback, bank isolation, sessions/logout/expiry/disablement, revoked operators, certificate expiry/revocation, webhook leasing/retry/HMAC verification and repeated migration application. Standard `npm run build` passes for the UI.

The webhook receiver transport is simulated in integration tests; no live bank endpoint was contacted. UI compilation is verified; visual browser interaction has not been verified. No production database migration or service restart was performed. GitHub hosted checks are a separate result from these local checks.

## Full-system completion remains blocked

The working control plane is not the completed financial system. Remaining work includes:

1. QSE payment-signature context and session-binding width consistency; atomic monetary recovery and physical power-failure tests.
2. The eight absent legacy modules, plus incompatible engine exports/contracts in the historical all-engine startup. Its WebSocket feed also relies on caller-selected roles and must be replaced with verified, tenant-scoped authorization before enabling it.
3. Actual interbank fund reservation, rail dispatch and independently established settlement finality; the system must not manufacture these from an upload acknowledgment.
4. Customer/device authorization, funded savings and provider-backed airtime/data fulfillment, reconciliation and refunds. Current feature endpoints only record requests.
5. Coordinated epoch/era lifecycle, key rotation/renewal, remaining firmware/keypad/phone-pairing work and physical secure-element/radio testing.
6. An explicit supervisory access mandate for central-bank users. They currently remain institution-scoped; only authorized Tratum operators receive the global network view.
7. Deployment service configuration and the NIGCOMSAT IP handoff. Banks connect to Tratum's APIs; an external bank API is not needed for the tested evidence flow.

The repository README contains the exact run instructions and API contracts. Existing production credentials and private keys are excluded from the source package. The test cluster uses disposable keys and isolated databases.
