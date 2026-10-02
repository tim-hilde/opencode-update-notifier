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
      const config = parsed as Record<string, unknown>;

      // OpenCode 1 uses `plugin`; OpenCode 2 uses `plugins` with string or
      // { package, options } entries.
      for (const list of [config.plugin, config.plugins]) {
        if (!Array.isArray(list)) continue;
        for (const entry of list) {
          if (typeof entry === "string") all.push(entry);
          else if (typeof entry?.package === "string") all.push(entry.package);
        }
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
