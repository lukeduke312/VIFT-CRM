/**
 * ProjectService — V54A Projekt-kärna
 *
 * Ett Projekt är en namngiven affärshelhet hos EN kund. V54A bygger
 * ENDAST kärn-entiteten (skapa/redigera/arkivera/lista) — inga
 * kopplingar till Arbetsorder/Offert/Uppgift/Faktura/Dokument finns
 * än (se RAPPORT-V54-PROJEKT-DISCOVERY.md, planerat till V54B/C/D).
 *
 * Datamodell: { id, name, customerId, propertyId, allowMultiProperty,
 *               status, responsibleUserId, startDate, endDate,
 *               description, note, archived, createdAt, updatedAt,
 *               createdBy }
 *
 * VIKTIGT — `status` är ETT MANUELLT livscykel-fält. Ingenstans i
 * denna fil (eller någon annanstans i V54A) får `status` ändras
 * automatiskt baserat på barn-entiteters tillstånd — det finns inga
 * barn-entiteter i V54A, men principen gäller redan nu och ska INTE
 * brytas när V54B bygger vidare (se korrigering #2 i uppdraget).
 * `archived` är ett separat fält, oberoende av `status` — samma
 * mönster som `Offer.archived`.
 *
 * Valideringen nedan körs ALLTID i denna service, oavsett vad ett
 * eventuellt UI redan kontrollerat — samma `{ok,error}`-kontrakt som
 * InvoiceService._validateLineData() redan etablerat i kodbasen.
 */
