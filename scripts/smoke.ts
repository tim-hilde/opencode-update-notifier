/**
 * Smoke test for the opencode-update-notifier plugin.
 *
 * Runs the plugin end-to-end against the real npm registry (with caching)
 * without requiring a running OpenCode instance.
 *
 * Usage:
 *   bun run smoke
 *
 * The fixture opencode.json at scripts/fixtures/opencode.json contains two
 * deliberately stale pinned entries so the plugin has something to report.
 * Edit it to test other scenarios.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Event } from "@opencode-ai/sdk";
import plugin from "../dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "fixtures");

// Fake client that logs calls to stdout
const toastCalls: Array<{ message: string; variant: string }> = [];
const logCalls: Array<{ level: string; message: string }> = [];

const client = {
  tui: {
    showToast: async (req: { body: { message: string; variant: string } }) => {
      toastCalls.push(req.body);
      return { data: true, error: null };
    },
  },
  app: {
    log: async (req: { body: { level: string; message: string; extra?: unknown } }) => {
      logCalls.push(req.body);

      return { data: true, error: null };
    },
  },
};

console.log("Starting smoke test...");
console.log(`Fixture dir: ${fixtureDir}\n`);

const hooks = await plugin(
  {
    client: client as never,
    project: {} as never,
    directory: fixtureDir,
    worktree: fixtureDir,
    experimental_workspace: { register: () => {} },
    serverUrl: new URL("http://localhost:1234"),
    $: {} as never,
  },
  {},
);

// Fire installation.update-available (the event the plugin listens on)
await hooks.event?.({
  event: { type: "installation.update-available", properties: {} as never } as Event,
});

// The plugin delays 3s before running the check; wait for it to complete
await new Promise((resolve) => setTimeout(resolve, 5000));

console.log("=== Log calls ===");
for (const entry of logCalls) {
  console.log(`[${entry.level}] ${entry.message}`);
}

console.log("\n=== Toast calls ===");
if (toastCalls.length === 0) {
  console.log("(none — all plugins are up to date or no pinned plugins found)");
} else {
  for (const toast of toastCalls) {
    console.log(`[${toast.variant}] ${toast.message}`);
  }
}

console.log("\n=== Summary ===");
console.log(`Logs: ${logCalls.length}, Toasts: ${toastCalls.length}`);

if (toastCalls.length > 0) {
  console.log("\nSMOKE TEST PASSED — toast was sent.");
  process.exit(0);
} else {
  console.log(
    "\nNo toast sent. Check that scripts/fixtures/opencode.json has stale pinned entries.",
  );
  process.exit(1);
}
