import { CYCLES, type Cycle, type ISODate, addDays, isISODate, today } from './dates.ts';
import { type Minor, toMinor } from './money.ts';
import type { CartItem } from './cart.ts';
import type { Expense, Member, Payment, SplitRule } from './settle.ts';
import type { SubStatus, Subscription, Usage } from './subscriptions.ts';

export const SCHEMA_VERSION = 2;

export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  currency: string;
  theme: Theme;
  highCost: Minor;
}

export interface SyncConfig {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  /** Encrypt the repo file with a passphrase before committing. */
  encrypt: boolean;
}

export interface AppState {
  version: typeof SCHEMA_VERSION;
  settings: Settings;
  subscriptions: Subscription[];
  split: { currency: string; members: Member[]; expenses: Expense[]; payments: Payment[] };
  cart: { items: CartItem[]; taxRateBps: number; budget: Minor };
  sync: SyncConfig;
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}

export function emptyState(): AppState {
  return {
    version: SCHEMA_VERSION,
    settings: { currency: 'USD', theme: 'system', highCost: 2000 },
    subscriptions: [],
    split: { currency: 'USD', members: [], expenses: [], payments: [] },
    cart: { items: [], taxRateBps: 825, budget: 10_000 },
    sync: { owner: '', repo: '', branch: 'main', path: 'data/subscriptions.json', encrypt: false },
  };
}

/** Friendly sample data so a first visit shows what the app can do. */
export function demoState(on: ISODate = today()): AppState {
  const s = emptyState();
  const d = (n: number) => addDays(on, n);
  s.subscriptions = [
    { id: uid(), name: 'Netflix Premium', amount: 2499, cycle: 'monthly', anchor: d(4), category: 'Entertainment', leadDays: 3, status: 'active', usage: 'weekly' },
    { id: uid(), name: 'GitHub Copilot', amount: 1000, cycle: 'monthly', anchor: d(12), category: 'Developer Tools', leadDays: 3, status: 'active', usage: 'daily' },
    { id: uid(), name: 'Gym Membership', amount: 4500, cycle: 'monthly', anchor: d(1), category: 'Health & Fitness', leadDays: 5, status: 'active', usage: 'rarely' },
    { id: uid(), name: 'Cloud Hosting', amount: 12000, cycle: 'annual', anchor: d(18), category: 'Utilities', leadDays: 14, status: 'active', usage: 'monthly' },
    { id: uid(), name: 'Language App', amount: 1299, cycle: 'monthly', anchor: d(2), category: 'News & Learning', leadDays: 2, status: 'trial', trialEnds: d(2), usage: 'never' },
    { id: uid(), name: 'Music Streaming', amount: 1199, cycle: 'monthly', anchor: d(22), category: 'Entertainment', leadDays: 3, status: 'active', usage: 'daily' },
  ];
  const [a, j, t] = [uid(), uid(), uid()];
  s.split.members = [
    { id: a, name: 'Alex', weight: 5000 },
    { id: j, name: 'Jordan', weight: 3500 },
    { id: t, name: 'Taylor', weight: 4000 },
  ];
  s.split.expenses = [
    { id: uid(), description: 'Weekend cabin', date: d(-6), paidBy: a, amount: 45000, split: { kind: 'equal', among: [a, j, t] } },
    { id: uid(), description: 'Groceries for the trip', date: d(-5), paidBy: j, amount: 12000, split: { kind: 'weighted', among: [a, j, t] } },
    { id: uid(), description: 'Dinner in town', date: d(-4), paidBy: t, amount: 9150, original: { currency: 'EUR', amount: 8500, rate: 1.0765 }, split: { kind: 'equal', among: [a, j, t] } },
  ];
  s.cart.items = [
    { id: uid(), name: 'Milk, 1 gal', unitPrice: 429, qty: 1, taxable: false, inBasket: true },
    { id: uid(), name: 'Paper towels, 6-pack', unitPrice: 899, qty: 1, taxable: true, inBasket: false },
    { id: uid(), name: 'Apples', unitPrice: 350, qty: 2, taxable: false, inBasket: false },
    { id: uid(), name: 'Dish soap', unitPrice: 379, qty: 1, taxable: true, inBasket: false },
  ];
  return s;
}

