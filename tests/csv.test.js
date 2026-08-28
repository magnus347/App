import { describe, it, expect } from 'vitest';
import { toCsv, fromCsv } from '../src/lib/csv.js';

describe('toCsv', () => {
  it('bruker semikolon slik norsk Excel forventer', () => {
    expect(toCsv([{ a: 1, b: 2 }])).toBe('a;b\r\n1;2');
  });
  it('siterer felt med skilletegn, anførselstegn og linjeskift', () => {
    expect(toCsv([{ n: 'Melk; 1L' }])).toBe('n\r\n"Melk; 1L"');
    expect(toCsv([{ n: 'Sier "hei"' }])).toBe('n\r\n"Sier ""hei"""');
  });
  it('følger oppgitt kolonnerekkefølge og tomme verdier', () => {
    expect(toCsv([{ a: 1, b: null }], ['b', 'a'])).toBe('b;a\r\n;1');
  });
});

describe('fromCsv', () => {
  it('leser semikolonfil til objekter', () => {
    expect(fromCsv('navn;antall\r\nMelk;3')).toEqual([{ navn: 'Melk', antall: '3' }]);
  });
  it('leser komma-fil', () => {
    expect(fromCsv('navn,antall\nMelk,3')).toEqual([{ navn: 'Melk', antall: '3' }]);
  });
  it('takler siterte felt med skilletegn og doble anførselstegn', () => {
    expect(fromCsv('navn;m\r\n"Melk; 1L";"Sier ""hei"""'))
      .toEqual([{ navn: 'Melk; 1L', m: 'Sier "hei"' }]);
  });
  it('hopper over tomme linjer og BOM', () => {
    expect(fromCsv('﻿navn;a\nMelk;1\n\n')).toEqual([{ navn: 'Melk', a: '1' }]);
  });
  it('gir tom liste for tom tekst', () => {
    expect(fromCsv('')).toEqual([]);
  });
  it('tåler rader med færre kolonner enn overskriften', () => {
    expect(fromCsv('a;b;c\n1;2')).toEqual([{ a: '1', b: '2', c: '' }]);
  });
});

describe('rundtur', () => {
  it('beholder verdiene gjennom eksport og import', () => {
    const rows = [{ strekkode: '7038010000188', navn: 'Melk; "Tine"', antall: '12' }];
    expect(fromCsv(toCsv(rows))).toEqual(rows);
  });
});
