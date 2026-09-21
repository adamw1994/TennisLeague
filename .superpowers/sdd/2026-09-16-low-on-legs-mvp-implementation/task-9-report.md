# Task 9 — raport implementacji

Status: DONE w working tree.

## Zakres

- korekta i soft delete wyniku meczu Elo z optimistic locking, pełnym `MatchRevision`, zachowaniem czasu rozegrania i snapshotu K;
- kolejka najnowszej rewizji z częściowym unikalnym indeksem ligi, koalescencją zmian i ochroną aktywnego lease;
- worker Elo: claim z `FOR UPDATE SKIP LOCKED`, fenced lease, heartbeat, snapshot `REPEATABLE READ`, czysty replay poza transakcją, atomowa publikacja oraz retry/backoff;
- obsługa nieaktualnego snapshotu, usuniętej ligi, utraty lease i pięciu nieudanych prób;
- `runOnce`, pętla procesu, JSON logi i plik heartbeat `/tmp/elo-worker-health`;
- testy korekty, publikacji, stale snapshotu, `runOnce`, usuniętej ligi, wyścigu claimów i retry.

## Weryfikacja

- `npm run test:unit` — 70/70;
- `npm run test:integration` — 55/55;
- `npx vitest run tests/integration/elo-worker.test.ts tests/integration/elo-races.test.ts` — 6/6;
- `npm run typecheck` — PASS;
- `npx tsc -p tsconfig.worker.json --noEmit` — PASS;
- `npm run lint` — PASS;
- `npm run build` — PASS;
- test migracji/schema drift — PASS.

Pełne E2E nie zostało ponownie zaliczone w tej sesji, ponieważ lokalny Playwright wskazywał brak executable Chromium; nie jest to błąd implementacji worker’a.
