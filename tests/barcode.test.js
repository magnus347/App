import { describe, it, expect } from 'vitest';
import {
  normalizeBarcode, checkDigit, isValidCheckDigit, isStorableBarcode,
  originHint, makeInternalBarcode, formatBarcode,
} from '../src/lib/barcode.js';

describe('checkDigit', () => {
  it('regner ut riktig kontrollsiffer for EAN-13', () => {
    expect(checkDigit('700123456789'.slice(0, 12))).toBe(checkDigit('700123456789'));
    expect(checkDigit('400638133393')).toBe(1); // 4006381333931
    expect(checkDigit('501234567890')).toBe(0); // 5012345678900
  });
  it('regner ut riktig kontrollsiffer for EAN-8', () => {
    expect(checkDigit('9638507')).toBe(4); // 96385074
  });
});

describe('isValidCheckDigit', () => {
  it('godtar gyldige koder', () => {
    expect(isValidCheckDigit('4006381333931')).toBe(true);
    expect(isValidCheckDigit('96385074')).toBe(true);
    expect(isValidCheckDigit('036000291452')).toBe(true); // UPC-A
  });
  it('avviser feil kontrollsiffer og feil lengde', () => {
    expect(isValidCheckDigit('4006381333932')).toBe(false);
    expect(isValidCheckDigit('12345')).toBe(false);
    expect(isValidCheckDigit('')).toBe(false);
  });
});

describe('normalizeBarcode', () => {
  it('stripper mellomrom og tegn', () => {
    expect(normalizeBarcode(' 4006 381 333931 ')).toBe('4006381333931');
  });
  it('utvider gyldig UPC-A til EAN-13 slik at varen ikke dubleres', () => {
    expect(normalizeBarcode('036000291452')).toBe('0036000291452');
  });
  it('lar 12-sifret kode med ugyldig sjekksiffer stå urørt', () => {
    expect(normalizeBarcode('036000291453')).toBe('036000291453');
  });
  it('beholder interne koder', () => {
    expect(normalizeBarcode('int-abc123')).toBe('INT-ABC123');
  });
  it('takler tomme verdier', () => {
    expect(normalizeBarcode(null)).toBe('');
    expect(normalizeBarcode(undefined)).toBe('');
  });
});

describe('isStorableBarcode', () => {
  it('godtar EAN, interne koder og grossistkoder uten sjekksiffer', () => {
    expect(isStorableBarcode('4006381333931')).toBe(true);
    expect(isStorableBarcode('INT-XY12')).toBe(true);
    expect(isStorableBarcode('1234567')).toBe(true);
  });
  it('avviser for korte koder og tekst', () => {
    expect(isStorableBarcode('123')).toBe(false);
    expect(isStorableBarcode('melk')).toBe(false);
    expect(isStorableBarcode('')).toBe(false);
  });
});

describe('originHint', () => {
  it('kjenner igjen norsk GS1-prefiks', () => {
    expect(originHint('7038010000188')).toBe('Norge');
  });
  it('kjenner igjen intern butikkode', () => {
    expect(originHint('2012345678903')).toBe('Intern/butikkode');
  });
  it('returnerer null for interne koder', () => {
    expect(originHint('INT-ABC')).toBe(null);
  });
  it('gjetter ikke opprinnelse for EAN-8', () => {
    // Nullpadding til 13 siffer ville feilaktig gitt «USA/Canada».
    expect(originHint('00004091')).toBe(null);
    expect(originHint('96385074')).toBe(null);
  });
  it('utvider gyldig UPC-A og gjenkjenner den', () => {
    expect(originHint('036000291452')).toBe('USA/Canada');
  });
});

describe('makeInternalBarcode', () => {
  it('lager lagringsbare, unike koder', () => {
    const a = makeInternalBarcode();
    expect(a.startsWith('INT-')).toBe(true);
    expect(isStorableBarcode(a)).toBe(true);
  });
});

describe('formatBarcode', () => {
  it('grupperer EAN-13 for lesbarhet', () => {
    expect(formatBarcode('7038010000188')).toBe('7 038010 000188');
  });
});
