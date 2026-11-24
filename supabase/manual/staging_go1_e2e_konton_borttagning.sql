-- Tar bort GO-1:s E2E-testkonton i STAGING (yyzljlqyzzcbxmcdbual). KRÄVER GO.
-- Kör ALDRIG mot LIVE.
--
-- Rekommenderad ordning:
--   1. Supabase Dashboard → Authentication → Users: ta bort de sex
--      e2e-*@viftfast-test.invalid (Auths egen administration).
--   2. Kör sedan detta skript i SQL Editor. Det tar bort personalposterna,
--      testrollen och app_users-raderna, och kontrollerar att befintliga
--      poster är oförändrade.
do $rb$
declare staff_keep text[]; roles_keep text[]; n int;
begin
  select array_agg(md5(e::text) order by o) into staff_keep from public.store s, jsonb_array_elements(s.value) with ordinality x(e,o)
    where s.key='vift_staff' and e->>'id' not like 'ST-E2E-%';
  select array_agg(md5(e::text) order by o) into roles_keep from public.store s, jsonb_array_elements(s.value) with ordinality x(e,o)
    where s.key='vift_roles' and e->>'id' <> 'e2e_begransad';
  update public.store set value = (select coalesce(jsonb_agg(e order by o), '[]'::jsonb) from jsonb_array_elements(value) with ordinality x(e,o) where e->>'id' not like 'ST-E2E-%'), updated_at = now() where key='vift_staff';
  update public.store set value = (select coalesce(jsonb_agg(e order by o), '[]'::jsonb) from jsonb_array_elements(value) with ordinality x(e,o) where e->>'id' <> 'e2e_begransad'), updated_at = now() where key='vift_roles';
  delete from public.app_users where staff_id like 'ST-E2E-%';
  if (select array_agg(md5(e::text) order by o) from public.store s, jsonb_array_elements(s.value) with ordinality x(e,o) where s.key='vift_staff') is distinct from staff_keep then raise exception 'befintlig personal påverkad'; end if;
  if (select array_agg(md5(e::text) order by o) from public.store s, jsonb_array_elements(s.value) with ordinality x(e,o) where s.key='vift_roles') is distinct from roles_keep then raise exception 'befintliga roller påverkade'; end if;
  select count(*) into n from auth.users where email like 'e2e-%@viftfast-test.invalid';
  if n > 0 then raise notice '% e2e-konton finns kvar i Auth — ta bort dem i Dashboard (steg 1).', n; end if;
end
$rb$;
