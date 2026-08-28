/**
 * Kameratest: mater et ekte EAN-13-bilde inn som videokamera og sjekker at
 * appen dekoder koden uten at noe tastes manuelt.
 *
 * Kjøres med: node scripts/kamera-test.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { writeFileSync } from 'node:fs';
import { renderEan13, toY4m } from './ean13.mjs';

const KODE = '7038010000188';
const y4m = '/tmp/strekkode.y4m';
writeFileSync(y4m, toY4m(renderEan13(KODE)));

const server = await createServer({ server: { port: 5201 }, logLevel: 'error' });
await server.listen();

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${y4m}`,
  ],
});
const ctx = await browser.newContext({
  viewport: { width: 414, height: 896 },
  permissions: ['camera'],
  locale: 'nb-NO',
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

// Linux-Chromium mangler BarcodeDetector, så den native grenen – den de
// fleste Android-telefoner treffer – testes med en innsprøytet detektor
// som etterligner nettleser-API-et.
if (process.argv.includes('--nativ')) {
  await page.addInitScript(() => {
    window.BarcodeDetector = class {
      static getSupportedFormats() { return Promise.resolve(['ean_13', 'ean_8', 'qr_code']); }
      constructor(opts) { this.formats = opts?.formats || []; }
      async detect(video) {
        // Svarer først når videoen faktisk spiller, slik en ekte detektor gjør.
        if (!video || video.readyState < 2 || video.videoWidth === 0) return [];
        return [{ rawValue: '7038010000188', format: 'ean_13' }];
      }
    };
  });
}

await page.goto('http://localhost:5201', { waitUntil: 'networkidle' });

const dekoder = await page.evaluate(async () => {
  if (!('BarcodeDetector' in window)) return 'ZXing (ingen innebygd BarcodeDetector)';
  try {
    return 'innebygd BarcodeDetector: ' + (await BarcodeDetector.getSupportedFormats()).join(', ');
  } catch {
    return 'ZXing';
  }
});
console.log('dekoder i bruk:', dekoder);

let ok = false;
try {
  // Ukjent kode skal åpne skjemaet for ny vare – helt uten tastetrykk.
  await page.waitForSelector('dialog[open]', { timeout: 25000 });
  const tekst = await page.locator('dialog').innerText();
  ok = tekst.includes('Ukjent strekkode') && tekst.includes('7 038010 000188');
  console.log(ok
    ? `  ok  kameraet dekodet ${KODE} og åpnet skjemaet for ny vare`
    : `  FEIL  dialog åpnet, men innholdet stemte ikke:\n${tekst.slice(0, 200)}`);
} catch {
  console.log('  FEIL  kameraet dekodet ingen strekkode innen 25 sekunder');
}

writeFileSync('/tmp/claude-0/-home-user-App/f996b2f0-7eff-5758-981e-bd61b239c8e8/scratchpad/shots/kamera.png', await page.screenshot());
if (errors.length) console.log('  FEIL  konsollfeil:', errors.slice(0, 3));

await browser.close();
await server.close();
process.exit(ok && !errors.length ? 0 : 1);
