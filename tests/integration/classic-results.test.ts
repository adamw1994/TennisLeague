import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { createLeague, type LeagueInput } from '@/modules/leagues/commands';
import { getLeague } from '@/modules/leagues/queries';
import {
  correctClassicResult,
  recordClassicResult,
} from '@/modules/matches/commands';
import { getClassicStandings, getMatch } from '@/modules/matches/queries';
import { createPlayer, deletePlayer } from '@/modules/players/commands';
import type { TennisScore } from '@/modules/tennis/types';
import { withTestDb } from '../support/database';

const straightFast4: TennisScore = {
  openingSetFormat: 'FAST4',
  decidingSetFormat: null,
  sets: [
    { order: 1, kind: 'GAME_SET', sideA: 4, sideB: 1 },
    { order: 2, kind: 'GAME_SET', sideA: 4, sideB: 2 },
  ],
};

const threeSetNormal: TennisScore = {
  openingSetFormat: 'NORMAL',
  decidingSetFormat: 'SUPER_TIE_BREAK',
  sets: [
    { order: 1, kind: 'GAME_SET', sideA: 6, sideB: 4 },
    { order: 2, kind: 'GAME_SET', sideA: 4, sideB: 6 },
    { order: 3, kind: 'SUPER_TIE_BREAK', sideA: 10, sideB: 8 },
  ],
};

async function makePlayers(
  em: Parameters<typeof createPlayer>[0],
  count: number,
) {
  const result = [];
  for (let index = 0; index < count; index += 1) {
    result.push(
      await createPlayer(em, {
        token: randomUUID(),
        data: {
          firstName: `Gracz ${index + 1}`,
          lastName: 'Wynikowy',
          nickname: `Wynik-${index + 1}-${randomUUID().slice(0, 5)}`,
        },
      }),
    );
  }
  return result;
}

async function makeClassicLeague(
  em: Parameters<typeof createLeague>[0],
  playerIds: string[],
  overrides: Partial<LeagueInput> = {},
) {
  return createLeague(em, {
    token: randomUUID(),
    data: {
      name: 'Liga wynikowa',
      kind: 'CLASSIC',
      mode: 'SINGLES',
      playerIds,
      teams: [],
      hasReturnLegs: false,
      eloK: null,
      ...overrides,
    },
  });
}

test('zapisuje wynik 2:0, rewizję, tabelę 5/0 i kończy pełną ligę', async () => {
  await withTestDb(async em => {
    const createdPlayers = await makePlayers(em, 2);
    const league = await makeClassicLeague(
      em,
      createdPlayers.map(player => player.id),
    );
    const [fixture] = await em.getConnection().execute<{ id: string }[]>(
      'select id from matches where league_id = ?',
      [league.id],
    );

    await expect(
      recordClassicResult(em, {
        id: fixture!.id,
        expectedVersion: 0,
        score: straightFast4,
      }),
    ).resolves.toEqual({ id: fixture!.id, version: 1 });

    const match = await getMatch(em, league.id, fixture!.id);
    expect(match).toMatchObject({
      status: 'COMPLETED',
      version: 1,
      resultRecordedAt: expect.any(String),
      score: straightFast4,
      projection: { setsA: 2, setsB: 0, gamesA: 8, gamesB: 3 },
    });
    expect(await getLeague(em, league.id)).toMatchObject({
      status: 'COMPLETED',
      completedMatchCount: 1,
    });
    const table = await getClassicStandings(em, league.id);
    expect(table.map(row => row.points)).toEqual([5, 0]);
    const revisions = await em.getConnection().execute<
      Array<{ version: number; snapshot: { score: TennisScore } }>
    >('select version, snapshot from match_revisions where match_id = ?', [fixture!.id]);
    expect(revisions).toEqual([
      expect.objectContaining({ version: 1, snapshot: expect.objectContaining({ score: straightFast4 }) }),
    ]);
  });
});

test('pozwala zapisać mecz z przyszłej kolejki mimo zaległości', async () => {
  await withTestDb(async em => {
    const playerIds = (await makePlayers(em, 4)).map(player => player.id);
    const league = await makeClassicLeague(em, playerIds);
    const [future] = await em.getConnection().execute<
      Array<{ id: string; round_number: number }>
    >(
      'select id, round_number from matches where league_id = ? order by round_number desc limit 1',
      [league.id],
    );
    expect(future!.round_number).toBeGreaterThan(1);

    await expect(
      recordClassicResult(em, {
        id: future!.id,
        expectedVersion: 0,
        score: straightFast4,
      }),
    ).resolves.toMatchObject({ version: 1 });
    expect(await getLeague(em, league.id)).toMatchObject({ status: 'ACTIVE' });
  });
});

