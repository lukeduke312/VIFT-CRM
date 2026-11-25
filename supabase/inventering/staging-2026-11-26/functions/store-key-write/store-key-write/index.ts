/**
 * store-key-write — Supabase Edge Function (STAGING-variant), v5 2026-11-25 (C-5: rollprojicerad läsning).
 * Kommenterad källa: supabase/functions/store-key-write/index.ts. Återställning: v4 i
 * supabase/backup/ef-installerade-2026-11-25/store-key-write-v4/.
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleGetStampStatus, handleSetStampStatus } from './stamp-status.ts'
import { checkViftAuth, hasPerm } from '../_shared/vift-auth.ts'
import { activitiesWriteAllowed } from './activities-policy.ts'
import { buildActivityEntry, MAX_ENTRIES, rateLimited } from './activity-log.ts'

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
  const auth = await checkViftAuth(supabase, jwt, CORS)
  if (!auth.ok) return auth.response
  const { perms, staffMember } = auth
  const sm = staffMember as Record<string, unknown>
  const callerStaffId = String(sm?.id ?? '')

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }

  const action = String(body.action ?? '')

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
    const d = (data || { value: null, hash: null }) as Record<string, unknown>
    const proj = await supabase.rpc('vift_store_project', { p_key: key, p_value: d.value ?? null, p_perms: perms })
    if (proj.error) { console.error('[store-key-write] readWithHash projektion:', proj.error.message); return json({ error: 'read_failed' }, 500) }
    return json({ ...d, value: proj.data ?? null })
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

  if (action === 'appendActivity') {
    if (rateLimited(callerStaffId, Date.now())) return json({ error: 'rate_limited' }, 429)
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
    const requested = Array.isArray(body.keys) && body.keys.length > 0
      ? (body.keys as unknown[]).map(String)
      : Array.from(READABLE_KEYS)
    const businessFullKeys = requested.filter(k => READABLE_KEYS.has(k))
    const { data, error } = await supabase.rpc('store_read_all_with_hashes_projected', {
      p_business_keys: businessFullKeys,
      p_perms: perms,
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
