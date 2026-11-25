/**
 * PayrollPage — Löneunderlag per personal (Punkt 76)
 *
 * Visar tidrapporter per person och period med atteststatus.
 * Stöder periodfilter (månad/år), personalfilter, bulk-attestering och CSV-export.
 *
 * V3 2026-11-26 (QA F-04, S-02, S-03, S-05, S-10): sidan följer designsystemet
 * — verktygsrad i stället för en egen h1 (titeln finns i toppraden), samma
 * nyckeltalskort som Rapporter (.ar-kpi), en riktig tabell (.ar-tbl: rubrik,
 * cellutfyllnad, zebra/hover, fast rubrikrad) som blir kort under 640 px.
 * Timmar visas som decimaltimmar i svensk form: "26,5 h" (komma, högst två
 * decimaler, inga avslutande nollor). De lagrade värdena (minuter) och
 * CSV-exporten är oförändrade. Behörigheter och skrivvägar (attestering via
 * AOTimeSyncService) är oförändrade.
 * "Estimerad lönekostnad" hette tidigare det som i själva verket är timmar ×
 * prisgruppens försäljningspris — nu "Debiterbart värde". Intern kostnad
 * (settings.internalHourlyCost) visas separat; lönekostnad saknas i datan.
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

  /* CSV-exportens timformat (punkt, två decimaler) — oförändrat så att
     mottagande lönesystem/kalkylark läser filen som förut. */
  function _hrs(minutes) { return (minutes / 60).toFixed(2); }
  /* Visning: "26,5 h", "5 h", "12,98 h" (sv-SE, högst två decimaler). */
  const _HFMT = new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  function _h(minutes) { return _HFMT.format((minutes || 0) / 60) + ' h'; }
  function _fmtDate(d) {
    if (!d) return '—';
    try { return new Date(d + 'T12:00:00').toLocaleDateString('sv-SE', { weekday:'short', month:'short', day:'numeric' }); }
    catch(e) { return d; }
  }
  function _fmtMoney(n) { return new Intl.NumberFormat('sv-SE', { style:'currency', currency:'SEK', maximumFractionDigits:0 }).format(n||0); }
  /* Timmar × tidpostens hourRate (= prisgruppens försäljningspris, kopierat
     vid registreringen). Visas som "Debiterbart värde" — se render(). CSV-
     exportens kolumn "Kostnad (SEK)" använder samma värde (oförändrad). */
  function _cost(entry) { return ((entry.minutes || 0) / 60) * (entry.hourRate || 0); }
  function _staffLabel(sid, fallback) {
    const s = getStaff(sid);
    return s ? ((s.name || ((s.firstName || '') + ' ' + (s.lastName || ''))).trim() || fallback || sid) : (fallback || sid);
  }

  /* ── Render ─────────────────────────────────────────────── */
  function render(params) {
    const el = document.getElementById('pg-payroll-content');
    if (!Auth.can('payroll_view')) {
      if (el) el.innerHTML = `<div class="empty">${ic('lock',36)}<h3>Behörighet saknas</h3><p>Du har inte behörighet att visa löneunderlag.</p></div>`;
      return;
    }
    if (params && params.staffId) _staffId = params.staffId;
    if (params && params.year && params.month) _period = { year: Number(params.year), month: Number(params.month) };

    const p = _currentPeriod();
    const entries = (state.timeEntries || []).filter(e => _inPeriod(e, p));
    const staffFilter = _staffId;
    const displayed   = staffFilter ? entries.filter(e => e.staffId === staffFilter) : entries;
    const canAttest   = Auth.can('payroll_manage');

    /* Gruppera per staffId */
    const byStaff = {};
    displayed.forEach(function(e) {
      const sid = e.staffId || 'unknown';
      if (!byStaff[sid]) byStaff[sid] = { sid: sid, name: e.staffName || sid, entries: [] };
      byStaff[sid].entries.push(e);
    });

    /* Sortera per staffName */
    const groups = Object.values(byStaff).sort((a,b) => a.name.localeCompare(b.name, 'sv'));

    /* Periodnavigering */
    const prevP = _prevMonth(p);
    const nextP = _nextMonth(p);
    const isThisMonth = _isCurrentMonth(p);
    const now = new Date();

    /* Personal-dropdown (native select i V3-stil, naturlig bredd) */
    const staffOpts = [{ id: '', name: 'Alla personal' }]
      .concat(Array.from(new Set(entries.map(e => e.staffId).filter(Boolean)))
        .map(sid => ({ id: sid, name: _staffLabel(sid) }))
        .sort((a,b) => a.name.localeCompare(b.name, 'sv'))
      );
    const staffSelect = `<label class="pay-staff"><span class="sr-only">Personal</span>
      <select id="pr-staff-sel" class="ar-select" onchange="PayrollPage._onStaffChange(this.value)">
        ${staffOpts.map(s => `<option value="${esc(s.id)}"${s.id===_staffId?' selected':''}>${esc(s.name)}</option>`).join('')}
      </select></label>`;

    /* Totalsummering för vald period.
       QA-tillägg 2026-11-26 (beslutspunkt i rapporten): _cost() = timmar ×
       tidpostens hourRate, och hourRate är prisgruppens FÖRSÄLJNINGSPRIS som
       kopierades till tidposten när den skapades (TimeService: hourRate =
       pg.hourRate; t.ex. PG-004 695 kr/h). Det är alltså tidens debiterbara
       värde — inte lönekostnad. Beräkningen är oförändrad; bara etiketterna
       säger nu vad värdet är. Personalregistret saknar lönedata, så verklig
       lönekostnad kan inte visas. Intern kostnad visas separat när
       settings.internalHourlyCost finns och får läsas. */
    const totalMins  = displayed.reduce((s,e) => s + (e.minutes||0), 0);
    const totalCost  = displayed.reduce((s,e) => s + _cost(e), 0);
    const attestedM  = displayed.filter(e=>e.attested).reduce((s,e) => s + (e.minutes||0), 0);
    const attestPct  = totalMins > 0 ? Math.round(attestedM / totalMins * 100) : 0;
    const ihc        = parseFloat((state.settings || {}).internalHourlyCost);
    const hasIhc     = isFinite(ihc) && ihc > 0;

    const kpi = (icon, label, val, sub, tone) => `<div class="ar-kpi${tone ? ' tone-' + tone : ''}">
        <span class="ar-kpi-ico" aria-hidden="true">${ic(icon,16)}</span>
        <span class="ar-kpi-l">${esc(label)}</span>
        <span class="ar-kpi-n">${esc(val)}</span>
        ${sub ? `<span class="ar-kpi-s">${sub}</span>` : ''}
      </div>`;
    const summaryHtml = `<div class="ar-kpis pay-kpis">
      ${kpi('clock', 'Totalt', _h(totalMins), 'registrerad tid i perioden')}
      ${kpi('wallet', 'Debiterbart värde', _fmtMoney(totalCost), 'timmar × prisgruppens timpris, exkl. moms — inte lönekostnad')}
      ${hasIhc ? kpi('trending-up', 'Intern kostnad (uppskattad)', _fmtMoney(totalMins / 60 * ihc), 'timmar × intern timkostnad ' + esc(_HFMT.format(ihc)) + ' kr/h') : ''}
      ${kpi('list', 'Tidposter', String(displayed.length), groups.length + ' ' + (groups.length === 1 ? 'person' : 'personer'))}
      ${kpi('check-circle', 'Attesterat', _h(attestedM), `av ${esc(_h(totalMins))} · ${attestPct} %<span class="pay-prog" aria-hidden="true"><i style="width:${attestPct}%"></i></span>`, totalMins > 0 && attestedM < totalMins ? 'warn' : '')}
    </div>`;

    /* Vilka prisgrupper värdet bygger på (från tidposterna, inte från registret). */
    const pgUsed = {};
    displayed.forEach(e => {
      const k = (e.priceGroupId || '—') + '|' + (e.hourRate || 0);
      if (!pgUsed[k]) pgUsed[k] = { id: e.priceGroupId || '', name: e.priceGroupName || '', rate: e.hourRate || 0, n: 0 };
      pgUsed[k].n++;
    });
    const pgList = Object.values(pgUsed).sort((a, b) => b.n - a.n)
      .map(g => esc((g.id ? g.id + ' ' : '') + (g.name || 'utan prisgrupp') + ' ' + _HFMT.format(g.rate) + ' kr/h') + ' (' + g.n + ' ' + (g.n === 1 ? 'post' : 'poster') + ')').join(' · ');
    const costNote = displayed.length ? `<details class="ar-def pay-def">
        <summary>${ic('info',15)}<span>Så räknas värdena — lönekostnad finns inte i systemet</span>${ic('chevron-down',15)}</summary>
        <div class="ar-def-b">
          <p><strong>Debiterbart värde</strong> = timmar × prisgruppens timpris (försäljningspris exkl. moms) som sparades på varje tidpost. Det är inte vad personalen kostar.</p>
          <p>Prisgrupper i urvalet: ${pgList}.</p>
          ${hasIhc ? `<p><strong>Intern kostnad (uppskattad)</strong> = timmar × intern timkostnad (${esc(_HFMT.format(ihc))} kr/h, Admin → Ekonomi).</p>` : ''}
          <p><strong>Lönekostnad</strong> (lön/timlön inklusive sociala avgifter) kan inte visas — personalregistret saknar lönedata.</p>
        </div>
      </details>` : '';

    /* Personkort */
    const groupsHtml = groups.length === 0
      ? `<div class="empty">${ic('clock',32)}<h3>Inga tidposter</h3>
          <p>Inga tidposter registrerade för ${esc(_periodLabel(p))}${staffFilter ? ' och vald personal' : ''}.</p>
          <button type="button" class="btn bs bsm" onclick="PayrollPage._navMonth(${prevP.year},${prevP.month})">${ic('chevron-left',14)}<span>Visa ${esc(_periodLabel(prevP))}</span></button>
        </div>`
      : groups.map(g => _groupCard(g, p, canAttest)).join('');

    if (!el) return;

    el.innerHTML = `
    <div class="pay">
      <div class="pay-bar">
        <div class="pay-period" role="group" aria-label="Period">
          <button type="button" class="ibtn" onclick="PayrollPage._navMonth(${prevP.year},${prevP.month})" title="${esc(_periodLabel(prevP))}" aria-label="Föregående månad: ${esc(_periodLabel(prevP))}">${ic('chevron-left',16)}</button>
          <span class="pay-period-l" aria-live="polite">${esc(_periodLabel(p))}</span>
          <button type="button" class="ibtn" onclick="PayrollPage._navMonth(${nextP.year},${nextP.month})" ${isThisMonth ? 'disabled' : ''} title="${esc(_periodLabel(nextP))}" aria-label="Nästa månad: ${esc(_periodLabel(nextP))}">${ic('chevron-right',16)}</button>
          ${!isThisMonth ? `<button type="button" class="btn bghost bsm" onclick="PayrollPage._navMonth(${now.getFullYear()},${now.getMonth()+1})">${ic('calendar',14)}<span>Aktuell månad</span></button>` : ''}
        </div>
        <div class="pay-tools">
          ${staffSelect}
          <button type="button" class="btn bs bsm ar-desk" onclick="PayrollPage._exportCsv()" title="Exportera vald period och personal som CSV">${ic('download',14)}<span>Exportera CSV</span></button>
          <div class="ao-overflow-wrap ar-mob">
            <button type="button" class="ibtn ar-more" id="pay-more-btn" aria-label="Fler åtgärder" title="Fler åtgärder" aria-haspopup="true" aria-expanded="false" onclick="aoToggleOverflow('pay-more-menu',this)">${ic('more-vertical',18)}</button>
            <div class="ao-overflow-menu" id="pay-more-menu" role="menu">
              <button type="button" class="ao-overflow-menu-item" role="menuitem" onclick="aoCloseOverflow();PayrollPage._exportCsv()">${ic('download',14)}<span>Exportera CSV</span></button>
            </div>
          </div>
        </div>
      </div>
      ${summaryHtml}
      ${costNote}
      ${groupsHtml}
    </div>`;
  }

  function _groupCard(g, p, canAttest) {
    const totalMins = g.entries.reduce((s,e)=>s+(e.minutes||0),0);
    const totalCost = g.entries.reduce((s,e)=>s+_cost(e),0);
    const allAttested = g.entries.length > 0 && g.entries.every(e=>e.attested);
    const someAttested = g.entries.some(e=>e.attested);
    const badgeCls   = allAttested ? 'bdg-green' : someAttested ? 'bdg-orange' : 'bdg-grey';
    const badgeLabel = allAttested ? 'Alla attesterade' : someAttested ? 'Delvis attesterad' : 'Ej attesterad';
    const safeId = g.entries[0]?.staffId || 'unknown';
    const st = getStaff(safeId);
    const av = (st && typeof UiKit !== 'undefined') ? UiKit.avatar(st, 32) : '';

    const rows = g.entries
      .sort((a,b) => (a.date||'').localeCompare(b.date||''))
      .map(e => {
        const ao = getAO(e.aoId);
        const aoLabel = ao ? ao.title || ao.id : (e.aoId || '—');
        const span = (e.startStr || e.endStr) ? `${esc(e.startStr||'—')}–${esc(e.endStr||'—')}` : '—';
        const rate = e.hourRate ? _HFMT.format(e.hourRate) + ' kr/h' : 'saknar timpris';
        return `<tr class="${e.attested?'is-attested':''}">
          <td class="c-date" data-label="Datum">${esc(_fmtDate(e.date))}</td>
          <td class="c-ao" data-label="Arbetsorder"><span class="pay-ao" title="${esc(aoLabel)}">${esc(aoLabel)}</span></td>
          <td class="c-time" data-label="Tid">${span}</td>
          <td class="c-num c-hrs" data-label="Timmar">${esc(_h(e.minutes||0))}</td>
          <td class="c-num c-cost" data-label="Debiterbart värde"><span class="pay-val">${esc(_fmtMoney(_cost(e)))}</span><span class="pay-rate" title="${esc('Prisgrupp: ' + (e.priceGroupName || e.priceGroupId || 'saknas'))}">${esc(rate)}</span></td>
          <td class="c-note" data-label="Kommentar">${e.comment ? `<span class="pay-note" title="${esc(e.comment)}">${esc(e.comment)}</span>` : '<span class="pay-none">—</span>'}</td>
          <td class="c-att" data-label="Attesterad">
            <label class="pay-att">
              <input type="checkbox" ${e.attested?'checked':''} ${canAttest?'':'disabled'} data-id="${esc(e.id)}"
                onchange="PayrollPage._toggleAttest(this.dataset.id,this.checked)"
                aria-label="Attesterad: ${esc(_fmtDate(e.date))}, ${esc(_h(e.minutes||0))}"
                ${canAttest ? '' : 'title="Kräver behörighet att attestera"'}>
              <span class="pay-att-l">${e.attested ? 'Attesterad' : 'Ej attesterad'}</span>
            </label>
          </td>
        </tr>`;
      }).join('');

    return `<section class="card ar-card pay-card">
      <div class="card-header ar-card-h pay-card-h">
        <div class="pay-who">${av}<div class="pay-who-t"><h3>${esc(g.name)}</h3><span class="bdg ${badgeCls}">${badgeLabel}</span></div></div>
        <div class="pay-card-sum">
          <span class="pay-sum"><b>${esc(_h(totalMins))}</b><span aria-hidden="true">·</span><span class="pay-sum-l">Debiterbart</span><b>${esc(_fmtMoney(totalCost))}</b></span>
          ${!allAttested && canAttest ? `<button type="button" class="btn bs bsm" data-id="${esc(safeId)}" onclick="PayrollPage._attestAll(this.dataset.id)">${ic('check',14)}<span>Attestera alla</span></button>` : ''}
        </div>
      </div>
      <div class="ar-scroll pay-scroll">
      <table class="ar-tbl pay-tbl">
        <thead>
          <tr>
            <th scope="col" class="c-date">Datum</th>
            <th scope="col" class="c-ao">Arbetsorder</th>
            <th scope="col" class="c-time">Tid</th>
            <th scope="col" class="c-num c-hrs">Timmar</th>
            <th scope="col" class="c-num c-cost" title="Timmar × prisgruppens timpris (exkl. moms) — inte lönekostnad">Debiterbart värde</th>
            <th scope="col" class="c-note">Kommentar</th>
            <th scope="col" class="c-att">Attesterad</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <th scope="row" colspan="3" class="c-sum-l">Summa</th>
            <td class="c-num c-hrs" data-label="Summa timmar">${esc(_h(totalMins))}</td>
            <td class="c-num c-cost" data-label="Summa debiterbart värde">${esc(_fmtMoney(totalCost))}</td>
            <td colspan="2" class="c-sum-pad"></td>
          </tr>
        </tfoot>
      </table>
      </div>
    </section>`;
  }

  /* ── Attestering ──────────────────────────────────────────── */
  /* SÄKERHETSBLOCKER-FIX (2026-10-28): detta muterade tidigare
     `state.timeEntries` direkt och anropade den generiska `persist()`
     — en skrivväg som (a) redan uteslutit `timeEntries` ur
     `persist()`s nyckel-bundel (se state.js) och (b) ändå blockeras av
     RLS-låsningen på `vift_timeEntries` för en vanlig autentiserad
     användare. Attesteringen nådde alltså ALDRIG servern — bara
     UI:ts egen, lokala kopia. Går nu via `ao-time-write`s dedikerade
     `attest_time`-åtgärd (`time_entry_set_attested()`, se
     20261028000001_time_entry_ownership_and_attest_fix.sql) — en
     riktig, atomisk, behörighetskontrollerad serverskrivning. Ett
     misslyckande visas direkt (ingen tyst, osynkroniserad kö) — en
     löneansvarigs attestering ska synas fungera eller synligt
     misslyckas, aldrig "lyckas" bara lokalt. */
  async function _toggleAttest(entryId, checked) {
    if (!Auth.can('payroll_manage')) { showToast('Du saknar behörighet'); return; }
    const e = (state.timeEntries || []).find(x => x.id === entryId);
    if (!e) return;
    if (typeof AOTimeSyncService === 'undefined') { showToast('Attestering kräver en uppdaterad app-version — ladda om sidan.'); render(); return; }
    const r = await AOTimeSyncService.setAttested(entryId, checked);
    if (!r.ok) {
      showToast('Kunde inte uppdatera attestering: ' + (r.error || 'okänt fel'));
      render();
      return;
    }
    _applyAttested(e, r, checked);
    render();
  }

  /* V3 2026-11-26: serverns BEKRÄFTADE svar (r.ok) speglas i vyn. Svaret
     har tidigare bara lästs som `timeEntry`; den simulerade servern (och
     möjligen ao-time-write) svarar med `entry` — då visades raden som ej
     attesterad trots lyckad attestering, och "Attestera alla" räknade
     lyckade poster som misslyckade. Båda formerna godtas; saknas posten i
     svaret sätts bara attest-flaggan till det servern bekräftade. */
  function _applyAttested(e, r, attested) {
    const te = r && r.data && (r.data.timeEntry || r.data.entry);
    if (te && typeof te === 'object') Object.assign(e, te);
    else e.attested = !!attested;
  }

  async function _attestAll(staffId) {
    if (!Auth.can('payroll_manage')) { showToast('Du saknar behörighet'); return; }
    if (typeof AOTimeSyncService === 'undefined') { showToast('Attestering kräver en uppdaterad app-version — ladda om sidan.'); return; }
    const p = _currentPeriod();
    const targets = (state.timeEntries || []).filter(function(e) {
      return e.staffId === staffId && _inPeriod(e, p) && !e.attested;
    });
    let failed = 0;
    /* Sekventiellt, samma motivering som AOTimeSyncService.bulkPatch() —
       undviker dussintals samtidiga anrop mot den radlåsta RPC:n och
       bevarar en förutsägbar, en-i-taget-ordning. */
    for (let i = 0; i < targets.length; i++) {
      const e = targets[i];
      const r = await AOTimeSyncService.setAttested(e.id, true);
      if (r.ok) {
        _applyAttested(e, r, true);
      } else {
        failed++;
      }
    }
    render();
    if (failed > 0) {
      showToast((targets.length - failed) + ' poster attesterade, ' + failed + ' misslyckades — se konsolen.');
    } else {
      showToast('Alla poster attesterade');
    }
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
    if (!Auth.can('payroll_view')) { showToast('Du saknar behörighet'); return; }
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
