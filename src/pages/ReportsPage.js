/**
 * ReportsPage v5 — Fas 4C: Analys och rapportering
 * Flikar: översikt, arbetsordrar, tid, avvikelser, ekonomi, material, serviceintervall
 * Gemensamt periodfilter, datakvalitetsvarningar, klickbara KPI:er.
 *
 * OBS – estimat och kända begränsningar (visas inline i rapporten):
 *  · Beläggning baseras på 160 h/mån som standard (individuell kapacitet saknas)
 *  · "Bidrag före lönekostnad" = fakturerat − materialkostnad (lönekostnad ej med)
 *  · Faktureringsgrad mäts som antal AO, inte som andel av fakturerbart värde
 *  · Intäkt = summa fakturerade fakturabelopp (state.invoices). Ej fakturerade AO
 *    räknas separat som "Klart att fakturera" men saknar beloppsdata utan prissättning.
 *
 * Status: Byggd – behöver dataverifiering och webbläsartest
 */
const ReportsPage = (function () {

  var _tab    = 'oversikt';

  /* ── Periodfilter ───────────────────────────────────────────────────
     preset: 'month' | 'prev-month' | 'quarter' | 'year' | '12months' | 'custom'
     För 'custom': _periodCustomFrom och _periodCustomTo sätts separat.
  ─────────────────────────────────────────────────────────────────── */
  var _periodPreset      = 'month';
  var _periodCustomFrom  = '';
  var _periodCustomTo    = '';

  function _periodRange() {
    var today = _today();
    var d = new Date();
    var y = d.getFullYear();
    var m = d.getMonth(); // 0-indexed
    if (_periodPreset === 'month') {
      var from = y + '-' + String(m + 1).padStart(2, '0') + '-01';
      var lastDay = new Date(y, m + 1, 0).getDate();
      var to = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');
      return { from: from, to: to, label: _monthLabel(from.slice(0, 7)) + ' ' + y };
    }
    if (_periodPreset === 'prev-month') {
      var pm = m === 0 ? 11 : m - 1;
      var py = m === 0 ? y - 1 : y;
      var from = py + '-' + String(pm + 1).padStart(2, '0') + '-01';
      var lastDay = new Date(py, pm + 1, 0).getDate();
      var to = py + '-' + String(pm + 1).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');
      return { from: from, to: to, label: _monthLabel(from.slice(0, 7)) + ' ' + py };
    }
    if (_periodPreset === 'quarter') {
      var q = Math.floor(m / 3);
      var qFrom = y + '-' + String(q * 3 + 1).padStart(2, '0') + '-01';
      var qEndMonth = q * 3 + 3;
      var lastDay = new Date(y, qEndMonth, 0).getDate();
      var qTo = y + '-' + String(qEndMonth).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');
      return { from: qFrom, to: qTo, label: 'Q' + (q + 1) + ' ' + y };
    }
    if (_periodPreset === 'year') {
      return { from: y + '-01-01', to: y + '-12-31', label: 'År ' + y };
    }
    if (_periodPreset === '12months') {
      var d12 = new Date(); d12.setMonth(d12.getMonth() - 12);
      return { from: d12.toISOString().slice(0, 10), to: today, label: 'Senaste 12 mån' };
    }
    if (_periodPreset === 'custom' && _periodCustomFrom && _periodCustomTo) {
      return { from: _periodCustomFrom, to: _periodCustomTo, label: _periodCustomFrom + ' – ' + _periodCustomTo };
    }
    /* fallback = innevarande månad */
    var from = y + '-' + String(m + 1).padStart(2, '0') + '-01';
    var lastDay = new Date(y, m + 1, 0).getDate();
    return { from: from, to: y + '-' + String(m + 1).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0'), label: _monthLabel(from.slice(0, 7)) + ' ' + y };
  }

  function _inPeriod(dateStr, range) {
    if (!dateStr || !range) return false;
    var d = dateStr.slice(0, 10);
    return d >= range.from && d <= range.to;
  }

  /* ── Helpers ─────────────────────────────────────────────────────── */

  function _ic(name, size) {
    return typeof ic !== 'undefined' ? ic(name, size || 16) : '';
  }

  function _today() {
    return new Date().toISOString().slice(0, 10);
  }

  function _monthLabel(ym) {
    if (!ym || ym.length < 7) return ym || '—';
    var months = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
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

  function _fmtKr(val) {
    return val ? Math.round(val).toLocaleString('sv-SE') + ' kr' : '0 kr';
  }

  /* ── KPI-kort ────────────────────────────────────────────────────── */

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

  /* ── Stapeldiagram ───────────────────────────────────────────────── */

  function _bar(label, val, max, color, onClick) {
    var pct = max > 0 ? Math.round((val / max) * 100) : 0;
    var clickAttr  = onClick ? 'onclick="' + onClick + '"' : '';
    var labelStyle = 'font-size:12px;' + (onClick ? 'cursor:pointer;color:var(--blue);text-decoration:underline dotted;' : '');
    var barStyle   = 'height:8px;background:var(--br);border-radius:4px;overflow:hidden;' + (onClick ? 'cursor:pointer;' : '');
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

  /* ── Datakvalitetsvarning ────────────────────────────────────────────
     issues: array av antingen strängar ELLER {msg: string, items: string[]}
     items renderas som expanderbar <details>-lista (inget JS behövs).
  ──────────────────────────────────────────────────────────────────── */

  function _qualityBanner(issues) {
    if (!issues || !issues.length) return '';
    var rows = issues.map(function (i) {
      if (typeof i === 'string') {
        return '<li style="margin:0 0 2px 14px;">' + esc(i) + '</li>';
      }
      /* Strukturerad: {msg, items[]} → expanderbar detalj */
      var detail = '';
      if (i.items && i.items.length) {
        var listItems = i.items.slice(0, 25).map(function (x) {
          return '<li style="margin:0 0 1px 14px;font-size:10px;color:var(--mt);">' + esc(x) + '</li>';
        }).join('');
        if (i.items.length > 25) listItems += '<li style="margin:0 0 1px 14px;font-size:10px;color:var(--mt);">… och ' + (i.items.length - 25) + ' till</li>';
        detail = '<details style="display:inline;">' +
          '<summary style="cursor:pointer;list-style:none;color:var(--blue);text-decoration:underline dotted;font-size:10px;margin-left:6px;">Visa poster</summary>' +
          '<ul style="margin:4px 0 0 0;padding:0;">' + listItems + '</ul>' +
          '</details>';
      }
      return '<li style="margin:0 0 4px 14px;">' + esc(i.msg) + detail + '</li>';
    }).join('');
    return '<div style="background:var(--or-bg,#fff8ec);border:1px solid var(--or,#f59e0b);border-radius:6px;padding:8px 12px;margin-bottom:12px;">' +
      '<div style="font-size:11px;font-weight:700;color:var(--or,#f59e0b);margin-bottom:4px;">' + _ic('alert-triangle', 11) + ' Datakvalitet — poster som inte kunnat räknas fullt ut</div>' +
      '<ul style="margin:0;padding:0;font-size:11px;color:var(--mt);">' + rows + '</ul>' +
    '</div>';
  }

  /* ── Periodfilterrad ─────────────────────────────────────────────── */

  function _periodBar(range) {
    var presets = [
      { key: 'month',      label: 'Denna mån'   },
      { key: 'prev-month', label: 'Föreg. mån'  },
      { key: 'quarter',    label: 'Kvartal'      },
      { key: 'year',       label: 'I år'         },
      { key: '12months',   label: 'Senaste 12 mån' },
      { key: 'custom',     label: 'Eget intervall'  }
    ];
    var html = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;padding:8px 10px;background:var(--bg2,var(--br));border-radius:6px;">' +
      '<span style="font-size:11px;color:var(--mt);white-space:nowrap;font-weight:600;">' + _ic('calendar', 11) + ' Period:</span>' +
      '<div style="display:flex;gap:4px;flex-wrap:wrap;">';
    presets.forEach(function (p) {
      var on = _periodPreset === p.key;
      html += '<button class="btn bs bsm" style="padding:3px 9px;font-size:11px;' +
        (on ? 'background:var(--acc);color:#fff;border-color:var(--acc);' : '') + '" ' +
        'onclick="ReportsPage._setPeriod(\'' + p.key + '\')">' + p.label + '</button>';
    });
    html += '</div>';
    if (_periodPreset === 'custom') {
      html += '<input type="date" value="' + esc(_periodCustomFrom) + '" ' +
        'onchange="ReportsPage._setCustomFrom(this.value)" ' +
        'style="font-size:11px;padding:3px 6px;border:1px solid var(--br);border-radius:4px;background:var(--bg);color:var(--tx);">';
      html += '<span style="font-size:11px;color:var(--mt);">–</span>';
      html += '<input type="date" value="' + esc(_periodCustomTo) + '" ' +
        'onchange="ReportsPage._setCustomTo(this.value)" ' +
        'style="font-size:11px;padding:3px 6px;border:1px solid var(--br);border-radius:4px;background:var(--bg);color:var(--tx);">';
    }
    html += '<span style="font-size:11px;color:var(--mt);white-space:nowrap;margin-left:4px;">↳ <strong>' + esc(range.label) + '</strong> (' + range.from + ' – ' + range.to + ')</span>';
    html += '</div>';
    return html;
  }

  /* ══════════════════════════════════════════════════════════════════
     SEKTIONER
  ══════════════════════════════════════════════════════════════════ */

  function _oversikt() {
    var today  = _today();
    var range  = _periodRange();
    var aos    = state.workOrders || [];
    var active = aos.filter(function (a) { return !a.archived && !a.deleted; });
    var oppna  = active.filter(function (a) { return a.status !== 'klar' && a.status !== 'fakturerad'; });
    var klara  = active.filter(function (a) { return a.status === 'klar'; });
    var forsen = active.filter(function (a) { return a.scheduledDate && a.scheduledDate < today && a.status !== 'klar' && a.status !== 'fakturerad'; });
    var avvs   = (state.avvikelser || []).filter(function (a) { return a.status === 'öppen'; });
    var avvNoAO = avvs.filter(function (a) { return !a.workOrderId; });

    /* Intäkter — FAKTURERAT i vald period */
    var invs    = (state.invoices || []).filter(function (i) { return _inPeriod(i.invoiceDate || i.date, range) && i.status !== 'makulerad'; });
    var revPeriod = invs.reduce(function (s, i) { return s + (parseFloat(i.amount) || 0); }, 0);

    /* Klara AO ej fakturerade — antal (belopp saknar standardvärde utan prissättning) */
    var klar_ej_fak = active.filter(function (a) { return a.status === 'klar' && !a.invoiceId; });

    /* Faktureringsgrad (antal AO) */
    var allKlara     = active.filter(function (a) { return a.status === 'klar' || a.status === 'fakturerad'; });
    var faktureradeCnt = active.filter(function (a) { return a.status === 'fakturerad'; }).length;
    var fakGrad = allKlara.length > 0 ? Math.round((faktureradeCnt / allKlara.length) * 100) : 0;

    /* Timmar i period */
    var timmar = (state.timeEntries || [])
      .filter(function (e) { return _inPeriod(e.date || e.startDate, range); })
      .reduce(function (s, e) { return s + (parseFloat(e.duration) || 0); }, 0);

    /* Status-fördelning */
    var statusGroups = _groupBy(active.filter(function (a) { return a.status !== 'fakturerad'; }), function (a) { return a.status; });
    var statusOrder  = ['pool', 'planerad', 'pågående', 'klar'];
    var statusColors = { pool: 'var(--sky)', planerad: 'var(--blue)', pågående: 'var(--or)', klar: 'var(--gr)' };
    var maxStatus = Math.max.apply(null, statusOrder.map(function (s) { return (statusGroups[s] || []).length; }).concat([1]));

    return _periodBar(range) +
    '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px;">' +
      _kpi('clipboard-list', 'Öppna AO',           oppna.length,             'aktiva, ej klara',               'Router.showPage(\'pg-ao\',{filter:\'alla\'})') +
      _kpi('check-circle',  'Klara AO',             klara.length,             'ej fakturerade',                 'Router.showPage(\'pg-ao\',{filter:\'klar\'})') +
      _kpi('alert-circle',  'Försenade',            forsen.length,            'passerat planerat datum',         'Router.showPage(\'pg-ao\',{filter:\'forsenad\'})') +
      _kpi('receipt',       'Fakturerat ' + range.label, revPeriod ? _fmtKr(revPeriod) : '—', 'Källa: state.invoices.amount · ej makulerade',      'ReportsPage._setTab(\'ekonomi\')') +
      _kpi('alert-triangle','Klara ej fakturerade', klar_ej_fak.length + ' st', 'belopp beräknas ej utan prissättning', 'ReportsPage._setTab(\'ekonomi\')') +
      _kpi('percent',       'Andel fakturerade AO', fakGrad + ' %',           faktureradeCnt + ' av ' + allKlara.length + ' klara · antal-baserat',  'ReportsPage._setTab(\'ekonomi\')') +
      _kpi('clock',         'Tim ' + range.label,   Math.round(timmar) + ' h', 'registrerad tid · ' + range.label,  'ReportsPage._setTab(\'tid\')') +
      _kpi('alert-triangle','Öppna avvikelser',     avvNoAO.length,           'utan arbetsorder',               'Router.showPage(\'pg-rondering\',{})') +
    '</div>' +
    '<div class="ibox">' +
      '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">' + _ic('bar-chart-2', 14) + ' AO per status (alla aktiva)</div>' +
      statusOrder.map(function (s) {
        var cnt = (statusGroups[s] || []).length;
        return _bar(s, cnt, maxStatus, statusColors[s], 'WorkOrdersPage.setFilter(\'' + s + '\');Router.showPage(\'pg-ao\',{})');
      }).join('') +
    '</div>';
  }

  function _arbetsordrar() {
    var range  = _periodRange();
    var today  = _today();
    var aos    = (state.workOrders || []).filter(function (a) { return !a.deleted; });
    var active = aos.filter(function (a) { return !a.archived; });

    /* Filtrera på period (scheduledDate, skapad eller uppdaterad) */
    var inPeriod = active.filter(function (a) {
      return _inPeriod(a.scheduledDate || a.createdAt || a.date, range);
    });

    /* Kvalitetsvarningar */
    var noCuAOs    = inPeriod.filter(function (a) { return !a.customerId; });
    var noPropAOs  = inPeriod.filter(function (a) { return !a.propertyId; });
    var qualIssues = [];
    if (noCuAOs.length)   qualIssues.push({ msg: noCuAOs.length + ' AO saknar kundkoppling (visas ej i kund-grafer)', items: noCuAOs.map(function(a){ return a.id + (a.title ? ' – ' + a.title.slice(0,30) : ''); }) });
    if (noPropAOs.length) qualIssues.push({ msg: noPropAOs.length + ' AO saknar fastighetskoppling (visas ej i fastighets-grafer)', items: noPropAOs.map(function(a){ return a.id + (a.title ? ' – ' + a.title.slice(0,30) : ''); }) });

    /* Per kund */
    var byCu    = _groupBy(inPeriod, function (a) { return a.customerId; });
    var topCu   = _topN(byCu, 10);

    /* Per fastighet */
    var byProp  = _groupBy(inPeriod.filter(function (a) { return a.propertyId; }), function (a) { return a.propertyId; });
    var topProp = _topN(byProp, 10);

    /* Per objekt */
    var byObj   = _groupBy(inPeriod.filter(function (a) { return a.objectId; }), function (a) { return a.objectId; });
    var topObj  = _topN(byObj, 8);

    /* Per personal */
    var byStaff = {};
    inPeriod.forEach(function (a) {
      (a.staff || []).forEach(function (sid) {
        if (!byStaff[sid]) byStaff[sid] = [];
        byStaff[sid].push(a);
      });
    });
    var topStaff = _topN(byStaff, 10);

    /* Försenade per kund (alla, ej bara period) */
    var late     = active.filter(function (a) { return a.scheduledDate && a.scheduledDate < today && a.status !== 'klar' && a.status !== 'fakturerad'; });
    var lateByCu = _groupBy(late, function (a) { return a.customerId; });
    var topLate  = _topN(lateByCu, 8);

    var maxCu    = topCu.length    ? topCu[0].val    : 1;
    var maxProp  = topProp.length  ? topProp[0].val  : 1;
    var maxObj   = topObj.length   ? topObj[0].val   : 1;
    var maxStaff = topStaff.length ? topStaff[0].val : 1;
    var maxLate  = topLate.length  ? topLate[0].val  : 1;

    return _periodBar(range) +
    _qualityBanner(qualIssues) +
    '<div style="font-size:11px;color:var(--mt);margin-bottom:10px;">Visar AO med scheduledDate/skapad i perioden <strong>' + esc(range.label) + '</strong>. Försenade AO visas oavsett period.</div>' +
    '<div class="g2" style="gap:12px;margin-bottom:12px;">' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">' + _ic('users', 14) + ' AO per kund (top 10)</div>' +
        (topCu.length ? topCu.map(function (r) {
          return _bar(_cuName(r.key), r.val, maxCu, 'var(--blue)', 'Router.showPage(\'pg-crm-detail\',{customerId:\'' + r.key + '\'})');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga AO i perioden</div>') +
      '</div>' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">' + _ic('building-2', 14) + ' AO per fastighet (top 10)</div>' +
        (topProp.length ? topProp.map(function (r) {
          return _bar(_propName(r.key), r.val, maxProp, 'var(--sky)', 'Router.showPage(\'pg-property-detail\',{propertyId:\'' + r.key + '\'})');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga AO i perioden</div>') +
      '</div>' +
    '</div>' +
    '<div class="g2" style="gap:12px;margin-bottom:12px;">' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">' + _ic('home', 14) + ' AO per objekt (top 8)</div>' +
        (topObj.length ? topObj.map(function (r) {
          return _bar(_objName(r.key), r.val, maxObj, 'var(--acc)');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga objekt-kopplade AO i perioden</div>') +
      '</div>' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">' + _ic('user', 14) + ' AO per personal (top 10)</div>' +
        (topStaff.length ? topStaff.map(function (r) {
          return _bar(_staffName(r.key), r.val, maxStaff, 'var(--or)');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga AO i perioden</div>') +
      '</div>' +
    '</div>' +
    '<div class="ibox">' +
      '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">' + _ic('clock', 14) + ' Försenade AO per kund (alla perioder)</div>' +
      (topLate.length ? topLate.map(function (r) {
        return _bar(_cuName(r.key), r.val, maxLate, 'var(--rd)', 'Router.showPage(\'pg-crm-detail\',{customerId:\'' + r.key + '\'})');
      }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga försenade AO</div>') +
    '</div>';
  }

  function _tid() {
    var range   = _periodRange();
    var entries = state.timeEntries || [];

    /* Filtrera på period */
    var inPeriod = entries.filter(function (e) { return _inPeriod(e.date || e.startDate, range); });

    /* Datakvalitet */
    var noStaffE = inPeriod.filter(function (e) { return !e.staffId; });
    var qualIssues = [];
    if (noStaffE.length) qualIssues.push({ msg: noStaffE.length + ' tidsregistreringar saknar personal (visas ej i personalgrafer)', items: noStaffE.map(function(e){ return (e.workOrderId || e.id) + (e.date ? ' · ' + e.date : ''); }) });

    /* Per personal */
    var byStaff   = _groupBy(inPeriod, function (e) { return e.staffId; });
    var topStaff  = _topN(byStaff, 15, function (items) {
      return items.reduce(function (s, e) { return s + (parseFloat(e.duration) || 0); }, 0);
    }).map(function (r) { r.val = Math.round(r.val * 10) / 10; return r; });

    /* Beläggning per person (estimat 160 h/mån) */
    var totalHours = inPeriod.reduce(function (s, e) { return s + (parseFloat(e.duration) || 0); }, 0);
    var belaggning = Object.keys(byStaff).map(function (sid) {
      var h = byStaff[sid].reduce(function (s, e) { return s + (parseFloat(e.duration) || 0); }, 0);
      return { staffId: sid, hours: Math.round(h * 10) / 10 };
    }).sort(function (a, b) { return b.hours - a.hours; });
    var maxBel = belaggning.length ? belaggning[0].hours : 1;

    /* Per AO */
    var byAO  = _groupBy(entries.filter(function (e) { return e.workOrderId; }), function (e) { return e.workOrderId; });
    var topAO = _topN(byAO, 8, function (items) {
      return items.reduce(function (s, e) { return s + (parseFloat(e.duration) || 0); }, 0);
    }).map(function (r) { r.val = Math.round(r.val * 10) / 10; return r; });

    /* Per fastighet via AO-koppling (alla tider, inte bara period, för total bild) */
    var byPropH = {};
    inPeriod.forEach(function (e) {
      var ao = e.workOrderId ? (state.workOrders || []).find(function (a) { return a.id === e.workOrderId; }) : null;
      if (!ao || !ao.propertyId) return;
      byPropH[ao.propertyId] = (byPropH[ao.propertyId] || 0) + (parseFloat(e.duration) || 0);
    });
    var topPropH  = Object.keys(byPropH).map(function (k) { return { key: k, val: Math.round(byPropH[k] * 10) / 10 }; })
      .sort(function (a, b) { return b.val - a.val; }).slice(0, 8);
    var maxPropH  = topPropH.length  ? topPropH[0].val  : 1;
    var maxStaff  = topStaff.length  ? topStaff[0].val  : 1;
    var maxAO     = topAO.length     ? topAO[0].val     : 1;

    /* Beläggningsfärg: <60% grå, 60–85% grön, 85–100% orange, >100% röd */
    function _belColor(h) {
      var pct = (h / 160) * 100;
      if (pct > 100) return 'var(--rd)';
      if (pct >= 85)  return 'var(--or)';
      if (pct >= 60)  return 'var(--gr)';
      return 'var(--sky)';
    }

    return _periodBar(range) +
    _qualityBanner(qualIssues) +
    '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px;">' +
      _kpi('clock',  'Tim ' + range.label, Math.round(totalHours) + ' h', 'registrerad tid i perioden') +
      _kpi('users',  'Personal aktiv',     belaggning.length + ' st',     'med registrerad tid') +
      _kpi('clipboard-list', 'AO med tid', Object.keys(byAO).length + ' st', 'arbetsordrar med tidspost') +
    '</div>' +
    '<div class="g2" style="gap:12px;margin-bottom:12px;">' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('clock', 14) + ' Timmar per personal — ' + range.label + '</div>' +
        '<div style="font-size:11px;color:var(--mt);margin-bottom:10px;">Registrerade timmar i perioden</div>' +
        (topStaff.length ? topStaff.map(function (r) {
          return _bar(_staffName(r.key), r.val + ' h', maxStaff, 'var(--blue)');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga tidsregistreringar i perioden</div>') +
      '</div>' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('activity', 14) + ' Beläggningsestimat — ' + range.label + '</div>' +
        '<div style="font-size:11px;color:var(--mt);margin-bottom:6px;">Registrerade timmar vs. 160 h/mån (standardvärde). <strong>Obs: faktisk kapacitet varierar per person</strong> (sysselsättningsgrad, frånvaro, deltid saknas).</div>' +
        '<div style="font-size:10px;color:var(--mt);margin-bottom:8px;">Färg: <span style="color:var(--sky);">■</span> &lt;60% låg · <span style="color:var(--gr);">■</span> 60–85% normal · <span style="color:var(--or);">■</span> 85–100% hög · <span style="color:var(--rd);">■</span> &gt;100% överbelastad</div>' +
        (belaggning.length ? belaggning.map(function (r) {
          var pct160 = Math.round((r.hours / 160) * 100);
          return _bar(_staffName(r.staffId), r.hours + ' h (' + pct160 + '%)', maxBel, _belColor(r.hours));
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga tidsregistreringar i perioden</div>') +
      '</div>' +
    '</div>' +
    '<div class="g2" style="gap:12px;">' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('clipboard-list', 14) + ' Timmar per AO (top 8, totalt)</div>' +
        '<div style="font-size:11px;color:var(--mt);margin-bottom:10px;">Mest tidskrävande arbetsordrar</div>' +
        (topAO.length ? topAO.map(function (r) {
          var ao = (state.workOrders || []).find(function (a) { return a.id === r.key; });
          var label = ao ? (r.key + ' – ' + (ao.title || '').slice(0, 22)) : r.key;
          return _bar(label, r.val + ' h', maxAO, 'var(--acc)', 'Router.showPage(\'pg-ao-detail\',{aoId:\'' + r.key + '\'})');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Ingen tiddata</div>') +
      '</div>' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('building-2', 14) + ' Timmar per fastighet — ' + range.label + '</div>' +
        '<div style="font-size:11px;color:var(--mt);margin-bottom:10px;">Summerad tid via AO-koppling</div>' +
        (topPropH.length ? topPropH.map(function (r) {
          return _bar(_propName(r.key), r.val + ' h', maxPropH, 'var(--sky)', 'Router.showPage(\'pg-property-detail\',{propertyId:\'' + r.key + '\'})');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Ingen fastighetsdata i perioden</div>') +
      '</div>' +
    '</div>';
  }

  function _avvikelser() {
    var range = _periodRange();
    var avvs  = state.avvikelser || [];

    /* Filtrera avvikelser på period (skapade i perioden) */
    var inPeriod = avvs.filter(function (a) { return _inPeriod(a.date || a.createdAt, range); });
    var oppna    = avvs.filter(function (a) { return a.status === 'öppen'; }); /* alla öppna, oavsett period */

    /* Datakvalitet */
    var noType  = inPeriod.filter(function (a) { return !a.issueType; }).length;
    var noProp  = inPeriod.filter(function (a) { return !a.propertyId; }).length;
    var qualIssues = [];
    var noTypeAvv = inPeriod.filter(function (a) { return !a.issueType; });
    var noPropAvv = inPeriod.filter(function (a) { return !a.propertyId; });
    if (noTypeAvv.length) qualIssues.push({ msg: noTypeAvv.length + ' avvikelser saknar feltyp', items: noTypeAvv.map(function(a){ return a.id + (a.description ? ' – ' + a.description.slice(0,30) : ''); }) });
    if (noPropAvv.length) qualIssues.push({ msg: noPropAvv.length + ' avvikelser saknar fastighetskoppling', items: noPropAvv.map(function(a){ return a.id + (a.description ? ' – ' + a.description.slice(0,30) : ''); }) });

    /* Per fastighet (öppna, alla perioder) */
    var byProp  = _groupBy(oppna, function (a) { return a.propertyId; });
    var topProp = _topN(byProp, 10);

    /* Per objekt (öppna) */
    var byObj   = _groupBy(oppna.filter(function (a) { return a.objectId; }), function (a) { return a.objectId; });
    var topObj  = _topN(byObj, 8);

    /* Per feltyp (period) */
    var byType  = _groupBy(inPeriod, function (a) { return a.issueType || '—'; });
    var topType = _topN(byType, 8);

    /* Återkommande via recurringKey */
    var recurring  = avvs.filter(function (a) { return a.recurringKey; });
    var byRecKey   = _groupBy(recurring, function (a) { return a.recurringKey; });
    var topRecur   = _topN(byRecKey, 8).filter(function (r) { return r.val > 1; });

    /* Återkommande per fastighet (unika recurringKeys) */
    var recurByProp = {};
    recurring.forEach(function (a) {
      if (!a.propertyId) return;
      if (!recurByProp[a.propertyId]) recurByProp[a.propertyId] = new Set();
      recurByProp[a.propertyId].add(a.recurringKey);
    });
    var topRecurProp = Object.keys(recurByProp)
      .map(function (k) { return { key: k, val: recurByProp[k].size }; })
      .sort(function (a, b) { return b.val - a.val; }).slice(0, 8);

    /* Per allvarlighetsgrad (period) */
    var bySev     = _groupBy(inPeriod, function (a) { return a.severity || 'ej angiven'; });
    var sevColors = { kritisk: 'var(--rd)', hög: 'var(--or)', medel: 'var(--or)', låg: 'var(--gr)', 'ej angiven': 'var(--mt)' };
    var sevOrder  = ['kritisk', 'hög', 'medel', 'låg', 'ej angiven'];
    var maxSev    = Math.max.apply(null, sevOrder.map(function (s) { return (bySev[s] || []).length; }).concat([1]));
    var maxProp   = topProp.length    ? topProp[0].val    : 1;
    var maxObj    = topObj.length     ? topObj[0].val     : 1;
    var maxType   = topType.length    ? topType[0].val    : 1;
    var maxRecur  = topRecur.length   ? topRecur[0].val   : 1;
    var maxRProp  = topRecurProp.length ? topRecurProp[0].val : 1;

    return _periodBar(range) +
    _qualityBanner(qualIssues) +
    '<div style="font-size:11px;color:var(--mt);margin-bottom:10px;">Öppna avvikelser visas för alla perioder. Feltyp, allvarlighetsgrad och återkommande filtreras på <strong>' + esc(range.label) + '</strong>.</div>' +
    '<div class="g2" style="gap:12px;margin-bottom:12px;">' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">' + _ic('building-2', 14) + ' Öppna avvikelser per fastighet (alla)</div>' +
        (topProp.length ? topProp.map(function (r) {
          return _bar(_propName(r.key), r.val, maxProp, 'var(--rd)', 'Router.showPage(\'pg-property-detail\',{propertyId:\'' + r.key + '\'})');
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
        '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">' + _ic('alert-triangle', 14) + ' Per allvarlighetsgrad — ' + range.label + '</div>' +
        sevOrder.map(function (s) { return _bar(s, (bySev[s] || []).length, maxSev, sevColors[s]); }).join('') +
      '</div>' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">' + _ic('tag', 14) + ' Avvikelser per feltyp — ' + range.label + '</div>' +
        (topType.length ? topType.map(function (r) {
          return _bar(r.key, r.val, maxType, 'var(--or)');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga avvikelser i perioden</div>') +
      '</div>' +
    '</div>' +
    '<div class="g2" style="gap:12px;">' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('repeat', 14) + ' Återkommande mönster (> 1 förekomst)</div>' +
        '<div style="font-size:11px;color:var(--mt);margin-bottom:10px;">Alla perioder · grupperade via recurringKey</div>' +
        (topRecur.length ? topRecur.map(function (r) {
          var label = r.key.split('::').pop() || r.key;
          return _bar(label, r.val, maxRecur, 'var(--rd)');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga återkommande mönster ännu</div>') +
      '</div>' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('building-2', 14) + ' Fastigheter med flest återkommande mönster</div>' +
        '<div style="font-size:11px;color:var(--mt);margin-bottom:10px;">Alla perioder · unika recurringKeys per fastighet</div>' +
        (topRecurProp.length ? topRecurProp.map(function (r) {
          return _bar(_propName(r.key), r.val + ' mönster', maxRProp, 'var(--rd)', 'Router.showPage(\'pg-property-detail\',{propertyId:\'' + r.key + '\'})');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga data</div>') +
      '</div>' +
    '</div>';
  }

  function _ekonomi() {
    var range = _periodRange();
    var invs  = state.invoices || [];
    var aos   = (state.workOrders || []).filter(function (a) { return !a.deleted; });

    /* ── Intäktskällor ──────────────────────────────────────────────
       Fakturerat    = fakturor i perioden (ej makulerade)
       Klart att fak = AO med status klar, inget invoiceId (ej period-filtrerat, visar totalt)
       Pågående      = AO med status pågående/planerad (antal, inget belopp)
       OBS: Klara och pågående AO saknar ett faktisk belopps-fält utan summering av
       material + tid × timpris. Visas som antal, inte som kr.
    ──────────────────────────────────────────────────────────────── */
    var fakInvs    = invs.filter(function (i) { return _inPeriod(i.invoiceDate || i.date, range) && i.status !== 'makulerad'; });
    var totalFak   = fakInvs.reduce(function (s, i) { return s + (parseFloat(i.amount) || 0); }, 0);
    var totalAllFak = invs.filter(function (i) { return i.status !== 'makulerad'; })
      .reduce(function (s, i) { return s + (parseFloat(i.amount) || 0); }, 0);

    var klaraEjFak = aos.filter(function (a) { return a.status === 'klar' && !a.invoiceId; });
    var pagaende   = aos.filter(function (a) { return a.status === 'pågående' || a.status === 'planerad'; });

    /* Faktureringsgrad (antal AO) */
    var allKlara     = aos.filter(function (a) { return a.status === 'klar' || a.status === 'fakturerad'; });
    var faktureradeCnt = aos.filter(function (a) { return a.status === 'fakturerad'; }).length;
    var fakGrad = allKlara.length > 0 ? Math.round((faktureradeCnt / allKlara.length) * 100) : 0;

    /* Material (alla AO) */
    var matCost = 0;
    var noMatPrice = 0;
    aos.forEach(function (ao) {
      (ao.materials || []).forEach(function (m) {
        var up = parseFloat(m.totalPrice || m.unitPrice || m.price);
        if (!up) { noMatPrice++; return; }
        matCost += up * (parseFloat(m.quantity) || 1);
      });
    });

    /* Bidrag före lönekostnad = fakturerat (period) − total materialkostnad (alla)
       OBS: inte ett fullständigt TB. Lönekostnad, underentreprenörer och OH saknas. */
    var bidragForeLonel = totalFak - matCost;

    /* Intäkter per kund (period) */
    var byCuRev = {};
    fakInvs.forEach(function (inv) {
      var cid = inv.customerId || '—';
      byCuRev[cid] = (byCuRev[cid] || 0) + (parseFloat(inv.amount) || 0);
    });
    var topCuRev = Object.keys(byCuRev).map(function (k) { return { key: k, val: byCuRev[k] }; })
      .sort(function (a, b) { return b.val - a.val; }).slice(0, 10);
    var maxCuRev = topCuRev.length ? topCuRev[0].val : 1;

    /* Intäkter per fastighet via AO-koppling (period) */
    var byPropRev = {};
    fakInvs.forEach(function (inv) {
      var ao = inv.workOrderId ? aos.find(function (a) { return a.id === inv.workOrderId; }) : null;
      if (!ao || !ao.propertyId) return;
      byPropRev[ao.propertyId] = (byPropRev[ao.propertyId] || 0) + (parseFloat(inv.amount) || 0);
    });
    var topPropRev = Object.keys(byPropRev).map(function (k) { return { key: k, val: byPropRev[k] }; })
      .sort(function (a, b) { return b.val - a.val; }).slice(0, 8);
    var maxPropRev = topPropRev.length ? topPropRev[0].val : 1;

    /* Intäkter per månad (senaste 12) */
    var monthMap = {};
    invs.filter(function (i) { return i.status !== 'makulerad'; }).forEach(function (inv) {
      var m = (inv.invoiceDate || inv.date || '').slice(0, 7);
      if (m) monthMap[m] = (monthMap[m] || 0) + (parseFloat(inv.amount) || 0);
    });
    var months12 = [];
    for (var i = 11; i >= 0; i--) {
      var d = new Date(); d.setMonth(d.getMonth() - i);
      var mk = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      months12.push({ key: mk, label: _monthLabel(mk), val: monthMap[mk] || 0 });
    }
    var maxMonthRev = Math.max.apply(null, months12.map(function (m) { return m.val; }).concat([1]));

    /* Klara AO ej fakturerade per kund */
    var ejFakByCu = _groupBy(klaraEjFak, function (a) { return a.customerId; });
    var topEjFak  = _topN(ejFakByCu, 8);
    var maxEjFak  = topEjFak.length ? topEjFak[0].val : 1;

    /* Datakvalitet */
    var noInvLink = fakInvs.filter(function (i) { return !i.workOrderId; }).length;
    var qualIssues = [];
    if (noMatPrice) qualIssues.push(noMatPrice + ' materialposter saknar pris (räknas ej i materialkostnad)');
    if (noInvLink)  qualIssues.push({ msg: noInvLink + ' fakturor saknar AO-koppling (visas ej i fastighets-/objektsgraf)', items: fakInvs.filter(function(i){return !i.workOrderId;}).map(function(i){ return (i.id||'?') + (i.invoiceDate ? ' · ' + i.invoiceDate : '') + (i.amount ? ' · ' + parseFloat(i.amount).toFixed(0) + ' kr' : ''); }) });

    return _periodBar(range) +
    _qualityBanner(qualIssues) +
    /* Intäktsförklaring */
    '<div style="background:var(--bg2,var(--br));border-radius:6px;padding:8px 12px;margin-bottom:12px;font-size:11px;color:var(--mt);">' +
      '<strong>Intäktsdefinition:</strong> Fakturerat = summa av <code>state.invoices[].amount</code> med invoiceDate i perioden, exkl. makulerade. ' +
      'Klara ej fakturerade AO och pågående ordervärde visas som <em>antal</em> — belopp kräver summering av material + tid × timpris.<br>' +
      '<strong>Andel fakturerade AO (antal-baserat):</strong> Antal AO med status "fakturerad" / (antal AO med status "klar" + "fakturerad"). ' +
      'Inte ett värdebaserat mått — saknar prissättning per AO.' +
    '</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px;">' +
      _kpi('trending-up',   'Fakturerat ' + range.label,    totalFak ? _fmtKr(totalFak) : '—',         'Källa: fakturor i perioden (ej makulerade)') +
      _kpi('trending-up',   'Fakturerat totalt',            totalAllFak ? _fmtKr(totalAllFak) : '—',    'alla perioder') +
      _kpi('percent',       'Andel fakturerade AO',   fakGrad + ' %',                              faktureradeCnt + ' av ' + allKlara.length + ' klara · obs: antal-baserat') +
      _kpi('check-circle',  'Klara ej fakturerade',         klaraEjFak.length + ' AO',                  'belopp beräknas ej utan prissättning',      'Router.showPage(\'pg-ao\',{filter:\'klar\'})') +
      _kpi('clock',         'Pågående ordrar',              pagaende.length + ' AO',                     'status pågående/planerad · inget belopp',   'Router.showPage(\'pg-ao\',{filter:\'alla\'})') +
      _kpi('shopping-cart', 'Materialkostnad (totalt)',      matCost ? _fmtKr(matCost) : '—',            'alla AO, alla perioder') +
      _kpi('trending-up',   'Bidrag före lönekostnad',      bidragForeLonel ? _fmtKr(bidragForeLonel) : '—', 'Fakturerat (period) − materialkostnad (totalt) · ej fullständigt TB') +
    '</div>' +
    '<div class="ibox" style="margin-bottom:12px;">' +
      '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('calendar', 14) + ' Fakturerat per månad — senaste 12</div>' +
      '<div style="font-size:11px;color:var(--mt);margin-bottom:10px;">Summa fakturabelopp per månad (ej makulerade)</div>' +
      months12.map(function (m) {
        return _bar(m.label, m.val ? _fmtKr(m.val) : '0 kr', maxMonthRev, 'var(--blue)');
      }).join('') +
    '</div>' +
    '<div class="g2" style="gap:12px;margin-bottom:12px;">' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('users', 14) + ' Fakturerat per kund — ' + range.label + '</div>' +
        (topCuRev.length ? topCuRev.map(function (r) {
          return _bar(_cuName(r.key), _fmtKr(r.val), maxCuRev, 'var(--gr)', 'Router.showPage(\'pg-crm-detail\',{customerId:\'' + r.key + '\'})');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga fakturor i perioden</div>') +
      '</div>' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('building-2', 14) + ' Fakturerat per fastighet — ' + range.label + '</div>' +
        '<div style="font-size:11px;color:var(--mt);margin-bottom:10px;">Via AO-koppling på faktura</div>' +
        (topPropRev.length ? topPropRev.map(function (r) {
          return _bar(_propName(r.key), _fmtKr(r.val), maxPropRev, 'var(--sky)', 'Router.showPage(\'pg-property-detail\',{propertyId:\'' + r.key + '\'})');
        }).join('') : '<div style="font-size:12px;color:var(--mt);">Ingen fastighetsdata (fakturor saknar AO-koppling)</div>') +
      '</div>' +
    '</div>' +
    '<div class="ibox">' +
      '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('alert-circle', 14) + ' Klara AO ej fakturerade — per kund</div>' +
      '<div style="font-size:11px;color:var(--mt);margin-bottom:10px;">Visar antal AO — belopp kräver summering av material och tid × timpris</div>' +
      (topEjFak.length ? topEjFak.map(function (r) {
        return _bar(_cuName(r.key), r.val + ' AO', maxEjFak, 'var(--or)', 'Router.showPage(\'pg-crm-detail\',{customerId:\'' + r.key + '\'})');
      }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga klara ofakturerade AO</div>') +
    '</div>';
  }

  function _material() {
    var range = _periodRange();
    var aos   = (state.workOrders || []).filter(function (a) { return !a.deleted; });

    /* Filtrera AO på period */
    var inPeriod = aos.filter(function (a) { return _inPeriod(a.scheduledDate || a.createdAt, range); });

    var allMats  = [];
    var aoCosts  = [];
    var noPrice  = 0;
    inPeriod.forEach(function (ao) {
      var mats = ao.materials || [];
      var cost = 0;
      mats.forEach(function (m) {
        var qty  = parseFloat(m.quantity) || 1;
        var up   = parseFloat(m.totalPrice || m.unitPrice || m.price);
        if (!up) { noPrice++; return; }
        var line = up * qty;
        cost += line;
        allMats.push({ aoId: ao.id, name: m.name || m.article || m.description || '—', qty: qty, price: line });
      });
      if (mats.length > 0) aoCosts.push({ aoId: ao.id, cost: cost, ao: ao });
    });

    var qualIssues = [];
    if (noPrice) qualIssues.push(noPrice + ' materialposter saknar pris (räknas ej i summering)');

    if (allMats.length === 0) {
      return _periodBar(range) + _qualityBanner(qualIssues) +
        '<div class="ibox"><p style="font-size:13px;color:var(--mt);">Inga material har registrerats på arbetsordrar i perioden ' + esc(range.label) + '.</p></div>';
    }

    var totalMatCost = allMats.reduce(function (s, m) { return s + m.price; }, 0);
    aoCosts.sort(function (a, b) { return b.cost - a.cost; });
    var topAO     = aoCosts.slice(0, 10);
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
    inPeriod.forEach(function (ao) {
      var cost = (ao.materials || []).reduce(function (s, m) {
        var up = parseFloat(m.totalPrice || m.unitPrice || m.price);
        return s + (up ? up * (parseFloat(m.quantity) || 1) : 0);
      }, 0);
      if (cost > 0) { var cid = ao.customerId || '—'; byCuMat[cid] = (byCuMat[cid] || 0) + cost; }
    });
    var topCuMat  = Object.keys(byCuMat).map(function (k) { return { key: k, val: byCuMat[k] }; })
      .sort(function (a, b) { return b.val - a.val; }).slice(0, 8);
    var maxCuMat  = topCuMat.length ? topCuMat[0].val : 1;

    return _periodBar(range) +
    _qualityBanner(qualIssues) +
    '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px;">' +
      _kpi('shopping-cart', 'Material ' + range.label,  _fmtKr(totalMatCost), 'AO i perioden med prissatta material') +
      _kpi('layers',        'Unika artiklar',            Object.keys(byArt).length + ' st',  'distinkta artikelnamn') +
      _kpi('clipboard-list','AO med material',           aoCosts.length + ' st',             'i perioden, minst en artikel') +
    '</div>' +
    '<div class="g2" style="gap:12px;margin-bottom:12px;">' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('clipboard-list', 14) + ' Material per AO (top 10) — ' + range.label + '</div>' +
        topAO.map(function (r) {
          var label = r.aoId + (r.ao && r.ao.title ? ' – ' + r.ao.title.slice(0, 20) : '');
          return _bar(label, _fmtKr(r.cost), maxAOCost, 'var(--blue)', 'Router.showPage(\'pg-ao-detail\',{aoId:\'' + r.aoId + '\'})');
        }).join('') +
      '</div>' +
      '<div class="ibox">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('tag', 14) + ' Vanligaste artiklar (top 10)</div>' +
        topArt.map(function (r) {
          return _bar(r.key, _fmtKr(r.val) + ' (' + Math.round(r.qty * 10) / 10 + ' st)', maxArtCost, 'var(--acc)');
        }).join('') +
      '</div>' +
    '</div>' +
    '<div class="ibox">' +
      '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + _ic('users', 14) + ' Material per kund (top 8) — ' + range.label + '</div>' +
      (topCuMat.length ? topCuMat.map(function (r) {
        return _bar(_cuName(r.key), _fmtKr(r.val), maxCuMat, 'var(--sky)', 'Router.showPage(\'pg-crm-detail\',{customerId:\'' + r.key + '\'})');
      }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga data</div>') +
    '</div>';
  }

  function _serviceIntervall() {
    var range = _periodRange();
    var today = _today();
    var props = state.properties || [];
    var allSI = [];
    props.forEach(function (p) {
      (p.serviceIntervals || []).forEach(function (si) {
        allSI.push(Object.assign({ _propId: p.id, _propName: p.name || p.address || p.id }, si));
      });
    });

    /* Datakvalitet */
    var noNextDate = allSI.filter(function (si) { return !si.nextDate; }).length;
    var qualIssues = noNextDate ? [noNextDate + ' serviceintervall saknar nästa datum (visas ej i graferna)'] : [];

    var overdue = allSI.filter(function (si) { return si.nextDate && si.nextDate < today && si.status !== 'done'; });
    var coming  = allSI.filter(function (si) { return si.nextDate && si.nextDate >= today; })
      .sort(function (a, b) { return a.nextDate > b.nextDate ? 1 : -1; }).slice(0, 20);

    /* Per fastighet — förfallna */
    var overdueByProp = _groupBy(overdue, function (si) { return si._propId; });
    var topOverProp   = _topN(overdueByProp, 8);
    var maxOverProp   = topOverProp.length ? topOverProp[0].val : 1;

    function _siRow(si) {
      var diff  = si.nextDate ? Math.round((new Date(si.nextDate) - new Date(today)) / 86400000) : null;
      var badge = diff == null ? '' :
        diff < 0  ? '<span class="bdg bdg-red" style="font-size:9px;">' + Math.abs(diff) + ' dagar sedan</span>'
        : diff === 0 ? '<span class="bdg bdg-orange" style="font-size:9px;">Idag</span>'
        :              '<span class="bdg bdg-grey" style="font-size:9px;">Om ' + diff + ' d</span>';
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--br);gap:6px;">' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:12px;font-weight:600;">' + esc(si.name || si._propName) + '</div>' +
          '<div style="font-size:11px;color:var(--mt);">' + esc(si._propName) + (si.nextDate ? ' · ' + si.nextDate : '') + '</div>' +
        '</div>' + badge +
      '</div>';
    }

    return _periodBar(range) +
    _qualityBanner(qualIssues) +
    '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px;">' +
      _kpi('alert-circle', 'Förfallna',  overdue.length + ' st', 'passerat datum, ej klara') +
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
      (topOverProp.length ? topOverProp.map(function (r) {
        return _bar(_propName(r.key), r.val + ' st', maxOverProp, 'var(--rd)', 'Router.showPage(\'pg-property-detail\',{propertyId:\'' + r.key + '\'})');
      }).join('') : '<div style="font-size:12px;color:var(--mt);">Inga förfallna</div>') +
    '</div>';
  }

  /* ══════════════════════════════════════════════════════════════════
     OFFERTER (punkt 127)
  ══════════════════════════════════════════════════════════════════ */

  function _offerter() {
    var range   = _periodRange();
    var offers  = (state.offers || []).filter(function (o) {
      var d = (o.date || o.createdAt || '').slice(0, 10);
      return d >= range.from && d <= range.to;
    });
    var events  = state.offerEvents || [];

    /* ── KPI-tal ── */
    var total      = offers.length;
    var sent       = offers.filter(function (o) { return o.publicToken; }).length;
    var opened     = offers.filter(function (o) { return o.openedAt; }).length;
    var approved   = offers.filter(function (o) { return o.status === 'godkänd'; }).length;
    var declined   = offers.filter(function (o) { return o.status === 'nekad'; }).length;
    var changeReq  = offers.filter(function (o) { return o.status === 'ändring-begärd'; }).length;
    var pending    = offers.filter(function (o) {
      return o.publicToken && o.status !== 'godkänd' && o.status !== 'nekad';
    }).length;

    var openRate     = sent    > 0 ? Math.round(opened   / sent    * 100) : null;
    var approveRate  = opened  > 0 ? Math.round(approved / opened  * 100) : null;
    var convRate     = sent    > 0 ? Math.round(approved / sent    * 100) : null;

    /* Genomsnittlig svarstid (approved/declined/changeReq):
       mäts från openedAt (första öppning) till answeredAt */
    var responseTimes = [];
    offers.forEach(function (o) {
      if (o.openedAt && o.answeredAt) {
        var ms = new Date(o.answeredAt) - new Date(o.openedAt);
        if (ms >= 0) responseTimes.push(ms / 3600000 / 24); /* dagar */
      }
    });
    var avgDays = responseTimes.length
      ? (responseTimes.reduce(function (a, b) { return a + b; }, 0) / responseTimes.length)
      : null;

    /* ── Totalvärde ── */
    function _offerTotal(o) {
      var lines = (o.lines || []).concat(o.extras || []);
      return lines.reduce(function (s, l) { return s + (Number(l.total) || 0); }, 0);
    }
    var totalValue    = offers.reduce(function (s, o) { return s + _offerTotal(o); }, 0);
    var approvedValue = offers.filter(function (o) { return o.status === 'godkänd'; })
      .reduce(function (s, o) { return s + _offerTotal(o); }, 0);

    /* ── Statusfördelning (stapeldiagram) ── */
    var statusGroups = [
      { label: 'Utkast',          key: 'utkast',          color: 'var(--mt)'   },
      { label: 'Skickad',         key: 'skickad',         color: 'var(--ac)'   },
      { label: 'Öppnad av kund',  key: '_opened',         color: '#6c8ebf'     },
      { label: 'Ändring begärd',  key: 'ändring-begärd',  color: 'var(--or)'   },
      { label: 'Godkänd',         key: 'godkänd',         color: 'var(--gr)'   },
      { label: 'Nekad',           key: 'nekad',           color: 'var(--rd)'   }
    ];
    var statusCounts = {};
    offers.forEach(function (o) {
      var k = (o.openedAt && o.status === 'skickad') ? '_opened' : (o.status || 'utkast');
      statusCounts[k] = (statusCounts[k] || 0) + 1;
    });
    var maxStatus = Math.max.apply(null, statusGroups.map(function (g) { return statusCounts[g.key] || 0; }).concat([1]));

    /* ── Händelsetyper (offerEvents) per dag — öppningar och svar ── */
    var eventsByDay = {};
    events.forEach(function (e) {
      if (!offers.find(function (o) { return o.id === e.offerId; })) return;
      var day = (e.ts || '').slice(0, 10);
      if (!day || day < range.from || day > range.to) return;
      if (!eventsByDay[day]) eventsByDay[day] = { opened: 0, approved: 0, declined: 0 };
      if (e.type === 'opened')   eventsByDay[day].opened++;
      if (e.type === 'approved') eventsByDay[day].approved++;
      if (e.type === 'declined') eventsByDay[day].declined++;
    });

    /* ── Top 5 offertmottagare (kunder) ── */
    var byCustomer = {};
    offers.forEach(function (o) {
      var k = o.customerName || 'Okänd';
      if (!byCustomer[k]) byCustomer[k] = { total: 0, approved: 0, value: 0 };
      byCustomer[k].total++;
      if (o.status === 'godkänd') { byCustomer[k].approved++; byCustomer[k].value += _offerTotal(o); }
    });
    var topCustomers = Object.keys(byCustomer).map(function (k) {
      return Object.assign({ name: k }, byCustomer[k]);
    }).sort(function (a, b) { return b.total - a.total; }).slice(0, 8);
    var maxCust = topCustomers.length ? topCustomers[0].total : 1;

    /* ── Datakvalitet ── */
    var qualIssues = [];
    if (offers.filter(function (o) { return !o.date && !o.createdAt; }).length)
      qualIssues.push('Vissa offerter saknar datum och kan ha missats i periodfilter');

    /* ── HTML ── */
    var pct = function (n) { return n == null ? '–' : n + '%'; };

    var kpiRow = '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px;">' +
      _kpi('file-text',       'Totalt',          total + ' st',            'offerter i perioden') +
      _kpi('send',            'Skickade',         sent + ' st',             'med publik länk') +
      _kpi('eye',             'Öppningsgrad',     pct(openRate),            'av skickade öppnade av kund') +
      _kpi('check-circle',    'Godkännandegrad',  pct(approveRate),         'av öppnade godkändes') +
      _kpi('trending-up',     'Konvertering',     pct(convRate),            'skickad → godkänd') +
      _kpi('clock',           'Svarstid',         avgDays != null ? avgDays.toFixed(1) + ' dagar' : '–', 'genomsnitt öppnad → svar') +
    '</div>';

    var valueRow = '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px;">' +
      _kpi('dollar-sign',     'Offertvärde',      fmt(totalValue),          'totalt offertvärde i perioden') +
      _kpi('check-square',    'Godkänt värde',    fmt(approvedValue),       'godkända offerter') +
      _kpi('clock',           'Inväntar svar',    pending + ' st',          'skickade utan slutgiltigt svar') +
      _kpi('alert-circle',    'Ändring begärd',   changeReq + ' st',        'kund begärt ändring') +
    '</div>';

    /* Statusfördelning */
    var statusBars = '<div class="ibox" style="margin-bottom:12px;">' +
      '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">' + _ic('bar-chart-2', 14) + ' Statusfördelning</div>' +
      statusGroups.map(function (g) {
        var cnt = statusCounts[g.key] || 0;
        if (!cnt) return '';
        var pctW = Math.round(cnt / maxStatus * 100);
        return '<div style="margin-bottom:6px;">' +
          '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px;">' +
            '<span>' + g.label + '</span>' +
            '<span style="font-weight:600;">' + cnt + ' st</span>' +
          '</div>' +
          '<div style="background:var(--br);border-radius:3px;height:10px;">' +
            '<div style="background:' + g.color + ';width:' + pctW + '%;height:10px;border-radius:3px;transition:width .3s;"></div>' +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';

    /* Top kunder */
    var custTable = '<div class="ibox">' +
      '<div style="font-weight:700;font-size:13px;margin-bottom:8px;">' + _ic('users', 14) + ' Topp kunder</div>' +
      (topCustomers.length
        ? '<table style="width:100%;font-size:12px;border-collapse:collapse;">' +
            '<thead><tr>' +
              '<th style="text-align:left;padding:4px 6px;font-weight:600;border-bottom:1px solid var(--br);">Kund</th>' +
              '<th style="text-align:right;padding:4px 6px;font-weight:600;border-bottom:1px solid var(--br);">Offerter</th>' +
              '<th style="text-align:right;padding:4px 6px;font-weight:600;border-bottom:1px solid var(--br);">Godkända</th>' +
              '<th style="text-align:right;padding:4px 6px;font-weight:600;border-bottom:1px solid var(--br);">Godkänt värde</th>' +
            '</tr></thead><tbody>' +
            topCustomers.map(function (c) {
              return '<tr>' +
                '<td style="padding:5px 6px;border-bottom:1px solid var(--br);">' + esc(c.name) + '</td>' +
                '<td style="padding:5px 6px;border-bottom:1px solid var(--br);text-align:right;">' + c.total + '</td>' +
                '<td style="padding:5px 6px;border-bottom:1px solid var(--br);text-align:right;">' + c.approved + '</td>' +
                '<td style="padding:5px 6px;border-bottom:1px solid var(--br);text-align:right;font-variant-numeric:tabular-nums;">' + fmt(c.value) + '</td>' +
              '</tr>';
            }).join('') +
          '</tbody></table>'
        : '<div style="font-size:12px;color:var(--mt);">Inga offerter i perioden</div>') +
    '</div>';

    /* Senaste händelser från offerEvents */
    var recentEvents = events
      .filter(function (e) {
        var d = (e.ts || '').slice(0, 10);
        return d >= range.from && d <= range.to && offers.find(function (o) { return o.id === e.offerId; });
      })
      .sort(function (a, b) { return (b.ts || '') > (a.ts || '') ? 1 : -1; })
      .slice(0, 10);

    var _evLabel = {
      opened:           'Kund öppnade länk',
      approved:         'Kund godkände',
      change_requested: 'Kund begärde ändring',
      declined:         'Kund nekade',
      revoked:          'Länk återkallad',
      renewed:          'Länk förnyad'
    };
    var _evColor = {
      opened: 'var(--ac)', approved: 'var(--gr)', change_requested: 'var(--or)',
      declined: 'var(--rd)', revoked: 'var(--mt)', renewed: 'var(--ac)'
    };

    var eventsFeed = '<div class="ibox" style="margin-bottom:12px;">' +
      '<div style="font-weight:700;font-size:13px;margin-bottom:8px;">' + _ic('activity', 14) + ' Senaste kundhändelser</div>' +
      (recentEvents.length
        ? recentEvents.map(function (e) {
            var off = offers.find(function (o) { return o.id === e.offerId; });
            var title = off ? (off.title || e.offerId) : e.offerId;
            return '<div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid var(--br);">' +
              '<span style="width:8px;height:8px;border-radius:50%;background:' + (_evColor[e.type] || 'var(--mt)') + ';flex-shrink:0;margin-top:4px;"></span>' +
              '<div style="flex:1;min-width:0;">' +
                '<div style="font-size:12px;font-weight:600;">' + (_evLabel[e.type] || e.type) + '</div>' +
                '<div style="font-size:11px;color:var(--mt);">' + esc(title) + (e.byCustomer ? ' · ' + esc(e.byCustomer) : '') + ' · ' + (e.ts || '').slice(0, 16).replace('T', ' ') + '</div>' +
              '</div>' +
            '</div>';
          }).join('')
        : '<div style="font-size:12px;color:var(--mt);">Inga kundhändelser i perioden</div>') +
    '</div>';

    return _periodBar(range) +
      _qualityBanner(qualIssues) +
      kpiRow +
      valueRow +
      '<div class="g2" style="gap:12px;margin-bottom:12px;">' +
        statusBars +
        eventsFeed +
      '</div>' +
      custTable;
  }

  /* ══════════════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════════════ */

  function render() {
    var el = document.getElementById('pg-reports-content');
    if (!el) return;

    var tabs = [
      { key: 'oversikt',         label: _ic('layout-dashboard', 12) + ' Översikt'          },
      { key: 'arbetsordrar',     label: _ic('clipboard-list', 12)   + ' Arbetsordrar'      },
      { key: 'tid',              label: _ic('clock', 12)             + ' Tid & personal'   },
      { key: 'avvikelser',       label: _ic('alert-triangle', 12)    + ' Avvikelser'        },
      { key: 'ekonomi',          label: _ic('trending-up', 12)       + ' Ekonomi'           },
      { key: 'material',         label: _ic('package', 12)           + ' Material'          },
      { key: 'serviceintervall', label: _ic('wrench', 12)            + ' Serviceintervall'  },
      { key: 'offerter',         label: _ic('file-text', 12)         + ' Offerter'           }
    ];

    var tabBar = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">' +
      '<div class="ftabs ao-status-tabs" style="flex:1;margin-bottom:0;">' +
      tabs.map(function (t) {
        return '<button class="ft ' + (_tab === t.key ? 'on' : '') + '" onclick="ReportsPage._setTab(\'' + t.key + '\')">' + t.label + '</button>';
      }).join('') +
      '</div>' +
      '<button class="btn bs bsm" id="rep-export-btn" onclick="ReportsPage._exportAll(this)" title="Exportera som XLSX (respekterar vald period)">' +
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
    else if (_tab === 'offerter')         content = _offerter();

    el.innerHTML = tabBar + content;
  }

  /* ── Publika metoder ──────────────────────────────────────────── */

  function _setTab(key) { _tab = key; render(); }

  function _setPeriod(preset) {
    _periodPreset = preset;
    if (preset !== 'custom') { _periodCustomFrom = ''; _periodCustomTo = ''; }
    render();
  }

  function _setCustomFrom(val) { _periodCustomFrom = val; render(); }
  function _setCustomTo(val)   { _periodCustomTo   = val; render(); }

  function _exportAll(btn) {
    if (typeof ImportExportService !== 'undefined') {
      /* Gör aktiv period och flik tillgängliga för exportFn i ImportExportConfigs.report */
      if (typeof IMPORT_EXPORT_CONFIGS !== 'undefined' && IMPORT_EXPORT_CONFIGS.report) {
        IMPORT_EXPORT_CONFIGS.report._currentRange = _periodRange();
        IMPORT_EXPORT_CONFIGS.report._currentTab   = _tab;
      }
      ImportExportService.showExportMenu('report', btn);
    }
  }

  /* Exponera period för exportFn i ImportExportConfigs */
  function getCurrentRange() { return _periodRange(); }

  return {
    render:         render,
    _setTab:        _setTab,
    _setPeriod:     _setPeriod,
    _setCustomFrom: _setCustomFrom,
    _setCustomTo:   _setCustomTo,
    _exportAll:     _exportAll,
    getCurrentRange: getCurrentRange
  };

})();
