'use strict';
/*
 * T3-0: syntetiska men realistiska testdata för den lokala STAGING-replikan.
 * ALLT är påhittat: namn, e-post (@example.test), personnummer, portkoder, token.
 * Inga STAGING- eller LIVE-data. Behörighetslistorna motsvarar DAGENS server
 * (oförändrad kod); nya behörigheter (ao_pool_take m.fl.) läggs till av T3-B–E.
 *
 * Testdata för arbetspoolen följer BEHORIGHETSMATRIS §5.3 (P1–P5, N1, N2, SI1).
 */

const ROLLER = [
  { id: 'admin', label: 'Admin', isBuiltin: true, active: true, permissions: ['all'] },
  { id: 'chef', label: 'Arbetsledare', isBuiltin: true, active: true, permissions: ['dashboard_view', 'ao_view_all', 'ao_view_own', 'ao_create', 'ao_edit', 'ao_complete', 'ao_time', 'ao_material', 'ao_checklist', 'customer_manage', 'offer_manage', 'invoice_view', 'invoice_create', 'staff_view', 'reports_view', 'sales_manage', 'recurring_manage', 'objects_sensitive'] },
  { id: 'ekonomi', label: 'Ekonomi', isBuiltin: true, active: true, permissions: ['dashboard_view', 'ao_view_all', 'invoice_view', 'invoice_create', 'reports_view', 'payroll_view', 'payroll_manage'] },
  { id: 'personal', label: 'Personal', isBuiltin: true, active: true, permissions: ['dashboard_view', 'ao_view_own', 'ao_complete', 'ao_time', 'ao_material', 'ao_checklist'] },
  { id: 'begransad', label: 'Begränsad', isBuiltin: false, active: true, permissions: ['dashboard_view', 'ao_view_own'] },
  // Egna anpassade roller (D-26, BEHORIGHETSMATRIS §5.13)
  { id: 'personalansvarig', label: 'Personalansvarig (egen)', isBuiltin: false, active: true, permissions: ['dashboard_view', 'staff_view', 'staff_manage'] },
  { id: 'adminhanterare', label: 'Endast admin_manage (egen)', isBuiltin: false, active: true, permissions: ['dashboard_view', 'admin_manage'] },
  { id: 'chef_utan_faktura', label: 'Arbetsledare utan invoice_create (egen)', isBuiltin: false, active: true, permissions: ['dashboard_view', 'ao_view_all', 'ao_view_own', 'ao_create', 'ao_edit', 'ao_complete', 'customer_manage', 'offer_manage', 'invoice_view', 'staff_view'] },
  { id: 'saljare', label: 'Säljare utan personuppgifter (egen)', isBuiltin: false, active: true, permissions: ['dashboard_view', 'ao_view_all', 'sales_manage'] },
  { id: 'tom', label: 'Tom behörighetslista (egen)', isBuiltin: false, active: true, permissions: [] },
];

/* alias → personal/auth. authId är deterministiska UUID:er. */
const ANVANDARE = [
  ['admin', 'ST-R01', 'Ada', 'Admin', 'admin'],
  ['chef', 'ST-R02', 'Cecilia', 'Chef', 'chef'],
  ['ekonomi', 'ST-R03', 'Erik', 'Ekonom', 'ekonomi'],
  ['falt', 'ST-R04', 'Filip', 'Fält', 'personal'],
  ['falt2', 'ST-R05', 'Frida', 'Fält', 'personal'],
  ['begransad', 'ST-R06', 'Bo', 'Begränsad', 'begransad'],
  ['personalansvarig', 'ST-R07', 'Pia', 'Personal', 'personalansvarig'],
  ['adminhanterare', 'ST-R08', 'Arne', 'Admin', 'adminhanterare'],
  ['chef_utan_faktura', 'ST-R09', 'Clas', 'Chef', 'chef_utan_faktura'],
  ['saljare', 'ST-R10', 'Sara', 'Säljare', 'saljare'],
  ['tom', 'ST-R11', 'Tore', 'Tom', 'tom'],
  ['okandroll', 'ST-R12', 'Olle', 'Okänd', 'roll-finns-inte'],
  ['inaktivpersonal', 'ST-R13', 'Ines', 'Inaktiv', 'personal', { staffActive: false }],
  ['avstangd', 'ST-R14', 'Alf', 'Avstängd', 'personal', { appActive: false }],
].map(([alias, staffId, firstName, lastName, role, o], i) => ({
  alias, staffId, firstName, lastName, role,
  email: alias + '@example.test',
  authId: '00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'),
  staffActive: !(o && o.staffActive === false), appActive: !(o && o.appActive === false),
}));
const U = Object.fromEntries(ANVANDARE.map((u) => [u.alias, u]));

