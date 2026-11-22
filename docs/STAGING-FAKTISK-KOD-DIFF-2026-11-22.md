# VIFT CRM – FAKTISK STAGING-diff (läsande verifiering)

**Datum:** 2026-11-22. **Miljö:** Supabase STAGING `yyzljlqyzzcbxmcdbual`. **Repo:** `lukeduke312/VIFT-CRM`, branch `claude/vift-system-restructure-8fUme`.

**Detta är direktläst från installerade Supabase Edge Functions och databaskatalog, inte en sammanfattning ur en chatt.** Ingen STAGING- eller LIVE-ändring utförd. Ingen credential, API-nyckel eller cron-kommandosträng ingår. Koden nedan är en fullständig radbaserad diff av källfilerna (riktning **installerad STAGING → befintlig GitHub-branch**). GitHub-filen tillsammans med diffen möjliggör exakt källjämförelse; inga manuellt gissade rader.

## Blockerande upptäckt: service-monitor

- **STAGING installerad v15** använder `supabase.rpc('work_order_create', ...)` med `p_idempotency_key: 'service-monitor-...'` och skriver **inte** tillbaka hela `vift_workOrders` i batch. RPC `public.work_order_create(p_ao jsonb, p_idempotency_key text, p_client_id text)` finns i STAGING.
- **GitHub-filens nuvarande kod** använder `workOrders.push(ao)` och `workOrdersChanged` + efterföljande batchupsert av `vift_workOrders`. Det är en tillbakagång till den tidigare osäkra last-writer-wins-vägen.
- **NO-GO** för att ersätta deployad v15 med GitHub-versionen. Bevara v15:s atomiska AO-skapande och idempotens vid varje integration.

## Tidposter och RLS

- `time-entries-list` är redan installerad som **v3** med GET **och POST**. Ny GitHub-variant tar enbart GET och tillför en in-memory rate limit 60/min. Behåll POST-kompatibilitet tills samtliga anropare är verifierade; överväg rate limit separat utifrån verklig poll-belastning.
- Installerad policy `store_timeentries_no_direct_select`: RESTRICTIVE SELECT TO authenticated USING `key <> 'vift_timeEntries'`. Den fyller redan syftet för föreslagen `store_timeentries_read_lockdown` – skapa **inte** duplicerad policy.
- Installerad policy `store_workorders_no_direct_select`: RESTRICTIVE SELECT TO authenticated USING `key <> 'vift_workOrders'`.
- STAGING `service-monitor` v15 är installerad, men dagliga cron-jobbet finns med `active=false`. Aktivera inte utan separat GO och validering.
- `workorder-images`-bucket finns **inte** ännu i STAGING; den kräver separat säker installation med kontrollerad DELETE-väg före bildfunktionstest.

## Effektivt databasläge – direktverifierat

### RLS-policyer

```json
[
  {
    "policyname": "store_timeentries_no_direct_select",
    "permissive": "RESTRICTIVE",
    "roles": "{authenticated}",
    "cmd": "SELECT",
    "qual": "(key <> 'vift_timeEntries'::text)",
    "with_check": null
  },
  {
    "policyname": "store_workorders_no_direct_select",
    "permissive": "RESTRICTIVE",
    "roles": "{authenticated}",
    "cmd": "SELECT",
    "qual": "(key <> 'vift_workOrders'::text)",
    "with_check": null
  }
]
```

### Cron (hemligt kommando avsiktligt utelämnat)

```json
[
  {
    "jobid": 1,
    "jobname": "vift-service-monitor-daily",
    "schedule": "0 6 * * *",
    "active": false,
    "invokes_service_monitor": true
  }
]
```

### Atomisk AO-RPC (endast signatur)

```json
[
  {
    "proname": "work_order_create",
    "args": "p_ao jsonb, p_idempotency_key text, p_client_id text"
  }
]
```

### Storage buckets (inga filer eller kunddata)

```json
[
  {
    "name": "offer-attachments",
    "public": false,
    "file_size_limit": 52428800
  }
]
```

## Fullständig exakt källdiff – installerad STAGING → GitHub

OBS: Dessa diffar innehåller endast källkod, inga projekt-/användarhemligheter eller faktiska affärsregister. För `time-entries-list` kommer _shared/vift-auth.ts_ från just den deployade funktionens bundle.

### `supabase/functions/time-entries-list/index.ts`

