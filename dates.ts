/**
 * Calendar-date helpers. Dates are ISO strings ("2026-09-23") with no time
 * or timezone, and all arithmetic goes through UTC so daylight-saving shifts
 * can never produce an off-by-one day count.
 */

export type ISODate = string;
export type Cycle = 'weekly' | 'monthly' | 'quarterly' | 'annual';

export const CYCLES: readonly Cycle[] = ['weekly', 'monthly', 'quarterly', 'annual'];

const DAY_MS = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isISODate(s: unknown): s is ISODate {
  if (typeof s !== 'string') return false;
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function parts(date: ISODate): [number, number, number] {
  const m = ISO_RE.exec(date);
  if (!m) throw new RangeError(`Invalid ISO date: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function toUTC(date: ISODate): number {
  const [y, m, d] = parts(date);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Today's date in the user's local timezone. */
export function today(now: Date = new Date()): ISODate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromUTC(toUTC(date) + days * DAY_MS);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(b) - toUTC(a)) / DAY_MS);
}

function daysInMonth(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

/** Add calendar months, clamping to month end (Jan 31 + 1 month → Feb 28/29). */
export function addMonths(date: ISODate, months: number): ISODate {
  const [y, m, d] = parts(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm0 = total - ny * 12;
  const nd = Math.min(d, daysInMonth(ny, nm0));
  return fromUTC(Date.UTC(ny, nm0, nd));
}

/** The k-th renewal after `anchor` (k = 0 is the anchor itself). */
export function nthOccurrence(anchor: ISODate, cycle: Cycle, k: number): ISODate {
  switch (cycle) {
    case 'weekly':
      return addDays(anchor, 7 * k);
    case 'monthly':
      return addMonths(anchor, k);
    case 'quarterly':
      return addMonths(anchor, 3 * k);
    case 'annual':
      return addMonths(anchor, 12 * k);
  }
}

/**
 * The first renewal on or after `from`. Always computed from the original
 * anchor so a subscription billed on the 31st returns to the 31st after a
 * short month instead of drifting to the 28th forever.
 */
export function nextOccurrence(anchor: ISODate, cycle: Cycle, from: ISODate): ISODate {
  return nextOccurrenceIndexed(anchor, cycle, from).date;
}

function nextOccurrenceIndexed(anchor: ISODate, cycle: Cycle, from: ISODate): { date: ISODate; k: number } {
  if (anchor >= from) return { date: anchor, k: 0 };
  // Jump close to the answer, then step. Keeps this O(1) for old anchors.
  const approxDays: Record<Cycle, number> = { weekly: 7, monthly: 30.44, quarterly: 91.31, annual: 365.25 };
  let k = Math.max(0, Math.floor(daysBetween(anchor, from) / approxDays[cycle]) - 1);
  let next = nthOccurrence(anchor, cycle, k);
  while (next < from) next = nthOccurrence(anchor, cycle, ++k);
  return { date: next, k };
}

/** All renewals in the inclusive range [start, end]. */
export function occurrencesBetween(anchor: ISODate, cycle: Cycle, start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  let { date: d, k } = nextOccurrenceIndexed(anchor, cycle, start);
  while (d <= end) {
    out.push(d);
    d = nthOccurrence(anchor, cycle, ++k);
  }
  return out;
}

export function formatDate(date: ISODate, locale?: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Date(toUTC(date)).toLocaleDateString(locale, {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    ...opts,
  });
}

export function relativeDays(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** Monday-first grid of weeks covering the month containing `date`. */
export function monthGrid(date: ISODate): ISODate[][] {
  const [y, m] = parts(date);
  const first = fromUTC(Date.UTC(y, m - 1, 1));
  const weekday = (new Date(toUTC(first)).getUTCDay() + 6) % 7; // Mon = 0
  let cursor = addDays(first, -weekday);
  const weeks: ISODate[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: ISODate[] = [];
    for (let i = 0; i < 7; i++) {
      row.push(cursor);
      cursor = addDays(cursor, 1);
    }
    weeks.push(row);
    if (parts(cursor)[1] !== m) break;
  }
  return weeks;
}
