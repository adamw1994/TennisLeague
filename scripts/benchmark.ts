import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { getOrm } from '@/db/orm';
import { createLeague } from '@/modules/leagues/commands';
import { createEloMatch, correctEloMatch } from '@/modules/matches/commands';
import { createPlayer } from '@/modules/players/commands';
import { enqueueLatest } from '@/modules/elo/queue';
import { replayElo } from '@/modules/elo/replay';
import { claimJob } from '@/workers/elo/claim';
import { publishReplay } from '@/workers/elo/publish';
import { readSnapshot } from '@/workers/elo/snapshot';
import { runOnce } from '@/workers/elo/run-once';
import type { TennisScore } from '@/modules/tennis/types';
import type { Id } from '@/shared/contracts';
import { inMutationTransaction } from '@/shared/mutation';

const SCORE: TennisScore = {
  openingSetFormat: 'FAST4',
  decidingSetFormat: null,
  sets: [
    { order: 1, kind: 'GAME_SET', sideA: 4, sideB: 1 },
    { order: 2, kind: 'GAME_SET', sideA: 4, sideB: 2 },
  ],
};

const ITERATIONS = 20;
const PLAYERS = 30;
const ELO_MATCHES = 500;

function percentile(values: number[], percentileValue: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((percentileValue / 100) * sorted.length) - 1,
  );
  return Number(sorted[Math.max(0, index)]!.toFixed(2));
}

function summary(values: number[]) {
  return {
    count: values.length,
    medianMs: percentile(values, 50),
    p95Ms: percentile(values, 95),
    maxMs: percentile(values, 100),
  };
}

function pairFor(index: number, count: number): [Id, Id] {
  const first = index % count;
  const second = (index * 11 + 7) % count;
  return [String(first), String(second === first ? (second + 1) % count : second)];
}

function scoreFor(index: number): TennisScore {
  return index % 2 === 0
    ? SCORE
    : {
        ...SCORE,
        sets: [
          { order: 1, kind: 'GAME_SET', sideA: 1, sideB: 4 },
          { order: 2, kind: 'GAME_SET', sideA: 2, sideB: 4 },
        ],
      };
}

async function makePlayers(em: EntityManager): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < PLAYERS; index += 1) {
    const player = await createPlayer(em, {
      token: randomUUID(),
      data: {
        firstName: `Benchmark ${index + 1}`,
        lastName: 'Seed 20260918',
        nickname: `benchmark-20260918-${String(index + 1).padStart(2, '0')}`,
      },
    });
    ids.push(player.id);
  }
  return ids;
}

async function queueReplay(em: EntityManager, leagueId: Id): Promise<void> {
  await inMutationTransaction(em, async tx => {
    const [advanced] = await tx.getConnection().execute<Array<{ input_revision: string }>>(
      `update leagues
          set input_revision = input_revision + 1,
              elo_state = 'RECALCULATING', updated_at = clock_timestamp()
        where id = ? and deleted_at is null
        returning input_revision`,
      [leagueId],
      'all',
      tx.getTransactionContext(),
    );
    if (!advanced) throw new Error('benchmark league not found');
    await enqueueLatest(tx, leagueId, String(advanced.input_revision));
  });
}

async function measureReplay(
  em: EntityManager,
  orm: Awaited<ReturnType<typeof getOrm>>,
  leagueId: Id,
): Promise<{
  jobWaitMs: number;
  snapshotMs: number;
  calculationMs: number;
  publishMs: number;
  fullLatencyMs: number;
  memberCount: number;
  matchCount: number;
  eventCount: number;
}> {
  const queuedAt = performance.now();
  await queueReplay(em, leagueId);
  const claim = await claimJob(orm.em.fork());
  if (!claim) throw new Error('benchmark replay job was not claimable');
  const jobWaitMs = performance.now() - queuedAt;

  const snapshotStarted = performance.now();
  const snapshot = await readSnapshot(orm.em.fork(), claim);
  const snapshotMs = performance.now() - snapshotStarted;
  if (!snapshot) throw new Error('benchmark snapshot was not available');

  const calculationStarted = performance.now();
  const replay = replayElo(snapshot.memberIds, snapshot.matches);
  const calculationMs = performance.now() - calculationStarted;
  const publishStarted = performance.now();
  await publishReplay(orm.em.fork(), claim, snapshot, replay);
  const publishMs = performance.now() - publishStarted;
  return {
    jobWaitMs: Number(jobWaitMs.toFixed(2)),
    snapshotMs: Number(snapshotMs.toFixed(2)),
    calculationMs: Number(calculationMs.toFixed(2)),
    publishMs: Number(publishMs.toFixed(2)),
    fullLatencyMs: Number((snapshotMs + calculationMs + publishMs).toFixed(2)),
    memberCount: snapshot.memberIds.length,
    matchCount: snapshot.matches.length,
    eventCount: replay.events.length,
  };
}

