'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { withDb } from '@/db/orm';
import {
  correctClassicResult,
  createEloMatch,
  correctEloMatch,
  deleteEloMatch,
  recordClassicResult,
} from '@/modules/matches/commands';
import type { TennisScore } from '@/modules/tennis/types';
import { DomainError, toActionError } from '@/shared/errors';
import { deriveClientKey } from '@/shared/limits';
import { logDomainError } from '@/shared/logger';
import { consumeLimit } from '@/shared/rate-limit';

export interface ScoreFormState {
  status: 'idle' | 'error' | 'success';
  code?: string;
  message?: string;
  fields?: Record<string, string>;
  href?: string;
}

export interface DeleteMatchState {
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

function failure(error: unknown, startedAt: number): ScoreFormState {
  logDomainError(error, { requestId: randomUUID(), startedAt });
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
    message: 'Nie udało się zapisać wyniku. Spróbuj ponownie.',
  };
}

function score(formData: FormData): TennisScore {
  try {
    return JSON.parse(stringField(formData, 'score')) as TennisScore;
  } catch {
    throw new DomainError('INVALID_TENNIS_SCORE', {
      score: 'Nieprawidłowe dane wyniku.',
    });
  }
}

async function saveResult(
  formData: FormData,
  operation: 'record' | 'correct',
): Promise<ScoreFormState> {
  const startedAt = Date.now();
  let href: string;
  try {
    await consumeBrowserLimit(operation === 'record' ? 'RECORD_RESULT' : 'CORRECT_RESULT');
    const leagueId = stringField(formData, 'leagueId');
    const matchId = stringField(formData, 'matchId');
    const command = {
      id: matchId,
      expectedVersion: Number(stringField(formData, 'expectedVersion')),
      score: score(formData),
    };
    await withDb(em =>
      operation === 'record'
        ? recordClassicResult(em, command)
        : correctClassicResult(em, command),
    );
    revalidatePath('/leagues');
    revalidatePath(`/leagues/${leagueId}`);
    revalidatePath(`/leagues/${leagueId}/matches`);
    revalidatePath(`/leagues/${leagueId}/table`);
    revalidatePath(`/leagues/${leagueId}/matches/${matchId}`);
    href = `/leagues/${leagueId}/matches/${matchId}`;
  } catch (error) {
    return failure(error, startedAt);
  }
  redirect(href);
}

export async function recordClassicResultAction(
  _previous: ScoreFormState,
  formData: FormData,
): Promise<ScoreFormState> {
  return saveResult(formData, 'record');
}

export async function correctClassicResultAction(
  _previous: ScoreFormState,
  formData: FormData,
): Promise<ScoreFormState> {
  return saveResult(formData, 'correct');
}

export async function createEloMatchAction(
  _previous: ScoreFormState,
  formData: FormData,
): Promise<ScoreFormState> {
  const startedAt = Date.now();
  let href: string;
  try {
    await consumeBrowserLimit('CREATE_ELO_MATCH');
    const leagueId = stringField(formData, 'leagueId');
    const sides = JSON.parse(stringField(formData, 'sides')) as [string[], string[]];
    const created = await withDb(em =>
      createEloMatch(em, {
        token: stringField(formData, 'token'),
        data: { leagueId, sides, score: score(formData) },
      }),
    );
    revalidatePath('/leagues');
    revalidatePath(`/leagues/${leagueId}`);
    revalidatePath(`/leagues/${leagueId}/matches`);
    revalidatePath(`/leagues/${leagueId}/ranking`);
    href = `/leagues/${leagueId}/matches/${created.id}`;
  } catch (error) {
    return failure(error, startedAt);
  }
  redirect(href);
}

export async function correctEloMatchAction(
  _previous: ScoreFormState,
  formData: FormData,
): Promise<ScoreFormState> {
  const startedAt = Date.now();
  let href: string;
  try {
    await consumeBrowserLimit('CORRECT_ELO_MATCH');
    const leagueId = stringField(formData, 'leagueId');
    const matchId = stringField(formData, 'matchId');
    const sides = JSON.parse(stringField(formData, 'sides')) as [string[], string[]];
    await withDb(em =>
      correctEloMatch(em, {
        id: matchId,
        leagueId,
        expectedVersion: Number(stringField(formData, 'expectedVersion')),
        sides,
        score: score(formData),
      }),
    );
    revalidatePath('/leagues');
    revalidatePath(`/leagues/${leagueId}`);
    revalidatePath(`/leagues/${leagueId}/matches`);
    revalidatePath(`/leagues/${leagueId}/ranking`);
    revalidatePath(`/leagues/${leagueId}/matches/${matchId}`);
    href = `/leagues/${leagueId}/matches/${matchId}`;
  } catch (error) {
    return failure(error, startedAt);
  }
  redirect(href);
}

export async function deleteEloMatchAction(
  _previous: DeleteMatchState,
  formData: FormData,
): Promise<DeleteMatchState> {
  const startedAt = Date.now();
  const leagueId = formData.get('leagueId');
  try {
    await consumeBrowserLimit('DELETE_ELO_MATCH');
    await withDb(em =>
      deleteEloMatch(em, {
        id: stringField(formData, 'matchId'),
        leagueId: stringField(formData, 'leagueId'),
        expectedVersion: Number(stringField(formData, 'expectedVersion')),
      }),
    );
    if (typeof leagueId === 'string') {
      revalidatePath(`/leagues/${leagueId}`);
      revalidatePath(`/leagues/${leagueId}/matches`);
      revalidatePath(`/leagues/${leagueId}/ranking`);
    }
  } catch (error) {
    const failed = failure(error, startedAt);
    return {
      status: 'error',
      code: failed.code,
      message: failed.message,
    };
  }
  redirect(typeof leagueId === 'string' ? `/leagues/${leagueId}/matches` : '/leagues');
}
