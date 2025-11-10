# FB Group Poster

FB Group Poster is a mobile-first, dark-themed helper that walks you through Facebook group promotions one tap at a time. Import your CSV, copy each ad to the clipboard, and open the matching group in a new tab while tracking progress locally. The app never automates Facebook logins or posting — it only assists manual workflows.

## Quick start

```bash
# install dependencies
pnpm install   # or: npm install

# start a dev server
pnpm dev       # or: npm run dev

# create a production build
pnpm build     # or: npm run build

# preview the production build locally
pnpm preview   # or: npm run preview
```

The project uses [Vite](https://vitejs.dev/) with React, TypeScript, and Tailwind CSS. No server is required; all data stays on the client and is stored in `localStorage`.

## CSV format

Provide a header row with any of the following variants:

| Required field | Accepted headers                      |
| -------------- | ------------------------------------- |
| Group name     | `Group Name`, `Name`                  |
| Group URL      | `Group URL`, `URL`                    |
| Ad text        | `Ad`, `Ad Text`, `Post`               |

Values that contain commas must be quoted. Empty rows are skipped automatically. You can import via file upload or by pasting CSV text directly into the import box. Re-importing a CSV preserves IDs and progress for rows with the same name+URL.

### Sample CSV

```
Group Name,Group URL,Ad
Folsom Community,https://www.facebook.com/groups/355271864659430/,"Hi neighbors — Loki and I are sharing resources: https://gofund.me/9aada7036"
Understand Bipolar Disorder,https://www.facebook.com/groups/1234567890/,"Sending support today. If allowed, here’s ours: https://gofund.me/9aada7036"
```

## Features

- Mobile-first workflow with large tap targets and keyboard shortcuts (`j`, `k`, `c`, `m`).
- Per-row controls: Copy & Open, Open Only, Mark Done, Next/Prev navigation.
- Optional auto-open toggle keeps new tabs in the same gesture as clipboard copy.
- List view with filtering, quick actions, and progress tracking.
- Import/export CSV (with Done + Last Posted At columns) and full JSON backups.
- Graceful clipboard fallback for iOS Safari.
- Toast notifications for imports, copies, and backups.
- Helpful iPhone tips to manage pop-up blockers and paste behavior.
- Optional [Facebook Group Autofill userscript](docs/facebook-group-autofill-userscript.md) to open the group composer and paste your copy automatically after using **Copy & Open**.

## Deployment

### Vercel

1. Run `pnpm build` (or `npm run build`).
2. Deploy the `dist/` directory as a static site.
3. The included `vercel.json` config serves the generated `index.html` for all routes.

### Render (Static Site)

Render configuration is provided in `render.yaml`:

- Build command: `npm ci && npm run build`
- Publish directory: `dist`
- Pull request previews are disabled.

## Troubleshooting

- **Clipboard prompts:** On iOS Safari, you may need to tap the textarea and choose “Paste” manually after using Copy & Open.
- **Pop-up blocks:** Enable pop-ups for this site if Safari prevents new tabs.
- **URL validation:** Only `http://` and `https://` URLs are considered valid for opening in a new tab.
- **State resets:** Use the JSON backup feature to save and restore your progress.

## Privacy & Safety

FB Group Poster never automates form submissions, login flows, or posting on your behalf. All processing happens in your browser, and clipboard usage relies on native browser APIs.
