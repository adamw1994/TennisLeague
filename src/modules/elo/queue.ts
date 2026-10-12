import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Id } from '@/shared/contracts';
import { inMutationTransaction } from '@/shared/mutation';

async function enqueueInTransaction(
  em: EntityManager,
  leagueId: Id,
  revision: string,
): Promise<void> {
  const connection = em.getConnection();
  const transaction = em.getTransactionContext();
  // The league lock makes the requested revision and the active job one
  // linearizable state transition. Callers that already hold this lock can
  // safely acquire it again in PostgreSQL.
  const leagueRows = await connection.execute<
    Array<{ id: string; deleted_at: Date | null }>
  >(
    'select id, deleted_at from leagues where id = ? for update',
    [leagueId],
    'all',
    transaction,
  );
  const league = leagueRows[0];
  if (!league || league.deleted_at) return;

  await connection.execute(
    `update leagues
        set elo_state = 'RECALCULATING', updated_at = clock_timestamp()
      where id = ? and kind = 'ELO_INFINITE'`,
    [leagueId],
    'all',
    transaction,
  );
  const active = await connection.execute<
    Array<{ id: string; status: 'PENDING' | 'RUNNING'; requested_revision: string }>
  >(
    `select id, status, requested_revision
       from elo_recalculation_jobs
      where league_id = ? and status in ('PENDING', 'RUNNING')
      for update`,
    [leagueId],
    'all',
    transaction,
  );
  const current = active[0];
  if (current) {
    await connection.execute(
      `update elo_recalculation_jobs
          set requested_revision = greatest(requested_revision, ?::bigint),
              status = case when status = 'PENDING' then 'PENDING' else status end,
              attempts = case
                when status = 'PENDING' and requested_revision < ?::bigint then 0
                else attempts
              end,
              available_at = case when status = 'PENDING' then clock_timestamp() else available_at end,
              last_error_code = case when status = 'PENDING' then null else last_error_code end,
              updated_at = clock_timestamp()
        where id = ?`,
      [revision, revision, current.id],
      'all',
      transaction,
    );
    return;
  }

  await connection.execute(
    `insert into elo_recalculation_jobs
       (id, league_id, requested_revision, status, attempts, available_at,
        claim_token, lease_until, started_at, finished_at, last_error_code,
        created_at, updated_at)
     values (?, ?, ?::bigint, 'PENDING', 0, clock_timestamp(),
             null, null, null, null, null, clock_timestamp(), clock_timestamp())`,
    [randomUUID(), leagueId, revision],
    'all',
    transaction,
  );
}

export async function enqueueLatest(
  em: EntityManager,
  leagueId: Id,
  revision: string,
): Promise<void> {
  if (em.isInTransaction()) {
    await enqueueInTransaction(em, leagueId, revision);
    return;
  }
  await inMutationTransaction(em, tx => enqueueInTransaction(tx, leagueId, revision));
}
