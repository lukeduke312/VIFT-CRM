/**
 * VIFT CRM — Service Worker v13
 *
 * v10: bugfixar — behörigheter, snabb status, mobil iOS-zoom
 *      Rensar v7/v8/v9 cacher.
 * v11: push-handlern förstår nu BÅDE Declarative Web Push
 *      ({ web_push, notification: {...} }, RFC 8030/iOS 18.4+) och det
 *      tidigare legacy-formatet ({ title, body, url, aoId }) — se
 *      'push'-lyssnaren nedan. Ingen ändring av cache-strategin i sig;
 *      CACHE_NAME bumpas ändå så att LIVE garanterat hämtar den nya
 *      push-hanteringen (activate() rensar föregående cache).
 * v12: push-handlern skickar nu även ett rent diagnostikmeddelande
 *      (VIFT_PUSH_RECEIVED_DIAG, bara en timestamp — ingen payload/endpoint/
 *      känslig data) till öppna VIFT-klienter, som bevis för att service
 *      workern faktiskt mottog push-eventet — oberoende av om showNotification()
 *      lyckades visa något synligt. Körs parallellt med showNotification(),
 *      ersätter eller fördröjer den aldrig. Ingen ändring av cache-strategin;
 *      CACHE_NAME bumpas ändå så att LIVE garanterat hämtar den nya koden.
 * v13: CACHE/SW-HOTFIX — root cause för "ny fönster visar gammal sida,
 *      hård omladdning fixar det direkt": `fetch(req)` utan explicit
 *      `cache`-läge ÄRVER webbläsarens vanliga HTTP-cache-beteende
 *      (styrt av serverns Cache-Control/Last-Modified-headers på
 *      Loopia-webbhotellet), OBEROENDE av service workerns egen
 *      CacheStorage. "Network first"-logiken för index.html/HTML var
 *      alltså ALDRIG garanterat en genuint färsk nätverksbegäran — en
 *      normal `fetch()` kan tystnad tillfredsställas av webbläsarens
 *      HTTP-disk-cache om servern tillåter det, vilket delas mellan
 *      ALLA fönster/flikar i samma browserprofil (därför upprepades
 *      felet i nya fönster) men kringgås av en hård omladdning
 *      (Ctrl+F5 tvingar bort HTTP-cachen helt). Fix: `fetch(req, {
 *      cache: 'no-store' })` för BÅDE HTML (index.html m.fl.) och
 *      config.js — tvingar en genuint färsk nätverksbegäran varje gång,
 *      exakt vad "network first" alltid avsåg. De versionssatta
 *      `?v=N`-filerna berördes INTE av denna bugg (CacheStorage.match()
 *      jämför redan hela URL:en inklusive querysträngen som standard —
 *      en ny `?v=N` är redan en distinkt cache-nyckel), men en explicit
 *      `{ ignoreSearch: false }` har lagts till som dokumentation/
 *      försvar mot en framtida oavsiktlig regression av just detta.
 *      Se även index.html: SW-registreringen har fått
 *      `updateViaCache: 'none'` så att SJÄLVA service worker-skriptet
 *      aldrig riskerar att läsas ur webbläsarens HTTP-cache vid
 *      uppdateringskontrollen — annars hade en ny SW-version i värsta
 *      fall kunnat missas helt, inte bara försenas.
 *
 * Cache-strategi:
 *   config.js           → Aldrig cachad (network only, no-store)
 *   Supabase/Mapbox     → Aldrig cachad (passeras direkt)
 *   index.html          → Network first (no-store), cache-fallback (offline)
 *   Versionsatta filer  → Cache first (?v= i URL garanterar busting, hela URL:en är cache-nyckeln)
 *   assets/             → Cache first med network-fallback
 *
 * Ny version: bump CACHE_NAME → gamla cacher raderas vid activate.
 */

