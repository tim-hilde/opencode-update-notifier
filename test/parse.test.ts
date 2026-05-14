import { describe, expect, test } from "bun:test";
import { parseEntries, parseEntry } from "../src/parse.ts";

describe("parseEntry", () => {
  test("scoped + pinned", () => {
    expect(parseEntry("@scope/pkg@1.2.3")).toEqual({
      source: "npm",
      name: "@scope/pkg",
      version: "1.2.3",
    });
  });

  test("unscoped + pinned", () => {
    expect(parseEntry("my-pkg@2.0.0")).toEqual({ source: "npm", name: "my-pkg", version: "2.0.0" });
  });

  test("pre-release version", () => {
    expect(parseEntry("my-pkg@1.0.0-beta.1")).toEqual({
      source: "npm",
      name: "my-pkg",
      version: "1.0.0-beta.1",
    });
  });

  test("scoped pre-release version", () => {
    expect(parseEntry("@scope/pkg@1.0.0-alpha.2")).toEqual({
      source: "npm",
      name: "@scope/pkg",
      version: "1.0.0-alpha.2",
    });
  });

  test("unscoped without version returns null", () => {
    expect(parseEntry("my-pkg")).toBeNull();
  });

  test("scoped without version returns null", () => {
    expect(parseEntry("@scope/pkg")).toBeNull();
  });

  test("local path returns null", () => {
    expect(parseEntry("./local/plugin")).toBeNull();
  });

  test("absolute path returns null", () => {
    expect(parseEntry("/absolute/path")).toBeNull();
  });

  test("empty string returns null", () => {
    expect(parseEntry("")).toBeNull();
  });

  test("bare @scope without package name returns null", () => {
    expect(parseEntry("@scope")).toBeNull();
  });

  // GitHub git URL cases
  test("github git URL with .git suffix", () => {
    expect(parseEntry("superpowers@git+https://github.com/obra/superpowers.git#v5.1.0")).toEqual({
      source: "git-github",
      name: "superpowers",
      owner: "obra",
      repo: "superpowers",
      version: "5.1.0",
    });
  });

  test("github git URL without .git suffix", () => {
    expect(parseEntry("superpowers@git+https://github.com/obra/superpowers#v5.1.0")).toEqual({
      source: "git-github",
      name: "superpowers",
      owner: "obra",
      repo: "superpowers",
      version: "5.1.0",
    });
  });

  test("scoped name with github git URL", () => {
    expect(parseEntry("@scope/pkg@git+https://github.com/owner/repo.git#v1.0.0")).toEqual({
      source: "git-github",
      name: "@scope/pkg",
      owner: "owner",
      repo: "repo",
      version: "1.0.0",
    });
  });

  test("github git URL with pre-release version", () => {
    expect(parseEntry("pkg@git+https://github.com/owner/repo.git#v1.0.0-beta.1")).toEqual({
      source: "git-github",
      name: "pkg",
      owner: "owner",
      repo: "repo",
      version: "1.0.0-beta.1",
    });
  });

  test("github git URL with partial version #v5 coerces to 5.0.0", () => {
    expect(parseEntry("pkg@git+https://github.com/owner/repo.git#v5")).toEqual({
      source: "git-github",
      name: "pkg",
      owner: "owner",
      repo: "repo",
      version: "5.0.0",
    });
  });

  test("github git URL with partial version #v5.1 coerces to 5.1.0", () => {
    expect(parseEntry("pkg@git+https://github.com/owner/repo.git#v5.1")).toEqual({
      source: "git-github",
      name: "pkg",
      owner: "owner",
      repo: "repo",
      version: "5.1.0",
    });
  });

  test("github git URL with branch ref #main returns null", () => {
    expect(parseEntry("pkg@git+https://github.com/owner/repo.git#main")).toBeNull();
  });

  test("github git URL with short SHA ref returns null", () => {
    expect(parseEntry("pkg@git+https://github.com/owner/repo.git#abc1234")).toBeNull();
  });

  test("github git URL with date-based tag returns null", () => {
    expect(parseEntry("pkg@git+https://github.com/owner/repo.git#release-2024-05")).toBeNull();
  });

  test("non-github git URL returns null", () => {
    expect(parseEntry("pkg@git+https://gitlab.com/owner/repo.git#v1.0.0")).toBeNull();
  });

  test("SSH git URL returns null", () => {
    expect(parseEntry("pkg@git+ssh://github.com/owner/repo.git#v1.0.0")).toBeNull();
  });

  test("scoped git URL without ref returns null", () => {
    expect(parseEntry("@scope/pkg@git+https://github.com/example/repo.git")).toBeNull();
  });

  test("git URL with v-prefixed SHA-like ref returns null", () => {
    expect(parseEntry("pkg@git+https://github.com/owner/repo.git#vabc1234")).toBeNull();
  });

  test("git URL with bare v-prefix returns null", () => {
    expect(parseEntry("pkg@git+https://github.com/owner/repo.git#v")).toBeNull();
  });

  test("git URL with date-based v-prefixed tag returns null", () => {
    expect(parseEntry("pkg@git+https://github.com/owner/repo.git#v20230101")).toBeNull();
  });
});

describe("parseEntries", () => {
  test("separates parsed entries from dropped entries", () => {
    const result = parseEntries([
      "@scope/pkg@1.0.0",
      "unpinned-pkg",
      "my-tool@3.0.0",
      "./local-plugin",
    ]);
    expect(result.parsed).toEqual([
      { source: "npm", name: "@scope/pkg", version: "1.0.0" },
      { source: "npm", name: "my-tool", version: "3.0.0" },
    ]);
    expect(result.dropped).toEqual(["unpinned-pkg", "./local-plugin"]);
  });

  test("empty input", () => {
    const result = parseEntries([]);
    expect(result.parsed).toEqual([]);
    expect(result.dropped).toEqual([]);
  });

  test("includes git-github entries in parsed, not dropped", () => {
    const result = parseEntries([
      "my-tool@3.0.0",
      "superpowers@git+https://github.com/obra/superpowers.git#v5.1.0",
      "unpinned-pkg",
    ]);
    expect(result.parsed).toEqual([
      { source: "npm", name: "my-tool", version: "3.0.0" },
      {
        source: "git-github",
        name: "superpowers",
        owner: "obra",
        repo: "superpowers",
        version: "5.1.0",
      },
    ]);
    expect(result.dropped).toEqual(["unpinned-pkg"]);
  });
});
