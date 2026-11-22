#!/usr/bin/env bash
# Mäter WAL-bytes per skrivning mot en LOKAL PostgreSQL (aldrig STAGING/LIVE).
# Modellerar public.store (key text pk, value jsonb) och de skrivmönster
# klienten använder: hela JSONB-raden skrivs om när ett element ändras
# (store-key-write merge, work_order_patch). Syntetiska men varierade data.
# Kör: bash tests/perf/wal_per_write.sh   (kräver lokal psql/postgres)
set -euo pipefail
DB=vift_walperf_$$
psql -d postgres -qAt -c "create database $DB" >/dev/null
trap 'psql -d postgres -qAt -c "drop database if exists $DB" >/dev/null' EXIT
q() { psql -d "$DB" -qAt -v ON_ERROR_STOP=1 -c "$1"; }

q "create extension if not exists pgcrypto;
   create table store(key text primary key, value jsonb not null, updated_at timestamptz default now());
   create table activity_log_rows(id text primary key, ts timestamptz, payload jsonb);
   alter table store set (fillfactor=100);"

# Realistiska element: varierad text (md5) så TOAST-komprimeringen inte blir orimligt bra.
q "insert into store values ('vift_activityLog', (select jsonb_agg(jsonb_build_object(
     'id','ACT-'||(1793600000000+g)||'-'||substr(md5(g::text),1,8),'type',(array['work_order_updated','time_entry_created','customer_updated','staff_assigned'])[1+g%4],
     'description','Arbetsorder AO-'||(1000+g%300)||' redigerad: '||md5(random()::text),'timestamp',now()-(g||' min')::interval,
     'customerId','CUS-'||(g%300),'workOrderId','AO-'||(1000+g%300),'userId','ST-'||(g%12),'propertyId','','offerId','','invoiceId','')) from generate_series(1,500) g))"
q "insert into store values ('vift_customers', (select jsonb_agg(jsonb_build_object(
     'id','CUS-'||g,'name','Kund '||md5(g::text),'email',substr(md5(random()::text),1,10)||'@example.test','phone','070'||(1000000+g),
     'address',md5(random()::text),'zip','41'||(100+g%800),'city','Göteborg','orgNr',(5560000000+g)::text,'notes',md5(random()::text)||md5(random()::text),
     'createdAt',now())) from generate_series(1,300) g))"
mkao() { # $1 = extra json for AO-1000 (bilder)
q "insert into store values ('vift_workOrders', (select jsonb_agg(jsonb_build_object(
     'id','AO-'||(1000+g),'title','Uppdrag '||md5(g::text),'status',(array['pool','planerad','pagar','klar'])[1+g%4],'customerId','CUS-'||(g%300),
     'description',md5(random()::text)||md5(random()::text)||md5(random()::text),
     'log',(select jsonb_agg(jsonb_build_object('id','L'||g||'-'||k,'text',md5(random()::text),'timestamp',now(),'userName','Ann A')) from generate_series(1,6) k)
        || case when g=0 then $1 else '[]'::jsonb end,
     'checklist',(select jsonb_agg(jsonb_build_object('id','C'||k,'text','Kontrollpunkt '||k,'done',k%2=0)) from generate_series(1,8) k),
     'materials',(select jsonb_agg(jsonb_build_object('id','M'||k,'name','Artikel '||md5(k::text),'qty',k,'price',99.5)) from generate_series(1,3) k))) from generate_series(0,299) g))
   on conflict (key) do update set value=excluded.value"
}
# 3 inbäddade mobilfoton à ~1.5 MB base64 (slumpbytes — komprimeras inte bort)
IMG="(select jsonb_agg(jsonb_build_object('id','P'||k,'type','photo','imageData','data:image/jpeg;base64,'||(select string_agg(encode(gen_random_bytes(1024),'base64'),'') from generate_series(1,1100)))) from generate_series(1,3) k)"

lsn() { q "select pg_current_wal_lsn()"; }
walrun() { # $1 label, $2 sql, $3 n
  q "checkpoint" >/dev/null
  local a b; a=$(lsn); for i in $(seq 1 "$3"); do q "$2" >/dev/null; done; b=$(lsn)
  local bytes; bytes=$(q "select pg_wal_lsn_diff('$b','$a')")
  printf "%-62s %10.1f kB/skrivning  (rad: %s)\n" "$1" "$(echo "$bytes / $3 / 1024" | bc -l)" "$4"
}
rowsize() { q "select pg_size_pretty(pg_column_size(value)::bigint) from store where key='$1'"; }

echo "== WAL per skrivning, lokal PostgreSQL $(q 'show server_version') (full_page_writes=$(q 'show full_page_writes')) =="
walrun "activityLog: +1 post, -1 äldsta (merge skriver om raden)" \
  "update store set value = jsonb_build_array(jsonb_build_object('id','ACT-'||clock_timestamp(),'type','work_order_updated','description',md5(random()::text),'timestamp',now())) || (value - (jsonb_array_length(value)-1)) where key='vift_activityLog'" 20 "$(rowsize vift_activityLog)"
walrun "alternativ: activityLog som egen rad per händelse (INSERT)" \
  "insert into activity_log_rows values ('ACT-'||clock_timestamp()||random(), now(), jsonb_build_object('type','work_order_updated','description',md5(random()::text)))" 20 "-"
walrun "customers: ändra en kunds telefonnr (merge skriver om raden)" \
  "update store set value = jsonb_set(value, '{17,phone}', to_jsonb('0709'||floor(random()*1000000)::text)) where key='vift_customers'" 20 "$(rowsize vift_customers)"
mkao "'[]'::jsonb"
walrun "workOrders utan inbäddade bilder: patch av en AO:s titel" \
  "update store set value = jsonb_set(value, '{42,title}', to_jsonb(md5(random()::text))) where key='vift_workOrders'" 20 "$(rowsize vift_workOrders)"
mkao "$IMG"
walrun "workOrders MED 3 inbäddade foton i en AO: patch av en annan AO" \
  "update store set value = jsonb_set(value, '{42,title}', to_jsonb(md5(random()::text))) where key='vift_workOrders'" 5 "$(rowsize vift_workOrders)"
