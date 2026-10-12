import type { EntityManager } from '@mikro-orm/postgresql';
import { DomainError } from './errors';

const operationSettings: Record<string, string> = {
  CREATE_LEAGUE: 'rate_limit.create_league',
  UPLOAD_AVATAR: 'rate_limit.upload_avatar',
  CORRECT_ELO: 'rate_limit.correct_elo',
};

async function setting(em: EntityManager, key: string): Promise<number> {
  const rows = await em
    .getConnection()
    .execute<{ value: number }[]>(
      'select value from application_settings where key = ?',
      [key],
    );
  const value = rows[0]?.value;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Missing positive application setting: ${key}`);
  }
  return value;
}

async function consumeBucket(
  em: EntityManager,
  key: string,
  operation: string,
  limit: number,
): Promise<void> {
  const rows = await em.getConnection().execute<{ count: number }[]>(
    `insert into rate_limit_buckets (key, operation, window_start, count)
     values (?, ?, date_trunc('minute', clock_timestamp()), 1)
     on conflict (key, operation, window_start)
     do update set count = rate_limit_buckets.count + 1
     where rate_limit_buckets.count < ?
     returning count`,
    [key, operation, limit],
  );
  if (rows.length === 0) {
    throw new DomainError('RATE_LIMITED', undefined, 60);
  }
}

export async function consumeLimit(
  em: EntityManager,
  clientKey: string,
  operation: string,
): Promise<void> {
  const specificSetting = operationSettings[operation];
  const [globalLimit, generalLimit, specificLimit] = await Promise.all([
    setting(em, 'rate_limit.global'),
    setting(em, 'rate_limit.default'),
    specificSetting ? setting(em, specificSetting) : Promise.resolve(undefined),
  ]);
  await consumeBucket(em, '__global__', 'ALL', globalLimit);
  await consumeBucket(em, clientKey, 'ALL', generalLimit);
  if (specificLimit !== undefined) {
    await consumeBucket(em, clientKey, operation, specificLimit);
  }
}
