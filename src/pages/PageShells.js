/**
 * PageShells — Placeholder-rendering för sidor som byggs i Fas 2+
 * Varje sida öppnas utan fel, visar vad som kommer
 */

/* ── Arbetsorder ──────────────────────── */
const WorkOrdersPage = {
  render() {
    const el = document.getElementById('pg-ao-content');
    if (!el) return;
    const aos = state.workOrders || [];
    const byStatus = {
      nytt: aos.filter(a => a.status === 'nytt'),
      pool: aos.filter(a => a.status === 'pool'),
      planerad: aos.filter(a => a.status === 'planerad'),
      pågående: aos.filter(a => a.status === 'pågående'),
      klar: aos.filter(a => a.status === 'klar')
    };

    el.innerHTML = `
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
        ${Object.entries(byStatus).map(([s, arr]) =>
          `<span class="bdg ${statusClass(s)}" style="font-size:12px;padding:4px 10px;">${statusLabel(s)}: ${arr.length}</span>`
        ).join('')}
      </div>
      ${aos.length === 0
        ? '<div class="empty"><span class="empty-ico">📋</span><h3>Inga arbetsorder</h3><p>Skapa din första arbetsorder</p></div>'
        : aos.map(ao => {
            const cu = getCu(ao.customerId);
            const cuName = cu ? (cu.name || `${cu.firstName} ${cu.lastName}`.trim()) : '—';
            return `
              <div class="list-item ${priorityClass(ao.priority)}" onclick="Router.showPage('pg-ao-detail', {aoId: '${ao.id}'})">
                <div class="item-row">
                  <div>
                    <div class="item-title">${ao.id} – ${ao.title}</div>
                    <div class="item-sub">${cuName}${ao.scheduledDate ? ' · ' + ao.scheduledDate : ''}</div>
                  </div>
                  <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
                    ${sbdg(ao.status)}
                    ${pbdg(ao.priority)}
                  </div>
                </div>
              </div>`;
          }).join('')
      }`;
  }
};

