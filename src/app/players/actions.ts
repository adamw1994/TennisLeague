'use server';

import { randomUUID } from 'node:crypto';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { withDb } from '@/db/orm';
import {
  createPlayer,
  deletePlayer,
  updatePlayer,
} from '@/modules/players/commands';
import { DomainError, toActionError } from '@/shared/errors';
import { deriveClientKey } from '@/shared/limits';
import { logDomainError } from '@/shared/logger';
import { consumeLimit } from '@/shared/rate-limit';

export interface PlayerFormState {
  status: 'idle' | 'error' | 'success';
  code?: string;
  message?: string;
  fields?: Record<string, string>;
  href?: string;
}

export interface DeletePlayerState {
  status: 'idle' | 'error' | 'success';
  code?: string;
  message?: string;
  href?: string;
}

async function consumeBrowserLimit(operation: string): Promise<void> {
  const requestHeaders = await headers();
  const secret = process.env.CLIENT_KEY_HMAC_SECRET;
  if (!secret) throw new Error('CLIENT_KEY_HMAC_SECRET is required');
  const clientKey = deriveClientKey({
    remoteAddress: '127.0.0.1',
    forwardedFor: requestHeaders.get('x-forwarded-for'),
    trustProxy: process.env.TRUST_PROXY === 'true',
    secret,
  });
  await withDb(em => consumeLimit(em, clientKey, operation));
}

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== 'string') throw new DomainError('VALIDATION');
  return value;
}

function failure(error: unknown, startedAt: number): PlayerFormState {
  const requestId = randomUUID();
  logDomainError(error, { requestId, startedAt });
  if (error instanceof DomainError) {
    const actionError = toActionError(error);
    if (!actionError.ok) {
      return {
        status: 'error',
        code: actionError.code,
        message: actionError.message,
        fields: actionError.fields,
      };
    }
  }
  return {
    status: 'error',
    code: 'INTERNAL_ERROR',
    message: 'Nie udało się zapisać gracza. Spróbuj ponownie.',
  };
}

export async function createPlayerAction(
  _previous: PlayerFormState,
  formData: FormData,
): Promise<PlayerFormState> {
  const startedAt = Date.now();
  try {
    await consumeBrowserLimit('CREATE_PLAYER');
    const created = await withDb(em =>
      createPlayer(em, {
        token: stringField(formData, 'token'),
        data: {
          firstName: stringField(formData, 'firstName'),
          lastName: stringField(formData, 'lastName'),
          nickname: stringField(formData, 'nickname'),
        },
      }),
    );
    revalidatePath('/players');
    return { status: 'success', href: `/players/${created.id}` };
  } catch (error) {
    return failure(error, startedAt);
  }
}

export async function updatePlayerAction(
  _previous: PlayerFormState,
  formData: FormData,
): Promise<PlayerFormState> {
  const startedAt = Date.now();
  try {
    await consumeBrowserLimit('UPDATE_PLAYER');
    const id = stringField(formData, 'id');
    await withDb(em =>
      updatePlayer(em, {
        id,
        expectedVersion: Number(stringField(formData, 'expectedVersion')),
        firstName: stringField(formData, 'firstName'),
        lastName: stringField(formData, 'lastName'),
        nickname: stringField(formData, 'nickname'),
      }),
    );
    revalidatePath('/players');
    revalidatePath(`/players/${id}`);
    return { status: 'success', href: `/players/${id}` };
  } catch (error) {
    return failure(error, startedAt);
  }
}

export async function deletePlayerAction(
  _previous: DeletePlayerState,
  formData: FormData,
): Promise<DeletePlayerState> {
  const startedAt = Date.now();
  try {
    await consumeBrowserLimit('DELETE_PLAYER');
    await withDb(em =>
      deletePlayer(em, {
        id: stringField(formData, 'id'),
        expectedVersion: Number(stringField(formData, 'expectedVersion')),
      }),
    );
    revalidatePath('/players');
  } catch (error) {
    const failed = failure(error, startedAt);
    return {
      status: 'error',
      code: failed.code,
      message: failed.message,
    };
  }
  redirect('/players');
}
