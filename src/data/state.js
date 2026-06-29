/**
 * state.js — Centralt applikations-state
 * Allt data och UI-state på ett ställe
 */

let state = {
  // Autentisering
  currentUser: null,

  // Data
  customers: [],
  workOrders: [],
  offers: [],
  invoices: [],
  staff: [],
  roles: [],
  properties: [],
  contracts: [],
  inspections: [],
  timeEntries: [],
  articles: [],
  priceGroups: [],
  priceProfiles: [],
  titles: [],
  recurringOrders: [],
  salesOpportunities: [],
  activityLog: [],
  settings: {},
  ronderingsmallar: [],
  ronderingar: [],
  avvikelser: [],
  activities: [],
  serviceTemplates: [],
  emailTemplates: [],
  notifications: [],
  propertyCategories: [],
  ronderingspass: [],

  // UI-state
  currentPage: 'dash',
  currentAO: null,
  currentOffer: null,
  currentInvoice: null,
  currentProperty: null,
  currentCustomer: null,

  // Filters
  aoFilter: 'alla',
  customerTypeFilter: 'alla',

  // Stämpling
  stampActive: false,
  stampTimestamp: null,
  stampAoId: null
};

/**
 * Initiera state från Supabase (ett bulk-anrop), fall back på localStorage → seed-data.
 * Kräver att Auth.getAccessToken() returnerar ett giltigt JWT (RLS blockerar anon).
 */