/* ── AO-detalj ────────────────────────── */
const WorkOrderDetailPage = {
  render(params) {
    const el = document.getElementById('pg-ao-detail-content');
    if (!el) return;
    const aoId = params && params.aoId;
    const ao   = aoId ? getAO(aoId) : null;
    if (!ao) { el.innerHTML = _shellEmpty('Arbetsorder', 'Välj en order från listan'); return; }
    const cu = getCu(ao.customerId);
    const cuName = cu ? (cu.name || `${cu.firstName} ${cu.lastName}`.trim()) : '—';
    el.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>${ao.id}</h3>
          <div style="display:flex;gap:6px;">${sbdg(ao.status)} ${pbdg(ao.priority)}</div>
        </div>
        <div class="card-body">
          <h2 style="font-size:16px;font-weight:800;margin-bottom:8px;">${ao.title}</h2>
          <div class="dr"><span class="dk">Kund</span><span class="dv">${cuName}</span></div>
          <div class="dr"><span class="dk">Adress</span><span class="dv">${ao.address || '—'}</span></div>
          <div class="dr"><span class="dk">Datum</span><span class="dv">${ao.scheduledDate || 'Ej planerad'}</span></div>
          <div class="dr"><span class="dk">Tid</span><span class="dv">${ao.scheduledStart || '—'} – ${ao.scheduledEnd || '—'}</span></div>
          ${ao.description ? `<div style="margin-top:12px;font-size:13px;line-height:1.6;color:var(--tx);">${ao.description}</div>` : ''}
        </div>
      </div>
      <div class="ibox">Fullständig AO-detalj med checklista, tid, material och fakturering byggs i Fas 2.</div>`;
  }
};

/* ── Kunder ───────────────────────────── */
const CustomersPage = {
  render() {
    const el = document.getElementById('pg-crm-content');
    if (!el) return;
    const customers = state.customers || [];
    el.innerHTML = customers.length === 0
      ? '<div class="empty"><span class="empty-ico">👥</span><h3>Inga kunder</h3><p>Lägg till din första kund</p></div>'
      : customers.map(cu => {
          const name = cu.name || `${cu.firstName || ''} ${cu.lastName || ''}`.trim() || '—';
          const typeLabel = { brf: 'BRF', foretag: 'Företag', privat: 'Privat', fastighetsagare: 'Fastighetsägare' }[cu.type] || cu.type;
          return `
            <div class="list-item" onclick="Router.showPage('pg-crm-detail', {customerId: '${cu.id}'})">
              <div class="item-row">
                <div>
                  <div class="item-title">${name}</div>
                  <div class="item-sub">${typeLabel}${cu.phone ? ' · ' + cu.phone : ''}${cu.city ? ' · ' + cu.city : ''}</div>
                </div>
                <span class="bdg bdg-grey">${cu.id}</span>
              </div>
            </div>`;
        }).join('');
  }
};

/* ── Kunddetalj ───────────────────────── */
const CustomerDetailPage = {
  render(params) {
    const el = document.getElementById('pg-crm-detail-content');
    if (!el) return;
    const id = params && params.customerId;
    const cu = id ? getCu(id) : null;
    if (!cu) { el.innerHTML = _shellEmpty('Kundkort', 'Välj en kund'); return; }
    const name = cu.name || `${cu.firstName || ''} ${cu.lastName || ''}`.trim() || '—';
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>${name}</h3></div>
        <div class="card-body">
          <div class="dr"><span class="dk">Telefon</span><span class="dv">${cu.phone || '—'}</span></div>
          <div class="dr"><span class="dk">E-post</span><span class="dv">${cu.email || '—'}</span></div>
          <div class="dr"><span class="dk">Adress</span><span class="dv">${cu.address || '—'}${cu.city ? ', ' + cu.city : ''}</span></div>
          <div class="dr"><span class="dk">Typ</span><span class="dv">${cu.type || '—'}</span></div>
          ${cu.note ? `<div style="margin-top:10px;" class="ibox">${cu.note}</div>` : ''}
        </div>
      </div>
      <div class="ibox">Fullständigt kundkort med historik, offerter, fastigheter och säljchanser byggs i Fas 2.</div>`;
  }
};

/* ── Offerter ─────────────────────────── */
const OffersPage = {
  render() {
    const el = document.getElementById('pg-offer-content');
    if (!el) return;
    const offers = state.offers || [];
    el.innerHTML = offers.length === 0
      ? '<div class="empty"><span class="empty-ico">📄</span><h3>Inga offerter</h3></div>'
      : offers.map(o => {
          const cu = getCu(o.customerId);
          const cuName = cu ? (cu.name || `${cu.firstName} ${cu.lastName}`.trim()) : '—';
          const total = (o.lines || []).reduce((s, l) => s + (l.total || 0), 0);
          return `
            <div class="list-item" onclick="Router.showPage('pg-offer-detail', {offerId: '${o.id}'})">
              <div class="item-row">
                <div>
                  <div class="item-title">${o.id} – ${cuName}</div>
                  <div class="item-sub">${fmt(total)} kr · ${fmtDate(o.createdAt)}</div>
                </div>
                ${sbdg(o.status)}
              </div>
            </div>`;
        }).join('');
  }
};

/* ── Offert-detalj ────────────────────── */
const OfferDetailPage = {
  render(params) {
    const el = document.getElementById('pg-offer-detail-content');
    if (!el) return;
    el.innerHTML = _shellEmpty('Offertdetalj', 'Fullständig offertvy med redigering byggs i Fas 2–3.');
  }
};

/* ── Fakturering ──────────────────────── */
const InvoicesPage = {
  render() {
    const el = document.getElementById('pg-invoices-content');
    if (!el) return;
    el.innerHTML = _shellFull('Fakturering', 'Fakturaunderlag, rader och PDF-export byggs i Fas 2.');
  }
};

