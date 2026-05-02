import { describe, expect, test } from "bun:test";
import { loadPluginEntries } from "../src/config/load.ts";

describe("loadPluginEntries", () => {
  test("returns plugin entries from a single valid source", () => {
    const sources = [
      { path: "global.json", content: '{"plugin": ["@scope/pkg@1.0.0", "tool@2.0.0"]}' },
    ];
    const result = loadPluginEntries({ sources, log: async () => {} });
    expect(result).toEqual(["@scope/pkg@1.0.0", "tool@2.0.0"]);
  });

  test("aggregates entries from multiple sources", () => {
    const sources = [
      { path: "global.json", content: '{"plugin": ["pkg-a@1.0.0"]}' },
      { path: "project.json", content: '{"plugin": ["pkg-b@2.0.0"]}' },
    ];
    const result = loadPluginEntries({ sources, log: async () => {} });
    expect(result).toContain("pkg-a@1.0.0");
    expect(result).toContain("pkg-b@2.0.0");
  });

  test("deduplicates exact duplicate entries across sources", () => {
    const sources = [
      { path: "a.json", content: '{"plugin": ["pkg@1.0.0"]}' },
      { path: "b.json", content: '{"plugin": ["pkg@1.0.0"]}' },
    ];
    const result = loadPluginEntries({ sources, log: async () => {} });
    expect(result.filter((e) => e === "pkg@1.0.0")).toHaveLength(1);
  });

  test("handles JSONC with comments and trailing commas", () => {
    const sources = [
      {
        path: "config.jsonc",
        content: `{
          // a comment
          "plugin": [
            "pkg@1.0.0", // inline comment
          ],
        }`,
      },
    ];
    const result = loadPluginEntries({ sources, log: async () => {} });
    expect(result).toEqual(["pkg@1.0.0"]);
  });

  test("skips sources without a plugin array", () => {
    const sources = [{ path: "no-plugins.json", content: '{"theme": "dark"}' }];
    const result = loadPluginEntries({ sources, log: async () => {} });
    expect(result).toEqual([]);
  });

  test("skips sources with invalid JSON and logs the error", async () => {
    const logged: string[] = [];
    const sources = [{ path: "broken.json", content: "not { json" }];
    const result = loadPluginEntries({
      sources,
      log: async (entry) => {
        logged.push(entry.message);
      },
    });
    expect(result).toEqual([]);
    // allow the async log to flush
    await new Promise((r) => setTimeout(r, 0));
    expect(logged.some((m) => m.includes("broken.json"))).toBe(true);
  });

  test("ignores non-string entries inside plugin array", () => {
    const sources = [
      { path: "mixed.json", content: '{"plugin": ["valid@1.0.0", 42, null, {"not": "a string"}]}' },
    ];
    const result = loadPluginEntries({ sources, log: async () => {} });
    expect(result).toEqual(["valid@1.0.0"]);
  });

  test("returns empty array when sources list is empty", () => {
    expect(loadPluginEntries({ sources: [], log: async () => {} })).toEqual([]);
  });
});
