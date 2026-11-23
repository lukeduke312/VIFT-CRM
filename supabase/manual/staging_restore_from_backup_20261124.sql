-- =====================================================================
-- VIFT CRM — STAGING: återställning från vift_staging_backup_20261124
-- Körs i SQL Editor (som postgres) för STAGING. ALDRIG mot LIVE.
-- KRÄVER UTTRYCKLIGT GO. Varje del kan köras för sig.
--
-- Referens (bara läsning, verifierad före installation):
--   store 40 nycklar, summa dc85f35f332e4151e606c89226c16964
--   op_idempotency 2146 rader, summa ac6f2cd259496b09b4eca85656513cc9
--   function_definitions 50, summa 9d8e76769dd308dddb432b8f09533a99
--   (summorna beräknas som i tools/staging-backup-export.js, del "summary")
-- Skyddstriggrarna på store släpper igenom postgres, så återställningen
-- går igenom även för vift_workOrders/vift_timeEntries/vift_invoices.
-- =====================================================================

-- ── R0. Kontroll före (bara läsning): vad skiljer sig mot backupen? ──
select coalesce(s.key, b.key) as key,
       case when s.key is null then 'saknas i live' when b.key is null then 'tillkommen efter backup' else 'ändrad' end as skillnad
  from public.store s full join vift_staging_backup_20261124.store b using (key)
 where s.value is distinct from b.value
 order by 1;

-- ── R1. store: återställ alla 40 nycklar till backupens innehåll ──────
-- begin;
-- insert into public.store(key, value, updated_at)
--   select key, value, updated_at from vift_staging_backup_20261124.store
--   on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;
-- insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
--   on conflict (key) do update set value = excluded.value, updated_at = now();
-- commit;
-- (vift_lastChanged sätts till nu, så att alla klienter hämtar om datan.)

-- ── R2. op_idempotency: lägg tillbaka saknade rader ──────────────────
-- insert into public.op_idempotency(fn_name, idem_key, result, created_at)
--   select fn_name, idem_key, result, created_at from vift_staging_backup_20261124.op_idempotency
--   on conflict do nothing;

-- ── R3. Funktioner: återskapa alla 50 definitioner ───────────────────
-- do $$ declare r record; begin
--   for r in select definition from vift_staging_backup_20261124.function_definitions loop
--     execute r.definition;
--   end loop;
-- end $$;
-- Funktioner som skapats av GO-5–GO-8 tas bort enligt respektive steg:
--   drop function if exists public.work_order_checklist_set_state(text,text,text,text,text,text,text,text,text,boolean,boolean);
--   drop function if exists public.activity_log_append(jsonb, int);
--   drop function if exists public.work_order_log_append(text,jsonb,text,boolean);
--   drop function if exists public.work_order_log_remove(text,text,text,boolean,boolean);
--   drop function if exists public.offer_attachment_patch(text, jsonb);
--   (project_documents_* och bucket-policyer: se installationsplanen §2b/§2k)

-- ── R4. Edge Functions ───────────────────────────────────────────────
-- Installerade källor före installation: supabase/backup/staging-ef-fore-installation/
-- (store-key-write v3, work-order-checklist-resolve v1, offer-attachment-upload v12).
-- Nya EF:er (work-order-log-write, offer-public-pdf, work-order-image-*,
-- project-document-*) tas bort i Dashboard → Edge Functions.

-- ── R5. Efterkontroll (bara läsning): ska ge 0 rader ─────────────────
-- select key from public.store s join vift_staging_backup_20261124.store b using (key)
--  where s.value is distinct from b.value and key <> 'vift_lastChanged';
