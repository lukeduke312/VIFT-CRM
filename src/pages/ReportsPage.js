/**
 * ReportsPage — Fas 4C: Analys och rapportering
 * Interaktiva grafer för AO, tid, ekonomi, avvikelser och serviceintervall.
 * Alla diagram är klickbara till underliggande poster.
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

  function _cuName(id) {
    var cu = (state.customers || []).find(function (c) { return c.id === id; });
    if (!cu) return id || '—';
    return cu.name || cu.firstName + ' ' + cu.lastName || id;
  }

  function _propName(id) {
    var p = (state.properties || []).find(function (x) { return x.id === id; });
    return p ? (p.name || p.address || id) : (id || '—');
  }

  function _staffName(id) {
    var s = (state.staff || []).find(function (x) { return x.id === id; });
    return s ? (s.firstName + ' ' + s.lastName).trim() : (id || '—');
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

  /* ── Bar chart helper ────────────────────────────────────────────── */

  function _bar(label, val, max, color, onClick) {
    var pct = max > 0 ? Math.round((val / max) * 100) : 0;
    var clickAttr = onClick ? 'onclick="' + onClick + '"' : '';
    return '<div style="margin-bottom:6px;">' +
      '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px;">' +
        '<span style="' + (onClick ? 'cursor:pointer;color:var(--blue);text-decoration:underline dotted;' : '') + '" ' + clickAttr + '>' +
          esc(String(label)) +
        '</span>' +
        '<span style="font-weight:700;font-size:11px;color:var(--mt);">' + val + '</span>' +
      '</div>' +
      '<div style="height:8px;background:var(--br);border-radius:4px;overflow:hidden;" ' + clickAttr + ' style="cursor:pointer">' +
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

    var invs    = (state.invoices || []).filter(function (i) { return (i.invoiceDate || '').slice(0, 7) === month; });
    var revMonth = invs.reduce(function (s, i) { return s + (parseFloat(i.amount) || 0); }, 0);

    var entries = state.timeEntries || [];
    var hoursThisMonth = entries
      .filter(function (e) { return (e.date || e.startDate || '').slice(0, 7) === month; })
      .reduce(function (s, e) { return s + (parseFloat(e.duration) || 0); }, 0);

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

    /* Status-fördelning */
    var statusGroups = _groupBy(active.filter(function(a){ return a.status !== 'fakturerad'; }), function (a) { return a.status; });
    var statusOrder = ['pool','planerad','pågående','klar'];
    var statusColors = { pool:'var(--sky)', planerad:'var(--blue)', pågående:'var(--or)', klar:'var(--gr)' };
    var maxStatus = Math.max.apply(null, statusOrder.map(function (s) { return (statusGroups[s]||[]).length || 0; }).concat([1]));

    var statusBars = statusOrder.map(function (s) {
      var cnt = (statusGroups[s] || []).length;
      return _bar(s, cnt, maxStatus, statusColors[s], 'WorkOrdersPage.setFilter(\'' + s + '\');Router.showPage(\'pg-ao\',{})');
    }).join('');

    return '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px;">' +
      _kpi('clipboard-list', 'Öppna AO', oppna.length, 'aktiva, ej klar', 'Router.showPage(\'pg-ao\',{filter:\'alla\'})') +
      _kpi('check-circle', 'Klara AO', klara.length, 'ej fakturerade', 'Router.showPage(\'pg-ao\',{filter:\'klar\'})') +
      _kpi('alert-circle', 'Försenade', forsen.length, 'passerat planerat datum', 'Router.showPage(\'pg-ao\',{filter:\'forsenad\'})') +
      _kpi('alert-triangle', 'Öppna avv.', avvNoAO.length, 'utan arbetsorder', 'Router.showPage(\'pg-rondering\',{})') +
      _kpi('clock', 'Tim denna mån', Math.round(hoursThisMonth) + ' h', 'registrerad tid') +
      _kpi('receipt', 'Intäkter mån', (revMonth ? revMonth.toLocaleString('sv-SE') + ' kr' : '—'), 'fakturerade') +
    '</div>' +
    '<div class="ibox" style="margin-bottom:12px;">' +
      '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">' + _ic('bar-chart-2', 14) + ' AO per status</div>' +
      statusBars +
    '</div>';
  }

  function _arbetsordrar() {
    var aos    = (state.workOrders || []).filter(function (a) { return !a.deleted; });
    var active = aos.filter(function (a) { return !a.archived && !a.deleted; });
    var today  = _today();

    /* Per kund */
    var byCu  = _groupBy(active, function (a) { return a.customerId; });
    var topCu = _topN(byCu, 10);

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
    var late = active.filter(function (a) { return a.scheduledDate && a.scheduledDate < today && a.status !== 'klar'; });
    var lateByCu = _groupBy(late, function (a) { return a.customerId; });
    var topLate = _topN(lateByCu, 8);

    var maxCu    = topCu.length    ? topCu[0].val    : 1;
    var maxStaff = topStaff.length ? topStaff[0].val : 1;
    var maxLate  = topLate.length  ? topLate[0].val  : 1;

    return '<div class="g2" style="gap:12px;">' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">' + _ic('users', 14) + ' Flest AO per kund (top 10)</div>' +
        (topCu.length ? topCu.map(function (r) {
          return _bar(_cuName(r.key), r.val, maxCu, 'var(--blue)',
            'Router.showPage(\'pg-crm-detail\',{customerId:\'' + r.key + '\'})');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga data</div>') +
      '</div>' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">' + _ic('user', 14) + ' AO per personal (top 10)</div>' +
        (topStaff.length ? topStaff.map(function (r) {
          return _bar(_staffName(r.key), r.val, maxStaff, 'var(--acc)');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga data</div>') +
      '</div>' +
    '</div>' +
    '<div class="ibox" style="margin-top:12px;">' +
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

    /* Per AO */
    var byAO = _groupBy(entries.filter(function (e) { return e.workOrderId; }), function (e) { return e.workOrderId; });
    var topAO = _topN(byAO, 8, function (items) {
      return items.reduce(function (s, e) { return s + (parseFloat(e.duration) || 0); }, 0);
    }).map(function (r) { r.val = Math.round(r.val * 10) / 10; return r; });

    var maxStaff = topStaff.length ? topStaff[0].val : 1;
    var maxAO    = topAO.length    ? topAO[0].val    : 1;

    return '<div class="g2" style="gap:12px;">' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('clock', 14) + ' Timmar per personal — ' + month + '</div>' +
        '<div style="font-size:11px;color:var(--mt);margin-bottom:10px;">Registrerade timmar denna månad</div>' +
        (topStaff.length ? topStaff.map(function (r) {
          return _bar(_staffName(r.key), r.val + ' h', maxStaff, 'var(--blue)');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga tidsregistreringar denna månad</div>') +
      '</div>' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('clipboard-list', 14) + ' Timmar per AO (totalt, top 8)</div>' +
        '<div style="font-size:11px;color:var(--mt);margin-bottom:10px;">Mest tidskrävande arbetsordrar</div>' +
        (topAO.length ? topAO.map(function (r) {
          var ao = (state.workOrders || []).find(function (a) { return a.id === r.key; });
          var label = ao ? (r.key + ' – ' + (ao.title || '').slice(0, 22)) : r.key;
          return _bar(label, r.val + ' h', maxAO, 'var(--acc)',
            'Router.showPage(\'pg-ao-detail\',{aoId:\'' + r.key + '\'})');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Ingen tiddata</div>') +
      '</div>' +
    '</div>';
  }

  function _avvikelser() {
    var avvs = state.avvikelser || [];
    var oppna = avvs.filter(function (a) { return a.status === 'öppen'; });

    /* Per fastighet */
    var byProp = _groupBy(oppna, function (a) { return a.propertyId; });
    var topProp = _topN(byProp, 10);

    /* Per feltyp */
    var byType = _groupBy(avvs, function (a) { return a.issueType || '—'; });
    var topType = _topN(byType, 8);

    /* Återkommande — groupBy recurringKey */
    var recurring = avvs.filter(function (a) { return a.recurringKey; });
    var byRecKey  = _groupBy(recurring, function (a) { return a.recurringKey; });
    var topRecur  = _topN(byRecKey, 8).filter(function (r) { return r.val > 1; });

    /* Per allvarlighetsgrad */
    var bySev = _groupBy(avvs, function (a) { return a.severity || 'ej angiven'; });
    var sevColors = { kritisk: 'var(--rd)', hög: 'var(--or)', medel: 'var(--or)', låg: 'var(--gr)', 'ej angiven': 'var(--mt)' };
    var sevOrder  = ['kritisk', 'hög', 'medel', 'låg', 'ej angiven'];
    var maxSev = Math.max.apply(null, sevOrder.map(function (s) { return (bySev[s]||[]).length; }).concat([1]));

    var maxProp  = topProp.length  ? topProp[0].val  : 1;
    var maxType  = topType.length  ? topType[0].val  : 1;
    var maxRecur = topRecur.length ? topRecur[0].val : 1;

    return '<div class="g2" style="gap:12px;">' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">' + _ic('building-2', 14) + ' Öppna avvikelser per fastighet</div>' +
        (topProp.length ? topProp.map(function (r) {
          return _bar(_propName(r.key), r.val, maxProp, 'var(--rd)');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga öppna avvikelser</div>') +
      '</div>' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">' + _ic('tag', 14) + ' Avvikelser per feltyp</div>' +
        (topType.length ? topType.map(function (r) {
          return _bar(r.key, r.val, maxType, 'var(--or)');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga feltyper registrerade</div>') +
      '</div>' +
    '</div>' +
    '<div class="g2" style="gap:12px;margin-top:12px;">' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">' + _ic('alert-triangle', 14) + ' Per allvarlighetsgrad (totalt)</div>' +
        sevOrder.map(function (s) {
          return _bar(s, (bySev[s]||[]).length, maxSev, sevColors[s]);
        }).join('') +
      '</div>' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('repeat', 14) + ' Återkommande fel (> 1 förekomst)</div>' +
        '<div style="font-size:11px;color:var(--mt);margin-bottom:10px;">Grupperade via recurringKey</div>' +
        (topRecur.length ? topRecur.map(function (r) {
          var label = r.key.split('::').pop() || r.key;
          return _bar(label, r.val, maxRecur, 'var(--rd)');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga återkommande mönster ännu</div>') +
      '</div>' +
    '</div>';
  }

  function _serviceIntervall() {
    var today   = _today();
    var props   = state.properties || [];
    var allSI   = [];
    props.forEach(function (p) {
      (p.serviceIntervals || []).forEach(function (si) {
        allSI.push(Object.assign({ _propId: p.id, _propName: p.name || p.address || p.id }, si));
      });
    });

    var overdue = allSI.filter(function (si) { return si.nextDate && si.nextDate < today && si.status !== 'done'; });
    var coming  = allSI.filter(function (si) { return si.nextDate && si.nextDate >= today; })
      .sort(function (a, b) { return a.nextDate > b.nextDate ? 1 : -1; }).slice(0, 20);

    function _siRow(si) {
      var diff = si.nextDate && today
        ? Math.round((new Date(si.nextDate) - new Date(today)) / 86400000)
        : null;
      var badge = diff == null ? '' :
        diff < 0 ? '<span class="bdg bdg-red" style="font-size:9px;">' + Math.abs(diff) + ' dagar sedan</span>'
        : diff === 0 ? '<span class="bdg bdg-orange" style="font-size:9px;">Idag</span>'
        : '<span class="bdg bdg-grey" style="font-size:9px;">Om ' + diff + ' d</span>';
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--br);gap:6px;">' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:12px;font-weight:600;">' + esc(si.name || si._propName) + '</div>' +
          '<div style="font-size:11px;color:var(--mt);">' + esc(si._propName) + (si.nextDate ? ' · ' + si.nextDate : '') + '</div>' +
        '</div>' +
        badge +
      '</div>';
    }

    return '<div class="g2" style="gap:12px;">' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:10px;color:var(--rd);">' + _ic('alert-circle', 14) + ' Förfallna serviceintervall (' + overdue.length + ')</div>' +
        (overdue.length ? overdue.slice(0, 15).map(_siRow).join('') : '<div style="font-size:12px;color:var(--mt);">Inga förfallna intervall</div>') +
      '</div>' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">' + _ic('calendar', 14) + ' Kommande serviceintervall</div>' +
        (coming.length ? coming.map(_siRow).join('') : '<div style="font-size:12px;color:var(--mt);">Inga schemalagda intervall</div>') +
      '</div>' +
    '</div>';
  }

  /* ── Render ──────────────────────────────────────────────────────── */

  function render() {
    var el = document.getElementById('pg-reports-content');
    if (!el) return;

    var tabs = [
      { key: 'oversikt',       label: _ic('layout-dashboard', 12) + ' Översikt'       },
      { key: 'arbetsordrar',   label: _ic('clipboard-list', 12)   + ' Arbetsordrar'   },
      { key: 'tid',            label: _ic('clock', 12)             + ' Tid & personal' },
      { key: 'avvikelser',     label: _ic('alert-triangle', 12)    + ' Avvikelser'     },
      { key: 'serviceintervall', label: _ic('wrench', 12)          + ' Serviceintervall' }
    ];

    var tabBar = '<div class="ftabs ao-status-tabs" style="margin-bottom:12px;">' +
      tabs.map(function (t) {
        return '<button class="ft ' + (_tab === t.key ? 'on' : '') + '" onclick="ReportsPage._setTab(\'' + t.key + '\')">' + t.label + '</button>';
      }).join('') +
    '</div>';

    var content = '';
    if (_tab === 'oversikt')         content = _oversikt();
    else if (_tab === 'arbetsordrar') content = _arbetsordrar();
    else if (_tab === 'tid')          content = _tid();
    else if (_tab === 'avvikelser')   content = _avvikelser();
    else if (_tab === 'serviceintervall') content = _serviceIntervall();

    el.innerHTML = tabBar + content;
  }

  function _setTab(key) {
    _tab = key;
    render();
  }

  return {
    render:   render,
    _setTab:  _setTab
  };

})();
