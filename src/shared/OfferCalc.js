/**
 * OfferCalc — THE one offer-economics calculation (QA FIX-ROUND 2026-11-12, I2).
 *
 * Before this round the same offer produced three different totals:
 *   - internal (PageShells.js _offerCalcTotals): per-line VAT, discount
 *     VAT spread proportionally, recurring/rate lines and opted-out extras
 *     excluded from the one-time total — e.g. 12 486 kr;
 *   - the customer-facing public link (public-offer.html): its own,
 *     simpler copy that applied a flat 25 % to everything (also to a 0 %
 *     line) and summed recurring/rate lines and opted-out extras into the
 *     total — 12 599 kr for the same offer;
 *   - the AO created from the offer (fixed price ex VAT, later billed at
 *     the AO line's VAT rate) — 12 598,75 kr.
 *
 * This file is a verbatim move of the internal (authoritative) formula
 * out of PageShells.js into a dependency-free module that BOTH the app
 * (index.html, loaded before PageShells.js, whose helpers now delegate
 * here) and the public offer page (public-offer.html) load. Behavior of
 * the internal calculation is unchanged — proven by
 * _staging_integration/tests/test_fixround_2026-11-12.js (randomized
 * parity against the previous PageShells.js implementation read from
 * git). The AO-conversion VAT flattening is a separate, tracked design
 * item (see the round report) — not changed here.
 *
 * Pure functions only: no DOM, no state, no globals other than itself.
 */
