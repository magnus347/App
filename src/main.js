/** Appskall: faner, ruting og oppstart. */
import './styles.css';
import { el, icon, replace, toast } from './ui.js';
import { allProducts } from './lib/db.js';
import { isLowStock } from './lib/domain.js';
import { scanView } from './views/scan.js';
import { inventoryView } from './views/inventory.js';
import { historyView } from './views/history.js';
import { orderView } from './views/order.js';
import { settingsView } from './views/settings.js';

const TABS = [
  { id: 'skann', label: 'Skann', title: 'Skann strekkode', view: scanView },
  { id: 'lager', label: 'Lager', title: 'Varelager', view: inventoryView },
  { id: 'historikk', label: 'Historikk', title: 'Bevegelser', view: historyView },
  { id: 'bestilling', label: 'Bestilling', title: 'Bestillingsliste', view: orderView },
  { id: 'innstillinger', label: 'Mer', title: 'Innstillinger', view: settingsView },
];

const app = {
  state: { mode: 'inn' },
  current: null,
  refreshBadges,
  refreshAll,
};

const title = el('h1', {}, 'Varelager');
const status = el('span.pill', {}, 'Lokalt lagret');
const content = el('main', { id: 'innhold' });
const tabbar = el('nav.tabbar', { 'aria-label': 'Hovedmeny' });

function tabId() {
  const id = location.hash.replace(/^#\/?/, '') || 'skann';
  return TABS.some((t) => t.id === id) ? id : 'skann';
}

function renderTabs() {
  const active = tabId();
  replace(tabbar, ...TABS.map((t) =>
    el('a', {
      href: `#/${t.id}`,
      class: t.id === active ? 'active' : '',
      'aria-current': t.id === active ? 'page' : null,
    }, icon(t.id === 'innstillinger' ? 'innstillinger' : t.id), el('span', {}, t.label),
    t.id === 'bestilling' ? el('span.badge.hidden', { id: 'badge-bestilling' }) : null)
  ));
}

function route() {
  const tab = TABS.find((t) => t.id === tabId());
  app.current?.destroy?.();
  title.textContent = tab.title;
  const view = tab.view(app);
  app.current = view;
  replace(content, view.root);
  renderTabs();
  refreshBadges();
  content.scrollTo?.({ top: 0 });
}

/** Viser antall varer som må bestilles på fanen. */
async function refreshBadges() {
  try {
    const low = (await allProducts()).filter(isLowStock).length;
    const badge = document.getElementById('badge-bestilling');
    if (!badge) return;
    badge.textContent = String(low);
    badge.classList.toggle('hidden', low === 0);
  } catch {
    /* databasen er ikke klar ennå */
  }
}

function refreshAll() {
  app.current?.refresh?.();
  refreshBadges();
}

function boot() {
  const root = document.getElementById('app');
  root.append(
    el('header.topbar', {}, title, el('span.spacer'), status),
    content,
    tabbar
  );

  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => status.textContent = 'Lokalt lagret');
  window.addEventListener('offline', () => status.textContent = 'Offline – alt fungerer');

  route();

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
        /* appen fungerer også uten offline-cache */
      });
    });
  }

  // Ber nettleseren om å ikke slette lagret data ved lite ledig plass.
  navigator.storage?.persist?.().catch(() => {});
}

window.addEventListener('error', (e) => {
  if (e?.message) toast(`Feil: ${e.message}`, 'err', 4000);
});
window.addEventListener('unhandledrejection', (e) => {
  const m = e?.reason?.message || e?.reason;
  if (m) toast(`Feil: ${m}`, 'err', 4000);
});

boot();
