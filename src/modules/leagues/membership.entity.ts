import { defineEntity, p } from '@mikro-orm/postgresql';
import { PlayerSchema } from '@/modules/players/player.entity';
import { LeagueSchema } from './league.entity';

export const LeaguePlayerSchema = defineEntity({
  name: 'LeaguePlayer',
  tableName: 'league_players',
  properties: {
    league: p
      .manyToOne(LeagueSchema)
      .joinColumn('league_id')
      .primary()
      .foreignKeyName('league_players_league_id_foreign')
      .updateRule('cascade')
      .deleteRule('restrict'),
    player: p
      .manyToOne(PlayerSchema)
      .joinColumn('player_id')
      .primary()
      .foreignKeyName('league_players_player_id_foreign')
      .updateRule('cascade')
      .deleteRule('restrict'),
    joinedAt: p.datetime().columnType('timestamptz').defaultRaw('current_timestamp'),
  },
});

export class LeaguePlayer extends LeaguePlayerSchema.class {}

LeaguePlayerSchema.setClass(LeaguePlayer);
