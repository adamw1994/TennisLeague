import { describe, expect, test } from 'vitest';
import { replayElo } from '@/modules/elo/replay';
import type { ReplayMatch } from '@/modules/elo/types';

const first: ReplayMatch = {
  id: 'match-a',
  version: 1,
  resultRecordedAt: '2026-09-18T10:00:00.000Z',
  sides: [['a'], ['b']],
  winner: 'A',
  k: 32,
};

const second: ReplayMatch = {
  id: 'match-b',
  version: 2,
  resultRecordedAt: '2026-09-18T11:00:00.000Z',
  sides: [['b'], ['a']],
  winner: 'A',
  k: 32,
};

describe('replayElo', () => {
  test('odtwarza chronologię bez mutowania wejścia', () => {
    const matches = [second, first];
    const result = replayElo(['a', 'b', 'idle'], matches);

    expect(matches).toEqual([second, first]);
    expect(result.events.map(event => event.matchId)).toEqual([
      'match-a',
      'match-a',
      'match-b',
      'match-b',
    ]);
    expect(result.ratings).toEqual(new Map([
      ['a', 999],
      ['b', 1001],
      ['idle', 1000],
    ]));
    expect(result.played).toEqual(new Map([
      ['a', 2],
      ['b', 2],
      ['idle', 0],
    ]));
    expect(result.lastDelta.get('idle')).toBeNull();
  });

  test('wynik jest stabilny dla odwróconego, niesortowanego wejścia', () => {
    const forward = replayElo(['a', 'b'], [first, second]);
    const reversed = replayElo(['a', 'b'], [second, first]);

    expect(reversed).toEqual(forward);
  });

  test('identyfikator rozstrzyga mecze z takim samym czasem', () => {
    const sameTime = { ...second, resultRecordedAt: first.resultRecordedAt };
    const result = replayElo(['a', 'b'], [sameTime, first]);

    expect(result.events.map(event => event.matchId)).toEqual([
      'match-a',
      'match-a',
      'match-b',
      'match-b',
    ]);
  });

  test('korekta najstarszego meczu przelicza całą dalszą historię od 1000', () => {
    const original = replayElo(['a', 'b'], [first, second]);
    const corrected = replayElo(
      ['a', 'b'],
      [{ ...first, version: 2, winner: 'B' }, second],
    );

    expect(corrected.events[0]).toMatchObject({
      matchVersion: 2,
      before: 1000,
      calculatedDelta: -16,
    });
    expect(corrected.ratings).not.toEqual(original.ratings);
    expect(corrected.events).toHaveLength(4);
  });

  test('nowy członek użyty po korekcie starszego meczu zaczyna w nim od 1000', () => {
    const result = replayElo(
      ['a', 'b', 'new'],
      [{ ...first, version: 3, sides: [['new'], ['b']] }, second],
    );

    expect(result.events[0]).toMatchObject({ playerId: 'new', before: 1000 });
    expect(result.played.get('new')).toBe(1);
    expect(result.played.get('a')).toBe(1);
  });

  test('obsługuje debel i zapisuje faktyczną ostatnią zmianę', () => {
    const repeatedLosses: ReplayMatch[] = Array.from({ length: 80 }, (_, index) => ({
      id: `loss-${String(index).padStart(3, '0')}`,
      version: 1,
      resultRecordedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      sides: [
        ['a', 'b'],
        ['c', 'd'],
      ],
      winner: 'B',
      k: 60,
    }));
    const result = replayElo(['a', 'b', 'c', 'd'], repeatedLosses);

    expect(result.ratings.get('a')).toBeGreaterThanOrEqual(500);
    expect(result.ratings.get('a')).toBe(result.ratings.get('b'));
    expect(result.lastDelta.get('a')).toBe(-1);
    expect(result.events.at(-4)).toMatchObject({
      playerId: 'a',
      appliedDelta: -1,
    });
  });

  test('liczy tylko zwycięzcę przekazanego przez projekcję wyniku', () => {
    const twoZero = replayElo(['a', 'b'], [first]);
    const twoOne = replayElo(['a', 'b'], [{ ...first, version: 9 }]);

    expect(twoOne.ratings).toEqual(twoZero.ratings);
  });

  test('odrzuca gracza spoza ligi i nieprawidłowy czas', () => {
    expect(() => replayElo(['a'], [first])).toThrow(/not a league member/);
    expect(() =>
      replayElo(['a', 'b'], [{ ...first, resultRecordedAt: 'invalid' }]),
    ).toThrow(/timestamp/);
  });
});
