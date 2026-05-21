import path from "node:path";
import type { EnvReader, FsExists, FsReader } from "../types.ts";

export type ConfigSource = { path: string; content: string };

function readIfExists(
  fsReader: FsReader,
  fsExists: FsExists,
  filePath: string,
): ConfigSource | null {
  if (!fsExists(filePath)) return null;
  try {
    return { path: filePath, content: fsReader(filePath) };
  } catch {
    return null;
  }
}

export function getGlobalConfigSources(deps: {
  fsReader: FsReader;
  fsExists: FsExists;
  homeDir: () => string;
  env: EnvReader;
}): ConfigSource[] {
  const xdg = deps.env("XDG_CONFIG_HOME");
  const configBase = xdg ?? path.join(deps.homeDir(), ".config");
  const dir = path.join(configBase, "opencode");
  const results: ConfigSource[] = [];
  for (const name of ["opencode.json", "opencode.jsonc"]) {
    const s = readIfExists(deps.fsReader, deps.fsExists, path.join(dir, name));
    if (s) results.push(s);
  }
  return results;
}

export function getCustomDirSources(deps: {
  fsReader: FsReader;
  fsExists: FsExists;
  env: EnvReader;
}): ConfigSource[] {
  const dir = deps.env("OPENCODE_CONFIG_DIR");
  if (!dir) return [];
  const results: ConfigSource[] = [];
  for (const name of ["opencode.json", "opencode.jsonc"]) {
    const s = readIfExists(deps.fsReader, deps.fsExists, path.join(dir, name));
    if (s) results.push(s);
  }
  return results;
}

export function getCustomConfigSource(deps: {
  fsReader: FsReader;
  fsExists: FsExists;
  env: EnvReader;
}): ConfigSource | null {
  const filePath = deps.env("OPENCODE_CONFIG");
  if (!filePath) return null;
  return readIfExists(deps.fsReader, deps.fsExists, filePath);
}

export function getInlineConfigSource(deps: { env: EnvReader }): ConfigSource | null {
  const content = deps.env("OPENCODE_CONFIG_CONTENT");
  if (!content) return null;
  return { path: "<inline>", content };
}

export function getProjectConfigSources(deps: {
  fsReader: FsReader;
  fsExists: FsExists;
  startDir: string;
}): ConfigSource[] {
  const results: ConfigSource[] = [];
  let current = deps.startDir;
  // Walk up to filesystem root
  while (true) {
    for (const name of ["opencode.json", "opencode.jsonc"]) {
      const s = readIfExists(deps.fsReader, deps.fsExists, path.join(current, name));
      if (s) results.push(s);
    }
    // Stop if we found a .git directory at this level
    if (deps.fsExists(path.join(current, ".git"))) break;
    const parent = path.dirname(current);
    if (parent === current) break; // filesystem root
    current = parent;
  }
  return results;
}

/** Platform paths are passed in explicitly to allow testing without touching real OS paths. */
export function getManagedConfigSources(deps: {
  fsReader: FsReader;
  fsExists: FsExists;
  platformPaths: string[];
}): ConfigSource[] {
  const results: ConfigSource[] = [];
  for (const p of deps.platformPaths) {
    const s = readIfExists(deps.fsReader, deps.fsExists, p);
    if (s) results.push(s);
  }
  return results;
}

export function getTuiConfigSources(deps: {
  fsReader: FsReader;
  fsExists: FsExists;
  homeDir: () => string;
  env: EnvReader;
}): ConfigSource[] {
  const xdg = deps.env("XDG_CONFIG_HOME");
  const configBase = xdg ?? path.join(deps.homeDir(), ".config");
  const dir = path.join(configBase, "opencode");
  const results: ConfigSource[] = [];
  for (const name of ["tui.json", "tui.jsonc"]) {
    const s = readIfExists(deps.fsReader, deps.fsExists, path.join(dir, name));
    if (s) results.push(s);
  }
  return results;
}

/** Returns the platform-specific managed config paths for the current OS. */
export function getManagedPlatformPaths(env: EnvReader): string[] {
  switch (process.platform) {
    case "darwin":
      return [
        "/Library/Application Support/opencode/opencode.json",
        "/Library/Application Support/opencode/opencode.jsonc",
      ];
    case "win32": {
      const programData = env("ProgramData") ?? "C:\\ProgramData";
      return [
        path.join(programData, "opencode", "opencode.json"),
        path.join(programData, "opencode", "opencode.jsonc"),
      ];
    }
    default:
      return ["/etc/opencode/opencode.json", "/etc/opencode/opencode.jsonc"];
  }
}
