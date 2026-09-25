import { type Envelope, decryptJSON, encryptJSON, isEnvelope } from './crypto.ts';
import { type RepoFile, SchemaError, parseRepoFile } from './schema.ts';

/**
 * The file committed to the repo is either plain:
 *   { version: 1, currency, updated, subscriptions: [...] }
 * or encrypted, where only the timestamp is readable:
 *   { version: 1, updated, encrypted: { alg, kdf, iterations, salt, iv, data } }
 */
export interface SealedRepoFile {
  version: 1;
  updated: string;
  encrypted: Envelope;
}

export class PassphraseRequired extends Error {
  constructor() {
    super('This file is encrypted. Enter the passphrase to read it.');
  }
}

export function isSealed(raw: unknown): raw is SealedRepoFile {
  return typeof raw === 'object' && raw !== null && isEnvelope((raw as SealedRepoFile).encrypted);
}

export async function seal(file: RepoFile, passphrase: string, iterations?: number): Promise<SealedRepoFile> {
  return { version: 1, updated: file.updated, encrypted: await encryptJSON(file, passphrase, iterations) };
}

/** Read a repo file of either kind. Throws PassphraseRequired, DecryptError or SchemaError. */
export async function openRepoFile(raw: unknown, passphrase?: string): Promise<RepoFile & { wasEncrypted: boolean }> {
  if (isSealed(raw)) {
    if (!passphrase) throw new PassphraseRequired();
    const inner = await decryptJSON(raw.encrypted, passphrase);
    return { ...parseRepoFile(inner), wasEncrypted: true };
  }
  if (typeof raw === 'object' && raw !== null && 'encrypted' in raw) {
    throw new SchemaError('The encrypted section of this file is damaged.');
  }
  return { ...parseRepoFile(raw), wasEncrypted: false };
}
