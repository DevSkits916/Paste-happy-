import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseCsvRows, ParsedCsvRow } from './lib/csv';
import { copyText } from './lib/clipboard';
import { loadState, saveState } from './lib/storage';
import { createId } from './lib/id';
import { ToastProvider, useToast } from './components/Toast';
import { Toggle } from './components/Toggle';

interface GroupRow {
  id: string;
  name: string;
  url: string;
  ad: string;
  done: boolean;
  lastPostedAt?: string;
}

interface AppState {
  rows: GroupRow[];
  selectedId: string | null;
  autoOpen: boolean;
}

const STORAGE_KEY = 'fb-group-poster-state';

const SAMPLE_CSV = `Group Name,Group URL,Ad\nFolsom Community,https://www.facebook.com/groups/355271864659430/,"Hi neighbors — Loki and I are sharing resources: https://gofund.me/9aada7036"\nUnderstand Bipolar Disorder,https://www.facebook.com/groups/1234567890/,"Sending support today. If allowed, here’s ours: https://gofund.me/9aada7036"`;

function InnerApp() {
  const { push } = useToast();
  const [state, setState] = useState<AppState>(() =>
    typeof window !== 'undefined'
      ? loadState<AppState>(STORAGE_KEY, { rows: [], selectedId: null, autoOpen: true })
      : { rows: [], selectedId: null, autoOpen: true }
  );
  const [filter, setFilter] = useState('');
  const pasteTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    saveState(STORAGE_KEY, state);
  }, [state]);

  const selectedRow = useMemo(() => state.rows.find((row) => row.id === state.selectedId) ?? state.rows[0], [
    state.rows,
    state.selectedId,
  ]);

  useEffect(() => {
    if (!state.selectedId && state.rows.length > 0) {
      setState((prev) => ({ ...prev, selectedId: prev.rows[0]?.id ?? null }));
    }
  }, [state.rows, state.selectedId]);

  const filteredRows = useMemo(() => {
    if (!filter.trim()) return state.rows;
    const text = filter.trim().toLowerCase();
    return state.rows.filter((row) => row.name.toLowerCase().includes(text) || row.url.toLowerCase().includes(text));
  }, [filter, state.rows]);

  const progress = useMemo(() => {
    if (state.rows.length === 0) return 0;
    const doneCount = state.rows.filter((row) => row.done).length;
    return Math.round((doneCount / state.rows.length) * 100);
  }, [state.rows]);

  const setSelectedByIndex = useCallback(
    (index: number) => {
      setState((prev) => {
        const rows = prev.rows;
        if (rows.length === 0) return prev;
        const nextIndex = (index + rows.length) % rows.length;
        return { ...prev, selectedId: rows[nextIndex].id };
      });
    },
    [setState]
  );

  const handlePrev = useCallback(() => {
    if (state.rows.length === 0) return;
    const currentIndex = state.rows.findIndex((row) => row.id === selectedRow?.id);
    setSelectedByIndex((currentIndex <= 0 ? state.rows.length : currentIndex) - 1);
  }, [state.rows, selectedRow, setSelectedByIndex]);

  const handleNext = useCallback(() => {
    if (state.rows.length === 0) return;
    const currentIndex = state.rows.findIndex((row) => row.id === selectedRow?.id);
    setSelectedByIndex(currentIndex + 1);
  }, [state.rows, selectedRow, setSelectedByIndex]);

  const updateRow = useCallback(
    (id: string, updater: (row: GroupRow) => GroupRow) => {
      setState((prev) => ({
        ...prev,
        rows: prev.rows.map((row) => (row.id === id ? updater(row) : row)),
      }));
    },
    []
  );

  const handleCopyAndMaybeOpen = useCallback(
    async (row: GroupRow) => {
      if (!row.ad.trim()) {
        push('Ad text is empty for this row', 'error');
        return;
      }

      const urlIsValid = isValidHttpUrl(row.url);
      const shouldAttemptOpen = state.autoOpen && urlIsValid;
      let openedWindow: Window | null = null;

      if (state.autoOpen && !urlIsValid) {
        push('URL must start with http:// or https:// before opening.', 'error');
      }

      if (shouldAttemptOpen) {
        openedWindow = window.open(row.url, '_blank', 'noopener,noreferrer');
        if (!openedWindow) {
          push('Browser blocked the new tab. Allow pop-ups for this site.', 'error');
        }
      }

      try {
        await copyText(row.ad);
        push('Copied ad to clipboard', 'success');
        updateRow(row.id, (current) => ({ ...current, done: true, lastPostedAt: new Date().toISOString() }));
      } catch (error) {
        console.error(error);
        push('Copy failed. Please long-press to paste manually.', 'error');
        if (openedWindow) {
          openedWindow.focus();
        }
      }
    },
    [push, state.autoOpen, updateRow]
  );

  const handleOpenOnly = useCallback(
    (row: GroupRow) => {
      if (isValidHttpUrl(row.url)) {
        window.open(row.url, '_blank', 'noopener,noreferrer');
      } else {
        push('URL must start with http or https', 'error');
      }
    },
    [push]
  );

  const handleMarkDone = useCallback(
    (row: GroupRow) => {
      updateRow(row.id, (current) => ({ ...current, done: true, lastPostedAt: new Date().toISOString() }));
      push(`Marked ${row.name || 'row'} as done`, 'success');
    },
    [push, updateRow]
  );

  const handleMarkUndone = useCallback(
    (row: GroupRow) => {
      updateRow(row.id, (current) => ({ ...current, done: false }));
      push(`Reset status for ${row.name || 'row'}`, 'info');
    },
    [push, updateRow]
  );

  const importRows = useCallback(
    (entries: ParsedCsvRow[]) => {
      if (!entries.length) {
        push('No rows detected in CSV', 'error');
        return;
      }
      const existingByKey = new Map(state.rows.map((row) => [makeKey(row.name, row.url), row] as const));
      const newRows: GroupRow[] = entries.map((entry) => {
        const key = makeKey(entry.name, entry.url);
        const existing = existingByKey.get(key);
        if (existing) {
          return {
            ...existing,
            name: entry.name,
            url: entry.url,
            ad: entry.ad,
          };
        }
        return {
          id: createId(),
          name: entry.name,
          url: entry.url,
          ad: entry.ad,
          done: false,
        };
      });

      setState({ rows: newRows, selectedId: newRows[0]?.id ?? null, autoOpen: state.autoOpen });
      push(`Imported ${newRows.length} row${newRows.length === 1 ? '' : 's'}`, 'success');
    },
    [push, state.autoOpen, state.rows]
  );

  const handleCsvFile = useCallback(
    async (file: File) => {
      const text = await file.text();
      const parsed = parseCsvRows(text);
      importRows(parsed);
    },
    [importRows]
  );

  const handlePasteCsv = useCallback(() => {
    const text = pasteTextareaRef.current?.value ?? '';
    if (!text.trim()) {
      push('Paste CSV data first', 'error');
      return;
    }
    const parsed = parseCsvRows(text);
    importRows(parsed);
    if (pasteTextareaRef.current) {
      pasteTextareaRef.current.value = '';
    }
  }, [importRows, push]);

  const handleExportCsv = useCallback(() => {
    if (state.rows.length === 0) {
      push('Nothing to export yet', 'error');
      return;
    }
    const header = ['Group Name', 'Group URL', 'Ad', 'Done', 'Last Posted At'];
    const lines = state.rows.map((row) =>
      [row.name, row.url, row.ad, row.done ? 'Yes' : 'No', row.lastPostedAt ?? ''].map(csvEscape).join(',')
    );
    downloadFile('fb-group-poster.csv', [header.map(csvEscape).join(','), ...lines].join('\n'), 'text/csv');
    push('Exported CSV', 'success');
  }, [push, state.rows]);

  const handleBackupJson = useCallback(() => {
    const payload = JSON.stringify(state, null, 2);
    downloadFile('fb-group-poster-backup.json', payload, 'application/json');
    push('Backup created', 'success');
  }, [push, state]);

  const handleRestoreJson = useCallback(
    async (file: File) => {
      const text = await file.text();
      try {
        const data = JSON.parse(text) as AppState;
        if (!data || typeof data !== 'object' || !Array.isArray(data.rows)) {
          throw new Error('Invalid backup');
        }
        setState(data);
        push('Backup restored', 'success');
      } catch (error) {
        console.error(error);
        push('Failed to restore backup', 'error');
      }
    },
    [push]
  );

  const handleLoadSample = useCallback(() => {
    const parsed = parseCsvRows(SAMPLE_CSV);
    importRows(parsed);
  }, [importRows]);

  const handleRowAdChange = useCallback(
    (row: GroupRow, value: string) => {
      updateRow(row.id, (current) => ({ ...current, ad: value }));
    },
    [updateRow]
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (shouldIgnoreShortcut(event)) return;
      if (event.key === 'j') {
        event.preventDefault();
        handleNext();
      } else if (event.key === 'k') {
        event.preventDefault();
        handlePrev();
      } else if (event.key === 'c') {
        event.preventDefault();
        if (selectedRow) {
          handleCopyAndMaybeOpen(selectedRow);
        }
      } else if (event.key === 'm') {
        event.preventDefault();
        if (selectedRow) {
          handleMarkDone(selectedRow);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleCopyAndMaybeOpen, handleMarkDone, handleNext, handlePrev, selectedRow]);

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-4 pb-24 pt-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-white">FB Group Poster</h1>
        <p className="text-sm text-slate-300">
          Import your Facebook group promo list and work through it one tap at a time. This tool never automates
          Facebook logins or posts — it simply helps you copy text and open group pages quickly.
        </p>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
          <span>{state.rows.length} groups</span>
          <span>{progress}% done</span>
          <span>Shortcuts: j/k (prev/next), c (copy & open), m (mark done)</span>
        </div>
      </header>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-lg">
        <h2 className="mb-3 text-lg font-semibold text-white">Import</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-200" htmlFor="csvFile">
              Upload CSV
            </label>
            <input
              id="csvFile"
              type="file"
              accept=".csv,text/csv"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  handleCsvFile(file);
                  event.target.value = '';
                }
              }}
            />
            <button
              type="button"
              className="w-full rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/80"
              onClick={handleLoadSample}
            >
              Load Sample Data
            </button>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-200" htmlFor="csvPaste">
              Paste CSV data
            </label>
            <textarea
              id="csvPaste"
              ref={pasteTextareaRef}
              placeholder="Group Name,Group URL,Ad"
              className="h-24 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            />
            <button
              type="button"
              className="w-full rounded-lg border border-sky-500/60 px-3 py-2 text-sm font-medium text-sky-200 hover:border-sky-400 hover:text-sky-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/80"
              onClick={handlePasteCsv}
            >
              Import pasted CSV
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-lg">
        <h2 className="mb-3 text-lg font-semibold text-white">Current group</h2>
        {selectedRow ? (
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-sm uppercase tracking-wide text-slate-400">Group name</p>
              <p className="text-lg font-semibold text-white">{selectedRow.name || 'Untitled group'}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm uppercase tracking-wide text-slate-400">Group link</p>
              <a
                href={selectedRow.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-sky-300"
              >
                {selectedRow.url || 'No URL provided'}
              </a>
              {!isValidHttpUrl(selectedRow.url) && selectedRow.url && (
                <p className="text-xs text-amber-300/80">URL should start with http:// or https://</p>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span>Status: {selectedRow.done ? 'Done' : 'Pending'}</span>
              {selectedRow.lastPostedAt && (
                <span>
                  Last posted {new Intl.DateTimeFormat([], { dateStyle: 'medium', timeStyle: 'short' }).format(
                    new Date(selectedRow.lastPostedAt)
                  )}
                </span>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-slate-200" htmlFor="currentAd">
                Ad text
              </label>
              <textarea
                id="currentAd"
                className="mt-2 h-40 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm leading-relaxed shadow-inner focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/80"
                value={selectedRow.ad}
                onChange={(event) => handleRowAdChange(selectedRow, event.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="flex-1 rounded-xl bg-sky-500 px-4 py-3 text-base font-semibold text-slate-950 shadow-sm hover:bg-sky-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/80"
                onClick={() => handleCopyAndMaybeOpen(selectedRow)}
              >
                Copy &amp; Open
              </button>
              <button
                type="button"
                className="flex-1 rounded-xl border border-slate-700 px-4 py-3 text-base font-semibold hover:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/80"
                onClick={() => handleOpenOnly(selectedRow)}
              >
                Open Only
              </button>
              <button
                type="button"
                className="flex-1 rounded-xl border border-emerald-500/60 px-4 py-3 text-base font-semibold text-emerald-200 hover:border-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80"
                onClick={() => handleMarkDone(selectedRow)}
              >
                Mark Done
              </button>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
              <Toggle
                id="autoOpenToggle"
                checked={state.autoOpen}
                onChange={(checked) => setState((prev) => ({ ...prev, autoOpen: checked }))}
                label="Open group after copy"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/80"
                  onClick={handlePrev}
                >
                  Prev
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/80"
                  onClick={handleNext}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-400">Import a CSV to get started.</p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-lg">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-white">All groups</h2>
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter by name or URL"
            className="w-full max-w-xs rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/80"
          />
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <table className="min-w-full divide-y divide-slate-800 text-sm">
            <thead className="bg-slate-900/80 text-slate-300">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-left font-medium">Ad preview</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filteredRows.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-center text-slate-500" colSpan={4}>
                    No rows yet.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr key={row.id} className={row.id === selectedRow?.id ? 'bg-slate-900/70' : ''}>
                    <td className="px-3 py-3 align-top">
                      <div className="font-medium text-white">{row.name || 'Untitled'}</div>
                      <a href={row.url} target="_blank" rel="noopener noreferrer" className="break-all text-xs">
                        {row.url}
                      </a>
                    </td>
                    <td className="px-3 py-3 align-top text-xs text-slate-300">
                      {row.ad ? truncate(row.ad, 120) : <span className="text-slate-500">(no ad)</span>}
                    </td>
                    <td className="px-3 py-3 align-top text-xs text-slate-300">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] font-semibold ${
                          row.done ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {row.done ? 'Done' : 'Pending'}
                      </span>
                      {row.lastPostedAt && (
                        <div className="mt-1 text-[11px] text-slate-500">
                          {new Intl.DateTimeFormat([], { dateStyle: 'short', timeStyle: 'short' }).format(
                            new Date(row.lastPostedAt)
                          )}
                        </div>
                      )}
                    </td>
                    <td className="flex flex-col items-end gap-1 px-3 py-3 text-xs sm:flex-row sm:items-center sm:justify-end">
                      <button
                        type="button"
                        className="rounded-lg bg-sky-500/80 px-3 py-1 font-semibold text-slate-950 hover:bg-sky-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/80"
                        onClick={() => handleCopyAndMaybeOpen(row)}
                      >
                        Copy &amp; Open
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-slate-700 px-3 py-1 font-semibold hover:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/80"
                        onClick={() => setState((prev) => ({ ...prev, selectedId: row.id }))}
                      >
                        Focus
                      </button>
                      {row.done ? (
                        <button
                          type="button"
                          className="rounded-lg border border-amber-500/60 px-3 py-1 font-semibold text-amber-200 hover:border-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/80"
                          onClick={() => handleMarkUndone(row)}
                        >
                          Mark Pending
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="rounded-lg border border-emerald-500/60 px-3 py-1 font-semibold text-emerald-200 hover:border-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80"
                          onClick={() => handleMarkDone(row)}
                        >
                          Mark Done
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-lg md:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-white">Export &amp; backups</h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="flex-1 rounded-lg bg-sky-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/80"
              onClick={handleExportCsv}
            >
              Export CSV
            </button>
            <button
              type="button"
              className="flex-1 rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold hover:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/80"
              onClick={handleBackupJson}
            >
              Download backup
            </button>
          </div>
          <label className="text-sm font-medium text-slate-200" htmlFor="restoreJson">
            Restore backup (JSON)
          </label>
          <input
            id="restoreJson"
            type="file"
            accept="application/json"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                handleRestoreJson(file);
                event.target.value = '';
              }
            }}
          />
        </div>
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-white">iPhone tips</h2>
          <ul className="list-disc space-y-2 pl-5 text-sm text-slate-300">
            <li>After tapping Copy &amp; Open, switch back to Safari and long-press the post field to paste.</li>
            <li>If Safari blocks new tabs, enable pop-ups for this site in Settings &gt; Safari.</li>
            <li>You can keep this page open in split view with Facebook for faster posting.</li>
            <li>Clipboard access uses the system clipboard; no data leaves your device.</li>
          </ul>
        </div>
      </section>

      <footer className="space-y-2 pb-8 text-xs text-slate-500">
        <p>
          CSV columns accepted: Group Name|Name, Group URL|URL, Ad|Ad Text|Post. Extra columns are ignored. Empty rows
          are skipped.
        </p>
        <p>
          This tool never automates Facebook logins, forms, or submissions. It simply assists with manual copy and
          navigation.
        </p>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <InnerApp />
    </ToastProvider>
  );
}

function shouldIgnoreShortcut(event: KeyboardEvent) {
  const tagName = (event.target as HTMLElement)?.tagName;
  const isEditable =
    (event.target as HTMLElement)?.isContentEditable ||
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT';
  return isEditable;
}

function csvEscape(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function truncate(value: string, length: number) {
  if (value.length <= length) return value;
  return value.slice(0, length - 1) + '…';
}

function makeKey(name: string, url: string) {
  return `${name.trim().toLowerCase()}|${url.trim().toLowerCase()}`;
}

function isValidHttpUrl(url: string) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
