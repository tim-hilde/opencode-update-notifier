import { describe, expect, test } from "bun:test";
import { getEntry, readCache, setEntry, writeCache } from "../src/cache.ts";
import type { Cache, FsExists, FsReader, FsRename, FsWriter, HomeDir } from "../src/types.ts";

const EMPTY_CACHE: Cache = { version: 2, entries: { npm: {}, "git-github": {} } };
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

  test("returns empty v2 cache for v1 cache file (migration: discard)", () => {
    const v1Cache = { version: 1, entries: { "some-pkg": { latest: "1.0.0", fetchedAt: 0 } } };
    const fsReader: FsReader = () => JSON.stringify(v1Cache);
    const fsExists: FsExists = () => true;
    const homeDir: HomeDir = () => "/home/user";
    const result = readCache({ fsReader, fsExists, homeDir, env: () => undefined });
    expect(result).toEqual(EMPTY_CACHE);
  });

  test("returns empty v2 cache when entries buckets are missing", () => {
    const malformed = { version: 2, entries: { npm: {} } }; // missing git-github
    const fsReader: FsReader = () => JSON.stringify(malformed);
    const fsExists: FsExists = () => true;
    const homeDir: HomeDir = () => "/home/user";
    const result = readCache({ fsReader, fsExists, homeDir, env: () => undefined });
    expect(result).toEqual(EMPTY_CACHE);
  });

  test("returns empty cache when npm bucket is an array", () => {
    const result = readCache({
      fsReader: () =>
        JSON.stringify({ version: 2, entries: { npm: [], "git-github": {} } }),
      fsExists: () => true,
      homeDir: () => "/home/user",
      env: () => undefined,
    });
    expect(result).toEqual({ version: 2, entries: { npm: {}, "git-github": {} } });
  });

  test("returns parsed v2 cache intact with both buckets preserved", () => {
    const stored: Cache = {
      version: 2,
      entries: {
        npm: { "my-pkg": { latest: "2.0.0", fetchedAt: 12345 } },
        "git-github": { "owner/repo": { latest: "3.0.0", fetchedAt: 67890 } },
      },
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
  test("returns null when npm package not in cache", () => {
    expect(getEntry(EMPTY_CACHE, "npm", "missing-pkg", Date.now(), TTL_MS)).toBeNull();
  });

  test("returns null when git-github repo not in cache", () => {
    expect(getEntry(EMPTY_CACHE, "git-github", "owner/repo", Date.now(), TTL_MS)).toBeNull();
  });

  test("returns latest when npm entry is fresh", () => {
    const now = 1_000_000;
    const cache: Cache = {
      version: 2,
      entries: {
        npm: { "my-pkg": { latest: "1.2.3", fetchedAt: now - 1000 } },
        "git-github": {},
      },
    };
    expect(getEntry(cache, "npm", "my-pkg", now, TTL_MS)).toBe("1.2.3");
  });

  test("returns latest when git-github entry is fresh", () => {
    const now = 1_000_000;
    const cache: Cache = {
      version: 2,
      entries: {
        npm: {},
        "git-github": { "owner/repo": { latest: "3.0.0", fetchedAt: now - 1000 } },
      },
    };
    expect(getEntry(cache, "git-github", "owner/repo", now, TTL_MS)).toBe("3.0.0");
  });

  test("returns null when npm entry is stale (older than TTL)", () => {
    const now = 1_000_000;
    const fetchedAt = now - TTL_MS - 1;
    const cache: Cache = {
      version: 2,
      entries: {
        npm: { "my-pkg": { latest: "1.2.3", fetchedAt } },
        "git-github": {},
      },
    };
    expect(getEntry(cache, "npm", "my-pkg", now, TTL_MS)).toBeNull();
  });

  test("returns null when git-github entry is stale (older than TTL)", () => {
    const now = 1_000_000;
    const fetchedAt = now - TTL_MS - 1;
    const cache: Cache = {
      version: 2,
      entries: {
        npm: {},
        "git-github": { "owner/repo": { latest: "3.0.0", fetchedAt } },
      },
    };
    expect(getEntry(cache, "git-github", "owner/repo", now, TTL_MS)).toBeNull();
  });

  test("returns latest when entry is exactly at TTL boundary (fresh)", () => {
    const now = 1_000_000;
    const fetchedAt = now - TTL_MS; // exactly at TTL — still fresh
    const cache: Cache = {
      version: 2,
      entries: {
        npm: { "my-pkg": { latest: "1.2.3", fetchedAt } },
        "git-github": {},
      },
    };
    expect(getEntry(cache, "npm", "my-pkg", now, TTL_MS)).toBe("1.2.3");
  });
});

// --- setEntry ---
describe("setEntry", () => {
  test("adds a new npm entry (pure function)", () => {
    const now = 9999;
    const result = setEntry(EMPTY_CACHE, "npm", "new-pkg", "3.0.0", now);
    expect(result.entries.npm["new-pkg"]).toEqual({ latest: "3.0.0", fetchedAt: now });
  });

  test("adds a new git-github entry (pure function)", () => {
    const now = 9999;
    const result = setEntry(EMPTY_CACHE, "git-github", "owner/repo", "3.0.0", now);
    expect(result.entries["git-github"]["owner/repo"]).toEqual({ latest: "3.0.0", fetchedAt: now });
  });

  test("setEntry npm does not affect git-github bucket", () => {
    const now = 9999;
    const result = setEntry(EMPTY_CACHE, "npm", "my-pkg", "2.0.0", now);
    expect(result.entries["git-github"]).toEqual({});
  });

  test("setEntry git-github does not affect npm bucket", () => {
    const now = 9999;
    const result = setEntry(EMPTY_CACHE, "git-github", "owner/repo", "3.0.0", now);
    expect(result.entries.npm).toEqual({});
  });

  test("updates an existing npm entry", () => {
    const cache: Cache = {
      version: 2,
      entries: {
        npm: { "my-pkg": { latest: "1.0.0", fetchedAt: 0 } },
        "git-github": {},
      },
    };
    const now = 5000;
    const result = setEntry(cache, "npm", "my-pkg", "2.0.0", now);
    expect(result.entries.npm["my-pkg"]).toEqual({ latest: "2.0.0", fetchedAt: now });
  });

  test("does not mutate the original cache", () => {
    const original = structuredClone(EMPTY_CACHE);
    setEntry(EMPTY_CACHE, "npm", "pkg", "1.0.0", 1);
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

    writeCache({ fsWriter, fsRename, homeDir, env }, EMPTY_CACHE);

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

// --- round-trip ---
describe("round-trip", () => {
  test("writeCache then readCache preserves both buckets", () => {
    let stored = "";
    const fsWriter: FsWriter = (_path, content) => {
      stored = content;
    };
    const fsRename: FsRename = () => {};
    const homeDir: HomeDir = () => "/home/user";
    const env = () => undefined;

    const cache: Cache = {
      version: 2,
      entries: {
        npm: { "my-pkg": { latest: "2.0.0", fetchedAt: 1000 } },
        "git-github": { "owner/repo": { latest: "3.0.0", fetchedAt: 2000 } },
      },
    };

    writeCache({ fsWriter, fsRename, homeDir, env }, cache);

    const fsReader: FsReader = () => stored;
    const fsExists: FsExists = () => true;
    const result = readCache({ fsReader, fsExists, homeDir, env });

    expect(result).toEqual(cache);
  });
});
