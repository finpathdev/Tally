import { describe, expect, it } from 'vitest';
import { type CartItem, budgetStatus, cartTotals, suggestCuts, taxOn } from '../src/lib/cart.ts';

const item = (p: Partial<CartItem>): CartItem => ({
  id: p.name ?? 'i', name: 'Item', unitPrice: 100, qty: 1, taxable: true, inBasket: false, ...p,
});

describe('cart', () => {
  it('taxes only taxable lines, rounding half up', () => {
    expect(taxOn(1000, 825)).toBe(83); // 82.5 → 83
    expect(taxOn(899, 825)).toBe(74); // 74.17
    const t = cartTotals([item({ unitPrice: 429, taxable: false }), item({ unitPrice: 899 }), item({ unitPrice: 350, qty: 2, taxable: false })], 825);
    expect(t).toMatchObject({ subtotal: 2028, taxableSubtotal: 899, tax: 74, total: 2102, itemCount: 4 });
  });

  it('tracks what is already in the basket', () => {
    const t = cartTotals([item({ unitPrice: 1000, inBasket: true }), item({ unitPrice: 500 })], 1000);
    expect(t.basketTotal).toBe(1100);
  });

  it('reports budget levels', () => {
    expect(budgetStatus(5000, 10000).level).toBe('ok');
    expect(budgetStatus(8500, 10000).level).toBe('warn');
    expect(budgetStatus(10001, 10000)).toMatchObject({ level: 'over', remaining: -1 });
  });

  it('suggests the smallest single cut that fixes an overage', () => {
    const items = [item({ name: 'a', unitPrice: 5000, taxable: false }), item({ name: 'b', unitPrice: 800, taxable: false }), item({ name: 'c', unitPrice: 300, taxable: false })];
    expect(suggestCuts(items, 0, 5600).map((i) => i.name)).toEqual(['b']);
    expect(suggestCuts(items, 0, 10000)).toEqual([]);
  });
});
