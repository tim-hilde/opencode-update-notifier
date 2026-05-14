import { coerce as semverCoerce, valid as semverValid } from "semver";
import type { ParsedEntry } from "./types.ts";

const GIT_GITHUB =
  /^(@[^/]+\/[^@]+|[^@/][^@]*)@git\+https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?#(.+)$/;
const SCOPED_PINNED = /^(@[^/]+\/[^@]+)@(\d[^@]*)$/;
const UNSCOPED_PINNED = /^([^@/][^@]*)@(\d[^@]*)$/;

export function parseEntry(raw: string): ParsedEntry | null {
  let m = GIT_GITHUB.exec(raw);
  if (m) {
    const ref = m[4] as string;
    // Only accept version refs starting with 'v' to exclude SHAs, branches, date tags
    if (!ref.startsWith("v")) return null;
    const stripped = ref.slice(1);
    // Prefer exact semver (preserves pre-release); fall back to coerce for partial (v5, v5.1)
    const version = semverValid(stripped) ?? semverCoerce(stripped)?.version;
    if (!version) return null;
    return {
      source: "git-github",
      name: m[1] as string,
      owner: m[2] as string,
      repo: m[3] as string,
      version,
    };
  }

  m = SCOPED_PINNED.exec(raw);
  if (m) return { source: "npm", name: m[1] as string, version: m[2] as string };

  m = UNSCOPED_PINNED.exec(raw);
  if (m) return { source: "npm", name: m[1] as string, version: m[2] as string };

  return null;
}

/** Parses an array of raw plugin strings, separating valid entries from dropped ones. */
export function parseEntries(raws: string[]): {
  parsed: ParsedEntry[];
  dropped: string[];
} {
  const parsed: ParsedEntry[] = [];
  const dropped: string[] = [];
  for (const raw of raws) {
    const result = parseEntry(raw);
    if (result) {
      parsed.push(result);
    } else {
      dropped.push(raw);
    }
  }
  return { parsed, dropped };
}