// ---------- validation ----------

export class SchemaError extends Error {}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function need<T>(ok: boolean, value: T, where: string): T {
  if (!ok) throw new SchemaError(`Invalid value at ${where}`);
  return value;
}
const str = (v: unknown, where: string) => need(typeof v === 'string', v as string, where);
const int = (v: unknown, where: string) => need(Number.isInteger(v), v as number, where);
const num = (v: unknown, where: string) => need(typeof v === 'number' && Number.isFinite(v), v as number, where);
const date = (v: unknown, where: string) => need(isISODate(v), v as ISODate, where);
const arr = (v: unknown, where: string) => need(Array.isArray(v), v as unknown[], where);
const oneOf = <T extends string>(v: unknown, opts: readonly T[], where: string) =>
  need(opts.includes(v as T), v as T, where);
const optStr = (v: unknown, where: string) => (v === undefined ? undefined : str(v, where));

const USAGES: readonly Usage[] = ['daily', 'weekly', 'monthly', 'rarely', 'never'];
const STATUSES: readonly SubStatus[] = ['active', 'trial', 'paused'];

export function parseSubscription(v: unknown, where = 'subscription'): Subscription {
  if (!isObj(v)) throw new SchemaError(`${where} must be an object`);
  const sub: Subscription = {
    id: str(v.id, `${where}.id`),
    name: str(v.name, `${where}.name`),
    amount: int(v.amount, `${where}.amount`),
    cycle: oneOf(v.cycle, CYCLES, `${where}.cycle`),
    anchor: date(v.anchor, `${where}.anchor`),
    category: str(v.category ?? 'Other', `${where}.category`),
    leadDays: int(v.leadDays ?? 3, `${where}.leadDays`),
    status: oneOf(v.status ?? 'active', STATUSES, `${where}.status`),
    usage: oneOf(v.usage ?? 'monthly', USAGES, `${where}.usage`),
  };
  if (v.trialEnds !== undefined) sub.trialEnds = date(v.trialEnds, `${where}.trialEnds`);
  const url = optStr(v.url, `${where}.url`);
  if (url) sub.url = url;
  const notes = optStr(v.notes, `${where}.notes`);
  if (notes) sub.notes = notes;
  if (v.history !== undefined) {
    sub.history = arr(v.history, `${where}.history`).map((p, i) => {
      const w = `${where}.history[${i}]`;
      if (!isObj(p)) throw new SchemaError(`${w} must be an object`);
      return { amount: int(p.amount, `${w}.amount`), until: date(p.until, `${w}.until`) };
    });
  }
  return sub;
}

function parseSplit(v: unknown, where: string): SplitRule {
  if (!isObj(v)) throw new SchemaError(`${where} must be an object`);
  switch (v.kind) {
    case 'equal':
    case 'weighted':
      return { kind: v.kind, among: arr(v.among, `${where}.among`).map((x, i) => str(x, `${where}.among[${i}]`)) };
    case 'shares':
    case 'exact': {
      const rec = need(isObj(v[v.kind === 'shares' ? 'shares' : 'amounts']), v, where);
      const src = (v.kind === 'shares' ? rec.shares : rec.amounts) as Obj;
      const out: Record<string, number> = {};
      for (const [k, x] of Object.entries(src)) out[k] = v.kind === 'exact' ? int(x, `${where}.${k}`) : num(x, `${where}.${k}`);
      return v.kind === 'shares' ? { kind: 'shares', shares: out } : { kind: 'exact', amounts: out };
    }
    default:
      throw new SchemaError(`Unknown split kind at ${where}`);
  }
}

