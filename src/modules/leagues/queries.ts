import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import type { Id, LeagueKind, Mode, Page } from '@/shared/contracts';
import { DomainError } from '@/shared/errors';

export interface LeagueSummaryDto {
  id: Id;
  name: string;
  kind: LeagueKind;
  mode: Mode;
  status: 'ACTIVE' | 'COMPLETED';
  version: number;
  hasReturnLegs: boolean | null;
  eloK: number | null;
  participantCount: number;
  teamCount: number;
  matchCount: number;
  completedMatchCount: number;
  eloState: 'CURRENT' | 'RECALCULATING' | 'FAILED' | null;
  inputRevision: string;
  publishedRevision: string;
  createdAt: string;
}

export interface LeagueParticipantDto {
  id: Id;
  nickname: string;
  firstName: string;
  lastName: string;
  deleted: boolean;
}

export interface LeagueTeamDto {
  id: Id;
  displayName: string;
  players: LeagueParticipantDto[];
}

export interface LeagueDto extends LeagueSummaryDto {
  participants: LeagueParticipantDto[];
  teams: LeagueTeamDto[];
}

export interface LeagueMatchDto {
  id: Id;
  leagueKind: LeagueKind;
  status: 'PENDING' | 'COMPLETED';
  version: number;
  round: number | null;
  leg: number | null;
  sideA: string;
  sideB: string;
  playerIdsA: string[];
  playerIdsB: string[];
  calculationStatus: 'CURRENT' | 'STALE' | 'PENDING';
  calculationMatchVersion: number | null;
  createdAt: string;
}

export interface VisibleLeagueRow {
  id: Id;
  name: string;
  kind: LeagueKind;
  mode: Mode;
  status: 'ACTIVE' | 'COMPLETED';
  version: number;
  hasReturnLegs: boolean | null;
  eloK: number | null;
  inputRevision: string;
  publishedRevision: string;
  publishedPublicationId: string | null;
  eloState: 'CURRENT' | 'RECALCULATING' | 'FAILED' | null;
  lastResultRecordedAt: string | null;
}

interface LeagueRow {
  id: string;
  name: string;
  kind: LeagueKind;
  game_mode: Mode;
  status: 'ACTIVE' | 'COMPLETED';
  version: number;
  has_return_legs: boolean | null;
  elo_k: number | null;
  participant_count: number;
  team_count: number;
  match_count: number;
  completed_match_count: number;
  elo_state: 'CURRENT' | 'RECALCULATING' | 'FAILED' | null;
  input_revision: string;
  published_revision: string;
  created_at: Date | string;
}

function validateId(id: Id): string {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) throw new DomainError('LEAGUE_NOT_FOUND');
  return parsed.data;
}

function summary(row: LeagueRow): LeagueSummaryDto {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    mode: row.game_mode,
    status: row.status,
    version: row.version,
    hasReturnLegs: row.has_return_legs,
    eloK: row.elo_k,
    participantCount: Number(row.participant_count),
    teamCount: Number(row.team_count),
    matchCount: Number(row.match_count),
    completedMatchCount: Number(row.completed_match_count),
    eloState: row.elo_state,
    inputRevision: String(row.input_revision),
    publishedRevision: String(row.published_revision),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

const summaryColumns = `l.id, l.name, l.kind, l.game_mode, l.status, l.version,
  l.has_return_legs, l.elo_k, l.elo_state, l.input_revision, l.published_revision,
  l.created_at,
  (select count(*)::int from league_players lp where lp.league_id = l.id)
    as participant_count,
  (select count(*)::int from league_teams lt where lt.league_id = l.id)
    as team_count,
  (select count(*)::int from matches m where m.league_id = l.id and m.deleted_at is null)
    as match_count,
  (select count(*)::int from matches m
    where m.league_id = l.id and m.deleted_at is null and m.status = 'COMPLETED')
    as completed_match_count`;

async function listLeaguesLegacy(
  em: EntityManager,
  kind?: LeagueKind,
): Promise<LeagueSummaryDto[]> {
  if (kind && kind !== 'CLASSIC' && kind !== 'ELO_INFINITE') {
    throw new DomainError('VALIDATION', { kind: 'Nieprawidłowy rodzaj ligi.' });
  }
  const rows = await em.getConnection().execute<LeagueRow[]>(
    `select ${summaryColumns}
       from leagues l
      where l.deleted_at is null ${kind ? 'and l.kind = ?' : ''}
      order by l.created_at desc, l.id desc`,
    kind ? [kind] : [],
  );
  return rows.map(summary);
}

export interface ListLeaguesOptions {
  cursor?: string;
  kind?: LeagueKind;
  status?: 'ACTIVE' | 'COMPLETED';
}

function decodeLeagueCursor(cursor: string): [string, string] {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== 'string' ||
      typeof parsed[1] !== 'string' ||
      !z.uuid().safeParse(parsed[1]).success
    ) throw new Error('invalid');
    return [parsed[0], parsed[1]];
  } catch {
    throw new DomainError('VALIDATION', { cursor: 'Nieprawidłowy kursor.' });
  }
}

