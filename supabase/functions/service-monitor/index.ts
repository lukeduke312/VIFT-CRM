/**
 * service-monitor — Supabase Edge Function (punkt 40–43)
 *
 * Daglig server-side körning av serviceintervall-bevakaren.
 * Anropas via pg_cron (se MASTERPLAN — Driftsättning) eller manuellt.
 *
 * Vad den gör:
 *   1. Läser vift_properties, vift_workOrders, vift_staff från store-tabellen
 *   2. Itererar alla aktiva serviceintervall
 *   3. Skickar web-push till ansvarig personal för förfallna/närstående
 *   4. Skapar automatisk AO om autoCreateAO = true och tröskeln nåtts
 *   5. Skriver tillbaka uppdaterade blobs (idempotensmarkeringar)
 *   6. Sparar körlogg i vift_serviceMonitorLog (senaste 90 körningar)
 *
 * Autentisering:
 *   Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>   (cron-anrop)
 *   eller X-Monitor-Secret: <SERVICE_MONITOR_SECRET>     (alternativ nyckel)
 *
 * Supabase Secrets som krävs:
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL
 *   SERVICE_MONITOR_SECRET   (valfri extra autentisering)
 *
 * VAPID private key läggs aldrig i config.js eller frontend — bara i Secrets.
 */

import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @deno-types="npm:@types/web-push@3.6.3"
import webpush from 'npm:web-push@3.6.7'

/* ── Konstanter ───────────────────────────────────────────── */
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const MONITOR_SECRET    = Deno.env.get('SERVICE_MONITOR_SECRET')    ?? ''
const VAPID_EMAIL       = Deno.env.get('VAPID_EMAIL')               ?? 'mailto:admin@viftfast.se'
const VAPID_PUBLIC_KEY  = Deno.env.get('VAPID_PUBLIC_KEY')          ?? ''
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')         ?? ''

const STORE_PREFIX    = 'vift_'
const LOG_MAX_ENTRIES = 90

/* ── CORS ─────────────────────────────────────────────────── */
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-monitor-secret'
}

/* ── VAPID-konfiguration ─────────────────────────────────── */
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
}

/* ── Typdeklarationer ─────────────────────────────────────── */
interface ServiceInterval {
  id:                            string
  title:                         string
  category:                      string
  description:                   string
  objectId?:                     string
  intervalType:                  string
  intervalValue:                 number
  lastDone:                      string
  nextDue:                       string
  responsibleStaffId:            string
  supplier:                      string
  reminderDays:                  number
  active:                        boolean
  autoCreateAO:                  boolean
  aoCreateDaysBefore:            number
  aoTitle:                       string
  aoDescription:                 string
  aoCategory:                    string
  aoPriority:                    string
  aoStaff:                       string[]
  lastNotificationSentForDueDate:string
  lastAOGeneratedForDueDate:     string
  lastGeneratedAOId:             string
  history:                       unknown[]
  createdAt:                     string
  updatedAt:                     string
}

interface Property {
  id:              string
  name:            string
  address:         string
  customerId?:     string
  serviceIntervals:ServiceInterval[]
}

interface Staff {
  id:    string
  email: string
  firstName: string
  lastName:  string
}

interface WorkOrder {
  id:          string
  title:       string
  description: string
  status:      string
  priority:    string
  category:    string
  customerId:  string
  propertyId:  string
  propertyName:string
  address:     string
  scheduledDate:string
  staff:       string[]
  source:      string
  sourceIntervalId: string
  createdAt:   string
  updatedAt:   string
  [key: string]: unknown
}

interface RunLog {
  ts:           string
  processed:    number
  notified:     number
  aoCreated:    number
  aoIds:        string[]
  errors:       string[]
  durationMs:   number
}

