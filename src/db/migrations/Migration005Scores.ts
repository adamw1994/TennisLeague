import { Migration } from '@mikro-orm/migrations';

export class Migration005Scores extends Migration {
  override name = 'Migration005Scores';

  override up(): void {
    this.addSql(`
      create table "tennis_match_rules" (
        "match_id" uuid not null,
        "opening_set_format" text not null,
        "deciding_set_format" text null,
        constraint "tennis_match_rules_pkey" primary key ("match_id"),
        constraint "tennis_match_rules_match_id_foreign" foreign key ("match_id")
          references "matches" ("id") on update cascade on delete restrict,
        constraint "tennis_match_rules_opening_set_format_check"
          check ("opening_set_format" in ('FAST4', 'NORMAL')),
        constraint "tennis_match_rules_deciding_set_format_check"
          check ("deciding_set_format" is null or "deciding_set_format" in ('FAST4', 'NORMAL', 'SUPER_TIE_BREAK'))
      );
    `);
    this.addSql(`
      create table "tennis_sets" (
        "id" uuid not null,
        "match_id" uuid not null,
        "set_order" integer not null,
        "kind" text not null,
        "side_1_score" integer not null,
        "side_2_score" integer not null,
        constraint "tennis_sets_pkey" primary key ("id"),
        constraint "tennis_sets_match_id_set_order_unique" unique ("match_id", "set_order"),
        constraint "tennis_sets_match_id_foreign" foreign key ("match_id")
          references "matches" ("id") on update cascade on delete restrict,
        constraint "tennis_sets_set_order_check" check ("set_order" between 1 and 3),
        constraint "tennis_sets_kind_check" check ("kind" in ('GAME_SET', 'SUPER_TIE_BREAK')),
        constraint "tennis_sets_side_1_score_check" check ("side_1_score" >= 0),
        constraint "tennis_sets_side_2_score_check" check ("side_2_score" >= 0)
      );
    `);
    this.addSql(`
      create table "match_revisions" (
        "id" uuid not null,
        "match_id" uuid not null,
        "version" integer not null,
        "changed_at" timestamptz not null default current_timestamp,
        "snapshot" jsonb not null,
        constraint "match_revisions_pkey" primary key ("id"),
        constraint "match_revisions_match_id_version_unique" unique ("match_id", "version"),
        constraint "match_revisions_match_id_foreign" foreign key ("match_id")
          references "matches" ("id") on update cascade on delete restrict,
        constraint "match_revisions_version_check" check ("version" > 0)
      );
    `);
  }

  override down(): void {
    this.addSql('drop table if exists "match_revisions";');
    this.addSql('drop table if exists "tennis_sets";');
    this.addSql('drop table if exists "tennis_match_rules";');
  }
}
