# Task 2 handoff notes

Read task-2-brief.md first: it is the task requirements, including exact interfaces. Read shared-requirements.md for binding constraints, limits, contracts and transport clarifications. See environment.md for tools and test database.

Task 1 owns the existing configuration, entity/migration registration, ORM and test helpers; extend these rather than replacing them. Keep DomainError importable without ORM or Next runtime dependencies. Services get an explicit EntityManager; request transport handles shared rate limiting separately before expensive resource transactions. The native database supports real concurrency tests with independent forks; use barriers, not sleep.

Ruling: Task 2 establishes server primitives and validation; wire browser token lifetime into the concrete forms introduced by Task 4 and later. No placeholder player/league UI is required here. Carry this obligation into the report so those forms preserve the token across uncertain network responses and clear it only after confirmed success or a deliberate new operation.

Ruling: lower-level once accepts arbitrary strings (the brief tests token-1); transport schemas enforce UUID tokens. Normalization precedes canonical hashing, preserving array order. Check transaction context so the primitive cannot accidentally persist a token outside its protected resource transaction.

Installed Next types expose experimental.serverActions.bodySizeLimit and allowedOrigins. Inspect installed source/types for exact accepted host/origin format; do not blindly put full URLs into a host-pattern option. APP_ORIGIN has no wildcard. No real product mutations exist until Task 4; provide reusable HTTP guards now and explicitly note future integration requirements.

Stable future domain codes appear in docs/detailed-specification.md section 25 (around lines 996–1014). Implement only what this task needs and preserve extension for later task-specific codes.

Follow TDD and skill implementer-prompt.md: implement, focused tests while iterating, final relevant suite/checks once, self-review, commit only task files, full task-2-report.md with commands/output and RED/GREEN evidence. No subagents. Return only status, commit(s), one-line verification and concerns.
