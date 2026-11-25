'use strict';
/*
 * T3-B: genererar supabase/rollback/T3-B/rollback_t3b.sql ur STAGING-facit
 * (tests/local/staging-schema-facit-2026-11-25.json, exakta STAGING-definitioner).
 *
 *   node tests/local/t3b-rollback.js           verifierar att filen är aktuell
 *   node tests/local/t3b-rollback.js --skriv   skriver filen
 *
 * Rollbacken återställer de ersatta funktionerna EXAKT till STAGING-versionen och tar bort
 * de nya. Den rör ingen data (store, op_idempotency, stamp_status) och ingen sekvens:
 * data som skapats efter installationen (t.ex. poolOpen, billingPreviousStatus, addedBy,
 * '_fp' i op_idempotency.result) är additiva fält som den äldre koden ignorerar.
 */
const fs = require('fs');
const path = require('path');
const facit = require('./staging-schema-facit-2026-11-25.json');
const UT = path.resolve(__dirname, '..', '..', 'supabase', 'rollback', 'T3-B', 'rollback_t3b.sql');

const ERSATTA = [
  ['work_order_patch', 'p_ao_id text, p_patch jsonb, p_idempotency_key text, p_expected_updated_at text', 'text,jsonb,text,text'],
  ['time_entry_create', 'p_entry jsonb, p_idempotency_key text, p_client_id text', 'jsonb,text,text'],
  ['time_entry_patch', 'p_entry_id text, p_patch jsonb, p_idempotency_key text, p_expected_updated_at text, p_caller_staff_id text, p_caller_can_manage_others boolean', 'text,jsonb,text,text,text,boolean'],
  ['store_write_stamp_status', 'p_auth_user_id uuid, p_active boolean, p_ts bigint, p_ao_id text, p_expected_revision bigint', 'uuid,boolean,bigint,text,bigint'],
  ['work_order_checklist_set_state', 'p_ao_id text, p_item_id text, p_action text, p_text text, p_description text, p_comment text, p_image text, p_actor_name text, p_caller_staff_id text, p_caller_can_view_all boolean, p_caller_can_edit boolean', 'text,text,text,text,text,text,text,text,text,boolean,boolean'],
  ['work_order_log_append', 'p_ao_id text, p_entry jsonb, p_caller_staff_id text, p_caller_can_view_all boolean', 'text,jsonb,text,boolean'],
  ['work_order_log_remove', 'p_ao_id text, p_entry_id text, p_caller_staff_id text, p_caller_can_view_all boolean, p_caller_can_edit boolean', 'text,text,text,boolean,boolean'],
  ['work_order_create', 'p_ao jsonb, p_idempotency_key text, p_client_id text', 'jsonb,text,text'],
];
const NYA_OVERLAGRINGAR = ['public.work_order_patch(text,jsonb,text,text,text,text[])', 'public.time_entry_create(jsonb,text,text,text,uuid,text[])'];
const NYA = ['public.work_order_pool_take(text,text,text[],text,text)', 'public.work_order_billing_set(text,text,text,text)',
  'public._vift_ao_take(jsonb,text,text,text)', 'public._vift_ao_material_merge(jsonb,jsonb,text,text)', 'public._vift_ao_billing_touched(jsonb,jsonb)',
  'public._vift_idem_lookup(text,text,text)', 'public._vift_staff_name(text)', 'public._vift_staff_active(text)', 'public._vift_auth_staff(uuid)',
  'public._vift_ao_number_text(bigint)', 'public._vift_ao_open_pool(jsonb)', 'public._vift_ao_locked(jsonb)', 'public._vift_ao_assigned(jsonb,text)',
  'public._vift_ao_staff(jsonb)', 'public._vift_ao_eff_perms(text[])', 'public._vift_has(text[],text)'];

function sql() {
  const d = ['-- ============================================================',
    '-- ROLLBACK T3-B (genererad av tests/local/t3b-rollback.js ur STAGING-facit 2026-11-25).',
    '-- Återställer de funktioner som T3-B ersatte EXAKT till STAGING-versionen och tar bort',
    '-- T3-B:s nya funktioner. Rör INGEN data och ingen sekvens (ao_display_number_seq får stå',
    '-- kvar framflyttad: det hindrar dubbletter). Körs i en transaktion. Kör därefter',
    '-- EF-rollbacken (föregående EF-versioner) och klientpaketet enligt T3-RESULTAT.md (T3-B).',
    '-- ============================================================', 'begin;', ''];
  d.push('-- 1. Nya signaturer bort (gamla signaturer återskapas nedan).');
  NYA_OVERLAGRINGAR.forEach((f) => d.push(`drop function if exists ${f};`));
  d.push('', '-- 2. Ersatta funktioner tillbaka till STAGING-definitionen (exakt text ur facit).');
  for (const [namn, args, typer] of ERSATTA) {
    const f = facit.functions.find((x) => x.name === namn && x.args === args);
    if (!f) throw new Error('saknas i facit: ' + namn);
    d.push(`-- ${namn}(${typer})`, f.def.replace(/\s*$/, '') + ';',
      `revoke all on function public.${namn}(${typer}) from public, anon, authenticated;`,
      `grant execute on function public.${namn}(${typer}) to service_role;`, '');
  }
  d.push('-- 3. T3-B:s nya funktioner bort (efter att inget längre anropar dem).');
  NYA.forEach((f) => d.push(`drop function if exists ${f};`));
  d.push('', 'commit;', '');
  return d.join('\n');
}

const s = sql();
if (process.argv.includes('--skriv')) { fs.writeFileSync(UT, s); console.log('Skrev ' + UT); }
else {
  const ok = fs.existsSync(UT) && fs.readFileSync(UT, 'utf8') === s;
  console.log((ok ? 'PASS' : 'FAIL') + ' rollback_t3b.sql är aktuell mot facit');
  if (!ok) process.exitCode = 1;
}
module.exports = { sql, UT };
