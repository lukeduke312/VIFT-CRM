'use strict';
/* Admin: roller och behörigheter, personal, inställningar; serverfel får
   aldrig lämna ett "Sparat"-besked kvar. */

async function openRoleEditor(s, roleId) {
  await s.go('pg-admin');
  await s.page.locator('.page.active .admin-tab', { hasText: 'Personal' }).click();
  await s.settle(200);
  await s.eval((id) => AdminPage.openEditRole(id), roleId);
  await s.page.waitForSelector('.modal-overlay.open input[name="role-perm"]');
}
const rolePerms = (t, id) => (t.fake.get('roles').find((r) => r.id === id) || {}).permissions || [];

module.exports = [
  {
    id: 'ROLE-02', module: 'Användarroller och behörigheter', name: 'Ändra rolls behörighet: serverfel → inget "Roll uppdaterad", behörigheten oförändrad; lyckad ändring slår igenom för rollens användare',
    async run(t) {
      const a = await t.world.session({ viewport: 'desktop' });
      await a.login('admin');
      t.assert(rolePerms(t, 'personal').includes('ao_material'), 'förutsättning: personal har ao_material');
      await openRoleEditor(a, 'personal');
      await a.page.locator('.modal-overlay.open input[name="role-perm"][value="ao_material"]').uncheck();
      t.fake.addFault({ match: /store-key-write:writeMerge/, mode: 'fail', status: 503, error: 'http_503', times: 3 });
      await a.clickModalButton(/^Spara$/);
      await a.settle(2500);
      const toasts = await a.toasts();
      t.note('toasts: ' + toasts.join(' / '));
      t.assert(!toasts.some((m) => /^Roll uppdaterad/.test(m)), 'inget "Roll uppdaterad" vid serverfel');
      t.assert(toasts.some((m) => /kunde inte sparas/.test(m)), 'tydligt fel');
      t.assert(rolePerms(t, 'personal').includes('ao_material'), 'servern oförändrad');
      t.assert(await a.eval(() => state.roles.find((r) => r.id === 'personal').permissions.includes('ao_material')), 'klienten rullade tillbaka');
      const banner = await a.text('#vf-unsaved-banner');
      t.assert(/Roller personal — Tekniker/.test(banner), 'bannern namnger den osparade rolländringen: ' + banner.slice(0, 160));
      // Användaren väljer "Återuppta" när servern fungerar igen
      t.fake.clearFaults();
      await a.clearToasts();
      await a.page.locator('#vf-unsaved-banner button', { hasText: 'Återuppta' }).click();
      await a.waitToast(/Ändringen är sparad/, 6000);
      t.assert(!rolePerms(t, 'personal').includes('ao_material'), 'servern har den nya behörigheten efter Återuppta');
      t.assert(!(await a.eval(() => !!document.querySelector('#vf-unsaved-banner') && document.querySelector('#vf-unsaved-banner').offsetParent !== null)), 'bannern borta');
      const f = await t.world.session({ viewport: 'iphone' });
      await f.login('falt');
      t.assert(await f.eval(() => !Auth.can('ao_material')), 'fältarbetaren saknar ao_material efter inloggning');
    },
  },
  {
    id: 'STAFF-02', module: 'Personalregister', name: 'Byta roll på en person: serverfel → inget "Sparat"; lyckat byte sparas på servern',
    async run(t) {
      const a = await t.world.session({ viewport: 'laptop' });
      await a.login('admin');
      await a.go('pg-staff');
      const editStaff = async () => {
        await a.eval(() => StaffPage.openEdit ? StaffPage.openEdit('ST-005') : StaffPage.open('ST-005'));
        await a.page.waitForSelector('.modal-overlay.open #sf-first');
        await a.eval(() => { const e = document.getElementById('sf-role'); e.value = 'personal'; e.dispatchEvent(new Event('change', { bubbles: true })); });
        await a.clickModalButton(/^Spara$/);
      };
      t.fake.addFault({ match: /store-key-write:writeMerge/, mode: 'fail', status: 503, error: 'http_503', times: 3 });
      await editStaff();
      await a.settle(2500);
      const toasts = await a.toasts();
      t.note('toasts: ' + toasts.join(' / '));
      t.assert(!toasts.some((m) => /^Sparat/.test(m)), 'inget "Sparat" vid serverfel');
      t.assert(t.fake.get('staff').find((x) => x.id === 'ST-005').role === 'begransad', 'servern oförändrad');
      t.assert(await a.eval(() => state.staff.find((x) => x.id === 'ST-005').role === 'begransad'), 'klienten rullade tillbaka');
      // Användaren väljer "Kasta" och gör om ändringen
      t.fake.clearFaults();
      await a.page.locator('#vf-unsaved-banner button', { hasText: 'Kasta' }).click();
      await a.settle(300);
      await a.clearToasts();
      await editStaff();
      await a.waitToast(/^Sparat/, 6000);
      t.assert(t.fake.get('staff').find((x) => x.id === 'ST-005').role === 'personal', 'rollbytet sparat på servern');
    },
  },
  {
    id: 'ADMIN-01', module: 'Inställningar och administration', name: 'Admin-flikarna öppnas utan fel; fältarbetare nekas Admin; äldre sparväg utan bekräftelse ger varning vid serverfel',
    async run(t) {
      const a = await t.world.session({ viewport: 'laptop' });
      await a.login('admin');
      await a.go('pg-admin');
      const tabs = await a.page.locator('.page.active .admin-tab').allTextContents();
      t.assert(tabs.length >= 8, 'flikar: ' + tabs.length);
      for (let i = 0; i < tabs.length; i++) {
        await a.page.locator('.page.active .admin-tab').nth(i).click();
        await a.settle(150);
        const txt = await a.text('#pg-admin-content');
        t.assert(txt.trim().length > 40 && !/undefined|NaN|\[object Object\]/.test(txt), 'fliken "' + tabs[i].trim() + '" renderar innehåll');
      }
      // Äldre sparväg (artikelkategori/kontaktperson etc. anropar persist() utan argument):
      // simulera via en direkt mutation + persist() med serverfel → varningen ska visas.
      await a.clearToasts();
      t.fake.addFault({ match: /store-key-write:writeMerge/, mode: 'fail', status: 503, error: 'http_503', times: 3 });
      await a.eval(() => { const art = state.articles[0]; art.name = art.name + ' E2E'; persist(); showToast('Sparat'); });
      await a.settle(2500);
      const toasts = await a.toasts();
      t.note('toasts: ' + toasts.join(' / '));
      t.assert(/servern bekräftade inte/.test(toasts[toasts.length - 1] || ''), 'sista beskedet är varningen, inte "Sparat"');
      t.fake.clearFaults();
      const f = await t.world.session({ viewport: 'android' });
      await f.login('falt');
      await f.go('pg-admin');
      const ftxt = await f.eval(() => (document.querySelector('.page.active') || document.body).innerText);
      t.assert(!/Roller & behörigheter/.test(ftxt), 'fältarbetaren ser inte adminsidan');
    },
  },
];
