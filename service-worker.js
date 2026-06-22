/**
 * VIFT CRM — Service Worker v1
 *
 * Cache-strategi:
 *   config.js           → Aldrig cachad (network only)
 *   Supabase/Mapbox     → Aldrig cachad (passeras direkt)
 *   index.html          → Network first, cache-fallback (offline)
 *   Versionsatta filer  → Cache first (?v= i URL garanterar busting)
 *   assets/             → Cache first med network-fallback
 *
 * Ny version: bump CACHE_NAME → gamla cacher raderas vid activate.
 */

const CACHE_NAME = 'vift-crm-v1';

/* Filer att förcacha vid install (app shell) */
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/assets/vift-logo.svg',
  '/assets/vift-logo-white.svg',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/icon-180.png'
];

/* Dessa domäner passeras alltid direkt — ingen intercept */
const PASSTHROUGH_HOSTS = [
  'supabase.co',
  'mapbox.com',
  'googleapis.com',
  'fonts.gstatic.com'
];

/* ── Install: förcacha app shell ──────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())   /* aktivera direkt utan väntan */
  );
});

/* ── Activate: rensa gamla cacher ─────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => {
            console.log('[SW] Raderar gammal cache:', k);
            return caches.delete(k);
          })
      ))
      .then(() => self.clients.claim())
  );
});

/* ── Fetch: cache-strategi per resurstyp ──────────────── */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* 1. Passera externa domäner direkt */
  if (PASSTHROUGH_HOSTS.some(h => url.hostname.includes(h))) return;

  /* 2. Passera icke-same-origin direkt */
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;

  /* 3. config.js — network only, aldrig cachad */
  if (path === '/config.js' || path.endsWith('/config.js')) {
    event.respondWith(
      fetch(req).catch(() =>
        new Response('window.VIFT_CONFIG={mapboxToken:""};', {
          headers: { 'Content-Type': 'application/javascript' }
        })
      )
    );
    return;
  }

  /* 4. Versionsatta JS/CSS (?v=N) och assets/ — cache first */
  if (url.search.includes('v=') || path.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(response => {
          if (response.ok) {
            caches.open(CACHE_NAME)
              .then(cache => cache.put(req, response.clone()));
          }
          return response;
        });
      })
    );
    return;
  }

  /* 5. index.html och övriga HTML — network first, cache fallback */
  event.respondWith(
    fetch(req)
      .then(response => {
        if (response.ok) {
          caches.open(CACHE_NAME)
            .then(cache => cache.put(req, response.clone()));
        }
        return response;
      })
      .catch(() => caches.match(req))
  );
});
