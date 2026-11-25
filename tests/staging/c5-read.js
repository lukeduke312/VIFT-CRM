'use strict';
/*
 * C-5 (2026-11-25) — läsbehörighet per roll mot STAGING. LÄSANDE: inga skrivningar.
 * För alla sex testkonton prövas samtliga läsvägar till public.store:
 *   REST  GET /rest/v1/store (direkt, RLS + restriktiv policy store_read_by_role)
 *   EF    store-key-write readAllWithHashes (det klienten använder vid inloggning/synk)
 *   EF    store-key-write readWithHash (en nyckel)
 * och kontrollerar både TILLÅTET (rollen får det den behöver) och NEKAT
 * (offerttoken, kundgodkännande, låst kundversion, personnummer, portkoder,
 * bankgiro/internt timpris, fakturor, offerthändelser, säljchanser …).
 *   node tests/staging/c5-read.js --jag-har-go --bekrafta-projekt=<ref>
 */
const L = require('./lib');
const env = L.guard(1);
const { pw, emails } = L.accounts(['admin', 'falt', 'chef', 'ekonomi', 'begransad'], ['falt2']);
const { req, login } = L.client(env);
const rep = L.reporter('c5-read', L.newRunId().replace('E2E-AUTHZ', 'E2E-C5'));

const SECRET_OFFER = ['publicToken', 'tokenExpiresAt', 'lockedSnapshotJSON', 'customerApproval', 'internalNote'];
const KEYS = ['vift_offers', 'vift_invoices', 'vift_customers', 'vift_settings', 'vift_propertyObjects', 'vift_recurringOrders',
  'vift_offerEvents', 'vift_offerAttachments', 'vift_salesOpps', 'vift_emailTemplates', 'vift_importLogs', 'vift_staff', 'vift_workOrders', 'vift_timeEntries'];

/* Förväntan per roll (true = ska få se, false = ska nekas). */
const EXPECT = {
  admin:     { token: true,  offerLines: true,  invoices: true,  personnr: true,  doorCode: true,  bankgiro: true,  offerEvents: true,  sales: true,  restOffers: true,  restInvoices: true },
  chef:      { token: true,  offerLines: true,  invoices: true,  personnr: true,  doorCode: true,  bankgiro: true,  offerEvents: true,  sales: true,  restOffers: true,  restInvoices: true },
  ekonomi:   { token: false, offerLines: true,  invoices: true,  personnr: true,  doorCode: false, bankgiro: true,  offerEvents: false, sales: true,  restOffers: false, restInvoices: true },
  falt:      { token: false, offerLines: false, invoices: false, personnr: false, doorCode: false, bankgiro: false, offerEvents: false, sales: false, restOffers: false, restInvoices: false },
  falt2:     { token: false, offerLines: false, invoices: false, personnr: false, doorCode: false, bankgiro: false, offerEvents: false, sales: false, restOffers: false, restInvoices: false },
  begransad: { token: false, offerLines: false, invoices: false, personnr: false, doorCode: false, bankgiro: false, offerEvents: false, sales: false, restOffers: false, restInvoices: false },
};

const hasField = (arr, f) => Array.isArray(arr) && arr.some((e) => e && typeof e === 'object' && Object.prototype.hasOwnProperty.call(e, f) && e[f] !== '' && e[f] != null);
const nonEmpty = (v) => Array.isArray(v) ? v.length > 0 : (v && typeof v === 'object' ? Object.keys(v).length > 0 : !!v);