async function initState() {
  let d = {};
  try {
    /* 8-sekunders timeout — om Supabase är långsam/offline faller vi tillbaka
     * på localStorage direkt utan att hänga på "Laddar data" */
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000));
    d = await Promise.race([Storage.getAll(), timeout]);
  } catch(e) {
    console.warn('[initState] Supabase ej tillgänglig, använder localStorage:', e.message);
    d = Storage._localAll();
  }

  const g = key => (d[key] !== undefined && d[key] !== null) ? d[key] : null;

  /* ── Transaktionell CRM-data: tom lista om inget finns i Supabase ──────
   * Faller INTE tillbaka på SeedData — annars visas demo-siffror i badges
   * och filterpanelen för en installation som saknar riktig data.          */
  state.customers          = g('customers')        || [];
  state.workOrders         = g('workOrders')       || [];
  state.offers             = g('offers')           || [];
  state.invoices           = g('invoices')         || [];
  state.properties         = g('properties')       || [];
  state.salesOpportunities = g('salesOpps')        || [];
  state.activityLog        = g('activityLog')      || [];
  state.timeEntries        = g('timeEntries')      || [];
  state.contracts          = g('contracts')        || [];
  state.recurringOrders    = g('recurringOrders')  || [];
  state.ronderingar        = g('ronderingar')      || [];
  state.avvikelser         = g('avvikelser')       || [];
  state.activities         = g('activities')       || [];
  state.notifications      = g('notifications')    || [];
  state.ronderingspass     = g('ronderingspass')   || [];

  /* ── Konfigurations- och referensdata: SeedData ger vettiga standardvärden ── */
  state.priceGroups        = g('priceGroups')        || SeedData.priceGroups        || [];
  state.priceProfiles      = g('priceProfiles')      || SeedData.priceProfiles      || [];
  state.settings           = g('settings')           || SeedData.settings           || {};
  state.articles           = g('articles')           || SeedData.articles           || [];
  state.titles             = g('titles')             || SeedData.titles             || [];
  state.roles              = g('roles')              || SeedData.roles              || [];
  state.serviceTemplates   = g('serviceTemplates')   || SeedData.serviceTemplates   || [];
  state.emailTemplates     = g('emailTemplates')     || SeedData.emailTemplates     || [];
  state.propertyCategories = g('propertyCategories') || SeedData.propertyCategories || [];
  state.ronderingsmallar   = g('ronderingsmallar')   || SeedData.ronderingsmallar   || [];

  /* Ladda staff — strippa alltid lösenordsfält (ska aldrig ligga i frontend).
   * BEHÅLLER SeedData.staff som fallback: _resolveUser() matchar inloggad email
   * mot state.staff för rollresolution — tom lista → alla får roll "personal". */
  const rawStaff = g('staff') || SeedData.staff;
  state.staff = rawStaff.map(function(s) {
    const clean = Object.assign({}, s);
    delete clean.password;
    delete clean.passwordHash;
    return clean;
  });


  // Rensa AO:er vars 14-dagarsfönster gått ut
  const _trashNow = new Date();
  state.workOrders = state.workOrders.filter(function(ao) {
    if (!ao.deleted || !ao.deleteAfter) return true;
    return new Date(ao.deleteAfter) > _trashNow;
  });

  // Migrera titlar från sträng → objekt
  state.titles = state.titles.map(function(t, i) {
    if (typeof t === 'string') {
      return { id: 'TIT-' + String(i + 1).padStart(3, '0'), name: t, description: '', active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    }
    return t;
  });

  // Säkerställ att alla roller har active-fält
  state.roles = state.roles.map(function(r) {
    return r.active !== undefined ? r : Object.assign({ active: true }, r);
  });

  /* Sätt DataSync._lastSig från laddad lastChanged — undviker omedelbar re-fetch vid första poll */
  var _loadedSig = d['lastChanged'] || null;
  if (_loadedSig && typeof DataSync !== 'undefined') DataSync._lastSig = _loadedSig;
  var _aoCount = Array.isArray(state.workOrders) ? state.workOrders.filter(function(a) { return !a.deleted && !a.archived; }).length : 0;
  console.log('[initState] Laddat ' + _aoCount + ' aktiva AO — lastChanged: ' + (_loadedSig || 'saknas'));

  // Stämplingsstate (per-enhet, läs från localStorage direkt — inte via Supabase blob)
  try { state.stampActive    = !!JSON.parse(localStorage.getItem('vift_stampActive')); } catch(e) { state.stampActive = false; }
  try { state.stampTimestamp = JSON.parse(localStorage.getItem('vift_stampTs'))    || null; } catch(e) { state.stampTimestamp = null; }
  try { state.stampAoId      = JSON.parse(localStorage.getItem('vift_stampAoId')) || null; } catch(e) { state.stampAoId = null; }

  // Migrera gamla RON.results[] → ronderingspass (idempotent, kör varje laddning tills persist skett)
  state.ronderingar.forEach(function(ron) {
    if (!ron.results || ron.results.length === 0) return;
    if (state.ronderingspass.some(function(p) { return p.ronderingId === ron.id && p.migratedFromLegacy; })) return;
    var passStatus = (ron.status === 'slutförd' || ron.status === 'har_avvikelser') ? ron.status
                   : (ron.status === 'pågående' ? 'pågående' : 'planerat');
    var passCats = (ron.results || []).map(function(res) {
      return {
        id: res.categoryId,
        name: res.categoryName,
        points: (res.points || []).map(function(pt) {
          var newStatus = pt.status === 'avvikelse' ? 'anmärkning' : (pt.status || '');
          return {
            id: pt.pointId,
            title: pt.pointTitle,
            description: pt.pointDesc || '',
            canCreateAO: pt.canCreateAO !== false,
            requiresPhoto: false,
            status: newStatus,
            comment: pt.comment || '',
            images: [],
            workOrderId: pt.workOrderId || null,
            checkedAt: pt.checkedAt || null,
            checkedBy: ron.performedBy || null
          };
        })
      };
    });
    var sumTotal = 0, sumOk = 0, sumAnm = 0, sumEjK = 0, sumEjA = 0;
    passCats.forEach(function(cat) {
      (cat.points || []).forEach(function(pt) {
        sumTotal++;
        if (pt.status === 'ok') sumOk++;
        else if (pt.status === 'anmärkning') sumAnm++;
        else if (pt.status === 'ej_aktuell') sumEjA++;
        else if (pt.status === 'ej_kontrollerad') sumEjK++;
      });
    });
    var pass = Object.assign(Schema.ronderingspass(), {
      id: 'PASS-MIG-' + ron.id,
      ronderingId: ron.id,
      mallId: ron.templateId || '',
      propertyId: ron.propertyId || '',
      customerId: ron.customerId || '',
      sequenceNumber: 1,
      scheduledDate: ron.startedAt ? ron.startedAt.split('T')[0] : '',
      scheduledTime: ron.startedAt ? ron.startedAt.split('T')[1].substring(0, 5) : '',
      staffIds: ron.performedBy ? [ron.performedBy] : [],
      status: passStatus,
      startedAt: ron.startedAt || null,
      completedAt: ron.completedAt || null,
      completedBy: ron.performedBy || null,
      categories: passCats,
      summary: { total: sumTotal, ok: sumOk, anmärkningar: sumAnm, ejKontrollerad: sumEjK, ejAktuell: sumEjA },
      internalNote: ron.internalNote || '',
      migratedFromLegacy: true,
      createdAt: ron.createdAt || new Date().toISOString(),
      updatedAt: ron.updatedAt || new Date().toISOString()
    });
    state.ronderingspass.push(pass);
  });
}

