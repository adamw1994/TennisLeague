## Task 11: Profile, statystyki i pełna nawigacja

**Files:** Utwórz src/modules/statistics/player.ts, league.ts, queries.ts, src/components/Pagination.tsx; rozbuduj src/app/page.tsx, players/[playerId]/page.tsx, leagues/[leagueId]/page.tsx, listy graczy/lig/meczów, globals.css, error.tsx, not-found.tsx; tests/unit/statistics.test.ts, tests/integration/visibility.test.ts, tests/e2e/navigation.spec.ts.
**Interfaces:** playerStatistics(playerId:Id,matches: {sides:Sides,projection:TennisProjection}[]): PlayerStats; getPlayerStatistics(em,{playerId,mode,leagueId?}); getLeagueOverview(em,leagueId); listLeagueMatches(em,{leagueId,cursor?,status?,round?}). PlayerStats = {played,won,lost,winPercentage:number|null,setsFor,setsAgainst,setsDiff,gamesFor,gamesAgainst,gamesDiff,superTieBreaksPlayed,superTieBreaksWon,superTieBreaksLost,superTieBreaksDiff}.

- [ ] Dodaj test pełnego wyniku strony dla obu partnerów.
~~~ts
test('każdy partner dostaje cały wynik strony', () => {
  const match = {sides:[['a','b'],['c','d']] as Sides, projection:{
    winner:'A' as const,setsA:2,setsB:1,gamesA:10,gamesB:10,
    superTieBreaksA:1,superTieBreaksB:0
  }};
  expect(playerStatistics('a',[match])).toEqual(playerStatistics('b',[match]));
  expect(playerStatistics('a',[match])).toMatchObject({
    played:1,won:1,setsFor:2,gamesFor:10,superTieBreaksWon:1
  });
  expect(playerStatistics('e',[]).winPercentage).toBeNull();
});
~~~
- [ ] Uruchom czerwony test. Agreguj per mecz i strona, nie per wiersz join set × gracz. W widoku ligi licz COUNT(DISTINCT match.id), a gemy/sety przez projekcję meczu. Nie sumuj ratingów między ligami.
- [ ] Każdy odczyt historii i statystyk wymaga league.deleted_at IS NULL; dodatkowo mecz ukończony i nieusunięty. Historyczne joiny players nie filtrują deleted_at. Profil usuniętego gracza pod bezpośrednim adresem pokazuje oznaczenie i zachowaną historię; globalna lista go ukrywa.
- [ ] Profile mają osobne zakładki Singiel/Debel, filtr ligi, historię, statystyki i osobne ratingi poszczególnych lig. Puste dane pokazują „Brak rozegranych meczów”, procent jako „—”, nie 0%.
- [ ] Strona główna: aktywne ligi, ostatnie wyniki, linki do graczy i lig, przyciski dodania gracza/ligi. Szczegóły ligi: właściwy typ klasyfikacji, liczby spotkań, zakończone/pozostałe i procent dla klasycznej. Bez pustej zakładki rankingu/tabeli niewłaściwego rodzaju.
- [ ] Dodaj stronicowanie stabilnym kursorem (czas,id), filtry rodzaju/statusu ligi i kolejki/statusu meczu; wyszukiwanie graczy po pseudonimie i nazwisku. Zapytania mają jawne indeksy; nie pobieraj osobno meczu dla każdego gracza.
- [ ] Sprawdź usunięcie ligi w każdym punkcie: home, players list counts, profil i filtr lig, historia, statystyki, direct URL ligi/meczu, ranking/status endpoint i stary formularz. Awatar globalnego gracza nie zależy od ligi. Dla usuniętych zasobów ligi zwracaj jednolity NOT_FOUND.
- [ ] Dostępność: semantyczne nagłówki/tabele, widoczny focus, label i aria-describedby dla błędów, przyciski klawiaturą, dialog z przywróceniem focus, tabele jako karty na małym ekranie. Daty przez Intl.DateTimeFormat('pl-PL',{timeZone:'Europe/Warsaw',dateStyle:'short',timeStyle:'short'}).
- [ ] Uruchom statistics/visibility/navigation, typecheck, lint. Commit: feat: add player statistics and application navigation.

**Odbiór etapu B:** Wszystkie ekrany z mapy projektu działają dla obu rodzajów lig i trybów gry.
