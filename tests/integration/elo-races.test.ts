import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { claimJob } from '@/workers/elo/claim';
import { failJob } from '@/workers/elo/publish';
import { createEloMatch, correctEloMatch } from '@/modules/matches/commands';
import type { TennisScore } from '@/modules/tennis/types';
import { withTestDb } from '../support/database';
import { makeEloLeague } from '../support/fixtures';

const score: TennisScore = {
  openingSetFormat: 'FAST4',
  decidingSetFormat: null,
  sets: [
    { order: 1, kind: 'GAME_SET', sideA: 4, sideB: 0 },
    { order: 2, kind: 'GAME_SET', sideA: 4, sideB: 0 },
  ],
};

test('dwóch workerów nie może przejąć tego samego joba', async () => {
  await withTestDb(async (em, context) => {
    const { leagueId, playerIds: [a, b] } = await makeEloLeague(em);
    const match = await createEloMatch(em, {
      token: randomUUID(),
      data: { leagueId, sides: [[a!], [b!]], score },
    });
    await correctEloMatch(em, {
      id: match.id,
      expectedVersion: 1,
      leagueId,
      sides: [[a!], [b!]],
      score,
    });

    const claims = await Promise.all([
      claimJob(context.orm.em.fork()),
      claimJob(context.orm.em.fork()),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const [job] = await em.getConnection().execute<Array<{ attempts: number }>>(
      'select attempts from elo_recalculation_jobs where league_id = ?',
      [leagueId],
    );
    expect(job?.attempts).toBe(1);
  });
});

test('błąd worker’a wraca do kolejki i po piątej próbie kończy się FAILED', async () => {
  await withTestDb(async (em, context) => {
    const { leagueId, playerIds: [a, b] } = await makeEloLeague(em);
    const match = await createEloMatch(em, {
      token: randomUUID(),
      data: { leagueId, sides: [[a!], [b!]], score },
    });
    await correctEloMatch(em, {
      id: match.id,
      expectedVersion: 1,
      leagueId,
      sides: [[a!], [b!]],
      score,
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await em.getConnection().execute(
        `update elo_recalculation_jobs
            set available_at = clock_timestamp(),
                lease_until = null,
                status = case when status = 'RUNNING' then 'PENDING' else status end
          where league_id = ?`,
        [leagueId],
      );
      const claim = await claimJob(context.orm.em.fork());
      expect(claim).not.toBeNull();
      await failJob(context.orm.em.fork(), claim!, 'ELO_RECALCULATION_FAILED');
    }

    const [job] = await em.getConnection().execute<Array<{ status: string; attempts: number }>>(
      'select status, attempts from elo_recalculation_jobs where league_id = ?',
      [leagueId],
    );
    expect(job).toMatchObject({ status: 'FAILED', attempts: 5 });
  });
});

