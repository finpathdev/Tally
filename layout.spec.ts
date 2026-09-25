import { expect, test } from './fixtures.ts';

/** No screen may be wider than the phone: that zooms the whole page out. */
const screens: [string, string | null][] = [
  ['/#/subscriptions', null],
  ['/#/subscriptions', 'Calendar'],
  ['/#/subscriptions', 'Find in bank export'],
  ['/#/split', null],
  ['/#/cart', null],
  ['/#/sync', null],
  ['/#/help', null],
];

for (const [path, mode] of screens) {
  test(`fits the screen: ${path}${mode ? ` (${mode})` : ''}`, async ({ app }) => {
    await app.goto(path);
    if (mode) await app.getByRole('radio', { name: mode }).click();
    await app.waitForTimeout(200);
    const [inner, scroll] = await app.evaluate(() => [window.innerWidth, document.documentElement.scrollWidth]);
    expect(scroll).toBeLessThanOrEqual(inner);
  });
}
