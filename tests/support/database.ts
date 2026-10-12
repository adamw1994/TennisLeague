import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { MikroORM } from '@mikro-orm/postgresql';
import { createOrmConfig } from '../../mikro-orm.config';

export interface TestDatabaseContext {
  orm: MikroORM;
  schema: string;
}

function testDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) {
    throw new Error('TEST_DATABASE_URL is required');
  }

  const parsed = new URL(value);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (!databaseName.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL database name must end with _test');
  }

  return value;
}

export function withTestDb<T>(
  fn: (em: EntityManager, context: TestDatabaseContext) => Promise<T>,
): Promise<T>;
export function withTestDb<T>(
  fn: (em: EntityManager) => Promise<T>,
): Promise<T>;
export async function withTestDb<T>(
  fn: (em: EntityManager, context: TestDatabaseContext) => Promise<T>,
): Promise<T> {
  const baseUrl = testDatabaseUrl();
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const adminOrm = await MikroORM.init(createOrmConfig(baseUrl));
  let testOrm: MikroORM | undefined;

  try {
    await adminOrm.em.getConnection().execute(`create schema "${schema}"`);
    testOrm = await MikroORM.init(createOrmConfig(baseUrl, schema));
    await testOrm.migrator.up({ schema });
    return await fn(testOrm.em.fork(), { orm: testOrm, schema });
  } finally {
    try {
      await testOrm?.close(true);
    } finally {
      try {
        await adminOrm.em
          .getConnection()
          .execute(`drop schema if exists "${schema}" cascade`);
      } finally {
        await adminOrm.close(true);
      }
    }
  }
}
