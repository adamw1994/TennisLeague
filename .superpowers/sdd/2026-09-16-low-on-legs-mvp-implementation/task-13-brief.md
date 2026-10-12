## Task 13: Odbiór MVP i pomiary

**Files:** Utwórz scripts/benchmark.ts, tests/e2e/acceptance.spec.ts, docs/acceptance.md; rozszerz istniejące testy tylko dla luk wykrytych poniższą macierzą. Nie dodawaj drugiego zestawu testów powtarzającego wszystkie unit tests.

- [ ] Przygotuj acceptance E2E na wydzielonej bazie _test: gracze → każda z 4 kombinacji rodzaju/trybu ligi → wynik → klasyfikacja → korekta → soft delete zgodny z rodzajem. Sprawdź przyszłą kolejkę, STB, zakończenie klasycznej i nowego członka Elo.
~~~ts
test('klasyczna liga działa na telefonie i bez wskazywania daty', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/leagues');
  await expect(page.getByRole('link',{name:'Utwórz ligę'})).toBeVisible();
  await page.getByRole('link',{name:'Liga odbiorowa',exact:true}).click();
  await page.getByRole('link',{name:'Wpisz wynik',exact:true}).first().click();
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
  await expect(page.getByLabel('Set 1 — strona A')).toBeVisible();
});
~~~
W tests/support/fixtures.ts dodaj seedAcceptance(em): Promise<{classicLeagueId,eloLeagueId}> tworzący nazwane ligi i graczy przez commands. Setup E2E wykonuje go przed tym testem; nie zależy od danych innego testu.
- [ ] Uzupełnij testy interakcji: błędne dane pozostają w formularzu; oczekiwanie blokuje przycisk; drugi request ten sam token nie dubluje spotkania; konflikt wersji nie nadpisuje; usunięcie potwierdzane z liczbą powiązań; nawigacja klawiaturą i focus wraca z dialogu.
- [ ] Dodaj benchmark tworzący 30 graczy, terminarz z 870 spotkaniami oraz historię 500 meczów Elo przez deterministyczny seed. Sprawdź porównanie append/replay przed pomiarem. Raportuj osobno czas append razem z kopiowaniem publikacji, oczekiwanie joba, snapshot, calculate, publish i pełną latencję widoczną w UI.
~~~ts
const started = performance.now();
const replayed = replayElo(memberIds, matches);
const calculationMs = performance.now() - started;
process.stdout.write(JSON.stringify({
  memberCount: memberIds.length,
  matchCount: matches.length,
  eventCount: replayed.events.length,
  calculationMs
}) + '\n');
~~~
memberIds i matches pobiera readSnapshot z przygotowanej ligi testowej; resztę czasów bierz z logów joba i znacznika wysłania/potwierdzenia request. Powtórz 20 iteracji, podaj medianę i p95, parametry sprzętu/obrazu oraz liczbę zapytań. Wykonaj 20 równoległych zapisów i serię korekt podczas replay, potwierdzając zbieżność.
- [ ] Progi diagnostyczne do pierwszego pomiaru: p95 zwykłej mutacji <1 s, publikacja 500 meczów <10 s od zlecenia na lokalnym zestawie z 2 CPU/2 GiB dla app+worker. Są celami technicznymi, nie gwarancją hostingu; przekroczenie wymaga ustalenia przyczyny i korekty przed akceptacją wydajności. Nie ograniczaj sportowo liczby uczestników w celu ukrycia problemu.
- [ ] Wykonaj pg_dump/pg_restore na osobnej bazie testowej, porównaj liczby i kluczowe wyniki, następnie zapisz nowy mecz i przelicz korektę. Potwierdź awatary, MatchRevision i działanie workera po odtworzeniu. Zapisz dowód w docs/acceptance.md.
- [ ] Uruchom kompletny zestaw kontrolny raz po ostatnich poprawkach:
~~~powershell
npm ci
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run test:e2e
npm run build
docker compose config --quiet
docker compose -f compose.external.yaml config --quiet
docker compose build
~~~
Testy wymagające bazy muszą korzystać z TEST_DATABASE_URL, E2E z E2E_BASE_URL oraz dedykowanego workera. Brak Docker/Node/przeglądarki zgłoś jako niewykonany check, nie jako PASS.
- [ ] Uzupełnij docs/acceptance.md: commit, środowisko, polecenia, wyniki testów, liczby testów, pomiary, wynik restore drill, znane ograniczenia. Przejrzyj diff i macierz wymagań. Commit: test: verify MVP acceptance and operations.
- [ ] Przekaż aplikację do przeglądu użytkownika z instrukcją uruchomienia. Implementacja kończy się na lokalnie sprawdzonym rezultacie; publikacja zewnętrzna jest osobną czynnością.

