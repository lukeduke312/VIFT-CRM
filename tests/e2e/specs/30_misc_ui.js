'use strict';
/* V3 nattkörning 2026-11-26 — arbetsblock "misc" (övriga sidor):
   Projekt, Projektkort, Kontrakt, Importera, Importlogg, Exportcenter,
   Kalender, Fastighetskort, Objekt, Kundkort, Rondering (lista, guide,
   utförande). Simulerad server, syntetisk demodata. */

const ld = (n) => { const d = new Date(); d.setDate(d.getDate() + (n || 0)); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

/* Syntetiska projekt, avtal, objekt och importlogg (demodatan saknar dem). */
function seedMisc(fake) {
  const now = new Date().toISOString();
  const prj = (id, name, cu, prop, status, resp, s, e, extra) => Object.assign({ id, name, customerId: cu, propertyId: prop, allowMultiProperty: false, status, responsibleUserId: resp, startDate: s, endDate: e, description: '', note: '', archived: false, createdAt: now, updatedAt: now, createdBy: 'ST-001' }, extra || {});
  fake.set('projects', [
    prj('PRJ-001', 'Stambyte Solgläntan hus A', 'K-001', 'OBJ-001', 'pågående', 'ST-003', ld(-20), ld(40), { description: 'Byte av stammar och badrum i hus A, trapphus 1–3.' }),
    prj('PRJ-002', 'Takrenovering Granitgatan', 'K-002', 'OBJ-002', 'planerad', 'ST-001', ld(10), ld(60)),
    prj('PRJ-003', 'Fönsterbyte etapp 1', 'K-004', 'OBJ-003', 'pausad', '', ld(-60), ''),
    prj('PRJ-004', 'Hissmodernisering Parkgatan', 'K-006', 'OBJ-004', 'klar', 'ST-003', ld(-120), ld(-10)),
    prj('PRJ-005', 'Fasadtvätt 2025', 'K-001', '', 'avslutad', '', ld(-400), ld(-380), { archived: true }),
  ]);
  const con = (id, title, cu, type, status, amount, period, extra) => Object.assign({ id, customerId: cu, propertyId: '', title, type, description: '', startDate: ld(-200), endDate: '', tillsvidare: true, noticePeriod: 3, autoRenew: false, amount, period, services: [], status, note: '', createdAt: now, updatedAt: now }, extra || {});
  fake.set('contracts', [
    con('KON-001', 'Serviceavtal gemensamma utrymmen', 'K-001', 'service', 'aktiv', 12500, 'månad'),
    con('KON-002', 'Rondering kvartalsvis', 'K-002', 'rondering', 'aktiv', 8000, 'kvartal'),
    con('KON-003', 'Trappstädning', 'K-004', 'städ', 'utkast', 3400, 'månad'),
    con('KON-004', 'Snöröjning 2024/25', 'K-006', 'övrigt', 'avslutad', 45000, 'år', { tillsvidare: false, endDate: ld(-30) }),
  ]);
  fake.set('propertyObjects', [{ id: 'POBJ-E2E-1', customerId: 'K-001', propertyId: 'OBJ-001', objectNumber: '1001', type: 'lagenhet', name: 'Lgh 1001', address: 'Solvägen 1', postalCode: '123 45', city: 'Stockholm', entrance: 'A', stairwell: '1', floor: '2', apartmentNumber: '1001', area: 74, status: 'aktiv', description: '', primaryContactId: '', accessInformation: '', doorCode: '', keyInformation: '', documents: [], images: [], contacts: [], technicalSystems: {}, equipment: [], createdAt: now, updatedAt: now }]);
  fake.set('importLogs', [{ id: 'IMP-001', type: 'customer', filename: 'kunder-november.csv', createdAt: now, performedBy: 'ST-001', createdCount: 12, updatedCount: 3, skippedCount: 1, errorCount: 0, errors: [], undone: false, createdIds: [], updatedSnapshots: [] }]);
}

const tests = [];
module.exports = tests;
module.exports.seedMisc = seedMisc;
