import type { Logger, UpdateResult } from "./types.ts";

export type ToastInput = {
  title?: string;
  message: string;
  variant: "info" | "success" | "warning" | "error";
  duration?: number;
};

export function formatToastMessage(updates: UpdateResult[]): string {
  const inline = updates
    .slice(0, 3)
    .map((u) => `${u.name} ${u.pinned} → ${u.latest}`)
    .join(", ");

  if (updates.length === 1) {
    return `Plugin update available: ${inline}`;
  }

  const suffix = updates.length > 3 ? `, +${updates.length - 3} more` : "";
  return `${updates.length} plugin updates available: ${inline}${suffix}`;
}

export async function notify(deps: {
  updates: UpdateResult[];
  showToast: (toast: ToastInput) => Promise<void>;
  log: Logger;
}): Promise<void> {
  if (deps.updates.length === 0) return;

  const message = formatToastMessage(deps.updates);

  await deps.showToast({ message, variant: "info" });

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