/* ── Handler ─────────────────────────────────────────────── */
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  const startMs = Date.now()

  /* ── Autentisering ──────────────────────────────────────── */
  const authHeader    = req.headers.get('Authorization') ?? ''
  const monitorSecret = req.headers.get('X-Monitor-Secret') ?? ''

  const validServiceRole  = authHeader === `Bearer ${SERVICE_ROLE_KEY}` && SERVICE_ROLE_KEY !== ''
  const validMonitorSecret = MONITOR_SECRET !== '' && monitorSecret === MONITOR_SECRET

  if (!validServiceRole && !validMonitorSecret) {
    return json({ error: 'Ej behörig' }, 401)
  }

  /* ── Supabase-klient (service role) ────────────────────── */
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  const errors: string[] = []
  let notified  = 0
  let aoCreated = 0
  const aoIds:   string[] = []

  try {
    /* ── Läs data från store ────────────────────────────── */
    const { data: storeRows, error: storeErr } = await supabase
      .from('store')
      .select('key, value')
      .in('key', [
        STORE_PREFIX + 'properties',
        STORE_PREFIX + 'workOrders',
        STORE_PREFIX + 'staff'
      ])

    if (storeErr) throw new Error('store-läsfel: ' + storeErr.message)

    const byKey: Record<string, unknown> = {}
    for (const row of (storeRows ?? [])) {
      byKey[row.key] = row.value
    }

    const properties:  Property[]   = (byKey[STORE_PREFIX + 'properties']  as Property[])  ?? []
    const workOrders:  WorkOrder[]  = (byKey[STORE_PREFIX + 'workOrders']  as WorkOrder[]) ?? []
    const staffList:   Staff[]      = (byKey[STORE_PREFIX + 'staff']       as Staff[])     ?? []

    const today = todayISO()

    /* ── Staff-e-post → auth user-ID (för riktad push) ──── */
    const emailToAuthId = await buildEmailToAuthIdMap(supabase, staffList, errors)

    /* ── Hämta aktiva push-subscriptions ────────────────── */
    const { data: allSubs, error: subsErr } = await supabase
      .from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth_key')
      .is('revoked_at', null)

    if (subsErr) {
      errors.push('push_subscriptions-fel: ' + subsErr.message)
    }
    const subs = allSubs ?? []

    /* Bygg userId → subscriptions-map */
    const subsByUser: Record<string, typeof subs> = {}
    for (const sub of subs) {
      if (!subsByUser[sub.user_id]) subsByUser[sub.user_id] = []
      subsByUser[sub.user_id].push(sub)
    }

    /* ── VAPID-tillgänglighet ────────────────────────────── */
    const vapidOk = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY)
    if (!vapidOk) {
      errors.push('VAPID-nycklar saknas — push-notiser utelämnade')
    }

    /* ── Bearbeta serviceintervall ───────────────────────── */
    let propertiesChanged = false
    let workOrdersChanged = false

    for (const prop of properties) {
      if (!Array.isArray(prop.serviceIntervals)) continue

      for (const si of prop.serviceIntervals) {
        if (!si.active || !si.nextDue) continue

        const daysLeft  = daysUntil(si.nextDue, today)
        const reminderD = Number(si.reminderDays ?? 14)
        const isOverdue    = daysLeft < 0
        const isDueSoon    = daysLeft >= 0 && daysLeft <= 7
        const isApproaching = daysLeft > 7 && daysLeft <= reminderD
        const needsNotif   = isOverdue || isDueSoon || isApproaching

        const periodKey = `${si.id}::${si.nextDue}`

        /* ── Push-notis (punkt 42) ─────────────────────── */
        if (needsNotif && vapidOk && si.lastNotificationSentForDueDate !== periodKey) {
          const staffEmail = lookupStaffEmail(si.responsibleStaffId, staffList)
          const authUserId = staffEmail ? emailToAuthId[staffEmail.toLowerCase()] : null

          const title = isOverdue
            ? `⚠️ Förfallet serviceintervall`
            : `Serviceintervall förfaller snart`
          const body  = buildNotifBody(si, prop, daysLeft)
          const url   = `/#/fastigheter/${prop.id}`
          const payload = JSON.stringify({ title, body, url })

          /* Riktad push till ansvarig, annars broadcast */
          const targetSubs = authUserId && subsByUser[authUserId]
            ? subsByUser[authUserId]
            : subs   // broadcast om ingen ansvarig hittas

          const revokedIds: string[] = []
          let sent = 0
          await Promise.allSettled(
            targetSubs.map(async (sub) => {
              try {
                await webpush.sendNotification(
                  { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
                  payload
                )
                sent++
              } catch (err: unknown) {
                const status = (err as { statusCode?: number }).statusCode
                if (status === 410 || status === 404) {
                  revokedIds.push(sub.id)
                } else {
                  errors.push(`push-fel ${si.id}: ${(err as Error).message}`)
                }
              }
            })
          )

          /* Markera revokade subscriptions */
          if (revokedIds.length > 0) {
            await supabase
              .from('push_subscriptions')
              .update({ revoked_at: new Date().toISOString() })
              .in('id', revokedIds)
          }

          if (sent > 0 || targetSubs.length === 0) {
            si.lastNotificationSentForDueDate = periodKey
            si.updatedAt = new Date().toISOString()
            propertiesChanged = true
            notified++
          }
        }

        /* ── Auto-AO (punkt 43) ─────────────────────────── */
        if (
          si.autoCreateAO &&
          si.lastAOGeneratedForDueDate !== periodKey
        ) {
          const threshold = Number(si.aoCreateDaysBefore ?? 0)
          const shouldCreate = daysLeft !== null && daysLeft <= threshold

          if (shouldCreate) {
            const ao = buildWorkOrder(si, prop, workOrders)
            workOrders.push(ao)
            si.lastAOGeneratedForDueDate = periodKey
            si.lastGeneratedAOId         = ao.id
            si.updatedAt                 = new Date().toISOString()
            propertiesChanged = true
            workOrdersChanged = true
            aoCreated++
            aoIds.push(ao.id)
          }
        }
      }
    }

    /* ── Skriv tillbaka ändrade blobs ────────────────────── */
    const upserts: { key: string; value: unknown }[] = []
    if (propertiesChanged) {
      upserts.push({ key: STORE_PREFIX + 'properties', value: properties })
    }
    if (workOrdersChanged) {
      upserts.push({ key: STORE_PREFIX + 'workOrders', value: workOrders })
    }

    if (upserts.length > 0) {
      const { error: writeErr } = await supabase
        .from('store')
        .upsert(upserts, { onConflict: 'key' })
      if (writeErr) {
        errors.push('store-skrivfel: ' + writeErr.message)
      }
    }

    /* ── Körlogg ─────────────────────────────────────────── */
    const processed = properties.reduce(
      (n, p) => n + (Array.isArray(p.serviceIntervals) ? p.serviceIntervals.filter(s => s.active && s.nextDue).length : 0),
      0
    )

    const runEntry: RunLog = {
      ts:         new Date().toISOString(),
      processed,
      notified,
      aoCreated,
      aoIds,
      errors,
      durationMs: Date.now() - startMs
    }

    await appendRunLog(supabase, runEntry, errors)

    return json({
      ok:        true,
      processed,
      notified,
      aoCreated,
      aoIds,
      errors,
      durationMs: Date.now() - startMs
    })

  } catch (err: unknown) {
    const msg = (err as Error).message || 'Internt fel'
    console.error('[service-monitor] oväntat fel:', err)

    try {
      await appendRunLog(supabase, {
        ts: new Date().toISOString(), processed: 0, notified: 0,
        aoCreated: 0, aoIds: [], errors: [msg], durationMs: Date.now() - startMs
      }, [])
    } catch { /* loggfel är icke-kritiskt */ }

    return json({ error: msg }, 500)
  }
})

