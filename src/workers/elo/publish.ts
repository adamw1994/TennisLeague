import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { inMutationTransaction } from '@/shared/mutation';
import { retainRecentPublications } from '@/modules/elo/append';
import type { ReplayOutput } from '@/modules/elo/types';
import type { Claim } from './claim';
import type { Snapshot } from './snapshot';

export type PublishResult = 'PUBLISHED' | 'OBSOLETE' | 'LOST' | 'DELETED';

class ClaimLostError extends Error {}

interface JobRow {
  id: string;
  league_id: string;
  requested_revision: string;
  status: string;
  claim_token: string | null;
}

async function updateObsolete(
  em: EntityManager,
  claim: Claim,
): Promise<boolean> {
  const rows = await em.getConnection().execute(
    `update elo_recalculation_jobs
        set status = 'PENDING', claim_token = null, lease_until = null,
            available_at = clock_timestamp(), updated_at = clock_timestamp()
      where id = ? and claim_token = ? and status = 'RUNNING'
        and lease_until > clock_timestamp()
      returning id`,
    [claim.jobId, claim.claimToken],
    'all',
    em.getTransactionContext(),
  );
  return rows.length > 0;
}

async function publishInTransaction(
  em: EntityManager,
  claim: Claim,
  snapshot: Snapshot,
  replay: ReplayOutput,
): Promise<PublishResult> {
  const connection = em.getConnection();
  const transaction = em.getTransactionContext();
  const [league] = await connection.execute<
    Array<{
      id: string;
      input_revision: string;
      deleted_at: Date | string | null;
    }>
  >(
    `select id, input_revision, deleted_at
       from leagues where id = ? for update`,
    [claim.leagueId],
    'all',
    transaction,
  );

  if (!league) {
    await connection.execute(
      `update elo_recalculation_jobs
          set status = 'CANCELLED', claim_token = null, lease_until = null,
              finished_at = clock_timestamp(), updated_at = clock_timestamp()
        where id = ? and claim_token = ? and status = 'RUNNING'
          and lease_until > clock_timestamp()`,
      [claim.jobId, claim.claimToken],
      'all',
      transaction,
    );
    return 'DELETED';
  }

  const [job] = await connection.execute<JobRow[]>(
    `select id, league_id, requested_revision, status, claim_token
       from elo_recalculation_jobs
      where id = ? for update`,
    [claim.jobId],
    'all',
    transaction,
  );
  const [liveJob] = await connection.execute<
    Array<{ id: string }>
  >(
    `select id from elo_recalculation_jobs
      where id = ? and league_id = ? and status = 'RUNNING'
        and claim_token = ? and lease_until > clock_timestamp()`,
    [claim.jobId, claim.leagueId, claim.claimToken],
    'all',
    transaction,
  );
  if (!job || !liveJob) return 'LOST';

  if (league.deleted_at) {
    await connection.execute(
      `update elo_recalculation_jobs
          set status = 'CANCELLED', claim_token = null, lease_until = null,
              finished_at = clock_timestamp(), updated_at = clock_timestamp()
        where id = ? and claim_token = ? and status = 'RUNNING'
          and lease_until > clock_timestamp()`,
      [claim.jobId, claim.claimToken],
      'all',
      transaction,
    );
    return 'DELETED';
  }

  if (
    String(league.input_revision) !== snapshot.revision ||
    String(job.requested_revision) !== snapshot.revision
  ) {
    if (!(await updateObsolete(em, claim))) return 'LOST';
    await connection.execute(
      `update leagues set elo_state = 'RECALCULATING', updated_at = clock_timestamp()
        where id = ?`,
      [claim.leagueId],
      'all',
      transaction,
    );
    return 'OBSOLETE';
  }

  const publicationId = randomUUID();
  await connection.execute(
    `insert into elo_publications (id, league_id, revision)
     values (?, ?, ?::bigint)`,
    [publicationId, claim.leagueId, snapshot.revision],
    'all',
    transaction,
  );

  const ratings = snapshot.memberIds.map(playerId => ({
    playerId,
    rating: replay.ratings.get(playerId) ?? 1000,
    played: replay.played.get(playerId) ?? 0,
    lastDelta: replay.lastDelta.get(playerId) ?? null,
  }));
  await connection.execute(
    `insert into elo_ratings
       (publication_id, player_id, rating, played, last_delta)
     select ?, x."playerId", x.rating, x.played, x."lastDelta"
       from jsonb_to_recordset(?::jsonb)
         as x("playerId" uuid, rating integer, played integer, "lastDelta" integer)`,
    [publicationId, JSON.stringify(ratings)],
    'all',
    transaction,
  );

  const events = replay.events.map(event => ({
    matchId: event.matchId,
    matchVersion: event.matchVersion,
    playerId: event.playerId,
    before: event.before,
    expected: event.expected,
    actual: event.actual,
    k: event.k,
    calculatedDelta: event.calculatedDelta,
    appliedDelta: event.appliedDelta,
    after: event.after,
  }));
  if (events.length > 0) {
    await connection.execute(
      `insert into elo_rating_events
         (publication_id, match_id, match_version, player_id, rating_before,
          expected_score, actual_score, k_factor, calculated_delta,
          applied_delta, rating_after)
       select ?, x."matchId", x."matchVersion", x."playerId", x.before,
              x.expected, x.actual, x.k, x."calculatedDelta",
              x."appliedDelta", x.after
         from jsonb_to_recordset(?::jsonb)
           as x("matchId" uuid, "matchVersion" integer, "playerId" uuid,
                before integer, expected double precision, actual integer,
                k integer, "calculatedDelta" integer,
                "appliedDelta" integer, after integer)`,
      [publicationId, JSON.stringify(events)],
      'all',
      transaction,
    );
  }

  await connection.execute(
    `update leagues
        set published_publication_id = ?, published_revision = ?::bigint,
            elo_state = 'CURRENT', updated_at = clock_timestamp()
      where id = ?`,
    [publicationId, snapshot.revision, claim.leagueId],
    'all',
    transaction,
  );
  const completed = await connection.execute(
    `update elo_recalculation_jobs
        set status = 'DONE', claim_token = null, lease_until = null,
            finished_at = clock_timestamp(), updated_at = clock_timestamp()
      where id = ? and claim_token = ? and status = 'RUNNING'
        and lease_until > clock_timestamp()
      returning id`,
    [claim.jobId, claim.claimToken],
    'all',
    transaction,
  );
  if (completed.length === 0) throw new ClaimLostError();
  await retainRecentPublications(em, claim.leagueId);
  return 'PUBLISHED';
}

