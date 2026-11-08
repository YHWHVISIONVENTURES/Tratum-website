# Tratum command centers and trust lifecycle

The supported control plane is src/admin-app.js. It uses the existing institutions, devices, device_registry, device_trust_state, device_key_history, certificate_records, enterprise_accounts, regulator_directory and sync_state models. It does not start the historical financial-worker bundle.

## Operating surfaces

- /admin/network: Tratum operator overview, fleet, trust history, provisioning handoff, era policy, key transition/renewal handoff, enterprise licenses, supervisory mandates and fleet delegation.
- /central-bank: institution login and persisted country-scoped supervisory access. SUPERVISOR is read-only. A central-bank institution needs an explicit regulator_directory mandate; its title alone grants no global visibility.
- /enterprise: institution login and licensed fleet scope. VIEWER reads; FLEET_OPERATOR may suspend its own nodes or delegated nodes with explicit suspension authority. Issuance ownership is preserved during enterprise fleet assignment. License expiry, products and node caps are enforced server-side.
- /bank and /institution: same institution authentication and scoped operational view.
- /admin/runtime: observed control-plane health and worker cycles. Source/schema inventory does not establish monetary readiness.

Operator actions reload active account permissions on every request. Browser sessions use an opaque cookie scoped to /portal; mutation checks require the configured exact browser origin. Existing passwords and institution API keys are preserved.

## V3 device protocol

Enrollment uses the existing V2 possession challenge and mirrors the stable device identity into the legacy registry/trust models. Never infer firmware attestation from an enrollment, upload or state signature. Legacy unknown slots remain unknown until explicitly established.

POST /admin/v3/devices/:deviceId/transitions prepares an operator-authorized ROTATE, ACK_ERA or RENEW request. ROTATE selects the inactive slot and next epoch; ACK_ERA retains the key/slot/epoch while acknowledging a newer network era; RENEW retains the current key and can recover an expired certificate. Revoked/suspended devices cannot transition. Renewal does not prove firmware integrity.

The transition signing payload is 270 bytes, with all integers little-endian:

| Field | Bytes |
| --- | ---: |
| domain TRATUM-TRUST-V3 followed by NUL padding | 16 |
| stable device ID | 8 |
| challenge | 32 |
| old epoch, new epoch | 4 each |
| old slot, new slot | 1 each |
| current network era, expected next upload index | 4 each |
| expected upload root | 32 |
| old public key, new public key (P-256 X followed by Y) | 64 each |
| SHA-256 of institution ID UTF-8 | 32 |
| expiry Unix seconds | 4 |

POST /device/v3/trust/transitions/:transitionId/commit requires old_signature and new_signature, each 64-byte IEEE-P1363 P-256/SHA-256 over exactly the payload. Both proofs, checkpoint, era, expiry, current key and license are checked within the transaction. Native test code agrees byte-for-byte with the server. Successful commit writes a CA-signed V3 certificate with stable ID, epoch, slot and era and updates certificate lineage atomically. Exact retries return the same current certificate; superseded receipts are rejected. Attestation is invalidated after a transition.

POST /admin/v3/trust/era takes expected_era and a recorded reason. The compare-and-set policy update is audited and signed by the configured existing CA. GET /device/v3/trust/era returns that policy. Advancing it blocks older-era device uploads and wired financial trust checks until the device commits acknowledgment.

POST /device/v3/state accepts device_id, key_epoch, era_no, active_key_slot, counter (decimal string), timestamp (Unix seconds) and signature. Its 45-byte payload is domain TRATUM-STATE-V3 with NUL padding to 16 bytes, ID8, epoch4, era4, slot1, counter8, timestamp4. Counters preserve all uint64 values. State must match the current registry key/lifecycle and be within five minutes. Exact retry does not refresh liveness; reused counters with different content are rejected. A signed state report never sets VERIFIED attestation.

GET /admin/v3/devices/:id/history returns safe trust state, transition and certificate history. POST /admin/v3/devices/:id/resume requires trust-management permission; it only resumes suspended devices and requires renewed attestation. Revocation is permanent through this interface. No control-plane operation claims that an offline physical node instantly received a command.

## Existing database rollout

Build admin-ui before starting the server. Back up and migrate the existing database with scripts/backup-and-migrate.js --env-file ABSOLUTE_EXISTING_ENV --backup ABSOLUTE_NEW_DUMP. This verifies a full custom-format pg_dump archive before applying serialized migrations. It refuses duplicate canonical device IDs/sync keys. Backups contain operational data and stay outside source control. No financial worker is started by this tool.

Use npm run start:local -- --env-file ABSOLUTE_EXISTING_ENV --ca-key-file ABSOLUTE_MATCHING_CA_KEY --ca-public-file ABSOLUTE_MATCHING_PUBLIC_KEY for loopback HTTP on port3000. Secret files stay external. This is a development launcher; production requires HTTPS, correct origins and supervised processes. A localhost link on the private Site opens the server on the viewer's own computer and is not hosted API deployment.

## Verification and boundaries

npm test; npm run test:e2e; TRATUM_TEST_LEGACY_SCHEMA=1 npm run test:e2e. The suite uses a uniquely named disposable database on port55439. TRATUM_E2E_SCHEMA_FILE may supply a complete schema-only snapshot to verify compatibility. Tests cover tenant/supervisory/enterprise scope, quotas/products, native bytes, signed state/replay, rotation, checkpoint races, certificate renewal, revocation, attestation invalidation, outgoing webhook leasing and migrations. Native ABI tests do not establish physical secure-element/NVS recovery correctness.

The treasury, fees, revenue, tax, FX, settlement, payout, reconciliation, sovereign/CBDC and stablecoin engines already exist. Remaining work is integration and correctness verification. A read-only PREPARE audit of160 static SQL statements found18 schema/query failures, including billing settlement_history, corridor metrics, FX exposure, liquidity-lock fields/placeholders, transaction economic fields, netting snapshots and settlement bridge SQL. Dynamic SQL, balance invariants and external rail behavior require additional tests. Eight unresolved historical imports and caller-selected WebSocket roles also prevent enabling the old all-engine startup safely. Do not create duplicate ledgers to hide these mismatches.

Before monetary workers are enabled, align those engines to the canonical schema, enforce exact monetary arithmetic and transactional reservations, verify replay/concurrency and double-entry invariants, integrate approved rail/provider contracts and independently reconcile finality/refunds. Savings/airtime/data feature requests currently persist intent; they do not constitute funded/fulfilled products. Hardware still needs the actual V3 handshake/certificate installation, atomic NVS recovery, corrected payment-signature context/session width, and physical power-failure/radio tests. NIGCOMSAT carrier handoff remains external.
