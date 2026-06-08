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
        <button class="btn bs bsm" onclick="InvoicesPage.exportCSV()">${ic('download',14)} CSV</button>
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
  },

  exportCSV() {
    InvoiceService.exportCSV();
    showToast('CSV exporterad');
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
          ${inv.customerReference ? `<div class="dr"><span class="dk">Er referens</span><span class="dv">${esc(inv.customerReference)}</span></div>` : ''}
          ${inv.ocr ? `<div class="dr"><span class="dk">OCR</span><span class="dv" style="font-family:monospace;font-weight:700;">${esc(inv.ocr)}</span></div>` : ''}
          ${inv.sentAt ? `<div class="dr"><span class="dk">Skickad</span><span class="dv">${fmtDate(inv.sentAt)}</span></div>` : ''}
          ${inv.paidAt ? `<div class="dr"><span class="dk" style="color:var(--gr);">Betald</span><span class="dv" style="color:var(--gr);font-weight:700;">${fmtDate(inv.paidAt)}</span></div>` : ''}
          <div class="dr"><span class="dk">Skapad</span><span class="dv">${fmtDate(inv.createdAt)}</span></div>
        </div>
        <div style="padding:4px 14px 10px;">
          <button class="btn bxs bs" onclick="InvoiceDetailPage.openEditMeta()">${ic('pencil',11)} Redigera referens/OCR</button>
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
        ${this._renderTotals(inv)}
      </div>

      ${inv.note ? `<div class="nbox">${esc(inv.note)}</div>` : ''}

      <!-- Intern ekonomi -->
      ${inv.workOrderId ? this._internEkonomi(inv) : ''}

      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${inv.status === 'utkast'  ? `<button class="btn bp bsm" onclick="InvoiceDetailPage.setStatus('skickad')">${ic('send',14)} Markera skickad</button>` : ''}
        ${inv.status === 'skickad' ? `<button class="btn bsu bsm" onclick="InvoiceDetailPage.setStatus('betald')">${ic('check-circle',14)} Markera betald</button>` : ''}
        <button class="btn bs bsm" onclick="InvoiceDetailPage.showPrintView()">${ic('printer',14)} PDF / Skriv ut</button>
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

  _internEkonomi(inv) {
    const ao = (state.workOrders || []).find(a => a.id === inv.workOrderId);
    if (!ao) return '';
    const tb = ProfitabilityService.calcTB(ao);
    if (tb.revenue.value === 0 && tb.totalCost === 0) return '';
    const borderColor = tb.tbPct !== null ? tb.color : 'var(--br)';
    return `
      <div class="card" style="border-left:3px solid ${borderColor};">
        <div class="card-header">
          <h3>${ic('trending-up',14)} Intern ekonomi <span style="font-size:10px;color:var(--mt);margin-left:4px;">${ic('eye-off',9)} Syns ej för kund</span></h3>
          ${tb.tbPct !== null ? `<span class="bdg ${tb.badge}">${Math.round(tb.tbPct)} % TB</span>` : ''}
        </div>
        <div class="card-body" style="padding:10px 14px;">
          <div class="dr"><span class="dk">Fakturerat ex moms</span><span class="dv">${fkr(tb.revenue.value)}</span></div>
          ${tb.material.buyEx > 0 ? `<div class="dr"><span class="dk">Material inköp</span><span class="dv" style="color:var(--rd);">${fkr(tb.material.buyEx)}</span></div>` : ''}
          ${tb.labor.cost > 0 ? `<div class="dr"><span class="dk">Intern arbetskostnad</span><span class="dv" style="color:var(--rd);">${fkr(tb.labor.cost)} <span style="font-size:10px;color:var(--mt);">(${TimeService.fmtDuration(tb.labor.minutes)} × ${fmt(tb.labor.rate)} kr/h)</span></span></div>` : ''}
          <div class="dr"><span class="dk">Total kostnad</span><span class="dv" style="color:var(--rd);font-weight:700;">${fkr(tb.totalCost)}</span></div>
          <div class="dr" style="font-size:15px;font-weight:800;border-top:2px solid var(--br);padding-top:8px;margin-top:4px;">
            <span class="dk" style="color:${tb.color};">Täckningsbidrag</span>
            <span class="dv" style="color:${tb.color};">${fkr(tb.tb)}${tb.tbPct !== null ? ` <span style="font-size:12px;">(${Math.round(tb.tbPct)} %)</span>` : ''}</span>
          </div>
          ${tb.tbPct !== null ? `<div class="dr">
            <span class="dk">TB %</span>
            <span class="dv" style="display:flex;align-items:center;gap:6px;justify-content:flex-end;">
              <strong style="font-size:14px;color:${tb.color};">${Math.round(tb.tbPct)} %</strong>
              <span class="bdg ${tb.badge}">${tb.label}</span>
            </span>
          </div>` : ''}
        </div>
      </div>`;
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
  },

  _renderTotals(inv) {
    const s    = InvoiceService.calcSummary(inv);
    const disc = inv.discount    || { type: 'none', value: 0 };
    const tr   = inv.taxReduction|| { type: 'none', amount: 0, note: '' };
    const hasDiscount = s.discAmt > 0;
    const hasRot      = s.trAmount > 0;
    return `
      <div style="padding:12px 14px;border-top:2px solid var(--br);">
        ${hasDiscount ? `
        <div class="dr"><span class="dk" style="color:var(--mt);">Radernas summa</span><span class="dv">${fkr(s.linesEx)}</span></div>
        <div class="dr" style="color:var(--gr);">
          <span class="dk">${ic('tag',10)} Rabatt${disc.type==='percent'?' '+disc.value+'%':''}</span>
          <span class="dv">− ${fkr(s.discAmt)}</span>
        </div>` : ''}
        <div class="dr"><span class="dk">Summa ex. moms</span><span class="dv">${fkr(s.exVat)}</span></div>
        <div class="dr"><span class="dk">Moms</span><span class="dv">${fkr(s.vat)}</span></div>
        <div class="dr" style="font-size:${hasRot?'14':'16'}px;font-weight:800;border-top:2px solid var(--br);padding-top:8px;margin-top:4px;">
          <span class="dk" style="color:var(--navy);">Totalt inkl. moms</span>
          <span class="dv" style="color:var(--navy);">${fkr(s.totalInclVat)}</span>
        </div>
        ${hasRot ? `
        <div class="dr" style="color:var(--gr);margin-top:4px;">
          <span class="dk">${ic('percent',10)} ${tr.type.toUpperCase()}-avdrag${tr.note?' ('+esc(tr.note)+')':''}</span>
          <span class="dv">− ${fkr(s.trAmount)}</span>
        </div>
        <div class="dr" style="font-size:16px;font-weight:800;border-top:2px solid var(--br);padding-top:8px;margin-top:4px;">
          <span class="dk" style="color:var(--navy);">Kunden betalar</span>
          <span class="dv" style="color:var(--navy);">${fkr(s.customerPays)}</span>
        </div>` : ''}
        <div style="display:flex;gap:6px;margin-top:10px;padding-top:8px;border-top:1px dashed var(--bg);">
          <button class="btn bxs bs" onclick="InvoiceDetailPage.openDiscount()" title="Sätt rabatt">${ic('tag',11)} Rabatt</button>
          <button class="btn bxs bs" onclick="InvoiceDetailPage.openTaxReduction()" title="RUT/ROT-avdrag">${ic('percent',11)} RUT/ROT</button>
        </div>
      </div>`;
  },

  openEditMeta() {
    const inv = getInv(this.invoiceId);
    if (!inv) return;
    Modal.open({
      title: `${ic('edit',15)} Referens & OCR`,
      body: `
        <div class="fg"><label>Er referens (visas på faktura)</label>
          <input id="em-ref" value="${esc(inv.customerReference||'')}" placeholder="T.ex. namn, projektnummer…"></div>
        <div class="fg"><label>OCR-nummer</label>
          <input id="em-ocr" value="${esc(inv.ocr||'')}" placeholder="Auto: ${inv.id.replace(/\D/g,'').padStart(6,'0')}">
          <p style="font-size:11px;color:var(--mt);margin-top:4px;">Lämna tomt för auto-genererat. Syns vid betalning.</p></div>
        <div class="fg"><label>Intern kommentar (visas ej på faktura)</label>
          <textarea id="em-note" rows="2">${esc(inv.note||'')}</textarea></div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          inv.customerReference = document.getElementById('em-ref')?.value.trim() || '';
          inv.ocr               = document.getElementById('em-ocr')?.value.trim() || '';
          inv.note              = document.getElementById('em-note')?.value.trim() || '';
          inv.updatedAt = new Date().toISOString();
          persist(); Modal.close(); this._refresh();
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  openDiscount() {
    const inv  = getInv(this.invoiceId);
    if (!inv) return;
    const disc = inv.discount || { type: 'none', value: 0 };
    Modal.open({
      title: `${ic('tag',15)} Rabatt`,
      body: `
        <div class="fg"><label>Rabattyp</label>
          <select id="disc-type" onchange="InvoiceDetailPage._discTypeChanged()">
            <option value="none"  ${disc.type==='none'   ?'selected':''}>Ingen rabatt</option>
            <option value="percent" ${disc.type==='percent'?'selected':''}>Procent (%)</option>
            <option value="fixed"   ${disc.type==='fixed'  ?'selected':''}>Fast belopp (kr)</option>
          </select></div>
        <div id="disc-val-wrap" style="${disc.type==='none'?'display:none':''}">
          <div class="fg"><label id="disc-val-label">${disc.type==='percent'?'Rabatt %':'Rabatt kr'}</label>
            <input type="number" id="disc-value" value="${disc.type==='none'?0:disc.value}" min="0" step="${disc.type==='percent'?'1':'100'}"></div>
        </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          const type  = document.getElementById('disc-type')?.value  || 'none';
          const value = parseFloat(document.getElementById('disc-value')?.value) || 0;
          InvoiceService.setDiscount(this.invoiceId, type, value);
          Modal.close(); this._refresh();
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _discTypeChanged() {
    const type = document.getElementById('disc-type')?.value;
    const wrap = document.getElementById('disc-val-wrap');
    const lbl  = document.getElementById('disc-val-label');
    if (wrap) wrap.style.display = type === 'none' ? 'none' : '';
    if (lbl)  lbl.textContent = type === 'percent' ? 'Rabatt %' : 'Rabatt kr';
  },

  openTaxReduction() {
    const inv = getInv(this.invoiceId);
    if (!inv) return;
    const tr = inv.taxReduction || { type: 'none', amount: 0, basis: 0, note: '' };
    Modal.open({
      title: `${ic('percent',15)} RUT/ROT-avdrag`,
      body: `
        <div class="fg"><label>Typ av skattereduktion</label>
          <select id="tr-type" onchange="InvoiceDetailPage._trTypeChanged()">
            <option value="none" ${tr.type==='none'?'selected':''}>Ingen</option>
            <option value="rot"  ${tr.type==='rot' ?'selected':''}>ROT-avdrag (30 %)</option>
            <option value="rut"  ${tr.type==='rut' ?'selected':''}>RUT-avdrag (50 %)</option>
          </select></div>
        <div id="tr-fields" style="${tr.type==='none'?'display:none':''}">
          <div class="fg"><label>Underlag – berättigat arbete ex moms (kr)</label>
            <input type="number" id="tr-basis" value="${tr.basis||0}" min="0" step="100"
              oninput="InvoiceDetailPage._trCalc()"></div>
          <div class="fg"><label>Avdragsbelopp (kr) <span style="color:var(--mt);font-size:11px;">— auto-beräknat, kan justeras</span></label>
            <input type="number" id="tr-amount" value="${tr.amount||0}" min="0" step="100"></div>
          <div class="fg"><label>Notering (visas på faktura)</label>
            <input id="tr-note" value="${esc(tr.note||'')}" placeholder="T.ex. ROT 30% av arbete 5 560 kr"></div>
        </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          const type   = document.getElementById('tr-type')?.value || 'none';
          const basis  = parseFloat(document.getElementById('tr-basis')?.value)  || 0;
          const amount = parseFloat(document.getElementById('tr-amount')?.value) || 0;
          const note   = document.getElementById('tr-note')?.value.trim() || '';
          InvoiceService.setTaxReduction(this.invoiceId, type, amount, basis, note);
          Modal.close(); this._refresh();
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _trTypeChanged() {
    const type   = document.getElementById('tr-type')?.value;
    const fields = document.getElementById('tr-fields');
    if (fields) fields.style.display = type === 'none' ? 'none' : '';
    this._trCalc();
  },

  _trCalc() {
    const type   = document.getElementById('tr-type')?.value;
    const basis  = parseFloat(document.getElementById('tr-basis')?.value) || 0;
    const amtEl  = document.getElementById('tr-amount');
    if (!amtEl || type === 'none') return;
    const rate   = type === 'rut' ? 0.50 : 0.30;
    amtEl.value  = Math.round(basis * rate);
  },

  showPrintView() {
    const inv = getInv(this.invoiceId);
    if (!inv) return;
    const html = this._buildPrintHTML(inv);
    const w = window.open('', '_blank', 'width=900,height=750,scrollbars=yes');
    if (!w) { showToast('Tillåt popup för att öppna utskriftsvy'); return; }
    w.document.write(html);
    w.document.close();
    setTimeout(() => { try { w.print(); } catch(e) {} }, 800);
  },

  _buildPrintHTML(inv) {
    const s        = InvoiceService.calcSummary(inv);
    const cu       = getCu(inv.customerId);
    const settings = state.settings || {};
    const ao       = inv.workOrderId ? getAO(inv.workOrderId) : null;
    const off      = inv.offerId ? (state.offers||[]).find(o=>o.id===inv.offerId) : null;
    const disc     = inv.discount    || { type: 'none', value: 0 };
    const tr       = inv.taxReduction|| { type: 'none', amount: 0, note: '' };

    const logoSrc    = BrandingService.logoLightAbsolute();
    const coName     = esc(settings.companyName  || 'VIFT');
    const coOrgNr    = esc(settings.orgNr         || '');
    const coVatNr    = esc(settings.vatNr         || '');
    const coAddr     = esc(settings.companyAddress|| '');
    const coPhone    = esc(settings.companyPhone  || '');
    const coEmail    = esc(settings.companyEmail  || '');
    const bankgiro   = esc(settings.bankgiro      || '');

    const cuName     = cu ? esc(CustomerService.displayName(cu)) : '';
    const cuAddr     = cu ? [cu.invoiceAddress||cu.address, cu.invoiceZip||cu.zip, cu.invoiceCity||cu.city].filter(Boolean).map(esc).join(', ') : '';
    const cuOrgNr    = cu && cu.orgNr    ? esc(cu.orgNr)    : '';
    const cuPersonnr = cu && cu.personnr ? esc(cu.personnr) : '';

    const invDate = (inv.createdAt||'').split('T')[0] || tdy();
    const ocr     = inv.ocr || inv.id.replace(/\D/g,'').padStart(6,'0');

    const linesHtml = (inv.lines||[]).map(l => {
      const ex = Math.round((l.qty||0)*(l.unitPrice||0));
      return `<tr><td>${esc(l.description)}</td><td class="r">${l.qty}</td><td>${esc(l.unit||'')}</td><td class="r">${fmt(l.unitPrice||0)}</td><td class="r">${l.vatRate||25}%</td><td class="r">${fmt(ex)}</td></tr>`;
    }).join('');

    const refs = [];
    if (ao)  refs.push('AO: ' + esc(ao.id) + (ao.title?' – '+esc(ao.title):''));
    if (off) refs.push('Offert: ' + esc(off.id) + ' (v' + (off.versionNumber||1) + ')');
    if (inv.customerReference) refs.push('Er ref: ' + esc(inv.customerReference));

    const hasDiscount = s.discAmt > 0;
    const hasRot      = s.trAmount > 0;
    const trLabel     = tr.type === 'rut' ? 'RUT-avdrag' : 'ROT-avdrag';

    return `<!DOCTYPE html><html lang="sv"><head><meta charset="UTF-8">
<title>Faktura ${esc(inv.id)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:Arial,sans-serif;font-size:11px;color:#1a1a1a;background:#fff;padding:12mm 14mm;}
h1{font-size:22px;font-weight:900;color:#0f3763;letter-spacing:-0.5px;}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid #0f3763;}
.logo{max-height:44px;max-width:150px;}
.co{font-size:10px;color:#555;line-height:1.5;margin-top:5px;}
.inv-r{text-align:right;}
.inv-num{font-size:12px;font-weight:700;color:#0f3763;margin-top:3px;}
.inv-sub{font-size:10px;color:#777;}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:10px 0;padding:10px 0;border-bottom:1px solid #e5e7eb;}
.lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#999;margin-bottom:3px;}
.pname{font-size:12px;font-weight:700;}
.paddr{font-size:10px;color:#444;line-height:1.5;margin-top:2px;}
.dbar{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:8px 0;background:#f8f9fb;padding:7px 10px;border-radius:5px;}
.dl{font-size:9px;color:#999;text-transform:uppercase;letter-spacing:.5px;}
.dv{font-size:11px;font-weight:700;color:#0f3763;margin-top:1px;}
.refs{font-size:10px;color:#666;margin:6px 0 8px;}
table{width:100%;border-collapse:collapse;margin:6px 0;}
thead th{background:#0f3763;color:#fff;padding:6px 8px;text-align:left;font-size:10px;font-weight:700;}
th.r,td.r{text-align:right;}
tbody td{padding:5px 8px;border-bottom:1px solid #f0f0f0;font-size:10px;}
tbody tr:last-child td{border-bottom:none;}
.totals{margin-left:auto;width:260px;margin-top:4px;}
.trow{display:flex;justify-content:space-between;padding:2px 0;font-size:11px;}
.tbold{font-weight:700;}
.tdiv{border-top:1px solid #e5e7eb;margin:3px 0;}
.tfinal{font-size:13px;font-weight:800;color:#0f3763;border-top:2px solid #0f3763;padding-top:5px;margin-top:3px;display:flex;justify-content:space-between;}
.tgreen{color:#15803d;}
.pay{margin-top:12px;padding:8px 10px;background:#f8f9fb;border-radius:5px;font-size:10px;}
.pay strong{font-size:11px;color:#0f3763;display:block;margin-bottom:3px;}
.pay-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px;}
.ocr{font-size:14px;font-weight:800;font-family:monospace;letter-spacing:2px;color:#0f3763;}
.note{margin-top:8px;padding:7px 9px;background:#fffbeb;border-left:3px solid #d97706;font-size:10px;color:#555;line-height:1.4;}
.foot{margin-top:14px;padding-top:7px;border-top:1px solid #e5e7eb;font-size:9px;color:#aaa;text-align:center;}
@media print{@page{margin:10mm;size:A4;}body{padding:0;}}
</style></head><body>

<div class="hdr">
  <div>
    <img src="${logoSrc}" class="logo" alt="${coName}" onerror="this.style.display='none'">
    <div class="co">
      ${coAddr ? coAddr + '<br>' : ''}
      ${coPhone}${coPhone && coEmail ? ' &nbsp;·&nbsp; ' : ''}${coEmail}<br>
      ${coOrgNr ? 'Org.nr: ' + coOrgNr : ''}${coOrgNr && coVatNr ? ' &nbsp;·&nbsp; ' : ''}${coVatNr ? 'Momsreg.nr: ' + coVatNr : ''}
    </div>
  </div>
  <div class="inv-r">
    <h1>FAKTURA</h1>
    <div class="inv-num">${esc(inv.id)}</div>
    ${inv.title ? '<div class="inv-sub">' + esc(inv.title) + '</div>' : ''}
  </div>
</div>

<div class="parties">
  <div>
    <div class="lbl">Faktureras till</div>
    <div class="pname">${cuName||'—'}</div>
    <div class="paddr">${cuAddr ? cuAddr + '<br>' : ''}${cuOrgNr ? 'Org.nr: ' + cuOrgNr + '<br>' : ''}${cuPersonnr ? 'Personnr: ' + cuPersonnr : ''}</div>
  </div>
  <div>
    <div class="lbl">Leverantör</div>
    <div class="pname">${coName}</div>
    <div class="paddr">${coAddr ? coAddr + '<br>' : ''}${coOrgNr ? 'Org.nr: ' + coOrgNr : ''}</div>
  </div>
</div>

<div class="dbar">
  <div><div class="dl">Fakturanr</div><div class="dv">${esc(inv.id)}</div></div>
  <div><div class="dl">Fakturadatum</div><div class="dv">${invDate}</div></div>
  <div><div class="dl">Förfallodatum</div><div class="dv">${inv.dueDate||'—'}</div></div>
  <div><div class="dl">Betalningsvillkor</div><div class="dv">${inv.paymentTerms||30} dagar</div></div>
</div>

${refs.length ? '<div class="refs">' + refs.join(' &nbsp;·&nbsp; ') + '</div>' : ''}

<table>
  <thead><tr>
    <th>Beskrivning</th>
    <th class="r" style="width:48px">Antal</th>
    <th style="width:38px">Enhet</th>
    <th class="r" style="width:68px">Á-pris</th>
    <th class="r" style="width:38px">Moms</th>
    <th class="r" style="width:72px">Belopp</th>
  </tr></thead>
  <tbody>${linesHtml}</tbody>
</table>

<div class="totals">
  ${hasDiscount ? `<div class="trow"><span>Radernas summa</span><span>${fmt(s.linesEx)} kr</span></div>
  <div class="trow tgreen"><span>Rabatt (${disc.type==='percent'?disc.value+'%':'fast belopp'})</span><span>− ${fmt(s.discAmt)} kr</span></div>
  <div class="tdiv"></div>` : ''}
  <div class="trow"><span>Summa ex. moms</span><span>${fmt(s.exVat)} kr</span></div>
  <div class="trow"><span>Moms 25%</span><span>${fmt(s.vat)} kr</span></div>
  <div class="tdiv"></div>
  <div class="tfinal"><span>Totalt inkl. moms</span><span>${fmt(s.totalInclVat)} kr</span></div>
  ${hasRot ? `<div class="tdiv" style="margin-top:6px;"></div>
  <div class="trow tgreen" style="margin-top:3px;"><span>${trLabel}${tr.note?' ('+esc(tr.note)+')':''}</span><span>− ${fmt(s.trAmount)} kr</span></div>
  <div class="tdiv"></div>
  <div class="tfinal"><span>Kunden betalar</span><span>${fmt(s.customerPays)} kr</span></div>` : ''}
</div>

<div class="pay">
  <strong>Betalningsinformation</strong>
  <div class="pay-grid">
    <div>
      ${bankgiro ? '<div>Bankgiro: <strong>' + bankgiro + '</strong></div>' : ''}
      <div>Betalningsvillkor: ${inv.paymentTerms||30} dagar netto</div>
    </div>
    <div>
      <div style="color:#888;font-size:9px;margin-bottom:2px;">OCR-nummer – ange vid betalning</div>
      <div class="ocr">${esc(ocr)}</div>
    </div>
  </div>
</div>

${inv.note ? '<div class="note">' + esc(inv.note) + '</div>' : ''}

<div class="foot">${coName}${coOrgNr?' &nbsp;·&nbsp; Org.nr: '+coOrgNr:''}${coVatNr?' &nbsp;·&nbsp; Momsreg.nr: '+coVatNr:''}</div>
</body></html>`;
  }
};
