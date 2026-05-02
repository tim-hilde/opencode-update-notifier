# OpenCode Update Notifier — Design

**Status:** Approved
**Date:** 2026-05-02
**Author:** Tim Hildebrandt

## Summary

An OpenCode plugin distributed on npm as `opencode-update-notifier`. On the first `session.created` event after OpenCode starts, it reads the `plugin` arrays from all relevant OpenCode config files, identifies version-pinned npm plugin entries, queries the npm registry to find the latest version of each, compares them via semver, and shows a single aggregated toast in the TUI when any plugin has a newer version available. It does not auto-update anything. Results are cached locally for six hours to avoid hammering the registry.

## Goals

- Notify the user about available plugin updates without being noisy.
- Never block OpenCode startup or session creation.
- Never crash OpenCode under any input or network condition.
- Run at most once per OpenCode lifecycle.
- Be cheap on subsequent starts via local caching.
- Ship as a single npm package with a clean release pipeline.

## Non-goals

- Auto-updating plugins. The user decides when to update.
- Notifying about OpenCode itself. Only plugins listed in `plugin` arrays.
- Supporting unpinned plugin entries. Without a pinned version there is no baseline to compare against.
- Resolving local plugin paths or filesystem-based plugin entries.
- Reading remote (`.well-known/opencode`) configs or macOS managed preferences (`.mobileconfig`/plist). These are organizationally managed and not relevant to user-driven update flows.
- User-configurable behavior. No options in the first version. TTL, toast format, and source list are hardcoded.

## Architecture overview

```
opencode starts
   │
   ▼
plugin init (registers hooks)
   │
   ▼
first session.created event fires
   │
   ▼
hasRun? ──yes──► exit
   │
   no
   ▼
read all opencode.json(c) sources (global, project, env, managed)
   │
   ▼
parse plugin entries → keep scoped+pinned and unscoped+pinned, drop rest (debug log)
   │
   ▼
dedupe by name, picking max pinned version per name
   │
   ▼
for each entry: cache lookup (TTL 6h)
   │  miss / stale: fetch from npm registry (parallel, Promise.allSettled)
   ▼
write cache
   │
   ▼
compare pinned vs latest via semver
   │
   ▼
updates? ──no──► silent
   │
   yes
   ▼
single aggregated toast + structured log
```

The plugin runs entirely fail-soft. Top-level try/catch in the hook handler. Any failure produces a `client.app.log` entry at warn or error level and never throws.

## Components

Files are split so that each one has a single responsibility, a narrow surface, and is testable in isolation by injecting filesystem, network, and time dependencies. No module performs I/O at import time.

### `src/index.ts`

Plugin entry. Exports the `Plugin` function (named export `OpencodeUpdateNotifier` plus a default export for either-style imports). Registers a single `event` hook. Holds a closure-scoped `hasRun` boolean. On the first `session.created` event:

1. Set `hasRun = true`.
2. Wrap the rest in try/catch, emitting any uncaught error via `client.app.log` at error level.
3. Construct dependencies (real registry fetcher, real cache reader, real config sources) and pass them into `runCheck()` from `check.ts`.
4. If results contain updates, call `notify()` from `notify.ts`.

Thin orchestration only. No business logic.

### `src/config/sources.ts`

Pure functions to enumerate config source candidates. Each function returns either `{ path: string, content: string } | null` or, for `OPENCODE_CONFIG_CONTENT`, `{ path: "<inline>", content: string } | null`.

Sources read, in arbitrary order (we sum, we do not pick a winner):

1. **Global config:** `~/.config/opencode/opencode.json` and `~/.config/opencode/opencode.jsonc`. Both are read if both exist (we sum content). Honors `XDG_CONFIG_HOME` if set.
2. **Custom directory:** if `OPENCODE_CONFIG_DIR` is set, read `opencode.json(c)` from that directory.
3. **Custom config file:** if `OPENCODE_CONFIG` is set, read that file.
4. **Project config:** starting from `worktree` (or `directory` as fallback) supplied by the plugin context, walk upward until either a `.git` entry is found at the current level or the filesystem root is reached. At each level, check `opencode.json` first and `opencode.jsonc` second; include all that exist. (If neither is found anywhere, no project config is included.)
5. **Inline config:** if `OPENCODE_CONFIG_CONTENT` is set and is non-empty, treat its value as inline JSONC.
6. **Managed file configs (platform-dependent):**
   - macOS: `/Library/Application Support/opencode/opencode.json(c)`
   - Linux: `/etc/opencode/opencode.json(c)`
   - Windows: `%ProgramData%\opencode\opencode.json(c)`

Each source function takes its dependencies (env reader, fs reader, home-dir provider) as injected arguments to allow testing without manipulating real environment or filesystem state.

### `src/config/load.ts`