- Installerad EF: `time-entries-list`, v3, bundle-SHA256 `b130b128432d008e19176a8dd2b852359a4819e5355b525baccd251247fba2ee`.
- Installerad fil `functions/time-entries-list/index.ts`, 79 rader.
- GitHub blob SHA `e9deae90f31eacfbbda78f9a7d19b208ae6c01dc`, 134 rader. Ändringar: +90 / -35.
- **Diffens riktning:** STAGING → GitHub, inte en föreslagen deploy-patch.

```diff
--- STAGING-deployed/supabase/functions/time-entries-list/index.ts
+++ Github-current/supabase/functions/time-entries-list/index.ts
@@ -1,25 +1,39 @@
 /**
  * time-entries-list — Supabase Edge Function
- * (P0 FINAL INTEGRATION — STAFF/PAYROLL R1 — BLOCKER-1 fix)
+ * (BLOCKER-1, server-side half — see docs/PROJECT_STATUS.md)
  *
- * The ONLY read path for `vift_timeEntries` left standing once
- * 20261018000007_timeentries_payroll_read_lockdown.sql blocks direct
- * authenticated SELECT on that key (see its header for the full
- * rationale). Filters server-side, so a curious/malicious authenticated
- * user cannot see this by calling the REST API directly with their own
- * JWT, bypassing the app's UI entirely — the leak this closes was never
- * a UI problem.
+ * The ONLY path left (after the companion migration
+ * 20261120000002_PROPOSAL_timeentries_read_lockdown.sql, which blocks
+ * direct `authenticated` REST reads of the `vift_timeEntries` key) for
+ * a logged-in client to read time entries. Does the real,
+ * server-side permission filtering BEFORE any data leaves the server —
+ * not a client-side filter on data already sent in full (that weaker
+ * mitigation already existed in `state.js`'s `_applyTimeEntriesPayrollFilter()`,
+ * same session, commit a0d02e3; this function is the deeper fix the
+ * data-flow review asked for).
  *
- * Without `payroll_view` (or `all`): returns ONLY the caller's own
- * entries (matched by staffId), with `hourRate` additionally stripped
- * from every entry that is not their own (defense in depth — even a
- * caller's own entries keep their own rate, since staff legitimately
- * see their own pay-relevant data elsewhere in the app, e.g. TimePage).
- * With `payroll_view`/`all`: returns everything, unfiltered — same data
- * DataSync already showed those users.
+ * Reuses the SAME established pattern as every other authenticated EF
+ * in this repo (see work-order-checklist-resolve/index.ts):
+ *   authenticated client -> this Edge Function -> service_role read.
  *
- * GET/POST /functions/v1/time-entries-list
- * 200: { timeEntries: [...] }
+ * This function does NOT accept or trust any client-supplied staff id
+ * or permission claim. Everything security-relevant is derived
+ * server-side from the verified JWT via the shared `checkViftAuth()`:
+ *   - `perms`       -> payroll_view (or `all`) sees every entry;
+ *                      everyone else sees ONLY their own.
+ *   - `staffMember` -> supplies the caller's OWN id for the "own
+ *                      entries" filter — never read from the request.
+ *
+ * GET /functions/v1/time-entries-list
+ * Headers: Authorization: Bearer <supabase-jwt>
+ * No query params, no body — a plain authenticated read.
+ *
+ * 200: { timeEntries: TimeEntry[] }
+ * 401: { error: 'unauthorized' }   — missing/invalid JWT
+ * 403: { error: 'forbidden' }      — valid JWT, but not an active VIFT user
+ * 405: { error: 'method_not_allowed' }
+ * 429: { error: 'rate_limited' }
+ * 500: { error: 'read_failed' }
  */
 
 import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts'
@@ -32,7 +46,7 @@
 const CORS = {
   'Access-Control-Allow-Origin':  '*',
   'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
-  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
+  'Access-Control-Allow-Methods': 'GET, OPTIONS',
   'Cache-Control':                'no-store, no-cache',
   'Referrer-Policy':              'no-referrer',
   'X-Content-Type-Options':       'nosniff',
@@ -43,13 +57,32 @@
   return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
 }
 
+/* Enkel in-memory rate-limit per anropande staff-id — detta är INTE en
+   publik endpoint (kräver redan en giltig JWT + aktiv app_users-rad),
+   men en lätt gräns skyddar ändå mot en trasig klient som råkar polla
+   i en tajt loop. Samma etablerade mönster som offer-token-validate. */
+const _rateMap = new Map<string, { count: number; windowStart: number }>()
+const RATE_WINDOW_MS  = 60_000
+const RATE_MAX        = 60
+
+function checkRateLimit(key: string): boolean {
+  const now  = Date.now()
+  const slot = _rateMap.get(key)
+  if (!slot || now - slot.windowStart > RATE_WINDOW_MS) {
+    _rateMap.set(key, { count: 1, windowStart: now })
+    return true
+  }
+  slot.count++
+  return slot.count <= RATE_MAX
+}
+
 serve(async (req: Request) => {
   if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
-  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
+  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)
 
   const authHeader = req.headers.get('authorization') || ''
   const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
-  if (!jwt) return json({ error: 'forbidden' }, 403)
+  if (!jwt) return json({ error: 'unauthorized' }, 401)
 
   const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
 
@@ -57,23 +90,45 @@
   if (!auth.ok) return auth.response
   const { perms, staffMember } = auth
 
-  const { data: row, error } = await supabase.from('store').select('value').eq('key', 'vift_timeEntries').maybeSingle()
-  if (error) {
-    console.error('[time-entries-list] store-läsfel:', error.message)
-    return json({ error: 'read_failed' }, 500)
-  }
-  const all: Record<string, unknown>[] = Array.isArray(row?.value) ? row!.value as Record<string, unknown>[] : []
+  const sm = staffMember as Record<string, unknown>
+  const callerStaffId = String(sm?.id ?? '')
 
-  if (hasPerm(perms, 'payroll_view')) {
-    return json({ timeEntries: all })
+  if (!checkRateLimit(callerStaffId || 'unknown')) {
+    return json({ error: 'rate_limited' }, 429)
   }
 
-  const sm = staffMember as Record<string, unknown>
-  const myStaffId = String(sm?.id ?? '')
-  const filtered = all
-    .filter(e => e.staffId === myStaffId)
-  // Egna poster: fullständigt oförändrade (inkl. hourRate — personal ser
-  // redan sitt eget timpris i TimePage/löneunderlaget idag).
+  try {
+    /* service_role-läsning — denna funktion ÄR den avsedda vägen förbi
+       den nya RESTRICTIVE policyn (migration 20261120000002), exakt
+       som varje annan EF i detta repo redan använder service_role för
+       sin egna, auktoriserade åtkomst. */
+    const { data: row, error: readErr } = await supabase
+      .from('store')
+      .select('value')
+      .eq('key', 'vift_timeEntries')
+      .maybeSingle()
 
-  return json({ timeEntries: filtered })
+    if (readErr) {
+      console.error('[time-entries-list] store-läsfel:', readErr.message)
+      return json({ error: 'read_failed' }, 500)
+    }
+
+    const allEntries: Record<string, unknown>[] =
+      Array.isArray(row?.value) ? (row.value as Record<string, unknown>[]) : []
+
+    /* Samma regel som Auth.can('payroll_view') på klienten (och samma
+       som _applyTimeEntriesPayrollFilter() i state.js) — men detta är
+       den FAKTISKA, auktoritativa kontrollen: ingen tidpost för någon
+       annan än den anropande personen lämnar servern alls, om inte
+       payroll_view (eller 'all') är beviljad. */
+    const canViewAll = hasPerm(perms, 'payroll_view') || hasPerm(perms, 'all')
+    const timeEntries = canViewAll
+      ? allEntries
+      : allEntries.filter((e) => String(e.staffId ?? '') === callerStaffId)
+
+    return json({ timeEntries })
+  } catch (e: unknown) {
+    console.error('[time-entries-list] oväntat fel:', e)
+    return json({ error: 'read_failed' }, 500)
+  }
 })
```

