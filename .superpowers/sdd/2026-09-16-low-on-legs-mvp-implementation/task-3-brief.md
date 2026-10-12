## Task 3: Strukturalny wynik tenisowy

**Files:** Utwórz src/modules/tennis/types.ts, validate.ts, project.ts, tests/unit/tennis.test.ts.
**Interfaces:** Produces TennisScore, TennisProjection, validateScore(score): TennisProjection. Nie przyjmuje winner ani daty od klienta.

~~~ts
export type Format = 'FAST4' | 'NORMAL';
export type TennisScore = {
  openingSetFormat: Format;
  decidingSetFormat: Format | 'SUPER_TIE_BREAK' | null;
  sets: { order: number; kind: 'GAME_SET' | 'SUPER_TIE_BREAK';
          sideA: number; sideB: number }[];
};
export type TennisProjection = {
  winner: 'A' | 'B';
  setsA: number; setsB: number; gamesA: number; gamesB: number;
  superTieBreaksA: number; superTieBreaksB: number;
};
~~~

- [ ] Dodaj testy parametryczne legalnych wyników i lustrzanych stron. Główny test regresyjny:
~~~ts
test('super tie-break liczy set, nie gemy', () => {
  expect(validateScore({
    openingSetFormat: 'NORMAL',
    decidingSetFormat: 'SUPER_TIE_BREAK',
    sets: [
      { order: 1, kind: 'GAME_SET', sideA: 6, sideB: 4 },
      { order: 2, kind: 'GAME_SET', sideA: 4, sideB: 6 },
      { order: 3, kind: 'SUPER_TIE_BREAK', sideA: 10, sideB: 8 }
    ]
  })).toEqual({
    winner: 'A', setsA: 2, setsB: 1, gamesA: 10, gamesB: 10,
    superTieBreaksA: 1, superTieBreaksB: 0
  });
});
~~~
- [ ] Uruchom npm run test:unit -- tests/unit/tennis.test.ts i potwierdź czerwony wynik.
- [ ] Zaimplementuj walidację skończonych, bezpiecznych liczb całkowitych ≥0; pozycji 1–3 bez luk; rodzaju wynikającego z formatu. Dla dwóch setów normalizuj decidingSetFormat do null. Odrzucaj trzeci po 2:0 i brak trzeciego po 1:1.
~~~ts
function isFinishedSet(format: Format | 'SUPER_TIE_BREAK', a: number, b: number) {
  if (![a, b].every(v => Number.isSafeInteger(v) && v >= 0)) return false;
  const hi = Math.max(a, b), lo = Math.min(a, b);
  if (format === 'FAST4') return hi === 4 && lo <= 3;
  if (format === 'NORMAL') return (hi === 6 && lo <= 4) ||
    (hi === 7 && (lo === 5 || lo === 6));
  return (hi === 10 && lo <= 8) || (hi > 10 && hi - lo === 2);
}
~~~
- [ ] Iteruj sety, przed każdym sprawdzając czy któraś strona już wygrała dwa; gemy sumuj tylko GAME_SET. Zwróć pola TennisProjection; błąd wskazuje sets.2.sideB lub właściwe pole.
- [ ] Pokryj: Fast4 3:3/5:3, NORMAL 6:5/8:6, STB 10:9/12:8, ujemne, ułamki, NaN, brakujące sety, dodatkowe sety, super tie-break w otwarciu, dwa różne formaty pierwszych setów przez próby przemycenia dodatkowych pól.
- [ ] Uruchom tennis.test.ts i typecheck. Commit: feat: implement tennis score rules.

**Odbiór:** Jedna funkcja obsługuje tworzenie, korekty i statystyki, bez reguł punkt po punkcie.
