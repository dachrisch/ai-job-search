# CI Docker Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, health-test, and push Docker images for all three services (api, frontend, crawler) in CI using reusable GitHub Actions workflows, following the pattern from `groceries-order-tracking`.

**Architecture:** Three reusable `part_docker_*.yaml` workflows handle build, test, and push phases independently. `ci.yml` (branch/PR) orchestrates build+test without push. `ci_tag.yaml` (tag push) orchestrates build+test+push. Images are passed between jobs as GitHub Actions tar artifacts to avoid rebuilding.

**Tech Stack:** GitHub Actions, Docker buildx, `docker/build-push-action@v6`, `docker/metadata-action@v5`, `docker/login-action@v3`, `actions/upload-artifact@v4`, `actions/download-artifact@v4`

---

## Files Changed

| File | Action |
|---|---|
| `crawler/server.py` | Add `GET /health` route |
| `crawler/Dockerfile` | Pin Python to 3.12-slim, add HEALTHCHECK |
| `packages/api/Dockerfile` | Fix build step, add HEALTHCHECK |
| `packages/frontend/Dockerfile` | Rewrite: multi-stage node→nginx |
| `.dockerignore` | Add `.git` entry |
| `.github/workflows/part_docker_build.yaml` | New reusable build workflow |
| `.github/workflows/part_docker_test.yaml` | New reusable health-test workflow |
| `.github/workflows/part_docker_push_artifact.yaml` | New reusable push workflow |
| `.github/workflows/ci.yml` | Add `tags-ignore`, add 6 docker build+test jobs |
| `.github/workflows/ci_tag.yaml` | New tag-triggered build+test+push workflow |

---

## Task 1: Add `/health` endpoint to crawler

**Files:**
- Modify: `crawler/server.py`

- [ ] **Step 1: Add the health route** — insert after `app = Flask(__name__)` and before the first `@app.route`:

```python
@app.route('/health')
def health():
    return jsonify({'status': 'ok'})
```

- [ ] **Step 2: Verify locally**

```bash
cd /home/cda/dev/job-search
python -c "
import subprocess, time, urllib.request, sys
p = subprocess.Popen(['python', 'crawler/server.py'], cwd='.')
time.sleep(2)
try:
    r = urllib.request.urlopen('http://localhost:8000/health')
    print('Status:', r.status, r.read())
finally:
    p.terminate()
"
```
Expected: `Status: 200 b'{\"status\": \"ok\"}'`

- [ ] **Step 3: Commit**

```bash
git add crawler/server.py
git commit -m "feat: add /health endpoint to crawler"
```

---

## Task 2: Update crawler Dockerfile

**Files:**
- Modify: `crawler/Dockerfile`

- [ ] **Step 1: Update the Dockerfile** — replace the entire file:

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY crawler/requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY crawler/ .

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["python", "server.py"]
```

Changes from original: `python:3.14-slim` → `python:3.12-slim` (3.14 is pre-release); added `HEALTHCHECK`.

- [ ] **Step 2: Build and verify locally**

```bash
cd /home/cda/dev/job-search
docker build -f crawler/Dockerfile -t job-search-crawler:test .
docker run --rm -d --name crawler-test job-search-crawler:test
# Wait for healthcheck (up to 60s)
for i in {1..10}; do
  status=$(docker inspect --format='{{.State.Health.Status}}' crawler-test 2>/dev/null)
  echo "Attempt $i: $status"
  [ "$status" = "healthy" ] && break
  sleep 6
done
docker stop crawler-test
```
Expected: status reaches `healthy` within 10 attempts.

- [ ] **Step 3: Commit**

```bash
git add crawler/Dockerfile
git commit -m "fix: pin crawler to python:3.12-slim and add HEALTHCHECK"
```

---

## Task 3: Update API Dockerfile

**Files:**
- Modify: `packages/api/Dockerfile`

**Note:** The existing `RUN npm run build` is broken for standalone Docker builds — the root `package.json` has no `build` script. Fix: use workspace-scoped builds. The `shared` package must be built first because `@job-search/api` imports from `@job-search/shared` whose `main` resolves to `dist/index.js`.

- [ ] **Step 1: Update the Dockerfile** — replace the entire file:

```dockerfile
FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/api/package.json ./packages/api/
COPY packages/shared/package.json ./packages/shared/

RUN npm install

COPY packages/api/ ./packages/api/
COPY packages/shared/ ./packages/shared/