### `supabase/functions/_shared/vift-auth.ts`

- Installerad EF: `time-entries-list`, v3, bundle-SHA256 `b130b128432d008e19176a8dd2b852359a4819e5355b525baccd251247fba2ee`.
- Installerad fil `functions/_shared/vift-auth.ts`, 108 rader.
- GitHub blob SHA `d9347499d88328a93398d783e76f3d585cda9a30`, 143 rader. Ändringar: +35 / -0.
- **Diffens riktning:** STAGING → GitHub, inte en föreslagen deploy-patch.

```diff
--- STAGING-deployed/supabase/functions/_shared/vift-auth.ts
+++ Github-current/supabase/functions/_shared/vift-auth.ts
@@ -106,3 +106,38 @@
 export function hasPerm(perms: string[], perm: string): boolean {
   return perms.includes('all') || perms.includes(perm)
 }
+
+/**
+ * Kanonisk AO-synlighetsregel, delad mellan work-order-image-url och
+ * work-order-image-upload (och källverifierad mot SAMMA regel som redan
+ * används av WorkOrdersPage/Dashboard.js på klienten och av
+ * work_order_checklist_resolve()-RPC:n på servern):
+ *   ao_view_all ELLER 'all' -> ser allt.
+ *   annars: ao_view_own OCH (anroparens staff-id finns i ao.staff[]
+ *           ELLER ao.status === 'pool').
+ * Fail-closed: en okänd/tom callerStaffId ger aldrig åtkomst via
+ * ao_view_own-grenen.
+ */
+export function canViewWorkOrder(
+  ao: { staff?: unknown; status?: unknown } | undefined | null,
+  perms: string[],
+  callerStaffId: string
+): boolean {
+  if (!ao) return false
+  if (hasPerm(perms, 'ao_view_all') || hasPerm(perms, 'all')) return true
+  if (!hasPerm(perms, 'ao_view_own') || !callerStaffId) return false
+  const assignedStaff = Array.isArray(ao.staff) ? (ao.staff as unknown[]).map(String) : []
+  return assignedStaff.includes(callerStaffId) || ao.status === 'pool'
+}
+
+/**
+ * Säkerställer att en Storage-path verkligen ligger under den angivna
+ * arbetsorderns eget "<aoId>/"-prefix — förhindrar att en anropare som är
+ * behörig för EN arbetsorder skickar in en ANNAN arbetsorders path under
+ * täckmantel av den förstnämndas aoId.
+ */
+export function isPathUnderAo(path: string, aoId: string): boolean {
+  if (!path || typeof path !== 'string') return false
+  if (path.includes('..') || path.includes('//') || path.startsWith('/')) return false
+  return path.startsWith(aoId + '/')
+}
```

