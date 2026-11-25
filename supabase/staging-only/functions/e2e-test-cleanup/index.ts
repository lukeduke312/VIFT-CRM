/**
 * e2e-test-cleanup — STAGING-TESTVERKTYG (2026-11-25). FÅR ALDRIG INSTALLERAS I LIVE.
 *
 * Städar det som de automatiska webbläsartesterna (tests/staging/e2e-real.js)
 * skapar men som saknar en officiell raderingsväg:
 *   purgeOffer   { offerId } — testoffertens bilageposter + filer i offer-attachments
 *                              och offerthändelser (append-only i produktion).
 *   purgeAoImages { aoId }   — testarbetsorderns filer i workorder-images.
 * Fakturautkast städas via den officiella vägen (invoice-write draftDelete).
 *
 * Spärrar (alla måste vara uppfyllda):
 *   1. projektet är STAGING (SUPABASE_URL innehåller STAGING-ref) — annars 410,
 *   2. anroparen är aktiv VIFT-användare med behörigheten 'all',
 *   3. offerten/arbetsordern finns och har en titel som börjar med "[E2E-TEST]",
 *   4. bara sökvägar under just den offertens/arbetsorderns egen mapp raderas.
 */
import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0'
import { checkViftAuth } from '../_shared/vift-auth.ts'

const STAGING_REF = 'yyzljlqyzzcbxmcdbual'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{2,120}$/

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (!SUPABASE_URL.includes(STAGING_REF)) return json({ error: 'disabled_outside_staging' }, 410)
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer /, '')
  const supabase = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } })
  const auth = await checkViftAuth(supabase, jwt, CORS)
  if (!auth.ok) return auth.response
  if (!auth.perms.includes('all')) return json({ error: 'forbidden' }, 403)
  const body = await req.json().catch(() => ({})) as Record<string, unknown>

  if (body.action === 'purgeOffer') {
    const offerId = String(body.offerId ?? '')
    if (!ID.test(offerId)) return json({ error: 'invalid_id' }, 400)
    const { data, error } = await supabase.rpc('e2e_purge_offer_artifacts', { p_offer_id: offerId })
    if (error) return json({ error: String(error.message || '').includes('not_test_offer') ? 'not_test_offer' : 'purge_failed' }, String(error.message || '').includes('not_test_offer') ? 403 : 500)
    const prefix = 'offer-attachments/' + offerId + '/'
    const paths = ((data?.storagePaths as string[]) || []).filter((p) => typeof p === 'string' && p.startsWith(prefix) && !p.includes('..')).map((p) => p.slice('offer-attachments/'.length))
    let removed: string[] = []
    if (paths.length) {
      const r = await supabase.storage.from('offer-attachments').remove(paths)
      if (r.error) return json({ error: 'storage_failed', detail: r.error.message, purged: data }, 500)
      removed = (r.data || []).map((o: { name: string }) => o.name)
    }
    return json({ ok: true, attachments: data?.attachments ?? 0, events: data?.events ?? 0, filesRemoved: removed.length })
  }

  if (body.action === 'purgeAoImages') {
    const aoId = String(body.aoId ?? '')
    if (!ID.test(aoId)) return json({ error: 'invalid_id' }, 400)
    const { data: row } = await supabase.from('store').select('value').eq('key', 'vift_workOrders').maybeSingle()
    const ao = (Array.isArray(row?.value) ? row!.value as Record<string, unknown>[] : []).find((a) => a.id === aoId)
    if (!ao || !String(ao.title ?? '').startsWith('[E2E-TEST]')) return json({ error: 'not_test_ao' }, 403)
    const list = await supabase.storage.from('workorder-images').list(aoId, { limit: 1000 })
    if (list.error) return json({ error: 'storage_failed', detail: list.error.message }, 500)
    const paths = (list.data || []).map((o: { name: string }) => aoId + '/' + o.name)
    if (!paths.length) return json({ ok: true, filesRemoved: 0 })
    const r = await supabase.storage.from('workorder-images').remove(paths)
    if (r.error) return json({ error: 'storage_failed', detail: r.error.message }, 500)
    return json({ ok: true, filesRemoved: (r.data || []).length })
  }

  return json({ error: 'unknown_action' }, 400)
})