/**
 * Spara hela state — localStorage direkt + Supabase i bakgrunden (ett enda HTTP-anrop)
 */
function persist() {
  const _now = new Date().toISOString();
  /* Sätt _lastSig lokalt så DataSync inte triggar en omedelbar re-läsning av egna skrivningar */
  if (typeof DataSync !== 'undefined') DataSync._lastSig = _now;
  const _persistAoCount = Array.isArray(state.workOrders) ? state.workOrders.filter(function(a) { return !a.deleted && !a.archived; }).length : 0;
  console.log('[persist] Sparar state — aktiva AO: ' + _persistAoCount + ' — ts: ' + _now);
  Storage.setAll([
    ['lastChanged',      _now],
    ['customers',        state.customers],
    ['workOrders',       state.workOrders],
    ['offers',           state.offers],
    ['invoices',         state.invoices],
    ['staff',            state.staff],
    ['properties',       state.properties],
    ['priceGroups',      state.priceGroups],
    ['priceProfiles',    state.priceProfiles],
    ['salesOpps',        state.salesOpportunities],
    ['activityLog',      state.activityLog],
    ['settings',         state.settings],
    ['timeEntries',      state.timeEntries],
    ['contracts',        state.contracts],
    ['articles',         state.articles],
    ['titles',           state.titles],
    ['roles',            state.roles],
    ['recurringOrders',  state.recurringOrders],
    ['ronderingsmallar', state.ronderingsmallar],
    ['ronderingar',      state.ronderingar],
    ['avvikelser',       state.avvikelser],
    ['activities',       state.activities],
    ['serviceTemplates', state.serviceTemplates],
    ['emailTemplates',   state.emailTemplates],
    ['notifications',    state.notifications],
    ['propertyCategories', state.propertyCategories],
    ['ronderingspass',   state.ronderingspass]
  ]);
}

/* ── Hjälpfunktioner ──────────────────── */