/* ── Tid & stämpla ────────────────────── */
const TimePage = {
  render() {
    const el = document.getElementById('pg-tid-content');
    if (!el) return;
    const stampOn = state.stampActive;
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>Stämpling</h3></div>
        <div class="card-body" style="text-align:center;padding:20px;">
          <button class="btn ${stampOn ? 'bd' : 'bsu'} bfull" style="font-size:16px;padding:16px;" onclick="TimePage.toggleStamp()">
            ${stampOn ? '⏹ Klocka ut' : '▶ Klocka in'}
          </button>
          ${stampOn && state.stampTimestamp
            ? `<div style="margin-top:12px;color:var(--mt);font-size:13px;">Stämplad in sedan ${new Date(state.stampTimestamp).toLocaleTimeString('sv-SE', {hour:'2-digit',minute:'2-digit'})}</div>`
            : ''
          }
        </div>
      </div>
      <div class="ibox">Fullständig tidregistrering med manuell tid, kopplade ordrar och löneunderlag byggs i Fas 2.</div>`;
  },

  toggleStamp() {
    if (!state.stampActive) {
      state.stampActive    = true;
      state.stampTimestamp = Date.now();
      Storage.set('stampActive', true);
      Storage.set('stampTs', state.stampTimestamp);
      showToast('Stämplad in ✓');
    } else {
      const mins = Math.round((Date.now() - state.stampTimestamp) / 60000);
      state.stampActive    = false;
      state.stampTimestamp = null;
      Storage.set('stampActive', false);
      Storage.set('stampTs', null);
      showToast(`Stämplad ut – ${mins} min`);
    }
    TimePage.render();
  }
};

/* ── Fastigheter ──────────────────────── */
const PropertiesPage = {
  render() {
    const el = document.getElementById('pg-objects-content');
    if (!el) return;
    const props = state.properties || [];
    el.innerHTML = props.length === 0
      ? '<div class="empty"><span class="empty-ico">🏢</span><h3>Inga fastigheter</h3></div>'
      : props.map(p => {
          const cu = getCu(p.customerId);
          const cuName = cu ? (cu.name || `${cu.firstName} ${cu.lastName}`.trim()) : '—';
          return `
            <div class="list-item" onclick="Router.showPage('pg-obj-detail', {propId: '${p.id}'})">
              <div class="item-row">
                <div>
                  <div class="item-title">${p.name}</div>
                  <div class="item-sub">${p.address}${p.city ? ', ' + p.city : ''} · ${cuName}</div>
                </div>
                <span class="bdg bdg-green">${p.id}</span>
              </div>
            </div>`;
        }).join('');
  }
};

/* ── Artiklar ─────────────────────────── */
const ArticlesPage = {
  render() {
    const el = document.getElementById('pg-articles-content');
    if (!el) return;
    el.innerHTML = _shellFull('Artiklar', 'Artikelregister med prissättning och kategorier byggs i Fas 4.');
  }
};

/* ── Prisgrupper ──────────────────────── */
const PriceGroupsPage = {
  render() {
    const el = document.getElementById('pg-pricegroups-content');
    if (!el) return;
    const pgs = state.priceGroups || [];
    el.innerHTML = pgs.length === 0
      ? '<div class="empty"><span class="empty-ico">💲</span><h3>Inga prisgrupper</h3></div>'
      : pgs.map(pg => `
          <div class="list-item">
            <div class="item-row">
              <div>
                <div class="item-title">${pg.name}</div>
                <div class="item-sub">${fmt(pg.hourRate)} kr/tim${pg.description ? ' · ' + pg.description : ''}</div>
              </div>
              <span class="bdg ${pg.active ? 'bdg-green' : 'bdg-grey'}">${pg.active ? 'Aktiv' : 'Inaktiv'}</span>
            </div>
          </div>`).join('');
  }
};

/* ── Personal ─────────────────────────── */
const StaffPage = {
  render() {
    const el = document.getElementById('pg-staff-content');
    if (!el) return;
    const staff = state.staff || [];
    el.innerHTML = staff.length === 0
      ? '<div class="empty"><span class="empty-ico">👤</span><h3>Ingen personal</h3></div>'
      : staff.map(s => `
          <div class="list-item">
            <div class="item-row">
              <div>
                <div class="item-title">${s.firstName} ${s.lastName}</div>
                <div class="item-sub">${s.title || s.role}${s.phone ? ' · ' + s.phone : ''}</div>
              </div>
              <span class="bdg ${s.active ? 'bdg-green' : 'bdg-grey'}">${s.active ? 'Aktiv' : 'Inaktiv'}</span>
            </div>
          </div>`).join('');
  }
};

/* ── Admin ────────────────────────────── */
const AdminPage = {
  render() {
    const el = document.getElementById('pg-admin-content');
    if (!el) return;
    const s = state.settings || {};
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>Företagsinformation</h3></div>
        <div class="card-body">
          <div class="dr"><span class="dk">Företag</span><span class="dv">${s.companyName || '—'}</span></div>
          <div class="dr"><span class="dk">Telefon</span><span class="dv">${s.companyPhone || '—'}</span></div>
          <div class="dr"><span class="dk">E-post</span><span class="dv">${s.companyEmail || '—'}</span></div>
          <div class="dr"><span class="dk">Adress</span><span class="dv">${s.companyAddress || '—'}</span></div>
          <div class="dr"><span class="dk">Org.nr</span><span class="dv">${s.orgNr || '—'}</span></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3>Systemdata</h3></div>
        <div class="card-body">
          <div class="dr"><span class="dk">Kunder</span><span class="dv">${(state.customers||[]).length}</span></div>
          <div class="dr"><span class="dk">Arbetsorder</span><span class="dv">${(state.workOrders||[]).length}</span></div>
          <div class="dr"><span class="dk">Offerter</span><span class="dv">${(state.offers||[]).length}</span></div>
          <div class="dr"><span class="dk">Personal</span><span class="dv">${(state.staff||[]).length}</span></div>
          <div class="dr"><span class="dk">Aktivitetslogg</span><span class="dv">${(state.activityLog||[]).length} poster</span></div>
        </div>
      </div>
      <div class="ibox">Fullständiga adminfunktioner med personal, roller, inställningar och export byggs i Fas 2.</div>`;
  }
};

