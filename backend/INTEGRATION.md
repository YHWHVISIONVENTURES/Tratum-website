# Combined command-center integration

Merged the backend/bank-workspace-and-device-evidence history into backend/institution-platform. The persisted institution portal and role-scoped command center supersede the earlier bank JWT prototype. Existing public website edits remain outside this merge.

Preserved scheduler observations for the 13 registered legacy worker loops and the signed durable webhook delivery implementation. Registered workers without observations appear explicitly; cycle-returned is distinguished from financial finality. Financial-engine activation remains subject to BUILD_STATUS.md and ENGINE_SCHEMA_AUDIT.json.

Validation of the combined source: 28 Node checks passed; one PostgreSQL/native integration test was skipped because its isolated cluster was not started in this chat. All worker JavaScript syntax checks and the locked Vite 8 production build passed. No production migration, worker activation or deployment is performed by this merge.
