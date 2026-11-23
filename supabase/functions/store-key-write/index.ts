/**
 * store-key-write — Supabase Edge Function (STAGING-variant)
 * Enda vägen för STAGING:s 27 generiska business-/referensnycklar, sedan
 * Fas 2-RESTRICTIVE-policyn blockerar direkt authenticated-skrivning.
 * Innehåller AVSIKTLIGT INTE workOrderWrite/timeEntryWrite/bootstrap-actions
 * — STAGING har redan sina egna, mogna atomiska vägar för AO/tid
 * (AOTimeSyncService/ao-time-write) och behöver ingen konkurrerande
 * skrivväg eller en bootstrap-escape-hatch för en installation som redan
 * har riktig data.
 *
 * ISSUE #1 REVIEW FIXES (2026-11-08):
 *   (a) readWithHash/readHashes no longer require a WRITE permission to
 *       perform a READ — reusing KEY_PERMISSIONS for reads would lock the
 *       real, limited STAGING role (dashboard_view/ao_view_own/ao_complete/
 *       ao_time/invoice_view only — confirmed against the real STAGING
 *       database via the coordination issue) out of reading customers/
 *       offers/staff/properties/activityLog/settings at ordinary login,
 *       even though only WRITING those is meant to be restricted. Any
 *       active, authenticated staff member (checkViftAuth() already
 *       verifies this) may now read these 27 keys — same intent as the
 *       existing, broader `store_active_read` RLS policy already grants
 *       for direct access to other tables. Only the key-name allowlist
 *       check remains, so an unknown/opaque key is still rejected.
 *   (a, the sharper fix) readAllWithHashes previously passed a
 *       CLIENT-SUPPLIED key list straight into store_read_all_with_hashes
 *       — a SECURITY DEFINER function that bypasses RLS by design. A
 *       crafted request body naming `vift_workOrders`/`vift_timeEntries`
 *       (or any other store key) would have been served in full, exactly
 *       the "service-role escape path to AO/time" the issue named. Fixed:
 *       the key list is now ALWAYS intersected with the canonical
 *       KEY_PERMISSIONS allowlist server-side before it reaches the RPC —
 *       a requested key outside that set is silently dropped, never
 *       forwarded.
 *   (e) added `writeMerge` — element-level three-way merge for the
 *       array-shaped generic keys, see store_business_key_merge_write()
 *       in 20261108000001_staging_review_fixes.sql. `write` (whole-value
 *       replace) remains for object-shaped keys (settings).
 *
 * POST /functions/v1/store-key-write
 * body: { action: 'write', key, value, expectedHash } |
 *       { action: 'writeMerge', key, upserts, removals } |
 *       { action: 'readWithHash', key } |
 *       { action: 'readHashes', keys } |
 *       { action: 'readAllWithHashes', keys }
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleGetStampStatus, handleSetStampStatus } from './stamp-status.ts'
import { checkViftAuth, hasPerm } from '../_shared/vift-auth.ts'
import { activitiesWriteAllowed } from './activities-policy.ts'
import { buildActivityEntry, MAX_ENTRIES } from './activity-log.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store, no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

// Måste spegla migrationens _staging_business_key_required_perm() EXAKT.
// Detta är enbart WRITE-behörigheten — läsning gated separat, se nedan.
const KEY_PERMISSIONS: Record<string, string> = {
  vift_customers: 'customer_manage',
  vift_properties: 'customer_manage',
  vift_propertyContacts: 'customer_manage',
  vift_propertyRoles: 'customer_manage',
  vift_propertyCategories: 'customer_manage',
  vift_propertyObjects: 'customer_manage',
  vift_deviationCategories: 'customer_manage',
  vift_inspections: 'customer_manage',
  vift_contracts: 'customer_manage',
  vift_offers: 'offer_manage',
  vift_salesOpps: 'sales_manage',
  vift_recurringOrders: 'recurring_manage',
  vift_ronderingar: 'ao_view_all',
  vift_ronderingsmallar: 'ao_view_all',
  vift_avvikelser: 'ao_view_all',
  vift_staff: 'staff_manage',
  vift_roles: 'admin_manage',
  vift_settings: 'admin_manage',
  vift_titles: 'admin_manage',
  vift_articles: 'article_manage',
  vift_priceGroups: 'article_manage',
  vift_priceProfiles: 'article_manage',
  vift_serviceTemplates: 'admin_manage',
  vift_emailTemplates: 'admin_manage',
  vift_activities: 'admin_manage',
  vift_activityLog: 'admin_manage',
  vift_importLogs: 'admin_manage',
  vift_projects: 'customer_manage',
}
const ALLOWED_KEYS = new Set(Object.keys(KEY_PERMISSIONS))

// PR #2 CONSOLIDATED REVIEW FIX (2026-11-09, finding C): invoices,
// offerEvents, offerAttachments, notifications, ronderingspass, and
// projectDocuments each have their OWN, already-correct, dedicated write
// path elsewhere (invoice-write, offer event/attachment logic,
// RonderingSyncService, project-document-upload) and are therefore NOT in
// KEY_PERMISSIONS/ALLOWED_KEYS above — write/writeMerge below still reject
// them exactly as before (`key_not_allowlisted`). But initState()/_poll()
// need to READ their current value too, and readAllWithHashes's
// allowlist intersection (see below) previously used ALLOWED_KEYS alone,
// which silently dropped all six — they were missing from the client
// entirely right after a successful login (a real functional regression,
// not a security fix). This is a READ-ONLY addition: it is consulted
// ONLY by readAllWithHashes below, never by write/writeMerge. None of
// these six keys carry workOrders/timeEntries-style per-row ownership
// sensitivity (no dedicated read-service or RLS lockdown exists for any
// of them) — they were already broadly readable via the plain, now-
// replaced `Storage.getAll()` under `store_active_read`.
const READONLY_EXTRA_KEYS = new Set([
  'vift_invoices', 'vift_offerEvents', 'vift_offerAttachments',
  'vift_notifications', 'vift_ronderingspass', 'vift_projectDocuments',
])
const READABLE_KEYS = new Set([...ALLOWED_KEYS, ...READONLY_EXTRA_KEYS])

function mapRpcError(error: { message?: string } | null): Response | null {
  if (!error) return null
  const msg = String(error.message || '')
  if (msg.includes('stale_write')) return json({ error: 'stale_write' }, 409)
  if (msg.includes('missing_expected_hash')) return json({ error: 'missing_expected_hash' }, 409)
  if (msg.includes('mass_wipe_blocked')) return json({ error: 'mass_wipe_blocked' }, 409)
  if (msg.includes('key_not_allowlisted')) return json({ error: 'key_not_allowlisted' }, 400)
  if (msg.includes('invalid_value_type')) return json({ error: 'invalid_value_type' }, 400)
  if (msg.includes('invalid_element')) return json({ error: 'invalid_element' }, 400)
  if (msg.includes('not_array_key')) return json({ error: 'not_array_key' }, 400)
  // RE-REVIEW FIX (2026-11-09): a pre-existing duplicate id in the store
  // (reported: vift_activityLog) must never be resolved by silently
  // operating on an arbitrary one of the duplicates — surfaced as a
  // distinct, clearly-named 409 so the client/operator knows this needs a
  // real data decision, not a stale_write-style simple retry.
  if (msg.includes('duplicate_id_in_store')) return json({ error: 'duplicate_id_in_store' }, 409)
  if (msg.includes('missing_fields')) return json({ error: 'missing_fields' }, 400)
  if (msg.includes('forbidden')) return json({ error: 'forbidden' }, 403)
  console.error('[store-key-write] RPC-fel:', msg)
  return json({ error: 'write_failed' }, 500)
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const authHeader = req.headers.get('authorization') || ''
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!jwt) return json({ error: 'forbidden' }, 403)

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  // checkViftAuth() verifies the JWT AND that the caller is an active,
  // provisioned staff member (app_users.active) — this is the "any active
  // authenticated user" bar for the read actions below, independent of
  // KEY_PERMISSIONS.
  const auth = await checkViftAuth(supabase, jwt, CORS)
  if (!auth.ok) return auth.response
  const { perms, staffMember } = auth
  const sm = staffMember as Record<string, unknown>
  const callerStaffId = String(sm?.id ?? '')

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }

  const action = String(body.action ?? '')

  // P2-2: identity from verified JWT ONLY. Browser cannot supply a user id.
  if (action === 'getStampStatus') {
    return await handleGetStampStatus(supabase, auth.user.id, json)
  }
  if (action === 'setStampStatus') {
    return await handleSetStampStatus(supabase, auth.user.id, perms, body, json)
  }

  if (action === 'readWithHash') {
    const key = String(body.key ?? '')
    if (!key || !ALLOWED_KEYS.has(key)) return json({ error: 'key_not_allowlisted' }, 400)
    const { data, error } = await supabase.rpc('store_business_key_read_with_hash', { p_key: key })
    if (error) { console.error('[store-key-write] readWithHash RPC-fel:', error.message); return json({ error: 'read_failed' }, 500) }
    return json(data || { value: null, hash: null })
  }

  if (action === 'readHashes') {
    const keys = body.keys
    if (!Array.isArray(keys) || keys.length === 0) return json({ error: 'missing_fields' }, 400)
    const filteredKeys = keys.map(String).filter(k => ALLOWED_KEYS.has(k))
    if (filteredKeys.length === 0) return json({ hashes: {} })
    const { data, error } = await supabase.rpc('store_business_keys_read_hashes', { p_keys: filteredKeys })
    if (error) { console.error('[store-key-write] readHashes RPC-fel:', error.message); return json({ error: 'read_failed' }, 500) }
    return json({ hashes: data || {} })
  }

  /* 2026-11-24: serverstyrd aktivitetslogg (se activity-log.ts). Alla
     aktiva, inloggade användare får logga sina egna händelser; servern sätter
     tid och användare. */
  if (action === 'appendActivity') {
    const built = buildActivityEntry(body.entry, callerStaffId, new Date().toISOString())
    if (!built.ok) return json({ error: built.error }, 400)
    const { data, error } = await supabase.rpc('activity_log_append', { p_entry: built.entry, p_max: MAX_ENTRIES })
    if (error) { console.error('[store-key-write] activity_log_append:', error.message); return json({ error: 'append_failed' }, 500) }
    return json(data || { ok: true, id: built.entry.id })
  }

  if (action === 'write') {
    const key = String(body.key ?? '')
    const value = body.value
    const expectedHash = body.expectedHash === undefined ? null : String(body.expectedHash)
    if (!key || value === undefined) return json({ error: 'missing_fields' }, 400)
    if (key === 'vift_activityLog') return json({ error: 'append_only' }, 403)

    const requiredPerm = KEY_PERMISSIONS[key]
    if (!requiredPerm) return json({ error: 'key_not_allowlisted' }, 400)
    const authorized = hasPerm(perms, requiredPerm)

    const { data, error } = await supabase.rpc('store_business_key_write', {
      p_key: key,
      p_new_value: value,
      p_expected_hash: expectedHash,
      p_caller_authorized: authorized,
      p_actor_id: callerStaffId,
    })
    const err = mapRpcError(error)
    if (err) return err
    return json(data || {})
  }

  if (action === 'writeMerge') {
    // PR #2 review fix (blocker 1): removals now carry {id, previous} —
    // the element's value as this session last read it — same shape as
    // upserts, so the RPC can apply the identical conflict check to a
    // deletion that it already applies to an update. A bare id list (the
    // pre-fix shape) can no longer express "I believe this value is still
    // current", so it is rejected outright rather than silently accepted
    // as "no version check" — that silent-accept IS the bug being fixed.
    const key = String(body.key ?? '')
    const upserts = body.upserts
    const removals = Array.isArray(body.removals) ? body.removals : []
    if (!key || !Array.isArray(upserts)) return json({ error: 'missing_fields' }, 400)
    for (const r of removals) {
      if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id) {
        return json({ error: 'invalid_element' }, 400)
      }
    }

    const requiredPerm = KEY_PERMISSIONS[key]
    if (!requiredPerm) return json({ error: 'key_not_allowlisted' }, 400)
    if (key === 'vift_activityLog') return json({ error: 'append_only' }, 403)
    /* TASK-01 (2026-11-24): per-post-regel för uppgifter — se
       activities-policy.ts. Bedöms på `previous`, som RPC:n verifierar mot
       serverns aktuella element under radlås. */
    const authorized = hasPerm(perms, requiredPerm)
      || (key === 'vift_activities' && activitiesWriteAllowed(upserts as unknown[], removals, perms, callerStaffId).ok)

    const { data, error } = await supabase.rpc('store_business_key_merge_write', {
      p_key: key,
      p_upserts: upserts,
      p_removals: removals,
      p_caller_authorized: authorized,
      p_actor_id: callerStaffId,
    })
    const err = mapRpcError(error)
    if (err) return err
    return json(data || {})
  }

  if (action === 'readAllWithHashes') {
    // ISSUE #1 FIX: never forward a client-supplied key list unfiltered —
    // that was the real escape path. Always intersect with the canonical
    // allowlist; a name outside it is silently dropped, never queried.
    const requested = Array.isArray(body.keys) && body.keys.length > 0
      ? (body.keys as unknown[]).map(String)
      : Array.from(READABLE_KEYS)
    const businessFullKeys = requested.filter(k => READABLE_KEYS.has(k))
    const { data, error } = await supabase.rpc('store_read_all_with_hashes', {
      p_business_keys: businessFullKeys,
    })
    if (error) { console.error('[store-key-write] readAllWithHashes RPC-fel:', error.message); return json({ error: 'read_failed' }, 500) }
    const raw = (data && data.data) || {}
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(raw)) {
      const short = k.startsWith('vift_') ? k.slice('vift_'.length) : k
      out[short] = raw[k]
    }
    return json({ data: out, hashes: (data && data.hashes) || {} })
  }

  return json({ error: 'unknown_action' }, 400)
})
