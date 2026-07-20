/**
 * PayrollPage — Löneunderlag per personal (Punkt 76)
 *
 * Visar tidrapporter per person och period med atteststatus.
 * Stöder periodfilter (månad/år), personalfilter, bulk-attestering och CSV-export.
 */
const PayrollPage = (function() {

  /* ── State ─────────────────────────────────────────────── */
  let _period  = null;   // { year, month } — null = aktuell månad
  let _staffId = '';     // '' = alla personal

  /* ── Hjälp ──────────────────────────────────────────────── */
  function _currentPeriod() {
    if (_period) return _period;
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() + 1 };
  }

  function _periodLabel(p) {
    const d = new Date(p.year, p.month - 1, 1);
    return d.toLocaleDateString('sv-SE', { year: 'numeric', month: 'long' });
  }

  function _inPeriod(entry, p) {
    if (!entry.date) return false;
    const [y, m] = entry.date.split('-').map(Number);
    return y === p.year && m === p.month;
  }

  function _hrs(minutes) { return (minutes / 60).toFixed(2); }
  function _fmtDate(d) {
    if (!d) return '—';
    try { return new Date(d + 'T12:00:00').toLocaleDateString('sv-SE', { weekday:'short', month:'short', day:'numeric' }); }
    catch(e) { return d; }
  }
  function _fmtMoney(n) { return new Intl.NumberFormat('sv-SE', { style:'currency', currency:'SEK', maximumFractionDigits:0 }).format(n||0); }
  function _cost(entry) { return ((entry.minutes || 0) / 60) * (entry.hourRate || 0); }

  /* ── Render ─────────────────────────────────────────────── */
  function render(params) {
    const el = document.getElementById('pg-payroll-content');
    if (!Auth.can('reports_view')) {
      if (el) el.innerHTML = `<div class="empty">${ic('lock',36)}<h3>Behörighet saknas</h3><p style="font-size:13px;color:var(--mt);">Du har inte behörighet att visa löneunderlag.</p></div>`;
      return;
    }
    if (params && params.staffId) _staffId = params.staffId;
    if (params && params.year && params.month) _period = { year: Number(params.year), month: Number(params.month) };

    const p = _currentPeriod();
    const entries = (state.timeEntries || []).filter(e => _inPeriod(e, p));
    const staffFilter = _staffId;
    const displayed   = staffFilter ? entries.filter(e => e.staffId === staffFilter) : entries;

    /* Gruppera per staffId */
    const byStaff = {};
    displayed.forEach(function(e) {
      const sid = e.staffId || 'unknown';
      if (!byStaff[sid]) byStaff[sid] = { name: e.staffName || sid, entries: [] };
      byStaff[sid].entries.push(e);
    });

    /* Sortera per staffName */
    const groups = Object.values(byStaff).sort((a,b) => a.name.localeCompare(b.name, 'sv'));

    /* Periodnavigering */
    const prevP = _prevMonth(p);
    const nextP = _nextMonth(p);
    const isThisMonth = _isCurrentMonth(p);

    /* Personal-dropdown */
    const staffOpts = [{ id: '', name: 'Alla personal' }]
      .concat(Array.from(new Set(entries.map(e => e.staffId).filter(Boolean)))
        .map(sid => {
          const s = getStaff(sid);
          return { id: sid, name: s ? (s.name || s.firstName + ' ' + s.lastName).trim() : sid };
        })
        .sort((a,b) => a.name.localeCompare(b.name, 'sv'))
      );

    const staffSelect = '<select id="pr-staff-sel" onchange="PayrollPage._onStaffChange(this.value)" style="font-size:12px;padding:5px 8px;border:1px solid var(--br);border-radius:6px;background:var(--bg);color:var(--tx);">' +
      staffOpts.map(s => `<option value="${esc(s.id)}"${s.id===_staffId?' selected':''}>${esc(s.name)}</option>`).join('') + '</select>';

    /* Totalsummering för vald period */
    const totalMins  = displayed.reduce((s,e) => s + (e.minutes||0), 0);
    const totalCost  = displayed.reduce((s,e) => s + _cost(e), 0);
    const attestedM  = displayed.filter(e=>e.attested).reduce((s,e) => s + (e.minutes||0), 0);

    const summaryHtml = `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
      <div class="stat-card"><div class="stat-num">${_hrs(totalMins)}</div><div class="stat-lbl">Totalt timmar</div></div>
      <div class="stat-card"><div class="stat-num">${_fmtMoney(totalCost)}</div><div class="stat-lbl">Estimerad lönekostnad</div></div>
      <div class="stat-card"><div class="stat-num">${displayed.length}</div><div class="stat-lbl">Rader</div></div>
      <div class="stat-card"><div class="stat-num">${_hrs(attestedM)} / ${_hrs(totalMins)}</div><div class="stat-lbl">Attesterade timmar</div></div>
    </div>`;

    /* Personkort */
    const groupsHtml = groups.length === 0
      ? `<div style="text-align:center;padding:32px;color:var(--mt);font-size:13px;">Inga tidposter registrerade för vald period${staffFilter?' och personal':''}.</div>`
      : groups.map(g => _groupCard(g, p)).join('');

    if (!el) return;

    el.innerHTML = `
    <div class="page-header">
      <div>
        <h1 style="font-size:20px;font-weight:700;margin:0;">Löneunderlag</h1>
        <div style="font-size:12px;color:var(--mt);margin-top:2px;">${esc(_periodLabel(p))} · ${displayed.length} tidposter</div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
        ${staffSelect}
        <button class="btn bs" style="font-size:12px;" onclick="PayrollPage._exportCsv()">${ic('download',11)} CSV</button>
      </div>
    </div>

    <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
      <button class="btn bs" style="font-size:12px;" onclick="PayrollPage._navMonth(${prevP.year},${prevP.month})">${ic('chevron-left',12)} ${_periodLabel(prevP)}</button>
      <span style="font-size:14px;font-weight:600;">${esc(_periodLabel(p))}</span>
      ${!isThisMonth ? `<button class="btn bs" style="font-size:12px;" onclick="PayrollPage._navMonth(${nextP.year},${nextP.month})">${_periodLabel(nextP)} ${ic('chevron-right',12)}</button>` : ''}
      <button class="btn bs" style="font-size:11px;margin-left:auto;" onclick="PayrollPage._navMonth(${new Date().getFullYear()},${new Date().getMonth()+1})">${ic('calendar',11)} Aktuell månad</button>
    </div>

    ${summaryHtml}
    ${groupsHtml}`;
  }

  function _groupCard(g, p) {
    const totalMins = g.entries.reduce((s,e)=>s+(e.minutes||0),0);
    const totalCost = g.entries.reduce((s,e)=>s+_cost(e),0);
    const allAttested = g.entries.length > 0 && g.entries.every(e=>e.attested);
    const someAttested = g.entries.some(e=>e.attested);
    const badgeColor = allAttested ? 'var(--gr)' : someAttested ? 'var(--or)' : 'var(--mt)';
    const badgeLabel = allAttested ? 'Alla attesterade' : someAttested ? 'Delvis attesterad' : 'Ej attesterad';
    const safeId = g.entries[0]?.staffId || 'unknown';

    const rows = g.entries
      .sort((a,b) => (a.date||'').localeCompare(b.date||''))
      .map(e => {
        const ao = getAO(e.aoId);
        const aoLabel = ao ? ao.title || ao.id : (e.aoId || '—');
        return `<tr class="${e.attested?'pr-attested':''}">
          <td style="font-size:11px;white-space:nowrap;">${esc(_fmtDate(e.date))}</td>
          <td style="font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(aoLabel)}</td>
          <td style="font-size:11px;">${e.startStr||'—'}–${e.endStr||'—'}</td>
          <td style="font-size:11px;text-align:right;font-variant-numeric:tabular-nums;">${_hrs(e.minutes||0)} h</td>
          <td style="font-size:11px;text-align:right;font-variant-numeric:tabular-nums;">${_fmtMoney(_cost(e))}</td>
          <td style="font-size:11px;color:var(--mt);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(e.comment||'')}</td>
          <td style="text-align:center;">
            <label style="display:flex;align-items:center;justify-content:center;gap:0;cursor:pointer;">
              <input type="checkbox" ${e.attested?'checked':''} onchange="PayrollPage._toggleAttest('${esc(e.id)}',this.checked)" style="width:15px;height:15px;cursor:pointer;">
            </label>
          </td>
        </tr>`;
      }).join('');

    return `<div class="card" style="margin-bottom:12px;">
      <div class="card-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <h3 style="font-size:14px;font-weight:600;margin:0;">${esc(g.name)}</h3>
          <span style="font-size:10px;padding:2px 6px;border-radius:10px;border:1px solid ${badgeColor};color:${badgeColor};">${badgeLabel}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;font-size:12px;">
          <span style="color:var(--mt);">${_hrs(totalMins)} h · ${_fmtMoney(totalCost)}</span>
          ${!allAttested ? `<button class="btn bp" style="font-size:11px;padding:3px 10px;" onclick="PayrollPage._attestAll('${esc(safeId)}')">${ic('check',10)} Attestera alla</button>` : ''}
        </div>
      </div>
      <div class="card-body" style="padding:0;overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;min-width:580px;">
          <thead>
            <tr style="background:var(--bg);font-size:11px;text-align:left;border-bottom:1px solid var(--br);">
              <th style="padding:6px 10px;">Datum</th>
              <th style="padding:6px 10px;">Arbetsorder</th>
              <th style="padding:6px 10px;">Tid</th>
              <th style="padding:6px 10px;text-align:right;">Timmar</th>
              <th style="padding:6px 10px;text-align:right;">Kostnad</th>
              <th style="padding:6px 10px;">Kommentar</th>
              <th style="padding:6px 10px;text-align:center;">Attesterad</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr style="font-weight:600;border-top:2px solid var(--br);font-size:12px;">
              <td colspan="3" style="padding:6px 10px;color:var(--mt);">Summa</td>
              <td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums;">${_hrs(totalMins)} h</td>
              <td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums;">${_fmtMoney(totalCost)}</td>
              <td colspan="2"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;
  }

  /* ── Attestering ──────────────────────────────────────────── */
  function _toggleAttest(entryId, checked) {
    if (!Auth.can('reports_view')) { showToast('Du saknar behörighet'); return; }
    const e = (state.timeEntries || []).find(x => x.id === entryId);
    if (!e) return;
    const now = new Date().toISOString();
    e.attested    = checked;
    e.attestedAt  = checked ? now : '';
    e.attestedBy  = checked ? ((state.currentUser && state.currentUser.id) || '') : '';
    persist();
    render();
  }

  function _attestAll(staffId) {
    if (!Auth.can('reports_view')) { showToast('Du saknar behörighet'); return; }
    const p = _currentPeriod();
    const now = new Date().toISOString();
    const byId = (state.currentUser && state.currentUser.id) || '';
    (state.timeEntries || []).forEach(function(e) {
      if (e.staffId === staffId && _inPeriod(e, p) && !e.attested) {
        e.attested   = true;
        e.attestedAt = now;
        e.attestedBy = byId;
      }
    });
    persist();
    render();
    showToast('Alla poster attesterade');
  }

  /* ── Navigation ───────────────────────────────────────────── */
  function _navMonth(year, month) {
    _period = { year: Number(year), month: Number(month) };
    render();
  }

  function _onStaffChange(val) {
    _staffId = val;
    render();
  }

  function _prevMonth(p) {
    return p.month === 1 ? { year: p.year - 1, month: 12 } : { year: p.year, month: p.month - 1 };
  }

  function _nextMonth(p) {
    return p.month === 12 ? { year: p.year + 1, month: 1 } : { year: p.year, month: p.month + 1 };
  }

  function _isCurrentMonth(p) {
    const n = new Date();
    return p.year === n.getFullYear() && p.month === n.getMonth() + 1;
  }

  /* ── CSV-export ───────────────────────────────────────────── */
  function _exportCsv() {
    if (!Auth.can('reports_view')) { showToast('Du saknar behörighet'); return; }
    const p = _currentPeriod();
    const entries = (state.timeEntries || [])
      .filter(e => _inPeriod(e, p) && (!_staffId || e.staffId === _staffId))
      .sort((a,b) => (a.date||'').localeCompare(b.date||'') || (a.staffName||'').localeCompare(b.staffName||'', 'sv'));

    const header = ['Datum','Personal','Arbetsorder','Start','Slut','Timmar','Kostnad (SEK)','Kommentar','Attesterad','Attesterad av','Attesterad datum'];
    const rows = entries.map(e => {
      const ao = getAO(e.aoId);
      const attestorName = e.attestedBy ? ((getStaff(e.attestedBy)||{}).name || e.attestedBy) : '';
      return [
        e.date||'',
        e.staffName||'',
        ao ? (ao.title||ao.id) : (e.aoId||''),
        e.startStr||'',
        e.endStr||'',
        _hrs(e.minutes||0),
        Math.round(_cost(e)),
        e.comment||'',
        e.attested ? 'Ja' : 'Nej',
        attestorName,
        e.attestedAt ? e.attestedAt.slice(0,10) : ''
      ];
    });

    const csv = [header].concat(rows).map(r =>
      r.map(v => '"' + String(v).replace(/"/g,'""') + '"').join(',')
    ).join('\r\n');

    const pLabel = _periodLabel(p).replace(' ', '_');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'loneunderlag_' + pLabel + ((_staffId && getStaff(_staffId)) ? '_' + (getStaff(_staffId).name||_staffId).replace(/\s+/g,'_') : '') + '.csv';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showToast('CSV exporterad');
  }

  /* ── Public API ───────────────────────────────────────────── */
  return { render, _navMonth, _onStaffChange, _toggleAttest, _attestAll, _exportCsv };
})();
