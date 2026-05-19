/**
 * PageShells — Placeholder-rendering för sidor som byggs i Fas 3+
 * Fas 2-sidor (Kunder, AO, Tid, Faktura) har egna filer.
 */

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