function parseV2(v: Obj): AppState {
  const base = emptyState();
  const settings = isObj(v.settings) ? v.settings : {};
  const split = isObj(v.split) ? v.split : {};
  const cart = isObj(v.cart) ? v.cart : {};
  const sync = isObj(v.sync) ? v.sync : {};
  return {
    version: SCHEMA_VERSION,
    settings: {
      currency: str(settings.currency ?? base.settings.currency, 'settings.currency'),
      theme: oneOf(settings.theme ?? 'system', ['system', 'light', 'dark'] as const, 'settings.theme'),
      highCost: int(settings.highCost ?? base.settings.highCost, 'settings.highCost'),
    },
    subscriptions: arr(v.subscriptions ?? [], 'subscriptions').map((s, i) => parseSubscription(s, `subscriptions[${i}]`)),
    split: {
      currency: str(split.currency ?? 'USD', 'split.currency'),
      members: arr(split.members ?? [], 'split.members').map((m, i) => {
        const w = `split.members[${i}]`;
        if (!isObj(m)) throw new SchemaError(w);
        return { id: str(m.id, `${w}.id`), name: str(m.name, `${w}.name`), weight: num(m.weight ?? 1, `${w}.weight`) };
      }),
      expenses: arr(split.expenses ?? [], 'split.expenses').map((e, i) => {
        const w = `split.expenses[${i}]`;
        if (!isObj(e)) throw new SchemaError(w);
        const exp: Expense = {
          id: str(e.id, `${w}.id`),
          description: str(e.description, `${w}.description`),
          date: date(e.date, `${w}.date`),
          paidBy: str(e.paidBy, `${w}.paidBy`),
          amount: int(e.amount, `${w}.amount`),
          split: parseSplit(e.split, `${w}.split`),
        };
        if (isObj(e.original)) {
          exp.original = {
            currency: str(e.original.currency, `${w}.original.currency`),
            amount: int(e.original.amount, `${w}.original.amount`),
            rate: num(e.original.rate, `${w}.original.rate`),
          };
        }
        return exp;
      }),
      payments: arr(split.payments ?? [], 'split.payments').map((p, i) => {
        const w = `split.payments[${i}]`;
        if (!isObj(p)) throw new SchemaError(w);
        return {
          id: str(p.id, `${w}.id`),
          from: str(p.from, `${w}.from`),
          to: str(p.to, `${w}.to`),
          amount: int(p.amount, `${w}.amount`),
          date: date(p.date, `${w}.date`),
        };
      }),
    },
    cart: {
      items: arr(cart.items ?? [], 'cart.items').map((it, i) => {
        const w = `cart.items[${i}]`;
        if (!isObj(it)) throw new SchemaError(w);
        return {
          id: str(it.id, `${w}.id`),
          name: str(it.name, `${w}.name`),
          unitPrice: int(it.unitPrice, `${w}.unitPrice`),
          qty: int(it.qty, `${w}.qty`),
          taxable: Boolean(it.taxable),
          inBasket: Boolean(it.inBasket),
        };
      }),
      taxRateBps: int(cart.taxRateBps ?? base.cart.taxRateBps, 'cart.taxRateBps'),
      budget: int(cart.budget ?? base.cart.budget, 'cart.budget'),
    },
    sync: {
      owner: str(sync.owner ?? '', 'sync.owner'),
      repo: str(sync.repo ?? '', 'sync.repo'),
      branch: str(sync.branch ?? 'main', 'sync.branch'),
      path: str(sync.path ?? base.sync.path, 'sync.path'),
      encrypt: Boolean(sync.encrypt),
    },
  };
}

/**
 * Upgrade the original single-file "FinHub" export (floats, names as keys,
 * `date` instead of an anchor) to the current schema.
 */
