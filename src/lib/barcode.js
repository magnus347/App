/**
 * Hjelpefunksjoner for strekkoder (EAN-8/EAN-13/UPC-A, samt interne koder).
 */

/** Fjerner alt annet enn siffer og store bokstaver/bindestrek (interne koder). */
export function normalizeBarcode(raw) {
  if (raw == null) return '';
  const s = String(raw).trim().toUpperCase();
  if (s.startsWith('INT-')) return s.replace(/[^A-Z0-9-]/g, '');
  const digits = s.replace(/\D/g, '');
  // UPC-A (12 siffer) lagres som EAN-13 med ledende 0 slik at samme vare
  // ikke havner to ganger i registeret.
  if (digits.length === 12 && isValidCheckDigit(digits)) return '0' + digits;
  return digits;
}

/** Beregner GS1-kontrollsiffer for en kode uten det siste sifferet. */
export function checkDigit(digitsWithoutCheck) {
  const d = String(digitsWithoutCheck).replace(/\D/g, '');
  let sum = 0;
  // Vekt 3 og 1 vekselvis, regnet fra høyre.
  for (let i = d.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) {
    sum += Number(d[i]) * w;
  }
  return (10 - (sum % 10)) % 10;
}

/** Sant hvis koden har gyldig lengde og korrekt kontrollsiffer. */
export function isValidCheckDigit(code) {
  const d = String(code).replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(d.length)) return false;
  return checkDigit(d.slice(0, -1)) === Number(d[d.length - 1]);
}

/** Sant for koder appen kan lagre: gyldig EAN/UPC eller intern kode. */
export function isStorableBarcode(code) {
  const c = normalizeBarcode(code);
  if (c.startsWith('INT-')) return c.length > 4;
  if (!/^\d+$/.test(c)) return false;
  // Godtar også koder uten gyldig sjekksiffer (Code-128 fra grossist,
  // egne etiketter osv.) så lenge lengden er rimelig.
  return c.length >= 6 && c.length <= 18;
}

const GS1_PREFIX = [
  [0, 19, 'USA/Canada'],
  [30, 39, 'USA'],
  [40, 44, 'Tyskland'],
  [45, 49, 'Japan'],
  [50, 50, 'Storbritannia'],
  [54, 54, 'Belgia/Luxembourg'],
  [57, 57, 'Danmark'],
  [64, 64, 'Finland'],
  [70, 70, 'Norge'],
  [73, 73, 'Sverige'],
  [76, 76, 'Sveits'],
  [80, 83, 'Italia'],
  [84, 84, 'Spania'],
  [87, 87, 'Nederland'],
  [90, 91, 'Østerrike'],
  [93, 93, 'Australia'],
  [200, 299, 'Intern/butikkode'],
];

/** Grov opprinnelsesindikasjon ut fra GS1-prefiks – kun som hjelp ved registrering. */
export function originHint(code) {
  const d = normalizeBarcode(code);
  if (!/^\d{8,14}$/.test(d)) return null;
  const c = d.length === 13 ? d : d.padStart(13, '0');
  const p2 = Number(c.slice(0, 2));
  const p3 = Number(c.slice(0, 3));
  if (p3 >= 200 && p3 <= 299) return 'Intern/butikkode';
  for (const [from, to, name] of GS1_PREFIX) {
    if (from < 100 && p2 >= from && p2 <= to) return name;
  }
  return null;
}

/** Lager en intern kode for varer uten strekkode (f.eks. løsvekt eller egen emballasje). */
export function makeInternalBarcode(seed = Date.now()) {
  const base = Math.abs(Number(seed) % 1e9).toString(36).toUpperCase();
  const rnd = Math.floor(Math.random() * 1296).toString(36).toUpperCase().padStart(2, '0');
  return `INT-${base}${rnd}`;
}

/** Pen visning av en strekkode i lister. */
export function formatBarcode(code) {
  const c = normalizeBarcode(code);
  if (c.startsWith('INT-')) return c;
  if (c.length === 13) return `${c[0]} ${c.slice(1, 7)} ${c.slice(7, 13)}`;
  if (c.length === 8) return `${c.slice(0, 4)} ${c.slice(4)}`;
  return c;
}
