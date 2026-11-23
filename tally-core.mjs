/**
 * Tally money math. Pure functions, no DOM, no network.
 * Amounts are integer cents. Dates are YYYY-MM-DD.
 * The page loads this file and the service worker precaches it.
 */

const DAY = 86400000;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value) {
  if (typeof value !== "string") return false;
  const m = ISO.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d
  );
}

function parts(iso) {
  const m = ISO.exec(iso);
  if (!m) throw new RangeError(`Invalid ISO date: ${iso}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function fromUtc(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso, days) {
  const [y, m, d] = parts(iso);
  return fromUtc(Date.UTC(y, m - 1, d) + days * DAY);
}

export function daysBetween(from, to) {
  const [ay, am, ad] = parts(from);
  const [by, bm, bd] = parts(to);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY,
  );
}

function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function addMonths(iso, count) {
  const [y, m, d] = parts(iso);
  const idx = y * 12 + (m - 1) + count;
  const ny = Math.floor(idx / 12);
  const nm = idx - ny * 12;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return fromUtc(Date.UTC(ny, nm, nd));
}

export function monthEnd(month) {
  const [y, m] = month.split("-").map(Number);
  return fromUtc(Date.UTC(y, m, 0));
}

export function shiftMonth(month, count) {
  return addMonths(`${month}-01`, count).slice(0, 7);
}

const CYCLE_STEP = { weekly: 7, monthly: 30.44, quarterly: 91.31, annual: 365.25 };

function stepCycle(anchor, cycle, k) {
  if (cycle === "weekly") return addDays(anchor, 7 * k);
  if (cycle === "monthly") return addMonths(anchor, k);
  if (cycle === "quarterly") return addMonths(anchor, 3 * k);
  if (cycle === "annual") return addMonths(anchor, 12 * k);
  throw new RangeError(`Unknown cycle ${cycle}`);
}

function occurrenceIndex(anchor, cycle, on) {
  let n = Math.floor(daysBetween(anchor, on) / CYCLE_STEP[cycle]) + 1;
  while (stepCycle(anchor, cycle, n) > on) n--;
  while (stepCycle(anchor, cycle, n + 1) <= on) n++;
  return n;
}

function firstOccurrence(anchor, cycle, from) {
  if (anchor >= from) return { date: anchor, k: 0 };
  let k = Math.max(0, Math.floor(daysBetween(anchor, from) / CYCLE_STEP[cycle]) - 1);
  let date = stepCycle(anchor, cycle, k);
  while (date < from) date = stepCycle(anchor, cycle, ++k);
  return { date, k };
}

function occurrences(anchor, cycle, from, to) {
  const out = [];
  let { date, k } = firstOccurrence(anchor, cycle, from);
  let n = 0;
  while (date <= to && n++ < 800) {
    out.push(date);
    date = stepCycle(anchor, cycle, ++k);
  }
  return out;
}

function activeSub(sub) {
  return sub.status !== "paused";
}

export function chargesBetween(subscriptions, from, to) {
  const out = [];
  for (const sub of subscriptions) {
    if (!activeSub(sub)) continue;
    for (const date of occurrences(sub.anchor, sub.cycle, from, to)) {
      out.push({ sub, date, amount: sub.amount });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const PAY_CYCLES = ["weekly", "biweekly", "twice-monthly", "monthly"];

export function nextPaydayAfter(pay, on) {
  if (!pay || !PAY_CYCLES.includes(pay.cycle) || !isIsoDate(pay.payday)) {
    throw new RangeError("Payday settings are incomplete");
  }
  const { cycle, payday } = pay;
  if (cycle === "weekly" || cycle === "biweekly") {
    const step = cycle === "weekly" ? 7 : 14;
    let cursor = addDays(payday, (Math.floor(daysBetween(payday, on) / step) + 1) * step);
    while (cursor <= on) cursor = addDays(cursor, step);
    while (addDays(cursor, -step) > on) cursor = addDays(cursor, -step);
    return cursor;
  }
  if (cycle === "monthly") {
    let k = Math.floor(daysBetween(payday, on) / 30.44) - 1;
    while (addMonths(payday, k) > on) k--;
    while (addMonths(payday, k) <= on) k++;
    return addMonths(payday, k);
  }
  const dom = Number(payday.slice(8));
  const first = Math.min(dom, 15);
  const second = Math.min(first + 15, 31);
  let month = `${on.slice(0, 8)}01`;
  month = addMonths(month, -1);
  const found = [];
  while (found.length < 1) {
    const [y, m] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
    const dim = daysInMonth(y, m - 1);
    for (const day of [first, Math.min(second, dim)]) {
      const iso = `${month.slice(0, 8)}${String(day).padStart(2, "0")}`;
      if (iso > on) found.push(iso);
    }
    month = addMonths(month, 1);
  }
  return found[0];
}

/**
 * Cumulative money in minus money out, one point per day through today
 * (or through the end of a past month).
 */
export function runningNet({ pay, spending, subscriptions, income, month, today }) {
  const start = `${month}-01`;
  const endCap = monthEnd(month);
  const end = today.slice(0, 7) === month && today < endCap ? today : endCap;
  const paydaySet = new Set(pay ? paydaysBetween(pay, start, end) : []);
  const points = [];
  let net = 0;
  for (let date = start; date <= end; date = addDays(date, 1)) {
    let inn = paydaySet.has(date) ? pay.pay : 0;
    for (const row of income || []) if (row.date === date) inn += row.amount;
    let out = 0;
    for (const row of spending || []) if (row.date === date) out += row.amount;
    out += chargesBetween(subscriptions || [], date, date).reduce((sum, row) => sum + row.amount, 0);
    net += inn - out;
    points.push({ date, inn, out, net });
    if (points.length > 40) break;
  }
  return points;
}

export function paydaysBetween(pay, start, end) {
  if (!pay) return [];
  const out = [];
  let cursor = nextPaydayAfter(pay, addDays(start, -1));
  let guard = 0;
  while (cursor <= end && guard++ < 40) {
    if (cursor >= start) out.push(cursor);
    const next = nextPaydayAfter(pay, cursor);
    if (next <= cursor) break;
    cursor = next;
  }
  return out;
}

function lastBillOnOrBefore(bill, on) {
  if (bill.anchor > on) return null;
  return stepCycle(bill.anchor, bill.cycle, occurrenceIndex(bill.anchor, bill.cycle, on));
}

function nextBillAfter(bill, on) {
  if (bill.anchor > on) return bill.anchor;
  return stepCycle(bill.anchor, bill.cycle, occurrenceIndex(bill.anchor, bill.cycle, on) + 1);
}

function paymentOn(bill, due) {
  return (bill.payments || []).find((p) => p.due === due);
}

function billStatus(bill, today) {
  const last = lastBillOnOrBefore(bill, today);
  if (last && !bill.autopay && !paymentOn(bill, last) && daysBetween(last, today) <= 45) {
    return { due: last, state: last === today ? "due-soon" : "overdue" };
  }
  const due = nextBillAfter(bill, today);
  return { due, state: paymentOn(bill, due) ? "paid" : bill.autopay ? "autopay" : "upcoming" };
}

function billsBeforePayday(bills, today, payday) {
  const until = addDays(payday, -1);
  const rows = [];
  for (const bill of bills || []) {
    const status = billStatus(bill, today);
    if (status.state === "overdue") {
      rows.push({ label: bill.name, date: status.due, amount: bill.estimate, kind: "bill" });
    }
    for (const due of occurrences(bill.anchor, bill.cycle, today, until)) {
      if (!paymentOn(bill, due)) {
        rows.push({ label: bill.name, date: due, amount: bill.estimate, kind: "bill" });
      }
    }
  }
  return rows;
}

/**
 * What you can spend before the next payday.
 * `books` is { spending, subscriptions, bills }.
 */
export function safeToSpend(pay, books, today) {
  const spending = books.spending || [];
  const subscriptions = books.subscriptions || [];
  const bills = books.bills || [];
  const balanceOn = pay.balanceOn <= today ? pay.balanceOn : today;
  const paidSince = [];
  for (
    let cursor = nextPaydayAfter(pay, balanceOn);
    cursor <= today;
    cursor = nextPaydayAfter(pay, cursor)
  ) {
    paidSince.push(cursor);
  }
  const counted = new Set(pay.counted || []);
  const spentSince =
    spending
      .filter(
        (row) =>
          row.date <= today &&
          (row.date > balanceOn ||
            (row.date === balanceOn && pay.counted !== undefined && !counted.has(row.id))),
      )
      .reduce((sum, row) => sum + row.amount, 0) +
    chargesBetween(subscriptions.filter(activeSub), addDays(balanceOn, 1), today).reduce(
      (sum, row) => sum + row.amount,
      0,
    );
  const balanceNow = pay.balance + paidSince.length * pay.pay - spentSince;
  const nextPayday = nextPaydayAfter(pay, today);
  const owedSubs = chargesBetween(
    subscriptions.filter(activeSub),
    addDays(today, 1),
    addDays(nextPayday, -1),
  ).map((row) => ({
    label: row.sub.name,
    date: row.date,
    amount: row.amount,
    kind: "subscription",
  }));
  const owedBills = billsBeforePayday(bills, today, nextPayday);
  const owed = [...owedSubs, ...owedBills].sort(
    (a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label),
  );
  const owedTotal = owed.reduce((sum, row) => sum + row.amount, 0);
  const daysLeft = Math.max(1, daysBetween(today, nextPayday));
  const keepAside = pay.keepAside || 0;
  const safe = balanceNow - owedTotal - keepAside;
  const perDay = safe > 0 ? Math.floor(safe / daysLeft) : 0;
  const level = safe < 0 ? "short" : perDay * daysLeft < pay.pay * 0.1 ? "tight" : "ok";
  return {
    balanceNow,
    paidSince,
    spentSince,
    nextPayday,
    daysLeft,
    owed,
    owedTotal,
    keepAside,
    safe,
    perDay,
    level,
  };
}

export function allocate(total, weights) {
  if (!Number.isInteger(total)) throw new RangeError("allocate: total must be an integer");
  if (weights.length === 0) return [];
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
    throw new RangeError("allocate: weights must be finite and non-negative");
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  const basis = sum > 0 ? weights : weights.map(() => 1);
  const denom = sum > 0 ? sum : weights.length;
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const exact = basis.map((w) => (abs * w) / denom);
  const floors = exact.map((n) => Math.floor(n));
  let left = abs - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((n, i) => ({ i, frac: n - Math.floor(n), w: basis[i] }))
    .filter((row) => row.w > 0)
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let i = 0; left > 0; i = (i + 1) % order.length, left--) floors[order[i].i] += 1;
  return floors.map((n) => n * sign);
}

export function sharesOf(expense, members) {
  const ids = new Set(members.map((m) => m.id));
  const split = expense.split;
  const out = new Map();
  if (split.kind === "exact") {
    let total = 0;
    for (const [id, amount] of Object.entries(split.amounts)) {
      if (!ids.has(id)) continue;
      out.set(id, amount);
      total += amount;
    }
    if (total !== expense.amount) {
      const err = new Error(`Exact split adds up to ${total}, expected ${expense.amount}`);
      err.code = "SPLIT";
      throw err;
    }
    return out;
  }
  let who;
  let weights;
  if (split.kind === "shares") {
    who = Object.keys(split.shares).filter((id) => ids.has(id) && (split.shares[id] ?? 0) > 0);
    weights = who.map((id) => split.shares[id]);
  } else {
    who = split.among.filter((id) => ids.has(id));
    weights =
      split.kind === "weighted"
        ? who.map((id) => members.find((m) => m.id === id).weight)
        : who.map(() => 1);
  }
  if (who.length === 0) {
    const err = new Error("Split has no participants");
    err.code = "SPLIT";
    throw err;
  }
  allocate(expense.amount, weights).forEach((amount, i) => out.set(who[i], amount));
  return out;
}

export function balances(members, expenses, payments = []) {
  const nets = new Map(members.map((m) => [m.id, 0]));
  const add = (id, amount) => {
    if (nets.has(id)) nets.set(id, nets.get(id) + amount);
  };
  for (const expense of expenses) {
    if (!nets.has(expense.paidBy)) continue;
    add(expense.paidBy, expense.amount);
    for (const [id, share] of sharesOf(expense, members)) add(id, -share);
  }
  for (const payment of payments) {
    add(payment.from, payment.amount);
    add(payment.to, -payment.amount);
  }
  return nets;
}

function greedySettle(entries) {
  const debtors = entries
    .filter(([, v]) => v < 0)
    .map(([id, v]) => ({ id, v: -v }))
    .sort((a, b) => b.v - a.v || a.id.localeCompare(b.id));
  const creditors = entries
    .filter(([, v]) => v > 0)
    .map(([id, v]) => ({ id, v }))
    .sort((a, b) => b.v - a.v || a.id.localeCompare(b.id));
  const payments = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].v, creditors[j].v);
    payments.push({ from: debtors[i].id, to: creditors[j].id, amount });
    debtors[i].v -= amount;
    creditors[j].v -= amount;
    if (debtors[i].v === 0) i++;
    if (creditors[j].v === 0) j++;
  }
  return payments;
}

/** Fewest payments that bring every balance to zero. */
export function settle(nets) {
  const entries = [...nets.entries()]
    .filter(([, v]) => v !== 0)
    .sort((a, b) => a[0].localeCompare(b[0]));
  const n = entries.length;
  if (n === 0) return [];
  if (n > 16) return greedySettle(entries);
  const full = (1 << n) - 1;
  const sum = Array(full + 1).fill(0);
  for (let mask = 1; mask <= full; mask++) {
    const bit = mask & -mask;
    const index = 31 - Math.clz32(bit);
    sum[mask] = sum[mask ^ bit] + entries[index][1];
  }
  const best = new Int8Array(full + 1);
  const pick = new Int8Array(full + 1);
  for (let mask = 1; mask <= full; mask++) {
    let top = -1;
    let who = 0;
    for (let i = 0; i < n; i++) {
      if ((mask & (1 << i)) && best[mask ^ (1 << i)] > top) {
        top = best[mask ^ (1 << i)];
        who = i;
      }
    }
    best[mask] = top + (sum[mask] === 0 ? 1 : 0);
    pick[mask] = who;
  }
  const payments = [];
  let group = [];
  for (let mask = full; mask; ) {
    const who = pick[mask];
    group.push(entries[who]);
    mask ^= 1 << who;
    if (sum[mask] === 0) {
      payments.push(...greedySettle(group));
      group = [];
    }
  }
  return payments;
}

export function taxCents(amount, bps) {
  return Math.floor((amount * bps + 5000) / 10000);
}

export function cartTotals(items, taxRateBps) {
  let subtotal = 0;
  let taxable = 0;
  let basket = 0;
  let basketTaxable = 0;
  let itemCount = 0;
  for (const item of items) {
    const line = item.unitPrice * item.qty;
    subtotal += line;
    itemCount += item.qty;
    if (item.taxable) taxable += line;
    if (item.inBasket) {
      basket += line;
      if (item.taxable) basketTaxable += line;
    }
  }
  const tax = taxCents(taxable, taxRateBps);
  return {
    subtotal,
    taxableSubtotal: taxable,
    tax,
    total: subtotal + tax,
    basketTotal: basket + taxCents(basketTaxable, taxRateBps),
    itemCount,
  };
}

export function judgeBudget(spent, projected, available) {
  const pct = available > 0 ? spent / available : spent > 0 ? Infinity : 0;
  const level =
    spent > available ? "over" : pct >= 0.85 || projected > available ? "warn" : "ok";
  return { pct, level, remaining: available - spent };
}

function spentInMonth(spending, category, month) {
  let total = 0;
  for (const row of spending) {
    if (row.category === category && row.date.slice(0, 7) === month) total += row.amount;
  }
  return total;
}

/**
 * Leftover budget carried into `month`.
 * Counting starts at the first month with activity in that category, so turning
 * rollover on does not invent a pile of unused budget from empty months.
 */
export function rolloverCarry(budget, subscriptions, month) {
  const names = Array.isArray(budget.rollover) ? budget.rollover : [];
  const carry = {};
  for (const category of names) {
    const limit = budget.limits?.[category] || 0;
    if (limit <= 0) {
      carry[category] = 0;
      continue;
    }
    const activity = new Set();
    for (const row of budget.spending || []) {
      if (row.category === category) activity.add(row.date.slice(0, 7));
    }
    if (category === "Subscriptions") {
      for (let ago = 18; ago >= 1; ago--) {
        const prior = shiftMonth(month, -ago);
        const spent = chargesBetween(subscriptions || [], `${prior}-01`, monthEnd(prior)).reduce(
          (sum, row) => sum + row.amount,
          0,
        );
        if (spent > 0) activity.add(prior);
      }
    }
    const months = [...activity].filter((m) => m < month).sort();
    if (!months.length) {
      carry[category] = 0;
      continue;
    }
    let running = 0;
    for (let cursor = months[0]; cursor < month; cursor = shiftMonth(cursor, 1)) {
      let spent = spentInMonth(budget.spending || [], category, cursor);
      if (category === "Subscriptions") {
        spent += chargesBetween(subscriptions || [], `${cursor}-01`, monthEnd(cursor)).reduce(
          (sum, row) => sum + row.amount,
          0,
        );
      }
      running = limit + running - spent;
    }
    carry[category] = running;
  }
  return carry;
}

const CURRENCY_DIGITS = new Map();
function fractionDigits(currency) {
  if (CURRENCY_DIGITS.has(currency)) return CURRENCY_DIGITS.get(currency);
  let digits = 2;
  try {
    digits =
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
  } catch {
    digits = 2;
  }
  CURRENCY_DIGITS.set(currency, digits);
  return digits;
}

export function parseMoney(raw, currency = "USD") {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    const scale = 10 ** fractionDigits(currency);
    return Math.sign(raw) * Math.round(Number((Math.abs(raw) * scale).toFixed(6)));
  }
  let text = String(raw ?? "").trim();
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  if (comma > dot && (dot >= 0 || /,\d{1,2}\D*$/.test(text))) {
    text = text.replace(/[.\s\u00a0\u202f]/g, "").replace(",", ".");
  }
  text = text
    .replace(/[\s\u00a0\u202f,]/g, "")
    .replace(/^[^\d.+-]+/, "")
    .replace(/[^\d.]+$/, "");
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith("+")) text = text.slice(1);
  if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) return null;
  const scale = 10 ** fractionDigits(currency);
  const cents = Math.round(Number((Math.abs(Number(text)) * scale).toFixed(6)));
  return negative ? -cents : cents;
}

export function splitCsv(text) {
  const src = String(text ?? "").replace(/^\uFEFF/, "");
  const sample = src.split(/\r?\n/).slice(0, 20).join("\n");
  const delimiter = detectDelimiter(sample);
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function detectDelimiter(line) {
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && ch !== "\n" && ch !== "\r" && counts[ch] !== undefined) counts[ch]++;
  }
  let best = ",";
  let n = -1;
  for (const [ch, count] of Object.entries(counts)) {
    if (count > n) {
      best = ch;
      n = count;
    }
  }
  return n > 0 ? best : ",";
}

function headerScore(cell, rules) {
  const text = cell.trim().toLowerCase();
  let best = 0;
  for (const [re, score] of rules) if (re.test(text)) best = Math.max(best, score);
  return best;
}

const DATE_RULES = [
  [/^(transaction|posting|posted|book|value|booking)\s*date$/, 5],
  [/buchungstag|buchungsdatum|^(date|posted|posting|datum|fecha)$/, 4],
  [/date|datum|fecha|buchung/, 1],
];
const DESC_RULES = [
  [/description|narrative|particulars|verwendungszweck|buchungstext/, 5],
  [/merchant|payee|counterparty|empf[aä]nger|libell[eé]|concepto|omschrijving/, 4],
  [/memo|details|reference|descri/, 3],
  [/name/, 1],
];
const AMOUNT_RULES = [
  [/^(transaction\s*)?amount$|^betrag$|^umsatz$|^montant$|^importe$|^valor$|^bedrag$/, 5],
  [/amount|betrag|umsatz|montant|importe/, 3],
];
const DEBIT_RULES = [
  [/^(debit|debits|withdrawal|withdrawals|money\s*out|outflow|paid\s*out)$/, 5],
  [/\b(debit|withdrawals?|money\s*out|outflow|paid\s*out)\b(?!\s*cards?)/, 4],
];
const CREDIT_RULES = [
  [/^(credit|credits|deposit|deposits|money\s*in|inflow|paid\s*in)$/, 5],
  [/\b(credits?|deposits?|money\s*in|inflow|paid\s*in)\b(?!\s*cards?)/, 4],
];

function bestColumn(headers, rules) {
  let index = -1;
  let score = 0;
  headers.forEach((cell, i) => {
    const s = headerScore(cell, rules);
    if (s > score) {
      score = s;
      index = i;
    }
  });
  return index;
}

function looksLikeHeader(cells) {
  const date = bestColumn(cells, DATE_RULES);
  const amount = bestColumn(cells, AMOUNT_RULES);
  const debit = bestColumn(cells, DEBIT_RULES);
  return date >= 0 && (amount >= 0 || debit >= 0);
}

function padYear(yy) {
  const n = Number(yy);
  if (yy.length === 4) return n;
  return 2000 + n;
}

function buildIso(year, month, day) {
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : null;
}

function parseWithOrder(text, order) {
  const trimmed = text.trim();
  if (isIsoDate(trimmed.slice(0, 10)) && /^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(trimmed);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const year = padYear(m[3]);
    return order === "dmy" ? buildIso(year, b, a) : buildIso(year, a, b);
  }
  m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(trimmed);
  if (m) return buildIso(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

export function detectDateOrder(samples) {
  let firstOver = false;
  let secondOver = false;
  for (const sample of samples) {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(String(sample).trim());
    if (!m) continue;
    if (Number(m[1]) > 12) firstOver = true;
    if (Number(m[2]) > 12) secondOver = true;
  }
  if (firstOver && !secondOver) return "dmy";
  if (secondOver && !firstOver) return "mdy";
  return null;
}

const DMY_CURRENCIES = new Set([
  "EUR",
  "GBP",
  "INR",
  "AUD",
  "NZD",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "BRL",
  "ZAR",
  "NGN",
  "KES",
  "EGP",
  "AED",
  "SAR",
  "TRY",
  "PKR",
  "BDT",
  "LKR",
  "NPR",
  "IDR",
  "MYR",
  "PHP",
  "THB",
  "VND",
  "ARS",
  "CLP",
  "COP",
  "PEN",
  "HKD",
  "SGD",
]);

export function parseBankTable(rows, currency = "USD") {
  if (!rows || rows.length < 2) {
    throw new Error("Could not find date, description and amount columns in this CSV.");
  }
  let headerAt = 0;
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    if (looksLikeHeader(rows[i])) {
      headerAt = i;
      break;
    }
  }
  const headers = rows[headerAt].map((c) => c.trim().toLowerCase());
  const dateCol = bestColumn(headers, DATE_RULES);
  const descCol = bestColumn(headers, DESC_RULES);
  const amountCol = bestColumn(headers, AMOUNT_RULES);
  const debitCol = bestColumn(headers, DEBIT_RULES);
  const creditCol = bestColumn(headers, CREDIT_RULES);
  const distinctDebit = debitCol >= 0 && debitCol !== amountCol ? debitCol : -1;
  const distinctCredit = creditCol >= 0 && creditCol !== amountCol && creditCol !== distinctDebit ? creditCol : -1;
  if (dateCol < 0 || descCol < 0 || (amountCol < 0 && distinctDebit < 0 && distinctCredit < 0)) {
    throw new Error("Could not find date, description and amount columns in this CSV.");
  }
  const body = rows.slice(headerAt + 1);
  const samples = body.map((r) => r[dateCol] ?? "");
  const order =
    detectDateOrder(samples) || (DMY_CURRENCIES.has(currency) ? "dmy" : "mdy");
  const expenses = [];
  const income = [];
  const signed = [];
  for (const row of body) {
    const date = parseWithOrder(row[dateCol] ?? "", order);
    const description = (row[descCol] ?? "").trim();
    if (!date || !description) continue;
    if (distinctDebit >= 0 || distinctCredit >= 0) {
      const debit = distinctDebit >= 0 ? parseMoney(row[distinctDebit] ?? "", currency) : null;
      const credit = distinctCredit >= 0 ? parseMoney(row[distinctCredit] ?? "", currency) : null;
      if (debit) {
        expenses.push({ date, description, amount: Math.abs(debit) });
        continue;
      }
      if (credit) {
        income.push({ date, description, amount: Math.abs(credit) });
        continue;
      }
      if (amountCol < 0) continue;
    }
    const amount = parseMoney(row[amountCol] ?? "", currency);
    if (!amount) continue;
    signed.push({ date, description, signed: amount });
  }
  if (signed.length) {
    const negatives = signed.filter((r) => r.signed < 0).length;
    const expensesAreNegative = negatives >= signed.length / 2;
    for (const row of signed) {
      const item = { date: row.date, description: row.description, amount: Math.abs(row.signed) };
      const isExpense = expensesAreNegative ? row.signed < 0 : row.signed > 0;
      (isExpense ? expenses : income).push(item);
    }
  }
  return { expenses, income, dateOrder: order };
}

const CATEGORY_RULES = [
  [/grocer|supermarket|market|whole ?foods|trader joe|aldi|kroger|safeway|costco|tesco|sainsbury|lidl|publix|wegmans|heb\b|food ?lion|walmart ?(neighborhood|grocery)|coles\b|woolworths|carrefour|waitrose|asda|morrisons/i, "Groceries"],
  [/restaurant|cafe|coffee|starbucks|pizza|burger|grill|bistro|diner|bar\b|pub\b|doordash|uber ?eats|grubhub|deliveroo|mcdonald|chipotle|taco|sushi|kitchen|bakery|nandos|pret a manger/i, "Dining out"],
  [/uber(?! ?eats)|lyft|taxi|transit|metro|subway fare|rail|train|parking|shell|chevron|exxon|\bbp\b|fuel|gas station|toll|mta\b|tfl\b|oyster|bus\b|bolt\b/i, "Transport"],
  [/rent|mortgage|landlord|property|hoa\b|apartment/i, "Housing"],
  [/electric|water|utility|energy|internet|comcast|xfinity|verizon|at&t|t-mobile|phone bill|insurance|council tax|vodafone|o2\b|ee\b|virgin media|spectrum|pg&e|national grid/i, "Bills"],
  [/netflix|spotify|hulu|disney|youtube|prime video|apple\.com\/bill|itunes|cinema|movie|theat|concert|ticket|steam|playstation|xbox|nintendo|game/i, "Fun"],
  [/pharma|cvs|walgreens|doctor|dental|clinic|hospital|health|gym|fitness|boots\b|pharmacy/i, "Health"],
  [/airline|airways|hotel|airbnb|booking\.com|expedia|flight|hostel|ryanair|easyjet|uber trip/i, "Travel"],
  [/amazon|target|walmart|ebay|etsy|best ?buy|ikea|shop|store|mall|argos/i, "Shopping"],
];

export function categorize(description) {
  const text = String(description ?? "");
  for (const [re, category] of CATEGORY_RULES) if (re.test(text)) return category;
  return "Other";
}

export function normalizeMerchant(description) {
  let text = String(description ?? "").toUpperCase();
  for (let i = 0; i < 3; i++) {
    const next = text.replace(/^(POS|ACH|DEBIT|CHECKCARD|PURCHASE|RECURRING|SQ|TST|PP)\s*\*?\s*/, "");
    if (next === text) break;
    text = next;
  }
  return text
    .replace(/\*.*$/, "")
    .replace(/#\s*\d+/g, "")
    .replace(/\b\d[\d\-\s]{3,}\b/g, "")
    .replace(/\b(US|USA|CA|NY|TX|WA|INC|LLC|LTD|CO)\b\.?/g, "")
    .replace(/[^A-Z0-9.&' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .split(" ")
    .slice(0, 3)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ""))
    .join(" ")
    .trim();
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const RECUR_WINDOWS = [
  ["weekly", 7, 2],
  ["monthly", 30.4, 4],
  ["quarterly", 91.3, 8],
  ["annual", 365.25, 15],
];

export function detectRecurring(charges) {
  const groups = new Map();
  for (const charge of charges) {
    const name = normalizeMerchant(charge.description);
    if (!name) continue;
    groups.set(name, [...(groups.get(name) ?? []), charge]);
  }
  const found = [];
  for (const [name, rows] of groups) {
    if (rows.length < 2) continue;
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    const gaps = sorted.slice(1).map((row, i) => daysBetween(sorted[i].date, row.date));
    const gap = median(gaps);
    const window = RECUR_WINDOWS.find(([, center, slack]) => Math.abs(gap - center) <= slack);
    if (!window) continue;
    const [cycle, center, slack] = window;
    if (cycle === "weekly" && sorted.length < 3) continue;
    const spread = (values) => {
      const mid = median(values);
      return Math.max(...values.map((v) => Math.abs(v - mid) / mid));
    };
    const amounts = sorted.map((row) => row.amount);
    let amountSpread = spread(amounts);
    let previousAmount;
    if (amountSpread > 0.15) {
      const prior = amounts.slice(0, -1);
      if (prior.length >= 2 && spread(prior) <= 0.05) {
        previousAmount = Math.round(median(prior));
        amountSpread = spread(prior);
      } else continue;
    }
    const gapSpread = Math.max(...gaps.map((g) => Math.abs(g - center))) / (slack * 2);
    const confidence = Math.max(
      0,
      Math.min(1, 0.5 + 0.15 * (sorted.length - 2) - 0.3 * Math.min(1, gapSpread) - amountSpread),
    );
    const last = sorted.at(-1);
    found.push({
      name,
      amount: last.amount,
      cycle,
      lastCharged: last.date,
      nextExpected: stepCycle(last.date, cycle, 1),
      occurrences: sorted.length,
      confidence: Math.round(confidence * 100) / 100,
      ...(previousAmount === undefined ? {} : { previousAmount }),
    });
  }
  return found.sort((a, b) => b.confidence - a.confidence || b.amount - a.amount);
}

function cents(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function keepString(value, fallback, max = 80) {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

/**
 * Best-effort recovery when a saved file fails strict validation.
 * Drops broken rows instead of throwing away the whole file.
 */
const CYCLES = ["weekly", "monthly", "quarterly", "annual"];
const SOURCES = ["manual", "receipt", "bank", "cart", "bill"];

function salvageSplitKind(split, ids) {
  if (!split || typeof split !== "object") return null;
  if (split.kind === "equal" || split.kind === "weighted") {
    const among = Array.isArray(split.among)
      ? split.among.filter((id) => typeof id === "string" && ids.has(id))
      : [];
    return among.length ? { kind: split.kind, among } : null;
  }
  if (split.kind === "shares" && split.shares && typeof split.shares === "object") {
    const shares = {};
    for (const [id, value] of Object.entries(split.shares)) {
      const n = Number(value);
      if (ids.has(id) && Number.isFinite(n) && n > 0) shares[id] = n;
    }
    return Object.keys(shares).length ? { kind: "shares", shares } : null;
  }
  if (split.kind === "exact" && split.amounts && typeof split.amounts === "object") {
    const amounts = {};
    for (const [id, value] of Object.entries(split.amounts)) {
      const n = cents(value);
      if (ids.has(id) && n !== null && n >= 0) amounts[id] = n;
    }
    return Object.keys(amounts).length ? { kind: "exact", amounts } : null;
  }
  return null;
}

function salvageSplit(split) {
  const src = split && typeof split === "object" ? split : {};
  const members = [];
  const ids = new Set();
  for (const row of Array.isArray(src.members) ? src.members : []) {
    if (!row || typeof row !== "object" || typeof row.name !== "string" || !row.name) continue;
    const weight = Number(row.weight ?? 1);
    if (!Number.isFinite(weight) || weight < 0) continue;
    const id = keepString(row.id, `m${members.length}`, 40);
    if (ids.has(id)) continue;
    ids.add(id);
    members.push({ id, name: keepString(row.name, "Person", 80), weight });
  }
  const expenses = [];
  for (const row of Array.isArray(src.expenses) ? src.expenses : []) {
    const amount = row && cents(row.amount);
    if (!row || typeof row.description !== "string" || !row.description) continue;
    if (amount === null || amount < 0 || !isIsoDate(row.date) || !ids.has(row.paidBy)) continue;
    const kind = salvageSplitKind(row.split, ids);
    if (!kind) continue;
    const item = {
      id: keepString(row.id, `x${expenses.length}`, 40),
      description: keepString(row.description, "Expense", 140),
      date: row.date,
      paidBy: row.paidBy,
      amount,
      split: kind,
    };
    if (row.original && typeof row.original === "object") {
      const currency = keepString(row.original.currency, "", 8);
      const originalAmount = cents(row.original.amount);
      const rate = Number(row.original.rate);
      if (currency && originalAmount !== null && originalAmount >= 0 && Number.isFinite(rate) && rate > 0) {
        item.original = { currency, amount: originalAmount, rate };
      }
    }
    expenses.push(item);
  }
  const payments = [];
  for (const row of Array.isArray(src.payments) ? src.payments : []) {
    const amount = row && cents(row.amount);
    if (!row || amount === null || amount < 0 || !isIsoDate(row.date)) continue;
    if (!ids.has(row.from) || !ids.has(row.to)) continue;
    payments.push({
      id: keepString(row.id, `p${payments.length}`, 40),
      from: row.from,
      to: row.to,
      amount,
      date: row.date,
    });
  }
  return {
    currency: keepString(src.currency, "USD", 8) || "USD",
    members,
    expenses,
    payments,
  };
}

function salvageCart(cart) {
  const src = cart && typeof cart === "object" ? cart : {};
  const items = [];
  for (const row of Array.isArray(src.items) ? src.items : []) {
    const unitPrice = row && cents(row.unitPrice);
    const qty = row && cents(row.qty);
    if (!row || typeof row.name !== "string" || !row.name) continue;
    if (unitPrice === null || unitPrice < 0 || qty === null || qty < 1) continue;
    items.push({
      id: keepString(row.id, `c${items.length}`, 40),
      name: keepString(row.name, "Item", 80),
      unitPrice,
      qty,
      taxable: !!row.taxable,
      inBasket: !!row.inBasket,
    });
  }
  const tax = cents(src.taxRateBps);
  const budget = cents(src.budget);
  return {
    items,
    taxRateBps: tax !== null && tax >= 0 && tax <= 3000 ? tax : 825,
    budget: budget !== null && budget >= 0 ? budget : 10000,
  };
}

function salvageBills(rows) {
  const bills = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const estimate = row && cents(row.estimate);
    if (!row || typeof row.name !== "string" || !row.name || estimate === null || estimate < 0) continue;
    if (!isIsoDate(row.anchor)) continue;
    const payments = [];
    for (const pay of Array.isArray(row.payments) ? row.payments : []) {
      const amount = pay && cents(pay.amount);
      if (!pay || amount === null || amount < 0 || !isIsoDate(pay.due) || !isIsoDate(pay.paidOn)) continue;
      const item = { due: pay.due, amount, paidOn: pay.paidOn };
      if (typeof pay.spendId === "string") item.spendId = pay.spendId;
      payments.push(item);
    }
    bills.push({
      id: keepString(row.id, `b${bills.length}`, 40),
      name: keepString(row.name, "Bill", 80),
      estimate,
      cycle: CYCLES.includes(row.cycle) ? row.cycle : "monthly",
      anchor: row.anchor,
      category: keepString(row.category, "Bills", 40),
      autopay: !!row.autopay,
      leadDays: Number.isInteger(row.leadDays) ? row.leadDays : 3,
      payments,
    });
  }
  return bills;
}

function salvageGoals(rows) {
  const goals = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const target = row && cents(row.target);
    const saved = row && cents(row.saved ?? 0);
    if (!row || typeof row.name !== "string" || !row.name || target === null || target < 0) continue;
    if (saved === null || saved < 0) continue;
    const goal = {
      id: keepString(row.id, `g${goals.length}`, 40),
      name: keepString(row.name, "Goal", 80),
      target,
      saved,
    };
    if (row.by !== undefined && isIsoDate(row.by)) goal.by = row.by;
    goals.push(goal);
  }
  return goals;
}

function salvagePay(pay) {
  if (!pay || typeof pay !== "object") return null;
  const amount = cents(pay.pay);
  const balance = cents(pay.balance);
  const keep = cents(pay.keepAside ?? 0);
  if (amount === null || amount < 0 || balance === null || keep === null || keep < 0) return null;
  if (!PAY_CYCLES.includes(pay.cycle) || !isIsoDate(pay.payday) || !isIsoDate(pay.balanceOn)) return null;
  const out = {
    pay: amount,
    cycle: pay.cycle,
    payday: pay.payday,
    balance,
    balanceOn: pay.balanceOn,
    keepAside: keep,
  };
  if (Array.isArray(pay.counted)) out.counted = pay.counted.filter((id) => typeof id === "string");
  return out;
}

function salvageIncome(rows) {
  const income = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const amount = row && cents(row.amount);
    if (!row || amount === null || amount < 0 || !isIsoDate(row.date)) continue;
    income.push({
      id: keepString(row.id, `i${income.length}`, 40),
      date: row.date,
      amount,
      note: keepString(row.note, "", 140),
      source: SOURCES.includes(row.source) ? row.source : "manual",
    });
  }
  return income;
}

export function salvageState(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const src = input;
  const settings = src.settings && typeof src.settings === "object" ? src.settings : {};
  const currency = keepString(settings.currency, "USD", 8) || "USD";
  const theme = ["system", "light", "dark"].includes(settings.theme) ? settings.theme : "system";
  const highCost = cents(settings.highCost);
  const subscriptions = [];
  for (const row of Array.isArray(src.subscriptions) ? src.subscriptions : []) {
    if (!row || typeof row !== "object") continue;
    const amount = cents(row.amount ?? row.cost);
    if (!row.name || amount === null || amount < 0) continue;
    const anchor = isIsoDate(row.anchor) ? row.anchor : isIsoDate(row.date) ? row.date : null;
    if (!anchor) continue;
    subscriptions.push({
      id: keepString(row.id, `s${subscriptions.length}`, 40),
      name: keepString(row.name, "Untitled", 80),
      amount,
      cycle: CYCLES.includes(row.cycle) ? row.cycle : "monthly",
      anchor,
      category: keepString(row.category, "Other", 40),
      leadDays: Number.isInteger(row.leadDays) ? row.leadDays : 3,
      status: ["active", "trial", "paused"].includes(row.status) ? row.status : "active",
      usage: ["daily", "weekly", "monthly", "rarely", "never"].includes(row.usage)
        ? row.usage
        : "monthly",
    });
  }
  const budgetSrc = src.budget && typeof src.budget === "object" ? src.budget : {};
  const limits = {};
  if (budgetSrc.limits && typeof budgetSrc.limits === "object") {
    for (const [key, value] of Object.entries(budgetSrc.limits)) {
      const amount = cents(value);
      if (amount !== null && amount >= 0) limits[String(key).slice(0, 40)] = amount;
    }
  }
  const spending = [];
  for (const row of Array.isArray(budgetSrc.spending) ? budgetSrc.spending : []) {
    if (!row || typeof row !== "object") continue;
    const amount = cents(row.amount);
    if (amount === null || amount < 0 || !isIsoDate(row.date)) continue;
    spending.push({
      id: keepString(row.id, `e${spending.length}`, 40),
      date: row.date,
      amount,
      category: keepString(row.category, "Other", 40),
      note: keepString(row.note, "", 140),
      source: SOURCES.includes(row.source) ? row.source : "manual",
    });
  }
  const sync = src.sync && typeof src.sync === "object" ? src.sync : {};
  return {
    version: 2,
    settings: { currency, theme, highCost: highCost && highCost > 0 ? highCost : 2000 },
    subscriptions,
    split: salvageSplit(src.split),
    cart: salvageCart(src.cart),
    budget: {
      spending,
      limits,
      goals: salvageGoals(budgetSrc.goals),
      bills: salvageBills(budgetSrc.bills),
      pay: salvagePay(budgetSrc.pay),
      rollover: Array.isArray(budgetSrc.rollover)
        ? budgetSrc.rollover.filter((n) => typeof n === "string")
        : [],
      income: salvageIncome(budgetSrc.income),
    },
    alternatives: { shortlist: [] },
    sync: {
      owner: keepString(sync.owner, "", 80),
      repo: keepString(sync.repo, "", 80),
      branch: keepString(sync.branch, "main", 80) || "main",
      path: keepString(sync.path, "data/subscriptions.json", 120) || "data/subscriptions.json",
      encrypt: !!sync.encrypt,
    },
    _salvaged: true,
  };
}

function paidDue(bill, date) {
  return (bill.payments || []).some((p) => p.due === date);
}

/** Bills and renewals that should be on screen or in a notification. */
export function attentionItems({ subscriptions = [], bills = [], today, snoozed = {} }) {
  const items = [];
  const hidden = (key) => snoozed[key] && snoozed[key] > today;
  for (const bill of bills) {
    const lead = Math.max(0, bill.leadDays || 0);
    const from = addDays(today, -45);
    const to = addDays(today, lead);
    for (const date of occurrences(bill.anchor, bill.cycle || "monthly", from, to)) {
      if (paidDue(bill, date)) continue;
      const key = `bill:${bill.id}:${date}`;
      if (hidden(key)) continue;
      const days = daysBetween(today, date);
      if (days > lead) continue;
      items.push({
        key,
        kind: "bill",
        id: bill.id,
        name: bill.name,
        date,
        amount: bill.estimate,
        leadDays: lead,
        autopay: !!bill.autopay,
        category: bill.category || "Bills",
        state: days < 0 ? "overdue" : days === 0 ? "due" : "soon",
        days,
      });
    }
  }
  for (const sub of subscriptions) {
    if (sub.status === "paused") continue;
    const lead = Math.max(0, sub.leadDays || 0);
    const to = addDays(today, lead);
    if (sub.status === "trial" && isIsoDate(sub.trialEnds) && sub.trialEnds >= today && sub.trialEnds <= to) {
      const key = `${sub.id}:trial:${sub.trialEnds}`;
      if (!hidden(key)) {
        const days = daysBetween(today, sub.trialEnds);
        items.push({
          key,
          kind: "trial",
          id: sub.id,
          name: sub.name,
          date: sub.trialEnds,
          amount: sub.amount,
          leadDays: lead,
          state: days === 0 ? "due" : "soon",
          days,
        });
      }
    }
    for (const charge of chargesBetween([sub], today, to)) {
      if (sub.status === "trial" && sub.trialEnds && charge.date <= sub.trialEnds) continue;
      const key = `${sub.id}:${charge.date}`;
      if (hidden(key)) continue;
      const days = daysBetween(today, charge.date);
      items.push({
        key,
        kind: "subscription",
        id: sub.id,
        name: sub.name,
        date: charge.date,
        amount: charge.amount,
        leadDays: lead,
        state: days === 0 ? "due" : "soon",
        days,
      });
    }
  }
  const rank = { overdue: 0, due: 1, soon: 2 };
  return items.sort(
    (a, b) => rank[a.state] - rank[b.state] || a.date.localeCompare(b.date) || a.name.localeCompare(b.name),
  );
}

/** Which stored reminders should notify today, including recent overdue ones. */
export function dueReminders(schedule, today, { notified = [], snoozed = {} } = {}) {
  const seen = new Set(notified);
  const oldest = addDays(today, -45);
  return (schedule || []).filter((item) => {
    const until = snoozed[item.key];
    if (until && until > today) return false;
    if (seen.has(item.key)) return false;
    if (!item.notifyOn || item.notifyOn > today) return false;
    if (!item.date || item.date < oldest) return false;
    return true;
  });
}

export function yearReview({
  spending = [],
  subscriptions = [],
  income = [],
  pay = null,
  goals = [],
  year,
}) {
  const y = String(year);
  const months = [];
  const catTotals = new Map();
  for (let m = 1; m <= 12; m++) {
    const month = `${y}-${String(m).padStart(2, "0")}`;
    const start = `${month}-01`;
    const end = monthEnd(month);
    const byCategory = new Map();
    let out = 0;
    for (const row of spending) {
      if (!row.date || row.date.slice(0, 7) !== month) continue;
      out += row.amount;
      byCategory.set(row.category, (byCategory.get(row.category) || 0) + row.amount);
    }
    let subSum = 0;
    for (const charge of chargesBetween(
      subscriptions.filter((sub) => sub.status !== "paused"),
      start,
      end,
    )) {
      subSum += charge.amount;
      out += charge.amount;
      byCategory.set("Subscriptions", (byCategory.get("Subscriptions") || 0) + charge.amount);
    }
    let inn = 0;
    for (const row of income) if (row.date && row.date.slice(0, 7) === month) inn += row.amount;
    if (pay) inn += paydaysBetween(pay, start, end).length * pay.pay;
    for (const [category, amount] of byCategory) {
      catTotals.set(category, (catTotals.get(category) || 0) + amount);
    }
    months.push({
      month,
      moneyIn: inn,
      moneyOut: out,
      net: inn - out,
      subscriptions: subSum,
      byCategory: [...byCategory.entries()]
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount),
    });
  }
  const changes = [];
  for (let i = 1; i < months.length; i++) {
    const prev = new Map(months[i - 1].byCategory.map((row) => [row.category, row.amount]));
    const cur = new Map(months[i].byCategory.map((row) => [row.category, row.amount]));
    for (const name of new Set([...prev.keys(), ...cur.keys()])) {
      const delta = (cur.get(name) || 0) - (prev.get(name) || 0);
      if (delta !== 0) {
        changes.push({
          category: name,
          month: months[i].month,
          delta,
          from: prev.get(name) || 0,
          to: cur.get(name) || 0,
        });
      }
    }
  }
  changes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const merchants = new Map();
  for (const row of spending) {
    if (!row.date || row.date.slice(0, 4) !== y) continue;
    const name = normalizeMerchant(row.note || "") || row.category || "Other";
    const cur = merchants.get(name) || { name, amount: 0, count: 0 };
    cur.amount += row.amount;
    cur.count += 1;
    merchants.set(name, cur);
  }
  let subscriptionsAnnual = 0;
  for (const sub of subscriptions) {
    if (sub.status === "paused") continue;
    const mult = { weekly: 52, monthly: 12, quarterly: 4, annual: 1 }[sub.cycle] || 0;
    subscriptionsAnnual += sub.amount * mult;
  }
  const moneyIn = months.reduce((sum, month) => sum + month.moneyIn, 0);
  const moneyOut = months.reduce((sum, month) => sum + month.moneyOut, 0);
  return {
    year: y,
    months,
    categories: [...catTotals.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount),
    changes: changes.slice(0, 6),
    merchants: [...merchants.values()].sort((a, b) => b.amount - a.amount).slice(0, 8),
    subscriptionsAnnual,
    goals: (goals || []).map((goal) => ({
      name: goal.name,
      saved: goal.saved || 0,
      target: goal.target || 0,
      pct: goal.target > 0 ? Math.min(1, (goal.saved || 0) / goal.target) : 0,
    })),
    moneyIn,
    moneyOut,
    net: moneyIn - moneyOut,
  };
}

/** A recurring-calendar rule that still fires in short months. */
export function calendarRule(cycle, anchor) {
  const day = Number(String(anchor).slice(8, 10));
  const month = String(anchor).slice(5, 7);
  const last =
    day > 28
      ? `;BYMONTHDAY=${Array.from({ length: day - 27 }, (_, i) => 28 + i).join(",")};BYSETPOS=-1`
      : "";
  if (cycle === "weekly") return "FREQ=WEEKLY";
  if (cycle === "quarterly") return `FREQ=MONTHLY;INTERVAL=3${last}`;
  if (cycle === "annual") {
    return day > 28 && month === "02" ? "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1" : "FREQ=YEARLY";
  }
  return `FREQ=MONTHLY${last}`;
}

export function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function icsEscape(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** A calendar file for renewals and bills. Amounts are omitted unless includeAmounts is set. */
export function icsCalendar(events, { name = "Tally", includeAmounts = false } = {}) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tally//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(name)}`,
  ];
  for (const event of events) {
    const summary = includeAmounts && event.amountLabel ? `${event.summary} · ${event.amountLabel}` : event.summary;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${icsEscape(event.uid)}@tally`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${String(event.date).replace(/-/g, "")}`,
    );
    if (event.rrule) lines.push(`RRULE:${event.rrule}`);
    lines.push(
      `SUMMARY:${icsEscape(summary)}`,
      `DESCRIPTION:${icsEscape(event.description || "")}`,
      "TRANSP:TRANSPARENT",
    );
    const alarm = Math.max(0, event.alarmDays || 0);
    if (alarm > 0) {
      lines.push(
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${icsEscape(summary)}`,
        `TRIGGER:-P${alarm}D`,
        "END:VALARM",
      );
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

globalThis.TallyCore = {
  safeToSpend,
  allocate,
  sharesOf,
  balances,
  settle,
  taxCents,
  cartTotals,
  judgeBudget,
  rolloverCarry,
  parseMoney,
  splitCsv,
  parseBankTable,
  categorize,
  normalizeMerchant,
  detectRecurring,
  salvageState,
  paydaysBetween,
  runningNet,
  monthEnd,
  attentionItems,
  dueReminders,
  yearReview,
  icsCalendar,
  calendarRule,
  htmlEscape,
  addDays,
};
