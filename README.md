# Tally

A local-first money dashboard: subscriptions, fair group splits, a tax-aware cart, and a help desk that explains everything. Your data stays in your browser.

This is the **one-file version**: the whole app is in `index.html`, and everything else sits next to it in the same folder.

## Files

| File | What it is |
| :-- | :-- |
| `index.html` | The entire app: all code and styles. Open it in a browser to use it. |
| `tally-icon.svg`, `tally-icon-192.png`, `tally-icon-512.png`, `tally-icon-maskable-512.png`, `tally-apple-touch-icon.png` | The logo in the sizes browsers and phones need |
| `tally-gloock.woff2`, `tally-hanken-grotesk.woff2`, `tally-martian-mono.woff2` | The three fonts |
| `tally-manifest.webmanifest` | Lets people install Tally as an app |
| `tally-sw.js` | Makes Tally work offline and handles reminders |
| `tally-renewal-check.mjs` | Optional: powers email alerts before renewals (see below) |

## Put it on GitHub Pages

1. In your repository on github.com, click **Add file → Upload files**.
2. Click **choose your files**, select **all** of these files, then click **Commit changes**. There are no folders, so nothing gets skipped.
3. Open **Settings → Pages**. Under *Build and deployment*, set **Source** to **Deploy from a branch**, choose **main** and **/ (root)**, then click **Save**.
4. Wait about a minute and open `https://<your-username>.github.io/<repository>/`.

To update later, upload the changed files again. Uploading replaces files with the same name.

## Edit it

Open `index.html` in any text editor. Near the top is a `<style>` block with all the styling. The colors are defined once at the start, under `:root`. Below that is a `<script type="module">` block with all the code.

You can open `index.html` straight from your computer to try changes. Offline mode and the install button only work once it's on your website (https).

## Optional: email alerts before renewals

1. In the app, open **Sync** and follow the steps to save your subscriptions to this repository.
2. On the same page, click **Create the alerts workflow**. It opens GitHub with the file already filled in; click **Commit changes**.
3. Turn on **Issues** in **Settings → General → Features**.

Every morning GitHub checks your renewals and opens an issue for anything coming up, and GitHub emails you about it.

## Optional: AI answers in the help desk

The help desk always works using its built-in help library. For AI-written answers, open **Help → AI assistant** and add a free Google Gemini key (the app shows you how), or set up the shared proxy described in the full project so no visitor needs a key.

---

This file set is generated from the full project (TypeScript source, tests and build tools) with `npm run build:site`. You only need the full project if you want to change the app's code in a structured way or run the tests.
