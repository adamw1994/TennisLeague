import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { createLeague, deleteLeague } from '@/modules/leagues/commands';
import { deleteEloMatch, correctEloMatch, createEloMatch } from '@/modules/matches/commands';
import { createPlayer, deletePlayer } from '@/modules/players/commands';
import {
  restoreLeague,
  restoreMatch,
  restoreMatchRevision,
  restorePlayer,
} from '@/modules/recovery/commands';
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

const correctedScore: TennisScore = {
  openingSetFormat: 'FAST4',
  decidingSetFormat: null,
  sets: [
    { order: 1, kind: 'GAME_SET', sideA: 4, sideB: 2 },
    { order: 2, kind: 'GAME_SET', sideA: 4, sideB: 3 },
  ],
};

test('odzyskanie usuniętego meczu Elo tworzy nową wersję i zleca replay', async () => {
  await withTestDb(async em => {
    const { leagueId, playerIds: [a, b] } = await makeEloLeague(em);
    const match = await createEloMatch(em, {
      token: randomUUID(),
      data: { leagueId, sides: [[a!], [b!]], score },
    });
    const removed = await deleteEloMatch(em, {
      id: match.id,
      leagueId,
      expectedVersion: match.version,
    });

    const restored = await restoreMatch(em, {
      id: match.id,
      expectedVersion: removed.version,
    });
    const repeated = await restoreMatch(em, {
      id: match.id,
      expectedVersion: removed.version,
    });
    const [stored] = await em.getConnection().execute<Array<{
      deleted_at: Date | null;
      result_version: number;
    }>>('select deleted_at, result_version from matches where id = ?', [match.id]);
    const [league] = await em.getConnection().execute<Array<{
      input_revision: string;
      elo_state: string;
    }>>('select input_revision, elo_state from leagues where id = ?', [leagueId]);
    const [job] = await em.getConnection().execute<Array<{
      status: string;
      requested_revision: string;
    }>>('select status, requested_revision from elo_recalculation_jobs where league_id = ?', [leagueId]);

    expect(restored).toEqual({ id: match.id, version: removed.version + 1 });
    expect(repeated).toEqual(restored);
    expect(stored).toMatchObject({ deleted_at: null, result_version: restored.version });
    expect(league).toMatchObject({ input_revision: '3', elo_state: 'RECALCULATING' });
    expect(job).toMatchObject({ status: 'PENDING', requested_revision: '3' });
  });
});

test('odzyskanie według starej MatchRevision przywraca historyczny wynik', async () => {
  await withTestDb(async em => {
    const { leagueId, playerIds: [a, b] } = await makeEloLeague(em);
    const match = await createEloMatch(em, {
      token: randomUUID(),
      data: { leagueId, sides: [[a!], [b!]], score },
    });
    const corrected = await correctEloMatch(em, {
      id: match.id,
      leagueId,
      expectedVersion: match.version,
      sides: [[a!], [b!]],
      score: correctedScore,
    });
    const removed = await deleteEloMatch(em, {
      id: match.id,
      leagueId,
      expectedVersion: corrected.version,
    });
    const restored = await restoreMatchRevision(em, {
      id: match.id,
      expectedVersion: removed.version,
      sourceVersion: 1,
    });
    const [set] = await em.getConnection().execute<Array<{ side_1_score: number }>>(
      'select side_1_score from tennis_sets where match_id = ? and set_order = 1',
      [match.id],
    );
    const [revision] = await em.getConnection().execute<Array<{ version: number; snapshot: { score: TennisScore } }>>(
      'select version, snapshot from match_revisions where match_id = ? order by version desc limit 1',
      [match.id],
    );

    expect(restored.version).toBe(removed.version + 1);
    expect(set?.side_1_score).toBe(4);
    expect(revision?.version).toBe(restored.version);
    expect(revision?.snapshot.score).toEqual(score);
  });
});

test('restore ligi nie regeneruje terminarza, a restore gracza zachowuje nickname', async () => {
  await withTestDb(async em => {
    const players = await Promise.all(
      [0, 1].map(index => createPlayer(em, {
        token: randomUUID(),
        data: {
          firstName: `Classic ${index}`,
          lastName: 'Recovery',
          nickname: `classic-recovery-${index}-${randomUUID().slice(0, 6)}`,
        },
      })),
    );
    const league = await createLeague(em, {
      token: randomUUID(),
      data: {
        name: 'Recovery classic',
        kind: 'CLASSIC',
        mode: 'SINGLES',
        playerIds: players.map(player => player.id),
        teams: [],
        hasReturnLegs: false,
        eloK: null,
      },
    });
    const [before] = await em.getConnection().execute<Array<{ count: number }>>(
      'select count(*)::int as count from matches where league_id = ?', [league.id],
    );
    const removedLeague = await deleteLeague(em, { id: league.id, expectedVersion: league.version });
    const restoredLeague = await restoreLeague(em, { id: league.id, expectedVersion: removedLeague.version });
    const removedPlayer = await deletePlayer(em, { id: players[0]!.id, expectedVersion: 1 });
    const restoredPlayer = await restorePlayer(em, { id: players[0]!.id, expectedVersion: removedPlayer.version });
    const [after] = await em.getConnection().execute<Array<{ count: number }>>(
      'select count(*)::int as count from matches where league_id = ?', [league.id],
    );
    const [storedPlayer] = await em.getConnection().execute<Array<{ nickname: string; deleted_at: Date | null }>>(
      'select nickname, deleted_at from players where id = ?', [players[0]!.id],
    );

    expect(restoredLeague.version).toBe(removedLeague.version + 1);
    expect(after?.count).toBe(before?.count);
    expect(restoredPlayer.version).toBe(removedPlayer.version + 1);
    expect(storedPlayer).toMatchObject({ nickname: expect.stringContaining('classic-recovery-0-'), deleted_at: null });
  });
});
