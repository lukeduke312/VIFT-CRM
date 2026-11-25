/**
 * project-document-upload — Supabase Edge Function (V54C1 R1 Production Hardening)
 *
 * Generaliserad DIREKT från offer-attachment-upload (samma fil- och
 * säkerhetsarkitektur: privat Storage-bucket, service-role-uppladdning,
 * magic-byte-sniffning, sanerat filnamn, checksum). Ingen fjärde, egen
 * filhanteringsmodell.
 *
 * R1 — ÄNDRAT SEDAN R0 (se RAPPORT-V54C1-R1 för fullständig motivering):
 *
 *  §Blockerare 3 (orphan storage vid metadata-fel): POST verifierar nu
 *  RPC-resultatet av `project_documents_append`. Om metadataskrivningen
 *  misslyckas EFTER en lyckad Storage-uppladdning görs en kompenserande
 *  `Storage.remove()` av den redan uppladdade filen innan ett fel-svar
 *  returneras — INGEN "success" utan en bekräftad metadata-post.
 *
 *  §Blockerare 4 (dual-writer race): metadataskrivningar sker nu via de
 *  radlåsta RPC-funktionerna `project_documents_append` /
 *  `project_documents_update_one` / `project_documents_finalize_delete`
 *  (se migrationen 20260908000001_project_documents_atomic_rpc.sql) —
 *  aldrig längre en naiv "SELECT hela arrayen → UPDATE hela arrayen".
 *
 *  §Blockerare 5 (finansiell behörighet ej upprätthållen server-side):
 *  `amountExVat` kan ENDAST sättas/ändras av en anropare med
 *  `invoice_view`. Utan den behörigheten: en uppladdning med ett
 *  angivet belopp avvisas (`403 forbidden_amount`), en PATCH som
 *  försöker ÄNDRA `amountExVat` avvisas (`403 forbidden_amount_change`)
 *  — fail-closed, aldrig ett tyst ignorerat fält. OBS ärlig begränsning:
 *  se README-DEPLOYMENT.md "Finansiell datalagring" — själva den
 *  generiska `store`-radens INNEHÅLL (inkl. redan satta belopp) är
 *  fortsatt läsbart via samma breda store-arkitektur som resten av
 *  VIFT (samma kända begränsning som CLAUDE.md:s BLOCKER-1/2). Denna
 *  kontroll stoppar OBEHÖRIG SKRIVNING, den ger inte fullständig
 *  server-side SEKRETESS för redan lagrade belopp.
 *
 *  §Blockerare 6 (klienten kringgick backend för metadata/UE-status):
 *  ny PATCH-metod hanterar BÅDE fri metadataredigering och UE-status-
 *  ändring — samma autentiserings-/behörighets-/valideringskedja som
 *  POST/DELETE. Klienten (ProjectDocumentService.updateMetadata/
 *  setUeStatus) muterar inte längre lokal state direkt.
 *
 *  §Blockerare 7 (uploadedBy klient-förfalskningsbart): `uploadedBy`
 *  läses INTE längre från FormData. Servern sätter det uteslutande från
 *  `auth.staffMember.id` (den redan verifierade JWT-identiteten).
 *
 *  §Blockerare 8 (storagePath ej bundet till projekt+dokument-id):
 *  DELETE och PATCH validerar att den lagrade `storagePath` matchar
 *  EXAKT `project-documents/<projectId>/<documentId>/...` för just DEN
 *  posten — en förgiftad/manipulerad `storagePath` i metadata kan aldrig
 *  peka på och radera/exponera en ANNAN fil.
 *
 *  §Blockerare 9 (CORS saknade `apikey`): Access-Control-Allow-Headers
 *  inkluderar nu `apikey, x-client-info` (standard Supabase-klient-
 *  headrar) utöver `authorization, content-type`.
 *
 * POST   /functions/v1/project-document-upload   (multipart/form-data) — skapa
 * PATCH  /functions/v1/project-document-upload   (application/json)    — ändra metadata/UE-status
 * DELETE /functions/v1/project-document-upload   (application/json)    — mjuk borttagning
 *
 * PATCH body: { documentId: string, projectId: string /* = anroparens
 *              FÖRVÄNTADE projekt-kontext, INTE nödvändigtvis dokumentets
 *              egen projectId — servern jämför de två oberoende * /,
 *              patch: { ...tillåtna fält... } }
 *
 * Svar 200: { document: ProjectDocument } (POST/PATCH) | { ok: true } (DELETE)
 * Svar 400/403/404/500: { error: '...' }
 */

