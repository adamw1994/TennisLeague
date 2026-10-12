# SDD ledger — plan: docs/superpowers/plans/2026-09-16-low-on-legs-mvp-implementation.md

## Execution context

- User authorized implementation on 2026-09-16, current folder, no worktrees.
- Branch: feat/low-on-legs-mvp; base: 3133875.
- Tools: Node 24.21.0, npm 11.19.0, Git 2.55.0.windows.5; Docker CLI 29.8.0, Compose 5.5.1. Docker engine readiness unresolved.
- Node: C:/Program Files/nodejs; Git: C:/Program Files/Git/cmd/git.exe; Docker: C:/Users/Adam/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe.
- Ruling: Use a feature branch in the same checkout, without worktrees — explicit user preference — no extra directory; switching back later requires preserving changes.
- Ruling: Use subagent implementation and review as directed by executing-plans when subagents are available — same authorized plan scope — coordination overhead only.

## Preflight: task internal consistency

| Task | Checked | Finding / ruling |
|---|---|---|
| 1 | Tooling, scripts, migrations, platform test | Test titled repeatable does not itself migrate twice; implement a real repeatability test. Add worker build only when worker exists. |
| 2 | Tokens, schema, counters, body limits | HTTP UUID tokens differ from token-1 unit example; lower-level once accepts strings, transport validates UUID. |
| 3 | Tennis types and tests | Projection contract clear; strict validation must reject extra fields; deciding format null for two sets. |
| 4 | Player normalization and avatar tests | Database normalization authoritative; no duplicate JS case-fold rule. |
| 5 | Fixtures, sides, membership constraints | League and fixture transaction coherent; Elo publication completed in task 8. |
| 6 | Match versions and classic rules | Appendix resolves PENDING version 0 and first result version 1. |
| 7 | Elo rounding, floor, replay | Numeric tests agree with formulas. |
| 8 | Snapshot copying, append, membership | Input revisions use bigint internally/string DTO; avoid JS number coercion. |
| 9 | Lease, snapshot, replay and test | enqueueLatest test requires RECALCULATING; prefer end-to-end correction to create pending job. |
| 10 | Stale events and snapshot read | Stale depends on publication revision as well as match version. |
| 11 | Stats and visibility | Aggregate once per match; both doubles partners receive full side stats. |
| 12 | Docker runtime paths and recover | Appendix output dist/src matches commands; include scripts in runtime build only after created. |
| 13 | Acceptance fixture and benchmark | Explicit seeded league names; no dependence on earlier test data. |

## Preflight: shared files and interfaces

| Producers / consumers | Contract or shared files | Finding |
|---|---|---|
| 1 / 2–13 | ORM, test DB, runner/config/package files | Fresh EM per request/test; test-only database guard. All later tasks extend, never replace config. |
| 2 / 3–13 | errors/contracts/limits | DomainError must remain importable without Next/ORM runtime dependency. |
| 2 / 4,5,6,8,9,12 | once, versions, mutating commands | One transaction; no duplicate effects from retries. |
| 3 / 6,7,8,9,10,11,13 | TennisScore and TennisProjection | Same validator, no client-supplied winner or dates. |
| 4 / 5,6,8,9,10,11,12 | Player/queries/forms/avatar | Deleted players preserved in history; global active queries remain separate. |
| 5 / 6,8,9,10,11,12,13 | League, membership, match schema/queries/pages | Row locks first league then ordered players then match; immutable classic structure. |
| 6 / 8,9,10,11,12,13 | MatchRevision, score records, ScoreForm/actions | Classic sides immutable; Elo correction can change active membership selections. |
| 7 / 8,9,12,13 | calculateElo/replayElo | One calculator for incremental and full replay. |
| 8 / 9,10,11,12,13 | publications/jobs/queries/commands | One complete immutable publication; only atomic pointer swap exposes it. |
| 9 / 10,12,13 | claim/snapshot/publish/runOnce | Fenced lease; worker mutations do not increment league configuration version. |
| 10 / 11,13 | RankingDto and EloStatus | Published snapshot stats versus live result status remain distinguished. |
| 11 / 13 | player stats/overview/navigation | Matches in deleted leagues excluded globally. |
| 12 / 13 | runtime build/compose/recovery | Dedicated database for destructive restore tests. |
| 4,5,6,10,11 / each other | shared components and CSS | Reuse form/confirmation/field primitives; no unrelated redesign per task. |

