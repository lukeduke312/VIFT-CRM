/**
 * ActivitiesService — schemalagda uppföljningsuppgifter ("Uppgifter" i UI:t)
 *
 * Separerat från ActivityService (audit-logg).
 * Aktiviteter är användar-skapade uppgifter med datum, ansvarig och status.
 *
 * Datamodell: { id, title, type, priority, relatedType, relatedId,
 *               customerId, propertyId, assignedTo, dueDate, dueTime, note,
 *               status, createdAt, createdBy, completedAt, completedBy }
 *
 * V53A (oberoende produktbeslut — se sessionens diskussion): VIFT hade
 * REDAN ett i praktiken identiskt "uppgift"-koncept här (öppna/klara,
 * förfallodatum, ansvarig, relation till offert/AO) innan "Uppgifter/
 * To-do Core"-omgången. Istället för att bygga ett parallellt
 * `state.tasks`/TaskService-system (som skulle lämna VIFT med två
 * konkurrerande att-göra-koncept) utökas DENNA befintliga modell med
 * exakt de delar som saknades — `propertyId` här, `reopen()`,
 * bredare typ-/prioritetsvokabulär. Befintliga fält byts ALDRIG namn,
 * inga befintliga poster migreras/skrivs om — bara additiva, bakåt-
 * kompatibla tillägg. `relatedType`/`relatedId` (offert/AO) lämnas helt
 * orörda — nya AO-länkade uppgifter återanvänder SAMMA mekanism (inte en
 * separat `workOrderId`) så att befintlig sido-effekt-kod (t.ex. att en
 * slutförd uppföljning loggar en notering på AO:n/offerten) fortsätter
 * fungera identiskt för uppgifter skapade via det nya UI:t. */