/* ── Hjälpfunktioner ──────────────────────────────────────── */

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysUntil(nextDue: string, today: string): number {
  const t = new Date(today + 'T12:00:00')
  const d = new Date(nextDue + 'T12:00:00')
  return Math.round((d.getTime() - t.getTime()) / 86400000)
}

function lookupStaffEmail(staffId: string, staffList: Staff[]): string | null {
  if (!staffId) return null
  const s = staffList.find(x => x.id === staffId)
  return (s && s.email) ? s.email.trim() : null
}

/*
 * Bygg e-post → Supabase auth user ID-karta via admin.listUsers().
 * Hanterar paginering (max 1000 per sida).
 */
async function buildEmailToAuthIdMap(
  supabase: ReturnType<typeof createClient>,
  staffList: Staff[],
  errors: string[]
): Promise<Record<string, string>> {
  const map: Record<string, string> = {}
  const neededEmails = new Set(
    staffList.map(s => s.email?.toLowerCase()).filter(Boolean)
  )
  if (neededEmails.size === 0) return map

  try {
    let page = 1
    const perPage = 1000
    while (true) {
      const { data, error } = await (supabase.auth.admin as {
        listUsers: (opts: { page: number; perPage: number }) => Promise<{ data: { users: Array<{ id: string; email?: string }> } | null; error: unknown }>
      }).listUsers({ page, perPage })

      if (error || !data) break
      for (const u of data.users) {
        if (u.email) map[u.email.toLowerCase()] = u.id
      }
      if (data.users.length < perPage) break
      page++
    }
  } catch (e: unknown) {
    errors.push('auth.admin.listUsers-fel: ' + (e as Error).message)
  }

  return map
}

