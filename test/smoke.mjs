/**
 * Opens every Tally tab at desktop and phone widths.
 * Fails on console errors, page errors, or horizontal overflow.
 *
 *   node test/smoke.mjs
 */
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith("/")) path += "index.html";
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/`;

const tabs = ["today", "subscriptions", "split", "cart", "budget", "alternatives", "sync", "year", "help"];
const widths = [
  ["desktop", 1440, 900],
  ["mobile", 390, 844],
];

const browser = await chromium.launch({
  executablePath: process.env.CHROME || "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const failures = [];

try {
  for (const [name, width, height] of widths) {
    const context = await browser.newContext({
      viewport: { width, height },
      locale: "en-US",
      reducedMotion: "reduce",
    });
    await context.addInitScript(() => localStorage.setItem("tally:lang", "en"));
    const page = await context.newPage();
    const logs = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") logs.push(msg.text());
    });
    page.on("pageerror", (err) => logs.push(String(err)));
    await page.goto(base, { waitUntil: "domcontentloaded" });
    const cont = page.getByRole("button", { name: /^continue$/i });
    if (await cont.count()) await cont.click();
    await page.waitForTimeout(400);
    const tour = page.locator(".tour");
    if (await tour.count()) failures.push(`${name}: tour blocked the first screen`);
    for (const tab of tabs) {
      await page.goto(base + "#/" + tab, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(250);
      const title = await page.locator("h2").first().innerText();
      if (!title) failures.push(`${name} ${tab}: missing heading`);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (overflow > 4) failures.push(`${name} ${tab}: horizontal overflow ${overflow}px`);
    }
    const today = await page.goto(base + "#/today", { waitUntil: "domcontentloaded" }).then(() =>
      page.locator("#app").innerText(),
    );
    if (!today.includes("Safe to spend") && !today.includes("SAFE TO SPEND")) {
      failures.push(`${name}: Today is missing safe to spend`);
    }
    if (name === "desktop") {
      const dueCard = page.locator(".due-card");
      const dueText = await dueCard.innerText();
      if (!dueText.includes("Due and overdue")) failures.push("today is missing the due list");
      if (!dueText.includes("Overdue") || !dueText.includes("Electricity")) {
        failures.push("today is missing the overdue electricity bill");
      }
      if (!dueText.includes("Gym Membership")) failures.push("today is missing the gym reminder inside its lead time");
      await dueCard.getByRole("button", { name: "Mark paid" }).first().click();
      await page.waitForTimeout(250);
      const paid = await dueCard.innerText();
      if (paid.includes("Electricity")) failures.push("mark paid left Electricity on Today");
      const snooze = dueCard.getByRole("button", { name: "Snooze 7 days" }).first();
      const name = (await snooze.locator("xpath=ancestor::li").innerText()).split("\n")[0];
      await snooze.click();
      await page.waitForTimeout(250);
      const dueAfter = await dueCard.innerText();
      if (dueAfter.includes(name)) failures.push(`snooze left ${name} on Today`);
      await page.goto(base + "#/year", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(200);
      const year = await page.locator("#app").innerText();
      if (!year.includes("Year in Tally") || !year.includes("Where it went") || !year.includes("By month")) {
        failures.push("year review is missing its sections");
      }
      if (year.includes("Top places")) failures.push("year review showed merchant names before they were asked for");
      await page.getByRole("checkbox", { name: "Include names" }).check();
      await page.waitForTimeout(150);
      const named = await page.locator("#app").innerText();
      if (!named.includes("Top places")) failures.push("include names did not reveal merchants");
    }
    if (logs.length) failures.push(`${name} console: ${logs.join(" | ")}`);
    await context.close();
    console.log(name, "ok");
  }

  const arabic = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "ar",
  });
  const arPage = await arabic.newPage();
  await arPage.addInitScript(() => localStorage.setItem("tally:lang", "ar"));
  await arPage.goto(base + "#/today", { waitUntil: "domcontentloaded" });
  await arPage.waitForTimeout(600);
  const dir = await arPage.evaluate(() => document.documentElement.dir);
  const heading = await arPage.locator("h2").first().innerText();
  if (dir !== "rtl") failures.push(`arabic dir is ${dir}`);
  if (!heading.includes("اليوم")) failures.push(`arabic heading is ${heading}`);
  const chart = await arPage.locator(".run-fig").count();
  if (!chart) failures.push("arabic today is missing the running total");
  await arabic.close();
  console.log("arabic rtl ok");

  const repair = await browser.newContext({ viewport: { width: 1200, height: 800 }, locale: "en-US" });
  const repairPage = await repair.newPage();
  await repairPage.addInitScript(() => {
    localStorage.setItem("tally:lang", "en");
    localStorage.setItem(
      "tally:v2",
      JSON.stringify({
        version: 2,
        subscriptions: [{ id: "bad", name: "Broken", amount: "nope", cycle: "monthly", anchor: "2026-01-01" }],
        split: {
          currency: "USD",
          members: [{ id: "a", name: "Alex Kept", weight: 1 }],
          expenses: [],
          payments: [],
        },
        budget: {
          bills: [
            {
              id: "rent",
              name: "Rent Kept",
              estimate: 10000,
              cycle: "monthly",
              anchor: "2026-03-01",
              payments: [],
            },
          ],
        },
      }),
    );
  });
  await repairPage.goto(base + "#/split", { waitUntil: "domcontentloaded" });
  await repairPage.waitForTimeout(500);
  const splitText = await repairPage.locator("#app").innerText();
  if (!splitText.includes("Alex Kept")) failures.push("repair dropped the split group");
  await repairPage.goto(base + "#/budget");
  await repairPage.waitForTimeout(300);
  const budgetText = await repairPage.locator("#app").innerText();
  if (!budgetText.includes("Rent Kept")) failures.push("repair dropped the bill");
  await repair.close();
  console.log("repair ok");
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("smoke ok");
