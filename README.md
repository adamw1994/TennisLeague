# 🎾 TennisLeague

**Organize the league. Record the match. Follow the rankings.**

![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)

TennisLeague is a full-stack application for amateur tennis leagues. Create a competition, manage players, record singles or doubles results, and track standings throughout the season. Choose a traditional round-robin league or an ongoing Elo league where rankings evolve with every match.

The application currently uses **Low on Legs** branding and a Polish-language interface.

## Features

- **Two league formats** — classic leagues with generated round-robin fixtures and optional return matches, or ongoing leagues with Elo rankings.
- **Singles and doubles** — individual competition and team matches, including fixed pairs in classic doubles leagues.
- **Tennis score validation** — support for standard sets, Fast4, and deciding super tie-breaks.
- **Player profiles** — manage players, upload avatars, and explore individual statistics.
- **Standings and match history** — browse fixtures, results, league tables, and rankings.
- **Result corrections** — edit recorded scores, retain match revisions, and recalculate affected Elo rankings in the background.
- **Record recovery** — soft deletion and administrative recovery tools for players, leagues, and matches.

## Tech Stack

| Layer | Technologies |
| --- | --- |
| Application | Next.js 16 App Router, React 19, TypeScript |
| Backend | Node.js 24, Server Actions, Route Handlers |
| Database | PostgreSQL 18, MikroORM 7, versioned migrations |
| Validation and images | Zod, Sharp |
| Background processing | Dedicated Elo worker with a database-backed job queue |
| Testing | Vitest, Playwright |
| Infrastructure | Docker, Docker Compose |

## Engineering Highlights

- **Deterministic scheduling and ratings:** repeatable round-robin generation and Elo replay from match history.
- **Concurrent updates:** transactions, version checks, and idempotency handling protect mutations from stale edits and duplicate submissions.
- **Background recalculation:** a separate worker processes Elo jobs and publishes updated rankings after corrections.
- **Layered domain code:** player, league, match, scoring, and ranking logic live in dedicated modules.
- **Operational tooling:** separate migrations, application and worker health checks, recovery commands, and a benchmark script.

## Run Locally with Docker

### 1. Configure the environment

Install Docker with Docker Compose and start Docker Desktop if you use Windows. Copy `.env.example` to `.env` in the repository root.

Set these values in `.env`:

| Variable | Local configuration |
| --- | --- |
| `POSTGRES_PASSWORD` | Choose a strong password. |
| `DATABASE_URL` | Use host `db`, port `5432`, and the same database credentials as the `POSTGRES_*` values. Percent-encode special characters in the URL password. |
| `CLIENT_KEY_HMAC_SECRET` | Set a long, randomly generated secret. |
| `APP_ORIGIN` | `http://localhost:3000` |

Keep `.env` local; it is excluded from Git.

### 2. Publish the local port

The base Compose configuration exposes port 3000 only within the container network. Create a local `compose.override.yaml`:

```yaml
services:
  app:
    ports:
      - "127.0.0.1:3000:3000"
```

This local override is excluded from Git. Docker Compose loads it automatically with `compose.yaml` when using the commands below.

### 3. Build and start

```bash
docker build -t low-on-legs:local .
docker compose up -d
```

Open **[http://localhost:3000](http://localhost:3000)**.

Compose starts PostgreSQL, runs the migrations, and then starts the web application and Elo worker. The `migrate` service exiting successfully is expected. Database records and player avatars are stored in PostgreSQL, backed by a named Docker volume.

### Useful commands

```bash
# Check service status
docker compose ps

# Follow application and worker logs
docker compose logs -f app worker migrate

# Stop the services while preserving the database volume
docker compose down
```

## Development and Tests

Use Node.js 24; the repository pins a version in `.nvmrc`.

```bash
npm ci
npm run typecheck
npm run lint
npm run test:unit
```

Integration tests require a separate PostgreSQL test database and `TEST_DATABASE_URL`. Browser tests require `E2E_DATABASE_URL` pointing to a dedicated database whose name ends in `_e2e_test`; their setup resets that database. See the [acceptance guide](docs/acceptance.md) for environment setup and verification procedures.

```bash
npm run test:integration
npm run test:e2e
npm run build
npm run build:runtime
```

The repository includes tests for scoring rules, schedules, standings, Elo calculations, concurrent mutations, recovery, and browser workflows. These commands describe the available checks, not a claim that they pass in every environment.

## Project Structure

```text
src/
├── app/          # Pages, layouts, Server Actions, and API routes
├── components/   # Forms, tables, and shared UI
├── db/           # ORM setup, entities, and migrations
├── modules/      # Players, leagues, matches, tennis rules, Elo, and statistics
├── shared/       # Validation, errors, mutation handling, and rate limits
└── workers/elo/  # Background ranking recalculation

tests/            # Unit, integration, and end-to-end tests
scripts/          # Benchmarks, container checks, and record recovery
docs/             # Specifications and operational documentation
```

## Documentation

- [Base specification](docs/base-specification.md)
- [Detailed specification](docs/detailed-specification.md)
- [Operations, backups, and recovery](docs/operations.md)
- [Acceptance and test procedures](docs/acceptance.md)

The MVP has no user accounts or role-based access control. Use a trusted environment or add access controls before making a writable deployment public. See the operations guide for deployment requirements.
