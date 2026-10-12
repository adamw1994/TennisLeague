## Task 12: Kontenery i techniczne odzyskiwanie

**Files:** Utwórz Dockerfile, .dockerignore, compose.yaml, compose.external.yaml, scripts/recover.ts, docs/operations.md; rozszerz .env.example, package.json; tests/integration/recovery.test.ts; dodaj scripts/container-smoke.mjs.
**Interfaces:** Obraz uruchamia node_modules/.bin/next start, node dist/src/workers/elo/main.js i node dist/src/db/migrate.js. CLI recovery przyjmuje jawny tryb, identyfikator i expectedVersion; bez publicznego HTTP. Wszystkie pliki runtime kompilowane do dist z jednej konfiguracji worker/tools.

- [ ] Dodaj test przywrócenia meczu Elo i nowej rewizji obliczeń, test korekty według starej MatchRevision oraz przywrócenia ligi bez regeneracji terminarza. recovery używa istniejących serwisów, nie edytuje ratingów ręcznie.
~~~ts
test('przywrócenie Elo zleca nowe obliczenie', async () => {
  await withTestDb(async em => {
    const {leagueId,playerIds:[a,b]} = await makeEloLeague(em);
    const score: TennisScore = {openingSetFormat:'FAST4',decidingSetFormat:null,
      sets:[{order:1,kind:'GAME_SET',sideA:4,sideB:0},
            {order:2,kind:'GAME_SET',sideA:4,sideB:0}]};
    const m = await createEloMatch(em,{token:crypto.randomUUID(),
      data:{leagueId,sides:[[a],[b]],score}});
    const deleted = await deleteEloMatch(em,{id:m.id,leagueId,expectedVersion:m.version});
    await restoreMatch(em,{id:m.id,expectedVersion:deleted.version});
    expect((await getEloRanking(em,leagueId)).state).toBe('RECALCULATING');
  });
});
~~~
restoreMatch(em,Versioned), restoreLeague(em,Versioned), restorePlayer(em,Versioned), restoreMatchRevision(em,{id,expectedVersion,sourceVersion}) definiuje scripts/recover.ts jako funkcje importowalne bez uruchamiania CLI. Każda zwraca {id,version}; również deleteEloMatch zwraca taki wynik.
- [ ] Uruchom test czerwony; zaimplementuj restore z blokadami i optimistic concurrency. Nowa wersja meczu zachowuje pierwszy czas/K, odwzorowuje zatwierdzoną historyczną strukturę, nie zmienia niezmiennych stron klasycznych. Przywrócenie gracza zachowuje zarezerwowany nick. Liga Elo dostaje input_revision+1 oraz job; klasyczna zachowuje mecze, pary i status. Powtórzenie operacji nie ma dalszych efektów.
- [ ] Zbuduj wieloetapowy Dockerfile. Dokładny schemat obrazu:
~~~dockerfile
FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0"]
~~~
Utwórz public/.gitkeep przy szkielecie lub usuń COPY jeśli public nie istnieje. Obraz przechowuje zwykły wynik next build z runtime node_modules; nie łączy standalone z inną metodą pakowania. Migrator i zależności wykonywalne CLI recovery pozostają production dependencies. Walidacja konfiguracji połączenia dopiero w runtime; sekretów nie podawać jako ARG do build.
- [ ] .dockerignore: .git, .next, dist, node_modules, .env i .env.*, z wyjątkiem .env.example, coverage, test-results, playwright-report, lokalne backupy. W .gitignore te same wrażliwe i generowane pliki, bez worktrees.
- [ ] Compose: db=postgres:18 z pg_isready i trwałym wolumenem montowanym zgodnie z obrazem PostgreSQL 18; bez ports dla bazy. app i worker mają ten sam image tag; migrate to jednorazowa usługa tego obrazu. depends_on: db service_healthy, migrate service_completed_successfully. app/worker restart unless-stopped; migrate restart no. APP_ORIGIN, DATABASE_URL i wspólna konfiguracja przez env; POSTGRES_PASSWORD wymagany w runtime, nie prawdziwa wartość w pliku.
~~~yaml
# Fragment app; pełny compose definiuje także db, migrate i worker.
app:
  image: low-on-legs:local
  build: .
  command: ["node_modules/.bin/next", "start", "-H", "0.0.0.0"]
  env_file: .env
  ports: ["127.0.0.1:3000:3000"]
  depends_on:
    db:
      condition: service_healthy
    migrate:
      condition: service_completed_successfully
  restart: unless-stopped
~~~
Przed produkcją zastąp local identycznym wersjonowanym tagiem wszystkich trzech usług. Health app używa fetch do /api/health; worker sprawdza świeżość /tmp/elo-worker-health, nie tylko istnienie procesu. Budżet bazy uwzględnia oba poole.
- [ ] compose.external.yaml jest samodzielnym alternatywnym plikiem z app, worker i migrate bez usługi db ani jej zależności. Wszystkie łączą się do tej samej zewnętrznej bazy z walidacją TLS zgodną z dostawcą; retry migracji przy chwilowej niedostępności nie może ukrywać błędu SQL. Test konfiguracji można wykonać z osobnym kontenerem PostgreSQL jako bazą „zewnętrzną”, bez zakupów hostingu.
- [ ] W docs/operations.md opisz dwie ścieżki: pełny Compose na serwerze i obraz jako osobne usługi platformy kontenerowej. Instrukcja zawiera wymagane env, generowanie sekretów, budowanie, uruchomienie migracji, health, logi, zatrzymanie app+worker przed aktualizacją schematu, migrację nowej wersji, start zgodnych wersji obu procesów i weryfikację zapisu/korekty. Bez automatycznego cofania migracji i bez migracji przy starcie każdego procesu.
~~~powershell
docker compose build
docker compose up -d db
docker compose run --rm migrate
docker compose up -d app worker
docker compose logs --tail 100 app worker
~~~
- [ ] Dodaj procedurę backup/restore wykonaną wewnątrz kontenera lub przez narzędzia dostawcy, z formatem pg_dump -Fc i pg_restore do osobnej pustej bazy. Na Windows nie przekierowuj binarnego pg_dump przez tekstowy pipeline PowerShell; zapisuj plik wewnątrz kontenera i kopiuj docker cp. Procedura wymaga zatrzymania mutacji na czas finalnego przełączenia i kontroli liczby graczy/lig/meczów/rewizji/awatarów, a następnie replay Elo.
- [ ] Opisz CLI dry-run → explicit apply dla konkretnego id i wersji, retry joba, korektę z rewizji, restore rekordu i całej bazy. To narzędzie operatora na serwerze, bez publicznego ekranu. Dodaj retencję i harmonogram jako decyzje środowiska produkcyjnego do wpisania przez operatora przed uruchomieniem; plan nie wymyśla dostawcy ani RPO/RTO.
- [ ] Test kontenerowy z czystego checkoutu: build, migrate, app health, gracz/liga/mecz, korekta i worker, restart/odtworzenie kontenerów z zachowaniem wolumenu, weryfikacja danych. Nie używać down -v na użytkowej bazie. Zweryfikuj compose config, brak sekretów w warstwach obrazu oraz smoke z bazą zewnętrzną.
- [ ] Uruchom recovery i container smoke. Commit: feat: package application and recovery tools.

**Odbiór:** Zestaw uruchamia się bez lokalnego Node.js. Produkcyjne domena/HTTPS, zaufany proxy, harmonogram/retencja backupów i docelowe RPO/RTO wymagają ustalenia środowiska przed faktycznym wdrożeniem, ale nie blokują wykonania planu aplikacji.
