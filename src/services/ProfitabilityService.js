/**
 * ProfitabilityService — Intern lönsamhetsberäkning
 * Beräknar täckningsbidrag, materialmarginal och tidskostnad per AO.
 * INTERN DATA — visas aldrig för kund i PDF, offert eller e-post.
 */
const ProfitabilityService = {

  /** Intern standardtimkostnad (kr/h ex moms). Hämtas från settings. */
  internalRate() {
    return parseFloat((state.settings || {}).internalHourlyCost) || 250;
  },

  /**
   * Materialmarginal för AO.
   * @returns {{ sellEx, buyEx, margin, marginPct }}
   */
  calcMaterial(ao) {
    const mats = ao.materials || [];
    let sellEx = 0, buyEx = 0;
    mats.forEach(m => {
      const qty = m.qty || 0;
      sellEx += qty * (m.sellPrice || 0);
      buyEx  += qty * (m.buyPrice  || 0);
    });
    const margin    = sellEx - buyEx;
    const marginPct = sellEx > 0 ? (margin / sellEx) * 100 : 0;
    return { sellEx, buyEx, margin, marginPct };
  },

  /**
   * Intern arbetskostnad för AO baserat på registrerad tid.
   * @returns {{ minutes, hours, cost, rate }}
   */
  calcLabor(ao) {
    const entries = TimeService.getByAO(ao.id);
    const minutes = TimeService.totalMinutes(entries);
    const hours   = minutes / 60;
    const rate    = this.internalRate();
    const cost    = hours * rate;
    return { minutes, hours, cost, rate };
  },

  /**
   * Intäkt ex moms för AO.
   * Prioritet: befintlig faktura → fastpris → timpris-beräkning.
   * @returns {{ source, label, value, invoiceId? }}
   */
  calcRevenue(ao) {
    const inv = ao.invoiceId ? getInv(ao.invoiceId) : null;
    if (inv) {
      const t = InvoiceService.calcTotals(inv);
      return { source: 'faktura', label: 'Fakturerat', value: t.exVat, invoiceId: inv.id };
    }
    if ((ao.priceType === 'fast' || ao.priceType === 'fastpris') && ao.fixedPrice > 0) {
      return { source: 'fastpris', label: 'Fastpris', value: ao.fixedPrice };
    }
    if (['timpris','prisgrupp'].includes(ao.priceType)) {
      const entries  = TimeService.getByAO(ao.id);
      const billable = entries.filter(t => t.billable !== false);
      const rev      = billable.reduce((s, t) => s + (t.minutes / 60) * (t.hourRate || 0), 0);
      return { source: 'tim', label: 'Timpris (beräknat)', value: rev };
    }
    return { source: 'okänd', label: 'Ej satt', value: 0 };
  },

  /**
   * Täckningsbidrag (TB) för en AO.
   * @returns {{ revenue, material, labor, totalCost, tb, tbPct, color, badge, label }}
   */
  calcTB(ao) {
    const material  = this.calcMaterial(ao);
    const labor     = this.calcLabor(ao);
    const revenue   = this.calcRevenue(ao);
    const totalCost = material.buyEx + labor.cost;
    const tb        = revenue.value - totalCost;
    const tbPct     = revenue.value > 0 ? (tb / revenue.value) * 100 : null;

    let color = 'var(--mt)', badge = 'bdg-grey', label = '—';
    if (tbPct !== null) {
      if      (tbPct >= 30) { color = 'var(--gr)'; badge = 'bdg-green';  label = 'Bra marginal'; }
      else if (tbPct >= 15) { color = 'var(--yl)'; badge = 'bdg-yellow'; label = 'Låg marginal'; }
      else                  { color = 'var(--rd)'; badge = 'bdg-red';    label = 'Svag/negativ'; }
    }
    return { revenue, material, labor, totalCost, tb, tbPct, color, badge, label };
  },

  /**
   * Jämför offererat pris och planerad tid mot faktiskt utfall.
   * @returns {{ offerExVat, actualRev, revDiff, estMins, actualMins, timeDiff }} | null
   */
  calcVsOffer(ao) {
    if (!ao.offerId) return null;
    const off = (state.offers || []).find(o => o.id === ao.offerId);
    if (!off) return null;

    const prLines    = (off.lines || []).filter(l => l.type !== 'text');
    const offerExVat = prLines.reduce((s, l) => {
      return s + (l.exVat || l.total || Math.round((l.qty || 1) * (l.unitPrice || 0)));
    }, 0);

    const tb         = this.calcTB(ao);
    const actualRev  = tb.revenue.value;
    const revDiff    = actualRev - offerExVat;
    const estMins    = Math.round((ao.estimatedHours || 0) * 60);
    const actualMins = tb.labor.minutes;
    const timeDiff   = actualMins - estMins;

    return { offerExVat, actualRev, revDiff, estMins, actualMins, timeDiff };
  }
};
