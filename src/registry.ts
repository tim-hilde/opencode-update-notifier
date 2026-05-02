export async function fetchLatest(
  name: string,
  opts: { fetch: typeof globalThis.fetch; timeoutMs: number },
): Promise<string> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`;
  const signal = AbortSignal.timeout(opts.timeoutMs);
  const res = await opts.fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`fetchLatest(${name}): HTTP ${res.status}`);
  }
  const body = (await res.json()) as { version?: unknown };
  if (typeof body.version !== "string") {
    throw new Error(`fetchLatest(${name}): unexpected response shape`);
  }
  return body.version;
}
