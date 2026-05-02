import type { ParsedEntry } from "./types.ts";

const SCOPED_PINNED = /^(@[^/]+\/[^@]+)@([^@].*)$/;
const UNSCOPED_PINNED = /^([^@/][^@]*)@([^@].*)$/;

/**
 * Parses a single raw plugin entry string.
 * Returns { name, version } for scoped+pinned and unscoped+pinned entries.
 * Returns null for anything else (unpinned, local path, malformed).
 */
export function parseEntry(raw: string): ParsedEntry | null {
  let m = SCOPED_PINNED.exec(raw);
  if (m) return { name: m[1] as string, version: m[2] as string };

  m = UNSCOPED_PINNED.exec(raw);
  if (m) return { name: m[1] as string, version: m[2] as string };

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
