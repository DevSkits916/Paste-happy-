# PasteHappy + Playwright

PasteHappy is a mobile-friendly Facebook group posting assistant with two separate workspaces:

- **Manual window:** import a CSV, review or edit post text, copy it, open a group, and track your posting progress.
- **Playwright automation window:** queue imported rows, configure posting delays, run automated posting, and monitor results.

Automation uses the normal Facebook website through a persistent Playwright-managed Chromium browser—not the Facebook Graph API.

> Only post content you have permission to publish. Respect group rules and Facebook’s terms. Automation can fail when Facebook changes its interface or requires security verification. Always review an `uncertain` result before retrying to avoid duplicate posts.

## Features

### Manual workspace

- CSV import and sample CSV download.
- Group names, URLs, and editable post text.
- Copy & Open, Mark Posted, and Skip actions.
- Status filters and group/URL search.
- Shuffle pending rows.
- Temporary undo for status changes.
- Browser-local session storage.
- Responsive desktop tables and mobile cards.

### Playwright workspace

- Dedicated automation window.
- Import saved manual CSV rows into a persistent posting queue.
- Visible or headless browser operation.
- Persistent Facebook login profile.
- Delay, cooldown, and maximum-job settings.
- Stop-on-failure and stop-on-security-checkpoint options.
- Start, Pause, Resume, and Stop controls.
- Skip Current & Continue.
- Queue clearing and per-job Retry, Skip, and Open Group actions.
- Current job, current step, attempts, and error reporting.
- Duplicate protection and interrupted-job recovery.

## Requirements

- Git.
- Node.js and npm.
- A Chromium browser installed through Playwright.
- A Facebook account with permission to post in the selected groups.
- A browser that permits PasteHappy to open its automation window.

Windows is the primary local environment. Linux and WSL can run the backend, but interactive login requires a working graphical browser environment.

## Installation on Windows

Open PowerShell:

```powershell
Set-Location ([Environment]::GetFolderPath("MyDocuments"))
git clone https://github.com/DevSkits916/Playwright-PasteHappy.git PasteHappy
Set-Location PasteHappy
npm ci
npx playwright install chromium
npm run build
npm start
```

