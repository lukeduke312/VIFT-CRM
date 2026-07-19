/**
 * SelectionModel.js — Återanvändbar markeringsmodell för listsidor
 * F4-11: Markerad export
 *
 * Singleton som håller markeringar per entityType.
 * Sidorna anropar init(), toggle(), selectAllVisible(), clearAll() och getSelected().
 * En flytande action-bar visas automatiskt när markeringar finns.
 *
 * Säkerhet: SelectionModel exponerar aldrig känslig data — den hanterar bara ID-listor.
 */

const SelectionModel = (function () {

  var _entityType = null;
  var _selected   = new Set();
  var _bar        = null;   /* Flytande action-bar-elementet */

  function _ic(name, size) {
    return typeof ic !== 'undefined' ? ic(name, size || 16) : '';
  }

  /* ── Init ────────────────────────────────────────────────────────────── */

  /**
   * Anropas av en listsida när den renderar. Rensar föregående markering
   * om entityType byts (skyddar mot förvirring vid sidbyte).
   */
  function init(entityType) {
    if (_entityType !== entityType) {
      _selected.clear();
    }
    _entityType = entityType;
    _removeBar();
  }

  /* ── Markering ───────────────────────────────────────────────────────── */

  function toggle(id) {
    if (_selected.has(id)) _selected.delete(id);
    else _selected.add(id);
    _syncCheckboxes();
    _renderBar();
  }

  function selectAllVisible(ids) {
    (ids || []).forEach(function (id) { _selected.add(id); });
    _syncCheckboxes();
    _renderBar();
  }

  function clearAll() {
    _selected.clear();
    _syncCheckboxes();
    _removeBar();
  }

  function isSelected(id) { return _selected.has(id); }
  function count()        { return _selected.size; }
  function getSelected()  { return Array.from(_selected); }

  /**
   * Returnerar poster från ett state-register som är markerade.
   * stateKey: t.ex. 'workOrders'
   */
  function getSelectedItems(stateKey) {
    if (!stateKey || typeof state === 'undefined') return [];
    var arr = state[stateKey] || [];
    return arr.filter(function (item) { return _selected.has(item.id); });
  }

  /* ── HTML-hjälpare ───────────────────────────────────────────────────── */

  /**
   * Returnerar HTML-sträng för en checkbox som sitter överst-vänster
   * på ett listkort. Anropas i renderingsfunktionen per rad.
   * onclick="event.stopPropagation()" hindrar att kortet öppnas.
   */
  function checkboxHtml(id) {
    var checked = _selected.has(id) ? 'checked' : '';
    return '<input type="checkbox" class="_sel-cb" data-sel-id="' + id + '" ' + checked +
      ' onchange="SelectionModel.toggle(\'' + id + '\')" onclick="event.stopPropagation()"' +
      ' style="width:15px;height:15px;flex-shrink:0;cursor:pointer;accent-color:var(--acc);">';
  }

  /**
   * Returnerar HTML-sträng för "välj alla synliga"-checkbox.
   * visibleIds: array med alla ID:n som syns nu.
   */
  function selectAllHtml(visibleIds) {
    var allSelected = visibleIds.length > 0 && visibleIds.every(function (id) { return _selected.has(id); });
    var idsJson = JSON.stringify(visibleIds);
    return '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;color:var(--mt);">' +
      '<input type="checkbox" ' + (allSelected ? 'checked' : '') +
        ' onchange="SelectionModel.' + (allSelected ? 'clearAll' : 'selectAllVisible') + '(' + (allSelected ? '' : idsJson) + ')"' +
        ' onclick="event.stopPropagation()"' +
        ' style="width:14px;height:14px;accent-color:var(--acc);">' +
      ' Välj alla' +
    '</label>';
  }

  /* ── Flytande action-bar ─────────────────────────────────────────────── */

  function _renderBar() {
    if (_selected.size === 0) { _removeBar(); return; }

    var cfg = _entityType
      ? (typeof ImportExportService !== 'undefined' && ImportExportService.getConfig ? ImportExportService.getConfig(_entityType) : null)
      : null;
    var label = cfg ? cfg.label.toLowerCase() : 'poster';

    if (!_bar) {
      _bar = document.createElement('div');
      _bar.id = '_sel-bar';
      _bar.style.cssText = [
        'position:fixed;bottom:calc(56px + env(safe-area-inset-bottom));left:50%;',
        'transform:translateX(-50%);z-index:8000;',
        'background:var(--navy);color:#fff;',
        'border-radius:32px;padding:10px 16px;',
        'display:flex;align-items:center;gap:10px;',
        'box-shadow:0 4px 20px rgba(0,0,0,.35);',
        'font-size:13px;white-space:nowrap;max-width:calc(100vw - 32px);',
        'animation:sel-bar-in .15s ease-out;'
      ].join('');
      /* CSS-animation */
      if (!document.getElementById('_sel-bar-style')) {
        var s = document.createElement('style');
        s.id = '_sel-bar-style';
        s.textContent = '@keyframes sel-bar-in{from{opacity:0;transform:translateX(-50%) translateY(12px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';
        document.head.appendChild(s);
      }
      document.body.appendChild(_bar);
    }

    _bar.innerHTML =
      '<span style="font-weight:700;">' + _selected.size + ' ' + label + ' markerade</span>' +
      '<button style="background:rgba(255,255,255,.15);border:none;border-radius:16px;color:#fff;cursor:pointer;font-size:12px;padding:4px 10px;font-weight:600;" ' +
        'onclick="SelectionModel._exportMarked()">' +
        _ic('download', 12) + ' Exportera markerade' +
      '</button>' +
      '<button style="background:none;border:none;color:rgba(255,255,255,.7);cursor:pointer;font-size:18px;padding:0 4px;line-height:1;" ' +
        'onclick="SelectionModel.clearAll()" title="Avmarkera alla">×</button>';
  }

  function _removeBar() {
    if (_bar) { _bar.remove(); _bar = null; }
  }

  function _exportMarked() {
    if (!_entityType || _selected.size === 0) return;
    var cfg = typeof ImportExportService !== 'undefined' && ImportExportService.getConfig
      ? ImportExportService.getConfig(_entityType) : null;
    if (!cfg) return;

    /* Hämta markerade poster */
    var items;
    if (cfg.exportFn) {
      /* Nästlade register: filtrera med exportFn-rader är svårt; visa info */
      if (typeof showToast !== 'undefined') showToast('Export av markerade stöds ej för nästlade register.');
      return;
    } else {
      items = getSelectedItems(cfg.stateKey);
    }

    if (!items.length) {
      if (typeof showToast !== 'undefined') showToast('Inga markerade poster att exportera.');
      return;
    }

    ImportExportService.showExportMenu(_entityType, _bar, items, 'markerade');
  }

  /* ── Synka checkboxar ────────────────────────────────────────────────── */

  function _syncCheckboxes() {
    var cbs = document.querySelectorAll('._sel-cb');
    cbs.forEach(function (cb) {
      var id = cb.getAttribute('data-sel-id');
      if (id) cb.checked = _selected.has(id);
    });
    /* Uppdatera select-all */
    var saAll = document.querySelectorAll('._sel-all');
    saAll.forEach(function (cb) {
      /* Heuristic: checked om alla synliga är markerade */
      var allCbs = document.querySelectorAll('._sel-cb');
      var allIds = Array.from(allCbs).map(function (c) { return c.getAttribute('data-sel-id'); }).filter(Boolean);
      cb.checked = allIds.length > 0 && allIds.every(function (id) { return _selected.has(id); });
    });
  }

  /* ── Publikt API ─────────────────────────────────────────────────────── */

  return {
    init:              init,
    toggle:            toggle,
    selectAllVisible:  selectAllVisible,
    clearAll:          clearAll,
    isSelected:        isSelected,
    count:             count,
    getSelected:       getSelected,
    getSelectedItems:  getSelectedItems,
    checkboxHtml:      checkboxHtml,
    selectAllHtml:     selectAllHtml,
    _exportMarked:     _exportMarked,
    _renderBar:        _renderBar
  };

})();
