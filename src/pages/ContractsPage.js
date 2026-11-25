/**
 * ContractsPage — Kontrakthantering (Punkt 81)
 *
 * CRUD för avtal: lista, skapa, redigera, avsluta.
 * Filter: status, kund, typ.
 */
const ContractsPage = (function() {

  const CONTRACT_TYPES = [
    { key: 'service',    label: 'Serviceavtal'  },
    { key: 'rondering',  label: 'Rondering'     },
    { key: 'städ',       label: 'Städavtal'     },
    { key: 'övrigt',     label: 'Övrigt'        }
  ];
  const CONTRACT_STATUSES = [
    { key: 'utkast',    label: 'Utkast',    color: 'var(--mt)'  },
    { key: 'aktiv',     label: 'Aktiv',     color: 'var(--gr)'  },
    { key: 'pausad',    label: 'Pausad',    color: 'var(--or)'  },
    { key: 'avslutad',  label: 'Avslutad',  color: 'var(--rd)'  }
  ];
  const PERIODS = [
    { key: 'timme',    label: '/timme'  },
    { key: 'dag',      label: '/dag'    },
    { key: 'vecka',    label: '/vecka'  },
    { key: 'månad',    label: '/månad'  },
    { key: 'kvartal',  label: '/kvartal'},
    { key: 'år',       label: '/år'     }
  ];

  let _filter = { status: '', type: '', search: '' };

  /* ── Hjälp ──────────────────────────────────────────────── */
  function _statusMeta(s) { return CONTRACT_STATUSES.find(x=>x.key===s) || { label: s||'—', color:'var(--mt)' }; }
  function _typeMeta(t)   { return CONTRACT_TYPES.find(x=>x.key===t)    || { label: t||'—' }; }
  function _cuName(id) {
    const c = getCu(id);
    if (!c) return id||'—';
    return c.name || (c.firstName + ' ' + (c.lastName||'')).trim() || id;
  }
  /* Svensk datumform som i resten av appen ("26 nov. 2026"). */
  function _fmtDate(d)  { if (!d) return '—'; try { return fmtDate(d); } catch(e){ return d; } }
  function _fmtMoney(n) { return new Intl.NumberFormat('sv-SE', { style:'currency', currency:'SEK', maximumFractionDigits:0 }).format(n||0); }

  function _filtered() {
    return (state.contracts || []).filter(function(c) {
      if (c.deleted) return false;
      if (_filter.status && c.status !== _filter.status) return false;
      if (_filter.type   && c.type   !== _filter.type)   return false;
      if (_filter.search) {
        const s = _filter.search.toLowerCase();
        if (!(c.title||'').toLowerCase().includes(s) &&
            !(_cuName(c.customerId)||'').toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }

  /* ── Render ─────────────────────────────────────────────── */
  /* V3 2026-11-26: verktygsrad (sök + Nytt avtal), nyckeltal, status som
     chips och typ som filter, tabell i kort på dator och kort per rad på
     mobil, riktigt tomläge. Sidtiteln står i toppraden. Sökningen ritar
     bara om resultatet (fältet behåller fokus). */
  function render(params) {
    const el = document.getElementById('pg-contracts-content');
    if (!el) return;

    if (params && params.contractId) { _openDetail(params.contractId); return; }

    const typeOpts = [{ key:'', label:'Alla typer' }].concat(CONTRACT_TYPES)
      .map(t=>`<option value="${esc(t.key)}"${_filter.type===t.key?' selected':''}>${esc(t.label)}</option>`).join('');

    el.innerHTML = `
    <div class="mx-page mx-con">
      <div class="mx-bar">
        <label class="mx-search">${ic('search',15)}
          <input type="search" id="con-search" aria-label="Sök avtal" placeholder="Sök avtal eller kund…" value="${esc(_filter.search)}"
            oninput="ContractsPage._onSearch(this.value)">
        </label>
        <div class="mx-bar-r">
          <button class="btn bp bsm" onclick="ContractsPage._openForm(null)">${ic('plus',14)} Nytt avtal</button>
        </div>
      </div>
      <div class="mx-kpis" id="con-kpis"></div>
      <div class="mx-chiprow"><div class="mx-chips" id="con-chips" role="group" aria-label="Status"></div></div>
      <div class="mx-filters" role="group" aria-label="Filter">
        <select aria-label="Avtalstyp" onchange="ContractsPage._setFilter('type',this.value)">${typeOpts}</select>
        <span id="con-clear"></span>
      </div>
      <div id="con-results"></div>
    </div>`;
    _renderResults();
  }

  let _searchT = null;
  function _onSearch(v) {
    clearTimeout(_searchT);
    _searchT = setTimeout(function () { _filter.search = v; _renderResults(); }, 150);
  }

  function _renderResults() {
    const all    = (state.contracts || []).filter(c => !c.deleted);
    const active = all.filter(c=>c.status==='aktiv');
    const totalArr = active.reduce((s,c)=>s+(_annualValue(c)),0);
    const list = _filtered().sort((a,b)=>((b.createdAt||'')>(a.createdAt||''))?1:-1);

    const kpis = document.getElementById('con-kpis');
    if (kpis) kpis.innerHTML = `
      <div class="mx-kpi tone-ok"><span class="mx-kpi-n">${active.length}</span><span class="mx-kpi-l">Aktiva avtal</span></div>
      <div class="mx-kpi"><span class="mx-kpi-n">${esc(_fmtMoney(totalArr))}</span><span class="mx-kpi-l">Årsvärde (aktiva)</span></div>
      <div class="mx-kpi"><span class="mx-kpi-n">${all.filter(c=>c.status==='utkast').length}</span><span class="mx-kpi-l">Utkast</span></div>
      <div class="mx-kpi"><span class="mx-kpi-n">${all.filter(c=>c.status==='avslutad').length}</span><span class="mx-kpi-l">Avslutade</span></div>`;

    /* Statuschips: antalet per status (oberoende av övriga filter), Alla = totalt. */
    const chips = document.getElementById('con-chips');
    if (chips) chips.innerHTML = [{ key:'', label:'Alla' }].concat(CONTRACT_STATUSES).map(s =>
      UiKit.chip(s.label, `ContractsPage._setFilter('status','${esc(s.key)}')`, { on: _filter.status === s.key, n: s.key ? all.filter(c => c.status === s.key).length : all.length })
    ).join('');

    const any = !!(_filter.status || _filter.type || _filter.search);
    const clr = document.getElementById('con-clear');
    if (clr) clr.innerHTML = any ? `<button class="btn bghost bsm" onclick="ContractsPage._clearFilters()">${ic('x',13)} Rensa filter</button>` : '';

    const res = document.getElementById('con-results');
    if (!res) return;
    if (!list.length) {
      res.innerHTML = all.length
        ? `<div class="empty mx-empty">${ic('search',26)}<h3>Inga avtal matchar filtret</h3><p>Ändra sökningen eller rensa filtren.</p><button class="btn bs bsm" onclick="ContractsPage._clearFilters()">${ic('x',13)} Rensa filter</button></div>`
        : `<div class="empty mx-empty">${ic('file-check',28)}<h3>Inga avtal ännu</h3><p>Registrera serviceavtal, ronderingsavtal och andra löpande avtal med kund, period och belopp.</p><button class="btn bs bsm" onclick="ContractsPage._openForm(null)">${ic('plus',14)} Registrera första avtalet</button></div>`;
      return;
    }
    res.innerHTML = `
      <div class="mx-list-head"><span class="mx-count" role="status">Visar <b>${list.length}</b> av ${all.length} avtal</span></div>
      <div class="dt-wrap mx-ctab-wrap"><div class="dt-scroll">
        <table class="dtab mx-ctab">
          <thead><tr>
            <th>Avtal</th><th>Kund</th><th>Status</th><th>Period</th><th class="c-num">Belopp</th><th class="c-num">Årsvärde</th><th class="c-shrink"><span class="sr-only">Åtgärder</span></th>
          </tr></thead>
          <tbody>${list.map(_rowHtml).join('')}</tbody>
        </table>
      </div></div>`;
  }

  function _clearFilters() {
    _filter = { status: '', type: '', search: '' };
    render();
  }

  function _annualValue(c) {
    const amt = c.amount || 0;
    const factor = { timme:0, dag:0, vecka:52, månad:12, kvartal:4, år:1 };
    return amt * (factor[c.period||'månad'] || 12);
  }

  function _statusBadge(s) {
    const cls = { utkast: 'bdg-grey', aktiv: 'bdg-green', pausad: 'bdg-orange', avslutad: 'bdg-red' }[s] || 'bdg-grey';
    return `<span class="bdg st ${cls}"><span class="st-dot"></span>${esc(_statusMeta(s).label)}</span>`;
  }

  function _rowHtml(c) {
    const tm = _typeMeta(c.type);
    const periLabel = PERIODS.find(p=>p.key===(c.period||'månad'))?.label || '/mån';
    const endLabel  = c.tillsvidare ? 'Tillsvidare' : (c.endDate ? 't.o.m. ' + _fmtDate(c.endDate) : '—');
    const startLabel = c.startDate ? 'Från ' + _fmtDate(c.startDate) : '';
    return `<tr class="mx-ctr" tabindex="0" onclick="ContractsPage._openDetail('${esc(c.id)}')" onkeydown="if(event.key==='Enter')this.click()">
      <td class="mx-c-main"><div class="mx-c-title">${esc(c.title||'Namnlöst avtal')}</div><div class="mx-c-sub">${esc(c.id)} · ${esc(tm.label)}</div></td>
      <td class="mx-c-cu">${esc(_cuName(c.customerId))}</td>
      <td class="mx-c-st">${_statusBadge(c.status)}</td>
      <td class="mx-c-per"><div>${esc(endLabel)}</div>${startLabel ? `<div class="mx-c-sub">${esc(startLabel)}</div>` : ''}</td>
      <td class="c-num mx-c-amt">${esc(_fmtMoney(c.amount||0))}<span class="mx-c-per-u">${esc(periLabel)}</span></td>
      <td class="c-num mx-c-yr"><span class="mx-c-yr-l">År: </span>${esc(_fmtMoney(_annualValue(c)))}</td>
      <td class="c-shrink mx-c-act"><button type="button" class="ibtn" aria-label="Redigera avtal" title="Redigera" onclick="event.stopPropagation();ContractsPage._openForm('${esc(c.id)}')">${ic('pencil',14)}</button></td>
    </tr>`;
  }

  /* ── Detaljvy ─────────────────────────────────────────────── */
  function _openDetail(contractId) {
    const c = (state.contracts||[]).find(x=>x.id===contractId);
    if (!c) return;
    const sm = _statusMeta(c.status);
    const tm = _typeMeta(c.type);
    const periLabel = PERIODS.find(p=>p.key===(c.period||'månad'))?.label || '/mån';
    Modal.open({
      title: esc(c.title||'Avtalsdetalj'),
      body: `<div class="mx-cdet">
        <div class="mx-cdet-b">${_statusBadge(c.status)}<span class="bdg bdg-grey">${esc(tm.label)}</span><span class="mx-cdet-no">${esc(c.id)}</span></div>
        <div class="kv">
          <div class="dr"><span class="dk">Kund</span><span class="dv">${esc(_cuName(c.customerId))}</span></div>
          ${c.propertyId?`<div class="dr"><span class="dk">Fastighet</span><span class="dv">${esc((getObj&&getObj(c.propertyId)||{name:c.propertyId}).name||c.propertyId)}</span></div>`:''}
          <div class="dr"><span class="dk">Startdatum</span><span class="dv">${esc(_fmtDate(c.startDate))}</span></div>
          <div class="dr"><span class="dk">Slutdatum</span><span class="dv">${c.tillsvidare?'Tillsvidare':esc(_fmtDate(c.endDate))}</span></div>
          ${c.tillsvidare?`<div class="dr"><span class="dk">Uppsägningstid</span><span class="dv">${esc(String(c.noticePeriod||3))} månader</span></div>`:''}
          <div class="dr"><span class="dk">Belopp</span><span class="dv">${esc(_fmtMoney(c.amount||0))} ${esc(periLabel)} (${esc(_fmtMoney(_annualValue(c)))} / år)</span></div>
          <div class="dr"><span class="dk">Auto-förnyelse</span><span class="dv">${c.autoRenew?'Ja':'Nej'}</span></div>
          ${c.note?`<div class="dr"><span class="dk">Notering</span><span class="dv" style="white-space:pre-wrap;">${esc(c.note)}</span></div>`:''}
        </div>
      </div>`,
      buttons: [
        { label: ic('pencil',13) + ' Redigera', cls:'btn bp', onClick: () => { Modal.close(); _openForm(contractId); } },
        { label: 'Stäng', cls:'btn bs', onClick: () => Modal.close() }
      ]
    });
  }

  /* ── Formulär ─────────────────────────────────────────────── */
  function _openForm(contractId) {
    const c = contractId ? (state.contracts||[]).find(x=>x.id===contractId) : null;
    const isNew = !c;

    const typeOpts  = CONTRACT_TYPES.map(t=>`<option value="${t.key}"${(c?.type||'service')===t.key?' selected':''}>${esc(t.label)}</option>`).join('');
    const statusOpts= CONTRACT_STATUSES.map(s=>`<option value="${s.key}"${(c?.status||'utkast')===s.key?' selected':''}>${esc(s.label)}</option>`).join('');
    const periOpts  = PERIODS.map(p=>`<option value="${p.key}"${(c?.period||'månad')===p.key?' selected':''}>${esc(p.label)}</option>`).join('');
    const propOpts  = [{ id:'', name:'— välj fastighet —' }].concat(
      (state.properties||[]).filter(x=>!x.deleted).map(x=>({ id:x.id, name:x.name||x.objectNumber||x.id }))
        .sort((a,b)=>a.name.localeCompare(b.name,'sv'))
    ).map(x=>`<option value="${x.id}"${(c?.propertyId||'')===x.id?' selected':''}>${esc(x.name)}</option>`).join('');

    Modal.open({
      title: (isNew ? ic('plus',14) : ic('pencil',14)) + ' ' + (isNew ? 'Nytt avtal' : 'Redigera avtal'),
      body: `<div style="display:flex;flex-direction:column;gap:12px;">
        <div class="fg"><label>Titel *</label><input class="form-control" id="co-title" value="${esc(c?.title||'')}" placeholder="Avtalsnamn"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div class="fg"><label>Typ</label><select class="form-control" id="co-type">${typeOpts}</select></div>
          <div class="fg"><label>Status</label><select class="form-control" id="co-status">${statusOpts}</select></div>
        </div>
        <div class="fg"><label>Kund</label>${CustomerPicker.render('co-cu', { value: c?.customerId || '', placeholder: '— välj kund —' })}</div>
        <div class="fg"><label>Fastighet</label><select class="form-control" id="co-prop">${propOpts}</select></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div class="fg"><label>Startdatum</label><input type="date" class="form-control" id="co-start" value="${esc(c?.startDate||'')}"></div>
          <div class="fg"><label>Slutdatum</label><input type="date" class="form-control" id="co-end" value="${esc(c?.endDate||'')}" ${c?.tillsvidare?'disabled':''}></div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
            <input type="checkbox" id="co-tv" ${c?.tillsvidare?'checked':''} onchange="document.getElementById('co-end').disabled=this.checked;document.getElementById('co-np').disabled=!this.checked;">
            Tillsvidare
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
            <input type="checkbox" id="co-ar" ${c?.autoRenew?'checked':''}> Auto-förnyelse
          </label>
        </div>
        <div class="fg"><label>Uppsägningstid (månader)</label><input type="number" class="form-control" id="co-np" value="${c?.noticePeriod||3}" min="0" max="24" ${c?.tillsvidare?'':'disabled'}></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div class="fg"><label>Belopp (kr)</label><input type="number" class="form-control" id="co-amt" value="${c?.amount||0}" min="0"></div>
          <div class="fg"><label>Period</label><select class="form-control" id="co-per">${periOpts}</select></div>
        </div>
        <div class="fg"><label>Notering</label><textarea class="form-control" id="co-note" rows="2">${esc(c?.note||'')}</textarea></div>
      </div>`,
      okLabel: isNew ? 'Skapa avtal' : 'Spara',
      ok: () => _save(contractId)
    });
  }

  function _save(contractId) {
    const title  = document.getElementById('co-title')?.value.trim();
    if (!title) { showToast('Titel krävs', 'error'); return; }
    const now = new Date().toISOString();
    if (contractId) {
      const c = (state.contracts||[]).find(x=>x.id===contractId);
      if (!c) return;
      c.title        = title;
      c.type         = document.getElementById('co-type')?.value     || 'service';
      c.status       = document.getElementById('co-status')?.value   || 'utkast';
      c.customerId   = document.getElementById('co-cu')?.value       || '';
      c.propertyId   = document.getElementById('co-prop')?.value     || '';
      c.startDate    = document.getElementById('co-start')?.value    || '';
      c.tillsvidare  = document.getElementById('co-tv')?.checked     || false;
      c.endDate      = c.tillsvidare ? '' : (document.getElementById('co-end')?.value || '');
      c.autoRenew    = document.getElementById('co-ar')?.checked     || false;
      c.noticePeriod = parseInt(document.getElementById('co-np')?.value||'3',10);
      c.amount       = parseFloat(document.getElementById('co-amt')?.value||'0');
      c.period       = document.getElementById('co-per')?.value      || 'månad';
      c.note         = document.getElementById('co-note')?.value.trim() || '';
      c.updatedAt    = now;
    } else {
      const c = Object.assign(Schema.contract(), {
        id:           newId(state.contracts||[], 'KON'),
        title,
        type:         document.getElementById('co-type')?.value     || 'service',
        status:       document.getElementById('co-status')?.value   || 'utkast',
        customerId:   document.getElementById('co-cu')?.value       || '',
        propertyId:   document.getElementById('co-prop')?.value     || '',
        startDate:    document.getElementById('co-start')?.value    || '',
        tillsvidare:  document.getElementById('co-tv')?.checked     || false,
        endDate:      document.getElementById('co-tv')?.checked ? '' : (document.getElementById('co-end')?.value || ''),
        autoRenew:    document.getElementById('co-ar')?.checked     || false,
        noticePeriod: parseInt(document.getElementById('co-np')?.value||'3',10),
        amount:       parseFloat(document.getElementById('co-amt')?.value||'0'),
        period:       document.getElementById('co-per')?.value      || 'månad',
        note:         document.getElementById('co-note')?.value.trim() || '',
        createdAt:    now,
        updatedAt:    now
      });
      if (!state.contracts) state.contracts = [];
      state.contracts.push(c);
    }
    Modal.close();
    render();
    /* G12: besked först efter serverns bekräftelse. */
    const savedId = contractId || state.contracts[state.contracts.length - 1].id;
    return confirmPersist('contracts', savedId, { ok: contractId ? 'Avtal uppdaterat' : 'Avtal skapat', fail: 'Avtalet kunde inte sparas', onChange: render });
  }

  /* ── Filter ───────────────────────────────────────────────── */
  function _setFilter(key, val) {
    _filter[key] = val;
    if (document.getElementById('con-results')) _renderResults(); else render();
  }

  return { render, _openForm, _openDetail, _setFilter, _onSearch, _clearFilters };
})();
