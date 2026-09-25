import { describe, expect, it } from 'vitest';
import { ARTICLES, GLOSSARY } from '../src/help/articles.ts';
import { referenceFor, search } from '../src/help/search.ts';

/** Real questions, phrased the way people ask them, and the article that answers each. */
const QUESTIONS: [string, string][] = [
  ['how do I add netflix', 'add-subscription'],
  ['why is my gym flagged low value', 'review-flags'],
  ['what does cost per use mean', 'cost-per-use'],
  ['how is the monthly total calculated', 'monthly-total'],
  ['how much would I save if I cancel spotify', 'what-if'],
  ['difference between pause and delete', 'pause'],
  ['my free trial ends friday', 'trials'],
  ['subscription billed on the 31st shows wrong date in february', 'next-charge'],
  ['which month is the most expensive', 'calendar-forecast'],
  ['add renewals to google calendar', 'ics'],
  ['find subscriptions from my bank statement', 'bank-import'],
  ['netflix raised their price', 'price-history'],
  ['split rent with roommates', 'split-basics'],
  ['what is the fair way to split by salary', 'split-methods'],
  ['who pays who', 'settle-up'],
  ['I paid in euros on a trip', 'currency'],
  ['send the balances to my friends in the group chat', 'share-link'],
  ['are groceries taxed', 'sales-tax'],
  ['do I need github', 'sync-overview'],
  ['how do I create a fine-grained token', 'sync-setup'],
  ['I forgot my passphrase', 'encryption'],
  ['use it on my phone and laptop', 'pull'],
  ['not getting email alerts', 'alerts-missing'],
  ['install on iphone', 'install'],
  ['turn on notifications', 'reminders'],
  ['does it work without internet', 'offline'],
  ['is my data safe', 'privacy'],
  ['move my data to a new computer', 'backup'],
  ['github pages site is blank and only shows the title', 'blank-page'],
  ['commit failed 403', 'github-errors'],
  ['I deleted something by accident', 'undo'],
  ['how do I get rid of the sample data', 'sample-data'],
  ['can I use my own gemini api key', 'ai-helpdesk'],
  ['dark mode', 'theme'],
];

const articleIdOf = (h: ReturnType<typeof search>[number]) => (h.kind === 'article' ? h.id : h.term.article);

describe('help search', () => {
  it.each(QUESTIONS)('“%s” → %s (top 3)', (q, expected) => {
    const top3 = search(q, 3).map(articleIdOf);
    expect(top3).toContain(expected);
  });

  it('puts the right answer first for most questions', () => {
    const firstRight = QUESTIONS.filter(([q, id]) => articleIdOf(search(q, 1)[0]!) === id).length;
    expect(firstRight / QUESTIONS.length).toBeGreaterThanOrEqual(0.85);
  });

  it('answers “what is X” with the glossary definition', () => {
    const [top] = search('what is a fine-grained access token');
    expect(top?.kind).toBe('term');
    expect(top?.id).toBe('fine-grained-token');
    expect(search('what does settle up mean')[0]?.id).toMatch(/settle-up/);
  });

  it('returns nothing for gibberish instead of a random article', () => {
    expect(search('qwxz zzvb')).toEqual([]);
    expect(search('the and of')).toEqual([]);
  });

  it('builds a compact reference set for the AI', () => {
    const refs = referenceFor('how do alerts work with encryption');
    expect(refs.length).toBeLessThanOrEqual(4);
    expect(refs.map((a) => a.id)).toContain('encryption');
    expect(referenceFor('zzzz').map((a) => a.id)).toEqual(['what-is-tally']);
  });
});

describe('help library integrity', () => {
  it('has unique ids and valid cross-references', () => {
    const ids = ARTICLES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of GLOSSARY) if (t.article) expect(ids).toContain(t.article);
    for (const a of ARTICLES) if (a.link) expect(a.link.href).toMatch(/^#\/(subscriptions|split|cart|sync|help)(\/new)?$/);
  });

  it('keeps summaries short enough to be an instant answer', () => {
    for (const a of ARTICLES) expect(a.summary.length, a.id).toBeLessThan(320);
  });
});
