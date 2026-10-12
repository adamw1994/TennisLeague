## Task 8: Publikacje Elo i zapis nowego meczu

**Files:** Utwórz src/modules/elo/publication.entity.ts, job.entity.ts, append.ts, queue.ts, queries.ts, Migration006Elo.ts, tests/integration/elo-append.test.ts; rozszerz leagues/commands.ts, matches/commands.ts, LeagueForm.tsx, ScoreForm.tsx i app/matches/actions.ts.
**Interfaces:** createEloMatch(em,Creation<{leagueId:Id,sides:Sides,score:TennisScore}>): Promise<{id,version}>; joinEloLeague(em,Creation<{leagueId:Id,playerId:Id}>); getEloRanking(em,leagueId): Promise<RankingDto>; enqueueLatest(em,leagueId,revision): Promise<void>. Rewizje BIGINT odczytywane jako string i porównywane jako bigint; DTO serializuje string, nigdy number z utratą precyzji.

**Model publikacji:** leagues otrzymuje input_revision BIGINT, published_revision BIGINT, published_publication_id UUID nullable, elo_state CURRENT/RECALCULATING/FAILED, last_result_recorded_at timestamptz. elo_publications(id,league_id,revision,created_at), elo_ratings(publication_id,player_id,rating,played,last_delta), elo_rating_events(publication_id,match_id,match_version,player_id,rating_before,expected_score,actual_score,k_factor,calculated_delta,applied_delta,rating_after). UNIQUE(publication_id,player_id) i UNIQUE(publication_id,match_id,player_id), FK(match_id,match_version) → match_revisions(match_id,version).

Każda publikacja jest kompletnym, niezmiennym snapshotem. Append kopiuje poprzednie pochodne ratingi/zdarzenia do nowego publication_id i dopisuje mecz w tej samej transakcji. Przy kilkuset meczach to prosty mechanizm o mierzalnym koszcie; pomiar w zadaniu 13 obejmuje koszt kopiowania, nie tylko wzór Elo. Starsze publikacje można technicznie usuwać po okresie retencji, ale wyniki i MatchRevision nigdy nie są takim cache. W MVP zachowaj ostatnie 2 publikacje oraz bieżącą, z czyszczeniem po publikacji, pod blokadą ligi; odczyt wielozapytaniowy używa REPEATABLE READ. Nie kasuj publikacji wskazywanej przez ligę.

- [ ] Rozszerz testowe fixtures.ts o makeEloLeague(em,mode='SINGLES',count=2): Promise<{leagueId,playerIds}>; helper tworzy graczy i ligę przez prawdziwe commands z nowymi tokenami. Dodaj test:
~~~ts
test('dwa równoczesne mecze odtwarzają się identycznie', async () => {
  await withTestDb(async em => {
    const { leagueId, playerIds: [a,b] } = await makeEloLeague(em);
    const score: TennisScore = {
      openingSetFormat:'FAST4', decidingSetFormat:null,
      sets:[{order:1,kind:'GAME_SET',sideA:4,sideB:0},
            {order:2,kind:'GAME_SET',sideA:4,sideB:0}]
    };
    await Promise.all([0,1].map(() => createEloMatch(em.fork(), {
      token:crypto.randomUUID(), data:{leagueId,sides:[[a],[b]],score}
    })));
    const ranking = await getEloRanking(em.fork(), leagueId);
    expect(ranking.rows.map(r => r.rating).sort()).toEqual([969,1031]);
    expect(ranking.inputRevision).toBe(ranking.publishedRevision);
  });
});
~~~
RankingDto = {inputRevision:string,publishedRevision:string,state,rows: {playerId,label,deleted,place,rating,played,lastDelta}[]}. Równoczesny test uruchom także z wymuszonym jednakowym odczytem zegara i porównaj pełne replayElo z odczytanych wyników/wersji/K.
- [ ] Uruchom czerwony test; utwórz migrację publikacji oraz jobów z zadania 9. Przy tworzeniu ligi Elo od razu utwórz kompletną publikację zerową wszystkich członków (1000, 0 meczów, last_delta null). rating nie jest wspólny między ligami.
- [ ] Implementuj append: once, transakcja, league FOR UPDATE, uczestnicy FOR SHARE w stałym porządku, walidacja liczności/przynależności/soft delete. Nadanie czasu przez bazę po uzyskaniu blokady:
~~~sql
UPDATE leagues
SET last_result_recorded_at = GREATEST(
      clock_timestamp(),
      COALESCE(last_result_recorded_at + interval '1 millisecond',
               clock_timestamp())
    ),
    input_revision = input_revision + 1
WHERE id = ?
RETURNING last_result_recorded_at, input_revision, elo_k;
~~~
Nie używaj now() z początku transakcji. Milisekunda zachowuje kolejność także w JS Date. Pole nie cofa się po usunięciu spotkania ani korekcie. Odczyt clock_timestamp w testach zastąp kontrolowanym zegarem przez parametr serwisu testowego, bez publicznego przyjmowania czasu.
- [ ] Zapisz mecz, strony, sety, MatchRevision v1 i snapshot K. Jeśli wcześniejsze input/published były zgodne i state CURRENT, użyj calculateElo, zbuduj nową publikację, podmień wskazanie ligi i published_revision. Jeśli nie: pozostaw poprzednią publikację, ustaw RECALCULATING i enqueueLatest w tej samej transakcji. Potwierdź zapis od razu.
- [ ] joinEloLeague blokuje ligę i gracza, sprawdza UNIQUE członkostwa. Zwiększa input_revision. Przy CURRENT publikuje kopię rankingu plus nowy gracz na 1000 bez replay historii; podczas przeliczenia członek jest dostępny w formularzu, ale nie dopisuj go do starego snapshotu rankingu. enqueueLatest bierze nową rewizję.
- [ ] Zmiana K blokuje tę samą ligę, sprawdza version i dozwolony zakres, nie podbija rewizji wejścia ani nie tworzy joba (wcześniejsze mecze mają K). Następny nowy mecz pobiera nową wartość; korekta zachowuje stary snapshot.
- [ ] Testuj: token duplikatu i nowy token tych samych stron, dwa ratingi atomowo i cztery w deblu, równoległą zmianę K, dodanie członka przy CURRENT/RECALCULATING/FAILED, rollback po zapisaniu części publikacji, usunięcie gracza równocześnie z dodaniem meczu, usunięcie ligi równocześnie z mutacją.
- [ ] UI dodawania Elo korzysta ze wspólnego ScoreForm i wyboru 2 lub 4 różnych aktywnych członków. W ustawieniach dodawanie członka i K. Testy Elo append, typecheck, lint; commit: feat: append Elo matches atomically.

**Odbiór:** Nowe mecze aktualizują bieżący ranking tylko kiedy można to zrobić poprawnie; nie blokują użytkownika podczas replay.
