import type { Id } from '@/shared/contracts';
import {
  calculateElo,
  ELO_INITIAL_RATING,
} from './calculate';
import type { ReplayMatch, ReplayOutput } from './types';

function compareMatches(left: ReplayMatch, right: ReplayMatch): number {
  const timeDifference =
    Date.parse(left.resultRecordedAt) - Date.parse(right.resultRecordedAt);
  if (timeDifference !== 0) return timeDifference;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function validateInput(memberIds: readonly Id[], matches: readonly ReplayMatch[]): void {
  const members = new Set(memberIds);
  if (members.size !== memberIds.length || memberIds.some(id => id.length === 0)) {
    throw new RangeError('Elo member identifiers must be non-empty and unique.');
  }
  const matchIds = new Set<Id>();
  for (const match of matches) {
    if (matchIds.has(match.id)) throw new RangeError('Elo match identifiers must be unique.');
    matchIds.add(match.id);
    if (!match.id || !Number.isInteger(match.version) || match.version < 1) {
      throw new RangeError('An Elo replay match must have an id and positive version.');
    }
    if (!Number.isFinite(Date.parse(match.resultRecordedAt))) {
      throw new RangeError('An Elo replay match must have a valid result timestamp.');
    }
    for (const playerId of [...match.sides[0], ...match.sides[1]]) {
      if (!members.has(playerId)) {
        throw new RangeError(`Elo match player ${playerId} is not a league member.`);
      }
    }
  }
}

export function replayElo(
  memberIds: readonly Id[],
  matches: readonly ReplayMatch[],
): ReplayOutput {
  validateInput(memberIds, matches);
  const ratings = new Map(memberIds.map(playerId => [playerId, ELO_INITIAL_RATING]));
  const played = new Map(memberIds.map(playerId => [playerId, 0]));
  const lastDelta = new Map<Id, number | null>(
    memberIds.map(playerId => [playerId, null]),
  );
  const events: ReplayOutput['events'] = [];

  for (const match of [...matches].sort(compareMatches)) {
    const deltas = calculateElo(match.sides, ratings, match.winner, match.k);
    for (const delta of deltas) {
      ratings.set(delta.playerId, delta.after);
      played.set(delta.playerId, (played.get(delta.playerId) ?? 0) + 1);
      lastDelta.set(delta.playerId, delta.appliedDelta);
      events.push({
        ...delta,
        matchId: match.id,
        matchVersion: match.version,
      });
    }
  }

  return { ratings, events, played, lastDelta };
}
