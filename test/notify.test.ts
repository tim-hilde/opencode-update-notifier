import { describe, expect, test } from "bun:test";
import { formatToastMessage, notify } from "../src/notify.ts";
import type { Logger, UpdateResult } from "../src/types.ts";

const noopLog: Logger = async () => {};

describe("formatToastMessage", () => {
  test("single update", () => {
    const updates: UpdateResult[] = [{ name: "pkg-a", pinned: "1.0.0", latest: "2.0.0" }];
    expect(formatToastMessage(updates)).toBe("Plugin update available: pkg-a 1.0.0 → 2.0.0");
  });

  test("two updates (no truncation)", () => {
    const updates: UpdateResult[] = [
      { name: "pkg-a", pinned: "1.0.0", latest: "2.0.0" },
      { name: "pkg-b", pinned: "3.0.0", latest: "4.0.0" },
    ];
    expect(formatToastMessage(updates)).toBe(
      "2 plugin updates available: pkg-a 1.0.0 → 2.0.0, pkg-b 3.0.0 → 4.0.0",
    );
  });

  test("three updates (no truncation)", () => {
    const updates: UpdateResult[] = [
      { name: "pkg-a", pinned: "1.0.0", latest: "2.0.0" },
      { name: "pkg-b", pinned: "3.0.0", latest: "4.0.0" },
      { name: "pkg-c", pinned: "5.0.0", latest: "6.0.0" },
    ];
    expect(formatToastMessage(updates)).toBe(
      "3 plugin updates available: pkg-a 1.0.0 → 2.0.0, pkg-b 3.0.0 → 4.0.0, pkg-c 5.0.0 → 6.0.0",
    );
  });

  test("five updates (truncated after 3)", () => {
    const updates: UpdateResult[] = [
      { name: "pkg-a", pinned: "1.0.0", latest: "2.0.0" },
      { name: "pkg-b", pinned: "1.0.0", latest: "2.0.0" },
      { name: "pkg-c", pinned: "1.0.0", latest: "2.0.0" },
      { name: "pkg-d", pinned: "1.0.0", latest: "2.0.0" },
      { name: "pkg-e", pinned: "1.0.0", latest: "2.0.0" },
    ];
    expect(formatToastMessage(updates)).toBe(
      "5 plugin updates available: pkg-a 1.0.0 → 2.0.0, pkg-b 1.0.0 → 2.0.0, pkg-c 1.0.0 → 2.0.0, +2 more",
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
      updates: [{ name: "pkg-a", pinned: "1.0.0", latest: "2.0.0" }],
      showToast: async (t) => {
        toastCalls.push(t);
      },
      log: async (e) => {
        logCalls.push(e);
      },
    });
    expect(toastCalls).toHaveLength(1);
    expect((toastCalls[0] as { message: string; variant: string }).message).toBe(
      "Plugin update available: pkg-a 1.0.0 → 2.0.0",
    );
    expect((toastCalls[0] as { variant: string }).variant).toBe("info");
    expect(logCalls).toHaveLength(1);
  });

  test("calls showToast even if log call fails", async () => {
    const toastCalls: unknown[] = [];
    await notify({
      updates: [{ name: "pkg-a", pinned: "1.0.0", latest: "2.0.0" }],
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
