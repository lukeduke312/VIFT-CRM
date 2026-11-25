/**
 * TimeEntriesReadService — P0 FINAL INTEGRATION (STAFF/PAYROLL R1, BLOCKER-1)
 *
 * The ONLY read path for `state.timeEntries` now that
 * `vift_timeEntries` is blocked from direct authenticated SELECT (see
 * supabase/migrations/20261018000007_timeentries_payroll_read_lockdown.sql).
 * `Storage.getAll()`'s bulk snapshot will simply be MISSING this key for
 * every authenticated user (RLS filters the row out silently, no
 * error) — this service fetches it separately via `time-entries-list`,
 * which filters server-side by `payroll_view` (the REAL fix: previously
 * this filtering happened only in DataSync._poll(), AFTER the full,
 * unfiltered array had already reached the browser over the wire —
 * trivially bypassed by calling the REST API directly with one's own
 * JWT, which is exactly how this was verified as a genuine leak, not
 * just a UI nicety).
 *
 * Called from BOTH initState() and DataSync._poll() (see state.js) —
 * timeEntries no longer rides along in the generic bulk snapshot at
 * all for this purpose, read-side.
 */
const TimeEntriesReadService = {
  /* R9B v2 TIME-SYNC-FIX (krav 5): monotont ökande sekvensnummer. Skyddar
     mot att ett SENT svar på ett ÄLDRE fetchAndApply()-anrop skriver över
     ett redan tillämpat NYARE svar — kan hända om två anrop (t.ex. två
     på varandra följande DataSync-pollar vid en trög nätverksförbindelse,
     se krav G) råkar vara i flykt samtidigt och svarar i fel ordning.

     R9B v2 TIME-SYNC-FIX v2 (oberoende granskning ronda 2, Blockerare 1):
     `_seq` ökas vid varje anrops DISPATCH, inte vid dess (eventuella)
     lyckade svar. Att jämföra ett inkommet svars `mySeq` mot `_seq`
     förkastade därför felaktigt ett ÄLDRE men LYCKAT svar bara därför
     att ett NYARE anrop redan hade STARTAT — även om det nyare anropet
     sedan MISSLYCKADES (t.ex. HTTP 503) och alltså aldrig tillämpade
     något. `_appliedSeq` håller istället reda på sekvensnumret för det
     SENAST FRAMGÅNGSRIKT TILLÄMPADE svaret — det enda som faktiskt ska
     skydda mot överskrivning. */
  _seq: 0,
  _appliedSeq: 0,

  /* BLOCKER-1 SLUTFÖRANDE (verkligt reproducerad kvarstående läcka):
     `vift_timeEntries` skrevs till localStorage av fetchAndApply() men
     rensades ALDRIG av AuthService._clearSession()/logout() — känsliga
     tidposter/löneuppgifter låg kvar i webbläsaren efter utloggning OCH
     en ny inloggning på samma enhet kunde ärva föregående användares
     cachade data innan dennes EGEN fetchAndApply() hunnit köra.
     `_accountEpoch` är en EGEN räknare, oberoende av `_seq`/`_appliedSeq`
     ovan (som bara skyddar mot omkastad ANROPSORDNING inom SAMMA
     session) — den höjs ENDAST vid utloggning/inloggning (se
     `resetForAccountChange()`, anropad från AuthService) och fångas i
     `fetchAndApply()` FÖRE `await`. Ett svar som löper ut EFTER en
     utloggning/kontobyte (epoken har då redan höjts) kasseras tyst —
     skriver ALDRIG till `state.timeEntries` eller localStorage, oavsett
     hur långt anropet redan hunnit. */
  _accountEpoch: 0,

  /* Anropas av AuthService vid (a) utloggning, (b) precis INNAN en ny
     inloggnings session sätts, och (c) app-start utan en giltig
     sparad session (rensar ev. kvarvarande data från en tidigare
     version/användare). Rör ALDRIG `vift_outbox`/`vift_settleIntents`
     (AOTimeSyncService:s outbox för osynkroniserade AO-/tidposter) —
     dessa måste överleva en utloggning oförändrade. Ingen
     `localStorage.clear()` används, bara den specifika nyckeln. */
  resetForAccountChange() {
    this._accountEpoch++;
    if (typeof state !== 'undefined') state.timeEntries = [];
    try { localStorage.removeItem('vift_timeEntries'); } catch (e) {}
  },

  /* BLOCKER-1 SLUTFÖRANDE (oberoende granskning, fel 2, ANDRA
     rapporterade bristen — verkligt reproducerad): den tidigare
     versionen av denna fil hade en EGEN `storage`-eventlyssnare här
     som bara rensade cachen/epoken, men ALDRIG `Auth._session` i den
     mottagande fliken — fliken "trodde" sig alltså fortfarande
     inloggad, och ett HELT NYTT (inte bara ett redan i-flykt)
     `fetchAndApply()`-anrop som startades EFTER att cachen rensats
     kunde då fortfarande lyckas och återskapa `vift_timeEntries`.
     Den riktiga korrigeringen måste ogiltigförklara fliken ÄGARSKAP
     (dess `Auth._session`), inte bara dess cache — det hör därför
     hemma i `AuthService.js` (som redan äger sessionslivscykeln och
     redan kaskaderar till `resetForAccountChange()` via
     `_clearSession()`), inte här. Se `AuthService.js` för den
     faktiska cross-tab-lyssnaren.
     KVAR HÄR, som ett EGET, OBEROENDE skyddslager (krav: "kontrollera
     sessionsidentitet både vid start och innan lagring" — inte bara
     en engångs-epok): `fetchAndApply()` nedan kontrollerar nu även
     `Auth._session`s identitet (användarens e-post) BÅDE före och
     efter nätverksanropet. Detta fångar fallet ÄVEN om
     `AuthService.js`s cross-tab-lyssnare av någon anledning inte
     hunnit/kunnat köra (t.ex. ett webbläsarbeteende som skiljer sig
     från det testade) — ingen enskild mekanism är den ENDA
     spärren. */

  async fetch() {
    try {
      const base = (typeof Storage !== 'undefined' && Storage._functionsBase) ? Storage._functionsBase() : '';
      /* STAGING-GRANSKNING 2026-11-11: egen inledande "/" — _functionsBase()
         har INGEN avslutande "/" (se storage.js för full motivering av det
         404-felet denna rad tidigare orsakade). */
      const res = await fetch(base + '/time-entries-list', {
        method: 'GET',
        headers: (typeof Storage !== 'undefined' && Storage._h) ? Storage._h(false) : {}
      });
      if (!res.ok) {
        console.error('[TimeEntriesReadService] fetch misslyckades HTTP ' + res.status + ' — behåller befintligt state.timeEntries oförändrat, visar INTE en tom lista som om den vore legitim.');
        return null;
      }
      const data = await res.json().catch(function() { return {}; });
      return Array.isArray(data.timeEntries) ? data.timeEntries : null;
    } catch (e) {
      console.warn('[TimeEntriesReadService] nätverksfel:', e);
      return null;
    }
  },

  /* Hämtar och applicerar i state + localStorage-cache. Returnerar true
     vid lyckad hämtning (state.timeEntries uppdaterad), false annars
     (state.timeEntries lämnas OFÖRÄNDRAD — ingen tyst tömning vid ett
     tillfälligt nätverksfel).

     P0-1 FIX (independent-reviewer regression, samma klass som för
     workOrders — se state.js reconcilePendingAoTime()'s filhuvud):
     denna funktion är den ENDA platsen state.timeEntries sätts från
     servern nu (både initState() och DataSync._poll() går via den) —
     ett direkt `state.timeEntries = entries` skulle tyst tappa en
     fortfarande-opending (inte ännu ACKad) optimistisk tidpost exakt
     som workOrders-buggen gjorde. `previousArr` (state.timeEntries
     INNAN denna tilldelning) bevarar objektidentiteten för en post som
     redan finns i minnet (TimeService._syncTime()'s onSettled-closure
     muterar den SAMMA referensen) — vid en första-sidladdning efter en
     reload (previousArr tom) rekonstrueras posten istället från
     AOTimeSyncService:s outbox-payload. */
  /* Läser den inloggade användarens identitet, om någon. `null` betyder
     "ingen giltig session" — ett läge `fetchAndApply()` nu vägrar
     starta OCH vägrar lagra resultatet för (se nedan). */
  /* RONDA 4-KORRIGERING (fel 3, verkligt reproducerad): läste tidigare
     `Auth._session` — DENNA flikens EGNA, in-minnes kopia, som bara
     uppdateras NÄR (och OM) `storage`-eventlyssnaren i AuthService.js
     redan hunnit köra. Webbläsarens `storage`-event är asynkront och
     har INGEN garanterad ordning mot ett samtidigt pågående, redan
     avsänt API-svars `.then()` — ett försenat svar kunde alltså
     tillämpas FÖRE lyssnaren hunnit nollställa `Auth._session`, trots
     att den ANDRA flikens utloggning/kontobyte redan var ett FAKTUM i
     den delade `localStorage`. Läser nu istället direkt ur
     `localStorage['vift_auth_v2']` — den GEMENSAMMA, omedelbart
     uppdaterade sanningen, oberoende av om någon eventlyssnare någon
     av flikarna råkat köra än. */
  /* RONDA 4-KORRIGERING (uppföljning, verkligt reproducerad mot egna
     tester): att läsa ENBART den delade `localStorage` räcker inte
     ensamt heller — den säger bara "NÅGON flik, någonstans, är just nu
     inloggad som X", inte att DENNA flik faktiskt ÄR det (t.ex. om en
     ANNAN flik precis loggat in som en annan användare, men DENNA
     flikens egna `Auth._session` redan korrekt nollställts av
     cross-tab-lyssnaren — denna flik ska då INTE börja hämta/tillämpa
     data för den andra flikens nya konto bara därför att localStorage
     råkar vara ifylld). Kräver nu att BÅDA källorna är ifyllda OCH
     ÖVERENSSTÄMMER: den delade `localStorage` (omedelbar, synkron
     sanning om vad som NYLIGEN hänt) OCH `Auth._session` (denna flikens
     EGEN, bekräftade inloggningsstatus). Är endera `null`, eller skiljer
     de sig, finns ingen samstämmig, bekräftad identitet för DENNA flik
     just nu — `fetchAndApply()` vägrar då starta/tillämpa. Detta
     bevarar fel 3-fixen (ett försenat svar avvisas ändå, eftersom
     localStorage redan hunnit nollställas synkront vid den andra
     flikens utloggning, oavsett om den lokala eventlyssnaren hunnit
     köra) utan att öppna den NYA läckan (denna flik börjar inte agera
     på en ANNAN tabbs helt nya, egna inloggning). */
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

  async fetchAndApply() {
    const mySeq = ++this._seq;
    const startEpoch = this._accountEpoch;
    /* BLOCKER-1 SLUTFÖRANDE (fel 2, ANDRA bristen — krav: kontrollera
       sessionsidentitet BÅDE vid start OCH innan lagring): om ingen
       session alls finns NÄR anropet skulle starta (redan utloggad —
       t.ex. av AuthService.js:s cross-tab-lyssnare, eller helt enkelt
       en redan utloggad flik som av misstag ändå anropar detta),
       startas inte ens nätverksanropet. */
    const startIdentity = this._currentIdentity();
    if (startIdentity === null) return false;
    const entries = await this.fetch();
    /* BLOCKER-1 SLUTFÖRANDE: en utloggning/kontobyte hann ske MEDAN
       detta anrop var i flykt — kassera helt, rör ALDRIG state eller
       localStorage med ett svar som (eventuellt) gäller en annan
       användare än den som nu faktiskt är inloggad. Kontrolleras FÖRE
       `entries === null`-kontrollen så att den alltid vinner, oavsett
       om anropet i övrigt lyckades. Två oberoende kontroller: den
       interna epoken (snabb, lokal) OCH identiteten på nytt (skyddar
       även om epoken av någon anledning inte höjdes). */
    if (this._accountEpoch !== startEpoch) return false;
    if (this._currentIdentity() !== startIdentity) return false;
    if (entries === null) return false;
    /* R9B v2 TIME-SYNC-FIX v2 (krav 1/2, oberoende granskning ronda 2):
       jämför mot `_appliedSeq` (senast FRAMGÅNGSRIKT TILLÄMPADE svar),
       inte mot `_seq` (senast STARTADE anrop, se filhuvudets kommentar
       för varför den ursprungliga jämförelsen var fel). Ett svar
       förkastas alltså ENDAST om ett STRIKT NYARE svar redan har
       tillämpats — aldrig bara därför att ett senare anrop STARTAT,
       oavsett om det senare anropet sedan lyckas eller misslyckas. */
    if (mySeq <= this._appliedSeq) {
      console.log('[TimeEntriesReadService] Ignorerar inaktuellt svar — ett nyare svar har redan tillämpats.');
      return false;
    }
    const merged = (typeof reconcilePendingAoTime === 'function')
      ? reconcilePendingAoTime(entries, state.timeEntries, 'time')
      : entries;
    state.timeEntries = merged;
    this._appliedSeq = mySeq;
    try { Storage._writeCache('vift_timeEntries', JSON.stringify(merged)); } catch (e) {}
    return true;
  }
};
