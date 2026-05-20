/**
 * DashboardConfig — Widget-konfiguration för dashboard
 * Förberedd för framtida drag-and-drop och användaranpassning
 */
const DashboardConfig = {
  // Widgetar definieras med id, title, type, size, order, visible
  // size: 'small' (1/3 bredd), 'medium' (1/2 bredd), 'large' (2/3 bredd), 'full' (hel bredd)
  DEFAULT_WIDGETS: [
    { id: 'kpi',       title: 'KPI',               type: 'kpi',       size: 'full',   order: 1,  visible: true  },
    { id: 'todos',     title: 'Kräver åtgärd',     type: 'todos',     size: 'full',   order: 2,  visible: true  },
    { id: 'quickbtns', title: 'Snabbåtgärder',     type: 'quickbtns', size: 'full',   order: 3,  visible: true  },
    { id: 'today',     title: 'Idag',              type: 'today',     size: 'medium', order: 4,  visible: true  },
    { id: 'pool',      title: 'Arbetspool',        type: 'pool',      size: 'medium', order: 5,  visible: true  },
    { id: 'offers',    title: 'Offerter',          type: 'offers',    size: 'medium', order: 6,  visible: true  },
    { id: 'recurring', title: 'Återkommande',      type: 'recurring', size: 'medium', order: 7,  visible: true  },
    { id: 'sales',     title: 'Säljchanser',       type: 'sales',     size: 'full',   order: 8,  visible: true  },
    { id: 'activity',  title: 'Senaste aktivitet', type: 'activity',  size: 'full',   order: 9,  visible: true  },
  ],

  // Hämta aktuell konfiguration (sparad eller default)
  get: function() {
    try {
      var saved = JSON.parse(localStorage.getItem('dash-widgets') || 'null');
      if (saved && Array.isArray(saved)) return saved;
    } catch(e) {}
    return this.DEFAULT_WIDGETS;
  },

  save: function(widgets) {
    try { localStorage.setItem('dash-widgets', JSON.stringify(widgets)); } catch(e) {}
  },

  reset: function() {
    localStorage.removeItem('dash-widgets');
    return this.DEFAULT_WIDGETS;
  }
};
