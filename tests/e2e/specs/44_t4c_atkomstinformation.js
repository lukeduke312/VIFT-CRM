'use strict';
/*
 * T4-C (2026-11-28): åtkomstinformation för tilldelad personal (SÄK-7 tilldelningsvägen, D-05) och D-23
 * i klienten mot den simulerade servern (tests/e2e/t4c-regler.js = vift-v2 20261128000012, paritet i
 * tests/sim_parity.test.js).
 *
 *  T4C-01  D-05: fältet (standardrollen personal, objects_access_assigned) ser knappen "Visa
 *          åtkomstinformation" på sin egen aktiva AO; klick hämtar portkoden via get-sensitive-fields med
 *          AO-referens; servern loggar exakt ett uttag (utan värden); koden sparas aldrig i state eller
 *          localStorage.
 *  T4C-02  SEC-B5-08/09: ingen knapp på klar AO; direkta anrop för klar AO, annans AO och begränsad nekas
 *          (403 not_assigned / forbidden) och loggas som denied.
 *  T4C-03  D-23: admin tar bort ett objekt permanent (objektregistret) — den känsliga raden tas bort av
 *          servern i samma skrivning; arkivering/inaktivering behåller den.
 *
 * Nivå: lokalt verifierad mot fake-backend.js. Inget här är verifierat i STAGING.
 */
