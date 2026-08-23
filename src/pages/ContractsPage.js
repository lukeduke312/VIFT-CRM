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
  function _fmtDate(d)  { if (!d) return '—'; try { return new Date(d+'T12:00:00').toLocaleDateString('sv-SE'); } catch(e){ return d; } }
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
  function render(params) {
    const el = document.getElementById('pg-contracts-content');
    if (!el) return;

    if (params && params.contractId) { _openDetail(params.contractId); return; }

    const list = _filtered().sort((a,b)=>((b.createdAt||'')>(a.createdAt||''))?1:-1);

    /* KPI */
    const all    = state.contracts || [];
    const active = all.filter(c=>c.status==='aktiv');
    const totalArr = active.reduce((s,c)=>s+(_annualValue(c)),0);

    /* Statusfilterknappar */
    const statusBtns = [{ key:'', label:'Alla' }].concat(CONTRACT_STATUSES).map(function(s) {
      const active_cls = _filter.status === s.key ? 'bp' : 'bs';
      return `<button class="btn ${active_cls}" style="font-size:11px;" onclick="ContractsPage._setFilter('status','${esc(s.key)}')">${esc(s.label)}</button>`;
    }).join('');

    const typeOpts = [{ key:'', label:'Alla typer' }].concat(CONTRACT_TYPES)
      .map(t=>`<option value="${esc(t.key)}"${_filter.type===t.key?' selected':''}>${esc(t.label)}</option>`).join('');

    const rows = list.length === 0
      ? `<div style="text-align:center;padding:32px;color:var(--mt);font-size:13px;">Inga avtal matchar filtret.</div>`
      : list.map(_rowHtml).join('');

    el.innerHTML = `
    <div class="page-header">
      <div>
        <h1 style="font-size:20px;font-weight:700;margin:0;">Kontrakt</h1>
        <div style="font-size:12px;color:var(--mt);margin-top:2px;">${list.length} avtal</div>
      </div>
      <button class="btn bp" onclick="ContractsPage._openForm(null)">${ic('plus',12)} Nytt avtal</button>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center;">
      <div style="display:flex;gap:4px;flex-wrap:wrap;">${statusBtns}</div>
      <select onchange="ContractsPage._setFilter('type',this.value)" style="font-size:12px;padding:5px 8px;border:1px solid var(--br);border-radius:6px;background:var(--bg);color:var(--tx);">${typeOpts}</select>
      <input type="search" placeholder="Sök avtal…" value="${esc(_filter.search)}"
        oninput="ContractsPage._setFilter('search',this.value)"
        style="flex:1;min-width:140px;font-size:12px;padding:5px 10px;border:1px solid var(--br);border-radius:6px;background:var(--bg);color:var(--tx);">
    </div>

    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">
      <div class="stat-card"><div class="stat-num">${active.length}</div><div class="stat-lbl">Aktiva avtal</div></div>
      <div class="stat-card"><div class="stat-num">${_fmtMoney(totalArr)}</div><div class="stat-lbl">Årstotal (aktiva)</div></div>
      <div class="stat-card"><div class="stat-num">${all.filter(c=>c.status==='utkast').length}</div><div class="stat-lbl">Utkast</div></div>
      <div class="stat-card"><div class="stat-num">${all.filter(c=>c.status==='avslutad').length}</div><div class="stat-lbl">Avslutade</div></div>
    </div>

    <div style="display:flex;flex-direction:column;gap:8px;">${rows}</div>`;
  }

  function _annualValue(c) {
    const amt = c.amount || 0;
    const factor = { timme:0, dag:0, vecka:52, månad:12, kvartal:4, år:1 };
    return amt * (factor[c.period||'månad'] || 12);
  }

  function _rowHtml(c) {
    const sm = _statusMeta(c.status);
    const tm = _typeMeta(c.type);
    const periLabel = PERIODS.find(p=>p.key===(c.period||'månad'))?.label || '/mån';
    const endLabel  = c.tillsvidare ? 'Tillsvidare' : (c.endDate ? 'Avslutas ' + _fmtDate(c.endDate) : '—');
    return `<div class="card" style="cursor:pointer;" onclick="ContractsPage._openDetail('${esc(c.id)}')">
      <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;flex-wrap:wrap;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:2px;">
            <span style="font-size:13px;font-weight:600;">${esc(c.title||'Namnlöst avtal')}</span>
            <span style="font-size:10px;padding:2px 7px;border-radius:10px;background:${sm.color}22;color:${sm.color};border:1px solid ${sm.color}44;">${esc(sm.label)}</span>
            <span style="font-size:10px;color:var(--mt);padding:2px 6px;border:1px solid var(--br);border-radius:8px;">${esc(tm.label)}</span>
          </div>
          <div style="font-size:11px;color:var(--mt);">${esc(_cuName(c.customerId))} · ${esc(endLabel)}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;">${_fmtMoney(c.amount||0)}<span style="font-size:10px;font-weight:400;color:var(--mt);">${esc(periLabel)}</span></div>
          <div style="font-size:10px;color:var(--mt);">År: ${_fmtMoney(_annualValue(c))}</div>
        </div>
        <div onclick="event.stopPropagation();ContractsPage._openForm('${esc(c.id)}')" class="btn bs" style="font-size:11px;padding:4px 10px;">${ic('edit-2',10)}</div>
      </div>
    </div>`;
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
      body: `<div style="display:flex;flex-direction:column;gap:12px;font-size:13px;">
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <span style="padding:3px 10px;border-radius:10px;background:${sm.color}22;color:${sm.color};border:1px solid ${sm.color}44;font-size:12px;">${esc(sm.label)}</span>
          <span style="padding:3px 10px;border-radius:10px;border:1px solid var(--br);font-size:12px;color:var(--mt);">${esc(tm.label)}</span>
        </div>
        <table style="border-collapse:collapse;width:100%;font-size:12px;">
          <tr><td style="color:var(--mt);padding:3px 0;width:40%;">Kund</td><td>${esc(_cuName(c.customerId))}</td></tr>
          ${c.propertyId?`<tr><td style="color:var(--mt);padding:3px 0;">Fastighet</td><td>${esc((getObj&&getObj(c.propertyId)||{name:c.propertyId}).name||c.propertyId)}</td></tr>`:''}
          <tr><td style="color:var(--mt);padding:3px 0;">Startdatum</td><td>${esc(_fmtDate(c.startDate))}</td></tr>
          <tr><td style="color:var(--mt);padding:3px 0;">Slutdatum</td><td>${c.tillsvidare?'Tillsvidare':esc(_fmtDate(c.endDate))}</td></tr>
          ${c.tillsvidare?`<tr><td style="color:var(--mt);padding:3px 0;">Uppsägningstid</td><td>${c.noticePeriod||3} månader</td></tr>`:''}
          <tr><td style="color:var(--mt);padding:3px 0;">Belopp</td><td>${_fmtMoney(c.amount||0)} ${esc(periLabel)} (${_fmtMoney(_annualValue(c))} / år)</td></tr>
          <tr><td style="color:var(--mt);padding:3px 0;">Auto-förnyelse</td><td>${c.autoRenew?'Ja':'Nej'}</td></tr>
          ${c.note?`<tr><td style="color:var(--mt);padding:3px 0;">Notering</td><td style="white-space:pre-wrap;">${esc(c.note)}</td></tr>`:''}
        </table>
      </div>`,
      buttons: [
        { label: ic('edit-2',11) + ' Redigera', cls:'btn bp', onClick: () => { Modal.close(); _openForm(contractId); } },
        { label: 'Stäng', cls:'btn bs', onClick: () => Modal.close() }
      ]
    });
  }

  /* ── Formulär ─────────────────────────────────────────────── */
  function _openForm(contractId) {
    const c = contractId ? (state.contracts||[]).find(x=>x.id===contractId) : null;
    const isNew = !c;

    const typeOpts  = CONTRACT_TYPES.map(t=>`<option value="${t.key}"${(c?.type||'service')===t.key?' selected':''}>${t.label}</option>`).join('');
    const statusOpts= CONTRACT_STATUSES.map(s=>`<option value="${s.key}"${(c?.status||'utkast')===s.key?' selected':''}>${s.label}</option>`).join('');
    const periOpts  = PERIODS.map(p=>`<option value="${p.key}"${(c?.period||'månad')===p.key?' selected':''}>${p.label}</option>`).join('');
    const propOpts  = [{ id:'', name:'— välj fastighet —' }].concat(
      (state.properties||[]).filter(x=>!x.deleted).map(x=>({ id:x.id, name:x.name||x.objectNumber||x.id }))
        .sort((a,b)=>a.name.localeCompare(b.name,'sv'))
    ).map(x=>`<option value="${x.id}"${(c?.propertyId||'')===x.id?' selected':''}>${esc(x.name)}</option>`).join('');

    Modal.open({
      title: (isNew ? ic('plus',13) : ic('edit-2',13)) + ' ' + (isNew ? 'Nytt avtal' : 'Redigera avtal'),
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
    persist();
    Modal.close();
    render();
    showToast(contractId ? 'Avtal uppdaterat' : 'Avtal skapat');
  }

  /* ── Filter ───────────────────────────────────────────────── */
  function _setFilter(key, val) {
    _filter[key] = val;
    render();
  }

  return { render, _openForm, _openDetail, _setFilter };
})();
