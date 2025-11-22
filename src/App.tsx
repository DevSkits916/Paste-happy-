import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ToastProvider, useToast } from './components/Toast';
import { Toggle } from './components/Toggle';
import { copyText, probeClipboardPermission } from './lib/clipboard';
import { encodePostCopyToUriComponent } from './lib/pasteHappyEncode';
import { createCsv, ParsedCsvRow, parseCsvRows } from './lib/csv';
import { createId } from './lib/id';
import { loadState, saveState } from './lib/storage';
import { RowHistoryEntry, RowStatusKind } from './lib/types';

interface RowStatus {
  type: RowStatusKind;
  reason?: string;
}

interface GroupRow {
  id: string;
  name: string;
  url: string;
  ad: string;
  tags: string[];
  cooldownHours: number;
  retries: number;
  lastPostedAt?: string;
  nextEligibleAt?: string;
  status: RowStatus;
  history: RowHistoryEntry[];
}

interface QueueFilters {
  search: string;
  tags: string[];
}

interface QueueState {
  order: string[];
  cursor: number;
  paused: boolean;
  shuffleSeed: number | null;
  filters: QueueFilters;
}

interface AppState {
  rows: GroupRow[];
  queue: QueueState;
}

const STORAGE_KEY = 'fb-group-queue-state-v2';
const DEFAULT_COOLDOWN_HOURS = 24;

const SAMPLE_CSV = `ID,Group Name,Group URL,Ad,Tags,CooldownHours,Retries,LastPostedAt,NextEligibleAt,Status,FailureReason,History\n,Neighborhood Buy Nothing,https://www.facebook.com/groups/example/,"Hi neighbors! Loki and I are sharing resources: https://gofund.me/9aada7036","mutual aid|neighborhood",24,0,,,pending,,[]`;

