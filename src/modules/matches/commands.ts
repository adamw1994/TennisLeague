import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import type { TennisScore } from '@/modules/tennis/types';
import { validateAndNormalizeScore } from '@/modules/tennis/validate';
import type { Id, Sides, Versioned } from '@/shared/contracts';
import { DomainError } from '@/shared/errors';
import { assertVersion, inMutationTransaction } from '@/shared/mutation';
import { getVisibleLeagueForUpdate } from '@/modules/leagues/queries';
import { insertEloScore, insertEloSides } from '@/modules/elo/append';
import { enqueueLatest } from '@/modules/elo/queue';
import type { MatchRevisionSnapshot } from './revision.entity';

const ResultCommandSchema = z.strictObject({
  id: z.uuid(),
  expectedVersion: z.int().min(0),
  score: z.unknown(),
});

interface LockedMatch {
  id: string;
  league_id: string;
  status: 'PENDING' | 'COMPLETED';
  result_version: number;
  result_recorded_at: Date | string | null;
  elo_k_snapshot: number | null;
  deleted_at: Date | string | null;
}

interface SideRow {
  side_number: 1 | 2;
  team_id: string | null;
  player_ids: string[];
}

function parseCommand(command: unknown): {
  id: string;
  expectedVersion: number;
  score: TennisScore;
} {
  const parsed = ResultCommandSchema.safeParse(command);
  if (!parsed.success) {
    throw new DomainError('VALIDATION', {
      score: 'Nieprawidłowe dane zapisu wyniku.',
    });
  }
  const validated = validateAndNormalizeScore(parsed.data.score);
  return { ...parsed.data, score: validated.score };
}

async function matchLeagueId(em: EntityManager, matchId: string): Promise<string> {
  const rows = await em.getConnection().execute<{ league_id: string }[]>(
    'select league_id from matches where id = ?',
    [matchId],
    'all',
    em.getTransactionContext(),
  );
  if (!rows[0]) throw new DomainError('MATCH_NOT_FOUND');
  return rows[0].league_id;
}

async function lockMatch(
  em: EntityManager,
  matchId: string,
  leagueId: string,
): Promise<LockedMatch> {
  const rows = await em.getConnection().execute<LockedMatch[]>(
    `select id, league_id, status, result_version, result_recorded_at,
            elo_k_snapshot, deleted_at
       from matches where id = ? and league_id = ? for update`,
    [matchId, leagueId],
    'all',
    em.getTransactionContext(),
  );
  const match = rows[0];
  if (!match || match.deleted_at) throw new DomainError('MATCH_NOT_FOUND');
  return match;
}

async function readSides(em: EntityManager, matchId: string): Promise<SideRow[]> {
  return em.getConnection().execute<SideRow[]>(
    `select ms.side_number, ms.team_id,
            array_agg(msp.player_id order by msp.position) as player_ids
       from match_sides ms
       join match_side_players msp
         on msp.side_id = ms.id and msp.match_id = ms.match_id
        and msp.league_id = ms.league_id
      where ms.match_id = ?
      group by ms.id, ms.side_number, ms.team_id
      order by ms.side_number`,
    [matchId],
    'all',
    em.getTransactionContext(),
  );
}

