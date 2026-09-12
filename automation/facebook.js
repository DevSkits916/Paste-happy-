import { firstEnabled, firstVisible, selectors } from './selectors.js';

export class AutomationError extends Error { constructor(code, message, options = {}) { super(`${code}: ${message}`); this.code = code; this.security = options.security; } }

const normalizedText = (text) => text.replace(/\s+/gu, ' ').trim();

export async function enterPostText(page, editor, text) {
  // Replacing the contents is idempotent, unlike retrying a clipboard paste.
  await editor.fill(text, { timeout: 10000 });
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (normalizedText(await editor.innerText({ timeout: 1000 })) === normalizedText(text)) return;
    await page.waitForTimeout(250);
  }
  throw new AutomationError('POST_TEXT_MISMATCH', 'The composer text did not match the queued post. Submission was stopped.');
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
    onStep('Entering post text...');
    await enterPostText(page, editor, job.postText);
    const dialog = editor.locator('xpath=ancestor::*[@role="dialog"][1]');
    const button = await firstEnabled(selectors.postButtons, dialog); if (!button) throw new AutomationError('POST_BUTTON_NOT_FOUND', 'Post button was not enabled after entering the text.');
    onStep('Submitting post...'); await button.click(); submitted = true;
    onStep('Verifying post...');
    const [dialogVisible, textVisible] = await Promise.all([
      editor.isVisible().catch(() => false),
      page.getByText(job.postText.slice(0, 80), { exact: false }).first().isVisible().catch(() => false),
    ]);
    const dialogClosed = !dialogVisible;
    if (!dialogClosed && !textVisible) throw new AutomationError('POST_UNCERTAIN', 'Submission was clicked but confirmation could not be verified.');
    return { status: 'posted' };
  } catch (error) {
    if (submitted && !(error instanceof AutomationError && error.code === 'POST_UNCERTAIN')) throw new AutomationError('POST_UNCERTAIN', `Browser error after submission: ${error.message}`);
    throw error;
  }
}
