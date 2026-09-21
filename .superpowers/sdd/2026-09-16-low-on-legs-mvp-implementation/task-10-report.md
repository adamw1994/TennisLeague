# Task 10 — raport implementacji

Status: DONE w working tree.

## Zakres

- ranking Elo i status obliczeń są odczytywane jako spójny snapshot publikacji w izolacji `REPEATABLE READ`;
- `GET /api/leagues/:leagueId/elo-status` zwraca rewizje i stan z `Cache-Control: no-store`;
- ranking i lista meczów pokazują stan `CURRENT`, `STALE` albo `PENDING`;
- szczegóły meczu zachowują bieżący wynik, wskazują wersję używaną przez poprzednie obliczenie i nie pokazują liczb Elo dla nieaktualnego składu;
- dodano polling `EloStatus` tylko dla widocznego komponentu, z abortowaniem, cleanupem i ochroną przed nakładającymi się żądaniami;
- dodano korektę stron/wyniku meczu Elo oraz potwierdzane soft-delete z rewalidacją widoków;
- ranking zachowuje usuniętych graczy, miejsca remisowe i dane publikacji.

## Weryfikacja

- `npm run test:unit` — 70/70;
- `npm run test:integration` — 58/58;
- `npm run typecheck` — PASS;
- `npx tsc -p tsconfig.worker.json --noEmit` — PASS;
- `npm run lint` — PASS;
- `npm run build` — PASS.

E2E pozostaje zależne od lokalnego executable Chromium Playwrighta; poprzednia próba była zablokowana przez brak pliku przeglądarki, nie przez błąd aplikacji.
