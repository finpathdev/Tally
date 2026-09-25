import { formatDate } from '../lib/dates.ts';
import { convert, formatMoney, parseMoney, toInputValue } from '../lib/money.ts';
import { uid } from '../lib/schema.ts';
import { SAFE_LINK_LENGTH, encodeShare } from '../lib/share.ts';
import {
  type Expense,
  type Member,
  type SplitRule,
  SplitError,
  balances,
  memberSummary,
  shares,
  simplify,
} from '../lib/settle.ts';
import { store } from '../store.ts';
import { button, copyText, empty, field, h, icon, openDialog, toast } from '../ui/dom.ts';
import type { ViewContext } from './context.ts';
import { helpTip } from './help.ts';

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'INR', 'JPY', 'MXN', 'CHF', 'SGD'];

const SPLIT_LABEL: Record<SplitRule['kind'], string> = {
  equal: 'Equally',
  weighted: 'By income',
  shares: 'By shares',
  exact: 'Exact amounts',
};

export function splitView(ctx: ViewContext): HTMLElement {
  const { state } = ctx;
  const { members, expenses, payments, currency } = state.split;
  const m = (x: number) => formatMoney(x, currency);
  const nameOf = (id: string) => members.find((x) => x.id === id)?.name ?? 'Former member';

  let bal = new Map<string, number>();
  let transfers: ReturnType<typeof simplify> = [];
  let error: string | null = null;
  try {
    bal = balances(members, expenses, payments);
    transfers = simplify(bal);
  } catch (e) {
    error = e instanceof SplitError ? e.message : 'Could not compute balances.';
  }
  const maxAbs = Math.max(1, ...[...bal.values()].map(Math.abs));
  const summary = error ? new Map() : memberSummary(members, expenses);
  const spent = expenses.reduce((a, e) => a + e.amount, 0);

  return h(
    'section',
    { class: 'view', 'aria-labelledby': 'split-title' },
    h(
      'div',
      { class: 'toolbar' },
      h('h2', { id: 'split-title', class: 'section-title' }, 'Split'),
      h('p', { class: 'muted' }, 'Shared costs, split fairly, settled in as few payments as possible.'),
      h('span', { class: 'spacer' }),
      h(
        'label',
        { class: 'inline-field' },
        'Group currency',
        h(
          'select',
          {
            disabled: expenses.length > 0,
            title: expenses.length ? 'Settle and clear expenses before changing the group currency' : undefined,
            dataset: { key: 'split-currency' },
            onChange: (e: Event) => store.update('Change group currency', (d) => { d.split.currency = (e.target as HTMLSelectElement).value; }),
          },
          CURRENCIES.map((c) => h('option', { value: c, selected: c === currency }, c)),
        ),
      ),
      button('Log expense', () => editExpense(ctx), { variant: 'primary', icon: 'plus', key: 'add-exp' }),
    ),
    h(
      'div',
      { class: 'split-grid' },
      // People + balances
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('h3', null, 'People ', helpTip('balance')), h('span', { class: 'muted' }, `${m(spent)} spent together`)),
        members.length
          ? h(
              'ul',
              { class: 'balances' },
              members.map((p) => {
                const v = bal.get(p.id) ?? 0;
                const s = summary.get(p.id) as { paid: number; share: number } | undefined;
                return h(
                  'li',
                  null,
                  h('button', { class: 'person', type: 'button', onClick: () => editMember(ctx, p), title: `Edit ${p.name}`, dataset: { key: `member-${p.id}` } },
                    h('span', { class: 'avatar', 'aria-hidden': 'true' }, p.name.slice(0, 1).toUpperCase()),
                    h('span', { class: 'person-name' }, p.name),
                  ),
                  h(
                    'div',
                    { class: 'bal-bar', role: 'img', 'aria-label': v === 0 ? 'Settled' : v > 0 ? `Is owed ${m(v)}` : `Owes ${m(-v)}` },
                    h('span', { class: ['bal-fill', v >= 0 ? 'pos' : 'neg'], style: { width: `${(Math.abs(v) / maxAbs) * 50}%` } }),
                  ),
                  h('span', { class: ['num', 'bal-num', v > 0 ? 'pos-text' : v < 0 ? 'neg-text' : 'muted'] }, v === 0 ? 'settled' : formatMoney(v, currency, { sign: true })),
                  s ? h('span', { class: 'svc-meta person-meta' }, `paid ${m(s.paid)} · share ${m(s.share)}`) : null,
                );
              }),
            )
          : h('p', { class: 'hint' }, 'Add the people you share costs with.'),
        addMemberForm(),
      ),
      // Settle up
      h(
        'div',
        { class: 'card settle' },
        h('div', { class: 'card-head' }, h('h3', null, 'Settle up ', helpTip('settle-up')), transfers.length ? h('span', { class: 'muted' }, `${transfers.length} ${transfers.length === 1 ? 'payment' : 'payments'} clears everything`) : null),
        error
          ? h('p', { class: 'form-error' }, error)
          : transfers.length
            ? h(
                'ol',
                { class: 'transfers' },
                transfers.map((t) =>
                  h(
                    'li',
                    null,
                    h('span', { class: 'strong' }, nameOf(t.from)),
                    icon('arrow-right', 16),
                    h('span', { class: 'strong' }, nameOf(t.to)),
                    h('span', { class: 'num amount' }, m(t.amount)),
                    button('Mark paid', () => {
                      store.update(`Record payment`, (d) => {
                        d.split.payments.push({ id: uid(), from: t.from, to: t.to, amount: t.amount, date: ctx.today });
                      });
                      toast(`Recorded ${nameOf(t.from)} paying ${nameOf(t.to)} ${m(t.amount)}`, { label: 'Undo', run: () => store.undo() });
                    }, { small: true, icon: 'check' }),
                  ),
                ),
              )
            : h('div', { class: 'settled' }, icon('circle-check', 22), h('p', null, expenses.length ? 'Everyone is square.' : 'Log a shared expense to see who owes whom.')),
        transfers.length > 1
          ? h('p', { class: 'hint' }, 'Tally searches every grouping of balances to find the fewest payments. It never suggests an extra hop.')
          : null,
        expenses.length
          ? h('div', { class: 'share-row' },
              button('Share read-only link', () => void shareLink(ctx), { icon: 'share-2', small: true, variant: 'primary', key: 'share-link' }),
              h('p', { class: 'hint' }, 'Friends see balances and the ledger, not anyone’s income. The data travels inside the link itself; nothing is uploaded.'),
            )
          : null,
        transfers.length
          ? h('div', { class: 'row' }, button('Copy for group chat', () => {
              const lines = [
                `Settling up (${m(spent)} shared)`,
                ...transfers.map((t) => `• ${nameOf(t.from)} → ${nameOf(t.to)}: ${m(t.amount)}`),
                '',
                ...members.map((p) => {
                  const sm = summary.get(p.id) as { paid: number; share: number } | undefined;
                  return sm ? `${p.name} paid ${m(sm.paid)}, share ${m(sm.share)}` : '';
                }).filter(Boolean),
              ].join('\n');
              void copyText(lines, 'Copied. Paste it into your group chat.');
            }, { icon: 'copy', small: true }))
          : null,
      ),
    ),
    // Ledger
    h(
      'div',
      { class: 'card table-wrap' },
      h('div', { class: 'card-head pad' }, h('h3', null, 'Ledger')),
      expenses.length || payments.length
        ? h(
            'table',
            { class: 'table' },
            h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'What'), h('th', null, 'Paid by'), h('th', { class: 'r' }, 'Amount'), h('th', null, 'Split'), h('th', { class: 'r' }, h('span', { class: 'sr-only' }, 'Actions')))),
            h(
              'tbody',
              null,
              [
                ...expenses.map((e) => ({ date: e.date, node: expenseRow(e) })),
                ...payments.map((p) => ({
                  date: p.date,
                  node: h('tr', { class: 'payment-row' },
                    h('td', { class: 'num', 'data-label': 'Date' }, formatDate(p.date)),
                    h('td', { 'data-label': 'What' }, icon('check', 14), ' Payment'),
                    h('td', { 'data-label': 'Paid by' }, `${nameOf(p.from)} → ${nameOf(p.to)}`),
                    h('td', { class: 'r num', 'data-label': 'Amount' }, m(p.amount)),
                    h('td', { 'data-label': 'Split' }, h('span', { class: 'muted' }, 'Settlement')),
                    h('td', { class: 'r actions' }, button('', () => {
                      store.update('Delete payment', (d) => { d.split.payments = d.split.payments.filter((x) => x.id !== p.id); });
                      toast('Deleted payment', { label: 'Undo', run: () => store.undo() });
                    }, { icon: 'trash', title: 'Delete payment', variant: 'quiet', small: true })),
                  ),
                })),
              ]
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((x) => x.node),
            ),
          )
        : empty('Nothing logged yet', 'Log the first shared expense and Tally will keep a running balance for everyone.'),
    ),
  );

  function expenseRow(e: Expense): HTMLElement {
    return h(
      'tr',
      null,
      h('td', { class: 'num', 'data-label': 'Date' }, formatDate(e.date)),
      h('td', { 'data-label': 'What' }, h('span', { class: 'strong' }, e.description)),
      h('td', { 'data-label': 'Paid by' }, nameOf(e.paidBy)),
      h(
        'td',
        { class: 'r', 'data-label': 'Amount' },
        h('span', { class: 'num strong' }, m(e.amount)),
        e.original ? h('span', { class: 'svc-meta' }, `${formatMoney(e.original.amount, e.original.currency)} @ ${e.original.rate}`) : null,
      ),
      h('td', { 'data-label': 'Split' }, SPLIT_LABEL[e.split.kind]),
      h(
        'td',
        { class: 'r actions' },
        button('', () => editExpense(ctx, e), { icon: 'pencil', title: `Edit ${e.description}`, variant: 'quiet', small: true }),
        button('', () => {
          store.update(`Delete ${e.description}`, (d) => { d.split.expenses = d.split.expenses.filter((x) => x.id !== e.id); });
          toast(`Deleted ${e.description}`, { label: 'Undo', run: () => store.undo() });
        }, { icon: 'trash', title: `Delete ${e.description}`, variant: 'quiet', small: true }),
      ),
    );
  }

  function addMemberForm(): HTMLElement {
    const form = h(
      'form',
      { class: 'add-member' },
      h('input', { name: 'name', placeholder: 'Name', required: true, 'aria-label': 'Name', autocomplete: 'off' }),
      h('input', { name: 'weight', inputMode: 'decimal', placeholder: 'Monthly income (optional)', 'aria-label': 'Monthly income, used for income-based splits' }),
      button('Add person', () => {}, { type: 'submit', icon: 'plus', small: true }),
    );
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const data = new FormData(form);
      const name = String(data.get('name')).trim();
      if (!name) return;
      if (members.some((x) => x.name.toLowerCase() === name.toLowerCase())) return toast(`${name} is already in the group.`);
      const w = Number(String(data.get('weight')).replace(/[^\d.]/g, ''));
      store.update(`Add ${name}`, (d) => { d.split.members.push({ id: uid(), name, weight: w > 0 ? w : 1 }); });
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.add-member input[name=name]')?.focus());
    });
    return form;
  }
}

