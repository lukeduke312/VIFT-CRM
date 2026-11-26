'use strict';
/*
 * T4-B (2026-11-28): den simulerade serverns kopia av T4-B:s regler (SÄK-17, SEC-SIM-01).
 * Speglar exakt vift-v2 supabase/migrations/20261128000011_t4b_material_priser_tid.sql (_vift_t4b_*,
 * work_order_material_*, time_entry_correct och de ändrade funktionerna) och
 * supabase/functions/_shared/vift-auth.ts (canReadPrices, projectTimeEntry). Ändras en regel på
 * servern ska den ändras här i samma ändring; paritetstesterna (tests/sim_parity.test.js och vift-v2
 * tests/paritet_fake_kopia.test.js) jämför utfallen. Samma fil finns i vift-v2/tests/e2e/.
 *
 * Fel kastas som { t4b: [status, error, reason] } och översätts av fake-backenden till svar.
 */
const T4A = require('./t4a-regler');

const P = (p) => (Array.isArray(p) ? p : []);
const any = (p, l) => l.some((x) => P(p).includes(x));
const obj = (e) => !!e && typeof e === 'object' && !Array.isArray(e);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const fel = (status, error, reason) => { const e = new Error(error + (reason ? ':' + reason : '')); e.t4b = [status, error, reason || null]; throw e; };

/* _vift_ej_verkstallda() efter T4-B (time_view_all verkställd). */
const EJ_VERKSTALLDA = T4A.EJ_VERKSTALLDA.filter((x) => x !== 'time_view_all');
const PRICE_READ = ['ao_edit', 'ao_view_all', 'invoice_view', 'invoice_create', 'cost_view', 'article_manage', 'offer_manage'];
const prisLas = (p) => any(p, ['all'].concat(PRICE_READ));
const prisSatta = (p) => prisLas(p) && any(p, ['all', 'invoice_create', 'cost_edit']);
const inkopSatta = (p) => P(p).includes('all') || (P(p).includes('cost_view') && P(p).includes('cost_edit'));
const tillaggSatta = (p) => any(p, ['all', 'ao_edit', 'invoice_create']);
const kontor = (p) => any(p, ['all', 'ao_edit', 'invoice_create', 'payroll_manage']);

/* _vift_t4b_tal: tal ur JSON eller numerisk sträng, annars null. */
const tal = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\s*-?[0-9]{1,12}(\.[0-9]{1,6})?\s*$/.test(v)) return Number(v.trim());
  return null;
};
const tom = T4A.tom;
const idag = () => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Stockholm' }));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const imorgon = () => { const d = new Date(idag() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const datumOk = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s && s >= '2000-01-01' && s <= '2100-01-01';
const aoLast = (ao) => !!ao && (String(ao.deleted) === 'true' || String(ao.archived) === 'true' || ['fakturerad', 'avbruten'].includes(ao.status) || !!ao.invoiceId);
const tidLast = (ao) => aoLast(ao) || (!!ao && ao.status === 'klar');
const lage = (ao) => {
  const t = (ao && ao.priceType) || '';
  if (['fastpris', 'fast'].includes(t)) return 'fixed';
  if (['timpris', 'prisgrupp'].includes(t)) return 'hourly';
  if (['insats', 'enhet', 'tillfalle'].includes(t)) return 'unit';
  return 'unknown';
};

