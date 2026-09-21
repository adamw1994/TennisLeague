import { Migration } from '@mikro-orm/migrations';

export class Migration006Elo extends Migration {
  override name = 'Migration006Elo';

  override up(): void {
    this.addSql(`
      alter table "leagues"
        add column "input_revision" bigint not null default '0',
        add column "published_revision" bigint not null default '0',
        add column "published_publication_id" uuid null,
        add column "elo_state" text null,
        add column "last_result_recorded_at" timestamptz null,
        add constraint "leagues_input_revision_check" check ("input_revision" >= 0),
        add constraint "leagues_published_revision_check" check ("published_revision" >= 0),
        add constraint "leagues_elo_state_check" check (
          (kind = 'CLASSIC' and elo_state is null and published_publication_id is null)
          or
          (kind = 'ELO_INFINITE' and elo_state is not null
            and elo_state in ('CURRENT', 'RECALCULATING', 'FAILED'))
        );
    `);

    this.addSql(`
      create table "elo_publications" (
        "id" uuid not null,
        "league_id" uuid not null,
        "revision" bigint not null,
        "created_at" timestamptz not null default current_timestamp,
        constraint "elo_publications_pkey" primary key ("id"),
        constraint "elo_publications_league_id_revision_unique" unique ("league_id", "revision"),
        constraint "elo_publications_league_id_foreign" foreign key ("league_id")
          references "leagues" ("id") on update cascade on delete restrict,
        constraint "elo_publications_revision_check" check ("revision" >= 0)
      );
    `);

    this.addSql(`
      create table "elo_ratings" (
        "publication_id" uuid not null,
        "player_id" uuid not null,
        "rating" integer not null,
        "played" integer not null,
        "last_delta" integer null,
        constraint "elo_ratings_pkey" primary key ("publication_id", "player_id"),
        constraint "elo_ratings_publication_id_foreign" foreign key ("publication_id")
          references "elo_publications" ("id") on update cascade on delete cascade,
        constraint "elo_ratings_player_id_foreign" foreign key ("player_id")
          references "players" ("id") on update cascade on delete restrict,
        constraint "elo_ratings_rating_check" check ("rating" >= 500),
        constraint "elo_ratings_played_check" check ("played" >= 0)
      );
    `);

    this.addSql(`
      create table "elo_rating_events" (
        "publication_id" uuid not null,
        "match_id" uuid not null,
        "match_version" integer not null,
        "player_id" uuid not null,
        "rating_before" integer not null,
        "expected_score" numeric not null,
        "actual_score" integer not null,
        "k_factor" integer not null,
        "calculated_delta" integer not null,
        "applied_delta" integer not null,
        "rating_after" integer not null,
        constraint "elo_rating_events_pkey" primary key ("publication_id", "match_id", "player_id"),
        constraint "elo_rating_events_publication_id_foreign" foreign key ("publication_id")
          references "elo_publications" ("id") on update cascade on delete cascade,
        constraint "elo_rating_events_revision_foreign" foreign key ("match_id", "match_version")
          references "match_revisions" ("match_id", "version") on update cascade on delete restrict,
        constraint "elo_rating_events_player_id_foreign" foreign key ("player_id")
          references "players" ("id") on update cascade on delete restrict,
        constraint "elo_rating_events_match_version_check" check ("match_version" > 0),
        constraint "elo_rating_events_rating_before_check" check ("rating_before" >= 500),
        constraint "elo_rating_events_expected_score_check"
          check (("expected_score" >= 0) and ("expected_score" <= 1)),
        constraint "elo_rating_events_actual_score_check" check ("actual_score" in (0, 1)),
        constraint "elo_rating_events_k_factor_check"
          check (("k_factor" >= 10) and ("k_factor" <= 60)),
        constraint "elo_rating_events_rating_after_check" check ("rating_after" >= 500)
      );
    `);
    this.addSql(`
      create index "elo_rating_events_player_match_index"
        on "elo_rating_events" ("publication_id", "player_id", "match_id");
    `);

    this.addSql(`
      create table "elo_recalculation_jobs" (
        "id" uuid not null,
        "league_id" uuid not null,
        "requested_revision" bigint not null,
        "status" text not null default 'PENDING',
        "claim_token" uuid null,
        "lease_until" timestamptz null,
        "attempts" integer not null default 0,
        "available_at" timestamptz not null default current_timestamp,
        "started_at" timestamptz null,
        "finished_at" timestamptz null,
        "last_error_code" text null,
        "created_at" timestamptz not null default current_timestamp,
        "updated_at" timestamptz not null default current_timestamp,
        constraint "elo_recalculation_jobs_pkey" primary key ("id"),
        constraint "elo_recalculation_jobs_league_id_foreign" foreign key ("league_id")
          references "leagues" ("id") on update cascade on delete restrict,
        constraint "elo_recalculation_jobs_requested_revision_check" check ("requested_revision" >= 0),
        constraint "elo_recalculation_jobs_status_check" check ("status" in ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED')),
        constraint "elo_recalculation_jobs_attempts_check" check ("attempts" >= 0)
      );
    `);
    this.addSql(`
      create unique index "elo_recalculation_jobs_active_league_unique"
        on "elo_recalculation_jobs" ("league_id")
        where "status" in ('PENDING', 'RUNNING');
    `);
    this.addSql(`
      create index "elo_recalculation_jobs_status_available_index"
        on "elo_recalculation_jobs" ("status", "available_at", "id");
    `);
  }

  override down(): void {
    this.addSql('drop table if exists "elo_recalculation_jobs";');
    this.addSql('drop table if exists "elo_rating_events";');
    this.addSql('drop table if exists "elo_ratings";');
    this.addSql('drop table if exists "elo_publications";');
    this.addSql(`
      alter table "leagues"
        drop column "input_revision",
        drop column "published_revision",
        drop column "published_publication_id",
        drop column "elo_state",
        drop column "last_result_recorded_at";
    `);
  }
}
