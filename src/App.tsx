import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ToastProvider, useToast } from './components/Toast';
import { copyText } from './lib/clipboard';
import { ParsedCsvRow, parseCsvRows } from './lib/csv';
import { createId } from './lib/id';
import { loadState, saveState } from './lib/storage';
import { SAMPLE_CSV, SAMPLE_CSV_ROW_COUNT } from './lib/sampleCsv';
import { RowHistoryEntry, RowStatusKind } from './lib/types';

interface QueueRow {
  id: string;
  name: string;
  url: string;
  ad: string;
  status: RowStatusKind;
  history: RowHistoryEntry[];
  lastChangedAt?: string;
  undoExpiresAt?: number;
}

interface AppState {
  rows: QueueRow[];
  currentId: string | null;
  filter: 'all' | RowStatusKind;
  search: string;
}

const STORAGE_KEY = 'paste-happy-session-v3';
const UNDO_DURATION_MS = 16000;

const FACEBOOK_GROUPS_SCANNER_SCRIPT_PATH = '/userscripts/facebook-groups-discover-export.user.js';

interface TutorialSection {
  title: string;
  description: string;
  items: string[];
  note?: string;
}

const TUTORIAL_SECTIONS: TutorialSection[] = [
  {
    title: 'Part 1: Prepare your Facebook group CSV',
    description:
      'Start by exporting the group list you want to work through. Keep the original file untouched until you are ready to add content.',
    items: [
      'Download the Facebook group scanner userscript and install it in free, cross-platform Tampermonkey on iOS, PC, or Android instead of using a paid iOS userscript app.',
      'Open the Facebook groups join/discovery page and scroll until the groups you want are visible.',
      'Run the scan and export the CSV when you are finished loading groups.',
      'Confirm the file includes group_name and group_url before moving on.',
    ],
  },
  {
    title: 'Part 2: Add one post per row',
    description:
      'Use ChatGPT to turn the exported CSV into a completed file with a unique advertisement for each Facebook group before you import it into Paste Happy.',
    items: [
      'Upload the exported CSV directly into ChatGPT.',
      'Tell ChatGPT to add or fill a post column with one unique advertisement for each Facebook group listed in the CSV.',
      'Ask ChatGPT to keep the existing rows in the same order and return the finished CSV with every row completed.',
      'Download the completed CSV ChatGPT generates, then review the post text before importing it into Paste Happy.',
    ],
    note: 'Paste Happy works best when the downloaded CSV already includes one finished advertisement in the post column for every row.',
  },
  {
    title: 'Part 3: Load the finished CSV into Paste Happy and post row by row',
    description:
      'Paste Happy treats every CSV row as a single posting unit so you can move through the queue in order and post quickly without losing your place.',
    items: [
      'Open Paste Happy and import the completed CSV file.',
      'Use the row list to review group names, URLs, and post text before posting.',
      'Select the current row, then use Copy & Open to copy the post column to your clipboard and open the Facebook group from that same CSV row.',
      'Paste the clipboard contents into Facebook, publish the post, then return to Paste Happy and click Mark Posted so you can move straight to the next group rapidly.',
      'Keep the queue sequential so your progress in Paste Happy always matches the CSV.',
    ],
  },
] as const;

