# AGENTS.md

## What this repo is

An AI-powered job search platform. This is an npm/TypeScript monorepo (`packages/`) for the Express API, React frontend and shared types, plus a separate Python/Scrapy crawler (`crawler/`) that extracts job listings. An opencode agent drives company discovery, search refinement and ranking; BullMQ/Redis carry events and MongoDB stores users, searches and jobs.

Overview: [README.md](README.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/FEATURES.md](docs/FEATURES.md). Extended developer notes: [CLAUDE.md](CLAUDE.md).

## Component guides

- [packages/AGENTS.md](packages/AGENTS.md) — npm workspaces (`api`, `frontend`, `shared`): build order, tests, typecheck.
- [crawler/AGENTS.md](crawler/AGENTS.md) — Python Scrapy crawler service, CLI and tests.

`scripts/` holds the dev startup/stop helpers (commands below); `docs/` is documentation and `history/` is an archive. None need their own guide.

## Build, test, verify

From the repo root (commands match `package.json` and `.github/workflows/ci.yml`):

```bash
npm ci                                                    # install dependencies
npm run build --workspace=@job-search/shared              # build shared first after type changes
npm run build --workspaces                                # build all packages
cd packages/api && npm test -- --run                      # API tests, one-shot
cd packages/api && npx tsc -p tsconfig.typecheck.json     # typecheck API src + tests
npm run build --workspace=@job-search/frontend            # frontend build (tsc && vite build)
```

Crawler tests are run from `crawler/` — see [crawler/AGENTS.md](crawler/AGENTS.md). CI uses Node 24.x; if other docs disagree with commands, trust the manifests and `.github/workflows/ci.yml`.

Start the full local environment with `./scripts/dev-startup.sh` (`npm run startup`); stop it with `./scripts/dev-stop.sh` (`npm run stop`).

## Safety / policies

- Development and testing use the **servyy-test.lxd** MongoDB and Redis. In-memory databases are not allowed. Follow the [job-search-dev-startup skill](.claude/skills/job-search-dev-startup/SKILL.md) before starting services.
- The crawler service must be running before the API; searches fail with a connection-refused error if it is down.
- Keep secrets (`OPENCODE_API_KEY`, `SEARXNG_TOKEN`, `JWT_SECRET`) in the environment. The app does not reliably read `.env` files — never commit them or any credentials.
- Do not push directly to `master`/`main`; work on a branch and open a PR.
