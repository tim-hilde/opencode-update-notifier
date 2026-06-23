/** Which config(s) a plugin entry comes from. */
export type ConfigOrigin = "global" | "tui" | "tui-global";

/** A plugin entry that has been successfully parsed. */
export type ParsedEntry =
  | { source: "npm"; name: string; version: string; configOrigin: ConfigOrigin }
  | {
      source: "git-github";
      name: string;
      owner: string;
      repo: string;
      version: string;
      configOrigin: ConfigOrigin;
    };

/** One plugin that has a newer version available. */
export type UpdateResult =
  | { source: "npm"; name: string; pinned: string; latest: string; configOrigin: ConfigOrigin }
  | {
      source: "git-github";
      name: string;
      owner: string;
      repo: string;
      pinned: string;
      latest: string;
      configOrigin: ConfigOrigin;
    };

/** Reason a raw plugin entry was dropped by the parser. */
export type DropReason = "unpinned-or-malformed" | "unsupported-git-host" | "git-ref-not-semver";

/** A raw plugin entry that could not be parsed, with a reason tag. */
export type DroppedEntry = { raw: string; reason: DropReason };

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

/** Creates a directory, including any missing parents. Throws on error. */
export type FsMkdir = (path: string) => void;

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
