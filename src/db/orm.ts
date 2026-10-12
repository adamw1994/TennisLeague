import type { EntityManager } from '@mikro-orm/postgresql';
import { MikroORM } from '@mikro-orm/postgresql';
import { createOrmConfig } from '../../mikro-orm.config';

let ormPromise: Promise<MikroORM> | undefined;

function databaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) {
    throw new Error('DATABASE_URL is required');
  }
  return value;
}

export function getOrm(): Promise<MikroORM> {
  if (!ormPromise) {
    const pending = MikroORM.init(createOrmConfig(databaseUrl()));
    ormPromise = pending;
    void pending.catch(() => {
      if (ormPromise === pending) {
        ormPromise = undefined;
      }
    });
  }

  return ormPromise;
}

export async function withDb<T>(
  fn: (em: EntityManager) => Promise<T>,
  orm?: MikroORM,
): Promise<T> {
  const database = orm ?? (await getOrm());
  return fn(database.em.fork());
}
