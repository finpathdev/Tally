/**
 * Tally's help library. It is the single source of truth for the helpdesk:
 * the offline search answers from it directly, and the AI assistant is
 * given the most relevant articles as its reference, so AI answers stay
 * consistent with how the app actually works.
 *
 * Body text uses a tiny Markdown subset: paragraphs, **bold**, `code`,
 * "- " bullet lists, "1. " numbered lists, and [links](#/tab).
 */

export type Section =
  | 'Getting started'
  | 'Subscriptions'
  | 'Split'
  | 'Cart'
  | 'Sync & alerts'
  | 'App & reminders'
  | 'Privacy & data'
  | 'Troubleshooting';

export const SECTIONS: Section[] = [
  'Getting started',
  'Subscriptions',
  'Split',
  'Cart',
  'Sync & alerts',
  'App & reminders',
  'Privacy & data',
  'Troubleshooting',
];

export interface Article {
  id: string;
  section: Section;
  title: string;
  /** Words people might use that don't appear in the text. */
  keywords: string[];
  /** One or two sentences: shown as the instant answer. */
  summary: string;
  body: string;
  /** Where in the app this lives, for an "Open" button. */
  link?: { label: string; href: string };
}

export interface Term {
  id: string;
  term: string;
  aliases: string[];
  definition: string;
  /** Article with more detail. */
  article?: string;
}

