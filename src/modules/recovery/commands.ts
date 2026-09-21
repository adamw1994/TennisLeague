import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import { enqueueLatest } from '@/modules/elo/queue';
import { insertEloScore, insertEloSides } from '@/modules/elo/append';
import type { MatchRevisionSnapshot } from '@/modules/matches/revision.entity';
import type { TennisScore } from '@/modules/tennis/types';
import { validateAndNormalizeScore } from '@/modules/tennis/validate';
import type { Id, Versioned } from '@/shared/contracts';
import { DomainError } from '@/shared/errors';
import { assertVersion, inMutationTransaction, VersionedSchema } from '@/shared/mutation';

const RecoverySourceSchema = z.strictObject({
  id: z.uuid(),
  expectedVersion: z.int().positive(),
  sourceVersion: z.int().positive(),
});

interface LockedLeague {
  id: string;
  kind: 'CLASSIC' | 'ELO_INFINITE';
  status: 'ACTIVE' | 'COMPLETED';
  version: number;
  input_revision: string;
  deleted_at: Date | string | null;
}

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

interface RevisionRow {
  version: number;
  snapshot: MatchRevisionSnapshot;
}

function parseVersioned(input: Versioned): Versioned {
  const parsed = VersionedSchema.safeParse(input);
  if (!parsed.success) throw new DomainError('VALIDATION');
  return parsed.data;
}

function parseSource(input: Versioned & { sourceVersion: number }): {
  id: Id;
  expectedVersion: number;
  sourceVersion: number;
} {
  const parsed = RecoverySourceSchema.safeParse(input);
  if (!parsed.success) throw new DomainError('VALIDATION');
  return parsed.data;
}

async function lockLeague(em: EntityManager, id: Id): Promise<LockedLeague> {
  const [league] = await em.getConnection().execute<LockedLeague[]>(
    `select id, kind, status, version, input_revision, deleted_at
       from leagues where id = ? for update`,
    [id],
    'all',
    em.getTransactionContext(),
  );
  if (!league) throw new DomainError('LEAGUE_NOT_FOUND');
  return league;
}

async function lockMatch(
  em: EntityManager,
  id: Id,
  leagueId: Id,
): Promise<LockedMatch> {
  const [match] = await em.getConnection().execute<LockedMatch[]>(
    `select id, league_id, status, result_version, result_recorded_at,
            elo_k_snapshot, deleted_at
       from matches where id = ? and league_id = ? for update`,
    [id, leagueId],
    'all',
    em.getTransactionContext(),
  );
  if (!match) throw new DomainError('MATCH_NOT_FOUND');
  return match;
}

async function readSides(em: EntityManager, matchId: Id): Promise<SideRow[]> {
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

async function readRevision(
  em: EntityManager,
  matchId: Id,
  sourceVersion?: number,
): Promise<RevisionRow> {
  const rows = sourceVersion === undefined
    ? await em.getConnection().execute<RevisionRow[]>(
        `select version, snapshot
           from match_revisions
          where match_id = ? and snapshot->>'deletedAt' is null
          order by version desc limit 1`,
        [matchId],
        'all',
        em.getTransactionContext(),
      )
    : await em.getConnection().execute<RevisionRow[]>(
        `select version, snapshot
           from match_revisions where match_id = ? and version = ?`,
        [matchId, sourceVersion],
        'all',
        em.getTransactionContext(),
      );
  const revision = rows[0];
  if (!revision || revision.snapshot.deletedAt !== null) {
    throw new DomainError('RECOVERY_SOURCE_NOT_FOUND');
  }
  return revision;
}

function normalizedScore(snapshot: MatchRevisionSnapshot): TennisScore {
  return validateAndNormalizeScore(snapshot.score).score;
}

function sameSnapshotData(
  left: MatchRevisionSnapshot,
  right: MatchRevisionSnapshot,
): boolean {
  return JSON.stringify({ sides: left.sides, score: left.score }) ===
    JSON.stringify({ sides: right.sides, score: right.score });
}

async function currentRevision(
  em: EntityManager,
  matchId: Id,
  version: number,
): Promise<MatchRevisionSnapshot | null> {
  const [row] = await em.getConnection().execute<RevisionRow[]>(
    `select version, snapshot from match_revisions where match_id = ? and version = ?`,
    [matchId, version],
    'all',
    em.getTransactionContext(),
  );
  return row?.snapshot ?? null;
}

function recoveryAlreadyApplied(
  currentVersion: number,
  expectedVersion: number,
  current: MatchRevisionSnapshot | null,
  source: MatchRevisionSnapshot,
): boolean {
  return currentVersion === expectedVersion + 1 &&
    current !== null &&
    sameSnapshotData(current, source);
}

async function replaceScore(
  em: EntityManager,
  matchId: Id,
  score: TennisScore,
): Promise<void> {
  const connection = em.getConnection();
  const transaction = em.getTransactionContext();
  await connection.execute('delete from tennis_sets where match_id = ?', [matchId], 'all', transaction);
  await connection.execute('delete from tennis_match_rules where match_id = ?', [matchId], 'all', transaction);
  await insertEloScore(em, matchId, score);
}

async function replaceEloSides(
  em: EntityManager,
  leagueId: Id,
  matchId: Id,
  source: MatchRevisionSnapshot,
): Promise<void> {
  const sides = source.sides
    .sort((a, b) => a.sideNumber - b.sideNumber)
    .map(side => side.playerIds);
  if (sides.length !== 2) throw new DomainError('INVALID_SIDE_SIZE');
  const connection = em.getConnection();
  const transaction = em.getTransactionContext();
  await connection.execute(
    'delete from match_side_players where match_id = ? and league_id = ?',
    [matchId, leagueId], 'all', transaction,
  );
  await connection.execute(
    'delete from match_sides where match_id = ? and league_id = ?',
    [matchId, leagueId], 'all', transaction,
  );
  await insertEloSides(em, leagueId, matchId, sides as [string[], string[]]);
}

function assertClassicSides(
  current: SideRow[],
  source: MatchRevisionSnapshot,
): void {
  const expected = source.sides
    .sort((a, b) => a.sideNumber - b.sideNumber)
    .map(side => ({
      side_number: side.sideNumber,
      team_id: side.teamId,
      player_ids: side.playerIds,
    }));
  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    throw new DomainError('FORBIDDEN_OPERATION');
  }
}

