import { RowHistoryEntry, RowStatusKind } from './types';

export interface ParsedCsvRow {
  id?: string;
  name: string;
  url: string;
  ad: string;
  tags: string[];
  cooldownHours?: number;
  retries?: number;
  lastPostedAt?: string;
  nextEligibleAt?: string;
  status?: RowStatusKind;
  failureReason?: string;
  history?: RowHistoryEntry[];
}

const HEADER_MAP = {
  name: ['group name', 'name'],
  url: ['group url', 'url'],
  ad: ['ad', 'ad text', 'post'],
  tags: ['tags', 'labels'],
  cooldownHours: ['cooldownhours', 'cooldown', 'cooldown hours'],
  retries: ['retries'],
  lastPostedAt: ['lastpostedat', 'last posted at'],
  nextEligibleAt: ['nexteligibleat', 'next eligible at', 'available at'],
  status: ['status'],
  failureReason: ['failurereason', 'failure reason'],
  history: ['history', 'log', 'logs'],
  id: ['id'],
} as const;

type HeaderKey = keyof typeof HEADER_MAP;

export function parseCsvRows(input: string): ParsedCsvRow[] {
  const rows = parseCsv(input);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const indexLookup = new Map<HeaderKey, number>();
  (Object.keys(HEADER_MAP) as HeaderKey[]).forEach((key) => {
    indexLookup.set(key, findHeaderIndex(header, HEADER_MAP[key]));
  });

  return rows
    .slice(1)
    .map((columns) => mapRow(columns, indexLookup))
    .filter((row) => row.name || row.url || row.ad);
}

export interface SerializableRow {
  id: string;
  name: string;
  url: string;
  ad: string;
  tags: string[];
  cooldownHours: number;
  retries: number;
  lastPostedAt?: string;
  nextEligibleAt?: string;
  status: RowStatusKind;
  failureReason?: string;
  history: RowHistoryEntry[];
}

export function createCsv(rows: SerializableRow[]): string {
  const header = [
    'ID',
    'Group Name',
    'Group URL',
    'Ad',
    'Tags',
    'CooldownHours',
    'Retries',
    'LastPostedAt',
    'NextEligibleAt',
    'Status',
    'FailureReason',
    'History',
  ];
  const body = rows.map((row) => [
    row.id,
    escapeCsvValue(row.name),
    escapeCsvValue(row.url),
    escapeCsvValue(row.ad),
    escapeCsvValue(row.tags.join('|')),
    row.cooldownHours.toString(),
    row.retries.toString(),
    row.lastPostedAt ?? '',
    row.nextEligibleAt ?? '',
    row.status,
    escapeCsvValue(row.failureReason ?? ''),
    escapeCsvValue(JSON.stringify(row.history ?? [])),
  ]);
  return [header, ...body]
    .map((columns) => columns.join(','))
    .join('\n');
}

function mapRow(columns: string[], indexLookup: Map<HeaderKey, number>): ParsedCsvRow {
  const get = (key: HeaderKey): string => {
    const idx = indexLookup.get(key) ?? -1;
    return idx >= 0 ? columns[idx] ?? '' : '';
  };

  const name = get('name').trim();
  const url = get('url').trim();
  const ad = get('ad').trim();
  const tagsText = get('tags').trim();
  const cooldownText = get('cooldownHours').trim();
  const retriesText = get('retries').trim();
  const statusText = get('status').trim().toLowerCase() as RowStatusKind | '';
  const historyText = get('history').trim();
  const failureReason = get('failureReason').trim();
  const id = get('id').trim() || undefined;

  return {
    id,
    name,
    url,
    ad,
    tags: tagsText ? tagsText.split(/[|,]/).map((tag) => tag.trim()).filter(Boolean) : [],
    cooldownHours: cooldownText ? Number.parseFloat(cooldownText) || undefined : undefined,
    retries: retriesText ? Number.parseInt(retriesText, 10) || undefined : undefined,
    lastPostedAt: get('lastPostedAt').trim() || undefined,
    nextEligibleAt: get('nextEligibleAt').trim() || undefined,
    status: isValidStatus(statusText) ? statusText : undefined,
    failureReason: failureReason || undefined,
    history: parseHistory(historyText),
  };
}

function parseHistory(raw: string): RowHistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as RowHistoryEntry[];
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => ({
          ...entry,
          at: entry.at,
          action: entry.action,
          note: entry.note,
        }))
        .filter((entry) => typeof entry.at === 'string' && typeof entry.action === 'string');
    }
  } catch (error) {
    console.warn('Failed to parse history column', error);
  }
  return [];
}

function isValidStatus(status: string): status is RowStatusKind {
  return ['pending', 'copied', 'opened', 'posted', 'verified', 'failed'].includes(status);
}

function findHeaderIndex(header: string[], candidates: readonly string[]): number {
  for (const candidate of candidates) {
    const idx = header.indexOf(candidate);
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseCsv(input: string): string[][] {
  const result: string[][] = [];
  let row: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;
  const data = stripBom(input);

  while (i < data.length) {
    const char = data[i];

    if (inQuotes) {
      if (char === '"') {
        if (data[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      current += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (char === ',') {
      row.push(current);
      current = '';
      i += 1;
      continue;
    }

    if (char === '\n' || char === '\r') {
      if (char === '\r' && data[i + 1] === '\n') {
        i += 2;
      } else {
        i += 1;
      }
      row.push(current);
      result.push(row);
      row = [];
      current = '';
      continue;
    }

    current += char;
    i += 1;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    result.push(row);
  }

  return result.filter((r) => r.some((value) => value.trim().length > 0));
}

function stripBom(value: string): string {
  if (value.charCodeAt(0) === 0xfeff) {
    return value.slice(1);
  }
  return value;
}

function escapeCsvValue(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}
