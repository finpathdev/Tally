import { type Cycle, type ISODate, daysBetween, isISODate, nthOccurrence } from './dates.ts';
import { type Minor, parseMoney } from './money.ts';

/** RFC 4180-ish CSV parser: quoted fields, escaped quotes, CRLF, BOM. */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Accepts 2026-09-23, 09/23/2026, 9/23/26 and 23.09.2026. */
export function parseLooseDate(s: string): ISODate | null {
  const t = s.trim();
  if (isISODate(t.slice(0, 10))) return t.slice(0, 10);
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t);
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const iso = `${y}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
    return isISODate(iso) ? iso : null;
  }
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (m) {
    const iso = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
    return isISODate(iso) ? iso : null;
  }
  return null;
}

export interface Transaction {
  date: ISODate;
  description: string;
  /** Money leaving the account, as a positive number. */
  amount: Minor;
}

const find = (header: string[], ...patterns: RegExp[]) =>
  header.findIndex((h) => patterns.some((p) => p.test(h)));

/**
 * Pull outgoing transactions from a bank/card export. Column names vary
 * wildly between banks, so we match on common header words and support both
 * a signed "Amount" column and separate "Debit"/"Credit" columns.
 */
export function extractTransactions(rows: string[][], currency = 'USD'): Transaction[] {
  if (rows.length < 2) return [];
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const iDate = find(header, /^(transaction |posting |post )?date$/, /date/);
  const iDesc = find(header, /desc/, /merchant/, /payee/, /name/, /memo/, /details/);
  const iAmount = find(header, /^amount$/, /amount/);
  const iDebit = find(header, /debit/, /withdraw/, /out/);
  if (iDate < 0 || iDesc < 0 || (iAmount < 0 && iDebit < 0)) {
    throw new Error('Could not find date, description and amount columns in this CSV.');
  }

  const raw = rows.slice(1).flatMap((r) => {
    const date = parseLooseDate(r[iDate] ?? '');
    const description = (r[iDesc] ?? '').trim();
    if (!date || !description) return [];
    if (iDebit >= 0 && (r[iDebit] ?? '').trim()) {
      const v = parseMoney(r[iDebit]!, currency);
      return v ? [{ date, description, signed: -Math.abs(v) }] : [];
    }
    const v = iAmount >= 0 ? parseMoney(r[iAmount] ?? '', currency) : null;
    return v ? [{ date, description, signed: v }] : [];
  });

  // Most banks export spending as negative; some export it as positive.
  const negatives = raw.filter((t) => t.signed < 0).length;
  const spendingIsNegative = negatives >= raw.length / 2 || iDebit >= 0;
  return raw
    .filter((t) => (spendingIsNegative ? t.signed < 0 : t.signed > 0))
    .map((t) => ({ date: t.date, description: t.description, amount: Math.abs(t.signed) }));
}

/** "NETFLIX.COM 866-579-7172 CA #4412" → "Netflix.com" */
export function normalizeMerchant(desc: string): string {
  const cleaned = desc
    .toUpperCase()
    .replace(/^(POS|ACH|DEBIT|CHECKCARD|PURCHASE|RECURRING|SQ|TST|PP)\s*\*?\s*/g, '')
    .replace(/\*.*$/, '')
    .replace(/#\s*\d+/g, '')
    .replace(/\b\d[\d\-\s]{3,}\b/g, '')
    .replace(/\b(US|USA|CA|NY|TX|WA|INC|LLC|LTD|CO)\b\.?/g, '')
    .replace(/[^A-Z0-9.&' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned
    .toLowerCase()
    .split(' ')
    .slice(0, 3)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export interface RecurringCandidate {
  name: string;
  amount: Minor;
  cycle: Cycle;
  lastCharged: ISODate;
  nextExpected: ISODate;
  occurrences: number;
  /** 0–1: how regular the timing and amounts were. */
  confidence: number;
  /** Set when the latest charge differs from an otherwise steady price. */
  previousAmount?: Minor;
}

const TARGETS: [Cycle, number, number][] = [
  ['weekly', 7, 2],
  ['monthly', 30.4, 4],
  ['quarterly', 91.3, 8],
  ['annual', 365.25, 15],
];

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Find charges that repeat on a regular schedule with a stable price. Needs
 * at least 2 occurrences (3 for weekly, which is otherwise noisy).
 */
export function detectRecurring(txns: readonly Transaction[]): RecurringCandidate[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of txns) {
    const key = normalizeMerchant(t.description);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  const out: RecurringCandidate[] = [];
  for (const [name, list] of groups) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const gaps = sorted.slice(1).map((t, i) => daysBetween(sorted[i]!.date, t.date));
    const gap = median(gaps);
    const match = TARGETS.find(([, days, tol]) => Math.abs(gap - days) <= tol);
    if (!match) continue;
    const [cycle, days, tol] = match;
    if (cycle === 'weekly' && sorted.length < 3) continue;

    const spread = (xs: number[]) => {
      const m = median(xs);
      return Math.max(...xs.map((a) => Math.abs(a - m) / m));
    };
    const amounts = sorted.map((t) => t.amount);
    let amountSpread = spread(amounts);
    let previousAmount: Minor | undefined;
    if (amountSpread > 0.15) {
      // A steady price followed by one different charge is a price change,
      // which is exactly what people want to notice.
      const before = amounts.slice(0, -1);
      if (before.length >= 2 && spread(before) <= 0.05) {
        previousAmount = Math.round(median(before));
        amountSpread = spread(before);
      } else continue; // varies too much to be a subscription
    }

    const timingSpread = Math.max(...gaps.map((g) => Math.abs(g - days))) / (tol * 2);
    const confidence = Math.max(
      0,
      Math.min(1, 0.5 + 0.15 * (sorted.length - 2) - 0.3 * Math.min(1, timingSpread) - amountSpread),
    );
    const last = sorted.at(-1)!;
    out.push({
      name,
      amount: last.amount,
      cycle,
      lastCharged: last.date,
      nextExpected: nthOccurrence(last.date, cycle, 1),
      occurrences: sorted.length,
      confidence: Math.round(confidence * 100) / 100,
      ...(previousAmount !== undefined ? { previousAmount } : {}),
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence || b.amount - a.amount);
}
