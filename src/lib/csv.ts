export interface ParsedCsvRow {
  name: string;
  url: string;
  ad: string;
}

const NAME_HEADERS = ['group name', 'name'];
const URL_HEADERS = ['group url', 'url'];
const AD_HEADERS = ['ad', 'ad text', 'post'];

export function parseCsvRows(input: string): ParsedCsvRow[] {
  const rows = parseCsv(input);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const nameIdx = findHeaderIndex(header, NAME_HEADERS);
  const urlIdx = findHeaderIndex(header, URL_HEADERS);
  const adIdx = findHeaderIndex(header, AD_HEADERS);

  return rows
    .slice(1)
    .map((columns) => {
      const name = columns[nameIdx] ?? '';
      const url = columns[urlIdx] ?? '';
      const ad = columns[adIdx] ?? '';
      return { name: name.trim(), url: url.trim(), ad: ad.trim() };
    })
    .filter((row) => row.name || row.url || row.ad);
}

function findHeaderIndex(header: string[], candidates: string[]): number {
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
