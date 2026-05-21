import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  getCustomConfigSource,
  getCustomDirSources,
  getGlobalConfigSources,
  getInlineConfigSource,
  getManagedConfigSources,
  getProjectConfigSources,
  getTuiConfigSources,
} from "../src/config/sources.ts";
import type { EnvReader, FsExists, FsReader } from "../src/types.ts";

// helpers
function makeFs(files: Record<string, string>): { fsReader: FsReader; fsExists: FsExists } {
  return {
    fsReader: (p) => {
      if (p in files) return files[p] as string;
      throw new Error(`ENOENT: ${p}`);
    },
    fsExists: (p) => p in files,
  };
}

// --- getGlobalConfigSources ---
describe("getGlobalConfigSources", () => {
  test("returns .json source when only .json exists", () => {
    const { fsReader, fsExists } = makeFs({
      "/home/user/.config/opencode/opencode.json": '{"plugin":[]}',
    });
    const sources = getGlobalConfigSources({
      fsReader,
      fsExists,
      homeDir: () => "/home/user",
      env: () => undefined,
    });
    expect(sources).toHaveLength(1);
    expect(sources[0]?.path).toBe("/home/user/.config/opencode/opencode.json");
  });

  test("returns .jsonc source when only .jsonc exists", () => {
    const { fsReader, fsExists } = makeFs({
      "/home/user/.config/opencode/opencode.jsonc": "{}",
    });
    const sources = getGlobalConfigSources({
      fsReader,
      fsExists,
      homeDir: () => "/home/user",
      env: () => undefined,
    });
    expect(sources).toHaveLength(1);
    expect(sources[0]?.path).toBe("/home/user/.config/opencode/opencode.jsonc");
  });

  test("returns both when both .json and .jsonc exist", () => {
    const { fsReader, fsExists } = makeFs({
      "/home/user/.config/opencode/opencode.json": "{}",
      "/home/user/.config/opencode/opencode.jsonc": "{}",
    });
    const sources = getGlobalConfigSources({
      fsReader,
      fsExists,
      homeDir: () => "/home/user",
      env: () => undefined,
    });
    expect(sources).toHaveLength(2);
  });

  test("honors XDG_CONFIG_HOME", () => {
    const { fsReader, fsExists } = makeFs({
      "/custom/config/opencode/opencode.json": "{}",
    });
    const env: EnvReader = (k) => (k === "XDG_CONFIG_HOME" ? "/custom/config" : undefined);
    const sources = getGlobalConfigSources({
      fsReader,
      fsExists,
      homeDir: () => "/home/user",
      env,
    });
    expect(sources[0]?.path).toBe("/custom/config/opencode/opencode.json");
  });

  test("returns empty array when neither file exists", () => {
    const { fsReader, fsExists } = makeFs({});
    const sources = getGlobalConfigSources({
      fsReader,
      fsExists,
      homeDir: () => "/home/user",
      env: () => undefined,
    });
    expect(sources).toHaveLength(0);
  });
});

// --- getCustomDirSources ---
describe("getCustomDirSources", () => {
  test("returns sources from custom dir when OPENCODE_CONFIG_DIR is set", () => {
    const { fsReader, fsExists } = makeFs({
      "/custom/dir/opencode.json": "{}",
    });
    const env: EnvReader = (k) => (k === "OPENCODE_CONFIG_DIR" ? "/custom/dir" : undefined);
    const sources = getCustomDirSources({ fsReader, fsExists, env });
    expect(sources).toHaveLength(1);
    expect(sources[0]?.path).toBe("/custom/dir/opencode.json");
  });

  test("returns empty array when OPENCODE_CONFIG_DIR is not set", () => {
    const { fsReader, fsExists } = makeFs({});
    const sources = getCustomDirSources({ fsReader, fsExists, env: () => undefined });
    expect(sources).toHaveLength(0);
  });
});

// --- getCustomConfigSource ---
describe("getCustomConfigSource", () => {
  test("returns source when OPENCODE_CONFIG points to existing file", () => {
    const { fsReader, fsExists } = makeFs({
      "/path/to/my.json": '{"plugin":[]}',
    });
    const env: EnvReader = (k) => (k === "OPENCODE_CONFIG" ? "/path/to/my.json" : undefined);
    const source = getCustomConfigSource({ fsReader, fsExists, env });
    expect(source?.path).toBe("/path/to/my.json");
    expect(source?.content).toBe('{"plugin":[]}');
  });

  test("returns null when OPENCODE_CONFIG is not set", () => {
    const { fsReader, fsExists } = makeFs({});
    expect(getCustomConfigSource({ fsReader, fsExists, env: () => undefined })).toBeNull();
  });

  test("returns null when OPENCODE_CONFIG points to missing file", () => {
    const { fsReader, fsExists } = makeFs({});
    const env: EnvReader = (k) => (k === "OPENCODE_CONFIG" ? "/missing/file.json" : undefined);
    expect(getCustomConfigSource({ fsReader, fsExists, env })).toBeNull();
  });
});