/* Gemensam prisupplösning (_vift_t4b_pris). get(k) läser ett store-värde. */
function pris(typ, ref, ctx, get) {
  ctx = ctx || {};
  if (!ref) return null;
  let ut;
  if (typ === 'article') {
    const a = (get('vift_articles') || []).find((e) => obj(e) && e.id === ref);
    if (!a) return null;
    const p = tal(a.sellPrice), b = tal(a.buyPrice), v = tal(a.vatRate);
    ut = { type: 'article', ref, name: a.name || '', unit: a.unit || 'st', unitPrice: p > 0 ? p : null, priceKnown: p > 0,
      buyPrice: b > 0 ? b : null, buyPriceKnown: b > 0, vatRate: v !== null && v >= 0 && v <= 100 ? v : 25, priceSource: p > 0 ? 'general' : 'unknown', priceSourceId: null };
  } else if (typ === 'priceGroup') {
    const g = (get('vift_priceGroups') || []).find((e) => obj(e) && e.id === ref);
    if (!g) return null;
    const p = tal(g.hourRate);
    ut = { type: 'priceGroup', ref, name: g.name || '', unit: 'tim', unitPrice: p !== null && p >= 0 ? p : null, priceKnown: p !== null && p >= 0, buyPrice: null, buyPriceKnown: false,
      vatRate: 25, priceSource: p !== null && p >= 0 ? 'general' : 'unknown', priceSourceId: null, active: !['false', '0'].includes(String(g.active === undefined ? 'true' : g.active)) };
  } else if (typ === 'service') {
    ut = { type: 'service', ref, name: '', unit: 'gång', unitPrice: null, priceKnown: false, buyPrice: null, buyPriceKnown: false, vatRate: 25, priceSource: 'unknown', priceSourceId: null };
  } else return null;
  const datum = ctx.date || idag();
  let best = null, rank = 0;
  for (const a of (get('vift_priceAgreements') || [])) {
    if (!obj(a) || a.type !== typ || a.ref !== ref || ['false', '0'].includes(String(a.active === undefined ? 'true' : a.active))) continue;
    const r = a.scope === 'contract' ? (ctx.contractId && a.scopeId === ctx.contractId ? 3 : 0)
      : a.scope === 'property' ? (ctx.propertyId && a.scopeId === ctx.propertyId ? 2 : 0)
        : a.scope === 'customer' ? (ctx.customerId && a.scopeId === ctx.customerId ? 1 : 0) : 0;
    if (!r) continue;
    if (a.validFrom && a.validFrom > datum) continue;
    if (a.validTo && a.validTo < datum) continue;
    const p = tal(a.unitPrice); if (p === null || p < 0) continue;
    if (r > rank) { best = a; rank = r; }
  }
  if (best) {
    const v = tal(best.vatRate);
    Object.assign(ut, { unitPrice: tal(best.unitPrice), priceKnown: true, vatRate: v !== null && v >= 0 && v <= 100 ? v : ut.vatRate, unit: best.unit || ut.unit, priceSource: best.scope, priceSourceId: best.id });
  }
  return ut;
}

/* Fakturastatus per källrad och alla anspråk (_vift_t4b_kalla_status, _vift_t4b_anspraak). */
const aktivFaktura = (inv) => obj(inv) && inv.status !== 'makulerad' && String(inv.deleted) !== 'true';
function anspraak(invoices) {
  const s = new Set();
  (invoices || []).filter(aktivFaktura).forEach((inv) => (inv.lines || []).forEach((l) => (l.sourceRefs || []).forEach((r) => { if (r && r.sourceKey) s.add(r.sourceKey); })));
  return s;
}
function kallaStatus(invoices, key) {
  let ut = null;
  for (const inv of (invoices || []).filter(aktivFaktura)) {
    for (const l of (inv.lines || [])) {
      if ((l.sourceRefs || []).some((r) => r && r.sourceKey === key)) {
        const st = inv.status === 'utkast' ? 'utkast' : 'fakturerad';
        if (!ut || (ut.status === 'utkast' && st === 'fakturerad')) ut = { status: st, invoiceId: inv.id, invoiceStatus: inv.status, lineId: l.id };
      }
    }
  }
  return ut || { status: 'ofakturerad' };
}

/* _vift_t4b_rad_kant */
const radKant = (row, f, flagga) => String(row && row[flagga]) !== 'true' && tal(row && row[f]) !== null && (tal(row[f]) > 0 || (tal(row[f]) === 0 && row.priceSource === 'manual'));