export const ARTICLES: Article[] = [
  // ---------------- Getting started ----------------
  {
    id: 'what-is-tally',
    section: 'Getting started',
    title: 'What Tally does',
    keywords: ['about', 'overview', 'purpose', 'features', 'start', 'intro', 'how does this work', 'what is this'],
    summary:
      'Tally keeps track of the money that repeats: subscriptions you pay for, costs you share with friends, and a shopping list that shows the real total with tax.',
    body: `Tally has four sections:

- **Subscriptions**: everything you pay for on a schedule, what it costs per month and year, when it next charges, and which ones deserve a second look.
- **Split**: shared costs with friends or housemates, split fairly, and the fewest payments needed to settle up.
- **Cart**: a shopping list that adds sales tax and warns you before you go over budget.
- **Sync**: optional. Saves your subscriptions to your own GitHub repository and sends renewal alerts.

Everything is saved in this browser. Nothing is uploaded unless you use Sync or share a link.`,
  },
  {
    id: 'sample-data',
    section: 'Getting started',
    title: 'Sample data and starting fresh',
    keywords: ['demo', 'example', 'fake', 'reset', 'clear', 'start over', 'clean slate', 'delete everything', 'erase'],
    summary:
      'The first time you open Tally it shows sample data so you can look around. Use "Start with a clean slate" on the banner, or Sync → "Erase everything", to remove it.',
    body: `The subscriptions, people and cart items you see on your first visit are examples.

- To remove them, click **Start with a clean slate** in the banner at the top.
- Later, you can use **Sync → Backup & reports → Erase everything**, or **Load sample data** to bring the examples back.

Both actions can be undone right after with **Undo**.`,
    link: { label: 'Open Sync', href: '#/sync' },
  },
  {
    id: 'undo',
    section: 'Getting started',
    title: 'Undo a change',
    keywords: ['mistake', 'deleted by accident', 'revert', 'go back', 'restore', 'oops'],
    summary: 'Every change can be undone: click Undo in the message that appears, use the curved-arrow button at the top, or press U.',
    body: `After most changes a message appears at the bottom with an **Undo** button.

You can also use the **undo arrow** at the top right, or press **U** on a keyboard. Tally remembers your last 30 changes.`,
  },
  {
    id: 'shortcuts',
    section: 'Getting started',
    title: 'Keyboard shortcuts',
    keywords: ['keys', 'hotkeys', 'keyboard', 'faster'],
    summary: 'Press 1–5 to switch sections, N to add something, H to ask the help desk, U to undo, T to change the theme, and ? to see the list.',
    body: `- **1–5**: switch between Subscriptions, Split, Cart, Sync and Help
- **N**: add a subscription, log an expense, or jump to the cart's add row
- **H**: ask the help desk
- **U**: undo the last change
- **T**: switch between system, light and dark theme
- **?**: show all shortcuts

Shortcuts don't fire while you're typing in a field.`,
  },
  {
    id: 'theme',
    section: 'Getting started',
    title: 'Dark mode and light mode',
    keywords: ['dark', 'light', 'theme', 'colors', 'night'],
    summary: 'Use the sun/moon button at the top right (or press T) to switch between matching your system, light, and dark.',
    body: `The theme button at the top right cycles through **match system → light → dark**. Your choice is saved on this device.`,
  },

  // ---------------- Subscriptions ----------------
  {
    id: 'add-subscription',
    section: 'Subscriptions',
    title: 'Add or edit a subscription',
    keywords: ['new', 'create', 'add', 'track', 'netflix', 'spotify', 'change price', 'edit'],
    summary:
      'Click "Add subscription", enter the name, price, how often it bills and the next charge date. To change one later, click the pencil icon on its row.',
    body: `1. On **Subscriptions**, click **Add subscription** (or press **N**).
2. Enter the **name** and **price** per billing cycle.
3. Choose how often it's **billed**: weekly, monthly, quarterly or yearly.
4. Pick the **next charge** date. Tally works out every renewal after that.
5. Optional: set **Remind me**, the **category**, **how often you use it**, and a **cancel or manage link**.

To edit, click the **pencil** on the row. If you change the price, Tally keeps the old price in its history and flags increases.`,
    link: { label: 'Add a subscription', href: '#/subscriptions/new' },
  },
  {
    id: 'monthly-total',
    section: 'Subscriptions',
    title: 'How the monthly and yearly totals work',
    keywords: ['total', 'per month', 'per year', 'cost', 'spend', 'how much', 'average', 'calculated', 'annual cost'],
    summary:
      'Tally converts every subscription to a yearly cost (weekly × 52, monthly × 12, quarterly × 4, yearly × 1) and divides by 12 for the monthly figure. Paused subscriptions are left out.',
    body: `Subscriptions bill on different schedules, so Tally converts each one to a **yearly cost** first:

- weekly × 52
- monthly × 12
- quarterly × 4
- yearly × 1

The big **per month** number is the yearly total divided by 12. It's an average: a $120 yearly plan adds $10 to every month, even though you pay it all at once. To see the months when money actually leaves your account, open **Calendar** and look at **Next 12 months**.

**Paused** subscriptions don't count toward any total.`,
    link: { label: 'Open Calendar', href: '#/subscriptions' },
  },
  {
    id: 'review-flags',
    section: 'Subscriptions',
    title: 'What the review flags mean',
    keywords: ['flag', 'badge', 'warning', 'red', 'low value', 'high cost', 'unused', 'trial ending', 'annual renewal', 'up %', 'review', 'why is it flagged', 'audit'],
    summary:
      'Flags point out subscriptions worth a second look: Unused, Low value (high cost per use), High cost, Trial ending, Annual renewal (a big charge within 30 days) and Up N% (the price went up).',
    body: `Each flag has a specific reason:

- **Unused**: you set "How often you use it" to *Never*.
- **Low value**: the estimated **cost per use** is over $10.
- **High cost**: it costs more per month than your threshold (default $20; change it in **Sync → Preferences**).
- **Trial ending**: a free trial converts to paid within its reminder window (at least 3 days).
- **Annual renewal**: a yearly plan charges within the next 30 days.
- **Up N%**: you raised the price in the last six months.

A flag isn't a verdict. It's a prompt to decide whether something is still worth it.`,
  },
  {
    id: 'cost-per-use',
    section: 'Subscriptions',
    title: 'Cost per use',
    keywords: ['per use', 'value', 'worth it', 'usage', 'how often'],
    summary:
      'Cost per use is the monthly cost divided by how many times a month you use it (daily ≈ 30, weekly ≈ 4.3, monthly = 1, rarely ≈ 0.25). A $45 gym you use rarely costs about $180 per visit.',
    body: `Tally estimates what each use really costs:

**monthly cost ÷ uses per month**

It uses these estimates for "How often you use it": **daily** 30, **weekly** 4.33, **monthly** 1, **rarely** 0.25. For *Never*, there's no cost per use; the subscription is flagged **Unused** instead.

Example: a $45/month gym you use *rarely* works out to roughly **$180 per visit**.`,
  },
  {
    id: 'what-if',
    section: 'Subscriptions',
    title: '"What if I cancel?" savings',
    keywords: ['save money', 'savings', 'cancel', 'what if', 'how much would i save', 'five years'],
    summary:
      'Tick "What if I cancel?" on any rows. The panel at the top shows how much you would save per year and over five years. Nothing is actually cancelled.',
    body: `Tick **What if I cancel?** on one or more subscriptions. The green line at the top shows the savings **per year** and **over 5 years** if you set that money aside.

It's a simulation only. To stop counting a subscription for real, **pause** it or **delete** it, and cancel it with the provider.`,
  },
  {
    id: 'pause',
    section: 'Subscriptions',
    title: 'Pause vs delete',
    keywords: ['pause', 'resume', 'stop', 'remove', 'cancelled', 'on hold'],
    summary:
      'Pause keeps a subscription on your list but stops counting it in totals, reminders and alerts. Delete removes it. Neither cancels it with the company; you still have to do that yourself.',
    body: `- **Pause** (the ⏸ button): keeps it on the list, crossed out, but leaves it out of totals, reminders, alerts and the calendar. Handy for something you've cancelled but might restart.
- **Delete** (the trash button): removes it completely. You can undo right after.

Tally never cancels anything with the company for you. Use the **cancel or manage link** you saved on the subscription to do that.`,
  },
  {
    id: 'trials',
    section: 'Subscriptions',
    title: 'Free trials',
    keywords: ['trial', 'free', 'converts', 'before i get charged', 'trial end'],
    summary:
      'Set Status to "Free trial" and enter the trial end date. Tally reminds you before it converts to paid and flags it as "Trial ending".',
    body: `When adding or editing a subscription, set **Status** to **Free trial** and enter **Trial ends**.

Tally then:

- shows how many days are left on the row,
- flags it **Trial ending** as the date approaches,
- sends a reminder (on this device, and in GitHub alerts if you use Sync) before the trial converts.

Set the **next charge** to the first paid charge date, usually the same day the trial ends.`,
  },
  {
    id: 'next-charge',
    section: 'Subscriptions',
    title: 'How renewal dates are worked out',
    keywords: ['next charge', 'renewal date', 'wrong date', '31st', 'end of month', 'february', 'billing date'],
    summary:
      'From the date you enter, Tally counts forward by the billing cycle. Charges on the 29th–31st fall on the last day of shorter months and return to the original day afterwards.',
    body: `You only enter one charge date. Tally counts forward from it by the billing cycle to find every future renewal, so you never have to update it.

Month-end dates are handled the way most billers do: a subscription on **Jan 31** charges on **Feb 28** (or 29), then **Mar 31** again. It doesn't drift to the 28th forever.`,
  },
  {
    id: 'calendar-forecast',
    section: 'Subscriptions',
    title: 'Calendar and 12-month forecast',
    keywords: ['calendar', 'forecast', 'chart', 'bars', 'dashed line', 'next 12 months', 'which month', 'expensive month'],
    summary:
      'Calendar shows each renewal on its day. "Next 12 months" charts what actually leaves your account each month; tall bars are where yearly renewals land, and the dashed line is your monthly average.',
    body: `Open **Subscriptions → Calendar**.

- **Next 12 months**: one bar per month showing the real amount charged that month. The **dashed line** is your average. The tallest bar is highlighted when it's well above average, usually because a yearly plan renews then.
- **Month grid**: each charge on its date. Use the arrows to move between months.`,
    link: { label: 'Open Calendar', href: '#/subscriptions' },
  },
  {
    id: 'ics',
    section: 'Subscriptions',
    title: 'Add renewals to Google, Apple or Outlook Calendar',
    keywords: ['ics', 'google calendar', 'apple calendar', 'outlook', 'export calendar', 'calendar file', 'reminder in calendar'],
    summary:
      'In Calendar, click "Add to calendar" to download an .ics file. Open or import it in your calendar app: every renewal appears as a repeating event with a reminder.',
    body: `1. Open **Subscriptions → Calendar** and click **Add to calendar**.
2. Open the downloaded **tally-renewals.ics** file, or import it:
   - **Google Calendar**: Settings → Import & export → Import.
   - **Apple Calendar**: File → Import, or just open the file.
   - **Outlook**: open the file, or Add calendar → Upload from file.

Each subscription becomes a repeating event with a reminder matching its **Remind me** setting. It's a one-time copy: if you change subscriptions later, import a new file.`,
  },
  {
    id: 'bank-import',
    section: 'Subscriptions',
    title: 'Find subscriptions in a bank export',
    keywords: ['csv', 'bank statement', 'import', 'upload', 'find subscriptions', 'forgot', 'detect', 'recurring', 'confidence'],
    summary:
      'Download a CSV of transactions from your bank or card website, then open Subscriptions → "Find in bank export" and choose the file. Tally lists charges that repeat on a steady schedule at a steady price.',
    body: `1. On your bank's or card's website, export your transactions as **CSV**. Three months or more works best.
2. Open **Subscriptions → Find in bank export** and choose the file (or drop it anywhere on the page).
3. Review the list. **Confidence** shows how regular the timing and price were. Tick the ones to keep and click **Add selected**.

The file is read in your browser and never uploaded. If a price changed recently, Tally shows it (for example, "up from $15.49"). A charge has to appear at least twice to count.`,
    link: { label: 'Find in bank export', href: '#/subscriptions' },
  },
  {
    id: 'price-history',
    section: 'Subscriptions',
    title: 'Price history and price increases',
    keywords: ['price went up', 'price increase', 'history', 'raised', 'more expensive'],
    summary:
      'When you change a subscription\'s price, Tally saves the old one. Increases are flagged "Up N%" for six months, and the edit dialog shows the full history.',
    body: `Change a price by editing the subscription. Tally records the previous price and the date it changed.

- An increase shows an **Up N%** flag for six months.
- Open the subscription (pencil icon) to see **Price history**.
- Bank imports also spot increases automatically.`,
  },
  {
    id: 'search-sort',
    section: 'Subscriptions',
    title: 'Search and sort subscriptions',
    keywords: ['find', 'search', 'sort', 'order', 'filter'],
    summary: 'Use the search box above the list to filter by name or category, and "Sort by" to order by next charge, monthly cost, needs review, or name.',
    body: `Above the subscription list:

- **Search** matches names and categories as you type.
- **Sort by**: *Next charge*, *Monthly cost*, *Needs review* (most serious flags first) or *Name*.

Paused subscriptions always sit at the bottom.`,
  },

  // ---------------- Split ----------------
  {
    id: 'split-basics',
    section: 'Split',
    title: 'Splitting shared costs',
    keywords: ['split', 'share', 'roommates', 'friends', 'trip', 'group', 'who owes', 'log expense', 'add person'],
    summary:
      'Add the people you share costs with, then log each expense with who paid and how to split it. Tally keeps everyone\'s balance and shows the fewest payments to settle up.',
    body: `1. Under **People**, add everyone in the group.
2. Click **Log expense**: what it was, the amount, who paid, and how to split it.
3. Each person's bar shows their **balance**: green means they're owed money, red means they owe.
4. **Settle up** lists the payments that clear every balance.

Amounts are exact to the cent. When a total doesn't divide evenly, the extra cent goes to one person so the shares always add up.`,
    link: { label: 'Open Split', href: '#/split' },
  },
  {
    id: 'split-methods',
    section: 'Split',
    title: 'Split methods: equally, by income, by shares, exact amounts',
    keywords: ['by income', 'proportional', 'fair', 'shares', 'exact', 'equally', 'weighted', 'ratio', 'different amounts'],
    summary:
      'Equally divides evenly. By income divides in proportion to each person\'s income, so higher earners pay more. By shares uses ratios you choose (2:1). Exact amounts lets you type each person\'s share.',
    body: `- **Equally**: everyone ticked pays the same.
- **By income**: shares are proportional to each person's monthly income. If Alex earns $5,000 and Jordan $3,500, Alex pays about 59% of a two-person cost. Only the ratio matters. Set incomes by clicking a person's name.
- **By shares**: you set a ratio, for example 2 for someone who had two nights and 1 for someone who had one.
- **Exact amounts**: type each person's amount. They must add up to the total.

The **Each person's share** box in the dialog shows the result before you save.`,
  },
  {
    id: 'settle-up',
    section: 'Split',
    title: 'Settle up and "fewest payments"',
    keywords: ['settle', 'pay back', 'who pays who', 'fewest payments', 'mark paid', 'debt', 'owe'],
    summary:
      'Settle up shows the smallest number of payments that clears everyone\'s balance. When someone pays, click "Mark paid" to record it in the ledger.',
    body: `Instead of everyone paying everyone back for each expense, Tally adds up each person's overall balance and finds the **fewest payments** that bring everyone to zero. It checks every way the group could be split up, so it never suggests an unnecessary payment.

When a payment happens, click **Mark paid**. It's recorded in the **Ledger** as a payment, so your history stays intact.

**Copy for group chat** copies a plain-text summary you can paste anywhere.`,
  },
  {
    id: 'currency',
    section: 'Split',
    title: 'Expenses in another currency',
    keywords: ['currency', 'exchange rate', 'euro', 'pound', 'travel', 'abroad', 'convert', 'fx'],
    summary:
      'When logging an expense, choose the currency it was paid in and enter the exchange rate, or click "Use today\'s rate". Tally converts it to the group currency and keeps the original amount.',
    body: `In **Log expense**, change **Currency** to what you actually paid in. A **Rate** field appears: how many units of the group currency one unit is worth (for example, 1 EUR = 1.08 USD).

- Click **Use today's rate** to fetch the European Central Bank reference rate.
- Or type the rate from your card statement for the exact figure.

The ledger shows both amounts. The **group currency** can only change while there are no expenses.`,
  },
  {
    id: 'share-link',
    section: 'Split',
    title: 'Share a read-only link with your group',
    keywords: ['share', 'link', 'send to friends', 'group chat', 'read only', 'whatsapp', 'text'],
    summary:
      'Click "Share read-only link" under Settle up. Friends who open it see who owes whom, the balances and the ledger, and can save a copy. Incomes are never included.',
    body: `Click **Share read-only link** (on phones, the share sheet opens).

- The whole group is packed **inside the link**, after the #, which browsers never send to any server. Nothing is uploaded.
- **Incomes are left out.** Expenses split by income are converted to the exact amounts they produced, so balances match without revealing anyone's income.
- Anyone with the link can see names and amounts, so share it with the group only.
- Friends can click **Save a copy to my Tally** to keep it.

The link is a snapshot. If you log more expenses, share a new link.`,
  },

  // ---------------- Cart ----------------
  {
    id: 'cart-basics',
    section: 'Cart',
    title: 'Using the cart',
    keywords: ['shopping', 'grocery', 'list', 'basket', 'checkout', 'budget', 'add item'],
    summary:
      'Add what you plan to buy with its price and quantity. Tally shows the estimated total with tax and how much of your budget is left. Tick items as they go in the basket.',
    body: `1. Use the row at the top to add an item, its **price**, **quantity**, and whether it's **taxable**.
2. Set your **Budget** and **Sales tax %** in the summary card.
3. Tick the box next to an item when it's in your basket. The dark part of the bar shows what's in the basket, and the striped part shows what's still planned.

If you go over budget, Tally suggests the smallest item to leave out.`,
    link: { label: 'Open Cart', href: '#/cart' },
  },
  {
    id: 'sales-tax',
    section: 'Cart',
    title: 'Sales tax, taxable and exempt items',
    keywords: ['tax', 'taxed', 'no tax', 'exempt', 'groceries tax', 'tax rate', 'percent'],
    summary:
      'Tax is added only to items marked "Taxed", using the rate you set. Many places don\'t tax basic groceries, so mark those "No tax". Click the label on an item to switch it.',
    body: `Enter your local rate in **Sales tax %** (for example 8.25). Tax is calculated on the total of **taxed** items and rounded to the cent.

Rules differ by place: many US states exempt basic groceries but tax things like cleaning supplies and soda. Click an item's **Taxed / No tax** label to switch it. If you're unsure of your rate, search "[your city] sales tax rate".`,
  },

  // ---------------- Sync & alerts ----------------
  {
    id: 'sync-overview',
    section: 'Sync & alerts',
    title: 'What Sync does (and whether you need it)',
    keywords: ['github', 'sync', 'backup online', 'repository', 'why github', 'alerts', 'email alerts'],
    summary:
      'Sync is optional. It saves your subscription list to your own private GitHub repository, where a daily automatic job opens an issue before each renewal, and GitHub emails you about it.',
    body: `Tally works fine without Sync. Use it if you want:

- **Email alerts** before renewals, even when Tally isn't open.
- A copy of your subscriptions in the cloud, so you can **pull** them onto another device.

It uses your own GitHub account: a **private repository** holds the list, and a daily **GitHub Actions** job checks it and opens an **issue** for each upcoming charge. GitHub sends you an email about each new issue. It's free and needs no other service.

Only **subscriptions** are synced. Your split group and cart stay on this device.`,
    link: { label: 'Open Sync', href: '#/sync' },
  },
  {
    id: 'sync-setup',
    section: 'Sync & alerts',
    title: 'Set up Sync step by step',
    keywords: ['setup', 'token', 'personal access token', 'fine-grained', 'commit', 'how to connect github', 'owner', 'repository name'],
    summary:
      'Create a private repo from the Tally template, create a fine-grained token that can write to that one repo, then enter the owner, repository and token on the Sync tab and click "Commit to GitHub".',
    body: `1. On GitHub, open the Tally project and click **Use this template → Create a new repository**. Make it **Private**.
2. In the new repo, open **Settings → General → Features** and make sure **Issues** is on. Open the **Actions** tab and enable workflows if asked.
3. Create a token: GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**. Under *Repository access* choose **Only select repositories** and pick your new repo. Under *Permissions → Repository permissions*, set **Contents** to **Read and write**.
4. In Tally's **Sync** tab, enter the **Owner** (your GitHub username), the **Repository** name, and paste the **token**.
5. Optional but recommended: tick **Encrypt the file with a passphrase**.
6. Click **Commit to GitHub**.

The first alert check runs straight away, then every morning.`,
    link: { label: 'Open Sync', href: '#/sync' },
  },
  {
    id: 'encryption',
    section: 'Sync & alerts',
    title: 'Encrypting the synced file',
    keywords: ['encrypt', 'passphrase', 'password', 'secure', 'private', 'secret', 'TALLY_PASSPHRASE', 'forgot passphrase', 'aes'],
    summary:
      'Tick "Encrypt the file with a passphrase" so the repo only ever holds scrambled data. For email alerts, add the same passphrase as a repository secret named TALLY_PASSPHRASE. A forgotten passphrase can\'t be recovered.',
    body: `With encryption on, Tally scrambles the file in your browser before it's sent (AES-256-GCM, a standard strong cipher). Someone who sees your repo, or a leaked token, sees only unreadable data.

For alerts to keep working, add the passphrase to GitHub: repo **Settings → Secrets and variables → Actions → New repository secret**, name **TALLY_PASSPHRASE**. Alert issues then say *when* something renews, not *what*.

- Tally never stores the passphrase. Keep it in a password manager.
- **If you forget it, the synced copy can't be recovered.** Your data on this device is unaffected; turn encryption on with a new passphrase and commit again.
- A wrong passphrase is reported clearly; it never produces garbled data.`,
  },
  {
    id: 'pull',
    section: 'Sync & alerts',
    title: 'Use Tally on a second device',
    keywords: ['another device', 'phone and laptop', 'second computer', 'pull', 'download from github', 'same data'],
    summary:
      'On the new device, open the Sync tab, enter the same owner, repository and token (and passphrase if encrypted), then click "Pull from GitHub". Only subscriptions are transferred.',
    body: `1. Open Tally on the second device and go to **Sync**.
2. Enter the same **Owner**, **Repository** and a **token** (you can create a second token for this device).
3. If the file is encrypted, enter the **passphrase**.
4. Click **Pull from GitHub** and confirm.

This replaces the subscriptions on that device with the repo copy. To move *everything* (split group and cart too), use **Download backup** on one device and **Restore backup** on the other.`,
  },
  {
    id: 'alert-issues',
    section: 'Sync & alerts',
    title: 'Renewal alert issues and emails',
    keywords: ['issue', 'email', 'notification', 'not getting alerts', 'github email', 'close issue', 'alert'],
    summary:
      'Each morning a GitHub Actions job opens one issue per subscription inside its reminder window. GitHub emails you about new issues. Close the issue once you\'ve decided; it won\'t reopen.',
    body: `The **Renewal alerts** workflow runs every morning (and whenever you commit). For each subscription whose next charge is within its **Remind me** window, it opens an issue labelled **renewal**.

- GitHub emails you about new issues if you **watch** the repo (you do by default for your own repos). Check *Settings → Notifications* on GitHub if emails don't arrive.
- Close the issue when you've decided. It won't be reopened, and alerts whose date has passed are closed automatically.
- Not getting any? See **Alerts aren't arriving** in Troubleshooting.`,
  },

  // ---------------- App & reminders ----------------
  {
    id: 'install',
    section: 'App & reminders',
    title: 'Install Tally as an app',
    keywords: ['install', 'app', 'home screen', 'pwa', 'desktop app', 'add to dock', 'download app', 'iphone', 'android'],
    summary:
      'Click "Install app" at the top (Chrome, Edge, Android). On iPhone or iPad, tap Share → Add to Home Screen. On a Mac in Safari, choose File → Add to Dock.',
    body: `Installed, Tally opens from its own icon, works **offline**, shows a **badge** with renewals due in the next 3 days, and can send **reminders**.

- **Chrome, Edge, Android**: click **Install app** at the top, or the install icon in the address bar.
- **iPhone / iPad**: tap **Share**, then **Add to Home Screen**.
- **Safari on Mac**: **File → Add to Dock**.
- **Firefox (desktop)**: can't install web apps; bookmark it instead.

Your data stays the same whether you use the app or the website on the same browser.`,
  },
  {
    id: 'reminders',
    section: 'App & reminders',
    title: 'Reminders on this device',
    keywords: ['notifications', 'remind me', 'push', 'alert on phone', 'notify', 'bell', 'not getting reminders'],
    summary:
      'Turn on reminders in Sync → Preferences. You\'ll get a notification when each subscription enters its reminder window. They appear when Tally opens, and in the background for the installed app in Chrome and Edge.',
    body: `Go to **Sync → Preferences → Reminders on this device** and click **Turn on reminders**, then allow notifications.

- Reminders show up when you open Tally. For the **installed app in Chrome or Edge**, they also arrive in the background, about twice a day.
- On **iPhone and iPad**, install Tally to your Home Screen first; Apple only allows notifications for installed web apps.
- Each reminder is shown once. Use **Send a test** to check it works.
- Blocked? Allow notifications for this site in your browser's site settings.

No GitHub account is needed for these.`,
    link: { label: 'Open Preferences', href: '#/sync' },
  },
  {
    id: 'offline',
    section: 'App & reminders',
    title: 'Offline use and updates',
    keywords: ['offline', 'no internet', 'airplane', 'update', 'new version', 'reload'],
    summary:
      'After the first visit, Tally works without an internet connection. When a new version is ready, a message offers "Reload", and nothing changes until you click it.',
    body: `Tally saves itself on your device on the first visit, so it opens and works **offline**. Only Sync, exchange rates and the AI assistant need a connection.

When an update is available, you'll see **"A new version of Tally is ready"** with a **Reload** button. Nothing changes until you click it, so an update never interrupts you mid-edit.`,
  },

  // ---------------- Privacy & data ----------------
  {
    id: 'privacy',
    section: 'Privacy & data',
    title: 'Where your data is stored',
    keywords: ['privacy', 'safe', 'secure', 'who can see', 'stored', 'cloud', 'server', 'data', 'tracking', 'is my data safe'],
    summary:
      'Everything is stored in this browser on this device. Tally has no server and no account. Data leaves the device only when you use Sync, share a split link, fetch an exchange rate, or ask the AI assistant.',
    body: `Tally has **no account and no server**. Your data lives in this browser's storage on this device.

Data only leaves the device when you:

- **Commit to GitHub**: subscriptions only, to your own repo (optionally encrypted).
- **Share a split link**: the group is inside the link itself; incomes are left out.
- **Use today's rate**: asks the European Central Bank rates service for one number; no personal data is sent.
- **Ask the AI assistant** with a cloud AI: your question is sent to that provider. Your Tally data is only included if you turn on **Share my Tally data**.

Clearing your browser's site data deletes Tally's data, so download a backup now and then.`,
  },
  {
    id: 'backup',
    section: 'Privacy & data',
    title: 'Back up and restore',
    keywords: ['backup', 'export', 'json', 'move', 'restore', 'new computer', 'save file', 'lost data'],
    summary:
      'Sync → "Download backup" saves everything to a .json file. "Restore backup" loads it on any device. Backups from the original FinHub app work too.',
    body: `- **Download backup** (Sync tab) saves all subscriptions, split data, cart and settings to a **.json** file.
- **Restore backup** replaces what's in Tally with a backup. You can undo right after.
- You can also drop a backup file anywhere on the window.

Backups aren't encrypted, so store them somewhere private.`,
    link: { label: 'Open Sync', href: '#/sync' },
  },

  // ---------------- Troubleshooting ----------------
  {
    id: 'blank-page',
    section: 'Troubleshooting',
    title: 'The site shows a blank page or just a title',
    keywords: ['blank', 'white page', 'github pages', 'not loading', 'only shows title', 'deploy', 'readme showing', 'tally didnt start'],
    summary:
      'If your GitHub Pages site shows only a title or "Tally didn\'t start", GitHub is publishing the source files. Put the project at the top level of the repo, then set Settings → Pages → Source to "GitHub Actions".',
    body: `This happens when GitHub Pages publishes the repository's files directly instead of the built app.

1. Make sure **package.json**, **index.html** and the **.github** folder are at the **top level** of the repository, not inside a subfolder. GitHub only runs workflows from a top-level **.github/workflows** folder.
2. Open **Settings → Pages**. Under *Build and deployment*, set **Source** to **GitHub Actions**.
3. Open the **Actions** tab, choose **Deploy app to GitHub Pages**, and click **Run workflow**.

After about a minute, reload the site. If you see an old version, reload once more.`,
  },
  {
    id: 'alerts-missing',
    section: 'Troubleshooting',
    title: 'Alerts aren\'t arriving',
    keywords: ['no email', 'no issue', 'workflow failed', 'action failed', 'alerts not working', 'red x'],
    summary:
      'Open your repo\'s Actions tab and check the "Renewal alerts" run. The usual causes: Issues turned off, workflows not enabled, a missing TALLY_PASSPHRASE secret for an encrypted file, or no subscription inside its reminder window yet.',
    body: `Open the repo's **Actions** tab and click the latest **Renewal alerts** run. Its log says what happened.

- *"Issues are disabled"*: turn on **Issues** in Settings → General → Features.
- *"… is encrypted. Add a repository secret named TALLY_PASSPHRASE"*: add the secret (see **Encrypting the synced file**).
- *"Couldn't decrypt"*: the secret doesn't match the passphrase you used in Tally.
- *"No data/subscriptions.json yet"*: click **Commit to GitHub** in Tally first.
- The run succeeded but opened nothing: no subscription is inside its **Remind me** window today. Sync's step 3 previews what would open today.

If there are no runs at all, enable workflows on the **Actions** tab.`,
  },
  {
    id: 'github-errors',
    section: 'Troubleshooting',
    title: 'Commit or Pull failed',
    keywords: ['401', '403', '404', 'rejected the token', 'cant write', 'not found', 'commit failed', 'pull failed', 'expired token'],
    summary:
      'A token error means the token expired or can\'t reach that repo; create a new fine-grained token with Contents: Read and write on that repo. "Not found" usually means a typo in the owner, repository or branch.',
    body: `- **"GitHub rejected the token"**: it expired or was revoked. Create a new one.
- **"The token can't write to this repo"**: edit the token and set *Contents* to **Read and write**, with access to this repository.
- **"Repo or branch not found"**: check spelling. **Owner** is your username (or organisation), **Repository** is the repo name only, and **Branch** is usually *main*.
- **"The file changed on GitHub"**: try again.`,
  },
  {
    id: 'ai-helpdesk',
    section: 'Troubleshooting',
    title: 'About the AI assistant',
    keywords: ['ai', 'assistant', 'chatbot', 'gemini', 'claude', 'openai', 'api key', 'not answering', 'helpdesk', 'ask'],
    summary:
      'The helpdesk always answers from Tally\'s built-in help. For AI answers it uses Chrome\'s on-device AI when available, a helpdesk service if the site provides one, or your own API key (Gemini has a free tier).',
    body: `The helpdesk works in layers:

1. **Built-in help**: instant answers from these articles. Always available, offline and free.
2. **On-device AI**: in recent Chrome on a capable computer, answers are generated privately on your machine.
3. **Site assistant**: if the site's owner has set one up, AI answers work with no setup.
4. **Your own key**: add a free **Google Gemini** key (from Google AI Studio), or a Claude or OpenAI-compatible key, under **AI settings**. It's stored only in this browser.

AI answers can be wrong. Check anything important against the articles, and don't rely on it for financial, tax or legal decisions.`,
    link: { label: 'Open Help', href: '#/help' },
  },
];

