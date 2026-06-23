import {
  coerce as semverCoerce,
  gt as semverGt,
  maxSatisfying as semverMaxSatisfying,
  valid as semverValid,
} from "semver";
import { getEntry, setEntry } from "./cache.js";
import type { Cache, ConfigOrigin, Logger, ParsedEntry, UpdateResult } from "./types.ts";

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

function mergeConfigOrigin(a: ConfigOrigin, b: ConfigOrigin): ConfigOrigin {
  if (a === "tui-global" || b === "tui-global") return "tui-global";
  if (a !== b) return "tui-global";
  return a;
}

function toUpdateResult(entry: ParsedEntry, pinned: string, latest: string): UpdateResult {
  if (entry.source === "npm") {
    return { source: "npm", name: entry.name, pinned, latest, configOrigin: entry.configOrigin };
  }
  return {
    source: "git-github",
    name: entry.name,
    owner: entry.owner,
    repo: entry.repo,
    pinned,
    latest,
    configOrigin: entry.configOrigin,
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
      const mergedOrigin = mergeConfigOrigin(existing.entry.configOrigin, entry.configOrigin);
      if (max !== existing.version) {
        grouped.set(key, { entry: { ...entry, configOrigin: mergedOrigin }, version: max });
      } else {
        existing.entry = { ...existing.entry, configOrigin: mergedOrigin };
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

  // Compare pinned vs latest. npm pins may be partial (e.g. "3.9" or "3"),
  // which are not valid semver and would make semverGt throw — so coerce the
  // pinned version first. Guard each comparison so a single unparseable entry
  // can never abort the whole batch and suppress every toast.
  const updates: UpdateResult[] = [];
  for (const [gkey, { entry, version: pinned }] of grouped) {
    const latest = cachedLatest.get(gkey);
    if (!latest) continue;
    const pinnedNorm = semverValid(pinned) ?? semverCoerce(pinned)?.version ?? null;
    if (pinnedNorm === null) {
      void deps.log({
        service: "opencode-update-notifier",
        level: "warn",
        message: "Skipping entry with unparseable pinned version",
        extra: { entry: entry.name, pinned },
      });
      continue;
    }
    try {
      // Report the raw pinned string the user wrote, not the coerced form.
      if (semverGt(latest, pinnedNorm)) {
        updates.push(toUpdateResult(entry, pinned, latest));
      }
    } catch (err) {
      void deps.log({
        service: "opencode-update-notifier",
        level: "warn",
        message: "Skipping entry with uncomparable versions",
        extra: { entry: entry.name, pinned, latest, error: String(err) },
      });
    }
  }

  return updates;
}
