import { type Cycle, type ISODate, daysBetween, nextOccurrence, occurrencesBetween } from './dates.ts';
import type { Minor } from './money.ts';

export type Usage = 'daily' | 'weekly' | 'monthly' | 'rarely' | 'never';
export type SubStatus = 'active' | 'trial' | 'paused';

export const CATEGORIES = [
  'Entertainment',
  'Developer Tools',
  'Productivity',
  'Health & Fitness',
  'Utilities',
  'News & Learning',
  'Shopping',
  'Other',
] as const;

export interface Subscription {
  id: string;
  name: string;
  /** Price per billing cycle, in minor units of the app currency. */
  amount: Minor;
  cycle: Cycle;
  /** Any known billing date. Future renewals are derived from it. */
  anchor: ISODate;
  category: string;
  /** Days before renewal to raise an alert. */
  leadDays: number;
  status: SubStatus;
  usage: Usage;
  trialEnds?: ISODate;
  url?: string;
  notes?: string;
  /** Earlier prices, oldest first: the amount that applied until `until`. */
  history?: PricePoint[];
}

export interface PricePoint {
  amount: Minor;
  until: ISODate;
}

/** How many times per month a usage level implies, for cost-per-use. */
const USES_PER_MONTH: Record<Usage, number> = {
  daily: 30,
  weekly: 4.33,
  monthly: 1,
  rarely: 0.25,
  never: 0,
};

const CYCLES_PER_YEAR: Record<Cycle, number> = { weekly: 52, monthly: 12, quarterly: 4, annual: 1 };

export function annualCost(sub: Pick<Subscription, 'amount' | 'cycle'>): Minor {
  return sub.amount * CYCLES_PER_YEAR[sub.cycle];
}

export function monthlyCost(sub: Pick<Subscription, 'amount' | 'cycle'>): Minor {
  return Math.round(annualCost(sub) / 12);
}

export const isBilling = (s: Subscription): boolean => s.status !== 'paused';

export function nextRenewal(sub: Subscription, on: ISODate): ISODate {
  return nextOccurrence(sub.anchor, sub.cycle, on);
}

export interface Totals {
  monthly: Minor;
  annual: Minor;
  count: number;
}

export function totals(subs: readonly Subscription[]): Totals {
  const billing = subs.filter(isBilling);
  const annual = billing.reduce((a, s) => a + annualCost(s), 0);
  return { annual, monthly: Math.round(annual / 12), count: billing.length };
}

export interface Upcoming {
  sub: Subscription;
  date: ISODate;
  daysAway: number;
}

/** Renewals within the next `withinDays` days (inclusive), soonest first. */
export function upcoming(subs: readonly Subscription[], on: ISODate, withinDays: number): Upcoming[] {
  return subs
    .filter(isBilling)
    .map((sub) => {
      const date = nextRenewal(sub, on);
      return { sub, date, daysAway: daysBetween(on, date) };
    })
    .filter((u) => u.daysAway <= withinDays)
    .sort((a, b) => a.daysAway - b.daysAway || a.sub.name.localeCompare(b.sub.name));
}

/**
 * Subscriptions whose alert window is open today: the renewal (or trial end)
 * is within `leadDays`. Used by both the dashboard and the GitHub Action.
 */
export function dueForAlert(subs: readonly Subscription[], on: ISODate): Upcoming[] {
  const out: Upcoming[] = [];
  for (const sub of subs) {
    if (!isBilling(sub)) continue;
    if (sub.status === 'trial' && sub.trialEnds && sub.trialEnds >= on) {
      const daysAway = daysBetween(on, sub.trialEnds);
      if (daysAway <= sub.leadDays) out.push({ sub, date: sub.trialEnds, daysAway });
      continue;
    }
    const date = nextRenewal(sub, on);
    const daysAway = daysBetween(on, date);
    if (daysAway <= sub.leadDays) out.push({ sub, date, daysAway });
  }
  return out.sort((a, b) => a.daysAway - b.daysAway);
}

export interface CalendarEntry {
  sub: Subscription;
  date: ISODate;
}

