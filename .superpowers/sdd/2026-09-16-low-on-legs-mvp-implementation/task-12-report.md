# Task 12 — Konteneryzacja, migracje i odzyskiwanie

## Zakres

- Dodano wieloetapowy `Dockerfile` dla Next.js, migratora i workera Elo.
- Dodano `compose.yaml` z PostgreSQL 18, jednorazowym migratorem, aplikacją i workerem oraz `compose.external.yaml` dla zewnętrznej bazy z konfiguracją TLS.
- Dodano kompilację runtime do `dist/src/...`, rewiring importów ESM i smoke test `/api/health`.
- Dodano transakcyjne, wersjonowane i idempotentne odzyskiwanie graczy, lig, meczów Elo/klasycznych oraz konkretnych rewizji meczu.
- Dodano CLI `dist/scripts/recover.js` z trybem dry-run i jawnym `--apply` oraz dokumentację operacyjną backupów, healthchecków, migracji i recovery.
- Dodano testy integracyjne przywracania meczu, starej rewizji, ligi i gracza.

## Weryfikacja

- `npm run test:unit` — 72/72.
- `npx vitest run tests/integration/recovery.test.ts` — 3/3 na tymczasowym PostgreSQL.
- Pełna integracja — 62/63 na tymczasowym PostgreSQL 17; jedyny wyjątek to istniejący test kolacji/normalizacji pseudonimu, zależny od różnicy środowiska PostgreSQL 17 vs wcześniejszy PostgreSQL 18.
- `npm run typecheck` — PASS.
- `npm run lint` — PASS.
- `npm run build` — PASS.
- `npm run build:runtime` — PASS; skompilowane entrypointy importują się przez Node ESM.
- `docker compose --env-file .env.example -f compose.yaml config` — PASS.

Docker Desktop nie uruchomił kontenera po zapełnieniu dysku podczas pobierania obrazu PostgreSQL; statyczna walidacja Compose i testy na tymczasowym PostgreSQL zostały wykonane, ale nie deklaruję pełnego smoke testu uruchomionego obrazu Docker.
