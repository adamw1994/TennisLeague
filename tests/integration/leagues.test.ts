import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  createLeague,
  deleteLeague,
  updateLeague,
  type LeagueInput,
} from '@/modules/leagues/commands';
import {
  getLeague,
  listLeagueMatches,
  listLeagues,
} from '@/modules/leagues/queries';
import { createPlayer, deletePlayer } from '@/modules/players/commands';
import { getPlayer } from '@/modules/players/queries';
import { withTestDb } from '../support/database';

async function players(em: Parameters<typeof createPlayer>[0], count: number) {
  return Promise.all(
    Array.from({ length: count }, (_, index) =>
      createPlayer(em, {
        token: randomUUID(),
        data: {
          firstName: `Imię ${index + 1}`,
          lastName: 'Testowy',
          nickname: `Gracz ${index + 1}-${randomUUID().slice(0, 6)}`,
        },
      }),
    ),
  );
}

function classicSingles(playerIds: string[], hasReturnLegs = false): LeagueInput {
  return {
    name: 'Liga singlowa',
    kind: 'CLASSIC',
    mode: 'SINGLES',
    playerIds,
    teams: [],
    hasReturnLegs,
    eloK: null,
  };
}

test('6 singlistów tworzy atomowo 15 albo 30 kompletnych meczów', async () => {
  await withTestDb(async em => {
    const createdPlayers = await players(em, 6);
    const ids = createdPlayers.map(player => player.id);

    const oneLeg = await createLeague(em, {
      token: randomUUID(),
      data: classicSingles(ids),
    });
    const twoLegs = await createLeague(em, {
      token: randomUUID(),
      data: { ...classicSingles(ids, true), name: 'Liga z rewanżami' },
    });

    expect(await getLeague(em, oneLeg.id)).toMatchObject({
      participantCount: 6,
      matchCount: 15,
      teamCount: 0,
    });
    expect(await getLeague(em, twoLegs.id)).toMatchObject({
      participantCount: 6,
      matchCount: 30,
    });
    const matches = await listLeagueMatches(em, twoLegs.id);
    expect(matches).toHaveLength(30);
    expect(matches.every(match => match.playerIdsA.length === 1)).toBe(true);
    expect(matches.every(match => match.playerIdsB.length === 1)).toBe(true);
    expect(await getPlayer(em, ids[0]!)).toMatchObject({
      leagueCount: 2,
      matchCount: 15,
    });
  });
});

test('klasyczny debel zapisuje stałe pary i jawne team_id po obu stronach', async () => {
  await withTestDb(async em => {
    const createdPlayers = await players(em, 4);
    const ids = createdPlayers.map(player => player.id);
    const created = await createLeague(em, {
      token: randomUUID(),
      data: {
        name: 'Debel stałych par',
        kind: 'CLASSIC',
        mode: 'DOUBLES',
        playerIds: ids,
        teams: [
          [ids[0]!, ids[1]!],
          [ids[2]!, ids[3]!],
        ],
        hasReturnLegs: true,
        eloK: null,
      },
    });

    const league = await getLeague(em, created.id);
    expect(league).toMatchObject({ teamCount: 2, matchCount: 2 });
    expect(league.teams.map(team => team.players.length)).toEqual([2, 2]);
    const matches = await listLeagueMatches(em, created.id);
    expect(matches).toHaveLength(2);
    expect(matches.every(match => match.playerIdsA.length === 2)).toBe(true);
    const [{ missing_team_ids: missingTeamIds }] = await em.getConnection().execute<
      { missing_team_ids: number }[]
    >(
      `select count(*)::int as missing_team_ids
         from match_sides where league_id = ? and team_id is null`,
      [created.id],
    );
    expect(missingTeamIds).toBe(0);
  });
});

test('liga Elo powstaje bez terminarza, a debel pozwala wybrać pięciu graczy', async () => {
  await withTestDb(async em => {
    const createdPlayers = await players(em, 5);
    const created = await createLeague(em, {
      token: randomUUID(),
      data: {
        name: 'Nieskończony debel',
        kind: 'ELO_INFINITE',
        mode: 'DOUBLES',
        playerIds: createdPlayers.map(player => player.id),
        teams: [],
        hasReturnLegs: null,
        eloK: 32,
      },
    });

    expect(await getLeague(em, created.id)).toMatchObject({
      participantCount: 5,
      teamCount: 0,
      matchCount: 0,
      eloK: 32,
    });
  });
});

test('ponowienie tokenu zwraca tę samą ligę i nie dubluje terminarza', async () => {
  await withTestDb(async em => {
    const ids = (await players(em, 2)).map(player => player.id);
    const token = randomUUID();
    const command = { token, data: classicSingles(ids) };

    const first = await createLeague(em, command);
    const second = await createLeague(em, command);

    expect(second).toEqual(first);
    expect(await listLeagues(em)).toHaveLength(1);
    expect(await listLeagueMatches(em, first.id)).toHaveLength(1);
  });
});

