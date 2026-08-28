/** Sikkerhetskopi, import/eksport og informasjon om appen. */
import { el, toast, confirmDialog, kr } from '../ui.js';
import { allProducts, exportAll, importAll, recentMovements } from '../lib/db.js';
import { normalizeBarcode, isStorableBarcode, makeInternalBarcode } from '../lib/barcode.js';
import { totalValue, CATEGORIES } from '../lib/domain.js';
import { toCsv, fromCsv, download, stamp } from '../lib/csv.js';

export function settingsView(app) {
  const info = el('div.stat-grid');

  async function reload() {
    const [products, movements] = await Promise.all([allProducts(), recentMovements(100000)]);
    info.replaceChildren(
      el('div.stat', {}, el('div.v', {}, products.length), el('div.k', {}, 'varer')),
      el('div.stat', {}, el('div.v', {}, movements.length), el('div.k', {}, 'bevegelser')),
      el('div.stat', {}, el('div.v', {}, kr(totalValue(products))), el('div.k', {}, 'lagerverdi'))
    );
  }

  const fileInput = el('input', {
    type: 'file', accept: '.json,.csv,application/json,text/csv', class: 'hidden',
    onchange: async (ev) => {
      const file = ev.target.files?.[0];
      ev.target.value = '';
      if (!file) return;
      try {
        const text = await file.text();
        if (file.name.toLowerCase().endsWith('.csv')) await importCsv(text);
        else await importJson(text);
      } catch (err) {
        toast(`Import feilet: ${err.message}`, 'err');
      }
    },
  });

  async function importJson(text) {
    const data = JSON.parse(text);
    const replaceAll = await confirmDialog(
      'Erstatte hele registeret?',
      'Ja erstatter varer, beholdning og historikk med innholdet i filen. Avbryt slår i stedet sammen varekortene og beholder beholdningen du har på denne enheten.',
      { okText: 'Erstatt alt', danger: true }
    );
    const res = await importAll(data, { mode: replaceAll ? 'replace' : 'merge' });
    toast(`Importerte ${res.products} varer`, 'ok');
    await reload();
    app.refreshAll();
  }

  /** Leser en varefil fra grossist/regneark. Kolonnenavn matches løst. */
  async function importCsv(text) {
    const rows = fromCsv(text);
    if (!rows.length) throw new Error('Fant ingen rader');
    const pick = (row, ...names) => {
      for (const [key, value] of Object.entries(row)) {
        const k = key.toLowerCase().replace(/[^a-zæøå]/g, '');
        if (names.includes(k)) return value;
      }
      return '';
    };
    const products = [];
    let hoppet = 0;
    for (const row of rows) {
      const name = pick(row, 'vare', 'varenavn', 'navn', 'produkt', 'beskrivelse', 'tekst');
      let barcode = normalizeBarcode(pick(row, 'strekkode', 'ean', 'gtin', 'kode', 'varenummer', 'artikkelnummer'));
      if (!name && !barcode) {
        hoppet++;
        continue;
      }
      if (!isStorableBarcode(barcode)) barcode = makeInternalBarcode(Date.now() + products.length);
      const cat = pick(row, 'kategori').toLowerCase();
      products.push({
        barcode,
        name: name || barcode,
        description: pick(row, 'beskrivelse', 'notat'),
        category: CATEGORIES.find((c) => c.id === cat || c.label.toLowerCase() === cat)?.id || 'annet',
        unit: pick(row, 'enhet') || 'stk',
        supplier: pick(row, 'leverandor', 'leverandør', 'grossist'),
        location: pick(row, 'plassering', 'hylle', 'lokasjon'),
        packSize: Number(String(pick(row, 'kolli', 'antallperkolli', 'pakning')).replace(',', '.')) || 1,
        minQty: Number(String(pick(row, 'minimum', 'minbeholdning', 'min')).replace(',', '.')) || 0,
        qty: Number(String(pick(row, 'antall', 'beholdning', 'lager')).replace(',', '.')) || 0,
        price: Number(String(pick(row, 'pris', 'innkjopspris', 'innkjøpspris')).replace(',', '.')) || null,
      });
    }
    if (!products.length) throw new Error('Fant ingen varer i filen');
    const res = await importAll({ products }, { mode: 'merge' });
    toast(`Importerte ${res.products} varer${hoppet ? `, hoppet over ${hoppet} rader` : ''}`, 'ok');
    await reload();
    app.refreshAll();
  }

  const root = el('div.stack', {},
    el('div.card', {}, el('h2', {}, 'Status'), info),

    el('div.card.stack', {},
      el('h2', {}, 'Sikkerhetskopi'),
      el('p.small.muted', { style: 'margin:0' },
        'All data ligger lokalt på denne enheten. Ta sikkerhetskopi jevnlig, og bruk den for å flytte registeret til en annen telefon eller nettbrett.'),
      el('button.wide', {
        onclick: async () => {
          const data = await exportAll();
          download(`varelager_${stamp()}.json`, JSON.stringify(data, null, 2), 'application/json');
          toast('Sikkerhetskopi lastet ned', 'ok');
        },
      }, 'Last ned sikkerhetskopi (JSON)'),
      el('button.wide', {
        onclick: async () => {
          const products = await allProducts();
          if (!products.length) return toast('Registeret er tomt', 'warn');
          download(`varelager_${stamp()}.csv`, toCsv(products.map((p) => ({
            strekkode: p.barcode, vare: p.name, beskrivelse: p.description,
            kategori: p.category, enhet: p.unit, antall: p.qty, minimum: p.minQty,
            kolli: p.packSize, leverandor: p.supplier, plassering: p.location, pris: p.price ?? '',
          }))));
          toast('Varelager eksportert', 'ok');
        },
      }, 'Eksporter varelager (CSV)'),
      el('button.wide', { onclick: () => fileInput.click() }, 'Importer fil (JSON eller CSV)'),
      fileInput,
      el('p.small.muted', { style: 'margin:0' },
        'CSV-import leser kolonner som strekkode, vare, beskrivelse, enhet, antall, minimum, kolli, leverandør og pris.')
    ),

    el('div.card.stack', {},
      el('h2', {}, 'Slik bruker du appen'),
      el('ul.small.muted', { style: 'margin:0;padding-left:18px;line-height:1.7' },
        el('li', {}, 'Velg Inn ved varemottak, Ut når noe tas ut, og Telling ved varetelling.'),
        el('li', {}, 'Hurtigmodus registrerer +1 for hvert skann – skru den av når du vil taste antall.'),
        el('li', {}, 'Skanner du en ukjent strekkode, får du skjemaet for ny vare. Neste gang kjenner appen den igjen.'),
        el('li', {}, 'Sett minimumsbeholdning for å få varen automatisk på bestillingslisten.'),
        el('li', {}, 'Legg appen til på hjemskjermen for å bruke den offline.'))
    ),

    el('div.card.stack', {},
      el('h2', {}, 'Farlig sone'),
      el('button.danger.wide', {
        onclick: async () => {
          const ok = await confirmDialog('Slette alle data?',
            'Alle varer, beholdninger og bevegelser slettes fra denne enheten. Ta sikkerhetskopi først.',
            { okText: 'Slett alt', danger: true });
          if (!ok) return;
          await importAll({ products: [] }, { mode: 'replace' });
          toast('Alle data er slettet', 'ok');
          await reload();
          app.refreshAll();
        },
      }, 'Nullstill appen')
    )
  );

  reload();
  return { root, refresh: reload };
}
