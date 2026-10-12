# Task 3 report — structural tennis score

## Status

DONE

## Implemented

- Added the exact `Format`, `TennisScore`, and `TennisProjection` domain contracts.
- Added strict runtime parsing for the score object and every nested set. Unknown root and nested fields are rejected.
- Added validation for safe non-negative integer scores, consecutive set positions 1–3, set kind/format agreement, finished FAST4/NORMAL/SUPER_TIE_BREAK results, and best-of-three completion.
- Added projection of winner, sets, game totals, and super tie-break totals. A super tie-break wins a set but adds no games.
- Added two-set normalization to `decidingSetFormat: null` on a cloned score; caller objects and nested set arrays are not mutated.
- All failures use `DomainError('INVALID_TENNIS_SCORE', fields)` with field paths such as `sets.2.sideB`.

## Public interfaces and persistence normalization contract

- `validateScore(input: unknown): TennisProjection` is the required common API for creation, correction, and statistics.
- `normalizeScore(input: unknown): TennisScore` returns a fully validated, cloned, persistence-ready score.
- `validateAndNormalizeScore(input: unknown): { score: TennisScore; projection: TennisProjection }` lets later match persistence validate once, persist `score`, and use `projection` without independently implementing any tennis rule.
- For a straight-sets match, the returned `score.decidingSetFormat` is always `null`, even if the accepted input supplied a deciding format. For a three-set match, the supplied deciding format is retained. No input value is mutated.

## TDD evidence

### RED

Command:

```powershell
$env:Path = 'C:/Program Files/nodejs;' + $env:Path
& 'C:/Program Files/nodejs/npm.cmd' run test:unit -- tests/unit/tennis.test.ts
```

The sandboxed attempt first stopped before collection with the documented `spawn EPERM`. The identical command was rerun with escalation and produced the expected feature failure:

```text
FAIL  tests/unit/tennis.test.ts [ tests/unit/tennis.test.ts ]
Error: Cannot find package '@/modules/tennis/validate'
Test Files  1 failed | 1 passed (2)
Tests  12 passed (12)
```

This was the expected RED because the tests imported the specified tennis API before any production tennis module existed.

### GREEN

Command:

```powershell
$env:Path = 'C:/Program Files/nodejs;' + $env:Path
& 'C:/Program Files/nodejs/npm.cmd' run test:unit -- tests/unit/tennis.test.ts
```

Output:

```text
Test Files  2 passed (2)
Tests  41 passed (41)
Duration  243ms
```

The npm script includes all unit tests as well as the requested file, so this run also checked the existing unit suite.

## Additional verification

```text
npm run typecheck
> tsc --noEmit
exit 0

npm run lint
> eslint .
exit 0
```

## Files changed

- `src/modules/tennis/types.ts`
- `src/modules/tennis/validate.ts`
- `src/modules/tennis/project.ts`
- `tests/unit/tennis.test.ts`

This report is in the ignored task workspace and is intentionally not part of the product commit.

## Self-review

- Rechecked every Task 3 acceptance bullet against the tests and implementation.
- Confirmed the specified valid and invalid score boundaries, mirrored winners, malicious extra fields, missing/additional sets, and numeric edge cases are covered.
- Confirmed domain modules import neither Next.js nor ORM code.
- Confirmed changes do not include persistence or UI work.
- No unresolved concerns.
