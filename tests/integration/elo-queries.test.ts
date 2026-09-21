import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { getEloRanking, getEloStatus } from '@/modules/elo/queries';
import { joinEloLeague } from '@/modules/leagues/commands';
import { correctEloMatch, createEloMatch } from '@/modules/matches/commands';
import { getMatch } from '@/modules/matches/queries';
import { createPlayer, deletePlayer } from '@/modules/players/commands';
import type { TennisScore } from '@/modules/tennis/types';
import { withTestDb } from '../support/database';
import { makeEloLeague } from '../support/fixtures';

const score: TennisScore = {
  openingSetFormat: 'FAST4',
  decidingSetFormat: null,
  sets: [
    { order: 1, kind: 'GAME_SET', sideA: 4, sideB: 1 },
    { order: 2, kind: 'GAME_SET', sideA: 4, sideB: 2 },
  ],
};

test('zmiana składu oznacza poprzednie Elo jako nieaktualne', async () => {
  await withTestDb(async em => {
    const { leagueId, playerIds: [a, b, c] } = await makeEloLeague(em, 'SINGLES', 3);
    const match = await createEloMatch(em, {
      token: randomUUID(),
      data: { leagueId, sides: [[a!], [b!]], score },
    });
    await correctEloMatch(em, {
      id: match.id,
      expectedVersion: match.version,
      leagueId,
      sides: [[a!], [c!]],
      score,
    });

    const dto = await getMatch(em, leagueId, match.id);
    expect(dto).toMatchObject({
      calculationStatus: 'STALE',
      calculationMatchVersion: match.version,
    });
    expect(dto.eloEvents).toHaveLength(2);
    expect(dto.eloEvents.every(event => event.matchVersion === match.version)).toBe(true);
    await expect(getEloStatus(em, leagueId)).resolves.toMatchObject({
      inputRevision: '2',
      publishedRevision: '1',
      state: 'RECALCULATING',
    });
  });
});

test('ranking jest kompletnym snapshotem publikacji i zachowuje usuniętego gracza', async () => {
  await withTestDb(async em => {
    const { leagueId, playerIds } = await makeEloLeague(em, 'SINGLES', 3);
    const deleted = playerIds[2]!;
    await deletePlayer(em, { id: deleted, expectedVersion: 1 });
    const ranking = await getEloRanking(em, leagueId);
    expect(ranking.rows).toHaveLength(3);
    expect(ranking.rows.find(row => row.playerId === deleted)).toMatchObject({
      rating: 1000,
      played: 0,
      deleted: true,
      place: 1,
    });
  });
});

test('nowy członek jest widoczny w formularzu, a do rankingu trafia po publikacji', async () => {
  await withTestDb(async em => {
    const { leagueId } = await makeEloLeague(em, 'SINGLES', 2);
    const player = await createPlayer(em, {
      token: randomUUID(),
      data: { firstName: 'Nowy', lastName: 'Elo', nickname: `nowy-${randomUUID().slice(0, 8)}` },
    });
    await joinEloLeague(em, {
      token: randomUUID(),
      data: { leagueId, playerId: player.id },
    });
    const ranking = await getEloRanking(em, leagueId);
    expect(ranking.rows.find(row => row.playerId === player.id)).toMatchObject({
      rating: 1000,
      played: 0,
    });
  });
});
