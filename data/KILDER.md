# Kilder og lisens for varedatabasen

## Norske dagligvarer — Open Food Facts

Filen `norske-dagligvarer.csv` er hentet fra **Open Food Facts** og filtrert til
produkter merket med Norge som salgsland. Den er laget med
`scripts/hent-varedatabase.mjs`.

- Kilde: https://world.openfoodfacts.org
- Lisens: **Open Database License (ODbL) v1.0** — https://opendatacommons.org/licenses/odbl/1-0/
- Opphav: Open Food Facts-bidragsyterne

### Hva lisensen krever

ODbL gir deg fri bruk, også kommersielt, men på tre vilkår:

1. **Kreditering.** Bruker du databasen eller noe utledet av den offentlig, må
   Open Food Facts krediteres som kilde.
2. **Del på samme vilkår.** Distribuerer du en endret eller utvidet versjon av
   selve databasen, må den også være ODbL.
3. **Ingen teknisk låsing.** Du kan ikke sperre andres tilgang med DRM.

Bruk av dataene til å drive ditt eget lager internt utløser ingen av kravene —
de slår først inn når du deler databasen videre.

### Datakvalitet

Open Food Facts er dugnadsbasert. Det betyr i praksis:

- **Dekningen er ujevn.** Store merkevarer er godt dekket, mens lokale varer,
  ferskvarer og storhusholdningspakninger ofte mangler helt.
- **Navnene varierer.** Noen produkter har fullt navn med mengde, andre bare et
  stikkord. Enkelte er skrevet på engelsk eller svensk.
- **Kategoriseringen her er grov.** Skriptet gjetter mat/drikke/forbruk ut fra
  varenavnet. Regn med at noe må rettes for hånd.
- **Bare koder med gyldig GS1-kontrollsiffer** er tatt med, for å holde
  interne testkoder ute av registeret.

Databasen er ment som et *starthjelp*, ikke en fasit. Varekortet ditt er
sannheten: retter du et navn i appen, er det din versjon som gjelder videre.

## Norengros og andre grossister

Det finnes **ingen åpen database** over sortimentet til Norengros, Asko eller
matvarekjedene. Katalogene ligger bak kundeinnlogging.

Riktig vei er å be om en varefil fra kundekontakten din, eller eksportere
sortiment/ordrehistorikk fra kundeportalen. Be om en fil med:

| Felt | Merknad |
| --- | --- |
| EAN/strekkode | det appen skanner på |
| Varenummer | grossistens eget nummer |
| Varetekst | navnet som vises i appen |
| Enhet | stk, kg, l, rull … |
| Antall per kolli | gjør at du kan registrere hele kolli |
| Pris | valgfritt, gir lagerverdi |

Filen importeres under *Mer → Importer fil*. Kolonnenavn matches løst, så
`strekkode`, `ean` og `gtin` fungerer om hverandre — det samme gjør `vare`,
`varenavn` og `produkt`.
