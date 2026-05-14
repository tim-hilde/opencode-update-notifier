import path from "node:path";
import type { Cache, EnvReader, FsExists, FsReader, FsRename, FsWriter, HomeDir } from "./types.ts";

const CACHE_REL = "opencode-update-notifier/cache.json";
export const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const EMPTY_CACHE: Cache = { version: 2, entries: { npm: {}, "git-github": {} } };

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
  try {
    const raw = deps.fsReader(p);
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as Record<string, unknown>).version !== 2
    ) {
      return structuredClone(EMPTY_CACHE);
    }
    const obj = parsed as Record<string, unknown>;
    const entries = obj.entries as Record<string, unknown> | undefined;
    if (
      typeof entries !== "object" ||
      entries === null ||
      typeof entries.npm !== "object" ||
      entries.npm === null ||
      Array.isArray(entries.npm) ||
      typeof entries["git-github"] !== "object" ||
      entries["git-github"] === null ||
      Array.isArray(entries["git-github"])
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
  source: "npm" | "git-github",
  key: string,
  now: number,
  ttlMs: number,
): string | null {
  const entry = cache.entries[source][key];
  if (!entry) return null;
  if (now - entry.fetchedAt > ttlMs) return null;
  return entry.latest;
}

export function setEntry(
  cache: Cache,
  source: "npm" | "git-github",
  key: string,
  latest: string,
  now: number,
): Cache {
  return {
    ...cache,
    entries: {
      ...cache.entries,
      [source]: {
        ...cache.entries[source],
        [key]: { latest, fetchedAt: now },
      },
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
