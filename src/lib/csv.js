/** CSV-eksport tilpasset norsk Excel (semikolon som skilletegn). */

export function toCsv(rows, headers, { delimiter = ';' } = {}) {
  const cols = headers || Object.keys(rows[0] || {});
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /["\n\r;,\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.map(esc).join(delimiter)];
  for (const row of rows) lines.push(cols.map((c) => esc(row[c])).join(delimiter));
  return lines.join('\r\n');
}

/** Enkel CSV-parser som takler siterte felt og både ; og , som skilletegn. */
export function fromCsv(text, { delimiter } = {}) {
  const src = String(text).replace(/^﻿/, '');
  const d = delimiter || (src.split('\n')[0].includes(';') ? ';' : ',');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === d) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];

  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.some((v) => v.trim() !== ''))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/** Laster ned innhold som fil i nettleseren. */
export function download(filename, content, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}`;
}
