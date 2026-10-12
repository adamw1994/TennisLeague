import { createHmac } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { DomainError, toActionError } from '@/shared/errors';
import {
  assertContentLength,
  assertMutationOrigin,
  deriveClientKey,
  readBodyWithLimit,
} from '@/shared/limits';
import { logDomainError } from '@/shared/logger';
import {
  CreationSchema,
  PendingVersionSchema,
  PersistedVersionSchema,
  UuidSchema,
  VersionedSchema,
  assertVersion,
} from '@/shared/mutation';

const resourceId = '550e8400-e29b-41d4-a716-446655440000';
const token = 'c56a4180-65aa-42ec-a945-5fd21dec0538';
const originalAppOrigin = process.env.APP_ORIGIN;

afterEach(() => {
  if (originalAppOrigin === undefined) delete process.env.APP_ORIGIN;
  else process.env.APP_ORIGIN = originalAppOrigin;
  vi.resetModules();
});

test('schemat utworzenia odrzuca nie-UUID token i nieznane pola', () => {
  const InputSchema = z.strictObject({ nickname: z.string().trim().min(1) });
  const schema = CreationSchema(InputSchema);

  expect(schema.parse({ token, data: { nickname: ' Adam ' } })).toEqual({
    token,
    data: { nickname: 'Adam' },
  });
  expect(() =>
    schema.parse({ token: 'token-1', data: { nickname: 'Adam' } }),
  ).toThrow();
  expect(() =>
    schema.parse({ token, data: { nickname: 'Adam', admin: true } }),
  ).toThrow();
  expect(() =>
    schema.parse({ token, data: { nickname: 'Adam' }, extra: true }),
  ).toThrow();
});

test('schematy wersji rozróżniają oczekujący mecz od istniejących zasobów', () => {
  expect(UuidSchema.parse(resourceId)).toBe(resourceId);
  expect(PendingVersionSchema.parse(0)).toBe(0);
  expect(() => PendingVersionSchema.parse(-1)).toThrow();
  expect(PersistedVersionSchema.parse(1)).toBe(1);
  expect(() => PersistedVersionSchema.parse(0)).toThrow();
  expect(
    VersionedSchema.parse({ id: resourceId, expectedVersion: 2 }),
  ).toEqual({ id: resourceId, expectedVersion: 2 });
  expect(() =>
    VersionedSchema.parse({ id: resourceId, expectedVersion: 2, version: 2 }),
  ).toThrow();
});

test('assertVersion zgłasza stabilny konflikt wersji', () => {
  expect(() => assertVersion(3, 2)).toThrowError(
    expect.objectContaining({ code: 'VERSION_CONFLICT' }),
  );
  expect(() => assertVersion(2, 2)).not.toThrow();
});

test('błąd domenowy zwraca polski komunikat i pola bez treści formularza', () => {
  const error = new DomainError('VALIDATION', { nickname: 'Wymagane' });

  expect(toActionError(error)).toEqual({
    ok: false,
    code: 'VALIDATION',
    message: 'Popraw dane formularza.',
    fields: { nickname: 'Wymagane' },
  });
});

test('log błędu zawiera tylko identyfikator, kod i czas', () => {
  const write = vi.fn();

  logDomainError(new DomainError('NOT_FOUND'), {
    requestId: 'request-7',
    startedAt: 1_000,
    now: () => 1_025,
    write,
  });

  expect(write).toHaveBeenCalledWith({
    requestId: 'request-7',
    code: 'NOT_FOUND',
    durationMs: 25,
  });
});

test('niezaufany forwarded header nie zmienia klucza klienta', () => {
  const expected = createHmac('sha256', 'test-secret')
    .update('192.0.2.10')
    .digest('hex');
  const first = deriveClientKey({
    remoteAddress: '192.0.2.10',
    forwardedFor: '203.0.113.1',
    trustProxy: false,
    secret: 'test-secret',
  });
  const second = deriveClientKey({
    remoteAddress: '192.0.2.10',
    forwardedFor: '198.51.100.2',
    trustProxy: false,
    secret: 'test-secret',
  });

  expect(first).toBe(second);
  expect(first).toBe(expected);
});

test('zaufany proxy bierze pierwszy poprawny adres z forwarded header', () => {
  const direct = deriveClientKey({
    remoteAddress: '203.0.113.1',
    trustProxy: false,
    secret: 'test-secret',
  });
  const proxied = deriveClientKey({
    remoteAddress: '192.0.2.10',
    forwardedFor: '203.0.113.1, 192.0.2.10',
    trustProxy: true,
    secret: 'test-secret',
  });

  expect(proxied).toBe(direct);
});

test('limit body odrzuca żądanie na podstawie nagłówka bez czytania body', () => {
  const headers = new Headers({ 'content-length': '262145' });

  expect(() => assertContentLength(headers, 256 * 1024)).toThrowError(
    expect.objectContaining({ code: 'VALIDATION' }),
  );
});

test('czytnik body odrzuca nadmiar mimo zaniżonego Content-Length i anuluje strumień', async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3, 4]));
    },
    cancel,
  });
  const request = new Request('https://tennis.example/upload', {
    method: 'POST',
    headers: { 'content-length': '1' },
    body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });

  await expect(readBodyWithLimit(request, 5)).rejects.toMatchObject({
    code: 'VALIDATION',
  });
  expect(cancel).toHaveBeenCalledOnce();
});

test('czytnik body mierzy treść bez Content-Length', async () => {
  const request = new Request('https://tennis.example/upload', {
    method: 'POST',
    body: new Uint8Array([1, 2, 3]),
  });

  await expect(readBodyWithLimit(request, 3)).resolves.toEqual(
    new Uint8Array([1, 2, 3]),
  );
});

test('origin mutacji musi dokładnie odpowiadać APP_ORIGIN', () => {
  expect(() =>
    assertMutationOrigin(
      new Headers({ origin: 'https://evil.example' }),
      'https://tennis.example',
    ),
  ).toThrowError(expect.objectContaining({ code: 'FORBIDDEN_OPERATION' }));
  expect(() =>
    assertMutationOrigin(
      new Headers({ origin: 'https://tennis.example' }),
      'https://tennis.example',
    ),
  ).not.toThrow();
});

test('Next ogranicza Server Actions do 256 KiB i hosta APP_ORIGIN', async () => {
  process.env.APP_ORIGIN = 'https://tennis.example:8443';
  vi.resetModules();

  const { default: config } = await import('../../next.config');

  expect(config.experimental?.serverActions).toEqual({
    bodySizeLimit: '256kb',
    allowedOrigins: ['tennis.example:8443'],
  });

});
