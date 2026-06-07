/**
 * InvoicesPage — Fakturaunderlag lista + detalj
 */
const InvoicesPage = {
  _tab: 'alla',

  render() {
    const el = document.getElementById('pg-invoices-content');
    if (!el) return;
    const invoices = state.invoices || [];
    const ready    = WorkOrderService.readyForInvoice();

    const TAB_LABELS = { alla:'Alla', utkast:'Utkast', skickad:'Skickade', betald:'Betalda', förfallen:'Förfallna', makulerad:'Makulerade' };
    const tabs = Object.keys(TAB_LABELS);

    const counts = {};
    tabs.forEach(t => { counts[t] = t === 'alla' ? invoices.length : invoices.filter(i => i.status === t).length; });

    // KPI summary
    const kpiItems = [
      { label:'Utkast',   key:'utkast',   color:'var(--mt)',  icon:'file-text'    },
      { label:'Skickade', key:'skickad',  color:'var(--sky)', icon:'send'         },
      { label:'Betalda',  key:'betald',   color:'var(--gr)',  icon:'check-circle' },
      { label:'Förfallna',key:'förfallen',color:'var(--rd)',  icon:'alert-circle' }
    ];
    const kpiHtml = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;">
      ${kpiItems.map(k => {
        const subset = invoices.filter(i => i.status === k.key);
        const total  = subset.reduce((s,i) => s + InvoiceService.calcTotals(i).total, 0);
        const active = this._tab === k.key;
        return `<div class="card" onclick="InvoicesPage._setTab('${k.key}')" style="cursor:pointer;padding:12px 14px;${active?'border-color:'+k.color+';box-shadow:0 0 0 2px '+k.color+'22;':''}">
          <div style="color:${k.color};margin-bottom:4px;">${ic(k.icon,18)}</div>
          <div style="font-size:22px;font-weight:800;color:var(--navy);">${counts[k.key]}</div>
          <div style="font-size:11px;font-weight:700;color:var(--mt);">${k.label}</div>
          ${total > 0 ? `<div style="font-size:10px;color:var(--mt);margin-top:2px;">${fkr(total)}</div>` : ''}
        </div>`;
      }).join('')}
    </div>`;

    // Ready-for-invoice banner
    const readyHtml = ready.length > 0 ? `
      <div class="card" style="border-color:var(--gr);border-left:4px solid var(--gr);">
        <div class="card-header">
          <h3 style="color:var(--gr);">${ic('alert-triangle',14)} Klara ordrar – väntar fakturering</h3>
          <span class="bdg bdg-green">${ready.length}</span>
        </div>
        <div class="card-body" style="padding:6px 14px;">
          ${ready.slice(0,5).map(ao => {
            const cu = getCu(ao.customerId);
            const alreadyInvoiced = !!ao.invoiceId;
            return `<div class="crow" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">
              <div>
                <div style="font-size:13px;font-weight:700;">${ao.id} – ${esc(ao.title)}</div>
                <div style="font-size:11px;color:var(--mt);">${cu?CustomerService.displayName(cu):'—'}${alreadyInvoiced?' · '+ic('check',10)+' Faktura '+ao.invoiceId:''}</div>
              </div>
              ${alreadyInvoiced
                ? `<button class="btn bsm bs" onclick="event.stopPropagation();Router.showPage('pg-inv-detail',{invoiceId:'${ao.invoiceId}'})">${ic('receipt',13)} Visa</button>`
                : `<button class="btn bsm bsu" onclick="event.stopPropagation();InvoicesPage.createFromAO('${ao.id}')">${ic('file-plus',13)} Skapa</button>`}
            </div>`;
          }).join('')}
        </div>
      </div>` : '';

    // Tab bar
    const tabHtml = `<div style="display:flex;gap:4px;flex-wrap:wrap;">
      ${tabs.map(t => `<button class="btn bsm ${this._tab===t?'bp':'bs'}" onclick="InvoicesPage._setTab('${t}')">
        ${TAB_LABELS[t]}${counts[t]>0?` <span style="background:rgba(255,255,255,.25);border-radius:100px;padding:1px 6px;font-size:10px;">${counts[t]}</span>`:''}
      </button>`).join('')}
    </div>`;

    // Filtered invoice list
    const filtered = this._tab === 'alla' ? invoices : invoices.filter(i => i.status === this._tab);
    const listHtml = filtered.length === 0
      ? `<div class="empty">${ic('receipt',32)}<h3>${this._tab==='alla'?'Inga fakturaunderlag':'Inga '+TAB_LABELS[this._tab].toLowerCase()}</h3><p>Skapa från en klar arbetsorder</p></div>`
      : filtered.map(inv => {
          const cu = getCu(inv.customerId);
          const t  = InvoiceService.calcTotals(inv);
          const ao = inv.workOrderId ? (state.workOrders||[]).find(a=>a.id===inv.workOrderId) : null;
          const subtitle = [
            inv.title || (ao ? ao.title : ''),
            cu ? CustomerService.displayName(cu) : null,
            fkr(t.total) + ' inkl. moms',
            fmtDate(inv.createdAt)
          ].filter(Boolean).join(' · ');
          return `<div class="list-item" onclick="Router.showPage('pg-inv-detail',{invoiceId:'${inv.id}'})">
            <div class="item-row">
              <div style="min-width:0;flex:1;">
                <div class="item-title">${inv.id}${inv.workOrderId?' – '+inv.workOrderId:''}</div>
                <div class="item-sub">${esc(subtitle)}</div>
              </div>
              ${sbdg(inv.status)}
            </div>
          </div>`;
        }).join('');

    el.innerHTML = `
      ${kpiHtml}
      ${readyHtml}
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <div style="flex:1;">${tabHtml}</div>
        <button class="btn bp bsm" onclick="InvoicesPage.createBlank()">${ic('plus',14)} Ny faktura</button>
      </div>
      ${listHtml}`;
  },

  _setTab(tab) {
    this._tab = tab;
    this.render();
  },

  createFromAO(aoId) {
    if (!Auth.require('invoice_create')) return;
    const ao = getAO(aoId);
    if (ao && ao.invoiceId) {
      Modal.open({
        title: 'Faktura finns redan',
        body: `<p>Arbetsorder ${aoId} har redan faktura <strong>${ao.invoiceId}</strong>.</p><p style="margin-top:8px;color:var(--mt);font-size:13px;">Vill du skapa ytterligare en faktura? (t.ex. tilläggsfaktura)</p>`,
        buttons: [
          { label: 'Skapa ny faktura ändå', cls: 'btn bsu', onClick: () => {
            Modal.close();
            ao.invoiceId = '';
            const result = InvoiceService.createFromAO(aoId);
            ao.invoiceId = result.ok ? result.invoice.id : '';
            if (!result.ok) { showToast(result.error); return; }
            showToast(`${result.invoice.id} skapat`);
            Router.showPage('pg-inv-detail', { invoiceId: result.invoice.id });
          }},
          { label: 'Visa befintlig', cls: 'btn bp', onClick: () => { Modal.close(); Router.showPage('pg-inv-detail', { invoiceId: ao.invoiceId }); }},
          { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
        ]
      });
      return;
    }
    const result = InvoiceService.createFromAO(aoId);
    if (!result.ok) { showToast(result.error); return; }
    showToast(`${result.invoice.id} skapat`);
    Router.showPage('pg-inv-detail', { invoiceId: result.invoice.id });
  },

  createBlank() {
    if (!Auth.require('invoice_create')) return;
    Modal.open({
      title: 'Ny faktura / redovisning',
      wide: true,
      body: `
        <div class="fg"><label>Kund</label>
          <select id="blank-cu">
            <option value="">— Välj kund (valfritt) —</option>
            ${(state.customers||[]).map(c=>`<option value="${c.id}">${CustomerService.displayName(c)}</option>`).join('')}
          </select></div>
        <div class="fg"><label>Rubrik</label>
          <input id="blank-title" placeholder="T.ex. Tilläggsarbete, Extrakostnader…"></div>
        <div class="fg"><label>Intern kommentar (visas ej på faktura)</label>
          <textarea id="blank-note" rows="2" placeholder="Valfri anteckning…"></textarea></div>
        <div class="fg"><label>Förfallodatum</label>
          <input type="date" id="blank-due" value="${new Date(Date.now()+30*86400000).toISOString().split('T')[0]}"></div>`,
      buttons: [
        { label: 'Skapa', cls: 'btn bp', onClick: () => {
          const cuId  = document.getElementById('blank-cu')?.value || '';
          const title = document.getElementById('blank-title')?.value.trim() || '';
          const note  = document.getElementById('blank-note')?.value.trim() || '';
          const due   = document.getElementById('blank-due')?.value || '';
          const result = InvoiceService.createBlank(cuId, { title, note, dueDate: due });
          Modal.close();
          Router.showPage('pg-inv-detail', { invoiceId: result.invoice.id });
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  }
};

/* ── Fakturaunderlag-detalj ──────────────── */
const InvoiceDetailPage = {
  invoiceId: null,

  render(params) {
    const el = document.getElementById('pg-inv-detail-content');
    if (!el) return;
    const id = params && params.invoiceId;
    this.invoiceId = id;
    const inv = id ? getInv(id) : null;
    if (!inv) {
      el.innerHTML = `<div class="empty">${ic('receipt',32)}<h3>Fakturaunderlag hittades inte</h3></div>`;
      return;
    }
    this._renderFull(el, inv);
  },

  _renderFull(el, inv) {
    const cu   = getCu(inv.customerId);
    const t    = InvoiceService.calcTotals(inv);
    const statusOpts = ['utkast','skickad','betald','förfallen','makulerad'];
    const ao   = inv.workOrderId ? (state.workOrders||[]).find(a=>a.id===inv.workOrderId) : null;
    const off  = inv.offerId ? (state.offers||[]).find(o=>o.id===inv.offerId) : null;

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
        <button class="btn bs bsm" onclick="Router.back()" title="Tillbaka">${ic('arrow-left',14)}</button>
        <div style="flex:1;min-width:0;">
          <div style="font-size:16px;font-weight:800;">${inv.id}</div>
          ${inv.title ? `<div style="font-size:13px;color:var(--mt);font-weight:600;">${esc(inv.title)}</div>` : ''}
          <div>${sbdg(inv.status)}</div>
        </div>
        <select class="btn bs bsm" style="font-weight:600;" onchange="InvoiceDetailPage.setStatus(this.value)">
          ${statusOpts.map(s=>`<option value="${s}" ${inv.status===s?'selected':''}>${statusLabel(s)}</option>`).join('')}
        </select>
      </div>

      <!-- Metadata -->
      <div class="card">
        <div class="card-header"><h3>Faktureras till</h3></div>
        <div class="card-body">
          <div class="dr"><span class="dk">Kund</span><span class="dv">${cu?CustomerService.displayName(cu):'—'}</span></div>
          ${cu ? `<div class="dr"><span class="dk">Adress</span><span class="dv">${esc(cu.address||'—')}${cu.city?', '+esc(cu.city):''}</span></div>` : ''}
          ${cu && cu.orgNr ? `<div class="dr"><span class="dk">Org.nr</span><span class="dv">${esc(cu.orgNr)}</span></div>` : ''}
          <div class="dr"><span class="dk">Förfallodatum</span><span class="dv">${fmtDate(inv.dueDate)}</span></div>
          ${inv.workOrderId ? `<div class="dr"><span class="dk">Från AO</span>
            <span class="dv link" onclick="Router.showPage('pg-ao-detail',{aoId:'${inv.workOrderId}'})">${inv.workOrderId}${ao?' – '+esc(ao.title):''}</span></div>` : ''}
          ${inv.offerId ? `<div class="dr"><span class="dk">Från offert</span>
            <span class="dv link" onclick="Router.showPage('pg-offer-detail',{offerId:'${inv.offerId}'})">${inv.offerId}${off?' (v'+off.versionNumber+')':''}</span></div>` : ''}
          ${inv.sentAt ? `<div class="dr"><span class="dk">Skickad</span><span class="dv">${fmtDate(inv.sentAt)}</span></div>` : ''}
          ${inv.paidAt ? `<div class="dr"><span class="dk" style="color:var(--gr);">Betald</span><span class="dv" style="color:var(--gr);font-weight:700;">${fmtDate(inv.paidAt)}</span></div>` : ''}
          <div class="dr"><span class="dk">Skapad</span><span class="dv">${fmtDate(inv.createdAt)}</span></div>
        </div>
      </div>

      <!-- Rader -->
      <div class="card">
        <div class="card-header">
          <h3>Fakturarader</h3>
          <button class="btn bs bxs" onclick="InvoiceDetailPage.openAddLine()">${ic('plus',13)}</button>
        </div>
        <div id="inv-lines">
          ${this._renderLines(inv)}
        </div>

        <!-- Summering -->
        <div style="padding:12px 14px;border-top:2px solid var(--br);">
          <div class="dr"><span class="dk">Summa ex. moms</span><span class="dv">${fkr(t.exVat)}</span></div>
          <div class="dr"><span class="dk">Moms 25%</span><span class="dv">${fkr(t.vat)}</span></div>
          <div class="dr" style="font-size:16px;font-weight:800;border-top:2px solid var(--br);padding-top:8px;margin-top:4px;">
            <span class="dk" style="color:var(--navy);">Att betala</span>
            <span class="dv" style="color:var(--navy);">${fkr(t.total)}</span>
          </div>
        </div>
      </div>

      ${inv.note ? `<div class="nbox">${esc(inv.note)}</div>` : ''}

      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${inv.status === 'utkast'  ? `<button class="btn bp bsm" onclick="InvoiceDetailPage.setStatus('skickad')">${ic('send',14)} Markera skickad</button>` : ''}
        ${inv.status === 'skickad' ? `<button class="btn bsu bsm" onclick="InvoiceDetailPage.setStatus('betald')">${ic('check-circle',14)} Markera betald</button>` : ''}
        <button class="btn bs bsm" onclick="showToast('PDF-export byggs i Fas 5B')">${ic('printer',14)} PDF</button>
      </div>`;
  },

  _renderLines(inv) {
    const lines = inv.lines || [];
    if (!lines.length) return `<p style="padding:12px 14px;color:var(--mt);font-size:13px;">Inga rader</p>`;
    return lines.map(l => {
      const exVat  = (l.qty||0) * (l.unitPrice||0);
      const vatAmt = exVat * ((l.vatRate||25) / 100);
      const typeIcon = { Tid:'clock', Material:'package', Fastpris:'file-check', Manuell:'pencil', Övrigt:'more-horizontal', Fritext:'align-left' }[l.source] || 'file-text';
      const typeCls  = { Tid:'bdg-sky', Material:'bdg-orange', Fastpris:'bdg-green', Manuell:'bdg-grey', Övrigt:'bdg-grey', Fritext:'bdg-grey' }[l.source] || 'bdg-grey';
      return `
        <div style="padding:10px 14px;border-bottom:1px solid var(--bg);">
          <div style="display:flex;align-items:flex-start;gap:8px;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:700;margin-bottom:2px;">${esc(l.description)}</div>
              <div style="font-size:11px;color:var(--mt);">${l.qty} ${l.unit} × ${fmt(l.unitPrice)} kr
                <span class="bdg ${typeCls}" style="font-size:9px;margin-left:4px;">${ic(typeIcon,9)} ${InvoiceService.sourceLabel(l)}</span>
              </div>
              <div style="display:flex;gap:10px;margin-top:3px;font-size:11px;">
                <span style="color:var(--mt);">Ex: <strong style="color:var(--tx)">${fmt(exVat)} kr</strong></span>
                <span style="color:var(--mt);">Moms ${l.vatRate||25}%: ${fmt(vatAmt)} kr</span>
                <span style="color:var(--navy);font-weight:700;">Inkl: ${fmt(exVat+vatAmt)} kr</span>
              </div>
            </div>
            <div style="display:flex;gap:4px;flex-shrink:0;">
              <button class="btn bxs bs" onclick="InvoiceDetailPage.openEditLine('${l.id}')">${ic('pencil',12)}</button>
              <button class="btn bxs bd" onclick="InvoiceDetailPage.deleteLine('${l.id}')">${ic('trash',12)}</button>
            </div>
          </div>
        </div>`;
    }).join('');
  },

  _lineFormHtml(line) {
    const vatRates = [0, 6, 12, 25];
    const vatOpts  = (sel) => vatRates.map(r => `<option value="${r}" ${r===sel?'selected':''}>${r}%</option>`).join('');

    const srcToType = { 'Tid':'tid', 'Material':'mat', 'Övrigt':'ovr', 'Fastpris':'fast', 'Fritext':'fri', 'Manuell':'ovr' };
    const curSrc  = line ? (line.source || 'Manuell') : 'Manuell';
    const curType = srcToType[curSrc] || 'ovr';

    const curVat   = line ? (line.vatRate != null ? line.vatRate : 25) : 25;
    const curUnit  = line ? (line.unit  || 'st') : 'st';
    const curQty   = line ? (line.qty   != null ? line.qty : 1)  : 1;
    const curPrice = line ? (line.unitPrice != null ? line.unitPrice : 0) : 0;
    const curDesc  = line ? (line.description || '') : '';
    const curFree  = line ? (line.freetext || '') : '';

    const types = ['tid','mat','ovr','fast','fri'];
    const typeLabels = { tid:'Tid', mat:'Material', ovr:'Övrigt', fast:'Fastpris', fri:'Fritext' };

    const typeBtns = types.map(t =>
      `<button type="button" class="btn ${t===curType?'bp':'bs'} bsm" style="flex:1;padding:7px 4px;font-size:11px;"
        onclick="InvoiceDetailPage._setType('${t}')">${typeLabels[t]}</button>`
    ).join('');

    const artOpts = (state.articles||[]).filter(a=>a.active).map(a =>
      `<option value="${a.id}" data-name="${esc(a.name||'')}" data-unit="${a.unit||'st'}" data-price="${a.sellPrice||0}" data-vat="${a.vatRate||25}">${a.articleNumber?a.articleNumber+' – ':''}${esc(a.name)} (${fmt(a.sellPrice||0)} kr/${a.unit||'st'})</option>`
    ).join('');

    const vis = (t) => t === curType ? '' : 'display:none';

    return `
      <input type="hidden" id="il-type" value="${curType}">
      <div style="display:flex;gap:5px;margin-bottom:12px;">${typeBtns}</div>

      <!-- Tid -->
      <div id="il-tid" style="${vis('tid')}">
        ${(state.priceGroups||[]).filter(p=>p.active).length > 0 ? `
        <div class="fg"><label>Prisgrupp (auto-fyller timpris)</label>
          <select id="il-pg-tid" onchange="InvoiceDetailPage._pgChanged()">
            <option value="">— Välj prisgrupp —</option>
            ${(state.priceGroups||[]).filter(p=>p.active).map(p =>
              `<option value="${p.id}" data-rate="${p.hourRate||0}">${esc(p.name)} – ${fmt(p.hourRate||0)} kr/tim</option>`
            ).join('')}
          </select></div>` : ''}
        <div class="fg"><label>Beskrivning</label>
          <input id="il-desc-tid" value="${curType==='tid'?esc(curDesc):''}" placeholder="Arbetstid – installation"></div>
        <div class="g2">
          <div class="fg"><label>Antal timmar</label>
            <input type="number" id="il-qty-tid" value="${curType==='tid'?curQty:1}" min="0" step="0.25"
              oninput="InvoiceDetailPage._calcLineTotals()"></div>
          <div class="fg"><label>Timpris ex moms (kr)</label>
            <input type="number" id="il-price-tid" value="${curType==='tid'?curPrice:0}" min="0"
              oninput="InvoiceDetailPage._calcLineTotals()"></div>
        </div>
        <div class="fg"><label>Momssats</label>
          <select id="il-vat-tid" onchange="InvoiceDetailPage._calcLineTotals()">${vatOpts(curType==='tid'?curVat:25)}</select></div>
      </div>

      <!-- Material -->
      <div id="il-mat" style="${vis('mat')}">
        ${artOpts ? `<div class="fg"><label>Välj artikel</label>
          <select id="il-article" onchange="InvoiceDetailPage._articleSelected()">
            <option value="">— Välj från artikelregister —</option>
            ${artOpts}
          </select></div>` : ''}
        <div class="fg"><label>Beskrivning</label>
          <input id="il-desc-mat" value="${curType==='mat'?esc(curDesc):''}" placeholder="T.ex. Fogmassa, Kopparrör…"></div>
        <div class="g3">
          <div class="fg"><label>Antal</label>
            <input type="number" id="il-qty-mat" value="${curType==='mat'?curQty:1}" min="0" step="${curType==='mat'?unitStep(curUnit):1}"
              oninput="InvoiceDetailPage._calcLineTotals()"></div>
          <div class="fg"><label>Enhet</label>
            <select id="il-unit-mat" onchange="InvoiceDetailPage._unitChanged('mat')">${unitsHtml(curType==='mat'?curUnit:'st')}</select></div>
          <div class="fg"><label>Á-pris ex moms (kr)</label>
            <input type="number" id="il-price-mat" value="${curType==='mat'?curPrice:0}" min="0"
              oninput="InvoiceDetailPage._calcLineTotals()"></div>
        </div>
        <div class="fg"><label>Momssats</label>
          <select id="il-vat-mat" onchange="InvoiceDetailPage._calcLineTotals()">${vatOpts(curType==='mat'?curVat:25)}</select></div>
      </div>

      <!-- Övrigt -->
      <div id="il-ovr" style="${vis('ovr')}">
        <div class="fg"><label>Beskrivning</label>
          <input id="il-desc-ovr" value="${curType==='ovr'?esc(curDesc):''}" placeholder="T.ex. Restid, Utrustning…"></div>
        <div class="g3">
          <div class="fg"><label>Antal</label>
            <input type="number" id="il-qty-ovr" value="${curType==='ovr'?curQty:1}" min="0" step="${curType==='ovr'?unitStep(curUnit):1}"
              oninput="InvoiceDetailPage._calcLineTotals()"></div>
          <div class="fg"><label>Enhet</label>
            <select id="il-unit-ovr" onchange="InvoiceDetailPage._unitChanged('ovr')">${unitsHtml(curType==='ovr'?curUnit:'st')}</select></div>
          <div class="fg"><label>Á-pris ex moms (kr)</label>
            <input type="number" id="il-price-ovr" value="${curType==='ovr'?curPrice:0}" min="0"
              oninput="InvoiceDetailPage._calcLineTotals()"></div>
        </div>
        <div class="fg"><label>Momssats</label>
          <select id="il-vat-ovr" onchange="InvoiceDetailPage._calcLineTotals()">${vatOpts(curType==='ovr'?curVat:25)}</select></div>
      </div>

      <!-- Fastpris -->
      <div id="il-fast" style="${vis('fast')}">
        <div class="fg"><label>Beskrivning</label>
          <input id="il-desc-fast" value="${curType==='fast'?esc(curDesc):''}" placeholder="T.ex. Avtalat pris, Årsservice…"></div>
        <div class="fg"><label>Fast pris ex moms (kr)</label>
          <input type="number" id="il-price-fast" value="${curType==='fast'?curPrice:0}" min="0"
            oninput="InvoiceDetailPage._calcLineTotals()"></div>
        <div class="fg"><label>Momssats</label>
          <select id="il-vat-fast" onchange="InvoiceDetailPage._calcLineTotals()">${vatOpts(curType==='fast'?curVat:25)}</select></div>
      </div>

      <!-- Fritext -->
      <div id="il-fri" style="${vis('fri')}">
        <div class="fg"><label>Fritextrad</label>
          <textarea id="il-freetext" rows="3" placeholder="Visas som informationsrad på fakturan – ingen beräkning">${esc(curFree)}</textarea></div>
      </div>

      <!-- Live-kalkyl -->
      <div id="il-calc" style="background:var(--bg);border-radius:9px;padding:10px 12px;font-size:12px;margin-top:6px;display:none;">
        <div style="display:flex;justify-content:space-between;margin-bottom:3px;"><span style="color:var(--mt)">Summa ex moms</span><strong id="il-ex">0 kr</strong></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:3px;"><span style="color:var(--mt)">Moms</span><strong id="il-moms">0 kr</strong></div>
        <div style="display:flex;justify-content:space-between;font-weight:800;color:var(--navy);"><span>Summa inkl moms</span><span id="il-inkl">0 kr</span></div>
      </div>`;
  },

  _setType(type) {
    const hiddenInput = document.getElementById('il-type');
    if (hiddenInput) hiddenInput.value = type;
    const panels = ['tid','mat','ovr','fast','fri'];
    panels.forEach(p => {
      const el = document.getElementById('il-' + p);
      if (el) el.style.display = p === type ? '' : 'none';
    });
    const typeLabels = { tid:'Tid', mat:'Material', ovr:'Övrigt', fast:'Fastpris', fri:'Fritext' };
    const btnContainer = document.querySelector('#il-type + div');
    if (btnContainer) {
      btnContainer.querySelectorAll('button').forEach(btn => {
        const btnType = Object.keys(typeLabels).find(k => typeLabels[k] === btn.textContent.trim());
        if (btnType) {
          btn.className = 'btn ' + (btnType === type ? 'bp' : 'bs') + ' bsm';
          btn.style.cssText = 'flex:1;padding:7px 4px;font-size:11px;';
        }
      });
    }
    const calc = document.getElementById('il-calc');
    if (calc) calc.style.display = 'none';
    if (type !== 'fri') this._calcLineTotals();
  },

  _pgChanged() {
    const sel = document.getElementById('il-pg-tid');
    if (!sel || !sel.value) return;
    const opt  = sel.options[sel.selectedIndex];
    const rate = parseFloat(opt.dataset.rate) || 0;
    const priceEl = document.getElementById('il-price-tid');
    if (priceEl) { priceEl.value = rate; this._calcLineTotals(); }
  },

  _articleSelected() {
    const sel = document.getElementById('il-article');
    if (!sel || !sel.value) return;
    const opt = sel.options[sel.selectedIndex];
    const name  = opt.dataset.name  || '';
    const unit  = opt.dataset.unit  || 'st';
    const price = parseFloat(opt.dataset.price) || 0;
    const vat   = parseInt(opt.dataset.vat)     || 25;
    const descEl  = document.getElementById('il-desc-mat');
    const unitEl  = document.getElementById('il-unit-mat');
    const priceEl = document.getElementById('il-price-mat');
    const vatEl   = document.getElementById('il-vat-mat');
    const qtyEl   = document.getElementById('il-qty-mat');
    if (descEl)  descEl.value  = name;
    if (priceEl) priceEl.value = price;
    if (vatEl) {
      for (let i = 0; i < vatEl.options.length; i++) {
        if (parseInt(vatEl.options[i].value) === vat) { vatEl.selectedIndex = i; break; }
      }
    }
    if (unitEl) {
      for (let i = 0; i < unitEl.options.length; i++) {
        if (unitEl.options[i].value === unit) { unitEl.selectedIndex = i; break; }
      }
    }
    if (qtyEl) qtyEl.step = unitStep(unit);
    this._calcLineTotals();
  },

  _unitChanged(panelType) {
    const t = panelType || 'ovr';
    const unitEl = document.getElementById('il-unit-' + t);
    const qtyEl  = document.getElementById('il-qty-'  + t);
    if (unitEl && qtyEl) qtyEl.step = unitStep(unitEl.value);
    this._calcLineTotals();
  },

  _calcLineTotals() {
    const type = document.getElementById('il-type')?.value || 'ovr';
    const calc = document.getElementById('il-calc');
    if (!calc || type === 'fri') { if(calc) calc.style.display='none'; return; }

    let qty = 0, price = 0, vat = 0;
    if (type === 'tid') {
      qty   = parseFloat(document.getElementById('il-qty-tid')?.value)   || 0;
      price = parseFloat(document.getElementById('il-price-tid')?.value) || 0;
      vat   = parseFloat(document.getElementById('il-vat-tid')?.value)   || 0;
    } else if (type === 'mat') {
      qty   = parseFloat(document.getElementById('il-qty-mat')?.value)   || 0;
      price = parseFloat(document.getElementById('il-price-mat')?.value) || 0;
      vat   = parseFloat(document.getElementById('il-vat-mat')?.value)   || 0;
    } else if (type === 'ovr') {
      qty   = parseFloat(document.getElementById('il-qty-ovr')?.value)   || 0;
      price = parseFloat(document.getElementById('il-price-ovr')?.value) || 0;
      vat   = parseFloat(document.getElementById('il-vat-ovr')?.value)   || 0;
    } else if (type === 'fast') {
      qty   = 1;
      price = parseFloat(document.getElementById('il-price-fast')?.value) || 0;
      vat   = parseFloat(document.getElementById('il-vat-fast')?.value)   || 0;
    }

    const ex = qty * price;
    const momsAmt = ex * vat / 100;
    if (qty > 0 || price > 0) {
      calc.style.display = '';
      document.getElementById('il-ex').textContent   = fmt(ex) + ' kr';
      document.getElementById('il-moms').textContent = fmt(momsAmt) + ' kr';
      document.getElementById('il-inkl').textContent = fmt(ex + momsAmt) + ' kr';
    } else {
      calc.style.display = 'none';
    }
  },

  _getLineData() {
    const type = document.getElementById('il-type')?.value || 'ovr';
    const typeToSource = { tid:'Tid', mat:'Material', ovr:'Övrigt', fast:'Fastpris', fri:'Fritext' };
    const source = typeToSource[type] || 'Övrigt';

    if (type === 'fri') {
      const freetext = document.getElementById('il-freetext')?.value.trim() || '';
      return { description: freetext || '(fritext)', qty: 0, unit: 'st', unitPrice: 0, vatRate: 0, source: 'Fritext', freetext };
    }
    if (type === 'tid') {
      const desc = document.getElementById('il-desc-tid')?.value.trim();
      if (!desc) { showToast('Beskrivning krävs'); return null; }
      return {
        description: desc,
        qty:       parseFloat(document.getElementById('il-qty-tid')?.value)   || 1,
        unit:      'tim',
        unitPrice: parseFloat(document.getElementById('il-price-tid')?.value) || 0,
        vatRate:   parseFloat(document.getElementById('il-vat-tid')?.value)   || 25,
        source:    'Tid'
      };
    }
    if (type === 'mat') {
      const desc = document.getElementById('il-desc-mat')?.value.trim();
      if (!desc) { showToast('Beskrivning krävs'); return null; }
      return {
        description: desc,
        qty:       parseFloat(document.getElementById('il-qty-mat')?.value)   || 1,
        unit:      document.getElementById('il-unit-mat')?.value              || 'st',
        unitPrice: parseFloat(document.getElementById('il-price-mat')?.value) || 0,
        vatRate:   parseFloat(document.getElementById('il-vat-mat')?.value)   || 25,
        source:    'Material'
      };
    }
    if (type === 'fast') {
      const desc = document.getElementById('il-desc-fast')?.value.trim();
      if (!desc) { showToast('Beskrivning krävs'); return null; }
      return {
        description: desc,
        qty:       1,
        unit:      'st',
        unitPrice: parseFloat(document.getElementById('il-price-fast')?.value) || 0,
        vatRate:   parseFloat(document.getElementById('il-vat-fast')?.value)   || 25,
        source:    'Fastpris'
      };
    }
    // ovr (Övrigt)
    const desc = document.getElementById('il-desc-ovr')?.value.trim();
    if (!desc) { showToast('Beskrivning krävs'); return null; }
    return {
      description: desc,
      qty:       parseFloat(document.getElementById('il-qty-ovr')?.value)   || 1,
      unit:      document.getElementById('il-unit-ovr')?.value              || 'st',
      unitPrice: parseFloat(document.getElementById('il-price-ovr')?.value) || 0,
      vatRate:   parseFloat(document.getElementById('il-vat-ovr')?.value)   || 25,
      source:    'Övrigt'
    };
  },

  openAddLine() {
    if (!Auth.require('invoice_create')) return;
    Modal.open({
      title: 'Lägg till rad',
      body: this._lineFormHtml(null),
      buttons: [
        { label: 'Lägg till', cls: 'btn bp', onClick: () => {
          const data = InvoiceDetailPage._getLineData();
          if (!data) return;
          InvoiceService.addLine(this.invoiceId, data);
          Modal.close();
          this._refresh();
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => {
      InvoiceDetailPage._calcLineTotals();
      const inv = getInv(this.invoiceId);
      if (inv && inv.workOrderId) {
        const ao = (state.workOrders||[]).find(a => a.id === inv.workOrderId);
        if (ao && ao.priceGroupId) {
          const pgSel = document.getElementById('il-pg-tid');
          if (pgSel) {
            for (let i = 0; i < pgSel.options.length; i++) {
              if (pgSel.options[i].value === ao.priceGroupId) {
                pgSel.selectedIndex = i;
                InvoiceDetailPage._pgChanged();
                break;
              }
            }
          }
        }
      }
    }, 80);
  },

  openEditLine(lineId) {
    const inv  = getInv(this.invoiceId);
    const line = (inv.lines||[]).find(l=>l.id===lineId);
    if (!line) return;
    Modal.open({
      title: 'Redigera rad',
      body: this._lineFormHtml(line),
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          const data = InvoiceDetailPage._getLineData();
          if (!data) return;
          InvoiceService.updateLine(this.invoiceId, lineId, data);
          Modal.close();
          this._refresh();
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => { InvoiceDetailPage._calcLineTotals(); }, 80);
  },

  deleteLine(lineId) {
    Modal.confirm('Ta bort rad?', () => {
      InvoiceService.deleteLine(this.invoiceId, lineId);
      this._refresh();
    });
  },

  setStatus(status) {
    InvoiceService.setStatus(this.invoiceId, status);
    this.render({ invoiceId: this.invoiceId });
    showToast(`Status: ${statusLabel(status)}`);
  },

  _refresh() {
    const inv = getInv(this.invoiceId);
    if (!inv) return;
    this.render({ invoiceId: this.invoiceId });
  }
};
