import { Migration } from '@mikro-orm/migrations';

export class Migration004LeaguesMatches extends Migration {
  override name = 'Migration004LeaguesMatches';

  override up(): void {
    this.addSql(`
      create table "leagues" (
        "id" uuid not null,
        "sport_id" uuid not null,
        "kind" text not null,
        "game_mode" text not null,
        "name" text not null,
        "has_return_legs" boolean null,
        "elo_k" integer null,
        "status" text not null default 'ACTIVE',
        "version" integer not null default 1,
        "created_at" timestamptz not null default current_timestamp,
        "updated_at" timestamptz not null default current_timestamp,
        "deleted_at" timestamptz null,
        constraint "leagues_pkey" primary key ("id"),
        constraint "leagues_sport_id_foreign" foreign key ("sport_id")
          references "sports" ("id") on update cascade on delete restrict,
        constraint "leagues_kind_check" check ("kind" in ('CLASSIC', 'ELO_INFINITE')),
        constraint "leagues_game_mode_check" check ("game_mode" in ('SINGLES', 'DOUBLES')),
        constraint "leagues_status_check" check ("status" in ('ACTIVE', 'COMPLETED')),
        constraint "leagues_name_check" check (char_length(name) between 1 and 120),
        constraint "leagues_version_check" check ("version" > 0),
        constraint "leagues_configuration_check" check (
          (kind = 'CLASSIC' and has_return_legs is not null and elo_k is null)
          or
          (kind = 'ELO_INFINITE' and has_return_legs is null and elo_k between 10 and 60)
        )
      );
    `);
    this.addSql(`
      create index "leagues_active_kind_status_index"
        on "leagues" ("kind", "status", "created_at", "id")
        where deleted_at is null;
    `);

    this.addSql(`
      create table "league_players" (
        "league_id" uuid not null,
        "player_id" uuid not null,
        "joined_at" timestamptz not null default current_timestamp,
        constraint "league_players_pkey" primary key ("league_id", "player_id"),
        constraint "league_players_league_id_foreign" foreign key ("league_id")
          references "leagues" ("id") on update cascade on delete restrict,
        constraint "league_players_player_id_foreign" foreign key ("player_id")
          references "players" ("id") on update cascade on delete restrict
      );
    `);

    this.addSql(`
      create table "league_teams" (
        "id" uuid not null,
        "league_id" uuid not null,
        "display_name" text not null,
        constraint "league_teams_pkey" primary key ("id"),
        constraint "league_teams_id_league_id_unique" unique ("id", "league_id"),
        constraint "league_teams_league_id_foreign" foreign key ("league_id")
          references "leagues" ("id") on update cascade on delete restrict
      );
    `);

    this.addSql(`
      create table "league_team_players" (
        "team_id" uuid not null,
        "league_id" uuid not null,
        "player_id" uuid not null,
        "position" integer not null,
        constraint "league_team_players_pkey" primary key ("team_id", "league_id", "player_id"),
        constraint "league_team_players_team_id_position_unique" unique ("team_id", "league_id", "position"),
        constraint "league_team_players_league_id_player_id_unique" unique ("league_id", "player_id"),
        constraint "league_team_players_team_foreign" foreign key ("team_id", "league_id")
          references "league_teams" ("id", "league_id") on update cascade on delete restrict,
        constraint "league_team_players_membership_foreign" foreign key ("league_id", "player_id")
          references "league_players" ("league_id", "player_id") on update cascade on delete restrict,
        constraint "league_team_players_position_check" check ("position" in (1, 2))
      );
    `);

    this.addSql(`
      create table "matches" (
        "id" uuid not null,
        "league_id" uuid not null,
        "status" text not null default 'PENDING',
        "round_number" integer null,
        "leg_number" integer null,
        "fixture_key" text null,
        "elo_k_snapshot" integer null,
        "result_version" integer not null default 0,
        "result_recorded_at" timestamptz null,
        "created_at" timestamptz not null default current_timestamp,
        "updated_at" timestamptz not null default current_timestamp,
        "deleted_at" timestamptz null,
        constraint "matches_pkey" primary key ("id"),
        constraint "matches_id_league_id_unique" unique ("id", "league_id"),
        constraint "matches_league_id_fixture_key_unique" unique ("league_id", "fixture_key"),
        constraint "matches_league_id_foreign" foreign key ("league_id")
          references "leagues" ("id") on update cascade on delete restrict,
        constraint "matches_status_check" check ("status" in ('PENDING', 'COMPLETED')),
        constraint "matches_result_version_check" check ("result_version" >= 0),
        constraint "matches_round_number_check" check ("round_number" is null or "round_number" > 0),
        constraint "matches_leg_number_check" check ("leg_number" is null or "leg_number" in (1, 2)),
        constraint "matches_result_state_check" check (
          ("status" = 'PENDING' and "result_recorded_at" is null and "result_version" = 0)
          or
          ("status" = 'COMPLETED' and "result_recorded_at" is not null and "result_version" > 0)
        )
      );
    `);
    this.addSql(`
      create index "matches_league_status_round_index"
        on "matches" ("league_id", "status", "round_number", "leg_number", "id")
        where deleted_at is null;
    `);

    this.addSql(`
      create table "match_sides" (
        "id" uuid not null,
        "match_id" uuid not null,
        "league_id" uuid not null,
        "side_number" integer not null,
        "team_id" uuid null,
        constraint "match_sides_pkey" primary key ("id"),
        constraint "match_sides_id_match_id_league_id_unique" unique ("id", "match_id", "league_id"),
        constraint "match_sides_match_id_side_number_unique" unique ("match_id", "league_id", "side_number"),
        constraint "match_sides_match_foreign" foreign key ("match_id", "league_id")
          references "matches" ("id", "league_id") on update cascade on delete restrict,
        constraint "match_sides_team_foreign" foreign key ("team_id", "league_id")
          references "league_teams" ("id", "league_id") on update cascade on delete restrict,
        constraint "match_sides_side_number_check" check ("side_number" in (1, 2))
      );
    `);

    this.addSql(`
      create table "match_side_players" (
        "side_id" uuid not null,
        "match_id" uuid not null,
        "league_id" uuid not null,
        "player_id" uuid not null,
        "position" integer not null,
        constraint "match_side_players_pkey" primary key ("side_id", "match_id", "league_id", "player_id"),
        constraint "match_side_players_side_id_position_unique" unique ("side_id", "match_id", "league_id", "position"),
        constraint "match_side_players_match_id_player_id_unique" unique ("match_id", "league_id", "player_id"),
        constraint "match_side_players_side_foreign" foreign key ("side_id", "match_id", "league_id")
          references "match_sides" ("id", "match_id", "league_id") on update cascade on delete restrict,
        constraint "match_side_players_membership_foreign" foreign key ("league_id", "player_id")
          references "league_players" ("league_id", "player_id") on update cascade on delete restrict,
        constraint "match_side_players_position_check" check ("position" in (1, 2))
      );
    `);
    this.addSql(`
      create index "match_side_players_player_id_match_id_index"
        on "match_side_players" ("league_id", "player_id", "match_id");
    `);
  }

  override down(): void {
    this.addSql('drop table if exists "match_side_players";');
    this.addSql('drop table if exists "match_sides";');
    this.addSql('drop table if exists "matches";');
    this.addSql('drop table if exists "league_team_players";');
    this.addSql('drop table if exists "league_teams";');
    this.addSql('drop table if exists "league_players";');
    this.addSql('drop table if exists "leagues";');
  }
}
