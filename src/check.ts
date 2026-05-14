import { gt as semverGt, maxSatisfying as semverMaxSatisfying } from "semver";
import { getEntry, setEntry } from "./cache.js";
import type { Cache, Logger, ParsedEntry, UpdateResult } from "./types.ts";

type GroupKey = string; // "npm:name" or "git-github:owner/repo"

function groupKey(entry: ParsedEntry): GroupKey {
  if (entry.source === "npm") return `npm:${entry.name}`;
  return `git-github:${entry.owner}/${entry.repo}`;
}

function cacheKey(entry: ParsedEntry): string {
  if (entry.source === "npm") return entry.name;
  return `${entry.owner}/${entry.repo}`;
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

  // Group entries by source+key, keeping highest pinned version per group
  const grouped = new Map<GroupKey, { entry: ParsedEntry; version: string }>();
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
  const fetchQueue: Array<{ gkey: GroupKey; entry: ParsedEntry }> = [];
  const cachedLatest = new Map<GroupKey, string>();

  for (const [gkey, { entry }] of grouped) {
    const fresh = deps.forceRefresh
      ? null
      : getEntry(cache, entry.source, cacheKey(entry), deps.now, deps.ttlMs);
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
      cache = setEntry(cache, entry.source, cacheKey(entry), latest, deps.now);
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
      updates.push({ source: entry.source, name: entry.name, pinned, latest });
    }
  }

  return updates;
}
