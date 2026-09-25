import { type Cycle, type ISODate } from './dates.ts';
import { formatMoney } from './money.ts';
import { type Subscription, annualCost, isBilling, nextRenewal } from './subscriptions.ts';

/**
 * iCalendar (RFC 5545) export: one recurring all-day event per subscription,
 * with a reminder that matches its "Remind me" setting. Import once into
 * Google, Apple or Outlook Calendar and renewals show up forever.
 */

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const compact = (d: ISODate) => d.replace(/-/g, '');

/** Fold lines longer than 75 octets, as the spec requires. */
export function fold(line: string): string {
  const bytes = new TextEncoder();
  if (bytes.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes.encode(cur + ch).length > limit) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/**
 * RRULE for a billing cycle. A monthly charge on the 29th–31st uses
 * BYMONTHDAY + BYSETPOS=-1 so short months fall back to their last day
 * (Jan 31 → Feb 28 → Mar 31), matching how Tally and most billers compute it.
 * A plain BYMONTHDAY=31 would silently skip those months.
 */
export function rrule(cycle: Cycle, anchor: ISODate): string {
  const day = Number(anchor.slice(8, 10));
  const endOfMonth = day > 28 ? `;BYMONTHDAY=${Array.from({ length: day - 27 }, (_, i) => 28 + i).join(',')};BYSETPOS=-1` : '';
  switch (cycle) {
    case 'weekly':
      return 'FREQ=WEEKLY';
    case 'monthly':
      return `FREQ=MONTHLY${endOfMonth}`;
    case 'quarterly':
      return `FREQ=MONTHLY;INTERVAL=3${endOfMonth}`;
    case 'annual':
      return day > 28 && anchor.slice(5, 7) === '02' ? 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1' : 'FREQ=YEARLY';
  }
}

export function toICS(subs: readonly Subscription[], currency: string, on: ISODate, stamp = new Date()): string {
  const dtstamp = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const money = (m: number) => formatMoney(m, currency, { locale: 'en-US' });
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tally//Subscriptions//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Subscriptions (Tally)',
  ];

  for (const s of subs.filter(isBilling)) {
    const start = nextRenewal(s, on);
    const alarm = [
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(`${s.name} renews in ${s.leadDays} day${s.leadDays === 1 ? '' : 's'}`)}`,
      `TRIGGER:-P${s.leadDays}D`,
      'END:VALARM',
    ];
    const desc = [`${money(s.amount)} every ${s.cycle === 'annual' ? 'year' : s.cycle.replace('ly', '')}`, `${money(annualCost(s))} a year`, s.url ? `Manage: ${s.url}` : ''].filter(Boolean).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${s.id}@tally`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${compact(start)}`,
      `RRULE:${rrule(s.cycle, s.anchor)}`, // anchor day, not `start`, so month-end clamping survives
      `SUMMARY:${esc(`${s.name} · ${money(s.amount)}`)}`,
      `DESCRIPTION:${esc(desc)}`,
      `CATEGORIES:${esc(s.category)}`,
      'TRANSP:TRANSPARENT',
      ...(s.url ? [`URL:${s.url}`] : []),
      ...alarm,
      'END:VEVENT',
    );
    if (s.status === 'trial' && s.trialEnds && s.trialEnds >= on) {
      lines.push(
        'BEGIN:VEVENT',
        `UID:${s.id}-trial@tally`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART;VALUE=DATE:${compact(s.trialEnds)}`,
        `SUMMARY:${esc(`Trial ends: ${s.name}`)}`,
        `DESCRIPTION:${esc(`Cancel before today to avoid a ${money(s.amount)} charge.`)}`,
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${esc(`Trial for ${s.name} ends in ${s.leadDays} day${s.leadDays === 1 ? '' : 's'}`)}`,
        `TRIGGER:-P${s.leadDays}D`,
        'END:VALARM',
        'END:VEVENT',
      );
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
