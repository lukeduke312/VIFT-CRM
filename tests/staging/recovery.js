'use strict';
/*
 * Gemensam återhämtning för nivå 2-verktygen (authz-mutation.js,
 * e2e-real.js). Utbruten 2026-11-25 ur authz-mutation.js utan ändrad logik,
 * plus: spärrfil och städning av instämpling.
 *
 *  - Journal (rapport/<runId>.journal.json) skrivs FÖRE varje mutation.
 *  - Städning utgår från journalen (kräver ingen ögonblicksbild), högst 3
 *    försök per åtgärd, kompletteras med sökning på runId när
 *    ögonblicksbilden går att läsa.
 *  - "Återställt" påstås bara efter lyckad EFTERKONTROLL.
 *  - SPÄRRFIL rapport/OSTADAT-<runId>.lock skrivs när en körning inte kan
 *    efterkontrolleras som städad (kod 3) och tas bort först när en
 *    efterkontroll visar att inga testposter finns kvar. Så länge en spärrfil
 *    finns vägrar ALLA nivå 2-körningar att starta (kod 2), utom
 *    --stada=<det runId:t>.
 *  - Ändrade befintliga affärsposter räknas aldrig som godkänt (kod 4).
 */
const fs = require('fs');
const path = require('path');

const TEST_PREFIX = 'E2E-AUTHZ-';
const lockName = (runId) => 'OSTADAT-' + runId + '.lock';

function openLocks(dir) {
  try { return fs.readdirSync(dir).filter((f) => /^OSTADAT-E2E-AUTHZ-\d{14}-[0-9a-f]{6}\.lock$/.test(f)).map((f) => f.slice(8, -5)); } catch (e) { return []; }
}
/* Före varje nivå 2-körning: ingen ostädad körning får finnas. */
function assertNoOpenLocks(L, dir, allowRunId) {
  const open = openLocks(dir).filter((r) => r !== allowRunId);
  if (open.length) L.refuse('ostädad tidigare körning: ' + open.join(', ') + '. Kör --stada=<runId> tills den ger kod 0 (spärrfil i ' + dir + ').');
}

