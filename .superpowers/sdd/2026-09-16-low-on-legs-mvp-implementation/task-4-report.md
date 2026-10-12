# Task 4 implementer report

## Status

DONE

## Implemented

- Added `Migration003Players` with global players, soft deletion, optimistic versions, timestamps, immutable nickname reservation, and `player_avatars` with a PK/FK to players.
- Added the immutable PostgreSQL `normalize_nickname(text)` function as the sole source of the generated `nickname_key`. Its trim character set matches ECMAScript `String.trim`, including tabs, NBSP, Unicode spaces, line separators, and BOM; lowercasing preserves diacritics.
- Added MikroORM metadata and migration registration while keeping the existing schema-drift check clean. The schema generator leaves the migration-owned SQL routine unmanaged.
- Added strict player create/update/delete services. Create uses `once` inside `inMutationTransaction`; raw SQL always receives the MikroORM transaction context. Concurrent database uniqueness is mapped to `NICKNAME_TAKEN`.
- Added row-lock/version handling for update and delete. A repeated delete returns the stored version before evaluating a stale `expectedVersion`.
- Added serializable player queries with stable 25-row cursor pagination, active-only public reads, optional deleted lookup, avatar version, and zero league/match counts until Task 5 introduces those relations.
- Added bounded avatar processing with a two-decoder process gate, Sharp's native five-second timeout, 16-million-pixel limit, one-frame JPEG/PNG/WebP validation, EXIF rotation, proportional 256 px resizing, and WebP-only persistence.
- Added a capped multipart avatar route. POST enforces exact Origin, rejects an excessive declared length, consumes the shared `UPLOAD_AVATAR` limit before application parsing/decoding, streams with the 6 MiB cap, strictly checks multipart fields/version, preflights the version before decode, then rechecks it under lock. GET returns only processed `image/webp` with `nosniff`, ETag, and conditional 304 support.
- Added Polish responsive player list, create, profile, and edit pages with keyboard-visible focus, accessible labels, empty states, avatar placeholders, and delete confirmation via a native dialog.
- Added separate base-data and avatar confirmations. Version conflicts expose a full refresh action. Failed create forms preserve exact input.
- Added a browser idempotency token lifecycle: the UUID is kept in `sessionStorage` across an unchanged uncertain/failed submission, rotated when the user deliberately edits the payload after submission, and removed only after confirmed success.
- Added an isolated sequential Playwright setup that refuses any database whose name does not end in `_e2e_test`, resets only that database's `public` schema, applies migrations, starts the app on port 3100, and uses the prepared Chromium installation.

## Public interfaces

```ts
type PlayerInput = {
  firstName: string;
  lastName: string;
  nickname: string;
};

createPlayer(
  em: EntityManager,
  command: Creation<PlayerInput>,
): Promise<{ id: Id; version: number }>;

updatePlayer(
  em: EntityManager,
  command: Versioned & PlayerInput,
): Promise<{ id: Id; version: number }>;

deletePlayer(
  em: EntityManager,
  command: Versioned,
): Promise<{ id: Id; version: number }>;

setAvatar(
  em: EntityManager,
  id: Id,
  expectedVersion: number,
  bytes: Buffer,
): Promise<{ version: number }>;

listPlayers(em: EntityManager, cursor?: string): Promise<Page<PlayerDto>>;
getPlayer(em: EntityManager, id: Id, includeDeleted?: boolean): Promise<PlayerDto>;
getAvatar(em: EntityManager, id: Id): Promise<{ bytes: Buffer; updatedAt: string }>;
sanitizeAvatar(bytes: Buffer): Promise<Buffer>;
```

`PlayerDto` contains `id`, names, nickname, `version`, ISO timestamps, `deletedAt`, numeric nullable `avatarVersion`, and the temporary zero-valued `leagueCount`/`matchCount` fields.

The browser boundary exposes `createPlayerAction`, `updatePlayerAction`, and `deletePlayerAction`, plus `POST`/`GET /api/players/[playerId]/avatar`.

## TDD evidence

### RED: player domain did not exist

Command (after retrying the documented sandbox `spawn EPERM` outside the sandbox):

```powershell
$env:TEST_DATABASE_URL='postgresql://postgres:<local-test-password>@127.0.0.1:55433/low_on_legs_test'
npm exec vitest run tests/integration/players.test.ts
```

Relevant output:

```text
FAIL tests/integration/players.test.ts
Error: Cannot find package '@/modules/players/commands'
Test Files 1 failed (1)
```

This was the expected missing-feature failure before the player module, migration, or services existed.

### GREEN: focused domain and image behavior

```powershell
$env:TEST_DATABASE_URL='postgresql://postgres:<local-test-password>@127.0.0.1:55433/low_on_legs_test'
npm exec vitest run tests/integration/players.test.ts
```

```text
Test Files 1 passed (1)
Tests 10 passed (10)
```

The suite covers nickname reservation after deletion, exact whitespace/Polish-letter normalization, strict validation, a concurrent nickname collision, version conflicts, repeated deletion, stable pagination, SVG/size/pixel/animation rejection, portrait/landscape resizing, and WebP-only persistence.

### RED: first browser product slice

```powershell
$env:E2E_DATABASE_URL='postgresql://postgres:<local-test-password>@127.0.0.1:55433/low_on_legs_e2e_test'
$env:PLAYWRIGHT_BROWSERS_PATH='C:/Users/Adam/Repo/tennis/.superpowers/sdd/2026-09-16-low-on-legs-mvp-implementation/browsers'
npm exec playwright test tests/e2e/players.spec.ts --workers=1
```

