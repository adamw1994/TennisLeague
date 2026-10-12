# Checkpoint do wznowienia na innym komputerze

Ten katalog jest zwykle ignorowany przez Git. Ten checkpoint celowo zawiera
wyłącznie tekstowe materiały potrzebne do dalszej pracy: postęp, briefy,
wymagania, raporty i notatki środowiskowe.

## Stan przy ostatniej aktualizacji

- Gałąź: `feat/low-on-legs-mvp`.
- Zadania 1–3 są ukończone i przeszły niezależny przegląd.
- Zadanie 4, gracze i awatary, ma gotową implementację w commicie
  `df9ae00 feat: manage players and avatars`.
- Ostatnie potwierdzone kontrole zadania 4: 67 testów jednostkowych i
  integracyjnych, 4 testy E2E, typecheck, lint oraz produkcyjna kompilacja —
  wszystkie przeszły.
- Niezależny przegląd zadania 4 zakończył się wynikiem **wymaga poprawek**.
  Nie zaczynaj zadania 5.
- Otwarte poprawki zadania 4: zachować token przy ponowieniu niezmienionego
  formularza po błędzie, poprawić politykę cache awatara, dodać akcję
  odświeżenia przy konfliktach uploadu/usunięcia oraz nazwać dialog dla
  czytników ekranu. Dodatkowa poprawka: polskie komunikaty walidacji pól.
- Pełny opis oraz lokalizacje kodu są w ostatnim wyniku przeglądu i zostaną
  dopisane do `progress.md` przed następnym checkpointem.
- Plik `progress.md` jest pełnym dziennikiem decyzji; ten dokument jest krótką
  instrukcją szybkiego wznowienia.

## Zasada aktualizacji checkpointu

Przed każdym commitem checkpointu i po każdym istotnym zdarzeniu aktualizuj:

1. ten plik — aktualny commit, etap, wynik testów i następny krok;
2. `progress.md` — pełne wyniki, decyzje i otwarte ryzyka;
3. raport danego zadania, gdy implementacja lub poprawka jest zakończona.

Nie opisuj zadania jako ukończonego przed niezależnym przeglądem. Commit WIP
jest prawidłowym punktem wznowienia, ale musi to być wyraźnie zapisane tutaj.

## Co przeczytać przed wznowieniem

1. `progress.md`
2. `task-4-brief.md`
3. `task-4-environment-notes.md`
4. `task-4-report.md` — końcowe testy i konfiguracja E2E zadania 4
5. `shared-requirements.md`
6. `task-2-context.md` — kolejność limitów, tokenów i transakcji
7. `task-3-report.md` — wspólny walidator wyniku tenisowego

## Środowisko na nowym komputerze

- Zainstaluj Node.js zgodny z `.nvmrc`, Git, Docker Desktop i zależności przez
  `npm ci`.
- Uruchom testową bazę z `compose.test.yaml`. Domyślnie używa ona lokalnego
  portu 55432; jeśli jest zajęty, stwórz lokalne nadpisanie portu, nie zmieniaj
  wersjonowanego pliku Compose.
- Ustaw `TEST_DATABASE_URL` na dedykowaną bazę kończącą się na `_test`.
- Dla testów E2E utwórz osobną bazę `_test`, ustaw `E2E_DATABASE_URL`, a potem
  wykonaj `npx playwright install chromium`, jeśli przeglądarka nie jest
  zainstalowana.

Nie przenoś ani nie commituj lokalnych katalogów `pgsql`, `pgdata`, `browsers`,
pobranych archiwów, logów ani plików z hasłami. Są odtwarzalnym środowiskiem,
nie źródłem projektu.
