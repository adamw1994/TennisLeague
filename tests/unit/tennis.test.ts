import { expect, test } from 'vitest';
import { DomainError } from '@/shared/errors';
import {
  normalizeScore,
  validateScore,
} from '@/modules/tennis/validate';
import type { TennisScore } from '@/modules/tennis/types';

function expectInvalidScore(input: unknown, field: string | RegExp) {
  try {
    validateScore(input);
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: 'INVALID_TENNIS_SCORE' });
    const fields = (error as DomainError).fields ?? {};
    if (typeof field === 'string') {
      expect(fields).toEqual(
        expect.objectContaining({ [field]: expect.any(String) }),
      );
    } else {
      expect(Object.keys(fields).some((path) => field.test(path))).toBe(true);
    }
    return;
  }

  throw new Error('Oczekiwano odrzucenia nieprawidłowego wyniku');
}

const legalStraightSets: {
  name: string;
  openingSetFormat: TennisScore['openingSetFormat'];
  first: readonly [number, number];
  second: readonly [number, number];
  expectedGames: readonly [number, number];
}[] = [
  {
    name: 'Fast4 do zera i po tie-breaku',
    openingSetFormat: 'FAST4',
    first: [4, 0],
    second: [4, 3],
    expectedGames: [8, 3],
  },
  {
    name: 'normalne sety 6:4 i 7:5',
    openingSetFormat: 'NORMAL',
    first: [6, 4],
    second: [7, 5],
    expectedGames: [13, 9],
  },
  {
    name: 'normalne sety 7:6 i 6:0',
    openingSetFormat: 'NORMAL',
    first: [7, 6],
    second: [6, 0],
    expectedGames: [13, 6],
  },
];

test.each(legalStraightSets)(
  'akceptuje $name oraz lustrzane strony',
  ({ openingSetFormat, first, second, expectedGames }) => {
    const score = {
      openingSetFormat,
      decidingSetFormat: 'SUPER_TIE_BREAK' as const,
      sets: [
        { order: 1, kind: 'GAME_SET' as const, sideA: first[0], sideB: first[1] },
        { order: 2, kind: 'GAME_SET' as const, sideA: second[0], sideB: second[1] },
      ],
    };

    expect(validateScore(score)).toEqual({
      winner: 'A',
      setsA: 2,
      setsB: 0,
      gamesA: expectedGames[0],
      gamesB: expectedGames[1],
      superTieBreaksA: 0,
      superTieBreaksB: 0,
    });
    expect(
      validateScore({
        ...score,
        sets: score.sets.map((set) => ({
          ...set,
          sideA: set.sideB,
          sideB: set.sideA,
        })),
      }),
    ).toEqual({
      winner: 'B',
      setsA: 0,
      setsB: 2,
      gamesA: expectedGames[1],
      gamesB: expectedGames[0],
      superTieBreaksA: 0,
      superTieBreaksB: 0,
    });
  },
);

test('super tie-break liczy set, nie gemy', () => {
  expect(
    validateScore({
      openingSetFormat: 'NORMAL',
      decidingSetFormat: 'SUPER_TIE_BREAK',
      sets: [
        { order: 1, kind: 'GAME_SET', sideA: 6, sideB: 4 },
        { order: 2, kind: 'GAME_SET', sideA: 4, sideB: 6 },
        { order: 3, kind: 'SUPER_TIE_BREAK', sideA: 10, sideB: 8 },
      ],
    }),
  ).toEqual({
    winner: 'A',
    setsA: 2,
    setsB: 1,
    gamesA: 10,
    gamesB: 10,
    superTieBreaksA: 1,
    superTieBreaksB: 0,
  });
});

