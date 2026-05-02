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
  try {
    const raw = deps.fsReader(p);
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as Record<string, unknown>).version !== 1
    ) {
      return structuredClone(EMPTY_CACHE);
    }
    return parsed as Cache;
  } catch {
    return structuredClone(EMPTY_CACHE);
  }
}

export function getEntry(cache: Cache, name: string, now: number, ttlMs: number): string | null {
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
