/**
 * ServiceTemplateService — Offerttjänster & prismodeller
 * CRUD + calc-logic för serviceTemplates i state
 */
const ServiceTemplateService = {

  getAll() { return state.serviceTemplates || []; },
  getActive() { return this.getAll().filter(s => s.active !== false); },
  get(id) { return this.getAll().find(s => s.id === id) || null; },

  create(data) {
    if (!state.serviceTemplates) state.serviceTemplates = [];
    const id = data.id || ('svc_' + Date.now());
    const svc = Object.assign({
      id, name:'', icon:'zap', category:'', active:true,
      sortOrder: this.getAll().reduce((m,s)=>Math.max(m,s.sortOrder||0),0) + 10,
      unit:'st', vatRate:25, defaultReduction:'ingen',
      minChargeExVat:0, pricingModel:'fixed',
      qtyField:'qty', basePricePerUnit:0,
      tiers:[], factors:{}, options:[], fields:[],
      defaultDescription:'', includes:[], excludes:[],
      internalNote:'',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }, data, {id});
    state.serviceTemplates.push(svc);
    persist();
    return svc;
  },

  update(id, changes) {
    const svc = this.get(id);
    if (!svc) return null;
    Object.assign(svc, changes, {id, updatedAt: new Date().toISOString()});
    persist();
    return svc;
  },

  delete(id) {
    const idx = (state.serviceTemplates||[]).findIndex(s => s.id === id);
    if (idx !== -1) { state.serviceTemplates.splice(idx, 1); persist(); }
  },

  toggleActive(id) {
    const svc = this.get(id);
    if (!svc) return null;
    svc.active = svc.active === false ? true : false;
    svc.updatedAt = new Date().toISOString();
    persist();
    return svc;
  },

  duplicate(id) {
    const src = this.get(id);
    if (!src) return null;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = 'svc_' + Date.now();
    copy.name = src.name + ' (kopia)';
    copy.active = false;
    copy.sortOrder = (src.sortOrder || 10) + 5;
    copy.createdAt = new Date().toISOString();
    copy.updatedAt = new Date().toISOString();
    if (!state.serviceTemplates) state.serviceTemplates = [];
    state.serviceTemplates.push(copy);
    persist();
    return copy;
  },

  // Build OffersPage._T-compatible template from stored data
  buildWizardTemplate(svc) {
    return {
      id:               svc.id,
      name:             svc.name,
      icon:             svc.icon || 'zap',
      vatRate:          svc.vatRate || 25,
      defaultReduction: svc.defaultReduction || 'ingen',
      defaultDesc:      svc.defaultDescription || svc.name,
      fields:           (svc.fields || []).filter(f => !f.isRut && !f.isRot),
      calc:             this._buildCalcFn(svc)
    };
  },

  buildAllWizardTemplates() {
    return this.getActive()
      .slice().sort((a,b) => (a.sortOrder||0) - (b.sortOrder||0))
      .map(svc => this.buildWizardTemplate(svc));
  },

  _buildCalcFn(svc) {
    return function(f) {
      const vatRate   = svc.vatRate || 25;
      const minCharge = svc.minChargeExVat || 0;
      const qtyField  = svc.qtyField || 'area';
      const qty       = parseFloat(f[qtyField] || 0);
      const ls = [];
      let pricePerUnit = 0;
      let tierLbl = '';

      if (svc.pricingModel === 'tiered_unit') {
        const tiers4fn = (svc.tiers||[]).map(t => ({max: t.to === null ? Infinity : t.to, pricePerM2: t.priceExVat}));
        pricePerUnit = _offTierPrice(qty, tiers4fn);
        tierLbl      = _offTierLabel(qty, tiers4fn);
        const baseAmt = qty * pricePerUnit;
        if (qty > 0 && baseAmt < minCharge) {
          ls.push({desc:`${svc.name} ${qty} ${svc.unit} (minimidebitering)`, qty:1, unit:'st', price:minCharge});
        } else {
          ls.push({desc:`${svc.name} ${qty} ${svc.unit}`, qty, unit:svc.unit, price:pricePerUnit});
        }

      } else if (svc.pricingModel === 'factor_unit' || svc.pricingModel === 'factor_lm') {
        let multiplier = 1;
        Object.entries(svc.factors || {}).forEach(([fId, fMap]) => {
          const val = f[fId];
          if (val !== undefined && fMap[val] !== undefined) multiplier *= fMap[val];
        });
        pricePerUnit = Math.round((svc.basePricePerUnit || 0) * multiplier);
        tierLbl = `${qty} ${svc.unit} × ${pricePerUnit} kr/${svc.unit}`;
        const baseAmt = qty * pricePerUnit;
        if (qty > 0 && baseAmt < minCharge) {
          ls.push({desc:`${svc.name} ${qty} ${svc.unit} (minimidebitering)`, qty:1, unit:'st', price:minCharge});
        } else {
          ls.push({desc:`${svc.name} ${qty} ${svc.unit}`, qty, unit:svc.unit, price:pricePerUnit});
        }

      } else if (svc.pricingModel === 'hourly') {
        const hrs  = parseFloat(f.hours || f.qty || 0);
        const per  = parseInt(f.periods || 1) || 1;
        const pgId = f.priceGroupId || svc.defaultPriceGroupId;
        const pg   = pgId ? (state.priceGroups||[]).find(p=>p.id===pgId) : null;
        const rate = parseFloat(f.rate) || (pg && pg.hourRate) || svc.basePricePerUnit || 430;
        const mat  = parseFloat(f.material || 0);
        const type = f.type || '';
        const typeStr = type ? ` – ${type}` : '';
        const perStr  = per > 1 ? ` × ${per} ggr` : '';
        ls.push({desc:`${svc.name}${typeStr}${perStr} (${hrs} tim/period)`, qty:hrs*per, unit:'tim', price:rate});
        if (mat) ls.push({desc:'Material och förbrukningsmaterial', qty:1, unit:'st', price:mat});
        pricePerUnit = rate;

      } else if (svc.pricingModel === 'monthly') {
        const months  = parseInt(f.months || f[qtyField] || 12) || 12;
        const monthly = parseFloat(f.monthly || 0);
        const setup   = parseFloat(f.setup || 0);
        ls.push({desc:`${svc.name} (${months} månader)`, qty:months, unit:'mån', price:monthly});
        if (setup) ls.push({desc:'Uppstart och fastighetsgenomgång', qty:1, unit:'st', price:setup});
        pricePerUnit = monthly;

      } else if (svc.pricingModel === 'hourly_custom') {
        const pgId = f.priceGroupId || svc.defaultPriceGroupId;
        const pg   = pgId ? (state.priceGroups||[]).find(p=>p.id===pgId) : null;
        const rate = parseFloat(f.rate) || (pg && pg.hourRate) || svc.basePricePerUnit || 430;
        const hrs  = parseFloat(f[qtyField] || f.qty || 0);
        const mat  = parseFloat(f.material || 0);
        ls.push({desc: f.desc_svc || svc.name, qty:hrs, unit:'tim', price:rate});
        if (mat) ls.push({desc:'Material', qty:1, unit:'st', price:mat});
        pricePerUnit = rate;

      } else {
        // fixed / fallback
        const price = parseFloat(f.price || f.fixedPrice || svc.basePricePerUnit || 0);
        ls.push({desc:svc.name, qty:1, unit:'fast pris', price});
        pricePerUnit = price;
      }

      // Apply options/addons
      (svc.options || []).forEach(opt => {
        if (!f[opt.id]) return;
        if (opt.type === 'per_unit') {
          ls.push({desc:opt.name, qty, unit:svc.unit, price:opt.priceExVat});
        } else {
          ls.push({desc:opt.name, qty:1, unit:'st', price:opt.priceExVat});
        }
      });

      const exVat = Math.round(ls.reduce((s,l)=>s+l.qty*l.price, 0));
      const totalIncVat = exVat + Math.round(exVat * vatRate / 100);
      const rutAmt = f.rut ? Math.round(totalIncVat * 0.5) :
                     f.rot ? Math.round(totalIncVat * 0.3) : 0;

      return {ls, exVat, rutAmt, tierLbl, pricePerM2:pricePerUnit, inputValues:{...f}, priceRuleRef:svc.id};
    };
  },

  getPriceGroups() { return state.priceGroups || []; },
  getPriceProfiles() { return state.priceProfiles || []; },

  modelLabel(m) {
    return {
      tiered_unit:  'Prisstegar (per enhet)',
      factor_unit:  'Faktorbaserat (per m²)',
      factor_lm:    'Faktorbaserat (per lm)',
      hourly:       'Timpris',
      monthly:      'Månadsavgift',
      hourly_custom:'Löpande räkning',
      fixed:        'Fastpris'
    }[m] || m;
  },

  reductionLabel(r) {
    return {ingen:'Ingen', rut:'RUT 50%', rot:'ROT 30%'}[r] || r;
  }
};
