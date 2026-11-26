/**
 * WorkOrderDetailPage — Fullständig AO-detaljvy (v46)
 * v46: Adressrad klickbar (öppnar karta), ta bort Navigera-knapp
 */

/* V38 §2: kanonisk 0-safe momsnormalisering för AO-material — samma
   semantik som InvoiceService.normalizeVatRate/PageShells._normVat
   (V35-V38). null/undefined/tomsträng (inkl. whitespace-only) = inget
   värde satt -> fallback 25; explicit 0/'0' = 0 % (behålls exakt);
   giltigt 0-100 behålls exakt; NaN/Infinity/negativt/>100 -> fallback.
   Materialets vatRate är källan BillingQueueService sedan fakturerar
   från (V33/V36), så konsistens här är kritisk. */
function _matNormVat(value, fallback) {
  if (fallback === undefined) fallback = 25;
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string' && value.trim() === '') return fallback;
  const n = Number(value);
  if (!isFinite(n) || n < 0 || n > 100) return fallback;
  return n;
}

/* V39 §2: STRIKT write-validering för materialets moms — skild från
   _matNormVat()'s read/display-fallback-semantik. Saknat/tomt värde
   (inget angivet) är enligt befintlig datamodell fortsatt giltigt och
   ska falla tillbaka på 25 % som vanligt (value:null signalerar detta
   till anroparen). Men ett SATT, matematiskt ogiltigt värde (t.ex. en
   redan korrupt källa) får INTE tyst "repareras" till 25 % vid save —
   det ska blockera hela sparningen. */
function _matStrictVat(value) {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value === 'string' && value.trim() === '') return { ok: true, value: null };
  const n = Number(value);
  if (!isFinite(n) || n < 0 || n > 100) return { ok: false, error: 'Ogiltig momssats.' };
  return { ok: true, value: n };
}

/* V41 §6: liten delad markup-helper för momsväljaren på AO-materialraden
   — INGEN ny ekonomisk beräkning, bara HTML för <option>-listan. Samma
   fyra satser som artikelregistrets egen momsväljare (0/6/12/25). */
function _matVatOptionsHtml(selectedVat) {
  return [0,6,12,25].map(r=>`<option value="${r}" ${r===selectedVat?'selected':''}>${r}%</option>`).join('');
}

