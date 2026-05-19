/**
 * schema.js — Datastrukturer (dokumentation + validering)
 * Används av services för att skapa tomma objekt
 */

const Schema = {
  customer: () => ({
    id: '',
    type: 'foretag',          // privat | foretag | brf | fastighetsagare
    name: '',                 // företagsnamn
    orgNr: '',
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
    createdAt: '',
    updatedAt: ''
  }),

  workOrder: () => ({
    id: '',
    title: '',
    description: '',
    customerId: '',
    propertyId: '',
    address: '',
    contactPerson: '',
    phone: '',
    accessCode: '',
    internalNote: '',
    status: 'nytt',           // nytt | pool | planerad | pågående | klar | fakturerad | avbruten
    priority: 'normal',       // akut | hög | normal | låg
    priceType: 'ej_satt',     // ej_satt | fastpris | timpris | prisgrupp
    fixedPrice: 0,
    priceGroupId: '',
    estimatedHours: 0,
    staff: [],                // [staffId, ...]
    scheduledDate: '',
    scheduledStart: '',
    scheduledEnd: '',
    checklist: [],            // [{id, text, done}]
    materials: [],            // [{id, articleId, name, qty, unit, buyPrice, sellPrice}]
    notes: [],                // [{id, text, imageData, staffName, timestamp}]
    timeEntries: [],          // [timeEntryId, ...]  (refs till timeEntries)
    invoiceId: '',
    salesOpportunityId: '',
    createdAt: '',
    updatedAt: '',
    completedAt: ''
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
    status: 'utkast',         // utkast | skickad | väntar | godkänd | nekad | utgången
    declineReason: '',
    salesOpportunityId: '',
    workOrderId: '',
    sentAt: '',
    answeredAt: '',
    createdAt: '',
    updatedAt: ''
  }),

  invoice: () => ({
    id: '',
    customerId: '',
    propertyId: '',
    workOrderId: '',
    offerId: '',
    lines: [],                // [{id, description, qty, unit, unitPrice, vatRate, source, sourceId}]
    status: 'utkast',         // utkast | skickad | betald | förfallen | makulerad
    dueDate: '',
    paymentTerms: 30,
    note: '',
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
    customerId: '',
    name: '',
    address: '',
    zip: '',
    city: '',
    propertyDesignation: '',  // fastighetsbeteckning
    buildYear: '',
    apartments: 0,
    status: 'aktiv',
    note: '',
    contacts: [],             // [{name, phone, email, role}]
    technicalSystems: {},
    inspections: {},          // {ovk: {date, nextDate, ...}, sba: {...}, ...}
    documents: [],            // [{id, name, category, url, date}]
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
  })
};
