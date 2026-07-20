/**
 * PropertyObjectService.js — CRUD för objekt (lägenheter, lokaler, etc.)
 * Hierarki: Kund → Fastighet → Objekt
 * v1
 */

const PropertyObjectService = (() => {

  /* ── Hämta ────────────────────────────────────────────────── */

  function getAll() {
    return state.propertyObjects || [];
  }

  function getById(id) {
    return getPropObj(id);
  }

  /** Alla objekt för en specifik fastighet */
  function getByProperty(propertyId) {
    return getAll().filter(o => o.propertyId === propertyId);
  }

  /** Alla objekt för en specifik kund */
  function getByCustomer(customerId) {
    return getAll().filter(o => o.customerId === customerId);
  }

  /* ── Skapa ────────────────────────────────────────────────── */

  function create(fields) {
    const prop = getObj(fields.propertyId);
    if (!prop) throw new Error('Fastighet saknas: ' + fields.propertyId);

    const obj = Object.assign(Schema.propertyObject(), fields, {
      id:         newId(state.propertyObjects, 'OBJ'),
      customerId: prop.customerId || fields.customerId || '',
      createdAt:  new Date().toISOString(),
      updatedAt:  new Date().toISOString()
    });

    if (!state.propertyObjects) state.propertyObjects = [];
    state.propertyObjects.push(obj);
    persist();

    ActivityService.log('property_object_created', {
      objectId:   obj.id,
      objectName: obj.name || obj.objectNumber,
      propertyId: obj.propertyId
    });

    return obj;
  }

  /* ── Uppdatera ────────────────────────────────────────────── */

  function update(id, fields) {
    const idx = state.propertyObjects.findIndex(o => o.id === id);
    if (idx === -1) throw new Error('Objekt saknas: ' + id);

    const before = state.propertyObjects[idx];
    state.propertyObjects[idx] = Object.assign({}, before, fields, {
      id:        id,
      updatedAt: new Date().toISOString()
    });
    persist();

    ActivityService.log('property_object_updated', {
      objectId:   id,
      objectName: state.propertyObjects[idx].name || state.propertyObjects[idx].objectNumber
    });

    return state.propertyObjects[idx];
  }

  /* ── Ta bort ──────────────────────────────────────────────── */

  function remove(id) {
    const obj = getPropObj(id);
    if (!obj) return;

    // Skydda mot radering om det finns kopplade AO:er
    const linkedAO = (state.workOrders || []).filter(ao =>
      ao.objectId === id && !ao.deleted && !ao.archived
    );
    if (linkedAO.length > 0) {
      throw new Error(
        `Kan inte ta bort objekt med ${linkedAO.length} aktiv(a) arbetsorder(ar). Avsluta eller arkivera dem först.`
      );
    }

    // Skydda mot radering om det finns aktiva serviceintervall
    // Serviceintervall lagras nästlat i property.serviceIntervals[], inte i state.serviceIntervals
    const linkedSI = (state.properties || [])
      .flatMap(function(p) { return p.serviceIntervals || []; })
      .filter(function(si) { return si.objectId === id && si.active !== false; });
    if (linkedSI.length > 0) {
      throw new Error(
        `Kan inte ta bort objekt med ${linkedSI.length} aktivt/aktiva serviceintervall. Pausa eller ta bort dem först.`
      );
    }

    state.propertyObjects = state.propertyObjects.filter(o => o.id !== id);
    persist();

    ActivityService.log('property_object_deleted', {
      objectId:   id,
      objectName: obj.name || obj.objectNumber,
      propertyId: obj.propertyId
    });
  }

  /* ── Kontakter ────────────────────────────────────────────── */

  function addContact(objectId, { contactId, role = '', validFrom = '', validTo = '', active = true }) {
    const obj = getPropObj(objectId);
    if (!obj) throw new Error('Objekt saknas: ' + objectId);

    const contacts = [...(obj.contacts || []), {
      contactId,
      role,
      validFrom,
      validTo,
      active
    }];
    return update(objectId, { contacts });
  }

  function removeContact(objectId, contactId) {
    const obj = getPropObj(objectId);
    if (!obj) throw new Error('Objekt saknas: ' + objectId);
    const contacts = (obj.contacts || []).filter(c => c.contactId !== contactId);
    return update(objectId, { contacts });
  }

  /* ── Utrustning ───────────────────────────────────────────── */

  function addEquipment(objectId, { name, type = '', serialNumber = '', installedAt = '' }) {
    const obj = getPropObj(objectId);
    if (!obj) throw new Error('Objekt saknas: ' + objectId);

    const equipment = [...(obj.equipment || []), {
      id:           newId(obj.equipment || [], 'EQ'),
      name,
      type,
      serialNumber,
      installedAt
    }];
    return update(objectId, { equipment });
  }

  function removeEquipment(objectId, eqId) {
    const obj = getPropObj(objectId);
    if (!obj) throw new Error('Objekt saknas: ' + objectId);
    const equipment = (obj.equipment || []).filter(e => e.id !== eqId);
    return update(objectId, { equipment });
  }

  /* ── Sökning/filtrering ───────────────────────────────────── */

  function search(propertyId, { query = '', type = '', status = '' } = {}) {
    let list = getByProperty(propertyId);

    if (type)   list = list.filter(o => o.type === type);
    if (status) list = list.filter(o => o.status === status);
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(o =>
        (o.name         || '').toLowerCase().includes(q) ||
        (o.objectNumber || '').toLowerCase().includes(q) ||
        (o.description  || '').toLowerCase().includes(q) ||
        (o.entrance     || '').toLowerCase().includes(q)
      );
    }

    return list.sort((a, b) => (a.objectNumber || '').localeCompare(b.objectNumber || '', 'sv'));
  }

  /* ── Etiketter ────────────────────────────────────────────── */

  function typeLabel(key) {
    const t = (typeof PROPERTY_OBJECT_TYPES !== 'undefined' ? PROPERTY_OBJECT_TYPES : [])
      .find(t => t.key === key);
    return t ? t.label : key || '—';
  }

  function statusLabel(key) {
    const s = (typeof PROPERTY_OBJECT_STATUSES !== 'undefined' ? PROPERTY_OBJECT_STATUSES : [])
      .find(s => s.key === key);
    return s ? s.label : key || '—';
  }

  function statusBadgeClass(key) {
    const map = {
      aktiv:      'badge-green',
      vakant:     'badge-yellow',
      avstaelld:  'badge-gray',
      uthyrd:     'badge-blue',
      renovering: 'badge-orange',
      inaktiv:    'badge-gray'
    };
    return map[key] || 'badge-gray';
  }

  /* ── Publik API ───────────────────────────────────────────── */

  return {
    getAll,
    getById,
    getByProperty,
    getByCustomer,
    create,
    update,
    remove,
    addContact,
    removeContact,
    addEquipment,
    removeEquipment,
    search,
    typeLabel,
    statusLabel,
    statusBadgeClass
  };
})();
