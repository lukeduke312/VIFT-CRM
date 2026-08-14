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
  createFromAO(aoId) {
    const ao = getAO(aoId);
    if (!ao) return null;

    const allSources = BillingQueueService.getUnclaimedSourcesForAO(aoId);
    if (allSources.length === 0) {
      return { ok: false, error: 'Inget kvar att fakturera på denna arbetsorder.' };
    }
    const issueSources = allSources.filter(c => !c.selectable);
    if (issueSources.length > 0) {
      return {
        ok: false,
        error: `${issueSources.length} underlag på arbetsordern kräver åtgärd innan hela arbetsordern kan faktureras. Öppna Att fakturera.`,
        needsAction: true
      };
    }

    /* V33 §7: EN persist totalt — offerId sätts INNAN motorns enda
       persist()-anrop via onInvoiceBuilt-hooken, inget andra skrivpass. */
    const result = BillingQueueService.createInvoicesFromSourceKeys(
      allSources.map(c => c.sourceKey),
      { onInvoiceBuilt: inv => { inv.offerId = ao.offerId || ''; } }
    );
    if (!result.ok || !result.created || !result.created.length) {
      return { ok: false, error: result.error || 'Kunde inte skapa fakturaunderlag.', unavailable: result.unavailable };
    }

    return { ok: true, invoice: result.created[0] };
  },

  /* Tomt fakturaunderlag — fail closed (V33 §9). */
  createBlank(customerId = '', opts = {}) {
    if (typeof Auth === 'undefined' || !Auth.can('invoice_create')) {
      return { ok: false, error: 'Du saknar behörighet för denna åtgärd.' };
    }
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
  addLine(invId, lineData) {
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
    inv.lines.push(line);
    inv.updatedAt = new Date().toISOString();
    persist();
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
  updateLine(invId, lineId, data) {
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

    Object.assign(line, merged);
    inv.updatedAt = new Date().toISOString();
    persist();
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
  deleteLine(invId, lineId) {
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

    inv.lines = inv.lines.filter(l => l.id !== lineId);
    inv.updatedAt = new Date().toISOString();

    if (typeof BillingQueueService !== 'undefined') {
      affectedAoIds.forEach(aoId => BillingQueueService.reconcileWorkOrderBilling(aoId));
    }
    persist();
    return { ok: true };
  },

  /* V33 §12: riktig delete av ett REDIGERBART fakturautkast (fanns inte i
     V32 — testet där simulerade bara state-radering). Endast 'utkast' kan
     raderas (samma spärr som line-editing). Samlar sourceRefs → reconcilerar
     berörda AO → EN persist. Skickade/betalda/förfallna kan aldrig raderas
     härifrån; makulering hanteras via status, inte hard delete (§8). */
  deleteDraft(invId) {
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

    state.invoices = (state.invoices || []).filter(i => i.id !== invId);

    if (typeof BillingQueueService !== 'undefined') {
      affectedAoIds.forEach(aoId => BillingQueueService.reconcileWorkOrderBilling(aoId));
    }
    if (typeof ActivityService !== 'undefined') {
      ActivityService.log('invoice_deleted', `Fakturautkast ${invId} raderat`, { invoiceId: invId, customerId: inv.customerId });
    }
    persist();
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
  setStatus(invId, status) {
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

    const allowed = this.STATUS_TRANSITIONS[prevStatus] || [];
    if (allowed.indexOf(status) === -1) {
      return { ok: false, error: `Status kan inte ändras från ${statusLabel(prevStatus)} till ${statusLabel(status)}.` };
    }

    const reactivating = prevStatus === 'makulerad' && status === 'utkast';
    if (reactivating && inv.sourceAware && typeof BillingQueueService !== 'undefined') {
      const otherClaims = BillingQueueService.claimedByOtherActiveInvoices(inv.id);
      const collision = (inv.lines || []).some(l => (l.sourceRefs || []).some(r => otherClaims.has(r.sourceKey)));
      if (collision) {
        return { ok: false, error: 'En eller flera rader i denna faktura har hunnit fakturerats på en annan aktiv faktura. Kan inte återaktivera.' };
      }
    }

    inv.status    = status;
    inv.updatedAt = new Date().toISOString();
    if (status === 'betald') inv.paidAt = new Date().toISOString();
    if (status === 'skickad') inv.sentAt = new Date().toISOString();
    if (reactivating) { inv.sentAt = ''; inv.paidAt = ''; }
    ActivityService.log('invoice_status',
      `Faktura ${inv.id} ändrad till ${statusLabel(status)}`,
      { customerId: inv.customerId, invoiceId: inv.id });

    if (inv.sourceAware && typeof BillingQueueService !== 'undefined') {
      const becameInactive = status === 'makulerad' && prevStatus !== 'makulerad';
      const becameActive   = reactivating;
      if (becameInactive || becameActive) {
        const affectedAoIds = new Set();
        (inv.lines || []).forEach(l => (l.sourceRefs || []).forEach(r => { if (r.workOrderId) affectedAoIds.add(r.workOrderId); }));
        affectedAoIds.forEach(aoId => BillingQueueService.reconcileWorkOrderBilling(aoId));
      }
    }

    persist();
    return { ok: true };
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
  setDiscount(invId, type, value) {
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

    inv.discount = { type: t, value: finalValue };
    inv.updatedAt = new Date().toISOString();
    persist();
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
  setTaxReduction(invId, type, amount, basis, note) {
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

    inv.taxReduction = { type: t, amount: finalAmount, basis: finalBasis, note: note || '' };
    inv.updatedAt = new Date().toISOString();
    persist();
    return { ok: true };
  },

  /* V34 §15: enda vägen att ändra referens/OCR/note — flyttad från
     InvoicesPage.openEditMeta() som tidigare muterade fakturan direkt och
     körde persist() i sidan (ingen behörighetskontroll, inget draft-lock).
     Endast definierade fält tillåts; allt annat i `data` ignoreras. */
  updateMeta(invId, data) {
    if (typeof Auth === 'undefined' || !Auth.can('invoice_create')) {
      return { ok: false, error: 'Du saknar behörighet för denna åtgärd.' };
    }
    const inv = getInv(invId);
    if (!inv) return { ok: false, error: 'Fakturan hittades inte.' };
    if (!this.canEditDraft(inv)) {
      return { ok: false, error: `Fakturan är ${statusLabel(inv.status)} och kan inte ändras.` };
    }
    const safeData = data || {};
    if (typeof safeData.customerReference === 'string') inv.customerReference = safeData.customerReference.trim();
    if (typeof safeData.ocr === 'string') inv.ocr = safeData.ocr.trim();
    if (typeof safeData.note === 'string') inv.note = safeData.note.trim();
    inv.updatedAt = new Date().toISOString();
    persist();
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
