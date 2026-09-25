/**
 * Money is stored as integers in the currency's minor unit (cents for USD,
 * whole yen for JPY). Floats are only used at the edges: parsing user input
 * and formatting for display. This removes the classic 0.1 + 0.2 drift and
 * guarantees that splits always add back up to the original total.
 */

export type Minor = number;

const digitsCache = new Map<string, number>();

/** Number of minor-unit digits for an ISO 4217 code (USD → 2, JPY → 0). */
export function minorDigits(currency: string): number {
  const cached = digitsCache.get(currency);
  if (cached !== undefined) return cached;
  let digits = 2;
  try {
    digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  } catch {
    /* unknown code: assume 2 */
  }
  digitsCache.set(currency, digits);
  return digits;
}

/**
 * Parse human input like "14.99", "$1,234.50", "(12.00)" or "-3" into minor
 * units. Returns null for anything that is not a finite number.
 */
export function parseMoney(input: string | number, currency = 'USD'): Minor | null {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? toMinor(input, currency) : null;
  }
  let s = input.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[\s,]/g, '').replace(/^[^\d.+-]+/, '').replace(/[^\d.]+$/, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const value = toMinor(Number(s), currency);
  return negative ? -value : value;
}

/** Convert a major-unit number (e.g. 14.99) to minor units, rounding half away from zero. */
export function toMinor(major: number, currency = 'USD'): Minor {
  const factor = 10 ** minorDigits(currency);
  // toFixed-based correction avoids 1.005 * 100 = 100.49999 style errors.
  const scaled = Number((Math.abs(major) * factor).toFixed(6));
  return Math.sign(major) * Math.round(scaled);
}

export function toMajor(minor: Minor, currency = 'USD'): number {
  return minor / 10 ** minorDigits(currency);
}

const fmtCache = new Map<string, Intl.NumberFormat>();

export function formatMoney(
  minor: Minor,
  currency = 'USD',
  opts: { locale?: string; compact?: boolean; sign?: boolean } = {},
): string {
  const key = `${opts.locale ?? ''}|${currency}|${opts.compact ? 1 : 0}|${opts.sign ? 1 : 0}`;
  let fmt = fmtCache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(opts.locale, {
      style: 'currency',
      currency,
      ...(opts.compact ? { notation: 'compact', maximumFractionDigits: 1 } : {}),
      ...(opts.sign ? { signDisplay: 'exceptZero' } : {}),
    });
    fmtCache.set(key, fmt);
  }
  return fmt.format(toMajor(minor, currency));
}

/** Plain decimal string for form inputs ("14.99", "1500"). */
export function toInputValue(minor: Minor, currency = 'USD'): string {
  return toMajor(minor, currency).toFixed(minorDigits(currency));
}

/**
 * Split `total` into parts proportional to `weights` using the largest
 * remainder method. The parts always sum to exactly `total`, and leftover
 * cents go to the parts with the largest fractional remainder (ties broken
 * by position, so the result is deterministic).
 */
export function allocate(total: Minor, weights: readonly number[]): Minor[] {
  if (!Number.isInteger(total)) throw new RangeError('allocate: total must be an integer');
  if (weights.length === 0) return [];
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
    throw new RangeError('allocate: weights must be finite and non-negative');
  }
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const effective = weightSum > 0 ? weights : weights.map(() => 1);
  const denom = weightSum > 0 ? weightSum : weights.length;

  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const exact = effective.map((w) => (abs * w) / denom);
  const parts = exact.map(Math.floor);
  let leftover = abs - parts.reduce((a, b) => a + b, 0);

  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x), w: effective[i]! }))
    .filter((o) => o.w > 0)
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  for (let k = 0; leftover > 0; k = (k + 1) % order.length, leftover--) {
    parts[order[k]!.i]! += 1;
  }
  return parts.map((p) => p * sign);
}

/**
 * Convert between currencies. `rate` is how many units of `to` one unit of
 * `from` buys (e.g. EUR→USD 1.08).
 */
export function convert(amount: Minor, from: string, to: string, rate: number): Minor {
  if (from === to) return amount;
  const major = toMajor(amount, from) * rate;
  return toMinor(major, to);
}

export const sumMinor = (xs: readonly Minor[]): Minor => xs.reduce((a, b) => a + b, 0);