function newId(arr, prefix) {
  if (!arr || arr.length === 0) return `${prefix}-001`;
  const nums = arr
    .map(x => parseInt((x.id || '').replace(/[^0-9]/g, ''), 10))
    .filter(n => !isNaN(n));
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

function getCu(id)   { return state.customers.find(c => c.id === id) || null; }
function getAO(id)   { return state.workOrders.find(a => a.id === id) || null; }
function getOff(id)  { return state.offers.find(o => o.id === id) || null; }
function getInv(id)  { return state.invoices.find(i => i.id === id) || null; }
function getObj(id)  { return state.properties.find(o => o.id === id) || null; }
function getSO(id)   { return state.salesOpportunities.find(s => s.id === id) || null; }
function getStaff(id){ return state.staff.find(s => s.id === id) || null; }
function getMall(id)  { return state.ronderingsmallar.find(m => m.id === id) || null; }
function getRon(id)   { return state.ronderingar.find(r => r.id === id) || null; }
function getAvv(id)   { return state.avvikelser.find(a => a.id === id) || null; }
function getPass(id)  { return state.ronderingspass.find(p => p.id === id) || null; }

function tdy() {
  return new Date().toISOString().split('T')[0];
}

function _ds(days) {
  return new Date(Date.now() + days * 86400000).toISOString().split('T')[0];
}

function fmt(n) {
  return Number(n || 0).toLocaleString('sv-SE');
}

function fkr(n) {
  return Number(n || 0).toLocaleString('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 0 });
}

function cap(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function relDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH   = Math.floor(diffMs / 3600000);
  const diffD   = Math.floor(diffMs / 86400000);
  if (diffMin < 2)  return 'Just nu';
  if (diffMin < 60) return `${diffMin} min sedan`;
  if (diffH < 24)   return `${diffH} tim sedan`;
  if (diffD === 1)  return 'Igår';
  if (diffD < 7)    return `${diffD} dagar sedan`;
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
}

function esc(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function fmtDate(isoStr) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ── Status/prioritet-helpers ─────────── */
function statusLabel(s) {
  const m = {
    nytt: 'Nytt', pool: 'Arbetspool', planerad: 'Planerad',
    pågående: 'Pågående', klar: 'Klar', fakturerad: 'Fakturerad', avbruten: 'Avbruten',
    utkast: 'Utkast', skickad: 'Skickad', påmind: 'Påmind', väntar: 'Väntar svar',
    godkänd: 'Godkänd', nekad: 'Nekad', utgången: 'Utgången', ersatt: 'Ersatt',
    betald: 'Betald', förfallen: 'Förfallen', makulerad: 'Makulerad',
    aktiv: 'Aktiv', pausad: 'Pausad', avslutad: 'Avslutad',
    new: 'Ny', contacted: 'Kontaktad', snoozed: 'Uppskjuten',
    won: 'Vunnen', lost: 'Förlorad', done: 'Klar', dismissed: 'Avvisad'
  };
  return m[s] || cap(s);
}

function statusClass(s) {
  const m = {
    nytt: 'bdg-blue', pool: 'bdg-purple', planerad: 'bdg-sky',
    pågående: 'bdg-orange', klar: 'bdg-green', fakturerad: 'bdg-grey',
    avbruten: 'bdg-grey', utkast: 'bdg-grey', skickad: 'bdg-blue',
    påmind: 'bdg-purple', väntar: 'bdg-orange', godkänd: 'bdg-green', nekad: 'bdg-red',
    utgången: 'bdg-grey', ersatt: 'bdg-grey', betald: 'bdg-green', förfallen: 'bdg-red',
    makulerad: 'bdg-grey', aktiv: 'bdg-green', pausad: 'bdg-yellow',
    avslutad: 'bdg-grey', new: 'bdg-blue', contacted: 'bdg-sky',
    snoozed: 'bdg-yellow', won: 'bdg-green', lost: 'bdg-red',
    done: 'bdg-grey', dismissed: 'bdg-grey'
  };
  return m[s] || 'bdg-grey';
}

function priorityLabel(p) {
  return { akut: 'Akut', hög: 'Hög', normal: 'Normal', låg: 'Låg' }[p] || p;
}

function priorityClass(p) {
  return { akut: 'p-akut', hög: 'p-hog', normal: 'p-normal', låg: 'p-lag' }[p] || 'p-lag';
}

function sbdg(status) {
  const icons = {
    nytt:'circle',pool:'inbox',planerad:'calendar',pågående:'play-circle',
    klar:'check-circle',fakturerad:'receipt',avbruten:'x-circle',
    utkast:'file',skickad:'send',påmind:'bell',väntar:'clock',godkänd:'check-circle',
    nekad:'x-circle',utgången:'alert-circle',ersatt:'copy',betald:'check-circle',
    förfallen:'alert-triangle',makulerad:'x'
  };
  const ico = icons[status];
  return `<span class="bdg ${statusClass(status)}" style="display:inline-flex;align-items:center;gap:3px;">${ico?ic(ico,9):''}${statusLabel(status)}</span>`;
}

function pbdg(priority) {
  const cls   = { akut:'bdg-red', hög:'bdg-orange', normal:'bdg-sky', låg:'bdg-grey' }[priority] || 'bdg-grey';
  const icons = { akut:'alert-circle', hög:'arrow-up', normal:'minus', låg:'arrow-down' };
  const ico = icons[priority];
  return `<span class="bdg ${cls}" style="display:inline-flex;align-items:center;gap:3px;">${ico?ic(ico,9):''}${priorityLabel(priority)}</span>`;
}

/* ── LiveSync — polling för cross-device synk ─── */
const LiveSync = {
  _timer: null,
  _passId: null,
  _lastSig: null,

  start(passId) {
    this._passId = passId;
    this._lastSig = null;
    this.stop();
    this._timer = setInterval(function() { LiveSync._poll(); }, 4000);
  },

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },

  async _poll() {
    if (document.hidden) return;
    const page = typeof Router !== 'undefined' ? Router.currentPage : null;
    if (page !== 'pg-rondering-utfor' && page !== 'pg-rondering-rapport') { LiveSync.stop(); return; }
    if (!LiveSync._passId) return;
    try {
      const remote = await Storage.get('ronderingspass');
      if (!Array.isArray(remote)) return;
      const rp = remote.find(function(p) { return p.id === LiveSync._passId; });
      if (!rp) return;
      const sig = rp.updatedAt;
      if (sig === LiveSync._lastSig) return;
      const lp = getPass(LiveSync._passId);
      if (lp && lp.updatedAt === sig) { LiveSync._lastSig = sig; return; }
      LiveSync._lastSig = sig;
      // Spara osparad antecknings-text i textrutan innan vi byter ut state
      const noteEl = document.getElementById('pass-exec-note');
      const unsavedNote = noteEl ? noteEl.value : null;
      state.ronderingspass = remote;
      try { localStorage.setItem('vift_ronderingspass', JSON.stringify(remote)); } catch(e2) {}
      // Återställ osparad anteckning på det nya in-memory PASS-objektet
      if (unsavedNote !== null) {
        const np = getPass(LiveSync._passId);
        if (np) np.internalNote = unsavedNote;
      }
      if (page === 'pg-rondering-utfor' && typeof RonderingUtforandePage !== 'undefined') {
        RonderingUtforandePage._refresh();
      } else if (page === 'pg-rondering-rapport' && typeof RonderingRapportPage !== 'undefined') {
        RonderingRapportPage.render(Router.currentParams);
      }
    } catch(e) { /* network error — ignore */ }
  }
};

/*
 * DataSync — global cross-device synk för ALL appdata
 *
 * Polling var 15:e sekund mot en lättviktsnyckel (lastChanged).
 * Om timestamp ändrats av en annan enhet: hämta all data från Supabase,
 * uppdatera state, rendera om aktuell sida.
 *
 * Startas från App.showApp() i index.html när användaren är inloggad.
 * Egna persist()-skrivningar uppdaterar _lastSig och triggar INTE re-read.
 */
const DataSync = {
  _timer:   null,
  _lastSig: null,
  INTERVAL: 15000,

  start() {
    this.stop();
    this._timer = setInterval(function() { DataSync._poll(); }, DataSync.INTERVAL);
    console.log('[DataSync] Startar — pollar var', DataSync.INTERVAL / 1000, 's');
  },

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },

  async _poll() {
    if (document.hidden) return;
    /* Avbryt om användaren skriver eller en modal är öppen */
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
    if (document.body.classList.contains('modal-open')) return;

    try {
      const sig = await Storage.get('lastChanged');
      if (!sig || sig === DataSync._lastSig) return;

      console.log('[DataSync] Fjärruppdatering detekterad (' + sig + ') — hämtar data…');
      const remote = await Storage.getAll();
      if (!remote) return;

      DataSync._lastSig = sig;

      /* Uppdatera state-arrayer från remote */
      const g = function(key) { return (remote[key] !== undefined && remote[key] !== null) ? remote[key] : null; };
      const arr = function(stateKey, remoteKey) { var v = g(remoteKey); if (Array.isArray(v)) state[stateKey] = v; };

      arr('customers',          'customers');
      arr('workOrders',         'workOrders');
      arr('offers',             'offers');
      arr('invoices',           'invoices');
      arr('properties',         'properties');
      arr('priceGroups',        'priceGroups');
      arr('priceProfiles',      'priceProfiles');
      arr('salesOpportunities', 'salesOpps');
      arr('activityLog',        'activityLog');
      arr('timeEntries',        'timeEntries');
      arr('contracts',          'contracts');
      arr('articles',           'articles');
      arr('titles',             'titles');
      arr('roles',              'roles');
      arr('recurringOrders',    'recurringOrders');
      arr('ronderingsmallar',   'ronderingsmallar');
      arr('ronderingar',        'ronderingar');
      arr('avvikelser',         'avvikelser');
      arr('activities',         'activities');
      arr('serviceTemplates',   'serviceTemplates');
      arr('emailTemplates',     'emailTemplates');
      arr('notifications',      'notifications');
      arr('propertyCategories', 'propertyCategories');
      arr('ronderingspass',     'ronderingspass');

      /* Staff: strippa lösenordsfält */
      var rawStaff = g('staff');
      if (Array.isArray(rawStaff)) {
        state.staff = rawStaff.map(function(s) {
          var clean = Object.assign({}, s);
          delete clean.password;
          delete clean.passwordHash;
          return clean;
        });
      }

      /* Settings är ett objekt */
      if (remote['settings'] && typeof remote['settings'] === 'object' && !Array.isArray(remote['settings'])) {
        state.settings = remote['settings'];
      }

      /* Uppdatera localStorage-cache */
      Object.entries(remote).forEach(function(entry) {
        try { localStorage.setItem('vift_' + entry[0], JSON.stringify(entry[1])); } catch(e) {}
      });

      /* Uppdatera badge-räknare */
      if (typeof Sidebar !== 'undefined') Sidebar.updateBadges();

      /* Rendera om aktuell sida (om ingen modal är öppen) */
      var page = typeof Router !== 'undefined' ? Router.currentPage : null;
      if (page && typeof Router !== 'undefined') {
        Router.showPage(page, Router.currentParams || {});
      }

      var aoCount = Array.isArray(state.workOrders) ? state.workOrders.filter(function(a){ return !a.deleted && !a.archived; }).length : 0;
      console.log('[DataSync] Synkat ' + new Date().toLocaleTimeString('sv-SE') + ' — aktiva AO: ' + aoCount + ' — sig: ' + sig);
    } catch(e) {
      console.warn('[DataSync] poll-fel:', e);
    }
  }
};

// Cross-tab sync (same browser, storage event)
window.addEventListener('storage', function(e) {
  if (e.key !== 'vift_ronderingspass' || !e.newValue) return;
  try {
    const updated = JSON.parse(e.newValue);
    if (!Array.isArray(updated)) return;
    state.ronderingspass = updated;
    const page = typeof Router !== 'undefined' ? Router.currentPage : null;
    if (page === 'pg-rondering-utfor' && typeof RonderingUtforandePage !== 'undefined') {
      RonderingUtforandePage._refresh();
    } else if (page === 'pg-rondering-rapport' && typeof RonderingRapportPage !== 'undefined') {
      RonderingRapportPage.render(Router.currentParams);
    } else if (page === 'pg-rondering' && typeof RonderingPage !== 'undefined') {
      RonderingPage._renderTab();
    }
  } catch(e2) {}
});
