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
  propertyObjects: [],
  importLogs: [],
  propertyRoles: [],        // Leverans D: titelregister (förvaltare, skötare, etc.)
  propertyContacts: [],     // Leverans D: kopplingar person↔fastighet/objekt
  deviationCategories: [],  // Fas 4B: admin-register för avvikelsekategorier
  offerEvents: [],          // Leverans E: händelselogg per offert
  offerAttachments: [],     // Leverans E2b: bilagor per offert

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
  state.propertyObjects    = g('propertyObjects')  || [];
  state.importLogs         = g('importLogs')       || [];
  state.propertyRoles         = g('propertyRoles')         || [];
  state.propertyContacts      = g('propertyContacts')      || [];
  state.deviationCategories   = g('deviationCategories')   || [];
  state.inspections           = g('inspections')           || [];
  state.offerEvents           = g('offerEvents')           || [];
  state.offerAttachments      = g('offerAttachments')      || [];

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
 * Spara hela state — localStorage direkt + Supabase (serialiserad, bekräftad skrivning).
 *
 * V48B3B0 R1 (kritisk data consistency-hotfix): tidigare satte persist() både
 * DataSync._lastSig OCH skickade Supabase-skrivningen helt fire-and-forget,
 * innan skrivningen någonsin bekräftats. Det race:et är verifierat och
 * dokumenterat i RAPPORT-RACE-VERIFIERING.md/run-race-repro.js — en pågående
 * DataSync-poll kunde då applicera en förlegad remote-snapshot rakt över en
 * precis skapad, ännu obekräftad lokal offert och radera den permanent,
 * inklusive att newId() sedan återanvände det "försvunna" ID:t.
 *
 * Fixen har tre delar, se RAPPORT-V48B3B0-R1.md för fullständig motivering:
 *   1. persist() är nu serialiserad via en enkel promise-kö (_persistQueue,
 *      samma etablerade mönster som _notifPersistQueue/persistNotifs() i
 *      denna fil) — två persist()-anrop kan aldrig skicka sina Supabase-
 *      writes i parallell/omvänd ordning.
 *   2. DataSync._pendingWrites/_localWriteGeneration ökas SYNKRONT här,
 *      innan någon await — DataSync._poll() kontrollerar båda före den
 *      någonsin applicerar en remote-snapshot (se DataSync._poll()).
 *   3. DataSync._lastSig sätts ENDAST efter en BEKRÄFTAD lyckad
 *      server-write — aldrig optimistiskt innan, vilket var precis den
 *      falska "redan synkad"-signalen som lurade den ursprungliga pollen
 *      att fortsätta trots att skrivningen ännu inte fanns server-sidigt.
 *
 * Returnerar en Promise<boolean> som ALDRIG rejectar (alla fel fångas och
 * ger `false`) — så de ~200 befintliga anropsställena som gör `persist();`
 * utan att invänta returvärdet fortsätter fungera oförändrat, utan risk för
 * unhandled promise rejections. Nya/kritiska anropsställen (t.ex.
 * OffersPage._save()) kan göra `const ok = await persist();` och agera på
 * resultatet.
 */
var _persistQueue = Promise.resolve();

function persist() {
  /* Måste ske SYNKRONT, före all await — annars hinner en poll som redan
     startat aldrig se att en lokal write är på väg. Se DataSync._poll(). */
  if (typeof DataSync !== 'undefined') {
    DataSync._pendingWrites = (DataSync._pendingWrites || 0) + 1;
    DataSync._localWriteGeneration = (DataSync._localWriteGeneration || 0) + 1;
  }
  const task = _persistQueue.then(function() { return _doPersist(); });
  /* V48B3B0 R1.2 (kritisk fix): EN och SAMMA promise (`safeTask`) används
     nu för både _persistQueue OCH returvärdet till callern — tidigare
     skapade `_persistQueue = task.catch(A)` och `return task.catch(B)` två
     SEPARATA reaction-kedjor på `task`. Per Promise/A+ körs reactions på
     samma promise i REGISTRERINGSORDNING — eftersom _persistQueue-grenen
     registrerades FÖRE retur-grenen, kunde nästa köade persist()-anrops
     `_persistQueue.then(...)`-fortsättning faktiskt köras FÖRE callerns
     egen `await persist()`-fortsättning (t.ex. OffersPage._save():s
     rollback vid fel) — verifierat, reproducerat och dokumenterat i
     RAPPORT-V48B3B0-R1.2.md. Det bröt R1/R1.1:s failure-invariant: en
     misslyckad, ännu ej tillbakarullad mutation kunde hinna serialiseras
     av en senare, lyckad köad write innan callern hunnit rulla tillbaka
     den ur state.offers/localStorage.
     Med EN delad `safeTask`: callerns `await persist()` (registrerat
     synkront, direkt vid anropet) och en SENARE persist()-anrops
     `_persistQueue.then(...)` (som med nödvändighet registreras EFTER,
     eftersom den bara kan ske efter att den förra callern redan fått sin
     egen väntande promise) körs garanterat i den ordningen — callerns
     fortsättning (och ev. rollback) FÖRE nästa köade writes start. */
  const safeTask = task.catch(function(e) {
    console.error('[persist] Ohanterat fel i persist-kön:', e);
    return false;
  });
  /* Kön måste leva vidare även om detta specifika anrop misslyckas —
     annars fastnar alla senare persist()-anrop bakom ett permanent
     avvisat promise. safeTask rejectar aldrig (se catch ovan), så detta
     är redan säkert utan ytterligare .catch(). */
  _persistQueue = safeTask;
  return safeTask;
}

