# Design: `/check-updates` Slash Command

**Date:** 2026-05-03  
**Status:** Approved

## Overview

Add a `/check-updates` slash command to the `opencode-update-notifier` plugin, allowing users to manually trigger an update check at any time during an OpenCode session. The command bypasses the TTL cache and queries npm directly, then shows a toast notification with the result — identical to the automatic check's output format.

## Goals

- User can run `/check-updates` at any time from the OpenCode TUI
- Command appears in TUI autocomplete when typing `/`
- Result is a toast notification (same format as the automatic check)
- Manual check always fetches fresh data from npm (cache TTL is ignored)
- Cache is updated after a successful manual check
- Errors are logged but never crash the plugin

## Non-Goals

- No text output in the chat transcript
- No separate CLI entrypoint
- No changes to the automatic `session.created` check behavior

## Architecture

### `src/check.ts` — `forceRefresh` flag

`runCheck` gains an optional `forceRefresh?: boolean` parameter. When `true`, the cache TTL check is skipped and all plugins are fetched from npm regardless of cache age. The fetched results are still written back to the cache (so the next automatic check benefits from the fresh data).

```ts
export async function runCheck(
  entries: PluginEntry[],
  deps: CheckDeps,
  options?: { forceRefresh?: boolean }
): Promise<UpdateResult[]>
```

The internal TTL guard changes from:

```ts
if (cacheEntry && !isCacheStale(cacheEntry)) { ... }
```

to:

```ts
if (!options?.forceRefresh && cacheEntry && !isCacheStale(cacheEntry)) { ... }
```

### `src/index.ts` — Two new hooks

**`config` hook** — registers the command so it appears in TUI autocomplete:

```ts
config: async (cfg) => {
  cfg.command ??= {};
  cfg.command["check-updates"] = {
    description: "Check if your OpenCode plugins have newer versions available",
    template: "",
  };
},
```

**`command.execute.before` hook** — handles execution when the user runs `/check-updates`:

```ts
"command.execute.before": async (input, _output) => {
  if (input.command !== "check-updates") return;
  try {
    const sources = getConfigSources(/* ... */);
    const entries = parseEntries(await loadPluginEntries(sources));
    const updates = await _runCheck(entries, registryDeps, { forceRefresh: true });
    await notify(client, updates);
  } catch (err) {
    await client.app.log({ body: { level: "error", message: String(err) } });
  }
},
```

The handler is fully independent from the `hasRun` guard used by the automatic check.

## Data Flow

```
User types /check-updates
  -> command.execute.before fires (input.command === "check-updates")
  -> Load config sources
  -> Parse pinned plugin entries
  -> runCheck(entries, deps, { forceRefresh: true })
      -> Skip TTL check for all entries
      -> Fetch all from npm registry in parallel
      -> Write fresh results to cache
      -> Return UpdateResult[] where latest > pinned
  -> notify(client, updates)
      -> If updates: showToast("Plugin update available: ..." / "N plugin updates available: ...")
      -> If no updates: no toast (silent success)
  -> Errors: caught, logged via client.app.log, no crash
```

## Error Handling

- The entire `command.execute.before` body is wrapped in try/catch.
- Errors (config load failure, npm unreachable, etc.) are logged via `client.app.log` at level `"error"`.
- No toast is shown on error — same as the automatic check.
- If no pinned plugins are configured, the result is an empty `UpdateResult[]` — no toast, no error.

## Testing

New tests in `test/index.test.ts`:

1. **`config` hook injects the command** — after calling the `config` hook with an empty config object, `cfg.command["check-updates"]` exists with the correct `description`.
2. **`command.execute.before` runs the check** — with `input.command === "check-updates"`, `_runCheck` is called with `forceRefresh: true` and `notify` is called with the results.
3. **Other commands are ignored** — with `input.command === "some-other-command"`, `_runCheck` is not called.
4. **Errors are caught** — if `_runCheck` throws, the error is logged via `client.app.log` and no exception propagates.

New test in `test/check.test.ts`:

5. **`forceRefresh: true` skips TTL** — a cache entry with a fresh timestamp is present, but `runCheck` with `forceRefresh: true` still calls the registry fetcher.

## Files Changed

| File | Change |
|---|---|
| `src/check.ts` | Add `options?: { forceRefresh?: boolean }` parameter; update TTL guard |
| `src/index.ts` | Add `config` hook; add `command.execute.before` hook |
| `test/index.test.ts` | Add 4 new tests for the slash command |
| `test/check.test.ts` | Add 1 new test for `forceRefresh` behavior |

No new files are created.
