# Facebook Autopost Userscript

This optional userscript is designed for Paste Happy's **Copy & Open** button. It opens Facebook's composer, pastes the text that was copied to your clipboard, and clicks **Post** automatically.

> ⚠️ The script posts immediately once the Facebook composer finishes loading. Install and enable it only if you are comfortable with one-click posting.

## What it does

- Detects the `pastePost` (or legacy `ph=1`) query/hash markers that the app adds when you use Copy & Open.
- Reads your clipboard for the post copy (with a fallback to the encoded payload in the URL).
- Opens the Facebook composer and pastes the content.
- Clicks the **Post** button automatically once the composer is ready.
- Cleans up the activation parameters from the URL after loading.

## Installation

1. Install a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Create a new userscript in the manager.
3. Copy the contents of [`userscripts/facebook-autopost.user.js`](../userscripts/facebook-autopost.user.js) into the editor and save.
4. Ensure the userscript is enabled when you want auto-posting.

Revisit this repository periodically to copy updated script versions.

## Usage

1. In Paste Happy, choose a row and click **Copy & Open**.
2. Allow the Facebook tab to finish loading. The script will paste the clipboard contents and click **Post** automatically.
3. Watch for Facebook's confirmation (e.g., toast/snackbar) to verify the post published.

If clipboard access is blocked, the script falls back to the encoded payload embedded in the URL. If both fail, it will show a "Paste Happy" banner indicating that auto-posting was not possible so you can post manually.

## Safety tips

- Temporarily disable the userscript when you want manual control over posting.
- Keep an eye on the status banner: it will show when posting is underway or if manual intervention is needed.
- Facebook frequently changes its UI. If the composer or Post button cannot be found, try refreshing or updating the script.