async function _doPersist() {
  try {
    const _now = new Date().toISOString();
    const _persistAoCount = Array.isArray(state.workOrders) ? state.workOrders.filter(function(a) { return !a.deleted && !a.archived; }).length : 0;
    console.log('[persist] Sparar state — aktiva AO: ' + _persistAoCount + ' — ts: ' + _now);
    /* Byggs HÄR (vid faktisk exekvering i kön), inte vid persist()-anropet —
       om detta anrop stod i kö bakom ett tidigare pågående anrop innehåller
       state.X-arrayerna då garanterat även eventuella mutationer som skett
       under tiden, eftersom mutation alltid sker synkront FÖRE persist()
       anropas (etablerat mönster i hela kodbasen). Se RAPPORT §4. */
    const ok = await Storage.setAll([
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
      ['propertyCategories', state.propertyCategories],
      ['ronderingspass',   state.ronderingspass],
      ['propertyObjects',  state.propertyObjects],
      ['importLogs',       state.importLogs],
      ['propertyRoles',         state.propertyRoles],
      ['propertyContacts',      state.propertyContacts],
      ['deviationCategories',   state.deviationCategories],
      ['inspections',           state.inspections],
      ['offerEvents',           state.offerEvents],
      ['offerAttachments',      state.offerAttachments]
    ]);
    if (ok) {
      /* R1: lastSig sätts ENDAST efter bekräftad write — se filhuvud-
         kommentaren ovan för varför detta är kärnan i fixen. */
      if (typeof DataSync !== 'undefined') DataSync._lastSig = _now;
    } else {
      console.error('[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).');
      /* R1.1: Storage.setAll() ovan hann redan (synkront, före nätverkssvaret
         var känt) skriva DENNA misslyckade skrivnings _now-tidsstämpel till
         localStorage['vift_lastChanged']. Utan denna rad skulle den lokala
         cachen påstå en NYARE "sanning" än vad som faktiskt persisterats —
         och en offline initState()-fallback (Storage._localAll()) sätter
         DataSync._lastSig direkt från just den cachade signaturen (se
         initState(), rad ~154-155), vilket annars skulle sprida den aldrig
         bekräftade signaturen vidare. Återställ cachen till den senast
         BEKRÄFTADE signaturen (kan vara null om ingen write någonsin
         lyckats denna session — korrekt, då finns ingen bekräftad signatur). */
      if (typeof DataSync !== 'undefined') Storage.setLocal('lastChanged', DataSync._lastSig);
    }
    return ok;
  } finally {
    if (typeof DataSync !== 'undefined') {
      DataSync._pendingWrites = Math.max(0, (DataSync._pendingWrites || 0) - 1);
    }
  }
}

/* Spara bara notiser — anropas av NotificationsService.
   Serialiserad via _notifPersistQueue — aldrig parallella read/write-flöden.
   Använder Storage.getRemoteStrict() — ingen localStorage-fallback vid nätverksfel. */
var _notifPersistQueue = Promise.resolve();

function persistNotifs() {
  _notifPersistQueue = _notifPersistQueue
    .then(function() { return _doNotifPersist(); })
    .catch(function(e) { console.warn('[persistNotifs] queue-fel:', e); });
}

