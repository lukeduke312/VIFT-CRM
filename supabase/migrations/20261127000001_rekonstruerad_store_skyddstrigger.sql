-- ============================================================
-- Rekonstruerad 2026-11-27 från STAGING-schema (pg_get_functiondef/pg_policies), inte historisk SQL.
-- Källa: STAGING yyzljlqyzzcbxmcdbual, läst med SELECT 2026-11-25
-- (supabase/inventering/staging-2026-11-26/schema/ och tests/local/staging-schema-facit-2026-11-25.json).
-- Den SQL som ursprungligen installerade objekten nedan finns inte i någon
-- registrerad migration, i något repo eller i git-historiken (G1/G4, avsnitt 7).
-- Funktionstexterna är exakt pg_get_functiondef() från STAGING; grants och
-- REVOKE motsvarar proacl/pg_policies i drift. Verifieras av
-- tests/local/migrationskedja.sh (jämför md5 av pg_get_functiondef efter körning).
-- ============================================================
-- R-B: skyddstriggern för vift_invoices, vift_workOrders och vift_timeEntries.
-- Funktionen är identisk med STAGING:s backup från 2026-11-17 (md5 e14a0838…), alltså
-- installerad före 2026-11-17; exakt tidpunkt är okänd. Endast rollen postgres får skriva
-- dessa nycklar direkt; allt annat (även service_role via PostgREST) måste gå via RPC.

begin;

-- _protect_critical_store_keys()  (md5 av pg_get_functiondef i drift: e14a08384506c16e95fb977c0d8c389a)
CREATE OR REPLACE FUNCTION public._protect_critical_store_keys()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_protected text[] := array['vift_invoices', 'vift_workOrders', 'vift_timeEntries'];
  v_blocked_key text;
begin
  if tg_op = 'DELETE' then
    if old.key = any(v_protected) then
      v_blocked_key := old.key;
    end if;
  elsif tg_op = 'INSERT' then
    if new.key = any(v_protected) then
      v_blocked_key := new.key;
    end if;
  elsif tg_op = 'UPDATE' then
    -- Skyddar BÅDA riktningarna: en vanlig uppdatering av en redan
    -- skyddad nyckel (new.key = old.key, skyddad) OCH ett nyckelbyte
    -- i NÅGON riktning (in till, eller ut från, en skyddad nyckel).
    if old.key = any(v_protected) then
      v_blocked_key := old.key;
    elsif new.key = any(v_protected) then
      v_blocked_key := new.key;
    end if;
  end if;

  if v_blocked_key is not null and current_user <> 'postgres' then
    raise exception 'direct_write_blocked: nyckeln "%" (operation %) kan endast skrivas/ändras/raderas via en godkänd, atomisk RPC-funktion, inte direkt', v_blocked_key, tg_op;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;
REVOKE ALL ON FUNCTION public._protect_critical_store_keys() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._protect_critical_store_keys() TO PUBLIC, anon, authenticated, service_role;

drop trigger if exists protect_critical_store_keys on public.store;
CREATE TRIGGER protect_critical_store_keys BEFORE INSERT OR DELETE OR UPDATE ON public.store FOR EACH ROW EXECUTE FUNCTION _protect_critical_store_keys();

commit;
