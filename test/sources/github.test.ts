import { describe, expect, test } from "bun:test";
import { fetchLatestGithubTag } from "../../src/sources/github.ts";

type TagObject = { name: string };

function makeFetch(status: number, body: unknown): typeof fetch {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
}

describe("fetchLatestGithubTag", () => {
  test("calls correct URL", async () => {
    let capturedUrl = "";
    const capturingFetch: typeof fetch = async (url, _init) => {
      capturedUrl = url.toString();
      return new Response(JSON.stringify([{ name: "v1.0.0" }]), { status: 200 });
    };
    await fetchLatestGithubTag("obra", "superpowers", { fetch: capturingFetch, timeoutMs: 5000 });
    expect(capturedUrl).toBe("https://api.github.com/repos/obra/superpowers/tags?per_page=100");
  });

  test("sends correct headers", async () => {
    let capturedHeaders: Record<string, string> = {};
    const capturingFetch: typeof fetch = async (_url, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      capturedHeaders = headers ?? {};
      return new Response(JSON.stringify([{ name: "v1.0.0" }]), { status: 200 });
    };
    await fetchLatestGithubTag("obra", "superpowers", { fetch: capturingFetch, timeoutMs: 5000 });
    expect(capturedHeaders.Accept).toBe("application/vnd.github+json");
    expect(capturedHeaders["User-Agent"]).toBe("opencode-update-notifier");
    expect(capturedHeaders.Authorization).toBeUndefined();
  });

  test("returns highest semver tag", async () => {
    const tags: TagObject[] = [{ name: "v1.2.0" }, { name: "v1.10.0" }, { name: "v1.5.0" }];
    const result = await fetchLatestGithubTag("owner", "repo", {
      fetch: makeFetch(200, tags),
      timeoutMs: 5000,
    });
    expect(result).toBe("1.10.0");
  });

  test("filters non-semver tags", async () => {
    const tags: TagObject[] = [
      { name: "v1.0.0" },
      { name: "random-tag" },
      { name: "latest" },
      { name: "v2.0.0" },
      { name: "20240514" },
    ];
    const result = await fetchLatestGithubTag("owner", "repo", {
      fetch: makeFetch(200, tags),
      timeoutMs: 5000,
    });
    expect(result).toBe("2.0.0");
  });

  test("strips v prefix from returned version", async () => {
    const tags: TagObject[] = [{ name: "v3.0.0" }];
    const result = await fetchLatestGithubTag("owner", "repo", {
      fetch: makeFetch(200, tags),
      timeoutMs: 5000,
    });
    expect(result).toBe("3.0.0");
  });

  test("throws on HTTP 403", async () => {
    await expect(
      fetchLatestGithubTag("owner", "repo", { fetch: makeFetch(403, {}), timeoutMs: 5000 }),
    ).rejects.toThrow();
  });

  test("throws on HTTP 404", async () => {
    await expect(
      fetchLatestGithubTag("owner", "repo", { fetch: makeFetch(404, {}), timeoutMs: 5000 }),
    ).rejects.toThrow();
  });

  test("throws on empty tags array", async () => {
    await expect(
      fetchLatestGithubTag("owner", "repo", { fetch: makeFetch(200, []), timeoutMs: 5000 }),
    ).rejects.toThrow();
  });

  test("non-array response body throws", async () => {
    const mockFetch = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ message: "not an array" }),
      } as unknown as Response);

    await expect(
      fetchLatestGithubTag("owner", "repo", { fetch: mockFetch, timeoutMs: 1000 }),
    ).rejects.toThrow();
  });

  test("CalVer tags are not treated as valid semver", async () => {
    const tags: TagObject[] = [{ name: "20240514" }, { name: "release-2024-05" }];
    await expect(
      fetchLatestGithubTag("owner", "repo", { fetch: makeFetch(200, tags), timeoutMs: 5000 }),
    ).rejects.toThrow();
  });

  test("throws when all tags are non-semver", async () => {
    const tags: TagObject[] = [{ name: "latest" }, { name: "stable" }];
    await expect(
      fetchLatestGithubTag("owner", "repo", { fetch: makeFetch(200, tags), timeoutMs: 5000 }),
    ).rejects.toThrow();
  });

  test("passes AbortSignal.timeout as signal to fetch", async () => {
    let capturedSignal: AbortSignal | null | undefined = undefined;
    const capturingFetch: typeof fetch = async (_url, init) => {
      capturedSignal = init?.signal;
      return new Response(JSON.stringify([{ name: "v1.0.0" }]), { status: 200 });
    };
    await fetchLatestGithubTag("owner", "repo", { fetch: capturingFetch, timeoutMs: 1234 });
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal).not.toBeNull();
    // AbortSignal.timeout creates a signal with abortReason set to a TimeoutError when it fires;
    // we can't easily verify the timeout value, but we can verify a signal was passed.
    expect(capturedSignal instanceof AbortSignal).toBe(true);
  });
});
