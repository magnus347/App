/**
 * Ren flettelogikk for synkronisering mellom enheter.
 *
 * Uten DOM, database eller nettverk, slik at reglene kan testes isolert –
 * det er her feil ville blitt dyrest: en feil her gir feil beholdning.
 *
 * Grunnprinsippet: bevegelsesloggen er fasit. Beholdningen lagres ikke som
 * et tall som to enheter kan overskrive for hverandre, men regnes ut fra
 * loggen. To telefoner som hver registrerer «ut 1» gir to bevegelser, og
 * begge trekkes fra – slik det skal være.
 */
import { round3 } from './domain.js';

/**
 * Sorterer bevegelser i en rekkefølge alle enheter er enige om.
 * Tidspunkt først, så id som tiebreak når klokkene viser det samme.
 */
export function sortMovements(movements) {
  return [...movements].sort((a, b) => (a.ts - b.ts) || String(a.id).localeCompare(String(b.id)));
}

/**
 * Regner ut beholdning ved å spille av loggen.
 * `inn`/`ut` endrer relativt, `telling`/`justering` setter absolutt verdi.
 * Angrede bevegelser hoppes over.
 */
export function foldMovements(movements) {
  let qty = 0;
  for (const m of sortMovements(movements)) {
    if (m.undone) continue;
    if (m.type === 'inn') qty += Number(m.qty) || 0;
    else if (m.type === 'ut') qty -= Number(m.qty) || 0;
    else if (m.type === 'telling' || m.type === 'justering') qty = Number(m.qty) || 0;
  }
  return round3(qty);
}

/**
 * Fletter to versjoner av et varekort. Nyeste endring vinner felt for felt
 * er for komplisert til å forsvare her; hele kortet følger nyeste
 * `updatedAt`, med id som tiebreak slik at begge enheter lander likt.
 */
export function mergeProduct(lokal, ekstern) {
  if (!lokal) return ekstern;
  if (!ekstern) return lokal;
  const a = Number(lokal.updatedAt) || 0;
  const b = Number(ekstern.updatedAt) || 0;
  if (a !== b) return a > b ? lokal : ekstern;
  // Likt tidspunkt: velg deterministisk, ellers spriker enhetene.
  return String(lokal.barcode) <= String(ekstern.barcode) ? lokal : ekstern;
}

/**
 * Slår sammen to bevegelseslister uten duplikater. Bevegelser er
 * uforanderlige bortsett fra angring, som alltid vinner: er den angret ett
 * sted, er den angret overalt.
 */
export function mergeMovements(lokale, eksterne) {
  const kart = new Map();
  for (const m of [...lokale, ...eksterne]) {
    const finnes = kart.get(m.id);
    if (!finnes) kart.set(m.id, m);
    else if (m.undone && !finnes.undone) kart.set(m.id, m);
  }
  return sortMovements([...kart.values()]);
}

/** Bevegelser som ennå ikke er sendt til skyen. */
export function usyncede(movements) {
  return movements.filter((m) => !m.synced);
}

/**
 * Setter opp en full fletting av lokal og ekstern tilstand.
 * Returnerer varene med beholdning utregnet fra den flettede loggen.
 */
export function flettTilstand({ lokaleVarer = [], lokaleBevegelser = [], eksterneVarer = [], eksterneBevegelser = [] }) {
  const varer = new Map();
  for (const p of lokaleVarer) varer.set(p.barcode, p);
  for (const p of eksterneVarer) {
    varer.set(p.barcode, mergeProduct(varer.get(p.barcode), p));
  }

  const bevegelser = mergeMovements(lokaleBevegelser, eksterneBevegelser);

  const perVare = new Map();
  for (const m of bevegelser) {
    if (!perVare.has(m.barcode)) perVare.set(m.barcode, []);
    perVare.get(m.barcode).push(m);
  }

  const ut = [];
  for (const [barcode, p] of varer) {
    if (p.deletedAt) continue;
    ut.push({ ...p, qty: foldMovements(perVare.get(barcode) || []) });
  }
  return { varer: ut, bevegelser };
}
