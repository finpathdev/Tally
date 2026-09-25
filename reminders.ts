import { today as todayISO } from '../lib/dates.ts';
import { type Reminder, dueReminders, reminderSchedule } from '../lib/reminders.ts';
import type { AppState } from '../lib/schema.ts';
import { isStandalone } from './install.ts';

/**
 * On-device reminders.
 *
 * The schedule lives in IndexedDB (the service worker can't read
 * localStorage). Reminders are shown:
 *  1. whenever Tally is opened or brought to the front, in every browser that
 *     supports notifications, and
 *  2. in the background via Periodic Background Sync, where available
 *     (installed Tally in Chrome and Edge). public/sw.js does that part.
 * Shown keys are stored in the same database, so neither path repeats one.
 */

const DB = 'tally';
const STORE = 'kv';
export const PERIODIC_TAG = 'tally-reminders';

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE).objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => reject(r.error);
  });
}

async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export type ReminderSupport = 'ok' | 'needs-install' | 'unsupported';

export function reminderSupport(): ReminderSupport {
  if (!('Notification' in window) || !('indexedDB' in window)) {
    // iPhone/iPad only expose notifications to web apps added to the home screen.
    const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    return iOS && !isStandalone() ? 'needs-install' : 'unsupported';
  }
  return 'ok';
}

const FLAG = 'tally:reminders';
export function remindersOn(): boolean {
  try {
    return localStorage.getItem(FLAG) === 'on' && Notification.permission === 'granted';
  } catch {
    return false;
  }
}

export function permissionState(): NotificationPermission | 'unsupported' {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

/** Whether background delivery is available (installed app in Chromium). */
export async function backgroundCapable(): Promise<boolean> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    return !!reg && 'periodicSync' in reg;
  } catch {
    return false;
  }
}

async function registerPeriodic(): Promise<boolean> {
  try {
    const reg = (await navigator.serviceWorker?.getRegistration()) as
      | (ServiceWorkerRegistration & { periodicSync?: { register(tag: string, o: { minInterval: number }): Promise<void> } })
      | undefined;
    if (!reg?.periodicSync) return false;
    const status = await navigator.permissions.query({ name: 'periodic-background-sync' as PermissionName });
    if (status.state !== 'granted') return false;
    await reg.periodicSync.register(PERIODIC_TAG, { minInterval: 12 * 60 * 60 * 1000 });
    return true;
  } catch {
    return false;
  }
}

async function unregisterPeriodic() {
  try {
    const reg = (await navigator.serviceWorker?.getRegistration()) as
      | (ServiceWorkerRegistration & { periodicSync?: { unregister(tag: string): Promise<void> } })
      | undefined;
    await reg?.periodicSync?.unregister(PERIODIC_TAG);
  } catch {
    /* ignore */
  }
}

/** Ask for permission and turn reminders on. Returns a message for the UI. */
export async function enableReminders(state: AppState): Promise<{ ok: boolean; message: string }> {
  const support = reminderSupport();
  if (support === 'needs-install') return { ok: false, message: 'On iPhone and iPad, install Tally first (Share → Add to Home Screen), then turn reminders on from the installed app.' };
  if (support === 'unsupported') return { ok: false, message: 'This browser can’t show notifications.' };
  const result = await Notification.requestPermission();
  if (result !== 'granted') {
    return { ok: false, message: 'Notifications are blocked for this site. Allow them in your browser’s site settings, then try again.' };
  }
  try {
    localStorage.setItem(FLAG, 'on');
  } catch {
    /* ignore */
  }
  await kvSet('enabled', true);
  await syncSchedule(state);
  const background = await registerPeriodic();
  await checkReminders();
  return {
    ok: true,
    message: background
      ? 'Reminders are on. Tally checks in the background about twice a day.'
      : 'Reminders are on. They appear when you open Tally; install it in Chrome or Edge to get them in the background too.',
  };
}

export async function disableReminders() {
  try {
    localStorage.removeItem(FLAG);
  } catch {
    /* ignore */
  }
  await kvSet('enabled', false).catch(() => {});
  await unregisterPeriodic();
}

/** Keep the stored schedule current. Called after every data change. */
export async function syncSchedule(state: AppState) {
  if (!remindersOn()) return;
  const schedule = reminderSchedule(state.subscriptions, state.settings.currency, todayISO());
  await kvSet('schedule', schedule).catch(() => {});
}

async function show(r: Reminder) {
  const opts: NotificationOptions & { renotify?: boolean } = {
    body: r.body,
    tag: r.key,
    icon: `${import.meta.env.BASE_URL}icon-192.png`,
    badge: `${import.meta.env.BASE_URL}icon-192.png`,
    data: { url: `${import.meta.env.BASE_URL}#/subscriptions` },
  };
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg) await reg.showNotification(r.title, opts);
  else new Notification(r.title, opts);
}

/** Show anything due today that hasn't been shown yet. */
export async function checkReminders(): Promise<number> {
  if (!remindersOn()) return 0;
  const on = todayISO();
  const schedule = (await kvGet<Reminder[]>('schedule')) ?? [];
  const shown = new Set((await kvGet<string[]>('notified')) ?? []);
  const due = dueReminders(schedule, shown, on);
  for (const r of due) {
    await show(r);
    shown.add(r.key);
  }
  if (due.length) {
    // Keep the list short: only keys whose date hasn't passed.
    const live = new Set(schedule.filter((r) => r.date >= on).map((r) => r.key));
    await kvSet('notified', [...shown].filter((k) => live.has(k)));
  }
  return due.length;
}

export async function testReminder() {
  await show({ key: 'tally:test', notifyOn: todayISO(), date: todayISO(), title: 'Reminders are working', body: 'This is how Tally will tell you about upcoming renewals.' });
}
