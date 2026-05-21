import { describe, expect, test } from "bun:test";
import { formatToastMessage, notify } from "../src/notify.ts";
import type { Logger, UpdateResult } from "../src/types.ts";

const noopLog: Logger = async () => {};

describe("formatToastMessage", () => {
  test("single update", () => {
    const updates: UpdateResult[] = [
      { source: "npm", name: "pkg-a", pinned: "1.0.0", latest: "2.0.0", configOrigin: "global" },
    ];
    expect(formatToastMessage(updates)).toBe("Plugin update available:\n- pkg-a: 1.0.0 → 2.0.0");
  });

  test("two updates", () => {
    const updates: UpdateResult[] = [
      { source: "npm", name: "pkg-a", pinned: "1.0.0", latest: "2.0.0", configOrigin: "global" },
      { source: "npm", name: "pkg-b", pinned: "3.0.0", latest: "4.0.0", configOrigin: "global" },
    ];
    expect(formatToastMessage(updates)).toBe(
      "2 plugin updates available:\n- pkg-a: 1.0.0 → 2.0.0\n- pkg-b: 3.0.0 → 4.0.0",
    );
  });

  test("three updates", () => {
    const updates: UpdateResult[] = [
      { source: "npm", name: "pkg-a", pinned: "1.0.0", latest: "2.0.0", configOrigin: "global" },
      { source: "npm", name: "pkg-b", pinned: "3.0.0", latest: "4.0.0", configOrigin: "global" },
      { source: "npm", name: "pkg-c", pinned: "5.0.0", latest: "6.0.0", configOrigin: "global" },
    ];
    expect(formatToastMessage(updates)).toBe(
      "3 plugin updates available:\n- pkg-a: 1.0.0 → 2.0.0\n- pkg-b: 3.0.0 → 4.0.0\n- pkg-c: 5.0.0 → 6.0.0",
    );
  });

  test("five updates (all shown, no truncation)", () => {
    const updates: UpdateResult[] = [
      { source: "npm", name: "pkg-a", pinned: "1.0.0", latest: "2.0.0", configOrigin: "global" },
      { source: "npm", name: "pkg-b", pinned: "1.0.0", latest: "2.0.0", configOrigin: "global" },
      { source: "npm", name: "pkg-c", pinned: "1.0.0", latest: "2.0.0", configOrigin: "global" },
      { source: "npm", name: "pkg-d", pinned: "1.0.0", latest: "2.0.0", configOrigin: "global" },
      { source: "npm", name: "pkg-e", pinned: "1.0.0", latest: "2.0.0", configOrigin: "global" },
    ];
    expect(formatToastMessage(updates)).toBe(
      "5 plugin updates available:\n- pkg-a: 1.0.0 → 2.0.0\n- pkg-b: 1.0.0 → 2.0.0\n- pkg-c: 1.0.0 → 2.0.0\n- pkg-d: 1.0.0 → 2.0.0\n- pkg-e: 1.0.0 → 2.0.0",
    );
  });

  test("git-github update renders with (git) tag", () => {
    const updates: UpdateResult[] = [
      {
        source: "git-github",
        name: "superpowers",
        owner: "obra",
        repo: "superpowers",
        pinned: "5.1.0",
        latest: "5.2.0",
        configOrigin: "global",
      },
    ];
    expect(formatToastMessage(updates)).toBe(
      "Plugin update available:\n- superpowers (git): 5.1.0 → 5.2.0",
    );
  });

  test("mixed npm and git-github list renders both correctly", () => {
    const updates: UpdateResult[] = [
      { source: "npm", name: "pkg-a", pinned: "1.0.0", latest: "2.0.0", configOrigin: "global" },
      {
        source: "git-github",
        name: "superpowers",
        owner: "obra",
        repo: "superpowers",
        pinned: "5.1.0",
        latest: "5.2.0",
        configOrigin: "global",
      },
    ];
    const message = formatToastMessage(updates);
    expect(message).toContain("- pkg-a: 1.0.0 → 2.0.0");
    expect(message).toContain("- superpowers (git): 5.1.0 → 5.2.0");
    expect(message).not.toContain("pkg-a (git)");
  });

  test("mixed list aggregation count is correct", () => {
    const updates: UpdateResult[] = [
      { source: "npm", name: "pkg-a", pinned: "1.0.0", latest: "2.0.0", configOrigin: "global" },
      {
        source: "git-github",
        name: "superpowers",
        owner: "obra",
        repo: "superpowers",
        pinned: "5.1.0",
        latest: "5.2.0",
        configOrigin: "global",
      },
    ];
    expect(formatToastMessage(updates)).toMatch(/^2 plugin updates available:/);
  });
});