Ruling: Resolve plan examples against approved design and explicit appendix — examples are not permission to omit real behavioral tests — potential cost is adjusting example test text.

## Tasks

- Task 1: complete (commits 3133875..98f2a12, review clean); prior checkpoint — commit baeffb3; native PostgreSQL integration 4/4, typecheck/lint/build/Compose static validation passed.
- Task 2: complete (commits 98f2a12..ff66e82, review clean)
- Task 3: complete (commits ff66e82..45de040, review clean)
- Task 4: complete (implementation df9ae00 plus review fixes in current Task 5 change set)
- Task 5: complete in working tree; verification green, awaiting commit on user request
- Task 6: complete in working tree; structural classic scores, immutable revisions, standings, correction and browser flows green
- Task 7: complete in working tree; shared pure Elo calculator and deterministic replay green
- Task 8: complete in working tree; immutable Elo publications, atomic append, membership and browser flows green
- Task 9: complete in working tree; recoverable Elo worker, corrections, soft delete, leases, stale snapshots, retry and atomic publications implemented; unit/integration/typecheck/lint/build green
- Task 10: complete in working tree; consistent Elo ranking/status snapshots, stale/pending match calculation state, polling UI and Elo correction/delete flows implemented; integration/typecheck/lint/build green
- Task 11: complete in working tree; player/doubles statistics, league overview, profile and home navigation, filters/pagination, visibility rules, error/not-found and navigation E2E implemented; unit 72/72, integration 60/60, E2E 12/12, typecheck/lint/build green
- Task 12: complete in working tree; Dockerfile, Compose local/external, separate migrator, runtime build/import rewiring, recovery CLI and idempotent restore commands for matches/revisions/leagues/players, operations documentation and recovery integration tests implemented; unit 72/72, recovery integration 3/3, typecheck/lint/build/runtime build green, Compose config valid. Full Docker smoke was blocked by Docker Desktop disk/startup failure; local PostgreSQL integration reached 62/63 with one pre-existing PostgreSQL 17 collation-dependent nickname test failure.
- Task 13: complete in working tree; acceptance fixture, worker setup/teardown, 5 acceptance scenarios, full E2E 17/17, deterministic benchmark and backup/restore drill implemented and verified. Docker smoke remains environment-blocked.

## Resume 2026-09-17

