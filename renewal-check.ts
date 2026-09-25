/**
 * Renewal alerts for GitHub Actions.
 *
 * Reads data/subscriptions.json (written by the app's "Commit to GitHub"
 * button), finds every subscription whose reminder window is open today, and
 * opens one GitHub issue per upcoming charge. GitHub then notifies you by
 * email/app, so no mail server or extra secrets are needed.
 *
 * - Idempotent: each issue carries a hidden key (subscription id + date), so
 *   re-runs never duplicate, and an issue you closed stays closed.
 * - Tidy: open alerts whose date has passed are closed automatically.
 * - Uses the exact same date and billing logic as the web app (src/lib).
 *
 * Env: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL (set by Actions), TALLY_DATA (path),
 *      TALLY_TODAY (YYYY-MM-DD override), DRY_RUN=1, TZ (your timezone),
 *      TALLY_PASSPHRASE (for encrypted files), TALLY_REDACT (0/1; defaults to
 *      1 for encrypted files so issue titles don't reveal what's inside).
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { isISODate, today as localToday } from '../src/lib/dates.ts';
import { alertIssue, subscriptionReport } from '../src/lib/report.ts';
import { DecryptError } from '../src/lib/crypto.ts';
import { PassphraseRequired, openRepoFile } from '../src/lib/repofile.ts';
import { dueForAlert } from '../src/lib/subscriptions.ts';

const LABEL = 'renewal';
const KEY_RE = /<!-- (tally:[^:\s]+:(\d{4}-\d{2}-\d{2})) -->/;

const env = process.env;
const dataPath = env.TALLY_DATA ?? 'data/subscriptions.json';
const on = env.TALLY_TODAY && isISODate(env.TALLY_TODAY) ? env.TALLY_TODAY : localToday();
const dryRun = env.DRY_RUN === '1' || env.DRY_RUN === 'true' || !env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY;

function summary(md: string) {
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, md + '\n');
}

interface Issue {
  number: number;
  state: 'open' | 'closed';
  body: string | null;
  html_url: string;
  pull_request?: unknown;
}

async function gh<T>(method: string, path: string, body?: unknown): Promise<T> {
  const api = env.GITHUB_API_URL ?? 'https://api.github.com';
  const res = await fetch(`${api}/repos/${env.GITHUB_REPOSITORY}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 410) throw new Error('Issues are disabled for this repository. Enable them in Settings → General → Features.');
    throw new Error(`GitHub ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

async function ensureLabel() {
  try {
    await gh('GET', `/labels/${LABEL}`);
  } catch {
    await gh('POST', '/labels', { name: LABEL, color: 'c23a2b', description: 'Upcoming subscription charge (Tally)' });
  }
}

async function existingAlerts(): Promise<Map<string, Issue>> {
  const map = new Map<string, Issue>();
  for (let page = 1; page <= 5; page++) {
    const issues = await gh<Issue[]>('GET', `/issues?labels=${LABEL}&state=all&per_page=100&page=${page}`);
    for (const i of issues) {
      const m = i.body && !i.pull_request ? KEY_RE.exec(i.body) : null;
      if (m) map.set(m[1]!, i);
    }
    if (issues.length < 100) break;
  }
  return map;
}

async function main() {
  if (!existsSync(dataPath)) {
    console.log(`No ${dataPath} yet. Commit it from the Tally app (Sync → Commit to GitHub). Nothing to do.`);
    summary(`### Renewal alerts\n\nNo \`${dataPath}\` in this repo yet. Commit it from the Tally app to turn alerts on.`);
    return;
  }

  let file;
  try {
    file = await openRepoFile(JSON.parse(readFileSync(dataPath, 'utf8')), env.TALLY_PASSPHRASE || undefined);
  } catch (e) {
    if (e instanceof PassphraseRequired) {
      throw new Error(`${dataPath} is encrypted. Add a repository secret named TALLY_PASSPHRASE with the same passphrase you use in the app.`);
    }
    if (e instanceof DecryptError) throw new Error(`Couldn't decrypt ${dataPath}: ${e.message} Check the TALLY_PASSPHRASE secret.`);
    throw e;
  }
  const redact = env.TALLY_REDACT ? env.TALLY_REDACT !== '0' : file.wasEncrypted;
  const issueFor = (u: (typeof due)[number]) => alertIssue(u, file.currency, { redact });
  const due = dueForAlert(file.subscriptions, on);
  console.log(`${on}: ${redact ? 'encrypted file' : `${file.subscriptions.length} subscriptions`}, ${due.length} inside their reminder window.`);

  // The job summary is visible to anyone who can read the repo's Actions logs.
  summary(redact ? `# Renewal check\n\nEncrypted file read successfully. ${due.length} alert(s) today.` : subscriptionReport(file.subscriptions, file.currency, on));
  const lines: string[] = [];

  if (dryRun) {
    console.log('Dry run (no token, or DRY_RUN set). Would open:');
    for (const u of due) console.log(`  • ${issueFor(u).title}`);
    summary(`### Alerts (dry run)\n\n${due.map((u) => `- ${issueFor(u).title}`).join('\n') || '_None today._'}`);
    return;
  }

  await ensureLabel();
  const existing = await existingAlerts();
  const wanted = new Set<string>();

  for (const u of due) {
    const issue = issueFor(u);
    wanted.add(issue.key);
    const found = existing.get(issue.key);
    if (found) {
      console.log(`  = already ${found.state}: ${issue.title}`);
      continue;
    }
    const created = await gh<Issue>('POST', '/issues', { title: issue.title, body: issue.body, labels: [LABEL] });
    console.log(`  + opened #${created.number}: ${issue.title}`);
    lines.push(`- Opened [#${created.number}](${created.html_url}): ${issue.title}`);
  }

  // Close open alerts whose charge date is now in the past.
  for (const [key, issue] of existing) {
    const date = KEY_RE.exec(issue.body ?? '')?.[2];
    if (issue.state !== 'open' || wanted.has(key) || !date || date >= on) continue;
    await gh('POST', `/issues/${issue.number}/comments`, { body: `The charge date (${date}) has passed, so this alert is closing automatically.` });
    await gh('PATCH', `/issues/${issue.number}`, { state: 'closed', state_reason: 'completed' });
    console.log(`  - closed #${issue.number} (date passed)`);
    lines.push(`- Closed #${issue.number} (date passed)`);
  }

  summary(`### Alerts\n\n${lines.join('\n') || '_No new alerts today._'}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
