'use strict';
/*
 * T3-D (2026-11-28): syntetisk testvärld för urval per post (SÄK-2, B4, Ö7, D-12–D-15, D-22).
 * Bygger på lib/data.js och lägger till poster som skiljer de olika urvalen åt. Allt är
 * påhittat (@example.test, TEST-portkoder). Används av tests/t3d_informationsatkomst.test.js
 * och av paritetsscenarierna (lib/paritet.js, `varld: t3dVarld`), så att den faktiska servern
 * och den simulerade servern prövas på samma data.
 *
 *   t3dVarld(store, d)  muterar store (värdet ur data().store) på plats.
 *
 * Tilldelning efter ändringen (F = falt ST-R04, F2 = falt2 ST-R05, BE = begransad ST-R06):
 *   AO-A1 (F)          kund CU-R1, fastighet PROP-R1, objekt OBJ-R1, offert OFF-R1 (offerId)
 *   AO-A2 (F)          offert OFF-R3 via offertens workOrderId
 *   AO-A8 (F2)         kund CU-R3, fastighet PROP-R2, objekt OBJ-R2
 *   AO-B1 (BE, F2)     kund CU-R2, fastighet PROP-R2 (ny, planerad)
 *   AO-P1              öppen pool (ingen personal) — ger ingen historik eller kontakt (Q3, K-03)
 *   AO-P2 (F2)         tilldelad pool
 */
const T0 = '2026-11-01T08:00:00.000Z';

function logg(id, type, ref, extra) {
  return Object.assign({ id, type, description: 'Syntetisk händelse ' + id, timestamp: T0, customerId: '', propertyId: '', workOrderId: '', offerId: '',
    invoiceId: '', salesOpportunityId: '', inspectionId: '', ronderingId: '', deviationId: '', userId: 'ST-R02', source: 'klientrapport', verifiedFields: ['userId', 'timestamp'] }, ref || {}, extra || {});
}

