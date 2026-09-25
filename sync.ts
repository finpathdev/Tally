import { commitFile, GitHubError, readFile } from '../lib/github.ts';
import { parseMoney, toInputValue } from '../lib/money.ts';
import { alertIssue, subscriptionReport } from '../lib/report.ts';
import { DecryptError } from '../lib/crypto.ts';
import { PassphraseRequired, openRepoFile, seal } from '../lib/repofile.ts';
import { type AppState, SchemaError, demoState, emptyState, migrate, toRepoFile } from '../lib/schema.ts';
import { dueForAlert } from '../lib/subscriptions.ts';
import { store } from '../store.ts';
import { button, confirmDialog, copyText, download, field, h, icon, toast } from '../ui/dom.ts';
import type { ViewContext } from './context.ts';
import { CURRENCIES } from './split.ts';
import { installCard } from '../ui/install.ts';
import { helpTip } from './help.ts';
import { disableReminders, enableReminders, permissionState, reminderSupport, remindersOn, testReminder } from '../ui/reminders.ts';

/** Token lives in memory by default; sessionStorage only if the user opts in. */
let token = '';
try {
  token = sessionStorage.getItem('tally:gh-token') ?? '';
} catch {
  /* storage blocked */
}
let busy: 'commit' | 'pull' | null = null;
/** Encryption passphrase: memory only, like the token. */
let passphrase = '';

/** The file to commit or download: plain, or sealed with the passphrase. */
async function repoFileText(state: AppState): Promise<string> {
  const file = toRepoFile(state);
  const body = state.sync.encrypt ? await seal(file, passphrase) : file;
  return JSON.stringify(body, null, 2) + '\n';
}

function needPassphrase(state: AppState): string | null {
  if (!state.sync.encrypt) return null;
  if (passphrase.length < 8) return 'Enter an encryption passphrase of at least 8 characters.';
  return null;
}
let remember = !!token;

const TEMPLATE_URL: string | undefined = import.meta.env.VITE_REPO_URL;

