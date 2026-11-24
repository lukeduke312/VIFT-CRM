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
/* QA FIX-ROUND 2026-11-12 (K8, confirmed): the report summed `e.duration`,
   a field time entries do not have — they store `minutes` (Schema.timeEntry,
   TimeService, payroll). The hours report therefore always showed 0 h
   (live: 0 h where payroll showed 12,98 h for the same period). Hours now
   come from `minutes / 60`; a legacy/imported entry that only carries a
   numeric `duration` (hours) still counts, exactly as before. */
function _entryHours(e) {
  if (!e) return 0;
  var m = Number(e.minutes);
  if (e.minutes !== undefined && e.minutes !== null && e.minutes !== '' && isFinite(m)) return m / 60;
  return parseFloat(e.duration) || 0;
}

const ReportsPage = (function () {

  var _tab    = 'oversikt';

  /* ── Periodfilter ───────────────────────────────────────────────────
     preset: 'month' | 'prev-month' | 'quarter' | 'year' | '12months' | 'custom'
     För 'custom': _periodCustomFrom och _periodCustomTo sätts separat.
  ─────────────────────────────────────────────────────────────────── */
  var _periodPreset      = 'month';
  var _periodCustomFrom  = '';
  var _periodCustomTo    = '';

  /* V3 2026-11-26 (F-15): periodetiketter i svensk form ("november 2026",
     "Q4 2026", "senaste 12 månaderna") i stället för "nov 26 2026". Samma
     from/to som tidigare — bara etiketten är ändrad (exporten får samma text). */
  function _periodRange() {
    var today = _today();
    var d = new Date();
    var y = d.getFullYear();
    var m = d.getMonth(); // 0-indexed
    if (_periodPreset === 'month') {
      var from = y + '-' + String(m + 1).padStart(2, '0') + '-01';
      var lastDay = new Date(y, m + 1, 0).getDate();
      var to = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');
      return { from: from, to: to, label: _monthLong(from.slice(0, 7)) };
    }
    if (_periodPreset === 'prev-month') {
      var pm = m === 0 ? 11 : m - 1;
      var py = m === 0 ? y - 1 : y;
      var from = py + '-' + String(pm + 1).padStart(2, '0') + '-01';
      var lastDay = new Date(py, pm + 1, 0).getDate();
      var to = py + '-' + String(pm + 1).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');
      return { from: from, to: to, label: _monthLong(from.slice(0, 7)) };
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
      return { from: y + '-01-01', to: y + '-12-31', label: 'år ' + y };
    }
    if (_periodPreset === '12months') {
      var d12 = new Date(); d12.setMonth(d12.getMonth() - 12);
      return { from: d12.toISOString().slice(0, 10), to: today, label: 'senaste 12 månaderna' };
    }
    if (_periodPreset === 'custom' && _periodCustomFrom && _periodCustomTo) {
      return { from: _periodCustomFrom, to: _periodCustomTo, label: _fmtRange(_periodCustomFrom, _periodCustomTo) };
    }
    /* fallback = innevarande månad */
    var from = y + '-' + String(m + 1).padStart(2, '0') + '-01';
    var lastDay = new Date(y, m + 1, 0).getDate();
    return { from: from, to: y + '-' + String(m + 1).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0'), label: _monthLong(from.slice(0, 7)) };
  }

  function _inPeriod(dateStr, range) {
    if (!dateStr || !range) return false;
    var d = dateStr.slice(0, 10);
    return d >= range.from && d <= range.to;
  }

  /* E2E REP-01 (2026-11-23): fakturor i nuvarande datamodell (Schema.invoice)
     saknar `amount` och `invoiceDate` — beloppet räknas från raderna
     (InvoiceService.calcSummary, samma som fakturavyn) och fakturadatum är
     när fakturan skickades. Rapporten läste tidigare de saknade fälten och
     visade "—" för allt fakturerat. Fakturerat = utställda fakturor (ej
     utkast, ej makulerade), belopp exkl. moms efter rabatt; ROT/RUT påverkar
     vad kunden betalar, inte intäkten. Äldre poster med eget `amount` och
     utan rader räknas som förut. Tidposter kopplas till AO via `aoId`. */
  function _invIssued(inv) { return !!inv && inv.status !== 'makulerad' && inv.status !== 'utkast'; }
  function _invDate(inv) {
    return (inv && (inv.invoiceDate || inv.date || inv.sentAt || inv.createdAt) || '').slice(0, 10);
  }
  function _invAmount(inv) {
    if (!inv) return 0;
    var legacy = parseFloat(inv.amount);
    if (!(inv.lines && inv.lines.length) && isFinite(legacy)) return legacy;
    if (typeof InvoiceService !== 'undefined' && InvoiceService.calcSummary) {
      var sm = InvoiceService.calcSummary(inv);
      return (sm && isFinite(sm.exVat)) ? sm.exVat : 0;
    }
    return isFinite(legacy) ? legacy : 0;
  }
  function _invAoIds(inv) {
    var ids = {};
    if (inv && inv.workOrderId) ids[inv.workOrderId] = 1;
    ((inv && inv.lines) || []).forEach(function (l) {
      if (l && l.workOrderId) ids[l.workOrderId] = 1;
      (l && l.sourceRefs || []).forEach(function (r) { if (r && r.workOrderId) ids[r.workOrderId] = 1; });
    });
    return Object.keys(ids);
  }
  function _teAo(e) { return e ? (e.aoId || e.workOrderId || '') : ''; }

  /* ── Helpers ─────────────────────────────────────────────────────── */

  function _ic(name, size) {
    return typeof ic !== 'undefined' ? ic(name, size || 16) : '';
  }

  function _today() {
    return tdy();
  }

  var _MONL = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];

  /* "2026-11" → "nov. 2026" (stapeletiketter per månad, samma månadsform som fmtDate). */
  function _monthLabel(ym) {
    if (!ym || ym.length < 7) return ym || '—';
    var d = new Date(parseInt(ym.slice(0, 4), 10), parseInt(ym.slice(5, 7), 10) - 1, 1);
    return d.toLocaleDateString('sv-SE', { month: 'short', year: 'numeric' });
  }
  /* "2026-11" → "november 2026" (periodetikett). */
  function _monthLong(ym) {
    if (!ym || ym.length < 7) return ym || '—';
    var m = parseInt(ym.slice(5, 7), 10) - 1;
    return (_MONL[m] || '?') + ' ' + ym.slice(0, 4);
  }
  /* "2026-11-24" → "24 nov. 2026" — samma form som globala fmtDate()
     (V3-komponentstandard §10); year:false → "24 nov.". */
  function _fmtDate(iso, opts) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || '—';
    var d = new Date(parseInt(iso.slice(0, 4), 10), parseInt(iso.slice(5, 7), 10) - 1, parseInt(iso.slice(8, 10), 10));
    return d.toLocaleDateString('sv-SE', opts && opts.year === false ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  }
  /* Tidsstämpel → "24 nov 2026 14:30" i lokal tid (tidigare visades
     UTC-klockslaget ur ISO-strängen som om det vore lokal tid). */
  function _fmtTs(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    if (isNaN(d.getTime()) || String(ts).length <= 10) return _fmtDate(String(ts).slice(0, 10));
    var ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return _fmtDate(ymd) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  /* Intervall i kort svensk form: "1–30 nov 2026", "1 okt – 31 dec 2026",
     "24 nov 2025 – 24 nov 2026". */
  function _fmtRange(from, to) {
    if (!from || !to) return (from || '') + ' – ' + (to || '');
    if (from.slice(0, 7) === to.slice(0, 7)) return parseInt(from.slice(8, 10), 10) + '–' + _fmtDate(to);
    if (from.slice(0, 4) === to.slice(0, 4)) return _fmtDate(from, { year: false }) + ' – ' + _fmtDate(to);
    return _fmtDate(from) + ' – ' + _fmtDate(to);
  }
  /* Tal i svensk form ("26,5"); dec = högst antal decimaler. */
  function _fmtNum(n, dec) {
    var v = Number(n) || 0;
    return v.toLocaleString('sv-SE', { minimumFractionDigits: 0, maximumFractionDigits: dec == null ? 1 : dec });
  }
  /* Timmar: decimaltimmar med komma och " h" — samma form som löneunderlaget. */
  function _fmtH(h) { return _fmtNum(h, 1) + ' h'; }
  function _fmtPct(n) { return n == null ? '–' : _fmtNum(n, 0) + ' %'; }
  /* Säkert JS-strängargument i ett onclick-attribut (data-id:n). Attributet
     escapas dessutom som helhet i _bar()/_kpi(). */
  function _jsq(v) {
    return "'" + String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/</g, '\\x3c') + "'";
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

  /* ── KPI-kort (V3, S-02) ─────────────────────────────────────────────
     Samma nyckeltalskort i alla flikar och i löneunderlaget (.ar-kpi i
     v3-admin.css): ikon, etikett, värde, förklaring — i den läsordningen.
     Klickbara kort är knappar (tangentbord + fokusring) och leder till det
     urval de räknar. tone: 'danger' | 'warn' färgar värdet när det kräver
     åtgärd. Värde och etikett escapas; nav är statisk kod. */
  function _kpi(icon, label, val, sub, nav, tone) {
    var tag = nav ? 'button' : 'div';
    var attrs = nav ? ' type="button" onclick="' + esc(nav) + '"' : '';
    return '<' + tag + ' class="ar-kpi' + (nav ? ' is-link' : '') + (tone ? ' tone-' + tone : '') + '"' + attrs + '>' +
      '<span class="ar-kpi-ico" aria-hidden="true">' + _ic(icon, 16) + '</span>' +
      '<span class="ar-kpi-l">' + esc(label) + '</span>' +
      '<span class="ar-kpi-n">' + esc(String(val)) + '</span>' +
      (sub ? '<span class="ar-kpi-s">' + esc(sub) + '</span>' : '') +
    '</' + tag + '>';
  }
  function _kpis(html) { return '<div class="ar-kpis">' + html + '</div>'; }

  /* ── Kort/panel ──────────────────────────────────────────────────── */
  function _panel(icon, title, sub, body, cls) {
    /* V3-komponentstandard §6: .card > .card-header > .card-body. */
    return '<section class="card ar-card' + (cls ? ' ' + cls : '') + '">' +
      '<div class="card-header ar-card-h"><div class="ar-card-ht">' +
        '<h3>' + _ic(icon, 16) + '<span>' + esc(title) + '</span></h3>' +
        (sub ? '<p>' + esc(sub) + '</p>' : '') +
      '</div></div>' +
      '<div class="card-body ar-card-b">' + body + '</div>' +
    '</section>';
  }
  function _grid(html) { return '<div class="ar-grid">' + html + '</div>'; }
  function _empty(msg) { return '<p class="ar-empty">' + esc(msg) + '</p>'; }
  function _lead(html) { return '<p class="rep-lead">' + html + '</p>'; }

  /* ── Stapeldiagram ───────────────────────────────────────────────────
     En serie per kort: en färg (accent) för storlek; semantisk färg bara
     där stapeln betyder status (AO-status, allvarlighet, beläggning,
     försenat). Text i textfärg, aldrig i stapelns färg. Klickbara rader
     är knappar med hela raden som träffyta. */
  function _bar(label, val, max, color, onClick) {
    var num = typeof val === 'number' ? val : parseFloat(String(val).replace(/\s/g, '').replace(',', '.'));
    var pct = max > 0 && isFinite(num) && num > 0 ? Math.max(1, Math.min(100, Math.round((num / max) * 100))) : 0;
    var tag = onClick ? 'button' : 'div';
    var attrs = onClick ? ' type="button" onclick="' + esc(onClick) + '"' : '';
    return '<' + tag + ' class="rep-bar' + (onClick ? ' is-link' : '') + '"' + attrs + '>' +
      '<span class="rep-bar-l">' + esc(String(label)) + (onClick ? _ic('chevron-right', 13) : '') + '</span>' +
      '<span class="rep-bar-v">' + esc(String(val)) + '</span>' +
      '<span class="rep-bar-t" aria-hidden="true"><i style="width:' + pct + '%;background:' + (color || 'var(--accent)') + ';"></i></span>' +
    '</' + tag + '>';
  }
  /* rows: [{key, val}] → staplar. o: {max, color, label(key,row), val(row), nav(key,row), empty} */
  function _bars(rows, o) {
    if (!rows || !rows.length) return _empty(o.empty || 'Inga data');
    return rows.map(function (r) {
      return _bar(o.label ? o.label(r.key, r) : r.key, o.val ? o.val(r) : r.val, o.max, o.color, o.nav ? o.nav(r.key, r) : null);
    }).join('');
  }
  /* Navigering från staplar. ID:n kommer från data → _jsq + esc i _bar().
     Fastighetslänkar gick tidigare till 'pg-property-detail', som inte är
     en sida (gav "Du saknar behörighet"); fastighetskortet är pg-obj-detail. */
  function _toCust(k)   { return k && k !== '—' ? 'Router.showPage(\'pg-crm-detail\',{customerId:' + _jsq(k) + '})' : null; }
  function _toPropAO(k) { return k && k !== '—' ? 'Router.showPage(\'pg-ao\',{propertyId:' + _jsq(k) + '})' : null; }
  function _toProp(k)   { return k && k !== '—' ? 'Router.showPage(\'pg-obj-detail\',{propId:' + _jsq(k) + '})' : null; }
  function _toAO(k)     { return k ? 'Router.showPage(\'pg-ao-detail\',{aoId:' + _jsq(k) + '})' : null; }

  /* ── Datakvalitetsvarning ────────────────────────────────────────────
     issues: array av antingen strängar ELLER {msg: string, items: string[]}
     items renderas som expanderbar <details>-lista (inget JS behövs).
  ──────────────────────────────────────────────────────────────────── */

  function _qualityBanner(issues) {
    if (!issues || !issues.length) return '';
    var rows = issues.map(function (i) {
      if (typeof i === 'string') return '<li>' + esc(i) + '</li>';
      /* Strukturerad: {msg, items[]} → expanderbar detalj */
      var detail = '';
      if (i.items && i.items.length) {
        var listItems = i.items.slice(0, 25).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
        if (i.items.length > 25) listItems += '<li>… och ' + (i.items.length - 25) + ' till</li>';
        detail = '<details class="rep-qd"><summary>Visa poster (' + i.items.length + ')</summary><ul>' + listItems + '</ul></details>';
      }
      return '<li>' + esc(i.msg) + detail + '</li>';
    }).join('');
    return '<div class="ar-note is-warn" role="note">' + _ic('alert-triangle', 16) +
      '<div><strong>Datakvalitet — poster som inte kunnat räknas fullt ut</strong><ul class="rep-ql">' + rows + '</ul></div>' +
    '</div>';
  }

  /* ── Periodväljare (V3 segmenterad kontroll, F-01) ───────────────────
     Tidigare: vald knapp hade vit text på --acc (ljusblå) = 1,1:1 och
     syntes inte. Nu: .ar-seg med vald knapp i --ink på vit yta (>= 15:1),
     aria-pressed för skärmläsare och vald period utskriven i klartext. */
  function _periodBar(range) {
    var presets = [
      { key: 'month',      label: 'Denna månad'   },
      { key: 'prev-month', label: 'Förra månaden' },
      { key: 'quarter',    label: 'Kvartal'       },
      { key: 'year',       label: 'I år'          },
      { key: '12months',   label: '12 månader'    },
      { key: 'custom',     label: 'Eget'          }
    ];
    var html = '<div class="rep-period">' +
      '<div class="ar-seg rep-seg" role="group" aria-label="Period">';
    presets.forEach(function (p) {
      var on = _periodPreset === p.key;
      html += '<button type="button" class="ar-seg-b' + (on ? ' is-on' : '') + '" aria-pressed="' + on + '" ' +
        'onclick="ReportsPage._setPeriod(\'' + p.key + '\')">' + p.label + '</button>';
    });
    html += '</div>';
    if (_periodPreset === 'custom') {
      html += '<div class="rep-custom">' +
        '<label><span>Från</span><input type="date" value="' + esc(_periodCustomFrom) + '" onchange="ReportsPage._setCustomFrom(this.value)"></label>' +
        '<label><span>Till</span><input type="date" value="' + esc(_periodCustomTo) + '" onchange="ReportsPage._setCustomTo(this.value)"></label>' +
      '</div>';
    }
    var custIncomplete = _periodPreset === 'custom' && !(_periodCustomFrom && _periodCustomTo);
    html += '<p class="rep-range">' + _ic('calendar', 14) + '<span>' +
      (custIncomplete ? 'Välj både från- och tilldatum — visar ' + esc(range.label) + ' tills vidare' :
        'Visar <strong>' + esc(range.label) + '</strong>' + (range.label.indexOf('–') === -1 ? ' · ' + esc(_fmtRange(range.from, range.to)) : '')) +
      '</span></p>';
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
    var invs    = (state.invoices || []).filter(function (i) { return _invIssued(i) && _inPeriod(_invDate(i), range); });
    var revPeriod = invs.reduce(function (s, i) { return s + _invAmount(i); }, 0);

    /* Klara AO ej fakturerade — antal (belopp saknar standardvärde utan prissättning) */
    var klar_ej_fak = active.filter(function (a) { return a.status === 'klar' && !a.invoiceId; });

    /* Faktureringsgrad (antal AO) */
    var allKlara     = active.filter(function (a) { return a.status === 'klar' || a.status === 'fakturerad'; });
    var faktureradeCnt = active.filter(function (a) { return a.status === 'fakturerad'; }).length;
    var fakGrad = allKlara.length > 0 ? Math.round((faktureradeCnt / allKlara.length) * 100) : 0;

    /* Timmar i period */
    var timmar = (state.timeEntries || [])
      .filter(function (e) { return _inPeriod(e.date || e.startDate, range); })
      .reduce(function (s, e) { return s + _entryHours(e); }, 0);

    /* Status-fördelning */
    var statusGroups = _groupBy(active.filter(function (a) { return a.status !== 'fakturerad'; }), function (a) { return a.status; });
    var statusOrder  = ['pool', 'planerad', 'pågående', 'klar'];
    var statusColors = { pool: 'var(--violet)', planerad: 'var(--cyan)', pågående: 'var(--warn)', klar: 'var(--ok)' };
    var maxStatus = Math.max.apply(null, statusOrder.map(function (s) { return (statusGroups[s] || []).length; }).concat([1]));

    return _periodBar(range) +
    _kpis(
      _kpi('clipboard-list', 'Öppna AO',            oppna.length,             'aktiva, ej klara',               'Router.showPage(\'pg-ao\',{filter:\'alla\'})') +
      _kpi('check-circle',  'Klara AO',              klara.length,             'ej fakturerade',                 'Router.showPage(\'pg-ao\',{filter:\'klar\'})') +
      _kpi('alert-circle',  'Försenade',             forsen.length,            'passerat planerat datum',        'Router.showPage(\'pg-ao\',{filter:\'forsenad\'})', forsen.length ? 'danger' : '') +
      _kpi('receipt',       'Fakturerat i perioden', revPeriod ? _fmtKr(revPeriod) : '—', 'utställda fakturor exkl. moms (ej utkast/makulerade)', 'ReportsPage._setTab(\'ekonomi\')') +
      _kpi('alert-triangle','Klara ej fakturerade',  klar_ej_fak.length + ' st', 'belopp beräknas ej utan prissättning', 'ReportsPage._setTab(\'ekonomi\')', klar_ej_fak.length ? 'warn' : '') +
      _kpi('percent',       'Andel fakturerade AO',  _fmtPct(fakGrad),         faktureradeCnt + ' av ' + allKlara.length + ' klara · antal-baserat', 'ReportsPage._setTab(\'ekonomi\')') +
      _kpi('clock',         'Registrerad tid',       _fmtH(timmar),            'tidposter i perioden',           'ReportsPage._setTab(\'tid\')') +
      _kpi('alert-triangle','Öppna avvikelser',      avvNoAO.length,           'utan arbetsorder',               'Router.showPage(\'pg-rondering\',{})', avvNoAO.length ? 'warn' : '')
    ) +
    _panel('bar-chart-2', 'AO per status', 'Alla aktiva arbetsordrar som inte är fakturerade — oavsett period',
      statusOrder.map(function (s) {
        var cnt = (statusGroups[s] || []).length;
        return _bar(statusLabel(s), cnt, maxStatus, statusColors[s], 'WorkOrdersPage.setFilter(' + _jsq(s) + ');Router.showPage(\'pg-ao\',{})');
      }).join(''));
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
    _lead('Arbetsordrar med planerat datum (eller skapade) under <strong>' + esc(range.label) + '</strong>. Försenade AO visas oavsett period.') +
    _grid(
      _panel('users', 'AO per kund', 'Topp 10 i perioden', _bars(topCu, { max: maxCu, label: _cuName, nav: _toCust, empty: 'Inga AO i perioden' })) +
      _panel('building-2', 'AO per fastighet', 'Topp 10 i perioden', _bars(topProp, { max: maxProp, label: _propName, nav: _toPropAO, empty: 'Inga AO i perioden' })) +
      _panel('layers', 'AO per objekt', 'Topp 8 i perioden', _bars(topObj, { max: maxObj, label: _objName, empty: 'Inga objektkopplade AO i perioden' })) +
      _panel('user', 'AO per personal', 'Topp 10 i perioden', _bars(topStaff, { max: maxStaff, label: _staffName, empty: 'Inga AO i perioden' }))
    ) +
    _panel('clock', 'Försenade AO per kund', 'Alla perioder', _bars(topLate, { max: maxLate, color: 'var(--danger)', label: _cuName, nav: _toCust, empty: 'Inga försenade AO' }));
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
      return items.reduce(function (s, e) { return s + _entryHours(e); }, 0);
    }).map(function (r) { r.val = Math.round(r.val * 10) / 10; return r; });

    /* Beläggning per person (estimat 160 h/mån) */
    var totalHours = inPeriod.reduce(function (s, e) { return s + _entryHours(e); }, 0);
    var belaggning = Object.keys(byStaff).map(function (sid) {
      var h = byStaff[sid].reduce(function (s, e) { return s + _entryHours(e); }, 0);
      return { staffId: sid, hours: Math.round(h * 10) / 10 };
    }).sort(function (a, b) { return b.hours - a.hours; });
    var maxBel = belaggning.length ? belaggning[0].hours : 1;

    /* Per AO */
    var byAO  = _groupBy(entries.filter(function (e) { return _teAo(e); }), function (e) { return _teAo(e); });
    var topAO = _topN(byAO, 8, function (items) {
      return items.reduce(function (s, e) { return s + _entryHours(e); }, 0);
    }).map(function (r) { r.val = Math.round(r.val * 10) / 10; return r; });

    /* Per fastighet via AO-koppling (alla tider, inte bara period, för total bild) */
    var byPropH = {};
    inPeriod.forEach(function (e) {
      var ao = _teAo(e) ? (state.workOrders || []).find(function (a) { return a.id === _teAo(e); }) : null;
      if (!ao || !ao.propertyId) return;
      byPropH[ao.propertyId] = (byPropH[ao.propertyId] || 0) + _entryHours(e);
    });
    var topPropH  = Object.keys(byPropH).map(function (k) { return { key: k, val: Math.round(byPropH[k] * 10) / 10 }; })
      .sort(function (a, b) { return b.val - a.val; }).slice(0, 8);
    var maxPropH  = topPropH.length  ? topPropH[0].val  : 1;
    var maxStaff  = topStaff.length  ? topStaff[0].val  : 1;
    var maxAO     = topAO.length     ? topAO[0].val     : 1;

    /* Beläggningsfärg: <60% grå, 60–85% grön, 85–100% orange, >100% röd */
    function _belColor(h) {
      var pct = (h / 160) * 100;
      if (pct > 100) return 'var(--danger)';
      if (pct >= 85)  return 'var(--warn)';
      if (pct >= 60)  return 'var(--ok)';
      return 'var(--cyan)';
    }
    var belLegend = '<ul class="rep-legend" aria-label="Färgförklaring">' +
      '<li><i style="background:var(--cyan)"></i>under 60 % låg</li>' +
      '<li><i style="background:var(--ok)"></i>60–85 % normal</li>' +
      '<li><i style="background:var(--warn)"></i>85–100 % hög</li>' +
      '<li><i style="background:var(--danger)"></i>över 100 % överbelastad</li></ul>';

    return _periodBar(range) +
    _qualityBanner(qualIssues) +
    _kpis(
      _kpi('clock',  'Registrerad tid', _fmtH(totalHours), 'tidposter i perioden') +
      _kpi('users',  'Personal aktiv',  belaggning.length + ' st', 'med registrerad tid') +
      _kpi('clipboard-list', 'AO med tid', Object.keys(byAO).length + ' st', 'arbetsordrar med tidspost')
    ) +
    _grid(
      _panel('clock', 'Timmar per personal', 'Registrerade timmar · ' + range.label,
        _bars(topStaff, { max: maxStaff, label: _staffName, val: function (r) { return _fmtH(r.val); }, empty: 'Inga tidsregistreringar i perioden' })) +
      _panel('activity', 'Beläggningsestimat', 'Registrerade timmar mot 160 h/mån (standardvärde) · ' + range.label,
        '<p class="ar-help"><strong>Obs:</strong> faktisk kapacitet varierar per person (sysselsättningsgrad, frånvaro och deltid saknas i beräkningen).</p>' +
        belLegend +
        (belaggning.length ? belaggning.map(function (r) {
          var pct160 = Math.round((r.hours / 160) * 100);
          return _bar(_staffName(r.staffId), _fmtH(r.hours) + ' (' + _fmtPct(pct160) + ')', maxBel, _belColor(r.hours));
        }).join('') : _empty('Inga tidsregistreringar i perioden'))) +
      _panel('clipboard-list', 'Timmar per AO', 'Topp 8, alla perioder — mest tidskrävande arbetsordrar',
        _bars(topAO, { max: maxAO, nav: _toAO, empty: 'Ingen tiddata',
          label: function (k) { var ao = (state.workOrders || []).find(function (a) { return a.id === k; }); return ao ? (k + ' – ' + (ao.title || '').slice(0, 28)) : k; },
          val: function (r) { return _fmtH(r.val); } })) +
      _panel('building-2', 'Timmar per fastighet', 'Summerad tid via AO-koppling · ' + range.label,
        _bars(topPropH, { max: maxPropH, label: _propName, nav: _toPropAO, val: function (r) { return _fmtH(r.val); }, empty: 'Ingen fastighetsdata i perioden' }))
    );
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

    var sevLabel = function (k) { return k === 'ej angiven' ? 'Ej angiven' : cap(k); };
    return _periodBar(range) +
    _qualityBanner(qualIssues) +
    _lead('Öppna avvikelser visas för alla perioder. Allvarlighetsgrad och feltyp gäller <strong>' + esc(range.label) + '</strong>.') +
    _grid(
      _panel('building-2', 'Öppna avvikelser per fastighet', 'Alla perioder', _bars(topProp, { max: maxProp, color: 'var(--danger)', label: _propName, nav: _toProp, empty: 'Inga öppna avvikelser' })) +
      _panel('layers', 'Öppna avvikelser per objekt', 'Topp 8, alla perioder', _bars(topObj, { max: maxObj, color: 'var(--warn)', label: _objName, empty: 'Inga objektkopplade avvikelser' })) +
      _panel('alert-triangle', 'Per allvarlighetsgrad', cap(range.label),
        sevOrder.map(function (s) { return _bar(sevLabel(s), (bySev[s] || []).length, maxSev, sevColors[s]); }).join('')) +
      _panel('tag', 'Avvikelser per feltyp', cap(range.label), _bars(topType, { max: maxType, label: function (k) { return k === '—' ? 'Ej angiven' : cap(k); }, empty: 'Inga avvikelser i perioden' })) +
      _panel('repeat', 'Återkommande mönster', 'Mer än en förekomst · alla perioder',
        _bars(topRecur, { max: maxRecur, color: 'var(--danger)', label: function (k) { return k.split('::').pop() || k; }, empty: 'Inga återkommande mönster ännu' })) +
      _panel('building-2', 'Fastigheter med flest återkommande mönster', 'Unika mönster per fastighet · alla perioder',
        _bars(topRecurProp, { max: maxRProp, color: 'var(--danger)', label: _propName, nav: _toProp, val: function (r) { return r.val + ' mönster'; }, empty: 'Inga data' }))
    );
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
    var fakInvs    = invs.filter(function (i) { return _invIssued(i) && _inPeriod(_invDate(i), range); });
    var totalFak   = fakInvs.reduce(function (s, i) { return s + _invAmount(i); }, 0);
    var totalAllFak = invs.filter(_invIssued)
      .reduce(function (s, i) { return s + _invAmount(i); }, 0);

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
      byCuRev[cid] = (byCuRev[cid] || 0) + _invAmount(inv);
    });
    var topCuRev = Object.keys(byCuRev).map(function (k) { return { key: k, val: byCuRev[k] }; })
      .sort(function (a, b) { return b.val - a.val; }).slice(0, 10);
    var maxCuRev = topCuRev.length ? topCuRev[0].val : 1;

    /* Intäkter per fastighet via AO-koppling (period) */
    var byPropRev = {};
    fakInvs.forEach(function (inv) {
      var aoId = _invAoIds(inv)[0];
      var ao = aoId ? aos.find(function (a) { return a.id === aoId; }) : null;
      var pid = inv.propertyId || (ao && ao.propertyId);
      if (!pid) return;
      byPropRev[pid] = (byPropRev[pid] || 0) + _invAmount(inv);
    });
    var topPropRev = Object.keys(byPropRev).map(function (k) { return { key: k, val: byPropRev[k] }; })
      .sort(function (a, b) { return b.val - a.val; }).slice(0, 8);
    var maxPropRev = topPropRev.length ? topPropRev[0].val : 1;

    /* Intäkter per månad (senaste 12) */
    var monthMap = {};
    invs.filter(_invIssued).forEach(function (inv) {
      var m = _invDate(inv).slice(0, 7);
      if (m) monthMap[m] = (monthMap[m] || 0) + _invAmount(inv);
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
    var noInvLink = fakInvs.filter(function (i) { return !_invAoIds(i).length && !i.propertyId; }).length;
    var qualIssues = [];
    if (noMatPrice) qualIssues.push(noMatPrice + ' materialposter saknar pris (räknas ej i materialkostnad)');
    if (noInvLink)  qualIssues.push({ msg: noInvLink + ' fakturor saknar AO-koppling (visas ej i fastighets-/objektsgraf)', items: fakInvs.filter(function(i){return !_invAoIds(i).length && !i.propertyId;}).map(function(i){ return (i.id||'?') + (_invDate(i) ? ' · ' + _fmtDate(_invDate(i)) : '') + ' · ' + _fmtKr(_invAmount(i)); }) });

    return _periodBar(range) +
    _qualityBanner(qualIssues) +
    _kpis(
      _kpi('trending-up',   'Fakturerat i perioden',    totalFak ? _fmtKr(totalFak) : '—',         'utställda fakturor exkl. moms (ej utkast/makulerade)') +
      _kpi('trending-up',   'Fakturerat totalt',        totalAllFak ? _fmtKr(totalAllFak) : '—',    'exkl. moms, alla perioder') +
      _kpi('percent',       'Andel fakturerade AO',     _fmtPct(fakGrad),                          faktureradeCnt + ' av ' + allKlara.length + ' klara · antal-baserat') +
      _kpi('check-circle',  'Klara ej fakturerade',     klaraEjFak.length + ' AO',                  'belopp beräknas ej utan prissättning',      'Router.showPage(\'pg-ao\',{filter:\'klar\'})', klaraEjFak.length ? 'warn' : '') +
      _kpi('clock',         'Pågående ordrar',          pagaende.length + ' AO',                    'status pågående/planerad · inget belopp',   'Router.showPage(\'pg-ao\',{filter:\'alla\'})') +
      _kpi('package',       'Materialkostnad (totalt)', matCost ? _fmtKr(matCost) : '—',            'exkl. moms, alla AO och perioder') +
      _kpi('trending-up',   'Bidrag före lönekostnad',  bidragForeLonel ? _fmtKr(bidragForeLonel) : '—', 'fakturerat (period) − materialkostnad (totalt) · ej fullständigt TB')
    ) +
    /* Intäktsdefinitionen — samma text som förut, nu ihopfälld under siffrorna. */
    '<details class="ar-def">' +
      '<summary>' + _ic('info', 15) + '<span>Så räknas siffrorna</span>' + _ic('chevron-down', 15) + '</summary>' +
      '<div class="ar-def-b">' +
        '<p><strong>Fakturerat</strong> = utställda fakturor (ej utkast, ej makulerade) med fakturadatum (skickad) i perioden, belopp exkl. moms efter rabatt — samma beräkning som fakturavyn. ROT/RUT minskar vad kunden betalar, inte intäkten.</p>' +
        '<p>Klara ej fakturerade AO och pågående ordervärde visas som <em>antal</em> — belopp kräver summering av material + tid × timpris.</p>' +
        '<p><strong>Andel fakturerade AO (antal-baserat)</strong> = antal AO med status "fakturerad" / (antal AO med status "klar" + "fakturerad"). Inte ett värdebaserat mått — saknar prissättning per AO.</p>' +
      '</div>' +
    '</details>' +
    _panel('calendar', 'Fakturerat per månad', 'Senaste 12 månaderna · summa fakturabelopp exkl. moms (ej utkast/makulerade)',
      months12.map(function (m) {
        return _bar(m.label, m.val ? _fmtKr(m.val) : '0 kr', maxMonthRev);
      }).join('')) +
    _grid(
      _panel('users', 'Fakturerat per kund', 'Exkl. moms · ' + range.label,
        _bars(topCuRev, { max: maxCuRev, label: _cuName, nav: _toCust, val: function (r) { return _fmtKr(r.val); }, empty: 'Inga fakturor i perioden' })) +
      _panel('building-2', 'Fakturerat per fastighet', 'Exkl. moms, via AO-koppling på faktura · ' + range.label,
        _bars(topPropRev, { max: maxPropRev, label: _propName, nav: _toPropAO, val: function (r) { return _fmtKr(r.val); }, empty: 'Ingen fastighetsdata (fakturor saknar AO-koppling)' }))
    ) +
    _panel('alert-circle', 'Klara AO ej fakturerade — per kund', 'Antal AO — belopp kräver summering av material och tid × timpris',
      _bars(topEjFak, { max: maxEjFak, color: 'var(--warn)', label: _cuName, nav: _toCust, val: function (r) { return r.val + ' AO'; }, empty: 'Inga klara ofakturerade AO' }));
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
        '<div class="empty">' + _ic('package', 32) + '<h3>Inget material i perioden</h3><p>Inga prissatta material har registrerats på arbetsordrar under ' + esc(range.label) + '. Välj en längre period ovan.</p></div>';
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
    _kpis(
      _kpi('package',       'Materialkostnad',  _fmtKr(totalMatCost),               'exkl. moms, AO i perioden med prissatta material') +
      _kpi('layers',        'Unika artiklar',   Object.keys(byArt).length + ' st',  'distinkta artikelnamn') +
      _kpi('clipboard-list','AO med material',  aoCosts.length + ' st',             'i perioden, minst en artikel')
    ) +
    _grid(
      _panel('clipboard-list', 'Material per AO', 'Topp 10, exkl. moms · ' + range.label,
        topAO.map(function (r) {
          var label = r.aoId + (r.ao && r.ao.title ? ' – ' + r.ao.title.slice(0, 28) : '');
          return _bar(label, _fmtKr(r.cost), maxAOCost, '', _toAO(r.aoId));
        }).join('')) +
      _panel('tag', 'Vanligaste artiklar', 'Topp 10 efter kostnad exkl. moms · ' + range.label,
        topArt.map(function (r) {
          return _bar(r.key, _fmtKr(r.val) + ' (' + _fmtNum(r.qty, 1) + ' st)', maxArtCost);
        }).join(''))
    ) +
    _panel('users', 'Material per kund', 'Topp 8, exkl. moms · ' + range.label,
      _bars(topCuMat, { max: maxCuMat, label: _cuName, nav: _toCust, val: function (r) { return _fmtKr(r.val); }, empty: 'Inga data' }));
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
      var dagar = function (n) { return n + (n === 1 ? ' dag' : ' dagar'); };
      var badge = diff == null ? '' :
        diff < 0  ? '<span class="bdg bdg-red">' + dagar(Math.abs(diff)) + ' sedan</span>'
        : diff === 0 ? '<span class="bdg bdg-orange">Idag</span>'
        :              '<span class="bdg bdg-grey">Om ' + dagar(diff) + '</span>';
      var nav = _toProp(si._propId);
      return '<button type="button" class="rep-li" onclick="' + esc(nav) + '">' +
        '<span class="rep-li-m">' +
          '<span class="rep-li-t">' + esc(si.name || si._propName) + '</span>' +
          '<span class="rep-li-s">' + esc(si._propName) + (si.nextDate ? ' · ' + esc(_fmtDate(si.nextDate)) : '') + '</span>' +
        '</span>' + badge +
      '</button>';
    }

    return _periodBar(range) +
    _qualityBanner(qualIssues) +
    _lead('Serviceintervall visas oavsett vald period — förfallna och de 20 närmast kommande.') +
    _kpis(
      _kpi('alert-circle', 'Förfallna',  overdue.length + ' st', 'passerat datum, ej klara', null, overdue.length ? 'danger' : '') +
      _kpi('calendar',     'Kommande',   coming.length  + ' st', 'schemalagda framöver') +
      _kpi('wrench',       'Totalt',     allSI.length   + ' st', 'aktiva serviceintervall')
    ) +
    _grid(
      _panel('alert-circle', 'Förfallna serviceintervall', overdue.length + ' st' + (overdue.length > 15 ? ' · visar 15' : ''),
        overdue.length ? '<div class="rep-list">' + overdue.slice(0, 15).map(_siRow).join('') + '</div>' : _empty('Inga förfallna intervall')) +
      _panel('calendar', 'Kommande serviceintervall', 'Närmast först',
        coming.length ? '<div class="rep-list">' + coming.map(_siRow).join('') + '</div>' : _empty('Inga schemalagda intervall'))
    ) +
    _panel('building-2', 'Förfallna per fastighet', 'Topp 8',
      _bars(topOverProp, { max: maxOverProp, color: 'var(--danger)', label: _propName, nav: _toProp, val: function (r) { return r.val + ' st'; }, empty: 'Inga förfallna' }));
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

    /* ── Ekonomiska summeringar ── */
    /* OFFER CORE R1.3 — BLOCKER 1 (motbevis-granskad): R1.2 routed this
       report's value KPIs through _offRawExVat(off), which fixed the
       "recurring line wrongly blended into a one-time sum" bug but
       introduced a DIFFERENT material error — _offRawExVat()
       intentionally EXCLUDES recurring lines (by design), so this
       report's single "Offertvärde"/"Godkänt värde" figures silently
       excluded EVERY recurring contract's value entirely, and used the
       PRE-discount rawExVat rather than the customer's actual committed
       exVatAfterDiscount for the one-time component. A recurring
       commitment and a one-time sale are genuinely different financial
       buckets (kr/mån vs. kr) — pretending they're one "Offertvärde"
       number is itself the bug (see the brief's explicit "do not blend
       18800" requirement). Two separate, canonical helpers replace the
       single _offerTotal(): one for the committed one-time bucket
       (post-discount), one for the recurring monthly bucket — NEVER
       summed together. */
    function _offerOneTimeExVat(o) {
      if (typeof _offerCalcTotals === 'function') return _offerCalcTotals(o).exVatAfterDiscount;
      var lines = (o.lines || []).concat(o.extras || []);
      return lines.reduce(function (s, l) { return s + (Number(l.total) || 0); }, 0);
    }
    function _offerRecurringMonthlyExVat2(o) {
      return typeof _offRecurringMonthlyExVat === 'function' ? _offRecurringMonthlyExVat(o) : 0;
    }
    var oneTimeValue          = offers.reduce(function (s, o) { return s + _offerOneTimeExVat(o); }, 0);
    var approvedOneTimeValue  = offers.filter(function (o) { return o.status === 'godkänd'; })
      .reduce(function (s, o) { return s + _offerOneTimeExVat(o); }, 0);
    var recurringValue         = offers.reduce(function (s, o) { return s + _offerRecurringMonthlyExVat2(o); }, 0);
    var approvedRecurringValue = offers.filter(function (o) { return o.status === 'godkänd'; })
      .reduce(function (s, o) { return s + _offerRecurringMonthlyExVat2(o); }, 0);

    /* ── Statusfördelning (stapeldiagram) ── */
    var statusGroups = [
      { label: 'Utkast',          key: 'utkast',          color: 'var(--neutral)' },
      { label: 'Skickad',         key: 'skickad',         color: 'var(--info)'    },
      { label: 'Öppnad av kund',  key: '_opened',         color: 'var(--cyan)'    },
      { label: 'Ändring begärd',  key: 'ändring-begärd',  color: 'var(--warn)'    },
      { label: 'Godkänd',         key: 'godkänd',         color: 'var(--ok)'      },
      { label: 'Nekad',           key: 'nekad',           color: 'var(--danger)'  }
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
      if (!byCustomer[k]) byCustomer[k] = { total: 0, approved: 0, value: 0, recurringValue: 0 };
      byCustomer[k].total++;
      /* OFFER CORE R1.3 — same fix as the top-level KPIs: one-time
         (post-discount) and recurring monthly are tracked as separate
         fields, never summed into one "value". */
      if (o.status === 'godkänd') {
        byCustomer[k].approved++;
        byCustomer[k].value += _offerOneTimeExVat(o);
        byCustomer[k].recurringValue += _offerRecurringMonthlyExVat2(o);
      }
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
    var kpiRow = _kpis(
      _kpi('file-text',       'Totalt',          total + ' st',            'offerter i perioden') +
      _kpi('send',            'Skickade',         sent + ' st',             'med publik länk') +
      _kpi('eye',             'Öppningsgrad',     _fmtPct(openRate),        'av skickade öppnade av kund') +
      _kpi('check-circle',    'Godkännandegrad',  _fmtPct(approveRate),     'av öppnade godkändes') +
      _kpi('trending-up',     'Konvertering',     _fmtPct(convRate),        'skickad → godkänd') +
      _kpi('clock',           'Svarstid',         avgDays != null ? _fmtNum(avgDays, 1) + ' dagar' : '–', 'genomsnitt öppnad → svar')
    );

    var valueRow = _kpis(
      _kpi('dollar-sign',     'Engångsvärde',                 _fmtKr(oneTimeValue),                    'exkl. moms, efter rabatt — alla offerter i perioden') +
      _kpi('check-square',    'Godkänt engångsvärde',         _fmtKr(approvedOneTimeValue),            'exkl. moms, efter rabatt — godkända offerter') +
      _kpi('repeat',          'Återkommande värde',           _fmtKr(recurringValue) + '/mån',         'exkl. moms — summa kr/mån, aldrig blandat med engångsvärdet') +
      _kpi('repeat',          'Godkänt återkommande',         _fmtKr(approvedRecurringValue) + '/mån', 'exkl. moms — godkända offerters kr/mån') +
      _kpi('clock',           'Inväntar svar',    pending + ' st',          'skickade utan slutgiltigt svar') +
      _kpi('alert-circle',    'Ändring begärd',   changeReq + ' st',        'kund begärt ändring', null, changeReq ? 'warn' : '')
    );

    /* Statusfördelning */
    var statusRows = statusGroups.filter(function (g) { return statusCounts[g.key]; });
    var statusBars = _panel('bar-chart-2', 'Statusfördelning', 'Offerter i perioden per status',
      statusRows.length ? statusRows.map(function (g) {
        return _bar(g.label, (statusCounts[g.key] || 0) + ' st', maxStatus, g.color);
      }).join('') : _empty('Inga offerter i perioden'));

    /* Top kunder — V3-tabell; under 640 px blir varje rad ett kort
       (etikett från data-label) så att tabellen aldrig är bredare än kortet (F-05). */
    var custTable = _panel('users', 'Topp kunder', 'Flest offerter i perioden · värden exkl. moms',
      topCustomers.length
        ? '<div class="ar-scroll"><table class="ar-table rep-cust">' +
            '<thead><tr>' +
              '<th scope="col">Kund</th>' +
              '<th scope="col" class="c-num">Offerter</th>' +
              '<th scope="col" class="c-num">Godkända</th>' +
              '<th scope="col" class="c-num">Godkänt engångsvärde</th>' +
              '<th scope="col" class="c-num">Godkänt återkommande</th>' +
            '</tr></thead><tbody>' +
            topCustomers.map(function (c) {
              return '<tr>' +
                '<td class="c-main" data-label="Kund">' + esc(c.name) + '</td>' +
                '<td class="c-num" data-label="Offerter">' + c.total + '</td>' +
                '<td class="c-num" data-label="Godkända">' + c.approved + '</td>' +
                '<td class="c-num" data-label="Godkänt engångsvärde">' + esc(_fmtKr(c.value)) + '</td>' +
                '<td class="c-num" data-label="Godkänt återkommande">' + (c.recurringValue ? esc(_fmtKr(c.recurringValue)) + '/mån' : '–') + '</td>' +
              '</tr>';
            }).join('') +
          '</tbody></table></div>'
        : _empty('Inga offerter i perioden'));

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
      opened: 'var(--info)', approved: 'var(--ok)', change_requested: 'var(--warn)',
      declined: 'var(--danger)', revoked: 'var(--neutral)', renewed: 'var(--info)'
    };

    var eventsFeed = _panel('activity', 'Senaste kundhändelser', 'Högst 10, nyast först',
      recentEvents.length
        ? '<ul class="rep-feed">' + recentEvents.map(function (e) {
            var off = offers.find(function (o) { return o.id === e.offerId; });
            var title = off ? (off.title || e.offerId) : e.offerId;
            return '<li>' +
              '<i class="rep-dot" style="background:' + (_evColor[e.type] || 'var(--neutral)') + '" aria-hidden="true"></i>' +
              '<span class="rep-li-m">' +
                '<span class="rep-li-t">' + esc(_evLabel[e.type] || e.type) + '</span>' +
                '<span class="rep-li-s">' + esc(title) + (e.byCustomer ? ' · ' + esc(e.byCustomer) : '') + ' · ' + esc(_fmtTs(e.ts)) + '</span>' +
              '</span>' +
            '</li>';
          }).join('') + '</ul>'
        : _empty('Inga kundhändelser i perioden'));

    return _periodBar(range) +
      _qualityBanner(qualIssues) +
      kpiRow +
      '<h4 class="ar-subh">Värde</h4>' +
      valueRow +
      _grid(statusBars + eventsFeed) +
      custTable;
  }

  /* ══════════════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════════════ */

  /* V3 2026-11-26: rapportflikar som segmenterad kontroll (.ftabs) på dator
     och rullista under 640 px — ingen flik ligger dold eller radbryts till
     fyra rader. Sidrubriken finns i toppraden (ingen egen h1, S-03).
     Etiketten escapas, ikonen är betrodd ic()-markup. */
  var _TABS = [
    { key: 'oversikt',         icon: 'layout-dashboard', label: 'Översikt'         },
    { key: 'arbetsordrar',     icon: 'clipboard-list',   label: 'Arbetsordrar'     },
    { key: 'tid',              icon: 'clock',            label: 'Tid & personal'   },
    { key: 'avvikelser',       icon: 'alert-triangle',   label: 'Avvikelser'       },
    { key: 'ekonomi',          icon: 'trending-up',      label: 'Ekonomi'          },
    { key: 'material',         icon: 'package',          label: 'Material'         },
    { key: 'serviceintervall', icon: 'wrench',           label: 'Serviceintervall' },
    { key: 'offerter',         icon: 'file-text',        label: 'Offerter'         }
  ];

  function render() {
    var el = document.getElementById('pg-reports-content');
    if (!el) return;

    var tabBar = '<div class="rep-top">' +
      '<div class="ftabs rep-views" role="group" aria-label="Rapporter">' +
      _TABS.map(function (t) {
        var on = _tab === t.key;
        return '<button type="button" aria-pressed="' + on + '" class="ft' + (on ? ' on' : '') + '" onclick="ReportsPage._setTab(\'' + t.key + '\')">' + _ic(t.icon, 14) + '<span>' + esc(t.label) + '</span></button>';
      }).join('') +
      '</div>' +
      '<label class="rep-view-sel"><span class="sr-only">Välj rapport</span>' +
        '<select class="ar-select" onchange="ReportsPage._setTab(this.value)">' +
          _TABS.map(function (t) { return '<option value="' + t.key + '"' + (_tab === t.key ? ' selected' : '') + '>' + esc(t.label) + '</option>'; }).join('') +
        '</select>' +
      '</label>' +
      '<button type="button" class="btn bs bsm rep-export ar-desk" id="rep-export-btn" onclick="ReportsPage._exportAll(this)" title="Exportera som XLSX (respekterar vald period)">' +
        _ic('download', 14) + '<span>Exportera</span>' +
      '</button>' +
      /* Mobil: sekundära åtgärder i "⋮" (V3-komponentstandard §1/§3). */
      '<div class="ao-overflow-wrap ar-mob">' +
        '<button type="button" class="ibtn ar-more" id="rep-more-btn" aria-label="Fler åtgärder" title="Fler åtgärder" aria-haspopup="true" aria-expanded="false" onclick="aoToggleOverflow(\'rep-more-menu\',this)">' + _ic('more-vertical', 18) + '</button>' +
        '<div class="ao-overflow-menu" id="rep-more-menu" role="menu">' +
          '<button type="button" class="ao-overflow-menu-item" role="menuitem" onclick="aoCloseOverflow();ReportsPage._exportAll(document.getElementById(\'rep-more-btn\'))">' + _ic('download', 14) + '<span>Exportera rapport</span></button>' +
        '</div>' +
      '</div>' +
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

    el.innerHTML = '<div class="rep">' + tabBar + content + '</div>';
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
