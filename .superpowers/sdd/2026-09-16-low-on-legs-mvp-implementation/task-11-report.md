# Task 11 — Profile, statystyki i pełna nawigacja

## Zakres

- Dodano czyste agregowanie `PlayerStats` z pełnym wynikiem strony dla każdego partnera deblowego.
- Dodano odczyty statystyk gracza, historii, rankingów Elo per liga, overview ligi, ostatnich wyników oraz listy lig gracza.
- Rozszerzono listy graczy, lig i meczów o wyszukiwanie, filtry oraz stabilne kursory paginacji.
- Rozbudowano stronę główną, profil gracza, szczegóły ligi i historię meczów.
- Dodano komunikaty `not-found`/`error`, semantyczne tabele/karty mobilne, etykiety filtrów, statusy i formatowanie daty dla `Europe/Warsaw`.
- Profile usuniętych graczy zachowują historię, natomiast usunięte ligi są wykluczone z globalnych odczytów.

## Weryfikacja

- `npm run test:unit` — 72/72.
- `TEST_DATABASE_URL=... npm run test:integration` — 60/60.
- `E2E_DATABASE_URL=... PLAYWRIGHT_BROWSERS_PATH=... npm run test:e2e` — 12/12.
- `npm run typecheck` — PASS.
- `npx tsc -p tsconfig.worker.json --noEmit` — PASS.
- `npm run lint` — PASS.
- `npm run build` — PASS.

Chromium Playwright został zainstalowany lokalnie w `browsers/` (katalog jest ignorowany przez Git).
