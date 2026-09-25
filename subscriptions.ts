import { detectRecurring, extractTransactions, parseCSV, type RecurringCandidate } from '../lib/csv.ts';
import { CYCLES, type Cycle, addDays, daysBetween, nextOccurrence, formatDate, monthGrid, relativeDays, today as todayISO } from '../lib/dates.ts';
import { formatMoney, parseMoney, toInputValue } from '../lib/money.ts';
import { toICS } from '../lib/ics.ts';
import { uid } from '../lib/schema.ts';
import {
  CATEGORIES,
  type Subscription,
  type Usage,
  annualCost,
  audit,
  byCategory,
  costPerUse,
  forecast,
  withPriceChange,
  monthlyCost,
  nextRenewal,
  renewalsBetween,
  savings,
  totals,
  trialDaysLeft,
  upcoming,
} from '../lib/subscriptions.ts';
import { store } from '../store.ts';
import { button, confirmDialog, download, empty, field, h, icon, openDialog, segmented, svg, toast } from '../ui/dom.ts';
import { rosette } from '../ui/rosette.ts';
import type { ViewContext } from './context.ts';
import { helpTip } from './help.ts';

type Mode = 'list' | 'calendar' | 'import';
let mode: Mode = 'list';
let calMonth = todayISO().slice(0, 8) + '01';
const whatIf = new Set<string>();
let importResults: RecurringCandidate[] | null = null;
type SortKey = 'next' | 'cost' | 'name' | 'review';
let query = '';
let sortKey: SortKey = 'next';
const importPicked = new Set<string>();

const LOBES: Record<Cycle, number> = { weekly: 18, monthly: 12, quarterly: 8, annual: 5 };
const CYCLE_LABEL: Record<Cycle, string> = { weekly: 'week', monthly: 'month', quarterly: 'quarter', annual: 'year' };
const USAGE_LABEL: Record<Usage, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  rarely: 'Rarely',
  never: 'Never',
};

