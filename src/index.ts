import type { Config, Plugin, PluginInput, PluginOptions } from "@opencode-ai/plugin";
import type { Event } from "@opencode-ai/sdk";
import { type RunCheck, STARTUP_DELAY_MS, createUpdateCheck } from "./run.js";

type InternalDeps = {
  _runCheck?: RunCheck;
  /** Override the startup delay (ms) before the check runs. Tests only. */
  _startupDelayMs?: number;
};

// Events we use as a startup trigger, in order of how early they fire.
// - "plugin.added" fires at startup when plugins load and reliably reaches the
//   plugin event handler (verified via logs) — earliest available trigger.
// - "session.updated" is a guaranteed fallback: it always fires eventually, but
//   only once the session changes (often after the first message), so it can be
//   tens of seconds into a session. Listening to both lets whichever fires first
//   trigger the (delayed) check, while the run-once guard dedupes the rest.
// Note: "server.connected" was tested and does NOT reach plugin event handlers,
// and "session.created" does not fire when an existing session is resumed.
const STARTUP_TRIGGER_EVENTS = new Set<string>(["plugin.added", "session.updated"]);

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
  // Guards that the check is scheduled at most once per plugin lifecycle,
  // regardless of how many trigger events fire.
  let scheduled = false;
  const startupDelayMs = _internal?._startupDelayMs ?? STARTUP_DELAY_MS;
  const log = makeLogger(input.client);

  const runUpdateCheck = createUpdateCheck({
    startDir: input.worktree || input.directory,
    showToast: async (toast) => {
      await input.client.tui.showToast({ body: toast });
    },
    log,
    ...(_internal?._runCheck ? { runCheck: _internal._runCheck } : {}),
  });

  return {
    event: async ({ event }: { event: Event }) => {
      if (!STARTUP_TRIGGER_EVENTS.has(event.type)) return;
      if (scheduled) return;
      scheduled = true;

      setTimeout(async () => {
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
      }, startupDelayMs);
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

export default {
  id: "opencode-update-notifier",
  server: OpencodeUpdateNotifier,
  // OpenCode 2 can only show toasts from the terminal UI, so its implementation
  // lives in the ./tui entry; this server entry only has to load.
  setup() {},
};
