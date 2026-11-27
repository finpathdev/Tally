import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  allocate,
  balances,
  cartTotals,
  chargesBetween,
  categorize,
  detectDateOrder,
  detectRecurring,
  judgeBudget,
  normalizeMerchant,
  parseBankTable,
  parseMoney,
  paydaysBetween,
  rolloverCarry,
  runningNet,
  attentionItems,
  dueReminders,
  yearReview,
  icsCalendar,
  calendarRule,
  htmlEscape,
  safeToSpend,
  salvageState,
  settle,
  sharesOf,
  splitCsv,
} from "../tally-core.mjs";

test("safe to spend matches the sample month of 21 Nov 2026", () => {
  const today = "2026-11-21";
  const subs = [
    { name: "Netflix Premium", amount: 2499, cycle: "monthly", anchor: "2026-11-25", status: "active" },
    { name: "GitHub Copilot", amount: 1000, cycle: "monthly", anchor: "2026-12-03", status: "active" },
    { name: "Gym Membership", amount: 4500, cycle: "monthly", anchor: "2026-11-22", status: "active" },
    { name: "Cloud Hosting", amount: 12000, cycle: "annual", anchor: "2026-12-09", status: "active" },
    { name: "Language App", amount: 1299, cycle: "monthly", anchor: "2026-11-23", status: "trial" },
    { name: "Music Streaming", amount: 1199, cycle: "monthly", anchor: "2026-12-13", status: "active" },
  ];
  const result = safeToSpend(
    {
      pay: 280000,
      cycle: "monthly",
      payday: "2026-12-01",
      balance: 146000,
      balanceOn: "2026-11-20",
      keepAside: 10000,
    },
    {
      spending: [{ id: "dinner", date: "2026-11-21", amount: 4965, category: "Dining out" }],
      subscriptions: subs,
      bills: [
        { name: "Rent", estimate: 110000, cycle: "monthly", anchor: "2026-12-02", autopay: false, payments: [] },
        { name: "Electricity", estimate: 7200, cycle: "monthly", anchor: "2026-11-18", autopay: false, payments: [] },
        { name: "Phone plan", estimate: 4500, cycle: "monthly", anchor: "2026-11-28", autopay: true, payments: [] },
      ],
    },
    today,
  );
  assert.equal(result.nextPayday, "2026-12-01");
  assert.equal(result.daysLeft, 10);
  assert.equal(result.spentSince, 4965);
  assert.equal(result.owedTotal, 4500 + 1299 + 2499 + 4500 + 7200);
  assert.equal(result.safe, 111037);
  assert.equal(result.perDay, 11103);
  assert.equal(result.level, "ok");
});

test("safe to spend is short when bills exceed the balance", () => {
  const result = safeToSpend(
    {
      pay: 100000,
      cycle: "monthly",
      payday: "2026-12-01",
      balance: 2000,
      balanceOn: "2026-11-20",
      keepAside: 0,
    },
    {
      spending: [],
      subscriptions: [],
      bills: [
        { name: "Rent", estimate: 80000, cycle: "monthly", anchor: "2026-11-25", autopay: false, payments: [] },
      ],
    },
    "2026-11-21",
  );
  assert.equal(result.safe, 2000 - 80000);
  assert.equal(result.perDay, 0);
  assert.equal(result.level, "short");
});

test("a paycheck that already landed is added once", () => {
  const result = safeToSpend(
    {
      pay: 50000,
      cycle: "monthly",
      payday: "2026-11-01",
      balance: 10000,
      balanceOn: "2026-10-20",
      keepAside: 0,
    },
    { spending: [], subscriptions: [], bills: [] },
    "2026-11-21",
  );
  assert.deepEqual(result.paidSince, ["2026-11-01"]);
  assert.equal(result.balanceNow, 60000);
  assert.equal(result.nextPayday, "2026-12-01");
});