export function syncView(ctx: ViewContext): HTMLElement {
  const { state, today } = ctx;
  const due = dueForAlert(state.subscriptions, today);
  const cfg = state.sync;
  const isReady = () => { const c = store.state.sync; return Boolean(c.owner && c.repo && c.branch && c.path); };

  const saveCfg = (key: 'owner' | 'repo' | 'branch' | 'path') => (e: Event) => {
    const v = (e.target as HTMLInputElement).value.trim();
    store.patch((d) => { d.sync[key] = v; });
  };

  return h(
    'section',
    { class: 'view', 'aria-labelledby': 'sync-title' },
    h(
      'div',
      { class: 'toolbar' },
      h('h2', { id: 'sync-title', class: 'section-title' }, 'Sync & alerts'),
      h('p', { class: 'muted' }, 'Keep your subscriptions in a GitHub repo and get an issue, and an email, before anything renews.'),
    ),
    installCard(),
    h(
      'ol',
      { class: 'steps' },
      h(
        'li',
        { class: 'card step' },
        h('h3', null, 'Make your own private copy'),
        h('p', null, 'Create a repo from this project with ', h('strong', null, 'Use this template'), '. Make it ', h('strong', null, 'private'), ': it will hold your subscription list.'),
        TEMPLATE_URL
          ? h('a', { class: 'btn btn-ghost', href: `${TEMPLATE_URL}/generate`, target: '_blank', rel: 'noopener' }, icon('git-branch', 17), h('span', null, 'Use this template'))
          : null,
        h('p', { class: 'hint' }, 'Then enable Actions and turn on Issues in the repo settings. The renewal workflow is already included.'),
      ),
      h(
        'li',
        { class: 'card step' },
        h('h3', null, 'Send your subscriptions to it'),
        h('div', { class: 'grid-form cols-4' },
          field('Owner', h('input', { value: cfg.owner, placeholder: 'your-username', onInput: saveCfg('owner'), dataset: { key: 'gh-owner' }, autocomplete: 'off' })),
          field('Repository', h('input', { value: cfg.repo, placeholder: 'my-tally', onInput: saveCfg('repo'), dataset: { key: 'gh-repo' }, autocomplete: 'off' })),
          field('Branch', h('input', { value: cfg.branch, onInput: saveCfg('branch'), dataset: { key: 'gh-branch' } })),
          field('File', h('input', { value: cfg.path, onInput: saveCfg('path'), dataset: { key: 'gh-path' } })),
        ),
        field(
          'Fine-grained access token',
          h('input', {
            type: 'password',
            value: token,
            placeholder: 'github_pat_…',
            autocomplete: 'off',
            dataset: { key: 'gh-token' },
            onInput: (e: Event) => {
              token = (e.target as HTMLInputElement).value.trim();
              if (remember) {
                try { sessionStorage.setItem('tally:gh-token', token); } catch { /* blocked */ }
              }
            },
          }),
          'Scope it to this one repo with “Contents: Read and write”. It’s kept in memory only and sent only to api.github.com.',
        ),
        h('p', { class: 'hint' }, 'New to GitHub tokens? ', helpTip('fine-grained-token'), ' ', h('a', { href: '#/help/sync-setup' }, 'Step-by-step guide')),
        h(
          'label',
          { class: 'check' },
          h('input', {
            type: 'checkbox',
            checked: remember,
            onChange: (e: Event) => {
              remember = (e.target as HTMLInputElement).checked;
              try {
                if (remember) sessionStorage.setItem('tally:gh-token', token);
                else sessionStorage.removeItem('tally:gh-token');
              } catch {
                toast('This browser blocks session storage.');
              }
            },
          }),
          'Remember the token until this tab closes',
        ),
        h(
          'div',
          { class: 'encrypt-box' },
          h('div', { class: 'check-row' },
          h('label', { class: 'check' },
            h('input', {
              type: 'checkbox', checked: cfg.encrypt, dataset: { key: 'gh-encrypt' },
              onChange: (e: Event) => store.update(null, (d) => { d.sync.encrypt = (e.target as HTMLInputElement).checked; }),
            }),
            icon('shield', 16), h('strong', null, 'Encrypt the file with a passphrase'),
          ),
            helpTip('passphrase'),
          ),
          cfg.encrypt
            ? h('div', { class: 'grid-form' },
                field('Passphrase', h('input', {
                  type: 'password', value: passphrase, autocomplete: 'new-password', minLength: 8,
                  placeholder: 'At least 8 characters; a few random words is best',
                  dataset: { key: 'gh-pass' },
                  onInput: (e: Event) => { passphrase = (e.target as HTMLInputElement).value; },
                }), 'Only encrypted data is stored in the repo (AES-256-GCM). Tally never saves this passphrase, and nobody can recover it for you, so keep it in your password manager.'),
                h('p', { class: 'hint' }, 'For alerts, add the same passphrase as a repository secret named ', h('code', null, 'TALLY_PASSPHRASE'), ' (Settings → Secrets and variables → Actions). Alert issues then say when something renews, not what.'),
              )
            : h('p', { class: 'hint' }, 'Recommended even for private repos: anyone with access to the repo, or to a leaked token, sees only scrambled data.'),
        ),
        h(
          'div',
          { class: 'row wrap' },
          button(busy === 'commit' ? (store.state.sync.encrypt ? 'Encrypting…' : 'Committing…') : 'Commit to GitHub', async () => {
            if (busy) return;
            if (!isReady()) return toast('Fill in owner, repository, branch and file first.');
            if (!token) return toast('Paste a fine-grained access token first.');
            const passErr = needPassphrase(store.state);
            if (passErr) return toast(passErr);
            busy = 'commit';
            ctx.rerender();
            try {
              const text = await repoFileText(store.state);
              const url = await commitFile(store.state.sync, token, text, store.state.sync.encrypt ? 'Update subscriptions (encrypted)' : `Update subscriptions (${state.subscriptions.length})`);
              toast('Committed to GitHub', { label: 'View commit', run: () => window.open(url, '_blank', 'noopener') }, 8000);
            } catch (e) {
              toast(e instanceof GitHubError ? e.message : 'Couldn’t reach GitHub. Check your connection.', undefined, 8000);
            } finally {
              busy = null;
              ctx.rerender();
            }
          }, { variant: 'primary', icon: 'cloud-upload', key: 'gh-commit' }),
          button(busy === 'pull' ? 'Pulling…' : 'Pull from GitHub', async () => {
            if (busy) return;
            if (!isReady()) return toast('Fill in owner, repository, branch and file first.');
            if (!token) return toast('Paste a fine-grained access token first.');
            busy = 'pull';
            ctx.rerender();
            try {
              const text = await readFile(store.state.sync, token);
              if (text === null) return toast(`There’s no ${store.state.sync.path} in ${store.state.sync.repo} yet. Commit first.`);
              const file = await openRepoFile(JSON.parse(text), passphrase || undefined);
              if (file.wasEncrypted !== store.state.sync.encrypt) store.update(null, (d) => { d.sync.encrypt = file.wasEncrypted; });
              const ok = await confirmDialog(
                'Replace subscriptions with the repo’s copy?',
                `The repo has ${file.subscriptions.length} subscriptions (updated ${file.updated ? new Date(file.updated).toLocaleString() : 'at an unknown time'}). This device has ${store.state.subscriptions.length}. Shared expenses and your cart aren’t touched. You can undo right after.`,
                'Replace subscriptions',
              );
              if (!ok) return;
              store.update('Pull from GitHub', (d) => { d.subscriptions = file.subscriptions; });
              toast(`Pulled ${file.subscriptions.length} subscriptions from GitHub`, { label: 'Undo', run: () => store.undo() });
            } catch (e) {
              if (e instanceof PassphraseRequired) {
                store.update(null, (d) => { d.sync.encrypt = true; });
                toast('The repo file is encrypted. Enter the passphrase, then pull again.', undefined, 8000);
                return;
              }
              toast(
                e instanceof GitHubError || e instanceof DecryptError ? e.message
                  : e instanceof SchemaError ? `The repo file isn’t valid: ${e.message}`
                  : 'Couldn’t reach GitHub. Check your connection.',
                undefined, 8000,
              );
            } finally {
              busy = null;
              ctx.rerender();
            }
          }, { icon: 'refresh-cw', key: 'gh-pull', title: 'Use this on a second device to load the subscriptions you committed' }),
          button('Download file instead', async () => {
            const passErr = needPassphrase(store.state);
            if (passErr) return toast(passErr);
            download('subscriptions.json', await repoFileText(store.state));
          }, { icon: 'download' }),
        ),
      ),
      h(
        'li',
        { class: 'card step' },
        h('h3', null, 'Get alerts'),
        h('p', null, 'Every morning the ', h('code', null, 'Renewal alerts'), ' workflow reads the file and opens one issue per upcoming charge, using each subscription’s reminder setting. GitHub emails you about new issues, so no email service or secrets are needed. Close the issue when you’ve decided.'),
        h('p', { class: 'eyebrow' }, due.length ? `If it ran today, it would open ${due.length} ${due.length === 1 ? 'issue' : 'issues'}` : 'If it ran today'),
        due.length
          ? h('ul', { class: 'issue-preview' }, due.map((u) => h('li', null, icon('circle-check', 15), alertIssue(u, state.settings.currency).title)))
          : h('p', { class: 'hint' }, 'Nothing is inside its reminder window today.'),
      ),
    ),
    h(
      'div',
      { class: 'split-grid' },
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('h3', null, 'Backup & reports')),
        h('p', { class: 'hint' }, 'Everything is saved in this browser. Download a backup to move it to another device. Backups from the original FinHub app import too.'),
        h(
          'div',
          { class: 'row wrap' },
          button('Download backup', () => download(`tally-backup-${today}.json`, JSON.stringify(store.state, null, 2)), { icon: 'download' }),
          h('label', { class: 'btn btn-ghost' }, icon('upload', 17), h('span', null, 'Restore backup'),
            h('input', {
              type: 'file', accept: '.json,application/json', class: 'sr-only',
              onChange: (e: Event) => {
                const f = (e.target as HTMLInputElement).files?.[0];
                if (f) void restoreBackup(f);
              },
            })),
          button('Copy Markdown report', () => copyText(subscriptionReport(state.subscriptions, state.settings.currency, today), 'Report copied as Markdown'), { icon: 'file-text' }),
        ),
        h('div', { class: 'row wrap danger-zone' },
          button('Load sample data', async () => {
            if (await confirmDialog('Replace with sample data?', 'Your current data is replaced. You can undo right after.', 'Load sample data')) {
              store.replace(demoState(today), 'Load sample data');
              toast('Loaded sample data', { label: 'Undo', run: () => store.undo() });
            }
          }, { variant: 'quiet', small: true }),
          button('Erase everything', async () => {
            if (await confirmDialog('Erase all data?', 'Subscriptions, expenses and your cart are removed from this browser. You can undo right after.', 'Erase everything')) {
              const keep = store.state.sync;
              store.replace({ ...emptyState(), sync: keep }, 'Erase everything');
              toast('Erased', { label: 'Undo', run: () => store.undo() });
            }
          }, { variant: 'danger', small: true, icon: 'trash' }),
        ),
      ),
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('h3', null, 'Preferences')),
        remindersBlock(ctx),
        h('div', { class: 'grid-form' },
          field('Currency for subscriptions and cart', h('select', {
            dataset: { key: 'pref-cur' },
            onChange: (e: Event) => store.update('Change currency', (d) => { d.settings.currency = (e.target as HTMLSelectElement).value; }),
          }, CURRENCIES.map((c) => h('option', { value: c, selected: c === state.settings.currency }, c))), 'Changes the label only. Amounts are not converted.'),
          field('Flag subscriptions costing more than', h('input', {
            inputMode: 'decimal', class: 'num', value: toInputValue(state.settings.highCost, state.settings.currency),
            dataset: { key: 'pref-high' },
            onChange: (e: Event) => {
              const v = parseMoney((e.target as HTMLInputElement).value, state.settings.currency);
              if (v === null || v <= 0) return toast('Enter an amount like 20.00');
              store.update('Change threshold', (d) => { d.settings.highCost = v; });
            },
          }), 'Per month. Used for the “High cost” flag.'),
        ),
      ),
    ),
  );
}


