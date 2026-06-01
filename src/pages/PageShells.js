/**
 * PageShells — Placeholder-rendering för sidor som byggs i Fas 3+
 * Fas 2-sidor (Kunder, AO, Tid, Faktura) har egna filer.
 */

/* ── Offerter (v2 – tjänstemallar + kalkylator) ─────── */

/* ── PART 1: OfferPriceRules — alla priser EXKLUSIVE MOMS ─── */
const OfferPriceRules = {
  altan: {
    tiers: [
      {max:30,  pricePerM2:95},
      {max:60,  pricePerM2:85},
      {max:100, pricePerM2:75},
      {max:150, pricePerM2:70},
      {max:Infinity, pricePerM2:65}
    ],
    minCharge: 1500,
    addons: {
      algae:     {label:'Algbehandling',        price:15,  unit:'m²'},
      stairs:    {label:'Trappsteg tillägg',    price:450, unit:'st'},
      treatment: {label:'Impregnering/efterbehandling', price:18, unit:'m²'},
      disposal:  {label:'Bortforsling',         price:750, unit:'st'}
    },
    vatRate: 25,
    rutApplicable: true,
    rutRate: 0.5
  },
  sten: {
    tiers: [
      {max:30,  pricePerM2:85},
      {max:60,  pricePerM2:72},
      {max:100, pricePerM2:62},
      {max:150, pricePerM2:55},
      {max:Infinity, pricePerM2:48}
    ],
    minCharge: 1500,
    addons: {
      weeds:        {label:'Ogräs- och algbehandling', price:12, unit:'m²'},
      jointing:     {label:'Fogsandning',              price:25, unit:'m²'},
      impregnation: {label:'Impregnering',             price:22, unit:'m²'},
      disposal:     {label:'Bortforsling',             price:600, unit:'st'}
    },
    vatRate: 25,
    rotApplicable: true,
    rotRate: 0.3
  },
  hack: {
    basePricePerLm: 55,
    heightFactors: {'≤ 1 m':1.0,'1–2 m':1.35,'2–3 m':1.75,'> 3 m':2.2},
    sideFactors:   {'1 sida':1.0,'2 sidor':1.8,'3 sidor':2.5},
    diffFactors:   {'Normal':1.0,'Svår (tät/gammal)':1.3},
    minCharge: 1200,
    addons: {
      disposal: {label:'Bortforsling klippt material', price:650, unit:'st'}
    },
    vatRate: 25,
    rutApplicable: true,
    rutRate: 0.5
  },
  fasad: {
    basePricePerM2: 60,
    floorFactors: {'1 vån':1.0,'2 vån':1.25,'3 vån':1.55,'4+ vån':1.85},
    minCharge: 2000,
    addons: {
      algae:    {label:'Algbehandling',       price:15,   unit:'m²'},
      softwash: {label:'Softwash-behandling', price:18,   unit:'m²'},
      lift:     {label:'Lift / ställning',    price:4500, unit:'st'},
      disposal: {label:'Bortforsling',        price:600,  unit:'st'}
    },
    vatRate: 25,
    rotApplicable: true,
    rotRate: 0.3
  }
};

/* ── PART 2: Helper functions ─── */
function _offTierPrice(area, tiers) {
  for (let i = 0; i < tiers.length; i++) {
    if (area <= tiers[i].max) return tiers[i].pricePerM2;
  }
  return tiers[tiers.length - 1].pricePerM2;
}

function _offTierLabel(area, tiers) {
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    const prev = i === 0 ? 0 : tiers[i-1].max;
    if (area <= t.max) {
      const fromLbl = prev === 0 ? '0' : (prev + 1);
      const toLbl   = t.max === Infinity ? '∞' : t.max;
      return fromLbl + '–' + toLbl + ' m²: ' + t.pricePerM2 + ' kr/m²';
    }
  }
  return '';
}


