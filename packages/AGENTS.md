# AGENTS.md — packages/

Three npm workspaces: `@job-search/api` (Express 5 API, port 3000), `@job-search/frontend` (React 19 + Vite, port 5173) and `@job-search/shared` (TypeScript types). Repo-wide commands are in [../AGENTS.md](../AGENTS.md).

## Rules

- **Build shared first.** After changing anything in `shared/`, rebuild it with `npm run build --workspace=@job-search/shared` (from the repo root). api and frontend import its `dist`, so a stale build hides type changes.
- **API tests.** `cd packages/api && npm test -- --run` for a one-shot run; `npm test` for watch mode. Integration tests (`tests/integration.test.ts`) are skipped unless `RUN_INTEGRATION_TESTS=true`, which also needs a running API server. CI sets `CI=true`, `MONGODB_URI=mongodb://localhost:27017/job_search_test` and `REDIS_URL=redis://localhost:6379`.
- **API typecheck.** `cd packages/api && npx tsc -p tsconfig.typecheck.json`. The build `tsconfig.json` excludes `tests/`, so `npm run build` alone does not typecheck test files — CI added this check after issue #187.
- **Vitest isolation.** `packages/api/vitest.config.ts` sets `isolate: true` deliberately. Do not switch to `isolate: false`: mocked modules leak between test files and results become order-dependent.
- **API build.** `npm run build` runs `tsc` with `NODE_OPTIONS=--max-old-space-size=6144`.
- **Frontend.** `npm run build` runs `tsc && vite build`; `npm test` runs Vitest with jsdom. `VITE_API_URL` targets the API (defaults to `http://localhost:3000`).
- Target one package with `npm run <script> --workspace=@job-search/<name>`; all packages with `--workspaces`.
