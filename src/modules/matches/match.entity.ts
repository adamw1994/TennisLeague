import { defineEntity, p } from '@mikro-orm/postgresql';
import { LeagueSchema } from '@/modules/leagues/league.entity';
import { LeaguePlayerSchema } from '@/modules/leagues/membership.entity';
import { LeagueTeamSchema } from '@/modules/leagues/team.entity';

export const MatchSchema = defineEntity({
  name: 'Match',
  tableName: 'matches',
  properties: {
    id: p.uuid().primary(),
    league: p
      .manyToOne(LeagueSchema)
      .joinColumn('league_id')
      .foreignKeyName('matches_league_id_foreign')
      .updateRule('cascade')
      .deleteRule('restrict'),
    status: p.text().default('PENDING'),
    roundNumber: p.integer().nullable(),
    legNumber: p.integer().nullable(),
    fixtureKey: p.text().nullable(),
    eloKSnapshot: p.integer().fieldName('elo_k_snapshot').nullable(),
    resultVersion: p.integer().default(0),
    resultRecordedAt: p.datetime().columnType('timestamptz').nullable(),
    createdAt: p.datetime().columnType('timestamptz').defaultRaw('current_timestamp'),
    updatedAt: p.datetime().columnType('timestamptz').defaultRaw('current_timestamp'),
    deletedAt: p.datetime().columnType('timestamptz').nullable(),
  },
  checks: [
    {
      name: 'matches_status_check',
      expression: `"status" in ('PENDING', 'COMPLETED')`,
    },
    {
      name: 'matches_result_version_check',
      expression: '"result_version" >= 0',
    },
    {
      name: 'matches_round_number_check',
      expression: '"round_number" is null or "round_number" > 0',
    },
    {
      name: 'matches_leg_number_check',
      expression: '"leg_number" is null or "leg_number" in (1, 2)',
    },
    {
      name: 'matches_result_state_check',
      expression: `(
        ("status" = 'PENDING' and "result_recorded_at" is null and "result_version" = 0)
        or
        ("status" = 'COMPLETED' and "result_recorded_at" is not null and "result_version" > 0)
      )`,
    },
  ],
  uniques: [
    {
      name: 'matches_id_league_id_unique',
      properties: ['id', 'league'],
    },
    {
      name: 'matches_league_id_fixture_key_unique',
      properties: ['league', 'fixtureKey'],
    },
  ],
  indexes: [
    {
      name: 'matches_league_status_round_index',
      properties: ['league', 'status', 'roundNumber', 'legNumber', 'id'],
      where: 'deleted_at is null',
    },
  ],
});

export class Match extends MatchSchema.class {}

MatchSchema.setClass(Match);

export const MatchSideSchema = defineEntity({
  name: 'MatchSide',
  tableName: 'match_sides',
  properties: {
    id: p.uuid().primary(),
    match: p
      .manyToOne(MatchSchema)
      .joinColumns('match_id', 'league_id')
      .referencedColumnNames('id', 'league_id')
      .columnTypes('uuid', 'uuid')
      .ownColumns('match_id', 'league_id')
      .foreignKeyName('match_sides_match_foreign')
      .updateRule('cascade')
      .deleteRule('restrict'),
    sideNumber: p.integer(),
    team: p
      .manyToOne(LeagueTeamSchema)
      .joinColumns('team_id', 'league_id')
      .referencedColumnNames('id', 'league_id')
      .columnTypes('uuid', 'uuid')
      .ownColumns('team_id')
      .foreignKeyName('match_sides_team_foreign')
      .updateRule('cascade')
      .deleteRule('restrict')
      .nullable(),
  },
  checks: [
    {
      name: 'match_sides_side_number_check',
      expression: '"side_number" in (1, 2)',
    },
  ],
  uniques: [
    {
      name: 'match_sides_id_match_id_league_id_unique',
      properties: ['id', 'match'],
    },
    {
      name: 'match_sides_match_id_side_number_unique',
      properties: ['match', 'sideNumber'],
    },
  ],
});

export class MatchSide extends MatchSideSchema.class {}

MatchSideSchema.setClass(MatchSide);

export const MatchSidePlayerSchema = defineEntity({
  name: 'MatchSidePlayer',
  tableName: 'match_side_players',
  properties: {
    side: p
      .manyToOne(MatchSideSchema)
      .joinColumns('side_id', 'match_id', 'league_id')
      .referencedColumnNames('id', 'match_id', 'league_id')
      .columnTypes('uuid', 'uuid', 'uuid')
      .ownColumns('side_id', 'match_id', 'league_id')
      .primary()
      .foreignKeyName('match_side_players_side_foreign')
      .updateRule('cascade')
      .deleteRule('restrict'),
    membership: p
      .manyToOne(LeaguePlayerSchema)
      .joinColumns('league_id', 'player_id')
      .referencedColumnNames('league_id', 'player_id')
      .ownColumns('player_id')
      .primary()
      .foreignKeyName('match_side_players_membership_foreign')
      .updateRule('cascade')
      .deleteRule('restrict'),
    match: p
      .manyToOne(MatchSchema)
      .joinColumns('match_id', 'league_id')
      .referencedColumnNames('id', 'league_id')
      .columnTypes('uuid', 'uuid')
      .ownColumns()
      .createForeignKeyConstraint(false),
    position: p.integer(),
  },
  checks: [
    {
      name: 'match_side_players_position_check',
      expression: '"position" in (1, 2)',
    },
  ],
  uniques: [
    {
      name: 'match_side_players_side_id_position_unique',
      properties: ['side', 'position'],
    },
    {
      name: 'match_side_players_match_id_player_id_unique',
      properties: ['match', 'membership'],
    },
  ],
  indexes: [
    {
      name: 'match_side_players_player_id_match_id_index',
      properties: ['membership', 'match'],
    },
  ],
});

export class MatchSidePlayer extends MatchSidePlayerSchema.class {}

MatchSidePlayerSchema.setClass(MatchSidePlayer);
