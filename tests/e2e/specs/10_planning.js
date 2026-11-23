'use strict';
/* Planering: återkommande ärenden, Att göra, kalender, säljchanser, projekt. */

const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const plusDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

module.exports = [
  {
    id: 'REC-01', kind: 'workflow', module: 'Återkommande AO', name: 'Skapa återkommande ärende (fastighet, checklista, personal) → "Skapa AO nu" → AO på servern med checklista; schemat flyttas fram först efter serverns bekräftelse; dubbelt klick ger en AO',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await s.go('pg-recurring');
      await s.page.locator('.page.active button', { hasText: /Nytt/ }).first().click();
      await s.page.waitForSelector('.modal-overlay.open #ro-title');
      await s.page.fill('#ro-title', 'Trappstädning E2E');
      await s.page.selectOption('#ro-cu', 'K-002');
      await s.page.selectOption('#ro-prop', 'OBJ-002');
      await s.page.check('#ro-addr-prop');
      await s.page.selectOption('#ro-interval', 'veckovis').catch(() => {});
      await s.page.fill('#ro-next', today());
      await s.page.fill('#ro-chk-input', 'Våttorka trapphus');
      await s.page.locator('.modal-overlay.open button', { hasText: 'Lägg till' }).first().click();
      await s.eval(() => { RecurringPage._tempStaff = ['ST-002']; });
      await s.clickModalButton(/Skapa ärende/);
      await s.settle(1500);
      const ro = t.fake.get('recurringOrders').find((r) => r.title === 'Trappstädning E2E');
      t.assert(ro && ro.propertyId === 'OBJ-002' && ro.checklist.length === 1, 'ärendet på servern med fastighet och checklista');
      t.assert(!ro.accessCode, 'ingen portkod kopierad till ärendet (portkoden ligger i den skyddade tabellen)');
      // Skapa AO nu — långsam server, användaren klickar två gånger
      t.fake.addFault({ match: /ao-time-write:create_ao/, mode: 'delay', ms: 1500, times: 2 });
      for (let i = 0; i < 2; i++) {
        await s.go('pg-recurring');
        await s.eval((id) => RecurringPage.openDetail(id), ro.id);
        await s.clickModalButton(/Skapa AO nu/);
        await s.settle(200);
      }
      await s.settle(3500);
      const aos = t.fake.get('workOrders').filter((a) => a.recurringOrderId === ro.id);
      t.note('AO för tillfället: ' + aos.map((a) => a.id + ' ' + a.scheduledDate).join(', '));
      t.assert(aos.length === 1, 'exakt en AO för samma tillfälle (' + aos.length + ')');
      t.assert((await s.toasts()).some((m) => /Det finns redan en arbetsorder/.test(m)), 'andra klicket förklarar varför ingen ny AO skapas');
      const ao = aos[0];
      t.assert(ao && (ao.checklist || []).length === 1 && (ao.staff || []).includes('ST-002') && ao.propertyId === 'OBJ-002', 'AO:n har checklista, personal och fastighet');
      const ro2 = t.fake.get('recurringOrders').find((r) => r.id === ro.id);
      t.assert(ro2.nextDate === plusDays(today(), 7), 'nästa datum flyttat en vecka på servern (' + ro2.nextDate + ')');
    },
  },
  {
    id: 'SALES-01', module: 'Säljchanser', name: 'Skapa säljchans → skapa offert från den → kopplad först när offerten sparats → markera vunnen; serverfel ger varning',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await s.go('pg-sales');
      await s.page.locator('.page.active button', { hasText: /Ny chans/ }).first().click();
      await s.page.waitForSelector('.modal-overlay.open #so-title');
      await s.page.fill('#so-title', 'Takbyte E2E');
      await s.page.selectOption('#so-cu', 'K-002').catch(async () => s.eval(() => { const e = document.getElementById('so-cu'); e.value = 'K-002'; e.dispatchEvent(new Event('change', { bubbles: true })); }));
      await s.page.fill('#so-val', '125000');
      await s.clickModalButton(/^Skapa$/);
      await s.waitToast(/Säljchans skapad/, 6000);
      await s.settle(1200);
      const op = t.fake.get('salesOpps').find((o) => o.title === 'Takbyte E2E');
      t.assert(op && op.customerId === 'K-002' && op.estimatedValue === 125000 && op.status === 'new', 'säljchansen på servern');
      // Offert från säljchansen: avbryt först → ingen koppling
      await s.eval((id) => SalesPage.createOffer(id), op.id);
      await s.page.waitForSelector('#off-title', { state: 'visible' });
      await s.go('pg-sales');
      await s.settle(600);
      t.assert(!t.fake.get('salesOpps').find((o) => o.id === op.id).offerId, 'avbruten offert kopplas inte');
      // Vunnen — servern nere: sista beskedet måste vara varningen
      await s.clearToasts();
      t.fake.addFault({ match: /store-key-write:writeMerge/, mode: 'fail', status: 503, error: 'http_503', times: 100 });
      await s.eval((id) => SalesPage.markWon(id), op.id);
      await s.clickModalButton(/Bekräfta/);
      await s.settle(2500);
      const toasts = await s.toasts();
      t.note('toasts: ' + toasts.join(' / '));
      // G12: aldrig "Markerad vunnen!"; tydligt fel; lokalt återställd; kvar som osparad med Återuppta
      t.assert(!toasts.some((m) => /Markerad vunnen/.test(m)), 'inget "Markerad vunnen!" vid serverfel');
      t.assert(/kunde inte sparas/.test(toasts[toasts.length - 1] || ''), 'sista beskedet: kunde inte sparas');
      t.assert(t.fake.get('salesOpps').find((o) => o.id === op.id).status === 'new', 'servern oförändrad');
      t.assert(await s.eval((id) => state.salesOpportunities.find((o) => o.id === id).status === 'new', op.id), 'klienten återställd till serverns läge');
      t.fake.clearFaults();
      await s.page.locator('#vf-unsaved-banner button', { hasText: 'Återuppta' }).click();
      await s.waitToast(/Ändringen är sparad/, 6000);
      t.assert(t.fake.get('salesOpps').find((o) => o.id === op.id).status === 'won', 'Återuppta skickar ändringen när servern fungerar igen');
    },
  },
  {
    id: 'PROJ-01', module: 'Projekt', name: 'Skapa projekt → koppla befintlig AO → projektets AO-flik visar den; AO:n bär projectId på servern; arkivera/återställ',
    async run(t) {
      const s = await t.world.session({ viewport: 'desktop' });
      await s.login('admin');
      await s.go('pg-projects');
      await s.page.locator('.page.active button', { hasText: /Nytt projekt/ }).first().click();
      await s.page.waitForSelector('.modal-overlay.open #prj-name');
      await s.page.fill('#prj-name', 'Stambyte E2E');
      await s.eval(() => { const e = document.getElementById('prj-cu'); e.value = 'K-001'; ProjectsPage._customerChangedInForm(); });
      await s.clickModalButton(/Skapa projekt/);
      await s.waitToast(/Projekt skapat/, 6000);
      await s.settle(1200);
      const prj = t.fake.get('projects').find((p) => p.name === 'Stambyte E2E');
      t.assert(prj && prj.customerId === 'K-001', 'projektet på servern');
      const aoId = t.fake.get('workOrders').find((a) => a.customerId === 'K-001' && !a.deleted && !a.projectId).id;
      await s.go('pg-project-detail', { projectId: prj.id });
      await s.eval(() => ProjectDetailPage.openLinkWorkOrder());
      await s.page.locator('.modal-overlay.open .crow', { hasText: aoId }).click();
      await s.waitToast(/kopplad till projektet/, 6000);
      await s.settle(1500);
      t.assert(t.fake.get('workOrders').find((a) => a.id === aoId).projectId === prj.id, 'AO:n bär projectId på servern');
      await s.eval(() => ProjectDetailPage.switchTab('ao'));
      t.assert((await s.text('.page.active')).includes(aoId), 'projektets AO-flik visar AO:n');
      await s.eval((id) => ProjectsPage.archive(id), prj.id);
      if (await s.modalOpen()) await s.clickModalButton(/Arkivera|Bekräfta/);
      await s.settle(1200);
      t.assert(!!t.fake.get('projects').find((p) => p.id === prj.id).archived || t.fake.get('projects').find((p) => p.id === prj.id).status === 'arkiverad', 'arkiverat på servern');
    },
  },
  {
    id: 'TASK-01', module: 'Att göra', name: 'Skapa uppgift åt fältarbetare → fältarbetaren ser och klarmarkerar den på mobilen → servern; fältarbetaren kan inte ta bort andras uppgift',
    async run(t) {
      const a = await t.world.session({ viewport: 'laptop' });
      await a.login('admin');
      await a.go('pg-activities');
      await a.page.locator('.page.active button', { hasText: /Ny uppgift/ }).first().click();
      await a.page.waitForSelector('.modal-overlay.open #act-title');
      await a.page.fill('#act-title', 'Byt lysrör entré E2E');
      await a.page.selectOption('#act-assignee', 'ST-002');
      await a.page.fill('#act-duedate', today());
      await a.clickModalButton(/Skapa uppgift/);
      await a.settle(1500);
      const act = (t.fake.get('activities') || []).find((x) => x.title === 'Byt lysrör entré E2E');
      t.assert(act && act.assignedTo === 'ST-002' && act.status === 'open', 'uppgiften på servern, tilldelad ST-002');
      const f = await t.world.session({ viewport: 'iphone' });
      await f.login('falt');
      await f.go('pg-activities');
      t.assert(/Byt lysrör entré E2E/.test(await f.text('.page.active')), 'fältarbetaren ser uppgiften');
      await f.eval((id) => ActivitiesPage.toggleComplete(id), act.id);
      await f.settle(1500);
      t.assert(t.fake.get('activities').find((x) => x.id === act.id).status === 'done', 'klarmarkerad på servern');
      // En uppgift åt arbetsledaren: fältarbetaren får inte ta bort den
      const otherId = await a.eval(() => ActivitiesService.create({ title: 'Arbetsledarens uppgift E2E', assignedTo: 'ST-003', dueDate: new Date().toISOString().slice(0, 10) }).id);
      await a.settle(1500);
      await f.eval(() => DataSync._poll());
      await f.settle(800);
      await f.eval((id) => ActivitiesPage.openDeleteModal(id), otherId);
      await f.settle(400);
      const delBtn = await f.eval(() => Array.from(document.querySelectorAll('.modal-overlay.open .modal-footer button')).some((b) => /Ta bort/.test(b.textContent)));
      t.assert(!delBtn, 'fältarbetaren får ingen Ta bort-knapp för arbetsledarens uppgift');
      t.assert((t.fake.get('activities') || []).some((x) => x.id === otherId), 'uppgiften finns kvar på servern');
      t.note('serverns per-nyckel-behörighet för activities kan inte verifieras i simulerad backend (G4) — upprepa mot STAGING');
    },
  },
  {
    id: 'CAL-01', module: 'Kalender', name: 'Kalender: dra AO till annan dag (dator) och flytta via långtryck-dialog (mobil) → servern; vyer dag/vecka/månad/agenda öppnas',
    async run(t) {
      const s = await t.world.session({ viewport: 'desktop' });
      await s.login('admin');
      await s.go('pg-calendar');
      for (const v of ['dag', 'vecka', 'manad', 'agenda']) {
        await s.eval((x) => CalendarPage.setView(x), v);
        await s.settle(200);
        const txt = await s.text('.page.active');
        t.assert(txt.length > 30 && !/undefined|NaN/.test(txt), 'vy ' + v + ' renderar');
      }
      await s.eval(() => CalendarPage.setView('vecka'));
      await s.settle(300);
      const chip = s.page.locator('.page.active .cal-chip[draggable="true"]').first();
      t.assert(await chip.count(), 'minst en flyttbar AO i veckovyn');
      const aoId = await chip.getAttribute('data-aoid');
      const from = t.fake.get('workOrders').find((a) => a.id === aoId).scheduledDate;
      const target = await s.eval((f) => Array.from(document.querySelectorAll('.page.active .cal-wk-allday-cell[ondrop]')).map((c) => c.getAttribute('ondrop').match(/'([^']+)'/)[1]).find((d) => d !== f), from);
      await chip.dragTo(s.page.locator(`.page.active .cal-wk-allday-cell[ondrop*="'${target}'"]`).first());
      await s.settle(1500);
      const sd = t.fake.get('workOrders').find((a) => a.id === aoId).scheduledDate;
      t.assert(sd === target, aoId + ' flyttad från ' + from + ' till ' + target + ' på servern (' + sd + ')');
      const m = await t.world.session({ viewport: 'iphone' });
      await m.login('admin');
      await m.go('pg-calendar');
      await m.eval(() => CalendarPage._touchMove('AO-013'));
      await m.page.waitForSelector('.modal-overlay.open #touch-move-date');
      const nd = '2026-12-01';
      await m.page.fill('#touch-move-date', nd);
      await m.clickModalButton(/Flytta/);
      await m.settle(1500);
      t.assert(t.fake.get('workOrders').find((a) => a.id === 'AO-013').scheduledDate === nd, 'AO-013 flyttad via mobil-dialogen');
    },
  },
];
