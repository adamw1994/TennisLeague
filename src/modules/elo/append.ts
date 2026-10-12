import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import { getVisibleLeagueForUpdate } from '@/modules/leagues/queries';
import type { MatchRevisionSnapshot } from '@/modules/matches/revision.entity';
import type { TennisScore } from '@/modules/tennis/types';
import { validateAndNormalizeScore } from '@/modules/tennis/validate';
import type { Creation, Id, Sides } from '@/shared/contracts';
import { DomainError } from '@/shared/errors';
import { once } from '@/shared/idempotency';
import { CreationSchema, inMutationTransaction } from '@/shared/mutation';
import { calculateElo, ELO_INITIAL_RATING } from './calculate';
import { enqueueLatest } from './queue';

const EloMatchInputSchema = z.strictObject({
  leagueId: z.uuid(),
  sides: z.tuple([
    z.array(z.uuid()).min(1).max(2),
    z.array(z.uuid()).min(1).max(2),
  ]),
  score: z.unknown(),
});

export interface EloMatchInput {
  leagueId: Id;
  sides: Sides;
  score: TennisScore;
}

export interface EloAppendOptions {
  now?: Date;
}

interface ParsedEloMatchInput {
  leagueId: Id;
  sides: Sides;
  score: TennisScore;
  winner: 'A' | 'B';
}

function parseInput(command: Creation<EloMatchInput>): {
  token: string;
  data: ParsedEloMatchInput;
} {
  const parsed = CreationSchema(EloMatchInputSchema).safeParse(command);
  if (!parsed.success) {
    throw new DomainError('VALIDATION', {
      score: 'Nieprawidłowe dane meczu Elo.',
    });
  }
  const score = validateAndNormalizeScore(parsed.data.data.score);
  const sides = parsed.data.data.sides as Sides;
  const players = [...sides[0], ...sides[1]];
  if (
    sides[0].length !== sides[1].length ||
    new Set(players).size !== players.length
  ) {
    throw new DomainError(
      sides[0].length !== sides[1].length
        ? 'INVALID_SIDE_SIZE'
        : 'DUPLICATE_MATCH_PLAYER',
    );
  }
  return {
    token: parsed.data.token,
    data: {
      leagueId: parsed.data.data.leagueId,
      sides,
      score: score.score,
      winner: score.projection.winner,
    },
  };
}

async function lockActiveMembers(
  em: EntityManager,
  leagueId: Id,
  playerIds: readonly Id[],
): Promise<void> {
  const sorted = [...playerIds].sort();
  const rows = await em.getConnection().execute<Array<{ id: string }>>(
    `select p.id
       from players p
       join league_players lp on lp.player_id = p.id and lp.league_id = ?
      where p.id in (
        select value::uuid from jsonb_array_elements_text(?::jsonb)
      ) and p.deleted_at is null
      order by p.id
      for share of p`,
    [leagueId, JSON.stringify(sorted)],
    'all',
    em.getTransactionContext(),
  );
  if (rows.length !== sorted.length) {
    throw new DomainError('PLAYER_NOT_IN_LEAGUE', {
      sides: 'Każdy gracz musi być aktywnym uczestnikiem tej ligi.',
    });
  }
}

export async function insertEloScore(
  em: EntityManager,
  matchId: Id,
  score: TennisScore,
): Promise<void> {
  const connection = em.getConnection();
  const transaction = em.getTransactionContext();
  await connection.execute(
    `insert into tennis_match_rules
       (match_id, opening_set_format, deciding_set_format)
     values (?, ?, ?)`,
    [matchId, score.openingSetFormat, score.decidingSetFormat],
    'all',
    transaction,
  );
  const sets = score.sets.map(set => ({ id: randomUUID(), ...set }));
  await connection.execute(
    `insert into tennis_sets
       (id, match_id, set_order, kind, side_1_score, side_2_score)
     select x.id, ?, x."order", x.kind, x."sideA", x."sideB"
       from jsonb_to_recordset(?::jsonb)
         as x(id uuid, "order" integer, kind text, "sideA" integer, "sideB" integer)`,
    [matchId, JSON.stringify(sets)],
    'all',
    transaction,
  );
}

