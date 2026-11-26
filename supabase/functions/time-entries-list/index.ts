/**
 * time-entries-list — Supabase Edge Function
 * (BLOCKER-1, server-side half — see docs/PROJECT_STATUS.md)
 *
 * The ONLY path left (after the companion migration
 * 20261120000002_PROPOSAL_timeentries_read_lockdown.sql, which blocks
 * direct `authenticated` REST reads of the `vift_timeEntries` key) for
 * a logged-in client to read time entries. Does the real,
 * server-side permission filtering BEFORE any data leaves the server —
 * not a client-side filter on data already sent in full (that weaker
 * mitigation already existed in `state.js`'s `_applyTimeEntriesPayrollFilter()`,
 * same session, commit a0d02e3; this function is the deeper fix the
 * data-flow review asked for).
 *
 * Reuses the SAME established pattern as every other authenticated EF
 * in this repo (see work-order-checklist-resolve/index.ts):
 *   authenticated client -> this Edge Function -> service_role read.
 *
 * This function does NOT accept or trust any client-supplied staff id
 * or permission claim. Everything security-relevant is derived
 * server-side from the verified JWT via the shared `checkViftAuth()`:
 *   - `perms`       -> payroll_view (or `all`) sees every entry;
 *                      T4-B: time_view_all sees every entry without payroll
 *                      fields (projectTimeEntry); everyone else sees ONLY
 *                      their own. hourRate only with canReadPrices (D-11).
 *   - `staffMember` -> supplies the caller's OWN id for the "own
 *                      entries" filter — never read from the request.
 *
 * GET/POST /functions/v1/time-entries-list
 * Headers: Authorization: Bearer <supabase-jwt>
 * No query params, no body — a plain authenticated read.
 *
 * 200: { timeEntries: TimeEntry[] }
 * 401: { error: 'unauthorized' }   — missing/invalid JWT
 * 403: { error: 'forbidden' }      — valid JWT, but not an active VIFT user
 * 405: { error: 'method_not_allowed' }
 * 429: { error: 'rate_limited' }
 * 500: { error: 'read_failed' }
 */

import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkViftAuth, hasPerm, projectTimeEntry } from '../_shared/vift-auth.ts'

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

/* Enkel in-memory rate-limit per anropande staff-id — detta är INTE en
   publik endpoint (kräver redan en giltig JWT + aktiv app_users-rad),
   men en lätt gräns skyddar ändå mot en trasig klient som råkar polla
   i en tajt loop. Samma etablerade mönster som offer-token-validate. */
const _rateMap = new Map<string, { count: number; windowStart: number }>()
const RATE_WINDOW_MS  = 60_000
const RATE_MAX        = 60

function checkRateLimit(key: string): boolean {
  const now  = Date.now()
  const slot = _rateMap.get(key)
  if (!slot || now - slot.windowStart > RATE_WINDOW_MS) {
    _rateMap.set(key, { count: 1, windowStart: now })
    return true
  }
  slot.count++
  return slot.count <= RATE_MAX
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const authHeader = req.headers.get('authorization') || ''
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!jwt) return json({ error: 'unauthorized' }, 401)

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  const auth = await checkViftAuth(supabase, jwt, CORS)
  if (!auth.ok) return auth.response
  const { perms, staffMember } = auth

  const sm = staffMember as Record<string, unknown>
  const callerStaffId = String(sm?.id ?? '')

  if (!checkRateLimit(callerStaffId || 'unknown')) {
    return json({ error: 'rate_limited' }, 429)
  }

  try {
    /* service_role-läsning — denna funktion ÄR den avsedda vägen förbi
       den nya RESTRICTIVE policyn (migration 20261120000002), exakt
       som varje annan EF i detta repo redan använder service_role för
       sin egna, auktoriserade åtkomst. */
    const { data: row, error: readErr } = await supabase
      .from('store')
      .select('value')
      .eq('key', 'vift_timeEntries')
      .maybeSingle()

    if (readErr) {
      console.error('[time-entries-list] store-läsfel:', readErr.message)
      return json({ error: 'read_failed' }, 500)
    }

    const allEntries: Record<string, unknown>[] =
      Array.isArray(row?.value) ? (row.value as Record<string, unknown>[]) : []

    /* Samma regel som Auth.can('payroll_view') på klienten (och samma
       som _applyTimeEntriesPayrollFilter() i state.js) — men detta är
       den FAKTISKA, auktoritativa kontrollen: ingen tidpost för någon
       annan än den anropande personen lämnar servern alls, om inte
       payroll_view (eller 'all') är beviljad. */
    /* T4-B (K-01, D-08, D-11): time_view_all ger ALL personals arbetade och registrerade tid, men
       inga löneuppgifter — en annans post lämnas bara ut med fälten i TIME_VIEW_ALL_FIELDS (ingen
       attest eller lön); payroll_view krävs för lön/belopp per person. Timpriset (hourRate) bara
       med prisläsrätt (canReadPrices) — aldrig till fältroller, inte heller för egna poster. */
    const canViewAll = hasPerm(perms, 'payroll_view') || hasPerm(perms, 'time_view_all') || hasPerm(perms, 'all')
    const timeEntries = (canViewAll
      ? allEntries
      : allEntries.filter((e) => String(e.staffId ?? '') === callerStaffId))
      .map((e) => projectTimeEntry(e, perms, callerStaffId))

    return json({ timeEntries })
  } catch (e: unknown) {
    console.error('[time-entries-list] oväntat fel:', e)
    return json({ error: 'read_failed' }, 500)
  }
})