### `supabase/functions/service-monitor/index.ts`

- Installerad EF: `service-monitor`, v15, bundle-SHA256 `af339150e611a7ee9488cd7af55c09ab2175385ec25adb9758b4db82188b2f21`.
- Installerad fil `service-monitor/index.ts`, 543 rader.
- GitHub blob SHA `2343894c681288d8958de852daec43969b7c59b4`, 503 rader. Ändringar: +17 / -57.
- **Diffens riktning:** STAGING → GitHub, inte en föreslagen deploy-patch.

```diff
--- STAGING-deployed/supabase/functions/service-monitor/index.ts
+++ Github-current/supabase/functions/service-monitor/index.ts
@@ -206,6 +206,7 @@
 
     /* ── Bearbeta serviceintervall ───────────────────────── */
     let propertiesChanged = false
+    let workOrdersChanged = false
 
     for (const prop of properties) {
       if (!Array.isArray(prop.serviceIntervals)) continue
@@ -285,64 +286,28 @@
           const shouldCreate = daysLeft !== null && daysLeft <= threshold
 
           if (shouldCreate) {
-            /* P0 AO/TID-FIX (2026-10-18): tidigare pushade denna gren en
-               ny AO direkt in i en lokal `workOrders`-array som LÄSTS EN
-               GÅNG i funktionens början, och skrev HELA den arrayen
-               tillbaka i EN batchad upsert i slutet av körningen (se
-               nedan) — exakt samma "läs hela, mutera, skriv hela"-race
-               som state.js _doPersist() hade för klienten. Denna
-               dagliga cron-körning kan iterera över MÅNGA fastigheter/
-               serviceintervall och därmed ta flera sekunder — om NÅGON
-               användare skapade/ändrade en AO (via den nya atomiska
-               vägen) mellan denna funktions LÄSNING och dess SKRIVNING,
-               skulle den batchade upserten TYST SKRIVA ÖVER den
-               användar-AO:n (en riktig, verifierad instans av exakt den
-               klass av bugg detta P0-uppdrag ska lösa — bara server-
-               sidig, inte klient-sidig).
-               Fix: varje ny AO skapas nu DIREKT via den atomiska,
-               radlåsta work_order_create-RPC:n (samma som klienten
-               använder) — ALDRIG via den batchade workOrders-upserten,
-               som denna fil inte längre gör alls (se workOrdersChanged
-               nedan, borttagen). Idempotensnyckeln är DETERMINISTISK
-               (si.id + periodKey) — en omkörning av SAMMA dags cron-
-               jobb (t.ex. manuell retriggning efter ett partiellt fel)
-               kan därför aldrig skapa en dubblett-AO för samma
-               serviceintervall/förfallodatum. */
-            const aoDraft = buildWorkOrder(si, prop)
-            const { data: createResult, error: createErr } = await supabase.rpc('work_order_create', {
-              p_ao: aoDraft,
-              p_idempotency_key: `service-monitor-${si.id}-${periodKey}`,
-              p_client_id: null
-            })
-            if (createErr) {
-              errors.push(`AO-skapande misslyckades för serviceintervall ${si.id}: ${createErr.message}`)
-            } else {
-              const createdAo = (createResult as { workOrder: WorkOrder }).workOrder
-              si.lastAOGeneratedForDueDate = periodKey
-              si.lastGeneratedAOId         = createdAo.id
-              si.updatedAt                 = new Date().toISOString()
-              propertiesChanged = true
-              aoCreated++
-              aoIds.push(createdAo.id)
-            }
+            const ao = buildWorkOrder(si, prop, workOrders)
+            workOrders.push(ao)
+            si.lastAOGeneratedForDueDate = periodKey
+            si.lastGeneratedAOId         = ao.id
+            si.updatedAt                 = new Date().toISOString()
+            propertiesChanged = true
+            workOrdersChanged = true
+            aoCreated++
+            aoIds.push(ao.id)
           }
         }
       }
     }
 
     /* ── Skriv tillbaka ändrade blobs ────────────────────── */
-    /* P0 AO/TID-FIX: `vift_workOrders` ingår MEDVETET INTE här längre —
-       varje ny AO är redan atomiskt skapad via work_order_create ovan,
-       i egen transaktion, INNAN vi når hit. En batchad upsert av HELA
-       workOrders-arrayen här (ovanpå det som RPC-anropen redan skrivit)
-       vore exakt den typ av efterföljande, omedveten "skriv över med min
-       potentiellt inaktuella kopia"-skrivning detta P0-uppdrag finns för
-       att eliminera — även om DENNA funktions egen `workOrders`-variabel
-       bara lästes en gång och aldrig muterades i denna version. */
     const upserts: { key: string; value: unknown }[] = []
     if (propertiesChanged) {
       upserts.push({ key: STORE_PREFIX + 'properties', value: properties })
     }
+    if (workOrdersChanged) {
+      upserts.push({ key: STORE_PREFIX + 'workOrders', value: workOrders })
+    }
 
     if (upserts.length > 0) {
       const { error: writeErr } = await supabase
@@ -464,20 +429,15 @@
 
 /*
  * Bygg ett AO-objekt som matchar WorkOrderService.create()-schemat.
- * P0 AO/TID-FIX (2026-10-18): `id` TAS INTE LÄNGRE FRAM HÄR — den
- * atomiska work_order_create-RPC:n (anropad av serve()-handlern ovan)
- * tilldelar nu det kanoniska, kollisionskontrollerade id:t server-sidigt
- * (samma sequence-baserade mekanism som klientens egna nya AO:er utan
- * ett eget synkront id-behov använder — se migrationens kommentar).
- * `nextWorkOrderId()` nedan är DÄRFÖR DÖD KOD efter denna fix — kvar
- * MEDVETET (inte borttagen) ifall en framtida återgång till den gamla
- * vägen skulle behöva den, men anropas inte längre någonstans.
+ * Replikerar newId-logiken från state.js.
  */
-function buildWorkOrder(si: ServiceInterval, prop: Property): Omit<WorkOrder, 'id'> {
+function buildWorkOrder(si: ServiceInterval, prop: Property, workOrders: WorkOrder[]): WorkOrder {
+  const id    = nextWorkOrderId(workOrders)
   const now   = new Date().toISOString()
   const title = si.aoTitle || si.title
 
   return {
+    id,
     title,
     description:      si.aoDescription || si.description || '',
     status:           'pool',
```

## Instruktion för Claude

1. Läs denna fil direkt i befintliga utvecklingsbranchen och jämför mot den lokala koden. Inga Supabase-tokens eller nedladdningar behövs från Lucas.
2. Använd **faktiskt installerad v15** som bevarande-bas för `service-monitor`. Återskapa aldrig gammal bulk-upsert av `vift_workOrders` eller icke-atomiskt AO-skapande.
3. Ändra/uppgradera `time-entries-list` endast efter kontroll av anropare och värdet av ändringen. Befintlig SELECT-RLS ska bevaras; applicera inte en dubblett-migration.
4. Förbered säker `workorder-images`-installation inkl. serverkontrollerad DELETE och fungerande ordning mellan loggpost och Storage-fil.
5. Lämna installerat offertflöde, STAGING, LIVE och cron oförändrade tills separat uttryckligt GO. Planera rollback och verifiera med funktions- och rolltester.

**Status:** Läskontroll och kodjämförelse genomförd. Detta dokument är underlag, inte installationsgodkännande.