/* Gemensamt radformat per källrad (_vift_t4b_kallrad). */
function kallrad(key, wos, tes) {
  wos = Array.isArray(wos) ? wos : []; tes = Array.isArray(tes) ? tes : [];
  let m = /^(material|insats):([^:]+):(.+)$/.exec(key || '');
  if (m) {
    const typ = m[1];
    const ao = wos.find((e) => obj(e) && e.id === m[2]); if (!ao) return null;
    const lista = typ === 'material' ? ao.materials : ao.insatser;
    const row = (Array.isArray(lista) ? lista : []).find((e) => obj(e) && e.id === m[3]); if (!row) return null;
    const pf = typ === 'material' ? 'sellPrice' : 'unitPrice';
    const kant = radKant(row, pf, typ === 'material' ? 'sellPriceUnknown' : 'unitPriceUnknown');
    let bill = true, why = null;
    if (typ === 'material' && lage(ao) === 'fixed' && String(row.extra) !== 'true') { bill = false; why = 'included_in_fixed_price'; }
    else if (typ === 'insats' && !datumOk(row.performedDate)) { bill = false; why = 'performed_date_required'; }
    else if (String(row.billable) === 'false') { bill = false; why = 'source_not_billable'; }
    return { sourceKey: key, sourceType: typ, workOrderId: ao.id, sourceId: row.id, customerId: ao.customerId || '', qty: tal(row.qty), unit: row.unit || '',
      unitPrice: kant ? tal(row[pf]) : null, priceKnown: kant, vatRate: tal(row.vatRate) === null ? 25 : tal(row.vatRate),
      performedDate: row.performedDate || (typ === 'material' ? String(row.addedAt || '').slice(0, 10) : null), billable: bill, notBillableReason: why,
      aoDeleted: String(ao.deleted) === 'true', aoLegacyInvoiceId: ao.invoiceId || '' };
  }
  m = /^time:(.+)$/.exec(key || '');
  if (m) {
    const t = tes.find((e) => obj(e) && e.id === m[1]); if (!t || String(t.deleted) === 'true') return null;
    const ao = wos.find((e) => obj(e) && e.id === t.aoId) || null;
    const l = ao ? lage(ao) : 'unknown';
    const rate = tal(t.hourRate);
    const kant = String(t.hourRateUnknown) !== 'true' && rate !== null && rate > 0;
    let bill = true, why = null;
    if (String(t.billable) === 'false' || !ao) { bill = false; why = 'source_not_billable'; }
    else if (l === 'fixed') { bill = false; why = 'included_in_fixed_price'; }
    else if (l !== 'hourly') { bill = false; why = 'source_not_billable'; }
    const min = tal(t.minutes);
    return { sourceKey: key, sourceType: 'time', workOrderId: (ao && ao.id) || t.aoId || '', sourceId: t.id, customerId: (ao && ao.customerId) || '',
      qty: min !== null ? Math.round(min / 60 * 100) / 100 : tal(t.hours), unit: 'tim', unitPrice: kant ? rate : null, priceKnown: kant, vatRate: 25,
      performedDate: t.date || null, billable: bill, notBillableReason: why, aoDeleted: !!ao && String(ao.deleted) === 'true', aoLegacyInvoiceId: (ao && ao.invoiceId) || '' };
  }
  m = /^fixed:(.+)$/.exec(key || '');
  if (m) {
    const ao = wos.find((e) => obj(e) && e.id === m[1]); if (!ao) return null;
    const rate = tal(ao.fixedPrice); const kant = rate !== null && rate > 0;
    return { sourceKey: key, sourceType: 'fixed', workOrderId: ao.id, sourceId: ao.id, customerId: ao.customerId || '', qty: 1, unit: 'gång', unitPrice: kant ? rate : null,
      priceKnown: kant, vatRate: 25, performedDate: String(ao.completedAt || '').slice(0, 10) || null, billable: lage(ao) === 'fixed',
      notBillableReason: lage(ao) === 'fixed' ? null : 'source_not_billable', aoDeleted: String(ao.deleted) === 'true', aoLegacyInvoiceId: ao.invoiceId || '' };
  }
  return null;
}