function encodeLeagueCursor(row: LeagueSummaryDto): string {
  return Buffer.from(JSON.stringify([row.createdAt, row.id])).toString('base64url');
}

export async function listLeagues(
  em: EntityManager,
  options: ListLeaguesOptions,
): Promise<Page<LeagueSummaryDto>>;
export async function listLeagues(
  em: EntityManager,
  kind?: LeagueKind,
): Promise<LeagueSummaryDto[]>;
export async function listLeagues(
  em: EntityManager,
  input?: LeagueKind | ListLeaguesOptions,
): Promise<LeagueSummaryDto[] | Page<LeagueSummaryDto>> {
  if (typeof input === 'string' || input === undefined) {
    return listLeaguesLegacy(em, input);
  }
  const rows = await listLeaguesLegacy(em, input.kind);
  const position = input.cursor ? decodeLeagueCursor(input.cursor) : undefined;
  const filtered = rows
    .filter(row => input.status === undefined || row.status === input.status)
    .sort((left, right) => {
      const time = right.createdAt.localeCompare(left.createdAt);
      return time || right.id.localeCompare(left.id);
    });
  const after = position
    ? filtered.filter(row =>
        row.createdAt < position[0] ||
        (row.createdAt === position[0] && row.id < position[1]),
      )
    : filtered;
  const pageRows = after.slice(0, 25);
  return {
    items: pageRows,
    nextCursor: after.length > pageRows.length && pageRows.at(-1)
      ? encodeLeagueCursor(pageRows.at(-1)!)
      : null,
  };
}

export async function getVisibleLeagueForUpdate(
  em: EntityManager,
  leagueId: Id,
): Promise<VisibleLeagueRow> {
  const id = validateId(leagueId);
  const rows = await em.getConnection().execute<
    Array<{
      id: string;
      name: string;
      kind: LeagueKind;
      game_mode: Mode;
      status: 'ACTIVE' | 'COMPLETED';
      version: number;
      has_return_legs: boolean | null;
      elo_k: number | null;
      input_revision: string;
      published_revision: string;
      published_publication_id: string | null;
      elo_state: 'CURRENT' | 'RECALCULATING' | 'FAILED' | null;
      last_result_recorded_at: Date | string | null;
    }>
  >(
    `select id, name, kind, game_mode, status, version, has_return_legs, elo_k,
            input_revision, published_revision, published_publication_id,
            elo_state, last_result_recorded_at
       from leagues
      where id = ? and deleted_at is null
      for update`,
    [id],
    'all',
    em.getTransactionContext(),
  );
  const row = rows[0];
  if (!row) throw new DomainError('LEAGUE_NOT_FOUND');
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    mode: row.game_mode,
    status: row.status,
    version: row.version,
    hasReturnLegs: row.has_return_legs,
    eloK: row.elo_k,
    inputRevision: String(row.input_revision),
    publishedRevision: String(row.published_revision),
    publishedPublicationId: row.published_publication_id,
    eloState: row.elo_state,
    lastResultRecordedAt: row.last_result_recorded_at
      ? new Date(row.last_result_recorded_at).toISOString()
      : null,
  };
}