async function saveClassicResult(
  em: EntityManager,
  command: Versioned & { score: TennisScore },
  operation: 'record' | 'correct',
): Promise<{ id: Id; version: number }> {
  const parsed = parseCommand(command);
  return inMutationTransaction(em, async tx => {
    const leagueId = await matchLeagueId(tx, parsed.id);
    const league = await getVisibleLeagueForUpdate(tx, leagueId);
    if (league.kind !== 'CLASSIC') throw new DomainError('FORBIDDEN_OPERATION');
    const match = await lockMatch(tx, parsed.id, league.id);
    assertVersion(match.result_version, parsed.expectedVersion);
    if (operation === 'record' && match.status !== 'PENDING') {
      throw new DomainError('MATCH_ALREADY_COMPLETED');
    }
    if (operation === 'correct' && match.status !== 'COMPLETED') {
      throw new DomainError('FORBIDDEN_OPERATION');
    }
    const sides = await readSides(tx, match.id);
    if (sides.length !== 2) throw new DomainError('INVALID_SIDE_SIZE');

    const connection = tx.getConnection();
    const transaction = tx.getTransactionContext();
    await connection.execute(
      `insert into tennis_match_rules
         (match_id, opening_set_format, deciding_set_format)
       values (?, ?, ?)
       on conflict (match_id) do update
       set opening_set_format = excluded.opening_set_format,
           deciding_set_format = excluded.deciding_set_format`,
      [
        match.id,
        parsed.score.openingSetFormat,
        parsed.score.decidingSetFormat,
      ],
      'all',
      transaction,
    );
    await connection.execute(
      'delete from tennis_sets where match_id = ?',
      [match.id],
      'all',
      transaction,
    );
    const sets = parsed.score.sets.map(set => ({
      id: randomUUID(),
      order: set.order,
      kind: set.kind,
      sideA: set.sideA,
      sideB: set.sideB,
    }));
    await connection.execute(
      `insert into tennis_sets
         (id, match_id, set_order, kind, side_1_score, side_2_score)
       select x.id, ?, x."order", x.kind, x."sideA", x."sideB"
         from jsonb_to_recordset(?::jsonb)
           as x(id uuid, "order" integer, kind text, "sideA" integer, "sideB" integer)`,
      [match.id, JSON.stringify(sets)],
      'all',
      transaction,
    );
    const [updated] = await connection.execute<
      Array<{ result_version: number; result_recorded_at: Date | string }>
    >(
      `update matches
          set status = 'COMPLETED', result_version = result_version + 1,
              result_recorded_at = coalesce(result_recorded_at, clock_timestamp()),
              updated_at = clock_timestamp()
        where id = ? and league_id = ? and result_version = ?
        returning result_version, result_recorded_at`,
      [match.id, league.id, parsed.expectedVersion],
      'all',
      transaction,
    );
    if (!updated) throw new DomainError('VERSION_CONFLICT');

    const resultRecordedAt = new Date(updated.result_recorded_at).toISOString();
    const snapshot: MatchRevisionSnapshot = {
      matchId: match.id,
      leagueId: league.id,
      version: updated.result_version,
      status: 'COMPLETED',
      resultRecordedAt,
      deletedAt: null,
      eloKSnapshot: null,
      sides: sides.map(side => ({
        sideNumber: side.side_number,
        teamId: side.team_id,
        playerIds: side.player_ids,
      })),
      score: parsed.score,
    };
    await connection.execute(
      `insert into match_revisions (id, match_id, version, snapshot)
       values (?, ?, ?, ?::jsonb)`,
      [randomUUID(), match.id, updated.result_version, JSON.stringify(snapshot)],
      'all',
      transaction,
    );
    if (operation === 'record') {
      await connection.execute(
        `update leagues l
            set status = 'COMPLETED', updated_at = clock_timestamp()
          where l.id = ? and not exists (
            select 1 from matches m
             where m.league_id = l.id and m.deleted_at is null
               and m.status = 'PENDING'
          )`,
        [league.id],
        'all',
        transaction,
      );
    }
    return { id: match.id, version: updated.result_version };
  });
}

export function recordClassicResult(
  em: EntityManager,
  command: Versioned & { score: TennisScore },
): Promise<{ id: Id; version: number }> {
  return saveClassicResult(em, command, 'record');
}

export function correctClassicResult(
  em: EntityManager,
  command: Versioned & { score: TennisScore },
): Promise<{ id: Id; version: number }> {
  return saveClassicResult(em, command, 'correct');
}

const EloResultCommandSchema = z.strictObject({
  id: z.uuid(),
  leagueId: z.uuid(),
  expectedVersion: z.int().positive(),
  sides: z.tuple([
    z.array(z.uuid()).min(1).max(2),
    z.array(z.uuid()).min(1).max(2),
  ]),
  score: z.unknown(),
});