/* Fakturavägens källkontroll (_vift_t4b_faktura_kallor). Kastar vid första felet. */
function fakturaKallor(inv, invoices, wos, tes) {
  for (const l of (inv.lines || [])) {
    if (!Array.isArray(l.sourceRefs) || !l.sourceRefs.length) continue;
    let forsta = null, flera = false;
    for (const r of l.sourceRefs) {
      const kr = kallrad(r && r.sourceKey, wos, tes);
      if (!kr || kr.aoDeleted) fel(409, 'source_not_found');
      if ((r.workOrderId && r.workOrderId !== kr.workOrderId) || (r.sourceType && r.sourceType !== kr.sourceType)) fel(400, 'invalid_source_ref');
      if (kr.aoLegacyInvoiceId) {
        const gammal = (invoices || []).find((e) => obj(e) && e.id === kr.aoLegacyInvoiceId);
        if (gammal && gammal.status !== 'makulerad' && String(gammal.sourceAware) !== 'true') fel(409, 'source_collision');
      }
      if (!kr.billable) fel(409, kr.notBillableReason || 'source_not_billable');
      if (!kr.priceKnown) fel(409, 'price_unknown');
      if (forsta === null) forsta = kr.unitPrice; else if (forsta !== kr.unitPrice) flera = true;
    }
    if (flera || typeof l.unitPrice !== 'number' || l.unitPrice !== forsta) fel(409, 'price_mismatch');
  }
}
/* _vift_t4b_faktura_pris_kontroll: okänt pris stoppar utskick. */
const prisKontroll = (inv) => { if ((inv.lines || []).some((l) => obj(l) && (typeof l.unitPrice !== 'number' || String(l.priceUnknown) === 'true'))) fel(409, 'price_unknown'); };

/* Ny materialrad (_vift_t4b_ny_rad). */
function nyRad(ao, inn, perms, me, now, id, get) {
  if (!obj(inn)) fel(400, 'invalid_row');
  const ign = [];
  const qty = tal(inn.qty);
  if (qty === null || qty <= 0 || qty > 100000 || Math.round(qty * 1000) !== qty * 1000) fel(400, 'invalid_row');
  const datum = inn.performedDate || idag();
  if (!datumOk(datum) || datum > imorgon()) fel(400, 'invalid_row');
  const note = inn.note == null ? '' : String(inn.note);
  if (note.length > 2000) fel(400, 'invalid_row');
  const art = String(inn.articleId || '').trim() || null;
  let name, unit, sp = null, spk = false, bp = null, bpk = false, vat = 25, src = 'unknown', srcId = null;
  if (art) {
    const pr = pris('article', art, { customerId: ao.customerId, propertyId: ao.propertyId, contractId: ao.contractId, date: datum }, get);
    if (!pr) fel(400, 'invalid_reference');
    name = String(inn.name || '').trim() || pr.name; unit = String(inn.unit || '').trim() || pr.unit;
    spk = pr.priceKnown; sp = spk ? pr.unitPrice : null; bpk = pr.buyPriceKnown; bp = bpk ? pr.buyPrice : null; vat = pr.vatRate; src = pr.priceSource; srcId = pr.priceSourceId;
    if ('sellPrice' in inn && !tom(inn.sellPrice)) ign.push('sellPrice');
    if ('buyPrice' in inn && !tom(inn.buyPrice)) ign.push('buyPrice');
    if ('vatRate' in inn && tal(inn.vatRate) !== vat && !tom(inn.vatRate)) ign.push('vatRate');
  } else {
    name = String(inn.name || '').trim(); unit = String(inn.unit || '').trim() || 'st';
    if ('sellPrice' in inn && !tom(inn.sellPrice)) { if (prisSatta(perms) && tal(inn.sellPrice) > 0) { sp = tal(inn.sellPrice); spk = true; src = 'manual'; } else ign.push('sellPrice'); }
    if ('buyPrice' in inn && !tom(inn.buyPrice)) { if (inkopSatta(perms) && tal(inn.buyPrice) > 0) { bp = tal(inn.buyPrice); bpk = true; } else ign.push('buyPrice'); }
    if ('vatRate' in inn && !tom(inn.vatRate)) {
      const v = tal(inn.vatRate);
      if (prisSatta(perms) && v !== null && v >= 0 && v <= 100) vat = v; else if (v !== 25) ign.push('vatRate');
    }
  }
  if (!name || name.length > 200 || !unit || unit.length > 20) fel(400, 'invalid_row');
  let extra = false;
  if ('extra' in inn && String(inn.extra) === 'true') { if (tillaggSatta(perms)) extra = true; else ign.push('extra'); }
  return { row: { id, articleId: art || '', name, qty, unit, note, performedDate: datum, sellPrice: sp, sellPriceUnknown: !spk, buyPrice: bp, buyPriceUnknown: !bpk,
    vatRate: vat, priceSource: src, priceSourceId: srcId, extra, addedBy: me, addedAt: now, updatedAt: now, updatedBy: me }, ignored: ign };
}