export async function insertEloSides(
  em: EntityManager,
  leagueId: Id,
  matchId: Id,
  sides: Sides,
): Promise<void> {
  const records = sides.map((playerIds, index) => ({
    id: randomUUID(),
    sideNumber: index + 1,
    playerIds,
  }));
  const connection = em.getConnection();
  const transaction = em.getTransactionContext();
  await connection.execute(
    `insert into match_sides (id, match_id, league_id, side_number, team_id)
     select x.id, ?, ?, x."sideNumber", null
       from jsonb_to_recordset(?::jsonb)
         as x(id uuid, "sideNumber" integer)`,
    [matchId, leagueId, JSON.stringify(records)],
    'all',
    transaction,
  );
  const players = records.flatMap(record =>
    record.playerIds.map((playerId, index) => ({
      sideId: record.id,
      playerId,
      position: index + 1,
    })),
  );
  await connection.execute(
    `insert into match_side_players
       (side_id, match_id, league_id, player_id, position)
     select x."sideId", ?, ?, x."playerId", x.position
       from jsonb_to_recordset(?::jsonb)
         as x("sideId" uuid, "playerId" uuid, position integer)`,
    [matchId, leagueId, JSON.stringify(players)],
    'all',
    transaction,
  );
}

export async function retainRecentPublications(
  em: EntityManager,
  leagueId: Id,
): Promise<void> {
  await em.getConnection().execute(
    `delete from elo_publications p
      where p.league_id = ?
        and p.id not in (
          select kept.id
            from elo_publications kept
           where kept.league_id = ?
           order by kept.revision desc
           limit 3
        )`,
    [leagueId, leagueId],
    'all',
    em.getTransactionContext(),
  );
}

async function copyPublication(
  em: EntityManager,
  leagueId: Id,
  oldPublicationId: Id,
  revision: string,
): Promise<Id> {
  const publicationId = randomUUID();
  const connection = em.getConnection();
  const transaction = em.getTransactionContext();
  await connection.execute(
    `insert into elo_publications (id, league_id, revision)
     values (?, ?, ?::bigint)`,
    [publicationId, leagueId, revision],
    'all',
    transaction,
  );
  await connection.execute(
    `insert into elo_ratings
       (publication_id, player_id, rating, played, last_delta)
     select ?, player_id, rating, played, last_delta
       from elo_ratings where publication_id = ?`,
    [publicationId, oldPublicationId],
    'all',
    transaction,
  );
  await connection.execute(
    `insert into elo_rating_events
       (publication_id, match_id, match_version, player_id, rating_before,
        expected_score, actual_score, k_factor, calculated_delta,
        applied_delta, rating_after)
     select ?, match_id, match_version, player_id, rating_before,
            expected_score, actual_score, k_factor, calculated_delta,
            applied_delta, rating_after
       from elo_rating_events where publication_id = ?`,
    [publicationId, oldPublicationId],
    'all',
    transaction,
  );
  return publicationId;
}

export async function initializeEloLeague(
  em: EntityManager,
  leagueId: Id,
  playerIds: readonly Id[],
): Promise<void> {
  const publicationId = randomUUID();
  const connection = em.getConnection();
  const transaction = em.getTransactionContext();
  await connection.execute(
    `insert into elo_publications (id, league_id, revision)
     values (?, ?, 0)`,
    [publicationId, leagueId],
    'all',
    transaction,
  );
  await connection.execute(
    `insert into elo_ratings
       (publication_id, player_id, rating, played, last_delta)
     select ?, value::uuid, ?, 0, null
       from jsonb_array_elements_text(?::jsonb)`,
    [publicationId, ELO_INITIAL_RATING, JSON.stringify(playerIds)],
    'all',
    transaction,
  );
  await connection.execute(
    `update leagues
        set published_publication_id = ?, elo_state = 'CURRENT'
      where id = ? and kind = 'ELO_INFINITE'`,
    [publicationId, leagueId],
    'all',
    transaction,
  );
}

