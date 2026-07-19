/**
 * ExportCenterPage.js — Exportcenter
 * F4-7: Gemensamt exportgränssnitt för alla register
 *
 * - Välj register, kolumner, format (CSV/XLSX)
 * - Känsliga fält av som standard (kräver admin + explicit val)
 * - Exporterar alla poster i valt register
 */

const ExportCenterPage = (function () {

  var _entityType     = 'customer';
  var _format         = 'xlsx';
  var _includeSensitive = false;
  var _selectedCols   = {};   // fieldValue → bool

  function _ic(name, size) {
    return typeof ic !== 'undefined' ? ic(name, size || 16) : '';
  }

  /* ── Publikt: render ───────────────────────────────────────────────────── */

  function render(params) {
    params = params || {};
    if (params.type) _entityType = params.type;
    _includeSensitive = false;
    _initCols();

    var el = document.getElementById('pg-export-center-content');
    if (!el) return;

    el.innerHTML =
      '<div style="max-width:640px;margin:0 auto;padding:16px 0;">' +
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

  function _initCols() {
    var cfg = ImportExportService.getConfig(_entityType);
    _selectedCols = {};
    if (!cfg) return;
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
    var allCfgKeys = Object.keys(IMPORT_EXPORT_CONFIGS);

    /* Register-väljare */
    var registerOpts = allCfgKeys.map(function (k) {
      var c = IMPORT_EXPORT_CONFIGS[k];
      return '<option value="' + k + '"' + (_entityType === k ? ' selected' : '') + '>' + esc(c.label) + '</option>';
    }).join('');

    /* Kolumnlista */
    var colsHtml = '';
    if (cfg) {
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
      (cfg && (cfg.sensitiveFields || []).length > 0 && typeof Auth !== 'undefined' && Auth.can('admin')
        ? '<div style="margin-bottom:16px;padding:10px 14px;background:color-mix(in srgb, var(--or) 8%, transparent);border:1px solid color-mix(in srgb, var(--or) 25%, transparent);border-radius:8px;">' +
            '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;">' +
              '<input type="checkbox" ' + (_includeSensitive ? 'checked' : '') +
                ' onchange="ExportCenterPage._toggleSensitive(this.checked)" style="width:15px;height:15px;">' +
              '<span>' + _ic('alert-triangle', 13) + ' <strong>Inkludera känsliga fält</strong> — portkoder, nycklar, lösenord</span>' +
            '</label>' +
          '</div>'
        : '') +

      /* Kolumner */
      '<div style="margin-bottom:20px;">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">' +
          '<label style="font-size:12px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.05em;flex:1;">Kolumner (' + selCount + ' valda)</label>' +
          '<button class="btn bs bxs" onclick="ExportCenterPage._selectAll(true)" style="font-size:11px;padding:3px 8px;">Välj alla</button>' +
          '<button class="btn bs bxs" onclick="ExportCenterPage._selectAll(false)" style="font-size:11px;padding:3px 8px;">Rensa</button>' +
        '</div>' +
        '<div style="border:1px solid var(--br);border-radius:8px;padding:8px 12px;max-height:280px;overflow-y:auto;">' +
          (colsHtml || '<p style="color:var(--mt);font-size:13px;margin:4px 0;">Inga exporterbara fält.</p>') +
        '</div>' +
      '</div>' +

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
    _entityType = val;
    _initCols();
    _renderBody();
  }

  function _setFormat(fmt) {
    _format = fmt;
    _renderBody();
  }

  function _toggleCol(fieldValue, checked) {
    _selectedCols[fieldValue] = checked;
    /* Uppdatera bara räknaren */
    var selCount = Object.keys(_selectedCols).filter(function (k) { return _selectedCols[k]; }).length;
    var lbl = document.querySelector('[style*="Kolumner ("]');
    if (lbl) lbl.textContent = 'Kolumner (' + selCount + ' valda)';
  }

  function _toggleSensitive(checked) {
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
    (cfg.fields || []).forEach(function (f) {
      if (f.value.charAt(0) === '_') return;
      var isSens = (cfg.sensitiveFields || []).indexOf(f.value) !== -1;
      if (isSens && !_includeSensitive) return;
      _selectedCols[f.value] = val;
    });
    _renderBody();
  }

  function _doExport() {
    var cfg = ImportExportService.getConfig(_entityType);
    if (!cfg) return;

    var records = (typeof state !== 'undefined' ? state[cfg.stateKey] : null) || [];
    if (!records.length) {
      if (typeof showToast !== 'undefined') showToast('Inga poster att exportera.');
      return;
    }

    /* Bygg headers + rader med bara valda kolumner */
    var cols = (cfg.fields || []).filter(function (f) {
      if (f.value.charAt(0) === '_') return false;
      return _selectedCols[f.value];
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

    var ts   = new Date().toISOString().slice(0, 10);
    var base = cfg.label.toLowerCase().replace(/[^a-zåäö0-9]+/gi, '-');

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
    _doExport:        _doExport
  };

})();
