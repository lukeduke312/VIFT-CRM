'use strict';
/*
 * NIVÅ 2 — webbläsartest mot RIKTIG STAGING (2026-11-24). Kräver GO.
 *
 * Återanvänder E2E-bibliotekets sessioner (tests/e2e/lib.js) i "riktigt
 * läge": sidan hämtas från den publicerade webbplatsen och Supabase-anropen
 * går till den riktiga STAGING-servern. Inget går mot LIVE:
 *   - samma spärrar som authz-mutation (lib.guard(2)): --jag-har-go,
 *     --mutationstest, --bekrafta-projekt=<ref>, GODKÄNT STAGING-projekt
 *     (hashlås), VIFT_MILJO=staging, testkontomönster;
 *   - webbplatsen måste vara https://staging-crm.viftfast.se;
 *   - lib.js vägrar riktigt läge om inte denna fil satt sin spärrnyckel, och
 *     underkänner varje anrop till ett annat Supabase-projekt.
 *
 * Även inloggning kan ge automatiska skrivningar (t.ex. serviceintervallens
 * dagliga kontroll som skapar uppgifter). Därför: ögonblicksbild före och
 * efter (adminkontot), journal före varje egen mutation, städning alltid,
 * och redovisning av automatiska ändringar separat.
 *
 * Flöden (alla på egna testposter märkta [E2E-TEST]):
 *   R0  Sidor per roll: alla sidor rollen får se öppnas utan JS-fel.
 *   F2  Checklista: påbörja → utförd på mobil; AO-status oförändrad.
 *   F3  Stämpling: in på mobil, syns på dator, ut på dator → exakt EN tidpost.
 *   F4  Två användare lägger loggpost samtidigt på samma AO → båda finns.
 *   F5  Nätavbrott under loggpost → aldrig "sparad" offline; skickas en gång.
 *   (F6 behörighet: tests/staging/authz-mutation.js. Ekonomikedjan kund →
 *   offert → kundlänk → AO → faktura: manuella testfall i installationsplanen.)
 *
 * Återhämtning (2026-11-25): samma modul som authz-mutation
 * (tests/staging/recovery.js) — journal före varje mutation, städning från
 * journalen även vid nätverksfel/avbrott, efterkontroll, spärrfil som
 * blockerar alla nivå 2-körningar tills testposterna är verifierat
 * borttagna, --stada=<runId>. Utgångskoder som authz-mutation: 0 OK,
 * 1 avvikelse, 2 spärr, 3 testposter kvar/efterkontroll saknas, 4 befintliga
 * poster ändrade (aldrig godkänt), 5 avbruten men efterkontrollerad.
 *
 *   ... node tests/staging/e2e-real.js --jag-har-go --mutationstest --bekrafta-projekt=<ref> [--flode=R0,F2,...] [--torrkorning]
 *   ... node tests/staging/e2e-real.js --jag-har-go --mutationstest --bekrafta-projekt=<ref> --stada=<runId>
 * Lokal provning (ingen nätverkstrafik ut): VIFT_LOKALT_TESTLAGE=1 med
 *   VIFT_SUPABASE_URL=http://127.0.0.1:<port> och --paket=<katalog>.
 */
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const { createRecovery, assertNoOpenLocks } = require('./recovery');

const env = L.guard(2);
const { pw, emails } = L.accounts(['admin', 'falt', 'chef', 'ekonomi', 'begransad'], ['falt2']);
const SITE = 'https://staging-crm.viftfast.se';
const STAGING_SUPA = 'https://yyzljlqyzzcbxmcdbual.supabase.co';
const paket = typeof L.arg('paket') === 'string' ? path.resolve(L.arg('paket')) : null;
if (env.local && !paket) L.refuse('lokal provning kräver --paket=<katalog med publiceringspaketet>.');
/* Förhandsprov (2026-11-24): riktig STAGING-server med ett LOKALT serverat
   publiceringspaket — för att prova ett nytt paket innan det laddas upp.
   Paketets storage.js måste peka på exakt STAGING och inget LIVE-spår får
   finnas (utom AuthService.js återställningslänkar, som byggskriptet). */
if (!env.local && paket) {
  const st = fs.readFileSync(path.join(paket, 'src/data/storage.js'), 'utf8');
  if (!st.includes("const SUPABASE_URL  = 'https://yyzljlqyzzcbxmcdbual.supabase.co'") && !/SUPABASE_URL\s*=\s*'https:\/\/yyzljlqyzzcbxmcdbual\.supabase\.co'/.test(st)) L.refuse('paketets storage.js pekar inte på STAGING.');
  if (st.includes(L.LIVE_REF)) L.refuse('paketets storage.js innehåller LIVE.');
}
const FLOWS = (typeof L.arg('flode') === 'string' ? L.arg('flode') : 'R0,F2,F3,F4,F5').split(',');
const DRY = L.arg('torrkorning') === true;
const CLEAN_ONLY = typeof L.arg('stada') === 'string' ? L.arg('stada') : null;
if (CLEAN_ONLY && !/^E2E-AUTHZ-\d{14}-[0-9a-f]{6}$/.test(CLEAN_ONLY)) L.refuse('--stada=<runId> måste vara ett runId av formen E2E-AUTHZ-ååååmmddttmmss-xxxxxx.');

process.env.VIFT_E2E_REAL = '1';
process.env.VIFT_E2E_REAL_GUARD = 'godkand-av-e2e-real';
process.env.VIFT_E2E_SUPA = STAGING_SUPA;
if (env.local) { process.env.VIFT_E2E_ROOT = paket; process.env.VIFT_E2E_FORWARD = env.sb; }
else if (paket) process.env.VIFT_E2E_ROOT = paket;   // förhandsprov: lokalt paket, riktig STAGING
else process.env.VIFT_E2E_BASEURL = SITE;
const E = require('../e2e/lib.js');
const { req, login } = L.client(env);
const runId = CLEAN_ONLY || L.newRunId();
const rep = L.reporter(CLEAN_ONLY ? 'e2e-real-stadning' : 'e2e-real', runId);
assertNoOpenLocks(L, rep.dir, CLEAN_ONLY); // ostädad tidigare körning blockerar (före första anropet)
const tok = {};
const R = createRecovery({ L, req, admin: () => tok.admin, runId, dir: rep.dir, ref: env.ref,
  keys: ['vift_customers', 'vift_offers', 'vift_activities', 'vift_properties', 'vift_contracts'], loginFor: (k) => login(emails[k], pw) });
