/**
 * Skylagring via Supabase: innlogging, valg av lager og synkronisering.
 *
 * Appen er fortsatt offline-first. Alt skrives lokalt først, og skyen er en
 * kopi som hentes og sendes når det er dekning. Mister du nettet i kjølerommet
 * fortsetter registreringen som før, og synkroniseres når du kommer ut.
 */
import {
  usyncedeVarer, usyncedeBevegelser, anvendFraSky, markerVarerSendt,
  getSetting, setSetting,
} from './db.js';

let klientLøfte = null;
let klientNøkkel = '';

/** Leser oppsettet: bygget inn, eller lagt inn av brukeren i appen. */
export async function hentKonfig() {
  const bygget = {
    url: import.meta.env?.VITE_SUPABASE_URL || '',
    nokkel: import.meta.env?.VITE_SUPABASE_ANON_KEY || '',
  };
  if (bygget.url && bygget.nokkel) return bygget;
  return (await getSetting('sky', null)) || { url: '', nokkel: '' };
}

export async function lagreKonfig({ url, nokkel }) {
  klientLøfte = null;
  return setSetting('sky', { url: String(url || '').trim(), nokkel: String(nokkel || '').trim() });
}

export async function erKonfigurert() {
  const k = await hentKonfig();
  return Boolean(k.url && k.nokkel);
}

/** Supabase-klienten lastes først når den trengs, så appen starter raskt. */
export async function klient() {
  const k = await hentKonfig();
  if (!k.url || !k.nokkel) throw new Error('Skylagring er ikke satt opp ennå');
  const nøkkel = `${k.url}|${k.nokkel}`;
  if (!klientLøfte || klientNøkkel !== nøkkel) {
    klientNøkkel = nøkkel;
    klientLøfte = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(k.url, k.nokkel, {
        auth: { persistSession: true, autoRefreshToken: true },
      })
    );
  }
  return klientLøfte;
}

/* ------------------------------------------------------------ innlogging */

export async function registrer(epost, passord) {
  const c = await klient();
  const { data, error } = await c.auth.signUp({ email: epost, password: passord });
  if (error) throw new Error(oversettFeil(error));
  return data.user;
}

export async function loggInn(epost, passord) {
  const c = await klient();
  const { data, error } = await c.auth.signInWithPassword({ email: epost, password: passord });
  if (error) throw new Error(oversettFeil(error));
  return data.user;
}

/** Innlogging for vikarer som bare har fått en lagerkode. */
export async function loggInnAnonymt() {
  const c = await klient();
  const { data, error } = await c.auth.signInAnonymously();
  if (error) throw new Error(oversettFeil(error));
  return data.user;
}

export async function loggUt() {
  const c = await klient();
  await c.auth.signOut();
  await setSetting('lagerId', null);
}

export async function gjeldendeBruker() {
  if (!(await erKonfigurert())) return null;
  const c = await klient();
  const { data } = await c.auth.getUser();
  return data?.user || null;
}

/* ----------------------------------------------------------------- lager */

export async function mineLagre() {
  const c = await klient();
  const { data, error } = await c
    .from('medlemskap')
    .select('rolle, lager (id, navn, delt_kode)');
  if (error) throw new Error(oversettFeil(error));
  return (data || []).map((r) => ({ ...r.lager, rolle: r.rolle }));
}

export async function opprettLager(navn) {
  const c = await klient();
  const { data, error } = await c.rpc('opprett_lager', { p_navn: navn });
  if (error) throw new Error(oversettFeil(error));
  await setSetting('lagerId', data);
  return data;
}

export async function bliMedMedKode(kode, navn = null) {
  const c = await klient();
  const { data, error } = await c.rpc('bli_med_med_kode', { p_kode: kode, p_navn: navn });
  if (error) throw new Error(oversettFeil(error));
  await setSetting('lagerId', data);
  return data;
}

export async function settDeltKode(lagerId, kode) {
  const c = await klient();
  const { error } = await c.from('lager').update({ delt_kode: kode }).eq('id', lagerId);
  if (error) throw new Error(oversettFeil(error));
  return kode;
}

export async function valgtLager() {
  return getSetting('lagerId', null);
}

export async function velgLager(id) {
  return setSetting('lagerId', id);
}

/* --------------------------------------------------------- synkronisering */

const tilRad = (p, lagerId) => ({
  lager_id: lagerId,
  strekkode: p.barcode,
  navn: p.name || p.barcode,
  beskrivelse: p.description || '',
  kategori: p.category || 'mat',
  enhet: p.unit || 'stk',
  kolli: Number(p.packSize) || 1,
  min_antall: Number(p.minQty) || 0,
  leverandor: p.supplier || '',
  plassering: p.location || '',
  pris: p.price ?? null,
  updated_at: new Date(p.updatedAt || Date.now()).toISOString(),
  deleted_at: p.deletedAt ? new Date(p.deletedAt).toISOString() : null,
});

const fraRad = (r) => ({
  barcode: r.strekkode,
  name: r.navn,
  description: r.beskrivelse || '',
  category: r.kategori || 'mat',
  unit: r.enhet || 'stk',
  packSize: Number(r.kolli) || 1,
  minQty: Number(r.min_antall) || 0,
  supplier: r.leverandor || '',
  location: r.plassering || '',
  price: r.pris,
  updatedAt: new Date(r.updated_at).getTime(),
  deletedAt: r.deleted_at ? new Date(r.deleted_at).getTime() : undefined,
});

