/** Full bevegelseslogg med mulighet for å angre. */
import { el, toast, replace, num, signed, when, confirmDialog } from '../ui.js';
import { MOVEMENT_TYPES } from '../lib/domain.js';
import { recentMovements, undoMovement } from '../lib/db.js';
import { toCsv, download, stamp } from '../lib/csv.js';

export function historyView(app) {
  let movements = [];
  const listHost = el('div');

  async function reload() {
    movements = await recentMovements(300);
    render();
    app.refreshBadges();
  }

  function render() {
    if (!movements.length) {
      replace(listHost, el('div.empty', {},
        el('div.big', {}, '🕘'),
        el('div', {}, 'Ingen registreringer ennå'),
        el('div.small', {}, 'Alt du skanner inn eller ut havner her.')));
      return;
    }
    replace(listHost, el('ul.list', {}, ...movements.map((m) =>
      el('li', {},
        el('span.tag', { class: m.type + (m.undone ? ' undone' : '') }, MOVEMENT_TYPES[m.type]),
        el('div.grow', {},
          el('div.title.truncate', {}, m.name || m.barcode),
          el('div.sub', {}, `${when(m.ts)} · ${num(m.before)} → ${num(m.after)}${m.undone ? ' · angret' : ''}`)
        ),
        el('div.qty', { style: `color:var(--${m.delta < 0 ? 'ut' : 'inn'})` }, signed(m.delta)),
        !m.undone && el('button.small.ghost', {
          onclick: async (ev) => {
            ev.stopPropagation();
            const ok = await confirmDialog('Angre registreringen?',
              `${MOVEMENT_TYPES[m.type]} ${num(m.qty)} på «${m.name}» tilbakeføres.`, { okText: 'Angre' });
            if (!ok) return;
            try {
              await undoMovement(m.id);
              toast('Registreringen er angret', 'ok');
              await reload();
            } catch (err) {
              toast(err.message, 'err');
            }
          },
        }, 'Angre')
      ))));
  }

  const root = el('div.stack', {},
    el('div.row', {},
      el('h2.grow', { style: 'margin:0;font-size:1rem' }, 'Bevegelser'),
      el('button.small', {
        onclick: () => {
          if (!movements.length) return toast('Ingen bevegelser å eksportere', 'warn');
          const rows = movements.map((m) => ({
            tidspunkt: new Date(m.ts).toLocaleString('nb-NO'),
            type: MOVEMENT_TYPES[m.type],
            strekkode: m.barcode,
            vare: m.name,
            antall: m.qty,
            endring: m.delta,
            fra: m.before,
            til: m.after,
            angret: m.undone ? 'ja' : '',
            notat: m.note || '',
          }));
          download(`bevegelser_${stamp()}.csv`, toCsv(rows));
          toast('Eksportert som CSV', 'ok');
        },
      }, 'Eksporter')
    ),
    listHost
  );

  reload();
  return { root, refresh: reload };
}
