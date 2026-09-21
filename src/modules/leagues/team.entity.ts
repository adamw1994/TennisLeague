import { defineEntity, p } from '@mikro-orm/postgresql';
import { LeaguePlayerSchema } from './membership.entity';
import { LeagueSchema } from './league.entity';

export const LeagueTeamSchema = defineEntity({
  name: 'LeagueTeam',
  tableName: 'league_teams',
  properties: {
    id: p.uuid().primary(),
    league: p
      .manyToOne(LeagueSchema)
      .joinColumn('league_id')
      .foreignKeyName('league_teams_league_id_foreign')
      .updateRule('cascade')
      .deleteRule('restrict'),
    displayName: p.text(),
  },
  uniques: [
    {
      name: 'league_teams_id_league_id_unique',
      properties: ['id', 'league'],
    },
  ],
});

export class LeagueTeam extends LeagueTeamSchema.class {}

LeagueTeamSchema.setClass(LeagueTeam);

export const LeagueTeamPlayerSchema = defineEntity({
  name: 'LeagueTeamPlayer',
  tableName: 'league_team_players',
  properties: {
    team: p
      .manyToOne(LeagueTeamSchema)
      .joinColumns('team_id', 'league_id')
      .referencedColumnNames('id', 'league_id')
      .columnTypes('uuid', 'uuid')
      .ownColumns('team_id', 'league_id')
      .primary()
      .foreignKeyName('league_team_players_team_foreign')
      .updateRule('cascade')
      .deleteRule('restrict'),
    membership: p
      .manyToOne(LeaguePlayerSchema)
      .joinColumns('league_id', 'player_id')
      .referencedColumnNames('league_id', 'player_id')
      .ownColumns('player_id')
      .primary()
      .foreignKeyName('league_team_players_membership_foreign')
      .updateRule('cascade')
      .deleteRule('restrict'),
    position: p.integer(),
  },
  checks: [
    {
      name: 'league_team_players_position_check',
      expression: '"position" in (1, 2)',
    },
  ],
  uniques: [
    {
      name: 'league_team_players_team_id_position_unique',
      properties: ['team', 'position'],
    },
    {
      name: 'league_team_players_league_id_player_id_unique',
      properties: ['membership'],
    },
  ],
});

export class LeagueTeamPlayer extends LeagueTeamPlayerSchema.class {}

LeagueTeamPlayerSchema.setClass(LeagueTeamPlayer);
