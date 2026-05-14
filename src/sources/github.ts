import semver from "semver";

export async function fetchLatestGithubTag(
  owner: string,
  repo: string,
  opts: { fetch: typeof globalThis.fetch; timeoutMs: number },
): Promise<string> {
  const url = `https://api.github.com/repos/${owner}/${repo}/tags?per_page=100`;
  const signal = AbortSignal.timeout(opts.timeoutMs);
  const res = await opts.fetch(url, {
    signal,
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "opencode-update-notifier",
    },
  });

  if (!res.ok) {
    throw new Error(`fetchLatestGithubTag(${owner}/${repo}): HTTP ${res.status}`);
  }

  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) {
    throw new Error(`fetchLatestGithubTag(${owner}/${repo}): response is not an array`);
  }

  const versions = (body as { name: string }[])
    .map((tag) => semver.coerce(tag.name))
    .filter((v): v is semver.SemVer => v !== null);

  if (versions.length === 0) {
    throw new Error(`fetchLatestGithubTag(${owner}/${repo}): no valid semver tags found`);
  }

  versions.sort(semver.rcompare);
  // Safe: versions.length === 0 is guarded above
  return (versions[0] as semver.SemVer).version;
}
