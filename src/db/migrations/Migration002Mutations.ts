import { Migration } from '@mikro-orm/migrations';

export class Migration002Mutations extends Migration {
  override name = 'Migration002Mutations';

  override up(): void {
    this.addSql(`
      create table "request_tokens" (
        "id" uuid not null,
        "operation" text not null,
        "token" text not null,
        "payload_hash" text not null,
        "response" jsonb null,
        constraint "request_tokens_pkey" primary key ("id"),
        constraint "request_tokens_operation_token_unique" unique ("operation", "token")
      );
    `);
    this.addSql(`
      create table "application_settings" (
        "key" text not null,
        "value" integer not null,
        constraint "application_settings_pkey" primary key ("key"),
        constraint "application_settings_value_check" check ("value" > 0)
      );
    `);
    this.addSql(`
      insert into "application_settings" ("key", "value") values
        ('rate_limit.default', 60),
        ('rate_limit.create_league', 5),
        ('rate_limit.upload_avatar', 10),
        ('rate_limit.correct_elo', 20),
        ('rate_limit.global', 600);
    `);
    this.addSql(`
      create table "rate_limit_buckets" (
        "key" text not null,
        "operation" text not null,
        "window_start" timestamptz not null,
        "count" integer not null,
        constraint "rate_limit_buckets_pkey" primary key ("key", "operation", "window_start"),
        constraint "rate_limit_buckets_count_check" check ("count" > 0)
      );
    `);
    this.addSql(
      'create index "rate_limit_buckets_window_start_index" on "rate_limit_buckets" ("window_start");',
    );
  }

  override down(): void {
    this.addSql('drop table if exists "rate_limit_buckets";');
    this.addSql('drop table if exists "application_settings";');
    this.addSql('drop table if exists "request_tokens";');
  }
}
