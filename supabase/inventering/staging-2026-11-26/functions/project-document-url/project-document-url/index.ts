/**
 * project-document-url — Supabase Edge Function (V54C1 Part C)
 *
 * Genererar en tidsbegränsad signerad URL för visning/nedladdning av ett
 * Projekt-dokument. Generaliserad direkt från offer-attachment-url —
 * samma säkerhetsmönster, men ENDAST den interna JWT-vägen (Projekt-
 * dokument har ingen publik kundlänk i denna leverans).
 *
 * POST /functions/v1/project-document-url
 * Headers: Authorization: Bearer <SUPABASE_JWT>
 * Body: { documentId: string, projectId: string, mode?: 'view'|'download' }
 *
 * Kontroller:
 *  - giltig JWT → app_users.active → customer_manage-behörighet
 *  - dokumentet finns och är aktivt (active !== false)
 *  - dokumentets EGNA lagrade `projectId` MÅSTE vara exakt lika med det
 *    `projectId` anroparen skickar in (= anroparens FÖRVÄNTADE sid-
 *    kontext, t.ex. ProjectDetailPage._projectId — R1: klienten skickar
 *    INTE längre dokumentets egen projectId, se ProjectDocumentService.
 *    getSignedUrl(), vilket var R0:s faktiska sårbarhet trots att denna
 *    serverkontroll redan fanns — en självjämförelse skyddar aldrig
 *    mot något) — förhindrar att ett manipulerat `documentId`
 *    tillsammans med fel kontext läcker en signerad URL till ett
 *    dokument i ett ANNAT projekt (R1-tester §1-2)
 *  - §Blockerare 8: `storagePath` MÅSTE vara EXAKT bunden till DENNA
 *    posts egna `projectId` + `id` (inte bara ha rätt allmänna form) —
 *    en förgiftad/manipulerad storagePath i metadata kan aldrig signera
 *    en annan fil
 *
 * Signerad URL: TTL = 600 s (10 min), reusable under TTL — INTE engångs.
 *
 * Svar 200: { url, expiresAt, fileName, mimeType }
 * Svar 400: { error: 'missing_fields' }
 * Svar 403: { error: 'forbidden' }
 * Svar 404: { error: 'not_found' }
 */

import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkViftAuth, hasPerm } from '../_shared/vift-auth.ts'

const SUPABASE_URL           = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_ROLE_KEY       = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const STORAGE_BUCKET         = 'project-documents'
const SIGNED_URL_TTL_SECONDS = 600

/* §Blockerare 9 — standard Supabase-klient-headrar tillåtna i preflight. */
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control':                'no-store, no-cache',
  'Referrer-Policy':              'no-referrer',
  'X-Content-Type-Options':       'nosniff',
  'X-Frame-Options':              'DENY'
}

/* §Blockerare 8 — storagePath MÅSTE vara EXAKT bunden till DENNA posts
   egna projectId + documentId, inte bara ha rätt allmänna form. En
   metadata-post vars storagePath pekar på en ANNAN mapp (t.ex. via en
   manipulerad direkt databasskrivning eller ett framtida buggigt
   anrop) kan då aldrig signeras. */
function isBoundStoragePath(path: string, projectId: string, documentId: string): boolean {
  if (!path || typeof path !== 'string') return false
  if (path.includes('..') || path.includes('//') || path.startsWith('/')) return false
  const expectedPrefix = `project-documents/${projectId}/${documentId}/`
  if (!path.startsWith(expectedPrefix) || path.length <= expectedPrefix.length) return false
  return /^project-documents\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/[^/]+$/.test(path)
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }

  const documentId = String(body.documentId ?? '').trim()
  const projectId  = String(body.projectId  ?? '').trim()
  const mode       = String(body.mode       ?? 'view').trim()

  if (!documentId || !projectId) return json({ error: 'missing_fields' }, 400)

  const authHeader = req.headers.get('authorization') || ''
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!jwt) return json({ error: 'forbidden' }, 403)

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  const auth = await checkViftAuth(supabase, jwt, CORS)
  if (!auth.ok) return auth.response
  if (!hasPerm(auth.perms, 'customer_manage')) return json({ error: 'forbidden' }, 403)

  const { data: docRow } = await supabase.from('store').select('value').eq('key', 'vift_projectDocuments').maybeSingle()
  const documents: Record<string, unknown>[] = Array.isArray(docRow?.value) ? docRow.value as Record<string, unknown>[] : []

  const doc = documents.find(d => d.id === documentId)
  if (!doc || doc.active === false) return json({ error: 'not_found' }, 404)

  /* §18/§C7 — dokumentets EGEN lagrade projectId är den enda sanningen,
     aldrig ett klientskickat påstående. Ett dokument i PRJ1 kan aldrig
     ge en giltig URL om anroparen skickar PRJ2, oavsett vad som
     påstås. */
  if (doc.projectId !== projectId) return json({ error: 'forbidden' }, 403)

  const storagePath = String(doc.storagePath ?? '')
  if (!isBoundStoragePath(storagePath, projectId, documentId)) return json({ error: 'not_found' }, 404)
  const pathInBucket = storagePath.replace(new RegExp('^' + STORAGE_BUCKET + '/'), '')

  const { data: signed, error: signErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(pathInBucket, SIGNED_URL_TTL_SECONDS, mode === 'download' ? { download: String(doc.originalFileName ?? '') } : undefined)

  if (signErr || !signed?.signedUrl) {
    console.error('[project-document-url] signering misslyckades')
    return json({ error: 'signing_failed' }, 500)
  }

  return json({
    url: signed.signedUrl,
    expiresAt: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
    fileName: doc.originalFileName,
    mimeType: doc.mimeType
  })
})
