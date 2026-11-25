'use strict';
/*
 * T3-0 testverktyg: kontrollsummor (KS), förväntade avslag och samtidighet.
 *
 * KS (BEHORIGHETSMATRIS §5.1, lokalt): md5 av hela store-värdet + updated_at per nyckel,
 * och md5 över alla rader (sorterade) + antal för tabeller. vift_lastChanged ingår alltid.
 *
 *   const ks = ksTa(db, { keys: ['vift_workOrders'], tables: ['stamp_status'] })
 *   ksDiff(ks, ksTa(db, ...))  -> [] om oförändrat, annars namnen på det som ändrats
 *
 *   await expectReject(db, () => anrop(), { status: 403, error: 'forbidden', reason: 'not_assigned' },
 *                      { keys: [...], tables: [...] })
 *     -> { ok, fel: [...], svar, andrat: [...] }
 *     Godkänt bara om status, error OCH reason (när den anges; reason:null kräver att
 *     svaret saknar reason) stämmer exakt OCH KS är oförändrad. Generiska fel
 *     (500/write_failed) godkänns aldrig som avslag.
 *
 *   parallellt(n, (i) => promise)  — n samtidiga anrop (egna anslutningar)
 *   upprepa(n, async (i) => ...)    — upprepning för samtidighetsfall (20–50 gånger)
 */
const { psql, lit } = require('./db');

const STD_KEYS = ['vift_lastChanged'];

function ksTa(db, spec) {
  spec = spec || {};
  const keys = Array.from(new Set(STD_KEYS.concat(spec.keys || [])));
  const out = {};
  if (keys.length) {
    const rows = psql(db, `select k, coalesce((select md5(value::text) || ':' || coalesce(updated_at::text, '-') from public.store where key = k), 'saknas')
      from unnest(array[${keys.map(lit).join(',')}]::text[]) k`).split('\n').filter(Boolean);
    rows.forEach((r) => { const [k, v] = r.split('|'); out['store:' + k] = v; });
  }
  for (const t of spec.tables || []) {
    out['tabell:' + t] = psql(db, `select count(*) || ':' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') from ${t} x`);
  }
  return out;
}
function ksDiff(a, b) {
  return Object.keys(Object.assign({}, a, b)).filter((k) => a[k] !== b[k]);
}

function matchSvar(svar, f) {
  const fel = [];
  const body = (svar && svar.body) || {};
  if (f.status !== undefined && svar.status !== f.status) fel.push('status ' + svar.status + ' ≠ ' + f.status);
  if (f.error !== undefined && body.error !== f.error) fel.push('error ' + JSON.stringify(body.error) + ' ≠ ' + JSON.stringify(f.error));
  if (f.reason !== undefined) {
    if (f.reason === null ? body.reason !== undefined : body.reason !== f.reason) fel.push('reason ' + JSON.stringify(body.reason) + ' ≠ ' + JSON.stringify(f.reason));
  }
  if (svar.status >= 500 || body.error === 'write_failed') fel.push('generiskt serverfel godkänns aldrig som avslag');
  return fel;
}

async function expectReject(db, anrop, forvantat, ksSpec) {
  const fore = ksTa(db, ksSpec);
  const svar = await anrop();
  const efter = ksTa(db, ksSpec);
  const andrat = ksDiff(fore, efter);
  const fel = matchSvar(svar, forvantat);
  if (andrat.length) fel.push('KS ändrad: ' + andrat.join(', '));
  return { ok: fel.length === 0, fel, svar, andrat };
}

/* Positivt fall: förväntat svar och att BARA de angivna resurserna ändrats. */
async function expectAccept(db, anrop, forvantat, ksSpec, skaAndras) {
  const fore = ksTa(db, ksSpec);
  const svar = await anrop();
  const efter = ksTa(db, ksSpec);
  const andrat = ksDiff(fore, efter);
  const fel = [];
  if (forvantat.status !== undefined && svar.status !== forvantat.status) fel.push('status ' + svar.status + ' ≠ ' + forvantat.status + ' ' + JSON.stringify(svar.body).slice(0, 200));
  const tillatna = new Set((skaAndras || []).concat(['store:vift_lastChanged']));
  const ovantat = andrat.filter((k) => !tillatna.has(k));
  if (ovantat.length) fel.push('oväntat ändrat: ' + ovantat.join(', '));
  return { ok: fel.length === 0, fel, svar, andrat };
}

/* BASLINJE-fynd: bristen ska synas, dvs. anropet GODKÄNNS och muterar trots att den
   fastställda regeln säger avslag. Returnerar ok=true när bristen är bevisad. */
async function expectBaslinje(db, anrop, beskrivning, ksSpec, villkor) {
  const fore = ksTa(db, ksSpec);
  const svar = await anrop();
  const efter = ksTa(db, ksSpec);
  const andrat = ksDiff(fore, efter);
  const bevisad = villkor({ svar, andrat, fore, efter });
  return { ok: !!bevisad, svar, andrat, beskrivning };
}

const parallellt = (n, fn) => Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
async function upprepa(n, fn) { const r = []; for (let i = 0; i < n; i++) r.push(await fn(i)); return r; }

module.exports = { ksTa, ksDiff, matchSvar, expectReject, expectAccept, expectBaslinje, parallellt, upprepa };
