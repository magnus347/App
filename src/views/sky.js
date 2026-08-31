/**
 * Skjermbilde for skylagring: oppsett, innlogging, valg av lager og
 * synkronisering. Ligger under Mer.
 */
import { el, toast, replace, confirmDialog, when } from '../ui.js';
import * as sky from '../lib/sky.js';

export function skyKort(app) {
  const kort = el('div.card.stack');

  async function tegn() {
    try {
      if (!(await sky.erKonfigurert())) return tegnOppsett();
      const bruker = await sky.gjeldendeBruker();
      if (!bruker) return tegnInnlogging();
      return tegnInnlogget(bruker);
    } catch (err) {
      replace(kort,
        el('h2', {}, 'Skylagring'),
        el('div.small', { style: 'color:var(--danger)' }, sky.oversettFeil(err)),
        el('button.wide.small', { onclick: tegn }, 'Prøv igjen'));
    }
  }

  /* ------------------------------------------------------------ oppsett */

  function tegnOppsett() {
    const url = el('input', { placeholder: 'https://xxxx.supabase.co', autocomplete: 'off' });
    const nokkel = el('input', { placeholder: 'anon public key', autocomplete: 'off' });
    replace(kort,
      el('h2', {}, 'Skylagring'),
      el('p.small.muted', { style: 'margin:0' },
        'Koble til et Supabase-prosjekt for å se samme lager på flere enheter. Appen fungerer like godt uten – da ligger dataene bare på denne enheten.'),
      el('div.field', {}, el('label', {}, 'Prosjekt-URL'), url),
      el('div.field', {}, el('label', {}, 'Anon public key'), nokkel),
      el('p.small.muted', { style: 'margin:0' },
        'Begge finnes under Settings → API i Supabase. Anon-nøkkelen er laget for å ligge i appen; det er tilgangsreglene i databasen som beskytter dataene. Bruk aldri service_role-nøkkelen her.'),
      el('button.primary.wide', {
        onclick: async () => {
          if (!url.value.trim() || !nokkel.value.trim()) return toast('Fyll ut begge feltene', 'err');
          await sky.lagreKonfig({ url: url.value, nokkel: nokkel.value });
          toast('Oppsettet er lagret', 'ok');
          await tegn();
        },
      }, 'Lagre oppsett')
    );
  }

  /* --------------------------------------------------------- innlogging */

  function tegnInnlogging() {
    const epost = el('input', { type: 'email', placeholder: 'navn@firma.no', autocomplete: 'username' });
    const passord = el('input', { type: 'password', placeholder: 'Passord', autocomplete: 'current-password' });
    const kode = el('input', { placeholder: 'Lagerkode fra sjefen', autocomplete: 'off' });

    const prøv = (fn, melding) => async () => {
      try {
        await fn();
        toast(melding, 'ok');
        await tegn();
        app.refreshAll?.();
      } catch (err) {
        toast(sky.oversettFeil(err), 'err');
      }
    };

    replace(kort,
      el('h2', {}, 'Logg inn'),
      el('div.field', {}, el('label', {}, 'E-post'), epost),
      el('div.field', {}, el('label', {}, 'Passord'), passord),
      el('div.row', {},
        el('button.primary.grow', {
          onclick: prøv(() => sky.loggInn(epost.value.trim(), passord.value), 'Logget inn'),
        }, 'Logg inn'),
        el('button.grow', {
          onclick: prøv(async () => {
            await sky.registrer(epost.value.trim(), passord.value);
          }, 'Konto opprettet – sjekk e-posten om bekreftelse kreves'),
        }, 'Ny konto')
      ),
      el('div.small.muted', { style: 'margin-top:14px' }, 'Eller bli med som vikar med en lagerkode:'),
      el('div.row', {},
        el('div.grow', {}, kode),
        el('button', {
          onclick: prøv(async () => {
            if (!kode.value.trim()) throw new Error('Skriv inn lagerkoden');
            await sky.loggInnAnonymt();
            await sky.bliMedMedKode(kode.value.trim());
          }, 'Du er med i lageret'),
        }, 'Bli med')
      ),
      el('button.ghost.wide.small', {
        onclick: async () => {
          const ok = await confirmDialog('Endre oppsett?',
            'Du kobler fra Supabase-prosjektet. Lagerdataene på denne enheten røres ikke.',
            { okText: 'Endre' });
          if (!ok) return;
          await sky.lagreKonfig({ url: '', nokkel: '' });
          await tegn();
        },
      }, 'Endre prosjektoppsett')
    );
  }

  /* ---------------------------------------------------------- innlogget */

  async function tegnInnlogget(bruker) {
    const lagre = await sky.mineLagre();
    const valgt = await sky.valgtLager();
    const sist = await sky.sistSynkronisert();
    const detteLager = lagre.find((l) => l.id === valgt);

    const status = el('div.small.muted', {},
      sist ? `Sist synkronisert ${when(sist)}` : 'Ikke synkronisert ennå');

    const synkKnapp = el('button.primary.wide', {
      onclick: async () => {
        synkKnapp.disabled = true;
        try {
          const r = await sky.synkroniser({ onStatus: (t) => (status.textContent = t) });
          toast(`Sendt ${r.sendteBevegelser}, hentet ${r.hentedeBevegelser} bevegelser`, 'ok');
          app.refreshAll?.();
        } catch (err) {
          toast(sky.oversettFeil(err), 'err');
        } finally {
          synkKnapp.disabled = false;
          await tegn();
        }
      },
    }, 'Synkroniser nå');

    const velger = el('select', {
      onchange: async (ev) => {
        await sky.velgLager(ev.target.value);
        await tegn();
      },
    }, ...lagre.map((l) => el('option', { value: l.id, selected: l.id === valgt }, `${l.navn} (${l.rolle})`)));

    replace(kort,
      el('h2', {}, 'Skylagring'),
      el('div.small.muted', {}, bruker.is_anonymous ? 'Innlogget som vikar' : bruker.email),

      lagre.length
        ? el('div.field', {}, el('label', {}, 'Aktivt lager'), velger)
        : el('p.small.muted', { style: 'margin:0' }, 'Du er ikke med i noe lager ennå.'),

      valgt ? el('div.stack', {}, status, synkKnapp) : null,

      !bruker.is_anonymous ? el('button.wide.small', {
        onclick: async () => {
          const navn = prompt('Navn på lageret:', 'Hovedlager');
          if (!navn) return;
          try {
            await sky.opprettLager(navn.trim());
            toast('Lageret er opprettet', 'ok');
            await tegn();
          } catch (err) {
            toast(sky.oversettFeil(err), 'err');
          }
        },
      }, 'Opprett nytt lager') : null,

      detteLager && detteLager.rolle === 'eier' ? el('div.stack', {},
        el('div.small.muted', {},
          detteLager.delt_kode
            ? `Lagerkode for vikarer: ${detteLager.delt_kode}`
            : 'Ingen lagerkode satt. Vikarer trenger en kode for å bli med.'),
        el('button.wide.small', {
          onclick: async () => {
            const kode = prompt('Lagerkode vikarer skal bruke:',
              detteLager.delt_kode || `${detteLager.navn.replace(/\s+/g, '').toUpperCase().slice(0, 8)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`);
            if (!kode) return;
            try {
              await sky.settDeltKode(detteLager.id, kode.trim());
              toast('Lagerkoden er oppdatert', 'ok');
              await tegn();
            } catch (err) {
              toast(sky.oversettFeil(err), 'err');
            }
          },
        }, detteLager.delt_kode ? 'Endre lagerkode' : 'Lag lagerkode')
      ) : null,

      valgt ? el('button.ghost.wide.small', {
        onclick: async () => {
          const ok = await confirmDialog('Hente hele lageret på nytt?',
            'Neste synkronisering henter alt fra skyen i stedet for bare endringer. Bruk det hvis noe ser feil ut.',
            { okText: 'Hent alt' });
          if (!ok) return;
          await sky.hentAltPåNytt();
          toast('Neste synkronisering henter alt', 'ok');
        },
      }, 'Hent hele lageret på nytt') : null,

      el('button.ghost.wide.small', {
        onclick: async () => {
          await sky.loggUt();
          toast('Logget ut', 'ok');
          await tegn();
        },
      }, 'Logg ut')
    );
  }

  tegn();
  return { kort, tegn };
}