const T0 = '2026-11-01T08:00:00.000Z';
const iso = (d) => new Date(d).toISOString();

function ao(id, status, staff, extra) {
  return Object.assign({
    id, title: 'Testuppdrag ' + id, description: 'Syntetisk arbetsbeskrivning för ' + id + '. Kontakta Kalle Kund på 070-000 00 00.',
    customerId: 'CU-R1', customerName: 'Kalle Kund', propertyId: 'PROP-R1', propertyName: 'Testgatan 1', objectId: 'OBJ-R1', objectName: 'Lgh 1001',
    contactPerson: 'Kalle Kund', contactEmail: 'kalle.kund@example.test', phone: '070-000 00 00', accessCode: 'TEST-PORT-' + id,
    address: 'Testgatan 1', zip: '000 00', city: 'Testby', status, priority: 'normal', category: 'ovrigt',
    priceType: 'fastpris', fixedPrice: 4500, estimatedHours: 2, staff: staff.slice(), scheduledDate: '', dueDate: '',
    checklist: [{ id: id + '-C1', text: 'Kontrollera', done: false }, { id: id + '-C2', text: 'Åtgärda', done: false }],
    materials: [{ id: id + '-M1', articleId: 'ART-R1', name: 'Testartikel', qty: 1, unit: 'st', buyPrice: 50, sellPrice: 100 }],
    log: [{ id: id + '-L1', type: 'note', text: 'Skapad (syntetisk)', visibility: 'internal', userName: 'Ada Admin', timestamp: T0 }],
    timeEntries: [], invoiceId: '', offerId: '', archived: false, deleted: false,
    createdAt: T0, updatedAt: T0, completedAt: '', completedBy: '',
  }, extra || {});
}

function arbetsordrar() {
  const F = U.falt.staffId, F2 = U.falt2.staffId;
  return [
    // Arbetspoolen (BEHORIGHETSMATRIS §5.3)
    ao('AO-P1', 'pool', [], {}),
    ao('AO-P2', 'pool', [F2], {}),
    ao('AO-P3', 'pool', [F2], { scheduledDate: '2026-12-01' }),
    ao('AO-P4', 'pool', [], { scheduledDate: '2026-12-02' }),
    ao('AO-P5', 'pool', [], { archived: true }),
    ao('AO-P6', 'pool', [], { deleted: true, deletedAt: T0 }),
    ao('AO-N1', 'planerad', [F], {}),
    ao('AO-N2', 'nytt', [], {}),
    ao('AO-SI1', 'pool', [], { dueDate: '2026-12-15', recurringOrderId: 'REC-R1' }),
    // Alla statusar
    ao('AO-A1', 'planerad', [F], { scheduledDate: '2026-11-20' }),
    ao('AO-A2', 'pågående', [F], { scheduledDate: '2026-11-21' }),
    ao('AO-A3', 'klar', [F], { completedAt: '2026-11-22T10:00:00.000Z', completedBy: F }),
    ao('AO-A4', 'fakturerad', [F2], { invoiceId: 'INV-R1', completedAt: '2026-11-10T10:00:00.000Z', completedBy: F2 }),
    ao('AO-A5', 'avbruten', [F], {}),
    ao('AO-A6', 'planerad', [F], { archived: true }),
    ao('AO-A7', 'planerad', [F], { deleted: true, deletedAt: T0 }),
    ao('AO-A8', 'planerad', [F2], { scheduledDate: '2026-11-25' }),
    ao('AO-A9', 'fakturerad', [F], { invoiceId: 'INV-R1' }),
  ];
}

