import { describe, expect, it, vi } from 'vitest';
import { GitHubError, commitFile } from '../src/lib/github.ts';

const target = { owner: 'me', repo: 'money', branch: 'main', path: 'data/subscriptions.json' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('commitFile', () => {
  it('updates an existing file using its sha and UTF-8 safe base64', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(200, { sha: 'abc' }))
      .mockResolvedValueOnce(json(200, { commit: { html_url: 'https://github.com/c/1' } }));
    const url = await commitFile(target, 'tok', '{"name":"Café ☕"}', 'msg', fetchMock);
    expect(url).toBe('https://github.com/c/1');
    const [, init] = fetchMock.mock.calls[1]!;
    const sent = JSON.parse(init.body);
    expect(sent.sha).toBe('abc');
    expect(new TextDecoder().decode(Uint8Array.from(atob(sent.content), (c) => c.charCodeAt(0)))).toBe('{"name":"Café ☕"}');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('creates a new file when none exists', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(404, {})).mockResolvedValueOnce(json(201, {}));
    await commitFile(target, 'tok', 'x', 'msg', fetchMock);
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).sha).toBeUndefined();
  });

  it('explains permission errors in plain words', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(404, {})).mockResolvedValueOnce(json(403, {}));
    await expect(commitFile(target, 'tok', 'x', 'msg', fetchMock)).rejects.toThrow(GitHubError);
    await expect(commitFile(target, 'tok', 'x', 'msg', vi.fn().mockResolvedValue(json(401, {})))).rejects.toThrow(/token/);
  });
});

import { readFile } from '../src/lib/github.ts';

describe('readFile', () => {
  it('decodes UTF-8 content and returns null when missing', async () => {
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode('{"name":"Café"}')));
    const ok = vi.fn().mockResolvedValue(json(200, { content: b64.replace(/(.{10})/g, '$1\n'), encoding: 'base64' }));
    expect(await readFile(target, 'tok', ok)).toBe('{"name":"Café"}');
    expect(await readFile(target, 'tok', vi.fn().mockResolvedValue(json(404, {})))).toBeNull();
  });
});
