-- Varelager: databaseskjema for Supabase.
--
-- Kjøres én gang i Supabase → SQL Editor → New query → lim inn → Run.
--
-- Sikkerheten hviler på Row Level Security: hver rad hører til ett lager, og
-- du ser bare rader fra lagre du er medlem av. Uten RLS ville anon-nøkkelen
-- i appen gitt hvem som helst tilgang til alt.

-- ---------------------------------------------------------------- tabeller

create table if not exists public.lager (
  id           uuid primary key default gen_random_uuid(),
  navn         text not null,
  delt_kode    text unique,              -- valgfri kode for vikarer
  opprettet_av uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now()
);

create table if not exists public.medlemskap (
  lager_id   uuid not null references public.lager (id) on delete cascade,
  bruker_id  uuid not null references auth.users (id) on delete cascade,
  rolle      text not null default 'medlem' check (rolle in ('eier', 'medlem', 'vikar')),
  navn       text,
  created_at timestamptz not null default now(),
  primary key (lager_id, bruker_id)
);

create table if not exists public.varer (
  lager_id    uuid not null references public.lager (id) on delete cascade,
  strekkode   text not null,
  navn        text not null,
  beskrivelse text default '',
  kategori    text default 'mat',
  enhet       text default 'stk',
  kolli       numeric default 1,
  min_antall  numeric default 0,
  leverandor  text default '',
  plassering  text default '',
  pris        numeric,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  primary key (lager_id, strekkode)
);

-- Bevegelsesloggen er fasit for beholdningen. Ingen `antall på lager`-kolonne
-- her med vilje: et slikt tall ville to enheter kunne overskrive for
-- hverandre. Beholdningen regnes ut fra loggen, i appen.
create table if not exists public.bevegelser (
  id         uuid primary key,           -- lages på enheten, så retry ikke dupliserer
  lager_id   uuid not null references public.lager (id) on delete cascade,
  strekkode  text not null,
  type       text not null check (type in ('inn', 'ut', 'telling', 'justering')),
  antall     numeric not null,
  notat      text default '',
  ts         bigint not null,            -- millisekunder, samme klokke som appen
  undone     boolean not null default false,
  utfort_av  uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Oppdateres ved angring, slik at enheter kan hente bare det som er
  -- endret siden sist framfor hele loggen. created_at duger ikke: den
  -- endrer seg ikke når en bevegelse angres.
  endret_at  timestamptz not null default now()
);

create index if not exists bevegelser_lager_ts_idx on public.bevegelser (lager_id, ts);
create index if not exists bevegelser_endret_idx on public.bevegelser (lager_id, endret_at);
create index if not exists varer_lager_oppdatert_idx on public.varer (lager_id, updated_at);

alter table public.bevegelser add column if not exists endret_at timestamptz not null default now();

-- ------------------------------------------------------------- hjelpere
--
-- security definer for å unngå at policyen på medlemskap slår opp i seg selv
-- og går i uendelig rekursjon.

create or replace function public.er_medlem(p_lager uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.medlemskap
    where lager_id = p_lager and bruker_id = auth.uid()
  );
$$;

create or replace function public.har_rolle(p_lager uuid, p_roller text[])
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.medlemskap
    where lager_id = p_lager and bruker_id = auth.uid() and rolle = any (p_roller)
  );
$$;