test.each([
  ['FAST4', 4, 3],
  ['NORMAL', 7, 6],
  ['SUPER_TIE_BREAK', 10, 8],
  ['SUPER_TIE_BREAK', 11, 9],
] as const)('akceptuje trzeci set %s i jego lustrzany wynik', (format, sideA, sideB) => {
  const kind = format === 'SUPER_TIE_BREAK' ? 'SUPER_TIE_BREAK' : 'GAME_SET';
  const score = {
    openingSetFormat: 'NORMAL' as const,
    decidingSetFormat: format,
    sets: [
      { order: 1, kind: 'GAME_SET' as const, sideA: 6, sideB: 4 },
      { order: 2, kind: 'GAME_SET' as const, sideA: 4, sideB: 6 },
      { order: 3, kind, sideA, sideB },
    ],
  };

  expect(validateScore(score).winner).toBe('A');
  expect(
    validateScore({
      ...score,
      sets: score.sets.map((set) => ({
        ...set,
        sideA: set.sideB,
        sideB: set.sideA,
      })),
    }).winner,
  ).toBe('B');
});

test('normalizuje format decydującego seta dla wyniku 2:0 bez mutowania wejścia', () => {
  const score: TennisScore = {
    openingSetFormat: 'FAST4',
    decidingSetFormat: 'NORMAL',
    sets: [
      { order: 1, kind: 'GAME_SET', sideA: 4, sideB: 1 },
      { order: 2, kind: 'GAME_SET', sideA: 4, sideB: 2 },
    ],
  };

  const normalized = normalizeScore(score);

  expect(normalized).toEqual({ ...score, decidingSetFormat: null });
  expect(normalized).not.toBe(score);
  expect(normalized.sets).not.toBe(score.sets);
  expect(score.decidingSetFormat).toBe('NORMAL');
});

test.each([
  ['Fast4 3:3', 'FAST4', 3, 3],
  ['Fast4 5:3', 'FAST4', 5, 3],
  ['normalny 6:5', 'NORMAL', 6, 5],
  ['normalny 8:6', 'NORMAL', 8, 6],
] as const)('odrzuca niedozwolony set: %s', (_name, format, sideA, sideB) => {
  const validWinningScore = format === 'FAST4' ? 4 : 6;
  expectInvalidScore(
    {
      openingSetFormat: format,
      decidingSetFormat: null,
      sets: [
        { order: 1, kind: 'GAME_SET', sideA, sideB },
        {
          order: 2,
          kind: 'GAME_SET',
          sideA: validWinningScore,
          sideB: 0,
        },
      ],
    },
    'sets.0.sideB',
  );
});

test.each([
  ['10:9', 10, 9],
  ['12:8', 12, 8],
] as const)('odrzuca niedozwolony super tie-break %s', (_name, sideA, sideB) => {
  expectInvalidScore(
    {
      openingSetFormat: 'NORMAL',
      decidingSetFormat: 'SUPER_TIE_BREAK',
      sets: [
        { order: 1, kind: 'GAME_SET', sideA: 6, sideB: 2 },
        { order: 2, kind: 'GAME_SET', sideA: 2, sideB: 6 },
        { order: 3, kind: 'SUPER_TIE_BREAK', sideA, sideB },
      ],
    },
    'sets.2.sideB',
  );
});

test.each([
  ['ujemny', -1],
  ['ułamek', 3.5],
  ['NaN', Number.NaN],
  ['nieskończony', Number.POSITIVE_INFINITY],
  ['niebezpieczna liczba całkowita', Number.MAX_SAFE_INTEGER + 1],
] as const)('odrzuca wynik liczbowy: %s', (_name, sideB) => {
  expectInvalidScore(
    {
      openingSetFormat: 'NORMAL',
      decidingSetFormat: null,
      sets: [
        { order: 1, kind: 'GAME_SET', sideA: 6, sideB },
        { order: 2, kind: 'GAME_SET', sideA: 6, sideB: 0 },
      ],
    },
    'sets.0.sideB',
  );
});

test('wymaga kolejnych pozycji setów od 1 bez luk', () => {
  expectInvalidScore(
    {
      openingSetFormat: 'NORMAL',
      decidingSetFormat: null,
      sets: [
        { order: 1, kind: 'GAME_SET', sideA: 6, sideB: 0 },
        { order: 3, kind: 'GAME_SET', sideA: 6, sideB: 1 },
      ],
    },
    'sets.1.order',
  );
});

