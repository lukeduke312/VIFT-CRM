/**
 * CustomerService — CRUD för kunder
 *
 * V49A1: canonical customer.type-modell. De fyra giltiga interna värdena
 * är, och har alltid varit, `privat | foretag | brf | fastighetsagare`
 * (se Schema.customer(), src/data/schema.js). Problemet som V49A1 löser är
 * inte att kanonisk-modellen saknades — den fanns redan — utan att INGET
 * steg tidigare normaliserade kända synonymer/skrivvarianter (t.ex.
 * `company`, `Foretag`, `private`) till dessa fyra värden innan de
 * skrevs, vilket lät sådana varianter läcka rått genom
 * CustomerService.typeLabel()s fallback (`|| t`) till UI:t, och genom
 * CustomersPage._formHtml()s dropdown (ingen <option> matchar → webbläsaren
 * visar tyst det FÖRSTA alternativet, "Företag", oavsett verkligt värde).
 *
 * CUSTOMER_TYPE_SYNONYMS/normalizeType() nedan är den ENDA source-of-truth
 * för denna normalisering — återanvänds oförändrad av
 * src/services/ImportExportConfigs.js (laddas EFTER denna fil i
 * index.html, så anropet är säkert). Se RAPPORT-V49A1.md.
 */
const CUSTOMER_TYPE_SYNONYMS = {
  // → foretag
  foretag: 'foretag', 'företag': 'foretag', company: 'foretag', business: 'foretag',
  bolag: 'foretag', firma: 'foretag',
  // → privat
  privat: 'privat', privatperson: 'privat', private: 'privat', person: 'privat',
  individual: 'privat',
  // → brf
  brf: 'brf', 'bostadsrättsförening': 'brf', bostadsrattsforening: 'brf',
  // → fastighetsagare
  fastighetsagare: 'fastighetsagare', 'fastighetsägare': 'fastighetsagare',
  fastighetsbolag: 'fastighetsagare', 'property owner': 'fastighetsagare',
  propertyowner: 'fastighetsagare'
};

const CustomerService = {

  /**
   * Normaliserar ett kundtyp-råvärde till exakt ett av de fyra kanoniska
   * värdena (privat|foretag|brf|fastighetsagare), case-/whitespace-okänsligt.
   *
   * Returkontrakt (medvetet tre distinkta lägen, se RAPPORT-V49A1.md §2):
   *   ''      — raw var null/undefined/tomt (inget värde att normalisera;
   *             callern avgör själv om ett schema-default ska tillämpas)
   *   'privat'|'foretag'|'brf'|'fastighetsagare' — känd variant, kanoniserad
   *   null    — raw var ett icke-tomt värde som INTE kändes igen. Gissar
   *             ALDRIG ett värde för okänd indata — det skulle kunna
   *             felklassificera kunddata (t.ex. en privatperson som Företag).
   */
  normalizeType(raw) {
    if (raw === null || raw === undefined) return '';
    const s = String(raw).trim();
    if (!s) return '';
    const key = s.toLowerCase();
    return Object.prototype.hasOwnProperty.call(CUSTOMER_TYPE_SYNONYMS, key)
      ? CUSTOMER_TYPE_SYNONYMS[key]
      : null;
  },

  /* Normaliserar ev. `type`-fält i en write-payload innan create()/update().
     Returnerar en NY kopia av data (rör aldrig callerns objekt), eller
     `null` för att signalera "vägra skriva" (explicit, icke-tomt, okänt
     värde) — samma mönster som update()s befintliga `return null`
     (hittades ej). Om `type` saknas i data helt: rörs inte alls (bevarar
     befintligt beteende — create() får då schema-defaulten `foretag` via
     Object.assign(Schema.customer(), …), update() lämnar cu.type orört). */
  _normalizeTypeForWrite(data) {
    if (!data || !('type' in data)) return data;
    const norm = this.normalizeType(data.type);
    if (norm === null) return null;
    const out = Object.assign({}, data);
    if (norm) out.type = norm;
    else delete out.type; // tomt värde -> låt default/oförändrat gälla, se ovan
    return out;
  },

  create(data) {
    const safeData = this._normalizeTypeForWrite(data);
    if (safeData === null) return null;
    const cu = Object.assign(Schema.customer(), safeData, {
      id:        newId(state.customers, 'K'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    state.customers.push(cu);
    ActivityService.log('customer_created', `Ny kund skapad: ${this.displayName(cu)}`,
      { customerId: cu.id });
    persist();
    return cu;
  },

  update(id, data) {
    const cu = getCu(id);
    if (!cu) return null;
    const safeData = this._normalizeTypeForWrite(data);
    if (safeData === null) return null;
    Object.assign(cu, safeData, { updatedAt: new Date().toISOString() });
    ActivityService.log('customer_updated', `Kund redigerad: ${this.displayName(cu)}`,
      { customerId: cu.id });
    persist();
    return cu;
  },

  delete(id) {
    const cu = getCu(id);
    if (!cu) return;
    const name = this.displayName(cu);
    state.customers = state.customers.filter(c => c.id !== id);
    ActivityService.log('customer_deleted', `Kund borttagen: ${name}`, {});
    persist();
  },

  displayName(cu) {
    if (!cu) return '—';
    /* V49A1: normaliserad jämförelse — en legacy-kund med t.ex. type='private'
       eller type='Company' ska namnge sig exakt som 'privat'/'foretag' gör
       idag, inte hamna i fel gren pga en råsträng som råkar != 'privat'. */
    return this.normalizeType(cu.type) === 'privat'
      ? `${cu.firstName || ''} ${cu.lastName || ''}`.trim() || cu.name || '—'
      : cu.name || `${cu.firstName || ''} ${cu.lastName || ''}`.trim() || '—';
  },

  /* V49A1: normaliserar råvärdet innan uppslag, så kända legacy-/import-
     varianter (company, Foretag, private, …) visas med rätt svensk label
     UTAN att någon datamigration krävs — se RAPPORT-V49A1.md §2/§5.
     Ett genuint okänt, icke-tomt värde visas begripligt med sitt råvärde
     synligt (inte bara "—" och inte rått utan kontext), aldrig en krasch. */
  typeLabel(raw) {
    const LABELS = { privat: 'Privatperson', foretag: 'Företag', brf: 'BRF', fastighetsagare: 'Fastighetsägare' };
    const norm = this.normalizeType(raw);
    if (norm) return LABELS[norm];
    const s = (raw === null || raw === undefined) ? '' : String(raw).trim();
    return s ? `Okänd kundtyp (${s})` : '—';
  },

  search(q) {
    const ql = (q || '').toLowerCase();
    return (state.customers || []).filter(cu => {
      const name = this.displayName(cu).toLowerCase();
      return name.includes(ql)
        || (cu.orgNr || '').includes(ql)
        || (cu.phone || '').includes(ql)
        || (cu.email || '').toLowerCase().includes(ql)
        || (cu.city || '').toLowerCase().includes(ql);
    });
  },

  /* KPI-räkning */
  getActiveAOs(customerId) {
    return (state.workOrders || []).filter(a =>
      a.customerId === customerId && !['klar','fakturerad','avbruten'].includes(a.status)
    );
  },

  getOffers(customerId) {
    return (state.offers || []).filter(o => o.customerId === customerId);
  }
};
