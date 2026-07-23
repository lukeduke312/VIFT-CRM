/**
 * VIFT-CRM konfiguration
 *
 * mapboxToken:
 *   Domänbegränsad Mapbox-token. Begränsa till: https://crm.viftfast.se
 *   Lämnas tom → manuell adressinmatning (inget trasigt UI).
 *
 * vapidPublicKey:
 *   VAPID public key för Web Push-notiser.
 *   Generera nyckelpar: npx web-push generate-vapid-keys --json
 *   Public key → sätt här. Private key → Supabase secrets.
 *   Lämnas tom → notis-funktionen inaktiveras tyst.
 */
window.VIFT_CONFIG = {
  mapboxToken: 'pk.eyJ1IjoibHVrZWR1a2UzMTIiLCJhIjoiY21xbzdpMTFmMTJnMzQ4cXhkZmxwMjY5dyJ9.sVwP6s-mCQBttrSBq0d7Tw',
  vapidPublicKey: 'BK25cYSYrb8Qw6b_7ZIjhloorj4za_s329QEGxKj131aJYRrc5dDTFW0X9NddveFnU4qzqXcX__2AWzblojL-CM',
};
