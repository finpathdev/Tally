import { describe, expect, it } from 'vitest';
import type { Subscription } from '../src/lib/subscriptions.ts';
import {
  annualCost,
  audit,
  byCategory,
  costPerUse,
  dueForAlert,
  monthlyCost,
  renewalsBetween,
  savings,
  totals,
  upcoming,
} from '../src/lib/subscriptions.ts';

const ON = '2026-09-23';
const sub = (p: Partial<Subscription>): Subscription => ({
  id: p.name ?? 'id',
  name: 'Svc',
  amount: 1000,
  cycle: 'monthly',
  anchor: '2026-10-01',
  category: 'Other',
  leadDays: 3,
  status: 'active',
  usage: 'weekly',
  ...p,
});

describe('costs', () => {
  it('normalises every cycle', () => {
    expect(annualCost(sub({ amount: 1000, cycle: 'weekly' }))).toBe(52000);
    expect(monthlyCost(sub({ amount: 12000, cycle: 'annual' }))).toBe(1000);
    expect(monthlyCost(sub({ amount: 3000, cycle: 'quarterly' }))).toBe(1000);
  });

  it('totals exclude paused subscriptions', () => {
    const t = totals([sub({ amount: 1000 }), sub({ amount: 5000, status: 'paused' })]);
    expect(t).toEqual({ monthly: 1000, annual: 12000, count: 1 });
  });

  it('computes cost per use', () => {
    expect(costPerUse(sub({ amount: 4500, usage: 'rarely' }))).toBe(18000);
    expect(costPerUse(sub({ usage: 'never' }))).toBeNull();
  });

  it('groups by category, largest first', () => {
    const cats = byCategory([
      sub({ name: 'a', category: 'A', amount: 100 }),
      sub({ name: 'b', category: 'B', amount: 900 }),
      sub({ name: 'c', category: 'A', amount: 100 }),
    ]);
    expect(cats).toEqual([{ category: 'B', monthly: 900 }, { category: 'A', monthly: 200 }]);
  });
});

describe('renewals', () => {
  it('lists upcoming renewals from stale anchors', () => {
    const u = upcoming([sub({ name: 'old', anchor: '2025-09-25' }), sub({ name: 'far', anchor: '2026-11-30' })], ON, 7);
    expect(u.map((x) => [x.sub.name, x.date, x.daysAway])).toEqual([['old', '2026-09-25', 2]]);
  });

  it('opens the alert window at leadDays', () => {
    const subs = [
      sub({ name: 'in', anchor: '2026-09-26', leadDays: 3 }),
      sub({ name: 'out', anchor: '2026-09-27', leadDays: 3 }),
      sub({ name: 'paused', anchor: '2026-09-24', status: 'paused' }),
      sub({ name: 'trial', anchor: '2026-12-01', status: 'trial', trialEnds: '2026-09-24', leadDays: 2 }),
    ];
    expect(dueForAlert(subs, ON).map((u) => u.sub.name)).toEqual(['trial', 'in']);
  });

  it('expands a calendar range', () => {
    const r = renewalsBetween([sub({ cycle: 'weekly', anchor: '2026-09-01' })], '2026-09-01', '2026-09-30');
    expect(r.map((e) => e.date)).toEqual(['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29']);
  });
});

describe('audit', () => {
  it('explains each flag', () => {
    const kinds = (s: Subscription) => audit(s, ON).map((f) => f.kind);
    expect(kinds(sub({ usage: 'never' }))).toContain('unused');
    expect(kinds(sub({ amount: 4500, usage: 'rarely' }))).toEqual(expect.arrayContaining(['low-value', 'high-cost']));
    expect(kinds(sub({ status: 'trial', trialEnds: '2026-09-25' }))).toContain('trial-ending');
    expect(kinds(sub({ cycle: 'annual', anchor: '2026-10-10' }))).toContain('annual-soon');
    expect(kinds(sub({ usage: 'daily' }))).toEqual([]);
    expect(audit(sub({ usage: 'never', status: 'paused' }), ON)).toEqual([]);
  });
});

describe('savings', () => {
  it('projects cancellation savings', () => {
    const subs = [sub({ id: 'x', amount: 1500 }), sub({ id: 'y', amount: 999 })];
    expect(savings(subs, new Set(['x']), 5)).toEqual({ monthly: 1500, annual: 18000, horizon: 90000 });
  });
});

import { forecast, priceChange, withPriceChange } from '../src/lib/subscriptions.ts';

describe('price history', () => {
  it('records changes and flags recent increases', () => {
    const before = sub({ amount: 1549 });
    const history = withPriceChange(before, 1799, '2026-09-01');
    expect(history).toEqual([{ amount: 1549, until: '2026-09-01' }]);
    const after = sub({ amount: 1799, history });
    expect(priceChange(after)!.pct).toBeCloseTo(0.1614, 3);
    expect(audit(after, ON).find((f) => f.kind === 'price-up')?.label).toBe('Up 16%');
    expect(withPriceChange(after, 1799, ON)).toBe(history); // unchanged price → no new entry
  });

  it('stops flagging after six months, and never flags decreases', () => {
    const old = sub({ amount: 1799, history: [{ amount: 1549, until: '2026-01-01' }] });
    expect(audit(old, ON).some((f) => f.kind === 'price-up')).toBe(false);
    const cheaper = sub({ amount: 999, history: [{ amount: 1549, until: '2026-09-01' }] });
    expect(audit(cheaper, ON).some((f) => f.kind === 'price-up')).toBe(false);
  });
});

describe('forecast', () => {
  it('shows lumpy months where annual renewals land', () => {
    const f = forecast([
      sub({ name: 'm', amount: 1000, anchor: '2026-10-05' }),
      sub({ name: 'a', amount: 12000, cycle: 'annual', anchor: '2027-02-10' }),
    ], ON, 12);
    expect(f).toHaveLength(12);
    expect(f[0]).toEqual({ month: '2026-09', total: 0, charges: 0 }); // Sep 5 already passed
    expect(f[1]).toEqual({ month: '2026-10', total: 1000, charges: 1 });
    expect(f.find((m) => m.month === '2027-02')!.total).toBe(13000);
    expect(f.reduce((a, m) => a + m.total, 0)).toBe(11 * 1000 + 12000);
  });
});
