'use strict';
/* Kartgruppering (Vasaplatsen 8): samma adress = en markör med antal;
   olika adresser grupperas aldrig ihop; nära olika platser sprids ut. */
const MapGrouping = require('../src/services/MapGrouping.js');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('PASS — ' + n); } else { failed++; console.log('FAIL — ' + n + (d ? ' ' + d : '')); } };
const it = (id, address, zip, city, lat, lng, extra) => ({ ao: Object.assign({ id, address, zip, city, status: 'planerad' }, extra || {}), coord: { lat, lng } });

// 1. Två AO på Vasaplatsen 8 → en grupp med 2
let g = MapGrouping.group([it('AO-1', 'Vasaplatsen 8', '411 34', 'Göteborg', 57.6990, 11.9700), it('AO-2', 'Vasaplatsen 8', '41134', 'Göteborg', 57.6990, 11.9700, { priority: 'akut' })]);
check('samma adress → en markör', g.length === 1 && g[0].count === 2);
check('akut framgår av gruppen', g[0].hasAkut === true);
// 2. Samma adress, olika skrivsätt (versaler, punkt, mellanslag)
g = MapGrouping.group([it('A', 'Vasaplatsen 8', '', 'Göteborg', 57.699, 11.97), it('B', 'vasaplatsen  8.', '', 'göteborg', 57.6990001, 11.9700001)]);
check('samma adress med annat skrivsätt → en grupp', g.length === 1 && g[0].count === 2);
// 3. Olika adresser med IDENTISKA koordinater (avrundad geokodning) → två grupper, utspridda
g = MapGrouping.group([it('A', 'Vasaplatsen 8', '', 'Göteborg', 57.699, 11.97), it('B', 'Vasaplatsen 10', '', 'Göteborg', 57.699, 11.97)]);
check('olika adresser grupperas aldrig ihop', g.length === 2 && g.every((x) => x.count === 1));
check('överlappande olika platser sprids ut', g[0].display.lat !== g[1].display.lat || g[0].display.lng !== g[1].display.lng);
// 4. Långt ifrån varandra → orörda
g = MapGrouping.group([it('A', 'Vasaplatsen 8', '', 'Göteborg', 57.699, 11.97), it('B', 'Drottninggatan 1', '', 'Stockholm', 59.33, 18.06)]);
check('avlägsna platser flyttas inte', g.every((x) => !x.spread && x.display.lat === x.coord.lat));
// 5. Utan adress: koordinater med 6 decimaler
g = MapGrouping.group([it('A', '', '', '', 57.69900, 11.97), it('B', '', '', '', 57.69905, 11.97)]);
check('utan adress: olika koordinater (6 dec) är olika platser', g.length === 2);
// 6. Räknare
const jobs = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
g = MapGrouping.group([it('A', 'Vasaplatsen 8', '', 'Göteborg', 57.699, 11.97), it('B', 'Vasaplatsen 8', '', 'Göteborg', 57.699, 11.97)]);
const c = MapGrouping.counts(jobs, g);
check('räknare: 3 jobb, 1 plats, 2 placerade, 1 ej placerad', c.jobs === 3 && c.places === 1 && c.placed === 2 && c.unplaced === 1, JSON.stringify(c));
// 7. Saknade koordinater ignoreras
g = MapGrouping.group([{ ao: { id: 'X' }, coord: null }, it('A', 'Vasaplatsen 8', '', 'Göteborg', 57.699, 11.97)]);
check('utan koordinat placeras inte', g.length === 1 && g[0].count === 1);
console.log('\nRESULT: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