/* Arbetsledarens hela materiallista (_vift_t4b_material_lista). Körs efter T4A.aoPatch. */
function materialLista(ao, ny, perms, me, now, invoices, get) {
  const old = Array.isArray(ao.materials) ? ao.materials : [];
  const claim = anspraak(invoices);
  if (!Array.isArray(ny) || ny.length > 500) fel(400, 'missing_fields');
  const ut = [], ign = [], ids = [];
  const addIgn = (f) => { if (!ign.includes('materials[].' + f)) ign.push('materials[].' + f); };
  const lika = (a, b) => T4A.lika(a, b);
  for (const n of ny) {
    if (!obj(n)) fel(400, 'invalid_row');
    const o = n.id ? old.find((e) => obj(e) && e.id === n.id) : null;
    let mm;
    if (!o) {
      const id = typeof n.id === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(n.id) && !ids.includes(n.id) ? n.id : 'M-' + Math.random().toString(16).slice(2, 18);
      const b = nyRad(ao, n, perms, me, now, id, get);
      mm = b.row; b.ignored.forEach(addIgn);
      ['addedBy', 'addedAt', 'priceSource', 'priceSourceId', 'sellPriceUnknown', 'buyPriceUnknown', 'updatedAt', 'updatedBy'].forEach((f) => { if (f in n) addIgn(f); });
    } else {
      mm = clone(n);
      for (const f of ['addedBy', 'addedAt', 'priceSource', 'priceSourceId', 'sellPriceUnknown', 'buyPriceUnknown', 'articleId']) {
        if (f in o) { if (!(f in n) || !lika(n[f], o[f])) { if (f in n) addIgn(f); mm[f] = clone(o[f]); } }
        else if (f in n) { delete mm[f]; addIgn(f); }
      }
      const spk = radKant(o, 'sellPrice', 'sellPriceUnknown');
      if (!('sellPrice' in n)) { if ('sellPrice' in o) mm.sellPrice = o.sellPrice; }
      else if ('sellPrice' in o && tal(n.sellPrice) === tal(o.sellPrice) && tom(n.sellPrice) === tom(o.sellPrice)) mm.sellPrice = o.sellPrice;
      else if (!spk && (tom(n.sellPrice) || tal(n.sellPrice) === 0)) { if ('sellPrice' in o) mm.sellPrice = o.sellPrice; else delete mm.sellPrice; addIgn('sellPrice'); }
      else if (prisSatta(perms) && tom(n.sellPrice)) Object.assign(mm, { sellPrice: null, sellPriceUnknown: true, priceSource: 'unknown' });
      else if (prisSatta(perms) && tal(n.sellPrice) !== null && tal(n.sellPrice) >= 0) Object.assign(mm, { sellPrice: tal(n.sellPrice), sellPriceUnknown: false, priceSource: 'manual', priceSourceId: null });
      else fel(403, 'forbidden', 'field_protected');
      if ('buyPrice' in n && String(o.buyPriceUnknown) === 'true' && (tom(n.buyPrice) || tal(n.buyPrice) === 0)) { if ('buyPrice' in o) mm.buyPrice = o.buyPrice; else delete mm.buyPrice; addIgn('buyPrice'); }
      else if ('buyPrice' in n && String(o.buyPriceUnknown) === 'true' && tal(n.buyPrice) > 0) mm.buyPriceUnknown = false;
      if ('vatRate' in n && 'vatRate' in o && tal(n.vatRate) !== tal(o.vatRate)) {
        if (!prisSatta(perms)) fel(403, 'forbidden', 'field_protected');
        if (!(tal(n.vatRate) >= 0 && tal(n.vatRate) <= 100)) fel(400, 'invalid_row');
      } else if (!('vatRate' in n) && 'vatRate' in o) mm.vatRate = o.vatRate;
      if (String('extra' in n ? n.extra : 'false') !== String('extra' in o ? o.extra : 'false')) {
        if (!('extra' in n)) mm.extra = o.extra; else if (!tillaggSatta(perms)) fel(403, 'forbidden', 'field_protected');
      }
      const ren = (x) => { const c = clone(x); delete c.updatedAt; delete c.updatedBy; return c; };
      if (claim.has('material:' + ao.id + ':' + o.id) && !lika(ren(mm), ren(o))) fel(409, 'invoiced_locked');
      if (!lika(mm, o)) Object.assign(mm, { updatedAt: now, updatedBy: me });
    }
    ids.push(mm.id); ut.push(mm);
  }
  for (const o of old) if (obj(o) && o.id && !ids.includes(o.id) && claim.has('material:' + ao.id + ':' + o.id)) fel(409, 'invoiced_locked');
  return { rows: ut, ignored: ign };
}

