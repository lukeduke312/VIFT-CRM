/**
 * WorkOrderService — CRUD och statuslogik för arbetsorder
 */
const WorkOrderService = {

  /* V54B R1 — blockerare 4: create() tog tidigare emot ett `projectId` i
     `data` helt okontrollerat — en anropare (formulär idag, ett framtida
     AI-agent-skrivverktyg imorgon) kunde skicka in en kund-/fastighets-
     inkompatibel Projekt-koppling och få en AO skapad med den ändå. En
     icke-tom `projectId` valideras nu ALLTID mot den kanoniska
     `ProjectService.isChildCompatible()` INNAN AO:n skapas — om
     kombinationen är ogiltig skapas INGEN AO alls (varken kopplad eller
     tyst okopplad), utan `{ok:false, error}` returneras. Detta lämnar
     kontraktet för alla BEFINTLIGA anrop utan `projectId` helt orört
     (de returnerar fortfarande AO-objektet direkt) — bara de två
     ställen i kodbasen som faktiskt skickar `projectId`
     (WorkOrdersPage._wizSave, offert→AO-konverteringen i PageShells.js)
     behöver hantera det nya felfallet. */
  create(data) {
    data = data || {};
    if (data.projectId) {
      const compatible = typeof ProjectService !== 'undefined' &&
        ProjectService.isChildCompatible(data.projectId, data.customerId, data.propertyId || '');
      if (!compatible) {
        return { ok: false, error: 'Arbetsordern kunde inte kopplas till det valda projektet (kund/fastighet stämmer inte).' };
      }
    }
    const ao = Object.assign(Schema.workOrder(), data, {
      id:        newId(state.workOrders, 'AO'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    /* R2.5 — EN kanonisk skapande-tids-adress-snapshot, körd HÄR för
       VARJE ny AO oavsett vilket produktionsflöde som anropade create()
       (huvudguiden, Återkommande, Rondering, Serviceintervall, offert->AO,
       Fastighetens direktskapande-knapp, m.fl.) — se
       AddressService.resolveCreateAddressSnapshot()s kommentar för den
       fullständiga motiveringen och regelordningen. Ingen effekt om
       anroparen redan skickat en komplett strukturerad adress (t.ex.
       huvudguiden, som redan gör detta själv) eller satt addressOverride.
       ALDRIG körd från update() — en befintlig AO:s sparade adress är en
       historisk ögonblicksbild, oförändrad sedan R1 §4. */
    if (typeof AddressService !== 'undefined' && typeof AddressService.resolveCreateAddressSnapshot === 'function') {
      AddressService.resolveCreateAddressSnapshot(ao);
    }
    state.workOrders.push(ao);
    console.log('[WorkOrderService] AO skapad lokalt:', ao.id, ao.title);
    ActivityService.log('work_order_created',
      `Arbetsorder ${ao.id} skapad: ${ao.title}`,
      { customerId: ao.customerId, workOrderId: ao.id });
    persist();
    console.log('[WorkOrderService] persist() skickad till Supabase för', ao.id);
    Sidebar.updateBadges();
    /* Push-notis — ej för historiska importer (ao.historicalImport = true) */
    if (!ao.historicalImport &&
        typeof PushService !== 'undefined' &&
        typeof PushService.notifyNewAO === 'function') {
      PushService.notifyNewAO(ao).catch(function(e) {
        console.warn('[WorkOrderService] Push-fel för', ao.id, ':', e);
      });
    }
    this.geocodeAddressIfNeeded(ao).catch(function(e) {
      console.warn('[WorkOrderService] Geokodning misslyckades för', ao.id, ':', e);
    });
    return ao;
  },

  /* V54B §9 — kanonisk koppla/flytta/koppla-loss AO↔Projekt, ETT
     ställe för hela flödet (inte en tyst bieffekt av ett generiskt
     update()-anrop) så att UI:t (ProjectDetailPage "Koppla befintlig
     arbetsorder"/"Flytta"/"Koppla loss", WorkOrderDetailPage:s
     Projekt-väljare) alltid loggar och validerar likadant.
     `projectId` = '' eller null kopplar loss. Validerar ALLTID kund-/
     fastighetsinvarianten defensivt här, oavsett vad anroparen redan
     kontrollerat interaktivt — samma tvålagersdisciplin som V53B R1. */
  setProject(id, projectId, opts) {
    const ao = getAO(id);
    if (!ao) return { ok: false, error: 'Arbetsordern hittades inte' };
    opts = opts || {};
    const by = state.currentUser ? `${state.currentUser.firstName} ${state.currentUser.lastName}`.trim() : 'Admin';
    const oldProjectId = ao.projectId || '';
    const newProjectId = projectId || '';

    if (newProjectId) {
      if (typeof ProjectService === 'undefined' || !ProjectService.isChildCompatible(newProjectId, ao.customerId, ao.propertyId)) {
        return { ok: false, error: 'Arbetsordern är inte förenlig med det valda projektet (kund/fastighet stämmer inte).' };
      }
      /* Om AO:n redan hör till ett ANNAT projekt krävs en uttrycklig
         flytt-bekräftelse från anroparen (opts.confirmedMove) — en AO
         får aldrig tyst "stjälas" från sitt nuvarande projekt. */
      if (oldProjectId && oldProjectId !== newProjectId && !opts.confirmedMove) {
        return { ok: false, error: 'ALREADY_LINKED', currentProjectId: oldProjectId };
      }
    }
    if (newProjectId === oldProjectId) return { ok: true, workOrder: ao, noop: true };

    const newProj = newProjectId ? ProjectService.getById(newProjectId) : null;
    const oldProj = oldProjectId ? ProjectService.getById(oldProjectId) : null;
    let text;
    if (newProjectId && oldProjectId) text = `${by} flyttade arbetsordern från projekt ${oldProj ? oldProj.name : oldProjectId} till ${newProj ? newProj.name : newProjectId}`;
    else if (newProjectId) text = `${by} kopplade arbetsordern till projekt ${newProj ? newProj.name : newProjectId}`;
    else text = `${by} kopplade loss arbetsordern från projekt ${oldProj ? oldProj.name : oldProjectId}`;

    const log = (ao.log || []).slice();
    log.push({ id: 'L' + Date.now(), type: 'project_relation_changed', text, userName: by, timestamp: new Date().toISOString() });
    this._update_internal(id, { projectId: newProjectId, log });
    return { ok: true, workOrder: getAO(id) };
  },

  /* V54B R1 — blockerare 4: den publika update() fick tidigare ändra
     `projectId` som VILKEN ANNAN fält som helst — vilket helt kringgick
     setProject()s kompatibilitetsvalidering, flytt-bekräftelse
     (ALREADY_LINKED) och revisionslogg. `projectId` skyddas nu i
     update() på samma sätt som id/createdAt redan är oföränderliga på
     andra ställen i kodbasen — ENDAST setProject() (via den interna
     _update_internal()) får sätta det. En anropare som råkar skicka med
     `projectId` i en vanlig update()-patch får den tyst ignorerad HÄR
     (fältet tas bort ur patchen), inte en förvirrande delvis-mutation —
     Projekt-relationen ändras uteslutande via den explicita, loggade
     setProject()-vägen. */
  update(id, data) {
    const safeData = Object.assign({}, data);
    delete safeData.projectId;
    return this._update_internal(id, safeData);
  },

  _update_internal(id, data) {
    const ao = getAO(id);
    if (!ao) return null;
    Object.assign(ao, data, { updatedAt: new Date().toISOString() });
    ActivityService.log('work_order_updated',
      `Arbetsorder ${ao.id} redigerad: ${ao.title}`,
      { customerId: ao.customerId, workOrderId: ao.id });
    persist();
    this.geocodeAddressIfNeeded(ao).catch(function(e) {
      console.warn('[WorkOrderService] Geokodning misslyckades för', ao.id, ':', e);
    });
    return ao;
  },

  /* ── Arbetsadress → koordinater ──────────────────────────────────────
   * Körs efter varje create()/update(). R1 §1 (blockerare #1, oberoende
   * reproducerad): byggde tidigare EN EGEN, snävare frågesträng härifrån
   * — bara AO:ns egna address/zip/city — som ALDRIG använde den länkade
   * fastighetens/kundens postnr/ort som fallback, till skillnad från
   * Dashboard-kartans egen (korrekta) kedja. En legacy-AO med bara en
   * gatuadress + länkad fastighet i Göteborg kunde alltså geokodas som
   * bara "Södra Vägen 4" (ingen stadskontext) varje gång update() kördes
   * — och EN GÅNG en koordinat väl sparats på ao.lat/ao.lng prioriterar
   * kartan alltid DEN, och når aldrig sin egen säkrare fallback-kedja.
   * Fixat: använder nu SAMMA kanoniska AddressService.resolveWorkOrderQuery()
   * som kartan — de två kan inte längre divergera.
   *
   * R1 §2 (blockerare #2, oberoende reproducerad) — race mellan två
   * överlappande geokodningsförsök för SAMMA AO (t.ex. adressen ändras och
   * update() körs igen INNAN det första, långsammare geokodningssvaret
   * hunnit komma tillbaka): ett sent svar för den GAMLA frågan kunde
   * skriva över koordinater som redan korrekt satts av ett SENARE, snabbare
   * svar för den NYA frågan. Fixat med en generations-token per AO-id
   * (_geocodeGen) — precis som Dashboard._mapGeneration redan skyddar
   * kartans egen race — plus en extra kontroll att AO:ns adress inte hunnit
   * ändras UNDER väntan (bälte-och-hängslen, skyddar även vägar som inte
   * går via denna tokenmekanism). Ett föråldrat svar kastas TYST — rör
   * varken ao.lat/ao.lng/ao.geocodedAddress, och persisterar ingenting.
   *
   * En oförändrad adress geokodas ALDRIG om (jämförs mot
   * ao.geocodedAddress). Körs alltid asynkront EFTER att create()/update()
   * redan persistat synkront — geokodning får aldrig blockera eller kunna
   * få ett spara-anrop att krascha (uppdragets §8). */
  _geocodeGen: {}, // { [aoId]: senaste startade geokodningsförsökets nummer }

  async geocodeAddressIfNeeded(ao) {
    if (!ao || typeof AddressService === 'undefined') return;
    const resolved = AddressService.resolveWorkOrderQuery(ao);
    const query = resolved ? resolved.query : '';
    if (!query) {
      if (ao.lat != null || ao.lng != null || ao.geocodedAddress) {
        ao.lat = null; ao.lng = null; ao.geocodedAddress = '';
        persist();
      }
      return;
    }
    if (query === ao.geocodedAddress && ao.lat != null && ao.lng != null) return; // redan geokodad, oförändrad

    const myGen = (this._geocodeGen[ao.id] || 0) + 1;
    this._geocodeGen[ao.id] = myGen;

    const coord = await AddressService.geocodeTrusted(query, resolved.hasCityContext);

    /* Stale-kontroll #1: har ett NYARE geokodningsförsök för samma AO redan
       startat medan vi väntade på detta svar? Om så, kasta TYST — det
       nyare försöket äger sanningen. */
    if (this._geocodeGen[ao.id] !== myGen) return;
    /* Stale-kontroll #2 (bälte-och-hängslen): resolvera AO:ns adress IGEN,
       mot dess NUVARANDE (kanske sedan ändrade) tillstånd — om frågan inte
       längre är densamma som den vi just geokodade, hör svaret till en
       adress som inte längre gäller. Kasta TYST, rör ingenting. */
    const recheck = AddressService.resolveWorkOrderQuery(getAO(ao.id) || ao);
    if (!recheck || recheck.query !== query) return;

    if (coord) {
      ao.lat = coord.lat;
      ao.lng = coord.lng;
    } else if (ao.geocodedAddress !== query) {
      /* Adressen ändrades men det nya försöket gav inget säkert resultat —
         gamla koordinater hörde till en ANNAN adress och får inte stå kvar
         (hellre ingen nål än en nål på fel adress, uppdragets §8). */
      ao.lat = null;
      ao.lng = null;
    }
    ao.geocodedAddress = query;
    persist();
  },

  setStatus(id, status) {
    const ao = getAO(id);
    if (!ao) return null;
    const prev = ao.status;
    ao.status    = status;
    ao.updatedAt = new Date().toISOString();
    if (status === 'klar') ao.completedAt = new Date().toISOString();
    ActivityService.log('work_order_status',
      `Arbetsorder ${ao.id} ändrad: ${statusLabel(prev)} → ${statusLabel(status)}`,
      { customerId: ao.customerId, workOrderId: ao.id });
    persist();
    Sidebar.updateBadges();
    return ao;
  },

  markComplete(id, completedBy) {
    const ao = getAO(id);
    if (ao && completedBy) ao.completedBy = completedBy;
    return this.setStatus(id, 'klar');
  },

  /* Checklista */
  addChecklist(aoId, text) {
    const ao = getAO(aoId);
    if (!ao) return;
    ao.checklist = ao.checklist || [];
    ao.checklist.push({ id: 'c' + Date.now(), text, done: false });
    ao.updatedAt = new Date().toISOString();
    persist();
  },

  toggleChecklist(aoId, idx) {
    const ao = getAO(aoId);
    if (!ao || !ao.checklist[idx]) return;
    ao.checklist[idx].done = !ao.checklist[idx].done;
    ao.updatedAt = new Date().toISOString();
    persist();
  },

  removeChecklist(aoId, idx) {
    const ao = getAO(aoId);
    if (!ao) return;
    ao.checklist.splice(idx, 1);
    ao.updatedAt = new Date().toISOString();
    persist();
  },

  /* Material */
  addMaterial(aoId, mat) {
    const ao = getAO(aoId);
    if (!ao) return;
    ao.materials = ao.materials || [];
    const entry = Object.assign({ id: 'M' + Date.now() }, mat);
    ao.materials.push(entry);
    ao.updatedAt = new Date().toISOString();
    ActivityService.log('material_added',
      `Material tillagt på ${ao.id}: ${mat.name}`,
      { workOrderId: aoId, customerId: ao.customerId });
    persist();
    return entry;
  },

  updateMaterial(aoId, matId, data) {
    const ao = getAO(aoId);
    if (!ao) return;
    const mat = (ao.materials || []).find(m => m.id === matId);
    if (mat) { Object.assign(mat, data); ao.updatedAt = new Date().toISOString(); persist(); }
  },

  deleteMaterial(aoId, matId) {
    const ao = getAO(aoId);
    if (!ao) return;
    ao.materials = (ao.materials || []).filter(m => m.id !== matId);
    ao.updatedAt = new Date().toISOString();
    ActivityService.log('material_removed', `Material borttaget från ${ao.id}`,
      { workOrderId: aoId, customerId: ao.customerId });
    persist();
  },

  /* Anteckningar */
  addNote(aoId, text, imageData = '') {
    const ao = getAO(aoId);
    if (!ao) return;
    ao.notes = ao.notes || [];
    const n = {
      id:        'N' + Date.now(),
      text,
      imageData,
      staffName: state.currentUser ? `${state.currentUser.firstName} ${state.currentUser.lastName}`.trim() : '',
      timestamp: new Date().toISOString()
    };
    ao.notes.push(n);
    ao.updatedAt = new Date().toISOString();
    persist();
    return n;
  },

  /* Materialprissummering */
  materialTotal(ao) {
    return (ao.materials || []).reduce((s, m) => s + (m.qty || 0) * (m.sellPrice || 0), 0);
  },

  /* Klara denna månad */
  doneThisMonth() {
    const m = tdy().substring(0, 7);
    return (state.workOrders || []).filter(a =>
      a.status === 'klar' && (a.completedAt || '').startsWith(m)
    ).length;
  },

  /* Ordrar redo för fakturering — kräver faktiskt fakturerbart innehåll */
  readyForInvoice() {
    return (state.workOrders || []).filter(a =>
      a.status === 'klar' && !a.invoiceId && this.getBillingStatus(a).eligible
    );
  },

  /* AO-PRICING-RECOVERY R2 — Blocker 1: DELEGERAR HELT till
     BillingQueueService.getPricingStatusForAO(), som i sin tur bygger
     på EXAKT samma getUnclaimedSourcesForAO()-lista som
     InvoiceService.createFromAO() själv kräver att ALLA poster i är
     `selectable` för. R1:s egen omimplementation (`entries.some(t =>
     t.billable && t.hourRate>0)`) kollade bara OM NÅGON post var
     giltig — en AO med EN giltig historisk tidpost + två trasiga
     visade då "Redo fakturering" fast `InvoiceService` fortfarande
     vägrade (kräver ALLA, inte NÅGON). Genom att aldrig omimplementera
     samma regel på två ställen kan de per konstruktion inte glida isär
     igen. Returnerar { hasContent, eligible, pricingBlocked,
     otherBlocked, issues } — se BillingQueueService.js för definitionen. */
  getBillingStatus(ao) {
    if (!ao || typeof BillingQueueService === 'undefined') {
      return { hasContent: false, eligible: false, pricingBlocked: false, otherBlocked: false, issues: [] };
    }
    return BillingQueueService.getPricingStatusForAO(ao.id);
  },

  /* Bakåtkompatibel tunn wrapper — bara `eligible`, för ev. befintliga
     anropare som förväntar sig ett booleskt svar. Ingen egen
     villkorslogik kvar här längre. */
  _hasBillableContent(ao) {
    return this.getBillingStatus(ao).eligible;
  },

  /* ── Arkiv & Papperskorg ────────────── */

  archive(id) {
    const ao = getAO(id);
    if (!ao) return;
    const by = state.currentUser ? `${state.currentUser.firstName} ${state.currentUser.lastName}`.trim() : '';
    ao.archived   = true;
    ao.archivedAt = new Date().toISOString();
    ao.archivedBy = by;
    ao.updatedAt  = new Date().toISOString();
    ActivityService.log('work_order_archived', `Arbetsorder ${ao.id} arkiverad`, { workOrderId: id, customerId: ao.customerId });
    persist();
    Sidebar.updateBadges();
  },

  restoreFromArchive(id) {
    const ao = getAO(id);
    if (!ao) return;
    ao.archived   = false;
    ao.archivedAt = '';
    ao.archivedBy = '';
    ao.updatedAt  = new Date().toISOString();
    ActivityService.log('work_order_restored', `Arbetsorder ${ao.id} återställd från arkiv`, { workOrderId: id, customerId: ao.customerId });
    persist();
    Sidebar.updateBadges();
  },

  softDelete(id) {
    const ao = getAO(id);
    if (!ao) return;
    const by  = state.currentUser ? `${state.currentUser.firstName} ${state.currentUser.lastName}`.trim() : '';
    const now = new Date();
    ao.deleted     = true;
    ao.deletedAt   = now.toISOString();
    ao.deletedBy   = by;
    ao.deleteAfter = new Date(now.getTime() + 14 * 86400000).toISOString();
    ao.updatedAt   = now.toISOString();
    ActivityService.log('work_order_deleted', `Arbetsorder ${ao.id} borttagen (papperskorg)`, { workOrderId: id, customerId: ao.customerId });
    persist();
    Sidebar.updateBadges();
  },

  restoreFromTrash(id) {
    const ao = getAO(id);
    if (!ao) return;
    ao.deleted     = false;
    ao.deletedAt   = '';
    ao.deletedBy   = '';
    ao.deleteAfter = '';
    ao.updatedAt   = new Date().toISOString();
    ActivityService.log('work_order_restored', `Arbetsorder ${ao.id} återställd från papperskorg`, { workOrderId: id, customerId: ao.customerId });
    persist();
    Sidebar.updateBadges();
  },

  permanentDelete(id) {
    const idx = state.workOrders.findIndex(a => a.id === id);
    if (idx === -1) return;
    const ao = state.workOrders[idx];
    ActivityService.log('work_order_permanent_delete', `Arbetsorder ${id} raderad permanent`, { workOrderId: id, customerId: ao ? ao.customerId : '' });
    state.workOrders.splice(idx, 1);
    persist();
    Sidebar.updateBadges();
  },

  updateStaff(aoId, opts = {}) {
    const ao = getAO(aoId);
    if (!ao) return;
    const user = state.currentUser;
    const by = user ? `${user.firstName} ${user.lastName}`.trim() : 'Okänd';
    const { staffIds = [], responsibleStaffId = '', moveToPool = false } = opts;
    const oldStaff = [...(ao.staff || [])];
    const oldResp  = ao.responsibleStaffId || '';
    ao.log = ao.log || [];

    if (moveToPool) {
      ao.staff = [];
      ao.status = 'pool';
      ao.responsibleStaffId = '';
      ao.log.push({ id: 'L'+Date.now(), type: 'staff_changed', text: `${by} flyttade ordern till arbetspoolen`, userName: by, timestamp: new Date().toISOString() });
    } else {
      const staffName = id => { const s = getStaff(id); return s ? `${s.firstName} ${s.lastName}` : id; };
      const added   = staffIds.filter(id => !oldStaff.includes(id));
      const removed = oldStaff.filter(id => !staffIds.includes(id));
      ao.staff = staffIds;
      ao.responsibleStaffId = responsibleStaffId;
      if (ao.status === 'pool' && staffIds.length > 0) ao.status = 'planerad';
      const t = Date.now();
      if (added.length > 0)
        ao.log.push({ id: 'L'+t,   type: 'staff_added',       text: `${by} lade till: ${added.map(staffName).join(', ')}`,   userName: by, timestamp: new Date().toISOString() });
      if (removed.length > 0)
        ao.log.push({ id: 'L'+(t+1), type: 'staff_removed',   text: `${by} tog bort: ${removed.map(staffName).join(', ')}`, userName: by, timestamp: new Date().toISOString() });
      if (responsibleStaffId !== oldResp)
        ao.log.push({ id: 'L'+(t+2), type: 'staff_responsible', text: `${by} satte ansvarig: ${responsibleStaffId ? staffName(responsibleStaffId) : 'Ingen'}`, userName: by, timestamp: new Date().toISOString() });
    }

    ao.updatedAt = new Date().toISOString();
    ActivityService.log('work_order_updated', `Personal ändrad på ${ao.id}`, { workOrderId: aoId, customerId: ao.customerId });
    persist();
    Sidebar.updateBadges();
  },

  takeFromPool(aoId) {
    const ao   = getAO(aoId);
    const user = state.currentUser;
    if (!ao || ao.status !== 'pool' || !user) return null;
    if (!(ao.staff || []).includes(user.id)) {
      ao.staff = [...(ao.staff || []), user.id];
    }
    ao.status    = 'planerad';
    ao.updatedAt = new Date().toISOString();
    const staffName = `${user.firstName} ${user.lastName}`.trim();
    ao.log = ao.log || [];
    ao.log.push({
      id: 'L' + Date.now(), type: 'taken_from_pool',
      text: `${staffName} tog jobbet från arbetspoolen`,
      userName: staffName, timestamp: new Date().toISOString()
    });
    ActivityService.log('work_order_assigned',
      `${staffName} tog ${ao.id} från arbetspoolen`,
      { workOrderId: aoId, customerId: ao.customerId });
    persist();
    Sidebar.updateBadges();
    return ao;
  }
};
