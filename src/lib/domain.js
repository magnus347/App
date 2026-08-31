/**
 * Domenelogikk uten avhengighet til database eller DOM, slik at reglene
 * kan testes isolert.
 */

export const CATEGORIES = [
  { id: 'mat', label: 'Mat' },
  { id: 'drikke', label: 'Drikke' },
  { id: 'forbruk', label: 'Forbruksmateriell' },
  { id: 'annet', label: 'Annet' },
];

export const UNITS = ['stk', 'pk', 'kolli', 'kg', 'g', 'l', 'dl', 'rull', 'eske', 'flaske'];

export const SUPPLIERS = ['Norengros', 'Asko', 'Bama', 'Rema 1000', 'Coop', 'Kiwi', 'Meny', 'Annet'];

export const MOVEMENT_TYPES = {
  inn: 'Inn',
  ut: 'Ut',
  telling: 'Telling',
  justering: 'Justering',
};

/** Ny vare med fornuftige standardverdier. */
export function newProduct(barcode, fields = {}) {
  const now = Date.now();
  return {
    barcode,
    name: '',
    description: '',
    category: 'mat',
    unit: 'stk',
    supplier: '',
    packSize: 1,
    qty: 0,
    minQty: 0,
    location: '',
    price: null,
    createdAt: now,
    updatedAt: now,
    lastMovementAt: null,
    ...fields,
  };
}

/** Antall enheter en registrering utgjør (kolli * antall i kolli). */
export function unitsFor(product, qty, asPack = false) {
  const packSize = Number(product?.packSize) > 0 ? Number(product.packSize) : 1;
  return round3(Number(qty) * (asPack ? packSize : 1));
}

/**
 * Regner ut ny beholdning for en bevegelse.
 * `inn`/`ut` endrer relativt, `telling`/`justering` setter absolutt verdi.
 */
export function applyMovement(product, { type, qty, asPack = false }) {
  const before = round3(Number(product?.qty) || 0);
  const units = unitsFor(product, qty, asPack);
  if (!Number.isFinite(units)) throw new Error('Ugyldig antall');

  let after;
  if (type === 'inn') after = before + units;
  else if (type === 'ut') after = before - units;
  else if (type === 'telling' || type === 'justering') after = units;
  else throw new Error(`Ukjent bevegelsestype: ${type}`);

  after = round3(after);
  return { before, after, delta: round3(after - before), units };
}

/**
 * Sant når varen har beholdning å vise. Negativ beholdning teller med:
 * den betyr at noe er ført feil, og å skjule den ville skjult feilen.
 */
export function hasStock(product) {
  return (Number(product?.qty) || 0) !== 0;
}

/** Sant når varen bør bestilles. */
export function isLowStock(product) {
  const min = Number(product?.minQty) || 0;
  if (min <= 0) return false;
  return (Number(product?.qty) || 0) <= min;
}

/** Foreslått bestillingsmengde: fyller opp til dobbel minimumsbeholdning. */
export function suggestedOrderQty(product) {
  const min = Number(product?.minQty) || 0;
  const qty = Number(product?.qty) || 0;
  const packSize = Number(product?.packSize) > 0 ? Number(product.packSize) : 1;
  const needed = Math.max(0, min * 2 - qty);
  if (needed <= 0) return { units: 0, packs: 0 };
  const packs = Math.ceil(needed / packSize);
  return { units: round3(packs * packSize), packs };
}

/** Enkel poengbasert søk-/gjenkjenningsfunksjon over lagrede varer. */
export function scoreProduct(product, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return 0;
  const name = String(product.name || '').toLowerCase();
  const desc = String(product.description || '').toLowerCase();
  const barcode = String(product.barcode || '').toLowerCase();
  const supplier = String(product.supplier || '').toLowerCase();

  if (barcode === q) return 1000;
  if (name === q) return 500;
  if (name.startsWith(q)) return 300;
  if (name.includes(q)) return 200;
  if (barcode.includes(q)) return 150;
  if (desc.includes(q)) return 100;
  if (supplier.includes(q)) return 50;

  // Alle ord i søket må finnes et sted i varen for å gi treff.
  const hay = `${name} ${desc} ${supplier}`;
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((w) => hay.includes(w))) return 80;
  return 0;
}

/** Søker i en liste med varer og returnerer de beste treffene. */
export function searchProducts(products, query, limit = 50) {
  const q = String(query || '').trim();
  if (!q) return products.slice(0, limit);
  return products
    .map((p) => ({ p, s: scoreProduct(p, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || String(a.p.name).localeCompare(b.p.name, 'nb'))
    .slice(0, limit)
    .map((x) => x.p);
}

/** Samlet lagerverdi basert på registrert innkjøpspris per enhet. */
export function totalValue(products) {
  return round2(
    products.reduce((sum, p) => sum + (Number(p.price) || 0) * (Number(p.qty) || 0), 0)
  );
}

/** Avvikslinjer fra en telling: varer som ikke ble talt får differanse mot 0. */
export function countDifferences(products, counted) {
  const lines = [];
  for (const [barcode, qty] of Object.entries(counted)) {
    const p = products.find((x) => x.barcode === barcode);
    if (!p) continue;
    const before = Number(p.qty) || 0;
    const after = round3(Number(qty));
    if (before !== after) {
      lines.push({ barcode, name: p.name, before, after, delta: round3(after - before) });
    }
  }
  return lines.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export function round3(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
}

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
