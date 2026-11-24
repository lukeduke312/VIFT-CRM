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
  var _lastSaveOk      = true;   // E2E IMP-02: bekräftade servern importen?
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
      el.innerHTML = '<div class="empty mx-empty">' +
        _ic('lock', 28) + '<h3>Åtkomst nekad</h3>' +
        '<p>Du saknar behörighet att importera detta register.</p></div>';
      return;
    }

    var cfg = ImportExportService.getConfig(_entityType);
    if (!cfg) {
      el.innerHTML = '<div class="empty mx-empty">' + _ic('alert-circle', 28) + '<h3>Okänd registertyp</h3><p>' + esc(_entityType) + '</p></div>';
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

  /* V3 (2026-11-26): rubrik med registertyp (toppraden visar bara
     "Importera"), stegindikator som får plats på mobil (F-03), innehållet
     i ett kort och knapparna i en fot med en tydlig primär åtgärd (F-11). */
  function _html(cfg) {
    var canLog = typeof Auth !== 'undefined' && Auth.canViewPage('pg-import-log');
    return '<div class="imp-wizard">' +
      '<div class="imp-wizard-header mx-imp-head">' +
        '<span class="mx-imp-ico" aria-hidden="true">' + _ic('upload', 20) + '</span>' +
        '<div class="mx-imp-tt">' +
          '<h2 class="mx-imp-title">Importera ' + esc(String(cfg.label || '').toLowerCase()) + '</h2>' +
          '<p class="mx-imp-sub">Från CSV- eller XLSX-fil. Importen loggas och kan ångras efteråt.' +
            (_caps && !_caps.xlsxRead ? ' <strong class="mx-imp-warn">XLSX stöds inte av din webbläsare — använd CSV.</strong>' : '') +
          '</p>' +
        '</div>' +
        (canLog ? '<button class="btn bghost bsm mx-imp-logbtn" aria-label="Importlogg" title="Importlogg" onclick="Router.showPage(\'pg-import-log\',{})">' + _ic('clock', 14) + '<span class="mx-imp-logbtn-l"> Importlogg</span></button>' : '') +
      '</div>' +
      '<nav class="imp-steps" id="imp-steps" aria-label="Steg i importen">' + _stepsHtml() + '</nav>' +
      '<div class="imp-body" id="imp-body"></div>' +
      '<div class="imp-footer" id="imp-footer"></div>' +
    '</div>';
  }

  /* Dator: alla sex steg i ett rutnät som alltid ryms i bredden (F-03).
     Mobil: "Förhandsgranskning · Steg 2 av 6" med en stapel per steg. */
  function _stepsHtml() {
    var full = '<ol class="mx-steps">' + STEPS.map(function (s, i) {
      var n   = i + 1;
      var cls = 'mx-step';
      if (n < _step)       cls += ' is-done';
      else if (n === _step) cls += ' is-active';
      return '<li class="' + cls + '"' + (n === _step ? ' aria-current="step"' : '') + '>' +
        '<span class="mx-step-bar"></span>' +
        '<span class="mx-step-l"><span class="mx-step-n">' + (n < _step ? _ic('check', 12) : n) + '</span>' +
        '<span class="mx-step-t">' + esc(s) + '</span></span>' +
      '</li>';
    }).join('') + '</ol>';
    var compact = '<div class="mx-steps-m">' +
      '<div class="mx-steps-m-top"><span class="mx-steps-m-t">' + esc(STEPS[_step - 1] || '') + '</span>' +
      '<span class="mx-steps-m-n">Steg ' + _step + ' av ' + STEPS.length + '</span></div>' +
      '<div class="mx-steps-m-bar" aria-hidden="true">' + STEPS.map(function (_, i) {
        var n = i + 1;
        return '<i class="' + (n < _step ? 'is-done' : n === _step ? 'is-active' : '') + '"></i>';
      }).join('') + '</div>' +
    '</div>';
    return full + compact;
  }

  function _fmtInt(n) {
    return (Number(n) || 0).toLocaleString('sv-SE');
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

  /* Klassen btn-primary behålls som krok (E2E IMP-01 och _runImport). */
  function _footerHtml() {
    if (_step === 6) return '';
    var prev = _step > 1 && _step < 6
      ? '<button class="btn bs" onclick="ImportWizardPage._back()">' + _ic('arrow-left', 14) + ' Tillbaka</button>'
      : '';
    var next = '', hint = '';
    if (_step === 1) {
      next = '<button class="btn bp btn-primary" onclick="ImportWizardPage._parseFile()" id="imp-btn-next"' + (_file ? '' : ' disabled') + '>Nästa ' + _ic('arrow-right', 14) + '</button>';
      hint = '<span class="mx-imp-hint" id="imp-next-hint">' + (_file ? '' : 'Välj en fil för att fortsätta') + '</span>';
    }
    else if (_step === 2) next = '<button class="btn bp btn-primary" onclick="ImportWizardPage._toStep3()">Nästa ' + _ic('arrow-right', 14) + '</button>';
    else if (_step === 3) next = '<button class="btn bp btn-primary" onclick="ImportWizardPage._toStep4()">Validera ' + _ic('arrow-right', 14) + '</button>';
    else if (_step === 4) next = '<button class="btn bp btn-primary" onclick="ImportWizardPage._toStep5()">Gå vidare ' + _ic('arrow-right', 14) + '</button>';
    else if (_step === 5) next = '<button class="btn bp btn-primary" onclick="ImportWizardPage._runImport()">' + _ic('upload', 14) + ' Importera</button>';
    return '<div class="mx-imp-foot">' + prev + '<div class="mx-imp-foot-r">' + hint + next + '</div></div>';
  }

  /* ── Steg 1: Välj fil ────────────────────────────────────────────────── */

  function _step1() {
    var accept = (_caps && !_caps.xlsxRead) ? '.csv' : '.csv,.xlsx';
    return '<div class="imp-drop-zone' + (_file ? ' imp-drop-active' : '') + '" id="imp-drop" role="button" tabindex="0" aria-label="Välj fil att importera" ' +
        'onclick="document.getElementById(\'imp-file-input\').click()" ' +
        'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();document.getElementById(\'imp-file-input\').click();}">' +
      '<input type="file" id="imp-file-input" accept="' + accept + '" style="display:none" onchange="ImportWizardPage._onFileInput(event)">' +
      '<span class="mx-drop-ico" aria-hidden="true">' + _ic('upload', 22) + '</span>' +
      '<p class="mx-drop-t">Dra och släpp filen här</p>' +
      '<p class="mx-drop-s">eller klicka för att välja fil</p>' +
      '<span class="btn bs bsm mx-drop-btn" aria-hidden="true">' + _ic('file-text', 14) + ' Välj fil</span>' +
      '<p class="mx-drop-f">' +
        ((_caps && !_caps.xlsxRead) ? 'CSV (semikolon/komma) · max 10 MB' : 'CSV (semikolon/komma) och XLSX · max 10 MB') +
      '</p>' +
    '</div>' +
    '<div id="imp-file-info">' + (_file ? '<p class="mx-file-msg is-ok" role="status">' + _ic('file-text', 14) + ' ' + esc(_file.name) + ' (' + _fmtSize(_file.size) + ')</p>' : '') + '</div>';
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
    _showFileInfo(_ic('file-text', 14) + ' ' + esc(f.name) + ' (' + _fmtSize(f.size) + ')', 'ok');
    var btn = document.getElementById('imp-btn-next');
    if (btn) btn.disabled = false;
    var hint = document.getElementById('imp-next-hint');
    if (hint) hint.textContent = '';
    var dz = document.getElementById('imp-drop');
    if (dz) dz.classList.add('imp-drop-active');
  }

  function _showFileInfo(msg, type) {
    var el = document.getElementById('imp-file-info');
    if (!el) return;
    el.innerHTML = '<p class="mx-file-msg ' + (type === 'error' ? 'is-error' : 'is-ok') + '" role="' + (type === 'error' ? 'alert' : 'status') + '">' +
      (type === 'error' ? _ic('alert-circle', 14) + ' ' : '') + msg + '</p>';
  }

  function _fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1).replace('.', ',') + ' kB';
    return (bytes / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MB';
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
      _showFileInfo('Fel vid läsning: ' + esc(e.message), 'error');
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
      ? '<button class="btn bs bsm" onclick="ImportWizardPage._applyBokioProfile()">' + _ic('zap', 14) + ' Bokio-profil</button>'
      : '';

    var html = '<div class="mx-imp-intro">' +
      '<div><strong>' + _fmtInt(totalRows) + ' ' + (totalRows === 1 ? 'rad' : 'rader') + '</strong> · ' + h.length + ' ' + (h.length === 1 ? 'kolumn' : 'kolumner') +
        (totalRows > 5 ? ' · de 5 första visas' : '') + '</div>' +
      bokioBtn +
    '</div>' +
    '<div class="imp-preview-wrap">' +
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
      html += '<tr><td colspan="' + h.length + '" style="text-align:center;color:var(--muted);font-size:12px">… och ' + _fmtInt(totalRows - 5) + ' rader till</td></tr>';
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

    var html = '<div class="mx-imp-intro">' +
      '<button class="btn bs bsm" onclick="ImportWizardPage._applyAutoMatch()">' +
        _ic('sparkles', 14) + ' Auto-matcha' +
      '</button>' +
      (showBokio
        ? '<button class="btn bs bsm" onclick="ImportWizardPage._applyBokioProfile()">' + _ic('zap', 14) + ' Bokio-profil</button>'
        : '') +
      '<span class="mx-imp-req">* = obligatoriskt fält</span>' +
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
    if (!v) return '<span style="color:var(--muted);font-size:11.5px">(tom)</span>';
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

  /* CUSTOMER IMPORT R2 §5/§6: två eller fler källkolumner mappade till SAMMA
     målfält — mapRow() (ImportExportConfigs.js) har ingen precedence-logik,
     sist processade kolumn vinner tyst och tidigare kolumners värde
     försvinner utan varning. Generiskt (gäller alla entity types) hårt
     block, inte bara warning — det finns ingen definierad merge-semantik,
     så att fortsätta skulle vara medveten dataförlust. */
  function _findDuplicateTargetMappings() {
    var targetToSources = {};
    Object.keys(_mapping).forEach(function (h) {
      var t = _mapping[h];
      if (!t) return;
      (targetToSources[t] = targetToSources[t] || []).push(h);
    });
    var dups = [];
    Object.keys(targetToSources).forEach(function (t) {
      if (targetToSources[t].length > 1) dups.push({ target: t, sources: targetToSources[t] });
    });
    return dups;
  }

  function _toStep4() {
    var cfg    = ImportExportService.getConfig(_entityType);
    var fields = cfg ? cfg.fields : [];

    var fieldLabel = function (v) {
      var f = fields.filter(function (x) { return x.value === v; })[0];
      return f ? f.label.replace(' *', '') : v;
    };

    // §5/§6: duplicate target mapping — hårt block, före allt annat.
    var dupTargets = _findDuplicateTargetMappings();
    if (dupTargets.length) {
      var dupMsg = 'Flera kolumner är kopplade till samma fält: ' +
        dupTargets.map(function (d) { return fieldLabel(d.target) + ' ← ' + d.sources.join(', '); }).join('; ') +
        '. Välj vilket värde som ska användas innan du fortsätter.';
      _showError('imp-body', dupMsg);
      return;
    }

    if (_entityType === 'customer') {
      /* R2 §7: kund-specifik mapping-precheck — ersätter den generiska
         fields[].required-kontrollen (name har inte längre required:true,
         se ImportExportConfigs.js). Kräver `type` mappad, samt antingen
         `name` ELLER BÅDE `firstName` och `lastName` mappade. Detta är
         ENDAST en kolumn-nivå-precheck — radvalidering (ImportExportConfigs
         .customer.validate()) avgör därefter om VARJE enskild rad faktiskt
         är giltig för SIN typ (viktigt för blandade filer, se R2 §30). */
      var mappedValues = Object.values(_mapping).filter(Boolean);
      var hasType       = mappedValues.indexOf('type') !== -1;
      var hasName       = mappedValues.indexOf('name') !== -1;
      var hasStructured = mappedValues.indexOf('firstName') !== -1 && mappedValues.indexOf('lastName') !== -1;
      if (!hasType || !(hasName || hasStructured)) {
        _showError('imp-body', 'Kundimport kräver Kundtyp och antingen Kund-/företagsnamn eller både Förnamn och Efternamn.');
        return;
      }
    } else {
      // Generisk kontroll (oförändrad) för alla andra entity types.
      var requiredFields = fields.filter(function (f) { return f.required; });
      var mappedValues2  = Object.values(_mapping).filter(Boolean);

      var missing = requiredFields.filter(function (f) {
        return f.value.charAt(0) !== '_' && mappedValues2.indexOf(f.value) === -1;
      });

      if (missing.length) {
        _showError('imp-body', 'Obligatoriska fält saknas: ' + missing.map(function (f) { return f.label.replace(' *', ''); }).join(', '));
        return;
      }
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

    var html = '<div class="mx-imp-stats">' +
      _statChip(stats.ok,  'Nya',        'green') +
      _statChip(stats.dup, 'Dubbletter', 'orange') +
      _statChip(stats.err, 'Fel',        'red') +
    '</div>';

    if (stats.err > 0) {
      html += '<div class="imp-section-title">' + _ic('alert-circle', 13) + ' Rader med fel (hoppas över automatiskt)</div>' +
        '<div class="imp-row-list">';
      _validated.filter(function (v) { return v.status === 'error'; }).forEach(function (v) {
        html += '<div class="imp-row-item imp-row-error">' +
          '<span class="imp-row-num">Rad ' + v.rowIndex + '</span>' +
          '<span class="imp-row-name">' + esc(v.mapped.name || v.mapped.firstName || '(tomt)') + '</span>' +
          '<span class="imp-row-msg">' + esc((v.errors || []).join(', ')) + '</span>' +
        '</div>';
      });
      html += '</div>';
    }

    if (stats.dup > 0) {
      html += '<div class="imp-section-title" style="margin-top:16px">' + _ic('copy', 13) + ' Dubbletter — välj åtgärd per rad</div>' +
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
          '<details class="mx-imp-diff" style="margin-top:4px;">' +
            '<summary>' +
              _ic('git-compare', 12) + ' Visa fältändringar' +
            '</summary>' +
            _diffHtml(v) +
          '</details>' +
        '</div>';
      });
      html += '</div>';
    }

    /* R2 §17/§24: rader som INTE blockeras men har varningar (t.ex.
       typmedvetna orgNr/personnr- eller adress-varningar för customer, se
       ImportExportConfigs.js cfg.warnings()) — v.warnings fanns redan i
       resultatobjektet (tidigare bara fyllt av ambiguösa relationer) men
       renderades ALDRIG i denna sida. Visas nu explicit, tydligt skilt från
       felraderna: dessa rader ÄR importerbara, bara flaggade för granskning. */
    var warnRows = _validated.filter(function (v) { return v.status !== 'error' && (v.warnings || []).length > 0; });
    if (warnRows.length > 0) {
      html += '<div class="imp-section-title" style="margin-top:16px">' +
        _ic('alert-triangle', 14) + ' Rader med varningar (importeras ändå)' +
      '</div>' +
      '<div class="imp-row-list">';
      warnRows.forEach(function (v) {
        html += '<div class="imp-row-item imp-row-dup" style="flex-direction:column;align-items:stretch;">' +
          '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
            '<span class="imp-row-num">Rad ' + v.rowIndex + '</span>' +
            '<span class="imp-row-name">' + esc(v.mapped.name || v.mapped.firstName || '') + '</span>' +
          '</div>' +
          '<div class="imp-row-msg mx-imp-warnrow" style="margin-top:2px;">' + esc(v.warnings.join(' · ')) + '</div>' +
        '</div>';
      });
      html += '</div>';
    }

    /* ── Ambiguösa relationer — kräver manuellt val ──────────────────── */
    var ambigRows = _validated.filter(function (v) { return v.needsRelation; });
    if (ambigRows.length > 0) {
      html += '<div class="imp-section-title" style="margin-top:16px">' +
        _ic('link', 13) + ' Ambiguösa relationer — välj rätt post manuellt' +
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
          html += '<div class="mx-imp-rel">' +
            '<span class="mx-imp-rel-l">' + esc(log.label) + ':</span>' +
            '<span class="mx-imp-rel-c">"' + esc(log.refValue) + '" — ' + log.candidates.length + ' träffar</span>' +
            '<select ' +
              'onchange="ImportWizardPage._onRelChoice(\'' + esc(key) + '\',this.value)">' +
              '<option value="">— Välj —</option>' +
              log.candidates.map(function (c) {
                var n = (c.item.name || ((c.item.firstName||'') + ' ' + (c.item.lastName||'')).trim() || c.id);
                var shown = (typeof displayNumberOf === 'function') ? displayNumberOf(c.item) || c.id : c.id; // label only (2026-11-12)
                return '<option value="' + esc(c.id) + '"' + (chosen === c.id ? ' selected' : '') + '>' + esc(n) + ' (' + esc(shown) + ')</option>';
              }).join('') +
            '</select>' +
            (log.required
              ? '<span class="mx-imp-req-y">Krävs</span>'
              : '<span class="mx-imp-req-n">Valfri</span>') +
          '</div>';
        });

        html += '</div>';
      });

      html += '</div>';
    }

    if (stats.ok === 0 && stats.dup === 0 && ambigRows.length === 0) {
      html += '<div class="empty mx-empty" style="margin-top:12px;padding:28px 16px;">' +
        _ic('alert-circle', 24) + '<h3>Inga importerbara rader</h3><p>Kontrollera kolumnmatchningen eller filen och försök igen.</p></div>';
    }

    return html;
  }

  /* Nyckeltal i V3-form (samma som .mx-kpi i övriga block). Färgen
     följer innebörden; 0 visas neutralt. */
  function _statChip(n, label, color) {
    var tone = { green: 'tone-ok', orange: 'tone-warn', red: 'tone-danger', sky: 'tone-info' }[color] || '';
    return '<div class="mx-kpi ' + (n ? tone : '') + '">' +
      '<span class="mx-kpi-n">' + _fmtInt(n) + '</span>' +
      '<span class="mx-kpi-l">' + esc(label) + '</span>' +
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
      return '<p style="font-size:12px;color:var(--muted);margin:4px 0 0">' + _ic('check', 12) + ' Inga fältskillnader.</p>';
    }
    return '<div style="overflow-x:auto">' +
      '<table>' +
      '<thead><tr><th>Fält</th><th>Nuvarande</th><th>Från fil</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr>' +
          '<td style="color:var(--muted)">' + esc(r.label) + '</td>' +
          '<td class="is-old">' + esc(String(r.oldVal)) + '</td>' +
          '<td class="is-new">' + esc(String(r.newVal)) + '</td>' +
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
    var html = '<p style="font-size:14px;margin:0 0 14px;color:var(--ink-2);">Granskat <strong>' + _fmtInt(_validated.length) + '</strong> rader i ' + esc(String((cfg && cfg.label) || _entityType).toLowerCase()) + '. Klicka <strong>Importera</strong> för att genomföra.</p>' +
      '<div class="mx-imp-sum">' +
        _confirmRow(_ic('plus-circle', 14), toCreate, 'Skapas',      'tone-ok') +
        _confirmRow(_ic('edit', 14),        toUpdate, 'Uppdateras',  'tone-info') +
        _confirmRow(_ic('minus-circle', 14), toSkip,  'Hoppas över', '') +
      '</div>' +
    '<p class="mx-imp-note">' +
      _ic('info', 13) + ' Importen loggas och kan ångras direkt efter genomförande.' +
    '</p>';

    return html;
  }

  function _confirmRow(icon, count, label, tone) {
    return '<div class="mx-kpi ' + (count ? tone : '') + '">' +
      '<span class="mx-kpi-n">' + _fmtInt(count) + '</span>' +
      '<span class="mx-kpi-l">' + icon + ' ' + esc(label) + '</span>' +
    '</div>';
  }

  /* ── Steg 6: Importera + Resultat ───────────────────────────────────── */

  async function _runImport() {
    var btn = document.querySelector('#imp-footer .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Importerar…'; }

    var cfg              = ImportExportService.getConfig(_entityType);

    /* P0 FINAL INTEGRATION (2026-10-18) — FAIL CLOSED, inte tyst trasigt:
       `vift_invoices` och `vift_ronderingspass` skrivs numera ENDAST via
       smala, radlåsta atomiska RPC:er (invoice_-funktionerna och
       rondering_-funktionerna, se
       state.js _doPersist()-kommentaren) — de finns inte längre med i
       den generiska persist()-bundeln. Denna generiska importmotor
       (samma kodväg som kunder/fastigheter/artiklar/personal) skulle
       annars pusha importerade rader lokalt och sedan tyst förlita sig
       på ett persist()-anrop som INTE LÄNGRE skickar dessa två nycklar
       alls — importen skulle se ut att lyckas i UI:t men ALDRIG nå
       servern. Detta upptäcktes under en grep-sweep av ALLA generiska
       skrivvägar till dessa nycklar (inte bara InvoiceService.js/
       RonderingService.js) — en reell regression denna release annars
       hade introducerat tyst. Att faktiskt rutta CSV-bulkimport genom de
       smala per-operation-RPC:erna (som inte är designade för godtyckliga
       fält-patchar på BEFINTLIGA rader) är inte säkert att göra med den
       rigör detta uppdrag kräver inom denna rundas tidsram — blockeras
       därför explicit, synligt, istället för att tystas. Samma mönster
       som AO/tid (`_isAoTimeImport` ovan) kan återanvändas för en framtida
       egen leverans om bulkimport av fakturor/ronderingspass efterfrågas.
       workOrders/timeEntries är INTE blockerade — de har redan sin egna
       AOTimeSyncService-brygga (se _isAoTimeImport nedan). */
    if (cfg.stateKey === 'invoices' || cfg.stateKey === 'ronderingspass') {
      if (btn) { btn.disabled = false; btn.textContent = 'Importera'; }
      showToast('Import av ' + (cfg.stateKey === 'invoices' ? 'fakturaunderlag' : 'ronderingspass') +
        ' är tillfälligt avstängd (kräver en egen atomisk import-väg, planerad separat — se masterloggen).');
      return;
    }

    var arr              = (typeof state !== 'undefined') ? state[cfg.stateKey] : null;
    if (!arr) { if (btn) { btn.disabled = false; btn.textContent = 'Importera'; } return; }

    var createdIds       = [];
    var updatedSnapshots = [];
    var errorRows        = [];
    var createdCount     = 0;
    var updatedCount     = 0;
    var skippedCount     = 0;

    /* P0 AO/TID-FIX: `vift_workOrders`/`vift_timeEntries` har flyttats
       bort ur den generiska persist()-bundeln (se state.js _doPersist()),
       exakt som redan gällde för vift_projectDocuments — denna generiska
       importmotor hanterar MÅNGA andra entitetstyper (kunder, fastigheter,
       artiklar, personal) som INTE rörs av det, men för just dessa två
       stateKeys måste varje rads create/update nu speglas via den
       atomiska RPC-vägen (AOTimeSyncService), annars skulle importerade
       AO:er/tidposter bara finnas lokalt tills nästa DataSync-poll
       skriver över dem. `_isAoTimeImport` avgör om denna körning alls
       behöver det extra steget — noll beteendeförändring för alla andra
       importtyper. Varje rads enqueue() hamnar i AOTimeSyncService:s
       EGEN, redan krasch-säkra outbox (localStorage, se dess tester) —
       om fliken stängs/kraschar mitt i importen återupptas just DEN raden
       automatiskt av nästa AOTimeSyncService.resumePending() (anropas vid
       initState()), oberoende av om denna guide-sida själv finns kvar. */
    var _isAoTimeImport = (cfg.stateKey === 'workOrders' || cfg.stateKey === 'timeEntries');
    var _aoTimeSyncOps  = []; // { id, kind: 'create'|'patch', obj?, patch? }

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
        /* 2026-11-12 (display-number round): newId() reads the digits of
           every id as one number, so once a K3 UUID id exists in
           customers/properties/propertyObjects it returns the SAME
           "KU-3214...e+23"-style id for every imported row. Those three
           collections use the K3 pattern instead: newSafeId() + a derived
           display number. Other collections are unchanged. */
        if (cfg.stateKey === 'customers' || cfg.stateKey === 'properties' || cfg.stateKey === 'propertyObjects') {
          extras.id = newSafeId(cfg.idPrefix, arr);
          extras.shortNumber = newShortNumber(extras.id, arr);
        }
        /* Märk historiska importer så att automation kan ignorera dem */
        if (cfg.historicalImport) extras.historicalImport = true;
        var newObj = Object.assign(cfg.schemaFn(), baseObj || {}, extras);
        if (cfg.coerce) cfg.coerce(newObj);
        arr.push(newObj);
        createdIds.push(newObj.id);
        createdCount++;
        if (_isAoTimeImport) _aoTimeSyncOps.push({ id: newObj.id, kind: 'create', obj: newObj });
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

        var _appliedPatch = {};
        Object.keys(v.resolved).forEach(function (k) {
          if (v.resolved[k] !== '' && v.resolved[k] != null) { existing[k] = v.resolved[k]; _appliedPatch[k] = v.resolved[k]; }
        });
        var afterAt = new Date().toISOString();
        existing.updatedAt = afterAt;
        _appliedPatch.updatedAt = afterAt;
        if (cfg.coerce) cfg.coerce(existing);

        updatedSnapshots.push({
          id:             existing.id,
          before:         beforeSnap,
          updatedAtBefore: beforeAt,
          updatedAtAfter:  afterAt
        });
        updatedCount++;
        if (_isAoTimeImport) _aoTimeSyncOps.push({ id: existing.id, kind: 'patch', patch: _appliedPatch });
      }
    });

    /* E2E IMP-02 (2026-11-23): vänta på serverns svar för registret innan
       resultatsidan visas. Tidigare stod "Import slutförd!" kvar även när
       servern nekade skrivningen (posterna fanns bara lokalt). AO/tid går
       via sin egen outbox (nedan) och påverkas inte av detta. */
    _lastSaveOk = _isAoTimeImport ? true : await persist({ keys: [cfg.stateKey] });

    /* P0 AO/TID-FIX: speglar varje AO-/tidpost-rad till den atomiska
       RPC-vägen. Körs EFTER den synkrona lokala commit:en ovan (precis
       som varje annan WorkOrderService/TimeService-metod i denna release
       — lokal mutation är redan klar och synlig i UI:t; serverskrivningen
       sker i bakgrunden via den delade, redan testade outboxen). Väntar
       INTE på nätverket innan importloggen sparas/UI:t uppdateras — en
       misslyckad enskild rads serverskrivning hamnar i outboxen (synlig
       via AOTimeSyncService.pendingCount()) och rapporteras inte som ett
       importfel här (den kan fortfarande lyckas senare, se resumePending()). */
    if (_isAoTimeImport && _aoTimeSyncOps.length > 0 && typeof AOTimeSyncService !== 'undefined') {
      var _aoTimeEntityType = (cfg.stateKey === 'workOrders') ? 'ao' : 'time';
      AOTimeSyncService.bulkSync(_aoTimeEntityType, _aoTimeSyncOps, 'import-pending').then(function (r) {
        if (r.failed && r.failed.length > 0) {
          console.warn('[ImportWizardPage] ' + r.failed.length + ' rad(er) kunde inte synkas till servern omedelbart (ligger i outboxen för automatisk återförsök):', r.failed);
        }
      });
    }

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

    var head = _lastSaveOk
      ? '<div class="imp-result-icon">' + _ic('check-circle', 30) + '</div>' +
        '<h3 class="mx-imp-res-t">Import slutförd!</h3>'
      : '<div class="imp-result-icon is-fail">' + _ic('alert-triangle', 30) + '</div>' +
        '<h3 class="mx-imp-res-t is-fail">Importen är INTE bekräftad av servern</h3>' +
        '<p class="mx-imp-res-p">' +
          'Posterna nedan finns än så länge bara i den här webbläsaren. De skickas igen automatiskt när servern svarar ' +
          '(senast vid nästa inloggning). Kontrollera registret innan du importerar filen igen — eller välj ' +
          '<strong>Ångra import</strong> för att kasta dem.</p>';
    var canLog = typeof Auth !== 'undefined' && Auth.canViewPage('pg-import-log');
    var html = '<div class="imp-result">' +
      head +
      '<div class="mx-imp-stats">' +
        _statChip(log.createdCount, 'Skapade',     'green') +
        _statChip(log.updatedCount, 'Uppdaterade', 'sky')   +
        _statChip(log.skippedCount, 'Hoppade',     'orange') +
        _statChip(log.errorCount,   'Fel',          'red')   +
      '</div>' +
      (log.errors && log.errors.length
        ? '<details class="mx-imp-diff" style="margin:4px 0;align-self:stretch;"><summary>' + _ic('alert-circle', 12) + ' Visa ' + log.errors.length + ' felposter</summary>' +
          '<ul class="mx-imp-errlist">' +
            log.errors.map(function (e) { return '<li>Rad ' + esc(String(e.row)) + ': ' + esc(e.message) + '</li>'; }).join('') +
          '</ul></details>'
        : '') +
      '<div class="mx-imp-res-acts">' +
        '<button class="btn bp btn-primary" onclick="Router.showPage(\'' + esc(targetPage) + '\',{})">' + _ic('list', 14) + ' ' + esc(targetLabel) + '</button>' +
        '<button class="btn bs" onclick="ImportWizardPage._undoLast()">' + _ic('rotate-ccw', 14) + ' Ångra import</button>' +
        (canLog ? '<button class="btn bghost" onclick="Router.showPage(\'pg-import-log\',{})">' + _ic('clock', 14) + ' Importlogg</button>' : '') +
        '<button class="btn bghost" onclick="ImportWizardPage._reset()">' + _ic('upload', 14) + ' Ny import</button>' +
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
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(10,22,38,.48);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML =
      '<div class="mx-imp-dlg">' +
        '<h3>' + _ic('rotate-ccw', 16) + ' Ångra import</h3>' +
        '<p>' +
          '<strong>' + _fmtInt(log.createdCount) + '</strong> skapade poster raderas. ' +
          '<strong>' + _fmtInt(log.updatedCount) + '</strong> uppdaterade poster återställs till sina värden före importen. ' +
          'Poster som ändrats manuellt efter importen bevaras och flaggas.' +
        '</p>' +
        '<div class="mx-imp-dlg-acts">' +
          '<button class="btn bs" onclick="ImportWizardPage._closeUndoDialog()">Avbryt</button>' +
          '<button class="btn bp" onclick="ImportWizardPage._doUndo()">' + _ic('rotate-ccw', 14) + ' Ångra importen</button>' +
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
      body.innerHTML = '<div class="imp-result">' +
        '<div class="imp-result-icon">' + _ic('check-circle', 30) + '</div>' +
        '<h3 class="mx-imp-res-t">Import ångrades</h3>' +
        '<p class="mx-imp-res-p">' + esc(summary) + '</p>' +
      '</div>';
    }
    var foot = document.getElementById('imp-footer');
    if (foot) {
      var cfg = ImportExportService.getConfig(_entityType);
      foot.innerHTML = '<div class="mx-imp-foot" style="justify-content:center;">' +
        '<button class="btn bp" onclick="Router.showPage(\'' + esc(cfg ? cfg.targetPage : 'pg-dash') + '\',{})">' + _ic('list', 14) + ' Till registret</button>' +
      '</div>';
    }
  }

  function _showUndoConflictResult(result) {
    var overlay = document.createElement('div');
    overlay.id = 'imp-undo-conflict-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(10,22,38,.48);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    var conflictRows = (result.conflicts || []).map(function (c) {
      return '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--line);">' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:13px;font-weight:600;color:var(--ink);">' + esc(c.name || c.id || '—') + '</div>' +
          '<div style="font-size:12px;color:var(--muted);">Ändrades manuellt efter importen — ursprungsvärdet bevarades ej</div>' +
        '</div>' +
        '<span class="bdg bdg-orange" style="flex-shrink:0;">Bevarad</span>' +
      '</div>';
    }).join('');

    overlay.innerHTML =
      '<div class="mx-imp-dlg" style="max-width:520px;max-height:80vh;overflow-y:auto;">' +
        '<h3>' + _ic('alert-triangle', 16) + ' Konflikter vid ångring</h3>' +
        '<p>' +
          _fmtInt(result.removed) + ' poster raderades, ' + _fmtInt(result.restored) + ' återställdes. ' +
          '<strong>' + result.conflicts.length + ' poster</strong> ändrades manuellt efter importen och bevarades med sina nuvarande värden.' +
        '</p>' +
        '<div style="margin-bottom:16px;max-height:300px;overflow-y:auto;">' + conflictRows + '</div>' +
        '<div class="mx-imp-dlg-acts">' +
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
