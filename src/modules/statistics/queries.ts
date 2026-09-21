import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import type { Id, Mode, Sides } from '@/shared/contracts';
import { DomainError } from '@/shared/errors';
import type { TennisProjection, TennisScore } from '@/modules/tennis/types';
import { projectScore } from '@/modules/tennis/project';
import {
  emptyPlayerStats,
  playerStatistics,
  type PlayerStats,
  type PlayerStatisticsMatch,
} from './player';
import { makeLeagueOverview, type LeagueOverview } from './league';

export type StatisticsMode = Mode | 'ALL';

export interface PlayerHistoryDto {
  id: Id;
  leagueId: Id;
  leagueName: string;
  leagueKind: 'CLASSIC' | 'ELO_INFINITE';
  mode: Mode;
  round: number | null;
  leg: number | null;
  recordedAt: string;
  sides: Sides;
  score: TennisScore;
  projection: TennisProjection;
}

export interface PlayerRatingDto {
  leagueId: Id;
  leagueName: string;
  rating: number;
  played: number;
  lastDelta: number | null;
  state: 'CURRENT' | 'RECALCULATING' | 'FAILED';
}

export interface PlayerLeagueDto {
  id: Id;
  name: string;
  kind: 'CLASSIC' | 'ELO_INFINITE';
  mode: Mode;
}

export interface RecentResultDto {
  id: Id;
  leagueId: Id;
  leagueName: string;
  leagueKind: 'CLASSIC' | 'ELO_INFINITE';
  mode: Mode;
  sideA: string;
  sideB: string;
  recordedAt: string;
  projection: TennisProjection;
}

interface MatchRow {
  id: string;
  league_id: string;
  league_name: string;
  league_kind: 'CLASSIC' | 'ELO_INFINITE';
  game_mode: Mode;
  round_number: number | null;
  leg_number: number | null;
  result_recorded_at: Date | string;
  opening_set_format: TennisScore['openingSetFormat'];
  deciding_set_format: TennisScore['decidingSetFormat'];
  sides: unknown;
  sets: unknown;
}

function validId(value: Id, code: 'PLAYER_NOT_FOUND' | 'LEAGUE_NOT_FOUND'): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new DomainError(code);
  return parsed.data;
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseSides(value: unknown): Sides {
  const raw = jsonValue(value);
  if (!Array.isArray(raw) || raw.length !== 2) throw new DomainError('INVALID_SIDE_SIZE');
  const sides = raw.map(side => {
    if (!side || typeof side !== 'object') return [];
    const players = (side as { players?: unknown }).players;
    return Array.isArray(players) ? players.filter((id): id is string => typeof id === 'string') : [];
  });
  if (!sides[0]?.length || !sides[1]?.length) throw new DomainError('INVALID_SIDE_SIZE');
  return sides as unknown as Sides;
}

function parseSets(value: unknown): TennisScore['sets'] {
  const raw = jsonValue(value);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(set => {
    if (!set || typeof set !== 'object') return [];
    const item = set as Record<string, unknown>;
    if (
      typeof item.order !== 'number' ||
      (item.kind !== 'GAME_SET' && item.kind !== 'SUPER_TIE_BREAK') ||
      typeof item.sideA !== 'number' ||
      typeof item.sideB !== 'number'
    ) return [];
    return [{
      order: item.order,
      kind: item.kind,
      sideA: item.sideA,
      sideB: item.sideB,
    }];
  });
}

function toHistory(row: MatchRow): PlayerHistoryDto {
  const score: TennisScore = {
    openingSetFormat: row.opening_set_format,
    decidingSetFormat: row.deciding_set_format,
    sets: parseSets(row.sets),
  };
  return {
    id: row.id,
    leagueId: row.league_id,
    leagueName: row.league_name,
    leagueKind: row.league_kind,
    mode: row.game_mode,
    round: row.round_number,
    leg: row.leg_number,
    recordedAt: new Date(row.result_recorded_at).toISOString(),
    sides: parseSides(row.sides),
    score,
    projection: projectScore(score),
  };
}

const matchProjection = `
  (select jsonb_agg(jsonb_build_object(
      'side', ms.side_number,
      'players', (select jsonb_agg(msp.player_id order by msp.position)
                    from match_side_players msp
                   where msp.side_id = ms.id and msp.match_id = m.id and msp.league_id = m.league_id)
    ) order by ms.side_number)
     from match_sides ms
    where ms.match_id = m.id and ms.league_id = m.league_id) as sides,
  (select jsonb_agg(jsonb_build_object(
      'order', ts.set_order,
      'kind', ts.kind,
      'sideA', ts.side_1_score,
      'sideB', ts.side_2_score
    ) order by ts.set_order)
     from tennis_sets ts where ts.match_id = m.id) as sets`;

