// ==UserScript==
// @name         Paste Happy Facebook Autopost
// @namespace    https://pastehappy.example
// @version      1.0.0
// @description  Opens the Facebook composer, pastes your clipboard, and clicks Post when arriving from Paste Happy's Copy & Open action.
// @author       Paste Happy
// @match        https://www.facebook.com/*
// @match        https://web.facebook.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const activationToken = extractActivationToken();
  if (!activationToken) {
    return;
  }

  clearActivationParams();
  const status = showStatus('Paste Happy: Preparing your post…');

  getPostCopy(activationToken)
    .then((postCopy) => {
      if (!postCopy.trim()) {
        throw new Error('No post text available');
      }
      return ensureComposerReady().then((textbox) => ({ textbox, postCopy }));
    })
    .then(({ textbox, postCopy }) => {
      fillComposer(textbox, postCopy);
      status.update('Paste Happy: Posting…');
      return submitPost().then((clicked) => {
        status.update(clicked ? 'Paste Happy: Post submitted automatically.' : 'Paste Happy: Text ready — click Post manually.');
        setTimeout(() => status.remove(), 8000);
      });
    })
    .catch((error) => {
      console.error('[Paste Happy]', error);
      status.update('Paste Happy: Could not auto-post. Text may still be on your clipboard.');
      setTimeout(() => status.remove(), 12000);
    });

  function extractActivationToken() {
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
    if (params.get('pastePost')) {
      return params.get('pastePost');
    }
    if (params.get('ph') === '1') {
      return params.get('ph_post');
    }
    return null;
  }

  function clearActivationParams() {
    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    let changed = false;
    if (hash.has('pastePost')) {
      hash.delete('pastePost');
      changed = true;
    }
    if (search.get('ph') === '1') {
      search.delete('ph');
      search.delete('ph_post');
      search.delete('ph_visit');
      changed = true;
    }
    if (hash.get('ph') === '1') {
      hash.delete('ph');
      hash.delete('ph_post');
      hash.delete('ph_visit');
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

  async function getPostCopy(fallbackToken) {
    const clipboardText = await readClipboardText();
    if (clipboardText?.trim()) {
      return clipboardText;
    }
    return decodePostCopy(fallbackToken) ?? '';
  }

  async function readClipboardText() {
    if (!navigator.clipboard?.readText) {
      return '';
    }
    try {
      return await navigator.clipboard.readText();
    } catch (error) {
      console.warn('[Paste Happy]', 'Clipboard read failed', error);
      return '';
    }
  }

  function decodePostCopy(input) {
    if (!input) {
      return '';
    }
    const uriComponent = decodeURIComponent(input);
    return decompressFromEncodedURIComponent(uriComponent);
  }

  function ensureComposerReady() {
    const existing = findComposerTextbox();
    if (existing) {
      return Promise.resolve(existing);
    }
    return waitForElement(findComposerButton, 15000).then((button) => {
      button.click();
      return waitForElement(findComposerTextbox, 15000);
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

    const composerRegion = document.querySelector('[data-pagelet="GroupInlineComposer"], [data-pagelet="FeedComposer"]');
    if (composerRegion) {
      const button = composerRegion.querySelector('[role="button"][tabindex="0"]');
      if (button) {
        return button;
      }
    }

    const fallback = Array.from(document.querySelectorAll('[role="button"]')).find((el) => /create (a )?post|write something|what's on your mind/i.test(el.textContent || ''));
    return fallback || null;
  }

  function findComposerTextbox() {
    const dialog = document.querySelector('[role="dialog"]');
    if (dialog) {
      const textbox = dialog.querySelector('[contenteditable="true"][role="textbox"]');
      if (textbox) {
        return textbox;
      }
    }

    const inlineComposer = document.querySelector('[data-pagelet="GroupInlineComposer"], [data-pagelet="FeedComposer"]');
    if (inlineComposer) {
      const textbox = inlineComposer.querySelector('[contenteditable="true"][role="textbox"]');
      if (textbox) {
        return textbox;
      }
    }

    const anyTextbox = Array.from(document.querySelectorAll('[contenteditable="true"][role="textbox"]'));
    return anyTextbox.length ? anyTextbox[0] : null;
  }

  function submitPost() {
    return waitForElement(findPostButton, 15000)
      .then((button) => {
        button.click();
        return true;
      })
      .catch(() => false);
  }

  function findPostButton() {
    const dialog = document.querySelector('[role="dialog"]');
    if (dialog) {
      const ariaButton = dialog.querySelector('[aria-label^="Post"], [aria-label*="Post"], [aria-label="Post"], [data-testid="react-composer-post-button"], [data-testid="composer-submit-button"]');
      if (ariaButton) {
        return ariaButton;
      }
      const textButton = Array.from(dialog.querySelectorAll('[role="button"]')).find((el) => /\bpost\b/i.test(el.textContent || ''));
      if (textButton) {
        return textButton;
      }
    }

    const fallback = Array.from(document.querySelectorAll('[role="button"]')).find((el) => /\bpost\b/i.test(el.textContent || ''));
    return fallback || null;
  }

  function waitForElement(getter, timeoutMs) {
    return new Promise((resolve, reject) => {
      const existing = getter();
      if (existing) {
        resolve(existing);
        return;
      }

      let done = false;
      const cleanup = () => {
        done = true;
        observer.disconnect();
        clearTimeout(timeoutId);
      };

      const observer = new MutationObserver(() => {
        if (done) {
          return;
        }
        const candidate = getter();
        if (candidate) {
          cleanup();
          resolve(candidate);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

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
    element.focus();
    selectAll(element);
    if (!document.execCommand('insertText', false, text)) {
      element.textContent = text;
    }
    element.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertFromPaste' }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function selectAll(element) {
    const selection = window.getSelection();
    if (!selection) {
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function showStatus(initialMessage, isError) {
    const container = document.createElement('div');
    container.textContent = initialMessage;
    container.style.position = 'fixed';
    container.style.zIndex = '999999';
    container.style.top = '16px';
    container.style.right = '16px';
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