function buildNotifBody(si: ServiceInterval, prop: Property, daysLeft: number): string {
  const propName = prop.name || prop.address || prop.id
  if (daysLeft < 0) {
    return `${si.title} — ${propName} förfallet med ${Math.abs(daysLeft)} dag${Math.abs(daysLeft) === 1 ? '' : 'ar'}.`
  }
  if (daysLeft === 0) {
    return `${si.title} — ${propName} förfaller idag.`
  }
  return `${si.title} — ${propName} förfaller om ${daysLeft} dag${daysLeft === 1 ? '' : 'ar'}.`
}

/*
 * Bygg ett AO-objekt som matchar WorkOrderService.create()-schemat.
 * Replikerar newId-logiken från state.js.
 */
function buildWorkOrder(si: ServiceInterval, prop: Property, workOrders: WorkOrder[]): WorkOrder {
  const id    = nextWorkOrderId(workOrders)
  const now   = new Date().toISOString()
  const title = si.aoTitle || si.title

  return {
    id,
    title,
    description:      si.aoDescription || si.description || '',
    status:           'pool',
    priority:         si.aoPriority    || 'normal',
    category:         si.aoCategory    || si.category    || '',
    customerId:       prop.customerId  || '',
    propertyId:       prop.id,
    propertyName:     prop.name        || '',
    address:          prop.address     || '',
    scheduledDate:    si.nextDue       || '',
    staff:            si.aoStaff       || [],
    source:           'service_interval',
    sourceIntervalId: si.id,
    /* Idempotensmarkering — klienten ignorerar auto-push för dessa */
    historicalImport: false,
    autoGenerated:    true,
    createdAt:        now,
    updatedAt:        now
  }
}

/* Replikerar newId(arr, 'AO') från state.js */
function nextWorkOrderId(workOrders: WorkOrder[]): string {
  if (!workOrders.length) return 'AO-001'
  const nums = workOrders
    .map(x => parseInt((x.id ?? '').replace(/[^0-9]/g, ''), 10))
    .filter(n => !isNaN(n))
  const max = nums.length > 0 ? Math.max(...nums) : 0
  return `AO-${String(max + 1).padStart(3, '0')}`
}

/* Lägg till körlogg och håll max LOG_MAX_ENTRIES poster */
async function appendRunLog(
  supabase: ReturnType<typeof createClient>,
  entry: RunLog,
  errors: string[]
): Promise<void> {
  try {
    const { data: rows } = await supabase
      .from('store')
      .select('value')
      .eq('key', STORE_PREFIX + 'serviceMonitorLog')
      .maybeSingle()

    const log: RunLog[] = Array.isArray(rows?.value) ? rows.value as RunLog[] : []
    log.unshift(entry)
    if (log.length > LOG_MAX_ENTRIES) log.length = LOG_MAX_ENTRIES

    const { error } = await supabase
      .from('store')
      .upsert({ key: STORE_PREFIX + 'serviceMonitorLog', value: log }, { onConflict: 'key' })
    if (error) errors.push('logg-skrivfel: ' + error.message)
  } catch (e: unknown) {
    console.error('[service-monitor] logg-fel:', e)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
}
