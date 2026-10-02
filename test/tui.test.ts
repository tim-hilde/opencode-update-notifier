import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToastInput } from "../src/notify.ts";
import { createTuiPlugin } from "../src/tui.ts";
import type { UpdateResult } from "../src/types.ts";

type Command = { slash?: { name: string }; run: (input?: string) => unknown };
type Layer = { mode?: string; commands?: readonly Command[] };

function makeContext() {
  const toasts: ToastInput[] = [];
  const commands: Command[] = [];
  const layers: Layer[] = [];
  const context = {
    location: { directory: "/tmp/project" },
    data: { location: { default: () => ({ directory: "/tmp/default" }) } },
    ui: {
      toast: { show: (toast: ToastInput) => toasts.push(toast) },
      // Layers only register inside a slot render (it supplies the reactive owner).
      slot: (claim: { append?: string; render: (input: object) => unknown }) => {
        if (claim.append === "app") claim.render({});
        return () => {};
      },
    },
    keymap: {
      layer: (input: () => Layer) => {
        const layer = input();
        layers.push(layer);
        commands.push(...(layer.commands ?? []));
      },
    },
  };
  return { context, toasts, commands, layers };
}

const update: UpdateResult = {
  source: "npm",
  name: "pkg",
  pinned: "1.0.0",
  latest: "2.0.0",
  configOrigin: "global",
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("TUI plugin", () => {
  test("checks once on startup and shows updates as a toast", async () => {
    const calls: Array<boolean | undefined> = [];
    const plugin = createTuiPlugin({
      _startupDelayMs: 5,
      _runCheck: async (deps) => {
        calls.push(deps.forceRefresh);
        return [update];
      },
    });
    const { context, toasts } = makeContext();

    await plugin.setup(context as never);
    await wait(30);

    expect(calls).toEqual([undefined]);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.message).toContain("pkg: 1.0.0 → 2.0.0");
  });

  test("cleanup cancels a startup check that has not run yet", async () => {
    let checks = 0;
    const plugin = createTuiPlugin({
      _startupDelayMs: 20,
      _runCheck: async () => {
        checks++;
        return [];
      },
    });

    const cleanup = await plugin.setup(makeContext().context as never);
    await cleanup?.();
    await wait(40);

    expect(checks).toBe(0);
  });

  test("/check-updates forces a fresh check", async () => {
    const calls: Array<boolean | undefined> = [];
    const plugin = createTuiPlugin({
      _startupDelayMs: 60_000,
      _runCheck: async (deps) => {
        calls.push(deps.forceRefresh);
        return [update];
      },
    });
    const { context, toasts, commands, layers } = makeContext();

    const cleanup = await plugin.setup(context as never);
    expect(layers.map((l) => l.mode)).toEqual(["global"]);
    const command = commands.find((c) => c.slash?.name === "check-updates");
    await command?.run();
    await wait(10);
    await cleanup?.();

    expect(calls).toEqual([true]);
    expect(toasts).toHaveLength(1);
  });

  test("reads project config from the TUI location", async () => {
    const project = mkdtempSync(join(tmpdir(), "notifier-tui-"));
    mkdirSync(join(project, ".git"));
    writeFileSync(join(project, "opencode.json"), '{"plugins": ["probe-pkg@1.0.0"]}');
    let names: string[] = [];
    const plugin = createTuiPlugin({
      _startupDelayMs: 1,
      _runCheck: async (deps) => {
        names = deps.entries.map((e) => e.name);
        return [];
      },
    });
    const { context } = makeContext();
    context.location = { directory: project };

    await plugin.setup(context as never);
    await wait(20);

    expect(names).toContain("probe-pkg");
  });
});
