import { describe, expect, it } from 'vitest';
import { demoState } from '../src/lib/schema.ts';
import { balances } from '../src/lib/settle.ts';
import { ShareError, decodeShare, encodeShare, redactForSharing } from '../src/lib/share.ts';

const split = demoState('2026-09-23').split;

describe('shareable split links', () => {
  it('never includes incomes, yet keeps every balance identical', () => {
    const red = redactForSharing(split);
    expect(red.members.every((m) => m.weight === 1)).toBe(true);
    expect(red.expenses.every((e) => e.split.kind === 'exact')).toBe(true);
    expect(balances(red.members, red.expenses, red.payments)).toEqual(balances(split.members, split.expenses, split.payments));
  });

  it('round-trips through a compact, URL-safe token', async () => {
    const token = await encodeShare(split, '2026-09-23');
    expect(token).toMatch(/^z[A-Za-z0-9_-]+$/);
    expect(token).not.toContain('5000'); // Alex's income
    const back = await decodeShare(token);
    expect(back.sharedOn).toBe('2026-09-23');
    expect(back.split.expenses.map((e) => e.description)).toEqual(split.expenses.map((e) => e.description));
    const json = JSON.stringify(back);
    expect(json).not.toContain('"weight":5000');
    expect(json.length).toBeGreaterThan(token.length); // compression helps
  });

  it('rejects damaged or foreign links with a clear message', async () => {
    const token = await encodeShare(split, '2026-09-23');
    await expect(decodeShare(token.slice(0, 40))).rejects.toThrow(ShareError);
    await expect(decodeShare('xabc')).rejects.toThrow(/damaged/);
    const bad = 'j' + btoa(JSON.stringify({ v: 1, sharedOn: '2026-09-23', split: { members: [{ id: 1 }] } })).replace(/=+$/, '');
    await expect(decodeShare(bad)).rejects.toThrow(/invalid data/);
  });
});
