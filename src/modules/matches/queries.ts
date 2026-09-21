import type { EntityManager } from '@mikro-orm/postgresql';
import { IsolationLevel } from '@mikro-orm/core';
import { z } from 'zod';
import { getLeague } from '@/modules/leagues/queries';
import { classicStandings, type Standing } from '@/modules/standings/calculate';
import type { TennisProjection, TennisScore } from '@/modules/tennis/types';
import { projectScore } from '@/modules/tennis/project';
import type { Id } from '@/shared/contracts';
import type { LeagueKind } from '@/shared/contracts';
import { DomainError } from '@/shared/errors';

export interface MatchDto {
  id: Id;
  leagueId: Id;
  leagueKind: LeagueKind;
  status: 'PENDING' | 'COMPLETED';
  version: number;
  round: number | null;
  leg: number | null;
  resultRecordedAt: string | null;
  sides: [
    { label: string; teamId: string | null; playerIds: string[] },
    { label: string; teamId: string | null; playerIds: string[] },
  ];
  score: TennisScore | null;
  projection: TennisProjection | null;
  calculationStatus: 'CURRENT' | 'STALE' | 'PENDING';
  calculationMatchVersion: number | null;
  eloEvents: EloEventDto[];
  eloStatus: {
    inputRevision: string;
    publishedRevision: string;
    state: 'CURRENT' | 'RECALCULATING' | 'FAILED';
  } | null;
}

export interface EloEventDto {
  playerId: Id;
  matchVersion: number;
  ratingBefore: number;
  expectedScore: number;
  actualScore: 0 | 1;
  calculatedDelta: number;
  appliedDelta: number;
  ratingAfter: number;
}

interface MatchRow {
  id: string;
  league_id: string;
  league_kind: LeagueKind;
  status: 'PENDING' | 'COMPLETED';
  result_version: number;
  round_number: number | null;
  leg_number: number | null;
  result_recorded_at: Date | string | null;
  opening_set_format: TennisScore['openingSetFormat'] | null;
  deciding_set_format: TennisScore['decidingSetFormat'];
  input_revision: string;
  published_revision: string;
  elo_state: 'CURRENT' | 'RECALCULATING' | 'FAILED' | null;
  published_publication_id: string | null;
}

interface EloEventRow {
  player_id: string;
  match_version: number;
  rating_before: number;
  expected_score: number;
  actual_score: 0 | 1;
  calculated_delta: number;
  applied_delta: number;
  rating_after: number;
}

interface SideRow {
  side_number: 1 | 2;
  team_id: string | null;
  team_name: string | null;
  player_ids: string[];
  player_names: string[];
}

interface SetRow {
  set_order: number;
  kind: 'GAME_SET' | 'SUPER_TIE_BREAK';
  side_1_score: number;
  side_2_score: number;
}

function id(value: string): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new DomainError('MATCH_NOT_FOUND');
  return parsed.data;
}

async function getMatchInTransaction(
  em: EntityManager,
  leagueId: Id,
  matchId: Id,
): Promise<MatchDto> {
  const validLeagueId = id(leagueId);
  const validMatchId = id(matchId);
  const transaction = em.getTransactionContext();
  const rows = await em.getConnection().execute<MatchRow[]>(
    `select m.id, m.league_id, l.kind as league_kind, m.status, m.result_version, m.round_number,
            m.leg_number, m.result_recorded_at, r.opening_set_format,
            r.deciding_set_format, l.input_revision, l.published_revision,
            l.elo_state, l.published_publication_id
       from matches m
       join leagues l on l.id = m.league_id and l.deleted_at is null
       left join tennis_match_rules r on r.match_id = m.id
      where m.id = ? and m.league_id = ? and m.deleted_at is null`,
    [validMatchId, validLeagueId],
    'all',
    transaction,
  );
  const row = rows[0];
  if (!row) throw new DomainError('MATCH_NOT_FOUND');
  const sideRows = await em.getConnection().execute<SideRow[]>(
    `select ms.side_number, ms.team_id, lt.display_name as team_name,
            array_agg(p.id order by msp.position) as player_ids,
            array_agg(p.nickname order by msp.position) as player_names
       from match_sides ms
       join match_side_players msp
         on msp.side_id = ms.id and msp.match_id = ms.match_id
        and msp.league_id = ms.league_id
       join players p on p.id = msp.player_id
       left join league_teams lt on lt.id = ms.team_id and lt.league_id = ms.league_id
      where ms.match_id = ? and ms.league_id = ?
      group by ms.id, ms.side_number, ms.team_id, lt.display_name
      order by ms.side_number`,
    [validMatchId, validLeagueId],
    'all',
    transaction,
  );
  if (sideRows.length !== 2) throw new DomainError('INVALID_SIDE_SIZE');
  const setRows = await em.getConnection().execute<SetRow[]>(
    `select set_order, kind, side_1_score, side_2_score
       from tennis_sets where match_id = ? order by set_order`,
    [validMatchId],
    'all',
    transaction,
  );
  const score: TennisScore | null = row.opening_set_format
    ? {
        openingSetFormat: row.opening_set_format,
        decidingSetFormat: row.deciding_set_format,
        sets: setRows.map(set => ({
          order: set.set_order,
          kind: set.kind,
          sideA: set.side_1_score,
          sideB: set.side_2_score,
        })),
      }
    : null;
  const sides = sideRows.map(side => ({
    label: side.team_name ?? side.player_names.join(' / '),
    teamId: side.team_id,
    playerIds: side.player_ids,
  })) as MatchDto['sides'];
  const eventRows = row.league_kind === 'ELO_INFINITE' && row.published_publication_id
    ? await em.getConnection().execute<EloEventRow[]>(
        `select player_id, match_version, rating_before, expected_score,
                actual_score, calculated_delta, applied_delta, rating_after
           from elo_rating_events
          where publication_id = ? and match_id = ?
          order by player_id`,
        [row.published_publication_id, row.id],
        'all',
        transaction,
      )
    : [];
  const eloEvents: EloEventDto[] = eventRows.map(event => ({
    playerId: event.player_id,
    matchVersion: event.match_version,
    ratingBefore: event.rating_before,
    expectedScore: Number(event.expected_score),
    actualScore: event.actual_score,
    calculatedDelta: event.calculated_delta,
    appliedDelta: event.applied_delta,
    ratingAfter: event.rating_after,
  }));
  const calculationMatchVersion = eloEvents[0]?.matchVersion ?? null;
  const calculationStatus = row.league_kind !== 'ELO_INFINITE'
    ? 'CURRENT'
    : eloEvents.length === 0
      ? 'PENDING'
      : row.elo_state === 'CURRENT' &&
          String(row.input_revision) === String(row.published_revision) &&
          calculationMatchVersion === row.result_version
        ? 'CURRENT'
        : 'STALE';
  return {
    id: row.id,
    leagueId: row.league_id,
    leagueKind: row.league_kind,
    status: row.status,
    version: row.result_version,
    round: row.round_number,
    leg: row.leg_number,
    resultRecordedAt: row.result_recorded_at
      ? new Date(row.result_recorded_at).toISOString()
      : null,
    sides,
    score,
    projection: score ? projectScore(score) : null,
    calculationStatus,
    calculationMatchVersion,
    eloEvents,
    eloStatus: row.league_kind === 'ELO_INFINITE'
      ? {
          inputRevision: String(row.input_revision),
          publishedRevision: String(row.published_revision),
          state: row.elo_state!,
        }
      : null,
  };
}

