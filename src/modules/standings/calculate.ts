import type { Id } from '@/shared/contracts';
import type { TennisProjection } from '@/modules/tennis/types';

export interface Standing {
  id: Id;
  label: string;
  place: number;
  played: number;
  won: number;
  lost: number;
  points: number;
  setsFor: number;
  setsAgainst: number;
  gamesFor: number;
  gamesAgainst: number;
}

interface Entry {
  id: Id;
  label: string;
}

interface Result {
  sideA: Id;
  sideB: Id;
  projection: TennisProjection;
}

function scoreDifference(row: Standing): readonly [number, number, number] {
  return [
    row.points,
    row.setsFor - row.setsAgainst,
    row.gamesFor - row.gamesAgainst,
  ];
}

function sameSportingResult(left: Standing, right: Standing): boolean {
  const a = scoreDifference(left);
  const b = scoreDifference(right);
  return a.every((value, index) => value === b[index]);
}

export function classicStandings(entries: Entry[], results: Result[]): Standing[] {
  const rows = new Map<Id, Standing>();
  for (const entry of entries) {
    rows.set(entry.id, {
      id: entry.id,
      label: entry.label,
      place: 0,
      played: 0,
      won: 0,
      lost: 0,
      points: 0,
      setsFor: 0,
      setsAgainst: 0,
      gamesFor: 0,
      gamesAgainst: 0,
    });
  }

  for (const result of results) {
    const sideA = rows.get(result.sideA);
    const sideB = rows.get(result.sideB);
    if (!sideA || !sideB || sideA.id === sideB.id) continue;
    const { projection } = result;
    sideA.played += 1;
    sideB.played += 1;
    sideA.setsFor += projection.setsA;
    sideA.setsAgainst += projection.setsB;
    sideB.setsFor += projection.setsB;
    sideB.setsAgainst += projection.setsA;
    sideA.gamesFor += projection.gamesA;
    sideA.gamesAgainst += projection.gamesB;
    sideB.gamesFor += projection.gamesB;
    sideB.gamesAgainst += projection.gamesA;

    const winner = projection.winner === 'A' ? sideA : sideB;
    const loser = projection.winner === 'A' ? sideB : sideA;
    winner.won += 1;
    loser.lost += 1;
    if (Math.min(projection.setsA, projection.setsB) === 0) {
      winner.points += 5;
    } else {
      winner.points += 4;
      loser.points += 2;
    }
  }

  const sorted = [...rows.values()].sort((left, right) => {
    const leftScore = scoreDifference(left);
    const rightScore = scoreDifference(right);
    for (let index = 0; index < leftScore.length; index += 1) {
      const difference = rightScore[index]! - leftScore[index]!;
      if (difference !== 0) return difference;
    }
    return left.label.localeCompare(right.label, 'pl') || left.id.localeCompare(right.id);
  });

  const ranked: Standing[] = [];
  for (const [index, row] of sorted.entries()) {
    const previous = ranked.at(-1);
    ranked.push({
      ...row,
      place:
        previous && sameSportingResult(row, previous) ? previous.place : index + 1,
    });
  }
  return ranked;
}
