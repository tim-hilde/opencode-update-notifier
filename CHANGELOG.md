## [0.3.2](https://github.com/tim-hilde/opencode-update-notifier/compare/v0.3.1...v0.3.2) (2026-06-11)


### Bug Fixes

* trigger update check on session.updated instead of server.connected ([a223cf2](https://github.com/tim-hilde/opencode-update-notifier/commit/a223cf278d1457c9f9c898f624b01a793f65585b))

## [0.3.1](https://github.com/tim-hilde/opencode-update-notifier/compare/v0.3.0...v0.3.1) (2026-06-01)


### Bug Fixes

* trigger update check on server.connected instead of installation.update-available ([60fca90](https://github.com/tim-hilde/opencode-update-notifier/commit/60fca901f583ba34421a751d7d0398265fbae3e7))

# [0.3.0](https://github.com/tim-hilde/opencode-update-notifier/compare/v0.2.0...v0.3.0) (2026-05-21)


### Bug Fixes

* avoid mutation in configOrigin merge, add else-branch test ([9668a34](https://github.com/tim-hilde/opencode-update-notifier/commit/9668a34e91b09514268464d600dfd702743a0181))


### Features

* add ConfigOrigin type to ParsedEntry and UpdateResult ([bf7776f](https://github.com/tim-hilde/opencode-update-notifier/commit/bf7776fb79979bfe5e7bff8ef25b9b9a8cd6837f))
* add getTuiConfigSources() to read tui.json/tui.jsonc ([09597d0](https://github.com/tim-hilde/opencode-update-notifier/commit/09597d01a42fd6952ab6704fa5c75c0e7ecd4e2a))
* load TUI config plugins, tag and merge with regular entries ([c33d215](https://github.com/tim-hilde/opencode-update-notifier/commit/c33d21509ee6a75faa995dd270fbfb1f31d489e0))
* merge configOrigin in check.ts grouping, pass to UpdateResult ([2464f85](https://github.com/tim-hilde/opencode-update-notifier/commit/2464f850dc745d2edabcd7e7e0c6f78d4ef013af))
* show (TUI) / (TUI + config) suffix in toast labels ([8b1a48d](https://github.com/tim-hilde/opencode-update-notifier/commit/8b1a48d5954c2f1bcec2b474fb48df8707dae744))

# [0.2.0](https://github.com/tim-hilde/opencode-update-notifier/compare/v0.1.0...v0.2.0) (2026-05-14)


### Bug Fixes

* apply biome formatting and fix smoke test event type ([4620c80](https://github.com/tim-hilde/opencode-update-notifier/commit/4620c80a652eb30d4d7646970b91ef04622692bf))
* bump Node.js to v22 for semantic-release compatibility ([aee4430](https://github.com/tim-hilde/opencode-update-notifier/commit/aee44305681dc57eefa499b28ba66495dc3c3819))
* derive UpdateResult.source from ParsedEntry; document cache key convention ([9aa98e3](https://github.com/tim-hilde/opencode-update-notifier/commit/9aa98e3071c5a56cae477033c9900e6a47daed44))
* guard semverCoerce to partial-semver refs only; add edge-case tests ([d477800](https://github.com/tim-hilde/opencode-update-notifier/commit/d477800dd207dfeb32940b9dc37e8eb7239e66e3))
* reject array-valued cache buckets in readCache ([5229643](https://github.com/tim-hilde/opencode-update-notifier/commit/52296439b1aaf54b82412adc5e61d01daedddcb3))
* remove dead guard in fetchLatestGithubTag ([2b93688](https://github.com/tim-hilde/opencode-update-notifier/commit/2b936883645be1ea6ca96e48c61d65983d3d02ae))
* update name from max-version entry; skip writeCache when no fetches occurred ([c3cebc3](https://github.com/tim-hilde/opencode-update-notifier/commit/c3cebc31366e14f8d6cd3793ce5e274f5a437db0))
* use semver.valid to filter GitHub tags; remove unused GithubTagFetcher type ([0e3ca7b](https://github.com/tim-hilde/opencode-update-notifier/commit/0e3ca7b877fc32d053d71c90d7b0f425e1249ed3))


### Features

* add GitHub git-pinned plugin update checks ([3977934](https://github.com/tim-hilde/opencode-update-notifier/commit/39779343259ebf9064cc116df79d63615875d11c))
* add GitHub tags fetcher ([51c43e4](https://github.com/tim-hilde/opencode-update-notifier/commit/51c43e4d8edd2512126960dbd540996563f0ad55))
* migrate cache to v2 schema with per-source buckets ([72402ab](https://github.com/tim-hilde/opencode-update-notifier/commit/72402abc24353e3430e33d0d22675f0e9ebbbb94))
* parse GitHub git-pinned plugin entries ([4cdabf9](https://github.com/tim-hilde/opencode-update-notifier/commit/4cdabf96a10986e01a00083baa32a5cacf10ca7a))
* render git-github updates with (git) tag in toast ([3a43d7b](https://github.com/tim-hilde/opencode-update-notifier/commit/3a43d7b1b95c846115385dca5d9094433454098f))
* update runCheck to dispatch per source with v2 cache ([c9cd5af](https://github.com/tim-hilde/opencode-update-notifier/commit/c9cd5af96ae1762afccb9e6ce3cb91b59b14bc9f))
* update types for git-github source support ([bc155b1](https://github.com/tim-hilde/opencode-update-notifier/commit/bc155b1a5641dce57b4cea8c5af7388c9bab5c26))
* wire fetchLatestGithubTag into plugin entry point ([85168db](https://github.com/tim-hilde/opencode-update-notifier/commit/85168db8841a97bfe070d6572d9bb00091dd9ad8))

# opencode-update-notifier

## 0.1.0

### Minor Changes

- 6f5c50d: Initial release — notifies when pinned OpenCode plugins have newer versions on npm