function parseEloResultCommand(command: unknown): {
  id: Id;
  leagueId: Id;
  expectedVersion: number;
  sides: Sides;
  score: TennisScore;
} {
  const parsed = EloResultCommandSchema.safeParse(command);
  if (!parsed.success) throw new DomainError('VALIDATION');
  const validated = validateAndNormalizeScore(parsed.data.score);
  const sides = parsed.data.sides as Sides;
  const playerIds = [...sides[0], ...sides[1]];
  if (sides[0].length !== sides[1].length) throw new DomainError('INVALID_SIDE_SIZE');
  if (new Set(playerIds).size !== playerIds.length) {
    throw new DomainError('DUPLICATE_MATCH_PLAYER');
  }
  return {
    id: parsed.data.id,
    leagueId: parsed.data.leagueId,
    expectedVersion: parsed.data.expectedVersion,
    sides,
    score: validated.score,
  };
}

async function lockEloPlayers(
  em: EntityManager,
  leagueId: Id,
  playerIds: readonly Id[],
): Promise<Array<{ id: string; deleted_at: Date | null }>> {
  const sorted = [...new Set(playerIds)].sort();
  return em.getConnection().execute<Array<{ id: string; deleted_at: Date | null }>>(
    `select p.id, p.deleted_at
       from players p
       join league_players lp on lp.player_id = p.id and lp.league_id = ?
      where p.id in (select value::uuid from jsonb_array_elements_text(?::jsonb))
      order by p.id
      for update of p`,
    [leagueId, JSON.stringify(sorted)],
    'all',
    em.getTransactionContext(),
  );
}

async function readEloScore(em: EntityManager, matchId: Id): Promise<TennisScore> {
  const [rule] = await em.getConnection().execute<Array<{
    opening_set_format: TennisScore['openingSetFormat'];
    deciding_set_format: TennisScore['decidingSetFormat'];
  }>>(
    'select opening_set_format, deciding_set_format from tennis_match_rules where match_id = ?',
    [matchId],
    'all',
    em.getTransactionContext(),
  );
  const sets = await em.getConnection().execute<Array<{
    set_order: number;
    kind: 'GAME_SET' | 'SUPER_TIE_BREAK';
    side_1_score: number;
    side_2_score: number;
  }>>(
    `select set_order, kind, side_1_score, side_2_score
       from tennis_sets where match_id = ? order by set_order`,
    [matchId],
    'all',
    em.getTransactionContext(),
  );
  if (!rule) throw new DomainError('INVALID_TENNIS_SCORE');
  return validateAndNormalizeScore({
    openingSetFormat: rule.opening_set_format,
    decidingSetFormat: rule.deciding_set_format,
    sets: sets.map(set => ({
      order: set.set_order,
      kind: set.kind,
      sideA: set.side_1_score,
      sideB: set.side_2_score,
    })),
  }).score;
}

async function currentEloSides(em: EntityManager, matchId: Id): Promise<Sides> {
  const rows = await readSides(em, matchId);
  if (rows.length !== 2) throw new DomainError('INVALID_SIDE_SIZE');
  return [rows[0]!.player_ids, rows[1]!.player_ids];
}

function validateEloParticipants(
  mode: 'SINGLES' | 'DOUBLES',
  requested: Sides,
  oldSides: Sides,
  rows: Array<{ id: string; deleted_at: Date | null }>,
): void {
  const size = mode === 'SINGLES' ? 1 : 2;
  if (requested[0].length !== size || requested[1].length !== size) {
    throw new DomainError('INVALID_SIDE_SIZE');
  }
  const oldIds = new Set([...oldSides[0], ...oldSides[1]]);
  const byId = new Map(rows.map(row => [row.id, row]));
  const ids = [...requested[0], ...requested[1]];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) throw new DomainError('PLAYER_NOT_IN_LEAGUE');
    if (row.deleted_at && !oldIds.has(id)) throw new DomainError('PLAYER_DELETED');
  }
}

