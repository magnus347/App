/**
 * Bestillingsliste: varer på eller under minimumsbeholdning, gruppert
 * etter leverandør slik at listen kan sendes rett til Norengros eller
 * matvarekjeden.
 */
import { el, toast, replace, num, kr } from '../ui.js';
import { isLowStock, suggestedOrderQty } from '../lib/domain.js';
import { allProducts } from '../lib/db.js';
import { toCsv, download, stamp } from '../lib/csv.js';

export function orderView(app) {
  let lines = [];
  const host = el('div');

  async function reload() {
    const products = await allProducts();
    lines = products.filter(isLowStock).map((p) => {
      const s = suggestedOrderQty(p);
      return { p, ...s, checked: true };
    });
    render();
    app.refreshBadges();
  }

  function grouped() {
    const map = new Map();
    for (const line of lines) {
      const key = line.p.supplier || 'Uten leverandør';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(line);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'nb'));
  }

  function selected() {
    return lines.filter((l) => l.checked);
  }

  function asRows() {
    return selected().map((l) => ({
      leverandor: l.p.supplier || '',
      strekkode: l.p.barcode,
      vare: l.p.name,
      beskrivelse: l.p.description || '',
      pa_lager: l.p.qty,
      minimum: l.p.minQty,
      bestill_antall: l.units,
      bestill_kolli: l.packs,
      enhet: l.p.unit,
      plassering: l.p.location || '',
    }));
  }

  function asText() {
    const out = [`Bestillingsliste ${new Date().toLocaleDateString('nb-NO')}`];
    for (const [supplier, group] of grouped()) {
      const picked = group.filter((l) => l.checked);
      if (!picked.length) continue;
      out.push('', supplier + ':');
      for (const l of picked) {
        const kolli = l.p.packSize > 1 ? ` (${l.packs} kolli à ${l.p.packSize})` : '';
        out.push(`- ${l.p.name}: ${num(l.units)} ${l.p.unit}${kolli}`);
      }
    }
    return out.join('\n');
  }

  function render() {
    if (!lines.length) {
      replace(host, el('div.empty', {},
        el('div.big', {}, '✅'),
        el('div', {}, 'Ingenting å bestille'),
        el('div.small', {}, 'Sett minimumsbeholdning på varene for å få varsel her.')));
      return;
    }

    const total = selected().reduce((s, l) => s + (Number(l.p.price) || 0) * l.units, 0);

    replace(host,
      el('div.card', {},
        el('div.row', {},
          el('div.grow', {},
            el('div', { style: 'font-weight:650' }, `${selected().length} av ${lines.length} varer valgt`),
            el('div.small.muted', {}, total > 0 ? `Estimert verdi: ${kr(total)}` : 'Sett innkjøpspris for å se estimert verdi')
          )
        )
      ),
      ...grouped().map(([supplier, group]) =>
        el('div.card', {},
          el('h2', {}, supplier),
          el('ul.list', {}, ...group.map((line) => {
            const box = el('input', {
              type: 'checkbox', checked: line.checked, style: 'width:22px;min-height:22px',
              onchange: (ev) => {
                line.checked = ev.target.checked;
                render();
              },
            });
            return el('li', {},
              box,
              el('div.grow', {},
                el('div.title.truncate', {}, line.p.name),
                el('div.sub', {}, `På lager ${num(line.p.qty)} · minimum ${num(line.p.minQty)} ${line.p.unit}`)
              ),
              el('div.qty', {}, num(line.units),
                el('span.unit', {}, line.p.packSize > 1 ? `${line.p.unit} (${line.packs} kolli)` : line.p.unit))
            );
          }))
        )
      ),
      el('div.row', {},
        el('button.grow', {
          onclick: async () => {
            const text = asText();
            try {
              if (navigator.share) await navigator.share({ title: 'Bestillingsliste', text });
              else {
                await navigator.clipboard.writeText(text);
                toast('Listen er kopiert', 'ok');
              }
            } catch (err) {
              if (err?.name !== 'AbortError') toast('Kunne ikke dele listen', 'err');
            }
          },
        }, 'Del liste'),
        el('button.primary.grow', {
          onclick: () => {
            if (!selected().length) return toast('Ingen varer valgt', 'warn');
            download(`bestilling_${stamp()}.csv`, toCsv(asRows()));
            toast('Bestillingsliste lastet ned', 'ok');
          },
        }, 'Last ned CSV')
      )
    );
  }

  const root = el('div.stack', {}, host);
  reload();
  return { root, refresh: reload };
}
