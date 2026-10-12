# Global Constraints


Poniższe reguły obowiązują w każdym zadaniu. Rozstrzygnięcia projektu §2 mają pierwszeństwo nad sprzecznymi fragmentami starszych specyfikacji.

- Next.js App Router, TypeScript strict, MikroORM i PostgreSQL; runtime Node.js.
- Bez kont, logowania, ról, prywatnych grup, mikroserwisów i zewnętrznego brokera.
- Sport TENNIS; rodzaje CLASSIC/ELO_INFINITE; tryby SINGLES/DOUBLES.
- Sport, rodzaj i tryb ligi są niezmienne od utworzenia.
- Minimum: 2 graczy w singlu, 2 pełne stałe pary w klasycznym deblu, 4 graczy w deblu Elo.
- Klasyczna liga, członkostwa, pary i cały terminarz powstają atomowo; brak utrwalanych szkiców.
- Terminarz: n × (n − 1) / 2 albo n × (n − 1); rewanże z odwróconymi stronami w drugiej części.
- Dowolna kolejka może otrzymać wynik. Nie wolno usuwać meczu klasycznego, czyścić wyniku ani zmieniać jego stron.
- Liga klasyczna kończy się automatycznie po wszystkich wynikach; korekta jej nie otwiera.
- Best of 3: dokładnie 2 sety przy 2:0 albo 3 przy 2:1.
- Pierwsze dwa sety mają wspólny format. Fast4: 4:0, 4:1, 4:2, 4:3. Normalny: 6:0–6:4, 7:5, 7:6; także wyniki odwrócone.
- Trzeci set przy 1:1: FAST4, NORMAL albo SUPER_TIE_BREAK, niezależnie od formatu otwierającego.
- Super tie-break: 10:0–10:8 albo wynik powyżej 10 z przewagą dokładnie 2; 12:8 jest niepoprawne.
- Małe punkty tylko w trzecim secie SUPER_TIE_BREAK; dodaje on zero gemów.
- Klasyczna punktacja: 5/0 za 2:0, 4/2 za 2:1. Sortowanie: punkty, bilans setów, bilans gemów.
- Pełny remis w tabeli i równy rating Elo dają miejsca 1, 1, 3.
- Elo: start 1000, minimum 500, K domyślnie 32, całkowite 10–60; połówki zaokrąglane od zera.
- Debel Elo: średnie ratingi stron; wspólne calculatedDelta, indywidualne appliedDelta.
- resultRecordedAt i eloKSnapshot są niezmienne po pierwszym zapisie; czas nadaje serwer po blokadzie ligi.
- Kolejność Elo: resultRecordedAt, id; nadawane czasy ściśle rosną w lidze.
- Dodawanie członków Elo dozwolone w dowolnym momencie; brak wypisywania i ponownego dołączania.
- Soft delete gracza zachowuje członkostwa, historię, miejsce i rating. Pseudonim pozostaje zarezerwowany.
- Usunięta liga nie występuje w publicznych odczytach, statystykach, profilach ani mutacjach.
- Awatary: JPEG, PNG i WebP do 5 MB; po przetworzeniu maksymalnie 256 × 256 px z zachowaniem proporcji.
- Interfejs polski, responsywny i dostępny z klawiatury; czas Europe/Warsaw, etykieta „Wynik zapisano”.
- UUID jako klucze; timestamptz jako czasy; wersjonowane migracje; oddzielny EntityManager na żądanie i job.
- App i worker jako osobne kontenery tej samej wersji obrazu; migracja jako osobny krok; backup i próba odtworzenia przed produkcją.


# Shared contracts


Zadania muszą zachować te nazwy i typy; zmiana kontraktu wymaga aktualizacji wszystkich zależnych fragmentów planu i testów.

~~~ts
// src/shared/contracts.ts
export type Id = string;
export type Side = 'A' | 'B';
export type Mode = 'SINGLES' | 'DOUBLES';
export type LeagueKind = 'CLASSIC' | 'ELO_INFINITE';
export type Sides = readonly [readonly Id[], readonly Id[]];
export type Versioned = { id: Id; expectedVersion: number };
export type Creation<T> = { token: string; data: T };
export type ActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string;
      fields?: Record<string, string>; retryAfterSeconds?: number };
export type Page<T> = { items: T[]; nextCursor: string | null };
~~~

Serwisy: pierwszy parametr em: EntityManager, dalej jawny command; wewnątrz mutacji jedna transakcja. Warstwa HTTP odpowiada za origin, limit body, parsowanie i rewalidację. Serwisy ponownie sprawdzają reguły domenowe oraz wersje.

Spójność blokad: najpierw liga FOR UPDATE (gdy dotyczy), następnie gracze po rosnącym UUID FOR SHARE, następnie mecz/job. Globalne usunięcie gracza blokuje jego wiersz FOR UPDATE, nie blokuje lig. Dzięki temu zapis i usunięcie mają jednoznaczną kolejność bez odwrócenia kolejności blokad. Aktualizacja ligi nie zwiększa wersji formularza przy każdym obliczeniu Elo — osobne version i input_revision/published_revision.


