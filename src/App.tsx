import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ToastProvider, useToast } from './components/Toast';
import { copyText } from './lib/clipboard';
import { ParsedCsvRow, parseCsvRows } from './lib/csv';
import { createId } from './lib/id';
import { loadState, saveState } from './lib/storage';
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

const SAMPLE_ROWS: Array<Pick<QueueRow, 'name' | 'url' | 'ad'>> = [
  {
    name: 'Remote Work Allies',
    url: 'https://www.facebook.com/groups/remoteworkallies',
    ad: 'Hi everyone! We are sharing a toolkit for finding flexible roles this month.',
  },
  {
    name: 'Makers & Builders Hub',
    url: 'https://www.facebook.com/groups/makersbuilders',
    ad: 'Weekly build thread is live—drop your latest demo and feedback requests here!',
  },
  {
    name: 'Growth Experiments Lab',
    url: 'https://www.facebook.com/groups/growthexperiments',
    ad: 'We are opening a beta list for our outreach automation—DMs welcome for invites.',
  },
  {
    name: 'SaaS Launchpad',
    url: 'https://www.facebook.com/groups/saaslaunchpad',
    ad: 'Launching a new scheduling feature this week. Would love early testers!',
  },
  {
    name: 'Community Builders Collective',
    url: 'https://www.facebook.com/groups/communitybuilderscollective',
    ad: 'Looking for moderators to trial our onboarding templates—details inside.',
  },
  {
    name: 'Design Feedback Circle',
    url: 'https://www.facebook.com/groups/designfeedbackcircle',
    ad: 'Sharing updated UI mockups for comments. Honest critique appreciated!',
  },
  {
    name: 'No-Code Ninjas',
    url: 'https://www.facebook.com/groups/nocodeninjas',
    ad: 'New tutorial on automating lead capture with Airtable and Zapier—grab the guide.',
  },
  {
    name: 'Agency Growth Guild',
    url: 'https://www.facebook.com/groups/agencygrowthguild',
    ad: 'Offering 3 case study reviews this week—comment if you want a slot.',
  },
  {
    name: 'AI Tools Daily',
    url: 'https://www.facebook.com/groups/aitoolsdaily',
    ad: 'Sharing prompts that helped us halve response times. Copy/paste friendly!',
  },
  {
    name: 'Founders Helping Founders',
    url: 'https://www.facebook.com/groups/foundershelpingfounders',
    ad: 'If you are hiring part-time SDRs, we compiled a shortlist—DM for the doc.',
  },
];

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

  const handleDelete = useCallback(
    (row: QueueRow) => {
      clearUndoTimer(row.id);
      setState((prev) => {
        const remaining = prev.rows.filter((item) => item.id !== row.id);
        const nextId = findNextPendingId(remaining, row.id) ?? setCurrentToFirstPending(remaining);
        return { ...prev, rows: remaining, currentId: nextId };
      });
      push('Removed group from session.', 'info');
    },
    [clearUndoTimer, findNextPendingId, push, setCurrentToFirstPending]
  );

  const handlePosted = useCallback(
    (row: QueueRow) => {
      setRowStatus(row.id, 'posted');
      push('Marked as posted.', 'success');
    },
    [push, setRowStatus]
  );

  const handleReset = useCallback(() => {
    Object.values(undoTimers.current).forEach((timer) => clearTimeout(timer));
    undoTimers.current = {};
    setState({ rows: [], currentId: null, filter: 'all', search: '' });
    saveState(STORAGE_KEY, { rows: [], currentId: null, filter: 'all', search: '' });
    push('Session reset.', 'info');
  }, [push]);

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

  const handleExportLog = useCallback(() => {
    if (!state.rows.length) {
      push('Nothing to export yet.', 'info');
      return;
    }
    const header = ['Group Name', 'Group URL', 'Final Status', 'Timestamp'];
    const csv = [
      header,
      ...state.rows.map((row) => {
        const timestamp = row.lastChangedAt || row.history[row.history.length - 1]?.at || '';
        return [row.name, row.url, row.status, timestamp].map(escapeCsvValue);
      }),
    ]
      .map((columns) => columns.join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `paste-happy-log-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    push('Exported log CSV.', 'success');
  }, [push, state.rows]);

  const handleExportRemaining = useCallback(() => {
    const remaining = state.rows.filter((row) => row.status !== 'posted');
    if (!remaining.length) {
      push('All rows are marked as posted. Nothing to export.', 'info');
      return;
    }

    const header = ['Group Name', 'Group URL', 'Post Text', 'Status', 'Timestamp'];
    const csv = [
      header,
      ...remaining.map((row) => {
        const timestamp = row.lastChangedAt || row.history[row.history.length - 1]?.at || '';
        return [row.name, row.url, row.ad, row.status, timestamp].map(escapeCsvValue);
      }),
    ]
      .map((columns) => columns.join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `paste-happy-remaining-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    push('Exported remaining rows.', 'success');
  }, [push, state.rows]);

  const handleDownloadSample = useCallback(() => {
    const header = ['Group Name', 'Group URL', 'Post Text'];
    const csv = [header, ...SAMPLE_ROWS.map((row) => [row.name, row.url, row.ad].map(escapeCsvValue))]
      .map((columns) => columns.join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'paste-happy-sample.csv';
    anchor.click();
    URL.revokeObjectURL(url);
    push('Downloaded sample CSV with 10 example groups.', 'success');
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

  const handlePasteCsv = useCallback(() => {
    const text = window.prompt('Paste CSV contents');
    if (!text) return;
    const parsed = parseCsvRows(text);
    handleImport(parsed);
  }, [handleImport]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 pb-28 pt-6 text-slate-100">
      <header className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo-fq.svg" alt="Paste Happy logo" className="h-12 w-12 rounded-2xl shadow-lg shadow-sky-900/40" />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Paste Happy</h1>
              <p className="text-sm text-slate-400">Manage Facebook group posting runs without losing your place.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleDownloadSample}
              className="h-11 rounded-full border border-sky-600/60 bg-sky-500/20 px-4 text-sm font-semibold uppercase tracking-wide text-sky-50 shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
            >
              Download Sample CSV
            </button>
            <button
              type="button"
              onClick={handleFilePicker}
              className="h-11 rounded-full border border-slate-700 bg-slate-900 px-4 text-sm font-semibold uppercase tracking-wide shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
            >
              Import CSV
            </button>
            <button
              type="button"
              onClick={handlePasteCsv}
              className="h-11 rounded-full border border-slate-700 bg-slate-900 px-4 text-sm font-semibold uppercase tracking-wide shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
            >
              Paste CSV
            </button>
            <button
              type="button"
              onClick={handleExportLog}
              className="h-11 rounded-full border border-slate-700 bg-slate-900 px-4 text-sm font-semibold uppercase tracking-wide shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
            >
              Export Log as CSV
            </button>
            <button
              type="button"
              onClick={handleExportRemaining}
              className="h-11 rounded-full border border-slate-700 bg-slate-900 px-4 text-sm font-semibold uppercase tracking-wide shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
            >
              Export Remaining CSV
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="h-11 rounded-full border border-rose-500/70 bg-rose-500/15 px-4 text-sm font-semibold uppercase tracking-wide text-rose-100 shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400"
            >
              Reset Session
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Total" value={total} />
            <Stat label="Posted" value={counts.posted} />
            <Stat label="Skipped" value={counts.skipped} />
            <Stat label="Pending" value={counts.pending} />
          </dl>
          <div className="mt-4 space-y-2">
            <div className="flex justify-between text-xs uppercase tracking-wide text-slate-400">
              <span>Progress</span>
              <span>
                {counts.posted} / {total || 1} posted
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-full border border-slate-800 bg-slate-900">
              <div
                className="h-full bg-emerald-500"
                style={{ width: `${total ? Math.min(100, (counts.posted / total) * 100) : 0}%` }}
              />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-200">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <h2 className="text-base font-semibold text-white">How to use Paste Happy</h2>
              <ol className="list-decimal space-y-2 pl-5">
                <li>
                  Download the sample CSV above or prepare your own with <strong>Group Name</strong>, <strong>Group URL</strong>, and
                  <strong>Post Text</strong> columns.
                </li>
                <li>Import or paste the CSV to load rows. The app keeps your place automatically in your browser.</li>
                <li>Click a row, use <strong>Copy &amp; Open</strong> to copy the post text, and update its status as you go.</li>
                <li>Use <strong>Export Log</strong> to save outcomes or <strong>Export Remaining</strong> to continue later.</li>
              </ol>
            </div>
            <span className="rounded-full bg-sky-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-sky-200">Agent &amp; human ready</span>
          </div>
        </div>
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
            Import a CSV to start managing your run.
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

      {currentRow && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-800 bg-slate-950/95 px-4 py-3 shadow-2xl backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-100">{currentRow.name || 'Untitled group'}</p>
              <p className="truncate text-xs text-slate-400">{currentRow.url || 'No URL provided'}</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-2">
              <ActionButton
                label="Copy & Open"
                tone="primary"
                size="lg"
                onClick={() => handleCopyAndOpen(currentRow)}
              />
              <ActionButton
                label="Mark Posted"
                tone="success"
                size="lg"
                onClick={() => handlePosted(currentRow)}
              />
              <ActionButton label="Skip" tone="muted" size="lg" onClick={() => handleSkip(currentRow)} />
              <ActionButton
                label="Delete from CSV"
                tone="danger"
                size="lg"
                onClick={() => handleDelete(currentRow)}
              />
            </div>
          </div>
        </div>
      )}

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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-center">
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold">{value}</dd>
    </div>
  );
}

function ActionButton({
  label,
  tone,
  onClick,
  size = 'md',
}: {
  label: string;
  tone: 'primary' | 'success' | 'muted' | 'danger';
  onClick: () => void;
  size?: 'md' | 'lg';
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
      className={`w-full rounded-full border font-semibold uppercase tracking-wide shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 sm:w-auto ${sizeStyles[size]} ${styles[tone]}`}
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

