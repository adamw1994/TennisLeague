import { DomainError } from '@/shared/errors';

export interface Fixture {
  key: string;
  round: number;
  leg: 1 | 2;
  sideA: string;
  sideB: string;
}

function fixtureKey(sideA: string, sideB: string, leg: 1 | 2): string {
  return `${[sideA, sideB].sort().join(':')}:${leg}`;
}

/**
 * Deterministyczny algorytm kołowy. Sortowanie identyfikatorów sprawia, że ten
 * sam zbiór uczestników zawsze daje identyczny terminarz i klucze spotkań.
 */
export function generateSchedule(
  sideIds: string[],
  returnLegs: boolean,
): Fixture[] {
  const sides = [...sideIds].sort();
  if (sides.length < 2 || new Set(sides).size !== sides.length) {
    throw new DomainError('VALIDATION', {
      playerIds: 'Terminarz wymaga co najmniej dwóch różnych stron.',
    });
  }

  const ring: Array<string | null> =
    sides.length % 2 === 0 ? sides : [...sides, null];
  const roundsPerLeg = ring.length - 1;
  const fixtures: Fixture[] = [];
  let current = [...ring];

  for (let round = 1; round <= roundsPerLeg; round += 1) {
    for (let index = 0; index < current.length / 2; index += 1) {
      const left = current[index];
      const right = current[current.length - 1 - index];
      if (left === null || left === undefined || right === null || right === undefined) {
        continue;
      }

      // Naprzemienny gospodarz dla nieruchomej pierwszej strony ogranicza
      // jednostronność kolejnych kolejek, nie wpływając na kompletność grafu.
      const [sideA, sideB] =
        index === 0 && round % 2 === 0 ? [right, left] : [left, right];
      fixtures.push({
        key: fixtureKey(sideA, sideB, 1),
        round,
        leg: 1,
        sideA,
        sideB,
      });
    }

    current = [current[0] ?? null, current.at(-1) ?? null, ...current.slice(1, -1)];
  }

  if (returnLegs) {
    fixtures.push(
      ...fixtures.map(fixture => ({
        key: fixtureKey(fixture.sideA, fixture.sideB, 2),
        round: fixture.round + roundsPerLeg,
        leg: 2 as const,
        sideA: fixture.sideB,
        sideB: fixture.sideA,
      })),
    );
  }

  return fixtures;
}
