/** Små DOM-hjelpere. Appen bruker ingen rammeverk – bare vanlige elementer. */

/** Lager et element: el('div.card', { onclick }, 'tekst', barn...) */
export function el(spec, props = {}, ...children) {
  const [tag, ...classes] = String(spec).split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');

  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = `${node.className} ${v}`.trim();
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k in node && k !== 'list' && k !== 'form') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const c of children.flat(4)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Ikoner som inline SVG, slik at appen ikke trenger nettverk. */
export function icon(name) {
  const paths = {
    skann: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M11 8v8M15 8v8"/>',
    lager: '<path d="M3 9l9-6 9 6v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 21v-8h6v8"/>',
    historikk: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
    bestilling: '<path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 8H6"/><circle cx="10" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/>',
    innstillinger: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.5 15a1.7 1.7 0 0 0-1.5-1H2.8a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.4-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.4 1.7 1.7 0 0 0 1-1.5v-.2a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    lys: '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
    bytt: '<path d="M17 2l4 4-4 4"/><path d="M3 6h18"/><path d="M7 22l-4-4 4-4"/><path d="M21 18H3"/>',
    kryss: '<path d="M18 6 6 18M6 6l12 12"/>',
    sok: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
  };
  return el('span', {
    html: `<svg viewBox="0 0 24 24" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ''}</svg>`,
  });
}

/* ------------------------------------------------------------ meldinger */

let toastHost = null;

export function toast(message, kind = 'info', ms = 2600) {
  if (!toastHost) {
    toastHost = el('div.toast-host', { role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const node = el(`div.toast.${kind}`, {}, message);
  toastHost.append(node);
  setTimeout(() => node.remove(), ms);
  return node;
}

/** Ja/nei-dialog. Returnerer true når brukeren bekrefter. */
export function confirmDialog(title, body, { okText = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    const dlg = el('dialog');
    let answer = false;
    dlg.append(
      el('div.dlg-body.stack', {},
        el('h2', {}, title),
        typeof body === 'string' ? el('p.muted.small', {}, body) : body,
        el('div.row', {},
          el('button.ghost.grow', { onclick: () => dlg.close() }, 'Avbryt'),
          el(`button.grow.${danger ? 'danger' : 'primary'}`, {
            onclick: () => {
              answer = true;
              dlg.close();
            },
          }, okText)
        )
      )
    );
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(answer);
    });
    document.body.append(dlg);
    dlg.showModal();
  });
}

/** Modal med vilkårlig innhold. `build(close)` returnerer innholdet. */
export function modal(build) {
  const dlg = el('dialog');
  const close = (value) => {
    dlg.returnValue = value == null ? '' : String(value);
    dlg._value = value;
    dlg.close();
  };
  dlg.append(el('div.dlg-body.stack', {}, build(close)));
  document.body.append(dlg);
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(dlg._value);
    });
  });
}

/* -------------------------------------------------------------- format */

const nf = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 3 });
const cf = new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 2 });

export function num(n) {
  return nf.format(Number(n) || 0);
}

export function kr(n) {
  return cf.format(Number(n) || 0);
}

export function signed(n) {
  const v = Number(n) || 0;
  return `${v > 0 ? '+' : ''}${num(v)}`;
}

/** Kort, lesbar tid: «nå», «12 min siden», «i går 08:15», «3. mars 14:02». */
export function when(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const diff = Date.now() - ts;
  const time = d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
  if (diff < 60_000) return 'nå';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min siden`;

  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return `i dag ${time}`;
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === yesterday.toDateString()) return `i går ${time}`;
  return `${d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })} ${time}`;
}

/** Tømmer et element og setter nytt innhold. */
export function replace(host, ...children) {
  host.replaceChildren();
  append(host, children);
  return host;
}
