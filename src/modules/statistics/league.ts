import type { LeagueKind, Mode } from '@/shared/contracts';

export interface LeagueOverview {
  id: string;
  name: string;
  kind: LeagueKind;
  mode: Mode;
  participantCount: number;
  matchCount: number;
  completedMatchCount: number;
  remainingMatchCount: number;
  completionPercentage: number;
}

export function makeLeagueOverview(input: Omit<LeagueOverview, 'remainingMatchCount' | 'completionPercentage'>): LeagueOverview {
  const remainingMatchCount = Math.max(input.matchCount - input.completedMatchCount, 0);
  return {
    ...input,
    remainingMatchCount,
    completionPercentage: input.matchCount === 0
      ? 0
      : Math.round((input.completedMatchCount / input.matchCount) * 10000) / 100,
  };
}