export async function getLeague(
  em: EntityManager,
  leagueId: Id,
): Promise<LeagueDto> {
  const id = validateId(leagueId);
  const rows = await em.getConnection().execute<LeagueRow[]>(
    `select ${summaryColumns}
       from leagues l
      where l.id = ? and l.deleted_at is null`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new DomainError('LEAGUE_NOT_FOUND');

  const participantRows = await em.getConnection().execute<
    Array<{
      id: string;
      nickname: string;
      first_name: string;
      last_name: string;
      deleted: boolean;
    }>
  >(
    `select p.id, p.nickname, p.first_name, p.last_name,
            (p.deleted_at is not null) as deleted
       from league_players lp
       join players p on p.id = lp.player_id
      where lp.league_id = ?
      order by p.nickname_key, p.id`,
    [id],
  );
  const participants = participantRows.map(player => ({
    id: player.id,
    nickname: player.nickname,
    firstName: player.first_name,
    lastName: player.last_name,
    deleted: player.deleted,
  }));
  const participantById = new Map(participants.map(player => [player.id, player]));

  const teamRows = await em.getConnection().execute<
    Array<{
      id: string;
      display_name: string;
      player_ids: string[];
    }>
  >(
    `select lt.id, lt.display_name,
            array_agg(ltp.player_id order by ltp.position) as player_ids
       from league_teams lt
       join league_team_players ltp on ltp.team_id = lt.id
      where lt.league_id = ?
      group by lt.id, lt.display_name
      order by lt.display_name, lt.id`,
    [id],
  );
  const teams = teamRows.map(team => ({
    id: team.id,
    displayName: team.display_name,
    players: team.player_ids.flatMap(playerId => {
      const player = participantById.get(playerId);
      return player ? [player] : [];
    }),
  }));
  return { ...summary(row), participants, teams };
}

async function listLeagueMatchesLegacy(
  em: EntityManager,
  leagueId: Id,
): Promise<LeagueMatchDto[]> {
  const league = await getLeague(em, leagueId);
  const rows = await em.getConnection().execute<
    Array<{
      id: string;
      league_kind: LeagueKind;
      status: 'PENDING' | 'COMPLETED';
      result_version: number;
      round_number: number | null;
      leg_number: number | null;
      side_number: number;
      team_name: string | null;
      player_ids: string[];
      player_names: string[];
      input_revision: string;
      published_revision: string;
      elo_state: 'CURRENT' | 'RECALCULATING' | 'FAILED' | null;
      has_elo_event: boolean;
      calculation_match_version: number | null;
      created_at: Date | string;
    }>
  >(
    `select m.id, l.kind as league_kind, m.status, m.result_version, m.created_at,
            m.round_number, m.leg_number, ms.side_number,
            lt.display_name as team_name,
            array_agg(p.id order by msp.position) as player_ids,
            array_agg(p.nickname order by msp.position) as player_names,
            l.input_revision, l.published_revision, l.elo_state,
            exists(
              select 1 from elo_rating_events e
               where e.publication_id = l.published_publication_id
                 and e.match_id = m.id
            ) as has_elo_event,
            (select max(e.match_version) from elo_rating_events e
              where e.publication_id = l.published_publication_id
                and e.match_id = m.id) as calculation_match_version
       from matches m
       join leagues l on l.id = m.league_id and l.deleted_at is null
       join match_sides ms on ms.match_id = m.id and ms.league_id = m.league_id
       join match_side_players msp
         on msp.side_id = ms.id and msp.match_id = m.id and msp.league_id = m.league_id
       join players p on p.id = msp.player_id
       left join league_teams lt on lt.id = ms.team_id and lt.league_id = m.league_id
      where m.league_id = ? and m.deleted_at is null
      group by m.id, l.kind, m.status, m.result_version, m.created_at,
               m.round_number, m.leg_number,
               l.input_revision, l.published_revision, l.elo_state,
               l.published_publication_id,
               ms.side_number, lt.display_name
      order by m.round_number nulls last, m.leg_number nulls last, m.id, ms.side_number`,
    [league.id],
  );
  const byMatch = new Map<string, LeagueMatchDto>();
  for (const row of rows) {
    const existing = byMatch.get(row.id) ?? {
      id: row.id,
      leagueKind: row.league_kind,
      status: row.status,
      version: row.result_version,
      round: row.round_number,
      leg: row.leg_number,
      sideA: '',
      sideB: '',
      playerIdsA: [],
      playerIdsB: [],
      calculationStatus:
        row.league_kind !== 'ELO_INFINITE'
          ? 'CURRENT'
          : !row.has_elo_event
            ? 'PENDING'
            : row.elo_state === 'CURRENT' &&
                String(row.input_revision) === String(row.published_revision) &&
                row.calculation_match_version === row.result_version
              ? 'CURRENT'
              : 'STALE',
      calculationMatchVersion: row.calculation_match_version,
      createdAt: new Date(row.created_at).toISOString(),
    };
    const label = row.team_name ?? row.player_names.join(' / ');
    if (row.side_number === 1) {
      existing.sideA = label;
      existing.playerIdsA = row.player_ids;
    } else {
      existing.sideB = label;
      existing.playerIdsB = row.player_ids;
    }
    byMatch.set(row.id, existing);
  }
  return [...byMatch.values()];
}

export interface ListLeagueMatchesOptions {
  leagueId: Id;
  cursor?: string;
  status?: 'PENDING' | 'COMPLETED';
  round?: number;
}

function decodeMatchCursor(cursor: string): [string, string] {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== 'string' ||
      typeof parsed[1] !== 'string' ||
      !z.uuid().safeParse(parsed[1]).success
    ) throw new Error('invalid');
    return [parsed[0], parsed[1]];
  } catch {
    throw new DomainError('VALIDATION', { cursor: 'Nieprawidłowy kursor.' });
  }
}

