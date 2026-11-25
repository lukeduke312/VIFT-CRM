/**
 * ImportLogPage.js — Importlogg och ångra-funktion
 *
 * Visar alla genomförda importer med status, statistik och ångra-knapp.
 * Tillgänglig via Admin-sidan → Importlogg, eller /importera/logg.
 * Visar historik över ALLA registertyper i en lista — kräver admin_manage.
 */

const ImportLogPage = (function () {

  function render(params) {
    var el = document.getElementById('pg-import-log-content');
    if (!el) return;

    if (typeof Auth !== 'undefined' && !Auth.can('admin_manage')) {
      el.innerHTML = '<div class="empty mx-empty">' +
        ic('lock', 28) + '<h3>Åtkomst nekad</h3>' +
        '<p>Importloggen kräver administratörsbehörighet.</p></div>';
      return;
    }

    el.innerHTML = _html();
  }

  /* V3 2026-11-26: sidtiteln står i toppraden (ingen egen h2 med ikon på
     egen rad); verktygsrad med antal och "Ny import", importer som
     listrader med status, statistik och åtgärder; riktigt tomläge. */
  function _when(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    var ds = (typeof UiKit !== 'undefined') ? UiKit.localDate(d) : iso.slice(0, 10);
    return (typeof fmtDate === 'function' ? fmtDate(ds) : ds) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function _typeLabel(type) {
    var cfg = (typeof ImportExportService !== 'undefined' && ImportExportService.getConfig) ? ImportExportService.getConfig(type) : null;
    var fixed = { customer: 'Kunder', property: 'Fastigheter', object: 'Objekt', article: 'Artiklar', staff: 'Personal' };
    return (cfg && cfg.label) || fixed[type] || type || '—';
  }

  function _html() {
    var logs = (state.importLogs || []).slice().sort(function (a, b) {
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });

    var headerHtml =
      '<div class="mx-bar">' +
        '<span class="mx-count" role="status"><b>' + logs.length + '</b> ' + (logs.length === 1 ? 'import' : 'importer') + ' totalt</span>' +
        '<div class="mx-bar-r">' +
          '<button class="btn bp bsm" onclick="Router.showPage(\'pg-import-wizard\',{type:\'customer\'})">' +
            ic('upload', 14) + ' Ny import' +
          '</button>' +
        '</div>' +
      '</div>';

    if (logs.length === 0) {
      return '<div class="mx-page">' + headerHtml +
        '<div class="empty mx-empty">' +
          ic('inbox', 28) + '<h3>Inga importer ännu</h3><p>Här visas varje import med resultat och möjlighet att ångra.</p>' +
          '<button class="btn bs bsm" onclick="Router.showPage(\'pg-import-wizard\',{type:\'customer\'})">' + ic('upload', 14) + ' Importera kunder</button>' +
        '</div></div>';
    }

    var rows = logs.map(function (log) {
      var undone  = log.undone;
      var performer = log.performedBy ? (getStaff(log.performedBy) || {}).name || log.performedBy : '—';
      var st = log.performedBy ? getStaff(log.performedBy) : null;
      if (st && st.firstName) performer = (st.firstName + ' ' + (st.lastName || '')).trim();

      return '<div class="list-item mx-li imp-log-row' + (undone ? ' imp-log-undone' : '') + '">' +
        '<div class="mx-li-main">' +
          '<div class="list-item-v2-title mx-li-title">' + ic('file-text', 14) + ' ' + esc(log.filename || '—') + '</div>' +
          '<div class="list-item-v2-meta mx-li-meta imp-log-meta">' +
            '<span class="imp-log-date">' + esc(_when(log.createdAt)) + '</span>' +
            '<span><span class="mx-sep">·</span>' + esc(_typeLabel(log.type)) + '</span>' +
            '<span class="imp-log-user"><span class="mx-sep">·</span>' + ic('user', 12) + ' ' + esc(performer) + '</span>' +
          '</div>' +
          '<div class="imp-log-stats">' +
            _statBadge(log.createdCount, 'skapade', 'bdg-green') +
            _statBadge(log.updatedCount, 'uppdaterade', 'bdg-blue') +
            _statBadge(log.skippedCount, 'hoppade', 'bdg-grey') +
            (log.errorCount > 0 ? _statBadge(log.errorCount, 'fel', 'bdg-red') : '') +
          '</div>' +
        '</div>' +
        '<div class="mx-li-side">' +
          '<div class="mx-li-badges">' + (undone ? '<span class="bdg st bdg-grey"><span class="st-dot"></span>Ångrad</span>' : '<span class="bdg st bdg-green"><span class="st-dot"></span>Genomförd</span>') + '</div>' +
          '<div class="imp-log-actions">' +
            (log.errors && log.errors.length
              ? '<button class="btn bghost bsm" onclick="ImportLogPage._showErrors(\'' + esc(log.id) + '\')">' +
                  ic('alert-circle', 13) + ' Visa fel' +
                '</button>'
              : '') +
            (!undone
              ? '<button class="btn bd bsm" onclick="ImportLogPage._confirmUndo(\'' + esc(log.id) + '\')">' +
                  ic('rotate-ccw', 13) + ' Ångra' +
                '</button>'
              : '') +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    return '<div class="mx-page">' + headerHtml + '<div class="mx-li-list imp-log-list">' + rows + '</div></div>';
  }

  function _statBadge(n, label, cls) {
    if (!n) return '';
    return '<span class="bdg ' + cls + '">' + Number(n).toLocaleString('sv-SE') + ' ' + esc(label) + '</span>';
  }

  function _confirmUndo(logId) {
    var log = (state.importLogs || []).find(function (l) { return l.id === logId; });
    if (!log) return;
    var typeLabel = { customer: 'kunder', property: 'fastigheter', object: 'objekt' }[log.type] || log.type;
    var msg = 'Ångra importen?\n\n' +
      'Skapade ' + typeLabel + ' (' + (log.createdCount || 0) + ') raderas.\n' +
      'Uppdaterade ' + typeLabel + ' (' + (log.updatedCount || 0) + ') återställs.\n\n' +
      'Denna åtgärd kan inte ångras.';
    if (!confirm(msg)) return;
    var result = ImportExportService.undoImport(logId);
    var summary = 'Ångrat: ' + result.removed + ' borttagna, ' + result.restored + ' återställda.';
    if (result.errors.length) summary += '\nFel: ' + result.errors.join('; ');
    showToast(summary);
    render();
  }

  function _showErrors(logId) {
    var log = (state.importLogs || []).find(function (l) { return l.id === logId; });
    if (!log || !log.errors || !log.errors.length) return;
    Modal.open({
      title: 'Felposter — ' + (log.filename || log.id),
      body: '<div style="max-height:400px;overflow-y:auto">' +
        '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
          '<thead><tr>' +
            '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--br)">Rad</th>' +
            '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--br)">Fält</th>' +
            '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--br)">Meddelande</th>' +
          '</tr></thead>' +
          '<tbody>' +
          (log.errors || []).map(function (e) {
            return '<tr>' +
              '<td style="padding:5px 8px;border-bottom:1px solid var(--br)">' + esc(String(e.row || '—')) + '</td>' +
              '<td style="padding:5px 8px;border-bottom:1px solid var(--br)">' + esc(e.field || '') + '</td>' +
              '<td style="padding:5px 8px;border-bottom:1px solid var(--br)">' + esc(e.message || '') + '</td>' +
            '</tr>';
          }).join('') +
          '</tbody>' +
        '</table>' +
      '</div>',
      buttons: [{ label: 'Stäng', cls: 'btn bs', onClick: function () { Modal.close(); } }]
    });
  }

  function esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return {
    render:        render,
    _confirmUndo:  _confirmUndo,
    _showErrors:   _showErrors
  };

})();