**Odbiór etapu C:** Spełnione wymagania MVP, sprawdzone uruchomienie kontenerowe i odtworzenie danych, jawnie opisane warunki wdrożenia produkcyjnego.

## Macierz pokrycia wymagań

| Źródło zatwierdzonego projektu | Zadania | Główny dowód |
|---|---|---|
| §3 zakres, brak kont i modułów poza MVP | 1, 11, 13 | przegląd routingu i E2E |
| §4.1 wymagane pola, pseudonim, awatar | 2, 4 | players.test, upload invalid/oversize |
| §4.2 historyczny usunięty gracz | 4, 6, 8–11 | classic-results, replay, visibility |
| §5.1 minima i niezmienność konfiguracji | 5, 8 | leagues.test, bezpośrednie commands |
| §5.2 terminarz, rewanże, dowolna kolejka | 5–6 | schedule.test, classic.spec |
| §5.2 zakaz delete/clear i automatyczny koniec | 6, 13 | classic-results, acceptance |
| §5.3 członkostwa Elo, snapshot K | 7–9 | elo-append, elo-races |
| §5.4 usunięta liga i worker | 5, 9, 11 | visibility, elo-races |
| §6.1 wszystkie legalne/nielegalne sety | 3, 6 | tennis.test, classic.spec |
| §6.2 korekta stron i późniejszy członek | 9–10 | elo-worker, elo-queries |
| §6.3 pełne wersje niezależne od obliczeń | 6, 9, 12 | MatchRevision + recovery.test |
| §7.1 punkty, bilanse i wspólne miejsca | 6 | standings.test |
| §7.2 ranking, deleted, stan starej publikacji | 8, 10 | elo-queries, elo.spec |
| §7.3 profile/statystyki singla i debla | 11 | statistics.test, navigation |
| §8 architektura, kontekst ORM, rewalidacja | 1, 2, 6, 9–10 | platform, build, polling E2E |
| §9 constraints, klucze złożone, transakcje | 2, 4–6, 8–9 | migrations i testy złych FK |
| §10.1 Elo, rounding, floor, debel | 7 | elo.test |
| §10.2 kolejność, synchronizacja K, append | 8 | równoczesny append = replay |
| §10.3 rewizje, snapshot i publikacja | 8–10 | bariery i atomowość |
| §10.4 lease/retry/idempotency/wersje | 2, 6, 9 | mutacje i utrata lease |
| §11 wszystkie ekrany, dostępność i błędy | 4–6, 10–11, 13 | E2E desktop/mobile/keyboard |
| §12 limity, origin, upload i logi | 2, 4, 9, 12 | limity z dwóch procesów, log review |
| §12 recovery i backup | 12–13 | restore drill |
| §12.1 Docker i zewnętrzna baza | 12–13 | container-smoke + compose.external |
| §13.1–13.4 testy i pomiary | 3–13 | docs/acceptance.md |

