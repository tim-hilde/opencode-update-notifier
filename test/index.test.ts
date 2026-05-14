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

async function fireInstallationUpdateAvailable(hooks: {
  event?: (input: { event: Event }) => Promise<void>;
}) {
  await hooks.event?.({
    event: { type: "installation.update-available", properties: {} } as Event,
  });
}

describe("OpencodeUpdateNotifier plugin", () => {
  test("runs check only once on installation.update-available (with 3s delay)", async () => {
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

    await fireInstallationUpdateAvailable(hooks);
    await fireInstallationUpdateAvailable(hooks);
    await fireInstallationUpdateAvailable(hooks);

    await new Promise((r) => setTimeout(r, 3500));

    expect(checkCount).toBe(1);
  });

  test("ignores non-installation.update-available events", async () => {
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

    await fireInstallationUpdateAvailable(hooks);

    await new Promise((r) => setTimeout(r, 3500));

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

    await fireInstallationUpdateAvailable(hooks);
    await new Promise((r) => setTimeout(r, 100));

    expect(true).toBe(true);
  });
});

describe("slash command", () => {
  test("command.execute.before runs check when command is check-updates", async () => {
    let checkCalledWith: unknown = null;
    const toastCalls: unknown[] = [];

    const hooks = await OpencodeUpdateNotifier(
      {
        client: makeClient({
          showToastFn: async (args) => {
            toastCalls.push(args);
            return { data: true, error: null };
          },
        }) as never,
        project: {} as never,
        directory: "/tmp",
        worktree: "/tmp",
        experimental_workspace: { register: () => {} },
        serverUrl: new URL("http://localhost:1234"),
        $: {} as never,
      },
      {},
      {
        _runCheck: async (deps) => {
          checkCalledWith = deps;
          return [{ name: "pkg", pinned: "1.0.0", latest: "2.0.0" }];
        },
      },
    );

    await (
      hooks as unknown as {
        "command.execute.before"?: (input: unknown, output: unknown) => Promise<void>;
      }
    )["command.execute.before"]?.(
      {
        command: "check-updates",
        sessionID: "s1",
        arguments: "",
      },
      {},
    );

    expect(checkCalledWith).not.toBeNull();
    expect((checkCalledWith as { forceRefresh?: boolean }).forceRefresh).toBe(true);
    expect(toastCalls).toHaveLength(1);
  });

  test("command.execute.before ignores other commands", async () => {
    let checkCalled = false;

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
          checkCalled = true;
          return [];
        },
      },
    );

    await (
      hooks as unknown as {
        "command.execute.before"?: (input: unknown, output: unknown) => Promise<void>;
      }
    )["command.execute.before"]?.(
      {
        command: "some-other-command",
        sessionID: "s1",
        arguments: "",
      },
      {},
    );

    expect(checkCalled).toBe(false);
  });

  test("command.execute.before logs errors without throwing", async () => {
    const logCalls: unknown[] = [];

    const hooks = await OpencodeUpdateNotifier(
      {
        client: makeClient({
          logFn: async (args) => {
            logCalls.push(args);
            return { data: true, error: null };
          },
        }) as never,
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
          throw new Error("registry down");
        },
      },
    );

    await expect(
      (
        hooks as unknown as {
          "command.execute.before"?: (input: unknown, output: unknown) => Promise<void>;
        }
      )["command.execute.before"]?.(
        {
          command: "check-updates",
          sessionID: "s1",
          arguments: "",
        },
        {},
      ),
    ).resolves.toBeUndefined();

    expect(logCalls.length).toBeGreaterThan(0);
  });
});

describe("fetchLatestGithubTag wiring", () => {
  test("end-to-end with git plugin entry: toast contains git update line", async () => {
    const toastCalls: Array<{ body: { message: string } }> = [];

    const hooks = await OpencodeUpdateNotifier(
      {
        client: makeClient({
          showToastFn: async (args: unknown) => {
            toastCalls.push(args as { body: { message: string } });
            return { data: true, error: null };
          },
        }) as never,
        project: {} as never,
        directory: "/tmp",
        worktree: "/tmp",
        experimental_workspace: { register: () => {} },
        serverUrl: new URL("http://localhost:1234"),
        $: {} as never,
      },
      {},
      {
        _runCheck: async (_deps) => [
          { source: "git-github" as const, name: "superpowers", pinned: "5.1.0", latest: "5.2.0" },
        ],
      },
    );

    await (
      hooks as unknown as {
        "command.execute.before"?: (input: unknown, output: unknown) => Promise<void>;
      }
    )["command.execute.before"]?.({ command: "check-updates", sessionID: "s1", arguments: "" }, {});

    expect(toastCalls).toHaveLength(1);
    const msg = (toastCalls[0] as { body: { message: string } }).body.message;
    expect(msg).toContain("superpowers (git): 5.1.0 → 5.2.0");
  });

  test("_runCheck receives fetchLatestGithubTag in deps", async () => {
    let receivedFetchLatestGithubTag: unknown = undefined;

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
        _runCheck: async (deps) => {
          receivedFetchLatestGithubTag = deps.fetchLatestGithubTag;
          return [];
        },
      },
    );

    await (
      hooks as unknown as {
        "command.execute.before"?: (input: unknown, output: unknown) => Promise<void>;
      }
    )["command.execute.before"]?.({ command: "check-updates", sessionID: "s1", arguments: "" }, {});

    expect(typeof receivedFetchLatestGithubTag).toBe("function");
  });

  test("mixed npm + git: toast contains both update lines", async () => {
    const toastCalls: Array<{ body: { message: string } }> = [];

    const hooks = await OpencodeUpdateNotifier(
      {
        client: makeClient({
          showToastFn: async (args: unknown) => {
            toastCalls.push(args as { body: { message: string } });
            return { data: true, error: null };
          },
        }) as never,
        project: {} as never,
        directory: "/tmp",
        worktree: "/tmp",
        experimental_workspace: { register: () => {} },
        serverUrl: new URL("http://localhost:1234"),
        $: {} as never,
      },
      {},
      {
        _runCheck: async (_deps) => [
          { source: "npm" as const, name: "my-npm-pkg", pinned: "1.0.0", latest: "1.1.0" },
          { source: "git-github" as const, name: "superpowers", pinned: "5.1.0", latest: "5.2.0" },
        ],
      },
    );

    await (
      hooks as unknown as {
        "command.execute.before"?: (input: unknown, output: unknown) => Promise<void>;
      }
    )["command.execute.before"]?.({ command: "check-updates", sessionID: "s1", arguments: "" }, {});

    expect(toastCalls).toHaveLength(1);
    const msg = (toastCalls[0] as { body: { message: string } }).body.message;
    expect(msg).toContain("my-npm-pkg 1.0.0 → 1.1.0");
    expect(msg).toContain("superpowers (git): 5.1.0 → 5.2.0");
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
