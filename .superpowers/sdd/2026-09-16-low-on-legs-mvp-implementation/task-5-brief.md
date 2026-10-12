## Task 5: Liga i atomowy terminarz

**Files:** Utwórz pliki src/modules/leagues/ z mapy, src/modules/matches/match.entity.ts, Migration004LeaguesMatches.ts; src/app/leagues/page.tsx, new/page.tsx, [leagueId]/layout.tsx, [leagueId]/page.tsx, [leagueId]/matches/page.tsx, [leagueId]/settings/page.tsx, actions.ts; LeagueForm.tsx; tests/unit/schedule.test.ts, tests/integration/leagues.test.ts; rozszerz players/queries.ts.
**Interfaces:** generateSchedule(sideIds: string[], returnLegs: boolean): Fixture[]; Fixture = {key,round,leg,sideA,sideB}. createLeague(em, Creation<LeagueInput>): Promise<{id,version}>; getLeague(em,id); updateLeague(em,Versioned & {name,eloK?}); deleteLeague(em,Versioned). LeagueInput = {name,kind,mode,playerIds,teams: [Id,Id][],hasReturnLegs: boolean|null,eloK: number|null}.

- [ ] Dodaj test własności terminarza.
~~~ts
test.each([5, 6, 30])('terminarz dla %i stron', n => {
  const ids = Array.from({ length: n }, (_, i) => String(i));
  const fixtures = generateSchedule(ids, true);
  expect(fixtures).toHaveLength(n * (n - 1));
  expect(new Set(fixtures.map(m => m.key)).size).toBe(fixtures.length);
  for (const round of new Set(fixtures.map(m => m.round))) {
    const sides = fixtures.filter(m => m.round === round)
      .flatMap(m => [m.sideA, m.sideB]);
    expect(new Set(sides).size).toBe(sides.length);
  }
});
~~~
- [ ] Potwierdź czerwony test; zaimplementuj metodę kołową: sortowanie stabilnych identyfikatorów, dopisanie null dla nieparzystej liczby, nieruchomy pierwszy element, obrót reszty, parowanie początku z końcem, pomijanie null. Drugą serię zbuduj przez odwrócenie stron i przesunięcie numerów kolejek. fixtureKey = uporządkowane id stron + numer leg.
~~~ts
const ring: (string | null)[] = [...sideIds].sort();
if (ring.length % 2) ring.push(null);
for (let round = 1; round < ring.length; round++) {
  for (let i = 0; i < ring.length / 2; i++) {
    const a = ring[i], b = ring[ring.length - 1 - i];
    if (a !== null && b !== null) {
      fixtures.push({ key: [a, b].sort().join(':') + ':1',
        round, leg: 1, sideA: a, sideB: b });
    }
  }
  ring.splice(1, 0, ring.pop()!);
}
~~~
- [ ] Dodaj relacyjne encje i migrację. leagues: sport_id, kind, game_mode, name, has_return_legs/elo_k zależne od rodzaju, status ACTIVE/COMPLETED, version, timestamps. league_players: UNIQUE(league_id,player_id) bez filtra deleted_at. league_teams: id, league_id, display_name; league_team_players: team_id, league_id, player_id, position.
- [ ] W migracji uwzględnij spójne klucze złożone: UNIQUE(id,league_id) w matches i league_teams; match_sides(id,match_id,league_id,side_number,team_id nullable) z FK(match_id,league_id) i opcjonalnym FK(team_id,league_id); match_side_players(side_id,match_id,league_id,player_id,position) z FK(side_id,match_id,league_id) i FK(league_id,player_id). UNIQUE(match_id,player_id) blokuje powtórkę po obu stronach. UNIQUE(league_id,player_id) w league_team_players blokuje dwie stałe pary. UNIQUE(league_id,fixture_key), bez zwalniania przez soft delete.
- [ ] Transakcja once tworzy ligę, członków, pełne pary i mecze PENDING. Przed zapisem blokuje graczy i sprawdza aktywność, minima, rozmiary par, brak duplikatów i limit 5 000 meczów. Klasyczna para jest jawnym team_id w stronie. Elo tworzy ligę bez meczów; jej rozszerzenie ratingowe dopiero w zadaniu 8.
- [ ] Dodaj test atomowości: wstrzyknij błąd po pierwszym INSERT meczu; liczba nowych lig, członkostw i spotkań po rollback = 0. Dodaj powtórzenie tokenu, bezpośrednią próbę zmiany rodzaju/trybu/par/rewanzów, gracza w dwóch parach i gracza obcej ligi w meczu. Publicznego polecenia osobnego generowania terminarza ani ustawiania uczestników klasycznych nie udostępniaj.
- [ ] Zbuduj LeagueForm: konfiguracja → podsumowanie z liczbą meczów i ostrzeżeniem o niezmienności → zatwierdzenie z tokenem. Cofnięcie zachowuje dane lokalnie. Debel Elo pozwala wybrać 5 graczy. Dodaj listę lig z rodzajem, trybem, filtrem i statusami; ustawienia nazwy/usunięcia.
- [ ] Usunięcie ligi blokuje jej wiersz i zachowuje dane. Wszystkie queries na lidze filtrują deleted_at; późniejsze mutacje przechodzą przez getVisibleLeagueForUpdate(em: EntityManager, leagueId: Id): Promise<League>, zdefiniowane w leagues/queries.ts. Rozszerz liczby powiązań gracza przed potwierdzeniem usunięcia.
- [ ] Uruchom schedule/leagues, typecheck i E2E tworzenia obu trybów klasycznych. Commit: feat: create leagues and classic fixtures.

**Odbiór:** 6 singlistów daje 15 lub 30 meczów; 30 z rewanżami daje 870; minimum uczestników i brak podwójnego występu są egzekwowane.
