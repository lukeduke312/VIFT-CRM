/**
 * ExportCenterPage.js — Exportcenter
 * F4-7: Gemensamt exportgränssnitt för alla register
 *
 * - Välj register, kolumner, format (CSV/XLSX)
 * - Känsliga fält av som standard (kräver objects_sensitive + explicit val)
 * - Exporterar alla poster i valt register
 *
 * V20: Export är en READ-operation. Varje register i IMPORT_EXPORT_CONFIGS kräver
 * nu en explicit, befintlig permission (EXPORT_PERMISSIONS) — annars visas eller
 * exporteras det inte (fail-closed, ingen fallback till admin_manage). Kontrollen
 * körs både i UI (registerlistan filtreras) och i varje handler (_canExportType()),
 * så ett register som saknas i listan kan inte heller nås via direktanrop i Console.
 */

const ExportCenterPage = (function () {

  var _entityType     = 'customer';
  var _format         = 'xlsx';
  var _includeSensitive = false;
  var _selectedCols   = {};   // fieldValue → bool

  /* V30 §3: origin-aware "Tillbaka"-navigation. Sätts av render(params) när
     ExportCenter öppnats från en listsidas "Avancerat exportcenter…"-länk
     (params.sourcePage/sourceLabel, se ImportExportConfigs.showExportMenu).
     Öppnas ExportCenter direkt (t.ex. från sidomenyn) finns ingen
     sourcePage och ingen tillbaka-knapp visas — ingen falsk navigation. */
  var _sourcePage  = null;
  var _sourceLabel = '';

  /* Vilken befintlig permission som krävs för att EXPORTERA respektive register.
     Export är read-only — view-permission används där en sådan finns istället för
     motsvarande *_manage. Register som saknas här kan aldrig exporteras av någon,
     inte ens 'all' (se _canExportType) — lägg till en rad här, gissa inte. */
  var EXPORT_PERMISSIONS = {
    customer:        'customer_manage',
    property:        'customer_manage',
    propertyObject:  'customer_manage',
    customerContact: 'customer_manage',
    serviceInterval: 'customer_manage',   // nästlat i property.serviceIntervals[], targetPage pg-objects
    article:         'article_manage',
    priceGroup:      'article_manage',
    staff:           'staff_view',
    workOrder:       'ao_view_all',       // hela arrayen exporteras — inte ao_view_own
    materialRow:     'ao_view_all',       // nästlat i workOrder.materials[]
    timeEntry:       'payroll_view',
    invoice:         'invoice_view',
    ronderingsmall:  'ao_view_all',
    ronderingPass:   'ao_view_all',
    ronderingSchema: 'ao_view_all',
    avvikelse:       'ao_view_all',       // targetPage pg-rondering
    report:          'reports_view'
  };

  /* Enda källan till sanning för "får denna typ exporteras av inloggad användare".
     Fail-closed: en typ som saknas i EXPORT_PERMISSIONS returnerar alltid false,
     oavsett roll — ingen fallback till admin_manage för okända register. */
  function _canExportType(type) {
    var perm = EXPORT_PERMISSIONS[type];
    if (!perm) return false;
    return typeof Auth !== 'undefined' && Auth.can(perm);
  }

  function _firstAllowedType() {
    var keys = Object.keys(IMPORT_EXPORT_CONFIGS);
    for (var i = 0; i < keys.length; i++) {
      if (_canExportType(keys[i])) return keys[i];
    }
    return null;
  }

  /* V21: register vars data lever nästlad i ett annat register (t.ex.
     customer.contacts[]) har ett eget cfg.exportFn() istället för ett plant
     stateKey — ImportExportService.buildExportRowsForType() hanterar redan detta
     korrekt (samma mekanism som showExportMenu() på varje listsida använder).
     Sådana register har inget meningsfullt per-kolumn-val — fields[] beskriver
     bara vad exportFn redan producerar, det går inte att välja bort enskilda
     kolumner ur en hopslagen exportFn-rad. */
  function _isNested(cfg) {
    return !!(cfg && cfg.exportFn);
  }

  function _ic(name, size) {
    return typeof ic !== 'undefined' ? ic(name, size || 16) : '';
  }

  /* ── Publikt: render ───────────────────────────────────────────────────── */

  function render(params) {
    params = params || {};
    if (params.type && _canExportType(params.type)) _entityType = params.type;
    if (!_canExportType(_entityType)) _entityType = _firstAllowedType();
    _includeSensitive = false;
    _initCols();

    /* Bara en giltig, faktiskt navigerbar sida får sättas som källa —
       aldrig lita blint på ett godtyckligt inkommande värde. */
    _sourcePage  = (params.sourcePage && typeof Router !== 'undefined' && Router.PAGE_TITLES && Router.PAGE_TITLES[params.sourcePage])
      ? params.sourcePage : null;
    _sourceLabel = _sourcePage ? (params.sourceLabel || (Router.PAGE_TITLES[_sourcePage] || {}).title || '') : '';

    var el = document.getElementById('pg-export-center-content');
    if (!el) return;

    if (!_entityType) {
      el.innerHTML = '<div class="empty-state" style="padding:60px 20px;text-align:center;">' +
        _ic('lock', 32) + '<h3 style="margin-top:12px">Inga exporterbara register</h3>' +
        '<p>Du saknar behörighet att exportera något register i systemet.</p></div>';
      return;
    }

    var backBtn = _sourcePage
      ? '<button type="button" class="btn bghost bsm" style="margin-bottom:10px;" onclick="ExportCenterPage._goBack()">' +
          _ic('arrow-left', 13) + ' Tillbaka till ' + esc(_sourceLabel) +
        '</button>'
      : '';

    el.innerHTML =
      '<div style="max-width:640px;margin:0 auto;padding:16px 0;">' +
        backBtn +
        '<h2 style="margin:0 0 4px;display:flex;align-items:center;gap:8px;">' +
          _ic('download', 20) + ' Exportcenter' +
        '</h2>' +
        '<p style="margin:0 0 20px;color:var(--mt);font-size:13px;">' +
          'Välj register, kolumner och format. Känsliga fält är av som standard.' +
        '</p>' +
        '<div id="exc-body"></div>' +
      '</div>';

    _renderBody();
  }

  function _goBack() {
    if (_sourcePage && typeof Router !== 'undefined') Router.showPage(_sourcePage);
  }

  function _initCols() {
    var cfg = ImportExportService.getConfig(_entityType);
    _selectedCols = {};
    if (!cfg || _isNested(cfg)) return;
    (cfg.fields || []).forEach(function (f) {
      if (f.value.charAt(0) === '_') return;
      var isSensitive = (cfg.sensitiveFields || []).indexOf(f.value) !== -1;
      _selectedCols[f.value] = !isSensitive;
    });
  }

  function _renderBody() {
    var el = document.getElementById('exc-body');
    if (!el) return;

    var cfg = ImportExportService.getConfig(_entityType);
    var allCfgKeys = Object.keys(IMPORT_EXPORT_CONFIGS).filter(_canExportType);

    /* Register-väljare */
    var registerOpts = allCfgKeys.map(function (k) {
      var c = IMPORT_EXPORT_CONFIGS[k];
      return '<option value="' + k + '"' + (_entityType === k ? ' selected' : '') + '>' + esc(c.label) + '</option>';
    }).join('');

    var isNested = _isNested(cfg);

    /* Kolumnlista — inte tillämpligt för nästlade/exportFn-register (se _isNested) */
    var colsHtml = '';
    if (cfg && !isNested) {
      var hasSensitive = (cfg.sensitiveFields || []).length > 0;
      (cfg.fields || []).forEach(function (f) {
        if (f.value.charAt(0) === '_') return;
        var isSens = (cfg.sensitiveFields || []).indexOf(f.value) !== -1;
        var checked = _selectedCols[f.value] ? 'checked' : '';
        var disabled = (isSens && !_includeSensitive) ? 'disabled' : '';
        colsHtml +=
          '<label style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer;font-size:13px;">' +
            '<input type="checkbox" ' + checked + ' ' + disabled +
              ' onchange="ExportCenterPage._toggleCol(\'' + f.value + '\',this.checked)" style="width:15px;height:15px;flex-shrink:0;">' +
            '<span>' + esc((f.label || f.value).replace(' *', '')) +
              (isSens ? ' <span style="font-size:10px;color:var(--or);background:color-mix(in srgb, var(--or) 12%, transparent);padding:1px 5px;border-radius:4px;margin-left:2px;">Känsligt</span>' : '') +
            '</span>' +
          '</label>';
      });
    }

    /* Antal valda */
    var selCount = Object.keys(_selectedCols).filter(function (k) { return _selectedCols[k]; }).length;

    el.innerHTML =
      /* Register */
      '<div style="margin-bottom:16px;">' +
        '<label style="display:block;font-size:12px;font-weight:700;color:var(--mt);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em;">Register</label>' +
        '<select style="width:100%;padding:9px 12px;border:1px solid var(--br);border-radius:8px;font-size:14px;background:var(--card);color:var(--text);" ' +
          'onchange="ExportCenterPage._onRegisterChange(this.value)">' +
          registerOpts +
        '</select>' +
      '</div>' +

      /* Format */
      '<div style="margin-bottom:16px;">' +
        '<label style="display:block;font-size:12px;font-weight:700;color:var(--mt);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em;">Format</label>' +
        '<div style="display:flex;gap:8px;">' +
          '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;padding:8px 14px;border:1px solid var(--br);border-radius:8px;' + (_format === 'xlsx' ? 'border-color:var(--acc);background:color-mix(in srgb, var(--acc) 8%, transparent);' : '') + '">' +
            '<input type="radio" name="exc-fmt" value="xlsx" ' + (_format === 'xlsx' ? 'checked' : '') + ' onchange="ExportCenterPage._setFormat(\'xlsx\')" style="accent-color:var(--acc);"> XLSX (Excel)' +
          '</label>' +
          '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;padding:8px 14px;border:1px solid var(--br);border-radius:8px;' + (_format === 'csv' ? 'border-color:var(--acc);background:color-mix(in srgb, var(--acc) 8%, transparent);' : '') + '">' +
            '<input type="radio" name="exc-fmt" value="csv" ' + (_format === 'csv' ? 'checked' : '') + ' onchange="ExportCenterPage._setFormat(\'csv\')" style="accent-color:var(--acc);"> CSV (semikolon)' +
          '</label>' +
        '</div>' +
      '</div>' +

      /* Känsliga fält */
      (cfg && (cfg.sensitiveFields || []).length > 0 && typeof Auth !== 'undefined' && Auth.can('objects_sensitive'))
        ? '<div style="margin-bottom:16px;padding:10px 14px;background:color-mix(in srgb, var(--or) 8%, transparent);border:1px solid color-mix(in srgb, var(--or) 25%, transparent);border-radius:8px;">' +
            '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;">' +
              '<input type="checkbox" ' + (_includeSensitive ? 'checked' : '') +
                ' onchange="ExportCenterPage._toggleSensitive(this.checked)" style="width:15px;height:15px;">' +
              '<span>' + _ic('alert-triangle', 13) + ' <strong>Inkludera känsliga fält</strong> — portkoder, nycklar, lösenord</span>' +
            '</label>' +
          '</div>'
        : '' +

      /* Kolumner — eller, för nästlade/exportFn-register, en förklarande notis */
      (isNested
        ? '<div style="margin-bottom:20px;padding:10px 14px;background:var(--bg);border-radius:8px;font-size:13px;color:var(--mt);display:flex;align-items:center;gap:8px;">' +
            _ic('info', 14) +
            '<span>Detta register har ett fast kolumnformat — alla kolumner ingår automatiskt i exporten.</span>' +
          '</div>'
        : '<div style="margin-bottom:20px;">' +
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">' +
              '<label style="font-size:12px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.05em;flex:1;">Kolumner (' + selCount + ' valda)</label>' +
              '<button class="btn bs bxs" onclick="ExportCenterPage._selectAll(true)" style="font-size:11px;padding:3px 8px;">Välj alla</button>' +
              '<button class="btn bs bxs" onclick="ExportCenterPage._selectAll(false)" style="font-size:11px;padding:3px 8px;">Rensa</button>' +
            '</div>' +
            '<div style="border:1px solid var(--br);border-radius:8px;padding:8px 12px;max-height:280px;overflow-y:auto;">' +
              (colsHtml || '<p style="color:var(--mt);font-size:13px;margin:4px 0;">Inga exporterbara fält.</p>') +
            '</div>' +
          '</div>'
      ) +

      /* Export-knapp */
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
        '<button class="btn bp" onclick="ExportCenterPage._doExport()">' +
          _ic('download', 14) + ' Exportera' +
          (cfg ? ' ' + esc(cfg.label.toLowerCase()) : '') +
        '</button>' +
        '<button class="btn bs" onclick="history.back()">' + _ic('arrow-left', 14) + ' Tillbaka</button>' +
      '</div>';
  }

  /* ── Händelsehanterare ─────────────────────────────────────────────────── */

  function _onRegisterChange(val) {
    if (!_canExportType(val)) {
      if (typeof showToast !== 'undefined') showToast('Du saknar behörighet för det registret.');
      return;
    }
    _entityType = val;
    _initCols();
    _renderBody();
  }

  function _setFormat(fmt) {
    _format = fmt;
    _renderBody();
  }

  function _toggleCol(fieldValue, checked) {
    /* Ett känsligt fält kan inte kryssas i direkt (t.ex. via Console) förbi
       "disabled"-attributet i UI:t utan objects_sensitive. */
    var cfg = ImportExportService.getConfig(_entityType);
    var isSens = !!(cfg && (cfg.sensitiveFields || []).indexOf(fieldValue) !== -1);
    if (isSens && checked && !(typeof Auth !== 'undefined' && Auth.can('objects_sensitive'))) return;
    _selectedCols[fieldValue] = checked;
    /* Uppdatera bara räknaren */
    var selCount = Object.keys(_selectedCols).filter(function (k) { return _selectedCols[k]; }).length;
    var lbl = document.querySelector('[style*="Kolumner ("]');
    if (lbl) lbl.textContent = 'Kolumner (' + selCount + ' valda)';
  }

  function _toggleSensitive(checked) {
    /* Servergrund: _includeSensitive får ALDRIG bli true utan objects_sensitive,
       oavsett vad UI:t skickar in (programmatiskt anrop via Console inräknat). */
    var allowed = typeof Auth !== 'undefined' && Auth.can('objects_sensitive');
    if (checked && !allowed) {
      if (typeof showToast !== 'undefined') showToast('Du saknar behörighet för känsliga fält.');
      checked = false;
    }
    _includeSensitive = checked;
    var cfg = ImportExportService.getConfig(_entityType);
    if (!cfg) return;
    (cfg.sensitiveFields || []).forEach(function (f) {
      _selectedCols[f] = checked;
    });
    _renderBody();
  }

  function _selectAll(val) {
    var cfg = ImportExportService.getConfig(_entityType);
    if (!cfg) return;
    /* Beräknas live (inte bara läst från _includeSensitive) så att känsliga fält
       aldrig kan smygas in i _selectedCols även vid oväntad/manipulerad state. */
    var canSensitive = _includeSensitive && typeof Auth !== 'undefined' && Auth.can('objects_sensitive');
    (cfg.fields || []).forEach(function (f) {
      if (f.value.charAt(0) === '_') return;
      var isSens = (cfg.sensitiveFields || []).indexOf(f.value) !== -1;
      if (isSens && !canSensitive) return;
      _selectedCols[f.value] = val;
    });
    _renderBody();
  }

  function _doExport() {
    if (!_canExportType(_entityType)) {
      if (typeof showToast !== 'undefined') showToast('Du saknar behörighet att exportera detta register.');
      return;
    }
    var cfg = ImportExportService.getConfig(_entityType);
    if (!cfg) return;

    var ts   = new Date().toISOString().slice(0, 10);
    var base = cfg.label.toLowerCase().replace(/[^a-zåäö0-9]+/gi, '-');
    var canSensitive = typeof Auth !== 'undefined' && Auth.can('objects_sensitive');

    /* Nästlade/exportFn-register: återanvänd samma mekanism som showExportMenu()
       redan använder på varje listsida (ImportExportService.buildExportRowsForType),
       istället för state[cfg.stateKey] som alltid är null/tomt för dessa. */
    if (_isNested(cfg)) {
      var nd = ImportExportService.buildExportRowsForType(_entityType, null, { includeSensitive: canSensitive && _includeSensitive });
      if (!nd.rows.length && !nd._sheets) {
        if (typeof showToast !== 'undefined') showToast('Inga poster att exportera.');
        return;
      }
      if (_format === 'csv') {
        ImportExportService.downloadCSV(base + '-' + ts + '.csv', nd.headers, nd.rows);
      } else {
        var sheets   = nd._sheets || [{ name: cfg.label, headers: nd.headers, rows: nd.rows }];
        var filename = nd._filename || (base + '-' + ts + '.xlsx');
        ImportExportService.downloadXLSX(filename, sheets);
      }
      if (typeof showToast !== 'undefined') showToast('Exporterar ' + cfg.label.toLowerCase() + '…');
      return;
    }

    var records = (typeof state !== 'undefined' ? state[cfg.stateKey] : null) || [];
    if (!records.length) {
      if (typeof showToast !== 'undefined') showToast('Inga poster att exportera.');
      return;
    }

    /* Bygg headers + rader med bara valda kolumner (plana stateKey-register).
       Sista skyddsnätet: en känslig kolumn kan aldrig hamna i den faktiska
       exporten utan objects_sensitive, oavsett hur _selectedCols fylldes i. */
    var cols = (cfg.fields || []).filter(function (f) {
      if (f.value.charAt(0) === '_') return false;
      if (!_selectedCols[f.value]) return false;
      var isSens = (cfg.sensitiveFields || []).indexOf(f.value) !== -1;
      if (isSens && !canSensitive) return false;
      return true;
    });

    var headers = cols.map(function (f) { return (f.label || f.value).replace(' *', ''); });
    var rows = records.map(function (rec) {
      return cols.map(function (col) {
        var v = rec[col.value];
        if (v == null) return '';
        if (Array.isArray(v)) return v.length ? String(v.length) + ' poster' : '';
        return String(v);
      });
    });

    if (_format === 'csv') {
      ImportExportService.downloadCSV(base + '-' + ts + '.csv', headers, rows);
    } else {
      ImportExportService.downloadXLSX(base + '-' + ts + '.xlsx', [{ name: cfg.label, headers: headers, rows: rows }]);
    }

    if (typeof showToast !== 'undefined') showToast('Exporterar ' + records.length + ' poster…');
  }

  /* ── Publikt API ───────────────────────────────────────────────────────── */

  return {
    render:           render,
    _onRegisterChange: _onRegisterChange,
    _setFormat:       _setFormat,
    _toggleCol:       _toggleCol,
    _toggleSensitive: _toggleSensitive,
    _selectAll:       _selectAll,
    _doExport:        _doExport,
    _goBack:          _goBack
  };

})();