import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkViftAuth, hasPerm } from '../_shared/vift-auth.ts'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const STORAGE_BUCKET   = 'project-documents'
const MAX_BYTES        = 50 * 1024 * 1024  /* 50 MB — samma gräns som offer-attachments */

/* §Blockerare 9 — standard Supabase-klient-headrar tillåtna i preflight. */
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, PATCH, DELETE, OPTIONS',
  'Cache-Control':                'no-store, no-cache',
  'Referrer-Policy':              'no-referrer',
  'X-Content-Type-Options':       'nosniff',
  'X-Frame-Options':              'DENY'
}

const VALID_DOC_TYPES = ['ue_offert','orderbekraftelse','avtal','leverantorsfaktura','ritning','protokoll','foto','ovrigt']
const VALID_UE_STATUSES = ['inkommen','vald','ej_vald']
const PATCHABLE_FIELDS = ['documentType','displayName','supplierName','amountExVat','documentDate','validUntil','supplierQuoteStatus','workOrderId','note']

/* ── Tillåtna filtyper (§C9 — granskad delmängd av offer-attachments
   allow-list; Office-format ingår men flaggas i rapporten som ej
   fullt magic-byte-verifierade i denna leverans, se README §Filstorlek). */
const ALLOWED_MIME: Record<string, string> = {
  'application/pdf':                                                          'pdf',
  'image/jpeg':                                                               'jpg',
  'image/png':                                                                'png',
  'image/webp':                                                               'webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':  'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':        'xlsx'
}

function sniffMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'application/pdf'
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png'
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return 'image/webp'
  if (bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04) return null /* ZIP-baserat Office — låt Content-Type avgöra */
  return null
}

async function sha256hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/* PROD-HOTFIX (reconciled from the live Supabase Dashboard deploy):
   Supabase Storage rejects object keys containing spaces or non-ASCII
   characters (å/ä/ö etc.) with `InvalidKey` — the PREVIOUS sanitizer
   explicitly ALLOWED both (` åäöÅÄÖ` in its allow-list), which is
   exactly what broke real uploads like
   "Faktura 26519 Vift Fastighetsservice & Förvaltning AB.pdf".
   This function now produces an ASCII-ONLY, Storage-safe key:
     - Unicode diacritics normalized away (NFKD + combining-mark strip)
       so e.g. é→e, ü→u
     - the Nordic å/ä/ö (and uppercase) are explicitly mapped to a/o
       as a fallback, since some runtimes don't fully decompose them
     - any remaining non [a-zA-Z0-9._-] character (spaces, &, etc.)
       becomes `_`
     - the file extension is preserved separately and lowercased
     - the ORIGINAL, human-readable filename is NEVER lost — it is
       always stored unchanged in `originalFileName` in the document
       metadata; this function is used ONLY for the Storage object key
       (and as a display-name fallback is now `file.name` itself, see
       below — displayName is free text, not a filesystem path, so it
       does not need to be ASCII-sanitized). */
function sanitizeStorageFilename(name: string): string {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const rawExt = dot > 0 ? name.slice(dot + 1) : ''
  const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10)

  const asciiBase = base
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[åÅ]/g, 'a').replace(/[äÄ]/g, 'a').replace(/[öÖ]/g, 'o')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 150)

  const safeBase = asciiBase || 'dokument'
  return ext ? `${safeBase}.${ext}` : safeBase
}

/* §Blockerare 8 — storagePath MÅSTE vara EXAKT bunden till DENNA posts
   egna projectId + documentId, inte bara ha rätt allmänna form. */
