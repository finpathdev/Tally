import { describe, expect, it } from 'vitest';
import { dueReminders, reminderSchedule } from '../src/lib/reminders.ts';
import type { Subscription } from '../src/lib/subscriptions.ts';

const ON = '2026-09-23';
const sub = (p: Partial<Subscription>): Subscription => ({
  id: 'n', name: 'Netflix', amount: 1549, cycle: 'monthly', anchor: '2026-09-26', category: 'E',
  leadDays: 3, status: 'active', usage: 'weekly', ...p,
});

describe('reminder schedule', () => {
  it('schedules each charge lead-days ahead, within the horizon', () => {
    const s = reminderSchedule([sub({})], 'USD', ON, 60);
    // Nov 26 is beyond the 60-day horizon.
    expect(s.map((r) => [r.key, r.notifyOn])).toEqual([
      ['n:2026-09-26', '2026-09-23'],
      ['n:2026-10-26', '2026-10-23'],
    ]);
    expect(s[0]!.title).toBe('Netflix renews Sat, Sep 26');
    expect(s[0]!.body).toBe('$15.49 · $185.88 a year');
  });

  it('never schedules in the past when the lead window is already open', () => {
    const [r] = reminderSchedule([sub({ anchor: '2026-09-24', leadDays: 7 })], 'USD', ON, 10);
    expect(r!.notifyOn).toBe(ON);
  });

  it('reminds about trials instead of the first paid charge, and skips paused', () => {
    const s = reminderSchedule([
      sub({ id: 't', status: 'trial', trialEnds: '2026-09-30', anchor: '2026-09-30', leadDays: 2 }),
      sub({ id: 'p', status: 'paused' }),
    ], 'USD', ON, 20);
    expect(s.map((r) => r.key)).toEqual(['t:trial:2026-09-30']);
    expect(s[0]!.notifyOn).toBe('2026-09-28');
    expect(s[0]!.body).toContain('avoid a $15.49 charge');
  });
});

describe('due reminders', () => {
  const schedule = reminderSchedule([sub({})], 'USD', '2026-09-20', 60);
  it('returns what is due today and not yet shown', () => {
    expect(dueReminders(schedule, new Set(), '2026-09-22')).toHaveLength(0);
    expect(dueReminders(schedule, new Set(), '2026-09-23').map((r) => r.key)).toEqual(['n:2026-09-26']);
    expect(dueReminders(schedule, new Set(['n:2026-09-26']), '2026-09-24')).toHaveLength(0);
  });
  it('drops reminders whose date has passed (e.g. the phone was off)', () => {
    expect(dueReminders(schedule, new Set(), '2026-09-27')).toHaveLength(0);
  });
});