- Previous platform agent was no longer live; unfinished files: package.json, package-lock.json, .gitignore, installed node_modules. No task completion or commit existed.
- Resumed implementation with agent /root/platform_resume, preserving installed dependencies.
- Docker startup blocker changed: current backend log reports WSL update required; elevated wsl --version reports Wsl/CallMsi/Install/REGDB_E_CLASSNOTREG. Attempted wsl --update; awaiting result.
- Ruling: Use an official portable PostgreSQL 18.6 binary in this ignored workspace for real database verification while WSL is unavailable — same database engine/version family without system service installation — Docker-specific verification still required and cannot be claimed passing from native tests.
- Official download discovery: https://www.postgresql.org/download/windows/ -> https://www.enterprisedb.com/download-postgresql-binaries -> https://sbp.enterprisedb.com/getfile.jsp?fileid=1260488 (18.6 Windows x86-64).
- PostgreSQL extracted to this workspace's pgsql/; data in pgdata/, logs postgres-stdout.log and postgres-stderr.log. Native process 12340 started hidden, listening only on 127.0.0.1:55432; no system service.
- Verified PostgreSQL 18.6 and current_database=low_on_legs_test through psql. Local test database used a non-production credential; recreate a fresh local credential on another computer.
- Initdb locale provider ICU/pl-PL, UTF8, scram-sha-256. Never delete this workspace while native PostgreSQL uses its pgdata; stop it cleanly first and retain any data the user needs.
- WSL update failed with Wsl/CallMsi/Install/REGDB_E_CLASSNOTREG; Docker-specific checks remain blocked. Do not equate native database verification with Docker verification.
- Task 1 implementer notified database ready; awaiting real red/green, typecheck/lint/build and report.
- Agent platform_resume hit usage limit before report; user resumed after reset. Root independently verified current integration suite 4/4; agent resumed final checks and committed baeffb3.
- Task 1 report: task-1-report.md. Review package: review-3133875..baeffb3.diff. Reviewer: /root/review_platform. Do not mark complete until review resolved.
- Task 1: fix round 1/5 in progress, base baeffb3; reviewer found missing TENNIS CHECK and process-global test routing; minor cleanup robustness included. Implementer /root/platform_resume resumed.
- Browser preflight: installed Playwright Chromium v1243 and supporting binaries under this workspace browsers/; headless launch, HTML render and button locator check passed. See environment.md for PLAYWRIGHT_BROWSERS_PATH.
- Task 1 fix diagnostics: prior URL options did not enforce connection search_path; old tests touched public sports artifacts in the dedicated test database. Fix uses driver connection search_path and explicit ORM injection. Focused CHECK/schema-drift and four-connection overlapping-isolation regressions passed; final fix verification pending.
- Ruling: Task 2 establishes mutation primitives; browser token lifecycle is wired into real forms in Task 4 and later, matching the file ownership map. Carry the requirement in handoff notes; cost if missed is ineffective retry deduplication in UI.
- Resume 2026-09-17 14:46: Docker runtime now available (server 29.8.0). Started compose.test.yaml in project low-on-legs-validation with scratch port override 55433, separate test volume. Container healthy. Platform integration suite 5/5 passed against container PostgreSQL; previous Docker blocker resolved for Task 1. Native server on 55432 preserved.
- Task 1 fix round 1/5 committed baeffb3..98f2a12. Report includes native PG5/5, typecheck/lint/build, isolation markers across four concurrent connections; root added Docker PG5/5 evidence. Scoped re-review resumed /root/review_platform using review-baeffb3..98f2a12.diff.

- Task 1: fix round 1/5 (3 addressed, 0 open; commits baeffb3..98f2a12). Scoped review clean; no out-of-scope findings. Docker runtime caveat resolved. Task 1 complete.
- Task 2 implementer /root/mutations; base98f2a12; brief task-2-brief.md plus task-2-context.md and shared requirements. Real Docker database55433 ready.
- E2E preflight: created separate low_on_legs_e2e_test database in Docker test container; Chromium launch already verified. No app/schema startup yet; Task4 implements E2E setup.
- Ruling: Task2 exports reusable UuidSchema, CreationSchema(dataSchema), PendingVersionSchema (nonnegative), PersistedVersionSchema (positive), VersionedSchema; concrete domain payload shapes are owned by later tasks. Names were unspecified in plan; cost is updating callers if changed.
- Task 2 mid-verification: focused mutation/input21/21 and relevant suite including platform25/25 reported green; raw SQL transaction-context binding corrected; JSON-null replay covered. Final current-code tests/typecheck/lint pending before commit/review. Downstream agents must use transaction-bound SQL rather than bare connection.execute without context.
- Task 2 implemented commitff66e82; final28/28 tests, typecheck/lint clean on Docker PG. Review pending /root/review_mutations; package review-98f2a12..ff66e82.diff. Report task-2-report.md documents server helper interfaces and mandatory transaction context for raw SQL.

