import { coerce as semverCoerce, valid as semverValid } from "semver";
import type { DropReason, DroppedEntry, ParsedEntry } from "./types.ts";

const GIT_GITHUB =
  /^(@[^/]+\/[^@]+|[^@/][^@]*)@git\+https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?#(.+)$/;
// Matches any `name@git+...` entry. Used to detect non-GitHub git URLs so we
// can report them with a specific drop reason rather than silently lumping
// them in with malformed entries.
const ANY_GIT_URL = /^(?:@[^/]+\/[^@]+|[^@/][^@]*)@git\+/;
const SCOPED_PINNED = /^(@[^/]+\/[^@]+)@(\d[^@]*)$/;
const UNSCOPED_PINNED = /^([^@/][^@]*)@(\d[^@]*)$/;
// Accepts MAJOR or MAJOR.MINOR with up to 4 digits per component. The upper
// bound is intentional: it rejects YYYYMMDD-style date refs like "20230101"
// that semverCoerce would otherwise happily turn into "20230101.0.0".
const PARTIAL_SEMVER = /^\d{1,4}(\.\d{1,4})?$/;

type ParseOutcome = { kind: "ok"; entry: ParsedEntry } | { kind: "drop"; reason: DropReason };

/**
 * Parses a single raw plugin entry string.
 * Returns { kind: "ok", entry } for pinned npm entries (name@version) and
 * GitHub git-pinned entries (name@git+https://github.com/owner/repo[.git]#vX.Y.Z).
 * Returns { kind: "drop", reason } for entries we cannot check, with a tag
 * describing why so callers can log appropriately.
 */
export function parseEntryDetailed(raw: string): ParseOutcome {
  const githubMatch = GIT_GITHUB.exec(raw);
  if (githubMatch) {
    const ref = githubMatch[4] as string;
    // Only accept version refs starting with 'v' to exclude SHAs, branches, date tags
    if (!ref.startsWith("v")) return { kind: "drop", reason: "git-ref-not-semver" };
    const stripped = ref.slice(1);
    // Prefer exact semver (preserves pre-release); fall back to coerce only for MAJOR or MAJOR.MINOR
    const version =
      semverValid(stripped) ??
      (PARTIAL_SEMVER.test(stripped) ? (semverCoerce(stripped)?.version ?? null) : null);
    if (!version) return { kind: "drop", reason: "git-ref-not-semver" };
    return {
      kind: "ok",
      entry: {
        source: "git-github",
        name: githubMatch[1] as string,
        owner: githubMatch[2] as string,
        repo: githubMatch[3] as string,
        version,
      },
    };
  }

  // Any other `name@git+...` form (GitLab, Bitbucket, SSH, etc.) — recognized
  // as a git pin but not from a host we know how to query.
  if (ANY_GIT_URL.test(raw)) return { kind: "drop", reason: "unsupported-git-host" };

  const scoped = SCOPED_PINNED.exec(raw);
  if (scoped)
    return {
      kind: "ok",
      entry: { source: "npm", name: scoped[1] as string, version: scoped[2] as string },
    };

  const unscoped = UNSCOPED_PINNED.exec(raw);
  if (unscoped)
    return {
      kind: "ok",
      entry: { source: "npm", name: unscoped[1] as string, version: unscoped[2] as string },
    };

  return { kind: "drop", reason: "unpinned-or-malformed" };
}

/** Back-compat thin wrapper returning ParsedEntry or null. */
export function parseEntry(raw: string): ParsedEntry | null {
  const result = parseEntryDetailed(raw);
  return result.kind === "ok" ? result.entry : null;
}

/** Parses an array of raw plugin strings, separating valid entries from dropped ones. */
export function parseEntries(raws: string[]): {
  parsed: ParsedEntry[];
  dropped: DroppedEntry[];
} {
  const parsed: ParsedEntry[] = [];
  const dropped: DroppedEntry[] = [];
  for (const raw of raws) {
    const result = parseEntryDetailed(raw);
    if (result.kind === "ok") {
      parsed.push(result.entry);
    } else {
      dropped.push({ raw, reason: result.reason });
    }
  }
  return { parsed, dropped };
}
