import { describe, expect, test } from 'vitest';
import {
  calculateElo,
  roundAway,
} from '@/modules/elo/calculate';

describe('calculateElo', () => {
  test('połówki zaokrąglają się od zera', () => {
    const result = calculateElo(
      [['a'], ['b']],
      new Map([
        ['a', 1000],
        ['b', 1000],
      ]),
      'A',
      31,
    );

    expect(result.map(delta => delta.calculatedDelta)).toEqual([16, -16]);
    expect(result.map(delta => delta.after)).toEqual([1016, 984]);
    expect(result.map(delta => delta.expected)).toEqual([0.5, 0.5]);
    expect(result.map(delta => delta.actual)).toEqual([1, 0]);
    expect(roundAway(-15.5)).toBe(-16);
  });

  test('debel liczy średnią stron, a nie rating aktualizowanego partnera', () => {
    const result = calculateElo(
      [
        ['a', 'b'],
        ['c', 'd'],
      ],
      new Map([
        ['a', 900],
        ['b', 1100],
        ['c', 1000],
        ['d', 1000],
      ]),
      'A',
      32,
    );

    expect(result.map(delta => delta.calculatedDelta)).toEqual([16, 16, -16, -16]);
    expect(result.map(delta => delta.before)).toEqual([900, 1100, 1000, 1000]);
  });

  test('partnerzy mają różne faktyczne straty przy minimum', () => {
    const ratings = new Map([
      ['a', 505],
      ['b', 1000],
      ['c', 752],
      ['d', 753],
    ]);
    const result = calculateElo(
      [
        ['a', 'b'],
        ['c', 'd'],
      ],
      ratings,
      'B',
      32,
    );

    expect(result.slice(0, 2).map(delta => delta.calculatedDelta)).toEqual([-16, -16]);
    expect(result.slice(0, 2).map(delta => delta.appliedDelta)).toEqual([-5, -16]);
    expect(result[0]?.after).toBe(500);
    expect(ratings.get('a')).toBe(505);
  });

  test.each([10, 60])('akceptuje graniczny współczynnik K=%i', k => {
    const result = calculateElo(
      [['a'], ['b']],
      new Map([
        ['a', 1000],
        ['b', 1000],
      ]),
      'B',
      k,
    );
    expect(result[0]?.k).toBe(k);
  });

  test.each([9, 61, 10.5])('odrzuca nieprawidłowy współczynnik K=%s', k => {
    expect(() =>
      calculateElo(
        [['a'], ['b']],
        new Map([
          ['a', 1000],
          ['b', 1000],
        ]),
        'A',
        k,
      ),
    ).toThrow(RangeError);
  });

  test('odrzuca brak ratingu, duplikat gracza i nierówne strony', () => {
    expect(() => calculateElo([['a'], ['b']], new Map([['a', 1000]]), 'A', 32))
      .toThrow(/rating/);
    expect(() =>
      calculateElo(
        [['a'], ['a']],
        new Map([['a', 1000]]),
        'A',
        32,
      ),
    ).toThrow(/only once/);
    expect(() =>
      calculateElo(
        [['a'], ['b', 'c']],
        new Map([
          ['a', 1000],
          ['b', 1000],
          ['c', 1000],
        ]),
        'A',
        32,
      ),
    ).toThrow(/one or two/);
  });
});
