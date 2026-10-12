import { z } from 'zod';
import { DomainError } from '@/shared/errors';
import { projectScore } from './project';
import type { Format, TennisProjection, TennisScore } from './types';

const FormatSchema = z.enum(['FAST4', 'NORMAL']);
const DecidingSetFormatSchema = z.enum([
  'FAST4',
  'NORMAL',
  'SUPER_TIE_BREAK',
]);
const ScoreNumberSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const SetSchema = z.strictObject({
  order: z.number().int().min(1).max(3),
  kind: z.enum(['GAME_SET', 'SUPER_TIE_BREAK']),
  sideA: ScoreNumberSchema,
  sideB: ScoreNumberSchema,
});
const TennisScoreSchema = z.strictObject({
  openingSetFormat: FormatSchema,
  decidingSetFormat: DecidingSetFormatSchema.nullable(),
  sets: z.array(SetSchema).min(2).max(3),
});

export type ValidatedTennisScore = {
  score: TennisScore;
  projection: TennisProjection;
};

function invalid(fields: Record<string, string>): never {
  throw new DomainError('INVALID_TENNIS_SCORE', fields);
}

function issueFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const issue of error.issues) {
    const basePath = issue.path.map(String).join('.');
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        fields[[basePath, key].filter(Boolean).join('.')] =
          'Niedozwolone pole.';
      }
    } else {
      fields[basePath || 'score'] = 'Nieprawidłowa wartość.';
    }
  }

  return fields;
}

function isFinishedSet(
  format: Format | 'SUPER_TIE_BREAK',
  sideA: number,
  sideB: number,
): boolean {
  if (![sideA, sideB].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    return false;
  }

  const high = Math.max(sideA, sideB);
  const low = Math.min(sideA, sideB);
  if (format === 'FAST4') return high === 4 && low <= 3;
  if (format === 'NORMAL') {
    return (high === 6 && low <= 4) || (high === 7 && (low === 5 || low === 6));
  }

  return (high === 10 && low <= 8) || (high > 10 && high - low === 2);
}

function invalidScoreField(index: number, sideA: number, sideB: number): never {
  const side = sideA < sideB ? 'sideA' : 'sideB';
  return invalid({ [`sets.${index}.${side}`]: 'Set nie jest zakończony prawidłowym wynikiem.' });
}

export function validateAndNormalizeScore(input: unknown): ValidatedTennisScore {
  const parsed = TennisScoreSchema.safeParse(input);
  if (!parsed.success) invalid(issueFields(parsed.error));

  const score = parsed.data;
  let setsA = 0;
  let setsB = 0;

  for (const [index, set] of score.sets.entries()) {
    if (setsA === 2 || setsB === 2) {
      invalid({ [`sets.${index}`]: 'Mecz został rozstrzygnięty wcześniej.' });
    }
    if (set.order !== index + 1) {
      invalid({ [`sets.${index}.order`]: 'Sety muszą mieć kolejne pozycje.' });
    }

    const format = index < 2 ? score.openingSetFormat : score.decidingSetFormat;
    if (format === null) {
      invalid({ decidingSetFormat: 'Wymagany format decydującego seta.' });
    }
    const expectedKind = format === 'SUPER_TIE_BREAK' ? 'SUPER_TIE_BREAK' : 'GAME_SET';
    if (set.kind !== expectedKind) {
      invalid({ [`sets.${index}.kind`]: 'Rodzaj seta nie odpowiada jego formatowi.' });
    }
    if (!isFinishedSet(format, set.sideA, set.sideB)) {
      invalidScoreField(index, set.sideA, set.sideB);
    }

    if (set.sideA > set.sideB) setsA += 1;
    else setsB += 1;
  }

  if (setsA !== 2 && setsB !== 2) {
    invalid({ sets: 'Wynik meczu wymaga decydującego seta.' });
  }

  const normalizedScore: TennisScore = {
    ...score,
    decidingSetFormat: score.sets.length === 2 ? null : score.decidingSetFormat,
    sets: score.sets.map((set) => ({ ...set })),
  };

  return {
    score: normalizedScore,
    projection: projectScore(normalizedScore),
  };
}

export function normalizeScore(input: unknown): TennisScore {
  return validateAndNormalizeScore(input).score;
}

export function validateScore(input: unknown): TennisProjection {
  return validateAndNormalizeScore(input).projection;
}
