#!/usr/bin/env node
/*
 * Miljöskydd för produktionsrepot (CLAUDE.md, absoluta regler):
 *   - STAGING:s project ref och domän får aldrig finnas i produktionsfrontend.
 *   - Service role key får aldrig finnas i frontend.
 *   - storage.js ska peka på LIVE-projektet.
 * Körs mot alla filer index.html faktiskt laddar + index.html, service-worker.js,
 * manifest.json och config.js.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { check, section, done } = require('./lib/harness');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const html = read('index.html');
const scripts = [...html.matchAll(/<script[^>]+src="([^"?]+)/g)].map((m) => m[1]);
const styles = [...html.matchAll(/<link[^>]+href="([^"?]+\.css)/g)].map((m) => m[1]);
const files = ['index.html', 'public-offer.html', 'service-worker.js', 'manifest.json', 'config.js', ...scripts, ...styles]
  .map((p) => p.replace(/^\//, ''))
  .filter((p) => fs.existsSync(path.join(ROOT, p)));

section('Frontendfiler som granskas');
check('index.html laddar minst 60 skript', scripts.length >= 60, scripts.length + ' skript');

const FORBIDDEN = [
  ['STAGING project ref', /yyzljlqyzzcbxmcdbual/],
  ['STAGING-domän', /staging-crm\.viftfast\.se/],
  ['STAGING anon key', /sb_publishable_PaVoz/],
  ['service_role-JWT/nyckel', /service_role["']?\s*[:=]\s*["']ey|sb_secret_/],
];

section('Förbjudna identifierare i produktionsfrontend');
for (const [label, re] of FORBIDDEN) {
  const hits = files.filter((f) => re.test(read(f)));
  check(label + ' förekommer inte', hits.length === 0, hits.join(', '));
}

section('storage.js pekar på LIVE');
const storage = read('src/data/storage.js');
check("SUPABASE_URL = LIVE (hjplzjsbbowiyoyhdghc)", /const SUPABASE_URL\s*=\s*'https:\/\/hjplzjsbbowiyoyhdghc\.supabase\.co'/.test(storage));

section('Alla laddade skript finns');
const missing = scripts.map((p) => p.replace(/^\//, '')).filter((p) => !fs.existsSync(path.join(ROOT, p)));
check('inga saknade skriptfiler', missing.length === 0, missing.join(', '));

done();
