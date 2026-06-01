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

  createAOFromAvvikelse(avvikelseId) {
    const avv = getAvv(avvikelseId);
    if (!avv) return null;
    if (avv.workOrderId) return getAO(avv.workOrderId); // already created
    const cu = getCu(avv.customerId);
    const prop = getObj(avv.propertyId);
    const ron = getRon(avv.ronderingId);
    const address = prop ? prop.address : (cu ? cu.address : '');
    const ronName = ron ? (ron.name || ron.templateName || avv.ronderingId) : avv.ronderingId;
    const title = 'Avvikelse rondering – ' + avv.pointTitle;
    const description = [
      'Rondering: ' + ronName,
      'Grupp: ' + (avv.categoryName || '—'),
      'Kontrollpunkt: ' + (avv.pointTitle || '—'),
      '',
      'Avvikelse: ' + avv.title,
      'Kommentar: ' + (avv.comment || '(ingen kommentar)')
    ].join('\n');
    const notes = (avv.images || []).map(function(img) {
      return {
        id: 'n' + Date.now() + Math.random(),
        text: 'Bild från avvikelse: ' + avv.title,
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
      status: 'nytt',
      ronderingId: avv.ronderingId,
      deviationId: avvikelseId
    });
    // Link AO back to avvikelse
    avv.workOrderId = ao.id;
    avv.updatedAt = new Date().toISOString();
    persist();
    ActivityService.log('ao_from_deviation', 'AO skapad från avvikelse: ' + avv.title, {
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
  }
};
