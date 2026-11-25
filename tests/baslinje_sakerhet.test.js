'use strict';
/*
 * T3-0: BASLINJE-tester. De bevisar verkliga säkerhetsbrister i OFÖRÄNDRAD serverkod
 * (supabase/functions + migrationskedjan) mot den lokala STAGING-replikan.
 *
 * HISTORISK REFERENS sedan T3-B (2026-11-28): testet körs mot serverkällan i commit
 * BASLINJE_COMMIT (fb71f26, = installerad STAGING-kod, före T3-B), utläst med `git archive`
 * till en temporär katalog. Den rättade koden prövas i tests/t3b_ao_karna.test.js, där
 * raderna SÄK-3, -4, -5, -11, -12, -15, -16 är vända till godkända säkerhetstester.
 * Rader som rättas av senare paket (SÄK-2, -8, -13, GRANTS) bevisas här tills dess. Varje rad märkt
 * "BASLINJE SÄK-n" är GODKÄND när bristen syns (anropet godtas och muterar, eller data
 * lämnas ut, trots att den fastställda regeln i BEHORIGHETSMATRIS säger avslag).
 *
 * När T3-B–T3-D rättar en brist ska motsvarande rad VÄNDAS till ett godkänt säkerhetstest
 * (rätt status + error + reason + oförändrad KS, via kontroll.expectReject) — inte tas bort.
 * Sätt BASLINJE_RAPPORT=<fil> för en maskinläsbar rapport.
 *
 * Lokalt verifierat (PostgreSQL 16, EF i Node). Inget är prövat i STAGING.
 */
const fs = require('fs');
const { ok, krav, avsluta } = require('./local/lib/test');
krav({ tsc: true });
const { byggReplik } = require('./local/lib/replik');
const { laddaEf } = require('./local/lib/ef');
const { val, q, psql, asUser, rpc, lit, jlit } = require('./local/lib/db');
const { expectBaslinje, ksTa, ksDiff } = require('./local/lib/kontroll');

const EF = ['ao-time-write', 'work-orders-list', 'store-key-write', 'work-order-checklist-resolve', 'work-order-log-write'];