const CACHE_NAME = 'vift-crm-v13';

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

  /* 3. config.js — network only, aldrig cachad.
     v13: `cache: 'no-store'` — utan detta ärver fetch() webbläsarens
     vanliga HTTP-cache-beteende (serverns Cache-Control/Last-Modified),
     vilket helt kan undergräva "aldrig cachad" om värden tillåter
     browser-caching av filen. Se filhuvud-kommentaren v13. */
  if (path === '/config.js' || path.endsWith('/config.js')) {
    event.respondWith(
      fetch(req, { cache: 'no-store' }).catch(() =>
        new Response('window.VIFT_CONFIG={mapboxToken:""};', {
          headers: { 'Content-Type': 'application/javascript' }
        })
      )
    );
    return;
  }

  /* 4. Versionsatta JS/CSS (?v=N) och assets/ — cache first.
     `ignoreSearch: false` (standardvärdet, satt explicit här som
     dokumentation/regressionsskydd) — hela URL:en INKLUSIVE
     querysträngen är cache-nyckeln, så en ny `?v=N` är alltid en
     distinkt post och kan aldrig råka matcha en äldre versions cache. */
  if (url.search.includes('v=') || path.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req, { ignoreSearch: false }).then(cached => {
        if (cached) return cached;
        return fetch(req).then(response => {
          if (response.ok) {
            /* clone() måste anropas synkront innan response returneras */
            const toCache = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, toCache));
          }
          return response;
        });
      })
    );
    return;
  }

  /* 5. index.html och övriga HTML — network first, cache fallback.
     v13: `cache: 'no-store'` är KÄRNAN i denna hotfix — se filhuvud-
     kommentaren. Utan detta kan en "normal" sidladdning (inklusive ett
     helt nytt webbläsarfönster, som delar samma HTTP-disk-cache som
     alla andra fönster i samma profil) tystnad få en cachad, gammal
     index.html från webbläsarens HTTP-lager, HELT UTANFÖR service
     workerns egen CacheStorage — även om denna kod "ser ut" som
     network-first. En hård omladdning (Ctrl+F5) råkade dölja buggen
     eftersom den explicit kringgår HTTP-cachen, vilket gav intrycket
     att strategin fungerade. */
  event.respondWith(
    fetch(req, { cache: 'no-store' })
      .then(response => {
        if (response.ok) {
          /* clone() måste anropas synkront innan response returneras */
          const toCache = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, toCache));
        }
        return response;
      })
      .catch(() => caches.match(req))
  );
});

/* ── Push notification received ──────────────────────────── */
/* V43 §2: send-push skickar sedan V43 en Declarative Web Push-kompatibel
 * payload ({ web_push: 8030, notification: {title,body,navigate,silent}, aoId }).
 * WebKit (iOS/iPadOS 18.4+) kan visa notisen deklarativt INNAN denna handler
 * ens körs — i så fallet kör webbläsaren denna 'push'-lyssnare som en valfri
 * (optional) efterbehandling enligt specifikationen, inte som en andra,
 * separat notisväg. Vi anropar därför showNotification() precis som förut
 * (en enda väg, inga dubbletter) — men läser fälten från vilket format som
 * än kom in, så äldre browsers utan stöd för declarative push fortsätter
 * fungera exakt som i V42 via samma showNotification()-anrop. */
self.addEventListener('push', event => {
  if (!event.data) return;

  let payload;
  try { payload = event.data.json(); }
  catch { payload = { title: 'VIFT CRM', body: event.data.text() }; }

  const decl  = payload && payload.notification;
  const title = (decl ? decl.title : payload.title) || 'VIFT CRM';
  const body  = (decl ? decl.body  : payload.body)  || '';
  const url   = (decl ? decl.navigate : payload.url) || '/';
  const aoId  = payload.aoId || null;

  const options = {
    body,
    icon:               '/assets/icon-192.png',
    badge:              '/assets/icon-192.png',
    data:               { url, aoId },
    requireInteraction: false
  };

  /* V44 §6: bevis för att SERVICE WORKERN faktiskt mottog push-eventet,
   * oberoende av om showNotification() lyckades visa något synligt (det är
   * exakt det V44 ska isolera). Körs SAMTIDIGT med showNotification() via
   * Promise.all — ersätter eller fördröjer den aldrig. Innehåller bara en
   * timestamp, aldrig payload/endpoint/känslig data. */
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientsList => {
        clientsList.forEach(client => {
          client.postMessage({ type: 'VIFT_PUSH_RECEIVED_DIAG', receivedAt: Date.now() });
        });
      })
    ])
  );
});

/* ── Notification clicked → öppna rätt sida ─────────────── */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data  = event.notification.data || {};
  const url   = data.url || '/';
  const aoId  = data.aoId || null;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(list => {
        const existing = list.find(c => c.url.startsWith(self.location.origin));
        if (existing) {
          existing.focus();
          /* Skicka meddelande till appen för in-app-navigering utan sidladdning */
          if (aoId) {
            existing.postMessage({ type: 'OPEN_AO', aoId });
          }
          return;
        }
        /* Appen inte öppen — öppna ny flik med deep-link-URL */
        return clients.openWindow(url);
      })
  );
});

