

# Paste Happy
<img width="1352" height="719" alt="Screenshot 2026-09-13 153514" src="https://github.com/user-attachments/assets/3c2bb229-5fb9-498c-a30e-649df709dffd" />
### Paste Happy + Playwright

#### Quick Setup Checklist
- Install **Node.js**
- Install project dependencies with `npm install`
- Install Playwright browsers with `npx playwright install`
- Add your Facebook group URLs to **Paste Happy**
- Add or select the post content you want to use
- Make sure you are logged into Facebook
- Confirm your saved browser session/profile is working

### How to Use

1. Open **Paste Happy** and load or select your posts and Facebook groups.
2. Verify the group URLs are correct.
3. Start the **Playwright automation** from the project folder.
4. Log into Facebook if your saved session is not already active.
5. The automation will work through the group list and handle the configured posting workflow.
6. Leave the browser open until the automation finishes.
7. Check the log/results for completed posts, skipped groups, or errors.

**Tip:** Keeping a persistent Facebook browser profile saves you from logging in every run, because apparently typing the same password repeatedly is still considered modern computing.
### How to Use Paste Happy + Playwright

1. Open **Paste Happy** and load or select the posts and Facebook groups you want to use.
2. Make sure the group list contains the correct Facebook group URLs. (SEE CHROME EXTENSION BELLOW FOR MAKING YOUR OWN CSV WITH GROUPS)
3. Start the **Playwright automation** from the project folder.
4. Log into Facebook if your saved browser session is not already active.
5. The automation will open each group, paste the selected post, and complete the posting workflow automatically.
6. Leave the browser open until the automation finishes.
7. Check the log or results screen for completed posts, skipped groups, or errors.

**Tip:** Keep your Facebook login session saved so you do not have to sign in every time..

Chrome extension for scraping Facebook group names and URLs and exporting them to a CSV file.
https://github.com/DevSkits916/Playwright-PasteHappy/blob/main/Chrome%20Extension%20Facebook%20Group%20Scaper.zip
**Installation:**
1. Download the ZIP file containing the extension.
2. Extract the ZIP file.
3. Open Chrome and go to **Extensions**.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the extracted extension folder.

Once installed, the extension can collect Facebook group names and URLs and export the results as a CSV file.
<img width="931" height="593" alt="Screenshot 2026-09-13 190347" src="https://github.com/user-attachments/assets/86097bee-87be-459b-8516-068709c39bd6" />
## Architecture

- **Frontend:** the existing React/Vite/Tailwind application; its manual queue remains in browser `localStorage`.
- **Backend:** Express API and an atomic JSON queue at `data/queue.json`.
- **Worker:** one Playwright worker using a persistent Chromium profile in `.browser-profile`.
- **Automation:** semantic role/text locators and centralized fallbacks in `automation/selectors.js`.

GitHub Pages and Vercel static hosting cannot run the backend or persistent browser. The full automatic workflow is intended to run locally on the Windows computer where Chromium can be displayed. A hosted headless service is not a substitute for the initial interactive Facebook login and generally cannot provide a reliable persistent desktop session.

## Windows installation (clean checkout)

