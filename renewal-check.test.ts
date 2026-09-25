import { execFile } from 'node:child_process';
import { type Server, createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { seal } from '../src/lib/repofile.ts';
import { parseRepoFile } from '../src/lib/schema.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);

/** In-memory fake of the handful of GitHub endpoints the script uses. */
interface FakeIssue { number: number; title: string; body: string; state: 'open' | 'closed'; html_url: string; labels: string[] }
const issues: FakeIssue[] = [];
const comments: { issue: number; body: string }[] = [];
let labelExists = false;
let server: Server;
let api = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = new URL(req.url!, 'http://x');
      const body = raw ? JSON.parse(raw) : undefined;
      const send = (status: number, json?: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(json === undefined ? '' : JSON.stringify(json));
      };
      const p = url.pathname.replace('/repos/me/money', '');
      if (req.headers.authorization !== 'Bearer t0ken') return send(401, {});
      if (req.method === 'GET' && p === '/labels/renewal') return labelExists ? send(200, {}) : send(404, {});
      if (req.method === 'POST' && p === '/labels') { labelExists = true; return send(201, {}); }
      if (req.method === 'GET' && p === '/issues') {
        const page = Number(url.searchParams.get('page'));
        return send(200, page === 1 ? issues.filter((i) => i.labels.includes('renewal')) : []);
      }
      if (req.method === 'POST' && p === '/issues') {
        const n = issues.length + 1;
        const issue = { number: n, title: body.title, body: body.body, state: 'open' as const, html_url: `https://gh/${n}`, labels: body.labels };
        issues.push(issue);
        return send(201, issue);
      }
      const m = /^\/issues\/(\d+)(\/comments)?$/.exec(p);
      if (m) {
        const issue = issues.find((i) => i.number === Number(m[1]))!;
        if (m[2]) { comments.push({ issue: issue.number, body: body.body }); return send(201, {}); }
        Object.assign(issue, body);
        return send(200, issue);
      }
      send(404, { path: p });
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  api = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
afterAll(() => server.close());

const exec = (today: string, extra: Record<string, string> = {}) =>
  run('npx', ['tsx', 'scripts/renewal-check.ts'], {
    env: {
      ...process.env,
      GITHUB_API_URL: api,
      GITHUB_REPOSITORY: 'me/money',
      GITHUB_TOKEN: 't0ken',
      TALLY_DATA: 'data/subscriptions.example.json',
      TALLY_TODAY: today,
      GITHUB_STEP_SUMMARY: '',
      DRY_RUN: '',
      TALLY_PASSPHRASE: '',
      TALLY_REDACT: '',
      ...extra,
    },
  });

describe('renewal-check (against a fake GitHub API)', () => {
  it('opens one issue per due renewal, with a label', async () => {
    const { stdout } = await exec('2026-09-23');
    expect(stdout).toContain('opened #1');
    expect(issues.map((i) => i.title)).toEqual([
      'Renews tomorrow: Gym Membership ($45.00)',
      'Trial ends in 2 days: Language App ($12.99)',
    ]);
    expect(labelExists).toBe(true);
    expect(issues[0]!.body).toContain('<!-- tally:demo3:2026-09-24 -->');
  }, 30_000);

  it('is idempotent and respects issues you closed', async () => {
    issues[1]!.state = 'closed';
    const { stdout } = await exec('2026-09-23');
    expect(stdout).toContain('already open');
    expect(stdout).toContain('already closed');
    expect(issues).toHaveLength(2);
  }, 30_000);

  it('closes alerts once their date has passed', async () => {
    await exec('2026-09-26');
    const gym = issues.find((i) => i.title.includes('Gym'))!;
    expect(gym.state).toBe('closed');
    expect(comments.some((c) => c.issue === gym.number && c.body.includes('2026-09-24'))).toBe(true);
  }, 30_000);
});

describe('renewal-check with an encrypted file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tally-'));
  const path = join(dir, 'subscriptions.json');

  beforeAll(async () => {
    const plain = parseRepoFile(JSON.parse(readFileSync('data/subscriptions.example.json', 'utf8')));
    writeFileSync(path, JSON.stringify(await seal(plain, 'a strong passphrase', 1_000)));
  });

  it('fails with a clear message when the passphrase secret is missing', async () => {
    await expect(exec('2026-10-20', { TALLY_DATA: path })).rejects.toMatchObject({
      stderr: expect.stringContaining('TALLY_PASSPHRASE'),
    });
  }, 30_000);

  it('rejects the wrong passphrase', async () => {
    await expect(exec('2026-10-20', { TALLY_DATA: path, TALLY_PASSPHRASE: 'nope nope nope' })).rejects.toMatchObject({
      stderr: expect.stringContaining('Wrong passphrase'),
    });
  }, 30_000);

  it('decrypts and opens issues that do not reveal names', async () => {
    const before = issues.length;
    await exec('2026-10-20', { TALLY_DATA: path, TALLY_PASSPHRASE: 'a strong passphrase' });
    const created = issues.slice(before);
    expect(created.length).toBeGreaterThan(0);
    for (const i of created) {
      expect(i.title).toMatch(/^A (subscription renews|free trial ends)/);
      expect(i.body).not.toMatch(/Gym|Netflix|Copilot|\$/);
    }
  }, 30_000);
});