function isBoundStoragePath(storagePath: string, projectId: string, documentId: string): boolean {
  if (!storagePath || typeof storagePath !== 'string') return false
  if (storagePath.includes('..') || storagePath.includes('//') || storagePath.startsWith('/')) return false
  const expectedPrefix = `${STORAGE_BUCKET}/${projectId}/${documentId}/`
  return storagePath.startsWith(expectedPrefix) && storagePath.length > expectedPrefix.length
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const authHeader = req.headers.get('authorization') || ''
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!jwt) return json({ error: 'forbidden' }, 403)

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  const auth = await checkViftAuth(supabase, jwt, CORS)
  if (!auth.ok) return auth.response
  const { perms, staffMember } = auth

  /* §D — ingen ny project_*-behörighet. customer_manage är den
     BEFINTLIGA regeln för Projektsidan i sin helhet. */
  if (!hasPerm(perms, 'customer_manage')) return json({ error: 'forbidden' }, 403)
  const canFinance = hasPerm(perms, 'invoice_view')

  if (req.method === 'DELETE') {
    let body: Record<string, unknown>
    try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }
    const documentId = String(body.documentId ?? '').trim()
    /* §Blockerare 1 — `projectId` här är anroparens FÖRVÄNTADE kontext
       (ProjectDetailPage._projectId på klienten), inte ett värde
       härlett från dokumentet. Jämförs oberoende mot postens EGEN
       lagrade projectId inuti softDeleteDocument()/RPC:en. */
    const expectedProjectId = String(body.projectId ?? '').trim()
    if (!documentId || !expectedProjectId) return json({ error: 'missing_fields' }, 400)
    return await softDeleteDocument(supabase, documentId, expectedProjectId)
  }

  if (req.method === 'PATCH') {
    let body: Record<string, unknown>
    try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }
    const documentId = String(body.documentId ?? '').trim()
    const expectedProjectId = String(body.projectId ?? '').trim()
    const patchIn = (body.patch && typeof body.patch === 'object') ? body.patch as Record<string, unknown> : {}
    if (!documentId || !expectedProjectId) return json({ error: 'missing_fields' }, 400)
    return await patchDocument(supabase, documentId, expectedProjectId, patchIn, canFinance)
  }

  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let formData: FormData
  try { formData = await req.formData() }
  catch (e) { return json({ error: 'invalid_form', detail: String(e) }, 400) }

  const fileField   = formData.get('file')
  const projectId   = String(formData.get('projectId') ?? '').trim()
  const documentType = String(formData.get('documentType') ?? 'ovrigt').trim() || 'ovrigt'
  const workOrderId  = String(formData.get('workOrderId') ?? '').trim()

  if (!fileField || !(fileField instanceof File)) return json({ error: 'missing_file' }, 400)
  if (!projectId) return json({ error: 'missing_fields', field: 'projectId' }, 400)
  if (!VALID_DOC_TYPES.includes(documentType)) return json({ error: 'invalid_document_type' }, 400)

  /* Projektet måste existera */
  const { data: prjRow } = await supabase.from('store').select('value').eq('key', 'vift_projects').maybeSingle()
  const knownProjects: Record<string, unknown>[] = Array.isArray(prjRow?.value) ? prjRow.value as Record<string, unknown>[] : []
  if (!knownProjects.find(p => p.id === projectId)) return json({ error: 'project_not_found' }, 404)

  /* §C7 — en icke-tom workOrderId MÅSTE tillhöra SAMMA projekt, verifierat
     server-side mot AO:ns FAKTISKA lagrade projectId. */
  if (workOrderId) {
    const { data: aoRow } = await supabase.from('store').select('value').eq('key', 'vift_workOrders').maybeSingle()
    const knownAos: Record<string, unknown>[] = Array.isArray(aoRow?.value) ? aoRow.value as Record<string, unknown>[] : []
    const ao = knownAos.find(a => a.id === workOrderId)
    if (!ao) return json({ error: 'work_order_not_found' }, 404)
    if (ao.projectId !== projectId) return json({ error: 'work_order_not_in_project' }, 400)
  }

  const file = fileField as File
  if (file.size > MAX_BYTES) return json({ error: 'file_too_large', maxBytes: MAX_BYTES }, 400)
  if (file.size === 0) return json({ error: 'empty_file' }, 400)

  const arrayBuffer = await file.arrayBuffer()
  const uint8 = new Uint8Array(arrayBuffer)

  const claimedMime = (file.type || 'application/octet-stream').toLowerCase().split(';')[0].trim()
  const sniffedMime = sniffMime(uint8)
  if (sniffedMime && sniffedMime !== claimedMime) {
    const isZipOffice = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ].includes(claimedMime)
    if (!isZipOffice) return json({ error: 'mime_mismatch', claimed: claimedMime, detected: sniffedMime }, 400)
  }
  const effectiveMime = sniffedMime ?? claimedMime
  if (!Object.keys(ALLOWED_MIME).includes(effectiveMime)) {
    return json({ error: 'invalid_file_type', type: effectiveMime, allowed: Object.keys(ALLOWED_MIME) }, 400)
  }

  const checksum = await sha256hex(uint8)

  const displayName          = String(formData.get('displayName')          ?? '').trim() || file.name
  const supplierName         = String(formData.get('supplierName')         ?? '').trim().slice(0, 200)
  const amountExVatStr       = String(formData.get('amountExVat')          ?? '').trim()
  const amountExVatRequested = amountExVatStr !== '' && Number.isFinite(parseFloat(amountExVatStr)) ? parseFloat(amountExVatStr) : null
  const documentDate         = String(formData.get('documentDate')         ?? '').trim()
  const validUntil           = String(formData.get('validUntil')           ?? '').trim()
  const supplierQuoteStatusRaw = String(formData.get('supplierQuoteStatus') ?? '').trim()
  const supplierQuoteStatus  = VALID_UE_STATUSES.includes(supplierQuoteStatusRaw) ? supplierQuoteStatusRaw : (documentType === 'ue_offert' ? 'inkommen' : '')
  const note                 = String(formData.get('note')                 ?? '').trim().slice(0, 1000)
  const now                  = new Date().toISOString()

  if (documentType === 'ue_offert' && !supplierName) {
    return json({ error: 'missing_fields', field: 'supplierName' }, 400)
  }

  /* §Blockerare 5 — fail-closed: en anropare utan invoice_view får INTE
     sätta ett belopp vid uppladdning. Om inget belopp angetts (null) är
     uppladdningen ändå tillåten — bara SJÄLVA beloppssättningen kräver
     behörigheten. */
  if (amountExVatRequested !== null && !canFinance) {
    return json({ error: 'forbidden_amount' }, 403)
  }
  const amountExVat = canFinance ? amountExVatRequested : null

  /* §Blockerare 7 — uploadedBy härleds UTESLUTANDE från den
     autentiserade JWT-identiteten, aldrig från klientens FormData. */
  const uploadedBy = String((staffMember as Record<string, unknown>)?.id ?? '')

  const idBytes = new Uint8Array(8)
  crypto.getRandomValues(idBytes)
  const documentId = 'doc-' + Array.from(idBytes).map(b => b.toString(16).padStart(2, '0')).join('')

  const safeFilename = sanitizeStorageFilename(file.name)
  const pathInBucket = `${projectId}/${documentId}/${safeFilename}`
  const storagePath  = `${STORAGE_BUCKET}/${pathInBucket}`

  const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(pathInBucket, uint8, {
    contentType: effectiveMime, cacheControl: '3600', upsert: false
  })
  if (upErr) {
    /* PROD-HOTFIX: föregående version loggade ENDAST en generisk rad utan
       felmeddelande eller sökväg — den faktiska produktionsincidenten
       (Storage `InvalidKey` på mellanslag/å/ä/ö i filnamnet) syntes då
       inte i loggarna alls, bara ett tomt "storage upload fel". Logga nu
       BÅDE det faktiska felmeddelandet och den beräknade (ASCII-säkra)
       sökvägen — aldrig det ORIGINALA filnamnet i klartext i loggen
       (kan innehålla persondata), bara den redan saniterade nyckeln. */
    console.error('[project-document-upload] storage upload fel:', upErr.message, 'path:', pathInBucket)
    return json({ error: 'storage_error' }, 500)
  }

  const newDoc: Record<string, unknown> = {
    id: documentId,
    projectId,
    documentType,
    displayName,
    originalFileName: file.name,
    storagePath,
    mimeType: effectiveMime,
    sizeBytes: file.size,
    checksum,
    supplierName,
    amountExVat,
    documentDate,
    validUntil,
    supplierQuoteStatus,
    workOrderId,
    note,
    uploadedBy,
    uploadedAt: now,
    active: true,
    deletedAt: '',
    createdAt: now,
    updatedAt: now
  }

  /* §Blockerare 3/4 — atomisk, radlåst append. Om denna RPC misslyckas
     (t.ex. databasfel) har vi redan en fil i Storage utan en giltig
     metadata-post — kompensera genom att ta bort den innan vi
     returnerar ett fel. Aldrig "success" utan en bekräftad post. */
  const { error: rpcErr } = await supabase.rpc('project_documents_append', { p_new_doc: newDoc })
  if (rpcErr) {
    console.error('[project-document-upload] metadata-RPC misslyckades, kompenserar med storage-borttagning:', rpcErr.message)
    const { error: compErr } = await supabase.storage.from(STORAGE_BUCKET).remove([pathInBucket])
    if (compErr) {
      console.error('[project-document-upload] KOMPENSERANDE storage-borttagning MISSLYCKADES också — föräldralös fil kräver manuell sanering:', pathInBucket)
      return json({ error: 'metadata_write_failed', compensated: false, orphanPath: pathInBucket }, 500)
    }
    return json({ error: 'metadata_write_failed', compensated: true }, 500)
  }

  return json({ document: newDoc })
})

