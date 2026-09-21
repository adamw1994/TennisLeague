import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import type {
  Creation,
  Id,
  LeagueKind,
  Mode,
  Versioned,
} from '@/shared/contracts';
import { DomainError } from '@/shared/errors';
import { once } from '@/shared/idempotency';
import {
  assertVersion,
  CreationSchema,
  inMutationTransaction,
  VersionedSchema,
} from '@/shared/mutation';
import { getVisibleLeagueForUpdate } from './queries';
import { generateSchedule } from './schedule';
import {
  addEloLeagueMember,
  initializeEloLeague,
} from '@/modules/elo/append';

const MAX_FIXTURES = 5_000;

const LeagueInputSchema = z
  .strictObject({
    name: z
      .string({ error: 'Podaj nazwę ligi.' })
      .trim()
      .min(1, 'Podaj nazwę ligi.')
      .max(120, 'Nazwa ligi może mieć maksymalnie 120 znaków.'),
    kind: z.enum(['CLASSIC', 'ELO_INFINITE']),
    mode: z.enum(['SINGLES', 'DOUBLES']),
    playerIds: z.array(z.uuid()).min(2, 'Wybierz co najmniej dwóch graczy.'),
    teams: z.array(z.tuple([z.uuid(), z.uuid()])),
    hasReturnLegs: z.boolean().nullable(),
    eloK: z.int().min(10).max(60).nullable(),
  })
  .superRefine((input, context) => {
    const uniquePlayers = new Set(input.playerIds);
    if (uniquePlayers.size !== input.playerIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['playerIds'],
        message: 'Każdy gracz może zostać wybrany tylko raz.',
      });
    }

    if (input.kind === 'CLASSIC') {
      if (input.hasReturnLegs === null || input.eloK !== null) {
        context.addIssue({
          code: 'custom',
          path: ['hasReturnLegs'],
          message: 'Wybierz, czy liga klasyczna ma rewanże.',
        });
      }
    } else if (input.hasReturnLegs !== null || input.eloK === null) {
      context.addIssue({
        code: 'custom',
        path: ['eloK'],
        message: 'Liga Elo wymaga współczynnika K od 10 do 60.',
      });
    }

    if (input.mode === 'SINGLES' && input.teams.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['teams'],
        message: 'Liga singlowa nie może zawierać par.',
      });
    }

    if (input.kind === 'ELO_INFINITE' && input.teams.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['teams'],
        message: 'W lidze Elo pary są dobierane osobno do każdego meczu.',
      });
    }

    if (input.mode === 'DOUBLES' && input.playerIds.length < 4) {
      context.addIssue({
        code: 'custom',
        path: ['playerIds'],
        message: 'Liga deblowa wymaga co najmniej czterech graczy.',
      });
    }

    if (input.kind === 'CLASSIC' && input.mode === 'DOUBLES') {
      if (input.teams.length < 2) {
        context.addIssue({
          code: 'custom',
          path: ['teams'],
          message: 'Liga klasyczna deblowa wymaga co najmniej dwóch pełnych par.',
        });
      }
      const teamPlayers = input.teams.flat();
      const uniqueTeamPlayers = new Set(teamPlayers);
      const containsInvalidTeam = input.teams.some(([first, second]) => first === second);
      const hasSameMembers =
        teamPlayers.length === input.playerIds.length &&
        uniqueTeamPlayers.size === uniquePlayers.size &&
        [...uniquePlayers].every(id => uniqueTeamPlayers.has(id));
      if (containsInvalidTeam || uniqueTeamPlayers.size !== teamPlayers.length || !hasSameMembers) {
        context.addIssue({
          code: 'custom',
          path: ['teams'],
          message: 'Każdy wybrany gracz musi należeć do dokładnie jednej pełnej pary.',
        });
      }
    }
  });

export type LeagueInput = z.infer<typeof LeagueInputSchema>;

const UpdateLeagueSchema = z.strictObject({
  id: z.uuid(),
  expectedVersion: z.int().positive(),
  name: z
    .string({ error: 'Podaj nazwę ligi.' })
    .trim()
    .min(1, 'Podaj nazwę ligi.')
    .max(120, 'Nazwa ligi może mieć maksymalnie 120 znaków.'),
  eloK: z.int().min(10).max(60).optional(),
});

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fields = Object.fromEntries(
      result.error.issues
        .filter(issue => issue.path.length > 0)
        .map(issue => [String(issue.path[0]), issue.message]),
    );
    throw new DomainError('VALIDATION', fields);
  }
  return result.data;
}

function normalizeInput(input: LeagueInput): LeagueInput {
  const playerIds = [...input.playerIds].sort();
  const teams = input.teams
    .map(([first, second]) => [first, second].sort() as [Id, Id])
    .sort((left, right) => left.join(':').localeCompare(right.join(':')));
  return { ...input, playerIds, teams };
}

