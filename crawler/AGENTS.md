# AGENTS.md — crawler/

A standalone Python component (Scrapy + Flask), not one of the npm workspaces. Dependencies are pinned in `requirements.txt`; the Docker image builds from `Dockerfile` (CI job `docker-image-crawler`). The service and CLI import modules as top-level names (`cli`, `models`, `config`), so run commands **from this directory**.

## Commands

```bash
python3 -m pip install -r requirements.txt                  # install dependencies
python3 -m pytest                                          # run tests in tests/
python3 server.py                                          # Flask HTTP service; GET /health
python3 cli.py <domain> [more domains] [--keywords "..."]  # one-off crawl
```

## Rules

- The service listens on `CRAWLER_PORT` (`config.py` default 8000; `scripts/dev-startup.sh` sets 5000). Start it **before** the Node API — API searches fail with a connection-refused error when the crawler is down.
- `scrapy.cfg` points to `job_crawler.settings`. Spiders live in `job_crawler/spiders/`, site adapters in `job_crawler/adapters/` with a registry (`registry.py`, `find_adapter`). Check the registry and existing adapters before adding a new one; the generic spider is the fallback.
- `crawler.log`, `.crawler.pid`, `__pycache__/` and `.pytest_cache/` are runtime/test artifacts — do not commit them.
- For the full dev environment (MongoDB/Redis on servyy-test.lxd, start order, env vars), use the [job-search-dev-startup skill](../.claude/skills/job-search-dev-startup/SKILL.md) rather than starting pieces by hand.
