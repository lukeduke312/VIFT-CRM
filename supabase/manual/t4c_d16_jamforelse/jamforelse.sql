-- ============================================================
-- T4-C, D-16 (förberedelse): LÄSANDE jämförelserapport — portkoder och åtkomstinformation i
-- store-bloben (vift_propertyObjects, vift_properties, vift_workOrders, vift_recurringOrders) mot
-- sanningskällan public.property_sensitive_access.
--
-- BARA ANTAL. Inga värden skrivs ut, inga data ändras (transaktionen är READ ONLY och rullas
-- tillbaka). INGEN migrering och INGEN borttagning av lagrade värden (D-16: tabellen är
-- sanningskälla; dubbel lagring kvarstår tills ett separat beslut om migrering).
--
-- Körs med psql (service_role/postgres), lokalt mot replikan eller — efter separat GO — läsande i
-- STAGING:  psql -X -v ON_ERROR_STOP=1 -f jamforelse.sql
-- Utdata: en rad JSON med antal per kategori (lika, olika, saknas_i_tabell, saknas_i_blob, tomma).
-- Fält som jämförs (blob → kolumn): doorCode→door_code, keyInformation→key_information,
-- keyReceipt→key_receipt, alarmInformation→alarm_information, accessInformation→access_information,
-- accessCode→access_code. Tomt ('' eller saknat) = null.
-- ============================================================
begin transaction isolation level repeatable read read only;

with
falt(f, kol) as (values ('doorCode','door_code'), ('keyInformation','key_information'), ('keyReceipt','key_receipt'),
                        ('alarmInformation','alarm_information'), ('accessInformation','access_information'), ('accessCode','access_code')),
blob_obj as (
  select e ->> 'id' id, e from public.store st,
    jsonb_array_elements(case when jsonb_typeof(st.value) = 'array' then st.value else '[]'::jsonb end) e
  where st.key = 'vift_propertyObjects' and jsonb_typeof(e) = 'object' and coalesce(e ->> 'id', '') <> ''),
blob_prop as (
  select e ->> 'id' id, e from public.store st,
    jsonb_array_elements(case when jsonb_typeof(st.value) = 'array' then st.value else '[]'::jsonb end) e
  where st.key = 'vift_properties' and jsonb_typeof(e) = 'object' and coalesce(e ->> 'id', '') <> ''),
tab_obj as (select distinct on (object_id) object_id id, to_jsonb(t) r from public.property_sensitive_access t
            where object_id is not null order by object_id, updated_at desc),
tab_prop as (select distinct on (property_id) property_id id, to_jsonb(t) r from public.property_sensitive_access t
             where object_id is null and property_id is not null order by property_id, updated_at desc),
/* En rad per (post, fält) med blobvärdet och tabellvärdet (null när tomt). */
par as (
  select 'objekt' typ, coalesce(b.id, t.id) id, f.f,
         nullif(b.e ->> f.f, '') bv, nullif(t.r ->> f.kol, '') tv, b.id is not null i_blob, t.id is not null i_tab
  from blob_obj b full join tab_obj t on t.id = b.id cross join falt f
  union all
  select 'fastighet', coalesce(b.id, t.id), f.f, nullif(b.e ->> f.f, ''), nullif(t.r ->> f.kol, ''), b.id is not null, t.id is not null
  from blob_prop b full join tab_prop t on t.id = b.id cross join falt f),
post as (
  select typ, id,
    case when bool_and(bv is null) and bool_and(tv is null) then 'tomma'
         when bool_and(bv is null) then 'saknas_i_blob'
         when bool_and(tv is null) then 'saknas_i_tabell'
         when bool_and(bv is not distinct from tv) then 'lika'
         else 'olika' end kat,
    bool_or(i_tab) i_tab, bool_or(i_blob) i_blob
  from par group by typ, id),
/* AO- och återkommande ögonblicksbilder: accessCode på posten mot objektets (annars fastighetens)
   rad i tabellen (door_code eller access_code). */
snap as (
  select k.key nyckel, nullif(e ->> 'accessCode', '') kod,
    coalesce(
      (select to_jsonb(t) from public.property_sensitive_access t where t.object_id = nullif(e ->> 'objectId', '') order by t.updated_at desc limit 1),
      (select to_jsonb(t) from public.property_sensitive_access t where t.object_id is null and t.property_id = nullif(e ->> 'propertyId', '') order by t.updated_at desc limit 1)) r
  from (values ('vift_workOrders'), ('vift_recurringOrders')) k(key)
  join public.store st on st.key = k.key,
  jsonb_array_elements(case when jsonb_typeof(st.value) = 'array' then st.value else '[]'::jsonb end) e
  where jsonb_typeof(e) = 'object')
select jsonb_pretty(jsonb_build_object(
  'rapport', 'D-16 jämförelse blob mot property_sensitive_access (bara antal, inga värden, ingen ändring)',
  'objekt', (select jsonb_object_agg(kat, n) from (select kat, count(*) n from post where typ = 'objekt' group by kat) x),
  'fastigheter', (select jsonb_object_agg(kat, n) from (select kat, count(*) n from post where typ = 'fastighet' group by kat) x),
  'tabellrader_utan_post_i_blob', (select count(*) from post where i_tab and not i_blob),
  'tabellrader_totalt', (select count(*) from public.property_sensitive_access),
  'ogonblicksbilder', (select jsonb_object_agg(nyckel, j) from (
     select nyckel, jsonb_build_object(
       'med_kod', count(*) filter (where kod is not null),
       'lika_tabell', count(*) filter (where kod is not null and kod in (r ->> 'door_code', r ->> 'access_code')),
       'olika_tabell', count(*) filter (where kod is not null and r is not null and kod is distinct from (r ->> 'door_code') and kod is distinct from (r ->> 'access_code')),
       'utan_tabellrad', count(*) filter (where kod is not null and r is null)) j
     from snap group by nyckel) y)
)) as d16_rapport;

rollback;
