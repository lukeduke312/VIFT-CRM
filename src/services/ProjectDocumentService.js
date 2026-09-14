/**
 * ProjectDocumentService — V54C1 R1 Projekt-dokument (Production Hardening)
 *
 * Generaliserad direkt från det redan granskade OfferAttachment-mönstret
 * (`PageShells.js`s `_uploadFiles/_viewAttachment/_downloadAttachment`
 * mot `offer-attachment-upload`/`offer-attachment-url`) — ingen fjärde,
 * fristående filhanteringsmodell. Metadata lagras i `state.
 * projectDocuments` (generiska `store`-nyckeln `vift_projectDocuments`,
 * samma mönster som `vift_offerAttachments`/`vift_projects` redan
 * använder) — ingen ny SQL-tabell för själva metadatan. Själva
 * filinnehållet ligger ALDRIG i denna array eller i Projekt-JSON — bara
 * metadata + `storagePath` (aldrig exponerad direkt i UI, endast via en
 * tidsbegränsad signerad URL från `project-document-url`-Edge-
 * Function:en, se backend/).
 *
 * R1 — KANONISK API-KONTRAKT (§Blockerare 1/6, ersätter R0):
 *   Varje mutation/läsning som rör ETT specifikt dokument tar nu ett
 *   EXPLICIT `expectedProjectId`-argument — den sida/kontext (t.ex.
 *   `ProjectDetailPage._projectId`) som ANROPAREN just nu befinner sig
 *   i, ALDRIG härlett från dokumentet som ska hämtas/ändras. R0:s bugg
 *   var att `getSignedUrl(documentId, mode)` skickade `doc.projectId`
 *   till servern — dvs dokumentets EGEN projectId, vilket alltid
 *   "matchar sig själv" och därför INTE skyddar mot ett manipulerat
 *   documentId som pekar på ett dokument i ett HELT ANNAT projekt. Nu:
 *     1. klienten kräver `doc.projectId === expectedProjectId` INNAN
 *        något nätverksanrop görs (snabb, tidig avvisning)
 *     2. `expectedProjectId` (kontextens ID, inte dokumentets eget)
 *        skickas till backend som `projectId` i request-bodyn
 *     3. backend validerar OBEROENDE mot dokumentets FAKTISKT lagrade
 *        `projectId` (se backend/ — oförändrad logik, nu äntligen med
 *        rätt indata från klienten)
 *   `updateMetadata`/`setUeStatus` gick tidigare via lokal mutation +
 *   generisk `persist()` (§Blockerare 6 — kringgick all backend-
 *   behörighetskontroll). De går nu via samma autentiserade
 *   `project-document-upload`-Edge-Function (PATCH) som uppladdning och
 *   borttagning, och uppdaterar lokal cache ENDAST efter bekräftad
 *   server-framgång.
 *
 * Kanoniska service-kontraktet `{ok, error}` — samma som ProjectService/
 * InvoiceService redan etablerat.
 */
