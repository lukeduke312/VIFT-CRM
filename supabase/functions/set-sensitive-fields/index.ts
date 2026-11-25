/**
 * set-sensitive-fields — Spara känsliga objektfält
 * verify_jwt: true (Supabase gateway validerar JWT)
 *
 * Autentisering (tre lager):
 *  1. Giltig Supabase JWT
 *  2. Aktiv VIFT-användare (app_users.active = true)
 *  3. Rättigheten objects_sensitive (eller 'all') — samma krav som läsning.
 *
 * Input:  POST {
 *   objectId?:         string,
 *   propertyId?:       string,
 *   doorCode?:         string | null,
 *   keyInformation?:   string | null,
 *   keyReceipt?:       string | null,
 *   alarmInformation?: string | null,
 *   accessInformation?: string | null,
 *   accessCode?:       string | null,
 * }
 * Antingen objectId ELLER propertyId krävs.
 * Utelämnade fält uppdateras INTE (partial update).
 *
 * Output: { ok: true }
 */

// I5 fix 2026-11-12: pinned to the exact version already bundled in the deployed v7.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.8'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

function jsonErr(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!jwt) return jsonErr('Unauthorized', 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt);
    if (authErr || !user) return jsonErr('Unauthorized', 401);

    // Aktiv VIFT-användare
    const { data: appUser } = await supabase
      .from('app_users')
      .select('active')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!appUser?.active) return jsonErr('Forbidden', 403);

    const userEmail = user.email?.toLowerCase();
    if (!userEmail) return jsonErr('Forbidden', 403);

    const { data: staffRow } = await supabase
      .from('store')
      .select('value')
      .eq('key', 'vift_staff')
      .maybeSingle();

    const staffList: any[] = Array.isArray(staffRow?.value) ? staffRow.value : [];
    const staffMember = staffList.find(
      (s) => s.email && s.email.toLowerCase() === userEmail && s.active
    );
    if (!staffMember) return jsonErr('Forbidden', 403);

    const { data: rolesRow } = await supabase
      .from('store')
      .select('value')
      .eq('key', 'vift_roles')
      .maybeSingle();

    const roles: any[] = Array.isArray(rolesRow?.value) ? rolesRow.value : [];
    const role = roles.find((r) => r.id === staffMember.role);
    const perms: string[] = role?.permissions || [];

    // Skrivning: objects_sensitive (eller 'all') krävs — customer_manage räcker INTE
    const canWrite =
      perms.includes('all') ||
      perms.includes('objects_sensitive');
    if (!canWrite) {
      // I5 fix: PostgrestBuilder has no .catch() in supabase-js 2.110.8 — check the result instead.
      // Denied path: nothing is read or written, so the answer stays 403 even if this audit
      // insert fails (a 500 would hide the denial). The failure is logged with a fixed marker.
      const { error: auditErr } = await supabase.from('sensitive_access_audit').insert({
        user_id: user.id, user_email: userEmail, action: 'write',
        object_id: null, property_id: null, fields: [], status: 'denied',
        detail: 'objects_sensitive saknas'
      });
      if (auditErr) console.error('[set-sensitive-fields] AUDIT_WRITE_FAILED (denied attempt)', auditErr.message);
      return jsonErr('Forbidden', 403);
    }

    const body = await req.json().catch(() => ({}));
    const {
      objectId,
      propertyId,
      doorCode,
      keyInformation,
      keyReceipt,
      alarmInformation,
      accessInformation,
      accessCode,
    } = body as Record<string, string | null | undefined>;

    if (!objectId && !propertyId) {
      return jsonErr('objectId or propertyId required', 400);
    }

    // Utelämnade nycklar uppdateras INTE (partial update); "" → null, som tidigare.
    const sent: Record<string, unknown> = {
      doorCode, keyInformation, keyReceipt, alarmInformation, accessInformation, accessCode,
    };
    const fields: Record<string, unknown> = {};
    for (const k of Object.keys(sent)) {
      if (sent[k] !== undefined) fields[k] = sent[k] || null;
    }

    // I5 hardening 2026-11-12: the data write AND its mandatory audit row run in ONE SQL
    // transaction (public.sensitive_fields_write). Either both commit or neither does.
    // 200 is returned only after that transaction committed and reported its audit row id.
    const { data: w, error: wErr } = await supabase.rpc('sensitive_fields_write', {
      p_object_id: objectId ? String(objectId) : null,
      p_property_id: propertyId ? String(propertyId) : null,
      p_fields: fields,
      p_user_id: user.id,
      p_user_email: userEmail,
    });
    const result = (w ?? null) as { ok?: unknown; audit_id?: unknown } | null;
    if (wErr || !result || result.ok !== true || !result.audit_id) {
      console.error('[set-sensitive-fields] write+audit not confirmed', wErr?.message ?? 'unexpected result');
      return jsonErr('write_not_confirmed', 500);
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (e: any) {
    console.error('[set-sensitive-fields]', e?.message ?? e);
    return jsonErr('Internal server error', 500);
  }
});
