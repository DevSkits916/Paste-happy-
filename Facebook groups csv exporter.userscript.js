// ==UserScript==
// @name         Facebook Groups → CSV Exporter (2025-11-02)
// @namespace    devskits916.fb.groups.csv
// @version      1.4.0
// @description  Scan Facebook group listings and export to CSV (name, members, last active, URL). Floating panel with Scan / Auto-Scan / Export / Copy.
// @author       Calder
// @match        https://www.facebook.com/*groups*
// @match        https://m.facebook.com/*groups*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function() {
  'use strict';

  // --------- State ---------
  const state = {
    items: new Map(), // key: groupKey (id/slug), value: record
    autoscanTimer: null,
    autoscanEndAt: 0
  };

  // --------- UI ---------
  function createPanel() {
    const panel = document.createElement('div');
    panel.id = 'fb-groups-csv-panel';
    Object.assign(panel.style, {
      position: 'fixed',
      zIndex: 999999,
      right: '16px',
      bottom: '16px',
      width: '280px',
      background: 'rgba(32,32,32,0.95)',
      color: '#fff',
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, Apple Color Emoji, Segoe UI Emoji',
      fontSize: '13px',
      border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: '10px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
      padding: '10px'
    });

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;cursor:move;" id="fb-groups-csv-drag">
        <strong>Groups → CSV</strong>
        <span id="fb-groups-csv-count" style="opacity:0.85">0</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
        <button id="fb-groups-csv-scan" style="padding:8px;border:1px solid #3a3a3a;border-radius:8px;background:#2a2a2a;color:#fff;cursor:pointer">Scan</button>
        <button id="fb-groups-csv-autoscan" style="padding:8px;border:1px solid #3a3a3a;border-radius:8px;background:#2a2a2a;color:#fff;cursor:pointer" title="Auto-scroll + scan for 30s">Auto-scan 30s</button>
        <button id="fb-groups-csv-export" style="padding:8px;border:1px solid #3a3a3a;border-radius:8px;background:#1b5e20;color:#fff;cursor:pointer">Export CSV</button>
        <button id="fb-groups-csv-copy" style="padding:8px;border:1px solid #3a3a3a;border-radius:8px;background:#2a2a2a;color:#fff;cursor:pointer">Copy CSV</button>
      </div>
      <div id="fb-groups-csv-status" style="font-size:12px;opacity:0.9">Idle.</div>
    `;

    document.body.appendChild(panel);

    // Dragging
    const drag = panel.querySelector('#fb-groups-csv-drag');
    let startX=0, startY=0, startRight=0, startBottom=0, dragging=false;
    drag.addEventListener('pointerdown', e => {
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      startRight = window.innerWidth - rect.right;
      startBottom = window.innerHeight - rect.bottom;
      panel.setPointerCapture(e.pointerId);
    });
    drag.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      panel.style.right = Math.max(0, startRight - dx) + 'px';
      panel.style.bottom = Math.max(0, startBottom - dy) + 'px';
    });
    drag.addEventListener('pointerup', e => { dragging = false; });

    // Buttons
    panel.querySelector('#fb-groups-csv-scan').addEventListener('click', () => {
      setStatus('Scanning visible content…');
      const added = scanPage();
      bumpCount();
      setStatus(`Scan complete. ${added} new, ${state.items.size} total.`);
    });

    panel.querySelector('#fb-groups-csv-autoscan').addEventListener('click', () => {
      if (state.autoscanTimer) {
        clearInterval(state.autoscanTimer);
        state.autoscanTimer = null;
        setStatus('Auto-scan stopped.');
        return;
      }
      state.autoscanEndAt = Date.now() + 30_000;
      setStatus('Auto-scan running for ~30s…');
      // gentle auto scroll + scan
      state.autoscanTimer = setInterval(() => {
        window.scrollBy({ top: 800, behavior: 'smooth' });
        const added = scanPage();
        bumpCount();
        setStatus(`Auto-scan… added ${added}. Total ${state.items.size}.`);
        if (Date.now() > state.autoscanEndAt) {
          clearInterval(state.autoscanTimer);
          state.autoscanTimer = null;
          setStatus(`Auto-scan done. Total ${state.items.size}.`);
        }
      }, 1200);
    });

    panel.querySelector('#fb-groups-csv-export').addEventListener('click', () => {
      const csv = toCSV();
      downloadCSV(csv);
      setStatus('CSV downloaded.');
    });

    panel.querySelector('#fb-groups-csv-copy').addEventListener('click', async () => {
      const csv = toCSV();
      try {
        await navigator.clipboard.writeText(csv);
      } catch {
        if (typeof GM_setClipboard === 'function') GM_setClipboard(csv);
      }
      setStatus('CSV copied to clipboard.');
    });
  }

  function setStatus(msg) {
    const el = document.querySelector('#fb-groups-csv-status');
    if (el) el.textContent = msg;
  }
  function bumpCount() {
    const el = document.querySelector('#fb-groups-csv-count');
    if (el) el.textContent = String(state.items.size);
  }

  // --------- Core scan ---------
  function scanPage() {
    const before = state.items.size;
    const anchors = Array.from(document.querySelectorAll('a[role="link"][href*="/groups/"], a[href*="/groups/"]'));
    const badParts = [
      '/groups/feed', '/groups/joins', '/groups/discover', '/groups/create',
      '/groups/requests', '/groups/browse', '/groups/categories', '/groups/notifications'
    ];

    for (const a of anchors) {
      const href = a.getAttribute('href');
      if (!href) continue;
      // Ignore obvious non-group targets
      if (badParts.some(p => href.includes(p))) continue;

      const abs = absolutize(a.href);
      const canonical = canonicalizeGroupUrl(abs);
      if (!canonical) continue;

      const key = groupKey(canonical);
      const name = cleanText(a.textContent || '');

      // Find nearby text to pick up members/last active
      const container = a.closest('[role="article"], [data-pagelet], div[class*="x1lliihq"], div[class*="x1y1aw1k"]') || a.parentElement;
      const textBlock = cleanText(container ? container.innerText || '' : '');
      const members = findMembers(textBlock);
      const lastActive = findLastActive(textBlock);

      // Prefer the longest plausible name from surrounding context if anchor text is short
      const altName = findAltName(container) || name;
      const finalName = pickBestName(name, altName);

      // Store
      const prev = state.items.get(key);
      const record = {
        name: finalName,
        members: members || (prev && prev.members) || '',
        lastActive: lastActive || (prev && prev.lastActive) || '',
        url: canonical
      };
      state.items.set(key, record);
    }

    return state.items.size - before;
  }

  // --------- Helpers ---------
  function absolutize(u) {
    try { return new URL(u, location.origin).toString(); } catch { return null; }
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
    // slug or numeric id
    return canonicalUrl.replace(/^https?:\/\/[^/]+\/groups\/([^/]+)\/?$/, '$1');
  }
  function cleanText(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }
  function findMembers(text) {
    // Examples: "12.3K members", "3,241 members"
    const m = text.match(/([\d.,]+(?:\s*[KM])?)\s+members/i);
    return m ? m[1] : '';
  }
  function findLastActive(text) {
    // Examples: "Last active 2 hours ago", "Active 3 days ago"
    const m = text.match(/(Last active[^.\n]*|Active \d+ .*? ago)/i);
    return m ? cleanText(m[1]) : '';
  }
  function findAltName(container) {
    if (!container) return '';
    // Try header-like nodes near the anchor
    const candidates = container.querySelectorAll('span, strong, h1, h2, h3, div');
    let best = '';
    for (const el of candidates) {
      const t = cleanText(el.textContent || '');
      if (t.length > best.length && t.length <= 120 && !/members|active|Join(ed)?|Create|See all/i.test(t)) {
        best = t;
      }
    }
    return best;
  }
  function pickBestName(a, b) {
    if (!a) return b;
    if (!b) return a;
    // Prefer the one that looks more like a title and less like metadata
    const score = s => (s.length >= 3 && s.length <= 120 ? 1 : 0) + (/[A-Za-z]/.test(s) ? 1 : 0) - (/members|active/i.test(s) ? 1 : 0);
    return score(b) > score(a) ? b : a;
  }

  // --------- CSV ---------
  function toCSV() {
    const rows = [['Group Name', 'Member Count', 'Last Active', 'Group URL']];
    for (const rec of state.items.values()) {
      rows.push([rec.name, rec.members, rec.lastActive, rec.url]);
    }
    // CSV escape
    const esc = v => {
      const s = String(v ?? '');
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const csvBody = rows.map(r => r.map(esc).join(',')).join('\n');
    // Add BOM for Excel
    return '\uFEFF' + csvBody;
  }

  function downloadCSV(csv) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = URL.createObjectURL(blob);
    a.download = `facebook-groups-${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
  }

  // --------- Observe dynamic loads ---------
  const obs = new MutationObserver(() => {
    // Opportunistic background capture; keep it cheap
    const added = scanPage();
    if (added > 0) {
      bumpCount();
      setStatus(`Found ${added} new. Total ${state.items.size}.`);
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });

  // --------- Boot ---------
  function init() {
    if (document.getElementById('fb-groups-csv-panel')) return;
    createPanel();
    // Initial pass
    setStatus('Initialized. Click Scan or Auto-scan.');
  }

  // Wait for body
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