async function advanceEloRevision(em: EntityManager, leagueId: Id): Promise<string> {
  const [row] = await em.getConnection().execute<Array<{ input_revision: string }>>(
    `update leagues
        set input_revision = input_revision + 1,
            elo_state = 'RECALCULATING', updated_at = clock_timestamp()
      where id = ? and deleted_at is null
    returning input_revision`,
    [leagueId],
    'all',
    em.getTransactionContext(),
  );
  if (!row) throw new DomainError('LEAGUE_NOT_FOUND');
  return String(row.input_revision);
}

async function replaceEloSideRows(
  em: EntityManager,
  leagueId: Id,
  matchId: Id,
  sides: Sides,
): Promise<void> {
  const transaction = em.getTransactionContext();
  await em.getConnection().execute(
    'delete from match_side_players where match_id = ? and league_id = ?',
    [matchId, leagueId],
    'all',
    transaction,
  );
  await em.getConnection().execute(
    'delete from match_sides where match_id = ? and league_id = ?',
    [matchId, leagueId],
    'all',
    transaction,
  );
  await insertEloSides(em, leagueId, matchId, sides);
}

async function insertEloRevision(
  em: EntityManager,
  match: LockedMatch,
  leagueId: Id,
  sides: Sides,
  score: TennisScore,
  deletedAt: 'delete' | null,
  replaceSides: boolean,
): Promise<number> {
  if (replaceSides) await replaceEloSideRows(em, leagueId, match.id, sides);
  await em.getConnection().execute(
    'delete from tennis_sets where match_id = ?',
    [match.id],
    'all',
    em.getTransactionContext(),
  );
  await em.getConnection().execute(
    'delete from tennis_match_rules where match_id = ?',
    [match.id],
    'all',
    em.getTransactionContext(),
  );
  await insertEloScore(em, match.id, score);
  const [updated] = await em.getConnection().execute<Array<{
    result_version: number;
    deleted_at: Date | string | null;
  }>>(
    `update matches
        set result_version = result_version + 1,
            deleted_at = case when ? = 'delete' then clock_timestamp() else deleted_at end,
            updated_at = clock_timestamp()
      where id = ? and league_id = ? and result_version = ?
    returning result_version, deleted_at`,
    [deletedAt, match.id, leagueId, match.result_version],
    'all',
    em.getTransactionContext(),
  );
  if (!updated) throw new DomainError('VERSION_CONFLICT');
  const snapshot: MatchRevisionSnapshot = {
    matchId: match.id,
    leagueId,
    version: updated.result_version,
    status: 'COMPLETED',
    resultRecordedAt: new Date(match.result_recorded_at!).toISOString(),
    deletedAt: updated.deleted_at
      ? new Date(updated.deleted_at).toISOString()
      : null,
    eloKSnapshot: match.elo_k_snapshot,
    sides: sides.map((playerIds, index) => ({
      sideNumber: (index + 1) as 1 | 2,
      teamId: null,
      playerIds: [...playerIds],
    })),
    score,
  };
  await em.getConnection().execute(
    `insert into match_revisions (id, match_id, version, snapshot)
     values (?, ?, ?, ?::jsonb)`,
    [randomUUID(), match.id, updated.result_version, JSON.stringify(snapshot)],
    'all',
    em.getTransactionContext(),
  );
  return updated.result_version;
}

