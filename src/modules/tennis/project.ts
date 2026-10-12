import type { TennisProjection, TennisScore } from './types';

export function projectScore(score: TennisScore): TennisProjection {
  let setsA = 0;
  let setsB = 0;
  let gamesA = 0;
  let gamesB = 0;
  let superTieBreaksA = 0;
  let superTieBreaksB = 0;

  for (const set of score.sets) {
    const sideAWon = set.sideA > set.sideB;
    if (sideAWon) setsA += 1;
    else setsB += 1;

    if (set.kind === 'GAME_SET') {
      gamesA += set.sideA;
      gamesB += set.sideB;
    } else if (sideAWon) {
      superTieBreaksA += 1;
    } else {
      superTieBreaksB += 1;
    }
  }

  return {
    winner: setsA === 2 ? 'A' : 'B',
    setsA,
    setsB,
    gamesA,
    gamesB,
    superTieBreaksA,
    superTieBreaksB,
  };
}
