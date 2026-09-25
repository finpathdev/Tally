// Fonts are bundled (no Google Fonts request) so the app is private and works offline.
import '@fontsource/gloock/latin-400.css';
import '@fontsource-variable/hanken-grotesk/index.css';
import '@fontsource/martian-mono/latin-400.css';
import './styles.css';
import { today as todayISO } from './lib/dates.ts';
import { emptyState, type Theme } from './lib/schema.ts';
import { store } from './store.ts';
import { upcoming } from './lib/subscriptions.ts';
import { button, h, icon, openDialog, svg, toast } from './ui/dom.ts';
import { canOfferInstall, initInstall, install, onInstallChange } from './ui/install.ts';
import { initFileIntake, registerServiceWorker, setBadge } from './ui/pwa.ts';
import { checkReminders, syncSchedule } from './ui/reminders.ts';
import type { IconName } from './ui/icons.ts';
import { cartView } from './views/cart.ts';
import { type Tab, makeContext } from './views/context.ts';
import { editExpense, splitView } from './views/split.ts';
import { editSubscription, importBankCSV, subscriptionsView } from './views/subscriptions.ts';
import { restoreBackup, syncView } from './views/sync.ts';
import { sharedView } from './views/shared.ts';
import { focusHelpTarget, helpView, openAskDrawer } from './views/help.ts';

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'subscriptions', label: 'Subscriptions', icon: 'repeat' },
  { id: 'split', label: 'Split', icon: 'users' },
  { id: 'cart', label: 'Cart', icon: 'shopping-cart' },
  { id: 'sync', label: 'Sync', icon: 'git-branch' },
  { id: 'help', label: 'Help', icon: 'circle-question-mark' },
];

const VIEWS = { subscriptions: subscriptionsView, split: splitView, cart: cartView, sync: syncView, help: helpView };

const app = document.getElementById('app')!;
const main = h('main', { id: 'main', tabIndex: -1 });
const nav = h('nav', { class: 'tabs', 'aria-label': 'Sections' });
const themeBtn = h('button', { type: 'button', class: 'btn btn-quiet btn-icon', onClick: cycleTheme });
const undoBtn = button('', () => undo(), { icon: 'undo-2', title: 'Undo (U)', variant: 'quiet' });

const installBtn = button('Install app', () => void install(), { icon: 'download', variant: 'ghost', small: true, title: 'Install Tally on this device' });
installBtn.classList.add('install-btn');

/**
 * Routes: #/split, #/split/new (app shortcuts), and #/shared/<token> for a
 * read-only split link (shown under the Split tab).
 */
function route(): { tab: Tab; action: string | null; shared: string | null } {
  const [id, action] = location.hash.replace(/^#\/?/, '').split('/') as [string, string | undefined];
  if (id === 'shared' && action) return { tab: 'split', action: null, shared: action };
  return { tab: (id in VIEWS ? id : 'subscriptions') as Tab, action: action ?? null, shared: null };
}
const currentTab = () => route().tab;

function go(tab: Tab) {
  if (currentTab() !== tab) location.hash = `/${tab}`;
  else render();
}

// ---------- theme ----------

const media = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const pref = store.state.settings.theme;
  const resolved = pref === 'system' ? (media.matches ? 'dark' : 'light') : pref;
  document.documentElement.dataset.theme = resolved;
  const next: Record<Theme, string> = { system: 'Use light theme', light: 'Use dark theme', dark: 'Match system theme' };
  themeBtn.replaceChildren(icon(pref === 'dark' ? 'moon' : pref === 'light' ? 'sun' : 'sun-moon', 17));
  themeBtn.title = `${next[pref]} (T)`;
  themeBtn.setAttribute('aria-label', themeBtn.title);
}
function cycleTheme() {
  const order: Theme[] = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(store.state.settings.theme) + 1) % order.length]!;
  store.update(null, (d) => { d.settings.theme = next; });
}
media.addEventListener('change', applyTheme);

// ---------- render ----------