test("split settlement matches the sample group", () => {
  const members = [
    { id: "a", name: "Alex", weight: 5000 },
    { id: "j", name: "Jordan", weight: 3500 },
    { id: "t", name: "Taylor", weight: 4000 },
  ];
  const expenses = [
    { paidBy: "a", amount: 45000, split: { kind: "equal", among: ["a", "j", "t"] } },
    { paidBy: "j", amount: 12000, split: { kind: "weighted", among: ["a", "j", "t"] } },
    { paidBy: "t", amount: 9150, split: { kind: "equal", among: ["a", "j", "t"] } },
  ];
  const nets = balances(members, expenses);
  assert.equal(nets.get("a"), 22150);
  assert.equal(nets.get("j"), -9410);
  assert.equal(nets.get("t"), -12740);
  const payments = settle(nets);
  assert.equal(payments.length, 2);
  const byFrom = Object.fromEntries(payments.map((p) => [p.from, p]));
  assert.equal(byFrom.t.amount, 12740);
  assert.equal(byFrom.t.to, "a");
  assert.equal(byFrom.j.amount, 9410);
  assert.equal(byFrom.j.to, "a");
});

test("pennies are allocated so shares add up", () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  assert.equal(allocate(100, [1, 1, 1]).reduce((a, b) => a + b, 0), 100);
  const shares = sharesOf(
    { amount: 1000, split: { kind: "shares", shares: { a: 1, b: 1 } } },
    [
      { id: "a", weight: 1 },
      { id: "b", weight: 1 },
    ],
  );
  assert.equal(shares.get("a") + shares.get("b"), 1000);
});

test("exact splits that don't add up are refused", () => {
  assert.throws(
    () =>
      sharesOf(
        { amount: 100, split: { kind: "exact", amounts: { a: 40, b: 40 } } },
        [
          { id: "a", weight: 1 },
          { id: "b", weight: 1 },
        ],
      ),
    /expected 100/,
  );
});

test("cart tax rounds half a cent up and ignores unchecked items in the basket", () => {
  const items = [
    { name: "Milk", unitPrice: 429, qty: 1, taxable: false, inBasket: true },
    { name: "Towels", unitPrice: 899, qty: 1, taxable: true, inBasket: false },
    { name: "Apples", unitPrice: 350, qty: 2, taxable: false, inBasket: false },
    { name: "Soap", unitPrice: 379, qty: 1, taxable: true, inBasket: false },
  ];
  const totals = cartTotals(items, 825);
  assert.equal(totals.subtotal, 2407);
  assert.equal(totals.taxableSubtotal, 1278);
  assert.equal(totals.tax, 105);
  assert.equal(totals.total, 2512);
  assert.equal(totals.basketTotal, 429);
});

test("budgets roll unspent money forward and subtract overspending", () => {
  const budget = {
    limits: { Groceries: 10000 },
    rollover: ["Groceries"],
    spending: [
      { date: "2026-09-02", amount: 4000, category: "Groceries" },
      { date: "2026-10-02", amount: 15000, category: "Groceries" },
    ],
  };
  const intoNovember = rolloverCarry(budget, [], "2026-11");
  assert.equal(intoNovember.Groceries, 1000);
  const standing = judgeBudget(9000, 9000, 10000 + intoNovember.Groceries);
  assert.equal(standing.level, "ok");
  assert.equal(standing.remaining, 2000);
  const over = judgeBudget(12000, 12000, 10000);
  assert.equal(over.level, "over");
  assert.equal(over.remaining, -2000);
});

test("a warn starts at 85 percent even when still under the limit", () => {
  const standing = judgeBudget(8500, 8500, 10000);
  assert.equal(standing.level, "warn");
});

