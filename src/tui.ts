import type { Plugin } from "@opencode/plugin/tui";
import { type RunCheck, STARTUP_DELAY_MS, createUpdateCheck } from "./run.js";
import type { Logger } from "./types.js";

type InternalDeps = {
  _runCheck?: RunCheck;
  _startupDelayMs?: number;
};

const log: Logger = async (entry) => {
  if (entry.level === "warn" || entry.level === "error") {
    console.error(`[${entry.service}] ${entry.message}`, entry.extra ?? "");
  }
};

export function createTuiPlugin(internal: InternalDeps = {}): Plugin.Definition {
  return {
    id: "opencode-update-notifier",
    setup(context) {
      const check = createUpdateCheck({
        startDir: (context.location ?? context.data.location.default()).directory,
        showToast: async (toast) => context.ui.toast.show(toast),
        log,
        ...(internal._runCheck ? { runCheck: internal._runCheck } : {}),
      });
      const run = (forceRefresh?: boolean) =>
        check(forceRefresh).catch((err) =>
          log({
            service: "opencode-update-notifier",
            level: "error",
            message: "opencode-update-notifier: unexpected error",
            extra: { error: String(err) },
          }),
        );

      // Keymap layers only register inside a render, which supplies the reactive
      // owner; OpenCode's built-in /btw registers its slash command the same way.
      context.ui.slot({
        append: "app",
        render: () => {
          context.keymap.layer(() => ({
            mode: "global",
            commands: [
              {
                id: "opencode-update-notifier.check",
                title: "Check plugin updates",
                description: "Check if your OpenCode plugins have newer versions available",
                palette: true,
                slash: { name: "check-updates" },
                run: () => {
                  void run(true);
                },
              },
            ],
          }));
          return null;
        },
      });

      const timer = setTimeout(() => void run(), internal._startupDelayMs ?? STARTUP_DELAY_MS);
      return () => clearTimeout(timer);
    },
  };
}

export default createTuiPlugin();
