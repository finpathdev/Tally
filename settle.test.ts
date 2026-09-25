import { describe, expect, it } from 'vitest';
import { type Expense, type Member, balances, memberSummary, shares, simplify } from '../src/lib/settle.ts';

const members: Member[] = [
  { id: 'a', name: 'Alex', weight: 5000 },
  { id: 'j', name: 'Jordan', weight: 3500 },
  { id: 't', name: 'Taylor', weight: 4000 },
];
const all = ['a', 'j', 't'];
const exp = (p: Partial<Expense>): Expense => ({
  id: 'x',
  description: 'x',
  date: '2026-09-01',
  paidBy: 'a',
  amount: 0,
  split: { kind: 'equal', among: all },
  ...p,
});

const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

/** Apply transfers and confirm everyone ends at zero. */
function settles(bal: Map<string, number>) {
  const t = simplify(bal);
  const after = new Map(bal);
  for (const { from, to, amount } of t) {
    expect(amount).toBeGreaterThan(0);
    after.set(from, after.get(from)! + amount);
    after.set(to, after.get(to)! - amount);
  }
  expect([...after.values()].every((v) => v === 0)).toBe(true);
  return t;
}

describe('shares', () => {
  it('splits equally to the cent', () => {
    const s = shares(exp({ amount: 10000 }), members);
    expect(total(s)).toBe(10000);
    expect([...s.values()].sort()).toEqual([3333, 3333, 3334]);
  });

  it('splits by income weight', () => {
    const s = shares(exp({ amount: 12000, split: { kind: 'weighted', among: all } }), members);
    expect(s.get('a')).toBe(4800);
    expect(s.get('j')).toBe(3360);
    expect(s.get('t')).toBe(3840);
  });

  it('supports custom shares and subsets', () => {
    const s = shares(exp({ amount: 900, split: { kind: 'shares', shares: { a: 2, j: 1 } } }), members);
    expect(s.get('a')).toBe(600);
    expect(s.get('j')).toBe(300);
    expect(s.has('t')).toBe(false);
  });

  it('rejects exact splits that do not add up', () => {
    expect(() => shares(exp({ amount: 1000, split: { kind: 'exact', amounts: { a: 500, j: 400 } } }), members)).toThrow();
  });
});

describe('balances', () => {
  it('sums to zero and reflects payments', () => {
    const expenses = [
      exp({ amount: 45000, paidBy: 'a' }),
      exp({ amount: 12000, paidBy: 'j', split: { kind: 'weighted', among: all } }),
      exp({ amount: 9150, paidBy: 't' }),
    ];
    const bal = balances(members, expenses);
    expect(total(bal)).toBe(0);
    const paid = balances(members, expenses, [{ id: 'p', from: 'j', to: 'a', amount: 1000, date: '2026-09-02' }]);
    expect(paid.get('j')! - bal.get('j')!).toBe(1000);
    expect(total(paid)).toBe(0);
    settles(bal);
  });

  it('memberSummary shares equal expense totals', () => {
    const s = memberSummary(members, [exp({ amount: 10001 })]);
    expect([...s.values()].reduce((a, v) => a + v.share, 0)).toBe(10001);
  });
});

describe('simplify', () => {
  it('settles independent pairs in 2 transfers', () => {
    const bal = new Map([
      ['a', -700], ['b', -300], ['c', 300], ['d', 700],
    ]);
    const t = settles(bal);
    expect(t).toHaveLength(2);
  });

  it('beats largest-first greedy (4 transfers) with an optimal 3', () => {
    const bal = new Map([
      ['a', -6], ['b', -4], ['c', -5], ['d', 5], ['e', 10],
    ]);
    // {c,d} is a zero-sum pair, {a,b,e} another → 1 + 2 = 3 transfers.
    expect(settles(bal)).toHaveLength(3);
  });

  it('never exceeds n - 1 on random inputs', () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let run = 0; run < 200; run++) {
      const n = 2 + Math.floor(rand() * 9);
      const vals = Array.from({ length: n - 1 }, () => Math.round((rand() - 0.5) * 20) * 100);
      vals.push(-vals.reduce((a, b) => a + b, 0));
      const bal = new Map(vals.map((v, i) => [`m${i}`, v]));
      const nonZero = vals.filter((v) => v !== 0).length;
      expect(settles(bal).length).toBeLessThanOrEqual(Math.max(0, nonZero - 1));
    }
  });

  it('returns nothing when everyone is square', () => {
    expect(simplify(new Map([['a', 0], ['b', 0]]))).toEqual([]);
  });

  it('falls back to greedy for large groups and still settles', () => {
    const bal = new Map<string, number>();
    for (let i = 0; i < 20; i++) bal.set(`p${i}`, i % 2 ? 100 * i : -100 * (i + 1));
    const sum = total(bal);
    bal.set('p0', bal.get('p0')! - sum);
    settles(bal);
  });
});