function migrateV1(v: Obj): AppState {
  const s = emptyState();
  const subs = Array.isArray(v.subscriptions) ? v.subscriptions : [];
  s.subscriptions = subs.filter(isObj).map((x) => ({
    id: String(x.id ?? uid()),
    name: String(x.name ?? 'Untitled'),
    amount: toMinor(Number(x.cost) || 0),
    cycle: (CYCLES as readonly string[]).includes(String(x.cycle)) ? (x.cycle as Cycle) : 'monthly',
    anchor: isISODate(x.date) ? x.date : today(),
    category: String(x.category ?? 'Other'),
    leadDays: Number.isInteger(x.lead) ? (x.lead as number) : 3,
    status: 'active',
    usage: 'monthly',
  }));

  const members = (Array.isArray(v.groupMembers) ? v.groupMembers : []).filter(isObj);
  const idByName = new Map<string, string>();
  s.split.members = members.map((m) => {
    const id = uid();
    idByName.set(String(m.name), id);
    return { id, name: String(m.name), weight: Number(m.income) || 1 };
  });
  const everyone = s.split.members.map((m) => m.id);
  s.split.expenses = (Array.isArray(v.sharedExpenses) ? v.sharedExpenses : []).filter(isObj).flatMap((e) => {
    const paidBy = idByName.get(String(e.payer));
    if (!paidBy) return [];
    return [{
      id: String(e.id ?? uid()),
      description: String(e.desc ?? 'Expense'),
      date: today(),
      paidBy,
      amount: toMinor(Number(e.amount) || 0),
      split: { kind: e.method === 'proportional' ? 'weighted' : 'equal', among: everyone } as SplitRule,
    }];
  });

  s.cart.items = (Array.isArray(v.groceryCart) ? v.groceryCart : []).filter(isObj).map((it) => ({
    id: String(it.id ?? uid()),
    name: String(it.name ?? 'Item'),
    unitPrice: toMinor(Number(it.price) || 0),
    qty: Math.max(1, Math.round(Number(it.qty) || 1)),
    taxable: Boolean(it.taxable),
    inBasket: false,
  }));
  if (typeof v.groceryTaxRate === 'number') s.cart.taxRateBps = Math.round(v.groceryTaxRate * 100);
  if (typeof v.groceryBudgetLimit === 'number') s.cart.budget = toMinor(v.groceryBudgetLimit);
  return s;
}

/** Accept any supported saved/imported shape and return a valid current state. */
export function migrate(raw: unknown): AppState {
  if (!isObj(raw)) throw new SchemaError('Expected a JSON object');
  if (raw.version === SCHEMA_VERSION) return parseV2(raw);
  if (raw.version === undefined && ('groceryCart' in raw || 'groupMembers' in raw || 'sharedExpenses' in raw)) {
    return migrateV1(raw);
  }
  if (typeof raw.version === 'number' && raw.version > SCHEMA_VERSION) {
    throw new SchemaError('This file was made by a newer version of Tally.');
  }
  throw new SchemaError('Unrecognised file format');
}

// ---------- repo data file (what the GitHub Action reads) ----------

export interface RepoFile {
  $schema?: string;
  version: 1;
  currency: string;
  updated: string;
  subscriptions: Subscription[];
}

export function toRepoFile(state: AppState): RepoFile {
  return {
    version: 1,
    currency: state.settings.currency,
    updated: new Date().toISOString(),
    subscriptions: state.subscriptions,
  };
}

export function parseRepoFile(raw: unknown): RepoFile {
  if (!isObj(raw) || raw.version !== 1) throw new SchemaError('Expected a Tally repo file (version 1)');
  return {
    version: 1,
    currency: str(raw.currency ?? 'USD', 'currency'),
    updated: str(raw.updated ?? '', 'updated'),
    subscriptions: arr(raw.subscriptions, 'subscriptions').map((s, i) => parseSubscription(s, `subscriptions[${i}]`)),
  };
}