async function restoreMatchFromRevision(
  em: EntityManager,
  command: Versioned & { sourceVersion?: number },
  idempotentActive: boolean,
): Promise<{ id: Id; version: number }> {
  const parsed = command.sourceVersion === undefined
    ? parseVersioned(command)
    : parseSource(command as Versioned & { sourceVersion: number });

  return inMutationTransaction(em, async tx => {
    const [matchLeague] = await tx.getConnection().execute<Array<{ league_id: string }>>(
      'select league_id from matches where id = ?',
      [parsed.id], 'all', tx.getTransactionContext(),
    );
    if (!matchLeague) throw new DomainError('MATCH_NOT_FOUND');
    const league = await lockLeague(tx, matchLeague.league_id);
    if (league.deleted_at) throw new DomainError('LEAGUE_NOT_FOUND');
    const match = await lockMatch(tx, parsed.id, league.id);

    if (match.deleted_at === null && idempotentActive) {
      if (match.result_version === parsed.expectedVersion || match.result_version === parsed.expectedVersion + 1) {
        return { id: match.id, version: match.result_version };
      }
      throw new DomainError('VERSION_CONFLICT');
    }

    const source = await readRevision(tx, match.id, command.sourceVersion);
    const current = await currentRevision(tx, match.id, match.result_version);
    if (match.deleted_at === null && recoveryAlreadyApplied(
      match.result_version,
      parsed.expectedVersion,
      current,
      source.snapshot,
    )) {
      return { id: match.id, version: match.result_version };
    }
    assertVersion(match.result_version, parsed.expectedVersion);
    if (match.status !== 'COMPLETED' || !match.result_recorded_at) {
      throw new DomainError('FORBIDDEN_OPERATION');
    }

    const score = normalizedScore(source.snapshot);
    const sides = await readSides(tx, match.id);
    if (sides.length !== 2) throw new DomainError('INVALID_SIDE_SIZE');
    if (league.kind === 'ELO_INFINITE') {
      await replaceEloSides(tx, league.id, match.id, source.snapshot);
    } else {
      assertClassicSides(sides, source.snapshot);
    }
    await replaceScore(tx, match.id, score);

    const [updated] = await tx.getConnection().execute<Array<{ result_version: number }>>(
      `update matches
          set deleted_at = null, status = 'COMPLETED',
              result_version = result_version + 1, updated_at = clock_timestamp()
        where id = ? and league_id = ? and result_version = ?
        returning result_version`,
      [match.id, league.id, match.result_version],
      'all', tx.getTransactionContext(),
    );
    if (!updated) throw new DomainError('VERSION_CONFLICT');

    const snapshot: MatchRevisionSnapshot = {
      ...source.snapshot,
      matchId: match.id,
      leagueId: league.id,
      version: updated.result_version,
      status: 'COMPLETED',
      resultRecordedAt: new Date(match.result_recorded_at).toISOString(),
      deletedAt: null,
      eloKSnapshot: match.elo_k_snapshot,
      score,
      sides: source.snapshot.sides.map(side => ({
        ...side,
        playerIds: [...side.playerIds],
      })),
    };
    await tx.getConnection().execute(
      `insert into match_revisions (id, match_id, version, snapshot)
       values (?, ?, ?, ?::jsonb)`,
      [randomUUID(), match.id, updated.result_version, JSON.stringify(snapshot)],
      'all', tx.getTransactionContext(),
    );

    if (league.kind === 'ELO_INFINITE') {
      const [advanced] = await tx.getConnection().execute<Array<{ input_revision: string }>>(
        `update leagues
            set input_revision = input_revision + 1,
                elo_state = 'RECALCULATING', updated_at = clock_timestamp()
          where id = ? and deleted_at is null
          returning input_revision`,
        [league.id], 'all', tx.getTransactionContext(),
      );
      if (!advanced) throw new DomainError('LEAGUE_NOT_FOUND');
      await enqueueLatest(tx, league.id, String(advanced.input_revision));
    } else {
      await tx.getConnection().execute(
        `update leagues l
            set status = case when not exists (
              select 1 from matches m where m.league_id = l.id
                and m.deleted_at is null and m.status = 'PENDING'
            ) then 'COMPLETED' else 'ACTIVE' end,
                updated_at = clock_timestamp()
          where l.id = ?`,
        [league.id], 'all', tx.getTransactionContext(),
      );
    }
    return { id: match.id, version: updated.result_version };
  });
}