- Task 2 review approved /root/review_mutations; no findings. Concrete handler guard ordering and form token lifetime cannot exist yet; tracked obligations assigned Task4+ per existing ruling, verify there. Task3 starts fromff66e82.
- Task3 implementer /root/tennis, baseff66e82, report task-3-report.md. Task2 final review approved with no findings; future integration obligations carried forward.
- Task3 implemented45de040; unit41/41, typecheck/lint passed. Reviewer /root/review_tennis with package review-ff66e82..45de040.diff. Root also verified production build after Task2 Next configuration changes: exit0 without DB environment, dynamic root/health.
- Task 3 review approved /root/review_tennis; no findings. Task 4 starts from45de040.
- Task4 implementer /root/players, base45de040; requirements task-4-brief.md plus task-4-environment-notes.md and task2 call path. Must use isolated Docker E2E database and prepared Chromium.
- Task4 RED captured: players integration test expectedly failed because module commands absent. Implementer reports Migration003, player/avatar schemas, commands/queries and Sharp sanitizer in progress; no blocker. Next risks: metadata/migration drift, animated WebP fixture behavior, UI/upload/E2E lifecycle.
- Task4 focused integration green: players10/10 plus existing schema-drift migration test; animated WebP fixture validated. E2E RED reached prepared Chromium and timed out on absent form as expected. Implementer wiring actions/route: limits before parse/decode, origin before upload, streamed6MiB cap, preflight/recheck version.
- Task4 finalization: full E2E initially 1/3 exposed uncontrolled field reset after action error and swallowed Next redirect after delete; both fixed and focused green. Avatar HTTP E2E green (bad origin403, resize/WebP, nosniff, ETag304). Final67 unit/integration,4 E2E,typecheck,lint and build passed. Implementation commit df9ae00; independent review pending /root/review_players. Do not start Task5 until review resolves.
- Task4 review found Important gaps: unchanged form retry loses its hidden idempotency token after action errors; avatar uses immutable one-year cache despite unversioned mutable identity; upload/delete VERSION_CONFLICT lack refresh actions; delete dialog has no accessible name. Minor: raw Zod validation messages are English. Fix round 1/5 must address all; do not start Task5.

## Resume 2026-09-18 — macOS

- Switched to the latest branch `feat/low-on-legs-mvp` and preserved the existing Task 4 implementation.
- Resolved all Task 4 review findings: stable create token after errors, revalidation-safe avatar cache policy, refresh actions for version conflicts, accessible delete dialog, and Polish field validation messages.
- Task 4 regression verification passed: typecheck, lint, unit, players integration, production build, and all five player E2E scenarios.
- Implemented Task 5 in the current working tree: Migration004, relational league/member/team/match model, deterministic round-robin, atomic/idempotent creation, league queries/settings/deletion, real player relation counts, Polish responsive UI, and E2E for both classic modes.
- PostgreSQL 18 test instance for this session runs locally on `127.0.0.1:55432`; integration database `low_on_legs_test`, E2E database `low_on_legs_e2e_test`. Stop the temporary cluster before ending the machine session.
- Final Task 5 verification: unit 50/50, integration 35/35, league E2E 2/2, all player scenarios passed in the preceding full run, typecheck/lint/build clean. Report: `task-5-report.md`.
- Implemented Task 6: Migration005, structural tennis results, MatchRevision history, atomic record/correction, classic completion and 5/0 or 4/2 standings. Fast4, normal sets, STB exclusion from games and mobile correction are covered. Report: `task-6-report.md`.
- Implemented Task 7: one pure `calculateElo`/`replayElo` implementation for append and future worker replay, including doubles averages, half-away-from-zero rounding, individual floor 500 and chronological replay. Report: `task-7-report.md`.
- Implemented Task 8: Migration006, complete immutable Elo publications, atomic pointer swap, monotonic match time, snapshot K, synchronous append when current, queued latest revision when stale, member join and ranking UI. Report: `task-8-report.md`.
- Implemented Task 9: Elo corrections and soft delete, coalescing recoverable job queue, fenced worker claim/snapshot/publish/retry loop, heartbeats and worker race tests. Report: `task-9-report.md`.
- Implemented Task 10: consistent ranking and match calculation DTOs, no-store Elo status endpoint, visible-card polling, stale-version notices, Elo correction/delete UI and query tests. Report: `task-10-report.md`.
- Current verification before Task 11: unit 70/70, integration 58/58, worker typecheck, typecheck, lint, schema-drift check and production build green; the initial E2E rerun was blocked until Chromium was installed locally.
- Task 11 verification: unit 72/72, integration 60/60, E2E 12/12 after installing Chromium into ignored `browsers/`, worker typecheck, typecheck, lint and production build green.
