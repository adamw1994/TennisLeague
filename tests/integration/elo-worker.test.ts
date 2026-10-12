import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { claimJob } from '@/workers/elo/claim';
import { publishReplay } from '@/workers/elo/publish';
import { readSnapshot } from '@/workers/elo/snapshot';
import { replayElo } from '@/modules/elo/replay';
import { getEloRanking } from '@/modules/elo/queries';
import { deleteLeague } from '@/modules/leagues/commands';
import { correctEloMatch, createEloMatch } from '@/modules/matches/commands';
import { runOnce } from '@/workers/elo/run-once';
import type { TennisScore } from '@/modules/tennis/types';
import { withTestDb } from '../support/database';
import { makeEloLeague } from '../support/fixtures';

const winningScore: TennisScore = {
  openingSetFormat: 'FAST4',
  decidingSetFormat: null,
  sets: [
    { order: 1, kind: 'GAME_SET', sideA: 4, sideB: 0 },
    { order: 2, kind: 'GAME_SET', sideA: 4, sideB: 0 },
  ],
};

const losingScore: TennisScore = {
  ...winningScore,
  sets: winningScore.sets.map(set => ({
    ...set,
    sideA: set.sideB,
    sideB: set.sideA,
  })),
};

test('worker publikuje korektę meczu i zamyka job', async () => {
  await withTestDb(async (em, context) => {
    const { leagueId, playerIds: [a, b] } = await makeEloLeague(em);
    const match = await createEloMatch(em, {
      token: randomUUID(),
      data: { leagueId, sides: [[a!], [b!]], score: winningScore },
    });
    await correctEloMatch(em, {
      id: match.id,
      expectedVersion: 1,
      leagueId,
      sides: [[a!], [b!]],
      score: losingScore,
    });

    const jobBefore = await em.getConnection().execute<
      Array<{ status: string; requested_revision: string }>
    >(
      'select status, requested_revision from elo_recalculation_jobs where league_id = ?',
      [leagueId],
    );
    expect(jobBefore[0]).toMatchObject({ status: 'PENDING', requested_revision: '2' });

    const claim = await claimJob(context.orm.em.fork());
    expect(claim).not.toBeNull();
    const snapshot = await readSnapshot(context.orm.em.fork(), claim!);
    expect(snapshot?.revision).toBe('2');
    const replay = replayElo(snapshot!.memberIds, snapshot!.matches);
    await expect(
      publishReplay(context.orm.em.fork(), claim!, snapshot!, replay),
    ).resolves.toBe('PUBLISHED');

    const ranking = await getEloRanking(em, leagueId);
    expect(ranking).toMatchObject({
      inputRevision: '2',
      publishedRevision: '2',
      state: 'CURRENT',
    });
    const [jobAfter] = await em.getConnection().execute<Array<{ status: string }>>(
      'select status from elo_recalculation_jobs where league_id = ?',
      [leagueId],
    );
    expect(jobAfter?.status).toBe('DONE');
  });
});

test('stary snapshot nie nadpisuje nowszej rewizji', async () => {
  await withTestDb(async (em, context) => {
    const { leagueId, playerIds: [a, b] } = await makeEloLeague(em);
    const match = await createEloMatch(em, {
      token: randomUUID(),
      data: { leagueId, sides: [[a!], [b!]], score: winningScore },
    });
    await correctEloMatch(em, {
      id: match.id,
      expectedVersion: 1,
      leagueId,
      sides: [[a!], [b!]],
      score: losingScore,
    });

    const claim = await claimJob(context.orm.em.fork());
    const snapshot = await readSnapshot(context.orm.em.fork(), claim!);
    await correctEloMatch(em, {
      id: match.id,
      expectedVersion: 2,
      leagueId,
      sides: [[a!], [b!]],
      score: winningScore,
    });

    const replay = replayElo(snapshot!.memberIds, snapshot!.matches);
    await expect(
      publishReplay(context.orm.em.fork(), claim!, snapshot!, replay),
    ).resolves.toBe('OBSOLETE');
    const [job] = await em.getConnection().execute<
      Array<{ status: string; requested_revision: string }>
    >(
      'select status, requested_revision from elo_recalculation_jobs where league_id = ?',
      [leagueId],
    );
    expect(job).toMatchObject({ status: 'PENDING', requested_revision: '3' });
    const ranking = await getEloRanking(em, leagueId);
    expect(ranking.publishedRevision).toBe('1');
    expect(ranking.inputRevision).toBe('3');
  });
});

test('runOnce wykonuje claim, replay i publikację bez udziału żądania HTTP', async () => {
  await withTestDb(async (em, context) => {
    const { leagueId, playerIds: [a, b] } = await makeEloLeague(em);
    const match = await createEloMatch(em, {
      token: randomUUID(),
      data: { leagueId, sides: [[a!], [b!]], score: winningScore },
    });
    await correctEloMatch(em, {
      id: match.id,
      expectedVersion: 1,
      leagueId,
      sides: [[a!], [b!]],
      score: losingScore,
    });
    await expect(runOnce(context.orm)).resolves.toBe(true);
    await expect(runOnce(context.orm)).resolves.toBe(false);
    await expect(getEloRanking(em, leagueId)).resolves.toMatchObject({
      inputRevision: '2',
      publishedRevision: '2',
      state: 'CURRENT',
    });
  });
});

test('worker anuluje job dla usuniętej ligi bez publikacji', async () => {
  await withTestDb(async (em, context) => {
    const { leagueId, playerIds: [a, b] } = await makeEloLeague(em);
    const match = await createEloMatch(em, {
      token: randomUUID(),
      data: { leagueId, sides: [[a!], [b!]], score: winningScore },
    });
    await correctEloMatch(em, {
      id: match.id,
      expectedVersion: 1,
      leagueId,
      sides: [[a!], [b!]],
      score: losingScore,
    });
    const claim = await claimJob(context.orm.em.fork());
    const snapshot = await readSnapshot(context.orm.em.fork(), claim!);
    await deleteLeague(em, { id: leagueId, expectedVersion: 1 });
    const replay = replayElo(snapshot!.memberIds, snapshot!.matches);
    await expect(
      publishReplay(context.orm.em.fork(), claim!, snapshot!, replay),
    ).resolves.toBe('DELETED');
    const [job] = await em.getConnection().execute<Array<{ status: string }>>(
      'select status from elo_recalculation_jobs where id = ?',
      [claim!.jobId],
    );
    expect(job?.status).toBe('CANCELLED');
  });
});