Before the pages existed, Chromium reached the app and the first scenario timed out waiting for the missing player form (`dodaje gracza bez awatara`, 30.1 s). The run was stopped after this expected red.

### RED: form preservation and delete navigation regressions

The first implemented browser run produced:

```text
1 passed, 2 failed
Expected pseudonim "  zajęty nick  ", received ""
Expected /players after delete, remained on /players/<id> with the deleted profile rendered as 404
```

Root causes were React resetting uncontrolled form fields after a Server Action and Next's thrown redirect signal being caught as an internal error. Controlled fields and a redirect outside the domain-error catch fixed the two boundaries.

Focused green reruns:

```text
playwright ... -g 'pokazuje konflikt'  -> 1 passed
playwright ... -g 'potwierdza usunięcie' -> 1 passed
```

### GREEN: schema alignment

```powershell
npm exec vitest -- run tests/integration/platform.test.ts -t 'migracje'
```

```text
Test Files 1 passed (1)
Tests 1 passed | 4 skipped (5)
```

## E2E setup

- Database: `low_on_legs_e2e_test` at the prepared PostgreSQL 18 Docker instance on `127.0.0.1:55433`.
- Safety check: global setup requires the parsed database name to end in `_e2e_test` before executing `drop schema public cascade`; it never reads or resets `DATABASE_URL`.
- Lifecycle: global setup recreates only `public`, runs all migrations, then Playwright starts Next dev at `127.0.0.1:3100` with `APP_ORIGIN` and a test-only HMAC secret.
- Isolation: one Chromium worker, sequential scenarios, one dedicated database separate from Vitest's `low_on_legs_test` schemas.
- Browser: `PLAYWRIGHT_BROWSERS_PATH` points at the prepared repository-local browser cache documented in `environment.md`.

Final browser command:

```powershell
$env:E2E_DATABASE_URL='postgresql://postgres:<local-test-password>@127.0.0.1:55433/low_on_legs_e2e_test'
$env:PLAYWRIGHT_BROWSERS_PATH='C:/Users/Adam/Repo/tennis/.superpowers/sdd/2026-09-16-low-on-legs-mvp-implementation/browsers'
npm exec -- playwright test tests/e2e/players.spec.ts --workers=1
```

```text
4 passed (9.9s)
```

The fourth scenario additionally covers cross-origin upload rejection, real multipart upload, processed WebP dimensions, `nosniff`, ETag, and conditional 304.

## Final verification

All commands below ran on the finished implementation against dedicated test databases.

```text
npm exec -- vitest run tests/unit tests/integration
Test Files 5 passed (5)
Tests 67 passed (67)

npm exec -- playwright test tests/e2e/players.spec.ts --workers=1
4 passed (9.9s)

npm run typecheck
tsc --noEmit
exit 0

npm run lint
eslint .
exit 0, no warnings

npm run build
Next.js production build compiled, typechecked, generated pages, and listed all player/avatar routes
exit 0
```

The first sandboxed build reached successful compilation and then hit the documented Windows `spawn EPERM`; the same command rerun with process-spawn permission completed successfully.

## Files changed

- `mikro-orm.config.ts`
- `next-env.d.ts`
- `playwright.config.ts`
- `src/app/globals.css`
- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/api/players/[playerId]/avatar/route.ts`
- `src/app/players/actions.ts`
- `src/app/players/page.tsx`
- `src/app/players/new/page.tsx`
- `src/app/players/[playerId]/page.tsx`
- `src/app/players/[playerId]/edit/page.tsx`
- `src/components/ConfirmDelete.tsx`
- `src/components/FieldError.tsx`
- `src/components/PlayerForm.tsx`
- `src/db/entities.ts`
- `src/db/migrations.ts`
- `src/db/migrations/Migration003Players.ts`
- `src/modules/players/avatar.entity.ts`
- `src/modules/players/avatar.ts`
- `src/modules/players/commands.ts`
- `src/modules/players/player.entity.ts`
- `src/modules/players/queries.ts`
- `src/shared/errors.ts`
- `tests/e2e/global-setup.ts`
- `tests/e2e/players.spec.ts`
- `tests/integration/players.test.ts`
- `.superpowers/sdd/2026-09-16-low-on-legs-mvp-implementation/task-4-report.md`

## Self-review and concerns

- Verified every Task 4 checklist item against the brief and shared requirements.
- Confirmed every raw SQL call inside a mutation uses `tx.getTransactionContext()` and `once` remains inside the same resource transaction.
- Confirmed rate limiting is outside the resource transaction and before application multipart parsing/Sharp decode.
- Confirmed the nickname unique constraint includes deleted rows and concurrency correctness does not depend on a pre-insert availability read.
- Confirmed the UI never duplicates Unicode nickname comparison logic.
- Confirmed no production database is reset and no browser runs against the integration database.
- `avatarVersion` uses the player's monotonically increasing version when an avatar exists. A later base-data edit can therefore produce a harmless new avatar URL even when bytes are unchanged.
- League and match counts intentionally remain zero until Task 5 adds the relations and real aggregate queries.
- `normalize_nickname` is migration-owned; `schemaGenerator.ignoreRoutines` prevents the schema-drift tool from trying to remove this hand-authored function. Future routine changes must remain versioned migrations.
- No correctness blocker remains. Playwright emits only the environment's `NO_COLOR`/`FORCE_COLOR` process warning.
