/**
 * Oppslagsregister over kjente strekkoder.
 *
 * Registeret er adskilt fra varelageret: det brukes kun til å foreslå navn
 * når en ukjent kode skannes, slik at lagerlisten din bare inneholder varer
 * du faktisk fører beholdning på.
 *
 * Data kommer fra Open Food Facts (ODbL). Se data/KILDER.md.
 */
import { fromCsv } from './csv.js';
import { putCatalog, catalogCount, clearCatalog, lookupCatalog } from './db.js';

export { catalogCount, clearCatalog, lookupCatalog };

/** Filen ligger sammen med appen, så innlastingen fungerer også uten nett. */
export const CATALOG_URL = `${import.meta.env?.BASE_URL ?? '/'}data/norske-dagligvarer.csv`;

/**
 * Laster ned og lagrer oppslagsregisteret.
 * `onProgress(gjort, totalt, fase)` kalles underveis.
 */
export async function loadCatalog({ onProgress, url = CATALOG_URL } = {}) {
  onProgress?.(0, 0, 'henter');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Kunne ikke hente varedatabasen (HTTP ${res.status})`);
  const tekst = await res.text();

  onProgress?.(0, 0, 'leser');
  const rader = fromCsv(tekst);
  if (!rader.length) throw new Error('Varedatabasen var tom');

  const oppf = rader
    .filter((r) => r.strekkode && r.vare)
    .map((r) => ({
      barcode: r.strekkode,
      name: r.vare,
      brand: r.beskrivelse || '',
      category: r.kategori || 'mat',
      unit: r.enhet || 'stk',
    }));

  await putCatalog(oppf, { onProgress: (g, t) => onProgress?.(g, t, 'lagrer') });
  return oppf.length;
}

/**
 * Lager et forslag til varekort ut fra oppslagsregisteret.
 * Returnerer null når koden ikke er kjent.
 */
export async function suggestFromCatalog(barcode) {
  const treff = await lookupCatalog(barcode);
  if (!treff) return null;
  return {
    name: treff.name,
    description: treff.brand || '',
    category: treff.category || 'mat',
    unit: treff.unit || 'stk',
  };
}