test('dwie korekty tej samej wersji mają jednego zwycięzcę i zachowują rewizje', async () => {
  await withTestDb(async (em, context) => {
    const playerIds = (await makePlayers(em, 2)).map(player => player.id);
    const league = await makeClassicLeague(em, playerIds);
    const [fixture] = await em.getConnection().execute<{ id: string }[]>(
      'select id from matches where league_id = ?',
      [league.id],
    );
    await recordClassicResult(em, {
      id: fixture!.id,
      expectedVersion: 0,
      score: straightFast4,
    });

    const attempts = await Promise.allSettled([
      correctClassicResult(context.orm.em.fork(), {
        id: fixture!.id,
        expectedVersion: 1,
        score: threeSetNormal,
      }),
      correctClassicResult(context.orm.em.fork(), {
        id: fixture!.id,
        expectedVersion: 1,
        score: {
          ...straightFast4,
          sets: straightFast4.sets.map(set => ({
            ...set,
            sideA: set.sideB,
            sideB: set.sideA,
          })),
        },
      }),
    ]);
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.find(result => result.status === 'rejected')).toMatchObject({
      status: 'rejected',
      reason: { code: 'VERSION_CONFLICT' },
    });
    const revisions = await em.getConnection().execute<Array<{ version: number }>>(
      'select version from match_revisions where match_id = ? order by version',
      [fixture!.id],
    );
    expect(revisions).toEqual([{ version: 1 }, { version: 2 }]);
  });
});

test('korekta zachowuje pierwszy czas wyniku także po zakończeniu ligi', async () => {
  await withTestDb(async em => {
    const playerIds = (await makePlayers(em, 2)).map(player => player.id);
    const league = await makeClassicLeague(em, playerIds);
    const [fixture] = await em.getConnection().execute<{ id: string }[]>(
      'select id from matches where league_id = ?',
      [league.id],
    );
    await recordClassicResult(em, {
      id: fixture!.id,
      expectedVersion: 0,
      score: straightFast4,
    });
    const before = await getMatch(em, league.id, fixture!.id);
    await correctClassicResult(em, {
      id: fixture!.id,
      expectedVersion: 1,
      score: threeSetNormal,
    });
    const after = await getMatch(em, league.id, fixture!.id);

    expect(after.resultRecordedAt).toBe(before.resultRecordedAt);
    expect(after.score).toEqual(threeSetNormal);
    expect(await getLeague(em, league.id)).toMatchObject({ status: 'COMPLETED' });
  });
});

test('usunięty globalnie gracz zachowuje zaplanowany mecz i można wpisać wynik', async () => {
  await withTestDb(async em => {
    const createdPlayers = await makePlayers(em, 2);
    const league = await makeClassicLeague(
      em,
      createdPlayers.map(player => player.id),
    );
    await deletePlayer(em, {
      id: createdPlayers[0]!.id,
      expectedVersion: createdPlayers[0]!.version,
    });
    const [fixture] = await em.getConnection().execute<{ id: string }[]>(
      'select id from matches where league_id = ?',
      [league.id],
    );
    await expect(
      recordClassicResult(em, {
        id: fixture!.id,
        expectedVersion: 0,
        score: straightFast4,
      }),
    ).resolves.toMatchObject({ version: 1 });
  });
});

test('błąd przy trzecim secie wycofuje korektę i nie narusza poprzedniej wersji', async () => {
  await withTestDb(async em => {
    const playerIds = (await makePlayers(em, 2)).map(player => player.id);
    const league = await makeClassicLeague(em, playerIds);
    const [fixture] = await em.getConnection().execute<{ id: string }[]>(
      'select id from matches where league_id = ?',
      [league.id],
    );
    await recordClassicResult(em, {
      id: fixture!.id,
      expectedVersion: 0,
      score: straightFast4,
    });
    await em.getConnection().execute(`
      create function reject_third_set() returns trigger language plpgsql as $$
      begin
        if new.set_order = 3 then raise exception 'third set failure'; end if;
        return new;
      end;
      $$;
      create trigger reject_third_set before insert on tennis_sets
      for each row execute function reject_third_set();
    `);

    await expect(
      correctClassicResult(em, {
        id: fixture!.id,
        expectedVersion: 1,
        score: threeSetNormal,
      }),
    ).rejects.toThrow('third set failure');
    expect(await getMatch(em, league.id, fixture!.id)).toMatchObject({
      version: 1,
      score: straightFast4,
    });
    const [{ count }] = await em.getConnection().execute<{ count: number }[]>(
      'select count(*)::int as count from match_revisions where match_id = ?',
      [fixture!.id],
    );
    expect(count).toBe(1);
  });
});

test('nie udostępnia wyczyszczenia wyniku ani ponownego pierwszego zapisu', async () => {
  await withTestDb(async em => {
    const playerIds = (await makePlayers(em, 2)).map(player => player.id);
    const league = await makeClassicLeague(em, playerIds);
    const [fixture] = await em.getConnection().execute<{ id: string }[]>(
      'select id from matches where league_id = ?',
      [league.id],
    );
    await recordClassicResult(em, {
      id: fixture!.id,
      expectedVersion: 0,
      score: straightFast4,
    });
    await expect(
      recordClassicResult(em, {
        id: fixture!.id,
        expectedVersion: 1,
        score: straightFast4,
      }),
    ).rejects.toMatchObject({ code: 'MATCH_ALREADY_COMPLETED' });
    await expect(
      correctClassicResult(em, {
        id: fixture!.id,
        expectedVersion: 1,
        score: null,
      } as never),
    ).rejects.toMatchObject({ code: 'INVALID_TENNIS_SCORE' });
  });
});
