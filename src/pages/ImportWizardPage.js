/**
 * ImportWizardPage.js — Generisk 6-stegsguide för import
 * F4-1: Gjord generisk — stöder alla register via IMPORT_EXPORT_CONFIGS
 * F4-6: Diff/conflict-UI — per-fält before/after, ångra-dialog med konfliktstöd
 *
 * Steg 1: Välj fil (drag-and-drop eller klicka, CSV / XLSX)
 * Steg 2: Förhandsgranskning (5 rader, välj profil)
 * Steg 3: Kolumnmatchning (auto-förslag, "Importera inte")
 * Steg 4: Validering och dubblettdetektering
 * Steg 5: Bekräftelse (sammanfattning + konfliktlösning)
 * Steg 6: Resultat (logg, ångra)
 *
 * V19: Kräver den permission som styr respektive register (se TYPE_PERMISSIONS),
 * inte längre den ogiltiga 'admin'-strängen. ImportExportService, ImportExportConfigs.
 */

const ImportWizardPage = (function () {

  /* ── Intern state ─────────────────────────────────────────────────────── */

  var _step            = 1;
  var _file            = null;
  var _rawParsed       = null;   // { headers, rows }
  var _mapping         = {};     // header → fieldName | null
  var _validated       = [];     // [{ rowIndex, row, mapped, resolved, status, duplicate, errors, relationsLog, needsRelation }]
  var _conflicts       = {};     // rowIndex → 'skip' | 'create' | 'update'
  var _relChoices      = {};     // 'rowIndex:targetField' → chosenId (disambiguation)
  var _lastLogId       = null;
  var _entityType      = 'customer';
  var _caps            = null;   // checkCapabilities() result
  var _validationTime  = null;   // ISO timestamp när steg 4 kördes (för konfliktsdetektering)

  /* Vilken permission som krävs för att importera respektive register.
     Okänd/ej listad typ faller tillbaka på admin_manage (säker default). */
  var TYPE_PERMISSIONS = {
    customer:       'customer_manage',
    property:       'customer_manage',
    propertyObject: 'customer_manage',
    article:        'article_manage',
    priceGroup:     'article_manage',
    staff:          'staff_manage',
    workOrder:      'ao_edit',
    timeEntry:      'payroll_manage',
    ronderingsmall: 'ao_edit',
    ronderingPass:  'ao_edit'
  };

  var STEPS = [
    'Välj fil', 'Förhandsgranskning', 'Kolumnmatchning',
    'Validering', 'Bekräftelse', 'Resultat'
  ];

  function _ic(name, size) {
    return typeof ic !== 'undefined' ? ic(name, size || 16) : '';
  }

  /* ── Render ──────────────────────────────────────────────────────────── */

  function render(params) {
    params = params || {};
    _entityType = params.type || 'customer';
    _caps = ImportExportService.checkCapabilities();

    var el = document.getElementById('pg-import-wizard-content');
    if (!el) return;

    var _requiredPerm = TYPE_PERMISSIONS[_entityType] || 'admin_manage';
    if (typeof Auth !== 'undefined' && !Auth.can(_requiredPerm)) {
      el.innerHTML = '<div class="empty-state" style="padding:60px 20px;text-align:center;">' +
        _ic('lock', 32) + '<h3 style="margin-top:12px">Åtkomst nekad</h3>' +
        '<p>Du saknar behörighet att importera detta register.</p></div>';
      return;
    }

    var cfg = ImportExportService.getConfig(_entityType);
    if (!cfg) {
      el.innerHTML = '<div class="ibox">Okänd registertyp: ' + esc(_entityType) + '</div>';
      return;
    }

    _step       = 1;
    _file       = null;
    _rawParsed  = null;
    _mapping    = {};
    _validated  = [];
    _conflicts  = {};
    _relChoices = {};
    _lastLogId  = null;

    el.innerHTML = _html(cfg);
    _bindEvents();
    _renderStep();
  }

  function _html(cfg) {
    return '<div class="imp-wizard">' +
      '<div class="imp-wizard-header">' +
        '<h2 style="margin:0 0 4px">' + _ic('upload', 20) + ' Importera ' + esc(cfg.label) + '</h2>' +
        '<p style="margin:0;color:var(--text-muted);font-size:13px">' +
          'Importera ' + esc(cfg.label.toLowerCase()) + ' från CSV- eller XLSX-fil.' +
          (_caps && !_caps.xlsxRead ? ' <strong style="color:var(--orange)">OBS: XLSX-import stöds inte av din webbläsare — använd CSV.</strong>' : '') +
        '</p>' +
      '</div>' +
      '<nav class="imp-steps" id="imp-steps">' + _stepsHtml() + '</nav>' +
      '<div class="imp-body" id="imp-body"></div>' +
      '<div class="imp-footer" id="imp-footer"></div>' +
    '</div>';
  }

  function _stepsHtml() {
    return STEPS.map(function (s, i) {
      var n   = i + 1;
      var cls = 'imp-step';
      if (n < _step)       cls += ' imp-step-done';
      else if (n === _step) cls += ' imp-step-active';
      return '<div class="' + cls + '">' +
        '<span class="imp-step-num">' + (n < _step ? _ic('check', 12) : n) + '</span>' +
        '<span class="imp-step-label">' + s + '</span>' +
      '</div>';
    }).join('');
  }

  function _renderStep() {
    var nav = document.getElementById('imp-steps');
    if (nav) nav.innerHTML = _stepsHtml();

    var body = document.getElementById('imp-body');
    var foot = document.getElementById('imp-footer');
    if (!body || !foot) return;

    var bodyFn = [null, _step1, _step2, _step3, _step4, _step5, _step6][_step];
    body.innerHTML = bodyFn ? bodyFn() : '';
    foot.innerHTML = _footerHtml();
    _bindStepEvents();
  }

  function _footerHtml() {
    if (_step === 6) return '';
    var prev = _step > 1 && _step < 6
      ? '<button class="btn btn-ghost" onclick="ImportWizardPage._back()">' + _ic('arrow-left', 14) + ' Tillbaka</button>'
      : '';
    var next = '';
    if (_step === 1) next = '<button class="btn btn-primary" onclick="ImportWizardPage._parseFile()" id="imp-btn-next" disabled>Nästa</button>';
    else if (_step === 2) next = '<button class="btn btn-primary" onclick="ImportWizardPage._toStep3()">Nästa ' + _ic('arrow-right', 14) + '</button>';
    else if (_step === 3) next = '<button class="btn btn-primary" onclick="ImportWizardPage._toStep4()">Validera ' + _ic('arrow-right', 14) + '</button>';
    else if (_step === 4) next = '<button class="btn btn-primary" onclick="ImportWizardPage._toStep5()">Gå vidare ' + _ic('arrow-right', 14) + '</button>';
    else if (_step === 5) next = '<button class="btn btn-primary" onclick="ImportWizardPage._runImport()">' + _ic('upload', 14) + ' Importera</button>';
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:16px 0;">' + prev + next + '</div>';
  }

  /* ── Steg 1: Välj fil ────────────────────────────────────────────────── */

  function _step1() {
    var accept = (_caps && !_caps.xlsxRead) ? '.csv' : '.csv,.xlsx';
    return '<div class="imp-drop-zone" id="imp-drop" onclick="document.getElementById(\'imp-file-input\').click()">' +
      '<input type="file" id="imp-file-input" accept="' + accept + '" style="display:none" onchange="ImportWizardPage._onFileInput(event)">' +
      '<div style="text-align:center;padding:40px 20px;">' +
        '<div style="color:var(--text-muted);margin-bottom:12px">' + _ic('upload-cloud', 40) + '</div>' +
        '<p style="font-size:15px;font-weight:600;margin:0 0 4px">Dra och släpp fil här</p>' +
        '<p style="color:var(--text-muted);font-size:13px;margin:0">eller klicka för att välja fil</p>' +
        '<p style="color:var(--text-muted);font-size:12px;margin:12px 0 0">' +
          ((_caps && !_caps.xlsxRead) ? 'CSV (semikolon/komma) · max 10 MB' : 'CSV (semikolon/komma) och XLSX stöds · max 10 MB') +
        '</p>' +
      '</div>' +
    '</div>' +
    '<div id="imp-file-info" style="margin-top:12px;min-height:24px"></div>';
  }

  function _onFileInput(e) {
    var f = e.target.files && e.target.files[0];
    if (f) _setFile(f);
  }

  function _setFile(f) {
    if (f.size > 10 * 1024 * 1024) {
      _showFileInfo('Filen är för stor (max 10 MB).', 'error');
      return;
    }
    var ext = (f.name.split('.').pop() || '').toLowerCase();
    if (ext !== 'csv' && ext !== 'xlsx') {
      _showFileInfo('Filformatet stöds inte. Använd CSV eller XLSX.', 'error');
      return;
    }
    if (ext === 'xlsx' && _caps && !_caps.xlsxRead) {
      _showFileInfo('XLSX stöds inte av din webbläsare. Använd CSV.', 'error');
      return;
    }
    _file = f;
    _showFileInfo(_ic('file', 14) + ' ' + esc(f.name) + ' (' + _fmtSize(f.size) + ')', 'ok');
    var btn = document.getElementById('imp-btn-next');
    if (btn) btn.disabled = false;
    var dz = document.getElementById('imp-drop');
    if (dz) dz.classList.add('imp-drop-active');
  }

  function _showFileInfo(msg, type) {
    var el = document.getElementById('imp-file-info');
    if (!el) return;
    el.innerHTML = '<p style="color:' + (type === 'error' ? 'var(--red)' : 'var(--green)') +
      ';font-size:13px;margin:0">' + msg + '</p>';
  }

  function _fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  async function _parseFile() {
    if (!_file) return;
    var btn = document.getElementById('imp-btn-next');
    if (btn) { btn.disabled = true; btn.textContent = 'Läser...'; }

    try {
      var ext = (_file.name.split('.').pop() || '').toLowerCase();
      if (ext === 'csv') {
        var text = await _readText(_file);
        _rawParsed = ImportExportService.parseCSV(text);
      } else {
        var buf = await _readArrayBuffer(_file);
        _rawParsed = await ImportExportService.parseXLSX(buf);
      }

      if (!_rawParsed || !_rawParsed.headers || _rawParsed.headers.length === 0) {
        _showFileInfo('Filen verkar tom eller kunde inte läsas.', 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Nästa'; }
        return;
      }

      _mapping = ImportExportService.autoMatchColumns(_rawParsed.headers, _entityType);
      _step = 2;
      _renderStep();
    } catch (e) {
      _showFileInfo('Fel vid läsning: ' + e.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Nästa'; }
    }
  }

  function _readText(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function (e) { resolve(e.target.result); };
      r.onerror = function () { reject(new Error('Läsfel')); };
      r.readAsText(file, 'utf-8');
    });
  }

  function _readArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function (e) { resolve(e.target.result); };
      r.onerror = function () { reject(new Error('Läsfel')); };
      r.readAsArrayBuffer(file);
    });
  }

  /* ── Steg 2: Förhandsgranskning ──────────────────────────────────────── */

  function _step2() {
    var h        = _rawParsed.headers;
    var rows     = _rawParsed.rows.slice(0, 5);
    var totalRows = _rawParsed.rows.length;

    // Bokio-knapp bara för kunder
    var bokioBtn = _entityType === 'customer'
      ? '<button class="btn btn-ghost btn-sm" onclick="ImportWizardPage._applyBokioProfile()">' + _ic('zap', 14) + ' Bokio-profil</button>'
      : '';

    var html = '<div style="margin-bottom:16px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
      '<div><strong>' + totalRows + ' rader</strong> · ' + h.length + ' kolumner</div>' +
      bokioBtn +
    '</div>' +
    '<div style="overflow-x:auto">' +
    '<table class="imp-preview-table">' +
    '<thead><tr>' + h.map(function (col) { return '<th>' + esc(col) + '</th>'; }).join('') + '</tr></thead>' +
    '<tbody>';

    rows.forEach(function (row) {
      html += '<tr>' + h.map(function (_, ci) {
        var v = row[ci] != null ? row[ci] : '';
        return '<td title="' + esc(v) + '">' + esc(v.length > 40 ? v.slice(0, 40) + '…' : v) + '</td>';
      }).join('') + '</tr>';
    });

    if (totalRows > 5) {
      html += '<tr><td colspan="' + h.length + '" style="text-align:center;color:var(--text-muted);font-size:12px">… och ' + (totalRows - 5) + ' rader till</td></tr>';
    }

    html += '</tbody></table></div>';
    return html;
  }

  function _applyBokioProfile() {
    var profile = ImportExportService.BOKIO_PROFILE;
    _rawParsed.headers.forEach(function (h) {
      if (profile.mappings[h]) _mapping[h] = profile.mappings[h];
    });
    _step = 3;
    _renderStep();
  }

  function _toStep3() {
    _step = 3;
    _renderStep();
  }

  /* ── Steg 3: Kolumnmatchning ─────────────────────────────────────────── */

  function _step3() {
    var fields = ImportExportService.getFieldsForType(_entityType);
    var showBokio = _entityType === 'customer';

    var html = '<div style="margin-bottom:16px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
      '<button class="btn btn-ghost btn-sm" onclick="ImportWizardPage._applyAutoMatch()">' +
        _ic('cpu', 14) + ' Auto-matcha' +
      '</button>' +
      (showBokio
        ? '<button class="btn btn-ghost btn-sm" onclick="ImportWizardPage._applyBokioProfile()">' + _ic('zap', 14) + ' Bokio-profil</button>'
        : '') +
      '<span style="color:var(--text-muted);font-size:12px;margin-left:auto">* = obligatoriskt fält</span>' +
    '</div>' +
    '<div class="imp-mapping-grid">';

    _rawParsed.headers.forEach(function (h) {
      var selected = _mapping[h] || '';
      html += '<div class="imp-mapping-row">' +
        '<div class="imp-mapping-col-name" title="' + esc(h) + '">' + esc(h.length > 28 ? h.slice(0, 28) + '…' : h) + '</div>' +
        '<div class="imp-mapping-arrow">' + _ic('arrow-right', 12) + '</div>' +
        '<select class="imp-mapping-select" data-col="' + esc(h) + '" onchange="ImportWizardPage._onMappingChange(this)">' +
          '<option value="">— Importera inte —</option>' +
          fields.map(function (f) {
            return '<option value="' + f.value + '"' + (selected === f.value ? ' selected' : '') + '>' + esc(f.label) + '</option>';
          }).join('') +
        '</select>' +
        _sampleValue(h) +
      '</div>';
    });

    html += '</div>';
    return html;
  }

  function _sampleValue(header) {
    if (!_rawParsed || !_rawParsed.rows || !_rawParsed.rows.length) return '';
    var hi = _rawParsed.headers.indexOf(header);
    if (hi < 0) return '';
    var v = '';
    for (var i = 0; i < Math.min(3, _rawParsed.rows.length); i++) {
      if (_rawParsed.rows[i][hi]) { v = _rawParsed.rows[i][hi]; break; }
    }
    if (!v) return '<span style="color:var(--text-muted);font-size:11px">(tom)</span>';
    return '<span class="imp-sample" title="' + esc(v) + '">' + esc(v.length > 22 ? v.slice(0, 22) + '…' : v) + '</span>';
  }

  function _onMappingChange(sel) {
    var col = sel.getAttribute('data-col');
    _mapping[col] = sel.value || null;
  }

  function _applyAutoMatch() {
    _mapping = ImportExportService.autoMatchColumns(_rawParsed.headers, _entityType);
    _renderStep();
  }

  function _toStep4() {
    // Kontrollera att minst ett obligatoriskt fält är mappat
    var cfg = ImportExportService.getConfig(_entityType);
    var requiredFields = (cfg ? cfg.fields : []).filter(function (f) { return f.required; });
    var mappedValues = Object.values(_mapping).filter(Boolean);

    var missing = requiredFields.filter(function (f) {
      return f.value.charAt(0) !== '_' && mappedValues.indexOf(f.value) === -1;
    });

    if (missing.length) {
      _showError('imp-body', 'Obligatoriska fält saknas: ' + missing.map(function (f) { return f.label.replace(' *', ''); }).join(', '));
      return;
    }

    _step = 4;
    _validationTime = new Date().toISOString();
    _validated = ImportExportService.validateImportRowsForType(_rawParsed, _mapping, _entityType);
    // Sätt defaultkonfliktval
    _validated.forEach(function (v) {
      var ri = v.rowIndex - 2;
      if (v.status === 'duplicate' && !_conflicts[ri]) _conflicts[ri] = 'update';
    });
    _renderStep();
  }

  function _showError(containerId, msg) {
    var el = document.getElementById(containerId);
    if (!el) return;
    var old = el.querySelector('.imp-error-banner');
    if (old) old.remove();
    var div = document.createElement('div');
    div.className = 'imp-error-banner';
    div.innerHTML = _ic('alert-circle', 14) + ' ' + esc(msg);
    el.insertBefore(div, el.firstChild);
  }

  /* ── Steg 4: Validering och dubblettdetektering ──────────────────────── */

  function _step4() {
    var stats = { ok: 0, dup: 0, err: 0 };
    _validated.forEach(function (v) {
      if (v.status === 'new')       stats.ok++;
      else if (v.status === 'duplicate') stats.dup++;
      else                               stats.err++;
    });

    var html = '<div class="imp-stats-row">' +
      _statChip(stats.ok,  'Nya',        'green') +
      _statChip(stats.dup, 'Dubbletter', 'orange') +
      _statChip(stats.err, 'Fel',        'red') +
    '</div>';

    if (stats.err > 0) {
      html += '<div class="imp-section-title">Rader med fel (hoppas över automatiskt)</div>' +
        '<div class="imp-row-list">';
      _validated.filter(function (v) { return v.status === 'error'; }).forEach(function (v) {
        html += '<div class="imp-row-item imp-row-error">' +
          '<span class="imp-row-num">Rad ' + v.rowIndex + '</span>' +
          '<span class="imp-row-name">' + esc(v.mapped.name || v.mapped.firstName || '(tomt)') + '</span>' +
          '<span class="imp-row-msg">' + v.errors.join(', ') + '</span>' +
        '</div>';
      });
      html += '</div>';
    }

    if (stats.dup > 0) {
      html += '<div class="imp-section-title" style="margin-top:16px">Dubbletter — välj åtgärd per rad</div>' +
        '<div class="imp-row-list">';
      _validated.filter(function (v) { return v.status === 'duplicate'; }).forEach(function (v) {
        var ri     = v.rowIndex - 2;
        var action = _conflicts[ri] || 'update';
        html += '<div class="imp-row-item imp-row-dup" style="flex-direction:column;align-items:stretch;">' +
          '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
            '<span class="imp-row-num">Rad ' + v.rowIndex + '</span>' +
            '<span class="imp-row-name">' + esc(v.mapped.name || v.mapped.firstName || '') + '</span>' +
            '<span class="imp-row-match bdg bdg-orange">' + esc(v.duplicate.match) + '</span>' +
            '<span class="imp-row-actions" style="margin-left:auto;">' +
              '<select class="imp-conflict-sel" data-ri="' + ri + '" onchange="ImportWizardPage._onConflict(this)">' +
                ['skip', 'update', 'create'].map(function (opt) {
                  var labels = { skip: 'Hoppa över', update: 'Uppdatera befintlig', create: 'Skapa ny' };
                  return '<option value="' + opt + '"' + (action === opt ? ' selected' : '') + '>' + labels[opt] + '</option>';
                }).join('') +
              '</select>' +
            '</span>' +
          '</div>' +
          '<details style="margin-top:4px;">' +
            '<summary style="cursor:pointer;font-size:11px;color:var(--mt);padding:2px 0;user-select:none;">' +
              _ic('git-branch', 11) + ' Visa fältändringar' +
            '</summary>' +
            _diffHtml(v) +
          '</details>' +
        '</div>';
      });
      html += '</div>';
    }

    /* ── Ambiguösa relationer — kräver manuellt val ──────────────────── */
    var ambigRows = _validated.filter(function (v) { return v.needsRelation; });
    if (ambigRows.length > 0) {
      html += '<div class="imp-section-title" style="margin-top:16px">' +
        _ic('git-merge', 14) + ' Ambiguösa relationer — välj rätt post manuellt' +
      '</div>' +
      '<div class="imp-row-list">';

      ambigRows.forEach(function (v) {
        var ambigs = (v.relationsLog || []).filter(function (l) { return l.quality === 'ambiguous'; });
        html += '<div class="imp-row-item" style="flex-direction:column;align-items:stretch;gap:8px;">' +
          '<div style="display:flex;align-items:center;gap:6px;">' +
            '<span class="imp-row-num">Rad ' + v.rowIndex + '</span>' +
            '<span class="imp-row-name">' + esc(v.mapped.name || v.mapped.firstName || '') + '</span>' +
          '</div>';

        ambigs.forEach(function (log) {
          var key    = v.rowIndex + ':' + log.targetField;
          var chosen = _relChoices[key] || '';
          html += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-left:8px;">' +
            '<span style="font-size:12px;min-width:90px;color:var(--text-muted);">' + esc(log.label) + ':</span>' +
            '<span style="font-size:11px;color:var(--mt);">"' + esc(log.refValue) + '" — ' + log.candidates.length + ' träffar</span>' +
            '<select style="font-size:12px;border:1px solid var(--brd);border-radius:6px;padding:4px 8px;background:var(--card);" ' +
              'onchange="ImportWizardPage._onRelChoice(\'' + key + '\',this.value)">' +
              '<option value="">— Välj —</option>' +
              log.candidates.map(function (c) {
                var n = (c.item.name || ((c.item.firstName||'') + ' ' + (c.item.lastName||'')).trim() || c.id);
                return '<option value="' + c.id + '"' + (chosen === c.id ? ' selected' : '') + '>' + esc(n) + ' (' + c.id + ')</option>';
              }).join('') +
            '</select>' +
            (log.required
              ? '<span style="color:var(--red);font-size:11px;font-weight:600;">Krävs</span>'
              : '<span style="color:var(--mt);font-size:11px;">Valfri</span>') +
          '</div>';
        });

        html += '</div>';
      });

      html += '</div>';
    }

    if (stats.ok === 0 && stats.dup === 0 && ambigRows.length === 0) {
      html += '<div class="empty-state" style="padding:30px;text-align:center;">' +
        _ic('alert-circle', 24) + '<p>Inga importerbara rader hittades.</p></div>';
    }

    return html;
  }

  function _statChip(n, label, color) {
    var colors = { green: 'var(--green)', orange: 'var(--orange)', red: 'var(--red)', sky: 'var(--sky)' };
    return '<div class="imp-stat-chip" style="border-color:' + (colors[color] || 'var(--text-muted)') + '">' +
      '<span style="font-size:22px;font-weight:800;color:' + (colors[color] || 'var(--text-muted)') + '">' + n + '</span>' +
      '<span style="color:var(--text-muted);font-size:12px">' + label + '</span>' +
    '</div>';
  }

  function _onConflict(sel) {
    var ri = parseInt(sel.getAttribute('data-ri'), 10);
    _conflicts[ri] = sel.value;
  }

  function _onRelChoice(key, chosenId) {
    if (chosenId) _relChoices[key] = chosenId;
    else delete _relChoices[key];
  }

  function _diffHtml(v) {
    var cfg = ImportExportService.getConfig(_entityType);
    if (!cfg || !v.duplicate) return '';
    var existing = v.duplicate.item;
    var proposed = v.resolved || {};
    var rows = [];
    (cfg.fields || []).forEach(function (f) {
      if (!f.value || f.value.charAt(0) === '_') return;
      var oldVal = existing[f.value];
      var newVal = proposed[f.value];
      if (newVal === '' || newVal == null) return;
      if (String(oldVal || '') === String(newVal)) return;
      rows.push({ label: (f.label || f.value).replace(' *', ''), oldVal: oldVal != null ? oldVal : '(tomt)', newVal: newVal });
    });
    if (!rows.length) {
      return '<p style="font-size:11px;color:var(--mt);margin:4px 0 0">' + _ic('check', 12) + ' Inga fältskillnader.</p>';
    }
    return '<div style="overflow-x:auto;margin-top:6px">' +
      '<table style="width:100%;border-collapse:collapse;font-size:11px;">' +
      '<thead><tr>' +
        '<th style="text-align:left;padding:3px 6px;color:var(--mt);font-weight:600;border-bottom:1px solid var(--br)">Fält</th>' +
        '<th style="text-align:left;padding:3px 6px;color:var(--mt);font-weight:600;border-bottom:1px solid var(--br)">Nuvarande</th>' +
        '<th style="text-align:left;padding:3px 6px;color:var(--mt);font-weight:600;border-bottom:1px solid var(--br)">Från fil</th>' +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr>' +
          '<td style="padding:3px 6px;color:var(--mt)">' + esc(r.label) + '</td>' +
          '<td style="padding:3px 6px;color:var(--rd);text-decoration:line-through;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(String(r.oldVal)) + '</td>' +
          '<td style="padding:3px 6px;color:var(--gr);font-weight:600;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(String(r.newVal)) + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>';
  }

  function _toStep5() {
    /* Blockera om obligatoriska ambiguösa relationer är olösta */
    var missing = [];
    _validated.forEach(function (v) {
      (v.relationsLog || []).forEach(function (log) {
        if (log.quality === 'ambiguous' && log.required) {
          var key = v.rowIndex + ':' + log.targetField;
          if (!_relChoices[key]) {
            missing.push('Rad ' + v.rowIndex + ': ' + log.label);
          }
        }
      });
    });
    if (missing.length) {
      _showError('imp-body', 'Välj relation för: ' + missing.slice(0, 3).join(', ') + (missing.length > 3 ? ' …' : ''));
      return;
    }
    _step = 5;
    _renderStep();
  }

  /* ── Steg 5: Bekräftelse ─────────────────────────────────────────────── */

  function _step5() {
    var toCreate = 0, toUpdate = 0, toSkip = 0;

    _validated.forEach(function (v) {
      var ri = v.rowIndex - 2;
      if (v.status === 'error')     { toSkip++; return; }
      if (v.status === 'new')       { toCreate++; return; }
      var action = _conflicts[ri] || 'update';
      if (action === 'skip')        toSkip++;
      else if (action === 'update') toUpdate++;
      else if (action === 'create') toCreate++;
    });

    var cfg = ImportExportService.getConfig(_entityType);
    var html = '<div style="margin-bottom:24px;">' +
      '<p style="font-size:14px;margin:0 0 16px">Granskat <strong>' + _validated.length + '</strong> rader i ' + esc((cfg && cfg.label) || _entityType) + '. Klicka <strong>Importera</strong> för att genomföra.</p>' +
      '<div class="imp-confirm-summary">' +
        _confirmRow(_ic('user-plus', 14), toCreate, 'Skapas',      'var(--green)') +
        _confirmRow(_ic('edit', 14),      toUpdate, 'Uppdateras',  'var(--sky)') +
        _confirmRow(_ic('skip-forward', 14), toSkip, 'Hoppas över', 'var(--text-muted)') +
      '</div>' +
    '</div>' +
    '<p style="color:var(--text-muted);font-size:12px">' +
      _ic('info', 12) + ' Importen loggas och kan ångras direkt efter genomförande.' +
    '</p>';

    return html;
  }

  function _confirmRow(icon, count, label, color) {
    return '<div class="imp-confirm-row">' +
      '<span style="color:' + color + '">' + icon + '</span>' +
      '<span style="font-weight:700;font-size:18px;color:' + color + '">' + count + '</span>' +
      '<span style="color:var(--text-muted)">' + label + '</span>' +
    '</div>';
  }

  /* ── Steg 6: Importera + Resultat ───────────────────────────────────── */

  async function _runImport() {
    var btn = document.querySelector('#imp-footer .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Importerar…'; }

    var cfg              = ImportExportService.getConfig(_entityType);
    var arr              = (typeof state !== 'undefined') ? state[cfg.stateKey] : null;
    if (!arr) { if (btn) { btn.disabled = false; btn.textContent = 'Importera'; } return; }

    var createdIds       = [];
    var updatedSnapshots = [];
    var errorRows        = [];
    var createdCount     = 0;
    var updatedCount     = 0;
    var skippedCount     = 0;

    _validated.forEach(function (v) {
      var ri = v.rowIndex - 2;

      /* Applicera manuella relationsval på resolved-objektet */
      (v.relationsLog || []).forEach(function (log) {
        if (log.quality === 'ambiguous') {
          var key = v.rowIndex + ':' + log.targetField;
          var chosen = _relChoices[key];
          if (chosen) v.resolved[log.targetField] = chosen;
        }
      });

      if (v.status === 'error') {
        skippedCount++;
        errorRows.push({ row: v.rowIndex, field: '', message: v.errors.join(', ') });
        return;
      }

      function _createNew(baseObj) {
        var now  = new Date().toISOString();
        var extras = { id: newId(arr, cfg.idPrefix), createdAt: now, updatedAt: now };
        /* Märk historiska importer så att automation kan ignorera dem */
        if (cfg.historicalImport) extras.historicalImport = true;
        var newObj = Object.assign(cfg.schemaFn(), baseObj || {}, extras);
        if (cfg.coerce) cfg.coerce(newObj);
        arr.push(newObj);
        createdIds.push(newObj.id);
        createdCount++;
      }

      if (v.status === 'new') {
        _createNew(v.resolved);
        return;
      }

      // Dubblett
      var action = _conflicts[ri] || 'update';
      if (action === 'skip') { skippedCount++; return; }
      if (action === 'create') { _createNew(v.resolved); return; }

      if (action === 'update') {
        var existing = v.duplicate.item;
        /* Kontrollera om posten ändrades efter validering (race condition) */
        if (_validationTime && existing.updatedAt && existing.updatedAt > _validationTime) {
          errorRows.push({
            row: v.rowIndex,
            field: '',
            message: 'Posten ändrades av annan användare under importen — hoppar över (id: ' + existing.id + ')'
          });
          skippedCount++;
          return;
        }
        var beforeSnap = Object.assign({}, existing);
        var beforeAt   = existing.updatedAt || '';

        Object.keys(v.resolved).forEach(function (k) {
          if (v.resolved[k] !== '' && v.resolved[k] != null) existing[k] = v.resolved[k];
        });
        var afterAt = new Date().toISOString();
        existing.updatedAt = afterAt;
        if (cfg.coerce) cfg.coerce(existing);

        updatedSnapshots.push({
          id:             existing.id,
          before:         beforeSnap,
          updatedAtBefore: beforeAt,
          updatedAtAfter:  afterAt
        });
        updatedCount++;
      }
    });

    persist();

    var log = ImportExportService.saveImportLog(Object.assign(Schema.importLog(), {
      type:             _entityType,
      filename:         _file ? _file.name : '',
      format:           _file ? (_file.name.split('.').pop() || '').toLowerCase() : 'csv',
      totalRows:        _validated.length,
      createdCount:     createdCount,
      updatedCount:     updatedCount,
      skippedCount:     skippedCount,
      errorCount:       errorRows.length,
      errors:           errorRows,
      createdIds:       createdIds,
      updatedSnapshots: updatedSnapshots,
      performedBy:      (state.currentUser && state.currentUser.id) || ''
    }));

    _lastLogId = log.id;
    _step = 6;
    _renderStep();
  }

  /* ── Steg 6: Resultat ────────────────────────────────────────────────── */

  function _step6() {
    var log = _lastLogId ? state.importLogs.find(function (l) { return l.id === _lastLogId; }) : null;
    if (!log) return '<p>Import slutförd.</p>';

    var cfg       = ImportExportService.getConfig(_entityType) || {};
    var targetPage = cfg.targetPage || 'pg-dash';
    var targetLabel = cfg.label ? 'Till ' + cfg.label.toLowerCase() : 'Till registret';

    var html = '<div class="imp-result">' +
      '<div class="imp-result-icon">' + _ic('check-circle', 40) + '</div>' +
      '<h3 style="margin:12px 0 4px">Import slutförd!</h3>' +
      '<div class="imp-stats-row" style="justify-content:center;margin:16px 0">' +
        _statChip(log.createdCount, 'Skapade',     'green') +
        _statChip(log.updatedCount, 'Uppdaterade', 'sky')   +
        _statChip(log.skippedCount, 'Hoppade',     'orange') +
        _statChip(log.errorCount,   'Fel',          'red')   +
      '</div>' +
      (log.errors && log.errors.length
        ? '<details style="margin:8px 0"><summary style="cursor:pointer;font-size:13px">Visa ' + log.errors.length + ' felposter</summary>' +
          '<ul style="font-size:12px;margin-top:8px">' +
            log.errors.map(function (e) { return '<li>Rad ' + e.row + ': ' + esc(e.message) + '</li>'; }).join('') +
          '</ul></details>'
        : '') +
      '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:20px;">' +
        '<button class="btn btn-ghost" onclick="ImportWizardPage._undoLast()">' + _ic('rotate-ccw', 14) + ' Ångra import</button>' +
        '<button class="btn btn-primary" onclick="Router.showPage(\'' + targetPage + '\',{})">' + _ic('list', 14) + ' ' + esc(targetLabel) + '</button>' +
        '<button class="btn btn-ghost" onclick="Router.showPage(\'pg-import-log\',{})">' + _ic('clock', 14) + ' Importlogg</button>' +
        '<button class="btn btn-ghost" onclick="ImportWizardPage._reset()">' + _ic('upload', 14) + ' Ny import</button>' +
      '</div>' +
    '</div>';

    return html;
  }

  function _undoLast() {
    if (!_lastLogId) return;
    var log = (state.importLogs || []).find(function (l) { return l.id === _lastLogId; });
    if (!log) { alert('Importloggen hittades inte.'); return; }

    var overlay = document.createElement('div');
    overlay.id = 'imp-undo-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.innerHTML =
      '<div style="background:var(--bg);border-radius:12px;max-width:440px;width:100%;padding:24px;">' +
        '<h3 style="margin:0 0 8px;">' + _ic('rotate-ccw', 16) + ' Ångra import</h3>' +
        '<p style="font-size:13px;color:var(--mt);margin:0 0 20px;line-height:1.5;">' +
          '<strong>' + log.createdCount + '</strong> skapade poster raderas. ' +
          '<strong>' + log.updatedCount + '</strong> uppdaterade poster återställs till sina värden före importen. ' +
          'Poster som ändrats manuellt efter importen bevaras och flaggas.' +
        '</p>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button class="btn bp" onclick="ImportWizardPage._doUndo()">' + _ic('check', 14) + ' Ångra importen</button>' +
          '<button class="btn bs" onclick="ImportWizardPage._closeUndoDialog()">Avbryt</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
  }

  function _closeUndoDialog() {
    var el = document.getElementById('imp-undo-overlay');
    if (el) el.remove();
  }

  function _doUndo() {
    _closeUndoDialog();
    var result = ImportExportService.undoImport(_lastLogId);

    if (result.conflicts && result.conflicts.length) {
      _showUndoConflictResult(result);
      return;
    }

    var summary = 'Ångrat: ' + result.removed + ' borttagna, ' + result.restored + ' återställda.';
    if (result.errors && result.errors.length) {
      summary += ' ' + result.errors.length + ' fel.';
    }
    // Show brief inline notice then navigate
    var body = document.getElementById('imp-body');
    if (body) {
      body.innerHTML = '<div style="text-align:center;padding:40px 20px;">' +
        '<div style="color:var(--gr);margin-bottom:12px;">' + _ic('check-circle', 36) + '</div>' +
        '<h3 style="margin:0 0 8px;">Import ångrades</h3>' +
        '<p style="color:var(--mt);font-size:13px;">' + esc(summary) + '</p>' +
      '</div>';
    }
    var foot = document.getElementById('imp-footer');
    if (foot) {
      var cfg = ImportExportService.getConfig(_entityType);
      foot.innerHTML = '<div style="display:flex;justify-content:center;padding:16px 0;">' +
        '<button class="btn bp" onclick="Router.showPage(\'' + (cfg ? cfg.targetPage : 'pg-dash') + '\',{})">' + _ic('list', 14) + ' Till registret</button>' +
      '</div>';
    }
  }

  function _showUndoConflictResult(result) {
    var overlay = document.createElement('div');
    overlay.id = 'imp-undo-conflict-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;';

    var conflictRows = (result.conflicts || []).map(function (c) {
      return '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--br);">' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:13px;font-weight:600;">' + esc(c.name || c.id || '—') + '</div>' +
          '<div style="font-size:11px;color:var(--mt);">Ändrades manuellt efter importen — ursprungsvärdet bevarades ej</div>' +
        '</div>' +
        '<span class="bdg bdg-orange" style="font-size:10px;flex-shrink:0;">Bevarad</span>' +
      '</div>';
    }).join('');

    overlay.innerHTML =
      '<div style="background:var(--bg);border-radius:12px;max-width:520px;width:100%;padding:24px;max-height:80vh;overflow-y:auto;">' +
        '<h3 style="margin:0 0 8px;">' + _ic('alert-triangle', 16) + ' Konflikter vid ångring</h3>' +
        '<p style="font-size:13px;color:var(--mt);margin:0 0 16px;line-height:1.5;">' +
          result.removed + ' poster raderades, ' + result.restored + ' återställdes. ' +
          '<strong>' + result.conflicts.length + ' poster</strong> ändrades manuellt efter importen och bevarades med sina nuvarande värden.' +
        '</p>' +
        '<div style="margin-bottom:16px;max-height:300px;overflow-y:auto;">' + conflictRows + '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button class="btn bp" onclick="ImportWizardPage._closeConflictDialog()">' + _ic('check', 14) + ' OK, förstått</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
  }

  function _closeConflictDialog() {
    var el = document.getElementById('imp-undo-conflict-overlay');
    if (el) el.remove();
    var cfg = ImportExportService.getConfig(_entityType);
    Router.showPage(cfg ? cfg.targetPage : 'pg-dash', {});
  }

  function _reset() {
    _step           = 1;
    _file           = null;
    _rawParsed      = null;
    _mapping        = {};
    _validated      = [];
    _conflicts      = {};
    _relChoices     = {};
    _lastLogId      = null;
    _validationTime = null;
    _renderStep();
  }

  /* ── Event-binding ───────────────────────────────────────────────────── */

  function _bindEvents() {
    var page = document.getElementById('pg-import-wizard-content');
    if (!page) return;

    page.addEventListener('dragover', function (e) {
      e.preventDefault();
      if (_step !== 1) return;
      var dz = document.getElementById('imp-drop');
      if (dz) dz.classList.add('imp-drop-hover');
    });

    page.addEventListener('dragleave', function () {
      var dz = document.getElementById('imp-drop');
      if (dz) dz.classList.remove('imp-drop-hover');
    });

    page.addEventListener('drop', function (e) {
      e.preventDefault();
      if (_step !== 1) return;
      var dz = document.getElementById('imp-drop');
      if (dz) dz.classList.remove('imp-drop-hover');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) _setFile(f);
    });
  }

  function _bindStepEvents() {
    // onclick-hanterare är inline
  }

  function _back() {
    if (_step > 1 && _step < 6) { _step--; _renderStep(); }
  }

  /* ── Publikt API ─────────────────────────────────────────────────────── */

  return {
    render:                  render,
    _parseFile:              _parseFile,
    _applyBokioProfile:      _applyBokioProfile,
    _applyAutoMatch:         _applyAutoMatch,
    _onMappingChange:        _onMappingChange,
    _toStep3:                _toStep3,
    _toStep4:                _toStep4,
    _toStep5:                _toStep5,
    _onConflict:             _onConflict,
    _onRelChoice:            _onRelChoice,
    _runImport:              _runImport,
    _undoLast:               _undoLast,
    _closeUndoDialog:        _closeUndoDialog,
    _doUndo:                 _doUndo,
    _closeConflictDialog:    _closeConflictDialog,
    _reset:                  _reset,
    _back:                   _back,
    _onFileInput:            _onFileInput
  };

})();
