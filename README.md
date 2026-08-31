# Varelager

Strekkodebasert varetelling for mat, drikke og forbruksmateriell. Appen kjører i
nettleseren på mobil, bruker kameraet til å skanne strekkoder, og registrerer
varer **inn** og **ut** av lageret. Ukjente strekkoder kan beskrives på stedet –
neste gang kjenner appen varen igjen.

All data lagres lokalt på enheten (IndexedDB). Ingen server, ingen konto, og
appen fungerer uten nett når den er lagt til på hjemskjermen.

## Hovedfunksjoner

| Funksjon | Beskrivelse |
| --- | --- |
| **Skanning** | Kamera leser EAN-13/EAN-8/UPC/Code 128/Code 39/ITF/QR. Bruker nettleserens innebygde `BarcodeDetector` når den finnes, ellers ZXing – som dekker Safari på iPhone. |
| **Inn / Ut / Telling** | Tre moduser. Inn og ut endrer beholdningen relativt, telling setter den absolutt. |
| **Hurtigmodus** | +1 per skann uten å taste noe – for rask inn- eller utregistrering av mange varer. |
| **Ukjente varer** | Skjema åpnes automatisk ved ny strekkode. Navn, beskrivelse, kategori, enhet, kolli, leverandør, plassering, minimumsbeholdning og pris lagres på strekkoden. |
| **Kolli** | Registrer «2 kolli à 12» i stedet for å telle enkeltenheter. |
| **Bestillingsliste** | Varer på eller under minimumsbeholdning samles automatisk, gruppert etter leverandør (Norengros, Asko, Kiwi …), med forslag om hele kolli. Deles som tekst eller lastes ned som CSV. |
| **Historikk** | Full logg over alle bevegelser, med angrefunksjon og CSV-eksport. |
| **Varer uten strekkode** | Får en intern kode (`INT-…`) og behandles ellers som alle andre varer. |
| **Sikkerhetskopi** | JSON-eksport/-import for å flytte registeret mellom enheter, og CSV-import av varelister fra grossist eller regneark. |
| **Varedatabase** | Oppslagsregister med 24 594 norske dagligvarer fra Open Food Facts. Skanner du en ukjent kode som finnes der, fylles varenavnet inn automatisk. Registeret er adskilt fra varelageret, så lagerlisten viser bare varer du faktisk fører beholdning på. |
| **Skylagring** | Valgfri synkronisering mot Supabase, så samme lager vises på flere enheter. Personlige kontoer for faste ansatte, delt lagerkode for vikarer. Appen er fortsatt offline-first: registreringer skrives lokalt først og sendes når det er dekning. |
| **Offline** | Service worker cacher appen; alt fungerer i kjølerom uten dekning. |

## Kom i gang

```bash
npm install
npm run dev      # utviklingsserver på http://localhost:5173
npm run build    # produksjonsbygg i dist/
npm test         # enhetstester
```

### Bruk på mobil

Kamera krever HTTPS (eller `localhost`). To alternativer:

1. **GitHub Pages** – arbeidsflyten i `.github/workflows/deploy.yml` publiserer
   appen ved push til `main`. Slå på Pages med kilde «GitHub Actions» under
   *Settings → Pages*.
2. **Lokalt nett** – kjør `npm run dev` (serveren lytter på alle grensesnitt) og
   åpne adressen via en HTTPS-tunnel.

Åpne appen i mobilnettleseren og velg «Legg til på hjemskjermen». Da kjører den i
fullskjerm og uten nett.

## Slik brukes den til daglig

1. **Varemottak:** velg *Inn*, skann alt som pakkes ut. Har du hele kolli, slå på
   kolli-knappen og tast antall kolli.
2. **Uttak:** velg *Ut* og skann det som tas ut av lageret.
3. **Varetelling:** velg *Telling* og skann hylle for hylle – tast det du faktisk
   teller, så settes beholdningen til den verdien.
4. **Bestilling:** fanen *Bestilling* viser alt som ligger på eller under
   minimumsbeholdning, klart til å sendes til leverandør.

## Datamodell

- **products** – varekortet, med `barcode` som nøkkel. Beholdningen (`qty`)
  endres kun gjennom bevegelser.
- **movements** – bevegelseslogg (`inn`, `ut`, `telling`, `justering`) med
  beholdning før og etter. Angring bokfører den motsatte endringen i stedet for å
  slette historikk.
- **settings** – småvalg som lyd og hurtigmodus.

Beholdning og logg skrives i samme IndexedDB-transaksjon, slik at de to aldri kan
komme ut av synk.

### Varedatabasen

`public/data/norske-dagligvarer.csv` inneholder 24 594 norske dagligvarer med
gyldig GS1-kontrollsiffer, hentet fra Open Food Facts. Den lastes inn fra
*Mer → Varedatabase* og lagres i en egen tabell i IndexedDB.

