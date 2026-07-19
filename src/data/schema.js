/**
 * schema.js — Datastrukturer (dokumentation + validering)
 * Används av services för att skapa tomma objekt
 */

/* ── Objekttyper (lägenhet, lokal, etc.) ─────── */
const PROPERTY_OBJECT_TYPES = [
  { key: 'lagenhet',  label: 'Lägenhet'         },
  { key: 'lokal',     label: 'Lokal'            },
  { key: 'butik',     label: 'Butik'            },
  { key: 'kontor',    label: 'Kontor'           },
  { key: 'forrad',    label: 'Förråd'           },
  { key: 'garage',    label: 'Garageplats'      },
  { key: 'parkering', label: 'Parkeringsplats'  },
  { key: 'teknik',    label: 'Teknikutrymme'    },
  { key: 'gemensamt', label: 'Gemensamt utrymme'},
  { key: 'byggnad',   label: 'Byggnad/huskropp' },
  { key: 'annat',     label: 'Annat'            }
];

const PROPERTY_OBJECT_STATUSES = [
  { key: 'aktiv',      label: 'Aktiv'            },
  { key: 'vakant',     label: 'Vakant'           },
  { key: 'avstaelld',  label: 'Avställd'         },
  { key: 'uthyrd',     label: 'Uthyrd'           },
  { key: 'renovering', label: 'Under renovering' },
  { key: 'inaktiv',    label: 'Inaktiv'          }
];

/* ── AO-kategorier ──────────────────────────── */
const AO_CATEGORIES = [
  { slug: 'felanmalan',        label: 'Felanmälan',            icon: 'alert-circle',    color: '#ef4444' },
  { slug: 'underhall',         label: 'Underhåll',             icon: 'wrench',          color: '#f97316' },
  { slug: 'besiktning',        label: 'Besiktning',            icon: 'clipboard-check', color: '#3b82f6' },
  { slug: 'stadning',          label: 'Städning',              icon: 'sparkles',        color: '#06b6d4' },
  { slug: 'fastighetsservice', label: 'Fastighetsservice',     icon: 'briefcase',       color: '#2b7fd4' },
  { slug: 'utemiljo',          label: 'Utemiljö & trädgård',   icon: 'leaf',            color: '#22c55e' },
  { slug: 'teknisk',           label: 'Teknisk förvaltning',   icon: 'settings',        color: '#1d4ed8' },
  { slug: 'ekonomi',           label: 'Ekonomi & fakturering', icon: 'wallet',          color: '#10b981' },
  { slug: 'kund',              label: 'Kund & uppföljning',    icon: 'users',           color: '#8b5cf6' },
  { slug: 'admin',             label: 'Administration',        icon: 'file-text',       color: '#6b7280' },
  { slug: 'akut',              label: 'Akut/jour',             icon: 'alert-triangle',  color: '#dc2626' },
  { slug: 'ovrigt',            label: 'Övrigt',                icon: 'circle',          color: '#9ca3af' }
];

function getCatInfo(slug) {
  return AO_CATEGORIES.find(c => c.slug === slug) || AO_CATEGORIES[AO_CATEGORIES.length - 1];
}

function catBadge(slug) {
  const c = getCatInfo(slug || 'ovrigt');
  return `<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;background:${c.color}1a;color:${c.color};border:1px solid ${c.color}40;">${ic(c.icon,9)} ${esc(c.label)}</span>`;
}

/* ── Enheter ────────────────────────────────── */
const UNITS = [
  { value: 'st',        label: 'st',        step: 1,    type: 'count'  },
  { value: 'tim',       label: 'tim',       step: 0.25, type: 'time'   },
  { value: 'm',         label: 'm',         step: 0.01, type: 'length' },
  { value: 'm²',        label: 'm²',        step: 0.01, type: 'area'   },
  { value: 'm³',        label: 'm³',        step: 0.01, type: 'volume' },
  { value: 'kg',        label: 'kg',        step: 0.1,  type: 'weight' },
  { value: 'liter',     label: 'liter',     step: 0.1,  type: 'volume' },
  { value: 'säck',      label: 'säck',      step: 1,    type: 'count'  },
  { value: 'rulle',     label: 'rulle',     step: 1,    type: 'count'  },
  { value: 'paket',     label: 'paket',     step: 1,    type: 'count'  },
  { value: 'dag',       label: 'dag',       step: 1,    type: 'time'   },
  { value: 'månad',     label: 'månad',     step: 1,    type: 'time'   },
  { value: 'km',        label: 'km',        step: 1,    type: 'length' },
  { value: 'resa',      label: 'resa',      step: 1,    type: 'count'  },
  { value: 'tillfälle', label: 'tillfälle', step: 1,    type: 'count'  },
  { value: 'fast pris', label: 'fast pris', step: 1,    type: 'fixed'  },
  { value: 'lm',        label: 'lm',        step: 0.01, type: 'length' },
];