RUN npm run build --workspace=@job-search/shared
RUN npm run build --workspace=@job-search/api

HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "packages/api/dist/index.js"]
```

- [ ] **Step 2: Build and verify locally** (requires MongoDB + Redis on servyy-test.lxd)

```bash
cd /home/cda/dev/job-search
docker build -f packages/api/Dockerfile -t job-search-api:test .
docker run --rm -d --name api-test \
  -e MONGODB_URI=mongodb://10.185.182.250:27017/test \
  -e REDIS_URL=redis://10.185.182.250:6379 \
  -e JWT_SECRET=test-secret \
  -e CLAUDE_API_KEY=dummy \
  -p 3000:3000 \
  job-search-api:test
for i in {1..10}; do
  status=$(docker inspect --format='{{.State.Health.Status}}' api-test 2>/dev/null)
  echo "Attempt $i: $status"
  [ "$status" = "healthy" ] && break
  sleep 6
done
docker stop api-test
```
Expected: status reaches `healthy`.

- [ ] **Step 3: Commit**

```bash
git add packages/api/Dockerfile
git commit -m "fix: repair api Dockerfile build step and add HEALTHCHECK"
```

---

## Task 4: Rewrite frontend Dockerfile (multi-stage production)

**Files:**
- Modify: `packages/frontend/Dockerfile`

**Note:** The existing Dockerfile runs `npm run dev` (Vite dev server). For production Docker images we need a built static site served by nginx. The `shared` package must be compiled first since frontend imports from it.

- [ ] **Step 1: Replace the entire Dockerfile**:

```dockerfile
FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/shared/package.json ./packages/shared/

RUN npm install

COPY packages/frontend/ ./packages/frontend/
COPY packages/shared/ ./packages/shared/

RUN npm run build --workspace=@job-search/shared
RUN npm run build --workspace=@job-search/frontend

FROM nginx:alpine

COPY --from=builder /app/packages/frontend/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:80 || exit 1

CMD ["nginx", "-g", "daemon off;"]
```

- [ ] **Step 2: Build and verify locally**

```bash
cd /home/cda/dev/job-search
docker build -f packages/frontend/Dockerfile -t job-search-frontend:test .
docker run --rm -d --name frontend-test -p 8080:80 job-search-frontend:test
for i in {1..10}; do
  status=$(docker inspect --format='{{.State.Health.Status}}' frontend-test 2>/dev/null)
  echo "Attempt $i: $status"
  [ "$status" = "healthy" ] && break
  sleep 6
done
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080
docker stop frontend-test
```
Expected: HEALTHCHECK reaches `healthy`; curl returns `200`.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/Dockerfile
git commit -m "feat: rewrite frontend Dockerfile as multi-stage nginx production build"
```

---

## Task 5: Update .dockerignore

**Files:**
- Modify: `.dockerignore`

- [ ] **Step 1: Add `.git` to the existing `.dockerignore`**

Current content already has `node_modules/`, `dist/`, `build/`, `.env`, `.DS_Store`, `*.log`, `__pycache__/`, `.venv/`. Add:

```
.git
```

Append it as the last line of `/home/cda/dev/job-search/.dockerignore`.

- [ ] **Step 2: Commit**

```bash
git add .dockerignore
git commit -m "chore: add .git to .dockerignore"
```

---

## Task 6: Create `part_docker_build.yaml` reusable workflow

**Files:**
- Create: `.github/workflows/part_docker_build.yaml`

- [ ] **Step 1: Create the file**:

