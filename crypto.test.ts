import { describe, expect, it } from 'vitest';
import { DecryptError, decryptJSON, encryptJSON } from '../src/lib/crypto.ts';
import { PassphraseRequired, openRepoFile, seal } from '../src/lib/repofile.ts';
import { demoState, toRepoFile } from '../src/lib/schema.ts';

// Fewer iterations keep the suite fast; production uses 600,000.
const FAST = 1_000;

describe('encryption', () => {
  it('round-trips JSON, including non-ASCII text', async () => {
    const env = await encryptJSON({ name: 'Café ☕', n: 1 }, 'correct horse battery', FAST);
    expect(env.alg).toBe('AES-256-GCM');
    expect(env.data).not.toContain('Caf');
    expect(await decryptJSON(env, 'correct horse battery')).toEqual({ name: 'Café ☕', n: 1 });
  });

  it('uses a fresh salt and IV every time', async () => {
    const a = await encryptJSON({ x: 1 }, 'passphrase!', FAST);
    const b = await encryptJSON({ x: 1 }, 'passphrase!', FAST);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });

  it('rejects a wrong passphrase and any tampering', async () => {
    const env = await encryptJSON({ x: 1 }, 'passphrase!', FAST);
    await expect(decryptJSON(env, 'passphrase?')).rejects.toThrow(DecryptError);
    const bytes = atob(env.data).split('');
    bytes[0] = String.fromCharCode(bytes[0]!.charCodeAt(0) ^ 1);
    await expect(decryptJSON({ ...env, data: btoa(bytes.join('')) }, 'passphrase!')).rejects.toThrow(DecryptError);
  });

  it('refuses short passphrases', async () => {
    await expect(encryptJSON({}, 'short')).rejects.toThrow(/8 characters/);
  });
});

describe('repo file', () => {
  it('seals and opens the subscriptions file', async () => {
    const plain = toRepoFile(demoState('2026-09-23'));
    const sealed = await seal(plain, 'my long passphrase', FAST);
    const text = JSON.stringify(sealed);
    expect(text).not.toContain('Netflix');
    await expect(openRepoFile(JSON.parse(text))).rejects.toThrow(PassphraseRequired);
    const opened = await openRepoFile(JSON.parse(text), 'my long passphrase');
    expect(opened.wasEncrypted).toBe(true);
    expect(opened.subscriptions.map((s) => s.name)).toEqual(plain.subscriptions.map((s) => s.name));
  });

  it('still opens plain files', async () => {
    const plain = JSON.parse(JSON.stringify(toRepoFile(demoState('2026-09-23'))));
    expect((await openRepoFile(plain)).wasEncrypted).toBe(false);
  });
});
