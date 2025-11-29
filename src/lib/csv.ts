import { RowHistoryEntry, RowStatusKind } from './types';

export interface ParsedCsvRow {
  id?: string;
  name: string;
  url: string;
  ad: string;
  status?: RowStatusKind;
  history?: RowHistoryEntry[];
}

const HEADER_MAP = {
  name: ['group name', 'name'],
  url: ['group url', 'url'],
  ad: ['ad', 'ad text', 'post', 'post text'],
  status: ['status'],
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
  status: RowStatusKind;
  history: RowHistoryEntry[];
}

export function createCsv(rows: SerializableRow[]): string {
  const header = ['ID', 'Group Name', 'Group URL', 'Post Text', 'Status', 'History'];
  const body = rows.map((row) => [
    row.id,
    escapeCsvValue(row.name),
    escapeCsvValue(row.url),
    escapeCsvValue(row.ad),
    row.status,
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
  const statusText = get('status').trim().toLowerCase() as RowStatusKind | '';
  const historyText = get('history').trim();
  const id = get('id').trim() || undefined;

  return {
    id,
    name,
    url,
    ad,
    status: isValidStatus(statusText) ? statusText : undefined,
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
  return ['pending', 'posted', 'skipped', 'failed'].includes(status);
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

    if (char === '\n') {
      row.push(current);
      result.push(row);
      row = [];
      current = '';
      i += 1;
      continue;
    }

    current += char;
    i += 1;
  }

  row.push(current);
  result.push(row);
  return result;
}

function escapeCsvValue(value: string): string {
  if (value.includes(',') || value.includes('\n') || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function stripBom(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) {
    return text.slice(1);
  }
  return text;
}