```yaml
# yaml-language-server: $schema=https://json.schemastore.org/github-workflow.json

name: 🐳🏗️ Build Docker Image

on:
  workflow_call:
    inputs:
      dockerfile:
        required: false
        description: Path to the Dockerfile (relative to repo root)
        type: string
        default: Dockerfile
      image_name:
        required: true
        description: Local image name used for the tar artifact
        type: string
      version:
        required: false
        description: Version string (embedded as VITE_BUILD_VERSION build arg)
        type: string
        default: "dev"
    outputs:
      artifact_name:
        description: Name of the uploaded GitHub Actions artifact containing the Docker image tar
        value: ${{ jobs.build.outputs.artifact_name }}

permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      artifact_name: ${{ steps.set-artifact-name.outputs.artifact_name }}
    steps:
      - uses: actions/checkout@v4

      - name: 🐳🛠️ Setup Docker buildx
        uses: docker/setup-buildx-action@v3

      - name: 🐳🏗️ Build Docker image
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ${{ inputs.dockerfile }}
          tags: ${{ inputs.image_name }}:latest
          outputs: type=docker,dest=/tmp/${{ inputs.image_name }}.tar
          cache-from: type=gha
          cache-to: type=gha,mode=max
          build-args: |
            VITE_BUILD_VERSION=${{ inputs.version }}

      - name: 📤 Upload Docker image as artifact
        uses: actions/upload-artifact@v4
        with:
          name: docker-image-${{ inputs.image_name }}
          path: /tmp/${{ inputs.image_name }}.tar
          retention-days: 1

      - name: 🏷️ Set artifact name output
        id: set-artifact-name
        run: echo "artifact_name=docker-image-${{ inputs.image_name }}" >> $GITHUB_OUTPUT
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/part_docker_build.yaml
git commit -m "ci: add reusable docker build workflow"
```

---

## Task 7: Create `part_docker_test.yaml` reusable workflow

**Files:**
- Create: `.github/workflows/part_docker_test.yaml`

- [ ] **Step 1: Create the file**:

```yaml
# yaml-language-server: $schema=https://json.schemastore.org/github-workflow.json

name: 🐳🧪 Test Docker Image

on:
  workflow_call:
    inputs:
      artifact_name:
        required: true
        description: Name of the artifact containing the Docker image tar
        type: string
      image_name:
        required: true
        description: Local name of the Docker image (matches the tar filename)
        type: string
      env_vars:
        required: false
        description: Space-separated "-e KEY=VALUE" pairs passed to docker run
        type: string
        default: ""

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      mongodb:
        image: mongo:8.3
        ports:
          - 27017:27017
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
    steps:
      - name: 📥 Download Docker image artifact
        uses: actions/download-artifact@v4
        with:
          name: ${{ inputs.artifact_name }}
          path: /tmp

      - name: 🐳 Load Docker image
        run: |
          docker load --input /tmp/${{ inputs.image_name }}.tar
          docker image ls -a

      - name: 🐳🧪 Test Docker image health
        run: |
          docker run --rm --detach --name test_container \
            --add-host=host.docker.internal:host-gateway \
            ${{ inputs.env_vars }} \
            ${{ inputs.image_name }}:latest
          for i in {1..10}; do
            status=$(docker inspect --format='{{.State.Health.Status}}' test_container)
            health_details=$(docker inspect --format='{{json .State.Health}}' test_container)
            echo "Attempt $i — Health status: $status"
            echo "Health details: $health_details"
            if [ "$status" = "healthy" ]; then break; fi
            sleep 6
          done
          if [ "$status" != "healthy" ]; then
            echo "❌ Container did not become healthy after 10 attempts."
            docker logs test_container
            exit 1
          fi
          echo "✅ Container is healthy"
          docker stop test_container
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/part_docker_test.yaml
git commit -m "ci: add reusable docker health-test workflow"
```

---

## Task 8: Create `part_docker_push_artifact.yaml` reusable workflow

**Files:**
- Create: `.github/workflows/part_docker_push_artifact.yaml`

- [ ] **Step 1: Create the file**:

```yaml
# yaml-language-server: $schema=https://json.schemastore.org/github-workflow.json

name: 🐳🚀 Push Docker Image to Registry

on:
  workflow_call:
    inputs:
      artifact_name:
        required: true
        description: Name of the artifact containing the Docker image tar
        type: string
      image_name:
        required: true
        description: Full registry path e.g. dachrisch/job-search-api
        type: string
      local_image_name:
        required: true
        description: Local image name used when loading the tar (matches tar filename)
        type: string
    secrets:
      DOCKER_TOKEN:
        required: true
        description: Docker Hub access token for dachrisch

permissions:
  contents: read

env:
  REGISTRY: docker.io

jobs:
  push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: 📥 Download Docker image artifact
        uses: actions/download-artifact@v4
        with:
          name: ${{ inputs.artifact_name }}
          path: /tmp

      - name: 🐳 Load Docker image
        run: |
          docker load --input /tmp/${{ inputs.local_image_name }}.tar
          docker image ls -a

      - name: 🔐 Log into Docker Hub
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.DOCKER_TOKEN }}

      - name: 🏷️ Extract Docker metadata (semver tags)
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ inputs.image_name }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=semver,pattern={{major}}
            type=raw,value=latest

      - name: 🐳🏷️ Tag Docker image
        run: |
          while IFS= read -r tag; do
            [ -z "$tag" ] && continue
            docker tag ${{ inputs.local_image_name }}:latest "$tag"
            echo "Tagged: $tag"
          done <<< "${{ steps.meta.outputs.tags }}"

      - name: 🐳🚀 Push Docker image
        run: |
          while IFS= read -r tag; do
            [ -z "$tag" ] && continue
            docker push "$tag"
            echo "Pushed: $tag"
          done <<< "${{ steps.meta.outputs.tags }}"
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/part_docker_push_artifact.yaml
git commit -m "ci: add reusable docker push workflow with semver tagging"
```

