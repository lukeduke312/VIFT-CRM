/**
 * BillingQueueService.js — "Att fakturera" (SPRINT 2 / V32)
 *
 * Derived-data-motor för faktureringskön. Ingen ny parallell datakälla:
 * allt härleds vid varje anrop från state.timeEntries, state.workOrders
 * (inkl. ao.materials[]) och state.invoices — precis som uppdraget kräver.
 *
 * Kanonisk claim-modell: en debiterbar källa (tid/material/fastpris) har
 * ett stabilt sourceKey. Den räknas som "redan fakturerad" om NÅGON rad på
 * NÅGON faktura (oavsett status) har ett sourceRefs-objekt med matchande
 * sourceKey. Tas raden bort ur ett redigerbart utkast, eller raderas hela
 * utkastet, försvinner den claim:en med — källan dyker upp i kön igen vid
 * nästa beräkning (ingen egen "released"-bokföring behövs, eftersom kön
 * ALLTID räknas om från grunden).
 *
 * sourceKey-format:
 *   time:<timeEntryId>
 *   material:<workOrderId>:<materialRowId>
 *   fixed:<workOrderId>
 */
const BillingQueueService = (function () {

  var _busy = false;

  /* ── Material-ID-stabilisering (V32 §4) ──────────────────────────────
     Materialrader FÅR redan stabila ID:n av WorkOrderService.addMaterial()
     ('M'+Date.now()), men äldre data (import, manuell state-konstruktion
     före den funktionen fanns) kan sakna id. Detta är en idempotent
     backfill: körs vid varje getCandidates()-anrop, men muterar/persistar
     BARA om något faktiskt saknade id — en redan identifierad rad byter
     ALDRIG id (villkoret är strikt "om inte finns", inte "skriv om"). */
  function _ensureMaterialIds() {
    var changed = false;
    (state.workOrders || []).forEach(function (ao, aoIdx) {
      (ao.materials || []).forEach(function (m, idx) {
        if (!m.id) {
          m.id = 'M' + Date.now() + '_bf' + aoIdx + '_' + idx + '_' + Math.random().toString(36).slice(2, 6);
          changed = true;
        }
      });
    });
    if (changed && typeof persist === 'function') persist();
    return changed;
  }

  /* ── Claims ───────────────────────────────────────────────────────── */

  /* V33 §8: "makulerad" betyder att fakturan är ogiltigförklarad — dess
     sourceRefs ska INTE fortsätta reservera källor. Aktiva claim-statusar:
     utkast, skickad, betald, förfallen. En makulerad faktura räknas alltså
     inte med här, vilket gör dess sources tillgängliga igen i kön. Se
     InvoiceService.setStatus() för krocken det kan skapa åt andra hållet
     (återaktivera en makulerad faktura vars sources hunnit claimas av en
     annan aktiv faktura under tiden) — det blockeras där, inte här. */
  function _claimedSourceKeys() {
    var set = new Set();
    (state.invoices || []).forEach(function (inv) {
      if (inv.status === 'makulerad') return;
      (inv.lines || []).forEach(function (l) {
        (l.sourceRefs || []).forEach(function (r) { if (r && r.sourceKey) set.add(r.sourceKey); });
      });
    });
    return set;
  }

  /* Samma som _claimedSourceKeys() men för EN specifik faktura — används av
     InvoiceService.setStatus() för att upptäcka claim-kollisioner när en
     makulerad faktura återaktiveras (V33 §8). */
  function claimedByOtherActiveInvoices(excludeInvId) {
    var set = new Set();
    (state.invoices || []).forEach(function (inv) {
      if (inv.id === excludeInvId) return;
      if (inv.status === 'makulerad') return;
      (inv.lines || []).forEach(function (l) {
        (l.sourceRefs || []).forEach(function (r) { if (r && r.sourceKey) set.add(r.sourceKey); });
      });
    });
    return set;
  }

  /* ── Legacy-fallback (V32 §7) ─────────────────────────────────────────
     Gamla fakturor (skapade före V32) har inga sourceRefs på sina rader —
     bara den generiska sourceId/source-strängen. Vi kan alltså inte peka
     ut EXAKT vilken tidpost/materialrad en gammal rad kom från med säkerhet
     nog för att bara exkludera den specifika posten. Istället: om en AO
     har ao.invoiceId satt OCH den fakturan INTE är skapad av den nya,
     source-medvetna motorn → exkludera ALLA denna AO:s källor helt ur kön
     (konservativt, hellre dölja än dubbelfakturera).

     Avgörs via en explicit inv.sourceAware = true-flagga satt av
     createInvoicesFromSourceKeys() vid skapandet — INTE genom att kolla om
     fakturan just nu råkar ha några rader med sourceRefs. Det senare skulle
     felaktigt klassa en NY faktura som "legacy" så fort ALLA dess
     source-rader tagits bort (t.ex. i test C/D: rad borttagen ur utkast →
     fakturan har tillfälligt noll rader → källan måste ändå bli
     tillgänglig igen, inte permanent döljas). En faktura skapad av den nya
     motorn förblir "inte legacy" oavsett hur många rader den har kvar. */
  function _legacyExcludedAoIds() {
    var ids = new Set();
    (state.workOrders || []).forEach(function (ao) {
      if (!ao.invoiceId) return;
      var inv = (state.invoices || []).find(function (i) { return i.id === ao.invoiceId; });
      /* ao.invoiceId pekar på en faktura som inte längre finns i state —
         mest sannolika förklaringen är att HELA fakturautkastet raderats
         (V32 §27: raderas ett redigerbart utkast ska dess sources bli
         tillgängliga igen). Vi exkluderar INTE här: _claimedSourceKeys()
         hittar redan inga sourceRefs för en icke-existerande faktura, så
         källorna blir naturligt tillgängliga igen — precis rätt beteende. */
      if (!inv) return;
      if (!inv.sourceAware) ids.add(ao.id);
    });
    return ids;
  }

  /* ── Prismodell (V34 §1/§2) ───────────────────────────────────────────
     EN kanonisk helper för AO:ts faktureringsläge, använd överallt där
     källuniversumet (tid/fastpris) bestäms — ingen duplicerad priceType-
     check i flera loopar. Gammal, verifierad regel återställd:
       fastpris  → fastprisrad + material, ALDRIG tid
       hourly    → tid + material, ALDRIG fastpris
       unknown   → varken tid eller fastpris blir kunddebiterbara utan
                   åtgärd (material påverkas inte av detta) */
  function _billingModeForAo(ao) {
    if (!ao) return 'unknown';
    if (ao.priceType === 'fastpris' || ao.priceType === 'fast') return 'fixed';
    if (ao.priceType === 'timpris' || ao.priceType === 'prisgrupp') return 'hourly';
    return 'unknown';
  }

  /* V34 §8: spårbar radbeskrivning på tid-candidates/fakturarader —
     återställer gamla InvoiceService-formatet ("Arbetstid <datum>
     <start>–<slut>: <kommentar>") utan tomma bindestreck när start/slut
     saknas. */
  function _timeDescription(t) {
    var parts = [];
    if (t.date) parts.push(t.date);
    if (t.startStr && t.endStr) parts.push(t.startStr + '–' + t.endStr);
    else if (t.startStr) parts.push(t.startStr);
    var desc = 'Arbetstid' + (parts.length ? ' ' + parts.join(' ') : '');
    if (t.comment) desc += ': ' + t.comment;
    return desc;
  }

  function getCandidates() {
    _ensureMaterialIds();
    var claimed = _claimedSourceKeys();
    var legacyExcluded = _legacyExcludedAoIds();
    var out = [];

    /* Tid — V34 §1/§3: en fakturerings-source ENDAST om AO:ts prismodell
       faktiskt är hourly. Fastpris-AO:er fakturerar tid via fastprisraden
       (tidposten finns kvar för lön/TB/uppföljning, men blir aldrig en
       egen kund-fakturerings-source — annars dubbeldebitering). Okänd
       prismodell gör posten synlig men ej valbar ("Kräver åtgärd"), så
       registrerad debiterbar tid aldrig tyst försvinner. */
    (state.timeEntries || []).forEach(function (t) {
      if (t.billable === false) return; /* V32 §9: billable !== false räcker */
      var sourceKey = 'time:' + t.id;
      if (claimed.has(sourceKey)) return;
      var ao = t.aoId ? getAO(t.aoId) : null;
      if (t.aoId && ao && legacyExcluded.has(ao.id)) return;
      if (ao && ao.deleted) return;

      var mode = ao ? _billingModeForAo(ao) : 'unknown';
      if (mode === 'fixed') return; /* tid ingår i fastprisraden, ej egen source */

      var issues = [];
      if (!t.aoId) issues.push('Saknar arbetsorder');
      else if (!ao) issues.push('Arbetsorder hittades inte');
      else if (mode === 'unknown') issues.push('AO saknar prismodell');
      var customerId = ao ? ao.customerId : (t.customerId || '');
      var customer = customerId ? getCu(customerId) : null;
      if (ao && !ao.customerId) issues.push('AO saknar kund');
      var rate = t.hourRate || 0;
      if (!(rate > 0)) issues.push('Saknar timpris');
      var hours = (t.minutes || 0) / 60;
      var amount = Math.round(hours * rate * 100) / 100;
      if (issues.length === 0 && !(amount > 0)) issues.push('Ogiltigt belopp');

      var property = ao && ao.propertyId ? getObj(ao.propertyId) : null;

      out.push({
        id: sourceKey, sourceKey: sourceKey, sourceType: 'time', sourceId: t.id,
        customerId: customerId, propertyId: ao ? (ao.propertyId || '') : '',
        workOrderId: ao ? ao.id : '',
        customerName: customer ? CustomerService.displayName(customer) : '—',
        propertyName: property ? property.name : (ao ? (ao.propertyName || '') : ''),
        workOrderNumber: ao ? ao.id : '', workOrderTitle: ao ? ao.title : '',
        date: t.date || '', description: _timeDescription(t),
        quantity: Math.round(hours * 100) / 100, unit: 'tim', unitPrice: rate, vatRate: 25, amount: amount,
        staffId: t.staffId || '', staffName: t.staffName || '',
        attested: !!t.attested,
        selectable: issues.length === 0, issues: issues
      });
    });

    /* Material */
    (state.workOrders || []).forEach(function (ao) {
      if (ao.deleted) return;
      if (legacyExcluded.has(ao.id)) return;
      (ao.materials || []).forEach(function (m) {
        var sourceKey = 'material:' + ao.id + ':' + m.id;
        if (claimed.has(sourceKey)) return;
        var issues = [];
        if (!ao.customerId) issues.push('AO saknar kund');
        var price = m.sellPrice || 0;
        if (!(price > 0)) issues.push('Saknar försäljningspris');
        var qty = m.qty || 0;
        var amount = Math.round(qty * price * 100) / 100;
        if (issues.length === 0 && !(amount > 0)) issues.push('Ogiltigt belopp');
        /* V33 §1 / V35 §4 / V36 §2: kanonisk moms — samma fält som
           WorkOrderDetailPage redan använder, INTE ett hårdkodat 25 som
           ignorerar materialradens faktiska moms. Tomt/saknat värde
           (null/undefined/'' — inklusive en sträng som bara innehåller
           whitespace, t.ex. ' ', eftersom Number('   ') === 0 annars
           tyst tolkade "inget satt" som ett explicit 0 %) betyder "inget
           satt" -> fallback 25. Ett explicit 0/'0' ska DÄREMOT behållas
           som 0. Ett värde som finns men är matematiskt ogiltigt (NaN/
           Infinity/negativt/>100) gissas ALDRIG tyst — det gör
           candidaten till en synlig, icke-valbar "Kräver åtgärd"-rad. */
        var vatRate;
        var vatRateMissing = m.vatRate === null || m.vatRate === undefined ||
          (typeof m.vatRate === 'string' && m.vatRate.trim() === '');
        if (vatRateMissing) {
          vatRate = 25;
        } else {
          var vatRateNum = Number(m.vatRate);
          if (!Number.isFinite(vatRateNum) || vatRateNum < 0 || vatRateNum > 100) {
            issues.push('Ogiltig momssats');
            vatRate = 0;
          } else {
            vatRate = vatRateNum;
          }
        }

        var property = ao.propertyId ? getObj(ao.propertyId) : null;
        var customer = ao.customerId ? getCu(ao.customerId) : null;

        out.push({
          id: sourceKey, sourceKey: sourceKey, sourceType: 'material', sourceId: m.id,
          customerId: ao.customerId || '', propertyId: ao.propertyId || '', workOrderId: ao.id,
          customerName: customer ? CustomerService.displayName(customer) : '—',
          propertyName: property ? property.name : (ao.propertyName || ''),
          workOrderNumber: ao.id, workOrderTitle: ao.title,
          date: m.addedAt || ao.updatedAt || '', description: m.name || 'Material',
          quantity: qty, unit: m.unit || 'st', unitPrice: price, vatRate: vatRate, amount: amount,
          staffId: '', staffName: '', attested: null,
          selectable: issues.length === 0, issues: issues
        });
      });
    });

    /* Fastpris — EN source per AO. V34 §4: ett fastpris-AO med saknat/
       ogiltigt fixedPrice ska INTE försvinna tyst — den blir en synlig,
       icke-valbar "Kräver åtgärd"-source istället för att helt utelämnas. */
    (state.workOrders || []).forEach(function (ao) {
      if (ao.deleted) return;
      if (legacyExcluded.has(ao.id)) return;
      if (_billingModeForAo(ao) !== 'fixed') return;
      var sourceKey = 'fixed:' + ao.id;
      if (claimed.has(sourceKey)) return;
      var issues = [];
      if (!ao.customerId) issues.push('AO saknar kund');
      var fixedPriceNum = Number(ao.fixedPrice);
      var validFixedPrice = ao.fixedPrice != null && !isNaN(fixedPriceNum) && fixedPriceNum > 0;
      if (!validFixedPrice) issues.push('Saknar fastpris');

      var property = ao.propertyId ? getObj(ao.propertyId) : null;
      var customer = ao.customerId ? getCu(ao.customerId) : null;
      var price = validFixedPrice ? fixedPriceNum : 0;

      out.push({
        id: sourceKey, sourceKey: sourceKey, sourceType: 'fixed', sourceId: ao.id,
        customerId: ao.customerId || '', propertyId: ao.propertyId || '', workOrderId: ao.id,
        customerName: customer ? CustomerService.displayName(customer) : '—',
        propertyName: property ? property.name : (ao.propertyName || ''),
        workOrderNumber: ao.id, workOrderTitle: ao.title,
        date: ao.completedAt || ao.updatedAt || '', description: 'Fastpris',
        quantity: 1, unit: 'gång', unitPrice: price, vatRate: 25, amount: price,
        staffId: '', staffName: '', attested: null,
        selectable: issues.length === 0, issues: issues
      });
    });

    return out;
  }

  /* ── Sammanfattning för header (V32 §15) — räknas alltid om, ingen
     lagrad statistik. */
  function getSummary(candidates) {
    var list = candidates || getCandidates();
    var totalAmount = 0, timeAmount = 0, materialAmount = 0, fixedAmount = 0, issuesCount = 0, selectableCount = 0;
    list.forEach(function (c) {
      if (!c.selectable) { issuesCount++; return; }
      selectableCount++;
      totalAmount += c.amount;
      if (c.sourceType === 'time') timeAmount += c.amount;
      else if (c.sourceType === 'material') materialAmount += c.amount;
      else if (c.sourceType === 'fixed') fixedAmount += c.amount;
    });
    return {
      totalAmount: Math.round(totalAmount * 100) / 100,
      timeAmount: Math.round(timeAmount * 100) / 100,
      materialAmount: Math.round(materialAmount * 100) / 100,
      fixedAmount: Math.round(fixedAmount * 100) / 100,
      issuesCount: issuesCount, selectableCount: selectableCount
    };
  }

  /* V33 §2: "fullt fakturerad" måste räkna ALLA obeclaimade källor på AO:t,
     inte bara de som just nu är selectable. En kvarvarande källa med t.ex.
     "Saknar timpris" är fortfarande EJ fakturerad — den ska bara åtgärdas,
     inte tystas genom att AO:t felaktigt markeras klar. getCandidates()
     returnerar redan både selectable och issue-rader (allt som INTE är
     claimat), så det räcker att filtrera på workOrderId. */
  function getUnclaimedSourcesForAO(aoId) {
    return getCandidates().filter(function (c) { return c.workOrderId === aoId; });
  }

  /* ── Reconciliation (V32 §28, V33 §2/§3 — bidirektionell) ────────────────
     En AO markeras 'fakturerad' (med ao.invoiceId satt) ENDAST om INGA
     obeclaimade faktureringsbara källor (selectable ELLER issue) finns kvar
     — inte bara "inga selectable". Ingen fullständig "delvis fakturerad"-
     statusarkitektur byggs (dokumenterat, minsta säkra modell).

     BIDIREKTIONELLT (V33 §3): om motorn SJÄLV satte ao.status='fakturerad'
     (spårat via ao.billingPreviousStatus — sparas bara FÖRSTA gången, skrivs
     aldrig över) och AO:t senare får obeclaimade källor igen (t.ex. en
     source-backed rad togs bort ur ett utkast), återställs den tidigare
     statusen och invoiceId rensas. Detta rör ALDRIG en AO vars 'fakturerad'-
     status sattes manuellt eller av den gamla, icke-source-medvetna motorn
     (då finns ingen ao.billingPreviousStatus att återställa från — legacy-
     AO:er lämnas orörda, exakt som uppdraget kräver). */
  function reconcileWorkOrderBilling(aoId) {
    var ao = getAO(aoId);
    if (!ao) return;
    var unclaimed = getUnclaimedSourcesForAO(aoId);

    if (unclaimed.length === 0) {
      if (!ao.invoiceId) {
        var lastInv = (state.invoices || []).find(function (i) {
          return (i.workOrderIds && i.workOrderIds.indexOf(aoId) !== -1) || i.workOrderId === aoId;
        });
        if (lastInv) {
          if (ao.billingPreviousStatus === undefined) ao.billingPreviousStatus = ao.status;
          ao.invoiceId = lastInv.id;
          ao.status = 'fakturerad';
          ao.updatedAt = new Date().toISOString();
        }
      }
    } else if (ao.status === 'fakturerad' && ao.billingPreviousStatus !== undefined) {
      ao.status = ao.billingPreviousStatus;
      delete ao.billingPreviousStatus;
      ao.invoiceId = '';
      ao.updatedAt = new Date().toISOString();
    }
    /* Övriga fall (källor kvarstår, men status/invoiceId inte motorsatt):
       gör INGET — rör aldrig manuellt eller legacy-satt AO-status. */
  }

  /* ── Atomisk create (V32 §21/§22, V33 §5/§7 — allt-eller-inget) ────────
     En faktura PER kund. Alla markerade sources hos samma kund hamnar på
     SAMMA utkast, oavsett vilken/vilka AO/fastighet de kommer från.
     Revaliderar allt mot AKTUELL state precis innan mutation — UI-urvalet
     är bara en preview, aldrig en sanningskälla för pris/kund.

     V33 §5: STRIKT allt-eller-inget för HELA det markerade urvalet. Om EN
     enda markerad sourceKey är otillgänglig (saknas, redan claimad, inte
     längre selectable, saknar kund) skapas INGA fakturor alls — ingen
     partial-create av "resten". Markeringen ligger kvar oförändrad så
     användaren kan se exakt vad som blev otillgängligt och fatta ett nytt,
     medvetet beslut, istället för att systemet tyst fakturerar en delmängd
     av det de trodde de valde.

     opts.onInvoiceBuilt(inv, group): valfri hook som körs på varje skapad
     faktura INNAN den enda persist()-anropet — används av
     InvoiceService.createFromAO() för att sätta t.ex. offerId utan att
     behöva ett eget, andra persist-anrop efteråt (V33 §7). */
  function createInvoicesFromSourceKeys(sourceKeys, opts) {
    opts = opts || {};
    if (typeof Auth === 'undefined' || !Auth.can('invoice_create')) {
      return { ok: false, error: 'Du saknar behörighet för denna åtgärd.' };
    }
    if (_busy) return { ok: false, error: 'En faktureringsåtgärd pågår redan.' };
    if (!Array.isArray(sourceKeys) || sourceKeys.length === 0) {
      return { ok: false, error: 'Inga underlag markerade.' };
    }
    _busy = true;
    try {
      var fresh = getCandidates();
      var byKey = {};
      fresh.forEach(function (c) { byKey[c.sourceKey] = c; });

      var unavailable = [];
      var valid = [];
      var uniqueKeys = Array.from(new Set(sourceKeys));
      uniqueKeys.forEach(function (k) {
        var c = byKey[k];
        var priceOk = c && Number.isFinite(c.unitPrice) && c.unitPrice >= 0 &&
          Number.isFinite(c.quantity) && c.quantity >= 0 && Number.isFinite(c.vatRate) && c.vatRate >= 0;
        if (!c || !c.selectable || !c.customerId || !priceOk) { unavailable.push(k); return; }
        valid.push(c);
      });

      if (unavailable.length > 0) {
        /* Allt-eller-inget: en enda otillgänglig source avbryter HELA
           operationen. Ingen state-mutation, ingen persist. */
        return {
          ok: false,
          error: unavailable.length + ' av ' + uniqueKeys.length + ' underlag kan inte längre faktureras. Uppdatera kön och försök igen.',
          unavailable: unavailable
        };
      }
      if (valid.length === 0) {
        return { ok: false, error: 'Inga underlag markerade.', unavailable: unavailable };
      }

      var byCustomer = {};
      valid.forEach(function (c) {
        (byCustomer[c.customerId] = byCustomer[c.customerId] || []).push(c);
      });

      var created = [];
      Object.keys(byCustomer).forEach(function (custId) {
        var group = byCustomer[custId];
        var lines = group.map(function (c, i) {
          var srcTypeMap = { time: 'Tid', material: 'Material', fixed: 'Fastpris' };
          return {
            id: 'L' + Date.now() + '_' + i + '_' + Math.random().toString(36).slice(2, 6),
            description: c.description,
            qty: c.quantity, unit: c.unit, unitPrice: c.unitPrice, vatRate: c.vatRate,
            source: srcTypeMap[c.sourceType] || 'Manuell', sourceId: c.sourceId,
            sourceRefs: [{ sourceKey: c.sourceKey, sourceType: c.sourceType, sourceId: c.sourceId, workOrderId: c.workOrderId || '' }]
          };
        });
        var workOrderIds = Array.from(new Set(group.map(function (c) { return c.workOrderId; }).filter(Boolean)));
        var propertyIds  = Array.from(new Set(group.map(function (c) { return c.propertyId;  }).filter(Boolean)));

        var inv = InvoiceService._buildInvoice(lines, custId, propertyIds[0] || '', workOrderIds[0] || '');
        inv.workOrderIds = workOrderIds;
        inv.propertyIds  = propertyIds;
        /* Markerar denna faktura som skapad av den nya, source-medvetna
           motorn — se _legacyExcludedAoIds() ovan för varför detta måste
           vara en explicit flagga och inte "har fakturan sourceRefs just nu". */
        inv.sourceAware  = true;
        if (workOrderIds.length === 1) {
          var singleAo = getAO(workOrderIds[0]);
          inv.title = workOrderIds[0] + (singleAo ? ' — ' + singleAo.title : '');
        } else if (workOrderIds.length > 1) {
          var d = new Date();
          var monthNames = ['januari','februari','mars','april','maj','juni','juli','augusti','september','oktober','november','december'];
          inv.title = 'Arbeten ' + monthNames[d.getMonth()] + ' ' + d.getFullYear();
        }
        if (typeof opts.onInvoiceBuilt === 'function') opts.onInvoiceBuilt(inv, group);

        state.invoices = state.invoices || [];
        state.invoices.unshift(inv);
        created.push(inv);

        if (typeof ActivityService !== 'undefined') {
          ActivityService.log('invoice_created',
            'Fakturaunderlag ' + inv.id + ' skapat från faktureringskön (' + group.length + ' underlag)',
            { customerId: custId, invoiceId: inv.id });
        }
      });

      /* Reconciliation innan persist — allt i samma batch, EN persist totalt. */
      var affectedAoIds = new Set(valid.map(function (c) { return c.workOrderId; }).filter(Boolean));
      affectedAoIds.forEach(function (aoId) { reconcileWorkOrderBilling(aoId); });

      persist();

      return { ok: true, created: created, customers: Object.keys(byCustomer).length, sources: valid.length, unavailable: [] };
    } finally {
      _busy = false;
    }
  }

  return {
    getCandidates: getCandidates,
    getUnclaimedSourcesForAO: getUnclaimedSourcesForAO,
    getSummary: getSummary,
    reconcileWorkOrderBilling: reconcileWorkOrderBilling,
    createInvoicesFromSourceKeys: createInvoicesFromSourceKeys,
    claimedByOtherActiveInvoices: claimedByOtherActiveInvoices
  };

})();
