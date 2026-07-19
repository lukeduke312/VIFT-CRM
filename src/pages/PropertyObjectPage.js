/**
 * PropertyObjectPage — Detaljkort för ett objekt (lägenhet, lokal, etc.)
 * Visar info, kontakter, utrustning, kopplade AO och historik.
 * v1
 */
const PropertyObjectPage = {
  objId: null,

  render(params) {
    const el = document.getElementById('pg-propobj-detail-content');
    if (!el) return;
    const id = params && params.objId;
    this.objId = id;
    const obj = id ? getPropObj(id) : null;
    if (!obj) {
      el.innerHTML = `<div class="empty">${ic('layout',36)}<h3>Objekt ej hittat</h3></div>`;
      return;
    }
    this._renderFull(el, obj);
  },

  _renderFull(el, obj) {
    const POS      = typeof PropertyObjectService !== 'undefined' ? PropertyObjectService : null;
    const prop     = getObj(obj.propertyId);
    const cu       = prop ? getCu(prop.customerId) : null;
    const propName = prop ? prop.name : '—';
    const cuName   = cu  ? CustomerService.displayName(cu) : '—';
    const typeLbl  = POS ? POS.typeLabel(obj.type)   : obj.type;
    const statLbl  = POS ? POS.statusLabel(obj.status) : obj.status;
    const badgeCls = POS ? POS.statusBadgeClass(obj.status) : 'badge-gray';
    const canManage = Auth.can('properties_manage');

    // Kopplade AO:er
    const allAOs = (state.workOrders || []).filter(a => a.objectId === obj.id && !a.deleted);
    const openAOs = allAOs.filter(a => !['klar','fakturerad','avbruten'].includes(a.status));

    // Kontakter
    const contacts = (obj.contacts || []).filter(c => c.active !== false);

    // Utrustning
    const equipment = obj.equipment || [];

    el.innerHTML = `
      <!-- Action panel -->
      <div class="ao-action-panel">
        <div class="ao-action-panel-left">
          <button class="btn bs bsm ao-back-btn" onclick="Router.back()">${ic('arrow-left',14)} Tillbaka</button>
          <span style="font-size:11px;font-weight:700;color:var(--mt);">${esc(obj.id)}</span>
        </div>
        <div class="ao-action-panel-badges">
          <span class="bdg ${badgeCls}" style="font-size:10px;">${statLbl}</span>
          <span class="bdg bdg-blue" style="font-size:10px;">${typeLbl}</span>
          ${openAOs.length > 0 ? `<span class="bdg bdg-orange" style="font-size:10px;">${openAOs.length} öppna AO</span>` : ''}
        </div>
        <div class="ao-action-panel-btns">
          ${Auth.can('ao_create') ? `<button class="btn bp bxs" onclick="PropertyObjectPage.openCreateAO()">${ic('plus',13)} Ny AO</button>` : ''}
          ${canManage ? `<button class="btn bs bxs" onclick="PropertyDetailPage.openEditObject('${obj.id}'); Router.back();">${ic('pencil',13)} Redigera</button>` : ''}
        </div>
      </div>

      <!-- Huvud-info -->
      <div class="card" style="margin-bottom:8px;">
        <div class="card-body" style="padding:16px;">
          <div style="display:flex;align-items:flex-start;gap:12px;">
            <div style="flex-shrink:0;width:52px;height:52px;border-radius:12px;background:rgba(14,165,233,.1);display:flex;align-items:center;justify-content:center;">
              ${ic('layout', 26)}
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:18px;font-weight:900;color:var(--navy);line-height:1.2;">${esc(obj.name || typeLbl)}</div>
              <div style="font-size:12px;color:var(--mt);margin-top:2px;">${obj.objectNumber ? `<strong>${esc(obj.objectNumber)}</strong> · ` : ''}${typeLbl}</div>
              ${prop ? `<div style="font-size:12px;margin-top:4px;">
                <span style="color:var(--mt);">Fastighet: </span>
                <span style="color:var(--sky);cursor:pointer;font-weight:600;" onclick="Router.showPage('pg-obj-detail',{propId:'${prop.id}',tab:'objects'})">${esc(propName)}</span>
              </div>` : ''}
              ${cu ? `<div style="font-size:12px;margin-top:2px;">
                <span style="color:var(--mt);">Kund: </span>
                <span style="color:var(--sky);cursor:pointer;font-weight:600;" onclick="Router.showPage('pg-crm-detail',{customerId:'${cu.id}'})">${esc(cuName)}</span>
              </div>` : ''}
            </div>
          </div>
          <!-- Tekniska detaljer -->
          <div style="display:flex;flex-wrap:wrap;gap:16px;margin-top:12px;padding-top:12px;border-top:1px solid var(--bg);">
            ${obj.floor     ? `<div><div style="font-size:9px;color:var(--mt);font-weight:700;text-transform:uppercase;">Våning</div><div style="font-size:14px;font-weight:800;">${esc(obj.floor)}</div></div>` : ''}
            ${obj.entrance  ? `<div><div style="font-size:9px;color:var(--mt);font-weight:700;text-transform:uppercase;">Entré</div><div style="font-size:14px;font-weight:800;">${esc(obj.entrance)}</div></div>` : ''}
            ${obj.stairwell ? `<div><div style="font-size:9px;color:var(--mt);font-weight:700;text-transform:uppercase;">Trapphus</div><div style="font-size:14px;font-weight:800;">${esc(obj.stairwell)}</div></div>` : ''}
            ${obj.area      ? `<div><div style="font-size:9px;color:var(--mt);font-weight:700;text-transform:uppercase;">Yta</div><div style="font-size:14px;font-weight:800;">${fmt(obj.area)} m²</div></div>` : ''}
            ${obj.apartmentNumber ? `<div><div style="font-size:9px;color:var(--mt);font-weight:700;text-transform:uppercase;">Lgh-nr</div><div style="font-size:14px;font-weight:800;">${esc(obj.apartmentNumber)}</div></div>` : ''}
          </div>
          ${obj.description ? `<div style="font-size:12px;color:var(--mt);margin-top:10px;padding-top:10px;border-top:1px solid var(--bg);">${esc(obj.description)}</div>` : ''}
        </div>
      </div>

      <!-- Tillträdeskod / nyckelinfo -->
      ${(obj.accessInformation || obj.doorCode || obj.keyInformation) ? `
      <div class="card" style="margin-bottom:8px;border-left:3px solid var(--sky);">
        <div class="card-body" style="padding:12px 14px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--sky);margin-bottom:6px;">${ic('key',12)} Tillträdeskod / access</div>
          ${obj.accessInformation ? `<div style="font-size:13px;">${esc(obj.accessInformation)}</div>` : ''}
          ${obj.doorCode     ? `<div style="font-size:12px;color:var(--mt);">Portkod: <strong>${esc(obj.doorCode)}</strong></div>` : ''}
          ${obj.keyInformation ? `<div style="font-size:12px;color:var(--mt);">Nyckel: ${esc(obj.keyInformation)}</div>` : ''}
        </div>
      </div>` : ''}

      <!-- Kontakter -->
      ${contacts.length > 0 ? `
      <div class="card" style="margin-bottom:8px;">
        <div class="card-header">
          <h3>${ic('user',14)} Kontakter (${contacts.length})</h3>
        </div>
        <div class="card-body" style="padding-top:6px;">
          ${contacts.map(c => {
            const cu = getCu(c.contactId);
            return cu ? `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--bg);">
                <div>
                  <div style="font-size:13px;font-weight:600;cursor:pointer;color:var(--sky);"
                    onclick="Router.showPage('pg-crm-detail',{customerId:'${cu.id}'})">${esc(CustomerService.displayName(cu))}</div>
                  ${c.role ? `<div style="font-size:11px;color:var(--mt);">${esc(c.role)}</div>` : ''}
                </div>
                ${c.validFrom || c.validTo ? `<div style="font-size:11px;color:var(--mt);text-align:right;">${c.validFrom?fmtDate(c.validFrom):''}${c.validTo?' – '+fmtDate(c.validTo):''}</div>` : ''}
              </div>` : '';
          }).join('')}
        </div>
      </div>` : ''}

      <!-- Ansvariga (PropertyContactService) -->
      ${(()=>{
        if (typeof PropertyContactService === 'undefined') return '';
        const pcs = PropertyContactService.getByObject(obj.id);
        if (!pcs.length && !canManage) return '';
        const rows = pcs.map(c => {
          const role = PropertyContactService.getRole(c.roleId);
          return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--bg);">
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:600;">
                ${c.isPrimary ? '<span style="color:var(--sky);font-weight:900;" title="Primär">★</span> ' : ''}
                ${esc(c.personNameSnapshot || c.personId || '—')}
              </div>
              ${role ? `<div style="font-size:11px;color:var(--mt);">${esc(role.name)}</div>` : ''}
              ${c.personPhoneSnapshot ? `<div style="font-size:11px;color:var(--mt);">${ic('phone',9)} ${esc(c.personPhoneSnapshot)}</div>` : ''}
            </div>
            ${canManage ? `<button class="btn bs bxs" style="font-size:10px;padding:3px 7px;"
              onclick="PropertyObjectPage._editContact('${c.id}');event.stopPropagation();">${ic('pencil',11)}</button>
            <button class="btn bxs" style="font-size:10px;padding:3px 7px;color:var(--rd);"
              onclick="PropertyObjectPage._removeContact('${c.id}');event.stopPropagation();">${ic('trash-2',11)}</button>` : ''}
          </div>`;
        }).join('');
        return `<div class="card" style="margin-bottom:8px;">
          <div class="card-header">
            <h3>${ic('user-check',14)} Ansvariga (${pcs.length})</h3>
            ${canManage ? `<button class="btn bp bxs" onclick="PropertyObjectPage._addContact()">${ic('plus',13)} Lägg till</button>` : ''}
          </div>
          <div class="card-body" style="padding-top:6px;" id="propobj-contacts-body">
            ${rows || '<div style="font-size:12px;color:var(--mt);padding:6px 0;">Inga ansvariga kopplade till objektet.</div>'}
          </div>
        </div>`;
      })()}

      <!-- Kopplade AO:er -->
      ${allAOs.length > 0 ? `
      <div class="card" style="margin-bottom:8px;">
        <div class="card-header">
          <h3>${ic('clipboard-list',14)} Arbetsorder (${allAOs.length})</h3>
          ${Auth.can('ao_create') ? `<button class="btn bp bxs" onclick="PropertyObjectPage.openCreateAO()">${ic('plus',13)} Ny AO</button>` : ''}
        </div>
        <div class="card-body" style="padding-top:6px;">
          ${allAOs.slice(0,10).map(ao => `
            <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--bg);cursor:pointer;"
              onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">
              <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(ao.title || ao.id)}</div>
                <div style="font-size:11px;color:var(--mt);">${ao.id} · ${fmtDate(ao.createdAt)}</div>
              </div>
              <span class="bdg bdg-${ao.status==='klar'||ao.status==='fakturerad'?'green':ao.status==='avbruten'?'gray':'blue'}" style="font-size:10px;flex-shrink:0;">${ao.status}</span>
            </div>`).join('')}
          ${allAOs.length > 10 ? `<div style="font-size:12px;color:var(--mt);padding-top:8px;text-align:center;">+${allAOs.length-10} fler AO:er</div>` : ''}
        </div>
      </div>` : ''}

      <!-- Utrustning -->
      ${equipment.length > 0 ? `
      <div class="card" style="margin-bottom:8px;">
        <div class="card-header">
          <h3>${ic('tool',14)} Utrustning (${equipment.length})</h3>
        </div>
        <div class="card-body" style="padding-top:6px;">
          ${equipment.map(eq => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--bg);">
              <div>
                <div style="font-size:13px;font-weight:600;">${esc(eq.name)}</div>
                ${eq.type ? `<div style="font-size:11px;color:var(--mt);">${esc(eq.type)}${eq.serialNumber?' · Nr: '+esc(eq.serialNumber):''}</div>` : ''}
              </div>
              ${eq.installedAt ? `<div style="font-size:11px;color:var(--mt);">Inst. ${fmtDate(eq.installedAt)}</div>` : ''}
            </div>`).join('')}
        </div>
      </div>` : ''}

      <!-- Metadata -->
      <div style="font-size:11px;color:var(--mt);padding:8px 4px;text-align:right;">
        Skapad ${fmtDate(obj.createdAt)} · Uppdaterad ${fmtDate(obj.updatedAt)}
      </div>
    `;
  },

  _addContact() {
    this._contactForm(null);
  },

  _editContact(id) {
    if (typeof PropertyContactService === 'undefined') return;
    const c = PropertyContactService.getByObject(this.objId, true).find(x => x.id === id);
    if (c) this._contactForm(c);
  },

  _removeContact(id) {
    Modal.confirm('Ta bort ansvarig från objektet?', () => {
      if (typeof PropertyContactService !== 'undefined') PropertyContactService.remove(id);
      this.render({ objId: this.objId });
    });
  },

  _contactForm(contact) {
    if (typeof PropertyContactService === 'undefined') return;
    const roles   = PropertyContactService.activeRoles();
    const staffList = (state.staff || []).filter(s => s.active !== false);
    const c       = contact || {};
    const body = `
      <div class="fg"><label>Roll</label>
        <select id="pobj-con-role">
          <option value="">— Välj roll —</option>
          ${roles.map(r => `<option value="${r.id}" ${c.roleId===r.id?'selected':''}>${esc(r.name)}</option>`).join('')}
        </select>
      </div>
      <div class="fg"><label>Person</label>
        <select id="pobj-con-person-type" onchange="PropertyObjectPage._onPersonTypeChange()">
          <option value="staff" ${(!c.personType||c.personType==='staff')?'selected':''}>Personal</option>
          <option value="externalOther" ${c.personType==='externalOther'?'selected':''}>Extern (fritext)</option>
        </select>
      </div>
      <div id="pobj-con-person-wrap">
        <div class="fg" id="pobj-con-staff-wrap" ${c.personType==='externalOther'?'style="display:none"':''}>
          <label>Personal</label>
          <select id="pobj-con-staff">
            <option value="">— Välj —</option>
            ${staffList.map(s => `<option value="${s.id}" ${c.personId===s.id?'selected':''}>${esc(s.firstName+' '+s.lastName)}</option>`).join('')}
          </select>
        </div>
        <div class="fg" id="pobj-con-ext-wrap" ${c.personType!=='externalOther'?'style="display:none"':''}>
          <label>Namn (fritext)</label>
          <input id="pobj-con-ext-name" value="${esc(c.personNameSnapshot||'')}" placeholder="Förnamn Efternamn">
        </div>
      </div>
      <div class="fg"><label>Telefon (valfritt)</label>
        <input id="pobj-con-phone" type="tel" value="${esc(c.personPhoneSnapshot||'')}" placeholder="070-xxx xx xx"></div>
      <div class="fg"><label>Anteckning</label>
        <input id="pobj-con-notes" value="${esc(c.notes||'')}"></div>
      <div class="fg" style="display:flex;align-items:center;gap:8px;">
        <input type="checkbox" id="pobj-con-primary" ${c.isPrimary?'checked':''}>
        <label for="pobj-con-primary" style="margin:0;font-weight:500;">Primär kontakt</label>
      </div>`;

    Modal.open({
      title: contact ? 'Redigera ansvarig' : 'Lägg till ansvarig',
      body,
      buttons: [
        { label: contact ? 'Spara' : 'Lägg till', cls: 'btn bp', onClick: () => this._saveContact(contact ? contact.id : null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _onPersonTypeChange() {
    const t = document.getElementById('pobj-con-person-type')?.value;
    const sw = document.getElementById('pobj-con-staff-wrap');
    const ew = document.getElementById('pobj-con-ext-wrap');
    if (sw) sw.style.display = t === 'externalOther' ? 'none' : '';
    if (ew) ew.style.display = t === 'externalOther' ? '' : 'none';
  },

  _saveContact(id) {
    if (typeof PropertyContactService === 'undefined') return;
    const obj = this.objId ? getPropObj(this.objId) : null;
    if (!obj) return;
    const personType = document.getElementById('pobj-con-person-type')?.value || 'staff';
    const isExt      = personType === 'externalOther';
    const personId   = isExt ? '' : (document.getElementById('pobj-con-staff')?.value || '');
    const extName    = isExt ? (document.getElementById('pobj-con-ext-name')?.value || '').trim() : '';
    const roleId     = document.getElementById('pobj-con-role')?.value || '';
    const notes      = document.getElementById('pobj-con-notes')?.value || '';
    const phone      = document.getElementById('pobj-con-phone')?.value || '';
    const isPrimary  = document.getElementById('pobj-con-primary')?.checked || false;

    if (!roleId) { alert('Välj en roll.'); return; }
    if (!isExt && !personId) { alert('Välj en person.'); return; }
    if (isExt && !extName) { alert('Ange ett namn.'); return; }

    const data = {
      propertyId:          obj.propertyId,
      objectId:            obj.id,
      roleId,
      personType,
      personId,
      isPrimary,
      notes,
      active: true,
      ...(isExt ? { personNameSnapshot: extName, personPhoneSnapshot: phone } : {})
    };

    if (id) {
      PropertyContactService.update(id, data);
    } else {
      PropertyContactService.add(data);
    }
    Modal.close();
    this.render({ objId: this.objId });
  },

  openCreateAO() {
    const obj = this.objId ? getPropObj(this.objId) : null;
    if (!obj) return;
    Router.showPage('pg-ao', {});
    setTimeout(() => WorkOrdersPage.openCreateAO({
      propertyId: obj.propertyId,
      customerId: obj.customerId,
      objectId:   obj.id,
      objectName: obj.name || obj.objectNumber
    }), 100);
  }
};
