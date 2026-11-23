/**
 * InvoiceService — Fakturaunderlag
 * Skapar fakturor från AO (tid + material + fastpris)
 */
const InvoiceService = {

  VAT: 0.25,

  /* V34 §9/§10: giltiga statusar + tillåtna övergångar. EN kanonisk
     tabell — UI:t (InvoiceDetailPage) frågar getAllowedStatusTransitions()
     istället för att duplicera matrisen. */
  VALID_STATUSES: ['utkast', 'skickad', 'betald', 'förfallen', 'makulerad'],
  STATUS_TRANSITIONS: {
    utkast:     ['skickad', 'makulerad'],
    skickad:    ['betald', 'förfallen', 'makulerad'],
    förfallen:  ['skickad', 'betald', 'makulerad'],
    betald:     ['makulerad'],
    makulerad:  ['utkast']
  },

  getAllowedStatusTransitions(inv) {
    if (!inv || !this.STATUS_TRANSITIONS[inv.status]) return [];
    return this.STATUS_TRANSITIONS[inv.status].slice();
  },

  /* P0 FINAL INTEGRATION (INVOICE CORRECTION): gemensam väg till den nya
     invoice-write Edge Function:en (se
     supabase/migrations/20261018000003_invoice_set_status_atomic_rpc.sql
     + 20261018000004_invoice_lines_and_create_atomic_rpc.sql). ALLA
     mutationer i denna fil som förut gjorde lokal mutation + generisk
     persist() går nu via denna — vift_invoices är därför borttagen ur
     state.js _doPersist()-listan (se dess kommentar). */
  /* P0-6 FIX: UUID-based idempotency key generator, same entropy source
     already used throughout this engagement (AOTimeSyncService._uuid(),
     RonderingSyncService, etc.) — used for invoice_append_checked()'s
     new idempotency-key parameter so a network retry on invoice
     creation can never double-create. */
  _uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'idem-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  },

  _edgeBase() {
    return (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '').replace(/\/$/, '');
  },

  async _call(action, body) {
    // Serverns revision är kanonisk. Ingen blind omskrivning vid konflikt.
    const revisionActions = ['setStatus', 'lineAdd', 'lineUpdate', 'lineDelete',
      'draftDelete', 'discountSet', 'taxReductionSet', 'metaUpdate', 'approveStaleOverride'];
    let requestBody = Object.assign({ action }, body);
    if (revisionActions.includes(action)) {
      const inv = typeof getInv === 'function' ? getInv(body.invoiceId) : null;
      if (!inv) return { ok: false, error: 'Fakturan hittades inte lokalt. Ladda om sidan.' };
      // Äldre fakturor saknar revision och behandlas som revision 0 av SQL.
      const rawRevision = inv.revision == null ? 0 : inv.revision;
      if (typeof rawRevision !== 'number' || !Number.isSafeInteger(rawRevision) || rawRevision < 0) {
        return { ok: false, error: 'Ogiltig fakturarevision. Ladda om sidan.' };
      }
      requestBody.expectedRevision = rawRevision;
    }
    try {
      const res = await fetch(this._edgeBase() + '/functions/v1/invoice-write', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': (typeof SUPABASE_AKEY !== 'undefined' ? SUPABASE_AKEY : ''),
          'Authorization': 'Bearer ' + (typeof Auth !== 'undefined' ? (Auth.getAccessToken() || '') : '')
        },
        body: JSON.stringify(requestBody)
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok) {
        const map = {
          not_draft: 'Fakturan kan inte ändras i sin nuvarande status.',
          stale_write: 'Fakturan har ändrats i en annan session. Ladda om innan du försöker igen.',
          invalid_revision: 'Fakturans revisionsnummer saknas eller är ogiltigt. Ladda om sidan.',
          line_not_found: 'Raden hittades inte.',
          not_found: 'Fakturan hittades inte.',
          forbidden: 'Du saknar behörighet för denna åtgärd.',
          source_collision: 'En eller flera rader har hunnit fakturerats på en annan aktiv faktura.',
          /* F-002 server codes (spec §0.1/§8 F2, added 2026-11-12) — shown
             instead of the raw code once invoice-write enforces F-002. */
          stale_price_unapproved: 'Fakturan har en ej godkänd prisavvikelse mot arbetsorderns fasta pris och kan inte skickas. Rätta beloppet eller godkänn avvikelsen med motivering.',
          stale_snapshot_mismatch: 'Prisavvikelsen har ändrats sedan du öppnade dialogen. Ladda om fakturan och godkänn den aktuella avvikelsen.',
          no_stale_discrepancy: 'Det finns ingen prisavvikelse att godkänna längre.',
          invalid_justification: 'Motiveringen måste vara 10–2000 tecken.',
          stale_check_unavailable: 'Prisavvikelsekontrollen kunde inte genomföras just nu. Fakturan skickas inte — försök igen.'
        };
        /* J1 (2026-11-12): + httpStatus/code (additive) so a caller can tell a
           definite server answer from a lost response (network error below). */
        return { ok: false, error: map[data.error] || data.error || ('http_' + res.status), httpStatus: res.status, code: data.error || null };
      }
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: 'Nätverksfel — kunde inte spara ändringen.', network: true };
    }
  },

  /* Applicerar en servercanonisk faktura LOKALT, by id — rör aldrig
     andra fakturor i state.invoices (samma invariant som
     RonderingSyncService._applyLocally()). */
  _applyLocally(inv) {
    if (!inv || !inv.id) return;
    state.invoices = state.invoices || [];
    const idx = state.invoices.findIndex(i => i.id === inv.id);
    if (idx >= 0) state.invoices[idx] = inv;
    else state.invoices.unshift(inv);
    try { localStorage.setItem('vift_invoices', JSON.stringify(state.invoices)); } catch (e) {}
  },

  _removeLocally(invId) {
    state.invoices = (state.invoices || []).filter(i => i.id !== invId);
    try { localStorage.setItem('vift_invoices', JSON.stringify(state.invoices)); } catch (e) {}
  },

  _applyActivityLog(log) {
    if (Array.isArray(log)) {
      state.activityLog = log;
      try { localStorage.setItem('vift_activityLog', JSON.stringify(state.activityLog)); } catch (e) {}
    }
  },

  /* Skapa fakturaunderlag från avslutad AO.
     V32 §29 / V33 §6/§7 / V34 §7: går genom SAMMA source-aware motor som
     "Att fakturera"-kön (BillingQueueService) — ingen egen parallell
     algoritm, inget temporärt manipulerande av ao.invoiceId. En AO vars
     sources redan är claimade av en legacy-faktura (utan sourceRefs) har
     inga candidates alls här — ingen override kringgår det.

     V34 §7: AO-genvägen är KONSERVATIV. Den tittar på ALLA obeclaimade
     källor på AO:t (selectable OCH "Kräver åtgärd"), inte bara de
     valbara — annars kunde knappen tyst skapa en partial-faktura av bara
     de valbara källorna medan en issue-source (t.ex. material utan pris)
     lämnades kvar utan att användaren förstod det. Om NÅGON kvarvarande
     källa kräver åtgärd skapas INGEN faktura alls; användaren hänvisas
     till "Att fakturera" där hen kan se och medvetet välja. Partial
     billing är fortsatt fullt möjligt därifrån — bara inte via denna
     implicita AO-genväg. */
  async createFromAO(aoId) {
    const ao = getAO(aoId);
    if (!ao) return null;

    const allSources = BillingQueueService.getUnclaimedSourcesForAO(aoId);
    if (allSources.length === 0) {
      return { ok: false, error: 'Inget kvar att fakturera på denna arbetsorder.' };
    }
    const issueSources = allSources.filter(c => !c.selectable);
    if (issueSources.length > 0) {
      /* AO-050-fixen: istället för ett generiskt "kräver åtgärd" — vilket
         gav ingen ledtråd om VAD som var fel eller VAR — namnger meddelandet
         nu FAKTISKT vilka tidposter som saknar timpris (personal + datum/
         tid, ALDRIG belopp/pris — denna knapp är redan gated bakom
         `invoice_create`, se WorkOrderDetailPage/InvoicesPage, men beloppet
         hör ändå inte hemma i en felruta). Stödjer flera personal med
         SKILDA saknade prisgrupper på samma AO (AO-050-scenariot) — varje
         drabbad tidpost listas för sig, inte bara ett aggregerat antal. */
      const missingRateTime = issueSources.filter(c =>
        c.sourceType === 'time' && Array.isArray(c.issues) && c.issues.includes('Saknar timpris')
      );
      let detail = '';
      if (missingRateTime.length > 0) {
        const MAX_LISTED = 3;
        const lines = missingRateTime.slice(0, MAX_LISTED).map(c => {
          const entry = (state.timeEntries || []).find(t => t.id === c.sourceId);
          const timeRange = entry && entry.startStr && entry.endStr ? ' ' + entry.startStr + '–' + entry.endStr : '';
          return `${c.staffName || 'Okänd personal'} · ${fmtDate(c.date)}${timeRange}`;
        });
        if (missingRateTime.length > MAX_LISTED) {
          lines.push(`… och ${missingRateTime.length - MAX_LISTED} till`);
        }
        detail = `\n${missingRateTime.length} tidspost${missingRateTime.length === 1 ? '' : 'er'} saknar timpris:\n${lines.join('\n')}`;
      }
      const otherCount = issueSources.length - missingRateTime.length;
      if (otherCount > 0) {
        detail += `${detail ? '\n' : '\n'}${otherCount} annat underlag${otherCount === 1 ? '' : ''} kräver också åtgärd.`;
      }
      return {
        ok: false,
        error: `Kan inte skapa fakturaunderlag.${detail}\nÖppna Att fakturera för att åtgärda.`,
        needsAction: true
      };
    }

    /* P0 FINAL INTEGRATION: BillingQueueService.createInvoicesFromSourceKeys
       är nu async (atomisk append per skapad faktura, se dess egen
       kommentar) — väntas in här istället för ett synkront anrop. */
    const result = await BillingQueueService.createInvoicesFromSourceKeys(
      allSources.map(c => c.sourceKey),
      { onInvoiceBuilt: inv => { inv.offerId = ao.offerId || ''; } }
    );
    if (!result.ok || !result.created || !result.created.length) {
      return { ok: false, error: result.error || 'Kunde inte skapa fakturaunderlag.', unavailable: result.unavailable };
    }

    return { ok: true, invoice: result.created[0] };
  },

  /* Tomt fakturaunderlag — fail closed (V33 §9).
     P0 FINAL INTEGRATION: atomisk append via invoice_append_checked
     (server tilldelar id — ingen newId()-race) istället för lokal
     mutation + generisk persist(). */
  async createBlank(customerId = '', opts = {}) {
    if (typeof Auth === 'undefined' || !Auth.can('invoice_create')) {
      return { ok: false, error: 'Du saknar behörighet för denna åtgärd.' };
    }
    const inv = this._buildInvoice([], customerId, '', '');
    delete inv.id; // serversidigt tilldelat
    if (opts.title) inv.title = opts.title;
    if (opts.note)  inv.note  = opts.note;
    if (opts.dueDate) inv.dueDate = opts.dueDate;
    const r = await this._call('appendChecked', { invoice: inv, idempotencyKey: 'vift-v2:' + this._uuid() });
    if (!r.ok) return r;
    this._applyLocally(r.data.invoice);
    ActivityService.log('invoice_created', `Fakturaunderlag ${r.data.invoice.id} skapat manuellt`,
      { customerId, invoiceId: r.data.invoice.id });
    return { ok: true, invoice: r.data.invoice };
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

  /* V33 §10: endast 'utkast' får fakturarader ändras — säkraste minimimodell
     given att sourceRefs nu styr faktisk ekonomisk claim-state. 'förfallen'
     behandlas som låst (det är en SKICKAD faktura som passerat
     förfallodatum, inte ett utkast) — samma spärr som 'skickad'/'betald'/
     'makulerad'. Central helper, använd av add/update/deleteLine OCH av UI:t
     (InvoiceDetailPage) så knapparna aldrig visas när raden ändå skulle
     nekas av servicelagret. */
  canEditLines(inv) {
    return !!inv && inv.status === 'utkast';
  },

  /* V34 §14: samma regel som canEditLines, men namngiven för att spegla
     att den nu även gäller ALL finansiell/innehållsmässig redigering
     (rabatt, ROT/RUT, referens/OCR, note) — inte bara fakturarader.
     Medvetet inte en separat implementation: reglerna ska aldrig kunna
     divergera av misstag. */
  canEditDraft(inv) {
    return this.canEditLines(inv);
  },

  /* STAGING-granskning 2026-11-11 (F-002/AO-002-fyndet): en fakturarad med
     sourceType 'fixed' snapshotar arbetsorderns fixedPrice vid skapandet.
     Det är korrekt — en redan SKICKAD faktura ska inte tyst ändra belopp
     bara därför att någon redigerar arbetsordern senare. Men om AO:ns
     fixedPrice rättas EFTER att ett utkast redan skapats syns det annars
     ingenstans — raden visar tyst det gamla, fel beloppet. Denna funktion
     upptäcker avvikelsen så UI:t kan visa den (se InvoicesPage.js
     InvoiceDetailPage._renderLines) — den ändrar ALDRIG beloppet själv,
     exakt samma princip som validateFinancialState(): avvikelsen ska
     synas, inte maskeras eller tystas rättas. */
  staleFixedPriceLines(inv) {
    if (!inv || !Array.isArray(inv.lines)) return [];
    return inv.lines.filter(l => {
      const ref = (l.sourceRefs || []).find(r => r.sourceType === 'fixed' && r.workOrderId);
      if (!ref) return false;
      const ao = (state.workOrders || []).find(a => a.id === ref.workOrderId);
      if (!ao) return false;
      const aoPrice = Number(ao.fixedPrice);
      if (!Number.isFinite(aoPrice) || aoPrice <= 0) return false;
      return Number(l.unitPrice) !== aoPrice;
    });
  },

  /* ═══════════════════════════════════════════════════════════════════
     F-002 HÅRD SPÄRR (2026-11-12, Lucas beslut ordagrant): "En känd
     prisavvikelse ska hindra att fakturan markeras skickad tills den
     korrigerats eller en behörig användare uttryckligen godkänt
     avvikelsen med dokumenterad motivering. Inga automatiska
     prisändringar."

     Modell:
       - staleDiscrepancySnapshot(inv): EXAKT vilken avvikelse som finns
         just nu — per stale rad {lineId, workOrderId, lineUnitPrice,
         aoFixedPrice}, sorterad på lineId.
       - inv.staleOverrides[]: append-only historik av godkännanden
         {id, approvedById, approvedByName, approvedAt, justification,
         lines:[snapshot]}. ENDAST den SENASTE posten kan täcka en
         avvikelse, och bara om VARJE nuvarande stale rad har en exakt
         matchande post (samma lineId + workOrderId + fakturaradens pris +
         AO:ns pris) i dess `lines`. Ändras AO-priset igen efter
         godkännandet (eller blir en ANNAN rad stale) matchar snapshoten
         inte längre → spärren gäller igen och ett NYTT godkännande krävs.
         Ett godkännande för en avvikelse kan alltså aldrig tyst täcka en
         senare, annan avvikelse.
       - Ingenting här ändrar unitPrice eller något annat belopp.
     Klientsidig spärr — servern MÅSTE upprätthålla samma regel (se
     publiceringspaketets server-spec; invoice-write-källan finns inte i
     detta repo). */
  staleDiscrepancySnapshot(inv) {
    return this.staleFixedPriceLines(inv).map(l => {
      const ref = (l.sourceRefs || []).find(r => r.sourceType === 'fixed' && r.workOrderId);
      const ao = (state.workOrders || []).find(a => a.id === ref.workOrderId);
      return {
        lineId:        String(l.id),
        workOrderId:   String(ref.workOrderId),
        lineUnitPrice: Number(l.unitPrice),
        aoFixedPrice:  Number(ao.fixedPrice)
      };
    }).sort((a, b) => a.lineId < b.lineId ? -1 : a.lineId > b.lineId ? 1 : 0);
  },

  latestStaleOverride(inv) {
    const arr = inv && Array.isArray(inv.staleOverrides) ? inv.staleOverrides : [];
    return arr.length ? arr[arr.length - 1] : null;
  },

  /* { stale:[snapshot...], override, covered, uncovered:[snapshot...],
       supersededOverride } — `covered` är true ENDAST om det finns minst
     en avvikelse OCH den senaste override-posten täcker varje rad exakt. */
  staleOverrideStatus(inv) {
    const stale = this.staleDiscrepancySnapshot(inv);
    const override = this.latestStaleOverride(inv);
    const covers = (item) => !!override && Array.isArray(override.lines) && override.lines.some(o =>
      String(o.lineId) === item.lineId &&
      String(o.workOrderId) === item.workOrderId &&
      Number(o.lineUnitPrice) === item.lineUnitPrice &&
      Number(o.aoFixedPrice) === item.aoFixedPrice);
    const uncovered = stale.filter(it => !covers(it));
    const covered = stale.length > 0 && uncovered.length === 0;
    return {
      stale, override, covered, uncovered,
      supersededOverride: !!override && stale.length > 0 && !covered
    };
  },

  /* ── G10 (2026-11-23): RUT/ROT från offert → faktura ───────────────
     En godkänd offert kan ha lovat kunden ett RUT/ROT-avdrag. Fakturautkast
     som skapas ur faktureringskön fick tidigare INGET avdrag och inget
     varnade — kunden kunde faktureras fullt pris i strid med offerten.
     Regeln nu: avdraget förs inte över automatiskt (avdragsrätt avgörs av
     människa), men fakturan kan inte markeras skickad förrän någon antingen
     lagt in ett avdrag eller uttryckligen bekräftat "utan avdrag". */
  OFFER_TR_REVIEWED_PREFIX: 'Kontrollerat:',
  offerTaxReductionFor(inv) {
    if (!inv || typeof OfferCalc === 'undefined') return [];
    const aoIds = new Set();
    if (inv.workOrderId) aoIds.add(inv.workOrderId);
    (inv.lines || []).forEach(l => {
      if (l && l.workOrderId) aoIds.add(l.workOrderId);
      (l && l.sourceRefs || []).forEach(r => { if (r && r.workOrderId) aoIds.add(r.workOrderId); });
    });
    const seen = new Set();
    const out = [];
    aoIds.forEach(id => {
      const ao = getAO(id);
      const off = ao && ao.offerId ? getOff(ao.offerId) : null;
      if (!off || seen.has(off.id)) return;
      seen.add(off.id);
      const tot = OfferCalc.totals(off);
      if (!(tot.rutRotAmount > 0)) return;
      const types = new Set();
      let basis = 0;
      (off.lines || []).forEach(l => {
        if (!((l.rutAmount || 0) > 0)) return;
        const t = (l.reductionType === 'rot' || l.reductionType === 'rut') ? l.reductionType
          : (l.inputValues && l.inputValues.rot) ? 'rot' : (l.inputValues && l.inputValues.rut) ? 'rut' : '';
        if (t) types.add(t);
        basis += +l.reductionBaseExVat || 0;
      });
      out.push({ offerId: off.id, type: types.size === 1 ? [...types][0] : '', amount: tot.rutRotAmount, basisExVat: Math.round(basis * 100) / 100 });
    });
    return out;
  },
  /* Returnerar offertens avdrag om fakturan saknar beslut, annars null. */
  taxReductionReviewNeeded(inv) {
    const offers = this.offerTaxReductionFor(inv);
    if (!offers.length) return null;
    const tr = inv.taxReduction || {};
    if (tr.type && tr.type !== 'none') return null;
    if (String(tr.note || '').indexOf(this.OFFER_TR_REVIEWED_PREFIX) === 0) return null;
    return offers;
  },

  /* Sant om 'skickad' just nu skulle nekas p.g.a. en ogodkänd avvikelse. */
  isSendBlockedByStalePrice(inv) {
    const st = this.staleOverrideStatus(inv);
    return st.stale.length > 0 && !st.covered;
  },

  /* Behörighet för att godkänna en avvikelse: invoice_create OCH
     admin_manage. Motivering: godkännandet innebär att ett KÄNT felaktigt
     belopp medvetet skickas till kund — ett starkare beslut än vanlig
     fakturaredigering. Den som bara har invoice_create kan fortfarande
     RÄTTA beloppet (vanlig radredigering), men inte godkänna avvikelsen.
     ('all'/superadmin uppfyller båda via Auth.can().) */
  canApproveStaleOverride() {
    return typeof Auth !== 'undefined' && Auth.can('invoice_create') && Auth.can('admin_manage');
  },

  STALE_OVERRIDE_MIN_JUSTIFICATION: 10,
  STALE_OVERRIDE_MAX_JUSTIFICATION: 2000,

  async approveStaleLineOverride(invId, justificationText) {
    if (!this.canApproveStaleOverride()) {
      return { ok: false, error: 'Du saknar behörighet att godkänna en prisavvikelse (kräver fakturering + administratörsbehörighet).' };
    }
    const inv = getInv(invId);
    if (!inv) return { ok: false, error: 'Fakturan hittades inte.' };
    if (this.getAllowedStatusTransitions(inv).indexOf('skickad') === -1) {
      return { ok: false, error: `Fakturan är ${statusLabel(inv.status)} — ett godkännande av prisavvikelse är bara relevant innan den markeras skickad.` };
    }
    const justification = typeof justificationText === 'string' ? justificationText.trim() : '';
    if (justification.length < this.STALE_OVERRIDE_MIN_JUSTIFICATION) {
      return { ok: false, error: `En motivering på minst ${this.STALE_OVERRIDE_MIN_JUSTIFICATION} tecken krävs.` };
    }
    if (justification.length > this.STALE_OVERRIDE_MAX_JUSTIFICATION) {
      return { ok: false, error: `Motiveringen får vara högst ${this.STALE_OVERRIDE_MAX_JUSTIFICATION} tecken.` };
    }
    const st = this.staleOverrideStatus(inv);
    if (!st.stale.length) return { ok: false, error: 'Det finns ingen prisavvikelse att godkänna.' };
    if (st.covered) return { ok: true, alreadyCovered: true };

    const u = state.currentUser || {};
    const override = {
      id:             this._uuid(),
      approvedById:   u.id || '',
      approvedByName: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
      approvedAt:     new Date().toISOString(),
      justification:  justification,
      lines:          st.stale.map(x => Object.assign({}, x))
    };
    // Samma etablerade skrivväg som alla andra fakturamutationer
    // (invoice-write EF, expectedRevision skickas via revisionActions).
    // Payloaden innehåller ENDAST godkännandet — inga rader/belopp.
    const r = await this._call('approveStaleOverride', { invoiceId: invId, override, idempotencyKey: this._uuid() });
    if (!r.ok) {
      if (/unknown_action|invalid_action|unsupported|http_404/i.test(String(r.error || ''))) {
        return { ok: false, error: 'Servern stöder ännu inte godkännande av prisavvikelser (invoice-write saknar åtgärden approveStaleOverride). Fakturan förblir spärrad — rätta beloppet istället.' };
      }
      return r;
    }
    // Fail closed: lita bara på serverns kanoniska faktura, och bara om
    // den faktiskt bär EXAKT detta godkännande som senaste post.
    const canon = r.data && r.data.invoice;
    const canonLatest = canon ? this.latestStaleOverride(canon) : null;
    if (!canonLatest || canonLatest.id !== override.id) {
      return { ok: false, error: 'Servern bekräftade inte att godkännandet sparades — fakturan förblir spärrad.' };
    }
    this._applyLocally(canon);
    if (Array.isArray(r.data.activityLog)) {
      this._applyActivityLog(r.data.activityLog);
    } else if (typeof ActivityService !== 'undefined') {
      ActivityService.log('invoice_stale_override_approved',
        `Prisavvikelse på ${invId} godkänd av ${override.approvedByName || 'okänd'}: ${justification}`,
        { invoiceId: invId, customerId: inv.customerId || '' });
    }
    return { ok: true, override: canonLatest };
  },

  /* V35 §5/§13: central finansiell invariant. Beräknas via calcSummary()
     — ALDRIG genom att klämma till (t.ex. Math.max(0,...)) för att dölja
     ett ogiltigt tillstånd. calcSummary() fortsätter ge matematisk
     sanning rakt av, även för legacy-data som råkat hamna i ett ogiltigt
     läge (det ska synas, inte maskeras). Det är MUTATIONERNA (se
     _prospectiveCheck) som blockerar en ändring som SKULLE SKAPA ett
     ogiltigt tillstånd — inte denna funktion, som bara konstaterar. */
  /* V36 §3/§4: trAmount/customerPays hämtas nu direkt från
     calcSummary()s egen beräkning (som i sin tur använder _rawTrAmount())
     istället för att räknas ut en andra gång lokalt här med samma
     `tr.amount || 0`-mönster som maskerade NaN/Infinity till 0. En enda
     normaliseringsregel, ingen duplicering. */
  validateFinancialState(inv) {
    const s = this.calcSummary(inv);
    if (!Number.isFinite(s.totalInclVat) || s.totalInclVat < 0) {
      return { ok: false, error: 'Fakturans totalsumma är ogiltig.' };
    }
    if (!Number.isFinite(s.trAmount) || s.trAmount < 0) {
      return { ok: false, error: 'ROT/RUT-avdraget är ogiltigt.' };
    }
    if (s.trAmount > s.totalInclVat) {
      return { ok: false, error: 'ROT/RUT-avdraget är större än fakturans totalsumma.' };
    }
    if (!Number.isFinite(s.customerPays) || s.customerPays < 0) {
      return { ok: false, error: 'ROT/RUT-avdraget är större än fakturans totalsumma.' };
    }
    return { ok: true };
  },

  /* V37 §1: minimal, beroendefri deep clone för prospective-kopian.
     JSON.parse(JSON.stringify(...)) (V35/V36) serialiserar icke-finita
     tal till null — NaN/Infinity/-Infinity → null — vilket gjorde att
     _rawTrAmount() (V36) tolkade ett redan ogiltigt ROT/RUT-belopp som
     "saknat" och normaliserade det till ett falskt giltigt 0 i KOPIAN,
     trots att originalet korrekt bedömdes ogiltigt av
     validateFinancialState(). Denna klon kopierar objekt/arrayer
     rekursivt och lämnar alla primitiva värden (inkl. NaN/Infinity/
     -Infinity/null/strings/booleans) OFÖRÄNDRADE — exakt den datamodell
     InvoiceService faktiskt använder för en faktura (nästlade objekt/
     arrayer av primitiver, inga funktioner/Date-instanser/cirkulära
     referenser). structuredClone() övervägdes men valdes bort: den är
     inte garanterat tillgänglig i alla miljöer denna vanilla-JS-SPA kan
     köras i utan byggsteg, och en egen liten rekursiv klon är säkrare/
     mer förutsägbar för just detta ändamål än att införa ett beroende på
     en global API vars stöd inte kan garanteras här. */
  _deepClone(value) {
    if (Array.isArray(value)) return value.map(v => this._deepClone(v));
    if (value !== null && typeof value === 'object') {
      const out = {};
      Object.keys(value).forEach(k => { out[k] = this._deepClone(value[k]); });
      return out;
    }
    return value;
  },

  /* V35 §6: prospective validation — MUTERA INTE den riktiga fakturan
     först. Bygg en kopia, applicera den tänkta ändringen på kopian,
     validera kopian, och returnera resultatet. Anroparen muterar den
     RIKTIGA fakturan bara om check.ok är true — ingen mutate→rollback-
     lösning någonstans. */
  _prospectiveCheck(inv, applyFn) {
    const copy = this._deepClone(inv);
    applyFn(copy);
    return this.validateFinancialState(copy);
  },

  /* V35 §10: canonical numeric validation för fakturarad-data — service-
     lagret litar inte längre på att UI:ts min="0" faktiskt stoppade
     negativa/NaN/Infinity-värden; ett direktanrop kan skicka vad som
     helst. qty/unitPrice måste vara finita och >= 0. vatRate normaliseras
     0-safe (ett explicit 0 är giltigt) och måste därefter vara ett finit
     tal 0–100 — annars nekas HELA anropet, ingen tyst gissning. Endast
     fält som faktiskt finns i `data` valideras/returneras (så description/
     unit-only-uppdateringar inte tvingas skicka med qty/pris/vat). */
  _validateLineData(data) {
    const out = {};
    if (data.description !== undefined) out.description = String(data.description);
    if (data.unit !== undefined) out.unit = String(data.unit);
    if (data.source !== undefined) out.source = String(data.source);
    if (data.freetext !== undefined) out.freetext = String(data.freetext);
    if (data.qty !== undefined) {
      const q = Number(data.qty);
      if (!Number.isFinite(q) || q < 0) return { ok: false, error: 'Ogiltigt antal.' };
      out.qty = q;
    }
    if (data.unitPrice !== undefined) {
      const p = Number(data.unitPrice);
      if (!Number.isFinite(p) || p < 0) return { ok: false, error: 'Ogiltigt pris.' };
      out.unitPrice = p;
    }
    if (data.vatRate !== undefined) {
      const v = this.normalizeVatRate(data.vatRate, NaN);
      if (!Number.isFinite(v)) return { ok: false, error: 'Ogiltig momssats.' };
      out.vatRate = v;
    }
    return { ok: true, data: out };
  },

  /* Manuell fakturarad. sourceRefs kan ALDRIG skickas in här — en ny rad
     skapad via addLine() är per definition inte source-backed (V33 §25-
     principen, oförändrad sedan V32). V35 §10/§11: numerisk data
     canonical-valideras (qty/unitPrice/vatRate) innan raden sparas, och
     `id`/`sourceId` kan aldrig skrivas över av anroparen — en manuell
     rad ska aldrig kunna fejka en source-claim genom att smyga med ett
     sourceId. Radens type/source-LABEL (Tid/Material/Fastpris/Övrigt/
     Fritext) får dock fortsatt sättas av UI:t — det är bara identitet/
     claim-fälten som är skyddade. */
  async addLine(invId, lineData) {
    if (typeof Auth === 'undefined' || !Auth.can('invoice_create')) {
      return { ok: false, error: 'Du saknar behörighet för denna åtgärd.' };
    }
    const inv = getInv(invId);
    if (!inv) return { ok: false, error: 'Fakturan hittades inte.' };
    if (!this.canEditLines(inv)) {
      return { ok: false, error: `Fakturan är ${statusLabel(inv.status)} och kan inte ändras.` };
    }
    const safeData = Object.assign({}, lineData);
    delete safeData.sourceRefs;
    delete safeData.id;
    delete safeData.sourceId;
    const validated = this._validateLineData(safeData);
    if (!validated.ok) return { ok: false, error: validated.error };
    const merged = Object.assign({}, safeData, validated.data);
    const line = Object.assign({ vatRate: 25, source: 'Manuell' }, merged, {
      id: 'L' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      sourceId: ''
    });
    // P0 FINAL INTEGRATION: atomisk append av EN redan validerad rad,
    // istället för lokal mutation + generisk persist().
    const r = await this._call('lineAdd', { invoiceId: invId, line });
    if (!r.ok) return r;
    this._applyLocally(r.data.invoice);
    return { ok: true, line };
  },

  /* V33 §11: sourceRefs (och den övriga source-identiteten: source/
     sourceId/id) är IMMUTABLE så länge raden finns — vanlig formdata från
     redigeringsdialogen kan aldrig skriva över eller nolla dem, oavsett vad
     anroparen skickar in. description/qty/unitPrice/vatRate får fortsatt
     ändras fritt enligt befintligt designbeslut.

     V35 §10: numerisk data canonical-valideras innan den sparas — samma
     regler som addLine (finita, icke-negativa qty/pris, momssats 0–100).

     V35 §8: prospective ROT/RUT-kontroll INNAN mutation. Om ändringen
     skulle göra fakturans nya totalsumma mindre än ett redan satt ROT/RUT-
     avdrag byggs en kopia av fakturan med ändringen applicerad, valideras,
     och HELA anropet nekas om ogiltigt — originalraden ligger kvar
     oförändrad, ingen persist. */
  async updateLine(invId, lineId, data) {
    if (typeof Auth === 'undefined' || !Auth.can('invoice_create')) {
      return { ok: false, error: 'Du saknar behörighet för denna åtgärd.' };
    }
    const inv = getInv(invId);
    if (!inv) return { ok: false, error: 'Fakturan hittades inte.' };
    if (!this.canEditLines(inv)) {
      return { ok: false, error: `Fakturan är ${statusLabel(inv.status)} och kan inte ändras.` };
    }
    const line = inv.lines.find(l => l.id === lineId);
    if (!line) return { ok: false, error: 'Raden hittades inte.' };
    const safeData = Object.assign({}, data);
    delete safeData.sourceRefs;
    delete safeData.source;
    delete safeData.sourceId;
    delete safeData.id;
    const validated = this._validateLineData(safeData);
    if (!validated.ok) return { ok: false, error: validated.error };
    const merged = Object.assign({}, safeData, validated.data);

    const check = this._prospectiveCheck(inv, copy => {
      const l = copy.lines.find(x => x.id === lineId);
      if (l) Object.assign(l, merged);
    });
    if (!check.ok) {
      return { ok: false, error: 'ROT/RUT-avdraget är större än fakturans nya totalsumma. Justera avdraget innan raden ändras.' };
    }

    // P0 FINAL INTEGRATION: atomisk patch av EN rad (redan validerad),
    // istället för lokal mutation + generisk persist().
    const r = await this._call('lineUpdate', { invoiceId: invId, lineId, patch: merged });
    if (!r.ok) return r;
    this._applyLocally(r.data.invoice);
    return { ok: true };
  },

  /* V33 §4: tar bort en rad ur ett redigerbart utkast och reconcilerar
     ALLA AO som radens sourceRefs pekade på — INNAN den enda persist().
     Källan blir därmed tillgänglig i kön igen (BillingQueueService räknar
     alltid om från grunden) och en ev. felaktigt auto-satt 'fakturerad'-
     status på AO:t backas samtidigt via reconcileWorkOrderBilling().

     V35 §9: prospective ROT/RUT-kontroll INNAN mutation — om att ta bort
     raden skulle göra fakturans nya totalsumma mindre än ett redan satt
     ROT/RUT-avdrag nekas HELA anropet. Raden ligger kvar (sourceRefs
     oförändrade, ingen reconciliation, ingen persist) tills avdraget
     justerats. */
  async deleteLine(invId, lineId) {
    if (typeof Auth === 'undefined' || !Auth.can('invoice_create')) {
      return { ok: false, error: 'Du saknar behörighet för denna åtgärd.' };
    }
    const inv = getInv(invId);
    if (!inv) return { ok: false, error: 'Fakturan hittades inte.' };
    if (!this.canEditLines(inv)) {
      return { ok: false, error: `Fakturan är ${statusLabel(inv.status)} och kan inte ändras.` };
    }
    const check = this._prospectiveCheck(inv, copy => {
      copy.lines = (copy.lines || []).filter(l => l.id !== lineId);
    });
    if (!check.ok) {
      return { ok: false, error: 'Justera ROT/RUT-avdraget innan raden tas bort.' };
    }
    const line = (inv.lines || []).find(l => l.id === lineId);
    const affectedAoIds = new Set();
    if (line) (line.sourceRefs || []).forEach(r => { if (r.workOrderId) affectedAoIds.add(r.workOrderId); });

    // P0 FINAL INTEGRATION: atomisk borttagning av EN rad istället för
    // lokal mutation + generisk persist(). reconcileWorkOrderBilling()
    // (vift_workOrders, annan nyckel) körs fortfarande client-side EFTER
    // ett lyckat svar, oförändrat.
    const r = await this._call('lineDelete', { invoiceId: invId, lineId });
    if (!r.ok) return r;
    this._applyLocally(r.data.invoice);

    if (typeof BillingQueueService !== 'undefined') {
      affectedAoIds.forEach(aoId => BillingQueueService.reconcileWorkOrderBilling(aoId));
    }
    return { ok: true };
  },

  /* V33 §12: riktig delete av ett REDIGERBART fakturautkast (fanns inte i
     V32 — testet där simulerade bara state-radering). Endast 'utkast' kan
     raderas (samma spärr som line-editing). Samlar sourceRefs → reconcilerar
     berörda AO → EN persist. Skickade/betalda/förfallna kan aldrig raderas
     härifrån; makulering hanteras via status, inte hard delete (§8). */
  async deleteDraft(invId) {
    if (typeof Auth === 'undefined' || !Auth.can('invoice_create')) {
      return { ok: false, error: 'Du saknar behörighet för denna åtgärd.' };
    }
    const inv = getInv(invId);
    if (!inv) return { ok: false, error: 'Fakturan hittades inte.' };
    if (inv.status !== 'utkast') {
      return { ok: false, error: 'Endast utkast kan raderas.' };
    }
    const affectedAoIds = new Set();
    (inv.lines || []).forEach(l => (l.sourceRefs || []).forEach(r => { if (r.workOrderId) affectedAoIds.add(r.workOrderId); }));

    // P0 FINAL INTEGRATION: atomisk borttagning (RPC:n skriver även en
    // kanonisk activityLog-post i samma transaktion) istället för lokal
    // mutation + generisk persist().
    const r = await this._call('draftDelete', { invoiceId: invId });
    if (!r.ok) return r;
    this._removeLocally(invId);
    this._applyActivityLog(r.data.activityLog);

    if (typeof BillingQueueService !== 'undefined') {
      affectedAoIds.forEach(aoId => BillingQueueService.reconcileWorkOrderBilling(aoId));
    }
    return { ok: true };
  },

  /* V34 §9/§10/§11: godtyckliga statusövergångar är stängda. Endast de
     övergångar som finns i STATUS_TRANSITIONS[prevStatus] tillåts — allt
     annat (okänd status, hopp som "betald→utkast" eller "utkast→betald")
     nekas med ok:false, ingen mutation. Detta stänger kryphålet där en
     slutgiltig faktura kunde tillfälligt sättas till 'utkast' för att
     kringgå canEditLines()-låset.

     makulerad → utkast är den ENDA vägen tillbaka från makulering (V34
     §11) — inte direkt till skickad/betald/förfallen. V33:s kollisionskoll
     (en makulerad faktura reserverar inte sina sources — se
     BillingQueueService._claimedSourceKeys — så en ANNAN aktiv faktura kan
     under tiden ha claimat samma sourceKey) behålls oförändrad för just
     denna övergång. Reconciliation körs (INNAN den enda persist()) när en
     source-aware faktura går TILL eller FRÅN 'makulerad'.

     V34 §13: vid återaktivering makulerad→utkast nollställs sentAt/paidAt
     — fakturan är återigen ett obehandlat utkast och ska inte bära kvar
     tidsstämplar från ett tidigare, nu ogiltigförklarat, skede. Historiken
     finns kvar i ActivityService-loggen. */
  /* P0 PART B (INVOICE PAYMENT-STATUS R1): går nu via den atomiska
     invoice_set_status-RPC:n (radlåst, server-sidig övergångs- och
     kollisionskontroll, kanonisk activityLog-post i samma transaktion)
     istället för lokal mutation + generisk whole-array persist() — se
     migrationens filhuvud för varför (två skrivare som samtidigt ändrar
     status på OLIKA fakturor kunde tidigare tyst radera varandras
     ändring). Funktionen är nu async; de två anropsställena i
     InvoicesPage.js är uppdaterade till att invänta den — se 02_diffs/.

     SCOPE (oförändrat beteende, se migrationens filhuvud/README §2):
     endast SJÄLVA statusövergången + dess kollisionskontroll är
     flyttad server-sidigt. reconcileWorkOrderBilling() (rör
     vift_workOrders, en annan nyckel) körs fortfarande client-side
     EFTER ett lyckat serversvar, oförändrad — den kör bara vid
     makulering/återaktivering, inte vid vanliga statusändringar. */
  async setStatus(invId, status) {
    if (typeof Auth === 'undefined' || !Auth.can('invoice_create')) {
      return { ok: false, error: 'Du saknar behörighet för denna åtgärd.' };
    }
    const inv = getInv(invId);
    if (!inv) return { ok: false, error: 'Fakturan hittades inte.' };
    if (this.VALID_STATUSES.indexOf(status) === -1) {
      return { ok: false, error: 'Ogiltig status.' };
    }
    const prevStatus = inv.status;
    if (status === prevStatus) return { ok: true };

    /* F-002 HÅRD SPÄRR (se staleDiscrepancySnapshot()): ingen övergång
       till 'skickad' så länge en känd prisavvikelse saknar ett giltigt,
       matchande godkännande. Noll mutation, inget serveranrop. */
    if (status === 'skickad') {
      const trReview = this.taxReductionReviewNeeded(inv);
      if (trReview) {
        return { ok: false, code: 'tax_reduction_review',
          error: 'Offert ' + trReview.map(o => o.offerId).join(', ') + ' angav ' + (trReview[0].type ? trReview[0].type.toUpperCase() : 'RUT/ROT') + '-avdrag (' +
            trReview.reduce((s, o) => s + o.amount, 0) + ' kr), men fakturan saknar avdrag. Lägg till avdraget eller bekräfta "Fakturera utan avdrag" innan fakturan markeras skickad.' };
      }
      const st = this.staleOverrideStatus(inv);
      if (st.stale.length && !st.covered) {
        return {
          ok: false,
          code: 'stale_price_unapproved',
          staleLineIds: st.uncovered.map(x => x.lineId),
          error: (st.supersededOverride
            ? 'Prisavvikelsen har ändrats sedan den senast godkändes — det tidigare godkännandet gäller inte längre. '
            : '') +
            `Fakturan kan inte markeras skickad: ${st.uncovered.length === 1 ? 'en fastprisrad' : st.uncovered.length + ' fastprisrader'} matchar inte arbetsorderns nuvarande pris. ` +
            'Rätta beloppet på fakturaraden, eller låt en behörig användare godkänna avvikelsen med en motivering.'
        };
      }
    }

    const r = await this._callSetStatus(invId, status);
    if (!r.ok) return r;

    if (!r.changed) return { ok: true };

    // Applicera den server-canoniska fakturan OCH activityLog lokalt
    // (by id — rör inga andra fakturor/aktiviteter i arrayerna).
    const idx = state.invoices.findIndex(i => i.id === invId);
    if (idx >= 0) state.invoices[idx] = r.invoice;
    if (Array.isArray(r.activityLog)) state.activityLog = r.activityLog;
    try {
      localStorage.setItem('vift_invoices', JSON.stringify(state.invoices));
      localStorage.setItem('vift_activityLog', JSON.stringify(state.activityLog));
    } catch (e) {}

    const reactivating = prevStatus === 'makulerad' && status === 'utkast';
    if (r.invoice.sourceAware && typeof BillingQueueService !== 'undefined') {
      const becameInactive = status === 'makulerad' && prevStatus !== 'makulerad';
      const becameActive   = reactivating;
      if (becameInactive || becameActive) {
        const affectedAoIds = new Set();
        (r.invoice.lines || []).forEach(l => (l.sourceRefs || []).forEach(x => { if (x.workOrderId) affectedAoIds.add(x.workOrderId); }));
        affectedAoIds.forEach(aoId => BillingQueueService.reconcileWorkOrderBilling(aoId));
      }
    }

    return { ok: true };
  },

  /* P0 FINAL INTEGRATION: konsoliderad till den gemensamma invoice-write
     EF:en (se _call() ovan) istället för en egen invoice-set-status EF
     — samma dispatcher-stil som rondering-pass-write. */
  async _callSetStatus(invId, status) {
    const r = await this._call('setStatus', { invoiceId: invId, status });
    if (!r.ok) {
      const map = {
        'invalid_transition': `Status kan inte ändras från ${statusLabel((getInv(invId)||{}).status)} till ${statusLabel(status)}.`,
      };
      return { ok: false, error: map[r.error] || r.error };
    }
    return { ok: true, invoice: r.data.invoice, activityLog: r.data.activityLog, changed: r.data.changed };
  },

  /* V35 §1/§2 / V36 §1: kanonisk 0-safe momsnormalisering. `vatRate || 25`
     slår felaktigt om ett giltigt 0 % — 0 är falsy i JS. null/undefined/
     tomsträng (inklusive en sträng som bara innehåller whitespace, t.ex.
     ' ' eller '\t' — `Number('   ') === 0` skulle annars tysta ett
     "inget värde satt"-fält till ett falskt explicit 0 %) betyder "inget
     värde satt" och faller tillbaka på `fallback` (25); ett giltigt
     numeriskt värde 0–100 behålls EXAKT (inklusive 0); NaN/Infinity/
     negativt/>100 räknas som ogiltigt och faller också tillbaka —
     används överallt där vi MÅSTE ha ett användbart tal att räkna/visa
     (calcSummary, radrendering, print). BillingQueueService har en egen,
     striktare variant för materialkandidater där ett ogiltigt-men-inte-
     tomt värde istället ska bli en synlig issue snarare än att tyst falla
     tillbaka (V35 §4 / V36 §2). */
  normalizeVatRate(value, fallback = 25) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'string' && value.trim() === '') return fallback;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100) return fallback;
    return n;
  },

  /* V36 §3/§4: central ROT/RUT-beloppsnormalisering. `tr.amount || 0`
     maskerade ett matematiskt ogiltigt belopp (NaN/Infinity/negativt)
     till 0 INNAN Number.isFinite() hann köra — samma bugg-klass som
     vatRate||25 ovan, fast för avdragsbeloppet. Saknat/tomt värde
     (null/undefined/tomsträng/whitespace) betyder "inget satt" och
     normaliseras till giltigt 0 (oförändrad befintlig default-semantik).
     Ett SATT men matematiskt ogiltigt värde returneras OFÖRÄNDRAT (kan
     bli NaN/Infinity/negativt) så att calcSummary()/validateFinancialState()
     visar/upptäcker det istället för att tysta det till ett falskt
     giltigt 0. */
  _rawTrAmount(tr) {
    if (!tr || (tr.type !== 'rot' && tr.type !== 'rut')) return 0;
    const raw = tr.amount;
    if (raw === null || raw === undefined) return 0;
    if (typeof raw === 'string' && raw.trim() === '') return 0;
    return Number(raw);
  },

  calcSummary(inv) {
    const lines    = inv.lines || [];
    const linesEx  = lines.reduce((s, l) => s + (l.qty||0)*(l.unitPrice||0), 0);
    const linesVat = lines.reduce((s, l) => s + (l.qty||0)*(l.unitPrice||0)*(this.normalizeVatRate(l.vatRate)/100), 0);

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
    const trAmount = this._rawTrAmount(tr);
    const customerPays = totalInclVat - trAmount;

    return { linesEx, linesVat, discAmt, exVat, vat, totalInclVat, trAmount, customerPays };
  },

  calcTotals(inv) {
    const s = this.calcSummary(inv);
    return { exVat: s.exVat, vat: s.vat, total: s.totalInclVat };
  },

  /* V34 §16: draft-lock + input-validering. Ingen negativ/orimlig rabatt
     kan längre sättas — och en fast rabatt kan aldrig överstiga fakturans
     delsumma (skulle annars ge en negativ totalsumma).

     V35 §7: prospective ROT/RUT-kontroll INNAN mutation. En rabatt som
     skulle sänka fakturans nya totalsumma under ett redan satt ROT/RUT-
     avdrag nekas helt — avdraget måste minskas/tas bort (setTaxReduction)
     innan rabatten kan sparas. */
  async setDiscount(invId, type, value) {
    if (typeof Auth === 'undefined' || !Auth.can('invoice_create')) {
      return { ok: false, error: 'Du saknar behörighet för denna åtgärd.' };
    }
    const inv = getInv(invId);
    if (!inv) return { ok: false, error: 'Fakturan hittades inte.' };
    if (!this.canEditDraft(inv)) {
      return { ok: false, error: `Fakturan är ${statusLabel(inv.status)} och kan inte ändras.` };
    }
    const t = type || 'none';
    if (['none', 'percent', 'fixed'].indexOf(t) === -1) {
      return { ok: false, error: 'Ogiltig rabatttyp.' };
    }
    let finalValue = 0;
    if (t === 'percent') {
      const v = parseFloat(value);
      if (!Number.isFinite(v) || v < 0 || v > 100) return { ok: false, error: 'Ogiltigt rabattvärde.' };
      finalValue = v;
    } else if (t === 'fixed') {
      const v = parseFloat(value);
      if (!Number.isFinite(v) || v < 0) return { ok: false, error: 'Ogiltigt rabattvärde.' };
      const linesEx = (inv.lines || []).reduce((s, l) => s + (l.qty || 0) * (l.unitPrice || 0), 0);
      if (v > linesEx) return { ok: false, error: 'Rabatten kan inte vara större än fakturans delsumma.' };
      finalValue = v;
    }

    const check = this._prospectiveCheck(inv, copy => { copy.discount = { type: t, value: finalValue }; });
    if (!check.ok) {
      return { ok: false, error: 'Rabatten skulle göra ROT/RUT-avdraget större än fakturans nya totalsumma. Minska eller ta bort avdraget innan du sparar rabatten.' };
    }

    const r = await this._call('discountSet', { invoiceId: invId, discount: { type: t, value: finalValue } });
    if (!r.ok) return r;
    this._applyLocally(r.data.invoice);
    return { ok: true };
  },

  /* V34 §17: draft-lock + minsta säkra financial sanity-validering. Inga
     nya juridiska ROT/RUT-regler/procentsatser hårdkodas här (UI:s
     befintliga auto-beräkning ligger kvar oförändrad) — bara: inga
     negativa värden.

     V35 §5/§6: gränskontrollen "avdrag <= totalsumma" görs nu via samma
     centrala prospective invariant-check som setDiscount/updateLine/
     deleteLine använder (validateFinancialState via _prospectiveCheck) —
     inte längre en egen, lokal jämförelse mot `calcSummary(inv)` innan
     ändringen. Samma regler, en enda kodväg. */
  async setTaxReduction(invId, type, amount, basis, note) {
    if (typeof Auth === 'undefined' || !Auth.can('invoice_create')) {
      return { ok: false, error: 'Du saknar behörighet för denna åtgärd.' };
    }
    const inv = getInv(invId);
    if (!inv) return { ok: false, error: 'Fakturan hittades inte.' };
    if (!this.canEditDraft(inv)) {
      return { ok: false, error: `Fakturan är ${statusLabel(inv.status)} och kan inte ändras.` };
    }
    const t = type || 'none';
    if (['none', 'rot', 'rut'].indexOf(t) === -1) {
      return { ok: false, error: 'Ogiltig ROT/RUT-typ.' };
    }
    let finalAmount = 0, finalBasis = 0;
    if (t !== 'none') {
      const a = parseFloat(amount);
      const b = parseFloat(basis);
      if (!Number.isFinite(a) || a < 0) return { ok: false, error: 'Ogiltigt avdragsbelopp.' };
      if (!Number.isFinite(b) || b < 0) return { ok: false, error: 'Ogiltigt underlag.' };
      finalAmount = a;
      finalBasis = b;
    }

    const check = this._prospectiveCheck(inv, copy => {
      copy.taxReduction = { type: t, amount: finalAmount, basis: finalBasis, note: note || '' };
    });
    if (!check.ok) {
      return { ok: false, error: 'Avdragsbeloppet kan inte vara större än fakturans totalsumma.' };
    }

    const r = await this._call('taxReductionSet', {
      invoiceId: invId, taxReduction: { type: t, amount: finalAmount, basis: finalBasis, note: note || '' }
    });
    if (!r.ok) return r;
    this._applyLocally(r.data.invoice);
    return { ok: true };
  },

  /* V34 §15: enda vägen att ändra referens/OCR/note — flyttad från
     InvoicesPage.openEditMeta() som tidigare muterade fakturan direkt och
     körde persist() i sidan (ingen behörighetskontroll, inget draft-lock).
     Endast definierade fält tillåts; allt annat i `data` ignoreras. */
  async updateMeta(invId, data) {
    if (typeof Auth === 'undefined' || !Auth.can('invoice_create')) {
      return { ok: false, error: 'Du saknar behörighet för denna åtgärd.' };
    }
    const inv = getInv(invId);
    if (!inv) return { ok: false, error: 'Fakturan hittades inte.' };
    if (!this.canEditDraft(inv)) {
      return { ok: false, error: `Fakturan är ${statusLabel(inv.status)} och kan inte ändras.` };
    }
    const safeData = data || {};
    const patch = {};
    if (typeof safeData.customerReference === 'string') patch.customerReference = safeData.customerReference.trim();
    if (typeof safeData.ocr === 'string') patch.ocr = safeData.ocr.trim();
    if (typeof safeData.note === 'string') patch.note = safeData.note.trim();
    const r = await this._call('metaUpdate', { invoiceId: invId, patch });
    if (!r.ok) return r;
    this._applyLocally(r.data.invoice);
    return { ok: true };
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
