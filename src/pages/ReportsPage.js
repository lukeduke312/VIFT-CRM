/**
 * ReportsPage v3 — Fas 4C: Analys och rapportering
 * Flikar: översikt, arbetsordrar, tid, avvikelser, ekonomi, material, serviceintervall
 * Alla KPI-kort och staplar är klickbara till underliggande poster.
 */
const ReportsPage = (function () {

  var _tab = 'oversikt';

  function _ic(name, size) {
    return typeof ic !== 'undefined' ? ic(name, size || 16) : '';
  }

  /* ── Dataaggregering ─────────────────────────────────────────────── */

  function _today() {
    return new Date().toISOString().slice(0, 10);
  }

  function _thisMonth() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function _monthLabel(ym) {
    if (!ym || ym.length < 7) return ym || '—';
    var months = ['jan','feb','mar','apr','maj','jun','jul','aug','sep','okt','nov','dec'];
    var m = parseInt(ym.slice(5, 7), 10) - 1;
    return months[m] + ' ' + ym.slice(2, 4);
  }

  function _cuName(id) {
    var cu = (state.customers || []).find(function (c) { return c.id === id; });
    if (!cu) return id || '—';
    return cu.name || ((cu.firstName || '') + ' ' + (cu.lastName || '')).trim() || id;
  }

  function _propName(id) {
    var p = (state.properties || []).find(function (x) { return x.id === id; });
    return p ? (p.name || p.address || id) : (id || '—');
  }

  function _objName(id) {
    if (!id) return '—';
    for (var i = 0; i < (state.properties || []).length; i++) {
      var objs = state.properties[i].objects || [];
      var o = objs.find(function (x) { return x.id === id; });
      if (o) return (o.objectNumber ? o.objectNumber + ' ' : '') + (o.name || o.address || id);
    }
    return id;
  }

  function _staffName(id) {
    var s = (state.staff || []).find(function (x) { return x.id === id; });
    return s ? ((s.firstName || '') + ' ' + (s.lastName || '')).trim() : (id || '—');
  }

  function _groupBy(arr, keyFn) {
    var out = {};
    arr.forEach(function (item) {
      var k = keyFn(item);
      if (k == null || k === '') k = '—';
      if (!out[k]) out[k] = [];
      out[k].push(item);
    });
    return out;
  }

  function _topN(obj, n, valFn) {
    return Object.keys(obj)
      .map(function (k) { return { key: k, val: valFn ? valFn(obj[k]) : obj[k].length, items: obj[k] }; })
      .sort(function (a, b) { return b.val - a.val; })
      .slice(0, n);
  }

  /* ── KPI-kort helper ─────────────────────────────────────────────── */

  function _kpi(icon, label, val, sub, nav) {
    var clickStyle = nav ? 'cursor:pointer;' : '';
    var clickAttr  = nav ? 'onclick="' + nav + '"' : '';
    return '<div class="ibox" style="flex:1;min-width:130px;' + clickStyle + '" ' + clickAttr + '>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
        '<span style="color:var(--acc);">' + _ic(icon, 18) + '</span>' +
        '<span style="font-size:12px;color:var(--mt);">' + esc(label) + '</span>' +
      '</div>' +
      '<div style="font-size:26px;font-weight:900;color:var(--navy);">' + val + '</div>' +
      (sub ? '<div style="font-size:11px;color:var(--mt);margin-top:2px;">' + esc(sub) + '</div>' : '') +
    '</div>';
  }

  /* ── Bar chart helper ────────────────────────────────────────────── */

  function _bar(label, val, max, color, onClick) {
    var pct = max > 0 ? Math.round((val / max) * 100) : 0;
    var clickAttr = onClick ? 'onclick="' + onClick + '"' : '';
    var labelStyle = 'font-size:12px;' + (onClick ? 'cursor:pointer;color:var(--blue);text-decoration:underline dotted;' : '');
    var barStyle = 'height:8px;background:var(--br);border-radius:4px;overflow:hidden;' + (onClick ? 'cursor:pointer;' : '');
    return '<div style="margin-bottom:6px;">' +
      '<div style="display:flex;justify-content:space-between;margin-bottom:2px;">' +
        '<span style="' + labelStyle + '" ' + clickAttr + '>' + esc(String(label)) + '</span>' +
        '<span style="font-weight:700;font-size:11px;color:var(--mt);">' + val + '</span>' +
      '</div>' +
      '<div style="' + barStyle + '" ' + clickAttr + '>' +
        '<div style="height:100%;width:' + pct + '%;background:' + (color || 'var(--acc)') + ';border-radius:4px;transition:width .3s;"></div>' +
      '</div>' +
    '</div>';
  }

  /* ── Sektioner ───────────────────────────────────────────────────── */

  function _oversikt() {
    var today   = _today();
    var month   = _thisMonth();
    var aos     = state.workOrders || [];
    var active  = aos.filter(function (a) { return !a.archived && !a.deleted && a.status !== 'fakturerad'; });
    var oppna   = active.filter(function (a) { return a.status !== 'klar'; });
    var klara   = active.filter(function (a) { return a.status === 'klar'; });
    var forsen  = active.filter(function (a) { return a.scheduledDate && a.scheduledDate < today; });
    var avvs    = (state.avvikelser || []).filter(function (a) { return a.status === 'öppen'; });
    var avvNoAO = avvs.filter(function (a) { return !a.workOrderId; });

    var invs     = (state.invoices || []).filter(function (i) { return (i.invoiceDate || '').slice(0, 7) === month; });
    var revMonth = invs.reduce(function (s, i) { return s + (parseFloat(i.amount) || 0); }, 0);

    var entries = state.timeEntries || [];
    var hoursThisMonth = entries
      .filter(function (e) { return (e.date || e.startDate || '').slice(0, 7) === month; })
      .reduce(function (s, e) { return s + (parseFloat(e.duration) || 0); }, 0);

    /* Status-fördelning */
    var statusGroups = _groupBy(active, function (a) { return a.status; });
    var statusOrder  = ['pool', 'planerad', 'pågående', 'klar'];
    var statusColors = { pool: 'var(--sky)', planerad: 'var(--blue)', pågående: 'var(--or)', klar: 'var(--gr)' };
    var maxStatus = Math.max.apply(null, statusOrder.map(function (s) { return (statusGroups[s] || []).length; }).concat([1]));

    var statusBars = statusOrder.map(function (s) {
      var cnt = (statusGroups[s] || []).length;
      return _bar(s, cnt, maxStatus, statusColors[s],
        'WorkOrdersPage.setFilter(\'' + s + '\');Router.showPage(\'pg-ao\',{})');
    }).join('');

    /* Faktureringsgrad */
    var allKlaraTotal  = (state.workOrders || []).filter(function (a) { return !a.deleted && (a.status === 'klar' || a.status === 'fakturerad'); });
    var faktureradeCnt = (state.workOrders || []).filter(function (a) { return !a.deleted && a.status === 'fakturerad'; }).length;
    var fakGrad = allKlaraTotal.length > 0 ? Math.round((faktureradeCnt / allKlaraTotal.length) * 100) : 0;

    return '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px;">' +
      _kpi('clipboard-list', 'Öppna AO',       oppna.length,                          'aktiva, ej klara',              'Router.showPage(\'pg-ao\',{filter:\'alla\'})') +
      _kpi('check-circle',  'Klara AO',        klara.length,                          'ej fakturerade',                'Router.showPage(\'pg-ao\',{filter:\'klar\'})') +
      _kpi('alert-circle',  'Försenade',        forsen.length,                         'passerat planerat datum',       'Router.showPage(\'pg-ao\',{filter:\'forsenad\'})') +
      _kpi('alert-triangle','Öppna avv.',       avvNoAO.length,                        'utan arbetsorder',              'Router.showPage(\'pg-rondering\',{})') +
      _kpi('clock',         'Tim denna mån',    Math.round(hoursThisMonth) + ' h',     'registrerad tid') +
      _kpi('receipt',       'Intäkter mån',     revMonth ? Math.round(revMonth).toLocaleString('sv-SE') + ' kr' : '—', 'fakturerade',                   'ReportsPage._setTab(\'ekonomi\')') +
      _kpi('percent',       'Faktureringsgr.',  fakGrad + ' %',                        faktureradeCnt + ' av ' + allKlaraTotal.length + ' klara',         'ReportsPage._setTab(\'ekonomi\')') +
    '</div>' +
    '<div class="ibox" style="margin-bottom:12px;">' +
      '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">' + _ic('bar-chart-2', 14) + ' AO per status</div>' +
      statusBars +
    '</div>';
  }

  function _arbetsordrar() {
    var aos    = (state.workOrders || []).filter(function (a) { return !a.deleted; });
    var active = aos.filter(function (a) { return !a.archived; });
    var today  = _today();

    /* Per kund */
    var byCu   = _groupBy(active, function (a) { return a.customerId; });
    var topCu  = _topN(byCu, 10);

    /* Per fastighet */
    var byProp  = _groupBy(active, function (a) { return a.propertyId; });
    var topProp = _topN(byProp, 10);

    /* Per objekt */
    var byObj  = _groupBy(active.filter(function (a) { return a.objectId; }), function (a) { return a.objectId; });
    var topObj = _topN(byObj, 8);

    /* Per personal */
    var byStaff = {};
    active.forEach(function (a) {
      (a.staff || []).forEach(function (sid) {
        if (!byStaff[sid]) byStaff[sid] = [];
        byStaff[sid].push(a);
      });
    });
    var topStaff = _topN(byStaff, 10);

    /* Försenade per kund */
    var late     = active.filter(function (a) { return a.scheduledDate && a.scheduledDate < today && a.status !== 'klar'; });
    var lateByCu = _groupBy(late, function (a) { return a.customerId; });
    var topLate  = _topN(lateByCu, 8);

    var maxCu    = topCu.length    ? topCu[0].val    : 1;
    var maxProp  = topProp.length  ? topProp[0].val  : 1;
    var maxObj   = topObj.length   ? topObj[0].val   : 1;
    var maxStaff = topStaff.length ? topStaff[0].val : 1;
    var maxLate  = topLate.length  ? topLate[0].val  : 1;

    return '<div class="g2" style="gap:12px;margin-bottom:12px;">' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">' + _ic('users', 14) + ' Flest AO per kund (top 10)</div>' +
        (topCu.length ? topCu.map(function (r) {
          return _bar(_cuName(r.key), r.val, maxCu, 'var(--blue)',
            'Router.showPage(\'pg-crm-detail\',{customerId:\'' + r.key + '\'})');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga data</div>') +
      '</div>' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">' + _ic('building-2', 14) + ' Flest AO per fastighet (top 10)</div>' +
        (topProp.length ? topProp.map(function (r) {
          return _bar(_propName(r.key), r.val, maxProp, 'var(--sky)',
            'Router.showPage(\'pg-property-detail\',{propertyId:\'' + r.key + '\'})');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga data</div>') +
      '</div>' +
    '</div>' +
    '<div class="g2" style="gap:12px;margin-bottom:12px;">' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">' + _ic('home', 14) + ' AO per objekt (top 8)</div>' +
        (topObj.length ? topObj.map(function (r) {
          return _bar(_objName(r.key), r.val, maxObj, 'var(--acc)');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga objekt-kopplade AO</div>') +
      '</div>' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">' + _ic('user', 14) + ' AO per personal (top 10)</div>' +
        (topStaff.length ? topStaff.map(function (r) {
          return _bar(_staffName(r.key), r.val, maxStaff, 'var(--or)');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga data</div>') +
      '</div>' +
    '</div>' +
    '<div class="ibox">' +
      '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">' + _ic('clock', 14) + ' Försenade AO per kund</div>' +
      (topLate.length ? topLate.map(function (r) {
        return _bar(_cuName(r.key), r.val, maxLate, 'var(--rd)',
          'Router.showPage(\'pg-crm-detail\',{customerId:\'' + r.key + '\'})');
      }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga försenade AO</div>') +
    '</div>';
  }

  function _tid() {
    var entries = state.timeEntries || [];
    var month   = _thisMonth();

    /* Per personal — denna månad */
    var thisMonthEntries = entries.filter(function (e) {
      return (e.date || e.startDate || '').slice(0, 7) === month;
    });
    var byStaff = _groupBy(thisMonthEntries, function (e) { return e.staffId; });
    var topStaff = _topN(byStaff, 15, function (items) {
      return items.reduce(function (s, e) { return s + (parseFloat(e.duration) || 0); }, 0);
    }).map(function (r) { r.val = Math.round(r.val * 10) / 10; return r; });

    /* Personalbeläggning — timmar som % av 160h/månad */
    var totalHoursMonth = thisMonthEntries.reduce(function (s, e) { return s + (parseFloat(e.duration) || 0); }, 0);
    var belaggning = Object.keys(byStaff).map(function (sid) {
      var h = byStaff[sid].reduce(function (s, e) { return s + (parseFloat(e.duration) || 0); }, 0);
      return { staffId: sid, hours: Math.round(h * 10) / 10 };
    }).sort(function (a, b) { return b.hours - a.hours; });
    var maxBel = belaggning.length ? belaggning[0].hours : 1;

    /* Per AO */
    var byAO = _groupBy(entries.filter(function (e) { return e.workOrderId; }), function (e) { return e.workOrderId; });
    var topAO = _topN(byAO, 8, function (items) {
      return items.reduce(function (s, e) { return s + (parseFloat(e.duration) || 0); }, 0);
    }).map(function (r) { r.val = Math.round(r.val * 10) / 10; return r; });

    /* Per fastighet */
    var byPropH = {};
    entries.forEach(function (e) {
      var ao = e.workOrderId ? (state.workOrders || []).find(function (a) { return a.id === e.workOrderId; }) : null;
      if (!ao) return;
      var pid = ao.propertyId || '—';
      byPropH[pid] = (byPropH[pid] || 0) + (parseFloat(e.duration) || 0);
    });
    var topPropH = Object.keys(byPropH).map(function (k) { return { key: k, val: Math.round(byPropH[k] * 10) / 10 }; })
      .sort(function (a, b) { return b.val - a.val; }).slice(0, 8);
    var maxPropH = topPropH.length ? topPropH[0].val : 1;

    var maxStaff = topStaff.length ? topStaff[0].val : 1;
    var maxAO    = topAO.length    ? topAO[0].val    : 1;

    return '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px;">' +
      _kpi('clock', 'Tim denna mån', Math.round(totalHoursMonth) + ' h', 'registrerad tid ' + month) +
      _kpi('users', 'Personal aktiv', belaggning.length + ' st', 'med registrerad tid') +
      _kpi('clipboard-list', 'AO med tid', Object.keys(byAO).length + ' st', 'arbetsordrar med tidspost') +
    '</div>' +
    '<div class="g2" style="gap:12px;margin-bottom:12px;">' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('clock', 14) + ' Timmar per personal — ' + month + '</div>' +
        '<div style="font-size:11px;color:var(--mt);margin-bottom:10px;">Registrerade timmar denna månad</div>' +
        (topStaff.length ? topStaff.map(function (r) {
          return _bar(_staffName(r.key), r.val + ' h', maxStaff, 'var(--blue)');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga tidsregistreringar denna månad</div>') +
      '</div>' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('activity', 14) + ' Personalbeläggning — ' + month + '</div>' +
        '<div style="font-size:11px;color:var(--mt);margin-bottom:10px;">Timmar loggade (referens: 160 h/mån)</div>' +
        (belaggning.length ? belaggning.map(function (r) {
          var pct160 = Math.round((r.hours / 160) * 100);
          var col = pct160 >= 90 ? 'var(--rd)' : pct160 >= 60 ? 'var(--or)' : 'var(--gr)';
          return _bar(_staffName(r.staffId), r.hours + ' h (' + pct160 + '%)', maxBel, col);
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga tidsregistreringar denna månad</div>') +
      '</div>' +
    '</div>' +
    '<div class="g2" style="gap:12px;">' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('clipboard-list', 14) + ' Tim per AO (top 8, totalt)</div>' +
        '<div style="font-size:11px;color:var(--mt);margin-bottom:10px;">Mest tidskrävande arbetsordrar</div>' +
        (topAO.length ? topAO.map(function (r) {
          var ao = (state.workOrders || []).find(function (a) { return a.id === r.key; });
          var label = ao ? (r.key + ' – ' + (ao.title || '').slice(0, 22)) : r.key;
          return _bar(label, r.val + ' h', maxAO, 'var(--acc)',
            'Router.showPage(\'pg-ao-detail\',{aoId:\'' + r.key + '\'})');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Ingen tiddata</div>') +
      '</div>' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('building-2', 14) + ' Tim per fastighet (top 8)</div>' +
        '<div style="font-size:11px;color:var(--mt);margin-bottom:10px;">Summerad tid via AO-koppling</div>' +
        (topPropH.length ? topPropH.map(function (r) {
          return _bar(_propName(r.key), r.val + ' h', maxPropH, 'var(--sky)',
            'Router.showPage(\'pg-property-detail\',{propertyId:\'' + r.key + '\'})');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Ingen fastighetsdata</div>') +
      '</div>' +
    '</div>';
  }

  function _avvikelser() {
    var avvs  = state.avvikelser || [];
    var oppna = avvs.filter(function (a) { return a.status === 'öppen'; });

    /* Per fastighet */
    var byProp  = _groupBy(oppna, function (a) { return a.propertyId; });
    var topProp = _topN(byProp, 10);

    /* Per objekt */
    var byObj  = _groupBy(oppna.filter(function (a) { return a.objectId; }), function (a) { return a.objectId; });
    var topObj = _topN(byObj, 8);

    /* Per feltyp (alla, ej bara öppna) */
    var byType  = _groupBy(avvs, function (a) { return a.issueType || '—'; });
    var topType = _topN(byType, 8);

    /* Återkommande via recurringKey — per fastighet + per objekt */
    var recurring  = avvs.filter(function (a) { return a.recurringKey; });
    var byRecKey   = _groupBy(recurring, function (a) { return a.recurringKey; });
    var topRecur   = _topN(byRecKey, 8).filter(function (r) { return r.val > 1; });

    /* Återkommande per fastighet: räkna unika recurringKeys per property */
    var recurByProp = {};
    recurring.forEach(function (a) {
      if (!a.propertyId) return;
      if (!recurByProp[a.propertyId]) recurByProp[a.propertyId] = new Set();
      recurByProp[a.propertyId].add(a.recurringKey);
    });
    var topRecurProp = Object.keys(recurByProp)
      .map(function (k) { return { key: k, val: recurByProp[k].size }; })
      .sort(function (a, b) { return b.val - a.val; }).slice(0, 8);

    /* Per allvarlighetsgrad */
    var bySev      = _groupBy(avvs, function (a) { return a.severity || 'ej angiven'; });
    var sevColors  = { kritisk: 'var(--rd)', hög: 'var(--or)', medel: 'var(--or)', låg: 'var(--gr)', 'ej angiven': 'var(--mt)' };
    var sevOrder   = ['kritisk', 'hög', 'medel', 'låg', 'ej angiven'];
    var maxSev     = Math.max.apply(null, sevOrder.map(function (s) { return (bySev[s] || []).length; }).concat([1]));
    var maxProp    = topProp.length    ? topProp[0].val    : 1;
    var maxObj     = topObj.length     ? topObj[0].val     : 1;
    var maxType    = topType.length    ? topType[0].val    : 1;
    var maxRecur   = topRecur.length   ? topRecur[0].val   : 1;
    var maxRProp   = topRecurProp.length ? topRecurProp[0].val : 1;

    return '<div class="g2" style="gap:12px;margin-bottom:12px;">' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">' + _ic('building-2', 14) + ' Öppna avvikelser per fastighet</div>' +
        (topProp.length ? topProp.map(function (r) {
          return _bar(_propName(r.key), r.val, maxProp, 'var(--rd)',
            'Router.showPage(\'pg-property-detail\',{propertyId:\'' + r.key + '\'})');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga öppna avvikelser</div>') +
      '</div>' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">' + _ic('home', 14) + ' Öppna avvikelser per objekt (top 8)</div>' +
        (topObj.length ? topObj.map(function (r) {
          return _bar(_objName(r.key), r.val, maxObj, 'var(--or)');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga objekt-kopplade avvikelser</div>') +
      '</div>' +
    '</div>' +
    '<div class="g2" style="gap:12px;margin-bottom:12px;">' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">' + _ic('alert-triangle', 14) + ' Per allvarlighetsgrad (totalt)</div>' +
        sevOrder.map(function (s) {
          return _bar(s, (bySev[s] || []).length, maxSev, sevColors[s]);
        }).join('') +
      '</div>' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">' + _ic('tag', 14) + ' Avvikelser per feltyp (top 8)</div>' +
        (topType.length ? topType.map(function (r) {
          return _bar(r.key, r.val, maxType, 'var(--or)');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga feltyper registrerade</div>') +
      '</div>' +
    '</div>' +
    '<div class="g2" style="gap:12px;">' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('repeat', 14) + ' Återkommande mönster (> 1 förekomst)</div>' +
        '<div style="font-size:11px;color:var(--mt);margin-bottom:10px;">Grupperade via recurringKey</div>' +
        (topRecur.length ? topRecur.map(function (r) {
          var label = r.key.split('::').pop() || r.key;
          return _bar(label, r.val, maxRecur, 'var(--rd)');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga återkommande mönster ännu</div>') +
      '</div>' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('building-2', 14) + ' Fastigheter med flest återkommande</div>' +
        '<div style="font-size:11px;color:var(--mt);margin-bottom:10px;">Antal unika återkommande mönster per fastighet</div>' +
        (topRecurProp.length ? topRecurProp.map(function (r) {
          return _bar(_propName(r.key), r.val + ' mönster', maxRProp, 'var(--rd)',
            'Router.showPage(\'pg-property-detail\',{propertyId:\'' + r.key + '\'})');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga data</div>') +
      '</div>' +
    '</div>';
  }

  function _ekonomi() {
    var today  = _today();
    var month  = _thisMonth();
    var invs   = state.invoices || [];
    var aos    = (state.workOrders || []).filter(function (a) { return !a.deleted; });

    /* Faktureringsgrad */
    var allKlara     = aos.filter(function (a) { return a.status === 'klar' || a.status === 'fakturerad'; });
    var faktureradeCnt = aos.filter(function (a) { return a.status === 'fakturerad'; }).length;
    var fakGrad = allKlara.length > 0 ? Math.round((faktureradeCnt / allKlara.length) * 100) : 0;

    /* Totala intäkter */
    var totalRev = invs.reduce(function (s, i) { return s + (parseFloat(i.amount) || 0); }, 0);
    var monthRev = invs.filter(function (i) { return (i.invoiceDate || '').slice(0, 7) === month; })
      .reduce(function (s, i) { return s + (parseFloat(i.amount) || 0); }, 0);

    /* Materialkostnad */
    var matCost = 0;
    aos.forEach(function (ao) {
      (ao.materials || []).forEach(function (m) {
        matCost += (parseFloat(m.totalPrice || m.price) || 0) * (parseFloat(m.quantity) || 1);
      });
    });

    /* Intäkter per kund */
    var byCuRev = {};
    invs.forEach(function (inv) {
      var cid = inv.customerId || '—';
      byCuRev[cid] = (byCuRev[cid] || 0) + (parseFloat(inv.amount) || 0);
    });
    var topCuRev = Object.keys(byCuRev).map(function (k) { return { key: k, val: byCuRev[k] }; })
      .sort(function (a, b) { return b.val - a.val; }).slice(0, 10);
    var maxCuRev = topCuRev.length ? topCuRev[0].val : 1;

    /* Intäkter per fastighet (via AO-koppling på faktura) */
    var byPropRev = {};
    invs.forEach(function (inv) {
      var ao = inv.workOrderId ? aos.find(function (a) { return a.id === inv.workOrderId; }) : null;
      var pid = (ao && ao.propertyId) ? ao.propertyId : null;
      if (!pid) return;
      byPropRev[pid] = (byPropRev[pid] || 0) + (parseFloat(inv.amount) || 0);
    });
    var topPropRev = Object.keys(byPropRev).map(function (k) { return { key: k, val: byPropRev[k] }; })
      .sort(function (a, b) { return b.val - a.val; }).slice(0, 8);
    var maxPropRev = topPropRev.length ? topPropRev[0].val : 1;

    /* Intäkter per månad (senaste 12) */
    var monthMap = {};
    invs.forEach(function (inv) {
      var m = (inv.invoiceDate || '').slice(0, 7);
      if (m) monthMap[m] = (monthMap[m] || 0) + (parseFloat(inv.amount) || 0);
    });
    var months12 = [];
    for (var i = 11; i >= 0; i--) {
      var d = new Date();
      d.setMonth(d.getMonth() - i);
      var mk = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      months12.push({ key: mk, label: _monthLabel(mk), val: monthMap[mk] || 0 });
    }
    var maxMonthRev = Math.max.apply(null, months12.map(function (m) { return m.val; }).concat([1]));

    /* Klara AO ej fakturerade per kund */
    var ejFak    = aos.filter(function (a) { return a.status === 'klar' && !a.invoiceId; });
    var ejFakByCu = _groupBy(ejFak, function (a) { return a.customerId; });
    var topEjFak  = _topN(ejFakByCu, 8);
    var maxEjFak  = topEjFak.length ? topEjFak[0].val : 1;

    /* Täckningsbidrag-estimat (intäkter - materialkostnad; ingen lönekostnad i systemet) */
    var tb = totalRev - matCost;

    return '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px;">' +
      _kpi('trending-up',   'Totala intäkter',     totalRev ? Math.round(totalRev).toLocaleString('sv-SE') + ' kr' : '—', 'alla fakturerade') +
      _kpi('receipt',       'Intäkter ' + _monthLabel(month), monthRev ? Math.round(monthRev).toLocaleString('sv-SE') + ' kr' : '—', 'fakturerade denna månad') +
      _kpi('percent',       'Faktureringsgrad',     fakGrad + ' %', faktureradeCnt + ' av ' + allKlara.length + ' klara AO') +
      _kpi('shopping-cart', 'Materialkostnad',      matCost ? Math.round(matCost).toLocaleString('sv-SE') + ' kr' : '—', 'summa material på AO') +
      _kpi('trending-up',   'TB (intäkt–mat)',      tb ? Math.round(tb).toLocaleString('sv-SE') + ' kr' : '—', 'estimat utan lönekostnad') +
    '</div>' +
    '<div class="ibox" style="margin-bottom:12px;">' +
      '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('calendar', 14) + ' Intäkter per månad — senaste 12</div>' +
      '<div style="font-size:11px;color:var(--mt);margin-bottom:10px;">Fakturerade belopp per månad</div>' +
      months12.map(function (m) {
        return _bar(m.label, m.val ? Math.round(m.val).toLocaleString('sv-SE') + ' kr' : '0 kr', maxMonthRev, 'var(--blue)');
      }).join('') +
    '</div>' +
    '<div class="g2" style="gap:12px;margin-bottom:12px;">' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('users', 14) + ' Intäkter per kund (top 10)</div>' +
        '<div style="font-size:11px;color:var(--mt);margin-bottom:10px;">Summerade fakturerade belopp</div>' +
        (topCuRev.length ? topCuRev.map(function (r) {
          return _bar(_cuName(r.key), Math.round(r.val).toLocaleString('sv-SE') + ' kr', maxCuRev, 'var(--gr)',
            'Router.showPage(\'pg-crm-detail\',{customerId:\'' + r.key + '\'})');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga fakturor registrerade</div>') +
      '</div>' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('building-2', 14) + ' Intäkter per fastighet (top 8)</div>' +
        '<div style="font-size:11px;color:var(--mt);margin-bottom:10px;">Via AO-koppling på faktura</div>' +
        (topPropRev.length ? topPropRev.map(function (r) {
          return _bar(_propName(r.key), Math.round(r.val).toLocaleString('sv-SE') + ' kr', maxPropRev, 'var(--sky)',
            'Router.showPage(\'pg-property-detail\',{propertyId:\'' + r.key + '\'})');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Ingen fastighetsdata via fakturor</div>') +
      '</div>' +
    '</div>' +
    '<div class="ibox">' +
      '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('alert-circle', 14) + ' Klara AO ej fakturerade — per kund</div>' +
      '<div style="font-size:11px;color:var(--mt);margin-bottom:10px;">Potentiellt ej fakturerade AO per kund</div>' +
      (topEjFak.length ? topEjFak.map(function (r) {
        return _bar(_cuName(r.key), r.val + ' st', maxEjFak, 'var(--or)',
          'Router.showPage(\'pg-crm-detail\',{customerId:\'' + r.key + '\'})');
      }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga klara ofakturerade AO</div>') +
    '</div>';
  }

  function _material() {
    var aos = (state.workOrders || []).filter(function (a) { return !a.deleted; });

    /* Samla allt material */
    var allMats = [];
    var aoCosts = [];
    aos.forEach(function (ao) {
      var mats = ao.materials || [];
      var cost = 0;
      mats.forEach(function (m) {
        var qty       = parseFloat(m.quantity) || 1;
        var unitPrice = parseFloat(m.totalPrice || m.unitPrice || m.price) || 0;
        var lineTotal = unitPrice * qty;
        cost += lineTotal;
        allMats.push({ aoId: ao.id, name: m.name || m.article || m.description || '—', qty: qty, price: lineTotal });
      });
      if (mats.length > 0) aoCosts.push({ aoId: ao.id, cost: cost, ao: ao });
    });

    if (allMats.length === 0) {
      return '<div class="ibox"><p style="font-size:13px;color:var(--mt);">Inga material har registrerats på arbetsordrar ännu.</p>' +
        '<p style="font-size:12px;color:var(--mt);">Material registreras under varje AO i fliken Material/resurser.</p></div>';
    }

    var totalMatCost = allMats.reduce(function (s, m) { return s + m.price; }, 0);

    /* Per AO (top 10 kostnad) */
    aoCosts.sort(function (a, b) { return b.cost - a.cost; });
    var topAO    = aoCosts.slice(0, 10);
    var maxAOCost = topAO.length ? topAO[0].cost : 1;

    /* Per artikel */
    var byArt = {};
    allMats.forEach(function (m) {
      if (!byArt[m.name]) byArt[m.name] = { qty: 0, total: 0 };
      byArt[m.name].qty   += m.qty;
      byArt[m.name].total += m.price;
    });
    var topArt    = Object.keys(byArt).map(function (k) { return { key: k, val: byArt[k].total, qty: byArt[k].qty }; })
      .sort(function (a, b) { return b.val - a.val; }).slice(0, 10);
    var maxArtCost = topArt.length ? topArt[0].val : 1;

    /* Per kund */
    var byCuMat = {};
    aos.forEach(function (ao) {
      var cost = (ao.materials || []).reduce(function (s, m) {
        return s + (parseFloat(m.totalPrice || m.unitPrice || m.price) || 0) * (parseFloat(m.quantity) || 1);
      }, 0);
      if (cost > 0) {
        var cid = ao.customerId || '—';
        byCuMat[cid] = (byCuMat[cid] || 0) + cost;
      }
    });
    var topCuMat  = Object.keys(byCuMat).map(function (k) { return { key: k, val: byCuMat[k] }; })
      .sort(function (a, b) { return b.val - a.val; }).slice(0, 8);
    var maxCuMat  = topCuMat.length ? topCuMat[0].val : 1;

    return '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px;">' +
      _kpi('shopping-cart', 'Totalt material',    Math.round(totalMatCost).toLocaleString('sv-SE') + ' kr', 'alla AO') +
      _kpi('layers',        'Unika artiklar',     Object.keys(byArt).length + ' st', 'distinkta artikelnamn') +
      _kpi('clipboard-list','AO med material',    aoCosts.length + ' st', 'arbetsordrar med minst en artikel') +
    '</div>' +
    '<div class="g2" style="gap:12px;margin-bottom:12px;">' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('clipboard-list', 14) + ' Materialkostnad per AO (top 10)</div>' +
        '<div style="font-size:11px;color:var(--mt);margin-bottom:10px;">Arbetsordrar med störst materialkostnad</div>' +
        topAO.map(function (r) {
          var label = r.aoId + (r.ao && r.ao.title ? ' – ' + r.ao.title.slice(0, 20) : '');
          return _bar(label, Math.round(r.cost).toLocaleString('sv-SE') + ' kr', maxAOCost, 'var(--blue)',
            'Router.showPage(\'pg-ao-detail\',{aoId:\'' + r.aoId + '\'})');
        }).join('') +
      '</div>' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('tag', 14) + ' Vanligaste artiklar (top 10, kostnad)</div>' +
        '<div style="font-size:11px;color:var(--mt);margin-bottom:10px;">Per summerad totalkostnad</div>' +
        topArt.map(function (r) {
          return _bar(r.key, Math.round(r.val).toLocaleString('sv-SE') + ' kr (' + Math.round(r.qty * 10) / 10 + ' st)', maxArtCost, 'var(--acc)');
        }).join('') +
      '</div>' +
    '</div>' +
    '<div class="ibox">' +
      '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('users', 14) + ' Materialkostnad per kund (top 8)</div>' +
      '<div style="font-size:11px;color:var(--mt);margin-bottom:10px;">Summerad materialkostnad via AO</div>' +
      (topCuMat.length ? topCuMat.map(function (r) {
        return _bar(_cuName(r.key), Math.round(r.val).toLocaleString('sv-SE') + ' kr', maxCuMat, 'var(--sky)',
          'Router.showPage(\'pg-crm-detail\',{customerId:\'' + r.key + '\'})');
      }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga data</div>') +
    '</div>';
  }

  function _serviceIntervall() {
    var today = _today();
    var props = state.properties || [];
    var allSI = [];
    props.forEach(function (p) {
      (p.serviceIntervals || []).forEach(function (si) {
        allSI.push(Object.assign({ _propId: p.id, _propName: p.name || p.address || p.id }, si));
      });
    });

    var overdue = allSI.filter(function (si) { return si.nextDate && si.nextDate < today && si.status !== 'done'; });
    var coming  = allSI.filter(function (si) { return si.nextDate && si.nextDate >= today; })
      .sort(function (a, b) { return a.nextDate > b.nextDate ? 1 : -1; }).slice(0, 20);

    /* Per fastighet — antal förfallna */
    var overdueByProp = _groupBy(overdue, function (si) { return si._propId; });
    var topOverProp   = _topN(overdueByProp, 8);
    var maxOverProp   = topOverProp.length ? topOverProp[0].val : 1;

    function _siRow(si) {
      var diff = si.nextDate && today
        ? Math.round((new Date(si.nextDate) - new Date(today)) / 86400000)
        : null;
      var badge = diff == null ? '' :
        diff < 0  ? '<span class="bdg bdg-red" style="font-size:9px;">'    + Math.abs(diff) + ' dagar sedan</span>'
        : diff === 0 ? '<span class="bdg bdg-orange" style="font-size:9px;">Idag</span>'
        :              '<span class="bdg bdg-grey" style="font-size:9px;">Om ' + diff + ' d</span>';
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--br);gap:6px;">' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:12px;font-weight:600;">' + esc(si.name || si._propName) + '</div>' +
          '<div style="font-size:11px;color:var(--mt);">' + esc(si._propName) + (si.nextDate ? ' · ' + si.nextDate : '') + '</div>' +
        '</div>' +
        badge +
      '</div>';
    }

    return '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px;">' +
      _kpi('alert-circle', 'Förfallna',  overdue.length + ' st', 'serviceintervall passerat datum') +
      _kpi('calendar',     'Kommande',   coming.length  + ' st', 'schemalagda framöver') +
      _kpi('wrench',       'Totalt',     allSI.length   + ' st', 'aktiva serviceintervall') +
    '</div>' +
    '<div class="g2" style="gap:12px;margin-bottom:12px;">' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:10px;color:var(--rd);">' + _ic('alert-circle', 14) + ' Förfallna serviceintervall (' + overdue.length + ')</div>' +
        (overdue.length ? overdue.slice(0, 15).map(_siRow).join('') : '<div style="font-size:12px;color:var(--mt);">Inga förfallna intervall</div>') +
      '</div>' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">' + _ic('calendar', 14) + ' Kommande serviceintervall</div>' +
        (coming.length ? coming.map(_siRow).join('') : '<div style="font-size:12px;color:var(--mt);">Inga schemalagda intervall</div>') +
      '</div>' +
    '</div>' +
    '<div class="ibox">' +
      '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('building-2', 14) + ' Förfallna per fastighet (top 8)</div>' +
      '<div style="font-size:11px;color:var(--mt);margin-bottom:10px;">Antal förfallna serviceintervall per fastighet</div>' +
      (topOverProp.length ? topOverProp.map(function (r) {
        return _bar(_propName(r.key), r.val + ' st', maxOverProp, 'var(--rd)',
          'Router.showPage(\'pg-property-detail\',{propertyId:\'' + r.key + '\'})');
      }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga förfallna</div>') +
    '</div>';
  }

  /* ── Render ──────────────────────────────────────────────────────── */

  function render() {
    var el = document.getElementById('pg-reports-content');
    if (!el) return;

    var tabs = [
      { key: 'oversikt',        label: _ic('layout-dashboard', 12) + ' Översikt'         },
      { key: 'arbetsordrar',    label: _ic('clipboard-list', 12)   + ' Arbetsordrar'     },
      { key: 'tid',             label: _ic('clock', 12)             + ' Tid & personal'  },
      { key: 'avvikelser',      label: _ic('alert-triangle', 12)    + ' Avvikelser'       },
      { key: 'ekonomi',         label: _ic('trending-up', 12)       + ' Ekonomi'          },
      { key: 'material',        label: _ic('package', 12)           + ' Material'         },
      { key: 'serviceintervall',label: _ic('wrench', 12)            + ' Serviceintervall' }
    ];

    var tabBar = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;">' +
      '<div class="ftabs ao-status-tabs" style="flex:1;margin-bottom:0;">' +
      tabs.map(function (t) {
        return '<button class="ft ' + (_tab === t.key ? 'on' : '') + '" onclick="ReportsPage._setTab(\'' + t.key + '\')">' + t.label + '</button>';
      }).join('') +
      '</div>' +
      '<button class="btn bs bsm" id="rep-export-btn" onclick="ReportsPage._exportAll(this)" title="Exportera alla rapporter som XLSX">' +
        _ic('download', 13) + ' Exportera' +
      '</button>' +
    '</div>';

    var content = '';
    if      (_tab === 'oversikt')         content = _oversikt();
    else if (_tab === 'arbetsordrar')     content = _arbetsordrar();
    else if (_tab === 'tid')              content = _tid();
    else if (_tab === 'avvikelser')       content = _avvikelser();
    else if (_tab === 'ekonomi')          content = _ekonomi();
    else if (_tab === 'material')         content = _material();
    else if (_tab === 'serviceintervall') content = _serviceIntervall();

    el.innerHTML = tabBar + content;
  }

  function _setTab(key) {
    _tab = key;
    render();
  }

  function _exportAll(btn) {
    if (typeof ImportExportService !== 'undefined') {
      ImportExportService.showExportMenu('report', btn);
    }
  }

  return {
    render:     render,
    _setTab:    _setTab,
    _exportAll: _exportAll
  };

})();