Install [Git for Windows](https://git-scm.com/download/win) and the current Node.js LTS release, then open **PowerShell**:

```powershell
git clone https://github.com/DevSkits916/Paste-happy-.git
Set-Location Paste-happy-
npm install
npx playwright install chromium
npm run build
npm start
```

Open <http://localhost:4173>. No compiled application or binary is committed; npm installs every JavaScript dependency from `package-lock.json`, and the Playwright command downloads the matching Chromium build. On Windows, no Linux `--with-deps` flag is needed.

For development (Express and Vite together):

```powershell
npm run dev
```

Vite opens on <http://localhost:5173> and proxies `/api` to Express on port 4173. `npm start` serves the already-built `dist` UI and API from one process.

## Facebook login and browser profile

1. Keep the server running and select **Open Browser / Login** in Paste Happy.
2. A Playwright-managed Chromium window opens at Facebook. Log in manually and complete any security prompts yourself.
3. Leave that window available while running the queue. Later runs reuse `.browser-profile`.
4. Never copy, upload, or commit `.browser-profile`; it contains sensitive session data. Paste Happy never returns cookies through its API.

Headless mode cannot perform the first interactive login. The application deliberately does not automate credentials, CAPTCHA, checkpoints, or two-factor authentication.

## Queue usage

1. Import the same CSV used by the manual workspace and review/edit its rows.
2. Select **Queue for Automatic Posting**. Exact URL + post-text duplicates already in the active queue are ignored.
3. Configure delay, cooldown, maximum jobs, stop-on-failure, and stop-on-checkpoint. Defaults are deliberately conservative.
4. Open/login to the browser, then select **Start**. You can **Pause**, **Resume**, or **Stop** without losing persisted jobs.
5. The worker opens each group, detects login/security blocks, opens the composer, fills the post, submits, and verifies the composer closed or the text appeared.
6. Review `failed`, `blocked`, and especially `uncertain` jobs. Retry is always manual for these states; uncertain jobs are never automatically selected again.

The dashboard shows total, pending, processing, posted, failed, blocked, and uncertain counts, the current step, attempts, last error, and per-job Retry/Skip/Open Group actions. A server restart safely converts a job left in `processing` to `failed` rather than silently claiming success.

## Manual fallback

The original workflow remains available on desktop and phones:

1. Import a CSV.
2. Select a row and use **Copy & Open**.
3. Paste and publish in Facebook yourself.
4. Return to Paste Happy and select **Mark Posted** (or Skip). Local filters, editing, shuffle, undo, progress, and the sample/download tools remain available.

## CSV format

The importer handles quoted commas/newlines, BOMs, and these case-insensitive headings:

| Value | Accepted examples |
| --- | --- |
| Group | `Group Name`, `group_name`, `group`, `name` |
| URL | `Group URL`, `group_url`, `url`, `link` |
| Post | `Post Text`, `post_text`, `post`, `ad`, `ad text`, `message` |

```csv
Group Name,Group URL,Post
Folsom Community,https://www.facebook.com/groups/355271864659430/,"Hello neighbors"
```

## Configuration

Copy `.env.example` values into your shell or system environment before starting. Node does not implicitly load `.env`; PowerShell examples are `$env:PORT="4173"` and `$env:PLAYWRIGHT_HEADLESS="false"`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4173` | Express port |
| `QUEUE_DATA_PATH` | `data/queue.json` | Persistent queue file |
| `BROWSER_PROFILE_PATH` | `.browser-profile` | Private Chromium profile |
| `PLAYWRIGHT_HEADLESS` | `false` | Use a visible browser; recommended for Facebook |
| `PLAYWRIGHT_EXECUTABLE_PATH` | unset | Optional path to a Chromium/Chrome executable; Windows automatically falls back to installed Google Chrome if Playwright's bundled browser is unavailable |
| `DEFAULT_JOB_DELAY` | `15000` | Milliseconds between jobs |
| `MAX_JOBS_PER_RUN` | `10` | Conservative run cap |

## API

`GET /api/queue`, `GET /api/queue/:id`, `POST /api/queue/import`, `POST /api/queue/start`, `/pause`, `/resume`, `/stop`, `POST /api/queue/:id/retry`, `POST /api/queue/:id/skip`, `GET /api/status`, and `POST /api/browser/login` are available. Queue state belongs to the backend, so a UI refresh does not reset it.

## Deployment

- **Recommended/full functionality:** run locally on Windows using the commands above. Back up `data/queue.json` privately if needed.
- **Render:** `render.yaml` now describes the Node web service and persistent queue disk. Set `QUEUE_DATA_PATH=/opt/render/project/src/data/queue.json` and `PLAYWRIGHT_HEADLESS=true`. However, Render cannot provide the normal visible desktop needed for manual login, and Facebook may challenge datacenter browsers. Treat this as API/UI deployment, not a guaranteed automation environment.
- **Static hosting:** `npm run build` still produces a single-file-friendly `dist` UI, and the manual workflow works when statically hosted. Automatic controls show an offline notice because GitHub Pages/Vercel cannot execute Express or Playwright.

## Troubleshooting

- **Executable missing:** run `npx playwright install chromium` from the repository.
- **Automatic backend offline:** use `npm start` after `npm run build`, not a static file server.
- **Login required/checkpoint/CAPTCHA:** pause, use **Open Browser / Login**, resolve the Facebook prompt manually, then manually retry the affected item.
- **Composer/button not found:** Facebook likely changed its UI or group permissions. Use Copy & Open and update centralized fallbacks in `automation/selectors.js`.
- **Uncertain:** inspect the group before retrying. The click may have succeeded even though verification did not.
- **Profile locked:** close other Playwright Chromium instances using this profile, then restart Paste Happy.
- **Windows firewall prompt:** allow Node.js for private networks if you want to open the UI from another device; do not expose the server publicly without adding authentication.

## Security

The local server has no user authentication and is intended for a trusted computer/network. Do not expose it directly to the internet. Queue text is stored unencrypted in JSON, while Facebook cookies remain in the ignored browser-profile directory. Logs contain job IDs and steps, never credentials or cookies. Keep dependencies updated and stop the server/browser when finished.

## Validation

```powershell
npm test
npm run build
npm start
```

Tests cover CSV normalization, queue creation and transitions, persistence and restart recovery, duplicate protection, retry/uncertain behavior, failure continuation, and API endpoints.
