import { DomainError } from './errors';

export interface DomainErrorLogContext {
  requestId: string;
  startedAt: number;
  now?: () => number;
  write?: (entry: {
    requestId: string;
    code: string;
    durationMs: number;
  }) => void;
}

export function logDomainError(
  error: unknown,
  context: DomainErrorLogContext,
): void {
  const now = context.now ?? Date.now;
  const write = context.write ?? console.error;
  write({
    requestId: context.requestId,
    code: error instanceof DomainError ? error.code : 'INTERNAL_ERROR',
    durationMs: Math.max(0, now() - context.startedAt),
  });
}
