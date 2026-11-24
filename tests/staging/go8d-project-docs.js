'use strict';
/* GO-8d verifiering mot STAGING: projektdokument (privat bucket, upload/url/patch/delete). */
const L = require('./lib');
const env = L.guard(2);
const { pw, emails } = L.accounts(['admin', 'falt', 'chef'], []);
const { req, login } = L.client(env);
const runId = L.newRunId().replace('E2E-AUTHZ', 'E2E-GO8D');
const rep = L.reporter('go8d', runId);
(async () => {
  const tok = {}; for (const [r, e] of Object.entries(emails)) tok[r] = await login(e, pw);
  const W = (who, body) => req('/functions/v1/store-key-write', { token: tok[who], body });
  const prj = runId + '-PRJ', prj2 = runId + '-PRJ2';
  const pdf = Buffer.from('%PDF-1.4\n% E2E-TEST ' + runId + '\n%%EOF\n');
  const up = async (who, extra) => { const fd = new FormData(); fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'E2E åäö test.pdf'); fd.append('projectId', (extra && extra.projectId) || prj); fd.append('documentType', 'ovrigt'); if (extra && extra.amount) fd.append('amountExVat', extra.amount); const r = await fetch(env.sb + '/functions/v1/project-document-upload', { method: 'POST', headers: { apikey: env.anon, Authorization: 'Bearer ' + tok[who] }, body: fd }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const PD = (who, method, body) => req('/functions/v1/project-document-upload', { method, token: tok[who], body });
  const URLR = (who, body) => req('/functions/v1/project-document-url', { token: tok[who], body });
  const docs = [];
  let made = false;
  try {
    const now = new Date().toISOString();
    const r0 = await W('chef', { action: 'writeMerge', key: 'vift_projects', upserts: [prj, prj2].map((id) => ({ id, data: { id, name: '[E2E-TEST] ' + id, status: 'aktiv', customerId: '', e2eTest: runId, createdAt: now }, previous: null })), removals: [] });
    if (r0.status !== 200) throw new Error('testprojekt kunde inte skapas (HTTP ' + r0.status + ' ' + (r0.body.error || '') + ')');
    made = true;
    let r = await up('chef');
    const d1 = r.body.document; if (d1) docs.push(d1.id);
    rep.add('DOK uppladdning (arbetsledare, customer_manage)', r.status === 200 && !!d1 && d1.storagePath === 'project-documents/' + prj + '/' + d1.id + '/E2E_aao_test.pdf' && d1.originalFileName === 'E2E åäö test.pdf' && d1.uploadedBy, 'HTTP ' + r.status + ' ' + (r.body.error || (d1 && d1.storagePath)));
    r = await up('chef', { amount: '1000' });
    rep.add('DOK belopp utan invoice_view nekas', r.status === 403 && r.body.error === 'forbidden_amount', 'HTTP ' + r.status + ' ' + (r.body.error || ''));
    r = await up('admin', { amount: '1000' });
    if (r.body.document) docs.push(r.body.document.id);
    rep.add('DOK belopp med behörighet (admin)', r.status === 200 && r.body.document && r.body.document.amountExVat === 1000, 'HTTP ' + r.status);
    r = await up('falt');
    rep.add('DOK uppladdning utan customer_manage (fält)', r.status === 403, 'HTTP ' + r.status);
    r = await up('chef', { projectId: runId + '-FINNSINTE' });
    rep.add('DOK okänt projekt', r.status === 404, 'HTTP ' + r.status + ' ' + (r.body.error || ''));
    // Läsning
    const u = await URLR('chef', { documentId: d1.id, projectId: prj });
    let g = null; if (u.body.url) { const f = await fetch(u.body.url); g = { s: f.status, n: (await f.arrayBuffer()).byteLength }; }
    rep.add('DOK signerad URL + hämtning', u.status === 200 && g && g.s === 200 && g.n === pdf.length, 'HTTP ' + u.status + '; hämtning ' + (g ? g.s + ', ' + g.n + ' byte' : '—'));
    const u2 = await URLR('chef', { documentId: d1.id, projectId: prj2 });
    const u3 = await URLR('falt', { documentId: d1.id, projectId: prj });
    rep.add('DOK URL fel projekt / utan behörighet', u2.status === 403 && u3.status === 403, 'HTTP ' + u2.status + '/' + u3.status);
    const pub = await fetch(env.sb + '/storage/v1/object/public/' + d1.storagePath);
    rep.add('DOK bucket privat', pub.status >= 400, 'publik URL HTTP ' + pub.status);
    // PATCH
    r = await PD('chef', 'PATCH', { documentId: d1.id, projectId: prj, patch: { displayName: '[E2E-TEST] omdöpt', storagePath: 'project-documents/ANNAT/x/y.pdf', uploadedBy: 'FÖRFALSKAD' } });
    const p = r.body.document || {};
    rep.add('DOK PATCH vitlistning', r.status === 200 && p.displayName === '[E2E-TEST] omdöpt' && p.storagePath === d1.storagePath && p.uploadedBy === d1.uploadedBy, 'HTTP ' + r.status + '; storagePath/uploadedBy orörda: ' + (p.storagePath === d1.storagePath && p.uploadedBy === d1.uploadedBy));
    r = await PD('chef', 'PATCH', { documentId: d1.id, projectId: prj, patch: { amountExVat: 5 } });
    rep.add('DOK PATCH belopp utan invoice_view', r.status === 403, 'HTTP ' + r.status + ' ' + (r.body.error || ''));
    r = await PD('chef', 'PATCH', { documentId: d1.id, projectId: prj2, patch: { displayName: 'x' } });
    rep.add('DOK PATCH fel projekt', r.status === 403, 'HTTP ' + r.status);
    // DELETE
    r = await PD('chef', 'DELETE', { documentId: d1.id, projectId: prj2 });
    rep.add('DOK radering fel projekt', r.status === 403, 'HTTP ' + r.status);
    for (const id of docs.slice()) {
      const rr = await PD('admin', 'DELETE', { documentId: id, projectId: prj });
      if (rr.status === 200) docs.splice(docs.indexOf(id), 1);
    }
    const after = await URLR('chef', { documentId: d1.id, projectId: prj });
    rep.add('DOK radering + borta efteråt', docs.length === 0 && after.status === 404, 'kvar ' + docs.length + '; URL efteråt HTTP ' + after.status);
  } catch (err) { rep.add('KÖRNING', false, 'avbröts: ' + err.message); }
  if (made) {
    const cur = await W('admin', { action: 'readWithHash', key: 'vift_projects' });
    const prevs = ((cur.body && cur.body.value) || []).filter((o) => o.id === prj || o.id === prj2);
    await W('chef', { action: 'writeMerge', key: 'vift_projects', upserts: [], removals: prevs.map((x) => ({ id: x.id, previous: x })) });
    const after = await W('admin', { action: 'readWithHash', key: 'vift_projects' });
    const left = ((after.body && after.body.value) || []).filter((o) => o.id === prj || o.id === prj2).length;
    rep.add('STÄDNING testprojekt', left === 0, left ? left + ' kvar' : 'borttagna');
  }
  rep.add('STÄDNING operatör', null, 'inaktiva dokumentposter i vift_projectDocuments med projectId ' + prj + ' tas bort med SQL');
  const f = rep.save({ projekt: env.ref });
  const bad = rep.results.filter((x) => x.ok === false).length;
  console.log('\n' + rep.results.filter((x) => x.ok === true).length + ' OK, ' + bad + ' avvikelser. Rapport: ' + f);
  process.exit(bad ? 1 : 0);
})();
