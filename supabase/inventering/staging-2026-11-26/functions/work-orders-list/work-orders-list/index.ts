/**
 * work-orders-list — Supabase Edge Function (v3, C-5 2026-11-25: accessCode bara för objects_sensitive/ao_edit).
 * Kommenterad källa: supabase/functions/work-orders-list/index.ts i repot.
 */

import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkViftAuth, hasPerm } from '../_shared/vift-auth.ts'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control':                'no-store, no-cache',
  'Referrer-Policy':              'no-referrer',
  'X-Content-Type-Options':       'nosniff',
  'X-Frame-Options':              'DENY'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const SENSITIVE_AO_FIELDS = ['accessCode']
function redact(list: Record<string, unknown>[], perms: string[]): Record<string, unknown>[] {
  if (hasPerm(perms, 'objects_sensitive') || hasPerm(perms, 'ao_edit')) return list
  return list.map((ao) => {
    if (!ao || typeof ao !== 'object') return ao
    const out = { ...ao }
    for (const f of SENSITIVE_AO_FIELDS) delete out[f]
    return out
  })
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const authHeader = req.headers.get('authorization') || ''
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!jwt) return json({ error: 'forbidden' }, 403)

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  const auth = await checkViftAuth(supabase, jwt, CORS)
  if (!auth.ok) return auth.response
  const { perms, staffMember } = auth

  const { data: row, error } = await supabase.from('store').select('value').eq('key', 'vift_workOrders').maybeSingle()
  if (error) {
    console.error('[work-orders-list] store-läsfel:', error.message)
    return json({ error: 'read_failed' }, 500)
  }
  const all: Record<string, unknown>[] = Array.isArray(row?.value) ? row!.value as Record<string, unknown>[] : []

  if (hasPerm(perms, 'ao_view_all') || hasPerm(perms, 'all')) {
    return json({ workOrders: redact(all, perms) })
  }

  if (!hasPerm(perms, 'ao_view_own')) {
    return json({ workOrders: [] })
  }

  const sm = staffMember as Record<string, unknown>
  const myStaffId = String(sm?.id ?? '')
  const filtered = all.filter(ao => {
    const staff = Array.isArray(ao.staff) ? ao.staff as unknown[] : []
    return staff.includes(myStaffId) || ao.status === 'pool'
  })

  return json({ workOrders: redact(filtered, perms) })
})