/* ── PART 3: OffersPage (v4 – steg-wizard + tjänstoverlay) ─── */
const OffersPage = {
  _editLines:    [],
  _editExtras:   [],
  _editOfferId:  null,
  _wizardStep:   1,
  _wizardData:   {},
  _activeSvcId:  null,
  _svcFields:    {},
  _svcEditIdx:   null,
  _svcReduction: 'ingen',   // 'ingen' | 'rut' | 'rot' — unified state, injected into calc
  _filter:       'alla',
  _search:       '',

  /* ── Tjänstemallar ─── */
  _T: [
    {
      id:'altan', name:'Altantvätt', icon:'refresh-cw', vatRate:25, defaultReduction:'rut',
      defaultDesc:'Altantvätt inkl. rengöring, avfettning och behandling.',
      fields:[
        {id:'area',      label:'Yta (m²)',       type:'number', req:true},
        {id:'material',  label:'Material/typ',   type:'chips',  opts:['Trä / Komposit','Betong','Natursten','Tegel','Annat'], def:'Trä / Komposit'},
        {id:'dirt',      label:'Smutsnivå',      type:'chips',  opts:['Lätt','Måttlig','Kraftig'], def:'Måttlig'},
        {id:'algae',     label:'Algbehandling',  type:'bool',   addLabel:'Algbehandling (+15 kr/m²)'},
        {id:'stairs',    label:'Trappsteg',      type:'bool',   addLabel:'Trappsteg (+450 kr/st)'},
        {id:'treatment', label:'Efterbehandling',type:'bool',   addLabel:'Impregnering (+18 kr/m²)'},
        {id:'disposal',  label:'Bortforsling',   type:'bool',   addLabel:'Bortforsling (+750 kr)'},
        {id:'rut',       label:'RUT-avdrag 50 %',type:'bool',   isRut:true},
      ],
      calc(f){
        const rules = OfferPriceRules.altan;
        const a = parseFloat(f.area) || 0;
        const pricePerM2 = _offTierPrice(a, rules.tiers);
        const tierLbl    = _offTierLabel(a, rules.tiers);
        let base = a * pricePerM2;
        if (a > 0 && base < rules.minCharge) base = rules.minCharge;
        const ls = [{desc:'Altantvätt ' + a + ' m² (' + (f.dirt||'Måttlig') + ')', qty:a, unit:'m²', price:pricePerM2}];
        if (a > 0 && a * pricePerM2 < rules.minCharge) {
          ls[0] = {desc:'Altantvätt ' + a + ' m² (minimidebitering)', qty:1, unit:'st', price:rules.minCharge};
        }
        if (f.algae)     ls.push({desc:rules.addons.algae.label,     qty:a, unit:'m²', price:rules.addons.algae.price});
        if (f.stairs)    ls.push({desc:rules.addons.stairs.label,    qty:1, unit:'st', price:rules.addons.stairs.price});
        if (f.treatment) ls.push({desc:rules.addons.treatment.label, qty:a, unit:'m²', price:rules.addons.treatment.price});
        if (f.disposal)  ls.push({desc:rules.addons.disposal.label,  qty:1, unit:'st', price:rules.addons.disposal.price});
        const exVat = Math.round(ls.reduce((s,l)=>s+l.qty*l.price,0));
        const totalIncVat = exVat + Math.round(exVat * rules.vatRate / 100);
        const rutAmt = f.rut ? Math.round(totalIncVat * rules.rutRate) : 0;
        return {ls, exVat, rutAmt, tierLbl, pricePerM2, inputValues:{...f}, priceRuleRef:'altan'};
      }
    },
    {
      id:'sten', name:'Stentvätt', icon:'layers', vatRate:25, defaultReduction:'rot',
      defaultDesc:'Högtryckstvätt av stenläggning, plattor och markytor.',
      fields:[
        {id:'area',         label:'Yta (m²)',    type:'number', req:true},
        {id:'material',     label:'Stentyp',     type:'chips',  opts:['Betongplattor','Natursten','Klinker','Asfalt','Annat'], def:'Betongplattor'},
        {id:'dirt',         label:'Smutsnivå',   type:'chips',  opts:['Lätt','Måttlig','Kraftig'], def:'Måttlig'},
        {id:'weeds',        label:'Ogräs/alger', type:'bool',   addLabel:'Ogräs- och algbehandling (+12 kr/m²)'},
        {id:'jointing',     label:'Fogsandning', type:'bool',   addLabel:'Fogsandning (+25 kr/m²)'},
        {id:'impregnation', label:'Impregnering',type:'bool',   addLabel:'Impregnering (+22 kr/m²)'},
        {id:'disposal',     label:'Bortforsling',type:'bool',   addLabel:'Bortforsling (+600 kr)'},
        {id:'rot',          label:'ROT-avdrag 30 %', type:'bool', isRot:true},
      ],
      calc(f){
        const rules = OfferPriceRules.sten;
        const a = parseFloat(f.area) || 0;
        const pricePerM2 = _offTierPrice(a, rules.tiers);
        const tierLbl    = _offTierLabel(a, rules.tiers);
        let base = a * pricePerM2;
        const ls = [{desc:'Stentvätt ' + a + ' m² (' + (f.dirt||'Måttlig') + ')', qty:a, unit:'m²', price:pricePerM2}];
        if (a > 0 && base < rules.minCharge) {
          ls[0] = {desc:'Stentvätt ' + a + ' m² (minimidebitering)', qty:1, unit:'st', price:rules.minCharge};
        }
        if (f.weeds)        ls.push({desc:rules.addons.weeds.label,       qty:a, unit:'m²', price:rules.addons.weeds.price});
        if (f.jointing)     ls.push({desc:rules.addons.jointing.label,    qty:a, unit:'m²', price:rules.addons.jointing.price});
        if (f.impregnation) ls.push({desc:rules.addons.impregnation.label,qty:a, unit:'m²', price:rules.addons.impregnation.price});
        if (f.disposal)     ls.push({desc:rules.addons.disposal.label,    qty:1, unit:'st', price:rules.addons.disposal.price});
        const exVat = Math.round(ls.reduce((s,l)=>s+l.qty*l.price,0));
        const totalIncVat = exVat + Math.round(exVat * rules.vatRate / 100);
        const rutAmt = f.rot ? Math.round(totalIncVat * rules.rotRate) : 0;
        return {ls, exVat, rutAmt, tierLbl, pricePerM2, inputValues:{...f}, priceRuleRef:'sten'};
      }
    },
    {
      id:'hack', name:'Häckklippning', icon:'scissors', vatRate:25, defaultReduction:'rut',
      defaultDesc:'Klippning av häck inkl. uppsamling av klippt material.',
      fields:[
        {id:'length',     label:'Löpmeter häck',   type:'number', req:true},
        {id:'height',     label:'Höjd',            type:'chips',  opts:['≤ 1 m','1–2 m','2–3 m','> 3 m'], def:'1–2 m'},
        {id:'sides',      label:'Antal sidor',     type:'chips',  opts:['1 sida','2 sidor','3 sidor'], def:'2 sidor'},
        {id:'difficulty', label:'Svårighet',       type:'chips',  opts:['Normal','Svår (tät/gammal)'], def:'Normal'},
        {id:'disposal',   label:'Bortforsling',    type:'bool',   addLabel:'Bortforsling (+650 kr)'},
        {id:'rut',        label:'RUT-avdrag 50 %', type:'bool',   isRut:true},
      ],
      calc(f){
        const rules = OfferPriceRules.hack;
        const lm  = parseFloat(f.length) || 0;
        const hf  = rules.heightFactors[f.height||'1–2 m'] || 1.35;
        const sf  = rules.sideFactors[f.sides||'2 sidor']  || 1.8;
        const df  = rules.diffFactors[f.difficulty||'Normal'] || 1.0;
        const prLm = Math.round(rules.basePricePerLm * hf * sf * df);
        let base = lm * prLm;
        const ls = [{desc:'Häckklippning ' + lm + ' lm (' + (f.height||'1–2 m') + ', ' + (f.sides||'2 sidor') + (f.difficulty&&f.difficulty!=='Normal'?', Svår':'') + ')', qty:lm, unit:'lm', price:prLm}];
        if (lm > 0 && base < rules.minCharge) {
          ls[0] = {desc:'Häckklippning ' + lm + ' lm (minimidebitering)', qty:1, unit:'st', price:rules.minCharge};
        }
        if (f.disposal) ls.push({desc:rules.addons.disposal.label, qty:1, unit:'st', price:rules.addons.disposal.price});
        const exVat = Math.round(ls.reduce((s,l)=>s+l.qty*l.price,0));
        const totalIncVat = exVat + Math.round(exVat * rules.vatRate / 100);
        const rutAmt = f.rut ? Math.round(totalIncVat * rules.rutRate) : 0;
        const tierLbl = lm + ' lm × ' + prLm + ' kr/lm';
        return {ls, exVat, rutAmt, tierLbl, pricePerM2:prLm, inputValues:{...f}, priceRuleRef:'hack'};
      }
    },
    {
      id:'fasad', name:'Fasadtvätt', icon:'building-2', vatRate:25, defaultReduction:'rot',
      defaultDesc:'Fasadtvätt inkl. förberedelse, tvätt och skyddsåtgärder.',
      fields:[
        {id:'area',     label:'Fasadyta (m²)',  type:'number', req:true},
        {id:'floors',   label:'Antal våningar', type:'chips',  opts:['1 vån','2 vån','3 vån','4+ vån'], def:'2 vån'},
        {id:'material', label:'Fasadmaterial',  type:'chips',  opts:['Puts / Betong','Tegel','Träpanel','Plåt','Annat'], def:'Puts / Betong'},
        {id:'algae',    label:'Algbehandling',  type:'bool',   addLabel:'Algbehandling (+15 kr/m²)'},
        {id:'softwash', label:'Softwash',       type:'bool',   addLabel:'Softwash-behandling (+18 kr/m²)'},
        {id:'lift',     label:'Lift/ställning', type:'bool',   addLabel:'Lift / ställning (+4 500 kr)'},
        {id:'disposal', label:'Bortforsling',   type:'bool',   addLabel:'Bortforsling (+600 kr)'},
        {id:'rot',      label:'ROT-avdrag 30 %',type:'bool',   isRot:true},
      ],
      calc(f){
        const rules = OfferPriceRules.fasad;
        const a  = parseFloat(f.area) || 0;
        const ff = rules.floorFactors[f.floors||'2 vån'] || 1.25;
        const pricePerM2 = Math.round(rules.basePricePerM2 * ff);
        let base = a * pricePerM2;
        const ls = [{desc:'Fasadtvätt ' + a + ' m² (' + (f.floors||'2 vån') + ')', qty:a, unit:'m²', price:pricePerM2}];
        if (a > 0 && base < rules.minCharge) {
          ls[0] = {desc:'Fasadtvätt ' + a + ' m² (minimidebitering)', qty:1, unit:'st', price:rules.minCharge};
        }
        if (f.algae)    ls.push({desc:rules.addons.algae.label,    qty:a, unit:'m²', price:rules.addons.algae.price});
        if (f.softwash) ls.push({desc:rules.addons.softwash.label, qty:a, unit:'m²', price:rules.addons.softwash.price});
        if (f.lift)     ls.push({desc:rules.addons.lift.label,     qty:1, unit:'st', price:rules.addons.lift.price});
        if (f.disposal) ls.push({desc:rules.addons.disposal.label, qty:1, unit:'st', price:rules.addons.disposal.price});
        const exVat = Math.round(ls.reduce((s,l)=>s+l.qty*l.price,0));
        const totalIncVat = exVat + Math.round(exVat * rules.vatRate / 100);
        const rutAmt = f.rot ? Math.round(totalIncVat * rules.rotRate) : 0;
        const tierLbl = (f.floors||'2 vån') + ': ' + pricePerM2 + ' kr/m²';
        return {ls, exVat, rutAmt, tierLbl, pricePerM2, inputValues:{...f}, priceRuleRef:'fasad'};
      }
    },
    {
      id:'fs', name:'Fastighetsservice', icon:'wrench', vatRate:25,
      defaultDesc:'Fastighetsservice och skötsel enligt överenskommelse.',
      fields:[
        {id:'type',     label:'Avtalstyp',              type:'chips',  opts:['Månadsavtal','Kvartal','Engångsuppdrag'], def:'Engångsuppdrag'},
        {id:'hours',    label:'Timmar per period',      type:'number', req:true},
        {id:'periods',  label:'Antal perioder',         type:'number', def:1},
        {id:'rate',     label:'Timpris ex moms (kr/h)', type:'number', def:695},
        {id:'material', label:'Material (kr)',          type:'number'},
        {id:'rot',      label:'ROT-avdrag 30 %',        type:'bool',   isRot:true},
      ],
      calc(f){
        const hrs  = parseFloat(f.hours)    || 0;
        const per  = parseInt(f.periods)    || 1;
        const rate = parseFloat(f.rate)     || 695;
        const type = f.type                 || 'Engångsuppdrag';
        const mat  = parseFloat(f.material) || 0;
        const ls = [{desc:'Fastighetsservice – ' + type + (per>1?' × '+per+' ggr':'') + ' (' + hrs + ' tim/period)', qty:hrs*per, unit:'tim', price:rate}];
        if (mat) ls.push({desc:'Material och förbrukningsmaterial', qty:1, unit:'st', price:mat});
        const exVat = Math.round(ls.reduce((s,l)=>s+l.qty*l.price,0));
        const totalIncVat = exVat + Math.round(exVat * 0.25);
        const rutAmt = f.rut ? Math.round(totalIncVat * 0.5) : f.rot ? Math.round(totalIncVat * 0.3) : 0;
        return {ls, exVat, rutAmt, tierLbl:'', pricePerM2:rate, inputValues:{...f}, priceRuleRef:'fs'};
      }
    },
    {
      id:'tf', name:'Teknisk förvaltning', icon:'settings', vatRate:25,
      defaultDesc:'Teknisk förvaltning av fastighet enligt förvaltningsavtal.',
      fields:[
        {id:'months',  label:'Antal månader',         type:'number', req:true, def:12},
        {id:'monthly', label:'Månadsavgift ex moms',  type:'number', req:true},
        {id:'setup',   label:'Uppstartskostnad (kr)',  type:'number'},
        {id:'ovk',     label:'OVK-besiktning ingår',  type:'bool',   addLabel:'OVK inkl. protokoll (+3 500 kr)'},
      ],
      calc(f){
        const months  = parseInt(f.months)         || 12;
        const monthly = parseFloat(f.monthly)      || 0;
        const setup   = parseFloat(f.setup)        || 0;
        const ls = [{desc:'Teknisk förvaltning (' + months + ' månader)', qty:months, unit:'mån', price:monthly}];
        if (setup) ls.push({desc:'Uppstart och fastighetsgenomgång', qty:1, unit:'st', price:setup});
        if (f.ovk)  ls.push({desc:'OVK-besiktning inkl. protokoll',  qty:1, unit:'st', price:3500});
        const exVat = Math.round(ls.reduce((s,l)=>s+l.qty*l.price,0));
        return {ls, exVat, rutAmt:0, tierLbl:'', pricePerM2:monthly, inputValues:{...f}, priceRuleRef:'tf'};
      }
    },
    {
      id:'ovr', name:'Övrigt arbete', icon:'activity', vatRate:25,
      defaultDesc:'Arbete på löpande räkning.',
      fields:[
        {id:'desc_svc', label:'Benämning',                type:'text',   req:true},
        {id:'qty',      label:'Antal timmar',             type:'number', req:true},
        {id:'rate',     label:'Timpris ex moms (kr/h)',   type:'number', def:695},
        {id:'material', label:'Material (kr)',            type:'number'},
        {id:'rut',      label:'RUT-avdrag 50 %',          type:'bool',   isRut:true},
        {id:'rot',      label:'ROT-avdrag 30 %',          type:'bool',   isRot:true},
      ],
      calc(f){
        const rate = parseFloat(f.rate)     || 695;
        const qty  = parseFloat(f.qty)      || 0;
        const mat  = parseFloat(f.material) || 0;
        const ls   = [{desc:f.desc_svc||'Arbete', qty, unit:'tim', price:rate}];
        if (mat) ls.push({desc:'Material', qty:1, unit:'st', price:mat});
        const exVat = Math.round(ls.reduce((s,l)=>s+l.qty*l.price,0));
        const totalIncVat = exVat + Math.round(exVat * 0.25);
        const rutAmt = f.rut ? Math.round(totalIncVat * 0.5) : f.rot ? Math.round(totalIncVat * 0.3) : 0;
        return {ls, exVat, rutAmt, tierLbl:'', pricePerM2:rate, inputValues:{...f}, priceRuleRef:'ovr'};
      }
    },
  ],

  _TERMS: {
    payment:  '30 dagar netto',
    validity: '30 dagar',
    general:  'Priser anges exklusive moms om inget annat anges. Eventuella tillkommande arbeten debiteras enligt löpande räkning efter godkännande. VIFT reserverar sig för dolda fel och förutsättningar som ej kunnat bedömas vid offerttillfället.'
  },

  /* ── Offertlista ─── */
  render() {
    const el = document.getElementById('pg-offer-content');
    if (!el) return;
    const all = (state.offers || []).slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // KPI — always over all offers, unaffected by filter/search
    const kpi = {utkast:0, skickad:0, godkänd:0, nekad:0, total:0};
    let totalGodkändVal = 0;
    all.forEach(o => {
      if (kpi[o.status] !== undefined) kpi[o.status]++;
      kpi.total++;
      if (o.status === 'godkänd') totalGodkändVal += OffersPage._offerExVat(o);
    });

    // Render static shell (KPI + toolbar + tabs container + results container).
    // The search input is part of the shell and is NOT re-rendered on keystroke.
    el.innerHTML =
      `<div class="off-kpi-row">
         <div class="off-kpi-card"><div class="off-kpi-val">${kpi.utkast}</div><div class="off-kpi-lbl">Utkast</div></div>
         <div class="off-kpi-card"><div class="off-kpi-val">${kpi.skickad}</div><div class="off-kpi-lbl">Skickade</div></div>
         <div class="off-kpi-card off-kpi-card--green"><div class="off-kpi-val">${kpi.godkänd}</div><div class="off-kpi-lbl">Godkända</div></div>
         <div class="off-kpi-card off-kpi-card--navy"><div class="off-kpi-val">${fmt(totalGodkändVal)}</div><div class="off-kpi-lbl" style="font-size:9px;">Godkänt värde ex. moms</div></div>
       </div>
       <div style="display:flex;gap:7px;align-items:center;margin-bottom:6px;">
         <div class="swrap" style="flex:1;">
           <span class="sico">${ic('search',16)}</span>
           <input id="off-search-input" type="search" placeholder="Sök offert, kund, titel eller ID…"
             value="${(this._search||'').replace(/"/g,'&quot;')}"
             oninput="OffersPage._onSearchInput(this)">
           ${this._search ? `<button class="off-clr-btn" onclick="OffersPage._clearSearch()" title="Rensa sökning">${ic('x',13)}</button>` : ''}
         </div>
         <button class="btn bp bsm" onclick="OffersPage.openCreate()">${ic('plus',14)} Ny offert</button>
       </div>
       <div id="off-tabs-row" class="ftabs" style="margin-bottom:6px;"></div>
       <div id="off-results"></div>`;

    this._renderTabRow(kpi);
    this._renderResults();
  },

  _getKpi() {
    const kpi = {utkast:0, skickad:0, godkänd:0, nekad:0, total:0};
    (state.offers||[]).forEach(o => {
      if (kpi[o.status] !== undefined) kpi[o.status]++;
      kpi.total++;
    });
    return kpi;
  },

  _renderTabRow(kpi) {
    const el = document.getElementById('off-tabs-row');
    if (!el) return;
    const c = kpi || this._getKpi();
    const f = this._filter || 'alla';
    const tabs = [
      {v:'alla',    l:'Alla',    n:c.total},
      {v:'utkast',  l:'Utkast',  n:c.utkast},
      {v:'skickad', l:'Skickade',n:c.skickad},
      {v:'godkänd', l:'Godkända',n:c.godkänd},
      {v:'nekad',   l:'Nekade',  n:c.nekad},
    ];
    el.innerHTML = tabs.map(t =>
      `<button class="ft ${f===t.v?'on':''}" onclick="OffersPage._setFilter('${t.v}')">${t.l}${t.n?` <span style="background:rgba(0,0,0,.10);border-radius:9px;padding:0 5px;font-size:9px;">${t.n}</span>`:''}</button>`
    ).join('');
  },

  _setFilter(v) {
    this._filter = v;
    this._renderTabRow();
    this._renderResults();
  },

  _onSearchInput(inputEl) {
    this._search = inputEl.value;
    // Toggle clear button without touching the input element
    const wrap = inputEl.parentElement;
    let btn = wrap.querySelector('.off-clr-btn');
    if (this._search && !btn) {
      btn = document.createElement('button');
      btn.className = 'off-clr-btn';
      btn.title = 'Rensa sökning';
      btn.setAttribute('onclick', 'OffersPage._clearSearch()');
      btn.innerHTML = ic('x', 13);
      wrap.appendChild(btn);
    } else if (!this._search && btn) {
      btn.remove();
    }
    this._renderResults();
  },

  _clearSearch() {
    this._search = '';
    const inp = document.getElementById('off-search-input');
    if (inp) { inp.value = ''; inp.focus(); }
    const btn = document.querySelector('.off-clr-btn');
    if (btn) btn.remove();
    this._renderResults();
  },

  _renderResults() {
    const el = document.getElementById('off-results');
    if (!el) return;
    const all = (state.offers || []).slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const filterTab = this._filter || 'alla';
    const q = (this._search || '').toLowerCase().trim();

    let offers = all;
    if (filterTab !== 'alla') offers = offers.filter(o => o.status === filterTab);
    if (q) offers = offers.filter(o => {
      const cu = getCu(o.customerId);
      const cuName = cu ? CustomerService.displayName(cu).toLowerCase() : '';
      return o.id.toLowerCase().includes(q)
        || (o.title||'').toLowerCase().includes(q)
        || cuName.includes(q)
        || (o.summary||'').toLowerCase().includes(q)
        || (o.status||'').toLowerCase().includes(q);
    });

    if (offers.length === 0) {
      const noBase = filterTab==='alla' && !q;
      const clearBtn = q ? `<button class="btn bs bsm" style="margin-top:10px;" onclick="OffersPage._clearSearch()">Rensa sökning</button>` : '';
      el.innerHTML = `<div class="empty">${ic('file-text',36)}
        <h3>${noBase?'Inga offerter':'Inga träffar'}</h3>
        <p>${noBase?'Klicka "Ny offert" för att komma igång':q?'Inga offerter matchar din sökning.':'Inga offerter i detta filter.'}</p>
        ${noBase?`<button class="btn bp bsm" onclick="OffersPage.openCreate()" style="margin-top:8px;">${ic('plus',12)} Ny offert</button>`:clearBtn}
      </div>`;
      return;
    }

    el.innerHTML = offers.map(o => {
      const cu      = getCu(o.customerId);
      const cuName  = cu ? CustomerService.displayName(cu) : '—';
      const disp    = o.title || o.id;
      const prLines = (o.lines||[]).filter(l=>l.type!=='text');
      const extras  = o.extras||[];
      const rawExVat= Math.round(prLines.reduce((s,l)=>s+(l.exVat||l.total||0),0)+extras.reduce((s,e)=>s+Math.round((e.qty||1)*(e.unitPrice||0)),0));
      const _disc   = o.discount||{type:'percent',value:0};
      const discAmt = _disc.value?(_disc.type==='percent'?Math.round(rawExVat*Math.min(_disc.value,100)/100):Math.min(Math.round(_disc.value),rawExVat)):0;
      const exVatD  = rawExVat - discAmt;
      const incVat  = exVatD + Math.round(exVatD*0.25);
      const rutAmt  = Math.round(prLines.filter(l=>l.type==='service').reduce((s,l)=>s+(l.rutAmount||0),0));
      const cust    = incVat - rutAmt;
      const insight = OffersPage._offerInsight(o);
      const statusColors = {utkast:'#94a3b8',skickad:'var(--blue)',väntar:'var(--or)',godkänd:'var(--gr)',nekad:'var(--rd)',utgången:'var(--mt)'};
      const borderColor = statusColors[o.status] || 'var(--br)';
      return `<div class="list-item off-offer-card" style="border-left-color:${borderColor};" onclick="Router.showPage('pg-offer-detail',{offerId:'${o.id}'})">
  <div class="off-offer-card-top">
    <div style="display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;">
      <span class="off-offer-card-id">${o.id}</span>
      ${sbdg(o.status)}
    </div>
    <div style="display:flex;align-items:baseline;gap:5px;flex-shrink:0;margin-left:8px;">
      <span style="font-size:11px;color:var(--mt);">Ex.</span>
      <strong style="font-size:13px;color:var(--navy);">${fmt(exVatD)} kr</strong>
      ${rutAmt ? `<span style="font-size:11px;color:var(--gr);font-weight:700;">&nbsp;→&nbsp;${fmt(cust)} kr kund</span>` : `<span style="font-size:11px;color:var(--mt);">&nbsp;(${fmt(incVat)} inkl.)</span>`}
    </div>
  </div>
  <div class="off-offer-card-title">${disp}</div>
  <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:6px;flex-wrap:wrap;">
    <div>
      <div class="off-offer-card-cu">${ic('user',11)} ${cuName}</div>
      <div class="off-offer-card-meta">
        ${ic('calendar',9)} ${fmtDate(o.createdAt)}
        ${o.sentAt ? `&nbsp;·&nbsp;${ic('send',9)} Skickad ${fmtDate(o.sentAt)}` : ''}
        ${o.validUntil ? `&nbsp;·&nbsp;${ic('clock',9)} Giltig t.o.m. ${fmtDate(o.validUntil)}` : ''}
      </div>
    </div>
    ${insight ? `<span class="off-offer-insight ${insight.cls}" style="margin-top:0;">${insight.txt}</span>` : ''}
  </div>
</div>`;
    }).join('');
  },

  _offerExVat(o) {
    return Math.round((o.lines || []).filter(l => l.type !== 'text')
      .reduce((s, l) => s + (l.exVat || l.total || 0), 0));
  },

  _offerInsight(o) {
    const now = Date.now();
    const validDate  = o.validUntil ? new Date(o.validUntil).getTime() : null;
    const daysLeft   = validDate ? Math.round((validDate - now) / 86400000) : null;
    const sentDate   = o.sentAt ? new Date(o.sentAt).getTime() : null;
    const daysSent   = sentDate ? Math.round((now - sentDate) / 86400000) : null;

    if (o.status === 'godkänd' && o.workOrderId)  return {cls:'ins-godkand', txt: ic('check-circle',10) + ' Arbetsorder ' + o.workOrderId + ' skapad'};
    if (o.status === 'godkänd' && !o.workOrderId) return {cls:'ins-godkand', txt: ic('check-circle',10) + ' Godkänd — skapa arbetsorder nu'};
    if (o.status === 'nekad')    return {cls:'ins-nekad',   txt: ic('x-circle',10) + ' Nekad — följ upp orsak'};
    if (o.status === 'utgången') return {cls:'ins-nekad',   txt: ic('clock',10) + ' Utgången — förnya offerten'};
    if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 7) return {cls:'ins-expiry', txt: '⚠️ Giltighet går ut om ' + daysLeft + ' dag' + (daysLeft === 1 ? '' : 'ar')};
    if ((o.status === 'skickad' || o.status === 'väntar') && daysSent !== null && daysSent > 5) return {cls:'ins-followup', txt: ic('bell',10) + ' Skickad för ' + daysSent + ' dagar sedan — dags att följa upp'};
    if (o.status === 'skickad')  return {cls:'ins-skickad', txt: ic('send',10) + ' Skickad — inväntar svar'};
    if (o.status === 'väntar')   return {cls:'ins-followup',txt: ic('clock',10) + ' Väntar på svar'};
    if (o.status === 'utkast')   return {cls:'ins-utkast',  txt: ic('edit-3',10) + ' Utkast — färdigställ och skicka'};
    return null;
  },

  /* ── Wizard open ─── */
  openCreate(preCustomerId) {
    const T = this._TERMS;
    const today    = new Date().toISOString().split('T')[0];
    const validDef = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
    this._editLines    = [];
    this._editExtras   = [];
    this._editOfferId  = null;
    this._wizardStep   = 1;
    this._activeSvcId  = null;
    this._svcFields    = {};
    this._svcEditIdx   = null;
    this._svcReduction = 'ingen';
    this._discount     = {type:'percent', value:0};
    this._wizardData   = {
      customerId: preCustomerId || '', title: '', date: today, validUntil: validDef,
      summary: '', scope: '', includes: '', excludes: '',
      paymentTerms: T.payment, validityText: T.validity, generalTerms: T.general, internalNote: ''
    };
    this._showWizard();
  },

  openEdit(offerId) {
    const off = getOff(offerId);
    if (!off) return;
    const T = this._TERMS;
    const today    = new Date().toISOString().split('T')[0];
    const validDef = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
    this._editLines    = (off.lines  || []).map(l => ({...l}));
    this._editExtras   = (off.extras || []).map(e => ({...e}));
    this._editOfferId  = off.id;
    this._wizardStep   = 1;
    this._activeSvcId  = null;
    this._svcFields    = {};
    this._svcEditIdx   = null;
    this._svcReduction = 'ingen';
    this._discount     = off.discount ? {...off.discount} : {type:'percent', value:0};
    this._wizardData  = {
      customerId:   off.customerId   || '',
      title:        off.title        || '',
      date:         (off.createdAt||'').split('T')[0] || today,
      validUntil:   off.validUntil   || validDef,
      summary:      off.summary      || '',
      scope:        off.scope        || '',
      includes:     off.includes     || '',
      excludes:     off.excludes     || '',
      paymentTerms: off.paymentTerms || T.payment,
      validityText: off.validityText || T.validity,
      generalTerms: off.generalTerms || T.general,
      internalNote: off.internalNote || ''
    };
    this._showWizard();
  },

  /* ── Wizard core ─── */
  _showWizard() {
    // Render wizard inside the content area so sidebar stays visible
    const pgOffer = document.getElementById('pg-offer');
    if (pgOffer && !pgOffer.classList.contains('active')) Router.showPage('pg-offer');
    const con = document.getElementById('pg-offer-content');
    if (!con) return;
    con.dataset.wiz = '1';
    // Override .con padding/gap so wizard fills the area cleanly
    con.style.cssText = 'padding:0;gap:0;display:block;box-sizing:border-box;';
    con.innerHTML = '<div id="off-wizard"></div>';
    document.getElementById('off-wizard').innerHTML = this._wizardHtml();
    const scroll = document.getElementById('content-scroll');
    if (scroll) scroll.scrollTop = 0;
  },

  _wizardClose() {
    const con = document.getElementById('pg-offer-content');
    if (con) { delete con.dataset.wiz; con.style.cssText = ''; }
    document.getElementById('off-svc-overlay')?.remove();
    this.render();
  },

  _rerender() {
    const con = document.getElementById('pg-offer-content');
    if (!con || !con.dataset.wiz) return;
    const wiz = document.getElementById('off-wizard');
    if (wiz) wiz.innerHTML = this._wizardHtml();
    const scroll = document.getElementById('content-scroll');
    if (scroll) scroll.scrollTop = 0;
  },

  _wizardHtml() {
    const step = this._wizardStep;
    const isEdit = !!this._editOfferId;
    const labels = ['Kund & info', 'Tjänster & rader', 'Villkor & spara'];

    const stepInd = labels.map((lbl, i) => {
      const n = i + 1;
      const done   = n < step;
      const active = n === step;
      const circ = `<div style="width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0;
        background:${done?'#22c55e':active?'var(--navy)':'#d1d5db'};color:${done||active?'#fff':'#9ca3af'};">
        ${done ? ic('check',11) : n}</div>`;
      const bar = i < labels.length - 1 ? `<div style="width:20px;height:2px;background:${done?'#22c55e':'#d1d5db'};margin:0 4px;margin-bottom:14px;flex-shrink:0;"></div>` : '';
      return `<div style="display:flex;align-items:center;">${
        `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
          ${circ}
          <div style="font-size:9px;font-weight:${active?'700':'500'};color:${active?'var(--navy)':'#9ca3af'};white-space:nowrap;">${lbl}</div>
        </div>`
      }${bar}</div>`;
    }).join('');

    // Header sticks to top of #content-scroll (no fixed overlay — wizard lives inside the page)
    const hdr = `<div style="background:#fff;border-bottom:1px solid var(--br);padding:10px 14px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:10;box-shadow:0 1px 6px rgba(0,0,0,.07);">
      <div style="flex:1;font-size:13px;font-weight:800;color:var(--navy);">${isEdit ? 'Redigera offert' : 'Ny offert'}</div>
      <div style="display:flex;align-items:flex-end;">${stepInd}</div>
      <button type="button" onclick="OffersPage._wizardClose()" title="Stäng" style="width:30px;height:30px;border:none;background:rgba(0,0,0,.07);border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${ic('x',15)}</button>
    </div>`;

    let ftr;
    if (step === 1) {
      ftr = `<div style="background:#fff;border-top:1px solid var(--br);padding:8px 14px;display:flex;gap:7px;justify-content:flex-end;">
        <button type="button" class="btn bs bsm" onclick="OffersPage._wizardClose()">Avbryt</button>
        <button type="button" class="btn bp bsm" onclick="OffersPage._nextStep()">${ic('arrow-right',12)} Nästa: Tjänster</button>
      </div>`;
    } else if (step === 2) {
      ftr = `<div style="background:#fff;border-top:1px solid var(--br);padding:8px 14px;display:flex;gap:7px;justify-content:space-between;">
        <button type="button" class="btn bs bsm" onclick="OffersPage._prevStep()">${ic('arrow-left',12)} Tillbaka</button>
        <button type="button" class="btn bp bsm" onclick="OffersPage._nextStep()">Nästa: Villkor ${ic('arrow-right',12)}</button>
      </div>`;
    } else {
      ftr = `<div style="background:#fff;border-top:1px solid var(--br);padding:8px 14px;display:flex;gap:7px;justify-content:space-between;">
        <button type="button" class="btn bs bsm" onclick="OffersPage._prevStep()">${ic('arrow-left',12)} Tillbaka</button>
        <button type="button" class="btn bp bsm" onclick="OffersPage._save()">${ic('save',12)} ${isEdit ? 'Spara ändringar' : 'Spara offert'}</button>
      </div>`;
    }

    const innerCls = this._wizardStep === 3 ? 'off-wiz-inner' : 'off-wiz-inner-wide';
    return hdr + `<div class="${innerCls}">${this._stepHtml()}</div>` + ftr;
  },

  _stepHtml() {
    if (this._wizardStep === 1) return this._step1Html();
    if (this._wizardStep === 2) return this._step2Html();
    return this._step3Html();
  },

  /* ── Step 1: Kund & info ─── */
  _step1Html() {
    const d   = this._wizardData;
    const esc = s => (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const cuOpts = [{v:'',l:'— Välj kund —'}, ...(state.customers||[]).map(c=>({v:c.id,l:CustomerService.displayName(c)}))];
    return `
      <div class="off-s1-grid">
        <div class="off-s1-col">
          <div class="fg">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;">
              <label style="margin-bottom:0;">Kund <span style="color:var(--rd)">*</span></label>
              <button type="button" class="off-new-cu-btn" onclick="OffersPage._quickNewCustomer()">
                ${ic('user-plus',11)} Ny kund
              </button>
            </div>
            ${CustomSelect.render('off-cu',{options:cuOpts,value:d.customerId,placeholder:'— Välj kund —',searchable:true,onchange:"OffersPage._wizardData.customerId=this.value"})}
          </div>
          <div class="fg">
            <label>Rubrik / titel</label>
            <input id="off-title" value="${esc(d.title)}" placeholder="T.ex. Serviceavtal 2025 – Solvägen 3"
              oninput="OffersPage._wizardData.title=this.value">
          </div>
          <div class="g2">
            <div class="fg"><label>Datum</label>
              <input type="date" id="off-date" value="${esc(d.date)}"
                oninput="OffersPage._wizardData.date=this.value"></div>
            <div class="fg"><label>Giltig till</label>
              <input type="date" id="off-valid" value="${esc(d.validUntil)}"
                oninput="OffersPage._wizardData.validUntil=this.value"></div>
          </div>
          <div class="fg">
            <label>Kort sammanfattning</label>
            <textarea id="off-summary" rows="3" placeholder="T.ex. Stentvätt av marksten, ca 120 m², med algbehandling…"
              oninput="OffersPage._wizardData.summary=this.value">${esc(d.summary)}</textarea>
            <button type="button" class="off-gen-btn" onclick="OffersPage._genTextSuggestion()">
              ${ic('zap',11)} Generera textförslag
            </button>
            ${d._lastGenFrom ? `<div style="font-size:10px;color:var(--mt);margin-top:4px;display:flex;align-items:center;gap:4px;">${ic('check',9)}<span>Senast: <em>${d._lastGenFrom}</em></span></div>` : ''}
          </div>
        </div>
        <div class="off-s1-col">
          <div class="fg">
            <label>Uppdragets omfattning</label>
            ${this._toolbarHtml('off-scope','scope')}
            <textarea id="off-scope" rows="4" placeholder="Beskriv vad uppdraget innebär…"
              oninput="OffersPage._wizardData.scope=this.value">${esc(d.scope)}</textarea>
          </div>
          <div class="g2">
            <div class="fg"><label>Vad ingår</label>
              <textarea id="off-includes" rows="3" placeholder="- Rengöring&#10;- Material…"
                oninput="OffersPage._wizardData.includes=this.value">${esc(d.includes)}</textarea></div>
            <div class="fg"><label>Vad ingår ej</label>
              <textarea id="off-excludes" rows="3" placeholder="- Målning&#10;- Elektriker…"
                oninput="OffersPage._wizardData.excludes=this.value">${esc(d.excludes)}</textarea></div>
          </div>
        </div>
      </div>`;
  },

  /* ── Snabbskapa ny kund ─── */
  _quickNewCustomer() {
    const body = `
      <div class="fg"><label>Namn / Företag <span style="color:var(--rd)">*</span></label>
        <input id="qcu-name" placeholder="Förnamn Efternamn eller Företagsnamn AB"></div>
      <div class="g2">
        <div class="fg"><label>Telefon</label><input id="qcu-phone" placeholder="070-xxx xx xx"></div>
        <div class="fg"><label>E-post</label><input id="qcu-email" type="email" placeholder="namn@exempel.se"></div>
      </div>
      <div class="fg"><label>Gatuadress</label><input id="qcu-addr" placeholder="Storgatan 1"></div>
      <div class="g2">
        <div class="fg"><label>Postnummer</label><input id="qcu-zip" placeholder="123 45"></div>
        <div class="fg"><label>Stad</label><input id="qcu-city" placeholder="Stockholm"></div>
      </div>`;
    Modal.open({
      title: ic('user-plus',13) + ' Ny kund',
      body,
      buttons: [
        { label: 'Skapa & välj', cls: 'btn bp', onClick: () => {
          const name = document.getElementById('qcu-name')?.value.trim();
          if (!name) { showToast('Namn krävs'); return; }
          const cu = CustomerService.create({
            name, phone: document.getElementById('qcu-phone')?.value.trim()||'',
            email: document.getElementById('qcu-email')?.value.trim()||'',
            address: document.getElementById('qcu-addr')?.value.trim()||'',
            zip: document.getElementById('qcu-zip')?.value.trim()||'',
            city: document.getElementById('qcu-city')?.value.trim()||'',
            type: 'privat', status: 'aktiv'
          });
          this._wizardData.customerId = cu.id;
          Modal.close();
          this._rerender();
          showToast(name + ' skapad och vald');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('qcu-name')?.focus(), 80);
  },

  /* ── Step 2: Tjänster & rader ─── */
  _step2Html() {
    const discType = this._discount?.type || 'percent';
    const discVal  = this._discount?.value || 0;
    return `
      <div class="off-wiz-s2">
        <div class="off-wiz-s2-lines">
          <div class="off-action-cards">
            <button type="button" class="off-action-card" onclick="OffersPage._openSvcCalc(null)">
              <span class="off-action-card-icon">${ic('zap',15)}</span>
              <div><div class="off-action-card-title">Tjänst / kalkyl</div><div class="off-action-card-sub">VIFT:s prismodell</div></div>
            </button>
            <button type="button" class="off-action-card" onclick="OffersPage._addFixedLine()">
              <span class="off-action-card-icon">${ic('tag',15)}</span>
              <div><div class="off-action-card-title">Fastpris</div><div class="off-action-card-sub">Eget fast pris</div></div>
            </button>
            <button type="button" class="off-action-card" onclick="OffersPage._addManualLine()">
              <span class="off-action-card-icon">${ic('plus',15)}</span>
              <div><div class="off-action-card-title">Löpande rad</div><div class="off-action-card-sub">Antal × à-pris</div></div>
            </button>
            <button type="button" class="off-action-card" onclick="OffersPage._addTextBlock()">
              <span class="off-action-card-icon">${ic('align-left',15)}</span>
              <div><div class="off-action-card-title">Fritext</div><div class="off-action-card-sub">Info utan pris</div></div>
            </button>
          </div>
          <div id="off-lines">${this._linesHtml()}</div>
          <details style="margin-top:7px;border:1px solid var(--br);border-radius:var(--rs);overflow:hidden;">
            <summary style="padding:8px 11px;font-size:11px;font-weight:700;cursor:pointer;background:#fff;display:flex;align-items:center;gap:5px;">${ic('plus',11)} Tillval (valfria extratjänster)</summary>
            <div style="padding:7px 11px 11px;">
              <div id="off-extras">${this._extrasInnerHtml()}</div>
              <button type="button" class="btn bs bxs" style="margin-top:5px;" onclick="OffersPage._addExtra()">${ic('plus',10)} Lägg till tillval</button>
            </div>
          </details>
        </div>
        <div class="off-wiz-s2-summ">
          <div id="off-totals-bar">${this._totalsBarHtml()}</div>
          <div class="off-discount-ctrl">
            <label>Rabatt</label>
            <div style="display:flex;gap:4px;align-items:center;">
              <select id="off-disc-type" style="width:auto;"
                onchange="OffersPage._discount.type=this.value;OffersPage._refreshTotals()">
                <option value="percent"${discType==='percent'?' selected':''}>%</option>
                <option value="fixed"${discType==='fixed'?' selected':''}>kr</option>
              </select>
              <input type="number" id="off-disc-val" value="${discVal}" min="0" step="1" placeholder="0"
                style="width:64px;"
                oninput="OffersPage._discount.value=parseFloat(this.value)||0;OffersPage._refreshTotals()">
            </div>
          </div>
        </div>
      </div>`;
  },

  /* ── Step 3: Villkor & spara ─── */
  _step3Html() {
    const d   = this._wizardData;
    const esc = s => (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const prLines = this._editLines.filter(l => l.type !== 'text').length;
    const txtLines = this._editLines.filter(l => l.type === 'text').length;
    return `
      <div style="margin-bottom:14px;">
        ${this._totalsBarHtml()}
        <div style="margin-top:5px;font-size:10px;color:var(--mt);text-align:right;">${prLines} pristrader · ${txtLines} textblock</div>
      </div>
      <div class="g2">
        <div class="fg"><label>Betalningsvillkor</label>
          <input id="off-payment" value="${esc(d.paymentTerms)}" placeholder="T.ex. 30 dagar netto"
            oninput="OffersPage._wizardData.paymentTerms=this.value"></div>
        <div class="fg"><label>Offertens giltighetstid</label>
          <input id="off-validity" value="${esc(d.validityText)}" placeholder="T.ex. 30 dagar"
            oninput="OffersPage._wizardData.validityText=this.value"></div>
      </div>
      <div class="fg">
        <label>Allmänna villkor</label>
        <textarea id="off-terms" rows="4" placeholder="Allmänna villkor…"
          oninput="OffersPage._wizardData.generalTerms=this.value">${esc(d.generalTerms)}</textarea>
      </div>
      <div class="fg" style="margin-top:4px;">
        <label>Intern anteckning <span style="font-size:10px;font-weight:400;color:var(--mt);">(visas ej för kund)</span></label>
        <textarea id="off-note" rows="2" placeholder="Intern anteckning…"
          oninput="OffersPage._wizardData.internalNote=this.value">${esc(d.internalNote)}</textarea>
      </div>`;
  },

  _totalsBarHtml() {
    const rawExVat = this._calcExVat(this._editLines, this._editExtras);
    const discAmt  = this._calcDiscount(rawExVat);
    const exVat    = rawExVat - discAmt;
    const vat      = Math.round(exVat * 0.25);
    const incVat   = exVat + vat;
    const rutAmt   = this._calcRutAmt(this._editLines);
    const cust     = incVat - rutAmt;
    return `<div class="off-totals-card">
      <div class="off-totals-card-hd">Sammanfattning</div>
      <div class="off-totals-card-body">
        <div class="off-totals-row"><span>Summa ex. moms</span><strong>${fmt(rawExVat)} kr</strong></div>
        ${discAmt ? `<div class="off-totals-rut" style="color:#b45309;"><span>Rabatt</span><span>−${fmt(discAmt)} kr</span></div>` : ''}
        <div class="off-totals-row"><span>Moms 25 %</span><strong>${fmt(vat)} kr</strong></div>
        <div class="off-totals-divider"></div>
        <div class="off-totals-total"><span>Totalt inkl. moms</span><span>${fmt(incVat)} kr</span></div>
        ${rutAmt ? `
        <div class="off-totals-divider"></div>
        <div class="off-totals-rut"><span>RUT/ROT-reduktion</span><span>−${fmt(rutAmt)} kr</span></div>` : ''}
        <div class="off-totals-cust">
          <span class="off-totals-cust-lbl">Kundpris inkl. moms</span>
          <span class="off-totals-cust-val">${fmt(cust)} kr</span>
        </div>
      </div>
    </div>`;
  },

  /* ── Step navigation ─── */
  _nextStep() {
    if (this._wizardStep === 1) {
      const cuId = document.getElementById('off-cu')?.value || this._wizardData.customerId;
      if (!cuId) { showToast('Välj en kund'); return; }
      this._wizardData.customerId = cuId;
    }
    if (this._wizardStep === 2) {
      if (!this._editLines.some(l => l.type !== 'text')) {
        showToast('Lägg till minst en rad eller tjänst'); return;
      }
    }
    if (this._wizardStep < 3) { this._wizardStep++; this._rerender(); }
  },

  _prevStep() {
    if (this._wizardStep === 3) {
      const map = {'off-payment':'paymentTerms','off-validity':'validityText','off-terms':'generalTerms','off-note':'internalNote'};
      Object.entries(map).forEach(([id,key]) => {
        const el = document.getElementById(id);
        if (el) this._wizardData[key] = el.value;
      });
    }
    if (this._wizardStep > 1) { this._wizardStep--; this._rerender(); }
  },

  /* ── Line card HTML ─── */
  _linesHtml() {
    if (!this._editLines.length) return `
      <div class="off-lines-empty">
        <div class="off-lines-empty-icon">${ic('file-text',22)}</div>
        <div class="off-lines-empty-txt">Inga rader ännu</div>
        <div class="off-lines-empty-sub">Lägg till en tjänst ovan</div>
      </div>`;
    return this._editLines.map((l, i) => {
      if (l.type === 'text')    return this._renderTextCard(l, i);
      if (l.type === 'service') return this._renderServiceCard(l, i);
      if (l.type === 'fixed')   return this._renderFixedCard(l, i);
      return this._renderManualCard(l, i);
    }).join('');
  },

  _renderServiceCard(l, i) {
    const exVat  = l.exVat || 0;
    const vat    = Math.round(exVat * (l.vatRate||25) / 100);
    const incVat = exVat + vat;
    const rutAmt = l.rutAmount || 0;
    const cust   = incVat - rutAmt;
    return `<div class="off-svc-card">
      <div class="off-svc-card-hd">
        <div style="flex:1;min-width:0;">
          <div class="off-svc-card-title">${l.templateName||'Tjänst'}</div>
          <div class="off-svc-card-meta">${ic('zap',9)} Tjänst</div>
          ${l.calculationNote ? `<div class="off-svc-card-sub" style="margin-bottom:2px;">Prisnivå: ${l.calculationNote.replace('Prisnivå: ','')}</div>` : ''}
          ${(l.subLines||[]).map(sl=>`<div class="off-svc-card-sub">${sl.desc} · ${sl.qty} ${sl.unit} × ${fmt(sl.price)} = <strong>${fmt(Math.round(sl.qty*sl.price))} kr</strong></div>`).join('')}
        </div>
        <div style="flex-shrink:0;text-align:right;">
          <div class="off-svc-card-price">${fmt(exVat)} kr</div>
          <div class="off-svc-card-price-sub">ex. moms</div>
          ${rutAmt ? `<div class="off-svc-card-rut">Kund: ${fmt(cust)} kr inkl.</div>` : ''}
        </div>
      </div>
      <input value="${(l.description||'').replace(/"/g,'&quot;')}" placeholder="Beskrivning på offerten…"
        style="font-size:11px;margin-bottom:6px;"
        oninput="OffersPage._editLines[${i}].description=this.value">
      <div style="display:flex;gap:5px;">
        <button type="button" class="btn bs bxs" onclick="OffersPage._openSvcCalc(${i})">${ic('pencil',10)} Redigera</button>
        <button type="button" class="btn bd bxs" onclick="OffersPage._removeLine(${i})">${ic('trash-2',10)} Ta bort</button>
      </div>
    </div>`;
  },

  _renderManualCard(l, i) {
    const units = ['st','tim','m','m²','m³','lm','kg','l','paket','mån'];
    const total  = Math.round((l.qty!=null?l.qty:1)*(l.unitPrice||0));
    return `<div style="background:#fff;border:1px solid var(--br);border-radius:var(--rs);padding:10px 12px;margin-bottom:7px;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:7px;">
        <span style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--mt);">${ic('minus',9)} Manuell rad</span>
        <div style="flex:1;"></div>
        <strong style="font-size:12px;color:var(--navy);" id="off-lt-${i}">${fmt(total)} kr</strong>
        <button type="button" class="btn bd bxs" onclick="OffersPage._removeLine(${i})">${ic('x',10)}</button>
      </div>
      <input value="${(l.description||'').replace(/"/g,'&quot;')}" placeholder="Benämning" style="margin-bottom:6px;font-size:12px;"
        oninput="OffersPage._editLines[${i}].description=this.value">
      <div style="display:grid;grid-template-columns:72px 72px 1fr;gap:5px;">
        <div><label style="font-size:9px;color:var(--mt);font-weight:600;display:block;margin-bottom:2px;">Antal</label>
          <input type="number" value="${l.qty!=null?l.qty:1}" min="0" step="0.5"
            oninput="OffersPage._editLines[${i}].qty=parseFloat(this.value)||0;OffersPage._refreshTotals()"></div>
        <div><label style="font-size:9px;color:var(--mt);font-weight:600;display:block;margin-bottom:2px;">Enhet</label>
          <select onchange="OffersPage._editLines[${i}].unit=this.value">
            ${units.map(u=>`<option${(l.unit||'st')===u?' selected':''}>` + u + `</option>`).join('')}
          </select></div>
        <div><label style="font-size:9px;color:var(--mt);font-weight:600;display:block;margin-bottom:2px;">À-pris ex. moms (kr)</label>
          <input type="number" value="${l.unitPrice||0}" min="0" step="1"
            oninput="OffersPage._editLines[${i}].unitPrice=parseFloat(this.value)||0;OffersPage._refreshTotals()"></div>
      </div>
    </div>`;
  },

  _renderTextCard(l, i) {
    return `<div style="background:#fff;border:1px solid var(--br);border-radius:var(--rs);padding:10px 12px;margin-bottom:7px;border-left:3px solid #cbd5e1;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:7px;">
        <span style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--mt);">${ic('align-left',9)} Fritextblock</span>
        <div style="flex:1;"></div>
        <button type="button" class="btn bd bxs" onclick="OffersPage._removeLine(${i})">${ic('x',10)}</button>
      </div>
      <input value="${(l.blockTitle||'').replace(/"/g,'&quot;')}" placeholder="Rubrik (t.ex. Förutsättningar)" style="margin-bottom:6px;font-weight:600;font-size:12px;"
        oninput="OffersPage._editLines[${i}].blockTitle=this.value">
      <textarea rows="2" placeholder="Fritext som visas på offerten…"
        oninput="OffersPage._editLines[${i}].text=this.value">${l.text||''}</textarea>
    </div>`;
  },

  /* ── Extras ─── */
  _extrasInnerHtml() {
    const units = ['st','tim','m','m²','kg','paket'];
    if (!this._editExtras.length) return `<p style="font-size:12px;color:var(--mt);margin:0 0 4px;">Inga tillval ännu.</p>`;
    return this._editExtras.map((e, i) => `
      <div style="display:grid;grid-template-columns:1fr 65px 75px 90px 28px;gap:5px;align-items:center;padding:5px 0;border-bottom:1px solid var(--bg);">
        <input value="${(e.description||'').replace(/"/g,'&quot;')}" placeholder="Tillval"
          oninput="OffersPage._editExtras[${i}].description=this.value">
        <input type="number" value="${e.qty||1}" min="0" step="0.5"
          oninput="OffersPage._editExtras[${i}].qty=parseFloat(this.value)||0;OffersPage._refreshTotals()">
        <select onchange="OffersPage._editExtras[${i}].unit=this.value">
          ${units.map(u=>`<option${(e.unit||'st')===u?' selected':''}>` + u + `</option>`).join('')}
        </select>
        <input type="number" value="${e.unitPrice||0}" min="0" step="1" placeholder="À-pris"
          oninput="OffersPage._editExtras[${i}].unitPrice=parseFloat(this.value)||0;OffersPage._refreshTotals()">
        <button type="button" class="btn bd bxs" onclick="OffersPage._removeExtra(${i})">${ic('x',10)}</button>
      </div>`).join('');
  },

  _addExtra() {
    this._editExtras.push({id:'E'+Date.now(), description:'', qty:1, unit:'st', unitPrice:0, vatRate:25});
    const el = document.getElementById('off-extras');
    if (el) el.innerHTML = this._extrasInnerHtml();
  },

  _removeExtra(idx) {
    this._editExtras.splice(idx, 1);
    const el = document.getElementById('off-extras');
    if (el) el.innerHTML = this._extrasInnerHtml();
    this._refreshTotals();
  },

  /* ── New offer helpers ─── */

  _calcDiscount(rawExVat) {
    const d = this._discount;
    if (!d || !d.value) return 0;
    if (d.type === 'percent') return Math.round(rawExVat * Math.min(d.value, 100) / 100);
    return Math.min(Math.round(d.value), rawExVat);
  },

  _addFixedLine() {
    this._editLines.push({id:'F'+Date.now(), type:'fixed', description:'', unitPrice:0, vatRate:25});
    const el = document.getElementById('off-lines');
    if (el) el.innerHTML = this._linesHtml();
    this._refreshTotals();
    setTimeout(() => {
      const inputs = document.querySelectorAll('#off-lines .off-fixed-name');
      if (inputs.length) inputs[inputs.length-1].focus();
    }, 50);
  },

  _renderFixedCard(l, i) {
    const tot    = Math.round(l.unitPrice || 0);
    const incVat = tot + Math.round(tot * 0.25);
    return `<div class="off-svc-card" style="border-left-color:#0ea5e9;">
      <div class="off-svc-card-hd">
        <div style="flex:1;min-width:0;">
          <div class="off-svc-card-meta">${ic('tag',9)} Fastpris</div>
          <input class="off-fixed-name" value="${(l.description||'').replace(/"/g,'&quot;')}" placeholder="Benämning…"
            oninput="OffersPage._editLines[${i}].description=this.value">
        </div>
        <div style="flex-shrink:0;text-align:right;">
          <div class="off-svc-card-price" id="off-lt-${i}">${fmt(tot)} kr</div>
          <div class="off-svc-card-price-sub">ex. moms · ${fmt(incVat)} kr inkl.</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:130px 1fr;gap:6px;margin-top:6px;">
        <div><label style="font-size:9px;color:var(--mt);font-weight:600;display:block;margin-bottom:2px;">Pris ex moms (kr)</label>
          <input type="number" value="${l.unitPrice||0}" min="0" step="1"
            oninput="OffersPage._editLines[${i}].unitPrice=parseFloat(this.value)||0;OffersPage._refreshTotals()"></div>
        <div><label style="font-size:9px;color:var(--mt);font-weight:600;display:block;margin-bottom:2px;">Intern anteckning</label>
          <input value="${(l.note||'').replace(/"/g,'&quot;')}" placeholder="Syns ej för kund"
            oninput="OffersPage._editLines[${i}].note=this.value" style="font-size:11px;"></div>
      </div>
      <div style="margin-top:6px;">
        <button type="button" class="btn bd bxs" onclick="OffersPage._removeLine(${i})">${ic('trash-2',10)} Ta bort</button>
      </div>
    </div>`;
  },

  _toolbarHtml(fieldId, key) {
    const ins = (p,s,ph) => `OffersPage._insertFormat('${fieldId}','${key}','${p}','${s}','${ph}')`;
    return `<div class="off-toolbar">
      <button type="button" class="btn bs bxs" onclick="${ins('- ','','punkt')}" title="Punktlista">• Lista</button>
      <button type="button" class="btn bs bxs" onclick="${ins('**','**','text')}" title="Fet text"><b>B</b></button>
      <button type="button" class="btn bs bxs" onclick="${ins('\\n','','\\n')}" title="Radbrytning">↵</button>
    </div>`;
  },

  _insertFormat(fieldId, key, prefix, suffix, placeholder) {
    const el = document.getElementById(fieldId);
    if (!el) return;
    const s = el.selectionStart, e = el.selectionEnd;
    const sel = el.value.substring(s, e) || placeholder || 'text';
    const ins = prefix + sel + (suffix || '');
    el.value = el.value.substring(0, s) + ins + el.value.substring(e);
    el.focus();
    el.setSelectionRange(s + prefix.length, s + prefix.length + sel.length);
    const keyMap = {scope:'scope', includes:'includes', excludes:'excludes', summary:'summary'};
    if (keyMap[key]) this._wizardData[keyMap[key]] = el.value;
  },

  _genTextSuggestion() {
    const raw = document.getElementById('off-summary')?.value || this._wizardData.summary || '';
    this._wizardData.summary = document.getElementById('off-summary')?.value || this._wizardData.summary;
    const sum = raw.toLowerCase();

    const qtyMatch = sum.match(/(\d+(?:[.,]\d+)?)\s*(m²|m2|kvm|lm|löpmeter)/i);
    const qty = qtyMatch ? parseFloat((qtyMatch[1]||'').replace(',','.')) : null;
    const qtyUnit = qtyMatch ? (/(lm|löpmeter)/i.test(qtyMatch[2]) ? 'lm' : 'm²') : 'm²';
    const qtyStr = qty ? `ca ${qty} ${qtyUnit}` : '';

    // Multi-moment detection — each DEFS entry fires independently
    const WASH_V = /\b(tvätta|tvättar|tvättat|rengöra|rengör|högtryckstvätta|högtrycksvätta|softwash)\b/;
    const CLIP_V = /\b(klippa|klipper|klippt|trimma|trimmar|trimmat)\b/;

    const DEFS = [
      {
        id: 'rivning', label: 'Rivning / Demontering',
        trigger: s => /\b(riva|river|rivit|rivning|demontera|demonterar|demontering)\b|montera ned|ta ned konstruktion|riva ut/.test(s),
        action: 'rivning och demontering av befintliga konstruktioner',
        scopeCtx: 'Arbetet utförs metodiskt och säkert med rätt skyddsutrustning och hantering av rivmaterial.',
        includes: ['Demontering och rivning av angivna konstruktioner','Sortering och borttransport av rivmaterial','Dokumentation inför efterföljande arbeten'],
        excludes: ['Hantering av farligt avfall (asbest, PCB) utan separat avtal','Nya konstruktioner eller igensättning','Återuppbyggnad efter rivning'],
      },
      {
        id: 'fasadpanel', label: 'Fasadpanel / Panelarbete',
        trigger: s => /\b(fasadpanel|panelarbete|liggande panel|stående panel)\b|\bpanel\b/.test(s) && !/fasadtvätt/.test(s),
        action: 'montering och byte av fasadpanel',
        scopeCtx: 'Arbetet innefattar mätning, tillpassning och montering av ny panel med korrekt infästning och tätning.',
        includes: ['Demontering av befintlig panel','Montering av ny fasadpanel enligt specifikation','Tätning och fogning'],
        excludes: ['Målning av ny panel (tillval)','Bärande konstruktioner utöver panel','Material ej specificerat i offert'],
      },
      {
        id: 'trall', label: 'Trall / Altangolv',
        trigger: s => /\b(trall|altangolv|altantrall|trallplank)\b/.test(s),
        action: 'byte eller montering av trall och altangolv',
        scopeCtx: 'Arbetet innefattar demontering av gammalt golv, anpassning av underlag och montering av nya trallbrädor.',
        includes: ['Demontering av befintlig trall','Montering av ny trall enligt specifikation','Justering av underlag och syll'],
        excludes: ['Impregnering eller oljning (tillval)','Rekonstruktion av bärande balk','Material ej specificerat i offert'],
      },
      {
        id: 'målning', label: 'Målning / Ytbehandling',
        trigger: s => /\b(måla|målar|målat|målning|ytbehandling|ytbehandla|lacka|lackar|lackering)\b/.test(s),
        action: 'målning och ytbehandling av angivna ytor',
        scopeCtx: 'Arbetet utförs av erfaren målare med rätt material och metod för aktuell yta och miljö.',
        includes: ['Förarbete: slipning, spackling och grundning','Målning med överenskommet material och antal lager','Skydd av angränsande ytor'],
        excludes: ['Borttagning av gammal färg utöver normalt förarbete','Specialbehandlingar (brandskyddsfärg, klotterskydd)','Material ej inkluderat i offert'],
      },
      {
        id: 'felsökning', label: 'Felsökning / Felavhjälpning',
        trigger: s => /\b(felsök|felsöker|felsökt|felsökning|felsöka|diagnostiser|lokalisera|lokaliserar|lokaliserat|kontrollera|kontrollerar|kontrollerat|undersöka|undersöker|undersökt)\b|hitta felet|hitta läckan|leta efter fel/.test(s),
        action: 'felsökning och lokalisering av fel eller skada',
        scopeCtx: 'Arbetet utförs systematiskt av erfaren tekniker med rätt utrustning och dokumenteras skriftligt.',
        includes: ['Systematisk felsökning och diagnostik','Dokumentation av fynd och skadeläge','Skriftlig åtgärdsrapport med prioritering','Löpande kommunikation med uppdragsgivare'],
        excludes: ['Avhjälpande åtgärder utöver felsökning (offerteras separat)','Ingrepp i konstruktion utan separat avtal','Garanterat resultat vid dolda eller komplexa fel'],
      },
      {
        id: 'skadedjur', label: 'Skadedjursbekämpning',
        trigger: s => /\b(myror|myrproblem|råttor|möss|gnagare|getingar|vespa|skalbaggar|insektsangrepp|skadedjur|bekämpa|bekämpning|sanera|sanering|utrota)\b/.test(s),
        action: 'inspektion och bekämpning av skadedjur',
        scopeCtx: 'Arbetet innefattar kartläggning av angreppsvägar, åtgärdsplan och genomförande av bekämpning.',
        includes: ['Inspektion och kartläggning av angreppsvägar','Identifiering av skadedjursart och omfattning','Bekämpning och uppföljning','Skriftlig rapport efter utfört arbete'],
        excludes: ['Rivning eller byggarbeten för åtkomst (separat offert)','Garanterad utrotning vid kraftiga angrepp utan fortsatt avtal','Löpande förebyggande avtal (separat prissättning)'],
      },
      {
        id: 'återställning', label: 'Återställning',
        trigger: s => /återställ/.test(s),
        action: 'återställning av skadade ytor och konstruktioner',
        scopeCtx: 'Arbetet syftar till att återställa konstruktionen till ursprungligt eller godkänt skick.',
        includes: ['Bedömning av skadeomfattning','Reparation och återställning av drabbade delar','Kontroll och besiktning efter åtgärd','Dokumentation och rapport'],
        excludes: ['Förebyggande åtgärder utöver specificerat arbete','Orsaksutredning utan separat avtal','Material ej specificerat i offert'],
      },
      {
        id: 'reparation', label: 'Reparation / Justering',
        trigger: s => /\b(laga|lagar|lagat|reparera|reparerar|reparerat|reparation|justera|justerar|justerat|byta|byter|bytt|byte|täta|tätar|tätat|tätning)\b/.test(s),
        action: 'reparation och justering av angivna delar',
        scopeCtx: 'Arbetet utförs av erfaren personal med rätt kompetens och verktyg.',
        includes: ['Bedömning och planering av åtgärd','Reparation eller justering enligt beskrivning','Test och kontroll efter åtgärd'],
        excludes: ['Större utbyten utöver specificerad åtgärd','Material ej inkluderat i offert','Tillkommande arbeten som framkommer under utförandet'],
      },
      {
        id: 'altantvätt', label: 'Altantvätt',
        trigger: s => /\b(altantvätt)\b/.test(s) || (WASH_V.test(s) && /altan/.test(s)),
        action: 'professionell rengöring av altan och träyta',
        scopeCtx: 'Arbetet utförs varsamt med metod anpassad för aktuellt träslag och ytskikt.',
        includes: ['Högtrycksrengöring anpassad för träyta','Biologisk algbehandling','Rengöring av räcken och trädetaljer'],
        excludes: ['Oljning eller impregnering (tillval)','Slipning eller utbyte av plankor','Målning'],
      },
      {
        id: 'fasadtvätt', label: 'Fasadtvätt',
        trigger: s => /\b(fasadtvätt)\b/.test(s) || (WASH_V.test(s) && /fasad/.test(s)),
        action: 'professionell fasadtvätt med anpassad metod',
        scopeCtx: 'Utförs av certifierad personal med metod anpassad efter materialtyp och föroreningsgrad.',
        includes: ['Inventering och bedömning av fasadtyp','Högtrycks- eller softwashtvätt','Biologisk algbehandling vid behov','Rengöring kring fönster och dörrar'],
        excludes: ['Puts- eller murningsarbeten','Målning av fasad','Fönsterputsning (tillval)'],
      },
      {
        id: 'stentvätt', label: 'Stentvätt / Marksten',
        trigger: s => /\b(stentvätt|stenhögtryck)\b/.test(s) || (WASH_V.test(s) && (/\b(marksten|betongplattor|stenläggning|plattor)\b/.test(s) || /stenterrass/.test(s))),
        action: 'högtrycksrengöring av marksten och belagda ytor',
        scopeCtx: 'Arbetet utförs med professionell utrustning och miljögodkända rengöringsmedel.',
        includes: ['Högtrycksrengöring av angiven yta','Biologisk algbehandling','Rengöring av kanter och kantstöd'],
        excludes: ['Ny fogsand efter tvätt (tillval)','Reparation av skadade plattor','Bortforsling av annat material'],
      },
      {
        id: 'taktvätt', label: 'Taktvätt / Mossrening',
        trigger: s => /\b(taktvätt|mossrening|mossborttagning)\b/.test(s) || (WASH_V.test(s) && /\btak\b/.test(s)),
        action: 'taktvätt och mossrening',
        scopeCtx: 'Arbetet utförs varsamt för att inte skada takbeläggning eller tätskikt.',
        includes: ['Manuell eller mekanisk mossborttagning','Högtryckssköljning av takyta','Biologisk mossdödare (förebyggande)','Kontroll av takrännor och stuprör'],
        excludes: ['Reparation av skadade takpannor','Tätning av genomföringar','Byte av takbeläggning'],
      },
      {
        id: 'fönsterputsning', label: 'Fönsterputsning',
        trigger: s => /\b(fönsterputsning|fönsterputsa|glasrengöring|putsa fönster)\b/.test(s) || (WASH_V.test(s) && /fönster/.test(s)),
        action: 'professionell fönsterputsning',
        scopeCtx: 'Utförs med professionell utrustning och rengöringsmedel anpassade för glas och karmar.',
        includes: ['Putsning av angivna fönster in- och/eller utvändigt','Rengöring av fönsterkarmar och fönsterbräden'],
        excludes: ['Reparation av trasigt glas','Svåråtkomliga fönster utan ställning (pristillägg)','Inglasade balkonger (separat offert)'],
      },
      {
        id: 'häckklippning', label: 'Häckklippning',
        trigger: s => /häck/.test(s) || (CLIP_V.test(s) && /buska/.test(s)),
        action: 'häckklippning och formklippning av buskage',
        scopeCtx: 'Arbetet utförs med professionell utrustning av erfaren personal.',
        includes: ['Klippning och formning av häck och buskage','Uppsamling och borttransport av klippmaterial'],
        excludes: ['Trädfällning eller stubbrytning','Plantering eller komplettering av häck','Kemisk bekämpning av ogräs'],
      },
      {
        id: 'gräsklippning', label: 'Gräsklippning',
        trigger: s => /\b(gräsklippning|grästrimning|gräsmatta)\b/.test(s) || (CLIP_V.test(s) && /gräs/.test(s)),
        action: 'professionell gräsklippning',
        scopeCtx: 'Arbetet utförs med professionell utrustning anpassad efter ytans storlek.',
        includes: ['Klippning av gräsmatta till önskad höjd','Kantklippning längs gångbanor och rabatter','Uppsamling och borttransport av gräsklipp'],
        excludes: ['Gödning eller behandling av gräsmatta (tillval)','Nysådd eller lagning av fläckar','Borttagning av mossa'],
      },
      {
        id: 'fogsand', label: 'Fogsand / Fogning',
        trigger: s => /\b(fogsand|fogning|foga|fogar|fogat)\b|lägga fogsand|fylla fogsand|fylla i fogsand/.test(s),
        action: 'läggning av fogsand och fogning av stenyta',
        scopeCtx: 'Arbetet utförs efter rengöring för optimal fästighet och hållbarhet.',
        includes: ['Bortsopning av gammal fogsand','Läggning av ny fogsand','Vattning och eftersopning'],
        excludes: ['Högtryckstvätt (tillval inför fogsand)','Justering av ojämna plattor','Material utöver specificerad mängd'],
      },
      {
        id: 'impregnering', label: 'Impregnering / Träskydd',
        trigger: s => /impregner|träskydd|träolja|olja trä/.test(s),
        action: 'impregnering och ytbehandling av träkonstruktion',
        scopeCtx: 'Arbetet utförs med godkänt träskyddsmedel för aktuell träsort och exponering.',
        includes: ['Rengöring av träyta inför behandling','Applicering av träskyddsmedel / impregnering'],
        excludes: ['Slipning eller utbyte av plankor (tillval)','Målning (separat offert)','Material ej specificerat i offert'],
      },
      {
        id: 'markarbete', label: 'Markarbete / Schaktning',
        trigger: s => /\b(schakta|schaktning|gräva|grävning|dränera|dränering|dagvatten|markarbete|markarbeten)\b/.test(s),
        action: 'markarbete och schaktning',
        scopeCtx: 'Arbetet utförs med rätt maskinell utrustning och med hänsyn till befintliga ledningar.',
        includes: ['Schaktning och bortforsling av massor','Dränering eller dagvattenåtgärder enligt plan','Återfyllning och komprimering'],
        excludes: ['Ledningskartering (uppdragsgivarens ansvar)','Asfalts- eller plattläggning (tillval)','Specialmaskiner utöver offert'],
      },
      {
        id: 'snöröjning', label: 'Snöröjning / Halkbekämpning',
        trigger: s => /\b(snöröjning|plogga|ploggar|plogning|skotta|skottning|sanda|sandning|salta|saltning|halkbekämpning)\b/.test(s),
        action: 'snöröjning och halkbekämpning',
        scopeCtx: 'Arbetet utförs snabbt och effektivt för att säkerställa framkomlighet och säkerhet.',
        includes: ['Plogning och skottning av ytor och gångar','Sandning och/eller saltning vid halka','Bortforsling av snö vid behov'],
        excludes: ['Skador orsakade av plogutrustning på ej markerade hinder','Återställning av vegetation efter vintersäsong'],
      },
      {
        id: 'fastighetsservice', label: 'Fastighetsservice',
        trigger: s => /\b(fastighetsservice|förvaltning|rondering|tillsyn|skötsel)\b/.test(s),
        action: 'fastighetsservice och löpande skötsel',
        scopeCtx: 'Arbetet utförs enligt överenskommen specifikation för att säkerställa fastighetens funktion och värde.',
        includes: ['Regelbundna tillsynsrundor med protokollföring','Felanmälan och åtgärd vid avvikelser','Rapportering till uppdragsgivare'],
        excludes: ['Större renoveringsarbeten','Specialisttjänster (el, VVS, hiss)','Material ej inkluderat i offert'],
      },
      {
        id: 'bygg', label: 'Bygg / Renovering',
        trigger: s => /\b(bygga|bygger|byggt|renovera|renoverar|renovering|nybyggnation)\b/.test(s),
        action: 'bygg och renoveringsarbete',
        scopeCtx: 'Arbetet utförs av behörig personal med rätt kompetens och material.',
        includes: ['Arbete och personal enligt offert','Nödvändig utrustning och skyddsmaterial','Dokumentation och besiktning vid behov'],
        excludes: ['Bygglov och myndighetskontakter (uppdragsgivarens ansvar)','Specialisttjänster (el, VVS) utöver offert','Material ej specificerat i offert'],
      },
    ];

    let matched = DEFS.filter(d => d.trigger(sum));

    // Suppress generic reparation if a specific repair-type moment matched
    const specificRepair = matched.some(m => ['trall','fasadpanel','återställning'].includes(m.id));
    if (specificRepair) matched = matched.filter(m => m.id !== 'reparation');

    // Fallback: infer from added service lines when summary is empty/short
    if (matched.length === 0) {
      const svcLines = this._editLines.filter(l => l.type === 'service');
      if (svcLines.length) {
        const ids = svcLines.map(l => (l.templateId || l.priceRuleRef || '').toLowerCase()).join(' ');
        const fbId = /altan/.test(ids) ? 'altantvätt' : /fasad/.test(ids) ? 'fasadtvätt' :
                     /sten/.test(ids) ? 'stentvätt' : /häck/.test(ids) ? 'häckklippning' :
                     /fs|fastighet/.test(ids) ? 'fastighetsservice' : /fönster/.test(ids) ? 'fönsterputsning' : null;
        if (fbId) matched = [DEFS.find(d => d.id === fbId)].filter(Boolean);
      }
    }

    let scope, includes, excludes, label;

    if (matched.length === 0) {
      const txt = this._wizardData.summary || 'uppdraget';
      scope    = 'Uppdraget avser ' + txt + '. Arbetet utförs av VIFT:s personal enligt branschstandard och överenskommelse.';
      includes = '- Arbete och personal enligt offert\n- Nödvändig utrustning och skyddsmaterial\n- Städning och bortforsling av eget avfall';
      excludes = '- Material ej specificerat i offert\n- Tillkommande arbeten utöver offertens omfattning';
      label    = 'Generell';
    } else {
      label = matched.map(m => m.label).join(' + ');

      // Build scope
      const actions = matched.map(m => m.action);
      const last = actions.length > 1 ? actions.pop() : null;
      const actionStr = last ? actions.join(', ') + ' samt ' + last : actions[0];
      scope = `Arbetet omfattar ${actionStr}${qtyStr ? ' (' + qtyStr + ')' : ''}. ${matched[0].scopeCtx}`;

      // Merge includes (deduplicated by first 22 chars)
      const inclSeen = new Set();
      const inclLines = [];
      for (const m of matched) {
        for (const inc of m.includes) {
          const key = inc.substring(0, 22);
          if (!inclSeen.has(key)) { inclSeen.add(key); inclLines.push('- ' + inc); }
        }
      }
      if (!inclLines.some(l => /städning/i.test(l))) {
        inclLines.push('- Städning av arbetsplats efter utfört arbete');
      }
      includes = inclLines.join('\n');

      // Merge excludes (deduplicated by first 22 chars)
      const exclSeen = new Set();
      const exclLines = [];
      for (const m of matched) {
        for (const exc of m.excludes) {
          const key = exc.substring(0, 22);
          if (!exclSeen.has(key)) { exclSeen.add(key); exclLines.push('- ' + exc); }
        }
      }
      if (!exclLines.some(l => /tillkommande/i.test(l))) {
        exclLines.push('- Tillkommande arbeten som framkommer under utförandet');
      }
      excludes = exclLines.join('\n');
    }

    this._wizardData.scope       = scope;
    this._wizardData.includes    = includes;
    this._wizardData.excludes    = excludes;
    this._wizardData._lastGenFrom = label + ' (' + new Date().toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'}) + ')';
    this._rerender();
    showToast('Textförslag baserat på: ' + label);
  },

  /* ── Totals ─── */
  _calcExVat(lines, extras) {
    const lSum = (lines||[]).filter(l=>l.type!=='text')
      .reduce((s,l)=>s+(l.type==='service'?(l.exVat||0):Math.round((l.qty!=null?l.qty:1)*(l.unitPrice||0))),0);
    const eSum = (extras||[]).reduce((s,e)=>s+Math.round((e.qty||1)*(e.unitPrice||0)),0);
    return Math.round(lSum + eSum);
  },

  _calcRutAmt(lines) {
    return Math.round((lines||[]).filter(l=>l.type==='service').reduce((s,l)=>s+(l.rutAmount||0),0));
  },

  _refreshTotals() {
    this._editLines.forEach((l, i) => {
      if (l.type === 'manual' || l.type === 'fixed') {
        const el = document.getElementById('off-lt-' + i);
        if (el) el.textContent = fmt(Math.round((l.qty!=null?l.qty:1)*(l.unitPrice||0))) + ' kr';
      }
    });
    const bar = document.getElementById('off-totals-bar');
    if (bar) bar.innerHTML = this._totalsBarHtml();
  },

  /* ── Line management ─── */
  _addManualLine() {
    this._editLines.push({id:'M'+Date.now(),type:'manual',description:'',qty:1,unit:'st',unitPrice:0,vatRate:25,total:0});
    const el = document.getElementById('off-lines');
    if (el) el.innerHTML = this._linesHtml();
    this._refreshTotals();
    setTimeout(() => {
      const inputs = document.querySelectorAll('#off-lines input[placeholder="Benämning"]');
      if (inputs.length) inputs[inputs.length-1].focus();
    }, 50);
  },

  _addTextBlock() {
    this._editLines.push({id:'T'+Date.now(),type:'text',blockTitle:'',text:''});
    const el = document.getElementById('off-lines');
    if (el) el.innerHTML = this._linesHtml();
  },

  _removeLine(idx) {
    this._editLines.splice(idx, 1);
    const el = document.getElementById('off-lines');
    if (el) el.innerHTML = this._linesHtml();
    this._refreshTotals();
  },

  /* ── Service calc overlay ─── */
  _openSvcCalc(editIdx) {
    this._svcEditIdx = editIdx;
    if (editIdx !== null && editIdx !== undefined) {
      const l = this._editLines[editIdx];
      if (l && l.type === 'service') {
        this._activeSvcId  = l.templateId || l.priceRuleRef;
        this._svcFields    = {...(l.inputValues || {})};
        this._svcReduction = l.reductionType || 'ingen';
      }
    } else {
      this._activeSvcId  = null;
      this._svcFields    = {};
      this._svcReduction = 'ingen';
    }
    // Respect sidebar on desktop: overlay starts at page-area left edge
    const isDesktop = window.innerWidth >= 1024;
    const sidebarW  = isDesktop ? (document.getElementById('bottom-nav')?.offsetWidth || 240) : 0;
    const alignItems = isDesktop ? 'center' : 'flex-end';
    const ovPad      = isDesktop ? '20px' : '0';

    let ov = document.getElementById('off-svc-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'off-svc-overlay';
      ov.onclick = e => { if (e.target === ov) OffersPage._closeSvcCalc(); };
      document.body.appendChild(ov);
    }
    ov.style.cssText = `position:fixed;top:0;right:0;bottom:0;left:${sidebarW}px;z-index:600;
      background:rgba(0,0,0,.42);display:flex;align-items:${alignItems};justify-content:center;padding:${ovPad};box-sizing:border-box;`;
    ov.innerHTML = this._svcOverlayHtml(isDesktop);
    if (this._activeSvcId) setTimeout(() => { this._initChips(); this._updateSvcPreview(); }, 20);
  },

  _closeSvcCalc() {
    document.getElementById('off-svc-overlay')?.remove();
    this._svcEditIdx = null;
  },

  _svcOverlayHtml(isDesktop) {
    const isEdit     = this._svcEditIdx !== null && this._svcEditIdx !== undefined;
    const activeTmpl = this._T.find(t => t.id === this._activeSvcId);
    const maxH       = isDesktop ? '84vh' : '92vh';
    const radius     = isDesktop ? '10px' : '14px 14px 0 0';

    const calcBody = activeTmpl
      ? this._svcCalcHtml(activeTmpl)
      : `<div style="padding:36px 16px;text-align:center;color:var(--mt);">
          <div style="margin-bottom:10px;">${ic('zap',28)}</div>
          <div style="font-size:13px;font-weight:600;">Välj en tjänst ${isDesktop ? 'till vänster' : 'ovan'}</div>
          <div style="font-size:11px;margin-top:4px;">Alla priser exklusive moms</div>
        </div>`;

    const descVal  = activeTmpl ? (activeTmpl.defaultDesc||'').replace(/"/g,'&quot;') : '';
    const addLabel = isEdit ? 'Uppdatera tjänst' : 'Lägg till i offert';

    const hdr = `<div class="off-svc-hdr">
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:800;color:var(--navy);">${ic('zap',13)} ${isEdit ? 'Redigera tjänst' : 'Lägg till tjänst'}</div>
        <div style="font-size:10px;color:var(--mt);">Alla priser exklusive moms</div>
      </div>
      <button type="button" onclick="OffersPage._closeSvcCalc()" class="off-close-btn">${ic('x',14)}</button>
    </div>`;

    const footer = `<div id="off-svc-footer" class="off-svc-footer">
      <div class="off-svc-footer-inner">
        <div class="fg">
          <label>Beskrivning på offerten</label>
          <input id="svc-custom-desc" value="${descVal}" placeholder="Kundvänlig beskrivning…" style="font-size:11px;">
        </div>
        <button type="button" class="btn bp bsm off-svc-add-btn" onclick="OffersPage._addSvcLine()">
          ${ic('plus',12)} ${addLabel}
        </button>
      </div>
    </div>`;

    if (!isDesktop) {
      const chips = this._T.map(t => {
        const active = t.id === this._activeSvcId;
        return `<button type="button" id="off-svc-chip-${t.id}"
          onclick="OffersPage._activateSvc('${t.id}',false)"
          class="off-svc-chip${active ? ' off-svc-chip--active' : ''}">${t.name}</button>`;
      }).join('');
      return `<div class="off-svc-modal" style="max-height:${maxH};border-radius:${radius};">
        ${hdr}
        <div class="off-svc-chips-bar">${chips}</div>
        <div id="off-svc-body" class="off-svc-body">${calcBody}</div>
        ${footer}
      </div>`;
    }

    const svcList = this._T.map(t => {
      const active = t.id === this._activeSvcId;
      return `<button type="button" id="off-svc-chip-${t.id}"
        onclick="OffersPage._activateSvc('${t.id}',false)"
        class="off-svc-menu-item${active ? ' off-svc-menu-item--active' : ''}">
        ${ic(t.icon,12)}<span>${t.name}</span>
      </button>`;
    }).join('');

    return `<div class="off-svc-modal" style="max-height:${maxH};border-radius:${radius};">
      ${hdr}
      <div class="off-svc-layout">
        <div class="off-svc-menu">${svcList}</div>
        <div id="off-svc-body" class="off-svc-body">${calcBody}</div>
      </div>
      ${footer}
    </div>`;
  },

  _activateSvc(tId, keepFields) {
    this._activeSvcId = tId;
    this._T.forEach(t => {
      const btn = document.getElementById('off-svc-chip-' + t.id);
      if (!btn) return;
      const a = t.id === tId;
      btn.classList.toggle('off-svc-menu-item--active', a);
      btn.classList.toggle('off-svc-chip--active', a);
    });
    const tmpl = this._T.find(t => t.id === tId);
    if (!tmpl) return;
    if (!keepFields) {
      this._svcFields    = {};
      this._svcReduction = tmpl.defaultReduction || 'ingen';
      tmpl.fields.forEach(f => {
        if (f.isRut || f.isRot) return;  // handled by _svcReduction
        if (f.def !== undefined)           this._svcFields[f.id] = f.def;
        else if (f.type==='chips'&&f.opts) this._svcFields[f.id] = f.opts[0];
        else if (f.type==='bool')          this._svcFields[f.id] = false;
        else if (f.type==='number')        this._svcFields[f.id] = 0;
        else                               this._svcFields[f.id] = '';
      });
    }
    const body = document.getElementById('off-svc-body');
    if (body) {
      body.innerHTML = this._svcCalcHtml(tmpl);
      setTimeout(() => { this._initChips(); this._updateSvcPreview(); }, 20);
    }
    // Update footer description to match the new service's default
    const descEl = document.getElementById('svc-custom-desc');
    if (descEl && !keepFields) descEl.value = tmpl.defaultDesc || '';
  },

  _svcCalcHtml(tmpl) {
    if (!tmpl) return '';
    const numF  = tmpl.fields.filter(f=>f.type==='number');
    const chipF = tmpl.fields.filter(f=>f.type==='chips');
    const txtF  = tmpl.fields.filter(f=>f.type==='text');
    const boolF = tmpl.fields.filter(f=>f.type==='bool'&&!f.isRut&&!f.isRot);
    const curRed = this._svcReduction;
    let html = '';

    // ── Quantity / number inputs ──
    numF.forEach(f => {
      const unit = {area:'m²',length:'lm',hours:'tim',qty:'tim',months:'mån'}[f.id]||'';
      const val  = this._svcFields[f.id]!=null&&this._svcFields[f.id]!==0 ? this._svcFields[f.id] : (f.def||'');
      html += `<div style="margin-bottom:10px;">
        <label style="font-size:10px;font-weight:700;color:var(--navy);display:block;margin-bottom:3px;">${f.label}${f.req?' <span style="color:var(--rd)">*</span>':''}</label>
        <div style="display:flex;align-items:center;gap:6px;">
          <input type="number" id="svc-f-${f.id}" value="${val}" min="0"
            step="${['rate','monthly','material'].includes(f.id)?'1':'0.5'}" placeholder="0"
            style="font-size:18px;font-weight:800;width:80px;text-align:center;padding:6px 8px;border:2px solid var(--navy);border-radius:var(--rs);color:var(--navy);"
            oninput="OffersPage._svcFields['${f.id}']=parseFloat(this.value)||0;OffersPage._updateSvcPreview()">
          ${unit?`<span style="font-size:14px;color:var(--mt);font-weight:700;">${unit}</span>`:''}
        </div>
      </div>`;
    });

    // ── Text inputs ──
    txtF.forEach(f => {
      html += `<div style="margin-bottom:10px;">
        <label style="font-size:10px;font-weight:700;color:var(--navy);display:block;margin-bottom:3px;">${f.label}${f.req?' <span style="color:var(--rd)">*</span>':''}</label>
        <input type="text" id="svc-f-${f.id}" value="${this._svcFields[f.id]||''}" placeholder="${f.label}" style="width:100%;"
          oninput="OffersPage._svcFields['${f.id}']=this.value;OffersPage._updateSvcPreview()">
      </div>`;
    });

    // ── Chip selectors ──
    chipF.forEach(f => {
      html += `<div style="margin-bottom:8px;">
        <label style="font-size:9px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">${f.label}</label>
        <div data-chips="${f.id}" style="display:flex;flex-wrap:wrap;gap:3px;">
          ${(f.opts||[]).map(o=>`<button type="button" data-val="${o}"
            style="padding:4px 9px;border-radius:20px;border:1.5px solid var(--br);font-size:10px;font-weight:600;cursor:pointer;background:#fff;color:var(--tx);transition:all .1s;"
            onclick="OffersPage._setChip('${f.id}','${o.replace(/'/g,"\\'")}',this)">${o}</button>`).join('')}
        </div>
      </div>`;
    });

    // ── Bool add-ons ──
    if (boolF.length) {
      html += `<div style="margin-bottom:8px;">
        <label style="font-size:9px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">Tillval</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">`;
      boolF.forEach(f => {
        html += `<label style="display:flex;align-items:center;gap:6px;padding:5px 8px;border:1.5px solid var(--br);border-radius:var(--rs);cursor:pointer;font-size:10px;font-weight:600;line-height:1.3;">
          <input type="checkbox" id="svc-f-${f.id}" style="width:14px;height:14px;flex-shrink:0;" ${this._svcFields[f.id]?'checked':''}
            onchange="OffersPage._svcFields['${f.id}']=this.checked;OffersPage._updateSvcPreview()">
          <span>${f.addLabel||f.label}</span></label>`;
      });
      html += `</div></div>`;
    }

    // ── Unified tax reduction selector — always show all three options ──
    const redOpts = [
      {v:'ingen', l:'Ingen reduktion'},
      {v:'rut',   l:'RUT – 50 %'},
      {v:'rot',   l:'ROT – 30 %'},
    ];
    html += `<div style="margin-bottom:8px;padding-top:6px;border-top:1px solid var(--br);">
      <label style="font-size:9px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">Skattereduktion</label>
      <div style="display:flex;gap:3px;">
        ${redOpts.map(o=>`<button type="button" id="svc-red-${o.v}"
          onclick="OffersPage._setReduction('${o.v}')"
          style="flex:1;padding:5px 6px;border-radius:6px;border:1.5px solid ${curRed===o.v?'var(--navy)':'var(--br)'};
            font-size:10px;font-weight:700;cursor:pointer;white-space:nowrap;
            background:${curRed===o.v?'var(--navy)':'#fff'};
            color:${curRed===o.v?'#fff':'var(--mt)'};">${o.l}</button>`).join('')}
      </div>
      <div style="font-size:9px;color:var(--mt);margin-top:3px;">Förutsätter att kunden har rätt till avdraget</div>
    </div>`;

    // ── Live preview ──
    html += `<div id="svc-preview" style="background:var(--navy);color:#fff;border-radius:var(--rs);padding:9px 11px;margin-top:4px;min-height:44px;">
      <div style="font-size:10px;opacity:.65;">Fyll i fälten ovan för att se kalkylen…</div>
    </div>`;
    return html;
  },

  /* ── Chips ─── */
  _setChip(fieldId, value, btn) {
    this._svcFields[fieldId] = value;
    const group = btn.closest('[data-chips]');
    if (group) {
      group.querySelectorAll('button').forEach(b => {
        const a = b === btn;
        b.style.background  = a ? 'var(--navy)' : '#fff';
        b.style.color       = a ? '#fff'        : 'var(--tx)';
        b.style.borderColor = a ? 'var(--navy)' : 'var(--br)';
        b.style.fontWeight  = a ? '700'         : '600';
      });
    }
    this._updateSvcPreview();
  },

  _setReduction(val) {
    this._svcReduction = val;
    ['ingen','rut','rot'].forEach(v => {
      const btn = document.getElementById('svc-red-' + v);
      if (!btn) return;
      const active = v === val;
      btn.style.background  = active ? 'var(--navy)' : '#fff';
      btn.style.color       = active ? '#fff'        : 'var(--mt)';
      btn.style.borderColor = active ? 'var(--navy)' : 'var(--br)';
    });
    this._updateSvcPreview();
  },

  _initChips() {
    const tmpl = this._T.find(t => t.id === this._activeSvcId);
    if (!tmpl) return;
    tmpl.fields.filter(f=>f.type==='chips').forEach(f => {
      const val   = this._svcFields[f.id] || f.def || (f.opts&&f.opts[0]);
      const group = document.querySelector('[data-chips="' + f.id + '"]');
      if (!group) return;
      group.querySelectorAll('button').forEach(btn => {
        const a = btn.dataset.val === val || btn.textContent.trim() === val;
        btn.style.background  = a ? 'var(--navy)' : '#fff';
        btn.style.color       = a ? '#fff'        : 'var(--tx)';
        btn.style.borderColor = a ? 'var(--navy)' : 'var(--br)';
        btn.style.fontWeight  = a ? '700'         : '600';
      });
    });
  },

  /* ── Svc preview ─── */
  _updateSvcPreview() {
    const tmpl = this._T.find(t => t.id === this._activeSvcId);
    const prev = document.getElementById('svc-preview');
    if (!tmpl || !prev) return;
    // Collect non-reduction fields from DOM
    tmpl.fields.forEach(f => {
      if (f.type === 'chips' || f.isRut || f.isRot) return;
      const el = document.getElementById('svc-f-' + f.id);
      if (!el) return;
      if (f.type==='bool')        this._svcFields[f.id] = el.checked;
      else if (f.type==='number') this._svcFields[f.id] = parseFloat(el.value)||0;
      else                        this._svcFields[f.id] = el.value;
    });
    // Inject unified reduction choice into calc fields
    const fields = {
      ...this._svcFields,
      rut: this._svcReduction === 'rut',
      rot: this._svcReduction === 'rot',
    };
    try {
      const result = tmpl.calc(fields);
      const {ls, exVat, rutAmt} = result;
      if (!exVat && exVat !== 0) {
        prev.innerHTML = `<div style="font-size:10px;opacity:.65;">Fyll i obligatoriska fält för att se kalkylen.</div>`;
        return;
      }
      const vat    = Math.round(exVat * (tmpl.vatRate||25) / 100);
      const incVat = exVat + vat;
      const custPr = incVat - (rutAmt||0);
      const redLbl = this._svcReduction === 'rut' ? 'RUT' : this._svcReduction === 'rot' ? 'ROT' : '';

      // Internal calc detail (small, muted)
      let html = '';
      if (result.tierLbl) {
        html += `<div style="font-size:8px;opacity:.5;margin-bottom:3px;letter-spacing:.3px;">Prisnivå: ${result.tierLbl}</div>`;
      }
      html += `<div style="font-size:9px;opacity:.65;margin-bottom:5px;padding-bottom:5px;border-bottom:1px solid rgba(255,255,255,.12);">`;
      ls.forEach(l => {
        html += `<div style="margin-bottom:1px;">${l.desc} · ${l.qty} ${l.unit} × ${fmt(l.price)} kr = ${fmt(Math.round(l.qty*l.price))} kr</div>`;
      });
      html += `</div>`;

      // Price rows
      html += `<div style="display:flex;justify-content:space-between;font-size:10px;opacity:.7;margin-bottom:1px;"><span>Ex. moms</span><span>${fmt(exVat)} kr</span></div>`;
      html += `<div style="display:flex;justify-content:space-between;font-size:10px;opacity:.7;margin-bottom:4px;"><span>Moms ${tmpl.vatRate||25}%</span><span>${fmt(vat)} kr</span></div>`;
      html += `<div style="display:flex;justify-content:space-between;font-size:11px;font-weight:700;padding-top:4px;border-top:1px solid rgba(255,255,255,.15);margin-bottom:${rutAmt?'3px':'6px'};">
        <span>Totalt inkl. moms</span><span>${fmt(incVat)} kr</span></div>`;

      if (rutAmt) {
        html += `<div style="display:flex;justify-content:space-between;font-size:10px;color:#86efac;margin-bottom:4px;">
          <span>Prelim. ${redLbl}-avdrag</span><span>-${fmt(rutAmt)} kr</span></div>`;
      }

      // Customer price — always shown, prominent
      const displayPrice = rutAmt ? custPr : incVat;
      html += `<div style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,.13);border-radius:6px;padding:6px 9px;">
        <span style="font-size:10px;opacity:.8;">Kundpris inkl. moms</span>
        <span style="font-size:17px;font-weight:800;">${fmt(displayPrice)} kr</span>
      </div>`;
      if (rutAmt) {
        html += `<div style="font-size:8px;opacity:.45;margin-top:3px;text-align:right;">* Prelim., förutsätter rätt till avdraget</div>`;
      }

      prev.innerHTML = html;
    } catch(e) {
      prev.innerHTML = `<div style="font-size:10px;opacity:.65;">Fyll i obligatoriska fält (markerade *) för att se kalkyl.</div>`;
    }
  },

  /* ── Add/update service line ─── */
  _addSvcLine() {
    const tmpl = this._T.find(t => t.id === this._activeSvcId);
    if (!tmpl) { showToast('Välj en tjänstetyp'); return; }
    // Collect non-reduction fields from DOM
    tmpl.fields.forEach(f => {
      if (f.type==='chips' || f.isRut || f.isRot) return;
      const el = document.getElementById('svc-f-' + f.id);
      if (!el) return;
      if (f.type==='bool')        this._svcFields[f.id] = el.checked;
      else if (f.type==='number') this._svcFields[f.id] = parseFloat(el.value)||0;
      else                        this._svcFields[f.id] = el.value;
    });
    // Inject unified reduction
    this._svcFields.rut = this._svcReduction === 'rut';
    this._svcFields.rot = this._svcReduction === 'rot';
    const missing = tmpl.fields.filter(f=>f.req&&!f.isRut&&!f.isRot&&!this._svcFields[f.id]&&this._svcFields[f.id]!==0);
    if (missing.length) { showToast('Fyll i: ' + missing.map(f=>f.label).join(', ')); return; }
    const result  = tmpl.calc(this._svcFields);
    const {ls, exVat, rutAmt} = result;
    const desc = (document.getElementById('svc-custom-desc')?.value||'').trim() || tmpl.defaultDesc;
    const lineData = {
      id:              'SVC' + Date.now(),
      type:            'service',
      templateId:      tmpl.id,
      templateName:    tmpl.name,
      description:     desc,
      subLines:        ls.map(l=>({...l})),
      exVat:           Math.round(exVat),
      vatRate:         tmpl.vatRate,
      rutAmount:       Math.round(rutAmt||0),
      reductionType:   this._svcReduction,
      total:           Math.round(exVat),
      inputValues:     {...this._svcFields},
      priceRuleRef:    tmpl.id,
      tierLbl:         result.tierLbl||'',
      calculationNote: result.tierLbl||''
    };
    const editIdx = this._svcEditIdx;
    if (editIdx !== null && editIdx !== undefined && this._editLines[editIdx]) {
      const prev = this._editLines[editIdx];
      lineData.id = prev.id;
      if (prev.description && desc === (tmpl.defaultDesc||'')) lineData.description = prev.description;
      this._editLines[editIdx] = lineData;
    } else {
      this._editLines.push(lineData);
    }
    this._closeSvcCalc();
    const el = document.getElementById('off-lines');
    if (el) el.innerHTML = this._linesHtml();
    this._refreshTotals();
    showToast(editIdx !== null && editIdx !== undefined ? tmpl.name + ' uppdaterad' : tmpl.name + ' tillagd');
  },

  /* ── Save ─── */
  _save() {
    if (this._wizardStep === 3) {
      const map = {'off-payment':'paymentTerms','off-validity':'validityText','off-terms':'generalTerms','off-note':'internalNote'};
      Object.entries(map).forEach(([id,key]) => {
        const el = document.getElementById(id);
        if (el) this._wizardData[key] = el.value;
      });
    }
    const d = this._wizardData;
    if (!d.customerId) { showToast('Välj en kund'); return; }
    const cleanLines = this._editLines.filter(l => {
      if (l.type==='text')    return (l.blockTitle||'').trim()||(l.text||'').trim();
      if (l.type==='service') return true;
      return (l.description||'').trim()||(l.unitPrice||0)>0;
    });
    if (!cleanLines.some(l=>l.type!=='text')) { showToast('Lägg till minst en offertrad eller tjänst'); return; }
    const cleanExtras = this._editExtras.filter(e=>(e.description||'').trim()||(e.unitPrice||0)>0);
    const now  = new Date().toISOString();
    const data = {
      customerId:   d.customerId,
      title:        d.title        || '',
      summary:      d.summary      || '',
      scope:        d.scope        || '',
      includes:     d.includes     || '',
      excludes:     d.excludes     || '',
      lines:        cleanLines.map(l=>l.type==='manual'?{...l,total:Math.round((l.qty!=null?l.qty:1)*(l.unitPrice||0))}:{...l}),
      extras:       cleanExtras,
      validUntil:   d.validUntil   || '',
      paymentTerms: d.paymentTerms || '',
      validityText: d.validityText || '',
      generalTerms: d.generalTerms || '',
      internalNote: d.internalNote || '',
      discount:     this._discount || {type:'percent', value:0},
      updatedAt:    now
    };
    const offerId = this._editOfferId;
    if (!offerId) {
      const newOff = Object.assign(Schema.offer(), data, {
        id: newId(state.offers,'OFF'), status:'utkast', timeline: [],
        createdAt: d.date ? d.date + 'T00:00:00.000Z' : now
      });
      OfferDetailPage._logEvt(newOff, 'create', 'Offert skapad');
      state.offers.push(newOff);
      persist();
      this._wizardClose();
      Router.showPage('pg-offer');
      showToast('Offert ' + newOff.id + ' skapad');
    } else {
      const idx = (state.offers||[]).findIndex(o=>o.id===offerId);
      if (idx < 0) return;
      const updated = Object.assign({}, state.offers[idx], data);
      OfferDetailPage._logEvt(updated, 'edit', 'Offert redigerad');
      state.offers[idx] = updated;
      persist();
      this._wizardClose();
      OfferDetailPage.render({offerId});
      showToast('Offert uppdaterad');
    }
  }
};


/* ── PART 10: OfferDetailPage ─────────── */
const OfferDetailPage = {
  offerId: null,

  render(params) {
    const el = document.getElementById('pg-offer-detail-content');
    if (!el) return;
    const id = params && params.offerId;
    this.offerId = id;
    const off = id ? getOff(id) : null;
    if (!off) { el.innerHTML = `<div class="empty">${ic('file-text',32)}<h3>Offert hittades inte</h3></div>`; return; }

    const cu       = getCu(off.customerId);
    const allLines = off.lines || [];
    const prLines  = allLines.filter(l => l.type !== 'text');
    const txtBlks  = allLines.filter(l => l.type === 'text');
    const extras   = off.extras || [];

    const rawExVat = Math.round(
      prLines.reduce((s,l) => s + (l.exVat||l.total||0), 0) +
      extras.reduce((s,e) => s + Math.round((e.qty||1)*(e.unitPrice||0)), 0)
    );
    const _disc   = off.discount || {type:'percent', value:0};
    const discAmt = _disc.value
      ? (_disc.type==='percent' ? Math.round(rawExVat * Math.min(_disc.value,100) / 100) : Math.min(Math.round(_disc.value), rawExVat))
      : 0;
    const exVat  = rawExVat - discAmt;
    const vat    = Math.round(exVat * 0.25);
    const incVat = exVat + vat;
    const rutAmt = Math.round(prLines.filter(l=>l.type==='service').reduce((s,l)=>s+(l.rutAmount||0),0));
    const cust   = incVat - rutAmt;

    const cuName = cu ? CustomerService.displayName(cu) : '—';
    const now2 = Date.now();
    const validDate = off.validUntil ? new Date(off.validUntil).getTime() : null;
    const daysLeft  = validDate ? Math.round((validDate - now2) / 86400000) : null;
    const expiring  = daysLeft !== null && daysLeft >= 0 && daysLeft <= 7;

    el.innerHTML = `
      <div class="off-detail-hero">
        <div class="off-detail-hero-nav">
          <button type="button" class="off-hero-btn" onclick="Router.back()">${ic('arrow-left',12)} Tillbaka</button>
          <div style="font-weight:900;font-size:13px;color:var(--navy);background:var(--navy);color:#fff;padding:3px 9px;border-radius:5px;letter-spacing:-0.3px;user-select:none;">VIFT</div>
          <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;">
            ${sbdg(off.status)}
            ${CustomSelect.render('offd-status',{
              options:[{v:'utkast',l:'Utkast'},{v:'skickad',l:'Skickad'},{v:'väntar',l:'Väntar svar'},{v:'godkänd',l:'Godkänd'},{v:'nekad',l:'Nekad'},{v:'utgången',l:'Utgången'}],
              value:off.status, onchange:'OfferDetailPage.setStatus(this.value)'
            })}
          </div>
        </div>
        <div class="off-detail-hero-id">${off.id}</div>
        <div class="off-detail-hero-title">${off.title||'Offert'}</div>
        <div class="off-detail-hero-cu">${ic('user',13)} ${cuName}</div>
        <div class="off-detail-hero-price">
          <span class="off-detail-hero-cust-val">${fmt(cust)} kr</span>
          <div class="off-detail-hero-cust-sub">kundpris inkl. moms${rutAmt?' · RUT/ROT −'+fmt(rutAmt)+' kr':''}</div>
          ${off.validUntil?`<div class="off-detail-hero-validity${expiring?' expiring':''}">${ic('calendar',10)} Giltig till ${fmtDate(off.validUntil)}${expiring?' · ⚠️ '+daysLeft+' dagar kvar':''}</div>`:''}
        </div>
        <div class="off-detail-hero-actions">
          <button type="button" class="off-hero-btn" onclick="OffersPage.openEdit('${off.id}')">${ic('pencil',12)} Redigera</button>
          <button type="button" class="off-hero-btn" onclick="OfferDetailPage.duplicate('${off.id}')">${ic('copy',12)} Duplicera</button>
          ${off.status==='utkast'?`<button type="button" class="off-hero-btn off-hero-btn--primary" onclick="OfferDetailPage.showSendModal('${off.id}')">${ic('send',12)} Skicka offert</button>`:''}
          ${(off.status==='skickad'||off.status==='väntar')?`<button type="button" class="off-hero-btn off-hero-btn--green" onclick="OfferDetailPage.setStatus('godkänd')">${ic('check-circle',12)} Godkänd</button><button type="button" class="off-hero-btn off-hero-btn--red" onclick="OfferDetailPage.setStatus('nekad')">${ic('x-circle',12)} Nekad</button>`:''}
          <button type="button" class="off-hero-btn" onclick="OfferDetailPage.printPdf('${off.id}')">${ic('printer',12)} PDF</button>
          ${off.status==='godkänd'&&!off.workOrderId?`<button type="button" class="off-hero-btn off-hero-btn--green" onclick="OfferDetailPage.createAO()">${ic('clipboard-list',12)} Skapa AO</button>`:''}
          ${off.workOrderId?`<button type="button" class="off-hero-btn" onclick="Router.showPage('pg-ao-detail',{aoId:'${off.workOrderId}'})">${ic('clipboard-list',12)} AO: ${off.workOrderId}</button>`:''}
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>${ic('user',13)} Kund & offertinfo</h3></div>
        <div class="card-body" style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px;">
          <div class="dr"><span class="dk">Kund</span><span class="dv">${cuName}</span></div>
          ${cu&&cu.email?`<div class="dr"><span class="dk">E-post</span><span class="dv">${cu.email}</span></div>`:'<div></div>'}
          ${cu?`<div class="dr"><span class="dk">Adress</span><span class="dv">${[cu.address,cu.zip,cu.city].filter(Boolean).join(', ')||'—'}</span></div>`:'<div></div>'}
          ${cu&&cu.phone?`<div class="dr"><span class="dk">Telefon</span><span class="dv">${cu.phone}</span></div>`:'<div></div>'}
          <div class="dr"><span class="dk">Datum</span><span class="dv">${fmtDate(off.createdAt)}</span></div>
          ${off.validUntil?`<div class="dr"><span class="dk">Giltig till</span><span class="dv">${fmtDate(off.validUntil)}</span></div>`:'<div></div>'}
          ${off.paymentTerms?`<div class="dr"><span class="dk">Betalning</span><span class="dv">${off.paymentTerms}</span></div>`:'<div></div>'}
          ${off.validityText?`<div class="dr"><span class="dk">Giltighetstid</span><span class="dv">${off.validityText}</span></div>`:'<div></div>'}
        </div>
      </div>

      ${off.summary||off.scope||off.includes||off.excludes?`
      <div class="card">
        <div class="card-header"><h3>${ic('align-left',13)} Uppdragsbeskrivning</h3></div>
        <div class="card-body">
          ${off.summary?`<div class="off-field-stack"><div class="off-field-label">Sammanfattning</div><div class="off-field-content off-rt">${OfferDetailPage._renderText(off.summary)}</div></div>`:''}
          ${off.scope?`<div class="off-field-stack"><div class="off-field-label">Uppdragets omfattning</div><div class="off-field-content off-rt">${OfferDetailPage._renderText(off.scope)}</div></div>`:''}
          ${off.includes||off.excludes?`<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px;">
            ${off.includes?`<div class="off-field-stack" style="border-bottom:none;"><div class="off-field-label">Vad ingår</div><div class="off-field-content off-rt">${OfferDetailPage._renderText(off.includes)}</div></div>`:'<div></div>'}
            ${off.excludes?`<div class="off-field-stack" style="border-bottom:none;"><div class="off-field-label">Vad ingår ej</div><div class="off-field-content off-rt" style="color:var(--mt);">${OfferDetailPage._renderText(off.excludes)}</div></div>`:'<div></div>'}
          </div>`:''}
        </div>
      </div>`:''}

      <div class="card">
        <div class="card-header"><h3>${ic('file-text',13)} Offertrader</h3></div>
        ${prLines.length===0
          ? '<p style="padding:12px 14px;font-size:12px;color:var(--mt);">Inga rader</p>'
          : prLines.map(l => {
              if (l.type === 'service') {
                const lExVat   = l.exVat || 0;
                const lVat     = Math.round(lExVat * (l.vatRate||25) / 100);
                const lIncVat  = lExVat + lVat;
                const lRut     = l.rutAmount || 0;
                const lCust    = lIncVat - lRut;
                return `<div style="padding:10px 14px;border-bottom:1px solid var(--bg);border-left:3px solid var(--navy);">
                  <div style="font-size:10px;font-weight:800;text-transform:uppercase;color:var(--navy);letter-spacing:.5px;margin-bottom:4px;">${ic('zap',11)} ${l.templateName||'Tjänst'}</div>
                  ${l.description?`<div style="font-size:12px;color:var(--mt);margin-bottom:6px;font-style:italic;">${l.description}</div>`:''}
                  ${l.calculationNote?`<div style="font-size:11px;color:var(--mt);margin-bottom:4px;">${l.calculationNote}</div>`:''}
                  <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--br);">
                    <div style="font-size:12px;color:var(--mt);">Summa ex. moms: <strong>${fmt(lExVat)} kr</strong></div>
                    <div style="font-size:12px;color:var(--mt);">Moms ${l.vatRate||25}%: <strong>${fmt(lVat)} kr</strong></div>
                    <div style="font-size:13px;font-weight:800;color:var(--navy);margin-top:4px;">Totalt inkl. moms: ${fmt(lIncVat)} kr</div>
                    ${lRut?`<div style="margin-top:6px;padding:8px 10px;background:rgba(34,197,94,.08);border-radius:var(--rs);border:1px solid rgba(34,197,94,.3);">
                      <div style="font-size:12px;color:var(--grn);font-weight:700;">RUT/ROT-reduktion: -${fmt(lRut)} kr</div>
                      <div style="font-size:13px;font-weight:800;color:var(--grn);">Kundpris efter avdrag: ${fmt(lCust)} kr</div>
                      <div style="font-size:10px;color:var(--mt);margin-top:3px;">* Avdraget är preliminärt och förutsätter att kunden har rätt till skattereduktion.</div>
                    </div>`:''}
                  </div>
                </div>`;
              }
              return `<div style="padding:8px 14px;border-bottom:1px solid var(--bg);display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                <div style="flex:1;">
                  <div style="font-size:13px;font-weight:700;">${l.description||'—'}</div>
                  <div style="font-size:11px;color:var(--mt);">${l.qty||1} ${l.unit||'st'} × ${fmt(l.unitPrice||0)} kr ex. moms</div>
                </div>
                <div style="font-size:13px;font-weight:700;color:var(--navy);">${fmt(l.total||Math.round((l.qty||1)*(l.unitPrice||0)))} kr</div>
              </div>`;
            }).join('')}
        <div class="off-detail-sum" style="margin:0;border-radius:0 0 var(--rs) var(--rs);border-left:none;border-right:none;border-bottom:none;">
          <div class="off-detail-sum-row"><span class="dk">Summa ex. moms</span><strong>${fmt(rawExVat)} kr</strong></div>
          ${discAmt?`<div class="off-detail-sum-row disc"><span class="dk">Rabatt (${_disc.type==='percent'?_disc.value+'%':fmt(_disc.value)+' kr'})</span><span>−${fmt(discAmt)} kr</span></div>`:''}
          <div class="off-detail-sum-row"><span class="dk">Moms 25 %</span><span>${fmt(vat)} kr</span></div>
          <div class="off-detail-sum-row"><span class="dk">Totalt inkl. moms</span><strong>${fmt(incVat)} kr</strong></div>
          ${rutAmt?`<div class="off-detail-sum-row rut"><span>RUT/ROT-reduktion</span><span>−${fmt(rutAmt)} kr</span></div>`:''}
          <div class="off-detail-sum-final">
            <span class="off-detail-sum-final-lbl">${rutAmt?'Kundpris inkl. moms':'Totalt inkl. moms'}</span>
            <span class="off-detail-sum-final-val">${fmt(cust)} kr</span>
          </div>
          ${rutAmt?`<div style="font-size:10px;color:var(--mt);margin-top:6px;">* Avdraget är preliminärt och förutsätter att kunden har rätt till skattereduktion.</div>`:''}
        </div>
      </div>

      ${extras.length?`<div class="card">
        <div class="card-header"><h3>${ic('plus',13)} Tillval</h3></div>
        ${extras.map(e=>`<div style="padding:8px 14px;border-bottom:1px solid var(--bg);display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <div><div style="font-size:13px;font-weight:600;">${e.description||'—'}</div>
          <div style="font-size:11px;color:var(--mt);">${e.qty||1} ${e.unit||'st'} × ${fmt(e.unitPrice||0)} kr</div></div>
          <div style="font-size:13px;font-weight:700;color:var(--navy);">${fmt(Math.round((e.qty||1)*(e.unitPrice||0)))} kr</div>
        </div>`).join('')}
      </div>`:''}

      ${txtBlks.filter(tb=>tb.blockTitle||tb.text).map(tb=>`
      <div class="card">
        ${tb.blockTitle?`<div class="card-header"><h3>${ic('align-left',13)} ${tb.blockTitle}</h3></div>`:''}
        <div class="card-body"><p style="white-space:pre-wrap;font-size:13px;line-height:1.6;">${tb.text||''}</p></div>
      </div>`).join('')}

      ${off.generalTerms?`<div class="card">
        <div class="card-header"><h3>${ic('file-text',13)} Allmänna villkor</h3></div>
        <div class="card-body"><p style="font-size:12px;color:var(--mt);white-space:pre-wrap;line-height:1.6;">${off.generalTerms}</p></div>
      </div>`:''}

      ${off.internalNote?`<div class="nbox">${ic('lock',12)} <strong>Intern:</strong> ${off.internalNote}</div>`:''}

      ${OfferDetailPage._salesAssistantHtml(off)}

      ${OfferDetailPage._timelineHtml(off)}`;
  },

  setStatus(status) {
    const off = getOff(this.offerId);
    if (!off) return;
    const prev = off.status;
    off.status    = status;
    off.updatedAt = new Date().toISOString();
    if (status === 'skickad') off.sentAt     = new Date().toISOString();
    if (status === 'godkänd' || status === 'nekad') off.answeredAt = new Date().toISOString();
    this._logEvt(off, 'status', 'Status: ' + statusLabel(prev) + ' → ' + statusLabel(status));
    persist();
    this.render({offerId: this.offerId});
    showToast('Status: ' + statusLabel(status));
  },

  duplicate(offerId) {
    const off = getOff(offerId);
    if (!off) return;
    const now = new Date().toISOString();
    const newOff = Object.assign({}, off, {
      id: newId(state.offers, 'OFF'), status: 'utkast',
      title: (off.title || 'Offert') + ' (kopia)',
      sentAt: '', answeredAt: '', workOrderId: '',
      createdAt: now, updatedAt: now
    });
    state.offers.push(newOff);
    persist();
    Router.showPage('pg-offer-detail', {offerId: newOff.id});
    showToast('Offert ' + newOff.id + ' skapad som kopia');
  },

  createAO() {
    const off = getOff(this.offerId);
    if (!off) return;
    const prLines = (off.lines||[]).filter(l => l.type !== 'text');
    const svcNames = prLines
      .filter(l => l.type === 'service')
      .map(l => l.templateName)
      .filter(Boolean);
    const aoTitle = off.title
      || (svcNames.length ? svcNames.join(', ') : 'Arbete enligt offert ' + off.id);
    const desc = [off.scope, off.summary].filter(Boolean).join('\n\n')
      || prLines.map(l => l.type==='service' ? l.templateName : l.description).filter(Boolean).join(', ');
    const ao = WorkOrderService.create({
      title:       aoTitle,
      description: desc,
      customerId:  off.customerId,
      propertyId:  off.propertyId || '',
      address:     '',
      status:      'nytt',
      priority:    'normal',
      priceType:   'fast',
      fixedPrice:  OffersPage._offerExVat(off),
      offerId:     off.id,
      staff: [], checklist: [], materials: [], notes: [], timeEntries: []
    });
    off.workOrderId = ao.id;
    off.updatedAt   = new Date().toISOString();
    this._logEvt(off, 'ao', 'Arbetsorder ' + ao.id + ' skapad från offert');
    persist();
    this.render({offerId: this.offerId});
    showToast('AO ' + ao.id + ' skapad');
    setTimeout(() => Router.showPage('pg-ao-detail', {aoId: ao.id}), 800);
  },

  /* ── Händelselogg ─── */
  _logEvt(off, type, text) {
    if (!off) return;
    if (!Array.isArray(off.timeline)) off.timeline = [];
    const user = (typeof state !== 'undefined' && state.currentUser) ? (state.currentUser.name || state.currentUser.username || 'Admin') : 'Admin';
    off.timeline.push({ ts: new Date().toISOString(), type, text, user });
  },

  _timelineHtml(off) {
    const tl = (off.timeline || []).slice().reverse();
    const typeIcon = {create:'plus-circle', edit:'pencil', status:'refresh-cw', send:'send', pdf:'printer', comment:'message-square', ao:'clipboard-list', ring:'phone', email:'mail', followup:'bell', reminder:'clock', price:'dollar-sign', change:'edit-3', verbal:'handshake', reason:'help-circle'};
    const typeColor = {create:'var(--navy)', edit:'var(--mt)', status:'var(--or)', send:'var(--blue)', pdf:'#6366f1', comment:'#0891b2', ao:'var(--grn)', ring:'var(--sky)', email:'var(--blue)', followup:'var(--or)', reminder:'var(--yl)', price:'#b45309', change:'var(--pu)', verbal:'var(--gr)', reason:'var(--mt)'};
    const id = off.id;
    const isSent = off.status === 'skickad' || off.status === 'väntar';
    return `<div class="card" style="margin-top:8px;">
      <div class="card-header">
        <h3 style="display:flex;align-items:center;gap:6px;">${ic('activity',13)} Säljarbete & tidslinje</h3>
      </div>
      <div class="off-tl-action-bar">
        <span style="font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.4px;align-self:center;white-space:nowrap;">Åtgärd:</span>
        <button type="button" class="off-tl-action-btn" onclick="OfferDetailPage._quickAction('${id}','ring')">📞 Ring kund</button>
        <button type="button" class="off-tl-action-btn" onclick="OfferDetailPage._quickAction('${id}','email')">✉️ Mailade kund</button>
        <button type="button" class="off-tl-action-btn" onclick="OfferDetailPage._quickAction('${id}','followup')">🔔 Uppföljning</button>
        <button type="button" class="off-tl-action-btn" onclick="OfferDetailPage._quickAction('${id}','reminder')">⏰ Påminnelse</button>
        ${isSent?`<button type="button" class="off-tl-action-btn" onclick="OfferDetailPage._quickAction('${id}','price')">💰 Prisförhandling</button>`:''}
        ${isSent?`<button type="button" class="off-tl-action-btn" onclick="OfferDetailPage._quickAction('${id}','change')">✏️ Kund vill ändra</button>`:''}
        ${isSent?`<button type="button" class="off-tl-action-btn" onclick="OfferDetailPage._quickAction('${id}','verbal')" style="background:rgba(21,128,61,.08);color:var(--gr);">🤝 Muntligt godkänd</button>`:''}
        ${off.status==='nekad'?`<button type="button" class="off-tl-action-btn" onclick="OfferDetailPage._quickAction('${id}','reason')">❓ Orsak nekad</button>`:''}
        ${off.status==='utkast'?`<button type="button" class="off-tl-action-btn" onclick="OfferDetailPage._quickAction('${id}','tip')">💡 Intern notering</button>`:''}
      </div>
      <div style="padding:0;">
        ${tl.length===0
          ? `<p style="padding:12px 14px;font-size:12px;color:var(--mt);">Inga händelser ännu.</p>`
          : tl.map(e => `<div class="off-tl-item">
              <span class="off-tl-dot" style="color:${typeColor[e.type]||'var(--mt)'};">${ic(typeIcon[e.type]||'circle',10)}</span>
              <div class="off-tl-body">
                <div class="off-tl-text">${e.text||''}</div>
                <div class="off-tl-meta">${fmtDate(e.ts)} · ${e.user||''}</div>
              </div>
            </div>`).join('')}
        <div class="off-tl-comment">
          <input id="off-tl-inp" placeholder="Lägg till intern kommentar…" style="flex:1;">
          <button class="btn bs bxs" onclick="OfferDetailPage._addComment('${off.id}')">${ic('send',11)} Spara</button>
        </div>
      </div>
    </div>`;
  },

  _quickAction(offerId, type) {
    const off = getOff(offerId);
    if (!off) return;
    const labels = {ring:'Ringde kund', email:'Mailade kund', followup:'Uppföljning inbokad', reminder:'Påminnelse satt', price:'Prisförhandling', change:'Kund vill ändra', verbal:'Muntligt godkänd', reason:'Orsak till nekad offert', tip:'Intern notering'};
    const label = labels[type] || type;
    // Verbal approval: auto-log as verbal and suggest status change
    const isVerbal = type === 'verbal';
    Modal.open({
      title: label,
      body: `<div class="fg"><label>${label}</label><textarea id="qa-text" rows="3" placeholder="Anteckning…"></textarea></div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          const txt = (document.getElementById('qa-text')?.value || '').trim();
          this._logEvt(off, type, label + (txt ? ': ' + txt : ''));
          off.updatedAt = new Date().toISOString();
          if (type === 'verbal') {
            off.status = 'godkänd';
            off.answeredAt = new Date().toISOString();
            this._logEvt(off, 'status', 'Status: Skickad → Godkänd (muntligt)');
          }
          persist();
          Modal.close();
          this.render({offerId});
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('qa-text')?.focus(), 80);
  },

  _addComment(offerId) {
    const inp = document.getElementById('off-tl-inp');
    const txt = (inp?.value || '').trim();
    if (!txt) return;
    const off = getOff(offerId);
    if (!off) return;
    this._logEvt(off, 'comment', txt);
    off.updatedAt = new Date().toISOString();
    persist();
    this.render({offerId});
    showToast('Kommentar sparad');
  },

  /* ── Text rendering ─── */
  _renderText(raw) {
    if (!raw) return '';
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const lines = raw.split('\n');
    let html = '', inList = false;
    for (let line of lines) {
      // Bold: **text**
      line = esc(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      if (line.startsWith('## ')) {
        if (inList) { html += '</ul>'; inList = false; }
        html += `<div style="font-size:12px;font-weight:800;color:var(--navy);margin:6px 0 2px;">${line.slice(3)}</div>`;
      } else if (line.startsWith('- ')) {
        if (!inList) { html += '<ul class="off-rt-list">'; inList = true; }
        html += `<li>${line.slice(2)}</li>`;
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        if (line.trim()) html += `<div>${line}</div>`;
      }
    }
    if (inList) html += '</ul>';
    return html;
  },

  /* ── AI Säljassistent ─── */
  _salesAssistantHtml(off) {
    const now = Date.now();
    const sentDate  = off.sentAt ? new Date(off.sentAt).getTime() : null;
    const daysSent  = sentDate  ? Math.round((now - sentDate)  / 86400000) : null;
    const validDate = off.validUntil ? new Date(off.validUntil).getTime() : null;
    const daysLeft  = validDate ? Math.round((validDate - now) / 86400000) : null;
    const prLines   = (off.lines||[]).filter(l => l.type !== 'text');
    const extras    = off.extras||[];
    const rawExVat  = Math.round(prLines.reduce((s,l)=>s+(l.exVat||l.total||0),0)+extras.reduce((s,e)=>s+Math.round((e.qty||1)*(e.unitPrice||0)),0));
    const _disc     = off.discount||{type:'percent',value:0};
    const discAmt   = _disc.value?(_disc.type==='percent'?Math.round(rawExVat*Math.min(_disc.value,100)/100):Math.min(Math.round(_disc.value),rawExVat)):0;
    const exVat     = rawExVat - discAmt;
    const incVat    = exVat + Math.round(exVat*0.25);
    const rutAmt    = Math.round(prLines.filter(l=>l.type==='service').reduce((s,l)=>s+(l.rutAmount||0),0));
    const cust      = incVat - rutAmt;
    const tips = [];

    if (off.status === 'utkast') {
      if (!prLines.length) {
        tips.push({icon:'alert-circle', color:'var(--rd)', title:'Offerten är tom', body:'Lägg till minst en tjänst eller rad i steg 2 innan du skickar.', cta:'Redigera', ctaFn:`OffersPage.openEdit('${off.id}')`});
      } else if (!off.scope && !off.summary) {
        tips.push({icon:'edit-3', color:'var(--or)', title:'Lägg till uppdragsbeskrivning', body:'En tydlig uppdragsbeskrivning ökar vinstchansen avsevärt. Klicka Redigera och använd textgeneratorn.', cta:'Redigera & generera text', ctaFn:`OffersPage.openEdit('${off.id}')`});
      } else {
        tips.push({icon:'send', color:'var(--blue)', title:'Klar att skicka?', body:'Offerten ser komplett ut. Skicka den till kunden för att komma vidare i affären.', cta:'Skicka offert', ctaFn:`OfferDetailPage.showSendModal('${off.id}')`});
      }
    }

    if (off.status === 'skickad' || off.status === 'väntar') {
      if (daysSent !== null && daysSent > 7) {
        tips.push({icon:'alert-circle', color:'var(--rd)', title:`Skickad för ${daysSent} dagar sedan — risk för förlust`, body:'Äldre offerter konverterar sämre. Ring kunden direkt och håll liv i dialogen.', cta:'Logga samtal', ctaFn:`OfferDetailPage._quickAction('${off.id}','ring')`});
      } else if (daysSent !== null && daysSent >= 3) {
        tips.push({icon:'bell', color:'var(--or)', title:`Dags att följa upp (${daysSent} dagar sedan)`, body:'Skicka ett vänligt uppföljningsmejl och fråga om kunden har frågor kring offerten.', cta:'Logga uppföljning', ctaFn:`OfferDetailPage._quickAction('${off.id}','followup')`});
      }
      if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 5) {
        tips.push({icon:'clock', color:'var(--or)', title:`Giltighet utgår om ${daysLeft} dag${daysLeft===1?'':'ar'}`, body:'Kontakta kunden nu och förläng giltigheten om nödvändigt för att inte tappa affären.'});
      }
      if (rutAmt > 0) {
        tips.push({icon:'dollar-sign', color:'var(--gr)', title:'Lyft RUT/ROT-avdraget i uppföljningen', body:`Kunden betalar bara ${(cust).toLocaleString('sv-SE')} kr efter avdraget — en konkret och övertygande säljpunkt.`});
      }
      if (cust > 20000) {
        tips.push({icon:'phone', color:'var(--navy)', title:'Stor affär — personlig kontakt rekommenderas', body:'För offerter över 20 000 kr ökar chansen med ett personligt samtal snarare än enbart e-post.'});
      }
    }

    if (off.status === 'nekad') {
      tips.push({icon:'help-circle', color:'var(--mt)', title:'Analysera varför affären föll', body:'Var det pris, timing, konkurrent eller omfattning? Logga orsaken för framtida lärdomar.', cta:'Logga orsak', ctaFn:`OfferDetailPage._quickAction('${off.id}','reason')`});
      tips.push({icon:'refresh-cw', color:'var(--blue)', title:'Föreslå nytt erbjudande', body:'Duplicera och justera — antingen priset, villkoren eller tjänsternas omfattning. Många affärer återvinns med rätt anpassning.', cta:'Duplicera offert', ctaFn:`OfferDetailPage.duplicate('${off.id}')`});
    }

    if (off.status === 'godkänd' && !off.workOrderId) {
      tips.push({icon:'clipboard-list', color:'var(--gr)', title:'Skapa arbetsorder nu', body:'Offerten är godkänd — starta jobbet genom att skapa en arbetsorder direkt från offerten.', cta:'Skapa AO', ctaFn:`OfferDetailPage.createAO()`});
    }

    if (!tips.length) return '';

    return `<div class="card" style="border-left:3px solid var(--sky);margin-top:0;">
      <div class="card-header">
        <h3 style="display:flex;align-items:center;gap:6px;">${ic('zap',13)} Säljassistent</h3>
      </div>
      <div class="card-body" style="padding:6px 14px 10px;display:flex;flex-direction:column;gap:8px;">
        ${tips.map(t=>`<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 10px;background:var(--bg);border-radius:var(--rs);">
          <span style="color:${t.color};flex-shrink:0;margin-top:1px;">${ic(t.icon,14)}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:700;color:var(--navy);margin-bottom:2px;">${t.title}</div>
            <div style="font-size:11px;color:var(--mt);line-height:1.4;">${t.body}</div>
            ${t.cta?`<button type="button" class="btn bs bxs" style="margin-top:6px;font-size:10px;" onclick="${t.ctaFn}">${t.cta}</button>`:''}
          </div>
        </div>`).join('')}
      </div>
    </div>`;
  },

  /* ── PDF/Print ─── */
  printPdf(offerId) {
    const off = getOff(offerId);
    if (!off) return;
    const cu    = getCu(off.customerId);
    const cuName= cu ? CustomerService.displayName(cu) : '—';
    const cuAddr= cu ? [cu.address, cu.zip, cu.city].filter(Boolean).join(', ') : '';
    const s     = state.settings || {};
    const co    = s.companyName    || 'VIFT Fastighetsservice & Förvaltning';
    const coPhone = s.companyPhone || '';
    const coEmail = s.companyEmail || '';
    const coAddr  = s.companyAddress || '';
    const orgNr   = s.orgNr || '';

    const prLines  = (off.lines||[]).filter(l=>l.type!=='text');
    const txtBlks  = (off.lines||[]).filter(l=>l.type==='text'&&(l.blockTitle||l.text));
    const extras   = off.extras||[];
    const rawExVat = Math.round(prLines.reduce((s,l)=>s+(l.exVat||l.total||0),0)+extras.reduce((s,e)=>s+Math.round((e.qty||1)*(e.unitPrice||0)),0));
    const _disc    = off.discount||{type:'percent',value:0};
    const discAmt  = _disc.value?(_disc.type==='percent'?Math.round(rawExVat*Math.min(_disc.value,100)/100):Math.min(Math.round(_disc.value),rawExVat)):0;
    const exVat    = rawExVat - discAmt;
    const vat      = Math.round(exVat*0.25);
    const incVat   = exVat+vat;
    const rutAmt   = Math.round(prLines.filter(l=>l.type==='service').reduce((s,l)=>s+(l.rutAmount||0),0));
    const cust     = incVat - rutAmt;
    const fmt2     = n => (n||0).toLocaleString('sv-SE');
    const esc2     = s => (s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/&/g,'&amp;');

    // Service line rows — customer-friendly (no internal kalkyl)
    const lineRows = prLines.map(l => {
      if (l.type==='service') {
        const lExVat=l.exVat||0, lVat=Math.round(lExVat*(l.vatRate||25)/100);
        return `<tr>
          <td><strong>${esc2(l.templateName||'Tjänst')}</strong>${l.description&&l.description!==l.templateName?'<br><span style="color:#555;font-size:11px;">'+esc2(l.description)+'</span>':''}</td>
          <td style="text-align:right;white-space:nowrap;">${fmt2(lExVat)} kr</td>
          <td style="text-align:right;white-space:nowrap;">${l.vatRate||25}%</td>
          <td style="text-align:right;white-space:nowrap;font-weight:600;">${fmt2(lExVat+lVat)} kr</td>
        </tr>`;
      }
      const tot=Math.round((l.qty||1)*(l.unitPrice||0));
      return `<tr>
        <td>${esc2(l.description||'—')}<br><span style="color:#666;font-size:11px;">${l.qty||1} ${l.unit||'st'} × ${fmt2(l.unitPrice||0)} kr ex. moms</span></td>
        <td style="text-align:right;white-space:nowrap;">${fmt2(tot)} kr</td>
        <td style="text-align:right;white-space:nowrap;">25%</td>
        <td style="text-align:right;white-space:nowrap;font-weight:600;">${fmt2(tot+Math.round(tot*0.25))} kr</td>
      </tr>`;
    }).join('');

    const extrasRows = extras.length ? extras.map(e => {
      const tot=Math.round((e.qty||1)*(e.unitPrice||0));
      return `<tr style="color:#555;font-style:italic;">
        <td>${esc2(e.description||'Tillval')}<br><span style="font-size:11px;">${e.qty||1} ${e.unit||'st'} × ${fmt2(e.unitPrice||0)} kr</span></td>
        <td style="text-align:right;">${fmt2(tot)} kr</td><td style="text-align:right;">25%</td>
        <td style="text-align:right;">${fmt2(tot+Math.round(tot*0.25))} kr</td></tr>`;
    }).join('') : '';

    const scopeHtml = off.scope ? `<div class="section"><h4>Uppdragets omfattning</h4><p>${esc2(off.scope).replace(/\n/g,'<br>')}</p></div>` : '';
    const inclExclHtml = (off.includes||off.excludes) ? `
      <div style="display:flex;gap:24px;margin-bottom:16px;">
        ${off.includes?`<div style="flex:1;"><h4 style="font-size:10px;text-transform:uppercase;color:#888;letter-spacing:.5px;margin-bottom:6px;">Ingår i uppdraget</h4><p style="font-size:12px;white-space:pre-wrap;">${esc2(off.includes)}</p></div>`:''}
        ${off.excludes?`<div style="flex:1;"><h4 style="font-size:10px;text-transform:uppercase;color:#888;letter-spacing:.5px;margin-bottom:6px;">Ingår ej</h4><p style="font-size:12px;color:#666;white-space:pre-wrap;">${esc2(off.excludes)}</p></div>`:''}
      </div>` : '';
    const txtBlksHtml = txtBlks.map(tb=>`<div class="section">${tb.blockTitle?`<h4>${esc2(tb.blockTitle)}</h4>`:''}${tb.text?`<p>${esc2(tb.text).replace(/\n/g,'<br>')}</p>`:''}</div>`).join('');
    const extrasHtml  = extras.length ? `<h4 style="font-size:10px;text-transform:uppercase;color:#888;letter-spacing:.5px;margin:16px 0 6px;">Tillval (ej inkluderat i totalpris)</h4><table><thead><tr><th>Tillval</th><th style="text-align:right;">Ex. moms</th><th style="text-align:right;">Moms</th><th style="text-align:right;">Inkl. moms</th></tr></thead><tbody>${extrasRows}</tbody></table>` : '';

    const footerContact = [coPhone?'Tel: '+coPhone:'', coEmail?'E-post: '+coEmail:'', orgNr?'Org.nr: '+orgNr:''].filter(Boolean).join('  ·  ');

    const html = `<!DOCTYPE html><html lang="sv"><head><meta charset="UTF-8"><title>Offert ${off.id} – ${cuName}</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box;}
      body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1a1a1a;padding:32px 36px;max-width:800px;margin:0 auto;}
      .hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:18px;border-bottom:3px solid #0d2b4e;}
      /* VIFT logo — ersätt src i <img> med er logotypfil för skarpt bruk */
      .logo-img{height:44px;width:auto;display:block;}
      .logo-wordmark{background:#0d2b4e;color:#fff;font-weight:900;font-size:22px;padding:7px 16px;border-radius:6px;letter-spacing:-0.5px;display:inline-block;}
      .logo-tagline{font-size:10px;color:#555;margin-top:3px;letter-spacing:.3px;}
      .logo-sub{font-size:10px;color:#666;margin-top:4px;}
      .offer-id{font-size:24px;font-weight:900;color:#0d2b4e;}
      .offer-sub{color:#666;font-size:11px;margin-top:3px;}
      .parties{display:flex;gap:32px;margin-bottom:20px;}
      .party{flex:1;}
      .party h4{font-size:10px;text-transform:uppercase;color:#888;letter-spacing:.5px;margin-bottom:6px;border-bottom:1px solid #eee;padding-bottom:4px;}
      .party p{font-size:12px;line-height:1.7;}
      table{width:100%;border-collapse:collapse;margin-bottom:20px;font-size:12px;}
      th{background:#0d2b4e;color:#fff;padding:8px 10px;text-align:left;font-size:11px;font-weight:600;}
      td{padding:8px 10px;border-bottom:1px solid #f0f0f0;vertical-align:top;}
      tr:nth-child(even) td{background:#fafafa;}
      .section{margin-bottom:16px;}
      .section h4{font-size:10px;text-transform:uppercase;color:#888;letter-spacing:.5px;margin-bottom:6px;}
      .section p{font-size:12px;line-height:1.7;color:#333;}
      .totals{display:flex;justify-content:flex-end;margin-bottom:20px;}
      .totals-inner{min-width:280px;}
      .tot-row{display:flex;justify-content:space-between;padding:4px 0;font-size:13px;border-bottom:1px solid #f0f0f0;}
      .tot-row:last-child{border-bottom:none;}
      .tot-final{font-size:16px;font-weight:900;color:#0d2b4e;padding:10px 0 6px;border-top:2px solid #0d2b4e;margin-top:4px;display:flex;justify-content:space-between;}
      .rut-box{background:#f0fdf4;border:1.5px solid #86efac;border-radius:8px;padding:12px 14px;margin-top:10px;}
      .rut-box-title{font-weight:700;color:#15803d;margin-bottom:4px;font-size:13px;}
      .rut-price{font-size:20px;font-weight:900;color:#15803d;margin-top:4px;}
      .rut-note{font-size:10px;color:#666;margin-top:4px;}
      .terms{margin-top:20px;border-top:1px solid #e0e0e0;padding-top:14px;font-size:11px;color:#555;line-height:1.6;}
      .footer{margin-top:28px;padding-top:12px;border-top:2px solid #0d2b4e;display:flex;justify-content:space-between;align-items:center;font-size:10px;color:#888;}
      .validity-badge{background:#fff3cd;border:1px solid #ffc107;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:600;color:#856404;}
      @media print{body{padding:16px 20px;}@page{margin:12mm 16mm;}}
    </style></head><body>

    <div class="hdr">
      <div>
        <!-- Logotyp: byt ut wordmark-div mot <img class="logo-img" src="/assets/logo.png" alt="VIFT"> om ni har en logofil -->
        <div class="logo-wordmark">VIFT</div>
        <div class="logo-tagline">${esc2(co)}</div>
        ${coAddr?`<div style="font-size:10px;color:#888;margin-top:2px;">${esc2(coAddr)}</div>`:''}
      </div>
      <div style="text-align:right;">
        <div class="offer-id">Offert ${off.id}</div>
        ${off.title?`<div class="offer-sub" style="font-size:13px;font-weight:600;color:#333;">${esc2(off.title)}</div>`:''}
        <div class="offer-sub">Datum: ${(off.createdAt||'').split('T')[0]||'—'}</div>
        ${off.validUntil?`<div class="offer-sub"><span class="validity-badge">Giltig till ${off.validUntil}</span></div>`:''}
      </div>
    </div>

    <div class="parties">
      <div class="party">
        <h4>Offereras till</h4>
        <p><strong>${esc2(cuName)}</strong>
        ${cuAddr?'<br>'+esc2(cuAddr):''}
        ${cu&&cu.phone?'<br>Tel: '+esc2(cu.phone):''}
        ${cu&&cu.email?'<br>'+esc2(cu.email):''}</p>
      </div>
      <div class="party">
        <h4>Offertvillkor</h4>
        <p>${off.paymentTerms?'Betalning: '+esc2(off.paymentTerms)+'<br>':''}${off.validityText?'Giltighetstid: '+esc2(off.validityText):'30 dagar'}</p>
      </div>
    </div>

    ${off.summary?`<div class="section"><h4>Sammanfattning</h4><p>${esc2(off.summary).replace(/\n/g,'<br>')}</p></div>`:''}
    ${scopeHtml}
    ${inclExclHtml}

    <table>
      <thead><tr><th>Tjänst / Rad</th><th style="text-align:right;">Ex. moms</th><th style="text-align:right;">Moms</th><th style="text-align:right;">Inkl. moms</th></tr></thead>
      <tbody>${lineRows}</tbody>
    </table>

    ${extrasHtml}
    ${txtBlksHtml}

    <div class="totals">
      <div class="totals-inner">
        <div class="tot-row"><span>Summa ex. moms</span><span>${fmt2(rawExVat)} kr</span></div>
        ${discAmt?`<div class="tot-row" style="color:#b45309;"><span>Rabatt</span><span>−${fmt2(discAmt)} kr</span></div>`:''}
        <div class="tot-row"><span>Moms 25 %</span><span>${fmt2(vat)} kr</span></div>
        <div class="tot-final"><span>${rutAmt?'Totalt inkl. moms':'Totalt att betala'}</span><span>${fmt2(incVat)} kr</span></div>
        ${rutAmt?`<div class="rut-box">
          <div class="rut-box-title">RUT/ROT-avdrag</div>
          <div style="font-size:12px;color:#16a34a;margin-bottom:4px;">Preliminärt avdrag: −${fmt2(rutAmt)} kr</div>
          <div class="rut-price">Kundpris: ${fmt2(cust)} kr</div>
          <div class="rut-note">* Avdraget är preliminärt och förutsätter att kunden har rätt till skattereduktion. VIFT administrerar ansökan.</div>
        </div>`:''}
      </div>
    </div>

    <div class="terms">
      <strong>Villkor</strong><br>
      ${off.generalTerms ? esc2(off.generalTerms).replace(/\n/g,'<br>') : 'Offerten är giltig i 30 dagar från offererat datum om inget annat anges. Betalning sker enligt faktura med 30 dagars netto. Dröjsmålsränta 8 % per år. Vid godkänd offert upprättas skriftlig orderbekräftelse. VIFT förbehåller sig rätten att justera priset vid väsentliga förändringar av uppdragets omfattning. Priser angivna exklusive moms om inget annat framgår.'}
    </div>

    <div class="footer">
      <span>${esc2(co)}</span>
      <span>${footerContact}</span>
    </div>

    <script>window.onload=()=>{ window.print(); };<\/script></body></html>`;

    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
    this._logEvt(off, 'pdf', 'PDF genererad');
    off.pdfGeneratedAt = new Date().toISOString();
    off.updatedAt = new Date().toISOString();
    persist();
  },

  /* ── Skicka offert (simulerat) ─── */
  showSendModal(offerId) {
    const off = getOff(offerId);
    if (!off) return;
    const cu = getCu(off.customerId);
    const cuEmail = cu ? (cu.email||'') : '';
    const subject = `Offert ${off.id}${off.title?' – '+off.title:''}`;
    const body2 = `Hej,\n\nBifogat hittar du offert ${off.id}${off.title?' – '+off.title:''}.\n\nOfferten är giltig till ${off.validUntil||'—'}.\n${off.paymentTerms?'Betalningsvillkor: '+off.paymentTerms+'.\n':''}\nHör av dig om du har frågor!\n\nMed vänliga hälsningar,\nVIFT Fastighetsservice`;
    const esc = s => (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
    Modal.open({
      title: ic('send',14) + ' Skicka offert',
      wide: true,
      body: `
        <div class="fg"><label>Till (e-post)</label>
          <input id="send-to" value="${esc(cuEmail)}" placeholder="kund@exempel.se" type="email"></div>
        <div class="fg"><label>Ämne</label>
          <input id="send-subject" value="${esc(subject)}"></div>
        <div class="fg"><label>Meddelande</label>
          <textarea id="send-body" rows="8">${esc(body2)}</textarea></div>
        <div style="background:var(--bg);border-radius:var(--rs);padding:8px 12px;font-size:11px;color:var(--mt);">
          ${ic('info',10)} Detta är en simulerad sändning — inget mejl skickas på riktigt. Status ändras till "Skickad".
        </div>`,
      buttons: [
        { label: ic('send',13) + ' Skicka', cls: 'btn bp', onClick: () => {
          const to = document.getElementById('send-to')?.value.trim();
          if (!to) { showToast('Fyll i e-postadress'); return; }
          this._logEvt(off, 'send', 'Offert skickad till ' + to);
          off.status  = 'skickad';
          off.sentAt  = new Date().toISOString();
          off.updatedAt = new Date().toISOString();
          persist();
          Modal.close();
          this.render({offerId});
          showToast('Offert markerad som skickad');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('send-to')?.focus(), 80);
  }
};

/* ── Fastigheter ──────────────────────── */
const PropertiesPage = {
  _q: '',

  render() {
    const el = document.getElementById('pg-objects-content');
    if (!el) return;
    let props = state.properties || [];
    if (this._q) {
      const q = this._q.toLowerCase();
      props = props.filter(p =>
        p.name.toLowerCase().includes(q) || (p.address||'').toLowerCase().includes(q) || (p.city||'').toLowerCase().includes(q)
      );
    }
    el.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
        <div class="swrap" style="flex:1;">
          <span class="sico">${ic('search',16)}</span>
          <input type="search" placeholder="Sök fastighet…" value="${this._q}"
            oninput="PropertiesPage._q=this.value;PropertiesPage.render()">
        </div>
        <button class="btn bp bsm" onclick="PropertiesPage.openCreate()">${ic('plus',14)} Ny fastighet</button>
      </div>` +
      (props.length === 0
        ? `<div class="empty">${ic('building-2',36)}<h3>Inga fastigheter</h3></div>`
        : props.map(p => {
            const cu = getCu(p.customerId);
            const cuName = cu ? CustomerService.displayName(cu) : '—';
            const aos = (state.workOrders||[]).filter(a => a.propertyId === p.id).length;
            return `
              <div class="list-item" onclick="PropertiesPage.openDetail('${p.id}')">
                <div class="item-row">
                  <div style="flex:1;min-width:0;">
                    <div class="item-title">${p.name}</div>
                    <div class="item-sub">${[p.address, p.zip, p.city].filter(Boolean).join(', ')} · ${cuName}</div>
                  </div>
                  <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
                    ${aos > 0 ? `<span class="bdg bdg-blue">${aos} AO</span>` : ''}
                    <span class="bdg bdg-grey" style="font-size:9px;">${p.id}</span>
                  </div>
                </div>
              </div>`;
          }).join(''));
  },

  _formHtml(p) {
    const v = (k, d='') => p ? (p[k]!=null?p[k]:d) : d;
    return `
      <div class="fg"><label>Namn / beteckning <span style="color:var(--rd)">*</span></label>
        <input id="prop-name" value="${v('name')}" placeholder="T.ex. Solvägen 1, Fastighet A…"></div>
      <div class="fg"><label>Ägare / kund</label>
        <select id="prop-cu">
          <option value="">— Välj kund —</option>
          ${(state.customers||[]).map(c=>`<option value="${c.id}" ${v('customerId')===c.id?'selected':''}>${CustomerService.displayName(c)}</option>`).join('')}
        </select></div>
      <div class="fg"><label>Gatuadress</label>
        <input id="prop-addr" value="${v('address')}" placeholder="Storgatan 1"></div>
      <div class="g2">
        <div class="fg"><label>Postnummer</label><input id="prop-zip" value="${v('zip')}" placeholder="123 45"></div>
        <div class="fg"><label>Stad</label><input id="prop-city" value="${v('city')}" placeholder="Stockholm"></div>
      </div>
      <div class="g2">
        <div class="fg"><label>Typ</label>
          <select id="prop-type">
            ${['Flerbostadshus','Kontorsfastighet','Industrifastighet','BRF','Villa','Butiksfastighet','Lager','Övrigt'].map(t=>`<option ${v('type')===t?'selected':''}>${t}</option>`).join('')}
          </select></div>
        <div class="fg"><label>Yta (m²)</label>
          <input type="number" id="prop-area" value="${v('area',0)}" min="0" placeholder="0"></div>
      </div>
      <div class="fg"><label>Antal våningar</label>
        <input type="number" id="prop-floors" value="${v('floors',1)}" min="1" max="50"></div>
      <div class="fg"><label>Portkod / åtkomst</label>
        <input id="prop-access" value="${v('accessCode')}" placeholder="T.ex. 1234#"></div>
      <div class="fg"><label>Anteckning</label>
        <textarea id="prop-note" rows="2" placeholder="Intern anteckning…">${v('note')}</textarea></div>`;
  },

  openCreate() {
    Modal.open({
      title: 'Ny fastighet',
      wide: true,
      body: this._formHtml(null),
      buttons: [
        { label: 'Skapa', cls: 'btn bp', onClick: () => PropertiesPage._save(null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('prop-name')?.focus(), 80);
  },

  openDetail(propId) {
    Router.showPage('pg-obj-detail', { propId });
  },

  openEdit(propId) {
    const p = (state.properties||[]).find(x=>x.id===propId);
    if (!p) return;
    Modal.open({
      title: `Redigera ${p.name}`,
      wide: true,
      body: this._formHtml(p),
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => PropertiesPage._save(propId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _save(propId) {
    const name = document.getElementById('prop-name')?.value.trim();
    if (!name) { showToast('Namn krävs'); return; }
    const data = {
      name,
      customerId: document.getElementById('prop-cu')?.value || '',
      address:    document.getElementById('prop-addr')?.value.trim() || '',
      zip:        document.getElementById('prop-zip')?.value.trim() || '',
      city:       document.getElementById('prop-city')?.value.trim() || '',
      type:       document.getElementById('prop-type')?.value || '',
      area:       parseFloat(document.getElementById('prop-area')?.value) || 0,
      floors:     parseInt(document.getElementById('prop-floors')?.value) || 1,
      accessCode: document.getElementById('prop-access')?.value.trim() || '',
      note:       document.getElementById('prop-note')?.value.trim() || '',
      updatedAt:  new Date().toISOString()
    };
    if (!propId) {
      state.properties = state.properties || [];
      state.properties.push({ ...data, id: newId(state.properties,'OBJ'), createdAt: new Date().toISOString() });
      showToast(`${name} skapad`);
    } else {
      const idx = (state.properties||[]).findIndex(x=>x.id===propId);
      if (idx < 0) return;
      state.properties[idx] = { ...state.properties[idx], ...data };
      showToast('Fastighet uppdaterad');
    }
    persist(); Modal.close(); this.render();
  }
};

/* ── Artiklar ─────────────────────────── */
const ArticlesPage = {
  _filter: 'alla',
  _q: '',

  render() {
    const el = document.getElementById('pg-articles-content');
    if (!el) return;
    const cats = ['alla','kemikalier','material','forbruk','arbete','kostnad'];
    const catLabels = { alla:'Alla', kemikalier:'Kemikalier', material:'Byggmaterial', forbruk:'Förbrukning', arbete:'Arbete', kostnad:'Kostnader' };
    let arts = state.articles || [];
    if (this._filter !== 'alla') arts = arts.filter(a => a.category === this._filter);
    if (this._q) {
      const q = this._q.toLowerCase();
      arts = arts.filter(a => a.name.toLowerCase().includes(q) || (a.articleNumber||'').includes(q));
    }
    el.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;">
        <div class="swrap" style="flex:1;">
          <span class="sico">${ic('search',16)}</span>
          <input type="search" placeholder="Sök artikel, artnr…" value="${this._q}"
            oninput="ArticlesPage._q=this.value;ArticlesPage.render()">
        </div>
        <button class="btn bp bsm" onclick="ArticlesPage.openCreate()">${ic('plus',14)} Ny artikel</button>
      </div>
      <div class="ftabs" style="margin-bottom:4px;">
        ${cats.map(c=>`<button class="ft ${this._filter===c?'on':''}" onclick="ArticlesPage._filter='${c}';ArticlesPage.render()">${catLabels[c]}</button>`).join('')}
      </div>
      ${arts.length === 0
        ? `<div class="empty">${ic('package',32)}<h3>Inga artiklar</h3></div>`
        : arts.map(a => `
          <div class="list-item" onclick="ArticlesPage.openEdit('${a.id}')">
            <div class="item-row">
              <div style="flex:1;min-width:0;">
                <div class="item-title">${a.articleNumber ? a.articleNumber+' – ':'' }${a.name}</div>
                <div class="item-sub">Ink: ${fmt(a.buyPrice)} kr · Pris: ${fmt(a.sellPrice)} kr/${a.unit} · Moms ${a.vatRate||25}%</div>
              </div>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
                <span class="bdg ${a.active!==false?'bdg-green':'bdg-grey'}">${a.active!==false?'Aktiv':'Inaktiv'}</span>
                <span class="bdg bdg-sky" style="font-size:9px;">${catLabels[a.category]||a.category}</span>
              </div>
            </div>
          </div>`).join('')}`;
  },

  _formHtml(a) {
    const catLabels = { kemikalier:'Kemikalier', material:'Byggmaterial', forbruk:'Förbrukning', arbete:'Arbete', kostnad:'Kostnader' };
    return `
      <div class="g2">
        <div class="fg"><label>Artikelnummer</label>
          <input id="art-num" value="${a?a.articleNumber||'':''}" placeholder="T.ex. 1001"></div>
        <div class="fg"><label>Kategori</label>
          <select id="art-cat">
            ${Object.entries(catLabels).map(([v,l])=>`<option value="${v}" ${a&&a.category===v?'selected':''}>${l}</option>`).join('')}
          </select></div>
      </div>
      <div class="fg"><label>Benämning <span style="color:var(--rd)">*</span></label>
        <input id="art-name" value="${a?a.name||'':''}" placeholder="T.ex. Fogmassa Sikaflex 291i"></div>
      <div class="g2">
        <div class="fg"><label>Enhet</label>
          <select id="art-unit">${unitsHtml(a?a.unit:'st')}</select></div>
        <div class="fg"><label>Momssats</label>
          <select id="art-vat">
            ${[0,6,12,25].map(r=>`<option value="${r}" ${a&&a.vatRate===r?'selected':r===25?'selected':''} >${r}%</option>`).join('')}
          </select></div>
      </div>
      <div class="g2">
        <div class="fg"><label>Inköpspris (kr/enhet)</label>
          <input type="number" id="art-buy" value="${a?a.buyPrice||0:0}" min="0" placeholder="0"></div>
        <div class="fg"><label>Försäljningspris ex moms (kr/enhet)</label>
          <input type="number" id="art-sell" value="${a?a.sellPrice||0:0}" min="0" placeholder="0"></div>
      </div>`;
  },

  openCreate() {
    if (!Auth.require('article_manage')) return;
    Modal.open({
      title: 'Ny artikel',
      body: this._formHtml(null),
      buttons: [
        { label: 'Skapa', cls: 'btn bp', onClick: () => ArticlesPage._save(null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('art-name')?.focus(), 80);
  },

  openEdit(artId) {
    const a = (state.articles||[]).find(x=>x.id===artId);
    if (!a) return;
    Modal.open({
      title: a.name,
      wide: true,
      body: this._formHtml(a),
      buttons: [
        { label: a.active!==false ? `${ic('eye-off',13)} Inaktivera` : `${ic('eye',13)} Aktivera`,
          cls: 'btn bw', onClick: () => ArticlesPage._toggleActive(artId) },
        { label: 'Spara', cls: 'btn bp', onClick: () => ArticlesPage._save(artId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _save(artId) {
    const name = document.getElementById('art-name')?.value.trim();
    if (!name) { showToast('Benämning krävs'); return; }
    const data = {
      articleNumber: document.getElementById('art-num')?.value.trim() || '',
      name,
      category: document.getElementById('art-cat')?.value || 'material',
      unit:     document.getElementById('art-unit')?.value || 'st',
      vatRate:  parseInt(document.getElementById('art-vat')?.value) || 25,
      buyPrice: parseFloat(document.getElementById('art-buy')?.value) || 0,
      sellPrice:parseFloat(document.getElementById('art-sell')?.value) || 0,
      updatedAt: new Date().toISOString()
    };
    if (!artId) {
      state.articles.push({ ...data, id: newId(state.articles,'ART'), active: true, createdAt: new Date().toISOString() });
      showToast(`${name} skapad`);
    } else {
      const idx = (state.articles||[]).findIndex(a=>a.id===artId);
      if (idx < 0) return;
      state.articles[idx] = { ...state.articles[idx], ...data };
      showToast('Artikel uppdaterad');
    }
    persist(); Modal.close(); this.render();
  },

  _toggleActive(artId) {
    const idx = (state.articles||[]).findIndex(a=>a.id===artId);
    if (idx < 0) return;
    state.articles[idx] = { ...state.articles[idx], active: !state.articles[idx].active, updatedAt: new Date().toISOString() };
    persist(); Modal.close();
    showToast(state.articles[idx].active ? 'Aktiverad' : 'Inaktiverad');
    this.render();
  }
};

/* ── Prisgrupper ──────────────────────── */
const PriceGroupsPage = {
  render() {
    const el = document.getElementById('pg-pricegroups-content');
    if (!el) return;
    const pgs = state.priceGroups || [];
    el.innerHTML =
      `<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
         <h3 style="flex:1;font-size:14px;font-weight:700;">Prisgrupper</h3>
         <button class="btn bp bsm" onclick="PriceGroupsPage.openCreate()">${ic('plus',14)} Ny prisgrupp</button>
       </div>` +
      (pgs.length === 0
        ? `<div class="empty">${ic('dollar-sign',36)}<h3>Inga prisgrupper</h3></div>`
        : pgs.map(pg => `
          <div class="list-item" onclick="PriceGroupsPage.openEdit('${pg.id}')">
            <div class="item-row">
              <div>
                <div class="item-title">${pg.name}</div>
                <div class="item-sub">${fmt(pg.hourRate)} kr/tim${pg.description ? ' · ' + pg.description : ''}</div>
              </div>
              <span class="bdg ${pg.active ? 'bdg-green' : 'bdg-grey'}">${pg.active ? 'Aktiv' : 'Inaktiv'}</span>
            </div>
          </div>`).join(''));
  },

  _formHtml(pg) {
    return `
      <div class="fg"><label>Namn <span style="color:var(--rd)">*</span></label>
        <input id="pg-name" value="${pg?pg.name||'':''}" placeholder="T.ex. Standard, Jour, Övertid"></div>
      <div class="fg"><label>Timpris ex moms (kr/tim)</label>
        <input type="number" id="pg-rate" value="${pg?pg.hourRate||0:0}" min="0"></div>
      <div class="fg"><label>Beskrivning</label>
        <input id="pg-desc" value="${pg?pg.description||'':''}" placeholder="Valfri beskrivning"></div>`;
  },

  openCreate() {
    if (!Auth.require('article_manage')) return;
    Modal.open({
      title: 'Ny prisgrupp',
      body: this._formHtml(null),
      buttons: [
        { label: 'Skapa', cls: 'btn bp', onClick: () => PriceGroupsPage._save(null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('pg-name')?.focus(), 80);
  },

  openEdit(pgId) {
    const pg = (state.priceGroups||[]).find(x=>x.id===pgId);
    if (!pg) return;
    Modal.open({
      title: pg.name,
      body: this._formHtml(pg),
      buttons: [
        { label: pg.active ? `${ic('eye-off',13)} Inaktivera` : `${ic('eye',13)} Aktivera`, cls: 'btn bw',
          onClick: () => { const idx=(state.priceGroups||[]).findIndex(x=>x.id===pgId); if(idx<0)return; state.priceGroups[idx].active=!state.priceGroups[idx].active; persist();Modal.close();PriceGroupsPage.render();showToast(state.priceGroups[idx].active?'Aktiverad':'Inaktiverad'); }},
        { label: 'Spara', cls: 'btn bp', onClick: () => PriceGroupsPage._save(pgId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _save(pgId) {
    const name = document.getElementById('pg-name')?.value.trim();
    if (!name) { showToast('Namn krävs'); return; }
    const data = {
      name,
      hourRate: parseFloat(document.getElementById('pg-rate')?.value) || 0,
      description: document.getElementById('pg-desc')?.value.trim() || '',
      updatedAt: new Date().toISOString()
    };
    if (!pgId) {
      state.priceGroups = state.priceGroups || [];
      state.priceGroups.push({ ...data, id: newId(state.priceGroups,'PG'), active: true, createdAt: new Date().toISOString() });
      showToast(`${name} skapad`);
    } else {
      const idx = (state.priceGroups||[]).findIndex(x=>x.id===pgId);
      if (idx < 0) return;
      state.priceGroups[idx] = { ...state.priceGroups[idx], ...data };
      showToast('Prisgrupp uppdaterad');
    }
    persist(); Modal.close(); this.render();
  }
};

/* ── Personal ─────────────────────────── */
const StaffPage = {
  _filter: 'aktiva',

  render() {
    const el = document.getElementById('pg-staff-content');
    if (!el) return;
    const all     = state.staff || [];
    const aktiva  = all.filter(s => s.active);
    const inaktiva = all.filter(s => !s.active);
    const list    = this._filter === 'aktiva' ? aktiva : inaktiva;
    const roleColor = (rid) => ({ admin:'bdg-red', chef:'bdg-orange', personal:'bdg-blue' }[rid] || 'bdg-grey');
    const roleLabel = (rid) => { const r = (state.roles||[]).find(x=>x.id===rid); return r ? r.label : (rid || '—'); };

    el.innerHTML =
      `<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
         <div class="ftabs" style="flex:1;margin-bottom:0;">
           <button class="ft ${this._filter==='aktiva'?'on':''}" onclick="StaffPage._filter='aktiva';StaffPage.render()">Aktiva (${aktiva.length})</button>
           <button class="ft ${this._filter==='inaktiva'?'on':''}" onclick="StaffPage._filter='inaktiva';StaffPage.render()">Inaktiva (${inaktiva.length})</button>
         </div>
         <button class="btn bp bsm" onclick="StaffPage.openCreate()">${ic('plus',14)} Ny personal</button>
       </div>` +
      (list.length === 0
        ? `<div class="empty">${ic('users',32)}<h3>Inga ${this._filter} medarbetare</h3></div>`
        : list.map(s => `
          <div class="list-item" onclick="StaffPage.openEdit('${s.id}')">
            <div class="item-row">
              <div style="display:flex;align-items:center;gap:10px;">
                <div style="width:38px;height:38px;border-radius:50%;background:var(--acc);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:var(--navy);flex-shrink:0;">${(s.firstName||'?').charAt(0)}${(s.lastName||'').charAt(0)}</div>
                <div>
                  <div class="item-title">${s.firstName} ${s.lastName}</div>
                  <div class="item-sub">${s.title||'—'}${s.phone?' · '+s.phone:''}</div>
                </div>
              </div>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
                <span class="bdg ${roleColor(s.role)}">${roleLabel(s.role)}</span>
                <span style="font-size:10px;color:var(--mt);">${s.email||''}</span>
              </div>
            </div>
          </div>`).join('')
      );
  },

  _formHtml(s) {
    const allRoles = state.roles || [];
    const activeRoles = allRoles.filter(r => r.active !== false);
    const fallbackRoles = [
      { id:'personal', label:'Tekniker / Personal', description:'', active:true },
      { id:'chef',     label:'Chef / Projektledare', description:'', active:true },
      { id:'admin',    label:'Admin', description:'', active:true }
    ];
    const displayRoles = activeRoles.length ? activeRoles : fallbackRoles;
    const activeTitles = (state.titles||[]).filter(t => t.active !== false);
    return `
      <div class="g2">
        <div class="fg"><label>Förnamn <span style="color:var(--rd)">*</span></label>
          <input id="sf-first" value="${s?s.firstName:''}" placeholder="Förnamn" autocomplete="off"></div>
        <div class="fg"><label>Efternamn <span style="color:var(--rd)">*</span></label>
          <input id="sf-last" value="${s?s.lastName:''}" placeholder="Efternamn" autocomplete="off"></div>
      </div>
      <div class="fg"><label>Titel / yrkesroll</label>
        ${activeTitles.length > 0 ? `
          <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
            <div id="sf-title-display" style="flex:1;">
              ${s && s.title
                ? `<span class="chip on">${s.title}</span>`
                : '<span style="font-size:12px;color:var(--mt);">Ingen titel vald</span>'}
            </div>
            <button type="button" class="btn bs bsm" onclick="StaffPage._openTitlePicker()">
              ${ic('list',13)} Välj titel
            </button>
          </div>
          <input type="hidden" id="sf-title" value="${s?s.title||'':''}">
          ${s && s.title && !activeTitles.some(t => t.name === s.title)
            ? `<div class="nbox" style="margin-top:4px;font-size:11px;">⚠ "${s.title}" finns inte bland aktiva titlar</div>`
            : ''}` :
          `<div class="nbox" style="font-size:12px;">Inga aktiva titlar. <button type="button" class="btn bghost bxs" style="margin-left:4px;" onclick="Modal.close();Router.showPage('pg-admin')">Gå till Admin ${ic('arrow-right',10)}</button></div>
          <input type="hidden" id="sf-title" value="${s?s.title||'':''}">`
        }</div>
      <div class="g2">
        <div class="fg"><label>Telefon</label>
          <input id="sf-phone" value="${s?s.phone||'':''}" placeholder="070-XXX XX XX" type="tel"></div>
        <div class="fg"><label>E-post</label>
          <input id="sf-email" value="${s?s.email||'':''}" placeholder="namn@vift.se" type="email"></div>
      </div>
      <div style="border-top:1px solid var(--br);margin:4px 0;"></div>
      <div class="fg"><label>Användarnamn <span style="color:var(--rd)">*</span></label>
        <input id="sf-uname" value="${s?s.username||'':''}" placeholder="användarnamn" autocomplete="off"></div>
      <div class="fg"><label>Roll / behörighet</label>
        <input type="hidden" id="sf-role" value="${s?s.role||'personal':'personal'}">
        <div style="display:flex;flex-direction:column;gap:5px;margin-top:4px;">
          ${displayRoles.map(r => {
            const isSel = s ? s.role === r.id : r.id === 'personal';
            return `<div onclick="StaffPage._selectRole('${r.id}')" id="sf-role-opt-${r.id}"
              style="display:flex;align-items:center;gap:10px;padding:9px 12px;border:1.5px solid ${isSel?'var(--sky)':'var(--br)'};border-radius:var(--rs);cursor:pointer;transition:border-color .1s;">
              <div id="sf-role-dot-${r.id}" style="width:16px;height:16px;border-radius:50%;border:2px solid ${isSel?'var(--navy)':'var(--br)'};background:${isSel?'var(--navy)':'transparent'};flex-shrink:0;transition:all .1s;"></div>
              <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:700;">${r.label}</div>
                ${r.description?`<div style="font-size:11px;color:var(--mt);">${r.description}</div>`:''}
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
      ${s ? `
      <div class="fg"><label style="display:flex;align-items:center;gap:8px;text-transform:none;font-size:13px;font-weight:600;letter-spacing:0;cursor:pointer;">
        <input type="checkbox" id="sf-change-pw" onchange="document.getElementById('sf-pw-wrap').style.display=this.checked?'':'none'">
        Ändra lösenord
      </label></div>
      <div id="sf-pw-wrap" style="display:none;">
        <div class="fg"><label>Nytt lösenord</label>
          <input type="password" id="sf-pw" placeholder="Minst 4 tecken" autocomplete="new-password"></div>
      </div>` : `
      <div class="fg"><label>Lösenord <span style="color:var(--rd)">*</span></label>
        <input type="password" id="sf-pw" placeholder="Minst 4 tecken" autocomplete="new-password"></div>`}`;
  },

  _openTitlePicker() {
    const titles = (state.titles || []).filter(t => t.active !== false);
    if (titles.length === 0) { showToast('Inga aktiva titlar. Gå till Admin → Titlar.'); return; }
    Modal.open({
      title: 'Välj titel',
      body: `
        <div class="fg" style="margin-bottom:8px;">
          <input id="tp-search" placeholder="Sök titel…" autocomplete="off"
            oninput="document.getElementById('tp-list').innerHTML=StaffPage._titlePickerItems(this.value)">
        </div>
        <div id="tp-list" style="max-height:280px;overflow-y:auto;">
          ${this._titlePickerItems('')}
        </div>`,
      buttons: [
        { label: 'Rensa val', cls: 'btn bw', onClick: () => StaffPage._selectTitleFromPicker('') },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('tp-search')?.focus(), 80);
  },

  _titlePickerItems(q) {
    const titles = (state.titles || []).filter(t => t.active !== false);
    const cur = document.getElementById('sf-title')?.value || '';
    const filtered = q ? titles.filter(t => t.name.toLowerCase().includes(q.toLowerCase())) : titles;
    if (!filtered.length) return '<p style="font-size:12px;color:var(--mt);padding:8px 0;">Inga aktiva titlar matchar</p>';
    return filtered.map(t => {
      const isSel = cur === t.name;
      const usageCount = (state.staff||[]).filter(s => s.title === t.name).length;
      return `<div class="crow" onclick="StaffPage._selectTitleFromPicker('${t.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}')"
        style="${isSel?'background:var(--navy10,#eef2ff);':''};cursor:pointer;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;">${t.name}</div>
          ${t.description ? `<div style="font-size:11px;color:var(--mt);">${t.description}</div>` : ''}
          ${usageCount > 0 ? `<div style="font-size:10px;color:var(--sky);">${usageCount} person${usageCount===1?'':'er'}</div>` : ''}
        </div>
        ${isSel ? `<span style="color:var(--grn);">${ic('check-circle',16)}</span>` : ''}
      </div>`;
    }).join('');
  },

  _selectTitleFromPicker(title) {
    const inp = document.getElementById('sf-title');
    if (inp) inp.value = title;
    const display = document.getElementById('sf-title-display');
    if (display) {
      display.innerHTML = title
        ? `<span class="chip on">${title}</span>`
        : '<span style="font-size:12px;color:var(--mt);">Ingen titel vald</span>';
    }
    Modal.close();
  },

  _selectRole(roleId) {
    document.getElementById('sf-role').value = roleId;
    const roles = (state.roles && state.roles.length
      ? state.roles.filter(r => r.active !== false)
      : [{ id:'personal' }, { id:'chef' }, { id:'admin' }]);
    roles.forEach(r => {
      const opt = document.getElementById('sf-role-opt-' + r.id);
      const dot = document.getElementById('sf-role-dot-' + r.id);
      const isSel = r.id === roleId;
      if (opt) opt.style.borderColor = isSel ? 'var(--sky)' : 'var(--br)';
      if (dot) {
        dot.style.borderColor = isSel ? 'var(--navy)' : 'var(--br)';
        dot.style.background  = isSel ? 'var(--navy)' : 'transparent';
      }
    });
  },

  openCreate() {
    if (!Auth.require('staff_manage')) return;
    Modal.open({
      title: 'Ny personal',
      body: this._formHtml(null),
      buttons: [
        { label: 'Skapa', cls: 'btn bp', onClick: () => StaffPage._save(null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => { document.getElementById('sf-first')?.focus(); }, 80);
  },

  openEdit(staffId) {
    if (!Auth.require('staff_manage')) return;
    const s = (state.staff||[]).find(x => x.id === staffId);
    if (!s) return;
    Modal.open({
      title: `${s.firstName} ${s.lastName}`,
      wide: true,
      body: this._formHtml(s),
      buttons: [
        { label: s.active ? `${ic('user-x',13)} Inaktivera` : `${ic('user-check',13)} Aktivera`,
          cls: s.active ? 'btn bw' : 'btn bsu',
          onClick: () => StaffPage._toggleActive(staffId) },
        { label: 'Spara', cls: 'btn bp', onClick: () => StaffPage._save(staffId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => { document.getElementById('sf-first')?.focus(); }, 80);
  },

  _save(staffId) {
    const first = document.getElementById('sf-first')?.value.trim();
    const last  = document.getElementById('sf-last')?.value.trim();
    const uname = document.getElementById('sf-uname')?.value.trim();
    if (!first || !last) { showToast('Förnamn och efternamn krävs'); return; }
    if (!uname)          { showToast('Användarnamn krävs'); return; }

    const data = {
      firstName: first, lastName: last,
      title:  document.getElementById('sf-title')?.value.trim() || '',
      phone:  document.getElementById('sf-phone')?.value.trim() || '',
      email:  document.getElementById('sf-email')?.value.trim() || '',
      username: uname,
      role: document.getElementById('sf-role')?.value || 'personal',
      updatedAt: new Date().toISOString()
    };

    if (!staffId) {
      const pw = document.getElementById('sf-pw')?.value || '';
      if (!pw || pw.length < 4) { showToast('Lösenord krävs (minst 4 tecken)'); return; }
      if ((state.staff||[]).find(s => s.username === uname)) { showToast('Användarnamnet används redan'); return; }
      state.staff.push({ ...data, id: newId(state.staff||[], 'ST'), password: pw, permissions: [], active: true, createdAt: new Date().toISOString() });
      persist(); Modal.close(); showToast(`${first} ${last} skapad`);
    } else {
      const idx = (state.staff||[]).findIndex(s => s.id === staffId);
      if (idx < 0) return;
      if ((state.staff||[]).find(s => s.username === uname && s.id !== staffId)) { showToast('Användarnamnet används redan'); return; }
      const changePw = document.getElementById('sf-change-pw');
      if (changePw?.checked) {
        const pw = document.getElementById('sf-pw')?.value || '';
        if (!pw || pw.length < 4) { showToast('Lösenord krävs (minst 4 tecken)'); return; }
        data.password = pw;
      }
      state.staff[idx] = { ...state.staff[idx], ...data };
      persist(); Modal.close(); showToast('Sparat');
    }
    this.render();
  },

  _toggleActive(staffId) {
    const idx = (state.staff||[]).findIndex(s => s.id === staffId);
    if (idx < 0) return;
    state.staff[idx] = { ...state.staff[idx], active: !state.staff[idx].active, updatedAt: new Date().toISOString() };
    persist(); Modal.close();
    showToast(state.staff[idx].active ? 'Aktiverad' : 'Inaktiverad');
    this.render();
  }
};

/* ── Admin ────────────────────────────── */
const AdminPage = {
  _titleQ: '',

  render() {
    const el = document.getElementById('pg-admin-content');
    if (!el) return;
    const s = state.settings || {};
    const allTitles = state.titles || [];
    const titles = this._titleQ
      ? allTitles.filter(t => typeof t === 'object' && t.name && t.name.toLowerCase().includes(this._titleQ.toLowerCase()))
      : allTitles;

    el.innerHTML = `
      <!-- Företagsinformation -->
      <div class="card">
        <div class="card-header">
          <h3>Företagsinformation</h3>
          <button class="btn bs bxs" onclick="AdminPage.openEditCompany()">${ic('pencil',13)} Redigera</button>
        </div>
        <div class="card-body">
          <div class="dr"><span class="dk">Företag</span><span class="dv">${s.companyName || '—'}</span></div>
          <div class="dr"><span class="dk">Telefon</span><span class="dv">${s.companyPhone || '—'}</span></div>
          <div class="dr"><span class="dk">E-post</span><span class="dv">${s.companyEmail || '—'}</span></div>
          <div class="dr"><span class="dk">Adress</span><span class="dv">${s.companyAddress || '—'}</span></div>
          <div class="dr"><span class="dk">Org.nr</span><span class="dv">${s.orgNr || '—'}</span></div>
          <div class="dr"><span class="dk">Moms-nr</span><span class="dv">${s.vatNr || '—'}</span></div>
        </div>
      </div>

      <!-- Titlar / yrkesroller -->
      <div class="card">
        <div class="card-header">
          <h3>Titlar / yrkesroller</h3>
          <button class="btn bp bxs" onclick="AdminPage.openAddTitle()">${ic('plus',13)} Lägg till</button>
        </div>
        <div style="padding:8px 14px 4px;border-bottom:1px solid var(--br);">
          <div class="swrap">
            <span class="sico">${ic('search',14)}</span>
            <input type="search" placeholder="Sök titel…" value="${this._titleQ}"
              oninput="AdminPage._titleQ=this.value;AdminPage.render()" style="font-size:12px;">
          </div>
        </div>
        <div class="card-body" style="padding:4px 14px;">
          ${allTitles.length === 0
            ? '<p style="font-size:12px;color:var(--mt);padding:6px 0;">Inga titlar registrerade</p>'
            : titles.length === 0
              ? `<p style="font-size:12px;color:var(--mt);padding:6px 0;">Ingen titel matchar "${this._titleQ}"</p>`
              : titles.map(t => {
                  const origIdx = allTitles.findIndex(x => x.id === t.id);
                  const usageCount = (state.staff||[]).filter(s => s.title === t.name).length;
                  return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--bg);">
                    <div style="flex:1;min-width:0;">
                      <div style="display:flex;align-items:center;gap:6px;">
                        <span style="font-size:13px;font-weight:600;">${t.name}</span>
                        <span class="bdg ${t.active?'bdg-green':'bdg-grey'}" style="font-size:9px;">${t.active?'Aktiv':'Inaktiv'}</span>
                      </div>
                      ${t.description ? `<div style="font-size:11px;color:var(--mt);">${t.description}</div>` : ''}
                      ${usageCount > 0
                        ? `<div style="font-size:10px;color:var(--sky);cursor:pointer;" onclick="AdminPage.showTitleStaff('${t.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}')">
                            ${usageCount} person${usageCount===1?'':'er'} – Visa ${ic('arrow-right',9)}
                          </div>`
                        : '<div style="font-size:10px;color:var(--mt);">Ej använd</div>'}
                    </div>
                    <button class="btn bxs bs" onclick="AdminPage.openEditTitle(${origIdx})">${ic('pencil',11)}</button>
                    <button class="btn bxs ${t.active?'bw':'bsu'}" onclick="AdminPage.toggleTitleActive(${origIdx})"
                      style="font-size:10px;">${t.active?ic('eye-off',11):ic('eye',11)}</button>
                    <button class="btn bxs bd" onclick="AdminPage.removeTitle(${origIdx})"
                      ${usageCount>0?`title="Används av ${usageCount} person(er)"`:''}>${ic('trash',11)}</button>
                  </div>`;
                }).join('')
          }
        </div>
      </div>

      <!-- Roller & behörigheter -->
      <div class="card">
        <div class="card-header">
          <h3>Roller & behörigheter</h3>
          <button class="btn bp bxs" onclick="AdminPage.openAddRole()">${ic('plus',13)} Ny roll</button>
        </div>
        <div class="card-body" style="padding:4px 14px;">
          ${(state.roles||[]).length === 0
            ? '<p style="font-size:12px;color:var(--mt);padding:6px 0;">Inga roller definierade</p>'
            : (state.roles||[]).map(r => {
                const permCount  = (r.permissions||[]).length;
                const staffCount = (state.staff||[]).filter(s=>s.role===r.id).length;
                const isActive   = r.active !== false;
                return `<div style="padding:9px 0;border-bottom:1px solid var(--bg);display:flex;align-items:flex-start;gap:8px;${isActive?'':'opacity:.65'}">
                  <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;flex-wrap:wrap;">
                      <span style="font-size:13px;font-weight:700;">${r.label}</span>
                      <span class="bdg ${isActive?'bdg-green':'bdg-grey'}" style="font-size:9px;">${isActive?'Aktiv':'Inaktiv'}</span>
                      ${r.isBuiltin?`<span class="bdg bdg-grey" style="font-size:9px;">Inbyggd</span>`:''}
                      ${staffCount>0?`<span class="bdg bdg-blue" style="font-size:9px;cursor:pointer;" onclick="AdminPage.showRoleStaff('${r.id}')">${staffCount} pers.</span>`:''}
                    </div>
                    ${r.description?`<div style="font-size:11px;color:var(--mt);">${r.description}</div>`:''}
                    <div style="font-size:10px;color:var(--sky);margin-top:2px;">${permCount===0?'Inga behörigheter':permCount+' behörighet'+(permCount===1?'':'er')+(r.permissions&&r.permissions.includes('all')?' (superadmin)':'')}</div>
                  </div>
                  <div style="display:flex;gap:4px;flex-shrink:0;">
                    <button class="btn bxs bs" onclick="AdminPage.openEditRole('${r.id}')">${ic('pencil',11)}</button>
                    <button class="btn bxs ${isActive?'bw':'bsu'}" onclick="AdminPage.toggleRoleActive('${r.id}')"
                      title="${isActive?'Inaktivera':'Aktivera'}" style="font-size:10px;">${isActive?ic('eye-off',11):ic('eye',11)}</button>
                    ${!r.isBuiltin?`<button class="btn bxs bd" onclick="AdminPage.removeRole('${r.id}')">${ic('trash',11)}</button>`:''}
                  </div>
                </div>`;
              }).join('')
          }
        </div>
      </div>

      <!-- Tjänstemallar -->
      <div class="card">
        <div class="card-header">
          <h3>${ic('zap',13)} Offert-tjänstemallar</h3>
        </div>
        <div class="card-body" style="padding:4px 14px 8px;">
          <p style="font-size:11px;color:var(--mt);margin-bottom:8px;">VIFT:s inbyggda kalkylatormallar för offertmodulen. Mallarna definierar prismodell, RUT/ROT-typ och ingående fält.</p>
          ${OffersPage._T.map(t=>`<div style="padding:7px 0;border-bottom:1px solid var(--bg);display:flex;align-items:center;gap:8px;">
            <span style="background:var(--acc);border-radius:var(--rx);padding:5px;color:var(--blue);flex-shrink:0;">${ic(t.icon,13)}</span>
            <div style="flex:1;min-width:0;">
              <div style="font-size:12px;font-weight:700;">${t.name}</div>
              <div style="font-size:10px;color:var(--mt);">${t.defaultReduction==='rut'?'RUT 50 %':t.defaultReduction==='rot'?'ROT 30 %':'Ingen reduktion'} · Moms ${t.vatRate||25} % · ${t.fields.filter(f=>!f.isRut&&!f.isRot).length} fält</div>
            </div>
            <span class="bdg bdg-green" style="font-size:9px;">Aktiv</span>
          </div>`).join('')}
        </div>
      </div>

      <!-- Register-shortcuts -->
      <div class="card">
        <div class="card-header"><h3>Register</h3></div>
        <div class="card-body">
          <div class="dr">
            <span class="dk">${ic('users',13)} Personal</span>
            <span class="dv"><button class="btn bs bxs" onclick="Router.showPage('pg-staff')">${(state.staff||[]).filter(s=>s.active).length} aktiva – Hantera ${ic('arrow-right',12)}</button></span>
          </div>
          <div class="dr">
            <span class="dk">${ic('package',13)} Artiklar</span>
            <span class="dv"><button class="btn bs bxs" onclick="Router.showPage('pg-articles')">${(state.articles||[]).filter(a=>a.active!==false).length} aktiva – Hantera ${ic('arrow-right',12)}</button></span>
          </div>
          <div class="dr">
            <span class="dk">${ic('dollar-sign',13)} Prisgrupper</span>
            <span class="dv"><button class="btn bs bxs" onclick="Router.showPage('pg-pricegroups')">${(state.priceGroups||[]).filter(p=>p.active).length} aktiva – Hantera ${ic('arrow-right',12)}</button></span>
          </div>
        </div>
      </div>

      <!-- Systemdata -->
      <div class="card">
        <div class="card-header"><h3>Systemöversikt</h3></div>
        <div class="card-body">
          <div class="dr"><span class="dk">Kunder</span><span class="dv">${(state.customers||[]).length} st</span></div>
          <div class="dr"><span class="dk">Arbetsorder</span><span class="dv">${(state.workOrders||[]).length} st</span></div>
          <div class="dr"><span class="dk">Offerter</span><span class="dv">${(state.offers||[]).length} st</span></div>
          <div class="dr"><span class="dk">Fakturor</span><span class="dv">${(state.invoices||[]).length} st</span></div>
          <div class="dr"><span class="dk">Återkommande</span><span class="dv">${(state.recurringOrders||[]).length} st</span></div>
          <div class="dr"><span class="dk">Tidsposter</span><span class="dv">${(state.timeEntries||[]).length} st</span></div>
          <div class="dr"><span class="dk">Aktivitetslogg</span><span class="dv">${(state.activityLog||[]).length} poster</span></div>
        </div>
      </div>

      <!-- Rensa testdata -->
      <div class="card">
        <div class="card-header"><h3>Demodata & återställning</h3></div>
        <div class="card-body">
          <p style="font-size:12px;color:var(--mt);margin-bottom:8px;">Rensa localStorage och ladda om demodata. Återställer allt till startläget.</p>
          <button class="btn bd bsm" onclick="if(confirm('Rensa all data och återgå till demodata?')){localStorage.clear();location.reload();}">${ic('trash',13)} Återställ demodata</button>
        </div>
      </div>`;
  },

  openEditCompany() {
    if (!Auth.require('admin_manage')) return;
    const s = state.settings || {};
    Modal.open({
      title: 'Företagsinformation',
      body: `
        <div class="fg"><label>Företagsnamn</label><input id="co-name" value="${s.companyName||''}"></div>
        <div class="g2">
          <div class="fg"><label>Telefon</label><input id="co-phone" value="${s.companyPhone||''}" type="tel"></div>
          <div class="fg"><label>E-post</label><input id="co-email" value="${s.companyEmail||''}" type="email"></div>
        </div>
        <div class="fg"><label>Adress</label><input id="co-addr" value="${s.companyAddress||''}"></div>
        <div class="g2">
          <div class="fg"><label>Org.nr</label><input id="co-orgnr" value="${s.orgNr||''}"></div>
          <div class="fg"><label>Moms-nr</label><input id="co-vatnr" value="${s.vatNr||''}"></div>
        </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          state.settings = {
            ...state.settings,
            companyName:    document.getElementById('co-name')?.value.trim()  || s.companyName,
            companyPhone:   document.getElementById('co-phone')?.value.trim() || '',
            companyEmail:   document.getElementById('co-email')?.value.trim() || '',
            companyAddress: document.getElementById('co-addr')?.value.trim()  || '',
            orgNr:          document.getElementById('co-orgnr')?.value.trim() || '',
            vatNr:          document.getElementById('co-vatnr')?.value.trim() || ''
          };
          persist(); Modal.close(); AdminPage.render(); showToast('Sparat');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  showRoleStaff(roleId) {
    const role = (state.roles||[]).find(r => r.id === roleId);
    const staffList = (state.staff||[]).filter(s => s.role === roleId);
    if (!staffList.length) { showToast('Ingen personal med denna roll'); return; }
    Modal.open({
      title: `Personal med roll: ${role ? role.label : roleId}`,
      body: staffList.map(s => `
        <div class="crow">
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:700;">${s.firstName} ${s.lastName}</div>
            <div style="font-size:11px;color:var(--mt);">${s.title||''} ${s.email?'· '+s.email:''}</div>
          </div>
          <span class="bdg ${s.active?'bdg-green':'bdg-grey'}">${s.active?'Aktiv':'Inaktiv'}</span>
        </div>`).join(''),
      buttons: [{ label: 'Stäng', cls: 'btn bs', onClick: () => Modal.close() }]
    });
  },

  toggleRoleActive(roleId) {
    const r = (state.roles||[]).find(x => x.id === roleId);
    if (!r) return;
    // Guard: don't deactivate the last active admin-level role
    if (r.active !== false) {
      const activeAdmins = (state.roles||[]).filter(x => x.active !== false && (x.permissions||[]).includes('all'));
      if (activeAdmins.length <= 1 && (r.permissions||[]).includes('all')) {
        showToast('Kan inte inaktivera – det finns bara en admin-roll'); return;
      }
    }
    r.active = r.active === false ? true : false;
    persist(); AdminPage.render(); showToast(r.active ? 'Roll aktiverad' : 'Roll inaktiverad');
  },

  showTitleStaff(title) {
    const staffWithTitle = (state.staff||[]).filter(s => s.title === title);
    if (!staffWithTitle.length) { showToast('Ingen personal med denna titel'); return; }
    Modal.open({
      title: `Personal med titel: ${title}`,
      body: staffWithTitle.map(s => `
        <div class="crow" onclick="Modal.close();Router.showPage('pg-staff')">
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:700;">${s.firstName} ${s.lastName}</div>
            <div style="font-size:11px;color:var(--mt);">${s.email||''}</div>
          </div>
          <span class="bdg ${s.active?'bdg-green':'bdg-grey'}">${s.active?'Aktiv':'Inaktiv'}</span>
        </div>`).join(''),
      buttons: [{ label: 'Stäng', cls: 'btn bs', onClick: () => Modal.close() }]
    });
  },

  openAddTitle() {
    if (!Auth.require('admin_manage')) return;
    Modal.open({
      title: 'Lägg till titel',
      body: `
        <div class="fg"><label>Titel / yrkesroll <span style="color:var(--rd)">*</span></label>
          <input id="adm-title" placeholder="T.ex. Låssmed, VVS-tekniker…"
            onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('adm-title-desc')?.focus();}"></div>
        <div class="fg"><label>Beskrivning (valfritt)</label>
          <input id="adm-title-desc" placeholder="Kort beskrivning av yrkesrollen…"
            onkeydown="if(event.key==='Enter'){event.preventDefault();AdminPage._addTitle();}"></div>`,
      buttons: [
        { label: 'Lägg till', cls: 'btn bp', onClick: () => AdminPage._addTitle() },
        { label: 'Avbryt',   cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('adm-title')?.focus(), 80);
  },

  _addTitle() {
    const name = (document.getElementById('adm-title')?.value || '').trim();
    if (!name) { showToast('Ange en titel'); return; }
    if ((state.titles||[]).some(x => x.name.toLowerCase() === name.toLowerCase())) { showToast('Finns redan'); return; }
    const desc = (document.getElementById('adm-title-desc')?.value || '').trim();
    state.titles = state.titles || [];
    const newId_ = 'TIT-' + String(Date.now()).slice(-6);
    state.titles.push({ id: newId_, name, description: desc, active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    persist(); Modal.close(); AdminPage.render(); showToast(`"${name}" tillagd`);
  },

  openEditTitle(idx) {
    const t = (state.titles||[])[idx];
    if (!t) return;
    Modal.open({
      title: 'Redigera titel',
      body: `
        <div class="fg"><label>Titel / yrkesroll <span style="color:var(--rd)">*</span></label>
          <input id="adm-edit-title" value="${t.name}"
            onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('adm-edit-desc')?.focus();}"></div>
        <div class="fg"><label>Beskrivning</label>
          <input id="adm-edit-desc" value="${t.description||''}" placeholder="Kort beskrivning…"
            onkeydown="if(event.key==='Enter'){event.preventDefault();AdminPage._saveEditTitle(${idx});}"></div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => AdminPage._saveEditTitle(idx) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('adm-edit-title')?.focus(), 80);
  },

  _saveEditTitle(idx) {
    const name = (document.getElementById('adm-edit-title')?.value || '').trim();
    if (!name) { showToast('Ange en titel'); return; }
    const t = (state.titles||[])[idx];
    if (!t) return;
    const oldName = t.name;
    if (name.toLowerCase() !== oldName.toLowerCase() &&
        (state.titles||[]).some((x, i) => i !== idx && x.name.toLowerCase() === name.toLowerCase())) {
      showToast('Titeln finns redan'); return;
    }
    // Update staff records that had the old name
    (state.staff||[]).forEach(s => { if (s.title === oldName) s.title = name; });
    t.name = name;
    t.description = (document.getElementById('adm-edit-desc')?.value || '').trim();
    t.updatedAt = new Date().toISOString();
    persist(); Modal.close(); AdminPage.render(); showToast('Titel uppdaterad');
  },

  toggleTitleActive(idx) {
    const t = (state.titles||[])[idx];
    if (!t) return;
    t.active = !t.active;
    t.updatedAt = new Date().toISOString();
    persist(); AdminPage.render(); showToast(t.active ? 'Titel aktiverad' : 'Titel inaktiverad');
  },

  removeTitle(idx) {
    const t = (state.titles||[])[idx];
    if (!t) return;
    const usageCount = (state.staff||[]).filter(s => s.title === t.name).length;
    if (usageCount > 0) { showToast(`Kan inte ta bort – används av ${usageCount} person${usageCount===1?'':'er'}`); return; }
    if (!confirm(`Ta bort titeln "${t.name}"?`)) return;
    state.titles.splice(idx, 1);
    persist(); AdminPage.render(); showToast('Borttagen');
  },

  openAddRole() {
    if (!Auth.require('admin_manage')) return;
    Modal.open({
      title: 'Ny anpassad roll',
      body: `
        <div class="fg"><label>Roll-ID (unik nyckel) <span style="color:var(--rd)">*</span></label>
          <input id="role-id" placeholder="t.ex. konsult, vikarie, tekniker2…" autocomplete="off"
            oninput="this.value=this.value.toLowerCase().replace(/[^a-z0-9_]/g,'')"></div>
        <div class="fg"><label>Visningsnamn <span style="color:var(--rd)">*</span></label>
          <input id="role-label" placeholder="T.ex. Konsult, Vikarie…" autocomplete="off"></div>
        <div class="fg"><label>Beskrivning</label>
          <input id="role-desc" placeholder="Kort beskrivning av rollen och dess tillgång…"></div>`,
      buttons: [
        { label: 'Skapa roll', cls: 'btn bp', onClick: () => AdminPage._addRole() },
        { label: 'Avbryt',    cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('role-id')?.focus(), 80);
  },

  _addRole() {
    const id    = document.getElementById('role-id')?.value.trim();
    const label = document.getElementById('role-label')?.value.trim();
    if (!id || !label) { showToast('ID och visningsnamn krävs'); return; }
    if ((state.roles||[]).some(r => r.id === id)) { showToast('Roll-ID används redan'); return; }
    state.roles = state.roles || [];
    state.roles.push({
      id, label, isBuiltin: false, active: true,
      description: document.getElementById('role-desc')?.value.trim() || '',
      permissions: []
    });
    persist(); Modal.close(); AdminPage.render(); showToast(`Roll "${label}" skapad`);
  },

  _PERMISSIONS: [
    { id:'all',              label:'Alla behörigheter (superadmin)' },
    { id:'dashboard_view',   label:'Se dashboard' },
    { id:'ao_create',        label:'Skapa / redigera arbetsorder' },
    { id:'ao_complete',      label:'Klarmarkera arbetsorder' },
    { id:'ao_view_all',      label:'Se alla arbetsorder' },
    { id:'customer_manage',  label:'Hantera kunder' },
    { id:'offer_manage',     label:'Hantera offerter' },
    { id:'invoice_view',     label:'Se fakturaunderlag' },
    { id:'invoice_create',   label:'Skapa fakturaunderlag' },
    { id:'article_manage',   label:'Hantera artiklar & prisgrupper' },
    { id:'staff_view',       label:'Se personal' },
    { id:'staff_manage',     label:'Hantera personal' },
    { id:'admin_manage',     label:'Adminpanel & systeminställningar' },
    { id:'reports_view',     label:'Se rapporter & löneunderlag' },
    { id:'recurring_manage', label:'Hantera återkommande ärenden' },
    { id:'sales_manage',     label:'Hantera säljchanser' }
  ],

  _PERM_LABELS: {
    'all':              'Superadmin – full åtkomst',
    'dashboard_view':   'Visa dashboard',
    'ao_view_all':      'Visa alla arbetsordrar',
    'ao_view_own':      'Visa egna arbetsordrar',
    'ao_create':        'Skapa arbetsordrar',
    'ao_edit':          'Redigera arbetsordrar',
    'ao_complete':      'Avsluta/slutföra arbetsordrar',
    'ao_time':          'Registrera tid',
    'ao_material':      'Registrera material',
    'ao_checklist':     'Hantera checklista',
    'customer_manage':  'Hantera kunder & fastigheter',
    'offer_manage':     'Hantera offerter',
    'invoice_view':     'Visa fakturaunderlag',
    'invoice_create':   'Skapa/redigera fakturaunderlag',
    'staff_view':       'Visa personal',
    'staff_manage':     'Hantera personal',
    'admin_manage':     'Systeminställningar & roller',
    'article_manage':   'Hantera artiklar & prisgrupper',
    'recurring_manage': 'Hantera återkommande ärenden',
    'sales_manage':     'Hantera säljchanser',
    'reports_view':     'Visa rapporter & löneunderlag',
  },

  _PERM_GROUPS: [
    { label: 'Superadmin',         perms: ['all'] },
    { label: 'Dashboard',          perms: ['dashboard_view'] },
    { label: 'Arbetsorder',        perms: ['ao_view_all','ao_view_own','ao_create','ao_edit','ao_complete','ao_time','ao_material','ao_checklist'] },
    { label: 'Kunder & Offerter',  perms: ['customer_manage','offer_manage'] },
    { label: 'Fakturering',        perms: ['invoice_view','invoice_create'] },
    { label: 'Personal & Admin',   perms: ['staff_view','staff_manage','admin_manage','article_manage'] },
    { label: 'Övrigt',             perms: ['recurring_manage','sales_manage','reports_view'] }
  ],

  openEditRole(roleId) {
    const r = (state.roles||[]).find(x => x.id === roleId);
    if (!r) return;
    const perms = r.permissions || [];
    const permMap = this._PERM_LABELS || {};

    const groupsHtml = this._PERM_GROUPS.map((g, gi) => {
      const groupCheckedCount = g.perms.filter(pid => perms.includes(pid)).length;
      const rows = g.perms.map(pid => `
        <label style="display:flex;align-items:center;gap:8px;padding:6px 0 6px 12px;border-bottom:1px solid var(--bg);cursor:pointer;">
          <input type="checkbox" name="role-perm" value="${pid}" ${perms.includes(pid)?'checked':''}
            style="width:15px;height:15px;flex-shrink:0;" onchange="AdminPage._onPermChange(this)">
          <span style="font-size:12px;">${permMap[pid]||pid}</span>
        </label>`).join('');
      return `
        <div style="margin-top:8px;border:1px solid var(--br);border-radius:var(--rs);overflow:hidden;">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:var(--bg);border-bottom:1px solid var(--br);">
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:11px;font-weight:700;color:var(--navy);text-transform:uppercase;letter-spacing:.4px;">${g.label}</span>
              <span class="bdg bdg-${groupCheckedCount>0?'sky':'grey'}" style="font-size:9px;">${groupCheckedCount}/${g.perms.length}</span>
            </div>
            <button type="button" class="btn bghost bxs" style="font-size:10px;padding:2px 7px;"
              onclick="AdminPage._togglePermGroup(${gi})">Markera alla</button>
          </div>
          ${rows}
        </div>`;
    }).join('');

    Modal.open({
      title: `Redigera roll: ${r.label}`,
      wide: true,
      body: `
        <div class="fg"><label>Visningsnamn</label>
          <input id="role-edit-label" value="${r.label}" ${r.isBuiltin?'readonly style="background:var(--bg);"':''}></div>
        <div class="fg"><label>Beskrivning</label>
          <input id="role-edit-desc" value="${r.description||''}" placeholder="Kort beskrivning…"></div>
        <div style="margin-top:4px;">
          <div style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px;">Behörigheter</div>
          ${groupsHtml}
        </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => AdminPage._saveEditRole(roleId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _togglePermGroup(groupIdx) {
    const group = this._PERM_GROUPS[groupIdx];
    if (!group) return;
    const cbs = document.querySelectorAll('input[name="role-perm"]');
    const groupCbs = Array.from(cbs).filter(cb => group.perms.includes(cb.value));
    const allChecked = groupCbs.every(cb => cb.checked);
    groupCbs.forEach(cb => {
      cb.checked = !allChecked;
      this._onPermChange(cb);
    });
  },

  _onPermChange(checkbox) {
    if (checkbox.value === 'all' && checkbox.checked) {
      document.querySelectorAll('input[name="role-perm"]').forEach(cb => { cb.checked = cb.value === 'all'; });
    } else if (checkbox.value !== 'all' && checkbox.checked) {
      const allCb = document.querySelector('input[name="role-perm"][value="all"]');
      if (allCb) allCb.checked = false;
    }
  },

  _saveEditRole(roleId) {
    const idx = (state.roles||[]).findIndex(r => r.id === roleId);
    if (idx < 0) return;
    const label = document.getElementById('role-edit-label')?.value.trim();
    if (!label) { showToast('Visningsnamn krävs'); return; }
    const checked = Array.from(document.querySelectorAll('input[name="role-perm"]:checked')).map(cb => cb.value);
    state.roles[idx] = {
      ...state.roles[idx],
      label,
      description: document.getElementById('role-edit-desc')?.value.trim() || '',
      permissions: checked
    };
    persist(); Modal.close(); AdminPage.render(); showToast('Roll uppdaterad');
  },

  removeRole(roleId) {
    const usageCount = (state.staff||[]).filter(s => s.role === roleId).length;
    if (usageCount > 0) { showToast(`Kan inte ta bort – används av ${usageCount} person${usageCount===1?'':'er'}`); return; }
    if (!confirm('Ta bort rollen?')) return;
    state.roles = (state.roles||[]).filter(r => r.id !== roleId);
    persist(); AdminPage.render(); showToast('Roll borttagen');
  }
};

/* ── Shell-sidor utan rendering ───────── */
const CalendarPage    = { render() { _renderShell('pg-calendar-content',    'Kalender',    'Kalendervy med planerade ordrar byggs i Fas 4.'); } };
const ContractsPage   = { render() { _renderShell('pg-contracts-content',   'Kontrakt',    'Kontrakthantering byggs i Fas 4.'); } };
const InspectionsPage = { render() { RonderingPage.render(); } };
const PayrollPage     = { render() { _renderShell('pg-payroll-content',     'Löneunderlag','Löneunderlag per person byggs i Fas 4.'); } };
const ReportsPage     = { render() { _renderShell('pg-reports-content',     'Rapporter',   'Statistik och rapporter byggs i Fas 4.'); } };

/* ── Hjälpfunktioner ──────────────────── */
function _shellEmpty(title, msg) {
  return `<div class="empty">${ic('settings',36)}<h3>${title}</h3><p>${msg}</p></div>`;
}

function _shellFull(title, msg) {
  return `
    <div class="card">
      <div class="card-header"><h3>${title}</h3></div>
      <div class="card-body"><div class="ibox">${msg}</div></div>
    </div>`;
}

function _renderShell(elId, title, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = _shellFull(title, msg);
}
