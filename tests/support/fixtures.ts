import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { createLeague } from '@/modules/leagues/commands';
import { createPlayer } from '@/modules/players/commands';
import type { Mode } from '@/shared/contracts';

export interface AcceptanceSeed {
  classicLeagueId: string;
  classicDoublesLeagueId: string;
  eloLeagueId: string;
  eloDoublesLeagueId: string;
  classicPlayerIds: string[];
  doublesPlayerIds: string[];
}

export function uniqueFixtureName(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export async function makeEloLeague(
  em: EntityManager,
  mode: Mode = 'SINGLES',
  count = mode === 'SINGLES' ? 2 : 4,
): Promise<{ leagueId: string; playerIds: string[] }> {
  const suffix = randomUUID().slice(0, 8);
  const playerIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const player = await createPlayer(em, {
      token: randomUUID(),
      data: {
        firstName: `Elo${index}`,
        lastName: 'Fixture',
        nickname: `elo-${index}-${suffix}`,
      },
    });
    playerIds.push(player.id);
  }
  const league = await createLeague(em, {
    token: randomUUID(),
    data: {
      name: `Elo ${suffix}`,
      kind: 'ELO_INFINITE',
      mode,
      playerIds,
      teams: [],
      hasReturnLegs: null,
      eloK: 32,
    },
  });
  return { leagueId: league.id, playerIds };
}

/** Stable data for the browser acceptance pass. */
export async function seedAcceptance(em: EntityManager): Promise<AcceptanceSeed> {
  const createSeedPlayers = async (prefix: string, count = 4): Promise<string[]> => {
    const ids: string[] = [];
    for (let index = 1; index <= count; index += 1) {
      const player = await createPlayer(em, {
        token: randomUUID(),
        data: {
          firstName: `Akceptacja ${prefix} ${index}`,
          lastName: 'MVP',
          nickname: `Acceptance ${prefix} ${index}`,
        },
      });
      ids.push(player.id);
    }
    return ids;
  };

  const classicPlayerIds = await createSeedPlayers('Classic');
  const doublesPlayerIds = await createSeedPlayers('Doubles', 6);
  const classic = await createLeague(em, {
    token: randomUUID(),
    data: {
      name: 'Acceptance Classic Singles',
      kind: 'CLASSIC',
      mode: 'SINGLES',
      playerIds: classicPlayerIds,
      teams: [],
      hasReturnLegs: false,
      eloK: null,
    },
  });
  const classicDoubles = await createLeague(em, {
    token: randomUUID(),
    data: {
      name: 'Acceptance Classic Doubles',
      kind: 'CLASSIC',
      mode: 'DOUBLES',
      playerIds: doublesPlayerIds,
      teams: [
        [doublesPlayerIds[0]!, doublesPlayerIds[1]!],
        [doublesPlayerIds[2]!, doublesPlayerIds[3]!],
        [doublesPlayerIds[4]!, doublesPlayerIds[5]!],
      ],
      hasReturnLegs: false,
      eloK: null,
    },
  });
  const elo = await createLeague(em, {
    token: randomUUID(),
    data: {
      name: 'Acceptance Elo Singles',
      kind: 'ELO_INFINITE',
      mode: 'SINGLES',
      playerIds: classicPlayerIds,
      teams: [],
      hasReturnLegs: null,
      eloK: 32,
    },
  });
  const eloDoubles = await createLeague(em, {
    token: randomUUID(),
    data: {
      name: 'Acceptance Elo Doubles',
      kind: 'ELO_INFINITE',
      mode: 'DOUBLES',
      playerIds: doublesPlayerIds.slice(0, 4),
      teams: [],
      hasReturnLegs: null,
      eloK: 32,
    },
  });

  return {
    classicLeagueId: classic.id,
    classicDoublesLeagueId: classicDoubles.id,
    eloLeagueId: elo.id,
    eloDoublesLeagueId: eloDoubles.id,
    classicPlayerIds,
    doublesPlayerIds,
  };
}
