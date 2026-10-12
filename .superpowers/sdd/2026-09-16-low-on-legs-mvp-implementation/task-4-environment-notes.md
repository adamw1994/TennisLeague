# Preflight notes for player UI and avatar task

Read task-4-brief.md and shared-requirements.md as requirements; these notes only connect prepared tooling.

- environment.md records working Docker PostgreSQL and Chromium paths. A separate empty low_on_legs_e2e_test database is ready. Implement actual E2E migration/setup and app lifecycle in this task; never point browser reset at integration/public production data.
- Task2 owns transport guards/validation/logging/rate-limit helpers; consume their actual interfaces and report. The ledger explicitly assigns browser token lifetime to the real forms starting here. Persist tokens across uncertain network failures; don't accidentally start a new create after an unacknowledged successful request.
- Sport schema-drift check runs every registered migration. New entities/migrations must remain aligned; don't remove the check to accommodate missing metadata.
- Installed sharp typings include `.timeout({ seconds })` at node_modules/sharp/lib/index.d.ts around886, documented to stop processing after a finite budget. Its clock excludes time waiting for a libuv thread, so separate bounded decoder admission is still needed. A Promise.race timeout alone doesn't prove native decoding stopped.
- For npm/Playwright commands on Windows, environment.md records PATH and sandbox spawn restrictions. Use hidden background app processes and clean shutdown of processes you own.
- No implementation of later league/statistics features here; their counts are zero until relationships exist as the brief states.
- Critical Task2 handoff: raw em.getConnection().execute must receive tx.getTransactionContext() as argument4 to participate in the transaction. Use inMutationTransaction from shared/mutation.ts and once from shared/idempotency.ts inside services; consumeLimit outside resource transaction before costly parsing/decode. Read task-2-report.md interface/call-order section.
