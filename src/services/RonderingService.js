/**
 * RonderingService — Mallar, ronderingar och avvikelser
 */
const RonderingService = {

  /* ── Mallar ──────────────────────────── */

  createMall(data) {
    const mall = Object.assign(Schema.ronderingsmall(), data, {
      id: newId(state.ronderingsmallar, 'MALL'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: state.currentUser ? state.currentUser.id : ''
    });
    state.ronderingsmallar.push(mall);
    persist();
    return mall;
  },

  updateMall(id, data) {
    const mall = getMall(id);
    if (!mall) return null;
    Object.assign(mall, data, { updatedAt: new Date().toISOString() });
    persist();
    return mall;
  },

  duplicateMall(id) {
    const src = getMall(id);
    if (!src) return null;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = newId(state.ronderingsmallar, 'MALL');
    copy.name = copy.name + ' (kopia)';
    copy.createdAt = new Date().toISOString();
    copy.updatedAt = new Date().toISOString();
    // Give new ids to categories and points
    copy.categories = copy.categories.map((cat, ci) => {
      cat = Object.assign({}, cat);
      cat.id = 'cat-' + Date.now() + '-' + ci;
      cat.points = (cat.points || []).map((pt, pi) => {
        pt = Object.assign({}, pt);
        pt.id = 'pt-' + Date.now() + '-' + ci + '-' + pi;
        return pt;
      });
      return cat;
    });
    state.ronderingsmallar.push(copy);
    persist();
    return copy;
  },

  /* ── Ronderingar ─────────────────────── */

  // Creates a rondering from wizard data (step 1-4)
  createRondering(data) {
    const categories = data.categories || [];
    // Build results skeleton from categories
    const results = categories.map(cat => ({
      categoryId: cat.id,
      categoryName: cat.name,
      points: (cat.points || []).map(pt => ({
        pointId: pt.id,
        pointTitle: pt.title,
        pointDesc: pt.description || '',
        canCreateAO: pt.canCreateAO !== false,
        status: '',
        comment: '',
        deviationId: null,
        checkedAt: ''
      }))
    }));
    const ron = Object.assign(Schema.rondering(), data, {
      id: newId(state.ronderingar, 'RON'),
      results: results,
      status: data.isDraft ? 'utkast' : 'planerad',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    state.ronderingar.push(ron);
    persist();
    ActivityService.log('rondering_created', 'Rondering skapad: ' + ron.name, {
      customerId: ron.customerId, propertyId: ron.propertyId, ronderingId: ron.id
    });
    return ron;
  },

  // Save a rondering's categories as a new template
  saveAsMall(ronderingId, mallName) {
    const ron = getRon(ronderingId);
    if (!ron) return null;
    return this.createMall({
      name: mallName,
      description: ron.description || '',
      categories: JSON.parse(JSON.stringify(ron.categories || [])),
      customerId: ron.customerId || '',
      interval: 'månadsvis',
      active: true
    });
  },

  // Load template categories into a rondering (overwrites categories)
  loadTemplateIntoRondering(ronderingId, mallId) {
    const ron = getRon(ronderingId);
    const mall = getMall(mallId);
    if (!ron || !mall) return null;
    const cats = JSON.parse(JSON.stringify(mall.categories || []));
    ron.categories = cats;
    ron.templateId = mall.id;
    ron.templateName = mall.name;
    ron.results = cats.map(cat => ({
      categoryId: cat.id,
      categoryName: cat.name,
      points: (cat.points || []).map(pt => ({
        pointId: pt.id, pointTitle: pt.title,
        pointDesc: pt.description || '', canCreateAO: pt.canCreateAO !== false,
        status: '', comment: '', deviationId: null, checkedAt: ''
      }))
    }));
    ron.updatedAt = new Date().toISOString();
    persist();
    return ron;
  },

  createFromMall(mallId, overrides) {
    const mall = getMall(mallId);
    if (!mall) return null;
    const cats = JSON.parse(JSON.stringify(mall.categories || []));
    return this.createRondering(Object.assign({
      templateId: mall.id,
      templateName: mall.name,
      name: mall.name,
      categories: cats,
      customerId: mall.customerId || '',
      propertyId: mall.propertyId || ''
    }, overrides));
  },

  updateRondering(id, data) {
    const ron = getRon(id);
    if (!ron) return null;
    Object.assign(ron, data, { updatedAt: new Date().toISOString() });
    persist();
    return ron;
  },

  startRondering(id) {
    const ron = getRon(id);
    if (!ron) return null;
    // Build results from categories if not already built
    if (!ron.results || ron.results.length === 0) {
      ron.results = (ron.categories || []).map(function(cat) {
        return {
          categoryId: cat.id,
          categoryName: cat.name,
          points: (cat.points || []).map(function(pt) {
            return {
              pointId: pt.id, pointTitle: pt.title,
              pointDesc: pt.description || '', canCreateAO: pt.canCreateAO !== false,
              status: '', comment: '', deviationId: null, checkedAt: ''
            };
          })
        };
      });
    }
    ron.status = 'pågående';
    ron.startedAt = new Date().toISOString();
    ron.updatedAt = new Date().toISOString();
    persist();
    ActivityService.log('rondering_started', 'Rondering startad: ' + ron.name, {
      customerId: ron.customerId, propertyId: ron.propertyId, ronderingId: ron.id
    });
    return ron;
  },

  setPointStatus(ronderingId, categoryId, pointId, status, comment) {
    const ron = getRon(ronderingId);
    if (!ron) return null;
    const cat = (ron.results || []).find(r => r.categoryId === categoryId);
    if (!cat) return null;
    const pt = (cat.points || []).find(p => p.pointId === pointId);
    if (!pt) return null;
    pt.status = status;
    pt.comment = comment || '';
    pt.checkedAt = new Date().toISOString();
    ron.updatedAt = new Date().toISOString();
    // Auto-start if still planerad
    if (ron.status === 'planerad') {
      ron.status = 'pågående';
      ron.startedAt = ron.startedAt || new Date().toISOString();
    }
    persist();
    if (status === 'ok') {
      ActivityService.log('point_ok', 'Kontrollpunkt godkänd: ' + pt.pointTitle, {
        customerId: ron.customerId, propertyId: ron.propertyId, ronderingId: ronderingId
      });
    } else if (status === 'ej_aktuell') {
      ActivityService.log('point_ej_aktuell', 'Kontrollpunkt ej aktuell: ' + pt.pointTitle, {
        customerId: ron.customerId, propertyId: ron.propertyId, ronderingId: ronderingId
      });
    }
    return ron;
  },

  completeRondering(id) {
    const ron = getRon(id);
    if (!ron) return null;
    const hasDevs = (ron.deviationIds || []).length > 0;
    ron.status = hasDevs ? 'har_avvikelser' : 'slutförd';
    ron.completedAt = new Date().toISOString();
    ron.updatedAt = new Date().toISOString();
    persist();
    ActivityService.log('rondering_completed', 'Rondering slutförd: ' + ron.name, {
      customerId: ron.customerId, propertyId: ron.propertyId, ronderingId: ron.id
    });
    return ron;
  },

  /* ── Avvikelser ──────────────────────── */

  createAvvikelse(ronderingId, data) {
    const avv = Object.assign(Schema.avvikelse(), data, {
      id: newId(state.avvikelser, 'AVV'),
      ronderingId,
      passId: data.passId || '',
      createdBy: state.currentUser ? state.currentUser.id : '',
      createdByName: state.currentUser ? (state.currentUser.firstName + ' ' + state.currentUser.lastName).trim() : '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    state.avvikelser.push(avv);

    // Link to rondering (legacy / keep in sync)
    const ron = getRon(ronderingId);
    if (ron) {
      ron.deviationIds = ron.deviationIds || [];
      if (!ron.deviationIds.includes(avv.id)) ron.deviationIds.push(avv.id);
      ron.updatedAt = new Date().toISOString();
    }

    /* P0 PART B (RONDERINGSPASS R1): den tidigare lokala mutationen av
       pass.categories[].points[].deviationId/status/checkedAt HÄR (följt
       av generisk persist()) är borttagen — vift_ronderingspass skrivs
       inte längre via den generiska vägen (se state.js _doPersist()).
       Länkningen mellan avvikelsen och checklistpunkten görs nu ALLTID
       av anroparen via RonderingSyncService.pointPatch(...,
       deviationId=avv.id) omedelbart efter detta anrop — se
       RonderingUtforandePage._saveAvv(), som är den ENDA anroparen av
       createAvvikelse() med passId satt (grep-verifierat). Om en framtida
       ny anropare behöver passId-länkning MÅSTE den själv anropa
       RonderingSyncService.pointPatch — annars tappas länken tyst. */

    persist();
    ActivityService.log('deviation_created', 'Avvikelse skapad: ' + avv.title, {
      customerId: avv.customerId, propertyId: avv.propertyId,
      ronderingId: ronderingId, deviationId: avv.id
    });
    return avv;
  },

  updateAvvikelse(id, data) {
    const avv = getAvv(id);
    if (!avv) return null;
    Object.assign(avv, data, { updatedAt: new Date().toISOString() });
    persist();
    return avv;
  },

  /* QA FIX-ROUND 2026-11-12 (K2, confirmed): no code path ever set a
     deviation to 'åtgärdad' — not even when its follow-up work order was
     completed — so AVV-001 stayed 'öppen' forever and kept counting as an
     open deviation on the dashboard, in reports and on the property card.
     Called by WorkOrderService once a status change of the linked AO is
     CONFIRMED by the server (never on the optimistic local change, which
     can still be rolled back):
       - AO confirmed 'klar'/'fakturerad' -> every 'öppen' deviation with
         workOrderId === aoId becomes 'åtgärdad' (resolvedAt/resolvedBy/
         resolvedByWorkOrderId recorded);
       - AO confirmed back to an active status -> a deviation that THIS
         mechanism resolved for that AO goes back to 'öppen'.
     A deviation resolved/written off by hand ('avskriven', or 'åtgärdad'
     without resolvedByWorkOrderId) is never touched. */
  syncAvvikelserWithWorkOrderStatus(aoId, status) {
    if (!aoId || !Array.isArray(state.avvikelser)) return 0;
    const done = status === 'klar' || status === 'fakturerad';
    const active = ['nytt', 'pool', 'planerad', 'pågående'].indexOf(status) !== -1;
    if (!done && !active) return 0;
    const now = new Date().toISOString();
    const by = state.currentUser ? `${state.currentUser.firstName || ''} ${state.currentUser.lastName || ''}`.trim() : '';
    let changed = 0;
    state.avvikelser.forEach(function(avv) {
      if (!avv || avv.workOrderId !== aoId) return;
      if (done && avv.status === 'öppen') {
        avv.status = 'åtgärdad';
        avv.resolvedAt = now;
        avv.resolvedBy = by;
        avv.resolvedByWorkOrderId = aoId;
        avv.updatedAt = now;
        changed++;
      } else if (active && avv.status === 'åtgärdad' && avv.resolvedByWorkOrderId === aoId) {
        avv.status = 'öppen';
        avv.resolvedAt = '';
        avv.resolvedBy = '';
        avv.resolvedByWorkOrderId = '';
        avv.updatedAt = now;
        changed++;
      }
    });
    if (changed > 0) {
      if (typeof ActivityService !== 'undefined') {
        try {
          ActivityService.log('deviation_status', (done ? changed + ' avvikelse(r) markerade åtgärdade' : changed + ' avvikelse(r) återöppnade') + ' via arbetsorder ' + aoId, { workOrderId: aoId });
        } catch (e) {}
      }
      persist();
    }
    return changed;
  },

  // P0 PART B (RONDERINGSPASS R1): async nu — se nedan, pt.workOrderId-
  // länkningen går via den atomiska rondering_point_patch-RPC:n istället
  // för en direkt lokal mutation + generisk persist() (som inte längre
  // skriver vift_ronderingspass alls — se state.js _doPersist()).
  async createAOFromAvvikelse(avvikelseId, passId) {
    const avv = getAvv(avvikelseId);
    if (!avv) return null;
    if (avv.workOrderId) return getAO(avv.workOrderId);
    const cu   = getCu(avv.customerId);
    const prop = getObj(avv.propertyId);
    const ron  = getRon(avv.ronderingId);
    const resolvedPassId = passId || avv.passId || '';
    const pass = resolvedPassId ? getPass(resolvedPassId) : null;
    const address = prop ? prop.address : (cu ? cu.address : '');
    const ronName = ron ? (ron.name||ron.templateName||avv.ronderingId) : avv.ronderingId;
    const passSeq = pass ? (' (tillfälle #' + (pass.sequenceNumber||1) + ')') : '';
    const title = 'Anmärkning rondering – ' + avv.pointTitle;
    const description = [
      'Rondering: ' + ronName + passSeq,
      'Grupp: ' + (avv.categoryName||'—'),
      'Kontrollpunkt: ' + (avv.pointTitle||'—'),
      '',
      'Anmärkning: ' + avv.title,
      'Kommentar: ' + (avv.comment||'(ingen kommentar)')
    ].join('\n');
    const notes = (avv.images||[]).map(function(img) {
      return {
        id: 'n' + Date.now() + Math.random(),
        text: 'Bild från anmärkning: ' + avv.title,
        imageData: img.dataUrl || img.url || '',
        staffName: avv.createdByName,
        timestamp: avv.createdAt
      };
    });
    /* R3-A FIX (independent-reviewer finding, round 4): `avv.workOrderId`
       (and the checklist-point link below it) used to be set
       SYNCHRONOUSLY right after `WorkOrderService.create()` returned
       its optimistic, not-yet-ACKed object — a dangling reference risk
       if the server later rejected the create (the deviation would
       permanently point at an AO id that never actually existed
       server-side), with an additional partial-success-chain risk if
       the point-linking RPC itself then also failed on top of that.
       Fix: wrap the ACK wait in a Promise so this already-`async`
       function can still simply `await` it (every caller already
       awaits `createAOFromAvvikelse()`, so this changes no call site's
       shape) — `avv.workOrderId`, the point link, `persist()`, and the
       ActivityService log entry all move inside the `onSettled`
       success branch; a definite rejection rejects the returned
       promise with a clear error instead of silently leaving a
       half-linked deviation. */
    /* B1 FIX (independent-reviewer finding, round 5): the actual link
       commit (avv.workOrderId, the checklist-point link, persist(), the
       ActivityService log) moved OUT of this in-memory `onSettled` and
       into the DURABLE 'rondering_ao_from_deviation' intent handler
       (registered once below, at file load) — same pattern as
       `PageShells.js`/`RecurringOrderService.js`'s matching fixes. The
       `avv.workOrderId` check at the top of this function already
       doubles as this handler's own idempotency guard (both check the
       same field). */
    const ao = await new Promise((resolve, reject) => {
      const created = WorkOrderService.create({
        title, description,
        customerId: avv.customerId,
        propertyId: avv.propertyId,
        address,
        priority: avv.priority,
        notes,
        status: 'nytt',
        ronderingId: avv.ronderingId,
        passId: resolvedPassId,
        deviationId: avvikelseId,
        category: 'felanmalan'
      }, {
        onSettledIntent: {
          kind: 'rondering_ao_from_deviation', refId: avvikelseId,
          passId: resolvedPassId, categoryId: avv.categoryId, pointId: avv.pointId
        },
        onSettled: (r) => {
          if (r.ok) {
            resolve(r.ao);
          } else if (r.final) {
            console.error('[RonderingService.createAOFromAvvikelse] AO-skapande avvisades av servern för anmärkning', avvikelseId, ':', r.error);
            reject(new Error(r.error || 'AO-skapande avvisades av servern'));
          }
          // else: transient — leaves this promise unsettled; the retry
          // (see AOTimeSyncService's _fireSettled fix) fires this same
          // callback again on real success or final rejection. A caller
          // awaiting this promise through a long transient stretch is
          // an accepted, pre-existing characteristic of every other
          // await-based caller in this codebase's outbox pattern, not a
          // new risk introduced here. The actual DURABLE commit (see
          // above) happens independently of whether this particular
          // promise is still being awaited by anyone.
        }
      });
      if (!created || created.ok === false) {
        // Synchronous, pre-network validation failure — nothing was
        // enqueued, so reject immediately instead of waiting for an
        // onSettled that will never fire.
        reject(new Error((created && created.error) || 'Arbetsordern kunde inte skapas'));
      }
    });
    return ao;
  },

  /* ── Statistik ───────────────────────── */

  getStats(ronderingId) {
    const ron = getRon(ronderingId);
    if (!ron) return null;
    let total = 0, ok = 0, avvs = 0, ejAktuell = 0;
    (ron.results || []).forEach(function(cat) {
      (cat.points || []).forEach(function(pt) {
        total++;
        if (pt.status === 'ok') ok++;
        else if (pt.status === 'avvikelse') avvs++;
        else if (pt.status === 'ej_aktuell') ejAktuell++;
      });
    });
    return { total: total, ok: ok, avvs: avvs, ejAktuell: ejAktuell, checked: ok + avvs + ejAktuell };
  },

  /* ── Ronderingstillfällen (PASS) ─────── */

  getPassesByRondering(ronderingId) {
    return state.ronderingspass.filter(p => p.ronderingId === ronderingId);
  },

  getPassesByProperty(propertyId) {
    return state.ronderingspass.filter(p => p.propertyId === propertyId);
  },

  // Creates a new PASS from a rondering's categories (deep copy, all points empty)
  // P0 PART B (RONDERINGSPASS R1): skapandet går nu via RonderingSyncService
  // (atomisk server-RPC, server-genererat id — se migrationens filhuvud för
  // varför den tidigare newId()-racen eliminerades). Funktionen är nu async;
  // ALLA tre callers (RonderingPage.js, RonderingUtforandePage.js) är
  // uppdaterade till att invänta den — se 02_diffs/.
  async createPassFromRondering(ronderingId, options) {
    const ron = getRon(ronderingId);
    if (!ron) return null;
    const opts = options || {};
    const cats = JSON.parse(JSON.stringify(ron.categories || [])).map(function(cat) {
      return {
        id: cat.id,
        name: cat.name,
        points: (cat.points || []).map(function(pt) {
          return {
            id: pt.id,
            title: pt.title,
            description: pt.description || '',
            canCreateAO: pt.canCreateAO !== false,
            requiresPhoto: !!pt.requiresPhoto,
            status: '',
            comment: '',
            images: [],
            workOrderId: null,
            checkedAt: null,
            checkedBy: null
          };
        })
      };
    });
    const passTemplate = {
      ronderingId: ron.id,
      mallId: ron.templateId || '',
      propertyId: opts.propertyId || ron.propertyId || '',
      customerId: opts.customerId || ron.customerId || '',
      scheduledDate: opts.scheduledDate || '',
      scheduledTime: opts.scheduledTime || '',
      staffIds: opts.staffIds || (ron.performedBy ? [ron.performedBy] : []),
      estimatedDurationMins: opts.estimatedDurationMins || 90,
      categories: cats,
      internalNote: opts.internalNote || '',
      migratedFromLegacy: false
    };
    const r = await RonderingSyncService.create(passTemplate);
    if (!r.ok) {
      if (typeof showToast === 'function') showToast('Kunde inte skapa ronderingspass: ' + r.error);
      return null;
    }
    return r.data.pass;
  },

  getPassStats(passId) {
    const pass = getPass(passId);
    if (!pass) return null;
    let total = 0, ok = 0, anmärkningar = 0, ejKontrollerad = 0, ejAktuell = 0;
    (pass.categories || []).forEach(function(cat) {
      (cat.points || []).forEach(function(pt) {
        total++;
        if (pt.status === 'ok') ok++;
        else if (pt.status === 'anmärkning') anmärkningar++;
        else if (pt.status === 'ej_kontrollerad') ejKontrollerad++;
        else if (pt.status === 'ej_aktuell') ejAktuell++;
      });
    });
    const checked = ok + anmärkningar + ejKontrollerad + ejAktuell;
    return { total, ok, anmärkningar, ejKontrollerad, ejAktuell, checked, unchecked: total - checked };
  },

  // P0 PART B (RONDERINGSPASS R1): generisk patch av passfält utöver
  // checklistpunkter/anteckning/slutförande (som nu har egna, narrow RPC:er
  // via RonderingSyncService — se _setPointStatus/_saveNote/complete i
  // RonderingUtforandePage.js). Denna funktion har f.n. INGA anropare i
  // kodbasen (grep-verifierat, se README §3) men behålls som ett
  // offentligt service-API — rutas därför ÄVEN den via den smala
  // rondering_pass_save_note-RPC:n om patchen bara rör internalNote
  // (det vanligaste tänkbara framtida användningsfallet), annars avvisas
  // anropet EXPLICIT hellre än att tyst falla tillbaka till en osäker
  // whole-array-skrivning — en framtida ny anropare måste medvetet lägga
  // till stöd i RonderingSyncService/Edge Function:en för sitt fält,
  // inte råka återintroducera bugklassen.
  async updatePass(id, data) {
    const pass = getPass(id);
    if (!pass) return null;
    const keys = Object.keys(data || {});
    if (keys.length === 1 && keys[0] === 'internalNote') {
      const r = await RonderingSyncService.saveNote(id, data.internalNote);
      if (!r.ok) { if (typeof showToast === 'function') showToast('Kunde inte spara: ' + r.error); return null; }
      return r.data.pass;
    }
    console.error('[RonderingService.updatePass] Avvisat: fält ' + JSON.stringify(keys) + ' har ingen atomisk RPC-väg ännu. Lägg till stöd i RonderingSyncService/rondering-pass-write istället för att återinföra whole-array persist().');
    return null;
  },

  // Generate PASS objects from RON's occasions and recurringSetups (idempotent)
  // P0 PART B (RONDERINGSPASS R1): skapandet går nu via
  // RonderingSyncService.bulkCreate(), som i sin tur anropar
  // rondering_passes_bulk_create() — SERVER-SIDIG dedupe mot
  // (ronderingId, scheduledDate, !migratedFromLegacy) under samma
  // radlås, så även en nätverksretry av HELA detta anrop (eller två
  // administratörer som samtidigt trycker "generera tillfällen") kan
  // aldrig skapa dubbletter. Funktionen är nu async.
  async generatePassesFromRecurring(ronId) {
    const ron = getRon(ronId);
    if (!ron) return 0;
    const today = tdy();
    const maxDate = new Date(new Date().getTime() + 366 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const cats = JSON.parse(JSON.stringify(ron.categories || [])).map(function(cat) {
      return {
        id: cat.id, name: cat.name,
        points: (cat.points || []).map(function(pt) {
          return { id: pt.id, title: pt.title, description: pt.description || '',
            canCreateAO: pt.canCreateAO !== false, requiresPhoto: !!pt.requiresPhoto,
            status: '', comment: '', images: [], workOrderId: null, checkedAt: null, checkedBy: null };
        })
      };
    });
    const self = this;
    const candidates = [];

    function addCandidate(date, time, staffIds, dur) {
      candidates.push({
        mallId: ron.templateId || '',
        propertyId: ron.propertyId || '', customerId: ron.customerId || '',
        scheduledDate: date, scheduledTime: time || '',
        staffIds: staffIds || [], estimatedDurationMins: dur || 90,
        categories: JSON.parse(JSON.stringify(cats)),
        internalNote: '', migratedFromLegacy: false
      });
    }

    // Enstaka tillfällen — klient-sidig förfiltrering (UX: undvik att
    // skicka uppenbart redan existerande datum), men den FAKTISKA,
    // dataförlust-kritiska dedupen sker server-sidigt i RPC:n oavsett.
    (ron.occasions || []).forEach(function(occ) {
      if (!occ.date) return;
      const exists = state.ronderingspass.find(function(p) {
        return p.ronderingId === ronId && p.scheduledDate === occ.date && !p.migratedFromLegacy;
      });
      if (!exists) addCandidate(occ.date, occ.time, occ.staffId ? [occ.staffId] : [], occ.estimatedDuration);
    });

    // Återkommande
    (ron.recurringSetups || []).forEach(function(rec) {
      if (!rec.startDate) return;
      const recEnd = rec.tillsvidare ? maxDate : (rec.endDate || maxDate);
      const end = recEnd < maxDate ? recEnd : maxDate;
      const dates = self._computeRecurringDates(rec, rec.startDate, end);
      dates.forEach(function(dateStr) {
        if (dateStr < today) return;
        const exists = state.ronderingspass.find(function(p) {
          return p.ronderingId === ronId && p.scheduledDate === dateStr && !p.migratedFromLegacy;
        });
        if (!exists) addCandidate(dateStr, rec.time, rec.staffId ? [rec.staffId] : [], rec.estimatedDuration);
      });
    });

    if (candidates.length === 0) return 0;
    const r = await RonderingSyncService.bulkCreate(ronId, candidates);
    if (!r.ok) {
      if (typeof showToast === 'function') showToast('Kunde inte generera tillfällen: ' + r.error);
      return 0;
    }
    return r.data.createdCount || 0;
  },

  _computeRecurringDates(rec, startDate, endDate) {
    const dates = [];
    const start = new Date(startDate + 'T00:00:00');
    const end   = new Date(endDate   + 'T23:59:59');
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return dates;
    const interval = rec.interval || 'månadsvis';
    let cur = new Date(start);

    if (interval === 'veckovis' || interval === 'varannan_vecka') {
      const target = parseInt(rec.weekday || '1', 10);
      let tries = 0;
      while (cur.getDay() !== target && tries++ < 7) cur.setDate(cur.getDate() + 1);
    } else if (interval === 'månadsvis') {
      const dom = Math.min(parseInt(rec.dayOfMonth || '1', 10), 28);
      cur.setDate(dom);
      if (cur < start) { cur.setMonth(cur.getMonth() + 1); cur.setDate(dom); }
    }

    const MAX = 104;
    while (cur <= end && dates.length < MAX) {
      dates.push(cur.toISOString().slice(0, 10));
      const prev = cur.getTime();
      if (interval === 'dagligen')        cur.setDate(cur.getDate() + 1);
      else if (interval === 'veckovis')   cur.setDate(cur.getDate() + 7);
      else if (interval === 'varannan_vecka') cur.setDate(cur.getDate() + 14);
      else if (interval === 'månadsvis')  { const d = Math.min(parseInt(rec.dayOfMonth||'1',10),28); cur.setMonth(cur.getMonth()+1); cur.setDate(d); }
      else if (interval === 'kvartalsvis') cur.setMonth(cur.getMonth() + 3);
      else if (interval === 'årsvis')     cur.setFullYear(cur.getFullYear() + 1);
      else                                cur.setDate(cur.getDate() + (rec.intervalDays || 14));
      if (cur.getTime() === prev) break;
    }
    return dates;
  }
};

/* B1 FIX (independent-reviewer finding, round 5): registers the DURABLE
   handler for the 'rondering_ao_from_deviation' settled intent — see
   AOTimeSyncService.js's header for the whole mechanism, and
   PageShells.js/RecurringOrderService.js for the matching fixes on the
   other two AO-creation flows. Idempotency: `avv.workOrderId` already
   being set to this exact `intent.aoId` is the guard (same field
   `createAOFromAvvikelse()`'s own top-of-function check reads). */
if (typeof AOTimeSyncService !== 'undefined' && typeof AOTimeSyncService.registerIntentHandler === 'function') {
  /* B1 FOLLOW-UP FIX (independent-reviewer finding, round 6): this
     handler used to (a) swallow a failed/thrown `pointPatch()` (just
     `console.error` and carry on) and (b) call `persist()` fire-and-
     forget, never checking its result — either failure used to still
     let `_tryApplyIntent()` treat the handler as "succeeded" (it threw
     nothing), durably pruning the intent even though nothing was
     actually saved. Both failures now PROPAGATE as an explicit
     `{ok:false}`, keeping the durable intent for retry.

     Idempotent on a retry: `avv.workOrderId === intent.aoId` guards
     against re-mutating/re-logging the deviation link a second time;
     `pt.workOrderId === intent.aoId` guards the point-link step
     SEPARATELY, since it is possible for the deviation link to have
     persisted successfully while the point-link step (or the
     persist() after it) failed, or vice versa — each half retries
     independently until BOTH are confirmed done, never re-doing a half
     that's already done. `pointPatch()` itself is also naturally
     idempotent (a PATCH setting the same field to the same value), so
     re-sending it even if it partially succeeded server-side last time
     is always safe. */
  AOTimeSyncService.registerIntentHandler('rondering_ao_from_deviation', async function (intent, settleResult) {
    const avv = getAvv(intent.refId);
    if (!avv) return { ok: true }; // deviation no longer exists -- nothing left to commit, not a failure to retry
    if (settleResult.ok) {
      const alreadyLinkedDeviation = avv.workOrderId === intent.aoId;
      if (!alreadyLinkedDeviation) {
        avv.workOrderId = intent.aoId;
        avv.updatedAt = new Date().toISOString();
      }
      if (intent.passId) {
        const pass = getPass(intent.passId);
        const cat  = pass && (pass.categories || []).find(c => c.id === intent.categoryId);
        const pt   = cat && (cat.points || []).find(p => p.id === intent.pointId);
        if (pt && pt.workOrderId !== intent.aoId) {
          let linkR;
          try {
            linkR = await RonderingSyncService.pointPatch(
              pass.id, intent.categoryId, intent.pointId, pt.status || 'anmärkning', pt.comment || '', pt.deviationId || null, intent.aoId
            );
          } catch (e) {
            console.error('[RonderingService] (reconciled) point-link kastade fel -- behåller intent för retry:', e);
            return { ok: false, error: 'point_link_threw' };
          }
          if (!linkR.ok) {
            console.error('[RonderingService] (reconciled) Kunde inte länka AO till checklistpunkt -- behåller intent för retry:', linkR.error);
            return { ok: false, error: 'point_link_failed' };
          }
        }
      }
      if (!alreadyLinkedDeviation) {
        ActivityService.log('ao_from_deviation', 'AO skapad från anmärkning: ' + avv.title, {
          customerId: avv.customerId, propertyId: avv.propertyId,
          ronderingId: avv.ronderingId, deviationId: intent.refId, workOrderId: intent.aoId,
          workOrderDisplayNumber: (typeof WorkOrderService !== 'undefined' ? WorkOrderService.displayNumberOrPending(getAO(intent.aoId) || { id: intent.aoId }) : intent.aoId)
        });
      }
      let persisted;
      try {
        /* C1 (2026-11-12): scoped to the key this code path mutated — an unrelated key's rejection (activityLog) is not this save's failure. */
        persisted = await persist({ keys: ['avvikelser'] });
      } catch (e) {
        console.error('[RonderingService] persist() threw while linking AO to deviation', intent.refId, ':', e);
        return { ok: false, error: 'persist_threw' };
      }
      if (!persisted) {
        console.error('[RonderingService] persist() reported failure while linking AO to deviation', intent.refId, '-- the durable intent is kept for retry, not pruned.');
        return { ok: false, error: 'persist_failed' };
      }
      if (typeof RonderingUtforandePage !== 'undefined' && typeof RonderingUtforandePage._refresh === 'function') {
        try { RonderingUtforandePage._refresh(); } catch (e) {}
      }
      return { ok: true };
    } else if (settleResult.final) {
      console.error('[RonderingService] AO-skapande avvisades slutgiltigt av servern för anmärkning', intent.refId, '(reconciled):', settleResult.error);
      return { ok: true };
    }
    return { ok: true };
  });
}
