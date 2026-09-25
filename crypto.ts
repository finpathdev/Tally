/**
 * Passphrase encryption for the repo file, using only the Web Crypto API
 * (available in every modern browser and in Node 20+, so the GitHub Action
 * uses the exact same code).
 *
 * - Key: PBKDF2-SHA-256 with a random 16-byte salt and 600,000 iterations
 *   (OWASP's 2023+ recommendation for PBKDF2-SHA-256).
 * - Cipher: AES-256-GCM with a random 12-byte IV. GCM is authenticated, so a
 *   wrong passphrase or any tampering with the file is detected, never
 *   silently decrypted into garbage.
 * - The passphrase never leaves the device and is never stored in the file.
 */

export interface Envelope {
  alg: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA-256';
  iterations: number;
  salt: string;
  iv: string;
  data: string;
}

export class DecryptError extends Error {}

export const ITERATIONS = 600_000;

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptJSON(value: unknown, passphrase: string, iterations = ITERATIONS): Promise<Envelope> {
  if (passphrase.length < 8) throw new RangeError('Use a passphrase of at least 8 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value))));
  return { alg: 'AES-256-GCM', kdf: 'PBKDF2-SHA-256', iterations, salt: b64(salt), iv: b64(iv), data: b64(data) };
}

export async function decryptJSON(env: Envelope, passphrase: string): Promise<unknown> {
  if (env.alg !== 'AES-256-GCM' || env.kdf !== 'PBKDF2-SHA-256') throw new DecryptError('Unsupported encryption format.');
  let plain: ArrayBuffer;
  try {
    const key = await deriveKey(passphrase, unb64(env.salt), env.iterations);
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.data));
  } catch {
    throw new DecryptError('Wrong passphrase, or the file was changed after it was encrypted.');
  }
  return JSON.parse(dec.decode(plain));
}

export function isEnvelope(v: unknown): v is Envelope {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as Envelope).alg === 'AES-256-GCM' &&
    typeof (v as Envelope).data === 'string' &&
    typeof (v as Envelope).salt === 'string' &&
    typeof (v as Envelope).iv === 'string' &&
    Number.isInteger((v as Envelope).iterations)
  );
}
