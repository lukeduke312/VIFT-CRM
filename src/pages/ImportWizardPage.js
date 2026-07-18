/**
 * ImportWizardPage.js — 6-stegsguide för kundimport
 *
 * Steg 1: Välj fil (drag-and-drop eller klicka, CSV / XLSX)
 * Steg 2: Förhandsgranskning (5 rader, välj profil)
 * Steg 3: Kolumnmatchning (auto-förslag, Bokio-profil, "Importera inte")
 * Steg 4: Validering och dubblettdetektering
 * Steg 5: Bekräftelse (sammanfattning + konfliktlösning)
 * Steg 6: Resultat (logg, ångra)
 *
 * Kräver: Auth.can('admin') — ej inloggad admin spärras direkt.
 */

const ImportWizardPage = (function () {

  /* ── Intern state ─────────────────────────────────────────────────────── */

  var _step      = 1;
  var _file      = null;
  var _rawParsed = null;   // { headers, rows }
  var _mapping   = {};     // header → fieldName | null
  var _validated = [];     // [{ rowIndex, row, mapped, status, conflicts, errors }]
  var _conflicts = {};     // rowIndex → 'skip' | 'create' | 'update' | 'review'
  var _lastLogId = null;
  var _entityType = 'customer';

  var STEPS = [
    'Välj fil', 'Förhandsgranskning', 'Kolumnmatchning',
    'Validering', 'Bekräftelse', 'Resultat'
  ];

  /* ── Inbyggd ikon (återanvänder ic() från Icons.js) ───────────────────── */
  function _ic(name, size) {
    return typeof ic !== 'undefined' ? ic(name, size || 16) : '';
  }

  /* ── Render ──────────────────────────────────────────────────────────── */

  function render(params) {
    params = params || {};
    _entityType = params.type || 'customer';

    var el = document.getElementById('pg-import-wizard-content');
    if (!el) return;

    // Behörighetskontroll
    if (typeof Auth !== 'undefined' && !Auth.can('admin')) {
      el.innerHTML = '<div class="empty-state" style="padding:60px 20px;text-align:center;">' +
        _ic('lock', 32) + '<h3 style="margin-top:12px">Åtkomst nekad</h3>' +
        '<p>Importfunktionen kräver administratörsbehörighet.</p></div>';
      return;
    }

    el.innerHTML = _html();
    _bindEvents();
    _renderStep();
  }

  function _html() {
    return '<div class="imp-wizard">' +
      '<div class="imp-wizard-header">' +
        '<h2 style="margin:0 0 4px">' + _ic('upload', 20) + ' Importera kunder</h2>' +
        '<p style="margin:0;color:var(--text-muted);font-size:13px">' +
          'Importera kunder från CSV- eller XLSX-fil. Stöder Bokio-export.' +
        '</p>' +
      '</div>' +
      '<nav class="imp-steps" id="imp-steps">' + _stepsHtml() + '</nav>' +
      '<div class="imp-body" id="imp-body"></div>' +
      '<div class="imp-footer" id="imp-footer"></div>' +
    '</div>';
  }

  function _stepsHtml() {
    return STEPS.map(function (s, i) {
      var n = i + 1;
      var cls = 'imp-step';
      if (n < _step) cls += ' imp-step-done';
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
    if (_step === 6) return ''; // Resultatsida har egna knappar
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
    return '<div class="imp-drop-zone" id="imp-drop" onclick="document.getElementById(\'imp-file-input\').click()">' +
      '<input type="file" id="imp-file-input" accept=".csv,.xlsx" style="display:none" onchange="ImportWizardPage._onFileInput(event)">' +
      '<div style="text-align:center;padding:40px 20px;">' +
        '<div style="color:var(--text-muted);margin-bottom:12px">' + _ic('upload-cloud', 40) + '</div>' +
        '<p style="font-size:15px;font-weight:600;margin:0 0 4px">Dra och släpp fil här</p>' +
        '<p style="color:var(--text-muted);font-size:13px;margin:0">eller klicka för att välja fil</p>' +
        '<p style="color:var(--text-muted);font-size:12px;margin:12px 0 0">CSV (semikolon/komma) och XLSX stöds · max 10 MB</p>' +
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
    _file = f;
    _showFileInfo(_ic('file', 14) + ' ' + esc(f.name) + ' (' + _fmtSize(f.size) + ')', 'ok');
    var btn = document.getElementById('imp-btn-next');
    if (btn) btn.disabled = false;

    // Uppdatera drop zone-utseende
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

      // Auto-matcha kolumner direkt
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
    var h = _rawParsed.headers;
    var rows = _rawParsed.rows.slice(0, 5);
    var totalRows = _rawParsed.rows.length;

    var html = '<div style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;">' +
      '<div><strong>' + totalRows + ' rader</strong> · ' + h.length + ' kolumner</div>' +
      '<button class="btn btn-ghost btn-sm" onclick="ImportWizardPage._applyBokioProfile()">' +
        _ic('zap', 14) + ' Använd Bokio-profil' +
      '</button>' +
    '</div>' +
    '<div style="overflow-x:auto">' +
    '<table class="imp-preview-table">' +
    '<thead><tr>' + h.map(function (col) {
      return '<th>' + esc(col) + '</th>';
    }).join('') + '</tr></thead>' +
    '<tbody>';

    rows.forEach(function (row) {
      html += '<tr>' + h.map(function (_, ci) {
        var v = row[ci] != null ? row[ci] : '';
        return '<td title="' + esc(v) + '">' + esc(v.length > 40 ? v.slice(0, 40) + '…' : v) + '</td>';
      }).join('') + '</tr>';
    });

    if (totalRows > 5) {
      html += '<tr><td colspan="' + h.length + '" style="text-align:center;color:var(--text-muted);font-size:12px">' +
        '… och ' + (totalRows - 5) + ' rader till</td></tr>';
    }

    html += '</tbody></table></div>';
    return html;
  }

  function _applyBokioProfile() {
    var profile = ImportExportService.BOKIO_PROFILE;
    _rawParsed.headers.forEach(function (h) {
      if (profile.mappings[h]) {
        _mapping[h] = profile.mappings[h];
      }
    });
    _step = 3;
    _renderStep();
  }

  function _toStep3() {
    _step = 3;
    _renderStep();
  }

  /* ── Steg 3: Kolumnmatchning ─────────────────────────────────────────── */

  var _CUSTOMER_FIELDS = [
    { value: 'name',          label: 'Namn *' },
    { value: 'type',          label: 'Typ (privat/foretag/brf)' },
    { value: 'orgNr',         label: 'Organisationsnummer' },
    { value: 'personnr',      label: 'Personnummer' },
    { value: 'firstName',     label: 'Förnamn' },
    { value: 'lastName',      label: 'Efternamn' },
    { value: 'contactPerson', label: 'Kontaktperson' },
    { value: 'phone',         label: 'Telefon' },
    { value: 'email',         label: 'E-post' },
    { value: 'address',       label: 'Adress' },
    { value: 'zip',           label: 'Postnummer' },
    { value: 'city',          label: 'Ort' },
    { value: 'invoiceAddress',label: 'Fakturaadress' },
    { value: 'invoiceZip',    label: 'Faktura postnummer' },
    { value: 'invoiceCity',   label: 'Faktura ort' },
    { value: 'customerNumber',label: 'Kundnummer' },
    { value: 'externalId',    label: 'Externt ID' },
    { value: 'externalSystem',label: 'Externt system' },
    { value: 'paymentTerms',  label: 'Betalningsvillkor (dagar)' },
    { value: 'note',          label: 'Anteckning' }
  ];

  function _step3() {
    var html = '<div style="margin-bottom:16px;display:flex;align-items:center;gap:8px;">' +
      '<button class="btn btn-ghost btn-sm" onclick="ImportWizardPage._applyAutoMatch()">' +
        _ic('cpu', 14) + ' Auto-matcha' +
      '</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="ImportWizardPage._applyBokioProfile()">' +
        _ic('zap', 14) + ' Bokio-profil' +
      '</button>' +
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
          _CUSTOMER_FIELDS.map(function (f) {
            return '<option value="' + f.value + '"' + (selected === f.value ? ' selected' : '') + '>' + f.label + '</option>';
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
    // Kontrollera att minst "name" är mappat
    var haName = Object.values(_mapping).some(function (v) { return v === 'name'; });
    if (!haName) {
      _showError('imp-body', 'Minst fältet "Namn" måste vara mappat för att kunna importera.');
      return;
    }
    _step = 4;
    _validated = _validateRows();
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

  /**
   * Dublettdetektering — prioritetsordning:
   * 1. orgNr (starkast)
   * 2. externalId
   * 3. customerNumber
   * 4. email
   * 5. name + city
   */
  function _validateRows() {
    var results = [];
    var headers = _rawParsed.headers;
    var rows    = _rawParsed.rows;

    function mapRow(row) {
      var obj = {};
      headers.forEach(function (h, ci) {
        var field = _mapping[h];
        if (field) obj[field] = (row[ci] || '').trim();
      });
      return obj;
    }

    function findDuplicate(mapped) {
      var customers = state.customers;
      for (var i = 0; i < customers.length; i++) {
        var c = customers[i];
        if (mapped.orgNr && c.orgNr && mapped.orgNr === c.orgNr)           return { match: 'orgNr', customer: c };
        if (mapped.externalId && c.externalId && mapped.externalId === c.externalId) return { match: 'externalId', customer: c };
        if (mapped.customerNumber && c.customerNumber && mapped.customerNumber === c.customerNumber) return { match: 'customerNumber', customer: c };
        if (mapped.email && c.email && mapped.email.toLowerCase() === c.email.toLowerCase())  return { match: 'email', customer: c };
        if (mapped.name && c.name && mapped.city && c.city &&
            mapped.name.toLowerCase() === c.name.toLowerCase() &&
            mapped.city.toLowerCase() === c.city.toLowerCase())   return { match: 'name+ort', customer: c };
      }
      return null;
    }

    rows.forEach(function (row, ri) {
      var mapped   = mapRow(row);
      var errors   = [];
      var warnings = [];

      if (!mapped.name) errors.push('Namn saknas');

      var dup = findDuplicate(mapped);
      var status = errors.length ? 'error' : (dup ? 'duplicate' : 'new');

      results.push({
        rowIndex: ri + 2,  // 1-indexerat, rad 1 = rubriker
        row:      row,
        mapped:   mapped,
        status:   status,
        duplicate: dup,
        errors:   errors,
        warnings: warnings
      });

      // Defaultval för konflikter: uppdatera befintlig
      if (dup && !_conflicts[ri]) _conflicts[ri] = 'update';
    });

    return results;
  }

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
          '<span class="imp-row-name">' + esc(v.mapped.name || '(tomt)') + '</span>' +
          '<span class="imp-row-msg">' + v.errors.join(', ') + '</span>' +
        '</div>';
      });
      html += '</div>';
    }

    if (stats.dup > 0) {
      html += '<div class="imp-section-title" style="margin-top:16px">Dubbletter — välj åtgärd per rad</div>' +
        '<div class="imp-row-list">';
      _validated.filter(function (v) { return v.status === 'duplicate'; }).forEach(function (v, i) {
        var ri = v.rowIndex - 2;
        var action = _conflicts[ri] || 'update';
        var matchLabel = { orgNr: 'Org.nr', externalId: 'Ext.ID', customerNumber: 'Kundnr', email: 'E-post', 'name+ort': 'Namn+ort' };
        html += '<div class="imp-row-item imp-row-dup">' +
          '<span class="imp-row-num">Rad ' + v.rowIndex + '</span>' +
          '<span class="imp-row-name">' + esc(v.mapped.name || '') + '</span>' +
          '<span class="imp-row-match bdg bdg-orange">' + (matchLabel[v.duplicate.match] || v.duplicate.match) + '</span>' +
          '<span class="imp-row-actions">' +
            '<select class="imp-conflict-sel" data-ri="' + ri + '" onchange="ImportWizardPage._onConflict(this)">' +
              ['skip', 'update', 'create'].map(function (opt) {
                var labels = { skip: 'Hoppa över', update: 'Uppdatera befintlig', create: 'Skapa ny' };
                return '<option value="' + opt + '"' + (action === opt ? ' selected' : '') + '>' + labels[opt] + '</option>';
              }).join('') +
            '</select>' +
          '</span>' +
        '</div>';
      });
      html += '</div>';
    }

    if (stats.ok === 0 && stats.dup === 0) {
      html += '<div class="empty-state" style="padding:30px;text-align:center;">' +
        _ic('alert-circle', 24) + '<p>Inga importerbara rader hittades.</p></div>';
    }

    return html;
  }

  function _statChip(n, label, color) {
    var colors = { green: 'var(--green)', orange: 'var(--orange)', red: 'var(--red)' };
    return '<div class="imp-stat-chip" style="border-color:' + colors[color] + '">' +
      '<span style="font-size:22px;font-weight:800;color:' + colors[color] + '">' + n + '</span>' +
      '<span style="color:var(--text-muted);font-size:12px">' + label + '</span>' +
    '</div>';
  }

  function _onConflict(sel) {
    var ri = parseInt(sel.getAttribute('data-ri'), 10);
    _conflicts[ri] = sel.value;
  }

  function _toStep5() {
    _step = 5;
    _renderStep();
  }

  /* ── Steg 5: Bekräftelse ─────────────────────────────────────────────── */

  function _step5() {
    var toCreate = 0, toUpdate = 0, toSkip = 0;

    _validated.forEach(function (v, i) {
      var ri = v.rowIndex - 2;
      if (v.status === 'error')     { toSkip++; return; }
      if (v.status === 'new')       { toCreate++; return; }
      var action = _conflicts[ri] || 'update';
      if (action === 'skip')   toSkip++;
      else if (action === 'update') toUpdate++;
      else if (action === 'create') toCreate++;
    });

    var html = '<div style="margin-bottom:24px;">' +
      '<p style="font-size:14px;margin:0 0 16px">Granskat ' + _validated.length + ' rader. Klicka <strong>Importera</strong> för att genomföra.</p>' +
      '<div class="imp-confirm-summary">' +
        _confirmRow(_ic('user-plus', 14), toCreate, 'Skapas', 'var(--green)') +
        _confirmRow(_ic('edit', 14),      toUpdate, 'Uppdateras', 'var(--sky)') +
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

    var createdIds       = [];
    var updatedSnapshots = [];
    var errorRows        = [];
    var createdCount     = 0;
    var updatedCount     = 0;
    var skippedCount     = 0;

    _validated.forEach(function (v) {
      var ri = v.rowIndex - 2;

      if (v.status === 'error') {
        skippedCount++;
        errorRows.push({ row: v.rowIndex, field: v.errors.join(', '), message: 'Hoppas över pga fel' });
        return;
      }

      if (v.status === 'new') {
        var newCu = Object.assign(Schema.customer(), v.mapped, {
          id:        newId(state.customers, 'KU'),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        _coerceTypes(newCu);
        state.customers.push(newCu);
        createdIds.push(newCu.id);
        createdCount++;
        return;
      }

      // Dubblett
      var action = _conflicts[ri] || 'update';
      if (action === 'skip') {
        skippedCount++;
        return;
      }
      if (action === 'create') {
        var newCu2 = Object.assign(Schema.customer(), v.mapped, {
          id:        newId(state.customers, 'KU'),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        _coerceTypes(newCu2);
        state.customers.push(newCu2);
        createdIds.push(newCu2.id);
        createdCount++;
        return;
      }
      if (action === 'update') {
        var existing = v.duplicate.customer;
        updatedSnapshots.push({ id: existing.id, before: Object.assign({}, existing) });
        // Merge: befintliga fält behålls om det importerade värdet är tomt
        Object.keys(v.mapped).forEach(function (k) {
          if (v.mapped[k] !== '' && v.mapped[k] != null) {
            existing[k] = v.mapped[k];
          }
        });
        existing.updatedAt = new Date().toISOString();
        _coerceTypes(existing);
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

  function _coerceTypes(cu) {
    // paymentTerms ska vara ett heltal
    if (cu.paymentTerms !== '') {
      var n = parseInt(cu.paymentTerms, 10);
      cu.paymentTerms = isNaN(n) ? 30 : n;
    }
    // active
    if (typeof cu.active === 'string') {
      cu.active = cu.active.toLowerCase() !== 'nej' && cu.active !== '0' && cu.active !== 'false';
    }
    // type: normalisera svenska värden
    var typeMap = { privatperson: 'privat', företag: 'foretag', bostadsrättsförening: 'brf' };
    if (cu.type && typeMap[cu.type.toLowerCase()]) cu.type = typeMap[cu.type.toLowerCase()];
  }

  /* ── Steg 6: Resultat ────────────────────────────────────────────────── */

  function _step6() {
    var log = _lastLogId ? state.importLogs.find(function (l) { return l.id === _lastLogId; }) : null;
    if (!log) return '<p>Import slutförd.</p>';

    var html = '<div class="imp-result">' +
      '<div class="imp-result-icon">' + _ic('check-circle', 40) + '</div>' +
      '<h3 style="margin:12px 0 4px">Import slutförd!</h3>' +
      '<div class="imp-stats-row" style="justify-content:center;margin:16px 0">' +
        _statChip(log.createdCount,  'Skapade',     'green') +
        _statChip(log.updatedCount,  'Uppdaterade', 'sky' ) +
        _statChip(log.skippedCount,  'Hoppade',     'orange') +
        _statChip(log.errorCount,    'Fel',          'red') +
      '</div>' +
      (log.errors && log.errors.length
        ? '<details style="margin:8px 0"><summary style="cursor:pointer;font-size:13px">Visa ' + log.errors.length + ' felposter</summary>' +
          '<ul style="font-size:12px;margin-top:8px">' +
            log.errors.map(function (e) { return '<li>Rad ' + e.row + ': ' + esc(e.message) + '</li>'; }).join('') +
          '</ul></details>'
        : '') +
      '<div style="display:flex;gap:8px;justify-content:center;margin-top:20px;">' +
        '<button class="btn btn-ghost" onclick="ImportWizardPage._undoLast()">' + _ic('rotate-ccw', 14) + ' Ångra import</button>' +
        '<button class="btn btn-primary" onclick="Router.go(\'pg-crm\')">' + _ic('users', 14) + ' Till kundregister</button>' +
        '<button class="btn btn-ghost" onclick="ImportWizardPage._reset()">' + _ic('upload', 14) + ' Ny import</button>' +
      '</div>' +
    '</div>';

    return html;
  }

  function _undoLast() {
    if (!_lastLogId) return;
    if (!confirm('Ångra importen? Skapade kunder raderas och uppdaterade återställs.')) return;
    var result = ImportExportService.undoImport(_lastLogId);
    var msg = 'Ångrat: ' + result.removed + ' borttagna, ' + result.restored + ' återställda.';
    if (result.errors.length) msg += '\n\nFel:\n' + result.errors.join('\n');
    alert(msg);
    Router.go('pg-crm');
  }

  function _reset() {
    _step      = 1;
    _file      = null;
    _rawParsed = null;
    _mapping   = {};
    _validated = [];
    _conflicts = {};
    _lastLogId = null;
    _renderStep();
  }

  /* ── Event-binding ───────────────────────────────────────────────────── */

  function _bindEvents() {
    // Drag-and-drop på hela sidan (aktiv på steg 1)
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
    // ingenting extra behövs — onclick-hanterare är inline
  }

  function _back() {
    if (_step > 1 && _step < 6) {
      _step--;
      _renderStep();
    }
  }

  /* ── Publikt API ─────────────────────────────────────────────────────── */

  return {
    render:            render,
    _parseFile:        _parseFile,
    _applyBokioProfile:_applyBokioProfile,
    _applyAutoMatch:   _applyAutoMatch,
    _onMappingChange:  _onMappingChange,
    _toStep3:          _toStep3,
    _toStep4:          _toStep4,
    _toStep5:          _toStep5,
    _onConflict:       _onConflict,
    _runImport:        _runImport,
    _undoLast:         _undoLast,
    _reset:            _reset,
    _back:             _back,
    _onFileInput:      _onFileInput
  };

})();