async function publishAppendedMatch(
  em: EntityManager,
  input: ParsedEloMatchInput,
  matchId: Id,
  matchVersion: number,
  k: number,
  oldPublicationId: Id,
  revision: string,
): Promise<void> {
  const playerIds = [...input.sides[0], ...input.sides[1]];
  const ratingRows = await em.getConnection().execute<
    Array<{ player_id: string; rating: number }>
  >(
    `select player_id, rating from elo_ratings
      where publication_id = ? and player_id in (
        select value::uuid from jsonb_array_elements_text(?::jsonb)
      )`,
    [oldPublicationId, JSON.stringify(playerIds)],
    'all',
    em.getTransactionContext(),
  );
  if (ratingRows.length !== playerIds.length) {
    throw new DomainError('ELO_RECALCULATION_FAILED');
  }
  const deltas = calculateElo(
    input.sides,
    new Map(ratingRows.map(row => [row.player_id, row.rating])),
    input.winner,
    k,
  );
  const publicationId = await copyPublication(
    em,
    input.leagueId,
    oldPublicationId,
    revision,
  );
  const connection = em.getConnection();
  const transaction = em.getTransactionContext();
  await connection.execute(
    `update elo_ratings r
        set rating = x.after, played = r.played + 1,
            last_delta = x."appliedDelta"
       from jsonb_to_recordset(?::jsonb)
         as x("playerId" uuid, after integer, "appliedDelta" integer)
      where r.publication_id = ? and r.player_id = x."playerId"`,
    [JSON.stringify(deltas), publicationId],
    'all',
    transaction,
  );
  await connection.execute(
    `insert into elo_rating_events
       (publication_id, match_id, match_version, player_id, rating_before,
        expected_score, actual_score, k_factor, calculated_delta,
        applied_delta, rating_after)
     select ?, ?, ?, x."playerId", x.before, x.expected, x.actual, x.k,
            x."calculatedDelta", x."appliedDelta", x.after
       from jsonb_to_recordset(?::jsonb)
         as x("playerId" uuid, before integer, expected double precision,
              actual integer, k integer, "calculatedDelta" integer,
              "appliedDelta" integer, after integer)`,
    [publicationId, matchId, matchVersion, JSON.stringify(deltas)],
    'all',
    transaction,
  );
  await connection.execute(
    `update leagues
        set published_publication_id = ?, published_revision = ?::bigint,
            elo_state = 'CURRENT', updated_at = clock_timestamp()
      where id = ?`,
    [publicationId, revision, input.leagueId],
    'all',
    transaction,
  );
  await retainRecentPublications(em, input.leagueId);
}

export async function createEloMatch(
  em: EntityManager,
  command: Creation<EloMatchInput>,
  options: EloAppendOptions = {},
): Promise<{ id: Id; version: number }> {
  const parsed = parseInput(command);
  return inMutationTransaction(em, tx =>
    once(tx, 'CREATE_ELO_MATCH', parsed.token, parsed.data, async () => {
      const league = await getVisibleLeagueForUpdate(tx, parsed.data.leagueId);
      if (league.kind !== 'ELO_INFINITE' || league.eloK === null) {
        throw new DomainError('FORBIDDEN_OPERATION');
      }
      const expectedSideSize = league.mode === 'SINGLES' ? 1 : 2;
      if (
        parsed.data.sides[0].length !== expectedSideSize ||
        parsed.data.sides[1].length !== expectedSideSize
      ) {
        throw new DomainError('INVALID_SIDE_SIZE');
      }
      const playerIds = [...parsed.data.sides[0], ...parsed.data.sides[1]];
      await lockActiveMembers(tx, league.id, playerIds);

      const candidate = options.now?.toISOString() ?? null;
      const [advanced] = await tx.getConnection().execute<
        Array<{
          last_result_recorded_at: Date | string;
          input_revision: string;
          elo_k: number;
        }>
      >(
        `with candidate_time as (
           select coalesce(?::timestamptz, clock_timestamp()) as value
         )
         update leagues l
            set last_result_recorded_at = greatest(
                  candidate_time.value,
                  coalesce(l.last_result_recorded_at + interval '1 millisecond',
                           candidate_time.value)
                ),
                input_revision = l.input_revision + 1,
                updated_at = clock_timestamp()
           from candidate_time
          where l.id = ? and l.deleted_at is null
        returning l.last_result_recorded_at, l.input_revision, l.elo_k`,
        [candidate, league.id],
        'all',
        tx.getTransactionContext(),
      );
      if (!advanced) throw new DomainError('LEAGUE_NOT_FOUND');
      const resultRecordedAt = new Date(advanced.last_result_recorded_at).toISOString();
      const revision = String(advanced.input_revision);
      const matchId = randomUUID();
      await tx.getConnection().execute(
        `insert into matches
           (id, league_id, status, elo_k_snapshot, result_version,
            result_recorded_at)
         values (?, ?, 'COMPLETED', ?, 1, ?::timestamptz)`,
        [matchId, league.id, advanced.elo_k, resultRecordedAt],
        'all',
        tx.getTransactionContext(),
      );
      await insertEloSides(tx, league.id, matchId, parsed.data.sides);
      await insertEloScore(tx, matchId, parsed.data.score);
      const snapshot: MatchRevisionSnapshot = {
        matchId,
        leagueId: league.id,
        version: 1,
        status: 'COMPLETED',
        resultRecordedAt,
        deletedAt: null,
        eloKSnapshot: advanced.elo_k,
        sides: parsed.data.sides.map((ids, index) => ({
          sideNumber: (index + 1) as 1 | 2,
          teamId: null,
          playerIds: [...ids],
        })),
        score: parsed.data.score,
      };
      await tx.getConnection().execute(
        `insert into match_revisions (id, match_id, version, snapshot)
         values (?, ?, 1, ?::jsonb)`,
        [randomUUID(), matchId, JSON.stringify(snapshot)],
        'all',
        tx.getTransactionContext(),
      );

      const canAppend =
        league.eloState === 'CURRENT' &&
        league.inputRevision === league.publishedRevision &&
        league.publishedPublicationId !== null;
      if (canAppend) {
        await publishAppendedMatch(
          tx,
          parsed.data,
          matchId,
          1,
          advanced.elo_k,
          league.publishedPublicationId!,
          revision,
        );
      } else {
        await tx.getConnection().execute(
          `update leagues set elo_state = 'RECALCULATING' where id = ?`,
          [league.id],
          'all',
          tx.getTransactionContext(),
        );
        await enqueueLatest(tx, league.id, revision);
      }
      return { id: matchId, version: 1 };
    }),
  );
}