Single entry function `loadPluginEntries(deps): string[]`. Iterates all source functions, parses each found content via `jsonc-parser` (which tolerates comments, trailing commas, and minor errors), reads the `plugin` array if present, and concatenates everything. Returns a deduplicated `string[]` (deduplication by exact identity at this stage; per-name max-version picking happens later in `check.ts`).

Parse failures on a single file are logged and skipped — the function never throws because of bad config files.

### `src/parse.ts`

`parseEntry(raw: string): { name: string, version: string } | null`.

Two regexes attempted in order:

- Scoped + pinned: `^(@[^/]+/[^@]+)@([^@].*)$` → `{ name, version }`
- Unscoped + pinned: `^([^@/][^@]*)@([^@].*)$` → `{ name, version }`

If neither matches, returns `null`. Pre-release versions like `1.0.0-beta.1` are accepted by both regexes (they don't contain `@` past the first one).

`parseEntries(raws: string[]): { parsed: ParsedEntry[], dropped: string[] }`. Dropped strings are returned so the caller can log them.

### `src/registry.ts`

Single function `fetchLatest(name: string, opts: { fetch, timeoutMs }): Promise<string>`.

URL: `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`. The encoding handles scoped names: `@scope/name` becomes `%40scope%2Fname` which the npm registry accepts. (Alternative: keep `/` literal — both work in practice; we use `encodeURIComponent` for predictability.)

Timeout: 5000 ms via `AbortSignal.timeout`. On non-2xx or timeout, throws an error tagged with the package name. Returns the `version` field from the response body.

`fetch` is injected so tests can supply a fake.

### `src/cache.ts`

JSON file at `~/.cache/opencode-update-notifier/cache.json`. Honors `XDG_CACHE_HOME` if set. TTL is 6 hours, hardcoded.

Schema:

```json
{
  "version": 1,
  "entries": {
    "<package-name>": { "latest": "1.2.3", "fetchedAt": 1714600000000 }
  }
}
```

Functions:

- `readCache(deps): Cache` — returns empty cache if file missing, malformed, or schema-version mismatch. Never throws.
- `getEntry(cache, name, now, ttlMs): string | null` — returns latest if fresh, else null.
- `setEntry(cache, name, latest, now): Cache` — pure update.
- `writeCache(deps, cache): void` — atomic write (write to temp file in same dir, rename). Best-effort; logs and swallows errors.

Pure functions on the cache value plus thin I/O wrappers. The orchestrator reads once at start, mutates the in-memory value as it fetches, writes once at end.

### `src/check.ts`

`runCheck(deps): Promise<UpdateResult[]>`.

`deps`: `{ entries, registry, cache, now, log }`. `entries` is the already-parsed list from `loadPluginEntries` + `parseEntries`. `registry`, `cache`, and `log` are interfaces.

Algorithm:

1. Group `entries` by `name`, keeping the highest pinned version per name (via `semver.maxSatisfying` against all options, or simpler: sort with `semver.compare` and pick last).
2. Read the cache once.
3. For each unique name: if cache has fresh entry, use it; otherwise add to a fetch queue.
4. Run all fetches via `Promise.allSettled` with timeout per request. Update the in-memory cache for each successful fetch. Log each failure.
5. For each name: compare `pinned` vs `latest` via `semver.gt(latest, pinned)`. If true, push `{ name, pinned, latest }` to results.
6. Write the cache.
7. Return results.

### `src/notify.ts`

`notify(deps, results: UpdateResult[]): Promise<void>`.

If results empty, no-op.

Builds the toast string:

- 1 update: `Plugin update available: <name> <pinned> → <latest>`
- N>1 updates, up to 3 inline: `N plugin updates available: <name1> <p1> → <l1>, <name2> <p2> → <l2>, <name3> <p3> → <l3>`
- N>3: append `, +<N-3> more`

Sends:

1. Toast via the OpenCode TUI mechanism. The exact mechanism is established at implementation time by inspecting `@opencode-ai/plugin` types and the SDK client surface. Three plausible candidates, in preferred order:
   - A direct method on `client` like `client.tui.toast.show(...)`
   - An event emit via `client.event.publish({ type: "tui.toast.show", ... })`
   - Falling back to a `warn`-level log (visible in OpenCode's diagnostics) if neither exists

   The implementation plan owns this discovery as its first concrete task.
2. Always also a structured `client.app.log({ service: "opencode-update-notifier", level: "info", message, extra: { updates } })` for machine-readable trace.

### `src/types.ts`

Shared type aliases: `ParsedEntry`, `UpdateResult`, `Cache`, dep interfaces (`RegistryClient`, `CacheStore`, `Logger`, `EnvReader`, `FsReader`, `Clock`).

## Data flow summary

```
config sources (filesystem + env)
       │  raw strings from plugin arrays
       ▼
parseEntries → ParsedEntry[] (scoped/unscoped + pinned only)
       │
       ▼
runCheck (with cache + registry deps)
       │  groups by name, picks max pinned per name
       │  cache hit → use; cache miss → fetch + cache
       │  semver compare
       ▼
UpdateResult[]
       │
       ▼
notify (toast + log) — only if non-empty
```

## Error strategy

- The plugin must never throw past the `event` handler. A top-level try/catch wraps the work.
- File read errors, JSONC parse errors, malformed plugin strings, network errors, timeouts, and corrupt cache files all degrade gracefully: log and continue with whatever data is available.
- Per-package registry failures don't abort the run. Other packages can still produce a toast.
- An empty result set produces silence, not an error toast.

## Once-per-lifecycle guarantee

A closure-scoped `let hasRun = false` lives inside the plugin function. The `event` hook checks and sets it atomically before doing any work. Even if the user creates many sessions in one OpenCode run, the check runs at most once.

## Configuration

There is none. TTL, toast format, source list, registry URL, and timeout are all hardcoded constants in v0.x. The first user-config addition will be motivated by a real complaint, not by speculation.

The user controls the plugin only by including or excluding `opencode-update-notifier` in their `opencode.json` `plugin` array.

## Repository structure

```
opencode-update-notifier/
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── release.yml
├── .changeset/
│   └── config.json
├── src/
│   ├── index.ts
│   ├── config/
│   │   ├── sources.ts
│   │   └── load.ts
│   ├── parse.ts
│   ├── registry.ts
│   ├── cache.ts
│   ├── check.ts
│   ├── notify.ts
│   └── types.ts
├── test/
│   ├── parse.test.ts
│   ├── cache.test.ts
│   ├── registry.test.ts
│   ├── config-sources.test.ts
│   ├── config-load.test.ts
│   ├── check.test.ts
│   ├── notify.test.ts
│   └── fixtures/
├── docs/
│   └── superpowers/
│       ├── specs/
│       └── plans/
├── biome.json
├── lefthook.yml
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── .gitignore
├── .npmignore
├── README.md
├── LICENSE
└── CHANGELOG.md
```

## Tooling

- **Language:** TypeScript (strict mode).
- **Runtime:** ESM, Node 18+ for compatibility (Bun also fine).
- **Build:** `tsup` produces a single ESM bundle plus type declarations. `jsonc-parser` and `semver` are bundled into the output so consumers don't pay an extra install cost.
- **Tests:** `bun test`. All external dependencies (filesystem, fetch, env, clock) are passed in as arguments. No mocking framework needed — tests construct fake objects inline.
- **Lint and format:** Biome (`biome.json`). One tool for both.
- **Pre-commit hook:** lefthook. Pre-commit runs `biome check --write` on staged TS files and `tsc --noEmit`. Pre-push runs `bun test`.
- **Release:** Changesets. PRs include a changeset file when they change behavior. The Changesets GitHub Action manages a Version PR and triggers npm publish + GitHub Release on merge.

### `package.json` essentials

```json
{
  "name": "opencode-update-notifier",
  "version": "0.0.0",
  "description": "OpenCode plugin that notifies you when your installed plugins have newer versions on npm",
  "keywords": ["opencode", "opencode-plugin", "plugin", "npm", "update-notifier"],
  "author": "Tim Hildebrandt <44113468+tim-hilde@users.noreply.github.com>",
  "license": "MIT",
  "repository": "github:tim-hilde/opencode-update-notifier",
  "homepage": "https://github.com/tim-hilde/opencode-update-notifier",
  "bugs": "https://github.com/tim-hilde/opencode-update-notifier/issues",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "engines": { "node": ">=18" }
}
```

Dependencies: `jsonc-parser`, `semver`.
DevDependencies: `@opencode-ai/plugin` (peer + dev), `@biomejs/biome`, `@changesets/cli`, `@types/semver`, `lefthook`, `tsup`, `typescript`.
PeerDependencies: `@opencode-ai/plugin: *`.

## Test strategy (TDD)

Implementation follows strict Red-Green-Refactor per task. Each module gets a failing test before any implementation code.

Module test order (each must be green before the next is started):

1. `parse.ts` — pure, no deps. Table-driven tests covering scoped, unscoped, with and without version, pre-release versions, malformed strings.
2. `cache.ts` — read miss, read hit, read stale (older than TTL), write, malformed cache file (recovers to empty cache).
3. `registry.ts` — successful fetch, non-2xx response, timeout, error reporting includes package name. Uses an injected `fetch`.
4. `config/sources.ts` — each source function tested independently with fake env and fake fs. Project upward-walk tested with a fixture directory tree.
5. `config/load.ts` — combines source outputs, parses JSONC, dedupes, gracefully handles parse errors per file.
6. `check.ts` — orchestrator tests with fake registry, fake cache, fake clock. Scenarios: all current, several stale, registry error on one (others succeed), full cache hit (no network), partial cache hit, multiple entries with same name (max version wins).
7. `notify.ts` — toast string formatting for 0/1/3/5 updates. Logger and toast-emitter both injected and asserted against.
8. `index.ts` — wiring test: invoke the plugin, fire two `session.created` events, verify the check runs only once.

What is explicitly not tested:

- Real network calls to the npm registry.
- TUI rendering. We test that we call the toast emitter with the right argument; rendering is OpenCode's concern.
- Cross-process integration with a live OpenCode binary.

### Manual verification (for the maintainer)

After the implementation is done and CI is green:

1. Build locally (`bun run build`).
2. Symlink or `bun pack` install into a test OpenCode setup.
3. Create an `opencode.json` containing a deliberately outdated scoped plugin (e.g. `@ex-machina/opencode-anthropic-auth@1.0.0`).
4. Start OpenCode, open a session. Confirm a toast appears.
5. Inspect `~/.cache/opencode-update-notifier/cache.json`.
6. Restart OpenCode within 6h. Toast still appears (cache hit). Verify via logs that no network request fired.

## CI and release

### CI (`.github/workflows/ci.yml`)

Triggers: PR + push to main.

Matrix: Node 18 and Node 20.

Steps: checkout → setup-bun → `bun install --frozen-lockfile` → `bun run typecheck` → `biome ci src test` (read-only format and lint check, fails on diffs) → `bun run test` → `bun run build`.

### Release (`.github/workflows/release.yml`)

Trigger: push to main.

Steps: checkout → setup-bun + setup-node → install → build → `changesets/action@v1` with `publish: bun run release`.

The Changesets action does two things depending on state:
- If unreleased changesets exist and there is no open Version PR: opens one with version bumps and CHANGELOG entries.
- If a Version PR was just merged (no remaining unreleased changesets): publishes to npm and creates the matching GitHub Release with the CHANGELOG snippet.

Secrets: `NPM_TOKEN` (set after the maintainer creates an npm account). `GITHUB_TOKEN` is built in.

Workflow permissions: `contents: write`, `pull-requests: write`, `id-token: write` (for npm provenance).

### Maintainer release flow

1. Code change on a feature branch.
2. `bun changeset` — pick patch/minor/major, write a one-line user-facing summary.
3. Open and merge PR to main.
4. The action opens a "Version Packages" PR with the bumped `package.json` and `CHANGELOG.md`.
5. Merging that PR triggers npm publish and the GitHub Release.

### First release prerequisites

Before the first publish:

1. Create npm account and `npm login`.
2. Create a granular npm access token with publish rights for `opencode-update-notifier`.
3. Add it as the `NPM_TOKEN` secret in the GitHub repo.

## Out-of-scope deliberately

- Remote OpenCode configs (`.well-known/opencode`). Auth-coupled, HTTP, organizationally managed; documented as a non-goal.
- macOS managed preferences (`.mobileconfig`/plist). Highly enterprise-specific.
- Variable substitution (`{env:...}`, `{file:...}`) inside plugin strings. Not realistic in plugin specifiers.
- A user-facing UI inside OpenCode (e.g. a panel listing updates). The toast plus log is enough.
- An "ignore this update" mechanism. Add later if real users ask.

## Open questions resolved during design

| Question | Resolution |
|---|---|
| Which plugin entry shapes? | Scoped + pinned and unscoped + pinned. |
| Trigger? | First `session.created`, once per lifecycle. |
| Toast strategy? | Single aggregated toast. |
| Update filter? | Any semver-greater latest version. No major/minor distinction. |
| Caching? | Local JSON, 6h TTL, hardcoded. |
| Config sources? | Global, project (upward walk), `OPENCODE_CONFIG`, `OPENCODE_CONFIG_DIR`, `OPENCODE_CONFIG_CONTENT`, managed file configs. Not remote, not MDM. |
| Language? | TypeScript with strict mode. |
| Bundling deps? | Yes — `jsonc-parser` and `semver` are bundled. |
| Lint/format? | Biome, with format enforced in CI and via lefthook pre-commit. |
| Tests? | Bun test, strict TDD, dependencies injected. |
| Release? | Changesets + GitHub Actions. |
| User-configurable behavior? | None in v0.x. |

## Definition of Done

- All eight test files exist and pass under `bun test`.
- `bun run typecheck` passes.
- `biome ci src test` passes with zero diffs.
- `bun run build` produces `dist/index.js` and `dist/index.d.ts`.
- CI workflow green on a PR.
- README documents installation, behavior, and the cache location.
- Manual verification checklist completed once locally.
- A changeset for `0.1.0` exists and the Version PR has been merged at least once on a fork or test scope (this can happen later, after the maintainer is ready to publish).
