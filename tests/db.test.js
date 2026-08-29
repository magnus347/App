import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import * as db from '../src/lib/db.js';

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  db._resetDb();
  await db.openDb();
});

const melk = { barcode: '7038010000188', name: 'Lettmelk 1L', category: 'drikke', unit: 'l', packSize: 12, minQty: 6 };

describe('varer', () => {
  it('lagrer og henter en vare', async () => {
    await db.saveProduct(melk);
    const p = await db.getProduct('7038010000188');
    expect(p.name).toBe('Lettmelk 1L');
    expect(p.qty).toBe(0);
  });

  it('normaliserer strekkoden ved lagring og oppslag', async () => {
    await db.saveProduct({ ...melk, barcode: ' 7038 0100 00188 ' });
    expect((await db.getProduct('7038010000188')).name).toBe('Lettmelk 1L');
  });

  it('lar ikke skjemaet overskrive beholdningen', async () => {
    await db.saveProduct(melk);
    await db.registerMovement({ barcode: melk.barcode, type: 'inn', qty: 5 });
    await db.saveProduct({ ...melk, name: 'Lettmelk 1L Tine', qty: 999 });
    const p = await db.getProduct(melk.barcode);
    expect(p.qty).toBe(5);
    expect(p.name).toBe('Lettmelk 1L Tine');
  });

  it('avviser vare uten strekkode', async () => {
    await expect(db.saveProduct({ barcode: '', name: 'X' })).rejects.toThrow('mangler strekkode');
  });

  it('sletter vare og tilhørende bevegelser', async () => {
    await db.saveProduct(melk);
    await db.registerMovement({ barcode: melk.barcode, type: 'inn', qty: 2 });
    await db.deleteProduct(melk.barcode);
    expect(await db.getProduct(melk.barcode)).toBeUndefined();
    expect(await db.movementsFor(melk.barcode)).toHaveLength(0);
  });
});

describe('bevegelser', () => {
  it('oppdaterer beholdning og fører historikk', async () => {
    await db.saveProduct(melk);
    await db.registerMovement({ barcode: melk.barcode, type: 'inn', qty: 2, asPack: true });
    await db.registerMovement({ barcode: melk.barcode, type: 'ut', qty: 4 });
    const p = await db.getProduct(melk.barcode);
    expect(p.qty).toBe(20);
    const hist = await db.movementsFor(melk.barcode);
    expect(hist).toHaveLength(2);
    expect(hist[0]).toMatchObject({ type: 'ut', delta: -4, before: 24, after: 20 });
  });

  it('avviser bevegelse på ukjent vare', async () => {
    await expect(db.registerMovement({ barcode: '1234567890128', type: 'inn', qty: 1 }))
      .rejects.toThrow('Ukjent vare');
  });

  it('lar telling sette beholdningen absolutt', async () => {
    await db.saveProduct(melk);
    await db.registerMovement({ barcode: melk.barcode, type: 'inn', qty: 30 });
    await db.registerMovement({ barcode: melk.barcode, type: 'telling', qty: 27 });
    expect((await db.getProduct(melk.barcode)).qty).toBe(27);
  });

  it('angrer en bevegelse ved å bokføre motsatt endring', async () => {
    await db.saveProduct(melk);
    const { movement } = await db.registerMovement({ barcode: melk.barcode, type: 'inn', qty: 10 });
    await db.undoMovement(movement.id);
    expect((await db.getProduct(melk.barcode)).qty).toBe(0);
    await expect(db.undoMovement(movement.id)).rejects.toThrow('allerede angret');
  });

  it('lister siste bevegelser nyeste først', async () => {
    await db.saveProduct(melk);
    await db.saveProduct({ barcode: '1234567', name: 'Tørkepapir' });
    await db.registerMovement({ barcode: melk.barcode, type: 'inn', qty: 1 });
    await db.registerMovement({ barcode: '1234567', type: 'inn', qty: 1 });
    const recent = await db.recentMovements(10);
    expect(recent[0].barcode).toBe('1234567');
    expect(recent).toHaveLength(2);
  });
});