export async function addEloLeagueMember(
  em: EntityManager,
  command: Creation<{ leagueId: Id; playerId: Id }>,
): Promise<{ id: Id; version: number }> {
  const schema = CreationSchema(
    z.strictObject({ leagueId: z.uuid(), playerId: z.uuid() }),
  );
  const parsed = schema.safeParse(command);
  if (!parsed.success) throw new DomainError('VALIDATION');
  return inMutationTransaction(em, tx =>
    once(tx, 'JOIN_ELO_LEAGUE', parsed.data.token, parsed.data.data, async () => {
      const league = await getVisibleLeagueForUpdate(tx, parsed.data.data.leagueId);
      if (league.kind !== 'ELO_INFINITE') throw new DomainError('FORBIDDEN_OPERATION');
      const playerRows = await tx.getConnection().execute<Array<{ id: string }>>(
        `select id from players
          where id = ? and deleted_at is null
          for share`,
        [parsed.data.data.playerId],
        'all',
        tx.getTransactionContext(),
      );
      if (!playerRows[0]) throw new DomainError('PLAYER_NOT_FOUND');
      const inserted = await tx.getConnection().execute<Array<{ player_id: string }>>(
        `insert into league_players (league_id, player_id)
         values (?, ?)
         on conflict (league_id, player_id) do nothing
         returning player_id`,
        [league.id, parsed.data.data.playerId],
        'all',
        tx.getTransactionContext(),
      );
      if (!inserted[0]) return { id: league.id, version: league.version };
      const [advanced] = await tx.getConnection().execute<
        Array<{ input_revision: string }>
      >(
        `update leagues
            set input_revision = input_revision + 1,
                updated_at = clock_timestamp()
          where id = ?
        returning input_revision`,
        [league.id],
        'all',
        tx.getTransactionContext(),
      );
      if (!advanced) throw new DomainError('LEAGUE_NOT_FOUND');
      const revision = String(advanced.input_revision);
      const canPublish =
        league.eloState === 'CURRENT' &&
        league.inputRevision === league.publishedRevision &&
        league.publishedPublicationId !== null;
      if (canPublish) {
        const publicationId = await copyPublication(
          tx,
          league.id,
          league.publishedPublicationId!,
          revision,
        );
        await tx.getConnection().execute(
          `insert into elo_ratings
             (publication_id, player_id, rating, played, last_delta)
           values (?, ?, ?, 0, null)`,
          [publicationId, parsed.data.data.playerId, ELO_INITIAL_RATING],
          'all',
          tx.getTransactionContext(),
        );
        await tx.getConnection().execute(
          `update leagues
              set published_publication_id = ?, published_revision = ?::bigint,
                  elo_state = 'CURRENT'
            where id = ?`,
          [publicationId, revision, league.id],
          'all',
          tx.getTransactionContext(),
        );
        await retainRecentPublications(tx, league.id);
      } else {
        await tx.getConnection().execute(
          `update leagues set elo_state = 'RECALCULATING' where id = ?`,
          [league.id],
          'all',
          tx.getTransactionContext(),
        );
        await enqueueLatest(tx, league.id, revision);
      }
      return { id: league.id, version: league.version };
    }),
  );
}