function encodeMatchCursor(row: LeagueMatchDto): string {
  return Buffer.from(JSON.stringify([row.createdAt, row.id])).toString('base64url');
}

/** Page-shaped overload used by the history UI. The legacy positional form is
 * kept for callers that need the complete generated schedule. */
export async function listLeagueMatches(
  em: EntityManager,
  options: ListLeagueMatchesOptions,
): Promise<Page<LeagueMatchDto>>;
export async function listLeagueMatches(
  em: EntityManager,
  leagueId: Id,
): Promise<LeagueMatchDto[]>;
export async function listLeagueMatches(
  em: EntityManager,
  input: Id | ListLeagueMatchesOptions,
): Promise<LeagueMatchDto[] | Page<LeagueMatchDto>> {
  if (typeof input === 'string') {
    return listLeagueMatchesLegacy(em, input);
  }
  const rows = await listLeagueMatchesLegacy(em, input.leagueId);
  const position = input.cursor ? decodeMatchCursor(input.cursor) : undefined;
  const filtered = rows
    .filter(row => input.status === undefined || row.status === input.status)
    .filter(row => input.round === undefined || row.round === input.round)
    .sort((left, right) => {
      const time = right.createdAt.localeCompare(left.createdAt);
      return time || right.id.localeCompare(left.id);
    });
  const after = position
    ? filtered.filter(row =>
        row.createdAt < position[0] ||
        (row.createdAt === position[0] && row.id < position[1]),
      )
    : filtered;
  const pageRows = after.slice(0, 25);
  return {
    items: pageRows,
    nextCursor: after.length > pageRows.length && pageRows.at(-1)
      ? encodeMatchCursor(pageRows.at(-1)!)
      : null,
  };
}