Open [http://localhost:4173](http://localhost:4173).

Keep the server terminal running while using the app. Press `Ctrl+C` in that terminal to stop it.

### Start an existing installation

```powershell
Set-Location "$env:USERPROFILE\Documents\PasteHappy"
npm start
```

`npm start` serves the already-built frontend and the automation API. Rebuild after changing frontend files:

```powershell
npm run build
npm start
```

### Update an existing installation

With a clean working tree:

```powershell
git switch main
git pull --ff-only
npm ci
npx playwright install chromium
npm run build
npm start
```

Preserve any local changes before updating. Do not discard them merely to make an update succeed.

## Installation on Linux or WSL

```bash
git clone https://github.com/DevSkits916/Playwright-PasteHappy.git PasteHappy
cd PasteHappy
npm ci
npx playwright install --with-deps chromium
npm run build
npm start
```

Open [http://localhost:4173](http://localhost:4173).

Visible-browser login requires a desktop session, WSLg, or another correctly configured graphical environment.

## Using Manual Mode

1. Open the main PasteHappy window.
2. Select **Import CSV**.
3. Review the imported groups and post text.
4. Use **Edit text** to change a row’s message.
5. Select a row and choose **Copy & Open**.
6. Paste and publish the message in Facebook yourself.
7. Return to PasteHappy and choose **Mark Posted** or **Skip**.

Use the filters to show pending, posted, skipped, or failed rows. Search matches group names and URLs. **Shuffle pending** changes the order of pending rows.

The manual queue is stored in the current browser’s `localStorage`. Clearing site data or using a different browser, profile, or origin may result in a different manual session.

## Opening the Automation Window

From the manual workspace, select **Open Playwright Automation**.

PasteHappy requests a separate browser window containing the automation dashboard. Depending on browser settings, it may open as a tab instead.

If the popup is blocked, allow popups for the PasteHappy site.

The automation window reads the manual session saved under the same browser origin when it loads. Import and edit your CSV before opening it. If you change manual rows afterward, reload the automation window before selecting **Queue Manual CSV**.

The automation dashboard window and the Playwright-controlled Facebook browser are separate:

- The dashboard displays controls and queue status.
- The Playwright browser performs Facebook navigation and posting.
- Headless mode hides the Playwright browser, not the dashboard.

Closing the dashboard window does not automatically stop the backend worker. Use **Stop** before closing it if you want to stop the run.

## Facebook Login

Use visible mode for the initial login:

1. Start the PasteHappy server.
2. Import and review your CSV in the manual window.
3. Open the Playwright automation window.
4. Leave **Run browser headless** unchecked.
5. Select **Open Visible Browser / Login**.
6. Log in to Facebook manually.
7. Complete any two-factor authentication or security prompts yourself.

The login session is stored in `.browser-profile` and reused by later runs.

PasteHappy does not automate passwords, CAPTCHA solving, two-factor authentication, or security checkpoints.

Never commit, upload, or share `.browser-profile`. It contains sensitive browser session data.

## Running the Automation Queue

1. Import and review the CSV in the manual window.
2. Open the automation window.
3. Select **Queue Manual CSV**.
4. Configure the run settings.
5. Log in through the visible browser if needed.
6. Select **Start**.
7. Monitor the current group, step, status, and errors.
8. Review failed, blocked, and uncertain results before retrying.

The automation queue is stored separately from manual progress. An automated result does not automatically update the corresponding manual row’s status.

### Run settings

| Setting | Default | Purpose |
| --- | --- | --- |
| Delay between jobs | 15 seconds | Wait between processed jobs |
| Cooldown | 0 seconds | Additional pacing setting; the larger of delay and cooldown is used |
| Maximum jobs | 10 | Limit jobs processed in a run |
| Stop on failure | Off | Stop after a posting error |
| Stop on security checkpoint | On | Stop when a security-related block is detected |
| Run browser headless | Off | Run the Playwright browser without a visible window |

Use conservative delays and small batches.

### Controls

- **Start:** begin processing pending jobs using the selected settings.
- **Pause:** pause before processing another job; it does not necessarily interrupt a job already underway.
- **Resume:** continue a paused run.
- **Stop:** request that the run stop; a job already underway may finish.
- **Skip Current & Continue:** mark the current job skipped and close its browser work so the worker can continue.
- **Clear Automation Queue:** remove all automation jobs and close the Playwright browser.

Clearing the automation queue does not clear the manual queue.

## Headless Mode

Headless mode runs the Playwright-controlled browser without displaying its window.

### Enable headless operation

1. Complete the initial Facebook login in visible mode.
2. Finish or stop the current run.
3. Close the visible Playwright browser.
4. Enable **Run browser headless** in the dashboard.
5. Select **Start**.

Changing browser mode is blocked while a Playwright browser context is open.

The dashboard disables interactive login while headless mode is selected. If Facebook requires another login or checkpoint, stop the run, close the browser context, disable headless mode, and resolve the prompt manually.

If a headless browser remains open and prevents switching modes, stop and restart the server to close its browser context. Do not clear the queue just to switch modes unless you intend to remove its jobs.

Headless mode does not bypass Facebook security checks and is not guaranteed to work with every account or hosting environment.

## Job Statuses

| Status | Meaning |
| --- | --- |
| `pending` | Waiting to be processed |
| `processing` | Currently claimed by the worker |
| `posted` | Automation detected a successful posting result |
| `failed` | A browser or posting error occurred |
| `blocked` | Login or a security-related condition prevented completion |
| `uncertain` | Submission may have happened, but success could not be confirmed |
| `skipped` | The job was skipped |

Review the actual Facebook group before retrying an `uncertain` job. The post may already exist.

Failed, blocked, uncertain, and skipped jobs require an explicit retry action. A server restart converts an interrupted `processing` job to `failed` rather than silently treating it as successful.

## CSV Format

PasteHappy supports quoted commas, quoted newlines, UTF-8 BOMs, and case-insensitive column headings.

| Field | Accepted headings |
| --- | --- |
| Group name | `Group Name`, `group_name`, `group`, `name` |
| Group URL | `Group URL`, `group_url`, `url`, `link` |
| Post text | `Post Text`, `post_text`, `post`, `ad`, `ad text`, `message` |

Example:

```csv
Group Name,Group URL,Post
Example Community,https://www.facebook.com/groups/123456789/,"Hello neighbors!"
Example Local Group,https://www.facebook.com/groups/987654321/,"First line.
Second line with a comma, included in the message."
```

Use **Sample CSV** in the manual window to download an example.

Review all group URLs and messages before starting automation.

## Optional Group-Scraping Extension

The repository includes `Chrome Extension Facebook Group Scaper.zip`.

To load the included extension in Chrome:

1. Download or locate the ZIP.
2. Extract it into a folder.
3. Open Chrome’s Extensions page.
4. Enable Developer mode.
5. Select **Load unpacked**.
6. Select the extracted folder containing `manifest.json`.

Review the extension’s code and requested permissions before installing it. Check its exported CSV and add or review post text before importing it into PasteHappy.

The extension is optional; PasteHappy also accepts CSV files created manually or by other tools.

## Development

Run Express and Vite together:

```powershell
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

Vite proxies `/api` requests to Express on port 4173.

Available commands:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run backend and frontend development servers |
| `npm run dev:web` | Run only Vite; backend must be started separately for automation |
| `npm run build` | Type-check and build the production frontend |
| `npm start` | Serve the production frontend and backend |
| `npm test` | Run automated tests |
| `npm run preview` | Preview the frontend build; does not start the automation backend |

## Configuration

The backend reads environment variables.

`.env.example` documents the available values, but the server does not automatically load a `.env` file. Set variables in your shell before starting it.

### PowerShell example

```powershell
$env:PORT = "4173"
$env:DEFAULT_JOB_DELAY = "15000"
$env:MAX_JOBS_PER_RUN = "10"
$env:PLAYWRIGHT_HEADLESS = "false"
npm start
```

### Linux or WSL example

```bash
PORT=4173 \
DEFAULT_JOB_DELAY=15000 \
MAX_JOBS_PER_RUN=10 \
PLAYWRIGHT_HEADLESS=false \
npm start
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4173` | Backend HTTP port |
| `QUEUE_DATA_PATH` | `data/queue.json` | Persistent automation queue file |
| `BROWSER_PROFILE_PATH` | `.browser-profile` | Private persistent Chromium profile |
| `PLAYWRIGHT_HEADLESS` | `false` | Initial backend browser mode |
| `PLAYWRIGHT_EXECUTABLE_PATH` | Unset | Optional Chromium/Chrome executable path |
| `DEFAULT_JOB_DELAY` | `15000` | Default delay in milliseconds for API-started runs |
| `MAX_JOBS_PER_RUN` | `10` | Default job limit for API-started runs |

The dashboard sends its selected run settings when you press **Start**, including headless mode. Its controls have their own initial defaults; environment defaults do not automatically populate those controls.

If Playwright’s bundled browser is unavailable on Windows, the application checks common installed Google Chrome locations as a fallback. Installing the matching Playwright Chromium build remains the recommended setup.

If you change `PORT` during development, also update the `/api` proxy target in `vite.config.ts`.

## Project Structure

```text
automation/
  browser.js          Persistent browser management
  clipboard.js        System clipboard helper
  facebook.js         Facebook posting workflow
  queue-worker.js     Queue execution and run controls
  selectors.js        Centralized Facebook selectors

server/
  app.js              Express routes and static frontend serving
  config.js           Environment configuration
  csv.js              Backend CSV parser
  index.js            Server startup and shutdown
  queue-store.js      Persistent queue storage

src/
  App.tsx             Manual and automation window views
  components/         Dashboard and shared UI components
  lib/                CSV, storage, clipboard, and other helpers

public/               Static assets
test/                 Automated tests
data/                 Private runtime queue data
.browser-profile/     Private runtime browser profile
dist/                 Generated frontend build
```

Runtime data, browser profiles, dependencies, `.env`, and generated build output are excluded from Git.

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/status` | Worker and browser status |
| GET | `/api/queue` | List jobs |
| GET | `/api/queue/:id` | Get one job |
| POST | `/api/queue/import` | Import CSV text or normalized rows |
| POST | `/api/queue/start` | Start a run with settings |
| POST | `/api/queue/pause` | Pause the worker |
| POST | `/api/queue/resume` | Resume the worker |
| POST | `/api/queue/stop` | Request a stop |
| POST | `/api/queue/clear` | Clear the automation queue |
| POST | `/api/queue/current/skip` | Skip the current job |
| POST | `/api/queue/:id/retry` | Retry a job |
| POST | `/api/queue/:id/skip` | Skip a job |
| POST | `/api/browser/login` | Open the visible Facebook login browser |

Example start body:

```json
{
  "delayMs": 15000,
  "cooldownMs": 0,
  "maxJobs": 10,
  "stopOnFailure": false,
  "stopOnCheckpoint": true,
  "headless": false
}
```

Queue data belongs to the backend. Reloading or closing the dashboard does not reset it.

## Hosting and Deployment

### Local Windows use

Local execution is the recommended option for the complete workflow. It provides an interactive browser for Facebook login and a persistent browser profile for later runs.

### Static hosting

The built manual frontend can be hosted on GitHub Pages or another static host.

Static hosting cannot run Express, the queue worker, or a persistent Playwright browser. The automation dashboard shows a backend-offline notice when no compatible backend is available.

### Render

The included `render.yaml` defines a Node service with a persistent disk for queue data.

The current build command installs dependencies and builds the frontend. It does not install Chromium or its system dependencies, so additional deployment setup is required for browser automation.

Hosted headless environments generally cannot provide the normal visible browser needed for initial login, and Facebook may challenge datacenter sessions. The included configuration is not a guarantee of working hosted Facebook automation.

The queue disk configuration does not automatically persist `.browser-profile`. Do not expose this service publicly without implementing authentication and appropriate access controls.

## Troubleshooting

### Local connection refused

The server is not running, failed to start, or is using another port.

From the project folder:

```powershell
npm run build
npm start
```

Keep the terminal open and visit [http://localhost:4173](http://localhost:4173). Check startup output for errors.

### Automation backend offline

Use `npm start` for the built application, or `npm run dev` for development.

A static server, `npm run dev:web`, or `npm run preview` alone does not start the automation backend.

### Automation window does not open

Allow popups for the PasteHappy origin, then select **Open Playwright Automation** again.

### Automation window has old CSV rows

Reload it after importing or editing rows in the manual window. Then select **Queue Manual CSV**.

### Browser executable missing

```powershell
npx playwright install chromium
```

On Linux or WSL:

```bash
npx playwright install --with-deps chromium
```

### Login, CAPTCHA, or checkpoint required

Stop the run, switch to visible mode, and resolve the prompt manually. Review the affected job before retrying.

### Headless option is disabled

A Playwright browser context is open. Finish or stop the run and close that browser before switching modes. Restart the server if a headless context remains open.

### Composer or Post button not found

Facebook’s interface or the group’s posting permissions may have changed. Use manual mode and inspect the centralized selectors in `automation/selectors.js`.

### Uncertain posting result

Check the group manually before retrying. The submission may have succeeded even though verification failed.

### Browser profile locked

Close other browser instances using the PasteHappy profile, then restart the server. Do not run multiple PasteHappy servers against the same profile.

### Copy failed

Use a supported browser on localhost or HTTPS. If clipboard access fails, copy the message manually before posting.

## Security and Privacy

- The backend has no built-in user authentication.
- Use it only on a trusted computer or network.
- Do not expose its port directly to the public internet.
- Automation queue messages are stored unencrypted in JSON.
- Facebook session data is stored in the private browser profile.
- Never commit or share browser profiles, credentials, or sensitive queue files.
- Keep secrets out of frontend source code.
- Stop the server and managed browser when finished.
- Review dependency audit reports before deploying.

The standard worker logs job IDs and workflow steps rather than credentials or cookies. Treat runtime logs and stored queue data as potentially sensitive.

## Validation

```powershell
npm test
npm run build
```

Tests cover CSV parsing, posting workflow checks, queue transitions, persistence, restart recovery, duplicate protection, failure continuation, uncertain results, current-job skipping, and API behavior.

A successful test run does not guarantee Facebook automation will continue working against future interface changes. Validate cautiously with permitted content and a small batch.

## Credits

Created by [DevSkits916](https://github.com/DevSkits916).

Repository: [Playwright-PasteHappy](https://github.com/DevSkits916/Playwright-PasteHappy).