export async function getMatch(
  em: EntityManager,
  leagueId: Id,
  matchId: Id,
): Promise<MatchDto> {
  return em.transactional(
    tx => getMatchInTransaction(tx, leagueId, matchId),
    { isolationLevel: IsolationLevel.REPEATABLE_READ },
  );
}

export async function getClassicStandings(
  em: EntityManager,
  leagueId: Id,
): Promise<Standing[]> {
  const league = await getLeague(em, leagueId);
  if (league.kind !== 'CLASSIC') throw new DomainError('FORBIDDEN_OPERATION');
  const entries =
    league.mode === 'SINGLES'
      ? league.participants.map(player => ({ id: player.id, label: player.nickname }))
      : league.teams.map(team => ({ id: team.id, label: team.displayName }));
  const rows = await em.getConnection().execute<
    Array<{
      match_id: string;
      side_number: 1 | 2;
      entry_id: string;
      opening_set_format: TennisScore['openingSetFormat'];
      deciding_set_format: TennisScore['decidingSetFormat'];
      sets: Array<{
        order: number;
        kind: 'GAME_SET' | 'SUPER_TIE_BREAK';
        sideA: number;
        sideB: number;
      }>;
    }>
  >(
    `select m.id as match_id, ms.side_number,
            coalesce(
              ms.team_id,
              (array_agg(msp.player_id order by msp.position))[1]
            )::text as entry_id,
            r.opening_set_format, r.deciding_set_format,
            jsonb_agg(distinct jsonb_build_object(
              'order', ts.set_order, 'kind', ts.kind,
              'sideA', ts.side_1_score, 'sideB', ts.side_2_score
            )) filter (where ts.id is not null) as sets
       from matches m
       join match_sides ms on ms.match_id = m.id and ms.league_id = m.league_id
       join match_side_players msp on msp.side_id = ms.id and msp.match_id = m.id
       join tennis_match_rules r on r.match_id = m.id
       join tennis_sets ts on ts.match_id = m.id
      where m.league_id = ? and m.status = 'COMPLETED' and m.deleted_at is null
      group by m.id, ms.id, ms.side_number, ms.team_id,
               r.opening_set_format, r.deciding_set_format
      order by m.id, ms.side_number`,
    [league.id],
  );
  const byMatch = new Map<
    string,
    { sideA?: string; sideB?: string; score?: TennisScore }
  >();
  for (const row of rows) {
    const current = byMatch.get(row.match_id) ?? {};
    if (row.side_number === 1) current.sideA = row.entry_id;
    else current.sideB = row.entry_id;
    current.score = {
      openingSetFormat: row.opening_set_format,
      decidingSetFormat: row.deciding_set_format,
      sets: [...row.sets].sort((a, b) => a.order - b.order),
    };
    byMatch.set(row.match_id, current);
  }
  return classicStandings(
    entries,
    [...byMatch.values()].flatMap(result =>
      result.sideA && result.sideB && result.score
        ? [
            {
              sideA: result.sideA,
              sideB: result.sideB,
              projection: projectScore(result.score),
            },
          ]
        : [],
    ),
  );
}
