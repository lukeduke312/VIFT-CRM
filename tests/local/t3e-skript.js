'use strict';
/*
 * T3-E: genererar de manuella skripten i supabase/manual/t3e_standardroller/ ur
 * standardroller.json (en enda källa för definitionen).
 *
 *   node tests/local/t3e-skript.js           verifierar att skripten är aktuella
 *   node tests/local/t3e-skript.js --skriv   skriver dem
 *
 * Skripten körs ALDRIG av migrationskedjan. De körs manuellt i SQL Editor efter separat GO
 * (A och D:s läsdel är läsande). Lokalt prövas de mot repliken i tests/t3e_installation.test.js.
 */
const fs = require('fs');
const path = require('path');
const DIR = path.resolve(__dirname, '..', '..', 'supabase', 'manual', 't3e_standardroller');
const DEF = JSON.parse(fs.readFileSync(path.join(DIR, 'standardroller.json'), 'utf8'));
const lit = () => '[\n' + DEF.roller.map((r) => '  ' + JSON.stringify({ id: r.id, label: r.label, isBuiltin: r.isBuiltin, active: r.active, description: r.description, permissions: r.permissions })).join(',\n') + '\n]';
const sqlLit = () => "'" + lit().replace(/'/g, "''") + "'::jsonb";
const HASH = "encode(sha256(convert_to(%s::text, 'UTF8')), 'hex')";
const h = (x) => HASH.replace('%s', x);
const NYA_AO = ['ao_start_own', 'ao_complete_own', 'ao_pool_take'];

const HUVUD = (titel, rader) => ['-- =====================================================================',
  '-- VIFT CRM — T3-E standardroller (M9, D-02): ' + titel,
  '-- Genererad av vift-v2 tests/local/t3e-skript.js ur standardroller.json (' + DEF.version + '). Ändra inte för hand.',
  '-- Körs i Supabase SQL Editor för STAGING (yyzljlqyzzcbxmcdbual) FÖRST efter separat GO.',
  '-- ALDRIG mot LIVE utan en egen LIVE-plan. Ingår INTE i migrationskedjan (inte db push).']
  .concat(rader.map((r) => '-- ' + r)).concat(['-- =====================================================================', '']).join('\n');

/* Gemensam journal: före- och eftervärde med hash, för rollback med expectedHash. */
const JOURNAL = `  create schema if not exists vift_t3e_journal;
  revoke all on schema vift_t3e_journal from public, anon, authenticated;
  create table if not exists vift_t3e_journal.rollregister (
    id bigserial primary key,
    steg text not null,
    utford_at timestamptz not null default now(),
    utford_av text not null default current_user,
    fore_hash text not null,
    efter_hash text not null,
    fore_varde jsonb not null,
    efter_varde jsonb not null,
    tillagda_roller text[] not null default '{}',
    identiska_roller text[] not null default '{}',
    tillagda_behorigheter text[] not null default '{}',
    personal_hash text not null,
    kommentar text
  );
  revoke all on table vift_t3e_journal.rollregister from public, anon, authenticated;`;

/* Lås i samma ordning som T3-C (_vift_superadmin_lock): rådgivande lås → roller → personal. */
const LAS = `  perform pg_advisory_xact_lock(hashtextextended('vift:roles+staff', 0));
  select value into v_roles from public.store where key = 'vift_roles' for update;
  select value into v_staff from public.store where key = 'vift_staff' for update;
  if v_roles is null or jsonb_typeof(v_roles) <> 'array' then
    raise exception 'T3-E STOP: vift_roles saknas eller är inte en lista — inget ändrat';
  end if;
  if v_staff is null or jsonb_typeof(v_staff) <> 'array' then
    raise exception 'T3-E STOP: vift_staff saknas eller är inte en lista — inget ändrat';
  end if;`;
const SUPER = (v, roles) => `  if to_regprocedure('public._vift_superadmin_count(jsonb,jsonb)') is not null then
    execute 'select public._vift_superadmin_count($1, $2)' into ${v} using v_staff, ${roles || 'v_roles'};
  end if;`;

function A() {
  return HUVUD('A. Läsande kontroll och plan (ändrar ingenting)', [
    'Kör hela filen. Spara resultatet (hash, plan, antal per roll-id). Hashen från A2 fylls i B eller D.',
    'Inga personuppgifter visas: bara roll-id, behörigheter och antal.']) + `
-- A1. Rätt projekt? (STAGING)
select current_database() as databas, now() as tid;

-- A2. Rollregistrets hash (samma hash som store-key-write readWithHash) och antal roller.
select ${h('value')} as forvantad_hash, jsonb_array_length(value) as antal_roller, updated_at
  from public.store where key = 'vift_roles';

-- A3. Rollregistret: id och behörigheter (sorterade).
select e->>'id' as roll_id, coalesce(e->>'active', 'true') as aktiv,
       (select string_agg(p, ', ' order by p) from jsonb_array_elements_text(case when jsonb_typeof(e->'permissions') = 'array' then e->'permissions' else '[]'::jsonb end) p) as behorigheter
  from public.store, jsonb_array_elements(value) e where key = 'vift_roles' order by 1;

-- A4. Plan per standardroll: LAGGS_TILL, IDENTISK (hoppas över) eller KROCK (B stoppar).
with def as (select x as r from jsonb_array_elements(${sqlLit()}) x),
     reg as (select e from public.store, jsonb_array_elements(value) e where key = 'vift_roles')
select d.r->>'id' as standardroll,
       case when not exists (select 1 from reg where reg.e->>'id' = d.r->>'id') then 'LAGGS_TILL'
            when (select count(*) from reg where reg.e->>'id' = d.r->>'id') > 1 then 'KROCK (dubbla id)'
            when (select array_agg(distinct p order by p) from reg, jsonb_array_elements_text(case when jsonb_typeof(reg.e->'permissions') = 'array' then reg.e->'permissions' else '[]'::jsonb end) p where reg.e->>'id' = d.r->>'id')
                 is not distinct from (select array_agg(distinct p order by p) from jsonb_array_elements_text(d.r->'permissions') p) then 'IDENTISK'
            else 'KROCK (andra behörigheter)' end as plan
  from def d order by 1;

-- A5. Personal per roll-id (bara antal). Aktiv personal med ett roll-id som ska LAGGS_TILL stoppar B.
select coalesce(s->>'role', '(saknas)') as roll_id,
       count(*) filter (where coalesce(s->>'active', 'true') <> 'false') as aktiva,
       count(*) filter (where coalesce(s->>'active', 'true') = 'false') as inaktiva
  from public.store, jsonb_array_elements(case when jsonb_typeof(value) = 'array' then value else '[]'::jsonb end) s
 where key = 'vift_staff' group by 1 order by 1;

-- A6. Roller som i dag får ao_start_own/ao_complete_own/ao_pool_take genom övergångsregeln
--     (§4.6: ao_complete utan ao_view_all/ao_edit och utan någon av de nya). Kandidater för D.
select e->>'id' as roll_id,
       (select count(*) from public.store st, jsonb_array_elements(st.value) s where st.key = 'vift_staff' and s->>'role' = e->>'id' and coalesce(s->>'active', 'true') <> 'false') as aktiva_anvandare
  from public.store, jsonb_array_elements(value) e
 where key = 'vift_roles' and jsonb_typeof(e->'permissions') = 'array'
   and e->'permissions' ? 'ao_complete' and not (e->'permissions' ?| array['ao_view_all', 'ao_edit', 'all'])
   and not (e->'permissions' ?| array['${NYA_AO.join("', '")}'])
 order by 1;

-- A7. Journal (finns efter första körningen av B eller D; före det ger frågan ingen rad).
select query_to_xml('select id, steg, utford_at, fore_hash, efter_hash, tillagda_roller, identiska_roller, tillagda_behorigheter
                       from vift_t3e_journal.rollregister order by id', true, false, '') as journal
 where to_regclass('vift_t3e_journal.rollregister') is not null;
`;
}

function B() {
  return HUVUD('B. Installera de standardroller som saknas (KRÄVER GO)', [
    'Lägger BARA till standardroller som saknas. Skriver aldrig över eller tar bort befintliga roller.',
    'Ändrar aldrig personalposter (D-02). Idempotent: en andra körning ändrar ingenting.',
    'STOP (inget ändras) om: hashen i rad 1 inte är rollregistrets aktuella hash (del A, A2);',
    '  en befintlig roll har samma id men andra behörigheter (id-krock) eller dubbla id;',
    '  aktiv personal redan har ett roll-id som skulle läggas till (rollen skulle då ge dem åtkomst);',
    '  antalet superadministratörer skulle ändras.',
    'Journal: vift_t3e_journal.rollregister (före/efter med hash). Rollback: C_rollback.sql.']) + `
-- Rad 1: fyll i forvantad_hash från del A (A2). Lämnas platshållaren kvar stoppas skriptet.
select set_config('vift.t3e_forvantad_hash', 'FYLL_I_HASH_FRAN_DEL_A', false);

begin;
do $$
declare
  v_def jsonb := ${sqlLit()};
  v_forv text := current_setting('vift.t3e_forvantad_hash', true);
  v_roles jsonb; v_staff jsonb; v_new jsonb; v_hash text; v_staff_hash text;
  v_r jsonb; v_e jsonb; v_cnt int; v_ex text[]; v_std text[];
  v_tillagda text[] := '{}'; v_identiska text[] := '{}'; v_krock text[] := '{}'; v_aktiva text[] := '{}';
  v_super_fore int; v_super_efter int; v_jid bigint;
begin
${LAS}
  v_hash := ${h('v_roles')};
  if v_forv is null or v_forv = '' or v_forv = 'FYLL_I_HASH_FRAN_DEL_A' then
    raise exception 'T3-E STOP: förväntad hash saknas (fyll i rad 1 med A2) — inget ändrat';
  end if;
  if v_hash <> v_forv then
    raise exception 'T3-E STOP: rollregistret har ändrats sedan del A (hash % ≠ förväntad %) — inget ändrat; kör A igen', v_hash, v_forv;
  end if;
  v_staff_hash := ${h('v_staff')};
${SUPER('v_super_fore')}
  for v_r in select x from jsonb_array_elements(v_def) x loop
    select count(*) into v_cnt from jsonb_array_elements(v_roles) e where e->>'id' = v_r->>'id';
    if v_cnt = 0 then
      v_tillagda := v_tillagda || (v_r->>'id');
      continue;
    end if;
    if v_cnt > 1 then
      v_krock := v_krock || format('%s: dubbla id i rollregistret (%s st)', v_r->>'id', v_cnt);
      continue;
    end if;
    select e into v_e from jsonb_array_elements(v_roles) e where e->>'id' = v_r->>'id';
    select coalesce(array_agg(distinct p order by p), '{}') into v_ex from jsonb_array_elements_text(case when jsonb_typeof(v_e->'permissions') = 'array' then v_e->'permissions' else '[]'::jsonb end) p;
    select coalesce(array_agg(distinct p order by p), '{}') into v_std from jsonb_array_elements_text(v_r->'permissions') p;
    if v_ex = v_std and jsonb_typeof(v_e->'permissions') = 'array' then
      v_identiska := v_identiska || (v_r->>'id');
    else
      v_krock := v_krock || format('%s: befintlig [%s], standard [%s]', v_r->>'id', array_to_string(v_ex, ','), array_to_string(v_std, ','));
    end if;
  end loop;
  if array_length(v_krock, 1) > 0 then
    raise exception 'T3-E STOP: id-krock — befintliga roller skrivs aldrig över; inget ändrat. %', array_to_string(v_krock, ' | ');
  end if;
  select coalesce(array_agg(format('%s (%s aktiva)', r, n) order by r), '{}') into v_aktiva from (
    select s->>'role' as r, count(*) as n from jsonb_array_elements(v_staff) s
     where s->>'role' = any(v_tillagda) and coalesce(s->>'active', 'true') <> 'false' group by 1) x;
  if array_length(v_aktiva, 1) > 0 then
    raise exception 'T3-E STOP: aktiv personal har redan roll-id som skulle läggas till (rollen skulle ge dem åtkomst direkt) — inget ändrat. %', array_to_string(v_aktiva, ', ');
  end if;
  if coalesce(array_length(v_tillagda, 1), 0) = 0 then
    raise notice 'T3-E: inget att göra — alla standardroller finns redan med exakt standardbehörigheterna (%). Ingen skrivning, ingen journalrad.', array_to_string(v_identiska, ', ');
    return;
  end if;
  select v_roles || coalesce(jsonb_agg(x order by o), '[]'::jsonb) into v_new
    from jsonb_array_elements(v_def) with ordinality t(x, o) where x->>'id' = any(v_tillagda);
  update public.store set value = v_new, updated_at = now() where key = 'vift_roles';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
    on conflict (key) do update set value = excluded.value, updated_at = now(); -- som RPC:erna: öppna klienter läser om
${SUPER('v_super_efter', 'v_new')}
  if v_super_fore is distinct from v_super_efter then
    raise exception 'T3-E STOP: antalet superadministratörer skulle ändras (% → %) — inget ändrat', v_super_fore, v_super_efter;
  end if;
  if (select ${h('value')} from public.store where key = 'vift_staff') <> v_staff_hash then
    raise exception 'T3-E STOP: personalregistret ändrades — inget ändrat';
  end if;
${JOURNAL.replace(/^ {2}/gm, '  ')}
  insert into vift_t3e_journal.rollregister(steg, fore_hash, efter_hash, fore_varde, efter_varde, tillagda_roller, identiska_roller, personal_hash, kommentar)
  values ('installera', v_hash, ${h('v_new')}, v_roles, v_new, v_tillagda, v_identiska, v_staff_hash, '${DEF.version}')
  returning id into v_jid;
  raise notice 'T3-E: journalrad % — tillagda roller: %; identiska (orörda): %; ny hash %', v_jid, array_to_string(v_tillagda, ', '), array_to_string(v_identiska, ', '), ${h('v_new')};
end $$;
commit;
`;
}

function C() {
  return HUVUD('C. Rollback av en journalförd ändring med expectedHash (KRÄVER GO)', [
    'Återställer rollregistrets förevärde för EN journalrad (från B eller D), i omvänd ordning.',
    'STOP (inget ändras) om rollregistret ändrats efter journalraden (aktuell hash ≠ journalens',
    '  efter_hash): nyare ändringar skrivs aldrig över; om raden redan är återställd; om någon',
    '  personalpost (aktiv eller inaktiv) har ett roll-id som raden lade till.',
    'Personalregistret ändras aldrig. Rollbacken journalförs.']) + `
-- Rad 1: fyll i journalradens id (del A, A7). Lämnas platshållaren kvar stoppas skriptet.
select set_config('vift.t3e_journal_id', 'FYLL_I_JOURNAL_ID', false);

begin;
do $$
declare
  v_id text := current_setting('vift.t3e_journal_id', true);
  v_j vift_t3e_journal.rollregister%rowtype;
  v_roles jsonb; v_staff jsonb; v_hash text; v_ref text[]; v_super_fore int; v_super_efter int; v_jid bigint;
begin
  if v_id is null or v_id !~ '^[0-9]+$' then
    raise exception 'T3-E STOP: journalradens id saknas (fyll i rad 1) — inget ändrat';
  end if;
  select * into v_j from vift_t3e_journal.rollregister where id = v_id::bigint;
  if not found or v_j.steg like 'rollback:%' then
    raise exception 'T3-E STOP: journalrad % finns inte eller är själv en rollback — inget ändrat', v_id;
  end if;
  if exists (select 1 from vift_t3e_journal.rollregister where steg = 'rollback:' || v_id) then
    raise exception 'T3-E STOP: journalrad % är redan återställd — inget ändrat', v_id;
  end if;
${LAS}
  v_hash := ${h('v_roles')};
  if v_hash <> v_j.efter_hash then
    raise exception 'T3-E STOP: rollregistret har ändrats efter journalrad % (hash % ≠ %) — nyare ändringar skrivs aldrig över; inget ändrat', v_id, v_hash, v_j.efter_hash;
  end if;
  if ${h('v_j.fore_varde')} <> v_j.fore_hash then
    raise exception 'T3-E STOP: journalens förevärde stämmer inte med sin hash — inget ändrat';
  end if;
  select coalesce(array_agg(distinct s->>'role'), '{}') into v_ref from jsonb_array_elements(v_staff) s where s->>'role' = any(v_j.tillagda_roller);
  if array_length(v_ref, 1) > 0 then
    raise exception 'T3-E STOP: personal har tilldelats roll som rollbacken skulle ta bort (%) — inget ändrat', array_to_string(v_ref, ', ');
  end if;
${SUPER('v_super_fore')}
  update public.store set value = v_j.fore_varde, updated_at = now() where key = 'vift_roles';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
    on conflict (key) do update set value = excluded.value, updated_at = now(); -- som RPC:erna: öppna klienter läser om
  v_roles := v_j.fore_varde;
${SUPER('v_super_efter')}
  if v_super_fore is distinct from v_super_efter then
    raise exception 'T3-E STOP: antalet superadministratörer skulle ändras (% → %) — inget ändrat', v_super_fore, v_super_efter;
  end if;
  insert into vift_t3e_journal.rollregister(steg, fore_hash, efter_hash, fore_varde, efter_varde, personal_hash, kommentar)
  values ('rollback:' || v_id, v_hash, v_j.fore_hash, v_j.efter_varde, v_j.fore_varde, ${h('v_staff')}, 'återställt förevärdet för journalrad ' || v_id)
  returning id into v_jid;
  raise notice 'T3-E: rollback av journalrad % klar (journalrad %), rollregistrets hash nu %', v_id, v_jid, v_j.fore_hash;
end $$;
commit;
`;
}

function D() {
  return HUVUD('D. Övergångsregeln: gör en befintlig rolls effektiva AO-behörigheter uttryckliga (KRÄVER GO PER ROLL)', [
    'För EN roll som i dag får ' + NYA_AO.join(', ') + ' genom övergångsregeln (testplanen §4.6):',
    '  ao_complete utan ao_view_all/ao_edit/all och utan någon av de tre. Lägger till exakt de tre.',
    '  Rollens effektiva åtkomst är densamma före och efter (bevisat lokalt, t3e_installation).',
    '  Inga andra behörigheter ändras, ingen roll tas bort, personalregistret ändras aldrig.',
    'STOP (inget ändras) om hashen inte stämmer, rollen saknas/är dubblerad, eller regeln inte gäller rollen.',
    'Journal: vift_t3e_journal.rollregister. Rollback: C_rollback.sql med journalradens id.']) + `
-- Rad 1: rollens id. Rad 2: rollregistrets hash från del A (A2).
select set_config('vift.t3e_roll', 'FYLL_I_ROLL_ID', false);
select set_config('vift.t3e_forvantad_hash', 'FYLL_I_HASH_FRAN_DEL_A', false);

begin;
do $$
declare
  v_roll text := current_setting('vift.t3e_roll', true);
  v_forv text := current_setting('vift.t3e_forvantad_hash', true);
  v_roles jsonb; v_staff jsonb; v_new jsonb; v_hash text; v_e jsonb; v_cnt int; v_jid bigint;
  v_nya text[] := array['${NYA_AO.join("', '")}'];
begin
${LAS}
  v_hash := ${h('v_roles')};
  if v_forv is null or v_forv = '' or v_forv = 'FYLL_I_HASH_FRAN_DEL_A' or v_hash <> v_forv then
    raise exception 'T3-E STOP: rollregistrets hash % ≠ förväntad % — inget ändrat; kör A igen', v_hash, coalesce(v_forv, '-');
  end if;
  select count(*) into v_cnt from jsonb_array_elements(v_roles) e where e->>'id' = v_roll;
  if v_cnt <> 1 then
    raise exception 'T3-E STOP: rollen % finns % gånger (exakt 1 krävs) — inget ändrat', v_roll, v_cnt;
  end if;
  select e into v_e from jsonb_array_elements(v_roles) e where e->>'id' = v_roll;
  if jsonb_typeof(v_e->'permissions') <> 'array' or not (v_e->'permissions' ? 'ao_complete')
     or (v_e->'permissions' ?| array['ao_view_all', 'ao_edit', 'all']) or (v_e->'permissions' ?| v_nya) then
    raise exception 'T3-E STOP: övergångsregeln gäller inte rollen % (kräver ao_complete utan ao_view_all/ao_edit/all och utan %) — inget ändrat', v_roll, array_to_string(v_nya, ', ');
  end if;
  select jsonb_agg(case when e->>'id' = v_roll then jsonb_set(e, '{permissions}', (e->'permissions') || to_jsonb(v_nya)) else e end order by o)
    into v_new from jsonb_array_elements(v_roles) with ordinality t(e, o);
  update public.store set value = v_new, updated_at = now() where key = 'vift_roles';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
    on conflict (key) do update set value = excluded.value, updated_at = now(); -- som RPC:erna: öppna klienter läser om
${JOURNAL}
  insert into vift_t3e_journal.rollregister(steg, fore_hash, efter_hash, fore_varde, efter_varde, tillagda_behorigheter, personal_hash, kommentar)
  values ('overgang:' || v_roll, v_hash, ${h('v_new')}, v_roles, v_new, v_nya, ${h('v_staff')}, 'övergångsregeln uttrycklig för ' || v_roll)
  returning id into v_jid;
  raise notice 'T3-E: journalrad % — % fick % (samma effektiva åtkomst); ny hash %', v_jid, v_roll, array_to_string(v_nya, ', '), ${h('v_new')};
end $$;
commit;
`;
}

const FILER = { 'A_las_och_plan.sql': A, 'B_installera.sql': B, 'C_rollback.sql': C, 'D_overgangsregel_uttrycklig.sql': D };
if (require.main === module) {
  let fel = 0;
  for (const [f, fn] of Object.entries(FILER)) {
    const p = path.join(DIR, f);
    if (process.argv.includes('--skriv')) { fs.writeFileSync(p, fn()); console.log('Skrev ' + p); }
    else { const okk = fs.existsSync(p) && fs.readFileSync(p, 'utf8') === fn(); console.log((okk ? 'PASS ' : 'FAIL ') + f + ' är aktuell'); if (!okk) fel++; }
  }
  process.exitCode = fel ? 1 : 0;
}
module.exports = { FILER, DIR, DEF, lit, NYA_AO };