export function subscriptionsView(ctx: ViewContext): HTMLElement {
  const { state, today, money } = ctx;
  const subs = state.subscriptions;
  for (const id of [...whatIf]) if (!subs.some((s) => s.id === id)) whatIf.delete(id);

  return h(
    'section',
    { class: 'view', 'aria-labelledby': 'subs-title' },
    note(ctx),
    h(
      'div',
      { class: 'toolbar' },
      h('h2', { id: 'subs-title', class: 'section-title' }, 'Subscriptions'),
      segmented(
        'View',
        [
          { value: 'list', label: 'List', icon: 'list' },
          { value: 'calendar', label: 'Calendar', icon: 'calendar' },
          { value: 'import', label: 'Find in bank export', icon: 'file-spreadsheet' },
        ],
        mode,
        (m) => {
          mode = m;
          ctx.rerender();
        },
      ),
      h('span', { class: 'spacer' }),
      button('Add subscription', () => editSubscription(ctx), { variant: 'primary', icon: 'plus', key: 'add-sub' }),
    ),
    mode === 'list' ? listPanel(ctx) : mode === 'calendar' ? calendarPanel(ctx) : importPanel(ctx),
    subs.length && mode === 'list' ? categoryBar(ctx) : null,
  );

  // ---------- pieces ----------

  function note(ctx: ViewContext): HTMLElement {
    const t = totals(subs);
    const soon = upcoming(subs, today, 7);
    const plan = savings(subs, whatIf, 5);
    const rings = subs.map((s) => ({
      label: `${s.name}: ${money(monthlyCost(s))}/mo`,
      weight: monthlyCost(s),
      lobes: LOBES[s.cycle],
      tone: s.status === 'paused' ? ('muted' as const) : whatIf.has(s.id) || audit(s, today).some((f) => f.severity === 3) ? ('alert' as const) : ('ink' as const),
    }));
    const serial = `Nº ${String(t.count).padStart(3, '0')} · ${formatDate(today, 'en-US', { month: 'short', year: 'numeric', day: undefined }).toUpperCase()}`;

    return h(
      'div',
      { class: 'note' },
      h('div', { class: 'note-art' }, rosette(rings)),
      h(
        'div',
        { class: 'note-main' },
        h('p', { class: 'serial' }, serial),
        h('p', { class: 'eyebrow' }, 'Subscriptions cost you ', helpTip('monthly-equivalent')),
        h('p', { class: 'figure' }, money(t.monthly), h('span', { class: 'per' }, '/month')),
        h(
          'p',
          { class: 'note-sub' },
          `${money(t.annual)} a year across ${t.count} active ${t.count === 1 ? 'service' : 'services'}.`,
        ),
        whatIf.size
          ? h(
              'p',
              { class: 'whatif-line', role: 'status' },
              icon('piggy-bank', 16),
              ` Cancelling ${whatIf.size} saves `,
              h('strong', null, `${money(plan.annual)}/yr`),
              ` (${money(plan.horizon)} over 5 years). `,
              button('Clear', () => {
                whatIf.clear();
                ctx.rerender();
              }, { variant: 'quiet', small: true }),
            )
          : h('p', { class: 'hint' }, 'Tick “What if I cancel?” on any row to see what you’d save.'),
      ),
      h(
        'aside',
        { class: 'note-side', 'aria-label': 'Renewing in the next 7 days' },
        h('p', { class: 'eyebrow' }, 'Next 7 days'),
        soon.length
          ? h(
              'ul',
              { class: 'soon' },
              soon.slice(0, 5).map((u) =>
                h(
                  'li',
                  null,
                  h('span', { class: 'soon-day' }, relativeDays(u.daysAway)),
                  h('span', { class: 'soon-name' }, u.sub.name),
                  h('span', { class: 'num' }, money(u.sub.amount)),
                ),
              ),
            )
          : h('p', { class: 'hint' }, 'Nothing renews this week.'),
        soon.length
          ? h('p', { class: 'soon-total' }, 'Due ', h('span', { class: 'num' }, money(soon.reduce((a, u) => a + u.sub.amount, 0))))
          : null,
      ),
    );
  }

  function listPanel(ctx: ViewContext): HTMLElement {
    if (!subs.length) {
      return empty(
        'No subscriptions yet',
        'Add one by hand, or upload a bank export and Tally will find the recurring charges for you.',
        h('div', { class: 'row' },
          button('Add subscription', () => editSubscription(ctx), { variant: 'primary', icon: 'plus' }),
          button('Find in bank export', () => { mode = 'import'; ctx.rerender(); }, { icon: 'file-spreadsheet' }),
        ),
      );
    }
    const q = query.trim().toLowerCase();
    const flagScore = (x: Subscription) => audit(x, today).reduce((a, f) => a + f.severity, 0);
    const cmp: Record<SortKey, (a: Subscription, b: Subscription) => number> = {
      next: (a, b) => nextRenewal(a, today).localeCompare(nextRenewal(b, today)),
      cost: (a, b) => monthlyCost(b) - monthlyCost(a),
      name: (a, b) => a.name.localeCompare(b.name),
      review: (a, b) => flagScore(b) - flagScore(a),
    };
    const sorted = subs
      .filter((x) => !q || x.name.toLowerCase().includes(q) || x.category.toLowerCase().includes(q))
      .sort((a, b) => Number(a.status === 'paused') - Number(b.status === 'paused') || cmp[sortKey](a, b) || a.name.localeCompare(b.name));
    const tools = h(
      'div',
      { class: 'list-tools' },
      h('label', { class: 'search' }, icon('search', 16),
        h('input', {
          type: 'search', value: query, placeholder: 'Search subscriptions', 'aria-label': 'Search subscriptions',
          dataset: { key: 'sub-search' },
          onInput: (e: Event) => { query = (e.target as HTMLInputElement).value; ctx.rerender(); },
        })),
      h('label', { class: 'inline-field' }, 'Sort by',
        h('select', {
          dataset: { key: 'sub-sort' },
          onChange: (e: Event) => { sortKey = (e.target as HTMLSelectElement).value as SortKey; ctx.rerender(); },
        },
        ([['next', 'Next charge'], ['cost', 'Monthly cost'], ['review', 'Needs review'], ['name', 'Name']] as const).map(([v, l]) => h('option', { value: v, selected: v === sortKey }, l)))),
      q ? h('span', { class: 'muted' }, `${sorted.length} of ${subs.length}`) : null,
    );
    if (!sorted.length) {
      return h('div', { class: 'card' }, tools, empty(`Nothing matches “${query}”`, 'Try a different name or category.', button('Clear search', () => { query = ''; ctx.rerender(); }, { small: true })));
    }
    return h(
      'div',
      { class: 'card table-wrap' },
      tools,
      h(
        'table',
        { class: 'table subs-table' },
        h(
          'thead',
          null,
          h('tr', null,
            h('th', { scope: 'col' }, 'Service'),
            h('th', { scope: 'col', class: 'r' }, 'Price'),
            h('th', { scope: 'col' }, 'Next charge'),
            h('th', { scope: 'col' }, 'Use ', helpTip('cost-per-use')),
            h('th', { scope: 'col' }, 'Review ', helpTip('review-flags')),
            h('th', { scope: 'col', class: 'r' }, h('span', { class: 'sr-only' }, 'Actions')),
          ),
        ),
        h('tbody', null, sorted.map((s) => row(ctx, s))),
      ),
    );
  }

  function row(ctx: ViewContext, s: Subscription): HTMLElement {
    const next = nextRenewal(s, today);
    const days = daysBetween(today, next);
    const flags = audit(s, today, { highCost: state.settings.highCost, costPerUse: 1000 });
    const trial = trialDaysLeft(s, today);
    const cpu = costPerUse(s);
    const paused = s.status === 'paused';

    return h(
      'tr',
      { class: [paused && 'is-paused', whatIf.has(s.id) && 'is-whatif'] },
      h(
        'td',
        { 'data-label': 'Service' },
        h('div', { class: 'svc' },
          h('span', { class: 'svc-name' }, s.name),
          h('span', { class: 'svc-meta' },
            s.category,
            s.status === 'trial' ? h('span', { class: 'tag tag-trial' }, trial !== null && trial >= 0 ? `Trial · ${trial}d left` : 'Trial') : null,
            paused ? h('span', { class: 'tag' }, 'Paused') : null,
          ),
        ),
      ),
      h(
        'td',
        { class: 'r', 'data-label': 'Price' },
        h('span', { class: 'num strong' }, money(s.amount)),
        h('span', { class: 'svc-meta' }, `/${CYCLE_LABEL[s.cycle]}`, s.cycle !== 'monthly' ? ` · ${money(monthlyCost(s))}/mo` : ''),
      ),
      h(
        'td',
        { 'data-label': 'Next charge' },
        paused
          ? h('span', { class: 'muted' }, '—')
          : [
              h('span', { class: 'num' }, formatDate(next)),
              h('span', { class: ['svc-meta', days <= s.leadDays && 'warn-text'] }, relativeDays(days)),
            ],
      ),
      h(
        'td',
        { 'data-label': 'Use' },
        h('span', null, USAGE_LABEL[s.usage]),
        cpu !== null && !paused ? h('span', { class: 'svc-meta' }, `≈ ${money(cpu)}/use`) : null,
      ),
      h(
        'td',
        { 'data-label': 'Review' },
        flags.length
          ? h('div', { class: 'flags' }, flags.map((f) => h('span', { class: `flag sev-${f.severity}`, title: f.detail }, f.label)))
          : h('span', { class: 'muted' }, paused ? '' : 'Looks fine'),
        !paused
          ? h(
              'label',
              { class: 'whatif' },
              h('input', {
                type: 'checkbox',
                checked: whatIf.has(s.id),
                dataset: { key: `whatif-${s.id}` },
                onChange: (e: Event) => {
                  (e.target as HTMLInputElement).checked ? whatIf.add(s.id) : whatIf.delete(s.id);
                  ctx.rerender();
                },
              }),
              'What if I cancel?',
            )
          : null,
      ),
      h(
        'td',
        { class: 'r actions' },
        button('', () => editSubscription(ctx, s), { icon: 'pencil', title: `Edit ${s.name}`, variant: 'quiet', small: true }),
        button('', () => {
          store.update(paused ? `Resume ${s.name}` : `Pause ${s.name}`, (d) => {
            const x = d.subscriptions.find((y) => y.id === s.id);
            if (x) x.status = paused ? 'active' : 'paused';
          });
          toast(paused ? `Resumed ${s.name}` : `Paused ${s.name}. It no longer counts toward your totals.`);
        }, { icon: paused ? 'play' : 'pause', title: paused ? `Resume ${s.name}` : `Pause ${s.name}`, variant: 'quiet', small: true }),
        button('', () => {
          store.update(`Delete ${s.name}`, (d) => {
            d.subscriptions = d.subscriptions.filter((y) => y.id !== s.id);
          });
          toast(`Deleted ${s.name}`, { label: 'Undo', run: () => store.undo() });
        }, { icon: 'trash', title: `Delete ${s.name}`, variant: 'quiet', small: true }),
      ),
    );
  }

  function categoryBar(ctx: ViewContext): HTMLElement {
    const cats = byCategory(subs);
    const sum = cats.reduce((a, c) => a + c.monthly, 0) || 1;
    return h(
      'div',
      { class: 'card cats' },
      h('p', { class: 'eyebrow' }, 'Where it goes, per month'),
      h(
        'div',
        { class: 'stack', role: 'img', 'aria-label': cats.map((c) => `${c.category} ${ctx.money(c.monthly)}`).join(', ') },
        cats.map((c, i) => h('span', { class: `seg c${i % 6}`, style: { flexGrow: String(c.monthly / sum) }, title: `${c.category}: ${ctx.money(c.monthly)}` })),
      ),
      h(
        'ul',
        { class: 'legend' },
        cats.map((c, i) =>
          h('li', null, h('span', { class: `dot c${i % 6}` }), c.category, h('span', { class: 'num muted' }, ctx.money(c.monthly))),
        ),
      ),
    );
  }

  function calendarPanel(ctx: ViewContext): HTMLElement {
    const weeks = monthGrid(calMonth);
    const month = calMonth.slice(0, 7);
    const start = weeks[0]![0]!;
    const end = weeks.at(-1)![6]!;
    const entries = renewalsBetween(subs, start, end);
    const inMonth = entries.filter((e) => e.date.startsWith(month));
    const monthTotal = inMonth.reduce((a, e) => a + e.sub.amount, 0);
    const shift = (n: number) => {
      const [y, m] = calMonth.split('-').map(Number) as [number, number];
      const d = new Date(Date.UTC(y, m - 1 + n, 1));
      calMonth = d.toISOString().slice(0, 10);
      ctx.rerender();
    };

    return h('div', { class: 'cal-stack' }, forecastCard(ctx), h(
      'div',
      { class: 'card calendar' },
      h(
        'div',
        { class: 'cal-head' },
        button('', () => shift(-1), { icon: 'chevron-left', title: 'Previous month', variant: 'quiet', key: 'cal-prev' }),
        h('h3', null, formatDate(calMonth, undefined, { month: 'long', year: 'numeric', day: undefined })),
        button('', () => shift(1), { icon: 'chevron-right', title: 'Next month', variant: 'quiet', key: 'cal-next' }),
        h('span', { class: 'spacer' }),
        h('p', { class: 'muted' }, `${inMonth.length} charges · `, h('span', { class: 'num strong' }, money(monthTotal))),
      ),
      h(
        'div',
        { class: 'cal-grid', role: 'grid' },
        ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => h('div', { class: 'cal-dow', role: 'columnheader' }, d)),
        weeks.flat().map((date) => {
          const day = entries.filter((e) => e.date === date);
          return h(
            'div',
            {
              role: 'gridcell',
              class: ['cal-cell', !date.startsWith(month) && 'out', date === today && 'today'],
              'aria-label': `${formatDate(date, undefined, { weekday: 'long' })}${day.length ? `, ${day.map((e) => e.sub.name).join(', ')}` : ''}`,
            },
            h('span', { class: 'cal-date' }, String(Number(date.slice(8)))),
            day.map((e) => h('span', { class: 'cal-chip', title: `${e.sub.name} · ${money(e.sub.amount)}` }, e.sub.name)),
          );
        }),
      ),
    ));
  }

  function forecastCard(ctx: ViewContext): HTMLElement {
    const months = forecast(subs, today, 12);
    const avg = totals(subs).monthly;
    const max = Math.max(1, avg, ...months.map((m) => m.total));
    const peak = months.reduce((a, m) => (m.total > a.total ? m : a), months[0]!);
    const W = 720, H = 180, top = 22, bottom = 26, gap = 10;
    const bw = (W - gap * 11) / 12;
    const y = (v: number) => top + (H - top - bottom) * (1 - v / max);
    const label = (m: string) => formatDate(`${m}-01`, undefined, { month: 'short', day: undefined });
    const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'forecast', role: 'img', 'aria-label': `Charges per month for the next year. Highest: ${label(peak.month)} at ${money(peak.total)}. Average ${money(avg)}.` });
    months.forEach((m, i) => {
      const x = i * (bw + gap);
      const bar = svg('rect', { x, y: y(m.total), width: bw, height: Math.max(0, H - bottom - y(m.total)), rx: 3, class: ['fc-bar', m === peak && m.total > avg * 1.2 ? 'peak' : '', i === 0 ? 'now' : ''].join(' ') });
      const t = svg('title');
      t.textContent = `${label(m.month)}: ${money(m.total)} (${m.charges} charges)`;
      bar.appendChild(t);
      chart.appendChild(bar);
      const lbl = svg('text', { x: x + bw / 2, y: H - 8, class: 'fc-label', 'text-anchor': 'middle' });
      lbl.textContent = label(m.month);
      chart.appendChild(lbl);
      if (m === peak) {
        const v = svg('text', { x: x + bw / 2, y: y(m.total) - 6, class: 'fc-value', 'text-anchor': 'middle' });
        v.textContent = formatMoney(m.total, ctx.state.settings.currency, { compact: m.total >= 100_000 });
        chart.appendChild(v);
      }
    });
    chart.appendChild(svg('line', { x1: 0, x2: W, y1: y(avg), y2: y(avg), class: 'fc-avg' }));
    return h(
      'div',
      { class: 'card forecast-card' },
      h('div', { class: 'card-head' },
        h('div', null, h('h3', null, 'Next 12 months ', helpTip('forecast')), h('p', { class: 'hint' }, 'What actually leaves your account each month. The dashed line is your average; tall bars are where annual renewals land.')),
        button('Add to calendar', () => {
          download('tally-renewals.ics', toICS(subs, ctx.state.settings.currency, today), 'text/calendar');
          toast('Downloaded tally-renewals.ics. Open it to add every renewal, with reminders, to your calendar.', undefined, 7000);
        }, { icon: 'calendar', small: true, title: 'Download an .ics file for Google, Apple or Outlook Calendar' }),
      ),
      h('div', { class: 'chart-scroll' }, chart),
    );
  }

  function importPanel(ctx: ViewContext): HTMLElement {
    const drop = h(
      'label',
      { class: 'dropzone' },
      icon('upload', 22),
      h('span', { class: 'strong' }, 'Choose a CSV export from your bank or card'),
      h('span', { class: 'muted' }, 'or drop it here. It’s read in your browser and never uploaded.'),
      h('input', {
        type: 'file',
        accept: '.csv,text/csv',
        class: 'sr-only',
        onChange: (e: Event) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          if (f) void readFile(f, ctx);
        },
      }),
    );
    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.classList.add('over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      const f = e.dataTransfer?.files[0];
      if (f) void readFile(f, ctx);
    });

    const existing = new Set(subs.map((s) => s.name.toLowerCase()));
    return h(
      'div',
      { class: 'card import' },
      h('p', { class: 'lede' }, 'Tally looks for charges that repeat on a steady schedule at a steady price. Those are almost always subscriptions, including the ones you forgot about.'),
      drop,
      importResults === null
        ? null
        : importResults.length === 0
          ? empty('No recurring charges found', 'Try an export covering at least three months. Tally needs to see a charge twice before it can call it recurring.')
          : h(
              'div',
              null,
              h('table', { class: 'table' },
                h('thead', null, h('tr', null,
                  h('th', null, h('span', { class: 'sr-only' }, 'Add')),
                  h('th', null, 'Merchant'), h('th', { class: 'r' }, 'Amount'), h('th', null, 'Every'),
                  h('th', null, 'Next expected'), h('th', null, 'Confidence ', helpTip('confidence')))),
                h('tbody', null, importResults.map((c) => {
                  const known = existing.has(c.name.toLowerCase());
                  return h('tr', { class: known ? 'is-paused' : '' },
                    h('td', null, h('input', {
                      type: 'checkbox', checked: importPicked.has(c.name), disabled: known,
                      'aria-label': `Add ${c.name}`,
                      dataset: { key: `imp-${c.name}` },
                      onChange: (e: Event) => { (e.target as HTMLInputElement).checked ? importPicked.add(c.name) : importPicked.delete(c.name); ctx.rerender(); },
                    })),
                    h('td', null, c.name, known ? h('span', { class: 'svc-meta' }, 'Already tracked') : h('span', { class: 'svc-meta' }, `${c.occurrences} charges seen`)),
                    h('td', { class: 'r' }, h('span', { class: 'num' }, money(c.amount)),
                      c.previousAmount !== undefined ? h('span', { class: ['svc-meta', c.amount > c.previousAmount && 'warn-text'] }, `${c.amount > c.previousAmount ? 'up' : 'down'} from ${money(c.previousAmount)}`) : null),
                    h('td', null, CYCLE_LABEL[c.cycle]),
                    h('td', { class: 'num' }, formatDate(nextOccurrence(c.nextExpected, c.cycle, today))),
                    h('td', null, h('span', { class: 'meter', style: { '--v': String(c.confidence) } as Partial<CSSStyleDeclaration>, title: `${Math.round(c.confidence * 100)}%` }), `${Math.round(c.confidence * 100)}%`),
                  );
                })),
              ),
              h('div', { class: 'row end' },
                button(`Add ${importPicked.size || ''} selected`.replace('  ', ' '), () => {
                  const picked = importResults!.filter((c) => importPicked.has(c.name));
                  if (!picked.length) return toast('Select at least one charge to add.');
                  // Switch views before saving: saving re-renders immediately.
                  importPicked.clear();
                  importResults = null;
                  mode = 'list';
                  store.update(`Import ${picked.length} subscriptions`, (d) => {
                    for (const c of picked) {
                      d.subscriptions.push({
                        id: uid(), name: c.name, amount: c.amount, cycle: c.cycle, anchor: nextOccurrence(c.nextExpected, c.cycle, today),
                        category: 'Other', leadDays: 3, status: 'active', usage: 'monthly',
                        ...(c.previousAmount !== undefined ? { history: [{ amount: c.previousAmount, until: c.lastCharged }] } : {}),
                      });
                    }
                  });
                  toast(`Added ${picked.length} subscriptions`, { label: 'Undo', run: () => store.undo() });
                }, { variant: 'primary', icon: 'plus' }),
              ),
            ),
    );
  }
}

