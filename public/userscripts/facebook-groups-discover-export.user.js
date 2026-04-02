// ==UserScript==
// @name         Facebook Groups → CSV/JSON Exporter (Enhanced v4)
// @namespace    devskits916.fb.groups.csv
// @version      4.0.0
// @description  Scrape visible Facebook groups into CSV/JSON with a sturdier UI, persistent state, live observation, stronger parsing, and safer autoscan behavior.
// @author       Calder
// @match        https://www.facebook.com/*groups*
// @match        https://m.facebook.com/*groups*
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEYS = {
    settings: 'fb-groups-scraper:v4:settings',
    ui: 'fb-groups-scraper:v4:ui',
    data: 'fb-groups-scraper:v4:data'
  };

  const DEFAULT_SETTINGS = {
    autoStart: false,
    exportFormat: 'csv',
    maxItems: 5000,
    minMembers: 0,
    activityThreshold: '',
    showProgress: true,
    showList: false,
    persistResults: true,
    liveObserve: true,
    autoscanDurationSec: 120,
    autoscanIntervalMs: 1500,
    sortBy: 'membersDesc',
    listFilter: ''
  };

  const DEFAULT_UI = {
    theme: 'dark',
    minimized: false,
    right: 12,
    bottom: 12,
    width: 380,
    height: null
  };

  const state = {
    items: new Map(),
    settings: { ...DEFAULT_SETTINGS },
    ui: { ...DEFAULT_UI },
    autoscanTimer: null,
    autoscanEndsAt: 0,
    isScanning: false,
    scanDebounceTimer: null,
    observer: null,
    cleanupFns: [],
    destroyed: false
  };

  function safeParse(json, fallback) {
    try {
      return json ? JSON.parse(json) : fallback;
    } catch {
      return fallback;
    }
  }

  function loadState() {
    Object.assign(state.settings, safeParse(localStorage.getItem(STORAGE_KEYS.settings), {}));
    Object.assign(state.ui, safeParse(localStorage.getItem(STORAGE_KEYS.ui), {}));

    const savedRows = safeParse(localStorage.getItem(STORAGE_KEYS.data), []);
    if (Array.isArray(savedRows)) {
      for (const row of savedRows) {
        if (row && row.key) state.items.set(row.key, row);
      }
    }
  }

  function saveSettings() {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(state.settings));
  }

  function saveUI() {
    localStorage.setItem(STORAGE_KEYS.ui, JSON.stringify(state.ui));
  }

  function saveData() {
    if (!state.settings.persistResults) {
      localStorage.removeItem(STORAGE_KEYS.data);
      return;
    }
    const rows = Array.from(state.items.entries()).map(([key, value]) => ({ ...value, key }));
    localStorage.setItem(STORAGE_KEYS.data, JSON.stringify(rows));
  }

  function panelEl() {
    return document.getElementById('fb-groups-scraper-panel');
  }

  function setStatus(message) {
    const el = document.getElementById('fb-groups-scraper-status');
    if (el) el.textContent = message;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function cleanText(text) {
    return String(text ?? '').replace(/\s+/g, ' ').trim();
  }

  function absolutize(url) {
    try {
      return new URL(url, location.href).href;
    } catch {
      return null;
    }
  }

  function canonicalizeGroupUrl(url) {
    try {
      const parsed = new URL(url);
      if (!/facebook\.com$/i.test(parsed.hostname) && !/\.facebook\.com$/i.test(parsed.hostname)) return null;
      const match = parsed.pathname.match(/\/groups\/([^/?#]+)/i);
      if (!match || !match[1]) return null;
      return `${parsed.origin}/groups/${match[1]}`;
    } catch {
      return null;
    }
  }

  function groupKey(url) {
    const match = String(url).match(/\/groups\/([^/?#]+)/i);
    return match ? match[1].toLowerCase() : null;
  }

  function parseCompactNumber(text) {
    if (!text) return 0;
    const normalized = String(text).trim();
    const match = normalized.match(/([\d.,]+)\s*([kmb]|million|billion)?/i);
    if (!match) return 0;

    let number = parseFloat(match[1].replace(/,/g, ''));
    if (!Number.isFinite(number)) return 0;

    const suffix = (match[2] || '').toLowerCase();
    if (suffix === 'k') number *= 1e3;
    else if (suffix === 'm' || suffix === 'million') number *= 1e6;
    else if (suffix === 'b' || suffix === 'billion') number *= 1e9;

    return Math.round(number);
  }

  function findMembers(text) {
    const patterns = [
      /([\d.,]+\s*[kmb]?)\s*(?:members?|people)\b/i,
      /([\d.,]+\s*(?:million|billion))\s*(?:members?|people)\b/i
    ];
    for (const pattern of patterns) {
      const match = String(text || '').match(pattern);
      if (match) return cleanText(match[1]);
    }
    return '';
  }

  function findPrivacy(text) {
    const match = String(text || '').match(/\b(public|private)\s+group\b/i);
    return match ? `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()} group` : '';
  }

  function findJoinStatus(text) {
    const checks = [
      ['Joined', /\bjoined\b/i],
      ['Join requested', /join\s+requested/i],
      ['Invited', /\binvited\b/i],
      ['Pending', /\bpending\b/i]
    ];
    for (const [label, pattern] of checks) {
      if (pattern.test(String(text || ''))) return label;
    }
    return '';
  }

  function normalizeRelativeTime(input) {
    const text = cleanText(input).toLowerCase();
    if (!text) return Infinity;
    if (text === 'today' || text === 'just now') return 0;
    if (text === 'yesterday') return 86400;

    const compact = text.match(/(\d+)\s*([smhdwy])/i);
    if (compact) {
      const value = parseInt(compact[1], 10);
      const unit = compact[2].toLowerCase();
      if (unit === 's') return value;
      if (unit === 'm') return value * 60;
      if (unit === 'h') return value * 3600;
      if (unit === 'd') return value * 86400;
      if (unit === 'w') return value * 604800;
      if (unit === 'y') return value * 31536000;
    }

    const match = text.match(/(\d+)\s*(second|minute|min|hour|day|week|month|year)s?(?:\s+ago)?/i);
    if (!match) return Infinity;

    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    if (unit.startsWith('second')) return value;
    if (unit.startsWith('min')) return value * 60;
    if (unit.startsWith('hour')) return value * 3600;
    if (unit.startsWith('day')) return value * 86400;
    if (unit.startsWith('week')) return value * 604800;
    if (unit.startsWith('month')) return value * 2592000;
    if (unit.startsWith('year')) return value * 31536000;
    return Infinity;
  }

  function findLastActive(text) {
    const source = String(text || '');
    const patterns = [
      /last\s+active\s+([^\n•·|]+)/i,
      /active\s+([^\n•·|]+)/i,
      /\b(today|yesterday)\b/i,
      /\b(\d+\s*(?:seconds?|minutes?|mins?|hours?|days?|weeks?|months?|years?)\s+ago)\b/i,
      /\b(\d+\s*[smhdwy])\b/i
    ];

    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (!match) continue;
      const raw = cleanText(match[1] || match[0]);
      if (!raw) continue;
      if (/\b(active|group|public|private|members?)\b/i.test(raw) && !/\b(today|yesterday|ago|[smhdwy])\b/i.test(raw)) continue;
      return raw.replace(/^active\s+/i, '').replace(/^last\s+active\s+/i, '').trim();
    }

    return '';
  }

  function isRecentEnough(lastActive, threshold) {
    const thresholdSeconds = normalizeRelativeTime(threshold);
    if (!threshold || !Number.isFinite(thresholdSeconds) || thresholdSeconds === Infinity) return true;
    const activeSeconds = normalizeRelativeTime(lastActive);
    if (!Number.isFinite(activeSeconds) || activeSeconds === Infinity) return false;
    return activeSeconds <= thresholdSeconds;
  }

  function findBestName(container, anchor) {
    const direct = cleanText(anchor?.textContent || '');
    const badName = /^(join|see more|more|feed|discover|groups?)$/i;

    const headingSelectors = [
      'h1', 'h2', 'h3', 'h4',
      '[role="heading"]',
      'strong',
      'span[dir="auto"]'
    ];

    for (const selector of headingSelectors) {
      const nodes = container.querySelectorAll(selector);
      for (const node of nodes) {
        const text = cleanText(node.textContent || '');
        if (text.length >= 3 && text.length <= 140 && !badName.test(text) && !/(members?|public group|private group|active)/i.test(text)) {
          return text;
        }
      }
    }

    if (direct.length >= 3 && !badName.test(direct)) return direct;

    const allText = cleanText(container.textContent || '');
    const bits = allText.split(/\s{2,}|\n+/).map(cleanText).filter(Boolean);
    for (const bit of bits) {
      if (bit.length >= 3 && bit.length <= 140 && !/(members?|public group|private group|active|join requested|joined)/i.test(bit)) {
        return bit;
      }
    }

    return direct;
  }

  function getRecordFromAnchor(anchor) {
    if (!anchor || panelEl()?.contains(anchor)) return null;

    const href = anchor.getAttribute('href');
    if (!href) return null;

    const absoluteUrl = absolutize(href);
    const canonicalUrl = canonicalizeGroupUrl(absoluteUrl);
    if (!canonicalUrl) return null;

    const key = groupKey(canonicalUrl);
    if (!key || state.items.has(key)) return null;

    const container =
      anchor.closest('div[role="article"], div[data-pagelet], div[role="feed"] > div, div.x1lliihq, div.x78zum5, li') ||
      anchor.closest('div') ||
      anchor.parentElement;

    if (!container) return null;

    const blockText = cleanText(container.innerText || container.textContent || '');
    const name = findBestName(container, anchor);
    if (!name || name.length < 3) return null;

    const members = findMembers(blockText);
    const membersNum = parseCompactNumber(members);
    const lastActive = findLastActive(blockText);
    const privacy = findPrivacy(blockText);
    const joinStatus = findJoinStatus(blockText);

    if (membersNum < (state.settings.minMembers || 0)) return null;
    if (!isRecentEnough(lastActive, state.settings.activityThreshold)) return null;

    return {
      key,
      name,
      members,
      membersNum,
      lastActive,
      privacy,
      joinStatus,
      url: canonicalUrl,
      sourceUrl: absoluteUrl,
      scannedAt: new Date().toISOString()
    };
  }

  function scanPage(reason = 'manual') {
    if (state.destroyed) return 0;

    const selectors = [
      'a[href*="/groups/"]:not([href*="/feed"]):not([href*="/joins"]):not([href*="/discover"]):not([href*="/create"]):not([href*="/requests"]):not([href*="/membership_approval"]):not([href*="/categories/"])',
      'a[role="link"][href*="/groups/"]'
    ];

    const anchors = new Set();
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((node) => anchors.add(node));
    }

    let added = 0;
    for (const anchor of anchors) {
      if (state.items.size >= state.settings.maxItems) break;
      const record = getRecordFromAnchor(anchor);
      if (!record) continue;
      state.items.set(record.key, record);
      added += 1;
    }

    if (added > 0) {
      saveData();
      updateCount();
      updateProgress();
      updateList();
      setStatus(`${reason}: +${added} new, ${state.items.size} total`);
    } else if (reason === 'manual') {
      setStatus(`No new groups found. ${state.items.size} total.`);
    }

    if (state.items.size >= state.settings.maxItems) {
      setStatus(`Max limit reached (${state.settings.maxItems}). Because unlimited collection is how browsers die.`);
      stopAutoscan(false);
    }

    return added;
  }

  function scheduleScan(reason = 'observer', delay = 250) {
    clearTimeout(state.scanDebounceTimer);
    state.scanDebounceTimer = setTimeout(() => scanPage(reason), delay);
  }

  function startObserver() {
    if (state.observer || !state.settings.liveObserve) return;
    state.observer = new MutationObserver(() => scheduleScan('observer', 300));
    state.observer.observe(document.body, { childList: true, subtree: true });
  }

  function stopObserver() {
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
  }

  function startAutoscan() {
    if (state.autoscanTimer) return;

    state.isScanning = true;
    state.autoscanEndsAt = Date.now() + (state.settings.autoscanDurationSec * 1000);
    setStatus(`Auto-scan running for ${state.settings.autoscanDurationSec}s`);

    const button = document.getElementById('fb-groups-scraper-autoscan');
    if (button) button.textContent = '🛑 Stop Auto-Scan';

    startObserver();
    scanPage('auto-start');

    state.autoscanTimer = setInterval(() => {
      if (Date.now() >= state.autoscanEndsAt || state.items.size >= state.settings.maxItems) {
        stopAutoscan(true);
        return;
      }

      const scrollStep = Math.max(400, Math.floor(window.innerHeight * 0.9));
      window.scrollBy({ top: scrollStep, behavior: 'smooth' });
      scheduleScan('auto-scroll', 350);
      updateAutoscanStatus();
    }, Math.max(500, state.settings.autoscanIntervalMs));
  }

  function stopAutoscan(finished) {
    if (state.autoscanTimer) {
      clearInterval(state.autoscanTimer);
      state.autoscanTimer = null;
    }

    state.isScanning = false;
    if (!state.settings.liveObserve) stopObserver();

    const button = document.getElementById('fb-groups-scraper-autoscan');
    if (button) button.textContent = `🤖 Auto-Scan (${state.settings.autoscanDurationSec}s)`;

    if (finished) {
      setStatus(`Auto-scan finished. ${state.items.size} groups collected.`);
    } else {
      setStatus(`Auto-scan stopped. ${state.items.size} groups collected.`);
    }
  }

  function updateAutoscanStatus() {
    if (!state.isScanning) return;
    const secondsLeft = Math.max(0, Math.ceil((state.autoscanEndsAt - Date.now()) / 1000));
    const label = document.getElementById('fb-groups-scraper-status');
    if (label) {
      label.textContent = `Auto-scanning... ${secondsLeft}s left • ${state.items.size} groups`;
    }
  }

  function getSortedRecords() {
    const rows = Array.from(state.items.values());
    const filter = cleanText(state.settings.listFilter).toLowerCase();
    const filtered = filter
      ? rows.filter((row) => `${row.name} ${row.members} ${row.lastActive} ${row.privacy} ${row.joinStatus} ${row.url}`.toLowerCase().includes(filter))
      : rows;

    const sorters = {
      membersDesc: (a, b) => (b.membersNum || 0) - (a.membersNum || 0) || a.name.localeCompare(b.name),
      membersAsc: (a, b) => (a.membersNum || 0) - (b.membersNum || 0) || a.name.localeCompare(b.name),
      nameAsc: (a, b) => a.name.localeCompare(b.name),
      newest: (a, b) => new Date(b.scannedAt) - new Date(a.scannedAt)
    };

    return filtered.sort(sorters[state.settings.sortBy] || sorters.membersDesc);
  }

  function updateCount() {
    const el = document.getElementById('fb-groups-scraper-count');
    if (el) el.textContent = state.items.size.toLocaleString();
  }

  function updateProgress() {
    const bar = document.querySelector('#fb-groups-scraper-panel .progress-bar');
    const fill = document.querySelector('#fb-groups-scraper-panel .progress-bar .fill');
    const label = document.getElementById('fb-groups-scraper-progress-label');
    const pct = Math.min(100, (state.items.size / Math.max(1, state.settings.maxItems)) * 100);

    if (fill) fill.style.width = `${pct}%`;
    if (bar) bar.classList.toggle('visible', !!state.settings.showProgress);
    if (label) label.textContent = `${state.items.size.toLocaleString()} / ${state.settings.maxItems.toLocaleString()}`;
  }

  function updateList() {
    const container = document.querySelector('#fb-groups-scraper-panel .list-container');
    const list = document.getElementById('fb-groups-scraper-list');
    if (!container || !list) return;

    container.classList.toggle('visible', !!state.settings.showList);
    if (!state.settings.showList) {
      list.innerHTML = '';
      return;
    }

    const rows = getSortedRecords();
    list.innerHTML = '';

    if (!rows.length) {
      list.innerHTML = '<div class="empty-state">No rows match the current filters.</div>';
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const row of rows) {
      const item = document.createElement('div');
      item.className = 'group-item';
      item.innerHTML = `
        <a href="${escapeHtml(row.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(row.name)}</a>
        <span>${escapeHtml(row.members || 'N/A')} members • ${escapeHtml(row.lastActive || 'N/A')}</span>
        <span>${escapeHtml(row.privacy || 'Privacy unknown')}${row.joinStatus ? ` • ${escapeHtml(row.joinStatus)}` : ''}</span>
      `;
      fragment.appendChild(item);
    }
    list.appendChild(fragment);
  }

  function formatRecordsForExport(records, format) {
    if (format === 'json') {
      return JSON.stringify({
        exportedAt: new Date().toISOString(),
        total: records.length,
        groups: records
      }, null, 2);
    }

    const header = ['Group Name', 'Members', 'Members Num', 'Last Active', 'Privacy', 'Join Status', 'URL', 'Source URL', 'Scanned At'];
    const rows = [header, ...records.map((row) => [
      row.name,
      row.members,
      row.membersNum,
      row.lastActive,
      row.privacy,
      row.joinStatus,
      row.url,
      row.sourceUrl,
      new Date(row.scannedAt).toLocaleString()
    ])];

    const esc = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    return '\uFEFF' + rows.map((row) => row.map(esc).join(',')).join('\n');
  }

  function downloadData(data, format) {
    const mime = format === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8';
    const blob = new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `fb-groups-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return 'Copied to clipboard.';
    } catch {
      try {
        if (typeof GM_setClipboard === 'function') {
          GM_setClipboard(text);
          return 'Copied with GM_setClipboard.';
        }
      } catch {
        // ignore
      }

      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
      return 'Copied with execCommand fallback.';
    }
  }

  function applyPanelState() {
    const panel = panelEl();
    if (!panel) return;

    panel.classList.toggle('dark', state.ui.theme === 'dark');
    panel.classList.toggle('light', state.ui.theme === 'light');
    panel.classList.toggle('minimized', !!state.ui.minimized);
    panel.style.right = `${Math.max(0, state.ui.right)}px`;
    panel.style.bottom = `${Math.max(0, state.ui.bottom)}px`;
    panel.style.width = `${Math.max(300, state.ui.width || DEFAULT_UI.width)}px`;
    if (state.ui.height) panel.style.height = `${Math.max(160, state.ui.height)}px`;

    const themeButton = document.getElementById('fb-groups-scraper-theme');
    if (themeButton) themeButton.textContent = state.ui.theme === 'dark' ? '🌙' : '☀️';
  }

  function syncInputsFromState() {
    const bind = (id, value, prop = 'value') => {
      const el = document.getElementById(id);
      if (el) el[prop] = value;
    };

    bind('fb-groups-scraper-format', state.settings.exportFormat);
    bind('fb-groups-scraper-minmembers', String(state.settings.minMembers || 0));
    bind('fb-groups-scraper-activity', state.settings.activityThreshold || '');
    bind('fb-groups-scraper-autoduration', String(state.settings.autoscanDurationSec));
    bind('fb-groups-scraper-autointerval', String(state.settings.autoscanIntervalMs));
    bind('fb-groups-scraper-showprogress', !!state.settings.showProgress, 'checked');
    bind('fb-groups-scraper-showlist', !!state.settings.showList, 'checked');
    bind('fb-groups-scraper-persist', !!state.settings.persistResults, 'checked');
    bind('fb-groups-scraper-liveobserve', !!state.settings.liveObserve, 'checked');
    bind('fb-groups-scraper-sort', state.settings.sortBy || 'membersDesc');
    bind('fb-groups-scraper-filter', state.settings.listFilter || '');

    updateProgress();
    updateList();
  }

  function addStyles() {
    GM_addStyle(`
      #fb-groups-scraper-panel {
        position: fixed;
        right: 12px;
        bottom: 12px;
        z-index: 2147483647;
        width: min(380px, 92vw);
        max-width: 92vw;
        max-height: 82vh;
        min-width: 300px;
        min-height: 160px;
        resize: both;
        overflow: hidden;
        border-radius: 16px;
        box-shadow: 0 10px 34px rgba(0,0,0,.35);
        font: 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        background: var(--bg);
        color: var(--text);
        border: 1px solid var(--border);
      }

      #fb-groups-scraper-panel.minimized {
        height: 46px !important;
        min-height: 46px !important;
        resize: none;
      }
      #fb-groups-scraper-panel.minimized #fb-groups-scraper-body {
        display: none;
      }

      #fb-groups-scraper-panel.dark {
        --bg: #1d1f23;
        --bg2: #24272d;
        --bg3: #121417;
        --text: #eceff4;
        --muted: #aab2bf;
        --border: #353b45;
        --btn: #2c313a;
        --btn-hover: #373d48;
        --accent: #4caf50;
        --link: #7ab8ff;
      }

      #fb-groups-scraper-panel.light {
        --bg: #ffffff;
        --bg2: #f5f7fa;
        --bg3: #eef2f6;
        --text: #101418;
        --muted: #5c6773;
        --border: #d8dfe7;
        --btn: #f2f4f7;
        --btn-hover: #e6ebf1;
        --accent: #2e7d32;
        --link: #005fcc;
      }

      #fb-groups-scraper-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 12px;
        background: var(--bg3);
        border-bottom: 1px solid var(--border);
        user-select: none;
        cursor: move;
      }

      #fb-groups-scraper-header .title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 700;
      }

      #fb-groups-scraper-header .pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 28px;
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--bg2);
        border: 1px solid var(--border);
        font-variant-numeric: tabular-nums;
      }

      #fb-groups-scraper-header .controls {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      #fb-groups-scraper-header button,
      #fb-groups-scraper-body button,
      #fb-groups-scraper-body select,
      #fb-groups-scraper-body input {
        font: inherit;
      }

      #fb-groups-scraper-header button {
        border: 1px solid transparent;
        background: transparent;
        color: var(--muted);
        border-radius: 10px;
        padding: 6px 8px;
        cursor: pointer;
      }
      #fb-groups-scraper-header button:hover {
        background: var(--btn-hover);
        color: var(--text);
      }

      #fb-groups-scraper-body {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 12px;
        max-height: calc(82vh - 46px);
        overflow: auto;
        -webkit-overflow-scrolling: touch;
      }

      #fb-groups-scraper-body .section {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      #fb-groups-scraper-body .button-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      #fb-groups-scraper-body .button-grid button,
      #fb-groups-scraper-body .field-row input,
      #fb-groups-scraper-body .field-row select {
        border: 1px solid var(--border);
        border-radius: 10px;
        background: var(--btn);
        color: var(--text);
        padding: 10px;
      }

      #fb-groups-scraper-body .button-grid button {
        cursor: pointer;
      }
      #fb-groups-scraper-body .button-grid button:hover,
      #fb-groups-scraper-body .field-row input:hover,
      #fb-groups-scraper-body .field-row select:hover {
        background: var(--btn-hover);
      }

      #fb-groups-scraper-body .field-row {
        display: grid;
        grid-template-columns: minmax(110px, 120px) minmax(0, 1fr);
        align-items: center;
        gap: 8px;
      }

      #fb-groups-scraper-body .field-row label {
        color: var(--muted);
      }

      #fb-groups-scraper-body .toggle-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px 12px;
      }

      #fb-groups-scraper-body .toggle {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: var(--muted);
      }

      #fb-groups-scraper-body .toggle input {
        accent-color: var(--accent);
      }

      #fb-groups-scraper-body .progress-wrap {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      #fb-groups-scraper-body .progress-meta {
        display: flex;
        justify-content: space-between;
        color: var(--muted);
        font-size: 12px;
      }

      #fb-groups-scraper-body .progress-bar {
        display: none;
        width: 100%;
        height: 8px;
        border-radius: 999px;
        background: var(--bg3);
        overflow: hidden;
        border: 1px solid var(--border);
      }
      #fb-groups-scraper-body .progress-bar.visible {
        display: block;
      }
      #fb-groups-scraper-body .progress-bar .fill {
        height: 100%;
        width: 0%;
        background: var(--accent);
        transition: width .2s ease;
      }

      #fb-groups-scraper-body .list-container {
        display: none;
        gap: 8px;
      }
      #fb-groups-scraper-body .list-container.visible {
        display: flex;
        flex-direction: column;
      }

      #fb-groups-scraper-body .list {
        max-height: 280px;
        overflow: auto;
        border-radius: 12px;
        border: 1px solid var(--border);
        background: var(--bg2);
      }

      #fb-groups-scraper-body .group-item {
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 10px;
      }
      #fb-groups-scraper-body .group-item + .group-item {
        border-top: 1px solid var(--border);
      }
      #fb-groups-scraper-body .group-item a {
        color: var(--link);
        text-decoration: none;
        font-weight: 700;
      }
      #fb-groups-scraper-body .group-item a:hover {
        text-decoration: underline;
      }
      #fb-groups-scraper-body .group-item span,
      #fb-groups-scraper-body .empty-state,
      #fb-groups-scraper-status {
        color: var(--muted);
        font-size: 12px;
      }
      #fb-groups-scraper-body .empty-state {
        padding: 12px;
      }

      #fb-groups-scraper-status {
        text-align: center;
        min-height: 16px;
      }
    `);
  }

  function createPanel() {
    const panel = document.createElement('div');
    panel.id = 'fb-groups-scraper-panel';
    panel.innerHTML = `
      <div id="fb-groups-scraper-header">
        <div class="title">
          <span aria-hidden="true">📊</span>
          <span>Groups Exporter</span>
          <span class="pill" id="fb-groups-scraper-count">0</span>
        </div>
        <div class="controls">
          <button id="fb-groups-scraper-theme" type="button" title="Toggle theme">🌙</button>
          <button id="fb-groups-scraper-minimize" type="button" title="Minimize">▁</button>
          <button id="fb-groups-scraper-close" type="button" title="Close">✕</button>
        </div>
      </div>

      <div id="fb-groups-scraper-body">
        <div class="section button-grid">
          <button id="fb-groups-scraper-scan" type="button">🔍 Scan Visible</button>
          <button id="fb-groups-scraper-autoscan" type="button">🤖 Auto-Scan (${state.settings.autoscanDurationSec}s)</button>
          <button id="fb-groups-scraper-export" type="button">📤 Export</button>
          <button id="fb-groups-scraper-copy" type="button">📋 Copy</button>
          <button id="fb-groups-scraper-clear" type="button">🗑️ Clear</button>
          <button id="fb-groups-scraper-rescan" type="button">♻️ Rebuild List</button>
        </div>

        <div class="section">
          <div class="field-row">
            <label for="fb-groups-scraper-format">Format</label>
            <select id="fb-groups-scraper-format">
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </select>
          </div>
          <div class="field-row">
            <label for="fb-groups-scraper-minmembers">Min members</label>
            <input id="fb-groups-scraper-minmembers" type="number" min="0" step="1" inputmode="numeric" placeholder="0" />
          </div>
          <div class="field-row">
            <label for="fb-groups-scraper-activity">Active within</label>
            <input id="fb-groups-scraper-activity" type="text" placeholder="e.g. 1 day, 2 weeks" />
          </div>
          <div class="field-row">
            <label for="fb-groups-scraper-autoduration">Auto duration</label>
            <input id="fb-groups-scraper-autoduration" type="number" min="10" step="10" inputmode="numeric" placeholder="120" />
          </div>
          <div class="field-row">
            <label for="fb-groups-scraper-autointerval">Scroll interval</label>
            <input id="fb-groups-scraper-autointerval" type="number" min="500" step="100" inputmode="numeric" placeholder="1500" />
          </div>
          <div class="field-row">
            <label for="fb-groups-scraper-sort">Sort list</label>
            <select id="fb-groups-scraper-sort">
              <option value="membersDesc">Members ↓</option>
              <option value="membersAsc">Members ↑</option>
              <option value="nameAsc">Name A-Z</option>
              <option value="newest">Newest scan</option>
            </select>
          </div>
          <div class="field-row">
            <label for="fb-groups-scraper-filter">List filter</label>
            <input id="fb-groups-scraper-filter" type="text" placeholder="Filter name, URL, privacy..." />
          </div>
        </div>

        <div class="section toggle-grid">
          <label class="toggle"><input id="fb-groups-scraper-showprogress" type="checkbox" /> <span>Show progress</span></label>
          <label class="toggle"><input id="fb-groups-scraper-showlist" type="checkbox" /> <span>Show list</span></label>
          <label class="toggle"><input id="fb-groups-scraper-persist" type="checkbox" /> <span>Persist results</span></label>
          <label class="toggle"><input id="fb-groups-scraper-liveobserve" type="checkbox" /> <span>Live observe</span></label>
        </div>

        <div class="section progress-wrap">
          <div class="progress-meta">
            <span>Capacity</span>
            <span id="fb-groups-scraper-progress-label">0 / ${state.settings.maxItems}</span>
          </div>
          <div class="progress-bar"><div class="fill"></div></div>
        </div>

        <div class="section list-container">
          <div class="list" id="fb-groups-scraper-list"></div>
        </div>

        <div id="fb-groups-scraper-status">Ready.</div>
      </div>
    `;

    document.body.appendChild(panel);
  }

  function bind(target, event, handler, options) {
    target.addEventListener(event, handler, options);
    state.cleanupFns.push(() => target.removeEventListener(event, handler, options));
  }

  function attachPanelEvents() {
    const panel = panelEl();
    const header = document.getElementById('fb-groups-scraper-header');
    if (!panel || !header) return;

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startRight = 0;
    let startBottom = 0;

    bind(header, 'pointerdown', (event) => {
      if (event.target.closest('button')) return;
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      const rect = panel.getBoundingClientRect();
      startRight = Math.max(0, window.innerWidth - rect.right);
      startBottom = Math.max(0, window.innerHeight - rect.bottom);
      try { header.setPointerCapture(event.pointerId); } catch {}
      event.preventDefault();
    });

    bind(document, 'pointermove', (event) => {
      if (!dragging) return;
      const nextRight = Math.max(0, startRight - (event.clientX - startX));
      const nextBottom = Math.max(0, startBottom - (event.clientY - startY));
      panel.style.right = `${nextRight}px`;
      panel.style.bottom = `${nextBottom}px`;
      state.ui.right = nextRight;
      state.ui.bottom = nextBottom;
    });

    bind(document, 'pointerup', () => {
      if (!dragging) return;
      dragging = false;
      saveUI();
    });

    const resizeObserver = new ResizeObserver(() => {
      const rect = panel.getBoundingClientRect();
      state.ui.width = Math.round(rect.width);
      state.ui.height = panel.classList.contains('minimized') ? state.ui.height : Math.round(rect.height);
      saveUI();
    });
    resizeObserver.observe(panel);
    state.cleanupFns.push(() => resizeObserver.disconnect());

    bind(document.getElementById('fb-groups-scraper-scan'), 'click', () => scanPage('manual'));

    bind(document.getElementById('fb-groups-scraper-rescan'), 'click', () => {
      const snapshot = Array.from(state.items.values());
      state.items.clear();
      for (const row of snapshot) state.items.set(row.key, row);
      scanPage('rebuild');
      updateCount();
      updateProgress();
      updateList();
      saveData();
      setStatus(`List rebuilt. ${state.items.size} groups in memory.`);
    });

    bind(document.getElementById('fb-groups-scraper-autoscan'), 'click', () => {
      if (state.autoscanTimer) stopAutoscan(false);
      else startAutoscan();
    });

    bind(document.getElementById('fb-groups-scraper-export'), 'click', () => {
      const records = getSortedRecords();
      const output = formatRecordsForExport(records, state.settings.exportFormat);
      downloadData(output, state.settings.exportFormat);
      setStatus(`Exported ${records.length} groups as ${state.settings.exportFormat.toUpperCase()}.`);
    });

    bind(document.getElementById('fb-groups-scraper-copy'), 'click', async () => {
      const records = getSortedRecords();
      const output = formatRecordsForExport(records, state.settings.exportFormat);
      const message = await copyText(output);
      setStatus(`${message} ${records.length} groups copied.`);
    });

    bind(document.getElementById('fb-groups-scraper-clear'), 'click', () => {
      if (!confirm('Clear all collected groups?')) return;
      state.items.clear();
      saveData();
      updateCount();
      updateProgress();
      updateList();
      setStatus('Collected rows cleared. Humanity remains cluttered.');
    });

    bind(document.getElementById('fb-groups-scraper-theme'), 'click', () => {
      state.ui.theme = state.ui.theme === 'dark' ? 'light' : 'dark';
      applyPanelState();
      saveUI();
    });

    bind(document.getElementById('fb-groups-scraper-minimize'), 'click', () => {
      state.ui.minimized = !state.ui.minimized;
      applyPanelState();
      saveUI();
    });

    bind(document.getElementById('fb-groups-scraper-close'), 'click', destroy);

    bind(document.getElementById('fb-groups-scraper-format'), 'change', (event) => {
      state.settings.exportFormat = event.target.value;
      saveSettings();
    });

    bind(document.getElementById('fb-groups-scraper-minmembers'), 'change', (event) => {
      state.settings.minMembers = Math.max(0, parseInt(event.target.value || '0', 10) || 0);
      saveSettings();
      scheduleScan('filter-change', 100);
    });

    bind(document.getElementById('fb-groups-scraper-activity'), 'change', (event) => {
      state.settings.activityThreshold = cleanText(event.target.value || '');
      saveSettings();
      updateList();
    });

    bind(document.getElementById('fb-groups-scraper-autoduration'), 'change', (event) => {
      state.settings.autoscanDurationSec = Math.max(10, parseInt(event.target.value || '120', 10) || 120);
      saveSettings();
      document.getElementById('fb-groups-scraper-autoscan').textContent = `🤖 Auto-Scan (${state.settings.autoscanDurationSec}s)`;
    });

    bind(document.getElementById('fb-groups-scraper-autointerval'), 'change', (event) => {
      state.settings.autoscanIntervalMs = Math.max(500, parseInt(event.target.value || '1500', 10) || 1500);
      saveSettings();
    });

    bind(document.getElementById('fb-groups-scraper-showprogress'), 'change', (event) => {
      state.settings.showProgress = !!event.target.checked;
      saveSettings();
      updateProgress();
    });

    bind(document.getElementById('fb-groups-scraper-showlist'), 'change', (event) => {
      state.settings.showList = !!event.target.checked;
      saveSettings();
      updateList();
    });

    bind(document.getElementById('fb-groups-scraper-persist'), 'change', (event) => {
      state.settings.persistResults = !!event.target.checked;
      saveSettings();
      saveData();
    });

    bind(document.getElementById('fb-groups-scraper-liveobserve'), 'change', (event) => {
      state.settings.liveObserve = !!event.target.checked;
      saveSettings();
      if (state.settings.liveObserve) startObserver();
      else if (!state.isScanning) stopObserver();
    });

    bind(document.getElementById('fb-groups-scraper-sort'), 'change', (event) => {
      state.settings.sortBy = event.target.value;
      saveSettings();
      updateList();
    });

    bind(document.getElementById('fb-groups-scraper-filter'), 'input', (event) => {
      state.settings.listFilter = event.target.value || '';
      saveSettings();
      updateList();
    });

    bind(document, 'keydown', (event) => {
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!event.ctrlKey && !event.metaKey) return;

      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        scanPage('hotkey');
      } else if (key === 'a') {
        event.preventDefault();
        if (state.autoscanTimer) stopAutoscan(false); else startAutoscan();
      } else if (key === 'e') {
        event.preventDefault();
        document.getElementById('fb-groups-scraper-export')?.click();
      }
    });
  }

  function destroy() {
    state.destroyed = true;
    clearInterval(state.autoscanTimer);
    clearTimeout(state.scanDebounceTimer);
    stopObserver();
    for (const fn of state.cleanupFns.splice(0)) {
      try { fn(); } catch {}
    }
    panelEl()?.remove();
  }

  function init() {
    if (panelEl()) return;
    loadState();
    addStyles();
    createPanel();
    attachPanelEvents();
    applyPanelState();
    syncInputsFromState();
    updateCount();
    updateProgress();
    updateList();

    if (state.settings.liveObserve) startObserver();
    setStatus('Initialized. Scan visible groups or let autoscan do the scrolling labor.');

    if (state.settings.autoStart) startAutoscan();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
