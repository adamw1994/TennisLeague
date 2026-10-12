## Task 10: Ranking i czytelny stan obliczeń

**Files:** Utwórz src/app/leagues/[leagueId]/ranking/page.tsx, src/app/api/leagues/[leagueId]/elo-status/route.ts, src/components/EloStatus.tsx; rozszerz Classification.tsx, mecze/queries.ts, elo/queries.ts, strony meczu, listy lig i formularz korekty; tests/integration/elo-queries.test.ts, tests/e2e/elo.spec.ts.
**Interfaces:** GET elo-status → {inputRevision,publishedRevision,state}, Cache-Control: no-store; getEloRanking zwraca jeden kompletny snapshot; getMatch zawiera calculationStatus CURRENT/STALE/PENDING, calculationMatchVersion i zdarzenia odniesione do użytej wersji.

- [ ] Dodaj test niezgodności wyniku i zdarzenia:
~~~ts
test('zmiana składu oznacza poprzednie Elo jako nieaktualne', async () => {
  await withTestDb(async em => {
    const { leagueId, playerIds:[a,b,c] } = await makeEloLeague(em,'SINGLES',3);
    const score: TennisScore = {
      openingSetFormat:'FAST4',decidingSetFormat:null,
      sets:[{order:1,kind:'GAME_SET',sideA:4,sideB:1},
            {order:2,kind:'GAME_SET',sideA:4,sideB:2}]
    };
    const m = await createEloMatch(em,{token:crypto.randomUUID(),
      data:{leagueId,sides:[[a],[b]],score}});
    await correctEloMatch(em,{id:m.id,expectedVersion:m.version,
      leagueId,sides:[[a],[c]],score});
    const dto = await getMatch(em,leagueId,m.id);
    expect(dto.calculationStatus).toBe('STALE');
    expect(dto.calculationMatchVersion).toBe(m.version);
  });
});
~~~
- [ ] Uruchom czerwony test; queries w REPEATABLE READ pobierają pointer publikacji, ratingi i zdarzenia tej samej publikacji. Aktualność wymaga CURRENT i równych rewizji; stary event jest STALE także gdy jego wersja meczu pasuje, ale wcześniejszy mecz zmienił wejście. Brak eventów dla nowego meczu = PENDING.
- [ ] Ranking pokazuje miejsce, pseudonim, rating, played i lastDelta z publikacji; nazwę i znacznik usunięcia z bieżącego gracza. Remisy 1,1,3; porządek pseudonim i id. Nowy członek dołącza do rankingu po publikacji, wcześniej jest w selektorze.
- [ ] EloStatus odczytuje endpoint okresowo, tylko w widocznej karcie; po zmianie publishedRevision/state wywołuje router.refresh(). Obsłuż AbortController, cleanup, błędy sieci i brak nakładających się żądań. Odświeżenie musi działać po pracy workera bez żadnej Server Action użytkownika.
~~~tsx
<p role="status" aria-live="polite">
  {state === 'CURRENT' ? 'Ranking aktualny' :
   state === 'FAILED' ? 'Nie udało się przeliczyć rankingu. Pokazujemy ostatni kompletny ranking.' :
   'Trwa przeliczanie. Pokazujemy ostatni kompletny ranking.'}
</p>
~~~
- [ ] Korekta pokazuje stare/nowe strony, format i sety przed zatwierdzeniem, oraz komunikat o przeliczeniu. Gdy event dotyczy starego składu, ukryj liczby przy nowym składzie; pokaż informację, której wersji dotyczy poprzednie obliczenie. Wynik bieżący widoczny od razu.
- [ ] E2E: singiel i debel Elo, korekta najstarszego meczu, oczekiwanie na worker, FAILED i zapis w FAILED, odzyskanie, usunięcie meczu po potwierdzeniu. Test polling oparty na zmianie DOM i kontrolowanym workerze, bez stałego sleep.
- [ ] Uruchom elo-queries/elo.spec, typecheck, lint. Commit: feat: show consistent Elo rankings and status.

**Odbiór:** UI rozróżnia dane meczu i stan obliczeń, nie miesza rewizji i nie wymaga ręcznego przeładowania po workerze.