/** Entry point for CSVs opened from the OS, dropped on the window, or shared. */
export function importBankCSV(file: File, ctx: ViewContext) {
  mode = 'import';
  void readFile(file, ctx);
}

async function readFile(file: File, ctx: ViewContext) {
  try {
    const text = await file.text();
    const tx = extractTransactions(parseCSV(text), ctx.state.settings.currency);
    importResults = detectRecurring(tx);
    importPicked.clear();
    const known = new Set(ctx.state.subscriptions.map((s) => s.name.toLowerCase()));
    importResults.filter((c) => c.confidence >= 0.5 && !known.has(c.name.toLowerCase())).forEach((c) => importPicked.add(c.name));
    toast(`Scanned ${tx.length} charges, found ${importResults.length} recurring`);
  } catch (e) {
    importResults = null;
    toast(e instanceof Error ? e.message : 'Could not read that file.');
  }
  ctx.rerender();
}

export function editSubscription(ctx: ViewContext, existing?: Subscription) {
  const cur = ctx.state.settings.currency;
  const s: Subscription = existing ?? {
    id: uid(), name: '', amount: 0, cycle: 'monthly', anchor: addDays(ctx.today, 7),
    category: 'Entertainment', leadDays: 3, status: 'active', usage: 'weekly',
  };
  const opt = (v: string, label: string, sel: string) => h('option', { value: v, selected: v === sel }, label);

  openDialog({
    title: existing ? `Edit ${existing.name}` : 'Add subscription',
    submitLabel: existing ? 'Save changes' : 'Add subscription',
    body: (form) => {
      const status = h('select', { name: 'status' }, opt('active', 'Active', s.status), opt('trial', 'Free trial', s.status), opt('paused', 'Paused', s.status));
      const trialField = field('Trial ends', h('input', { type: 'date', name: 'trialEnds', value: s.trialEnds ?? addDays(ctx.today, 7) }), 'You’ll be alerted before it converts to paid.');
      const syncTrial = () => (trialField.hidden = status.value !== 'trial');
      status.addEventListener('change', syncTrial);
      syncTrial();
      void form;
      return h('div', { class: 'grid-form' },
        field('Name', h('input', { name: 'name', required: true, value: s.name, placeholder: 'Netflix', autocomplete: 'off' })),
        h('div', { class: 'pair' },
          field(`Price (${cur})`, h('input', { name: 'amount', required: true, inputMode: 'decimal', value: existing ? toInputValue(s.amount, cur) : '', placeholder: '15.49' })),
          field('Billed every', h('select', { name: 'cycle' }, CYCLES.map((c) => opt(c, CYCLE_LABEL[c], s.cycle)))),
        ),
        h('div', { class: 'pair' },
          field('Next charge', h('input', { type: 'date', name: 'anchor', required: true, value: nextRenewal(s, ctx.today) })),
          field('Remind me', h('select', { name: 'leadDays' }, [1, 2, 3, 5, 7, 14, 30].map((n) => opt(String(n), `${n} day${n > 1 ? 's' : ''} before`, String(s.leadDays))))),
        ),
        h('div', { class: 'pair' },
          field('Category', h('select', { name: 'category' }, [...new Set([...CATEGORIES, s.category])].map((c) => opt(c, c, s.category)))),
          field('How often you use it', h('select', { name: 'usage' }, (Object.keys(USAGE_LABEL) as Usage[]).map((u) => opt(u, USAGE_LABEL[u], s.usage)))),
        ),
        h('div', { class: 'pair' }, field('Status', status), trialField),
        field('Cancel or manage link', h('input', { name: 'url', type: 'url', value: s.url ?? '', placeholder: 'https://…' }), 'Included in the GitHub alert so you can act fast.'),
        s.history?.length
          ? h('div', { class: 'preview-box' },
              h('p', { class: 'eyebrow' }, 'Price history'),
              h('ul', { class: 'share-preview' },
                [...s.history].reverse().map((p) => h('li', null, h('span', null, `Until ${formatDate(p.until, undefined, { year: 'numeric' })}`), h('span', { class: 'num' }, ctx.money(p.amount)))),
                h('li', null, h('span', { class: 'strong' }, 'Now'), h('span', { class: 'num strong' }, ctx.money(s.amount))),
              ))
          : h('p', { class: 'hint' }, 'Tally keeps a price history when you change the price, and flags increases.'),
      );
    },
    onSubmit: (data) => {
      const name = String(data.get('name')).trim();
      const amount = parseMoney(String(data.get('amount')), cur);
      if (!name) return 'Enter a name.';
      if (amount === null || amount <= 0) return 'Enter a price greater than zero, like 15.49.';
      const next: Subscription = {
        ...s,
        history: existing ? withPriceChange(existing, amount, ctx.today) : s.history,
        name,
        amount,
        cycle: data.get('cycle') as Cycle,
        anchor: String(data.get('anchor')),
        leadDays: Number(data.get('leadDays')),
        category: String(data.get('category')),
        usage: data.get('usage') as Usage,
        status: data.get('status') as Subscription['status'],
      };
      if (next.status === 'trial') next.trialEnds = String(data.get('trialEnds'));
      else delete next.trialEnds;
      const url = String(data.get('url') ?? '').trim();
      if (url) next.url = url;
      else delete next.url;

      store.update(existing ? `Edit ${name}` : `Add ${name}`, (d) => {
        const i = d.subscriptions.findIndex((x) => x.id === s.id);
        if (i >= 0) d.subscriptions[i] = next;
        else d.subscriptions.push(next);
      });
      toast(existing ? `Saved ${name}` : `Added ${name} · ${ctx.money(annualCost(next))}/yr`);
    },
    extraActions: existing
      ? [button('Delete', async () => {
          if (await confirmDialog(`Delete ${existing.name}?`, 'You can undo this right after.', 'Delete')) {
            document.querySelector<HTMLDialogElement>('dialog.dialog')?.close();
            store.update(`Delete ${existing.name}`, (d) => { d.subscriptions = d.subscriptions.filter((x) => x.id !== existing.id); });
            toast(`Deleted ${existing.name}`, { label: 'Undo', run: () => store.undo() });
          }
        }, { variant: 'danger', icon: 'trash' })]
      : [],
  });
}
