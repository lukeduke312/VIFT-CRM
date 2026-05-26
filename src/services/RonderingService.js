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

  createFromMall(mallId, overrides) {
    const mall = getMall(mallId);
    if (!mall) return null;
    const results = (mall.categories || []).map(cat => ({
      categoryId: cat.id,
      categoryName: cat.name,
      points: (cat.points || []).map(pt => ({
        pointId: pt.id,
        pointTitle: pt.title,
        status: '',
        comment: '',
        deviationId: null,
        checkedAt: ''
      }))
    }));
    const ron = Object.assign(Schema.rondering(), {
      templateId: mall.id,
      templateName: mall.name,
      results,
      customerId: mall.customerId || '',
      propertyId: mall.propertyId || ''
    }, overrides, {
      id: newId(state.ronderingar, 'RON'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    state.ronderingar.push(ron);
    persist();
    return ron;
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
    ron.status = 'pågående';
    ron.startedAt = new Date().toISOString();
    ron.updatedAt = new Date().toISOString();
    persist();
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
    return ron;
  },

  /* ── Avvikelser ──────────────────────── */

  createAvvikelse(ronderingId, data) {
    const avv = Object.assign(Schema.avvikelse(), data, {
      id: newId(state.avvikelser, 'AVV'),
      ronderingId,
      createdBy: state.currentUser ? state.currentUser.id : '',
      createdByName: state.currentUser ? (state.currentUser.firstName + ' ' + state.currentUser.lastName).trim() : '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    state.avvikelser.push(avv);
    // Link to rondering
    const ron = getRon(ronderingId);
    if (ron) {
      ron.deviationIds = ron.deviationIds || [];
      ron.deviationIds.push(avv.id);
      // Mark point in results
      const cat = (ron.results || []).find(r => r.categoryId === data.categoryId);
      if (cat) {
        const pt = (cat.points || []).find(p => p.pointId === data.pointId);
        if (pt) {
          pt.deviationId = avv.id;
          pt.status = 'avvikelse';
          pt.checkedAt = pt.checkedAt || new Date().toISOString();
        }
      }
      ron.updatedAt = new Date().toISOString();
    }
    persist();
    return avv;
  },

  updateAvvikelse(id, data) {
    const avv = getAvv(id);
    if (!avv) return null;
    Object.assign(avv, data, { updatedAt: new Date().toISOString() });
    persist();
    return avv;
  },

  createAOFromAvvikelse(avvikelseId) {
    const avv = getAvv(avvikelseId);
    if (!avv) return null;
    const cu = getCu(avv.customerId);
    const prop = getObj(avv.propertyId);
    const address = prop ? prop.address : (cu ? cu.address : '');
    const title = 'Avvikelse rondering – ' + avv.pointTitle;
    const description = 'Vid rondering noterades avvikelse på kontrollpunkt: ' + avv.pointTitle + '.\n\nKommentar: ' + (avv.comment || '(ingen kommentar)');
    const notes = (avv.images || []).map(function(img) {
      return {
        id: 'n' + Date.now() + Math.random(),
        text: 'Bild från avvikelse',
        imageData: img.dataUrl,
        staffName: avv.createdByName,
        timestamp: avv.createdAt
      };
    });
    const ao = WorkOrderService.create({
      title,
      description,
      customerId: avv.customerId,
      propertyId: avv.propertyId,
      address,
      priority: avv.priority,
      notes,
      status: 'nytt'
    });
    // Link AO back to avvikelse
    avv.workOrderId = ao.id;
    avv.updatedAt = new Date().toISOString();
    persist();
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
  }
};
