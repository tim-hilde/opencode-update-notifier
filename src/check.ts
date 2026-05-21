import { gt as semverGt, maxSatisfying as semverMaxSatisfying } from "semver";
import { getEntry, setEntry } from "./cache.js";
import type { Cache, Logger, ParsedEntry, UpdateResult } from "./types.ts";

/**
 * Identity used as both the cache key within a source bucket and (combined
 * with the source) the group key for deduplicating entries within a run.
 * - npm: package name
 * - git-github: "owner/repo"
 */
function entryId(entry: ParsedEntry): string {
  return entry.source === "npm" ? entry.name : `${entry.owner}/${entry.repo}`;
}

function groupKey(entry: ParsedEntry): string {
  return `${entry.source}|${entryId(entry)}`;
}

function toUpdateResult(entry: ParsedEntry, pinned: string, latest: string): UpdateResult {
  if (entry.source === "npm") {
    return { source: "npm", name: entry.name, pinned, latest, configOrigin: "global" };
  }
  return {
    source: "git-github",
    name: entry.name,
    owner: entry.owner,
    repo: entry.repo,
    pinned,
    latest,
    configOrigin: "global",
  };
}

export async function runCheck(deps: {
  entries: ParsedEntry[];
  fetchLatest: (name: string) => Promise<string>;
  fetchLatestGithubTag: (owner: string, repo: string) => Promise<string>;
  readCache: () => Cache;
  writeCache: (cache: Cache) => void;
  now: number;
  ttlMs: number;
  log: Logger;
  forceRefresh?: boolean;
}): Promise<UpdateResult[]> {
  if (deps.entries.length === 0) return [];

  // Group entries by source+id, keeping highest pinned version per group
  const grouped = new Map<string, { entry: ParsedEntry; version: string }>();
  for (const entry of deps.entries) {
    const key = groupKey(entry);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { entry, version: entry.version });
    } else {
      const max = semverMaxSatisfying([existing.version, entry.version], "*") ?? existing.version;
      if (max !== existing.version) {
        grouped.set(key, { entry, version: max });
      }
    }
  }

  let cache = deps.readCache();

  // Determine which groups need a fetch
  const fetchQueue: Array<{ gkey: string; entry: ParsedEntry }> = [];
  const cachedLatest = new Map<string, string>();

  for (const [gkey, { entry }] of grouped) {
    const fresh = deps.forceRefresh
      ? null
      : getEntry(cache, entry.source, entryId(entry), deps.now, deps.ttlMs);
    if (fresh !== null) {
      cachedLatest.set(gkey, fresh);
    } else {
      fetchQueue.push({ gkey, entry });
    }
  }

  // Fetch stale/missing entries in parallel
  let cacheChanged = false;
  const fetchResults = await Promise.allSettled(
    fetchQueue.map(async ({ gkey, entry }) => {
      let latest: string;
      if (entry.source === "npm") {
        latest = await deps.fetchLatest(entry.name);
      } else {
        latest = await deps.fetchLatestGithubTag(entry.owner, entry.repo);
      }
      return { gkey, entry, latest };
    }),
  );

  for (const result of fetchResults) {
    if (result.status === "fulfilled") {
      const { gkey, entry, latest } = result.value;
      cache = setEntry(cache, entry.source, entryId(entry), latest, deps.now);
      cacheChanged = true;
      cachedLatest.set(gkey, latest);
    } else {
      void deps.log({
        service: "opencode-update-notifier",
        level: "warn",
        message: "Failed to fetch latest version",
        extra: { error: String(result.reason) },
      });
    }
  }

  if (cacheChanged) deps.writeCache(cache);

  // Compare pinned vs latest
  const updates: UpdateResult[] = [];
  for (const [gkey, { entry, version: pinned }] of grouped) {
    const latest = cachedLatest.get(gkey);
    if (!latest) continue;
    if (semverGt(latest, pinned)) {
      updates.push(toUpdateResult(entry, pinned, latest));
    }
  }

  return updates;
}
