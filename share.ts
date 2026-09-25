import type { ISODate } from './dates.ts';
import { type AppState, SchemaError, emptyState, migrate } from './schema.ts';
import { type Expense, shares } from './settle.ts';

/**
 * Read-only split links. The whole group snapshot is compressed into the
 * URL fragment (the part after #), which browsers never send to any server,
 * so sharing needs no backend and nothing is uploaded anywhere.
 *
 * Privacy: members' incomes (used for "By income" splits) are never included.
 * Every expense is converted to the exact amounts it produced, so friends
 * see identical balances without seeing anyone's income.
 */

export type SplitState = AppState['split'];

export interface SharedSplit {
  v: 1;
  sharedOn: ISODate;
  split: SplitState;
}

/** Strip incomes by freezing every split into exact amounts. */
export function redactForSharing(split: SplitState): SplitState {
  const expenses: Expense[] = split.expenses.map((e) => {
    const exact = Object.fromEntries(shares(e, split.members));
    const out: Expense = { ...e, split: { kind: 'exact', amounts: exact } };
    return out;
  });
  return {
    currency: split.currency,
    members: split.members.map((m) => ({ id: m.id, name: m.name, weight: 1 })),
    expenses,
    payments: split.payments.map((p) => ({ ...p })),
  };
}

// ---------- compact encoding ----------

const toB64Url = (bytes: Uint8Array) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64Url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

const canCompress = () => typeof CompressionStream !== 'undefined';

/** Encode a snapshot as a URL-safe string. "z" = deflate-compressed JSON, "j" = plain JSON. */
export async function encodeShare(split: SplitState, sharedOn: ISODate): Promise<string> {
  const payload: SharedSplit = { v: 1, sharedOn, split: redactForSharing(split) };
  const json = new TextEncoder().encode(JSON.stringify(payload));
  if (canCompress()) return 'z' + toB64Url(await pipe(json, new CompressionStream('deflate-raw')));
  return 'j' + toB64Url(json);
}

export class ShareError extends Error {}

export async function decodeShare(token: string): Promise<SharedSplit> {
  let json: string;
  try {
    const bytes = fromB64Url(token.slice(1));
    if (token[0] === 'z') json = new TextDecoder().decode(await pipe(bytes, new DecompressionStream('deflate-raw')));
    else if (token[0] === 'j') json = new TextDecoder().decode(bytes);
    else throw new Error('prefix');
  } catch {
    throw new ShareError('This link is incomplete or damaged. Ask for it to be sent again.');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new ShareError('This link is damaged.');
  }
  const r = raw as Partial<SharedSplit>;
  if (r?.v !== 1 || typeof r.sharedOn !== 'string') throw new ShareError('This link was made by a newer version of Tally.');
  // Reuse the app's full validator by wrapping the split in a state object.
  try {
    const state = migrate({ ...emptyState(), split: r.split });
    return { v: 1, sharedOn: r.sharedOn, split: state.split };
  } catch (e) {
    throw new ShareError(e instanceof SchemaError ? `This link contains invalid data (${e.message}).` : 'This link is damaged.');
  }
}

/** Links longer than this may be cut off by some chat apps. */
export const SAFE_LINK_LENGTH = 8000;
