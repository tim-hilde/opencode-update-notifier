# opencode-update-notifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and ship `opencode-update-notifier`, an OpenCode server plugin that notifies users via a TUI toast when their pinned npm plugins have newer versions available on npm.

**Architecture:** A server plugin (no TUI component) built in TypeScript with Bun. Eight focused source files handle config loading, parsing, caching, registry fetching, orchestration, and notification — all with injected dependencies so every unit is testable without touching real filesystem, network, or environment. A single aggregated toast is sent via `client.tui.showToast()` on the first `session.created` event per plugin lifecycle.

**Tech Stack:** TypeScript (strict), Bun, tsup (ESM bundle + types), `jsonc-parser`, `semver`, Biome, lefthook, Changesets, GitHub Actions

---

## File Structure

| Path | Action | Purpose |
|---|---|---|
| `package.json` | Create | Package manifest, scripts, deps |
| `tsconfig.json` | Create | TypeScript strict config |
| `tsup.config.ts` | Create | Build config (ESM, bundled deps, types) |
| `biome.json` | Create | Lint + format config |
| `lefthook.yml` | Create | Pre-commit and pre-push hooks |
| `.gitignore` | Create | Standard ignores |
| `.npmignore` | Create | Exclude test/docs from published package |
| `README.md` | Create | Installation, usage, cache location docs |
| `LICENSE` | Create | MIT license |
| `.changeset/config.json` | Create | Changesets config |
| `.github/workflows/ci.yml` | Create | CI: typecheck, lint, test, build |
| `.github/workflows/release.yml` | Create | Release: Changesets publish to npm |
| `src/types.ts` | Create | Shared types and dep interfaces |
| `src/parse.ts` | Create | `parseEntry` / `parseEntries` |
| `src/cache.ts` | Create | Read/write `~/.cache/opencode-update-notifier/cache.json` |
| `src/registry.ts` | Create | `fetchLatest` via npm registry API |
| `src/config/sources.ts` | Create | Per-source-type config file locators |
| `src/config/load.ts` | Create | Aggregate and dedupe plugin entries |
| `src/check.ts` | Create | Orchestrator: cache + registry + semver compare |
| `src/notify.ts` | Create | Format toast string and send via SDK client |
| `src/index.ts` | Create | Plugin entry, `hasRun` guard, wiring |
| `test/parse.test.ts` | Create | Tests for parse module |
| `test/cache.test.ts` | Create | Tests for cache module |
| `test/registry.test.ts` | Create | Tests for registry module |
| `test/config-sources.test.ts` | Create | Tests for config sources module |
| `test/config-load.test.ts` | Create | Tests for config load module |
| `test/check.test.ts` | Create | Tests for check orchestrator |
| `test/notify.test.ts` | Create | Tests for notify module |
| `test/index.test.ts` | Create | Tests for plugin entry (wiring + once-per-lifecycle) |

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`
- Create: `biome.json`
- Create: `lefthook.yml`
- Create: `.gitignore`
- Create: `.npmignore`

- [ ] **Step 1: Create `package.json`**

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
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "lint": "biome check src test",
    "format": "biome check --write src test",
    "release": "changeset publish"
  },
  "dependencies": {
    "jsonc-parser": "^3.3.1",
    "semver": "^7.6.3"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "@changesets/cli": "^2.27.12",
    "@opencode-ai/plugin": "^1.14.31",
    "@types/semver": "^7.5.8",
    "lefthook": "^1.11.13",
    "tsup": "^8.4.0",
    "typescript": "^5.8.3"
  },
  "peerDependencies": {
    "@opencode-ai/plugin": "*"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create `tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  bundle: true,
  noExternal: ["jsonc-parser", "semver"],
  external: ["@opencode-ai/plugin", "@opencode-ai/sdk"],
});
```

- [ ] **Step 4: Create `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "trailingCommas": "all"
    }
  }
}
```

- [ ] **Step 5: Create `lefthook.yml`**

```yaml
pre-commit:
  commands:
    biome-format:
      glob: "*.{ts}"
      run: bunx biome check --write {staged_files}
      stage_fixed: true
    typecheck:
      run: bun run typecheck

pre-push:
  commands:
    test:
      run: bun test
```

- [ ] **Step 6: Create `.gitignore`**

```
node_modules/
dist/
*.tgz
.DS_Store
```

- [ ] **Step 7: Create `.npmignore`**

```
src/
test/
docs/
*.test.ts
tsconfig.json
tsup.config.ts
biome.json
lefthook.yml
.changeset/
.github/
```

- [ ] **Step 8: Install dependencies**

```bash
bun install
```

Expected: `node_modules/` created, `bun.lockb` written.

- [ ] **Step 9: Verify typecheck runs (will pass with empty src)**

```bash
mkdir -p src && touch src/index.ts
bun run typecheck
```

Expected: no errors (empty file).

- [ ] **Step 10: Commit**

```bash
git add package.json tsconfig.json tsup.config.ts biome.json lefthook.yml .gitignore .npmignore bun.lockb src/index.ts
git commit -m "chore: project scaffold"
```

---

## Task 2: Shared Types (`src/types.ts`)

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write `src/types.ts`**

```ts
/** A plugin entry that has been successfully parsed. */
export type ParsedEntry = {
  name: string;
  version: string;
};

/** One plugin that has a newer version available. */
export type UpdateResult = {
  name: string;
  pinned: string;
  latest: string;
};

/** Persisted cache file schema. */
export type CacheEntry = {
  latest: string;
  fetchedAt: number;
};

export type Cache = {
  version: 1;
  entries: Record<string, CacheEntry>;
};

// --- Dependency interfaces ---

/** Reads an environment variable. Returns undefined if unset. */
export type EnvReader = (key: string) => string | undefined;

/** Reads a file's text content. Throws if the file does not exist or is unreadable. */
export type FsReader = (path: string) => string;

/** Writes text to a file, creating parent directories as needed. Throws on error. */
export type FsWriter = (path: string, content: string) => void;

/** Renames (atomically moves) a file. Throws on error. */
export type FsRename = (from: string, to: string) => void;

/** Returns true if a path exists on the filesystem. */
export type FsExists = (path: string) => boolean;

/** Returns the user's home directory. */
export type HomeDir = () => string;

/** Returns the current time as a Unix timestamp in milliseconds. */
export type Clock = () => number;

/** Structured log function matching @opencode-ai/sdk App.log body. */
export type Logger = (entry: {
  service: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  extra?: Record<string, unknown>;
}) => Promise<void>;

/** Fetches the latest published version of an npm package. */
export type RegistryFetcher = (
  name: string,
  opts: { fetch: typeof globalThis.fetch; timeoutMs: number },
) => Promise<string>;
```

- [ ] **Step 2: Verify typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add shared types"
```

---

## Task 3: Parse Module — TDD

**Files:**
- Create: `src/parse.ts`
- Create: `test/parse.test.ts`

