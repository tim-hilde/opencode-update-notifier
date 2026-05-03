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
      forceRefresh: true,
    });

    expect(registryCalled).toBe(true);
    expect(results).toEqual([{ name: "cached-pkg", pinned: "1.0.0", latest: "4.0.0" }]);
    expect(writtenCache?.entries["cached-pkg"]?.latest).toBe("4.0.0");
  });
});
