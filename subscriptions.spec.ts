import { expect, test } from './fixtures.ts';

test('shows the sample totals and flags', async ({ app }) => {
  await expect(app.locator('.figure').first()).toContainText('$114.97');
  await expect(app.locator('.soon li').first()).toContainText('tomorrow');
  await expect(app.locator('.flag', { hasText: 'Unused' })).toBeVisible();
});

test('add, edit price, and undo a delete', async ({ app }) => {
  await app.getByRole('button', { name: 'Add subscription' }).first().click();
  const dialog = app.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Cloud Storage');
  await dialog.getByLabel(/Price/).fill('2.99');
  await dialog.getByRole('button', { name: 'Add subscription' }).click();
  await expect(app.locator('.figure').first()).toContainText('$117.96');

  // Raising a price records history and flags the increase.
  await app.getByRole('button', { name: 'Edit Cloud Storage' }).click();
  await app.getByRole('dialog').getByLabel(/Price/).fill('3.99');
  await app.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
  await expect(app.locator('tr', { hasText: 'Cloud Storage' }).locator('.flag', { hasText: 'Up 33%' })).toBeVisible();

  await app.getByRole('button', { name: 'Delete Cloud Storage' }).click();
  await expect(app.locator('tr', { hasText: 'Cloud Storage' })).toHaveCount(0);
  await app.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(app.locator('tr', { hasText: 'Cloud Storage' })).toHaveCount(1);
});

test('what-if savings, search and sort', async ({ app }) => {
  await app.locator('tr', { hasText: 'Gym Membership' }).getByLabel('What if I cancel?').check();
  await expect(app.locator('.whatif-line')).toContainText('$540.00/yr');

  await app.getByPlaceholder('Search subscriptions').fill('stream');
  await expect(app.locator('.subs-table tbody tr')).toHaveCount(1);
  await app.getByPlaceholder('Search subscriptions').fill('');
  await app.getByLabel('Sort by').selectOption('cost');
  await expect(app.locator('.subs-table tbody tr').first()).toContainText('Gym Membership');
});

test('finds subscriptions in a bank export, including a price rise', async ({ app }) => {
  await app.getByRole('radio', { name: 'Find in bank export' }).click();
  await app.locator('.dropzone input').setInputFiles('examples/bank-export-sample.csv');
  const rows = app.locator('.import tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(rows.filter({ hasText: 'Netflix.com' })).toContainText('up from $15.49');
  await app.getByRole('button', { name: /Add 4 selected/ }).click();
  await expect(app.locator('.subs-table')).toContainText('Planet Fitness');
});

test('calendar shows the 12-month forecast and exports .ics', async ({ app }) => {
  await app.getByRole('radio', { name: 'Calendar' }).click();
  await expect(app.locator('.forecast .fc-bar')).toHaveCount(12);
  const download = app.waitForEvent('download');
  await app.getByRole('button', { name: 'Add to calendar' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('tally-renewals.ics');
  const text = await (await file.createReadStream()).toArray().then((c) => Buffer.concat(c).toString());
  expect(text).toContain('BEGIN:VCALENDAR');
  expect(text).toContain('Gym Membership');
});
