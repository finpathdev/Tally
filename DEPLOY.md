# Publish Tally on GitHub Pages

Your site should end up at `https://<your-username>.github.io/<repo>/` (for example `https://finpathdev.github.io/Tally/`).

## Why a site shows only a title (or "Tally didn't start")

Tally is a Vite app. GitHub has to **build** it before it can be served. That build is the workflow in `.github/workflows/pages.yml`, and GitHub only runs workflows that sit at the **top level** of the repository.

If the project is inside a subfolder (for example `Tally/package.json`), or Pages is set to *Deploy from a branch*, GitHub publishes the raw files instead. You then see your README's title, a blank page, or a "Tally didn't start" message.

The repository must look like this at its top level:

```
.github/          ← must be here, not in a subfolder
docs/
e2e/
examples/
helpdesk-worker/
public/
scripts/
src/
tests/
index.html
package.json
README.md
...
```

## Option A: GitHub website only (no tools to install)

1. **Clear the repository.** On github.com, open your repo. Open the `Tally` folder, click **⋯ → Delete directory** and commit. Delete the top-level `README.md` too (the project brings its own).
2. **Unzip `tally.zip`** on your computer. Open the unzipped folder so you can see `package.json`, `src`, `.github` and the other files.
   - Windows: `.github` is visible by default. If it isn't, in File Explorer choose **View → Show → Hidden items**.
   - Mac: press **Cmd + Shift + .** in Finder to show files that start with a dot.
3. In the repo on github.com, click **Add file → Upload files**.
4. Select **everything inside** the unzipped folder (Ctrl+A / Cmd+A), including `.github`, and drag it onto the upload page. Don't drag the folder itself; that recreates the subfolder problem.
5. Click **Commit changes**.
6. Check that `.github` now appears at the top of the file list. If it doesn't, your browser skipped it. Use Option B, or create the three workflow files by hand with **Add file → Create new file**, typing `.github/workflows/pages.yml` as the name and pasting the contents.

## Option B: Git (most reliable)

```bash
git clone https://github.com/<you>/<repo>.git
cd <repo>
git rm -r --quiet .            # empty the repo (history is kept)
# unzip tally.zip into this folder so package.json sits right here, then:
git add -A
git commit -m "Publish Tally at the repository root"
git push
```

## Then turn on Pages (both options)

1. Open the repo's **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**. This is the step that's usually missed.
3. Open the **Actions** tab. If asked, click **I understand my workflows, go ahead and enable them**.
4. Click **Deploy app to GitHub Pages → Run workflow** (or just push a commit).
5. Wait for the green check (about a minute), then open your site. If you still see the old page, reload once; browsers cache GitHub Pages for a few minutes.

## Optional extras

| Want | Do this |
| :-- | :-- |
| Renewal alerts by email | Settings → General → Features → turn on **Issues**; then use **Sync** in the app |
| Encrypted sync | Add a secret `TALLY_PASSPHRASE` (Settings → Secrets and variables → Actions) |
| AI help desk for every visitor | Deploy `helpdesk-worker/` (see its README), then add a variable `HELPDESK_URL` |
| A different timezone for alerts | Add a variable `TZ`, e.g. `Europe/London` |

## Checking a deploy

- **Actions tab → Deploy app to GitHub Pages**: a red ✗ means the build failed. Open it to read the error.
- **Actions tab → CI**: runs the unit tests, browser tests, accessibility scans and Lighthouse on every push.
