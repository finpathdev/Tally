import { type Minor, allocate } from './money.ts';
import type { ISODate } from './dates.ts';

export interface Member {
  id: string;
  name: string;
  /** Relative weight for income-proportional splits (e.g. monthly income). */
  weight: number;
}

export type SplitRule =
  | { kind: 'equal'; among: string[] }
  | { kind: 'weighted'; among: string[] }
  | { kind: 'shares'; shares: Record<string, number> }
  | { kind: 'exact'; amounts: Record<string, Minor> };

export interface Expense {
  id: string;
  description: string;
  date: ISODate;
  paidBy: string;
  /** Amount in the group's base currency (minor units). */
  amount: Minor;
  /** What was actually paid, if it was in another currency. */
  original?: { currency: string; amount: Minor; rate: number };
  split: SplitRule;
}

/** A recorded settle-up payment between two members. */
export interface Payment {
  id: string;
  from: string;
  to: string;
  amount: Minor;
  date: ISODate;
}

export interface Transfer {
  from: string;
  to: string;
  amount: Minor;
}

export class SplitError extends Error {}

/**
 * Who owes what for a single expense. Result always sums to exactly
 * `expense.amount` thanks to largest-remainder allocation.
 */
export function shares(expense: Expense, members: readonly Member[]): Map<string, Minor> {
  const known = new Set(members.map((m) => m.id));
  const rule = expense.split;
  const out = new Map<string, Minor>();

  if (rule.kind === 'exact') {
    let total = 0;
    for (const [id, amt] of Object.entries(rule.amounts)) {
      if (!known.has(id)) continue;
      out.set(id, amt);
      total += amt;
    }
    if (total !== expense.amount) {
      throw new SplitError(`Exact split adds up to ${total}, expected ${expense.amount}`);
    }
    return out;
  }

  let ids: string[];
  let weights: number[];
  if (rule.kind === 'shares') {
    ids = Object.keys(rule.shares).filter((id) => known.has(id) && (rule.shares[id] ?? 0) > 0);
    weights = ids.map((id) => rule.shares[id]!);
  } else {
    ids = rule.among.filter((id) => known.has(id));
    weights =
      rule.kind === 'weighted' ? ids.map((id) => members.find((m) => m.id === id)!.weight) : ids.map(() => 1);
  }
  if (ids.length === 0) throw new SplitError('Split has no participants');

  allocate(expense.amount, weights).forEach((amt, i) => out.set(ids[i]!, amt));
  return out;
}

/**
 * Net position of every member: positive = is owed money, negative = owes.
 * Balances always sum to zero.
 */
export function balances(
  members: readonly Member[],
  expenses: readonly Expense[],
  payments: readonly Payment[] = [],
): Map<string, Minor> {
  const bal = new Map<string, Minor>(members.map((m) => [m.id, 0]));
  const add = (id: string, delta: Minor) => {
    if (bal.has(id)) bal.set(id, bal.get(id)! + delta);
  };

  for (const e of expenses) {
    if (!bal.has(e.paidBy)) continue;
    add(e.paidBy, e.amount);
    for (const [id, owed] of shares(e, members)) add(id, -owed);
  }
  for (const p of payments) {
    add(p.from, p.amount);
    add(p.to, -p.amount);
  }
  return bal;
}

/** Settle one zero-sum group with at most (size - 1) transfers. */
function settleGroup(entries: [string, Minor][]): Transfer[] {
  const debtors = entries.filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v }));
  const creditors = entries.filter(([, v]) => v > 0).map(([id, v]) => ({ id, v }));
  debtors.sort((a, b) => b.v - a.v || a.id.localeCompare(b.id));
  creditors.sort((a, b) => b.v - a.v || a.id.localeCompare(b.id));

  const out: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i]!;
    const c = creditors[j]!;
    const amt = Math.min(d.v, c.v);
    out.push({ from: d.id, to: c.id, amount: amt });
    d.v -= amt;
    c.v -= amt;
    if (d.v === 0) i++;
    if (c.v === 0) j++;
  }
  return out;
}

/** Above this many non-zero balances we fall back to the greedy heuristic. */
export const OPTIMAL_LIMIT = 16;

/**
 * Minimum number of transfers that settles every balance.
 *
 * A group of n people with non-zero balances can always be settled in n − 1
 * transfers, but if the people split into k sub-groups that each sum to zero,
 * n − k is enough. Finding the largest such partition is NP-hard in general,
 * so for up to OPTIMAL_LIMIT people we solve it exactly with a DP over
 * subsets (O(2ⁿ·n)); beyond that, a greedy largest-first match is used.
 *
 * The plain "match biggest debtor with biggest creditor" approach the
 * original project used is not optimal: balances {A:-5, B:-5, C:+5, D:+5}
 * might pair across groups and need 3 transfers instead of 2.
 */
export function simplify(bal: ReadonlyMap<string, Minor>): Transfer[] {
  const entries = [...bal.entries()].filter(([, v]) => v !== 0).sort((a, b) => a[0].localeCompare(b[0]));
  const n = entries.length;
  if (n === 0) return [];
  if (n > OPTIMAL_LIMIT) return settleGroup(entries);

  const full = (1 << n) - 1;
  const sum = new Array<number>(full + 1).fill(0);
  for (let mask = 1; mask <= full; mask++) {
    const low = mask & -mask;
    const bit = 31 - Math.clz32(low);
    sum[mask] = sum[mask ^ low]! + entries[bit]![1];
  }

  // dp[mask] = max number of zero-sum groups the members in `mask` can form.
  const dp = new Int8Array(full + 1);
  const drop = new Int8Array(full + 1);
  for (let mask = 1; mask <= full; mask++) {
    let best = -1;
    let bestBit = 0;
    for (let b = 0; b < n; b++) {
      if (mask & (1 << b) && dp[mask ^ (1 << b)]! > best) {
        best = dp[mask ^ (1 << b)]!;
        bestBit = b;
      }
    }
    dp[mask] = best + (sum[mask] === 0 ? 1 : 0);
    drop[mask] = bestBit;
  }

  // Walk the removal chain; each stretch between zero-sum masks is a group.
  const transfers: Transfer[] = [];
  let group: [string, Minor][] = [];
  for (let mask = full; mask; ) {
    const b = drop[mask]!;
    group.push(entries[b]!);
    mask ^= 1 << b;
    if (sum[mask] === 0) {
      transfers.push(...settleGroup(group));
      group = [];
    }
  }
  return transfers;
}

/** Totals per member: what they paid and what their fair share was. */
export function memberSummary(
  members: readonly Member[],
  expenses: readonly Expense[],
): Map<string, { paid: Minor; share: Minor }> {
  const out = new Map(members.map((m) => [m.id, { paid: 0, share: 0 }]));
  for (const e of expenses) {
    const p = out.get(e.paidBy);
    if (p) p.paid += e.amount;
    for (const [id, amt] of shares(e, members)) {
      const s = out.get(id);
      if (s) s.share += amt;
    }
  }
  return out;
}
