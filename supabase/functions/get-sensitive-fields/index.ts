/**
 * get-sensitive-fields — Hämta känsliga objektfält
 * verify_jwt: true (Supabase gateway validerar JWT)
 *
 * Autentisering (tre lager):
 *  1. Giltig Supabase JWT (hanteras av gateway)
 *  2. Aktiv VIFT-användare (app_users.active = true)
 *  3. Rättigheten objects_sensitive (eller 'all') i användarens roll
 *
 * Input:  POST { objectId?: string, propertyId?: string }
 *         Antingen objectId ELLER propertyId krävs.
 *
 * Output: { doorCode, keyInformation, keyReceipt, alarmInformation,
 *           accessInformation, accessCode } — null för fält som saknas.
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
    // 1. Extrahera JWT (gateway har redan validerat signaturen)
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!jwt) return jsonErr('Unauthorized', 401);

    // 2. Service role-klient (enda som kan läsa property_sensitive_access)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    // 3. Hämta auth-användare via JWT
    const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt);
    if (authErr || !user) return jsonErr('Unauthorized', 401);

    // 4. Kontrollera aktiv VIFT-användare (app_users)
    const { data: appUser } = await supabase
      .from('app_users')
      .select('active')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!appUser?.active) return jsonErr('Forbidden', 403);

    // 5. Slå upp personalpost via e-post (email → staff → role → permissions)
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

    // 6. Hämta rollens behörigheter
    const { data: rolesRow } = await supabase
      .from('store')
      .select('value')
      .eq('key', 'vift_roles')
      .maybeSingle();

    const roles: any[] = Array.isArray(rolesRow?.value) ? rolesRow.value : [];
    const role = roles.find((r) => r.id === staffMember.role);
    const perms: string[] = role?.permissions || [];

    if (!perms.includes('all') && !perms.includes('objects_sensitive')) {
      // Auditlogg: nekad läsning
      await supabase.from('sensitive_access_audit').insert({
        user_id: user.id, user_email: userEmail, action: 'read',
        object_id: null, property_id: null, fields: [], status: 'denied',
        detail: 'objects_sensitive saknas'
      }).catch(() => {});
      return jsonErr('Forbidden: objects_sensitive required', 403);
    }

    // 7. Parsa request-body
    const body = await req.json().catch(() => ({}));
    const { objectId, propertyId } = body as { objectId?: string; propertyId?: string };

    if (!objectId && !propertyId) {
      return jsonErr('objectId or propertyId required', 400);
    }

    // 8. Hämta från property_sensitive_access
    let query = supabase.from('property_sensitive_access').select('*');
    if (objectId) {
      query = query.eq('object_id', objectId);
    } else {
      query = query.eq('property_id', propertyId!).is('object_id', null);
    }

    const { data: rows, error: dbErr } = await query.limit(1);
    if (dbErr) throw dbErr;

    const row = rows?.[0] ?? null;

    // Auditlogg: godkänd läsning — logga fälttyper, ALDRIG värdena
    const returnedFields = row ? [
      row.door_code          ? 'doorCode'          : null,
      row.key_information    ? 'keyInformation'    : null,
      row.key_receipt        ? 'keyReceipt'        : null,
      row.alarm_information  ? 'alarmInformation'  : null,
      row.access_information ? 'accessInformation' : null,
      row.access_code        ? 'accessCode'        : null,
    ].filter(Boolean) : [];
    await supabase.from('sensitive_access_audit').insert({
      user_id: user.id, user_email: userEmail, action: 'read',
      object_id: objectId ?? null, property_id: propertyId ?? null,
      fields: returnedFields, status: 'allowed', detail: null
    }).catch(() => {});

    return new Response(
      JSON.stringify({
        doorCode:          row?.door_code          ?? null,
        keyInformation:    row?.key_information    ?? null,
        keyReceipt:        row?.key_receipt        ?? null,
        alarmInformation:  row?.alarm_information  ?? null,
        accessInformation: row?.access_information ?? null,
        accessCode:        row?.access_code        ?? null,
      }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (e: any) {
    console.error('[get-sensitive-fields]', e?.message ?? e);
    return jsonErr('Internal server error', 500);
  }
});