const note = R.note;
const journalFile = R.journalFile;
const ids = {};
const today = () => new Date().toISOString().slice(0, 10);

const listAO = async () => ((await req('/functions/v1/work-orders-list', { method: 'GET', token: tok.admin })).body.workOrders || []);
const listTE = async () => ((await req('/functions/v1/time-entries-list', { method: 'GET', token: tok.admin })).body.timeEntries || []);

async function createTestAO(suffix, extra) {
  const id = runId + '-' + suffix;
  const ao = Object.assign({ id, title: '[E2E-TEST] ' + suffix + ' ' + runId, status: 'planerad', priority: 'normal', staff: [ids.falt].concat(ids.falt2 ? [ids.falt2] : []), customerId: '', scheduledDate: today(), log: [], materials: [], checklist: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), e2eTest: runId }, extra || {});
  note({ typ: 'ao', id });
  const r = await req('/functions/v1/ao-time-write', { token: tok.admin, body: { action: 'create_ao', ao, idempotencyKey: runId + '-c-' + suffix } });
  if (r.status !== 200) throw new Error('kunde inte skapa test-AO ' + suffix + ' (HTTP ' + r.status + ' ' + (r.body.error || '') + ')');
  const real = (r.body.workOrder && r.body.workOrder.id) || id;
  if (real !== id) note({ typ: 'ao', id: real });
  return real;
}


