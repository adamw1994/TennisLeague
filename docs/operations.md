# Operacje produkcyjne

## Zakres odpowiedzialności

Obraz aplikacji zawiera Next.js, skompilowany migrator i worker Elo. Migracje są osobnym, jednorazowym serwisem `migrate`; proces `app` ani `worker` nie uruchamia migracji przy starcie. Worker zapisuje znacznik świeżości w `/tmp/elo-worker-health`, a aplikacja wystawia `/api/health`.

## Konfiguracja sekretów

Nie przechowuj sekretów w obrazie ani w repozytorium. Przekaż do środowiska uruchomieniowego co najmniej:

- `DATABASE_URL` — pełny URL PostgreSQL; hasło zawierające znaki specjalne musi być zakodowane procentowo,
- `APP_ORIGIN` — publiczny origin aplikacji,
- `CLIENT_KEY_HMAC_SECRET` — losowy, długi sekret,
- `POSTGRES_PASSWORD` — tylko dla wariantu z lokalnym serwisem PostgreSQL,
- `DATABASE_SSL_MODE=require` oraz opcjonalnie `PGSSLROOTCERT` dla zewnętrznego PostgreSQL z TLS.

`DATABASE_URL` dla `compose.yaml` powinien wskazywać host `db`; dla `compose.external.yaml` wskazuje usługę zewnętrzną. Plik `.env.example` jest wzorem, nie zawiera działających sekretów.

## Budowa i uruchomienie z PostgreSQL w Compose

```sh
docker build -t low-on-legs:local .
docker compose --env-file .env -f compose.yaml up -d
docker compose --env-file .env -f compose.yaml ps
node scripts/container-smoke.mjs http://localhost:3000
```

Serwisy `app` i `worker` czekają na zdrową bazę oraz pomyślne zakończenie `migrate`. Baza nie ma publikowanego portu hosta; dostęp do niej odbywa się z sieci Compose.

## Uruchomienie na zewnętrznej platformie kontenerowej

Zbuduj ten sam obraz i uruchom trzy procesy z `compose.external.yaml` albo ich odpowiedniki na platformie:

```sh
docker build -t registry.example/low-on-legs:$VERSION .
docker push registry.example/low-on-legs:$VERSION
docker compose --env-file .env -f compose.external.yaml up -d
```

Na platformie bez Compose utwórz jednorazowy job z komendą `node dist/src/db/migrate.js`, a następnie deployment `app` z `node node_modules/.bin/next start` i deployment `worker` z `node dist/src/workers/elo/main.js`. Wszystkie procesy muszą używać tego samego tagu obrazu i `DATABASE_URL`.

## Healthchecki, logi i aktualizacja

- aplikacja: `GET /api/health`,
- worker: plik `/tmp/elo-worker-health`, aktualizowany co najwyżej co 5 sekund,
- logi: `docker compose logs -f app worker migrate`,
- aktualizacja: zbuduj nowy niezmienny tag, uruchom migrator, dopiero potem wymień `app` i `worker`; nie usuwaj starej wersji obrazu przed zakończeniem rolloutu.

Nie zakładaj konkretnego dostawcy, RPO ani RTO. Ustal je osobno dla środowiska i monitoruj czas działania migratora, `/api/health`, świeżość workera oraz kolejkę `elo_recalculation_jobs`.

## Backup i odtworzenie PostgreSQL

Backup wykonuj w formacie custom, przechowując go poza hostem bazy:

```sh
pg_dump --format=custom --file=low-on-legs-$(date +%Y%m%d%H%M).dump "$DATABASE_URL"
```

Odtwarzaj zawsze do osobnej, pustej bazy i zweryfikuj aplikację przed przełączeniem ruchu:

```sh
createdb low_on_legs_restore
pg_restore --clean --if-exists --dbname="$RESTORE_DATABASE_URL" low-on-legs-YYYYMMDDHHMM.dump
```

## Odzyskiwanie rekordów

Narzędzie nie ma publicznego endpointu. Najpierw wykonaj suchy przebieg, a zmianę zatwierdź dopiero z `--apply`:

```sh
node dist/scripts/recover.js --mode restore-match \
  --id MATCH_UUID --expected-version 2

node dist/scripts/recover.js --mode restore-match \
  --id MATCH_UUID --expected-version 2 --apply
```

Dostępne tryby to `restore-match`, `restore-match-revision` (dodatkowo `--source-version`), `restore-league` i `restore-player`. Każda operacja blokuje rekord, sprawdza wersję i jest idempotentna przy ponowieniu tej samej komendy. Przywrócenie meczu Elo tworzy nową rewizję, zwiększa `input_revision` ligi i zleca replay; klasyczna liga zachowuje istniejący terminarz i pary.

Po nieudanym przeliczeniu najpierw sprawdź `elo_recalculation_jobs`, `last_error_code` i logi workera. Ponowne uruchomienie workera obsługuje oczekujące joby; job w stanie `FAILED` można bezpośrednio, administracyjnie przełączyć na `PENDING` po potwierdzeniu przyczyny:

```sql
update elo_recalculation_jobs
   set status = 'PENDING', attempts = 0, available_at = clock_timestamp(),
       finished_at = null, last_error_code = null, updated_at = clock_timestamp()
 where id = 'JOB_UUID' and status = 'FAILED';
```

Po korekcie według starej rewizji uruchom worker i zweryfikuj, że `published_revision = input_revision`, `elo_state = 'CURRENT'`, a wynik w UI odpowiada wskazanej wersji.