function editMember(ctx: ViewContext, p: Member) {
  const used = ctx.state.split.expenses.some((e) => e.paidBy === p.id || JSON.stringify(e.split).includes(`"${p.id}"`)) ||
    ctx.state.split.payments.some((x) => x.from === p.id || x.to === p.id);
  openDialog({
    title: `Edit ${p.name}`,
    submitLabel: 'Save changes',
    body: () => h('div', { class: 'grid-form' },
      field('Name', h('input', { name: 'name', value: p.name, required: true })),
      field('Monthly income', h('input', { name: 'weight', inputMode: 'decimal', value: String(p.weight) }), 'Only the ratio between people matters. Used for “By income” splits.'),
    ),
    onSubmit: (data) => {
      const name = String(data.get('name')).trim();
      const w = Number(String(data.get('weight')).replace(/[^\d.]/g, ''));
      if (!name) return 'Enter a name.';
      if (!(w > 0)) return 'Income must be a positive number.';
      store.update(`Edit ${name}`, (d) => {
        const x = d.split.members.find((y) => y.id === p.id);
        if (x) Object.assign(x, { name, weight: w });
      });
    },
    extraActions: [button('Remove', () => {
      if (used) return toast(`${p.name} is part of logged expenses. Delete those first.`);
      document.querySelector<HTMLDialogElement>('dialog.dialog')?.close();
      store.update(`Remove ${p.name}`, (d) => { d.split.members = d.split.members.filter((y) => y.id !== p.id); });
      toast(`Removed ${p.name}`, { label: 'Undo', run: () => store.undo() });
    }, { variant: 'danger', icon: 'trash' })],
  });
}

