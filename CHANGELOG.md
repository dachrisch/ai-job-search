# Changelog

## [0.2.5](https://github.com/dachrisch/ai-job-search/compare/v0.2.4...v0.2.5) (2026-06-15)


### Bug Fixes

* **deploy:** add egress network to crawler for internet access ([46bd185](https://github.com/dachrisch/ai-job-search/commit/46bd1857d45d431825b55c94d3ba0cf0e862dd3d))

## [0.2.4](https://github.com/dachrisch/ai-job-search/compare/v0.2.3...v0.2.4) (2026-06-15)


### Bug Fixes

* **deps:** update dependency python-dotenv to v1.2.2 ([be64178](https://github.com/dachrisch/ai-job-search/commit/be641782dfe7ca63f587326a0f968749d6669536))
* **deps:** update dependency python-dotenv to v1.2.2 ([63b044b](https://github.com/dachrisch/ai-job-search/commit/63b044b2f28aa0246f0c2f46bea7e313ce2a9954))
* **deps:** update dependency requests to v2.34.2 ([c6f6826](https://github.com/dachrisch/ai-job-search/commit/c6f6826adde8c598d8ec862c79291d4cfa776a1e))
* **deps:** update dependency requests to v2.34.2 ([41206c8](https://github.com/dachrisch/ai-job-search/commit/41206c8a75a19bb9550c71958cadd53bbe67dfcd))
* run Scrapy crawls in subprocess to avoid ReactorNotRestartable ([6a28ab0](https://github.com/dachrisch/ai-job-search/commit/6a28ab01804905b90bce3e08b992631fc31fd782))

## [0.2.3](https://github.com/dachrisch/ai-job-search/compare/v0.2.2...v0.2.3) (2026-06-15)


### Bug Fixes

* **deps:** update dependency redis to v5.3.1 ([3e32d75](https://github.com/dachrisch/ai-job-search/commit/3e32d7512c8608a3e78a123bbc81a89bd9da9996))
* **deps:** update dependency redis to v5.3.1 ([de66525](https://github.com/dachrisch/ai-job-search/commit/de66525abc2a82da566c6d163a46befb1266ab67))
* **deps:** update python docker tag to v3.14 ([09f369e](https://github.com/dachrisch/ai-job-search/commit/09f369e84814cec5e9420f38dc7a8eaaab153233))
* **deps:** update python docker tag to v3.14 ([6ca6dd1](https://github.com/dachrisch/ai-job-search/commit/6ca6dd1795c50f3c2972cd29a76131acbb2b6ddd))

## [0.2.2](https://github.com/dachrisch/ai-job-search/compare/v0.2.1...v0.2.2) (2026-06-15)


### Bug Fixes

* **deps:** update dependency beautifulsoup4 to v4.15.0 ([#6](https://github.com/dachrisch/ai-job-search/issues/6)) ([a8645ee](https://github.com/dachrisch/ai-job-search/commit/a8645eef74312eabd24365b0e8438446bfa4d91c))
* **deps:** update dependency flask to v3.1.3 ([#7](https://github.com/dachrisch/ai-job-search/issues/7)) ([32a6cd6](https://github.com/dachrisch/ai-job-search/commit/32a6cd6a728fed30cd54643db71449e05a468f05))
* **deps:** update dependency mongodb-memory-server to v11.2.0 ([#9](https://github.com/dachrisch/ai-job-search/issues/9)) ([4b49815](https://github.com/dachrisch/ai-job-search/commit/4b49815f4c13bf22b2e898a24bc28476fa847c15))

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
