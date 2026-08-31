/**
 * GlobalSearchService — V50A Global Search MVP
 *
 * Bygger ett lättviktigt, in-memory sökindex från redan laddad `state` och
 * rankar träffar. Läser bara. Muterar aldrig state, skriver aldrig till
 * Storage/DataSync, triggar aldrig persist.
 */

const GlobalSearchService = {

  MAX_PER_GROUP: 6,
  MAX_TOTAL: 20,

  TYPE_LABELS: {
    customer: 'Kunder',
    workOrder: 'Arbetsorder',
    offer: 'Offerter',
    property: 'Fastigheter',
    sales: 'Säljchanser',
    contract: 'Kontrakt',
    invoice: 'Fakturor'
  },

  TYPE_ORDER: ['customer', 'workOrder', 'offer', 'property', 'sales', 'contract', 'invoice'],

  /* Behörighet krävs per typ — matchar Router/PAGE_PERMISSIONS för
     motsvarande listsida, så sökresultat aldrig visar mer än användaren
     redan får se via vanlig navigering (ingen access-eskalering). */
  TYPE_PERMISSIONS: {
    customer: ['customer_manage'],
    workOrder: ['ao_view_all', 'ao_view_own'],
    offer: ['offer_manage'],
    property: ['customer_manage'],
    sales: ['sales_manage'],
    contract: ['customer_manage'],
    invoice: ['invoice_view', 'invoice_create']
  },

  /* ── Normalisering ────────────────────────────────────── */

  _digits(s) {
    return String(s || '').replace(/\D/g, '');
  },

  normalizeQuery(raw) {
    const trimmed = String(raw || '').trim().replace(/\s+/g, ' ');
    return {
      raw: trimmed,
      lower: trimmed.toLowerCase(),
      digits: this._digits(trimmed)
    };
  },

  /* ── Indexbygge ───────────────────────────────────────── */

  buildIndex() {
    const items = [];
    if (typeof Auth === 'undefined' || !Auth.isLoggedIn || !Auth.isLoggedIn()) return items;
    if (Auth.canAny(this.TYPE_PERMISSIONS.customer)) items.push(...this._indexCustomers());
    if (Auth.canAny(this.TYPE_PERMISSIONS.workOrder)) items.push(...this._indexWorkOrders());
    if (Auth.canAny(this.TYPE_PERMISSIONS.offer)) items.push(...this._indexOffers());
    if (Auth.canAny(this.TYPE_PERMISSIONS.property)) items.push(...this._indexProperties());
    if (Auth.canAny(this.TYPE_PERMISSIONS.sales)) items.push(...this._indexSales());
    if (Auth.canAny(this.TYPE_PERMISSIONS.contract)) items.push(...this._indexContracts());
    if (Auth.canAny(this.TYPE_PERMISSIONS.invoice)) items.push(...this._indexInvoices());
    return items;
  },

  _indexCustomers() {
    return (state.customers || []).map(c => {
      const title = c.name || [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || 'Namnlös kund';
      const subtitleParts = [c.orgNr || c.personnr, c.city].filter(Boolean);
      const contactTexts = (c.contacts || []).flatMap(ct => [ct.name, ct.phone, ct.email, ct.role]);
      /* R2 §4: den FAKTISKA fältet produktionen använder är `customer.inactive`
         (togglad i CustomersPage.js toggleInactive/_bulkSetInactive) — INTE
         `customer.active` från Schema.customer()-fabriken, vilket är dött/
         oanvänt fält. Samma "Inaktiv"-etikett/badge-konvention som
         CustomersPage.js redan använder (bdg bdg-grey + "Inaktiv"). */
      const isInactive = !!c.inactive;
      return {
        type: 'customer',
        id: c.id,
        title,
        subtitle: subtitleParts.join(' · '),
        meta: c.type || '',
        isInactive,
        inactiveLabel: isInactive ? 'Inaktiv' : null,
        idText: c.id,
        titleText: title,
        secondaryTexts: [c.orgNr, c.personnr, c.phone, c.email, c.address, c.zip, c.city, c.contactPerson, c.invoiceAddress, c.invoiceCity].concat(contactTexts).filter(Boolean),
        digitsFields: [c.orgNr, c.personnr, c.phone].concat((c.contacts || []).map(ct => ct.phone)).filter(Boolean),
        nav: { pageId: 'pg-crm-detail', params: { customerId: c.id } }
      };
    });
  },

  _indexWorkOrders() {
    return (state.workOrders || []).map(a => {
      const customerName = a.customerName || (getCu(a.customerId) || {}).name || '';
      const title = a.title || (a.description ? String(a.description).slice(0, 60) : a.id);
      /* R2.5 §13 — visa/indexera AO:ns FULLSTÄNDIGA strukturerade adress
         (via den delade AddressService.displayAddress()), inte bara den
         bara gatan — konsekvent med Dashboard/AO-detalj/MyJobs/Drift.
         zip/city läggs även till i secondaryTexts så att sökning på
         "412 54" eller "Göteborg" hittar AO:t här precis som i
         WorkOrdersPage._filteredList()s haystack (R2 §5). */
      const fullAddr = (typeof AddressService !== 'undefined') ? AddressService.displayAddress(a) : (a.address || '');
      const subtitleParts = [customerName, fullAddr].filter(Boolean);
      const staffNames = (a.staff || []).map(sid => (getStaff(sid) || {}).firstName).filter(Boolean);
      return {
        type: 'workOrder',
        id: a.id,
        title,
        subtitle: subtitleParts.join(' · '),
        meta: a.status ? cap(a.status) : '',
        /* R2 §5: arbetsorder har INGET inaktiv-koncept — bara arbetsflödes-
           status (nytt/pool/planerad/pågående/klar/fakturerad/avbruten).
           "Klar"/"Fakturerad" är INTE detsamma som inaktiv — visas redan
           korrekt via `meta` ovan, blandas aldrig ihop med Inaktiv-badgen. */
        isInactive: false,
        inactiveLabel: null,
        idText: a.id,
        titleText: title,
        /* R2.6 §13 (oberoende reproducerad blockerare) — TIDIGARE indexerades
           bara AO:ns EGNA a.address/zip/city, som är TOMMA för en legacy-AO
           vars adress bara visas via länkad fastighets-/kundfallback
           (fullAddr ovan) — sökning på t.ex. "Göteborg" hittade då inte
           AO:n trots att adressen VISADES i undertiteln. Lägg till det
           REDAN RESOLVERADE fullAddr i sökbar text (utöver de egna rå-
           fälten, som fortfarande är rätt att söka på när de faktiskt finns). */
        secondaryTexts: [customerName, a.address, a.zip, a.city, fullAddr, a.description, a.contactPerson, a.phone, a.contactEmail, a.category].concat(staffNames).filter(Boolean),
        digitsFields: [a.phone].filter(Boolean),
        nav: { pageId: 'pg-ao-detail', params: { aoId: a.id } }
      };
    });
  },

  _indexOffers() {
    return (state.offers || []).filter(o => !o.deleted).map(o => {
      const customer = getCu(o.customerId);
      const customerName = (customer || {}).name || '';
      const title = o.title || customerName || o.address || o.id;
      const subtitleParts = [customerName, o.status ? cap(o.status) : ''].filter(Boolean);
      return {
        type: 'offer',
        id: o.id,
        title,
        subtitle: subtitleParts.join(' · '),
        meta: o.status ? cap(o.status) : '',
        /* R2 §5: offert har INGET enkelt aktiv/inaktiv-begrepp — `archived`/
           `deleted` är egna, distinkta koncept (arkivering/papperskorg), inte
           en "inaktiv post"-etikett. En nekad/utgången/godkänd offert är
           INTE "inaktiv" bara för att den inte längre är öppen — spec §5
           förbjuder explicit den tolkningen. `deleted` filtreras redan bort
           ovan (rad 111); `archived` visas via befintlig `meta`/status. */
        isInactive: false,
        inactiveLabel: null,
        idText: o.id,
        titleText: title,
        secondaryTexts: [customerName, o.address, o.status].filter(Boolean),
        digitsFields: [],
        nav: { pageId: 'pg-offer-detail', params: { offerId: o.id } }
      };
    });
  },

  _indexProperties() {
    return (state.properties || []).map(p => {
      const owner = getCu(p.customerId);
      const title = p.name || p.address || p.id;
      const subtitleParts = [p.address, p.city].filter(Boolean);
      const contactTexts = (p.contacts || []).flatMap(ct => [ct.name, ct.phone, ct.email]);
      /* R2 §4/§5: fastighet har ett äkta aktiv/inaktiv-koncept via
         `status === 'inaktiv'` (samma fält/värde som PropertiesPage redan
         filtrerar "aktiva"/"arkiverade" på i PageShells.js). */
      const isInactive = p.status === 'inaktiv';
      return {
        type: 'property',
        id: p.id,
        title,
        subtitle: subtitleParts.join(' · '),
        meta: p.type || '',
        isInactive,
        inactiveLabel: isInactive ? 'Inaktiv' : null,
        idText: p.objectNumber || p.id,
        titleText: title,
        secondaryTexts: [p.address, p.zip, p.city, p.propertyDesignation, (owner || {}).name].concat(contactTexts).filter(Boolean),
        digitsFields: (p.contacts || []).map(ct => ct.phone).filter(Boolean),
        nav: { pageId: 'pg-obj-detail', params: { propId: p.id } }
      };
    });
  },

  /* Säljchanser saknar egen route (bekräftat i Router.js — endast
     '/saljchanser' finns, ingen '/saljchanser/:id'). Öppnas därför via
     listsidan + befintlig SalesPage.openEdit(id), exakt samma mekanism
     som när användaren klickar en rad i listan idag. */
  _indexSales() {
    return (state.salesOpportunities || []).map(s => {
      const customer = getCu(s.customerId);
      const customerName = (customer || {}).name || '';
      const title = s.title || customerName || 'Säljchans';
      const subtitleParts = [customerName, s.status ? cap(s.status) : ''].filter(Boolean);
      return {
        type: 'sales',
        id: s.id,
        title,
        subtitle: subtitleParts.join(' · '),
        meta: s.priority || '',
        /* R2 §5: säljchans har INGET inaktiv-koncept — bara arbetsflödes-
           status. won/lost/done/dismissed grupperas redan under fliken
           "Avslutade" i SalesPage.js — INTE "Inaktiva". Uppfinner ingen
           ny etikett här. */
        isInactive: false,
        inactiveLabel: null,
        idText: s.id,
        titleText: title,
        secondaryTexts: [customerName, s.reason, s.suggestedAction, s.status].filter(Boolean),
        digitsFields: [],
        nav: { pageId: 'pg-sales', params: {}, openAfter: { module: 'SalesPage', method: 'openEdit', args: [s.id] } }
      };
    });
  },

  /* Kontrakt saknar egen route (bekräftat — endast '/kontrakt' finns).
     Öppnas via listsidan + befintlig ContractsPage._openDetail(id). */
  _indexContracts() {
    return (state.contracts || []).map(c => {
      const customer = getCu(c.customerId);
      const property = getObj(c.propertyId);
      const customerName = (customer || {}).name || '';
      const title = c.title || customerName || 'Kontrakt';
      const subtitleParts = [customerName, c.status ? cap(c.status) : ''].filter(Boolean);
      /* R2 §5: kontrakt har ett äkta 3-läges status-koncept (aktiv/pausad/
         avslutad/utkast — se ContractsPage.js TABS: 'Aktiv'/'Pausad'/
         'Avslutad'). Etiketten är ALDRIG "Inaktiv" i produktion — återanvänd
         exakt "Pausad"/"Avslutad" istället för att uppfinna en ny text. */
      const isInactive = c.status === 'pausad' || c.status === 'avslutad';
      const inactiveLabel = c.status === 'pausad' ? 'Pausad' : (c.status === 'avslutad' ? 'Avslutad' : null);
      return {
        type: 'contract',
        id: c.id,
        title,
        subtitle: subtitleParts.join(' · '),
        meta: c.type || '',
        isInactive,
        inactiveLabel,
        idText: c.id,
        titleText: title,
        secondaryTexts: [customerName, (property || {}).address, c.description, c.status].filter(Boolean),
        digitsFields: [],
        nav: { pageId: 'pg-contracts', params: {}, openAfter: { module: 'ContractsPage', method: '_openDetail', args: [c.id] } }
      };
    });
  },

  _indexInvoices() {
    return (state.invoices || []).map(i => {
      const customer = getCu(i.customerId);
      const customerName = (customer || {}).name || '';
      const title = i.title || customerName || i.id;
      const subtitleParts = [customerName, i.status ? cap(i.status) : ''].filter(Boolean);
      return {
        type: 'invoice',
        id: i.id,
        title,
        subtitle: subtitleParts.join(' · '),
        meta: i.status ? cap(i.status) : '',
        /* R2 §5: fakturaunderlag har INGET inaktiv-koncept — bara
           arbetsflödesstatus (utkast/skickad/betald/förfallen/makulerad). */
        isInactive: false,
        inactiveLabel: null,
        idText: i.id,
        titleText: title,
        secondaryTexts: [customerName, i.customerReference, i.ocr, i.status].filter(Boolean),
        digitsFields: [i.ocr].filter(Boolean),
        nav: { pageId: 'pg-inv-detail', params: { invoiceId: i.id } }
      };
    });
  },

  /* ── Matchning / ranking ──────────────────────────────── */

  /* Deterministisk 6-nivåers ranking (högst vinner), enligt spec §13:
     6 = exakt ID/nummer   5 = exakt titel/namn   4 = börjar-med
     3 = ord börjar-med    2 = delsträng          1 = sekundär metadata */
  _score(item, q) {
    if (!q.lower && !(q.digits && q.digits.length >= 3)) return 0;

    const idLower = String(item.idText || '').toLowerCase();
    const titleLower = String(item.titleText || '').toLowerCase();
    let tier = 0;

    if (q.lower && idLower === q.lower) tier = Math.max(tier, 6);
    if (q.digits && q.digits.length >= 3) {
      for (const f of item.digitsFields || []) {
        if (this._digits(f) === q.digits) { tier = Math.max(tier, 6); break; }
      }
    }
    if (tier >= 6) return tier;

    if (q.lower && titleLower === q.lower) tier = Math.max(tier, 5);
    if (tier >= 5) return tier;

    if (q.lower && (idLower.startsWith(q.lower) || titleLower.startsWith(q.lower))) tier = Math.max(tier, 4);
    if (q.digits && q.digits.length >= 3) {
      for (const f of item.digitsFields || []) {
        const fd = this._digits(f);
        if (fd && fd.startsWith(q.digits)) { tier = Math.max(tier, 4); break; }
      }
    }
    if (tier >= 4) return tier;

    if (q.lower) {
      const wordHit = (idLower + ' ' + titleLower).split(/\s+/).some(w => w && w.startsWith(q.lower));
      if (wordHit) tier = Math.max(tier, 3);
    }
    if (tier >= 3) return tier;

    if (q.lower && (idLower.includes(q.lower) || titleLower.includes(q.lower))) tier = Math.max(tier, 2);
    if (tier >= 2) return tier;

    if (q.lower) {
      for (const s of item.secondaryTexts || []) {
        if (s && String(s).toLowerCase().includes(q.lower)) { tier = 1; break; }
      }
    }
    if (tier === 0 && q.digits && q.digits.length >= 3) {
      for (const f of item.digitsFields || []) {
        if (this._digits(f).includes(q.digits)) { tier = 1; break; }
      }
    }
    return tier;
  },

  /* Rankar ett redan byggt index mot en fråga. Ren funktion — ingen
     mutation, ingen state-läsning utöver det redan skickade indexet. */
  rank(index, rawQuery) {
    const q = this.normalizeQuery(rawQuery);
    if (!q.lower && !(q.digits && q.digits.length >= 3)) {
      return { groups: [], total: 0, query: q.raw };
    }

    const scored = [];
    for (const item of index) {
      const tier = this._score(item, q);
      if (tier > 0) scored.push({ item, tier });
    }
    /* R2 §7: aktiv/inaktiv är ENDAST en tie-break inom samma tier — exakt
       ID/namn-matchning (tier 6/5) väger fortfarande tyngre än detta, så en
       inaktiv post kan fortfarande hamna överst när det uppenbart är precis
       den posten användaren sökte efter. Ingen ny rankingnivå infördes. */
    scored.sort((a, b) => b.tier - a.tier || (a.item.isInactive === b.item.isInactive ? 0 : (a.item.isInactive ? 1 : -1)) || a.item.titleText.localeCompare(b.item.titleText, 'sv'));

    const byType = {};
    this.TYPE_ORDER.forEach(t => { byType[t] = []; });
    scored.forEach(({ item }) => {
      const bucket = byType[item.type];
      if (bucket && bucket.length < this.MAX_PER_GROUP) bucket.push(item);
    });

    let total = 0;
    const groups = [];
    for (const t of this.TYPE_ORDER) {
      const items = byType[t];
      if (!items.length) continue;
      const remaining = this.MAX_TOTAL - total;
      if (remaining <= 0) break;
      const slice = items.slice(0, remaining);
      groups.push({ type: t, label: this.TYPE_LABELS[t], items: slice });
      total += slice.length;
    }

    return { groups, total, query: q.raw };
  },

  /* Bekvämlighet: bygg + ranka i ett steg (används inte i normal UI-flow,
     där index byggs en gång vid öppning — men praktisk för tester). */
  search(rawQuery) {
    return this.rank(this.buildIndex(), rawQuery);
  }
};