---

## Task 9: Extend `ci.yml` with docker build + test jobs

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add `tags-ignore` to the push trigger** — change the `on:` block from:

```yaml
on:
  push:
    branches: [master, main]
  pull_request:
    branches: [master, main]
```

to:

```yaml
on:
  push:
    branches: [master, main]
    tags-ignore:
      - "v*"
  pull_request:
    branches: [master, main]
```

- [ ] **Step 2: Add 6 docker jobs** — append the following after the existing `ci-status` job:

```yaml
  docker-image-api:
    needs: [test, lint]
    uses: ./.github/workflows/part_docker_build.yaml
    with:
      dockerfile: packages/api/Dockerfile
      image_name: job-search-api

  docker-image-frontend:
    needs: [test, lint]
    uses: ./.github/workflows/part_docker_build.yaml
    with:
      dockerfile: packages/frontend/Dockerfile
      image_name: job-search-frontend

  docker-image-crawler:
    needs: [test, lint]
    uses: ./.github/workflows/part_docker_build.yaml
    with:
      dockerfile: crawler/Dockerfile
      image_name: job-search-crawler

  image-test-api:
    needs: [docker-image-api]
    uses: ./.github/workflows/part_docker_test.yaml
    with:
      artifact_name: ${{ needs.docker-image-api.outputs.artifact_name }}
      image_name: job-search-api
      env_vars: >-
        -e MONGODB_URI=mongodb://host.docker.internal:27017/test
        -e REDIS_URL=redis://host.docker.internal:6379
        -e CLAUDE_API_KEY=ci-dummy
        -e JWT_SECRET=ci-test-secret

  image-test-frontend:
    needs: [docker-image-frontend]
    uses: ./.github/workflows/part_docker_test.yaml
    with:
      artifact_name: ${{ needs.docker-image-frontend.outputs.artifact_name }}
      image_name: job-search-frontend

  image-test-crawler:
    needs: [docker-image-crawler]
    uses: ./.github/workflows/part_docker_test.yaml
    with:
      artifact_name: ${{ needs.docker-image-crawler.outputs.artifact_name }}
      image_name: job-search-crawler
```

- [ ] **Step 3: Update `ci-status` to include docker test jobs** — change:

```yaml
  ci-status:
    name: CI Status
    runs-on: ubuntu-latest
    needs: [test, lint]
    if: always()
```

to:

```yaml
  ci-status:
    name: CI Status
    runs-on: ubuntu-latest
    needs: [test, lint, image-test-api, image-test-frontend, image-test-crawler]
    if: always()
```

And update the failure check:

```yaml
      - name: Check CI status
        run: |
          if [ "${{ needs.test.result }}" = "failure" ] || \
             [ "${{ needs.lint.result }}" = "failure" ] || \
             [ "${{ needs.image-test-api.result }}" = "failure" ] || \
             [ "${{ needs.image-test-frontend.result }}" = "failure" ] || \
             [ "${{ needs.image-test-crawler.result }}" = "failure" ]; then
            echo "❌ CI failed"
            exit 1
          else
            echo "✅ CI passed"
          fi
```

- [ ] **Step 4: Validate YAML syntax**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo "YAML valid"
```
Expected: `YAML valid`

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: extend ci.yml with docker build and health-test jobs for all services"
```

---

## Task 10: Create `ci_tag.yaml` — tag-triggered build+test+push

**Files:**
- Create: `.github/workflows/ci_tag.yaml`

- [ ] **Step 1: Create the file**:

