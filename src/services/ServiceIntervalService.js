/**
 * ServiceIntervalService — Generell intervallmotor för serviceåtgärder (v2)
 *
 * Fullständig datamodell med idempotensnycklar, korrekt kalenderbaserad
 * datumberäkning, pausad-status, AO-mallfält och historik med previousNextDue.
 *
 * Data lagras i property.serviceIntervals[] inom property-blob i Supabase.
 * Framtida kopplingar: objectId, technicalCategorySlug, equipmentId.
 */

const ServiceIntervalService = {

  /* ── Intervalltyper ─────────────────────────────────────── */
  INTERVAL_TYPES: [
    { key: 'monthly',       label: 'Varje månad',       unit: 'month', n: 1  },
    { key: 'quarterly',     label: 'Var tredje månad',  unit: 'month', n: 3  },
    { key: 'biannual',      label: 'Var sjätte månad',  unit: 'month', n: 6  },
    { key: 'annual',        label: 'Varje år',          unit: 'year',  n: 1  },
    { key: 'biennial',      label: 'Vartannat år',      unit: 'year',  n: 2  },
    { key: 'custom_days',   label: 'Eget antal dagar',  unit: 'day',   n: null },
    { key: 'custom_months', label: 'Eget antal månader',unit: 'month', n: null },
    { key: 'custom_years',  label: 'Eget antal år',     unit: 'year',  n: null }
  ],

  /* ── Kategorier ─────────────────────────────────────────── */
  CATEGORIES: [
    { key: 'filterbyte',     label: 'Filterbyte',              icon: 'wind'           },
    { key: 'ventilation',    label: 'Ventilationsservice',     icon: 'wind'           },
    { key: 'ovk',            label: 'OVK',                     icon: 'clipboard-check'},
    { key: 'brandkontroll',  label: 'Brandkontroll',           icon: 'flame'          },
    { key: 'sba',            label: 'SBA-kontroll',            icon: 'shield'         },
    { key: 'rokluckor',      label: 'Provning rökluckor',      icon: 'wind'           },
    { key: 'hiss',           label: 'Hissbesiktning',          icon: 'arrow-up-down'  },
    { key: 'varme',          label: 'Värmeservice',            icon: 'thermometer'    },
    { key: 'vatten',         label: 'Vattenprov',              icon: 'droplets'       },
    { key: 'tak',            label: 'Takkontroll',             icon: 'home'           },
    { key: 'lekplats',       label: 'Lekplatsbesiktning',      icon: 'tree-pine'      },
    { key: 'fettavskiljare', label: 'Fettavskiljare',          icon: 'filter'         },
    { key: 'avlopp',         label: 'Avloppsspolning',         icon: 'droplets'       },
    { key: 'el',             label: 'Elbesiktning',            icon: 'zap'            },
    { key: 'heating',        label: 'Värmesystem',             icon: 'thermometer'    },
    { key: 'annat',          label: 'Annat underhåll',         icon: 'wrench'         }
  ],

  /* ── Skapa en tom datamall ──────────────────────────────── */
  newInterval() {
    return {
      id:                            '',
      title:                         '',
      category:                      'filterbyte',
      description:                   '',

      /* Framtida koppling till objekt/utrustning */
      objectId:                      '',
      technicalCategorySlug:         '',
      equipmentId:                   '',

      /* Intervall */
      intervalType:                  'annual',
      intervalValue:                 1,        // antal dagar/månader/år vid custom_*

      /* Datum */
      lastDone:                      '',
      nextDue:                       '',

      /* Ansvarig */
      responsibleStaffId:            '',
      supplier:                      '',

      /* Påminnelse & status */
      reminderDays:                  14,       // varna X dagar före nextDue
      active:                        true,     // false = pausad

      /* AO-mall */
      autoCreateAO:                  false,
      aoCreateDaysBefore:            0,        // 0 = på förfallodagen
      aoTitle:                       '',       // tomt = använd si.title
      aoDescription:                 '',
      aoCategory:                    '',
      aoPriority:                    'normal',
      aoStaff:                       [],

      /* Idempotensnycklar — sätts av bevakningskörningen */
      lastNotificationSentForDueDate:'',       // nextDue för senast skickad notis
      lastAOGeneratedForDueDate:     '',       // nextDue för senast skapad AO
      lastGeneratedAOId:             '',       // id på senast skapade AO

      history:                       [],
      createdAt:                     '',
      updatedAt:                     ''
    };
  },

  /* ── Datumberäkning — kalenderbaserad (ej dagar-approximation) ── */
  calcNextDue(lastDoneIso, intervalType, intervalValue) {
    if (!lastDoneIso || !intervalType) return '';
    const d   = new Date(lastDoneIso + 'T12:00:00');
    const itn = this.INTERVAL_TYPES.find(t => t.key === intervalType);
    if (!itn) return '';
    const n = itn.n !== null ? itn.n : Number(intervalValue || 1);
    if (itn.unit === 'day')   { d.setDate(d.getDate() + n); }
    else if (itn.unit === 'month') {
      const targetMonth = d.getMonth() + n;
      const targetYear  = d.getFullYear() + Math.floor(targetMonth / 12);
      const month       = ((targetMonth % 12) + 12) % 12;
      const lastDay     = new Date(targetYear, month + 1, 0).getDate();
      d.setFullYear(targetYear, month, Math.min(d.getDate(), lastDay));
    } else if (itn.unit === 'year') {
      const targetYear = d.getFullYear() + n;
      /* Hantera skottår: 29 feb + 1 år → 28 feb */
      const lastDay = new Date(targetYear, d.getMonth() + 1, 0).getDate();
      d.setFullYear(targetYear, d.getMonth(), Math.min(d.getDate(), lastDay));
    }
    return d.toISOString().slice(0, 10);
  },

  /* ── Dagar tills förfall (negativt = förfallen) ──────────── */
  daysUntil(nextDue) {
    if (!nextDue) return null;
    const today = new Date(tdy() + 'T12:00:00');
    const due   = new Date(nextDue + 'T12:00:00');
    return Math.round((due - today) / 86400000);
  },

  /* ── Beräkna status ──────────────────────────────────────── */
  // 'ok' | 'approaching' | 'due_soon' | 'overdue' | 'paused' | 'not_set'
  getStatus(si) {
    if (!si.active) return 'paused';
    if (!si.nextDue) return 'not_set';
    const d   = this.daysUntil(si.nextDue);
    if (d === null) return 'not_set';
    const rem = Number(si.reminderDays || 14);
    if (d < 0)      return 'overdue';
    if (d <= 7)     return 'due_soon';
    if (d <= rem)   return 'approaching';
    return 'ok';
  },

  /* ── Statusetikett ────────────────────────────────────────── */
  statusLabel(si) {
    const st = this.getStatus(si);
    const d  = this.daysUntil(si.nextDue);
    if (st === 'paused')    return 'Pausad';
    if (st === 'not_set')   return 'Datum saknas';
    if (st === 'overdue')   return `Förfallen med ${Math.abs(d)} dag${Math.abs(d) === 1 ? '' : 'ar'}`;
    if (st === 'due_soon')  return d === 0 ? 'Förfaller idag' : `Förfaller om ${d} dag${d === 1 ? '' : 'ar'}`;
    if (st === 'approaching') return `Förfaller om ${d} dagar`;
    return 'OK';
  },

  /* ── Status-badge HTML ───────────────────────────────────── */
  statusBadge(si) {
    const st  = this.getStatus(si);
    const cls = {
      ok:          'si-badge-ok',
      approaching: 'si-badge-approaching',
      due_soon:    'si-badge-due-soon',
      overdue:     'si-badge-overdue',
      paused:      'si-badge-paused',
      not_set:     'si-badge-not-set'
    }[st] || 'si-badge-not-set';
    return `<span class="si-badge ${cls}">${this.statusLabel(si)}</span>`;
  },

  /* ── Intervallbeskrivning som text ───────────────────────── */
  intervalLabel(si) {
    const itn = this.INTERVAL_TYPES.find(t => t.key === si.intervalType);
    if (!itn) return si.intervalType || '—';
    if (itn.n !== null) return itn.label;
    const v = Number(si.intervalValue || 1);
    const u = { day: 'dag', month: 'månad', year: 'år' }[itn.unit] || itn.unit;
    const up = { day: 'dagar', month: 'månader', year: 'år' }[itn.unit] || itn.unit;
    return v === 1 ? `Varje ${u}` : `Var ${v}:e ${u} (${v} ${up})`;
  },

  /* ── Hämta alla interval för en fastighet ────────────────── */
  getForProperty(propId) {
    const p = (state.properties || []).find(p => p.id === propId);
    return p ? (p.serviceIntervals || []) : [];
  },

  /* ── Hämta alla som kräver uppmärksamhet (globalt) ────────── */
  getAllNeedingAttention() {
    const result = [];
    for (const p of (state.properties || [])) {
      for (const si of (p.serviceIntervals || [])) {
        const st = this.getStatus(si);
        if (st === 'overdue' || st === 'due_soon' || st === 'approaching') {
          result.push({ propertyId: p.id, propertyName: p.name, address: p.address, interval: si, status: st });
        }
      }
    }
    return result.sort((a, b) => (this.daysUntil(a.interval.nextDue) || 999) - (this.daysUntil(b.interval.nextDue) || 999));
  },

  /* ── Global alert-räknare för sidebar ────────────────────── */
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

  countGlobalOverdue() {
    let n = 0;
    for (const p of (state.properties || [])) {
      for (const si of (p.serviceIntervals || [])) {
        if (this.getStatus(si) === 'overdue') n++;
      }
    }
    return n;
  },

  /* ── Skapa nytt serviceintervall ─────────────────────────── */
  create(propId, data) {
    const p = (state.properties || []).find(p => p.id === propId);
    if (!p) return null;
    if (!p.serviceIntervals) p.serviceIntervals = [];
    const nextDue = this.calcNextDue(data.lastDone, data.intervalType, data.intervalValue);
    const base = this.newInterval();
    const si = Object.assign(base, {
      id:                    'si-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      title:                 data.title              || '',
      category:              data.category           || 'filterbyte',
      description:           data.description        || '',
      objectId:              data.objectId           || '',
      technicalCategorySlug: data.technicalCategorySlug || '',
      equipmentId:           data.equipmentId        || '',
      intervalType:          data.intervalType       || 'annual',
      intervalValue:         Number(data.intervalValue || 1),
      lastDone:              data.lastDone           || '',
      nextDue:               nextDue,
      responsibleStaffId:    data.responsibleStaffId || '',
      supplier:              data.supplier           || '',
      reminderDays:          Number(data.reminderDays || 14),
      active:                data.active !== false,
      autoCreateAO:          !!data.autoCreateAO,
      aoCreateDaysBefore:    Number(data.aoCreateDaysBefore || 0),
      aoTitle:               data.aoTitle            || '',
      aoDescription:         data.aoDescription      || '',
      aoCategory:            data.aoCategory         || '',
      aoPriority:            data.aoPriority         || 'normal',
      aoStaff:               data.aoStaff            || [],
      history:               [],
      createdAt:             new Date().toISOString(),
      updatedAt:             new Date().toISOString()
    });
    p.serviceIntervals.push(si);
    persist();
    if (typeof Sidebar !== 'undefined') Sidebar.updateBadges();
    return si;
  },

  /* ── Uppdatera serviceintervall ──────────────────────────── */
  update(propId, siId, data) {
    const p  = (state.properties || []).find(p => p.id === propId);
    if (!p)  return false;
    const si = (p.serviceIntervals || []).find(s => s.id === siId);
    if (!si) return false;

    /* Räkna om nextDue bara om lastDone eller intervalType ändras */
    const lastDone    = data.lastDone     !== undefined ? data.lastDone    : si.lastDone;
    const iType       = data.intervalType !== undefined ? data.intervalType : si.intervalType;
    const iValue      = data.intervalValue !== undefined ? Number(data.intervalValue) : si.intervalValue;
    const newNextDue  = this.calcNextDue(lastDone, iType, iValue);

    Object.assign(si, {
      title:                 data.title              !== undefined ? data.title              : si.title,
      category:              data.category           !== undefined ? data.category           : si.category,
      description:           data.description        !== undefined ? data.description        : si.description,
      objectId:              data.objectId           !== undefined ? data.objectId           : si.objectId,
      technicalCategorySlug: data.technicalCategorySlug !== undefined ? data.technicalCategorySlug : si.technicalCategorySlug,
      equipmentId:           data.equipmentId        !== undefined ? data.equipmentId        : si.equipmentId,
      intervalType:          iType,
      intervalValue:         iValue,
      lastDone,
      nextDue:               newNextDue || si.nextDue,
      responsibleStaffId:    data.responsibleStaffId !== undefined ? data.responsibleStaffId : si.responsibleStaffId,
      supplier:              data.supplier           !== undefined ? data.supplier           : si.supplier,
      reminderDays:          data.reminderDays       !== undefined ? Number(data.reminderDays) : si.reminderDays,
      active:                data.active             !== undefined ? !!data.active           : si.active,
      autoCreateAO:          data.autoCreateAO       !== undefined ? !!data.autoCreateAO     : si.autoCreateAO,
      aoCreateDaysBefore:    data.aoCreateDaysBefore !== undefined ? Number(data.aoCreateDaysBefore) : si.aoCreateDaysBefore,
      aoTitle:               data.aoTitle            !== undefined ? data.aoTitle            : si.aoTitle,
      aoDescription:         data.aoDescription      !== undefined ? data.aoDescription      : si.aoDescription,
      aoCategory:            data.aoCategory         !== undefined ? data.aoCategory         : si.aoCategory,
      aoPriority:            data.aoPriority         !== undefined ? data.aoPriority         : si.aoPriority,
      aoStaff:               data.aoStaff            !== undefined ? data.aoStaff            : si.aoStaff,
      updatedAt:             new Date().toISOString()
    });
    persist();
    if (typeof Sidebar !== 'undefined') Sidebar.updateBadges();
    return true;
  },

  /* ── Pausa / återuppta ───────────────────────────────────── */
  setPaused(propId, siId, paused) {
    return this.update(propId, siId, { active: !paused });
  },

  /* ── Ta bort ─────────────────────────────────────────────── */
  delete(propId, siId) {
    const p = (state.properties || []).find(p => p.id === propId);
    if (!p || !p.serviceIntervals) return false;
    const i = p.serviceIntervals.findIndex(s => s.id === siId);
    if (i < 0) return false;
    p.serviceIntervals.splice(i, 1);
    persist();
    if (typeof Sidebar !== 'undefined') Sidebar.updateBadges();
    return true;
  },

  /* ── Markera som utförd ──────────────────────────────────── */
  markDone(propId, siId, { date, staffId, comment, aoId } = {}) {
    const p  = (state.properties || []).find(p => p.id === propId);
    if (!p)  return false;
    const si = (p.serviceIntervals || []).find(s => s.id === siId);
    if (!si) return false;

    const doneDate        = date || tdy();
    const previousNextDue = si.nextDue;

    const histEntry = {
      id:              'sh-' + Date.now(),
      date:            doneDate,
      previousNextDue: previousNextDue,
      staffId:         staffId || (state.currentUser ? state.currentUser.id : ''),
      comment:         comment || '',
      aoId:            aoId    || '',
      createdAt:       new Date().toISOString()
    };

    if (!si.history) si.history = [];
    si.history.unshift(histEntry);

    si.lastDone  = doneDate;
    si.nextDue   = this.calcNextDue(doneDate, si.intervalType, si.intervalValue);
    si.updatedAt = new Date().toISOString();

    /* Nollställ idempotensnycklar — ny period börjar */
    si.lastNotificationSentForDueDate = '';
    si.lastAOGeneratedForDueDate      = '';

    persist();
    if (typeof Sidebar !== 'undefined') Sidebar.updateBadges();

    /* In-app notification */
    if (typeof NotificationsService !== 'undefined' && state.currentUser) {
      NotificationsService.push(
        state.currentUser.id,
        'service_done',
        `${si.title} markerat som utfört — nästa: ${si.nextDue ? (typeof fmtDate === 'function' ? fmtDate(si.nextDue) : si.nextDue) : '–'}`,
        { propId, siId }
      );
    }

    return true;
  },

  /* ── Bevakningskörning (anropas vid app-start och kan anropas dagligen) ── */
  /*
   * Skapar uppgifter i Att göra och in-app notiser för förfallna/närstående.
   * Idempotent: en unik nyckel (siId + nextDue) förhindrar dubbletter.
   * Riktig web-push och automatisk AO-skapelse hanteras av Edge Function (Leverans 2).
   */
  runDailyCheck() {
    if (typeof ActivitiesService === 'undefined') return;
    const today  = tdy();
    const userId = state.currentUser ? state.currentUser.id : null;
    let changed  = false;

    for (const p of (state.properties || [])) {
      for (const si of (p.serviceIntervals || [])) {
        if (!si.active || !si.nextDue) continue;
        const st = this.getStatus(si);
        if (st !== 'overdue' && st !== 'due_soon' && st !== 'approaching') continue;

        /* Idempotent — en unik nyckel per (interval, förfalloperiod) */
        const periodKey = si.id + '::' + si.nextDue;
        if (si.lastNotificationSentForDueDate === periodKey) continue;

        /* Skapa uppgift i Att göra */
        const assignTo = si.responsibleStaffId || userId || null;
        const titleStr = st === 'overdue'
          ? `⚠️ ${si.title} — ${p.name}`
          : `${si.title} — ${p.name}`;
        const noteStr  = st === 'overdue'
          ? `Förfallen med ${Math.abs(this.daysUntil(si.nextDue))} dagar. Fastighet: ${p.name}${p.address ? ', ' + p.address : ''}.`
          : `Förfaller ${typeof fmtDate === 'function' ? fmtDate(si.nextDue) : si.nextDue}. Fastighet: ${p.name}${p.address ? ', ' + p.address : ''}.`;

        /* Undvik dubbla uppgifter för samma period */
        const exists = (state.activities || []).some(a =>
          a.relatedType === 'service_interval' &&
          a.relatedId   === si.id &&
          a.note        && a.note.includes(si.nextDue) &&
          a.status      !== 'done'
        );
        if (!exists) {
          ActivitiesService.create({
            title:       titleStr,
            type:        'service',
            relatedType: 'service_interval',
            relatedId:   si.id,
            customerId:  p.customerId || null,
            assignedTo:  assignTo,
            dueDate:     si.nextDue,
            note:        noteStr,
            priority:    st === 'overdue' ? 'hög' : 'normal'
          });
        }

        /* In-app notis */
        if (typeof NotificationsService !== 'undefined' && userId) {
          const nType = st === 'overdue' ? 'service_overdue' : 'service_approaching';
          const msg   = st === 'overdue'
            ? `⚠️ ${si.title} — ${p.name} förfallet med ${Math.abs(this.daysUntil(si.nextDue))} dagar`
            : `${si.title} — ${p.name} förfaller ${typeof fmtDate === 'function' ? fmtDate(si.nextDue) : si.nextDue}`;
          NotificationsService.push(userId, nType, msg, { propId: p.id, siId: si.id });
        }

        /* Markera period som notifierad */
        si.lastNotificationSentForDueDate = periodKey;
        changed = true;
      }
    }
    if (changed) {
      persist();
      if (typeof Sidebar !== 'undefined') Sidebar.updateBadges();
    }
  },

  /* ── Hämta serviceintervall som ska ha AO skapad idag ────── */
  /*
   * Returnerar { p, si } för varje interval som uppfyller:
   *   - autoCreateAO = true
   *   - active = true
   *   - nextDue - today <= aoCreateDaysBefore
   *   - lastAOGeneratedForDueDate ≠ periodKey  (idempotent)
   * Anropas av bevakningsmotor (Leverans 2) och av openMarkDone.
   */
  getPendingAutoAO() {
    const today  = tdy();
    const result = [];
    for (const p of (state.properties || [])) {
      for (const si of (p.serviceIntervals || [])) {
        if (!si.autoCreateAO || !si.active || !si.nextDue) continue;
        const daysLeft  = this.daysUntil(si.nextDue);
        const threshold = Number(si.aoCreateDaysBefore || 0);
        if (daysLeft === null || daysLeft > threshold) continue;
        const periodKey = si.id + '::' + si.nextDue;
        if (si.lastAOGeneratedForDueDate === periodKey) continue;
        result.push({ p, si });
      }
    }
    return result;
  },

  /* ── Skapa AO för ett interval (med idempotensmarkering) ─── */
  createAOForInterval(propId, si) {
    const p = (state.properties || []).find(prop => prop.id === propId);
    if (!p || typeof WorkOrderService === 'undefined') return null;
    const cat = this.CATEGORIES.find(c => c.key === (si.aoCategory || si.category));
    const ao  = WorkOrderService.create({
      title:        si.aoTitle       || si.title,
      description:  si.aoDescription || si.description || '',
      customerId:   p.customerId     || '',
      propertyId:   p.id,
      propertyName: p.name           || '',
      address:      p.address        || '',
      category:     cat ? cat.label  : '',
      priority:     si.aoPriority    || 'normal',
      staff:        si.aoStaff       || [],
      status:       'pool',
      scheduledDate: si.nextDue      || ''
    });
    if (ao) {
      const periodKey = si.id + '::' + si.nextDue;
      si.lastAOGeneratedForDueDate = periodKey;
      si.lastGeneratedAOId         = ao.id;
      si.updatedAt                 = new Date().toISOString();
      persist();
    }
    return ao;
  }
};
