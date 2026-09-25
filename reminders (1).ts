import { type ISODate, addDays, daysBetween, formatDate, occurrencesBetween } from './dates.ts';
import { formatMoney } from './money.ts';
import { type Subscription, annualCost, isBilling } from './subscriptions.ts';

/**
 * A precomputed reminder. The schedule is computed here (with the same
 * billing logic as the rest of the app) and stored in IndexedDB, so the
 * service worker only has to compare dates. It never needs the app's code.
 */
export interface Reminder {
  /** Stable id: `<subscription id>:<charge date>` (or `:trial:` for trials). */
  key: string;
  /** First day the reminder may be shown. */
  notifyOn: ISODate;
  /** The charge or trial-end date. After it passes, the reminder is dropped. */
  date: ISODate;
  title: string;
  body: string;
}

/** Every reminder whose charge falls within the next `horizonDays` days. */
export function reminderSchedule(
  subs: readonly Subscription[],
  currency: string,
  on: ISODate,
  horizonDays = 60,
): Reminder[] {
  const money = (m: number) => formatMoney(m, currency, { locale: 'en-US' });
  const when = (d: ISODate) => formatDate(d, 'en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const end = addDays(on, horizonDays);
  const out: Reminder[] = [];

  for (const s of subs) {
    if (!isBilling(s)) continue;
    const lead = (d: ISODate) => (daysBetween(on, addDays(d, -s.leadDays)) > 0 ? addDays(d, -s.leadDays) : on);

    if (s.status === 'trial' && s.trialEnds && s.trialEnds >= on && s.trialEnds <= end) {
      out.push({
        key: `${s.id}:trial:${s.trialEnds}`,
        notifyOn: lead(s.trialEnds),
        date: s.trialEnds,
        title: `${s.name} trial ends ${when(s.trialEnds)}`,
        body: `Cancel before then to avoid a ${money(s.amount)} charge.`,
      });
    }
    for (const date of occurrencesBetween(s.anchor, s.cycle, on, end)) {
      // A trial's first paid charge is already covered by the trial reminder.
      if (s.status === 'trial' && s.trialEnds && date <= s.trialEnds) continue;
      out.push({
        key: `${s.id}:${date}`,
        notifyOn: lead(date),
        date,
        title: `${s.name} renews ${when(date)}`,
        body: `${money(s.amount)} · ${money(annualCost(s))} a year`,
      });
    }
  }
  return out.sort((a, b) => a.notifyOn.localeCompare(b.notifyOn) || a.date.localeCompare(b.date));
}

/** Reminders to show today that haven't been shown yet. */
export function dueReminders(schedule: readonly Reminder[], notified: ReadonlySet<string>, on: ISODate): Reminder[] {
  return schedule.filter((r) => r.notifyOn <= on && r.date >= on && !notified.has(r.key));
}
