import { firstVisible, selectors } from './selectors.js';

export class AutomationError extends Error { constructor(code, message, options = {}) { super(`${code}: ${message}`); this.code = code; this.security = options.security; } }

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
    onStep('Entering post text...'); await editor.fill(job.postText);
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