/* ── Shell-sidor utan rendering ───────── */
const CalendarPage    = { render() { _renderShell('pg-calendar-content',    'Kalender',    '📅 Kalendervy med planerade ordrar byggs i Fas 4.'); } };
const ContractsPage   = { render() { _renderShell('pg-contracts-content',   'Kontrakt',    '📝 Kontrakthantering byggs i Fas 4.'); } };
const InspectionsPage = { render() { _renderShell('pg-rondering-content',   'Rondering',   '🔍 Ronderingssystem med mallar och avvikelser byggs i Fas 5.'); } };
const PayrollPage     = { render() { _renderShell('pg-payroll-content',     'Löneunderlag','💼 Löneunderlag per person byggs i Fas 4.'); } };
const ReportsPage     = { render() { _renderShell('pg-reports-content',     'Rapporter',   '📊 Statistik och rapporter byggs i Fas 4.'); } };

/* ── Hjälpfunktioner ──────────────────── */
function _shellEmpty(title, msg) {
  return `<div class="empty"><span class="empty-ico">🔧</span><h3>${title}</h3><p>${msg}</p></div>`;
}

function _shellFull(title, msg) {
  return `
    <div class="card">
      <div class="card-header"><h3>${title}</h3></div>
      <div class="card-body"><div class="ibox">${msg}</div></div>
    </div>`;
}

function _renderShell(elId, title, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = _shellFull(title, msg);
}
