import { createHash, randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { DomainError } from './errors';

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function normalize(value: unknown, inArray = false): JsonValue | undefined {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new DomainError('VALIDATION');
    return Object.is(value, -0) ? 0 : value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map(item => normalize(item, true) ?? null);
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new DomainError('VALIDATION');
    }
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(value as object).sort()) {
      const normalized = normalize(
        (value as Record<string, unknown>)[key],
        false,
      );
      if (normalized !== undefined) result[key] = normalized;
    }
    return result;
  }
  if (inArray && value === undefined) return null;
  if (value === undefined) return undefined;
  throw new DomainError('VALIDATION');
}

function payloadHash(payload: unknown): string {
  const canonical = normalize(payload);
  if (canonical === undefined) throw new DomainError('VALIDATION');
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

interface RequestTokenRow {
  payload_hash: string;
  response: unknown | null;
  completed: boolean;
}

export async function once<T>(
  em: EntityManager,
  operation: string,
  token: string,
  canonicalPayload: unknown,
  execute: () => Promise<T>,
): Promise<T> {
  if (!em.isInTransaction()) {
    throw new Error('once requires an active transaction');
  }

  const hash = payloadHash(canonicalPayload);
  const connection = em.getConnection();
  const transaction = em.getTransactionContext();
  await connection.execute(
    `insert into request_tokens (id, operation, token, payload_hash, response)
     values (?, ?, ?, ?, null)
     on conflict (operation, token) do nothing
     returning id`,
    [randomUUID(), operation, token, hash],
    'all',
    transaction,
  );
  const rows = await connection.execute<RequestTokenRow[]>(
    `select payload_hash, response, response is not null as completed
       from request_tokens
      where operation = ? and token = ?
      for update`,
    [operation, token],
    'all',
    transaction,
  );
  const row = rows[0];
  if (!row) throw new Error('request token disappeared during transaction');
  if (row.payload_hash !== hash) {
    throw new DomainError('IDEMPOTENCY_CONFLICT');
  }
  if (row.completed) return row.response as T;

  const response = await execute();
  const serialized = JSON.stringify(response);
  if (serialized === undefined) throw new DomainError('VALIDATION');
  await connection.execute(
    `update request_tokens
        set response = ?::jsonb
      where operation = ? and token = ?`,
    [serialized, operation, token],
    'all',
    transaction,
  );
  return response;
}
