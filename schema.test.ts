import { describe, expect, it } from 'vitest';
import { SchemaError, demoState, migrate, parseRepoFile, toRepoFile } from '../src/lib/schema.ts';
import { balances } from '../src/lib/settle.ts';

describe('schema', () => {
  it('round-trips the current format', () => {
    const s = demoState('2026-09-23');
    expect(migrate(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it('migrates the original FinHub v1 export', () => {
    const v1 = {
      subscriptions: [{ id: '1', name: 'Netflix Premium', cost: 22.99, cycle: 'monthly', date: '2026-09-28', category: 'Entertainment', lead: 3 }],
      groupMembers: [{ name: 'Alex', income: 5000 }, { name: 'Jordan', income: 3500 }],
      sharedExpenses: [{ id: '1', desc: 'Cabin', amount: 450, payer: 'Alex', method: 'proportional' }],
      groceryCart: [{ id: '1', name: 'Milk', price: 4.29, qty: 1, taxable: false }],
      groceryTaxRate: 8.25,
      groceryBudgetLimit: 100,
      splitCurrency: 'USD',
    };
    const s = migrate(v1);
    expect(s.subscriptions[0]).toMatchObject({ amount: 2299, anchor: '2026-09-28', leadDays: 3 });
    expect(s.cart).toMatchObject({ taxRateBps: 825, budget: 10000 });
    expect(s.split.expenses[0]!.split.kind).toBe('weighted');
    const bal = balances(s.split.members, s.split.expenses);
    expect([...bal.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('rejects malformed or future files with a useful message', () => {
    expect(() => migrate({ version: 2, subscriptions: [{ id: 1 }] })).toThrow(SchemaError);
    expect(() => migrate({ version: 99 })).toThrow(/newer version/);
    expect(() => migrate('nope')).toThrow(SchemaError);
  });

  it('produces a repo file the Action can read back', () => {
    const s = demoState('2026-09-23');
    const file = parseRepoFile(JSON.parse(JSON.stringify(toRepoFile(s))));
    expect(file.subscriptions).toHaveLength(s.subscriptions.length);
  });
});

describe('price history in saved data', () => {
  it('round-trips and validates history entries', () => {
    const s = demoState('2026-09-23');
    s.subscriptions[0]!.history = [{ amount: 1999, until: '2026-08-01' }];
    expect(migrate(JSON.parse(JSON.stringify(s))).subscriptions[0]!.history).toEqual([{ amount: 1999, until: '2026-08-01' }]);
    s.subscriptions[0]!.history = [{ amount: 19.99, until: 'yesterday' }] as never;
    expect(() => migrate(JSON.parse(JSON.stringify(s)))).toThrow(SchemaError);
  });
});
