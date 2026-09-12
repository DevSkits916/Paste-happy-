const aliases = {
  groupName: ['group name', 'group_name', 'group', 'name'],
  groupUrl: ['group url', 'group_url', 'url', 'link'],
  postText: ['post text', 'post_text', 'post', 'ad', 'ad text', 'message'],
};

export function parseCsv(input) {
  const records = tokenize(String(input || '').replace(/^\uFEFF/, ''));
  if (records.length < 2) return [];
  const headers = records[0].map(normalize);
  const indexes = Object.fromEntries(Object.entries(aliases).map(([key, names]) => [key, headers.findIndex((h) => names.includes(h))]));
  return records.slice(1).map((row) => ({
    groupName: value(row, indexes.groupName),
    groupUrl: value(row, indexes.groupUrl),
    postText: value(row, indexes.postText),
  })).filter((row) => row.groupName || row.groupUrl || row.postText);
}

function normalize(value) { return value.trim().toLowerCase().replace(/\s+/g, ' '); }
function value(row, index) { return index >= 0 ? (row[index] || '').trim() : ''; }
function tokenize(input) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '"' && quoted && input[i + 1] === '"') { cell += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  row.push(cell); if (row.some(Boolean)) rows.push(row);
  return rows;
}
