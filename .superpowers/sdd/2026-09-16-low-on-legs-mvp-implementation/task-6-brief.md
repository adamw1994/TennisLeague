## Task 6: Klasyczny wynik, historia i tabela

**Files:** Utwórz src/modules/tennis/score.entity.ts, src/modules/matches/revision.entity.ts, commands.ts, queries.ts, src/modules/standings/calculate.ts, Migration005Scores.ts; ScoreForm.tsx, Classification.tsx; src/app/leagues/[leagueId]/table/page.tsx, add-result/page.tsx, matches/[matchId]/page.tsx, matches/[matchId]/edit/page.tsx, src/app/matches/actions.ts; tests/unit/standings.test.ts, tests/integration/classic-results.test.ts, tests/e2e/classic.spec.ts.
**Interfaces:** recordClassicResult(em, Versioned & {score: TennisScore}); correctClassicResult(em, Versioned & {score: TennisScore}); getMatch(em,leagueId,matchId); classicStandings(entries: {id,label}[], results: {sideA,sideB,projection:TennisProjection}[]): Standing[]. Standing = {id,label,place,played,won,lost,points,setsFor,setsAgainst,gamesFor,gamesAgainst}.

- [ ] Dodaj test tabeli z wynikiem 2:1 i STB; następnie test pełnego remisu 1,1,3.
~~~ts
test('2:1 daje 4/2, a STB nie dodaje gemów', () => {
  const rows = classicStandings(
    [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    [{ sideA: 'a', sideB: 'b', projection: {
      winner: 'A', setsA: 2, setsB: 1, gamesA: 10, gamesB: 10,
      superTieBreaksA: 1, superTieBreaksB: 0
    } }]
  );
  expect(rows.map(r => [r.points, r.gamesFor, r.gamesAgainst]))
    .toEqual([[4,10,10],[2,10,10]]);
});
~~~
- [ ] Uruchom czerwone testy. Dodaj tennis_match_rules 1:1 i tennis_sets z CHECK kolejności, rodzaju i nieujemnych wyników oraz UNIQUE(match_id,set_order). Format seta jest wyprowadzany z rules, nie osobnym edytowalnym polem. MatchRevision ma UNIQUE(match_id,version), changed_at, komplet stron/formatów/setów/deletedAt w typowanym JSONB oraz powiązanie z meczem.
- [ ] Implementuj transakcję: blokada ligi, następnie meczu; sprawdzenie leagueId i version; walidacja wyniku; zapis setów i reguł; pierwsze result_recorded_at, podniesienie result_version; dopisanie niezmiennej rewizji; ustawienie ligi COMPLETED jeśli brak PENDING. Usunięci gracze wcześniej zaplanowanego meczu są dozwoleni. Korekta zachowuje strony, czas pierwszego zapisu i tworzy kolejną rewizję.
~~~sql
UPDATE matches
SET status = 'COMPLETED', result_version = result_version + 1,
    result_recorded_at = COALESCE(result_recorded_at, clock_timestamp()),
    updated_at = clock_timestamp()
WHERE id = ? AND league_id = ? AND result_version = ?
RETURNING result_version, result_recorded_at;
~~~
To fragment po blokadzie i walidacji; brak wiersza oznacza konflikt. Zapis rewizji, setów i statusu ligi jest częścią tej samej transakcji.
- [ ] Kalkulator sumuje wyniki dla wszystkich uczestników, także bez meczów. Sortuj malejąco po [points,setsDiff,gamesDiff]; remis wyznacza miejsce poprzedniego, kolejny różny wpis dostaje index+1. Nazwa i id zapewniają tylko porządek prezentacji.
- [ ] Zbuduj ScoreForm z polami numerycznymi i etykietami, wyborem wspólnego otwarcia; trzeci set pojawia się dopiero po poprawnych pierwszych setach dających 1:1. Po zmianie na 2:0 usuń trzeci z payloadu. Nie ma daty ani wyboru winner. W klasycznej lidze add-result wybiera istniejący fixture, z kolejką i rewanżem; strony w edycji są tylko do odczytu.
- [ ] Server Actions mapują błędy na pola i rewalidują ligę, listy i profile stron. Tabela używa aktualnych wyników bez cache niezgodnego z mutacjami. Dodaj szczegóły meczu z wynikami setów, sumą gemów, kolejką i „Wynik zapisano”.
- [ ] Testuj dwie edycje tej samej wersji: jeden sukces, jeden konflikt; wcześniejszy wynik/revision nie znika. Testuj próby usunięcia/wyczyszczenia przez bezpośrednią akcję, zapis z przyszłej kolejki, korektę po COMPLETED, zachowanie historii usuniętego gracza i błąd podczas zapisu trzeciego seta.
- [ ] E2E obejmuje pełną ligę dwóch graczy i klasyczny debel, obie punktacje, STB, zakończenie oraz mobilną edycję. Uruchom unit/integration tego zadania, classic.spec.ts, typecheck, lint. Commit: feat: record classic results and standings.

**Odbiór etapu A:** Gracze i klasyczne ligi są używalne; pełna historia wersji i ochrona współbieżności już istnieją.
