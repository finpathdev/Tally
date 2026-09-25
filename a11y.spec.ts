import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures.ts';

/** WCAG 2.1 AA checks on every section, in both themes. */
for (const theme of ['light', 'dark'] as const) {
  for (const path of ['subscriptions', 'split', 'cart', 'sync', 'help']) {
    test(`${path} has no WCAG A/AA violations (${theme})`, async ({ app }) => {
      await app.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await app.goto(`/#/${path}`);
      await app.waitForTimeout(300);
      const results = await new AxeBuilder({ page: app }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const summary = results.violations.map((v) => `${v.id}: ${v.nodes.length} × ${v.help}\n    ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('\n    ')}`);
      expect(summary, summary.join('\n')).toEqual([]);
    });
  }
}
