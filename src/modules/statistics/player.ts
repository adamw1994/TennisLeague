import type { Sides, Id, Mode } from '@/shared/contracts';
import type { TennisProjection } from '@/modules/tennis/types';

export interface PlayerStats {
  played: number;
  won: number;
  lost: number;
  winPercentage: number | null;
  setsFor: number;
  setsAgainst: number;
  setsDiff: number;
  gamesFor: number;
  gamesAgainst: number;
  gamesDiff: number;
  superTieBreaksPlayed: number;
  superTieBreaksWon: number;
  superTieBreaksLost: number;
  superTieBreaksDiff: number;
}

export interface PlayerStatisticsMatch {
  sides: Sides;
  projection: TennisProjection;
  mode?: Mode;
}

export function emptyPlayerStats(): PlayerStats {
  return {
    played: 0,
    won: 0,
    lost: 0,
    winPercentage: null,
    setsFor: 0,
    setsAgainst: 0,
    setsDiff: 0,
    gamesFor: 0,
    gamesAgainst: 0,
    gamesDiff: 0,
    superTieBreaksPlayed: 0,
    superTieBreaksWon: 0,
    superTieBreaksLost: 0,
    superTieBreaksDiff: 0,
  };
}

/**
 * Aggregates one result per match and per side. In doubles every partner is
 * deliberately given the complete result of their side.
 */
export function playerStatistics(
  playerId: Id,
  matches: PlayerStatisticsMatch[],
): PlayerStats {
  const stats = emptyPlayerStats();

  for (const match of matches) {
    const sideIndex = match.sides.findIndex(side => side.includes(playerId));
    if (sideIndex < 0) continue;

    const isA = sideIndex === 0;
    const ownSets = isA ? match.projection.setsA : match.projection.setsB;
    const opponentSets = isA ? match.projection.setsB : match.projection.setsA;
    const ownGames = isA ? match.projection.gamesA : match.projection.gamesB;
    const opponentGames = isA ? match.projection.gamesB : match.projection.gamesA;
    const ownSuperTieBreaks = isA
      ? match.projection.superTieBreaksA
      : match.projection.superTieBreaksB;
    const opponentSuperTieBreaks = isA
      ? match.projection.superTieBreaksB
      : match.projection.superTieBreaksA;
    const won = (isA && match.projection.winner === 'A') ||
      (!isA && match.projection.winner === 'B');

    stats.played += 1;
    if (won) stats.won += 1;
    else stats.lost += 1;
    stats.setsFor += ownSets;
    stats.setsAgainst += opponentSets;
    stats.gamesFor += ownGames;
    stats.gamesAgainst += opponentGames;
    stats.superTieBreaksPlayed += ownSuperTieBreaks + opponentSuperTieBreaks;
    stats.superTieBreaksWon += ownSuperTieBreaks;
    stats.superTieBreaksLost += opponentSuperTieBreaks;
  }

  stats.setsDiff = stats.setsFor - stats.setsAgainst;
  stats.gamesDiff = stats.gamesFor - stats.gamesAgainst;
  stats.superTieBreaksDiff = stats.superTieBreaksWon - stats.superTieBreaksLost;
  stats.winPercentage = stats.played === 0
    ? null
    : Math.round((stats.won / stats.played) * 10000) / 100;
  return stats;
}
