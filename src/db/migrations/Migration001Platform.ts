import { Migration } from '@mikro-orm/migrations';

export class Migration001Platform extends Migration {
  override name = 'Migration001Platform';

  override up(): void {
    this.addSql(`
      create table "sports" (
        "id" uuid not null,
        "code" text not null,
        "name" text not null,
        constraint "sports_pkey" primary key ("id"),
        constraint "sports_code_unique" unique ("code"),
        constraint "sports_code_check" check ("code" in ('TENNIS'))
      );
    `);
    this.addSql(`
      insert into "sports" ("id", "code", "name")
      values ('00000000-0000-0000-0000-000000000001', 'TENNIS', 'Tenis');
    `);
  }

  override down(): void {
    this.addSql('drop table if exists "sports";');
  }
}
