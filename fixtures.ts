import { type Page, test as base, expect } from '@playwright/test';

export const TODAY = new Date('2026-09-23T10:00:00');

/**
 * Every test starts on a fresh profile with the sample data, a frozen clock
 * (so "renews tomorrow" is always tomorrow) and the sample banner dismissed.
 */
export const test = base.extend<{ app: Page }>({
  app: async ({ page }, use) => {
    await page.clock.install({ time: TODAY });
    await page.addInitScript(() => localStorage.setItem('tally:banner', 'off'));
    await page.goto('/');
    await expect(page.locator('.figure').first()).toBeVisible();
    await use(page);
  },
});

export { expect };

export const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;
