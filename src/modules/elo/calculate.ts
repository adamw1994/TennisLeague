import type { Id, Side, Sides } from '@/shared/contracts';
import type { Delta } from './types';

export const ELO_INITIAL_RATING = 1000;
export const ELO_MINIMUM_RATING = 500;
export const ELO_MINIMUM_K = 10;
export const ELO_MAXIMUM_K = 60;

export function roundAway(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Elo delta must be finite.');
  return value === 0
    ? 0
    : Math.sign(value) * Math.floor(Math.abs(value) + 0.5);
}

function validateK(k: number): void {
  if (!Number.isInteger(k) || k < ELO_MINIMUM_K || k > ELO_MAXIMUM_K) {
    throw new RangeError(`Elo K must be an integer from ${ELO_MINIMUM_K} to ${ELO_MAXIMUM_K}.`);
  }
}

function validateSides(sides: Sides): Id[] {
  const [sideA, sideB] = sides;
  if (
    sideA.length !== sideB.length ||
    (sideA.length !== 1 && sideA.length !== 2)
  ) {
    throw new RangeError('Elo sides must contain one or two players each.');
  }
  const playerIds = [...sideA, ...sideB];
  if (playerIds.some(playerId => playerId.length === 0)) {
    throw new RangeError('Elo player identifiers cannot be empty.');
  }
  if (new Set(playerIds).size !== playerIds.length) {
    throw new RangeError('A player can appear only once in an Elo match.');
  }
  return playerIds;
}

function ratingOf(ratings: ReadonlyMap<Id, number>, playerId: Id): number {
  const rating = ratings.get(playerId);
  if (
    rating === undefined ||
    !Number.isInteger(rating) ||
    rating < ELO_MINIMUM_RATING
  ) {
    throw new RangeError(`Invalid Elo rating for player ${playerId}.`);
  }
  return rating;
}

function mean(playerIds: readonly Id[], ratings: ReadonlyMap<Id, number>): number {
  return (
    playerIds.reduce((sum, playerId) => sum + ratingOf(ratings, playerId), 0) /
    playerIds.length
  );
}

export function calculateElo(
  sides: Sides,
  ratings: ReadonlyMap<Id, number>,
  winner: Side,
  k: number,
): Delta[] {
  validateK(k);
  const playerIds = validateSides(sides);
  if (winner !== 'A' && winner !== 'B') {
    throw new RangeError('Elo winner must be side A or B.');
  }

  // Both means are derived before any player's new rating is calculated.
  const meanA = mean(sides[0], ratings);
  const meanB = mean(sides[1], ratings);
  const expectedA = 1 / (1 + 10 ** ((meanB - meanA) / 400));
  const actualA: 0 | 1 = winner === 'A' ? 1 : 0;
  const deltaA = roundAway(k * (actualA - expectedA));
  const deltaB = -deltaA;

  return playerIds.map((playerId, index) => {
    const onSideA = index < sides[0].length;
    const before = ratingOf(ratings, playerId);
    const calculatedDelta = onSideA ? deltaA : deltaB;
    const after = Math.max(ELO_MINIMUM_RATING, before + calculatedDelta);
    return {
      playerId,
      before,
      expected: onSideA ? expectedA : 1 - expectedA,
      actual: onSideA ? actualA : actualA === 1 ? 0 : 1,
      k,
      calculatedDelta,
      appliedDelta: after - before,
      after,
    };
  });
}