/* ── Affärsflöde (2026-11-24): hjälpare ─────────────────────────────── */
const zlib = require('zlib');
const readKey = async (key) => ((await req('/functions/v1/store-key-write', { token: tok.admin, body: { action: 'readWithHash', key } })).body.value) || [];
const readAll = async (key) => { const r = await req('/functions/v1/store-key-write', { token: tok.admin, body: { action: 'readAllWithHashes', keys: [key] } }); return ((r.body.data || {})[key.replace(/^vift_/, '')]) || []; };
/* Journalposten för ett element måste bära serverns AKTUELLA värde för att städningen ska godtas. */
async function trackElement(key, id) {
  const cur = (await readKey(key)).find((x) => x.id === id);
  const ex = R.journal.find((e) => e.typ === 'element' && e.key === key && e.id === id);
  if (ex) { ex.data = cur || ex.data; R.saveJournal(); } else note({ typ: 'element', key, id, data: cur || null });
  return cur;
}
async function refreshTracked() { for (const e of R.journal.filter((x) => x.typ === 'element' && x.status !== 'borttagen')) await trackElement(e.key, e.id); }
const pdfText = (buf) => { let out = buf.toString('latin1'); const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g; let m; while ((m = re.exec(buf.toString('latin1')))) { try { out += zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch (e) {} } out += ' ' + (out.match(/<([0-9A-Fa-f]{2,})>/g) || []).map((h) => Buffer.from(h.slice(1, -1), 'hex').toString('latin1')).join(' '); return out; };
const kr = (n) => new Intl.NumberFormat('sv-SE').format(Math.round(n)).replace(/[  ]/g, ' ');
async function step(name, fn) { try { const r = await fn(); return r; } catch (e) { rep.add(name, false, 'avbröts: ' + String(e.message).slice(0, 250)); return undefined; } }
async function createOfferViaWizard(s, { title, customerId, lines }) {
  await s.go('pg-offer');
  await s.page.locator('.page.active button', { hasText: 'Ny offert' }).first().click();
  await s.page.waitForSelector('#off-title', { state: 'visible' });
  await s.page.fill('#off-title', title);
  await s.eval((c) => { const e = document.getElementById('off-cu'); e.value = c; e.dispatchEvent(new Event('change', { bubbles: true })); }, customerId);
  await s.page.locator('button:visible', { hasText: /Nästa: Tjänster/ }).click();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    await s.page.locator('button:visible', { hasText: /Löpande rad/ }).click();
    await s.settle(200);
    await s.page.locator('#off-lines .off-wiz-line-field-desc').nth(i).fill(l.desc);
    const q = s.page.locator('#off-lines input[type=number]').nth(i); await q.fill(String(l.qty)); await q.dispatchEvent('change');
    const pr = s.page.locator('#off-lines .off-money-input').nth(i); await pr.fill(l.price); await pr.dispatchEvent('change');
    if (l.vat != null) await s.eval(([idx, v]) => { const sel = document.querySelectorAll('#off-lines select')[idx * 3 + 1]; if (sel) { sel.value = String(v); sel.dispatchEvent(new Event('change', { bubbles: true })); } }, [i, l.vat]);
  }
  await s.settle(400);
  const pairs = await s.eval(() => { const lines = (document.getElementById('off-totals-bar') || document.body).innerText.split('\n').map((x) => x.trim()).filter(Boolean); const out = {}; for (let i = 0; i < lines.length - 1; i++) if (/^(Summa ex\. moms|Moms|Totalt inkl\. moms)$/.test(lines[i]) && !(lines[i] in out)) out[lines[i]] = lines[i + 1]; return out; });
  await s.page.locator('button:visible', { hasText: /Nästa: Villkor/ }).click();
  await s.page.locator('button:visible', { hasText: /Spara offert/ }).click();
  await s.waitToast(/skapad/i, 15000);
  await s.settle(1500);
  return pairs;
}
async function newCustomerAndProperty(s, tag) {
  const name = '[E2E-TEST] Kund ' + tag + ' ' + runId;
  await s.go('pg-crm');
  await s.page.locator('.page.active button', { hasText: 'Ny kund' }).first().click();
  await s.page.fill('#cu-name', name);
  await s.page.fill('#cu-email', 'e2e-kund@example.invalid');
  if (await s.page.locator('#cu-phone').count()) await s.page.fill('#cu-phone', '0700000000');
  await s.clickModalButton(/Skapa kund/);
  await s.settle(2500);
  const cu = (await readKey('vift_customers')).find((c) => c.name === name);
  if (!cu) throw new Error('kunden finns inte på servern');
  await trackElement('vift_customers', cu.id);
  const pname = '[E2E-TEST] Testgatan 1 ' + tag + ' ' + runId;
  await s.go('pg-objects');
  await s.page.locator('.page.active button', { hasText: 'Ny fastighet' }).first().click();
  await s.page.fill('#prop-name', pname);
  await s.eval((c) => { const e = document.getElementById('prop-cu'); e.value = c; e.dispatchEvent(new Event('change', { bubbles: true })); }, cu.id);
  await s.clickModalButton(/Skapa/);
  await s.settle(2500);
  const prop = (await readKey('vift_properties')).find((p) => p.name === pname);
  if (prop) await trackElement('vift_properties', prop.id);
  return { cu, prop };
}
const FLOW = {

  /* F6: kund → fastighet → kontakt → offert (flera rader, bilaga) → kundlänk → PDF → kundgodkännande →
     AO från offert → tilldelning → stämpling/tid → material → checklista → bild + anteckning → klar →
     fakturakö → fakturaunderlag; beloppskontroll i varje led. Inga mejl (länk genereras utan utskick). */
  async F6(W) {
    const s = await W.session({ viewport: 'laptop' }); await s.login('chef');
    const base = await step('F6.1–2 kund och fastighet', () => newCustomerAndProperty(s, 'F6'));
    if (!base) return;
    const { cu, prop } = base;
    rep.add('F6.1 kund skapad (UI, arbetsledare)', !!cu && cu.email === 'e2e-kund@example.invalid', cu.id + ' e-post ' + cu.email);
    rep.add('F6.2 fastighet kopplad till kunden', !!prop && prop.customerId === cu.id, prop ? prop.id + ' → ' + prop.customerId : 'saknas');
    // 3. Kontaktperson på fastigheten (fastighetskortets dialog).
    await step('F6.3 kontaktperson', async () => {
      await s.go('pg-obj-detail', { propId: prop.id });
      await s.eval(() => PropertyDetailPage.openAddContact());
      await s.page.waitForSelector('.modal-overlay.open input', { timeout: 8000 });
      const fields = await s.eval(() => Array.from(document.querySelectorAll('.modal-overlay.open input')).map((e) => ({ id: e.id, type: e.type, ph: e.placeholder })));
      const nameId = (fields.find((f) => /name|namn/i.test(f.id + f.ph)) || fields[0]).id;
      await s.page.fill('#' + nameId, '[E2E-TEST] Kontakt ' + runId);
      const em = fields.find((f) => f.type === 'email' || /mail/i.test(f.id)); if (em) await s.page.fill('#' + em.id, 'e2e-kontakt@example.invalid');
      await s.clickModalButton(/Spara|Lägg till|Skapa/);
      await s.settle(2500);
      const p2 = await trackElement('vift_properties', prop.id);
      const pc = (await readKey('vift_propertyContacts')).filter((c) => JSON.stringify(c).includes(runId));
      for (const c of pc) await trackElement('vift_propertyContacts', c.id);
      const onProp = JSON.stringify(p2 || {}).includes('Kontakt ' + runId);
      rep.add('F6.3 kontaktperson sparad på servern', onProp || pc.length > 0, onProp ? 'på fastigheten' : pc.length + ' i kontaktregistret');
    });
    // 4. Offert med flera rader (25 % moms).
    const lines = [{ desc: 'Arbete rörmokare', qty: 3, price: '1250,50' }, { desc: 'Material rör', qty: 2, price: '99,99' }];
    const title = '[E2E-TEST] Offert F6 ' + runId;
    const wiz = await step('F6.4 offert via guiden', () => createOfferViaWizard(s, { title, customerId: cu.id, lines }));
    let off = (await readKey('vift_offers')).find((o) => o.title === title);
    if (!off) { rep.add('F6.4 offert på servern', false, 'saknas'); return; }
    await trackElement('vift_offers', off.id);
    const calc = await s.eval((o) => OfferCalc.totals(o), off);
    rep.add('F6.4 offert med två rader, belopp', calc.exVatAfterDiscount === 3952 && calc.vatAmount === 988 && calc.totalInclVat === 4940, 'ex ' + calc.exVatAfterDiscount + ', moms ' + calc.vatAmount + ', totalt ' + calc.totalInclVat + ' (förväntat 3952/988/4940); guiden visade ' + JSON.stringify(wiz));
    // 5. Bilaga (offer-attachment-upload, arbetsledarens token).
    await step('F6.5 bilaga', async () => {
      const t = await s.eval(() => Auth.getAccessToken());
      const fd = new FormData(); fd.append('file', new Blob([Buffer.from('%PDF-1.4\n% E2E-TEST ' + runId + '\n%%EOF\n')], { type: 'application/pdf' }), 'e2e-bilaga.pdf'); fd.append('offerId', off.id); fd.append('offerVersionId', '1'); fd.append('displayName', '[E2E-TEST] bilaga'); fd.append('includeInPublicView', 'true');
      const r = await fetch(env.sb + '/functions/v1/offer-attachment-upload', { method: 'POST', headers: { apikey: env.anon, Authorization: 'Bearer ' + t }, body: fd });
      const b = await r.json().catch(() => ({}));
      ids.att = b.attachment && b.attachment.id;
      rep.add('F6.5 bilaga uppladdad', r.status === 200 && !!ids.att, 'HTTP ' + r.status + ' ' + (b.error || ids.att));
    });
    // 6–7. Öppna igen och kontrollera belopp i detaljvyn.
    await step('F6.6 öppna igen', async () => {
      await s.eval(() => DataSync._poll && DataSync._poll()); await s.settle(1500);
      await s.go('pg-offer-detail', { offerId: off.id }); await s.settle(1200);
      const txt = await s.eval(() => document.querySelector('.page.active').innerText.replace(/[  ]/g, ' '));
      rep.add('F6.6 offerten öppnas igen med samma totalsumma', txt.includes(kr(4940)) && txt.includes(kr(3952)), 'detaljvyn visar 4 940 och 3 952: ' + (txt.includes(kr(4940)) && txt.includes(kr(3952))));
    });
    // 8. Publik länk utan mejl.
    await s.eval((id) => OfferDetailPage.generateDigitalLink(id), off.id);
    await s.settle(800); if (await s.modalOpen()) await s.clickModalButton(/Generera länk/);
    await s.settle(3000);
    off = (await readKey('vift_offers')).find((o) => o.id === off.id); await trackElement('vift_offers', off.id);
    rep.add('F6.8 publik länk och låst version (utan mejl)', !!off.publicToken && off.publicToken.length >= 32 && !!off.lockedSnapshotJSON && off.status !== 'skickad', 'token ' + (off.publicToken ? off.publicToken.length + ' tecken' : 'saknas') + ', status ' + off.status);
    // 9. Offert-PDF via kundens token.
    await step('F6.9 offert-PDF', async () => {
      const r = await fetch(env.sb + '/functions/v1/offer-public-pdf?t=' + off.publicToken); const buf = Buffer.from(await r.arrayBuffer()); const tx = pdfText(buf);
      rep.add('F6.9 kund-PDF visar rätt offert och totalsumma', r.status === 200 && tx.includes(off.id) && tx.includes('4 940'), 'HTTP ' + r.status + ', innehåller offert-id: ' + tx.includes(off.id) + ', totalt 4 940: ' + tx.includes('4 940'));
    });
    // 10–11. Kunden godkänner via den riktiga publika sidan (ingen inloggning).
    await step('F6.10 kundgodkännande', async () => {
      const ctx = await E.browserRef.newContext(); const cp = await ctx.newPage();
      // Miljöns proxy avbryter ibland enstaka anrop ("upstream request failed") — upp till tre laddningar,
      // varje misslyckat försök redovisas så att ett verkligt fel (t.ex. ogiltig länk) syns i rapporten.
      let shown = ''; const misses = [];
      for (let tries = 0; tries < 3; tries++) {
        await cp.goto(SITE + '/public-offer.html?t=' + off.publicToken, { waitUntil: 'load' }).catch((e) => misses.push('laddning: ' + String(e.message).split('\n')[0]));
        await cp.waitForFunction(() => document.body.innerText.replace(/\s/g, ' ').includes('4 940') || document.body.innerText.includes('4\u00a0940') || document.body.innerText.includes('4\u202f940'), null, { timeout: 15000 }).catch(() => {});
        shown = await cp.evaluate(() => document.body.innerText.replace(/[\u00a0\u202f]/g, ' ')).catch(() => '');
        if (shown.includes('4 940')) break;
        misses.push('försök ' + (tries + 1) + ': ' + shown.replace(/\s+/g, ' ').slice(0, 120));
      }
      rep.add('F6.10 kundsidan visar offerten och 4 940 kr', shown.includes('4 940'), 'kundsidan visar totalsumman: ' + shown.includes('4 940') + (misses.length ? ' (omladdningar: ' + misses.join(' ; ') + ')' : ''));
      await cp.locator('button', { hasText: /Godkänn/ }).first().click(); await cp.waitForTimeout(800);
      await cp.fill('#f-name', 'E2E Kund ' + runId); await cp.fill('#f-email', 'e2e-kund@example.invalid');
      const cb = cp.locator('input[type=checkbox]:visible'); for (let i = 0; i < await cb.count(); i++) await cb.nth(i).check().catch(() => {});
      await cp.locator('button', { hasText: /Skicka|Godkänn|Bekräfta/ }).last().click(); await cp.waitForTimeout(4000);
      await ctx.close();
      off = (await readKey('vift_offers')).find((o) => o.id === off.id); await trackElement('vift_offers', off.id);
      rep.add('F6.11 godkänd på servern med kundens namn', off.status === 'godkänd' && off.customerApproval && off.customerApproval.approvedByName === 'E2E Kund ' + runId, 'status ' + off.status + ', namn ' + (off.customerApproval && off.customerApproval.approvedByName));
    });
    // 12–13. AO från offerten.
    let ao;
    await step('F6.12 AO från offert', async () => {
      // Vänta tills kundens godkännande nått arbetsledarens klient via synken (högst 60 s).
      let localStatus = '', waited = 0;
      for (; waited < 60000; waited += 3000) {
        await s.eval(() => DataSync._poll && DataSync._poll()).catch(() => {});
        localStatus = await s.eval((id) => (getOff(id) || {}).status || '', off.id);
        if (localStatus === 'godkänd') break;
        await s.settle(3000);
      }
      rep.add('F6.11b godkännandet syns i arbetsledarens klient', localStatus === 'godkänd', 'lokal status ' + localStatus + ' efter ' + Math.round(waited / 1000) + ' s');
      await s.go('pg-offer-detail', { offerId: off.id }); await s.settle(800);
      await s.clearToasts();
      await s.eval(() => OfferDetailPage.createAO()); await s.settle(1200);
      const mtxt = (await s.modalOpen()) ? await s.eval(() => (document.querySelector('.modal-overlay.open') || {}).innerText || '') : '';
      if (mtxt) await s.clickModalButton(/Skapa|Bekräfta|OK|Stäng/);
      await s.settle(4000);
      const toasts = await s.eval(() => window.__toasts.map((x) => x.m).join(' | '));
      if (!(await listAO()).some((a) => a.offerId === off.id)) rep.add('F6.12 diagnos', null, 'dialog: ' + mtxt.replace(/\s+/g, ' ').slice(0, 200) + ' · besked: ' + toasts.slice(0, 300));
      const aos = (await listAO()).filter((a) => a.offerId === off.id);
      aos.forEach((a) => note({ typ: 'ao', id: a.id }));
      ao = aos[0];
      rep.add('F6.12 en AO skapad från offerten', aos.length === 1, aos.length + ' AO med offerId');
      if (ao) rep.add('F6.13 AO ärver kund, fastighet och belopp', ao.customerId === cu.id && (!prop || ao.propertyId === prop.id) && Number(ao.fixedPrice) === 3952, 'kund ' + ao.customerId + ', fastighet ' + ao.propertyId + ', fast pris ' + ao.fixedPrice);
      await s.eval(() => { try { OfferDetailPage.createAO(); } catch (e) {} }); await s.settle(2500);
      if (await s.modalOpen()) await s.page.keyboard.press('Escape');
      const again = (await listAO()).filter((a) => a.offerId === off.id); again.forEach((a) => note({ typ: 'ao', id: a.id }));
      rep.add('F6.12b andra försöket skapar ingen dubblett', again.length === 1, again.length + ' AO');
    });
    if (!ao) return;
    // 14. Tilldela fältarbetare (arbetsledaren).
    await step('F6.14 tilldelning', async () => {
      await s.eval(([id, st]) => WorkOrderService.update(id, { staff: [st], status: 'planerad', scheduledDate: new Date().toISOString().slice(0, 10) }), [ao.id, ids.falt]);
      await s.settle(4000);
      ao = (await listAO()).find((a) => a.id === ao.id);
      rep.add('F6.14 fältarbetare tilldelad på servern', (ao.staff || []).map(String).includes(ids.falt), 'staff ' + JSON.stringify(ao.staff));
    });
    // 15–18. Fältarbetaren på mobil: stämpla in, material, checklista, bild, anteckning, stämpla ut.
    const m = await W.session({ viewport: 'iphone' }); await m.login('falt');
    await step('F6.15 stämpling', async () => {
      await m.go('pg-myjobs'); note({ typ: 'stampling', konto: 'falt' });
      await m.eval((id) => MyJobsPage.clockIn(id), ao.id);
      await m.waitToast(/Instämplad/, 30000);
      rep.add('F6.15a instämplad (bekräftad av servern)', true, 'toast efter serverbekräftelse');
    });
    await step('F6.16 material', async () => {
      // Via det riktiga materialformuläret i AO-detaljen (fältrollen, mobil).
      await m.go('pg-ao-detail', { aoId: ao.id });
      await m.eval(() => WorkOrderDetailPage.openAddMaterial());
      await m.page.waitForSelector('.modal-overlay.open #mat-name');
      await m.page.fill('#mat-name', '[E2E-TEST] Kopplingar');
      await m.page.fill('#mat-qty', '2');
      if (await m.page.locator('#mat-buy').count()) await m.page.fill('#mat-buy', '90');
      await m.page.fill('#mat-sell', '150');
      await m.clearToasts();
      await m.clickModalButton(/^(Spara|Lägg till)$/);
      const acked = await m.waitToast(/Material tillagt/, 25000).then(() => true).catch(() => false);
      const failed = await m.eval(() => window.__toasts.map((x) => x.m).filter((t) => /kunde inte sparas/.test(t)).join(' | '));
      await m.settle(2000);
      const a2 = (await listAO()).find((a) => a.id === ao.id);
      const row = (a2.materials || []).find((x) => /Kopplingar/.test(x.name || ''));
      rep.add('F6.16 material sparat på servern (via formuläret, fältroll)', acked && !!row && Number(row.qty) === 2 && Number(row.sellPrice) === 150, 'besked efter serverns svar: ' + acked + (failed ? ' (fel: ' + failed + ')' : '') + '; serverns rad: ' + (row ? row.qty + ' st × ' + row.sellPrice + ' kr, moms ' + row.vatRate + ' %' : 'saknas'));
    });
    await step('F6.17 checklista', async () => {
      const t = await m.eval(() => Auth.getAccessToken());
      const ta = await s.eval(() => Auth.getAccessToken());
      const ck = (tk, body) => req('/functions/v1/work-order-checklist-resolve', { token: tk, body: Object.assign({ aoId: ao.id, avvikelse: 'v2:' + body.action }, body) });
      const it = runId + '-K1';
      const a = await ck(ta, { itemId: it, action: 'add', text: '[E2E-TEST] Kontrollera tätning' });
      const b = await ck(t, { itemId: it, action: 'start' }); const c = await ck(t, { itemId: it, action: 'done' });
      rep.add('F6.17 checklista: lägg till (arbetsledare) → påbörja → utförd (fält)', a.status === 200 && b.status === 200 && c.status === 200, 'HTTP ' + a.status + '/' + b.status + '/' + c.status);
    });
    await step('F6.18 bild och anteckning', async () => {
      const t = await m.eval(() => Auth.getAccessToken());
      const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
      const fd = new FormData(); fd.append('aoId', ao.id); fd.append('file', new Blob([JPEG], { type: 'image/jpeg' }), 'e2e.jpg');
      const r = await fetch(env.sb + '/functions/v1/work-order-image-upload', { method: 'POST', headers: { apikey: env.anon, Authorization: 'Bearer ' + t }, body: fd }); const b = await r.json().catch(() => ({}));
      ids.img = b.path;
      await m.go('pg-ao-detail', { aoId: ao.id });
      await m.eval(() => WorkOrderDetailPage.openAddLog()); await m.page.waitForSelector('.modal-overlay.open #log-text');
      await m.page.fill('#log-text', '[E2E-TEST] arbetsanteckning ' + runId); await m.clickModalButton(/^Spara$/);
      await m.waitToast(/Loggpost sparad/, 25000).catch(() => {});
      await m.settle(2000);
      const a2 = (await listAO()).find((a) => a.id === ao.id);
      rep.add('F6.18 bild uppladdad och anteckning i loggen', r.status === 200 && !!ids.img && (a2.log || []).some((l) => /arbetsanteckning/.test(l.text || '')), 'bild HTTP ' + r.status + '; anteckning i serverns logg: ' + (a2.log || []).some((l) => /arbetsanteckning/.test(l.text || '')));
    });
    await step('F6.15b utstämpling', async () => {
      if (await m.modalOpen()) { rep.add('F6.15b förutsättning', null, 'en dialog var fortfarande öppen före utstämpling — stängs'); await m.eval(() => Modal.close()); await m.settle(400); }
      await m.go('pg-myjobs'); await m.clearToasts(); await m.eval(() => MyJobsPage.clockOut()); await m.settle(1500);
      if (await m.modalOpen()) await m.clickModalButton(/Stämpla ut|Bekräfta/);
      await m.waitToast(/Utstämplad/, 30000);
      const tes = (await listTE()).filter((t) => t.aoId === ao.id); tes.forEach((t) => note({ typ: 'tidpost', id: t.id }));
      rep.add('F6.15b exakt en tidpost på rätt AO och kund', tes.length === 1 && (!tes[0].customerId || tes[0].customerId === cu.id), tes.length + ' tidpost(er), kund ' + (tes[0] && tes[0].customerId));
    });
    // 19. Avsluta AO (arbetsledaren).
    await step('F6.19 avsluta', async () => {
      await s.eval(() => DataSync._poll && DataSync._poll()); await s.settle(2500);
      await s.eval((id) => (WorkOrderService.setStatus ? WorkOrderService.setStatus(id, 'klar') : WorkOrderService.update(id, { status: 'klar' })), ao.id);
      await s.settle(4000);
      ao = (await listAO()).find((a) => a.id === ao.id);
      rep.add('F6.19 AO klar på servern', ao.status === 'klar', 'status ' + ao.status);
    });
    // 20–23. Fakturaunderlag (ekonomi).
    await step('F6.20 fakturaunderlag', async () => {
      const e = await W.session({ viewport: 'desktop' }); await e.login('ekonomi');
      await e.go('pg-invoices'); await e.eval(() => InvoicesPage._setView && InvoicesPage._setView('queue')); await e.settle(1500);
      const cands = await e.eval((aoId) => BillingQueueService.getCandidates().filter((c) => c.workOrderId === aoId).map((c) => ({ id: c.id, type: c.sourceType, amount: c.amount, sel: c.selectable, issues: c.issues })), ao.id);
      rep.add('F6.20a underlag i fakturakön', cands.length >= 1, JSON.stringify(cands).slice(0, 300));
      const sel = cands.filter((c) => c.sel);
      for (const c of sel) await e.page.locator('input[onchange*="SelectionModel.toggle(\'' + c.id + '\')"]').check();
      await e.eval((ids2) => InvoicesPage._openCreateConfirm(ids2), sel.map((c) => c.id));
      await e.clickModalButton(/Skapa fakturautkast/); await e.settle(5000);
      const invs = (await readAll('vift_invoices')).filter((i) => (i.lines || []).some((l) => (l.sourceRefs || []).some((r) => r.workOrderId === ao.id)));
      ids.inv = invs.map((i) => i.id);
      const inv = invs[0];
      rep.add('F6.20 fakturaunderlag skapat på servern', invs.length === 1, invs.length + ' underlag');
      if (inv) {
        const sum = await e.eval((i) => InvoiceService.calcSummary(i), inv);
        const expEx = sel.reduce((a, c) => a + c.amount, 0);
        rep.add('F6.21 fakturans belopp = köns underlag, 25 % moms', Math.abs(sum.exVat - expEx) < 0.01 && Math.abs(sum.vat - Math.round(expEx * 25) / 100) <= 1 && sum.exVat < 20000, 'ex ' + sum.exVat + ' (kö ' + expEx + '), moms ' + sum.vat + ', totalt ' + sum.totalInclVat + '; rader: ' + (inv.lines || []).map((l) => (l.description || l.type) + ' ' + l.quantity + '×' + l.unitPrice).join(' | ').slice(0, 200));
        rep.add('F6.21b fakturan har rätt kund', inv.customerId === cu.id, 'kund ' + inv.customerId);
        await e.go('pg-inv-detail', { invoiceId: inv.id }); await e.settle(1500);
        const txt = await e.eval(() => document.querySelector('.page.active').innerText.replace(/[  ]/g, ' '));
        rep.add('F6.22 underlaget öppnas igen med samma totalsumma', txt.includes(kr(sum.totalInclVat)), 'visar ' + kr(sum.totalInclVat) + ': ' + txt.includes(kr(sum.totalInclVat)));
        const again = await e.eval((aoId) => BillingQueueService.getCandidates().filter((c) => c.workOrderId === aoId && c.selectable).length, ao.id);
        rep.add('F6.23 underlagen erbjuds inte igen (ingen dubbelfakturering)', again === 0, again + ' kvar i kön');
      }
      await e.context.close();
    });
    await m.context.close(); await s.context.close();
  },
  /* F7: offert nekas av kunden; F8: kunden begär ändring. Isolerade testfall. */
  async F7(W) { await offerResponseFlow(W, 'F7', 'neka'); },
  async F8(W) { await offerResponseFlow(W, 'F8', 'andring'); },
  async R0(W) {
    for (const role of Object.keys(emails)) {
      const s = await W.session({ viewport: role === 'falt' ? 'iphone' : 'laptop' });
      await s.login(role);
      const pages = await s.eval(() => Object.keys(Auth.PAGE_PERMISSIONS || {}).filter((p) => Auth.canViewPage(p)));
      const bad = [];
      for (const p of pages) {
        const before = s.pageErrors.length;
        await s.eval((x) => { try { Router.showPage(x, {}); } catch (e) { throw new Error(x + ': ' + e.message); } }, p).catch((e) => bad.push(String(e.message).slice(0, 120)));
        await s.settle(700);
        if (s.pageErrors.length > before) bad.push(p + ': ' + s.pageErrors.slice(before).join(' | ').slice(0, 160));
      }
      rep.add('R0 ' + role, bad.length === 0, pages.length + ' sidor öppnade' + (bad.length ? '; fel: ' + bad.join(' ; ') : ', inga JS-fel'));
      await s.context.close();
    }
  },
  async F2(W) {
    const aoId = await createTestAO('CHK', { checklist: [{ id: runId + '-k1', text: '[E2E-TEST] punkt 1', done: false, avvikelse: null }] });
    const s = await W.session({ viewport: 'iphone' });
    await s.login('falt');
    await s.go('pg-ao-detail', { aoId });
    await s.page.waitForSelector('#ao-checklist .chk-row', { timeout: 15000 });
    const hasStart = await s.page.waitForSelector('#ao-checklist .chk-btn-start', { timeout: 8000 }).then(() => true).catch(() => false);
    if (hasStart) {
      await s.page.click('#ao-checklist .chk-btn-start');
      await s.waitToast(/Påbörjad/, 15000);
    }
    await s.page.click('#ao-checklist .chk-btn[title="Markera utförd"]');
    await s.waitToast(/Utförd/, 15000);
    const ao = (await listAO()).find((a) => a.id === aoId);
    const it = ao && (ao.checklist || [])[0];
    rep.add('F2 checklista', !!it && it.done === true && ao.status === 'planerad' && (!hasStart || !!it.startedAt), (hasStart ? 'tre lägen (serverstöd finns)' : 'serverstöd för tre lägen saknas — bara Utförd prövad') + '; AO-status ' + (ao && ao.status) + '; punkt utförd: ' + !!(it && it.done));
    await s.context.close();
  },
  async F3(W) {
    const aoId = await createTestAO('STAMP');
    const m = await W.session({ viewport: 'iphone' }); await m.login('falt');
    const d = await W.session({ viewport: 'laptop' }); await d.login('falt');
    await m.go('pg-myjobs');
    note({ typ: 'stampling', konto: 'falt' }); // journal FÖRE mutationen
    await m.eval((id) => MyJobsPage.clockIn ? MyJobsPage.clockIn(id) : null, aoId);
    try { await m.waitToast(/Instämplad/, 30000); }
    catch (e) { const diag = await m.eval(() => ({ toasts: (window.__toasts || []).map((t) => t.m).slice(-5), stampActive: !!state.stampActive, stampAoId: state.stampAoId || null })); throw new Error('ingen "Instämplad"-toast inom 30 s — ' + JSON.stringify(diag)); }
    await d.page.bringToFront(); await d.eval(() => window.dispatchEvent(new Event('focus'))); await d.settle(4000);
    const seen = await d.eval(() => !!state.stampActive);
    await d.go('pg-myjobs');
    await d.eval(() => MyJobsPage.clockOut());
    await d.waitToast(/Utstämplad/, 20000);
    await d.settle(3000);
    const tes = (await listTE()).filter((t) => t.aoId === aoId);
    tes.forEach((t) => note({ typ: 'tidpost', id: t.id }));
    rep.add('F3 stämpling två enheter', seen && tes.length === 1, 'datorn såg instämpling: ' + seen + '; tidposter för test-AO: ' + tes.length);
    await m.context.close(); await d.context.close();
  },
  async F4(W) {
    const aoId = await createTestAO('LOG2');
    const a = await W.session(); await a.login('falt');
    const b = await W.session({ viewport: 'iphone' }); await b.login(emails.falt2 ? 'falt2' : 'falt');
    for (const s of [a, b]) await s.go('pg-ao-detail', { aoId });
    const add = async (s, text) => { await s.eval(() => WorkOrderDetailPage.openAddLog()); await s.page.waitForSelector('.modal-overlay.open #log-text'); await s.page.fill('#log-text', text); await s.clickModalButton(/^Spara$/); };
    await Promise.all([add(a, '[E2E-TEST] enhet A'), add(b, '[E2E-TEST] enhet B')]);
    await a.waitToast(/Loggpost sparad/, 20000); await b.waitToast(/Loggpost sparad/, 20000);
    await a.settle(1500);
    const log = (((await listAO()).find((x) => x.id === aoId)) || {}).log || [];
    const both = log.some((l) => /enhet A/.test(l.text)) && log.some((l) => /enhet B/.test(l.text));
    const atomic = await a.eval(() => AOTimeSyncService._logOps === true);
    rep.add('F4 samtidiga loggposter', both ? true : (atomic ? false : null), (both ? 'båda posterna finns' : 'en post saknas') + ' (atomisk väg ' + (atomic ? 'aktiv' : 'INTE installerad — känt gap G5') + ')');
    await a.context.close(); await b.context.close();
  },
  async F5(W) {
    const aoId = await createTestAO('OFFLINE');
    const s = await W.session(); await s.login('falt');
    await s.go('pg-ao-detail', { aoId });
    await s.clearToasts();
    s.offline = true; await s.context.setOffline(true);
    await s.eval(() => WorkOrderDetailPage.openAddLog()); await s.page.waitForSelector('.modal-overlay.open #log-text');
    await s.page.fill('#log-text', '[E2E-TEST] offline'); await s.clickModalButton(/^Spara$/);
    await s.settle(5000);
    const falseOk = (await s.toasts()).some((m) => /Loggpost sparad/.test(m));
    s.offline = false; await s.context.setOffline(false);
    await s.eval(() => window.dispatchEvent(new Event('online')));
    await s.waitToast(/Loggpost sparad/, 45000).catch(() => {});
    await s.settle(2000);
    const n = ((((await listAO()).find((x) => x.id === aoId)) || {}).log || []).filter((l) => /offline/.test(l.text)).length;
    rep.add('F5 nätavbrott', !falseOk && n === 1, 'falskt "sparad" offline: ' + falseOk + '; poster på servern efter återanslutning: ' + n);
    await s.context.close();
  },
};


