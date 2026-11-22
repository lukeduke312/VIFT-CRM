/**
 * WorkOrdersReadService — SÄKERHETSFYND V7 (läsningslucka, vift_workOrders)
 *
 * Den ENDA läsvägen för `state.workOrders` nu att
 * `vift_workOrders` är blockerad från direkt autentiserad SELECT (se
 * supabase/migrations_phase2_rls/20261030000001_workorders_read_lockdown.sql).
 * `Storage.getAll()`s bulk-snapshot saknar nu denna nyckel HELT för
 * varje autentiserad användare (RLS filtrerar bort raden tyst) — denna
 * tjänst hämtar den separat via `work-orders-list`, som filtrerar
 * server-sidigt enligt `ao_view_own`/`ao_view_all` (den REALA fixen:
 * tidigare skedde denna filtrering bara i webbläsaren, EFTER att hela
 * arrayen redan nått den — trivialt kringgånget genom att anropa
 * REST-API:et direkt med sin egen JWT, exakt det som verifierades i
 * STAGING-behörighetstestet).
 *
 * Denna fil är medvetet byggd som en nästan ordagrann kopia av
 * `TimeEntriesReadService.js` — SAMMA klass av brist (en `_view_own`/
 * `_view_all`-åtskillnad som bara tillämpades client-side), SAMMA
 * verifierade skyddslager (sekvensnummer mot inaktuella svar,
 * kontobytes-epok, dubbel identitetskontroll före/efter nätverksanropet)
 * — ingen anledning att uppfinna ett annat mönster för en identisk
 * risk-klass.
 *
 * Anropas från BÅDE initState() och DataSync._poll() (se state.js) —
 * workOrders rider inte längre med i den generiska bulk-snapshoten för
 * LÄSNING (skrivning var redan separat sedan P0 AO/TID-FIXEN).
 */
const WorkOrdersReadService = {
  /* Sekvensskydd mot inaktuella svar — identiskt mönster/motivering
     som TimeEntriesReadService._seq/_appliedSeq. */
  _seq: 0,
  _appliedSeq: 0,

  /* Kontobytes-epok — identiskt mönster/motivering som
     TimeEntriesReadService._accountEpoch. */
  _accountEpoch: 0,

  /* Anropas av AuthService vid utloggning/inloggning/app-start utan
     giltig session — identiskt anropsmönster som
     TimeEntriesReadService.resetForAccountChange() (samma sju
     anropsplatser i AuthService.js). Rör ALDRIG `vift_outbox`/
     `vift_settleIntents`. */
  resetForAccountChange() {
    this._accountEpoch++;
    if (typeof state !== 'undefined') state.workOrders = [];
    try { localStorage.removeItem('vift_workOrders'); } catch (e) {}
  },

  async fetch() {
    try {
      const base = (typeof Storage !== 'undefined' && Storage._functionsBase) ? Storage._functionsBase() : '';
      /* STAGING-GRANSKNING 2026-11-11: egen inledande "/" — _functionsBase()
         har INGEN avslutande "/" (se storage.js för full motivering av det
         404-felet denna rad tidigare orsakade). */
      const res = await fetch(base + '/work-orders-list', {
        method: 'GET',
        headers: (typeof Storage !== 'undefined' && Storage._h) ? Storage._h(false) : {}
      });
      if (!res.ok) {
        console.error('[WorkOrdersReadService] fetch misslyckades HTTP ' + res.status + ' — behåller befintligt state.workOrders oförändrat, visar INTE en tom lista som om den vore legitim.');
        return null;
      }
      const data = await res.json().catch(function() { return {}; });
      return Array.isArray(data.workOrders) ? data.workOrders : null;
    } catch (e) {
      console.warn('[WorkOrdersReadService] nätverksfel:', e);
      return null;
    }
  },

  /* Identisk identitetskontroll som TimeEntriesReadService._currentIdentity()
     — se den filens kommentar för den fullständiga motiveringen (läser
     den delade localStorage OCH Auth._session, kräver att båda
     överensstämmer). */
  _currentIdentity() {
    try {
      const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem('vift_auth_v2') : null;
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const rawEmail = (parsed && parsed.user_email) ? parsed.user_email : null;
      const sessionEmail = (typeof Auth !== 'undefined' && Auth._session && Auth._session.user_email) ? Auth._session.user_email : null;
      if (!rawEmail || !sessionEmail || rawEmail !== sessionEmail) return null;
      return rawEmail;
    } catch (e) {
      return null;
    }
  },

  /* Hämtar och applicerar i state + localStorage-cache. Returnerar true
     vid lyckad hämtning, false annars (state.workOrders lämnas
     OFÖRÄNDRAD vid ett tillfälligt nätverksfel — ingen tyst tömning).

     Merge via reconcilePendingAoTime() — IDENTISK motivering som
     TimeEntriesReadService.fetchAndApply(): en direkt
     `state.workOrders = entries` skulle tyst tappa en fortfarande-
     opending (inte ännu ACKad) optimistisk AO, exakt den ursprungliga
     P0-1-buggen (se reconcilePendingAoTime()'s eget filhuvud). */
  async fetchAndApply() {
    const mySeq = ++this._seq;
    const startEpoch = this._accountEpoch;
    const startIdentity = this._currentIdentity();
    if (startIdentity === null) return false;
    const entries = await this.fetch();
    if (this._accountEpoch !== startEpoch) return false;
    if (this._currentIdentity() !== startIdentity) return false;
    if (entries === null) return false;
    if (mySeq <= this._appliedSeq) {
      console.log('[WorkOrdersReadService] Ignorerar inaktuellt svar — ett nyare svar har redan tillämpats.');
      return false;
    }
    const merged = (typeof reconcilePendingAoTime === 'function')
      ? reconcilePendingAoTime(entries, state.workOrders, 'ao')
      : entries;
    state.workOrders = merged;
    this._appliedSeq = mySeq;
    try { localStorage.setItem('vift_workOrders', JSON.stringify(merged)); } catch (e) {}
    return true;
  }
};
