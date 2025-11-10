# Facebook Group Autofill Userscript

The optional Facebook Group Autofill userscript streamlines Paste Happy's workflow by opening the Facebook group composer and filling in your copied post automatically. It only runs when you arrive on a Facebook group page using the app's **Copy & Open** button, so you always stay in control of when automation happens.

## What it does

- Detects the special `ph=1` flag appended by the Copy & Open action.
- Opens the "Create post" dialog (or focuses the inline composer) on the Facebook group page.
- Pastes the encoded post copy directly into Facebook's editor.
- Shows a status banner confirming when the post is ready so you just have to review and click **Post**.

The script never submits the post or navigates away for you.

## Installation

1. Install a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/) in your browser.
2. Create a new userscript in the manager.
3. Copy the contents of [`userscripts/facebook-group-autofill.user.js`](../userscripts/facebook-group-autofill.user.js) into the editor and save.
4. Ensure the userscript is enabled.

Future updates to the repository may change the script, so check back periodically and paste in the latest version if needed.

## Usage

1. In Paste Happy, choose a row and click **Copy & Open**.
2. Allow the new Facebook tab to load. Within a moment you should see a "Paste Happy" banner indicating the script is preparing your post.
3. Once the banner confirms the text is ready, review the post contents. Make any edits you like and click **Post** when you're satisfied.

If Facebook blocks pop-ups or clipboard access, follow the prompts in Paste Happy first. The userscript relies on the page being able to open and focus the composer normally.

## Troubleshooting tips

- **Composer didn't open:** Facebook sometimes rearranges the page structure. Refresh and try again; if it persists, check for updates to the userscript.
- **Text didn't paste:** Click into the editor and press `Ctrl+V`/`Cmd+V` manually. The banner will already have copied the text for you.
- **Different Facebook layout:** The script tries multiple selectors, but Facebook experiments with new UIs. Feel free to tweak the query logic locally if you encounter a new layout.

You can disable the userscript temporarily from your manager whenever you prefer to handle posting manually.
