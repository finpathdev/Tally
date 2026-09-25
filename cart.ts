import { budgetStatus, cartTotals, lineTotal, suggestCuts } from '../lib/cart.ts';
import { parseMoney, toInputValue } from '../lib/money.ts';
import { uid } from '../lib/schema.ts';
import { store } from '../store.ts';
import { button, empty, h, icon, toast } from '../ui/dom.ts';
import type { ViewContext } from './context.ts';
import { helpTip } from './help.ts';

export function cartView(ctx: ViewContext): HTMLElement {
  const { state, money } = ctx;
  const { items, taxRateBps, budget } = state.cart;
  const cur = state.settings.currency;
  const t = cartTotals(items, taxRateBps);
  const b = budgetStatus(t.total, budget);
  const cuts = b.level === 'over' ? suggestCuts(items, taxRateBps, budget) : [];
  const basketPct = budget > 0 ? Math.min(100, (t.basketTotal / budget) * 100) : 0;
  const plannedPct = budget > 0 ? Math.min(100, (t.total / budget) * 100) : 100;

  const setItem = (id: string, label: string | null, fn: (it: (typeof items)[number]) => void) =>
    store.update(label, (d) => {
      const it = d.cart.items.find((x) => x.id === id);
      if (it) fn(it);
    });

  return h(
    'section',
    { class: 'view', 'aria-labelledby': 'cart-title' },
    h(
      'div',
      { class: 'toolbar' },
      h('h2', { id: 'cart-title', class: 'section-title' }, 'Cart'),
      h('p', { class: 'muted' }, 'Know the real total, tax included, before you reach the register.'),
    ),
    h(
      'div',
      { class: ['card', 'budget', `lvl-${b.level}`] },
      h(
        'div',
        { class: 'budget-top' },
        h(
          'div',
          null,
          h('p', { class: 'eyebrow' }, 'Estimated at checkout'),
          h('p', { class: 'figure sm' }, money(t.total)),
          h(
            'p',
            { class: 'budget-msg', role: 'status' },
            b.level === 'over'
              ? `${money(-b.remaining)} over budget`
              : `${money(b.remaining)} left of ${money(budget)}`,
          ),
        ),
        h(
          'dl',
          { class: 'receipt' },
          h('dt', null, 'Subtotal'), h('dd', { class: 'num' }, money(t.subtotal)),
          h('dt', null, `Tax on ${money(t.taxableSubtotal)}`), h('dd', { class: 'num' }, money(t.tax)),
          h('dt', null, 'In basket so far'), h('dd', { class: 'num' }, money(t.basketTotal)),
        ),
        h(
          'div',
          { class: 'budget-controls' },
          h('label', { class: 'inline-field' }, 'Budget',
            h('input', {
              inputMode: 'decimal', value: toInputValue(budget, cur), class: 'num', size: 7,
              dataset: { key: 'budget' },
              onChange: (e: Event) => {
                const v = parseMoney((e.target as HTMLInputElement).value, cur);
                if (v === null || v < 0) return toast('Enter a budget like 120.00');
                store.update('Change budget', (d) => { d.cart.budget = v; });
              },
            })),
          h('span', { class: 'tip-wrap' }, helpTip('sales-tax')), h('label', { class: 'inline-field' }, 'Sales tax %',
            h('input', {
              inputMode: 'decimal', value: (taxRateBps / 100).toString(), class: 'num', size: 5,
              dataset: { key: 'tax' },
              onChange: (e: Event) => {
                const v = Number((e.target as HTMLInputElement).value);
                if (!(v >= 0 && v <= 30)) return toast('Enter a tax rate between 0 and 30.');
                store.update('Change tax rate', (d) => { d.cart.taxRateBps = Math.round(v * 100); });
              },
            })),
        ),
      ),
      h(
        'div',
        { class: 'meter-bar', role: 'img', 'aria-label': `${Math.round(b.pct * 100)}% of budget planned, ${Math.round(basketPct)}% already in basket` },
        h('span', { class: 'planned', style: { width: `${plannedPct}%` } }),
        h('span', { class: 'basket', style: { width: `${basketPct}%` } }),
      ),
      cuts.length
        ? h(
            'p',
            { class: 'cut-hint' },
            icon('sparkles', 16),
            ` Leave out ${cuts.map((c) => c.name).join(', ')} to get back under budget. `,
            button(cuts.length === 1 ? 'Remove it' : 'Remove them', () => {
              const ids = new Set(cuts.map((c) => c.id));
              store.update('Remove suggested items', (d) => { d.cart.items = d.cart.items.filter((x) => !ids.has(x.id)); });
              toast('Removed. You’re back under budget.', { label: 'Undo', run: () => store.undo() });
            }, { small: true, variant: 'quiet' }),
          )
        : null,
    ),
    h(
      'div',
      { class: 'card' },
      quickAdd(),
      items.length
        ? h(
            'ul',
            { class: 'cart-list' },
            items.map((it) =>
              h(
                'li',
                { class: it.inBasket ? 'in' : '' },
                h('label', { class: 'basket-check' },
                  h('input', {
                    type: 'checkbox', checked: it.inBasket, dataset: { key: `in-${it.id}` },
                    onChange: () => setItem(it.id, null, (x) => { x.inBasket = !x.inBasket; }),
                  }),
                  h('span', { class: 'sr-only' }, `${it.name} is in the basket`),
                ),
                h('span', { class: 'item-name' }, it.name, h('span', { class: 'svc-meta' }, `${money(it.unitPrice)} each`)),
                h(
                  'span',
                  { class: 'stepper' },
                  button('', () => (it.qty > 1 ? setItem(it.id, null, (x) => { x.qty -= 1; }) : remove(it.id, it.name)), { icon: 'minus', title: `One fewer ${it.name}`, variant: 'quiet', small: true, key: `dec-${it.id}` }),
                  h('span', { class: 'num qty', 'aria-label': `Quantity ${it.qty}` }, String(it.qty)),
                  button('', () => setItem(it.id, null, (x) => { x.qty += 1; }), { icon: 'plus', title: `One more ${it.name}`, variant: 'quiet', small: true, key: `inc-${it.id}` }),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    class: ['tax-toggle', it.taxable && 'on'],
                    'aria-pressed': String(it.taxable),
                    title: it.taxable ? 'Taxed. Click to mark exempt.' : 'Exempt. Click to mark taxable.',
                    dataset: { key: `tax-${it.id}` },
                    onClick: () => setItem(it.id, 'Toggle tax', (x) => { x.taxable = !x.taxable; }),
                  },
                  it.taxable ? 'Taxed' : 'No tax',
                ),
                h('span', { class: 'num strong line' }, money(lineTotal(it))),
                button('', () => remove(it.id, it.name), { icon: 'x', title: `Remove ${it.name}`, variant: 'quiet', small: true }),
              ),
            ),
          )
        : empty('Your cart is empty', 'Add what you plan to buy. Tick items off as they go in the basket.'),
      items.length
        ? h('div', { class: 'row end' }, button('Clear cart', () => {
            store.update('Clear cart', (d) => { d.cart.items = []; });
            toast('Cleared cart', { label: 'Undo', run: () => store.undo() });
          }, { variant: 'quiet', small: true, icon: 'trash' }))
        : null,
    ),
  );

  function remove(id: string, name: string) {
    store.update(`Remove ${name}`, (d) => { d.cart.items = d.cart.items.filter((x) => x.id !== id); });
    toast(`Removed ${name}`, { label: 'Undo', run: () => store.undo() });
  }

  function quickAdd(): HTMLElement {
    const form = h(
      'form',
      { class: 'quick-add' },
      h('input', { name: 'name', placeholder: 'Item', required: true, 'aria-label': 'Item name', autocomplete: 'off' }),
      h('input', { name: 'price', placeholder: 'Price', required: true, inputMode: 'decimal', 'aria-label': 'Price each', class: 'num' }),
      h('input', { name: 'qty', type: 'number', min: 1, value: 1, 'aria-label': 'Quantity', class: 'num qty-in' }),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'taxable', checked: true }), 'Taxable'),
      button('Add', () => {}, { type: 'submit', variant: 'primary', icon: 'plus', small: true }),
    );
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const d = new FormData(form);
      const name = String(d.get('name')).trim();
      const price = parseMoney(String(d.get('price')), cur);
      const qty = Math.max(1, Math.floor(Number(d.get('qty')) || 1));
      if (!name) return;
      if (price === null || price < 0) return toast('Enter a price like 3.49');
      store.update(`Add ${name}`, (s) => {
        s.cart.items.push({ id: uid(), name, unitPrice: price, qty, taxable: d.get('taxable') === 'on', inBasket: false });
      });
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.quick-add input[name=name]')?.focus());
    });
    return form;
  }
}
