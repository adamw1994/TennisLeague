# Task 7 implementer report

## Status

DONE — the shared Elo domain engine is complete and has no database dependency.

## Implemented

- Added `calculateElo(sides, ratings, winner, k)` for singles and doubles.
- Doubles use both pre-match side averages before any player is updated. Partners receive the same calculated side delta, while the rating floor is applied individually.
- Added half-away-from-zero rounding, K validation from 10 through 60, starting rating 1000 and hard floor 500.
- Added `replayElo(memberIds, matches)`, which initializes every member, sorts a copy by immutable result time and match id, and returns complete ratings, events, played counts and actual last deltas.
- Added invariant checks for duplicate players, uneven sides, unknown members, invalid ratings, duplicate matches and invalid timestamps.

## Verification

- 17 focused Elo/replay tests cover equal ratings at K=31, K boundaries, the 500 floor, doubles, input immutability, deterministic order, same-time tie-breaking, historical corrections, later-added members and idle members.
- The same calculator is exercised by Task 8 incremental publications and full replay comparison.