/* Historisk källa: STAGING-ekvivalent serverkod före T3-B. */
const BASLINJE_COMMIT = 'fb71f26';
const { execFileSync } = require('child_process');
const os = require('os');
const pathM = require('path');
const HIST = fs.mkdtempSync(pathM.join(os.tmpdir(), 'vift-baslinje-'));
process.on('exit', () => { try { fs.rmSync(HIST, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
try {
  const tar = execFileSync('git', ['-C', pathM.join(__dirname, '..'), 'archive', BASLINJE_COMMIT, 'supabase'], { maxBuffer: 512 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', HIST], { input: tar });
} catch (e) { ok(false, 'historisk källa ' + BASLINJE_COMMIT + ' kunde inte läsas ut (git archive): ' + e.message); avsluta(); }
process.env.VIFT_SERVER_ROOT = pathM.join(HIST, 'supabase');
const rapport = [];
const B = (sak, beskrivning, bevisad, fakta, rattas) => {
  rapport.push({ sak, beskrivning, bevisad: !!bevisad, fakta, rattasI: rattas });
  ok(bevisad, 'BASLINJE ' + sak + ': ' + beskrivning, bevisad ? '' : fakta);
};

(async () => {
  const r = byggReplik({});
  const { db, U } = r;
  ok(r.rapport.oforklarade === 0 && !r.steg.some((x) => x.ny), 'replikan (historisk källa ' + BASLINJE_COMMIT + ') = STAGING-facit (0 oförklarade, inga T3-migrationer) — baslinjen gäller den installerade koden');
  const ef = await laddaEf(db, EF, { root: process.env.VIFT_SERVER_ROOT });
  const aoById = (id) => (val(db, 'vift_workOrders') || []).find((a) => a.id === id);
  const restore = (key, v) => psql(db, `update public.store set value = ${jlit(v)} where key = ${lit(key)}`); // som postgres (testfixtur)
  const KS_AO = { keys: ['vift_workOrders', 'vift_timeEntries'], tables: ['op_idempotency', 'stamp_status'] };
  const ursprung = val(db, 'vift_workOrders');

  // ── SÄK-3 och SÄK-16: poolläckan i work-orders-list ─────────────────────
  let s = await ef.anropa('work-orders-list', { user: U.falt });
  const ids = (s.body.workOrders || []).map((a) => a.id);
  B('SÄK-3', 'work-orders-list lämnar ut pool-AO med annans personal (P2, P3) till fält med ao_view_own', ids.includes('AO-P2') && ids.includes('AO-P3'), ids, 'T3-B (SEC-POOL-02: P2/P3 ska inte synas)');
  B('SÄK-16', 'work-orders-list lämnar ut arkiverad (P5) och borttagen (P6) pool-AO', ids.includes('AO-P5') && ids.includes('AO-P6'), ids, 'T3-B (SEC-POOL-02)');
  const p1 = (s.body.workOrders || []).find((a) => a.id === 'AO-P1') || {};
  B('SÄK-3', 'poolposten P1 lämnas ut med kontaktuppgifter, logg, material och priser (ingen poolprojektion, K-03/D-13)', !!(p1.phone && p1.contactEmail && p1.log && p1.log.length && p1.materials && p1.materials[0].buyPrice !== undefined && p1.fixedPrice), Object.keys(p1), 'T3-B/T4-A (SEC-POOL-04, SEC-AO-18)');
  s = await ef.anropa('work-orders-list', { user: U.begransad });
  B('SÄK-3', 'begränsad roll (bara ao_view_own) ser öppen pool', (s.body.workOrders || []).some((a) => a.status === 'pool'), (s.body.workOrders || []).map((a) => a.id), 'T3-B (SEC-POOL-03, ao_pool_take)');

  // SQL-funktionerna har samma poolregel: checklista och logg på P2 (pool med FÄ2) som FÄ.
  let b = await expectBaslinje(db, () => ef.anropa('work-order-checklist-resolve', { user: U.falt, body: { aoId: 'AO-P2', itemId: 'AO-P2-C1', action: 'done' } }), '', KS_AO, ({ svar, andrat }) => svar.status === 200 && andrat.includes('store:vift_workOrders'));
  B('SÄK-3', 'checklista: fält kan klarmarkera punkt på pool-AO med annans personal (P2) — muterar', b.ok, [b.svar.status, b.svar.body, b.andrat], 'T3-B (SEC-POOL-12: 403 not_assigned)');
  b = await expectBaslinje(db, () => ef.anropa('work-order-log-write', { user: U.falt, body: { action: 'append_log', aoId: 'AO-P1', entry: { id: 'BL-LOG-1', type: 'note', text: 'före tagning' } } }), '', KS_AO, ({ svar, andrat }) => svar.status === 200 && andrat.includes('store:vift_workOrders'));
  B('SÄK-3', 'logg: fält kan skriva loggpost på öppen pool-AO (P1) före tagning — muterar', b.ok, [b.svar.status, b.svar.body], 'T3-B (SEC-POOL-11)');
  restore('vift_workOrders', ursprung);

  // ── SÄK-4: "Ta jobbet" ─────────────────────────────────────────────────
  const taPatch = (aoId, staffId) => { const a = aoById(aoId); return { staff: (a.staff || []).concat([staffId]), status: 'planerad', log: (a.log || []).concat([{ id: 'TAKE-' + staffId + '-' + aoId, type: 'taken_from_pool', text: 'Tog jobbet', timestamp: new Date().toISOString() }]) }; };
  b = await expectBaslinje(db, () => ef.anropa('ao-time-write', { user: U.falt, body: { action: 'patch_ao', aoId: 'AO-P2', idempotencyKey: 'bl-take-p2', patch: taPatch('AO-P2', U.falt.staffId) } }), '', KS_AO, ({ svar, andrat }) => svar.status === 200 && andrat.includes('store:vift_workOrders'));
  B('SÄK-4', '"Ta jobbet" på pool-AO som redan har personal (P2) godtas (200), FÄ läggs till', b.ok && aoById('AO-P2').staff.includes(U.falt.staffId), [b.svar.status, aoById('AO-P2').staff], 'T3-B (SEC-POOL-06: 409 already_assigned)');
  restore('vift_workOrders', ursprung);
  // Samtidig tagning av P1: båda hinner läsa (status pool) före skrivning → båda godtas.
  const bar = ef.barriar('work_order_patch', 2);
  const [t1, t2] = await Promise.all([
    ef.anropa('ao-time-write', { user: U.falt, body: { action: 'patch_ao', aoId: 'AO-P1', idempotencyKey: 'bl-par-1', patch: taPatch('AO-P1', U.falt.staffId) } }),
    ef.anropa('ao-time-write', { user: U.falt2, body: { action: 'patch_ao', aoId: 'AO-P1', idempotencyKey: 'bl-par-2', patch: taPatch('AO-P1', U.falt2.staffId) } }),
  ]);
  B('SÄK-4', 'samtidig tagning av P1 (FÄ + FÄ2): båda får 200 — kontrollen görs i EF utan lås och utan expectedUpdatedAt', t1.status === 200 && t2.status === 200 && bar.kvar === 0, [t1.status, t2.status, aoById('AO-P1').staff], 'T3-B (SEC-POOL-09: exakt en 200 + en 409 already_assigned, under radlås i RPC)');
  B('SÄK-4', 'samtidig tagning: slutläget har bara EN person men BÅDA fick bekräftelse (förlorad uppdatering)', aoById('AO-P1').staff.length === 1, aoById('AO-P1').staff, 'T3-B');
  restore('vift_workOrders', ursprung);
  // RPC:n själv saknar regelkontroll: work_order_patch accepterar tagning av en AO som inte är pool.
  let rr = rpc(db, 'work_order_patch', { p_ao_id: 'AO-A8', p_patch: { staff: [U.falt2.staffId, U.falt.staffId] }, p_idempotency_key: 'bl-rpc-1', p_expected_updated_at: null });
  B('SÄK-4', 'work_order_patch (RPC) kontrollerar varken status, tilldelning eller fält — bara existens/idempotens/updatedAt', !rr.error && aoById('AO-A8').staff.length === 2, rr.error || aoById('AO-A8').staff, 'T3-B (regelkontroll under lås i RPC)');
  restore('vift_workOrders', ursprung);

  // ── SÄK-5: ao_complete utan ao_edit klarmarkerar fakturerad/ej tilldelad AO ──
  b = await expectBaslinje(db, () => ef.anropa('ao-time-write', { user: U.falt, body: { action: 'patch_ao', aoId: 'AO-A4', idempotencyKey: 'bl-sak5-1', patch: { status: 'klar' } } }), '', KS_AO, ({ svar, andrat }) => svar.status === 200 && andrat.includes('store:vift_workOrders'));
  B('SÄK-5', 'fält med ao_complete kan klarmarkera FAKTURERAD AO som hen inte är tilldelad (AO-A4, FÄ2) → muterar', b.ok && aoById('AO-A4').status === 'klar', [b.svar.status, aoById('AO-A4').status], 'T3-B (SEC-AO-05/06: 403 not_assigned / 409 ao_locked)');
  restore('vift_workOrders', ursprung);
  b = await expectBaslinje(db, () => ef.anropa('ao-time-write', { user: U.falt, body: { action: 'patch_ao', aoId: 'AO-A8', idempotencyKey: 'bl-sak5-2', patch: { status: 'klar', completedBy: U.falt2.staffId, completedAt: '2000-01-01T00:00:00.000Z' } } }), '', KS_AO, ({ svar }) => svar.status === 200);
  const a8 = aoById('AO-A8');
  B('SÄK-5', 'fält kan klarmarkera annans AO (AO-A8) och sätta completedBy/completedAt fritt (ingen ignoredFields)', b.ok && a8.status === 'klar' && a8.completedBy === U.falt2.staffId && a8.completedAt.startsWith('2000'), [b.svar.status, a8.status, a8.completedBy, a8.completedAt], 'T3-B (SEC-AO-05, SEC-AO-08)');
  restore('vift_workOrders', ursprung);
  b = await expectBaslinje(db, () => ef.anropa('ao-time-write', { user: U.falt, body: { action: 'patch_ao', aoId: 'AO-A5', idempotencyKey: 'bl-sak5-3', patch: { status: 'klar' } } }), '', KS_AO, ({ svar }) => svar.status === 200);
  B('SÄK-5', 'fält kan klarmarkera AVBRUTEN AO (AO-A5) — ingen kontroll av källstatus', b.ok && aoById('AO-A5').status === 'klar', [b.svar.status], 'T3-B (SEC-AO-07: 409 ao_locked)');
  restore('vift_workOrders', ursprung);

  // ── SÄK-15: ao_edit sätter fakturerad/invoiceId via patch_ao ───────────
  b = await expectBaslinje(db, () => ef.anropa('ao-time-write', { user: U.chef, body: { action: 'patch_ao', aoId: 'AO-A1', idempotencyKey: 'bl-sak15', patch: { status: 'fakturerad', invoiceId: 'INV-FALSK' } } }), '', KS_AO, ({ svar }) => svar.status === 200);
  B('SÄK-15', 'arbetsledare (ao_edit) sätter status fakturerad + invoiceId via generell patch_ao (kringgår fakturaflödet)', b.ok && aoById('AO-A1').status === 'fakturerad' && aoById('AO-A1').invoiceId === 'INV-FALSK', [b.svar.status, aoById('AO-A1').status], 'T3-B (SEC-AO-15: 403 forbidden/invoice_path_required)');
  restore('vift_workOrders', ursprung);

  // ── SÄK-12: idempotensnyckel återanvänd med annan payload ──────────────
  rr = rpc(db, 'work_order_patch', { p_ao_id: 'AO-A1', p_patch: { title: 'Första' }, p_idempotency_key: 'bl-sak12', p_expected_updated_at: null });
  const rr2 = rpc(db, 'work_order_patch', { p_ao_id: 'AO-A1', p_patch: { title: 'Annan patch' }, p_idempotency_key: 'bl-sak12', p_expected_updated_at: null });
  B('SÄK-12', 'work_order_patch: samma idempotensnyckel med ANNAN patch godtas tyst (sparat svar returneras, inget 409)', !rr.error && !rr2.error && aoById('AO-A1').title === 'Första', [rr.error, rr2.error, aoById('AO-A1').title], 'T3-B (SEC-AO-20: 409 idempotency_key_conflict)');
  s = await ef.anropa('ao-time-write', { user: U.chef, body: { action: 'patch_ao', aoId: 'AO-A1', idempotencyKey: 'bl-sak12', patch: { title: 'Tredje' } } });
  B('SÄK-12', 'samma brist via ao-time-write: 200 i stället för 409', s.status === 200 && aoById('AO-A1').title === 'Första', [s.status, s.body.error], 'T3-B');
  restore('vift_workOrders', ursprung);

  // ── SÄK-11: tid och stämpling utan tilldelningskontroll (F16/F23) ───────
  const KS_T = { keys: ['vift_workOrders', 'vift_timeEntries'], tables: ['stamp_status'] };
  b = await expectBaslinje(db, () => ef.anropa('ao-time-write', { user: U.falt, body: { action: 'create_time', idempotencyKey: 'bl-sak11-1', entry: { id: 'TE-BL-1', aoId: 'AO-A8', date: '2026-11-24', hours: 8, hourRate: 9999 } } }), '', KS_T, ({ svar, andrat }) => svar.status === 200 && andrat.includes('store:vift_timeEntries'));
  const teBl = (val(db, 'vift_timeEntries') || []).find((t) => t.id === 'TE-BL-1');
  B('SÄK-11', 'create_time på AO där fältet inte är tilldelad (AO-A8) godtas och länkas in i målets timeEntries', b.ok && aoById('AO-A8').timeEntries.includes('TE-BL-1'), [b.svar.status], 'T3-B (SEC-POOL-12/SEC-TID: 403 not_assigned)');
  B('SÄK-11', 'create_time tar hourRate från klienten (9999 sparas) — pris ska vara serverägt (D-11)', !!teBl && teBl.hourRate === 9999, teBl, 'T4-B (ignoredFields/serverpris)');
  b = await expectBaslinje(db, () => ef.anropa('ao-time-write', { user: U.falt, body: { action: 'create_time', idempotencyKey: 'bl-sak11-2', entry: { id: 'TE-BL-2', aoId: 'AO-A4', date: '2026-11-24', hours: 1 } } }), '', KS_T, ({ svar }) => svar.status === 200);
  B('SÄK-11', 'create_time på FAKTURERAD AO (AO-A4) godtas', b.ok, [b.svar.status], 'T3-B (409 ao_locked)');
  b = await expectBaslinje(db, () => ef.anropa('store-key-write', { user: U.falt, body: { action: 'setStampStatus', active: true, ts: 1764000000000, aoId: 'AO-A8', expectedRevision: 0 } }), '', KS_T, ({ svar, andrat }) => svar.status === 200 && andrat.includes('tabell:stamp_status'));
  B('SÄK-11', 'setStampStatus (instämpling) på ej tilldelad AO (AO-A8) godtas — kräver bara ao_time', b.ok, [b.svar.status, b.svar.body], 'T3-B (AP-B: 403 not_assigned)');
  b = await expectBaslinje(db, () => ef.anropa('store-key-write', { user: U.falt2, body: { action: 'setStampStatus', active: true, ts: 1764000000000, aoId: 'AO-FINNS-INTE', expectedRevision: 0 } }), '', KS_T, ({ svar }) => svar.status === 200);
  B('SÄK-11', 'setStampStatus godtar ett aoId som inte finns', b.ok, [b.svar.status], 'T3-B');

  // ── SÄK-13: direkta REST-skrivningar utan affärsregel (F18) ─────────────
  let fore = ksTa(db, { keys: ['vift_lastChanged', 'vift_okandNyckel'] });
  let rest = asUser(db, U.begransad, `insert into public.store(key, value) values ('vift_okandNyckel', '{"godtycklig": true}'::jsonb)`);
  B('SÄK-13', 'REST: begränsad användare skapar en okänd store-nyckel direkt (store_active_write_safe)', rest.ok && rest.count === 1, rest, 'T3-C (SEC-REST-01/02: 42501)');
  rest = asUser(db, U.begransad, `update public.store set value = '"2000-01-01T00:00:00.000Z"'::jsonb where key = 'vift_lastChanged'`);
  B('SÄK-13', 'REST: begränsad användare skriver vift_lastChanged direkt (styr alla klienters synk)', rest.ok && rest.count === 1 && val(db, 'vift_lastChanged') === '2000-01-01T00:00:00.000Z', rest, 'T3-C');
  ok(ksDiff(fore, ksTa(db, { keys: ['vift_lastChanged', 'vift_okandNyckel'] })).length === 2, 'kontroll: KS visar just de två direkta ändringarna');
  rest = asUser(db, U.begransad, `delete from public.store where key = 'vift_okandNyckel'`);
  B('SÄK-13', 'REST: begränsad användare kan också radera en sådan nyckel', rest.ok && rest.count === 1, rest, 'T3-C');
  rest = asUser(db, U.begransad, `update public.store set value = '[]'::jsonb where key = 'vift_customers'`);
  ok(rest.ok && rest.count === 0, 'kontroll (redan skyddat): REST-uppdatering av affärsnyckel vift_customers påverkar 0 rader (RESTRICTIVE-policy)');

  // ── SÄK-2: uppgifter och aktivitetslogg utan urval per post ────────────
  s = await ef.anropa('store-key-write', { user: U.falt, body: { action: 'readAllWithHashes', keys: ['vift_activities', 'vift_activityLog'] } });
  const tasks = (s.body.data && s.body.data.activities) || [];
  B('SÄK-2', 'readAllWithHashes: fält får andras uppgifter (TASK-R2 till FÄ2, TASK-R3 chefens egen)', tasks.some((t) => t.id === 'TASK-R2') && tasks.some((t) => t.id === 'TASK-R3'), tasks.map((t) => t.id), 'T3-D (D-15, SEC-TASK)');
  B('SÄK-2', 'readAllWithHashes: fält får hela aktivitetsloggen, även poster om andras AO (LOG-R2/AO-A8)', ((s.body.data && s.body.data.activityLog) || []).some((l) => l.refId === 'AO-A8'), null, 'T3-D (D-14, SEC-B4)');
  rest = asUser(db, U.falt, `select value from public.store where key = 'vift_activities'`);
  B('SÄK-2', 'REST: fält läser vift_activities direkt med alla poster (store_read_by_role släpper nyckeln)', rest.ok && rest.rows.length === 1 && rest.rows[0].value.length === 3, rest.rows, 'T3-D');

  // ── SÄK-8: eskalering via staff_manage och skydd för sista superadmin ──
  const staffNu = () => val(db, 'vift_staff');
  const merge = async (user, el, nytt) => ef.anropa('store-key-write', { user, body: { action: 'writeMerge', key: 'vift_staff', upserts: [{ id: el.id, data: Object.assign({}, el, nytt), previous: el }], removals: [] } });
  const ursprStaff = staffNu();
  b = await expectBaslinje(db, () => merge(U.personalansvarig, staffNu().find((x) => x.id === U.personalansvarig.staffId), { role: 'admin' }), '', { keys: ['vift_staff'] }, ({ svar, andrat }) => svar.status === 200 && andrat.includes('store:vift_staff'));
  B('SÄK-8', 'egen roll med bara staff_manage ger sig själv rollen admin (writeMerge vift_staff) → 200', b.ok && staffNu().find((x) => x.id === U.personalansvarig.staffId).role === 'admin', [b.svar.status, b.svar.body], 'T3-C (SEC-ROLL-01: 403 privilege_escalation)');
  s = await ef.anropa('work-orders-list', { user: U.personalansvarig });
  B('SÄK-8', '… och får därefter alla AO (behörigheten all är verksam direkt)', s.status === 200 && s.body.workOrders.length === ursprung.length, s.body.workOrders && s.body.workOrders.length, 'T3-C');
  restore('vift_staff', ursprStaff);
  b = await expectBaslinje(db, () => merge(U.admin, staffNu().find((x) => x.id === U.admin.staffId), { role: 'chef' }), '', { keys: ['vift_staff'] }, ({ svar }) => svar.status === 200);
  const antalAll = staffNu().filter((x) => x.active && x.role === 'admin').length;
  B('SÄK-8', 'den enda superadministratören kan ta bort sin egen all-roll → 0 aktiva med all (inget skydd för sista superadmin)', b.ok && antalAll === 0, [b.svar.status, antalAll], 'T3-C (D-25: 409 last_superadmin)');
  restore('vift_staff', ursprStaff);

  // ── Grants utan R-E (20261127000004) ───────────────────────────────────
  ok(q(db, `select 1 from pg_proc where proname = 'provision_vift_user' and has_function_privilege('anon', oid, 'execute')`).length === 0, 'kontroll: MED R-E (repots kedja) saknar anon EXECUTE på provision_vift_user');
  const utanRE = byggReplik({ utelamna: ['migrations/20261127000004_rekonstruerad_grants_och_store_policy.sql'] });
  try {
    const fn = (n) => q(utanRE.db, `select has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth from pg_proc p where p.proname = ${lit(n)}`)[0];
    const g = ['provision_vift_user', 'deactivate_vift_user', 'check_app_users_health'].map((n) => [n, fn(n)]);
    B('GRANTS', 'utan R-E får anon och authenticated EXECUTE på provision_vift_user, deactivate_vift_user och check_app_users_health (SECURITY DEFINER)', g.every(([, x]) => x && x.anon && x.auth), g, 'R-E finns i repot; måste installeras (MIG-1-underlaget)');
    B('GRANTS', 'utan R-E: schemajämförelsen mot STAGING visar oförklarade avvikelser (ACL)', utanRE.rapport.oforklarade > 0, utanRE.rapport.oforklarade, '–');
    const anrop = asUser(utanRE.db, null, `select public.provision_vift_user(${lit(U.avstangd.authId)}::uuid, ${lit(U.avstangd.staffId)}, 'admin', true) as r`);
    const ny = q(utanRE.db, `select active, is_admin, role_id from public.app_users where user_id = ${lit(U.avstangd.authId)}`)[0];
    B('GRANTS', 'utan R-E: ANONYM (ingen inloggning) kan återaktivera en avstängd användare som admin via provision_vift_user', anrop.ok && ny.active === true && ny.is_admin === true, [anrop, ny], 'R-E (installeras med T3-paketet)');
    const efU = await laddaEf(utanRE.db, ['work-orders-list'], { root: process.env.VIFT_SERVER_ROOT });
    s = await efU.anropa('work-orders-list', { user: U.avstangd });
    B('GRANTS', '… och den avstängda användaren kommer därefter åt AO-listan (200)', s.status === 200, s.status, 'R-E');
  } finally { utanRE.stang(); }

  if (process.env.BASLINJE_RAPPORT) fs.writeFileSync(process.env.BASLINJE_RAPPORT, JSON.stringify({ tid: new Date().toISOString(), kalla: 'lokal replik, historisk källa ' + BASLINJE_COMMIT + ' (oförändrad STAGING-ekvivalent kod)', rader: rapport }, null, 1));
  console.log('\nBASLINJE-sammanfattning: ' + rapport.filter((x) => x.bevisad).length + '/' + rapport.length + ' brister bevisade (' + Array.from(new Set(rapport.map((x) => x.sak))).join(', ') + ')');
  r.stang();
  avsluta();
})().catch((e) => { ok(false, 'krasch: ' + (e.stack || e)); avsluta(); });
