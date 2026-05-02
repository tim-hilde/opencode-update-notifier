import { describe, expect, test } from "bun:test";
import { fetchLatest } from "../src/registry.ts";

function makeFetch(status: number, body: unknown): typeof fetch {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
}

describe("fetchLatest", () => {
  test("returns version field on success", async () => {
    const fakeFetch = makeFetch(200, { version: "1.5.0" });
    const result = await fetchLatest("my-pkg", { fetch: fakeFetch, timeoutMs: 5000 });
    expect(result).toBe("1.5.0");
  });

  test("returns version for scoped package", async () => {
    const fakeFetch = makeFetch(200, { version: "2.0.0" });
    const result = await fetchLatest("@scope/my-pkg", { fetch: fakeFetch, timeoutMs: 5000 });
    expect(result).toBe("2.0.0");
  });

  test("throws on non-2xx response, error includes package name", async () => {
    const fakeFetch = makeFetch(404, { error: "not found" });
    await expect(fetchLatest("missing-pkg", { fetch: fakeFetch, timeoutMs: 5000 })).rejects.toThrow(
      "missing-pkg",
    );
  });

  test("throws on 500 response, error includes package name", async () => {
    const fakeFetch = makeFetch(500, {});
    await expect(
      fetchLatest("@scope/bad-pkg", { fetch: fakeFetch, timeoutMs: 5000 }),
    ).rejects.toThrow("@scope/bad-pkg");
  });

  test("request URL encodes the package name", async () => {
    let capturedUrl = "";
    const capturingFetch: typeof fetch = async (url) => {
      capturedUrl = url.toString();
      return new Response(JSON.stringify({ version: "1.0.0" }), { status: 200 });
    };
    await fetchLatest("@scope/pkg", { fetch: capturingFetch, timeoutMs: 5000 });
    expect(capturedUrl).toBe("https://registry.npmjs.org/%40scope%2Fpkg/latest");
  });
});
