import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MikroORM } from '@mikro-orm/postgresql';
import { getOrm } from './orm';

export async function migrate(orm?: MikroORM): Promise<void> {
  const database = orm ?? (await getOrm());
  await database.migrator.up();
}

async function run(): Promise<void> {
  const orm = await getOrm();
  try {
    await orm.migrator.up();
  } finally {
    await orm.close(true);
  }
}

const entrypoint = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (entrypoint) {
  void run().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
