import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  allocate,
  balances,
  cartTotals,
  categorize,
  detectDateOrder,
  detectRecurring,
  judgeBudget,
  normalizeMerchant,
  parseBankTable,
  parseMoney,
  paydaysBetween,
  rolloverCarry,
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
        { name: "Electricity", estimate: 7200, cycle: "monthly", anchor: "2026-12-14", autopay: false, payments: [] },
        { name: "Phone plan", estimate: 4500, cycle: "monthly", anchor: "2026-11-28", autopay: true, payments: [] },
      ],
    },
    today,
  );
  assert.equal(result.nextPayday, "2026-12-01");
  assert.equal(result.daysLeft, 10);
  assert.equal(result.spentSince, 4965);
  assert.equal(result.owedTotal, 4500 + 1299 + 2499 + 4500);
  assert.equal(result.safe, 118237);
  assert.equal(result.perDay, 11823);
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
