import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { withDb } from '@/db/orm';
import { once } from '@/shared/idempotency';
import { inMutationTransaction } from '@/shared/mutation';
import { consumeLimit } from '@/shared/rate-limit';
import { withTestDb } from '../support/database';

test('ten sam token nie tworzy drugiego zasobu', async () => {
  await withTestDb(async em => {
    let calls = 0;
    const invoke = (payload: object) =>
      em.transactional(tx =>
        once(tx, 'CREATE_PLAYER', 'token-1', payload, async () => {
          calls += 1;
          return { id: 'saved' };
        }),
      );

    expect(await invoke({ nickname: 'Adam' })).toEqual({ id: 'saved' });
    expect(await invoke({ nickname: 'Adam' })).toEqual({ id: 'saved' });
    expect(calls).toBe(1);
    await expect(invoke({ nickname: 'Ewa' })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
  });
});

test('rekurencyjnie sortuje klucze przed hashowaniem i zachowuje kolejność tablic', async () => {
  await withTestDb(async em => {
    const invoke = (payload: object) =>
      em.transactional(tx =>
        once(tx, 'CREATE_PLAYER', 'token-canonical', payload, async () => ({
          id: 'saved',
        })),
      );

    await expect(
      invoke({ nested: { z: 1, a: 2 }, players: ['A', 'B'] }),
    ).resolves.toEqual({ id: 'saved' });
    await expect(
      invoke({ players: ['A', 'B'], nested: { a: 2, z: 1 } }),
    ).resolves.toEqual({ id: 'saved' });
    await expect(
      invoke({ players: ['B', 'A'], nested: { a: 2, z: 1 } }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
});

test('zapamiętuje także odpowiedź JSON null', async () => {
  await withTestDb(async em => {
    let calls = 0;
    const invoke = () =>
      em.transactional(tx =>
        once(tx, 'NULL_RESULT', 'token-null', {}, async () => {
          calls += 1;
          return null;
        }),
      );

    await expect(invoke()).resolves.toBeNull();
    await expect(invoke()).resolves.toBeNull();
    expect(calls).toBe(1);
  });
});

test('once wymaga transakcji chroniącej zapis zasobu', async () => {
  await withTestDb(async em => {
    await expect(
      once(em, 'CREATE_PLAYER', 'token-no-tx', {}, async () => ({ id: 'x' })),
    ).rejects.toThrow('once requires an active transaction');
  });
});

test('rollback callbacku usuwa zasób i token, więc operację można powtórzyć', async () => {
  await withTestDb(async em => {
    await em.getConnection().execute(
      'create table mutation_effects (id uuid primary key)',
    );
    const id = randomUUID();

    await expect(
      em.transactional(tx =>
        once(tx, 'ROLLBACK_TEST', 'token-rollback', { id }, async () => {
          await tx
            .getConnection()
            .execute(
              'insert into mutation_effects (id) values (?)',
              [id],
              'all',
              tx.getTransactionContext(),
            );
          throw new Error('callback failed');
        }),
      ),
    ).rejects.toThrow('callback failed');

    const result = await em.transactional(tx =>
      once(tx, 'ROLLBACK_TEST', 'token-rollback', { id }, async () => {
        await tx
          .getConnection()
          .execute(
            'insert into mutation_effects (id) values (?)',
            [id],
            'all',
            tx.getTransactionContext(),
          );
        return { id };
      }),
    );
    const effects = await em
      .getConnection()
      .execute<{ id: string }[]>('select id from mutation_effects');

    expect(result).toEqual({ id });
    expect(effects).toEqual([{ id }]);
  });
});

test(
  '20 równoległych procesów utrwala jeden efekt i jedną odpowiedź',
  async () => {
    await withTestDb(async (_em, context) => {
      const id = randomUUID();
      const setup = context.orm.em.fork();
      await setup
        .getConnection()
        .execute('create table mutation_effects (id uuid primary key)');

      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          withDb(
            em =>
              em.transactional(tx =>
                once(
                  tx,
                  'CREATE_PLAYER',
                  'token-concurrent',
                  { id },
                  async () => {
                    await tx
                      .getConnection()
                      .execute(
                        'insert into mutation_effects (id) values (?)',
                        [id],
                        'all',
                        tx.getTransactionContext(),
                      );
                    return { id };
                  },
                ),
              ),
            context.orm,
          ),
        ),
      );
      const effects = await setup
        .getConnection()
        .execute<{ id: string }[]>('select id from mutation_effects');

      expect(results).toEqual(Array.from({ length: 20 }, () => ({ id })));
      expect(effects).toEqual([{ id }]);
    });
  },
  15_000,
);

test('ogólny limit klienta jest wspólny dla różnych operacji', async () => {
  await withTestDb(async (em, context) => {
    await em.getConnection().execute(
      "update application_settings set value = 1 where key = 'rate_limit.default'",
    );

    await consumeLimit(context.orm.em.fork(), 'mixed-client', 'CREATE_PLAYER');
    await expect(
      consumeLimit(context.orm.em.fork(), 'mixed-client', 'UPDATE_PLAYER'),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});

test('specjalny limit operacji działa dodatkowo do limitu ogólnego', async () => {
  await withTestDb(async em => {
    await em.getConnection().execute(
      `update application_settings
          set value = case key
            when 'rate_limit.default' then 10
            when 'rate_limit.create_league' then 1
            else value
          end`,
    );

    await consumeLimit(em, 'league-client', 'CREATE_LEAGUE');
    await expect(
      consumeLimit(em, 'league-client', 'CREATE_LEAGUE'),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});

test('globalny limit jest wspólny dla różnych klientów', async () => {
  await withTestDb(async em => {
    await em.getConnection().execute(
      `update application_settings
          set value = case key
            when 'rate_limit.default' then 10
            when 'rate_limit.global' then 1
            else value
          end`,
    );

    await consumeLimit(em, 'first-client', 'CREATE_PLAYER');
    await expect(
      consumeLimit(em, 'second-client', 'UPDATE_PLAYER'),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});

test('limit jest atomowy dla dwóch niezależnych połączeń', async () => {
  await withTestDb(async (em, context) => {
    await em.getConnection().execute(
      "update application_settings set value = 1 where key = 'rate_limit.default'",
    );

    const attempts = await Promise.allSettled([
      withDb(
        fork => consumeLimit(fork, 'same-client', 'CREATE_PLAYER'),
        context.orm,
      ),
      withDb(
        fork => consumeLimit(fork, 'same-client', 'CREATE_PLAYER'),
        context.orm,
      ),
    ]);

    expect(
      attempts.filter(result => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = attempts.find(result => result.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: { code: 'RATE_LIMITED' },
    });
  });
});

test('transakcja mutacji ustawia limity blokady i czasu', async () => {
  await withTestDb(async em => {
    const settings = await inMutationTransaction(em, async tx => {
      const [row] = await tx.getConnection().execute<
        { lock_timeout: string; transaction_timeout: string }[]
      >(
        `select current_setting('lock_timeout') as lock_timeout,
                current_setting('transaction_timeout') as transaction_timeout`,
        [],
        'all',
        tx.getTransactionContext(),
      );
      return row;
    });

    expect(settings).toEqual({
      lock_timeout: '5s',
      transaction_timeout: '15s',
    });
  });
});