export function restoreMatch(
  em: EntityManager,
  command: Versioned,
): Promise<{ id: Id; version: number }> {
  return restoreMatchFromRevision(em, command, true);
}

export function restoreMatchRevision(
  em: EntityManager,
  command: Versioned & { sourceVersion: number },
): Promise<{ id: Id; version: number }> {
  return restoreMatchFromRevision(em, command, false);
}

export function restoreLeague(
  em: EntityManager,
  command: Versioned,
): Promise<{ id: Id; version: number }> {
  const parsed = parseVersioned(command);
  return inMutationTransaction(em, async tx => {
    const league = await lockLeague(tx, parsed.id);
    if (!league.deleted_at) {
      if (league.version === parsed.expectedVersion || league.version === parsed.expectedVersion + 1) {
        return { id: league.id, version: league.version };
      }
      throw new DomainError('VERSION_CONFLICT');
    }
    assertVersion(league.version, parsed.expectedVersion);
    const [restored] = await tx.getConnection().execute<Array<{ id: string; version: number }>>(
      `update leagues
          set deleted_at = null, version = version + 1, updated_at = clock_timestamp()
        where id = ? and version = ?
        returning id, version`,
      [league.id, parsed.expectedVersion], 'all', tx.getTransactionContext(),
    );
    if (!restored) throw new DomainError('VERSION_CONFLICT');
    if (league.kind === 'ELO_INFINITE') {
      const [advanced] = await tx.getConnection().execute<Array<{ input_revision: string }>>(
        `update leagues
            set input_revision = input_revision + 1,
                elo_state = 'RECALCULATING', updated_at = clock_timestamp()
          where id = ? returning input_revision`,
        [league.id], 'all', tx.getTransactionContext(),
      );
      if (!advanced) throw new DomainError('LEAGUE_NOT_FOUND');
      await enqueueLatest(tx, league.id, String(advanced.input_revision));
    }
    return restored;
  });
}

export function restorePlayer(
  em: EntityManager,
  command: Versioned,
): Promise<{ id: Id; version: number }> {
  const parsed = parseVersioned(command);
  return inMutationTransaction(em, async tx => {
    const [player] = await tx.getConnection().execute<Array<{
      id: string;
      version: number;
      deleted_at: Date | string | null;
    }>>(
      'select id, version, deleted_at from players where id = ? for update',
      [parsed.id], 'all', tx.getTransactionContext(),
    );
    if (!player) throw new DomainError('PLAYER_NOT_FOUND');
    if (!player.deleted_at) {
      if (player.version === parsed.expectedVersion || player.version === parsed.expectedVersion + 1) {
        return { id: player.id, version: player.version };
      }
      throw new DomainError('VERSION_CONFLICT');
    }
    assertVersion(player.version, parsed.expectedVersion);
    const [restored] = await tx.getConnection().execute<Array<{ id: string; version: number }>>(
      `update players
          set deleted_at = null, version = version + 1, updated_at = clock_timestamp()
        where id = ? and version = ?
        returning id, version`,
      [player.id, parsed.expectedVersion], 'all', tx.getTransactionContext(),
    );
    if (!restored) throw new DomainError('VERSION_CONFLICT');
    return restored;
  });
}