test("bank csv accepts semicolons, day-first dates, credits and a title row", () => {
  const text = [
    "Sparkasse export",
    "",
    "Buchungstag;Verwendungszweck;Betrag",
    "13/01/2026;TESCO STORES;-24,50",
    "13/02/2026;TESCO STORES;-30,00",
    "15/01/2026;ACME PAYROLL;2.000,00",
    "02/02/2026;NETFLIX.COM;-15,99",
    "02/03/2026;NETFLIX.COM;-15,99",
  ].join("\n");
  const rows = splitCsv(text);
  assert.equal(detectDateOrder(["13/01/2026", "13/02/2026"]), "dmy");
  const parsed = parseBankTable(rows, "EUR");
  assert.equal(parsed.dateOrder, "dmy");
  assert.equal(parsed.expenses.length, 4);
  assert.equal(parsed.expenses[0].date, "2026-01-13");
  assert.equal(parsed.expenses[0].amount, 2450);
  assert.equal(parsed.income.length, 1);
  assert.equal(parsed.income[0].amount, 200000);
  assert.equal(categorize(parsed.expenses[0].description), "Groceries");
  assert.equal(categorize("NETFLIX.COM"), "Fun");
  const recurring = detectRecurring(parsed.expenses);
  const names = recurring.map((r) => r.name);
  assert.ok(names.includes("Tesco Stores"));
  assert.ok(names.includes("Netflix.com"));
  assert.equal(recurring.find((r) => r.name === "Netflix.com").cycle, "monthly");
});

test("comma csv with debit and credit columns keeps both directions", () => {
  const text = `Date,Description,Debit,Credit
2026-03-01,SHELL OIL,40.00,
2026-03-02,PAYCHECK,,1500.00`;
  const parsed = parseBankTable(splitCsv(text), "USD");
  assert.equal(parsed.expenses[0].amount, 4000);
  assert.equal(categorize(parsed.expenses[0].description), "Transport");
  assert.equal(parsed.income[0].description, "PAYCHECK");
  assert.equal(parsed.income[0].amount, 150000);
});

test("an amount column is kept when debit and credit cells are blank", () => {
  const text = `Date,Description,Amount,Debit,Credit
2026-01-02,Tesco,12.50,,
2026-01-03,Payroll,,,200.00`;
  const parsed = parseBankTable(splitCsv(text), "USD");
  assert.equal(parsed.expenses.length, 1);
  assert.equal(parsed.expenses[0].description, "Tesco");
  assert.equal(parsed.expenses[0].amount, 1250);
  assert.equal(parsed.income[0].amount, 20000);
});

test("a credit card column is not treated as money coming in", () => {
  const text = `Date,Description,Amount,Credit Card
2026-01-02,Netflix,15.99,Visa`;
  const parsed = parseBankTable(splitCsv(text), "USD");
  assert.equal(parsed.expenses.length, 1);
  assert.equal(parsed.expenses[0].amount, 1599);
  assert.equal(parsed.income.length, 0);
});

test("a bill on the 31st still has a calendar rule in short months", () => {
  assert.match(calendarRule("monthly", "2026-01-31"), /BYSETPOS=-1/);
  assert.match(calendarRule("monthly", "2026-01-31"), /BYMONTHDAY=28,29,30,31/);
  assert.equal(calendarRule("annual", "2024-02-29"), "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1");
  assert.equal(calendarRule("weekly", "2026-11-21"), "FREQ=WEEKLY");
  assert.equal(htmlEscape(`<img src=x onerror=alert(1)> & "`), "&lt;img src=x onerror=alert(1)&gt; &amp; &quot;");
});

test("merchant names drop card noise", () => {
  assert.equal(normalizeMerchant("POS DEBIT STARBUCKS STORE 1234 NY"), "Starbucks Store");
});

test("money parsing accepts parentheses, commas and currency symbols", () => {
  assert.equal(parseMoney("($12.50)", "USD"), -1250);
  assert.equal(parseMoney("1.234,50", "EUR"), 123450);
  assert.equal(parseMoney(""), null);
});

test("paydays in a month follow the schedule", () => {
  const pay = { pay: 100, cycle: "biweekly", payday: "2026-11-06" };
  assert.deepEqual(paydaysBetween(pay, "2026-11-01", "2026-11-30"), [
    "2026-11-06",
    "2026-11-20",
  ]);
  assert.equal(addDays("2026-11-21", 10), "2026-12-01");
});

