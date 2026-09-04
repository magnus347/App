import { describe, it, expect } from 'vitest';
import {
  newProduct, unitsFor, applyMovement, isLowStock, hasStock, suggestedOrderQty,
  scoreProduct, searchProducts, totalValue, countDifferences,
  kategoriId, kategoriNavn, DEFAULT_CATEGORIES,
} from '../src/lib/domain.js';

const melk = () => newProduct('7038010000188', { name: 'Lettmelk 1L', category: 'drikke', unit: 'l', packSize: 12, qty: 10, minQty: 6 });

describe('applyMovement', () => {
  it('legger til ved inn', () => {
    expect(applyMovement(melk(), { type: 'inn', qty: 5 })).toMatchObject({ before: 10, after: 15, delta: 5 });
  });
  it('trekker fra ved ut', () => {
    expect(applyMovement(melk(), { type: 'ut', qty: 3 })).toMatchObject({ before: 10, after: 7, delta: -3 });
  });
  it('regner kolli om til enkeltenheter', () => {
    expect(applyMovement(melk(), { type: 'inn', qty: 2, asPack: true })).toMatchObject({ after: 34, units: 24 });
  });
  it('setter absolutt beholdning ved telling', () => {
    expect(applyMovement(melk(), { type: 'telling', qty: 4 })).toMatchObject({ before: 10, after: 4, delta: -6 });
  });
  it('tillater negativ beholdning slik at feil blir synlig', () => {
    expect(applyMovement(melk(), { type: 'ut', qty: 30 }).after).toBe(-20);
  });
  it('takler desimaler uten flyttallsstøy', () => {
    const p = newProduct('123456', { qty: 0.1 });
    expect(applyMovement(p, { type: 'inn', qty: 0.2 }).after).toBe(0.3);
  });
  it('avviser ukjent type og ugyldig antall', () => {
    expect(() => applyMovement(melk(), { type: 'tull', qty: 1 })).toThrow();
    expect(() => applyMovement(melk(), { type: 'inn', qty: 'x' })).toThrow('Ugyldig antall');
  });
});

describe('unitsFor', () => {
  it('bruker 1 som kollistørrelse når feltet mangler', () => {
    expect(unitsFor(newProduct('123456'), 3, true)).toBe(3);
  });
});

describe('hasStock', () => {
  it('skjuler varer med beholdning null', () => {
    expect(hasStock({ qty: 0 })).toBe(false);
    expect(hasStock({})).toBe(false);
  });
  it('viser varer med beholdning', () => {
    expect(hasStock({ qty: 1 })).toBe(true);
    expect(hasStock({ qty: 0.5 })).toBe(true);
  });
  it('viser negativ beholdning, som er en feil man må se', () => {
    expect(hasStock({ qty: -3 })).toBe(true);
  });
});

describe('isLowStock', () => {
  it('varsler når beholdning er på eller under minimum', () => {
    expect(isLowStock({ qty: 6, minQty: 6 })).toBe(true);
    expect(isLowStock({ qty: 7, minQty: 6 })).toBe(false);
  });
  it('varsler ikke uten satt minimum', () => {
    expect(isLowStock({ qty: 0, minQty: 0 })).toBe(false);
  });
});

describe('suggestedOrderQty', () => {
  it('foreslår hele kolli opp til dobbel minimumsbeholdning', () => {
    expect(suggestedOrderQty({ qty: 2, minQty: 6, packSize: 12 })).toEqual({ units: 12, packs: 1 });
    expect(suggestedOrderQty({ qty: 0, minQty: 20, packSize: 6 })).toEqual({ units: 42, packs: 7 });
  });
  it('foreslår ingenting når lageret er fullt', () => {
    expect(suggestedOrderQty({ qty: 50, minQty: 6, packSize: 12 })).toEqual({ units: 0, packs: 0 });
  });
});

describe('søk og gjenkjenning', () => {
  const varer = [
    newProduct('7038010000188', { name: 'Lettmelk 1L', description: 'Tine, kjølevare', supplier: 'Asko' }),
    newProduct('7311040000000', { name: 'Toalettpapir 8pk', description: 'Norengros myk', supplier: 'Norengros' }),
    newProduct('INT-KAFFE1', { name: 'Kaffe filtermalt', description: 'Storpakke til kantine' }),
  ];
  it('rangerer eksakt strekkodetreff høyest', () => {
    expect(searchProducts(varer, '7038010000188')[0].name).toBe('Lettmelk 1L');
  });
  it('finner vare på delvis navn', () => {
    expect(searchProducts(varer, 'melk')[0].name).toBe('Lettmelk 1L');
  });
  it('finner vare på beskrivelsen brukeren skrev inn', () => {
    expect(searchProducts(varer, 'kantine')[0].name).toBe('Kaffe filtermalt');
  });
  it('finner vare på leverandør', () => {
    expect(searchProducts(varer, 'norengros').length).toBe(1);
  });
  it('krever at alle ord i et flerordssøk finnes', () => {
    expect(searchProducts(varer, 'tine kjølevare').length).toBe(1);
    expect(searchProducts(varer, 'tine sjokolade').length).toBe(0);
  });
  it('gir alle varer ved tomt søk', () => {
    expect(searchProducts(varer, '  ').length).toBe(3);
  });
  it('gir null poeng for treffløst søk', () => {
    expect(scoreProduct(varer[0], 'sjokolade')).toBe(0);
  });
});

describe('totalValue', () => {
  it('summerer beholdning ganger pris', () => {
    expect(totalValue([{ qty: 3, price: 19.9 }, { qty: 2, price: 5 }, { qty: 1 }])).toBe(69.7);
  });
});

describe('countDifferences', () => {
  const varer = [newProduct('111111', { name: 'A', qty: 10 }), newProduct('222222', { name: 'B', qty: 4 })];
  it('lister bare varer med avvik, størst først', () => {
    const d = countDifferences(varer, { 111111: 3, 222222: 4 });
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ barcode: '111111', delta: -7 });
  });
  it('ignorerer talte varer som ikke finnes i registeret', () => {
    expect(countDifferences(varer, { 999999: 5 })).toHaveLength(0);
  });
});

describe('kategoriId', () => {
  it('lager id fra navnet, uten norske tegn', () => {
    expect(kategoriId('Kjøkken')).toBe('kjoekken');
    expect(kategoriId('Tørrvarer og bakst')).toBe('toerrvarer-og-bakst');
    expect(kategoriId('Rå fisk')).toBe('raa-fisk');
  });
  it('unngår kollisjon med eksisterende id-er', () => {
    const finnes = [{ id: 'kjoekken' }, { id: 'kjoekken-2' }];
    expect(kategoriId('Kjøkken', finnes)).toBe('kjoekken-3');
  });
  it('takler navn uten brukbare tegn', () => {
    expect(kategoriId('!!!')).toBe('kategori');
  });
});

describe('kategoriNavn', () => {
  const kats = [{ id: 'mat', label: 'Kjøkken' }, { id: 'forbruk', label: 'Forbruksvarer' }];
  it('finner etiketten', () => {
    expect(kategoriNavn(kats, 'forbruk')).toBe('Forbruksvarer');
  });
  it('faller tilbake på id-en for kategorier som er fjernet', () => {
    // Varen skal ikke bli navnløs fordi kategorien ble slettet.
    expect(kategoriNavn(kats, 'drikke')).toBe('drikke');
  });
  it('takler manglende kategori', () => {
    expect(kategoriNavn(kats, undefined)).toBe('Ukjent');
  });
});