async function offerResponseFlow(W, tag, mode) {
  const s = await W.session({ viewport: 'laptop' }); await s.login('chef');
  const { cu } = await newCustomerAndProperty(s, tag);
  const title = '[E2E-TEST] Offert ' + tag + ' ' + runId;
  await createOfferViaWizard(s, { title, customerId: cu.id, lines: [{ desc: 'Arbete', qty: 1, price: '1000' }] });
  let off = (await readKey('vift_offers')).find((o) => o.title === title); await trackElement('vift_offers', off.id);
  await s.eval((id) => OfferDetailPage.generateDigitalLink(id), off.id); await s.settle(800); if (await s.modalOpen()) await s.clickModalButton(/Generera länk/); await s.settle(3000);
  off = (await readKey('vift_offers')).find((o) => o.id === off.id); await trackElement('vift_offers', off.id);
  const ctx = await E.browserRef.newContext(); const cp = await ctx.newPage();
  await cp.goto(SITE + '/public-offer.html?t=' + off.publicToken, { waitUntil: 'load' }); await cp.waitForTimeout(3000);
  const btnText = mode === 'neka' ? /Neka|Avböj/ : /ändring|Ändring|Begär/;
  await cp.locator('button', { hasText: btnText }).first().click(); await cp.waitForTimeout(800);
  if (await cp.locator('#f-name').count()) await cp.fill('#f-name', 'E2E Kund ' + runId);
  if (await cp.locator('#f-email').count()) await cp.fill('#f-email', 'e2e-kund@example.invalid');
  const ta = cp.locator('textarea:visible'); if (await ta.count()) await ta.first().fill('[E2E-TEST] ' + (mode === 'neka' ? 'för dyrt' : 'önskar annan tid'));
  const sel = cp.locator('select:visible'); if (await sel.count()) { const opts = await sel.first().locator('option').allTextContents(); if (opts.length > 1) await sel.first().selectOption({ index: 1 }); }
  await cp.locator('button', { hasText: /Skicka|Bekräfta|Neka|Avböj/ }).last().click(); await cp.waitForTimeout(4000);
  await ctx.close();
  off = (await readKey('vift_offers')).find((o) => o.id === off.id); await trackElement('vift_offers', off.id);
  const ok = mode === 'neka' ? /nekad|avböjd/.test(String(off.status)) : /ändring/.test(String(off.status)) || !!off.changeRequest;
  rep.add(tag + ' kundsvar "' + (mode === 'neka' ? 'neka' : 'begär ändring') + '" registrerat', ok, 'status ' + off.status + (off.changeRequest ? ', ändringsbegäran finns' : '') + (off.declineReason ? ', skäl ' + off.declineReason : ''));
  const aos = (await listAO()).filter((a) => a.offerId === off.id);
  rep.add(tag + ' ingen AO skapad från ej godkänd offert', aos.length === 0, aos.length + ' AO');
  await s.context.close();
}

