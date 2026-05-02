import { describe, expect, test } from "bun:test";
import { parseEntries, parseEntry } from "../src/parse.ts";

describe("parseEntry", () => {
  test("scoped + pinned", () => {
    expect(parseEntry("@scope/pkg@1.2.3")).toEqual({ name: "@scope/pkg", version: "1.2.3" });
  });

  test("unscoped + pinned", () => {
    expect(parseEntry("my-pkg@2.0.0")).toEqual({ name: "my-pkg", version: "2.0.0" });
  });

  test("pre-release version", () => {
    expect(parseEntry("my-pkg@1.0.0-beta.1")).toEqual({
      name: "my-pkg",
      version: "1.0.0-beta.1",
    });
  });

  test("scoped pre-release version", () => {
    expect(parseEntry("@scope/pkg@1.0.0-alpha.2")).toEqual({
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

  test("git URL version returns null", () => {
    expect(parseEntry("superpowers@git+https://github.com/obra/superpowers.git#v5.0.7")).toBeNull();
  });

  test("scoped git URL version returns null", () => {
    expect(parseEntry("@scope/pkg@git+https://github.com/example/repo.git")).toBeNull();
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
      { name: "@scope/pkg", version: "1.0.0" },
      { name: "my-tool", version: "3.0.0" },
    ]);
    expect(result.dropped).toEqual(["unpinned-pkg", "./local-plugin"]);
  });

  test("empty input", () => {
    const result = parseEntries([]);
    expect(result.parsed).toEqual([]);
    expect(result.dropped).toEqual([]);
  });
});
