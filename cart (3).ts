import type { Minor } from './money.ts';

export interface CartItem {
  id: string;
  name: string;
  unitPrice: Minor;
  qty: number;
  taxable: boolean;
  /** Tick items off as they go in the basket. */
  inBasket: boolean;
}

export interface CartTotals {
  subtotal: Minor;
  taxableSubtotal: Minor;
  tax: Minor;
  total: Minor;
  basketTotal: Minor;
  itemCount: number;
}

/** Tax rate stored as basis points: 825 = 8.25%. Avoids float percentages. */
export function taxOn(amount: Minor, rateBps: number): Minor {
  // Round half up, which is what most US point-of-sale systems do.
  return Math.floor((amount * rateBps + 5_000) / 10_000);
}

export const lineTotal = (item: CartItem): Minor => item.unitPrice * item.qty;

export function cartTotals(items: readonly CartItem[], rateBps: number): CartTotals {
  let subtotal = 0;
  let taxableSubtotal = 0;
  let basketPre = 0;
  let basketTaxable = 0;
  let itemCount = 0;
  for (const it of items) {
    const line = lineTotal(it);
    subtotal += line;
    itemCount += it.qty;
    if (it.taxable) taxableSubtotal += line;
    if (it.inBasket) {
      basketPre += line;
      if (it.taxable) basketTaxable += line;
    }
  }
  const tax = taxOn(taxableSubtotal, rateBps);
  return {
    subtotal,
    taxableSubtotal,
    tax,
    total: subtotal + tax,
    basketTotal: basketPre + taxOn(basketTaxable, rateBps),
    itemCount,
  };
}

export type BudgetLevel = 'ok' | 'warn' | 'over';

export function budgetStatus(total: Minor, budget: Minor): { level: BudgetLevel; pct: number; remaining: Minor } {
  const pct = budget > 0 ? total / budget : total > 0 ? Infinity : 0;
  const level: BudgetLevel = total > budget ? 'over' : pct >= 0.8 ? 'warn' : 'ok';
  return { level, pct, remaining: budget - total };
}

/**
 * Which items to drop to get back under budget: the fewest taxable-inclusive
 * dollars removed that clears the overage, preferring items not yet in the
 * basket. Simple greedy by line cost; good enough for a shopping list.
 */
export function suggestCuts(items: readonly CartItem[], rateBps: number, budget: Minor): CartItem[] {
  let over = cartTotals(items, rateBps).total - budget;
  if (over <= 0) return [];
  const costWithTax = (it: CartItem) => lineTotal(it) + (it.taxable ? taxOn(lineTotal(it), rateBps) : 0);
  const candidates = items
    .filter((it) => !it.inBasket)
    .sort((a, b) => costWithTax(b) - costWithTax(a));
  // Prefer the single smallest item that clears the gap, else accumulate largest-first.
  const single = [...candidates].reverse().find((it) => costWithTax(it) >= over);
  if (single) return [single];
  const cuts: CartItem[] = [];
  for (const it of candidates) {
    if (over <= 0) break;
    cuts.push(it);
    over -= costWithTax(it);
  }
  return over <= 0 ? cuts : [];
}