function createRecovery(o) {
  const { L, req, admin, runId, dir, ref, keys, loginFor } = o;
  const KEYS = keys || [];
  const PAUSE_MS = Number(process.env.VIFT_STADA_PAUS_MS || 1500);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isTest = (x, id) => !!x && (String(x.id || '').startsWith(id || TEST_PREFIX) || String(x.aoId || '').startsWith(id || TEST_PREFIX)
    || String(x.title || x.comment || x.name || '').includes(id || TEST_PREFIX));
  const journalFile = path.join(dir, runId + '.journal.json');
  const lockFile = path.join(dir, lockName(runId));
  let journal = [];

  function saveJournal() {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(journalFile, JSON.stringify({ runId, projekt: ref, journal }, null, 2));
  }
  function note(entry) { journal.push(Object.assign({ t: new Date().toISOString(), status: 'avsedd' }, entry)); saveJournal(); return journal[journal.length - 1]; }
  function loadJournal() { try { const j = JSON.parse(fs.readFileSync(journalFile, 'utf8')); if (j.runId === runId) journal = j.journal || []; } catch (e) {} return journal.length; }
  function writeLock(reason) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(lockFile, JSON.stringify({ runId, tid: new Date().toISOString(), orsak: reason }, null, 2)); }
  function removeLock() { try { fs.unlinkSync(lockFile); } catch (e) {} }

  async function snapshot() {
    const ra = await req('/functions/v1/store-key-write', { token: admin(), body: { action: 'readAllWithHashes', keys: KEYS.concat(['vift_activityLog']) } });
    const wl = await req('/functions/v1/work-orders-list', { method: 'GET', token: admin() });
    const tl = await req('/functions/v1/time-entries-list', { method: 'GET', token: admin() });
    if (ra.status !== 200 || wl.status !== 200 || tl.status !== 200) throw new Error('ögonblicksbild misslyckades (HTTP ' + [ra.status, wl.status, tl.status].join('/') + ')');
    const d = ra.body.data || {};
    const pick = (k) => { const short = k.replace(/^vift_/, ''); return Object.prototype.hasOwnProperty.call(d, short) ? d[short] : d[k]; };
    const data = {};
    KEYS.forEach((k) => { data[k] = pick(k); });
    return { data, hashes: ra.body.hashes || {}, activityLog: pick('vift_activityLog'), aos: wl.body.workOrders || [], tes: tl.body.timeEntries || [] };
  }
  async function trySnapshot() { try { return { snap: await snapshot() }; } catch (e) { return { err: e.message }; } }
  const byId = (arr) => new Map((arr || []).filter((x) => x && x.id != null).map((x) => [String(x.id), L.stable(x)]));

  async function attempt(fn, ok, tries) {
    let last = null;
    for (let i = 0; i < (tries || 3); i++) {
      try { last = await fn(); if (ok(last)) return { ok: true, r: last }; } catch (e) { last = { status: 0, body: { error: 'nätverk: ' + e.message } }; }
      if (i < (tries || 3) - 1) await sleep(PAUSE_MS * (i + 1));
    }
    return { ok: false, r: last };
  }

  async function cleanupFromJournal() {
    const failed = [];
    const order = { stampling: 0, tidpost: 1, element: 2, checkpunkt: 3, ao: 4 };
    const entries = journal.filter((e) => e.status !== 'borttagen' && e.status !== 'nekad').sort((a, b) => (order[a.typ] ?? 9) - (order[b.typ] ?? 9));
    for (const e of entries) {
      let res = { ok: true };
      try {
        if (e.typ === 'element') {
          res = await attempt(() => req('/functions/v1/store-key-write', { token: admin(), body: { action: 'writeMerge', key: e.key, upserts: [], removals: [{ id: e.id, previous: e.data }] } }),
            (r) => r.status === 200 && !(r.body.conflicts || []).length);
          const conf = !res.ok && res.r && res.r.status === 200 && (res.r.body.conflicts || [])[0];
          if (conf && conf.current && conf.current.e2eTest === runId) {
            res = await attempt(() => req('/functions/v1/store-key-write', { token: admin(), body: { action: 'writeMerge', key: e.key, upserts: [], removals: [{ id: e.id, previous: conf.current }] } }),
              (r) => r.status === 200 && !(r.body.conflicts || []).length);
          }
        } else if (e.typ === 'tidpost') {
          res = await attempt(() => req('/functions/v1/ao-time-write', { token: admin(), body: { action: 'delete_time', entryId: e.id, idempotencyKey: runId + '-stada-t-' + e.id + '-' + Date.now() } }),
            (r) => r.status === 200 || r.status === 404);
        } else if (e.typ === 'ao') {
          await attempt(() => req('/functions/v1/ao-time-write', { token: admin(), body: { action: 'delete_ao', aoId: e.id, idempotencyKey: runId + '-stada-d-' + e.id + '-' + Date.now() } }), (r) => r.status === 200 || r.status === 404, 1);
          res = await attempt(() => req('/functions/v1/ao-time-write', { token: admin(), body: { action: 'permanent_delete_ao', aoId: e.id, idempotencyKey: runId + '-stada-p-' + e.id + '-' + Date.now() } }),
            (r) => r.status === 200 || r.status === 404);
        } else if (e.typ === 'stampling') {
          // Instämpling på ett testkonto: återställ till utstämplad (bara om den fortfarande gäller test-AO:n).
          const t = loginFor ? await loginFor(e.konto) : null;
          if (!t) res = { ok: false, r: { status: 0, body: { error: 'ingen inloggning för ' + e.konto } } };
          else {
            res = await attempt(async () => {
              const st = await req('/functions/v1/store-key-write', { token: t, body: { action: 'getStampStatus' } });
              if (st.status !== 200) return st;
              if (!st.body.active || !String(st.body.aoId || '').startsWith(runId)) return { status: 200, body: {} };
              return req('/functions/v1/store-key-write', { token: t, body: { action: 'setStampStatus', active: false, expectedRevision: st.body.revision } });
            }, (r) => r.status === 200 && !r.body.stale);
          }
        } else if (e.typ === 'checkpunkt') {
          res = { ok: true };
        }
      } catch (err) { res = { ok: false, r: { status: 0, body: { error: String(err.message) } } }; }
      e.status = res.ok ? 'borttagen' : 'osäker';
      if (!res.ok) failed.push(e.typ + ' ' + (e.key ? e.key + ':' : '') + (e.id || e.konto) + ' (' + (res.r ? 'HTTP ' + res.r.status + ' ' + (res.r.body.error || '') : 'inget svar') + ')');
      saveJournal();
    }
    return failed;
  }

  async function cleanupByScan(snap, prefix) {
    const extra = [];
    KEYS.forEach((k) => (Array.isArray(snap.data[k]) ? snap.data[k] : []).filter((x) => isTest(x, prefix)).forEach((x) => extra.push({ typ: 'element', key: k, id: x.id, data: x })));
    snap.tes.filter((x) => isTest(x, prefix)).forEach((x) => extra.push({ typ: 'tidpost', id: x.id }));
    snap.aos.filter((x) => isTest(x, prefix)).forEach((x) => extra.push({ typ: 'ao', id: x.id }));
    const known = new Set(journal.map((e) => e.typ + '|' + e.id));
    extra.filter((e) => !known.has(e.typ + '|' + e.id) || journal.find((j) => j.typ + '|' + j.id === e.typ + '|' + e.id && j.status !== 'borttagen'))
      .forEach((e) => { journal = journal.filter((j) => j.typ + '|' + j.id !== e.typ + '|' + e.id); note(Object.assign(e, { anm: 'hittad vid sökning efter runId' })); });
    return cleanupFromJournal();
  }

  function leftovers(snap, prefix) {
    const out = [];
    KEYS.forEach((k) => (Array.isArray(snap.data[k]) ? snap.data[k] : []).filter((x) => isTest(x, prefix)).forEach((x) => out.push(k + ':' + x.id)));
    snap.aos.filter((x) => isTest(x, prefix)).forEach((x) => out.push('AO ' + x.id));
    snap.tes.filter((x) => isTest(x, prefix)).forEach((x) => out.push('tidpost ' + x.id));
    return out;
  }

  const diffs = [];
  function compare(before, after) {
    const changed = [];
    const cmp = (label, a, b) => {
      const A = byId((a || []).filter((x) => !isTest(x))), B = byId((b || []).filter((x) => !isTest(x)));
      for (const [id, v] of A) if (B.get(id) !== v) {
        changed.push(label + ' ' + id + (B.has(id) ? ' ändrad' : ' borta'));
        /* Diagnostik (2026-11-26): vilka fält skiljer — för att kunna skilja verklig ändring från läsavvikelse. */
        if (B.has(id) && diffs.length < 5) {
          try {
            const x = JSON.parse(v), y = JSON.parse(B.get(id));
            const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((f) => JSON.stringify(x[f]) !== JSON.stringify(y[f]));
            diffs.push(label + ' ' + id + ': ' + keys.map((f) => f + ' ' + JSON.stringify(x[f]).slice(0, 60) + ' → ' + JSON.stringify(y[f]).slice(0, 60)).join('; '));
          } catch (e) { diffs.push(label + ' ' + id + ': (kunde inte jämföras fältvis)'); }
        }
      }
      for (const id of B.keys()) if (!A.has(id)) changed.push(label + ' ' + id + ' ny');
    };
    KEYS.forEach((k) => { if (Array.isArray(before.data[k])) cmp(k, before.data[k], after.data[k]); else if (L.stable(before.data[k]) !== L.stable(after.data[k])) changed.push(k + ' (objekt) ändrad'); });
    cmp('AO', before.aos, after.aos);
    cmp('tidpost', before.tes, after.tes);
    return changed;
  }

  function metadataReport(before, after) {
    const items = ['vift_lastChanged och store.updated_at för berörda nycklar (ändras vid varje skrivning, även borttagning)',
      'idempotensposter på servern för ao-time-write-anropen',
      'inloggningsposter i auth-schemat (session, refresh-token, last_sign_in_at) och Edge Function-loggar',
      'WAL/backup-historik som innehåller testposterna'];
    if (before && after && Array.isArray(before.activityLog) && Array.isArray(after.activityLog)) {
      const old = new Set(before.activityLog.map((a) => a && a.id));
      const added = after.activityLog.filter((a) => a && !old.has(a.id));
      const ours = added.filter((a) => JSON.stringify(a).includes(runId));
      items.push('aktivitetsflöde: ' + added.length + ' nya poster under körningen (varav ' + ours.length + ' nämner testkörningen) — tas inte bort');
    } else items.push('aktivitetsflöde: kunde inte jämföras');
    return items;
  }

  /* Städning + efterkontroll + utgångskod. Returnerar { exitCode, left, after }. */
  async function finish(rep, before, aborted) {
    let exitCode = L.EXIT.OK;
    const jFailed = await cleanupFromJournal();
    let post = await trySnapshot();
    if (post.snap && leftovers(post.snap, runId).length) { await cleanupByScan(post.snap, runId); post = await trySnapshot(); }
    const after = post.snap || null;
    const left = after ? leftovers(after, runId) : null;
    const openStamp = journal.filter((e) => e.typ === 'stampling' && e.status !== 'borttagen');
    const uncertain = journal.filter((e) => e.status !== 'borttagen' && e.status !== 'nekad').map((e) => e.typ + ' ' + (e.key ? e.key + ':' : '') + (e.id || e.konto));

    if (!after) {
      rep.add('ÅTERSTÄLLNING', false, 'EFTERKONTROLLEN KUNDE INTE GÖRAS (' + post.err + '). Städning från journalen: ' + (jFailed.length ? 'osäker för ' + jFailed.join(', ') : 'alla journalposter fick bekräftande svar') + '. Inget påstås vara återställt. Kör: --stada=' + runId);
      exitCode = L.EXIT.STADNING_MISSLYCKADES;
    } else if (left.length || openStamp.length) {
      rep.add('ÅTERSTÄLLNING', false, 'TESTPOSTER KVAR efter efterkontroll: ' + left.concat(openStamp.map((e) => 'instämpling ' + e.konto)).join(', ') + '. Kör: --stada=' + runId);
      exitCode = L.EXIT.STADNING_MISSLYCKADES;
    } else {
      rep.add('ÅTERSTÄLLNING', true, 'efterkontrollerat: inga testposter kvar' + (uncertain.length ? ' (journalposter utan bekräftande svar men frånvarande i efterkontrollen: ' + uncertain.join(', ') + ')' : ''));
    }
    if (after && before) {
      const changed = compare(before, after);
      rep.add('AFFÄRSPOSTER', changed.length === 0 ? true : false, changed.length ? 'EJ GODKÄNT: befintliga poster ändrade under körningen (automatik vid inloggning, annan användare eller testet — granska): ' + changed.slice(0, 20).join(', ') + (diffs.length ? ' | fält: ' + diffs.join(' | ') : '') : 'befintliga register-element, AO (inkl. updatedAt) och tidposter identiska med ögonblicksbilden före');
      if (changed.length && exitCode === L.EXIT.OK) exitCode = L.EXIT.OSAKER;
    } else if (before) rep.add('AFFÄRSPOSTER', false, 'EJ GODKÄNT: kunde inte jämföras — efterkontroll saknas');
    rep.add('DATABASIDENTITET', null, 'INTE fullständig (förväntat). Kvar som metadata: ' + metadataReport(before, after).join(' · '));
    if (aborted && exitCode === L.EXIT.OK) exitCode = L.EXIT.AVBRUTEN;
    if (exitCode === L.EXIT.OK && rep.results.some((r) => r.ok === false)) exitCode = L.EXIT.AVVIKELSE;
    if (exitCode === L.EXIT.STADNING_MISSLYCKADES) writeLock('testposter kvar eller efterkontroll saknas'); else if (after && !left.length && !openStamp.length) removeLock();
    return { exitCode, left, after, journalFile };
  }

  return { isTest, note, saveJournal, loadJournal, snapshot, trySnapshot, attempt, cleanupFromJournal, cleanupByScan, leftovers, compare, finish, writeLock, removeLock, journalFile, lockFile, get journal() { return journal; } };
}

module.exports = { createRecovery, assertNoOpenLocks, openLocks, TEST_PREFIX };
