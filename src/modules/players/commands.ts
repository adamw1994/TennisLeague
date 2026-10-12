import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import type { Creation, Id, Versioned } from '@/shared/contracts';
import { DomainError } from '@/shared/errors';
import { once } from '@/shared/idempotency';
import {
  assertVersion,
  CreationSchema,
  inMutationTransaction,
  VersionedSchema,
} from '@/shared/mutation';
import { sanitizeAvatar } from './avatar';

const name = (
  maximum: number,
  requiredMessage: string,
  maximumMessage: string,
) =>
  z
    .string({ error: requiredMessage })
    .trim()
    .min(1, requiredMessage)
    .max(maximum, maximumMessage);

export const PlayerInputSchema = z.strictObject({
  firstName: name(80, 'Podaj imię.', 'Imię może mieć maksymalnie 80 znaków.'),
  lastName: name(
    80,
    'Podaj nazwisko.',
    'Nazwisko może mieć maksymalnie 80 znaków.',
  ),
  nickname: name(
    40,
    'Podaj pseudonim.',
    'Pseudonim może mieć maksymalnie 40 znaków.',
  ),
});

export type PlayerInput = z.infer<typeof PlayerInputSchema>;

const UpdatePlayerSchema = z.strictObject({
  id: z.uuid(),
  expectedVersion: z.int().positive(),
  ...PlayerInputSchema.shape,
});

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fields = Object.fromEntries(
      result.error.issues
        .filter(issue => issue.path.length > 0)
        .map(issue => [String(issue.path.at(-1)), issue.message]),
    );
    throw new DomainError('VALIDATION', fields);
  }
  return result.data;
}

function sqlCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const code = (current as Error & { code?: string }).code;
    if (code) return code;
    current = (current as Error & { cause?: unknown }).cause;
  }
  return undefined;
}

function mapNicknameConflict(error: unknown): never {
  if (sqlCode(error) === '23505') throw new DomainError('NICKNAME_TAKEN');
  throw error;
}

interface LockedPlayer {
  version: number;
  deleted_at: Date | null;
}

async function lockPlayer(
  em: EntityManager,
  id: string,
): Promise<LockedPlayer> {
  const rows = await em.getConnection().execute<LockedPlayer[]>(
    'select version, deleted_at from players where id = ? for update',
    [id],
    'all',
    em.getTransactionContext(),
  );
  if (!rows[0]) throw new DomainError('PLAYER_NOT_FOUND');
  return rows[0];
}

export async function createPlayer(
  em: EntityManager,
  command: Creation<PlayerInput>,
): Promise<{ id: Id; version: number }> {
  const parsed = parse(CreationSchema(PlayerInputSchema), command);
  try {
    return await inMutationTransaction(em, tx =>
      once(tx, 'CREATE_PLAYER', parsed.token, parsed.data, async () => {
        const id = randomUUID();
        const [created] = await tx.getConnection().execute<
          { id: string; version: number }[]
        >(
          `insert into players (id, first_name, last_name, nickname)
           values (?, ?, ?, ?)
           returning id, version`,
          [
            id,
            parsed.data.firstName,
            parsed.data.lastName,
            parsed.data.nickname,
          ],
          'all',
          tx.getTransactionContext(),
        );
        if (!created) throw new Error('player insert returned no row');
        return created;
      }),
    );
  } catch (error) {
    return mapNicknameConflict(error);
  }
}

export async function updatePlayer(
  em: EntityManager,
  command: Versioned & PlayerInput,
): Promise<{ id: Id; version: number }> {
  const parsed = parse(UpdatePlayerSchema, command);
  try {
    return await inMutationTransaction(em, async tx => {
      const current = await lockPlayer(tx, parsed.id);
      if (current.deleted_at) throw new DomainError('PLAYER_NOT_FOUND');
      assertVersion(current.version, parsed.expectedVersion);
      const [updated] = await tx.getConnection().execute<
        { id: string; version: number }[]
      >(
        `update players
            set first_name = ?, last_name = ?, nickname = ?,
                version = version + 1, updated_at = clock_timestamp()
          where id = ?
          returning id, version`,
        [parsed.firstName, parsed.lastName, parsed.nickname, parsed.id],
        'all',
        tx.getTransactionContext(),
      );
      if (!updated) throw new Error('player update returned no row');
      return updated;
    });
  } catch (error) {
    return mapNicknameConflict(error);
  }
}

export async function deletePlayer(
  em: EntityManager,
  command: Versioned,
): Promise<{ id: Id; version: number }> {
  const parsed = parse(VersionedSchema, command);
  return inMutationTransaction(em, async tx => {
    const current = await lockPlayer(tx, parsed.id);
    if (current.deleted_at) return { id: parsed.id, version: current.version };
    assertVersion(current.version, parsed.expectedVersion);
    const [removed] = await tx.getConnection().execute<
      { id: string; version: number }[]
    >(
      `update players
          set deleted_at = clock_timestamp(), updated_at = clock_timestamp(),
              version = version + 1
        where id = ?
        returning id, version`,
      [parsed.id],
      'all',
      tx.getTransactionContext(),
    );
    if (!removed) throw new Error('player delete returned no row');
    return removed;
  });
}

export async function setAvatar(
  em: EntityManager,
  id: Id,
  expectedVersion: number,
  bytes: Buffer,
): Promise<{ version: number }> {
  const parsed = parse(VersionedSchema, { id, expectedVersion });
  const sanitized = await sanitizeAvatar(bytes);
  return inMutationTransaction(em, async tx => {
    const current = await lockPlayer(tx, parsed.id);
    if (current.deleted_at) throw new DomainError('PLAYER_NOT_FOUND');
    assertVersion(current.version, parsed.expectedVersion);
    const [updated] = await tx.getConnection().execute<{ version: number }[]>(
      `update players
          set version = version + 1, updated_at = clock_timestamp()
        where id = ?
        returning version`,
      [parsed.id],
      'all',
      tx.getTransactionContext(),
    );
    if (!updated) throw new Error('avatar update returned no player row');
    await tx.getConnection().execute(
      `insert into player_avatars (player_id, bytes, mime_type, updated_at)
       values (?, ?, 'image/webp', clock_timestamp())
       on conflict (player_id) do update
       set bytes = excluded.bytes,
           mime_type = excluded.mime_type,
           updated_at = excluded.updated_at`,
      [parsed.id, sanitized],
      'all',
      tx.getTransactionContext(),
    );
    return updated;
  });
}
