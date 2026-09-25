import { expect, test } from './fixtures.ts';

test('income split preview, settle up, and mark paid', async ({ app }) => {
  await app.goto('/#/split');
  await expect(app.locator('.transfers li')).toHaveCount(2);

  await app.getByRole('button', { name: 'Log expense' }).click();
  const d = app.getByRole('dialog');
  await d.getByLabel('What was it?').fill('Taxi');
  await d.getByLabel('Amount', { exact: true }).fill('100');
  await d.getByLabel('Split').selectOption('weighted');
  await expect(d.locator('.share-preview')).toContainText('$40.00'); // Alex: 5000 / 12500
  await d.getByRole('button', { name: 'Log expense' }).click();
  await expect(app.locator('table')).toContainText('Taxi');

  const before = await app.locator('.transfers li').count();
  await app.locator('.transfers li').first().getByRole('button', { name: 'Mark paid' }).click();
  await expect(app.locator('.transfers li')).toHaveCount(before - 1);
  await expect(app.locator('.payment-row')).toHaveCount(1);
});

test('read-only share link hides incomes and can be saved', async ({ app, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await app.goto('/#/split');
  await app.getByRole('button', { name: 'Share read-only link' }).click();
  await expect(app.locator('.toast', { hasText: 'Link copied' })).toBeVisible();
  const url = await app.evaluate(() => navigator.clipboard.readText());
  expect(url).toMatch(/#\/shared\/z[\w-]+$/);

  // Open it as a friend would: a fresh profile with no data.
  const friend = await context.browser()!.newPage();
  await friend.goto(url.replace(/^https?:\/\/[^/]+/, 'http://localhost:4173'));
  await expect(friend.getByRole('heading', { name: 'Who owes whom' })).toBeVisible();
  await expect(friend.locator('.transfers li')).toHaveCount(2);
  await expect(friend.locator('body')).not.toContainText('5000');
  await friend.getByRole('button', { name: 'Save a copy to my Tally' }).click();
  await friend.getByRole('dialog').getByRole('button', { name: 'Save a copy' }).click();
  await expect(friend).toHaveURL(/#\/split$/);
  await expect(friend.locator('table')).toContainText('Weekend cabin');
  await friend.close();
});

test('cart: over budget, suggested cut, back under', async ({ app }) => {
  await app.goto('/#/cart');
  await app.locator('.quick-add input[name=name]').fill('Olive oil');
  await app.locator('.quick-add input[name=price]').fill('85');
  await app.locator('.quick-add input[name=price]').press('Enter');
  await expect(app.locator('.budget-msg')).toContainText('over budget');
  await app.locator('.cut-hint').getByRole('button').click();
  await expect(app.locator('.budget-msg')).toContainText('left of');
});

test('keyboard: switch sections, open and close a dialog, focus returns', async ({ app, isMobile }) => {
  test.skip(isMobile, 'keyboard shortcuts are for desktop');
  await app.keyboard.press('3');
  await expect(app).toHaveURL(/#\/cart$/);
  await app.keyboard.press('1');
  await app.getByRole('button', { name: 'Add subscription' }).first().focus();
  await app.keyboard.press('Enter');
  await expect(app.getByRole('dialog')).toBeVisible();
  await app.keyboard.press('Escape');
  await expect(app.getByRole('dialog')).toHaveCount(0);
  await expect(app.getByRole('button', { name: 'Add subscription' }).first()).toBeFocused();
});