(async () => {
  // Referens (admin, full åtkomst): vad som FINNS i datan, så att ett "nekat" inte blir grönt bara för att fältet saknas överallt.
  const tokA = await login(emails.admin, pw);
  const refAll = await req('/functions/v1/store-key-write', { token: tokA, body: { action: 'readAllWithHashes' } });
  const ref = (refAll.body && refAll.body.data) || {};
  const exists = {
    token: hasField(ref.offers, 'publicToken'), offerLines: hasField(ref.offers, 'lines'), invoices: nonEmpty(ref.invoices),
    personnr: hasField(ref.customers, 'personnr'), doorCode: hasField(ref.propertyObjects, 'doorCode'), bankgiro: !!(ref.settings && ref.settings.bankgiro),
    offerEvents: nonEmpty(ref.offerEvents), sales: nonEmpty(ref.salesOpps),
  };
  rep.add('REFERENS (admin) — vad som finns i STAGING-datan', null, JSON.stringify(exists));

  for (const role of Object.keys(EXPECT)) {
    if (!emails[role]) { rep.add(role, null, 'konto saknas — hoppas över'); continue; }
    const tok = role === 'admin' ? tokA : await login(emails[role], pw);
    const ex = EXPECT[role];
    const all = await req('/functions/v1/store-key-write', { token: tok, body: { action: 'readAllWithHashes' } });
    const d = (all.body && all.body.data) || {};
    const got = {
      token: hasField(d.offers, 'publicToken'), offerLines: hasField(d.offers, 'lines'), invoices: nonEmpty(d.invoices),
      personnr: hasField(d.customers, 'personnr'), doorCode: hasField(d.propertyObjects, 'doorCode'), bankgiro: !!(d.settings && d.settings.bankgiro),
      offerEvents: nonEmpty(d.offerEvents), sales: nonEmpty(d.salesOpps),
    };
    const anySecret = (d.offers || []).some((o) => o && SECRET_OFFER.some((f) => Object.prototype.hasOwnProperty.call(o, f)));
    const bad = [];
    for (const k of Object.keys(got)) {
      if (!exists[k]) continue; // går inte att pröva meningsfullt
      if (got[k] !== ex[k]) bad.push(k + (got[k] ? ' SYNS (ska nekas)' : ' SAKNAS (behövs)'));
    }
    if (!ex.token && anySecret) bad.push('hemliga offertfält kvar: ' + SECRET_OFFER.filter((f) => (d.offers || []).some((o) => o && Object.prototype.hasOwnProperty.call(o, f))).join(','));
    // Grundfunktion: rollen måste fortfarande få det den behöver för att arbeta.
    const basics = ['customers', 'properties', 'staff', 'roles', 'settings'].filter((k) => !nonEmpty(d[k]));
    if (basics.length) bad.push('grunddata saknas: ' + basics.join(','));
    rep.add('C5 readAllWithHashes ' + role, all.status === 200 && bad.length === 0, 'HTTP ' + all.status + '; ' + (bad.length ? 'AVVIKER: ' + bad.join('; ') : Object.entries(got).filter(([k]) => exists[k]).map(([k, v]) => k + '=' + (v ? 'ja' : 'nej')).join(' ')));

    // readWithHash: samma regler för en enskild nyckel.
    const one = await req('/functions/v1/store-key-write', { token: tok, body: { action: 'readWithHash', key: 'vift_offers' } });
    const oneTok = hasField(one.body && one.body.value, 'publicToken');
    const oneCu = await req('/functions/v1/store-key-write', { token: tok, body: { action: 'readWithHash', key: 'vift_customers' } });
    const onePn = hasField(oneCu.body && oneCu.body.value, 'personnr');
    rep.add('C5 readWithHash ' + role, one.status === 200 && oneTok === (ex.token && exists.token) && onePn === (ex.personnr && exists.personnr),
      'offerter HTTP ' + one.status + ' token ' + (oneTok ? 'ja' : 'nej') + '; kunder personnr ' + (onePn ? 'ja' : 'nej'));

    // work-orders-list: portkod (accessCode) bara för objects_sensitive/ao_edit (admin, arbetsledare).
    const wl = await req('/functions/v1/work-orders-list', { method: 'GET', token: tok });
    const wos = (wl.body && wl.body.workOrders) || [];
    const hasAc = wos.some((a) => a && Object.prototype.hasOwnProperty.call(a, 'accessCode'));
    const wantAc = role === 'admin' || role === 'chef';
    rep.add('C5 work-orders-list portkod ' + role, wl.status === 200 && (wos.length === 0 || hasAc === wantAc), 'HTTP ' + wl.status + ', ' + wos.length + ' AO, fältet accessCode ' + (hasAc ? 'finns' : 'saknas') + ' (förväntat ' + (wantAc ? 'finns' : 'saknas') + ')');
    // T3-B (K-03): öppen pool-AO som rollen inte är tilldelad får inga kontakter, kund eller priser.
    if (!['admin', 'chef', 'ekonomi'].includes(role)) {
      const proj = wos.filter((a) => a && a.poolProjection === true);
      const lack = proj.filter((a) => ['phone', 'contactEmail', 'contactPerson', 'customerName', 'customerId', 'fixedPrice', 'accessCode'].some((f) => f in a));
      const okPool = wos.filter((a) => a && a.status === 'pool' && !a.poolProjection && !(a.staff || []).length);
      rep.add('C5 work-orders-list öppen pool ' + role, wl.status === 200 && lack.length === 0 && okPool.length === 0, 'HTTP ' + wl.status + ', ' + proj.length + ' öppen pool-AO projicerade' + (lack.length ? '; MED skyddade fält: ' + lack.length : '') + (okPool.length ? '; oprojicerade öppen pool-AO: ' + okPool.length : ''));
    }

    // REST direkt: vilka nycklar syns, och läcker någon känslig nyckel?
    const rest = await req('/rest/v1/store?select=key,value&key=in.(' + KEYS.join(',') + ')', { method: 'GET', token: tok });
    const rows = Array.isArray(rest.body) ? rest.body : [];
    const seen = new Set(rows.map((r) => r.key));
    const restBad = [];
    if (seen.has('vift_offers') !== ex.restOffers) restBad.push('vift_offers ' + (seen.has('vift_offers') ? 'läsbar' : 'nekad'));
    if (seen.has('vift_invoices') !== ex.restInvoices && exists.invoices) restBad.push('vift_invoices ' + (seen.has('vift_invoices') ? 'läsbar' : 'nekad'));
    if (seen.has('vift_workOrders') || seen.has('vift_timeEntries')) restBad.push('AO/tid läsbara direkt');
    const restTok = rows.some((r) => r.key === 'vift_offers' && hasField(r.value, 'publicToken'));
    if (restTok && !ex.token) restBad.push('offerttoken via REST');
    const restPn = rows.some((r) => r.key === 'vift_customers' && hasField(r.value, 'personnr'));
    if (restPn && !ex.personnr) restBad.push('personnr via REST');
    const restDoor = rows.some((r) => r.key === 'vift_propertyObjects' && hasField(r.value, 'doorCode'));
    if (restDoor && !ex.doorCode) restBad.push('portkod via REST');
    const restSet = rows.some((r) => r.key === 'vift_settings' && r.value && r.value.bankgiro);
    if (restSet && !ex.bankgiro) restBad.push('bankgiro via REST');
    // Klientens egna REST-läsningar måste fungera för alla.
    const lc = await req('/rest/v1/store?select=value&key=eq.vift_lastChanged', { method: 'GET', token: tok });
    const rp = await req('/rest/v1/store?select=value&key=eq.vift_ronderingspass', { method: 'GET', token: tok });
    if (!(Array.isArray(lc.body) && lc.body.length === 1)) restBad.push('lastChanged ej läsbar');
    if (!(Array.isArray(rp.body) && rp.body.length === 1)) restBad.push('ronderingspass ej läsbar');
    rep.add('C5 REST ' + role, rest.status === 200 && restBad.length === 0, 'HTTP ' + rest.status + '; synliga känsliga nycklar: ' + [...seen].sort().join(',') + (restBad.length ? '; AVVIKER: ' + restBad.join('; ') : ''));
  }

  // Oinloggad: ingenting.
  const anon = await req('/rest/v1/store?select=key&limit=5', { method: 'GET' });
  rep.add('C5 oinloggad REST', Array.isArray(anon.body) ? anon.body.length === 0 : anon.status >= 400, 'HTTP ' + anon.status + ', rader ' + (Array.isArray(anon.body) ? anon.body.length : '-'));
  const anonEf = await req('/functions/v1/store-key-write', { body: { action: 'readAllWithHashes' } });
  rep.add('C5 oinloggad readAllWithHashes', anonEf.status === 401 || anonEf.status === 403, 'HTTP ' + anonEf.status);

  const f = rep.save({ projekt: env.ref });
  const bad = rep.results.filter((x) => x.ok === false).length;
  console.log('\n' + rep.results.filter((x) => x.ok === true).length + ' OK, ' + bad + ' avvikelser. Rapport: ' + f);
  process.exit(bad ? 1 : 0);
})();