function fixtureCount(sideCount: number, returnLegs: boolean): number {
  return (sideCount * (sideCount - 1) * (returnLegs ? 2 : 1)) / 2;
}

interface LockedPlayer {
  id: string;
  nickname: string;
}

async function lockActivePlayers(
  em: EntityManager,
  playerIds: string[],
): Promise<Map<string, LockedPlayer>> {
  const rows = await em.getConnection().execute<LockedPlayer[]>(
    `select id, nickname
       from players
      where id in (
        select value::uuid from jsonb_array_elements_text(?::jsonb)
      ) and deleted_at is null
      order by id
      for share`,
    [JSON.stringify(playerIds)],
    'all',
    em.getTransactionContext(),
  );
  if (rows.length !== playerIds.length) {
    throw new DomainError('PLAYER_NOT_FOUND', {
      playerIds: 'Co najmniej jeden wybrany gracz nie istnieje lub został usunięty.',
    });
  }
  return new Map(rows.map(row => [row.id, row]));
}

interface PreparedTeam {
  id: string;
  displayName: string;
  players: [string, string];
}

interface PreparedMatch {
  id: string;
  fixtureKey: string;
  roundNumber: number;
  legNumber: number;
}

interface PreparedSide {
  id: string;
  matchId: string;
  sideNumber: 1 | 2;
  teamId: string | null;
  players: string[];
}

async function insertClassicSchedule(
  em: EntityManager,
  leagueId: string,
  input: LeagueInput,
  teams: PreparedTeam[],
): Promise<void> {
  const sidePlayers = new Map<string, string[]>();
  if (input.mode === 'SINGLES') {
    for (const playerId of input.playerIds) sidePlayers.set(playerId, [playerId]);
  } else {
    for (const team of teams) sidePlayers.set(team.id, team.players);
  }
  const fixtures = generateSchedule(
    [...sidePlayers.keys()],
    input.hasReturnLegs === true,
  );
  const matches: PreparedMatch[] = [];
  const sides: PreparedSide[] = [];

  for (const fixture of fixtures) {
    const matchId = randomUUID();
    matches.push({
      id: matchId,
      fixtureKey: fixture.key,
      roundNumber: fixture.round,
      legNumber: fixture.leg,
    });
    for (const [sideNumber, sideKey] of [fixture.sideA, fixture.sideB].entries()) {
      sides.push({
        id: randomUUID(),
        matchId,
        sideNumber: (sideNumber + 1) as 1 | 2,
        teamId: input.mode === 'DOUBLES' ? sideKey : null,
        players: sidePlayers.get(sideKey) ?? [],
      });
    }
  }

  const connection = em.getConnection();
  const transaction = em.getTransactionContext();
  await connection.execute(
    `insert into matches
       (id, league_id, fixture_key, round_number, leg_number)
     select x.id, ?, x."fixtureKey", x."roundNumber", x."legNumber"
       from jsonb_to_recordset(?::jsonb)
         as x(id uuid, "fixtureKey" text, "roundNumber" integer, "legNumber" integer)`,
    [leagueId, JSON.stringify(matches)],
    'all',
    transaction,
  );
  await connection.execute(
    `insert into match_sides
       (id, match_id, league_id, side_number, team_id)
     select x.id, x."matchId", ?, x."sideNumber", x."teamId"
       from jsonb_to_recordset(?::jsonb)
         as x(id uuid, "matchId" uuid, "sideNumber" integer, "teamId" uuid)`,
    [leagueId, JSON.stringify(sides)],
    'all',
    transaction,
  );
  const participants = sides.flatMap(side =>
    side.players.map((playerId, index) => ({
      sideId: side.id,
      matchId: side.matchId,
      playerId,
      position: index + 1,
    })),
  );
  await connection.execute(
    `insert into match_side_players
       (side_id, match_id, league_id, player_id, position)
     select x."sideId", x."matchId", ?, x."playerId", x.position
       from jsonb_to_recordset(?::jsonb)
         as x("sideId" uuid, "matchId" uuid, "playerId" uuid, position integer)`,
    [leagueId, JSON.stringify(participants)],
    'all',
    transaction,
  );
}

