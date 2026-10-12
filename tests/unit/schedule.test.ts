import { expect, test } from 'vitest';
import { generateSchedule } from '@/modules/leagues/schedule';

function pairKey(a: string, b: string): string {
  return [a, b].sort().join(':');
}

test.each([
  { sides: 5, returnLegs: false, fixtures: 10, rounds: 5 },
  { sides: 6, returnLegs: false, fixtures: 15, rounds: 5 },
  { sides: 6, returnLegs: true, fixtures: 30, rounds: 10 },
  { sides: 30, returnLegs: true, fixtures: 870, rounds: 58 },
])(
  'generuje pełny round-robin dla $sides stron i returnLegs=$returnLegs',
  ({ sides, returnLegs, fixtures, rounds }) => {
    const ids = Array.from({ length: sides }, (_, index) => `side-${index + 1}`);
    const schedule = generateSchedule(ids, returnLegs);

    expect(schedule).toHaveLength(fixtures);
    expect(new Set(schedule.map(fixture => fixture.key))).toHaveLength(fixtures);
    expect(Math.max(...schedule.map(fixture => fixture.round))).toBe(rounds);

    for (let round = 1; round <= rounds; round += 1) {
      const playing = schedule
        .filter(fixture => fixture.round === round)
        .flatMap(fixture => [fixture.sideA, fixture.sideB]);
      expect(new Set(playing)).toHaveLength(playing.length);
    }
  },
);

test('każda para gra raz bez rewanżów i dwa razy z odwróconymi stronami z rewanżami', () => {
  const ids = ['d', 'b', 'a', 'c'];
  const oneLeg = generateSchedule(ids, false);
  const twoLegs = generateSchedule(ids, true);

  const oneLegPairs = new Map<string, number>();
  for (const fixture of oneLeg) {
    const key = pairKey(fixture.sideA, fixture.sideB);
    oneLegPairs.set(key, (oneLegPairs.get(key) ?? 0) + 1);
  }
  expect([...oneLegPairs.values()]).toEqual(Array(6).fill(1));

  for (const first of twoLegs.filter(fixture => fixture.leg === 1)) {
    const reverse = twoLegs.find(
      fixture =>
        fixture.leg === 2 &&
        fixture.sideA === first.sideB &&
        fixture.sideB === first.sideA,
    );
    expect(reverse).toMatchObject({
      key: `${pairKey(first.sideA, first.sideB)}:2`,
      round: first.round + 3,
    });
  }
});

test('wynik jest deterministyczny niezależnie od kolejności wejścia', () => {
  expect(generateSchedule(['c', 'a', 'e', 'b', 'd'], true)).toEqual(
    generateSchedule(['e', 'd', 'c', 'b', 'a'], true),
  );
});

test.each([{ sides: [] }, { sides: ['a'] }, { sides: ['a', 'a'] }])(
  'odrzuca niepoprawny zbiór stron: $sides',
  ({ sides }) => {
    expect(() => generateSchedule(sides, false)).toThrow();
  },
);