describe('innstillinger', () => {
  it('lagrer og leser verdier med fallback', async () => {
    expect(await db.getSetting('lyd', true)).toBe(true);
    await db.setSetting('lyd', false);
    expect(await db.getSetting('lyd', true)).toBe(false);
  });
});

describe('eksport og import', () => {
  it('eksporterer varer og bevegelser', async () => {
    await db.saveProduct(melk);
    await db.registerMovement({ barcode: melk.barcode, type: 'inn', qty: 3 });
    const dump = await db.exportAll();
    expect(dump.products).toHaveLength(1);
    expect(dump.movements).toHaveLength(1);
  });

  it('slår sammen import uten å miste beholdning', async () => {
    await db.saveProduct(melk);
    await db.registerMovement({ barcode: melk.barcode, type: 'inn', qty: 3 });
    const res = await db.importAll({
      products: [{ barcode: melk.barcode, name: 'Lettmelk endret', qty: 0 }, { barcode: '1234567', name: 'Ny vare' }],
    });
    expect(res.products).toBe(2);
    const p = await db.getProduct(melk.barcode);
    expect(p.name).toBe('Lettmelk endret');
    expect(p.qty).toBe(3);
  });

  it('erstatter hele registeret ved replace', async () => {
    await db.saveProduct(melk);
    await db.registerMovement({ barcode: melk.barcode, type: 'inn', qty: 3 });
    await db.importAll({ products: [{ barcode: '1234567', name: 'Ny vare', qty: 9 }] }, { mode: 'replace' });
    expect(await db.getProduct(melk.barcode)).toBeUndefined();
    expect((await db.getProduct('1234567')).qty).toBe(9);
    expect(await db.recentMovements(10)).toHaveLength(0);
  });

  it('avviser en fil uten varer', async () => {
    await expect(db.importAll({})).rejects.toThrow('ingen varer');
  });
});

describe('oppslagsregister', () => {
  const oppf = [
    { barcode: '7038010000188', name: 'Lettmelk 1L', brand: 'Tine', category: 'drikke' },
    { barcode: ' 4006381333931 ', name: 'Toalettpapir 8pk', brand: 'X-tra', category: 'forbruk' },
  ];

  it('starter tomt', async () => {
    expect(await db.catalogCount()).toBe(0);
    expect(await db.lookupCatalog('7038010000188')).toBeUndefined();
  });

  it('lagrer og slår opp oppføringer', async () => {
    await db.putCatalog(oppf);
    expect(await db.catalogCount()).toBe(2);
    expect((await db.lookupCatalog('7038010000188')).name).toBe('Lettmelk 1L');
  });

  it('normaliserer strekkoden ved lagring og oppslag', async () => {
    await db.putCatalog(oppf);
    expect((await db.lookupCatalog('4006381333931')).name).toBe('Toalettpapir 8pk');
  });

  it('skriver i porsjoner og melder framdrift', async () => {
    const mange = Array.from({ length: 250 }, (_, i) => ({
      barcode: String(1000000 + i), name: `Vare ${i}`,
    }));
    const framdrift = [];
    await db.putCatalog(mange, { chunkSize: 100, onProgress: (g, t) => framdrift.push([g, t]) });
    expect(await db.catalogCount()).toBe(250);
    expect(framdrift).toEqual([[100, 250], [200, 250], [250, 250]]);
  });

  it('holdes adskilt fra varelageret', async () => {
    await db.putCatalog(oppf);
    expect(await db.allProducts()).toHaveLength(0);
    await expect(db.registerMovement({ barcode: '7038010000188', type: 'inn', qty: 1 }))
      .rejects.toThrow('Ukjent vare');
  });

  it('tømmes uten å røre varelageret', async () => {
    await db.saveProduct(melk);
    await db.putCatalog(oppf);
    await db.clearCatalog();
    expect(await db.catalogCount()).toBe(0);
    expect(await db.allProducts()).toHaveLength(1);
  });

  it('overlever ikke som vare i sikkerhetskopien', async () => {
    await db.putCatalog(oppf);
    const dump = await db.exportAll();
    expect(dump.products).toHaveLength(0);
  });
});