const ProjectDocumentService = {

  DOCUMENT_TYPES: [
    { key: 'ue_offert',          label: 'UE / leverantörsoffert' },
    { key: 'orderbekraftelse',   label: 'Orderbekräftelse' },
    { key: 'avtal',              label: 'Avtal' },
    { key: 'leverantorsfaktura', label: 'Leverantörsfaktura' },
    { key: 'ritning',            label: 'Ritning' },
    { key: 'protokoll',          label: 'Protokoll' },
    { key: 'foto',               label: 'Foto' },
    { key: 'ovrigt',             label: 'Övrigt' }
  ],

  /* §C4 — statusar ENDAST meningsfulla för documentType='ue_offert'. */
  UE_STATUSES: [
    { key: 'inkommen', label: 'Inkommen' },
    { key: 'vald',      label: 'Vald' },
    { key: 'ej_vald',  label: 'Ej vald' }
  ],

  typeLabel(key) {
    const m = this.DOCUMENT_TYPES.find(t => t.key === key);
    return m ? m.label : (key || '');
  },

  ueStatusLabel(key) {
    const m = this.UE_STATUSES.find(s => s.key === key);
    return m ? m.label : (key || '');
  },

  _edgeBase() {
    return (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '').replace(/\/$/, '');
  },

  _authHeaders(extra) {
    return Object.assign({
      'apikey': (typeof SUPABASE_AKEY !== 'undefined' ? SUPABASE_AKEY : ''),
      'Authorization': 'Bearer ' + (typeof Auth !== 'undefined' ? (Auth.getAccessToken() || '') : '')
    }, extra || {});
  },

  /* ── Läsning (lokal cache — uppdaterad av DataSync-polling och av
     denna services egna mutationer efter bekräftad server-framgång) ─ */

  getAll() {
    return (state.projectDocuments || []).filter(d => d.active !== false);
  },

  getByProject(projectId) {
    return this.getAll().filter(d => d.projectId === projectId)
      .sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
  },

  getById(id) {
    return (state.projectDocuments || []).find(d => d.id === id) || null;
  },

  /* §C6 — "Valda UE-offerter exkl. moms": SUM amountExVat för dokument
     med documentType='ue_offert' OCH supplierQuoteStatus='vald' OCH ett
     giltigt numeriskt belopp. Ett icke-valt eller icke-numeriskt belopp
     räknas ALDRIG in — ingen tyst 0-behandling som antyder en fullständig
     summa, dokumentet utesluts helt istället. */
  getSelectedUeOffersSum(projectId) {
    const docs = this.getByProject(projectId).filter(d =>
      d.documentType === 'ue_offert' &&
      d.supplierQuoteStatus === 'vald' &&
      typeof d.amountExVat === 'number' && Number.isFinite(d.amountExVat)
    );
    return Math.round(docs.reduce((s, d) => s + d.amountExVat, 0));
  },

  /* ── Validering — kanonisk sanningskälla, körs oavsett UI ────────
     §C7: en icke-tom `workOrderId` MÅSTE höra till SAMMA projekt — en
     PRJ1-dokument får aldrig referera en PRJ2-AO. */
  _validate(data, projectId) {
    data = data || {};
    const documentType = data.documentType || 'ovrigt';
    if (!this.DOCUMENT_TYPES.some(t => t.key === documentType)) {
      return { ok: false, error: 'Ogiltig dokumenttyp' };
    }
    if (data.workOrderId) {
      const ao = typeof getAO === 'function' ? getAO(data.workOrderId) : null;
      if (!ao) return { ok: false, error: 'Vald arbetsorder finns inte' };
      if (ao.projectId !== projectId) {
        return { ok: false, error: 'Arbetsordern tillhör inte detta projekt' };
      }
    }
    if (documentType === 'ue_offert') {
      if (!data.supplierName || !String(data.supplierName).trim()) {
        return { ok: false, error: 'Leverantör / UE krävs för UE-offerter' };
      }
      if (data.amountExVat !== null && data.amountExVat !== undefined && data.amountExVat !== '' &&
          !Number.isFinite(parseFloat(data.amountExVat))) {
        return { ok: false, error: 'Belopp exkl. moms måste vara ett tal' };
      }
      if (data.supplierQuoteStatus && !this.UE_STATUSES.some(s => s.key === data.supplierQuoteStatus)) {
        return { ok: false, error: 'Ogiltig offertstatus' };
      }
    }
    return { ok: true };
  },

  /* Uppdaterar ENDAST den lokala cachen (minne + localStorage) efter en
     BEKRÄFTAD server-mutation — MEDVETET aldrig via generisk persist()
     (§Blockerare 4, se state.js/_doPersist()). */
  _syncLocalCache() {
    if (typeof Storage !== 'undefined' && typeof Storage.setLocal === 'function') {
      Storage.setLocal('projectDocuments', state.projectDocuments);
    }
  },

  /* ── Uppladdning — Edge Function project-document-upload (POST) ──
     Ingen half-skapad post: metadata skrivs på servern ENDAST efter
     bekräftad lyckad lagring, och om metadataskrivningen ändå
     misslyckas där gör servern en kompenserande borttagning av den
     redan uppladdade filen innan den svarar med fel (§Blockerare 3, se
     backend/). Klienten lägger ALDRIG till en lokal post förrän
     servern bekräftat framgång. */
  async upload(file, meta) {
    meta = meta || {};
    const projectId = meta.projectId;
    if (!projectId) return { ok: false, error: 'Projekt saknas' };
    const validated = this._validate(meta, projectId);
    if (!validated.ok) return validated;
    if (!file) return { ok: false, error: 'Ingen fil vald' };

    const fd = new FormData();
    fd.append('file', file);
    fd.append('projectId', projectId);
    fd.append('documentType', meta.documentType || 'ovrigt');
    fd.append('displayName', meta.displayName || '');
    fd.append('supplierName', meta.supplierName || '');
    fd.append('amountExVat', meta.amountExVat != null && meta.amountExVat !== '' ? String(meta.amountExVat) : '');
    fd.append('documentDate', meta.documentDate || '');
    fd.append('validUntil', meta.validUntil || '');
    fd.append('supplierQuoteStatus', meta.supplierQuoteStatus || '');
    fd.append('workOrderId', meta.workOrderId || '');
    fd.append('note', meta.note || '');
    /* §Blockerare 7 — `uploadedBy` skickas MEDVETET INTE längre från
       klienten. Servern härleder uppladdarens identitet uteslutande
       från den autentiserade JWT:n (auth.staffMember.id) — ett
       klientskickat värde skulle vara enkelt att förfalska och är
       därför obsolet/ignorerat i backend. */

    try {
      const res = await fetch(this._edgeBase() + '/functions/v1/project-document-upload', {
        method: 'POST',
        headers: this._authHeaders(),
        body: fd
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: json.error || ('HTTP ' + res.status) };
      const doc = Object.assign(Schema.projectDocument(), json.document || {});
      if (!state.projectDocuments) state.projectDocuments = [];
      state.projectDocuments.push(doc);
      this._syncLocalCache();
      return { ok: true, document: doc };
    } catch (e) {
      return { ok: false, error: 'Uppladdningen misslyckades: ' + (e.message || e) };
    }
  },

  /* ── Metadata-redigering — Edge Function project-document-upload (PATCH)
     §Blockerare 1: `expectedProjectId` MÅSTE vara den sida/kontext
     anroparen befinner sig i (t.ex. ProjectDetailPage._projectId),
     ALDRIG härlett från dokumentet självt. §Blockerare 6: går nu via
     samma autentiserade backend som uppladdning/borttagning — kringgår
     inte längre `customer_manage`/`invoice_view`-kontrollerna. */
  async updateMetadata(id, expectedProjectId, patch) {
    const doc = this.getById(id);
    if (!doc) return { ok: false, error: 'Dokumentet hittades inte' };
    if (doc.projectId !== expectedProjectId) return { ok: false, error: 'forbidden' };
    const merged = Object.assign({}, doc, patch);
    const validated = this._validate(merged, doc.projectId);
    if (!validated.ok) return validated;

    try {
      const res = await fetch(this._edgeBase() + '/functions/v1/project-document-upload', {
        method: 'PATCH',
        headers: this._authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ documentId: id, projectId: expectedProjectId, patch })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: json.error || ('HTTP ' + res.status) };
      Object.assign(doc, json.document || {});
      this._syncLocalCache();
      return { ok: true, document: doc };
    } catch (e) {
      return { ok: false, error: 'Uppdateringen misslyckades: ' + (e.message || e) };
    }
  },

  /* §C5 — "Vald" är ALLTID en explicit, separat handling — aldrig en
     bieffekt av uppladdning eller av en annan metadata-ändring. */
  async setUeStatus(id, expectedProjectId, status) {
    if (!this.UE_STATUSES.some(s => s.key === status)) return { ok: false, error: 'Ogiltig status' };
    return this.updateMetadata(id, expectedProjectId, { supplierQuoteStatus: status });
  },

  /* ── Signerad URL — Edge Function project-document-url ───────────
     mode: 'view' | 'download'. §Blockerare 1: `expectedProjectId` är
     den sida/kontext anroparen befinner sig i — kontrolleras klient-
     sidan FÖRE nätverksanropet, och skickas (inte dokumentets EGEN
     projectId) som den signal servern jämför mot sin egen lagrade
     sanning. Ett manipulerat documentId som pekar på ett dokument i ETT
     ANNAT projekt avvisas nu redan lokalt, och oberoende även av
     servern (se backend/). */
  async getSignedUrl(documentId, expectedProjectId, mode) {
    const doc = this.getById(documentId);
    if (!doc) return { ok: false, error: 'Dokumentet hittades inte' };
    if (doc.projectId !== expectedProjectId) return { ok: false, error: 'forbidden' };
    try {
      const res = await fetch(this._edgeBase() + '/functions/v1/project-document-url', {
        method: 'POST',
        headers: this._authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ documentId, projectId: expectedProjectId, mode: mode || 'view' })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: json.error || ('HTTP ' + res.status) };
      return { ok: true, url: json.url, fileName: json.fileName, mimeType: json.mimeType };
    } catch (e) {
      return { ok: false, error: 'Kunde inte hämta länk: ' + (e.message || e) };
    }
  },

  /* ── Mjuk borttagning ─────────────────────────────────────────────
     §C12/§Blockerare 1/2: kräver bekräftelse i UI (se ProjectDetailPage),
     tar bort BÅDE metadata OCH lagringsobjektet via EF:en, med
     `expectedProjectId` = anroparens sidkontext (inte dokumentets egen
     projectId). Om lagringsdelen misslyckas på serversidan returnerar
     EF:en nu ett FEL (inte 200+varning) och metadata förblir aktiv — se
     backend/. Klienten markerar ALDRIG dokumentet borttaget lokalt om
     serveranropet inte lyckades. */
  async remove(id, expectedProjectId) {
    const doc = this.getById(id);
    if (!doc) return { ok: false, error: 'Dokumentet hittades inte' };
    if (doc.projectId !== expectedProjectId) return { ok: false, error: 'forbidden' };
    try {
      const res = await fetch(this._edgeBase() + '/functions/v1/project-document-upload', {
        method: 'DELETE',
        headers: this._authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ documentId: id, projectId: expectedProjectId })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: json.error || ('HTTP ' + res.status) };
      doc.active = false;
      doc.deletedAt = new Date().toISOString();
      this._syncLocalCache();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: 'Borttagningen misslyckades: ' + (e.message || e) };
    }
  }
};
