'use strict';
/* QA 2026-11-24: momsspärrar vid konvertering offert → arbetsorder (I2).
   En godkänd offert med enbart 25 % konverteras; 12 %, 0 % och blandad moms
   nekas med förklaring och INGEN AO skapas (fastprisunderlaget faktureras
   alltid med 25 %). Simulerad server. */
const base = (id, rates) => ({
  id, customerId: 'K-002', propertyId: 'OBJ-002', address: 'Testgatan 1', status: 'godkänd', workOrderId: '', taxType: 'moms', rotRutAmount: 0,
  lines: rates.map((r, i) => ({ id: 'l' + i, description: 'Rad ' + i, qty: 1, unit: 'st', unitPrice: 1000, vatRate: r, discount: 0, total: 1000 })),
  createdAt: '2026-11-20T10:00:00.000Z', updatedAt: '2026-11-20T10:00:00.000Z', answeredAt: '2026-11-21T10:00:00.000Z'
});
const CASES = [
  { id: 'OFF-VAT25', rates: [25, 25], expectAO: true },
  { id: 'OFF-VAT12', rates: [12], expectAO: false, text: /12 %/ },
  { id: 'OFF-VAT0', rates: [0], expectAO: false, text: /0 %/ },
  { id: 'OFF-VATMIX', rates: [25, 12], expectAO: false, text: /blandade momssatser/ }
];

module.exports = [{
  id: 'VAT-01', module: 'Offerter', kind: 'ui',
  name: 'Momsspärr offert→AO: 25 % konverteras med rätt fastpris; 12 %, 0 % och blandad moms nekas med förklaring och skapar ingen AO',
  async run(t) {
    t.fake.set('offers', t.fake.get('offers').concat(CASES.map((c) => base(c.id, c.rates))));
    const s = await t.world.session({ viewport: 'laptop' });
    await s.login('admin');
    for (const c of CASES) {
      const before = await s.eval((id) => (state.workOrders || []).filter((a) => a.offerId === id).length, c.id);
      await s.go('pg-offer-detail', { offerId: c.id }); await s.settle(300);
      await s.clearToasts();
      await s.eval(() => OfferDetailPage.createAO()); await s.settle(600);
      const modal = await s.eval(() => (document.querySelector('.modal-overlay.open') || {}).innerText || '');
      if (modal && /Skapa|Bekräfta/.test(modal) && c.expectAO) { await s.clickModalButton(/Skapa|Bekräfta/).catch(() => {}); await s.settle(800); }
      else if (modal) { await s.eval(() => Modal.close()); }
      await s.settle(400);
      const aos = await s.eval((id) => (state.workOrders || []).filter((a) => a.offerId === id).map((a) => ({ fixedPrice: a.fixedPrice, customerId: a.customerId })), c.id);
      if (c.expectAO) {
        t.assert(aos.length === before + 1 && Number(aos[0].fixedPrice) === 2000 && aos[0].customerId === 'K-002', c.id + ': en AO med fastpris 2000 och rätt kund (fick ' + JSON.stringify(aos) + ')');
      } else {
        t.assert(aos.length === 0, c.id + ': ingen AO skapad (fick ' + aos.length + ')');
        t.assert(/Kan inte skapa arbetsorder/.test(modal) && c.text.test(modal), c.id + ': förklarande dialog (' + modal.replace(/\s+/g, ' ').slice(0, 120) + ')');
      }
      t.note(c.id + ': ' + (c.expectAO ? 'AO skapad' : 'nekad med förklaring'));
    }
    const server = t.fake.get('workOrders').filter((a) => /^OFF-VAT/.test(a.offerId || ''));
    t.assert(server.length === 1 && server[0].offerId === 'OFF-VAT25', 'servern har exakt en AO (från 25 %-offerten): ' + server.map((a) => a.offerId).join(','));
  }
}];
