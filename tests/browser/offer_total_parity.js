#!/usr/bin/env node
/*
 * Totalsummeparitet: kundsidan (public-offer.html, renderad i riktig
 * Chromium) mot CRM:ets kanoniska OfferCalc.totals(). Slumpade offerter med
 * kantfall (moms 25/12/6/0/null/''/ogiltig, rabatt % och kr > delsumma,
 * återkommande/à-pris-rader, tillval in/ur totalen, RUT/ROT, tjänsterader med
 * decimal-exVat, äldre rader med bara `price`). offer-token-validate
 * mockas; inga nätverksanrop lämnar maskinen.
 * Kör: node tests/browser/offer_total_parity.js [antal=60]
 */
'use strict';
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const OfferCalc = require(path.join(ROOT, 'src/shared/OfferCalc.js'));
const N = Number(process.argv[2] || 60);

let seed = 42;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
function randomOffer(i, opts) {
  const vats = [25, 25, 25, 12, 6, 0, null, '', '25', 'abc', 150];
  const lines = [];
  const nl = 1 + Math.floor(rnd() * 6);
  for (let k = 0; k < nl; k++) {
    const bt = pick(['onetime', 'onetime', 'onetime', undefined, 'recurring', 'rate']);
    const type = pick(['product', 'product', 'service', 'text']);
    const l = { id: 'L' + k, type, billingType: bt, name: 'Rad ' + k, vatRate: pick(vats), unit: 'st' };
    if (type === 'service') l.exVat = Math.round(rnd() * 500000) / 100;
    else if (opts.legacyPrice && rnd() < 0.3) { l.price = Math.round(rnd() * 3000); l.qty = 1 + Math.floor(rnd() * 3); }
    else { l.unitPrice = Math.round(rnd() * 3000); l.qty = pick([1, 2, 3, 0.5, 1.25, '', null]); }
    if (rnd() < 0.25) l.rutAmount = Math.round(rnd() * 2000);
    lines.push(l);
  }
  const extras = [];
  for (let k = 0; k < Math.floor(rnd() * 3); k++) extras.push({ id: 'E' + k, name: 'Tillval ' + k, qty: pick([1, 2, '2']), unitPrice: Math.round(rnd() * 900), vatRate: pick(vats), includedInTotal: pick([true, false, undefined]) });
  const discount = pick([{ type: 'none', value: 0 }, { type: 'percent', value: pick([10, 15, 120]) }, { type: 'amount', value: pick([100, 999999]) }]);
  return { id: 'OFF-' + i, number: 'OFF-' + i, title: 'Test ' + i, status: 'skickad', customerName: 'Testkund', lines, extras, discount, version: 1 };
}

const num = (t) => Number(String(t).replace(/[^\d−-]/g, '').replace('−', '-'));

(async () => {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/public-offer.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html' : p.endsWith('.js') ? 'application/javascript' : 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  }).listen(0);
  await new Promise((r) => srv.once('listening', r));
  const port = srv.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let current = null;
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.includes('/functions/v1/offer-token-validate')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ offer: current, attachments: [] }) });
    if (u.startsWith('http://127.0.0.1:' + port)) return route.continue();
    return route.abort();
  });

  const results = { total: 0, mismatches: [] };
  for (const legacy of [false, true]) {
    for (let i = 0; i < N; i++) {
      current = randomOffer(i, { legacyPrice: legacy });
      await page.goto('http://127.0.0.1:' + port + '/public-offer.html?t=test-token-' + i, { waitUntil: 'load' });
      await page.waitForSelector('.po-total-row.main, .po-totals .po-status-banner', { timeout: 5000 }).catch(() => {});
      /* G8 (2026-11-23): en offert där RUT/ROT > totalen visar ingen summa
         (aldrig negativt "att betala") utan en varning, och kan inte godkännas. */
      if (!OfferCalc.validate(current).ok) {
        const warned = await page.evaluate(() => /behöver kontrolleras/.test(document.body.innerText) && !document.querySelector('.po-total-row.main') && !/Godkänn offert/.test(document.body.innerText));
        results.total++; results.invalid = (results.invalid || 0) + 1;
        if (!warned) results.mismatches.push({ legacy, i, got: 'ingen varning', exp: 'varning' });
        continue;
      }
      const shown = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('.po-total-row'));
        const get = (re) => { const r = rows.find((x) => re.test(x.children[0].textContent)); return r ? r.children[1].textContent : null; };
        return { ex: get(/exkl\. moms$/), vat: get(/^Moms$/), pay: get(/att betala$/) };
      });
      const t = OfferCalc.totals(current);
      const expectPay = t.rutRotAmount ? t.customerPays : t.totalInclVat;
      results.total++;
      const got = { ex: num(shown.ex), vat: num(shown.vat), pay: num(shown.pay) };
      const exp = { ex: Math.round(t.exVatAfterDiscount), vat: t.vatAmount, pay: Math.round(expectPay) };
      if (got.ex !== exp.ex || got.vat !== exp.vat || got.pay !== exp.pay) results.mismatches.push({ legacy, i, got, exp });
    }
  }
  await browser.close(); srv.close();
  console.log('Offerter jämförda: ' + results.total + ' (varav ' + (results.invalid || 0) + ' ogiltiga med varning), avvikelser: ' + results.mismatches.length);
  const byKind = { modern: results.mismatches.filter((m) => !m.legacy).length, legacyPrice: results.mismatches.filter((m) => m.legacy).length };
  console.log('Avvikelser — nya data: ' + byKind.modern + ', med äldre `price`-rader: ' + byKind.legacyPrice);
  results.mismatches.slice(0, 6).forEach((m) => console.log('  ' + (m.legacy ? '[legacy] ' : '') + 'OFF-' + m.i + ' kundsida=' + JSON.stringify(m.got) + ' OfferCalc=' + JSON.stringify(m.exp)));
  process.exit(results.mismatches.length ? 1 : 0);
})();