async function fetchRate(from: string, to: string): Promise<number> {
  const urls = [
    `https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`,
    `https://api.frankfurter.app/latest?from=${from}&to=${to}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const json = (await res.json()) as { rates?: Record<string, number> };
      const r = json.rates?.[to];
      if (typeof r === 'number') return r;
    } catch {
      /* try next */
    }
  }
  throw new Error('offline');
}

export function editExpense(ctx: ViewContext, existing?: Expense) {
  const { members, currency: base } = ctx.state.split;
  if (members.length < 2) {
    toast('Add at least two people first.');
    return;
  }
  const all = members.map((x) => x.id);
  const e: Expense = existing ?? {
    id: uid(), description: '', date: ctx.today, paidBy: members[0]!.id, amount: 0,
    split: { kind: 'equal', among: all },
  };
  const origCur = e.original?.currency ?? base;
  const origAmt = e.original?.amount ?? e.amount;

  openDialog({
    title: existing ? `Edit ${existing.description}` : 'Log expense',
    submitLabel: existing ? 'Save changes' : 'Log expense',
    body: (form) => {
      const preview = h('ul', { class: 'share-preview', 'aria-live': 'polite' });
      const perPerson = h('div', { class: 'per-person' });
      const rateField = field(`Rate (1 ${origCur} = ? ${base})`, h('input', { name: 'rate', inputMode: 'decimal', value: String(e.original?.rate ?? 1) }));
      const fetchBtn = button('Use today’s rate', async () => {
        const cur = (form.elements.namedItem('currency') as HTMLSelectElement).value;
        try {
          const r = await fetchRate(cur, base);
          (form.elements.namedItem('rate') as HTMLInputElement).value = String(r);
          refresh();
        } catch {
          toast('Couldn’t reach the exchange-rate service. Enter the rate by hand.');
        }
      }, { small: true, icon: 'refresh-cw' });
      const rateRow = h('div', { class: 'pair align-end' }, rateField, fetchBtn);

      const kindSel = h('select', { name: 'kind' }, (Object.keys(SPLIT_LABEL) as SplitRule['kind'][]).map((k) => h('option', { value: k, selected: k === e.split.kind }, SPLIT_LABEL[k])));
      const existingVal = (id: string): string => {
        if (e.split.kind === 'shares') return String(e.split.shares[id] ?? 0);
        if (e.split.kind === 'exact') return toInputValue(e.split.amounts[id] ?? 0, base);
        if (e.split.kind === 'equal' || e.split.kind === 'weighted') return e.split.among.includes(id) ? '1' : '0';
        return '1';
      };

      const buildPerPerson = () => {
        const kind = kindSel.value as SplitRule['kind'];
        perPerson.replaceChildren(
          ...members.map((p) =>
            kind === 'equal' || kind === 'weighted'
              ? h('label', { class: 'check' }, h('input', { type: 'checkbox', name: `p-${p.id}`, checked: existingVal(p.id) !== '0' }), p.name,
                  kind === 'weighted' ? h('span', { class: 'svc-meta' }, `income ${p.weight}`) : null)
              : h('label', { class: 'field inline' }, h('span', { class: 'field-label' }, p.name),
                  h('input', { name: `p-${p.id}`, inputMode: 'decimal', value: kind === e.split.kind ? existingVal(p.id) : kind === 'shares' ? '1' : '' })),
          ),
        );
      };

      const refresh = () => {
        const cur = (form.elements.namedItem('currency') as HTMLSelectElement).value;
        rateRow.hidden = cur === base;
        rateField.querySelector('.field-label')!.textContent = `Rate (1 ${cur} = ? ${base})`;
        const built = readExpense(new FormData(form));
        if (typeof built === 'string') {
          preview.replaceChildren(h('li', { class: 'muted' }, built));
          return;
        }
        try {
          const s = shares(built, members);
          preview.replaceChildren(...[...s].map(([id, amt]) => h('li', null, h('span', null, members.find((x) => x.id === id)!.name), h('span', { class: 'num' }, formatMoney(amt, base)))));
        } catch (err) {
          preview.replaceChildren(h('li', { class: 'neg-text' }, err instanceof Error ? err.message.replace(/\d+/g, (d) => formatMoney(Number(d), base)) : ''));
        }
      };
      kindSel.addEventListener('change', () => { buildPerPerson(); refresh(); });
      form.addEventListener('input', refresh);
      buildPerPerson();
      queueMicrotask(refresh);

      return h('div', { class: 'grid-form' },
        field('What was it?', h('input', { name: 'description', required: true, value: e.description, placeholder: 'Cabin rental', autocomplete: 'off' })),
        h('div', { class: 'pair' },
          field('Amount', h('input', { name: 'amount', required: true, inputMode: 'decimal', value: origAmt ? toInputValue(origAmt, origCur) : '', placeholder: '120.00' })),
          field('Currency', h('select', { name: 'currency' }, [...new Set([base, ...CURRENCIES])].map((c) => h('option', { value: c, selected: c === origCur }, c)))),
        ),
        rateRow,
        h('div', { class: 'pair' },
          field('Paid by', h('select', { name: 'paidBy' }, members.map((p) => h('option', { value: p.id, selected: p.id === e.paidBy }, p.name)))),
          field('Date', h('input', { type: 'date', name: 'date', value: e.date, required: true })),
        ),
        field('Split', kindSel),
        perPerson,
        h('div', { class: 'preview-box' }, h('p', { class: 'eyebrow' }, 'Each person’s share'), preview),
      );
    },
    onSubmit: (data) => {
      const built = readExpense(data);
      if (typeof built === 'string') return built;
      try {
        shares(built, members);
      } catch (err) {
        return err instanceof Error ? 'The exact amounts must add up to the total.' : 'Invalid split.';
      }
      store.update(existing ? `Edit ${built.description}` : `Log ${built.description}`, (d) => {
        const i = d.split.expenses.findIndex((x) => x.id === built.id);
        if (i >= 0) d.split.expenses[i] = built;
        else d.split.expenses.push(built);
      });
      toast(existing ? `Saved ${built.description}` : `Logged ${built.description}`);
    },
  });

  function readExpense(data: FormData): Expense | string {
    const description = String(data.get('description') ?? '').trim() || 'Expense';
    const cur = String(data.get('currency'));
    const amt = parseMoney(String(data.get('amount') ?? ''), cur);
    if (amt === null || amt <= 0) return 'Enter an amount to see the split.';
    const rate = cur === base ? 1 : Number(data.get('rate'));
    if (!(rate > 0)) return 'Enter an exchange rate.';
    const amount = convert(amt, cur, base, rate);
    const kind = String(data.get('kind')) as SplitRule['kind'];
    const val = (id: string) => String(data.get(`p-${id}`) ?? '');
    let split: SplitRule;
    if (kind === 'equal' || kind === 'weighted') {
      const among = members.filter((p) => data.get(`p-${p.id}`) === 'on').map((p) => p.id);
      if (!among.length) return 'Pick at least one person to split with.';
      split = { kind, among };
    } else if (kind === 'shares') {
      const sh: Record<string, number> = {};
      for (const p of members) {
        const n = Number(val(p.id) || 0);
        if (n > 0) sh[p.id] = n;
      }
      if (!Object.keys(sh).length) return 'Give at least one person a share.';
      split = { kind, shares: sh };
    } else {
      const amounts: Record<string, number> = {};
      for (const p of members) {
        const v = parseMoney(val(p.id) || '0', base);
        if (v) amounts[p.id] = v;
      }
      split = { kind, amounts };
    }
    const exp: Expense = {
      id: e.id,
      description,
      date: String(data.get('date')),
      paidBy: String(data.get('paidBy')),
      amount,
      split,
    };
    if (cur !== base) exp.original = { currency: cur, amount: amt, rate };
    return exp;
  }
}

async function shareLink(ctx: ViewContext) {
  const token = await encodeShare(ctx.state.split, ctx.today);
  const url = `${location.origin}${location.pathname}#/shared/${token}`;
  if (url.length > SAFE_LINK_LENGTH) {
    toast(`This group is large, so the link is ${url.length.toLocaleString()} characters. Some chat apps may cut it off.`, undefined, 8000);
  }
  const people = ctx.state.split.members.map((m) => m.name).join(', ');
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title: 'Who owes whom', text: `Our shared costs (${people})`, url });
      return;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied. Anyone with it can view this group, read-only.', { label: 'Preview', run: () => { location.hash = `/shared/${token}`; } }, 8000);
  } catch {
    location.hash = `/shared/${token}`;
    toast('Copy the address from your browser bar to share this view.', undefined, 8000);
  }
}
