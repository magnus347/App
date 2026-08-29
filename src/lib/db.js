/**
 * IndexedDB-lag. All data ligger lokalt på enheten slik at appen fungerer
 * uten nett ute i lageret.
 */
import { newProduct, applyMovement, round3 } from './domain.js';
import { normalizeBarcode } from './barcode.js';

export const DB_NAME = 'varelager';
export const DB_VERSION = 2;

let dbPromise = null;

export function openDb(indexedDBImpl = globalThis.indexedDB) {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDBImpl.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (!db.objectStoreNames.contains('products')) {
          const s = db.createObjectStore('products', { keyPath: 'barcode' });
          s.createIndex('name', 'name');
          s.createIndex('category', 'category');
          s.createIndex('supplier', 'supplier');
        }
        if (!db.objectStoreNames.contains('movements')) {
          const s = db.createObjectStore('movements', { keyPath: 'id', autoIncrement: true });
          s.createIndex('barcode', 'barcode');
          s.createIndex('ts', 'ts');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        // Versjon 2: oppslagsregister over kjente strekkoder. Ligger adskilt
        // fra `products` slik at varelageret bare inneholder varer man
        // faktisk fører beholdning på.
        if (!db.objectStoreNames.contains('catalog')) {
          db.createObjectStore('catalog', { keyPath: 'barcode' });
        }
        void e;
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Databasen er låst av en annen fane'));
    });
  }
  return dbPromise;
}

/** Nullstiller den cachede tilkoblingen (brukes av testene). */
export function _resetDb() {
  dbPromise = null;
}

async function tx(stores, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaksjonen ble avbrutt'));
    Promise.resolve(fn(t))
      .then((r) => {
        result = r;
      })
      .catch((err) => {
        reject(err);
        try {
          t.abort();
        } catch {
          /* transaksjonen kan allerede være avsluttet */
        }
      });
  });
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* ---------------------------------------------------------------- varer */

export async function getProduct(barcode) {
  const code = normalizeBarcode(barcode);
  if (!code) return null;
  return tx(['products'], 'readonly', (t) => wrap(t.objectStore('products').get(code)));
}

export async function allProducts() {
  const list = await tx(['products'], 'readonly', (t) =>
    wrap(t.objectStore('products').getAll())
  );
  return list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'nb'));
}

export async function saveProduct(product) {
  const code = normalizeBarcode(product.barcode);
  if (!code) throw new Error('Varen mangler strekkode');
  const existing = await getProduct(code);
  const record = {
    ...newProduct(code),
    ...existing,
    ...product,
    barcode: code,
    packSize: Number(product.packSize) > 0 ? Number(product.packSize) : 1,
    minQty: Number(product.minQty) || 0,
    price: product.price === '' || product.price == null ? null : Number(product.price),
    updatedAt: Date.now(),
  };
  // Beholdningen styres kun av bevegelser, aldri av skjemaet.
  record.qty = existing ? existing.qty : Number(product.qty) || 0;
  await tx(['products'], 'readwrite', (t) => wrap(t.objectStore('products').put(record)));
  return record;
}

export async function deleteProduct(barcode) {
  const code = normalizeBarcode(barcode);
  await tx(['products', 'movements'], 'readwrite', async (t) => {
    t.objectStore('products').delete(code);
    const idx = t.objectStore('movements').index('barcode');
    const keys = await wrap(idx.getAllKeys(IDBKeyRange.only(code)));
    for (const k of keys) t.objectStore('movements').delete(k);
  });
}

/* ----------------------------------------------------------- bevegelser */

/**
 * Registrerer en lagerbevegelse og oppdaterer beholdningen i samme
 * transaksjon, slik at de to aldri kan komme ut av synk.
 */
export async function registerMovement({ barcode, type, qty, asPack = false, note = '' }) {
  const code = normalizeBarcode(barcode);
  return tx(['products', 'movements'], 'readwrite', async (t) => {
    const store = t.objectStore('products');
    const product = await wrap(store.get(code));
    if (!product) throw new Error(`Ukjent vare: ${code}`);

    const { before, after, delta, units } = applyMovement(product, { type, qty, asPack });
    const ts = Date.now();
    const updated = { ...product, qty: after, lastMovementAt: ts, updatedAt: ts };
    store.put(updated);

    const movement = {
      barcode: code,
      name: product.name,
      type,
      qty: units,
      delta,
      before,
      after,
      note,
      ts,
    };
    const id = await wrap(t.objectStore('movements').add(movement));
    return { product: updated, movement: { ...movement, id } };
  });
}

/** Siste bevegelser, nyeste først. */
export async function recentMovements(limit = 100) {
  return tx(['movements'], 'readonly', (t) =>
    new Promise((resolve, reject) => {
      const out = [];
      const req = t.objectStore('movements').index('ts').openCursor(null, 'prev');
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || out.length >= limit) return resolve(out);
        out.push(cursor.value);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    })
  );
}