function tallyMark(): SVGElement {
  // Four strokes and a gate: the mark people have used to count for millennia.
  const g = svg('svg', { viewBox: '0 0 32 32', width: 28, height: 28, class: 'mark', 'aria-hidden': 'true' });
  [7, 12.5, 18, 23.5].forEach((x, i) => g.appendChild(svg('path', { d: `M${x} 6 L${x + (i % 2 ? 0.6 : -0.4)} 26`, style: `--d:${i}` })));
  g.appendChild(svg('path', { d: 'M3 21 L29 10', class: 'gate', style: '--d:4' }));
  return g;
}

function renderNav() {
  const tab = currentTab();
  nav.replaceChildren(
    ...TABS.map((t, i) =>
      h(
        'a',
        { href: `#/${t.id}`, class: 'tab', 'aria-current': t.id === tab ? 'page' : undefined, title: `${t.label} (${i + 1})` },
        icon(t.icon, 18),
        h('span', null, t.label),
      ),
    ),
  );
}

let lastTab: Tab | null = null;

function render() {
  const active = document.activeElement as HTMLElement | null;
  const focusKey = active?.dataset?.key;
  // Keep the caret where it was when re-rendering while someone types.
  const caret = active instanceof HTMLInputElement && active.type !== 'checkbox' ? [active.selectionStart, active.selectionEnd] : null;
  const tab = currentTab();
  const ctx = makeContext(todayISO(), render, go);
  renderNav();
  applyTheme();
  undoBtn.disabled = !store.canUndo;
  installBtn.hidden = !canOfferInstall();
  setBadge(upcoming(store.state.subscriptions, ctx.today, 3).length);
  const shared = route().shared;
  const view = shared ? sharedView(ctx, shared) : VIEWS[tab](ctx);
  if (tab !== lastTab) view.classList.add('enter');
  lastTab = tab;
  main.replaceChildren((shared ? null : sampleBanner()) ?? '', view);
  document.title = shared ? 'Shared split · Tally' : `${TABS.find((t) => t.id === tab)!.label} · Tally`;
  if (focusKey) {
    const el = main.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`);
    el?.focus({ preventScroll: true });
    if (caret && el instanceof HTMLInputElement) {
      try { el.setSelectionRange(caret[0] ?? null, caret[1] ?? null); } catch { /* type without selection */ }
    }
  }
  runRouteAction(ctx);
}

/** Handle #/<tab>/new from app shortcuts, then tidy the URL. */
function runRouteAction(ctx: ReturnType<typeof makeContext>) {
  const { tab, action } = route();
  askFab.hidden = tab === 'help';
  if (tab === 'help' && action) {
    history.replaceState(null, '', '#/help');
    requestAnimationFrame(() => focusHelpTarget(action));
    return;
  }
  if (action !== 'new') return;
  history.replaceState(null, '', `#/${tab}`);
  queueMicrotask(() => {
    if (tab === 'subscriptions') editSubscription(ctx);
    else if (tab === 'split') editExpense(ctx);
    else if (tab === 'cart') document.querySelector<HTMLInputElement>('.quick-add input')?.focus();
  });
}

/** "Ask" button: opens the help desk from any screen. */
const askFab = h('button', { type: 'button', class: 'ask-fab', onClick: () => openAskDrawer(), title: 'Ask the help desk (H)' },
  icon('message-circle-question-mark', 18), h('span', null, 'Ask'));

function openFile(file: File) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || file.type === 'text/csv') {
    if (currentTab() !== 'subscriptions') location.hash = '/subscriptions';
    importBankCSV(file, makeContext(todayISO(), render, go));
    render();
  } else if (name.endsWith('.json') || file.type === 'application/json') {
    void restoreBackup(file, true);
  } else {
    toast(`Tally can open .csv bank exports and .json backups, not ${file.name}.`);
  }
}

let bannerDismissed = (() => {
  try {
    return localStorage.getItem('tally:banner') === 'off' || localStorage.getItem('tally:sample') !== '1';
  } catch {
    return store.loadedFrom !== 'demo';
  }
})();