function unitStep(unit) {
  const u = UNITS.find(function(x) { return x.value === unit; });
  return u ? u.step : 1;
}

function unitsHtml(selectedUnit) {
  return UNITS.map(function(u) {
    return '<option value="' + u.value + '"' + (u.value === selectedUnit ? ' selected' : '') + '>' + u.label + '</option>';
  }).join('');
}

const Schema = {
  customer: () => ({
    id: '',
    type: 'foretag',          // privat | foretag | brf | fastighetsagare
    name: '',                 // företagsnamn
    orgNr: '',
    personnr: '',
    firstName: '',            // för privatperson
    lastName: '',
    contactPerson: '',
    phone: '',
    email: '',
    address: '',
    zip: '',
    city: '',
    invoiceAddress: '',
    invoiceZip: '',
    invoiceCity: '',
    note: '',
    contacts: [],             // [{name, phone, email, role}]
    active: true,
    // Leverans B: import/export-fält
    customerNumber: '',       // internt kundnummer
    externalId: '',           // ID i externt system (t.ex. Bokio)
    externalSystem: '',       // 'bokio' | 'fortnox' | 'visma' | ''
    paymentTerms: 30,         // betalningsvillkor i dagar (används även av faktura)
    createdAt: '',
    updatedAt: ''
  }),

  importLog: () => ({
    id: '',
    type: 'customer',         // 'customer' | 'property' | 'object' | 'article' | 'staff'
    filename: '',
    format: 'csv',            // 'csv' | 'xlsx'
    totalRows: 0,
    createdCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    errors: [],               // [{row, field, message}]
    createdIds: [],           // IDs för ångra
    updatedSnapshots: [],     // [{id, before}] för ångra
    performedBy: '',
    undone: false,
    createdAt: '',
    note: ''
  }),

  workOrder: () => ({
    id: '',
    title: '',
    description: '',
    customerId: '',
    propertyId: '',
    propertyName: '',
    objectId: '',         // Leverans C: kopplat objekt (lägenhet/lokal)
    objectName: '',
    address: '',
    contactPerson: '',
    phone: '',
    accessCode: '',
    internalNote: '',
    status: 'nytt',           // nytt | pool | planerad | pågående | klar | fakturerad | avbruten
    substatus: '',            // inväntar_material | inväntar_kund | pausad | behöver_återbesök | blockerad
    priority: 'normal',       // akut | hög | normal | låg
    category: '',             // AO_CATEGORIES slug; '' = ovrigt
    priceType: 'ej_satt',     // ej_satt | fastpris | timpris | prisgrupp
    fixedPrice: 0,
    priceGroupId: '',
    estimatedHours: 0,
    staff: [],                // [staffId, ...]
    scheduledDate: '',
    scheduledStart: '',
    scheduledEnd: '',
    checklist: [],            // [{id, text, done}]
    materials: [],            // [{id, articleId, name, qty, unit, buyPrice, sellPrice, addedAt}]
    notes: [],                // [{id, text, imageData, staffName, timestamp}]
    log: [],                  // [{id, type, text, imageData, visibility, userName, timestamp}]
    timeEntries: [],          // [timeEntryId, ...]  (refs till timeEntries)
    invoiceId: '',
    offerId: '',
    salesOpportunityId: '',
    recurringOrderId: '',
    createdAt: '',
    updatedAt: '',
    completedAt: '',
    completedBy: ''
  }),

  offer: () => ({
    id: '',
    customerId: '',
    propertyId: '',
    address: '',
    internalNote: '',
    lines: [],                // [{id, description, qty, unit, unitPrice, discount, total}]
    taxType: 'moms',          // moms | rot | rut | none
    rotRutAmount: 0,
    terms: '',
    includes: '',
    excludes: '',
    validUntil: '',
    status: 'utkast',         // utkast | skickad | påmind | väntar | godkänd | nekad | utgången | ersatt
    archived: false,
    deleted: false,
    declineReason: '',
    salesOpportunityId: '',
    workOrderId: '',
    sentAt: '',
    answeredAt: '',
    createdAt: '',
    updatedAt: '',
    versionNumber: 1,
    parentOfferId: '',
    emailSentTo: '',
    reminderSentAt: '',
    customerApproval: {
      token: '',
      approvedAt: null,
      approvedByName: '',
      approvedByEmail: '',
      ip: '',
      comment: ''
    }
  }),

  invoice: () => ({
    id: '',
    title: '',
    customerId: '',
    propertyId: '',
    workOrderId: '',
    offerId: '',
    lines: [],                // [{id, description, qty, unit, unitPrice, vatRate, source, sourceId}]
    status: 'utkast',         // utkast | skickad | betald | förfallen | makulerad
    dueDate: '',
    paymentTerms: 30,
    note: '',
    customerReference: '',
    ocr: '',
    discount: { type: 'none', value: 0 },         // type: none | percent | fixed; value: number
    taxReduction: { type: 'none', amount: 0, basis: 0, note: '' }, // type: none | rot | rut
    sentAt: '',
    paidAt: '',
    createdAt: '',
    updatedAt: ''
  }),

  timeEntry: () => ({
    id: '',
    aoId: '',
    staffId: '',
    staffName: '',
    date: '',
    startStr: '',             // HH:MM
    endStr: '',               // HH:MM
    minutes: 0,
    comment: '',
    priceGroupId: '',
    priceGroupName: '',
    hourRate: 0,
    billable: true,
    internal: false,
    createdAt: ''
  }),

  property: () => ({
    id: '',
    objectNumber: '',          // objektnummer / fastighets-ID
    customerId: '',
    group: '',                 // koncern / fastighetsgrupp
    name: '',
    address: '',
    zip: '',
    city: '',
    propertyDesignation: '',   // fastighetsbeteckning
    type: '',                  // fastighetstyp
    buildYear: '',
    renovationYear: '',        // ombyggnadsår
    buildingCount: 1,
    apartments: 0,
    floors: 0,
    area: 0,                   // total yta m²
    boa: 0,
    loa: 0,
    bta: 0,
    lotArea: 0,                // tomtarea
    managementType: '',        // förvaltningsform
    propertyManager: '',       // ansvarig förvaltare (staffId)
    technician: '',            // ansvarig tekniker (staffId)
    operationalArea: '',       // driftområde
    status: 'aktiv',
    accessCode: '',
    keyInfo: '',               // nyckel-/åtkomstinfo
    note: '',
    contacts: [],              // [{name, phone, email, role}]
    technicalSystems: {},      // {heating:{type,manufacturer,model,location,...}, ...}
    inspections: {},           // {ovk: {lastDate, nextDate, status}, ...}
    documents: [],             // [{id, name, category, url, date}]
    images: [],                // [{id, title, category, techSection, description, dataUrl, createdAt}]
    notes: [],                 // [{id, text, createdAt, createdBy}]
    serviceIntervals: [],      // [{id, title, category, lastDone, intervalType, intervalDays, nextDue, responsibleStaffId, supplier, reminderDays, autoCreateAO, description, history[]}]
    createdAt: '',
    updatedAt: ''
  }),

  contract: () => ({
    id: '',
    customerId: '',
    propertyId: '',
    title: '',
    type: '',                 // service | rondering | städ | övrigt
    description: '',
    startDate: '',
    endDate: '',
    tillsvidare: false,
    noticePeriod: 3,          // månader
    autoRenew: false,
    amount: 0,
    period: 'månad',          // månad | kvartal | år | timme
    services: [],
    status: 'aktiv',          // aktiv | pausad | avslutad | utkast
    note: '',
    createdAt: '',
    updatedAt: ''
  }),

  salesOpportunity: () => ({
    id: '',
    customerId: '',
    propertyId: '',
    type: '',                 // service_agreement | seasonal_job | upsell | quote_followup | win_back
    title: '',
    reason: '',
    aiTip: '',
    suggestedAction: '',
    priority: 'medium',       // high | medium | low
    status: 'new',            // new | contact_needed | contacted | snoozed | quote_created | work_order_created | won | lost | done | dismissed
    dueDate: '',
    snoozedUntil: '',
    sourceType: '',
    sourceId: '',
    estimatedValue: 0,
    convertedWorkOrderId: '',
    convertedQuoteId: '',
    createdAt: '',
    updatedAt: '',
    completedAt: '',
    completedBy: ''
  }),

  activityEntry: () => ({
    id: '',
    type: '',
    description: '',
    timestamp: '',
    customerId: '',
    propertyId: '',
    workOrderId: '',
    offerId: '',
    invoiceId: '',
    salesOpportunityId: '',
    inspectionId: '',
    userId: ''
  }),

  staff: () => ({
    id: '',
    firstName: '',
    lastName: '',
    title: '',
    phone: '',
    email: '',
    username: '',
    passwordHash: '',
    role: 'personal',         // admin | chef | personal
    permissions: [],
    active: true,
    createdAt: '',
    updatedAt: ''
  }),

  priceGroup: () => ({
    id: '',
    name: '',
    hourRate: 0,
    description: '',
    active: true,
    createdAt: ''
  }),

  recurringOrder: () => ({
    id: '',
    title: '',
    customerId: '',
    propertyId: '',
    address: '',
    description: '',
    contactPerson: '',
    phone: '',
    internalNote: '',
    priority: 'normal',
    priceType: 'ej_satt',
    priceGroupId: '',
    fixedPrice: 0,
    staff: [],
    // Intervall: dagligen | veckovis | varannan_vecka | månadsvis | kvartalsvis | årsvis | eget
    interval: 'månadsvis',
    intervalDays: 30,        // används om interval = 'eget'
    startDate: '',
    endDate: '',
    tillsvidare: true,
    checklist: [],           // [{text}] — mall, kopieras vid skapande
    status: 'aktiv',         // aktiv | pausad | avslutad
    nextDate: '',
    lastCreatedDate: '',
    createdAt: '',
    updatedAt: ''
  }),

  article: () => ({
    id: '',
    articleNumber: '',
    name: '',
    category: '',
    unit: 'st',               // st | tim | m² | m | lm | kg | liter | säck | rulle | dag | månad | gång | paket | par
    buyPrice: 0,
    sellPrice: 0,
    markup: 0,                // %
    vatRate: 25,              // %
    supplier: '',
    active: true,
    note: '',
    createdAt: ''
  }),

  ronderingsmall: () => ({
    id: '',
    name: '',
    customerId: '',        // optional — lock to customer
    propertyId: '',        // optional — lock to property
    description: '',
    interval: 'månadsvis', // dagligen|veckovis|varannan_vecka|månadsvis|kvartalsvis|årsvis|eget
    intervalDays: 30,      // used when interval='eget'
    active: true,
    categories: [],        // [{id, name, sortOrder, points:[{id,title,description,requiresPhoto,canCreateAO,sortOrder}]}]
    createdAt: '',
    updatedAt: '',
    createdBy: ''
  }),

  rondering: () => ({
    id: '',
    name: '',                  // explicit name for this rondering (required)
    templateId: '',            // optional — which template was used
    templateName: '',
    customerId: '',
    propertyId: '',
    description: '',
    internalNote: '',
    isDraft: false,
    images: [],                // [{dataUrl, name}]

    // Categories (self-contained copy, NOT a reference to template)
    categories: [],            // [{id, name, sortOrder, points:[{id,title,description,requiresPhoto,canCreateAO,sortOrder}]}]

    // Occasions (wizard step 3)
    occasions: [],             // [{id, date, time, staffId, staffName, comment}]
    recurringSetups: [],       // [{id, interval, intervalDays, startDate, endDate, tillsvidare, weekday, dayOfMonth, staffId, staffName}]

    // Pricing (wizard step 4)
    pricingType: '',           // 'tim' | 'fast' | ''
    priceGroupId: '',
    priceGroupName: '',
    hourRate: 0,
    fixedPrice: 0,
    debiterbar: true,

    // Execution
    status: 'utkast',          // utkast|planerad|pågående|slutförd|har_avvikelser
    performedBy: '',
    performedByName: '',
    startedAt: '',
    completedAt: '',
    results: [],               // [{categoryId, categoryName, points:[{pointId,pointTitle,status:'ok'|'avvikelse'|'ej_aktuell'|'',comment,deviationId,checkedAt}]}]
    deviationIds: [],

    createdAt: '',
    updatedAt: ''
  }),

  avvikelse: () => ({
    id: '',
    ronderingId: '',
    passId: '',
    categoryId: '',
    pointId: '',
    categoryName: '',
    pointTitle: '',
    customerId: '',
    propertyId: '',
    objectId: '',             // kopplat objekt (lägenhet/lokal)
    title: '',
    comment: '',
    images: [],               // [{dataUrl, name}]
    priority: 'normal',       // akut|hög|normal|låg
    status: 'öppen',          // öppen|åtgärdad|avskriven
    workOrderId: '',
    createdBy: '',
    createdByName: '',
    createdAt: '',
    updatedAt: '',
    /* Fas 4B — strukturerade avvikelsefält */
    deviationCategoryId: '',  // → state.deviationCategories
    issueType: '',            // 'skada'|'slitage'|'säkerhet'|'hygien'|'drift'|'övrigt'
    issueTags: [],            // fria taggar
    location: '',             // t.ex. "Trapphus B, plan 3"
    severity: '',             // 'kritisk'|'hög'|'medel'|'låg' (komplement till priority)
    recurringKey: ''          // slug för återkommande-detektering, t.ex. "AVK-SÄKERHET-DÖRRHANDLE"
  }),

  deviationCategory: () => ({
    id: '',
    name: '',
    color: '#6366f1',
    icon: 'alert-triangle',
    active: true,
    createdAt: '',
    updatedAt: ''
  }),

  ronderingspass: () => ({
    id: '',
    ronderingId: '',
    mallId: '',
    propertyId: '',
    customerId: '',
    sequenceNumber: 1,
    scheduledDate: '',
    scheduledTime: '',
    staffIds: [],
    estimatedDurationMins: 90,
    status: 'planerat',         // planerat|pågående|slutfört|har_avvikelser
    startedAt: null,
    completedAt: null,
    completedBy: null,
    // categories: self-contained copy with per-point results
    // point.status: ''|'ok'|'anmärkning'|'ej_kontrollerad'|'ej_aktuell'
    // point.images: [{id, url, storagePath, caption, createdAt, createdBy}]
    categories: [],
    summary: { total: 0, ok: 0, anmärkningar: 0, ejKontrollerad: 0, ejAktuell: 0 },
    internalNote: '',
    migratedFromLegacy: false,
    createdAt: '',
    updatedAt: ''
  }),

  /* ── Ansvarstitel / roll (titelregister) ─────────────────────────────────
   * Admin kan skapa och redigera titlar (förvaltare, städansvarig m.fl.).
   * Leverans D: Ansvariga & kontakter per fastighet/objekt               */
  propertyRole: () => ({
    id: '',
    name: '',               // "Ansvarig förvaltare", "Fastighetsskötare", …
    description: '',
    scope: 'property',      // 'property' | 'object' | 'both'
    isInternal: true,       // intern personal eller extern kontakt
    active: true,
    onlyOnePrimary: false,  // om bara en primär person tillåts per titel+objekt
    sortOrder: 0,
    createdAt: '',
    updatedAt: ''
  }),

  /* ── Ansvars-/kontaktkoppling (property ↔ person) ────────────────────────
   * Kopplar en person (från valfritt register) till en fastighet eller ett
   * objekt med en viss titel/funktion och eventuell giltighetstid.
   * personType bestämmer i vilket register personId söks:
   *   'staff'           → state.staff
   *   'customerContact' → state.customers[].contacts[]
   *   'objectContact'   → state.propertyObjects[].contacts[]
   *   'externalOther'   → fritext (ingen intern koppling)               */
  propertyContact: () => ({
    id: '',
    propertyId: '',         // alltid satt
    objectId: '',           // null = gäller hela fastigheten; satt = gäller objekt
    roleId: '',             // PropertyRole.id
    roleNameSnapshot: '',   // snapshot vid tidpunkten för kopplingen
    personType: 'staff',    // 'staff' | 'customerContact' | 'objectContact' | 'externalOther'
    personId: '',           // ID i resp. register (tomt om externalOther)
    personNameSnapshot: '', // snapshot av personens namn
    personPhoneSnapshot: '',
    personEmailSnapshot: '',
    isPrimary: false,
    validFrom: '',          // ISO-datum, '' = inga begränsningar
    validTo: '',
    active: true,
    notes: '',
    createdAt: '',
    updatedAt: ''
  }),

  propertyObject: () => ({
    id: '',
    customerId: '',
    propertyId: '',
    objectNumber: '',       // löpnummer, t.ex. "1101"
    type: 'lagenhet',       // PROPERTY_OBJECT_TYPES[].key
    name: '',               // fritext, t.ex. "Lägenhet 1101"
    address: '',
    postalCode: '',
    city: '',
    entrance: '',           // port/entré
    stairwell: '',          // trapphus
    floor: '',              // våningsplan
    apartmentNumber: '',    // lägenhetsnummer (formellt)
    area: 0,                // kvm
    status: 'aktiv',        // PROPERTY_OBJECT_STATUSES[].key
    description: '',
    primaryContactId: '',   // kund-id
    accessInformation: '',  // tillträdeskod, nyckelinfo
    doorCode: '',
    keyInformation: '',
    documents: [],          // [{id, name, url, uploadedAt}]
    images: [],             // [{dataUrl, name}]
    contacts: [],           // [{contactId, role, validFrom, validTo, active}]
    technicalSystems: {},   // friformat nyckel→värde
    equipment: [],          // [{id, name, type, serialNumber, installedAt}]
    createdAt: '',
    updatedAt: ''
  })
};
