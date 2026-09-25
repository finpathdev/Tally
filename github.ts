/** Minimal GitHub Contents API client used by the in-app "Commit to GitHub" button. */

export interface CommitTarget {
  owner: string;
  repo: string;
  branch: string;
  path: string;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const encPath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

function explain(status: number, fallback: string): string {
  switch (status) {
    case 401:
      return 'GitHub rejected the token. Check it hasn’t expired.';
    case 403:
      return 'The token can’t write to this repo. Give it “Contents: Read and write” access.';
    case 404:
      return 'Repo or branch not found. Check the owner, repo name and branch, and that the token can see the repo.';
    case 409:
    case 422:
      return 'The file changed on GitHub since it was read. Try again.';
    default:
      return fallback;
  }
}

function fromBase64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

const headersFor = (token: string) => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
});

const contentsUrl = (t: CommitTarget) =>
  `https://api.github.com/repos/${encodeURIComponent(t.owner)}/${encodeURIComponent(t.repo)}/contents/${encPath(t.path)}`;

/** Read a text file from the repo. Returns null if it doesn't exist yet. */
export async function readFile(target: CommitTarget, token: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const res = await fetchImpl(`${contentsUrl(target)}?ref=${encodeURIComponent(target.branch)}`, { headers: headersFor(token) });
  if (res.status === 404) return null;
  if (!res.ok) throw new GitHubError(explain(res.status, `GitHub returned ${res.status}`), res.status);
  const json = (await res.json()) as { content?: string; encoding?: string };
  if (json.encoding !== 'base64' || typeof json.content !== 'string') {
    throw new GitHubError('That file is too large to read through the API.', 413);
  }
  return fromBase64(json.content);
}

/** Create or update a file in one commit. Returns the commit URL. */
export async function commitFile(
  target: CommitTarget,
  token: string,
  content: string,
  message: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const base = contentsUrl(target);
  const headers = headersFor(token);

  let sha: string | undefined;
  const existing = await fetchImpl(`${base}?ref=${encodeURIComponent(target.branch)}`, { headers });
  if (existing.ok) {
    sha = ((await existing.json()) as { sha?: string }).sha;
  } else if (existing.status !== 404) {
    throw new GitHubError(explain(existing.status, `GitHub returned ${existing.status}`), existing.status);
  }

  const res = await fetchImpl(base, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: toBase64(content), branch: target.branch, ...(sha ? { sha } : {}) }),
  });
  if (!res.ok) throw new GitHubError(explain(res.status, `GitHub returned ${res.status}`), res.status);
  const json = (await res.json()) as { commit?: { html_url?: string } };
  return json.commit?.html_url ?? `https://github.com/${target.owner}/${target.repo}`;
}
