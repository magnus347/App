/** Lageroversikt med søk, filter og hurtigjustering. */
import { el, toast, replace, num, kr, when, modal } from '../ui.js';
import { searchProducts, isLowStock, totalValue, CATEGORIES, MOVEMENT_TYPES } from '../lib/domain.js';
import { formatBarcode, makeInternalBarcode } from '../lib/barcode.js';
import { allProducts, registerMovement, movementsFor } from '../lib/db.js';
import { openProductForm } from './product-form.js';
import { newProduct } from '../lib/domain.js';

export function inventoryView(app) {
  let products = [];
  let query = '';
  let filter = 'alle';

  const listHost = el('div');
  const statHost = el('div');
  const search = el('input', {
    placeholder: 'Søk på navn, beskrivelse, strekkode …',
    enterkeyhint: 'search', autocomplete: 'off', type: 'search',
    oninput: (ev) => {
      query = ev.target.value;
      renderList();
    },
  });

  const filters = [
    { id: 'alle', label: 'Alle' },
    { id: 'lav', label: 'Må bestilles' },
    ...CATEGORIES.map((c) => ({ id: c.id, label: c.label })),
  ];

  const chips = el('div.chips', {}, ...filters.map((f) =>
    el('button', {
      'aria-pressed': String(f.id === filter),
      onclick: (ev) => {
        filter = f.id;
        chips.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
        ev.currentTarget.setAttribute('aria-pressed', 'true');
        renderList();
      },
    }, f.label)
  ));

  function visible() {
    let list = searchProducts(products, query, 500);
    if (filter === 'lav') list = list.filter(isLowStock);
    else if (filter !== 'alle') list = list.filter((p) => p.category === filter);
    return list;
  }

  function renderStats() {
    const low = products.filter(isLowStock).length;
    replace(statHost, el('div.stat-grid', {},
      el('div.stat', {}, el('div.v', {}, products.length), el('div.k', {}, 'varer')),
      el('div.stat', {}, el('div.v', { style: low ? 'color:var(--warn)' : '' }, low), el('div.k', {}, 'må bestilles')),
      el('div.stat', {}, el('div.v', {}, kr(totalValue(products))), el('div.k', {}, 'lagerverdi'))
    ));
  }

  function renderList() {
    const list = visible();
    if (!list.length) {
      replace(listHost, el('div.empty', {},
        el('div.big', {}, '📦'),
        el('div', {}, products.length ? 'Ingen varer passer søket' : 'Registeret er tomt'),
        el('div.small', {}, products.length ? 'Prøv et annet søkeord.' : 'Skann en strekkode for å legge inn den første varen.')));
      return;
    }
    replace(listHost, el('ul.list', {}, ...list.map(row)));
  }

  function row(p) {
    return el('li', { onclick: () => openDetails(p) },
      el('div.grow', {},
        el('div.title.truncate', {}, p.name),
        el('div.sub.truncate', {},
          [formatBarcode(p.barcode), p.supplier, p.location].filter(Boolean).join(' · '))
      ),
      isLowStock(p) && el('span.tag.low', {}, 'Bestill'),
      el('div.qty', {}, num(p.qty), el('span.unit', {}, p.unit))
    );
  }

  /** Detaljvisning med hurtigknapper og historikk for varen. */
  async function openDetails(p) {
    const history = await movementsFor(p.barcode, 15);
    await modal((close) => {
      const quick = async (type, qty) => {
        try {
          await registerMovement({ barcode: p.barcode, type, qty });
          toast(`${MOVEMENT_TYPES[type]} ${num(qty)} ${p.unit}`, 'ok');
          close('endret');
        } catch (err) {
          toast(err.message, 'err');
        }
      };
      return el('div.stack', {},
        el('h2', {}, p.name),
        el('div.row', {},
          el('div.grow.small.muted', {}, formatBarcode(p.barcode)),
          el('div.qty', {}, num(p.qty), el('span.unit', {}, p.unit))
        ),
        p.description && el('p.small.muted', { style: 'margin:0' }, p.description),
        el('div.small.muted', {},
          [p.supplier && `Leverandør: ${p.supplier}`,
            p.location && `Plassering: ${p.location}`,
            p.packSize > 1 && `${p.packSize} per kolli`,
            p.minQty > 0 && `Minimum: ${num(p.minQty)} ${p.unit}`,
            p.price != null && `Pris: ${kr(p.price)}`].filter(Boolean).join(' · ')),
        el('div.row', {},
          el('button.inn.grow', { onclick: () => quick('inn', 1) }, '+1 inn'),
          el('button.ut.grow', { onclick: () => quick('ut', 1) }, '−1 ut')
        ),
        el('button.wide.small', {
          onclick: async () => {
            const val = prompt(`Telt antall for «${p.name}» (${p.unit}):`, String(p.qty));
            if (val == null) return;
            const n = Number(val.replace(',', '.'));
            if (!Number.isFinite(n)) return toast('Ugyldig antall', 'err');
            await quick('telling', n);
          },
        }, 'Korriger beholdning'),
        history.length > 0 && el('div', {},
          el('div.small.muted', { style: 'margin:12px 0 4px' }, 'Siste bevegelser'),
          el('ul.list', {}, ...history.map((m) =>
            el('li', {},
              el('span.tag', { class: m.type + (m.undone ? ' undone' : '') }, MOVEMENT_TYPES[m.type]),
              el('div.grow.small', {}, when(m.ts)),
              el('div.qty.small', {}, num(m.after), el('span.unit', {}, p.unit)))))),
        el('div.row', {},
          el('button.ghost.grow', { onclick: () => close(null) }, 'Lukk'),
          el('button.primary.grow', {
            onclick: async () => {
              const upd = await openProductForm(p);
              if (upd) close('endret');
            },
          }, 'Rediger')
        )
      );
    });
    await reload();
  }

  async function reload() {
    products = await allProducts();
    renderStats();
    renderList();
    app.refreshBadges();
  }

  const root = el('div.stack', {},
    statHost,
    el('div.row', {},
      el('div.grow', {}, search),
      el('button.primary', {
        title: 'Ny vare uten strekkode',
        onclick: async () => {
          const saved = await openProductForm(
            newProduct(makeInternalBarcode()),
            { title: 'Ny vare uten strekkode' }
          );
          if (saved && !saved.deleted) await reload();
        },
      }, '+')
    ),
    chips,
    listHost
  );

  reload();
  return { root, refresh: reload };
}
