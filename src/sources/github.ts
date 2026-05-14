import semver from "semver";

const GITHUB_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "opencode-update-notifier",
};

function stripV(tag: string): string {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

/**
 * Fetches the latest semver tag for a GitHub repo.
 *
 * Strategy:
 *   1. Try `/releases/latest` — returns the single "latest" release as
 *      determined by GitHub (newest non-draft, non-prerelease). One request,
 *      no client-side filtering. Most plugin repos publish releases.
 *   2. On HTTP 404 (repo has no releases — common for tag-only repos),
 *      fall back to `/tags?per_page=100` and pick the highest semver tag.
 *
 * Any other non-2xx (403 rate limit, 5xx, etc.) throws immediately rather
 * than burning the rate-limit budget on a fallback that is likely to share
 * the same fate.
 *
 * Known limitation: the `/tags` fallback only inspects the first 100 tags
 * (newest-first by creation). Repos with >100 non-semver tags ahead of any
 * real version tag will return "no valid semver tags found".
 */
export async function fetchLatestGithubTag(
  owner: string,
  repo: string,
  opts: { fetch: typeof globalThis.fetch; timeoutMs: number },
): Promise<string> {
  const releasesUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  const releasesRes = await opts.fetch(releasesUrl, {
    signal: AbortSignal.timeout(opts.timeoutMs),
    headers: GITHUB_HEADERS,
  });

  if (releasesRes.ok) {
    const body = (await releasesRes.json()) as { tag_name?: unknown };
    if (typeof body.tag_name !== "string") {
      throw new Error(
        `fetchLatestGithubTag(${owner}/${repo}): releases/latest response missing tag_name`,
      );
    }
    const stripped = stripV(body.tag_name);
    if (!semver.valid(stripped)) {
      throw new Error(
        `fetchLatestGithubTag(${owner}/${repo}): releases/latest tag_name "${body.tag_name}" is not semver`,
      );
    }
    return stripped;
  }

  if (releasesRes.status !== 404) {
    throw new Error(
      `fetchLatestGithubTag(${owner}/${repo}): releases/latest HTTP ${releasesRes.status}`,
    );
  }

  // 404 -> fall back to /tags (repo has no GitHub releases)
  const tagsUrl = `https://api.github.com/repos/${owner}/${repo}/tags?per_page=100`;
  const tagsRes = await opts.fetch(tagsUrl, {
    signal: AbortSignal.timeout(opts.timeoutMs),
    headers: GITHUB_HEADERS,
  });

  if (!tagsRes.ok) {
    throw new Error(`fetchLatestGithubTag(${owner}/${repo}): tags HTTP ${tagsRes.status}`);
  }

  const body = (await tagsRes.json()) as unknown;
  if (!Array.isArray(body)) {
    throw new Error(`fetchLatestGithubTag(${owner}/${repo}): tags response is not an array`);
  }

  const versions = (body as { name: string }[]).flatMap((tag) => {
    const stripped = stripV(tag.name);
    const parsed = semver.valid(stripped) ? semver.parse(stripped) : null;
    return parsed ? [parsed] : [];
  });

  if (versions.length === 0) {
    throw new Error(`fetchLatestGithubTag(${owner}/${repo}): no valid semver tags found`);
  }

  versions.sort(semver.rcompare);
  return (versions[0] as semver.SemVer).version;
}