test('błąd zapisu meczów wycofuje ligę, członkostwa i terminarz', async () => {
  await withTestDb(async em => {
    const ids = (await players(em, 2)).map(player => player.id);
    await em.getConnection().execute(`
      create function reject_match_insert() returns trigger language plpgsql as $$
      begin
        raise exception 'test failure';
      end;
      $$;
      create trigger reject_match_insert
      after insert on matches for each statement execute function reject_match_insert();
    `);

    await expect(
      createLeague(em, { token: randomUUID(), data: classicSingles(ids) }),
    ).rejects.toThrow('test failure');
    const [counts] = await em.getConnection().execute<
      Array<{ leagues: number; memberships: number; matches: number }>
    >(`
      select
        (select count(*)::int from leagues) as leagues,
        (select count(*)::int from league_players) as memberships,
        (select count(*)::int from matches) as matches
    `);
    expect(counts).toEqual({ leagues: 0, memberships: 0, matches: 0 });
  });
});

test('odrzuca złą konfigurację, podwójną parę i ponad 5000 meczów przed zapisem', async () => {
  await withTestDb(async em => {
    const ids = (await players(em, 4)).map(player => player.id);
    await expect(
      createLeague(em, {
        token: randomUUID(),
        data: {
          name: 'Błędne pary',
          kind: 'CLASSIC',
          mode: 'DOUBLES',
          playerIds: ids,
          teams: [
            [ids[0]!, ids[1]!],
            [ids[0]!, ids[2]!],
          ],
          hasReturnLegs: false,
          eloK: null,
        },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    await expect(
      createLeague(em, {
        token: randomUUID(),
        data: classicSingles(Array.from({ length: 101 }, () => randomUUID())),
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fields: { playerIds: 'Terminarz może zawierać maksymalnie 5000 meczów.' },
    });
    expect(await listLeagues(em)).toEqual([]);
  });
});

test('nie pozwala dodać usuniętego gracza do nowej ligi', async () => {
  await withTestDb(async em => {
    const createdPlayers = await players(em, 2);
    await deletePlayer(em, {
      id: createdPlayers[0]!.id,
      expectedVersion: createdPlayers[0]!.version,
    });

    await expect(
      createLeague(em, {
        token: randomUUID(),
        data: classicSingles(createdPlayers.map(player => player.id)),
      }),
    ).rejects.toMatchObject({ code: 'PLAYER_NOT_FOUND' });
  });
});

test('ustawienia zmieniają tylko nazwę i K Elo, a usunięta liga znika z odczytów', async () => {
  await withTestDb(async em => {
    const ids = (await players(em, 2)).map(player => player.id);
    const classic = await createLeague(em, {
      token: randomUUID(),
      data: classicSingles(ids),
    });
    await expect(
      updateLeague(em, {
        id: classic.id,
        expectedVersion: classic.version,
        name: 'Zmiana',
        eloK: 40,
      }),
    ).rejects.toMatchObject({ code: 'STRUCTURAL_LEAGUE_CHANGE_FORBIDDEN' });
    await expect(
      updateLeague(em, {
        id: classic.id,
        expectedVersion: classic.version,
        name: 'Zmiana',
        kind: 'ELO_INFINITE',
      } as never),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    const updated = await updateLeague(em, {
      id: classic.id,
      expectedVersion: classic.version,
      name: 'Nowa nazwa',
    });
    const removed = await deleteLeague(em, {
      id: classic.id,
      expectedVersion: updated.version,
    });
    await expect(
      deleteLeague(em, { id: classic.id, expectedVersion: 1 }),
    ).resolves.toEqual(removed);
    await expect(getLeague(em, classic.id)).rejects.toMatchObject({
      code: 'LEAGUE_NOT_FOUND',
    });
    expect(await listLeagues(em)).toEqual([]);
  });
});

test('klucze złożone blokują gracza obcej ligi i powtórkę po obu stronach', async () => {
  await withTestDb(async em => {
    const ids = (await players(em, 3)).map(player => player.id);
    const first = await createLeague(em, {
      token: randomUUID(),
      data: classicSingles(ids.slice(0, 2)),
    });
    const second = await createLeague(em, {
      token: randomUUID(),
      data: classicSingles(ids.slice(1, 3)),
    });
    const [match] = await em.getConnection().execute<
      Array<{ id: string; side_id: string }>
    >(
      `select m.id, ms.id as side_id
         from matches m join match_sides ms on ms.match_id = m.id
        where m.league_id = ? order by ms.side_number limit 1`,
      [first.id],
    );
    await expect(
      em.getConnection().execute(
        `insert into match_side_players
           (side_id, match_id, league_id, player_id, position)
         values (?, ?, ?, ?, 2)`,
        [match!.side_id, match!.id, first.id, ids[2]],
      ),
    ).rejects.toMatchObject({ code: '23503' });

    const [foreignSide] = await em.getConnection().execute<
      Array<{ id: string; match_id: string }>
    >(
      `select ms.id, ms.match_id from match_sides ms where ms.league_id = ? limit 1`,
      [second.id],
    );
    await expect(
      em.getConnection().execute(
        `insert into match_side_players
           (side_id, match_id, league_id, player_id, position)
         values (?, ?, ?, ?, 2)`,
        [foreignSide!.id, foreignSide!.match_id, second.id, ids[1]],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
});
