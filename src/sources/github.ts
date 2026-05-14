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

  const versions = (body as { name: string }[]).flatMap((tag) => {
    const stripped = tag.name.startsWith("v") ? tag.name.slice(1) : tag.name;
    const parsed = semver.valid(stripped) ? semver.parse(stripped) : null;
    return parsed ? [parsed] : [];
  });

  if (versions.length === 0) {
    throw new Error(`fetchLatestGithubTag(${owner}/${repo}): no valid semver tags found`);
  }

  versions.sort(semver.rcompare);
  return (versions[0] as semver.SemVer).version;
}
