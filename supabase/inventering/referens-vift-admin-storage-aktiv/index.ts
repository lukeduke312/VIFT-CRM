// REFERENS (G1/G4 del 2, 2026-11-27): repots tidigare AKTIVA version. ALDRIG LIVE, deployas inte. Se README.md.
/**
 * vift-admin-storage — TILLFÄLLIG underhållsfunktion (STAGING, 2026-11-24).
 * Bara konton med behörigheten 'all'. Två åtgärder, inget annat:
 *   POST multipart { action:'upload_branding', file:PNG }  -> vift-branding/vift-logo-black.png
 *   POST json { action:'remove_test_object', bucket, path } -> tar bort ETT testobjekt
 *        (bucket offer-attachments/workorder-images/project-documents, path börjar med 'E2E-')
 * Avaktiveras (svarar 410) när underhållet är klart.
 */
import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0'
import { checkViftAuth, hasPerm } from '../_shared/vift-auth.ts'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
const TEST_BUCKETS = new Set(['offer-attachments', 'workorder-images', 'project-documents'])

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer /, '')
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } })
  const auth = await checkViftAuth(supabase, jwt, CORS)
  if (!auth.ok) return auth.response
  if (!auth.perms.includes('all')) return json({ error: 'forbidden' }, 403)
  const ct = req.headers.get('content-type') || ''
  if (ct.startsWith('multipart/form-data')) {
    const fd = await req.formData()
    if (fd.get('action') !== 'upload_branding') return json({ error: 'unknown_action' }, 400)
    const f = fd.get('file')
    if (!(f instanceof File) || f.size === 0 || f.size > 512 * 1024) return json({ error: 'invalid_file' }, 400)
    const b = new Uint8Array(await f.arrayBuffer())
    if (!(b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47)) return json({ error: 'not_png' }, 400)
    const { error } = await supabase.storage.from('vift-branding').upload('vift-logo-black.png', b, { contentType: 'image/png', upsert: true })
    if (error) return json({ error: 'storage_error', detail: error.message }, 500)
    const d = await crypto.subtle.digest('SHA-256', b)
    return json({ ok: true, bytes: b.length, sha256: Array.from(new Uint8Array(d)).map((x) => x.toString(16).padStart(2, '0')).join('') })
  }
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  if (body.action !== 'remove_test_object') return json({ error: 'unknown_action' }, 400)
  const bucket = String(body.bucket ?? ''), path = String(body.path ?? '')
  if (!TEST_BUCKETS.has(bucket) || !/^E2E-[A-Za-z0-9._\/-]+$/.test(path) || path.includes('..')) return json({ error: 'not_a_test_object' }, 400)
  const { data, error } = await supabase.storage.from(bucket).remove([path])
  if (error) return json({ error: 'storage_error', detail: error.message }, 500)
  return json({ ok: true, removed: (data || []).map((o: { name: string }) => o.name) })
})
