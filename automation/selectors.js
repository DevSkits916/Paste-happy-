export const selectors = {
  login: [
    (page) => page.locator('input[name="email"]'),
    (page) => page.getByRole('button', { name: /log in/i }),
  ],
  checkpointText: /checkpoint|confirm your identity|account temporarily locked|security check/i,
  captchaText: /captcha|enter the characters you see/i,
  composerTriggers: [
    (page) => page.getByRole('button', { name: /write something|create (a )?post/i }),
    (page) => page.getByText(/write something/i, { exact: false }),
  ],
  editors: [
    (page) => page.getByRole('dialog').locator('[contenteditable="true"][role="textbox"]:not([aria-label^="Comment"]):not([aria-placeholder^="Comment"])'),
    (page) => page.locator('[contenteditable="true"][role="textbox"]:not([aria-label^="Comment"]):not([aria-placeholder^="Comment"])'),
  ],
  postButtons: [
    (page) => page.getByRole('dialog').getByRole('button', { name: /^(post|publish)$/i }),
    (page) => page.getByRole('button', { name: /^(post|publish)$/i }),
  ],
};

export async function firstVisible(factories, page, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const factory of factories) { const locator = factory(page).first(); if (await locator.isVisible().catch(() => false)) return locator; }
    await page.waitForTimeout(250);
  }
  return null;
}

export async function firstEnabled(factories, page, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const factory of factories) {
      const locator = factory(page).first();
      if (await locator.isVisible().catch(() => false) && await locator.isEnabled().catch(() => false)) return locator;
    }
    await page.waitForTimeout(250);
  }
  return null;
}