/* Behörighets- och låskontroll för en rad (_vift_t4b_rad_kontroll). eff = effektiva AO-behörigheter. */
function radKontroll(ao, row, eff, me, invoices, has) {
  if (!has(eff, 'ao_edit')) {
    if (!((Array.isArray(ao.staff) && ao.staff.map(String).includes(me)) || has(eff, 'ao_view_all'))) fel(403, 'forbidden', 'not_assigned');
    if ((row.addedBy || '') !== me) fel(403, 'forbidden', 'not_own_row');
  }
  if (aoLast(ao)) fel(409, 'ao_locked');
  if (kallaStatus(invoices, 'material:' + ao.id + ':' + row.id).status !== 'ofakturerad') fel(409, 'invoiced_locked');
}

/* Uppdatering av en rad (work_order_material_update). Returnerar {row, ignored, kompletterad}. */
function radUppdatera(row, patch, perms, me, now) {
  const n = clone(row); const ign = [];
  const varOkand = !radKant(row, 'sellPrice', 'sellPriceUnknown');
  for (const f of Object.keys(patch)) {
    const v = patch[f];
    if (f === 'qty') { const q = tal(v); if (q === null || q <= 0 || q > 100000 || Math.round(q * 1000) !== q * 1000) fel(400, 'invalid_row'); n.qty = q; }
    else if (f === 'unit') { if (!String(v || '').trim() || String(v).length > 20) fel(400, 'invalid_row'); n.unit = String(v).trim(); }
    else if (f === 'name') { if (!String(v || '').trim() || String(v).length > 200) fel(400, 'invalid_row'); n.name = String(v).trim(); }
    else if (f === 'note') { if (String(v == null ? '' : v).length > 2000) fel(400, 'invalid_row'); n.note = v == null ? '' : String(v); }
    else if (f === 'performedDate') { if (!datumOk(v) || v > imorgon()) fel(400, 'invalid_row'); n.performedDate = v; }
    else if (f === 'sellPrice') {
      if (!prisSatta(perms)) fel(403, 'forbidden', 'field_protected');
      if (tom(v)) Object.assign(n, { sellPrice: null, sellPriceUnknown: true, priceSource: 'unknown', priceSourceId: null });
      else if (tal(v) !== null && tal(v) >= 0) Object.assign(n, { sellPrice: tal(v), sellPriceUnknown: false, priceSource: 'manual', priceSourceId: null });
      else fel(400, 'invalid_row');
    } else if (f === 'buyPrice') {
      if (!inkopSatta(perms)) fel(403, 'forbidden', 'field_protected');
      if (tom(v)) Object.assign(n, { buyPrice: null, buyPriceUnknown: true });
      else if (tal(v) !== null && tal(v) >= 0) Object.assign(n, { buyPrice: tal(v), buyPriceUnknown: false });
      else fel(400, 'invalid_row');
    } else if (f === 'vatRate') {
      if (!prisSatta(perms)) fel(403, 'forbidden', 'field_protected');
      if (!(tal(v) !== null && tal(v) >= 0 && tal(v) <= 100)) fel(400, 'invalid_row');
      n.vatRate = tal(v);
    } else if (f === 'extra') {
      if (!tillaggSatta(perms)) fel(403, 'forbidden', 'field_protected');
      if (typeof v !== 'boolean') fel(400, 'invalid_row');
      n.extra = v;
    } else ign.push(f);
  }
  Object.assign(n, { updatedAt: now, updatedBy: me });
  return { row: n, ignored: ign, kompletterad: varOkand && radKant(n, 'sellPrice', 'sellPriceUnknown') };
}

