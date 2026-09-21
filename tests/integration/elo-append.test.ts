import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { getEloRanking } from '@/modules/elo/queries';
import { replayElo } from '@/modules/elo/replay';
import type { ReplayMatch } from '@/modules/elo/types';
import { joinEloLeague, updateLeague } from '@/modules/leagues/commands';
import { createEloMatch } from '@/modules/matches/commands';
import { createPlayer, deletePlayer } from '@/modules/players/commands';
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

test('liga Elo zaczyna od kompletnej publikacji zerowej', async () => {
  await withTestDb(async em => {
    const { leagueId, playerIds } = await makeEloLeague(em);
    const ranking = await getEloRanking(em, leagueId);

    expect(ranking).toMatchObject({
      inputRevision: '0',
      publishedRevision: '0',
      state: 'CURRENT',
    });
    expect(ranking.rows.map(row => row.playerId).sort()).toEqual([...playerIds].sort());
    expect(ranking.rows.map(row => [row.rating, row.played, row.lastDelta])).toEqual([
      [1000, 0, null],
      [1000, 0, null],
    ]);
    expect(ranking.rows.map(row => row.place)).toEqual([1, 1]);
  });
});

test('zapis meczu jest idempotentny, a nowy token tworzy następny mecz', async () => {
  await withTestDb(async em => {
    const { leagueId, playerIds: [a, b] } = await makeEloLeague(em);
    const token = randomUUID();
    const command = {
      token,
      data: { leagueId, sides: [[a!], [b!]] as const, score },
    };
    const first = await createEloMatch(em, command);
    const repeated = await createEloMatch(em, command);
    const second = await createEloMatch(em, { ...command, token: randomUUID() });
    const ranking = await getEloRanking(em, leagueId);

    expect(repeated).toEqual(first);
    expect(second.id).not.toBe(first.id);
    expect(ranking.rows.map(row => row.rating).sort((x, y) => x - y)).toEqual([969, 1031]);
    expect(ranking.rows.map(row => row.played)).toEqual([2, 2]);
    expect(ranking.inputRevision).toBe('2');
    expect(ranking.publishedRevision).toBe('2');
  });
});

test('dwa równoczesne mecze z tym samym zegarem odpowiadają pełnemu replay', async () => {
  await withTestDb(async em => {
    const { leagueId, playerIds: [a, b] } = await makeEloLeague(em);
    const fixed = new Date('2026-09-18T12:00:00.000Z');
    await Promise.all(
      [0, 1].map(() =>
        createEloMatch(
          em.fork(),
          {
            token: randomUUID(),
            data: { leagueId, sides: [[a!], [b!]], score },
          },
          { now: fixed },
        ),
      ),
    );
    const ranking = await getEloRanking(em.fork(), leagueId);
    const matches = await em.getConnection().execute<
      Array<{
        id: string;
        result_version: number;
        result_recorded_at: Date;
        elo_k_snapshot: number;
      }>
    >(
      `select id, result_version, result_recorded_at, elo_k_snapshot
         from matches where league_id = ? order by result_recorded_at, id`,
      [leagueId],
    );
    const replayMatches: ReplayMatch[] = matches.map(match => ({
      id: match.id,
      version: match.result_version,
      resultRecordedAt: new Date(match.result_recorded_at).toISOString(),
      sides: [[a!], [b!]],
      winner: 'A',
      k: match.elo_k_snapshot,
    }));
    const replay = replayElo([a!, b!], replayMatches);

    expect(new Date(matches[1]!.result_recorded_at).getTime() - new Date(matches[0]!.result_recorded_at).getTime())
      .toBe(1);
    expect(ranking.rows.map(row => [row.playerId, row.rating]).sort())
      .toEqual([...replay.ratings].sort());
    expect(ranking.inputRevision).toBe(ranking.publishedRevision);
  });
});