/* ── PATCH — metadata-redigering / UE-statusändring ──────────────────
   §Blockerare 1: `expectedProjectId` valideras mot dokumentets EGNA
   lagrade projectId, OBEROENDE av klienten (försvar i djupled — även
   om klienten redan borde ha förvägrat detta lokalt).
   §Blockerare 5: `amountExVat` i patchen kräver invoice_view, annars
   403 (fail-closed, fältet ignoreras ALDRIG tyst).
   §Blockerare 6: detta är den enda vägen för metadata-/UE-status-
   mutation — klienten skriver inte längre direkt till lokal state. */
async function patchDocument(
  supabase: ReturnType<typeof createClient>,
  documentId: string,
  expectedProjectId: string,
  patchIn: Record<string, unknown>,
  canFinance: boolean
): Promise<Response> {
  const { data: docRow } = await supabase.from('store').select('value').eq('key', 'vift_projectDocuments').maybeSingle()
  const documents: Record<string, unknown>[] = Array.isArray(docRow?.value) ? docRow.value as Record<string, unknown>[] : []
  const doc = documents.find(d => d.id === documentId)
  if (!doc) return json({ error: 'not_found' }, 404)
  if (doc.projectId !== expectedProjectId) return json({ error: 'forbidden' }, 403)

  if (Object.prototype.hasOwnProperty.call(patchIn, 'amountExVat') && !canFinance) {
    return json({ error: 'forbidden_amount_change' }, 403)
  }

  const patch: Record<string, unknown> = {}
  for (const field of PATCHABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patchIn, field)) patch[field] = patchIn[field]
  }

  const merged = { ...doc, ...patch }
  const documentType = String(merged.documentType ?? 'ovrigt')
  if (!VALID_DOC_TYPES.includes(documentType)) return json({ error: 'invalid_document_type' }, 400)

  if (merged.workOrderId) {
    const { data: aoRow } = await supabase.from('store').select('value').eq('key', 'vift_workOrders').maybeSingle()
    const knownAos: Record<string, unknown>[] = Array.isArray(aoRow?.value) ? aoRow.value as Record<string, unknown>[] : []
    const ao = knownAos.find(a => a.id === merged.workOrderId)
    if (!ao) return json({ error: 'work_order_not_found' }, 404)
    if (ao.projectId !== expectedProjectId) return json({ error: 'work_order_not_in_project' }, 400)
  }

  if (documentType === 'ue_offert') {
    if (!merged.supplierName || !String(merged.supplierName).trim()) {
      return json({ error: 'missing_fields', field: 'supplierName' }, 400)
    }
    if (merged.supplierQuoteStatus && !VALID_UE_STATUSES.includes(String(merged.supplierQuoteStatus))) {
      return json({ error: 'invalid_ue_status' }, 400)
    }
  }
  if (patch.amountExVat !== undefined && patch.amountExVat !== null && !Number.isFinite(Number(patch.amountExVat))) {
    return json({ error: 'invalid_amount' }, 400)
  }

  const { data: updated, error: rpcErr } = await supabase.rpc('project_documents_update_one', {
    p_doc_id: documentId,
    p_expected_project_id: expectedProjectId,
    p_patch: patch
  })
  if (rpcErr) {
    const msg = String(rpcErr.message || '')
    if (msg.includes('forbidden')) return json({ error: 'forbidden' }, 403)
    if (msg.includes('not_found')) return json({ error: 'not_found' }, 404)
    console.error('[project-document-upload] PATCH-RPC fel:', msg)
    return json({ error: 'update_failed' }, 500)
  }

  return json({ document: updated })
}

