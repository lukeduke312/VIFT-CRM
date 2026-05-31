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

/* ── PART 3 + OffersPage ─── */
const OffersPage = {
  _editLines:   [],
  _editExtras:  [],
  _activeSvcId: null,
  _svcFields:   {},

  /* ── Tjänstemallar med kalkylatorer ─── */
  _T: [
    {
      id:'altan', name:'Altantvätt', icon:'refresh-cw', vatRate:25,
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
      id:'sten', name:'Stentvätt', icon:'layers', vatRate:25,
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
      id:'hack', name:'Häckklippning', icon:'scissors', vatRate:25,
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
      id:'fasad', name:'Fasadtvätt', icon:'building-2', vatRate:25,
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
        const rutAmt = f.rot ? Math.round(totalIncVat * 0.3) : 0;
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

  /* ── Offertlista ─────────────────────── */
  render() {
    const el = document.getElementById('pg-offer-content');
    if (!el) return;
    const offers = (state.offers || []).slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    el.innerHTML =
      `<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
         <div style="flex:1;"></div>
         <button class="btn bp bsm" onclick="OffersPage.openCreate()">${ic('plus',14)} Ny offert</button>
       </div>` +
      (offers.length === 0
        ? `<div class="empty">${ic('file-text',36)}<h3>Inga offerter</h3><p>Klicka "Ny offert" för att komma igång</p></div>`
        : offers.map(o => {
            const cu     = getCu(o.customerId);
            const cuName = cu ? CustomerService.displayName(cu) : '—';
            const exVat  = OffersPage._offerExVat(o);
            const disp   = o.title ? o.id + ' – ' + o.title : o.id;
            return `<div class="list-item" onclick="Router.showPage('pg-offer-detail',{offerId:'${o.id}'})">
              <div class="item-row">
                <div style="flex:1;min-width:0;">
                  <div class="item-title">${disp}</div>
                  <div class="item-sub">${cuName} · ${fmt(exVat)} kr ex. moms · ${fmtDate(o.createdAt)}</div>
                </div>
                ${sbdg(o.status)}
              </div>
            </div>`;
          }).join(''));
  },

  _offerExVat(o) {
    return Math.round((o.lines || []).filter(l => l.type !== 'text')
      .reduce((s, l) => s + (l.exVat || l.total || 0), 0));
  },

  /* ── Skapa / Redigera ────────────────── */
  openCreate(preCustomerId) {
    this._editLines  = [];
    this._editExtras = [];
    this._activeSvcId = null;
    this._svcFields   = {};
    Modal.open({
      title: 'Ny offert', wide: true,
      body:  this._formHtml(null, preCustomerId || ''),
      buttons: [
        { label: ic('save',13) + ' Spara offert', cls: 'btn bp', onClick: () => OffersPage._save(null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('off-title')?.focus(), 80);
  },

  openEdit(offerId) {
    const off = getOff(offerId);
    if (!off) return;
    this._activeSvcId = null;
    this._svcFields   = {};
    this._editLines  = (off.lines  || []).map(l => ({...l}));
    this._editExtras = (off.extras || []).map(e => ({...e}));
    Modal.open({
      title: 'Redigera ' + off.id, wide: true,
      body:  this._formHtml(off, null),
      buttons: [
        { label: ic('save',13) + ' Spara', cls: 'btn bp', onClick: () => OffersPage._save(off.id) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('off-title')?.focus(), 80);
  },

  /* ── Formulär HTML ───────────────────── */
  _formHtml(off, preCustomerId) {
    const cuId     = off ? (off.customerId || '') : (preCustomerId || '');
    const today    = new Date().toISOString().split('T')[0];
    const validDef = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
    const T        = this._TERMS;
    const esc      = s => (s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const cuOpts   = [{v:'',l:'— Välj kund —'}, ...(state.customers||[]).map(c=>({v:c.id,l:CustomerService.displayName(c)}))];
    return `
      <div class="g2">
        <div class="fg"><label>Kund <span style="color:var(--rd)">*</span></label>
          ${CustomSelect.render('off-cu',{options:cuOpts,value:cuId,placeholder:'— Välj kund —',searchable:true})}
        </div>
        <div class="fg"><label>Rubrik / titel</label>
          <input id="off-title" value="${esc(off?off.title:'')}" placeholder="T.ex. Serviceavtal 2025 – Solvägen 3"></div>
      </div>
      <div class="g2">
        <div class="fg"><label>Datum</label>
          <input type="date" id="off-date" value="${off?(off.createdAt||'').split('T')[0]||today:today}"></div>
        <div class="fg"><label>Giltig till</label>
          <input type="date" id="off-valid" value="${off?off.validUntil||validDef:validDef}"></div>
      </div>

      <details style="margin-top:8px;border:1px solid var(--br);border-radius:var(--rs);overflow:hidden;">
        <summary style="padding:8px 12px;font-size:12px;font-weight:700;cursor:pointer;background:var(--bg);color:var(--navy);display:flex;align-items:center;gap:6px;">${ic('align-left',12)} Sammanfattning &amp; uppdragsbeskrivning</summary>
        <div style="padding:8px 12px 12px;">
          <div class="fg"><label>Kort sammanfattning</label>
            <textarea id="off-summary" rows="2" placeholder="En mening om vad uppdraget innebär…">${esc(off?off.summary:'')}</textarea></div>
          <div class="fg"><label>Uppdragets omfattning</label>
            <textarea id="off-scope" rows="3" placeholder="Detaljerad beskrivning…">${esc(off?off.scope:'')}</textarea></div>
          <div class="g2">
            <div class="fg"><label>Vad ingår</label>
              <textarea id="off-includes" rows="2" placeholder="T.ex. material, frakt, bortforsling…">${esc(off?off.includes:'')}</textarea></div>
            <div class="fg"><label>Vad ingår ej</label>
              <textarea id="off-excludes" rows="2" placeholder="T.ex. elektriker, målning…">${esc(off?off.excludes:'')}</textarea></div>
          </div>
        </div>
      </details>

      <div style="margin-top:10px;">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:6px;">
          <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--mt);">Offertrader</label>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button type="button" class="btn bs bxs" onclick="OffersPage._addManualLine()">${ic('plus',12)} Manuell rad</button>
            <button type="button" class="btn bp bxs" onclick="OffersPage._toggleSvcPanel()">${ic('zap',12)} Tjänst / kalkylator</button>
            <button type="button" class="btn bs bxs" onclick="OffersPage._addTextBlock()">${ic('align-left',12)} Fritextblock</button>
          </div>
        </div>
        <div id="off-lines">${this._linesHtml()}</div>
      </div>

      <div id="off-svc-panel" style="display:none;margin-top:6px;border:1.5px solid var(--sky,#0ea5e9);border-radius:var(--rs);overflow:hidden;">
        <div style="padding:8px 12px;background:var(--navy);color:#fff;display:flex;align-items:center;justify-content:space-between;">
          <div>
            <span style="font-size:12px;font-weight:700;">${ic('zap',13)} Lägg till tjänst / kalkylator</span>
            <div style="font-size:11px;color:var(--mt);margin-top:2px;">Alla priser anges exklusive moms</div>
          </div>
          <button type="button" style="background:rgba(255,255,255,.15);color:#fff;border:none;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;" onclick="OffersPage._hideSvcPanel()">${ic('x',11)} Stäng</button>
        </div>
        <div style="display:flex;overflow-x:auto;gap:8px;padding:10px 12px;border-bottom:1px solid var(--br);-webkit-overflow-scrolling:touch;">
          ${this._T.map(t=>`<button type="button"
            id="off-svc-type-${t.id}"
            style="white-space:nowrap;padding:8px 14px;border-radius:20px;border:1.5px solid var(--br);font-size:12px;font-weight:600;cursor:pointer;background:#fff;color:var(--tx);flex-shrink:0;display:flex;align-items:center;gap:4px;"
            onclick="OffersPage._selectSvc('${t.id}')">${ic(t.icon,12)} ${t.name}</button>`).join('')}
        </div>
        <div id="off-svc-calc" style="display:none;"></div>
      </div>

      <details style="margin-top:8px;border:1px solid var(--br);border-radius:var(--rs);overflow:hidden;">
        <summary style="padding:8px 12px;font-size:12px;font-weight:700;cursor:pointer;background:var(--bg);color:var(--navy);display:flex;align-items:center;gap:6px;">${ic('plus',12)} Tillval (valfria extratjänster)</summary>
        <div style="padding:8px 12px 12px;">
          <div id="off-extras">${this._extrasHtml()}</div>
          <button type="button" class="btn bs bxs" style="margin-top:6px;" onclick="OffersPage._addExtra()">${ic('plus',11)} Lägg till tillval</button>
        </div>
      </details>

      <div id="off-totals" style="margin-top:8px;padding:12px;background:var(--bg);border-radius:var(--rs);">${this._totalsHtml()}</div>

      <details style="margin-top:8px;border:1px solid var(--br);border-radius:var(--rs);overflow:hidden;" open>
        <summary style="padding:8px 12px;font-size:12px;font-weight:700;cursor:pointer;background:var(--bg);color:var(--navy);display:flex;align-items:center;gap:6px;">${ic('file-text',12)} Betalning &amp; villkor</summary>
        <div style="padding:8px 12px 12px;">
          <div class="g2">
            <div class="fg"><label>Betalningsvillkor</label>
              <input id="off-payment" value="${esc(off?off.paymentTerms:T.payment)}" placeholder="T.ex. 30 dagar netto"></div>
            <div class="fg"><label>Offertens giltighetstid</label>
              <input id="off-validity" value="${esc(off?off.validityText:T.validity)}" placeholder="T.ex. 30 dagar"></div>
          </div>
          <div class="fg"><label>Allmänna villkor</label>
            <textarea id="off-terms" rows="3" placeholder="Allmänna villkor och förbehåll…">${esc(off?off.generalTerms:T.general)}</textarea></div>
        </div>
      </details>

      <div class="fg" style="margin-top:8px;">
        <label>Intern anteckning <span style="font-size:10px;font-weight:400;color:var(--mt);">(visas ej för kund)</span></label>
        <textarea id="off-note" rows="2" placeholder="Intern anteckning om kunden, uppdraget eller förutsättningar…">${esc(off?off.internalNote:'')}</textarea>
      </div>`;
  },

  /* ── Rader ───────────────────────────── */
  _linesHtml() {
    if (!this._editLines.length) return `
      <div style="padding:12px;text-align:center;border:1.5px dashed var(--br);border-radius:var(--rs);color:var(--mt);font-size:12px;">
        Inga rader – lägg till manuell rad, välj tjänst/kalkylator eller lägg till fritextblock.</div>`;
    return this._editLines.map((l, i) => {
      if (l.type === 'text')    return this._renderTextBlock(l, i);
      if (l.type === 'service') return this._renderServiceLine(l, i);
      return this._renderManualLine(l, i);
    }).join('');
  },

  _renderManualLine(l, i) {
    const units = ['st','tim','m','m²','m³','lm','kg','l','paket','mån'];
    return `<div style="display:grid;grid-template-columns:1fr 58px 66px 86px 66px 26px;gap:4px;align-items:center;padding:4px 2px;border-bottom:1px solid var(--bg);">
      <input style="width:100%;font-size:12px;" value="${(l.description||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;')}" placeholder="Benämning"
        oninput="OffersPage._editLines[${i}].description=this.value">
      <input type="number" style="width:100%;text-align:right;font-size:12px;" value="${l.qty!=null?l.qty:1}" min="0" step="0.5"
        oninput="OffersPage._editLines[${i}].qty=parseFloat(this.value)||0;OffersPage._calcTotals()">
      <select style="width:100%;font-size:12px;" onchange="OffersPage._editLines[${i}].unit=this.value">
        ${units.map(u=>'<option'+(( l.unit||'st')===u?' selected':'')+'>'+u+'</option>').join('')}
      </select>
      <input type="number" style="width:100%;text-align:right;font-size:12px;" value="${l.unitPrice||0}" min="0" step="0.01"
        oninput="OffersPage._editLines[${i}].unitPrice=parseFloat(this.value)||0;OffersPage._calcTotals()">
      <div style="font-size:12px;font-weight:700;color:var(--navy);text-align:right;padding:0 4px;" id="off-lt-${i}">
        ${fmt(Math.round((l.qty!=null?l.qty:1)*(l.unitPrice||0)))} kr</div>
      <button type="button" class="btn bd bxs" style="padding:3px 4px;" onclick="OffersPage._removeLine(${i})">${ic('x',10)}</button>
    </div>`;
  },

  _renderServiceLine(l, i) {
    const vat = Math.round((l.exVat||0) * (l.vatRate||25) / 100);
    const incVat = (l.exVat||0) + vat;
    const custPrice = incVat - (l.rutAmount||0);
    return `<div style="background:var(--bg);border-radius:var(--rs);padding:8px 10px;margin:4px 0;border-left:3px solid var(--navy);">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:10px;font-weight:800;color:var(--navy);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">
            ${ic('zap',11)} ${l.templateName||'Tjänst'}</div>
          ${l.calculationNote?`<div style="font-size:10px;color:var(--mt);margin-bottom:3px;font-style:italic;">Prisnivå: ${l.calculationNote.replace('Prisnivå: ','')}</div>`:''}
          ${(l.subLines||[]).map(sl=>`<div style="font-size:11px;color:var(--tx);margin-bottom:1px;">${sl.desc} – ${sl.qty} ${sl.unit} × ${fmt(sl.price)} kr = <strong>${fmt(Math.round(sl.qty*sl.price))} kr</strong></div>`).join('')}
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:13px;font-weight:800;color:var(--navy);">${fmt(l.exVat||0)} kr</div>
          ${l.rutAmount?`<div style="font-size:10px;color:var(--grn);">RUT/ROT -${fmt(l.rutAmount)} kr</div>`:''}
          ${l.rutAmount?`<div style="font-size:11px;font-weight:700;color:var(--grn);">Kund: ${fmt(custPrice)} kr inkl.</div>`:''}
          <div style="font-size:10px;color:var(--mt);">ex. moms</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-top:6px;">
        <input style="flex:1;font-size:11px;" value="${(l.description||'').replace(/"/g,'&quot;')}"
          placeholder="Beskrivning på offerten (redigerbar)…"
          oninput="OffersPage._editLines[${i}].description=this.value">
        <button type="button" class="btn bd bxs" style="padding:3px 5px;" onclick="OffersPage._removeLine(${i})">${ic('trash-2',11)}</button>
      </div>
    </div>`;
  },

  _renderTextBlock(l, i) {
    return `<div style="border:1px solid var(--br);border-radius:var(--rs);padding:8px 10px;margin:4px 0;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        <span style="font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase;flex-shrink:0;">${ic('align-left',11)} Fritext</span>
        <input style="flex:1;font-size:12px;font-weight:600;" value="${(l.blockTitle||'').replace(/"/g,'&quot;')}"
          placeholder="Rubrik (t.ex. Förutsättningar, Kundens ansvar…)"
          oninput="OffersPage._editLines[${i}].blockTitle=this.value">
        <button type="button" class="btn bd bxs" style="padding:3px 4px;" onclick="OffersPage._removeLine(${i})">${ic('x',10)}</button>
      </div>
      <textarea style="width:100%;font-size:12px;" rows="3" placeholder="Fritext som visas på offerten…"
        oninput="OffersPage._editLines[${i}].text=this.value">${l.text||''}</textarea>
    </div>`;
  },

  /* ── Tillval ─────────────────────────── */
  _extrasHtml() {
    if (!this._editExtras.length) return `<p style="font-size:12px;color:var(--mt);margin:0;">Inga tillval ännu.</p>`;
    const units = ['st','tim','m','m²','kg','paket'];
    return this._editExtras.map((e, i) => `
      <div style="display:grid;grid-template-columns:1fr 58px 66px 86px 26px;gap:4px;align-items:center;padding:4px 2px;border-bottom:1px solid var(--bg);">
        <input style="width:100%;font-size:12px;" value="${(e.description||'').replace(/"/g,'&quot;')}" placeholder="Beskrivning av tillval"
          oninput="OffersPage._editExtras[${i}].description=this.value">
        <input type="number" style="width:100%;text-align:right;font-size:12px;" value="${e.qty||1}" min="0" step="0.5"
          oninput="OffersPage._editExtras[${i}].qty=parseFloat(this.value)||0;OffersPage._calcTotals()">
        <select style="width:100%;font-size:12px;" onchange="OffersPage._editExtras[${i}].unit=this.value">
          ${units.map(u=>'<option'+((e.unit||'st')===u?' selected':'')+'>'+u+'</option>').join('')}
        </select>
        <input type="number" style="width:100%;text-align:right;font-size:12px;" value="${e.unitPrice||0}" min="0" step="0.01"
          oninput="OffersPage._editExtras[${i}].unitPrice=parseFloat(this.value)||0;OffersPage._calcTotals()">
        <button type="button" class="btn bd bxs" style="padding:3px 4px;" onclick="OffersPage._removeExtra(${i})">${ic('x',10)}</button>
      </div>`).join('');
  },

  /* ── Totaler ─────────────────────────── */
  _totalsHtml() {
    const lExVat = this._editLines.filter(l => l.type !== 'text')
      .reduce((s, l) => s + (l.type === 'service' ? (l.exVat||0) : Math.round((l.qty!=null?l.qty:1)*(l.unitPrice||0))), 0);
    const eExVat = this._editExtras.reduce((s, e) => s + Math.round((e.qty||1)*(e.unitPrice||0)), 0);
    const exVat  = Math.round(lExVat + eExVat);
    const vat    = Math.round(exVat * 0.25);
    const incVat = exVat + vat;
    const rutAmt = Math.round(this._editLines.filter(l=>l.type==='service').reduce((s,l)=>s+(l.rutAmount||0),0));
    const cust   = incVat - rutAmt;
    return `<div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;">
      <div style="font-size:12px;color:var(--mt);">Summa ex. moms: <strong>${fmt(exVat)} kr</strong></div>
      <div style="font-size:12px;color:var(--mt);">Moms 25 %: <strong>${fmt(vat)} kr</strong></div>
      <div style="font-size:12px;color:var(--mt);">Totalt inkl. moms: <strong>${fmt(incVat)} kr</strong></div>
      ${rutAmt?`<div style="font-size:12px;color:var(--grn);">RUT/ROT-reduktion: <strong>-${fmt(rutAmt)} kr</strong></div>`:''}
      <div style="font-size:16px;font-weight:800;color:var(--navy);margin-top:4px;border-top:2px solid var(--br);padding-top:6px;">
        ${rutAmt?'Kundpris inkl. moms:':'Totalt inkl. moms:'} ${fmt(cust)} kr</div>
    </div>`;
  },

  /* ── Tjänstekalkylator panel ─────────── */
  _toggleSvcPanel() {
    const p = document.getElementById('off-svc-panel');
    if (!p) return;
    const opening = p.style.display === 'none';
    p.style.display = opening ? 'block' : 'none';
    if (opening) setTimeout(() => p.scrollIntoView({behavior:'smooth',block:'nearest'}), 50);
  },

  _hideSvcPanel() {
    const p = document.getElementById('off-svc-panel');
    if (p) p.style.display = 'none';
    this._activeSvcId = null;
    this._svcFields   = {};
    this._T.forEach(t => {
      const btn = document.getElementById('off-svc-type-' + t.id);
      if (btn) {
        btn.style.background = '#fff';
        btn.style.color      = 'var(--tx)';
        btn.style.borderColor = 'var(--br)';
        btn.style.fontWeight  = '600';
      }
    });
    const calc = document.getElementById('off-svc-calc');
    if (calc) { calc.style.display = 'none'; calc.innerHTML = ''; }
  },

  _selectSvc(tId) {
    this._activeSvcId = tId;

    // Update type selector chip styles
    this._T.forEach(t => {
      const btn = document.getElementById('off-svc-type-' + t.id);
      if (!btn) return;
      const active = t.id === tId;
      btn.style.background  = active ? 'var(--navy)' : '#fff';
      btn.style.color       = active ? '#fff'        : 'var(--tx)';
      btn.style.borderColor = active ? 'var(--navy)' : 'var(--br)';
      btn.style.fontWeight  = active ? '700'         : '600';
    });

    const tmpl = this._T.find(t => t.id === tId);
    const calc = document.getElementById('off-svc-calc');
    if (!tmpl || !calc) return;

    // Initialize field defaults before rendering
    this._svcFields = {};
    tmpl.fields.forEach(f => {
      if (f.def !== undefined) this._svcFields[f.id] = f.def;
      else if (f.type === 'chips' && f.opts && f.opts[0]) this._svcFields[f.id] = f.opts[0];
      else if (f.type === 'bool') this._svcFields[f.id] = false;
      else if (f.type === 'number') this._svcFields[f.id] = 0;
      else if (f.type === 'text') this._svcFields[f.id] = '';
    });

    calc.style.display = 'block';
    calc.innerHTML = this._svcCalcHtml(tmpl);
    setTimeout(() => { this._initChips(); this._updateSvcPreview(); }, 20);
  },

  /* ── PART 7: _setChip ─── */
  _setChip(fieldId, value, btn) {
    this._svcFields[fieldId] = value;
    const group = btn.closest('[data-chips]');
    if (group) {
      group.querySelectorAll('button').forEach(b => {
        const active = b === btn;
        b.style.background  = active ? 'var(--navy)' : '#fff';
        b.style.color       = active ? '#fff'        : 'var(--tx)';
        b.style.borderColor = active ? 'var(--navy)' : 'var(--br)';
        b.style.fontWeight  = active ? '700'         : '600';
      });
    }
    this._updateSvcPreview();
  },

  /* ── PART 8: _initChips ─── */
  _initChips() {
    const tmpl = this._T.find(t => t.id === this._activeSvcId);
    if (!tmpl) return;
    tmpl.fields.filter(f => f.type === 'chips').forEach(f => {
      const val   = this._svcFields[f.id] || f.def || (f.opts && f.opts[0]);
      const group = document.querySelector('[data-chips="' + f.id + '"]');
      if (!group) return;
      group.querySelectorAll('button').forEach(btn => {
        const active = btn.dataset.val === val || btn.textContent.trim() === val;
        btn.style.background  = active ? 'var(--navy)' : '#fff';
        btn.style.color       = active ? '#fff'        : 'var(--tx)';
        btn.style.borderColor = active ? 'var(--navy)' : 'var(--br)';
        btn.style.fontWeight  = active ? '700'         : '600';
      });
    });
  },

  /* ── PART 4: _svcCalcHtml — mobile-first ─── */
  _svcCalcHtml(tmpl) {
    const numberFields = tmpl.fields.filter(f => f.type === 'number');
    const chipsFields  = tmpl.fields.filter(f => f.type === 'chips');
    const textFields   = tmpl.fields.filter(f => f.type === 'text');
    const boolFields   = tmpl.fields.filter(f => f.type === 'bool' && !f.isRut && !f.isRot);
    const rutField     = tmpl.fields.find(f => f.isRut);
    const rotField     = tmpl.fields.find(f => f.isRot);

    let html = `<div style="padding:10px 12px;">`;

    // Number fields — large prominent
    numberFields.forEach(f => {
      const unitLabel = f.id === 'area' ? 'm²' : f.id === 'length' ? 'lm' : f.id === 'hours' ? 'tim' : f.id === 'qty' ? 'tim' : f.id === 'months' ? 'mån' : '';
      const currVal   = this._svcFields[f.id] != null && this._svcFields[f.id] !== 0 ? this._svcFields[f.id] : (f.def || '');
      html += `<div style="margin-bottom:14px;">
        <label style="font-size:13px;font-weight:700;color:var(--navy);">${f.label}${f.req?` <span style="color:var(--rd)">*</span>`:''}</label>
        <div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
          <input type="number" id="svc-f-${f.id}" value="${currVal}" min="0" step="${f.id==='rate'||f.id==='monthly'||f.id==='material'?'1':'0.5'}" placeholder="0"
            style="font-size:22px;font-weight:700;width:110px;text-align:center;padding:8px 10px;border:2px solid var(--navy);border-radius:var(--rs);"
            oninput="OffersPage._svcFields['${f.id}']=parseFloat(this.value)||0;OffersPage._updateSvcPreview()">
          ${unitLabel?`<span style="font-size:16px;color:var(--mt);font-weight:600;">${unitLabel}</span>`:''}
        </div>
      </div>`;
    });

    // Text fields
    textFields.forEach(f => {
      html += `<div style="margin-bottom:14px;">
        <label style="font-size:13px;font-weight:700;color:var(--navy);">${f.label}${f.req?` <span style="color:var(--rd)">*</span>`:''}</label>
        <input type="text" id="svc-f-${f.id}" value="${this._svcFields[f.id]||''}" placeholder="${f.label}"
          style="width:100%;margin-top:6px;font-size:14px;"
          oninput="OffersPage._svcFields['${f.id}']=this.value;OffersPage._updateSvcPreview()">
      </div>`;
    });

    // Chips fields
    chipsFields.forEach(f => {
      html += `<div style="margin-bottom:12px;">
        <label style="font-size:12px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.4px;">${f.label}</label>
        <div data-chips="${f.id}" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">
          ${(f.opts||[]).map(opt => `<button type="button" data-val="${opt}"
            style="padding:7px 14px;border-radius:20px;border:1.5px solid var(--br);font-size:12px;font-weight:600;cursor:pointer;background:#fff;color:var(--tx);"
            onclick="OffersPage._setChip('${f.id}','${opt.replace(/'/g,"\\'")}',this)">${opt}</button>`).join('')}
        </div>
      </div>`;
    });

    // Bool addons (non-RUT/ROT)
    if (boolFields.length) {
      html += `<div style="margin-bottom:12px;">
        <label style="font-size:12px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.4px;">TILLVAL</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px;">`;
      boolFields.forEach(f => {
        html += `<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1.5px solid var(--br);border-radius:var(--rs);cursor:pointer;font-size:12px;font-weight:600;">
          <input type="checkbox" id="svc-f-${f.id}" style="width:18px;height:18px;" ${this._svcFields[f.id]?'checked':''}
            onchange="OffersPage._svcFields['${f.id}']=this.checked;OffersPage._updateSvcPreview()">
          ${f.addLabel||f.label}
        </label>`;
      });
      html += `</div></div>`;
    }

    // RUT toggle
    if (rutField) {
      html += `<div style="margin-bottom:12px;">
        <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:2px solid var(--grn);border-radius:var(--rs);cursor:pointer;background:rgba(34,197,94,.05);">
          <input type="checkbox" id="svc-f-${rutField.id}" style="width:20px;height:20px;" ${this._svcFields[rutField.id]?'checked':''}
            onchange="OffersPage._svcFields['${rutField.id}']=this.checked;OffersPage._updateSvcPreview()">
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--grn);">RUT-avdrag (50 %)</div>
            <div style="font-size:11px;color:var(--mt);">Förutsätter att kunden har rätt till avdraget</div>
          </div>
        </label>
      </div>`;
    }

    // ROT toggle
    if (rotField) {
      html += `<div style="margin-bottom:12px;">
        <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:2px solid var(--sky,#0ea5e9);border-radius:var(--rs);cursor:pointer;background:rgba(14,165,233,.05);">
          <input type="checkbox" id="svc-f-${rotField.id}" style="width:20px;height:20px;" ${this._svcFields[rotField.id]?'checked':''}
            onchange="OffersPage._svcFields['${rotField.id}']=this.checked;OffersPage._updateSvcPreview()">
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--sky,#0ea5e9);">ROT-avdrag (30 %)</div>
            <div style="font-size:11px;color:var(--mt);">Förutsätter att kunden har rätt till avdraget</div>
          </div>
        </label>
      </div>`;
    }

    // Price preview box
    html += `<div id="svc-preview" style="background:var(--navy);color:#fff;border-radius:var(--rs);padding:14px;margin-top:10px;min-height:60px;">
      <div style="font-size:12px;opacity:.7;">Fyll i fälten ovan för att se kalkylen…</div>
    </div>`;

    // Description field
    html += `<div style="margin-top:8px;">
      <label style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.4px;">BESKRIVNING PÅ OFFERTEN</label>
      <input id="svc-custom-desc" style="width:100%;margin-top:4px;" value="${(tmpl.defaultDesc||'').replace(/"/g,'&quot;')}" placeholder="Kundvänlig beskrivning…">
    </div>`;

    // Add button
    html += `<button type="button" class="btn bp bfull" style="margin-top:10px;padding:13px;font-size:14px;font-weight:800;letter-spacing:.3px;"
      onclick="OffersPage._addSvcLine()">
      ${ic('plus',16)} Lägg till i offert
    </button>`;

    html += `</div>`; // close padding div
    return html;
  },

  /* ── PART 5: _updateSvcPreview ─── */
  _updateSvcPreview() {
    const tmpl = this._T.find(t => t.id === this._activeSvcId);
    const prev = document.getElementById('svc-preview');
    if (!tmpl || !prev) return;

    // Sync DOM values into _svcFields for non-chip fields
    tmpl.fields.forEach(f => {
      if (f.type === 'chips') return; // chips already updated via _setChip
      const el = document.getElementById('svc-f-' + f.id);
      if (!el) return;
      if (f.type === 'bool')        this._svcFields[f.id] = el.checked;
      else if (f.type === 'number') this._svcFields[f.id] = parseFloat(el.value) || 0;
      else                          this._svcFields[f.id] = el.value;
    });

    try {
      const result = tmpl.calc(this._svcFields);
      const {ls, exVat, rutAmt} = result;
      const tierLbl = result.tierLbl || '';

      if (!exVat && exVat !== 0) {
        prev.innerHTML = `<div style="font-size:12px;opacity:.7;">Fyll i obligatoriska fält för att se kalkylen.</div>`;
        return;
      }

      const vat     = Math.round(exVat * (tmpl.vatRate||25) / 100);
      const incVat  = exVat + vat;
      const custPr  = incVat - (rutAmt||0);

      let html = '';
      if (tierLbl) {
        html += `<div style="font-size:11px;opacity:.7;margin-bottom:8px;">PRISNIVÅ: ${tierLbl}</div>`;
      }

      // Line breakdown
      html += `<div style="font-size:12px;margin-bottom:6px;">`;
      ls.forEach(l => {
        const tot = Math.round(l.qty * l.price);
        html += `<div style="margin-bottom:3px;">${l.desc}: ${l.qty} ${l.unit} × ${fmt(l.price)} kr = <strong>${fmt(tot)} kr</strong></div>`;
      });
      html += `</div>`;

      // Summary box
      html += `<div style="border-top:1px solid rgba(255,255,255,.2);margin:8px 0;padding-top:8px;">
        <div style="font-size:12px;margin-bottom:2px;">Summa ex. moms: <strong>${fmt(exVat)} kr</strong></div>
        <div style="font-size:12px;margin-bottom:2px;">Moms ${tmpl.vatRate||25}%: <strong>${fmt(vat)} kr</strong></div>
        <div style="font-size:14px;font-weight:800;margin-top:4px;">Totalt inkl. moms: ${fmt(incVat)} kr</div>
      </div>`;

      // RUT/ROT section
      if (rutAmt) {
        const isRot = tmpl.fields.some(f => f.isRot && this._svcFields[f.id]);
        const label = isRot ? 'ROT-avdrag (30%)' : 'RUT-avdrag (50%)';
        html += `<div style="border-top:1px solid rgba(255,255,255,.2);margin:8px 0;padding-top:8px;color:#86efac;">
          <div style="font-size:12px;margin-bottom:2px;">Prelim. ${label}: -${fmt(rutAmt)} kr</div>
          <div style="font-size:14px;font-weight:800;">Kundpris efter avdrag: ${fmt(custPr)} kr</div>
          <div style="font-size:10px;opacity:.7;margin-top:4px;">* Avdraget är preliminärt och förutsätter att kunden har rätt till skattereduktion.</div>
        </div>`;
      }

      prev.innerHTML = html;
    } catch(e) {
      prev.innerHTML = `<div style="font-size:12px;opacity:.7;">Fyll i obligatoriska fält (markerade med *) för att se kalkyl.</div>`;
    }
  },

  /* ── PART 6: _addSvcLine ─── */
  _addSvcLine() {
    const tmpl = this._T.find(t => t.id === this._activeSvcId);
    if (!tmpl) { showToast('Välj en tjänstetyp'); return; }

    // Sync all DOM values
    tmpl.fields.forEach(f => {
      if (f.type === 'chips') return;
      const el = document.getElementById('svc-f-' + f.id);
      if (!el) return;
      if (f.type === 'bool')        this._svcFields[f.id] = el.checked;
      else if (f.type === 'number') this._svcFields[f.id] = parseFloat(el.value) || 0;
      else                          this._svcFields[f.id] = el.value;
    });

    const missing = tmpl.fields.filter(f => f.req && !this._svcFields[f.id] && this._svcFields[f.id] !== 0);
    if (missing.length) { showToast('Fyll i: ' + missing.map(f => f.label).join(', ')); return; }

    const result  = tmpl.calc(this._svcFields);
    const {ls, exVat, rutAmt} = result;
    const desc = (document.getElementById('svc-custom-desc')?.value || '').trim() || tmpl.defaultDesc;

    this._editLines.push({
      id:            'SVC' + Date.now(),
      type:          'service',
      templateId:    tmpl.id,
      templateName:  tmpl.name,
      description:   desc,
      subLines:      ls.map(l => ({...l})),
      exVat:         Math.round(exVat),
      vatRate:       tmpl.vatRate,
      rutAmount:     Math.round(rutAmt || 0),
      total:         Math.round(exVat),
      inputValues:   {...this._svcFields},
      priceRuleRef:  tmpl.id,
      tierLbl:       result.tierLbl || '',
      calculationNote: result.tierLbl ? 'Prisnivå: ' + result.tierLbl : ''
    });

    const el = document.getElementById('off-lines');
    if (el) el.innerHTML = this._linesHtml();
    this._calcTotals();
    this._hideSvcPanel();
    showToast(tmpl.name + ' tillagd');
  },

  /* ── Hantera rader ───────────────────── */
  _addManualLine() {
    this._editLines.push({id:'M'+Date.now(), type:'manual', description:'', qty:1, unit:'st', unitPrice:0, vatRate:25, total:0});
    const el = document.getElementById('off-lines');
    if (el) el.innerHTML = this._linesHtml();
    this._calcTotals();
    setTimeout(() => {
      const inputs = document.querySelectorAll('#off-lines input[placeholder="Benämning"]');
      if (inputs.length) inputs[inputs.length-1].focus();
    }, 50);
  },

  _addTextBlock() {
    this._editLines.push({id:'T'+Date.now(), type:'text', blockTitle:'', text:''});
    const el = document.getElementById('off-lines');
    if (el) el.innerHTML = this._linesHtml();
  },

  _removeLine(idx) {
    this._editLines.splice(idx, 1);
    const el = document.getElementById('off-lines');
    if (el) el.innerHTML = this._linesHtml();
    this._calcTotals();
  },

  _addExtra() {
    this._editExtras.push({id:'E'+Date.now(), description:'', qty:1, unit:'st', unitPrice:0, vatRate:25});
    const el = document.getElementById('off-extras');
    if (el) el.innerHTML = this._extrasHtml();
  },

  _removeExtra(idx) {
    this._editExtras.splice(idx, 1);
    const el = document.getElementById('off-extras');
    if (el) el.innerHTML = this._extrasHtml();
    this._calcTotals();
  },

  _calcTotals() {
    this._editLines.forEach((l, i) => {
      if (l.type === 'manual') {
        const el = document.getElementById('off-lt-' + i);
        if (el) el.textContent = fmt(Math.round((l.qty!=null?l.qty:1)*(l.unitPrice||0))) + ' kr';
      }
    });
    const totEl = document.getElementById('off-totals');
    if (totEl) totEl.innerHTML = this._totalsHtml();
  },

  /* ── Spara ───────────────────────────── */
  _save(offerId) {
    const cuId = document.getElementById('off-cu')?.value || '';
    if (!cuId) { showToast('Välj en kund'); return; }

    const cleanLines = this._editLines.filter(l => {
      if (l.type === 'text')    return (l.blockTitle || '').trim() || (l.text || '').trim();
      if (l.type === 'service') return true;
      return (l.description || '').trim() || (l.unitPrice || 0) > 0;
    });
    if (!cleanLines.some(l => l.type !== 'text')) {
      showToast('Lägg till minst en offertrad eller tjänst'); return;
    }
    const cleanExtras = this._editExtras.filter(e => (e.description||'').trim() || (e.unitPrice||0) > 0);
    const now     = new Date().toISOString();
    const dateVal = document.getElementById('off-date')?.value || '';

    const data = {
      customerId:   cuId,
      title:        document.getElementById('off-title')?.value.trim() || '',
      summary:      document.getElementById('off-summary')?.value.trim() || '',
      scope:        document.getElementById('off-scope')?.value.trim() || '',
      includes:     document.getElementById('off-includes')?.value.trim() || '',
      excludes:     document.getElementById('off-excludes')?.value.trim() || '',
      lines:        cleanLines.map(l => l.type==='manual'?{...l,total:Math.round((l.qty!=null?l.qty:1)*(l.unitPrice||0))}:{...l}),
      extras:       cleanExtras,
      validUntil:   document.getElementById('off-valid')?.value || '',
      paymentTerms: document.getElementById('off-payment')?.value.trim() || '',
      validityText: document.getElementById('off-validity')?.value.trim() || '',
      generalTerms: document.getElementById('off-terms')?.value.trim() || '',
      internalNote: document.getElementById('off-note')?.value.trim() || '',
      updatedAt:    now
    };

    if (!offerId) {
      const newOff = Object.assign(Schema.offer(), data, {
        id: newId(state.offers, 'OFF'), status: 'utkast',
        createdAt: dateVal ? dateVal + 'T00:00:00.000Z' : now
      });
      state.offers.push(newOff);
      persist(); Modal.close();
      Router.showPage('pg-offer');
      showToast('Offert ' + newOff.id + ' skapad');
    } else {
      const idx = (state.offers||[]).findIndex(o => o.id === offerId);
      if (idx < 0) return;
      state.offers[idx] = Object.assign({}, state.offers[idx], data);
      persist(); Modal.close();
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

    const exVat  = Math.round(
      prLines.reduce((s,l) => s + (l.exVat||l.total||0), 0) +
      extras.reduce((s,e) => s + Math.round((e.qty||1)*(e.unitPrice||0)), 0)
    );
    const vat    = Math.round(exVat * 0.25);
    const incVat = exVat + vat;
    const rutAmt = Math.round(prLines.filter(l=>l.type==='service').reduce((s,l)=>s+(l.rutAmount||0),0));
    const cust   = incVat - rutAmt;

    el.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
        <button class="btn bs bsm" onclick="Router.back()">${ic('arrow-left',14)}</button>
        <div style="flex:1;min-width:0;">
          <div style="font-size:15px;font-weight:800;">${off.id}${off.title?' – '+off.title:''}</div>
          <div style="margin-top:3px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
            ${sbdg(off.status)}
            ${off.validUntil?`<span style="font-size:11px;color:var(--mt);">Giltig till ${fmtDate(off.validUntil)}</span>`:''}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          <button class="btn bs bsm" onclick="OffersPage.openEdit('${off.id}')">${ic('pencil',13)} Redigera</button>
          <button class="btn bs bsm" onclick="OfferDetailPage.duplicate('${off.id}')">${ic('copy',13)} Duplicera</button>
          ${CustomSelect.render('offd-status',{
            options:[{v:'utkast',l:'Utkast'},{v:'skickad',l:'Skickad'},{v:'väntar',l:'Väntar svar'},{v:'godkänd',l:'Godkänd'},{v:'nekad',l:'Nekad'},{v:'utgången',l:'Utgången'}],
            value:off.status, onchange:'OfferDetailPage.setStatus(this.value)'
          })}
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>${ic('user',13)} Offereras till</h3></div>
        <div class="card-body">
          <div class="dr"><span class="dk">Kund</span><span class="dv">${cu?CustomerService.displayName(cu):'—'}</span></div>
          ${cu?`<div class="dr"><span class="dk">Adress</span><span class="dv">${[cu.address,cu.zip,cu.city].filter(Boolean).join(', ')||'—'}</span></div>`:''}
          <div class="dr"><span class="dk">Datum</span><span class="dv">${fmtDate(off.createdAt)}</span></div>
          ${off.validUntil?`<div class="dr"><span class="dk">Giltig till</span><span class="dv">${fmtDate(off.validUntil)}</span></div>`:''}
          ${off.paymentTerms?`<div class="dr"><span class="dk">Betalning</span><span class="dv">${off.paymentTerms}</span></div>`:''}
          ${off.validityText?`<div class="dr"><span class="dk">Giltighetstid</span><span class="dv">${off.validityText}</span></div>`:''}
        </div>
      </div>

      ${off.summary||off.scope||off.includes||off.excludes?`
      <div class="card">
        <div class="card-header"><h3>${ic('align-left',13)} Uppdragsbeskrivning</h3></div>
        <div class="card-body">
          ${off.summary?`<div class="dr"><span class="dk">Sammanfattning</span><span class="dv" style="white-space:pre-wrap;">${off.summary}</span></div>`:''}
          ${off.scope?`<div class="dr"><span class="dk">Omfattning</span><span class="dv" style="white-space:pre-wrap;">${off.scope}</span></div>`:''}
          ${off.includes?`<div class="dr"><span class="dk">Ingår</span><span class="dv" style="white-space:pre-wrap;">${off.includes}</span></div>`:''}
          ${off.excludes?`<div class="dr"><span class="dk">Ingår ej</span><span class="dv" style="white-space:pre-wrap;">${off.excludes}</span></div>`:''}
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
                  ${(l.subLines||[]).map(sl=>`<div style="font-size:11px;color:var(--tx);margin-bottom:2px;">${sl.desc} – ${sl.qty} ${sl.unit} × ${fmt(sl.price)} kr = <strong>${fmt(Math.round(sl.qty*sl.price))} kr</strong></div>`).join('')}
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
        <div style="padding:12px 14px;border-top:2px solid var(--br);">
          <div class="dr"><span class="dk">Summa ex. moms</span><span class="dv">${fmt(exVat)} kr</span></div>
          <div class="dr"><span class="dk">Moms 25 %</span><span class="dv">${fmt(vat)} kr</span></div>
          <div class="dr"><span class="dk">Totalt inkl. moms</span><span class="dv">${fmt(incVat)} kr</span></div>
          ${rutAmt?`<div class="dr" style="color:var(--grn);"><span class="dk">RUT/ROT-reduktion</span><span class="dv">-${fmt(rutAmt)} kr</span></div>`:''}
          <div class="dr" style="font-size:16px;font-weight:800;border-top:2px solid var(--br);padding-top:8px;margin-top:4px;">
            <span class="dk" style="color:var(--navy);">${rutAmt?'Kundpris inkl. moms':'Totalt inkl. moms'}</span>
            <span class="dv" style="color:var(--navy);">${fmt(cust)} kr</span>
          </div>
          ${rutAmt?`<div style="font-size:10px;color:var(--mt);margin-top:4px;text-align:right;">* Avdraget är preliminärt och förutsätter att kunden har rätt till skattereduktion.</div>`:''}
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

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">
        ${off.status==='utkast'?`<button class="btn bp bsm" onclick="OfferDetailPage.setStatus('skickad')">${ic('send',13)} Markera skickad</button>`:''}
        ${(off.status==='skickad'||off.status==='väntar')?`
          <button class="btn bsu bsm" onclick="OfferDetailPage.setStatus('godkänd')">${ic('check-circle',13)} Godkänd / Accepterad</button>
          <button class="btn bd bsm" onclick="OfferDetailPage.setStatus('nekad')">${ic('x-circle',13)} Nekad</button>`:''}
        ${off.status==='godkänd'&&!off.workOrderId?`<button class="btn bp bsm" onclick="OfferDetailPage.createAO()">${ic('clipboard-list',13)} Skapa arbetsorder</button>`:''}
        ${off.workOrderId?`<button class="btn bs bsm" onclick="Router.showPage('pg-ao-detail',{aoId:'${off.workOrderId}'})">${ic('clipboard-list',13)} Se AO: ${off.workOrderId}</button>`:''}
      </div>`;
  },

  setStatus(status) {
    const off = getOff(this.offerId);
    if (!off) return;
    off.status    = status;
    off.updatedAt = new Date().toISOString();
    if (status === 'skickad') off.sentAt     = new Date().toISOString();
    if (status === 'godkänd' || status === 'nekad') off.answeredAt = new Date().toISOString();
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
    // Build title from offer title or service template names
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
    persist();
    this.render({offerId: this.offerId});
    showToast('AO ' + ao.id + ' skapad');
    setTimeout(() => Router.showPage('pg-ao-detail', {aoId: ao.id}), 800);
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
