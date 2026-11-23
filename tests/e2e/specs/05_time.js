'use strict';
/* Tidregistrering, instämpling, Mina jobb, löneperspektiv — riktiga knappar. */

/* Simulera att ett pass startade för `min` minuter sedan (klient + server). */
async function backdate(t, s, email, min) {
  const ts = Date.now() - min * 60000;
  const row = t.fake.stamp.get(email); row.ts = ts;
  await s.eval((x) => { state.stampTimestamp = x; }, ts);
  return ts;
}
async function clockInMyJobs(s) {
  await s.go('pg-myjobs');
  await s.page.locator('.page.active button', { hasText: 'Stämpla in' }).first().click();
  await s.waitToast(/Instämplad/, 6000);
}
async function clockOutMyJobs(s) {
  await s.go('pg-myjobs');
  await s.page.locator('.page.active button', { hasText: 'Stämpla ut' }).first().click();
}
const F2 = 'falt2@example.test';

module.exports = [
  {
    id: 'TIME-01', kind: 'workflow', module: 'Tidregistrering och instämpling', name: 'Flöde: fältarbetare stämplar in/ut på AO → serverbekräftad tidpost → löneadmin ser och attesterar → posten låst',
    async run(t) {
      const s = await t.world.session({ viewport: 'iphone' });
      await s.login('falt2');
      await clockInMyJobs(s);
      const row = t.fake.stamp.get(F2);
      t.assert(row && row.active && row.aoId === 'AO-015', 'serverns stämpling aktiv på AO-015');
      await backdate(t, s, F2, 75);
      await clockOutMyJobs(s);
      await s.waitToast(/Utstämplad — tid sparad/, 8000);
      const te = t.fake.get('timeEntries').find((e) => e.staffId === 'ST-004' && e.aoId === 'AO-015');
      t.assert(te && te.minutes === 75, 'tidpost 75 min på servern: ' + JSON.stringify(te && { m: te.minutes, ao: te.aoId }));
      // Serverns stämpling rensas i ett eget anrop efter tidpostens ACK (den
      // varaktiga intentionen täcker en stängd flik däremellan) — vänta på
      // det i stället för att kontrollera direkt efter beskedet (instabilt
      // under last: misslyckades 1 av 6 körningar i full svit).
      for (let i = 0; i < 50 && t.fake.stamp.get(F2).active !== false; i++) await s.settle(100);
      t.assert(t.fake.stamp.get(F2).active === false, 'serverns stämpling rensad (inom 5 s)');
      const e = await t.world.session({ viewport: 'desktop' });
      await e.login('ekonomi');
      await e.go('pg-payroll');
      const txt = await e.text('#pg-payroll');
      t.assert(/Jonas/.test(txt), 'löneunderlaget visar Jonas');
      const r = await e.eval((id) => AOTimeSyncService.setAttested(id, true), te.id);
      t.assert(r.ok, 'attestering bekräftad');
      t.assert(t.fake.get('timeEntries').find((x) => x.id === te.id).attested === true, 'attesterad på servern');
      const del = await s.eval(async (id) => { await TimeEntriesReadService.fetchAndApply(); return TimeService.delete(id); }, te.id);
      t.assert(del.ok === false && /attesterad/i.test(del.error), 'fältarbetaren kan inte radera attesterad tid: ' + JSON.stringify(del));
      const direct = await s.eval((id) => AOTimeSyncService._call({ action: 'delete_time', entryId: id, idempotencyKey: 'd-' + Date.now() }), te.id);
      t.assert(direct.ok === false && direct.httpStatus === 409, 'direktanrop nekas av servern (' + JSON.stringify(direct) + ')');
    },
  },
  {
    id: 'TIME-02', module: 'Tidregistrering och instämpling', name: 'Stämpla in på mobil → datorn visar instämplad vid flikfokus; stämpla ut på datorn → mobilen visar utstämplad',
    async run(t) {
      const desk = await t.world.session({ viewport: 'desktop' });
      await desk.login('falt2');
      const mob = await t.world.session({ viewport: 'iphone' });
      await mob.login('falt2');
      await clockInMyJobs(mob);
      await desk.eval(() => window.dispatchEvent(new Event('focus')));
      await desk.page.waitForFunction(() => state.stampActive === true && state.stampAoId === 'AO-015', null, { timeout: 6000 });
      await backdate(t, mob, F2, 30);
      await desk.eval((ts) => { state.stampTimestamp = ts; }, t.fake.stamp.get(F2).ts);
      await clockOutMyJobs(desk);
      await desk.waitToast(/Utstämplad — tid sparad/, 8000);
      await mob.eval(() => window.dispatchEvent(new Event('focus')));
      await mob.page.waitForFunction(() => state.stampActive === false, null, { timeout: 6000 });
      t.assert(t.fake.get('timeEntries').filter((e) => e.staffId === 'ST-004' && e.aoId === 'AO-015').length === 1, 'exakt en tidpost');
    },
  },
  {
    id: 'TIME-03', module: 'Tidregistrering och instämpling', name: 'Dubbel utstämpling av samma pass från två enheter → exakt en tidpost',
    async run(t) {
      const a = await t.world.session({ viewport: 'iphone' }); await a.login('falt2');
      const b = await t.world.session({ viewport: 'laptop' }); await b.login('falt2');
      await clockInMyJobs(a);
      const ts = await backdate(t, a, F2, 40);
      await b.eval(() => TimeService.refreshStampFromServer());
      await b.page.waitForFunction((x) => state.stampActive && state.stampTimestamp === x, ts, { timeout: 5000 });
      await Promise.all([clockOutMyJobs(a), clockOutMyJobs(b)]);
      await a.settle(2500);
      const n = t.fake.get('timeEntries').filter((e) => e.staffId === 'ST-004' && e.aoId === 'AO-015').length;
      t.assert(n === 1, 'tidposter för passet: ' + n);
      t.assert(t.fake.stamp.get(F2).active === false, 'stämplingen rensad');
    },
  },
  {
    id: 'TIME-04', module: 'Tidregistrering och instämpling', name: 'Manuell tid på Tid-sidan: "Sparar tiden…" → "Tid sparad" efter ACK; nekad → borttagen och tydligt fel',
    async run(t) {
      const s = await t.world.session();
      await s.login('falt2');
      await s.go('pg-tid');
      await s.page.fill('#mt-date', '2026-11-20');
      await s.page.fill('#mt-start', '08:00');
      await s.page.fill('#mt-end', '10:30');
      await s.page.selectOption('#mt-ao', 'AO-015').catch(async () => { await s.eval(() => { const e = document.getElementById('mt-ao'); e.value = 'AO-015'; e.dispatchEvent(new Event('change', { bubbles: true })); }); });
      t.fake.addFault({ match: /ao-time-write:create_time/, mode: 'delay', ms: 1000, times: 1 });
      await s.page.locator('.page.active button', { hasText: 'Spara tid' }).click();
      await s.settle(300);
      const early = await s.toasts();
      t.assert(early.some((m) => /Sparar tiden/.test(m)) && !early.includes('Tid sparad'), 'före ACK: ' + early.join(' / '));
      await s.waitToast(/^Tid sparad$/, 6000);
      t.assert(t.fake.get('timeEntries').some((e) => e.staffId === 'ST-004' && e.minutes === 150 && e.date === '2026-11-20'), '150 min på servern');
      await s.clearToasts();
      await s.page.fill('#mt-start', '11:00'); await s.page.fill('#mt-end', '12:00');
      t.fake.addFault({ match: /ao-time-write:create_time/, mode: 'fail', status: 403, error: 'forbidden', times: 1 });
      await s.page.locator('.page.active button', { hasText: 'Spara tid' }).click();
      await s.waitToast(/kunde INTE sparas/, 6000);
      t.assert(!(await s.toasts()).includes('Tid sparad'), 'ingen "Tid sparad"');
      t.assert(await s.eval(() => !state.timeEntries.some((e) => e.startStr === '11:00' && e.date === '2026-11-20')), 'nekad post borttagen lokalt');
    },
  },
  {
    id: 'TIME-07', module: 'Tidregistrering och instämpling', name: 'Manuell tid med arbetsorder men utan vald kund: kunden fylls i från AO:n och tidposten får kunden på servern (tidigare tom kund → föll bort ur kundrapporter)',
    async run(t) {
      const s = await t.world.session();
      await s.login('falt2');
      await s.go('pg-tid');
      const aoCu = t.fake.get('workOrders').find((a) => a.id === 'AO-015').customerId;
      t.assert(!!aoCu, 'AO-015 har en kund i testdatan');
      await s.page.fill('#mt-date', '2026-11-21');
      await s.page.fill('#mt-start', '13:00');
      await s.page.fill('#mt-end', '14:00');
      await s.page.selectOption('#mt-ao', 'AO-015');
      const shown = await s.eval(() => document.getElementById('mt-customer') && document.getElementById('mt-customer').value);
      t.assert(shown === aoCu, 'kundfältet fylls i från AO:n (' + shown + ')');
      await s.eval(() => { const c = document.getElementById('mt-customer'); if (c && c.tagName === 'SELECT') c.value = ''; });
      await s.page.locator('.page.active button', { hasText: 'Spara tid' }).click();
      await s.waitToast(/^Tid sparad$/, 6000);
      const e = t.fake.get('timeEntries').find((x) => x.date === '2026-11-21' && x.staffId === 'ST-004' && x.minutes === 60);
      t.assert(!!e && e.customerId === aoCu, 'tidposten på servern har AO:ns kund även om kundfältet tömts (' + (e && e.customerId) + ')');
    },
  },
  {
    id: 'TIME-05', module: 'Tidregistrering och instämpling', name: 'Användarbyte med osynkad utstämpling: tidposten tappas inte och skickas inte i fel användares namn',
    async run(t) {
      const s = await t.world.session();
      await s.login('falt2');
      await clockInMyJobs(s);
      await backdate(t, s, F2, 50);
      t.fake.addFault({ match: /ao-time-write:create_time/, mode: 'fail', status: 503, error: 'http_503' });
      await clockOutMyJobs(s);
      await s.settle(1200);
      t.assert(!(await s.toasts()).some((m) => /tid sparad/.test(m)), 'ingen "tid sparad" när servern är nere');
      await s.eval(() => Auth.logout());
      await s.page.waitForSelector('#login-user', { state: 'visible' });
      t.fake.clearFaults();
      await s.login('falt');
      await s.settle(2500);
      const byOther = t.fake.calls.filter((c) => c.action === 'ao-time-write:create_time' && c.user === 'falt1@example.test');
      t.assert(byOther.length === 0, 'falt2:s tidpost skickades INTE med falt1:s session (' + byOther.map((c) => c.status).join() + ')');
      await s.eval(() => Auth.logout());
      await s.page.waitForSelector('#login-user', { state: 'visible' });
      await s.login('falt2');
      await s.settle(2500);
      const n = t.fake.get('timeEntries').filter((e) => e.staffId === 'ST-004' && e.minutes === 50).length;
      t.assert(n === 1, 'falt2:s tidpost sparad exakt en gång när falt2 loggar in igen (' + n + ')');
    },
  },
  {
    id: 'TIME-06', module: 'Tidregistrering och instämpling', name: 'Löneskydd: fältarbetare får bara egna tidposter, även vid direktanrop',
    async run(t) {
      const s = await t.world.session();
      await s.login('falt');
      const mine = await s.eval(() => state.timeEntries.filter((e) => e.staffId !== state.currentUser.id).length);
      t.assert(mine === 0, 'inga andras tidposter i state');
      const direct = await s.eval(async () => { const r = await fetch(SUPABASE_URL + '/functions/v1/time-entries-list', { headers: { Authorization: 'Bearer ' + Auth.getAccessToken(), apikey: SUPABASE_AKEY } }); return (await r.json()).timeEntries.filter((e) => e.staffId !== 'ST-002').length; });
      t.assert(direct === 0, 'time-entries-list ger 0 andras poster');
      const rest = await s.eval(async () => { const r = await fetch(SUPABASE_URL + '/rest/v1/store?key=eq.vift_timeEntries&select=value', { headers: { Authorization: 'Bearer ' + Auth.getAccessToken(), apikey: SUPABASE_AKEY } }); return (await r.json()).length; });
      t.assert(rest === 0, 'direkt REST-läsning av vift_timeEntries blockerad');
    },
  },
  {
    id: 'MYJOBS-01', module: 'Mina jobb', name: 'Mina jobb visar egna tilldelade AO; "Starta" startar jobbet på servern',
    async run(t) {
      const s = await t.world.session({ viewport: 'android' });
      await s.login('falt2');
      await s.go('pg-myjobs');
      const txt = await s.text('#pg-myjobs');
      t.assert(/AO-015|Starta/.test(txt), 'egna jobb listas');
      const startBtn = s.page.locator('.page.active button', { hasText: 'Starta' }).first();
      if (await startBtn.count()) {
        await startBtn.click();
        await s.settle(1500);
        const st = t.fake.get('workOrders').find((a) => a.id === 'AO-015').status;
        t.assert(/pågå/.test(st), 'status på servern: ' + st);
      } else t.note('ingen Starta-knapp (redan startad)');
    },
  },
];
