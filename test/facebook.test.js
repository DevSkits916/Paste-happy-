import test from 'node:test';
import assert from 'node:assert/strict';
import { postToFacebook } from '../automation/facebook.js';

function locator(visible, text = '') { return { first() { return this; }, async isVisible() { return visible; }, async isEnabled() { return true; }, async innerText() { return text; }, async click() {}, async focus() {}, async fill() {}, locator() { return this; } }; }
test('login-required state becomes a structured security error without submitting', async () => {
  const page = {
    async goto() {}, async waitForTimeout() {}, url: () => 'https://www.facebook.com/login',
    locator(selector) { if (selector === 'body') return locator(true, 'Log in to Facebook'); return locator(selector.includes('email')); },
    getByRole(role, options = {}) { return locator(role === 'button' && /log in/i.test(String(options.name))); },
    getByText() { return locator(false); },
  };
  await assert.rejects(postToFacebook(page, { groupUrl: 'https://www.facebook.com/groups/1', postText: 'Hi' }), (error) => error.code === 'LOGIN_REQUIRED' && error.security === true);
});

test('simulated composer submission and verification reports posted', async () => {
  let filled = ''; let clicked = false; let clipboard = ''; let pasted = '';
  const editor = { ...locator(true), async fill(value) { filled = value; }, async innerText() { return pasted; }, async isVisible() { return !clicked; }, async focus() {} };
  const page = {
    async goto() {}, async waitForTimeout() {}, url: () => 'https://www.facebook.com/groups/1',
    context() { return { async grantPermissions() {} }; },
    async evaluate(_write, value) { clipboard = value; },
    keyboard: { async press(key) { if (key === 'Control+V') pasted = clipboard; } },
    locator(selector) { if (selector === 'body') return locator(true, 'Group feed'); if (selector.includes('contenteditable')) return editor; return locator(false); },
    getByRole(role, options = {}) {
      if (role === 'dialog') return { locator: () => editor, getByRole: () => ({ ...locator(true), async click() { clicked = true; } }) };
      if (role === 'button' && /write something/i.test(String(options.name))) return locator(true);
      return locator(false);
    },
    getByText() { return locator(false); },
  };
  assert.deepEqual(await postToFacebook(page, { groupUrl: page.url(), postText: 'Hello queue' }), { status: 'posted' });
  assert.equal(filled, 'Hello queue'); assert.equal(clicked, true);
});
