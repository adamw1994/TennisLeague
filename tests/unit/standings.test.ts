import { expect, test } from 'vitest';
import { classicStandings } from '@/modules/standings/calculate';
import type { TennisProjection } from '@/modules/tennis/types';

const projection = (
  winner: 'A' | 'B',
  setsA: number,
  setsB: number,
  gamesA: number,
  gamesB: number,
): TennisProjection => ({
  winner,
  setsA,
  setsB,
  gamesA,
  gamesB,
  superTieBreaksA: winner === 'A' && setsB === 1 ? 1 : 0,
  superTieBreaksB: winner === 'B' && setsA === 1 ? 1 : 0,
});

test('wynik 2:1 daje 4/2, a super tie-break nie dodaje gemów', () => {
  const rows = classicStandings(
    [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
    [{ sideA: 'a', sideB: 'b', projection: projection('A', 2, 1, 10, 10) }],
  );

  expect(rows.map(row => [row.points, row.gamesFor, row.gamesAgainst])).toEqual([
    [4, 10, 10],
    [2, 10, 10],
  ]);
});

test('wynik 2:0 daje 5/0 i uwzględnia uczestnika bez meczu', () => {
  const rows = classicStandings(
    [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ],
    [{ sideA: 'a', sideB: 'b', projection: projection('A', 2, 0, 12, 4) }],
  );

  expect(rows.map(row => [row.id, row.points, row.played])).toEqual([
    ['a', 5, 1],
    ['c', 0, 0],
    ['b', 0, 1],
  ]);
});

test('pełny remis daje miejsca 1, 1, 3, a nazwa tylko stabilizuje wyświetlanie', () => {
  const rows = classicStandings(
    [
      { id: 'b', label: 'Beta' },
      { id: 'a', label: 'Alfa' },
      { id: 'c', label: 'Gamma' },
    ],
    [],
  );

  expect(rows.map(row => [row.id, row.place])).toEqual([
    ['a', 1],
    ['b', 1],
    ['c', 1],
  ]);

  const ranked = classicStandings(
    [
      { id: 'a', label: 'Alfa' },
      { id: 'b', label: 'Beta' },
      { id: 'c', label: 'Gamma' },
    ],
    [
      { sideA: 'a', sideB: 'c', projection: projection('A', 2, 0, 12, 2) },
      { sideA: 'b', sideB: 'c', projection: projection('A', 2, 0, 12, 2) },
    ],
  );
  expect(ranked.map(row => [row.id, row.place])).toEqual([
    ['a', 1],
    ['b', 1],
    ['c', 3],
  ]);
});
