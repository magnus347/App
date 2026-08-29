/**
 * Røyktest: kjører hele appen i en ekte nettleser med et falskt kamera,
 * og går gjennom hovedflyten – ukjent strekkode, inn, ut, telling,
 * bestillingsliste og eksport.
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';

const shots = [];
// En ekte kode fra varedatabasen, brukt for å teste oppslaget.
const KJENT_KODE = '00004091';
let failures = 0;

function check(name, ok, extra = '') {
  console.log(`${ok ? '  ok ' : '  FEIL '} ${name}${extra ? ' – ' + extra : ''}`);
  if (!ok) failures++;
}

const server = await createServer({ server: { port: 5199 }, logLevel: 'error' });
await server.listen();
const base = 'http://localhost:5199';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const ctx = await browser.newContext({
  viewport: { width: 414, height: 896 },
  permissions: ['camera'],
  locale: 'nb-NO',
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(base, { waitUntil: 'networkidle' });
check('appen laster', await page.locator('h1').innerText() === 'Skann strekkode');
check('fanelinjen har 5 faner', await page.locator('.tabbar a').count() === 5);

/* --- 1. Ukjent strekkode registreres som ny vare ------------------- */
await page.fill('input[placeholder="Tast strekkode manuelt"]', '7038010000188');
await page.press('input[placeholder="Tast strekkode manuelt"]', 'Enter');
await page.waitForSelector('dialog[open]');
check('ukjent kode åpner skjema for ny vare',
  (await page.locator('dialog h2').innerText()).includes('Ukjent strekkode'));
check('strekkoden vises formatert i skjemaet',
  (await page.locator('dialog').innerText()).includes('7 038010 000188'));
check('ny vare merkes som ny, ikke som registrert',
  (await page.locator('dialog').innerText()).includes('Ny strekkode'));
check('ny vare har ingen slett-knapp',
  (await page.locator('dialog button:has-text("Slett vare")').count()) === 0);

await page.fill('#f-name', 'Lettmelk 1L Tine');
await page.fill('#f-desc', 'Kjølevare til kantina');
await page.selectOption('#f-cat', 'drikke');
await page.fill('#f-unit', 'stk');
await page.fill('#f-pack', '12');
await page.fill('#f-sup', 'Asko');
await page.fill('#f-min', '6');
await page.click('dialog button[type="submit"]');
await page.waitForSelector('dialog[open]', { state: 'detached' });
shots.push(['ny-vare-lagret', await page.screenshot()]);
check('varen er lagret og antallskortet vises',
  (await page.locator('main').innerText()).includes('Lettmelk 1L Tine'));

/* --- 2. Registrer inn 2 kolli ------------------------------------- */
await page.click('button[aria-pressed="false"]:has-text("Enkeltenheter")');
await page.fill('.stepper input', '2');
await page.click('button.wide:has-text("Registrer inn")');
await page.waitForTimeout(200);
check('2 kolli à 12 gir 24 på lager',
  (await page.locator('main').innerText()).includes('24'));

/* --- 3. Samme kode igjen: gjenkjennes, hurtigmodus +1 -------------- */
await page.fill('input[placeholder="Tast strekkode manuelt"]', '7038010000188');
await page.press('input[placeholder="Tast strekkode manuelt"]', 'Enter');
await page.waitForTimeout(300);
const etterHurtig = await page.locator('main').innerText();
check('kjent kode gjenkjennes uten skjema', !(await page.locator('dialog[open]').count()));
check('hurtigmodus legger til 1 (25)', etterHurtig.includes('25'));

/* --- 4. Ut-modus -------------------------------------------------- */
await page.click('.modes button:has-text("Ut")');
await page.fill('input[placeholder="Tast strekkode manuelt"]', '7038010000188');
await page.press('input[placeholder="Tast strekkode manuelt"]', 'Enter');
await page.waitForTimeout(300);
check('ut trekker fra (24)', (await page.locator('main').innerText()).includes('24'));

/* --- 5. Telling setter absolutt beholdning ------------------------ */
await page.click('.modes button:has-text("Telling")');
await page.fill('input[placeholder="Tast strekkode manuelt"]', '7038010000188');
await page.press('input[placeholder="Tast strekkode manuelt"]', 'Enter');
await page.waitForSelector('.stepper input');
await page.fill('.stepper input', '5');
await page.click('button.wide:has-text("Sett beholdning")');
await page.waitForTimeout(200);
const teltTekst = await page.locator('main').innerText();
check('telling setter beholdning til 5', teltTekst.includes('5'));
check('varsler at varen er under minimum', teltTekst.includes('Under minimum'));
shots.push(['telling', await page.screenshot()]);

/* --- 6. Lageroversikt --------------------------------------------- */
await page.click('.tabbar a[href="#/lager"]');
await page.waitForTimeout(300);
const lager = await page.locator('main').innerText();
check('lagerlisten viser varen', lager.includes('Lettmelk 1L Tine'));
check('varen er merket for bestilling', lager.includes('Bestill'));
check('statistikk viser 1 vare', lager.includes('1'));
shots.push(['lager', await page.screenshot()]);

// Søk på beskrivelsen brukeren skrev inn – gjenkjenning i praksis.
await page.fill('input[type="search"]', 'kantina');
await page.waitForTimeout(200);
check('søk på egen beskrivelse finner varen',
  (await page.locator('.list li').count()) === 1);
await page.fill('input[type="search"]', '');

