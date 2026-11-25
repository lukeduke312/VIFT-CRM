/**
 * ActivityService — Central aktivitetslogg
 * Används av hela systemet för att spåra händelser
 */

const ActivityService = {

  MAX_ENTRIES: 500,

  /**
   * Logga en aktivitet.
   *
   * GLOBAL LIVE UI R1A.1: `opts.persist` är ett bakåtkompatibelt OPT-OUT —
   * default (`opts` utelämnat, eller `opts.persist` inte explicit `false`)
   * är EXAKT det beteende log() alltid haft: skriv entry + eget persist().
   * Alla ~40 befintliga anropsplatser (WorkOrderService, InvoiceService,
   * SalesService, m.fl.) är OFÖRÄNDRADE av detta — bara CustomerServices
   * confirmed-write-path (updateConfirmed()) använder `{persist:false}`,
   * för att undvika en andra, dold persist()-skrivning utöver den EN
   * väntade skrivning callern redan gör. Se RAPPORT-GLOBAL-LIVE-UI-R1A-1.md. */
  log(type, description, meta = {}, opts = {}) {
    const entry = {
      /* QA FIX-ROUND 2026-11-12 (C1 root cause, verified on live STAGING):
         `'ACT-' + Date.now()` gave two entries logged in the same
         millisecond the SAME id — the stored duplicate in vift_activityLog
         is exactly that: ACT-1793611007122, a 'staff_assigned' and a
         'work_order_updated' entry written by one updateStaff() call at
         2026-11-02T09:16:47.122Z. That duplicate makes every later
         activityLog write fail (backlog C1). Same prefix and millisecond
         ordering as before, plus a random suffix, so a new duplicate can
         no longer be produced. (The existing stored duplicate needs the
         separate DB cleanup in _staging_integration/
         PLAN_activitylog_dedup_2026-11-12.md.) */
      id: 'ACT-' + Date.now() + '-' + ((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)),
      type,
      description,
      timestamp: new Date().toISOString(),
      customerId:          meta.customerId          || '',
      propertyId:          meta.propertyId          || '',
      workOrderId:         meta.workOrderId         || '',
      offerId:             meta.offerId             || '',
      invoiceId:           meta.invoiceId           || '',
      salesOpportunityId:  meta.salesOpportunityId  || '',
      inspectionId:        meta.inspectionId        || '',
      ronderingId:         meta.ronderingId         || '',
      deviationId:         meta.deviationId         || '',
      userId:              (state.currentUser && state.currentUser.id) || ''
    };

    if (!state.activityLog) state.activityLog = [];
    state.activityLog.unshift(entry);

    // Begränsa till MAX_ENTRIES
    if (state.activityLog.length > this.MAX_ENTRIES) {
      state.activityLog = state.activityLog.slice(0, this.MAX_ENTRIES);
    }

    /* 2026-11-24: serverstyrd aktivitetslogg. När servern stöder
       appendActivity skickas EN post (servern sätter användare och tid);
       hela listan skrivs aldrig mer via persist() (vift_activityLog är då
       append-only). Annars, mot äldre server: som förut. */
    this._send(entry, opts.persist !== false);
    return entry;
  },

  _append: null,          // null = okänt, true = servern stöder appendActivity, false = äldre server
  _outbox: [],
  _flushing: false,
  /* T3-A (SÄK-9): utkorgen i minnet hör till EN ägare (miljö + e-post,
     `_outboxOwner`) och lagras under en ägarnycklad nyckel. Tidigare
     användes state.currentUser.email, som aldrig sattes — kön fanns bara
     i minnet och kunde efter ett kontobyte i samma flik skickas med nästa
     användares session. Nu: vid kontobyte sparas kön under sin ägare och
     töms ur minnet; den skickas bara när ägaren är inloggad. Posterna
     själva skickas oförändrade (ägaren ligger i nyckeln, inte i posten). */
  _outboxOwner: null,
  _ownerId() {
    try { return (typeof Auth !== 'undefined' && Auth.ownerIdentity) ? Auth.ownerIdentity() : null; } catch (e) { return null; }
  },
  _keyFor(id) { return id && id.email ? 'vift_activityOutbox::' + id.env + '::' + id.email : null; },
  _ownerTag(id) { return id && id.email ? id.env + '|' + id.email : null; },
  _outboxKey() {
    const id = this._ownerId();
    if (this._outboxOwner && this._ownerTag(id) !== this._outboxOwner) this.resetForAccountChange();
    if (id && !this._outboxOwner) this._outboxOwner = this._ownerTag(id);
    return this._keyFor(id);
  },
  _saveOutbox() {
    const k = this._outboxKey(); if (!k) return;
    try { if (this._outbox.length) localStorage.setItem(k, JSON.stringify(this._outbox.slice(-200))); else localStorage.removeItem(k); } catch (e) {}
  },
  _loadOutbox() {
    const k = this._outboxKey(); if (!k) return;
    try { const v = JSON.parse(localStorage.getItem(k) || '[]'); if (Array.isArray(v)) v.forEach((e) => { if (e && e.id && !this._outbox.some((x) => x.id === e.id)) this._outbox.push(e); }); } catch (e) {}
  },
  resetForAccountChange() {
    if (this._outboxOwner && this._outbox.length) {
      const parts = this._outboxOwner.split('|');
      const k = this._keyFor({ env: parts[0], email: parts.slice(1).join('|') });
      try { if (k) localStorage.setItem(k, JSON.stringify(this._outbox.slice(-200))); } catch (e) {}
    }
    this._outbox = [];
    this._outboxOwner = null;
  },
  pendingCount() {
    const k = this._outboxKey(); if (!k) return this._outbox.length;
    this._loadOutbox();
    return this._outbox.length;
  },
  async _call(body, ownerKey) {
    if (typeof Storage === 'undefined' || !Storage._authFetch || typeof Storage._functionsBase !== 'function') return { status: 0 };
    try {
      const res = await Storage._authFetch(Storage._functionsBase() + '/store-key-write', { body: JSON.stringify(body), timeoutMs: Storage.WRITE_TIMEOUT_MS, ownerKey: ownerKey || undefined });
      let data = {}; try { data = await res.json(); } catch (e) {}
      return { status: res.status, data };
    } catch (e) { return { status: 0 }; }
  },
  /* Sondering: ofullständig post → ny server svarar invalid_* (400),
     äldre server unknown_action. Osäkert svar cachas inte. */
  async supportsAppend() {
    if (this._append !== null) return this._append;
    const r = await this._call({ action: 'appendActivity', entry: null });
    if (r.status === 400 && r.data && r.data.error === 'unknown_action') this._append = false;
    else if (r.status === 400) this._append = true;
    return this._append === true;
  },
  _markSynced() {
    // Hela listan ska inte skickas via persist(): baslinjen följer lokalt läge.
    try { if (state._keySnapshot) state._keySnapshot.activityLog = JSON.stringify(state.activityLog); } catch (e) {}
  },
  async _send(entry, legacyPersist) {
    const sup = await this.supportsAppend();
    if (!sup) { if (this._append === false && legacyPersist) persist(); else if (this._append === null && legacyPersist) persist(); return; }
    this._outboxKey(); // byter ägare (sparar och tömmer) om inloggningen ändrats
    this._outbox.push(entry); this._saveOutbox(); this._markSynced();
    return this.flush();
  },
  /* Skickar väntande poster i ordning; nätfel lämnar dem kvar till nästa
     försök (nästa loggning eller när nätet kommer tillbaka). Ett definitivt
     avslag (4xx) tas bort — det blir inte bättre av omsändning. */
  async flush() {
    if (this._flushing || this._append !== true) return;
    /* T3-A: bara ägarens egen, aktuella session skickar kön. */
    const me = (typeof Auth !== 'undefined' && Auth.ownerKey) ? Auth.ownerKey() : null;
    if (typeof Auth !== 'undefined' && Auth.ownerKey && (!me || (typeof Auth.hasAccess === 'function' && !Auth.hasAccess()))) return;
    this._flushing = true;
    try {
      this._loadOutbox();
      if (me && this._outboxOwner !== me) return;
      while (this._outbox.length) {
        const e = this._outbox[0];
        const r = await this._call({ action: 'appendActivity', entry: e }, me);
        if (me && this._outboxOwner !== me) break;
        if (r.status === 0 || r.status >= 500) break;
        this._outbox.shift(); this._saveOutbox();
        if (r.status >= 400) console.warn('[ActivityService] aktivitet avvisad av servern:', r.data && r.data.error, e.type);
      }
    } finally { this._flushing = false; }
  },

  /**
   * Hämta senaste aktiviteter (alla)
   */
  getRecent(limit = 20) {
    return (state.activityLog || []).slice(0, limit);
  },

  /**
   * Filtrera per kund
   */
  getByCustomer(customerId, limit = 50) {
    return (state.activityLog || [])
      .filter(e => e.customerId === customerId)
      .slice(0, limit);
  },

  /**
   * Filtrera per arbetsorder
   */
  getByWorkOrder(workOrderId, limit = 50) {
    return (state.activityLog || [])
      .filter(e => e.workOrderId === workOrderId)
      .slice(0, limit);
  },

  /**
   * Filtrera per säljchans
   */
  getBySalesOpp(salesOpportunityId, limit = 50) {
    return (state.activityLog || [])
      .filter(e => e.salesOpportunityId === salesOpportunityId)
      .slice(0, limit);
  },

  /**
   * Filtrera per typ
   */
  getByType(type, limit = 50) {
    return (state.activityLog || [])
      .filter(e => e.type === type)
      .slice(0, limit);
  },

  /**
   * Rendera ett log-objekt som HTML (för dashboard)
   */
  renderEntry(entry) {
    const dotColor = this._dotColor(entry.type);
    const timeStr  = relDate(entry.timestamp);
    return `
      <div class="act-item">
        <div class="act-dot ${dotColor}"></div>
        <span class="act-text">${this._escHtml(entry.description)}</span>
        <span class="act-time">${timeStr}</span>
      </div>`;
  },

  /**
   * Rendera lista av logg-poster
   */
  renderList(entries) {
    if (!entries || entries.length === 0) {
      return '<div class="empty" style="padding:16px;"><p>Ingen aktivitet ännu</p></div>';
    }
    return entries.map(e => this.renderEntry(e)).join('');
  },

  _dotColor(type) {
    const map = {
      work_order_created:   'blue',
      work_order_completed: 'green',
      work_order_updated:   '',
      customer_created:     'green',
      offer_created:        'blue',
      offer_sent:           'blue',
      offer_accepted:       'green',
      offer_declined:       'red',
      invoice_created:      'purple',
      invoice_paid:         'green',
      sales_opportunity_created: '',
      sales_opportunity_done:    'green',
      sales_opportunity_snoozed: 'orange',
      sales_opportunity_order:   'green',
      sales_opportunity_quote:   'blue',
      time_entry_created:    '',
      inspection_completed:  'green',
      rondering_created:     'blue',
      rondering_draft:       '',
      rondering_started:     'blue',
      rondering_completed:   'green',
      point_ok:              'green',
      point_ej_aktuell:      '',
      deviation_created:     'red',
      ao_from_deviation:     'purple'
    };
    return map[type] || '';
  },

  _escHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
};

/* Väntande aktivitetsposter skickas när nätet kommer tillbaka. */
if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('online', function () { try { ActivityService.flush(); } catch (e) {} });
