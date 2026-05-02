import { parse } from "jsonc-parser";
import type { Logger } from "../types.ts";
import type { ConfigSource } from "./sources.ts";

export function loadPluginEntries(deps: {
  sources: ConfigSource[];
  log: Logger;
}): string[] {
  const all: string[] = [];

  for (const source of deps.sources) {
    try {
      const errors: unknown[] = [];
      const parsed = parse(source.content, errors as Parameters<typeof parse>[1], {
        allowTrailingComma: true,
      }) as unknown;

      if (errors.length > 0) {
        // jsonc-parser populates the errors array for parse failures
        void deps.log({
          service: "opencode-update-notifier",
          level: "warn",
          message: `Failed to parse config source: ${source.path}`,
          extra: { errors },
        });
        continue;
      }

      if (typeof parsed !== "object" || parsed === null) continue;
      const plugin = (parsed as Record<string, unknown>).plugin;
      if (!Array.isArray(plugin)) continue;

      for (const entry of plugin) {
        if (typeof entry === "string") all.push(entry);
      }
    } catch (err) {
      void deps.log({
        service: "opencode-update-notifier",
        level: "warn",
        message: `Failed to parse config source: ${source.path}`,
        extra: { error: String(err) },
      });
    }
  }

  // Deduplicate by exact identity
  return [...new Set(all)];
}
