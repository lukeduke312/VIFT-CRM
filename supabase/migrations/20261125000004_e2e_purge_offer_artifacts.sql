-- STAGING-TESTVERKTYG (2026-11-25): städning av testoffertens bilagor och händelser.
-- Används ENDAST av Edge Function e2e-test-cleanup (service role, kräver 'all',
-- vägrar utanför STAGING-projektet). Får ALDRIG installeras i LIVE.
-- Skydd: offerten måste finnas och ha en titel som börjar med "[E2E-TEST]";
-- annars avbryts anropet utan ändring. Radlås på de berörda nycklarna.
-- Återställning: DROP FUNCTION public.e2e_purge_offer_artifacts(text);

create or replace function public.e2e_purge_offer_artifacts(p_offer_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_title text;
  v_paths text[];
  v_att int;
  v_evt int;
begin
  select e->>'title' into v_title
  from public.store s, jsonb_array_elements(s.value) e
  where s.key = 'vift_offers' and e->>'id' = p_offer_id;
  if v_title is null or v_title not like '[E2E-TEST]%' then
    raise exception 'not_test_offer';
  end if;

  perform 1 from public.store where key in ('vift_offerAttachments', 'vift_offerEvents') for update;

  select coalesce(array_agg(e->>'storagePath'), '{}'), count(*)
    into v_paths, v_att
  from public.store s, jsonb_array_elements(s.value) e
  where s.key = 'vift_offerAttachments' and e->>'offerId' = p_offer_id;

  select count(*) into v_evt
  from public.store s, jsonb_array_elements(s.value) e
  where s.key = 'vift_offerEvents' and e->>'offerId' = p_offer_id;

  update public.store
     set value = (select coalesce(jsonb_agg(e order by o), '[]'::jsonb)
                  from jsonb_array_elements(value) with ordinality x(e, o)
                  where e->>'offerId' is distinct from p_offer_id),
         updated_at = now()
   where key in ('vift_offerAttachments', 'vift_offerEvents')
     and jsonb_typeof(value) = 'array';

  return jsonb_build_object('offerId', p_offer_id, 'attachments', v_att, 'events', v_evt, 'storagePaths', to_jsonb(v_paths));
end;
$$;

revoke all on function public.e2e_purge_offer_artifacts(text) from public, anon, authenticated;
grant execute on function public.e2e_purge_offer_artifacts(text) to service_role;
