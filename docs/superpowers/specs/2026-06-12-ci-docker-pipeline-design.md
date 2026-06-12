# CI Docker Pipeline Design

**Date:** 2026-06-12
**Goal:** Build, health-test, and publish Docker images for all three services as part of CI, following the same pattern used in `groceries-order-tracking`.

---

## Context

The project has three services, each with an existing Dockerfile:
- `packages/api` — Node.js/Express, port 3000, has `GET /api/health`
- `packages/frontend` — React/Vite, currently dev-mode only
- `crawler` — Python/Flask, port 8000, no health endpoint yet

The existing `ci.yml` runs tests and lint on branch/PR pushes but has no Docker building.

---

## Approach

**Option A — extend `ci.yml`** with docker build/test jobs, plus a new `ci_tag.yaml` for tag-triggered push. Reusable `part_docker_*.yaml` workflows handle each phase.

---

## Workflow File Structure

```
.github/workflows/
  ci.yml                          existing — add tag trigger + docker jobs
  ci_tag.yaml                     new — tag-only: build + test + push all 3 services
  part_docker_build.yaml          new reusable — build image → tar → artifact
  part_docker_test.yaml           new reusable — load artifact → run → health poll
  part_docker_push_artifact.yaml  new reusable — load artifact → tag → push to Docker Hub
```

---

## Job Graphs

### Branch / PR (`ci.yml`)

```
test ──┐
       ├──► docker-image-api      → image-test-api
lint ──┤    docker-image-frontend → image-test-frontend
       └──► docker-image-crawler  → image-test-crawler
```

No push. Proves images build and become healthy.

### Tag (`ci_tag.yaml`, triggered on `push: tags: ['v*']`)

```
docker-image-api      → image-test-api      → image-push-api
docker-image-frontend → image-test-frontend → image-push-frontend
docker-image-crawler  → image-test-crawler  → image-push-crawler
```

Tag workflow does not re-run the test suite — tests must pass on the branch before tagging.

---

## Reusable Workflow Specs

### `part_docker_build.yaml`

**Inputs:**
- `dockerfile` (string, default: `Dockerfile`) — path to Dockerfile
- `image_name` (string, required) — local image name used for the tar file
- `version` (string, default: `dev`) — embedded build version

**Outputs:**
- `artifact_name` — name of the uploaded GitHub Actions artifact

**Steps:**
1. `docker/setup-buildx-action`
2. `docker/build-push-action` with `outputs: type=docker,dest=/tmp/<image_name>.tar`, `cache-from/cache-to: type=gha`
3. `actions/upload-artifact` — uploads tar, retention 1 day
4. Sets `artifact_name` output

### `part_docker_test.yaml`

**Inputs:**
- `artifact_name` (string, required)
- `image_name` (string, required)
- `env_vars` (string, optional, default: `""`) — space-separated `-e KEY=VALUE` pairs passed to `docker run`

**Job services:** MongoDB 8.3 + Redis 7-alpine (both always started; harmless overhead for frontend/crawler)

**Steps:**
1. `actions/download-artifact`
2. `docker load --input /tmp/<image_name>.tar`
3. `docker run --rm --detach --add-host=host.docker.internal:host-gateway ${{ inputs.env_vars }} <image>`
4. Poll `docker inspect --format='{{.State.Health.Status}}'` — 10 retries × 6s
5. Fail with `docker logs` output if not healthy; `docker stop` on success

**Env vars passed per service from the caller:**

| Service | `env_vars` input value |
|---|---|
| api | `-e MONGODB_URI=mongodb://host.docker.internal:27017/test -e REDIS_URL=redis://host.docker.internal:6379 -e CLAUDE_API_KEY=ci-dummy -e JWT_SECRET=ci-test-secret` |
| frontend | _(omitted — nginx serves static files)_ |
| crawler | _(omitted — health check needs no external services)_ |

### `part_docker_push_artifact.yaml`

**Inputs:**
- `artifact_name` (string, required)
- `image_name` (string, required) — registry path e.g. `dachrisch/job-search-api`
- `local_image_name` (string, required) — local name from tar
- `version` (string, required) — git tag e.g. `v1.2.3`

**Secrets:** `DOCKER_TOKEN` (Docker Hub access token)

**Steps:**
1. `actions/download-artifact`
2. `docker load`
3. `docker/login-action` → `docker.io` with `github.actor` / `DOCKER_TOKEN`
4. `docker/metadata-action` with `type=semver` — generates `:v1.2.3`, `:v1.2`, `:v1`, `:latest`
5. `docker tag <local_image_name>:latest <registry_tag>` for each tag from metadata-action
6. `docker push` each tag

---

## Dockerfile Changes

### `packages/api/Dockerfile`

Add after the build step:
```dockerfile
HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1
```

Also: switch from `npm install` to `npm ci` for reproducibility, and add a proper `.dockerignore`.

### `packages/frontend/Dockerfile`

Full rewrite — multi-stage production build:
```
Stage 1 (builder): node:24-alpine — npm ci, build static files
Stage 2 (serve):   nginx:alpine   — copy /app/packages/frontend/dist → /usr/share/nginx/html
```

```dockerfile
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:80 || exit 1
```

### `crawler/Dockerfile`

Add healthcheck:
```dockerfile
HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:8000/health || exit 1
```

Switch base to `python:3.12-slim` (3.14 is pre-release).

### `crawler/server.py`

Add health route (before existing routes):
```python
@app.route('/health')
def health():
    return jsonify({'status': 'ok'})
```

---

## Tagging Strategy

On git tag `v1.2.3`, each image is pushed as:
- `dachrisch/job-search-api:v1.2.3`
- `dachrisch/job-search-api:v1.2`
- `dachrisch/job-search-api:v1`
- `dachrisch/job-search-api:latest`

Handled automatically by `docker/metadata-action` with `type=semver` flavor.

Image names:
- `dachrisch/job-search-api`
- `dachrisch/job-search-frontend`
- `dachrisch/job-search-crawler`

---

## Prerequisites

- `DOCKER_TOKEN` secret added to GitHub repo settings (Docker Hub access token for `dachrisch`)
- No other secrets needed (`GITHUB_TOKEN` is automatic for artifact handling)

---

## Files Changed Summary

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | Add `tags-ignore: ['v*']` to push trigger; add 6 docker jobs (build+test per service) after existing jobs |
| `.github/workflows/ci_tag.yaml` | New: 9 jobs (build+test+push per service), tag trigger only |
| `.github/workflows/part_docker_build.yaml` | New reusable workflow |
| `.github/workflows/part_docker_test.yaml` | New reusable workflow |
| `.github/workflows/part_docker_push_artifact.yaml` | New reusable workflow |
| `packages/api/Dockerfile` | Add `HEALTHCHECK`, switch to `npm ci` |
| `packages/frontend/Dockerfile` | Full rewrite: multi-stage nginx production build |
| `crawler/Dockerfile` | Add `HEALTHCHECK`, pin Python to 3.12-slim |
| `crawler/server.py` | Add `GET /health` route |
| `.dockerignore` (root) | New: exclude `node_modules`, `dist`, `.git`, `crawler/__pycache__` |
