/**
 * ServiceIntervalService — Generell intervallmotor för serviceåtgärder (v1)
 * Används för fastigheter, objekt, utrustning och myndighetskontroller.
 * Data lagras i property.serviceIntervals[].
 */

const ServiceIntervalService = {

  /* ── Intervallförinställningar ──────────────────────── */
  PRESETS: {
    monthly:   { label: 'Varje månad',      days: 30  },
    quarterly: { label: 'Var tredje månad', days: 91  },
    biannual:  { label: 'Var sjätte månad', days: 182 },
    annual:    { label: 'Varje år',         days: 365 },
    biennial:  { label: 'Vartannat år',     days: 730 },
    custom:    { label: 'Eget intervall',   days: null }
  },

  /* ── Kategorier ─────────────────────────────────────── */
  CATEGORIES: [
    { key:'filterbyte',      label:'Filterbyte',             icon:'wind'          },
    { key:'ventilation',     label:'Ventilationsservice',    icon:'wind'          },
    { key:'ovk',             label:'OVK',                    icon:'clipboard-check'},
    { key:'brandkontroll',   label:'Brandkontroll',          icon:'flame'         },
    { key:'sba',             label:'SBA-kontroll',           icon:'shield'        },
    { key:'rokluckor',       label:'Provning rökluckor',     icon:'wind'          },
    { key:'hiss',            label:'Hissbesiktning',         icon:'arrow-up-down' },
    { key:'varme',           label:'Värmeservice',           icon:'thermometer'   },
    { key:'vatten',          label:'Vattenprov',             icon:'droplets'      },
    { key:'tak',             label:'Takkontroll',            icon:'home'          },
    { key:'lekplats',        label:'Lekplatsbesiktning',     icon:'tree-pine'     },
    { key:'fettavskiljare',  label:'Fettavskiljare',         icon:'filter'        },
    { key:'el',              label:'Elbesiktning',           icon:'zap'           },
    { key:'heating',         label:'Värmesystem',            icon:'thermometer'   },
    { key:'annat',           label:'Annat underhåll',        icon:'wrench'        }
  ],

  /* ── Statuströskel: dagar_kvar ≤ tröskeln = status ─── */
  _statusThreshold(interval) {
    const rem = interval.reminderDays || 14;
    return { alert: 7, approaching: rem };
  },

  /* ── Beräkna nästa förfallodatum ────────────────────── */
  calcNextDue(lastDoneIso, intervalDays) {
    if (!lastDoneIso || !intervalDays) return '';
    const d = new Date(lastDoneIso + 'T12:00:00');
    d.setDate(d.getDate() + Number(intervalDays));
    return d.toISOString().slice(0, 10);
  },

  /* ── Intervall i dagar (från preset eller custom) ───── */
  intervalDays(si) {
    if (si.intervalType === 'custom') return Number(si.intervalDays) || 0;
    return (this.PRESETS[si.intervalType] || {}).days || 0;
  },

  /* ── Dagar tills förfall (negativt = förfallen) ─────── */
  daysUntil(nextDue) {
    if (!nextDue) return null;
    const today = new Date(tdy() + 'T12:00:00');
    const due   = new Date(nextDue + 'T12:00:00');
    return Math.round((due - today) / 86400000);
  },

  /* ── Beräkna status ─────────────────────────────────── */
  // returns: 'ok' | 'approaching' | 'due_soon' | 'overdue' | 'not_set'
  getStatus(si) {
    if (!si.nextDue && !si.lastDone) return 'not_set';
    if (!si.nextDue) return 'not_set';
    const d = this.daysUntil(si.nextDue);
    if (d === null) return 'not_set';
    const thr = this._statusThreshold(si);
    if (d < 0)             return 'overdue';
    if (d <= thr.alert)    return 'due_soon';
    if (d <= thr.approaching) return 'approaching';
    return 'ok';
  },

  /* ── Statussträng för visning ───────────────────────── */
  statusLabel(si) {
    const st = this.getStatus(si);
    const d  = this.daysUntil(si.nextDue);
    if (st === 'not_set')    return 'Ej angivet';
    if (st === 'overdue')    return `Förfallen med ${Math.abs(d)} dag${Math.abs(d)===1?'':'ar'}`;
    if (st === 'due_soon')   return `Förfaller om ${d} dag${d===1?'':'ar'}`;
    if (st === 'approaching') return `Förfaller om ${d} dagar`;
    return 'OK';
  },

  /* ── Status-badge HTML ──────────────────────────────── */
  statusBadge(si) {
    const st = this.getStatus(si);
    const label = this.statusLabel(si);
    const cls = {
      ok:          'si-badge-ok',
      approaching: 'si-badge-approaching',
      due_soon:    'si-badge-due-soon',
      overdue:     'si-badge-overdue',
      not_set:     'si-badge-not-set'
    }[st] || 'si-badge-not-set';
    return `<span class="si-badge ${cls}">${label}</span>`;
  },

  /* ── Nästa datum som sträng ─────────────────────────── */
  nextDueLabel(si) {
    if (!si.nextDue) return '';
    const d = this.daysUntil(si.nextDue);
    const fmted = fmtDate ? fmtDate(si.nextDue) : si.nextDue;
    if (d < 0)    return `Förfallen med ${Math.abs(d)} dag${Math.abs(d)===1?'':'ar'}`;
    if (d === 0)  return `Förfaller idag`;
    return `Nästa: ${fmted}`;
  },

  /* ── Hämta alla interval för en fastighet ───────────── */
  getForProperty(propId) {
    const p = (state.properties || []).find(p => p.id === propId);
    return p ? (p.serviceIntervals || []) : [];
  },

  /* ── Hämta alla överskridna/närstående interval ──────── */
  getAllNeedingAttention() {
    const result = [];
    for (const p of (state.properties || [])) {
      for (const si of (p.serviceIntervals || [])) {
        const st = this.getStatus(si);
        if (st !== 'ok' && st !== 'not_set') {
          result.push({ propertyId: p.id, propertyName: p.name, address: p.address, interval: si, status: st });
        }
      }
    }
    return result;
  },

  /* ── Räkna förfallna per fastighet ─────────────────── */
  countOverdueForProperty(propId) {
    return this.getForProperty(propId).filter(si => this.getStatus(si) === 'overdue').length;
  },

  /* ── Räkna alla förfallna och närstående globalt ────── */
  countGlobalAlert() {
    let n = 0;
    for (const p of (state.properties || [])) {
      for (const si of (p.serviceIntervals || [])) {
        const st = this.getStatus(si);
        if (st === 'overdue' || st === 'due_soon' || st === 'approaching') n++;
      }
    }
    return n;
  },

  /* ── Skapa nytt serviceintervall ────────────────────── */
  create(propId, data) {
    const p = (state.properties || []).find(p => p.id === propId);
    if (!p) return null;
    if (!p.serviceIntervals) p.serviceIntervals = [];
    const days = data.intervalType === 'custom' ? Number(data.intervalDays || 0) : (this.PRESETS[data.intervalType] || {}).days || 0;
    const nextDue = this.calcNextDue(data.lastDone, days);
    const si = {
      id:                 'si-' + Date.now() + '-' + Math.random().toString(36).slice(2,6),
      title:              data.title || '',
      category:           data.category || 'annat',
      description:        data.description || '',
      lastDone:           data.lastDone || '',
      intervalType:       data.intervalType || 'annual',
      intervalDays:       days,
      nextDue:            nextDue,
      responsibleStaffId: data.responsibleStaffId || '',
      supplier:           data.supplier || '',
      reminderDays:       Number(data.reminderDays || 14),
      autoCreateAO:       !!data.autoCreateAO,
      history:            [],
      createdAt:          new Date().toISOString(),
      updatedAt:          new Date().toISOString()
    };
    p.serviceIntervals.push(si);
    persist();
    Sidebar.updateBadges();
    return si;
  },

  /* ── Uppdatera serviceintervall ─────────────────────── */
  update(propId, siId, data) {
    const p = (state.properties || []).find(p => p.id === propId);
    if (!p) return false;
    const si = (p.serviceIntervals || []).find(s => s.id === siId);
    if (!si) return false;
    const days = data.intervalType === 'custom' ? Number(data.intervalDays || 0) : (this.PRESETS[data.intervalType] || {}).days || 0;
    Object.assign(si, {
      title:              data.title              ?? si.title,
      category:           data.category           ?? si.category,
      description:        data.description        ?? si.description,
      lastDone:           data.lastDone            !== undefined ? data.lastDone : si.lastDone,
      intervalType:       data.intervalType       ?? si.intervalType,
      intervalDays:       days || si.intervalDays,
      nextDue:            this.calcNextDue(data.lastDone !== undefined ? data.lastDone : si.lastDone, days || si.intervalDays),
      responsibleStaffId: data.responsibleStaffId ?? si.responsibleStaffId,
      supplier:           data.supplier           ?? si.supplier,
      reminderDays:       data.reminderDays       !== undefined ? Number(data.reminderDays) : si.reminderDays,
      autoCreateAO:       data.autoCreateAO       !== undefined ? !!data.autoCreateAO : si.autoCreateAO,
      updatedAt:          new Date().toISOString()
    });
    persist();
    Sidebar.updateBadges();
    return true;
  },

  /* ── Ta bort serviceintervall ───────────────────────── */
  delete(propId, siId) {
    const p = (state.properties || []).find(p => p.id === propId);
    if (!p || !p.serviceIntervals) return false;
    const i = p.serviceIntervals.findIndex(s => s.id === siId);
    if (i < 0) return false;
    p.serviceIntervals.splice(i, 1);
    persist();
    Sidebar.updateBadges();
    return true;
  },

  /* ── Markera som utförd ─────────────────────────────── */
  markDone(propId, siId, { date, staffId, comment, aoId } = {}) {
    const p = (state.properties || []).find(p => p.id === propId);
    if (!p) return false;
    const si = (p.serviceIntervals || []).find(s => s.id === siId);
    if (!si) return false;
    const doneDate = date || tdy();
    const histEntry = {
      id:        'sh-' + Date.now(),
      date:      doneDate,
      staffId:   staffId || (state.currentUser ? state.currentUser.id : ''),
      comment:   comment || '',
      aoId:      aoId || '',
      createdAt: new Date().toISOString()
    };
    if (!si.history) si.history = [];
    si.history.unshift(histEntry);
    si.lastDone = doneDate;
    si.nextDue  = this.calcNextDue(doneDate, si.intervalDays);
    si.updatedAt = new Date().toISOString();
    persist();
    Sidebar.updateBadges();
    // In-app notification if near or overdue
    if (typeof NotificationsService !== 'undefined' && state.currentUser) {
      NotificationsService.push(state.currentUser.id, 'service_done',
        `${si.title} markerat som utfört — nästa: ${si.nextDue ? fmtDate(si.nextDue) : '–'}`,
        { propId, siId }
      );
    }
    return true;
  },

  /* ── Kolla om åtgärd ska generera AO (anropas vid markDone) */
  _maybeCreateAO(propId, si) {
    if (!si.autoCreateAO) return;
    const p = (state.properties || []).find(p => p.id === propId);
    if (!p) return;
    const cat = this.CATEGORIES.find(c => c.key === si.category);
    WorkOrderService.create({
      title:       si.title,
      description: si.description || '',
      customerId:  p.customerId || '',
      propertyId:  p.id,
      propertyName: p.name || '',
      address:     p.address || '',
      category:    cat ? cat.label : '',
      status:      'pool',
      priority:    'normal',
      scheduledDate: si.nextDue || ''
    });
  },

  /* ── Skapa push-notis (in-app) för kommande/förfallna ─ */
  pushAlerts() {
    if (typeof NotificationsService === 'undefined' || !state.currentUser) return;
    const uid = state.currentUser.id;
    const today = tdy();
    for (const p of (state.properties || [])) {
      for (const si of (p.serviceIntervals || [])) {
        const st = this.getStatus(si);
        if (st === 'overdue') {
          const d = Math.abs(this.daysUntil(si.nextDue));
          NotificationsService.push(uid, 'service_overdue',
            `⚠️ ${si.title} förfallet — ${p.name}. Förfallet med ${d} dag${d===1?'':'ar'}.`,
            { propId: p.id, siId: si.id }
          );
        } else if (st === 'due_soon' || st === 'approaching') {
          const d = this.daysUntil(si.nextDue);
          NotificationsService.push(uid, 'service_approaching',
            `${si.title} närmar sig — ${p.name}. Förfaller ${d <= 7 ? 'om '+d+' dagar':'den '+fmtDate(si.nextDue)}.`,
            { propId: p.id, siId: si.id }
          );
        }
      }
    }
  }
};
