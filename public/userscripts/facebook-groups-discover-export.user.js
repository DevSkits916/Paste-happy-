// ==UserScript==
// @name         Facebook Groups → CSV/JSON Exporter (Enhanced v3.1 UI Fix)
// @namespace    devskits916.fb.groups.csv
// @version      3.1.1
// @description  Advanced Facebook group discovery scraper with modern UI + FIXED panel markup/IDs (was broken), draggable/resizable panel, theme toggle, progress, filters, robust scanning, 2025 layout compatibility.
// @author       Calder
// @match        https://www.facebook.com/*groups*
// @match        https://m.facebook.com/*groups*
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // --------- State ---------
  const state = {
    items: new Map(), // key: groupKey, value: record
    autoscanTimer: null,
    autoscanEndAt: 0,
    isScanning: false,
    theme: 'dark',
    panelMinimized: false,
    settings: {
      autoStart: false,
      maxItems: 5000,
      exportFormat: 'csv',
      showProgress: true,
      showList: false,
      minMembers: 0,
      activityThreshold: '' // e.g. "1 day"
    }
  };

  // --------- Storage ---------
  function loadSettings() {
    try {
      const saved = localStorage.getItem('fb-groups-scraper-settings-v3');
      if (saved) Object.assign(state.settings, JSON.parse(saved));
    } catch (e) { console.error('Load settings error:', e); }
  }

  function saveSettings() {
    try {
      localStorage.setItem('fb-groups-scraper-settings-v3', JSON.stringify(state.settings));
    } catch (e) { console.error('Save settings error:', e); }
  }

  // --------- UI Creation (FIXED) ---------
  function createPanel() {
    const panel = document.createElement('div');
    panel.id = 'fb-groups-scraper-panel';

    // NOTE: The previous script’s UI was “broken” because it injected a bunch of raw text
    // without the IDs/classes your CSS + event hooks expect. Humans: undefeated at mismatch bugs.
    panel.innerHTML = `
      <div id="fb-groups-scraper-header">
        <div class="title">
          <span aria-hidden="true">📊</span>
          <span>Groups Exporter</span>
          <span class="pill" title="Collected groups">
            <span id="fb-groups-scraper-count">0</span>
          </span>
        </div>
        <div class="controls">
          <button id="fb-groups-scraper-theme" title="Toggle theme" type="button">🌙</button>
          <button id="fb-groups-scraper-minimize" title="Minimize" type="button">▁</button>
          <button id="fb-groups-scraper-close" title="Close" type="button">✕</button>
        </div>
      </div>

      <div id="fb-groups-scraper-body">
        <div class="section buttons">
          <button id="fb-groups-scraper-scan" type="button">🔍 Scan Visible</button>
          <button id="fb-groups-scraper-autoscan" type="button">🤖 Auto-Scan (2min)</button>
          <button id="fb-groups-scraper-export" type="button">📤 Export</button>
          <button id="fb-groups-scraper-copy" type="button">📋 Copy</button>
          <button id="fb-groups-scraper-clear" type="button">🗑️ Clear</button>
        </div>

        <div class="section filters">
          <label>
            Min members:
            <input id="fb-groups-scraper-minmembers" inputmode="numeric" type="number" min="0" step="1" placeholder="0" />
          </label>

          <label>
            Active within:
            <input id="fb-groups-scraper-activity" type="text" placeholder="e.g. 1 day / 1 week" />
          </label>

          <label>
            Format:
            <select id="fb-groups-scraper-format">
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </select>
          </label>
        </div>

        <div class="section toggles">
          <label class="toggle">
            <input id="fb-groups-scraper-showprogress" type="checkbox" />
            <span>Show progress</span>
          </label>

          <label class="toggle">
            <input id="fb-groups-scraper-showlist" type="checkbox" />
            <span>Show list</span>
          </label>
        </div>

        <div class="progress-container">
          <div class="progress-bar">
            <div class="fill"></div>
          </div>
        </div>

        <div class="list-container">
          <div class="list" id="fb-groups-scraper-list"></div>
        </div>

        <div class="status" id="fb-groups-scraper-status">Ready 🚀</div>
      </div>
    `;

    document.body.appendChild(panel);
    addStyles();
    attachEvents(panel);

    // Apply saved UI state
    panel.classList.toggle('minimized', !!state.panelMinimized);
    updateTheme();
    syncUIFromSettings();
    updateCount();
    updateProgress();
    updateList();
  }

  function addStyles() {
    GM_addStyle(`
      #fb-groups-scraper-panel {
        position: fixed;
        z-index: 999999;
        right: 12px;
        bottom: 12px;
        width: min(380px, 92vw);
        max-height: 80vh;
        background: var(--bg);
        color: var(--text);
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        border-radius: 16px;
        box-shadow: 0 8px 30px rgba(0,0,0,0.35);
        padding: 0;
        overflow: hidden;
        transition: transform 0.15s ease, opacity 0.15s ease;
        resize: both;
        min-width: 280px;
        min-height: 140px;
        touch-action: none;
      }

      #fb-groups-scraper-panel.minimized {
        height: 44px !important;
        resize: none !important;
      }
      #fb-groups-scraper-panel.minimized #fb-groups-scraper-body {
        display: none;
      }

      #fb-groups-scraper-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 14px;
        background: var(--header-bg);
        cursor: move;
        user-select: none;
        border-bottom: 1px solid var(--border);
      }

      #fb-groups-scraper-header .title {
        font-weight: 650;
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }

      #fb-groups-scraper-header .title span:nth-child(2) {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 180px;
      }

      #fb-groups-scraper-header .pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: var(--bg-secondary);
        color: var(--text);
        font-variant-numeric: tabular-nums;
      }

      #fb-groups-scraper-header .controls button {
        background: none;
        border: none;
        color: var(--text-muted);
        font-size: 18px;
        cursor: pointer;
        padding: 6px;
        margin-left: 6px;
        border-radius: 10px;
        transition: background 0.15s, color 0.15s;
      }
      #fb-groups-scraper-header .controls button:hover {
        color: var(--text);
        background: var(--btn-hover);
      }

      #fb-groups-scraper-body {
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        overflow: auto;
        max-height: calc(80vh - 44px);
        -webkit-overflow-scrolling: touch;
        touch-action: pan-y;
      }

      .section.buttons {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      .section.buttons button,
      .section.filters select,
      .section.filters input {
        padding: 10px 10px;
        border-radius: 10px;
        border: 1px solid var(--border);
        background: var(--btn-bg);
        color: var(--text);
        cursor: pointer;
        font-size: 13px;
        transition: background 0.15s, border 0.15s;
      }
      .section.buttons button:hover {
        background: var(--btn-hover);
        border-color: var(--border-hover);
      }

      .section.filters {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .section.filters label {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .section.filters input,
      .section.filters select {
        flex: 1;
        min-width: 0;
      }

      .section.toggles {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
      }
      .toggle {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: var(--text-muted);
        user-select: none;
      }
      .toggle input {
        width: 18px;
        height: 18px;
        accent-color: var(--progress-fill);
      }

      .progress-container { display: flex; flex-direction: column; gap: 6px; }
      .progress-bar {
        height: 8px;
        background: var(--progress-bg);
        border-radius: 999px;
        overflow: hidden;
        opacity: 0;
        transition: opacity 0.2s;
      }
      .progress-bar.visible { opacity: 1; }
      .progress-bar .fill {
        height: 100%;
        background: var(--progress-fill);
        width: 0%;
        transition: width 0.25s ease-out;
      }

      .list-container { display: none; flex-direction: column; gap: 6px; }
      .list-container.visible { display: flex; }
      .list {
        overflow: auto;
        max-height: 260px;
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 6px;
        background: var(--bg-secondary);
        -webkit-overflow-scrolling: touch;
      }
      .group-item {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 10px;
        border-radius: 10px;
      }
      .group-item + .group-item { border-top: 1px solid var(--border); border-top-left-radius: 0; border-top-right-radius: 0; }
      .group-item a { color: var(--link); text-decoration: none; font-weight: 600; }
      .group-item a:hover { text-decoration: underline; }
      .group-item span { font-size: 12px; color: var(--text-muted); }

      .status {
        font-size: 13px;
        color: var(--text-muted);
        min-height: 18px;
        text-align: center;
        padding-top: 2px;
      }

      /* Themes */
      #fb-groups-scraper-panel.dark {
        --bg: #1e1e1e;
        --bg-secondary: #252525;
        --header-bg: #181818;
        --text: #e7e7e7;
        --text-muted: #a7a7a7;
        --border: #343434;
        --border-hover: #4a4a4a;
        --btn-bg: #2a2a2a;
        --btn-hover: #343434;
        --progress-bg: #343434;
        --progress-fill: #4caf50;
        --link: #4da6ff;
      }
      #fb-groups-scraper-panel.light {
        --bg: #ffffff;
        --bg-secondary: #f6f6f6;
        --header-bg: #f1f1f1;
        --text: #121212;
        --text-muted: #666666;
        --border: #dddddd;
        --border-hover: #cfcfcf;
        --btn-bg: #f0f0f0;
        --btn-hover: #e7e7e7;
        --progress-bg: #e0e0e0;
        --progress-fill: #2e7d32;
        --link: #0066cc;
      }
    `);
  }

  function updateTheme() {
    const panel = document.getElementById('fb-groups-scraper-panel');
    if (!panel) return;
    panel.classList.toggle('dark', state.theme === 'dark');
    panel.classList.toggle('light', state.theme === 'light');
    const themeBtn = document.getElementById('fb-groups-scraper-theme');
    if (themeBtn) themeBtn.textContent = state.theme === 'dark' ? '🌙' : '☀️';
  }

  function syncUIFromSettings() {
    const fmt = document.getElementById('fb-groups-scraper-format');
    const mm = document.getElementById('fb-groups-scraper-minmembers');
    const act = document.getElementById('fb-groups-scraper-activity');
    const sp = document.getElementById('fb-groups-scraper-showprogress');
    const sl = document.getElementById('fb-groups-scraper-showlist');

    if (fmt) fmt.value = state.settings.exportFormat;
    if (mm) mm.value = String(state.settings.minMembers || 0);
    if (act) act.value = state.settings.activityThreshold || '';
    if (sp) sp.checked = !!state.settings.showProgress;
    if (sl) sl.checked = !!state.settings.showList;

    const pb = document.querySelector('.progress-bar');
    if (pb) pb.classList.toggle('visible', !!state.settings.showProgress);

    const lc = document.querySelector('.list-container');
    if (lc) lc.classList.toggle('visible', !!state.settings.showList);
  }

  // --------- Event Attachment ---------
  function attachEvents(panel) {
    // Drag header (fixed for mobile)
    const header = panel.querySelector('#fb-groups-scraper-header');
    let dragging = false, startX = 0, startY = 0, startRight = 0, startBottom = 0;

    header.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      startRight = window.innerWidth - rect.right;
      startBottom = window.innerHeight - rect.bottom;
      try { header.setPointerCapture(e.pointerId); } catch {}
      e.preventDefault();
    });

    document.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      panel.style.right = Math.max(0, startRight - (e.clientX - startX)) + 'px';
      panel.style.bottom = Math.max(0, startBottom - (e.clientY - startY)) + 'px';
    });

    document.addEventListener('pointerup', () => { dragging = false; });

    // Buttons
    const scanBtn = panel.querySelector('#fb-groups-scraper-scan');
    scanBtn.onclick = () => {
      const added = scanPage();
      setStatus(`Scan done: +${added} new groups (${state.items.size} total)`);
    };

    const autoscanBtn = panel.querySelector('#fb-groups-scraper-autoscan');
    autoscanBtn.onclick = () => {
      if (state.autoscanTimer) {
        clearInterval(state.autoscanTimer);
        state.autoscanTimer = null;
        state.isScanning = false;
        autoscanBtn.textContent = '🤖 Auto-Scan (2min)';
        setStatus('Auto-scan stopped');
        return;
      }
      state.autoscanEndAt = Date.now() + 120000;
      state.isScanning = true;
      setStatus('🤖 Auto-scan started (2min)...');
      autoscanBtn.textContent = '🛑 Stop Auto-Scan';
      state.autoscanTimer = setInterval(() => {
        window.scrollBy(0, window.innerHeight);
        const added = scanPage();
        if (added > 0) setStatus(`Auto-scan: +${added} (${state.items.size} total)`);
        if (Date.now() > state.autoscanEndAt || state.items.size >= state.settings.maxItems) {
          clearInterval(state.autoscanTimer);
          state.autoscanTimer = null;
          state.isScanning = false;
          autoscanBtn.textContent = '🤖 Auto-Scan (2min)';
          setStatus(`Auto-scan finished: ${state.items.size} groups`);
        }
      }, 2000);
    };

    panel.querySelector('#fb-groups-scraper-export').onclick = () => {
      const data = exportData(state.settings.exportFormat);
      downloadData(data, state.settings.exportFormat);
      setStatus(`Exported ${state.items.size} groups`);
    };

    panel.querySelector('#fb-groups-scraper-copy').onclick = async () => {
      const data = exportData(state.settings.exportFormat);
      try {
        await navigator.clipboard.writeText(data);
        setStatus('Copied to clipboard!');
      } catch {
        if (typeof GM_setClipboard === 'function') GM_setClipboard(data);
        setStatus('Copied via GM!');
      }
    };

    panel.querySelector('#fb-groups-scraper-clear').onclick = () => {
      if (confirm('Clear all collected groups?')) {
        state.items.clear();
        updateCount();
        updateProgress();
        updateList();
        setStatus('Data cleared');
      }
    };

    panel.querySelector('#fb-groups-scraper-theme').onclick = () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      updateTheme();
    };

    panel.querySelector('#fb-groups-scraper-minimize').onclick = () => {
      state.panelMinimized = !state.panelMinimized;
      panel.classList.toggle('minimized', state.panelMinimized);
    };

    panel.querySelector('#fb-groups-scraper-close').onclick = () => panel.remove();

    // Settings bindings
    panel.querySelector('#fb-groups-scraper-format').onchange = (e) => {
      state.settings.exportFormat = e.target.value;
      saveSettings();
    };

    panel.querySelector('#fb-groups-scraper-minmembers').onchange = (e) => {
      state.settings.minMembers = parseInt(e.target.value, 10) || 0;
      saveSettings();
    };

    panel.querySelector('#fb-groups-scraper-activity').onchange = (e) => {
      state.settings.activityThreshold = (e.target.value || '').trim();
      saveSettings();
    };

    panel.querySelector('#fb-groups-scraper-showprogress').onchange = (e) => {
      state.settings.showProgress = e.target.checked;
      const pb = document.querySelector('.progress-bar');
      if (pb) pb.classList.toggle('visible', e.target.checked);
      saveSettings();
    };

    panel.querySelector('#fb-groups-scraper-showlist').onchange = (e) => {
      state.settings.showList = e.target.checked;
      const lc = document.querySelector('.list-container');
      if (lc) lc.classList.toggle('visible', e.target.checked);
      saveSettings();
      updateList();
    };

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 's': e.preventDefault(); scanBtn.click(); break;
          case 'a': e.preventDefault(); autoscanBtn.click(); break;
          case 'e': e.preventDefault(); panel.querySelector('#fb-groups-scraper-export').click(); break;
        }
      }
    });
  }

  function setStatus(msg) {
    const el = document.getElementById('fb-groups-scraper-status');
    if (el) el.textContent = msg;
  }

  function updateCount() {
    const el = document.getElementById('fb-groups-scraper-count');
    if (el) el.textContent = state.items.size.toLocaleString();
  }

  function updateProgress() {
    const pct = Math.min(100, (state.items.size / state.settings.maxItems) * 100);
    const fill = document.querySelector('.progress-bar .fill');
    if (fill) fill.style.width = pct + '%';
    if (state.items.size >= state.settings.maxItems) setStatus(`Max limit (${state.settings.maxItems}) reached!`);
  }

  function updateList() {
    const listEl = document.getElementById('fb-groups-scraper-list');
    const container = document.querySelector('.list-container');
    if (!listEl || !container) return;

    if (!state.settings.showList) {
      listEl.innerHTML = '';
      return;
    }

    listEl.innerHTML = '';
    const sorted = Array.from(state.items.values()).sort((a, b) => b.membersNum - a.membersNum);

    for (const rec of sorted) {
      const item = document.createElement('div');
      item.className = 'group-item';
      item.innerHTML = `
        <a href="${escapeHtml(rec.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(rec.name)}</a>
        <span>${escapeHtml(rec.members || 'N/A')} members • ${escapeHtml(rec.lastActive || 'N/A')}</span>
      `;
      listEl.appendChild(item);
    }
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --------- Time Parsing ---------
  function parseTimeAgo(str) {
    if (!str) return Infinity;
    const m = str.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago?/i);
    if (!m) return Infinity;
    const num = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    switch (unit) {
      case 'second': return num;
      case 'minute': return num * 60;
      case 'hour': return num * 3600;
      case 'day': return num * 86400;
      case 'week': return num * 604800;
      case 'month': return num * 2592000;
      case 'year': return num * 31536000;
      default: return Infinity;
    }
  }

  function isRecentEnough(lastActive, threshold) {
    if (!threshold) return true;
    const threshSeconds = parseTimeAgo((threshold || '').trim() + ' ago');
    const activeSeconds = parseTimeAgo((lastActive || '').trim() + ' ago');
    return activeSeconds <= threshSeconds;
  }

  // --------- Robust Scanning (2025 compatible) ---------
  function scanPage() {
    let added = 0;
    const linkSelectors = [
      'a[href*="/groups/"]:not([href*="feed"]):not([href*="joins"]):not([href*="discover"]):not([href*="create"]):not([href*="requests"])',
      'a[role="link"][href*="/groups/"]'
    ];

    const anchors = new Set();
    linkSelectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((a) => anchors.add(a));
    });

    for (const a of anchors) {
      const href = a.getAttribute('href');
      if (!href) continue;

      const abs = absolutize(href);
      if (!abs) continue;

      const canonical = canonicalizeGroupUrl(abs);
      if (!canonical) continue;

      const key = groupKey(canonical);
      if (state.items.has(key)) continue;

      const container =
        a.closest('div[role="article"], div[data-pagelet], div.x1lliihq, div.x1y1aw1k, div.x78zum5, div.x1n2onr6') ||
        a.closest('div') ||
        a.parentElement;
      if (!container) continue;

      const textBlock = container.innerText || '';

      let name =
        a.querySelector('span[dir="auto"]')?.innerText?.trim() ||
        cleanText(a.innerText) ||
        findBestName(container);

      if (!name || name.length < 3) continue;

      const membersStr = findMembers(textBlock);
      const membersNum = parseMembers(membersStr);

      if (membersNum < state.settings.minMembers) continue;

      const lastActive = findLastActive(textBlock);
      if (!isRecentEnough(lastActive, state.settings.activityThreshold)) continue;

      const record = {
        name,
        members: membersStr || '',
        membersNum,
        lastActive: lastActive || '',
        url: canonical,
        timestamp: new Date().toISOString()
      };

      state.items.set(key, record);
      added++;
    }

    if (added > 0) {
      updateCount();
      updateProgress();
      updateList();
    }
    return added;
  }

  function parseMembers(str) {
    if (!str) return 0;
    const m = str.match(/([\d,.]+)([KkMm]?)/);
    if (!m) return 0;
    let num = parseFloat(m[1].replace(/,/g, ''));
    const suffix = (m[2] || '').toLowerCase();
    if (suffix === 'k') num *= 1000;
    if (suffix === 'm') num *= 1000000;
    return num;
  }

  function findBestName(container) {
    const candidates = container.querySelectorAll('span, div, strong, h3');
    let best = '';
    for (const el of candidates) {
      const t = cleanText(el.innerText);
      if (t.length > best.length && t.length < 150 && !/(members|posts|active|joined)/i.test(t)) {
        best = t;
      }
    }
    return best;
  }

  // Helpers
  function absolutize(u) {
    try { return new URL(u, location.href).href; } catch { return null; }
  }

  function canonicalizeGroupUrl(u) {
    try {
      const url = new URL(u);
      if (!url.hostname.endsWith('facebook.com')) return null;
      const match = url.pathname.match(/\/groups\/([^/?]+)/);
      return match ? `${url.origin}/groups/${match[1]}` : null;
    } catch { return null; }
  }

  function groupKey(url) {
    return url.split('/groups/')[1];
  }

  function cleanText(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }

  function findMembers(text) {
    const regex = /([\d,.]+[KkMm]?)\s*members?/i;
    const m = (text || '').match(regex);
    return m ? m[1].trim() : null;
  }

  function findLastActive(text) {
    const patterns = [
      /active\s*([\d\w\s]+?)\s*ago/i,
      /last\s*active\s*([\d\w\s]+?)\s*ago/i,
      /([\d\w\s]+?)\s*(hour|day|week|month|year)s?\s*ago/i
    ];
    for (const pat of patterns) {
      const m = (text || '').match(pat);
      if (m) return cleanText(m[1] || m[0]);
    }
    return null;
  }

  // --------- Export ---------
  function exportData(format) {
    const sorted = Array.from(state.items.values()).sort((a, b) => b.membersNum - a.membersNum);

    const rows = [['Group Name', 'Members', 'Last Active', 'URL', 'Scanned At']];
    for (const rec of sorted) {
      rows.push([rec.name, rec.members, rec.lastActive, rec.url, new Date(rec.timestamp).toLocaleString()]);
    }

    if (format === 'csv') {
      const esc = (v) => `"${String(v || '').replace(/"/g, '""')}"`;
      return '\uFEFF' + rows.map((r) => r.map(esc).join(',')).join('\n');
    }

    return JSON.stringify(
      { exportedAt: new Date().toISOString(), total: sorted.length, groups: sorted },
      null,
      2
    );
  }

  function downloadData(data, format) {
    const blob = new Blob([data], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fb-groups-${format}-${new Date().toISOString().slice(0, 10)}.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // --------- Init ---------
  function init() {
    if (document.getElementById('fb-groups-scraper-panel')) return;
    loadSettings();
    createPanel();
    setStatus('Initialized! Scan or Auto-Scan. Shortcuts: Ctrl+S/A/E');
    if (state.settings.autoStart) {
      document.querySelector('#fb-groups-scraper-autoscan')?.click();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
