import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { DomainError } from './errors';

export const SERVER_ACTION_BODY_LIMIT = 256 * 1024;
export const UPLOAD_BODY_LIMIT = 6 * 1024 * 1024;

export interface ClientAddressInput {
  remoteAddress: string;
  forwardedFor?: string | null;
  trustProxy: boolean;
  secret: string;
}

export function deriveClientKey(input: ClientAddressInput): string {
  let address = input.remoteAddress;
  if (input.trustProxy && input.forwardedFor) {
    const forwarded = input.forwardedFor.split(',', 1)[0]?.trim();
    if (forwarded && isIP(forwarded)) {
      address = forwarded;
    }
  }
  return createHmac('sha256', input.secret).update(address).digest('hex');
}

export function assertContentLength(headers: Headers, limit: number): void {
  const rawLength = headers.get('content-length');
  if (rawLength === null) return;
  const length = Number(rawLength);
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new DomainError('VALIDATION', { body: 'Nieprawidłowy rozmiar żądania.' });
  }
  if (length > limit) {
    throw new DomainError('VALIDATION', { body: 'Żądanie jest zbyt duże.' });
  }
}

export async function readBodyWithLimit(
  request: Request,
  limit: number,
): Promise<Uint8Array> {
  assertContentLength(request.headers, limit);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel('body limit exceeded');
        throw new DomainError('VALIDATION', {
          body: 'Żądanie jest zbyt duże.',
        });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export function assertMutationOrigin(
  headers: Headers,
  expectedOrigin: string,
): void {
  const origin = headers.get('origin');
  let normalizedExpected: string;
  try {
    normalizedExpected = new URL(expectedOrigin).origin;
  } catch {
    throw new Error('APP_ORIGIN must be an absolute origin');
  }
  if (!origin || origin !== normalizedExpected) {
    throw new DomainError('FORBIDDEN_OPERATION');
  }
}
