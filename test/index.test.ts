import { describe, expect, test } from "bun:test";
import type { Config } from "@opencode-ai/plugin";
import type { Event } from "@opencode-ai/sdk";
import { OpencodeUpdateNotifier } from "../src/index.ts";

// Minimal fake client shaped like the subset we actually use
function makeClient(overrides?: {
  showToastFn?: () => Promise<{ data: boolean; error: null }>;
  logFn?: () => Promise<{ data: boolean; error: null }>;
}) {
  return {
    tui: {
      showToast: overrides?.showToastFn ?? (async () => ({ data: true, error: null })),
    },
    app: {
      log: overrides?.logFn ?? (async () => ({ data: true, error: null })),
    },
  };
}

// Fire the event hook with a session.created event
async function fireSessionCreated(hooks: { event?: (input: { event: Event }) => Promise<void> }) {
  await hooks.event?.({
    event: { type: "session.created", properties: { info: {} as never } } as Event,
  });
}

describe("OpencodeUpdateNotifier plugin", () => {
  test("runs check only once across multiple session.created events", async () => {
    let checkCount = 0;

    const hooks = await OpencodeUpdateNotifier(
      {
        client: makeClient() as never,
        project: {} as never,
        directory: "/tmp",
        worktree: "/tmp",
        experimental_workspace: { register: () => {} },
        serverUrl: new URL("http://localhost:1234"),
        $: {} as never,
      },
      {},
      // Inject a fake runCheck via internal dep injection escape hatch
      {
        _runCheck: async () => {
          checkCount++;
          return [];
        },
      },
    );

    await fireSessionCreated(hooks);
    await fireSessionCreated(hooks);
    await fireSessionCreated(hooks);

    expect(checkCount).toBe(1);
  });

  test("ignores non-session.created events", async () => {
    let checkCount = 0;
    const hooks = await OpencodeUpdateNotifier(
      {
        client: makeClient() as never,
        project: {} as never,
        directory: "/tmp",
        worktree: "/tmp",
        experimental_workspace: { register: () => {} },
        serverUrl: new URL("http://localhost:1234"),
        $: {} as never,
      },
      {},
      {
        _runCheck: async () => {
          checkCount++;
          return [];
        },
      },
    );

    await hooks.event?.({
      event: { type: "session.updated", properties: { info: {} as never } } as Event,
    });

    expect(checkCount).toBe(0);
  });

  test("calls showToast when runCheck returns updates", async () => {
    const toastCalls: unknown[] = [];
    const showToastFn = async (args: unknown) => {
      toastCalls.push(args);
      return { data: true, error: null };
    };

    const hooks = await OpencodeUpdateNotifier(
      {
        client: makeClient({ showToastFn }) as never,
        project: {} as never,
        directory: "/tmp",
        worktree: "/tmp",
        experimental_workspace: { register: () => {} },
        serverUrl: new URL("http://localhost:1234"),
        $: {} as never,
      },
      {},
      {
        _runCheck: async () => [{ name: "my-pkg", pinned: "1.0.0", latest: "2.0.0" }],
      },
    );

    await fireSessionCreated(hooks);

    expect(toastCalls).toHaveLength(1);
  });

  test("does not throw when runCheck throws", async () => {
    const hooks = await OpencodeUpdateNotifier(
      {
        client: makeClient() as never,
        project: {} as never,
        directory: "/tmp",
        worktree: "/tmp",
        experimental_workspace: { register: () => {} },
        serverUrl: new URL("http://localhost:1234"),
        $: {} as never,
      },
      {},
      {
        _runCheck: async () => {
          throw new Error("catastrophic failure");
        },
      },
    );

    // Must not throw
    await expect(fireSessionCreated(hooks)).resolves.toBeUndefined();
  });
});

describe("config hook", () => {
  test("registers check-updates command", async () => {
    const hooks = await OpencodeUpdateNotifier(
      {
        client: makeClient() as never,
        project: {} as never,
        directory: "/tmp",
        worktree: "/tmp",
        experimental_workspace: { register: () => {} },
        serverUrl: new URL("http://localhost:1234"),
        $: {} as never,
      },
      {},
    );

    const cfg: Config = {};
    await hooks.config?.(cfg);

    expect(cfg.command?.["check-updates"]).toBeDefined();
    expect(cfg.command?.["check-updates"]?.description).toBe(
      "Check if your OpenCode plugins have newer versions available",
    );
    expect(cfg.command?.["check-updates"]?.template).toBe("");
  });
});
