/**
 * Henter norske dagligvarer fra Open Food Facts og skriver dem i appens
 * CSV-importformat.
 *
 *   node scripts/hent-varedatabase.mjs [utfil.csv] [nedlastet-fil.csv.gz]
 *
 * Datasettet er på ~1,3 GB. Uten en lokal fil strømmes det direkte, men den
 * overføringen blir lett avbrutt; hent den heller én gang med gjenopptakelse
 * og oppgi filen som andre argument:
 *
 *   curl -L -C - -o off.csv.gz \
 *     https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz
 *
 * Data er lisensiert under Open Database License (ODbL) av Open Food
 * Facts-bidragsyterne. Se data/KILDER.md for vilkår og datakvalitet.
 */
import { createGunzip } from 'node:zlib';
import { createWriteStream, createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { normalizeBarcode, isValidCheckDigit } from '../src/lib/barcode.js';

const URL_CSV = 'https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz';
const ut = process.argv[2] || 'norske-dagligvarer.csv';
const lokalFil = process.argv[3] || process.env.OFF_CSV_GZ || null;

const FELT = ['code', 'product_name', 'brands', 'quantity', 'countries_tags', 'categories_tags'];

// Forbruksmateriell kjennes best igjen på det norske varenavnet: de engelske
// kategoritaggene i datasettet dekker i praksis bare matvarer.
const FORBRUK = /toalettpapir|t(ø|o)rkepapir|husholdningspapir|servietter?|s(å|a)pe|vaskemiddel|oppvask|rengj(ø|o)ring|desinfeksjon|hansker|avfallspose|s(ø|o)ppelsekk|engangs|aluminiumsfolie|plastfolie|bakepapir|cleaning|detergent|hygiene|soap|napkin|paper-towel/i;
const DRIKKE = /\b(brus|saft|juice|kaffe|te|vann|melk|drikke|smoothie|nektar|(ø|o)l|cider|vin|beverage|drink|water|soda|coffee|milk|beers|wines|juices)\b/i;

/** Grovkategorisering til appens fire kategorier. */
export function kategoriser(kategorier = '', navn = '') {
  const t = `${navn} ${kategorier}`;
  if (FORBRUK.test(t)) return 'forbruk';
  if (DRIKKE.test(t)) return 'drikke';
  return 'mat';
}

async function kilde() {
  if (lokalFil) return createReadStream(lokalFil);
  const res = await fetch(URL_CSV, {
    headers: { 'User-Agent': 'Varelager/1.0 (github.com/magnus347/App)' },
  });
  if (!res.ok) throw new Error(`Nedlasting feilet: HTTP ${res.status}`);
  return Readable.fromWeb(res.body);
}

const utfil = createWriteStream(ut);
// Leverandørkolonnen utelates med vilje: merket i datasettet er produsenten,
// mens leverandøren er den man faktisk bestiller fra (Norengros, Asko …).
// Feil verdi der ville gruppert bestillingslisten på feil grunnlag.
utfil.write('strekkode;vare;beskrivelse;kategori;enhet\r\n');

let lest = 0;
let skrevet = 0;
let forkastet = 0;
let idx = null;
const sett = new Set();

const linjer = createInterface({
  input: (await kilde()).pipe(createGunzip()),
  crlfDelay: Infinity,
});

for await (const linje of linjer) {
  if (idx === null) {
    const h = linje.split('\t');
    idx = Object.fromEntries(FELT.map((f) => [f, h.indexOf(f)]));
    const mangler = FELT.filter((f) => idx[f] < 0);
    if (mangler.length) throw new Error(`Fant ikke kolonnene: ${mangler.join(', ')}`);
    continue;
  }
  lest++;
  const f = linje.split('\t');
  if (!f[idx.countries_tags]?.includes('en:norway')) continue;

  const navn = (f[idx.product_name] || '').replace(/\s+/g, ' ').trim();
  if (!navn) continue;

  // Bare koder med gyldig GS1-kontrollsiffer slipper gjennom. Datasettet
  // inneholder interne testkoder som ellers ville forurenset varelageret.
  const kode = normalizeBarcode(f[idx.code] || '');
  if (!isValidCheckDigit(kode) || sett.has(kode)) {
    forkastet++;
    continue;
  }
  sett.add(kode);

  const merke = (f[idx.brands] || '').split(',')[0].replace(/\s+/g, ' ').trim();
  const mengde = (f[idx.quantity] || '').replace(/\s+/g, ' ').trim();
  const q = (s) => (/[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

  utfil.write([
    kode,
    q([navn, mengde].filter(Boolean).join(' ').slice(0, 120)),
    q(merke),
    kategoriser(f[idx.categories_tags], navn),
    'stk',
  ].join(';') + '\r\n');
  skrevet++;
  if (skrevet % 5000 === 0) console.log(`  ${skrevet} varer (lest ${lest} rader)`);
}

utfil.end();
console.log(`\nFerdig: ${skrevet} norske varer til ${ut}`);
console.log(`Forkastet ${forkastet} rader med ugyldig eller duplisert strekkode (av ${lest} lest).`);