test('debel zapisuje cztery indywidualne zdarzenia tej samej zmiany strony', async () => {
  await withTestDb(async em => {
    const { leagueId, playerIds: [a, b, c, d] } = await makeEloLeague(
      em,
      'DOUBLES',
      4,
    );
    const created = await createEloMatch(em, {
      token: randomUUID(),
      data: {
        leagueId,
        sides: [
          [a!, b!],
          [c!, d!],
        ],
        score,
      },
    });
    const ranking = await getEloRanking(em, leagueId);
    const events = await em.getConnection().execute<
      Array<{ calculated_delta: number }>
    >(
      `select calculated_delta from elo_rating_events
        where publication_id = (
          select published_publication_id from leagues where id = ?
        ) and match_id = ?
        order by calculated_delta`,
      [leagueId, created.id],
    );

    expect(ranking.rows.map(row => row.rating).sort((x, y) => x - y)).toEqual([984, 984, 1016, 1016]);
    expect(events.map(event => event.calculated_delta)).toEqual([-16, -16, 16, 16]);
  });
});

test('zmiana K dotyczy następnego meczu, a dodanie członka publikuje jego 1000', async () => {
  await withTestDb(async em => {
    const { leagueId, playerIds: [a, b] } = await makeEloLeague(em);
    await updateLeague(em, {
      id: leagueId,
      expectedVersion: 1,
      name: 'Elo po zmianie K',
      eloK: 60,
    });
    const match = await createEloMatch(em, {
      token: randomUUID(),
      data: { leagueId, sides: [[a!], [b!]], score },
    });
    const newcomer = await createPlayer(em, {
      token: randomUUID(),
      data: { firstName: 'Nowy', lastName: 'Elo', nickname: `nowy-${randomUUID().slice(0, 8)}` },
    });
    await joinEloLeague(em, {
      token: randomUUID(),
      data: { leagueId, playerId: newcomer.id },
    });
    const [stored] = await em.getConnection().execute<
      Array<{ elo_k_snapshot: number }>
    >('select elo_k_snapshot from matches where id = ?', [match.id]);
    const ranking = await getEloRanking(em, leagueId);

    expect(stored?.elo_k_snapshot).toBe(60);
    expect(ranking.rows.find(row => row.playerId === newcomer.id)).toMatchObject({
      rating: 1000,
      played: 0,
      lastDelta: null,
    });
    expect(ranking.inputRevision).toBe('2');
    expect(ranking.publishedRevision).toBe('2');
  });
});

test('dodanie członka podczas nieaktualnego rankingu zleca najnowszy replay', async () => {
  await withTestDb(async em => {
    const { leagueId } = await makeEloLeague(em);
    await em.getConnection().execute(
      `update leagues set elo_state = 'FAILED', input_revision = 4 where id = ?`,
      [leagueId],
    );
    const newcomer = await createPlayer(em, {
      token: randomUUID(),
      data: { firstName: 'Replay', lastName: 'Pending', nickname: `pending-${randomUUID().slice(0, 8)}` },
    });
    await joinEloLeague(em, {
      token: randomUUID(),
      data: { leagueId, playerId: newcomer.id },
    });
    const [league] = await em.getConnection().execute<
      Array<{ elo_state: string; input_revision: string; published_revision: string }>
    >(
      'select elo_state, input_revision, published_revision from leagues where id = ?',
      [leagueId],
    );
    const [job] = await em.getConnection().execute<
      Array<{ status: string; requested_revision: string }>
    >(
      'select status, requested_revision from elo_recalculation_jobs where league_id = ?',
      [leagueId],
    );

    expect(league).toMatchObject({
      elo_state: 'RECALCULATING',
      input_revision: '5',
      published_revision: '0',
    });
    expect(job).toMatchObject({ status: 'PENDING', requested_revision: '5' });
  });
});

test('usunięty gracz nie może trafić do nowego meczu', async () => {
  await withTestDb(async em => {
    const { leagueId, playerIds: [a, b] } = await makeEloLeague(em);
    await deletePlayer(em, { id: a!, expectedVersion: 1 });

    await expect(
      createEloMatch(em, {
        token: randomUUID(),
        data: { leagueId, sides: [[a!], [b!]], score },
      }),
    ).rejects.toMatchObject({ code: 'PLAYER_NOT_IN_LEAGUE' });
    const ranking = await getEloRanking(em, leagueId);
    expect(ranking.inputRevision).toBe('0');
  });
});
