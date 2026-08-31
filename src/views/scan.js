/**
 * Skanneskjermen: kameraet leser strekkoden, og treffet blir enten
 * registrert som en bevegelse eller sendt videre til skjemaet for ny vare.
 */
import { el, icon, toast, replace, num, when } from '../ui.js';
import { BarcodeScanner, hasCameraSupport, buzz, beep } from '../lib/scanner.js';
import { normalizeBarcode, isStorableBarcode, formatBarcode } from '../lib/barcode.js';
import { getProduct, registerMovement, undoMovement, getSetting, setSetting } from '../lib/db.js';
import { newProduct, MOVEMENT_TYPES } from '../lib/domain.js';
import { openProductForm } from './product-form.js';
import { suggestFromCatalog } from '../lib/catalog.js';
import { planleggSynk } from '../lib/sky.js';

const MODES = [
  { id: 'inn', label: 'Inn', sub: 'Varemottak' },
  { id: 'ut', label: 'Ut', sub: 'Uttak/svinn' },
  { id: 'telling', label: 'Telling', sub: 'Sett beholdning' },
];

export function scanView(app) {
  let mode = app.state.mode || 'inn';
  let quick = true;
  let sound = true;
  let scanner = null;
  let busy = false;

  const video = el('video', { muted: true, playsinline: true, autoplay: true });
  const camOverlay = el('div.cam-overlay');
  const camera = el('div.camera', {}, video, el('div.reticle.hidden'), camOverlay);
  const resultHost = el('div');
  const modeRow = el('div.modes');
  const manualInput = el('input', {
    placeholder: 'Tast strekkode manuelt', inputmode: 'numeric',
    enterkeyhint: 'search', autocomplete: 'off',
  });

  /* ------------------------------------------------------------ modus */

  function renderModes() {
    replace(modeRow, ...MODES.map((m) =>
      el(`button.m-${m.id}`, {
        'aria-pressed': String(m.id === mode),
        onclick: () => {
          mode = m.id;
          app.state.mode = m.id;
          renderModes();
        },
      }, el('span', {}, m.label), el('span.sub', {}, m.sub))
    ));
  }

  /* ----------------------------------------------------------- kamera */

  function showOverlay(...content) {
    camera.querySelector('.reticle').classList.add('hidden');
    replace(camOverlay, ...content);
    camOverlay.classList.remove('hidden');
  }

  function hideOverlay() {
    camOverlay.classList.add('hidden');
    camera.querySelector('.reticle').classList.remove('hidden');
  }

  async function startCamera() {
    if (!hasCameraSupport()) {
      showOverlay(
        el('div', {}, 'Denne nettleseren gir ikke tilgang til kamera.'),
        el('div.small', {}, 'Bruk feltet under til å taste strekkoden.')
      );
      return;
    }
    if (!globalThis.isSecureContext) {
      showOverlay(
        el('div', {}, 'Kamera krever HTTPS.'),
        el('div.small', {}, 'Åpne appen via https:// eller localhost.')
      );
      return;
    }
    showOverlay(el('div', {}, 'Starter kamera …'));
    scanner = new BarcodeScanner(video);
    try {
      await scanner.start(onScan, { onError: (e) => console.warn('skannefeil', e) });
      hideOverlay();
      renderCamTools();
    } catch (err) {
      const melding = err?.name === 'NotAllowedError'
        ? 'Du må gi appen tilgang til kameraet.'
        : err?.name === 'NotFoundError'
          ? 'Fant ikke noe kamera på enheten.'
          : `Kunne ikke starte kamera: ${err.message}`;
      showOverlay(
        el('div', {}, melding),
        el('button.small', { onclick: startCamera }, 'Prøv igjen'),
        el('div.small', {}, 'Du kan taste strekkoden manuelt under.')
      );
    }
  }

  async function renderCamTools() {
    const tools = el('div.cam-tools');
    const cams = await scanner.listCameras().catch(() => []);
    if (cams.length > 1) {
      let i = cams.findIndex((c) => c.deviceId === scanner.deviceId);
      tools.append(el('button.small', {
        title: 'Bytt kamera',
        onclick: async () => {
          i = (i + 1) % cams.length;
          await scanner.stop();
          await scanner.start(onScan, { deviceId: cams[i].deviceId });
        },
      }, icon('bytt')));
    }
    tools.append(el('button.small', {
      title: 'Lommelykt',
      onclick: async (ev) => {
        const on = ev.currentTarget.getAttribute('aria-pressed') !== 'true';
        const ok = await scanner.toggleTorch(on).catch(() => false);
        if (!ok) return toast('Enheten støtter ikke lommelykt', 'warn');
        ev.currentTarget.setAttribute('aria-pressed', String(on));
      },
    }, icon('lys')));
    camera.querySelectorAll('.cam-tools').forEach((n) => n.remove());
    camera.append(tools);
  }

  /* ------------------------------------------------------- skannetreff */

  async function onScan(raw) {
    if (busy) return;
    const code = normalizeBarcode(raw);
    if (!isStorableBarcode(code)) {
      toast(`Ugyldig strekkode: ${raw}`, 'err');
      return;
    }
    busy = true;
    camera.classList.add('flash');
    setTimeout(() => camera.classList.remove('flash'), 300);
    if (sound) beep(true);
    buzz(60);

    try {
      const product = await getProduct(code);
      if (!product) {
        await handleUnknown(code);
      } else if (quick && mode !== 'telling') {
        await commit(product, 1, false);
      } else {
        showQtyCard(product);
      }
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      busy = false;
    }
  }

  /** Ukjent strekkode: la brukeren beskrive varen én gang. */
  async function handleUnknown(code) {
    if (sound) beep(false);
    // Er koden kjent i oppslagsregisteret, fylles navnet inn på forhånd.
    const forslag = await suggestFromCatalog(code).catch(() => null);
    const saved = await openProductForm(
      newProduct(code, forslag || {}),
      {
        title: forslag ? 'Ny vare – funnet i varedatabasen' : 'Ukjent strekkode – ny vare',
        suggested: Boolean(forslag),
      }
    );
    if (!saved || saved.deleted) {
      renderResult(el('div.card', {},
        el('div.row', {}, el('div.grow', {},
          el('div', { style: 'font-weight:600' }, 'Ikke registrert'),
          el('div.small.muted', {}, formatBarcode(code))))));
      return;
    }
    showQtyCard(saved, { fresh: true });
  }

  /* ------------------------------------------------ antall og bokføring */

  function showQtyCard(product, { fresh = false } = {}) {
    const qtyInput = el('input', {
      type: 'number', step: 'any', inputmode: 'decimal',
      value: mode === 'telling' ? String(product.qty ?? 0) : '1',
    });
    const packToggle = el('button.small', {
      'aria-pressed': 'false',
      onclick: (ev) => {
        const on = ev.currentTarget.getAttribute('aria-pressed') !== 'true';
        ev.currentTarget.setAttribute('aria-pressed', String(on));
        ev.currentTarget.textContent = on ? `Kolli à ${product.packSize}` : 'Enkeltenheter';
      },
    }, 'Enkeltenheter');

    const step = (d) => () => {
      qtyInput.value = String(Math.max(0, (Number(qtyInput.value) || 0) + d));
    };

    const doCommit = () =>
      commit(product, Number(qtyInput.value), packToggle.getAttribute('aria-pressed') === 'true');

    renderResult(el('div.card.stack', {},
      el('div.row', {},
        el('div.grow', {},
          el('div', { style: 'font-weight:650' }, product.name),
          el('div.small.muted', {}, `${formatBarcode(product.barcode)}${product.location ? ` · ${product.location}` : ''}`)
        ),
        el('div.qty', {}, num(product.qty), el('span.unit', {}, product.unit))
      ),
      fresh && el('div.small', { style: 'color:var(--inn)' }, 'Varen er lagret og gjenkjennes neste gang.'),
      el('div.stepper', {},
        el('button', { onclick: step(-1), 'aria-label': 'Minus én' }, '−'),
        qtyInput,
        el('button', { onclick: step(1), 'aria-label': 'Pluss én' }, '+')
      ),
      product.packSize > 1 && el('div.row', {}, packToggle),
      el('button.wide', {
        class: mode, onclick: doCommit,
      }, mode === 'telling'
        ? `Sett beholdning til ${num(qtyInput.value)}`
        : `Registrer ${MODES.find((m) => m.id === mode).label.toLowerCase()}`),
      el('button.ghost.wide.small', {
        onclick: async () => {
          const upd = await openProductForm(product);
          if (upd && !upd.deleted) showQtyCard(upd);
        },
      }, 'Rediger varekort')
    ));

    if (mode === 'telling') setTimeout(() => qtyInput.select?.(), 60);
  }

  async function commit(product, qty, asPack) {
    if (!Number.isFinite(qty)) return toast('Ugyldig antall', 'err');
    try {
      const { product: updated, movement } = await registerMovement({
        barcode: product.barcode, type: mode, qty, asPack,
      });
      renderResult(receipt(updated, movement));
      app.refreshBadges();
      planleggSynk();
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  function receipt(product, movement) {
    return el('div.card.stack', {},
      el('div.row', {},
        el('div.grow', {},
          el('div', { style: 'font-weight:650' }, product.name),
          el('div.small.muted', {},
            `${MOVEMENT_TYPES[movement.type]} ${num(movement.qty)} ${product.unit} · ${when(movement.ts)}`)
        ),
        el('div.qty', { style: `color:var(--${movement.type === 'ut' ? 'ut' : 'inn'})` },
          num(product.qty), el('span.unit', {}, product.unit))
      ),
      product.minQty > 0 && product.qty <= product.minQty &&
        el('div.small', { style: 'color:var(--warn)' },
          `Under minimum (${num(product.minQty)} ${product.unit}) – bør bestilles.`),
      el('div.row', {},
        el('button.small.grow', {
          onclick: () => showQtyCard(product),
        }, 'Registrer mer'),
        el('button.small.ghost.grow', {
          onclick: async () => {
            try {
              await undoMovement(movement.id);
              toast('Registreringen er angret', 'ok');
              const fresh = await getProduct(product.barcode);
              renderResult(el('div.card', {}, el('div.row', {},
                el('div.grow', {}, el('div', { style: 'font-weight:600' }, fresh.name),
                  el('div.small.muted', {}, 'Angret')),
                el('div.qty', {}, num(fresh.qty), el('span.unit', {}, fresh.unit)))));
              app.refreshBadges();
            } catch (err) {
              toast(err.message, 'err');
            }
          },
        }, 'Angre')
      )
    );
  }

  function renderResult(node) {
    replace(resultHost, node);
  }

  /* ------------------------------------------------------------- skjerm */

  const quickToggle = el('button.small', {
    'aria-pressed': 'true',
    onclick: (ev) => {
      quick = !quick;
      ev.currentTarget.setAttribute('aria-pressed', String(quick));
      ev.currentTarget.textContent = quick ? 'Hurtig: +1 per skann' : 'Spør om antall';
      setSetting('hurtig', quick);
    },
  }, 'Hurtig: +1 per skann');

  const soundToggle = el('button.small', {
    'aria-pressed': 'true',
    onclick: (ev) => {
      sound = !sound;
      ev.currentTarget.setAttribute('aria-pressed', String(sound));
      ev.currentTarget.textContent = sound ? 'Lyd på' : 'Lyd av';
      setSetting('lyd', sound);
    },
  }, 'Lyd på');

  const root = el('div.stack', {},
    modeRow,
    camera,
    el('form.row', {
      style: 'margin-top:12px',
      onsubmit: (ev) => {
        ev.preventDefault();
        const v = manualInput.value.trim();
        if (!v) return;
        manualInput.value = '';
        onScan(v);
      },
    }, el('div.grow', {}, manualInput), el('button.primary', { type: 'submit' }, icon('sok'))),
    el('div.chips', {}, quickToggle, soundToggle),
    resultHost
  );

  renderModes();
  renderResult(el('div.empty', {},
    el('div.big', {}, '🔎'),
    el('div', {}, 'Rett kameraet mot strekkoden'),
    el('div.small', {}, 'Ukjente varer kan registreres på stedet.')));

  (async () => {
    quick = await getSetting('hurtig', true);
    sound = await getSetting('lyd', true);
    quickToggle.setAttribute('aria-pressed', String(quick));
    quickToggle.textContent = quick ? 'Hurtig: +1 per skann' : 'Spør om antall';
    soundToggle.setAttribute('aria-pressed', String(sound));
    soundToggle.textContent = sound ? 'Lyd på' : 'Lyd av';
    await startCamera();
  })();

  return {
    root,
    destroy: () => scanner?.stop(),
  };
}