describe("formatToastMessage — origin suffix", () => {
  test("tui-only plugin shows (TUI) suffix", () => {
    const updates: UpdateResult[] = [
      { source: "npm", name: "tui-plugin", pinned: "1.0.0", latest: "2.0.0", configOrigin: "tui" },
    ];
    expect(formatToastMessage(updates)).toBe(
      "Plugin update available:\n- tui-plugin (TUI): 1.0.0 → 2.0.0",
    );
  });

  test("dual-origin plugin shows (TUI + config) suffix", () => {
    const updates: UpdateResult[] = [
      {
        source: "npm",
        name: "shared-pkg",
        pinned: "1.0.0",
        latest: "2.0.0",
        configOrigin: "tui-global",
      },
    ];
    expect(formatToastMessage(updates)).toBe(
      "Plugin update available:\n- shared-pkg (TUI + config): 1.0.0 → 2.0.0",
    );
  });

  test("git-github with tui origin shows both suffixes in correct order", () => {
    const updates: UpdateResult[] = [
      {
        source: "git-github",
        name: "tui-git-pkg",
        owner: "org",
        repo: "repo",
        pinned: "1.0.0",
        latest: "2.0.0",
        configOrigin: "tui",
      },
    ];
    expect(formatToastMessage(updates)).toBe(
      "Plugin update available:\n- tui-git-pkg (git) (TUI): 1.0.0 → 2.0.0",
    );
  });
});

describe("notify", () => {
  test("does nothing when updates array is empty", async () => {
    const toastCalls: unknown[] = [];
    await notify({
      updates: [],
      showToast: async (t) => {
        toastCalls.push(t);
      },
      log: noopLog,
    });
    expect(toastCalls).toHaveLength(0);
  });

  test("calls showToast with correct message and variant for one update", async () => {
    const toastCalls: unknown[] = [];
    const logCalls: unknown[] = [];
    await notify({
      updates: [
        { source: "npm", name: "pkg-a", pinned: "1.0.0", latest: "2.0.0", configOrigin: "global" },
      ],
      showToast: async (t) => {
        toastCalls.push(t);
      },
      log: async (e) => {
        logCalls.push(e);
      },
    });
    expect(toastCalls).toHaveLength(1);
    expect((toastCalls[0] as { message: string; variant: string }).message).toBe(
      "Plugin update available:\n- pkg-a: 1.0.0 → 2.0.0",
    );
    expect((toastCalls[0] as { variant: string }).variant).toBe("info");
    expect((toastCalls[0] as { duration: number }).duration).toBe(10000);
    expect(logCalls).toHaveLength(1);
  });

  test("calls showToast even if log call fails", async () => {
    const toastCalls: unknown[] = [];
    await notify({
      updates: [
        { source: "npm", name: "pkg-a", pinned: "1.0.0", latest: "2.0.0", configOrigin: "global" },
      ],
      showToast: async (t) => {
        toastCalls.push(t);
      },
      log: async () => {
        throw new Error("log failed");
      },
    });
    expect(toastCalls).toHaveLength(1);
  });
});
