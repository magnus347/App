# Varelager

Strekkodebasert varetelling for mat, drikke og forbruksmateriell. Offline-first
PWA uten server: all lagerdata ligger lokalt i IndexedDB på brukerens enhet.

**Appen kjører på https://magnus347.github.io/App/**

## Preferanser

- Svar på norsk.
- **Legg alltid lenken til appen nederst i svaret.**

## Arkitektur i korte trekk

- `src/lib/domain.js` — beholdningsregler, søk, bestillingsforslag. Ren logikk
  uten DOM eller database, så reglene kan testes isolert.
- `src/lib/db.js` — IndexedDB. Beholdning endres **kun** gjennom bevegelser, og
  beholdning og logg skrives i samme transaksjon så de aldri kommer ut av synk.
  Angring bokfører den motsatte endringen framfor å slette historikk.
- `src/lib/catalog.js` — oppslagsregister som foreslår varenavn ved ukjent kode.
  Ligger i egen IndexedDB-tabell, adskilt fra varelageret med vilje: lagerlisten
  skal vise varer man fører beholdning på, ikke hele sortimentet.
- `src/lib/scanner.js` — kamera. Nettleserens `BarcodeDetector` når den finnes,
  ellers ZXing (som dekker Safari på iPhone). Begge veier må testes.

## Testing

```bash
npm test                               # enhetstester
node scripts/smoke.mjs                 # hele flyten i ekte nettleser
node scripts/kamera-test.mjs           # dekoding fra kamera, ZXing-veien
node scripts/kamera-test.mjs --nativ   # dekoding via BarcodeDetector
```

Kameratesten tegner en ekte EAN-13-strekkode og mater den inn som videokamera,
slik at dekodingen testes og ikke bare skjemaflyten. Kjør begge varianter før
endringer i skanneren pushes.

## Fallgruver

- **Ikke bruk `pkill -f <mønster>` når mønsteret finnes i din egen kommando** —
  den dreper sitt eget skall og kan avbryte en filskriving midtveis. Verifiser
  alltid innholdet i en fil etter skriving; `node --check` bekrefter bare at
  syntaksen er gyldig, ikke at riktig versjon ble skrevet.
- **Datasettet fra Open Food Facts er 1,3 GB.** Strømming blir avbrutt; hent det
  med `curl -C -` og kjør filtreringen mot den lokale filen.
- **Norengros og grossistsortiment finnes ikke i åpne kilder.** Slike varelister
  må komme fra kundens eget kundeforhold og importeres som CSV.
