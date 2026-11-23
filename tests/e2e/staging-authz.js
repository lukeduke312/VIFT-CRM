'use strict';
/*
 * ERSATT 2026-11-23 — kör inte.
 *
 * Tidigare beskrevs detta verktyg som "ändrar inga data" utan
 * --med-testdata. Det stämde inte: en tillåten writeMerge (även utan
 * faktisk post) uppdaterar store.updated_at och vift_lastChanged, och
 * G9-kontrollen gjorde en no-op-patch på en BEFINTLIG AO, vilket kan
 * uppdatera AO:ns updatedAt och synksignaturen (installerade
 * store_business_key_merge_write / work_order_patch i STAGING).
 *
 * Ersatt av (se tests/staging/lib.js för nivåerna):
 *   Nivå 0  tests/e2e/staging-readonly.js     oinloggad, inga skrivningar
 *   Nivå 1  tests/staging/authz-read.js       inloggad läsning (auth-poster skrivs)
 *   Nivå 2  tests/staging/authz-mutation.js   mutationstest med märkta testposter,
 *                                             före/efter-verifiering och städning
 */
console.error('staging-authz.js är ersatt (anrop kunde ändra data). Använd tests/staging/authz-read.js (nivå 1) eller tests/staging/authz-mutation.js (nivå 2). Inga anrop gjorda.');
process.exit(2);
