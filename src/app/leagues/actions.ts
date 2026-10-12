'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { withDb } from '@/db/orm';
import {
  createLeague,
  deleteLeague,
  joinEloLeague,
  updateLeague,
  type LeagueInput,
} from '@/modules/leagues/commands';
import { DomainError, toActionError } from '@/shared/errors';
import { deriveClientKey } from '@/shared/limits';
import { logDomainError } from '@/shared/logger';
import { consumeLimit } from '@/shared/rate-limit';

export interface LeagueFormState {
  status: 'idle' | 'error' | 'success';
  code?: string;
  message?: string;
  fields?: Record<string, string>;
  href?: string;
}

export interface DeleteLeagueState {
  status: 'idle' | 'error' | 'success';
  code?: string;
  message?: string;
}

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== 'string') throw new DomainError('VALIDATION');
  return value;
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

function failure(error: unknown, startedAt: number): LeagueFormState {
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
    message: 'Nie udało się zapisać ligi. Spróbuj ponownie.',
  };
}

export async function createLeagueAction(
  _previous: LeagueFormState,
  formData: FormData,
): Promise<LeagueFormState> {
  const startedAt = Date.now();
  try {
    await consumeBrowserLimit('CREATE_LEAGUE');
    let data: LeagueInput;
    try {
      data = JSON.parse(stringField(formData, 'payload')) as LeagueInput;
    } catch {
      throw new DomainError('VALIDATION');
    }
    const created = await withDb(em =>
      createLeague(em, {
        token: stringField(formData, 'token'),
        data,
      }),
    );
    revalidatePath('/leagues');
    return { status: 'success', href: `/leagues/${created.id}` };
  } catch (error) {
    return failure(error, startedAt);
  }
}

export async function updateLeagueAction(
  _previous: LeagueFormState,
  formData: FormData,
): Promise<LeagueFormState> {
  const startedAt = Date.now();
  const id = formData.get('id');
  try {
    await consumeBrowserLimit('UPDATE_LEAGUE');
    const rawEloK = formData.get('eloK');
    const eloKValue = typeof rawEloK === 'string' ? rawEloK : '';
    await withDb(em =>
      updateLeague(em, {
        id: stringField(formData, 'id'),
        expectedVersion: Number(stringField(formData, 'expectedVersion')),
        name: stringField(formData, 'name'),
        ...(eloKValue ? { eloK: Number(eloKValue) } : {}),
      }),
    );
    revalidatePath('/leagues');
    if (typeof id === 'string') revalidatePath(`/leagues/${id}`);
    return { status: 'success', href: typeof id === 'string' ? `/leagues/${id}` : '/leagues' };
  } catch (error) {
    return failure(error, startedAt);
  }
}

export async function deleteLeagueAction(
  _previous: DeleteLeagueState,
  formData: FormData,
): Promise<DeleteLeagueState> {
  const startedAt = Date.now();
  try {
    await consumeBrowserLimit('DELETE_LEAGUE');
    await withDb(em =>
      deleteLeague(em, {
        id: stringField(formData, 'id'),
        expectedVersion: Number(stringField(formData, 'expectedVersion')),
      }),
    );
    revalidatePath('/leagues');
  } catch (error) {
    const failed = failure(error, startedAt);
    return {
      status: 'error',
      code: failed.code,
      message: failed.message,
    };
  }
  redirect('/leagues');
}

export async function joinEloLeagueAction(
  _previous: LeagueFormState,
  formData: FormData,
): Promise<LeagueFormState> {
  const startedAt = Date.now();
  const leagueId = formData.get('leagueId');
  try {
    await consumeBrowserLimit('JOIN_ELO_LEAGUE');
    await withDb(em =>
      joinEloLeague(em, {
        token: stringField(formData, 'token'),
        data: {
          leagueId: stringField(formData, 'leagueId'),
          playerId: stringField(formData, 'playerId'),
        },
      }),
    );
    revalidatePath('/leagues');
    if (typeof leagueId === 'string') {
      revalidatePath(`/leagues/${leagueId}`);
      revalidatePath(`/leagues/${leagueId}/ranking`);
      revalidatePath(`/leagues/${leagueId}/settings`);
    }
    return { status: 'success' };
  } catch (error) {
    return failure(error, startedAt);
  }
}
