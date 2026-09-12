import test from 'node:test';
import assert from 'node:assert/strict';
import { enterPostText, postToFacebook } from '../automation/facebook.js';
import { firstVisible, selectors } from '../automation/selectors.js';

function locator(visible, text = '') { return { async count() { return 1; }, nth() { return this; }, first() { return this; }, async isVisible() { return visible; }, async isEnabled() { return true; }, async innerText() { return text; }, async click() {}, async focus() {}, async fill() {}, locator() { return this; } }; }
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
  const dialog = { locator: () => editor, getByRole: () => ({ ...locator(true), async click() { clicked = true; } }) };
  const editor = { ...locator(true), locator: () => dialog, async fill(value) { filled = value; }, async innerText() { return filled; }, async isVisible() { return !clicked; }, async focus() {} };
  const page = {
    async goto() {}, async waitForTimeout() {}, url: () => 'https://www.facebook.com/groups/1',
    context() { return { async grantPermissions() {} }; },
    async evaluate(_write, value) { clipboard = value; },
    keyboard: { async press(key) { if (key === 'Control+V') pasted = clipboard; } },
    locator(selector) { if (selector === 'body') return locator(true, 'Group feed'); if (selector.includes('contenteditable')) return editor; return locator(false); },
    getByRole(role, options = {}) {
      if (role === 'dialog') return dialog;
      if (role === 'button' && /write something/i.test(String(options.name))) return locator(true);
      return locator(false);
    },
    getByText() { return locator(false); },
  };
  assert.deepEqual(await postToFacebook(page, { groupUrl: page.url(), postText: 'Hello queue' }), { status: 'posted' });
  assert.equal(clicked, true);
});

test('delayed composer updates never cause a second insertion', async () => {
  let writes = 0; let reads = 0;
  const editor = { async fill() { writes += 1; }, async innerText() { return ++reads < 4 ? '' : 'Hello\nworld'; } };
  await enterPostText({ async waitForTimeout() {} }, editor, 'Hello\r\nworld');
  assert.equal(writes, 1);
  assert.equal(reads, 4);
});

test('duplicated or incorrect composer text prevents submission', async () => {
  const editor = { async fill() {}, async innerText() { return 'HelloHello'; } };
  await assert.rejects(enterPostText({ async waitForTimeout() {} }, editor, 'Hello'), { code: 'POST_TEXT_MISMATCH' });
});

test('composer discovery searches past hidden matching fields', async () => {
  const visible = locator(true);
  const page = { getByRole(role) {
    assert.equal(role, 'dialog');
    return { locator() { return { async count() { return 2; }, nth(index) { return index === 0 ? locator(false) : visible; } }; } };
  } };
  assert.equal(await firstVisible(selectors.editors, page), visible);
});
