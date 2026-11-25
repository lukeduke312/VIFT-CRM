/**
 * RonderingSyncService — P0 PART B (RONDERINGSPASS R1)
 *
 * Klient-sidig skrivväg för vift_ronderingspass via den nya
 * `rondering-pass-write` Edge Function:en (atomisk server-RPC, se
 * supabase/migrations/20261018000001_rondering_pass_atomic_rpc.sql).
 * Ersätter den tidigare "mutera state.ronderingspass direkt i minnet +
 * generisk persist()"-vägen för EXAKT de åtta call sites som skrev till
 * denna nyckel (se 02_diffs/ i leveranspaketet för den grep-verifierade
 * inventeringen).
 *
 * Samma etablerade klientmönster som ProjectDocumentService (_edgeBase/
 * _authHeaders) — ingen fjärde, fristående HTTP-modell. Medvetet HÅLLS
 * ENKELT (ingen durabel IndexedDB-outbox/kö som AOTimeSyncService): varje
 * anrop här är redan naturligt idempotent på serversidan (en upprepad
 * punktstatus eller anteckning ger samma slutresultat, ingen räknare som
 * dubbelökar — se migrationens filhuvud för motiveringen), så en enkel
 * "försök, markera _syncFailed vid fel, låt användaren trycka igen" räcker
 * för detta UI-flöde (en pågående, interaktiv inspektionsvy — inte ett
 * bakgrundsflöde som behöver överleva en helt stängd flik). Detta är ett
 * medvetet AVGRÄNSAT designval, inte en bortglömd lucka — se README §5
 * "Varför inte en generaliserad outbox".
 *
 * Varje framgångsrikt anrop uppdaterar `state.ronderingspass` LOKALT
 * genom att ERSÄTTA ENDAST det berörda pass-objektet (by id) med den
 * FAKTISKA, servercanoniska kopian som kom tillbaka — aldrig genom att
 * skriva om hela arrayen, och aldrig genom att gå via persist() (som
 * fortfarande INTE innehåller `ronderingspass` i sin generiska
 * skrivlista — se state.js _doPersist()-kommentaren för projectDocuments-
 * motsvarigheten; samma princip tillämpas nu här).
 */
const RonderingSyncService = {

  _edgeBase() {
    return (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '').replace(/\/$/, '');
  },

  _authHeaders() {
    return {
      'Content-Type': 'application/json',
      'apikey': (typeof SUPABASE_AKEY !== 'undefined' ? SUPABASE_AKEY : ''),
      'Authorization': 'Bearer ' + (typeof Auth !== 'undefined' ? (Auth.getAccessToken() || '') : '')
    };
  },

  async _call(body) {
    try {
      const res = await fetch(this._edgeBase() + '/functions/v1/rondering-pass-write', {
        method: 'POST',
        headers: this._authHeaders(),
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok) {
        return { ok: false, error: data.error || ('http_' + res.status) };
      }
      return { ok: true, data: data };
    } catch (e) {
      return { ok: false, error: 'network_error' };
    }
  },

  /* Ersätter ENDAST det givna pass-objektet i state.ronderingspass (by
     id) med server-svaret, och synkar localStorage-cachen för nyckeln —
     samma kontrakt som state.js:s DataSync redan upprätthåller för andra
     nycklar, men riktat mot EN rad istället för en hel fjärr-snapshot. */
  _applyLocally(pass) {
    if (!pass || !pass.id) return;
    state.ronderingspass = state.ronderingspass || [];
    const idx = state.ronderingspass.findIndex(function(p) { return p.id === pass.id; });
    if (idx >= 0) state.ronderingspass[idx] = pass;
    else state.ronderingspass.push(pass);
    try { Storage._writeCache('vift_ronderingspass', JSON.stringify(state.ronderingspass)); } catch (e) {}
  },

  async pointPatch(passId, categoryId, pointId, status, comment, deviationId, workOrderId) {
    const r = await this._call({
      action: 'pointPatch', passId, categoryId, pointId, status,
      comment: comment || '', deviationId: deviationId || null, workOrderId: workOrderId || null
    });
    if (r.ok) this._applyLocally(r.data.pass);
    return r;
  },

  async pointReset(passId, categoryId, pointId) {
    const r = await this._call({ action: 'pointReset', passId, categoryId, pointId });
    if (r.ok) this._applyLocally(r.data.pass);
    return r;
  },

  async saveNote(passId, note) {
    const r = await this._call({ action: 'saveNote', passId, note: note || '' });
    if (r.ok) this._applyLocally(r.data.pass);
    return r;
  },

  async autoStart(passId) {
    const r = await this._call({ action: 'autoStart', passId });
    if (r.ok) this._applyLocally(r.data.pass);
    return r;
  },

  async complete(passId) {
    const r = await this._call({ action: 'complete', passId });
    if (r.ok) this._applyLocally(r.data.pass);
    return r;
  },

  async create(passTemplate) {
    const r = await this._call({ action: 'create', passTemplate });
    if (r.ok) this._applyLocally(r.data.pass);
    return r;
  },

  /* En gång per legacy-rondering, anropad av initState()'s
     RON.results[]→ronderingspass-backfill. Deterministiskt id
     ('PASS-MIG-<ronderingId>') skickas med — se migrationens
     rondering_pass_migrate_legacy för varför det är säkert HÄR
     (till skillnad från create()/bulkCreate() ovan). */
  async migrateLegacy(pass) {
    const r = await this._call({ action: 'migrateLegacy', pass });
    if (r.ok) this._applyLocally(r.data.pass);
    return r;
  },

  async bulkCreate(ronderingId, candidates) {
    const r = await this._call({ action: 'bulkCreate', ronderingId, candidates });
    if (r.ok) {
      (r.data.created || []).forEach(this._applyLocally.bind(this));
    }
    return r;
  }
};
