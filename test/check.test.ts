import { describe, expect, test } from "bun:test";
import { runCheck } from "../src/check.ts";
import type { Cache, Logger, ParsedEntry } from "../src/types.ts";

const TTL_MS = 6 * 60 * 60 * 1000;
const NOW = 1_000_000_000;

const noopLog: Logger = async () => {};

function makeNpmFetcher(map: Record<string, string>): (name: string) => Promise<string> {
  return async (name) => {
    if (name in map) return map[name] as string;
    throw new Error(`not found: ${name}`);
  };
}

function makeGithubFetcher(
  map: Record<string, string>,
): (owner: string, repo: string) => Promise<string> {
  return async (owner, repo) => {
    const key = `${owner}/${repo}`;
    if (key in map) return map[key] as string;
    throw new Error(`not found: ${key}`);
  };
}

function emptyCache(): Cache {
  return { version: 2, entries: { npm: {}, "git-github": {} } };
}

describe("runCheck", () => {
  test("returns update when latest > pinned", async () => {
    const entries: ParsedEntry[] = [
      { source: "npm", name: "pkg-a", version: "1.0.0", configOrigin: "global" },
    ];
    const fetchLatest = makeNpmFetcher({ "pkg-a": "2.0.0" });
    const fetchLatestGithubTag = makeGithubFetcher({});
    const initialCache = emptyCache();
    let writtenCache: Cache | null = null;

    const results = await runCheck({
      entries,
      fetchLatest,
      fetchLatestGithubTag,
      readCache: () => initialCache,
      writeCache: (c) => {
        writtenCache = c;
      },
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
    });

    expect(results).toEqual([
      { source: "npm", name: "pkg-a", pinned: "1.0.0", latest: "2.0.0", configOrigin: "global" },
    ]);
    expect(writtenCache?.entries.npm["pkg-a"]?.latest).toBe("2.0.0");
  });

  test("returns no update when latest === pinned", async () => {
    const entries: ParsedEntry[] = [
      { source: "npm", name: "pkg-a", version: "1.0.0", configOrigin: "global" },
    ];
    const fetchLatest = makeNpmFetcher({ "pkg-a": "1.0.0" });
    const results = await runCheck({
      entries,
      fetchLatest,
      fetchLatestGithubTag: makeGithubFetcher({}),
      readCache: () => emptyCache(),
      writeCache: () => {},
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
    });
    expect(results).toHaveLength(0);
  });

  test("returns no update when pinned is GREATER than latest (user on pre-release)", async () => {
    const entries: ParsedEntry[] = [
      { source: "npm", name: "pkg-a", version: "2.0.0-beta.1", configOrigin: "global" },
    ];
    const fetchLatest = makeNpmFetcher({ "pkg-a": "1.9.0" });
    const results = await runCheck({
      entries,
      fetchLatest,
      fetchLatestGithubTag: makeGithubFetcher({}),
      readCache: () => emptyCache(),
      writeCache: () => {},
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
    });
    expect(results).toHaveLength(0);
  });

  test("uses npm cache when entry is fresh, does NOT call registry", async () => {
    const entries: ParsedEntry[] = [
      { source: "npm", name: "cached-pkg", version: "1.0.0", configOrigin: "global" },
    ];
    const initialCache: Cache = {
      version: 2,
      entries: {
        npm: { "cached-pkg": { latest: "3.0.0", fetchedAt: NOW - 1000 } },
        "git-github": {},
      },
    };
    let registryCalled = false;
    const fetchLatest = async (_name: string) => {
      registryCalled = true;
      return "99.0.0";
    };

    const results = await runCheck({
      entries,
      fetchLatest,
      fetchLatestGithubTag: makeGithubFetcher({}),
      readCache: () => initialCache,
      writeCache: () => {},
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
    });

    expect(registryCalled).toBe(false);
    expect(results).toEqual([
      {
        source: "npm",
        name: "cached-pkg",
        pinned: "1.0.0",
        latest: "3.0.0",
        configOrigin: "global",
      },
    ]);
  });

  test("picks max pinned version when same npm package appears multiple times", async () => {
    const entries: ParsedEntry[] = [
      { source: "npm", name: "pkg", version: "1.0.0", configOrigin: "global" },
      { source: "npm", name: "pkg", version: "2.0.0", configOrigin: "global" },
    ];
    const fetchLatest = makeNpmFetcher({ pkg: "2.5.0" });
    const results = await runCheck({
      entries,
      fetchLatest,
      fetchLatestGithubTag: makeGithubFetcher({}),
      readCache: () => emptyCache(),
      writeCache: () => {},
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
    });
    expect(results).toEqual([
      { source: "npm", name: "pkg", pinned: "2.0.0", latest: "2.5.0", configOrigin: "global" },
    ]);
  });

  test("continues with other packages when one registry call fails", async () => {
    const entries: ParsedEntry[] = [
      { source: "npm", name: "good-pkg", version: "1.0.0", configOrigin: "global" },
      { source: "npm", name: "bad-pkg", version: "1.0.0", configOrigin: "global" },
    ];
    const fetchLatest = async (name: string) => {
      if (name === "bad-pkg") throw new Error("network error");
      return "2.0.0";
    };
    const results = await runCheck({
      entries,
      fetchLatest,
      fetchLatestGithubTag: makeGithubFetcher({}),
      readCache: () => emptyCache(),
      writeCache: () => {},
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
    });
    expect(results).toEqual([
      { source: "npm", name: "good-pkg", pinned: "1.0.0", latest: "2.0.0", configOrigin: "global" },
    ]);
  });

  test("returns empty array when entries is empty", async () => {
    const results = await runCheck({
      entries: [],
      fetchLatest: async () => "99.0.0",
      fetchLatestGithubTag: makeGithubFetcher({}),
      readCache: () => emptyCache(),
      writeCache: () => {},
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
    });
    expect(results).toHaveLength(0);
  });

  test("forceRefresh: true bypasses npm cache even when entry is fresh", async () => {
    const entries: ParsedEntry[] = [
      { source: "npm", name: "cached-pkg", version: "1.0.0", configOrigin: "global" },
    ];
    const initialCache: Cache = {
      version: 2,
      entries: {
        npm: { "cached-pkg": { latest: "3.0.0", fetchedAt: NOW - 1000 } },
        "git-github": {},
      },
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
      fetchLatestGithubTag: makeGithubFetcher({}),
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
    expect(results).toEqual([
      {
        source: "npm",
        name: "cached-pkg",
        pinned: "1.0.0",
        latest: "4.0.0",
        configOrigin: "global",
      },
    ]);
    expect(writtenCache?.entries.npm["cached-pkg"]?.latest).toBe("4.0.0");
  });

  // --- New tests for git-github and mixed sources ---

  test("dispatches to fetchLatestGithubTag for git-github entries", async () => {
    const entries: ParsedEntry[] = [
      {
        source: "git-github",
        name: "my-plugin",
        owner: "acme",
        repo: "my-plugin",
        version: "1.0.0",
        configOrigin: "global",
      },
    ];
    let githubArgs: [string, string] | null = null;
    const fetchLatestGithubTag = async (owner: string, repo: string) => {
      githubArgs = [owner, repo];
      return "2.0.0";
    };
    let npmCalled = false;
    const fetchLatest = async () => {
      npmCalled = true;
      return "99.0.0";
    };

    const results = await runCheck({
      entries,
      fetchLatest,
      fetchLatestGithubTag,
      readCache: () => emptyCache(),
      writeCache: () => {},
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
    });

    expect(npmCalled).toBe(false);
    expect(githubArgs).toEqual(["acme", "my-plugin"]);
    expect(results).toEqual([
      {
        source: "git-github",
        name: "my-plugin",
        owner: "acme",
        repo: "my-plugin",
        pinned: "1.0.0",
        latest: "2.0.0",
        configOrigin: "global",
      },
    ]);
  });

  test("mixed entries: npm and git-github both fetched with correct dispatchers", async () => {
    const entries: ParsedEntry[] = [
      { source: "npm", name: "npm-pkg", version: "1.0.0", configOrigin: "global" },
      {
        source: "git-github",
        name: "gh-plugin",
        owner: "org",
        repo: "gh-plugin",
        version: "1.0.0",
        configOrigin: "global",
      },
    ];
    const npmCalls: string[] = [];
    const githubCalls: [string, string][] = [];

    const fetchLatest = async (name: string) => {
      npmCalls.push(name);
      return "2.0.0";
    };
    const fetchLatestGithubTag = async (owner: string, repo: string) => {
      githubCalls.push([owner, repo]);
      return "3.0.0";
    };

    const results = await runCheck({
      entries,
      fetchLatest,
      fetchLatestGithubTag,
      readCache: () => emptyCache(),
      writeCache: () => {},
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
    });

    expect(npmCalls).toEqual(["npm-pkg"]);
    expect(githubCalls).toEqual([["org", "gh-plugin"]]);
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.source === "npm")).toEqual({
      source: "npm",
      name: "npm-pkg",
      pinned: "1.0.0",
      latest: "2.0.0",
      configOrigin: "global",
    });
    expect(results.find((r) => r.source === "git-github")).toEqual({
      source: "git-github",
      name: "gh-plugin",
      owner: "org",
      repo: "gh-plugin",
      pinned: "1.0.0",
      latest: "3.0.0",
      configOrigin: "global",
    });
  });

  test("cache bucket isolation: npm cache hit does not skip git-github fetch", async () => {
    const entries: ParsedEntry[] = [
      { source: "npm", name: "npm-pkg", version: "1.0.0", configOrigin: "global" },
      {
        source: "git-github",
        name: "gh-plugin",
        owner: "org",
        repo: "gh-plugin",
        version: "1.0.0",
        configOrigin: "global",
      },
    ];
    const hotCache: Cache = {
      version: 2,
      entries: {
        npm: { "npm-pkg": { latest: "2.0.0", fetchedAt: NOW - 1000 } },
        "git-github": {},
      },
    };
    let githubCalled = false;
    const fetchLatestGithubTag = async (_owner: string, _repo: string) => {
      githubCalled = true;
      return "3.0.0";
    };
    let npmCalled = false;
    const fetchLatest = async () => {
      npmCalled = true;
      return "99.0.0";
    };

    await runCheck({
      entries,
      fetchLatest,
      fetchLatestGithubTag,
      readCache: () => hotCache,
      writeCache: () => {},
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
    });

    expect(npmCalled).toBe(false);
    expect(githubCalled).toBe(true);
  });

  test("cache bucket isolation: git-github cache hit does not skip npm fetch", async () => {
    const entries: ParsedEntry[] = [
      { source: "npm", name: "npm-pkg", version: "1.0.0", configOrigin: "global" },
      {
        source: "git-github",
        name: "gh-plugin",
        owner: "org",
        repo: "gh-plugin",
        version: "1.0.0",
        configOrigin: "global",
      },
    ];
    const hotCache: Cache = {
      version: 2,
      entries: {
        npm: {},
        "git-github": { "org/gh-plugin": { latest: "3.0.0", fetchedAt: NOW - 1000 } },
      },
    };
    let npmCalled = false;
    const fetchLatest = async () => {
      npmCalled = true;
      return "2.0.0";
    };
    let githubCalled = false;
    const fetchLatestGithubTag = async () => {
      githubCalled = true;
      return "99.0.0";
    };

    await runCheck({
      entries,
      fetchLatest,
      fetchLatestGithubTag,
      readCache: () => hotCache,
      writeCache: () => {},
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
    });

    expect(npmCalled).toBe(true);
    expect(githubCalled).toBe(false);
  });

  test("forceRefresh bypasses both npm and git-github cache", async () => {
    const entries: ParsedEntry[] = [
      { source: "npm", name: "npm-pkg", version: "1.0.0", configOrigin: "global" },
      {
        source: "git-github",
        name: "gh-plugin",
        owner: "org",
        repo: "gh-plugin",
        version: "1.0.0",
        configOrigin: "global",
      },
    ];
    const hotCache: Cache = {
      version: 2,
      entries: {
        npm: { "npm-pkg": { latest: "2.0.0", fetchedAt: NOW - 1000 } },
        "git-github": { "org/gh-plugin": { latest: "3.0.0", fetchedAt: NOW - 1000 } },
      },
    };
    let npmCalled = false;
    let githubCalled = false;
    const fetchLatest = async () => {
      npmCalled = true;
      return "5.0.0";
    };
    const fetchLatestGithubTag = async () => {
      githubCalled = true;
      return "6.0.0";
    };

    const results = await runCheck({
      entries,
      fetchLatest,
      fetchLatestGithubTag,
      readCache: () => hotCache,
      writeCache: () => {},
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
      forceRefresh: true,
    });

    expect(npmCalled).toBe(true);
    expect(githubCalled).toBe(true);
    expect(results).toHaveLength(2);
  });

  test("git fetcher rejection: skips failed entry, npm entry still produces result", async () => {
    const entries: ParsedEntry[] = [
      { source: "npm", name: "npm-pkg", version: "1.0.0", configOrigin: "global" },
      {
        source: "git-github",
        name: "gh-plugin",
        owner: "org",
        repo: "bad-repo",
        version: "1.0.0",
        configOrigin: "global",
      },
    ];
    const fetchLatest = makeNpmFetcher({ "npm-pkg": "2.0.0" });
    const fetchLatestGithubTag = async (_owner: string, _repo: string) => {
      throw new Error("github API error");
    };
    let warnLogged = false;
    const log: Logger = async (entry) => {
      if (entry.level === "warn") warnLogged = true;
    };

    const results = await runCheck({
      entries,
      fetchLatest,
      fetchLatestGithubTag,
      readCache: () => emptyCache(),
      writeCache: () => {},
      now: NOW,
      ttlMs: TTL_MS,
      log,
    });

    expect(warnLogged).toBe(true);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      source: "npm",
      name: "npm-pkg",
      pinned: "1.0.0",
      latest: "2.0.0",
      configOrigin: "global",
    });
  });

  test("same owner/repo pinned differently: only highest pinned compared, no duplicate cache writes", async () => {
    const entries: ParsedEntry[] = [
      {
        source: "git-github",
        name: "plugin-v1",
        owner: "org",
        repo: "plugin",
        version: "1.0.0",
        configOrigin: "global",
      },
      {
        source: "git-github",
        name: "plugin-v2",
        owner: "org",
        repo: "plugin",
        version: "2.0.0",
        configOrigin: "global",
      },
    ];
    let githubCallCount = 0;
    const fetchLatestGithubTag = async (_owner: string, _repo: string) => {
      githubCallCount++;
      return "2.5.0";
    };
    let writtenCache: Cache | null = null;

    const results = await runCheck({
      entries,
      fetchLatest: makeNpmFetcher({}),
      fetchLatestGithubTag,
      readCache: () => emptyCache(),
      writeCache: (c) => {
        writtenCache = c;
      },
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
    });

    expect(githubCallCount).toBe(1);
    expect(writtenCache?.entries["git-github"]["org/plugin"]).toBeDefined();
    expect(results).toHaveLength(1);
    expect(results[0]?.pinned).toBe("2.0.0");
    expect(results[0]?.latest).toBe("2.5.0");
  });

  test("name comes from max-version entry when two git-github entries share owner/repo", async () => {
    const entries: ParsedEntry[] = [
      {
        source: "git-github",
        name: "name-from-lower",
        owner: "org",
        repo: "plugin",
        version: "1.0.0",
        configOrigin: "global",
      },
      {
        source: "git-github",
        name: "name-from-higher",
        owner: "org",
        repo: "plugin",
        version: "2.0.0",
        configOrigin: "global",
      },
    ];
    const results = await runCheck({
      entries,
      fetchLatest: makeNpmFetcher({}),
      fetchLatestGithubTag: makeGithubFetcher({ "org/plugin": "3.0.0" }),
      readCache: () => emptyCache(),
      writeCache: () => {},
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("name-from-higher");
  });

  test("writeCache is NOT called when all entries are cache-fresh", async () => {
    const entries: ParsedEntry[] = [
      { source: "npm", name: "pkg-a", version: "1.0.0", configOrigin: "global" },
      {
        source: "git-github",
        name: "gh-plugin",
        owner: "org",
        repo: "repo",
        version: "1.0.0",
        configOrigin: "global",
      },
    ];
    const hotCache: Cache = {
      version: 2,
      entries: {
        npm: { "pkg-a": { latest: "2.0.0", fetchedAt: NOW - 1000 } },
        "git-github": { "org/repo": { latest: "3.0.0", fetchedAt: NOW - 1000 } },
      },
    };
    let writeCacheCalled = false;

    await runCheck({
      entries,
      fetchLatest: makeNpmFetcher({}),
      fetchLatestGithubTag: makeGithubFetcher({}),
      readCache: () => hotCache,
      writeCache: () => {
        writeCacheCalled = true;
      },
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
    });

    expect(writeCacheCalled).toBe(false);
  });

  test("UpdateResult.source: all results carry the correct source field", async () => {
    const entries: ParsedEntry[] = [
      { source: "npm", name: "npm-pkg", version: "1.0.0", configOrigin: "global" },
      {
        source: "git-github",
        name: "gh-plugin",
        owner: "org",
        repo: "repo",
        version: "1.0.0",
        configOrigin: "global",
      },
    ];
    const results = await runCheck({
      entries,
      fetchLatest: makeNpmFetcher({ "npm-pkg": "2.0.0" }),
      fetchLatestGithubTag: makeGithubFetcher({ "org/repo": "3.0.0" }),
      readCache: () => emptyCache(),
      writeCache: () => {},
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
    });

    const npmResult = results.find((r) => r.name === "npm-pkg");
    const ghResult = results.find((r) => r.name === "gh-plugin");
    expect(npmResult?.source).toBe("npm");
    expect(ghResult?.source).toBe("git-github");
  });

  test("merges configOrigin to tui-global when same package exists in both configs", async () => {
    const entries: ParsedEntry[] = [
      { source: "npm", name: "shared-pkg", version: "1.0.0", configOrigin: "global" },
      { source: "npm", name: "shared-pkg", version: "1.2.0", configOrigin: "tui" },
    ];
    const fetchLatest = makeNpmFetcher({ "shared-pkg": "2.0.0" });
    const results = await runCheck({
      entries,
      fetchLatest,
      fetchLatestGithubTag: makeGithubFetcher({}),
      readCache: () => emptyCache(),
      writeCache: () => {},
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
    });
    expect(results).toEqual([
      {
        source: "npm",
        name: "shared-pkg",
        pinned: "1.2.0",
        latest: "2.0.0",
        configOrigin: "tui-global",
      },
    ]);
  });

  test("configOrigin becomes tui-global when tui config has higher version", async () => {
    const entries: ParsedEntry[] = [
      { source: "npm", name: "shared-pkg", version: "1.0.0", configOrigin: "global" },
      { source: "npm", name: "shared-pkg", version: "2.0.0", configOrigin: "tui" },
    ];
    const results = await runCheck({
      entries,
      fetchLatest: makeNpmFetcher({ "shared-pkg": "3.0.0" }),
      fetchLatestGithubTag: makeGithubFetcher({}),
      readCache: () => emptyCache(),
      writeCache: () => {},
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
    });
    expect(results).toEqual([
      {
        source: "npm",
        name: "shared-pkg",
        pinned: "2.0.0",
        latest: "3.0.0",
        configOrigin: "tui-global",
      },
    ]);
  });

  test("configOrigin merges to tui-global when global entry has higher version", async () => {
    const entries: ParsedEntry[] = [
      { source: "npm", name: "shared-pkg", version: "2.0.0", configOrigin: "global" },
      { source: "npm", name: "shared-pkg", version: "1.0.0", configOrigin: "tui" },
    ];
    const results = await runCheck({
      entries,
      fetchLatest: makeNpmFetcher({ "shared-pkg": "2.5.0" }),
      fetchLatestGithubTag: makeGithubFetcher({}),
      readCache: () => emptyCache(),
      writeCache: () => {},
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
    });
    expect(results).toEqual([
      {
        source: "npm",
        name: "shared-pkg",
        pinned: "2.0.0",
        latest: "2.5.0",
        configOrigin: "tui-global",
      },
    ]);
  });
});