- [ ] **Step 1: Write the failing tests in `test/parse.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { parseEntries, parseEntry } from "../src/parse.ts";

describe("parseEntry", () => {
  test("scoped + pinned", () => {
    expect(parseEntry("@scope/pkg@1.2.3")).toEqual({ name: "@scope/pkg", version: "1.2.3" });
  });

  test("unscoped + pinned", () => {
    expect(parseEntry("my-pkg@2.0.0")).toEqual({ name: "my-pkg", version: "2.0.0" });
  });

  test("pre-release version", () => {
    expect(parseEntry("my-pkg@1.0.0-beta.1")).toEqual({
      name: "my-pkg",
      version: "1.0.0-beta.1",
    });
  });

  test("scoped pre-release version", () => {
    expect(parseEntry("@scope/pkg@1.0.0-alpha.2")).toEqual({
      name: "@scope/pkg",
      version: "1.0.0-alpha.2",
    });
  });

  test("unscoped without version returns null", () => {
    expect(parseEntry("my-pkg")).toBeNull();
  });

  test("scoped without version returns null", () => {
    expect(parseEntry("@scope/pkg")).toBeNull();
  });

  test("local path returns null", () => {
    expect(parseEntry("./local/plugin")).toBeNull();
  });

  test("absolute path returns null", () => {
    expect(parseEntry("/absolute/path")).toBeNull();
  });

  test("empty string returns null", () => {
    expect(parseEntry("")).toBeNull();
  });

  test("bare @scope without package name returns null", () => {
    expect(parseEntry("@scope")).toBeNull();
  });
});

describe("parseEntries", () => {
  test("separates parsed entries from dropped entries", () => {
    const result = parseEntries([
      "@scope/pkg@1.0.0",
      "unpinned-pkg",
      "my-tool@3.0.0",
      "./local-plugin",
    ]);
    expect(result.parsed).toEqual([
      { name: "@scope/pkg", version: "1.0.0" },
      { name: "my-tool", version: "3.0.0" },
    ]);
    expect(result.dropped).toEqual(["unpinned-pkg", "./local-plugin"]);
  });

  test("empty input", () => {
    const result = parseEntries([]);
    expect(result.parsed).toEqual([]);
    expect(result.dropped).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm all tests fail**

```bash
bun test test/parse.test.ts
```

Expected: error about missing module `../src/parse.ts`.

- [ ] **Step 3: Write `src/parse.ts`**

```ts
import type { ParsedEntry } from "./types.ts";

const SCOPED_PINNED = /^(@[^/]+\/[^@]+)@([^@].*)$/;
const UNSCOPED_PINNED = /^([^@/][^@]*)@([^@].*)$/;

/**
 * Parses a single raw plugin entry string.
 * Returns { name, version } for scoped+pinned and unscoped+pinned entries.
 * Returns null for anything else (unpinned, local path, malformed).
 */
export function parseEntry(raw: string): ParsedEntry | null {
  let m = SCOPED_PINNED.exec(raw);
  if (m) return { name: m[1] as string, version: m[2] as string };

  m = UNSCOPED_PINNED.exec(raw);
  if (m) return { name: m[1] as string, version: m[2] as string };

  return null;
}