Starsza specyfikacja szczegółowa §§27–28 jest checklistą dodatkową, z korektami projektu §2: nie implementować usuwania klasycznych meczów, publikacji szkiców, opuszczania ligi Elo ani filtrowania usuniętych graczy z historycznych rankingów.

## Źródła techniczne sprawdzone podczas planowania

Zalecenia integracyjne dostosowano do wymagań projektu, zamiast przenosić całe przykłady z dokumentacji.

- [Next.js — instalacja App Router](https://nextjs.org/docs/app/getting-started/installation): baza doboru wspieranej wersji Next.js i konfiguracji TypeScript.
- [Node.js — cykl wydań](https://nodejs.org/en/about/previous-releases): Node 24 LTS jako wybrana linia uruchomieniowa.
- [MikroORM — integracja Next.js](https://mikro-orm.io/docs/usage-with-nextjs): jawne encje i nazwy tabel, jawna lista migracji oraz izolacja kontekstu. Przykładowego automatycznego uruchamiania migracji podczas inicjalizacji NIE przenosimy; projekt wymaga oddzielnej usługi migracji.
- [PostgreSQL — SELECT i blokady](https://www.postgresql.org/docs/current/sql-select.html): FOR UPDATE SKIP LOCKED do krótkiego przejmowania jobów.
- [Docker Compose — kolejność i gotowość usług](https://docs.docker.com/compose/how-tos/startup-order/): zależność od gotowej bazy i zakończonej migracji.

## Kontrola planu przed przekazaniem

- Wszystkie sekcje zatwierdzonego projektu mają zadania w macierzy.
- Kontrakty TennisScore, Sides, wersji i publikacji są wspólne dla producentów i konsumentów.
- Zakaz worktrees jest jawny i obowiązuje wykonawcę.
- Testy współbieżności są przy mutacjach i workerze; nie zostały odsunięte wyłącznie na koniec.
- Plan zawiera wartości początkowe limitów i procedurę ich pomiaru.
- Fragmenty SQL/TypeScript pokazują reguły i kontrakty implementacji; testy pozostają do wykonania w trakcie implementacji.
- Na etapie przygotowania planu nie ma wyników testów aplikacji, ponieważ aplikacja jeszcze nie istnieje.


## Doprecyzowania po przeglądzie spójności

### Baza, indeksy i wersje

W migracjach, obok jawnych FK z zadań, dodaj CHECK: sport code TENNIS w seed; league kind/mode/status z dozwolonych enumów; CLASSIC wymaga has_return_legs i elo_k NULL, ELO_INFINITE wymaga has_return_legs NULL i całkowitego elo_k 10–60; side_number IN (1,2); position IN (1,2); set_order BETWEEN 1 AND 3; wyniki całkowite ≥0; rating i rating_after ≥500; result_version ≥0. NOT NULL na wymaganych nazwach, kluczach, członkostwach i licznikach. PENDING ma result_recorded_at NULL, COMPLETED ma nie-NULL. elo_k_snapshot obowiązkowe dla ukończonego Elo, nieobecne dla klasycznej — serwis sprawdza regułę wymagającą odczytu ligi.

Klasyczny fixture startuje z result_version=0; pierwszy wynik tworzy MatchRevision 1. Nowy mecz Elo powstaje z result_version=1 i MatchRevision 1. Player/League startują z version=1. Aktualizacja stanu workera nie zmienia wersji edycji konfiguracji ligi. Commands zapisujące/edytujące/usuwające zwracają Promise<{id:Id,version:number}>. Powtórzone usunięcie zwraca zachowaną wersję.

Indeksy: aktywni players po nickname_key i nazwisku/id, aktywne leagues po kind/status/created_at/id, matches(league_id,status,round_number,id), matches(league_id,result_recorded_at,id) WHERE deleted_at IS NULL AND status='COMPLETED', match_side_players(player_id,match_id), match_revisions(match_id,version), elo_rating_events(publication_id,player_id,match_id), jobs(status,available_at,id), rate_limit_buckets(window_start). Indeksy wynikające z FK/UNIQUE nie zastępują wszystkich indeksów kierunku od gracza do historii.

Błędy SQL UNIQUE/FK mapuj na stabilne błędy domenowe. Zachowaj czasy i snapshot K także przed bezpośrednim payloadem próbującym je zmienić: strict schema odrzuca te pola. Testy constraints wykonują także surowy INSERT, żeby nie weryfikować wyłącznie poprawności serwisu.

### Origin i limity transportu

Server Actions korzystają z kontroli Origin/Host Next.js; konfiguracja allowedOrigins obejmuje tylko rzeczywisty APP_ORIGIN, bez wildcard. Route Handler upload wymaga zgodnego Origin dla mutacji przeglądarkowych i odrzuca cross-site. Reverse proxy egzekwuje limit body, aplikacja ponownie mierzy rozmiar; limit Server Actions jest skonfigurowany na 256 KiB, upload osobno do 6 MiB. Błędy z limitu mają polski komunikat i nie odczytują całego nadmiernego body. Limit wpisów terminarza sprawdź PRZED alokacją listy wszystkich fixtures.

Ponowienie poprawnej już zakończonej operacji z jej tokenem może zwrócić zapamiętany wynik po późniejszym usunięciu zasobu, ale nie przywraca go ani nie ujawnia usuniętej ligi. Kolejny odczyt zasobu nadal egzekwuje NOT_FOUND. Dane tokenów nie są publicznym endpointem odczytu.

### Doprecyzowanie testów i plików

Każdy blok testu jest treścią testu w podanym pliku. Dodaj na początku importy test/expect z vitest (albo test/expect z @playwright/test dla E2E) oraz funkcji modułów wymienionych w Interfaces. Support fixtures tworzy dane wyłącznie przez commands i nowy token dla każdego tworzenia. Helpery nie omijają limitów produkcyjnych przez flagę z żądania; testowy transport ma oddzielną konfigurację application_settings we własnej bazie.

Platforma ma SportSchema zdefiniowane jawnie w src/db/entities.ts; kolejne encje importowane do tego rejestru. Zarejestruj wszystkie sześć migracji w src/db/migrations.ts. Migracje nie importują komponentów ani kodu wymagającego Next.js. scripts/recover.ts ma osobno eksporty funkcji i warunkowy entrypoint CLI, aby import testowy nie uruchamiał operacji.

compose.test.yaml zawiera wyłącznie dedykowaną bazę low_on_legs_test, port hosta 127.0.0.1:55432, healthcheck, jawne lokalne hasło testowe opisane jako nieprodukcyjne; dane w odrębnym wolumenie. Playwright używa własnej bazy testowej, nie schematu równoczesnego Vitest. Każdy projekt przeglądarki ma izolowane dane albo wykonuje scenariusze sekwencyjnie z resetem własnej bazy. Nigdy nie resetuj DATABASE_URL produkcji.

### Publikacja i utrzymanie

Czyszczenie starych pochodnych publikacji wykonuje worker jako ograniczoną czynność utrzymaniową również gdy brak jobów, np. co 60 s; nie wymaga tworzenia sztucznych jobów replay po append. Zachowuje bieżącą i dwie ostatnie poprzednie publikacje, wszystkie MatchRevision i bieżące wyniki. Awaria cleanup nie cofa udanego zapisu meczu. Odzyskanie z pierwotnych danych pozostaje możliwe przez replay.

Przy migracji wdrożenia app i worker są zatrzymane, więc jedna usługa migrate działa przed nową wersją. Przy zwykłym pierwszym compose up jej zakończenie jest zależnością startu. Instrukcja aktualizacji musi jawnie odtworzyć jednorazową usługę migrate dla nowego obrazu, żeby stary kontener zakończony sukcesem nie zastąpił nowej migracji.
