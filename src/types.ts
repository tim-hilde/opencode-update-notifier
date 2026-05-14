/** A plugin entry that has been successfully parsed. */
export type ParsedEntry =
  | { source: "npm"; name: string; version: string }
  | { source: "git-github"; name: string; owner: string; repo: string; version: string };

/** One plugin that has a newer version available. */
export type UpdateResult = {
  source: ParsedEntry["source"];
  name: string;
  pinned: string;
  latest: string;
};

/** Persisted cache file schema. */
export type CacheEntry = {
  latest: string;
  fetchedAt: number;
};

export type Cache = {
  version: 2;
  entries: {
    npm: Record<string, CacheEntry>; // key: package name
    "git-github": Record<string, CacheEntry>; // key: "owner/repo"
  };
};

// --- Dependency interfaces ---

/** Reads an environment variable. Returns undefined if unset. */
export type EnvReader = (key: string) => string | undefined;

/** Reads a file's text content. Throws if the file does not exist or is unreadable. */
export type FsReader = (path: string) => string;

/** Writes text to a file, creating parent directories as needed. Throws on error. */
export type FsWriter = (path: string, content: string) => void;

/** Renames (atomically moves) a file. Throws on error. */
export type FsRename = (from: string, to: string) => void;

/** Returns true if a path exists on the filesystem. */
export type FsExists = (path: string) => boolean;

/** Returns the user's home directory. */
export type HomeDir = () => string;

/** Returns the current time as a Unix timestamp in milliseconds. */
export type Clock = () => number;

/** Structured log function matching @opencode-ai/sdk App.log body. */
export type Logger = (entry: {
  service: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  extra?: Record<string, unknown>;
}) => Promise<void>;

/** Fetches the latest published version of an npm package. */
export type RegistryFetcher = (
  name: string,
  opts: { fetch: typeof globalThis.fetch; timeoutMs: number },
) => Promise<string>;