/** Parses an array of raw plugin strings, separating valid entries from dropped ones. */
export function parseEntries(raws: string[]): {
  parsed: ParsedEntry[];
  dropped: string[];
} {
  const parsed: ParsedEntry[] = [];
  const dropped: string[] = [];
  for (const raw of raws) {
    const result = parseEntry(raw);
    if (result) {
      parsed.push(result);
    } else {
      dropped.push(raw);
    }
  }
  return { parsed, dropped };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test test/parse.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/parse.ts test/parse.test.ts
git commit -m "feat: add parse module with TDD"
```

---

## Task 4: Cache Module — TDD

**Files:**
- Create: `src/cache.ts`
- Create: `test/cache.test.ts`

- [ ] **Step 1: Write failing tests in `test/cache.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { getEntry, readCache, setEntry, writeCache } from "../src/cache.ts";
import type { Cache, FsExists, FsReader, FsRename, FsWriter, HomeDir } from "../src/types.ts";

const EMPTY_CACHE: Cache = { version: 1, entries: {} };
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// --- readCache ---
describe("readCache", () => {
  test("returns empty cache when file does not exist", () => {
    const fsReader: FsReader = () => {
      throw new Error("ENOENT");
    };
    const fsExists: FsExists = () => false;
    const homeDir: HomeDir = () => "/home/user";
    const result = readCache({ fsReader, fsExists, homeDir, env: () => undefined });
    expect(result).toEqual(EMPTY_CACHE);
  });

  test("returns empty cache when file is malformed JSON", () => {
    const fsReader: FsReader = () => "not json at all {{{";
    const fsExists: FsExists = () => true;
    const homeDir: HomeDir = () => "/home/user";
    const result = readCache({ fsReader, fsExists, homeDir, env: () => undefined });
    expect(result).toEqual(EMPTY_CACHE);
  });

  test("returns empty cache when schema version does not match", () => {
    const fsReader: FsReader = () => JSON.stringify({ version: 99, entries: {} });
    const fsExists: FsExists = () => true;
    const homeDir: HomeDir = () => "/home/user";
    const result = readCache({ fsReader, fsExists, homeDir, env: () => undefined });
    expect(result).toEqual(EMPTY_CACHE);
  });

  test("returns parsed cache for valid file", () => {
    const stored: Cache = {
      version: 1,
      entries: { "some-pkg": { latest: "2.0.0", fetchedAt: 12345 } },
    };
    const fsReader: FsReader = () => JSON.stringify(stored);
    const fsExists: FsExists = () => true;
    const homeDir: HomeDir = () => "/home/user";
    const result = readCache({ fsReader, fsExists, homeDir, env: () => undefined });
    expect(result).toEqual(stored);
  });

  test("honors XDG_CACHE_HOME for cache path", () => {
    let readPath = "";
    const fsReader: FsReader = (p) => {
      readPath = p;
      throw new Error("ENOENT");
    };
    const fsExists: FsExists = () => false;
    const homeDir: HomeDir = () => "/home/user";
    const env = (k: string) => (k === "XDG_CACHE_HOME" ? "/custom/cache" : undefined);
    readCache({ fsReader, fsExists, homeDir, env });
    expect(readPath).toBe("/custom/cache/opencode-update-notifier/cache.json");
  });

  test("uses ~/.cache when XDG_CACHE_HOME is not set", () => {
    let readPath = "";
    const fsReader: FsReader = (p) => {
      readPath = p;
      throw new Error("ENOENT");
    };
    const fsExists: FsExists = () => false;
    const homeDir: HomeDir = () => "/home/user";
    readCache({ fsReader, fsExists, homeDir, env: () => undefined });
    expect(readPath).toBe("/home/user/.cache/opencode-update-notifier/cache.json");
  });
});

// --- getEntry ---
describe("getEntry", () => {
  test("returns null when package not in cache", () => {
    expect(getEntry(EMPTY_CACHE, "missing-pkg", Date.now(), TTL_MS)).toBeNull();
  });

  test("returns latest when entry is fresh", () => {
    const now = 1_000_000;
    const cache: Cache = {
      version: 1,
      entries: { "my-pkg": { latest: "1.2.3", fetchedAt: now - 1000 } },
    };
    expect(getEntry(cache, "my-pkg", now, TTL_MS)).toBe("1.2.3");
  });

  test("returns null when entry is stale (older than TTL)", () => {
    const now = 1_000_000;
    const fetchedAt = now - TTL_MS - 1; // 1ms past the TTL
    const cache: Cache = {
      version: 1,
      entries: { "my-pkg": { latest: "1.2.3", fetchedAt } },
    };
    expect(getEntry(cache, "my-pkg", now, TTL_MS)).toBeNull();
  });

  test("returns latest when entry is exactly at TTL boundary (fresh)", () => {
    const now = 1_000_000;
    const fetchedAt = now - TTL_MS; // exactly at TTL — still fresh
    const cache: Cache = {
      version: 1,
      entries: { "my-pkg": { latest: "1.2.3", fetchedAt } },
    };
    expect(getEntry(cache, "my-pkg", now, TTL_MS)).toBe("1.2.3");
  });
});

// --- setEntry ---
describe("setEntry", () => {
  test("adds a new entry to the cache (pure function)", () => {
    const now = 9999;
    const result = setEntry(EMPTY_CACHE, "new-pkg", "3.0.0", now);
    expect(result.entries["new-pkg"]).toEqual({ latest: "3.0.0", fetchedAt: now });
  });

  test("updates an existing entry", () => {
    const cache: Cache = {
      version: 1,
      entries: { "my-pkg": { latest: "1.0.0", fetchedAt: 0 } },
    };
    const now = 5000;
    const result = setEntry(cache, "my-pkg", "2.0.0", now);
    expect(result.entries["my-pkg"]).toEqual({ latest: "2.0.0", fetchedAt: now });
  });

  test("does not mutate the original cache", () => {
    const original = structuredClone(EMPTY_CACHE);
    setEntry(EMPTY_CACHE, "pkg", "1.0.0", 1);
    expect(EMPTY_CACHE).toEqual(original);
  });
});

// --- writeCache ---
describe("writeCache", () => {
  test("writes to temp file then renames atomically", () => {
    const written: Array<{ path: string; content: string }> = [];
    const renames: Array<{ from: string; to: string }> = [];
    const fsWriter: FsWriter = (path, content) => written.push({ path, content });
    const fsRename: FsRename = (from, to) => renames.push({ from, to });
    const homeDir: HomeDir = () => "/home/user";
    const env = () => undefined;

    const cache: Cache = { version: 1, entries: {} };
    writeCache({ fsWriter, fsRename, homeDir, env }, cache);

    expect(written).toHaveLength(1);
    expect(written[0]?.path).toMatch(/\.tmp$/);
    expect(renames).toHaveLength(1);
    expect(renames[0]?.from).toBe(written[0]?.path);
    expect(renames[0]?.to).toBe("/home/user/.cache/opencode-update-notifier/cache.json");
  });

  test("swallows write errors without throwing", () => {
    const fsWriter: FsWriter = () => {
      throw new Error("disk full");
    };
    const fsRename: FsRename = () => {};
    const homeDir: HomeDir = () => "/home/user";
    expect(() =>
      writeCache({ fsWriter, fsRename, homeDir, env: () => undefined }, EMPTY_CACHE),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
bun test test/cache.test.ts
```

Expected: error about missing module `../src/cache.ts`.

- [ ] **Step 3: Write `src/cache.ts`**

```ts
import path from "node:path";
import type { Cache, EnvReader, FsExists, FsReader, FsRename, FsWriter, HomeDir } from "./types.ts";

const CACHE_REL = "opencode-update-notifier/cache.json";
export const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const EMPTY_CACHE: Cache = { version: 1, entries: {} };

function cachePath(env: EnvReader, homeDir: HomeDir): string {
  const xdg = env("XDG_CACHE_HOME");
  const base = xdg ?? path.join(homeDir(), ".cache");
  return path.join(base, CACHE_REL);
}

export function readCache(deps: {
  fsReader: FsReader;
  fsExists: FsExists;
  homeDir: HomeDir;
  env: EnvReader;
}): Cache {
  const p = cachePath(deps.env, deps.homeDir);
  if (!deps.fsExists(p)) return structuredClone(EMPTY_CACHE);
  try {
    const raw = deps.fsReader(p);
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as Record<string, unknown>)["version"] !== 1
    ) {
      return structuredClone(EMPTY_CACHE);
    }
    return parsed as Cache;
  } catch {
    return structuredClone(EMPTY_CACHE);
  }
}

export function getEntry(
  cache: Cache,
  name: string,
  now: number,
  ttlMs: number,
): string | null {
  const entry = cache.entries[name];
  if (!entry) return null;
  if (now - entry.fetchedAt > ttlMs) return null;
  return entry.latest;
}

export function setEntry(cache: Cache, name: string, latest: string, now: number): Cache {
  return {
    ...cache,
    entries: {
      ...cache.entries,
      [name]: { latest, fetchedAt: now },
    },
  };
}

export function writeCache(
  deps: {
    fsWriter: FsWriter;
    fsRename: FsRename;
    homeDir: HomeDir;
    env: EnvReader;
  },
  cache: Cache,
): void {
  try {
    const target = cachePath(deps.env, deps.homeDir);
    const tmp = `${target}.tmp`;
    deps.fsWriter(tmp, JSON.stringify(cache, null, 2));
    deps.fsRename(tmp, target);
  } catch {
    // best-effort; swallow silently
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test test/cache.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/cache.ts test/cache.test.ts
git commit -m "feat: add cache module with TDD"
```

---

## Task 5: Registry Module — TDD

**Files:**
- Create: `src/registry.ts`
- Create: `test/registry.test.ts`

- [ ] **Step 1: Write failing tests in `test/registry.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { fetchLatest } from "../src/registry.ts";

function makeFetch(status: number, body: unknown): typeof fetch {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
}

describe("fetchLatest", () => {
  test("returns version field on success", async () => {
    const fakeFetch = makeFetch(200, { version: "1.5.0" });
    const result = await fetchLatest("my-pkg", { fetch: fakeFetch, timeoutMs: 5000 });
    expect(result).toBe("1.5.0");
  });

  test("returns version for scoped package", async () => {
    const fakeFetch = makeFetch(200, { version: "2.0.0" });
    const result = await fetchLatest("@scope/my-pkg", { fetch: fakeFetch, timeoutMs: 5000 });
    expect(result).toBe("2.0.0");
  });

  test("throws on non-2xx response, error includes package name", async () => {
    const fakeFetch = makeFetch(404, { error: "not found" });
    await expect(fetchLatest("missing-pkg", { fetch: fakeFetch, timeoutMs: 5000 })).rejects.toThrow(
      "missing-pkg",
    );
  });

  test("throws on 500 response, error includes package name", async () => {
    const fakeFetch = makeFetch(500, {});
    await expect(
      fetchLatest("@scope/bad-pkg", { fetch: fakeFetch, timeoutMs: 5000 }),
    ).rejects.toThrow("@scope/bad-pkg");
  });

  test("request URL encodes the package name", async () => {
    let capturedUrl = "";
    const capturingFetch: typeof fetch = async (url) => {
      capturedUrl = url.toString();
      return new Response(JSON.stringify({ version: "1.0.0" }), { status: 200 });
    };
    await fetchLatest("@scope/pkg", { fetch: capturingFetch, timeoutMs: 5000 });
    expect(capturedUrl).toBe("https://registry.npmjs.org/%40scope%2Fpkg/latest");
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
bun test test/registry.test.ts
```

Expected: error about missing module `../src/registry.ts`.

- [ ] **Step 3: Write `src/registry.ts`**

```ts
export async function fetchLatest(
  name: string,
  opts: { fetch: typeof globalThis.fetch; timeoutMs: number },
): Promise<string> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`;
  const signal = AbortSignal.timeout(opts.timeoutMs);
  const res = await opts.fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`fetchLatest(${name}): HTTP ${res.status}`);
  }
  const body = (await res.json()) as { version?: unknown };
  if (typeof body.version !== "string") {
    throw new Error(`fetchLatest(${name}): unexpected response shape`);
  }
  return body.version;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test test/registry.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/registry.ts test/registry.test.ts
git commit -m "feat: add registry module with TDD"
```

---

## Task 6: Config Sources — TDD

**Files:**
- Create: `src/config/sources.ts`
- Create: `test/config-sources.test.ts`
- Create: `test/fixtures/project/sub/dir/.gitignore` (empty file to represent a subdir)
- Create: `test/fixtures/project/opencode.json`

- [ ] **Step 1: Create test fixtures**

Create `test/fixtures/project/opencode.json`:
```json
{
  "plugin": ["fixture-plugin@1.0.0"]
}
```

Create `test/fixtures/project/sub/dir/` (empty directory — just needs to exist for path walking tests).

```bash
mkdir -p test/fixtures/project/sub/dir
echo '{"plugin":["fixture-plugin@1.0.0"]}' > test/fixtures/project/opencode.json
```

- [ ] **Step 2: Write failing tests in `test/config-sources.test.ts`**

```ts
import path from "node:path";
import { describe, expect, test } from "bun:test";
import {
  getCustomConfigSource,
  getCustomDirSources,
  getGlobalConfigSources,
  getInlineConfigSource,
  getManagedConfigSources,
  getProjectConfigSources,
} from "../src/config/sources.ts";
import type { EnvReader, FsExists, FsReader } from "../src/types.ts";

// helpers
function makeFs(files: Record<string, string>): { fsReader: FsReader; fsExists: FsExists } {
  return {
    fsReader: (p) => {
      if (p in files) return files[p] as string;
      throw new Error(`ENOENT: ${p}`);
    },
    fsExists: (p) => p in files,
  };
}

// --- getGlobalConfigSources ---
describe("getGlobalConfigSources", () => {
  test("returns .json source when only .json exists", () => {
    const { fsReader, fsExists } = makeFs({
      "/home/user/.config/opencode/opencode.json": '{"plugin":[]}',
    });
    const sources = getGlobalConfigSources({
      fsReader,
      fsExists,
      homeDir: () => "/home/user",
      env: () => undefined,
    });
    expect(sources).toHaveLength(1);
    expect(sources[0]?.path).toBe("/home/user/.config/opencode/opencode.json");
  });

  test("returns .jsonc source when only .jsonc exists", () => {
    const { fsReader, fsExists } = makeFs({
      "/home/user/.config/opencode/opencode.jsonc": "{}",
    });
    const sources = getGlobalConfigSources({
      fsReader,
      fsExists,
      homeDir: () => "/home/user",
      env: () => undefined,
    });
    expect(sources).toHaveLength(1);
    expect(sources[0]?.path).toBe("/home/user/.config/opencode/opencode.jsonc");
  });

  test("returns both when both .json and .jsonc exist", () => {
    const { fsReader, fsExists } = makeFs({
      "/home/user/.config/opencode/opencode.json": "{}",
      "/home/user/.config/opencode/opencode.jsonc": "{}",
    });
    const sources = getGlobalConfigSources({
      fsReader,
      fsExists,
      homeDir: () => "/home/user",
      env: () => undefined,
    });
    expect(sources).toHaveLength(2);
  });

  test("honors XDG_CONFIG_HOME", () => {
    const { fsReader, fsExists } = makeFs({
      "/custom/config/opencode/opencode.json": "{}",
    });
    const env: EnvReader = (k) => (k === "XDG_CONFIG_HOME" ? "/custom/config" : undefined);
    const sources = getGlobalConfigSources({
      fsReader,
      fsExists,
      homeDir: () => "/home/user",
      env,
    });
    expect(sources[0]?.path).toBe("/custom/config/opencode/opencode.json");
  });

  test("returns empty array when neither file exists", () => {
    const { fsReader, fsExists } = makeFs({});
    const sources = getGlobalConfigSources({
      fsReader,
      fsExists,
      homeDir: () => "/home/user",
      env: () => undefined,
    });
    expect(sources).toHaveLength(0);
  });
});

// --- getCustomDirSources ---
describe("getCustomDirSources", () => {
  test("returns sources from custom dir when OPENCODE_CONFIG_DIR is set", () => {
    const { fsReader, fsExists } = makeFs({
      "/custom/dir/opencode.json": "{}",
    });
    const env: EnvReader = (k) => (k === "OPENCODE_CONFIG_DIR" ? "/custom/dir" : undefined);
    const sources = getCustomDirSources({ fsReader, fsExists, env });
    expect(sources).toHaveLength(1);
    expect(sources[0]?.path).toBe("/custom/dir/opencode.json");
  });

  test("returns empty array when OPENCODE_CONFIG_DIR is not set", () => {
    const { fsReader, fsExists } = makeFs({});
    const sources = getCustomDirSources({ fsReader, fsExists, env: () => undefined });
    expect(sources).toHaveLength(0);
  });
});

// --- getCustomConfigSource ---
describe("getCustomConfigSource", () => {
  test("returns source when OPENCODE_CONFIG points to existing file", () => {
    const { fsReader, fsExists } = makeFs({
      "/path/to/my.json": '{"plugin":[]}',
    });
    const env: EnvReader = (k) => (k === "OPENCODE_CONFIG" ? "/path/to/my.json" : undefined);
    const source = getCustomConfigSource({ fsReader, fsExists, env });
    expect(source?.path).toBe("/path/to/my.json");
    expect(source?.content).toBe('{"plugin":[]}');
  });

  test("returns null when OPENCODE_CONFIG is not set", () => {
    const { fsReader, fsExists } = makeFs({});
    expect(getCustomConfigSource({ fsReader, fsExists, env: () => undefined })).toBeNull();
  });

  test("returns null when OPENCODE_CONFIG points to missing file", () => {
    const { fsReader, fsExists } = makeFs({});
    const env: EnvReader = (k) => (k === "OPENCODE_CONFIG" ? "/missing/file.json" : undefined);
    expect(getCustomConfigSource({ fsReader, fsExists, env })).toBeNull();
  });
});

// --- getInlineConfigSource ---
describe("getInlineConfigSource", () => {
  test("returns inline source when OPENCODE_CONFIG_CONTENT is set", () => {
    const env: EnvReader = (k) =>
      k === "OPENCODE_CONFIG_CONTENT" ? '{"plugin":["a@1.0.0"]}' : undefined;
    const source = getInlineConfigSource({ env });
    expect(source?.path).toBe("<inline>");
    expect(source?.content).toBe('{"plugin":["a@1.0.0"]}');
  });

  test("returns null when OPENCODE_CONFIG_CONTENT is not set", () => {
    expect(getInlineConfigSource({ env: () => undefined })).toBeNull();
  });

  test("returns null when OPENCODE_CONFIG_CONTENT is empty string", () => {
    const env: EnvReader = (k) => (k === "OPENCODE_CONFIG_CONTENT" ? "" : undefined);
    expect(getInlineConfigSource({ env })).toBeNull();
  });
});

// --- getProjectConfigSources ---
describe("getProjectConfigSources", () => {
  const fixtureRoot = path.resolve(import.meta.dir, "fixtures/project");

  test("finds opencode.json by walking up from subdirectory", () => {
    const { fsReader, fsExists } = makeFs({
      [path.join(fixtureRoot, "opencode.json")]: '{"plugin":["a@1.0.0"]}',
    });
    // start from a deep subdirectory
    const startDir = path.join(fixtureRoot, "sub", "dir");
    const sources = getProjectConfigSources({ fsReader, fsExists, startDir });
    expect(sources.some((s) => s.path === path.join(fixtureRoot, "opencode.json"))).toBe(true);
  });

  test("returns empty array when no opencode config found up to filesystem root", () => {
    const { fsReader, fsExists } = makeFs({});
    // Use a real dir unlikely to contain opencode.json to walk out of
    const sources = getProjectConfigSources({ fsReader, fsExists, startDir: "/tmp" });
    expect(sources).toHaveLength(0);
  });
});

// --- getManagedConfigSources (platform-agnostic test) ---
describe("getManagedConfigSources", () => {
  test("returns source when managed config file exists for given platform paths", () => {
    const platformPaths = ["/managed/opencode/opencode.json"];
    const { fsReader, fsExists } = makeFs({
      "/managed/opencode/opencode.json": "{}",
    });
    // We test the helper directly — it accepts explicit paths for testability
    const sources = getManagedConfigSources({ fsReader, fsExists, platformPaths });
    expect(sources).toHaveLength(1);
    expect(sources[0]?.path).toBe("/managed/opencode/opencode.json");
  });

  test("returns empty array when no managed config files exist", () => {
    const { fsReader, fsExists } = makeFs({});
    const sources = getManagedConfigSources({ fsReader, fsExists, platformPaths: ["/etc/opencode/opencode.json"] });
    expect(sources).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run to confirm tests fail**

```bash
bun test test/config-sources.test.ts
```

Expected: error about missing module `../src/config/sources.ts`.

- [ ] **Step 4: Write `src/config/sources.ts`**

```ts
import os from "node:os";
import path from "node:path";
import type { EnvReader, FsExists, FsReader } from "../types.ts";

export type ConfigSource = { path: string; content: string };

function readIfExists(
  fsReader: FsReader,
  fsExists: FsExists,
  filePath: string,
): ConfigSource | null {
  if (!fsExists(filePath)) return null;
  try {
    return { path: filePath, content: fsReader(filePath) };
  } catch {
    return null;
  }
}

export function getGlobalConfigSources(deps: {
  fsReader: FsReader;
  fsExists: FsExists;
  homeDir: () => string;
  env: EnvReader;
}): ConfigSource[] {
  const xdg = deps.env("XDG_CONFIG_HOME");
  const configBase = xdg ?? path.join(deps.homeDir(), ".config");
  const dir = path.join(configBase, "opencode");
  const results: ConfigSource[] = [];
  for (const name of ["opencode.json", "opencode.jsonc"]) {
    const s = readIfExists(deps.fsReader, deps.fsExists, path.join(dir, name));
    if (s) results.push(s);
  }
  return results;
}

export function getCustomDirSources(deps: {
  fsReader: FsReader;
  fsExists: FsExists;
  env: EnvReader;
}): ConfigSource[] {
  const dir = deps.env("OPENCODE_CONFIG_DIR");
  if (!dir) return [];
  const results: ConfigSource[] = [];
  for (const name of ["opencode.json", "opencode.jsonc"]) {
    const s = readIfExists(deps.fsReader, deps.fsExists, path.join(dir, name));
    if (s) results.push(s);
  }
  return results;
}

export function getCustomConfigSource(deps: {
  fsReader: FsReader;
  fsExists: FsExists;
  env: EnvReader;
}): ConfigSource | null {
  const filePath = deps.env("OPENCODE_CONFIG");
  if (!filePath) return null;
  return readIfExists(deps.fsReader, deps.fsExists, filePath);
}

export function getInlineConfigSource(deps: { env: EnvReader }): ConfigSource | null {
  const content = deps.env("OPENCODE_CONFIG_CONTENT");
  if (!content) return null;
  return { path: "<inline>", content };
}

export function getProjectConfigSources(deps: {
  fsReader: FsReader;
  fsExists: FsExists;
  startDir: string;
}): ConfigSource[] {
  const results: ConfigSource[] = [];
  let current = deps.startDir;
  // Walk up to filesystem root
  while (true) {
    for (const name of ["opencode.json", "opencode.jsonc"]) {
      const s = readIfExists(deps.fsReader, deps.fsExists, path.join(current, name));
      if (s) results.push(s);
    }
    // Stop if we found a .git directory at this level
    if (deps.fsExists(path.join(current, ".git"))) break;
    const parent = path.dirname(current);
    if (parent === current) break; // filesystem root
    current = parent;
  }
  return results;
}

/** Platform paths are passed in explicitly to allow testing without touching real OS paths. */
export function getManagedConfigSources(deps: {
  fsReader: FsReader;
  fsExists: FsExists;
  platformPaths: string[];
}): ConfigSource[] {
  const results: ConfigSource[] = [];
  for (const p of deps.platformPaths) {
    const s = readIfExists(deps.fsReader, deps.fsExists, p);
    if (s) results.push(s);
  }
  return results;
}

/** Returns the platform-specific managed config paths for the current OS. */
export function getManagedPlatformPaths(env: EnvReader): string[] {
  switch (process.platform) {
    case "darwin":
      return [
        "/Library/Application Support/opencode/opencode.json",
        "/Library/Application Support/opencode/opencode.jsonc",
      ];
    case "win32": {
      const programData = env("ProgramData") ?? "C:\\ProgramData";
      return [
        path.join(programData, "opencode", "opencode.json"),
        path.join(programData, "opencode", "opencode.jsonc"),
      ];
    }
    default:
      return ["/etc/opencode/opencode.json", "/etc/opencode/opencode.jsonc"];
  }
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
bun test test/config-sources.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/config/sources.ts test/config-sources.test.ts test/fixtures/project/opencode.json
git commit -m "feat: add config sources module with TDD"
```

---

## Task 7: Config Load Module — TDD

**Files:**
- Create: `src/config/load.ts`
- Create: `test/config-load.test.ts`

- [ ] **Step 1: Write failing tests in `test/config-load.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { loadPluginEntries } from "../src/config/load.ts";

describe("loadPluginEntries", () => {
  test("returns plugin entries from a single valid source", () => {
    const sources = [
      { path: "global.json", content: '{"plugin": ["@scope/pkg@1.0.0", "tool@2.0.0"]}' },
    ];
    const result = loadPluginEntries({ sources, log: async () => {} });
    expect(result).toEqual(["@scope/pkg@1.0.0", "tool@2.0.0"]);
  });

  test("aggregates entries from multiple sources", () => {
    const sources = [
      { path: "global.json", content: '{"plugin": ["pkg-a@1.0.0"]}' },
      { path: "project.json", content: '{"plugin": ["pkg-b@2.0.0"]}' },
    ];
    const result = loadPluginEntries({ sources, log: async () => {} });
    expect(result).toContain("pkg-a@1.0.0");
    expect(result).toContain("pkg-b@2.0.0");
  });

  test("deduplicates exact duplicate entries across sources", () => {
    const sources = [
      { path: "a.json", content: '{"plugin": ["pkg@1.0.0"]}' },
      { path: "b.json", content: '{"plugin": ["pkg@1.0.0"]}' },
    ];
    const result = loadPluginEntries({ sources, log: async () => {} });
    expect(result.filter((e) => e === "pkg@1.0.0")).toHaveLength(1);
  });

  test("handles JSONC with comments and trailing commas", () => {
    const sources = [
      {
        path: "config.jsonc",
        content: `{
          // a comment
          "plugin": [
            "pkg@1.0.0", // inline comment
          ],
        }`,
      },
    ];
    const result = loadPluginEntries({ sources, log: async () => {} });
    expect(result).toEqual(["pkg@1.0.0"]);
  });

  test("skips sources without a plugin array", () => {
    const sources = [{ path: "no-plugins.json", content: '{"theme": "dark"}' }];
    const result = loadPluginEntries({ sources, log: async () => {} });
    expect(result).toEqual([]);
  });

  test("skips sources with invalid JSON and logs the error", async () => {
    const logged: string[] = [];
    const sources = [{ path: "broken.json", content: "not { json" }];
    const result = loadPluginEntries({
      sources,
      log: async (entry) => {
        logged.push(entry.message);
      },
    });
    expect(result).toEqual([]);
    // allow the async log to flush
    await new Promise((r) => setTimeout(r, 0));
    expect(logged.some((m) => m.includes("broken.json"))).toBe(true);
  });

  test("ignores non-string entries inside plugin array", () => {
    const sources = [
      { path: "mixed.json", content: '{"plugin": ["valid@1.0.0", 42, null, {"not": "a string"}]}' },
    ];
    const result = loadPluginEntries({ sources, log: async () => {} });
    expect(result).toEqual(["valid@1.0.0"]);
  });

  test("returns empty array when sources list is empty", () => {
    expect(loadPluginEntries({ sources: [], log: async () => {} })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
bun test test/config-load.test.ts
```

Expected: error about missing module `../src/config/load.ts`.

- [ ] **Step 3: Write `src/config/load.ts`**

```ts
import { parse } from "jsonc-parser";
import type { ConfigSource } from "./sources.ts";
import type { Logger } from "../types.ts";

export function loadPluginEntries(deps: {
  sources: ConfigSource[];
  log: Logger;
}): string[] {
  const all: string[] = [];

  for (const source of deps.sources) {
    try {
      const errors: unknown[] = [];
      const parsed = parse(source.content, errors as Parameters<typeof parse>[1]) as unknown;

      if (errors.length > 0) {
        // jsonc-parser populates the errors array for parse failures
        void deps.log({
          service: "opencode-update-notifier",
          level: "warn",
          message: `Failed to parse config source: ${source.path}`,
          extra: { errors },
        });
        continue;
      }

      if (typeof parsed !== "object" || parsed === null) continue;
      const plugin = (parsed as Record<string, unknown>)["plugin"];
      if (!Array.isArray(plugin)) continue;

      for (const entry of plugin) {
        if (typeof entry === "string") all.push(entry);
      }
    } catch (err) {
      void deps.log({
        service: "opencode-update-notifier",
        level: "warn",
        message: `Failed to parse config source: ${source.path}`,
        extra: { error: String(err) },
      });
    }
  }

  // Deduplicate by exact identity
  return [...new Set(all)];
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test test/config-load.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config/load.ts test/config-load.test.ts
git commit -m "feat: add config load module with TDD"
```

---

## Task 8: Check Orchestrator — TDD

**Files:**
- Create: `src/check.ts`
- Create: `test/check.test.ts`

- [ ] **Step 1: Write failing tests in `test/check.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { runCheck } from "../src/check.ts";
import type { Cache, Logger, ParsedEntry } from "../src/types.ts";

const TTL_MS = 6 * 60 * 60 * 1000;
const NOW = 1_000_000_000;

const noopLog: Logger = async () => {};

function makeRegistryFetcher(map: Record<string, string>): (name: string) => Promise<string> {
  return async (name) => {
    if (name in map) return map[name] as string;
    throw new Error(`not found: ${name}`);
  };
}

describe("runCheck", () => {
  test("returns update when latest > pinned", async () => {
    const entries: ParsedEntry[] = [{ name: "pkg-a", version: "1.0.0" }];
    const fetchLatest = makeRegistryFetcher({ "pkg-a": "2.0.0" });
    const initialCache: Cache = { version: 1, entries: {} };
    let writtenCache: Cache | null = null;

    const results = await runCheck({
      entries,
      fetchLatest,
      readCache: () => initialCache,
      writeCache: (c) => {
        writtenCache = c;
      },
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
    });

    expect(results).toEqual([{ name: "pkg-a", pinned: "1.0.0", latest: "2.0.0" }]);
    expect(writtenCache?.entries["pkg-a"]?.latest).toBe("2.0.0");
  });

  test("returns no update when latest === pinned", async () => {
    const entries: ParsedEntry[] = [{ name: "pkg-a", version: "1.0.0" }];
    const fetchLatest = makeRegistryFetcher({ "pkg-a": "1.0.0" });
    const results = await runCheck({
      entries,
      fetchLatest,
      readCache: () => ({ version: 1, entries: {} }),
      writeCache: () => {},
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
    });
    expect(results).toHaveLength(0);
  });

  test("returns no update when pinned is GREATER than latest (user on pre-release)", async () => {
    const entries: ParsedEntry[] = [{ name: "pkg-a", version: "2.0.0-beta.1" }];
    const fetchLatest = makeRegistryFetcher({ "pkg-a": "1.9.0" });
    const results = await runCheck({
      entries,
      fetchLatest,
      readCache: () => ({ version: 1, entries: {} }),
      writeCache: () => {},
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
    });
    expect(results).toHaveLength(0);
  });

  test("uses cache when entry is fresh, does NOT call registry", async () => {
    const entries: ParsedEntry[] = [{ name: "cached-pkg", version: "1.0.0" }];
    const initialCache: Cache = {
      version: 1,
      entries: { "cached-pkg": { latest: "3.0.0", fetchedAt: NOW - 1000 } },
    };
    let registryCalled = false;
    const fetchLatest = async (_name: string) => {
      registryCalled = true;
      return "99.0.0";
    };

    const results = await runCheck({
      entries,
      fetchLatest,
      readCache: () => initialCache,
      writeCache: () => {},
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
    });

    expect(registryCalled).toBe(false);
    expect(results).toEqual([{ name: "cached-pkg", pinned: "1.0.0", latest: "3.0.0" }]);
  });

  test("picks max pinned version when same package appears multiple times", async () => {
    // If "pkg" appears at both 1.0.0 and 2.0.0, compare against 2.0.0 (max)
    const entries: ParsedEntry[] = [
      { name: "pkg", version: "1.0.0" },
      { name: "pkg", version: "2.0.0" },
    ];
    const fetchLatest = makeRegistryFetcher({ pkg: "2.5.0" });
    const results = await runCheck({
      entries,
      fetchLatest,
      readCache: () => ({ version: 1, entries: {} }),
      writeCache: () => {},
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
    });
    // Update is against the max pinned (2.0.0), so 2.5.0 > 2.0.0 → update
    expect(results).toEqual([{ name: "pkg", pinned: "2.0.0", latest: "2.5.0" }]);
  });

  test("continues with other packages when one registry call fails", async () => {
    const entries: ParsedEntry[] = [
      { name: "good-pkg", version: "1.0.0" },
      { name: "bad-pkg", version: "1.0.0" },
    ];
    const fetchLatest = async (name: string) => {
      if (name === "bad-pkg") throw new Error("network error");
      return "2.0.0";
    };
    const results = await runCheck({
      entries,
      fetchLatest,
      readCache: () => ({ version: 1, entries: {} }),
      writeCache: () => {},
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
    });
    // good-pkg succeeds; bad-pkg is skipped
    expect(results).toEqual([{ name: "good-pkg", pinned: "1.0.0", latest: "2.0.0" }]);
  });

  test("returns empty array when entries is empty", async () => {
    const results = await runCheck({
      entries: [],
      fetchLatest: async () => "99.0.0",
      readCache: () => ({ version: 1, entries: {} }),
      writeCache: () => {},
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
    });
    expect(results).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
bun test test/check.test.ts
```

Expected: error about missing module `../src/check.ts`.

- [ ] **Step 3: Write `src/check.ts`**

```ts
import { gt as semverGt, maxSatisfying as semverMaxSatisfying } from "semver";
import { CACHE_TTL_MS, getEntry, setEntry } from "./cache.ts";
import type { Cache, Logger, ParsedEntry, UpdateResult } from "./types.ts";

export async function runCheck(deps: {
  entries: ParsedEntry[];
  fetchLatest: (name: string) => Promise<string>;
  readCache: () => Cache;
  writeCache: (cache: Cache) => void;
  now: number;
  ttlMs: number;
  log: Logger;
}): Promise<UpdateResult[]> {
  if (deps.entries.length === 0) return [];

  // Group entries by name, keeping the highest pinned version per name
  const maxVersionByName = new Map<string, string>();
  for (const entry of deps.entries) {
    const existing = maxVersionByName.get(entry.name);
    if (!existing) {
      maxVersionByName.set(entry.name, entry.version);
    } else {
      const max = semverMaxSatisfying([existing, entry.version], "*") ?? existing;
      maxVersionByName.set(entry.name, max);
    }
  }

  let cache = deps.readCache();

  // Determine which names need a registry fetch
  const names = [...maxVersionByName.keys()];
  const fetchQueue: string[] = [];
  const cachedLatest = new Map<string, string>();

  for (const name of names) {
    const fresh = getEntry(cache, name, deps.now, deps.ttlMs);
    if (fresh !== null) {
      cachedLatest.set(name, fresh);
    } else {
      fetchQueue.push(name);
    }
  }

  // Fetch stale/missing entries in parallel
  const fetchResults = await Promise.allSettled(
    fetchQueue.map(async (name) => {
      const latest = await deps.fetchLatest(name);
      return { name, latest };
    }),
  );

  for (const result of fetchResults) {
    if (result.status === "fulfilled") {
      cache = setEntry(cache, result.value.name, result.value.latest, deps.now);
      cachedLatest.set(result.value.name, result.value.latest);
    } else {
      void deps.log({
        service: "opencode-update-notifier",
        level: "warn",
        message: `Failed to fetch latest version`,
        extra: { error: String(result.reason) },
      });
    }
  }

  deps.writeCache(cache);

  // Compare pinned vs latest
  const updates: UpdateResult[] = [];
  for (const [name, pinned] of maxVersionByName) {
    const latest = cachedLatest.get(name);
    if (!latest) continue;
    if (semverGt(latest, pinned)) {
      updates.push({ name, pinned, latest });
    }
  }

  return updates;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test test/check.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/check.ts test/check.test.ts
git commit -m "feat: add check orchestrator with TDD"
```

---

## Task 9: Notify Module — TDD

**Files:**
- Create: `src/notify.ts`
- Create: `test/notify.test.ts`

- [ ] **Step 1: Write failing tests in `test/notify.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { formatToastMessage, notify } from "../src/notify.ts";
import type { Logger, UpdateResult } from "../src/types.ts";

const noopLog: Logger = async () => {};

describe("formatToastMessage", () => {
  test("single update", () => {
    const updates: UpdateResult[] = [{ name: "pkg-a", pinned: "1.0.0", latest: "2.0.0" }];
    expect(formatToastMessage(updates)).toBe("Plugin update available: pkg-a 1.0.0 → 2.0.0");
  });

  test("two updates (no truncation)", () => {
    const updates: UpdateResult[] = [
      { name: "pkg-a", pinned: "1.0.0", latest: "2.0.0" },
      { name: "pkg-b", pinned: "3.0.0", latest: "4.0.0" },
    ];
    expect(formatToastMessage(updates)).toBe(
      "2 plugin updates available: pkg-a 1.0.0 → 2.0.0, pkg-b 3.0.0 → 4.0.0",
    );
  });

  test("three updates (no truncation)", () => {
    const updates: UpdateResult[] = [
      { name: "pkg-a", pinned: "1.0.0", latest: "2.0.0" },
      { name: "pkg-b", pinned: "3.0.0", latest: "4.0.0" },
      { name: "pkg-c", pinned: "5.0.0", latest: "6.0.0" },
    ];
    expect(formatToastMessage(updates)).toBe(
      "3 plugin updates available: pkg-a 1.0.0 → 2.0.0, pkg-b 3.0.0 → 4.0.0, pkg-c 5.0.0 → 6.0.0",
    );
  });

  test("five updates (truncated after 3)", () => {
    const updates: UpdateResult[] = [
      { name: "pkg-a", pinned: "1.0.0", latest: "2.0.0" },
      { name: "pkg-b", pinned: "1.0.0", latest: "2.0.0" },
      { name: "pkg-c", pinned: "1.0.0", latest: "2.0.0" },
      { name: "pkg-d", pinned: "1.0.0", latest: "2.0.0" },
      { name: "pkg-e", pinned: "1.0.0", latest: "2.0.0" },
    ];
    expect(formatToastMessage(updates)).toBe(
      "5 plugin updates available: pkg-a 1.0.0 → 2.0.0, pkg-b 1.0.0 → 2.0.0, pkg-c 1.0.0 → 2.0.0, +2 more",
    );
  });
});

describe("notify", () => {
  test("does nothing when updates array is empty", async () => {
    const toastCalls: unknown[] = [];
    await notify({
      updates: [],
      showToast: async (t) => { toastCalls.push(t); },
      log: noopLog,
    });
    expect(toastCalls).toHaveLength(0);
  });

  test("calls showToast with correct message and variant for one update", async () => {
    const toastCalls: unknown[] = [];
    const logCalls: unknown[] = [];
    await notify({
      updates: [{ name: "pkg-a", pinned: "1.0.0", latest: "2.0.0" }],
      showToast: async (t) => { toastCalls.push(t); },
      log: async (e) => { logCalls.push(e); },
    });
    expect(toastCalls).toHaveLength(1);
    expect((toastCalls[0] as { message: string; variant: string }).message).toBe(
      "Plugin update available: pkg-a 1.0.0 → 2.0.0",
    );
    expect((toastCalls[0] as { variant: string }).variant).toBe("info");
    expect(logCalls).toHaveLength(1);
  });

  test("calls showToast even if log call fails", async () => {
    const toastCalls: unknown[] = [];
    await notify({
      updates: [{ name: "pkg-a", pinned: "1.0.0", latest: "2.0.0" }],
      showToast: async (t) => { toastCalls.push(t); },
      log: async () => { throw new Error("log failed"); },
    });
    expect(toastCalls).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
bun test test/notify.test.ts
```

Expected: error about missing module `../src/notify.ts`.

- [ ] **Step 3: Write `src/notify.ts`**

```ts
import type { Logger, UpdateResult } from "./types.ts";

export type ToastInput = {
  title?: string;
  message: string;
  variant: "info" | "success" | "warning" | "error";
  duration?: number;
};

export function formatToastMessage(updates: UpdateResult[]): string {
  const inline = updates
    .slice(0, 3)
    .map((u) => `${u.name} ${u.pinned} → ${u.latest}`)
    .join(", ");

  if (updates.length === 1) {
    return `Plugin update available: ${inline}`;
  }

  const suffix = updates.length > 3 ? `, +${updates.length - 3} more` : "";
  return `${updates.length} plugin updates available: ${inline}${suffix}`;
}

export async function notify(deps: {
  updates: UpdateResult[];
  showToast: (toast: ToastInput) => Promise<void>;
  log: Logger;
}): Promise<void> {
  if (deps.updates.length === 0) return;

  const message = formatToastMessage(deps.updates);

  await deps.showToast({ message, variant: "info" });

  try {
    await deps.log({
      service: "opencode-update-notifier",
      level: "info",
      message,
      extra: { updates: deps.updates },
    });
  } catch {
    // log failure must not suppress toast
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test test/notify.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/notify.ts test/notify.test.ts
git commit -m "feat: add notify module with TDD"
```

---

## Task 10: Plugin Entry — TDD + Wiring

**Files:**
- Modify: `src/index.ts`
- Create: `test/index.test.ts`

- [ ] **Step 1: Write failing tests in `test/index.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import type { Event } from "@opencode-ai/sdk";
import { OpencodeUpdateNotifier } from "../src/index.ts";

// Minimal fake client shaped like the subset we actually use
function makeClient(overrides?: {
  showToastFn?: () => Promise<{ data: boolean; error: null }>;
  logFn?: () => Promise<{ data: boolean; error: null }>;
}) {
  return {
    tui: {
      showToast: overrides?.showToastFn ?? (async () => ({ data: true, error: null })),
    },
    app: {
      log: overrides?.logFn ?? (async () => ({ data: true, error: null })),
    },
  };
}

// Fire the event hook with a session.created event
async function fireSessionCreated(
  hooks: { event?: (input: { event: Event }) => Promise<void> },
) {
  await hooks.event?.({
    event: { type: "session.created", properties: { info: {} as never } } as Event,
  });
}

describe("OpencodeUpdateNotifier plugin", () => {
  test("runs check only once across multiple session.created events", async () => {
    let checkCount = 0;

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
      // Inject a fake runCheck via internal dep injection escape hatch
      {
        _runCheck: async () => {
          checkCount++;
          return [];
        },
      },
    );

    await fireSessionCreated(hooks);
    await fireSessionCreated(hooks);
    await fireSessionCreated(hooks);

    expect(checkCount).toBe(1);
  });

  test("ignores non-session.created events", async () => {
    let checkCount = 0;
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
          checkCount++;
          return [];
        },
      },
    );

    await hooks.event?.({
      event: { type: "session.updated", properties: { info: {} as never } } as Event,
    });

    expect(checkCount).toBe(0);
  });

  test("does not throw when runCheck throws", async () => {
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
          throw new Error("catastrophic failure");
        },
      },
    );

    // Must not throw
    await expect(fireSessionCreated(hooks)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
bun test test/index.test.ts
```

Expected: errors about missing module `../src/index.ts` or missing named exports.

- [ ] **Step 3: Write `src/index.ts`**

```ts
import os from "node:os";
import path from "node:path";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import type { Event } from "@opencode-ai/sdk";
import type { Plugin, PluginInput, PluginOptions } from "@opencode-ai/plugin";
import { CACHE_TTL_MS, readCache, writeCache } from "./cache.ts";
import { runCheck } from "./check.ts";
import { loadPluginEntries } from "./config/load.ts";
import {
  getCustomConfigSource,
  getCustomDirSources,
  getGlobalConfigSources,
  getInlineConfigSource,
  getManagedConfigSources,
  getManagedPlatformPaths,
  getProjectConfigSources,
} from "./config/sources.ts";
import { notify } from "./notify.ts";
import { parseEntries } from "./parse.ts";
import { fetchLatest } from "./registry.ts";
import type { UpdateResult } from "./types.ts";

type InternalDeps = {
  _runCheck?: (deps: {
    entries: ReturnType<typeof parseEntries>["parsed"];
    fetchLatest: (name: string) => Promise<string>;
    readCache: () => ReturnType<typeof readCache>;
    writeCache: (cache: ReturnType<typeof readCache>) => void;
    now: number;
    ttlMs: number;
    log: ReturnType<typeof makeLogger>;
  }) => Promise<UpdateResult[]>;
};

function makeLogger(client: PluginInput["client"]) {
  return async (entry: {
    service: string;
    level: "debug" | "info" | "warn" | "error";
    message: string;
    extra?: Record<string, unknown>;
  }) => {
    await client.app.log({ body: entry });
  };
}

export const OpencodeUpdateNotifier: Plugin = async (
  input: PluginInput,
  _options?: PluginOptions,
  _internal?: InternalDeps,
) => {
  let hasRun = false;
  const log = makeLogger(input.client);

  return {
    event: async ({ event }: { event: Event }) => {
      if (event.type !== "session.created") return;
      if (hasRun) return;
      hasRun = true;

      try {
        const env = (k: string) => process.env[k];
        const fsReader = (p: string) => readFileSync(p, "utf-8");
        const fsExists = existsSync;
        const homeDir = () => os.homedir();

        // Collect all config sources
        const sources = [
          ...getGlobalConfigSources({ fsReader, fsExists, homeDir, env }),
          ...getCustomDirSources({ fsReader, fsExists, env }),
          getCustomConfigSource({ fsReader, fsExists, env }),
          getInlineConfigSource({ env }),
          ...getProjectConfigSources({ fsReader, fsExists, startDir: input.worktree }),
          ...getManagedConfigSources({
            fsReader,
            fsExists,
            platformPaths: getManagedPlatformPaths(env),
          }),
        ].filter((s): s is NonNullable<typeof s> => s !== null);

        // Load and parse plugin entries
        const rawEntries = loadPluginEntries({ sources, log });
        const { parsed: entries, dropped } = parseEntries(rawEntries);

        if (dropped.length > 0) {
          void log({
            service: "opencode-update-notifier",
            level: "debug",
            message: `Skipping ${dropped.length} unpinned/unrecognized plugin entries`,
            extra: { dropped },
          });
        }

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
        });

        if (updates.length > 0) {
          await notify({
            updates,
            showToast: async (toast) => {
              await input.client.tui.showToast({ body: { ...toast } });
            },
            log,
          });
        }
      } catch (err) {
        void log({
          service: "opencode-update-notifier",
          level: "error",
          message: `opencode-update-notifier: unexpected error`,
          extra: { error: String(err) },
        });
      }
    },
  };
};

export default OpencodeUpdateNotifier;
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test test/index.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Run all tests to confirm the full suite is green**

```bash
bun test
```

Expected: all test files pass with zero failures.

- [ ] **Step 6: Run typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 7: Run build**

```bash
bun run build
```

Expected: `dist/index.js` and `dist/index.d.ts` created.

- [ ] **Step 8: Commit**

```bash
git add src/index.ts test/index.test.ts dist/
git commit -m "feat: add plugin entry with hasRun guard and wiring"
```

---

## Task 11: README, LICENSE, and Changesets Setup

**Files:**
- Create: `README.md`
- Create: `LICENSE`
- Create: `.changeset/config.json`

- [ ] **Step 1: Create `README.md`**

```markdown
# opencode-update-notifier

An [OpenCode](https://opencode.ai) plugin that checks if your pinned npm plugins have newer versions available and shows a TUI notification.

## What it does

On the first session start after OpenCode loads, this plugin:

1. Reads all your OpenCode config files to find version-pinned plugin entries.
2. Queries the npm registry for the latest version of each pinned plugin.
3. Shows a single aggregated toast notification if any plugins have updates available.
4. Caches the registry results locally for 6 hours.

It does **not** auto-update anything. You decide when to run your package manager.

## Installation

Add `opencode-update-notifier` to your OpenCode config:

```jsonc
// ~/.config/opencode/opencode.json
{
  "plugin": [
    "opencode-update-notifier@latest"
  ]
}
```

## Cache

Results are cached at `~/.cache/opencode-update-notifier/cache.json` (or `$XDG_CACHE_HOME/opencode-update-notifier/cache.json`).

To force a fresh registry check, delete this file:

```sh
rm ~/.cache/opencode-update-notifier/cache.json
```

## How update detection works

Only **pinned** plugin entries are checked — entries in the format `@scope/name@version` or `name@version`. Unpinned entries (e.g. `my-plugin` or `./local-plugin`) are silently ignored.

## License

MIT © Tim Hildebrandt
```

- [ ] **Step 2: Create `LICENSE`**

```
MIT License

Copyright (c) 2026 Tim Hildebrandt

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 3: Initialize Changesets**

```bash
bunx changeset init
```

Expected: `.changeset/config.json` and `.changeset/README.md` created.

- [ ] **Step 4: Edit `.changeset/config.json`** to set access to public:

Open `.changeset/config.json` and ensure it contains:
```json
{
  "$schema": "https://unpkg.com/@changesets/config/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

- [ ] **Step 5: Commit**

```bash
git add README.md LICENSE .changeset/
git commit -m "docs: add README, LICENSE, and changesets config"
```

---

## Task 12: CI and Release Workflows

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  ci:
    name: CI (Node ${{ matrix.node-version }})
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: ["18", "20"]

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2

      - name: Setup Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Type check
        run: bun run typecheck

      - name: Lint and format check
        run: bunx biome ci src test

      - name: Test
        run: bun test

      - name: Build
        run: bun run build
```

- [ ] **Step 2: Create `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    branches: [main]

concurrency: ${{ github.workflow }}-${{ github.ref }}

permissions:
  contents: write
  pull-requests: write
  id-token: write

jobs:
  release:
    name: Release
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          registry-url: "https://registry.npmjs.org"

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Build
        run: bun run build

      - name: Create Release PR or Publish to npm
        uses: changesets/action@v1
        with:
          publish: bun run release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 3: Commit**

```bash
git add .github/
git commit -m "ci: add CI and release workflows"
```

---

## Task 13: Final Verification

- [ ] **Step 1: Run all tests**

```bash
bun test
```

Expected: all tests pass, zero failures.

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: no TypeScript errors.

- [ ] **Step 3: Run Biome lint/format check**

```bash
bunx biome ci src test
```

Expected: no lint or format issues.

- [ ] **Step 4: Run build**

```bash
bun run build
```

Expected: `dist/index.js` and `dist/index.d.ts` present.

- [ ] **Step 5: Verify dist files look correct**

```bash
head -5 dist/index.js
ls dist/
```

Expected: `dist/` contains `index.js`, `index.d.ts`, and source maps.

- [ ] **Step 6: Create first changeset for 0.1.0**

```bash
bunx changeset
```

When prompted:
- Select `opencode-update-notifier`
- Choose `minor` (this is the first real feature release)
- Summary: `Initial release — notifies when pinned OpenCode plugins have newer versions on npm`

- [ ] **Step 7: Commit changeset**

```bash
git add .changeset/
git commit -m "chore: add changeset for 0.1.0"
```

---

## Definition of Done Checklist

Before considering this complete, verify:

- [ ] All 8 test files pass under `bun test`
- [ ] `bun run typecheck` passes with zero errors
- [ ] `bunx biome ci src test` passes with zero diffs
- [ ] `bun run build` produces `dist/index.js` and `dist/index.d.ts`
- [ ] README documents installation, behavior, and the cache location
- [ ] CI workflow exists at `.github/workflows/ci.yml`
- [ ] Release workflow exists at `.github/workflows/release.yml`
- [ ] A `0.1.0` changeset exists in `.changeset/`