test("running net adds paychecks and subtracts that day's spending", () => {
  const points = runningNet({
    pay: { pay: 10000, cycle: "monthly", payday: "2026-11-01" },
    spending: [{ date: "2026-11-02", amount: 2500 }],
    subscriptions: [
      { name: "Music", amount: 500, cycle: "monthly", anchor: "2026-11-03", status: "active" },
    ],
    income: [{ date: "2026-11-03", amount: 200 }],
    month: "2026-11",
    today: "2026-11-03",
  });
  assert.equal(points.length, 3);
  assert.deepEqual(
    points.map((p) => p.net),
    [10000, 7500, 7200],
  );
});

test("reminders honor lead time, include overdue bills, and skip snoozed ones", () => {
  const items = attentionItems({
    today: "2026-11-21",
    snoozed: { "bill:phone:2026-11-28": "2026-11-25" },
    subscriptions: [
      { id: "gym", name: "Gym", amount: 4500, cycle: "monthly", anchor: "2026-11-22", status: "active", leadDays: 5 },
      { id: "later", name: "Later", amount: 1000, cycle: "monthly", anchor: "2026-12-20", status: "active", leadDays: 3 },
    ],
    bills: [
      { id: "rent", name: "Rent", estimate: 110000, cycle: "monthly", anchor: "2026-11-02", leadDays: 5, payments: [], autopay: false },
      { id: "phone", name: "Phone", estimate: 4500, cycle: "monthly", anchor: "2026-11-28", leadDays: 2, payments: [], autopay: false },
    ],
  });
  const rent = items.find((item) => item.name === "Rent");
  const gym = items.find((item) => item.name === "Gym");
  assert.equal(rent.state, "overdue");
  assert.equal(rent.date, "2026-11-02");
  assert.equal(gym.state, "soon");
  assert.equal(gym.date, "2026-11-22");
  assert.equal(items.some((item) => item.name === "Phone"), false);
  assert.equal(items.some((item) => item.name === "Later"), false);
  const due = dueReminders(
    [
      { key: "a", notifyOn: "2026-11-18", date: "2026-11-21" },
      { key: "b", notifyOn: "2026-11-19", date: "2026-11-10" },
      { key: "c", notifyOn: "2026-11-22", date: "2026-11-25" },
      { key: "d", notifyOn: "2026-11-01", date: "2026-11-02", },
    ],
    "2026-11-21",
    { notified: ["d"], snoozed: { b: "2026-11-30" } },
  );
  assert.deepEqual(due.map((item) => item.key), ["a"]);
});

test("a year review totals categories, merchants, and money in versus out", () => {
  const review = yearReview({
    year: "2026",
    pay: { pay: 100000, cycle: "monthly", payday: "2026-01-01" },
    income: [{ date: "2026-03-15", amount: 5000 }],
    subscriptions: [
      { name: "Music", amount: 1000, cycle: "monthly", anchor: "2026-01-05", status: "active" },
    ],
    spending: [
      { date: "2026-01-10", amount: 4000, category: "Groceries", note: "TESCO STORES 1234" },
      { date: "2026-01-20", amount: 2000, category: "Groceries", note: "TESCO STORES #99" },
      { date: "2026-02-10", amount: 9000, category: "Groceries", note: "LIDL" },
    ],
    goals: [{ name: "Trip", target: 10000, saved: 2500 }],
  });
  assert.equal(review.moneyIn, 100000 * 12 + 5000);
  assert.equal(review.subscriptionsAnnual, 12000);
  assert.equal(review.categories.find((row) => row.category === "Groceries").amount, 15000);
  assert.equal(review.categories.find((row) => row.category === "Subscriptions").amount, 12000);
  const tesco = review.merchants.find((row) => row.name === "Tesco Stores");
  assert.equal(tesco.amount, 6000);
  assert.equal(tesco.count, 2);
  assert.equal(review.goals[0].pct, 0.25);
  const feb = review.changes.find((row) => row.month === "2026-02" && row.category === "Groceries");
  assert.equal(feb.delta, 3000);
  assert.equal(review.net, review.moneyIn - review.moneyOut);
  const ics = icsCalendar(
    [
      { uid: "rent-1", date: "2026-12-02", summary: "Rent", description: "Bill", rrule: "FREQ=MONTHLY", alarmDays: 5 },
    ],
    { includeAmounts: false },
  );
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /SUMMARY:Rent/);
  assert.match(ics, /TRIGGER:-P5D/);
  assert.match(ics, /RRULE:FREQ=MONTHLY/);
  assert.doesNotMatch(ics, /110000/);
});

