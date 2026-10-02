import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import { CACHE_TTL_MS, readCache, writeCache } from "./cache.js";
import { runCheck } from "./check.js";
import { loadPluginEntries } from "./config/load.js";
import {
  getCustomConfigSource,
  getCustomDirSources,
  getGlobalConfigSources,
  getInlineConfigSource,
  getManagedConfigSources,
  getManagedPlatformPaths,
  getProjectConfigSources,
  getTuiConfigSources,
} from "./config/sources.js";
import { type ToastInput, notify } from "./notify.js";
import { parseEntries } from "./parse.js";
import { fetchLatest } from "./registry.js";
import { fetchLatestGithubTag } from "./sources/github.js";
import type { Logger } from "./types.js";

export type RunCheck = typeof runCheck;

// Delay before the startup check, giving the TUI time to be ready to render a toast.
export const STARTUP_DELAY_MS = 3000;

export function createUpdateCheck(deps: {
  startDir: string;
  showToast: (toast: ToastInput) => Promise<void>;
  log: Logger;
  runCheck?: RunCheck;
}): (forceRefresh?: boolean) => Promise<void> {
  const { log } = deps;

  return async (forceRefresh) => {
    const env = (k: string) => process.env[k];
    const fsReader = (p: string) => readFileSync(p, "utf-8");
    const fsExists = existsSync;
    const fsMkdir = (p: string) => {
      mkdirSync(p, { recursive: true });
    };
    const homeDir = () => os.homedir();

    // Collect all config sources
    const sources = [
      ...getGlobalConfigSources({ fsReader, fsExists, homeDir, env }),
      ...getCustomDirSources({ fsReader, fsExists, env }),
      getCustomConfigSource({ fsReader, fsExists, env }),
      getInlineConfigSource({ env }),
      ...getProjectConfigSources({ fsReader, fsExists, startDir: deps.startDir }),
      ...getManagedConfigSources({
        fsReader,
        fsExists,
        platformPaths: getManagedPlatformPaths(env),
      }),
    ].filter((s): s is NonNullable<typeof s> => s !== null);

    // Load TUI config sources
    const tuiSources = getTuiConfigSources({ fsReader, fsExists, homeDir, env });

    // Load and parse plugin entries from both configurations
    const rawRegular = loadPluginEntries({ sources, log });
    const rawTui = loadPluginEntries({ sources: tuiSources, log });
    const { parsed: regularParsed, dropped: regularDropped } = parseEntries(rawRegular);
    const { parsed: tuiParsed, dropped: tuiDropped } = parseEntries(rawTui);

    // Tag entries with their config origin — parse.ts already sets "global" by default,
    // so we only need to overwrite for TUI entries
    const entries = [
      ...regularParsed,
      ...tuiParsed.map((e) => ({ ...e, configOrigin: "tui" as const })),
    ];

    const dropped = [...regularDropped, ...tuiDropped];

    const unsupportedGit = dropped.filter((d) => d.reason === "unsupported-git-host");
    if (unsupportedGit.length > 0) {
      void log({
        service: "opencode-update-notifier",
        level: "info",
        message: `Skipping ${unsupportedGit.length} git-pinned plugin entries from unsupported hosts (only GitHub is supported)`,
        extra: { entries: unsupportedGit.map((d) => d.raw) },
      });
    }

    const otherDropped = dropped.filter((d) => d.reason !== "unsupported-git-host");
    if (otherDropped.length > 0) {
      void log({
        service: "opencode-update-notifier",
        level: "debug",
        message: `Skipping ${otherDropped.length} unpinned/unrecognized plugin entries`,
        extra: { dropped: otherDropped },
      });
    }

    const doRunCheck = deps.runCheck ?? runCheck;

    const updates = await doRunCheck({
      entries,
      fetchLatest: (name) => fetchLatest(name, { fetch: globalThis.fetch, timeoutMs: 5000 }),
      fetchLatestGithubTag: (owner, repo) =>
        fetchLatestGithubTag(owner, repo, { fetch: globalThis.fetch, timeoutMs: 5000 }),
      readCache: () =>
        readCache({
          fsReader,
          fsExists,
          homeDir,
          env,
          fsMkdir,
          fsWriter: (p, content) => writeFileSync(p, content, "utf-8"),
          fsRename: (from, to) => renameSync(from, to),
        }),
      writeCache: (cache) =>
        writeCache(
          {
            fsMkdir,
            fsWriter: (p, content) => writeFileSync(p, content, "utf-8"),
            fsRename: (from, to) => renameSync(from, to),
            homeDir,
            env,
          },
          cache,
        ),
      now: Date.now(),
      ttlMs: CACHE_TTL_MS,
      log,
      ...(forceRefresh !== undefined ? { forceRefresh } : {}),
    });

    if (updates.length > 0) {
      await notify({ updates, showToast: deps.showToast, log });
    }
  };
}