export function renewalsBetween(subs: readonly Subscription[], start: ISODate, end: ISODate): CalendarEntry[] {
  return subs
    .filter(isBilling)
    .flatMap((sub) => occurrencesBetween(sub.anchor, sub.cycle, start, end).map((date) => ({ sub, date })))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export type FlagKind = 'high-cost' | 'unused' | 'low-value' | 'trial-ending' | 'annual-soon' | 'price-up';

export interface Flag {
  kind: FlagKind;
  label: string;
  detail: string;
  severity: 1 | 2 | 3;
}

export interface AuditOptions {
  /** Monthly-equivalent cost above which something is "high cost". */
  highCost: Minor;
  /** Cost per use above which value is questionable. */
  costPerUse: Minor;
}

export const DEFAULT_AUDIT: AuditOptions = { highCost: 2000, costPerUse: 1000 };

/** Estimated cost of each use, or null if the service is never used. */
export function costPerUse(sub: Subscription): Minor | null {
  const uses = USES_PER_MONTH[sub.usage];
  return uses > 0 ? Math.round(monthlyCost(sub) / uses) : null;
}

/**
 * Explainable audit: every flag says *why*, instead of a single opaque
 * "risk" boolean.
 */
export function audit(sub: Subscription, on: ISODate, opts: AuditOptions = DEFAULT_AUDIT): Flag[] {
  if (!isBilling(sub)) return [];
  const flags: Flag[] = [];
  const monthly = monthlyCost(sub);

  if (sub.usage === 'never') {
    flags.push({ kind: 'unused', label: 'Unused', detail: 'Marked as never used', severity: 3 });
  } else {
    const cpu = costPerUse(sub);
    if (cpu !== null && cpu > opts.costPerUse) {
      flags.push({ kind: 'low-value', label: 'Low value', detail: 'High cost per use', severity: 2 });
    }
  }
  const change = priceChange(sub);
  if (change && change.pct > 0 && daysBetween(change.since, on) <= 180) {
    flags.push({ kind: 'price-up', label: `Up ${Math.round(change.pct * 100)}%`, detail: `Price went up on ${change.since}`, severity: 2 });
  }
  if (monthly >= opts.highCost) {
    flags.push({ kind: 'high-cost', label: 'High cost', detail: 'Above your monthly threshold', severity: 1 });
  }
  if (sub.status === 'trial' && sub.trialEnds) {
    const d = daysBetween(on, sub.trialEnds);
    if (d >= 0 && d <= Math.max(sub.leadDays, 3)) {
      flags.push({ kind: 'trial-ending', label: 'Trial ending', detail: 'Converts to paid soon', severity: 3 });
    }
  }
  if (sub.cycle === 'annual') {
    const d = daysBetween(on, nextRenewal(sub, on));
    if (d <= 30) {
      flags.push({ kind: 'annual-soon', label: 'Annual renewal', detail: 'Large charge within 30 days', severity: 2 });
    }
  }
  return flags.sort((a, b) => b.severity - a.severity);
}

export interface SavingsPlan {
  monthly: Minor;
  annual: Minor;
  /** Money you'd have by the horizon if the savings were set aside. */
  horizon: Minor;
}

export function savings(subs: readonly Subscription[], cancelIds: ReadonlySet<string>, years = 5): SavingsPlan {
  const annual = subs.filter((s) => isBilling(s) && cancelIds.has(s.id)).reduce((a, s) => a + annualCost(s), 0);
  return { annual, monthly: Math.round(annual / 12), horizon: annual * years };
}

export function byCategory(subs: readonly Subscription[]): { category: string; monthly: Minor }[] {
  const map = new Map<string, Minor>();
  for (const s of subs.filter(isBilling)) map.set(s.category, (map.get(s.category) ?? 0) + monthlyCost(s));
  return [...map.entries()]
    .map(([category, monthly]) => ({ category, monthly }))
    .sort((a, b) => b.monthly - a.monthly);
}

export const trialDaysLeft = (sub: Subscription, on: ISODate): number | null =>
  sub.status === 'trial' && sub.trialEnds ? daysBetween(on, sub.trialEnds) : null;


/** Most recent price change, if any. */
export function priceChange(sub: Subscription): { from: Minor; pct: number; since: ISODate } | null {
  const last = sub.history?.at(-1);
  if (!last || last.amount === sub.amount || last.amount <= 0) return null;
  return { from: last.amount, pct: (sub.amount - last.amount) / last.amount, since: last.until };
}

/** Record a price change on edit. Returns the history to store. */
export function withPriceChange(prev: Subscription, nextAmount: Minor, on: ISODate): PricePoint[] | undefined {
  if (prev.amount === nextAmount || prev.amount <= 0) return prev.history;
  return [...(prev.history ?? []), { amount: prev.amount, until: on }].slice(-12);
}

export interface MonthForecast {
  /** "2026-10" */
  month: string;
  total: Minor;
  charges: number;
}

/**
 * What will actually leave your account each month for the next `months`
 * months. Unlike the smoothed monthly average, this shows the lumpy months
 * where annual renewals land.
 */
export function forecast(subs: readonly Subscription[], from: ISODate, months = 12): MonthForecast[] {
  const [y, m] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
  const out: MonthForecast[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    const start = d.toISOString().slice(0, 10);
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    const entries = renewalsBetween(subs, i === 0 ? from : start, end);
    out.push({ month: start.slice(0, 7), total: entries.reduce((a, e) => a + e.sub.amount, 0), charges: entries.length });
  }
  return out;
}