async function _doNotifPersist() {
  const now = new Date().toISOString();
  var result;
  try {
    result = await Storage.getRemoteStrict('notifications');
  } catch(e) {
    console.warn('[persistNotifs] remote-läsning misslyckades — skriver inte:', e);
    return;
  }
  var toWrite;
  if (result.found && Array.isArray(result.value)) {
    /* Giltig remote-array: merge (lokal read-status vinner, nya EF-notiser bevaras) */
    const localMap = new Map((state.notifications || []).map(function(n) { return [n.id, n]; }));
    const merged = (state.notifications || []).slice();
    for (var i = 0; i < result.value.length; i++) {
      if (!localMap.has(result.value[i].id)) merged.push(result.value[i]);
    }
    merged.sort(function(a, b) { return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(); });
    toWrite = merged.slice(0, 5000);
    state.notifications = toWrite;
  } else if (result.found) {
    /* Oväntat format — skriv INTE för att inte radera data */
    console.warn('[persistNotifs] oväntat format — skriver inte:', typeof result.value);
    return;
  } else {
    /* Ingen rad finns — skriv lokal array som startvärde */
    toWrite = state.notifications || [];
  }
  try {
    await Storage.setRemoteStrict([['notifications', toWrite], ['lastChanged', now]]);
    if (typeof DataSync !== 'undefined') DataSync._lastSig = now;
  } catch(e) {
    console.warn('[persistNotifs] remote-skrivning misslyckades:', e);
  }
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
function getPass(id)    { return state.ronderingspass.find(p => p.id === id) || null; }
function getPropObj(id) { return state.propertyObjects.find(o => o.id === id) || null; }

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

function fmtDateTime(isoStr) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Stockholm' });
}

