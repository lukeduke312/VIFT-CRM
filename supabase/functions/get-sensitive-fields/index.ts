/**
 * get-sensitive-fields — Hämta känsliga objektfält (åtkomstinformation)
 * verify_jwt: true (Supabase gateway validerar JWT)
 *
 * Autentisering:
 *  1. Giltig Supabase JWT (gateway + getUser)
 *  2. Aktiv VIFT-användare, aktiv personalpost och aktiv roll (checkViftAuth, _shared/vift-auth.ts)
 *  3. Behörighet, prövad i RPC:n sensitive_fields_read (T4-C, migration 20261128000012):
 *       - objects_sensitive eller 'all': som förut, alla fält för objektet/fastigheten;
 *       - objects_access_assigned (D-05): bara objektet eller fastigheten på en EGEN TILLDELAD AKTIV
 *         AO (nytt/planerad/pågående, inte låst, inte pool) eller — när rondering_utfor är verkställd
 *         (T4-D) — fastigheten på ett eget tilldelat aktivt ronderingspass.
 *     Kontrollen, läsningen och revisionsraden (allowed/denied, UTAN värden) görs i EN transaktion
 *     med vift_workOrders/vift_ronderingspass låsta. Inget värde lämnar funktionen utan att dess
 *     revisionsrad är bekräftad (fail closed: 500 audit_unavailable).
 *
 * Input:  POST { objectId?: string, propertyId?: string, workOrderId?: string, passId?: string }
 *         objectId ELLER propertyId krävs. workOrderId/passId begränsar den tilldelade vägen till
 *         just det uppdraget (klienten skickar dem; utan dem prövas alla egna aktiva uppdrag).
 *
 * Output 200: { doorCode, keyInformation, keyReceipt, alarmInformation, accessInformation, accessCode }
 *         (null för fält som saknas; keyReceipt bara via objects_sensitive).
 * 400 missing_fields · 403 forbidden (behörighet saknas) · 403 forbidden/not_assigned · 500 audit_unavailable
 */

// I5 fix 2026-11-12: pinned to the exact version already bundled in the deployed v7.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.8'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { checkViftAuth } from '../_shared/vift-auth.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Cache-Control': 'no-store',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const idOf = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s && s.length <= 200 ? s : null;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!jwt) return json({ error: 'Unauthorized' }, 401);

    // Service role-klient (enda som kan läsa property_sensitive_access)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    const auth = await checkViftAuth(supabase, jwt, CORS);
    if (!auth.ok) return auth.response;
    const { user, userEmail, staffMember, perms } = auth;

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const objectId = idOf(body.objectId);
    const propertyId = idOf(body.propertyId);
    if (!objectId && !propertyId) return json({ error: 'missing_fields' }, 400);

    const { data, error } = await supabase.rpc('sensitive_fields_read', {
      p_object_id: objectId,
      p_property_id: objectId ? null : propertyId,
      p_work_order_id: idOf(body.workOrderId),
      p_pass_id: idOf(body.passId),
      p_caller_staff_id: String((staffMember as Record<string, unknown>)?.id ?? ''),
      p_caller_perms: perms,
      p_user_id: user.id,
      p_user_email: userEmail,
    });
    const r = (data ?? null) as { ok?: unknown; reason?: unknown; audit_id?: unknown; fields?: Record<string, unknown> } | null;
    if (error || !r || !r.audit_id) {
      // Ingen bekräftad revisionsrad → inga värden (I5-härdningen, oförändrad princip).
      console.error('[get-sensitive-fields] AUDIT_WRITE_FAILED, values withheld', error?.message ?? 'unexpected result');
      return json({ error: 'audit_unavailable' }, 500);
    }
    if (r.ok !== true) {
      return r.reason === 'not_assigned'
        ? json({ error: 'forbidden', reason: 'not_assigned' }, 403)
        : json({ error: 'forbidden' }, 403);
    }
    const f = r.fields || {};
    return json({
      doorCode:          f.doorCode          ?? null,
      keyInformation:    f.keyInformation    ?? null,
      keyReceipt:        f.keyReceipt        ?? null,
      alarmInformation:  f.alarmInformation  ?? null,
      accessInformation: f.accessInformation ?? null,
      accessCode:        f.accessCode        ?? null,
    });
  } catch (e: any) {
    console.error('[get-sensitive-fields]', e?.message ?? e);
    return json({ error: 'Internal server error' }, 500);
  }
});