```yaml
# yaml-language-server: $schema=https://json.schemastore.org/github-workflow.json

name: 🐳🏗️🧪🚀 Build, Test and Deploy Docker images

on:
  push:
    tags:
      - "v*"

permissions:
  contents: read

concurrency:
  group: docker-deploy
  cancel-in-progress: true

jobs:
  docker-image-api:
    uses: ./.github/workflows/part_docker_build.yaml
    with:
      dockerfile: packages/api/Dockerfile
      image_name: job-search-api
      version: "${{ github.ref_name }}"

  docker-image-frontend:
    uses: ./.github/workflows/part_docker_build.yaml
    with:
      dockerfile: packages/frontend/Dockerfile
      image_name: job-search-frontend
      version: "${{ github.ref_name }}"

  docker-image-crawler:
    uses: ./.github/workflows/part_docker_build.yaml
    with:
      dockerfile: crawler/Dockerfile
      image_name: job-search-crawler
      version: "${{ github.ref_name }}"

  image-test-api:
    needs: [docker-image-api]
    uses: ./.github/workflows/part_docker_test.yaml
    with:
      artifact_name: ${{ needs.docker-image-api.outputs.artifact_name }}
      image_name: job-search-api
      env_vars: >-
        -e MONGODB_URI=mongodb://host.docker.internal:27017/test
        -e REDIS_URL=redis://host.docker.internal:6379
        -e CLAUDE_API_KEY=ci-dummy
        -e JWT_SECRET=ci-test-secret

  image-test-frontend:
    needs: [docker-image-frontend]
    uses: ./.github/workflows/part_docker_test.yaml
    with:
      artifact_name: ${{ needs.docker-image-frontend.outputs.artifact_name }}
      image_name: job-search-frontend

  image-test-crawler:
    needs: [docker-image-crawler]
    uses: ./.github/workflows/part_docker_test.yaml
    with:
      artifact_name: ${{ needs.docker-image-crawler.outputs.artifact_name }}
      image_name: job-search-crawler

  image-push-api:
    needs: [docker-image-api, image-test-api]
    secrets: inherit
    uses: ./.github/workflows/part_docker_push_artifact.yaml
    with:
      artifact_name: ${{ needs.docker-image-api.outputs.artifact_name }}
      image_name: dachrisch/job-search-api
      local_image_name: job-search-api

  image-push-frontend:
    needs: [docker-image-frontend, image-test-frontend]
    secrets: inherit
    uses: ./.github/workflows/part_docker_push_artifact.yaml
    with:
      artifact_name: ${{ needs.docker-image-frontend.outputs.artifact_name }}
      image_name: dachrisch/job-search-frontend
      local_image_name: job-search-frontend

  image-push-crawler:
    needs: [docker-image-crawler, image-test-crawler]
    secrets: inherit
    uses: ./.github/workflows/part_docker_push_artifact.yaml
    with:
      artifact_name: ${{ needs.docker-image-crawler.outputs.artifact_name }}
      image_name: dachrisch/job-search-crawler
      local_image_name: job-search-crawler
```

- [ ] **Step 2: Validate YAML syntax**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci_tag.yaml'))" && echo "YAML valid"
```
Expected: `YAML valid`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci_tag.yaml
git commit -m "ci: add tag-triggered docker build, test, and push pipeline"
```

---

## Final Verification

- [ ] **Confirm all YAML files are valid**

```bash
for f in .github/workflows/ci.yml .github/workflows/ci_tag.yaml \
          .github/workflows/part_docker_build.yaml \
          .github/workflows/part_docker_test.yaml \
          .github/workflows/part_docker_push_artifact.yaml; do
  python3 -c "import yaml; yaml.safe_load(open('$f'))" && echo "✅ $f" || echo "❌ $f"
done
```

- [ ] **Confirm DOCKER_TOKEN secret exists in GitHub** (manual check)

Go to `https://github.com/dachrisch/job-search/settings/secrets/actions` and confirm `DOCKER_TOKEN` is listed.

- [ ] **Trigger a branch push to test the branch pipeline** — push current branch to GitHub and confirm the docker build/test jobs appear and pass in the Actions tab.

- [ ] **Trigger a tag push to test the full pipeline**

```bash
git tag v0.1.0
git push origin v0.1.0
```
Confirm `ci_tag.yaml` runs, all images become healthy, and `dachrisch/job-search-api`, `dachrisch/job-search-frontend`, `dachrisch/job-search-crawler` appear on Docker Hub with `:0.1.0`, `:0.1`, `:0`, `:latest` tags.
