# Changelog

## [0.5.2](https://github.com/dachrisch/ai-job-search/compare/v0.5.1...v0.5.2) (2026-06-18)


### Bug Fixes

* **search:** filter ATS vendor sites from SearXNG query and blocklist ([ff338e2](https://github.com/dachrisch/ai-job-search/commit/ff338e23e05f94173a9254ca9f034584cac443ab))

## [0.5.1](https://github.com/dachrisch/ai-job-search/compare/v0.5.0...v0.5.1) (2026-06-18)


### Bug Fixes

* **deps:** update dependency @anthropic-ai/sdk to ^0.105.0 ([52dd333](https://github.com/dachrisch/ai-job-search/commit/52dd3330eb453f887ebaab3127f088a55a5ab25a))

## [0.5.0](https://github.com/dachrisch/ai-job-search/compare/v0.4.1...v0.5.0) (2026-06-18)


### Features

* **crawler:** add DjangoFoundationAdapter for foundation/jobs board ([63aed4b](https://github.com/dachrisch/ai-job-search/commit/63aed4b79cb3ce4e0c9372adb1a6657061db2ab0))
* **crawler:** add GreenhouseAdapter with public JSON API ([2f13bf9](https://github.com/dachrisch/ai-job-search/commit/2f13bf905c17a1bb82e1c836c03e6298f3ebc011))
* **crawler:** add HeiseJobsAdapter for jobs.heise.de board ([eb4e121](https://github.com/dachrisch/ai-job-search/commit/eb4e121b3d28679c39302b490142e9c58ff622e6))
* **crawler:** add LeverAdapter with public postings API ([aa05e5e](https://github.com/dachrisch/ai-job-search/commit/aa05e5ed52536d2d2be251aacf863f5fb4750e4b))
* **crawler:** add SmartRecruitersAdapter with offset pagination ([5bf7faa](https://github.com/dachrisch/ai-job-search/commit/5bf7faada426e79dd6123450eebd83967b542523))
* **crawler:** add StepStoneAdapter for stepstone.de job board ([3006a42](https://github.com/dachrisch/ai-job-search/commit/3006a42877a122b54d0f9c2ec7979d0ff2559e88))
* **crawler:** add top-5 career-site adapters (Greenhouse, Lever, SmartRecruiters, DjangoFoundation, HeiseJobs) ([cc469e8](https://github.com/dachrisch/ai-job-search/commit/cc469e80dcb9e4c2814167aaea371194c0ae4ddf))
* **crawler:** register Greenhouse, Lever, SmartRecruiters, DjangoFoundation, HeiseJobs adapters ([9d991d5](https://github.com/dachrisch/ai-job-search/commit/9d991d5496ca8dfc77271e0942cc12e5e8ec53eb))


### Bug Fixes

* **crawler:** guarantee 50-char description and add field extraction tests for DjangoFoundationAdapter ([c3d7cc6](https://github.com/dachrisch/ai-job-search/commit/c3d7cc69118ac78da0c8a3498caa779192c0255f))
* **crawler:** guarantee 50-char description and add slug validation test for SmartRecruitersAdapter ([f5b62c4](https://github.com/dachrisch/ai-job-search/commit/f5b62c471a0261f543bb37fe319d9fe2f5137da2))
* **crawler:** guard department name access and empty slug in GreenhouseAdapter ([fcd31b6](https://github.com/dachrisch/ai-job-search/commit/fcd31b6b90aede83db72e4a56ff282f2a5638fcd))
* **crawler:** reject CTA false positives and deduplicate job URLs in generic spider ([fe3db87](https://github.com/dachrisch/ai-job-search/commit/fe3db875ba3bbd1923cbe8f12694eafe44ab03de))
* **crawler:** scope HeiseJobs li scan to #jobOffers and document DjangoFoundation url param ([8329fe0](https://github.com/dachrisch/ai-job-search/commit/8329fe096a009f6d2df214c81b942ae0eb4d2a78))
* **crawler:** spider false positive fixes + StepStoneAdapter ([8d0a171](https://github.com/dachrisch/ai-job-search/commit/8d0a171b5b624d8cfa48a9452ec09c71ddb76d72))
* **crawler:** store team in JobDict and add slug validation test for LeverAdapter ([02d51c3](https://github.com/dachrisch/ai-job-search/commit/02d51c3b7d32038f908543d9d5924fbd2329d102))
* **crawler:** update HeiseJobsAdapter for site redesign ([36d98f8](https://github.com/dachrisch/ai-job-search/commit/36d98f8c06f604c70464a8bb234f242b73abb424))
* **crawler:** update HeiseJobsAdapter for site redesign ([348d8c1](https://github.com/dachrisch/ai-job-search/commit/348d8c1e0b5762c153f41fec3563854ffe53bd58))

## [0.4.1](https://github.com/dachrisch/ai-job-search/compare/v0.4.0...v0.4.1) (2026-06-17)


### Bug Fixes

* **ci:** prevent automerge deadlock by watching only required checks ([50addaf](https://github.com/dachrisch/ai-job-search/commit/50addaf96b3b67f278bf5f80da354324e19def3e))
* **ci:** replace blocking gh pr checks with API polling to prevent deadlock ([2006e6d](https://github.com/dachrisch/ai-job-search/commit/2006e6d8aa9b256a59f6a9939761ff21d3fcf7f2))
* **deps:** update dependency pytest to v8.4.2 ([ff9d55f](https://github.com/dachrisch/ai-job-search/commit/ff9d55f7526c59ed95bd80e4fa9007e5a887a792))
* **deps:** update vitest monorepo to v4 ([d163c55](https://github.com/dachrisch/ai-job-search/commit/d163c55721e5d3bc161380d0abc01f3ab9530130))

## [0.4.0](https://github.com/dachrisch/ai-job-search/compare/v0.3.0...v0.4.0) (2026-06-17)


### Features

* **api:** add unsupported to Company status enum, drop discoveredApi schema ([1bc6767](https://github.com/dachrisch/ai-job-search/commit/1bc67677bc8ff49368d5a20dcb31e88f0d1aea5c))
* **api:** simplify crawl_company, tag unsupported companies ([cf696cb](https://github.com/dachrisch/ai-job-search/commit/cf696cb34409323802ac6706692638db6a685771))
* **crawler:** add _try_adapter dispatch helper ([3b111f8](https://github.com/dachrisch/ai-job-search/commit/3b111f8f0c1ab6f9628ee325a0ebbdb0f481a840))
* **crawler:** add adapter registry with ordered URL matching ([54eac0d](https://github.com/dachrisch/ai-job-search/commit/54eac0de31b27a0f17641d8afb29edee90513799))
* **crawler:** add CareerSiteAdapter base class ([fe390f0](https://github.com/dachrisch/ai-job-search/commit/fe390f06d00d46670979aed1f7a7b946ceb2e0b4))
* **crawler:** dispatch to adapter registry before generic spider ([20849de](https://github.com/dachrisch/ai-job-search/commit/20849deddbc273497b28be3b840e538a19f1c248))
* **shared:** add unsupported Company status, remove DiscoveredApiConfig ([6d6c322](https://github.com/dachrisch/ai-job-search/commit/6d6c322aa79031b7e46f9b7919dd3d58924548a0))


### Bug Fixes

* **api:** fix pre-existing test failures in search-sources and discovery-integration ([1f9082d](https://github.com/dachrisch/ai-job-search/commit/1f9082d5b1ae404e9de9c782d52f1c1e3f319034))
* surface real job listings via ATS-targeted SearXNG queries and crawler selector fixes ([134c7c8](https://github.com/dachrisch/ai-job-search/commit/134c7c8047727bf6e4e8a0865cbce179d0c7f4f0))

## [0.3.0](https://github.com/dachrisch/ai-job-search/compare/v0.2.7...v0.3.0) (2026-06-16)


### Features

* SPA API discovery for company career pages ([#43](https://github.com/dachrisch/ai-job-search/issues/43)) ([6142b2e](https://github.com/dachrisch/ai-job-search/commit/6142b2e3507c6df0e67b2144679524164c0b4117))

## [0.2.7](https://github.com/dachrisch/ai-job-search/compare/v0.2.6...v0.2.7) (2026-06-15)


### Bug Fixes

* **deps:** update dependency bcryptjs to v3 ([2dd20f2](https://github.com/dachrisch/ai-job-search/commit/2dd20f24491b25d5bc9362b428debec352db66b1))
* **deps:** update dependency jsdom to v29 ([#32](https://github.com/dachrisch/ai-job-search/issues/32)) ([ce89a85](https://github.com/dachrisch/ai-job-search/commit/ce89a8544e680a836ba17377cd790b522655b1f2))
* **deps:** update dependency node to v24 ([9a194ad](https://github.com/dachrisch/ai-job-search/commit/9a194ad189f78c714e272cd3847f5b7b54eb2196))
* **deps:** update dependency node to v24 ([00a401d](https://github.com/dachrisch/ai-job-search/commit/00a401df5a6ff666b38f7585dd8e5a9ebdf81b49))
* **deps:** update dependency npm-run-all2 to v9 ([7f44c15](https://github.com/dachrisch/ai-job-search/commit/7f44c15079721bde110cefd0a32547f9c50776a7))
* **deps:** update dependency npm-run-all2 to v9 ([a93c37d](https://github.com/dachrisch/ai-job-search/commit/a93c37d70c42aecb84655001236f29bfb287207d))
* **deps:** update dependency redis to v6 ([7dd15b5](https://github.com/dachrisch/ai-job-search/commit/7dd15b589375d74ee913bb6fcd61428c865fa031))
* **deps:** update dependency redis to v6 ([847360c](https://github.com/dachrisch/ai-job-search/commit/847360c36535bbd7e11edfdcb7e3f18dc476f302))
* **deps:** update testing-library monorepo to v16 ([#40](https://github.com/dachrisch/ai-job-search/issues/40)) ([5761445](https://github.com/dachrisch/ai-job-search/commit/5761445785b9c191681b0d06fde0060375a30fa6))

## [0.2.6](https://github.com/dachrisch/ai-job-search/compare/v0.2.5...v0.2.6) (2026-06-15)


### Bug Fixes

* **deps:** update dependency @types/express to v5 ([2a7f28c](https://github.com/dachrisch/ai-job-search/commit/2a7f28c8853174cd3ece3d6bb66237badc7999aa))
* **deps:** update dependency @types/express to v5 ([e74e526](https://github.com/dachrisch/ai-job-search/commit/e74e526f9d4d3655e472c8f82334603c4fc66846))
* **deps:** update dependency @vitejs/plugin-react to v6 ([6dd189f](https://github.com/dachrisch/ai-job-search/commit/6dd189f83ac91ab3570b8d03ecc46b467bd9c2d3))
* **deps:** update dependency @vitejs/plugin-react to v6 ([e8f4f2f](https://github.com/dachrisch/ai-job-search/commit/e8f4f2fb6229d377b86342873ca29c19c7bba05b))
* **deps:** update dependency dotenv to v17 ([85f3f42](https://github.com/dachrisch/ai-job-search/commit/85f3f42e5bbddf0162885cb2e098ba12fcb27c9e))
* **deps:** update dependency dotenv to v17 ([928132d](https://github.com/dachrisch/ai-job-search/commit/928132ddfa3dc30020d561988b31de6d67c75ec6))
* **deps:** update dependency mongoose to v9 ([1d9c723](https://github.com/dachrisch/ai-job-search/commit/1d9c7236f568c03b973e081a9dec162879590bc9))
* **deps:** update dependency mongoose to v9 ([4702f73](https://github.com/dachrisch/ai-job-search/commit/4702f7343fc9ae922d799f7c345f1550298f8550))
* **deps:** update dependency redis ([ad2322e](https://github.com/dachrisch/ai-job-search/commit/ad2322e669086453185796df8cbd816e876863d0))
* **deps:** update dependency redis ([36878d9](https://github.com/dachrisch/ai-job-search/commit/36878d9203590d909901acbc7ae963604dad4a43))
* **deps:** update dependency supertest to v7 ([e32f395](https://github.com/dachrisch/ai-job-search/commit/e32f3955d6d964ea8e82697c5ffc6ea48860a80e))
* **deps:** update dependency supertest to v7 ([0bfe266](https://github.com/dachrisch/ai-job-search/commit/0bfe26640f67a16bd5aec6b77f2e99aa884ee13a))
* **deps:** update dependency typescript to v6 ([58d5363](https://github.com/dachrisch/ai-job-search/commit/58d5363a200508e8925aedb885d88baf0357c960))
* **deps:** update dependency typescript to v6 ([0f85d64](https://github.com/dachrisch/ai-job-search/commit/0f85d64ab1ba00d4a65761a8b2db7ec0f259b09a))

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