function data() {
  const F = U.falt.staffId, F2 = U.falt2.staffId, C = U.chef.staffId;
  const personal = ANVANDARE.map((u) => ({ id: u.staffId, firstName: u.firstName, lastName: u.lastName, email: u.email, role: u.role, active: u.staffActive, phone: '070-000 00 ' + u.staffId.slice(-2), hourlyRate: 650, createdAt: T0, updatedAt: T0 }));
  const store = {
    vift_roles: ROLLER,
    vift_staff: personal,
    vift_customers: [
      { id: 'CU-R1', type: 'privat', firstName: 'Kalle', lastName: 'Kund', name: '', personnr: '19800101-0000', orgNr: '', phone: '070-000 00 00', email: 'kalle.kund@example.test', address: 'Testgatan 1', zip: '000 00', city: 'Testby', active: true, createdAt: T0, updatedAt: T0 },
      { id: 'CU-R2', type: 'foretag', name: 'Testbolaget AB', orgNr: '556000-0000', personnr: '', phone: '08-000 00 00', email: 'info@example.test', address: 'Exempelvägen 2', zip: '000 01', city: 'Testby', active: true, createdAt: T0, updatedAt: T0 },
      { id: 'CU-R3', type: 'brf', name: 'BRF Påhittet', orgNr: '769600-0000', personnr: '', phone: '', email: 'styrelse@example.test', address: 'Låtsasgatan 3', zip: '000 02', city: 'Testby', active: true, createdAt: T0, updatedAt: T0 },
    ],
    vift_properties: [
      { id: 'PROP-R1', name: 'Testgatan 1', customerId: 'CU-R1', address: 'Testgatan 1', zip: '000 00', city: 'Testby', active: true, createdAt: T0, updatedAt: T0 },
      { id: 'PROP-R2', name: 'Låtsasgatan 3', customerId: 'CU-R3', address: 'Låtsasgatan 3', zip: '000 02', city: 'Testby', active: true, createdAt: T0, updatedAt: T0 },
    ],
    vift_propertyObjects: [
      { id: 'OBJ-R1', propertyId: 'PROP-R1', name: 'Lgh 1001', objectNumber: '1001', doorCode: 'TEST-1001', keyInformation: 'Nyckel i testskåp A', accessInformation: 'Ring på', createdAt: T0, updatedAt: T0 },
      { id: 'OBJ-R2', propertyId: 'PROP-R2', name: 'Lokal 1', objectNumber: 'L1', doorCode: 'TEST-2002', keyInformation: 'Nyckelbricka B', accessInformation: '', createdAt: T0, updatedAt: T0 },
    ],
    vift_recurringOrders: [{ id: 'REC-R1', title: 'Återkommande test', propertyId: 'PROP-R1', accessCode: 'TEST-REC-1', active: true, createdAt: T0, updatedAt: T0 }],
    vift_workOrders: arbetsordrar(),
    vift_timeEntries: [
      { id: 'TE-R1', aoId: 'AO-A2', staffId: F, staffName: 'Filip Fält', date: '2026-11-21', hours: 2, hourRate: 650, attested: false, registeredById: '', registeredByName: '', createdAt: T0, updatedAt: T0 },
      { id: 'TE-R2', aoId: 'AO-A8', staffId: F2, staffName: 'Frida Fält', date: '2026-11-21', hours: 3, hourRate: 650, attested: false, registeredById: '', registeredByName: '', createdAt: T0, updatedAt: T0 },
      { id: 'TE-R3', aoId: 'AO-A3', staffId: F, staffName: 'Filip Fält', date: '2026-11-22', hours: 1.5, hourRate: 650, attested: true, attestedAt: T0, attestedBy: U.ekonomi.staffId, registeredById: '', registeredByName: '', createdAt: T0, updatedAt: T0 },
    ],
    vift_activities: [
      { id: 'TASK-R1', title: 'Uppgift till Filip', type: 'task', status: 'open', assignedTo: F, createdBy: C, createdAt: T0, updatedAt: T0, workOrderId: 'AO-A1' },
      { id: 'TASK-R2', title: 'Uppgift till Frida (känslig: ring Kalle Kund)', type: 'task', status: 'open', assignedTo: F2, createdBy: C, createdAt: T0, updatedAt: T0, workOrderId: 'AO-A8' },
      { id: 'TASK-R3', title: 'Chefens egen uppgift', type: 'task', status: 'open', assignedTo: C, createdBy: C, createdAt: T0, updatedAt: T0 },
    ],
    vift_activityLog: [
      { id: 'LOG-R1', type: 'ao_created', refId: 'AO-A1', staffId: C, text: 'AO skapad', ts: T0 },
      { id: 'LOG-R2', type: 'ao_created', refId: 'AO-A8', staffId: C, text: 'AO skapad', ts: T0 },
    ],
    vift_invoices: [
      { id: 'INV-R1', number: '9001', status: 'skickad', customerId: 'CU-R1', workOrderIds: ['AO-A4', 'AO-A9'], revision: 2, lines: [{ id: 'L1', description: 'Arbete', qty: 2, unit: 'h', unitPrice: 650, vatRate: 25, source: 'ao', sourceId: 'AO-A4' }], note: 'Intern anteckning (potentiellt intern, K-05)', createdAt: T0, updatedAt: T0 },
      { id: 'INV-R2', number: '', status: 'utkast', customerId: 'CU-R2', workOrderIds: [], revision: 0, lines: [], note: '', createdAt: T0, updatedAt: T0 },
    ],
    vift_offers: [
      { id: 'OFF-R1', title: 'Testoffert skickad', status: 'skickad', customerId: 'CU-R1', propertyId: 'PROP-R1', versionNumber: 1, lines: [{ id: 'OL1', description: 'Arbete', qty: 1, unitPrice: 1000 }],
        publicToken: 'a'.repeat(40) + '0000000000000000000000ff', tokenCreatedAt: T0, tokenExpiresAt: '2099-01-01T00:00:00.000Z', tokenRevokedAt: '', openCount: 0, internalNote: 'Intern offertnotering',
        lockedSnapshotJSON: JSON.stringify({ id: 'OFF-R1', versionNumber: 1, title: 'Testoffert skickad', customerName: 'Kalle Kund', lines: [], extras: [], publicAttachmentIds: [] }), createdAt: T0, updatedAt: T0 },
      { id: 'OFF-R2', title: 'Testoffert utkast', status: 'utkast', customerId: 'CU-R2', versionNumber: 1, lines: [], publicToken: '', createdAt: T0, updatedAt: T0 },
      { id: 'OFF-R3', title: 'Testoffert ändring', status: 'skickad', customerId: 'CU-R3', propertyId: 'PROP-R2', versionNumber: 1, lines: [],
        publicToken: 'b'.repeat(40) + '0000000000000000000000ee', tokenCreatedAt: T0, tokenExpiresAt: '2099-01-01T00:00:00.000Z', tokenRevokedAt: '', openCount: 0,
        lockedSnapshotJSON: JSON.stringify({ id: 'OFF-R3', versionNumber: 1, title: 'Testoffert ändring', lines: [], extras: [], publicAttachmentIds: [] }), createdAt: T0, updatedAt: T0 },
    ],
    vift_offerEvents: [],
    vift_offerAttachments: [],
    vift_notifications: [],
    vift_settings: { companyName: 'Testföretaget (syntetiskt)', bankgiro: '000-0000', internalHourlyCost: 400 },
    vift_articles: [{ id: 'ART-R1', articleNumber: 'R1', name: 'Testartikel', unit: 'st', buyPrice: 50, sellPrice: 100, vatRate: 25, active: true }],
    vift_lastChanged: iso(T0),
  };
  const kansliga = [
    { property_id: 'PROP-R1', object_id: 'OBJ-R1', door_code: 'TEST-1001', key_information: 'Nyckel i testskåp A', access_information: 'Ring på', access_code: 'TEST-1001' },
    { property_id: 'PROP-R2', object_id: 'OBJ-R2', door_code: 'TEST-2002', key_information: 'Nyckelbricka B', access_information: '', access_code: 'TEST-2002' },
  ];
  return { store, kansliga, anvandare: ANVANDARE, U };
}

module.exports = { data, ROLLER, ANVANDARE, U };
