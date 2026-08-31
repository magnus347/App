/**
 * IndexedDB-lag. All data ligger lokalt på enheten slik at appen fungerer
 * uten nett ute i lageret.
 */
import { newProduct, applyMovement, round3 } from './domain.js';
import { foldMovements } from './sync-logic.js';
import { normalizeBarcode } from './barcode.js';

export const DB_NAME = 'varelager';
export const DB_VERSION = 3;

let dbPromise = null;

/** Identifikator som er unik på tvers av enheter. */
export function nyUid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // Reserve for eldre nettlesere og testmiljø uten Web Crypto.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

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
        // Versjon 3: forbereder synkronisering mellom enheter.
        //
        // Bevegelser har hatt et løpenummer som bare er unikt på denne
        // enheten. To telefoner ville laget id 1, 2, 3 hver for seg og
        // overskrevet hverandre i skyen, så hver bevegelse får en uid som er
        // unik på tvers av enheter.
        if (e.oldVersion < 3 && db.objectStoreNames.contains('movements')) {
          const store = req.transaction.objectStore('movements');
          if (!store.indexNames.contains('uid')) store.createIndex('uid', 'uid', { unique: true });
          store.openCursor().onsuccess = (ev) => {
            const cursor = ev.target.result;
            if (!cursor) return;
            if (!cursor.value.uid) cursor.update({ ...cursor.value, uid: nyUid() });
            cursor.continue();
          };
        }
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
  const p = await tx(['products'], 'readonly', (t) => wrap(t.objectStore('products').get(code)));
  return p && p.deletedAt ? undefined : p;
}

export async function allProducts() {
  const list = await tx(['products'], 'readonly', (t) =>
    wrap(t.objectStore('products').getAll())
  );
  return list
    .filter((p) => !p.deletedAt)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'nb'));
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
    synced: false,
  };
  // Beholdningen styres kun av bevegelser, aldri av skjemaet.
  record.qty = existing ? existing.qty : Number(product.qty) || 0;
  await tx(['products'], 'readwrite', (t) => wrap(t.objectStore('products').put(record)));
  return record;
}

/**
 * Sletter en vare. Varekortet beholdes som gravstein med `deletedAt` slik at
 * slettingen kan spres til andre enheter – uten den ville varen kommet
 * tilbake ved neste synkronisering.
 */
export async function deleteProduct(barcode) {
  const code = normalizeBarcode(barcode);
  await tx(['products', 'movements'], 'readwrite', async (t) => {
    const store = t.objectStore('products');
    const p = await wrap(store.get(code));
    const ts = Date.now();
    if (p) store.put({ ...p, deletedAt: ts, updatedAt: ts, synced: false });
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
      uid: nyUid(),
      barcode: code,
      name: product.name,
      type,
      qty: units,
      delta,
      before,
      after,
      note,
      ts,
      synced: false,
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
    mStore.put({ ...m, undone: true, undoneAt: ts, synced: false });
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

/* -------------------------------------------------------- synkronisering */

/** Alle varekort, også gravsteiner – skyen trenger å vite om slettinger. */
export async function alleVarerRå() {
  return tx(['products'], 'readonly', (t) => wrap(t.objectStore('products').getAll()));
}

/** Varekort som ennå ikke er sendt til skyen. */
export async function usyncedeVarer() {
  return (await alleVarerRå()).filter((p) => p.synced !== true);
}

/** Bevegelser som ennå ikke er sendt til skyen. */
export async function usyncedeBevegelser() {
  const alle = await tx(['movements'], 'readonly', (t) => wrap(t.objectStore('movements').getAll()));
  return alle.filter((m) => m.synced !== true);
}

/** Alle bevegelser, brukt når beholdningen skal regnes ut på nytt. */
export async function alleBevegelser() {
  return tx(['movements'], 'readonly', (t) => wrap(t.objectStore('movements').getAll()));
}

/**
 * Skriver inn det skyen har, og regner beholdningen ut på nytt fra den
 * flettede loggen. Alt skjer i én transaksjon, slik at en avbrutt
 * synkronisering ikke etterlater halve tilstanden.
 */
export async function anvendFraSky({ varer = [], bevegelser = [], nyeUids = [] }) {
  return tx(['products', 'movements'], 'readwrite', async (t) => {
    const pStore = t.objectStore('products');
    const mStore = t.objectStore('movements');

    for (const p of varer) {
      const kode = normalizeBarcode(p.barcode);
      if (!kode) continue;
      const finnes = await wrap(pStore.get(kode));
      // Nyeste endring vinner. Er den lokale nyere, står den urørt.
      if (finnes && Number(finnes.updatedAt) > Number(p.updatedAt)) continue;
      pStore.put({ ...newProduct(kode), ...finnes, ...p, barcode: kode, synced: true });
    }

    const uidIndex = mStore.index('uid');
    for (const m of bevegelser) {
      const finnes = await wrap(uidIndex.get(m.uid));
      if (finnes) {
        // Angring er det eneste som kan endres på en ført bevegelse.
        if (m.undone && !finnes.undone) mStore.put({ ...finnes, undone: true, synced: true });
        else if (!finnes.synced) mStore.put({ ...finnes, synced: true });
      } else {
        const { id, ...uten } = m;
        void id;
        mStore.add({ ...uten, synced: true });
      }
    }

    // Marker som sendt det vi selv lastet opp.
    for (const uid of nyeUids) {
      const egen = await wrap(uidIndex.get(uid));
      if (egen && !egen.synced) mStore.put({ ...egen, synced: true });
    }

    // Beholdningen regnes fra loggen, aldri fra et tall skyen sendte.
    const alleBev = await wrap(mStore.getAll());
    const perVare = new Map();
    for (const m of alleBev) {
      if (!perVare.has(m.barcode)) perVare.set(m.barcode, []);
      perVare.get(m.barcode).push(m);
    }
    for (const p of await wrap(pStore.getAll())) {
      const qty = foldMovements(perVare.get(p.barcode) || []);
      if (qty !== p.qty) pStore.put({ ...p, qty });
    }
  });
}

/** Merker varekort som sendt til skyen. */
export async function markerVarerSendt(barcodes) {
  await tx(['products'], 'readwrite', async (t) => {
    const store = t.objectStore('products');
    for (const b of barcodes) {
      const p = await wrap(store.get(normalizeBarcode(b)));
      if (p) store.put({ ...p, synced: true });
    }
  });
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
