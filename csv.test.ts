import { describe, expect, it } from 'vitest';
import { detectRecurring, extractTransactions, normalizeMerchant, parseCSV, parseLooseDate } from '../src/lib/csv.ts';

describe('parseCSV', () => {
  it('handles quotes, commas, escaped quotes and CRLF', () => {
    expect(parseCSV('a,b\r\n"x, y","say ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']]);
  });
});

describe('dates & merchants', () => {
  it('parses common bank date formats', () => {
    expect(parseLooseDate('09/23/2026')).toBe('2026-09-23');
    expect(parseLooseDate('9/3/26')).toBe('2026-09-03');
    expect(parseLooseDate('23.09.2026')).toBe('2026-09-23');
    expect(parseLooseDate('2026-09-23T10:00:00')).toBe('2026-09-23');
    expect(parseLooseDate('02/30/2026')).toBeNull();
  });

  it('normalises noisy merchant strings', () => {
    expect(normalizeMerchant('NETFLIX.COM 866-579-7172 CA')).toBe('Netflix.com');
    expect(normalizeMerchant('SQ *BLUE BOTTLE COFFEE #221')).toBe('Blue Bottle Coffee');
    expect(normalizeMerchant('Spotify USA')).toBe('Spotify');
  });
});

const csv = `Date,Description,Amount
2026-06-03,NETFLIX.COM 866-579-7172 CA,-15.49
2026-07-03,NETFLIX.COM 866-579-7172 CA,-15.49
2026-08-03,NETFLIX.COM 866-579-7172 CA,-15.49
2026-06-10,SHELL OIL 5741,-42.10
2026-07-02,SHELL OIL 5741,-61.87
2026-07-15,Payroll deposit,2500.00
2026-06-20,Spotify USA,-11.99
2026-07-20,Spotify USA,-11.99
2025-09-01,DOMAIN REGISTRAR,-14.00
2026-09-01,DOMAIN REGISTRAR,-14.00
2026-06-05,TRADER JOES #552,-80.12
2026-07-05,TRADER JOES #552,-35.00
`;

describe('detectRecurring', () => {
  it('finds subscriptions and ignores variable spending and income', () => {
    const tx = extractTransactions(parseCSV(csv));
    expect(tx.find((t) => t.description.startsWith('Payroll'))).toBeUndefined();
    const found = detectRecurring(tx);
    const names = found.map((f) => f.name);
    expect(names).toContain('Netflix.com');
    expect(names).toContain('Spotify');
    expect(names).toContain('Domain Registrar');
    expect(names).not.toContain('Shell Oil'); // irregular amount
    expect(names).not.toContain('Trader Joes'); // variable amount
    const nf = found.find((f) => f.name === 'Netflix.com')!;
    expect(nf).toMatchObject({ amount: 1549, cycle: 'monthly', nextExpected: '2026-09-03', occurrences: 3 });
    expect(found.find((f) => f.name === 'Domain Registrar')!.cycle).toBe('annual');
  });

  it('recognises a price increase instead of discarding the subscription', () => {
    const tx = extractTransactions(parseCSV(`Date,Description,Amount
2026-06-03,NETFLIX.COM,-15.49
2026-07-03,NETFLIX.COM,-15.49
2026-08-03,NETFLIX.COM,-15.49
2026-09-03,NETFLIX.COM,-17.99
`));
    expect(detectRecurring(tx)[0]).toMatchObject({ amount: 1799, previousAmount: 1549, cycle: 'monthly' });
  });

  it('supports debit/credit column layouts', () => {
    const tx = extractTransactions(parseCSV('Posted Date,Payee,Debit,Credit\n09/01/2026,Gym,45.00,\n09/02/2026,Refund,,10.00\n'));
    expect(tx).toEqual([{ date: '2026-09-01', description: 'Gym', amount: 4500 }]);
  });

  it('explains missing columns', () => {
    expect(() => extractTransactions(parseCSV('foo,bar\n1,2\n'))).toThrow(/columns/);
  });
});
