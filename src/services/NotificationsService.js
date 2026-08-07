/**
 * NotificationsService — In-app notiser
 * Varje notis är kopplad till en användare (userId).
 */
const NotificationsService = {

  push(userId, type, message, meta = {}) {
    if (!state.notifications) state.notifications = [];
    const n = {
      id: 'N-' + Date.now() + '-' + Math.floor(Math.random()*1000),
      userId,
      type,
      message,
      aoId:    meta.aoId    || '',
      offerId: meta.offerId || '',
      read:   false,
      createdAt: new Date().toISOString()
    };
    state.notifications.unshift(n);
    // Keep max 200 per user
    state.notifications = state.notifications.slice(0, 200);
    persistNotifs();
    Sidebar.updateBadges();
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
    const n = (state.notifications || []).find(x => x.id === id);
    if (n && !n.read) { n.read = true; persistNotifs(); Sidebar.updateBadges(); }
  },

  markAllRead() {
    const user = Auth.getUser();
    if (!user) return;
    (state.notifications || []).forEach(n => { if (n.userId === user.id) n.read = true; });
    persistNotifs();
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
