import { createHash, randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { withDb } from '@/db/orm';
import { setAvatar } from '@/modules/players/commands';
import { getAvatar, getPlayer } from '@/modules/players/queries';
import { DomainError, toActionError } from '@/shared/errors';
import {
  assertContentLength,
  assertMutationOrigin,
  deriveClientKey,
  readBodyWithLimit,
  UPLOAD_BODY_LIMIT,
} from '@/shared/limits';
import { assertVersion } from '@/shared/mutation';
import { logDomainError } from '@/shared/logger';
import { consumeLimit } from '@/shared/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(error: unknown, startedAt: number): Response {
  logDomainError(error, { requestId: randomUUID(), startedAt });
  if (!(error instanceof DomainError)) {
    return Response.json(
      { ok: false, code: 'INTERNAL_ERROR', message: 'Nie udało się zapisać awatara.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const body = toActionError(error);
  const status =
    error.code === 'FORBIDDEN_OPERATION'
      ? 403
      : error.code === 'PLAYER_NOT_FOUND'
        ? 404
        : error.code === 'VERSION_CONFLICT'
          ? 409
          : error.code === 'RATE_LIMITED'
            ? 429
            : 400;
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

async function uploadClientKey(request: NextRequest): Promise<string> {
  const secret = process.env.CLIENT_KEY_HMAC_SECRET;
  if (!secret) throw new Error('CLIENT_KEY_HMAC_SECRET is required');
  return deriveClientKey({
    remoteAddress: '127.0.0.1',
    forwardedFor: request.headers.get('x-forwarded-for'),
    trustProxy: process.env.TRUST_PROXY === 'true',
    secret,
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ playerId: string }> },
): Promise<Response> {
  const startedAt = Date.now();
  try {
    const expectedOrigin = process.env.APP_ORIGIN;
    if (!expectedOrigin) throw new Error('APP_ORIGIN is required');
    assertMutationOrigin(request.headers, expectedOrigin);
    assertContentLength(request.headers, UPLOAD_BODY_LIMIT);

    const clientKey = await uploadClientKey(request);
    await withDb(em => consumeLimit(em, clientKey, 'UPLOAD_AVATAR'));

    const body = await readBodyWithLimit(request, UPLOAD_BODY_LIMIT);
    const parsedRequest = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: Buffer.from(body),
    });
    let formData: FormData;
    try {
      formData = await parsedRequest.formData();
    } catch {
      throw new DomainError('VALIDATION');
    }
    const allowedFields = ['avatar', 'expectedVersion'];
    if (
      [...formData.keys()].some(key => !allowedFields.includes(key)) ||
      allowedFields.some(key => formData.getAll(key).length !== 1)
    ) {
      throw new DomainError('VALIDATION');
    }
    const file = formData.get('avatar');
    const versionValue = formData.get('expectedVersion');
    if (!(file instanceof File) || typeof versionValue !== 'string') {
      throw new DomainError('VALIDATION');
    }
    const expectedVersion = Number(versionValue);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new DomainError('VALIDATION');
    }
    const { playerId } = await context.params;

    const current = await withDb(em => getPlayer(em, playerId));
    assertVersion(current.version, expectedVersion);
    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await withDb(em =>
      setAvatar(em, playerId, expectedVersion, bytes),
    );
    return Response.json({ ok: true, value: result });
  } catch (error) {
    return errorResponse(error, startedAt);
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ playerId: string }> },
): Promise<Response> {
  const startedAt = Date.now();
  try {
    const { playerId } = await context.params;
    const avatar = await withDb(em => getAvatar(em, playerId));
    const etag = `"${createHash('sha256').update(avatar.bytes).digest('base64url')}"`;
    const headers = {
      'Cache-Control': 'public, no-cache',
      'Content-Type': 'image/webp',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    };
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(new Uint8Array(avatar.bytes), { status: 200, headers });
  } catch (error) {
    return errorResponse(error, startedAt);
  }
}
