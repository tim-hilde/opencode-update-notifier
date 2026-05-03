# `/check-updates` Slash Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/check-updates` slash command that lets users manually trigger an npm update check from within OpenCode, always bypassing the cache TTL to fetch fresh data, and showing a toast with the result.

**Architecture:** `runCheck` in `src/check.ts` gains an optional `forceRefresh` flag that skips the TTL guard. `src/index.ts` registers the command via the `config` hook and handles execution via `command.execute.before`, reusing the existing config-loading/parsing/notifying logic. The `_internal` DI escape hatch is extended to cover the slash command handler so tests can inject a fake `_runCheck`.

**Tech Stack:** TypeScript, Bun, bun:test, `@opencode-ai/plugin` SDK hooks (`config`, `command.execute.before`)

---

## File Map

| File | Change |
|---|---|
| `src/check.ts` | Add `forceRefresh?: boolean` to the deps object; skip TTL guard when true |
| `src/index.ts` | Add `config` hook; add `command.execute.before` hook; extend `InternalDeps` type |
| `test/check.test.ts` | Add test: `forceRefresh: true` bypasses cache even when entry is fresh |
| `test/index.test.ts` | Add 4 tests: config hook injects command, execute.before dispatches check, other commands ignored, errors caught |

---

### Task 1: Add `forceRefresh` to `runCheck`