/* --- 7. Detaljvisning og hurtigknapp ------------------------------ */
await page.click('.list li');
await page.waitForSelector('dialog[open]');
check('detaljvisning viser historikk',
  (await page.locator('dialog').innerText()).includes('Siste bevegelser'));
await page.click('dialog button:has-text("+1 inn")');
await page.waitForTimeout(300);
check('hurtigknapp oppdaterer beholdning til 6',
  (await page.locator('.list li .qty').innerText()).startsWith('6'));

/* --- 7b. Redigering av kjent vare ---------------------------------- */
await page.click('.list li');
await page.waitForSelector('dialog[open]');
await page.click('dialog button:has-text("Rediger")');
await page.waitForTimeout(300);
const redigerTekst = await page.locator('dialog').last().innerText();
check('kjent vare merkes som registrert', redigerTekst.includes('Registrert strekkode'));
check('kjent vare kan slettes',
  (await page.locator('dialog button:has-text("Slett vare")').count()) === 1);
await page.locator('dialog button:has-text("Avbryt")').last().click();
await page.waitForTimeout(200);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

/* --- 8. Bestillingsliste ------------------------------------------ */
await page.click('.tabbar a[href="#/bestilling"]');
await page.waitForTimeout(300);
const bestilling = await page.locator('main').innerText();
check('bestillingslisten grupperer på leverandør', bestilling.includes('Asko'));
check('foreslår hele kolli', bestilling.includes('kolli'));
shots.push(['bestilling', await page.screenshot()]);

/* --- 9. Historikk og angre ---------------------------------------- */
await page.click('.tabbar a[href="#/historikk"]');
await page.waitForTimeout(300);
const antallBevegelser = await page.locator('.list li').count();
check('historikken viser alle 5 bevegelsene', antallBevegelser === 5, `fant ${antallBevegelser}`);
shots.push(['historikk', await page.screenshot()]);

await page.click('.list li button:has-text("Angre")');
await page.waitForSelector('dialog[open]');
await page.click('dialog button:has-text("Angre")');
await page.waitForTimeout(400);
check('angring markerer bevegelsen',
  (await page.locator('main').innerText()).includes('angret'));

/* --- 10. Eksport -------------------------------------------------- */
const dl = page.waitForEvent('download');
await page.click('button:has-text("Eksporter")');
const fil = await dl;
check('CSV lastes ned', fil.suggestedFilename().startsWith('bevegelser_'));

/* --- 10b. Varedatabase som oppslagsregister ----------------------- */
await page.click('.tabbar a[href="#/innstillinger"]');
await page.waitForTimeout(300);
check('varedatabasen er ikke lastet inn fra start',
  (await page.locator('main').innerText()).includes('Ikke lastet inn'));

await page.click('button:has-text("Last inn varedatabasen")');
await page.waitForFunction(
  () => document.querySelector('main')?.innerText.includes('strekkoder lastet inn'),
  null, { timeout: 90000 }
);
const katTekst = await page.locator('main').innerText();
check('varedatabasen lastes inn', /[\d\s.,]+strekkoder lastet inn/.test(katTekst));

// En kode som finnes i databasen, men ikke i varelageret, skal få navn foreslått.
await page.click('.tabbar a[href="#/skann"]');
await page.waitForTimeout(400);
await page.fill('input[placeholder="Tast strekkode manuelt"]', KJENT_KODE);
await page.press('input[placeholder="Tast strekkode manuelt"]', 'Enter');
await page.waitForSelector('dialog[open]', { timeout: 15000 });
const forslagTekst = await page.locator('dialog').innerText();
check('ukjent vare får navn foreslått fra databasen',
  forslagTekst.includes('funnet i varedatabasen') && forslagTekst.includes('Foreslått fra varedatabasen'));
const foreslattNavn = await page.locator('#f-name').inputValue();
check('navnefeltet er forhåndsutfylt', foreslattNavn.length > 0, `«${foreslattNavn}»`);
shots.push(['databaseforslag', await page.screenshot()]);
await page.locator('dialog button:has-text("Avbryt")').click();
await page.waitForTimeout(300);

/* --- 11. Innstillinger og sikkerhetskopi -------------------------- */
await page.click('.tabbar a[href="#/innstillinger"]');
await page.waitForTimeout(300);
const dl2 = page.waitForEvent('download');
await page.click('button:has-text("Last ned sikkerhetskopi")');
const backup = await dl2;
check('sikkerhetskopi lastes ned', backup.suggestedFilename().endsWith('.json'));
shots.push(['innstillinger', await page.screenshot()]);

/* --- 12. Data overlever omstart ----------------------------------- */
await page.reload({ waitUntil: 'networkidle' });
await page.click('.tabbar a[href="#/lager"]');
await page.waitForTimeout(400);
check('data ligger igjen etter omstart',
  (await page.locator('main').innerText()).includes('Lettmelk 1L Tine'));

check('ingen JavaScript-feil i konsollen', errors.length === 0, errors.slice(0, 3).join(' | '));

const { writeFileSync, mkdirSync } = await import('node:fs');
mkdirSync('/tmp/claude-0/-home-user-App/f996b2f0-7eff-5758-981e-bd61b239c8e8/scratchpad/shots', { recursive: true });
for (const [name, buf] of shots) {
  writeFileSync(`/tmp/claude-0/-home-user-App/f996b2f0-7eff-5758-981e-bd61b239c8e8/scratchpad/shots/${name}.png`, buf);
}

await browser.close();
await server.close();
console.log(failures ? `\n${failures} sjekk(er) feilet` : '\nAlle sjekker passerte');
process.exit(failures ? 1 : 0);
