/**
 * PropertyObjectPage — Detaljkort för ett objekt (lägenhet, lokal, etc.)
 * Visar info, kontakter, utrustning, AO, serviceintervall, avvikelser, bilder.
 * v3: punkt 62–64 (SI, avvikelser, bilder) + punkt 71 (hyresgästkontakter CRUD)
 *     + punkt 72 (doorCode rollskydd — se _renderFull)
 *     + fix: canManage använde icke-existerande 'properties_manage', nu 'customer_manage'
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
    // Fix: 'properties_manage' existerar ej — korrekt permission är 'customer_manage'
    const canManage = Auth.can('customer_manage');

    // Kopplade AO:er
    const allAOs = (state.workOrders || []).filter(a => a.objectId === obj.id && !a.deleted);
    const openAOs = allAOs.filter(a => !['klar','fakturerad','avbruten'].includes(a.status));

    // Utrustning
    const equipment = obj.equipment || [];

    // Serviceintervall kopplade till objektet (punkt 62)
    const siList = (prop && prop.serviceIntervals || []).filter(function(si) { return si.objectId === obj.id; });

    // Avvikelser kopplade till objektet (punkt 63)
    const avvList = (state.avvikelser || []).filter(function(a) { return a.objectId === obj.id && !a.deleted; });

    // Hyresgästkontakter på objektet (punkt 71) — obj.contacts[] med name/phone/email/role
    const tenantContacts = (obj.contacts || []).filter(function(c) { return c.active !== false && c.name; });

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

      <!-- Tillträdeskod / nyckelinfo — visas bara för objects_sensitive eller customer_manage (punkt 72) -->
      ${(Auth.can('objects_sensitive') || Auth.can('customer_manage')) && (obj.accessInformation || obj.doorCode || obj.keyInformation) ? `
      <div class="card" style="margin-bottom:8px;border-left:3px solid var(--sky);">
        <div class="card-body" style="padding:12px 14px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--sky);margin-bottom:6px;">${ic('key',12)} Tillträdeskod / access</div>
          ${obj.accessInformation ? `<div style="font-size:13px;">${esc(obj.accessInformation)}</div>` : ''}
          ${obj.doorCode     ? `<div style="font-size:12px;color:var(--mt);">Portkod: <strong>${esc(obj.doorCode)}</strong></div>` : ''}
          ${obj.keyInformation ? `<div style="font-size:12px;color:var(--mt);">Nyckel: ${esc(obj.keyInformation)}</div>` : ''}
        </div>
      </div>` : ''}

      <!-- Hyresgäster & kontakter (punkt 71) — obj.contacts[] med direktdata -->
      <div class="card" style="margin-bottom:8px;">
        <div class="card-header">
          <h3>${ic('users',14)} Hyresgäster & kontakter (${tenantContacts.length})</h3>
          ${canManage ? `<button class="btn bp bxs" onclick="PropertyObjectPage._addTenantContact()">${ic('plus',13)} Lägg till</button>` : ''}
        </div>
        <div class="card-body" style="padding-top:6px;" id="propobj-tenant-contacts-body">
          ${tenantContacts.length === 0
            ? `<div style="font-size:12px;color:var(--mt);padding:6px 0;">Inga kontakter registrerade.</div>`
            : tenantContacts.map(function(c) {
                return `<div style="display:flex;align-items:flex-start;gap:8px;padding:9px 0;border-bottom:1px solid var(--bg);">
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px;">
                      ${c.isPrimary ? `<span style="color:var(--sky);font-size:11px;" title="Primär kontakt">★</span>` : ''}
                      ${esc(c.name)}
                    </div>
                    ${c.role ? `<div style="font-size:11px;color:var(--mt);">${esc(c.role)}</div>` : ''}
                    ${c.phone ? `<div style="font-size:11px;color:var(--mt);">${ic('phone',9)} <a href="tel:${esc(c.phone)}" style="color:inherit;">${esc(c.phone)}</a></div>` : ''}
                    ${c.email ? `<div style="font-size:11px;color:var(--mt);">${ic('mail',9)} <a href="mailto:${esc(c.email)}" style="color:var(--sky);">${esc(c.email)}</a></div>` : ''}
                    ${c.validFrom || c.validTo ? `<div style="font-size:10px;color:var(--mt);margin-top:2px;">${c.validFrom?fmtDate(c.validFrom):''}${c.validTo?' – '+fmtDate(c.validTo):''}</div>` : ''}
                    ${c.notes ? `<div style="font-size:11px;color:var(--mt);font-style:italic;margin-top:2px;">${esc(c.notes)}</div>` : ''}
                  </div>
                  ${canManage ? `
                  <div style="display:flex;gap:4px;flex-shrink:0;">
                    <button class="btn bs bxs" style="font-size:10px;padding:3px 7px;"
                      onclick="PropertyObjectPage._editTenantContact('${esc(c.id)}');event.stopPropagation();">${ic('pencil',11)}</button>
                    <button class="btn bxs" style="font-size:10px;padding:3px 7px;color:var(--rd);"
                      onclick="PropertyObjectPage._removeTenantContact('${esc(c.id)}');event.stopPropagation();">${ic('trash-2',11)}</button>
                  </div>` : ''}
                </div>`;
              }).join('')
          }
        </div>
      </div>

      <!-- Ansvariga (PropertyContactService) -->
      ${(()=>{
        if (typeof PropertyContactService === 'undefined') return '';
        const pcs = PropertyContactService.getByObject(obj.id);
        if (!pcs.length && !canManage) return '';
        const rows = pcs.map(function(c) {
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

      <!-- Serviceintervall kopplade till objekt (punkt 62) -->
      <div class="card" style="margin-bottom:8px;">
        <div class="card-header">
          <h3>${ic('calendar-check',14)} Serviceintervall (${siList.length})</h3>
          ${canManage && prop ? `<button class="btn bp bxs" onclick="Router.showPage('pg-obj-detail',{propId:'${prop.id}',tab:'service',newSiObjectId:'${obj.id}'})">${ic('plus',13)} Nytt SI</button>` : ''}
        </div>
        <div class="card-body" style="padding-top:6px;">
          ${siList.length === 0
            ? `<div style="font-size:12px;color:var(--mt);padding:6px 0;">Inga serviceintervall kopplade till detta objekt.</div>`
            : siList.map(function(si) {
                const SIS = typeof ServiceIntervalService !== 'undefined' ? ServiceIntervalService : null;
                const st  = SIS ? SIS.getStatus(si) : 'not_set';
                const lbl = SIS ? SIS.statusLabel(si) : (si.nextDue || '—');
                const clr = {ok:'var(--gr)',approaching:'var(--or)',due_soon:'var(--or)',overdue:'var(--rd)',paused:'var(--mt)',not_set:'var(--mt)'}[st] || 'var(--mt)';
                const staff = si.responsibleStaffId ? getStaff(si.responsibleStaffId) : null;
                return `<div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--bg);">
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:600;">${esc(si.title || si.category)}</div>
                    <div style="font-size:11px;color:var(--mt);">Nästa: ${si.nextDue ? fmtDate(si.nextDue) : '—'}${staff ? ' · ' + esc(staff.firstName + ' ' + (staff.lastName||'')) : ''}</div>
                    ${si.lastDone ? `<div style="font-size:11px;color:var(--mt);">Senast: ${fmtDate(si.lastDone)}</div>` : ''}
                  </div>
                  <span style="font-size:10px;padding:2px 7px;border-radius:8px;border:1px solid ${clr};color:${clr};flex-shrink:0;">${lbl}</span>
                  ${canManage && prop ? `<button class="btn bs bxs" style="font-size:10px;padding:3px 7px;" onclick="Router.showPage('pg-obj-detail',{propId:'${prop.id}',tab:'service',editSiId:'${si.id}'})">${ic('pencil',11)}</button>` : ''}
                </div>`;
              }).join('')
          }
        </div>
      </div>

      <!-- Avvikelser kopplade till objekt (punkt 63) -->
      <div class="card" style="margin-bottom:8px;">
        <div class="card-header">
          <h3>${ic('alert-triangle',14)} Avvikelser (${avvList.length})</h3>
        </div>
        <div class="card-body" style="padding-top:6px;">
          ${avvList.length === 0
            ? `<div style="font-size:12px;color:var(--mt);padding:6px 0;">Inga avvikelser registrerade på detta objekt.</div>`
            : avvList.slice(0, 20).map(function(a) {
                const clr = a.status === 'öppen' ? 'var(--rd)' : a.status === 'åtgärdad' ? 'var(--gr)' : 'var(--mt)';
                const lbl = a.status === 'öppen' ? 'Öppen' : a.status === 'åtgärdad' ? 'Åtgärdad' : a.status === 'avskriven' ? 'Avskriven' : (a.status || '—');
                return `<div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--bg);cursor:pointer;"
                  onclick="Router.showPage('pg-rondering-rapport',{passId:'${esc(a.ronderingspassId||'')}'})" title="Öppna ronderingspasset">
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:600;">${esc(a.description || a.title || a.id)}</div>
                    <div style="font-size:11px;color:var(--mt);">${fmtDate(a.date || a.createdAt)}${a.category ? ' · ' + esc(a.category) : ''}</div>
                    ${a.workOrderId ? `<div style="font-size:11px;color:var(--sky);">${ic('clipboard',9)} AO: ${esc(a.workOrderId)}</div>` : ''}
                  </div>
                  <span style="font-size:10px;padding:2px 7px;border-radius:8px;border:1px solid ${clr};color:${clr};flex-shrink:0;">${lbl}</span>
                </div>`;
              }).join('') +
              (avvList.length > 20 ? `<div style="font-size:12px;color:var(--mt);padding-top:8px;text-align:center;">+${avvList.length-20} fler avvikelser</div>` : '')
          }
        </div>
      </div>

      <!-- Kopplade AO:er -->
      <div class="card" style="margin-bottom:8px;">
        <div class="card-header">
          <h3>${ic('clipboard-list',14)} Arbetsorder (${allAOs.length})</h3>
          ${Auth.can('ao_create') ? `<button class="btn bp bxs" onclick="PropertyObjectPage.openCreateAO()">${ic('plus',13)} Ny AO</button>` : ''}
        </div>
        <div class="card-body" style="padding-top:6px;">
          ${allAOs.length === 0
            ? `<div style="font-size:12px;color:var(--mt);padding:6px 0;">Inga arbetsordrar kopplade till detta objekt.</div>`
            : allAOs.slice(0,10).map(function(ao) {
                return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--bg);cursor:pointer;"
                  onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(ao.title || ao.id)}</div>
                    <div style="font-size:11px;color:var(--mt);">${ao.id} · ${fmtDate(ao.createdAt)}</div>
                  </div>
                  <span class="bdg bdg-${ao.status==='klar'||ao.status==='fakturerad'?'green':ao.status==='avbruten'?'gray':'blue'}" style="font-size:10px;flex-shrink:0;">${ao.status}</span>
                </div>`;
              }).join('') +
              (allAOs.length > 10 ? `<div style="font-size:12px;color:var(--mt);padding-top:8px;text-align:center;">+${allAOs.length-10} fler AO:er</div>` : '')
          }
        </div>
      </div>

      <!-- Bilder & dokument (punkt 64) — laddas asynkront -->
      <div class="card" style="margin-bottom:8px;" id="propobj-images-card">
        <div class="card-header">
          <h3>${ic('image',14)} Bilder & dokument</h3>
          ${canManage ? `<button class="btn bp bxs" id="propobj-img-upload-btn" onclick="PropertyObjectPage._openImageUpload()">${ic('upload',13)} Ladda upp</button>` : ''}
        </div>
        <div class="card-body" style="padding-top:6px;" id="propobj-images-body">
          <div style="font-size:12px;color:var(--mt);padding:6px 0;">${ic('loader',12)} Laddar bilder…</div>
        </div>
      </div>

      <!-- Utrustning -->
      ${equipment.length > 0 ? `
      <div class="card" style="margin-bottom:8px;">
        <div class="card-header">
          <h3>${ic('tool',14)} Utrustning (${equipment.length})</h3>
        </div>
        <div class="card-body" style="padding-top:6px;">
          ${equipment.map(function(eq) {
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--bg);">
              <div>
                <div style="font-size:13px;font-weight:600;">${esc(eq.name)}</div>
                ${eq.type ? `<div style="font-size:11px;color:var(--mt);">${esc(eq.type)}${eq.serialNumber?' · Nr: '+esc(eq.serialNumber):''}</div>` : ''}
              </div>
              ${eq.installedAt ? `<div style="font-size:11px;color:var(--mt);">Inst. ${fmtDate(eq.installedAt)}</div>` : ''}
            </div>`;
          }).join('')}
        </div>
      </div>` : ''}

      <!-- Metadata -->
      <div style="font-size:11px;color:var(--mt);padding:8px 4px;text-align:right;">
        Skapad ${fmtDate(obj.createdAt)} · Uppdaterad ${fmtDate(obj.updatedAt)}
      </div>
    `;

    // Ladda bilder asynkront (punkt 64)
    this._loadImages(obj);
  },

  /* ── Bilder & dokument (punkt 64) ─────────────────────────── */

  async _loadImages(obj) {
    const bodyEl = document.getElementById('propobj-images-body');
    if (!bodyEl) return;
    if (typeof PropertyImageService === 'undefined' || !obj.propertyId) {
      bodyEl.innerHTML = '<div style="font-size:12px;color:var(--mt);padding:6px 0;">Bildhantering ej tillgänglig.</div>';
      return;
    }
    const canManage = Auth.can('customer_manage');
    try {
      // Hämta bilder med tech_section = 'obj:{objectId}' som tillhör detta objekt
      const all = await PropertyImageService.list(obj.propertyId);
      const imgs = all.filter(function(r) { return r.tech_section === 'obj:' + obj.id; });

      if (imgs.length === 0) {
        bodyEl.innerHTML = `<div style="font-size:12px;color:var(--mt);padding:6px 0;">Inga bilder eller dokument uppladdat.</div>`;
        return;
      }

      const isImage = function(r) { return /\.(jpe?g|png|webp|gif|heic)$/i.test(r.storage_path || ''); };
      bodyEl.innerHTML = `
        <div style="display:flex;flex-wrap:wrap;gap:8px;padding:4px 0;">
          ${imgs.map(function(r) {
            if (isImage(r)) {
              return `<div style="position:relative;width:80px;height:80px;border-radius:8px;overflow:hidden;border:1px solid var(--br);cursor:pointer;"
                onclick="window.open('${esc(r.signedUrl)}','_blank')" title="${esc(r.title || r.storage_path)}">
                <img src="${esc(r.signedUrl)}" style="width:100%;height:100%;object-fit:cover;" loading="lazy">
                ${canManage ? `<button class="btn" style="position:absolute;top:2px;right:2px;padding:1px 4px;font-size:9px;background:rgba(255,255,255,.85);border:none;border-radius:4px;cursor:pointer;color:var(--rd);"
                  onclick="event.stopPropagation();PropertyObjectPage._deleteImage('${r.id}','${esc(r.storage_path)}')">${ic('trash-2',9)}</button>` : ''}
              </div>`;
            }
            return `<div style="display:flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--br);border-radius:8px;cursor:pointer;font-size:12px;"
              onclick="window.open('${esc(r.signedUrl)}','_blank')" title="${esc(r.storage_path)}">
              ${ic('file',13)} ${esc(r.title || r.storage_path.split('/').pop())}
              ${canManage ? `<button class="btn" style="margin-left:6px;padding:1px 5px;font-size:9px;color:var(--rd);border:none;cursor:pointer;"
                onclick="event.stopPropagation();PropertyObjectPage._deleteImage('${r.id}','${esc(r.storage_path)}')">${ic('trash-2',9)}</button>` : ''}
            </div>`;
          }).join('')}
        </div>`;
    } catch(e) {
      if (bodyEl) bodyEl.innerHTML = `<div style="font-size:12px;color:var(--rd);padding:6px 0;">Kunde inte ladda bilder: ${esc(e.message||'okänt fel')}</div>`;
    }
  },

  _openImageUpload() {
    const obj = this.objId ? getPropObj(this.objId) : null;
    if (!obj) return;
    const body = `
      <div class="fg"><label>Fil (bild eller dokument)</label>
        <input type="file" id="pobj-img-file" accept="image/*,.pdf,.docx,.xlsx,.txt,.dwg" style="font-size:13px;">
      </div>
      <div class="fg"><label>Titel / filnamn (visas i listan)</label>
        <input id="pobj-img-title" placeholder="t.ex. Ritning badrum" style="font-size:13px;">
      </div>
      <div class="fg"><label>Kategori (valfritt)</label>
        <select id="pobj-img-cat" style="font-size:13px;">
          <option value="">— Välj —</option>
          <option>Ritning</option><option>Protokoll</option><option>Foto</option>
          <option>Besiktning</option><option>Hyreskontrakt</option><option>Övrigt</option>
        </select>
      </div>`;
    Modal.open({
      title: 'Ladda upp bild / dokument',
      body,
      buttons: [
        { label: 'Ladda upp', cls: 'btn bp', onClick: () => this._doImageUpload(obj) },
        { label: 'Avbryt',    cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  async _doImageUpload(obj) {
    const fileEl  = document.getElementById('pobj-img-file');
    const titleEl = document.getElementById('pobj-img-title');
    const catEl   = document.getElementById('pobj-img-cat');
    const file = fileEl && fileEl.files && fileEl.files[0];
    if (!file) { alert('Välj en fil.'); return; }
    if (file.size > 20 * 1024 * 1024) { alert('Filen är för stor (max 20 MB).'); return; }
    const btn = document.querySelector('.modal-footer .btn.bp');
    if (btn) { btn.disabled = true; btn.textContent = 'Laddar upp…'; }
    try {
      await PropertyImageService.upload(obj.propertyId, file, {
        title: (titleEl && titleEl.value.trim()) || file.name,
        category: catEl && catEl.value,
        techSection: 'obj:' + obj.id
      });
      Modal.close();
      showToast('Uppladdad');
      this._loadImages(obj);
    } catch(e) {
      alert('Uppladdning misslyckades: ' + (e.message || 'okänt fel'));
      if (btn) { btn.disabled = false; btn.textContent = 'Ladda upp'; }
    }
  },

  async _deleteImage(id, storagePath) {
    const obj = this.objId ? getPropObj(this.objId) : null;
    if (!confirm('Ta bort bild/dokument?')) return;
    try {
      await PropertyImageService.remove(id, storagePath);
      showToast('Borttagen');
      if (obj) this._loadImages(obj);
    } catch(e) {
      alert('Kunde inte ta bort: ' + (e.message || 'okänt fel'));
    }
  },

  /* ── Hyresgästkontakter CRUD (punkt 71) ────────────────────── */

  _addTenantContact() {
    this._tenantContactForm(null);
  },

  _editTenantContact(id) {
    const obj = this.objId ? getPropObj(this.objId) : null;
    if (!obj) return;
    const c = (obj.contacts || []).find(function(x) { return x.id === id; });
    if (c) this._tenantContactForm(c);
  },

  _removeTenantContact(id) {
    const self = this;
    Modal.confirm('Ta bort kontakten?', function() {
      const obj = self.objId ? getPropObj(self.objId) : null;
      if (!obj) return;
      obj.contacts = (obj.contacts || []).map(function(c) {
        return c.id === id ? Object.assign({}, c, { active: false }) : c;
      });
      persist();
      self.render({ objId: self.objId });
    });
  },

  _tenantContactForm(contact) {
    const c = contact || {};
    const ROLES = ['Hyresgäst', 'Lokalansvarig', 'Kontaktperson', 'Driftansvarig', 'Fastighetsskötare', 'Övrigt'];
    const body = `
      <div class="fg"><label>Namn *</label>
        <input id="ptc-name" value="${esc(c.name||'')}" placeholder="Förnamn Efternamn">
      </div>
      <div class="fg"><label>Roll</label>
        <select id="ptc-role">
          <option value="">— Välj roll —</option>
          ${ROLES.map(function(r) { return `<option value="${r}" ${c.role===r?'selected':''}>${r}</option>`; }).join('')}
          <option value="__custom__" ${c.role && !ROLES.includes(c.role)?'selected':''}>Annat…</option>
        </select>
      </div>
      <div class="fg" id="ptc-role-custom-wrap" style="${c.role && !ROLES.includes(c.role) ? '' : 'display:none'}">
        <label>Roll (fritext)</label>
        <input id="ptc-role-custom" value="${c.role && !ROLES.includes(c.role)?esc(c.role):''}">
      </div>
      <div class="fg"><label>Telefon</label>
        <input id="ptc-phone" type="tel" value="${esc(c.phone||'')}" placeholder="070-xxx xx xx">
      </div>
      <div class="fg"><label>E-post</label>
        <input id="ptc-email" type="email" value="${esc(c.email||'')}" placeholder="namn@exempel.se">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div class="fg"><label>Från</label>
          <input id="ptc-from" type="date" value="${esc(c.validFrom||'')}">
        </div>
        <div class="fg"><label>Till</label>
          <input id="ptc-to" type="date" value="${esc(c.validTo||'')}">
        </div>
      </div>
      <div class="fg"><label>Anteckning</label>
        <input id="ptc-notes" value="${esc(c.notes||'')}">
      </div>
      <div class="fg" style="display:flex;align-items:center;gap:8px;">
        <input type="checkbox" id="ptc-primary" ${c.isPrimary?'checked':''}>
        <label for="ptc-primary" style="margin:0;font-weight:500;">Primär kontakt</label>
      </div>`;

    Modal.open({
      title: contact ? 'Redigera kontakt' : 'Lägg till kontakt',
      body,
      onOpen: function() {
        const sel = document.getElementById('ptc-role');
        if (sel) sel.addEventListener('change', function() {
          const wrap = document.getElementById('ptc-role-custom-wrap');
          if (wrap) wrap.style.display = sel.value === '__custom__' ? '' : 'none';
        });
      },
      buttons: [
        { label: contact ? 'Spara' : 'Lägg till', cls: 'btn bp', onClick: () => this._saveTenantContact(contact ? contact.id : null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _saveTenantContact(id) {
    const obj = this.objId ? getPropObj(this.objId) : null;
    if (!obj) return;
    const name = (document.getElementById('ptc-name')?.value || '').trim();
    if (!name) { alert('Namn är obligatoriskt.'); return; }
    const selRole = document.getElementById('ptc-role')?.value || '';
    const role = selRole === '__custom__'
      ? (document.getElementById('ptc-role-custom')?.value || '').trim()
      : selRole;
    const phone     = (document.getElementById('ptc-phone')?.value || '').trim();
    const email     = (document.getElementById('ptc-email')?.value || '').trim();
    const validFrom = document.getElementById('ptc-from')?.value || '';
    const validTo   = document.getElementById('ptc-to')?.value || '';
    const notes     = (document.getElementById('ptc-notes')?.value || '').trim();
    const isPrimary = document.getElementById('ptc-primary')?.checked || false;
    const now = new Date().toISOString();

    if (!obj.contacts) obj.contacts = [];

    if (id) {
      const idx = obj.contacts.findIndex(function(c) { return c.id === id; });
      if (idx >= 0) Object.assign(obj.contacts[idx], { name, role, phone, email, validFrom, validTo, notes, isPrimary, updatedAt: now });
    } else {
      const newId = 'TC-' + Date.now().toString(36).toUpperCase();
      obj.contacts.push({ id: newId, name, role, phone, email, validFrom, validTo, notes, isPrimary, active: true, createdAt: now, updatedAt: now });
    }

    persist();
    Modal.close();
    this.render({ objId: this.objId });
  },

  /* ── Ansvariga (PropertyContactService) ──────────────────────── */

  _addContact() {
    this._contactForm(null);
  },

  _editContact(id) {
    if (typeof PropertyContactService === 'undefined') return;
    const c = PropertyContactService.getByObject(this.objId, true).find(function(x) { return x.id === id; });
    if (c) this._contactForm(c);
  },

  _removeContact(id) {
    const self = this;
    Modal.confirm('Ta bort ansvarig från objektet?', function() {
      if (typeof PropertyContactService !== 'undefined') PropertyContactService.remove(id);
      self.render({ objId: self.objId });
    });
  },

  _contactForm(contact) {
    if (typeof PropertyContactService === 'undefined') return;
    const roles     = PropertyContactService.activeRoles();
    const staffList = (state.staff || []).filter(function(s) { return s.active !== false; });
    const c         = contact || {};
    const body = `
      <div class="fg"><label>Roll</label>
        <select id="pobj-con-role">
          <option value="">— Välj roll —</option>
          ${roles.map(function(r) { return `<option value="${r.id}" ${c.roleId===r.id?'selected':''}>${esc(r.name)}</option>`; }).join('')}
        </select>
      </div>
      <div class="fg"><label>Persontyp</label>
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
            ${staffList.map(function(s) { return `<option value="${s.id}" ${c.personId===s.id?'selected':''}>${esc(s.firstName+' '+s.lastName)}</option>`; }).join('')}
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
    const t  = document.getElementById('pobj-con-person-type')?.value;
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
      propertyId: obj.propertyId,
      objectId:   obj.id,
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

  /* ── AO-skapande ──────────────────────────────────────────── */

  openCreateAO() {
    const obj = this.objId ? getPropObj(this.objId) : null;
    if (!obj) return;
    Router.showPage('pg-ao', {});
    setTimeout(function() {
      WorkOrdersPage.openCreateAO({
        propertyId: obj.propertyId,
        customerId: obj.customerId,
        objectId:   obj.id,
        objectName: obj.name || obj.objectNumber
      });
    }, 100);
  }
};
