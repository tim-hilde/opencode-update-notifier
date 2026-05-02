import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  bundle: true,
  noExternal: ["jsonc-parser", "semver"],
  external: ["@opencode-ai/plugin", "@opencode-ai/sdk"],
});
