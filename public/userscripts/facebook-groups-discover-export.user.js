// ==UserScript==
// @name         Facebook Groups → CSV Exporter (Revised UI + Smarter Scan)
// @namespace    devskits916.fb.groups.csv
// @version      2.0.0
// @description  Scan Facebook group listings, keep results across reloads, and export/copy clean CSV with a better floating UI.
// @author       Calder
// @match        https://www.facebook.com/*groups*
// @match        https://m.facebook.com/*groups*
// @match        https://mbasic.facebook.com/*groups*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'devskits.fb.groups.csv.v2';
  const PREFS_KEY = 'devskits.fb.groups.csv.ui.v2';
  const PANEL_ID = 'devskits-fb-groups-csv-panel';
  const STYLE_ID = 'devskits-fb-groups-csv-style';
  const MAX_PREVIEW_ROWS = 8;

  const state = {
    items: new Map(),
    recentKeys: [],
    autoscanTimer: null,
    autoscanUntil: 0,
    observerDebounce: null,
    saveDebounce: null,
    lastScanAt: 0,
    prefs: {
      right: 16,
      bottom: 16,
      collapsed: false,
      duration: 30,
      opacity: 0.98
    }
  };

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        width: 360px;
        color: #edf2f7;
        background: rgba(13, 17, 23, var(--fbcsv-opacity, 0.98));
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 16px;
        box-shadow: 0 18px 50px rgba(0,0,0,0.45);
        overflow: hidden;
        backdrop-filter: blur(14px);
        font: 13px/1.35 Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${PANEL_ID} * { box-sizing: border-box; }
      #${PANEL_ID}.collapsed .fbcsv-body,
      #${PANEL_ID}.collapsed .fbcsv-footer { display: none; }
      #${PANEL_ID} .fbcsv-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 12px 12px 10px;
        background: linear-gradient(180deg, rgba(88, 166, 255, 0.16), rgba(88, 166, 255, 0.03));
        cursor: move;
        user-select: none;
      }
      #${PANEL_ID} .fbcsv-title-wrap { min-width: 0; }
      #${PANEL_ID} .fbcsv-title {
        font-weight: 800;
        letter-spacing: 0.2px;
        font-size: 14px;
      }
      #${PANEL_ID} .fbcsv-subtitle {
        color: #9da7b3;
        font-size: 11px;
        margin-top: 2px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #${PANEL_ID} .fbcsv-header-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
      }
      #${PANEL_ID} .fbcsv-chip,
      #${PANEL_ID} .fbcsv-icon-btn,
      #${PANEL_ID} .fbcsv-btn,
      #${PANEL_ID} .fbcsv-select {
        border: 1px solid rgba(255,255,255,0.1);
        background: rgba(255,255,255,0.06);
        color: #edf2f7;
        border-radius: 10px;
      }
      #${PANEL_ID} .fbcsv-chip {
        padding: 5px 8px;
        font-weight: 700;
        min-width: 44px;
        text-align: center;
      }
      #${PANEL_ID} .fbcsv-icon-btn {
        width: 32px;
        height: 32px;
        display: grid;
        place-items: center;
        cursor: pointer;
        font-size: 16px;
      }
      #${PANEL_ID} .fbcsv-body {
        padding: 12px;
        display: grid;
        gap: 10px;
      }
      #${PANEL_ID} .fbcsv-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      #${PANEL_ID} .fbcsv-stat {
        background: rgba(255,255,255,0.045);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 12px;
        padding: 8px;
      }
      #${PANEL_ID} .fbcsv-stat-label {
        color: #9da7b3;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        margin-bottom: 4px;
      }
      #${PANEL_ID} .fbcsv-stat-value {
        font-size: 16px;
        font-weight: 800;
      }
      #${PANEL_ID} .fbcsv-controls {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      #${PANEL_ID} .fbcsv-btn,
      #${PANEL_ID} .fbcsv-select {
        min-height: 38px;
        padding: 9px 10px;
        outline: none;
      }
      #${PANEL_ID} .fbcsv-btn {
        cursor: pointer;
        font-weight: 700;
        transition: transform 0.08s ease, background 0.12s ease, border-color 0.12s ease;
      }
      #${PANEL_ID} .fbcsv-btn:hover,
      #${PANEL_ID} .fbcsv-icon-btn:hover {
        background: rgba(255,255,255,0.1);
      }
      #${PANEL_ID} .fbcsv-btn:active,
      #${PANEL_ID} .fbcsv-icon-btn:active {
        transform: translateY(1px);
      }
      #${PANEL_ID} .fbcsv-btn.primary {
        background: linear-gradient(180deg, rgba(46, 160, 67, 0.45), rgba(46, 160, 67, 0.18));
        border-color: rgba(46, 160, 67, 0.5);
      }
      #${PANEL_ID} .fbcsv-btn.warn {
        background: linear-gradient(180deg, rgba(187, 128, 9, 0.36), rgba(187, 128, 9, 0.15));
        border-color: rgba(240, 194, 12, 0.35);
      }
      #${PANEL_ID} .fbcsv-btn.danger {
        background: linear-gradient(180deg, rgba(218, 54, 51, 0.36), rgba(218, 54, 51, 0.15));
        border-color: rgba(248, 81, 73, 0.35);
      }
      #${PANEL_ID} .fbcsv-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      #${PANEL_ID} .fbcsv-label {
        color: #9da7b3;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      #${PANEL_ID} .fbcsv-status {
        min-height: 36px;
        background: rgba(255,255,255,0.045);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 12px;
        padding: 9px 10px;
        color: #d8dee9;
        overflow-wrap: anywhere;
      }
      #${PANEL_ID} .fbcsv-preview {
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 12px;
        overflow: hidden;
      }
      #${PANEL_ID} .fbcsv-preview-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 10px;
        background: rgba(255,255,255,0.035);
        border-bottom: 1px solid rgba(255,255,255,0.06);
      }
      #${PANEL_ID} .fbcsv-preview-list {
        max-height: 180px;
        overflow: auto;
      }
      #${PANEL_ID} .fbcsv-item {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 6px 10px;
        padding: 9px 10px;
        border-bottom: 1px solid rgba(255,255,255,0.06);
      }
      #${PANEL_ID} .fbcsv-item:last-child { border-bottom: none; }
      #${PANEL_ID} .fbcsv-item-name {
        font-weight: 700;
        color: #f5f7fb;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${PANEL_ID} .fbcsv-item-meta {
        color: #98a6b8;
        font-size: 11px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${PANEL_ID} .fbcsv-item-link {
        color: #7cc1ff;
        text-decoration: none;
        font-size: 11px;
        align-self: center;
      }
      #${PANEL_ID} .fbcsv-item-link:hover { text-decoration: underline; }
      #${PANEL_ID} .fbcsv-empty {
        padding: 14px 10px;
        color: #9da7b3;
      }
      #${PANEL_ID} .fbcsv-footer {
        padding: 0 12px 12px;
        color: #7f8b99;
        font-size: 11px;
      }
    `;
    document.head.appendChild(style);
  }

  function safeParse(json, fallback) {
    try {
      return JSON.parse(json);
    } catch {
      return fallback;
    }
  }

  function loadPersisted() {
    const rawData = localStorage.getItem(STORAGE_KEY);
    const rawPrefs = localStorage.getItem(PREFS_KEY);

    const parsedData = safeParse(rawData, []);
    const parsedPrefs = safeParse(rawPrefs, null);

    if (Array.isArray(parsedData)) {
      for (const record of parsedData) {
        if (!record || !record.url) continue;
        state.items.set(groupKey(record.url), record);
      }
    }

    if (parsedPrefs && typeof parsedPrefs === 'object') {
      state.prefs = {
        ...state.prefs,
        ...parsedPrefs
      };
    }
  }

  function savePersistedSoon() {
    clearTimeout(state.saveDebounce);
    state.saveDebounce = setTimeout(() => {
      const rows = Array.from(state.items.values());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
      localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs));
    }, 180);
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;

    injectStyles();

    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.style.right = `${Math.max(0, Number(state.prefs.right) || 16)}px`;
    panel.style.bottom = `${Math.max(0, Number(state.prefs.bottom) || 16)}px`;
    panel.style.setProperty('--fbcsv-opacity', String(state.prefs.opacity || 0.98));
    if (state.prefs.collapsed) panel.classList.add('collapsed');

    panel.innerHTML = `
      <div class="fbcsv-header" id="fbcsv-drag-handle">
        <div class="fbcsv-title-wrap">
          <div class="fbcsv-title">Groups → CSV</div>
          <div class="fbcsv-subtitle" id="fbcsv-subtitle">Facebook group scraper with less duct tape</div>
        </div>
        <div class="fbcsv-header-actions">
          <div class="fbcsv-chip" id="fbcsv-count">0</div>
          <button class="fbcsv-icon-btn" id="fbcsv-collapse" title="Collapse">−</button>
        </div>
      </div>

      <div class="fbcsv-body">
        <div class="fbcsv-grid">
          <div class="fbcsv-stat">
            <div class="fbcsv-stat-label">Saved</div>
            <div class="fbcsv-stat-value" id="fbcsv-stat-total">0</div>
          </div>
          <div class="fbcsv-stat">
            <div class="fbcsv-stat-label">Last Scan</div>
            <div class="fbcsv-stat-value" id="fbcsv-stat-added">0</div>
          </div>
          <div class="fbcsv-stat">
            <div class="fbcsv-stat-label">Mode</div>
            <div class="fbcsv-stat-value" id="fbcsv-stat-mode">Idle</div>
          </div>
        </div>

        <div class="fbcsv-controls">
          <button class="fbcsv-btn" id="fbcsv-scan">Scan visible</button>
          <button class="fbcsv-btn warn" id="fbcsv-autoscan">Auto-scan</button>
          <button class="fbcsv-btn primary" id="fbcsv-export">Export CSV</button>
          <button class="fbcsv-btn" id="fbcsv-copy">Copy CSV</button>
        </div>

        <div class="fbcsv-row">
          <div class="fbcsv-label">Auto-scan duration</div>
          <select class="fbcsv-select" id="fbcsv-duration">
            <option value="15">15s</option>
            <option value="30">30s</option>
            <option value="60">60s</option>
            <option value="120">120s</option>
          </select>
        </div>

        <div class="fbcsv-controls">
          <button class="fbcsv-btn" id="fbcsv-scan-reset">Rescan page</button>
          <button class="fbcsv-btn danger" id="fbcsv-clear">Clear saved</button>
        </div>

        <div class="fbcsv-status" id="fbcsv-status">Ready. Scan whatever fresh Facebook nonsense is on screen.</div>

        <div class="fbcsv-preview">
          <div class="fbcsv-preview-head">
            <div class="fbcsv-label">Recent groups</div>
            <div id="fbcsv-preview-count">0 shown</div>
          </div>
          <div class="fbcsv-preview-list" id="fbcsv-preview-list"></div>
        </div>
      </div>

      <div class="fbcsv-footer">
        Persists results in localStorage so a reload doesn’t immediately erase your progress. Humanity still tries, though.
      </div>
    `;

    document.body.appendChild(panel);

    const durationSelect = panel.querySelector('#fbcsv-duration');
    durationSelect.value = String(state.prefs.duration || 30);

    bindPanelEvents(panel);
    refreshUI();
  }

  function bindPanelEvents(panel) {
    const dragHandle = panel.querySelector('#fbcsv-drag-handle');
    const collapseBtn = panel.querySelector('#fbcsv-collapse');
    const scanBtn = panel.querySelector('#fbcsv-scan');
    const autoscanBtn = panel.querySelector('#fbcsv-autoscan');
    const exportBtn = panel.querySelector('#fbcsv-export');
    const copyBtn = panel.querySelector('#fbcsv-copy');
    const clearBtn = panel.querySelector('#fbcsv-clear');
    const rescanBtn = panel.querySelector('#fbcsv-scan-reset');
    const durationSelect = panel.querySelector('#fbcsv-duration');

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startRight = 0;
    let startBottom = 0;

    dragHandle.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button, select, option')) return;
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      const rect = panel.getBoundingClientRect();
      startRight = Math.max(0, window.innerWidth - rect.right);
      startBottom = Math.max(0, window.innerHeight - rect.bottom);
      dragHandle.setPointerCapture?.(event.pointerId);
    });

    dragHandle.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      const nextRight = clamp(startRight - dx, 0, Math.max(0, window.innerWidth - 140));
      const nextBottom = clamp(startBottom - dy, 0, Math.max(0, window.innerHeight - 40));
      panel.style.right = `${nextRight}px`;
      panel.style.bottom = `${nextBottom}px`;
      state.prefs.right = nextRight;
      state.prefs.bottom = nextBottom;
    });

    function stopDragging() {
      if (!dragging) return;
      dragging = false;
      savePersistedSoon();
    }

    dragHandle.addEventListener('pointerup', stopDragging);
    dragHandle.addEventListener('pointercancel', stopDragging);

    collapseBtn.addEventListener('click', () => {
      state.prefs.collapsed = !state.prefs.collapsed;
      panel.classList.toggle('collapsed', state.prefs.collapsed);
      collapseBtn.textContent = state.prefs.collapsed ? '+' : '−';
      collapseBtn.title = state.prefs.collapsed ? 'Expand' : 'Collapse';
      savePersistedSoon();
    });

    scanBtn.addEventListener('click', () => {
      const added = scanPage({ allowObserverStatus: false });
      state.lastScanAt = Date.now();
      setStatus(added ? `Scan complete. Added ${added} new group${added === 1 ? '' : 's'}.` : 'Scan complete. No new groups found on the visible page.');
      refreshUI({ added, mode: 'Manual' });
    });

    rescanBtn.addEventListener('click', () => {
      const added = scanPage({ forceRefresh: true, allowObserverStatus: false });
      state.lastScanAt = Date.now();
      setStatus(added ? `Page rescanned. Refreshed data and picked up ${added} additional group${added === 1 ? '' : 's'}.` : 'Page rescanned. Existing records refreshed; nothing new found.');
      refreshUI({ added, mode: 'Refresh' });
    });

    autoscanBtn.addEventListener('click', () => {
      if (state.autoscanTimer) {
        stopAutoScan('Auto-scan stopped.');
        return;
      }
      const duration = clamp(Number(durationSelect.value) || 30, 5, 600);
      state.prefs.duration = duration;
      startAutoScan(duration);
      savePersistedSoon();
    });

    exportBtn.addEventListener('click', () => {
      const csv = toCSV();
      downloadCSV(csv);
      setStatus(`Downloaded CSV with ${state.items.size} group${state.items.size === 1 ? '' : 's'}.`);
      refreshUI();
    });

    copyBtn.addEventListener('click', async () => {
      const csv = toCSV();
      try {
        await navigator.clipboard.writeText(csv);
      } catch {
        if (typeof GM_setClipboard === 'function') GM_setClipboard(csv);
      }
      setStatus(`Copied CSV for ${state.items.size} group${state.items.size === 1 ? '' : 's'} to clipboard.`);
      refreshUI();
    });

    clearBtn.addEventListener('click', () => {
      state.items.clear();
      state.recentKeys = [];
      localStorage.removeItem(STORAGE_KEY);
      setStatus('Saved group list cleared. Fresh slate, same terrible website.');
      refreshUI({ added: 0, mode: state.autoscanTimer ? 'Auto' : 'Idle' });
    });

    durationSelect.addEventListener('change', () => {
      state.prefs.duration = clamp(Number(durationSelect.value) || 30, 5, 600);
      savePersistedSoon();
    });
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function setStatus(message) {
    const status = document.querySelector('#fbcsv-status');
    if (status) status.textContent = message;
  }

  function setMode(modeText) {
    const node = document.querySelector('#fbcsv-stat-mode');
    if (node) node.textContent = modeText;
  }

  function refreshUI({ added = null, mode = null } = {}) {
    const total = state.items.size;
    const count = document.querySelector('#fbcsv-count');
    const totalNode = document.querySelector('#fbcsv-stat-total');
    const addedNode = document.querySelector('#fbcsv-stat-added');
    const subtitle = document.querySelector('#fbcsv-subtitle');
    const previewCount = document.querySelector('#fbcsv-preview-count');
    const autoscanBtn = document.querySelector('#fbcsv-autoscan');
    const collapseBtn = document.querySelector('#fbcsv-collapse');

    if (count) count.textContent = String(total);
    if (totalNode) totalNode.textContent = String(total);
    if (addedNode) {
      addedNode.textContent = added === null ? '—' : String(added);
    }
    if (subtitle) {
      subtitle.textContent = location.pathname + location.search;
    }
    if (mode) setMode(mode);
    else setMode(state.autoscanTimer ? 'Auto' : 'Idle');

    if (autoscanBtn) {
      if (state.autoscanTimer) {
        const secondsLeft = Math.max(0, Math.ceil((state.autoscanUntil - Date.now()) / 1000));
        autoscanBtn.textContent = `Stop auto (${secondsLeft}s)`;
      } else {
        autoscanBtn.textContent = 'Auto-scan';
      }
    }

    if (collapseBtn) {
      collapseBtn.textContent = state.prefs.collapsed ? '+' : '−';
      collapseBtn.title = state.prefs.collapsed ? 'Expand' : 'Collapse';
    }

    const previewRows = getPreviewRows();
    if (previewCount) previewCount.textContent = `${previewRows.length} shown`;
    renderPreview(previewRows);
    savePersistedSoon();
  }

  function getPreviewRows() {
    const seen = new Set();
    const rows = [];

    for (const key of state.recentKeys) {
      if (seen.has(key)) continue;
      const record = state.items.get(key);
      if (!record) continue;
      rows.push(record);
      seen.add(key);
      if (rows.length >= MAX_PREVIEW_ROWS) break;
    }

    if (rows.length < MAX_PREVIEW_ROWS) {
      const remaining = Array.from(state.items.values()).reverse();
      for (const record of remaining) {
        const key = groupKey(record.url);
        if (seen.has(key)) continue;
        rows.push(record);
        seen.add(key);
        if (rows.length >= MAX_PREVIEW_ROWS) break;
      }
    }

    return rows;
  }

  function renderPreview(rows) {
    const container = document.querySelector('#fbcsv-preview-list');
    if (!container) return;

    if (!rows.length) {
      container.innerHTML = `<div class="fbcsv-empty">No groups saved yet. Hit <strong>Scan visible</strong> or <strong>Auto-scan</strong>.</div>`;
      return;
    }

    container.innerHTML = rows.map((record) => {
      const members = escapeHtml(record.members || 'No member count');
      const lastActive = escapeHtml(record.lastActive || 'No activity data');
      const name = escapeHtml(record.name || '(Unnamed group)');
      const url = escapeHtml(record.url || '#');
      return `
        <div class="fbcsv-item">
          <div>
            <div class="fbcsv-item-name" title="${name}">${name}</div>
            <div class="fbcsv-item-meta">${members} • ${lastActive}</div>
          </div>
          <a class="fbcsv-item-link" href="${url}" target="_blank" rel="noopener noreferrer">Open</a>
        </div>
      `;
    }).join('');
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function absolutize(url) {
    try {
      return new URL(url, location.origin).toString();
    } catch {
      return null;
    }
  }

  function canonicalizeGroupUrl(urlValue) {
    if (!urlValue) return null;
    try {
      const url = new URL(urlValue, location.origin);
      if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return null;

      const segments = url.pathname.split('/').filter(Boolean);
      const groupsIndex = segments.findIndex((part) => part.toLowerCase() === 'groups');
      if (groupsIndex === -1) return null;
      const slug = segments[groupsIndex + 1];
      if (!slug) return null;

      const blocked = new Set([
        'feed', 'discover', 'joins', 'create', 'browse', 'notifications', 'categories',
        'learn', 'for_sale', 'sell', 'membership_approval', 'your_groups', 'left_nav'
      ]);
      if (blocked.has(slug.toLowerCase())) return null;

      return `https://www.facebook.com/groups/${slug}/`;
    } catch {
      return null;
    }
  }

  function groupKey(canonicalUrl) {
    return String(canonicalUrl || '').replace(/^https?:\/\/[^/]+\/groups\/([^/]+)\/?$/, '$1');
  }

  function cleanText(text) {
    return String(text ?? '')
      .replace(/\u200b|\u200c|\u200d|\ufeff/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function pickCardContainer(anchor) {
    let node = anchor;
    for (let depth = 0; node && depth < 7; depth += 1) {
      const text = cleanText(node.innerText || node.textContent || '');
      if (text.length >= 20 && text.length <= 1600) return node;
      node = node.parentElement;
    }
    return anchor.parentElement || anchor;
  }

  function findMembers(text) {
    const patterns = [
      /([\d.,]+\s*[KMB]?)\s+members\b/i,
      /members\b[^\d]{0,8}([\d.,]+\s*[KMB]?)/i,
      /([\d.,]+\s*[KMB]?)\s+people\b/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) return cleanText(match[1].toUpperCase().replace(/\s+/g, ''));
    }
    return '';
  }

  function findLastActive(text) {
    const patterns = [
      /(Last active[^.·|]*?(?:ago|today|yesterday))/i,
      /(Active[^.·|]*?(?:ago|today|yesterday))/i,
      /(\d+\s+(?:new\s+)?posts?\s+(?:today|this week|a day|per day|daily))/i,
      /(\d+\s+posts?\s+a\s+day)/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) return cleanText(match[1]);
    }
    return '';
  }

  function looksBadName(text) {
    if (!text) return true;
    if (text.length < 3 || text.length > 140) return true;
    if (/^(join|joined|visit|see all|create|discover|share|like|comment|members?|public group|private group)$/i.test(text)) return true;
    if (/members?|posts?|active|today|yesterday|ago|public|private|visible|group by/i.test(text) && text.length < 40) return true;
    if (/^https?:\/\//i.test(text)) return true;
    return false;
  }

  function findHeadingLikeText(container) {
    if (!container) return '';

    const selectors = [
      'h1', 'h2', 'h3', 'strong', '[role="heading"]',
      'span[dir="auto"]', 'a[role="link"]', 'div[dir="auto"]'
    ];

    let best = '';

    for (const el of container.querySelectorAll(selectors.join(','))) {
      const text = cleanText(el.textContent || '');
      if (looksBadName(text)) continue;
      if (text.length > best.length) best = text;
    }

    return best;
  }

  function deriveGroupName(anchor, container, textBlock) {
    const candidates = [
      cleanText(anchor.getAttribute('aria-label')),
      cleanText(anchor.getAttribute('title')),
      cleanText(anchor.textContent),
      findHeadingLikeText(container),
      cleanText((textBlock || '').split(/members\b|public group|private group/i)[0])
    ].filter(Boolean);

    let best = '';
    let bestScore = -Infinity;

    for (const candidate of candidates) {
      const text = cleanText(candidate);
      if (looksBadName(text)) continue;
      const score = scoreName(text);
      if (score > bestScore) {
        best = text;
        bestScore = score;
      }
    }

    return best || cleanText(anchor.textContent) || '(Unnamed group)';
  }

  function scoreName(text) {
    let score = 0;
    if (text.length >= 4 && text.length <= 90) score += 5;
    if (/[A-Za-z]/.test(text)) score += 2;
    if (!/members?|active|posts?|public group|private group/i.test(text)) score += 4;
    if (/^[A-Z0-9][\s\S]*$/.test(text)) score += 1;
    if (/\bjoin\b/i.test(text)) score -= 5;
    if (/\bsee all\b/i.test(text)) score -= 5;
    return score;
  }

  function mergeRecord(previous, next) {
    if (!previous) return next;
    return {
      name: chooseBetterString(previous.name, next.name),
      members: chooseBetterString(previous.members, next.members),
      lastActive: chooseBetterString(previous.lastActive, next.lastActive),
      url: next.url || previous.url
    };
  }

  function chooseBetterString(a, b) {
    const left = cleanText(a);
    const right = cleanText(b);
    if (!left) return right;
    if (!right) return left;

    const leftScore = genericFieldScore(left);
    const rightScore = genericFieldScore(right);
    return rightScore >= leftScore ? right : left;
  }

  function genericFieldScore(text) {
    let score = 0;
    score += Math.min(text.length, 80) / 8;
    if (!/^\(?unnamed/i.test(text)) score += 4;
    if (/\d/.test(text)) score += 1;
    if (/members?|active|ago|today|yesterday/i.test(text)) score += 1;
    return score;
  }

  function scanPage({ forceRefresh = false, allowObserverStatus = true } = {}) {
    const anchors = Array.from(document.querySelectorAll('a[href*="/groups/"]'));
    const before = state.items.size;
    let touched = 0;

    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') || anchor.href;
      const absoluteUrl = absolutize(href);
      const canonicalUrl = canonicalizeGroupUrl(absoluteUrl);
      if (!canonicalUrl) continue;

      const key = groupKey(canonicalUrl);
      const container = pickCardContainer(anchor);
      const textBlock = cleanText(container?.innerText || container?.textContent || '');
      const record = {
        name: deriveGroupName(anchor, container, textBlock),
        members: findMembers(textBlock),
        lastActive: findLastActive(textBlock),
        url: canonicalUrl
      };

      const previous = state.items.get(key);
      if (forceRefresh || !previous) {
        state.items.set(key, mergeRecord(previous, record));
      } else {
        state.items.set(key, mergeRecord(previous, record));
      }

      touched += 1;
      state.recentKeys = [key, ...state.recentKeys.filter((existing) => existing !== key)].slice(0, 80);
    }

    const added = state.items.size - before;
    if (added > 0 || forceRefresh || touched > 0) savePersistedSoon();

    if (allowObserverStatus && added > 0) {
      setStatus(`Background scan found ${added} new group${added === 1 ? '' : 's'}.`);
      refreshUI({ added, mode: state.autoscanTimer ? 'Auto' : 'Watch' });
    }

    return added;
  }

  function startAutoScan(durationSeconds) {
    const totalMs = durationSeconds * 1000;
    state.autoscanUntil = Date.now() + totalMs;
    setStatus(`Auto-scan running for ${durationSeconds}s. Scrolling and collecting groups while Facebook pretends this is normal.`);
    refreshUI({ added: 0, mode: 'Auto' });

    const tick = () => {
      const now = Date.now();
      if (now >= state.autoscanUntil) {
        stopAutoScan(`Auto-scan finished. Saved ${state.items.size} total group${state.items.size === 1 ? '' : 's'}.`);
        return;
      }

      const step = Math.max(500, Math.floor(window.innerHeight * 0.75));
      window.scrollBy({ top: step, behavior: 'smooth' });
      const added = scanPage({ allowObserverStatus: false });
      const secondsLeft = Math.max(0, Math.ceil((state.autoscanUntil - now) / 1000));
      setStatus(`Auto-scan active. ${secondsLeft}s left. Added ${added} on last pass. Total saved: ${state.items.size}.`);
      refreshUI({ added, mode: 'Auto' });
    };

    tick();
    state.autoscanTimer = setInterval(tick, 1100);
  }

  function stopAutoScan(message) {
    if (state.autoscanTimer) {
      clearInterval(state.autoscanTimer);
      state.autoscanTimer = null;
    }
    state.autoscanUntil = 0;
    setStatus(message || 'Auto-scan stopped.');
    refreshUI({ added: 0, mode: 'Idle' });
  }

  function toCSV() {
    const header = ['Group Name', 'Member Count', 'Last Active', 'Group URL'];
    const rows = [header];

    const sorted = Array.from(state.items.values()).sort((a, b) => {
      return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
    });

    for (const record of sorted) {
      rows.push([
        record.name || '',
        record.members || '',
        record.lastActive || '',
        record.url || ''
      ]);
    }

    return '\uFEFF' + rows.map((row) => row.map(csvEscape).join(',')).join('\n');
  }

  function csvEscape(value) {
    const text = String(value ?? '');
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  function downloadCSV(csv) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const anchor = document.createElement('a');
    const pagePart = (location.pathname.split('/').filter(Boolean).slice(-1)[0] || 'groups')
      .replace(/[^a-z0-9_-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'groups';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');

    anchor.href = URL.createObjectURL(blob);
    anchor.download = `facebook-groups-${pagePart}-${stamp}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      URL.revokeObjectURL(anchor.href);
      anchor.remove();
    }, 50);
  }

  function installObserver() {
    const observer = new MutationObserver(() => {
      clearTimeout(state.observerDebounce);
      state.observerDebounce = setTimeout(() => {
        scanPage({ allowObserverStatus: true });
      }, 700);
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function init() {
    if (document.getElementById(PANEL_ID)) return;
    loadPersisted();
    createPanel();
    installObserver();
    const added = scanPage({ allowObserverStatus: false });
    setStatus(added ? `Initialized and found ${added} group${added === 1 ? '' : 's'} immediately.` : 'Initialized. Use Scan visible or Auto-scan.');
    refreshUI({ added, mode: 'Idle' });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();