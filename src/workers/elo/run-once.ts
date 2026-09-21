import type { MikroORM } from '@mikro-orm/postgresql';
import { getOrm } from '@/db/orm';
import { DomainError } from '@/shared/errors';
import { replayElo } from '@/modules/elo/replay';
import { claimJob, heartbeatJob, readClaimAttempts } from './claim';
import { cancelClaim, failJob, publishReplay } from './publish';
import { readSnapshot } from './snapshot';

function errorCode(error: unknown): string {
  if (error instanceof DomainError) return error.code;
  if (error instanceof Error && error.name === 'QueryError') return 'DATABASE_ERROR';
  return 'ELO_RECALCULATION_FAILED';
}

export async function runOnce(orm?: MikroORM): Promise<boolean> {
  const database = orm ?? (await getOrm());
  const claim = await claimJob(database.em.fork());
  if (!claim) return false;
  const startedAt = Date.now();
  let snapshotMs: number | null = null;
  let calculationMs: number | null = null;
  let publishMs: number | null = null;
  const attempts = await readClaimAttempts(database.em.fork(), claim);
  const log = (code: string) => {
    console.log(JSON.stringify({
      jobId: claim.jobId,
      leagueId: claim.leagueId,
      revision: claim.requestedRevision,
      claimToken: `${claim.claimToken.slice(0, 8)}…`,
      attempts,
      snapshotMs,
      calculationMs,
      publishMs,
      durationMs: Date.now() - startedAt,
      code,
    }));
  };
  const heartbeat = setInterval(() => {
    void heartbeatJob(database.em.fork(), claim).catch(() => undefined);
  }, 5_000);

  try {
    const snapshotStarted = Date.now();
    const snapshot = await readSnapshot(database.em.fork(), claim);
    snapshotMs = Date.now() - snapshotStarted;
    if (!snapshot) {
      await cancelClaim(database.em.fork(), claim);
      log('CANCELLED');
      return true;
    }
    const calculationStarted = Date.now();
    const replay = replayElo(snapshot.memberIds, snapshot.matches);
    calculationMs = Date.now() - calculationStarted;
    const publishStarted = Date.now();
    const result = await publishReplay(database.em.fork(), claim, snapshot, replay);
    publishMs = Date.now() - publishStarted;
    log(result);
  } catch (error) {
    await failJob(database.em.fork(), claim, errorCode(error));
    log(errorCode(error));
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}
