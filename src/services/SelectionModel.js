/**
 * SelectionModel.js — Delad markerings- och bulkåtgärdsmodell för listsidor
 *
 * Singleton som håller markeringar per entityType och renderar en delad,
 * konfigurerbar BulkActionBar (SPRINT1). Sidorna anropar init() med en
 * åtgärdskonfiguration, toggle(), selectAllHtml()/selectAllToggle() och
 * clearAll(). Bara EN bulk-bar-implementation för hela VIFT CRM.
 *
 * Säkerhet: SelectionModel exponerar aldrig känslig data — den hanterar bara
 * ID-listor. Varje åtgärd filtreras via Auth.can() innan den visas, och
 * mutationslogiken (action.run/open) måste själv kontrollera behörighet
 * innan den ändrar state — UI-filtrering är inte tillräckligt (SPRINT1 §17).
 */

const SelectionModel = (function () {

  var _entityType  = null;
  var _selected    = new Set();
  var _visibleIds  = [];   /* ID:n som matchar sidans AKTUELLA sök/filter — sätts av selectAllHtml() */
  var _stateKey    = null;
  var _itemsProvider = null; /* V32: alternativ till stateKey för DERIVED items (t.ex. faktureringskön) */
  var _labelSingular = null; /* V32: explicit singular/plural-etikett, kringgår ImportExportService.getConfig */
  var _labelPlural    = null;
  var _selectionSummary = null; /* V32: valfri () => string som visas efter antalet i bulk-baren, t.ex. "· 14 320 kr" */
  var _actions     = [];
  var _busy        = false;
  var _bar         = null; /* Flytande bulk-bar-elementet */

  /* pageId → entityType för de sidor som har en SelectionModel-lista.
     Används bara av onNavigate() (V28 §9) för att veta om ett Router-byte
     lämnar den sida markeringen hör till — ingen duplicerad Router-logik
     per sida, en enda liten karta här istället. */
  /* entityType → den pageId markeringen "hör hemma" på. Flera entityTypes
     kan peka på SAMMA sida (V32: 'invoice' och 'billingSource' delar båda
     pg-invoices — Fakturaunderlag-fliken respektive Att fakturera-fliken)
     eftersom det inte finns en ny route för faktureringskön (SPRINT2 §14). */
  var _ENTITY_OWNER_PAGE = {
    property:      'pg-objects',
    customer:      'pg-crm',
    workOrder:     'pg-ao',
    article:       'pg-articles',
    staff:         'pg-staff',
    invoice:       'pg-invoices',
    billingSource: 'pg-invoices'
  };

  function _ic(name, size) {
    return typeof ic !== 'undefined' ? ic(name, size || 16) : '';
  }

  function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── Init ────────────────────────────────────────────────────────────── */

  /**
   * Anropas av en listsida när den renderar.
   * opts.stateKey — state-nyckel för getSelectedItems (t.ex. 'properties')
   * opts.itemsProvider — V32: () => item[] för DERIVED/beräknade listor som
   *   inte ligger i state[X] (t.ex. BillingQueueService.getCandidates()).
   *   Ömsesidigt uteslutande mot stateKey — itemsProvider tar företräde om
   *   båda saknas som argument till getSelectedItems(). Varje item MÅSTE ha
   *   ett `id`-fält (för billing-candidates: id === sourceKey).
   * opts.labelSingular / opts.labelPlural — V32: explicit "N X markerad(e)"
   *   -text, kringgår ImportExportService.getConfig(entityType) (som bara
   *   känner till riktiga entity-typer, inte derived-vyer som 'billingSource').
   * opts.selectionSummary — V32: () => string, visas i bulk-baren efter
   *   antalet, t.ex. "· 14 320 kr". Valfri, ingen effekt om utelämnad.
   * opts.actions  — array av { id, label, icon, permission, type, destructive, ... }
   *                 type: 'export' | 'confirm' | 'custom' (se _renderBar/runAction)
   *
   * Rensar markeringen bara om entityType faktiskt byts — annars persisterar
   * markeringen genom sök/filter och genom omrenderingar av SAMMA sida
   * (SPRINT1 §7). Bar-elementet ligger i <body> och överlever att sidans
   * innehålls-container byts ut, så den tas INTE bort vid varje render.
   */
  function init(entityType, opts) {
    opts = opts || {};
    if (_entityType !== entityType) {
      _selected.clear();
      _removeBar();
    }
    _entityType = entityType;
    _stateKey   = opts.stateKey || null;
    _itemsProvider = opts.itemsProvider || null;
    _labelSingular = opts.labelSingular || null;
    _labelPlural   = opts.labelPlural || null;
    _selectionSummary = opts.selectionSummary || null;
    _actions    = opts.actions || [];
    _visibleIds = [];
    _busy       = false;
  }

  /* ── Markering ───────────────────────────────────────────────────────── */

  function toggle(id) {
    if (_selected.has(id)) _selected.delete(id);
    else _selected.add(id);
    _syncCheckboxes();
    _syncSelectAllCheckboxes();
    _syncRowStates();
    _renderBar();
  }

  /**
   * "Välj alla"-toggle, bara på FÖRVÄRANDE synliga/filtrerade poster
   * (_visibleIds, satt av selectAllHtml() vid senaste render).
   * Om alla synliga redan är markerade: avmarkera BARA de synliga.
   * Annars: markera de synliga ADDITIVT — poster utanför filtret rörs aldrig.
   * (SPRINT1 §4 + §6 — själva rotorsaken till "Välj alla"-buggen ligger i
   * den gamla selectAllHtml(), se kommentar där nedan.)
   */
  function selectAllToggle() {
    var total = _visibleIds.length;
    var selCount = _visibleIds.filter(function (id) { return _selected.has(id); }).length;
    if (total > 0 && selCount === total) {
      _visibleIds.forEach(function (id) { _selected.delete(id); });
    } else {
      _visibleIds.forEach(function (id) { _selected.add(id); });
    }
    _syncCheckboxes();
    _syncSelectAllCheckboxes();
    _syncRowStates();
    _renderBar();
  }

  /* Bakåtkompatibel — vissa ställen kan fortfarande anropa selectAllVisible(ids) direkt. */
  function selectAllVisible(ids) {
    (ids || []).forEach(function (id) { _selected.add(id); });
    _syncCheckboxes();
    _syncSelectAllCheckboxes();
    _syncRowStates();
    _renderBar();
  }

  function clearAll() {
    _selected.clear();
    _syncCheckboxes();
    _syncSelectAllCheckboxes();
    _syncRowStates();
    _removeBar();
  }

  /**
   * Anropas av Router.showPage() vid varje sidnavigering (V28 §9). Om det
   * finns en aktiv markering och målsidan INTE är listsidan som markeringen
   * hör till, rensas markeringen och bulk-baren tas bort — den ska aldrig
   * ligga kvar ovanpå en orelaterad sida (Dashboard, kunddetalj, Att göra,
   * osv). Markeringen påverkas INTE av att gå till en annan sidas DETALJVY
   * eller av att stanna på samma listsida (sök/filter/flikbyte inom sidan
   * går via init(), inte via Router, och rör redan aldrig markeringen).
   */
  function onNavigate(pageId) {
    if (!_entityType || _selected.size === 0) return;
    var ownPageId = _ENTITY_OWNER_PAGE[_entityType] || null;
    if (ownPageId && pageId !== ownPageId) {
      _selected.clear();
      _removeBar();
    }
  }

  function isSelected(id) { return _selected.has(id); }
  function count()        { return _selected.size; }
  function getSelected()  { return Array.from(_selected); }

  /**
   * Returnerar poster som är markerade — antingen från ett state-register
   * (stateKey, t.ex. 'workOrders') eller, om inget stateKey anges och
   * init() fick en itemsProvider (V32, se init()), från den beräknade
   * listan. itemsProvider används bara när INGET explicit stateKey skickas
   * in, så befintliga anrop (`getSelectedItems('workOrders')`) är opåverkade.
   */
  function getSelectedItems(stateKey) {
    if (!stateKey && _itemsProvider) {
      return _itemsProvider().filter(function (item) { return _selected.has(item.id); });
    }
    var key = stateKey || _stateKey;
    if (!key || typeof state === 'undefined') return [];
    var arr = state[key] || [];
    return arr.filter(function (item) { return _selected.has(item.id); });
  }

  /* ── HTML-hjälpare ───────────────────────────────────────────────────── */

  /**
   * Returnerar HTML-sträng för en checkbox som sitter överst-vänster
   * på ett listkort. Anropas i renderingsfunktionen per rad.
   * onclick="event.stopPropagation()" hindrar att kortet öppnas.
   */
  /* V30 §2: checkboxen är visuellt liten (15px) men får ett större touch-/
     klick-mål via en padded wrapper — själva kryssrutan behöver inte bli
     stor för att vara lätt att träffa. Wrappern stoppar propagation redan
     på klick (inte bara på input), så ett klick precis intill kryssrutan
     aldrig når radens egen onclick (SelectionModel.rowClick). */
  function checkboxHtml(id, ariaLabel) {
    var checked = _selected.has(id) ? 'checked' : '';
    var aria = 'Markera ' + _esc(ariaLabel || id);
    return '<span class="sel-cb-wrap" onclick="event.stopPropagation()">' +
      '<input type="checkbox" class="_sel-cb" data-sel-id="' + id + '" ' + checked +
        ' aria-label="' + aria + '"' +
        ' onchange="SelectionModel.toggle(\'' + id + '\')"' +
        ' style="width:15px;height:15px;flex-shrink:0;cursor:pointer;accent-color:var(--acc);">' +
    '</span>';
  }

  /**
   * Delad radklick-hanterare (V30 §2): om markeringsläge är aktivt (någon
   * post markerad i AKTUELL entityType) togglar ett klick på radens yta
   * markeringen istället för att öppna posten — annars körs openFn (öppnar
   * detaljen) som vanligt. Interaktiva kontroller på raden (checkbox, menyer,
   * knappar, en explicit öppna-ikon) gör alltid event.stopPropagation() och
   * når därför aldrig hit.
   */
  function rowClick(id, openFn) {
    if (_selected.size > 0) {
      toggle(id);
    } else if (typeof openFn === 'function') {
      openFn();
    }
  }

  /**
   * Returnerar HTML-sträng för "välj alla synliga (filtrerade)"-checkbox
   * med korrekt tre-tillstånd (unchecked / indeterminate / checked).
   *
   * ROTORSAK till den tidigare "Välj alla fungerar inte på Fastigheter"-
   * buggen (bekräftad i den gamla koden, SPRINT1 §2/§4): den gamla
   * selectAllHtml() byggde onchange="SelectionModel.selectAllVisible(<JSON>)"
   * genom att klistra in JSON.stringify(visibleIds) — som ALLTID innehåller
   * dubbla citattecken runt varje ID (t.ex. ["PROP-001","PROP-002"]) — rakt
   * in i ett HTML-attribut som SJÄLVT var avgränsat med dubbla citattecken
   * (onchange="..."). Webbläsarens HTML-parser avslutar attributvärdet vid
   * det FÖRSTA citattecknet inuti JSON:en, vilket kapar onchange-koden mitt
   * i anropet (ogiltig JS, klicket gör ingenting synligt). Detta är samma
   * delade funktion för ALLA sidor (Fastigheter/Kunder/Arbetsorder/Artiklar/
   * Personal) — bara Fastigheter var live-verifierad, men samma fel gäller
   * överallt eftersom det är EN funktion, inte sidspecifik kod.
   *
   * Fixen: onchange anropar nu SelectionModel.selectAllToggle() UTAN
   * argument — inga data skrivs längre in i HTML-attributet alls, så inget
   * kan gå sönder oavsett vilka tecken ID:na innehåller. De synliga ID:na
   * sparas istället internt (_visibleIds) och läses av selectAllToggle().
   */
  function selectAllHtml(visibleIds) {
    _visibleIds = (visibleIds || []).slice();
    var total = _visibleIds.length;
    var selCount = _visibleIds.filter(function (id) { return _selected.has(id); }).length;
    var allSelected = total > 0 && selCount === total;

    var html = '<label class="sel-all-label" style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;color:var(--mt);white-space:nowrap;">' +
      '<input type="checkbox" class="_sel-all-cb" ' + (allSelected ? 'checked' : '') +
        ' aria-label="Välj alla i aktuell lista"' +
        ' onchange="SelectionModel.selectAllToggle()"' +
        ' onclick="event.stopPropagation()"' +
        ' style="width:14px;height:14px;accent-color:var(--acc);">' +
      ' Välj alla' +
    '</label>';

    /* Native indeterminate kan bara sättas via JS (inget HTML-attribut) —
       schemaläggs till nästa tick så DOM-noden hunnit skapas av sidans
       el.innerHTML=... som körs direkt efter detta returvärde används. */
    if (typeof setTimeout !== 'undefined') setTimeout(_syncSelectAllCheckboxes, 0);

    return html;
  }

  /* ── Flytande, konfigurerbar BulkActionBar ──────────────────────────── */

  function _labelFor(count) {
    if (_labelSingular && _labelPlural) {
      return count === 1 ? (_labelSingular + ' markerad') : (_labelPlural + ' markerade');
    }
    var cfg = (_entityType && typeof ImportExportService !== 'undefined' && ImportExportService.getConfig)
      ? ImportExportService.getConfig(_entityType) : null;
    var plural   = cfg ? cfg.label.toLowerCase() : 'poster';
    var singular = cfg ? (cfg.labelSingular || cfg.label).toLowerCase() : 'post';
    return count === 1 ? (singular + ' markerad') : (plural + ' markerade');
  }

  /* Fail CLOSED (V29 §7): en action med angiven permission ska nekas —
     inte tillåtas — om Auth av någon anledning inte finns. Tidigare
     (V27/V28) var "Auth undefined" semantiskt fail-OPEN här, vilket är
     fel riktning för en delad säkerhetskomponent även om Auth i praktisk
     produktionsdrift alltid finns. */
  function _actionPermitted(a) {
    if (!a.permission) return true;
    return typeof Auth !== 'undefined' && Auth.can(a.permission);
  }

  function _permittedActions() {
    return (_actions || []).filter(_actionPermitted);
  }

  function _renderBar() {
    if (_selected.size === 0) { _removeBar(); return; }

    var n = _selected.size;
    var actions = _permittedActions();

    if (!_bar) {
      _bar = document.createElement('div');
      _bar.id = '_selbar';
      _bar.className = 'selbar';
      if (!document.getElementById('_selbar-style')) {
        var s = document.createElement('style');
        s.id = '_selbar-style';
        s.textContent = '@keyframes selbar-in{from{opacity:0;transform:translateX(-50%) translateY(12px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';
        document.head.appendChild(s);
      }
      document.body.appendChild(_bar);
      document.addEventListener('keydown', _onEscape);
    }

    var btnHtml = function (a, extra) {
      return '<button type="button" class="selbar-btn' + (a.destructive ? ' selbar-btn-danger' : '') + (extra || '') + '" ' +
        (_busy ? 'disabled' : '') + ' data-action-id="' + _esc(a.id) + '" ' +
        'onclick="SelectionModel.runAction(\'' + a.id + '\', this)" title="' + _esc(a.label) + '">' +
        _ic(a.icon || 'chevron-right', 13) + '<span>' + _esc(a.label) + '</span>' +
        (a.type === 'export' ? _ic('chevron-down', 10) : '') +
      '</button>';
    };

    var desktopActionsHtml = actions.map(function (a) { return btnHtml(a); }).join('');
    var overflowItemsHtml = actions.map(function (a) {
      return '<button type="button" class="selbar-overflow-item' + (a.destructive ? ' selbar-overflow-item-danger' : '') + '" ' +
        (_busy ? 'disabled' : '') + ' onclick="_selbarCloseOverflow();SelectionModel.runAction(\'' + a.id + '\', document.getElementById(\'_selbar-ovf-btn\'))">' +
        _ic(a.icon || 'chevron-right', 14) + '<span>' + _esc(a.label) + '</span>' +
      '</button>';
    }).join('');

    var summaryText = (typeof _selectionSummary === 'function') ? _selectionSummary() : '';
    _bar.className = 'selbar' + (_busy ? ' selbar-busy' : '');
    _bar.innerHTML =
      '<span class="selbar-count">' + n + ' ' + _labelFor(n) + (summaryText ? ' · ' + _esc(summaryText) : '') + '</span>' +
      '<div class="selbar-actions">' + desktopActionsHtml + '</div>' +
      '<div class="selbar-overflow-wrap">' +
        '<button type="button" class="selbar-btn selbar-overflow-btn" id="_selbar-ovf-btn" ' + (_busy ? 'disabled' : '') +
          ' aria-haspopup="menu" aria-expanded="false" onclick="_selbarToggleOverflow(this)">' +
          _ic('more-horizontal', 15) + '<span>Åtgärder</span>' +
        '</button>' +
        '<div class="selbar-overflow-menu" id="_selbar-ovf-menu" role="menu">' + overflowItemsHtml + '</div>' +
      '</div>' +
      '<button type="button" class="selbar-close" ' + (_busy ? 'disabled' : '') +
        ' onclick="SelectionModel.clearAll()" title="Avmarkera alla" aria-label="Avmarkera alla">' + _ic('x', 16) + '</button>';
  }

  function _removeBar() {
    if (_bar) {
      _bar.remove();
      _bar = null;
      document.removeEventListener('keydown', _onEscape);
    }
  }

  function _onEscape(e) {
    if (e.key !== 'Escape') return;
    var ovf = document.getElementById('_selbar-ovf-menu');
    if (ovf && ovf.classList.contains('open')) { ovf.classList.remove('open'); return; }
    var expMenu = document.getElementById('_imp-exp-menu');
    if (expMenu) { expMenu.remove(); return; }
  }

  /* ── Åtgärdsexekvering ───────────────────────────────────────────────── */

  /**
   * Kör en konfigurerad åtgärd. type:
   *  - 'export'  → återanvänder ImportExportService.showExportMenu() rakt av
   *                (ingen ny exportmotor, SPRINT1 §21).
   *  - 'confirm' → visar Modal-bekräftelse (aldrig window.confirm), kör
   *                sedan action.run(ids, items) — som själv ansvarar för
   *                mutation + EN persist() + ev. omrendering av sidan.
   *  - 'custom'  → action.open(ids, items) tar över helt (t.ex. för
   *                statusval eller personaltilldelning som behöver ett eget
   *                formulär innan bekräftelse).
   */
  function runAction(actionId, btnEl) {
    if (_busy) return;
    var action = (_actions || []).find(function (a) { return a.id === actionId; });
    if (!action) return;
    if (!_actionPermitted(action)) {
      if (typeof showToast !== 'undefined') showToast('Du saknar behörighet för denna åtgärd.');
      return;
    }

    var ids = getSelected();
    var items = getSelectedItems();

    if (action.type === 'export') {
      /* Export-boundary (V29 §4): en modul kan deklarera filterItems för
         att begränsa export till anroparens faktiska view-scope, oberoende
         av hur ID:na hamnade i markeringen (t.ex. Arbetsorder + ao_view_own
         — se WorkOrdersPage._canAccessAo()). Generiskt hook i konfigen,
         ingen ny exportmotor, ingen ombyggnad för moduler som inte behöver
         det (filterItems är optional). */
      var exportItems = typeof action.filterItems === 'function' ? action.filterItems(items) : items;
      if (!exportItems.length) {
        if (typeof showToast !== 'undefined') showToast('Inga markerade poster att exportera.');
        return;
      }
      if (typeof ImportExportService !== 'undefined' && ImportExportService.showExportMenu) {
        ImportExportService.showExportMenu(action.exportEntityType || _entityType, btnEl, exportItems, 'markerade');
      }
      return;
    }

    if (action.type === 'custom') {
      action.open(ids, items);
      return;
    }

    if (action.type === 'confirm') {
      var n = ids.length;
      var title = action.confirmTitle ? action.confirmTitle(n) : ('Utför åtgärden på ' + n + ' poster?');
      var detail = action.confirmDetail ? ('<div style="margin-top:6px;font-size:12px;color:var(--mt);">' + action.confirmDetail + '</div>') : '';
      Modal.open({
        title: 'Bekräfta',
        body: '<p style="font-size:14px;line-height:1.5;color:var(--tx);margin:0;">' + title + '</p>' + detail,
        buttons: [
          {
            label: action.confirmButtonLabel ? action.confirmButtonLabel(n) : ('Bekräfta ' + n),
            cls: 'btn ' + (action.destructive ? 'bsu' : 'bp'),
            onClick: function () { Modal.close(); _executeConfirm(action, ids, items); }
          },
          { label: 'Avbryt', cls: 'btn bs', onClick: function () { Modal.close(); } }
        ]
      });
    }
  }

  function _executeConfirm(action, ids, items) {
    if (_busy) return;
    _busy = true;
    _renderBar();
    Promise.resolve().then(function () {
      return action.run(ids, items);
    }).then(function (result) {
      _busy = false;
      var r = result || {};
      /* action.run() ansvarar själv för behörighetskontroll (V28 §1, fail
         closed) och kan returnera { ok:false, error } vid nekad åtgärd —
         då rörs INGENTING: ingen falsk success-toast, markeringen ligger
         kvar (V28 §8) så användaren kan se vad som var markerat. */
      if (r.ok === false) {
        _renderBar();
        if (typeof showToast !== 'undefined') showToast(r.error || 'Du saknar behörighet för denna åtgärd.');
        return;
      }
      var msg = r.message;
      if (!msg) {
        var updated = r.updated != null ? r.updated : ids.length;
        var parts = [];
        if (r.skipped)   parts.push(r.skipped + ' hoppades över' + (r.skipReason ? (' eftersom de ' + r.skipReason) : ''));
        if (r.unchanged) parts.push(r.unchanged + ' var redan oförändrade');
        msg = updated + ' uppdaterade' + (parts.length ? '. ' + parts.join(', ') + '.' : '.');
      }
      clearAll();
      if (typeof showToast !== 'undefined') showToast(msg);
    }).catch(function (err) {
      _busy = false;
      _renderBar();
      console.error('[SelectionModel] Bulkåtgärd misslyckades:', err);
      if (typeof showToast !== 'undefined') showToast('Något gick fel — inget sparades. Försök igen.');
    });
  }

  /* ── Synka checkboxar (efter toggle/selectAllToggle/clearAll) ──────────── */

  function _syncCheckboxes() {
    document.querySelectorAll('._sel-cb').forEach(function (cb) {
      var id = cb.getAttribute('data-sel-id');
      if (id) cb.checked = _selected.has(id);
    });
  }

  function _syncSelectAllCheckboxes() {
    var total = _visibleIds.length;
    var selCount = _visibleIds.filter(function (id) { return _selected.has(id); }).length;
    document.querySelectorAll('._sel-all-cb').forEach(function (cb) {
      cb.checked = total > 0 && selCount === total;
      cb.indeterminate = selCount > 0 && selCount < total;
    });
  }

  /* V31: håller radernas visuella markeringsläge (`.selected`/`.sel-mode`)
     i synk med `_selected` DIREKT vid varje mutation — utan att kräva en
     hel sidrender. V30 satte dessa klasser bara vid render()/renderList()-
     tid, så ett checkbox-klick uppdaterade själva kryssrutan (via
     _syncCheckboxes) men inte radens bakgrund/kant förrän nästa render.
     Varje markeringsbar rad har ett `data-sel-row-id="<id>"`-attribut på
     EXAKT det element som ska ha selected/sel-mode-stylingen (för
     Arbetsorder är det `.ao-list-item`, inte den yttre flex-wrappern) —
     det är den enda kopplingen som behövs, samma mönster som
     `data-sel-id` redan använder för kryssrutorna. */
  function _syncRowStates() {
    var hasSelection = _selected.size > 0;
    document.querySelectorAll('[data-sel-row-id]').forEach(function (row) {
      var id = row.getAttribute('data-sel-row-id');
      row.classList.toggle('selected', _selected.has(id));
      row.classList.toggle('sel-mode', hasSelection);
    });
  }

  /* ── Publikt API ─────────────────────────────────────────────────────── */

  return {
    init:              init,
    toggle:            toggle,
    selectAllToggle:   selectAllToggle,
    selectAllVisible:  selectAllVisible,
    clearAll:          clearAll,
    isSelected:        isSelected,
    count:             count,
    getSelected:       getSelected,
    getSelectedItems:  getSelectedItems,
    checkboxHtml:      checkboxHtml,
    selectAllHtml:     selectAllHtml,
    runAction:         runAction,
    onNavigate:        onNavigate,
    rowClick:          rowClick
  };

})();

/* ── Mobil overflow-meny (öppnas ALLTID uppåt via CSS, se components.css) ── */
function _selbarToggleOverflow(btn) {
  var menu = document.getElementById('_selbar-ovf-menu');
  if (!menu) return;
  var willOpen = !menu.classList.contains('open');
  menu.classList.toggle('open', willOpen);
  btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  if (willOpen) {
    setTimeout(function () { document.addEventListener('click', _selbarOutsideClick, true); }, 10);
  }
}
function _selbarCloseOverflow() {
  var menu = document.getElementById('_selbar-ovf-menu');
  if (menu) menu.classList.remove('open');
  var btn = document.getElementById('_selbar-ovf-btn');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('click', _selbarOutsideClick, true);
}
function _selbarOutsideClick(e) {
  var wrap = document.querySelector('.selbar-overflow-wrap');
  if (wrap && !wrap.contains(e.target)) _selbarCloseOverflow();
}
