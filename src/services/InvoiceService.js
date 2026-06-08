/**
 * InvoiceService — Fakturaunderlag
 * Skapar fakturor från AO (tid + material + fastpris)
 */
const InvoiceService = {

  VAT: 0.25,

  /* Skapa fakturaunderlag från avslutad AO */
  createFromAO(aoId) {
    const ao = getAO(aoId);
    if (!ao) return null;

    if (ao.invoiceId) {
      return { ok: false, error: `${aoId} har redan faktura ${ao.invoiceId}` };
    }

    const lines = [];

    /* Fastpris (both 'fastpris' from manual AO and 'fast' from offer-created AO) */
    if ((ao.priceType === 'fastpris' || ao.priceType === 'fast') && ao.fixedPrice > 0) {
      lines.push({
        id:          'L' + Date.now() + '_fp',
        description: `Fastpris – ${ao.title}`,
        qty:         1,
        unit:        'gång',
        unitPrice:   ao.fixedPrice,
        vatRate:     25,
        source:      'Fastpris',
        sourceId:    ao.id
      });
    }

    /* Timpris / prisgrupp — hämta tidsposter */
    if (['timpris', 'prisgrupp'].includes(ao.priceType)) {
      const timeEntries = TimeService.getByAO(aoId);
      timeEntries.filter(t => t.billable).forEach(t => {
        const hours = t.minutes / 60;
        lines.push({
          id:          'L' + Date.now() + '_t' + t.id,
          description: `Arbetstid ${t.date} ${t.startStr}–${t.endStr}${t.comment ? ': ' + t.comment : ''}`,
          qty:         Math.round(hours * 100) / 100,
          unit:        'tim',
          unitPrice:   t.hourRate || 0,
          vatRate:     25,
          source:      'Tid',
          sourceId:    t.id
        });
      });
    }

    /* Material */
    (ao.materials || []).forEach(m => {
      lines.push({
        id:          'L' + Date.now() + '_m' + m.id,
        description: m.name,
        qty:         m.qty || 1,
        unit:        m.unit || 'st',
        unitPrice:   m.sellPrice || 0,
        vatRate:     25,
        source:      'Material',
        sourceId:    m.id
      });
    });

    if (lines.length === 0) {
      return { ok: false, error: 'Inga debiteringsbara rader hittades på arbetsordern' };
    }

    const inv = this._buildInvoice(lines, ao.customerId, ao.propertyId, ao.id);
    inv.offerId = ao.offerId || '';
    inv.title   = ao.title   || '';
    state.invoices = state.invoices || [];
    state.invoices.unshift(inv);

    // Koppla fakturan till AO
    ao.invoiceId = inv.id;
    ao.status    = 'fakturerad';
    ao.updatedAt = new Date().toISOString();

    ActivityService.log('invoice_created',
      `Fakturaunderlag ${inv.id} skapat från ${ao.id}`,
      { customerId: ao.customerId, workOrderId: ao.id, invoiceId: inv.id });
    persist();
    return { ok: true, invoice: inv };
  },

  /* Tomt fakturaunderlag */
  createBlank(customerId = '', opts = {}) {
    const inv = this._buildInvoice([], customerId, '', '');
    if (opts.title) inv.title = opts.title;
    if (opts.note)  inv.note  = opts.note;
    if (opts.dueDate) inv.dueDate = opts.dueDate;
    state.invoices = state.invoices || [];
    state.invoices.unshift(inv);
    ActivityService.log('invoice_created', `Fakturaunderlag ${inv.id} skapat manuellt`,
      { customerId, invoiceId: inv.id });
    persist();
    return { ok: true, invoice: inv };
  },

  _buildInvoice(lines, customerId, propertyId, workOrderId) {
    const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
    return Object.assign(Schema.invoice(), {
      id:           newId(state.invoices, 'F'),
      customerId,
      propertyId:   propertyId || '',
      workOrderId:  workOrderId || '',
      lines,
      status:       'utkast',
      dueDate,
      paymentTerms: (state.settings || {}).defaultPaymentTerms || 30,
      createdAt:    new Date().toISOString(),
      updatedAt:    new Date().toISOString()
    });
  },

  addLine(invId, lineData) {
    const inv = getInv(invId);
    if (!inv) return;
    inv.lines.push(Object.assign({ id: 'L' + Date.now(), vatRate: 25, source: 'Manuell', sourceId: '' }, lineData));
    inv.updatedAt = new Date().toISOString();
    persist();
  },

  updateLine(invId, lineId, data) {
    const inv = getInv(invId);
    if (!inv) return;
    const line = inv.lines.find(l => l.id === lineId);
    if (line) { Object.assign(line, data); inv.updatedAt = new Date().toISOString(); persist(); }
  },

  deleteLine(invId, lineId) {
    const inv = getInv(invId);
    if (!inv) return;
    inv.lines = inv.lines.filter(l => l.id !== lineId);
    inv.updatedAt = new Date().toISOString();
    persist();
  },

  setStatus(invId, status) {
    const inv = getInv(invId);
    if (!inv) return;
    inv.status    = status;
    inv.updatedAt = new Date().toISOString();
    if (status === 'betald') inv.paidAt = new Date().toISOString();
    if (status === 'skickad') inv.sentAt = new Date().toISOString();
    ActivityService.log('invoice_status',
      `Faktura ${inv.id} ändrad till ${statusLabel(status)}`,
      { customerId: inv.customerId, invoiceId: inv.id });
    persist();
  },

  calcSummary(inv) {
    const lines    = inv.lines || [];
    const linesEx  = lines.reduce((s, l) => s + (l.qty||0)*(l.unitPrice||0), 0);
    const linesVat = lines.reduce((s, l) => s + (l.qty||0)*(l.unitPrice||0)*((l.vatRate||25)/100), 0);

    const disc    = inv.discount || { type: 'none', value: 0 };
    let discAmt   = 0;
    if (disc.type === 'percent' && (disc.value||0) > 0)
      discAmt = Math.round(linesEx * (disc.value||0) / 100 * 100) / 100;
    else if (disc.type === 'fixed' && (disc.value||0) > 0)
      discAmt = Math.min(disc.value||0, linesEx);

    const ratio      = linesEx > 0 ? (1 - discAmt / linesEx) : 1;
    const exVat      = Math.round((linesEx - discAmt) * 100) / 100;
    const vat        = Math.round(linesVat * ratio * 100) / 100;
    const totalInclVat = exVat + vat;

    const tr       = inv.taxReduction || { type: 'none', amount: 0 };
    const trAmount = (tr.type === 'rot' || tr.type === 'rut') ? (tr.amount||0) : 0;
    const customerPays = totalInclVat - trAmount;

    return { linesEx, linesVat, discAmt, exVat, vat, totalInclVat, trAmount, customerPays };
  },

  calcTotals(inv) {
    const s = this.calcSummary(inv);
    return { exVat: s.exVat, vat: s.vat, total: s.totalInclVat };
  },

  setDiscount(invId, type, value) {
    const inv = getInv(invId);
    if (!inv) return;
    inv.discount = { type: type || 'none', value: parseFloat(value) || 0 };
    inv.updatedAt = new Date().toISOString();
    persist();
  },

  setTaxReduction(invId, type, amount, basis, note) {
    const inv = getInv(invId);
    if (!inv) return;
    inv.taxReduction = { type: type || 'none', amount: parseFloat(amount)||0, basis: parseFloat(basis)||0, note: note||'' };
    inv.updatedAt = new Date().toISOString();
    persist();
  },

  exportCSV() {
    const invs = state.invoices || [];
    const rows = [['Fakturanummer','Kund','Datum','Förfallodatum','Skickad','Betald','Status','Ex moms','Moms','Inkl moms','ROT/RUT','Kundpris','AO-id','Offert-id']];
    invs.forEach(inv => {
      const cu = getCu(inv.customerId);
      const s  = this.calcSummary(inv);
      rows.push([
        inv.id,
        cu ? CustomerService.displayName(cu) : '',
        inv.createdAt ? inv.createdAt.split('T')[0] : '',
        inv.dueDate || '',
        inv.sentAt ? inv.sentAt.split('T')[0] : '',
        inv.paidAt ? inv.paidAt.split('T')[0] : '',
        inv.status,
        s.exVat,
        s.vat,
        s.totalInclVat,
        s.trAmount,
        s.customerPays,
        inv.workOrderId || '',
        inv.offerId || ''
      ]);
    });
    const csv  = '﻿' + rows.map(r => r.map(v => '"' + String(v||'').replace(/"/g,'""') + '"').join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'fakturor_' + new Date().toISOString().split('T')[0] + '.csv';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  },

  sourceLabel(line) {
    const map = { Tid: 'Tid', Material: 'Material', Fastpris: 'Fastpris', Manuell: 'Manuell rad' };
    const src = map[line.source] || line.source || '';
    return src + (line.sourceId ? ` (${line.sourceId})` : '');
  }
};