// --- getInlineConfigSource ---
describe("getInlineConfigSource", () => {
  test("returns inline source when OPENCODE_CONFIG_CONTENT is set", () => {
    const env: EnvReader = (k) =>
      k === "OPENCODE_CONFIG_CONTENT" ? '{"plugin":["a@1.0.0"]}' : undefined;
    const source = getInlineConfigSource({ env });
    expect(source?.path).toBe("<inline>");
    expect(source?.content).toBe('{"plugin":["a@1.0.0"]}');
  });

  test("returns null when OPENCODE_CONFIG_CONTENT is not set", () => {
    expect(getInlineConfigSource({ env: () => undefined })).toBeNull();
  });

  test("returns null when OPENCODE_CONFIG_CONTENT is empty string", () => {
    const env: EnvReader = (k) => (k === "OPENCODE_CONFIG_CONTENT" ? "" : undefined);
    expect(getInlineConfigSource({ env })).toBeNull();
  });
});

// --- getProjectConfigSources ---
describe("getProjectConfigSources", () => {
  const fixtureRoot = path.resolve(import.meta.dir, "fixtures/project");

  test("finds opencode.json by walking up from subdirectory", () => {
    const { fsReader, fsExists } = makeFs({
      [path.join(fixtureRoot, "opencode.json")]: '{"plugin":["a@1.0.0"]}',
    });
    // start from a deep subdirectory
    const startDir = path.join(fixtureRoot, "sub", "dir");
    const sources = getProjectConfigSources({ fsReader, fsExists, startDir });
    expect(sources.some((s) => s.path === path.join(fixtureRoot, "opencode.json"))).toBe(true);
  });

  test("returns empty array when no opencode config found up to filesystem root", () => {
    const { fsReader, fsExists } = makeFs({});
    // Use a real dir unlikely to contain opencode.json to walk out of
    const sources = getProjectConfigSources({ fsReader, fsExists, startDir: "/tmp" });
    expect(sources).toHaveLength(0);
  });
});

// --- getManagedConfigSources (platform-agnostic test) ---
describe("getManagedConfigSources", () => {
  test("returns source when managed config file exists for given platform paths", () => {
    const platformPaths = ["/managed/opencode/opencode.json"];
    const { fsReader, fsExists } = makeFs({
      "/managed/opencode/opencode.json": "{}",
    });
    // We test the helper directly — it accepts explicit paths for testability
    const sources = getManagedConfigSources({ fsReader, fsExists, platformPaths });
    expect(sources).toHaveLength(1);
    expect(sources[0]?.path).toBe("/managed/opencode/opencode.json");
  });

  test("returns empty array when no managed config files exist", () => {
    const { fsReader, fsExists } = makeFs({});
    const sources = getManagedConfigSources({
      fsReader,
      fsExists,
      platformPaths: ["/etc/opencode/opencode.json"],
    });
    expect(sources).toHaveLength(0);
  });
});

// --- getTuiConfigSources ---
describe("getTuiConfigSources", () => {
  test("returns tui.json source when only .json exists", () => {
    const { fsReader, fsExists } = makeFs({
      "/home/user/.config/opencode/tui.json": '{"plugin":["a@1.0.0"]}',
    });
    const sources = getTuiConfigSources({
      fsReader,
      fsExists,
      homeDir: () => "/home/user",
      env: () => undefined,
    });
    expect(sources).toHaveLength(1);
    expect(sources[0]?.path).toBe("/home/user/.config/opencode/tui.json");
  });

  test("returns tui.jsonc source when only .jsonc exists", () => {
    const { fsReader, fsExists } = makeFs({
      "/home/user/.config/opencode/tui.jsonc": "{}",
    });
    const sources = getTuiConfigSources({
      fsReader,
      fsExists,
      homeDir: () => "/home/user",
      env: () => undefined,
    });
    expect(sources).toHaveLength(1);
    expect(sources[0]?.path).toBe("/home/user/.config/opencode/tui.jsonc");
  });

  test("returns both when both .json and .jsonc exist", () => {
    const { fsReader, fsExists } = makeFs({
      "/home/user/.config/opencode/tui.json": "{}",
      "/home/user/.config/opencode/tui.jsonc": "{}",
    });
    const sources = getTuiConfigSources({
      fsReader,
      fsExists,
      homeDir: () => "/home/user",
      env: () => undefined,
    });
    expect(sources).toHaveLength(2);
  });

  test("honors XDG_CONFIG_HOME", () => {
    const { fsReader, fsExists } = makeFs({
      "/custom/config/opencode/tui.json": "{}",
    });
    const env: EnvReader = (k: string) => (k === "XDG_CONFIG_HOME" ? "/custom/config" : undefined);
    const sources = getTuiConfigSources({
      fsReader,
      fsExists,
      homeDir: () => "/home/user",
      env,
    });
    expect(sources[0]?.path).toBe("/custom/config/opencode/tui.json");
  });

  test("returns empty array when neither file exists", () => {
    const { fsReader, fsExists } = makeFs({});
    const sources = getTuiConfigSources({
      fsReader,
      fsExists,
      homeDir: () => "/home/user",
      env: () => undefined,
    });
    expect(sources).toHaveLength(0);
  });
});