test('odrzuca brak trzeciego seta po 1:1', () => {
  expectInvalidScore(
    {
      openingSetFormat: 'NORMAL',
      decidingSetFormat: null,
      sets: [
        { order: 1, kind: 'GAME_SET', sideA: 6, sideB: 1 },
        { order: 2, kind: 'GAME_SET', sideA: 2, sideB: 6 },
      ],
    },
    'sets',
  );
});

test('odrzuca trzeci set po rozstrzygnięciu 2:0', () => {
  expectInvalidScore(
    {
      openingSetFormat: 'NORMAL',
      decidingSetFormat: 'NORMAL',
      sets: [
        { order: 1, kind: 'GAME_SET', sideA: 6, sideB: 1 },
        { order: 2, kind: 'GAME_SET', sideA: 6, sideB: 2 },
        { order: 3, kind: 'GAME_SET', sideA: 6, sideB: 3 },
      ],
    },
    'sets.2',
  );
});

test('odrzuca dodatkowy czwarty set', () => {
  expectInvalidScore(
    {
      openingSetFormat: 'NORMAL',
      decidingSetFormat: 'NORMAL',
      sets: [
        { order: 1, kind: 'GAME_SET', sideA: 6, sideB: 1 },
        { order: 2, kind: 'GAME_SET', sideA: 2, sideB: 6 },
        { order: 3, kind: 'GAME_SET', sideA: 6, sideB: 3 },
        { order: 4, kind: 'GAME_SET', sideA: 6, sideB: 4 },
      ],
    },
    'sets',
  );
});

test('odrzuca super tie-break w jednym z dwóch pierwszych setów', () => {
  expectInvalidScore(
    {
      openingSetFormat: 'NORMAL',
      decidingSetFormat: null,
      sets: [
        { order: 1, kind: 'SUPER_TIE_BREAK', sideA: 10, sideB: 8 },
        { order: 2, kind: 'GAME_SET', sideA: 6, sideB: 2 },
      ],
    },
    'sets.0.kind',
  );
});

test('rodzaj trzeciego seta musi wynikać z formatu decydującego', () => {
  expectInvalidScore(
    {
      openingSetFormat: 'NORMAL',
      decidingSetFormat: 'SUPER_TIE_BREAK',
      sets: [
        { order: 1, kind: 'GAME_SET', sideA: 6, sideB: 1 },
        { order: 2, kind: 'GAME_SET', sideA: 2, sideB: 6 },
        { order: 3, kind: 'GAME_SET', sideA: 6, sideB: 3 },
      ],
    },
    'sets.2.kind',
  );
});

test.each([
  {
    openingSetFormat: 'NORMAL',
    decidingSetFormat: null,
    sets: [
      { order: 1, kind: 'GAME_SET', sideA: 6, sideB: 0, format: 'FAST4' },
      { order: 2, kind: 'GAME_SET', sideA: 6, sideB: 1 },
    ],
  },
  {
    openingSetFormat: 'FAST4',
    decidingSetFormat: null,
    sets: [
      { order: 1, kind: 'GAME_SET', sideA: 4, sideB: 0 },
      { order: 2, kind: 'GAME_SET', sideA: 4, sideB: 1, openingSetFormat: 'NORMAL' },
    ],
  },
])('odrzuca próbę przemycenia innego formatu w setach otwierających', (score) => {
  expectInvalidScore(score, /^sets\.[01]\./);
});

test('odrzuca nieznane pola obiektu głównego', () => {
  expectInvalidScore(
    {
      openingSetFormat: 'NORMAL',
      decidingSetFormat: null,
      winner: 'A',
      sets: [
        { order: 1, kind: 'GAME_SET', sideA: 6, sideB: 0 },
        { order: 2, kind: 'GAME_SET', sideA: 6, sideB: 1 },
      ],
    },
    'winner',
  );
});
