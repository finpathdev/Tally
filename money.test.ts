import { describe, expect, it } from 'vitest';
import { allocate, convert, formatMoney, minorDigits, parseMoney, toMinor } from '../src/lib/money.ts';

describe('parseMoney', () => {
  it.each([
    ['14.99', 1499],
    ['$1,234.50', 123450],
    ['(12.00)', -1200],
    ['-3', -300],
    ['.5', 50],
    [' 7 ', 700],
    ['1.005', 101], // would be 100 with naive float math
  ])('%s → %i', (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it.each(['', 'abc', '1.2.3', '--4'])('rejects %j', (input) => {
    expect(parseMoney(input)).toBeNull();
  });

  it('respects zero-decimal currencies', () => {
    expect(minorDigits('JPY')).toBe(0);
    expect(parseMoney('1500', 'JPY')).toBe(1500);
  });
});

describe('allocate', () => {
  it('always sums to the total', () => {
    for (let total = 0; total < 500; total += 7) {
      for (const weights of [[1, 1, 1], [5000, 3500, 4000], [1, 0, 2], [0.1, 0.2, 0.7]]) {
        const parts = allocate(total, weights);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      }
    }
  });

  it('splits $100 three ways as 33.34 / 33.33 / 33.33', () => {
    expect(allocate(10000, [1, 1, 1])).toEqual([3334, 3333, 3333]);
  });

  it('gives nothing to zero weights', () => {
    expect(allocate(1001, [1, 0, 1])).toEqual([501, 0, 500]);
  });

  it('handles negatives symmetrically', () => {
    expect(allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
  });

  it('falls back to equal when all weights are zero', () => {
    expect(allocate(10, [0, 0])).toEqual([5, 5]);
  });
});

describe('convert / format', () => {
  it('converts between currencies with different minor units', () => {
    expect(convert(10000, 'USD', 'JPY', 151.5)).toBe(15150);
    expect(convert(8500, 'EUR', 'USD', 1.0765)).toBe(9150);
    expect(toMinor(0.1 + 0.2)).toBe(30);
  });

  it('formats', () => {
    expect(formatMoney(123456, 'USD', { locale: 'en-US' })).toBe('$1,234.56');
    expect(formatMoney(1500, 'JPY', { locale: 'en-US' })).toBe('¥1,500');
  });
});
