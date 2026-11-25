/**
 * public-base-url — miljöspecifik publik bas-URL för länkar i e-post och push
 * (G1/G4 del 2, 2026-11-27).
 *
 * PUBLIC_BASE_URL MÅSTE sättas uttryckligen per miljö (Supabase Edge Function-secret):
 *   LIVE:    LIVE:s egen CRM-adress
 *   STAGING: STAGING:s egen CRM-adress
 * Det finns INGET reservvärde. Saknas eller är värdet ogiltigt returneras ett fel som
 * anroparen ska svara med (HTTP 500, `config_missing_public_base_url` /
 * `config_invalid_public_base_url`) INNAN något skrivs eller skickas. På så sätt kan
 * LIVE aldrig tyst falla tillbaka till STAGING-domänen (eller tvärtom).
 *
 * Extra spärr: i produktionsprojektet (LIVE) avvisas en bas-URL vars värdnamn innehåller
 * ordet "staging".
 *
 * Inga beroenden (används även av tests/public_base_url.test.js).
 */

export const LIVE_SUPABASE_HOST = 'hjplzjsbbowiyoyhdghc.supabase.co'

export type PublicBaseUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: 'config_missing_public_base_url' | 'config_invalid_public_base_url'; detail: string }

/**
 * @param rawValue     värdet av PUBLIC_BASE_URL (Deno.env.get('PUBLIC_BASE_URL'))
 * @param supabaseUrl  värdet av SUPABASE_URL (avgör om detta är LIVE-projektet)
 */
export function resolvePublicBaseUrl(rawValue: string | undefined | null, supabaseUrl: string | undefined | null): PublicBaseUrlResult {
  const raw = String(rawValue ?? '').trim()
  if (!raw) {
    return { ok: false, error: 'config_missing_public_base_url', detail: 'PUBLIC_BASE_URL är inte satt för denna miljö' }
  }
  let u: URL
  try { u = new URL(raw) } catch {
    return { ok: false, error: 'config_invalid_public_base_url', detail: 'PUBLIC_BASE_URL är ingen giltig URL' }
  }
  if (u.protocol !== 'https:') {
    return { ok: false, error: 'config_invalid_public_base_url', detail: 'PUBLIC_BASE_URL måste använda https' }
  }
  if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) {
    return { ok: false, error: 'config_invalid_public_base_url', detail: 'PUBLIC_BASE_URL ska bara vara schema och värdnamn (ingen sökväg, query eller fragment)' }
  }
  let isLive = false
  try { isLive = new URL(String(supabaseUrl ?? '')).host === LIVE_SUPABASE_HOST } catch { isLive = false }
  if (isLive && /staging/i.test(u.hostname)) {
    return { ok: false, error: 'config_invalid_public_base_url', detail: 'PUBLIC_BASE_URL pekar på en STAGING-adress i produktionsprojektet' }
  }
  return { ok: true, url: u.origin }
}
