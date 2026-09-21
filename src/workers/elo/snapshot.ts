import type { EntityManager } from '@mikro-orm/postgresql';
import { IsolationLevel } from '@mikro-orm/core';
import type { ReplayMatch } from '@/modules/elo/types';
import type { TennisScore } from '@/modules/tennis/types';
import type { Id, Sides } from '@/shared/contracts';
import { DomainError } from '@/shared/errors';
import type { Claim } from './claim';

export interface Snapshot {
  leagueId: Id;
  revision: string;
  memberIds: string[];
  matches: ReplayMatch[];
}

interface MatchRow {
  id: string;
  version: number;
  result_recorded_at: Date | string;
  elo_k_snapshot: number;
  opening_set_format: TennisScore['openingSetFormat'];
  deciding_set_format: TennisScore['decidingSetFormat'];
}

interface SideRow {
  match_id: string;
  side_number: 1 | 2;
  player_ids: string[];
}

interface SetRow {
  match_id: string;
  set_order: number;
  kind: 'GAME_SET' | 'SUPER_TIE_BREAK';
  side_1_score: number;
  side_2_score: number;
}

async function readSnapshotTransaction(
  em: EntityManager,
  claim: Claim,
): Promise<Snapshot | null> {
  const connection = em.getConnection();
  const transaction = em.getTransactionContext();
  const [job] = await connection.execute<Array<{
    league_id: string;
    requested_revision: string;
  }>>(
    `select league_id, requested_revision
       from elo_recalculation_jobs
      where id = ? and league_id = ? and claim_token = ?
        and status = 'RUNNING' and lease_until > clock_timestamp()`,
    [claim.jobId, claim.leagueId, claim.claimToken],
    'all',
    transaction,
  );
  if (!job) return null;
  const [league] = await connection.execute<Array<{
    input_revision: string;
    deleted_at: Date | string | null;
  }>>(
    `select input_revision, deleted_at
       from leagues where id = ? and kind = 'ELO_INFINITE'`,
    [claim.leagueId],
    'all',
    transaction,
  );
  if (!league || league.deleted_at) return null;

  const members = await connection.execute<Array<{ player_id: string }>>(
    `select player_id from league_players where league_id = ? order by player_id`,
    [claim.leagueId],
    'all',
    transaction,
  );
  const matches = await connection.execute<MatchRow[]>(
    `select m.id, m.result_version as version, m.result_recorded_at,
            m.elo_k_snapshot, r.opening_set_format, r.deciding_set_format
       from matches m
       join match_revisions mr on mr.match_id = m.id and mr.version = m.result_version
       join tennis_match_rules r on r.match_id = m.id
      where m.league_id = ? and m.status = 'COMPLETED'
        and m.deleted_at is null and m.elo_k_snapshot is not null
      order by m.result_recorded_at, m.id`,
    [claim.leagueId],
    'all',
    transaction,
  );
  const sideRows = await connection.execute<SideRow[]>(
    `select ms.match_id, ms.side_number,
            array_agg(msp.player_id order by msp.position) as player_ids
       from match_sides ms
       join match_side_players msp
         on msp.side_id = ms.id and msp.match_id = ms.match_id
        and msp.league_id = ms.league_id
      where ms.league_id = ?
        and exists (
          select 1 from matches m
           where m.id = ms.match_id and m.deleted_at is null
             and m.status = 'COMPLETED'
        )
      group by ms.match_id, ms.side_number
      order by ms.match_id, ms.side_number`,
    [claim.leagueId],
    'all',
    transaction,
  );
  const setRows = await connection.execute<SetRow[]>(
    `select ts.match_id, ts.set_order, ts.kind, ts.side_1_score, ts.side_2_score
       from tennis_sets ts
       join matches m on m.id = ts.match_id
      where m.league_id = ? and m.status = 'COMPLETED' and m.deleted_at is null
      order by ts.match_id, ts.set_order`,
    [claim.leagueId],
    'all',
    transaction,
  );
  const sidesByMatch = new Map<string, Sides>();
  for (const side of sideRows) {
    const current = sidesByMatch.get(side.match_id) ?? [[], []];
    sidesByMatch.set(
      side.match_id,
      side.side_number === 1
        ? [side.player_ids, current[1]]
        : [current[0], side.player_ids],
    );
  }
  const setsByMatch = new Map<string, SetRow[]>();
  for (const set of setRows) {
    const current = setsByMatch.get(set.match_id) ?? [];
    current.push(set);
    setsByMatch.set(set.match_id, current);
  }
  const replayMatches: ReplayMatch[] = [];
  for (const match of matches) {
    const sides = sidesByMatch.get(match.id);
    const sets = setsByMatch.get(match.id);
    if (!sides || !sides[0].length || !sides[1].length || !sets?.length) {
      throw new DomainError('ELO_RECALCULATION_FAILED');
    }
    const score: TennisScore = {
      openingSetFormat: match.opening_set_format,
      decidingSetFormat: match.deciding_set_format,
      sets: sets.map(set => ({
        order: set.set_order,
        kind: set.kind,
        sideA: set.side_1_score,
        sideB: set.side_2_score,
      })),
    };
    const setsA = score.sets.filter(set => set.sideA > set.sideB).length;
    replayMatches.push({
      id: match.id,
      version: match.version,
      resultRecordedAt: new Date(match.result_recorded_at).toISOString(),
      sides,
      winner: setsA >= 2 ? 'A' : 'B',
      k: match.elo_k_snapshot,
    });
  }
  return {
    leagueId: claim.leagueId,
    revision: String(league.input_revision),
    memberIds: members.map(member => member.player_id),
    matches: replayMatches,
  };
}

export async function readSnapshot(
  em: EntityManager,
  claim: Claim,
): Promise<Snapshot | null> {
  return em.transactional(
    tx => readSnapshotTransaction(tx, claim),
    { isolationLevel: IsolationLevel.REPEATABLE_READ },
  );
}