test("a repair keeps the split, cart, bills, goals and pay around a bad row", () => {
  const fixed = salvageState({
    version: 2,
    settings: { currency: "EUR", theme: "dark" },
    subscriptions: [
      { id: "ok", name: "Music", amount: 999, cycle: "monthly", anchor: "2026-01-01", status: "active", usage: "daily" },
      { id: "bad", name: "Broken", amount: "twelve", cycle: "monthly", anchor: "2026-01-01" },
    ],
    split: {
      currency: "EUR",
      members: [
        { id: "a", name: "Alex", weight: 2 },
        { name: "No id" },
      ],
      expenses: [
        {
          id: "e",
          description: "Dinner",
          date: "2026-02-02",
          paidBy: "a",
          amount: 2000,
          split: { kind: "equal", among: ["a", "missing"] },
        },
        { id: "gone", description: "Nope", date: "yesterday", paidBy: "a", amount: 10, split: { kind: "equal", among: ["a"] } },
      ],
      payments: [{ id: "p", from: "a", to: "a", amount: 100, date: "2026-02-03" }],
    },
    cart: {
      items: [
        { id: "m", name: "Milk", unitPrice: 400, qty: 2, taxable: false, inBasket: true },
        { id: "bad", name: "Bad", unitPrice: "x", qty: 1 },
      ],
      taxRateBps: 500,
      budget: 8000,
    },
    budget: {
      spending: [{ id: "s", date: "not-a-date", amount: 10, category: "Fun" }],
      bills: [
        {
          id: "rent",
          name: "Rent",
          estimate: 10000,
          cycle: "monthly",
          anchor: "2026-03-01",
          category: "Housing",
          autopay: false,
          leadDays: 3,
          payments: [],
        },
      ],
      goals: [{ id: "g", name: "Trip", target: 5000, saved: 100 }],
      pay: { pay: 200000, cycle: "monthly", payday: "2026-04-01", balance: 5000, balanceOn: "2026-03-20", keepAside: 0 },
      income: [{ id: "i", date: "2026-03-01", amount: 1500, note: "Gift", source: "manual" }],
    },
    sync: { owner: "ada", repo: "money", branch: "main", path: "data/subscriptions.json", encrypt: true },
  });
  assert.equal(fixed.subscriptions.length, 1);
  assert.equal(fixed.split.currency, "EUR");
  assert.equal(fixed.split.members.length, 2);
  assert.equal(fixed.split.members[1].id.length > 0, true);
  assert.equal(fixed.split.expenses.length, 1);
  assert.deepEqual(fixed.split.expenses[0].split.among, ["a"]);
  assert.equal(fixed.split.payments.length, 1);
  assert.equal(fixed.cart.items.length, 1);
  assert.equal(fixed.cart.items[0].name, "Milk");
  assert.equal(fixed.cart.taxRateBps, 500);
  assert.equal(fixed.budget.spending.length, 0);
  assert.equal(fixed.budget.bills[0].name, "Rent");
  assert.equal(fixed.budget.goals[0].name, "Trip");
  assert.equal(fixed.budget.pay.pay, 200000);
  assert.equal(fixed.budget.income[0].note, "Gift");
  assert.equal(fixed.sync.owner, "ada");
  assert.equal(fixed.sync.encrypt, true);
});

