/**
 * Henter norske dagligvarer fra Open Food Facts og skriver dem i appens
 * importformat.
 *
 * Kjøres med: node scripts/hent-varedatabase.mjs [utfil.csv]
 *
 * Datasettet er lisensiert under Open Database License (ODbL) av
 * Open Food Facts-bidragsyterne. Bruk krever kreditering, og en videreformidlet
 * database må deles på samme vilkår. Se data/KILDER.md.
 *
 * Filen på ~1,3 GB pakkes ut og filtreres i strømmen, slik at ingenting
 * mellomlagres på disk.
 */
import { createGunzip } from 'node:zlib';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';

const URL_CSV = 'https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz';
const ut = process.argv[2] || 'norske-dagligvarer.csv';

/** Kolonnene vi trenger, med navnet de har i eksportfilen. */
const FELT = ['code', 'product_name', 'brands', 'quantity', 'countries_tags', 'categories_tags'];

// Grovkategorisering til appens fire kategorier.
function kategoriser(kategorier = '', navn = '') {
  const t = `${kategorier} ${navn}`.toLowerCase();
  if (/beverage|drink|water|juice|soda|coffee|tea|milk|brus|saft|kaffe|vann/.test(t)) return 'drikke';
  if (/cleaning|detergent|hygiene|paper|soap|non-food/.test(t)) return 'forbruk';
  return 'mat';
}

const res = await fetch(URL_CSV, { headers: { 'User-Agent': 'Varelager/1.0 (github.com/magnus347/App)' } });
if (!res.ok) throw new Error(`Nedlasting feilet: HTTP ${res.status}`);

const utfil = createWriteStream(ut);
utfil.write('strekkode;vare;beskrivelse;kategori;enhet;leverandor\r\n');

let lest = 0;
let skrevet = 0;
let idx = null;
const sett = new Set();

const linjer = createInterface({
  input: Readable.fromWeb(res.body).pipe(createGunzip()),
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

  const kode = (f[idx.code] || '').replace(/\D/g, '');
  const navn = (f[idx.product_name] || '').trim();
  if (!/^\d{8,14}$/.test(kode) || !navn || sett.has(kode)) continue;
  sett.add(kode);

  const merke = (f[idx.brands] || '').split(',')[0].trim();
  const mengde = (f[idx.quantity] || '').trim();
  const q = (s) => (/[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

  utfil.write([
    kode,
    q([navn, mengde].filter(Boolean).join(' ')),
    q([merke, mengde].filter(Boolean).join(' ')),
    kategoriser(f[idx.categories_tags], navn),
    'stk',
    q(merke),
  ].join(';') + '\r\n');
  skrevet++;
  if (skrevet % 2000 === 0) console.log(`  ${skrevet} norske varer (lest ${lest} rader)`);
}

utfil.end();
console.log(`\nFerdig: ${skrevet} norske varer skrevet til ${ut} (av ${lest} rader totalt)`);
