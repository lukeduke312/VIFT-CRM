'use strict';
/* T3-C (2026-11-28): skrivbehörighet per nyckel UTLÄST UR DEN FAKTISKA SERVERKÄLLAN
   (KÄLLA-1: vift-v2/supabase/functions/store-key-write/index.ts, KEY_PERMISSIONS) — ingen
   kopia och ingen modell. Samma tabell som _staging_business_key_required_perm() i SQL
   (kontrolleras av vift-v2 tests/replica_build och paritetstestet). Nyckel som saknas här
   nekas av servern (400 key_not_allowlisted). Används av PERM-03 och paritetsscenariet KEY-02. */
const fs = require('fs');
const { serverPath } = require('../lib/serverkalla');

const fil = serverPath('functions', 'store-key-write', 'index.ts');
const src = fs.readFileSync(fil, 'utf8');
const m = /const KEY_PERMISSIONS: Record<string, string> = \{([\s\S]*?)\n\}/.exec(src);
if (!m) throw new Error('KEY_PERMISSIONS hittades inte i ' + fil);
const tabell = {};
m[1].replace(/^\s*(vift_\w+)\s*:\s*'([a-z_]+)'\s*,?\s*$/gm, (_, k, p) => { tabell[k] = p; return ''; });
if (Object.keys(tabell).length < 20) throw new Error('KEY_PERMISSIONS kunde inte läsas ur ' + fil + ' (' + Object.keys(tabell).length + ' nycklar)');
module.exports = Object.freeze(tabell);
