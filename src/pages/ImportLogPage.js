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
      el.innerHTML = '<div class="empty-state" style="padding:60px 20px;text-align:center;">' +
        ic('lock', 32) + '<h3 style="margin-top:12px">Åtkomst nekad</h3>' +
        '<p>Importloggen kräver administratörsbehörighet.</p></div>';
      return;
    }

    el.innerHTML = _html();
  }

  function _html() {
    var logs = (state.importLogs || []).slice().sort(function (a, b) {
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });

    var typeLabels = { customer: 'Kunder', property: 'Fastigheter', object: 'Objekt', article: 'Artiklar', staff: 'Personal' };

    var headerHtml =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">' +
        '<div>' +
          '<h2 style="margin:0 0 4px">' + ic('clock', 20) + ' Importlogg</h2>' +
          '<p style="margin:0;color:var(--text-muted);font-size:13px">' + logs.length + ' importer totalt</p>' +
        '</div>' +
        '<button class="btn btn-ghost" onclick="Router.showPage(\'pg-import-wizard\',{type:\'customer\'})">' +
          ic('upload', 14) + ' Ny import' +
        '</button>' +
      '</div>';

    if (logs.length === 0) {
      return headerHtml +
        '<div style="text-align:center;padding:60px 20px;color:var(--text-muted)">' +
          ic('inbox', 36) + '<p style="margin-top:12px">Inga importer genomförda ännu.</p>' +
        '</div>';
    }

    var rows = logs.map(function (log) {
      var date    = log.createdAt ? new Date(log.createdAt).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) : '—';
      var type    = typeLabels[log.type] || log.type;
      var undone  = log.undone;
      var performer = log.performedBy ? (getStaff(log.performedBy) || {}).name || log.performedBy : '—';

      return '<div class="imp-log-row' + (undone ? ' imp-log-undone' : '') + '">' +
        '<div class="imp-log-meta">' +
          '<span class="imp-log-date">' + date + '</span>' +
          '<span class="imp-log-type bdg bdg-sky">' + type + '</span>' +
          '<span class="imp-log-filename">' + esc(log.filename || '—') + '</span>' +
          '<span class="imp-log-user">' + esc(performer) + '</span>' +
          (undone ? '<span class="bdg bdg-grey">Ångrad</span>' : '') +
        '</div>' +
        '<div class="imp-log-stats">' +
          _statBadge(log.createdCount, 'Skapade', 'bdg-green') +
          _statBadge(log.updatedCount, 'Uppdaterade', 'bdg-sky') +
          _statBadge(log.skippedCount, 'Hoppade', 'bdg-grey') +
          (log.errorCount > 0 ? _statBadge(log.errorCount, 'Fel', 'bdg-red') : '') +
        '</div>' +
        '<div class="imp-log-actions">' +
          (log.errors && log.errors.length
            ? '<button class="btn btn-ghost btn-sm" onclick="ImportLogPage._showErrors(\'' + log.id + '\')">' +
                ic('alert-circle', 12) + ' Visa fel' +
              '</button>'
            : '') +
          (!undone
            ? '<button class="btn btn-ghost btn-sm" onclick="ImportLogPage._confirmUndo(\'' + log.id + '\')">' +
                ic('rotate-ccw', 12) + ' Ångra' +
              '</button>'
            : '') +
        '</div>' +
      '</div>';
    }).join('');

    return headerHtml + '<div class="imp-log-list">' + rows + '</div>';
  }

  function _statBadge(n, label, cls) {
    if (!n) return '';
    return '<span class="bdg ' + cls + '" title="' + label + '">' + n + ' ' + label + '</span>';
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
              '<td style="padding:5px 8px;border-bottom:1px solid var(--br)">' + (e.row || '—') + '</td>' +
              '<td style="padding:5px 8px;border-bottom:1px solid var(--br)">' + esc(e.field || '') + '</td>' +
              '<td style="padding:5px 8px;border-bottom:1px solid var(--br)">' + esc(e.message || '') + '</td>' +
            '</tr>';
          }).join('') +
          '</tbody>' +
        '</table>' +
      '</div>',
      buttons: [{ label: 'Stäng', cls: 'btn btn-ghost', onClick: function () { Modal.close(); } }]
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
