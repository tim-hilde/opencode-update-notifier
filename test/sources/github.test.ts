import { describe, expect, test } from "bun:test";
import { fetchLatestGithubTag } from "../../src/sources/github.ts";

type TagObject = { name: string };

/**
 * Helper: build a fetch that routes URLs to responses by substring match.
 * Order matters — first matching route wins.
 */
function routedFetch(
  routes: Array<{ match: string; status: number; body: unknown }>,
): typeof fetch {
  return async (url, _init) => {
    const u = url.toString();
    for (const r of routes) {
      if (u.includes(r.match)) {
        return new Response(JSON.stringify(r.body), {
          status: r.status,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    throw new Error(`unexpected URL in test: ${u}`);
  };
}

// Routes releases/latest -> 404 so we exercise the /tags fallback.
function tagsOnlyFetch(tags: TagObject[], status = 200): typeof fetch {
  return routedFetch([
    { match: "/releases/latest", status: 404, body: { message: "Not Found" } },
    { match: "/tags", status, body: tags },
  ]);
}

describe("fetchLatestGithubTag — releases/latest primary path", () => {
  test("returns version from releases/latest tag_name", async () => {
    const result = await fetchLatestGithubTag("obra", "superpowers", {
      fetch: routedFetch([
        { match: "/releases/latest", status: 200, body: { tag_name: "v5.2.0" } },
      ]),
      timeoutMs: 5000,
    });
    expect(result).toBe("5.2.0");
  });

  test("strips v prefix", async () => {
    const result = await fetchLatestGithubTag("o", "r", {
      fetch: routedFetch([
        { match: "/releases/latest", status: 200, body: { tag_name: "v1.2.3" } },
      ]),
      timeoutMs: 5000,
    });
    expect(result).toBe("1.2.3");
  });

  test("accepts tag_name without v prefix", async () => {
    const result = await fetchLatestGithubTag("o", "r", {
      fetch: routedFetch([{ match: "/releases/latest", status: 200, body: { tag_name: "1.2.3" } }]),
      timeoutMs: 5000,
    });
    expect(result).toBe("1.2.3");
  });

  test("does NOT call /tags when releases/latest succeeds", async () => {
    let tagsCalled = false;
    const trackingFetch: typeof fetch = async (url) => {
      const u = url.toString();
      if (u.includes("/releases/latest")) {
        return new Response(JSON.stringify({ tag_name: "v1.0.0" }), { status: 200 });
      }
      if (u.includes("/tags")) {
        tagsCalled = true;
      }
      return new Response("[]", { status: 200 });
    };
    await fetchLatestGithubTag("o", "r", { fetch: trackingFetch, timeoutMs: 5000 });
    expect(tagsCalled).toBe(false);
  });

  test("throws when releases/latest tag_name is missing", async () => {
    await expect(
      fetchLatestGithubTag("o", "r", {
        fetch: routedFetch([{ match: "/releases/latest", status: 200, body: {} }]),
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(/missing tag_name/);
  });

  test("throws when releases/latest tag_name is not semver", async () => {
    await expect(
      fetchLatestGithubTag("o", "r", {
        fetch: routedFetch([
          { match: "/releases/latest", status: 200, body: { tag_name: "release-2024-05" } },
        ]),
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(/not semver/);
  });

  test("throws (no fallback) on HTTP 403 from releases/latest", async () => {
    let tagsCalled = false;
    const trackingFetch: typeof fetch = async (url) => {
      const u = url.toString();
      if (u.includes("/releases/latest")) {
        return new Response("{}", { status: 403 });
      }
      if (u.includes("/tags")) tagsCalled = true;
      return new Response("[]", { status: 200 });
    };
    await expect(
      fetchLatestGithubTag("o", "r", { fetch: trackingFetch, timeoutMs: 5000 }),
    ).rejects.toThrow(/HTTP 403/);
    expect(tagsCalled).toBe(false);
  });

  test("throws (no fallback) on HTTP 500 from releases/latest", async () => {
    let tagsCalled = false;
    const trackingFetch: typeof fetch = async (url) => {
      const u = url.toString();
      if (u.includes("/releases/latest")) return new Response("{}", { status: 500 });
      if (u.includes("/tags")) tagsCalled = true;
      return new Response("[]", { status: 200 });
    };
    await expect(
      fetchLatestGithubTag("o", "r", { fetch: trackingFetch, timeoutMs: 5000 }),
    ).rejects.toThrow(/HTTP 500/);
    expect(tagsCalled).toBe(false);
  });
});

describe("fetchLatestGithubTag — /tags fallback path (releases 404)", () => {
  test("falls back to /tags on 404 from releases/latest", async () => {
    const result = await fetchLatestGithubTag("o", "r", {
      fetch: tagsOnlyFetch([{ name: "v1.0.0" }]),
      timeoutMs: 5000,
    });
    expect(result).toBe("1.0.0");
  });

  test("calls correct /tags URL with per_page=100", async () => {
    let capturedTagsUrl = "";
    const capturingFetch: typeof fetch = async (url) => {
      const u = url.toString();
      if (u.includes("/releases/latest")) return new Response("{}", { status: 404 });
      capturedTagsUrl = u;
      return new Response(JSON.stringify([{ name: "v1.0.0" }]), { status: 200 });
    };
    await fetchLatestGithubTag("obra", "superpowers", {
      fetch: capturingFetch,
      timeoutMs: 5000,
    });
    expect(capturedTagsUrl).toBe("https://api.github.com/repos/obra/superpowers/tags?per_page=100");
  });

  test("sends GitHub headers on both requests", async () => {
    const capturedHeaders: Record<string, string>[] = [];
    const capturingFetch: typeof fetch = async (url, init) => {
      capturedHeaders.push((init?.headers as Record<string, string>) ?? {});
      const u = url.toString();
      if (u.includes("/releases/latest")) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify([{ name: "v1.0.0" }]), { status: 200 });
    };
    await fetchLatestGithubTag("o", "r", { fetch: capturingFetch, timeoutMs: 5000 });
    expect(capturedHeaders).toHaveLength(2);
    for (const headers of capturedHeaders) {
      expect(headers.Accept).toBe("application/vnd.github+json");
      expect(headers["User-Agent"]).toBe("opencode-update-notifier");
      expect(headers.Authorization).toBeUndefined();
    }
  });

  test("returns highest semver tag", async () => {
    const result = await fetchLatestGithubTag("o", "r", {
      fetch: tagsOnlyFetch([{ name: "v1.2.0" }, { name: "v1.10.0" }, { name: "v1.5.0" }]),
      timeoutMs: 5000,
    });
    expect(result).toBe("1.10.0");
  });

  test("filters non-semver tags", async () => {
    const result = await fetchLatestGithubTag("o", "r", {
      fetch: tagsOnlyFetch([
        { name: "v1.0.0" },
        { name: "random-tag" },
        { name: "latest" },
        { name: "v2.0.0" },
        { name: "20240514" },
      ]),
      timeoutMs: 5000,
    });
    expect(result).toBe("2.0.0");
  });

  test("strips v prefix from returned version", async () => {
    const result = await fetchLatestGithubTag("o", "r", {
      fetch: tagsOnlyFetch([{ name: "v3.0.0" }]),
      timeoutMs: 5000,
    });
    expect(result).toBe("3.0.0");
  });

  test("throws on HTTP 403 from /tags after releases 404", async () => {
    await expect(
      fetchLatestGithubTag("o", "r", {
        fetch: tagsOnlyFetch([], 403),
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(/tags HTTP 403/);
  });

  test("throws on empty tags array", async () => {
    await expect(
      fetchLatestGithubTag("o", "r", {
        fetch: tagsOnlyFetch([]),
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(/no valid semver tags/);
  });

  test("non-array /tags response body throws", async () => {
    const mockFetch: typeof fetch = async (url) => {
      const u = url.toString();
      if (u.includes("/releases/latest")) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify({ message: "not an array" }), { status: 200 });
    };
    await expect(
      fetchLatestGithubTag("o", "r", { fetch: mockFetch, timeoutMs: 1000 }),
    ).rejects.toThrow(/not an array/);
  });

  test("CalVer tags are not treated as valid semver", async () => {
    await expect(
      fetchLatestGithubTag("o", "r", {
        fetch: tagsOnlyFetch([{ name: "20240514" }, { name: "release-2024-05" }]),
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(/no valid semver tags/);
  });

  test("throws when all tags are non-semver", async () => {
    await expect(
      fetchLatestGithubTag("o", "r", {
        fetch: tagsOnlyFetch([{ name: "latest" }, { name: "stable" }]),
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(/no valid semver tags/);
  });
});

describe("fetchLatestGithubTag — AbortSignal wiring", () => {
  test("passes a signal originating from AbortSignal.timeout to fetch", async () => {
    // Capture AbortSignal.timeout's output and assert the SAME signal reaches fetch.
    const originalTimeout = AbortSignal.timeout;
    const producedSignals: AbortSignal[] = [];
    AbortSignal.timeout = ((ms: number) => {
      const s = originalTimeout.call(AbortSignal, ms);
      producedSignals.push(s);
      return s;
    }) as typeof AbortSignal.timeout;

    try {
      const capturedSignals: (AbortSignal | undefined)[] = [];
      const capturingFetch: typeof fetch = async (_url, init) => {
        capturedSignals.push(init?.signal as AbortSignal | undefined);
        return new Response(JSON.stringify({ tag_name: "v1.0.0" }), { status: 200 });
      };
      await fetchLatestGithubTag("o", "r", { fetch: capturingFetch, timeoutMs: 1234 });

      expect(producedSignals).toHaveLength(1); // only releases/latest was hit
      expect(capturedSignals).toHaveLength(1);
      expect(capturedSignals[0]).toBe(producedSignals[0]);
    } finally {
      AbortSignal.timeout = originalTimeout;
    }
  });

  test("each request gets its own fresh timeout signal", async () => {
    const originalTimeout = AbortSignal.timeout;
    const producedSignals: AbortSignal[] = [];
    AbortSignal.timeout = ((ms: number) => {
      const s = originalTimeout.call(AbortSignal, ms);
      producedSignals.push(s);
      return s;
    }) as typeof AbortSignal.timeout;

    try {
      const capturedSignals: (AbortSignal | undefined)[] = [];
      const capturingFetch: typeof fetch = async (url, init) => {
        capturedSignals.push(init?.signal as AbortSignal | undefined);
        const u = url.toString();
        if (u.includes("/releases/latest")) return new Response("{}", { status: 404 });
        return new Response(JSON.stringify([{ name: "v1.0.0" }]), { status: 200 });
      };
      await fetchLatestGithubTag("o", "r", { fetch: capturingFetch, timeoutMs: 1234 });

      expect(producedSignals).toHaveLength(2);
      expect(capturedSignals).toHaveLength(2);
      expect(capturedSignals[0]).toBe(producedSignals[0]);
      expect(capturedSignals[1]).toBe(producedSignals[1]);
      expect(capturedSignals[0]).not.toBe(capturedSignals[1]);
    } finally {
      AbortSignal.timeout = originalTimeout;
    }
  });
});