const WORLD = { backend: { keyPerms: require('../server-key-perms.js'), activitiesPolicy: true, activityAppend: true } };
const direkt = (s, ef, body) => s.eval(async ([e, b]) => {
  const r = await fetch(SUPABASE_URL + '/functions/v1/' + e, { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.getAccessToken(), apikey: SUPABASE_AKEY, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  let d = {}; try { d = await r.json(); } catch (x) {}
  return { status: r.status, error: d.error, reason: d.reason, body: d };
}, [ef, body]);
const KOD = 'PORT-T4C-0001';

module.exports = [
  {
    id: 'T4C-01', world: WORLD, module: 'Säkerhet', name: 'D-05: fältet hämtar portkoden för sin egen aktiva AO via den loggade servervägen; inget sparas i klienten',
    async run(t) {
      t.fake.sensitive.set('OBJ-001', { doorCode: KOD, keyInformation: 'Nyckel i tub T4C', accessInformation: 'Ring på T4C', accessCode: '' });
      const s = await t.world.session({ viewport: 'mobile' });
      await s.login('falt');
      await s.settle(800);
      await s.go('pg-ao-detail', { aoId: 'AO-001' });
      await s.settle(800);
      const fore = await s.eval(() => document.body.innerHTML);
      t.assert(/Visa åtkomstinformation/.test(fore) && !fore.includes('PORT-T4C'), 'knappen visas på den egna pågående AO:n och ingen kod visas innan fältet begär den');
      const a0 = t.fake.sensitiveAudit.length;
      await s.eval(() => { const f0 = window.fetch; window.__gsf = []; window.fetch = function (u, o) { if (/get-sensitive-fields/.test(String(u))) window.__gsf.push(o && o.body); return f0.apply(this, arguments); }; });
      await s.eval(() => WorkOrderDetailPage.visaAtkomst('AO-001'));
      await s.settle(600);
      const efter = await s.eval(() => Array.from(document.querySelectorAll('.aod-atkomst')).map((e) => e.textContent).join(' | '));
      t.assert(efter.includes(KOD) && /Nyckel i tub T4C/.test(efter), 'portkoden och nyckelinformationen visas efter begäran: ' + efter.slice(0, 120));
      const nya = t.fake.sensitiveAudit.slice(a0);
      t.assert(nya.length === 1 && nya[0].status === 'allowed' && nya[0].detail === 'ao:AO-001' && nya[0].staffId === 'ST-002' && !JSON.stringify(nya[0]).includes('T4C'),
        'servern loggade exakt ett uttag (allowed, ao:AO-001, fältets personal-id) utan värden: ' + JSON.stringify(nya));
      const anrop = await s.eval(() => window.__gsf);
      t.assert(anrop.length === 1 && JSON.parse(anrop[0]).workOrderId === 'AO-001' && JSON.parse(anrop[0]).propertyId === 'OBJ-001', 'ett anrop med fastighets- och AO-referens (AO-001 saknar objekt) (workOrderId): ' + JSON.stringify(anrop));
      const spar = await s.eval(() => JSON.stringify(state).includes('PORT-T4C') || Object.keys(localStorage).some((k) => String(localStorage.getItem(k)).includes('PORT-T4C')));
      t.assert(!spar, 'koden finns varken i state eller localStorage (visas bara på skärmen)');
    },
  },
  {
    id: 'T4C-02', world: WORLD, module: 'Säkerhet', name: 'SEC-B5-08/09: ingen knapp på klar AO; klar AO, annans AO och begränsad nekas av servern och loggas',
    async run(t) {
      t.fake.sensitive.set('OBJ-001', { doorCode: KOD });
      // FÄ2:s planerade AO (AO-007) på samma objekt: annans aktiva AO.
      t.fake.set('workOrders', t.fake.get('workOrders').map((a) => (a.id === 'AO-007' ? Object.assign({}, a, { objectId: 'OBJ-001' }) : a)));
      const s = await t.world.session({ viewport: 'mobile' });
      await s.login('falt');
      await s.settle(800);
      await s.go('pg-ao-detail', { aoId: 'AO-002' });
      await s.settle(800);
      const html = await s.eval(() => document.body.innerHTML);
      t.assert(!/Visa åtkomstinformation/.test(html), 'ingen knapp på den klara AO:n (AO-002)');
      const a0 = t.fake.sensitiveAudit.length;
      let d = await direkt(s, 'get-sensitive-fields', { objectId: 'OBJ-001', workOrderId: 'AO-002' });
      t.assert(d.status === 403 && d.error === 'forbidden' && d.reason === 'not_assigned' && !JSON.stringify(d.body).includes('PORT'), 'klar egen AO → 403 forbidden/not_assigned utan värden');
      d = await direkt(s, 'get-sensitive-fields', { objectId: 'OBJ-001', workOrderId: 'AO-007' });
      t.assert(d.status === 403 && d.reason === 'not_assigned', 'annans aktiva AO (AO-007, FÄ2) → 403 not_assigned');
      t.assert(t.fake.sensitiveAudit.length === a0 + 2 && t.fake.sensitiveAudit.slice(a0).every((x) => x.status === 'denied'), 'varje nekat uttag loggas (denied)');
      const s2 = await t.world.session({ viewport: 'mobile' });
      await s2.login('begransad');
      await s2.settle(800);
      d = await direkt(s2, 'get-sensitive-fields', { objectId: 'OBJ-001' });
      t.assert(d.status === 403 && d.error === 'forbidden' && d.reason === undefined, 'begränsad (utan objects_access_assigned) → 403 forbidden');
    },
  },
  {
    id: 'T4C-03', world: WORLD, module: 'Säkerhet', name: 'D-23: permanent radering av objekt tar bort den känsliga raden; inaktivering behåller den',
    async run(t) {
      const props = t.fake.get('properties');
      t.fake.set('propertyObjects', (t.fake.get('propertyObjects') || []).concat([
        { id: 'OBJ-T4C-1', propertyId: props[0].id, name: 'Lgh T4C 1', objectNumber: 'T4C1', status: 'uthyrd' },
        { id: 'OBJ-T4C-2', propertyId: props[0].id, name: 'Lgh T4C 2', objectNumber: 'T4C2', status: 'uthyrd' }]));
      t.fake.sensitive.set('OBJ-T4C-1', { doorCode: 'PORT-T4C-1' });
      t.fake.sensitive.set('OBJ-T4C-2', { doorCode: 'PORT-T4C-2' });
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await s.settle(1000);
      await s.eval(async () => { const o = state.propertyObjects.find((x) => x.id === 'OBJ-T4C-2'); o.status = 'inaktiv'; await persist({ detailed: true }); });
      await s.settle(500);
      t.assert(t.fake.sensitive.has('OBJ-T4C-2'), 'inaktivering (objektet finns kvar) behåller den känsliga raden');
      const a0 = t.fake.sensitiveAudit.length;
      await s.eval(async () => { PropertyObjectService.remove('OBJ-T4C-1'); await persist({ detailed: true }); });
      await s.settle(800);
      t.assert(!(t.fake.get('propertyObjects') || []).some((o) => o.id === 'OBJ-T4C-1') && !t.fake.sensitive.has('OBJ-T4C-1') && t.fake.sensitive.has('OBJ-T4C-2'),
        'permanent radering tog bort objektet och dess känsliga rad i samma skrivning; andra objekts rader orörda');
      const nya = t.fake.sensitiveAudit.slice(a0);
      t.assert(nya.length === 1 && nya[0].action === 'write' && /permanent_delete/.test(nya[0].detail) && !JSON.stringify(nya[0]).includes('PORT-T4C'), 'en revisionsrad (permanent_delete) utan värden: ' + JSON.stringify(nya));
    },
  },
];