function sampleBanner(): HTMLElement | null {
  if (bannerDismissed) return null;
  const dismiss = () => {
    bannerDismissed = true;
    try {
      localStorage.setItem('tally:banner', 'off');
      localStorage.removeItem('tally:sample');
    } catch { /* ignore */ }
  };
  return h(
    'div',
    { class: 'banner', role: 'note' },
    icon('info', 17),
    h('span', null, 'This is sample data so you can look around. Nothing leaves your browser.'),
    h('span', { class: 'spacer' }),
    button('Start with a clean slate', () => {
      dismiss();
      const keep = store.state.settings;
      store.replace({ ...emptyState(), settings: keep }, 'Clear sample data');
      toast('Cleared the sample data', { label: 'Undo', run: () => store.undo() });
    }, { small: true, variant: 'primary' }),
    button('Keep exploring', () => { dismiss(); render(); }, { small: true, variant: 'quiet' }),
  );
}

function undo() {
  const label = store.undo();
  toast(label ? `Undid: ${label}` : 'Nothing to undo');
}

// ---------- keyboard ----------

function showShortcuts() {
  const rows: [string, string][] = [
    ['1 – 5', 'Switch section'],
    ['H', 'Ask the help desk'],
    ['N', 'Add to the current section'],
    ['U', 'Undo last change'],
    ['T', 'Change theme'],
    ['?', 'Show this list'],
  ];
  openDialog({
    title: 'Keyboard shortcuts',
    submitLabel: 'Done',
    body: () => h('dl', { class: 'shortcuts' }, rows.flatMap(([k, v]) => [h('dt', null, h('kbd', null, k)), h('dd', null, v)])),
    onSubmit: () => {},
    infoOnly: true,
  });
}

document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, [contenteditable], dialog')) return;
  const n = Number(e.key);
  if (n >= 1 && n <= TABS.length) return go(TABS[n - 1]!.id);
  const ctx = () => makeContext(todayISO(), render, go);
  switch (e.key.toLowerCase()) {
    case 'n':
      e.preventDefault();
      if (currentTab() === 'subscriptions') editSubscription(ctx());
      else if (currentTab() === 'split') editExpense(ctx());
      else if (currentTab() === 'cart') document.querySelector<HTMLInputElement>('.quick-add input')?.focus();
      else if (currentTab() === 'help') document.querySelector<HTMLInputElement>('.chat-tab .composer input')?.focus();
      break;
    case 'h':
      e.preventDefault();
      if (currentTab() === 'help') document.querySelector<HTMLInputElement>('.chat-tab .composer input')?.focus();
      else openAskDrawer();
      break;
    case 'u':
      undo();
      break;
    case 't':
      cycleTheme();
      break;
    case '?':
      showShortcuts();
      break;
  }
});

// ---------- boot ----------

app.replaceChildren(
  h('a', { class: 'skip', href: '#main', onClick: (e: Event) => { e.preventDefault(); main.focus(); } }, 'Skip to content'),
  h(
    'header',
    { class: 'topbar' },
    h('a', { class: 'brand', href: '#/subscriptions', 'aria-label': 'Tally home' }, tallyMark(), h('span', null, 'Tally')),
    nav,
    h('div', { class: 'top-actions' },
      installBtn,
      undoBtn,
      themeBtn,
      Object.assign(button('', showShortcuts, { icon: 'keyboard', title: 'Keyboard shortcuts (?)', variant: 'quiet' }), { className: 'btn btn-quiet btn-icon kbd-btn' }),
    ),
  ),
  main,
  h('footer', { class: 'foot' }, 'Local-first. Your data stays in this browser unless you commit it to your own repo.'),
  askFab,
  h('div', { id: 'toasts', class: 'toasts', 'aria-live': 'polite' }),
);

window.addEventListener('hashchange', () => {
  render();
  main.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
});
store.subscribe(render);
store.subscribe((state) => void syncSchedule(state).catch(() => {}));
render();
// Let the rosette and mark draw themselves once; later updates appear instantly.
setTimeout(() => document.body.classList.add('settled-anim'), 2200);

if (store.loadedFrom === 'legacy') toast('Imported your data from the original FinHub app.');

initInstall();
onInstallChange(render);
initFileIntake(openFile);
registerServiceWorker();

// Reminders: refresh the schedule, then show anything due, now and whenever
// Tally comes back to the foreground.
const remind = () => void syncSchedule(store.state).then(checkReminders).catch(() => {});
remind();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') remind();
});
