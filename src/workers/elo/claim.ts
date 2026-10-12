import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { inMutationTransaction } from '@/shared/mutation';

export interface Claim {
  jobId: string;
  leagueId: string;
  claimToken: string;
  requestedRevision: string;
}

async function claimInTransaction(em: EntityManager): Promise<Claim | null> {
  const connection = em.getConnection();
  const transaction = em.getTransactionContext();
  const rows = await connection.execute<Array<{
    id: string;
    league_id: string;
  }>>(
    `select id, league_id
       from elo_recalculation_jobs
      where (status = 'PENDING' and available_at <= clock_timestamp())
         or (status = 'RUNNING' and lease_until < clock_timestamp())
      order by available_at, id
      for update skip locked
      limit 1`,
    [],
    'all',
    transaction,
  );
  const candidate = rows[0];
  if (!candidate) return null;
  const claimToken = randomUUID();
  const [claimed] = await connection.execute<Array<{
    id: string;
    league_id: string;
    requested_revision: string;
  }>>(
    `update elo_recalculation_jobs
        set status = 'RUNNING', claim_token = ?,
            lease_until = clock_timestamp() + interval '30 seconds',
            attempts = attempts + 1,
            started_at = coalesce(started_at, clock_timestamp()),
            finished_at = null, last_error_code = null,
            updated_at = clock_timestamp()
      where id = ?
    returning id, league_id, requested_revision, attempts`,
    [claimToken, candidate.id],
    'all',
    transaction,
  );
  if (!claimed) return null;
  return {
    jobId: claimed.id,
    leagueId: claimed.league_id,
    claimToken,
    requestedRevision: String(claimed.requested_revision),
  };
}

export async function readClaimAttempts(
  em: EntityManager,
  claim: Claim,
): Promise<number | null> {
  const [row] = await em.getConnection().execute<Array<{ attempts: number }>>(
    `select attempts from elo_recalculation_jobs
      where id = ? and claim_token = ? and status = 'RUNNING'`,
    [claim.jobId, claim.claimToken],
  );
  return row?.attempts ?? null;
}

export async function claimJob(em: EntityManager): Promise<Claim | null> {
  return inMutationTransaction(em, claimInTransaction);
}

export async function heartbeatJob(
  em: EntityManager,
  claim: Claim,
): Promise<boolean> {
  const rows = await em.getConnection().execute(
    `update elo_recalculation_jobs
        set lease_until = clock_timestamp() + interval '30 seconds',
            updated_at = clock_timestamp()
      where id = ? and claim_token = ? and status = 'RUNNING'
        and lease_until > clock_timestamp()
      returning id`,
    [claim.jobId, claim.claimToken],
    'all',
    em.getTransactionContext(),
  );
  return rows.length > 0;
}
