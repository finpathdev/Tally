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

const tabs = ["today", "subscriptions", "split", "cart", "budget", "alternatives", "sync", "help"];
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
    if (logs.length) failures.push(`${name} console: ${logs.join(" | ")}`);
    await context.close();
    console.log(name, "ok");
  }
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("smoke ok");
