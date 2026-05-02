import { gt as semverGt, maxSatisfying as semverMaxSatisfying } from "semver";
import { getEntry, setEntry } from "./cache.js";
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
        message: "Failed to fetch latest version",
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
