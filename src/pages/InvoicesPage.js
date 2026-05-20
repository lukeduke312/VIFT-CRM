/**
 * InvoicesPage — Fakturaunderlag lista + detalj
 */
const InvoicesPage = {
  render() {
    const el = document.getElementById('pg-invoices-content');
    if (!el) return;
    const invoices = state.invoices || [];
    const ready    = WorkOrderService.readyForInvoice();

    el.innerHTML = `
      ${ready.length > 0 ? `
        <div class="card" style="border-color:var(--gr);border-left:4px solid var(--gr);">
          <div class="card-header">
            <h3 style="color:var(--gr);">${ic('alert-triangle',14)} Klara ordrar – väntar fakturering</h3>
            <span class="bdg bdg-green">${ready.length}</span>
          </div>
          <div class="card-body" style="padding:6px 14px;">
            ${ready.slice(0,5).map(ao => {
              const cu = getCu(ao.customerId);
              return `<div class="crow" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">
                <div><div style="font-size:13px;font-weight:700;">${ao.id} – ${ao.title}</div>
                  <div style="font-size:11px;color:var(--mt);">${cu?CustomerService.displayName(cu):'—'}</div></div>
                <button class="btn bsm bsu" onclick="event.stopPropagation();InvoicesPage.createFromAO('${ao.id}')">
                  ${ic('file-plus',13)} Skapa
                </button>
              </div>`;
            }).join('')}
          </div>
        </div>` : ''}

      <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;">
        <h3 style="flex:1;font-size:14px;font-weight:700;">Fakturaunderlag</h3>
        <button class="btn bp bsm" onclick="InvoicesPage.createBlank()">
          ${ic('plus',14)} Ny faktura
        </button>
      </div>

      ${invoices.length === 0
        ? `<div class="empty">${ic('receipt',32)}<h3>Inga fakturaunderlag</h3><p>Skapa från en klar arbetsorder</p></div>`
        : invoices.map(inv => {
            const cu = getCu(inv.customerId);
            const t  = InvoiceService.calcTotals(inv);
            return `
              <div class="list-item" onclick="Router.showPage('pg-inv-detail',{invoiceId:'${inv.id}'})">
                <div class="item-row">
                  <div>
                    <div class="item-title">${inv.id} – ${cu?CustomerService.displayName(cu):'—'}</div>
                    <div class="item-sub">${fkr(t.total)} inkl. moms · ${fmtDate(inv.createdAt)}</div>
                  </div>
                  ${sbdg(inv.status)}
                </div>
              </div>`;
          }).join('')}`;
  },

  createFromAO(aoId) {
    const result = InvoiceService.createFromAO(aoId);
    if (!result.ok) { showToast(result.error); return; }
    showToast(`${result.invoice.id} skapat`);
    Router.showPage('pg-inv-detail', { invoiceId: result.invoice.id });
  },

  createBlank() {
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

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
        <button class="btn bs bsm" onclick="Router.showPage('pg-invoices')">${ic('arrow-left',14)}</button>
        <div style="flex:1;">
          <div style="font-size:16px;font-weight:800;">${inv.id}</div>
          ${inv.title ? `<div style="font-size:13px;color:var(--mt);">${inv.title}</div>` : ''}
          <div>${sbdg(inv.status)}</div>
        </div>
        <select class="btn bs bsm" style="font-weight:600;" onchange="InvoiceDetailPage.setStatus(this.value)">
          ${statusOpts.map(s=>`<option value="${s}" ${inv.status===s?'selected':''}>${statusLabel(s)}</option>`).join('')}
        </select>
      </div>

      <!-- Kundinfo -->
      <div class="card">
        <div class="card-header"><h3>Faktureras till</h3></div>
        <div class="card-body">
          <div class="dr"><span class="dk">Kund</span><span class="dv">${cu?CustomerService.displayName(cu):'—'}</span></div>
          ${cu ? `<div class="dr"><span class="dk">Adress</span><span class="dv">${cu.address||'—'}${cu.city?', '+cu.city:''}</span></div>` : ''}
          ${cu && cu.orgNr ? `<div class="dr"><span class="dk">Org.nr</span><span class="dv">${cu.orgNr}</span></div>` : ''}
          <div class="dr"><span class="dk">Förfallodatum</span><span class="dv">${fmtDate(inv.dueDate)}</span></div>
          ${inv.workOrderId ? `<div class="dr"><span class="dk">Från AO</span>
            <span class="dv" style="cursor:pointer;color:var(--sky);" onclick="Router.showPage('pg-ao-detail',{aoId:'${inv.workOrderId}'})">${inv.workOrderId}</span></div>` : ''}
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

      ${inv.note ? `<div class="nbox">${inv.note}</div>` : ''}

      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${inv.status === 'utkast'  ? `<button class="btn bp bsm" onclick="InvoiceDetailPage.setStatus('skickad')">${ic('send',14)} Markera skickad</button>` : ''}
        ${inv.status === 'skickad' ? `<button class="btn bsu bsm" onclick="InvoiceDetailPage.setStatus('betald')">${ic('check-circle',14)} Markera betald</button>` : ''}
        <button class="btn bs bsm" onclick="showToast('PDF-export byggs i Fas 4')">${ic('printer',14)} PDF</button>
      </div>`;
  },

  _renderLines(inv) {
    const lines = inv.lines || [];
    if (!lines.length) return `<p style="padding:12px 14px;color:var(--mt);font-size:13px;">Inga rader</p>`;
    return lines.map(l => {
      const exVat  = (l.qty||0) * (l.unitPrice||0);
      const vatAmt = exVat * ((l.vatRate||25) / 100);
      const typeIcon = { Tid: 'clock', Material: 'package', Fastpris: 'file-check', Manuell: 'pencil', Manuell_rad: 'pencil' }[l.source] || 'file-text';
      const typeCls  = { Tid: 'bdg-sky', Material: 'bdg-orange', Fastpris: 'bdg-green', Manuell: 'bdg-grey' }[l.source] || 'bdg-grey';
      return `
        <div style="padding:10px 14px;border-bottom:1px solid var(--bg);">
          <div style="display:flex;align-items:flex-start;gap:8px;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:700;margin-bottom:2px;">${l.description}</div>
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
    const units = ['st','tim','m²','m','lm','gång','dag','månad','km'];
    const vatRates = [0, 6, 12, 25];
    const curVat   = line ? (line.vatRate != null ? line.vatRate : 25) : 25;
    return `
      <div class="fg"><label>Beskrivning <span style="color:var(--rd)">*</span></label>
        <input id="il-desc" value="${line ? line.description||'' : ''}" placeholder="T.ex. Arbetstid, Fogmassa…"></div>
      <div class="g3">
        <div class="fg"><label>Antal</label><input type="number" id="il-qty" value="${line ? line.qty||1 : 1}" min="0" step="0.01"></div>
        <div class="fg"><label>Enhet</label>
          <select id="il-unit">${units.map(u=>`<option value="${u}" ${line&&line.unit===u?'selected':''}>${u}</option>`).join('')}</select></div>
        <div class="fg"><label>À-pris ex moms (kr)</label>
          <input type="number" id="il-price" value="${line ? line.unitPrice||0 : 0}" min="0" oninput="InvoiceDetailPage._calcLineTotals()"></div>
      </div>
      <div class="g2">
        <div class="fg"><label>Momssats</label>
          <select id="il-vat" onchange="InvoiceDetailPage._calcLineTotals()">
            ${vatRates.map(r=>`<option value="${r}" ${r===curVat?'selected':''}>${r}%</option>`).join('')}
          </select></div>
        <div class="fg"><label>Typ</label>
          <select id="il-type">
            ${['Manuell','Tid','Material','Fastpris'].map(t=>`<option value="${t}" ${line&&line.source===t?'selected':''}>${t}</option>`).join('')}
          </select></div>
      </div>
      <div id="il-calc" style="background:var(--bg);border-radius:9px;padding:10px 12px;font-size:12px;display:none;">
        <div style="display:flex;justify-content:space-between;margin-bottom:3px;"><span style="color:var(--mt)">Summa ex moms</span><span id="il-ex">0 kr</span></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:3px;"><span style="color:var(--mt)">Moms</span><span id="il-moms">0 kr</span></div>
        <div style="display:flex;justify-content:space-between;font-weight:800;"><span>Summa inkl moms</span><span id="il-inkl">0 kr</span></div>
      </div>`;
  },

  _calcLineTotals() {
    const qty   = parseFloat(document.getElementById('il-qty')?.value) || 0;
    const price = parseFloat(document.getElementById('il-price')?.value) || 0;
    const vat   = parseFloat(document.getElementById('il-vat')?.value) || 0;
    const calc  = document.getElementById('il-calc');
    if (!calc) return;
    const ex = qty * price;
    const momsAmt = ex * vat / 100;
    if (ex > 0 || price > 0) {
      calc.style.display = '';
      document.getElementById('il-ex').textContent   = fmt(ex) + ' kr';
      document.getElementById('il-moms').textContent  = fmt(momsAmt) + ' kr';
      document.getElementById('il-inkl').textContent  = fmt(ex + momsAmt) + ' kr';
    } else {
      calc.style.display = 'none';
    }
  },

  openAddLine() {
    Modal.open({
      title: 'Lägg till rad',
      body: this._lineFormHtml(null),
      buttons: [
        { label: 'Lägg till', cls: 'btn bp', onClick: () => {
          const desc = document.getElementById('il-desc')?.value.trim();
          if (!desc) { showToast('Beskrivning krävs'); return; }
          InvoiceService.addLine(this.invoiceId, {
            description: desc,
            qty:      parseFloat(document.getElementById('il-qty')?.value)||1,
            unit:     document.getElementById('il-unit')?.value||'st',
            unitPrice:parseFloat(document.getElementById('il-price')?.value)||0,
            vatRate:  parseFloat(document.getElementById('il-vat')?.value)||25,
            source:   document.getElementById('il-type')?.value||'Manuell'
          });
          Modal.close();
          this._refresh();
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => InvoiceDetailPage._calcLineTotals(), 80);
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
          const desc = document.getElementById('il-desc')?.value.trim();
          if (!desc) { showToast('Beskrivning krävs'); return; }
          InvoiceService.updateLine(this.invoiceId, lineId, {
            description: desc,
            qty:      parseFloat(document.getElementById('il-qty')?.value)||1,
            unit:     document.getElementById('il-unit')?.value||'st',
            unitPrice:parseFloat(document.getElementById('il-price')?.value)||0,
            vatRate:  parseFloat(document.getElementById('il-vat')?.value)||25,
            source:   document.getElementById('il-type')?.value||line.source||'Manuell'
          });
          Modal.close();
          this._refresh();
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => InvoiceDetailPage._calcLineTotals(), 80);
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
    document.getElementById('inv-lines').innerHTML = this._renderLines(inv);
    const t = InvoiceService.calcTotals(inv);
    // Re-render totals
    this.render({ invoiceId: this.invoiceId });
  }
};
