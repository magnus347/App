/**
 * Skjema for å opprette eller rette et varekort.
 *
 * Skjemaet er kjernen i gjenkjenningen: når en ukjent strekkode skannes,
 * skriver brukeren inn beskrivelsen én gang, og varen kjennes igjen for
 * alltid etterpå.
 */
import { el, modal, toast, icon, confirmDialog } from '../ui.js';
import { CATEGORIES, UNITS, SUPPLIERS } from '../lib/domain.js';
import { formatBarcode, originHint } from '../lib/barcode.js';
import { saveProduct, deleteProduct, allProducts } from '../lib/db.js';

/**
 * Åpner skjemaet. `product` kan være et eksisterende varekort eller
 * `{ barcode }` for en helt ny vare. Returnerer den lagrede varen,
 * `{ deleted: true }` ved sletting, eller null hvis brukeren avbrøt.
 */
export async function openProductForm(product, { title } = {}) {
  const isNew = !product.createdAt;
  const known = await allProducts();
  // Foreslå leverandører og hylleplasser brukeren allerede har brukt.
  const suppliers = [...new Set([...SUPPLIERS, ...known.map((p) => p.supplier)])].filter(Boolean);
  const locations = [...new Set(known.map((p) => p.location))].filter(Boolean);
  const hint = originHint(product.barcode);

  return modal((close) => {
    const f = {};
    const field = (label, input, help) =>
      el('div.field', {}, el('label', { for: input.id }, label), input, help && el('div.small.muted', { style: 'margin-top:4px' }, help));

    f.name = el('input', {
      id: 'f-name', value: product.name || '', required: true,
      placeholder: 'F.eks. Lettmelk 1L Tine', autocomplete: 'off', enterkeyhint: 'next',
    });
    f.description = el('textarea', {
      id: 'f-desc', value: product.description || '',
      placeholder: 'Beskrivelse appen husker: variant, størrelse, hvor den brukes …',
    });
    f.category = el('select', { id: 'f-cat' },
      ...CATEGORIES.map((c) => el('option', { value: c.id, selected: (product.category || 'mat') === c.id }, c.label)));
    f.unit = el('input', {
      id: 'f-unit', value: product.unit || 'stk', list: 'dl-units', placeholder: 'stk', autocomplete: 'off',
    });
    f.packSize = el('input', {
      id: 'f-pack', type: 'number', min: '1', step: '1', inputmode: 'numeric',
      value: product.packSize ?? 1,
    });
    f.supplier = el('input', {
      id: 'f-sup', value: product.supplier || '', list: 'dl-suppliers',
      placeholder: 'Norengros, Asko, Kiwi …', autocomplete: 'off',
    });
    f.minQty = el('input', {
      id: 'f-min', type: 'number', min: '0', step: 'any', inputmode: 'decimal',
      value: product.minQty ?? 0,
    });
    f.location = el('input', {
      id: 'f-loc', value: product.location || '', list: 'dl-locations',
      placeholder: 'Kjølerom, hylle B3 …', autocomplete: 'off',
    });
    f.price = el('input', {
      id: 'f-price', type: 'number', min: '0', step: '0.01', inputmode: 'decimal',
      value: product.price ?? '', placeholder: 'valgfri',
    });

    const save = async (ev) => {
      ev?.preventDefault();
      if (!f.name.value.trim()) {
        f.name.focus();
        toast('Varen trenger et navn', 'err');
        return;
      }
      try {
        const saved = await saveProduct({
          ...product,
          name: f.name.value.trim(),
          description: f.description.value.trim(),
          category: f.category.value,
          unit: f.unit.value.trim() || 'stk',
          packSize: Number(f.packSize.value) || 1,
          supplier: f.supplier.value.trim(),
          minQty: Number(f.minQty.value) || 0,
          location: f.location.value.trim(),
          price: f.price.value === '' ? null : Number(f.price.value),
        });
        toast(isNew ? `«${saved.name}» er lagt i registeret` : 'Varen er oppdatert', 'ok');
        close(saved);
      } catch (err) {
        toast(`Kunne ikke lagre: ${err.message}`, 'err');
      }
    };

    const form = el('form.stack', { onsubmit: save, novalidate: true },
      el('h2', {}, title || (isNew ? 'Ny vare' : 'Rediger vare')),
      el('div.card', { style: 'margin:0;background:var(--surface-2)' },
        el('div.row', {},
          icon('skann'),
          el('div.grow', {},
            el('div', { style: 'font-weight:600' }, formatBarcode(product.barcode)),
            el('div.small.muted', {}, isNew ? 'Ny strekkode – fyll ut så husker appen den' : 'Registrert strekkode')
          ),
          hint && el('span.tag', {}, hint)
        )
      ),
      field('Varenavn *', f.name),
      field('Beskrivelse', f.description, 'Brukes også når du søker etter varen senere.'),
      el('div.fields-2', {}, field('Kategori', f.category), field('Enhet', f.unit)),
      el('div.fields-2', {},
        field('Antall per kolli', f.packSize, 'Gjør at du kan registrere hele kolli.'),
        field('Minimumsbeholdning', f.minQty, 'Varsler når det er tid for å bestille.')),
      el('div.fields-2', {}, field('Leverandør', f.supplier), field('Plassering', f.location)),
      field('Innkjøpspris per enhet', f.price),

      el('datalist', { id: 'dl-units' }, ...UNITS.map((u) => el('option', { value: u }))),
      el('datalist', { id: 'dl-suppliers' }, ...suppliers.map((s) => el('option', { value: s }))),
      el('datalist', { id: 'dl-locations' }, ...locations.map((s) => el('option', { value: s }))),

      el('div.row', {},
        el('button.ghost.grow', { type: 'button', onclick: () => close(null) }, 'Avbryt'),
        el('button.primary.grow', { type: 'submit' }, isNew ? 'Lagre vare' : 'Lagre')
      ),
      !isNew && el('button.danger.wide', {
        type: 'button',
        onclick: async () => {
          const ok = await confirmDialog(
            'Slette varen?',
            `«${product.name}» og all historikk for varen fjernes. Dette kan ikke angres.`,
            { okText: 'Slett', danger: true }
          );
          if (!ok) return;
          await deleteProduct(product.barcode);
          toast('Varen er slettet', 'ok');
          close({ deleted: true });
        },
      }, 'Slett vare')
    );

    setTimeout(() => f.name.focus(), 50);
    return form;
  });
}