export async function movementsFor(barcode, limit = 50) {
  const code = normalizeBarcode(barcode);
  const list = await tx(['movements'], 'readonly', (t) =>
    wrap(t.objectStore('movements').index('barcode').getAll(IDBKeyRange.only(code)))
  );
  return list.sort((a, b) => b.ts - a.ts || b.id - a.id).slice(0, limit);
}

/** Angrer en bevegelse ved å bokføre den motsatte endringen. */
export async function undoMovement(id) {
  return tx(['products', 'movements'], 'readwrite', async (t) => {
    const mStore = t.objectStore('movements');
    const m = await wrap(mStore.get(id));
    if (!m) throw new Error('Fant ikke bevegelsen');
    if (m.undone) throw new Error('Bevegelsen er allerede angret');

    const pStore = t.objectStore('products');
    const product = await wrap(pStore.get(m.barcode));
    if (!product) throw new Error('Varen finnes ikke lenger');

    const after = round3((Number(product.qty) || 0) - m.delta);
    const ts = Date.now();
    pStore.put({ ...product, qty: after, updatedAt: ts });
    mStore.put({ ...m, undone: true, undoneAt: ts });
    return after;
  });
}

/* ------------------------------------------------------- innstillinger */

export async function getSetting(key, fallback = null) {
  const row = await tx(['settings'], 'readonly', (t) => wrap(t.objectStore('settings').get(key)));
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  await tx(['settings'], 'readwrite', (t) => wrap(t.objectStore('settings').put({ key, value })));
  return value;
}

/* --------------------------------------------- oppslagsregister (katalog) */

/** Slår opp en strekkode i oppslagsregisteret. */
export async function lookupCatalog(barcode) {
  const code = normalizeBarcode(barcode);
  if (!code) return null;
  const db = await openDb();
  if (!db.objectStoreNames.contains('catalog')) return null;
  return tx(['catalog'], 'readonly', (t) => wrap(t.objectStore('catalog').get(code)));
}

/** Antall oppføringer i oppslagsregisteret. */
export async function catalogCount() {
  const db = await openDb();
  if (!db.objectStoreNames.contains('catalog')) return 0;
  return tx(['catalog'], 'readonly', (t) => wrap(t.objectStore('catalog').count()));
}

/**
 * Skriver oppføringer til oppslagsregisteret. Skrives i porsjoner slik at
 * nettleseren ikke blokkeres av én diger transaksjon.
 */
export async function putCatalog(entries, { chunkSize = 2000, onProgress } = {}) {
  let skrevet = 0;
  for (let i = 0; i < entries.length; i += chunkSize) {
    const del = entries.slice(i, i + chunkSize);
    await tx(['catalog'], 'readwrite', (t) => {
      const store = t.objectStore('catalog');
      for (const e of del) {
        const code = normalizeBarcode(e.barcode);
        if (code) store.put({ ...e, barcode: code });
      }
    });
    skrevet += del.length;
    onProgress?.(Math.min(skrevet, entries.length), entries.length);
  }
  return skrevet;
}

/** Tømmer oppslagsregisteret. */
export async function clearCatalog() {
  const db = await openDb();
  if (!db.objectStoreNames.contains('catalog')) return;
  await tx(['catalog'], 'readwrite', (t) => wrap(t.objectStore('catalog').clear()));
}

/* ------------------------------------------------- sikkerhetskopiering */

export async function exportAll() {
  const [products, movements] = await Promise.all([allProducts(), recentMovements(100000)]);
  return {
    app: 'varelager',
    version: DB_VERSION,
    exportedAt: new Date().toISOString(),
    products,
    movements,
  };
}

/**
 * Leser inn data utenfra.
 *
 * `mode: 'merge'` oppdaterer varekortene, men beholder beholdningen som
 * allerede står på enheten – en varefil fra en kollega skal ikke overskrive
 * din egen telling. `mode: 'replace'` tømmer registeret først og gjenoppretter
 * beholdning og historikk slik de var i sikkerhetskopien.
 */
export async function importAll(data, { mode = 'merge' } = {}) {
  if (!data || !Array.isArray(data.products)) throw new Error('Filen inneholder ingen varer');
  let products = 0;
  let movements = 0;
  await tx(['products', 'movements'], 'readwrite', async (t) => {
    const pStore = t.objectStore('products');
    const mStore = t.objectStore('movements');
    if (mode === 'replace') {
      pStore.clear();
      mStore.clear();
    }
    for (const raw of data.products) {
      const code = normalizeBarcode(raw.barcode);
      if (!code) continue;
      const existing = mode === 'replace' ? null : await wrap(pStore.get(code));
      const merged = { ...newProduct(code), ...existing, ...raw, barcode: code };
      if (existing) merged.qty = existing.qty;
      pStore.put(merged);
      products++;
    }
    if (mode === 'replace' && Array.isArray(data.movements)) {
      for (const m of data.movements) {
        const { id, ...rest } = m;
        void id;
        mStore.add(rest);
        movements++;
      }
    }
  });
  return { products, movements };
}
