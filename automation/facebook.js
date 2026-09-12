import { spawn } from 'node:child_process';
import { firstVisible, selectors } from './selectors.js';

export class AutomationError extends Error { constructor(code, message, options = {}) { super(`${code}: ${message}`); this.code = code; this.security = options.security; } }

async function copyToWindowsClipboard(text) {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Set-Clipboard -Value ([Console]::In.ReadToEnd())'], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
    child.once('error', () => resolve(false));
    child.once('close', (code) => resolve(code === 0));
    child.stdin.end(text, 'utf8');
  });
}

async function copyPostText(page, text) {
  if (process.platform === 'win32' && await copyToWindowsClipboard(text)) return true;
  try {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin });
    await page.evaluate((value) => navigator.clipboard.writeText(value), text);
    return true;
  } catch {
    return false;
  }
}

async function pastePostText(page, editor, text) {
  if (!(await copyPostText(page, text))) return false;
  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
  await page.waitForTimeout(150);
  return (await editor.innerText().catch(() => '')).includes(text);
}

export async function postToFacebook(page, job, onStep = () => {}) {
  let submitted = false;
  try {
    onStep('Opening Facebook group...');
    await page.goto(job.groupUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1500);
    const body = await page.locator('body').innerText({ timeout: 10000 });
    if (selectors.checkpointText.test(`${page.url()} ${body}`)) throw new AutomationError('CHECKPOINT_DETECTED', 'Facebook requires a security check.', { security: true });
    if (selectors.captchaText.test(body)) throw new AutomationError('CAPTCHA_DETECTED', 'Facebook displayed a CAPTCHA.', { security: true });
    if (await firstVisible(selectors.login, page, 1000)) throw new AutomationError('LOGIN_REQUIRED', 'Open Browser / Login and sign in first.', { security: true });
    if (/content isn't available|page isn't available/i.test(body)) throw new AutomationError('GROUP_NOT_FOUND', 'The group is unavailable or inaccessible.');
    onStep('Finding composer...');
    const trigger = await firstVisible(selectors.composerTriggers, page); if (!trigger) throw new AutomationError('COMPOSER_NOT_FOUND', 'Could not locate the group composer.');
    await trigger.click();
    const editor = await firstVisible(selectors.editors, page); if (!editor) throw new AutomationError('COMPOSER_NOT_FOUND', 'Composer opened but its text field was not found.');
    onStep('Copying and pasting post text...');
    if (!(await pastePostText(page, editor, job.postText))) {
      onStep('Entering post text...');
      await editor.fill(job.postText);
    }
    const button = await firstVisible(selectors.postButtons, page); if (!button) throw new AutomationError('POST_BUTTON_NOT_FOUND', 'Post button was not found.');
    onStep('Submitting post...'); await button.click(); submitted = true;
    onStep('Verifying post...');
    await page.waitForTimeout(2500);
    const dialogClosed = !(await editor.isVisible().catch(() => false));
    const textVisible = await page.getByText(job.postText.slice(0, 80), { exact: false }).first().isVisible().catch(() => false);
    if (!dialogClosed && !textVisible) throw new AutomationError('POST_UNCERTAIN', 'Submission was clicked but confirmation could not be verified.');
    return { status: 'posted' };
  } catch (error) {
    if (submitted && !(error instanceof AutomationError && error.code === 'POST_UNCERTAIN')) throw new AutomationError('POST_UNCERTAIN', `Browser error after submission: ${error.message}`);
    throw error;
  }
}
