import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { deleteLeague, createLeague, type LeagueInput } from '@/modules/leagues/commands';
import { listLeagueMatches, listLeagues } from '@/modules/leagues/queries';
import { listPlayers } from '@/modules/players/queries';
import { getLeagueOverview, getPlayerStatistics, listPlayerMatches } from '@/modules/statistics/queries';
import { recordClassicResult } from '@/modules/matches/commands';
import { createPlayer } from '@/modules/players/commands';
import type { TennisScore } from '@/modules/tennis/types';
import { withTestDb } from '../support/database';

const score: TennisScore = {
  openingSetFormat: 'FAST4',
  decidingSetFormat: null,
  sets: [
    { order: 1, kind: 'GAME_SET', sideA: 4, sideB: 1 },
    { order: 2, kind: 'GAME_SET', sideA: 4, sideB: 2 },
  ],
};

async function makePlayers(em: Parameters<typeof createPlayer>[0], count: number) {
  const players = [];
  for (let index = 0; index < count; index += 1) {
    players.push(await createPlayer(em, {
      token: randomUUID(),
      data: {
        firstName: `Widoczny ${index}`,
        lastName: 'Gracz',
        nickname: `visibility-${index}-${randomUUID().slice(0, 7)}`,
      },
    }));
  }
  return players;
}

function classicDoubles(playerIds: string[], name: string): LeagueInput {
  return {
    name,
    kind: 'CLASSIC',
    mode: 'DOUBLES',
    playerIds,
    teams: [[playerIds[0]!, playerIds[1]!], [playerIds[2]!, playerIds[3]!]],
    hasReturnLegs: false,
    eloK: null,
  };
}

test('statystyki debla i overview liczą mecz raz, a obaj partnerzy dostają wynik strony', async () => {
  await withTestDb(async em => {
    const players = await makePlayers(em, 4);
    const league = await createLeague(em, {
      token: randomUUID(),
      data: classicDoubles(players.map(player => player.id), 'Widoczna liga'),
    });
    const [match] = await em.getConnection().execute<Array<{ id: string }>>(
      'select id from matches where league_id = ?',
      [league.id],
    );
    await recordClassicResult(em, { id: match!.id, expectedVersion: 0, score });

    const first = await getPlayerStatistics(em, { playerId: players[0]!.id, mode: 'DOUBLES' });
    const second = await getPlayerStatistics(em, { playerId: players[1]!.id, mode: 'DOUBLES' });
    expect(first).toEqual(second);
    expect(first).toMatchObject({ played: 1 });
    expect(first.won + first.lost).toBe(1);
    expect(first.setsFor + first.setsAgainst).toBe(2);
    expect(first.gamesFor + first.gamesAgainst).toBe(11);
    await expect(getLeagueOverview(em, league.id)).resolves.toMatchObject({
      matchCount: 1,
      completedMatchCount: 1,
      remainingMatchCount: 0,
      completionPercentage: 100,
    });
    await expect(listPlayerMatches(em, {
      playerId: players[0]!.id,
      mode: 'DOUBLES',
      leagueId: league.id,
    })).resolves.toHaveLength(1);
    await expect(listLeagueMatches(em, { leagueId: league.id, status: 'COMPLETED' })).resolves.toMatchObject({
      items: [expect.objectContaining({ status: 'COMPLETED' })],
      nextCursor: null,
    });
    await expect(listLeagues(em, { status: 'COMPLETED' })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: league.id })],
    });
    await expect(listPlayers(em, { search: 'visibility-0-' })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: players[0]!.id })],
    });
  });
});

test('usunięta liga znika z globalnych statystyk, ale gracz pozostaje poprawnym profilem', async () => {
  await withTestDb(async em => {
    const players = await makePlayers(em, 4);
    const league = await createLeague(em, {
      token: randomUUID(),
      data: classicDoubles(players.map(player => player.id), 'Usuwalna liga'),
    });
    const [match] = await em.getConnection().execute<Array<{ id: string }>>(
      'select id from matches where league_id = ?',
      [league.id],
    );
    await recordClassicResult(em, { id: match!.id, expectedVersion: 0, score });
    await deleteLeague(em, { id: league.id, expectedVersion: league.version });

    await expect(getPlayerStatistics(em, {
      playerId: players[0]!.id,
      mode: 'DOUBLES',
    })).resolves.toMatchObject({ played: 0, winPercentage: null });
    await expect(getPlayerStatistics(em, {
      playerId: players[0]!.id,
      mode: 'DOUBLES',
      leagueId: league.id,
    })).rejects.toMatchObject({ code: 'LEAGUE_NOT_FOUND' });
    await expect(getLeagueOverview(em, league.id)).rejects.toMatchObject({
      code: 'LEAGUE_NOT_FOUND',
    });
  });
});
