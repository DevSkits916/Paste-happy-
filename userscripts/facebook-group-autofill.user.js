// ==UserScript==
// @name         Paste Happy Facebook Group Autofill
// @namespace    https://pastehappy.example
// @version      1.1.0
// @description  Automatically opens the Facebook group composer and pastes the queued post when using Paste Happy's Copy & Open button.
// @author       Paste Happy
// @match        https://www.facebook.com/groups/*
// @match        https://web.facebook.com/groups/*
// @match        https://m.facebook.com/groups/*
// @match        https://mobile.facebook.com/groups/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'paste-happy:queued-post';
  const isIOSDevice = /iP(ad|hone|od)/.test(window.navigator.userAgent || '');
  const isMobileFacebook = /(?:^|\.)m(?:obile)?\.facebook\.com$/i.test(window.location.hostname);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  function init() {
    const payload = readEncodedPayload();
    if (!payload) {
      return;
    }

    let postCopy = '';
    try {
      postCopy = decodePostCopy(payload.value) ?? '';
    } catch (error) {
      console.error('[Paste Happy]', 'Failed to decode post copy', error);
      showStatus('Paste Happy: Could not decode post copy.', true);
      return;
    }

    if (!postCopy.trim()) {
      console.warn('[Paste Happy]', 'Decoded payload was empty.');
      clearStoredPayload();
      return;
    }

    if (payload.fromUrl) {
      clearPhParameters();
    }

    const status = showStatus('Paste Happy: Preparing your post…');

    ensureComposerReady()
      .then((textbox) => {
        fillComposer(textbox, postCopy);
        status.update('Paste Happy: Post text ready — review and tap Post.');
        clearStoredPayload();
        setTimeout(() => status.remove(), 8000);
      })
      .catch((error) => {
        console.error('[Paste Happy]', error);
        status.update('Paste Happy: Could not auto-fill the post. Paste manually if needed.');
        clearStoredPayload();
        setTimeout(() => status.remove(), 12000);
      });
  }

  function readEncodedPayload() {
    const encodedFromUrl = extractEncodedPayload();
    if (encodedFromUrl) {
      persistPayload(encodedFromUrl);
      return { value: encodedFromUrl, fromUrl: true };
    }

    const stored = getStoredPayload();
    if (stored) {
      return { value: stored, fromUrl: false };
    }

    return null;
  }

  function persistPayload(value) {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, value);
    } catch (error) {
      console.warn('[Paste Happy]', 'Unable to persist payload for navigation continuity.', error);
    }
  }

  function getStoredPayload() {
    try {
      return window.sessionStorage.getItem(STORAGE_KEY);
    } catch (error) {
      console.warn('[Paste Happy]', 'Unable to read stored payload.', error);
      return null;
    }
  }

  function clearStoredPayload() {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.warn('[Paste Happy]', 'Unable to clear stored payload.', error);
    }
  }

  function extractEncodedPayload() {
    const segments = [];
    if (window.location.search.length > 1) {
      segments.push(window.location.search.slice(1));
    }
    if (window.location.hash.length > 1) {
      segments.push(window.location.hash.slice(1));
    }
    if (!segments.length) {
      return null;
    }

    const params = new URLSearchParams(segments.join('&'));
    if (params.get('ph') !== '1') {
      return null;
    }
    return params.get('ph_post');
  }

  function decodePostCopy(input) {
    if (!input) {
      return '';
    }
    const uriComponent = decodeURIComponent(input);
    return decompressFromEncodedURIComponent(uriComponent);
  }

  function clearPhParameters() {
    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    let changed = false;
    if (search.get('ph') === '1') {
      search.delete('ph');
      search.delete('ph_post');
      changed = true;
    }
    if (hash.get('ph') === '1') {
      hash.delete('ph');
      hash.delete('ph_post');
      changed = true;
    }
    if (!changed) {
      return;
    }
    const nextSearch = search.toString();
    const nextHash = hash.toString();
    const nextUrl = `${window.location.origin}${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${nextHash ? `#${nextHash}` : ''}`;
    window.history.replaceState(null, document.title, nextUrl);
  }

  function ensureComposerReady() {
    const existing = findComposerTextbox();
    if (existing) {
      return Promise.resolve(existing);
    }
    return waitForElement(findComposerButton, 20000)
      .then((button) => {
        triggerComposerButton(button);
        const timeout = isMobileFacebook ? 25000 : 15000;
        return waitForElement(findComposerTextbox, timeout);
      });
  }

  function findComposerButton() {
    const ariaCandidates = Array.from(document.querySelectorAll('[aria-label]'));
    const ariaButton = ariaCandidates.find((el) => {
      const label = el.getAttribute('aria-label') || '';
      return /create (a )?(public )?post/i.test(label) || /write something/i.test(label) || /what's on your mind/i.test(label);
    });
    if (ariaButton) {
      return ariaButton;
    }

    if (isMobileFacebook) {
      const mobileComposer = document.querySelector('[data-sigil~="m-feed-composer-entrypoint"]');
      if (mobileComposer) {
        return mobileComposer;
      }

      const mobileButton = Array.from(document.querySelectorAll('a, button, div[role="button"]')).find((el) => {
        const text = (el.textContent || '').trim();
        return /write (a )?post|what's on your mind|create post|share something/i.test(text);
      });
      if (mobileButton) {
        return mobileButton;
      }
    }

    const groupInline = document.querySelector('[data-pagelet="GroupInlineComposer"]');
    if (groupInline) {
      const button = groupInline.querySelector('[role="button"][tabindex="0"]');
      if (button) {
        return button;
      }
    }

    const fallback = Array.from(document.querySelectorAll('[role="button"]')).find((el) => /create (a )?post|write something|what's on your mind/i.test(el.textContent || ''));
    return fallback || null;
  }

  function findComposerTextbox() {
    if (isMobileFacebook) {
      const mobileDialog = document.querySelector('[role="dialog"]');
      if (mobileDialog) {
        const textareaInDialog = mobileDialog.querySelector('textarea, [contenteditable="true"][role="textbox"]');
        if (textareaInDialog) {
          return textareaInDialog;
        }
      }

      const composerForm = document.querySelector('form[action*="composer"], form[data-sigil~="m-composer-form"]');
      if (composerForm) {
        const textarea = composerForm.querySelector('textarea[name="xc_message"], textarea, [contenteditable="true"][role="textbox"]');
        if (textarea) {
          return textarea;
        }
      }
    }

    const dialog = document.querySelector('[role="dialog"]');
    if (dialog) {
      const textbox = dialog.querySelector('[contenteditable="true"][role="textbox"]');
      if (textbox) {
        return textbox;
      }
    }

    const inlineComposer = document.querySelector('[data-pagelet="GroupInlineComposer"]');
    if (inlineComposer) {
      const textbox = inlineComposer.querySelector('[contenteditable="true"][role="textbox"]');
      if (textbox) {
        return textbox;
      }
    }

    const anyTextbox = Array.from(document.querySelectorAll('[contenteditable="true"][role="textbox"], textarea[name="xc_message"], textarea[data-sigil~="m-textarea-input"], textarea'));
    return anyTextbox.length ? anyTextbox[0] : null;
  }

  function triggerComposerButton(button) {
    if (!button) {
      return;
    }

    try {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    } catch (error) {
      console.warn('[Paste Happy]', 'MouseEvent dispatch failed, using click fallback.', error);
    }

    if (typeof button.click === 'function') {
      button.click();
    }

    if (isMobileFacebook && button.tagName === 'A' && button.href && !button.getAttribute('target')) {
      if (button.href !== window.location.href) {
        window.location.assign(button.href);
      }
    }
  }

  function waitForElement(getter, timeoutMs) {
    return new Promise((resolve, reject) => {
      const existing = getter();
      if (existing) {
        resolve(existing);
        return;
      }

      let done = false;
      let observer = null;
      let intervalId = null;
      const cleanup = () => {
        done = true;
        if (observer) {
          observer.disconnect();
        }
        if (intervalId) {
          clearInterval(intervalId);
        }
        clearTimeout(timeoutId);
      };

      const watchForCandidate = () => {
        if (done) {
          return;
        }
        const candidate = getter();
        if (candidate) {
          cleanup();
          resolve(candidate);
        }
      };

      if (typeof MutationObserver !== 'undefined' && document.body) {
        observer = new MutationObserver(watchForCandidate);
        observer.observe(document.body, { childList: true, subtree: true });
      }

      if (!observer) {
        intervalId = window.setInterval(watchForCandidate, 250);
      }

      const timeoutId = setTimeout(() => {
        if (done) {
          return;
        }
        cleanup();
        reject(new Error('Timed out waiting for Facebook composer.'));
      }, timeoutMs);
    });
  }

  function fillComposer(element, text) {
    if (!element) {
      return;
    }

    focusElement(element);
    selectAll(element);

    let inserted = false;
    if (!isTextInputControl(element)) {
      try {
        inserted = document.execCommand('insertText', false, text);
      } catch (error) {
        inserted = false;
      }
    }

    if (!inserted) {
      if (isTextInputControl(element)) {
        element.value = text;
      } else {
        element.textContent = text;
      }
    }

    dispatchInputEvents(element, text);
    if (isIOSDevice) {
      setTimeout(() => dispatchInputEvents(element, text), 50);
    }
    dispatchChangeEvent(element);
  }

  function focusElement(element) {
    if (typeof element.focus === 'function') {
      try {
        element.focus({ preventScroll: false });
      } catch (error) {
        element.focus();
      }
    }

    if (isIOSDevice && typeof element.click === 'function') {
      try {
        element.click();
      } catch (error) {
        // ignore
      }
    }
  }

  function selectAll(element) {
    if (isTextInputControl(element) && typeof element.setSelectionRange === 'function') {
      const length = element.value ? element.value.length : 0;
      try {
        element.setSelectionRange(0, length);
        return;
      } catch (error) {
        // fall through to contenteditable logic
      }
    }

    const selection = window.getSelection();
    if (!selection) {
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function dispatchInputEvents(element, text) {
    let inputEventDispatched = false;
    if (typeof window.InputEvent === 'function') {
      try {
        const inputEvent = new window.InputEvent('input', { bubbles: true, data: text, inputType: 'insertFromPaste' });
        element.dispatchEvent(inputEvent);
        inputEventDispatched = true;
      } catch (error) {
        inputEventDispatched = false;
      }
    }

    if (!inputEventDispatched) {
      const legacyInput = document.createEvent('Event');
      legacyInput.initEvent('input', true, true);
      element.dispatchEvent(legacyInput);
    }
  }

  function dispatchChangeEvent(element) {
    const changeEvent = document.createEvent('Event');
    changeEvent.initEvent('change', true, true);
    element.dispatchEvent(changeEvent);
  }

  function isTextInputControl(element) {
    if (!element || !element.tagName) {
      return false;
    }
    const tag = element.tagName.toUpperCase();
    if (tag === 'TEXTAREA') {
      return true;
    }
    if (tag === 'INPUT') {
      const type = (element.getAttribute('type') || 'text').toLowerCase();
      return ['text', 'search', 'url', 'tel'].includes(type);
    }
    return false;
  }

  function showStatus(initialMessage, isError) {
    const container = document.createElement('div');
    container.textContent = initialMessage;
    container.style.position = 'fixed';
    container.style.zIndex = '999999';
    container.style.top = isIOSDevice ? 'calc(env(safe-area-inset-top, 0px) + 12px)' : '16px';
    container.style.right = '16px';
    if (isMobileFacebook) {
      container.style.left = '16px';
      container.style.right = '16px';
      container.style.textAlign = 'center';
    }
    container.style.padding = '12px 16px';
    container.style.background = isError ? 'rgba(220, 38, 38, 0.95)' : 'rgba(30, 64, 175, 0.95)';
    container.style.color = '#fff';
    container.style.fontSize = '14px';
    container.style.lineHeight = '1.4';
    container.style.borderRadius = '8px';
    container.style.boxShadow = '0 8px 20px rgba(0,0,0,0.25)';
    container.style.maxWidth = '320px';
    container.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    document.body.appendChild(container);

    return {
      update(message) {
        container.textContent = message;
      },
      remove() {
        if (container.parentNode) {
          container.parentNode.removeChild(container);
        }
      },
    };
  }

  const keyStrUriSafe = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$';
  const baseReverseDic = {};

  function getBaseValue(alphabet, character) {
    if (!baseReverseDic[alphabet]) {
      baseReverseDic[alphabet] = {};
      for (let i = 0; i < alphabet.length; i += 1) {
        baseReverseDic[alphabet][alphabet.charAt(i)] = i;
      }
    }
    return baseReverseDic[alphabet][character];
  }

  function decompressFromEncodedURIComponent(input) {
    if (input == null || input === '') {
      return '';
    }
    let str = input.replace(/ /g, '+');
    return decompress(str.length, 32, (index) => getBaseValue(keyStrUriSafe, str.charAt(index)));
  }

  function decompress(length, resetValue, getNextValue) {
    const dictionary = [];
    let next;
    let enlargeIn = 4;
    let dictSize = 4;
    let numBits = 3;
    const result = [];

    let data = { value: getNextValue(0) ?? 0, position: resetValue, index: 1 };

    for (let i = 0; i < 3; i += 1) {
      dictionary[i] = i;
    }

    let bitsValue = 0;
    let maxpower = Math.pow(2, 2);
    let power = 1;
    while (power !== maxpower) {
      const bit = data.value & data.position;
      data.position >>= 1;
      if (data.position === 0) {
        data.position = resetValue;
        data.value = getNextValue(data.index++) ?? 0;
      }
      bitsValue |= (bit > 0 ? 1 : 0) * power;
      power <<= 1;
    }

    switch (bitsValue) {
      case 0:
        bitsValue = 0;
        maxpower = Math.pow(2, 8);
        power = 1;
        while (power !== maxpower) {
          const bit = data.value & data.position;
          data.position >>= 1;
          if (data.position === 0) {
            data.position = resetValue;
            data.value = getNextValue(data.index++) ?? 0;
          }
          bitsValue |= (bit > 0 ? 1 : 0) * power;
          power <<= 1;
        }
        next = String.fromCharCode(bitsValue);
        break;
      case 1:
        bitsValue = 0;
        maxpower = Math.pow(2, 16);
        power = 1;
        while (power !== maxpower) {
          const bit = data.value & data.position;
          data.position >>= 1;
          if (data.position === 0) {
            data.position = resetValue;
            data.value = getNextValue(data.index++) ?? 0;
          }
          bitsValue |= (bit > 0 ? 1 : 0) * power;
          power <<= 1;
        }
        next = String.fromCharCode(bitsValue);
        break;
      case 2:
        return '';
      default:
        next = null;
    }

    dictionary[3] = next;
    let w = next;
    result.push(next);

    while (true) {
      if (data.index > length) {
        return '';
      }

      let c = 0;
      maxpower = Math.pow(2, numBits);
      power = 1;
      while (power !== maxpower) {
        const bit = data.value & data.position;
        data.position >>= 1;
        if (data.position === 0) {
          data.position = resetValue;
          data.value = getNextValue(data.index++) ?? 0;
        }
        c |= (bit > 0 ? 1 : 0) * power;
        power <<= 1;
      }

      switch (c) {
        case 0:
          bitsValue = 0;
          maxpower = Math.pow(2, 8);
          power = 1;
          while (power !== maxpower) {
            const bit = data.value & data.position;
            data.position >>= 1;
            if (data.position === 0) {
              data.position = resetValue;
              data.value = getNextValue(data.index++) ?? 0;
            }
            bitsValue |= (bit > 0 ? 1 : 0) * power;
            power <<= 1;
          }
          dictionary[dictSize++] = String.fromCharCode(bitsValue);
          c = dictSize - 1;
          enlargeIn -= 1;
          break;
        case 1:
          bitsValue = 0;
          maxpower = Math.pow(2, 16);
          power = 1;
          while (power !== maxpower) {
            const bit = data.value & data.position;
            data.position >>= 1;
            if (data.position === 0) {
              data.position = resetValue;
              data.value = getNextValue(data.index++) ?? 0;
            }
            bitsValue |= (bit > 0 ? 1 : 0) * power;
            power <<= 1;
          }
          dictionary[dictSize++] = String.fromCharCode(bitsValue);
          c = dictSize - 1;
          enlargeIn -= 1;
          break;
        case 2:
          return result.join('');
      }

      if (enlargeIn === 0) {
        enlargeIn = Math.pow(2, numBits);
        numBits += 1;
      }

      let value;
      if (dictionary[c]) {
        value = dictionary[c];
      } else {
        if (c === dictSize) {
          value = w + w.charAt(0);
        } else {
          return '';
        }
      }
      result.push(value);

      dictionary[dictSize++] = w + value.charAt(0);
      enlargeIn -= 1;
      w = value;

      if (enlargeIn === 0) {
        enlargeIn = Math.pow(2, numBits);
        numBits += 1;
      }
    }
  }
})();