async function finish(before, aborted) {
  try { await refreshTracked(); } catch (e) {}
  const res = await R.finish(rep, before, aborted);
  const f = rep.save({ niva: 2, projekt: env.ref, journal: journalFile, kvar: res.left, efterkontroll: !!res.after });
  console.log('\nRapport: ' + f + '\nJournal: ' + journalFile);
  return res.exitCode;
}

(async () => {
  console.log('Nivå 2 — WEBBLÄSARTEST mot ' + (env.local ? 'LOKAL provning (paket ' + paket + ')' : 'riktig STAGING ' + SITE) + '. runId ' + runId + (CLEAN_ONLY ? ' (STÄDNING)' : '. Flöden: ' + FLOWS.join(', ')) + '\n');
  for (const [r, e] of Object.entries(emails)) tok[r] = await login(e, pw);
  if (CLEAN_ONLY) {
    const n = R.loadJournal();
    rep.add('JOURNAL', null, n ? n + ' poster lästa från ' + journalFile : 'ingen journal hittad — städar utifrån sökning efter runId');
    const pre = await R.trySnapshot();
    if (pre.snap) await R.cleanupByScan(pre.snap, runId);
    process.exit(await finish(null, false));
  }
  let before;
  try { before = await R.snapshot(); } catch (e) { console.error('Ögonblicksbild före kunde inte tas: ' + e.message + ' — inga mutationer gjorda.'); process.exit(L.EXIT.AVVIKELSE); }
  const st = await req('/rest/v1/store?select=value&key=eq.vift_staff', { method: 'GET', token: tok.admin });
  const staff = (st.body && st.body[0] && st.body[0].value) || [];
  for (const [r, e] of Object.entries(emails)) { const s = staff.find((x) => String(x.email || '').toLowerCase() === e.toLowerCase()); if (!s) L.refuse('testkontot för ' + r + ' saknar personalpost.'); ids[r] = String(s.id); }
  const old = R.leftovers(before);
  if (old.length) L.refuse('testposter från en tidigare körning finns kvar (' + old.slice(0, 5).join(', ') + '). Kör --stada=<runId> först.');
  if (DRY) { rep.add('TORRKÖRNING', null, 'spärrar, inloggning och ögonblicksbild OK — inga skrivningar'); rep.save({ niva: 2 }); process.exit(L.EXIT.OK); }

  let aborted = false;
  await E.start();
  const W = new E.World();
  for (const f of FLOWS) {
    if (!FLOW[f]) { rep.add(f, null, 'okänt flöde'); continue; }
    try { await FLOW[f](W); } catch (e) { aborted = true; rep.add(f, false, 'avbröts: ' + String(e.message).slice(0, 300)); }
  }
  const foreign = W.sessions.flatMap((s) => s.pageErrors).filter((m) => /OTILLÅTEN SUPABASE/.test(m));
  rep.add('MILJÖ', foreign.length === 0, foreign.length ? 'anrop till annat Supabase-projekt: ' + foreign.join(', ') : 'inga anrop till andra Supabase-projekt');
  try { await W.close(); await E.stop(); } catch (e) {}
  process.exit(await finish(before, aborted));
})().catch(async (e) => {
  console.error('Fel: ' + e.message);
  // Sista skyddsnät: städa från journalen; ostädat läge ger kod 3 och spärrfil.
  if (R.journal.length && tok.admin) { try { process.exit(await finish(null, true)); } catch (e2) {} R.writeLock('oväntat fel: ' + e.message); }
  process.exit(L.EXIT.STADNING_MISSLYCKADES);
});
