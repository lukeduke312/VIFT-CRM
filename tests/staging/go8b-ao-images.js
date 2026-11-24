'use strict';
/*
 * GO-8b verifiering mot STAGING: privata AO-bilder (workorder-images +
 * work-order-image-upload/-url/-delete). Märkt test-AO, liten test-JPEG.
 * Bilden raderas via EF:en och test-AO:n tas bort permanent.
 *   node tests/staging/go8b-ao-images.js --jag-har-go --mutationstest --bekrafta-projekt=<ref>
 */
const L = require('./lib');
const env = L.guard(2);
const { pw, emails } = L.accounts(['admin', 'falt', 'falt2', 'ekonomi'], []);
const { req, login } = L.client(env);
const runId = L.newRunId().replace('E2E-AUTHZ', 'E2E-GO8B');
const rep = L.reporter('go8b', runId);
// Minsta giltiga JPEG (1x1) — bara för magic bytes-kontrollen.
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
(async () => {
  const tok = {}; for (const [r, e] of Object.entries(emails)) tok[r] = await login(e, pw);
  const st = await req('/rest/v1/store?select=value&key=eq.vift_staff', { method: 'GET', token: tok.admin });
  const staff = (st.body && st.body[0] && st.body[0].value) || [];
  const id = {}; for (const [r, e] of Object.entries(emails)) id[r] = String((staff.find((s) => String(s.email).toLowerCase() === e) || {}).id || '');
  const getAO = async (aoId) => { const r = await req('/functions/v1/work-orders-list', { method: 'GET', token: tok.admin }); return ((r.body && r.body.workOrders) || []).find((a) => a.id === aoId); };
  const upload = async (who, aoId, buf, type) => { const fd = new FormData(); fd.append('aoId', aoId); fd.append('file', new Blob([buf], { type }), 'e2e.jpg'); const r = await fetch(env.sb + '/functions/v1/work-order-image-upload', { method: 'POST', headers: { apikey: env.anon, Authorization: 'Bearer ' + tok[who] }, body: fd }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const now = new Date().toISOString();
  const aoId = runId + '-AO';
  let created = false, path = null;
  try {
    const c = await req('/functions/v1/ao-time-write', { token: tok.admin, body: { action: 'create_ao', ao: { id: aoId, title: '[E2E-TEST] ' + runId, status: 'planerad', priority: 'normal', staff: [id.falt], customerId: '', description: 'Bildprov — tas bort.', log: [], materials: [], checklist: [], createdAt: now, updatedAt: now, e2eTest: runId }, idempotencyKey: runId + '-create-ao' } });
    if (c.status !== 200) throw new Error('kunde inte skapa test-AO (HTTP ' + c.status + ')');
    created = true;
    // Preflight från webbläsare: apikey måste vara tillåten.
    for (const fn of ['work-order-image-upload', 'work-order-image-url', 'work-order-image-delete']) {
      const o = await fetch(env.sb + '/functions/v1/' + fn, { method: 'OPTIONS', headers: { Origin: 'https://example.invalid', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'apikey, authorization, content-type' } });
      const ah = (o.headers.get('access-control-allow-headers') || '').toLowerCase();
      rep.add('BILD preflight ' + fn, o.status === 200 && ah.includes('apikey') && ah.includes('authorization'), 'HTTP ' + o.status + '; tillåtna: ' + ah);
    }
    let r = await upload('falt', aoId, JPEG, 'image/jpeg');
    path = r.body.path;
    rep.add('BILD uppladdning (fält, tilldelad)', r.status === 200 && typeof path === 'string' && path.startsWith(aoId + '/'), 'HTTP ' + r.status + ' ' + (r.body.error || path));
    r = await upload('falt2', aoId, JPEG, 'image/jpeg');
    rep.add('BILD uppladdning ej tilldelad (fält2)', r.status === 403, 'HTTP ' + r.status + ' ' + (r.body.error || ''));
    r = await upload('ekonomi', aoId, JPEG, 'image/jpeg');
    rep.add('BILD uppladdning utan ao_checklist/ao_edit (ekonomi)', r.status === 403, 'HTTP ' + r.status + ' ' + (r.body.error || ''));
    r = await upload('falt', aoId, Buffer.from('%PDF-1.4 inte en bild'), 'image/jpeg');
    rep.add('BILD förfalskad filtyp nekas', r.status === 400 && r.body.error === 'invalid_file_type', 'HTTP ' + r.status + ' ' + (r.body.error || ''));
    // Läsning via signerad URL.
    const u = await req('/functions/v1/work-order-image-url', { token: tok.falt, body: { aoId, paths: [path] } });
    const signed = u.body && u.body.urls && u.body.urls[path];
    let fetched = null; if (signed) { const g = await fetch(signed); fetched = { status: g.status, len: (await g.arrayBuffer()).byteLength }; }
    rep.add('BILD signerad URL + hämtning (fält)', u.status === 200 && !!signed && fetched && fetched.status === 200 && fetched.len === JPEG.length, 'HTTP ' + u.status + '; hämtning ' + (fetched ? fetched.status + ', ' + fetched.len + ' byte' : '—'));
    const u2 = await req('/functions/v1/work-order-image-url', { token: tok.falt2, body: { aoId, paths: [path] } });
    rep.add('BILD URL ej tilldelad (fält2)', u2.status === 403, 'HTTP ' + u2.status + ' ' + (u2.body.error || ''));
    const u3 = await req('/functions/v1/work-order-image-url', { token: tok.falt, body: { aoId, paths: ['ANNAN-AO/x.jpg'] } });
    const u4 = await req('/functions/v1/work-order-image-url', { token: tok.falt, body: { aoId, paths: [aoId + '/../ANNAN/x.jpg'] } });
    rep.add('BILD sökvägsmanipulation nekas', u3.status === 400 && u4.status === 400, 'HTTP ' + u3.status + '/' + u4.status);
    // Bucketen är privat: varken publik URL eller användarens egen JWT direkt mot Storage ger filen.
    const pub = await fetch(env.sb + '/storage/v1/object/public/workorder-images/' + path);
    const dir = await fetch(env.sb + '/storage/v1/object/workorder-images/' + path, { headers: { apikey: env.anon, Authorization: 'Bearer ' + tok.falt } });
    const anon = await fetch(env.sb + '/storage/v1/object/workorder-images/' + path, { headers: { apikey: env.anon, Authorization: 'Bearer ' + env.anon } });
    rep.add('BILD bucket privat (publik URL, direkt med JWT, anon)', pub.status >= 400 && dir.status >= 400 && anon.status >= 400, 'HTTP ' + pub.status + '/' + dir.status + '/' + anon.status);
    // Radering.
    const d2 = await req('/functions/v1/work-order-image-delete', { token: tok.falt2, body: { aoId, path } });
    rep.add('BILD radering ej tilldelad (fält2)', d2.status === 403, 'HTTP ' + d2.status + ' ' + (d2.body.error || ''));
    const d = await req('/functions/v1/work-order-image-delete', { token: tok.falt, body: { aoId, path } });
    const after = await req('/functions/v1/work-order-image-url', { token: tok.falt, body: { aoId, paths: [path] } });
    rep.add('BILD radering (fält) + borta efteråt', d.status === 200 && after.status === 200 && !(after.body.urls || {})[path], 'HTTP ' + d.status + '; URL efteråt: ' + (((after.body.urls || {})[path]) ? 'finns' : 'saknas'));
  } catch (err) { rep.add('KÖRNING', false, 'avbröts: ' + err.message); }
  if (created) {
    await req('/functions/v1/ao-time-write', { token: tok.admin, body: { action: 'delete_ao', aoId, idempotencyKey: runId + '-stada-d' } });
    await req('/functions/v1/ao-time-write', { token: tok.admin, body: { action: 'permanent_delete_ao', aoId, idempotencyKey: runId + '-stada-p' } });
    rep.add('STÄDNING test-AO', !(await getAO(aoId)), 'test-AO ' + aoId);
  }
  const f = rep.save({ projekt: env.ref, path });
  const bad = rep.results.filter((x) => x.ok === false).length;
  console.log('\n' + rep.results.filter((x) => x.ok === true).length + ' OK, ' + bad + ' avvikelser. Rapport: ' + f);
  process.exit(bad ? 1 : 0);
})();
