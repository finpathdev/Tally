import { expect, test } from './fixtures.ts';

/** A tiny in-memory stand-in for the GitHub Contents API. */
async function fakeGitHub(page: import('@playwright/test').Page) {
  const store: { content?: string; sha?: string } = {};
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      return store.content
        ? route.fulfill({ json: { sha: store.sha, content: store.content, encoding: 'base64' } })
        : route.fulfill({ status: 404, json: {} });
    }
    const body = req.postDataJSON();
    store.content = body.content;
    store.sha = String(Date.now());
    return route.fulfill({ json: { commit: { html_url: 'https://github.com/me/money/commit/1' } } });
  });
  return store;
}

test('encrypted commit stores no readable data, and pulls back with the passphrase', async ({ app }) => {
  test.setTimeout(60_000);
  const gh = await fakeGitHub(app);
  await app.goto('/#/sync');
  await app.getByLabel('Owner').fill('me');
  await app.getByLabel('Repository').fill('money');
  await app.getByRole('textbox', { name: 'Fine-grained access token' }).fill('github_pat_test');
  await app.getByLabel('Encrypt the file with a passphrase').check();
  await app.getByRole('textbox', { name: /^Passphrase/ }).fill('correct horse battery staple');
  await app.getByRole('button', { name: 'Commit to GitHub' }).click();
  await expect(app.locator('.toast', { hasText: 'Committed to GitHub' })).toBeVisible({ timeout: 20_000 });

  const committed = Buffer.from(gh.content!, 'base64').toString();
  expect(JSON.parse(committed).encrypted.alg).toBe('AES-256-GCM');
  expect(committed).not.toContain('Netflix');

  // Wipe local subscriptions, then pull them back.
  await app.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('tally:v2')!);
    s.subscriptions = [];
    localStorage.setItem('tally:v2', JSON.stringify(s));
  });
  await app.reload();
  await app.getByRole('textbox', { name: 'Fine-grained access token' }).fill('github_pat_test');
  await app.getByRole('textbox', { name: /^Passphrase/ }).fill('wrong passphrase!!');
  await app.getByRole('button', { name: 'Pull from GitHub' }).click();
  await expect(app.locator('.toast', { hasText: 'Wrong passphrase' })).toBeVisible({ timeout: 20_000 });
  await app.getByRole('textbox', { name: /^Passphrase/ }).fill('correct horse battery staple');
  await app.getByRole('button', { name: 'Pull from GitHub' }).click();
  await app.getByRole('dialog').getByRole('button', { name: 'Replace subscriptions' }).click({ timeout: 20_000 });
  await app.goto('/#/subscriptions');
  await expect(app.locator('.figure').first()).toContainText('$114.97');
});

test('installable app: manifest, service worker and offline start', async ({ app, context, isMobile }) => {
  test.skip(isMobile, 'covered once on desktop');
  const manifest = await (await app.request.get('/manifest.webmanifest')).json();
  expect(manifest.icons.some((i: { sizes: string; purpose?: string }) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true);
  await app.evaluate(() => navigator.serviceWorker.ready);
  await app.reload(); // now controlled by the service worker
  await context.setOffline(true);
  await app.reload();
  await expect(app.locator('.figure').first()).toContainText('$114.97');
  await context.setOffline(false);
});

test('install button uses the browser prompt when offered', async ({ app, isMobile }) => {
  test.skip(isMobile, 'desktop Chrome path');
  await expect(app.locator('.install-btn')).toBeHidden();
  await app.evaluate(() => {
    const e = new Event('beforeinstallprompt') as Event & { prompt: () => Promise<void>; userChoice: Promise<unknown> };
    e.prompt = async () => { (window as unknown as { prompted: boolean }).prompted = true; };
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
  });
  await app.locator('.install-btn').click();
  expect(await app.evaluate(() => (window as unknown as { prompted?: boolean }).prompted)).toBe(true);
});
