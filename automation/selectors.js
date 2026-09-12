export const selectors = {
  login: [
    (page) => page.locator('input[name="email"]'),
    (page) => page.getByRole('button', { name: /log in/i }),
  ],
  checkpointText: /checkpoint|confirm your identity|account temporarily locked|security check/i,
  captchaText: /captcha|enter the characters you see/i,
  composerTriggers: [
    (page) => page.getByRole('button', { name: /write something|create (a )?post|what['’]s on your mind/i }),
    (page) => page.getByText(/write something|what['’]s on your mind/i, { exact: false }),
  ],
  editors: [
    (page) => page.getByRole('dialog').locator('[contenteditable="true"]:not([aria-label^="Comment" i]):not([aria-placeholder^="Comment" i])'),
  ],
  postButtons: [
    (page) => page.getByRole('button', { name: /^(post|publish)$/i }),
  ],
};

export async function firstVisible(factories, page, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const factory of factories) {
      const matches = factory(page);
      for (let index = 0; index < await matches.count(); index += 1) {
        const locator = matches.nth(index);
        if (await locator.isVisible().catch(() => false)) return locator;
      }
    }
    await page.waitForTimeout(250);
  }
  return null;
}

export async function firstEnabled(factories, page, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const factory of factories) {
      const matches = factory(page);
      for (let index = 0; index < await matches.count(); index += 1) {
        const locator = matches.nth(index);
        if (await locator.isVisible().catch(() => false) && await locator.isEnabled().catch(() => false)) return locator;
      }
    }
    await page.waitForTimeout(250);
  }
  return null;
}
