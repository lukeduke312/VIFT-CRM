/**
 * RonderingRapportPage — Visningsrapport för ett ronderingspass
 * Utskriftsvänlig sammanfattning med avvikelser, statistik och punktlista.
 * v1
 */
const RonderingRapportPage = {

  render(params) {
    const el = document.getElementById('pg-rondering-rapport-content');
    if (!el) return;
    const passId = params && params.passId;
    const pass   = passId ? getPass(passId) : null;
    if (!pass) {
      el.innerHTML = `<div class="empty">${ic('clipboard',36)}<h3>Ronderingspass ej hittat</h3></div>`;
      return;
    }
    this._renderFull(el, pass);
  },

  _renderFull(el, pass) {
    const ron   = (state.ronderingar || []).find(r => r.id === pass.ronderingId);
    const prop  = getObj(pass.propertyId || (ron && ron.propertyId));
    const cu    = prop ? getCu(prop.customerId) : null;
    const stats = RonderingService.getPassStats(pass.id);

    const propName = prop ? (prop.name || prop.address || prop.id) : '—';
    const cuName   = cu  ? CustomerService.displayName(cu) : '—';
    const dateLbl  = pass.date ? new Date(pass.date + 'T12:00:00').toLocaleDateString('sv-SE', { weekday:'long', year:'numeric', month:'long', day:'numeric' }) : '—';
    const staffNames = (pass.staff || []).map(id => {
      const s = getStaff(id);
      return s ? (s.firstName + ' ' + s.lastName).trim() : id;
    }).join(', ') || '—';

    /* ── Avvikelser kopplade till passet ──────────────────────────────── */
    const avvList = (state.avvikelser || []).filter(a => a.ronderingPassId === pass.id && !a.deleted);
    const openAvv  = avvList.filter(a => a.status !== 'avskriven' && a.status !== 'åtgärdad');

    /* ── Kategoripunkter ─────────────────────────────────────────────── */
    const catRows = (pass.categories || []).map(cat => {
      const pts = cat.points || [];
      if (!pts.length) return '';
      const ptRows = pts.map(pt => {
        const icon = { ok: '✅', anmärkning: '⚠️', ej_kontrollerad: '❓', ej_aktuell: '—' }[pt.status] || '❓';
        const color = { ok: 'var(--gr)', anmärkning: 'var(--or)', ej_kontrollerad: 'var(--mt)', ej_aktuell: 'var(--mt)' }[pt.status] || 'var(--mt)';
        return `<tr style="border-bottom:1px solid var(--bg);">
          <td style="padding:6px 8px;font-size:12px;">${icon}</td>
          <td style="padding:6px 8px;font-size:12px;">${esc(pt.title || pt.id)}</td>
          <td style="padding:6px 8px;font-size:11px;color:${color};">${{ok:'OK', anmärkning:'Anmärkning', ej_kontrollerad:'Ej kontrollerad', ej_aktuell:'Ej aktuell'}[pt.status] || pt.status}</td>
          <td style="padding:6px 8px;font-size:11px;color:var(--mt);">${esc(pt.note || '')}</td>
        </tr>`;
      }).join('');
      return `<div style="margin-bottom:12px;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--mt);margin-bottom:4px;">${esc(cat.name || cat.id)}</div>
        <table style="width:100%;border-collapse:collapse;background:var(--card);border-radius:8px;overflow:hidden;">
          <thead><tr style="background:var(--bg);">
            <th style="padding:5px 8px;font-size:10px;text-align:left;width:28px;"></th>
            <th style="padding:5px 8px;font-size:10px;text-align:left;">Punkt</th>
            <th style="padding:5px 8px;font-size:10px;text-align:left;">Status</th>
            <th style="padding:5px 8px;font-size:10px;text-align:left;">Notering</th>
          </tr></thead>
          <tbody>${ptRows}</tbody>
        </table>
      </div>`;
    }).join('');

    /* ── Avvikelse-lista ─────────────────────────────────────────────── */
    const avvRows = avvList.map(a => {
      const svr = { kritisk:'var(--rd)', hög:'var(--or)', medel:'var(--sky)', låg:'var(--mt)' }[a.severity] || 'var(--mt)';
      return `<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--bg);">
        <div style="flex-shrink:0;margin-top:2px;">
          <span style="font-size:10px;padding:2px 6px;border-radius:8px;background:${svr}20;color:${svr};font-weight:700;">${a.severity||'—'}</span>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;">${esc(a.description || a.type || a.id)}</div>
          ${a.issueType ? `<div style="font-size:11px;color:var(--mt);">${esc(a.issueType)}</div>` : ''}
          ${a.location  ? `<div style="font-size:11px;color:var(--mt);">${ic('map-pin',9)} ${esc(a.location)}</div>` : ''}
        </div>
        <div style="flex-shrink:0;text-align:right;">
          <span style="font-size:11px;color:var(--mt);">${a.status || '—'}</span>
        </div>
      </div>`;
    }).join('') || '<div style="font-size:12px;color:var(--mt);padding:8px 0;">Inga avvikelser registrerade under detta pass.</div>';

    el.innerHTML = `
      <!-- Verktygsfält -->
      <div class="ao-action-panel" style="margin-bottom:12px;">
        <div class="ao-action-panel-left">
          <button class="btn bs bsm ao-back-btn" onclick="Router.back()">${ic('arrow-left',14)} Tillbaka</button>
          <span style="font-size:11px;font-weight:700;color:var(--mt);">${esc(pass.id)}</span>
        </div>
        <div class="ao-action-panel-btns">
          <button class="btn bs bsm" onclick="window.print()" title="Skriv ut rapport">
            ${ic('printer',13)} Skriv ut
          </button>
          <button class="btn bs bsm" onclick="RonderingRapportPage._copyLink()" title="Kopiera länk">
            ${ic('share-2',13)} Dela
          </button>
        </div>
      </div>

      <!-- Rapport-huvud -->
      <div class="card" style="margin-bottom:10px;">
        <div class="card-body" style="padding:16px 18px;">
          <div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;">
            <div style="flex-shrink:0;width:52px;height:52px;border-radius:12px;background:rgba(99,102,241,.1);display:flex;align-items:center;justify-content:center;">
              ${ic('clipboard-check',26)}
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:20px;font-weight:900;color:var(--navy);line-height:1.2;">${esc(ron ? ron.name : pass.ronderingId || 'Ronderingsrapport')}</div>
              <div style="font-size:13px;color:var(--mt);margin-top:3px;">${dateLbl}</div>
              <div style="display:flex;flex-wrap:wrap;gap:16px;margin-top:12px;padding-top:12px;border-top:1px solid var(--bg);">
                <div><div style="font-size:9px;color:var(--mt);font-weight:700;text-transform:uppercase;">Fastighet</div><div style="font-size:13px;font-weight:700;">${esc(propName)}</div></div>
                <div><div style="font-size:9px;color:var(--mt);font-weight:700;text-transform:uppercase;">Kund</div><div style="font-size:13px;font-weight:700;">${esc(cuName)}</div></div>
                <div><div style="font-size:9px;color:var(--mt);font-weight:700;text-transform:uppercase;">Utfördes av</div><div style="font-size:13px;font-weight:700;">${esc(staffNames)}</div></div>
                ${pass.completedAt ? `<div><div style="font-size:9px;color:var(--mt);font-weight:700;text-transform:uppercase;">Avslutades</div><div style="font-size:13px;font-weight:700;">${fmtDate(pass.completedAt)}</div></div>` : ''}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Statistik-kort -->
      ${stats ? `<div class="g4" style="margin-bottom:10px;">
        ${[
          { label:'Totalt',          val: stats.total,          color:'var(--navy)' },
          { label:'OK',              val: stats.ok,             color:'var(--gr)'  },
          { label:'Anmärkningar',    val: stats.anmärkningar,   color:'var(--or)'  },
          { label:'Ej kontrollerade',val: stats.ejKontrollerad, color:'var(--mt)'  }
        ].map(s => `<div class="card" style="padding:14px 16px;text-align:center;">
          <div style="font-size:28px;font-weight:900;color:${s.color};">${s.val}</div>
          <div style="font-size:10px;color:var(--mt);font-weight:600;text-transform:uppercase;letter-spacing:.5px;">${s.label}</div>
        </div>`).join('')}
      </div>` : ''}

      <!-- Avvikelser -->
      ${avvList.length ? `<div class="card" style="margin-bottom:10px;${openAvv.length ? 'border-left:3px solid var(--rd);' : ''}">
        <div class="card-header">
          <h3 class="ch3">${ic('alert-triangle',14)} Avvikelser (${avvList.length})</h3>
          ${openAvv.length ? `<span class="bdg bdg-red" style="font-size:10px;">${openAvv.length} öppna</span>` : `<span class="bdg bdg-green" style="font-size:10px;">Alla hanterade</span>`}
        </div>
        <div class="card-body" style="padding-top:4px;">${avvRows}</div>
      </div>` : ''}

      <!-- Punktlista per kategori -->
      ${catRows ? `<div class="card" style="margin-bottom:10px;">
        <div class="card-header"><h3 class="ch3">${ic('list',14)} Kontrollpunkter</h3></div>
        <div class="card-body">${catRows}</div>
      </div>` : ''}

      ${pass.notes ? `<div class="card" style="margin-bottom:10px;">
        <div class="card-header"><h3 class="ch3">${ic('file-text',14)} Anteckningar</h3></div>
        <div class="card-body" style="font-size:13px;">${esc(pass.notes)}</div>
      </div>` : ''}
    `;
  },

  _copyLink() {
    const url = window.location.href;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        if (typeof showToast !== 'undefined') showToast('Länk kopierad till urklipp');
      });
    } else {
      if (typeof showToast !== 'undefined') showToast(url);
    }
  }
};