export async function publishReplay(
  em: EntityManager,
  claim: Claim,
  snapshot: Snapshot,
  replay: ReplayOutput,
): Promise<PublishResult> {
  try {
    return await inMutationTransaction(em, tx =>
      publishInTransaction(tx, claim, snapshot, replay),
    );
  } catch (error) {
    if (error instanceof ClaimLostError) return 'LOST';
    throw error;
  }
}

export async function cancelClaim(
  em: EntityManager,
  claim: Claim,
): Promise<void> {
  await inMutationTransaction(em, async tx => {
    await tx.getConnection().execute(
      `update elo_recalculation_jobs
          set status = 'CANCELLED', claim_token = null, lease_until = null,
              finished_at = clock_timestamp(), updated_at = clock_timestamp()
        where id = ? and claim_token = ? and status = 'RUNNING'
          and lease_until > clock_timestamp()`,
      [claim.jobId, claim.claimToken],
      'all',
      tx.getTransactionContext(),
    );
  });
}

export async function failJob(
  em: EntityManager,
  claim: Claim,
  errorCode: string,
): Promise<void> {
  await inMutationTransaction(em, async tx => {
    const connection = tx.getConnection();
    const transaction = tx.getTransactionContext();
    const [league] = await connection.execute<
      Array<{ input_revision: string; deleted_at: Date | string | null }>
    >(
      `select input_revision, deleted_at from leagues where id = ? for update`,
      [claim.leagueId],
      'all',
      transaction,
    );
    const [job] = await connection.execute<
      Array<{ attempts: number; requested_revision: string; status: string }>
    >(
      `select attempts, requested_revision, status
         from elo_recalculation_jobs
        where id = ? and claim_token = ? and status = 'RUNNING'
          and lease_until > clock_timestamp()
        for update`,
      [claim.jobId, claim.claimToken],
      'all',
      transaction,
    );
    if (!job) return;
    if (!league || league.deleted_at) {
      await connection.execute(
        `update elo_recalculation_jobs
            set status = 'CANCELLED', claim_token = null, lease_until = null,
                finished_at = clock_timestamp(), updated_at = clock_timestamp()
        where id = ? and claim_token = ? and status = 'RUNNING'
            and lease_until > clock_timestamp()`,
        [claim.jobId, claim.claimToken],
        'all',
        transaction,
      );
      return;
    }
    if (String(league.input_revision) !== String(job.requested_revision)) {
      await connection.execute(
        `update elo_recalculation_jobs
            set status = 'PENDING', claim_token = null, lease_until = null,
                available_at = clock_timestamp(), updated_at = clock_timestamp()
          where id = ? and claim_token = ? and status = 'RUNNING'
            and lease_until > clock_timestamp()`,
        [claim.jobId, claim.claimToken],
        'all',
        transaction,
      );
      await connection.execute(
        `update leagues set elo_state = 'RECALCULATING', updated_at = clock_timestamp()
          where id = ?`,
        [claim.leagueId],
        'all',
        transaction,
      );
      return;
    }
    const terminal = job.attempts >= 5;
    await connection.execute(
      `update elo_recalculation_jobs
          set status = ?, claim_token = null, lease_until = null,
              available_at = case when ? then available_at
                else clock_timestamp() +
                  (least(8, power(2, greatest(attempts - 1, 0))) * interval '1 second') end,
              finished_at = case when ? then clock_timestamp() else null end,
              last_error_code = ?, updated_at = clock_timestamp()
        where id = ? and claim_token = ? and status = 'RUNNING'
          and lease_until > clock_timestamp()`,
      [terminal ? 'FAILED' : 'PENDING', terminal, terminal, errorCode, claim.jobId, claim.claimToken],
      'all',
      transaction,
    );
    await connection.execute(
      `update leagues set elo_state = ?, updated_at = clock_timestamp() where id = ?`,
      [terminal ? 'FAILED' : 'RECALCULATING', claim.leagueId],
      'all',
      transaction,
    );
  });
}
