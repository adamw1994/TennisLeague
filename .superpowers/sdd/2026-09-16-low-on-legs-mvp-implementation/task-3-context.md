# Tennis task handoff

Read task-3-brief.md first; it is the exact requirements. Shared-requirements.md binds formats, scoring, DTO and architecture. environment.md supplies tool paths; this pure task needs no database.

Task2 provides `DomainError` in src/shared/errors.ts, importable without ORM/Next; it includes `INVALID_TENNIS_SCORE`. Return field paths such as sets.2.sideB in DomainError.fields. Shared Side is in contracts.ts. Zod is installed; all object boundaries must reject unexpected fields, including nested set objects. Do not rely only on TypeScript types to reject malicious runtime input.

Preserve exact TennisScore/TennisProjection and validateScore contract. Numeric domain logic must not import Next or ORM. Normalizing a two-set deciding format to null should not mutate the caller's input; report how later persistence can obtain validated normalized score data without independently reimplementing tennis rules. No match persistence or UI in this task.

Follow TDD, report RED/GREEN evidence in task-3-report.md, run required tennis/typecheck checks, self-review and commit task scope. No subagents. Task2 transport and token helpers are outside this task; do not redesign them.