/* Projektioner. */
const TIME_VIEW_ALL_FIELDS = ['id', 'aoId', 'staffId', 'staffName', 'date', 'startStr', 'endStr', 'minutes', 'hours', 'comment',
  'priceGroupId', 'priceGroupName', 'billable', 'internal', 'deleted', 'createdAt', 'updatedAt', 'startTs'];
function projectTimeEntry(e, perms, me) {
  if (!obj(e) || P(perms).includes('all')) return e;
  let ut = clone(e);
  const own = String(e.staffId || '') === String(me || '');
  if (!own && !P(perms).includes('payroll_view')) {
    ut = {}; TIME_VIEW_ALL_FIELDS.forEach((f) => { if (f in e) ut[f] = clone(e[f]); });
    if (prisLas(perms) && 'hourRate' in e) ut.hourRate = e.hourRate;
  }
  if (!prisLas(perms)) delete ut.hourRate;
  return ut;
}
function projectWorkOrder(ao, perms) {
  const ut = T4A.projectWorkOrder(ao, perms);
  if (!obj(ut) || P(perms).includes('all') || prisLas(perms)) return ut;
  const r = Object.assign({}, ut);
  if (Array.isArray(r.materials)) r.materials = r.materials.map((m) => { if (!obj(m)) return m; const c = Object.assign({}, m); delete c.sellPrice; return c; });
  if (Array.isArray(r.insatser)) r.insatser = r.insatser.map((m) => { if (!obj(m)) return m; const c = Object.assign({}, m); delete c.unitPrice; return c; });
  return r;
}
const artikel = (e, perms) => (obj(e) && !prisLas(perms) ? (() => { const c = Object.assign({}, e); delete c.sellPrice; return c; })() : e);
const prisgrupper = (lista, perms) => (prisLas(perms) ? lista : (Array.isArray(lista) ? lista : []).filter((e) => obj(e) && !['false', '0'].includes(String(e.active === undefined ? 'true' : e.active)))
  .map((e) => Object.fromEntries(Object.entries(e).filter(([k]) => ['id', 'name', 'active', 'billingType', 'sortOrder'].includes(k)))));

module.exports = {
  EJ_VERKSTALLDA, PRICE_READ, prisLas, prisSatta, inkopSatta, tillaggSatta, kontor, tal, idag, datumOk, aoLast, tidLast, lage, pris,
  anspraak, kallaStatus, radKant, kallrad, fakturaKallor, prisKontroll, nyRad, materialLista, radKontroll, radUppdatera,
  projectTimeEntry, projectWorkOrder, artikel, prisgrupper, fel,
};
