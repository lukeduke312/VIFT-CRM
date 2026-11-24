'use strict';
/*
 * GO-8a verifiering mot STAGING: offer-attachment-upload (v12 + PATCH).
 * Märkt testoffert (arbetsledare, offer_manage) + liten test-PDF:
 * uppladdning (befintlig väg), signerad URL (offer-attachment-url),
 * PATCH, behörighet, soft delete. Testofferten tas bort; bilageposten,
 * offerthändelserna och Storage-objektet städas av operatören (postgres).
 *   node tests/staging/go8a-attachments.js --jag-har-go --mutationstest --bekrafta-projekt=<ref>
 */
const L = require('./lib');
const env = L.guard(2);
const { pw, emails } = L.accounts(['admin', 'falt', 'chef', 'ekonomi'], []);
const { req, login } = L.client(env);
const runId = L.newRunId().replace('E2E-AUTHZ', 'E2E-GO8A');
const rep = L.reporter('go8a', runId);
(async () => {
  const tok = {}; for (const [r, e] of Object.entries(emails)) tok[r] = await login(e, pw);
  const W = (who, body) => req('/functions/v1/store-key-write', { token: tok[who], body });
  const offId = runId + '-OFF';
  const offer = { id: offId, title: '[E2E-TEST] ' + runId, status: 'utkast', customerId: '', lines: [], e2eTest: runId, createdAt: new Date().toISOString() };
  let attId = null, offerMade = false;
  const curOffer = async () => { const r = await W('admin', { action: 'readWithHash', key: 'vift_offers' }); return ((r.body && r.body.value) || []).find((o) => o.id === offId) || null; };
  const AU = (who, method, body) => req('/functions/v1/offer-attachment-upload', { method, token: tok[who], body });
  try {
    let r = await W('chef', { action: 'writeMerge', key: 'vift_offers', upserts: [{ id: offId, data: offer, previous: null }], removals: [] });
    if (r.status !== 200) throw new Error('testoffert kunde inte skapas (HTTP ' + r.status + ' ' + (r.body.error || '') + ')');
    offerMade = true;
    // Befintlig uppladdningsväg (multipart) fungerar oförändrat.
    const pdf = Buffer.from('%PDF-1.4\n% E2E-TEST ' + runId + '\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    const fd = new FormData();
    fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'e2e-test.pdf');
    fd.append('offerId', offId); fd.append('offerVersionId', '1'); fd.append('displayName', '[E2E-TEST] bilaga');
    const up = await fetch(env.sb + '/functions/v1/offer-attachment-upload', { method: 'POST', headers: { apikey: env.anon, Authorization: 'Bearer ' + tok.chef }, body: fd });
    const upB = await up.json().catch(() => ({}));
    attId = upB.attachment && upB.attachment.id;
    rep.add('BIL uppladdning (befintlig väg)', up.status === 200 && !!attId && upB.attachment.checksum && upB.attachment.mimeType === 'application/pdf', 'HTTP ' + up.status + ' ' + (upB.error || attId));
    const fd2 = new FormData(); fd2.append('file', new Blob([pdf], { type: 'application/pdf' }), 'x.pdf'); fd2.append('offerId', offId); fd2.append('offerVersionId', '1');
    const upF = await fetch(env.sb + '/functions/v1/offer-attachment-upload', { method: 'POST', headers: { apikey: env.anon, Authorization: 'Bearer ' + tok.falt }, body: fd2 });
    rep.add('BIL uppladdning utan offer_manage (fält)', upF.status === 403, 'HTTP ' + upF.status);
    // Signerad URL via befintlig offer-attachment-url (intern väg).
    const u = await req('/functions/v1/offer-attachment-url', { token: tok.chef, body: { attachmentId: attId, offerId: offId } });
    rep.add('BIL signerad URL (offer-attachment-url)', u.status === 200 && /token=|sign/i.test(JSON.stringify(u.body)), 'HTTP ' + u.status + ' ' + (u.body.error || 'url utfärdad'));
    const uw = await req('/functions/v1/offer-attachment-url', { token: tok.chef, body: { attachmentId: attId, offerId: 'ANNAN-OFFERT' } });
    rep.add('BIL URL med fel offert-id nekas', uw.status === 403 || uw.status === 404, 'HTTP ' + uw.status + ' ' + (uw.body.error || ''));
    // PATCH.
    r = await AU('chef', 'PATCH', { attachmentId: attId, displayName: '[E2E-TEST] omdöpt', includeInPublicView: false, description: 'patchad', storagePath: 'hackad/sökväg', active: false });
    const a = r.body.attachment || {};
    rep.add('BIL PATCH namn + synlighet', r.status === 200 && a.displayName === '[E2E-TEST] omdöpt' && a.includeInPublicView === false && a.description === 'patchad', 'HTTP ' + r.status + ' ' + (r.body.error || ''));
    rep.add('BIL PATCH vitlistning (storagePath/active orörda)', r.status === 200 && a.active === true && /^offer-attachments\//.test(a.storagePath || ''), 'active ' + a.active + ', storagePath oförändrad: ' + /^offer-attachments\//.test(a.storagePath || ''));
    r = await AU('falt', 'PATCH', { attachmentId: attId, displayName: 'fält' });
    rep.add('BIL PATCH utan offer_manage (fält)', r.status === 403, 'HTTP ' + r.status);
    r = await AU('ekonomi', 'PATCH', { attachmentId: attId, displayName: 'ekonomi' });
    rep.add('BIL PATCH utan offer_manage (ekonomi)', r.status === 403, 'HTTP ' + r.status);
    r = await AU('chef', 'PATCH', { attachmentId: 'att-finnsinte', displayName: 'x' });
    rep.add('BIL PATCH okänd bilaga', r.status === 404, 'HTTP ' + r.status + ' ' + (r.body.error || ''));
    // Soft delete, därefter PATCH = 404.
    r = await AU('chef', 'DELETE', { attachmentId: attId });
    const r2 = await AU('chef', 'PATCH', { attachmentId: attId, displayName: 'efter radering' });
    rep.add('BIL soft delete + PATCH efteråt nekas', r.status === 200 && r2.status === 404, 'HTTP ' + r.status + '/' + r2.status);
  } catch (err) { rep.add('KÖRNING', false, 'avbröts: ' + err.message); }
  if (offerMade) {
    const p = await curOffer();
    if (p) await W('chef', { action: 'writeMerge', key: 'vift_offers', upserts: [], removals: [{ id: offId, previous: p }] });
    rep.add('STÄDNING testoffert', !(await curOffer()), 'testoffert ' + offId);
  }
  rep.add('STÄDNING operatör', null, 'bilagepost ' + attId + ', offerthändelser för ' + offId + ' och Storage-objekt under offer-attachments/' + offId + '/ städas med SQL');
  const f = rep.save({ projekt: env.ref, attachmentId: attId, offerId: offId });
  const bad = rep.results.filter((x) => x.ok === false).length;
  console.log('\n' + rep.results.filter((x) => x.ok === true).length + ' OK, ' + bad + ' avvikelser. Rapport: ' + f);
  process.exit(bad ? 1 : 0);
})();
