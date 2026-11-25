'use strict';
/*
 * KÄLLA-1 (BESLUT-2026-11-28): den enda auktoritativa serverkoden är vift-v2/supabase
 * (lukeduke312/VIFT-CRM, gren claude/vift-system-restructure-8fUme, katalog supabase/).
 * Klientgrenen har ingen egen serverkopia längre. Tester som läser migrationer eller
 * Edge Function-källor hämtar dem härifrån.
 *
 *   VIFT_SERVER_ROOT  sökvägen till katalogen supabase/ i server-arbetskopian
 *                     (standard /home/user/vift-v2/supabase)
 *
 * Saknas källan avbryts testet med ett tydligt FEL (exit 1). Det hoppas inte över
 * tyst, eftersom ett test utan sin källa inte har prövat något.
 */
const fs = require('fs');
const path = require('path');

const STANDARD = '/home/user/vift-v2/supabase';

function serverRoot() {
  const rot = process.env.VIFT_SERVER_ROOT || STANDARD;
  const saknas = ['migrations', 'functions', 'MIGRATIONSORDNING.txt'].filter((x) => !fs.existsSync(path.join(rot, x)));
  if (saknas.length) {
    console.log('FAIL serverkällan saknas: ' + rot + ' (saknar ' + saknas.join(', ') + ').');
    console.log('     Sätt VIFT_SERVER_ROOT till katalogen supabase/ i en arbetskopia av lukeduke312/VIFT-CRM,');
    console.log('     gren claude/vift-system-restructure-8fUme (se supabase/README.md). Testet hoppas INTE över.');
    console.log('RESULT: 0 passed, 1 failed (serverkälla saknas)');
    process.exit(1);
  }
  return rot;
}
const serverPath = (...delar) => path.join(serverRoot(), ...delar);

module.exports = { serverRoot, serverPath, STANDARD };
