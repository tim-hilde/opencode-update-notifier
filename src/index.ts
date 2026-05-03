import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import type { Config, Plugin, PluginInput, PluginOptions } from "@opencode-ai/plugin";
import type { Event } from "@opencode-ai/sdk";
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
} from "./config/sources.js";
import { notify } from "./notify.js";
import { parseEntries } from "./parse.js";
import { fetchLatest } from "./registry.js";
import type { UpdateResult } from "./types.js";

type InternalDeps = {
  _runCheck?: (deps: {
    entries: ReturnType<typeof parseEntries>["parsed"];
    fetchLatest: (name: string) => Promise<string>;
    readCache: () => ReturnType<typeof readCache>;
    writeCache: (cache: ReturnType<typeof readCache>) => void;
    now: number;
    ttlMs: number;
    log: ReturnType<typeof makeLogger>;
    forceRefresh?: boolean;
  }) => Promise<UpdateResult[]>;
};

function makeLogger(client: PluginInput["client"]) {
  return async (entry: {
    service: string;
    level: "debug" | "info" | "warn" | "error";
    message: string;
    extra?: Record<string, unknown>;
  }) => {
    await client.app.log({ body: entry });
  };
}

export const OpencodeUpdateNotifier: Plugin = async (
  input: PluginInput,
  // Options are intentionally unused — no configurable options in this release.
  _options?: PluginOptions,
  _internal?: InternalDeps,
) => {
  // hasRun is set before the try block: if the check fails on the first run,
  // we intentionally do NOT retry on subsequent events. The plugin is "run once
  // per lifecycle, fail silently" by design.
  let hasRun = false;
  const log = makeLogger(input.client);

  async function runUpdateCheck(forceRefresh?: boolean): Promise<void> {
    const env = (k: string) => process.env[k];
    const fsReader = (p: string) => readFileSync(p, "utf-8");
    const fsExists = existsSync;
    const homeDir = () => os.homedir();

    // Collect all config sources
    const sources = [
      ...getGlobalConfigSources({ fsReader, fsExists, homeDir, env }),
      ...getCustomDirSources({ fsReader, fsExists, env }),
      getCustomConfigSource({ fsReader, fsExists, env }),
      getInlineConfigSource({ env }),
      ...getProjectConfigSources({
        fsReader,
        fsExists,
        startDir: input.worktree || input.directory,
      }),
      ...getManagedConfigSources({
        fsReader,
        fsExists,
        platformPaths: getManagedPlatformPaths(env),
      }),
    ].filter((s): s is NonNullable<typeof s> => s !== null);

    // Load and parse plugin entries
    const rawEntries = loadPluginEntries({ sources, log });
    const { parsed: entries, dropped } = parseEntries(rawEntries);

    if (dropped.length > 0) {
      void log({
        service: "opencode-update-notifier",
        level: "debug",
        message: `Skipping ${dropped.length} unpinned/unrecognized plugin entries`,
        extra: { dropped },
      });
    }

    const doRunCheck = _internal?._runCheck ?? runCheck;

    const updates = await doRunCheck({
      entries,
      fetchLatest: (name) => fetchLatest(name, { fetch: globalThis.fetch, timeoutMs: 5000 }),
      readCache: () =>
        readCache({
          fsReader,
          fsExists,
          homeDir,
          env,
        }),
      writeCache: (cache) =>
        writeCache(
          {
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
      await notify({
        updates,
        showToast: async (toast) => {
          await input.client.tui.showToast({ body: toast });
        },
        log,
      });
    }
  }

  return {
    event: async ({ event }: { event: Event }) => {
      if (event.type !== "session.created") return;
      if (hasRun) return;
      hasRun = true;

      try {
        await runUpdateCheck();
      } catch (err) {
        void log({
          service: "opencode-update-notifier",
          level: "error",
          message: "opencode-update-notifier: unexpected error",
          extra: { error: String(err) },
        });
      }
    },
    config: async (cfg: Config) => {
      cfg.command ??= {};
      cfg.command["check-updates"] = {
        description: "Check if your OpenCode plugins have newer versions available",
        template: "",
      };
    },
    "command.execute.before": async (
      cmdInput: { command: string; sessionID: string; arguments: string },
      _output: unknown,
    ) => {
      if (cmdInput.command !== "check-updates") return;

      try {
        await runUpdateCheck(true);
      } catch (err) {
        void log({
          service: "opencode-update-notifier",
          level: "error",
          message: "opencode-update-notifier: /check-updates error",
          extra: { error: String(err) },
        });
      }
    },
  };
};

export default OpencodeUpdateNotifier;
