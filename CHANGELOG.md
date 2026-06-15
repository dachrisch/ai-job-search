# Changelog

## [0.2.1](https://github.com/dachrisch/ai-job-search/compare/v0.2.0...v0.2.1) (2026-06-15)


### Bug Fixes

* **deps:** replace dependency npm-run-all with npm-run-all2 ^5.0.0 ([#3](https://github.com/dachrisch/ai-job-search/issues/3)) ([fe50d0d](https://github.com/dachrisch/ai-job-search/commit/fe50d0d1f77afadde3cd6620e0b0b8c82030a146))
* send searchId and correct timeout units to crawler service ([596cd82](https://github.com/dachrisch/ai-job-search/commit/596cd82228bd24015b5a3baa8832c563ba62036e))

## [0.2.0](https://github.com/dachrisch/ai-job-search/compare/v0.1.1...v0.2.0) (2026-06-14)


### Features

* add footer with version number and tagline to all pages ([625f964](https://github.com/dachrisch/ai-job-search/commit/625f964483a3cdc65cc75f92f18f4896f93c09f5))


### Bug Fixes

* add vite-env.d.ts to resolve ImportMeta.env TS error in Footer ([8e846e2](https://github.com/dachrisch/ai-job-search/commit/8e846e2dccdbd21a3dc97c9c5300133464acf5d3))
* **deps:** update dependency @anthropic-ai/sdk to ^0.104.0 ([e9a0411](https://github.com/dachrisch/ai-job-search/commit/e9a0411f60d7bcc7ad87fdecf66a7364c7eebfd7))
* **deps:** update dependency @anthropic-ai/sdk to ^0.104.0 ([cec436f](https://github.com/dachrisch/ai-job-search/commit/cec436f78cefad9be542eaa5bdd88561b4624c54))
* update lastRequestTime after fn() completes to ensure accurate rate limiting ([2e79574](https://github.com/dachrisch/ai-job-search/commit/2e79574a18a3f0f7ab95a0e0bda6c9a27f0d3f0d))
* upsert companies by URL to avoid duplicate key crash on re-search ([4b272fa](https://github.com/dachrisch/ai-job-search/commit/4b272fa2513a4cc20018bf7a3e4e9d3c5e25d697))

## [0.1.1](https://github.com/dachrisch/ai-job-search/compare/v0.1.0...v0.1.1) (2026-06-14)


### Bug Fixes

* add missing crawl_company event handler to drive company crawling ([f0eba2e](https://github.com/dachrisch/ai-job-search/commit/f0eba2e063a4ac894cdc7c5cb96a2b83b4dbc41e))
