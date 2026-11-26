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
  /* J1 (2026-11-12): selection signature -> idempotency key, held ONLY while
     the outcome of an appendChecked attempt is unknown (see
     createInvoicesFromSourceKeys()). In-memory on purpose: a reload is a
     new attempt series; the server's sourceKey claims still prevent a
     double invoice. */
  var _pendingCreateKeys = {};

  /* ── Material-ID-stabilisering (V32 §4) ──────────────────────────────
     Materialrader FÅR redan stabila ID:n av WorkOrderService.addMaterial()
     ('M'+Date.now()), men äldre data (import, manuell state-konstruktion
     före den funktionen fanns) kan sakna id. Detta är en idempotent
     backfill: körs vid varje getCandidates()-anrop, men muterar/persistar
     BARA om något faktiskt saknade id — en redan identifierad rad byter
     ALDRIG id (villkoret är strikt "om inte finns", inte "skriv om"). */
  function _ensureMaterialIds() {
    var changed = false;
    var touchedAOs = [];
    (state.workOrders || []).forEach(function (ao, aoIdx) {
      var aoChanged = false;
      (ao.materials || []).forEach(function (m, idx) {
        if (!m.id) {
          m.id = 'M' + Date.now() + '_bf' + aoIdx + '_' + idx + '_' + Math.random().toString(36).slice(2, 6);
          changed = true;
          aoChanged = true;
        }
      });
      if (aoChanged) touchedAOs.push(ao);
    });
    /* P0 AO/TID-FIX: denna idempotenta backfill rörde tidigare BARA
       `ao.materials` i minnet och förlitade sig på den generiska
       persist()-vägen (nu borttagen för vift_workOrders, se state.js) för
       att faktiskt spara det server-sidigt. Speglar nu varje faktiskt
       ÄNDRAD AO:s materials-array via den atomiska patch-RPC:n. */
    /* T4-B (D-19): bara arbetsledaren (ao_edit) får skriva hela materiallistan; för övriga skrivs
       inget (servern nekar fältets hela lista med row_path_required). Nya rader får alltid id av servern. */
    if (touchedAOs.length > 0 && typeof AOTimeSyncService !== 'undefined' && typeof Auth !== 'undefined' && Auth.can('ao_edit')) {
      AOTimeSyncService.bulkPatch('ao', touchedAOs.map(function (ao) {
        return { id: ao.id, patch: { materials: ao.materials } };
      })).catch(function (e) { console.warn('[BillingQueueService] _ensureMaterialIds sync-fel:', e); });
    }
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

  /* P0 AO/TID-FIX (2026-10-18): en AO/tidpost kan existera i lokal
     state (optimistiskt, direkt efter en create()/update()-anrop) UTAN
     att serverskrivningen ännu bekräftats — se AOTimeSyncService.js:s
     outbox. §"no pending data becomes invoiceable as confirmed" i
     uppdraget: en sådan post FÅR SYNAS (annars kan den verka ha
     försvunnit för en kassörska som precis skapade den), men FÅR ALDRIG
     bli `selectable:true` förrän servern bekräftat skrivningen — annars
     kunde en faktura skapas mot en post som sedan (om serverskrivningen
     slutligen DEFINITIVT avvisas, t.ex. 'forbidden') aldrig fanns
     server-sidigt alls. Fail-closed: om AOTimeSyncService inte är
     laddat alls antas INGET vara pending (oförändrat beteende i en
     miljö utan denna release). */
  function _pendingSyncIssue(entityType, id) {
    if (typeof AOTimeSyncService === 'undefined' || !id) return null;
    return AOTimeSyncService.isUnsynced(entityType, id) ? 'Väntar på serverbekräftelse' : null;
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
      var _pendingTime = _pendingSyncIssue('time', t.id);
      if (_pendingTime) issues.push(_pendingTime);
      var _pendingAoForTime = ao ? _pendingSyncIssue('ao', ao.id) : null;
      if (_pendingAoForTime) issues.push(_pendingAoForTime);
      if (!t.aoId) issues.push('Saknar arbetsorder');
      else if (!ao) issues.push('Arbetsorder hittades inte');
      else if (mode === 'unknown') issues.push('AO saknar prismodell');
      var customerId = ao ? ao.customerId : (t.customerId || '');
      var customer = customerId ? getCu(customerId) : null;
      if (ao && !ao.customerId) issues.push('AO saknar kund');
      /* T4-B (D-10, F13): okänt timpris (null/hourRateUnknown) är inte 0 kr — kräver åtgärd. */
      var rate = (t.hourRateUnknown !== true && typeof t.hourRate === 'number') ? t.hourRate : null;
      if (!(rate > 0)) issues.push('Saknar timpris');
      var hours = (t.minutes || 0) / 60;
      /* Fakturaraden byggs av quantity × unitPrice (se createFromSources),
         med timmar avrundade till 2 decimaler. Beloppet i kön räknas på
         SAMMA avrundade antal, så förhandsvisningen alltid är exakt det som
         faktureras (tidigare: 50 min à 650 kr visades 541,67 men
         fakturerades 539,50). */
      var qtyHours = Math.round(hours * 100) / 100;
      var amount = rate === null ? null : Math.round(qtyHours * rate * 100) / 100;
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
        quantity: qtyHours, unit: 'tim', unitPrice: rate, vatRate: 25, amount: amount,
        staffId: t.staffId || '', staffName: t.staffName || '',
        attested: !!t.attested,
        selectable: issues.length === 0, issues: issues
      });
    });

    /* Material */
    (state.workOrders || []).forEach(function (ao) {
      if (ao.deleted) return;
      if (legacyExcluded.has(ao.id)) return;
      /* T4-B (D-10, R21): på en fastpris-AO ingår materialet i fastpriset om det inte uttryckligen
         markerats som tillägg (extra) — då är det ingen egen fakturakälla (ingen dubbeldebitering). */
      var fastpris = _billingModeForAo(ao) === 'fixed';
      (ao.materials || []).forEach(function (m) {
        if (!m || (m.id && String(m.id).indexOf('pending-') === 0)) return;
        if (fastpris && m.extra !== true) return;
        var sourceKey = 'material:' + ao.id + ':' + m.id;
        if (claimed.has(sourceKey)) return;
        var issues = [];
        var _pendingAoForMat = _pendingSyncIssue('ao', ao.id);
        if (_pendingAoForMat) issues.push(_pendingAoForMat);
        if (!ao.customerId) issues.push('AO saknar kund');
        /* T4-B (D-10, F13): okänt försäljningspris (sellPriceUnknown/null) är inte 0 kr. */
        var price = (m.sellPriceUnknown !== true && typeof m.sellPrice === 'number') ? m.sellPrice : null;
        if (!(price > 0)) issues.push('Saknar försäljningspris');
        var qty = Number(m.qty) || 0;
        var amount = price === null ? null : Math.round(qty * price * 100) / 100;
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
      var _pendingAoForFixed = _pendingSyncIssue('ao', ao.id);
      if (_pendingAoForFixed) issues.push(_pendingAoForFixed);
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

  /* AO-PRICING-RECOVERY R2 — Blocker 1: EN delad sanningskälla för
     "är denna AO redo att faktureras", härledd DIREKT från
     getUnclaimedSourcesForAO() — exakt samma lista InvoiceService.
     createFromAO() själv filtrerar mot (allSources/issueSources,
     InvoiceService.js). Detta ERSÄTTER separata, ofullständiga
     omimplementationer (t.ex. WorkOrderService._hasBillableContent(),
     som tidigare bara kollade OM NÅGON post var giltig — en AO med EN
     giltig historisk tidpost + två trasiga visade då "Redo fakturering"
     trots att fakturaunderlag fortfarande vägrades, eftersom
     InvoiceService kräver att ALLA obeclaimade källor är selectable).

     `issues`-strängarna delas upp i "prissättnings-relaterade" (saknad
     prismodell/timpris/fastpris/försäljningspris — sådant en
     prissättnings-reparation faktiskt kan åtgärda) och "övrigt"
     (saknad kund, ogiltig momssats, ogiltigt belopp — sådant
     prissättnings-flödet INTE är avsett att lösa). "Saknar
     prissättning" i UI ska ALDRIG visas/döljas oberoende av denna
     uppdelning — se WorkOrderService.getBillingStatus() nedan, som är
     den enda konsumenten av detta. */
  var PRICING_ISSUES = {
    'AO saknar prismodell': true,
    'Saknar timpris': true,
    'Saknar fastpris': true,
    'Saknar försäljningspris': true
  };

  /* QA FIX-ROUND 2026-11-12 (L1): `sourcesOverride` lets a caller that
     needs the status of MANY work orders compute getCandidates() ONCE
     (see getPricingStatusResolver()) instead of once per AO — the work
     order list called this per row, each call rebuilding every candidate
     of every AO (measured 750 ms per render at 333 orders). Same result
     per AO by construction: getUnclaimedSourcesForAO() is exactly
     getCandidates() filtered by workOrderId. */
  function getPricingStatusForAO(aoId, sourcesOverride) {
    var sources = Array.isArray(sourcesOverride) ? sourcesOverride : getUnclaimedSourcesForAO(aoId);
    if (sources.length === 0) {
      /* Inget obeclaimat kvar — antingen inget registrerat alls, eller
         allt redan fakturerat. Skiljs uttryckligen från "blockerad". */
      return { hasContent: false, eligible: false, pricingBlocked: false, otherBlocked: false, issues: [] };
    }
    var blocked = sources.filter(function (c) { return !c.selectable; });
    if (blocked.length === 0) {
      return { hasContent: true, eligible: true, pricingBlocked: false, otherBlocked: false, issues: [] };
    }
    var allIssues = [];
    blocked.forEach(function (c) { allIssues = allIssues.concat(c.issues); });
    var uniqueIssues = allIssues.filter(function (v, i) { return allIssues.indexOf(v) === i; });
    var pricingBlocked = uniqueIssues.some(function (i) { return !!PRICING_ISSUES[i]; });
    var otherBlocked = uniqueIssues.some(function (i) { return !PRICING_ISSUES[i]; });
    return { hasContent: true, eligible: false, pricingBlocked: pricingBlocked, otherBlocked: otherBlocked, issues: uniqueIssues };
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
  /* QA FIX-ROUND 2026-11-12 (J2, confirmed): both transitions below were
     LOCAL-ONLY mutations of the AO object — vift_workOrders left the
     generic persist() long ago (see state.js) and nothing here called
     WorkOrderService._syncAO(). After a reload the AO came back from the
     server as 'klar' with no invoiceId: "Skapa fakturaunderlag" reappeared
     and the existing re-pricing block (openPricingModal(), which reads
     ao.invoiceId) silently vanished. Both transitions now go to the
     server through the same _syncAO()/patch_ao path as every other AO
     field change, with an onSettled that rolls the local change back
     (only if nothing else has changed those fields since) and says so on
     a FINAL rejection — never a silent claim that it was saved.
     `billingPreviousStatus` is cleared on the server as null (a JSON merge
     cannot delete a key), so every check here treats null like "absent". */
  /* T3-B (2026-11-28, D-07, punkt 269/G9): faktureringsstatus på AO:n (status
     'fakturerad', invoiceId, billingPreviousStatus) ändras INTE längre via patch_ao —
     servern avvisar det för alla roller (403 forbidden/invoice_path_required). Den enda
     vägen är invoice-write åtgärden aoBilling (RPC work_order_billing_set, radlåst):
       mode 'invoiced' — servern kontrollerar att underlaget finns, inte är makulerat
                         och hänvisar till AO:n, och sparar billingPreviousStatus;
       mode 'restore'  — servern backar till SIN sparade billingPreviousStatus (bara
                         motorsatta markeringar; manuellt/äldre fakturerade rörs aldrig).
     Vid lyckat svar tas serverns AO över lokalt. Vid avslag eller nätfel backas den
     lokala ändringen (bara om inget annat ändrat fälten sedan) och användaren får veta
     det — aldrig ett tyst påstående om att det sparats. */
  function _syncBillingFields(ao, before) {
    if (typeof InvoiceService === 'undefined' || typeof InvoiceService._call !== 'function') return;
    var after = { status: ao.status, invoiceId: ao.invoiceId || '', billingPreviousStatus: ao.billingPreviousStatus == null ? null : ao.billingPreviousStatus };
    var mode = after.status === 'fakturerad' ? 'invoiced' : 'restore';
    var body = mode === 'invoiced' ? { aoId: ao.id, invoiceId: after.invoiceId, mode: mode } : { aoId: ao.id, mode: mode };
    InvoiceService._call('aoBilling', body).then(function (r) {
      var cur = getAO(ao.id);
      if (r && r.ok) {
        var srv = r.data && r.data.workOrder;
        if (srv && cur && srv.id === cur.id) {
          cur.status = srv.status; cur.invoiceId = srv.invoiceId || '';
          if (srv.billingPreviousStatus == null) delete cur.billingPreviousStatus; else cur.billingPreviousStatus = srv.billingPreviousStatus;
          cur.updatedAt = srv.updatedAt || cur.updatedAt;
          if (typeof Storage !== 'undefined' && typeof Storage.setLocal === 'function') Storage.setLocal('workOrders', state.workOrders);
        }
        return;
      }
      if (cur !== ao) return; // ersatt av en färsk serverläsning: redan serverns sanning
      var untouched = ao.status === after.status && (ao.invoiceId || '') === after.invoiceId &&
        (ao.billingPreviousStatus == null ? null : ao.billingPreviousStatus) === after.billingPreviousStatus;
      if (!untouched) return; // någon har ändrat fälten sedan — skriv aldrig över
      ao.status = before.status;
      ao.invoiceId = before.invoiceId;
      if (before.billingPreviousStatus == null) delete ao.billingPreviousStatus; else ao.billingPreviousStatus = before.billingPreviousStatus;
      if (typeof Storage !== 'undefined' && typeof Storage.setLocal === 'function') Storage.setLocal('workOrders', state.workOrders);
      if (typeof showToast === 'function') {
        showToast('Arbetsorder ' + ao.id + ': faktureringsstatusen kunde inte sparas på servern (' + ((r && r.error) || 'okänt fel') + ') — visar åter ' + before.status + '. Fakturaunderlaget i sig påverkas inte.', 8000);
      }
      try {
        if (typeof WorkOrderDetailPage !== 'undefined' && typeof WorkOrderDetailPage.onSyncStatusChanged === 'function') WorkOrderDetailPage.onSyncStatusChanged(ao.id);
        if (typeof WorkOrdersPage !== 'undefined' && typeof WorkOrdersPage.onSyncStatusChanged === 'function') WorkOrdersPage.onSyncStatusChanged(ao.id);
      } catch (e) {}
    });
  }

  function reconcileWorkOrderBilling(aoId) {
    var ao = getAO(aoId);
    if (!ao) return;
    var unclaimed = getUnclaimedSourcesForAO(aoId);
    var before = { status: ao.status, invoiceId: ao.invoiceId || '', billingPreviousStatus: ao.billingPreviousStatus };

    if (unclaimed.length === 0) {
      if (!ao.invoiceId) {
        var lastInv = (state.invoices || []).find(function (i) {
          return (i.workOrderIds && i.workOrderIds.indexOf(aoId) !== -1) || i.workOrderId === aoId;
        });
        if (lastInv) {
          if (ao.billingPreviousStatus == null) ao.billingPreviousStatus = ao.status;
          ao.invoiceId = lastInv.id;
          ao.status = 'fakturerad';
          ao.updatedAt = new Date().toISOString();
          _syncBillingFields(ao, before);
        }
      }
    } else if (ao.status === 'fakturerad' && ao.billingPreviousStatus != null) {
      ao.status = ao.billingPreviousStatus;
      delete ao.billingPreviousStatus;
      ao.invoiceId = '';
      ao.updatedAt = new Date().toISOString();
      _syncBillingFields(ao, before);
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
  /* P0 FINAL INTEGRATION (INVOICE CORRECTION): async nu — varje skapad
     fakturas APPEND går via InvoiceService._call('appendChecked', ...)
     (invoice_append_checked-RPC:n: radlåst, server-tilldelat id, cross-
     invoice sourceKey-kollisionskontroll) istället för
     `state.invoices.unshift(inv)` + en enda generisk persist() i slutet.
     En faktura vars sourceRefs kolliderar med en ANNAN, redan aktiv
     faktura (en genuin race — två kassörskor som bearbetar kön
     samtidigt) läggs i `collided` och räknas som otillgänglig i
     returvärdet, istället för att tyst skapas dubbelt. */
  async function createInvoicesFromSourceKeys(sourceKeys, opts) {
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
      var collided = [];
      for (var custIdx = 0; custIdx < Object.keys(byCustomer).length; custIdx++) {
        var custId = Object.keys(byCustomer)[custIdx];
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

        delete inv.id; // serversidigt tilldelat av invoice_append_checked
        /* P0-6 FIX (independent-reviewer finding): DETERMINISTISK
           idempotensnyckel (inte en slumpad UUID) — samma princip som
           AOTimeSyncService.bulkSync()'s import-nycklar. Om samma
           kassörska trycker "Skapa fakturautkast" en andra gång efter
           en nätverksavbrott-utan-svar (eller dubbelklickar trots
           _createBusy-skyddet i InvoicesPage.js) ska EXAKT samma
           sourceKey-grupp för samma kund ge tillbaka DEN REDAN SKAPADE
           fakturan, inte en andra. */
        /* QA FIX-ROUND 2026-11-12 (J1, confirmed): the key above used to
           be the ONLY key ever used for a given selection, for all time:
           'invcreate-' + custId + sorted sourceKeys. After that draft was
           deleted (draftDelete), re-creating the SAME selection sent the
           SAME key, and invoice-write replayed its cached result for it —
           a "F-015 skapat" that no longer existed server-side (every later
           action 404), with the fixed-price source permanently
           un-invoiceable through that selection (live, reproduced twice).
           Now: a fresh random key per creation ATTEMPT-SERIES. The key is
           remembered for this selection ONLY while the outcome is unknown
           (network error / no HTTP response — exactly the lost-response
           case P0-6 protects), so an immediate retry still dedupes
           server-side; it is forgotten as soon as ANY definite answer
           arrives (success or HTTP error). Double billing stays blocked
           regardless of the key by the server's sourceKey claims
           (source_collision / duplicate_source_key). The server-side half
           (its replay cache never re-checks that the cached invoice still
           exists, and draftDelete never invalidates it) is specified in
           _staging_integration/server/functions/invoice-write/
           SPEC_j1_idempotency_ghost_2026-11-12.md. */
        var _selSig = custId + '|' + group.map(function (c) { return c.sourceKey; }).slice().sort().join('|');
        var _idemKey = _pendingCreateKeys[_selSig] || ('vift-v2:' + InvoiceService._uuid());
        _pendingCreateKeys[_selSig] = _idemKey;
        var appendResult = await InvoiceService._call('appendChecked', { invoice: inv, idempotencyKey: _idemKey });
        if (appendResult.ok || appendResult.httpStatus) delete _pendingCreateKeys[_selSig];
        if (!appendResult.ok) {
          // Genuin race: en ANNAN klient claimade samma sourceKey(s)
          // mellan getCandidates() och detta anrop. Fakturan skapas
          // INTE — markeras kollisions-otillgänglig, inte dubbelskapad.
          collided.push({ customerId: custId, sourceKeys: group.map(function (c) { return c.sourceKey; }), error: appendResult.error });
          continue;
        }
        var savedInv = appendResult.data.invoice;
        InvoiceService._applyLocally(savedInv);
        created.push(savedInv);

        if (typeof ActivityService !== 'undefined') {
          ActivityService.log('invoice_created',
            'Fakturaunderlag ' + savedInv.id + ' skapat från faktureringskön (' + group.length + ' underlag)',
            { customerId: custId, invoiceId: savedInv.id });
        }
      }

      /* Reconciliation EFTER samtliga atomiska appends — rör
         vift_workOrders (annan nyckel), oförändrad logik/ordning. */
      var affectedAoIds = new Set(valid
        .filter(function (c) { return !collided.some(function (x) { return x.sourceKeys.indexOf(c.sourceKey) !== -1; }); })
        .map(function (c) { return c.workOrderId; }).filter(Boolean));
      affectedAoIds.forEach(function (aoId) { reconcileWorkOrderBilling(aoId); });

      if (created.length === 0 && collided.length > 0) {
        return { ok: false, error: 'Alla valda underlag hanns fakturerats av en annan session. Uppdatera kön och försök igen.', unavailable: sourceKeys, collided: collided };
      }

      return { ok: true, created: created, customers: Object.keys(byCustomer).length, sources: valid.length, unavailable: [], collided: collided };
    } finally {
      _busy = false;
    }
  }

  /* L1: one getCandidates() pass, grouped by AO; returns aoId -> status.
     Call it once per render/list pass — it is a snapshot of the current
     state, never cached across data changes. */
  function getPricingStatusResolver() {
    var byAo = {};
    getCandidates().forEach(function (c) {
      if (!c.workOrderId) return;
      (byAo[c.workOrderId] = byAo[c.workOrderId] || []).push(c);
    });
    var memo = {};
    return function (aoId) {
      if (!Object.prototype.hasOwnProperty.call(memo, aoId)) memo[aoId] = getPricingStatusForAO(aoId, byAo[aoId] || []);
      return memo[aoId];
    };
  }

  return {
    getPricingStatusResolver: getPricingStatusResolver,
    getCandidates: getCandidates,
    getUnclaimedSourcesForAO: getUnclaimedSourcesForAO,
    getPricingStatusForAO: getPricingStatusForAO,
    getSummary: getSummary,
    reconcileWorkOrderBilling: reconcileWorkOrderBilling,
    createInvoicesFromSourceKeys: createInvoicesFromSourceKeys,
    claimedByOtherActiveInvoices: claimedByOtherActiveInvoices
  };

})();