const bevegelseTilRad = (m, lagerId, brukerId) => ({
  id: m.uid,
  lager_id: lagerId,
  strekkode: m.barcode,
  type: m.type,
  antall: m.qty,
  notat: m.note || '',
  ts: m.ts,
  undone: Boolean(m.undone),
  utfort_av: brukerId,
});

const bevegelseFraRad = (r) => ({
  uid: r.id,
  barcode: r.strekkode,
  type: r.type,
  qty: Number(r.antall),
  note: r.notat || '',
  ts: Number(r.ts),
  undone: Boolean(r.undone),
  name: '',
  delta: 0,
  before: 0,
  after: 0,
});

/**
 * Sender lokale endringer og henter det andre enheter har gjort.
 * `onStatus(tekst)` melder framdrift underveis.
 */
export async function synkroniser({ onStatus } = {}) {
  const lagerId = await valgtLager();
  if (!lagerId) throw new Error('Velg et lager før du synkroniserer');
  const c = await klient();
  const { data: brukerData } = await c.auth.getUser();
  const bruker = brukerData?.user;
  if (!bruker) throw new Error('Du må være innlogget');

  // 1. Send det vi har gjort lokalt.
  onStatus?.('Sender endringer …');
  const lokaleVarer = await usyncedeVarer();
  if (lokaleVarer.length) {
    const { error } = await c.from('varer')
      .upsert(lokaleVarer.map((p) => tilRad(p, lagerId)), { onConflict: 'lager_id,strekkode' });
    if (error) throw new Error(oversettFeil(error));
  }

  const lokaleBevegelser = await usyncedeBevegelser();
  const nyeUids = lokaleBevegelser.map((m) => m.uid).filter(Boolean);
  if (lokaleBevegelser.length) {
    const rader = lokaleBevegelser.filter((m) => m.uid).map((m) => bevegelseTilRad(m, lagerId, bruker.id));
    // Samme uid to ganger er ufarlig: raden finnes allerede, og angring
    // oppdateres i stedet for å legges til på nytt.
    const { error } = await c.from('bevegelser').upsert(rader, { onConflict: 'id' });
    if (error) throw new Error(oversettFeil(error));
  }

  // 2. Hent alt som finnes i skyen for dette lageret.
  onStatus?.('Henter fra skyen …');
  const { data: varerRader, error: vFeil } = await c.from('varer').select('*').eq('lager_id', lagerId);
  if (vFeil) throw new Error(oversettFeil(vFeil));
  const { data: bevRader, error: bFeil } = await c.from('bevegelser').select('*').eq('lager_id', lagerId);
  if (bFeil) throw new Error(oversettFeil(bFeil));

  // 3. Flett inn og regn beholdningen på nytt fra loggen.
  onStatus?.('Fletter …');
  await anvendFraSky({
    varer: (varerRader || []).map(fraRad),
    bevegelser: (bevRader || []).map(bevegelseFraRad),
    nyeUids,
  });
  await markerVarerSendt(lokaleVarer.map((p) => p.barcode));
  await setSetting('sistSynk', Date.now());

  return {
    sendteVarer: lokaleVarer.length,
    sendteBevegelser: lokaleBevegelser.length,
    hentedeVarer: (varerRader || []).length,
    hentedeBevegelser: (bevRader || []).length,
  };
}

let autoTimer = null;

/**
 * Synkroniserer i bakgrunnen uten å forstyrre brukeren.
 * Samler opp raske registreringer, så tjue skann gir én synkronisering.
 */
export function planleggSynk({ onFerdig, forsinkelse = 3000 } = {}) {
  clearTimeout(autoTimer);
  autoTimer = setTimeout(async () => {
    try {
      if (!(await erKonfigurert()) || !(await valgtLager())) return;
      if (navigator.onLine === false) return;
      if (!(await gjeldendeBruker())) return;
      await synkroniser();
      onFerdig?.();
    } catch {
      // Bakgrunnssynkronisering skal aldri avbryte arbeidet. Endringene
      // ligger trygt lokalt og sendes ved neste forsøk.
    }
  }, forsinkelse);
}

export async function sistSynkronisert() {
  return getSetting('sistSynk', null);
}

/** Gjør Supabase-feil om til noe som er til å forstå. */
export function oversettFeil(error) {
  const m = String(error?.message || error || '');
  if (/Invalid login credentials/i.test(m)) return 'Feil e-post eller passord';
  if (/User already registered/i.test(m)) return 'Denne e-posten er allerede registrert';
  if (/Password should be at least/i.test(m)) return 'Passordet må ha minst 6 tegn';
  if (/Email not confirmed/i.test(m)) return 'Bekreft e-posten din før du logger inn';
  if (/Anonymous sign-ins are disabled/i.test(m)) return 'Anonym innlogging må slås på i Supabase for at lagerkode skal virke';
  if (/Ukjent lagerkode/i.test(m)) return 'Ukjent lagerkode';
  if (/permission denied|row-level security/i.test(m)) return 'Du har ikke tilgang til dette lageret';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Ingen forbindelse – endringene ligger lagret lokalt';
  return m || 'Ukjent feil';
}
