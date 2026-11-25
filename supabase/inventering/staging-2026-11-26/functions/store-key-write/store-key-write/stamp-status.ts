// deno-lint-ignore-file no-explicit-any
type Json = Record<string, any>
type SupabaseLike = any
type JsonFn = (body: unknown, status?: number) => Response

function hasPermLocal(perms: string[], perm: string): boolean {
  return Array.isArray(perms) && (perms.includes('all') || perms.includes(perm))
}

export async function handleGetStampStatus(
  supabase: SupabaseLike, authUserId: string, json: JsonFn,
): Promise<Response> {
  if (!authUserId) return json({ error: 'forbidden' }, 403)
  const { data, error } = await supabase.rpc('store_read_stamp_status', { p_auth_user_id: authUserId })
  if (error) {
    console.error('[store-key-write] store_read_stamp_status RPC-fel:', error.message)
    return json({ error: 'read_failed' }, 500)
  }
  const d = data || {}
  return json({ active: !!d.active, ts: d.ts ?? null, aoId: d.aoId ?? null, hasRow: !!d.hasRow, revision: Number(d.revision ?? 0) })
}

export async function handleSetStampStatus(
  supabase: SupabaseLike, authUserId: string, perms: string[], body: Json, json: JsonFn,
): Promise<Response> {
  if (!authUserId) return json({ error: 'forbidden' }, 403)
  if (!hasPermLocal(perms, 'ao_time')) return json({ error: 'forbidden' }, 403)
  if (typeof body.active !== 'boolean') return json({ error: 'missing_fields' }, 400)
  const expectedRevision = Number(body.expectedRevision)
  if (!Number.isFinite(expectedRevision) || expectedRevision < 0) return json({ error: 'missing_fields' }, 400)
  const active = body.active
  const ts = active ? Number(body.ts) : null
  const aoId = active ? (typeof body.aoId === 'string' ? body.aoId : null) : null
  if (active && (!Number.isFinite(ts) || ts === null)) return json({ error: 'missing_fields' }, 400)

  const { data, error } = await supabase.rpc('store_write_stamp_status', {
    p_auth_user_id: authUserId, p_active: active, p_ts: ts, p_ao_id: aoId, p_expected_revision: expectedRevision,
  })
  if (error) {
    console.error('[store-key-write] store_write_stamp_status RPC-fel:', error.message)
    return json({ error: 'write_failed' }, 500)
  }
  const d = data || {}
  return json({
    active: !!d.active, ts: d.ts ?? null, aoId: d.aoId ?? null, hasRow: true,
    revision: Number(d.revision ?? expectedRevision), stale: !!d.stale, replayed: !!d.replayed,
  })
}
