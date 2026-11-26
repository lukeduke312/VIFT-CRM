/**
 * NotificationsService — In-app notiser
 * Varje notis är kopplad till en användare (userId). T4-A (notiser): skrivs och markeras bara via
 * servern (store-key-write); läsningen (readAllWithHashes) ger bara användarens egna notiser.
 */
const NotificationsService = {

  /* T4-A, tilläggsdel notiser (punkt 275, beslutets punkt 7, AP-D): notisen skapas av SERVERN
     (store-key-write appendNotification). Servern sätter avsändare, tid och id, prövar att
     mottagaren är aktiv personal, att avsändaren ser referensen (AO) och får skapa typen
     ('ao_assigned' kräver ao_edit och att mottagaren är tilldelad AO:n; egna påminnelser bara
     till en själv), och bygger tilldelningstexten ur AO:n. Ingen lokal notis åt andra; en egen
     notis läggs in först när servern bekräftat den. Samma requestId vid omförsök (idempotent).
     Ett avslag (403) påverkar inget annat flöde. Returnerar ett löfte {ok, ...}. */
  push(userId, type, message, meta = {}) {
    if (!state.notifications) state.notifications = [];
    const requestId = 'NR-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    const notis = { userId: String(userId || ''), type: String(type || ''), aoId: meta.aoId || '', message: String(message || '') };
    if (typeof Storage === 'undefined' || typeof Storage.appendNotification !== 'function') return Promise.resolve({ ok: false, error: 'no_storage' });
    const self = this;
    const forsok = (n) => Storage.appendNotification(notis, requestId).then(function (r) {
      if (!r.ok && n < 2 && (r.error === 'network_error' || (r.status || 0) >= 500)) return forsok(n + 1);
      return r;
    });
    return forsok(0).then(function (r) {
      if (!r.ok) {
        console.warn('[NotificationsService] notisen avvisades av servern:', r.error, r.reason || '');
        return r;
      }
      const egen = r.data && r.data.notification;
      if (egen && !(state.notifications || []).some(x => x.id === egen.id)) {
        state.notifications = [egen].concat(state.notifications || []);
        if (typeof Sidebar !== 'undefined') Sidebar.updateBadges();
      }
      return { ok: true, id: r.data && r.data.id, duplicate: !!(r.data && r.data.duplicate) };
    }).catch(function (e) { console.warn('[NotificationsService] push fel:', e); return { ok: false, error: 'client_error' }; });
  },

  /* T4-A notiser: markeringen gäller bara egna notiser (servern markerar aldrig andras).
     Visas lästa direkt; nästa synk visar serverns läge om anropet misslyckades. */
  _markeraServer(ids) {
    if (typeof Storage === 'undefined' || typeof Storage.markNotificationsRead !== 'function') return Promise.resolve({ ok: false });
    return Storage.markNotificationsRead(ids).then(function (r) {
      if (!r.ok) console.warn('[NotificationsService] markering avvisades:', r.error, r.reason || '');
      return r;
    }).catch(function () { return { ok: false }; });
  },

  /* Get unread count for current user */
  unreadCount() {
    const user = Auth.getUser();
    if (!user) return 0;
    return (state.notifications || []).filter(n => n.userId === user.id && !n.read).length;
  },

  /* Get all notifications for current user, newest first */
  getForUser(limit = 30) {
    const user = Auth.getUser();
    if (!user) return [];
    return (state.notifications || [])
      .filter(n => n.userId === user.id)
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, limit);
  },

  markRead(id) {
    const user = Auth.getUser();
    const n = (state.notifications || []).find(x => x.id === id);
    if (!user || !n || n.read || n.userId !== user.id) return;
    n.read = true;
    Sidebar.updateBadges();
    this._markeraServer([id]);
  },

  markAllRead() {
    const user = Auth.getUser();
    if (!user) return;
    const egnaOlasta = (state.notifications || []).filter(n => n.userId === user.id && !n.read);
    if (egnaOlasta.length === 0) return;
    egnaOlasta.forEach(n => { n.read = true; });
    this._markeraServer('all');
    Sidebar.updateBadges();
  },

  _openAO(aoId) {
    Modal.close();
    Router.showPage('pg-ao-detail', { aoId });
  },

  _openOffer(offerId) {
    Modal.close();
    Router.showPage('pg-offer-detail', { offerId });
  },

  showPanel() {
    const list = this.getForUser(20);
    this.markAllRead();
    const rows = list.length === 0
      ? `<div class="empty" style="padding:24px 0;">${ic('bell',28)}<p style="font-size:12px;color:var(--mt);margin-top:8px;">Inga notiser</p></div>`
      : list.map(n => {
          const ao  = n.aoId    ? getAO(n.aoId)    : null;
          const off = n.offerId ? (state.offers||[]).find(o => o.id === n.offerId) : null;
          const target    = ao ? 'ao' : off ? 'offer' : null;
          const itemStyle = target ? 'cursor:pointer;' : '';
          const itemClick = target === 'ao'    ? `onclick="NotificationsService._openAO('${n.aoId}')"`
                          : target === 'offer' ? `onclick="NotificationsService._openOffer('${n.offerId}')"` : '';
          const iconName  = n.type === 'offer_approved' ? 'check-circle'
                          : n.type === 'ao_pool'        ? 'inbox'
                          : 'user-plus';
          const iconColor = n.type === 'offer_approved' ? 'color:var(--gr);' : '';
          return `
            <div class="list-item" style="padding:10px 12px;${itemStyle}" ${itemClick}>
              <div style="display:flex;gap:10px;align-items:flex-start;">
                <span style="margin-top:2px;flex-shrink:0;${iconColor}">${ic(iconName, 14)}</span>
                <div style="flex:1;">
                  <div style="font-size:12px;font-weight:600;color:var(--tx);">${esc(n.message)}</div>
                  <div style="font-size:10px;color:var(--mt);margin-top:2px;">${relDate(n.createdAt)}</div>
                </div>
              </div>
            </div>`;
        }).join('');

    Modal.open({
      title: `${ic('bell',15)} Notiser`,
      body: rows
    });
  }
};
