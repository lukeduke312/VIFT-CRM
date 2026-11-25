'use strict';
/*
 * T3-D (2026-11-28): paritet (SEC-SIM-01) för vift-v2:s kopia av den simulerade servern
 * (tests/e2e/fake-backend.js, som staging_e2e_real använder). Samma ramverk och scenarier som
 * VIFT-CRM/tests/sim_parity.test.js (tests/local/lib/paritet.js), inklusive T3-B-, T3-C- och
 * T3-D-scenarierna. Kopian ska ge samma utfall som den faktiska serverkoden; de enda kända
 * avvikelserna är desamma som i VIFT-CRM:s lista (tests/e2e/paritet-kanda-avvikelser.json):
 * KEY-01 och AUTH-02 (felkodsformat utanför T3).
 */
const path = require('path');
const { ok, krav, avsluta } = require('./local/lib/test');
krav({ tsc: true });
const { korParitet } = require('./local/lib/paritet');
const KANDA = ['KEY-01', 'AUTH-02'];
korParitet({ fakeBackend: path.join(__dirname, 'e2e', 'fake-backend.js') }).then((res) => {
  for (const x of res) {
    if (KANDA.includes(x.id)) ok(!x.lika, `${x.id}: känd avvikelse (felkodsformat, utanför T3) finns kvar`, x);
    else ok(x.lika, `${x.id} (${x.sec}, ${x.anv} → ${x.ef}): samma utfall i replik och vift-v2:s fake-kopia`, { replik: x.replik, fake: x.fake });
  }
  const t3d = res.filter((x) => /^(B4|TASK|KUND|B3|OFF|REST-(falt|ekonomi))/.test(x.id) && x.id !== 'TASK-01' || /^TASK-0[1-6]|^TASK-DEL|^TASK-03b/.test(x.id));
  ok(t3d.length >= 50 && t3d.every((x) => x.lika), `T3-D-scenarierna (${t3d.length}) är lika`);
  console.log(`\nParitet (vift-v2-kopian): ${res.filter((x) => x.lika).length}/${res.length} lika.`);
  avsluta();
}, (e) => { ok(false, 'krasch: ' + (e && e.stack || e)); avsluta(); });
