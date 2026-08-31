#!/usr/bin/env bash
#
# Tester databaseskjemaet mot en ekte Postgres: at det kjører, og at
# tilgangsstyringen faktisk stenger folk ute. Krever postgresql lokalt.
#
#   bash scripts/test-skjema.sh
#
set -euo pipefail
export PATH="$PATH:/usr/lib/postgresql/16/bin"

PGDATA="${PGDATA:-/tmp/varelager-pg}"
PORT=5433
DB=varelager_skjematest

# Postgres nekter å kjøre som root. Kjøres skriptet av root, gjøres
# serverdelen som postgres-brukeren i stedet.
if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1; then
  OWNER=postgres
  som_server() { su postgres -c "PATH=$PATH $*"; }
else
  OWNER=$(whoami)
  som_server() { eval "$@"; }
fi

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  mkdir -p "$PGDATA" && chmod 700 "$PGDATA"
  [ "$OWNER" = "postgres" ] && chown -R postgres "$PGDATA"
  som_server "initdb -D $PGDATA -A trust" >/dev/null
fi
som_server "pg_ctl -D $PGDATA -o '-p $PORT -k /tmp' -l /tmp/varelager-pg.log start" >/dev/null 2>&1 || true
sleep 2
PSQL="psql -h /tmp -p $PORT -U $OWNER -v ON_ERROR_STOP=1 -q -t -A"
$PSQL -d postgres -c "drop database if exists $DB;" -c "create database $DB;" >/dev/null


# Erstatninger for Supabase sitt auth-skjema, slik at schema.sql kjøres uendret.
$PSQL -d $DB >/dev/null <<'EOF'
create schema auth;
create table auth.users (id uuid primary key, email text);
create table auth.aktiv (bruker uuid);
create function auth.uid() returns uuid
  language sql stable security definer set search_path = auth as $f$
  select bruker from auth.aktiv limit 1; $f$;
do $r$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
end $r$;
-- Samme rettigheter som Supabase gir rollen, slik at testen kan kalle
-- auth.uid() direkte i sine egne spørringer.
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
EOF

$PSQL -d $DB -f "$(dirname "$0")/../supabase/schema.sql" >/dev/null
echo "  ok  schema.sql kjører uten feil"

feil=0
sjekk() { # sjekk <navn> <forventet> <faktisk>
  if [ "$2" = "$3" ]; then echo "  ok  $1"; else echo "  FEIL  $1 – forventet «$2», fikk «$3»"; feil=$((feil+1)); fi
}

$PSQL -d $DB >/dev/null <<'EOF'
insert into auth.users values
  ('11111111-1111-1111-1111-111111111111','anna@eksempel.no'),
  ('22222222-2222-2222-2222-222222222222','bjorn@eksempel.no');
create procedure logg_inn(p uuid) language sql as $f$
  delete from auth.aktiv; insert into auth.aktiv values (p); $f$;
EOF

# Anna oppretter lager med én vare og én bevegelse.
$PSQL -d $DB >/dev/null <<'EOF'
call logg_inn('11111111-1111-1111-1111-111111111111');
set role authenticated;
select public.opprett_lager('Annas kjøkken');
insert into public.varer (lager_id, strekkode, navn)
  select id, '7038010000188', 'Lettmelk' from public.lager where navn = 'Annas kjøkken';
insert into public.bevegelser (id, lager_id, strekkode, type, antall, ts, utfort_av)
  select gen_random_uuid(), id, '7038010000188', 'inn', 10, 1000,
         '11111111-1111-1111-1111-111111111111'
  from public.lager where navn = 'Annas kjøkken';
EOF

les_som_bjorn() {
  $PSQL -d $DB <<EOF
call logg_inn('22222222-2222-2222-2222-222222222222');
set role authenticated;
$1
EOF
}

sjekk "Bjørn ser ingen av Annas varer"      "0" "$(les_som_bjorn 'select count(*) from public.varer;')"
sjekk "Bjørn ser ingen av Annas bevegelser" "0" "$(les_som_bjorn 'select count(*) from public.bevegelser;')"
sjekk "Bjørn ser ikke Annas lager"          "0" "$(les_som_bjorn 'select count(*) from public.lager;')"

# Anna deler ut kode, Bjørn løser den inn.
$PSQL -d $DB >/dev/null <<'EOF'
call logg_inn('11111111-1111-1111-1111-111111111111');
set role authenticated;
update public.lager set delt_kode = 'KJOKKEN-2026' where navn = 'Annas kjøkken';
EOF
les_som_bjorn "select public.bli_med_med_kode('KJOKKEN-2026','Bjørn');" >/dev/null

sjekk "Bjørn ser varen etter innløst kode" "1" "$(les_som_bjorn 'select count(*) from public.varer;')"
sjekk "Bjørn får rollen vikar"        "vikar" "$(les_som_bjorn 'select rolle from public.medlemskap where bruker_id = auth.uid();')"

les_som_bjorn "insert into public.bevegelser (id, lager_id, strekkode, type, antall, ts, utfort_av)
  select gen_random_uuid(), id, '7038010000188', 'ut', 2, 2000, auth.uid()
  from public.lager limit 1;" >/dev/null
sjekk "vikar kan føre bevegelse" "2" "$(les_som_bjorn 'select count(*) from public.bevegelser;')"

les_som_bjorn "delete from public.varer;" >/dev/null
sjekk "vikar får ikke slette varer" "1" "$(les_som_bjorn 'select count(*) from public.varer;')"

if les_som_bjorn "update public.bevegelser set antall = 999;" >/dev/null 2>&1; then
  echo "  FEIL  historikk kunne skrives om"; feil=$((feil+1))
else
  echo "  ok  historikk kan ikke skrives om"
fi

les_som_bjorn "update public.bevegelser set undone = true;" >/dev/null
sjekk "angring er lov" "2" "$(les_som_bjorn 'select count(*) from public.bevegelser where undone;')"

som_server "pg_ctl -D $PGDATA stop" >/dev/null 2>&1 || true
echo
if [ "$feil" -gt 0 ]; then echo "$feil sjekk(er) feilet"; exit 1; else echo "Alle skjemasjekker passerte"; fi