describe("runCheck — partial / malformed pinned versions", () => {
  test("partial-version npm pin (e.g. '3.9') is compared via coercion, not thrown", async () => {
    const entries: ParsedEntry[] = [
      { source: "npm", name: "quota", version: "3.9", configOrigin: "global" },
    ];

    const results = await runCheck({
      entries,
      fetchLatest: makeNpmFetcher({ quota: "3.10.1" }),
      fetchLatestGithubTag: makeGithubFetcher({}),
      readCache: () => emptyCache(),
      writeCache: () => {},
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
    });

    // pinned is reported as the raw string the user wrote, not the coerced form
    expect(results).toEqual([
      { source: "npm", name: "quota", pinned: "3.9", latest: "3.10.1", configOrigin: "global" },
    ]);
  });

  test("major-only npm pin (e.g. '3') is coerced and compared", async () => {
    const entries: ParsedEntry[] = [
      { source: "npm", name: "pkg", version: "3", configOrigin: "global" },
    ];

    const results = await runCheck({
      entries,
      fetchLatest: makeNpmFetcher({ pkg: "4.0.0" }),
      fetchLatestGithubTag: makeGithubFetcher({}),
      readCache: () => emptyCache(),
      writeCache: () => {},
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
    });

    expect(results).toEqual([
      { source: "npm", name: "pkg", pinned: "3", latest: "4.0.0", configOrigin: "global" },
    ]);
  });

  test("one unparseable pinned version does not abort the whole batch", async () => {
    const entries: ParsedEntry[] = [
      { source: "npm", name: "bad", version: "not-a-version", configOrigin: "global" },
      { source: "npm", name: "good", version: "1.0.0", configOrigin: "global" },
    ];

    const results = await runCheck({
      entries,
      fetchLatest: makeNpmFetcher({ bad: "9.9.9", good: "2.0.0" }),
      fetchLatestGithubTag: makeGithubFetcher({}),
      readCache: () => emptyCache(),
      writeCache: () => {},
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
    });

    // The unparseable entry is skipped; the valid update is still reported.
    expect(results).toEqual([
      { source: "npm", name: "good", pinned: "1.0.0", latest: "2.0.0", configOrigin: "global" },
    ]);
  });

  test("partial-version pin alongside valid updates reports all of them", async () => {
    const entries: ParsedEntry[] = [
      { source: "npm", name: "quota", version: "3.9", configOrigin: "global" },
      { source: "npm", name: "insights", version: "1.1.3", configOrigin: "global" },
    ];

    const results = await runCheck({
      entries,
      fetchLatest: makeNpmFetcher({ quota: "3.10.1", insights: "1.3.1" }),
      fetchLatestGithubTag: makeGithubFetcher({}),
      readCache: () => emptyCache(),
      writeCache: () => {},
      now: NOW,
      ttlMs: TTL_MS,
      log: noopLog,
    });

    expect(results).toEqual(
      expect.arrayContaining([
        { source: "npm", name: "quota", pinned: "3.9", latest: "3.10.1", configOrigin: "global" },
        {
          source: "npm",
          name: "insights",
          pinned: "1.1.3",
          latest: "1.3.1",
          configOrigin: "global",
        },
      ]),
    );
    expect(results).toHaveLength(2);
  });
});
