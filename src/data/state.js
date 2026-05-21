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
  titles: [],
  recurringOrders: [],
  salesOpportunities: [],
  activityLog: [],
  settings: {},

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
 * Initiera state från localStorage, fall back på seed-data
 */
function initState() {
  const s = Storage;

  state.customers          = s.get('customers')     || SeedData.customers;
  state.workOrders         = s.get('workOrders')    || SeedData.workOrders;
  state.offers             = s.get('offers')        || SeedData.offers;
  state.invoices           = s.get('invoices')      || SeedData.invoices;
  state.staff              = s.get('staff')         || SeedData.staff;
  state.properties         = s.get('properties')   || SeedData.properties;
  state.priceGroups        = s.get('priceGroups')  || SeedData.priceGroups;
  state.salesOpportunities = s.get('salesOpps')    || SeedData.salesOpportunities;
  state.activityLog        = s.get('activityLog')  || SeedData.activityLog;
  state.settings           = s.get('settings')     || SeedData.settings;
  state.timeEntries        = s.get('timeEntries')     || SeedData.timeEntries || [];
  state.contracts          = s.get('contracts')       || [];
  state.articles           = s.get('articles')        || SeedData.articles || [];
  state.titles             = s.get('titles')          || SeedData.titles  || [];
  state.roles              = s.get('roles')           || SeedData.roles   || [];
  state.recurringOrders    = s.get('recurringOrders') || SeedData.recurringOrders || [];

  // Stämpling-state
  state.stampActive    = !!s.get('stampActive');
  state.stampTimestamp = s.get('stampTs') || null;
  state.stampAoId      = s.get('stampAoId') || null;
}

/**
 * Spara hela state till localStorage
 */
function persist() {
  const s = Storage;
  s.set('customers',    state.customers);
  s.set('workOrders',   state.workOrders);
  s.set('offers',       state.offers);
  s.set('invoices',     state.invoices);
  s.set('staff',        state.staff);
  s.set('properties',   state.properties);
  s.set('priceGroups',  state.priceGroups);
  s.set('salesOpps',    state.salesOpportunities);
  s.set('activityLog',  state.activityLog);
  s.set('settings',     state.settings);
  s.set('timeEntries',  state.timeEntries);
  s.set('contracts',        state.contracts);
  s.set('articles',         state.articles);
  s.set('titles',           state.titles);
  s.set('roles',            state.roles);
  s.set('recurringOrders',  state.recurringOrders);
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

function fmtDate(isoStr) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ── Status/prioritet-helpers ─────────── */
function statusLabel(s) {
  const m = {
    nytt: 'Nytt', pool: 'Arbetspool', planerad: 'Planerad',
    pågående: 'Pågående', klar: 'Klar', fakturerad: 'Fakturerad', avbruten: 'Avbruten',
    utkast: 'Utkast', skickad: 'Skickad', väntar: 'Väntar svar',
    godkänd: 'Godkänd', nekad: 'Nekad', utgången: 'Utgången',
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
    väntar: 'bdg-orange', godkänd: 'bdg-green', nekad: 'bdg-red',
    utgången: 'bdg-grey', betald: 'bdg-green', förfallen: 'bdg-red',
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
  return `<span class="bdg ${statusClass(status)}">${statusLabel(status)}</span>`;
}

function pbdg(priority) {
  const cls = { akut: 'bdg-red', hög: 'bdg-orange', normal: 'bdg-sky', låg: 'bdg-grey' }[priority] || 'bdg-grey';
  return `<span class="bdg ${cls}">${priorityLabel(priority)}</span>`;
}