const ProjectService = {

  VALID_STATUSES: PROJECT_STATUSES.map(s => s.key),   // ['planerad','pågående','pausad','klar','avslutad']

  /* V54B §32 — strikt fält-vitlista för de affärsfält en anropare
     (formulär idag, ett framtida AI-agent-verktygslager imorgon) FÅR
     sätta via create()/update(). Systemfält (id/createdAt/createdBy/
     archived/updatedAt) hanteras separat, redan låsta sedan V54A R1 —
     se create()/update() nedan. Granskad mot befintlig V54A-användning
     (ProjectsPage._save() skickar exakt dessa fält redan) — ingen
     regressionsrisk, inga fler fält behöver läggas till. */
  WRITABLE_FIELDS: ['name', 'customerId', 'propertyId', 'allowMultiProperty', 'status', 'responsibleUserId', 'startDate', 'endDate', 'description', 'note'],

  _whitelist(data) {
    const out = {};
    (data ? Object.keys(data) : []).forEach(k => {
      if (this.WRITABLE_FIELDS.includes(k)) out[k] = data[k];
    });
    return out;
  },

  /* ── Läsning ──────────────────────────────────────────────────── */

  getAll() {
    return state.projects || [];
  },

  getActive() {
    return this.getAll().filter(p => !p.archived);
  },

  getArchived() {
    return this.getAll().filter(p => !!p.archived);
  },

  getById(id) {
    return getProject(id);
  },

  /* Ren textsökning — samma mönster som ActivitiesService.search():
     namn, ID, kundens visningsnamn, fastighetens namn/adress. */
  search(list, rawQuery) {
    const q = (rawQuery || '').trim().toLowerCase();
    if (!q) return list || [];
    return (list || []).filter(p => {
      const cu   = getCu(p.customerId);
      const prop = p.propertyId ? getObj(p.propertyId) : null;
      /* V54A R1 — blockerare 1: fastighetens namn OCH adress indexeras
         som SEPARATA sökfält (inte `name || address`, vilket tystade
         bort adressen helt för varje fastighet som råkade ha ett eget
         namn) — en fastighet kan ha BÅDA satta samtidigt och sökning
         måste träffa på antingen. */
      const haystack = [
        p.name, p.id,
        cu ? CustomerService.displayName(cu) : '',
        prop ? prop.name : '',
        prop ? prop.address : ''
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  },

  statusLabel(status) {
    const m = PROJECT_STATUSES.find(s => s.key === status);
    return m ? m.label : (status || '');
  },

  /* ── Validering — den KANONISKA sanningskällan, körs oavsett UI ──
     `data` = de fält som ska sättas/ändras (partiell vid update).
     `existing` = den befintliga posten vid update, annars null.
     Returnerar `{ ok:true }` eller `{ ok:false, error:'...' }` —
     samma kontrakt som InvoiceService redan använder. */
  _validate(data, existing) {
    data = data || {};

    const pick = (field, def) =>
      data[field] !== undefined ? data[field] : (existing ? existing[field] : def);

    const name = pick('name', '');
    if (!name || !String(name).trim()) {
      return { ok: false, error: 'Namn krävs' };
    }

    const customerId = pick('customerId', '');
    if (!customerId) {
      return { ok: false, error: 'Kund krävs' };
    }
    if (!getCu(customerId)) {
      return { ok: false, error: 'Vald kund finns inte' };
    }

    const propertyId = pick('propertyId', '') || '';
    if (propertyId) {
      const prop = getObj(propertyId);
      if (!prop) {
        return { ok: false, error: 'Vald fastighet finns inte' };
      }
      /* Kund-gränsen är ALDRIG eftergivlig — oavsett allowMultiProperty.
         allowMultiProperty styr en FRAMTIDA (V54B) invariant för barn-
         entiteter, inte huruvida den PRIMÄRA fastigheten här får
         tillhöra en annan kund. */
      if (prop.customerId !== customerId) {
        return { ok: false, error: 'Vald fastighet tillhör inte vald kund' };
      }
    }

    const responsibleUserId = pick('responsibleUserId', '') || '';
    if (responsibleUserId && !getStaff(responsibleUserId)) {
      return { ok: false, error: 'Vald ansvarig finns inte' };
    }

    const status = pick('status', 'planerad');
    if (!this.VALID_STATUSES.includes(status)) {
      return { ok: false, error: 'Ogiltig status: ' + status };
    }

    const startDate = pick('startDate', '') || '';
    const endDate   = pick('endDate', '') || '';
    if (startDate && endDate && endDate < startDate) {
      return { ok: false, error: 'Slutdatum kan inte vara före startdatum' };
    }

    if (data.allowMultiProperty !== undefined && typeof data.allowMultiProperty !== 'boolean') {
      return { ok: false, error: 'allowMultiProperty måste vara sant/falskt' };
    }

    return { ok: true };
  },

  /* ── Mutationer ───────────────────────────────────────────────── */

  create(data) {
    const validated = this._validate(data, null);
    if (!validated.ok) return { ok: false, error: validated.error };

    if (!state.projects) state.projects = [];
    const id   = newId(state.projects, 'PRJ');
    const user = state.currentUser;
    const now  = new Date().toISOString();

    /* V54A R1 — blockerare 3: `data` applicerades tidigare EFTER
       standardvärdena men FÖRE det sista, "låsande" objektet — som
       bara pinnade `id`/`createdAt`/`updatedAt`. `createdBy` och
       `archived` är LIKA MYCKET systemägda som `id`/`createdAt` (den
       förstnämnda ska ALLTID vara den faktiska inloggade användaren,
       den sistnämnda ska ALLTID börja `false` för ett nytt projekt) —
       en anropare (formulär eller framtida AI-agent-anrop) fick annars
       spoofa dem rakt igenom. Båda pinnas nu i samma sista, låsande
       objekt, exakt som id/createdAt/updatedAt redan var skyddade. */
    const proj = Object.assign({
      id,
      name: '',
      customerId: '',
      propertyId: '',
      allowMultiProperty: false,
      status: 'planerad',
      responsibleUserId: '',
      startDate: '',
      endDate: '',
      description: '',
      note: '',
      archived: false,
      createdAt: now,
      updatedAt: now,
      createdBy: user ? user.id : ''
    }, this._whitelist(data), {
      id, createdAt: now, updatedAt: now,
      createdBy: user ? user.id : '',
      archived: false
    });

    state.projects.push(proj);
    persist();
    return { ok: true, project: proj };
  },

  update(id, patch) {
    const proj = this.getById(id);
    if (!proj) return { ok: false, error: 'Projektet hittades inte' };

    const validated = this._validate(patch, proj);
    if (!validated.ok) return { ok: false, error: validated.error };

    /* id/createdAt/createdBy är oföränderliga — en patch får aldrig
       skriva över dem, oavsett vad anroparen råkar skicka med.
       V54A R1 — blockerare 3: `archived` läggs till samma skydd —
       arkivstatus får ENDAST ändras via archive()/unarchive(), aldrig
       via den generiska update()-vägen (annars kunde ett vanligt
       "Spara ändringar"-formulär av misstag, eller ett spoofat anrop,
       arkivera/avarkivera ett projekt som en bieffekt). */
    /* V54B §32 — vitlistningen ovan gör de fyra explicita delete()-
       raderna överflödiga (inget av dessa systemfält finns i
       WRITABLE_FIELDS), men de behålls medvetet som ett andra,
       redundant skyddslager — samma "två oberoende lager"-disciplin
       som V53B R1 etablerade, inte bara ett upprepat påstående. */
    const safePatch = this._whitelist(patch);
    delete safePatch.id;
    delete safePatch.createdAt;
    delete safePatch.createdBy;
    delete safePatch.archived;

    Object.assign(proj, safePatch, { updatedAt: new Date().toISOString() });
    persist();
    return { ok: true, project: proj };
  },

  /* Arkivering är INTE en statusändring — `status` rörs aldrig här. */
  archive(id) {
    const proj = this.getById(id);
    if (!proj) return { ok: false, error: 'Projektet hittades inte' };
    proj.archived  = true;
    proj.updatedAt = new Date().toISOString();
    persist();
    return { ok: true, project: proj };
  },

  unarchive(id) {
    const proj = this.getById(id);
    if (!proj) return { ok: false, error: 'Projektet hittades inte' };
    proj.archived  = false;
    proj.updatedAt = new Date().toISOString();
    persist();
    return { ok: true, project: proj };
  },

  /* ══════════════════════════════════════════════════════════════════
     V54B — RELATIONSINVARIANT-HJÄLPARE (barn: WorkOrder/Offer)
     ══════════════════════════════════════════════════════════════════
     Kanoniska, delade kontroller — återanvänds av BÅDE den interaktiva
     UI-synkroniseringen (WorkOrdersPage/WorkOrderDetailPage/OffersPage)
     OCH deras respektive defensiva save-time-lager, så de två aldrig
     kan divergera. Samma regel som RAPPORT-V54-PROJEKT-DISCOVERY.md §5:
     kundgränsen är ALDRIG eftergivlig; fastighetsgränsen är mjukare och
     styrs av allowMultiProperty. */

  /* Är en given kombination (customerId, propertyId) förenlig med ett
     specifikt projekt? propertyId får vara tomt/null (alltid tillåtet).
     V54B R1 — blockerare 2: funktionen litade tidigare på att den
     ANROPANDE koden redan garanterat att propertyId faktiskt tillhör
     customerId — vilket INTE är en giltig förutsättning för en kanonisk
     invariant-hjälpare (en anropare kan skicka in en manipulerad eller
     helt enkelt felaktig kombination). Fastigheten slås nu ALLTID upp
     och dess EGNA customerId verifieras mot den angivna customerId
     INNAN någon Projekt-jämförelse görs — annars kunde t.ex. en K2-
     fastighet råka bedömas "förenlig" med ett K1-projekt bara för att
     allowMultiProperty=true, trots att kundgränsen ska vara absolut. */
  isChildCompatible(projectId, customerId, propertyId) {
    const proj = this.getById(projectId);
    if (!proj) return false;
    if (proj.customerId !== customerId) return false;
    if (propertyId) {
      const prop = typeof getObj === 'function' ? getObj(propertyId) : null;
      if (!prop) return false;
      if (prop.customerId !== customerId) return false;
    }
    if (!propertyId) return true;
    if (!proj.propertyId) return true;
    if (proj.propertyId === propertyId) return true;
    return !!proj.allowMultiProperty;
  },

  /* Projekt en AO/Offert med given (customerId, propertyId) kan kopplas
     till — används för Projekt-väljaren på AO-redigering (§10) och för
     "Koppla offert"/"Koppla arbetsorder"-listorna i Projekt-detaljen. */
  getCompatibleProjects(customerId, propertyId) {
    return this.getActive().filter(p => this.isChildCompatible(p.id, customerId, propertyId));
  },

  /* V54B §11-12 — Offert har ingen egen OfferService (mutationer sker
     direkt i PageShells.js/OffersPage mot state.offers), så samma
     "kanonisk länk/flytt/lossa"-hjälpare som WorkOrderService.setProject()
     placeras här istället — exakt samma kontrakt och samma två regler:
     kompatibilitet krävs alltid, en flytt FRÅN ett annat projekt kräver
     opts.confirmedMove. */
  setOfferProject(offerId, projectId, opts) {
    const off = typeof getOff === 'function' ? getOff(offerId) : null;
    if (!off) return { ok: false, error: 'Offerten hittades inte' };
    opts = opts || {};
    const oldProjectId = off.projectId || '';
    const newProjectId = projectId || '';

    if (newProjectId) {
      if (!this.isChildCompatible(newProjectId, off.customerId, off.propertyId)) {
        return { ok: false, error: 'Offerten är inte förenlig med det valda projektet (kund/fastighet stämmer inte).' };
      }
      if (oldProjectId && oldProjectId !== newProjectId && !opts.confirmedMove) {
        return { ok: false, error: 'ALREADY_LINKED', currentProjectId: oldProjectId };
      }
    }
    if (newProjectId === oldProjectId) return { ok: true, offer: off, noop: true };

    off.projectId = newProjectId;
    off.updatedAt = new Date().toISOString();
    persist();
    return { ok: true, offer: off };
  },

  /* ── Läsning: barn-entiteter (§31) — rena, sidoeffektfria ────────── */

  getWorkOrders(projectId) {
    return (state.workOrders || []).filter(a => a.projectId === projectId && !a.deleted);
  },

  getOffers(projectId) {
    return (state.offers || []).filter(o => o.projectId === projectId && !o.deleted);
  },

  getActivities(projectId) {
    return ActivitiesService.getByProject(projectId);
  },

  /* V54B §16 — Projekt-tid har INGEN egen TimeEntry-rad. Härledd
     UTESLUTANDE via projektets AO:er (timeEntry.aoId) — bevarar
     fakturering/attestering/spårbarhet oförändrat. */
  getTimeEntries(projectId) {
    const aoIds = new Set(this.getWorkOrders(projectId).map(a => a.id));
    if (!aoIds.size) return [];
    return (state.timeEntries || []).filter(te => aoIds.has(te.aoId));
  },

  /* ── Offert-revisionssäkerhet (§13) ──────────────────────────────────
     En "revisionskedja" är en följd av offerter länkade via
     parentOfferId (varje revision pekar på sin FÖREGÅNGARE; roten har
     tomt parentOfferId). Kedjans rot-ID är den kanoniska kedje-
     identiteten. Algoritm: gruppera projektets offerter per kedjerot;
     inom varje kedja väljs den EJ ersatta ('ersatt') offerten med
     HÖGST versionNumber — om ALLA i kedjan råkar vara markerade
     'ersatt' (inget aktivt val gjordes efteråt) faller vi tillbaka på
     den högsta versionen ändå, hellre än att tyst utesluta kedjan helt.
     Resultatet innehåller ALDRIG mer än EN offert per kedja — superseded
     revisioner kan alltså aldrig dubbelräknas som separat intäkt. */
  _offerChainRootId(offer) {
    let cur = offer;
    const seen = new Set();
    while (cur && cur.parentOfferId && !seen.has(cur.id)) {
      seen.add(cur.id);
      const parent = getOff(cur.parentOfferId);
      if (!parent) break;
      cur = parent;
    }
    return cur ? cur.id : offer.id;
  },

  resolveCurrentOffers(projectId) {
    const offers = this.getOffers(projectId);
    const chains = {};
    offers.forEach(o => {
      const root = this._offerChainRootId(o);
      (chains[root] || (chains[root] = [])).push(o);
    });
    const current = [];
    Object.values(chains).forEach(list => {
      const nonSuperseded = list.filter(o => o.status !== 'ersatt');
      const pool = nonSuperseded.length ? nonSuperseded : list;
      const pick = pool.slice().sort((a, b) => (b.versionNumber || 1) - (a.versionNumber || 1))[0];
      if (pick) current.push(pick);
    });
    return current;
  },

  /* ── Faktura-härledning (§22) ─────────────────────────────────────
     Ingen invoice.projectId. En fakturas projekt härleds:
       1. invoice.workOrderId -> WorkOrder.projectId
       2. annars invoice.offerId -> Offer.projectId
     Om BÅDA vägarna finns och pekar på OLIKA projekt: en genuin
     relationskonflikt — ytas explicit, gissas ALDRIG och räknas ALDRIG
     tyst in i något projekts totaler. */
  resolveInvoiceProject(inv) {
    let viaAo = null, viaOffer = null;
    if (inv.workOrderId) {
      const ao = getAO(inv.workOrderId);
      if (ao && ao.projectId) viaAo = ao.projectId;
    }
    if (inv.offerId) {
      const off = getOff(inv.offerId);
      if (off && off.projectId) viaOffer = off.projectId;
    }
    if (viaAo && viaOffer && viaAo !== viaOffer) {
      return { projectId: null, conflict: true, viaWorkOrderProjectId: viaAo, viaOfferProjectId: viaOffer };
    }
    return { projectId: viaAo || viaOffer || null, conflict: false };
  },

  /* Endast fakturor som ENTYDIGT härleds till projektet — konflikter
     exkluderas alltid, se getInvoiceConflicts() för att yta dem. */
  getInvoices(projectId) {
    return (state.invoices || []).filter(inv => this.resolveInvoiceProject(inv).projectId === projectId);
  },

  /* Fakturor där minst en av de två vägarna pekar på DETTA projekt,
     men den andra vägen pekar på ett ANNAT — dvs. den delmängd av
     "relationskonflikt"-fall som är relevant att visa just här. */
  getInvoiceConflicts(projectId) {
    return (state.invoices || []).filter(inv => {
      const r = this.resolveInvoiceProject(inv);
      return r.conflict && (r.viaWorkOrderProjectId === projectId || r.viaOfferProjectId === projectId);
    });
  },

  /* "Fakturerat" = faktiskt utfärdat, oavsett betalstatus. utkast/
     makulerad räknas ALDRIG som fakturerat. */
  ISSUED_INVOICE_STATUSES: ['skickad', 'förfallen', 'betald'],
  OUTSTANDING_INVOICE_STATUSES: ['skickad', 'förfallen'],

  /* ── Ekonomi (§20/§21) — endast tillförlitliga, ärligt märkta värden.
     INGEN vinst/marginal — internt lönekostnadsunderlag saknas fortsatt
     (se RAPPORT-V54-PROJEKT-DISCOVERY.md §9 kategori C).

     V54B R1 — blockerare 7: `approvedOfferValue` (exkl. moms, från
     `_offRawExVat()`) jämfördes tidigare direkt mot `invoicedAmount`/
     `outstandingAmount` (`InvoiceService.calcSummary(inv).customerPays`
     — INKL. moms, minus ev. ROT/RUT) som om de vore samma monetära
     bas. Det är de INTE. Fälten är nu döpta efter sin FAKTISKA bas och
     jämförs bara mot varandra när baserna faktiskt matchar:

       approvedOfferExVat            — godkänd offert, exkl. moms
       invoicedExVat                 — fakturerat (skickad/förfallen/
                                        betald), exkl. moms — JÄMFÖRBAR
                                        med approvedOfferExVat
       unpaidCustomerAmount          — kundens obetalda belopp
                                        (skickad/förfallen), inkl. moms
                                        efter ev. ROT/RUT — EGEN bas,
                                        jämförs ALDRIG mot offertvärdet
       remainingAgainstApprovedOfferExVat
                                      — approvedOfferExVat - invoicedExVat,
                                        exkl. moms båda leden. `null` om
                                        inget godkänt offert-underlag
                                        finns alls (ALDRIG ett påhittat
                                        0). Kan bli NEGATIV om fakturerat
                                        överstiger godkänd offert — visas
                                        då som den faktiska (negativa)
                                        siffran, klipps ALDRIG till 0. */
  getCommercialSummary(projectId) {
    const currentOffers = this.resolveCurrentOffers(projectId);
    const approvedOffers = currentOffers.filter(o => o.status === 'godkänd');
    const hasApprovedOffer = approvedOffers.length > 0;
    const approvedOfferExVat = approvedOffers
      .reduce((s, o) => s + (typeof _offRawExVat === 'function' ? _offRawExVat(o) : 0), 0);

    const invoices = this.getInvoices(projectId);
    const issued = invoices.filter(inv => this.ISSUED_INVOICE_STATUSES.includes(inv.status));
    const unpaid = invoices.filter(inv => this.OUTSTANDING_INVOICE_STATUSES.includes(inv.status));
    const invoicedExVat = issued.reduce((s, inv) => s + (typeof InvoiceService !== 'undefined' ? InvoiceService.calcSummary(inv).exVat : 0), 0);
    const unpaidCustomerAmount = unpaid.reduce((s, inv) => s + (typeof InvoiceService !== 'undefined' ? InvoiceService.calcSummary(inv).customerPays : 0), 0);

    const workOrders = this.getWorkOrders(projectId);
    let materialBuy = 0, materialSell = 0;
    workOrders.forEach(ao => (ao.materials || []).forEach(m => {
      const qty = m.qty || 0;
      materialBuy  += qty * (m.buyPrice  || 0);
      materialSell += qty * (m.sellPrice || 0);
    }));

    const timeEntries = this.getTimeEntries(projectId);
    let registeredTimeValue = 0, totalRegisteredHours = 0;
    timeEntries.forEach(te => {
      const hours = (te.minutes || 0) / 60;
      totalRegisteredHours += hours;
      if (te.billable !== false) registeredTimeValue += hours * (te.hourRate || 0);
    });

    /* V54C1 §C6 — "Valda UE-offerter exkl. moms": en EGEN, tydligt
       märkt faktarad — ALDRIG kallad kostnad/vinst/marginal. Delegerar
       till `ProjectDocumentService.getSelectedUeOffersSum()` (samma
       "en sanningskälla"-disciplin som resten av denna funktion redan
       följer) istället för en egen, duplicerad summering här. */
    const selectedUeOffersExVat = typeof ProjectDocumentService !== 'undefined'
      ? ProjectDocumentService.getSelectedUeOffersSum(projectId) : 0;

    return {
      approvedOfferExVat: Math.round(approvedOfferExVat),
      hasApprovedOffer,
      invoicedExVat: Math.round(invoicedExVat),
      unpaidCustomerAmount: Math.round(unpaidCustomerAmount),
      remainingAgainstApprovedOfferExVat: hasApprovedOffer ? Math.round(approvedOfferExVat - invoicedExVat) : null,
      materialBuy: Math.round(materialBuy),
      materialSell: Math.round(materialSell),
      registeredTimeValue: Math.round(registeredTimeValue),
      totalRegisteredHours: Math.round(totalRegisteredHours * 10) / 10,
      selectedUeOffersExVat,
      invoiceConflicts: this.getInvoiceConflicts(projectId)
    };
  },

  /* V54C1 — läs-hjälpare för Dokument-fliken, samma "rena, delegerande
     wrapper"-mönster som getWorkOrders()/getOffers()/getActivities(). */
  getDocuments(projectId) {
    return typeof ProjectDocumentService !== 'undefined' ? ProjectDocumentService.getByProject(projectId) : [];
  },

  /* ── Tid: planerat vs. faktiskt (§17/§18) ──────────────────────────
     V54B R1 — blockerare 8: `range` styrde tidigare ENDAST vilka
     TimeEntry-rader som räknades (`actualHours` m.fl.), medan
     `plannedHours` alltid summerade ALLA projektets AO:er, oavsett
     period. Ett rapportfönster med "Planerat X h / Faktiskt Y h /
     Avvikelse Z h" för en 30-dagarsperiod jämförde alltså en period-
     avgränsad faktisk siffra mot ett odefinierat, hela-projektets-
     livstid planerat värde — en ogiltig jämförelse. När `range` anges
     avgränsas nu ÄVEN planerings-underlaget till de AO:er vars
     `scheduledDate` faller inom perioden (den enda rimliga, robusta
     tolkningen av "planerat i perioden" — se uppdragets §8). Utan
     `range` (Tid-flikens vanliga anrop) är beteendet OFÖRÄNDRAT: hela
     projektets AO:er, ingen regression för den befintliga Tid-fliken. */
  getTimeSummary(projectId, range) {
    const from = range && range.from ? range.from : '';
    const to   = range && range.to   ? range.to   : '';
    const hasRange = !!(from || to);
    const allWorkOrders = this.getWorkOrders(projectId);
    const workOrders = hasRange
      ? allWorkOrders.filter(a => a.scheduledDate && (!from || a.scheduledDate >= from) && (!to || a.scheduledDate <= to))
      : allWorkOrders;
    let timeEntries = this.getTimeEntries(projectId);
    if (from) timeEntries = timeEntries.filter(te => (te.date || '') >= from);
    if (to)   timeEntries = timeEntries.filter(te => (te.date || '') <= to);

    /* Planerat: summa estimatedHours över AO:er som FAKTISKT har ett
       satt värde — §18 kräver att ett saknat värde ALDRIG tyst räknas
       som 0 på ett sätt som antyder att hela projektet är fullständigt
       planerat. Rapporteras därför som "X h på Y av Z AO:er". */
    const aoWithEstimate = workOrders.filter(a => a.estimatedHours != null && a.estimatedHours !== '');
    const plannedHours = aoWithEstimate.reduce((s, a) => s + (parseFloat(a.estimatedHours) || 0), 0);

    let actualHours = 0, billableHours = 0, internalHours = 0, attestedHours = 0, unattestedHours = 0;
    const byStaff = {};
    const byAo = {};
    timeEntries.forEach(te => {
      const hours = (te.minutes || 0) / 60;
      actualHours += hours;
      if (te.billable !== false) billableHours += hours; else internalHours += hours;
      if (te.attested) attestedHours += hours; else unattestedHours += hours;
      const staffKey = te.staffId || te.staffName || '—';
      byStaff[staffKey] = (byStaff[staffKey] || { staffId: te.staffId, staffName: te.staffName, hours: 0 });
      byStaff[staffKey].hours += hours;
      byAo[te.aoId] = (byAo[te.aoId] || { aoId: te.aoId, hours: 0 });
      byAo[te.aoId].hours += hours;
    });

    return {
      isPeriodScoped: hasRange,
      plannedHours: Math.round(plannedHours * 10) / 10,
      aoWithEstimateCount: aoWithEstimate.length,
      aoTotalCount: workOrders.length,
      actualHours: Math.round(actualHours * 10) / 10,
      deviationHours: Math.round((actualHours - plannedHours) * 10) / 10,
      billableHours: Math.round(billableHours * 10) / 10,
      internalHours: Math.round(internalHours * 10) / 10,
      attestedHours: Math.round(attestedHours * 10) / 10,
      unattestedHours: Math.round(unattestedHours * 10) / 10,
      byStaff: Object.values(byStaff).map(x => ({ ...x, hours: Math.round(x.hours * 10) / 10 })).sort((a, b) => b.hours - a.hours),
      byAo: Object.values(byAo).map(x => ({ ...x, hours: Math.round(x.hours * 10) / 10 })).sort((a, b) => b.hours - a.hours),
      entries: timeEntries.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    };
  },

  /* V54B R2 — "Per vecka"-uppdelning (§Time tab). Ren härledd data,
     inget nytt persisterat fält — grupperar redan filtrerade
     TimeEntries per ISO-kalendervecka. Samma ISO-veckoalgoritm som
     CalendarPage._isoWeek() (måndag=veckans start, ISO 8601), men
     implementerad fristående här eftersom ProjectService inte ska bero
     på en sid-fil. Returnerar nyaste vecka först. */
  _isoWeekOf(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    if (isNaN(d.getTime())) return { year: 0, week: 0 };
    const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
    return { year: tmp.getUTCFullYear(), week };
  },

  groupTimeEntriesByWeek(entries) {
    const groups = {};
    (entries || []).forEach(te => {
      if (!te.date) return;
      const { year, week } = this._isoWeekOf(te.date);
      const key = year + '-W' + String(week).padStart(2, '0');
      if (!groups[key]) groups[key] = { key, year, week, hours: 0 };
      groups[key].hours += (te.minutes || 0) / 60;
    });
    return Object.values(groups)
      .map(g => ({ ...g, hours: Math.round(g.hours * 10) / 10 }))
      .sort((a, b) => (b.year - a.year) || (b.week - a.week));
  },

  /* ── Nästa åtgärd (§6) — deterministisk, ingen AI. Prioritetsordning
     exakt enligt uppdraget: 1) förfallen öppen projekt-uppgift,
     2) uppgift som förfaller idag, 3) tidigast kommande öppna uppgift,
     4) försenad/schemalagd AO som kräver åtgärd, 5) annars ingen.
     V54B R1 — blockerare 1A: `opts.includeTasks` (default true) låter
     en anropare UTAN behörighet att se uppgifter (`Auth.canViewPage
     ('pg-activities')` falsk) be om nästa åtgärd utan att uppgifts-
     titlar någonsin ingår i beräkningen — inte bara att UI:t döljer
     resultatet efteråt (då skulle en uppgiftstitel ändå ha passerat
     genom minnet/DOM:en). Detta är EN funktion, inte två separata
     implementationer att hålla synkade. */
  getNextAction(projectId, opts) {
    const includeTasks = !opts || opts.includeTasks !== false;
    const today = tdy();
    const openTasks = includeTasks ? this.getActivities(projectId).filter(a => a.status === 'open') : [];
    const overdueTasks = openTasks.filter(a => a.dueDate && a.dueDate < today)
      .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
    if (overdueTasks.length) return { type: 'task_overdue', text: 'Försenad uppgift: ' + (overdueTasks[0].title || ActivitiesService.typeLabel(overdueTasks[0].type)), activityId: overdueTasks[0].id };

    const todayTasks = openTasks.filter(a => a.dueDate === today);
    if (todayTasks.length) return { type: 'task_today', text: 'Uppgift förfaller idag: ' + (todayTasks[0].title || ActivitiesService.typeLabel(todayTasks[0].type)), activityId: todayTasks[0].id };

    const futureTasks = openTasks.filter(a => a.dueDate && a.dueDate > today)
      .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
    if (futureTasks.length) return { type: 'task_upcoming', text: 'Nästa uppgift: ' + (futureTasks[0].title || ActivitiesService.typeLabel(futureTasks[0].type)) + ' (' + futureTasks[0].dueDate + ')', activityId: futureTasks[0].id };

    const aliveAo = a => !['klar', 'fakturerad', 'avbruten'].includes(a.status);
    const workOrders = this.getWorkOrders(projectId).filter(aliveAo);
    const overdueAo = workOrders.filter(a => a.scheduledDate && a.scheduledDate < today)
      .sort((a, b) => (a.scheduledDate || '').localeCompare(b.scheduledDate || ''));
    if (overdueAo.length) return { type: 'ao_overdue', text: 'Försenad arbetsorder: ' + overdueAo[0].id + (overdueAo[0].title ? ' – ' + overdueAo[0].title : ''), aoId: overdueAo[0].id };

    const scheduledAo = workOrders.filter(a => a.scheduledDate && a.scheduledDate >= today)
      .sort((a, b) => (a.scheduledDate || '').localeCompare(b.scheduledDate || ''));
    if (scheduledAo.length) return { type: 'ao_scheduled', text: 'Nästa arbetsorder: ' + scheduledAo[0].id + ' (' + scheduledAo[0].scheduledDate + ')', aoId: scheduledAo[0].id };

    return { type: 'none', text: 'Ingen planerad nästa åtgärd' };
  },

  /* ── Senaste händelser (§26) — läsande sammanslagning av redan
     befintliga källor, INGEN ny historik-arkitektur. Max 5, nyast
     först. Full enhetlig historik är uttryckligen V54C.
     V54B R1 — blockerare 1: `opts.includeTasks`/`opts.includeFinance`
     (båda default true) låter anroparen utesluta uppgifts- respektive
     faktura-källor helt ur sammanslagningen INNAN den sorteras/klipps
     till 5 — annars kunde en behörighetslös användares enda chans att
     se en känslig händelse "trängas ut" av en behörig händelse och
     ändå aldrig synas, vilket ger falsk trygghet; korrekt är att
     källan aldrig deltar i beräkningen alls. */
  getRecentEvents(projectId, limit, opts) {
    limit = limit || 5;
    const includeTasks   = !opts || opts.includeTasks !== false;
    const includeFinance = !opts || opts.includeFinance !== false;
    const events = [];
    this.getWorkOrders(projectId).forEach(ao => {
      (ao.log || []).forEach(l => events.push({ ts: l.timestamp, text: 'AO ' + ao.id + ': ' + (l.text || ''), source: 'ao', refId: ao.id }));
    });
    this.getOffers(projectId).forEach(off => {
      (typeof state !== 'undefined' && state.offerEvents || []).filter(e => e.offerId === off.id).forEach(e => {
        events.push({ ts: e.ts, text: 'Offert ' + off.id + ': ' + (e.comment || e.type || ''), source: 'offer', refId: off.id });
      });
    });
    if (includeTasks) {
      this.getActivities(projectId).forEach(a => {
        if (a.completedAt) events.push({ ts: a.completedAt, text: 'Uppgift klarmarkerad: ' + (a.title || ActivitiesService.typeLabel(a.type)), source: 'activity', refId: a.id });
      });
    }
    if (includeFinance) {
      this.getInvoices(projectId).forEach(inv => {
        if (inv.sentAt) events.push({ ts: inv.sentAt, text: 'Faktura ' + inv.id + ' skickad', source: 'invoice', refId: inv.id });
        if (inv.paidAt) events.push({ ts: inv.paidAt, text: 'Faktura ' + inv.id + ' betald', source: 'invoice', refId: inv.id });
      });
    }
    /* V54C1 §B6 — dokumenthändelser (uppladdad/borttagen/UE-offert
       vald) läggs till i den redan befintliga sammanslagningen. Texten
       nämner ALDRIG ett belopp — "Senaste händelser" visas oavsett
       finansbehörighet, så en UE-offerts `amountExVat` får aldrig synas
       här (endast namn/leverantör), oavsett `includeFinance`. */
    (typeof ProjectDocumentService !== 'undefined' ? ProjectDocumentService.getByProject(projectId) : []).forEach(d => {
      if (d.uploadedAt) events.push({ ts: d.uploadedAt, text: 'Dokument uppladdat: ' + (d.displayName || d.originalFileName || d.id), source: 'document', refId: d.id });
      if (d.documentType === 'ue_offert' && d.supplierQuoteStatus === 'vald' && d.updatedAt) {
        events.push({ ts: d.updatedAt, text: 'UE-offert markerad Vald: ' + (d.supplierName || d.displayName || d.id), source: 'document', refId: d.id });
      }
    });
    (state.projectDocuments || []).filter(d => d.projectId === projectId && d.active === false && d.deletedAt).forEach(d => {
      events.push({ ts: d.deletedAt, text: 'Dokument borttaget: ' + (d.displayName || d.originalFileName || d.id), source: 'document', refId: d.id });
    });
    return events.filter(e => e.ts).sort((a, b) => (b.ts || '').localeCompare(a.ts || '')).slice(0, limit);
  },

  /* ── Sammanfattad översikt (§5) — deterministiska, faktabaserade
     signaler. INGEN påhittad hälsopoäng/färgskala.
     V54B R1 — blockerare 1: `opts.includeTasks`/`includeTime`/
     `includeFinance` (alla default true) styr INTE bara vilka fält som
     visas i UI:t efteråt — de styr vilka delberäkningar som ens KÖRS.
     En anropare utan behörighet till en kategori får `null` för det
     objektet och kategorins signaler deltar aldrig i `signals`-listan,
     så känslig data (uppgiftstitlar via nextAction/recentEvents,
     tidsvärden, fakturabelopp) aldrig passerar genom minnet på väg mot
     ett DOM som sedan bara skulle CSS-dölja det. */
  getOverview(projectId, opts) {
    const proj = this.getById(projectId);
    if (!proj) return null;
    const includeTasks   = !opts || opts.includeTasks   !== false;
    const includeTime    = !opts || opts.includeTime    !== false;
    const includeFinance = !opts || opts.includeFinance !== false;

    const today = tdy();
    const workOrders = this.getWorkOrders(projectId);
    const aliveAo = a => !['klar', 'fakturerad', 'avbruten'].includes(a.status);
    const openAo = workOrders.filter(aliveAo);
    const overdueAo = openAo.filter(a => a.scheduledDate && a.scheduledDate < today);
    const completedAo = workOrders.filter(a => ['klar', 'fakturerad'].includes(a.status));
    const unbilledCompletedAo = workOrders.filter(a => a.status === 'klar' && !a.invoiceId);

    const tasks = includeTasks ? this.getActivities(projectId) : [];
    const openTasks = tasks.filter(a => a.status === 'open');
    const overdueTasks = openTasks.filter(a => a.dueDate && a.dueDate < today);

    const timeSummary = includeTime ? this.getTimeSummary(projectId) : null;
    const commercial = includeFinance ? this.getCommercialSummary(projectId) : null;

    /* §5 — faktabaserade signaler, aldrig ett godtyckligt score. */
    const signals = [];
    if (overdueAo.length) signals.push(overdueAo.length + ' försenad' + (overdueAo.length === 1 ? '' : 'e') + ' arbetsorder');
    if (includeTasks && overdueTasks.length) signals.push(overdueTasks.length + ' förfallen' + (overdueTasks.length === 1 ? '' : 'a') + ' uppgift' + (overdueTasks.length === 1 ? '' : 'er'));
    if (includeTime && timeSummary.deviationHours > 0) signals.push(timeSummary.deviationHours + ' h över plan');
    if (includeFinance && unbilledCompletedAo.length) signals.push(unbilledCompletedAo.length + ' klar men ej fakturerad arbetsorder');
    if (includeFinance && commercial.invoiceConflicts.length) signals.push(commercial.invoiceConflicts.length + ' fakturarelation i konflikt');

    return {
      project: proj,
      workOrders: { total: workOrders.length, open: openAo.length, overdue: overdueAo.length, completed: completedAo.length, unbilledCompleted: unbilledCompletedAo.length },
      tasks: includeTasks ? { total: tasks.length, open: openTasks.length, overdue: overdueTasks.length } : null,
      time: timeSummary,
      commercial,
      nextAction: this.getNextAction(projectId, { includeTasks }),
      recentEvents: this.getRecentEvents(projectId, 5, { includeTasks, includeFinance }),
      signals
    };
  }
};
