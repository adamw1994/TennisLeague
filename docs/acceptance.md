# Odbiór MVP

Ten dokument jest checklistą wykonania lokalnego odbioru. Nie jest deklaracją gotowości produkcyjnej: HTTPS, zaufany reverse proxy, retencja backupów oraz RPO/RTO pozostają decyzjami środowiska docelowego.

## Środowisko

- branch: `feat/low-on-legs-mvp`, working tree zawiera implementację Tasks 5–13,
- Node 24, npm 11, Next 16, MikroORM 7, PostgreSQL 18 jako docelowy obraz bazy,
- E2E korzysta z osobnej bazy zakończonej sufiksem `_e2e_test` i workerem Elo uruchamianym przez setup Playwright,
- test integracyjny nie może używać `DATABASE_URL`; używa wyłącznie `TEST_DATABASE_URL`.

## Kontrola przed odbiorem

Uruchom z czystej kopii repozytorium i nie podawaj produkcyjnych sekretów do builda:

```sh
npm ci
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
E2E_DATABASE_URL=postgresql://.../low_on_legs_e2e_test npm run test:e2e
npm run build
npm run build:runtime
docker compose --env-file .env -f compose.yaml config --quiet
docker compose --env-file .env -f compose.external.yaml config --quiet
docker build -t low-on-legs:acceptance .
```

`compose.test.yaml` służy wyłącznie do uruchomienia dedykowanej bazy testowej. Nie wykonuj `down -v` na bazie zawierającej dane użytkowników.

## Macierz scenariuszy przeglądarkowych

`tests/e2e/acceptance.spec.ts` korzysta z `seedAcceptance()` w `tests/support/fixtures.ts`. Setup tworzy przez commands dziesięciu nazwanych graczy i cztery ligi:

- `Acceptance Classic Singles`,
- `Acceptance Classic Doubles`,
- `Acceptance Elo Singles`,
- `Acceptance Elo Doubles`.

Scenariusze sprawdzają mobilny formularz bez daty rozegrania, Fast4/normalny set/super tie-break, dowolną kolejkę, stałe pary, tabelę, ranking Elo, późniejszego członka, korektę, worker, soft delete ligi/meczu, walidację zachowującą wpisane wartości, oczekiwanie przy submit, konflikt wersji oraz focus po zamknięciu dialogu.

## Benchmark

Uruchom na świeżej bazie benchmarkowej:

```sh
DATABASE_URL=postgresql://.../low_on_legs_benchmark \
BENCHMARK_CPU='2 vCPU' BENCHMARK_MEMORY='2 GiB' \
npm run benchmark
```

Skrypt deterministycznie tworzy 30 graczy, klasyczną ligę z 870 meczami oraz 500 meczów Elo. Wynik JSON raportuje osobno medianę/p95 appendu, zapis równoległy, oczekiwanie joba, snapshot, `replayElo` (calculate), publish, pełną latencję replay, serię korekt i latencję dojścia do opublikowanego stanu widocznego dla UI. Pole `uiLatencyMs` pozostaje `null`, bo benchmark CLI nie uruchamia przeglądarki; `queryCount` pozostaje `null`, gdy nie jest dostępne `pg_stat_statements`. Nie interpretuj `null` jako zera.

Cele diagnostyczne pierwszego pomiaru:

- p95 zwykłej mutacji poniżej 1 s,
- publikacja replay 500 meczów poniżej 10 s od zlecenia,
- po korekcie `input_revision = published_revision` i `elo_state = CURRENT`.

Ostatni lokalny pomiar (18.09.2026, PostgreSQL 17, lokalny Node runtime, deklarowane
środowisko `2 vCPU / 2 GiB`) zakończył się sukcesem:

- E2E: 17/17 scenariuszy, w tym 5/5 scenariuszy akceptacyjnych,
- append 500 meczów: mediana 15,24 ms, p95 27,05 ms, maksimum 163,96 ms,
- 20 równoległych appendów: mediana 546,84 ms, p95 715,77 ms,
- replay 500 meczów: oczekiwanie joba 4,57 ms, snapshot 17,29 ms, calculate 3,03 ms,
  publish 39,21 ms, pełna latencja 59,52 ms,
- seria 20 korekt podczas backlogu workera: 113,28 ms; `input_revision = published_revision = 541`,
  `elo_state = CURRENT`,
- benchmarkowe progi p95 mutacji < 1 s i replay < 10 s zostały spełnione.

Przekroczenie celu wymaga opisania przyczyny; nie zmniejszaj liczby uczestników ani historii.

## Backup i restore drill

Na osobnej bazie wykonaj backup w formacie custom, odtwórz go do pustej bazy i porównaj liczbę graczy, lig, meczów, rewizji oraz awatarów:

```sh
pg_dump -Fc --file=acceptance.dump "$SOURCE_DATABASE_URL"
createdb "$RESTORE_DATABASE_URL"
pg_restore --clean --if-exists --dbname="$RESTORE_DATABASE_URL" acceptance.dump
```

Po odtworzeniu zapisz nowy mecz, wykonaj korektę i uruchom worker. Sprawdź wpis `MatchRevision`, avatar, `elo_recalculation_jobs` oraz zgodność publikacji. W lokalnym drill na tymczasowej bazie backup custom-format został odtworzony, a liczniki źródła i kopii były zgodne: `players=30`, `leagues=2`, `matches=1390`, `player_avatars=0`. Recovery pojedynczego rekordu wykonuj najpierw jako dry-run:

```sh
node dist/scripts/recover.js --mode restore-match --id MATCH_UUID --expected-version 2
node dist/scripts/recover.js --mode restore-match --id MATCH_UUID --expected-version 2 --apply
```

Pozostałe tryby to `restore-match-revision --source-version N`, `restore-league` i `restore-player`. Powtórzenie tej samej operacji nie tworzy kolejnej zmiany.

## Aktualny stan lokalnej weryfikacji

- unit: 72/72,
- recovery integration: 3/3,
- typecheck, lint, production build, runtime build: PASS,
- Compose YAML: PASS przez `docker compose config`,
- pełny Docker smoke i `docker compose build`: niewykonane, gdy Docker Desktop nie uruchamia silnika po problemie z przestrzenią dyskową,
- pełny integration na lokalnym PostgreSQL 17: 62/63; pojedynczy test Unicode `lower()` zależy od kolacji PostgreSQL i wymaga powtórzenia na PostgreSQL 18,
- acceptance E2E i benchmark wykonane; pełny Docker smoke nadal wymaga działającego Docker Engine.
