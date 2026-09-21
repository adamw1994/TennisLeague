import type { Id, Side, Sides } from '@/shared/contracts';

export interface Delta {
  playerId: Id;
  before: number;
  expected: number;
  actual: 0 | 1;
  k: number;
  calculatedDelta: number;
  appliedDelta: number;
  after: number;
}

export interface ReplayMatch {
  id: Id;
  version: number;
  resultRecordedAt: string;
  sides: Sides;
  winner: Side;
  k: number;
}

export interface ReplayEvent extends Delta {
  matchId: Id;
  matchVersion: number;
}

export interface ReplayOutput {
  ratings: Map<Id, number>;
  events: ReplayEvent[];
  played: Map<Id, number>;
  lastDelta: Map<Id, number | null>;
}
