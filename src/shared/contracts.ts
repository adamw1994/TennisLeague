export type Id = string;
export type Side = 'A' | 'B';
export type Mode = 'SINGLES' | 'DOUBLES';
export type LeagueKind = 'CLASSIC' | 'ELO_INFINITE';
export type Sides = readonly [readonly Id[], readonly Id[]];
export type Versioned = { id: Id; expectedVersion: number };
export type Creation<T> = { token: string; data: T };
export type ActionResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: string;
      message: string;
      fields?: Record<string, string>;
      retryAfterSeconds?: number;
    };
export type Page<T> = { items: T[]; nextCursor: string | null };