Filen regenereres slik:

```bash
curl -L -C - -o off.csv.gz \
  https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz
node scripts/hent-varedatabase.mjs public/data/norske-dagligvarer.csv off.csv.gz
```

Datasettet er ODbL-lisensiert. Se `data/KILDER.md` for vilkår, kjente
kvalitetsbegrensninger, og hva man bør be grossister som Norengros om — deres
sortiment finnes ikke i noen åpen kilde.

### Skylagring

Skru på under *Mer → Skylagring*. Krever et Supabase-prosjekt:

1. Opprett prosjekt på [supabase.com](https://supabase.com), gjerne i EU-region.
2. Kjør `supabase/schema.sql` i SQL Editor.
3. Lim inn prosjekt-URL og **anon**-nøkkel i appen. Aldri `service_role`.
4. Skal vikarer kunne bli med med lagerkode, må anonym innlogging slås på under
   *Authentication → Providers* i Supabase.

Synkroniseringen henter bare det som er endret siden sist. Målt mot ekte
Postgres tar en bevegelse 212 byte med indekser, så 100 000 bevegelser er
20 MB - hentet i sin helhet ved hver synkronisering ville det brukt opp
trafikkvoten på gratisnivået i løpet av dager. Merket settes fra serverens
tidsstempler, aldri fra enhetens klokke, og går aldri bakover.

Beholdningen lagres aldri som et tall i skyen. Den regnes ut fra
bevegelsesloggen, slik at to enheter som hver fører «ut 1» begge trekkes fra i
stedet for at den ene overskriver den andre. `src/lib/sync-logic.js` inneholder
reglene, med tester som bekrefter at resultatet blir likt uansett hvilken enhet
som flettet.

Tilgangsstyringen ligger i databasen (Row Level Security), ikke i appen:

```bash
bash scripts/test-skjema.sh   # kjører skjemaet mot ekte Postgres
```

Testen verifiserer at en utenforstående ser null rader, at innløst lagerkode gir
tilgang, at vikarer ikke kan slette varer, og at ført historikk ikke kan skrives
om – bare angres.

### Import av varelister

CSV-import godtar norske kolonnenavn og matcher dem løst:
`strekkode`/`ean`/`gtin`, `vare`/`varenavn`/`produkt`, `beskrivelse`, `enhet`,
`antall`, `minimum`, `kolli`, `leverandør`, `plassering` og `pris`.
Rader uten gyldig strekkode får en intern kode.

Import i «slå sammen»-modus oppdaterer varekortene, men beholder beholdningen som
allerede står på enheten. Velg «Erstatt alt» for å gjenopprette en full
sikkerhetskopi med beholdning og historikk.

## Tester

```bash
npm test                          # 108 enhetstester: strekkoder, domene, database, katalog, CSV, fletting
node scripts/smoke.mjs            # ende-til-ende i ekte nettleser
node scripts/kamera-test.mjs      # dekoding fra kamera (ZXing-veien, som på iPhone)
node scripts/kamera-test.mjs --nativ   # dekoding via innebygd BarcodeDetector (Android)
```

Røyktesten går gjennom hele flyten: ukjent strekkode → nytt varekort → inn med
kolli → gjenkjenning → ut → telling → bestillingsliste → angring → eksport →
omstart med data i behold.

Kameratesten tegner en ekte EAN-13-strekkode, pakker den som en videofil og
mater den inn som kamera i nettleseren. Da blir selve dekodingen testet, ikke
bare skjemaflyten. Begge dekodingsveier dekkes: ZXing (Safari på iPhone) og
nettleserens innebygde `BarcodeDetector` (Chrome på Android).

Testene krever Playwright med Chromium (`npx playwright install chromium`).

## Prosjektstruktur

```
src/
  main.js              appskall, faner og ruting
  ui.js                DOM-hjelpere, meldinger, dialoger, norsk formatering
  lib/barcode.js       normalisering, GS1-kontrollsiffer, interne koder
  lib/domain.js        beholdningsregler, søk/gjenkjenning, bestillingsforslag
  lib/db.js            IndexedDB: varer, bevegelser, innstillinger, eksport/import
  lib/scanner.js       kamera, BarcodeDetector med ZXing som reserve
  lib/csv.js           CSV inn og ut (semikolon, som norsk Excel forventer)
  lib/catalog.js       oppslagsregister som foreslår varenavn ved ukjent kode
  lib/sync-logic.js    ren flettelogikk: beholdning regnes fra bevegelsesloggen
  lib/sky.js           Supabase: innlogging, lager og synkronisering
  views/               skann, lager, historikk, bestilling, innstillinger
scripts/
  hent-varedatabase.mjs uttrekk av norske varer fra Open Food Facts
  make-icons.mjs       genererer PNG-ikonene
  smoke.mjs            ende-til-ende-test
```
