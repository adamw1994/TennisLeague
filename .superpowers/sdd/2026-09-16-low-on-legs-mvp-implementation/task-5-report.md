# Task 5 implementer report

## Status

DONE — implementation and verification complete in the working tree; no commit or push was requested for this turn.

## Implemented

- Added deterministic circle-method scheduling with stable sorted identifiers, byes for odd participant counts, reversed return legs, shifted round numbers, and unique fixture keys.
- Added `Migration004LeaguesMatches` and matching MikroORM metadata for leagues, memberships, fixed teams, matches, sides, and side participants.
- Added database checks and composite foreign keys that keep league, match, side, team, membership, and participant identities coherent. Database uniqueness prevents a player from occupying two fixed teams or appearing twice in one match.
- Added strict league validation for CLASSIC/ELO_INFINITE, SINGLES/DOUBLES, K from 10 to 60, minimum participant counts, complete fixed pairs, no duplicate players, and a hard limit of 5,000 generated fixtures.
- Added atomic, idempotent creation. One transaction locks active players in UUID order and writes the league, memberships, fixed pairs, complete classic schedule, sides, and participants. Elo leagues start without matches.
- Added optimistic name/K updates, idempotent soft deletion, active-only public reads, participant/team summaries, and ordered schedule queries.
- Replaced temporary player counters with real active-league and scheduled-match aggregates. Delete confirmation now describes preserved historical relations.
- Added a two-step Polish league form: configuration, fixed-pair preview, fixture count, immutable-structure warning, summary, and confirmation. Back navigation preserves local values and the browser request token follows the established retry lifecycle.
- Added league list/filter, details, schedule/history, settings, and deletion views; updated global navigation and responsive styling.
- Added sequential Vitest file execution because shared MikroORM entity metadata cannot safely be initialized concurrently with different test `search_path` values. Tests inside a file still exercise multi-connection concurrency explicitly.

## Public interfaces

```ts
generateSchedule(sideIds: string[], returnLegs: boolean): Fixture[];

createLeague(
  em: EntityManager,
  command: Creation<LeagueInput>,
): Promise<{ id: Id; version: number }>;

updateLeague(
  em: EntityManager,
  command: Versioned & { name: string; eloK?: number },
): Promise<{ id: Id; version: number }>;

deleteLeague(
  em: EntityManager,
  command: Versioned,
): Promise<{ id: Id; version: number }>;

listLeagues(em: EntityManager, kind?: LeagueKind): Promise<LeagueSummaryDto[]>;
getLeague(em: EntityManager, id: Id): Promise<LeagueDto>;
listLeagueMatches(em: EntityManager, id: Id): Promise<LeagueMatchDto[]>;
getVisibleLeagueForUpdate(em: EntityManager, id: Id): Promise<VisibleLeagueRow>;
```

## Test evidence

- RED: `tests/unit/schedule.test.ts` initially failed because `@/modules/leagues/schedule` did not exist.
- Unit: 3 files, 50 tests passed. The scheduler covers 5, 6, and 30 sides, 15/30/870 fixture totals, unique keys, no duplicate side in a round, deterministic input ordering, and reversed return legs.
- Integration: 4 files, 35 tests passed against PostgreSQL 18. League coverage includes singles, doubles, five-player Elo doubles, idempotency, transaction rollback after match insert failure, deleted-player rejection, strict structural updates, soft deletion, player counters, and composite database constraints.
- E2E: both Task 5 scenarios passed: classic singles with a complete schedule and classic doubles with fixed teams plus a return leg. The preceding full run also passed all five existing player scenarios.
- TypeScript strict check, ESLint, MikroORM schema drift test, and Next.js production build all passed.

## Scope left for later tasks

- Classic result capture, revisions, standings, and automatic completion belong to Task 6.
- Elo calculation, adding Elo matches/members later, publication, and recalculation belong to Tasks 7–10.
- Match-independent player statistics beyond relation counts belong to Task 11.
