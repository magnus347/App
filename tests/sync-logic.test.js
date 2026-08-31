import { describe, it, expect } from 'vitest';
import {
  sortMovements, foldMovements, mergeProduct, mergeMovements, usyncede, flettTilstand,
} from '../src/lib/sync-logic.js';

const m = (id, ts, type, qty, extra = {}) => ({ id, ts, type, qty, barcode: '111', ...extra });

describe('foldMovements', () => {
  it('legger sammen inn og ut', () => {
    expect(foldMovements([m('a', 1, 'inn', 10), m('b', 2, 'ut', 3)])).toBe(7);
  });

  it('lar telling sette absolutt verdi', () => {
    expect(foldMovements([m('a', 1, 'inn', 10), m('b', 2, 'telling', 4), m('c', 3, 'inn', 1)])).toBe(5);
  });

  it('hopper over angrede bevegelser', () => {
    expect(foldMovements([m('a', 1, 'inn', 10), m('b', 2, 'ut', 3, { undone: true })])).toBe(10);
  });

  it('gir samme svar uansett rekkefølge listen kommer i', () => {
    const liste = [m('a', 1, 'inn', 10), m('b', 2, 'telling', 4), m('c', 3, 'inn', 2)];
    expect(foldMovements(liste)).toBe(foldMovements([...liste].reverse()));
  });

  it('er deterministisk når to bevegelser har samme tidspunkt', () => {
    const a = [m('a', 5, 'telling', 3), m('b', 5, 'telling', 9)];
    expect(foldMovements(a)).toBe(foldMovements([...a].reverse()));
  });

  it('takler tom logg', () => {
    expect(foldMovements([])).toBe(0);
  });

  it('unngår flyttallsstøy', () => {
    expect(foldMovements([m('a', 1, 'inn', 0.1), m('b', 2, 'inn', 0.2)])).toBe(0.3);
  });
});

describe('to enheter som fører samtidig', () => {
  it('trekker fra begge uttak – ikke bare det siste', () => {
    // Kjernen i hvorfor beholdning regnes fra loggen: hadde hver enhet
    // skrevet sitt eget tall, ville den ene overskrevet den andre.
    const telefonA = [m('a1', 100, 'inn', 20), m('a2', 200, 'ut', 1)];
    const telefonB = [m('b1', 201, 'ut', 1)];
    expect(foldMovements(mergeMovements(telefonA, telefonB))).toBe(18);
  });

  it('lar siste telling vinne over tidligere bevegelser', () => {
    const a = [m('a1', 100, 'inn', 20)];
    const b = [m('b1', 300, 'telling', 5)];
    expect(foldMovements(mergeMovements(a, b))).toBe(5);
  });
});

describe('mergeMovements', () => {
  it('fjerner duplikater av samme bevegelse', () => {
    expect(mergeMovements([m('a', 1, 'inn', 1)], [m('a', 1, 'inn', 1)])).toHaveLength(1);
  });

  it('lar angring vinne uansett hvilken side den kom fra', () => {
    const flettet = mergeMovements([m('a', 1, 'inn', 5)], [m('a', 1, 'inn', 5, { undone: true })]);
    expect(flettet[0].undone).toBe(true);
    const omvendt = mergeMovements([m('a', 1, 'inn', 5, { undone: true })], [m('a', 1, 'inn', 5)]);
    expect(omvendt[0].undone).toBe(true);
  });

  it('beholder alle unike bevegelser', () => {
    expect(mergeMovements([m('a', 1, 'inn', 1)], [m('b', 2, 'ut', 1)])).toHaveLength(2);
  });
});

describe('mergeProduct', () => {
  it('lar nyeste endring vinne', () => {
    const gammel = { barcode: '111', name: 'Gammel', updatedAt: 100 };
    const ny = { barcode: '111', name: 'Ny', updatedAt: 200 };
    expect(mergeProduct(gammel, ny).name).toBe('Ny');
    expect(mergeProduct(ny, gammel).name).toBe('Ny');
  });

  it('velger deterministisk ved likt tidspunkt', () => {
    const a = { barcode: '111', name: 'A', updatedAt: 100 };
    const b = { barcode: '222', name: 'B', updatedAt: 100 };
    expect(mergeProduct(a, b)).toEqual(mergeProduct(b, a));
  });

  it('takler at den ene siden mangler', () => {
    const p = { barcode: '111', updatedAt: 1 };
    expect(mergeProduct(null, p)).toBe(p);
    expect(mergeProduct(p, null)).toBe(p);
  });
});

describe('usyncede', () => {
  it('finner bevegelser som ikke er sendt', () => {
    expect(usyncede([m('a', 1, 'inn', 1, { synced: true }), m('b', 2, 'inn', 1)])).toHaveLength(1);
  });
});

describe('flettTilstand', () => {
  const vare = (barcode, name, updatedAt) => ({ barcode, name, updatedAt, qty: 0 });

  it('regner beholdning fra den flettede loggen', () => {
    const res = flettTilstand({
      lokaleVarer: [vare('111', 'Melk', 10)],
      lokaleBevegelser: [m('a', 1, 'inn', 10)],
      eksterneVarer: [vare('111', 'Melk 1L', 20)],
      eksterneBevegelser: [m('b', 2, 'ut', 4)],
    });
    expect(res.varer).toHaveLength(1);
    expect(res.varer[0]).toMatchObject({ name: 'Melk 1L', qty: 6 });
  });

  it('tar med varer som bare finnes på den ene enheten', () => {
    const res = flettTilstand({
      lokaleVarer: [vare('111', 'Melk', 1)],
      eksterneVarer: [vare('222', 'Kaffe', 1)],
    });
    expect(res.varer.map((p) => p.barcode).sort()).toEqual(['111', '222']);
  });

  it('utelater slettede varer', () => {
    const res = flettTilstand({
      lokaleVarer: [{ ...vare('111', 'Melk', 1), deletedAt: 5 }],
    });
    expect(res.varer).toHaveLength(0);
  });

  it('gir vare uten bevegelser beholdning null', () => {
    const res = flettTilstand({ lokaleVarer: [vare('111', 'Melk', 1)] });
    expect(res.varer[0].qty).toBe(0);
  });

  it('gir samme resultat uansett hvilken enhet som flettet', () => {
    const a = { varer: [vare('111', 'A', 10)], bevegelser: [m('a', 1, 'inn', 5)] };
    const b = { varer: [vare('111', 'B', 20)], bevegelser: [m('b', 2, 'ut', 2)] };
    const fraA = flettTilstand({
      lokaleVarer: a.varer, lokaleBevegelser: a.bevegelser,
      eksterneVarer: b.varer, eksterneBevegelser: b.bevegelser,
    });
    const fraB = flettTilstand({
      lokaleVarer: b.varer, lokaleBevegelser: b.bevegelser,
      eksterneVarer: a.varer, eksterneBevegelser: a.bevegelser,
    });
    expect(fraA.varer).toEqual(fraB.varer);
    expect(fraA.bevegelser).toEqual(fraB.bevegelser);
  });
});

describe('sortMovements', () => {
  it('sorterer på tid, så id', () => {
    const sortert = sortMovements([m('c', 2, 'inn', 1), m('b', 1, 'inn', 1), m('a', 1, 'inn', 1)]);
    expect(sortert.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
  it('endrer ikke listen den fikk inn', () => {
    const liste = [m('b', 2, 'inn', 1), m('a', 1, 'inn', 1)];
    sortMovements(liste);
    expect(liste.map((x) => x.id)).toEqual(['b', 'a']);
  });
});