var OfferCalc = (function () {
  'use strict';

  /* Read/display VAT normalisation (0-safe; invalid/missing -> fallback). */
  function normVat(value, fallback) {
    if (fallback === undefined) fallback = 25;
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'string' && value.trim() === '') return fallback;
    var n = Number(value);
    if (!isFinite(n) || n < 0 || n > 100) return fallback;
    return n;
  }

  /* Ex-VAT amount of one offer line ('rate' lines are never part of a total). */
  function lineExVat(l) {
    if (!l || l.type === 'text') return 0;
    if (l.billingType === 'rate') return 0;
    if (l.type === 'service') return (l.exVat != null ? +l.exVat : 0);
    var qty = (l.qty != null && l.qty !== '') ? +l.qty : 1;
    var up = +(l.unitPrice || l.price || 0);
    var comp = Math.round(qty * up);
    if (comp === 0 && l.total) return +l.total;
    return comp;
  }

  /* An extra counts in the committed total unless explicitly opted out. */
  function extraIncludedInTotal(e) {
    return e.includedInTotal !== false;
  }

  function extraExVat(e) {
    return Math.round((+(e.qty || 1)) * (+(e.unitPrice || 0)));
  }

  function _oneTimeLines(off) {
    return (off.lines || []).filter(function (l) { return l.type !== 'text' && l.billingType !== 'recurring' && l.billingType !== 'rate'; });
  }

  function rawExVat(off) {
    var prLines = _oneTimeLines(off);
    var extras = (off.extras || []).filter(extraIncludedInTotal);
    var lineSum = prLines.reduce(function (s, l) { return s + lineExVat(l); }, 0);
    var extrSum = extras.reduce(function (s, e) { return s + extraExVat(e); }, 0);
    return Math.round(lineSum + extrSum);
  }

  function rawVat(off) {
    var prLines = _oneTimeLines(off);
    var extras = (off.extras || []).filter(extraIncludedInTotal);
    var lineVat = prLines.reduce(function (s, l) { return s + Math.round(lineExVat(l) * normVat(l.vatRate) / 100); }, 0);
    var extraVat = extras.reduce(function (s, e) { return s + Math.round(extraExVat(e) * normVat(e.vatRate) / 100); }, 0);
    return lineVat + extraVat;
  }

  function discountAmount(off, rawEx) {
    var d = off.discount || { type: 'none', value: 0 };
    if (!d.value) return 0;
    if (d.type === 'percent') return Math.round(rawEx * Math.min(d.value, 100) / 100);
    return Math.min(Math.round(d.value), rawEx);
  }

  function recurringLines(off) {
    return (off.lines || []).filter(function (l) { return l.billingType === 'recurring'; });
  }
  function recurringMonthlyExVat(off) {
    return Math.round(recurringLines(off).reduce(function (s, l) { return s + lineExVat(l); }, 0));
  }
  function recurringMonthlyVat(off) {
    return Math.round(recurringLines(off).reduce(function (s, l) { return s + Math.round(lineExVat(l) * normVat(l.vatRate) / 100); }, 0));
  }
  function recurringMonthlyInclVat(off) {
    return recurringMonthlyExVat(off) + recurringMonthlyVat(off);
  }

  /* The canonical totals (identical field set to the former _offerCalcTotals). */
  function totals(off) {
    var rEx = rawExVat(off);
    var rVat = rawVat(off);
    var disc = discountAmount(off, rEx);
    var exAfter = rEx - disc;
    var ratio = rEx > 0 ? (exAfter / rEx) : 1;
    var vatAmount = Math.round(rVat * ratio);
    var totalInclVat = exAfter + vatAmount;
    var rutRotAmount = Math.round((off.lines || []).filter(function (l) {
      return l.type !== 'text' && (l.billingType || 'onetime') === 'onetime';
    }).reduce(function (s, l) { return s + (l.rutAmount || 0); }, 0));
    var customerPays = totalInclVat - rutRotAmount;
    var rmEx = recurringMonthlyExVat(off);
    var rmVat = recurringMonthlyVat(off);
    var rmIncl = recurringMonthlyInclVat(off);
    return {
      rawExVat: rEx, discountAmount: disc, exVatAfterDiscount: exAfter, vatAmount: vatAmount,
      totalInclVat: totalInclVat, rutRotAmount: rutRotAmount, customerPays: customerPays,
      recurringMonthlyExVat: rmEx, recurringMonthlyVat: rmVat, recurringMonthlyInclVat: rmIncl,
      recurringAnnualExVat: rmEx * 12, recurringAnnualInclVat: rmIncl * 12
    };
  }

  /* Distinct VAT rates among the lines/extras that are part of the
     one-time total (for labelling "Moms" honestly, e.g. "25 % / 0 %"). */
  function vatRatesInTotal(off) {
    var seen = {};
    _oneTimeLines(off).forEach(function (l) { if (lineExVat(l)) seen[normVat(l.vatRate)] = true; });
    (off.extras || []).filter(extraIncludedInTotal).forEach(function (e) { if (extraExVat(e)) seen[normVat(e.vatRate)] = true; });
    return Object.keys(seen).map(Number).sort(function (a, b) { return b - a; });
  }

  /* G8 (2026-11-23): samma regel som fakturan (InvoiceService prospektiv
     kontroll): RUT/ROT-avdraget får inte överstiga engångsbeloppet inkl.
     moms — då blir "att betala" negativt. Beräkningen ändras inte; offerten
     får inte sparas/skickas/godkännas förrän avdraget rättats. */
  function validate(off) {
    var t = totals(off);
    var issues = [];
    if (t.rutRotAmount > 0 && t.rutRotAmount > t.totalInclVat) {
      issues.push({ code: 'rut_exceeds_total', message: 'RUT/ROT-avdraget (' + t.rutRotAmount + ' kr) är större än engångsbeloppet inkl. moms (' + t.totalInclVat + ' kr). Kontrollera avdragsunderlaget på raderna.' });
    }
    return { ok: issues.length === 0, issues: issues, totals: t };
  }

  return {
    validate: validate,
    normVat: normVat, lineExVat: lineExVat, extraIncludedInTotal: extraIncludedInTotal, extraExVat: extraExVat,
    rawExVat: rawExVat, rawVat: rawVat, discountAmount: discountAmount,
    recurringLines: recurringLines, recurringMonthlyExVat: recurringMonthlyExVat,
    recurringMonthlyVat: recurringMonthlyVat, recurringMonthlyInclVat: recurringMonthlyInclVat,
    totals: totals, vatRatesInTotal: vatRatesInTotal
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = OfferCalc;