const WorkOrderDetailPage = {
  aoId: null,
  _stampInterval: null,

  render(params) {
    this._stopStampTimer();
    const el = document.getElementById('pg-ao-detail-content');
    if (!el) return;
    const id = params && params.aoId;
    this.aoId = id;
    const ao = id ? getAO(id) : null;
    if (!ao) {
      el.innerHTML = `<div class="empty">${ic('clipboard-list',32)}<h3>Välj en order</h3></div>`;
      return;
    }
    // ao_view_own: technicians may only see their own AOs (pool is always visible)
    if (!Auth.can('ao_view_all') && !Auth.can('all') && Auth.can('ao_view_own') && state.currentUser) {
      const myId = state.currentUser.id;
      if (!(ao.staff || []).includes(myId) && ao.status !== 'pool') {
        el.innerHTML = `<div class="empty">${ic('lock',32)}<h3>Ingen behörighet</h3><p>Du har inte tillgång till denna arbetsorder.</p></div>`;
        return;
      }
    }
    this._renderFull(el, ao);
    if (state.stampActive && state.stampAoId === ao.id) this._startStampTimer();
  },

  /* ── V3 AO-detalj (2026-11-26) ───────────────────────────────────────
     Ordning efter hur man arbetar: sidhuvud med EN primär statusåtgärd,
     några synliga sekundära och en grupperad meny för resten; en kompakt
     stämplingsrad (Din arbetstid) skild från statusåtgärderna; därefter
     "Uppdrag & utförande" med checklistan direkt i samma kort, material,
     arbetstid, bilder och historik. Sidokolumnen: prissättning (bara roller
     som redan fick se pris), var/när/vem/kund och sist metadata.
     Ren presentation — samma funktioner, behörigheter och skrivvägar. */

  /* Id i inline-handlare: bara tecken som förekommer i systemets id:n
     (AO-007, K-002, c1732…). Normala id:n blir oförändrade; allt annat
     rensas bort så att data aldrig kan bryta sig ur ett onclick-attribut. */
  _id(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[^A-Za-z0-9_.:\-]/g, '');
  },

  /* T4-C (D-05, SÄK-7 tilldelningsvägen): fältpersonal med objects_access_assigned (utan
     objects_sensitive) hämtar åtkomstinformationen för EGEN tilldelad AKTIV AO via den smala,
     loggade servervägen (get-sensitive-fields med workOrderId). Servern avgör; klientens villkor
     styr bara om knappen visas. Värdena visas på begäran, sparas aldrig i state eller cache, och
     varje hämtning ger en revisionsrad hos servern (utan värden). */
  _atkomstMojlig(ao) {
    if (!ao || typeof Auth === 'undefined' || !Auth.can('objects_access_assigned') || Auth.can('objects_sensitive')) return false;
    const me = state.currentUser && state.currentUser.id;
    const mine = !!me && Array.isArray(ao.staff) && ao.staff.map(String).includes(String(me));
    const aktiv = ['nytt', 'planerad', 'pågående'].includes(ao.status) && !ao.archived && !ao.deleted && !ao.invoiceId;
    return mine && aktiv && !!(ao.objectId || ao.propertyId);
  },

  async visaAtkomst(aoId) {
    const ao = (state.workOrders || []).find((x) => x && x.id === aoId);
    const els = Array.from(document.querySelectorAll('.aod-atkomst'));
    const visa = (html) => els.forEach((el) => { el.innerHTML = html; });
    if (!ao || !this._atkomstMojlig(ao)) { visa('<span class="aod-muted">Åtkomstinformation visas bara för egna aktiva uppdrag.</span>'); return; }
    visa('<span class="aod-muted">Hämtar …</span>');
    try {
      const res = await fetch(SUPABASE_URL + '/functions/v1/get-sensitive-fields', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + (Auth.getAccessToken() || ''), 'Content-Type': 'application/json' },
        body: JSON.stringify(ao.objectId ? { objectId: ao.objectId, workOrderId: ao.id } : { propertyId: ao.propertyId, workOrderId: ao.id })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        visa('<span class="aod-muted">' + (d && d.reason === 'not_assigned'
          ? 'Åtkomstinformation visas bara för egna aktiva uppdrag.' : 'Åtkomstinformationen kunde inte hämtas.') + '</span>');
        return;
      }
      const rader = [['Portkod', d.doorCode || d.accessCode], ['Kod', d.doorCode && d.accessCode && d.accessCode !== d.doorCode ? d.accessCode : ''],
        ['Nyckel', d.keyInformation], ['Tillträde', d.accessInformation], ['Larm', d.alarmInformation]].filter((r) => r[1]);
      visa(rader.length ? rader.map((r) => `<span>${esc(r[0])} <b class="aod-code">${esc(r[1])}</b></span>`).join(' · ')
        : '<span class="aod-muted">Ingen åtkomstinformation registrerad.</span>');
    } catch (e) {
      visa('<span class="aod-muted">Åtkomstinformationen kunde inte hämtas.</span>');
    }
  },

  /* Tomläge enligt V3-komponentstandarden (§6): .empty med ikon, h3, en
     mening och en åtgärd om sådan finns — här kompakt inne i kortet. Kortets
     egen rubrikknapp döljs medan tomläget visas (en åtgärd, inte två). */
  _empty(icon, title, text, action) {
    return `<div class="empty aod-empty">${ic(icon,22)}<h3>${esc(title)}</h3><p>${esc(text)}</p>${action || ''}</div>`;
  },

  /* Timmar med svensk decimal enligt V3-komponentstandarden ("26,5 h"). */
  _h(min) {
    const h = Math.round((Number(min) || 0) / 60 * 100) / 100;
    return h.toLocaleString('sv-SE', { maximumFractionDigits: 2 }) + ' h';
  },

  /* Utförandestatus i klartext (härledd ur befintlig status — ändrar inget). */
  _execStatus(ao) {
    const SUB = {'inväntar_material':'Inväntar material','inväntar_kund':'Inväntar kund','pausad':'Pausad','behöver_återbesök':'Behöver återbesök','blockerad':'Blockerad'};
    const parts = [];
    let tone = 'neutral', label = 'Ej påbörjat', icon = 'circle';
    if (ao.status === 'pågående') { tone = 'warn'; label = 'Pågår'; icon = 'play-circle'; if (ao.substatus) parts.push(esc(SUB[ao.substatus] || ao.substatus)); }
    else if (ao.status === 'klar') { tone = 'ok'; label = 'Utfört'; icon = 'check-circle'; }
    else if (ao.status === 'fakturerad') { tone = 'ok'; label = 'Utfört och fakturerat'; icon = 'check-circle'; }
    else if (ao.status === 'avbruten') { tone = 'neutral'; label = 'Avbrutet'; icon = 'x-circle'; }
    else if (ao.status === 'pool') { label = 'Ej påbörjat — ligger i arbetspoolen'; }
    if ((ao.status === 'klar' || ao.status === 'fakturerad') && (ao.completedAt || ao.completedBy)) {
      parts.push('Klarmarkerad' + (ao.completedAt ? ' ' + esc(fmtDate(ao.completedAt)) : '') + (ao.completedBy ? ' av ' + esc(ao.completedBy) : ''));
    }
    return `<div class="aod-exec tone-${tone}" id="ao-exec">${ic(icon,14)}<span class="aod-exec-l">Utförande</span><strong>${label}</strong>${parts.length ? `<span class="aod-exec-x">${parts.join(' · ')}</span>` : ''}</div>`;
  },

  _renderFull(el, ao) {
    const cu     = getCu(ao.customerId);
    const cuName = cu ? CustomerService.displayName(cu) : '—';
    const staffObjs = (ao.staff||[]).map(id => getStaff(id) || { id, firstName: id, lastName: '' });
    const respS  = ao.responsibleStaffId ? getStaff(ao.responsibleStaffId) : null;
    const chkTotal = (ao.checklist||[]).length;
    const chkK = WorkOrderService.checklistCounts(ao.checklist || []);
    const timeEntries = TimeService.getByAO(ao.id);
    const totalMins   = TimeService.totalMinutes(timeEntries);
    const isStampedOnThis = state.stampActive && state.stampAoId === ao.id;
    const isAkut  = ao.priority === 'akut';
    const canEdit = Auth.can('ao_edit');
    const today = tdy();
    const aoId = this._id(ao.id);
    const closed = ['klar','fakturerad','avbruten'].includes(ao.status);

    /* ── Rollstyrning: vad som visas beror på behörigheter ── */
    /* Pris, faktura, TB: syns bara för admin/ledning/ekonomi  */
    const canSeePrice         = Auth.canAny(['invoice_view','invoice_create','reports_view']);
    const canSeeProfitability = Auth.canAny(['reports_view','staff_view']);

    const SUB = {'inväntar_material':'Inväntar material','inväntar_kund':'Inväntar kund','pausad':'Pausad','behöver_återbesök':'Behöver återbesök','blockerad':'Blockerad'};
    /* R2 §2/§3 + R2.1 §10: fullständig strukturerad adress (AO:ns egen
       snapshot, annars fastighetens/kundens) — ren läsning. */
    const resolved = AddressService.resolveWorkOrderDisplayAddress(ao);
    const fullAddr = resolved.address ? AddressService.displayAddress(ao) : '';
    const mapsUrl  = fullAddr ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(fullAddr)}` : '';
    const placeBits = [ao.floor&&('Vån '+esc(ao.floor)), ao.entrance&&('Entré '+esc(ao.entrance)), ao.stairwell&&('Trapphus '+esc(ao.stairwell)), ao.apartmentNumber&&('Lgh '+esc(ao.apartmentNumber))].filter(Boolean);
    const when = ao.scheduledDate
      ? `${esc(UiKit.dayLabel(ao.scheduledDate, today))}${ao.scheduledStart ? ' · ' + esc(ao.scheduledStart) + (ao.scheduledEnd ? '–' + esc(ao.scheduledEnd) : '') : ''}`
      : '';
    const overdue = WorkOrderService.isOverdue(ao, today);

    /* Nästa steg — en mening som svarar på "vad händer nu?". Knapp bara
       för åtgärder som INTE redan finns i åtgärdsraden ovanför. */
    const ns = WorkOrderService.nextStep(ao, today);
    let nsBtn = '';
    if (ns && ns.action === 'assign' && canEdit) nsBtn = `<button class="btn bs bsm" onclick="WorkOrderDetailPage.manageStaff('${aoId}')">${ic('user-plus',14)} Tilldela</button>`;
    if (ns && ns.action === 'plan' && canEdit) nsBtn = `<button class="btn bs bsm" onclick="WorkOrderDetailPage.openReschedule()">${ic('calendar',14)} ${ao.scheduledDate ? 'Omplanera' : 'Planera'}</button>`;
    const nsIcon = { danger: 'alert-triangle', warn: 'alert-circle', info: 'info', ok: 'check-circle', neutral: 'info' }[ns ? ns.tone : 'neutral'];

    const fact = (label, value, icon) => `<div class="aod-fact"><span class="aod-fact-l">${icon ? ic(icon, 13) : ''}${label}</span><span class="aod-fact-v">${value}</span></div>`;
    const objLink = ao.objectId ? `<a class="aod-link" onclick="Router.showPage('pg-propobj-detail',{objId:'${this._id(ao.objectId)}'})">${esc(ao.objectNumber ? ao.objectNumber+' – ' : '')}${esc(ao.objectName || ao.objectId)}</a>` : '';
    const cuLink = cu ? `<a class="aod-link" onclick="Router.showPage('pg-crm-detail',{customerId:'${this._id(cu.id)}'})">${esc(cuName)}</a>` : '';
    const showDetailsOpen = typeof window !== 'undefined' && window.innerWidth >= 1200;
    /* Mobilens plats-/kontaktkort ritas bara när det finns något att visa
       (en order utan adress och kontakt gav annars ett tomt kort). */
    const atkomst = this._atkomstMojlig(ao);
    const atkomstKnapp = atkomst ? `<span class="aod-atkomst"><button class="btn bs bsm" onclick="WorkOrderDetailPage.visaAtkomst('${this._id(ao.id)}')">${ic('key',13)} Visa åtkomstinformation</button></span>` : '';
    const hasField = !!(mapsUrl || ao.phone || fullAddr || (ao.accessCode && Auth.can('objects_sensitive')) || atkomst || ao.objectId || ao.contactPerson);

    el.innerHTML = `
      ${ao.deleted ? `<div class="nbox aod-banner is-danger">${ic('trash',14)} Denna arbetsorder finns i papperskorgen och raderas automatiskt ${ao.deleteAfter?esc(fmtDate(ao.deleteAfter)):'om 14 dagar'}.</div>` : ''}
      ${ao.archived && !ao.deleted ? `<div class="nbox aod-banner">${ic('archive',14)} Denna arbetsorder är arkiverad och syns inte i ordinarie lista.</div>` : ''}

      <div class="aod">
        <!-- Sidhuvud: tillbaka, nummer, status — rubrik — var/när/vem — åtgärder — din arbetstid -->
        <header class="aod-head card">
          <div class="aod-head-top">
            <button class="btn bghost bsm ao-back-btn" onclick="Router.back()" title="Tillbaka">${ic('arrow-left',15)} <span class="ao-back-label">Tillbaka</span></button>
            <span class="aod-no">${esc(WorkOrderService.displayNumberOrPending(ao))}</span>
            <div class="aod-badges">
              ${sbdg(ao.status)}
              ${isAkut ? `<span class="bdg bdg-red ao-akut-badge">${ic('alert-triangle',11)}Akut</span>` : ao.priority && ao.priority!=='normal' ? pbdg(ao.priority) : ''}
              ${ao.status==='pågående'&&ao.substatus ? `<span class="bdg bdg-yellow">${esc(SUB[ao.substatus]||ao.substatus)}</span>` : ''}
              ${ao.category ? catBadge(ao.category) : ''}
            </div>
          </div>
          <h2 class="aod-title ao-title-main">${esc(ao.title)}</h2>
          <div class="aod-meta">
            ${cu ? `<a class="aod-meta-i" onclick="Router.showPage('pg-crm-detail',{customerId:'${this._id(cu.id)}'})">${ic('building-2',14)}<span>${esc(cuName)}</span></a>` : ''}
            ${fullAddr ? `<a class="aod-meta-i ao-address-link" href="${esc(mapsUrl)}" target="_blank" rel="noopener" title="Öppna vägbeskrivning">${ic('map-pin',14)}<span>${esc(fullAddr)}</span></a>` : ''}
            <span class="aod-meta-i${overdue ? ' is-late' : ''}">${ic('calendar',14)}<span>${when || 'Ej planerad'}</span></span>
            <span class="aod-meta-i">${UiKit.avatarStack(ao.staff, 4)}<span>${staffObjs.length ? esc(staffObjs.map(UiKit.staffName).join(', ')) : '<span class="aod-warn">Ingen tilldelad</span>'}</span></span>
          </div>
          <div class="aod-actbar" role="toolbar" aria-label="Åtgärder för arbetsordern">${this._actionBtns(ao)}</div>
          ${Auth.can('ao_time') ? this._stampSection(ao, isStampedOnThis) : ''}
        </header>

        ${ns ? `<div class="aod-next tone-${ns.tone}" role="status">
          <span class="aod-next-ico">${ic(nsIcon,16)}</span>
          <div class="aod-next-txt"><span class="aod-next-l">Nästa steg</span><span class="aod-next-t">${esc(ns.text)}</span></div>
          ${nsBtn}
        </div>` : ''}

        <div class="aod-grid">
          <div class="aod-main">
            <!-- Uppdrag & utförande: vad som ska göras, instruktioner, checklista med framsteg, avvikelser -->
            <section class="card aod-mission ao-mission-card${isAkut?' ao-mission-akut':''}" aria-labelledby="aod-mission-h">
              <div class="card-header">
                <h3 id="aod-mission-h">${ic('clipboard-list',15)} Uppdrag &amp; utförande</h3>
                ${isAkut ? `<span class="bdg bdg-red">${ic('alert-triangle',11)}Akut — prioritera</span>` : ''}
              </div>
              <div class="card-body ao-mission-body">
                ${this._execStatus(ao)}
                <div class="aod-sub aod-what">
                  <h4 class="aod-sub-h">Vad ska göras</h4>
                  ${ao.description ? `<p class="ao-mission-text">${esc(ao.description)}</p>` : `<p class="ao-mission-empty">${ic('info',13)} Ingen beskrivning angiven</p>`}
                </div>
                ${ao.internalNote ? `<div class="aod-note">${ic('eye-off',13)}<div><strong>Intern anteckning</strong><br>${esc(ao.internalNote)}</div></div>` : ''}
                <div class="aod-sub aod-chk-sec" id="ao-chk-sec">
                  <div class="aod-chk-head">
                    <h4 class="aod-sub-h">${ic('clipboard-check',14)} Checklista</h4>
                    ${Auth.can('ao_checklist') ? `<button class="btn bs bsm aod-chk-add" onclick="WorkOrderDetailPage.openAddChecklist()">${ic('plus',13)} Lägg till punkt</button>` : ''}
                  </div>
                  <div id="ao-chk-counter" class="aod-chkp-wrap">${this._checklistBadgeHtml(ao)}</div>
                  <div class="aod-chk-list" id="ao-checklist">
                    ${this._renderChecklist(ao)}
                  </div>
                  <div id="ao-chk-avv">${this._avvikelseSummary(ao)}</div>
                </div>
              </div>
            </section>

            <!-- Mobil: plats och kontakt i ETT kort (ersätter Var/När/Vem/Kontakt under 768 px;
                 tid och personal står redan i sidhuvudet) -->
            ${hasField ? `<section class="card aod-field" aria-label="Plats och kontakt">
              <div class="aod-field-acts">
                ${mapsUrl ? `<a class="btn bs bsm" href="${esc(mapsUrl)}" target="_blank" rel="noopener">${ic('navigation',14)} Vägbeskrivning</a>` : ''}
                ${ao.phone ? `<a class="btn bs bsm" href="tel:${esc(ao.phone)}">${ic('phone',14)} Ring${ao.contactPerson ? ' ' + esc(String(ao.contactPerson).split(' ')[0]) : ''}</a>` : ''}
              </div>
              <div class="aod-field-rows">
                ${fullAddr ? `<div class="aod-fr">${ic('map-pin',14)}<span>${esc(fullAddr)}${placeBits.length ? ` <em>· ${placeBits.join(' · ')}</em>` : ''}</span></div>` : ''}
                ${ao.accessCode && Auth.can('objects_sensitive') ? `<div class="aod-fr">${ic('key',14)}<span>Portkod <b class="aod-code">${esc(ao.accessCode)}</b></span></div>` : ''}
                ${atkomst ? `<div class="aod-fr">${ic('key',14)}${atkomstKnapp}</div>` : ''}
                ${ao.objectId ? `<div class="aod-fr">${ic('dashboard',14)}${objLink}</div>` : ''}
                ${ao.contactPerson || ao.phone ? `<div class="aod-fr">${ic('user',14)}<span>${ao.contactPerson ? esc(ao.contactPerson) : ''}${ao.phone ? ` <span class="aod-muted">${esc(ao.phone)}</span>` : ''}</span></div>` : ''}
              </div>
            </section>` : ''}

            <!-- Material och kostnader -->
            <section class="card aod-mat" aria-labelledby="aod-mat-h">
              <div class="card-header">
                <h3 id="aod-mat-h">${ic('package',15)} Material och kostnader</h3>
                <div class="aod-card-acts">
                  <span id="ao-mat-count">${(ao.materials||[]).length ? `<span class="bdg bdg-grey">${(ao.materials||[]).length} st</span>` : ''}</span>
                  ${Auth.can('ao_material')?`<button class="btn bs bsm" onclick="WorkOrderDetailPage.openAddMaterial()">${ic('plus',13)} Lägg till</button>`:''}
                </div>
              </div>
              <div id="ao-materials">${this._renderMaterials(ao)}</div>
              <div id="ao-mat-totals">${(ao.materials||[]).length?this._matTotals(ao):''}</div>
            </section>

            <!-- Arbetstid: registrerade tidposter (+ tid mot plan för roller som ser ekonomi) -->
            <section class="card aod-time" aria-labelledby="aod-time-h">
              <div class="card-header">
                <h3 id="aod-time-h">${ic('clock',15)} Arbetstid</h3>
                <div class="aod-card-acts">
                  <span id="ao-time-badge">${totalMins>0?`<span class="bdg bdg-sky">${WorkOrderDetailPage._h(totalMins)}</span>`:''}</span>
                  ${Auth.canAny(['ao_time','payroll_manage'])?`<button class="btn bs bsm" onclick="WorkOrderDetailPage.openAddTime()">${ic('plus',13)} Registrera tid</button>`:''}
                </div>
              </div>
              <div id="ao-time-plan" class="aod-plan">${canSeePrice?this._timePlanBlock(ao):''}</div>
              <div id="ao-timeentries">${this._renderTimeEntries(ao)}</div>
            </section>

            <!-- Bilder (foton från loggen) -->
            <section class="card aod-photos" aria-labelledby="aod-photos-h">
              <div class="card-header">
                <h3 id="aod-photos-h">${ic('camera',15)} Bilder</h3>
                <div class="aod-card-acts">
                  <span id="ao-photo-count"></span>
                  <button class="btn bs bsm" onclick="WorkOrderDetailPage.openAddLog()">${ic('camera',13)} Foto eller anteckning</button>
                </div>
              </div>
              <div id="ao-photos">${this._renderPhotos(ao)}</div>
            </section>

            <!-- Aktivitetshistorik (anteckningar, bilder, tid, material, statusändringar) -->
            <section class="card aod-log" aria-labelledby="aod-log-h">
              <div class="card-header">
                <h3 id="aod-log-h">${ic('history',15)} Aktivitetshistorik</h3>
                <div class="aod-card-acts">
                  <button class="btn bs bsm" onclick="WorkOrderDetailPage.openFollowUp()">${ic('bell',13)} Uppföljning</button>
                  <button class="btn bs bsm" onclick="WorkOrderDetailPage.openAddLog()">${ic('plus',13)} Anteckning</button>
                </div>
              </div>
              <div id="ao-timeline">
                ${this._renderTimeline(ao)}
              </div>
            </section>
          </div>

          <aside class="aod-side">
            <!-- Prissättning och fakturering (bara roller som redan fick se pris) -->
            ${canSeePrice ? this._pricingCard(ao) : ''}

            <!-- Intern lönsamhet (bara admin/ledning med reports/staff-behörighet) -->
            <div id="ao-lonsam" class="aod-lonsam">${canSeeProfitability?this._renderLonsamhet(ao):''}</div>

            <!-- Var -->
            <section class="card aod-box aod-where">
              <div class="card-header"><h3>${ic('map-pin',15)} Var</h3>${mapsUrl ? `<a class="btn bxs bs" href="${esc(mapsUrl)}" target="_blank" rel="noopener">${ic('navigation',12)} Vägbeskrivning</a>` : ''}</div>
              <div class="card-body">
                ${fullAddr ? `<div class="aod-addr">${esc(fullAddr)}</div>` : '<div class="aod-muted">Ingen adress angiven</div>'}
                ${placeBits.length ? fact('Plats', placeBits.join(' · '), 'map-pin') : ''}
                ${ao.objectId ? fact('Objekt', objLink, 'dashboard') : ''}
                ${ao.accessCode && Auth.can('objects_sensitive') ? fact('Portkod', `<span class="aod-code">${esc(ao.accessCode)}</span>`, 'key') : ''}
                ${atkomst ? fact('Åtkomst', atkomstKnapp, 'key') : ''}
              </div>
            </section>

            <!-- När -->
            <section class="card aod-box aod-when">
              <div class="card-header"><h3>${ic('calendar',15)} När</h3>${canEdit && !closed ? `<button class="btn bxs bghost" onclick="WorkOrderDetailPage.openReschedule()">${ao.scheduledDate ? 'Omplanera' : 'Planera'}</button>` : ''}</div>
              <div class="card-body">
                ${ao.scheduledDate
                  ? `<div class="aod-big${overdue ? ' is-late' : ''}">${esc(UiKit.dayLabel(ao.scheduledDate, today))}${ao.scheduledStart ? ` <span>${esc(ao.scheduledStart)}${ao.scheduledEnd ? '–' + esc(ao.scheduledEnd) : ''}</span>` : ''}</div>
                     <div class="aod-muted">${esc(ao.scheduledDate)}${overdue ? ' · försenad' : ''}</div>`
                  : '<div class="aod-muted">Inte planerad ännu</div>'}
                ${totalMins > 0 ? fact('Registrerad tid', WorkOrderDetailPage._h(totalMins), 'clock') : ''}
              </div>
            </section>

            <!-- Vem -->
            <section class="card aod-box aod-who">
              <div class="card-header"><h3>${ic('users',15)} Vem</h3>${canEdit ? `<button class="btn bxs bghost" onclick="WorkOrderDetailPage.manageStaff('${aoId}')">Ändra</button>` : ''}</div>
              <div class="card-body">
                ${staffObjs.length ? `<ul class="aod-people">${staffObjs.map(st => `<li>${UiKit.avatar(st, 28)}<span>${esc(UiKit.staffName(st))}</span>${respS && respS.id === st.id ? `<span class="bdg bdg-grey">${ic('star',10)} Ansvarig</span>` : ''}</li>`).join('')}</ul>`
                  : `<div class="aod-warn">${ic('user-x',14)} Ingen personal tilldelad</div>`}
              </div>
            </section>

            <!-- Kund och kontakt -->
            <section class="card aod-box aod-contact">
              <div class="card-header"><h3>${ic('phone',15)} Kund och kontakt</h3></div>
              <div class="card-body">
                ${cu ? fact('Kund', cuLink, 'building-2') : ''}
                ${fact('Kontakt', ao.contactPerson ? esc(ao.contactPerson) : '<span class="aod-muted">—</span>', 'user')}
                ${ao.phone ? `<a class="btn bs bsm aod-call" href="tel:${esc(ao.phone)}">${ic('phone',14)} Ring ${esc(ao.phone)}</a>` : ''}
                ${ao.contactEmail ? fact('E-post', `<a class="aod-link" href="mailto:${esc(ao.contactEmail)}">${esc(ao.contactEmail)}</a>`, 'mail') : ''}
              </div>
            </section>

            <!-- Detaljer (administrativ metadata) — öppen på bred skärm, hopfälld på mobil/surfplatta -->
            <details class="card ao-section aod-box aod-details"${showDetailsOpen ? ' open' : ''}>
              <summary class="ao-section-head">
                <span class="ao-section-title">${ic('info',15)} Detaljer</span>
                <span class="aod-sum-hint">Skapad, ändrad, ansvarig</span>
                <span class="ao-section-chevron">${ic('chevron-down',12)}</span>
              </summary>
              <div class="card-body">
                ${ao.category ? fact('Kategori', catBadge(ao.category), 'folder') : ''}
                ${ao.technicalCategorySlug ? fact('Tekniskt', ao.propertyId ? `<a class="aod-link" onclick="Router.showPage('pg-obj-detail',{propId:'${this._id(ao.propertyId)}',tab:'tech'})">${esc(ao.technicalCategoryLabel||ao.technicalCategorySlug)}</a>` : esc(ao.technicalCategoryLabel||ao.technicalCategorySlug), 'settings') : ''}
                ${fact('Ansvarig', respS ? esc(UiKit.staffName(respS)) : '<span class="aod-muted">Ingen angiven</span>', 'star')}
                ${ao.projectId ? fact('Projekt', this._projectRef(ao.projectId), 'briefcase') : ''}
                ${fact('Skapad', ao.createdAt ? esc(fmtDate(ao.createdAt)) : '—', 'clock')}
                ${ao.updatedAt ? fact('Senast ändrad', esc(fmtDateTime(ao.updatedAt)), 'edit-3') : ''}
                ${ao.completedAt ? fact('Klarmarkerad', esc(fmtDate(ao.completedAt)) + (ao.completedBy ? ' · ' + esc(ao.completedBy) : ''), 'check-circle') : ''}
              </div>
            </details>

            <!-- Återkommande (bara för användare med ao_edit) -->
            ${canEdit ? (ao.recurringOrderId
              ? `<a class="aod-linkrow card" onclick="Router.showPage('pg-recurring')">${ic('refresh-cw',14)}<span>Skapad från återkommande mall ${esc(ao.recurringOrderId)}</span>${ic('chevron-right',14)}</a>`
              : `<button class="btn bghost bsm aod-recur" onclick="WorkOrderDetailPage.makeRecurring()" title="Systemet skapar automatiskt nya arbetsorder enligt valt intervall.">${ic('refresh-cw',14)} Gör återkommande</button>`) : ''}
          </aside>
        </div>

        <!-- Mobil: snabbåtgärder fästa ovanför bottenmenyn -->
        <nav class="aod-qbar" aria-label="Snabbåtgärder">
          ${Auth.can('ao_time') && ((!closed && !ao.deleted) || isStampedOnThis)
            ? `<button type="button" class="aod-q ${isStampedOnThis ? 'is-out' : 'is-in'}" onclick="WorkOrderDetailPage.toggleStamp()">${ic(isStampedOnThis ? 'stop-circle' : 'play-circle',18)}<span>${isStampedOnThis ? 'Stämpla ut' : 'Stämpla in'}</span></button>` : ''}
          <button type="button" class="aod-q aod-q-chk" onclick="WorkOrderDetailPage._goSection('ao-chk-sec')">${ic('clipboard-check',18)}<span id="ao-qbar-chk">${this._qbarChkLabel(chkK)}</span></button>
          ${Auth.can('ao_material') ? `<button type="button" class="aod-q" onclick="WorkOrderDetailPage.openAddMaterial()">${ic('package',18)}<span>Material</span></button>` : ''}
          <button type="button" class="aod-q" onclick="WorkOrderDetailPage.openAddLog()">${ic('camera',18)}<span>Foto/anteckn.</span></button>
        </nav>
      </div>
    `;
    this._afterPhotosRender();
  },

  _qbarChkLabel(k) {
    return 'Checklista' + (k && k.total ? ` ${k.done + k.avv}/${k.total}` : '');
  },

  /* Projektreferens i Detaljer: länk bara om rollen får öppna projektkortet. */
  _projectRef(projectId) {
    const p = (typeof ProjectService !== 'undefined' && ProjectService.getById) ? ProjectService.getById(projectId) : null;
    const label = esc(projectId) + (p && p.name ? ' – ' + esc(p.name) : '');
    if (Auth.canViewPage('pg-project-detail')) return `<a class="aod-link" onclick="Router.showPage('pg-project-detail',{projectId:'${this._id(projectId)}'})">${label}</a>`;
    return label;
  },

  /* Scrolla till en sektion (snabbåtgärdsraden på mobil). Hopfällbara
     sektioner öppnas först. */
  _goSection(elementId) {
    this._openSectionOf(elementId);
    const el = document.getElementById(elementId);
    const box = el && (el.closest('details.ao-section') || el);
    if (box && box.scrollIntoView) box.scrollIntoView({ block: 'start', behavior: 'smooth' });
  },

  _renderLonsamhet(ao) {
    if (!Auth.canAny(['reports_view','staff_view'])) return '';
    return `
      <details class="card ao-section" style="margin-top:8px;">
        <summary class="ao-section-head">
          <span class="ao-section-title">${ic('bar-chart-2',13)} Intern lönsamhet</span>
          <span class="ao-section-chevron" style="margin-left:auto;">${ic('chevron-down',12)}</span>
        </summary>
        ${this._tbBlock(ao)}
      </details>`;
  },

  _showAllTimeline() {
    const el = document.getElementById('ao-timeline');
    const ao = getAO(this.aoId);
    if (!el || !ao) return;
    el.innerHTML = this._renderTimeline(ao, true);
  },

  _openSectionOf(elementId) {
    const el = document.getElementById(elementId);
    if (el) { const det = el.closest('details.ao-section'); if (det) det.open = true; }
  },

  /* ── Åtgärdsraden (V3 2026-11-26) ─────────────────────────────────────
     Tidigare: en lång rad (Starta arbete, Byt status, Kontakt, Ny uppgift,
     Omplanera, Redigera, Personal, …) som slog runt eller sköts utanför
     skärmen på smala bredder. Nu: EN primär åtgärd vald ur status (samma
     funktioner och behörighetsvillkor som förut), några synliga sekundära
     och resten i en grupperad meny med ikon + text. Varje åtgärd från den
     tidigare raden finns kvar med samma etikett och samma anrop — se
     _actionModel(), som är den enda källan för villkoren. */
  _actionModel(ao) {
    const canEdit     = Auth.can('ao_edit');
    /* T3-B (D-03): klarmarkera = ao_complete (arbetsledare) eller ao_complete_own på egen
       tilldelad AO (övergångsregel: äldre fältroll med ao_complete). Servern avgör. */
    const meId = state.currentUser && state.currentUser.id;
    const canComplete = Auth.can('ao_complete') && (Auth.can('ao_view_all') || Auth.can('ao_edit'))
      || (WorkOrderService.aoCan('ao_complete_own') && !!meId && (ao.staff || []).includes(meId));
    const canInvoice  = Auth.can('invoice_create');
    const canPricing  = this._canEditPricing();
    const id   = this._id(ao.id);
    const live = !['klar','fakturerad','avbruten'].includes(ao.status);
    const A = [];
    const add = (o) => { A.push(o); return o; };
    /* Status och huvudsteg (villkor oförändrade från _primaryActionBtns) */
    if (canEdit && ['nytt','pool','planerad'].includes(ao.status))
      add({ key:'start', label:'Starta arbete', icon:'play-circle', fn:`WorkOrderDetailPage.setStatus('pågående')`, group:'status', main:true });
    /* Tilldelad utan ao_edit (t.ex. fältarbetare): samma "Starta" som Mina
       jobb redan erbjuder samma person för samma order — se _canStartOwn(). */
    else if (this._canStartOwn(ao))
      add({ key:'start', label:'Starta arbete', icon:'play-circle', fn:`WorkOrderDetailPage.startOwnJob()`, group:'status', main:true });
    if (ao.status === 'pågående' && canComplete)
      add({ key:'complete', label:'Klarmarkera', icon:'check-circle', fn:`WorkOrderDetailPage.markComplete()`, group:'status', main:true });
    if (ao.status === 'klar' && !ao.invoiceId && canInvoice)
      add({ key:'invoice', label:'Skapa fakturaunderlag', icon:'receipt', fn:`InvoicesPage.createFromAO('${id}')`, group:'order', main:true });
    if (canEdit && ao.status === 'avbruten' && !ao.archived && !ao.deleted)
      add({ key:'reactivate', label:'Återaktivera', icon:'rotate-ccw', fn:`WorkOrderDetailPage.openReactivateModal()`, group:'status', main:true });
    if (ao.deleted)
      add({ key:'restore-trash', label:'Återställ', icon:'rotate-ccw', fn:`WorkOrderDetailPage._restoreFromTrash('${id}')`, group:'archive', main:true });
    if (canEdit && live && !ao.archived && !ao.deleted)
      add({ key:'status', label:'Byt status', icon:'refresh-cw', fn:`WorkOrderDetailPage.openStatusModal()`, group:'status' });
    add({ key:'contact', label:'Kontakt', icon:'phone', fn:`WorkOrderDetailPage.openContact()`, group:'order' });
    /* Övriga (villkor oförändrade från _secondaryActions) */
    if (Auth.canViewPage('pg-activities'))
      add({ key:'task', label:'Ny uppgift', icon:'check-square', fn:`ActivitiesPage.openCreate({customerId:'${this._id(ao.customerId)}',propertyId:'${this._id(ao.propertyId)}',relatedType:'workOrder',relatedId:'${id}'})`, group:'order' });
    if (canEdit && ['nytt','pool'].includes(ao.status))
      add({ key:'plan', label:'Planera', icon:'calendar', fn:`WorkOrderDetailPage.setStatus('planerad')`, group:'plan' });
    if (canEdit && ao.status === 'nytt')
      add({ key:'pool', label:'Till pool', icon:'inbox', fn:`WorkOrderDetailPage.setStatus('pool')`, group:'plan' });
    if (canEdit && ao.status === 'planerad')
      add({ key:'reschedule', label:'Omplanera', icon:'calendar', fn:`WorkOrderDetailPage.openReschedule()`, group:'plan' });
    /* T3-B (AP-G): separata, uttryckliga åtgärder i stället för poolrutan i personaldialogen. */
    if (canEdit && live && !ao.archived && !ao.deleted && ao.scheduledDate)
      add({ key:'remove-date', label:'Ta bort datum', icon:'calendar', fn:`WorkOrderDetailPage.removeSchedule()`, group:'plan' });
    if (canEdit && live && !ao.archived && !ao.deleted && ao.status !== 'pågående' && !WorkOrderService.isOpenPool(ao))
      add({ key:'release-pool', label:'Släpp till öppen pool', icon:'inbox', fn:`WorkOrderDetailPage.releaseToPool()`, group:'plan' });
    if (canEdit && ao.status === 'pågående')
      add({ key:'pause', label:'Pausa', icon:'pause-circle', fn:`WorkOrderDetailPage.setStatus('planerad')`, group:'status' });
    if (ao.status === 'klar' && ao.invoiceId)
      add({ key:'view-invoice', label:'Visa fakturaunderlag', icon:'file-text', fn:`Router.showPage('pg-inv-detail',{invoiceId:'${this._id(ao.invoiceId)}'})`, group:'order' });
    if (canEdit) {
      add({ key:'edit', label:'Redigera', icon:'pencil', fn:`WorkOrderDetailPage.openEdit()`, group:'order' });
      add({ key:'staff', label:'Personal', icon:'users', fn:`WorkOrderDetailPage.manageStaff('${id}')`, group:'plan' });
    }
    /* AO-PRICING-RECOVERY — "Ändra prissättning" nåbar OAVSETT status
       (nytt/pågående/klar), gated på samma behörighet som faktiskt kan RÖRA
       prisfälten (_canEditPricing(): ao_edit eller invoice_create). */
    if (canPricing)
      add({ key:'pricing', label:'Ändra prissättning', icon:'tag', fn:`WorkOrderDetailPage.openPricingModal()`, group:'order' });
    if (canEdit && !ao.archived && !ao.deleted) {
      add({ key:'archive', label:'Arkivera', icon:'archive', fn:`WorkOrderDetailPage.openArchiveModal()`, group:'archive' });
      add({ key:'delete', label:'Ta bort', icon:'trash', fn:`WorkOrderDetailPage.openDeleteModal()`, group:'archive', destructive:true });
    }
    if (ao.archived && !ao.deleted)
      add({ key:'restore-archive', label:'Återställ från arkiv', icon:'rotate-ccw', fn:`WorkOrderDetailPage._restoreFromArchive('${id}')`, group:'archive', main:true });
    if (ao.deleted)
      add({ key:'perm-delete', label:'Radera permanent', icon:'trash-2', fn:`WorkOrderDetailPage._confirmPermanentDelete('${id}')`, group:'archive', destructive:true });

    /* EN primär åtgärd. Papperskorg/arkiv först (det enda rimliga nästa
       steget där), annars statusens naturliga nästa steg. */
    const order = ['restore-trash','restore-archive','start','complete','invoice','reactivate'];
    let primary = null;
    for (const k of order) { primary = A.find(a => a.key === k); if (primary) break; }
    /* Substatus-väljaren (bara när en substatus redan är satt — oförändrat villkor). */
    const substatus = ao.status === 'pågående' && canEdit && ao.substatus;
    return { all: A, primary, substatus: !!substatus };
  },

  /* "Starta" för den som är tilldelad ordern men saknar ao_edit — exakt
     samma villkor som Mina jobb (MyJobsPage.render(): sidan Mina jobb får
     visas, ordern är ens egen — staff innehåller en själv —, inte arkiverad
     eller borttagen, status nytt/pool/planerad). Ingen ny behörighet:
     fältarbetaren kan redan starta samma order från Mina jobb; här slipper
     hen byta sida. Servern avgör som förut. */
  _canStartOwn(ao) {
    if (!ao || Auth.can('ao_edit')) return false;
    const me = state.currentUser && state.currentUser.id;
    /* T3-B (D-03): kräver ao_start_own (övergångsregel: äldre fältroll med ao_complete). */
    return !!me && WorkOrderService.aoCan('ao_start_own') && Auth.canViewPage('pg-myjobs') && (ao.staff || []).includes(me)
      && !ao.archived && !ao.deleted && ['nytt','pool','planerad'].includes(ao.status);
  },

  /* Samma anrop och samma besked som MyJobsPage.startJob(): bara status →
     pågående (serverbekräftat besked), ingen stämpling, ingen tidpost. */
  startOwnJob() {
    const ao = getAO(this.aoId);
    if (!this._canStartOwn(ao)) { showToast('Du saknar behörighet för den åtgärden'); return; }
    WorkOrderService.setStatus(this.aoId, 'pågående', {
      onSettled: function (r) {
        if (r && r.ok) showToast('Status: Pågående');
        else if (r && r.final) showToast('Statusändringen kunde inte bekräftas av servern — kontrollera din anslutning och försök igen.');
      }
    });
    this.render({ aoId: this.aoId });
    Sidebar.updateBadges();
  },

  /* Synliga sekundära åtgärder per läge. Dator: upp till tre bredvid den
     primära; mobil: bara Kontakt — allt annat i menyn. */
  _ACT_VISIBLE_DESKTOP: ['status','contact','edit','view-invoice'],
  _ACT_VISIBLE_MOBILE: ['contact'],
  _ACT_GROUPS: [
    { key:'status',  label:'Status' },
    { key:'plan',    label:'Planering och personal' },
    { key:'order',   label:'Arbetsorder' },
    { key:'archive', label:'Arkiv och borttagning' },
  ],

  _actionBtns(ao) {
    const m = this._actionModel(ao);
    const rest = m.all.filter(a => a !== m.primary);
    const pick = (keys, max) => {
      const out = [];
      keys.forEach(k => { const a = rest.find(x => x.key === k); if (a && out.length < max) out.push(a); });
      return out;
    };
    const visD = pick(this._ACT_VISIBLE_DESKTOP, 3);
    const visM = pick(this._ACT_VISIBLE_MOBILE, 1);
    const menuD = rest.filter(a => !visD.includes(a));
    const menuM = rest.filter(a => !visM.includes(a));

    const primaryBtn = m.primary
      ? `<button class="btn bp aod-primary" data-act="${m.primary.key}" onclick="${m.primary.fn}">${ic(m.primary.icon,15)} ${esc(m.primary.label)}</button>` : '';
    const secBtn = (a) => `<button class="btn bs aod-sec${a.destructive ? ' is-danger' : ''}" data-act="${a.key}" onclick="${a.fn}">${ic(a.icon,14)} <span>${esc(a.label)}</span></button>`;
    const subSel = m.substatus ? this._substatusSelect(ao) : '';

    return `
      <div class="ao-acts-desktop aod-acts">
        ${primaryBtn}
        ${subSel}
        ${visD.map(secBtn).join('')}
        ${menuD.length ? this._moreActionsMenuHtml(menuD, 'ao-more-desktop', true) : ''}
      </div>
      <div class="ao-acts-mobile aod-acts">
        ${primaryBtn}
        ${subSel}
        ${visM.map(secBtn).join('')}
        ${menuM.length ? this._moreActionsMenuHtml(menuM, 'ao-more-mobile', true) : ''}
      </div>`;
  },

  _substatusSelect(ao) {
    const subOpts = [
      {v:'',label:'Inget substatus'},
      {v:'inväntar_material',label:'Inväntar material'},
      {v:'inväntar_kund',label:'Inväntar kund'},
      {v:'pausad',label:'Pausad'},
      {v:'behöver_återbesök',label:'Behöver återbesök'},
      {v:'blockerad',label:'Blockerad'},
    ];
    return `<select class="aod-subsel" data-act="substatus" aria-label="Substatus" title="Substatus" onchange="WorkOrderDetailPage.setSubstatus(this.value);this.blur();">
        ${subOpts.map(o=>`<option value="${o.v}"${ao.substatus===o.v?' selected':''}>${esc(o.label)}</option>`).join('')}
      </select>`;
  },

  /* Grupperad, ankrad meny (samma delade overflow-komponent som Kunder/
     Fakturor/Fastigheter/AO-listan: aoToggleOverflow/aoCloseOverflow).
     V52A-buggen (ett objekt med avdelare renderades inte) kan inte uppstå:
     varje åtgärd renderas, gruppvis i fast ordning. */
  _moreActionsMenuHtml(items, idBase, showLabel) {
    const menuId = idBase + '-menu';
    const btnId  = idBase + '-btn';
    let rows = '';
    let first = true;
    this._ACT_GROUPS.forEach(g => {
      const its = items.filter(it => (it.group || 'order') === g.key);
      if (!its.length) return;
      if (!first) rows += '<div class="ao-overflow-divider" role="separator"></div>';
      first = false;
      rows += `<div class="aod-menu-h" role="presentation">${esc(g.label)}</div>`;
      its.forEach(it => {
        const cls = it.destructive ? 'ao-overflow-menu-item ao-overflow-menu-item--red' : 'ao-overflow-menu-item';
        rows += `<button class="${cls}" role="menuitem" data-act="${it.key}" onclick="aoCloseOverflow();${it.fn}">${ic(it.icon,15)}<span>${esc(it.label)}</span></button>`;
      });
    });
    return `
      <div class="ao-overflow-wrap aod-more">
        <button class="ibtn aod-more-btn" id="${btnId}" aria-label="Fler åtgärder" title="Fler åtgärder" aria-haspopup="menu" aria-expanded="false" aria-controls="${menuId}" onclick="WorkOrderDetailPage._toggleActionsMenu('${menuId}',this)">${ic('more-vertical',18)}</button>
        <div class="ao-overflow-menu aod-menu" id="${menuId}" role="menu" aria-labelledby="${btnId}">${rows}</div>
      </div>`;
  },

  /* Menyn ritas med position:fixed utifrån knappens läge (kortens
     overflow ska aldrig klippa den). Höjden begränsas till fönstret och
     menyn öppnas uppåt om det finns mer plats där — inget hamnar utanför
     skärmen på 360–1920 px. Rullning eller storleksändring stänger den. */
  _toggleActionsMenu(menuId, btn) {
    const menu = document.getElementById(menuId);
    if (!menu || !btn) return;
    const wasOpen = menu.classList.contains('open');
    aoToggleOverflow(menuId, btn);
    if (!wasOpen && menu.classList.contains('open')) {
      const r = btn.getBoundingClientRect();
      const vh = window.innerHeight, vw = window.innerWidth;
      const below = vh - r.bottom - 12, above = r.top - 12;
      menu.style.position = 'fixed';
      menu.style.left  = 'auto';
      menu.style.right = Math.max(8, vw - r.right) + 'px';
      menu.style.maxWidth = (vw - 16) + 'px';
      menu.style.overflowY = 'auto';
      /* Högerjusterad mot knappen; ligger knappen långt till vänster (radbruten
         åtgärdsrad) vänsterjusteras menyn i stället, så att den aldrig hamnar
         utanför fönstrets vänsterkant. */
      const w = menu.offsetWidth;
      if (r.right - w < 8) {
        menu.style.right = 'auto';
        menu.style.left = Math.max(8, Math.min(r.left, vw - w - 8)) + 'px';
      }
      const natural = menu.scrollHeight;
      if (natural > below && above > below) {
        menu.style.top = 'auto';
        menu.style.bottom = (vh - r.top + 4) + 'px';
        menu.style.maxHeight = Math.max(160, above) + 'px';
      } else {
        menu.style.bottom = 'auto';
        menu.style.top = (r.bottom + 4) + 'px';
        menu.style.maxHeight = Math.max(160, below) + 'px';
      }
      const close = () => { if (menu.classList.contains('open')) aoCloseOverflow(); };
      const sc = document.getElementById('content-scroll');
      if (sc) sc.addEventListener('scroll', close, { once: true, passive: true });
      window.addEventListener('resize', close, { once: true });
      const firstItem = menu.querySelector('[role="menuitem"]');
      if (firstItem && firstItem.focus) { try { firstItem.focus({ preventScroll: true }); } catch (e) {} }
    }
  },

  openReschedule() {
    const ao = getAO(this.aoId);
    if (!ao) return;
    Modal.open({
      title: 'Omplanera',
      body: `
        <div class="fg">
          <label>Nytt datum</label>
          <div class="date-input-wrap">
            ${ic('calendar',14)}
            <input type="date" id="rs-date" value="${ao.scheduledDate||tdy()}" style="flex:1;">
            <button type="button" class="date-input-clear" title="Rensa datum"
              onclick="document.getElementById('rs-date').value=''">${ic('x',11)}</button>
          </div>
        </div>
        <div class="g2" style="margin-top:8px;">
          <div class="fg"><label>Starttid</label>
            <div class="date-input-wrap">${ic('clock',13)}<input type="time" id="rs-start" value="${ao.scheduledStart||'08:00'}" style="flex:1;"></div>
          </div>
          <div class="fg"><label>Sluttid</label>
            <div class="date-input-wrap">${ic('clock',13)}<input type="time" id="rs-end" value="${ao.scheduledEnd||'16:00'}" style="flex:1;"></div>
          </div>
        </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          const d = document.getElementById('rs-date')?.value;
          if (!d) { showToast('Välj datum'); return; }
          WorkOrderService.update(this.aoId, {
            scheduledDate:  d,
            scheduledStart: document.getElementById('rs-start')?.value || '',
            scheduledEnd:   document.getElementById('rs-end')?.value || ''
          });
          Modal.close();
          this.render({ aoId: this.aoId });
          showToast('Omplanerad');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  openContact() {
    const ao = getAO(this.aoId);
    if (!ao) return;
    const cu = getCu(ao.customerId);
    const prop = ao.propertyId ? getObj(ao.propertyId) : null;

    // Build prioritized contact list
    const contacts = [];

    // 1. AO contact person
    if (ao.contactPerson || ao.phone || ao.email) {
      contacts.push({
        label: 'AO-kontakt',
        name: ao.contactPerson || '',
        phone: ao.phone || '',
        email: ao.email || '',
        primary: true
      });
    }

    // 2. Customer
    if (cu) {
      contacts.push({
        label: 'Kund',
        name: CustomerService.displayName(cu),
        phone: cu.phone || '',
        email: cu.email || '',
        primary: false
      });
    }

    // 3. Property contacts
    if (prop && prop.contacts && prop.contacts.length) {
      prop.contacts.forEach(c => {
        contacts.push({
          label: c.role || 'Fastighetskontakt',
          name: c.name || '',
          phone: c.phone || '',
          email: c.email || '',
          primary: false
        });
      });
    }

    // 4. Assigned staff
    (ao.staff || []).forEach(staffId => {
      const s = getStaff(staffId);
      if (s && s.phone) {
        contacts.push({
          label: 'Personal',
          name: `${s.firstName} ${s.lastName}`,
          phone: s.phone || '',
          email: s.email || '',
          primary: false
        });
      }
    });

    if (!contacts.length) {
      showToast('Inga kontaktuppgifter registrerade');
      return;
    }

    const rows = contacts.map(c => `
      <div style="padding:12px 0;border-bottom:1px solid var(--bg);">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
          <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--mt);">${esc(c.label)}</span>
          ${c.primary ? `<span class="bdg bdg-sky" style="font-size:9px;">Primär</span>` : ''}
        </div>
        ${c.name ? `<div style="font-size:14px;font-weight:700;color:var(--navy);margin-bottom:6px;">${esc(c.name)}</div>` : ''}
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          ${c.phone
            ? `<a href="tel:${esc(c.phone)}" class="btn bp bsm" style="gap:6px;font-size:13px;font-weight:700;padding:10px 16px;">${ic('phone',14)} ${esc(c.phone)}</a>`
            : `<span class="btn bs bsm" style="opacity:.45;cursor:default;gap:5px;font-size:12px;">${ic('phone',13)} Inget tel.</span>`}
          ${c.email
            ? `<a href="mailto:${esc(c.email)}" class="btn bs bsm" style="gap:6px;font-size:12px;">${ic('mail',13)} ${esc(c.email)}</a>`
            : ''}
        </div>
      </div>`).join('');

    Modal.open({
      title: `${ic('phone',14)} Kontakt`,
      body: `<div style="margin:0 -2px;">${rows}</div>`,
      buttons: [{ label: 'Stäng', cls: 'btn bs', onClick: () => Modal.close() }]
    });
  },

  /* Arbetsunderlag från offerten (rader med pris) — visas i Prissättning
     för roller som ser pris, som tidigare i Fakturering-kortet. V3: ett
     block i kortet i stället för ett kort i kortet. */
  _offerUnderlag(ao) {
    const off = (state.offers||[]).find(o => o.id === ao.offerId);
    if (!off) return '';
    const prLines = (off.lines||[]).filter(l => l.type !== 'text');
    if (!prLines.length) return '';
    const rows = prLines.map(l => {
      const name  = l.templateName || l.description || '—';
      const price = l.exVat || l.total || Math.round((l.qty||1)*(l.unitPrice||0));
      const qty   = (l.type !== 'service' && l.qty) ? `${esc(l.qty)} ${esc(l.unit||'st')} · ` : '';
      return `<div class="aod-offl">
        <span class="aod-offl-n">${l.type==='service'?ic('zap',11):ic('minus',11)} ${esc(name)}</span>
        <span class="aod-offl-v">${qty}${fmt(price)} kr exkl. moms</span>
      </div>`;
    }).join('');
    return `
      <div class="aod-offer">
        <div class="aod-psec-h">${ic('file-text',13)} Arbetsunderlag (offert ${esc(ao.offerId)})</div>
        ${off.scope ? `<p class="aod-offer-scope">${esc(off.scope)}</p>` : ''}
        ${rows}
        ${off.includes||off.excludes ? `<div class="aod-offer-inc">
          ${off.includes?`<div>${ic('check-circle',11)} Ingår: ${esc(off.includes)}</div>`:''}
          ${off.excludes?`<div>${ic('x-circle',11)} Ingår ej: ${esc(off.excludes)}</div>`:''}
        </div>` : ''}
      </div>`;
  },

  /* ── Prissättning (V3 2026-11-26) ─────────────────────────────────────
     Eget kort högt upp (överst i sidokolumnen på dator) i stället för en
     rad långt ner i Detaljer. Visar prismodell (fastpris/löpande timpris),
     prisgrupp och dess timpris, avtalat pris, varifrån priset kommer, länk
     till offert, material/påslag och fakturering.
     SÄKERHET: anropas bara när canSeePrice (invoice_view, invoice_create
     eller reports_view) — exakt samma spärr som prisraden i Detaljer,
     materialpriserna och Fakturering-kortet hade. Fältarbetare och
     begränsade roller ser inget av detta. Ändra = _canEditPricing() som förut.
     Inga priser ändras här — timpriset läses ur prisregistret
     (state.priceGroups, samma uppslag som _priceLabel()). */
  _pricingCard(ao) {
    if (!Auth.canAny(['invoice_view','invoice_create','reports_view'])) return '';
    const aoId = this._id(ao.id);
    const pt = ao.priceType === 'prisgrupp' ? 'timpris' : ao.priceType === 'fast' ? 'fastpris' : (ao.priceType || 'ej_satt');
    const pg = ao.priceGroupId ? (state.priceGroups || []).find(p => p.id === ao.priceGroupId) : null;
    const canEditP = this._canEditPricing();
    /* Faktarader enligt sidans mönster (aod-fact, V3-komponentstandarden §6). */
    const row = (label, value) => `<div class="aod-fact aod-pr"><span class="aod-fact-l">${label}</span><span class="aod-fact-v">${value}</span></div>`;
    const canOffer = Auth.canViewPage('pg-offer-detail');
    const offerRef = ao.offerId
      ? (canOffer ? `<a class="aod-link" onclick="Router.showPage('pg-offer-detail',{offerId:'${this._id(ao.offerId)}'})">Offert ${esc(ao.offerId)}</a>` : `Offert ${esc(ao.offerId)}`)
      : '';
    const contractRef = ao.contractId
      ? (Auth.canViewPage('pg-contracts') ? `<a class="aod-link" onclick="Router.showPage('pg-contracts',{contractId:'${this._id(ao.contractId)}'})">Avtal ${esc(ao.contractId)}</a>` : `Avtal ${esc(ao.contractId)}`)
      : '';

    let model = '', body = '';
    if (pt === 'fastpris') {
      model = `<span class="bdg bdg-purple aod-pmodel">${ic('tag',11)} Fastpris</span>`;
      body += row('Avtalat pris', `<b class="aod-pr-big">${fmt(ao.fixedPrice)} kr</b> <span class="aod-muted">exkl. moms</span>`);
      body += row('Priset kommer från', ao.offerId ? `${offerRef} <span class="aod-muted">(offertens summa exkl. moms efter rabatt)</span>` : 'Satt på arbetsordern');
    } else if (pt === 'timpris') {
      model = `<span class="bdg bdg-blue aod-pmodel">${ic('clock',11)} Löpande timpris</span>`;
      if (pg) {
        body += row('Prisgrupp', esc(pg.name));
        body += row('Timpris', `<b class="aod-pr-big">${fmt(pg.hourRate)} kr/tim</b> <span class="aod-muted">exkl. moms</span>`);
        body += row('Priset kommer från', `Prisgruppen i prisregistret, vald på arbetsordern. Tidposter faktureras med sitt sparade timpris.`);
        if (typeof TimeService !== 'undefined' && TimeService.isValidBillingPriceGroup && !TimeService.isValidBillingPriceGroup(pg)) {
          body += `<div class="aod-pwarn">${ic('alert-circle',13)}<span>Prisgruppen saknar ett giltigt timpris (&gt; 0 kr) och kan inte användas för kundfakturering.</span></div>`;
        }
      } else {
        body += row('Prisgrupp', ao.priceGroupId ? `<span class="aod-warn">Finns inte längre (${esc(ao.priceGroupId)})</span>` : '<span class="aod-warn">Ingen prisgrupp vald</span>');
        body += row('Priset kommer från', 'Registrerad tid × timpriset som sparas på varje tidpost');
      }
      if (ao.offerId) body += row('Offert', offerRef);
    } else {
      model = `<span class="bdg bdg-orange aod-pmodel">${ic('alert-circle',11)} Ej satt</span>`;
      body += `<div class="aod-pwarn">${ic('alert-circle',13)}<span>Ingen prismodell är satt. Fakturaunderlag kan inte skapas förrän prissättningen är satt.${canEditP && !ao.invoiceId ? ` <a class="aod-link" onclick="WorkOrderDetailPage.openPricingModal()">Sätt prissättning</a>` : ''}</span></div>`;
      if (ao.offerId) body += row('Offert', offerRef);
    }
    if (contractRef) body += row('Avtal', contractRef);

    /* Material och påslag — samma summor som materialkortet (_matTotals). */
    const mats = ao.materials || [];
    let matHtml = '';
    if (mats.length) {
      let sellEx = 0, buyEx = 0;
      mats.forEach(m => { sellEx += (m.qty||0) * (m.sellPrice||0); buyEx += (m.qty||0) * (m.buyPrice||0); });
      const markup = sellEx - buyEx;
      matHtml = `<div class="aod-psec">
          <div class="aod-psec-h">${ic('package',13)} Material</div>
          ${row(`${mats.length} rad${mats.length === 1 ? '' : 'er'}, försäljning`, `${fmt(sellEx)} kr <span class="aod-muted">exkl. moms</span>`)}
          ${buyEx > 0 ? row('Inköp <span class="aod-int-tag">internt</span>', `${fmt(buyEx)} kr <span class="aod-muted">exkl. moms</span>`) + row('Påslag <span class="aod-int-tag">internt</span>', `${fmt(markup)} kr <span class="aod-muted">exkl. moms${sellEx > 0 ? ` (${Math.round(markup / sellEx * 100)} % av försäljning)` : ''}</span>`) : ''}
        </div>`;
    }

    /* Registrerad tid och tidposter som saknar prissättning (samma källa
       som "Ändra prissättning": _brokenTimeEntries → BillingQueueService). */
    const entries = TimeService.getByAO(ao.id);
    let timeHtml = '';
    if (entries.length) {
      const total = TimeService.totalMinutes(entries);
      const billMins = TimeService.totalMinutes(entries.filter(t => t.billable !== false));
      const broken = pt === 'timpris' ? this._brokenTimeEntries(ao.id).length : 0;
      /* Timpriset sparas på varje tidpost när den registreras (prisgrupp +
         timpris som ögonblicksbild). Visa vilka priser tidposterna faktiskt
         bär, så att en skillnad mot arbetsorderns prisgrupp syns. */
      const snap = {};
      entries.forEach(t => { if (t.priceGroupName || t.hourRate) { const k = (t.priceGroupName || '') + '|' + (t.hourRate || 0); (snap[k] = snap[k] || { name: t.priceGroupName || 'Utan prisgrupp', rate: t.hourRate || 0, n: 0 }).n++; } });
      const snaps = Object.values(snap);
      const differs = pt === 'timpris' && pg && snaps.some(x => Number(x.rate) !== Number(pg.hourRate));
      timeHtml = `<div class="aod-psec">
          <div class="aod-psec-h">${ic('clock',13)} Arbetstid</div>
          ${row('Registrerad tid', `${WorkOrderDetailPage._h(total)}${billMins !== total ? ` <span class="aod-muted">(${WorkOrderDetailPage._h(billMins)} debiterbar)</span>` : ''}`)}
          ${snaps.length ? row('Tidposternas pris', snaps.map(x => `${esc(x.name)} – ${fmt(x.rate)} kr/tim <span class="aod-muted">exkl. moms (${x.n} st)</span>`).join('<br>')) : ''}
          ${differs ? `<div class="aod-pnote">${ic('info',13)} Minst en tidpost har ett annat timpris än arbetsorderns prisgrupp. Faktureringen använder tidpostens sparade timpris.</div>` : ''}
          ${broken ? `<div class="aod-pwarn">${ic('alert-circle',13)}<span>${broken} tidpost${broken === 1 ? '' : 'er'} saknar prissättning.${canEditP && !ao.invoiceId ? ` <a class="aod-link" onclick="WorkOrderDetailPage.openPricingModal()">Åtgärda</a>` : ''}</span></div>` : ''}
        </div>`;
    }

    /* Fakturering (tidigare eget kort) — samma villkor. */
    let billHtml = '';
    if (ao.invoiceId || ao.offerId || (ao.status === 'klar' && Auth.can('invoice_create'))) {
      billHtml = `<div class="aod-psec">
          <div class="aod-psec-h">${ic('receipt',13)} Fakturering</div>
          ${ao.status==='klar'&&!ao.invoiceId&&Auth.can('invoice_create') ? `<button class="btn bs bfull aod-bill-btn" onclick="WorkOrderDetailPage.createInvoice()">${ic('file-plus',15)} Skapa fakturaunderlag</button>` : ''}
          ${ao.invoiceId ? `<a class="aod-linkrow" onclick="Router.showPage('pg-inv-detail',{invoiceId:'${this._id(ao.invoiceId)}'})">${ic('receipt',14)}<span>Fakturaunderlag ${esc(ao.invoiceId)}</span>${ic('chevron-right',14)}</a>` : ''}
          ${ao.offerId ? this._offerUnderlag(ao) : ''}
          ${ao.offerId ? `<a class="aod-linkrow" onclick="Router.showPage('pg-offer-detail',{offerId:'${this._id(ao.offerId)}'})">${ic('file-text',14)}<span>Skapad från offert ${esc(ao.offerId)}</span>${ic('chevron-right',14)}</a>` : ''}
        </div>`;
    }

    return `
      <section class="card aod-box aod-price" id="ao-price" aria-labelledby="aod-price-h" data-price-type="${esc(pt)}">
        <div class="card-header">
          <h3 id="aod-price-h">${ic('tag',15)} Prissättning</h3>
          ${canEditP ? `<button class="btn bxs bghost" data-act="pricing-card" onclick="WorkOrderDetailPage.openPricingModal()">${ic('pencil',12)} Ändra</button>` : ''}
        </div>
        <div class="card-body">
          <div class="aod-pmodel-row">${model}</div>
          ${body}
          ${matHtml}
          ${timeHtml}
          ${billHtml}
        </div>
      </section>`;
  },

  _tbBlock(ao) {
    const hasMat   = (ao.materials || []).length > 0;
    const hasTime  = TimeService.getByAO(ao.id).length > 0;
    const hasPrice = ao.invoiceId || ao.fixedPrice > 0 ||
                     ['timpris','prisgrupp','fast','fastpris'].includes(ao.priceType);
    if (!hasMat && !hasTime && !hasPrice) return '';

    const tb   = ProfitabilityService.calcTB(ao);
    const vs   = ProfitabilityService.calcVsOffer(ao);
    const fmtM = m => WorkOrderDetailPage._h(m);
    const borderColor = tb.tbPct !== null ? tb.color : 'var(--br)';

    const vsHtml = vs ? `
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--bg);">
        <div style="font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;display:flex;align-items:center;gap:4px;">${ic('git-compare',10)} Offert vs faktiskt utfall</div>
        <div class="dr"><span class="dk">Offererat exkl. moms</span><span class="dv">${fkr(vs.offerExVat)}</span></div>
        <div class="dr"><span class="dk">${esc(tb.revenue.label)}</span>
          <span class="dv" style="color:${vs.revDiff >= 0 ? 'var(--gr)' : 'var(--rd)'};">
            ${fkr(vs.actualRev)}
            ${vs.revDiff !== 0 ? `<span style="font-size:10px;font-weight:600;margin-left:4px;">(${vs.revDiff >= 0 ? '+' : ''}${fmt(Math.round(vs.revDiff))} kr)</span>` : ''}
          </span>
        </div>
        ${vs.estMins > 0 ? `
          <div class="dr"><span class="dk">Planerad tid</span><span class="dv">${fmtM(vs.estMins)}</span></div>
          <div class="dr"><span class="dk">Faktisk tid</span>
            <span class="dv" style="color:${vs.timeDiff > vs.estMins * 0.15 ? 'var(--rd)' : vs.timeDiff > 0 ? 'var(--yl)' : 'var(--gr)'};">
              ${fmtM(vs.actualMins)}
              ${vs.timeDiff !== 0 && vs.actualMins > 0 ? `<span style="font-size:10px;margin-left:4px;">(${vs.timeDiff > 0 ? '+' : '−'}${fmtM(Math.abs(vs.timeDiff))})</span>` : ''}
            </span>
          </div>` : ''}
      </div>` : '';

    return `
      <div class="card" style="border-left:3px solid ${borderColor};">
        <div class="card-header">
          <h3>${ic('trending-up',14)} Lönsamhet <span style="font-size:10px;font-weight:600;color:var(--mt);margin-left:4px;display:inline-flex;align-items:center;gap:3px;">${ic('eye-off',9)} Intern</span></h3>
          ${tb.tbPct !== null ? `<span class="bdg ${tb.badge}">${Math.round(tb.tbPct)} % TB</span>` : ''}
        </div>
        <div class="card-body" style="padding:10px 14px;">
          ${tb.incomplete ? `<div class="aod-warn" style="margin-bottom:6px;">Ofullständig — ${esc(tb.saknas.join(', '))} saknas</div>` : ''}
          <div class="dr">
            <span class="dk">Intäkt exkl. moms</span>
            <span class="dv">${fkr(tb.revenue.value)} <span style="font-size:10px;color:var(--mt);">${esc(tb.revenue.label)}</span></span>
          </div>

          ${hasMat ? `
          <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--bg);">
            <div style="font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;display:flex;align-items:center;gap:4px;">${ic('package',10)} Material</div>
            <div class="dr"><span class="dk">Försäljning exkl. moms</span><span class="dv">${fkr(tb.material.sellEx)}</span></div>
            <div class="dr"><span class="dk">Inköp exkl. moms</span><span class="dv" style="color:var(--rd);">${fkr(tb.material.buyEx)}</span></div>
            <div class="dr"><span class="dk">Materialmarginal</span>
              <span class="dv" style="color:var(--gr);">${fkr(tb.material.margin)}
                ${tb.material.sellEx > 0 ? `<span style="font-size:10px;font-weight:600;margin-left:4px;">(${Math.round(tb.material.marginPct)} %)</span>` : ''}
              </span>
            </div>
          </div>` : ''}

          <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--bg);">
            <div style="font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;display:flex;align-items:center;gap:4px;">${ic('clock',10)} Arbetstid</div>
            <div class="dr"><span class="dk">Registrerad tid</span><span class="dv">${tb.labor.minutes > 0 ? fmtM(tb.labor.minutes) : '<span style="color:var(--mt);">Ingen tid registrerad</span>'}</span></div>
            <div class="dr"><span class="dk">Intern timkostnad</span><span class="dv" style="color:var(--mt);">${tb.labor.rate === null ? 'Saknas' : fmt(tb.labor.rate) + ' kr/h'}</span></div>
            ${tb.labor.cost > 0 ? `<div class="dr"><span class="dk">Intern arbetskostnad</span><span class="dv" style="color:var(--rd);">${fkr(tb.labor.cost)}</span></div>` : ''}
          </div>

          <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--br);">
            <div class="dr"><span class="dk">Total kostnad exkl. moms</span><span class="dv" style="color:var(--rd);font-weight:700;">${fkr(tb.totalCost)}</span></div>
            <div class="dr" style="font-size:15px;font-weight:800;border-top:2px solid var(--br);padding-top:8px;margin-top:4px;">
              <span class="dk" style="color:${tb.color};">Täckningsbidrag exkl. moms</span>
              <span class="dv" style="color:${tb.color};">${fkr(tb.tb)}</span>
            </div>
            ${tb.tbPct !== null ? `<div class="dr">
              <span class="dk">TB %</span>
              <span class="dv" style="display:flex;align-items:center;gap:6px;justify-content:flex-end;">
                <strong style="font-size:15px;color:${tb.color};">${Math.round(tb.tbPct)} %</strong>
                <span class="bdg ${tb.badge}">${esc(tb.label)}</span>
              </span>
            </div>` : ''}
          </div>

          ${vsHtml}
        </div>
      </div>`;
  },

  /* Tid mot plan — V3: ett kompakt block i Arbetstid-kortet (tidigare ett
     eget kort). Samma beräkning och samma rollspärr (canSeePrice) som förut. */
  _timePlanBlock(ao) {
    const entries    = TimeService.getByAO(ao.id);
    const actualMins = TimeService.totalMinutes(entries);
    const estMins    = Math.round((ao.estimatedHours || 0) * 60);
    if (estMins === 0 && actualMins === 0) return '';
    const fmt = m => WorkOrderDetailPage._h(m);
    const canEdit = Auth.can('ao_edit');
    const aoId = this._id(ao.id);

    if (estMins > 0) {
      const pct   = Math.round((actualMins / estMins) * 100);
      const diff  = actualMins - estMins;
      const color = pct <= 100 ? 'var(--gr)' : pct <= 115 ? 'var(--warn)' : 'var(--rd)';
      const cls   = pct <= 100 ? 'bdg-green' : pct <= 115 ? 'bdg-orange' : 'bdg-red';
      const lbl   = pct <= 100 ? 'Under/inom plan' : pct <= 115 ? 'Nära gräns' : 'Över plan';
      const diffStr = diff === 0 ? '±0' : diff > 0 ? `+${fmt(diff)}` : `−${fmt(-diff)}`;
      const barW  = Math.min(pct, 100);

      return `
        <div class="aod-planbox">
          <div class="aod-planbox-h">
            <span class="aod-planbox-t">${ic('bar-chart-2',13)} Tid mot plan</span>
            <span class="bdg ${cls}">${lbl}</span>
            ${canEdit ? `<button class="btn bghost bxs" onclick="WorkOrderDetailPage.editEstimatedTime('${aoId}')">${ic('pencil',12)} Ändra</button>` : ''}
          </div>
          <div class="aod-planbox-kv">
            <span>Planerat <b>${fmt(estMins)}</b></span>
            <span>Utfört <b>${actualMins > 0 ? fmt(actualMins) : '—'}</b></span>
            <span>Differens <b style="color:${color};">${diffStr}</b></span>
            <span>Andel <b>${pct} %</b></span>
          </div>
          <div class="aod-planbox-bar" aria-hidden="true"><i style="width:${barW}%;background:${color};"></i></div>
          ${pct > 100 && ao.status === 'klar' ? `<div class="aod-planbox-warn">${ic('alert-triangle',11)} Faktisk tid överstiger plan med ${fmt(diff)}</div>` : ''}
        </div>`;
    }

    return `
      <div class="aod-planbox">
        <div class="aod-planbox-h">
          <span class="aod-planbox-t">${ic('bar-chart-2',13)} Tid mot plan</span>
          <span class="aod-muted">Ingen uppskattad tid satt${actualMins > 0 ? ` · utfört ${fmt(actualMins)}` : ''}</span>
          ${canEdit ? `<button class="btn bs bxs" onclick="WorkOrderDetailPage.editEstimatedTime('${aoId}')">${ic('plus',12)} Sätt tid</button>` : ''}
        </div>
      </div>`;
  },

  editEstimatedTime(aoId) {
    if (!Auth.require('ao_edit')) return;
    const ao = getAO(aoId);
    if (!ao) return;
    const estMins = Math.round((ao.estimatedHours || 0) * 60);
    const curH = Math.floor(estMins / 60);
    const curM = estMins % 60;
    Modal.open({
      title: `${ic('clock',15)} Uppskattad tid — ${esc(aoId)}`,
      body: `
        <div class="g2" style="margin-bottom:12px;">
          <div class="fg"><label>Timmar</label><input type="number" id="et-hours" min="0" max="999" value="${curH}" style="text-align:center;font-size:18px;font-weight:700;"></div>
          <div class="fg"><label>Minuter</label><input type="number" id="et-mins" min="0" max="59" value="${curM}" style="text-align:center;font-size:18px;font-weight:700;"></div>
        </div>
        <div class="fg"><label>Kommentar (valfritt)</label><input type="text" id="et-comment" placeholder="T.ex. Ändrad efter besiktning"></div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          const h = parseInt(document.getElementById('et-hours')?.value || '0', 10) || 0;
          const m = parseInt(document.getElementById('et-mins')?.value  || '0', 10) || 0;
          const comment = (document.getElementById('et-comment')?.value || '').trim();
          const newHours = h + m / 60;
          const by = state.currentUser ? `${state.currentUser.firstName} ${state.currentUser.lastName}`.trim() : 'Okänd';
          ao.estimatedHours = newHours;
          ao.updatedAt = new Date().toISOString();
          ao.log = ao.log || [];
          ao.log.push({
            id: newEntryId('L'), type: 'estimated_time_changed',
            text: `${by} satte uppskattad tid: ${TimeService.fmtDuration(h * 60 + m)}${comment ? ' — ' + comment : ''}`,
            userName: by, timestamp: new Date().toISOString()
          });
          /* P0 AO/TID-FIX: detta ställe muterar ao direkt (kringgår
             WorkOrderService) — syncar via samma delade _syncAO()-helper
             så att skrivningen blir atomisk/race-säker precis som alla
             andra AO-mutationer, istället för att lämnas på den gamla
             generiska vägen. */
          if (typeof WorkOrderService !== 'undefined' && typeof WorkOrderService._syncAO === 'function') {
            /* G12: besked först när servern bekräftat. */
            WorkOrderService._syncAO(ao, { estimatedHours: ao.estimatedHours, log: ao.log, updatedAt: ao.updatedAt }, { onSettled: (r) => {
              if (r.ok) showToast('Uppskattad tid uppdaterad');
              else if (r.final) showToast('Uppskattad tid kunde inte sparas (' + (r.error || 'okänt fel') + ').', 6000);
            }});
          }
          persist();
          Modal.close();
          WorkOrderDetailPage.render({ aoId });
          showToast('Sparar…');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _priceLabel(ao) {
    if (ao.priceType === 'fastpris' || ao.priceType === 'fast') return `Fastpris: ${fmt(ao.fixedPrice)} kr exkl. moms`;
    if (ao.priceType === 'timpris' || ao.priceType === 'prisgrupp') {
      if (ao.priceGroupId) {
        const pg = (state.priceGroups||[]).find(p => p.id === ao.priceGroupId);
        return pg ? `Löpande timpris – ${pg.name} (${fmt(pg.hourRate)} kr/tim exkl. moms)` : 'Löpande timpris';
      }
      return 'Löpande timpris';
    }
    return 'Ej satt';
  },

  /* ═══════════════════════════════════════════════════════════════
     AO-PRICING-RECOVERY — prissättning måste kunna repareras EFTER
     att en AO satts till "Klar", annars blir en AO utan prismodell
     ett fakturerings-dödläge (bekräftat LIVE: AO-041, AO-038 —
     "Saknar prissättning", ingen väg framåt). Återanvänder BEFINTLIGA
     fält (Schema.workOrder(): priceType/fixedPrice/priceGroupId) och
     BEFINTLIG TimeEntry-självläkning (TimeService.update(), AO-050
     R0+R1) — ingen ny prismodell, ingen parallell arkitektur.
     ═══════════════════════════════════════════════════════════════ */

  /* Behörighet: samma modell som redan gäller — ao_edit ELLER
     invoice_create. Motivering: den som upptäcker "Saknar
     prissättning" gör det oftast i Att fakturera-kön (invoice_create),
     inte nödvändigtvis via ao_edit. "Användare som redan har
     behörighet att redigera/fakturera arbetsordrar" (uppdragets egen
     formulering) — ingen ny, egen pris-behörighet uppfinns. */
  _canEditPricing() {
    return Auth.canAny(['ao_edit', 'invoice_create']);
  },

  /* AO-PRICING-RECOVERY R2.1 — Blocker D: kandidatlistan MÅSTE följa
     samma fakturerings-sanning som Blocker 1 (BillingQueueService),
     INTE ett eget rått fältscan över `state.timeEntries`. R2:s
     `!priceGroupId || !priceGroupName || !(hourRate>0)`-scan över ALLA
     tidposter för en AO plockade upp poster som ALDRIG blockerade
     fakturering — t.ex. billable:false-poster (aldrig en fakturerings-
     källa) — vilket kunde visa "N tidposter saknar prissättning" och
     erbjuda en reparation för poster som inte hade något med det
     verkliga problemet att göra.
     Nu: hämta de FAKTISKA obeclaimade fakturerings-källorna för denna
     AO och filtrera på `sourceType==='time' && issues har 'Saknar
     timpris'` — detta utesluter AUTOMATISKT billable:false (blir
     aldrig en källa alls), fastprisAO:ers tid (mode!=='hourly' → tid
     blir aldrig en egen källa där) och REDAN CLAIMADE källor (en
     aktiv fakturas sourceRefs). Detta är BARA för UI-visning/-urval —
     TimeService.repairMissingPricingSnapshot() omvaliderar HELT
     OBEROENDE och på nytt vid själva reparationstillfället (Blocker 3,
     oförändrad). */
  _brokenTimeEntries(aoId) {
    if (typeof BillingQueueService === 'undefined') return [];
    const brokenIds = new Set(
      BillingQueueService.getUnclaimedSourcesForAO(aoId)
        .filter(s => s.sourceType === 'time' && (s.issues || []).includes('Saknar timpris'))
        .map(s => s.sourceId)
    );
    return TimeService.getByAO(aoId).filter(t => brokenIds.has(t.id));
  },

  openPricingModal() {
    if (!this._canEditPricing()) { showToast('Du saknar behörighet att ändra prissättning.'); return; }
    const ao = getAO(this.aoId);
    if (!ao) return;
    /* Redan fakturerad → samma låsning som resten av appen redan
       uttrycker via `!ao.invoiceId` (se _actionBtns/_secondaryActions/
       "Redo fakturering"-villkoren ovan) — ingen ny låsmekanism. */
    if (ao.invoiceId) {
      showToast(`Denna arbetsorder har redan ett fakturaunderlag (${ao.invoiceId}) och kan inte omprissättas härifrån.`);
      return;
    }
    const priceType = ao.priceType && ao.priceType !== 'ej_satt'
      ? (ao.priceType === 'prisgrupp' ? 'timpris' : (ao.priceType === 'fast' ? 'fastpris' : ao.priceType))
      : 'ej_satt';
    /* AO-PRICING-RECOVERY R2.1 — Blocker C: dropdown visar bara
       prisgrupper som `TimeService.isValidBillingPriceGroup()` godkänner
       — INTE bara `p.active`. En 0-kr-grupp kan fortsätta existera för
       andra (legacy/interna) syften, men ska aldrig ens vara VALBAR i
       denna kundfaktureringsåterhämtnings-vy. */
    const pgOptions = (state.priceGroups || []).filter(p => TimeService.isValidBillingPriceGroup(p)).map(p =>
      `<option value="${p.id}" ${p.id === ao.priceGroupId ? 'selected' : ''}>${esc(p.name)} – ${fmt(p.hourRate)} kr/tim exkl. moms</option>`
    ).join('');
    const brokenCount = this._brokenTimeEntries(ao.id).length;
    Modal.open({
      title: 'Ändra prissättning',
      body: `
        <div class="fg"><label>Prismodell</label>
          <select id="pr-type" onchange="WorkOrderDetailPage._pricingTypeChanged()">
            <option value="ej_satt" ${priceType==='ej_satt'?'selected':''}>— Ej satt —</option>
            <option value="fastpris" ${priceType==='fastpris'?'selected':''}>Fastpris</option>
            <option value="timpris" ${priceType==='timpris'?'selected':''}>Löpande timpris</option>
          </select></div>
        <div class="fg" id="pr-fixed-wrap" style="display:${priceType==='fastpris'?'block':'none'};">
          <label>Fastpris (kr, exkl. moms)</label>
          <input type="number" id="pr-fixed" min="0" step="1" value="${ao.fixedPrice || ''}"></div>
        <div class="fg" id="pr-pg-wrap" style="display:${priceType==='timpris'?'block':'none'};">
          <label>Prisgrupp</label>
          <select id="pr-pg"><option value="">— Välj prisgrupp —</option>${pgOptions}</select></div>
        ${brokenCount>0?`<div class="ibox" style="margin-top:10px;display:flex;gap:8px;align-items:flex-start;">${ic('alert-circle',14)}<span>${brokenCount} tidpost${brokenCount===1?'':'er'} på denna arbetsorder saknar prissättning. Efter att du sparat får du möjlighet att åtgärda ${brokenCount===1?'den':'dem'}.</span></div>`:''}
      `,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => WorkOrderDetailPage._savePricing() },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _pricingTypeChanged() {
    const t = document.getElementById('pr-type')?.value;
    const fixedWrap = document.getElementById('pr-fixed-wrap');
    const pgWrap = document.getElementById('pr-pg-wrap');
    if (fixedWrap) fixedWrap.style.display = t === 'fastpris' ? 'block' : 'none';
    if (pgWrap) pgWrap.style.display = t === 'timpris' ? 'block' : 'none';
  },

  _savePricing() {
    const ao = getAO(this.aoId);
    if (!ao) return;
    if (!this._canEditPricing()) { showToast('Du saknar behörighet att ändra prissättning.'); return; }
    if (ao.invoiceId) { showToast('Denna arbetsorder är redan fakturerad.'); Modal.close(); return; }

    const priceType = document.getElementById('pr-type')?.value || 'ej_satt';
    let fixedPrice = ao.fixedPrice || 0;
    let priceGroupId = '';

    if (priceType === 'fastpris') {
      fixedPrice = Number(document.getElementById('pr-fixed')?.value || 0);
      if (!(fixedPrice > 0)) { showToast('Ange ett fastpris större än 0 kr.'); return; }
    } else if (priceType === 'timpris') {
      priceGroupId = document.getElementById('pr-pg')?.value || '';
      if (!priceGroupId) { showToast('Välj en prisgrupp.'); return; }
      /* AO-PRICING-RECOVERY R2.1 — Blocker C: samma delade
         `isValidBillingPriceGroup()`-regel som mutations-spärren i
         TimeService.js. Utan detta kunde en aktiv men 0-kr/onämnd
         prisgrupp sparas som AO:ns timprissättning — "Prissättning
         uppdaterad" visades, men fakturering hade ändå aldrig kunnat
         bli giltig. Detta gäller BARA valet i denna kundfakturerings-
         återhämtningsvy — PriceGroupsPage och andra 0-kr-användningar
         (interna/legacy) rörs inte. */
      const chosenPg = (state.priceGroups || []).find(p => p.id === priceGroupId);
      if (!TimeService.isValidBillingPriceGroup(chosenPg)) {
        showToast('Vald prisgrupp saknar ett giltigt timpris (> 0 kr) och kan inte användas för kundfakturering.');
        return;
      }
      fixedPrice = 0;
    } else {
      fixedPrice = 0;
    }

    /* Ekonomiskt relevant ändring → samma logg-/revisionsmekanism som
       redan används för uppskattad tid (_saveEstimatedTime) och
       uppföljning (_saveFollowUp): ao.log[] + WorkOrderService.update().
       Ingen ny revisionsdatabas. */
    const before = { priceType: ao.priceType, fixedPrice: ao.fixedPrice, priceGroupId: ao.priceGroupId };
    const after  = { priceType, fixedPrice, priceGroupId };
    const beforeLabel = this._priceLabel(before);
    const afterLabel  = this._priceLabel(after);
    const by = state.currentUser ? `${state.currentUser.firstName} ${state.currentUser.lastName}`.trim() : 'Okänd';
    ao.log = ao.log || [];
    ao.log.push({
      id: newEntryId('LOG-'),
      type: 'pricing_corrected',
      text: `${by} ändrade prissättning: "${beforeLabel}" → "${afterLabel}"`,
      userName: by,
      timestamp: new Date().toISOString(),
      visibility: 'intern'
    });
    const aoIdForToast = this.aoId;
    const updated = WorkOrderService.update(this.aoId, { priceType, fixedPrice, priceGroupId, log: ao.log }, {
      onSettled: (r) => {
        if (r.ok) { showToast('Prissättning sparad'); return; }
        showToast('Prissättningen nekades av servern' + (r.error ? ' (' + r.error + ')' : '') + ' — hämtar serverns läge.', 7000);
        if (typeof WorkOrdersReadService !== 'undefined') {
          WorkOrdersReadService.fetchAndApply().then(() => { if (this.aoId === aoIdForToast) this.render({ aoId: aoIdForToast }); });
        }
      }
    });
    if (!updated) { showToast('Kunde inte spara prissättningen.'); return; }
    Modal.close();
    showToast('Sparar prissättning…');

    if (priceType === 'timpris') {
      const broken = this._brokenTimeEntries(this.aoId);
      if (broken.length > 0) {
        this.openPricingRepairModal(priceGroupId, broken);
        return;
      }
    }
    this.render({ aoId: this.aoId });
  },

  /* Steg 2 (valfritt, bara om trasiga tidposter faktiskt finns) —
     "Applicera på poster som saknar prissättning". Den lista med
     entryIds som byggs HÄR (vid modalens öppning) är bara en
     UI-BEKVÄMLIGHET för att visa vad som TROLIGEN kommer repareras —
     den är INTE den slutgiltiga sanningen. _applyPricingRepair()
     skickar varje id till TimeService.repairMissingPricingSnapshot(),
     som omvaliderar ALLT på nytt (AO-koppling, attest-/faktura-lås,
     FORTFARANDE-trasig) vid själva anropstillfället — se den metoden
     för den fullständiga motiveringen (AO-PRICING-RECOVERY R2,
     Blocker 2/3). */
  openPricingRepairModal(defaultPriceGroupId, brokenEntries) {
    const broken = brokenEntries || this._brokenTimeEntries(this.aoId);
    if (broken.length === 0) { this.render({ aoId: this.aoId }); return; }
    /* Blocker C, samma regel som huvudprissättningsmodalen ovan. */
    const pgOptions = (state.priceGroups || []).filter(p => TimeService.isValidBillingPriceGroup(p)).map(p =>
      `<option value="${p.id}" ${p.id === defaultPriceGroupId ? 'selected' : ''}>${esc(p.name)} – ${fmt(p.hourRate)} kr/tim exkl. moms</option>`
    ).join('');
    const rowsHtml = broken.map(t => {
      const dateStr = t.date || (t.startTs ? fmtDate(t.startTs) : '');
      return `<div class="list-item" style="padding:8px 10px;">
        <div style="font-size:12px;font-weight:600;">${esc(t.staffName || 'Okänd')}</div>
        <div style="font-size:11px;color:var(--mt);">${esc(dateStr)} · ${TimeService.fmtDuration(t.minutes||0)}</div>
      </div>`;
    }).join('');
    Modal.open({
      title: `${broken.length} tidpost${broken.length===1?'':'er'} saknar prissättning`,
      body: `
        <p style="font-size:13px;color:var(--mt);margin-bottom:10px;">Dessa tidposter saknar en giltig prisgrupp/timpris och skulle annars blockera fakturering. Redan giltiga tidposter rörs INTE av denna åtgärd.</p>
        <div class="fg"><label>Prisgrupp att applicera</label>
          <select id="pr-repair-pg"><option value="">— Välj prisgrupp —</option>${pgOptions}</select></div>
        <div style="max-height:180px;overflow-y:auto;border:1px solid var(--br);border-radius:8px;margin-top:8px;">${rowsHtml}</div>
      `,
      buttons: [
        { label: 'Applicera på poster som saknar prissättning', cls: 'btn bp', onClick: () => WorkOrderDetailPage._applyPricingRepair(broken.map(t => t.id)) },
        { label: 'Hoppa över', cls: 'btn bs', onClick: () => { Modal.close(); WorkOrderDetailPage.render({ aoId: WorkOrderDetailPage.aoId }); } }
      ]
    });
  },

  /* AO-PRICING-RECOVERY R2 — Blocker 2/3/4:
     §2: anropar TimeService.repairMissingPricingSnapshot() — EGEN,
     snävare behörighetsdörr (ao_edit/invoice_create), INTE
     TimeService.update() (som hade krävt payroll_manage för en annan
     anställds post och skapat exakt det fakturerings-dödläge denna
     omgång ska lösa).
     §3: litar ALDRIG på entryIds-listan som "redan sant" — varje post
     omvalideras HELT INUTI repairMissingPricingSnapshot() vid just
     detta anrop (AO-koppling, attest-lås, fakturerad-lås, FORTFARANDE
     trasig) — en post som blivit giltig (eller alltid var det) sedan
     modalen öppnades avvisas där, rörs aldrig här.
     §4: bygger EN sammanslagen ao.log-post för HELA batchen, men
     ENDAST med de poster som FAKTISKT reparerades (before/after) —
     hoppade-över/redan-giltiga/misslyckade poster nämns aldrig som om
     de ändrats. */
  _applyPricingRepair(entryIds) {
    const priceGroupId = document.getElementById('pr-repair-pg')?.value || '';
    if (!priceGroupId) { showToast('Välj en prisgrupp.'); return; }
    /* Tidig, tydlig UX-kontroll — TimeService.repairMissingPricingSnapshot()
       validerar OBEROENDE och FÄRSKT per post ändå (den faktiska spärren),
       men utan detta skulle ett ogiltigt gruppval visas som "N poster
       kunde inte uppdateras" istället för ett tydligt, entydigt fel. */
    const chosenPg = (state.priceGroups || []).find(p => p.id === priceGroupId);
    if (!TimeService.isValidBillingPriceGroup(chosenPg)) {
      showToast('Vald prisgrupp saknar ett giltigt timpris (> 0 kr) och kan inte användas för kundfakturering.');
      return;
    }
    const ao = getAO(this.aoId);
    if (!ao) { Modal.close(); return; }

    const changes = [];
    let skipped = 0;
    entryIds.forEach(id => {
      const result = TimeService.repairMissingPricingSnapshot(this.aoId, id, priceGroupId);
      if (result && result.ok) {
        changes.push({ entryId: result.entryId, before: result.before, after: result.after });
      } else {
        skipped++;
      }
    });
    Modal.close();

    if (changes.length > 0) {
      const by = state.currentUser ? `${state.currentUser.firstName} ${state.currentUser.lastName}`.trim() : 'Okänd';
      const freshAo = getAO(this.aoId);
      if (freshAo) {
        freshAo.log = freshAo.log || [];
        const summary = changes.map(c =>
          `${c.entryId} (${c.before.priceGroupName || 'Ej satt'}/${fmt(c.before.hourRate||0)} kr → ${c.after.priceGroupName}/${fmt(c.after.hourRate)} kr)`
        ).join(', ');
        freshAo.log.push({
          id: newEntryId('LOG-'),
          type: 'pricing_timeentry_repair',
          text: `${by} reparerade prissättning på ${changes.length} tidpost${changes.length===1?'':'er'}: ${summary}`,
          userName: by,
          timestamp: new Date().toISOString(),
          visibility: 'intern',
          entries: changes
        });
        WorkOrderService.appendLogEntry(this.aoId, freshAo.log[freshAo.log.length - 1]);
      }
    }

    if (skipped > 0) {
      showToast(`${changes.length} tidpost${changes.length===1?'':'er'} uppdaterade. ${skipped} kunde inte uppdateras (redan giltiga, låsta/attesterade, fakturerade eller saknar behörighet).`);
    } else {
      showToast(`${changes.length} tidpost${changes.length===1?'':'er'} uppdaterade.`);
    }
    this.render({ aoId: this.aoId });
  },

  /* ── Din arbetstid (stämpling) — V3 2026-11-26 ───────────────────────
     Tidigare ett stort kort med en stor grön knapp mitt i sidan. Nu en
     kompakt rad i sidhuvudet, tydligt knuten till DENNA arbetsorder, med
     levande tidräknare när man är instämplad. Skild från "Starta arbete"
     (statusändring) både till etikett och plats — ingen av dem utlöser den
     andra. Samma toggleStamp()/TimeService-väg som förut (serverbekräftelse,
     dubbelstämplingsskydd och återhämtning oförändrade).
     Visas: när ordern inte är avslutad/borttagen, och ALLTID när man är
     instämplad på just denna order (så att man kan stämpla ut även om
     ordern hunnit klarmarkeras). */
  _stampSection(ao, isActive) {
    const closed = ['klar','fakturerad','avbruten'].includes(ao.status) || ao.deleted;
    if (closed && !isActive) return '';
    const otherAo = state.stampActive && !isActive ? (state.stampAoId || '') : '';
    const label = `Din arbetstid · ${esc(WorkOrderService.displayNumberOrPending(ao))}`;
    let status, btn, cls = '';
    if (isActive) {
      cls = ' is-active';
      status = `<span class="aod-stamp-dot" aria-hidden="true"></span>Instämplad sedan ${esc(this._clockTime(state.stampTimestamp))} · <b class="aod-stamp-clock" id="ao-stamp-clock">${esc(this._fmtElapsed(state.stampTimestamp))}</b>`;
      btn = `<button class="btn bd ao-stamp-btn" onclick="WorkOrderDetailPage.toggleStamp()">${ic('stop-circle',15)} Stämpla ut</button>`;
    } else if (state.stampActive) {
      cls = ' is-other';
      const other = otherAo ? getAO(otherAo) : null;
      const otherNo = other ? WorkOrderService.displayNumberOrPending(other) : (otherAo || 'ett annat jobb');
      status = `Du är instämplad på ${esc(otherNo)} — stämpla ut där först.`;
      btn = otherAo && other
        ? `<button class="btn bs aod-stamp-go" onclick="Router.showPage('pg-ao-detail',{aoId:'${this._id(otherAo)}'})">${ic('external-link',14)} Öppna ${esc(otherNo)}</button>`
        : '';
    } else {
      status = 'Inte instämplad';
      btn = `<button class="btn bs ao-stamp-btn aod-stamp-in" onclick="WorkOrderDetailPage.toggleStamp()">${ic('play-circle',15)} Stämpla in</button>`;
    }
    return `
      <div class="aod-stamp${cls}" role="group" aria-label="Stämpling på denna arbetsorder">
        <span class="aod-stamp-ico" aria-hidden="true">${ic('clock',16)}</span>
        <div class="aod-stamp-txt">
          <span class="aod-stamp-l">${label}</span>
          <span class="aod-stamp-s" id="ao-stamp-elapsed" aria-live="off">${status}</span>
        </div>
        ${btn}
      </div>`;
  },

  /* "08:12" — instämplingens klockslag (svensk tid). */
  _clockTime(ts) {
    if (!ts) return '';
    try { return new Date(ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Stockholm' }); } catch (e) { return ''; }
  },

  /* Levande tidräknare "0:45:12" (timmar:minuter:sekunder). */
  _fmtElapsed(ts) {
    if (!ts) return '0:00:00';
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  },

  /* Checklista — tre statuslägen (2026-11-23): Ej påbörjad / Pågående /
     Utförd (+ Avvikelse). Varje rad visar vem och när; knapparna följer
     samma behörighetsregel som servern (WorkOrderService.canChecklistAction).
     En rad som väntar på serverns svar visas som "Sparar…" — inget läge
     visas som sparat före ACK. */
  _chkBusy: {},
  _chkWho(name, at) {
    if (!name && !at) return '';
    return esc(name || '') + (at ? ' · ' + esc(this._chkWhen(at)) : '');
  },
  /* Kompakt tid: "idag 13:34", "igår 09:10", "21 nov 13:34"; år bara om annat år. */
  _chkWhen(at) {
    const d = new Date(at);
    if (isNaN(d)) return '';
    const tz = 'Europe/Stockholm';
    const day = (x) => x.toLocaleDateString('sv-SE', { timeZone: tz });
    const time = d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', timeZone: tz });
    const now = new Date();
    if (day(d) === day(now)) return 'idag ' + time;
    if (day(d) === day(new Date(now.getTime() - 86400000))) return 'igår ' + time;
    const sameYear = d.toLocaleDateString('sv-SE', { year: 'numeric', timeZone: tz }) === now.toLocaleDateString('sv-SE', { year: 'numeric', timeZone: tz });
    return d.toLocaleDateString('sv-SE', Object.assign({ day: 'numeric', month: 'short', timeZone: tz }, sameYear ? {} : { year: 'numeric' })).replace('.', '') + ' ' + time;
  },
  _renderChecklist(ao) {
    const items = ao.checklist || [];
    if (!items.length) return this._empty('clipboard-check', 'Ingen checklista', 'Den här ordern har inga checkpunkter.', Auth.can('ao_checklist') ? `<button class="btn bs bsm" onclick="WorkOrderDetailPage.openAddChecklist()">${ic('plus',13)} Lägg till punkt</button>` : '');
    const v2 = WorkOrderService._chkV2 === true;
    if (WorkOrderService._chkV2 === null && !this._chkProbing) {
      this._chkProbing = true;
      WorkOrderService.checklistV2Supported(ao.id).then((sup) => {
        this._chkProbing = false;
        const el = document.getElementById('ao-checklist');
        const cur = getAO(this.aoId);
        if (sup && el && cur) el.innerHTML = this._renderChecklist(cur);
      });
    }
    const canAny = Auth.can('ao_checklist') || Auth.can('ao_edit');
    return items.map((c) => {
      const st   = WorkOrderService.checklistStatus(c);
      const busy = !!this._chkBusy[c.id];
      const id   = esc(c.id);
      const can  = (a) => canAny && !busy && WorkOrderService.canChecklistAction(c, a);
      const btn  = (action, cls, icon, label, title) =>
        `<button class="btn bxs ${cls} chk-btn" data-id="${id}" onclick="WorkOrderDetailPage.chkAction(this.dataset.id,'${action}')" title="${title}" aria-label="${title}">${ic(icon,12)}${label ? ' ' + label : ''}</button>`;
      let meta = '';
      if (busy) meta = `<span class="chk-meta-saving">${ic('refresh-cw',10)} Sparar…</span>`;
      else if (st === 'pagaende') meta = `<span class="chk-st chk-st-prog">Pågår</span> ${this._chkWho(c.startedBy, c.startedAt)}`;
      else if (st === 'utford') meta = (c.doneBy || c.doneAt)
        ? `<span class="chk-st chk-st-done">Utförd</span> ${this._chkWho(c.doneBy, c.doneAt)}${c.startedBy && c.startedById !== c.doneById ? ` · påbörjad av ${esc(c.startedBy)}` : ''}`
        : `<span class="chk-st chk-st-done">Utförd</span> <span class="chk-meta-old">äldre punkt — uppgift om vem saknas</span>`;
      else if (st === 'avvikelse') meta = `<span class="chk-st chk-st-avv">Avvikelse</span> ${this._chkWho(c.avvikelseBy, c.avvikelseAt)}`;
      const acts = [];
      if (canAny) {
        if (st === 'ej_paborjad') {
          if (v2 && can('start')) acts.push(btn('start', 'bs chk-btn-start', 'play', 'Påbörja', 'Påbörja punkten'));
          if (can('done')) acts.push(btn('done', 'bs', 'check', '', 'Markera utförd'));
          if (can('avvikelse')) acts.push(btn('avvikelse', 'bs', 'alert-triangle', '', 'Markera avvikelse'));
        } else if (st === 'pagaende') {
          if (can('done')) acts.push(btn('done', 'bsu', 'check', 'Utförd', 'Markera utförd'));
          if (can('avvikelse')) acts.push(btn('avvikelse', 'bs', 'alert-triangle', '', 'Markera avvikelse'));
          if (can('reset')) acts.push(btn('reset', 'bghost', 'rotate-ccw', '', 'Återställ till ej påbörjad'));
        } else {
          if (can('reset')) acts.push(btn('reset', 'bghost', 'rotate-ccw', '', 'Återställ till ej påbörjad'));
        }
        if (can('remove')) acts.push(btn('remove', 'bghost chk-btn-del', 'trash', '', 'Ta bort punkten'));
      }
      return `
        <div class="chk-row chk-${st}${busy ? ' chk-busy' : ''}" data-id="${id}" data-status="${st}">
          <span class="chk-ic" aria-hidden="true">${st === 'utford' ? ic('check',11) : st === 'avvikelse' ? ic('alert-triangle',10) : st === 'pagaende' ? ic('clock',11) : ''}</span>
          <div class="chk-main">
            <div class="chk-text">${esc(c.text)}</div>
            ${c.description ? `<div class="chk-desc">${esc(c.description)}</div>` : ''}
            ${meta ? `<div class="chk-meta">${meta}</div>` : ''}
            ${st === 'avvikelse' && (c.avvikelseComment || c.avvikelseImage) ? `<div class="chk-avv-box">
              ${c.avvikelseComment ? `<div>${esc(c.avvikelseComment)}</div>` : ''}
              ${isSafeImageDataUrl(c.avvikelseImage) ? `<img src="${c.avvikelseImage}" alt="Avvikelsebild">` : ''}
            </div>` : ''}
          </div>
          ${acts.length ? `<div class="chk-acts">${acts.join('')}</div>` : ''}
        </div>`;
    }).join('');
  },

  /* ── Material ─────────────────────────────── */
  _matTotals(ao) {
    const canSeePrice = Auth.canAny(['invoice_view','invoice_create','reports_view']);
    if (!canSeePrice) return '';
    const mats = ao.materials || [];
    if (!mats.length) return '';
    let exMoms = 0, momsAmt = 0;
    /* T4-B (D-10): bara rader med känt försäljningspris summeras — okänt pris är inte 0 kr. */
    let okanda = 0;
    mats.forEach(m => {
      if (m.sellPriceUnknown === true || typeof m.sellPrice !== 'number') { okanda++; return; }
      const ex = (Number(m.qty) || 0) * m.sellPrice;
      const vat = _matNormVat(m.vatRate);
      exMoms  += ex;
      momsAmt += ex * vat / 100;
    });
    const inkl = exMoms + momsAmt;
    return `
      <div class="aod-mat-tot">${okanda ? `
        <div class="aod-warn">${okanda} rad${okanda === 1 ? '' : 'er'} saknar försäljningspris (räknas inte in)</div>` : ''}
        <div><span>Totalt exkl. moms</span><span>${fmt(exMoms)} kr</span></div>
        <div><span>Moms</span><span>${fmt(momsAmt)} kr</span></div>
        <div class="is-sum"><span>Totalt inkl. moms</span><span>${fmt(inkl)} kr</span></div>
      </div>`;
  },

  /* V3: rader i stället för tabell (läsbar på 360 px utan sidledsrullning).
     Samma uppgifter och samma behörighetsregel för priser (canSeePrice);
     inköpspris/marginal bara bakom "Intern" som förut. */
  _renderMaterials(ao) {
    const canSeePrice = Auth.canAny(['invoice_view','invoice_create','reports_view']);
    const mats = ao.materials || [];
    if (!mats.length) return this._empty('package', 'Inget material', 'Inget material är registrerat på ordern ännu.', Auth.can('ao_material') ? `<button class="btn bs bsm" onclick="WorkOrderDetailPage.openAddMaterial()">${ic('plus',13)} Lägg till material</button>` : '');
    /* T4-B (D-09, D-10, D-19, F13): belopp bara med prisläsrätt (servern lämnar inte ut dem till
       fältet); okänt pris visas som "pris saknas", aldrig 0 kr. Fältet ändrar bara egna rader. */
    const prisRatt = canSeePrice && WorkOrderService.canReadPrices();
    const meId = state.currentUser ? state.currentUser.id : '';
    const allaRader = Auth.can('ao_edit');
    return `<div class="aod-rows">${mats.map(m => {
      const mid  = this._id(m.id);
      const qty  = Number(m.qty) || 0;
      const kant = m.sellPriceUnknown !== true && typeof m.sellPrice === 'number';
      const sell = kant ? m.sellPrice : null;
      const buy  = m.buyPriceUnknown !== true && typeof m.buyPrice === 'number' ? m.buyPrice : null;
      const vat  = _matNormVat(m.vatRate);
      const exMoms   = kant ? qty * sell : null;
      const inklMoms = kant ? exMoms + exMoms * vat / 100 : null;
      const egen = allaRader || (meId && m.addedBy === meId) || m._pending;
      return `<div class="aod-row aod-mrow">
        <div class="aod-row-main">
          <div class="aod-row-t">${esc(m.name)}${m.extra === true ? ' <span class="bdg bdg-grey">Tillägg</span>' : ''}</div>
          <div class="aod-row-s">${fmt(qty)} ${esc(m.unit || '')}${prisRatt ? (kant ? ` · ${fmt(sell)} kr/${esc(m.unit || 'st')} exkl. moms` : ' · <span class="aod-warn">Pris saknas</span>') : ''}${m.note ? ' · ' + esc(m.note) : ''}</div>
          ${prisRatt && kant && buy !== null && buy > 0 ? `<button type="button" class="aod-int-btn" aria-expanded="false" onclick="var e=document.getElementById('mat-int-${mid}');var o=e.hidden;e.hidden=!o;this.setAttribute('aria-expanded',o?'true':'false');">${ic('eye',11)} Intern</button>
            <div id="mat-int-${mid}" class="aod-int" hidden>Ink: ${fmt(buy)} kr · Marginal: ${fmt(Math.max(0,sell-buy))} kr/st</div>` : ''}
        </div>
        ${prisRatt && kant ? `<div class="aod-row-sum">${fmt(inklMoms)} kr<small>inkl. moms</small></div>` : ''}
        ${egen ? `<div class="aod-row-acts">
          <button class="btn bs bxs aod-ibtn" data-id="${esc(m.id)}" title="Redigera material" aria-label="Redigera material" onclick="WorkOrderDetailPage.openEditMaterial(this.dataset.id)">${ic('pencil',13)}</button>
          <button class="btn bd bxs aod-ibtn" data-id="${esc(m.id)}" title="Ta bort material" aria-label="Ta bort material" onclick="WorkOrderDetailPage.deleteMaterial(this.dataset.id)">${ic('trash',13)}</button>
        </div>` : ''}
      </div>`;
    }).join('')}</div>`;
  },

  _renderTimeEntries(ao) {
    const entries = TimeService.getByAO(ao.id);
    if (!entries.length) return this._empty('clock', 'Ingen tid registrerad', 'Ingen tid är registrerad på ordern ännu.', Auth.canAny(['ao_time','payroll_manage']) ? `<button class="btn bs bsm" onclick="WorkOrderDetailPage.openAddTime()">${ic('plus',13)} Registrera tid</button>` : '');
    /* V21: samma behörighetsprincip som TimePage._renderList() — inte längre
       antagandet att alla som når denna sida får redigera/radera vad som helst. */
    const isSuper    = typeof Auth !== 'undefined' && Auth.can('all');
    const canPayroll  = typeof Auth !== 'undefined' && Auth.can('payroll_manage');
    const canOwnTime  = typeof Auth !== 'undefined' && Auth.can('ao_time');
    return `<div class="aod-rows">${entries.map(t => {
      const isOwn    = state.currentUser && t.staffId === state.currentUser.id;
      const isLocked = !!t.attested && !isSuper;
      const canEdit  = !isLocked && (isSuper || (isOwn ? (canOwnTime || canPayroll) : canPayroll));
      return `
      <div class="aod-row aod-trow">
        <div class="aod-row-main">
          <div class="aod-row-t">${esc(t.staffName)} · ${WorkOrderDetailPage._h(t.minutes)}${t.attested ? ` <span class="bdg bdg-green">${ic('lock',10)} Attesterad</span>` : ''}${!t.billable ? ` <span class="bdg bdg-grey">Ej debiterbar</span>` : ''}</div>
          <div class="aod-row-s">${esc(t.date)} ${esc(t.startStr)}–${esc(t.endStr)}${t.comment?' · '+esc(t.comment):''}</div>
          ${t.priceGroupName ? `<div class="aod-row-s is-price">${esc(t.priceGroupName)}${WorkOrderService.canReadPrices() && typeof t.hourRate === 'number' ? ` – ${fmt(t.hourRate)} kr/tim exkl. moms` : ''}</div>` : ''}
          ${t.registeredByName ? `<div class="aod-row-s is-note">Registrerat av ${esc(t.registeredByName)}</div>` : ''}
        </div>
        ${canEdit ? `
        <div class="aod-row-acts">
          <button class="btn bs bxs aod-ibtn" data-id="${esc(t.id)}" title="Redigera tidpost" aria-label="Redigera tidpost" onclick="WorkOrderDetailPage.openEditTime(this.dataset.id)">${ic('pencil',13)}</button>
          <button class="btn bd bxs aod-ibtn" data-id="${esc(t.id)}" title="Ta bort tidpost" aria-label="Ta bort tidpost" onclick="WorkOrderDetailPage.deleteTime(this.dataset.id)">${ic('trash',13)}</button>
        </div>` : ''}
      </div>`;
    }).join('')}</div>`;
  },

  /* ── Tidslinje/logg ───────────────────────── */
  _renderTimeline(ao, showAll = false) {
    const events = [];
    (ao.notes||[]).forEach(n => events.push({ type:'note', ts:n.timestamp||'', who:n.staffName||'', text:n.text||'', id:n.id }));
    (ao.log||[]).forEach(l => events.push({ type:l.type||'log', ts:l.timestamp||'', who:l.userName||'', text:l.text||'', imageData:l.imageData||'', imagePath:l.imagePath||'', followUpDate:l.followUpDate||'', id:l.id }));
    TimeService.getByAO(ao.id).forEach(t => events.push({ type:'time', ts:t.createdAt||t.date||'', who:t.staffName||'', text:`${WorkOrderDetailPage._h(t.minutes)} registrerad${t.comment?' – '+t.comment:''}` }));
    (ao.materials||[]).forEach(m => { if (m.addedAt) events.push({ type:'material', ts:m.addedAt, who:'', text:`${m.qty} ${m.unit} ${m.name} tillagd` }); });
    /* T3-D (D-22): aktivitetsloggens poster är klientrapporterade (servern har bara verifierat
       vem och när) och märks så — de presenteras inte som revisionshistorik. */
    ActivityService.getByWorkOrder(ao.id, 50).forEach(a => {
      if (a.type==='status_change'||a.type==='work_order_status'||a.type==='created')
        events.push({ type:a.type, ts:a.timestamp||'', who:'', text:a.description||'', klientrapport:true });
    });

    if (!events.length) return this._empty('history', 'Ingen historik ännu', 'Anteckningar, bilder, tid, material och statusändringar visas här.', '');
    events.sort((a,b) => (b.ts>a.ts?1:b.ts<a.ts?-1:0));

    const LIMIT   = 5;
    const hasMore = !showAll && events.length > LIMIT;
    const display = hasMore ? events.slice(0, LIMIT) : events;

    const TI = {
      note:              {ico:'file-text',   col:'var(--navy)', lbl:'Anteckning'},
      log:               {ico:'activity',    col:'var(--sky)',  lbl:'Logg'},
      photo:             {ico:'camera',      col:'var(--sky)',  lbl:'Foto'},
      time:              {ico:'clock',       col:'#16a34a',     lbl:'Tid'},
      material:          {ico:'package',     col:'#c2410c',     lbl:'Material'},
      status_change:     {ico:'refresh-cw',  col:'var(--mt)',   lbl:'Status'},
      work_order_status: {ico:'refresh-cw',  col:'var(--mt)',   lbl:'Status'},
      created:           {ico:'plus-circle', col:'var(--sky)',  lbl:'Skapad'},
      uppföljning:       {ico:'bell',        col:'#7c3aed',     lbl:'Uppföljning'},
    };

    const fmtTs = ts => {
      if (!ts) return '';
      try {
        const d = new Date(ts);
        if (isNaN(d)) return relDate(ts);
        const now = new Date();
        const pad = n => String(n).padStart(2,'0');
        const hm = pad(d.getHours())+':'+pad(d.getMinutes());
        if (d.toDateString()===now.toDateString()) return 'Idag '+hm;
        const yest = new Date(now); yest.setDate(now.getDate()-1);
        if (d.toDateString()===yest.toDateString()) return 'Igår '+hm;
        const sameYear = d.getFullYear()===now.getFullYear();
        return pad(d.getDate())+'/'+pad(d.getMonth()+1)+(sameYear?'':' '+d.getFullYear())+' '+hm;
      } catch(e) { return relDate(ts); }
    };

    let html = '<div style="padding:12px 14px 8px;">' + display.map((ev, i) => {
      const ti = TI[ev.type] || {ico:'activity', col:'var(--mt)', lbl:ev.type};
      const isLast = i === display.length - 1;
      const ts = fmtTs(ev.ts);
      const canDel = ev.id && (ev.type==='log'||ev.type==='photo'||ev.type==='uppföljning');
      return `
        <div style="display:flex;gap:0;">
          <div style="display:flex;flex-direction:column;align-items:center;width:36px;flex-shrink:0;">
            <div style="width:30px;height:30px;border-radius:50%;background:${ti.col}1a;border:1.5px solid ${ti.col}50;display:flex;align-items:center;justify-content:center;color:${ti.col};flex-shrink:0;">${ic(ti.ico,13)}</div>
            ${!isLast?'<div style="width:2px;flex:1;min-height:8px;background:var(--br);border-radius:1px;"></div>':''}
          </div>
          <div style="flex:1;min-width:0;padding:2px 0 ${isLast?'4':'16'}px 10px;">
            <div style="display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin-bottom:${ev.text||ev.imageData?'3':'0'}px;">
              <span style="font-size:10px;font-weight:800;color:${ti.col};text-transform:uppercase;letter-spacing:.4px;">${ti.lbl}</span>
              ${ev.klientrapport?`<span class="aod-klientrapport" style="font-size:10px;color:var(--mt);" title="Rapporterad av användarens app — inte en revisionslogg">klientrapport</span>`:''}
              ${ts?`<span style="font-size:10px;color:var(--mt);">${ts}</span>`:''}
              ${ev.who?`<span style="font-size:10px;color:var(--mt);display:inline-flex;align-items:center;gap:3px;">${ic('user',9)} ${esc(ev.who)}</span>`:''}
            </div>
            ${ev.text?`<div style="font-size:13px;line-height:1.5;word-break:break-word;color:var(--tx);">${esc(ev.text)}</div>`:''}
            ${ev.followUpDate?`<div style="margin-top:5px;display:inline-flex;align-items:center;gap:4px;background:#f3e8ff;color:#7c3aed;font-size:10px;font-weight:700;padding:2px 9px;border-radius:20px;border:1px solid #ddd6fe;">${ic('calendar',9)} Uppföljning: ${esc(ev.followUpDate)}</div>`:''}
            ${isSafeImageDataUrl(ev.imageData)?`<img src="${ev.imageData}" style="max-width:100%;max-width:260px;border-radius:8px;margin-top:6px;max-height:200px;object-fit:cover;border:1px solid var(--br);" loading="lazy">`:''}
            ${!ev.imageData&&ev.imagePath?`<img data-imgpath="${esc(ev.imagePath)}" style="max-width:100%;max-width:260px;border-radius:8px;margin-top:6px;max-height:200px;min-height:60px;object-fit:cover;border:1px solid var(--br);background:var(--bg2,#f3f4f6);" loading="lazy" alt="Bild läses in…">`:''}
          </div>
          ${canDel?`<button class="btn bxs bd aod-ibtn" style="flex-shrink:0;align-self:flex-start;margin-top:1px;" data-id="${esc(ev.id)}" title="Ta bort loggpost" aria-label="Ta bort loggpost" onclick="WorkOrderDetailPage.deleteLogEntry(this.dataset.id)">${ic('trash',13)}</button>`:''}
        </div>`;
    }).join('');

    if (hasMore) {
      html += `<div style="padding:0 14px 12px;">
        <button class="btn bghost bfull" style="font-size:12px;" onclick="WorkOrderDetailPage._showAllTimeline()">
          ${ic('chevron-down',13)} Visa alla ${events.length} händelser
        </button>
      </div>`;
    }
    html += '</div>';
    /* Bilder lagrade i Storage (imagePath) får signerade URL:er efter att
       anroparen satt in HTML:en — täcker alla renderingsställen utan att
       varje anropsplats behöver komma ihåg det. */
    if (html.indexOf('data-imgpath=') !== -1) {
      this._scheduleImgResolve();
    }
    return html;
  },

  /* Hämtar signerade URL:er (server-behörighetskontrollerade, se
     work-order-image-url) för img[data-imgpath] som saknar src. Fel ger
     bara en tom ruta — resten av tidslinjen påverkas aldrig. */
  async _resolveTimelineImages(rootEl) {
    if (!rootEl || typeof WorkOrderImageService === 'undefined') return;
    const imgs = Array.from(rootEl.querySelectorAll('img[data-imgpath]:not([src])'));
    if (!imgs.length) return;
    const paths = Array.from(new Set(imgs.map(el => el.getAttribute('data-imgpath')).filter(Boolean)));
    try {
      const urlMap = await WorkOrderImageService.getSignedUrls(paths);
      imgs.forEach(el => {
        const p = el.getAttribute('data-imgpath');
        if (p && urlMap[p]) el.src = urlMap[p];
        else el.alt = 'Bilden kunde inte visas';
      });
    } catch (e) {
      console.warn('[WorkOrderDetailPage] _resolveTimelineImages fel:', e);
    }
  },

  openAddLog() {
    Modal.open({
      title: 'Lägg till loggpost',
      body: `
        <div class="fg"><label>Text / beskrivning</label>
          <textarea id="log-text" rows="3" placeholder="Beskriv vad som hände eller vad bilden visar…"></textarea></div>
        <div class="fg">
          <label>Bild (valfri — kan kombineras med text)</label>
          <input type="file" id="log-img" accept="image/*" onchange="WorkOrderDetailPage._previewLogImg(this)">
          <div id="log-img-preview" style="margin-top:6px;"></div>
        </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => this._saveLog() },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('log-text')?.focus(), 80);
  },

  _previewLogImg(input) {
    const file = input.files && input.files[0];
    const prev = document.getElementById('log-img-preview');
    if (!file || !prev) return;
    const reader = new FileReader();
    reader.onload = function(e) {
      prev.innerHTML = `<img src="${e.target.result}" style="max-width:100%;border-radius:8px;max-height:160px;object-fit:cover;">`;
    };
    reader.readAsDataURL(file);
  },

  _rerenderTimeline() {
    const ao = getAO(this.aoId);
    const el = document.getElementById('ao-timeline');
    if (ao && el) el.innerHTML = this._renderTimeline(ao);
    const ph = document.getElementById('ao-photos');
    if (ao && ph) { ph.innerHTML = this._renderPhotos(ao); this._afterPhotosRender(); }
  },

  /* ── Bilder (V3 2026-11-26) ──────────────────────────────────────────
     Foton ur loggen (och äldre anteckningar med inbäddad bild) som
     miniatyrer. Bilder i Storage (imagePath) får signerade URL:er via samma
     serverkontrollerade väg som tidslinjen (_resolveTimelineImages). */
  _photoItems(ao) {
    const out = [];
    (ao.log || []).forEach(l => { if (l.imagePath || isSafeImageDataUrl(l.imageData)) out.push({ ts: l.timestamp || '', who: l.userName || '', text: l.text || '', imagePath: l.imagePath || '', imageData: isSafeImageDataUrl(l.imageData) ? l.imageData : '' }); });
    (ao.notes || []).forEach(n => { if (isSafeImageDataUrl(n.imageData)) out.push({ ts: n.timestamp || '', who: n.staffName || '', text: n.text || '', imagePath: '', imageData: n.imageData }); });
    out.sort((a, b) => (b.ts > a.ts ? 1 : b.ts < a.ts ? -1 : 0));
    return out;
  },

  _renderPhotos(ao) {
    const items = this._photoItems(ao);
    if (!items.length) return this._empty('camera', 'Inga bilder ännu', 'Foton som läggs till i loggen visas här.', `<button class="btn bs bsm" onclick="WorkOrderDetailPage.openAddLog()">${ic('camera',13)} Foto eller anteckning</button>`);
    return `<div class="aod-ph-grid">${items.map(p => {
      const cap = [p.text, p.ts ? fmtDate(p.ts) : '', p.who].filter(Boolean).join(' · ');
      const img = p.imageData
        ? `<img src="${p.imageData}" alt="${esc(p.text || 'Bild')}" loading="lazy">`
        : `<img data-imgpath="${esc(p.imagePath)}" alt="${esc(p.text || 'Bild läses in…')}" loading="lazy">`;
      return `<button type="button" class="aod-ph" title="${esc(cap)}" onclick="WorkOrderDetailPage._openPhoto(this)">${img}<span class="aod-ph-cap">${esc(cap)}</span></button>`;
    }).join('')}</div>`;
  },

  _afterPhotosRender() {
    const ao = getAO(this.aoId);
    const cnt = document.getElementById('ao-photo-count');
    const n = ao ? this._photoItems(ao).length : 0;
    if (cnt) cnt.innerHTML = n ? `<span class="bdg bdg-grey">${n} st</span>` : '';
    const ph = document.getElementById('ao-photos');
    if (ph && ph.querySelector('img[data-imgpath]:not([src])')) this._scheduleImgResolve();
  },

  /* En hämtning av signerade URL:er per renderingsomgång, även när både
     tidslinjen och bildkortet innehåller samma bilder. */
  _scheduleImgResolve() {
    if (this._imgResolveQueued) return;
    this._imgResolveQueued = true;
    setTimeout(() => { this._imgResolveQueued = false; this._resolveTimelineImages(document); }, 0);
  },

  /* Större visning av en miniatyr (bara redan hämtade bild-URL:er). */
  _openPhoto(btn) {
    const img = btn && btn.querySelector('img');
    const src = img && img.getAttribute('src');
    if (!src || !/^(https?:|blob:|data:image\/(png|jpe?g|webp|gif);base64,)/i.test(src)) { showToast('Bilden läses fortfarande in'); return; }
    const cap = btn.querySelector('.aod-ph-cap');
    Modal.open({
      title: `${ic('camera',14)} Bild`,
      wide: true,
      body: `<img class="aod-ph-full" src="${esc(src)}" alt="${esc(img.getAttribute('alt') || 'Bild')}">${cap && cap.textContent ? `<p class="aod-muted" style="margin-top:8px;">${esc(cap.textContent)}</p>` : ''}`,
      buttons: [{ label: 'Stäng', cls: 'btn bs', onClick: () => Modal.close() }]
    });
  },

  /* Ny loggpost. Bild laddas först upp till Storage (work-order-image-upload,
     serverkontrollerad behörighet + innehållskontroll) — loggposten får bara
     en `imagePath`-referens, inga bildbytes i vift_workOrders. Loggposten
     sparas via WorkOrderService.update() → ao-time-write; "sparad" visas
     först när servern bekräftat (onSettled ok). */
  /* G12: gemensamt besked för AO-skrivningar via utkorgen — framgång
     först vid serverns ACK, tydligt fel vid definitivt avslag (då har
     WorkOrderService/AOTimeSync redan markerat AO:n och omläsning sker).
     Transienta fel (nät) ligger kvar i kön och ger inget besked här. */
  /* T4-B: materialrad — serverns (projicerade) rader ersätter de lokala; sektionen ritas om. */
  _matAck(okMsg, failMsg) {
    const base = this._ackOpts(okMsg, failMsg);
    const aoId = this.aoId;
    return { onSettled: (r) => {
      base.onSettled(r);
      if (r && r.ok && this.aoId === aoId) { try { this._refreshMaterialSection(); } catch (e) {} }
    } };
  },

  _ackOpts(okMsg, failMsg) {
    const aoId = this.aoId;
    return { onSettled: (r) => {
      if (r && r.ok) { showToast(okMsg); return; }
      if (r && r.final) {
        showToast(failMsg + ' (' + (r.error || 'okänt fel') + ').', 6000);
        if (this.aoId === aoId) { try { this.render({ aoId }); } catch (e) {} }
      }
    }};
  },

  async _saveLog() {
    if (this._logSaving) return;
    const text = document.getElementById('log-text')?.value.trim();
    const imgInput = document.getElementById('log-img');
    const file = imgInput && imgInput.files && imgInput.files[0];
    if (!text && !file) { showToast('Lägg till text eller bild'); return; }
    const aoId = this.aoId;
    this._logSaving = true;
    try {
      let imagePath = '';
      if (file) {
        if (typeof WorkOrderImageService === 'undefined') { showToast('Bilduppladdning är inte tillgänglig'); return; }
        showToast('Laddar upp bild…');
        try {
          imagePath = (await WorkOrderImageService.upload(aoId, file)).path;
        } catch (e) {
          showToast('Bilden kunde inte laddas upp (' + (e.message || e) + ') — loggposten sparades inte.', 5000);
          return;
        }
      }
      const ao = getAO(aoId);
      if (!ao) {
        if (imagePath) WorkOrderImageService.remove(aoId, imagePath).catch(function() {});
        return;
      }
      if (!ao.log) ao.log = [];
      const entry = {
        id: newEntryId('LOG-'),
        type: imagePath ? 'photo' : 'log',
        text: text || '',
        imageData: '',
        imagePath: imagePath,
        visibility: 'intern',
        userName: state.currentUser ? state.currentUser.firstName + ' ' + state.currentUser.lastName : 'Okänd',
        timestamp: new Date().toISOString()
      };
      ao.log.push(entry);
      Modal.close();
      this._rerenderTimeline();
      showToast('Sparar loggpost…');
      /* G5: en post i taget (atomiskt på servern när den stöder det). */
      WorkOrderService.appendLogEntry(aoId, entry, { onSettled: (r) => {
        if (r.ok) { showToast('Loggpost sparad'); return; }
        /* Definitivt avslag: posten finns inte på servern. Ta bort den
           lokalt. Bilden städas bara bort om inget annat väntar för samma
           AO — en senare köad patch kan bära med samma post, och en
           kvarglömd fil är ofarlig medan en raderad refererad fil inte är det. */
        const cur = getAO(aoId);
        if (cur && cur.log) cur.log = cur.log.filter(l => l.id !== entry.id);
        const otherPending = typeof AOTimeSyncService !== 'undefined' && AOTimeSyncService.hasPendingEntry('ao', aoId);
        if (imagePath && !otherPending) WorkOrderImageService.remove(aoId, imagePath).catch(function() {});
        if (this.aoId === aoId) this._rerenderTimeline();
        showToast('Loggposten kunde inte sparas (' + (r.error || 'okänt fel') + ').', 5000);
      }});
    } finally {
      this._logSaving = false;
    }
  },

  /* Borttagning: posten tas bort lokalt och skickas via ao-time-write.
     Bildfilen raderas FÖRST när servern bekräftat borttagningen. Avslag →
     posten läggs tillbaka. Väntar skrivningen på nätet (transient) ligger
     den i outboxen; bilden rörs inte förrän bekräftelsen kommer. */
  deleteLogEntry(logId) {
    Modal.confirm('Ta bort loggpost?', () => {
      const aoId = this.aoId;
      const ao = getAO(aoId);
      if (!ao) return;
      const idx = (ao.log || []).findIndex(l => l.id === logId);
      if (idx < 0) return;
      const removed = ao.log[idx];
      ao.log = ao.log.filter(l => l.id !== logId);
      this._rerenderTimeline();
      showToast('Tar bort…');
      WorkOrderService.removeLogEntry(aoId, logId, { onSettled: (r) => {
        if (r.ok) {
          if (removed.imagePath && typeof WorkOrderImageService !== 'undefined') {
            WorkOrderImageService.remove(aoId, removed.imagePath).catch(function(e) {
              console.warn('[WorkOrderDetailPage] Bildfilen kunde inte raderas (posten är borttagen):', e);
            });
          }
          showToast('Loggpost borttagen');
          return;
        }
        const cur = getAO(aoId);
        if (cur && !(cur.log || []).some(l => l.id === logId)) {
          cur.log = (cur.log || []).slice();
          cur.log.splice(Math.min(idx, cur.log.length), 0, removed);
        }
        if (this.aoId === aoId) this._rerenderTimeline();
        showToast('Borttagningen kunde inte sparas (' + (r.error || 'okänt fel') + ') — posten finns kvar.', 5000);
      }});
    });
  },

  /* ── Uppföljning ───────────────────────────── */
  openFollowUp() {
    const defaultDate = new Date();
    defaultDate.setDate(defaultDate.getDate() + 2);
    const defaultDateStr = defaultDate.toISOString().split('T')[0];
    Modal.open({
      title: `${ic('bell',14)} Skapa uppföljning`,
      body: `
        <div class="fg"><label>Typ</label>
          <select id="fu-type">
            <option value="Följ upp kund">Följ upp kund</option>
            <option value="Ring kund">Ring kund</option>
            <option value="Skicka påminnelse">Skicka påminnelse</option>
            <option value="Återbesök">Återbesök</option>
            <option value="Kontrollera arbete">Kontrollera arbete</option>
          </select>
        </div>
        <div class="fg"><label>Kommentar <span style="color:var(--rd)">*</span></label>
          <textarea id="fu-comment" rows="3" placeholder="Vad ska följas upp? Vad är syftet?"></textarea>
        </div>
        <div class="g2">
          <div class="fg"><label>Datum för uppföljning <span style="color:var(--rd)">*</span></label>
            <input type="date" id="fu-date" value="${defaultDateStr}"></div>
          <div class="fg"><label>Tid (valfritt)</label>
            <input type="time" id="fu-time"></div>
        </div>`,
      buttons: [
        { label: 'Skapa uppföljning', cls: 'btn bsu', onClick: () => this._saveFollowUp() },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('fu-comment')?.focus(), 80);
  },

  _saveFollowUp() {
    const date    = document.getElementById('fu-date')?.value;
    const time    = document.getElementById('fu-time')?.value || '';
    const type    = document.getElementById('fu-type')?.value || 'Följ upp kund';
    const comment = document.getElementById('fu-comment')?.value.trim();
    if (!date)    { showToast('Välj datum'); return; }
    if (!comment) { showToast('Kommentar krävs'); return; }
    const ao = getAO(this.aoId);
    if (!ao) return;
    if (!ao.log) ao.log = [];
    const who = state.currentUser ? `${state.currentUser.firstName} ${state.currentUser.lastName}`.trim() : '';
    const entry = {
      id: newEntryId('LOG-'),
      type: 'uppföljning',
      text: `${type}: ${comment}`,
      followUpDate: date,
      followUpTime: time,
      followUpType: type,
      imageData: '',
      visibility: 'intern',
      userName: who,
      timestamp: new Date().toISOString()
    };
    ao.log.push(entry);
    WorkOrderService.appendLogEntry(this.aoId, entry);
    ActivityService.log('uppföljning', `${type}: ${comment} (${date}${time?' '+time:''})`, {
      workOrderId: this.aoId,
      customerId: ao.customerId
    });
    ActivitiesService.create({
      type:        'followup',
      relatedType: 'workOrder',
      relatedId:   this.aoId,
      customerId:  ao.customerId || null,
      dueDate:     date,
      dueTime:     time,
      note:        `${type}: ${comment}`
    });
    Sidebar.updateBadges();
    Modal.close();
    const aoUp = getAO(this.aoId);
    if (aoUp) document.getElementById('ao-timeline').innerHTML = this._renderTimeline(aoUp);
    showToast(`Uppföljning skapad: ${date}`);
  },

  /* ── Material-modal ───────────────────────── */
  /* T4-B (D-09, D-10, D-19, F13): artikelväljaren och formuläret visar belopp bara med prisläsrätt
     och priser kan bara anges av en roll med prissättningsrätt. En artikelrad prissätts alltid av
     servern; en fritextrad utan pris får okänt pris (aldrig 0). Dokumentation (anteckning) för alla. */
  openAddMaterial() {
    if (!Auth.require('ao_material')) return;
    const pr = WorkOrderService.canReadPrices(), ps = WorkOrderService.canSetSalePrice(), pb = WorkOrderService.canSetBuyPrice();
    const kv = Auth.can('cost_view');
    const articles = (state.articles||[]).filter(a=>a.active);
    const prisText = (a) => pr ? ` · ${kv && typeof a.buyPrice === 'number' ? 'Ink: ' + fmt(a.buyPrice) + ' kr · ' : ''}Pris: ${typeof a.sellPrice === 'number' && a.sellPrice > 0 ? fmt(a.sellPrice) + ' kr exkl. moms' : 'saknas'}` : '';
    const artListHtml = articles.length ? articles.map(a => `
      <div class="art-row" data-id="${esc(a.id)}" data-name="${esc(a.name)}" data-unit="${esc(a.unit)}" data-buy="${pb && typeof a.buyPrice === 'number' ? esc(a.buyPrice) : ''}" data-sell="${ps && typeof a.sellPrice === 'number' ? esc(a.sellPrice) : ''}" data-vat="${_matNormVat(a.vatRate)}" data-cat="${esc(a.category||'')}"
        onclick="WorkOrderDetailPage._matSelectArticle(this)"
        style="display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;border-radius:8px;transition:background .1s;"
        onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:700;">${a.articleNumber ? esc(a.articleNumber)+' – ':'' }${esc(a.name)}</div>
          <div style="font-size:11px;color:var(--mt);">${esc(a.unit)}${prisText(a)}</div>
        </div>
        <div id="art-check-${a.id}" style="display:none;color:var(--grn);">${ic('check',14)}</div>
      </div>`).join('') : '<p style="padding:8px;font-size:12px;color:var(--mt);">Inga artiklar i register</p>';

    Modal.open({
      title: 'Lägg till material',
      wide: true,
      body: `
        ${articles.length ? `
          <div style="margin-bottom:12px;">
            <div style="font-size:12px;font-weight:700;color:var(--mt);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px;">Välj från artikelregister</div>
            <div class="fg" style="margin-bottom:6px;">
              <input id="art-search" placeholder="Sök artikel…" oninput="WorkOrderDetailPage._matFilterArticles()" autocomplete="off">
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
              ${[{v:'',l:'Alla'},{v:'kemikalier',l:'Kemikalier'},{v:'material',l:'Byggmaterial'},{v:'forbruk',l:'Förbrukning'},{v:'arbete',l:'Arbete'},{v:'kostnad',l:'Kostnad'}].map(c =>
                `<button type="button" class="chip ${c.v===''?'on':''}" data-cat="${c.v||'all'}" onclick="WorkOrderDetailPage._matSetCat('${c.v}',this)">${c.l}</button>`
              ).join('')}
            </div>
            <div id="art-list" style="max-height:180px;overflow-y:auto;border:1.5px solid var(--br);border-radius:9px;padding:4px;">${artListHtml}</div>
          </div>
          <div style="font-size:12px;font-weight:700;color:var(--mt);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px;">Eller ange manuellt</div>` : ''}
        <div class="fg"><label>Benämning <span style="color:var(--rd)">*</span></label>
          <input id="mat-name" placeholder="T.ex. Fogmassa Sikaflex"></div>
        <div class="g3">
          <div class="fg"><label>Antal</label><input type="number" id="mat-qty" value="1" min="1" step="1" oninput="WorkOrderDetailPage._matUpdateCalc()"></div>
          <div class="fg"><label>Enhet</label>
            <select id="mat-unit" onchange="WorkOrderDetailPage._matUnitChanged(this.value)">
              ${unitsHtml('st')}
            </select></div>
          ${pb ? `<div class="fg"><label>Ink-pris (kr)</label><input type="number" id="mat-buy" placeholder="Okänt" min="0" oninput="WorkOrderDetailPage._matUpdateCalc()"></div>` : ''}
        </div>
        ${ps ? `<div class="g2">
          <div class="fg"><label>Försäljningspris exkl. moms (kr/enhet)</label>
            <input type="number" id="mat-sell" placeholder="Okänt (kompletteras)" min="0" oninput="WorkOrderDetailPage._matUpdateCalc()"></div>
          <div class="fg"><label>Moms</label>
            <select id="mat-vat" onchange="WorkOrderDetailPage._matUpdateCalc()">
              ${_matVatOptionsHtml(25)}
            </select></div>
        </div>` : ''}
        <div class="fg"><label>Dokumentation</label><textarea id="mat-note" rows="2" placeholder="T.ex. var materialet använts"></textarea></div>
        <input type="hidden" id="mat-article-id" value="">
        ${ps ? `<div id="mat-calc" style="display:none;background:var(--bg);border-radius:9px;padding:10px 12px;margin-top:6px;font-size:12px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:3px;"><span style="color:var(--mt)">Exkl. moms</span><span id="mat-ex">0 kr</span></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:3px;"><span id="mat-vat-lbl" style="color:var(--mt)">Moms 25%</span><span id="mat-moms">0 kr</span></div>
          <div style="display:flex;justify-content:space-between;font-weight:800;"><span>Inkl. moms</span><span id="mat-inkl">0 kr</span></div>
        </div>` : ''}`,
      buttons: [
        { label: 'Lägg till', cls: 'btn bp', onClick: () => this._saveMaterial(null) },
        { label: 'Avbryt',   cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('art-search')?.focus(), 80);
  },

  _matCatFilter: '',

  _matSetCat(cat, btn) {
    this._matCatFilter = cat;
    document.querySelectorAll('#art-cat-filter-chips .chip, .art-cat-chip').forEach(b => b.classList.remove('on'));
    document.querySelectorAll(`[data-cat="${cat||'all'}"]`).forEach(b => b.classList.add('on'));
    if (btn) { document.querySelectorAll('.chip[data-cat]').forEach(b => b.classList.remove('on')); btn.classList.add('on'); }
    this._matFilterArticles();
  },

  _matFilterArticles() {
    const q   = (document.getElementById('art-search')?.value || '').toLowerCase();
    const cat = this._matCatFilter;
    document.querySelectorAll('#art-list .art-row').forEach(row => {
      const name   = (row.dataset.name || '').toLowerCase();
      const rowCat = row.dataset.cat || '';
      const matchQ   = !q   || name.includes(q);
      const matchCat = !cat || rowCat === cat;
      row.style.display = (matchQ && matchCat) ? '' : 'none';
    });
  },

  _matSearch(q) {
    this._matFilterArticles();
  },

  _matSelectArticle(el) {
    // Toggle selection
    const selected = el.classList.contains('selected');
    document.querySelectorAll('#art-list .art-row').forEach(r => {
      r.classList.remove('selected');
      r.style.background = '';
      const chk = document.getElementById('art-check-' + r.dataset.id);
      if (chk) chk.style.display = 'none';
    });
    if (selected) {
      // Deselect: clear fields
      document.getElementById('mat-article-id').value = '';
      document.getElementById('mat-name').value = '';
      const vatEl0 = document.getElementById('mat-vat'); if (vatEl0) vatEl0.value = '25';
      ['mat-buy', 'mat-sell'].forEach((id) => { const x = document.getElementById(id); if (x) { x.disabled = false; x.value = ''; } });
      return;
    }
    el.classList.add('selected');
    el.style.background = 'var(--navy10,#f0f4ff)';
    const chk = document.getElementById('art-check-' + el.dataset.id);
    if (chk) chk.style.display = '';

    document.getElementById('mat-article-id').value = el.dataset.id;
    document.getElementById('mat-name').value = el.dataset.name || '';
    const vatEl = document.getElementById('mat-vat');
    if (vatEl) vatEl.value = el.dataset.vat || '25';
    const buyEl  = document.getElementById('mat-buy');
    const sellEl = document.getElementById('mat-sell');
    const unitEl = document.getElementById('mat-unit');
    /* T4-B: artikelns pris visas bara som information; servern sätter radens pris från artikeln. */
    if (buyEl)  { buyEl.value  = el.dataset.buy  || ''; buyEl.disabled = true; }
    if (sellEl) { sellEl.value = el.dataset.sell || ''; sellEl.disabled = true; }
    if (unitEl) {
      for (let i = 0; i < unitEl.options.length; i++) {
        if (unitEl.options[i].value === el.dataset.unit) { unitEl.selectedIndex = i; break; }
      }
      this._matUnitChanged(unitEl.value);
    }
    this._matUpdateCalc();
  },

  _matUnitChanged(unit) {
    const step  = unitStep(unit);
    const qtyEl = document.getElementById('mat-qty');
    if (qtyEl) { qtyEl.step = step; qtyEl.min = step; }
  },

  _matUpdateCalc() {
    const calc = document.getElementById('mat-calc');
    if (!calc) return;
    /* T4-B (F13): ingen "|| 0" — ett tomt pris är okänt och ger ingen beräkning. */
    const qtyV  = parseFloat(document.getElementById('mat-qty')?.value);
    const sellV = parseFloat(document.getElementById('mat-sell')?.value);
    if (!Number.isFinite(qtyV) || !Number.isFinite(sellV)) { calc.style.display = 'none'; return; }
    const qty = qtyV, sell = sellV;
    const vat  = _matNormVat(document.getElementById('mat-vat')?.value);
    const exV = qty * sell;
    const momsV = exV * vat / 100;
    const vatLbl = document.getElementById('mat-vat-lbl');
    if (vatLbl) vatLbl.textContent = `Moms ${vat}%`;
    if (exV > 0 || sell > 0) {
      calc.style.display = '';
      document.getElementById('mat-ex').textContent    = fmt(exV) + ' kr';
      document.getElementById('mat-moms').textContent  = fmt(momsV) + ' kr';
      document.getElementById('mat-inkl').textContent  = fmt(exV + momsV) + ' kr';
    } else {
      calc.style.display = 'none';
    }
  },

  openEditMaterial(matId) {
    const ao = getAO(this.aoId);
    const m  = (ao.materials||[]).find(x=>x.id===matId);
    if (!m) return;
    const vat = _matNormVat(m.vatRate);
    /* T4-B (F13): prisfälten bara med prissättningsrätt; okänt pris visas tomt ("Okänt"), aldrig 0. */
    const ps = WorkOrderService.canSetSalePrice(), pb = WorkOrderService.canSetBuyPrice();
    const sellV = m.sellPriceUnknown !== true && typeof m.sellPrice === 'number' ? m.sellPrice : '';
    const buyV  = m.buyPriceUnknown !== true && typeof m.buyPrice === 'number' ? m.buyPrice : '';
    const sum = (f) => (sellV === '' ? '–' : fmt((Number(m.qty) || 0) * sellV * f) + ' kr');
    Modal.open({
      title: 'Redigera material',
      body: `
        <div class="fg"><label>Benämning</label><input id="mat-name" value="${esc(m.name)}"></div>
        <div class="g3">
          <div class="fg"><label>Antal</label><input type="number" id="mat-qty" value="${esc(m.qty)}" min="${unitStep(m.unit||'st')}" step="${unitStep(m.unit||'st')}" oninput="WorkOrderDetailPage._matUpdateCalc()"></div>
          <div class="fg"><label>Enhet</label>
            <select id="mat-unit" onchange="WorkOrderDetailPage._matUnitChanged(this.value)">
              ${unitsHtml(m.unit||'st')}
            </select></div>
          ${pb ? `<div class="fg"><label>Ink-pris (kr)</label><input type="number" id="mat-buy" value="${esc(buyV)}" placeholder="Okänt" min="0" oninput="WorkOrderDetailPage._matUpdateCalc()"></div>` : ''}
        </div>
        ${ps ? `<div class="g2">
          <div class="fg"><label>Försäljningspris exkl. moms (kr/enhet)</label>
            <input type="number" id="mat-sell" value="${esc(sellV)}" placeholder="Okänt (kompletteras)" min="0" oninput="WorkOrderDetailPage._matUpdateCalc()"></div>
          <div class="fg"><label>Moms</label>
            <select id="mat-vat" onchange="WorkOrderDetailPage._matUpdateCalc()">
              ${_matVatOptionsHtml(vat)}
            </select></div>
        </div>` : ''}
        <div class="fg"><label>Dokumentation</label><textarea id="mat-note" rows="2">${esc(m.note || '')}</textarea></div>
        <input type="hidden" id="mat-article-id" value="${esc(m.articleId||'')}">
        ${ps ? `<div id="mat-calc" style="background:var(--bg);border-radius:9px;padding:10px 12px;margin-top:6px;font-size:12px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:3px;"><span style="color:var(--mt)">Exkl. moms</span><span id="mat-ex">${sum(1)}</span></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:3px;"><span style="color:var(--mt)">Moms ${vat}%</span><span id="mat-moms">${sum(vat/100)}</span></div>
          <div style="display:flex;justify-content:space-between;font-weight:800;"><span>Inkl. moms</span><span id="mat-inkl">${sum(1+vat/100)}</span></div>
        </div>` : ''}`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => this._saveMaterial(matId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _saveMaterial(existingId) {
    const name = document.getElementById('mat-name')?.value.trim();
    if (!name) { showToast('Benämning krävs'); return; }
    /* V39 §2: strikt write-validering. Saknat/tomt -> fallback 25 (som
       innan). Ett satt men ogiltigt värde blockerar hela sparningen —
       ingen tyst "reparation" till 25 %. */
    const vatEl = document.getElementById('mat-vat');
    const vatCheck = vatEl ? _matStrictVat(vatEl.value) : { ok: true, value: null };
    if (!vatCheck.ok) { showToast(vatCheck.error); return; }
    /* T4-B (F13, D-10): inga påhittade standardvärden — ett tomt pris är okänt (skickas inte),
       antal måste anges. Priser skickas bara av en roll med prissättningsrätt (fälten finns bara då). */
    const tal = (id) => { const el = document.getElementById(id); if (!el || el.disabled) return undefined; const v = String(el.value || '').trim(); if (v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : NaN; };
    const qty = tal('mat-qty');
    if (!(qty > 0)) { showToast('Ange antal'); return; }
    const sp = tal('mat-sell'), bp = tal('mat-buy');
    if (Number.isNaN(sp) || Number.isNaN(bp)) { showToast('Ogiltigt pris'); return; }
    const data = {
      name,
      qty,
      unit:     document.getElementById('mat-unit')?.value || 'st',
      note:     document.getElementById('mat-note')?.value || '',
      articleId:document.getElementById('mat-article-id')?.value || ''
    };
    if (sp !== undefined && sp !== null) data.sellPrice = sp;
    if (bp !== undefined && bp !== null) data.buyPrice = bp;
    if (vatEl && vatCheck.value !== null) data.vatRate = vatCheck.value;
    /* G12: besked först när servern bekräftat. */
    showToast('Sparar…');
    if (existingId) {
      WorkOrderService.updateMaterial(this.aoId, existingId, data, this._matAck('Material uppdaterat', 'Materialraden kunde inte sparas'));
    } else {
      WorkOrderService.addMaterial(this.aoId, data, this._matAck('Material tillagt', 'Materialraden kunde inte sparas'));
    }
    Modal.close();
    this._refreshMaterialSection();
  },

  deleteMaterial(matId) {
    Modal.confirm('Ta bort material?', () => {
      WorkOrderService.deleteMaterial(this.aoId, matId, this._matAck('Borttaget', 'Materialraden kunde inte tas bort'));
      this._refreshMaterialSection();
    });
  },

  /* ── Refresh-helpers (partiell DOM-uppdatering utan full re-render) ── */

  _refreshTimeSection() {
    const ao = getAO(this.aoId);
    if (!ao) return;
    const timeEntries = TimeService.getByAO(ao.id);
    const totalMins   = TimeService.totalMinutes(timeEntries);
    const canSeePrice = Auth.canAny(['invoice_view','invoice_create','reports_view']);

    const listEl  = document.getElementById('ao-timeentries');
    if (listEl)  listEl.innerHTML  = this._renderTimeEntries(ao);

    const badge   = document.getElementById('ao-time-badge');
    if (badge)   badge.innerHTML   = totalMins > 0 ? `<span class="bdg bdg-sky">${WorkOrderDetailPage._h(totalMins)}</span>` : '';

    /* Tid mot plan: samma rollspärr som vid full rendering (tidigare
       ritades blocket om utan spärr efter en tidsändring). */
    const planEl  = document.getElementById('ao-time-plan');
    if (planEl)  planEl.innerHTML  = canSeePrice ? this._timePlanBlock(ao) : '';

    const timelineEl = document.getElementById('ao-timeline');
    if (timelineEl)  timelineEl.innerHTML = this._renderTimeline(ao);

    const lonEl   = document.getElementById('ao-lonsam');
    if (lonEl)   lonEl.innerHTML   = this._renderLonsamhet(ao);

    this._refreshPricingCard(ao);

    // Öppna tidssektionen om det finns poster
    if (TimeService.getByAO(ao.id).length > 0) this._openSectionOf('ao-timeentries');

    Sidebar.updateBadges();
  },

  _refreshMaterialSection() {
    const ao = getAO(this.aoId);
    if (!ao) return;

    const listEl  = document.getElementById('ao-materials');
    if (listEl)  listEl.innerHTML  = this._renderMaterials(ao);

    const totEl   = document.getElementById('ao-mat-totals');
    if (totEl)   totEl.innerHTML   = (ao.materials||[]).length > 0 ? this._matTotals(ao) : '';

    const cntEl   = document.getElementById('ao-mat-count');
    if (cntEl)   cntEl.innerHTML   = (ao.materials||[]).length ? `<span class="bdg bdg-grey">${(ao.materials||[]).length} st</span>` : '';

    const lonEl   = document.getElementById('ao-lonsam');
    if (lonEl)   lonEl.innerHTML   = this._renderLonsamhet(ao);

    this._refreshPricingCard(ao);

    // Öppna materialsektionen om det finns material
    if ((ao.materials||[]).length > 0) this._openSectionOf('ao-materials');
  },

  _refreshPricingCard(ao) {
    const el = document.getElementById('ao-price');
    if (!el || !ao) return;
    const html = this._pricingCard(ao);
    if (html) el.outerHTML = html;
  },

  /* ── Stämpling: levande tidräknare (varje sekund, bara medan man är
     instämplad på just denna order och sidan visar den) ── */
  _startStampTimer() {
    this._stopStampTimer();
    this._stampInterval = setInterval(() => {
      const el = document.getElementById('ao-stamp-clock');
      if (!el || !state.stampActive || state.stampAoId !== this.aoId) { this._stopStampTimer(); return; }
      el.textContent = this._fmtElapsed(state.stampTimestamp);
    }, 1000);
  },

  _stopStampTimer() {
    if (this._stampInterval) { clearInterval(this._stampInterval); this._stampInterval = null; }
  },

  /* ── Åtgärder ──────────────────────────── */
  /* STATUS-ACK FIX (2026-11-12, scoped audit of fire-and-forget toasts —
     verified against the code before fixing): setStatus() ("Starta
     arbete", "Planera", "Till pool", "Pausa", status-modal) called
     WorkOrderService.setStatus() — a synchronous local mutation whose
     real server write goes through the fire-and-forget _syncAO() — and
     then IMMEDIATELY showed "Status: X". AO status gates billing
     (readyForInvoice() requires 'klar'), so a false success here is not
     cosmetic. Same opts.onSettled pattern as doSave() (commit 4078994):
     the local status change + re-render still happen immediately
     (optimistic UI), but the success toast waits for the server.
     STATUS-ROLLBACK FIX (2026-11-12): on a FINAL server rejection,
     WorkOrderService.setStatus()/markComplete() now themselves restore
     the pre-attempt status/completedAt/completedBy and refresh this view
     via Router.refreshCurrent() (see WorkOrderService.
     _rollbackStatusAttempt()) — no extra code needed here; this page only
     shows its own failure toast. When the status is not 'pågående' a SECOND write clears the
     substatus; the success toast waits for BOTH, and a final rejection
     of either shows a clear warning. Transient (non-final) callbacks are
     ignored, same rule as doSave(). */
  _statusAckTracker(expected, okMsg, failMsg) {
    let remaining = expected, failed = false, done = false;
    return function (r) {
      if (done || !r) return;
      if (r.ok) { remaining--; }
      else if (r.final) { failed = true; }
      else return; // transient
      if (failed) { done = true; showToast(failMsg); return; }
      if (remaining <= 0) { done = true; showToast(okMsg); }
    };
  },

  setStatus(status) {
    if (!Auth.require('ao_edit')) return;
    const ao = getAO(this.aoId);
    if (!ao) return;
    const clearSub = status !== 'pågående';
    const track = this._statusAckTracker(clearSub ? 2 : 1,
      `Status: ${statusLabel(status)}`,
      'Statusändringen kunde inte bekräftas av servern — kontrollera din anslutning och försök igen.');
    WorkOrderService.setStatus(this.aoId, status, { onSettled: track });
    if (clearSub) WorkOrderService.update(this.aoId, {substatus: ''}, { onSettled: track });
    this.render({ aoId: this.aoId });
    Sidebar.updateBadges();
  },

  setSubstatus(val) {
    if (!Auth.require('ao_edit')) return;
    WorkOrderService.update(this.aoId, {substatus: val});
    const ao = getAO(this.aoId);
    if (!ao) return;
    this.render({ aoId: this.aoId });
    const labels = {inväntar_material:'Inväntar material',inväntar_kund:'Inväntar kund',pausad:'Pausad',behöver_återbesök:'Behöver återbesök',blockerad:'Blockerad'};
    showToast(val ? 'Substatus: ' + (labels[val]||val) : 'Substatus borttaget');
  },

  markComplete() {
    // T3-B (D-03): ao_complete_own räcker för egen tilldelad AO (servern avgör).
    if (!WorkOrderService.aoCan('ao_complete_own') && !Auth.require('ao_complete')) return;
    const ao = getAO(this.aoId);
    if (!ao) return;
    const chkTotal = (ao.checklist||[]).length;
    const chkOkCnt = (ao.checklist||[]).filter(c=>c.done||c.avvikelse==='ok').length;
    const chkAvvCnt= (ao.checklist||[]).filter(c=>c.avvikelse==='avvikelse').length;
    const chkProgCnt = WorkOrderService.checklistCounts(ao.checklist || []).prog;
    const incomplete = chkTotal > 0 && (chkOkCnt + chkAvvCnt) < chkTotal;

    const doComplete = () => {
      const completedBy = state.currentUser
        ? `${state.currentUser.firstName} ${state.currentUser.lastName}`.trim()
        : '';
      /* STATUS-ACK FIX (2026-11-12): "Order markerad klar" visades
         tidigare synkront. Nu först efter serverbekräftelse av
         statusskrivningen (se setStatus() ovan för fullständig
         motivering — 'klar' styr faktureringsbarheten). */
      WorkOrderService.markComplete(this.aoId, completedBy, {
        onSettled: this._statusAckTracker(1, 'Order markerad klar',
          'Klarmarkeringen kunde inte bekräftas av servern — ordern är INTE säkert klarmarkerad. Kontrollera din anslutning och försök igen.')
      });
      this.render({ aoId: this.aoId });
      Sidebar.updateBadges();
    };

    if (incomplete) {
      Modal.open({
        title: 'Ofullständig checklista',
        body: `
          <div class="nbox" style="margin-bottom:12px;display:flex;gap:8px;align-items:flex-start;">${ic('alert-triangle',16)}<span>${chkOkCnt + chkAvvCnt} av ${chkTotal} checkpunkter är hanterade${chkProgCnt ? ` · ${chkProgCnt} pågår fortfarande` : ''}</span></div>
          <p style="font-size:13px;color:var(--mt);">Vill du ändå klarmarkera ordern?</p>`,
        buttons: [
          { label: 'Klarmarkera ändå', cls: 'btn bsu', onClick: () => { Modal.close(); doComplete(); } },
          { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
        ]
      });
    } else {
      Modal.confirm('Markera ordern som klar?', doComplete);
    }
  },

  openStatusModal() {
    const ao = getAO(this.aoId);
    if (!ao) return;
    const statuses = ['nytt','pool','planerad','pågående','klar','avbruten'];
    Modal.open({
      title: 'Ändra status',
      body: statuses.map(s => `
        <div class="crow" onclick="Modal.close();setTimeout(()=>WorkOrderDetailPage.setStatus('${s}'),50);">
          ${sbdg(s)}
          <span style="font-size:13px;">${ao.status===s?ic('check',14):''}</span>
        </div>`).join('')
    });
  },

  openReactivateModal() {
    const ao = getAO(this.aoId);
    if (!ao) return;
    Modal.open({
      title: `${ic('rotate-ccw',14)} Återaktivera arbetsorder`,
      body: `
        <p style="font-size:13px;color:var(--mt);margin-bottom:14px;">Ordern är avbruten. Välj ny status att återaktivera till:</p>
        <div class="fg">
          <label>Ny status</label>
          <select id="reactivate-status" style="font-size:14px;">
            <option value="nytt">Nytt</option>
            <option value="planerad">Planerad</option>
            <option value="pågående">Pågående</option>
          </select>
        </div>`,
      buttons: [
        { label: `${ic('rotate-ccw',12)} Återaktivera`, cls: 'btn bsu', onClick: () => this._doReactivate() },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _doReactivate() {
    const newStatus = document.getElementById('reactivate-status')?.value || 'nytt';
    // STATUS-ACK FIX (2026-11-12): samma mönster som setStatus() ovan.
    WorkOrderService.setStatus(this.aoId, newStatus, {
      onSettled: this._statusAckTracker(1, `Arbetsorder återaktiverad – ${statusLabel(newStatus)}`,
        'Återaktiveringen kunde inte bekräftas av servern — kontrollera din anslutning och försök igen.')
    });
    Modal.close();
    this.render({ aoId: this.aoId });
    Sidebar.updateBadges();
  },

  openArchiveModal() {
    Modal.open({
      title: `${ic('archive',14)} Arkivera arbetsorder`,
      body: `<p style="font-size:13px;color:var(--mt);">Ordern arkiveras och syns inte i ordinarie lista. Du kan återställa den när som helst från Arkiverade-vyn.</p>`,
      buttons: [
        { label: `${ic('archive',12)} Arkivera`, cls: 'btn bp', onClick: () => {
          WorkOrderService.archive(this.aoId, { onSettled: this._flagToast('Arbetsorder arkiverad', 'Arkiveringen') });
          Modal.close();
          showToast('Arkiverar…');
          Sidebar.updateBadges();
          Router.showPage('pg-ao');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  openDeleteModal() {
    Modal.open({
      title: `${ic('trash',14)} Ta bort arbetsorder`,
      body: `<p style="font-size:13px;color:var(--mt);">Ordern hamnar i papperskorgen och raderas automatiskt efter 14 dagar. Du kan återställa den dessförinnan.</p>`,
      buttons: [
        { label: `${ic('trash',12)} Ta bort`, cls: 'btn bd', onClick: () => {
          WorkOrderService.softDelete(this.aoId, { onSettled: this._flagToast('Arbetsorder flyttad till papperskorgen', 'Borttagningen') });
          Modal.close();
          showToast('Tar bort…');
          Sidebar.updateBadges();
          Router.showPage('pg-ao');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  /* Bekräftelse först efter serverns svar; vid avslag har tjänsten redan
     återställt AO:n lokalt, så vyn ritas om och felet visas. */
  _flagToast(okMsg, what) {
    return (r) => {
      if (r.ok) { showToast(okMsg); return; }
      showToast(what + ' nekades av servern' + (r.error ? ' (' + r.error + ')' : '') + ' — ingen ändring sparades.', 7000);
      if (typeof Router !== 'undefined' && Router.currentPage === 'pg-ao-detail' && this.aoId) this.render({ aoId: this.aoId });
      else if (typeof Router !== 'undefined' && Router.currentPage === 'pg-ao' && typeof WorkOrdersPage !== 'undefined') WorkOrdersPage.render();
    };
  },

  _restoreFromArchive(id) {
    WorkOrderService.restoreFromArchive(id || this.aoId, { onSettled: this._flagToast('Återställd från arkiv', 'Återställningen') });
    showToast('Återställer…');
    if (id && id !== this.aoId) return;
    this.render({ aoId: this.aoId });
  },

  _restoreFromTrash(id) {
    WorkOrderService.restoreFromTrash(id || this.aoId, { onSettled: this._flagToast('Återställd från papperskorg', 'Återställningen') });
    showToast('Återställer…');
    if (id && id !== this.aoId) return;
    this.render({ aoId: this.aoId });
  },

  _confirmPermanentDelete(id) {
    const targetId = id || this.aoId;
    Modal.open({
      title: `${ic('trash-2',14)} Radera permanent`,
      body: `<p style="font-size:13px;color:var(--mt);">Arbetsorder <strong>${targetId}</strong> raderas permanent och kan inte återställas.</p>`,
      buttons: [
        { label: `${ic('trash-2',12)} Radera permanent`, cls: 'btn bd', onClick: () => {
          WorkOrderService.permanentDelete(targetId, { onSettled: this._flagToast('Arbetsorder raderad permanent', 'Den permanenta raderingen') });
          Modal.close();
          showToast('Raderar…');
          Sidebar.updateBadges();
          Router.showPage('pg-ao');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  /* CLOCK-ACK AUDIT (2026-11-12, verified against the code): this is a
     SEPARATE clock-in/out UI from MyJobsPage. Clock-IN here does NOT
     write anything to the server — TimeService.clockIn() only sets
     state.stampActive/stampTs/stampAoId (read back exclusively from
     localStorage in state.js; there is no server-side stamp record), and
     unlike MyJobsPage.clockIn() this path writes NO AO log note via
     _syncAO(). There is therefore no server write to wait for: "Inklockat"
     truthfully describes the (purely local) state change and is kept
     as-is. The real server write happens at clock-OUT (the time entry) —
     see _openClockOutModal() below, which IS now ACK-gated. */
  toggleStamp() {
    if (!Auth.require('ao_time')) return;
    if (state.stampActive && state.stampAoId !== this.aoId) {
      showToast('Du är inklockat på ett annat jobb');
      return;
    }
    if (!state.stampActive) {
      const ok = TimeService.clockIn(this.aoId);
      if (!ok) { showToast('Kunde inte klocka in — kontrollera din behörighet.'); return; }
      showToast('Inklockat');
      this.render({ aoId: this.aoId });
    } else {
      this._openClockOutModal();
    }
  },

  _openClockOutModal() {
    if (!Auth.require('ao_time')) return;
    const mins = Math.round((Date.now() - state.stampTimestamp) / 60000);
    const ao = getAO(this.aoId);
    const aoPgId = ao ? (ao.priceGroupId || '') : '';
    const pgOptions = TimeService.priceGroupOptions(aoPgId, this.aoId); // T4-B (D-11)
    Modal.open({
      title: 'Stämpla ut',
      body: `
        <div class="ibox" style="margin-bottom:12px;display:flex;gap:8px;align-items:center;">${ic('clock',14)}<span>Tid: ${TimeService.fmtDuration(mins)}</span></div>
        <div class="fg"><label>Prisgrupp</label>
          <select id="co-pg"><option value="">— Ingen —</option>${pgOptions}</select></div>
        <div class="fg"><label>Vad utfördes? <span style="color:var(--rd)">*</span></label>
          <textarea id="co-comment" rows="2" placeholder="Beskriv vad som gjordes…"></textarea></div>
        <div class="fg">
          <label><input type="checkbox" id="co-billable" checked style="width:16px;height:16px;margin-right:6px;">Debiterbar tid</label>
        </div>`,
      buttons: [
        /* CLOCK-OUT-ACK FIX (2026-11-12, independent-reviewer finding,
           verified against the code before fixing): "Klocka ut" called
           TimeService.clockOut() and IMMEDIATELY closed the modal and
           showed "Utloggad", with no connection to whether the time entry
           (created inside clockOut() via AOTimeSyncService.createTime())
           was accepted by the server. This path writes NO AO log note
           (no _syncAO() call), so there is exactly ONE server write to
           confirm: the time entry, via clockOut()'s new opts.onSettled.
           UX decision (differs slightly from doSave() on purpose): the
           local clock-out has ALREADY happened synchronously inside
           clockOut() (stampActive=false) and cannot be retried from this
           dialog, so keeping the modal open after a final rejection would
           offer nothing actionable. The button shows "Sparar…" while the
           first server attempt is in flight; the modal then closes on ANY
           settled outcome, with an honest message: success only on a real
           ACK, "köad, ej bekräftad" on a transient first attempt (entry
           stays in the durable outbox and is retried), and a clear error
           on a final rejection. The local clock-out is not rolled back —
           same documented convention as MyJobsPage (commit 4078994). */
        { label: 'Stämpla ut', cls: 'btn bsu', onClick: (ev) => {
          const comment = document.getElementById('co-comment')?.value.trim();
          if (!comment) { showToast('Beskriv vad som gjordes'); return; }
          const btnEl = ev && ev.currentTarget;
          let closed = false;
          const closeOnce = () => {
            if (closed) return false;
            closed = true;
            Modal.close();
            this.render({ aoId: this.aoId });
            return true;
          };
          const entry = TimeService.clockOut({
            priceGroupId: document.getElementById('co-pg')?.value || '',
            comment,
            billable: document.getElementById('co-billable')?.checked !== false,
            onSettled: (r) => {
              if (!r) return;
              if (r.ok) {
                if (!closeOnce()) { showToast('Tidposten är nu bekräftad av servern'); return; }
                showToast('Utloggad — tid sparad');
              } else if (r.final) {
                closeOnce();
                showToast('Utloggad, men tidposten kunde INTE sparas av servern' + (r.error ? ' (' + r.error + ')' : '') + ' — registrera tiden manuellt.');
              } else if (r.queued) {
                closeOnce();
                showToast('Utloggad — sparar tiden… (ej bekräftad av servern ännu, skickas automatiskt när anslutningen fungerar)');
              }
            }
          });
          if (!entry) { showToast('Kunde inte klocka ut — kontrollera din behörighet.'); return; }
          if (!closed && btnEl) { btnEl.disabled = true; btnEl.innerHTML = 'Sparar…'; }
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  /* AO-CHECKLIST-PROGRESS-HOTFIX R1 — ROTORSAK (spårad, inte antagen):
     "Lista"-raden i AO-metadatan (ao-info-list) och Checklista-sektionens
     egen rubrik-badge (#ao-chk-counter) beräknade TIDIGARE samma sak
     ("X/Y OK", identisk villkorslogik: `c.done||c.avvikelse==='ok'` för
     OK, `c.avvikelse==='avvikelse'` för avvikelser, samma bdg-färglogik)
     på TVÅ HELT SEPARATA STÄLLEN i koden — en gång i `_renderFull()`
     (chkOk/chkAvv/chkBadge, ovan) och en gång rakt inne i denna funktion.
     Vid en FULL sidladdning/render var de därför alltid synkroniserade.
     Men efter en checklista-mutation (t.ex. `toggleChecklistItem()`,
     `setChecklistAvvikelse()`) anropades ENDAST denna funktion, och den
     skrev ENDAST till `#ao-chk-counter` (Checklista-sektionens egen
     badge). "Lista"-radens `<span>` i metadata-kortet hade INGET id
     alls — det fanns alltså ingen DOM-hake för någon partiell
     uppdatering att träffa, och den förblev frusen vid vad den råkade
     visa vid senaste FULLA render (`render()`/sidbyte/omladdning) tills
     nästa sådan inträffade. Detta var alltså BÅDE "duplicerad
     beräkningslogik" OCH "reagerar inte på mutation" samtidigt — inte
     två separata fel.
     FIXEN: EN delad `_checklistBadgeHtml(ao)` (nedan) är nu den ENDA
     platsen som beräknar och genererar detta badge-HTML — `_renderFull()`
     anropar den vid FULL render, och denna funktion anropar SAMMA
     funktion och skriver resultatet till BÅDA DOM-noderna
     (`#ao-chk-counter` OCH det nu tillagda `#ao-chk-badge-meta`) vid
     VARJE mutation. Ingen ny räknare, ingen egen delstat — en enda
     källa, två DOM-speglingar av den, båda uppdaterade tillsammans. */
  /* V3 2026-11-26: samma enda källa, nu som tydlig framstegsindikator i
     "Uppdrag & utförande": "2 av 4 klara" (klara = utförda + avvikelse,
     samma definition som Nästa steg och klarmarkeringens kontroll),
     stapel med segment per läge och hur många som är kvar. */
  _checklistBadgeHtml(ao) {
    const k = WorkOrderService.checklistCounts(ao.checklist || []);
    if (!k.total) return '';
    const handled = k.done + k.avv;
    const left = k.total - handled;
    const pct = (n) => Math.round((n / k.total) * 1000) / 10;
    const tone = handled === k.total ? (k.avv ? 'warn' : 'ok') : 'info';
    const leg = [];
    if (k.done) leg.push(`<span class="aod-lg lg-done"><i></i>${k.done} utförd${k.done === 1 ? '' : 'a'}</span>`);
    if (k.prog) leg.push(`<span class="aod-lg lg-prog"><i></i>${k.prog} pågår</span>`);
    if (k.avv)  leg.push(`<span class="aod-lg lg-avv"><i></i>${k.avv} avvikelse${k.avv === 1 ? '' : 'r'}</span>`);
    if (k.rest) leg.push(`<span class="aod-lg lg-rest"><i></i>${k.rest} ej påbörjad${k.rest === 1 ? '' : 'e'}</span>`);
    return `<div class="aod-chkp tone-${tone}" title="Utförda: ${k.done} · Pågående: ${k.prog} · Avvikelse: ${k.avv} · Ej påbörjade: ${k.rest}">
        <div class="aod-chkp-top"><span class="aod-chkp-n"><b>${handled} av ${k.total}</b> klara</span><span class="aod-chkp-left">${left ? left + ' kvar' : 'Alla punkter hanterade'}</span></div>
        <div class="aod-chkp-bar" role="progressbar" aria-label="Checklista" aria-valuemin="0" aria-valuemax="${k.total}" aria-valuenow="${handled}" aria-valuetext="${handled} av ${k.total} klara">
          <i class="seg-done" style="width:${pct(k.done)}%"></i><i class="seg-avv" style="width:${pct(k.avv)}%"></i><i class="seg-prog" style="width:${pct(k.prog)}%"></i>
        </div>
        <div class="aod-chkp-leg">${leg.join('')}</div>
      </div>`;
  },

  /* Avvikelser i checklistan, samlade under listan (texten finns även på
     raden) så att arbetsledaren ser dem utan att läsa varje punkt. */
  _avvikelseSummary(ao) {
    const avv = (ao.checklist || []).filter(c => WorkOrderService.checklistStatus(c) === 'avvikelse');
    if (!avv.length) return '';
    return `<div class="aod-avv" role="note">
        <div class="aod-avv-h">${ic('alert-triangle',14)} ${avv.length} avvikelse${avv.length === 1 ? '' : 'r'} rapporterad${avv.length === 1 ? '' : 'e'}</div>
        <ul>${avv.map(c => `<li><strong>${esc(c.text)}</strong>${c.avvikelseComment ? ` — ${esc(c.avvikelseComment)}` : ''}${c.avvikelseBy ? ` <span class="aod-muted">(${esc(c.avvikelseBy)})</span>` : ''}</li>`).join('')}</ul>
      </div>`;
  },

  _updateChecklistCounter(ao) {
    const html = this._checklistBadgeHtml(ao);
    const sectionEl = document.getElementById('ao-chk-counter');
    if (sectionEl) sectionEl.innerHTML = html;
    const metaEl = document.getElementById('ao-chk-badge-meta');
    if (metaEl) metaEl.innerHTML = html;
    const avvEl = document.getElementById('ao-chk-avv');
    if (avvEl) avvEl.innerHTML = this._avvikelseSummary(ao);
    const qEl = document.getElementById('ao-qbar-chk');
    if (qEl) qEl.textContent = this._qbarChkLabel(WorkOrderService.checklistCounts(ao.checklist || []));
  },

  /* ── Checklista ────────────────────────── */
  openAddChecklist() {
    if (!Auth.require('ao_checklist')) return;
    Modal.open({
      title: 'Lägg till checkpunkt',
      body: `
        <div class="fg"><label>Rubrik <span style="color:var(--rd)">*</span></label>
          <input id="cl-text" placeholder="T.ex. Inspektera takbrunn…"
            onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('cl-desc')?.focus();}"></div>
        <div class="fg"><label>Beskrivning (valfritt)</label>
          <textarea id="cl-desc" rows="2" placeholder="Mer information om vad som ska kontrolleras…"></textarea></div>`,
      buttons: [
        { label: 'Lägg till', cls: 'btn bp', onClick: () => this.saveChecklist() },
        { label: 'Avbryt',   cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('cl-text')?.focus(), 80);
  },

  saveChecklist() {
    const text = document.getElementById('cl-text')?.value.trim();
    if (!text) { showToast('Rubrik krävs'); return; }
    const desc = document.getElementById('cl-desc')?.value.trim() || '';
    const ao = getAO(this.aoId);
    if (!ao) return;
    if (WorkOrderService._chkV2 === true) {
      /* Atomiskt per punkt (samma RPC som statusändringarna) — skriver inte
         över en samtidig ändring från någon annan. Punkten visas först när
         servern bekräftat. */
      const itemId = 'c' + Date.now();
      const btn = document.querySelector('.modal-overlay.open .btn.bp');
      if (btn) btn.disabled = true;
      showToast('Sparar…');
      WorkOrderService.checklistAction(this.aoId, itemId, 'add', { text, description: desc }).then((r) => {
        if (btn) btn.disabled = false;
        if (!r.ok) { showToast(r.error); return; }
        Modal.close();
        this._afterChk(this.aoId, null);
        this._openSectionOf('ao-checklist');
        showToast('Checkpunkt tillagd');
      });
      return;
    }
    if (!ao.checklist) ao.checklist = [];
    ao.checklist.push({ id: 'c' + Date.now(), text, description: desc, avvikelse: null, done: false });
    WorkOrderService.update(this.aoId, { checklist: ao.checklist }, this._ackOpts('Checkpunkt tillagd', 'Checkpunkten kunde inte sparas'));
    Modal.close();
    const aoUp = getAO(this.aoId);
    if (aoUp) {
      document.getElementById('ao-checklist').innerHTML = this._renderChecklist(aoUp);
      this._updateChecklistCounter(aoUp);
      this._openSectionOf('ao-checklist');
    }
    showToast('Sparar…');
  },

  /* AO-CHECKLIST-AUTOSTART R1.2 — ATOMISK CHECKLISTMUTATION (se RAPPORT
     §1-3 för fullständig spårning av rotorsaken). R1.1 skrev checklistan
     genom att mutera klientens EGEN, potentiellt inaktuella kopia av
     HELA AO-objektet och sedan skriva HELA `workOrders`-arrayen tillbaka
     (WorkOrderService.update()). Två klienter som löste OLIKA
     checklistpunkter på SAMMA, fortfarande "Nytt"-AO nästan samtidigt
     (utan en mellanliggande DataSync-poll) kunde därför tyst radera
     varandras ändring — "sista skrivaren vinner" på en HEL array.
     FIXEN: denna metod anropar nu den atomiska, radlåsta servervägen
     (WorkOrderService.resolveChecklistItemAtomic() ->
     work-order-checklist-resolve Edge Function ->
     work_order_checklist_resolve() RPC, SECURITY DEFINER,
     `SELECT ... FOR UPDATE`) — mutationen sker mot den LÅSTA, FÄRSKASTE
     serverraden, identifierad via checklistpunktens STABILA id (inte
     array-index), aldrig genom att skriva över hela arrayen med
     klientens egen kopia. Lokal state uppdateras ENDAST från det
     bekräftade serversvaret — vid fel lämnas UI:t helt oförändrat,
     ALDRIG en "låtsad framgång". Auto-start-beslutet (samma semantik
     som R1/R1.1: endast från ett legitimt ostartat läge, aldrig bakåt,
     aldrig en avslutad order återöppnad) fattas nu ATOMISKT INUTI
     samma serverfunktion, mot den låsta statusen — inte längre via ett
     separat klientanrop till autoStartFromChecklist(). */
  async setAvvikelse(idx, status) {
    /* Äldre anrop (index + 'ok'|'avvikelse'): samma beteende som förut —
       klick på redan valt läge återställer. Går nu via chkAction(). */
    const ao = getAO(this.aoId);
    if (!ao || !ao.checklist || !ao.checklist[idx]) return;
    const c = ao.checklist[idx];
    const st = WorkOrderService.checklistStatus(c);
    if (status === 'avvikelse') return this.chkAction(c.id, st === 'avvikelse' ? 'reset' : 'avvikelse');
    return this.chkAction(c.id, st === 'utford' ? 'reset' : 'done');
  },

  /* En checklisthandling på punkten med stabilt id. Lokal state ändras
     först när servern bekräftat; under tiden visas raden som "Sparar…".
     Dubbelklick ignoreras (busy per punkt). AO:ns status rörs inte
     (beslut 2026-11-23) — men om en äldre server ändå ändrat den ritas
     hela sidan om så att det syns. */
  async chkAction(itemId, action) {
    const ao = getAO(this.aoId);
    if (!ao) return;
    const c = (ao.checklist || []).find((x) => x.id === itemId);
    if (!c && action !== 'add') return;
    if (this._chkBusy[itemId]) return;
    if (!WorkOrderService.canChecklistAction(c, action)) {
      showToast(WorkOrderService.checklistErrorText(Auth.can('ao_checklist') || Auth.can('ao_edit') ? 'forbidden_other' : 'forbidden'));
      return;
    }
    if (action === 'avvikelse') { this._openAvvikelseModal(ao.checklist.indexOf(c)); return; }
    if (action === 'remove') {
      const yes = await Modal.confirm(`Ta bort checkpunkten "${esc(c.text)}" från checklistan?`);
      if (!yes) return;
      if (WorkOrderService._chkV2 !== true) { this._removeCheckLegacy(itemId); return; }
    }
    const aoId = this.aoId;
    const statusBefore = ao.status;
    this._chkBusy[itemId] = true;
    this._afterChk(aoId, null);
    const r = await WorkOrderService.checklistAction(aoId, itemId, action);
    delete this._chkBusy[itemId];
    if (!r.ok) {
      showToast(r.error);
      if (r.code === 'item_not_found' && typeof DataSync !== 'undefined' && DataSync._poll) { try { DataSync._poll(); } catch (e) {} }
    } else {
      const msg = { start: 'Påbörjad', done: 'Utförd', reset: 'Återställd', remove: 'Checkpunkt borttagen' }[action];
      if (msg) showToast(msg);
    }
    this._afterChk(aoId, statusBefore);
  },

  _afterChk(aoId, statusBefore) {
    if (this.aoId !== aoId) return;
    const aoUp = getAO(aoId);
    if (!aoUp) return;
    if (statusBefore !== null && aoUp.status !== statusBefore) {
      this.render({ aoId });
      Sidebar.updateBadges();
      return;
    }
    const el = document.getElementById('ao-checklist');
    if (el) el.innerHTML = this._renderChecklist(aoUp);
    this._updateChecklistCounter(aoUp);
  },

  _openAvvikelseModal(idx) {
    const ao = getAO(this.aoId);
    if (!ao || !ao.checklist || !ao.checklist[idx]) return;
    const c = ao.checklist[idx];
    Modal.open({
      title: `${ic('alert-triangle',14)} Markera avvikelse`,
      body: `
        <div class="nbox" style="margin-bottom:12px;display:flex;gap:8px;align-items:flex-start;">${ic('clipboard-check',13)}<span>${esc(c.text)}</span></div>
        <div class="fg">
          <label>Kommentar <span style="color:var(--rd)">*</span></label>
          <textarea id="avv-comment" rows="3" placeholder="Beskriv avvikelsen – vad som är skadat, var och hur…">${esc(c.avvikelseComment||'')}</textarea>
        </div>
        <div class="fg">
          <label>Bild (valfri)</label>
          <input type="file" id="avv-img" accept="image/*" onchange="WorkOrderDetailPage._previewAvvImg(this)">
          <div id="avv-img-preview" style="margin-top:6px;">
            ${isSafeImageDataUrl(c.avvikelseImage) ? `<img src="${c.avvikelseImage}" style="max-width:100%;border-radius:8px;max-height:120px;object-fit:cover;">` : ''}
          </div>
        </div>`,
      buttons: [
        { label: 'Spara avvikelse', cls: 'btn bd', onClick: () => {
          const comment = document.getElementById('avv-comment')?.value.trim();
          if (!comment) { showToast('Kommentar krävs vid avvikelse'); return; }
          const imgInput = document.getElementById('avv-img');
          const file = imgInput && imgInput.files && imgInput.files[0];
          /* AO-CHECKLIST-AUTOSTART R1.2 (se RAPPORT §1-3): samma atomiska,
             race-säkra väg som setAvvikelse() ovan — mutationen sker
             server-sidigt mot den låsta, färskaste raden via checklist-
             punktens STABILA id (c.id, ur den redan hämtade `c` ovan),
             inte lokal mutation + generisk persist(). Auto-start beslutas
             ATOMISKT inuti samma serverfunktion. Vid fel: ingen lokal
             mutation, ingen "låtsad framgång" — modalen stängs bara vid
             bekräftad serverframgång. */
          const statusBefore = ao.status;
          const saveAvv = async (imageData) => {
            const okBtn = document.querySelector('.modal-overlay.open .btn.bd');
            if (okBtn) okBtn.disabled = true;
            showToast('Sparar…');
            const result = await WorkOrderService.checklistAction(this.aoId, c.id, 'avvikelse', { comment, image: imageData || '' });
            if (okBtn) okBtn.disabled = false;
            if (!result.ok) { showToast(result.error || 'Kunde inte spara avvikelsen'); return; }
            Modal.close();
            this._afterChk(this.aoId, statusBefore);
            showToast('Avvikelse sparad');
          };
          if (file) {
            /* Avvikelsebilden bäddas fortfarande in i checklistpunkten (EF-
               kontraktet för work-order-checklist-resolve oförändrat), men
               komprimeras först till 900px/JPEG 0.75 — en mobilbild på flera
               MB blir då ~100–200 kB i vift_workOrders i stället. */
            if (typeof WorkOrderImageService !== 'undefined') {
              WorkOrderImageService._resizeImage(file).then((dataUrl) => saveAvv(dataUrl || null));
            } else {
              const reader = new FileReader();
              reader.onload = (e) => saveAvv(e.target.result);
              reader.readAsDataURL(file);
            }
          } else {
            saveAvv(null);
          }
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('avv-comment')?.focus(), 80);
  },

  _previewAvvImg(input) {
    const file = input.files && input.files[0];
    const prev = document.getElementById('avv-img-preview');
    if (!file || !prev) return;
    const reader = new FileReader();
    reader.onload = function(e) {
      prev.innerHTML = `<img src="${e.target.result}" style="max-width:100%;border-radius:8px;max-height:120px;object-fit:cover;">`;
    };
    reader.readAsDataURL(file);
  },

  toggleCheck(idx) {
    /* Äldre anrop med index: utförd ↔ återställd via samma atomiska väg
       (tidigare lokal mutation + generisk persist() utan ACK). */
    const ao = getAO(this.aoId);
    const c = ao && ao.checklist && ao.checklist[idx];
    if (!c) return;
    return this.chkAction(c.id, WorkOrderService.checklistStatus(c) === 'utford' ? 'reset' : 'done');
  },

  removeCheck(idx) {
    const ao = getAO(this.aoId);
    const c = ao && ao.checklist && ao.checklist[idx];
    if (!c) return;
    return this.chkAction(c.id, 'remove');
  },

  /* Borttagning mot äldre server (utan atomisk remove): hela checklistan
     via AO-skrivvägen, med besked först efter serverns ACK och
     återställning vid avslag (G12-mönstret) — tidigare generisk persist()
     utan bekräftelse. */
  _removeCheckLegacy(itemId) {
    const ao = getAO(this.aoId);
    if (!ao) return;
    const next = (ao.checklist || []).filter((x) => x.id !== itemId);
    ao.checklist = next;
    WorkOrderService.update(this.aoId, { checklist: next }, this._ackOpts('Checkpunkt borttagen', 'Checkpunkten kunde inte tas bort'));
    this._afterChk(this.aoId, null);
    showToast('Sparar…');
  },

  /* ── Tid ───────────────────────────────── */
  openAddTime() {
    /* V22: ao_time (registrera egen tid) ELLER payroll_manage (registrera åt
       annan, löneadministrativt) — inte längre bara ao_time. Klocka in/ut har
       ett eget, separat ao_time-krav (toggleStamp/_openClockOutModal). */
    if (!Auth.canAny(['ao_time','payroll_manage'])) { showToast('Du saknar behörighet för den åtgärden'); return; }
    const ao = getAO(this.aoId);
    const aoPgId = ao ? (ao.priceGroupId || '') : '';
    const pgOptions = TimeService.priceGroupOptions(aoPgId, this.aoId); // T4-B (D-11)
    Modal.open({
      title: 'Registrera tid',
      body: `
        ${(typeof Auth !== 'undefined' && Auth.can('payroll_manage')) ? `
        <div class="fg"><label>Utförd av <span style="color:var(--sky);font-size:9px;">Lönebehörighet</span></label>
          <select id="t-staff">
            <option value="">— Inloggad användare (${state.currentUser ? state.currentUser.firstName : ''}) —</option>
            ${(state.staff||[]).filter(s=>s.active).map(s=>
              `<option value="${s.id}:${esc(s.firstName)} ${esc(s.lastName)}">${esc(s.firstName)} ${esc(s.lastName)}${s.title?' – '+esc(s.title):''}</option>`
            ).join('')}
          </select>
        </div>` : ''}
        <div class="g2">
          <div class="fg"><label>Datum</label><input type="date" id="t-date" value="${tdy()}"></div>
          <div class="fg"><label>Prisgrupp</label>
            <select id="t-pg"><option value="">— Ingen —</option>${pgOptions}</select></div>
        </div>
        <div class="g2">
          <div class="fg"><label>Starttid</label><input type="time" id="t-start" value="08:00"></div>
          <div class="fg"><label>Sluttid</label><input type="time" id="t-end" value="16:00"></div>
        </div>
        <div class="fg"><label>Kommentar</label><textarea id="t-comment" rows="2" placeholder="Vad utfördes?"></textarea></div>
        <div class="fg"><label><input type="checkbox" id="t-billable" checked style="width:16px;height:16px;margin-right:6px;">Debiterbar tid</label></div>`,
      buttons: [
        { label: 'Spara tid', cls: 'btn bp', onClick: () => this._saveTimeEntry(null) },
        { label: 'Avbryt',    cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  openEditTime(entryId) {
    const t = (state.timeEntries||[]).find(x=>x.id===entryId);
    if (!t) return;
    const guard = TimeService._guardMutation(t);
    if (!guard.ok) { showToast(guard.error); return; }
    const pgOptions = TimeService.priceGroupOptions(t.priceGroupId, t.aoId); // T4-B (D-11)
    Modal.open({
      title: 'Redigera tid',
      body: `
        <div class="g2">
          <div class="fg"><label>Datum</label><input type="date" id="t-date" value="${t.date}"></div>
          <div class="fg"><label>Prisgrupp</label>
            <select id="t-pg"><option value="">— Ingen —</option>${pgOptions}</select></div>
        </div>
        <div class="g2">
          <div class="fg"><label>Starttid</label><input type="time" id="t-start" value="${t.startStr}"></div>
          <div class="fg"><label>Sluttid</label><input type="time" id="t-end" value="${t.endStr}"></div>
        </div>
        <div class="fg"><label>Kommentar</label><textarea id="t-comment" rows="2">${esc(t.comment||'')}</textarea></div>
        <div class="fg"><label><input type="checkbox" id="t-billable" ${t.billable?'checked':''} style="width:16px;height:16px;margin-right:6px;">Debiterbar tid</label></div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: (ev) => this._saveTimeEntry(entryId, ev) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _saveTimeEntry(existingId, ev) {
    const date  = document.getElementById('t-date')?.value;
    const start = document.getElementById('t-start')?.value;
    const end   = document.getElementById('t-end')?.value;
    if (!date || !start || !end) { showToast('Datum och tider krävs'); return; }
    const [sh,sm] = start.split(':').map(Number);
    const [eh,em] = end.split(':').map(Number);
    if ((eh*60+em) <= (sh*60+sm)) { showToast('Sluttid måste vara efter starttid'); return; }
    const data = {
      date,
      startStr:    start,
      endStr:      end,
      priceGroupId:document.getElementById('t-pg')?.value || '',
      comment:     document.getElementById('t-comment')?.value.trim() || '',
      billable:    document.getElementById('t-billable')?.checked !== false
    };
    const staffSel = document.getElementById('t-staff')?.value || '';
    const [overrideStaffId, overrideStaffName] = staffSel ? staffSel.split(':') : ['', ''];
    if (existingId) {
      if (overrideStaffId) { data.staffId = overrideStaffId; data.staffName = overrideStaffName; }
      /* I4 (2026-11-12): same discipline as M1's doSave() and clock-out —
         "Tid uppdaterad" only after the server's ACK; a final rejection
         rolls the entry back (TimeService.update), keeps the dialog open
         with the typed values and shows the real error; a transient first
         attempt says "köad, ej bekräftad". */
      const btnEl = ev && ev.currentTarget;
      const origLabel = btnEl ? btnEl.innerHTML : '';
      let settled = false, closed = false;
      const resetBtn = () => { if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = origLabel; } };
      const result = TimeService.update(existingId, data, {
        onSettled: (r) => {
          settled = true;
          this._refreshTimeSection();
          if (r.ok) {
            if (closed) { showToast('Tidsändringen är nu bekräftad av servern'); return; }
            closed = true;
            Modal.close();
            showToast('Tid uppdaterad');
          } else {
            if (!closed) resetBtn();
            showToast('Tiden kunde INTE sparas' + (r.error ? ' (' + r.error + ')' : '') + ' — ändringen är ångrad.' + (closed ? '' : ' Dina uppgifter finns kvar i formuläret, försök igen.'), 7000);
          }
        },
        onFirstAttempt: (first) => {
          if (settled || !first || first.ok || first.final) return;
          closed = true;
          Modal.close();
          this._refreshTimeSection();
          showToast('Sparar tiden… ej bekräftad av servern ännu — skickas automatiskt när anslutningen fungerar.', 6000);
        }
      });
      if (!result.ok) { showToast(result.error); return; }
      if (!settled && !closed && btnEl) { btnEl.disabled = true; btnEl.innerHTML = 'Sparar…'; }
      return;
    } else {
      const result = TimeService.saveManual({ ...data, aoId: this.aoId, staffId: overrideStaffId || undefined, staffName: overrideStaffName || undefined }, {
        onSettled: (r) => {
          this._refreshTimeSection();
          if (r.ok) showToast('Tid registrerad');
          else showToast('Tiden kunde INTE sparas' + (r.error ? ' (' + r.error + ')' : '') + ' — posten är borttagen, registrera den igen.', 7000);
        },
        onFirstAttempt: (first) => {
          if (first && !first.ok && !first.final) showToast('Sparar tiden… ej bekräftad av servern ännu — skickas automatiskt när anslutningen fungerar.', 6000);
        }
      });
      if (!result.ok) { showToast(result.error); return; }
      showToast('Sparar tiden…');
    }
    Modal.close();
    this._refreshTimeSection();
  },

  deleteTime(entryId) {
    Modal.confirm('Ta bort tidspost?', () => {
      const result = TimeService.delete(entryId, {
        onSettled: (r) => {
          this._refreshTimeSection();
          if (r.ok) showToast('Tidspost borttagen');
          else showToast('Borttagningen nekades' + (r.error ? ' (' + r.error + ')' : '') + ' — posten finns kvar.', 7000);
        },
        onFirstAttempt: (first) => {
          if (first && !first.ok && !first.final) showToast('Borttagningen väntar på anslutning — skickas automatiskt.', 6000);
        }
      });
      if (!result.ok) { showToast(result.error); return; }
      this._refreshTimeSection();
      showToast('Tar bort…');
    });
  },

  /* ── Hantera personal ──────────────────── */
  manageStaff(aoId) {
    if (!Auth.require('ao_edit')) return;
    const ao = getAO(aoId);
    if (!ao) return;

    const activeStaff = (state.staff || []).filter(s => s.active);
    const current = ao.staff || [];
    const currentResp = ao.responsibleStaffId || '';

    const staffRows = activeStaff.map(s => {
      const role = (state.roles||[]).find(r => r.id === s.role);
      return `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;border-bottom:1px solid var(--br);">
        <input type="checkbox" id="smcb-${esc(s.id)}" ${current.includes(s.id)?'checked':''}>
        <div style="flex:1;">
          <span style="font-size:13px;font-weight:600;">${esc(s.firstName)} ${esc(s.lastName)}</span>
          <span style="font-size:11px;color:var(--mt);margin-left:4px;">${role?esc(role.label):esc(s.role||'')}</span>
        </div>
      </label>`;
    }).join('');

    const respOpts = `<option value="">Ingen ansvarig</option>` +
      activeStaff.map(s =>
        `<option value="${esc(s.id)}" ${s.id===currentResp?'selected':''}>${esc(s.firstName)} ${esc(s.lastName)}</option>`
      ).join('');

    const body = `
      <div style="margin-bottom:14px;">
        <div style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Tilldelad personal</div>
        ${staffRows}
      </div>
      <div class="fg" style="margin-bottom:14px;">
        <label>Ansvarig</label>
        <select id="sm-resp">${respOpts}</select>
      </div>
      <div style="font-size:11px;color:var(--mt);">Dialogen ändrar bara personal och ansvarig. Datum och status ändras inte — använd ”Ta bort datum” eller ”Släpp till öppen pool” i menyn.</div>`;

    Modal.open({
      title: `${ic('users',15)} Hantera personal — ${esc(ao.id)}`,
      body,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => WorkOrderDetailPage._saveStaff(aoId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _saveStaff(aoId) {
    const ao = getAO(aoId);
    if (!ao) return;

    const activeStaff = (state.staff || []).filter(s => s.active);
    const selectedIds = activeStaff
      .filter(s => { const cb = document.getElementById(`smcb-${s.id}`); return cb && cb.checked; })
      .map(s => s.id);
    const responsibleId = (document.getElementById('sm-resp') || {}).value || '';

    // If responsible not in selected staff, add them
    if (responsibleId && !selectedIds.includes(responsibleId)) {
      selectedIds.push(responsibleId);
    }

    /* T3-B (AP-FEL-1, AP-D): bara personal och ansvarig sparas. Loggpost, notis och
       push skickas först när servern bekräftat, och bara för personal som FAKTISKT
       lades till (aldrig för borttagen eller oförändrad personal, ingen falsk notis). */
    const self = this;
    let diff = null;
    const ack = this._ackOpts('Personal uppdaterad', 'Personaländringen kunde inte sparas');
    diff = WorkOrderService.updateStaff(aoId, { staffIds: selectedIds, responsibleStaffId: responsibleId }, {
      onSettled: (r) => {
        ack.onSettled(r);
        if (!r || !r.ok || !diff || !diff.added.length) return;
        const cur = getAO(aoId) || ao;
        const names = diff.added.map(id => { const s = getStaff(id); return s ? s.firstName + ' ' + s.lastName : id; }).join(', ');
        ActivityService.log('staff_assigned', `Personal tilldelad ${aoId}: ${names}`, { workOrderId: aoId });
        if (typeof NotificationsService !== 'undefined') {
          diff.added.forEach(id => { NotificationsService.push(id, 'ao_assigned', `Du har tilldelats ${aoId}: ${cur.title || aoId}`, { aoId }); });
        }
        /* V45: riktig Web Push till faktiskt tillagd personal — fire-and-forget. */
        if (typeof PushService !== 'undefined') {
          PushService.notifyStaffAssigned(cur, diff.added).catch(e => console.warn('[WorkOrderDetailPage] notifyStaffAssigned fel:', e));
        }
        if (self.aoId === aoId) { try { self.render({ aoId }); } catch (e) {} }
      }
    });
    Modal.close();
    WorkOrderDetailPage.render({ aoId });
    showToast('Sparar…');
    Sidebar.updateBadges();
  },

  /* T3-B (AP-G): "Släpp till öppen pool" — uttrycklig åtgärd med bekräftelse som
     namnger personalen. Tar bort personal, ansvarig och datum, status pool. */
  releaseToPool() {
    if (!Auth.require('ao_edit')) return;
    const ao = getAO(this.aoId);
    if (!ao) return;
    const names = (ao.staff || []).map(id => { const s = getStaff(id); return s ? s.firstName + ' ' + s.lastName : id; });
    const msg = 'Släpp ' + (ao.displayNumber || ao.id) + ' till öppen pool?' + (names.length ? ' Personal som tas bort: ' + names.join(', ') + '.' : '') + (ao.scheduledDate ? ' Datumet ' + ao.scheduledDate + ' tas bort.' : '') + ' Fältpersonal med behörighet kan sedan ta jobbet.';
    Modal.confirm(msg, () => {
      WorkOrderService.releaseToPool(ao.id, this._ackOpts('Släppt till öppen pool', 'Ordern kunde inte släppas till poolen'));
      this.render({ aoId: ao.id });
      showToast('Sparar…');
    });
  },

  /* T3-B (AP-G): "Ta bort datum" — rensar bara utförandedatumet. */
  removeSchedule() {
    if (!Auth.require('ao_edit')) return;
    const ao = getAO(this.aoId);
    if (!ao || !ao.scheduledDate) return;
    Modal.confirm('Ta bort datumet ' + ao.scheduledDate + '? Personal, ansvarig och status ändras inte.', () => {
      WorkOrderService.removeSchedule(ao.id, this._ackOpts('Datumet borttaget', 'Datumet kunde inte tas bort'));
      this.render({ aoId: ao.id });
      showToast('Sparar…');
    });
  },

  /* ── Redigera AO ───────────────────────── */
  openEdit() {
    const ao = getAO(this.aoId);
    if (!ao) return;
    const cuOptions = (state.customers||[]).map(c =>
      `<option value="${c.id}" ${ao.customerId===c.id?'selected':''}>${esc(CustomerService.displayName(c))}</option>`
    ).join('');
    /* V51B ARBETSORDER §11 — samma särskild-adress-togglemönster som
       skapa-guiden (WorkOrdersPage._wizAddressBlockHtml), men här skrivs
       redigeringsläget till en egen liten state (_editAddr) istället för
       _wiz.data eftersom den här modalen inte har någon wizard-omgärdning.
       Startas alltid från AO:ns SPARADE värden, aldrig från fastighetens/
       kundens LIVE-adress om override redan var aktivt — annars skulle
       bara ÖPPNA redigera-dialogen kunna tysta byta adress.

       R1 §3 (blockerare #3, oberoende reproducerad) — LEGACY-HÄRLEDNING:
       `ao.addressOverride` finns inte på AO:er från före denna omgång
       (fältet är `undefined`). `!!ao.addressOverride` gjorde det tyst till
       `false` ("standardläge, spåra fastighet/kund") — men en legacy-AO:s
       sparade `ao.address` KAN vara en medvetet satt, egen adress som
       aldrig hade något med den länkade fastigheten att göra (fastigheten
       kan ha bytt adress sedan AO:n skapades, eller AO:n kan alltid ha haft
       en annan arbetsplats än fastighetens registrerade adress). Att
       tolka den som "standardläge" riskerade att en OFÖRENLIG redigering
       (t.ex. bara ändra rubriken) tyst skrev över AO:ns historiska adress
       med fastighetens/kundens NUVARANDE adress.
       Säker härledning när fältet saknas (typeof !== 'boolean'):
         - Om AO:n har en sparad adress som SKILJER SIG från vad som just nu
           skulle resolveras som standard (eller om det inte finns någon
           resolverbar standardadress alls) → behandla som en egen/särskild
           adress (override=true) — bevara den, redigera den inte tyst bort.
         - Om AO:ns sparade adress redan RÅKAR matcha den aktuella
           standardadressen → override=false är ofarligt HÄR (samma värde),
           men se _editCollectAddress() nedan för det som FAKTISKT skyddar
           mot framtida tyst omskrivning: en oförändrad länkning skriver
           ALDRIG om adressen, oavsett override-läge.
       Om `ao.addressOverride` REDAN är en explicit boolean (satt av denna
       omgångens egen create/edit-kod) respekteras den rakt av — ingen
       gissning behövs. */
    let inferredOverride;
    if (typeof ao.addressOverride === 'boolean') {
      inferredOverride = ao.addressOverride;
    } else {
      const defaultNow = this._editResolvedAddress(ao, ao.customerId);
      const addressDiffers = (ao.address || '') !== (defaultNow.address || '');
      const noDefaultAtAll = !defaultNow.address;
      inferredOverride = !!(ao.address && (addressDiffers || noDefaultAtAll));
    }
    /* R2.1 §3/§4 — EN PENDING ADRESS-STATE, enda sanningskälla för BÅDE
       visning och sparning (oberoende reproducerad blockerare — R2:s
       default-visning läste `ao.*` direkt medan `_editCollectAddress()`
       kunde besluta något annat vid Spara; ett klick på "Använd aktuell
       fastighetsadress" uppdaterade bara denna state-objektets fält, men
       visningen fortsatte läsa `ao.*` tills faktisk sparning — användaren
       kunde alltså SE den gamla adressen trots att Spara skulle skriva
       den NYA). Nu är `this._editAddr` (härifrån och nedåt kallat `st`
       i denna fils kommentarer) den ENDA platsen där den väntande
       adressen lever: varje händelse (öppning, kryssruta av/på,
       kundbyte, resync-knapp) uppdaterar `st` DIREKT och renderar om
       FRÅN `st` — `_editCollectAddress()` läser bara av `st`, den fattar
       inga egna beslut längre (se dess kommentar).
       Initieras från AO:ns SPARADE snapshot om AO:n har en egen adress
       (den historiska sanningen) — annars, och ENDAST då, från den just
       nu gällande länkade fastighets-/kundadressen (inget att bevara). */
    let initAddr;
    if (ao.address) {
      initAddr = { address: ao.address, zip: ao.zip || '', city: ao.city || '', country: ao.country || '', addressSource: ao.addressSource || '' };
    } else {
      const resolvedInit = this._editResolvedAddress(ao, ao.customerId);
      initAddr = { address: resolvedInit.address, zip: resolvedInit.zip, city: resolvedInit.city, country: '', addressSource: resolvedInit.source };
    }
    this._editAddr = {
      addressOverride: inferredOverride,
      address: initAddr.address, zip: initAddr.zip, city: initAddr.city,
      country: initAddr.country, addressSource: initAddr.addressSource,
      lat: ao.lat != null ? ao.lat : null, lng: ao.lng != null ? ao.lng : null
    };
    Modal.open({
      title: 'Redigera order',
      wide: true,
      body: `
        <div class="fg"><label>Rubrik</label><input id="edit-title" value="${esc(ao.title)}"></div>
        <div class="fg"><label>Beskrivning</label><textarea id="edit-desc" rows="2">${esc(ao.description||'')}</textarea></div>
        <div class="fg"><label>Kund</label>
          <select id="edit-cu" onchange="WorkOrderDetailPage._editCustomerChanged('${this.aoId}')">
            ${cuOptions}
          </select></div>
        <div class="fg"><label>Arbetsadress</label>
          <div id="edit-addr-wrap">${this._editAddressBlockHtml(ao)}</div>
        </div>
        <div class="fg"><label>Projekt (valfritt)</label>
          <div id="edit-project-wrap">${this._editProjectOptionsHtml(ao.customerId, ao.propertyId, ao.projectId)}</div>
        </div>
        <div class="g2">
          <div class="fg"><label>Datum</label><input type="date" id="edit-date" value="${ao.scheduledDate||''}"></div>
          <div class="fg"><label>Prioritet</label>
            <select id="edit-prio">
              ${['akut','hög','normal','låg'].map(p=>`<option value="${p}" ${ao.priority===p?'selected':''}>${{akut:'Akut',hög:'Hög',normal:'Normal',låg:'Låg'}[p]}</option>`).join('')}
            </select></div>
        </div>
        <div class="fg"><label>Kategori</label>
          <select id="edit-category">
            <option value="">— Ingen kategori —</option>
            ${AO_CATEGORIES.map(c=>`<option value="${c.slug}" ${ao.category===c.slug?'selected':''}>${esc(c.label)}</option>`).join('')}
          </select></div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: (mainEv) => {
          const title = document.getElementById('edit-title')?.value.trim();
          if (!title) { showToast('Rubrik krävs'); return; }
          const addrPatch = this._editCollectAddress(getAO(this.aoId));
          /* R1 §6 — samma särskild-adress-validering som skapa-guiden
             (WorkOrdersPage._validateAddressOverride), återanvänd rakt av
             eftersom kontraktet ({addressOverride, address, zip, city}) är
             identiskt. */
          if (!WorkOrdersPage._validateAddressOverride(addrPatch)) return;
          const newCustomerId = document.getElementById('edit-cu')?.value || '';
          /* V54B R2 — blockerare 6: en icke-tom men INKOMPATIBEL vald
             Projekt-koppling omvandlades tidigare tyst till en
             frikoppling (`finalProjectId = projectOk ? selectedProjectId
             : ''`) — användaren valde ett projekt, men fick istället en
             tyst avlänkning utan varsel, vilket ALDRIG är korrekt
             beteende. Ett ogiltigt, icke-tomt val BLOCKERAR nu hela
             sparningen (ingen fältmutation, ingen Projekt-mutation) med
             ett tydligt meddelande. Endast ett UTTRYCKLIGET tomt val
             ('') tolkas som en avsiktlig frikoppling — den vägen har
             fortsatt sin egen bekräftelsedialog nedan, oförändrad. */
          const selectedProjectId = document.getElementById('edit-project')?.value || '';
          if (selectedProjectId && (typeof ProjectService === 'undefined' || !ProjectService.isChildCompatible(selectedProjectId, newCustomerId, getAO(this.aoId).propertyId))) {
            showToast('Arbetsordern kan inte kopplas till det valda projektet — kund eller fastighet stämmer inte överens.');
            return;
          }
          const finalProjectId = selectedProjectId;
          /* QA FIX-ROUND 2026-11-12 (M1, confirmed in code + live): this
             used to be Object.assign({title, description, customerId,
             scheduledDate, priority, category}, addrPatch) — the FULL
             form, every time. Two sessions on the same AO: A changes only
             the title and saves; B (dialog opened before A's save)
             changes only the priority and saves later — B's patch still
             carried B's stale title and silently reverted A's confirmed
             title, and both saw "Order uppdaterad". The patch is now a
             true delta against what this dialog showed when it opened
             (this._editOpening, see openEdit()), so work_order_patch only
             touches the fields this user actually changed. */
          const fieldPatch = this._editDeltaPatch(this._editCollectFields(), addrPatch, this._editOpening);

          /* V54B R1 — blockerare 5: en byte av Projekt fick tidigare köras
             genom med `{confirmedMove:true}` OVILLKORLIGT, så fort värdet
             skilde sig — dvs. ALDRIG någon faktisk bekräftelsedialog för
             användaren, trots att kravet är att en flytt MÅSTE bekräftas
             explicit. INGEN mutation (varken de vanliga fälten eller
             Projekt-relationen) sparas nu förrän en ev. nödvändig
             bekräftelse har besvarats — annars kunde andra fältändringar
             hinna sparas innan dialogen ens visats. */
          const oldAo = getAO(this.aoId);
          const oldProjectId = oldAo.projectId || '';
          /* V54B R2 — blockerare 6 (forts.): setProject()s resultat
             kontrolleras nu innan "Order uppdaterad" visas/modalen
             stängs — valideringen ovan gör visserligen ett ok-svar
             mycket sannolikt (samma isChildCompatible-kontroll körs i
             båda), men setProject() är den enda instans som får sätta
             `projectId` (se WorkOrderService R1) och dess svar är
             därför den auktoritativa sanningen, inte ett antagande. Ett
             `!ok`-svar rapporteras ALDRIG som framgång. */
          /* FLOW-A FIX (confirmed bug, this round): doSave() previously
             called WorkOrderService.update() (a SYNCHRONOUS local mutation
             — the real server write happens via _syncAO(), fire-and-
             forget) and then IMMEDIATELY closed the modal and showed
             "Order uppdaterad", with zero connection to whether the
             server write actually succeeded. Confirmed live (network
             fully blocked): the toast and modal-close fired identically
             to the success case, and the edit was never persisted.
             Fix: wait for update()'s new opts.onSettled (see
             WorkOrderService.update()/_syncAO()'s own comments — same
             pattern already used correctly by create()) before closing
             the modal/showing success. A disabled "Sparar…" button state
             replaces the old instant close so the user gets feedback
             while the real write is in flight; on a FINAL rejection the
             button resets and a real error is shown with the modal (and
             the user's entered values) still open — never silently
             discarded. A non-final (transient) callback is ignored here,
             same "only `final:true` is a real rejection" rule create()'s
             pattern already documents, since AOTimeSyncService may retry.
             setProject()'s own confirmation-dialog flow is untouched — it
             already returns a synchronous validation result and is a
             SEPARATE existing call site, not part of this round's bug. */
          const doSave = (ev) => {
            const btnEl = ev && ev.currentTarget;
            const origLabel = btnEl ? btnEl.innerHTML : '';
            if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = 'Sparar…'; }
            const resetBtn = () => { if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = origLabel; } };

            /* M1: nothing but (possibly) the project changed — no AO field
               write at all; go straight to the confirmed-success path. */
            if (Object.keys(fieldPatch).length === 0) {
              if (oldProjectId !== finalProjectId) {
                const relResult = WorkOrderService.setProject(this.aoId, finalProjectId, { confirmedMove: true });
                if (!relResult.ok) { resetBtn(); showToast(relResult.error || 'Projektkopplingen kunde inte uppdateras.'); return; }
                Modal.close();
                this.render({ aoId: this.aoId });
                showToast('Order uppdaterad');
              } else {
                Modal.close();
                showToast('Inga ändringar att spara');
              }
              return;
            }

            WorkOrderService.update(this.aoId, fieldPatch, {
              onSettled: (r) => {
                if (r && r.ok) {
                  if (oldProjectId !== finalProjectId) {
                    const relResult = WorkOrderService.setProject(this.aoId, finalProjectId, { confirmedMove: true });
                    if (!relResult.ok) {
                      resetBtn();
                      showToast(relResult.error || 'Projektkopplingen kunde inte uppdateras.');
                      return;
                    }
                  }
                  Modal.close();
                  this.render({ aoId: this.aoId });
                  showToast('Order uppdaterad');
                } else if (r && r.final) {
                  resetBtn();
                  showToast('Kunde inte spara ändringen. Försök igen.');
                }
                // else: transient (ingen slutgiltig server-dom än) — stanna i
                // "Sparar…"-läget och vänta på ett senare, slutgiltigt svar.
              }
            });
          };

          if (oldProjectId && finalProjectId && oldProjectId !== finalProjectId) {
            const oldProj = ProjectService.getById(oldProjectId);
            const newProj = ProjectService.getById(finalProjectId);
            Modal.open({
              title: 'Flytta arbetsorder till annat projekt?',
              body: `<p style="font-size:13px;">Arbetsordern flyttas från <strong>${esc(oldProj ? oldProj.name : oldProjectId)}</strong> till <strong>${esc(newProj ? newProj.name : finalProjectId)}</strong>.</p>`,
              buttons: [
                { label: 'Flytta och spara', cls: 'btn bsu', onClick: doSave },
                { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
              ]
            });
          } else if (oldProjectId && !finalProjectId) {
            const oldProj = ProjectService.getById(oldProjectId);
            Modal.open({
              title: 'Koppla loss från projekt?',
              body: `<p style="font-size:13px;">Arbetsordern kopplas loss från <strong>${esc(oldProj ? oldProj.name : oldProjectId)}</strong>.</p>`,
              buttons: [
                { label: 'Koppla loss och spara', cls: 'btn bd', onClick: doSave },
                { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
              ]
            });
          } else {
            doSave(mainEv);
          }
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    /* QA FIX-ROUND 2026-11-12 (M1): snapshot of exactly what the form
       shows the moment it opens, read back through the SAME collectors
       Spara uses (Modal.open() renders synchronously). Spara sends only
       fields whose value differs from this snapshot — see the Spara
       handler above. */
    this._editOpening = {
      fields: this._editCollectFields(),
      addr: this._editCollectAddress(ao)
    };
  },

  /* QA FIX-ROUND 2026-11-12 (M1): the plain (non-address) edit fields,
     read from the open edit dialog. Used both for the opening snapshot
     and at save time, so "unchanged" is decided on identical terms. */
  _editCollectFields() {
    return {
      title:         (document.getElementById('edit-title')?.value || '').trim(),
      description:   document.getElementById('edit-desc')?.value.trim() || '',
      customerId:    document.getElementById('edit-cu')?.value || '',
      scheduledDate: document.getElementById('edit-date')?.value || '',
      priority:      document.getElementById('edit-prio')?.value || 'normal',
      category:      document.getElementById('edit-category')?.value || ''
    };
  },

  /* QA FIX-ROUND 2026-11-12 (M1): true delta against the opening
     snapshot. The address fields are one unit (override flag + address +
     zip + city + country + source belong together): if any of them
     changed, all are sent, otherwise none. Without a snapshot (should not
     happen) everything is sent — the old behavior, never less. */
  _editDeltaPatch(current, addrPatch, opening) {
    const patch = {};
    const of = opening && opening.fields;
    Object.keys(current).forEach(k => { if (!of || current[k] !== of[k]) patch[k] = current[k]; });
    const oa = opening && opening.addr;
    const addrChanged = !oa || Object.keys(addrPatch).some(k => addrPatch[k] !== oa[k]);
    if (addrChanged) Object.assign(patch, addrPatch);
    return patch;
  },

  /* Ärvd adress för redigera-modalen — samma precedens (fastighet före kund)
     som WorkOrdersPage._wizResolvedAddress(), men läser AO:ns EGET propertyId
     (som inte går att ändra i denna modal) + den just nu valda kunden. */
  _editResolvedAddress(ao, customerId) {
    const prop = ao.propertyId ? (state.properties||[]).find(p => p.id === ao.propertyId) : null;
    if (prop && prop.address) {
      return { address: prop.address, zip: prop.zip || '', city: prop.city || '', source: 'property' };
    }
    const cu = customerId ? getCu(customerId) : null;
    if (cu && cu.address) {
      return { address: cu.address, zip: cu.zip || '', city: cu.city || '', source: 'customer' };
    }
    return { address: '', zip: '', city: '', source: '' };
  },

  /* R2.1 §3/§6 (oberoende reproducerad blockerare, härdad efter R2) —
     PRIMÄR VISNING LÄSER NU UTESLUTANDE FRÅN `st` (this._editAddr), ALDRIG
     från `ao` direkt. R2:s version läste `ao.address/zip/city` för
     default-lägets snapshot-visning — korrekt för den ANVÄNDA scenen vid
     öppning, men eftersom `_editResyncToDefault()`/`_editToggleAddressOverride()`
     bara uppdaterade `st` (utan att `ao` någonsin muterades förrän
     faktisk Spara), fortsatte visningen tyst visa den GAMLA `ao`-adressen
     efter ett klick på "Använd aktuell fastighetsadress" — trots att det
     som FAKTISKT skulle sparas redan var den NYA adressen. `st` är nu den
     enda sanningskällan: samma objekt som varje händelse uppdaterar OCH
     som `_editCollectAddress()` läser av vid Spara — vad användaren SER
     är alltid exakt vad som SPARAS.
     `data-role="ao-work-address"`/`"linked-current-address"` låter tester
     (och ev. framtida UI) skilja den PRIMÄRA väntande adressen från den
     sekundära jämförelsetexten mot den nuvarande länkade adressen — de
     två innehåller ofta samma ord (staden) och en test som bara letar i
     hela wrappern kan ge en falsk grön träff, se R2.1 §2. */
  _editAddressBlockHtml(ao) {
    const st = this._editAddr;
    const customerId = document.getElementById('edit-cu')?.value || ao.customerId || '';
    const resolved = this._editResolvedAddress(ao, customerId);
    const resolvedLine2 = [resolved.zip, resolved.city].filter(Boolean).join(' ');
    const resyncLabel = resolved.source === 'property' ? 'Använd aktuell fastighetsadress' : 'Använd aktuell kundadress';

    const pendingLine2 = [st.zip, st.city].filter(Boolean).join(' ');
    const primaryHtml = `
      <div class="addr-card" data-role="ao-work-address">
        ${st.address
          ? `<div>${esc(st.address)}</div>${pendingLine2 ? `<div class="addr-card-city">${esc(pendingLine2)}</div>` : ''}`
          : `<span style="color:var(--mt);">Ingen adress att visa — välj en kund med adress, eller ange en särskild adress nedan.</span>`}
      </div>`;

    const pendingDiffersFromResolved = !!resolved.address && (
      (st.address || '') !== resolved.address || (st.zip || '') !== (resolved.zip || '') || (st.city || '') !== (resolved.city || '')
    );
    const resyncBlockHtml = pendingDiffersFromResolved ? `
      <div data-role="linked-current-address" style="margin-top:8px;padding:8px;border-radius:6px;background:var(--bg2,#f8fafc);font-size:12px;">
        <div style="color:var(--mt);margin-bottom:4px;">${resolved.source === 'property' ? 'Fastighetens' : 'Kundens'} nuvarande adress: ${esc(resolved.address)}${resolvedLine2 ? ', ' + esc(resolvedLine2) : ''}</div>
        <button type="button" class="btn bsm" onclick="WorkOrderDetailPage._editResyncToDefault('${this.aoId}')">${resyncLabel}</button>
      </div>` : '';

    const editHtml = `
      <div data-role="ao-work-address">
      <input id="edit-addr" value="${esc(st.address||'')}" placeholder="Gatuadress"
        autocomplete="off"
        data-addr-zip="edit-addr-zip" data-addr-city="edit-addr-city" data-addr-country="edit-addr-country" data-addr-lat="edit-addr-lat" data-addr-lng="edit-addr-lng"
        oninput="AddressService.handleInput(this); WorkOrderDetailPage._editSyncAddr()"
        onchange="WorkOrderDetailPage._editSyncAddr()"
        onblur="setTimeout(()=>AddressService.hideSuggestions(),150)">
      <div class="g2" style="margin-top:6px;">
        <div class="fg" style="margin:0;"><label>Postnummer</label>
          <input id="edit-addr-zip" value="${esc(st.zip||'')}" placeholder="T.ex. 412 54" oninput="WorkOrderDetailPage._editSyncAddr()" onchange="WorkOrderDetailPage._editSyncAddr()"></div>
        <div class="fg" style="margin:0;"><label>Ort</label>
          <input id="edit-addr-city" value="${esc(st.city||'')}" placeholder="T.ex. Göteborg" oninput="WorkOrderDetailPage._editSyncAddr()" onchange="WorkOrderDetailPage._editSyncAddr()"></div>
      </div>
      <input type="hidden" id="edit-addr-country" value="${esc(st.country||'')}" onchange="WorkOrderDetailPage._editSyncAddr()">
      <input type="hidden" id="edit-addr-lat" value="${st.lat!=null?st.lat:''}">
      <input type="hidden" id="edit-addr-lng" value="${st.lng!=null?st.lng:''}">
      </div>`;

    return `
      ${st.addressOverride ? editHtml : primaryHtml + resyncBlockHtml}
      <label style="display:flex;align-items:center;gap:6px;margin-top:8px;font-size:12px;font-weight:500;color:var(--tx);cursor:pointer;">
        <input type="checkbox" id="edit-addr-override" ${st.addressOverride?'checked':''} onchange="WorkOrderDetailPage._editToggleAddressOverride(this.checked)">
        Välj en särskild adress för denna arbetsorder
      </label>`;
  },

  /* R2 §7 — EXPLICIT, avsiktlig handling: byt AO:ns adressfält (i
     redigeringsläget, inte AO:t självt förrän Spara trycks) mot den NU
     gällande länkade fastighets-/kundadressen. Detta är den ENDA vägen
     att medvetet överge en avvikande historisk snapshot — se
     _editAddressBlockHtml()s kommentar. _explicitResync läses av
     _editCollectAddress() för att veta att detta INTE ska tolkas som
     "orört, bevara snapshoten". */
  _editResyncToDefault(aoId) {
    const ao = getAO(aoId);
    if (!ao) return;
    const st = this._editAddr;
    const customerId = document.getElementById('edit-cu')?.value || ao.customerId || '';
    const resolved = this._editResolvedAddress(ao, customerId);
    st.address = resolved.address;
    st.zip     = resolved.zip;
    st.city    = resolved.city;
    st.country = '';
    st.addressSource = resolved.source;
    st.addressOverride = false;
    /* R2.1: uppdatera `st` OCH rendera om FRÅN `st` — inget mellanled,
       ingen väntan på Spara. Se _editAddressBlockHtml()s kommentar. */
    const wrap = document.getElementById('edit-addr-wrap');
    if (wrap) wrap.innerHTML = this._editAddressBlockHtml(ao);
  },

  /* FINAL INVARIANTS AUDIT §7 (samma buggklass som R2.3s guide-restbugg,
     härdad här defensivt) — Invariant E: att gå in i särskilt-adress-läge
     MÅSTE alltid utgå från den NUVARANDE länkade standardadressen,
     ALDRIG villkorat av om `st.address` råkar redan vara ifyllt. AV-
     grenen skrev redan (sedan R2.1/R2.2) ALLTID in den aktuella
     standardadressen i `st` — vilket redan skyddade denna specifika
     redigera-dialog mot R2.3-buggen (eftersom `st.address` alltid är
     korrekt när man växlar PÅ igen). PÅ-grenen görs nu ändå ovillkorlig
     av samma skäl som guiden — inget beteende ska bero på en tillfällig
     tomhets-kontroll. */
  _editToggleAddressOverride(checked) {
    const ao = getAO(this.aoId);
    if (!ao) return;
    const st = this._editAddr;
    st.addressOverride = checked;
    const customerId = document.getElementById('edit-cu')?.value || ao.customerId || '';
    const resolved = this._editResolvedAddress(ao, customerId);
    st.address = resolved.address;
    st.zip     = resolved.zip;
    st.city    = resolved.city;
    st.country = '';
    st.addressSource = resolved.source;
    const wrap = document.getElementById('edit-addr-wrap');
    if (wrap) wrap.innerHTML = this._editAddressBlockHtml(ao);
  },

  /* Synkar de levande särskilt-adress-fälten in i `st` — den enda
     sanningskällan, se _editAddressBlockHtml()s kommentar. Anropas på
     varje input/change (manuell inskrivning OCH Mapbox-autocomplete via
     selectSuggestion()s riktiga 'change'-event). */
  _editSyncAddr() {
    const st = this._editAddr;
    if (!st || !st.addressOverride) return;
    st.address = (document.getElementById('edit-addr')?.value || '').trim();
    st.zip     = (document.getElementById('edit-addr-zip')?.value || '').trim();
    st.city    = (document.getElementById('edit-addr-city')?.value || '').trim();
    st.country = (document.getElementById('edit-addr-country')?.value || '').trim();
    st.addressSource = 'manual';
  },

  /* R2.1 §7 — kundbyte i default/spårningsläge är, precis som i R1/R2,
     en genuin ny länkning: den väntande adressen resolveras nu OMEDELBART
     mot den NYA kunden (istället för att bara uppdatera visningen och
     låta _editCollectAddress() räkna om något annat vid Spara) — det
     som visas är alltid exakt det som skulle sparas.

     R2.2 §1/§2 (oberoende reproducerad blockerare) — OSPARAD SÄRSKILD
     ADRESS FÖRSVANN VID KUNDBYTE: i särskilt-adress-läge (addressOverride
     ===true) är de redigerbara fälten (#edit-addr/-zip/-city/-country)
     LEVANDE DOM-inputs som medvetet INTE speglas in i `st` vid varje
     knapptryckning (se _editCollectAddress()s kommentar — de läses
     direkt från DOM:en vid Spara). Den tidigare koden lät medvetet BLI
     `st` orörd i override-läge (korrekt — en override är en override
     tills användaren själv slår av den) MEN renderade ändå OVILLKORLIGT
     om `#edit-addr-wrap` från den (nu inaktuella) `st` efteråt — vilket
     byggde OM formuläret från `st`s gamla värden och därmed FÖRSTÖRDE
     allt oskrivet den använda skrivit in i de levande fälten, innan
     Spara ens tryckts.
     Fix (Option A, minsta robusta lösning): i särskilt-adress-läge rörs
     `#edit-addr-wrap` INTE ALLS av ett kundbyte — en särskild adress är
     medvetet oberoende av kunden tills användaren EXPLICIT slår av
     "särskild adress"-läget (samma princip som redan gällde för `st`,
     nu konsekvent även för DOM:en). Jämförelserutan mot den länkade
     adressen visas ändå inte i override-läge, så det finns inget att
     uppdatera där heller. */
  _editCustomerChanged(aoId) {
    const ao = getAO(aoId);
    if (!ao) return;
    const st = this._editAddr;
    if (!st.addressOverride) {
      const customerId = document.getElementById('edit-cu')?.value || '';
      const resolved = this._editResolvedAddress(ao, customerId);
      st.address = resolved.address;
      st.zip     = resolved.zip;
      st.city    = resolved.city;
      st.country = '';
      st.addressSource = resolved.source;
      const wrap = document.getElementById('edit-addr-wrap');
      if (wrap) wrap.innerHTML = this._editAddressBlockHtml(ao);
    }
    /* V54B §10 — Projekt-väljaren byggs om mot den NYA kunden. En
       redan vald projektkoppling som inte längre är förenlig med den
       nya kunden (kund-gränsen är aldrig eftergivlig) rensas tyst,
       exakt samma disciplin som Fastighet/AO-fälten fick i V53B R1. */
    const projSel = document.getElementById('edit-project');
    const currentProjectId = projSel ? projSel.value : (ao.projectId || '');
    const newCustomerId = document.getElementById('edit-cu')?.value || '';
    const projWrap = document.getElementById('edit-project-wrap');
    if (projWrap) projWrap.innerHTML = this._editProjectOptionsHtml(newCustomerId, ao.propertyId, currentProjectId);
  },

  /* V54B §10 — Projekt-väljaren på den kanoniska AO-redigeringen.
     Listan begränsas ALLTID till projekt förenliga med (customerId,
     propertyId) via ProjectService.isChildCompatible() — samma
     kanoniska kontroll som save-time-lagret nedan använder, så de två
     aldrig kan divergera. */
  _editProjectOptionsHtml(customerId, propertyId, selectedProjectId) {
    if (typeof ProjectService === 'undefined') return '';
    const compatible = ProjectService.getCompatibleProjects(customerId, propertyId);
    /* En redan vald, men nu oförenlig, koppling erbjuds INTE kvar här
       (till skillnad från V54A R1:s "inaktiv ansvarig"-mönster) —
       Projekt-fältet är rent frivilligt kontextuellt, ingen historisk
       tilldelning att bevara; _editCustomerChanged()/onchange håller
       redan valet i synk, och en genuint oförenlig kombination kan
       ändå aldrig sparas (se openEdit()s Spara-hanterare). */
    let html = `<select id="edit-project"><option value="">— Inget projekt —</option>`;
    html += compatible.map(p => `<option value="${esc(p.id)}" ${selectedProjectId === p.id ? 'selected' : ''}>${esc(p.id)} – ${esc(p.name)}</option>`).join('');
    html += `</select>`;
    return html;
  },

  /* R2.1 §3/§8 — FÖRENKLAD till en ren serialisering/validering av den
     redan beslutade "pending state" (`st`, this._editAddr), inte längre
     en andra, dold beslutsmotor. All ADRESS-BESLUTSLOGIK (bevara historisk
     snapshot vs. resolvera mot en ny länkad standardadress) sker nu vid
     själva UTLÖSANDE HÄNDELSEN — openEdit()s initiering,
     _editToggleAddressOverride(), _editCustomerChanged(), eller
     _editResyncToDefault() — och skrivs DIREKT till `st`, som samtidigt
     är det ENDA som _editAddressBlockHtml() renderar. Den här funktionen
     läser bara av det som redan visas — den fattar inga egna beslut,
     vilket eliminerar hela klassen av "UI visar en sak, Spara bestämmer
     en annan" (R2:s blockerare, se _editAddressBlockHtml()s kommentar).
     ao.lat/ao.lng sätts ALDRIG härifrån — WorkOrderService.
     geocodeAddressIfNeeded() (körs automatiskt efter update()) äger all
     geokodning centralt, race-skyddad med en generationstoken (R1 §2). */
  /* FINAL INVARIANTS AUDIT §6 — förenklad till en ren serialisering.
     `st.address/zip/city/country/addressSource` är REDAN den enda,
     aktuella sanningskällan vid det här laget: `_editSyncAddr()` håller
     dem synkade i särskilt-adress-läge (varje tangenttryckning/
     autocomplete-val), och `_editToggleAddressOverride()`/
     `_editResyncToDefault()`/`_editCustomerChanged()` håller dem synkade
     i standardläge. Ingen ny DOM-läsning eller beräkning görs här
     längre — den här funktionen är inte en andra beslutsmotor. */
  _editCollectAddress(ao) {
    const st = this._editAddr || { addressOverride: false, address: '', zip: '', city: '', country: '', addressSource: '' };
    const overrideEl = document.getElementById('edit-addr-override');
    const override = overrideEl ? overrideEl.checked : !!st.addressOverride;
    return {
      address: st.address || '', zip: st.zip || '', city: st.city || '', country: st.country || '',
      addressOverride: override, addressSource: st.addressSource || (override ? 'manual' : '')
    };
  },

  /* ── Gör återkommande ─────────────────── */
  makeRecurring() {
    const ao = getAO(this.aoId);
    if (!ao) return;
    /* Öppna formuläret direkt som modal — navigerar inte bort från AO-sidan */
    RecurringPage.openFromAO(this.aoId);
  },

  /* ── Skapa fakturaunderlag ─────────────── */
  async createInvoice() {
    const ao = getAO(this.aoId);
    if (!ao) return;
    const result = await InvoiceService.createFromAO(this.aoId);
    if (!result.ok) { showToast(result.error); return; }
    showToast(`${result.invoice.id} skapat`);
    Router.showPage('pg-inv-detail', { invoiceId: result.invoice.id });
  }
};
