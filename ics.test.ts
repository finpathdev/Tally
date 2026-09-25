import { describe, expect, it } from 'vitest';
import { fold, rrule, toICS } from '../src/lib/ics.ts';
import type { Subscription } from '../src/lib/subscriptions.ts';

const sub = (p: Partial<Subscription>): Subscription => ({
  id: 'abc', name: 'Netflix', amount: 1549, cycle: 'monthly', anchor: '2026-10-03', category: 'Entertainment',
  leadDays: 3, status: 'active', usage: 'weekly', ...p,
});

describe('ics', () => {
  it('writes a valid calendar with recurring events and reminders', () => {
    const ics = toICS([sub({})], 'USD', '2026-09-23', new Date('2026-09-23T12:00:00Z'));
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261003');
    expect(ics).toContain('RRULE:FREQ=MONTHLY\r\n');
    expect(ics).toContain('TRIGGER:-P3D');
    expect(ics).toContain('SUMMARY:Netflix · $15.49');
    expect(ics).toContain('UID:abc@tally');
    expect(ics).toContain('DTSTAMP:20260923T120000Z');
  });

  it('keeps month-end billing on the last day of short months', () => {
    expect(rrule('monthly', '2026-01-31')).toBe('FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1');
    expect(rrule('monthly', '2026-01-30')).toBe('FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1');
    expect(rrule('quarterly', '2026-01-15')).toBe('FREQ=MONTHLY;INTERVAL=3');
    expect(rrule('annual', '2028-02-29')).toBe('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1');
    // DTSTART is the next renewal (Feb 28) but the rule still targets month-end.
    const ics = toICS([sub({ anchor: '2026-01-31' })], 'USD', '2026-02-10');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260228');
    expect(ics).toContain('BYSETPOS=-1');
  });

  it('adds a trial-end event, skips paused, and escapes text', () => {
    const ics = toICS([
      sub({ id: 't', name: 'Lang, App; Pro', status: 'trial', trialEnds: '2026-09-25' }),
      sub({ id: 'p', name: 'Paused', status: 'paused' }),
    ], 'USD', '2026-09-23');
    expect(ics).toContain('UID:t-trial@tally');
    expect(ics).toContain('SUMMARY:Trial ends: Lang\\, App\\; Pro');
    expect(ics).toContain('Trial for Lang\\, App\\; Pro ends in 3 days');
    expect(ics).not.toContain('Paused');
  });

  it('folds long lines at 75 octets without splitting characters', () => {
    const long = 'DESCRIPTION:' + 'é'.repeat(80);
    const folded = fold(long);
    for (const line of folded.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe(long);
  });
});
