## Task 7: Wspólny kalkulator Elo

**Files:** Utwórz src/modules/elo/types.ts, calculate.ts, replay.ts; tests/unit/elo.test.ts, replay.test.ts.
**Interfaces:** calculateElo(sides: Sides, ratings: ReadonlyMap<Id,number>, winner: Side, k: number): Delta[]; replayElo(memberIds: Id[], matches: ReplayMatch[]): ReplayOutput.
Delta = {playerId,before,expected,actual,k,calculatedDelta,appliedDelta,after}.
ReplayMatch = {id,version,resultRecordedAt: string,sides,winner,k}.
ReplayOutput = {ratings: Map<Id,number>, events: (Delta & {matchId,matchVersion})[], played: Map<Id,number>, lastDelta: Map<Id,number|null>}.

- [ ] Dodaj test równych ratingów i połówki przy K=31.
~~~ts
test('połówki zaokrąglają się od zera', () => {
  const result = calculateElo([['a'],['b']], new Map([['a',1000],['b',1000]]), 'A', 31);
  expect(result.map(r => r.calculatedDelta)).toEqual([16,-16]);
});
test('partnerzy mają różne faktyczne straty przy minimum', () => {
  const ratings = new Map([['a',505],['b',1000],['c',752],['d',753]]);
  const result = calculateElo([['a','b'],['c','d']], ratings, 'B', 32);
  expect(result.slice(0,2).map(r => r.calculatedDelta)).toEqual([-16,-16]);
  expect(result.slice(0,2).map(r => r.appliedDelta)).toEqual([-5,-16]);
});
~~~
- [ ] Uruchom testy czerwone. Zaimplementuj wzór, bez aktualizowania ratingu pierwszego partnera przed policzeniem średniej wszystkich stron.
~~~ts
export const roundAway = (x: number) =>
  x === 0 ? 0 : Math.sign(x) * Math.floor(Math.abs(x) + 0.5);

const expectedA = 1 / (1 + 10 ** ((meanB - meanA) / 400));
const deltaA = roundAway(k * ((winner === 'A' ? 1 : 0) - expectedA));
const deltaB = -deltaA;
// Dla każdego gracza: after = Math.max(500, before + deltaSide).
// appliedDelta = after - before; calculatedDelta = deltaSide.
~~~
- [ ] replayElo inicjalizuje WSZYSTKICH członków od 1000, niezależnie od joinedAt i globalnego usunięcia. Sortuje kopię meczów po resultRecordedAt i id, wywołuje calculateElo, aktualizuje maps. Dane wejściowe zawierają wyłącznie ukończone, nieusunięte mecze; filtracja w snapshot workera.
- [ ] Testuj singiel/debel, K=10/60, odrzucenie 9/61/ułamków, rating 500, rozstrzygnięcie bez wpływu liczby setów, reset po korekcie najstarszego meczu, nowego członka podmienionego do starszego spotkania, niegrającego członka na 1000, stabilny wynik po odwróceniu kolejności niesortowanego wejścia.
- [ ] Uruchom elo/replay i typecheck. Commit: feat: calculate and replay Elo ratings.

**Odbiór:** Append i worker mogą korzystać z jednego kalkulatora; żadna funkcja nie dotyka bazy.
