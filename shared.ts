import { formatDate } from '../lib/dates.ts';
import { formatMoney } from '../lib/money.ts';
import { balances, simplify } from '../lib/settle.ts';
import { type SharedSplit, ShareError, decodeShare } from '../lib/share.ts';
import { store } from '../store.ts';
import { button, confirmDialog, empty, h, icon, toast } from '../ui/dom.ts';
import type { ViewContext } from './context.ts';

/** Decoded once per link; re-renders reuse it. */
const cache = new Map<string, Promise<SharedSplit>>();

export function sharedView(ctx: ViewContext, token: string): HTMLElement {
  const root = h('section', { class: 'view', 'aria-labelledby': 'shared-title', 'aria-busy': 'true' },
    h('h2', { id: 'shared-title', class: 'section-title' }, 'Shared split'),
    h('p', { class: 'muted' }, 'Opening the link…'),
  );
  if (!cache.has(token)) cache.set(token, decodeShare(token));
  cache.get(token)!.then(
    (data) => root.replaceChildren(...content(ctx, data)),
    (e) => root.replaceChildren(
      h('h2', { id: 'shared-title', class: 'section-title' }, 'Shared split'),
      empty('Can’t open this link', e instanceof ShareError ? e.message : 'This link is damaged.', button('Go to my Tally', () => ctx.go('split'), { variant: 'primary' })),
    ),
  ).finally(() => root.removeAttribute('aria-busy'));
  return root;
}

function content(ctx: ViewContext, data: SharedSplit): HTMLElement[] {
  const { split } = data;
  const m = (x: number) => formatMoney(x, split.currency);
  const name = (id: string) => split.members.find((p) => p.id === id)?.name ?? 'Someone';
  const bal = balances(split.members, split.expenses, split.payments);
  const transfers = simplify(bal);
  const total = split.expenses.reduce((a, e) => a + e.amount, 0);

  return [
    h('div', { class: 'banner shared-banner', role: 'note' },
      icon('eye', 17),
      h('span', null, `Read-only view shared on ${formatDate(data.sharedOn, undefined, { year: 'numeric' })}. Nothing here is saved unless you choose to.`),
      h('span', { class: 'spacer' }),
      button('Save a copy to my Tally', async () => {
        const ok = await confirmDialog(
          'Replace your Split data with this group?',
          `Your current group (${ctx.state.split.members.length} people, ${ctx.state.split.expenses.length} expenses) is replaced by this one. Subscriptions and your cart aren’t touched. You can undo right after.`,
          'Save a copy',
        );
        if (!ok) return;
        store.update('Save shared split', (d) => { d.split = structuredClone(split); });
        location.hash = '/split';
        toast('Saved. This group is now in your Split tab.', { label: 'Undo', run: () => store.undo() });
      }, { small: true, variant: 'primary', icon: 'download' }),
    ),
    h('div', { class: 'toolbar' },
      h('h2', { id: 'shared-title', class: 'section-title' }, 'Who owes whom'),
      h('p', { class: 'muted' }, `${split.members.map((p) => p.name).join(', ')} · ${m(total)} shared`),
    ),
    h('div', { class: 'split-grid' },
      h('div', { class: 'card settle' },
        h('div', { class: 'card-head' }, h('h3', null, 'Settle up'), transfers.length ? h('span', { class: 'muted' }, `${transfers.length} ${transfers.length === 1 ? 'payment' : 'payments'}`) : null),
        transfers.length
          ? h('ol', { class: 'transfers' }, transfers.map((t) => h('li', null,
              h('span', { class: 'strong' }, name(t.from)), icon('arrow-right', 16), h('span', { class: 'strong' }, name(t.to)),
              h('span', { class: 'num amount' }, m(t.amount)))))
          : h('div', { class: 'settled' }, icon('circle-check', 22), h('p', null, 'Everyone is square.')),
      ),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h3', null, 'Balances')),
        h('ul', { class: 'balances compact' }, split.members.map((p) => {
          const v = bal.get(p.id) ?? 0;
          return h('li', null,
            h('span', { class: 'person' }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, p.name.slice(0, 1).toUpperCase()), h('span', { class: 'person-name' }, p.name)),
            h('span', { class: ['num', 'bal-num', v > 0 ? 'pos-text' : v < 0 ? 'neg-text' : 'muted'] }, v === 0 ? 'settled' : v > 0 ? `gets back ${m(v)}` : `owes ${m(-v)}`),
          );
        })),
      ),
    ),
    h('div', { class: 'card table-wrap' },
      h('div', { class: 'card-head pad' }, h('h3', null, 'Ledger')),
      split.expenses.length || split.payments.length
        ? h('table', { class: 'table' },
            h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'What'), h('th', null, 'Paid by'), h('th', { class: 'r' }, 'Amount'))),
            h('tbody', null, [
              ...split.expenses.map((e) => ({ d: e.date, row: h('tr', null,
                h('td', { class: 'num', 'data-label': 'Date' }, formatDate(e.date)),
                h('td', { 'data-label': 'What' }, h('span', { class: 'strong' }, e.description)),
                h('td', { 'data-label': 'Paid by' }, name(e.paidBy)),
                h('td', { class: 'r num', 'data-label': 'Amount' }, m(e.amount))) })),
              ...split.payments.map((p) => ({ d: p.date, row: h('tr', { class: 'payment-row' },
                h('td', { class: 'num', 'data-label': 'Date' }, formatDate(p.date)),
                h('td', { 'data-label': 'What' }, 'Payment'),
                h('td', { 'data-label': 'Paid by' }, `${name(p.from)} → ${name(p.to)}`),
                h('td', { class: 'r num', 'data-label': 'Amount' }, m(p.amount))) })),
            ].sort((a, b) => b.d.localeCompare(a.d)).map((x) => x.row)))
        : empty('No expenses yet', 'The person who shared this hasn’t logged anything.'),
    ),
  ];
}
