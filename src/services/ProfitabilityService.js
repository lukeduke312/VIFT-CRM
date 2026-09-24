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

    /* OFFER CORE R1.3 — BLOCKER 1 (motbevis-granskad): R1.2 routed this
       through _offRawExVat(off) (PRE-discount) — for a discounted
       one-time offer this compared the AO's actual outcome against the
       offer's undiscounted rawExVat, not the customer's actual
       committed price. Fixed to use the canonical
       _offerCalcTotals(off).exVatAfterDiscount — the real, post-
       discount one-time commitment. New AOs can no longer be created
       from any offer with a recurring component at all (see
       OffersPage._offAOConversionDecision/_offBlocksAOConversion) — so
       "offererat pris" here is, going forward, always a genuine
       one-time comparison. For any PRE-EXISTING AO already linked to a
       recurring/mixed offer (created before that guard existed), this
       deliberately compares ONLY the offer's one-time component
       (exVatAfterDiscount, which is 0 for a pure-recurring offer) —
       it does NOT fabricate a one-time value out of one month of
       recurring pricing. A 0-vs-actual comparison for such a legacy AO
       is honest (no one-time commitment existed to compare against),
       not silently wrong, which is the smallest behavior consistent
       with this service's existing revDiff/UI contract without adding
       a new "non-comparable" state this round. */
    const prLines    = (off.lines || []).filter(l => l.type !== 'text');
    const offerExVat = typeof _offerCalcTotals === 'function' ? _offerCalcTotals(off).exVatAfterDiscount : prLines.reduce((s, l) => {
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
