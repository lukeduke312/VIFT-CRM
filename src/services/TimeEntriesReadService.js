/**
 * TimeEntriesReadService — läser tidposter via den nya, server-filtrerade
 * `time-entries-list` Edge Function (se
 * supabase/functions/time-entries-list/index.ts och den medföljande
 * migrationen 20261120000002_PROPOSAL_timeentries_read_lockdown.sql),
 * istället för att förlita sig på att den generiska
 * Storage.getAll()/DataSync._poll()-vägen returnerar `vift_timeEntries`.
 *
 * VARFÖR EN EGEN SERVICE, INTE BARA EN RAD I state.js: detta är den
 * ENDA store-nyckeln som (efter att companion-migrationen installerats)
 * INTE längre kan läsas via den generiska bulk-vägen alls — en egen,
 * tydligt namngiven service gör den särbehandlingen uppenbar för en
 * framtida läsare, istället för att gömma ett specialfall inne i
 * state.js:s redan långa, generiska initState()/_poll().
 *
 * BAKÅTKOMPATIBELT, AVSIKTLIGT LAGRAT I TVÅ STEG:
 * - Innan companion-migrationen installeras: den generiska bulk-vägen
 *   (Storage.getAll()) returnerar FORTFARANDE hela, ofiltrerade
 *   `vift_timeEntries` till state.timeEntries (oförändrat, se state.js).
 *   Denna service anropas ÄVEN då och skriver över med det korrekta,
 *   server-filtrerade resultatet OM anropet lyckas — annars lämnas
 *   state.timeEntries orört (fortfarande skyddat av det redan befintliga
 *   klientfiltret _applyTimeEntriesPayrollFilter() i state.js, som
 *   förblir ORÖRT som ett andra skyddslager under övergångsfönstret).
 * - Efter companion-migrationen installeras: bulk-vägen returnerar INTE
 *   längre denna nyckel alls för `authenticated` — denna service blir då
 *   den ENDA faktiska källan.
 *
 * Fel (nätverksfel, EF ej deployad ännu, 401/403/429/500) hanteras ALLTID
 * tyst med `return false` — anroparen (state.js) lämnar då state.timeEntries
 * som det redan var (antingen tomt, eller skyddat av det befintliga
 * klientfiltret) — ALDRIG en krasch, ALDRIG en "låtsad framgång".
 */
const TimeEntriesReadService = {
  async fetchAndApply() {
    if (typeof Auth === 'undefined' || !Auth.getAccessToken || !Auth.getAccessToken()) {
      return false;
    }
    try {
      const res = await fetch(SUPABASE_URL + '/functions/v1/time-entries-list', {
        method: 'GET',
        headers: {
          'apikey':        SUPABASE_AKEY,
          'Authorization': 'Bearer ' + Auth.getAccessToken()
        }
      });
      if (!res.ok) {
        console.warn('[TimeEntriesReadService] HTTP ' + res.status);
        return false;
      }
      const body = await res.json().catch(function() { return null; });
      if (!body || !Array.isArray(body.timeEntries)) {
        console.warn('[TimeEntriesReadService] Oväntat svarsformat');
        return false;
      }

      state.timeEntries = body.timeEntries;

      /* Håll diff-cachen (VIFT CRM, _lastWrittenJSON i state.js) i synk
         med detta, nu AUKTORITATIVA, värde — exakt samma princip som
         DataSync._poll()s arr()/timeEntries-hantering redan följer: en
         nyckel vi VET matchar servern (här: matchar det servern just sa
         att DENNA användare FÅR se) ska inte skickas tillbaka i onödan av
         en senare, obesläktad persist(). */
      if (typeof _lastWrittenJSON !== 'undefined') {
        _lastWrittenJSON['timeEntries'] = JSON.stringify(state.timeEntries);
      }
      if (typeof Storage !== 'undefined' && typeof Storage.setLocal === 'function') {
        Storage.setLocal('timeEntries', state.timeEntries);
      }
      return true;
    } catch (e) {
      console.warn('[TimeEntriesReadService] fel:', e);
      return false;
    }
  }
};
