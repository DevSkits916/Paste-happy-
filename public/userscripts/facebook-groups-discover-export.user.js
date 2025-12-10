// ==UserScript==
// @name         Facebook Groups → CSV Exporter (2025-12-06)
// @namespace    devskits916.fb.groups.csv
// @version      2.0.0
// @description  Scan Facebook group listings and export to CSV. Features: debounced scanning, duplicate detection, data persistence, dynamic UI updates, error recovery, mobile support.
// @author       Calder
// @match        https://www.facebook.com/*groups*
// @match        https://m.facebook.com/*groups*
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @run-at       document-idle
// ==/UserScript==

(function() {
  'use strict';

  // --------- CONFIG ---------
  const CONFIG = {
    STORAGE_KEY: 'fbGroupsCSV_data',
    AUTO_SCAN_DURATION: 30000,
    SCAN_DEBOUNCE_MS: 300,
    MUTATION_OBSERVER_THROTTLE: 800,
    MAX_STORAGE_SIZE: 50000, // chars before cleanup
    LOG_LEVEL: 'info', // 'debug', 'info', 'warn', 'error'
  };

  // --------- LOGGER ---------
  const logger = {
    debug: (msg, data) => CONFIG.LOG_LEVEL === 'debug' && console.log(`[FB-CSV] ${msg}`, data || ''),
    info: (msg, data) => ['info', 'debug'].includes(CONFIG.LOG_LEVEL) && console.log(`[FB-CSV] ${msg}`, data || ''),
    warn: (msg, data) => console.warn(`[FB-CSV] ⚠ ${msg}`, data || ''),
    error: (msg, data) => console.error(`[FB-CSV] ❌ ${msg}`, data || ''),
  };

  // --------- STATE ---------
  const state = {
    items: new Map(),
    autoscanTimer: null,
    autoscanEndAt: 0,
    lastScanTime: 0,
    scanPending: false,
    initialized: false,
    panelElement: null,
  };

  // --------- STORAGE LAYER ---------
  const storage = {
    load() {
      try {
        const data = GM_getValue(CONFIG.STORAGE_KEY, '{}');
        const parsed = JSON.parse(data);
        state.items.clear();
        Object.entries(parsed).forEach(([k, v]) => state.items.set(k, v));
        logger.info(`Loaded ${state.items.size} groups from storage`);
        return state.items.size;
      } catch (e) {
        logger.error('Failed to load storage', e);
        return 0;
      }
    },
    save() {
      try {
        const obj = Object.fromEntries(state.items);
        const json = JSON.stringify(obj);
        if (json.length > CONFIG.MAX_STORAGE_SIZE) {
          logger.warn(`Storage size ${json.length} > max ${CONFIG.MAX_STORAGE_SIZE}, pruning oldest entries`);
          const entries = Array.from(state.items.entries()).sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0));
          state.items.clear();
          entries.slice(-Math.floor(entries.length * 0.75)).forEach(([k, v]) => state.items.set(k, v));
        }
        GM_setValue(CONFIG.STORAGE_KEY, JSON.stringify(Object.fromEntries(state.items)));
        logger.debug(`Saved ${state.items.size} groups`);
      } catch (e) {
        logger.error('Failed to save storage', e);
      }
    },
    clear() {
      GM_deleteValue(CONFIG.STORAGE_KEY);
      state.items.clear();
      logger.info('Cleared all stored data');
    },
  };

  // --------- UI BUILDER ---------
  function createPanel() {
    const panel = document.createElement('div');
    panel.id = 'fb-groups-csv-panel';
    panel.setAttribute('data-version', '2.0');

    const styles = {
      position: 'fixed',
      zIndex: '999999',
      right: '16px',
      bottom: '16px',
      width: '300px',
      background: 'rgba(32,32,32,0.98)',
      color: '#fff',
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
      fontSize: '13px',
      border: '1px solid rgba(255,255,255,0.2)',
      borderRadius: '12px',
      boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
      padding: '12px',
      backdropFilter: 'blur(4px)',
      maxHeight: '80vh',
      overflowY: 'auto',
    };
    Object.assign(panel.style, styles);

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;cursor:move;user-select:none;" id="fb-groups-csv-drag">
        <div style="display:flex;align-items:center;gap:6px;">
          <strong>Groups → CSV</strong>
          <span style="font-size:11px;opacity:0.6;padding:2px 6px;background:rgba(255,255,255,0.1);border-radius:4px;">v2.0</span>
        </div>
        <span id="fb-groups-csv-count" style="font-weight:bold;background:rgba(76,175,80,0.3);padding:2px 8px;border-radius:4px;font-size:12px;">0</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">
        <button id="fb-groups-csv-scan" class="fb-csv-btn fb-csv-btn-primary" style="grid-column:1;">Scan</button>
        <button id="fb-groups-csv-autoscan" class="fb-csv-btn fb-csv-btn-primary" style="grid-column:2;" title="Auto-scroll & scan for 30s">Auto-scan</button>
        <button id="fb-groups-csv-export" class="fb-csv-btn fb-csv-btn-success" style="grid-column:1;">Export CSV</button>
        <button id="fb-groups-csv-copy" class="fb-csv-btn fb-csv-btn-secondary" style="grid-column:2;">Copy</button>
        <button id="fb-groups-csv-clear" class="fb-csv-btn fb-csv-btn-danger" style="grid-column:1;">Clear</button>
        <button id="fb-groups-csv-help" class="fb-csv-btn fb-csv-btn-secondary" style="grid-column:2;" title="Show tips">?</button>
      </div>
      <div id="fb-groups-csv-status" style="font-size:12px;opacity:0.85;padding:8px;background:rgba(255,255,255,0.05);border-radius:6px;margin-bottom:8px;line-height:1.4;">Ready</div>
      <details style="font-size:11px;opacity:0.75;">
        <summary style="cursor:pointer;margin:4px 0;">Stats</summary>
        <div style="padding:6px;background:rgba(0,0,0,0.2);border-radius:4px;margin-top:4px;line-height:1.6;">
          <div>Total: <strong id="fb-groups-csv-stat-total">0</strong></div>
          <div>Avg members: <strong id="fb-groups-csv-stat-avg">-</strong></div>
          <div>Last scan: <strong id="fb-groups-csv-stat-lastscan">never</strong></div>
        </div>
      </details>
    `;

    // Button styles
    const btnStyles = `
      <style>
        .fb-csv-btn {
          padding: 8px 12px;
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 8px;
          background: rgba(100,100,100,0.3);
          color: #fff;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
          transition: all 150ms ease;
          white-space: nowrap;
        }
        .fb-csv-btn:hover {
          background: rgba(100,100,100,0.5);
          border-color: rgba(255,255,255,0.3);
          transform: translateY(-1px);
        }
        .fb-csv-btn:active {
          transform: translateY(0);
        }
        .fb-csv-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .fb-csv-btn-primary {
          background: rgba(66,133,244,0.4);
          border-color: rgba(66,133,244,0.6);
        }
        .fb-csv-btn-primary:hover {
          background: rgba(66,133,244,0.6);
        }
        .fb-csv-btn-success {
          background: rgba(76,175,80,0.4);
          border-color: rgba(76,175,80,0.6);
        }
        .fb-csv-btn-success:hover {
          background: rgba(76,175,80,0.6);
        }
        .fb-csv-btn-danger {
          background: rgba(244,67,54,0.3);
          border-color: rgba(244,67,54,0.5);
        }
        .fb-csv-btn-danger:hover {
          background: rgba(244,67,54,0.5);
          color: #ffcccc;
        }
        .fb-csv-btn-secondary {
          background: rgba(158,158,158,0.3);
          border-color: rgba(158,158,158,0.5);
        }
        .fb-csv-btn-secondary:hover {
          background: rgba(158,158,158,0.5);
        }
        #fb-groups-csv-panel {
          scrollbar-width: thin;
          scrollbar-color: rgba(255,255,255,0.2) transparent;
        }
        #fb-groups-csv-panel::-webkit-scrollbar {
          width: 6px;
        }
        #fb-groups-csv-panel::-webkit-scrollbar-track {
          background: transparent;
        }
        #fb-groups-csv-panel::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.2);
          border-radius: 3px;
        }
      </style>
    `;
    document.head.insertAdjacentHTML('beforeend', btnStyles);

    document.body.appendChild(panel);
    state.panelElement = panel;

    // Dragging
    setupDragging(panel);

    // Button handlers
    setupButtonHandlers(panel);

    logger.info('Panel created');
    return panel;
  }

  function setupDragging(panel) {
    const drag = panel.querySelector('#fb-groups-csv-drag');
    let dragging = false;
    let startX = 0, startY = 0, startRight = 0, startBottom = 0;

    drag.addEventListener('pointerdown', e => {
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      startRight = window.innerWidth - rect.right;
      startBottom = window.innerHeight - rect.bottom;
      panel.setPointerCapture(e.pointerId);
      drag.style.opacity = '0.7';
    });

    drag.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      panel.style.right = Math.max(0, Math.min(window.innerWidth - 100, startRight - dx)) + 'px';
      panel.style.bottom = Math.max(0, Math.min(window.innerHeight - 100, startBottom - dy)) + 'px';
    });

    drag.addEventListener('pointerup', () => {
      dragging = false;
      drag.style.opacity = '1';
    });
  }

  function setupButtonHandlers(panel) {
    panel.querySelector('#fb-groups-csv-scan').addEventListener('click', () => {
      setStatus('Scanning visible content…');
      const added = scanPage();
      updateUI();
      setStatus(`✓ Scan complete. +${added} new, ${state.items.size} total.`);
    });

    panel.querySelector('#fb-groups-csv-autoscan').addEventListener('click', function() {
      if (state.autoscanTimer) {
        clearInterval(state.autoscanTimer);
        state.autoscanTimer = null;
        this.textContent = 'Auto-scan';
        setStatus('Auto-scan stopped.');
        return;
      }

      this.textContent = 'Stop';
      state.autoscanEndAt = Date.now() + CONFIG.AUTO_SCAN_DURATION;
      setStatus('Auto-scanning for ~30s…');

      state.autoscanTimer = setInterval(() => {
        if (Date.now() > state.autoscanEndAt) {
          clearInterval(state.autoscanTimer);
          state.autoscanTimer = null;
          panel.querySelector('#fb-groups-csv-autoscan').textContent = 'Auto-scan';
          setStatus(`✓ Auto-scan done. Total: ${state.items.size} groups.`);
          storage.save();
          return;
        }
        window.scrollBy({ top: 600, behavior: 'auto' });
        const added = scanPage();
        if (added > 0) {
          updateUI();
          setStatus(`Scanning… +${added} new. Total: ${state.items.size}.`);
        }
      }, CONFIG.MUTATION_OBSERVER_THROTTLE);
    });

    panel.querySelector('#fb-groups-csv-export').addEventListener('click', () => {
      try {
        const csv = toCSV();
        downloadCSV(csv);
        setStatus('✓ CSV downloaded.');
      } catch (e) {
        logger.error('Export failed', e);
        setStatus(`✗ Export failed: ${e.message}`);
      }
    });

    panel.querySelector('#fb-groups-csv-copy').addEventListener('click', async function() {
      try {
        const csv = toCSV();
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(csv);
        } else if (typeof GM_setClipboard === 'function') {
          GM_setClipboard(csv);
        } else {
          throw new Error('Clipboard API not available');
        }
        setStatus('✓ CSV copied to clipboard.');
      } catch (e) {
        logger.error('Copy failed', e);
        setStatus(`✗ Copy failed: ${e.message}`);
      }
    });

    panel.querySelector('#fb-groups-csv-clear').addEventListener('click', function() {
      if (confirm('Clear all ' + state.items.size + ' groups? This cannot be undone.')) {
        storage.clear();
        updateUI();
        setStatus('✓ All data cleared.');
      }
    });

    panel.querySelector('#fb-groups-csv-help').addEventListener('click', () => {
      alert('Facebook Groups CSV Exporter v2.0\n\n' +
        '• Scan: Extract visible groups\n' +
        '• Auto-scan: Scroll & scan for 30s\n' +
        '• Export: Download as CSV file\n' +
        '• Copy: Copy CSV to clipboard\n' +
        '• Clear: Delete all stored data\n\n' +
        'Data persists between sessions.\n' +
        'Drag panel to move.\n\n' +
        'Tips: Use Auto-scan when viewing\n' +
        'your groups list for best results.');
    });
  }

  function setStatus(msg) {
    const el = document.querySelector('#fb-groups-csv-status');
    if (el) {
      el.textContent = msg;
      el.style.animation = 'none';
      setTimeout(() => el.style.animation = '', 10);
    }
  }

  function updateUI() {
    const count = state.items.size;
    const countEl = document.querySelector('#fb-groups-csv-count');
    if (countEl) countEl.textContent = count;

    // Stats
    const statTotal = document.querySelector('#fb-groups-csv-stat-total');
    if (statTotal) statTotal.textContent = count;

    const statAvg = document.querySelector('#fb-groups-csv-stat-avg');
    if (statAvg) {
      const members = Array.from(state.items.values())
        .map(r => parseInt(r.members?.replace(/[^\d]/g, '') || '0'))
        .filter(n => n > 0);
      const avg = members.length > 0
        ? Math.round(members.reduce((a, b) => a + b) / members.length).toLocaleString()
        : '-';
      statAvg.textContent = avg;
    }

    const statLastScan = document.querySelector('#fb-groups-csv-stat-lastscan');
    if (statLastScan) {
      const now = new Date();
      const elapsed = Math.round((now - state.lastScanTime) / 1000);
      statLastScan.textContent = elapsed < 60 ? `${elapsed}s ago` : `${Math.round(elapsed / 60)}m ago`;
    }

    storage.save();
  }

  // --------- DEBOUNCED SCAN ---------
  function scanPageDebounced() {
    if (state.scanPending) return;
    state.scanPending = true;
    setTimeout(() => {
      state.scanPending = false;
      scanPage();
      updateUI();
    }, CONFIG.SCAN_DEBOUNCE_MS);
  }

  // --------- CORE SCAN ---------
  function scanPage() {
    const before = state.items.size;
    const now = Date.now();

    const anchors = Array.from(document.querySelectorAll(
      'a[role="link"][href*="/groups/"], a[href*="/groups/"]'
    ));

    const badParts = [
      '/groups/feed', '/groups/joins', '/groups/discover', '/groups/create',
      '/groups/requests', '/groups/browse', '/groups/categories', '/groups/notifications',
      '/groups/settings', '/groups/members', '/groups/events', '/groups/invitations'
    ];

    for (const a of anchors) {
      try {
        const href = a.getAttribute('href');
        if (!href) continue;
        if (badParts.some(p => href.includes(p))) continue;

        const abs = absolutize(a.href);
        const canonical = canonicalizeGroupUrl(abs);
        if (!canonical) continue;

        const key = groupKey(canonical);
        if (state.items.has(key)) continue; // Skip already known

        const name = cleanText(a.textContent || '');

        // Find context container
        const container = a.closest(
          '[role="article"], [data-pagelet], [class*="x1lliihq"], [class*="x1y1aw1k"], li, div[class*="Feed"]'
        ) || a.parentElement;

        const textBlock = cleanText(container?.innerText || '');
        const members = findMembers(textBlock);
        const lastActive = findLastActive(textBlock);
        const privacy = findPrivacy(textBlock, container);

        const altName = findAltName(container) || name;
        const finalName = pickBestName(name, altName);

        if (!finalName) continue;

        const record = {
          name: finalName,
          members: members || '',
          lastActive: lastActive || '',
          privacy: privacy || '',
          url: canonical,
          timestamp: now,
        };

        state.items.set(key, record);
        logger.debug(`Found group: ${finalName}`);
      } catch (e) {
        logger.warn(`Error processing anchor`, e);
        continue;
      }
    }

    state.lastScanTime = now;
    const added = state.items.size - before;
    if (added > 0) logger.info(`Scan found ${added} new groups`);

    return added;
  }

  // --------- HELPERS ---------
  function absolutize(u) {
    try {
      return new URL(u, location.origin).toString();
    } catch {
      return null;
    }
  }

  function canonicalizeGroupUrl(u) {
    if (!u) return null;
    try {
      const url = new URL(u);
      if (!/facebook\.com$/.test(url.hostname)) return null;
      const path = url.pathname;
      const idx = path.indexOf('/groups/');
      if (idx === -1) return null;
      const rest = path.slice(idx + 8);
      const slug = rest.split('/')[0];
      if (!slug) return null;
      return `${url.origin}/groups/${slug}/`;
    } catch {
      return null;
    }
  }

  function groupKey(canonicalUrl) {
    const match = canonicalUrl.match(/\/groups\/([^/]+)\/?$/);
    return match ? match[1] : null;
  }

  function cleanText(s) {
    return (s || '')
      .replace(/\s+/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // Zero-width chars
      .trim();
  }

  function findMembers(text) {
    // "12.3K members", "3,241 members", "1M members"
    const m = text.match(/([\d.,]+(?:\s*[KMB])?)\s+members/i);
    return m ? m[1].trim() : '';
  }

  function findLastActive(text) {
    // "Last active 2 hours ago", "Active 3 days ago"
    const m = text.match(/(Last active[^.\n]*|Active \d+ .*? ago)/i);
    return m ? cleanText(m[1]) : '';
  }

  function findPrivacy(text, container) {
    let m = text.match(/\b(Public|Private)\s+group\b/i);
    if (m) return m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();

    m = text.match(/\b(Public|Private)\b(?=[^\n]*members)/i);
    if (m) return m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();

    if (container) {
      const spans = container.querySelectorAll('span, div');
      for (const el of spans) {
        const t = cleanText(el.textContent || '');
        if (/\bPublic group\b/i.test(t)) return 'Public';
        if (/\bPrivate group\b/i.test(t)) return 'Private';
      }
    }

    return '';
  }

  function findAltName(container) {
    if (!container) return '';
    const candidates = container.querySelectorAll('span, strong, h1, h2, h3, h4, div');
    let best = '';
    for (const el of candidates) {
      const t = cleanText(el.textContent || '');
      if (t.length > best.length && t.length <= 150 && !/members|active|join|create|see all|back|edit|settings/i.test(t)) {
        best = t;
      }
    }
    return best;
  }

  function pickBestName(a, b) {
    if (!a) return b;
    if (!b) return a;
    const score = s => {
      let pts = 0;
      if (s.length >= 3 && s.length <= 150) pts += 2;
      if (/[A-Za-z]/.test(s)) pts += 1;
      if (/members|active|join/i.test(s)) pts -= 2;
      if (/^\d+$/.test(s)) pts -= 3;
      return pts;
    };
    return score(b) > score(a) ? b : a;
  }

  // --------- CSV EXPORT ---------
  function toCSV() {
    const rows = [['Group Name', 'Member Count', 'Last Active', 'Privacy', 'Group URL']];

    for (const rec of state.items.values()) {
      rows.push([
        rec.name,
        rec.members,
        rec.lastActive,
        rec.privacy || '',
        rec.url
      ]);
    }

    const escapeCSV = v => {
      const s = String(v ?? '').trim();
      if (/[",\n\r]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const csvBody = rows.map(r => r.map(escapeCSV).join(',')).join('\n');
    return '\uFEFF' + csvBody; // BOM for Excel UTF-8
  }

  function downloadCSV(csv) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.Z]/g, '').slice(0, -3);
    a.href = URL.createObjectURL(blob);
    a.download = `facebook-groups-${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 100);
  }

  // --------- MUTATION OBSERVER ---------
  const obs = new MutationObserver(() => {
    scanPageDebounced();
  });

  // --------- INITIALIZATION ---------
  function init() {
    if (state.initialized) return;
    if (document.getElementById('fb-groups-csv-panel')) return;

    state.initialized = true;
    createPanel();
    storage.load();
    updateUI();

    // Initial scan
    const initial = scanPage();
    if (initial > 0) {
      updateUI();
      setStatus(`✓ Initialized. Found ${initial} groups.`);
    } else {
      setStatus('Ready. Click Scan to begin.');
    }

    // Start observing mutations
    obs.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    logger.info('Initialization complete');
  }

  // --------- BOOT ---------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Cleanup on unload
  window.addEventListener('beforeunload', () => {
    if (state.autoscanTimer) {
      clearInterval(state.autoscanTimer);
    }
    storage.save();
  });
})();
