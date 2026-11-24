'use strict';
/*
 * GO-8c verifiering mot STAGING: offer-public-pdf (publik, token-baserad).
 * Märkta testofferter (arbetsledare) med egna token: rätt offert per token,
 * återkallad/utgången/saknad snapshot/ogiltig token nekas, interna fält
 * syns aldrig, logotypen bäddas in. Testofferterna tas bort efteråt.
 */
const L = require('./lib');
const zlib = require('zlib');
const crypto = require('crypto');
const env = L.guard(2);
const { pw, emails } = L.accounts(['admin', 'chef'], []);
const { req, login } = L.client(env);
const runId = L.newRunId().replace('E2E-AUTHZ', 'E2E-GO8C');
const rep = L.reporter('go8c', runId);
const pdfText = (buf) => {
  let out = buf.toString('latin1');
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g; let m;
  while ((m = re.exec(buf.toString('latin1')))) { try { out += zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch (e) {} }
  // pdf-lib skriver text som hex-strängar (<48656C6C6F> Tj) — avkoda dem.
  out += ' ' + (out.match(/<([0-9A-Fa-f]{2,})>/g) || []).map((h) => Buffer.from(h.slice(1, -1), 'hex').toString('latin1')).join(' ');
  return out;
};
(async () => {
  const tok = {}; for (const [r, e] of Object.entries(emails)) tok[r] = await login(e, pw);
  const W = (body) => req('/functions/v1/store-key-write', { token: tok.chef, body });
  const T = () => crypto.randomBytes(32).toString('hex');
  const mk = (suffix, marker, extra) => {
    const id = runId + '-' + suffix;
    const snap = { id, title: '[E2E-TEST] ' + marker, customerName: 'E2E Testkund', date: '2026-11-24', lines: [{ id: 'l1', description: marker + ' rad', qty: 2, unitPrice: 1000, vatRate: 25, purchasePrice: 123456, internalNote: 'INTERNHEMLIGT' }], extras: [], publicAttachmentIds: [] };
    return Object.assign({ id, title: '[E2E-TEST] ' + marker, status: 'skickad', publicToken: T(), lockedSnapshotJSON: JSON.stringify(snap), e2eTest: runId }, extra || {});
  };
  const offs = { A: mk('A', 'MARKORALFA'), B: mk('B', 'MARKORBETA'), R: mk('R', 'MARKORREV', { tokenRevokedAt: new Date().toISOString() }), X: mk('X', 'MARKOREXP', { tokenExpiresAt: '2020-01-01T00:00:00Z' }), N: mk('N', 'MARKORNOSNAP', { lockedSnapshotJSON: '' }) };
  const made = [];
  const getPdf = async (t) => { const r = await fetch(env.sb + '/functions/v1/offer-public-pdf' + (t === undefined ? '' : '?t=' + encodeURIComponent(t))); return { status: r.status, type: r.headers.get('content-type') || '', buf: Buffer.from(await r.arrayBuffer()) }; };
  try {
    const r = await W({ action: 'writeMerge', key: 'vift_offers', upserts: Object.values(offs).map((o) => ({ id: o.id, data: o, previous: null })), removals: [] });
    if (r.status !== 200) throw new Error('testofferter kunde inte skapas (HTTP ' + r.status + ' ' + (r.body.error || '') + ')');
    made.push(...Object.values(offs).map((o) => o.id));
    const a = await getPdf(offs.A.publicToken), b = await getPdf(offs.B.publicToken);
    const ta = pdfText(a.buf), tb = pdfText(b.buf);
    rep.add('PDF giltig token (A)', a.status === 200 && /application\/pdf/.test(a.type) && a.buf.slice(0, 5).toString() === '%PDF-', 'HTTP ' + a.status + ' ' + a.type + ', ' + a.buf.length + ' byte');
    rep.add('PDF token A ger bara offert A', ta.includes(offs.A.id) && !ta.includes(offs.B.id) && tb.includes(offs.B.id) && !tb.includes(offs.A.id), 'A innehåller ' + (ta.includes(offs.A.id) ? 'A' : '–') + '/' + (ta.includes(offs.B.id) ? 'B!' : 'ej B') + '; B innehåller ' + (tb.includes(offs.B.id) ? 'B' : '–') + '/' + (tb.includes(offs.A.id) ? 'A!' : 'ej A'));
    rep.add('PDF interna fält exponeras inte', !ta.includes('INTERNHEMLIGT') && !ta.includes('123456') && !ta.includes('123 456'), 'internalNote/purchasePrice saknas i PDF:en');
    rep.add('PDF logotyp inbäddad (från vift-branding)', /\/Subtype\s*\/Image/.test(ta), /\/Subtype\s*\/Image/.test(ta) ? 'bildobjekt finns' : 'ingen bild (textlogotyp användes)');
    const rv = await getPdf(offs.R.publicToken), ex = await getPdf(offs.X.publicToken), ns = await getPdf(offs.N.publicToken);
    rep.add('PDF återkallad token', rv.status === 403, 'HTTP ' + rv.status);
    rep.add('PDF utgången token', ex.status === 410, 'HTTP ' + ex.status);
    rep.add('PDF saknad snapshot', ns.status === 409, 'HTTP ' + ns.status);
    const rnd = await getPdf(T()), short = await getPdf('abc'), none = await getPdf(undefined);
    rep.add('PDF okänd/kort/saknad token', rnd.status === 404 && short.status === 404 && none.status === 404, 'HTTP ' + rnd.status + '/' + short.status + '/' + none.status);
  } catch (err) { rep.add('KÖRNING', false, 'avbröts: ' + err.message); }
  if (made.length) {
    const cur = await req('/functions/v1/store-key-write', { token: tok.admin, body: { action: 'readWithHash', key: 'vift_offers' } });
    const prevs = ((cur.body && cur.body.value) || []).filter((o) => made.includes(o.id));
    await W({ action: 'writeMerge', key: 'vift_offers', upserts: [], removals: prevs.map((p) => ({ id: p.id, previous: p })) });
    const after = await req('/functions/v1/store-key-write', { token: tok.admin, body: { action: 'readWithHash', key: 'vift_offers' } });
    const left = ((after.body && after.body.value) || []).filter((o) => made.includes(o.id)).length;
    rep.add('STÄDNING testofferter', left === 0, left ? left + ' kvar' : made.length + ' borttagna');
  }
  const f = rep.save({ projekt: env.ref });
  const bad = rep.results.filter((x) => x.ok === false).length;
  console.log('\n' + rep.results.filter((x) => x.ok === true).length + ' OK, ' + bad + ' avvikelser. Rapport: ' + f);
  process.exit(bad ? 1 : 0);
})();
