import { formatMoney } from '../lib/money.ts';
import type { AppState } from '../lib/schema.ts';
import { balances, simplify } from '../lib/settle.ts';
import { cartTotals } from '../lib/cart.ts';
import { audit, monthlyCost, nextRenewal, totals } from '../lib/subscriptions.ts';
import type { Article } from './articles.ts';

/**
 * The instructions the AI gets. Answers about *how Tally works* must come
 * from the reference articles (retrieved for each question), so the
 * assistant can't invent buttons or features.
 */
export function buildSystemPrompt(opts: {
  reference: Article[];
  screen: string;
  today: string;
  data?: string;
}): string {
  const ref = opts.reference.map((a) => `### ${a.title}\n${a.body}`).join('\n\n');
  return `You are the help desk inside Tally, a free, local-first web app for tracking subscriptions, splitting shared costs with friends, and totalling a shopping cart with sales tax. Your job is to explain how to use Tally and what its money terms mean, to people who may not be familiar with finance or technology.

How to answer:
- Plain, friendly language. Short: under 120 words unless step-by-step instructions are needed.
- For how-to questions, give numbered steps and name buttons and fields exactly as they appear in the reference, in **bold**.
- For "what does X mean" questions, give a one-sentence definition, then a small example with numbers.
- Link to a section of the app when helpful, using these exact links: [Subscriptions](#/subscriptions), [Split](#/split), [Cart](#/cart), [Sync](#/sync), [Help](#/help).
- Only describe Tally features that appear in the reference. If the reference doesn't cover something, say you're not sure Tally does that and suggest checking the Help articles. Never invent buttons, settings or features.
- You may explain general money ideas (sales tax, free trials, splitting costs, exchange rates). Do not give personal investment, tax or legal advice; for those, suggest a qualified professional.
- Never ask for passwords, API keys, GitHub tokens or passphrases, and tell the person not to paste them into the chat.
- If the person's data is provided below, use it to give a specific answer (for example, which subscription is flagged and why).

Today is ${opts.today}. The person is currently looking at: ${opts.screen}.

REFERENCE (how Tally works):
${ref}${opts.data ? `\n\nTHE PERSON'S TALLY DATA (shared with their permission):\n${opts.data}` : ''}`;
}

/**
 * A compact, privacy-conscious summary of the person's data. Incomes are
 * never included, and neither are GitHub settings or tokens.
 */
export function dataSummary(state: AppState, today: string): string {
  const cur = state.settings.currency;
  const m = (x: number, c = cur) => formatMoney(x, c, { locale: 'en-US' });
  const lines: string[] = [];

  const t = totals(state.subscriptions);
  lines.push(`Subscriptions: ${t.count} active, ${m(t.monthly)} per month on average, ${m(t.annual)} per year.`);
  for (const s of state.subscriptions.slice(0, 30)) {
    const flags = audit(s, today, { highCost: state.settings.highCost, costPerUse: 1000 }).map((f) => f.label);
    lines.push(
      `- ${s.name}: ${m(s.amount)} ${s.cycle} (${m(monthlyCost(s))}/mo), ${s.status}${s.status === 'trial' && s.trialEnds ? ` until ${s.trialEnds}` : ''}, next charge ${s.status === 'paused' ? 'n/a' : nextRenewal(s, today)}, used ${s.usage}, remind ${s.leadDays} days before${flags.length ? `, flags: ${flags.join(', ')}` : ''}`,
    );
  }

  const { members, expenses, payments, currency } = state.split;
  if (members.length) {
    try {
      const bal = balances(members, expenses, payments);
      const name = (id: string) => members.find((p) => p.id === id)?.name ?? '?';
      lines.push(`Split group (${currency}): ${members.map((p) => p.name).join(', ')}; ${expenses.length} expenses, ${payments.length} payments recorded.`);
      lines.push(`Balances: ${members.map((p) => `${p.name} ${m(bal.get(p.id) ?? 0, currency)}`).join(', ')} (positive = is owed).`);
      const tr = simplify(bal);
      lines.push(tr.length ? `Suggested payments: ${tr.map((x) => `${name(x.from)} pays ${name(x.to)} ${m(x.amount, currency)}`).join('; ')}.` : 'Everyone is settled.');
    } catch {
      /* skip invalid split data */
    }
  }

  const ct = cartTotals(state.cart.items, state.cart.taxRateBps);
  if (state.cart.items.length) {
    lines.push(
      `Cart: ${state.cart.items.length} items, subtotal ${m(ct.subtotal)}, tax ${m(ct.tax)} at ${state.cart.taxRateBps / 100}%, total ${m(ct.total)}, budget ${m(state.cart.budget)}.`,
    );
  }
  return lines.join('\n');
}

/** Human description of the screen for context, e.g. "the Split tab". */
export function describeScreen(hash: string): string {
  const [tab] = hash.replace(/^#\/?/, '').split('/');
  const names: Record<string, string> = {
    subscriptions: 'the Subscriptions tab (list of subscriptions, calendar, and bank import)',
    split: 'the Split tab (shared expenses, balances and settle up)',
    cart: 'the Cart tab (shopping list with sales tax and budget)',
    sync: 'the Sync tab (GitHub sync, encryption, backups, reminders and preferences)',
    help: 'the Help tab',
    shared: 'a read-only shared split link',
  };
  return names[tab ?? ''] ?? names.subscriptions!;
}
