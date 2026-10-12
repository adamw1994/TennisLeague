import { afterEach, expect, test, vi } from 'vitest';
import { createBarrier } from '../support/barrier';
import { withTestDb } from '../support/database';

const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
  vi.resetModules();
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

test('migracje są powtarzalne i sport TENNIS istnieje raz', async () => {
  await withTestDb(async (em, context) => {
    const { migrate } = await import('@/db/migrate');

    await migrate(context.orm);
    await migrate(context.orm);

    const rows = await em.getConnection().execute(
      "select code from sports where code = 'TENNIS'",
    );
    expect(rows).toEqual([{ code: 'TENNIS' }]);
    await expect(
      em.getConnection().execute(`
        insert into sports (id, code, name)
        values ('00000000-0000-0000-0000-00000000f001', 'PADEL', 'Padel')
      `),
    ).rejects.toMatchObject({ code: '23514' });

    const orm = context.orm;
    expect(await orm.migrator.getPending()).toEqual([]);
    const [{ current_schema: schema }] = await em
      .getConnection()
      .execute<{ current_schema: string }[]>('select current_schema()');
    const schemaDiff = await orm.schema.getUpdateSchemaMigrationSQL({
      schema,
      wrap: false,
    });
    expect(schemaDiff.up.trim()).toBe('');
  });
});

test('health zwraca 503 bez szczegółów połączenia oraz 200 dla dostępnej bazy', async () => {
  process.env.DATABASE_URL =
    'postgresql://postgres:invalid@127.0.0.1:1/low_on_legs_test?connect_timeout=1';
  const unavailableRoute = await import('@/app/api/health/route');

  const unavailable = await unavailableRoute.GET();

  expect(unavailable.status).toBe(503);
  expect(await unavailable.json()).toEqual({ status: 'unavailable' });
  const unavailableOrm = await import('@/db/orm');
  await (await unavailableOrm.getOrm()).close(true);

  vi.resetModules();
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const availableRoute = await import('@/app/api/health/route');
  const available = await availableRoute.GET();
  expect(available.status).toBe(200);
  expect(await available.json()).toEqual({ status: 'ok' });

  const availableOrm = await import('@/db/orm');
  await (await availableOrm.getOrm()).close(true);
});

test('getOrm usuwa odrzuconą inicjalizację z cache', async () => {
  process.env.DATABASE_URL = 'not-a-postgresql-url';
  const { getOrm } = await import('@/db/orm');

  await expect(getOrm()).rejects.toThrow();

  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const orm = await getOrm();
  await expect(orm.em.getConnection().execute('select 1')).resolves.toBeTruthy();
  await orm.close(true);
});

test('withDb przekazuje równoległym operacjom niezależne EntityManager', async () => {
  await withTestDb(async (_em, context) => {
    const { withDb } = await import('@/db/orm');
    const waitForBoth = createBarrier(2);
    const contexts: unknown[] = [];

    await Promise.all([
      withDb(async em => {
        contexts.push(em);
        await waitForBoth();
      }, context.orm),
      withDb(async em => {
        contexts.push(em);
        await waitForBoth();
      }, context.orm),
    ]);

    expect(contexts).toHaveLength(2);
    expect(contexts[0]).not.toBe(contexts[1]);

  });
});

test('równoległe withTestDb kierują withDb do własnych schematów', async () => {
  vi.resetModules();
  const { withDb } = await import('@/db/orm');
  const waitForAllConnections = createBarrier(4);

  const exerciseSchema = () =>
    withTestDb(async (em, context) => {
      const [{ current_schema: ownSchema }] = await em
        .getConnection()
        .execute<{ current_schema: string }[]>('select current_schema()');
      await em.getConnection().execute(`
        create table isolation_markers (
          marker text primary key,
          schema_name text not null
        )
      `);

      const routedSchemas = await Promise.all(
        ['first', 'second'].map(marker =>
          withDb(
            routedEm =>
              routedEm.transactional(async tx => {
                await tx.getConnection().execute(
                  'insert into isolation_markers (marker, schema_name) values (?, ?)',
                  [marker, ownSchema],
                );
                await waitForAllConnections();
                const [{ current_schema: schema }] = await tx
                  .getConnection()
                  .execute<{ current_schema: string }[]>('select current_schema()');
                return schema;
              }),
            context.orm,
          ),
        ),
      );
      const markers = await em
        .getConnection()
        .execute<{ schema_name: string }[]>(
          'select schema_name from isolation_markers order by marker',
        );
      return { ownSchema, routedSchemas, markers };
    });

  const results = await Promise.all([exerciseSchema(), exerciseSchema()]);

  expect(results[0].ownSchema).not.toBe(results[1].ownSchema);
  for (const result of results) {
    expect(result.routedSchemas).toEqual([result.ownSchema, result.ownSchema]);
    expect(result.markers).toEqual([
      { schema_name: result.ownSchema },
      { schema_name: result.ownSchema },
    ]);
  }
});
