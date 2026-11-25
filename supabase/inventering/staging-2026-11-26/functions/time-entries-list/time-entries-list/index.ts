/**
 * time-entries-list — Supabase Edge Function
 * (P0 FINAL INTEGRATION — STAFF/PAYROLL R1 — BLOCKER-1 fix)
 *
 * The ONLY read path for `vift_timeEntries` left standing once
 * 20261018000007_timeentries_payroll_read_lockdown.sql blocks direct
 * authenticated SELECT on that key (see its header for the full
 * rationale). Filters server-side, so a curious/malicious authenticated
 * user cannot see this by calling the REST API directly with their own
 * JWT, bypassing the app's UI entirely — the leak this closes was never
 * a UI problem.
 *
 * Without `payroll_view` (or `all`): returns ONLY the caller's own
 * entries (matched by staffId), with `hourRate` additionally stripped
 * from every entry that is not their own (defense in depth — even a
 * caller's own entries keep their own rate, since staff legitimately
 * see their own pay-relevant data elsewhere in the app, e.g. TimePage).
 * With `payroll_view`/`all`: returns everything, unfiltered — same data
 * DataSync already showed those users.
 *
 * GET/POST /functions/v1/time-entries-list
 * 200: { timeEntries: [...] }
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

  const { data: row, error } = await supabase.from('store').select('value').eq('key', 'vift_timeEntries').maybeSingle()
  if (error) {
    console.error('[time-entries-list] store-läsfel:', error.message)
    return json({ error: 'read_failed' }, 500)
  }
  const all: Record<string, unknown>[] = Array.isArray(row?.value) ? row!.value as Record<string, unknown>[] : []

  if (hasPerm(perms, 'payroll_view')) {
    return json({ timeEntries: all })
  }

  const sm = staffMember as Record<string, unknown>
  const myStaffId = String(sm?.id ?? '')
  const filtered = all
    .filter(e => e.staffId === myStaffId)
  // Egna poster: fullständigt oförändrade (inkl. hourRate — personal ser
  // redan sitt eget timpris i TimePage/löneunderlaget idag).

  return json({ timeEntries: filtered })
})