# Plan clarifications


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

# Technical parameters


To parametry eksploatacyjne do sprawdzenia w zadaniu 13, nie dodatkowe zasady sportowe.

| Parametr | Wartość początkowa |
|---|---|
| Imię/nazwisko/pseudonim/nazwa ligi | 1–80 / 1–80 / 1–40 / 1–120 znaków po trim |
| Zwykła mutacja / upload HTTP | 256 KiB / 6 MiB całego body |
| Plik obrazu | 5 000 000 bajtów; maks. 16 mln pikseli, 1 klatka |
| Terminarz | maks. 5 000 spotkań na utworzenie; brak limitu 30 graczy |
| Listy | 25 rekordów, maks. 100; stabilny kursor z id |
| Częstotliwość na klienta | 60 mutacji/min, 5 nowych lig/min, 10 uploadów/min, 20 korekt Elo/min |
| Globalny limit aplikacji | 600 mutacji/min; współdzielony w PostgreSQL |
| Worker | sprawdzanie co 1 s; lease 30 s, heartbeat co 5 s |
| Retry błędów workera | 5 prób; opóźnienia 1, 2, 4, 8 s przed kolejnymi próbami |
| Status UI | polling co 2 s w widocznej karcie, co 10 s po błędzie; ponowienie po focus |
| DB pool | app 10, worker 5; zestawić z limitem połączeń hostingu |
| Blokada transakcji | lock_timeout 5 s; transakcje mutacji ograniczone do 15 s |

Wspólna konfiguracja limitów w tabeli application_settings; wszystkie procesy czytają ją z bazy, bez odrębnych wartości w pamięci. Klient identyfikowany przez HMAC adresu IP ustalonego przez zaufany reverse proxy; nie ufać dowolnemu X-Forwarded-For. Instrukcja wdrożenia określi zaufany proxy i APP_ORIGIN. Lokalnie wspólny koszyk jest akceptowalny. Brak identyfikacji użytkowników pozostaje zamierzony.


# File responsibilities


Wszystkie wymienione dalej ścieżki są względem repozytorium. Pliki powstają dopiero w zadaniu, które ich potrzebuje.

| Obszar | Pliki |
|---|---|
| Narzędzia | package.json, package-lock.json, tsconfig.json, next.config.ts, eslint.config.mjs, vitest.config.ts, playwright.config.ts, .gitignore, .env.example, .nvmrc |
| Baza | mikro-orm.config.ts, src/db/orm.ts, src/db/entities.ts, src/db/migrations.ts, src/db/migrate.ts, src/db/migrations/Migration001Platform.ts do Migration006Elo.ts |
| Wspólny zapis | src/shared/contracts.ts, errors.ts, limits.ts, mutation.ts, idempotency.ts, rate-limit.ts, logger.ts (w src/shared/) |
| Gracze | src/modules/players/player.entity.ts, avatar.entity.ts, commands.ts, queries.ts, avatar.ts |
| Ligi | src/modules/leagues/league.entity.ts, membership.entity.ts, team.entity.ts, schedule.ts, commands.ts, queries.ts |
| Mecze | src/modules/matches/match.entity.ts, revision.entity.ts, commands.ts, queries.ts |
| Tenis | src/modules/tennis/types.ts, validate.ts, project.ts, score.entity.ts |
| Klasyfikacje | src/modules/standings/calculate.ts; src/modules/elo/types.ts, calculate.ts, replay.ts, publication.entity.ts, job.entity.ts, append.ts, queue.ts, queries.ts |
| Worker | src/workers/elo/claim.ts, snapshot.ts, publish.ts, run-once.ts, main.ts, health.ts |
| Statystyki | src/modules/statistics/player.ts, league.ts, queries.ts |
| UI wspólne | src/components/PlayerForm.tsx, LeagueForm.tsx, ScoreForm.tsx, ConfirmDelete.tsx, FieldError.tsx, Classification.tsx, EloStatus.tsx, Pagination.tsx |
| Routing | src/app/layout.tsx, page.tsx, globals.css, error.tsx, not-found.tsx; strony i akcje wskazane w zadaniach |
| Testy | tests/support/database.ts, fixtures.ts, barrier.ts; tests/unit/, tests/integration/, tests/e2e/ |
| Uruchomienie | Dockerfile, .dockerignore, compose.yaml, compose.external.yaml, compose.test.yaml, scripts/recover.ts, scripts/benchmark.ts, docs/operations.md |

Nie tworzyć pustych piętrowych warstw application/domain/infrastructure w każdym module. Domenowe funkcje nie importują Next.js ani ORM. Encje nie przechodzą do Client Components — zwracamy serializowalne DTO.
