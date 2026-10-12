import { z } from 'zod';
import type { EntityManager } from '@mikro-orm/postgresql';
import { DomainError } from './errors';

export const UuidSchema = z.uuid();
export const PendingVersionSchema = z.int().min(0);
export const PersistedVersionSchema = z.int().positive();

export const VersionedSchema = z.strictObject({
  id: UuidSchema,
  expectedVersion: PersistedVersionSchema,
});

export function CreationSchema<T extends z.ZodType>(data: T) {
  return z.strictObject({ token: UuidSchema, data });
}

export function assertVersion(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new DomainError('VERSION_CONFLICT');
  }
}

export async function inMutationTransaction<T>(
  em: EntityManager,
  execute: (tx: EntityManager) => Promise<T>,
): Promise<T> {
  return em.transactional(async tx => {
    const connection = tx.getConnection();
    const transaction = tx.getTransactionContext();
    await connection.execute(
      "set local lock_timeout = '5s'",
      [],
      'all',
      transaction,
    );
    await connection.execute(
      "set local transaction_timeout = '15s'",
      [],
      'all',
      transaction,
    );
    return execute(tx);
  });
}
