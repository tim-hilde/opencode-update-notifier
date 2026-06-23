import path from "node:path";
import type {
  Cache,
  EnvReader,
  FsExists,
  FsMkdir,
  FsReader,
  FsRename,
  FsWriter,
  HomeDir,
} from "./types.ts";

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
  /**
   * Optional. When provided, readCache will rewrite the cache file to v2
   * EMPTY_CACHE if it detects a recognizable older-version file on disk.
   * This prevents repeated parse-then-discard on every run after an upgrade.
   * Best-effort: any write failure is swallowed.
   */
  fsWriter?: FsWriter;
  fsRename?: FsRename;
  fsMkdir?: FsMkdir;
}): Cache {
  const p = cachePath(deps.env, deps.homeDir);
  let parsed: unknown;
  try {
    const raw = deps.fsReader(p);
    parsed = JSON.parse(raw);
  } catch {
    return structuredClone(EMPTY_CACHE);
  }

  if (typeof parsed !== "object" || parsed === null) {
    return structuredClone(EMPTY_CACHE);
  }

  const versionRaw = (parsed as Record<string, unknown>).version;
  if (versionRaw !== 2) {
    // Recognizable older numeric version on disk -> normalize it on disk so
    // subsequent runs short-circuit on the version check. Unknown shapes
    // (no numeric version) we leave alone.
    if (typeof versionRaw === "number" && deps.fsWriter && deps.fsRename) {
      writeCache(
        {
          fsWriter: deps.fsWriter,
          fsRename: deps.fsRename,
          homeDir: deps.homeDir,
          env: deps.env,
          fsMkdir: deps.fsMkdir,
        },
        EMPTY_CACHE,
      );
    }
    return structuredClone(EMPTY_CACHE);
  }

  const entries = (parsed as { entries?: unknown }).entries as Record<string, unknown> | undefined;
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
    /**
     * Optional. Creates the cache directory (recursively) before writing.
     * Without it the first-ever write fails with ENOENT (the ~/.cache
     * subdirectory does not exist yet) and the cache never persists.
     */
    fsMkdir?: FsMkdir | undefined;
  },
  cache: Cache,
): void {
  try {
    const target = cachePath(deps.env, deps.homeDir);
    deps.fsMkdir?.(path.dirname(target));
    const tmp = `${target}.tmp`;
    deps.fsWriter(tmp, JSON.stringify(cache, null, 2));
    deps.fsRename(tmp, target);
  } catch {
    // best-effort; swallow silently
  }
}
