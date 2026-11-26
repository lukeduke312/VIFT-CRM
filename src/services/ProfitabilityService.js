/**
 * ProfitabilityService — Intern lönsamhetsberäkning
 * Beräknar täckningsbidrag, materialmarginal och tidskostnad per AO.
 * INTERN DATA — visas aldrig för kund i PDF, offert eller e-post.
 *
 * T4-B (2026-11-28, F13, D-10, R20): inga påhittade standardvärden. Saknad intern timkostnad är
 * OKÄND (inte 250 kr/h), ett okänt material- eller timpris är inte 0 kr. Beräkningen summerar bara
 * kända värden och markerar resultatet som ofullständigt (incomplete, inget TB-%) när något saknas.
 */
const ProfitabilityService = {

  /** Intern timkostnad (kr/h ex moms) ur inställningarna, eller null om den saknas (kräver cost_view). */
  internalRate() {
    const raw = (state.settings || {}).internalHourlyCost;
    const v = Number(raw);
    return raw !== undefined && raw !== null && String(raw).trim() !== '' && Number.isFinite(v) && v > 0 ? v : null;
  },

  /**
   * Materialmarginal för AO.
   * @returns {{ sellEx, buyEx, margin, marginPct }}
   */
  calcMaterial(ao) {
    const mats = ao.materials || [];
    let sellEx = 0, buyEx = 0, unknownSell = 0, unknownBuy = 0;
    mats.forEach(m => {
      const qty = Number(m.qty) || 0;
      if (m.sellPriceUnknown !== true && typeof m.sellPrice === 'number' && (m.sellPrice > 0 || m.priceSource === 'manual')) sellEx += qty * m.sellPrice; else unknownSell++;
      if (m.buyPriceUnknown !== true && typeof m.buyPrice === 'number' && m.buyPrice > 0) buyEx += qty * m.buyPrice; else unknownBuy++;
    });
    const margin    = sellEx - buyEx;
    const marginPct = sellEx > 0 ? (margin / sellEx) * 100 : 0;
    return { sellEx, buyEx, margin, marginPct, unknownSell, unknownBuy };
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
    const cost    = rate === null ? 0 : hours * rate;
    return { minutes, hours, cost, rate, unknownRate: rate === null && minutes > 0 };
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
      const kanda    = billable.filter(t => t.hourRateUnknown !== true && typeof t.hourRate === 'number' && t.hourRate > 0);
      const rev      = kanda.reduce((s, t) => s + ((Number(t.minutes) || 0) / 60) * t.hourRate, 0);
      return { source: 'tim', label: 'Timpris (beräknat)', value: rev, unknown: billable.length - kanda.length };
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
    /* T4-B (R20): okänd timkostnad, okänt inköps-/timpris eller okänt försäljningspris (när materialet
       ingår i intäkten) gör TB ofullständigt — inget procenttal, ingen bedömning. */
    const saknas = [];
    if (labor.unknownRate) saknas.push('intern timkostnad');
    if (material.unknownBuy > 0) saknas.push('inköpspris');
    if (revenue.unknown > 0) saknas.push('timpris');
    if (material.unknownSell > 0 && revenue.source === 'tim') saknas.push('försäljningspris');
    const incomplete = saknas.length > 0;
    const tbPct     = !incomplete && revenue.value > 0 ? (tb / revenue.value) * 100 : null;

    let color = 'var(--mt)', badge = 'bdg-grey', label = incomplete ? 'Ofullständig' : '—';
    if (tbPct !== null) {
      if      (tbPct >= 30) { color = 'var(--gr)'; badge = 'bdg-green';  label = 'Bra marginal'; }
      else if (tbPct >= 15) { color = 'var(--yl)'; badge = 'bdg-yellow'; label = 'Låg marginal'; }
      else                  { color = 'var(--rd)'; badge = 'bdg-red';    label = 'Svag/negativ'; }
    }
    return { revenue, material, labor, totalCost, tb, tbPct, color, badge, label, incomplete, saknas };
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