export async function createLeague(
  em: EntityManager,
  command: Creation<LeagueInput>,
): Promise<{ id: Id; version: number }> {
  const parsed = parse(CreationSchema(LeagueInputSchema), command);
  const input = normalizeInput(parsed.data);
  const sideCount =
    input.kind === 'CLASSIC' && input.mode === 'DOUBLES'
      ? input.teams.length
      : input.playerIds.length;
  if (
    input.kind === 'CLASSIC' &&
    fixtureCount(sideCount, input.hasReturnLegs === true) > MAX_FIXTURES
  ) {
    throw new DomainError('VALIDATION', {
      playerIds: `Terminarz może zawierać maksymalnie ${MAX_FIXTURES} meczów.`,
    });
  }

  return inMutationTransaction(em, tx =>
    once(tx, 'CREATE_LEAGUE', parsed.token, input, async () => {
      const players = await lockActivePlayers(tx, input.playerIds);
      const leagueId = randomUUID();
      const [created] = await tx.getConnection().execute<
        { id: string; version: number }[]
      >(
        `insert into leagues
           (id, sport_id, kind, game_mode, name, has_return_legs, elo_k, elo_state)
         select ?, id, ?, ?, ?, ?, ?, ?
           from sports where code = 'TENNIS'
         returning id, version`,
        [
          leagueId,
          input.kind,
          input.mode,
          input.name,
          input.hasReturnLegs,
          input.eloK,
          input.kind === 'ELO_INFINITE' ? 'CURRENT' : null,
        ],
        'all',
        tx.getTransactionContext(),
      );
      if (!created) throw new Error('league insert returned no row');

      await tx.getConnection().execute(
        `insert into league_players (league_id, player_id)
         select ?, value::uuid from jsonb_array_elements_text(?::jsonb)`,
        [leagueId, JSON.stringify(input.playerIds)],
        'all',
        tx.getTransactionContext(),
      );

      const teams: PreparedTeam[] = input.teams.map(([first, second]) => ({
        id: randomUUID(),
        displayName: `${players.get(first)?.nickname} / ${players.get(second)?.nickname}`,
        players: [first, second],
      }));
      if (teams.length > 0) {
        await tx.getConnection().execute(
          `insert into league_teams (id, league_id, display_name)
           select x.id, ?, x."displayName"
             from jsonb_to_recordset(?::jsonb)
               as x(id uuid, "displayName" text)`,
          [leagueId, JSON.stringify(teams)],
          'all',
          tx.getTransactionContext(),
        );
        const teamPlayers = teams.flatMap(team =>
          team.players.map((playerId, index) => ({
            teamId: team.id,
            playerId,
            position: index + 1,
          })),
        );
        await tx.getConnection().execute(
          `insert into league_team_players
             (team_id, league_id, player_id, position)
           select x."teamId", ?, x."playerId", x.position
             from jsonb_to_recordset(?::jsonb)
               as x("teamId" uuid, "playerId" uuid, position integer)`,
          [leagueId, JSON.stringify(teamPlayers)],
          'all',
          tx.getTransactionContext(),
        );
      }

      if (input.kind === 'CLASSIC') {
        await insertClassicSchedule(tx, leagueId, input, teams);
      } else {
        await initializeEloLeague(tx, leagueId, input.playerIds);
      }
      return created;
    }),
  );
}

export async function updateLeague(
  em: EntityManager,
  command: Versioned & { name: string; eloK?: number },
): Promise<{ id: Id; version: number }> {
  const parsed = parse(UpdateLeagueSchema, command);
  return inMutationTransaction(em, async tx => {
    const current = await getVisibleLeagueForUpdate(tx, parsed.id);
    assertVersion(current.version, parsed.expectedVersion);
    if (current.kind === 'CLASSIC' && parsed.eloK !== undefined) {
      throw new DomainError('STRUCTURAL_LEAGUE_CHANGE_FORBIDDEN');
    }
    const eloK =
      current.kind === 'ELO_INFINITE' ? (parsed.eloK ?? current.eloK) : null;
    const [updated] = await tx.getConnection().execute<
      { id: string; version: number }[]
    >(
      `update leagues
          set name = ?, elo_k = ?, version = version + 1,
              updated_at = clock_timestamp()
        where id = ? and deleted_at is null
        returning id, version`,
      [parsed.name, eloK, parsed.id],
      'all',
      tx.getTransactionContext(),
    );
    if (!updated) throw new DomainError('LEAGUE_NOT_FOUND');
    return updated;
  });
}

export async function deleteLeague(
  em: EntityManager,
  command: Versioned,
): Promise<{ id: Id; version: number }> {
  const parsed = parse(VersionedSchema, command);
  return inMutationTransaction(em, async tx => {
    const rows = await tx.getConnection().execute<
      { version: number; deleted_at: Date | null }[]
    >(
      'select version, deleted_at from leagues where id = ? for update',
      [parsed.id],
      'all',
      tx.getTransactionContext(),
    );
    const current = rows[0];
    if (!current) throw new DomainError('LEAGUE_NOT_FOUND');
    if (current.deleted_at) return { id: parsed.id, version: current.version };
    assertVersion(current.version, parsed.expectedVersion);
    const [removed] = await tx.getConnection().execute<
      { id: string; version: number }[]
    >(
      `update leagues
          set deleted_at = clock_timestamp(), updated_at = clock_timestamp(),
              version = version + 1
        where id = ?
        returning id, version`,
      [parsed.id],
      'all',
      tx.getTransactionContext(),
    );
    if (!removed) throw new Error('league delete returned no row');
    return removed;
  });
}

export type { LeagueKind, Mode };
export { addEloLeagueMember as joinEloLeague };