function t3dVarld(store, d) {
  const U = d.U;
  const F = U.falt.staffId, F2 = U.falt2.staffId, BE = U.begransad.staffId, C = U.chef.staffId, EK = U.ekonomi.staffId;
  const ao = (id) => store.vift_workOrders.find((a) => a.id === id);
  Object.assign(ao('AO-A1'), { offerId: 'OFF-R1' });
  Object.assign(ao('AO-A8'), { customerId: 'CU-R3', propertyId: 'PROP-R2', objectId: 'OBJ-R2', customerName: 'BRF Påhittet', responsibleStaffId: C });
  const b1 = Object.assign(JSON.parse(JSON.stringify(ao('AO-A8'))), { id: 'AO-B1', title: 'Testuppdrag AO-B1', staff: [BE, F2], customerId: 'CU-R2', propertyId: 'PROP-R2', objectId: '', scheduledDate: '2026-11-26',
    checklist: [{ id: 'AO-B1-C1', text: 'Kontrollera', done: false }], materials: [], log: [], responsibleStaffId: '' });
  store.vift_workOrders.push(b1);

  // Offerter (D-12): OFF-R1 hör till AO-A1 (AO:ns offerId), OFF-R3 till AO-A2 (offertens workOrderId).
  store.vift_offers.find((o) => o.id === 'OFF-R1').workOrderId = '';
  store.vift_offers.find((o) => o.id === 'OFF-R3').workOrderId = 'AO-A2';

  // Kunder, fastigheter, objekt och kontakter (D-13, K-04): portkoder och nyckelinformation i bloben.
  Object.assign(store.vift_customers.find((c) => c.id === 'CU-R1'), { accessCode: 'TEST-CU-PORT', keyInfo: 'TEST-CU-NYCKEL' });
  Object.assign(store.vift_properties.find((p) => p.id === 'PROP-R1'), { accessCode: 'TEST-PROP-PORT', keyInfo: 'TEST-PROP-NYCKEL', note: 'Fastighetsanteckning' });
  Object.assign(store.vift_propertyObjects.find((o) => o.id === 'OBJ-R1'), { keyReceipt: 'TEST-KVITTO', alarmInformation: 'TEST-LARM', accessCode: 'TEST-OBJ-PORT' });
  store.vift_propertyContacts = [
    { id: 'PC-1', propertyId: 'PROP-R1', objectId: '', personType: 'customerContact', personNameSnapshot: 'Kalle Kund', personPhoneSnapshot: '070-000 00 00', personEmailSnapshot: 'kalle.kund@example.test', active: true },
    { id: 'PC-2', propertyId: 'PROP-R1', objectId: 'OBJ-R1', personType: 'objectContact', personNameSnapshot: 'Hyresgäst Test', personPhoneSnapshot: '070-000 00 01', active: true },
    { id: 'PC-3', propertyId: 'PROP-R2', objectId: '', personType: 'customerContact', personNameSnapshot: 'Styrelse Test', personPhoneSnapshot: '070-000 00 02', active: true },
    { id: 'PC-4', propertyId: 'PROP-R1', objectId: 'OBJ-ANNAN', personType: 'objectContact', personNameSnapshot: 'Annan Test', personPhoneSnapshot: '070-000 00 03', active: true },
  ];

  // Personal (D-14): titel och skyddade uppgifter.
  store.vift_staff.forEach((s) => { s.title = 'Titel ' + s.id; s.personnr = '19700101-00' + s.id.slice(-2); s.username = 'anv' + s.id.slice(-2); });

  // Uppgifter (D-15, Ö7, SÄK-2).
  store.vift_activities.push(
    { id: 'TASK-D1', title: 'Chefens uppgift till Frida om AO-A1', type: 'task', status: 'open', assignedTo: F2, createdBy: C, relatedType: 'workOrder', relatedId: 'AO-A1', createdAt: T0, updatedAt: T0 },
    { id: 'TASK-D2', title: 'Filips egen uppgift', type: 'todo', status: 'open', assignedTo: F, createdBy: F, createdAt: T0, updatedAt: T0 },
    { id: 'TASK-D3', title: 'Offertuppföljning', type: 'followup', status: 'open', assignedTo: C, createdBy: C, relatedType: 'offer', relatedId: 'OFF-R1', createdAt: T0, updatedAt: T0 },
    { id: 'TASK-D4', title: 'Ekonomis egen uppgift', type: 'todo', status: 'open', assignedTo: EK, createdBy: EK, createdAt: T0, updatedAt: T0 },
    { id: 'TASK-D5', title: 'Fridas uppgift om poolen', type: 'task', status: 'open', assignedTo: F2, createdBy: F2, relatedType: 'workOrder', relatedId: 'AO-P1', createdAt: T0, updatedAt: T0 },
    { id: 'TASK-D6', title: 'Chefens uppgift om AO-B1', type: 'task', status: 'open', assignedTo: C, createdBy: C, relatedType: 'workOrder', relatedId: 'AO-B1', createdAt: T0, updatedAt: T0 },
  );

  // Aktivitetslogg (B4, D-22): nya formatet (ActivityService/appendActivity) bredvid de äldre LOG-R1/R2.
  store.vift_activityLog = [
    logg('LOG-D1', 'work_order_status', { workOrderId: 'AO-A1', customerId: 'CU-R1' }, { userId: F }),
    logg('LOG-D2', 'work_order_status', { workOrderId: 'AO-A8', customerId: 'CU-R3' }, { userId: F2 }),
    logg('LOG-D3', 'invoice_created', { workOrderId: 'AO-A1', invoiceId: 'INV-R1', customerId: 'CU-R1' }, { userId: EK }),
    logg('LOG-D4', 'customer_updated', { customerId: 'CU-R1' }),
    logg('LOG-D5', 'work_order_status', { workOrderId: 'AO-P1' }),
    logg('LOG-D6', 'offer_sent', { offerId: 'OFF-R1', customerId: 'CU-R1' }),
    logg('LOG-D7', 'time_entry_created', { workOrderId: 'AO-A2' }, { userId: F }),
    logg('LOG-D8', 'work_order_status', { workOrderId: 'AO-P2' }, { userId: F2 }),
    logg('LOG-D9', 'material_added', { workOrderId: 'AO-A6' }, { userId: F }),
    logg('LOG-D10', 'staff_assigned', { workOrderId: 'AO-A1' }),
    logg('LOG-D11', 'work_order_status', { workOrderId: 'AO-B1' }, { userId: BE }),
  ].concat(store.vift_activityLog);
  return store;
}

/* Förväntat urval (D-12–D-15, B4) för de syntetiska användarna i t3d-världen. */
const FORVANTAT = {
  falt: { activities: ['TASK-D1', 'TASK-D2', 'TASK-R1'], activityLog: ['LOG-D1', 'LOG-D10', 'LOG-D7'], offers: ['OFF-R1', 'OFF-R3'], customers: ['CU-R1'], properties: ['PROP-R1'], propertyObjects: ['OBJ-R1'], propertyContacts: ['PC-1', 'PC-2'] },
  falt2: { activities: ['TASK-D1', 'TASK-D5', 'TASK-D6', 'TASK-R2'], activityLog: ['LOG-D2', 'LOG-D8', 'LOG-D11'], offers: [], customers: ['CU-R1', 'CU-R2', 'CU-R3'], properties: ['PROP-R1', 'PROP-R2'], propertyObjects: ['OBJ-R1', 'OBJ-R2'], propertyContacts: ['PC-1', 'PC-2', 'PC-3'] },
  begransad: { activities: ['TASK-D6'], activityLog: ['LOG-D11'], offers: [], customers: ['CU-R2'], properties: ['PROP-R2'], propertyObjects: [], propertyContacts: ['PC-3'] },
};

module.exports = { t3dVarld, FORVANTAT };
