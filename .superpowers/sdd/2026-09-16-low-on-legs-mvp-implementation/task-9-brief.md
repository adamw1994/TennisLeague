## Task 9: Korekty, kolejka i odporny worker

**Files:** Utwórz src/workers/elo/claim.ts, snapshot.ts, publish.ts, run-once.ts, main.ts, health.ts, tsconfig.worker.json; tests/integration/elo-worker.test.ts, elo-races.test.ts; rozszerz matches/commands.ts, elo/queue.ts i job.entity.ts.
**Interfaces:** correctEloMatch(em, Versioned & {leagueId,sides,score}); deleteEloMatch(em, Versioned & {leagueId}); claimJob(em): Promise<Claim|null>; readSnapshot(em,Claim): Promise<Snapshot|null>; publishReplay(em,Claim,Snapshot,ReplayOutput): Promise<'PUBLISHED'|'OBSOLETE'|'LOST'|'DELETED'>; runOnce(): Promise<boolean>.
Claim = {jobId,leagueId,claimToken,requestedRevision:string}. Snapshot = {leagueId,revision:string,memberIds, matches:ReplayMatch[]}. Lease musi być ponownie sprawdzony przy każdej mutacji joba.

- [ ] Zdefiniuj w tests/support/barrier.ts funkcję barrier(): { reached:Promise<void>, release():void, wait():Promise<void> }. wait sygnalizuje reached i czeka na release. Punkty zatrzymania przy snapshot/publikacji dostępne wyłącznie w konstrukcji workera testowego; nie w publicznym HTTP.
- [ ] Dodaj test nieaktualnego obliczenia:
~~~ts
test('worker nie publikuje snapshotu sprzed nowego członka', async () => {
  await withTestDb(async em => {
    const { leagueId } = await makeEloLeague(em);
    await enqueueLatest(em, leagueId, '0');
    const claim = (await claimJob(em))!;
    const snapshot = (await readSnapshot(em, claim))!;
    const p = await createPlayer(em, {token:crypto.randomUUID(),
      data:{firstName:'Ewa',lastName:'Nowak',nickname:'ewa'}});
    await joinEloLeague(em, {token:crypto.randomUUID(),
      data:{leagueId,playerId:p.id}});
    const computed = replayElo(snapshot.memberIds, snapshot.matches);
    expect(await publishReplay(em,claim,snapshot,computed)).toBe('OBSOLETE');
    expect((await getEloRanking(em,leagueId)).publishedRevision)
      .not.toBe((await getEloRanking(em,leagueId)).inputRevision);
  });
});
~~~
enqueueLatest jako publicznie niewidoczny helper tego testu musi ustawić RECALCULATING zgodnie ze swym kontraktem. Alternatywnie uruchom przypadek przez korektę zapisanego meczu, aby objąć cały przepływ.
- [ ] Potwierdź czerwony test. Job: id, league_id, requested_revision BIGINT, status PENDING/RUNNING/DONE/FAILED/CANCELLED, attempts, claim_token UUID, lease_until, available_at, started_at, finished_at, last_error_code, timestamps. Częściowy UNIQUE(league_id) WHERE status IN ('PENDING','RUNNING').
- [ ] enqueueLatest pod blokadą ligi tworzy PENDING albo aktualizuje requested_revision istniejącego joba, nie unieważniając trwającego lease. Nowa rewizja zeruje budżet błędów dla nowego wejścia; odrzucenie nieaktualnego snapshotu nie jest błędem zużywającym retry. FAILED pozostaje śladem, nowa mutacja tworzy nowy aktywny job.
- [ ] Korekta blokuje ligę, dotychczasowy i nowy zestaw graczy po id, mecz. Dozwolone: nowe aktywne osoby z bieżących członków, również dołączone później; dotychczasowy usunięty gracz może pozostać. Niedozwolone: nowo wskazany usunięty gracz. Porównuj zbiory po id, nie indeks pola formularza. Zachowaj czas/K, zwiększ wersję, dopisz pełną MatchRevision, input_revision i job w tej samej transakcji.
- [ ] Soft delete Elo tworzy rewizję z deletedAt i job. Powtórzone usunięcie nie zwiększa rewizji ani nie zleca ponownie. Serwer odrzuca analogiczną operację dla CLASSIC; nie ma publicznego endpointu restore.
- [ ] claimJob w krótkiej transakcji wybiera PENDING gotowy czasowo albo RUNNING z wygasłym lease:
~~~sql
SELECT id
FROM elo_recalculation_jobs
WHERE (status = 'PENDING' AND available_at <= clock_timestamp())
   OR (status = 'RUNNING' AND lease_until < clock_timestamp())