async function readPlayerMatches(
  em: EntityManager,
  options: { playerId: Id; mode: StatisticsMode; leagueId?: Id },
): Promise<PlayerHistoryDto[]> {
  const playerId = validId(options.playerId, 'PLAYER_NOT_FOUND');
  const [player] = await em.getConnection().execute<{ id: string }[]>(
    'select id from players where id = ?',
    [playerId],
  );
  if (!player) throw new DomainError('PLAYER_NOT_FOUND');
  const leagueId = options.leagueId
    ? validId(options.leagueId, 'LEAGUE_NOT_FOUND')
    : undefined;
  if (leagueId) {
    const [league] = await em.getConnection().execute<{ id: string }[]>(
      'select id from leagues where id = ? and deleted_at is null',
      [leagueId],
    );
    if (!league) throw new DomainError('LEAGUE_NOT_FOUND');
  }
  const rows = await em.getConnection().execute<MatchRow[]>(
    `select m.id, m.league_id, l.name as league_name, l.kind as league_kind,
            l.game_mode, m.round_number, m.leg_number, m.result_recorded_at,
            r.opening_set_format, r.deciding_set_format,
            ${matchProjection}
       from matches m
       join leagues l on l.id = m.league_id and l.deleted_at is null
       join tennis_match_rules r on r.match_id = m.id
      where m.deleted_at is null and m.status = 'COMPLETED'
        and exists (
          select 1 from match_side_players target
           where target.match_id = m.id and target.league_id = m.league_id
             and target.player_id = ?
        )
        ${options.mode === 'ALL' ? '' : 'and l.game_mode = ?'}
        ${leagueId ? 'and m.league_id = ?' : ''}
      order by m.result_recorded_at desc, m.id desc`,
    [playerId, ...(options.mode === 'ALL' ? [] : [options.mode]), ...(leagueId ? [leagueId] : [])],
  );
  return rows.map(toHistory);
}

export async function getPlayerStatistics(
  em: EntityManager,
  options: { playerId: Id; mode: StatisticsMode; leagueId?: Id },
): Promise<PlayerStats> {
  const matches = await readPlayerMatches(em, options);
  const input: PlayerStatisticsMatch[] = matches.map(match => ({
    sides: match.sides,
    projection: match.projection,
  }));
  return playerStatistics(options.playerId, input);
}

export async function listPlayerMatches(
  em: EntityManager,
  options: { playerId: Id; mode: StatisticsMode; leagueId?: Id },
): Promise<PlayerHistoryDto[]> {
  return readPlayerMatches(em, options);
}

export async function getPlayerRatings(
  em: EntityManager,
  playerId: Id,
): Promise<PlayerRatingDto[]> {
  const parsedId = validId(playerId, 'PLAYER_NOT_FOUND');
  const rows = await em.getConnection().execute<
    Array<{
      league_id: string;
      league_name: string;
      rating: number;
      played: number;
      last_delta: number | null;
      elo_state: PlayerRatingDto['state'];
    }>
  >(
    `select l.id as league_id, l.name as league_name,
            r.rating, r.played, r.last_delta, l.elo_state
       from leagues l
       join lateral (
         select er.rating, er.played, er.last_delta
           from elo_ratings er
          where er.publication_id = l.published_publication_id
            and er.player_id = ?
       ) r on true
      where l.deleted_at is null and l.kind = 'ELO_INFINITE'
      order by l.name, l.id`,
    [parsedId],
  );
  return rows.map(row => ({
    leagueId: row.league_id,
    leagueName: row.league_name,
    rating: row.rating,
    played: row.played,
    lastDelta: row.last_delta,
    state: row.elo_state,
  }));
}