**Files:**
- Modify: `src/check.ts`
- Test: `test/check.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test to `test/check.test.ts`, inside the `describe("runCheck", ...)` block (after the last existing test):

```ts
test("forceRefresh: true bypasses cache even when entry is fresh", async () => {
  const entries: ParsedEntry[] = [{ name: "cached-pkg", version: "1.0.0" }];
  const initialCache: Cache = {
    version: 1,
    entries: { "cached-pkg": { latest: "3.0.0", fetchedAt: NOW - 1000 } }, // fresh entry
  };
  let registryCalled = false;
  const fetchLatest = async (_name: string) => {
    registryCalled = true;
    return "4.0.0";
  };

  const results = await runCheck({
    entries,
    fetchLatest,
    readCache: () => initialCache,
    writeCache: () => {},
    now: NOW,
    ttlMs: TTL_MS,
    log: noopLog,
    forceRefresh: true,
  });

  expect(registryCalled).toBe(true);
  expect(results).toEqual([{ name: "cached-pkg", pinned: "1.0.0", latest: "4.0.0" }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test test/check.test.ts
```

Expected: test fails — `runCheck` does not accept `forceRefresh` yet / registry is not called.

- [ ] **Step 3: Add `forceRefresh` to `runCheck` in `src/check.ts`**

Change the function signature from:

```ts
export async function runCheck(deps: {
  entries: ParsedEntry[];
  fetchLatest: (name: string) => Promise<string>;
  readCache: () => Cache;
  writeCache: (cache: Cache) => void;
  now: number;
  ttlMs: number;
  log: Logger;
}): Promise<UpdateResult[]> {
```

to:

```ts
export async function runCheck(deps: {
  entries: ParsedEntry[];
  fetchLatest: (name: string) => Promise<string>;
  readCache: () => Cache;
  writeCache: (cache: Cache) => void;
  now: number;
  ttlMs: number;
  log: Logger;
  forceRefresh?: boolean;
}): Promise<UpdateResult[]> {
```

Then change the cache check from:

```ts
    const fresh = getEntry(cache, name, deps.now, deps.ttlMs);
    if (fresh !== null) {
      cachedLatest.set(name, fresh);
    } else {
      fetchQueue.push(name);
    }
```

to:

```ts
    const fresh = deps.forceRefresh ? null : getEntry(cache, name, deps.now, deps.ttlMs);
    if (fresh !== null) {
      cachedLatest.set(name, fresh);
    } else {
      fetchQueue.push(name);
    }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test test/check.test.ts
```

Expected: all tests pass including the new `forceRefresh` test.

- [ ] **Step 5: Commit**

```bash
git add src/check.ts test/check.test.ts
git commit -m "feat: add forceRefresh option to runCheck to bypass cache TTL"
```

---

### Task 2: Add `config` hook to register the slash command

**Files:**
- Modify: `src/index.ts`
- Test: `test/index.test.ts`

- [ ] **Step 1: Write the failing test**

Add a new `describe` block at the end of `test/index.test.ts`:

```ts
describe("config hook", () => {
  test("registers check-updates command", async () => {
    const hooks = await OpencodeUpdateNotifier(
      {
        client: makeClient() as never,
        project: {} as never,
        directory: "/tmp",
        worktree: "/tmp",
        experimental_workspace: { register: () => {} },
        serverUrl: new URL("http://localhost:1234"),
        $: {} as never,
      },
      {},
    );

    const cfg: { command?: Record<string, { description?: string; template: string }> } = {};
    await hooks.config?.(cfg as never);

    expect(cfg.command?.["check-updates"]).toBeDefined();
    expect(cfg.command?.["check-updates"]?.description).toBe(
      "Check if your OpenCode plugins have newer versions available",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test test/index.test.ts
```

Expected: fails — `hooks.config` is undefined.

- [ ] **Step 3: Add `config` hook to `src/index.ts`**

In the return object of `OpencodeUpdateNotifier` (after the `event` hook), add:

```ts
    config: async (cfg: { command?: Record<string, { description?: string; template: string }> }) => {
      cfg.command ??= {};
      cfg.command["check-updates"] = {
        description: "Check if your OpenCode plugins have newer versions available",
        template: "",
      };
    },
```

The import for `PluginOptions` is already present. No new imports needed.

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test test/index.test.ts
```

Expected: all tests pass including the new config test.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/index.test.ts
git commit -m "feat: register /check-updates slash command via config hook"
```

---

### Task 3: Add `command.execute.before` hook

**Files:**
- Modify: `src/index.ts`
- Modify: `test/index.test.ts`

- [ ] **Step 1: Write the three failing tests**

Add these tests inside the `describe("config hook", ...)` block you created in Task 2 (rename it to `describe("slash command", ...)` while you're there):

```ts
describe("slash command", () => {
  // (move the config test here too — or keep it in its own block, both are fine)

  test("command.execute.before runs check when command is check-updates", async () => {
    let checkCalledWith: unknown = null;
    const toastCalls: unknown[] = [];

    const hooks = await OpencodeUpdateNotifier(
      {
        client: makeClient({
          showToastFn: async (args) => {
            toastCalls.push(args);
            return { data: true, error: null };
          },
        }) as never,
        project: {} as never,
        directory: "/tmp",
        worktree: "/tmp",
        experimental_workspace: { register: () => {} },
        serverUrl: new URL("http://localhost:1234"),
        $: {} as never,
      },
      {},
      {
        _runCheck: async (deps) => {
          checkCalledWith = deps;
          return [{ name: "pkg", pinned: "1.0.0", latest: "2.0.0" }];
        },
      },
    );

    await hooks["command.execute.before"]?.({
      command: "check-updates",
      sessionID: "s1",
      arguments: "",
    } as never, {} as never);

    expect(checkCalledWith).not.toBeNull();
    expect((checkCalledWith as { forceRefresh?: boolean }).forceRefresh).toBe(true);
    expect(toastCalls).toHaveLength(1);
  });

  test("command.execute.before ignores other commands", async () => {
    let checkCalled = false;

    const hooks = await OpencodeUpdateNotifier(
      {
        client: makeClient() as never,
        project: {} as never,
        directory: "/tmp",
        worktree: "/tmp",
        experimental_workspace: { register: () => {} },
        serverUrl: new URL("http://localhost:1234"),
        $: {} as never,
      },
      {},
      {
        _runCheck: async () => {
          checkCalled = true;
          return [];
        },
      },
    );

    await hooks["command.execute.before"]?.({
      command: "some-other-command",
      sessionID: "s1",
      arguments: "",
    } as never, {} as never);

    expect(checkCalled).toBe(false);
  });

  test("command.execute.before logs errors without throwing", async () => {
    const logCalls: unknown[] = [];

    const hooks = await OpencodeUpdateNotifier(
      {
        client: makeClient({
          logFn: async (args) => {
            logCalls.push(args);
            return { data: true, error: null };
          },
        }) as never,
        project: {} as never,
        directory: "/tmp",
        worktree: "/tmp",
        experimental_workspace: { register: () => {} },
        serverUrl: new URL("http://localhost:1234"),
        $: {} as never,
      },
      {},
      {
        _runCheck: async () => {
          throw new Error("registry down");
        },
      },
    );

    await expect(
      hooks["command.execute.before"]?.({
        command: "check-updates",
        sessionID: "s1",
        arguments: "",
      } as never, {} as never),
    ).resolves.toBeUndefined();

    expect(logCalls.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test test/index.test.ts
```

Expected: the three new tests fail — `hooks["command.execute.before"]` is undefined.

- [ ] **Step 3: Add `command.execute.before` hook to `src/index.ts`**

First, extend the `InternalDeps` type to accept the new optional `forceRefresh` field in the injected `_runCheck`. The existing type already matches since `forceRefresh` is an optional field on the deps object — no type change needed. The injected fake just needs to accept it.

Add `"command.execute.before"` to the return object of `OpencodeUpdateNotifier`, after the `config` hook:

```ts
    "command.execute.before": async (input: { command: string; sessionID: string; arguments: string }, _output: unknown) => {
      if (input.command !== "check-updates") return;

      try {
        const env = (k: string) => process.env[k];
        const fsReader = (p: string) => readFileSync(p, "utf-8");
        const fsExists = existsSync;
        const homeDir = () => os.homedir();

        const sources = [
          ...getGlobalConfigSources({ fsReader, fsExists, homeDir, env }),
          ...getCustomDirSources({ fsReader, fsExists, env }),
          getCustomConfigSource({ fsReader, fsExists, env }),
          getInlineConfigSource({ env }),
          ...getProjectConfigSources({
            fsReader,
            fsExists,
            startDir: input.worktree || input.directory,
          }),
          ...getManagedConfigSources({
            fsReader,
            fsExists,
            platformPaths: getManagedPlatformPaths(env),
          }),
        ].filter((s): s is NonNullable<typeof s> => s !== null);

        const rawEntries = loadPluginEntries({ sources, log });
        const { parsed: entries } = parseEntries(rawEntries);

        const doRunCheck = _internal?._runCheck ?? runCheck;

        const updates = await doRunCheck({
          entries,
          fetchLatest: (name) => fetchLatest(name, { fetch: globalThis.fetch, timeoutMs: 5000 }),
          readCache: () =>
            readCache({
              fsReader,
              fsExists,
              homeDir,
              env,
            }),
          writeCache: (cache) =>
            writeCache(
              {
                fsWriter: (p, content) => writeFileSync(p, content, "utf-8"),
                fsRename: (from, to) => renameSync(from, to),
                homeDir,
                env,
              },
              cache,
            ),
          now: Date.now(),
          ttlMs: CACHE_TTL_MS,
          log,
          forceRefresh: true,
        });

        if (updates.length > 0) {
          await notify({
            updates,
            showToast: async (toast) => {
              await input.client.tui.showToast({ body: toast });
            },
            log,
          });
        }
      } catch (err) {
        void log({
          service: "opencode-update-notifier",
          level: "error",
          message: "opencode-update-notifier: /check-updates error",
          extra: { error: String(err) },
        });
      }
    },
```

**Important:** The `command.execute.before` handler receives `input` as its first argument, but the `input` variable is already used for the outer plugin input (`input.client`, `input.worktree`, etc.). Rename the outer parameter from `input` to `pluginInput` throughout `src/index.ts` to avoid shadowing, or name the command handler's parameter `cmdInput`. Use `cmdInput`:

```ts
    "command.execute.before": async (cmdInput: { command: string; sessionID: string; arguments: string }, _output: unknown) => {
      if (cmdInput.command !== "check-updates") return;
      // ... rest uses `input` (the outer plugin input) for client/worktree/directory
```

Also replace `input.worktree || input.directory` in the command handler with the outer plugin input reference.

For the `notify` call, use `input.client` (the outer plugin input's client):

```ts
          await notify({
            updates,
            showToast: async (toast) => {
              await input.client.tui.showToast({ body: toast });
            },
            log,
          });
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test test/index.test.ts
```

Expected: all tests pass, including the three new slash command tests.

- [ ] **Step 5: Run the full test suite**

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 6: Run type check**

```bash
bun run typecheck
```

Expected: no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts test/index.test.ts
git commit -m "feat: handle /check-updates slash command via command.execute.before hook"
```

---

### Task 4: Final verification

- [ ] **Step 1: Run the full test suite one more time**

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 2: Run linter**

```bash
bun run lint
```

Expected: no lint errors (Biome).

- [ ] **Step 3: Run build**

```bash
bun run build
```

Expected: builds successfully to `dist/`.
