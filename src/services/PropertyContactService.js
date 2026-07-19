/**
 * PropertyContactService — Ansvariga och kontakter per fastighet/objekt
 * Leverans D: hanterar kopplingar person ↔ fastighet/objekt med titelroller
 */
const PropertyContactService = (function () {

  /* ── Interna hjälpfunktioner ─────────────────────────────────────── */

  function _now() { return new Date().toISOString(); }

  function _arr() { return state.propertyContacts || []; }

  function _roles() { return state.propertyRoles || []; }

  /* ── PropertyRoles CRUD ──────────────────────────────────────────── */

  function getRole(id) {
    return _roles().find(function (r) { return r.id === id; }) || null;
  }

  function activeRoles() {
    return _roles().filter(function (r) { return r.active !== false; });
  }

  function createRole(data) {
    var now  = _now();
    var role = Object.assign(Schema.propertyRole(), data || {}, {
      id:        newId(_roles(), 'PROLE'),
      createdAt: now,
      updatedAt: now
    });
    if (!state.propertyRoles) state.propertyRoles = [];
    state.propertyRoles.push(role);
    persist();
    return role;
  }

  function updateRole(id, data) {
    var role = getRole(id);
    if (!role) return null;
    Object.assign(role, data, { updatedAt: _now() });
    persist();
    return role;
  }

  function toggleRoleActive(id) {
    var role = getRole(id);
    if (!role) return;
    role.active    = !role.active;
    role.updatedAt = _now();
    persist();
  }

  /* ── PropertyContacts CRUD ───────────────────────────────────────── */

  function getByProperty(propertyId, includeInactive) {
    return _arr().filter(function (c) {
      return c.propertyId === propertyId && (includeInactive || c.active !== false);
    });
  }

  function getByObject(objectId, includeInactive) {
    return _arr().filter(function (c) {
      return c.objectId === objectId && (includeInactive || c.active !== false);
    });
  }

  /**
   * Returnerar alla aktiva kontakter för en fastighet, sorterade:
   * primära först, sedan per rollens sortOrder.
   */
  function getForProperty(propertyId) {
    return _arr()
      .filter(function (c) { return c.propertyId === propertyId && c.active !== false && !c.objectId; })
      .sort(function (a, b) {
        if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
        var ra = getRole(a.roleId), rb = getRole(b.roleId);
        return ((ra && ra.sortOrder) || 0) - ((rb && rb.sortOrder) || 0);
      });
  }

  function add(data) {
    var now     = _now();
    var contact = Object.assign(Schema.propertyContact(), data || {}, {
      id:        newId(_arr(), 'PCON'),
      createdAt: now,
      updatedAt: now
    });
    /* Snapshot personuppgifter */
    _snapshotPerson(contact);
    if (!state.propertyContacts) state.propertyContacts = [];
    state.propertyContacts.push(contact);
    persist();
    return contact;
  }

  function update(id, data) {
    var c = _arr().find(function (x) { return x.id === id; });
    if (!c) return null;
    Object.assign(c, data, { updatedAt: _now() });
    _snapshotPerson(c);
    persist();
    return c;
  }

  function deactivate(id) {
    return update(id, { active: false });
  }

  function remove(id) {
    if (!state.propertyContacts) return;
    state.propertyContacts = state.propertyContacts.filter(function (c) { return c.id !== id; });
    persist();
  }

  /* ── Snapshot-hjälp ──────────────────────────────────────────────── */

  function _snapshotPerson(contact) {
    var role = getRole(contact.roleId);
    if (role) contact.roleNameSnapshot = role.name;

    if (contact.personType === 'staff') {
      var s = (state.staff || []).find(function (x) { return x.id === contact.personId; });
      if (s) {
        contact.personNameSnapshot  = (s.firstName + ' ' + s.lastName).trim();
        contact.personPhoneSnapshot = s.phone  || '';
        contact.personEmailSnapshot = s.email  || '';
      }
    } else if (contact.personType === 'customerContact') {
      /* Leta bland state.customers[].contacts[] */
      var found = null;
      (state.customers || []).forEach(function (cu) {
        (cu.contacts || []).forEach(function (cc) {
          if (cc.id === contact.personId) found = cc;
        });
      });
      if (found) {
        contact.personNameSnapshot  = found.name  || '';
        contact.personPhoneSnapshot = found.phone || '';
        contact.personEmailSnapshot = found.email || '';
      }
    }
    /* externalOther: personNameSnapshot är fri text, sätts av anroparen */
  }

  /* ── Presentationshjälp ──────────────────────────────────────────── */

  /**
   * Returnerar visningsnamn + telefon för den primäre kontakten med viss roll,
   * eller null om ingen finns.
   */
  function primaryForRole(propertyId, roleId) {
    var matches = getForProperty(propertyId).filter(function (c) {
      return c.roleId === roleId && c.isPrimary;
    });
    return matches.length ? matches[0] : null;
  }

  /**
   * Kortkort-vy: lista av { roleName, personName, phone, email } för en fastighet.
   */
  function summaryList(propertyId) {
    return getForProperty(propertyId).map(function (c) {
      return {
        id:         c.id,
        roleName:   c.roleNameSnapshot  || '',
        personName: c.personNameSnapshot || c.personId || '—',
        phone:      c.personPhoneSnapshot || '',
        email:      c.personEmailSnapshot || '',
        isPrimary:  c.isPrimary,
        notes:      c.notes || ''
      };
    });
  }

  /* ── Publikt API ─────────────────────────────────────────────────── */

  return {
    /* Roller */
    getRole:          getRole,
    activeRoles:      activeRoles,
    createRole:       createRole,
    updateRole:       updateRole,
    toggleRoleActive: toggleRoleActive,
    /* Kontaktkopplingar */
    getByProperty:    getByProperty,
    getByObject:      getByObject,
    getForProperty:   getForProperty,
    add:              add,
    update:           update,
    deactivate:       deactivate,
    remove:           remove,
    /* Presentationshjälp */
    primaryForRole:   primaryForRole,
    summaryList:      summaryList
  };

})();
