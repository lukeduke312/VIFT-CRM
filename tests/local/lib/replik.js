'use strict';
/*
 * T3-0: lokal, reproducerbar STAGING-replik (SAKERHETSPROVNING-TESTPLAN §3.2).
 *
 *   const r = byggReplik({ namn?, utelamna?: [rel...], stagingOnly?: bool, stagingBaslinje?: bool, schemakontroll?: bool, data?: bool })
 *   stagingBaslinje: utan de NYA migrationerna (T3-B m.fl., version efter STAGING:s senaste).
 *   r.db, r.U (användare per alias), r.data, r.rapport (schemajämförelse), r.stang()
 *
 * Bygger en egen databas i den lokala PostgreSQL:en:
 *   1. tests/local/supabase-stubbar.sql (roller anon/authenticated/service_role, auth, storage),
 *   2. migrationskedjan i supabase/MIGRATIONSORDNING.txt (STAGING-ordning + R-A–R-E),
 *      valfritt med de STAGING-only-migrationer som installerats i STAGING (på sin plats),
 *   3. schemajämförelse mot STAGING-facit (tests/local/jamfor-schema.js): 0 oförklarade krävs,
 *   4. syntetiska data (lib/data.js): auth.users, app_users, store, property_sensitive_access.
 * Ingen trafik till Supabase. Databasen tas bort med r.stang() (och vid processens slut).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { psql, psqlFile, lit, jlit, createDb, dropDb, assertLocal } = require('./db');
const { data } = require('./data');

const REPO = path.resolve(__dirname, '..', '..', '..');
const STAGING_SENASTE = '20261124211128';

function serverRot() {
  const r = process.env.VIFT_SERVER_ROOT || path.join(REPO, 'supabase');
  if (!fs.existsSync(path.join(r, 'MIGRATIONSORDNING.txt'))) throw new Error('Serverkällan saknas: ' + r + ' (VIFT_SERVER_ROOT)');
  return r;
}

/* Ordningen ur MIGRATIONSORDNING.txt. Med stagingOnly tas även de utkommenterade
   STAGING-only-raderna med (de som har en sökväg under staging-only/). */
function ordning(rot, stagingOnly) {
  return fs.readFileSync(path.join(rot, 'MIGRATIONSORDNING.txt'), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => {
      const m = /^(#\s*)?(\d{14}|REKONSTRUKTION)\s+(\S+)/.exec(l);
      if (!m) return null;
      if (m[1] && !(stagingOnly && m[3].startsWith('staging-only/'))) return null;
      // T3-B: aktiva rader med version efter STAGING:s senaste (20261124211128) är NYA
      // ändringar som inte är installerade i STAGING (klass "ny" i MIG-1).
      return { version: m[2], rel: m[3], stagingOnly: !!m[1], ny: !m[1] && /^\d{14}$/.test(m[2]) && m[2] > STAGING_SENASTE };
    }).filter(Boolean);
}

function korKedja(db, rot, opts) {
  opts = opts || {};
  psqlFile(db, path.join(REPO, 'tests', 'local', 'supabase-stubbar.sql'));
  psql('postgres', `alter database ${db} set search_path = "$user", public, extensions`);
  // opts.stagingBaslinje: bara det som är installerat i STAGING (utan nya T3-migrationer).
  const steg = ordning(rot, opts.stagingOnly).filter((s) => !(opts.utelamna || []).includes(s.rel) && !(opts.stagingBaslinje && s.ny));
  for (const s of steg) {
    try { psqlFile(db, path.join(rot, s.rel)); } catch (e) { throw new Error('migrationen ' + s.rel + ' fallerade: ' + e.message); }
  }
  return steg;
}

function schemakontroll(db) {
  const ut = path.join(require('os').tmpdir(), 'vift-replik-schema-' + db + '.json');
  let kod = 0, text = '';
  try { text = execFileSync('node', [path.join(REPO, 'tests', 'local', 'jamfor-schema.js'), db, ut], { encoding: 'utf8', env: process.env }); }
  catch (e) { kod = e.status || 1; text = String(e.stdout || '') + String(e.stderr || ''); }
  let rapport = null; try { rapport = JSON.parse(fs.readFileSync(ut, 'utf8')); fs.unlinkSync(ut); } catch (e) { /* ingen rapport */ }
  const m = /(\d+) identiska.*?(\d+) förklarade.*?(\d+) oförklarade/s.exec(text) || [];
  return { kod, text, rapport, identiska: Number(m[1]), forklarade: Number(m[2]), oforklarade: Number(m[3]) };
}

function laddaData(db) {
  const d = data();
  const sql = ['begin;'];
  for (const u of d.anvandare) {
    sql.push(`insert into auth.users(id, email) values (${lit(u.authId)}, ${lit(u.email)});`);
    sql.push(`insert into public.app_users(user_id, staff_id, role_id, active, is_admin, disabled_at) values (${lit(u.authId)}, ${lit(u.staffId)}, ${lit(u.role)}, ${u.appActive}, ${u.role === 'admin'}, ${u.appActive ? 'null' : 'now()'});`);
  }
  // En auth-användare utan app_users-rad (aldrig provisionerad) och en utan personalpost.
  sql.push(`insert into auth.users(id, email) values ('00000000-0000-4000-8000-0000000000f1', 'ejprovisionerad@example.test');`);
  sql.push(`insert into auth.users(id, email) values ('00000000-0000-4000-8000-0000000000f2', 'utanpersonal@example.test');`);
  sql.push(`insert into public.app_users(user_id, staff_id, role_id, active) values ('00000000-0000-4000-8000-0000000000f2', null, null, true);`);
  for (const [k, v] of Object.entries(d.store)) sql.push(`insert into public.store(key, value, updated_at) values (${lit(k)}, ${jlit(v)}, '2026-11-01T08:00:00Z') on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;`);
  for (const r of d.kansliga) {
    const kol = Object.keys(r);
    sql.push(`insert into public.property_sensitive_access(${kol.join(',')}, updated_by) values (${kol.map((c) => lit(r[c])).join(',')}, 'syntetisk');`);
  }
  sql.push('commit;');
  psql(db, sql.join('\n'));
  return d;
}

function byggReplik(opts) {
  opts = opts || {};
  assertLocal();
  const rot = opts.rot || serverRot();
  const db = createDb(opts.namn || ('vift_replik_' + process.pid + '_' + Math.random().toString(36).slice(2, 7)));
  let stangd = false;
  const stang = () => { if (!stangd) { stangd = true; if (!opts.behall) dropDb(db); } };
  process.on('exit', stang);
  try {
    const steg = korKedja(db, rot, opts);
    const rapport = opts.schemakontroll === false ? null : schemakontroll(db);
    const d = opts.data === false ? null : laddaData(db);
    return { db, rot, steg, rapport, data: d, U: d ? d.U : null, stang };
  } catch (e) { stang(); throw e; }
}

module.exports = { byggReplik, korKedja, ordning, schemakontroll, laddaData, serverRot, REPO, STAGING_SENASTE };