test("a broken save can be salvaged without dropping the readable rows", () => {
  const fixed = salvageState({
    version: 2,
    settings: { currency: "GBP", theme: "dark", highCost: "nope" },
    subscriptions: [
      { id: "1", name: "Music", amount: 999, cycle: "monthly", anchor: "2026-01-01", status: "active", usage: "daily" },
      { id: "2", name: "Broken", amount: "twelve", cycle: "monthly", anchor: "2026-01-01" },
    ],
    budget: {
      limits: { Groceries: "4000", Fun: 2000 },
      spending: [{ id: "s", date: "2026-02-02", amount: 500, category: "Fun", note: "Film", source: "manual" }],
      rollover: ["Fun"],
    },
  });
  assert.equal(fixed.settings.currency, "GBP");
  assert.equal(fixed.settings.theme, "dark");
  assert.equal(fixed.settings.highCost, 2000);
  assert.equal(fixed.subscriptions.length, 1);
  assert.equal(fixed.subscriptions[0].name, "Music");
  assert.equal(fixed.budget.limits.Groceries, 4000);
  assert.equal(fixed.budget.spending.length, 1);
  assert.deepEqual(fixed.budget.rollover, ["Fun"]);
});

test("weekly paydays cover an entire year", () => {
  const pay = { cycle: "weekly", payday: "2026-01-01" };
  const dates = paydaysBetween(pay, "2026-01-01", "2026-12-31");
  assert.equal(dates.length, 53);
  assert.equal(dates.at(-1), "2026-12-31");
});

test("weekly subscriptions cover a long balance history", () => {
  const sub = { anchor: "2000-01-01", cycle: "weekly", amount: 100 };
  const charges = chargesBetween([sub], "2000-01-01", addDays(sub.anchor, 7 * 800));
  assert.equal(charges.length, 801);
  assert.equal(charges.at(-1).date, addDays(sub.anchor, 7 * 800));
});

test("calendar export folds Unicode text without losing characters", () => {
  const name = "网球🎾".repeat(30);
  const calendar = icsCalendar([
    { uid: "lesson", date: "2026-12-01", summary: name, description: "Line 1\rLine 2\r\nLine 3" },
  ]);
  const encoder = new TextEncoder();
  assert.ok(calendar.split("\r\n").every((line) => encoder.encode(line).length <= 75));
  const unfolded = calendar.replace(/\r\n /g, "");
  assert.ok(unfolded.includes(`SUMMARY:${name}\r\n`));
  assert.ok(unfolded.includes("DESCRIPTION:Line 1\\nLine 2\\nLine 3\r\n"));
});

test("safe to spend reserves every unpaid recent bill occurrence", () => {
  const pay = { pay: 50000, cycle: "weekly", payday: "2026-11-28", balance: 25000, balanceOn: "2026-11-21" };
  const bill = {
    name: "Weekly bill", estimate: 2000, cycle: "weekly", anchor: "2026-10-03",
    payments: [{ due: "2026-11-14", amount: 2000 }],
  };
  const result = safeToSpend(pay, { bills: [bill] }, "2026-11-21");
  assert.deepEqual(result.owed.map((row) => row.date), [
    "2026-10-10", "2026-10-17", "2026-10-24", "2026-10-31", "2026-11-07", "2026-11-21",
  ]);
  assert.equal(result.owedTotal, 12000);
  assert.equal(result.safe, 13000);
  const autopay = safeToSpend(pay, { bills: [{ ...bill, autopay: true }] }, "2026-11-21");
  assert.deepEqual(autopay.owed.map((row) => row.date), ["2026-11-21"]);
});

test("payday setup uses the entered first payday and includes bills before it", () => {
  const pay = { pay: 10000, balance: 50000, cycle: "twice-monthly", payday: "2026-12-31",
    startsOn: "2026-12-31", balanceOn: "2026-11-27" };
  const bills = [{ name: "Internet", estimate: 6000, cycle: "monthly", anchor: "2026-12-03" }];
  const result = safeToSpend(pay, { bills }, "2026-11-27");
  assert.equal(result.nextPayday, "2026-12-31");
  assert.equal(result.owedTotal, 6000);
  assert.equal(result.perDay, 1294);
  assert.deepEqual(paydaysBetween(pay, "2026-11-27", "2026-12-30"), []);
});