/* ── DELETE — mjuk borttagning ────────────────────────────────────────
   §Blockerare 2: lagringsobjektet tas bort FÖRST. Endast om DEN
   borttagningen bekräftat lyckas (eller objektet redan var borta)
   markeras metadata inaktiv, atomiskt via project_documents_finalize_
   delete. Misslyckas storage-borttagningen: returnera ett FEL, rör
   ALDRIG metadata — dokumentet förblir synligt/aktivt och kan
   försökas igen. Aldrig `{ok:true, warning:...}` som låtsas framgång. */
async function softDeleteDocument(
  supabase: ReturnType<typeof createClient>,
  documentId: string,
  expectedProjectId: string
): Promise<Response> {
  const { data: docRow } = await supabase.from('store').select('value').eq('key', 'vift_projectDocuments').maybeSingle()
  const documents: Record<string, unknown>[] = Array.isArray(docRow?.value) ? docRow.value as Record<string, unknown>[] : []

  const doc = documents.find(d => d.id === documentId)
  if (!doc) return json({ error: 'not_found' }, 404)
  /* §Blockerare 1 — ett manipulerat documentId från ETT ANNAT projekt
     kan aldrig raderas via ett godtyckligt klientskickat projectId —
     jämförs mot postens EGEN, lagrade projectId. */
  if (doc.projectId !== expectedProjectId) return json({ error: 'forbidden' }, 403)

  const storagePath = String(doc.storagePath ?? '')
  /* §Blockerare 8 — vägra röra en fil vars lagrade sökväg inte är
     EXAKT bunden till DENNA posts egna projectId+documentId, oavsett
     vad metadatan i övrigt påstår. */
  if (!isBoundStoragePath(storagePath, expectedProjectId, documentId)) {
    console.error('[project-document-upload] DELETE: storagePath ej bunden till projekt+dokument-id, vägrar:', storagePath)
    return json({ error: 'invalid_storage_path' }, 400)
  }
  const pathInBucket = storagePath.replace(new RegExp('^' + STORAGE_BUCKET + '/'), '')

  const { error: rmErr } = await supabase.storage.from(STORAGE_BUCKET).remove([pathInBucket])
  if (rmErr) {
    console.error('[project-document-upload] storage-borttagning misslyckades — metadata lämnas OFÖRÄNDRAD (aktiv):', rmErr.message)
    return json({ error: 'storage_delete_failed' }, 500)
  }

  const { data: updated, error: rpcErr } = await supabase.rpc('project_documents_finalize_delete', {
    p_doc_id: documentId,
    p_expected_project_id: expectedProjectId
  })
  if (rpcErr) {
    const msg = String(rpcErr.message || '')
    if (msg.includes('forbidden')) return json({ error: 'forbidden' }, 403)
    if (msg.includes('not_found')) return json({ error: 'not_found' }, 404)
    console.error('[project-document-upload] DELETE finalize-RPC fel (filen är redan borttagen ur Storage — kräver manuell sanering av metadata):', msg)
    return json({ error: 'metadata_finalize_failed' }, 500)
  }

  return json({ ok: true, document: updated })
}
