# Task 13 — Odbiór akceptacyjny i benchmark

## Zakres

- Dodano deterministyczny `seedAcceptance()` z czterema nazwanymi ligami: klasyczne
  single/deble oraz Elo single/deble.
- Dodano Playwright global setup/teardown: świeża baza E2E, migracje, dane odbiorowe
  i osobny worker Elo z plikiem health-check.
- Dodano pięć scenariuszy akceptacyjnych obejmujących Fast4, normalne sety, super
  tie-break, stałe pary, ranking Elo, późniejsze członkostwo, korekty, soft delete,
  walidację, pending submit, konflikt wersji i focus dialogu.
- Dodano `scripts/benchmark.ts` dla 30 graczy, 870 meczów klasycznych, 500 meczów
  Elo, 20 zapisów równoległych oraz korekty po replay.
- Dodano checklistę odbiorową i backup/restore drill w `docs/acceptance.md`.

## Weryfikacja

- Pełny Playwright E2E: **17/17**.
- Test akceptacyjny: **5/5**.
- Benchmark: **PASS** — append p95 27,05 ms, 20 równoległych appendów p95 715,77 ms,
  replay 500 meczów 59,52 ms (job wait 4,57 ms, snapshot 17,29 ms, calculate 3,03 ms,
  publish 39,21 ms), seria 20 korekt 113,28 ms; końcowy `elo_state=CURRENT` oraz
  równe rewizje wejścia i publikacji.
- Backup/restore custom-format: **PASS** — źródło i kopia zgodne (`30` graczy,
  `2` ligi, `1390` meczów, `0` avatarów).

Pełny Docker smoke pozostaje niewykonany, gdy Docker Engine nie jest dostępny;
Compose config oraz lokalne testy PostgreSQL zostały zweryfikowane.