export async function correctEloMatch(
  em: EntityManager,
  command: Versioned & { leagueId: Id; sides: Sides; score: TennisScore },
): Promise<{ id: Id; version: number }> {
  const parsed = parseEloResultCommand(command);
  return inMutationTransaction(em, async tx => {
    const league = await getVisibleLeagueForUpdate(tx, parsed.leagueId);
    if (league.kind !== 'ELO_INFINITE') throw new DomainError('FORBIDDEN_OPERATION');
    const [candidate] = await tx.getConnection().execute<LockedMatch[]>(
      `select id, league_id, status, result_version, result_recorded_at,
              elo_k_snapshot, deleted_at
         from matches where id = ? and league_id = ?`,
      [parsed.id, league.id],
      'all',
      tx.getTransactionContext(),
    );
    if (!candidate || candidate.deleted_at) throw new DomainError('MATCH_NOT_FOUND');
    if (candidate.status !== 'COMPLETED') throw new DomainError('FORBIDDEN_OPERATION');
    assertVersion(candidate.result_version, parsed.expectedVersion);
    const oldSides = await currentEloSides(tx, candidate.id);
    const rows = await lockEloPlayers(tx, league.id, [
      ...oldSides[0], ...oldSides[1], ...parsed.sides[0], ...parsed.sides[1],
    ]);
    validateEloParticipants(league.mode, parsed.sides, oldSides, rows);
    const [match] = await tx.getConnection().execute<LockedMatch[]>(
      `select id, league_id, status, result_version, result_recorded_at,
              elo_k_snapshot, deleted_at
         from matches where id = ? and league_id = ? for update`,
      [parsed.id, league.id],
      'all',
      tx.getTransactionContext(),
    );
    if (!match || match.deleted_at) throw new DomainError('MATCH_NOT_FOUND');
    if (match.status !== 'COMPLETED') throw new DomainError('FORBIDDEN_OPERATION');
    assertVersion(match.result_version, parsed.expectedVersion);
    const version = await insertEloRevision(
      tx,
      match,
      league.id,
      parsed.sides,
      parsed.score,
      null,
      true,
    );
    const revision = await advanceEloRevision(tx, league.id);
    await enqueueLatest(tx, league.id, revision);
    return { id: match.id, version };
  });
}

export async function deleteEloMatch(
  em: EntityManager,
  command: Versioned & { leagueId: Id },
): Promise<{ id: Id; version: number }> {
  const parsed = z.strictObject({
    id: z.uuid(),
    expectedVersion: z.int().positive(),
    leagueId: z.uuid(),
  }).parse(command);
  return inMutationTransaction(em, async tx => {
    const league = await getVisibleLeagueForUpdate(tx, parsed.leagueId);
    if (league.kind !== 'ELO_INFINITE') throw new DomainError('FORBIDDEN_OPERATION');
    const [candidate] = await tx.getConnection().execute<LockedMatch[]>(
      `select id, league_id, status, result_version, result_recorded_at,
              elo_k_snapshot, deleted_at
         from matches where id = ? and league_id = ?`,
      [parsed.id, league.id],
      'all',
      tx.getTransactionContext(),
    );
    if (!candidate) throw new DomainError('MATCH_NOT_FOUND');
    if (candidate.deleted_at) return { id: candidate.id, version: candidate.result_version };
    assertVersion(candidate.result_version, parsed.expectedVersion);
    if (candidate.status !== 'COMPLETED') throw new DomainError('FORBIDDEN_OPERATION');
    const sides = await currentEloSides(tx, candidate.id);
    const rows = await lockEloPlayers(tx, league.id, [...sides[0], ...sides[1]]);
    if (rows.length !== sides[0].length + sides[1].length) {
      throw new DomainError('PLAYER_NOT_IN_LEAGUE');
    }
    const [match] = await tx.getConnection().execute<LockedMatch[]>(
      `select id, league_id, status, result_version, result_recorded_at,
              elo_k_snapshot, deleted_at
         from matches where id = ? and league_id = ? for update`,
      [parsed.id, league.id],
      'all',
      tx.getTransactionContext(),
    );
    if (!match || match.deleted_at) throw new DomainError('MATCH_NOT_FOUND');
    if (match.status !== 'COMPLETED') throw new DomainError('FORBIDDEN_OPERATION');
    assertVersion(match.result_version, parsed.expectedVersion);
    const score = await readEloScore(tx, match.id);
    const version = await insertEloRevision(
      tx,
      match,
      league.id,
      sides,
      score,
      'delete',
      false,
    );
    const revision = await advanceEloRevision(tx, league.id);
    await enqueueLatest(tx, league.id, revision);
    return { id: match.id, version };
  });
}

export { createEloMatch } from '@/modules/elo/append';
