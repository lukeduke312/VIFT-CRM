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

    // Link to PASS point if passId provided
    if (data.passId) {
      const pass = getPass(data.passId);
      if (pass) {
        const cat = (pass.categories||[]).find(c => c.id === data.categoryId);
        if (cat) {
          const pt = (cat.points||[]).find(p => p.id === data.pointId);
          if (pt) {
            pt.deviationId = avv.id;
            pt.status = pt.status || 'anmärkning';
            pt.checkedAt = pt.checkedAt || new Date().toISOString();
          }
        }
        pass.updatedAt = new Date().toISOString();
      }
    }

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

  createAOFromAvvikelse(avvikelseId, passId) {
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
    const ao = WorkOrderService.create({
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
    });
    // Link AO back to avvikelse
    avv.workOrderId = ao.id;
    avv.updatedAt = new Date().toISOString();
    // Link AO to PASS point
    if (pass) {
      const cat = (pass.categories||[]).find(c => c.id === avv.categoryId);
      if (cat) {
        const pt = (cat.points||[]).find(p => p.id === avv.pointId);
        if (pt) {
          pt.workOrderId = ao.id;
        }
      }
      pass.updatedAt = new Date().toISOString();
    }
    persist();
    ActivityService.log('ao_from_deviation', 'AO skapad från anmärkning: ' + avv.title, {
      customerId: avv.customerId, propertyId: avv.propertyId,
      ronderingId: avv.ronderingId, deviationId: avvikelseId, workOrderId: ao.id
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
  createPassFromRondering(ronderingId, options) {
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
    let total = 0;
    cats.forEach(function(cat) { total += (cat.points || []).length; });
    const pass = Object.assign(Schema.ronderingspass(), {
      id: newId(state.ronderingspass, 'PASS'),
      ronderingId: ron.id,
      mallId: ron.templateId || '',
      propertyId: opts.propertyId || ron.propertyId || '',
      customerId: opts.customerId || ron.customerId || '',
      sequenceNumber: this.getPassesByRondering(ronderingId).length + 1,
      scheduledDate: opts.scheduledDate || '',
      scheduledTime: opts.scheduledTime || '',
      staffIds: opts.staffIds || (ron.performedBy ? [ron.performedBy] : []),
      estimatedDurationMins: opts.estimatedDurationMins || 90,
      status: 'planerat',
      categories: cats,
      summary: { total: total, ok: 0, anmärkningar: 0, ejKontrollerad: 0, ejAktuell: 0 },
      internalNote: opts.internalNote || '',
      migratedFromLegacy: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    state.ronderingspass.push(pass);
    persist();
    return pass;
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

  updatePass(id, data) {
    const pass = getPass(id);
    if (!pass) return null;
    Object.assign(pass, data, { updatedAt: new Date().toISOString() });
    persist();
    return pass;
  },

  // Generate PASS objects from RON's occasions and recurringSetups (idempotent)
  generatePassesFromRecurring(ronId) {
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
    const total = cats.reduce(function(s, c) { return s + (c.points || []).length; }, 0);
    let seqBase = this.getPassesByRondering(ronId).length;
    let created = 0;
    const self = this;

    function addPass(date, time, staffIds, dur) {
      const p = Object.assign(Schema.ronderingspass(), {
        id: newId(state.ronderingspass, 'PASS'),
        ronderingId: ron.id, mallId: ron.templateId || '',
        propertyId: ron.propertyId || '', customerId: ron.customerId || '',
        sequenceNumber: ++seqBase,
        scheduledDate: date, scheduledTime: time || '',
        staffIds: staffIds || [], estimatedDurationMins: dur || 90,
        status: 'planerat',
        categories: JSON.parse(JSON.stringify(cats)),
        summary: { total: total, ok: 0, anmärkningar: 0, ejKontrollerad: 0, ejAktuell: 0 },
        internalNote: '', migratedFromLegacy: false,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      });
      state.ronderingspass.push(p);
      created++;
    }

    // Enstaka tillfällen
    (ron.occasions || []).forEach(function(occ) {
      if (!occ.date) return;
      const exists = state.ronderingspass.find(function(p) {
        return p.ronderingId === ronId && p.scheduledDate === occ.date && !p.migratedFromLegacy;
      });
      if (!exists) addPass(occ.date, occ.time, occ.staffId ? [occ.staffId] : [], occ.estimatedDuration);
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
        if (!exists) addPass(dateStr, rec.time, rec.staffId ? [rec.staffId] : [], rec.estimatedDuration);
      });
    });

    if (created > 0) persist();
    return created;
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