export const GLOSSARY: Term[] = [
  { id: 'billing-cycle', term: 'Billing cycle', aliases: ['billed every', 'cycle', 'frequency'], definition: 'How often a subscription charges you: weekly, monthly, quarterly (every 3 months) or yearly.', article: 'monthly-total' },
  { id: 'next-charge', term: 'Next charge', aliases: ['renewal', 'renews', 'renewal date'], definition: 'The next date the company will charge you. Tally works out every later date from it automatically.', article: 'next-charge' },
  { id: 'monthly-equivalent', term: 'Per month (average)', aliases: ['monthly equivalent', '/mo', 'per month'], definition: 'A subscription\'s yearly cost divided by 12, so plans on different schedules can be compared. A $120 yearly plan counts as $10 a month.', article: 'monthly-total' },
  { id: 'reminder-window', term: 'Remind me', aliases: ['lead time', 'reminder window', 'lead days'], definition: 'How many days before a charge you want to be reminded. It controls device reminders, GitHub alerts and calendar reminders.', article: 'reminders' },
  { id: 'cost-per-use', term: 'Cost per use', aliases: ['/use', 'per use'], definition: 'The monthly cost divided by how many times a month you use it. It shows what each use really costs you.', article: 'cost-per-use' },
  { id: 'review-flags', term: 'Review flags', aliases: ['flags', 'review', 'low value', 'high cost', 'unused'], definition: 'Labels pointing out subscriptions worth a second look, each with a specific reason such as low value or a price increase.', article: 'review-flags' },
  { id: 'free-trial', term: 'Free trial', aliases: ['trial'], definition: 'A period before the first paid charge. Tally reminds you before it converts so you can cancel in time.', article: 'trials' },
  { id: 'paused', term: 'Paused', aliases: ['pause'], definition: 'Kept on your list but left out of totals, reminders and alerts. It does not cancel anything with the company.', article: 'pause' },
  { id: 'annual-renewal', term: 'Annual renewal', aliases: ['yearly renewal'], definition: 'A yearly plan that charges within the next 30 days: a large one-off payment worth planning for.', article: 'review-flags' },
  { id: 'forecast', term: '12-month forecast', aliases: ['next 12 months', 'forecast'], definition: 'The real amount charged in each of the next 12 months, as opposed to the smoothed monthly average.', article: 'calendar-forecast' },
  { id: 'recurring-charge', term: 'Recurring charge', aliases: ['recurring', 'repeat charge'], definition: 'A charge that repeats on a steady schedule at a steady price. Tally looks for these in bank exports.', article: 'bank-import' },
  { id: 'confidence', term: 'Confidence', aliases: [], definition: 'How sure Tally is that a charge in your bank export is a subscription, based on how regular its timing and price were.', article: 'bank-import' },
  { id: 'csv', term: 'CSV file', aliases: ['csv', 'bank export', 'spreadsheet export'], definition: 'A plain text spreadsheet file. Most banks let you download your transactions as CSV from their website.', article: 'bank-import' },
  { id: 'ics', term: '.ics file', aliases: ['ics', 'icalendar', 'calendar file'], definition: 'A standard calendar file that Google, Apple and Outlook Calendar can import.', article: 'ics' },
  { id: 'balance', term: 'Balance', aliases: ['owes', 'is owed', 'gets back'], definition: 'What each person has paid minus their fair share. Positive means they\'re owed money; negative means they owe.', article: 'split-basics' },
  { id: 'settle-up', term: 'Settle up', aliases: ['settlement', 'fewest payments'], definition: 'The smallest set of payments that brings everyone\'s balance to zero.', article: 'settle-up' },
  { id: 'by-income', term: 'By income', aliases: ['income split', 'proportional', 'weighted', 'monthly income'], definition: 'A split where each person pays in proportion to their income, so higher earners pay a larger share.', article: 'split-methods' },
  { id: 'by-shares', term: 'By shares', aliases: ['shares', 'ratio'], definition: 'A split using a ratio you choose, for example 2 for someone who stayed two nights and 1 for someone who stayed one.', article: 'split-methods' },
  { id: 'exact-amounts', term: 'Exact amounts', aliases: ['exact'], definition: 'A split where you type each person\'s amount. They must add up to the total.', article: 'split-methods' },
  { id: 'exchange-rate', term: 'Exchange rate', aliases: ['rate', 'fx', 'conversion'], definition: 'How many units of the group currency one unit of another currency is worth, for example 1 EUR = 1.08 USD.', article: 'currency' },
  { id: 'ledger', term: 'Ledger', aliases: [], definition: 'The full list of shared expenses and recorded payments, newest first.', article: 'settle-up' },
  { id: 'sales-tax', term: 'Sales tax', aliases: ['tax rate', 'tax'], definition: 'Tax added at checkout, as a percentage of taxed items. The rate depends on where you shop.', article: 'sales-tax' },
  { id: 'tax-exempt', term: 'Tax exempt', aliases: ['no tax', 'exempt', 'taxable', 'taxed'], definition: 'An item that isn\'t taxed, such as basic groceries in many US states. Taxed items have tax added.', article: 'sales-tax' },
  { id: 'budget', term: 'Budget', aliases: [], definition: 'The most you want to spend on this shopping trip. The bar turns amber at 80% and red when you go over.', article: 'cart-basics' },
  { id: 'repository', term: 'Repository (repo)', aliases: ['repo', 'repository'], definition: 'A project folder on GitHub. Tally can save your subscriptions to a private one that only you can see.', article: 'sync-overview' },
  { id: 'fine-grained-token', term: 'Fine-grained access token', aliases: ['token', 'personal access token', 'pat', 'github token'], definition: 'A password-like key from GitHub that lets Tally write one file to one repository you choose, and nothing else.', article: 'sync-setup' },
  { id: 'commit', term: 'Commit', aliases: ['commit to github'], definition: 'Saving a new version of a file to your GitHub repository.', article: 'sync-setup' },
  { id: 'github-actions', term: 'GitHub Actions', aliases: ['actions', 'workflow'], definition: 'GitHub\'s free automation. Tally uses it to check your renewals every morning and open alert issues.', article: 'alert-issues' },
  { id: 'issue', term: 'Issue', aliases: ['github issue'], definition: 'A to-do item in a GitHub repository. Tally opens one per upcoming charge, and GitHub emails you about it.', article: 'alert-issues' },
  { id: 'passphrase', term: 'Passphrase', aliases: ['encryption', 'encrypt', 'password'], definition: 'A long password (a few random words works well) used to encrypt your synced file. It can\'t be recovered if forgotten.', article: 'encryption' },
  { id: 'encryption', term: 'Encryption', aliases: ['encrypted', 'aes'], definition: 'Scrambling data so only someone with the passphrase can read it.', article: 'encryption' },
  { id: 'pwa', term: 'Installable web app', aliases: ['pwa', 'install', 'web app'], definition: 'A website you can install like an app: it gets its own icon and window, and works offline.', article: 'install' },
  { id: 'offline', term: 'Offline', aliases: [], definition: 'Working without an internet connection. Tally does, after the first visit.', article: 'offline' },
  { id: 'local-first', term: 'Local-first', aliases: ['local', 'on this device'], definition: 'Your data is stored on your device, not on someone else\'s server.', article: 'privacy' },
];

export const articleById = (id: string) => ARTICLES.find((a) => a.id === id);
export const termById = (id: string) => GLOSSARY.find((t) => t.id === id);
