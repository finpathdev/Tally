import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

const ANSWER = ['**Settle up** shows the fewest payments ', 'that bring everyone to zero.\n\n', '1. Open [Split](#/split)\n2. Click **Mark paid** when someone pays'];

/** Stand-in for Google's Gemini streaming endpoint, in its real SSE format. */
async function fakeGemini(page: Page) {
  const calls: { system: string; contents: { role: string }[] }[] = [];
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const b = route.request().postDataJSON();
    calls.push({ system: b.systemInstruction.parts[0].text, contents: b.contents });
    const body = ANSWER.map((t) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\r\n\r\n`).join('');
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body });
  });
  return calls;
}

const setKey = (page: Page, shareData = false) =>
  page.evaluate((share) => localStorage.setItem('tally:ai', JSON.stringify({ provider: 'auto', keys: { gemini: 'AIzaTEST' }, models: {}, openaiBaseUrl: 'https://api.openai.com/v1', shareData: share })), shareData);

test('answers from the help library with no AI set up, and offers setup', async ({ app }) => {
  await app.goto('/#/help');
  await app.getByLabel('Your question').fill('how do I split rent with roommates');
  await app.getByLabel('Your question').press('Enter');
  await expect(app.locator('.kb-title').first()).toHaveText('Splitting shared costs');
  await expect(app.locator('.ai-off')).toContainText('Set up AI answers');
  await app.locator('.kb-more summary').first().click();
  await expect(app.locator('.kb-more .md').first()).toContainText('Log expense');
});

test('streams an AI answer grounded in the help articles', async ({ app }) => {
  const calls = await fakeGemini(app);
  await setKey(app);
  await app.goto('/#/split');
  await app.getByRole('button', { name: /^Ask/ }).last().click();
  const drawer = app.locator('dialog.drawer');
  await drawer.getByLabel('Your question').fill('what does settle up do?');
  await drawer.getByLabel('Your question').press('Enter');
  await expect(drawer.locator('.ai-answer .md')).toContainText('fewest payments that bring everyone to zero');
  await expect(drawer.locator('.ai-answer a[href="#/split"]')).toHaveCount(1);
  await expect(drawer.locator('.ai-answer .eyebrow')).toContainText('Google Gemini');
  expect(calls[0]!.system).toContain('### Settle up and "fewest payments"');
  expect(calls[0]!.system).toContain('Split tab');
  expect(calls[0]!.system).not.toContain("PERSON'S TALLY DATA"); // sharing is off by default

  // A follow-up carries the conversation.
  await drawer.getByLabel('Your question').fill('and how do I share it?');
  await drawer.getByLabel('Your question').press('Enter');
  await expect(drawer.locator('.ex')).toHaveCount(2);
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1]!.contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
});

test('shares data only when allowed, and never incomes', async ({ app }) => {
  const calls = await fakeGemini(app);
  await setKey(app, true);
  await app.goto('/#/help');
  await app.getByLabel('Your question').fill('who owes whom?');
  await app.getByLabel('Your question').press('Enter');
  await expect(app.locator('.ai-answer .md')).toBeVisible();
  expect(calls[0]!.system).toContain("PERSON'S TALLY DATA");
  expect(calls[0]!.system).toContain('pays Alex');
  expect(calls[0]!.system).not.toMatch(/5,?000/);
});

test('shows a clear error when the key is rejected', async ({ app }) => {
  await app.route('https://generativelanguage.googleapis.com/**', (r) =>
    r.fulfill({ status: 400, body: '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}' }));
  await setKey(app);
  await app.goto('/#/help');
  await app.getByLabel('Your question').fill('what is a free trial');
  await app.getByLabel('Your question').press('Enter');
  await expect(app.locator('.ai-error')).toContainText('didn’t accept the API key');
  await expect(app.locator('.kb-title').first()).toBeVisible(); // the built-in answer still helps
});

test('“?” tips explain terms in place', async ({ app }) => {
  // The tip next to the monthly total is visible on every screen size.
  await app.getByRole('button', { name: 'What is “Per month (average)”?' }).click();
  const d = app.getByRole('dialog');
  await expect(d).toContainText('yearly cost divided by 12');
  await d.getByRole('link', { name: 'Read more' }).click();
  await expect(app.locator('#help-monthly-total')).toHaveAttribute('open', '');
});

test('deep links open an article; settings test the key', async ({ app }) => {
  await fakeGemini(app);
  await app.goto('/#/help/encryption');
  await expect(app.locator('#help-encryption')).toHaveAttribute('open', '');
  await app.goto('/#/help/settings');
  await app.locator('[data-key=ai-key-gemini]').fill('AIzaTEST');
  await app.locator('[data-key=ai-key-gemini]').press('Tab');
  await expect(app.locator('.ai-chip')).toContainText('Google Gemini');
  await app.getByRole('button', { name: 'Test the assistant' }).click();
  await expect(app.locator('.test-result')).toContainText('Google Gemini replied');
});