/** Restore a backup file (also used when a .json is opened with the installed app). */
export async function restoreBackup(file: File, ask = false) {
  try {
    const next = migrate(JSON.parse(await file.text()));
    if (ask && !(await confirmDialog(`Restore ${file.name}?`, `This replaces what’s in Tally now with ${next.subscriptions.length} subscriptions, ${next.split.expenses.length} expenses and ${next.cart.items.length} cart items. You can undo right after.`, 'Restore backup'))) return;
    store.replace(next, 'Restore backup');
    toast(`Restored ${next.subscriptions.length} subscriptions, ${next.split.expenses.length} expenses, ${next.cart.items.length} cart items`, { label: 'Undo', run: () => store.undo() }, 8000);
  } catch (err) {
    toast(err instanceof SchemaError ? `Can’t restore: ${err.message}` : 'That file isn’t valid JSON.', undefined, 8000);
  }
}

let reminderMsg = '';

function remindersBlock(ctx: ViewContext): HTMLElement {
  const on = remindersOn();
  const support = reminderSupport();
  const perm = permissionState();
  const status = on
    ? 'On. You’ll get a notification when each subscription enters its reminder window.'
    : support === 'needs-install'
      ? 'On iPhone and iPad, notifications work once Tally is added to your Home Screen.'
      : support === 'unsupported'
        ? 'This browser can’t show notifications.'
        : perm === 'denied'
          ? 'Notifications are blocked for this site. Allow them in your browser’s site settings.'
          : 'Get a notification on this device before anything renews. No GitHub needed.';
  return h(
    'div',
    { class: 'reminders-block' },
    h('div', { class: 'rem-head' },
      icon(on ? 'bell-ring' : 'bell', 18),
      h('div', null, h('p', { class: 'strong' }, 'Reminders on this device ', helpTip('reminder-window')), h('p', { class: 'hint', role: 'status' }, reminderMsg || status)),
    ),
    h('div', { class: 'row wrap' },
      on
        ? [
            button('Send a test', () => void testReminder(), { small: true, icon: 'bell' }),
            button('Turn off', async () => {
              await disableReminders();
              reminderMsg = 'Reminders are off on this device.';
              ctx.rerender();
            }, { small: true, variant: 'quiet', key: 'rem-off' }),
          ]
        : button('Turn on reminders', async () => {
            const r = await enableReminders(store.state);
            reminderMsg = r.message;
            ctx.rerender();
          }, { small: true, variant: 'primary', icon: 'bell', key: 'rem-on' }),
    ),
  );
}
