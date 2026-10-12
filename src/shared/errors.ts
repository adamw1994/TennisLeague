import type { ActionResult } from './contracts';

const messages: Record<string, string> = {
  NICKNAME_TAKEN: 'Ten pseudonim jest już zajęty.',
  AVATAR_TOO_LARGE: 'Plik awatara jest zbyt duży.',
  INVALID_AVATAR: 'Plik awatara musi być pojedynczym obrazem JPEG, PNG lub WebP.',
  VALIDATION: 'Popraw dane formularza.',
  VERSION_CONFLICT: 'Dane zostały zmienione. Odśwież stronę i spróbuj ponownie.',
  IDEMPOTENCY_CONFLICT: 'Ten identyfikator operacji został już użyty z innymi danymi.',
  RATE_LIMITED: 'Wykonano zbyt wiele prób. Spróbuj ponownie za chwilę.',
  NOT_FOUND: 'Nie znaleziono zasobu.',
  FORBIDDEN_OPERATION: 'Ta operacja jest niedozwolona.',
  PLAYER_NOT_FOUND: 'Nie znaleziono gracza.',
  LEAGUE_NOT_FOUND: 'Nie znaleziono ligi.',
  MATCH_NOT_FOUND: 'Nie znaleziono meczu.',
  PLAYER_DELETED: 'Gracz został usunięty.',
  PLAYER_NOT_IN_LEAGUE: 'Gracz nie należy do tej ligi.',
  INVALID_SIDE_SIZE: 'Strona meczu ma nieprawidłową liczbę graczy.',
  DUPLICATE_MATCH_PLAYER: 'Gracz nie może wystąpić po obu stronach meczu.',
  INVALID_TENNIS_SCORE: 'Wynik tenisowy jest nieprawidłowy.',
  MATCH_ALREADY_COMPLETED: 'Wynik tego meczu został już zapisany.',
  STRUCTURAL_LEAGUE_CHANGE_FORBIDDEN: 'Nie można zmienić struktury tej ligi.',
  ELO_RECALCULATION_FAILED: 'Nie udało się przeliczyć rankingu Elo.',
  RECOVERY_SOURCE_NOT_FOUND: 'Nie znaleziono wskazanej aktywnej wersji do odzyskania.',
};

export class DomainError extends Error {
  readonly code: string;
  readonly fields?: Record<string, string>;
  readonly retryAfterSeconds?: number;

  constructor(
    code: string,
    fields?: Record<string, string>,
    retryAfterSeconds?: number,
  ) {
    super(messages[code] ?? 'Nie udało się wykonać operacji.');
    this.name = 'DomainError';
    this.code = code;
    this.fields = fields;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function toActionError(error: DomainError): ActionResult<never> {
  return {
    ok: false,
    code: error.code,
    message: error.message,
    ...(error.fields ? { fields: error.fields } : {}),
    ...(error.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: error.retryAfterSeconds }),
  };
}