export async function listPlayerLeagues(
  em: EntityManager,
  playerId: Id,
  mode?: StatisticsMode,
): Promise<PlayerLeagueDto[]> {
  const parsedId = validId(playerId, 'PLAYER_NOT_FOUND');
  const rows = await em.getConnection().execute<
    Array<{ id: string; name: string; kind: PlayerLeagueDto['kind']; mode: Mode }>
  >(
    `select l.id, l.name, l.kind, l.game_mode as mode
       from league_players lp
       join leagues l on l.id = lp.league_id and l.deleted_at is null
      where lp.player_id = ? ${mode && mode !== 'ALL' ? 'and l.game_mode = ?' : ''}
      order by l.name, l.id`,
    [parsedId, ...(mode && mode !== 'ALL' ? [mode] : [])],
  );
  return rows.map(row => ({ id: row.id, name: row.name, kind: row.kind, mode: row.mode }));
}

export async function listRecentResults(
  em: EntityManager,
  limit = 8,
): Promise<RecentResultDto[]> {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
  const rows = await em.getConnection().execute<
    Array<{
      id: string;
      league_id: string;
      league_name: string;
      league_kind: RecentResultDto['leagueKind'];
      game_mode: Mode;
      result_recorded_at: Date | string;
      side_a: string;
      side_b: string;
      opening_set_format: TennisScore['openingSetFormat'];
      deciding_set_format: TennisScore['decidingSetFormat'];
      sets: unknown;
    }>
  >(
    `select m.id, l.id as league_id, l.name as league_name, l.kind as league_kind,
            l.game_mode, m.result_recorded_at,
            (select string_agg(p.nickname, ' / ' order by msp.position)
               from match_sides ms
               join match_side_players msp on msp.side_id = ms.id and msp.match_id = m.id
               join players p on p.id = msp.player_id
              where ms.match_id = m.id and ms.side_number = 1) as side_a,
            (select string_agg(p.nickname, ' / ' order by msp.position)
               from match_sides ms
               join match_side_players msp on msp.side_id = ms.id and msp.match_id = m.id
               join players p on p.id = msp.player_id
              where ms.match_id = m.id and ms.side_number = 2) as side_b,
            r.opening_set_format, r.deciding_set_format,
            (select jsonb_agg(jsonb_build_object(
                'order', ts.set_order, 'kind', ts.kind,
                'sideA', ts.side_1_score, 'sideB', ts.side_2_score
              ) order by ts.set_order)
               from tennis_sets ts where ts.match_id = m.id) as sets
       from matches m
       join leagues l on l.id = m.league_id and l.deleted_at is null
       join tennis_match_rules r on r.match_id = m.id
      where m.deleted_at is null and m.status = 'COMPLETED'
      order by m.result_recorded_at desc, m.id desc
      limit ?`,
    [boundedLimit],
  );
  return rows.map(row => {
    const score: TennisScore = {
      openingSetFormat: row.opening_set_format,
      decidingSetFormat: row.deciding_set_format,
      sets: parseSets(row.sets),
    };
    return {
      id: row.id,
      leagueId: row.league_id,
      leagueName: row.league_name,
      leagueKind: row.league_kind,
      mode: row.game_mode,
      sideA: row.side_a,
      sideB: row.side_b,
      recordedAt: new Date(row.result_recorded_at).toISOString(),
      projection: projectScore(score),
    };
  });
}

export async function getLeagueOverview(
  em: EntityManager,
  leagueId: Id,
): Promise<LeagueOverview> {
  const id = validId(leagueId, 'LEAGUE_NOT_FOUND');
  const [row] = await em.getConnection().execute<
    Array<{
      id: string;
      name: string;
      kind: 'CLASSIC' | 'ELO_INFINITE';
      mode: Mode;
      participant_count: number;
      match_count: number;
      completed_match_count: number;
    }>
  >(
    `select l.id, l.name, l.kind, l.game_mode as mode,
            (select count(*)::int from league_players lp where lp.league_id = l.id) as participant_count,
            (select count(*)::int from matches m where m.league_id = l.id and m.deleted_at is null) as match_count,
            (select count(*)::int from matches m
              where m.league_id = l.id and m.deleted_at is null and m.status = 'COMPLETED') as completed_match_count
       from leagues l where l.id = ? and l.deleted_at is null`,
    [id],
  );
  if (!row) throw new DomainError('LEAGUE_NOT_FOUND');
  return makeLeagueOverview({
    id: row.id,
    name: row.name,
    kind: row.kind,
    mode: row.mode,
    participantCount: Number(row.participant_count),
    matchCount: Number(row.match_count),
    completedMatchCount: Number(row.completed_match_count),
  });
}

export function noMatchesStats(): PlayerStats {
  return emptyPlayerStats();
}

export type { PlayerStats } from './player';
