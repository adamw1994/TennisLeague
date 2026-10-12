import { Migration } from '@mikro-orm/migrations';

export class Migration003Players extends Migration {
  override name = 'Migration003Players';

  override up(): void {
    this.addSql(`
      create function "normalize_nickname"(value text)
      returns text language sql immutable strict parallel safe
      as $$
        select lower(btrim(
          value,
          chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
          chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
          chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
          chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
          chr(8239) || chr(8287) || chr(12288) || chr(65279)
        ));
      $$;
    `);
    this.addSql(`
      create table "players" (
        "id" uuid not null,
        "first_name" text not null,
        "last_name" text not null,
        "nickname" text not null,
        "nickname_key" text generated always as (normalize_nickname("nickname")) stored,
        "version" integer not null default 1,
        "created_at" timestamptz not null default current_timestamp,
        "updated_at" timestamptz not null default current_timestamp,
        "deleted_at" timestamptz null,
        constraint "players_pkey" primary key ("id"),
        constraint "players_nickname_key_unique" unique ("nickname_key"),
        constraint "players_version_check" check ("version" > 0)
      );
    `);
    this.addSql(
      'create index "players_active_nickname_index" on "players" ("nickname_key") where deleted_at is null;',
    );
    this.addSql(
      'create index "players_active_name_index" on "players" ("last_name", "first_name", "id") where deleted_at is null;',
    );
    this.addSql(`
      create table "player_avatars" (
        "player_id" uuid not null,
        "bytes" bytea not null,
        "mime_type" text not null,
        "updated_at" timestamptz not null default current_timestamp,
        constraint "player_avatars_pkey" primary key ("player_id"),
        constraint "player_avatars_player_id_foreign" foreign key ("player_id")
          references "players" ("id") on update cascade on delete cascade
      );
    `);
  }

  override down(): void {
    this.addSql('drop table if exists "player_avatars";');
    this.addSql('drop table if exists "players";');
    this.addSql('drop function if exists "normalize_nickname"(text);');
  }
}