async function run(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const orm = await getOrm();
  const em = orm.em.fork();
  const started = performance.now();
  try {
    const playerIds = await makePlayers(em);
    const classicStarted = performance.now();
    const classic = await createLeague(em, {
      token: randomUUID(),
      data: {
        name: 'Benchmark Classic 30 / 870 fixtures',
        kind: 'CLASSIC',
        mode: 'SINGLES',
        playerIds,
        teams: [],
        hasReturnLegs: true,
        eloK: null,
      },
    });
    const classicScheduleMs = performance.now() - classicStarted;

    const elo = await createLeague(em, {
      token: randomUUID(),
      data: {
        name: 'Benchmark Elo 30 / 500 matches',
        kind: 'ELO_INFINITE',
        mode: 'SINGLES',
        playerIds,
        teams: [],
        hasReturnLegs: null,
        eloK: 32,
      },
    });

    const appendTimes: number[] = [];
    const matchIds: string[] = [];
    for (let index = 0; index < ELO_MATCHES; index += 1) {
      const [firstIndex, secondIndex] = pairFor(index, playerIds.length);
      const appendStarted = performance.now();
      const created = await createEloMatch(em, {
        token: randomUUID(),
        data: {
          leagueId: elo.id,
          sides: [[playerIds[Number(firstIndex)]!], [playerIds[Number(secondIndex)]!]],
          score: scoreFor(index),
        },
      });
      appendTimes.push(performance.now() - appendStarted);
      matchIds.push(created.id);
    }

    const replay = await measureReplay(em, orm, elo.id);
    const parallelTimes = await Promise.all(
      Array.from({ length: ITERATIONS }, async (_, index) => {
        const [firstIndex, secondIndex] = pairFor(ELO_MATCHES + index, playerIds.length);
        const operationStarted = performance.now();
        await createEloMatch(orm.em.fork(), {
          token: randomUUID(),
          data: {
            leagueId: elo.id,
            sides: [[playerIds[Number(firstIndex)]!], [playerIds[Number(secondIndex)]!]],
            score: scoreFor(index),
          },
        });
        return performance.now() - operationStarted;
      }),
    );

    const correctionStarted = performance.now();
    await Promise.all(
      Array.from({ length: ITERATIONS }, async (_, index) => {
        const [firstIndex, secondIndex] = pairFor(index, playerIds.length);
        await correctEloMatch(orm.em.fork(), {
          id: matchIds[index]!,
          leagueId: elo.id,
          expectedVersion: 1,
          sides: [[playerIds[Number(firstIndex)]!], [playerIds[Number(secondIndex)]!]],
          score: scoreFor(ELO_MATCHES + index),
        });
      }),
    );
    let workerRuns = 0;
    while (workerRuns < 100) {
      workerRuns += 1;
      const ran = await runOnce(orm);
      const [pending] = await em.getConnection().execute<Array<{
        status: string;
        input_revision: string;
        published_revision: string;
      }>>(
        `select j.status, l.input_revision, l.published_revision
           from elo_recalculation_jobs j
           join leagues l on l.id = j.league_id
          where j.league_id = ?
          order by j.created_at desc limit 1`,
        [elo.id],
      );
      if (
        pending?.status === 'DONE' &&
        pending.input_revision === pending.published_revision
      ) break;
      if (!ran) await new Promise(resolve => setTimeout(resolve, 10));
    }
    const correctionLatencyMs = performance.now() - correctionStarted;
    const [status] = await em.getConnection().execute<Array<{
      input_revision: string;
      published_revision: string;
      elo_state: string;
    }>>(
      'select input_revision, published_revision, elo_state from leagues where id = ?',
      [elo.id],
    );

    const result = {
      seed: 20260918,
      elapsedMs: Number((performance.now() - started).toFixed(2)),
      hardware: {
        cpu: process.env.BENCHMARK_CPU ?? 'not supplied',
        memory: process.env.BENCHMARK_MEMORY ?? 'not supplied',
        image: process.env.BENCHMARK_IMAGE ?? 'local Node runtime',
      },
      generated: {
        playerCount: playerIds.length,
        classicLeagueId: classic.id,
        classicMatchCount: 870,
        classicScheduleMs: Number(classicScheduleMs.toFixed(2)),
        eloLeagueId: elo.id,
        eloMatchCount: ELO_MATCHES,
      },
      append: summary(appendTimes),
      parallelAppend: summary(parallelTimes),
      replay,
      correctionLatencyMs: Number(correctionLatencyMs.toFixed(2)),
      correctionSeriesCount: ITERATIONS,
      fullUserVisibleLatencyMs: Number(correctionLatencyMs.toFixed(2)),
      uiLatencyMs: null,
      queryCount: null,
      finalEloStatus: status,
      thresholds: {
        ordinaryMutationP95Ms: 1000,
        publication500MatchesMs: 10_000,
        ordinaryMutationP95Passed: percentile(appendTimes, 95) < 1000,
        publication500MatchesPassed: replay.fullLatencyMs < 10_000,
      },
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await orm.close(true);
  }
}

void run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