/* ── Status/prioritet-helpers ─────────── */
function statusLabel(s) {
  const m = {
    nytt: 'Nytt', pool: 'Arbetspool', planerad: 'Planerad',
    pågående: 'Pågående', klar: 'Klar', fakturerad: 'Fakturerad', avbruten: 'Avbruten',
    utkast: 'Utkast', skickad: 'Skickad', påmind: 'Påmind', väntar: 'Väntar svar',
    godkänd: 'Godkänd', nekad: 'Nekad', utgången: 'Utgången', ersatt: 'Ersatt',
    'ändring-begärd': 'Ändring begärd',
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
    utgången: 'bdg-grey', ersatt: 'bdg-grey', 'ändring-begärd': 'bdg-orange', betald: 'bdg-green', förfallen: 'bdg-red',
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
    nekad:'x-circle',utgången:'alert-circle',ersatt:'copy','ändring-begärd':'edit-3',betald:'check-circle',
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

  /* R1: pending-write/generation-räknare, ökade synkront av persist() innan
     någon await — se persist() i denna fil. En poll som redan hunnit förbi
     sig-kontrollen (giltigt, av en ANNAN anledning) MÅSTE ändå kunna
     upptäcka och avbryta om en lokal write startar under de återstående
     await-punkterna nedan, annars kan den fortfarande applicera en
     förlegad snapshot ovanpå en färsk, ännu obekräftad lokal mutation. */
  _pendingWrites: 0,
  _localWriteGeneration: 0,

  async _poll() {
    if (document.hidden) return;
    /* Avbryt om användaren skriver eller en modal är öppen */
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
    if (document.body.classList.contains('modal-open')) return;
    /* R1: starta aldrig en ny pollcykel medan en lokal write pågår/köad. */
    if (DataSync._pendingWrites > 0) return;
    const startGeneration = DataSync._localWriteGeneration;

    try {
      const sig = await Storage.get('lastChanged');
      if (!sig || sig === DataSync._lastSig) return;

      /* R1 (DEL 6, absolut krav): en lokal write kan ha startat under
         awaiten ovan — kontrollera igen innan vi ens hämtar full snapshot. */
      if (DataSync._pendingWrites > 0 || DataSync._localWriteGeneration !== startGeneration) {
        console.log('[DataSync] Avbryter poll — lokal write startade under GET lastChanged');
        return;
      }

      console.log('[DataSync] Fjärruppdatering detekterad (' + sig + ') — hämtar data…');
      const remote = await Storage.getAll();
      if (!remote) return;

      /* R1 (DEL 6, absolut krav): kontrollera IGEN efter den andra
         await-gränsen — detta är exakt det fönster som orsakade den
         verifierade dataförlusten (se RAPPORT-RACE-VERIFIERING.md). */
      if (DataSync._pendingWrites > 0 || DataSync._localWriteGeneration !== startGeneration) {
        console.log('[DataSync] Avbryter poll — lokal write startade under GET all (den verifierade racefönstret)');
        return;
      }

      /* R1 (DEL 7): snapshot-koherens — om ytterligare en fjärrändring
         (t.ex. från en annan enhet) hann ske MELLAN de två läsningarna
         ovan kan lastChanged inuti denna snapshot skilja sig från den sig
         som utlöste cykeln. Applicera då inte en eventuellt inkonsekvent
         blandning — låt nästa poll (som ändå triggas av den nya sig:en)
         hämta en självkonsekvent snapshot istället. */
      if (remote['lastChanged'] !== sig) {
        console.log('[DataSync] Avbryter poll — lastChanged ändrades mellan de två läsningarna (' + sig + ' → ' + remote['lastChanged'] + ')');
        return;
      }

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
      /* Payroll-skydd: filtrera timeEntries till egna poster om payroll_view saknas.
         Notera: rådata flödar fortfarande i HTTP-svaret — detta är klient-side mitigation.
         Fullständigt skydd kräver ett normaliserat timeEntries-schema med per-rad RLS (v1.1). */
      if (typeof Auth !== 'undefined' && !Auth.can('payroll_view')) {
        var _myStaffId = state.currentUser ? state.currentUser.id : null;
        if (_myStaffId && Array.isArray(state.timeEntries)) {
          state.timeEntries = state.timeEntries.filter(function(e) { return e.staffId === _myStaffId; });
        }
      }
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
      arr('propertyObjects',    'propertyObjects');
      arr('importLogs',         'importLogs');
      arr('propertyRoles',         'propertyRoles');
      arr('propertyContacts',      'propertyContacts');
      arr('deviationCategories',   'deviationCategories');
      arr('inspections',           'inspections');
      arr('offerEvents',           'offerEvents');
      arr('offerAttachments',      'offerAttachments');

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

/* ── Overflow-meny för mobilverktygsfält ───────────────────────────────────
 * Enkla globala handlers (registreras en gång) — inga listener-läckor.
 * aoToggleOverflow(menuId, btn) — öppnar/stänger namngiven overflow-meny
 * aoCloseOverflow()             — stänger aktuell öppen meny (anropas av menyalternativ)
 * ─────────────────────────────────────────────────────────────────────────── */
var _aoCurrentMenu = null;
var _aoCurrentBtn  = null;

document.addEventListener('click', function(e) {
  if (!_aoCurrentMenu) return;
  if (!e.target.closest('.ao-overflow-wrap')) {
    _aoCurrentMenu.classList.remove('open');
    if (_aoCurrentBtn) _aoCurrentBtn.setAttribute('aria-expanded', 'false');
    _aoCurrentMenu = null;
    _aoCurrentBtn  = null;
  }
});

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && _aoCurrentMenu) {
    _aoCurrentMenu.classList.remove('open');
    if (_aoCurrentBtn) { _aoCurrentBtn.setAttribute('aria-expanded', 'false'); _aoCurrentBtn.focus(); }
    _aoCurrentMenu = null;
    _aoCurrentBtn  = null;
  }
});

function aoToggleOverflow(menuId, btn) {
  var menu = document.getElementById(menuId);
  if (!menu) return;
  var isOpen = menu === _aoCurrentMenu;

  // Stäng eventuell annan öppen meny
  if (_aoCurrentMenu && _aoCurrentMenu !== menu) {
    _aoCurrentMenu.classList.remove('open');
    if (_aoCurrentBtn) _aoCurrentBtn.setAttribute('aria-expanded', 'false');
    _aoCurrentMenu = null;
    _aoCurrentBtn  = null;
  }

  if (isOpen) {
    menu.classList.remove('open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    _aoCurrentMenu = null;
    _aoCurrentBtn  = null;
  } else {
    menu.classList.add('open');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    _aoCurrentMenu = menu;
    _aoCurrentBtn  = btn || null;
  }
}

function aoCloseOverflow() {
  if (_aoCurrentMenu) _aoCurrentMenu.classList.remove('open');
  if (_aoCurrentBtn)  _aoCurrentBtn.setAttribute('aria-expanded', 'false');
  _aoCurrentMenu = null;
  _aoCurrentBtn  = null;
}

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
