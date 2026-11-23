'use strict';
/* Modul 1: Inloggning och utloggning (riktigt formulär, riktiga knappar). */
module.exports = [
  {
    id: 'AUTH-01', module: 'Inloggning och utloggning', name: 'Inloggning med giltigt konto visar appen och rätt användare',
    async run(t) {
      const s = await t.world.session();
      const t0 = Date.now();
      await s.login('admin');
      t.metric('inloggning → app laddad (ms)', Date.now() - t0);
      const who = await s.eval(() => ({ id: state.currentUser.id, role: state.currentUser.role, aos: state.workOrders.length, cus: state.customers.length }));
      t.assert(who.id === 'ST-001' && who.role === 'admin', 'inloggad som ST-001/admin, fick ' + JSON.stringify(who));
      t.assert(who.aos > 0 && who.cus > 0, 'data laddad (AO ' + who.aos + ', kunder ' + who.cus + ')');
      t.note('Laddade ' + who.aos + ' AO och ' + who.cus + ' kunder');
    },
  },
  {
    id: 'AUTH-02', module: 'Inloggning och utloggning', name: 'Fel lösenord ger begripligt fel och ingen inloggning',
    async run(t) {
      const s = await t.world.session();
      await s.open();
      await s.login('admin', 'fel-losenord');
      await s.page.waitForSelector('#login-err', { state: 'visible', timeout: 8000 });
      const msg = await s.text('#login-err');
      t.assert(/fel e-post eller lösenord/i.test(msg), 'felmeddelande: "' + msg + '"');
      t.assert(!(await s.page.locator('#app').isVisible()), 'appen visas inte');
    },
  },
  {
    id: 'AUTH-03', module: 'Inloggning och utloggning', name: 'Utloggning via menyn rensar session och skyddad cache',
    async run(t) {
      const s = await t.world.session();
      await s.login('ekonomi');
      const before = await s.eval(() => ({ te: (state.timeEntries || []).length, ls: !!localStorage.getItem('vift_auth_v2') }));
      t.assert(before.te > 0 && before.ls, 'tidposter laddade och session sparad');
      await s.eval(() => Auth.logout());
      await s.page.waitForSelector('#login-user', { state: 'visible', timeout: 10000 });
      const after = await s.eval(() => ({ ls: localStorage.getItem('vift_auth_v2'), te: localStorage.getItem('vift_timeEntries'), wo: localStorage.getItem('vift_workOrders'), mem: (typeof state !== 'undefined' && state.timeEntries) ? state.timeEntries.length : 0 }));
      t.assert(!after.ls, 'session borttagen');
      t.assert(!after.te && !after.wo, 'cachade tidposter/AO borttagna ur localStorage');
      t.assert(after.mem === 0, 'tidposter rensade ur minnet (' + after.mem + ')');
    },
  },
  {
    id: 'AUTH-04', module: 'Inloggning och utloggning', name: 'Användarbyte på samma enhet: ny användare ser inte föregåendes lönedata',
    async run(t) {
      const s = await t.world.session();
      await s.login('ekonomi');
      const all = await s.eval(() => state.timeEntries.length);
      await s.eval(() => Auth.logout());
      await s.page.waitForSelector('#login-user', { state: 'visible' });
      await s.login('falt');
      const mine = await s.eval(() => ({ n: state.timeEntries.length, other: state.timeEntries.filter((e) => e.staffId !== state.currentUser.id).length }));
      t.assert(mine.other === 0, 'fältarbetaren ser 0 andras tidposter (såg ' + mine.other + ')');
      t.note('ekonomi såg ' + all + ' poster, fältarbetaren ' + mine.n);
    },
  },
  {
    id: 'AUTH-05', module: 'Inloggning och utloggning', name: 'Sessionen överlever omladdning',
    async run(t) {
      const s = await t.world.session();
      await s.login('chef');
      await s.page.reload({ waitUntil: 'load' });
      await s.page.waitForFunction(() => typeof state !== 'undefined' && state.currentUser && state.currentUser.id === 'ST-003', null, { timeout: 15000 });
    },
  },
  {
    id: 'AUTH-06', module: 'Inloggning och utloggning', name: 'Snabb inmatning direkt när inloggningen visas: lösenordet hamnar aldrig i e-postfältet (fördröjd autofokus)',
    async run(t) {
      const s = await t.world.session({ viewport: 'iphone' });
      await s.open();
      await s.page.waitForSelector('#login-user', { state: 'visible' });
      await s.page.fill('#login-user', 'admin@example.test');
      // Visa inloggningen igen (som vid utloggning) och börja direkt skriva lösenordet
      await s.eval(() => App.showLogin());
      await s.page.focus('#login-pass');
      await s.page.keyboard.type('e2e-test-password', { delay: 15 });
      await s.settle(200);
      const v = await s.eval(() => ({ user: document.getElementById('login-user').value, pass: document.getElementById('login-pass').value }));
      t.assert(v.user === 'admin@example.test' && v.pass === 'e2e-test-password', 'fälten har rätt innehåll: ' + JSON.stringify({ user: v.user, passLen: v.pass.length }));
      await s.page.click('#lp-login button.btn.bp');
      await s.page.waitForFunction(() => typeof state !== 'undefined' && state.currentUser && state.currentUser.id === 'ST-001', null, { timeout: 15000 });
    },
  },
];