ORDER BY available_at, id
FOR UPDATE SKIP LOCKED
LIMIT 1;
~~~
Ustaw nowy claim_token, status RUNNING, lease_until = clock_timestamp()+30 s i attempts+1. Transakcja claim nie blokuje ligi; kończy się przed snapshotem. Heartbeat ma warunek token+status+lease jeszcze ważny; utraconego lease nie wolno wskrzesić.
- [ ] readSnapshot używa krótkiej transakcji REPEATABLE READ: widoczna liga, rewizja, wszystkie członkostwa bez filtrowania gracza, bieżące wersje ukończonych nieusuniętych meczów uporządkowane po resultRecordedAt,id. Skopiuj DTO i zakończ transakcję przed liczeniem. Jeśli liga usunięta, job kończy CANCELLED.
- [ ] Oblicz replayElo poza blokadą. Publikacja blokuje ligę, potem job, sprawdza claim_token, lease, status, deleted_at oraz zgodność input_revision. Przy zmianie wejścia nie zapisuje rankingu, zwalnia job jako PENDING najnowszej rewizji. Przy zgodności INSERT nowej kompletnej publikacji + ratingi + zdarzenia, podmiana pointera i published_revision oraz DONE są jedną transakcją.
- [ ] Błąd: rollback publikacji; warunkowo po tokenie i lease aktualizuj attempts/available_at/error. Po 5 próbach FAILED i elo_state FAILED z pozostawieniem poprzedniej publikacji. Jeżeli w międzyczasie changed requested_revision, nie oznaczaj nowego wejścia błędem starego; ustaw ponowne PENDING. Techniczne retry w zadaniu 12 używa tej samej koordynacji.
- [ ] Dodaj main: pętla z graceful shutdown SIGTERM/SIGINT, odnowienie lease, logi JSON (jobId, leagueId, revision, claimToken skrócony, attempts, durationMs, code), health świeżości heartbeat procesu w pliku /tmp/elo-worker-health. Długi replay porcjuj i oddawaj event loop, żeby heartbeat miał czas działać.
- [ ] Testuj deterministycznie przez bariery: nowy mecz/członek/korekta/usunięcie podczas obliczeń; dwóch workerów claim; wygasły lease i powrót starego wykonawcy; awaria po wstawieniu połowy ratingów; rollback; 5 błędów; retry; usunięta liga; korekta uczestnika dołączonego później; niezmienna historia MatchRevision po replay; wyniki po równoległym append zgodne z pełnym replay.
- [ ] Uruchom elo-worker/elo-races, typecheck, build z osobnym tsconfig.worker.json (emit Node ESM do dist/, rootDir '.', output dist/src/ i dist/scripts/, module/moduleResolution NodeNext, package.json type=module, jawne importy .js w kodzie runtime, bez aliasów nierozwiązywanych przez Node; include src/db, src/modules, src/shared, src/workers oraz scripts/recover.ts, exclude app/components/tests). Commit: feat: replay Elo with recoverable jobs.

**Odbiór:** Awaria ani nowa mutacja nie ujawniają częściowej lub przestarzałej publikacji jako aktualnej.
