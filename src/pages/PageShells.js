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
      ? `<div class="empty">${ic('file-text',36)}<h3>Inga offerter</h3></div>`
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
      ? `<div class="empty">${ic('building-2',36)}<h3>Inga fastigheter</h3></div>`
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
  _filter: 'alla',
  _q: '',

  render() {
    const el = document.getElementById('pg-articles-content');
    if (!el) return;
    const cats = ['alla','kemikalier','material','forbruk','arbete','kostnad'];
    const catLabels = { alla:'Alla', kemikalier:'Kemikalier', material:'Byggmaterial', forbruk:'Förbrukning', arbete:'Arbete', kostnad:'Kostnader' };
    let arts = state.articles || [];
    if (this._filter !== 'alla') arts = arts.filter(a => a.category === this._filter);
    if (this._q) {
      const q = this._q.toLowerCase();
      arts = arts.filter(a => a.name.toLowerCase().includes(q) || (a.articleNumber||'').includes(q));
    }
    el.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;">
        <div class="swrap" style="flex:1;">
          <span class="sico">${ic('search',16)}</span>
          <input type="search" placeholder="Sök artikel, artnr…" value="${this._q}"
            oninput="ArticlesPage._q=this.value;ArticlesPage.render()">
        </div>
        <button class="btn bp bsm" onclick="ArticlesPage.openCreate()">${ic('plus',14)} Ny artikel</button>
      </div>
      <div class="ftabs" style="margin-bottom:4px;">
        ${cats.map(c=>`<button class="ft ${this._filter===c?'on':''}" onclick="ArticlesPage._filter='${c}';ArticlesPage.render()">${catLabels[c]}</button>`).join('')}
      </div>
      ${arts.length === 0
        ? `<div class="empty">${ic('package',32)}<h3>Inga artiklar</h3></div>`
        : arts.map(a => `
          <div class="list-item" onclick="ArticlesPage.openEdit('${a.id}')">
            <div class="item-row">
              <div style="flex:1;min-width:0;">
                <div class="item-title">${a.articleNumber ? a.articleNumber+' – ':'' }${a.name}</div>
                <div class="item-sub">Ink: ${fmt(a.buyPrice)} kr · Pris: ${fmt(a.sellPrice)} kr/${a.unit} · Moms ${a.vatRate||25}%</div>
              </div>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
                <span class="bdg ${a.active!==false?'bdg-green':'bdg-grey'}">${a.active!==false?'Aktiv':'Inaktiv'}</span>
                <span class="bdg bdg-sky" style="font-size:9px;">${catLabels[a.category]||a.category}</span>
              </div>
            </div>
          </div>`).join('')}`;
  },

  _formHtml(a) {
    const catLabels = { kemikalier:'Kemikalier', material:'Byggmaterial', forbruk:'Förbrukning', arbete:'Arbete', kostnad:'Kostnader' };
    return `
      <div class="g2">
        <div class="fg"><label>Artikelnummer</label>
          <input id="art-num" value="${a?a.articleNumber||'':''}" placeholder="T.ex. 1001"></div>
        <div class="fg"><label>Kategori</label>
          <select id="art-cat">
            ${Object.entries(catLabels).map(([v,l])=>`<option value="${v}" ${a&&a.category===v?'selected':''}>${l}</option>`).join('')}
          </select></div>
      </div>
      <div class="fg"><label>Benämning <span style="color:var(--rd)">*</span></label>
        <input id="art-name" value="${a?a.name||'':''}" placeholder="T.ex. Fogmassa Sikaflex 291i"></div>
      <div class="g2">
        <div class="fg"><label>Enhet</label>
          <select id="art-unit">${unitsHtml(a?a.unit:'st')}</select></div>
        <div class="fg"><label>Momssats</label>
          <select id="art-vat">
            ${[0,6,12,25].map(r=>`<option value="${r}" ${a&&a.vatRate===r?'selected':r===25?'selected':''} >${r}%</option>`).join('')}
          </select></div>
      </div>
      <div class="g2">
        <div class="fg"><label>Inköpspris (kr/enhet)</label>
          <input type="number" id="art-buy" value="${a?a.buyPrice||0:0}" min="0" placeholder="0"></div>
        <div class="fg"><label>Försäljningspris ex moms (kr/enhet)</label>
          <input type="number" id="art-sell" value="${a?a.sellPrice||0:0}" min="0" placeholder="0"></div>
      </div>`;
  },

  openCreate() {
    Modal.open({
      title: 'Ny artikel',
      body: this._formHtml(null),
      buttons: [
        { label: 'Skapa', cls: 'btn bp', onClick: () => ArticlesPage._save(null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('art-name')?.focus(), 80);
  },

  openEdit(artId) {
    const a = (state.articles||[]).find(x=>x.id===artId);
    if (!a) return;
    Modal.open({
      title: a.name,
      wide: true,
      body: this._formHtml(a),
      buttons: [
        { label: a.active!==false ? `${ic('eye-off',13)} Inaktivera` : `${ic('eye',13)} Aktivera`,
          cls: 'btn bw', onClick: () => ArticlesPage._toggleActive(artId) },
        { label: 'Spara', cls: 'btn bp', onClick: () => ArticlesPage._save(artId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _save(artId) {
    const name = document.getElementById('art-name')?.value.trim();
    if (!name) { showToast('Benämning krävs'); return; }
    const data = {
      articleNumber: document.getElementById('art-num')?.value.trim() || '',
      name,
      category: document.getElementById('art-cat')?.value || 'material',
      unit:     document.getElementById('art-unit')?.value || 'st',
      vatRate:  parseInt(document.getElementById('art-vat')?.value) || 25,
      buyPrice: parseFloat(document.getElementById('art-buy')?.value) || 0,
      sellPrice:parseFloat(document.getElementById('art-sell')?.value) || 0,
      updatedAt: new Date().toISOString()
    };
    if (!artId) {
      state.articles.push({ ...data, id: newId(state.articles,'ART'), active: true, createdAt: new Date().toISOString() });
      showToast(`${name} skapad`);
    } else {
      const idx = (state.articles||[]).findIndex(a=>a.id===artId);
      if (idx < 0) return;
      state.articles[idx] = { ...state.articles[idx], ...data };
      showToast('Artikel uppdaterad');
    }
    persist(); Modal.close(); this.render();
  },

  _toggleActive(artId) {
    const idx = (state.articles||[]).findIndex(a=>a.id===artId);
    if (idx < 0) return;
    state.articles[idx] = { ...state.articles[idx], active: !state.articles[idx].active, updatedAt: new Date().toISOString() };
    persist(); Modal.close();
    showToast(state.articles[idx].active ? 'Aktiverad' : 'Inaktiverad');
    this.render();
  }
};

/* ── Prisgrupper ──────────────────────── */
const PriceGroupsPage = {
  render() {
    const el = document.getElementById('pg-pricegroups-content');
    if (!el) return;
    const pgs = state.priceGroups || [];
    el.innerHTML =
      `<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
         <h3 style="flex:1;font-size:14px;font-weight:700;">Prisgrupper</h3>
         <button class="btn bp bsm" onclick="PriceGroupsPage.openCreate()">${ic('plus',14)} Ny prisgrupp</button>
       </div>` +
      (pgs.length === 0
        ? `<div class="empty">${ic('dollar-sign',36)}<h3>Inga prisgrupper</h3></div>`
        : pgs.map(pg => `
          <div class="list-item" onclick="PriceGroupsPage.openEdit('${pg.id}')">
            <div class="item-row">
              <div>
                <div class="item-title">${pg.name}</div>
                <div class="item-sub">${fmt(pg.hourRate)} kr/tim${pg.description ? ' · ' + pg.description : ''}</div>
              </div>
              <span class="bdg ${pg.active ? 'bdg-green' : 'bdg-grey'}">${pg.active ? 'Aktiv' : 'Inaktiv'}</span>
            </div>
          </div>`).join(''));
  },

  _formHtml(pg) {
    return `
      <div class="fg"><label>Namn <span style="color:var(--rd)">*</span></label>
        <input id="pg-name" value="${pg?pg.name||'':''}" placeholder="T.ex. Standard, Jour, Övertid"></div>
      <div class="fg"><label>Timpris ex moms (kr/tim)</label>
        <input type="number" id="pg-rate" value="${pg?pg.hourRate||0:0}" min="0"></div>
      <div class="fg"><label>Beskrivning</label>
        <input id="pg-desc" value="${pg?pg.description||'':''}" placeholder="Valfri beskrivning"></div>`;
  },

  openCreate() {
    Modal.open({
      title: 'Ny prisgrupp',
      body: this._formHtml(null),
      buttons: [
        { label: 'Skapa', cls: 'btn bp', onClick: () => PriceGroupsPage._save(null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('pg-name')?.focus(), 80);
  },

  openEdit(pgId) {
    const pg = (state.priceGroups||[]).find(x=>x.id===pgId);
    if (!pg) return;
    Modal.open({
      title: pg.name,
      body: this._formHtml(pg),
      buttons: [
        { label: pg.active ? `${ic('eye-off',13)} Inaktivera` : `${ic('eye',13)} Aktivera`, cls: 'btn bw',
          onClick: () => { const idx=(state.priceGroups||[]).findIndex(x=>x.id===pgId); if(idx<0)return; state.priceGroups[idx].active=!state.priceGroups[idx].active; persist();Modal.close();PriceGroupsPage.render();showToast(state.priceGroups[idx].active?'Aktiverad':'Inaktiverad'); }},
        { label: 'Spara', cls: 'btn bp', onClick: () => PriceGroupsPage._save(pgId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _save(pgId) {
    const name = document.getElementById('pg-name')?.value.trim();
    if (!name) { showToast('Namn krävs'); return; }
    const data = {
      name,
      hourRate: parseFloat(document.getElementById('pg-rate')?.value) || 0,
      description: document.getElementById('pg-desc')?.value.trim() || '',
      updatedAt: new Date().toISOString()
    };
    if (!pgId) {
      state.priceGroups = state.priceGroups || [];
      state.priceGroups.push({ ...data, id: newId(state.priceGroups,'PG'), active: true, createdAt: new Date().toISOString() });
      showToast(`${name} skapad`);
    } else {
      const idx = (state.priceGroups||[]).findIndex(x=>x.id===pgId);
      if (idx < 0) return;
      state.priceGroups[idx] = { ...state.priceGroups[idx], ...data };
      showToast('Prisgrupp uppdaterad');
    }
    persist(); Modal.close(); this.render();
  }
};

/* ── Personal ─────────────────────────── */
const StaffPage = {
  _filter: 'aktiva',

  render() {
    const el = document.getElementById('pg-staff-content');
    if (!el) return;
    const all     = state.staff || [];
    const aktiva  = all.filter(s => s.active);
    const inaktiva = all.filter(s => !s.active);
    const list    = this._filter === 'aktiva' ? aktiva : inaktiva;
    const roleColors = { admin:'bdg-red', chef:'bdg-orange', personal:'bdg-blue' };
    const roleLabels = { admin:'Admin', chef:'Chef', personal:'Tekniker' };

    el.innerHTML =
      `<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
         <div class="ftabs" style="flex:1;margin-bottom:0;">
           <button class="ft ${this._filter==='aktiva'?'on':''}" onclick="StaffPage._filter='aktiva';StaffPage.render()">Aktiva (${aktiva.length})</button>
           <button class="ft ${this._filter==='inaktiva'?'on':''}" onclick="StaffPage._filter='inaktiva';StaffPage.render()">Inaktiva (${inaktiva.length})</button>
         </div>
         <button class="btn bp bsm" onclick="StaffPage.openCreate()">${ic('plus',14)} Ny personal</button>
       </div>` +
      (list.length === 0
        ? `<div class="empty">${ic('users',32)}<h3>Inga ${this._filter} medarbetare</h3></div>`
        : list.map(s => `
          <div class="list-item" onclick="StaffPage.openEdit('${s.id}')">
            <div class="item-row">
              <div style="display:flex;align-items:center;gap:10px;">
                <div style="width:38px;height:38px;border-radius:50%;background:var(--acc);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:var(--navy);flex-shrink:0;">${(s.firstName||'?').charAt(0)}${(s.lastName||'').charAt(0)}</div>
                <div>
                  <div class="item-title">${s.firstName} ${s.lastName}</div>
                  <div class="item-sub">${s.title||'—'}${s.phone?' · '+s.phone:''}</div>
                </div>
              </div>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
                <span class="bdg ${roleColors[s.role]||'bdg-grey'}">${roleLabels[s.role]||s.role}</span>
                <span style="font-size:10px;color:var(--mt);">${s.email||''}</span>
              </div>
            </div>
          </div>`).join('')
      );
  },

  _formHtml(s) {
    const ro = (v, r) => `<option value="${v}" ${s&&s.role===v?'selected':''}>${r}</option>`;
    return `
      <div class="g2">
        <div class="fg"><label>Förnamn <span style="color:var(--rd)">*</span></label>
          <input id="sf-first" value="${s?s.firstName:''}" placeholder="Förnamn" autocomplete="off"></div>
        <div class="fg"><label>Efternamn <span style="color:var(--rd)">*</span></label>
          <input id="sf-last" value="${s?s.lastName:''}" placeholder="Efternamn" autocomplete="off"></div>
      </div>
      <div class="fg"><label>Titel / yrkesroll</label>
        <input id="sf-title" value="${s?s.title||'':''}" placeholder="T.ex. Fastighetstekniker, Rörmokare…" list="staff-titles-list" autocomplete="off">
        <datalist id="staff-titles-list">
          ${(state.titles||[]).map(t=>`<option>${t}</option>`).join('')}
        </datalist></div>
      <div class="g2">
        <div class="fg"><label>Telefon</label>
          <input id="sf-phone" value="${s?s.phone||'':''}" placeholder="070-XXX XX XX" type="tel"></div>
        <div class="fg"><label>E-post</label>
          <input id="sf-email" value="${s?s.email||'':''}" placeholder="namn@vift.se" type="email"></div>
      </div>
      <div style="border-top:1px solid var(--br);margin:4px 0;"></div>
      <div class="g2">
        <div class="fg"><label>Användarnamn <span style="color:var(--rd)">*</span></label>
          <input id="sf-uname" value="${s?s.username||'':''}" placeholder="användarnamn" autocomplete="off"></div>
        <div class="fg"><label>Roll / behörighet</label>
          <select id="sf-role">
            ${ro('personal','Tekniker / Personal')}
            ${ro('chef','Chef / Projektledare')}
            ${ro('admin','Admin')}
          </select></div>
      </div>
      ${s ? `
      <div class="fg"><label style="display:flex;align-items:center;gap:8px;text-transform:none;font-size:13px;font-weight:600;letter-spacing:0;cursor:pointer;">
        <input type="checkbox" id="sf-change-pw" onchange="document.getElementById('sf-pw-wrap').style.display=this.checked?'':'none'">
        Ändra lösenord
      </label></div>
      <div id="sf-pw-wrap" style="display:none;">
        <div class="fg"><label>Nytt lösenord</label>
          <input type="password" id="sf-pw" placeholder="Minst 4 tecken" autocomplete="new-password"></div>
      </div>` : `
      <div class="fg"><label>Lösenord <span style="color:var(--rd)">*</span></label>
        <input type="password" id="sf-pw" placeholder="Minst 4 tecken" autocomplete="new-password"></div>`}`;
  },

  openCreate() {
    Modal.open({
      title: 'Ny personal',
      body: this._formHtml(null),
      buttons: [
        { label: 'Skapa', cls: 'btn bp', onClick: () => StaffPage._save(null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => { document.getElementById('sf-first')?.focus(); }, 80);
  },

  openEdit(staffId) {
    const s = (state.staff||[]).find(x => x.id === staffId);
    if (!s) return;
    Modal.open({
      title: `${s.firstName} ${s.lastName}`,
      wide: true,
      body: this._formHtml(s),
      buttons: [
        { label: s.active ? `${ic('user-x',13)} Inaktivera` : `${ic('user-check',13)} Aktivera`,
          cls: s.active ? 'btn bw' : 'btn bsu',
          onClick: () => StaffPage._toggleActive(staffId) },
        { label: 'Spara', cls: 'btn bp', onClick: () => StaffPage._save(staffId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => { document.getElementById('sf-first')?.focus(); }, 80);
  },

  _save(staffId) {
    const first = document.getElementById('sf-first')?.value.trim();
    const last  = document.getElementById('sf-last')?.value.trim();
    const uname = document.getElementById('sf-uname')?.value.trim();
    if (!first || !last) { showToast('Förnamn och efternamn krävs'); return; }
    if (!uname)          { showToast('Användarnamn krävs'); return; }

    const data = {
      firstName: first, lastName: last,
      title:  document.getElementById('sf-title')?.value.trim() || '',
      phone:  document.getElementById('sf-phone')?.value.trim() || '',
      email:  document.getElementById('sf-email')?.value.trim() || '',
      username: uname,
      role: document.getElementById('sf-role')?.value || 'personal',
      updatedAt: new Date().toISOString()
    };

    if (!staffId) {
      const pw = document.getElementById('sf-pw')?.value || '';
      if (!pw || pw.length < 4) { showToast('Lösenord krävs (minst 4 tecken)'); return; }
      if ((state.staff||[]).find(s => s.username === uname)) { showToast('Användarnamnet används redan'); return; }
      state.staff.push({ ...data, id: newId(state.staff||[], 'ST'), password: pw, permissions: [], active: true, createdAt: new Date().toISOString() });
      persist(); Modal.close(); showToast(`${first} ${last} skapad`);
    } else {
      const idx = (state.staff||[]).findIndex(s => s.id === staffId);
      if (idx < 0) return;
      if ((state.staff||[]).find(s => s.username === uname && s.id !== staffId)) { showToast('Användarnamnet används redan'); return; }
      const changePw = document.getElementById('sf-change-pw');
      if (changePw?.checked) {
        const pw = document.getElementById('sf-pw')?.value || '';
        if (!pw || pw.length < 4) { showToast('Lösenord krävs (minst 4 tecken)'); return; }
        data.password = pw;
      }
      state.staff[idx] = { ...state.staff[idx], ...data };
      persist(); Modal.close(); showToast('Sparat');
    }
    this.render();
  },

  _toggleActive(staffId) {
    const idx = (state.staff||[]).findIndex(s => s.id === staffId);
    if (idx < 0) return;
    state.staff[idx] = { ...state.staff[idx], active: !state.staff[idx].active, updatedAt: new Date().toISOString() };
    persist(); Modal.close();
    showToast(state.staff[idx].active ? 'Aktiverad' : 'Inaktiverad');
    this.render();
  }
};

/* ── Admin ────────────────────────────── */
const AdminPage = {
  render() {
    const el = document.getElementById('pg-admin-content');
    if (!el) return;
    const s = state.settings || {};
    const titles = state.titles || [];

    el.innerHTML = `
      <!-- Företagsinformation -->
      <div class="card">
        <div class="card-header">
          <h3>Företagsinformation</h3>
          <button class="btn bs bxs" onclick="AdminPage.openEditCompany()">${ic('pencil',13)} Redigera</button>
        </div>
        <div class="card-body">
          <div class="dr"><span class="dk">Företag</span><span class="dv">${s.companyName || '—'}</span></div>
          <div class="dr"><span class="dk">Telefon</span><span class="dv">${s.companyPhone || '—'}</span></div>
          <div class="dr"><span class="dk">E-post</span><span class="dv">${s.companyEmail || '—'}</span></div>
          <div class="dr"><span class="dk">Adress</span><span class="dv">${s.companyAddress || '—'}</span></div>
          <div class="dr"><span class="dk">Org.nr</span><span class="dv">${s.orgNr || '—'}</span></div>
          <div class="dr"><span class="dk">Moms-nr</span><span class="dv">${s.vatNr || '—'}</span></div>
        </div>
      </div>

      <!-- Titlar / yrkesroller -->
      <div class="card">
        <div class="card-header">
          <h3>Titlar / yrkesroller</h3>
          <button class="btn bp bxs" onclick="AdminPage.openAddTitle()">${ic('plus',13)} Lägg till</button>
        </div>
        <div class="card-body" style="padding:8px 14px;">
          ${titles.length === 0 ? '<p style="font-size:12px;color:var(--mt);">Inga titlar registrerade</p>' :
            `<div style="display:flex;flex-wrap:wrap;gap:6px;">${titles.map((t,i) =>
              `<span style="display:flex;align-items:center;gap:4px;background:var(--bg);border:1px solid var(--br);border-radius:999px;padding:4px 10px;font-size:12px;font-weight:600;">
                ${t}
                <button style="background:none;border:none;cursor:pointer;color:var(--mt);padding:0;line-height:1;" onclick="AdminPage.removeTitle(${i})">${ic('x',11)}</button>
              </span>`).join('')}</div>`
          }
        </div>
      </div>

      <!-- Register-shortcuts -->
      <div class="card">
        <div class="card-header"><h3>Register</h3></div>
        <div class="card-body">
          <div class="dr">
            <span class="dk">${ic('users',13)} Personal</span>
            <span class="dv"><button class="btn bs bxs" onclick="Router.showPage('pg-staff')">${(state.staff||[]).filter(s=>s.active).length} aktiva – Hantera ${ic('arrow-right',12)}</button></span>
          </div>
          <div class="dr">
            <span class="dk">${ic('package',13)} Artiklar</span>
            <span class="dv"><button class="btn bs bxs" onclick="Router.showPage('pg-articles')">${(state.articles||[]).filter(a=>a.active!==false).length} aktiva – Hantera ${ic('arrow-right',12)}</button></span>
          </div>
          <div class="dr">
            <span class="dk">${ic('dollar-sign',13)} Prisgrupper</span>
            <span class="dv"><button class="btn bs bxs" onclick="Router.showPage('pg-pricegroups')">${(state.priceGroups||[]).filter(p=>p.active).length} aktiva – Hantera ${ic('arrow-right',12)}</button></span>
          </div>
        </div>
      </div>

      <!-- Systemdata -->
      <div class="card">
        <div class="card-header"><h3>Systemöversikt</h3></div>
        <div class="card-body">
          <div class="dr"><span class="dk">Kunder</span><span class="dv">${(state.customers||[]).length} st</span></div>
          <div class="dr"><span class="dk">Arbetsorder</span><span class="dv">${(state.workOrders||[]).length} st</span></div>
          <div class="dr"><span class="dk">Offerter</span><span class="dv">${(state.offers||[]).length} st</span></div>
          <div class="dr"><span class="dk">Fakturor</span><span class="dv">${(state.invoices||[]).length} st</span></div>
          <div class="dr"><span class="dk">Återkommande</span><span class="dv">${(state.recurringOrders||[]).length} st</span></div>
          <div class="dr"><span class="dk">Tidsposter</span><span class="dv">${(state.timeEntries||[]).length} st</span></div>
          <div class="dr"><span class="dk">Aktivitetslogg</span><span class="dv">${(state.activityLog||[]).length} poster</span></div>
        </div>
      </div>

      <!-- Rensa testdata -->
      <div class="card">
        <div class="card-header"><h3>Demodata & återställning</h3></div>
        <div class="card-body">
          <p style="font-size:12px;color:var(--mt);margin-bottom:8px;">Rensa localStorage och ladda om demodata. Återställer allt till startläget.</p>
          <button class="btn bd bsm" onclick="if(confirm('Rensa all data och återgå till demodata?')){localStorage.clear();location.reload();}">${ic('trash',13)} Återställ demodata</button>
        </div>
      </div>`;
  },

  openEditCompany() {
    const s = state.settings || {};
    Modal.open({
      title: 'Företagsinformation',
      body: `
        <div class="fg"><label>Företagsnamn</label><input id="co-name" value="${s.companyName||''}"></div>
        <div class="g2">
          <div class="fg"><label>Telefon</label><input id="co-phone" value="${s.companyPhone||''}" type="tel"></div>
          <div class="fg"><label>E-post</label><input id="co-email" value="${s.companyEmail||''}" type="email"></div>
        </div>
        <div class="fg"><label>Adress</label><input id="co-addr" value="${s.companyAddress||''}"></div>
        <div class="g2">
          <div class="fg"><label>Org.nr</label><input id="co-orgnr" value="${s.orgNr||''}"></div>
          <div class="fg"><label>Moms-nr</label><input id="co-vatnr" value="${s.vatNr||''}"></div>
        </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          state.settings = {
            ...state.settings,
            companyName:    document.getElementById('co-name')?.value.trim()  || s.companyName,
            companyPhone:   document.getElementById('co-phone')?.value.trim() || '',
            companyEmail:   document.getElementById('co-email')?.value.trim() || '',
            companyAddress: document.getElementById('co-addr')?.value.trim()  || '',
            orgNr:          document.getElementById('co-orgnr')?.value.trim() || '',
            vatNr:          document.getElementById('co-vatnr')?.value.trim() || ''
          };
          persist(); Modal.close(); AdminPage.render(); showToast('Sparat');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  openAddTitle() {
    Modal.open({
      title: 'Lägg till titel',
      body: `<div class="fg"><label>Titel / yrkesroll</label>
        <input id="adm-title" placeholder="T.ex. Låssmed, VVS-tekniker…"
          onkeydown="if(event.key==='Enter'){AdminPage._addTitle();event.preventDefault();}"></div>`,
      buttons: [
        { label: 'Lägg till', cls: 'btn bp', onClick: () => AdminPage._addTitle() },
        { label: 'Avbryt',   cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('adm-title')?.focus(), 80);
  },

  _addTitle() {
    const t = document.getElementById('adm-title')?.value.trim();
    if (!t) { showToast('Ange en titel'); return; }
    if ((state.titles||[]).some(x => x.toLowerCase() === t.toLowerCase())) { showToast('Finns redan'); return; }
    state.titles = state.titles || [];
    state.titles.push(t);
    persist(); Modal.close(); AdminPage.render(); showToast(`"${t}" tillagd`);
  },

  removeTitle(idx) {
    if (!confirm(`Ta bort titeln "${state.titles[idx]}"?`)) return;
    state.titles.splice(idx, 1);
    persist(); AdminPage.render(); showToast('Borttagen');
  }
};

/* ── Shell-sidor utan rendering ───────── */
const CalendarPage    = { render() { _renderShell('pg-calendar-content',    'Kalender',    'Kalendervy med planerade ordrar byggs i Fas 4.'); } };
const ContractsPage   = { render() { _renderShell('pg-contracts-content',   'Kontrakt',    'Kontrakthantering byggs i Fas 4.'); } };
const InspectionsPage = { render() { _renderShell('pg-rondering-content',   'Rondering',   'Ronderingssystem med mallar och avvikelser byggs i Fas 5.'); } };
const PayrollPage     = { render() { _renderShell('pg-payroll-content',     'Löneunderlag','Löneunderlag per person byggs i Fas 4.'); } };
const ReportsPage     = { render() { _renderShell('pg-reports-content',     'Rapporter',   'Statistik och rapporter byggs i Fas 4.'); } };

/* ── Hjälpfunktioner ──────────────────── */
function _shellEmpty(title, msg) {
  return `<div class="empty">${ic('settings',36)}<h3>${title}</h3><p>${msg}</p></div>`;
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
