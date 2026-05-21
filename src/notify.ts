import type { Logger, UpdateResult } from "./types.ts";

export type ToastInput = {
  title?: string;
  message: string;
  variant: "info" | "success" | "warning" | "error";
  duration?: number;
};

export function formatToastMessage(updates: UpdateResult[]): string {
  const bullets = updates
    .map((u) => {
      const sourceTag = u.source === "git-github" ? " (git)" : "";
      const originTag =
        u.configOrigin === "tui-global"
          ? " (TUI + config)"
          : u.configOrigin === "tui"
            ? " (TUI)"
            : "";
      const label = `${u.name}${sourceTag}${originTag}`;
      return `- ${label}: ${u.pinned} → ${u.latest}`;
    })
    .join("\n");

  if (updates.length === 1) {
    return `Plugin update available:\n${bullets}`;
  }

  return `${updates.length} plugin updates available:\n${bullets}`;
}

export async function notify(deps: {
  updates: UpdateResult[];
  showToast: (toast: ToastInput) => Promise<void>;
  log: Logger;
}): Promise<void> {
  if (deps.updates.length === 0) return;

  const message = formatToastMessage(deps.updates);

  await deps.showToast({ message, variant: "info", duration: 10000 });

  try {
    await deps.log({
      service: "opencode-update-notifier",
      level: "info",
      message,
      extra: { updates: deps.updates },
    });
  } catch {
    // log failure must not suppress toast
  }
}