const ActivitiesService = {

  /* V53A — bredare typ-vokabulär. 'followup'/'call'/'meeting'/'email'/
     'task' är de HISTORISKA lagrade värdena (aldrig omdöpta — befintliga
     poster måste fortsätta fungera oförändrat). 'todo'/'purchase'/'other'
     är nya, additiva värden för nyskapade uppgifter. */
  TYPES: ['todo', 'followup', 'call', 'purchase', 'other', 'meeting', 'email', 'task'],

  /* V53A — samma Svenska-literal-som-lagrat-värde-konvention som redan
     används för AO/offert-prioritet i övriga kodbasen (Schema.workOrder()
     m.fl.: 'akut'|'hög'|'normal'|'låg') — INTE separata engelska
     enum-nycklar med en egen label-karta, vilket skulle avvika från
     resten av appen. Funktionellt likvärdigt med uppdragets
     low/normal/high/urgent. */
  PRIORITIES: ['låg', 'normal', 'hög', 'akut'],
  _PRIORITY_RANK: { akut: 0, hög: 1, normal: 2, låg: 3 },

  create(data) {
    if (!state.activities) state.activities = [];
    const id = newId(state.activities, 'ACT');
    const user = state.currentUser;
    const act = Object.assign({
      id,
      title:       '',
      type:        'followup',
      relatedType: null,
      relatedId:   null,
      customerId:  null,
      /* V53A — nytt, additivt fält. Alltid `null`/tomt på befintliga
         poster (fanns inte tidigare) — inget migreringsbehov. */
      propertyId:  null,
      /* V54B — nytt, additivt fält, samma tomt-värde-mönster som
         propertyId ovan. Ingen ny ProjectTask-modell — en projekt-uppgift
         är helt enkelt en vanlig Uppgift med projectId satt. */
      projectId:   null,
      assignedTo:  user ? user.id : null,
      dueDate:     tdy(),
      dueTime:     '',
      note:        '',
      priority:    'normal',
      status:      'open',
      createdAt:   new Date().toISOString(),
      createdBy:   user ? user.id : null,
      completedAt: null,
      completedBy: null
    }, data, { id });
    state.activities.push(act);
    persist();
    return act;
  },

  complete(id) {
    const act = this._get(id);
    if (!act) return;
    const user = state.currentUser;
    act.status      = 'done';
    act.completedAt = new Date().toISOString();
    act.completedBy = user ? user.id : null;
    persist();
    return act;
  },

  /* V53A — saknades helt: ingen väg tillbaka från "klar" till "öppen".
     Rensar completedAt/completedBy exakt som uppdraget kräver (§13). */
  reopen(id) {
    const act = this._get(id);
    if (!act) return;
    act.status      = 'open';
    act.completedAt = null;
    act.completedBy = null;
    persist();
    return act;
  },

  reschedule(id, newDate, newTime) {
    const act = this._get(id);
    if (!act) return;
    act.dueDate  = newDate;
    act.dueTime  = newTime || act.dueTime;
    act.status   = 'open';
    persist();
    return act;
  },

  update(id, changes) {
    const act = this._get(id);
    if (!act) return;
    /* V53A §12 — id/createdAt får ALDRIG skrivas över av en redigering,
       oavsett vad anroparen råkar skicka med i `changes`. */
    const safeChanges = Object.assign({}, changes);
    delete safeChanges.id;
    delete safeChanges.createdAt;
    Object.assign(act, safeChanges, { updatedAt: new Date().toISOString() });
    persist();
    return act;
  },

  delete(id) {
    const idx = (state.activities || []).findIndex(a => a.id === id);
    if (idx !== -1) { state.activities.splice(idx, 1); persist(); }
  },

  _get(id) {
    return (state.activities || []).find(a => a.id === id) || null;
  },

  getByRelated(relatedType, relatedId) {
    return (state.activities || []).filter(a => a.relatedType === relatedType && a.relatedId === relatedId);
  },

  getByAssignee(staffId) {
    return (state.activities || []).filter(a => a.assignedTo === staffId);
  },

  /* V54B — Projekt-uppgifter, ren läsning. */
  getByProject(projectId) {
    return (state.activities || []).filter(a => a.projectId === projectId);
  },

  getOpen() {
    return (state.activities || []).filter(a => a.status === 'open');
  },

  getOverdue() {
    const today = tdy();
    return this.getOpen().filter(a => a.dueDate && a.dueDate < today);
  },

  getToday() {
    const today = tdy();
    return this.getOpen().filter(a => a.dueDate === today);
  },

  getUpcoming(days = 7) {
    const today = tdy();
    const limit = _ds(days);
    return this.getOpen().filter(a => a.dueDate && a.dueDate > today && a.dueDate <= limit);
  },

  getStats(staffId) {
    const all      = staffId ? this.getByAssignee(staffId) : (state.activities || []);
    const open     = all.filter(a => a.status === 'open');
    const today    = tdy();
    return {
      overdue:  open.filter(a => a.dueDate && a.dueDate < today).length,
      today:    open.filter(a => a.dueDate === today).length,
      upcoming: open.filter(a => a.dueDate && a.dueDate > today).length,
      done:     all.filter(a => a.status === 'done').length
    };
  },

  /* V53A — nya etiketter (todo/purchase/other) tillagda; BEFINTLIGA
     etiketter för 'followup'/'call' justerade till uppdragets exakta
     svenska ordval ("Följa upp"/"Ringa" — tidigare "Uppföljning"/
     "Ring kund") eftersom det bara är UI-text, inget lagrat värde —
     ingen bakåtkompatibilitetsrisk. 'meeting'/'email'/'task' behåller
     sina etiketter oförändrade för genuint legacy-poster. */
  typeLabel(type) {
    return {
      todo:'Att göra', followup:'Följa upp', call:'Ringa', purchase:'Köpa', other:'Övrigt',
      meeting:'Möte', email:'Mejl', task:'Uppgift'
    }[type] || type;
  },

  typeIcon(type) {
    return {
      todo:'check-square', followup:'bell', call:'phone', purchase:'package', other:'more-horizontal',
      meeting:'users', email:'mail', task:'check-square'
    }[type] || 'bell';
  },

  priorityLabel(p) {
    return { akut:'Akut', hög:'Hög', normal:'Normal', låg:'Låg' }[p] || (p || 'Normal');
  },

  priorityRank(p) {
    const r = this._PRIORITY_RANK[p];
    return r === undefined ? 2 : r; // okänt/legacy värde -> behandlas som 'normal'
  },

  /* V53A R1 §7 (oberoende reproducerad blockerare) — TIDIGARE sorterade
     funktionen efter EXAKT förfallodatum FÖRST och lät prioritet bara
     avgöra mellan poster med IDENTISKT datum — så en akut uppgift
     försenad sedan igår kunde hamna EFTER en lågprioriterad uppgift
     försenad sedan en månad, trots att båda är "försenade". Uppdraget
     kräver istället fyra grova HINKAR (försenad / idag / kommande / inget
     datum) FÖRST, och inom SAMMA hink avgör prioritet (akut→hög→normal→
     låg) före det exakta datumet. */
  _dueBucket(a, today) {
    if (!a.dueDate) return 3;                 // inget datum — alltid sist
    if (a.dueDate < today) return 0;           // försenad
    if (a.dueDate === today) return 1;         // idag
    return 2;                                  // kommande
  },

  sortOpen(list) {
    const today = tdy();
    return (list || []).slice().sort((a, b) => {
      const ba = this._dueBucket(a, today), bb = this._dueBucket(b, today);
      if (ba !== bb) return ba - bb;
      const ap = this.priorityRank(a.priority), bp = this.priorityRank(b.priority);
      if (ap !== bp) return ap - bp;
      const ad = a.dueDate || '9999-99-99', bd = b.dueDate || '9999-99-99';
      if (ad !== bd) return ad < bd ? -1 : 1;
      return String(a.id).localeCompare(String(b.id));
    });
  },

  /* V53A §16 — klara uppgifter: nyast slutförd först. */
  sortCompleted(list) {
    return (list || []).slice().sort((a, b) => {
      const ac = a.completedAt || '', bc = b.completedAt || '';
      if (ac !== bc) return ac > bc ? -1 : 1;
      return String(a.id).localeCompare(String(b.id));
    });
  },

  /* V53A R1 §6 — kanonisk kund-upplösning för en uppgift. En OFFERT-länkad
     uppgift (relatedType==='offer') ska ALLTID visa/söka på den kund
     offerten faktiskt tillhör — aldrig ett fristående customerId-fält som
     kan hamna i konflikt med offertens egen kund (se _openForm()s
     kommentar om varför fältet låses för denna typ). En legacy offert-
     uppgift som helt saknar ett eget customerId löses säkert via
     offerten. Icke offert-länkade uppgifter (fristående, kund-, fastighets-
     eller AO-länkade) använder sitt egna customerId oförändrat. */
  resolveCustomer(act) {
    if (!act) return null;
    if (act.relatedType === 'offer' && act.relatedId) {
      const off = getOff(act.relatedId);
      if (off && off.customerId) return getCu(off.customerId);
    }
    return act.customerId ? getCu(act.customerId) : null;
  },

  /* V53A §15 — lokal, snabb textsökning över titel, notering, typ-etikett,
     ansvarig, samt länkad kund/fastighet/AO. Ren funktion, muterar
     ingenting.
     V53A R1 §5 (oberoende reproducerad blockerare) — TIDIGARE indexerades
     `cu.name` rakt av, vilket är TOMT för en privatkund (namnet byggs då
     istället av firstName+lastName via CustomerService.displayName()) —
     radens VISADE namn och det SÖKBARA namnet kunde alltså divergera helt
     för en privatkund. Använder nu samma kanoniska
     CustomerService.displayName() som raden faktiskt visar. */
  search(list, rawQuery) {
    const q = (rawQuery || '').trim().toLowerCase();
    if (!q) return list || [];
    return (list || []).filter(a => {
      const staff = a.assignedTo ? getStaff(a.assignedTo) : null;
      const staffName = staff ? `${staff.firstName} ${staff.lastName}` : '';
      const cu = this.resolveCustomer(a);
      const prop = a.propertyId ? getObj(a.propertyId) : null;
      let relText = '';
      if (a.relatedType === 'offer') relText = 'offert ' + (a.relatedId || '');
      else if (a.relatedType === 'workOrder') {
        const ao = getAO(a.relatedId);
        relText = 'ao ' + (a.relatedId || '') + ' ' + (ao ? ao.title || '' : '');
      }
      const haystack = [
        a.title, a.note, this.typeLabel(a.type), staffName,
        cu ? CustomerService.displayName(cu) : '', prop ? (prop.name || prop.address) : '', relText
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }
};
