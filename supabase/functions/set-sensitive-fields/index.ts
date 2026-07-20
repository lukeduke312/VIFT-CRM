/**
 * set-sensitive-fields — Spara känsliga objektfält
 * verify_jwt: true (Supabase gateway validerar JWT)
 *
 * Autentisering (tre lager):
 *  1. Giltig Supabase JWT
 *  2. Aktiv VIFT-användare (app_users.active = true)
 *  3. Rättigheten objects_sensitive ELLER customer_manage (skrivning)
 *     — läsning kräver objects_sensitive, men admin/förvaltare med
 *       customer_manage behöver kunna SÄTTA värden vid objektredigering.
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

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
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

    // Skrivning: objects_sensitive ELLER customer_manage krävs
    const canWrite =
      perms.includes('all') ||
      perms.includes('objects_sensitive') ||
      perms.includes('customer_manage');
    if (!canWrite) return jsonErr('Forbidden', 403);

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

    // Bygg update-objekt — utelämnade nycklar uppdateras INTE
    const record: Record<string, any> = {
      updated_at: new Date().toISOString(),
      updated_by: userEmail,
    };
    if (objectId)                       record.object_id          = objectId;
    if (propertyId)                     record.property_id        = propertyId;
    if (doorCode          !== undefined) record.door_code          = doorCode          || null;
    if (keyInformation    !== undefined) record.key_information    = keyInformation    || null;
    if (keyReceipt        !== undefined) record.key_receipt        = keyReceipt        || null;
    if (alarmInformation  !== undefined) record.alarm_information  = alarmInformation  || null;
    if (accessInformation !== undefined) record.access_information = accessInformation || null;
    if (accessCode        !== undefined) record.access_code        = accessCode        || null;

    // Kontrollera om befintlig rad finns
    let existingId: string | null = null;
    if (objectId) {
      const { data } = await supabase
        .from('property_sensitive_access')
        .select('id')
        .eq('object_id', objectId)
        .maybeSingle();
      existingId = data?.id ?? null;
    } else {
      const { data } = await supabase
        .from('property_sensitive_access')
        .select('id')
        .eq('property_id', propertyId!)
        .is('object_id', null)
        .maybeSingle();
      existingId = data?.id ?? null;
    }

    if (existingId) {
      const { error } = await supabase
        .from('property_sensitive_access')
        .update(record)
        .eq('id', existingId);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('property_sensitive_access')
        .insert(record);
      if (error) throw error;
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
