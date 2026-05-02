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