function InnerApp() {
  const { push } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [state, setState] = useState<AppState>(() =>
    typeof window !== 'undefined'
      ? loadState<AppState>(STORAGE_KEY, {
          rows: [],
          queue: {
            order: [],
            cursor: 0,
            paused: false,
            shuffleSeed: null,
            filters: { search: '', tags: [] },
          },
        })
      : {
          rows: [],
          queue: { order: [], cursor: 0, paused: false, shuffleSeed: null, filters: { search: '', tags: [] } },
        }
  );
  const [lastPermissionCheck, setLastPermissionCheck] = useState<string>('');

  useEffect(() => {
    saveState(STORAGE_KEY, state);
  }, [state]);

  const visibleTags = useMemo(() => {
    const all = new Set<string>();
    state.rows.forEach((row) => {
      row.tags.forEach((tag) => all.add(tag));
    });
    return Array.from(all).sort((a, b) => a.localeCompare(b));
  }, [state.rows]);

  const activeOrder = useMemo(
    () => computeActiveOrder(state.rows, state.queue),
    [state.rows, state.queue.order]
  );

  const filteredOrder = useMemo(
    () => computeFilteredOrder(state.rows, state.queue),
    [state.rows, state.queue.order, state.queue.filters.search, state.queue.filters.tags]
  );

  const currentRow = useMemo(() => {
    if (!filteredOrder.length) return undefined;
    const safeCursor = Math.min(state.queue.cursor, filteredOrder.length - 1);
    const row = state.rows.find((item) => item.id === filteredOrder[safeCursor]);
    return row ?? undefined;
  }, [filteredOrder, state.queue.cursor, state.rows]);

  useEffect(() => {
    setState((prev) => ({
      ...prev,
      queue: {
        ...prev.queue,
        order: activeOrder,
        cursor: Math.min(prev.queue.cursor, Math.max(activeOrder.length - 1, 0)),
      },
    }));
  }, [activeOrder.length]);

  const now = Date.now();
  const progressStats = useMemo(() => {
    const totals = { pending: 0, opened: 0, posted: 0, verified: 0, failed: 0 };
    state.rows.forEach((row) => {
      switch (row.status.type) {
        case 'verified':
          totals.verified += 1;
          break;
        case 'posted':
          totals.posted += 1;
          break;
        case 'opened':
          totals.opened += 1;
          break;
        case 'failed':
          totals.failed += 1;
          break;
        default:
          totals.pending += 1;
      }
    });
    return totals;
  }, [state.rows]);

  const cooldownBadge = currentRow ? getCooldownDetails(currentRow, now) : undefined;

  const updateRow = useCallback((id: string, updater: (row: GroupRow) => GroupRow) => {
    setState((prev) => ({
      ...prev,
      rows: prev.rows.map((row) => (row.id === id ? updater(row) : row)),
    }));
  }, []);

  const advanceCursor = useCallback((afterIndex?: number) => {
    setState((prev) => {
      const order = computeFilteredOrder(prev.rows, prev.queue);
      if (!order.length) {
        return {
          ...prev,
          queue: { ...prev.queue, cursor: 0 },
        };
      }
      const startingIndex = typeof afterIndex === 'number' ? afterIndex : prev.queue.cursor;
      const nextIndex = findNextEligibleIndex(order, startingIndex, prev.rows);
      return {
        ...prev,
        queue: {
          ...prev.queue,
          cursor: nextIndex,
        },
      };
    });
  }, []);

  const handleCopyAndOpen = useCallback(async () => {
    if (!currentRow) {
      push('Nothing queued right now.', 'info');
      return;
    }

    if (!currentRow.ad.trim()) {
      push('Add post copy before copying.', 'error');
      return;
    }

    const cooldown = getCooldownDetails(currentRow, Date.now());
    if (cooldown?.blocked) {
      push(`Cooldown active for ${cooldown.label}.`, 'error');
      return;
    }

    const permission = await probeClipboardPermission();
    if (permission === 'denied') {
      push('Clipboard permission denied. Long-press to paste manually.', 'error');
    } else if (permission === 'prompt' && lastPermissionCheck !== currentRow.id) {
      push('Clipboard permission prompt incoming.', 'info');
      setLastPermissionCheck(currentRow.id);
    }

    const copyPromise = copyText(currentRow.ad);
    updateRow(
      currentRow.id,
      (row) =>
        appendHistory(
          {
            ...row,
            status: { type: 'copied' },
          },
          'copied'
        )
    );

    let nextTabUrl: string | null = null;

    if (isValidHttpUrl(currentRow.url)) {
      const payload = encodePostCopyToUriComponent(currentRow.ad);
      nextTabUrl =
        currentRow.url +
        (currentRow.url.includes('#') ? '&' : '#') +
        `ph=1&ph_post=${payload}&ph_visit=${Date.now()}`;
    } else if (currentRow.url.trim()) {
      push('URL must start with http:// or https://', 'error');
    }

    const result = await copyPromise;
    if (result.success) {
      push(result.method === 'navigator' ? 'Copied via clipboard API.' : 'Copied via fallback selection.', 'success');

      if (nextTabUrl) {
        window.open(nextTabUrl, '_blank', 'noopener,noreferrer');
        updateRow(currentRow.id, (row) => appendHistory({ ...row, status: { type: 'opened' } }, 'opened'));
      }
    } else {
      push('Copy failed. Please copy manually.', 'error');
      updateRow(currentRow.id, (row) => appendHistory({ ...row, status: { type: 'failed', reason: 'copy-failed' } }, 'failed', 'Copy failed'));
    }
  }, [currentRow, lastPermissionCheck, push, updateRow]);

  const handleOpenNewWorkspaceTab = useCallback(() => {
    window.open(window.location.href, '_blank', 'noopener,noreferrer');
    push('Opened Paste Happy in a new tab.', 'info');
  }, [push]);

  const handleMarkPosted = useCallback(() => {
    if (!currentRow) {
      return;
    }
    const postedAt = new Date().toISOString();
    const jitterMinutes = computeJitterMinutes(currentRow.cooldownHours);
    const nextEligible = new Date(Date.now() + currentRow.cooldownHours * 3600_000 + jitterMinutes * 60_000).toISOString();

    updateRow(currentRow.id, (row) => {
      const withPosted = appendHistory({ ...row, status: { type: 'posted' } }, 'posted');
      const verified: GroupRow = {
        ...withPosted,
        status: { type: 'verified' },
        lastPostedAt: postedAt,
        nextEligibleAt: nextEligible,
        retries: row.retries,
      };
      return appendHistory(verified, 'verified', `Cooldown ${row.cooldownHours}h + ${jitterMinutes}m jitter`);
    });
    push('Marked as posted and verified.', 'success');

    if (!state.queue.paused) {
      advanceCursor();
    }
  }, [advanceCursor, currentRow, push, state.queue.paused, updateRow]);

  const handleSkip = useCallback(() => {
    if (!currentRow) return;
    updateRow(currentRow.id, (row) => appendHistory(row, 'skip'));
    setState((prev) => {
      const id = currentRow.id;
      const baseOrder = prev.queue.order.length ? prev.queue.order : prev.rows.map((row) => row.id);
      const nextOrder = baseOrder.filter((item) => item !== id);
      nextOrder.push(id);
      return {
        ...prev,
        queue: {
          ...prev.queue,
          order: nextOrder,
          cursor: Math.min(prev.queue.cursor, Math.max(nextOrder.length - 1, 0)),
        },
      };
    });
    push('Skipped and moved to back of queue.', 'info');
    advanceCursor();
  }, [advanceCursor, currentRow, filteredOrder, push, updateRow]);

  const handleRetry = useCallback(
    (row: GroupRow) => {
      updateRow(row.id, (current) => {
        const reset: GroupRow = {
          ...current,
          status: { type: 'pending' },
          retries: current.retries + 1,
          nextEligibleAt: undefined,
        };
        return appendHistory(reset, 'retry');
      });
      push('Row reset to pending.', 'success');
    },
    [push, updateRow]
  );

  const handleFailRow = useCallback(
    (row: GroupRow) => {
      const reason = window.prompt('What went wrong? Provide a short note.');
      if (!reason) return;
      updateRow(row.id, (current) => appendHistory({ ...current, status: { type: 'failed', reason } }, 'failed', reason));
      push('Marked as failed.', 'error');
      if (currentRow?.id === row.id && !state.queue.paused) {
        advanceCursor();
      }
    },
    [advanceCursor, currentRow?.id, push, state.queue.paused, updateRow]
  );

  const handleChangeCooldown = useCallback(
    (row: GroupRow, hours: number) => {
      updateRow(row.id, (current) => ({ ...current, cooldownHours: Math.max(0, hours) }));
    },
    [updateRow]
  );

  const handleTagToggle = useCallback(
    (row: GroupRow, tag: string) => {
      const hasTag = row.tags.includes(tag);
      updateRow(row.id, (current) => ({
        ...current,
        tags: hasTag ? current.tags.filter((item) => item !== tag) : [...current.tags, tag],
      }));
    },
    [updateRow]
  );

  const handleAddTag = useCallback(
    (row: GroupRow) => {
      const tag = window.prompt('Add a tag');
      if (!tag) return;
      const safe = tag.trim();
      if (!safe) return;
      updateRow(row.id, (current) => ({ ...current, tags: Array.from(new Set([...current.tags, safe])) }));
    },
    [updateRow]
  );

  const handleSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setState((prev) => ({
      ...prev,
      queue: {
        ...prev.queue,
        cursor: 0,
        filters: { ...prev.queue.filters, search: value },
      },
    }));
  }, []);

  const handleTagFilterToggle = useCallback((tag: string) => {
    setState((prev) => {
      const has = prev.queue.filters.tags.includes(tag);
      const tags = has ? prev.queue.filters.tags.filter((item) => item !== tag) : [...prev.queue.filters.tags, tag];
      return {
        ...prev,
        queue: { ...prev.queue, cursor: 0, filters: { ...prev.queue.filters, tags } },
      };
    });
  }, []);

  const handlePauseToggle = useCallback((paused: boolean) => {
    setState((prev) => ({
      ...prev,
      queue: { ...prev.queue, paused },
    }));
  }, []);

  const handleShuffle = useCallback(() => {
    const seed = Date.now();
    const shuffled = shuffleWithSeed(filteredOrder, seed);
    setState((prev) => ({
      ...prev,
      queue: { ...prev.queue, order: shuffled, cursor: 0, shuffleSeed: seed },
    }));
    push('Queue shuffled.', 'info');
  }, [filteredOrder, push]);

  const importRows = useCallback(
    (entries: ParsedCsvRow[]) => {
      if (!entries.length) {
        push('No rows detected in CSV', 'error');
        return;
      }

      setState((prev) => {
        const existingById = new Map(prev.rows.map((row) => [row.id, row] as const));
        const merged: GroupRow[] = entries.map((entry) => {
          const base: GroupRow = existingById.get(entry.id ?? '') ?? {
            id: entry.id ?? createId(),
            name: '',
            url: '',
            ad: '',
            tags: [],
            cooldownHours: DEFAULT_COOLDOWN_HOURS,
            retries: 0,
            status: { type: 'pending' },
            history: [],
          };

          const status: RowStatus = entry.status
            ? entry.status === 'failed'
              ? { type: 'failed', reason: entry.failureReason }
              : { type: entry.status }
            : base.status.type === 'failed'
            ? base.status
            : { type: 'pending' };

          return {
            ...base,
            name: entry.name ?? base.name,
            url: entry.url ?? base.url,
            ad: entry.ad ?? base.ad,
            tags: entry.tags?.length ? Array.from(new Set(entry.tags)) : base.tags,
            cooldownHours: entry.cooldownHours ?? base.cooldownHours ?? DEFAULT_COOLDOWN_HOURS,
            retries: entry.retries ?? base.retries ?? 0,
            lastPostedAt: entry.lastPostedAt ?? base.lastPostedAt,
            nextEligibleAt: entry.nextEligibleAt ?? base.nextEligibleAt,
            status,
            history: entry.history?.length ? entry.history : base.history ?? [],
          };
        });

        const mergedOrder = merged.map((row) => row.id);
        return {
          rows: merged,
          queue: {
            ...prev.queue,
            order: mergedOrder,
            cursor: 0,
          },
        };
      });
      push(`Imported ${entries.length} row${entries.length === 1 ? '' : 's'}.`, 'success');
    },
    [push]
  );

  const handleCsvFile = useCallback(
    async (file: File) => {
      const text = await file.text();
      const parsed = parseCsvRows(text);
      importRows(parsed);
    },
    [importRows]
  );

  const handleExport = useCallback(() => {
    if (!state.rows.length) {
      push('Nothing to export yet.', 'info');
      return;
    }
    const csv = createCsv(
      state.rows.map((row) => ({
        id: row.id,
        name: row.name,
        url: row.url,
        ad: row.ad,
        tags: row.tags,
        cooldownHours: row.cooldownHours,
        retries: row.retries,
        lastPostedAt: row.lastPostedAt,
        nextEligibleAt: row.nextEligibleAt,
        status: row.status.type,
        failureReason: row.status.type === 'failed' ? row.status.reason : undefined,
        history: row.history,
      }))
    );
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fb-queue-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    push('Exported CSV.', 'success');
  }, [push, state.rows]);

  const handleManualAdd = useCallback(() => {
    const name = window.prompt('Group name?')?.trim();
    if (!name) return;
    const url = window.prompt('Group URL? (https://...)')?.trim() ?? '';
    const ad = window.prompt('Paste the post copy')?.trim() ?? '';
    const newRow: GroupRow = {
      id: createId(),
      name,
      url,
      ad,
      tags: [],
      cooldownHours: DEFAULT_COOLDOWN_HOURS,
      retries: 0,
      status: { type: 'pending' },
      history: [],
    };
    setState((prev) => ({
      rows: [...prev.rows, newRow],
      queue: { ...prev.queue, order: [...prev.queue.order, newRow.id] },
    }));
    push('Added row to queue.', 'success');
  }, [push]);

  const handleFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 pb-24 pt-6 text-slate-100">
      <header className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">FB Group Queue</h1>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleManualAdd}
              className="rounded-full border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-semibold uppercase tracking-wide shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
            >
              Add row
            </button>
            <button
              type="button"
              onClick={handleFilePicker}
              className="rounded-full border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-semibold uppercase tracking-wide shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
            >
              Import CSV
            </button>
            <button
              type="button"
              onClick={handleExport}
              className="rounded-full border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-semibold uppercase tracking-wide shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
            >
              Export CSV
            </button>
            <a
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE_CSV)}`}
              download="fb-queue-sample.csv"
              className="rounded-full border border-slate-800 bg-slate-950 px-4 py-3 text-sm font-semibold uppercase tracking-wide focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
            >
              Sample CSV
            </a>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          <Stat label="Pending" value={progressStats.pending} />
          <Stat label="Opened" value={progressStats.opened} />
          <Stat label="Posted" value={progressStats.posted} />
          <Stat label="Verified" value={progressStats.verified} />
          <Stat label="Failed" value={progressStats.failed} />
        </dl>
      </header>

      <section className="sticky top-0 z-20 -mx-4 border-y border-slate-800 bg-slate-950/90 px-4 py-4 backdrop-blur">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
            <label className="flex w-full items-center gap-3 text-sm">
              <span className="min-w-[5rem] text-xs uppercase tracking-wider text-slate-400">Search</span>
              <input
                type="search"
                value={state.queue.filters.search}
                onChange={handleSearchChange}
                placeholder="Group or URL"
                className="h-12 flex-1 rounded-full border border-slate-700 bg-slate-900 px-4 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
              />
            </label>
            <Toggle
              id="pause-toggle"
              checked={state.queue.paused}
              label={state.queue.paused ? 'Queue paused' : 'Queue running'}
              onChange={handlePauseToggle}
            />
            <button
              type="button"
              onClick={handleShuffle}
              className="h-12 min-w-[6rem] rounded-full border border-slate-700 bg-slate-900 px-4 text-sm font-semibold uppercase tracking-wide shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
            >
              Shuffle
            </button>
          </div>
        </div>
        {visibleTags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2 text-xs uppercase tracking-wide text-slate-300">
            {visibleTags.map((tag) => {
              const active = state.queue.filters.tags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => handleTagFilterToggle(tag)}
                  className={`h-12 rounded-full border px-4 text-sm font-semibold shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 ${
                    active ? 'border-sky-500/70 bg-sky-500/10 text-sky-200' : 'border-slate-700 bg-slate-900'
                  }`}
                >
                  #{tag}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <main className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,32rem)]">
        <section className="space-y-3">
          {filteredOrder.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-700 bg-slate-900/60 p-6 text-sm text-slate-300">
              Import a CSV or add rows manually to begin.
            </p>
          )}
          {filteredOrder.map((id, index) => {
            const row = state.rows.find((item) => item.id === id);
            if (!row) return null;
            const active = currentRow?.id === row.id;
            const cooldown = getCooldownDetails(row, now);
            return (
              <article
                key={row.id}
                className={`rounded-2xl border px-4 py-4 transition focus-within:outline focus-within:outline-2 focus-within:outline-sky-400 ${
                  active ? 'border-sky-600 bg-slate-900/80 shadow-lg' : 'border-slate-800 bg-slate-900/40'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{row.name || 'Untitled group'}</h2>
                    <p className="text-xs text-slate-400">{row.url || 'No URL'}</p>
                  </div>
                  <StatusBadge status={row.status} />
                </div>
                <p className="mt-3 line-clamp-3 text-sm text-slate-200">{row.ad}</p>
                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  {row.tags.map((tag) => (
                    <span key={tag} className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-slate-200">
                      #{tag}
                    </span>
                  ))}
                  {!row.tags.length && <span className="text-slate-500">No tags</span>}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                  <span>Cooldown: {row.cooldownHours}h</span>
                  {cooldown?.label && (
                    <span className={`rounded-full border px-3 py-1 ${cooldown.blocked ? 'border-amber-400/60 text-amber-200' : 'border-emerald-400/60 text-emerald-200'}`}>
                      {cooldown.blocked ? `Ready in ${cooldown.label}` : `Ready • ${cooldown.label}`}
                    </span>
                  )}
                  {row.lastPostedAt && <span>Last posted {new Date(row.lastPostedAt).toLocaleString()}</span>}
                </div>
                <div className="mt-4 flex flex-wrap gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => handleRetry(row)}
                    className="h-12 rounded-full border border-slate-700 bg-slate-900 px-4 font-semibold uppercase tracking-wide focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFailRow(row)}
                    className="h-12 rounded-full border border-rose-500/60 bg-rose-500/10 px-4 font-semibold uppercase tracking-wide text-rose-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400"
                  >
                    Fail
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddTag(row)}
                    className="h-12 rounded-full border border-slate-700 bg-slate-900 px-4 font-semibold uppercase tracking-wide focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
                  >
                    Add tag
                  </button>
                  {row.tags.map((tag) => (
                    <button
                      key={`${row.id}-${tag}`}
                      type="button"
                      onClick={() => handleTagToggle(row, tag)}
                      className="h-12 rounded-full border border-slate-800 bg-slate-900 px-4 font-semibold uppercase tracking-wide text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
                    >
                      Remove #{tag}
                    </button>
                  ))}
                  <label className="flex h-12 items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-4 font-semibold uppercase tracking-wide focus-within:outline focus-within:outline-2 focus-within:outline-sky-400">
                    <span className="text-xs">Cooldown</span>
                    <input
                      type="number"
                      min={0}
                      value={row.cooldownHours}
                      onChange={(event) => handleChangeCooldown(row, Number(event.target.value))}
                      className="w-16 bg-transparent text-base focus:outline-none"
                    />
                    <span className="text-xs">hours</span>
                  </label>
                </div>
                {active && (
                  <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/80 p-4 text-xs text-slate-300">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-200">Activity log</h3>
                    <ul className="mt-2 space-y-1">
                      {row.history.length === 0 && <li className="text-slate-500">No activity yet.</li>}
                      {row.history
                        .slice()
                        .reverse()
                        .map((entry, idx) => (
                          <li key={idx} className="flex justify-between gap-3">
                            <span className="font-medium">{entry.action}</span>
                            <span className="text-slate-500">{new Date(entry.at).toLocaleString()}</span>
                            {entry.note && <span className="text-slate-400">{entry.note}</span>}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </article>
            );
          })}
        </section>

        <aside className="sticky top-[6.5rem] flex flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl">
          <h2 className="text-lg font-semibold uppercase tracking-wide text-slate-200">Queue controls</h2>
          <p className="text-sm text-slate-300">Single queue with cooldown-aware ordering. Tap once to copy and open, then mark posted when you finish manually.</p>

          <button
            type="button"
            onClick={handleCopyAndOpen}
            className="h-16 rounded-full border border-sky-500/60 bg-sky-500/20 text-lg font-semibold uppercase tracking-wide text-sky-50 shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            Copy &amp; Open
          </button>
          <button
            type="button"
            onClick={handleMarkPosted}
            className="h-16 rounded-full border border-emerald-500/60 bg-emerald-500/20 text-lg font-semibold uppercase tracking-wide text-emerald-50 shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"
          >
            Mark posted
          </button>
          <button
            type="button"
            onClick={handleSkip}
            className="h-16 rounded-full border border-amber-500/60 bg-amber-500/20 text-lg font-semibold uppercase tracking-wide text-amber-50 shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400"
          >
            Skip
          </button>

          {currentRow ? (
            <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-200">Now serving</h3>
              <p className="text-lg font-semibold text-slate-50">{currentRow.name || 'Untitled group'}</p>
              <a href={currentRow.url} target="_blank" rel="noreferrer" className="break-all text-sm text-sky-300">
                {currentRow.url || 'No URL provided'}
              </a>
              <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/80 p-3 text-sm text-slate-200">
                <strong className="block text-xs uppercase tracking-wide text-slate-400">Post copy</strong>
                <p className="whitespace-pre-wrap text-base leading-relaxed">{currentRow.ad}</p>
              </div>
              {cooldownBadge && (
                <div
                  className={`rounded-full border px-4 py-2 text-center text-sm font-semibold uppercase tracking-wide ${
                    cooldownBadge.blocked ? 'border-amber-400/60 text-amber-200' : 'border-emerald-400/60 text-emerald-200'
                  }`}
                >
                  {cooldownBadge.blocked ? `On cooldown • ${cooldownBadge.label}` : `Ready • ${cooldownBadge.label}`}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-400">
              Queue empty. Import or add new rows to begin.
            </div>
          )}

          <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-200">Open targets in new tab</h3>
            <p className="rounded-lg border border-dashed border-slate-800 bg-slate-900/60 p-3 text-sm text-slate-400">
              Copy &amp; Open now launches the group in a separate browser tab after copying your post text. The embedded preview was
              removed to keep the page lighter.
            </p>
            <button
              type="button"
              onClick={handleOpenNewWorkspaceTab}
              className="inline-flex w-full justify-center rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
            >
              Open another Paste Happy tab
            </button>
          </div>
        </aside>
      </main>

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

function appendHistory(row: GroupRow, action: RowHistoryEntry['action'], note?: string): GroupRow {
  const historyEntry: RowHistoryEntry = { at: new Date().toISOString(), action, note };
  return {
    ...row,
    history: [...row.history, historyEntry],
  };
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_error) {
    return false;
  }
}

function findNextEligibleIndex(order: string[], start: number, rows: GroupRow[]): number {
  if (!order.length) return 0;
  for (let offset = 1; offset <= order.length; offset += 1) {
    const idx = (start + offset) % order.length;
    const row = rows.find((item) => item.id === order[idx]);
    if (!row) continue;
    const cooldown = getCooldownDetails(row, Date.now());
    if (row.status.type !== 'verified' && row.status.type !== 'failed' && !cooldown?.blocked) {
      return idx;
    }
  }
  return Math.min(start, order.length - 1);
}

function computeJitterMinutes(cooldownHours: number): number {
  const maxMinutes = Math.max(5, Math.round(cooldownHours * 60 * 0.15));
  return Math.floor(Math.random() * (maxMinutes + 1));
}

function getCooldownDetails(row: GroupRow, now: number) {
  if (!row.nextEligibleAt) return undefined;
  const next = new Date(row.nextEligibleAt).getTime();
  if (Number.isNaN(next)) return undefined;
  const diff = next - now;
  if (diff <= 0) {
    const hoursAgo = Math.abs(diff) / 3600_000;
    if (!Number.isFinite(hoursAgo)) return undefined;
    if (hoursAgo < 1) {
      return { blocked: false, label: 'ready for pickup' };
    }
    return { blocked: false, label: `${hoursAgo.toFixed(1)}h past` };
  }
  const hours = diff / 3600_000;
  if (hours >= 1) {
    return { blocked: true, label: `${hours.toFixed(1)}h` };
  }
  const minutes = diff / 60_000;
  return { blocked: true, label: `${Math.ceil(minutes)}m` };
}

function shuffleWithSeed(ids: string[], seed: number): string[] {
  const result = [...ids];
  let currentSeed = seed;
  for (let i = result.length - 1; i > 0; i -= 1) {
    currentSeed = (currentSeed * 1664525 + 1013904223) % 2 ** 32;
    const random = currentSeed / 2 ** 32;
    const j = Math.floor(random * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function computeActiveOrder(rows: GroupRow[], queue: QueueState): string[] {
  if (!queue.order.length) {
    return rows.map((row) => row.id);
  }
  const knownIds = new Set(rows.map((row) => row.id));
  const deduped = queue.order.filter((id) => knownIds.has(id));
  const missing = rows.map((row) => row.id).filter((id) => !deduped.includes(id));
  return [...deduped, ...missing];
}

function computeFilteredOrder(rows: GroupRow[], queue: QueueState): string[] {
  const baseOrder = computeActiveOrder(rows, queue);
  const search = queue.filters.search.trim().toLowerCase();
  const tagFilters = queue.filters.tags;
  return baseOrder.filter((id) => {
    const row = rows.find((item) => item.id === id);
    if (!row) return false;
    const matchesSearch = !search || `${row.name} ${row.url}`.toLowerCase().includes(search);
    const matchesTags = !tagFilters.length || tagFilters.every((tag) => row.tags.includes(tag));
    return matchesSearch && matchesTags;
  });
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-center">
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold">{value}</dd>
    </div>
  );
}

function StatusBadge({ status }: { status: RowStatus }) {
  switch (status.type) {
    case 'verified':
      return <span className="rounded-full border border-emerald-500/60 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-200">Verified</span>;
    case 'posted':
      return <span className="rounded-full border border-emerald-400/60 bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-100">Posted</span>;
    case 'opened':
      return <span className="rounded-full border border-sky-400/60 bg-sky-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-sky-100">Opened</span>;
    case 'copied':
      return <span className="rounded-full border border-indigo-400/60 bg-indigo-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-100">Copied</span>;
    case 'failed':
      return (
        <span className="rounded-full border border-rose-500/60 bg-rose-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-rose-100">
          Failed{status.reason ? `: ${status.reason}` : ''}
        </span>
      );
    default:
      return <span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-200">Pending</span>;
  }
}

export default function App() {
  return (
    <ToastProvider>
      <InnerApp />
    </ToastProvider>
  );
}
