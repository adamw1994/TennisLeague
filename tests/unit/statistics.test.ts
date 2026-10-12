import { expect, test } from 'vitest';
import type { Sides } from '@/shared/contracts';
import { playerStatistics } from '@/modules/statistics/player';

test('każdy partner dostaje cały wynik swojej strony', () => {
  const match = {
    sides: [['a', 'b'], ['c', 'd']] as Sides,
    projection: {
      winner: 'A' as const,
      setsA: 2,
      setsB: 1,
      gamesA: 10,
      gamesB: 10,
      superTieBreaksA: 1,
      superTieBreaksB: 0,
    },
  };

  expect(playerStatistics('a', [match])).toEqual(playerStatistics('b', [match]));
  expect(playerStatistics('a', [match])).toMatchObject({
    played: 1,
    won: 1,
    setsFor: 2,
    gamesFor: 10,
    superTieBreaksPlayed: 1,
    superTieBreaksWon: 1,
  });
  expect(playerStatistics('e', []).winPercentage).toBeNull();
});

test('sumuje stronę raz na mecz i liczy bilanse', () => {
  const result = playerStatistics('a', [
    {
      sides: [['a'], ['b']],
      projection: {
        winner: 'B',
        setsA: 1,
        setsB: 2,
        gamesA: 8,
        gamesB: 11,
        superTieBreaksA: 0,
        superTieBreaksB: 1,
      },
    },
    {
      sides: [['a'], ['c']],
      projection: {
        winner: 'A',
        setsA: 2,
        setsB: 0,
        gamesA: 8,
        gamesB: 2,
        superTieBreaksA: 0,
        superTieBreaksB: 0,
      },
    },
  ]);

  expect(result).toEqual({
    played: 2,
    won: 1,
    lost: 1,
    winPercentage: 50,
    setsFor: 3,
    setsAgainst: 2,
    setsDiff: 1,
    gamesFor: 16,
    gamesAgainst: 13,
    gamesDiff: 3,
    superTieBreaksPlayed: 1,
    superTieBreaksWon: 0,
    superTieBreaksLost: 1,
    superTieBreaksDiff: -1,
  });
});
