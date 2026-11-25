'use strict';
/* QA 2026-11-26: synken (DataSync, var 15:e sekund) ritade om aktuell sida så
   fort inget fält hade fokus och ingen dialog var öppen. Offertguiden är en
   vy i offertsidan — en omritning ersatte guiden med offertlistan och
   osparade ändringar i en befintlig offert försvann. Rättat: redigeringsvyer
   (offertguiden, importguiden, ny rondering, data-unsaved) ritas inte om av
   synken; datan uppdateras ändå i state. Simulerad server. */
module.exports = [{
  id: 'SYNC-ED-01', module: 'Offertmodulen', kind: 'workflow',
  name: 'Synken ritar inte om offertguiden: osparad ändring i en befintlig offert finns kvar efter en serverändring när inget fält har fokus; andra sidor uppdateras som förut',
  async run(t) {
    const s = await t.world.session({ viewport: 'laptop' });
    await s.login('admin');
    const offId = await s.eval(() => (state.offers || []).filter((o) => !o.deleted && !o.archived)[0].id);
    await s.go('pg-offer'); await s.settle(300);
    await s.eval((id) => OffersPage.openEdit(id), offId); await s.settle(400);
    t.assert(await s.eval(() => !!document.querySelector('.page.active .offw-steps')), 'offertguiden är öppen');
    await s.page.fill('#off-title', 'Osparad ändring E2E');
    // Klicka utanför fälten — inget fält har fokus
    await s.eval(() => { document.activeElement && document.activeElement.blur(); });
    // Någon annan ändrar data på servern
    const custs = t.fake.get('customers'); custs[0].notes = 'ändrad av annan ' + Date.now(); t.fake.set('customers', custs); t.fake.touch();
    await s.eval(() => DataSync._poll()); await s.settle(800);
    const r = await s.eval(() => ({ wiz: !!document.querySelector('.page.active .offw-steps'), title: (document.getElementById('off-title') || {}).value, synced: (state.customers[0].notes || '') }));
    t.assert(r.synced.startsWith('ändrad av annan'), 'datan synkades till state (' + r.synced + ')');
    t.assert(r.wiz, 'guiden ritades inte om till offertlistan');
    t.assert(r.title === 'Osparad ändring E2E', 'den osparade titeln finns kvar (' + r.title + ')');
    await s.eval(() => OffersPage._wizardClose && OffersPage._wizardClose()); await s.settle(300);
    // Kontroll: en vanlig listsida ritas fortfarande om av synken
    await s.go('pg-crm'); await s.settle(300);
    const custs2 = t.fake.get('customers'); custs2[0].name = 'Omdöpt av synk E2E'; t.fake.set('customers', custs2); t.fake.touch();
    await s.eval(() => DataSync._poll()); await s.settle(800);
    const txt = await s.eval(() => document.querySelector('.page.active').innerText);
    t.assert(/Omdöpt av synk E2E/.test(txt), 'kundlistan ritades om med den nya datan');
  }
}];