-- Oppretter et lager og gjør den som kaller til eier, i én transaksjon.
create or replace function public.opprett_lager(p_navn text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  nytt_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Du må være innlogget';
  end if;
  insert into public.lager (navn, opprettet_av) values (p_navn, auth.uid())
  returning id into nytt_id;
  insert into public.medlemskap (lager_id, bruker_id, rolle)
  values (nytt_id, auth.uid(), 'eier');
  return nytt_id;
end;
$$;

-- Løser inn en delt kode. Vikarer får rollen 'vikar' og kan føre bevegelser,
-- men ikke slette varer eller endre hvem som har tilgang.
create or replace function public.bli_med_med_kode(p_kode text, p_navn text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  funnet uuid;
begin
  if auth.uid() is null then
    raise exception 'Du må være innlogget';
  end if;
  select id into funnet from public.lager where delt_kode = p_kode;
  if funnet is null then
    raise exception 'Ukjent lagerkode';
  end if;
  insert into public.medlemskap (lager_id, bruker_id, rolle, navn)
  values (funnet, auth.uid(), 'vikar', p_navn)
  on conflict (lager_id, bruker_id) do nothing;
  return funnet;
end;
$$;

-- ------------------------------------------------------------ rettigheter
--
-- Supabase kobler til som rollen «authenticated». Rettighetene under er som
-- regel allerede satt via default privileges, men eksplisitt er tryggere enn
-- å anta – uten dem svarer appen «permission denied for table varer».

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant usage on schema public to authenticated;
    grant select, insert, update, delete on
      public.lager, public.medlemskap, public.varer, public.bevegelser to authenticated;
    grant execute on function
      public.opprett_lager(text), public.bli_med_med_kode(text, text),
      public.er_medlem(uuid), public.har_rolle(uuid, text[]) to authenticated;
  end if;
end $$;

-- --------------------------------------------------------- tilgangsregler

alter table public.lager      enable row level security;
alter table public.medlemskap enable row level security;
alter table public.varer      enable row level security;
alter table public.bevegelser enable row level security;

drop policy if exists lager_les on public.lager;
create policy lager_les on public.lager
  for select using (public.er_medlem(id));

drop policy if exists lager_endre on public.lager;
create policy lager_endre on public.lager
  for update using (public.har_rolle(id, array['eier']))
  with check (public.har_rolle(id, array['eier']));

drop policy if exists medlemskap_les on public.medlemskap;
create policy medlemskap_les on public.medlemskap
  for select using (bruker_id = auth.uid() or public.er_medlem(lager_id));

drop policy if exists medlemskap_styr on public.medlemskap;
create policy medlemskap_styr on public.medlemskap
  for all using (public.har_rolle(lager_id, array['eier']))
  with check (public.har_rolle(lager_id, array['eier']));

drop policy if exists varer_les on public.varer;
create policy varer_les on public.varer
  for select using (public.er_medlem(lager_id));

drop policy if exists varer_skriv on public.varer;
create policy varer_skriv on public.varer
  for insert with check (public.er_medlem(lager_id));

drop policy if exists varer_oppdater on public.varer;
create policy varer_oppdater on public.varer
  for update using (public.er_medlem(lager_id))
  with check (public.er_medlem(lager_id));

-- Sletting krever fast tilknytning: en vikar skal kunne telle, ikke rydde
-- bort varekort andre er avhengige av.
drop policy if exists varer_slett on public.varer;
create policy varer_slett on public.varer
  for delete using (public.har_rolle(lager_id, array['eier', 'medlem']));

drop policy if exists bevegelser_les on public.bevegelser;
create policy bevegelser_les on public.bevegelser
  for select using (public.er_medlem(lager_id));

drop policy if exists bevegelser_skriv on public.bevegelser;
create policy bevegelser_skriv on public.bevegelser
  for insert with check (public.er_medlem(lager_id) and utfort_av = auth.uid());

-- Bevegelser er historikk og skal ikke kunne skrives om. Det eneste som kan
-- endres er angring, som håndheves av triggeren under.
drop policy if exists bevegelser_angre on public.bevegelser;
create policy bevegelser_angre on public.bevegelser
  for update using (public.er_medlem(lager_id))
  with check (public.er_medlem(lager_id));

create or replace function public.bevegelse_kun_angring()
returns trigger
language plpgsql
as $$
begin
  if new.id <> old.id or new.lager_id <> old.lager_id or new.strekkode <> old.strekkode
     or new.type <> old.type or new.antall <> old.antall or new.ts <> old.ts then
    raise exception 'Bevegelser kan ikke endres, bare angres';
  end if;
  new.endret_at := now();
  return new;
end;
$$;

drop trigger if exists bevegelse_uforanderlig on public.bevegelser;
create trigger bevegelse_uforanderlig
  before update on public.bevegelser
  for each row execute function public.bevegelse_kun_angring();