function InnerApp() {
  const { push } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const undoTimers = useRef<Record<string, number>>({});

  const [state, setState] = useState<AppState>(() =>
    typeof window !== 'undefined'
      ? loadState<AppState>(STORAGE_KEY, { rows: [], currentId: null, filter: 'all', search: '' })
      : { rows: [], currentId: null, filter: 'all', search: '' }
  );

  useEffect(() => {
    saveState(STORAGE_KEY, state);
  }, [state]);

  const currentRow = useMemo(() => state.rows.find((row) => row.id === state.currentId), [state.currentId, state.rows]);

  const counts = useMemo(() => {
    return state.rows.reduce(
      (acc, row) => {
        acc[row.status] += 1;
        return acc;
      },
      { pending: 0, posted: 0, skipped: 0, failed: 0 }
    );
  }, [state.rows]);

  const total = state.rows.length;
  const filteredRows = useMemo(() => {
    const query = state.search.trim().toLowerCase();
    return state.rows.filter((row) => {
      const matchesFilter = state.filter === 'all' ? true : row.status === state.filter;
      const matchesSearch = !query || `${row.name} ${row.url}`.toLowerCase().includes(query);
      return matchesFilter && matchesSearch;
    });
  }, [state.filter, state.rows, state.search]);

  const setCurrentToFirstPending = useCallback(
    (rows: QueueRow[]): string | null => {
      const pendingRow = rows.find((row) => row.status === 'pending');
      return pendingRow ? pendingRow.id : rows[0]?.id ?? null;
    },
    []
  );

  const updateRow = useCallback((id: string, updater: (row: QueueRow) => QueueRow) => {
    setState((prev) => ({
      ...prev,
      rows: prev.rows.map((row) => (row.id === id ? updater(row) : row)),
    }));
  }, []);

  const clearUndoTimer = useCallback((id: string) => {
    const timer = undoTimers.current[id];
    if (timer) {
      clearTimeout(timer);
      delete undoTimers.current[id];
    }
  }, []);

  const scheduleUndoExpiry = useCallback(
    (id: string) => {
      clearUndoTimer(id);
      const timer = window.setTimeout(() => {
        setState((prev) => ({
          ...prev,
          rows: prev.rows.map((row) => (row.id === id ? { ...row, undoExpiresAt: undefined } : row)),
        }));
        delete undoTimers.current[id];
      }, UNDO_DURATION_MS);
      undoTimers.current[id] = timer;
    },
    [clearUndoTimer]
  );

  const findNextPendingId = useCallback(
    (rows: QueueRow[], afterId?: string | null): string | null => {
      if (!rows.length) return null;
      const pendingIds = rows.filter((row) => row.status === 'pending').map((row) => row.id);
      if (!pendingIds.length) return null;
      const startIndex = afterId ? rows.findIndex((row) => row.id === afterId) : -1;
      for (let offset = 1; offset <= rows.length; offset += 1) {
        const idx = (startIndex + offset) % rows.length;
        const candidate = rows[idx];
        if (candidate && candidate.status === 'pending') return candidate.id;
      }
      return pendingIds[0] ?? null;
    },
    []
  );

  const setRowStatus = useCallback(
    (id: string, status: RowStatusKind, advance = true) => {
      const now = new Date().toISOString();
      setState((prev) => {
        const rows = prev.rows.map((row) => {
          if (row.id !== id) return row;
          return {
            ...row,
            status,
            lastChangedAt: now,
            undoExpiresAt: Date.now() + UNDO_DURATION_MS,
            history: [...row.history, { action: status, at: now }],
          };
        });
        const nextId = advance ? findNextPendingId(rows, id) : prev.currentId ?? id;
        return { ...prev, rows, currentId: nextId };
      });
      scheduleUndoExpiry(id);
    },
    [findNextPendingId, scheduleUndoExpiry]
  );

  const handleUndo = useCallback(
    (row: QueueRow) => {
      clearUndoTimer(row.id);
      const now = new Date().toISOString();
      setState((prev) => ({
        ...prev,
        rows: prev.rows.map((item) =>
          item.id === row.id
            ? {
                ...item,
                status: 'pending',
                undoExpiresAt: undefined,
                lastChangedAt: now,
                history: [...item.history, { action: 'pending', at: now, note: 'undo' }],
              }
            : item
        ),
        currentId: row.id,
      }));
    },
    [clearUndoTimer]
  );

  const handleCopyAndOpen = useCallback(
    async (row: QueueRow) => {
      if (!row.ad.trim()) {
        push('Add post text before copying.', 'error');
        return;
      }

      const result = await copyText(row.ad);
      if (result.success) {
        push('Post text copied.', 'success');
      } else {
        push('Copy failed. Please copy manually.', 'error');
      }

      setState((prev) => ({ ...prev, currentId: row.id }));

      if (isValidHttpUrl(row.url)) {
        window.open(row.url, '_blank', 'noopener,noreferrer');
      } else if (row.url.trim()) {
        push('URL must start with http:// or https://', 'error');
      }
    },
    [push]
  );

  const handleSkip = useCallback(
    (row: QueueRow) => {
      setRowStatus(row.id, 'skipped');
      push('Marked as skipped.', 'info');
    },
    [push, setRowStatus]
  );

  const handlePosted = useCallback(
    (row: QueueRow) => {
      setRowStatus(row.id, 'posted');
      push('Marked as posted.', 'success');
    },
    [push, setRowStatus]
  );

  const handleShuffle = useCallback(() => {
    setState((prev) => {
      const pendingRows = prev.rows.filter((row) => row.status === 'pending');
      const shuffled = shuffleArray(pendingRows);
      const nextRows: QueueRow[] = [];
      let pendingIndex = 0;
      prev.rows.forEach((row) => {
        if (row.status === 'pending') {
          nextRows.push(shuffled[pendingIndex]);
          pendingIndex += 1;
        } else {
          nextRows.push(row);
        }
      });

      const nextCurrent = prev.currentId && nextRows.some((row) => row.id === prev.currentId)
        ? prev.currentId
        : setCurrentToFirstPending(nextRows);

      return { ...prev, rows: nextRows, currentId: nextCurrent };
    });
    push('Pending rows shuffled.', 'info');
  }, [push, setCurrentToFirstPending]);

  const handleSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setState((prev) => ({ ...prev, search: value }));
  }, []);

  const handleFilterChange = useCallback((filter: 'all' | RowStatusKind) => {
    setState((prev) => ({ ...prev, filter }));
  }, []);

  const handleImport = useCallback(
    (entries: ParsedCsvRow[]) => {
      if (!entries.length) {
        push('No rows detected in CSV', 'error');
        return;
      }

      setState((prev) => {
        const keyed = new Map<string, QueueRow>();
        prev.rows.forEach((row) => {
          keyed.set(makeMergeKey(row.name, row.url), row);
        });

        const merged: QueueRow[] = entries.map((entry) => {
          const key = makeMergeKey(entry.name ?? '', entry.url ?? '');
          const existing = keyed.get(key);
          const history = 'history' in entry && Array.isArray((entry as any).history) ? (entry as any).history : [];
          const status = (entry as any).status as RowStatusKind | undefined;
          const safeStatus: RowStatusKind = status && ['pending', 'posted', 'skipped', 'failed'].includes(status)
            ? status
            : existing?.status ?? 'pending';
          const id = (entry as any).id ?? existing?.id ?? createId();
          const lastChangedAt = history.length ? history[history.length - 1].at : existing?.lastChangedAt;

          return {
            id,
            name: entry.name ?? existing?.name ?? '',
            url: entry.url ?? existing?.url ?? '',
            ad: entry.ad ?? (existing?.ad ?? ''),
            status: safeStatus,
            history: history.length ? history : existing?.history ?? [],
            lastChangedAt,
          };
        });

        const nextCurrent = merged.length
          ? prev.currentId && merged.some((row) => row.id === prev.currentId)
            ? prev.currentId
            : setCurrentToFirstPending(merged)
          : null;
        return { ...prev, rows: merged, currentId: nextCurrent };
      });

      push(`Imported ${entries.length} row${entries.length === 1 ? '' : 's'}.`, 'success');
    },
    [push, setCurrentToFirstPending]
  );

  const handleCsvFile = useCallback(
    async (file: File) => {
      const text = await file.text();
      const parsed = parseCsvRows(text);
      handleImport(parsed);
    },
    [handleImport]
  );

  const handleDownloadSample = useCallback(() => {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'paste-happy-sample.csv';
    anchor.click();
    URL.revokeObjectURL(url);
    push(`Downloaded sample CSV with ${SAMPLE_CSV_ROW_COUNT} example groups.`, 'success');
  }, [push]);

  const handlePostEdit = useCallback((id: string, ad: string) => {
    updateRow(id, (row) => ({ ...row, ad }));
  }, [updateRow]);

  const handleFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleSetCurrent = useCallback((row: QueueRow) => {
    setState((prev) => ({ ...prev, currentId: row.id }));
  }, []);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 pb-10 pt-6 text-slate-100">
      <section className="-mx-4 border-b border-slate-800 bg-slate-950/95 px-4 py-3 shadow-lg shadow-slate-950/40">
        <div className="mx-auto flex max-w-5xl flex-nowrap items-center justify-start gap-2 overflow-x-auto">
          <ActionButton
            label="Copy & Open"
            tone="primary"
            size="lg"
            disabled={!currentRow}
            onClick={() => {
              if (currentRow) handleCopyAndOpen(currentRow);
            }}
          />
          <ActionButton
            label="Mark Posted"
            tone="success"
            size="lg"
            disabled={!currentRow}
            onClick={() => {
              if (currentRow) handlePosted(currentRow);
            }}
          />
          <ActionButton
            label="Skip"
            tone="muted"
            size="lg"
            disabled={!currentRow}
            onClick={() => {
              if (currentRow) handleSkip(currentRow);
            }}
          />
        </div>
      </section>
      <header className="space-y-4">
        <div className="overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-950/70 to-sky-950 shadow-xl shadow-sky-900/40">
          <div className="flex flex-col gap-6 p-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <span className="rounded-2xl bg-sky-500/10 p-3 ring-1 ring-inset ring-sky-500/30">
                <img src="/logo-fq.svg" alt="Paste Happy logo" className="h-12 w-12" />
              </span>
              <div className="space-y-3">
                <p className="inline-flex items-center gap-2 rounded-full bg-slate-900/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-sky-100 ring-1 ring-sky-500/30">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  Tutorial workspace
                </p>
                <h1 className="text-3xl font-semibold tracking-tight text-white">PasteHappy</h1>
                <div className="grid grid-cols-2 gap-3 text-sm sm:flex sm:flex-wrap">
                  <ActionPill label="Total" value={total} tone="neutral" />
                  <ActionPill label="Pending" value={counts.pending} tone="sky" />
                  <ActionPill label="Posted" value={counts.posted} tone="emerald" />
                  <ActionPill label="Skipped" value={counts.skipped} tone="amber" />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={handleFilePicker}
                className="inline-flex h-14 items-center justify-center gap-3 rounded-full border border-sky-300 bg-sky-400 px-6 text-base font-bold uppercase tracking-[0.2em] text-slate-950 shadow-lg shadow-sky-500/30 transition hover:bg-sky-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-200"
              >
                <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center">
                  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                    <path d="M3.75 6A2.25 2.25 0 0 1 6 3.75h3.39c.597 0 1.17.237 1.591.659l1.11 1.11c.14.14.33.22.53.22H18A2.25 2.25 0 0 1 20.25 8v1.136a2.75 2.75 0 0 0-1.585-.386H5.335A2.75 2.75 0 0 0 2.75 10.56V6Zm-.914 5.033A1.25 1.25 0 0 1 4.04 10.25h14.625a1.25 1.25 0 0 1 1.205 1.581l-1.595 5.467a1.25 1.25 0 0 1-1.2.9H5.629a1.25 1.25 0 0 1-1.204-.916l-1.59-5.467a1.25 1.25 0 0 1 .001-.782Z" />
                  </svg>
                </span>
                <span>Import CSV</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadSample}
                className="h-11 rounded-full border border-sky-400/50 bg-sky-500/20 px-4 text-sm font-semibold uppercase tracking-wide text-sky-50 shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
              >
                Sample CSV
              </button>
              <a
                href={FACEBOOK_GROUPS_SCANNER_SCRIPT_PATH}
                download="facebook-groups-discover-export.user.js"
                className="inline-flex h-11 items-center justify-center rounded-full border border-fuchsia-400/50 bg-fuchsia-500/15 px-4 text-sm font-semibold uppercase tracking-wide text-fuchsia-50 shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-fuchsia-400"
              >
                Download Userscript
              </a>
            </div>
          </div>
        </div>

        <section>
          <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-5 shadow-lg shadow-slate-950/30">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <h2 className="text-xl font-semibold text-white">Tutorial</h2>
              </div>
              <span className="rounded-full bg-slate-900 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-200 ring-1 ring-slate-700">
                Top to bottom
              </span>
            </div>

            <div className="mt-5 space-y-4">
              <p className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                You can download the sample CSV and import it to see how Paste Happy works, or adapt it for your own Facebook groups and ads by following the tutorial below.
              </p>
              {TUTORIAL_SECTIONS.map((section) => (
                <article key={section.title} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
                  <h3 className="text-base font-semibold text-white">{section.title}</h3>
                  <p className="mt-2 text-sm text-slate-300">{section.description}</p>
                  <ol className="mt-3 space-y-2 text-sm text-slate-200">
                    {section.items.map((item) => (
                      <li key={item} className="flex gap-3">
                        <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-[11px] font-bold text-sky-200 ring-1 ring-sky-500/30">
                          •
                        </span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ol>
                  {section.note && (
                    <p className="mt-3 rounded-2xl border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-xs text-sky-100">
                      {section.note}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </div>
        </section>
      </header>

      <section className="sticky top-0 z-20 -mx-4 border-y border-slate-800 bg-slate-950/90 px-4 py-3 backdrop-blur">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide">
            {(['all', 'pending', 'posted', 'skipped', 'failed'] as const).map((filterKey) => {
              const active = state.filter === filterKey;
              return (
                <button
                  key={filterKey}
                  type="button"
                  onClick={() => handleFilterChange(filterKey)}
                  className={`h-11 rounded-full border px-4 shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 ${
                    active ? 'border-sky-500/60 bg-sky-500/15 text-sky-100' : 'border-slate-700 bg-slate-900'
                  }`}
                >
                  {filterKey === 'all' ? 'All' : filterKey[0].toUpperCase() + filterKey.slice(1)}
                </button>
              );
            })}
          </div>
          <div className="flex flex-col gap-2 md:flex-1 md:flex-row md:items-center md:gap-3 md:pl-4">
            <input
              type="search"
              value={state.search}
              onChange={handleSearchChange}
              placeholder="Search group or URL"
              className="h-11 w-full flex-1 rounded-full border border-slate-700 bg-slate-900 px-4 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
            />
            <button
              type="button"
              onClick={handleShuffle}
              className="h-11 w-full rounded-full border border-slate-700 bg-slate-900 px-4 text-sm font-semibold uppercase tracking-wide shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 md:w-auto"
            >
              Shuffle pending
            </button>
          </div>
        </div>
      </section>

      <main className="space-y-3">
        {filteredRows.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-700 bg-slate-900/60 p-6 text-sm text-slate-300">
            Import a CSV with group names, URLs, and post text to start working through the queue.
          </p>
        )}

        <div className="hidden overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/60 md:block">
          <table className="min-w-full divide-y divide-slate-800 text-sm">
            <thead className="bg-slate-900/60 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Group</th>
                <th className="px-4 py-3">Post text</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filteredRows.map((row) => (
                <RowItem
                  key={row.id}
                  row={row}
                  active={row.id === state.currentId}
                  onCopyOpen={() => handleCopyAndOpen(row)}
                  onPosted={() => handlePosted(row)}
                  onSkip={() => handleSkip(row)}
                  onUndo={() => handleUndo(row)}
                  onEdit={(text) => handlePostEdit(row.id, text)}
                  onSelect={() => handleSetCurrent(row)}
                />
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-3 md:hidden">
          {filteredRows.map((row) => (
            <RowCard
              key={row.id}
              row={row}
              active={row.id === state.currentId}
              onCopyOpen={() => handleCopyAndOpen(row)}
              onPosted={() => handlePosted(row)}
              onSkip={() => handleSkip(row)}
              onUndo={() => handleUndo(row)}
              onEdit={(text) => handlePostEdit(row.id, text)}
              onSelect={() => handleSetCurrent(row)}
            />
          ))}
        </div>
      </main>

      <footer className="text-center text-xs text-slate-500">
        by Devskits916
      </footer>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            handleCsvFile(file);
            event.target.value = '';
          }
        }}
      />
    </div>
  );
}

function RowItem({
  row,
  active,
  onCopyOpen,
  onPosted,
  onSkip,
  onUndo,
  onEdit,
  onSelect,
}: {
  row: QueueRow;
  active: boolean;
  onCopyOpen: () => void;
  onPosted: () => void;
  onSkip: () => void;
  onUndo: () => void;
  onEdit: (text: string) => void;
  onSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.ad);

  useEffect(() => {
    setDraft(row.ad);
  }, [row.ad]);

  const showUndo = row.undoExpiresAt !== undefined && row.undoExpiresAt > Date.now();

  return (
    <tr className={`transition ${active ? 'bg-slate-900/80' : 'bg-transparent'}`}>
      <td className="px-4 py-4 align-top">
        <div className="flex flex-col gap-2">
          <StatusBadge status={row.status} />
          {showUndo && (
            <button
              type="button"
              onClick={onUndo}
              className="text-xs font-semibold text-sky-300 underline-offset-2 hover:underline"
            >
              Undo
            </button>
          )}
        </div>
      </td>
      <td className="px-4 py-4 align-top">
        <button type="button" onClick={onSelect} className="text-left">
          <p className="text-sm font-semibold">{row.name || 'Untitled group'}</p>
          <p className="text-xs text-slate-400 break-words">{row.url || 'No URL'}</p>
          {row.lastChangedAt && (
            <p className="mt-1 text-xs text-slate-500">Updated {new Date(row.lastChangedAt).toLocaleString()}</p>
          )}
        </button>
      </td>
      <td className="px-4 py-4 align-top">
        <div className="space-y-2">
          {!editing && (
            <>
              <p className={`text-sm text-slate-100 ${expanded ? 'whitespace-pre-wrap' : 'line-clamp-3 whitespace-pre-wrap'}`}>
                {row.ad || 'No post text yet.'}
              </p>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setExpanded((prev) => !prev)}
                  className="font-semibold text-sky-300 underline-offset-2 hover:underline"
                >
                  {expanded ? 'Collapse' : 'Expand'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="font-semibold text-sky-300 underline-offset-2 hover:underline"
                >
                  Edit text
                </button>
              </div>
            </>
          )}
          {editing && (
            <div className="space-y-2">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                className="min-h-[120px] w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
              />
              <div className="flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    onEdit(draft);
                    setEditing(false);
                  }}
                  className="rounded-full border border-emerald-500/60 bg-emerald-500/15 px-4 py-2 font-semibold uppercase tracking-wide text-emerald-100"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(row.ad);
                    setEditing(false);
                  }}
                  className="rounded-full border border-slate-700 bg-slate-900 px-4 py-2 font-semibold uppercase tracking-wide"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </td>
      <td className="px-4 py-4 align-top">
        <div className="flex flex-col gap-2">
          <ActionButton label="Copy & Open" tone="primary" onClick={onCopyOpen} />
          <ActionButton label="Mark Posted" tone="success" onClick={onPosted} />
          <ActionButton label="Skip" tone="muted" onClick={onSkip} />
        </div>
      </td>
    </tr>
  );
}

function RowCard({
  row,
  active,
  onCopyOpen,
  onPosted,
  onSkip,
  onUndo,
  onEdit,
  onSelect,
}: {
  row: QueueRow;
  active: boolean;
  onCopyOpen: () => void;
  onPosted: () => void;
  onSkip: () => void;
  onUndo: () => void;
  onEdit: (text: string) => void;
  onSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.ad);

  useEffect(() => {
    setDraft(row.ad);
  }, [row.ad]);

  const showUndo = row.undoExpiresAt !== undefined && row.undoExpiresAt > Date.now();

  return (
    <div
      className={`rounded-2xl border bg-slate-950/70 p-4 shadow transition ${
        active ? 'border-sky-600/60 ring-1 ring-sky-500/40' : 'border-slate-800'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <button type="button" onClick={onSelect} className="text-left">
            <p className="text-base font-semibold leading-tight">{row.name || 'Untitled group'}</p>
            <p className="text-xs text-slate-400 break-words">{row.url || 'No URL'}</p>
            {row.lastChangedAt && (
              <p className="mt-1 text-xs text-slate-500">Updated {new Date(row.lastChangedAt).toLocaleString()}</p>
            )}
          </button>
          <div className="flex items-center gap-2 text-xs">
            <StatusBadge status={row.status} />
            {showUndo && (
              <button
                type="button"
                onClick={onUndo}
                className="font-semibold text-sky-300 underline-offset-2 hover:underline"
              >
                Undo
              </button>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs font-semibold uppercase tracking-wide"
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {!editing && (
          <>
            <p className={`text-sm text-slate-100 ${expanded ? 'whitespace-pre-wrap' : 'line-clamp-4 whitespace-pre-wrap'}`}>
              {row.ad || 'No post text yet.'}
            </p>
            <div className="flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="font-semibold text-sky-300 underline-offset-2 hover:underline"
              >
                Edit text
              </button>
              <button
                type="button"
                onClick={onCopyOpen}
                className="font-semibold text-sky-300 underline-offset-2 hover:underline"
              >
                Copy now
              </button>
            </div>
          </>
        )}
        {editing && (
          <div className="space-y-2">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="min-h-[120px] w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
            />
            <div className="flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  onEdit(draft);
                  setEditing(false);
                }}
                className="rounded-full border border-emerald-500/60 bg-emerald-500/15 px-4 py-2 font-semibold uppercase tracking-wide text-emerald-100"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(row.ad);
                  setEditing(false);
                }}
                className="rounded-full border border-slate-700 bg-slate-900 px-4 py-2 font-semibold uppercase tracking-wide"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <ActionButton label="Copy & Open" tone="primary" onClick={onCopyOpen} />
        <ActionButton label="Mark Posted" tone="success" onClick={onPosted} />
        <ActionButton label="Skip" tone="muted" onClick={onSkip} />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: RowStatusKind }) {
  const styles: Record<RowStatusKind, string> = {
    pending: 'border-slate-700 bg-slate-800 text-slate-200',
    posted: 'border-emerald-500/60 bg-emerald-500/10 text-emerald-100',
    skipped: 'border-amber-500/60 bg-amber-500/10 text-amber-100',
    failed: 'border-rose-500/60 bg-rose-500/10 text-rose-100',
  };
  const label: Record<RowStatusKind, string> = {
    pending: 'Pending',
    posted: 'Posted',
    skipped: 'Skipped',
    failed: 'Failed',
  };
  return (
    <span className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${styles[status]}`}>
      {label[status]}
    </span>
  );
}

function ActionPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'neutral' | 'sky' | 'emerald' | 'amber';
}) {
  const toneStyles: Record<'neutral' | 'sky' | 'emerald' | 'amber', string> = {
    neutral: 'border-slate-700 bg-slate-900 text-slate-100',
    sky: 'border-sky-500/50 bg-sky-500/10 text-sky-50',
    emerald: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-50',
    amber: 'border-amber-500/50 bg-amber-500/10 text-amber-50',
  };

  return (
    <div className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${toneStyles[tone]}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function ActionButton({
  label,
  tone,
  onClick,
  size = 'md',
  disabled = false,
}: {
  label: string;
  tone: 'primary' | 'success' | 'muted' | 'danger';
  onClick: () => void;
  size?: 'md' | 'lg';
  disabled?: boolean;
}) {
  const styles: Record<'primary' | 'success' | 'muted' | 'danger', string> = {
    primary: 'border-sky-500/60 bg-sky-500/15 text-sky-100',
    success: 'border-emerald-500/60 bg-emerald-500/15 text-emerald-100',
    muted: 'border-slate-700 bg-slate-900 text-slate-100',
    danger: 'border-rose-500/60 bg-rose-500/15 text-rose-100',
  } as const;

  const sizeStyles: Record<'md' | 'lg', string> = {
    md: 'px-4 py-2 text-sm sm:min-w-[9rem]',
    lg: 'px-5 py-3 text-base sm:min-w-[10.5rem]',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full rounded-full border font-semibold uppercase tracking-wide shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-slate-900/70 disabled:text-slate-500 disabled:shadow-none sm:w-auto ${sizeStyles[size]} ${styles[tone]}`}
    >
      {label}
    </button>
  );
}

function makeMergeKey(name: string, url: string): string {
  return `${name.trim().toLowerCase()}|${url.trim().toLowerCase()}`;
}

function shuffleArray<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function escapeCsvValue(value: string): string {
  if (value.includes(',') || value.includes('\n') || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

export default function App() {
  return (
    <ToastProvider>
      <InnerApp />
    </ToastProvider>
  );
}
