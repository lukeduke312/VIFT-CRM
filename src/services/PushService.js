/**
 * PushService — Web Push subscription-hantering
 *
 * Flöde:
 *   1. PushService.canSubscribe()  — kontrollera stöd + iOS standalone-krav
 *   2. PushService.subscribe()     — begär permission + skapa subscription + spara i DB
 *   3. PushService.sendTest()      — anropa Edge Function send-push med testnotis,
 *                                    riktad mot EXAKT aktuell enhets endpoint (V44)
 *   4. PushService.unsubscribe()   — avregistrera enheten
 *
 * V44 iOS-diagnostik (utan att röra V42/V43-flödet ovan):
 *   PushService.showLocalTestNotification() — lokal notis, ingen server/push
 *   PushService.getDiagnostics()            — PWA/push-diagnostik för Admin-UI
 *   PushService._listenForPushDiag()        — registrerar SW-diagnostiklyssnaren
 *                                              (anropas en gång från index.html)
 *
 * V45: PushService.notifyStaffAssigned(ao, staffIds) — push till personal
 *      som NYLIGEN tilldelats en BEFINTLIG AO (WorkOrderDetailPage._saveStaff,
 *      WorkOrdersPage bulk "Lägg till personal"). EN request per AO, resolveras
 *      server-side (send-push §staffIds). Rör inte notifyNewAO()/sendTest().
 *
 * VAPID public key: window.VIFT_CONFIG.vapidPublicKey (config.js)
 * Edge Function:    SUPABASE_URL/functions/v1/send-push
 * JWT:             Auth.getAccessToken()
 */

const PushService = {

  /* ── Config ─────────────────────────────────────────────── */

  _vapidKey() {
    return (window.VIFT_CONFIG && window.VIFT_CONFIG.vapidPublicKey) || '';
  },

  /* ── Stödkontroller ─────────────────────────────────────── */

  isSupported() {
    return 'serviceWorker' in navigator
      && 'PushManager' in window
      && 'Notification' in window;
  },

  isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  },

  /* iOS kräver standalone-läge (hemskärmsapp) för push */
  isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  },

  permissionState() {
    if (!this.isSupported()) return 'unsupported';
    return Notification.permission; /* 'default' | 'granted' | 'denied' */
  },

  /* Returnerar varför man INTE kan prenumerera, eller null om OK */
  blockReason() {
    if (!this.isSupported())               return 'unsupported';
    if (!this._vapidKey())                 return 'no-vapid-key';
    if (this.isIOS() && !this.isStandalone()) return 'ios-not-standalone';
    if (Notification.permission === 'denied') return 'permission-denied';
    return null;
  },

  canSubscribe() {
    return this.blockReason() === null;
  },

  /* ── Subscription-status ─────────────────────────────────── */

  async isSubscribed() {
    if (!this.isSupported()) return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      return !!sub;
    } catch { return false; }
  },

  /* V42 §5: skiljer "browser har en lokal PushSubscription" från
     "servern har en giltig, icke-revokerad rad för den subscriptionen".
     isSubscribed() (ovan) svarar bara på det förra — det räcker inte för
     att avgöra om push faktiskt kommer fram. Läser push_subscriptions
     via användarens egen JWT; RLS begränsar till anroparens egna rader,
     ingen service-role/admin-åtkomst i frontend. */
  async getSubscriptionStatus() {
    const result = { browserSubscribed: false, serverRegistered: false, endpoint: null };
    if (!this.isSupported()) return result;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return result;
      result.browserSubscribed = true;
      result.endpoint = sub.endpoint;

      const token = Auth.getAccessToken();
      if (!token) return result;

      const res = await fetch(
        SUPABASE_URL + '/rest/v1/push_subscriptions?endpoint=eq.' + encodeURIComponent(sub.endpoint) + '&select=id,revoked_at',
        {
          headers: {
            'Authorization': 'Bearer ' + token,
            'apikey':        SUPABASE_AKEY
          }
        }
      );
      if (res.ok) {
        const rows = await res.json().catch(() => []);
        result.serverRegistered = Array.isArray(rows) && rows.some(r => !r.revoked_at);
      }
    } catch(e) {
      console.warn('[PushService] getSubscriptionStatus fel:', e);
    }
    return result;
  },

  /* V42 §1: dekodar JWT-payloadens `sub`-claim (= auth.users.id) direkt ur
     access_token. Ingen signaturverifiering görs eller behövs här — vi
     litar redan på tokenet för att autentisera fetch-anropet nedan, och
     RLS (`user_id = auth.uid()`) är den faktiska säkerhetsbarriären på
     serversidan. state.currentUser.id representerar VIFT-personal, INTE
     nödvändigtvis samma UUID som auth.users.id, och får därför aldrig
     användas här. */
  _decodeJwtSub(token) {
    try {
      const parts = String(token).split('.');
      if (parts.length < 2) return null;
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const pad = '='.repeat((4 - b64.length % 4) % 4);
      const json = decodeURIComponent(
        atob(b64 + pad).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
      );
      const claims = JSON.parse(json);
      return (claims && typeof claims.sub === 'string' && claims.sub) ? claims.sub : null;
    } catch { return null; }
  },

  /* V42 §2: jämför en befintlig browser-subscriptions applicationServerKey
     mot den just nu konfigurerade VAPID-nyckeln. Om browsern inte
     exponerar sub.options (äldre Safari) kan vi inte verifiera — då
     återanvänds subscriptionen ändå snarare än att tvinga en ny
     permission-prompt i onödan. */
  _subMatchesCurrentKey(sub, wantedKey) {
    try {
      const opts = sub.options;
      if (!opts || !opts.applicationServerKey) return true;
      const actual = new Uint8Array(opts.applicationServerKey);
      if (actual.length !== wantedKey.length) return false;
      for (let i = 0; i < actual.length; i++) {
        if (actual[i] !== wantedKey[i]) return false;
      }
      return true;
    } catch { return true; }
  },

  /* ── V44 §1: Lokal notistest — INGEN server/push involverad ──
     Isolerar exakt om iOS/browsern kan visa en notis alls, oberoende av
     hela push-kedjan. Använder MEDVETET reg.showNotification() (Service
     Worker Notifications API), ALDRIG `new Notification()` — iOS Safari/PWA
     stödjer inte det senare från en vanlig sida. */
  async showLocalTestNotification() {
    if (Notification.permission !== 'granted') {
      throw new Error('Notification.permission är "' + Notification.permission + '", inte "granted".');
    }
    if (!('serviceWorker' in navigator)) {
      throw new Error('Service worker stöds inte i den här browsern.');
    }
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    if (!reg) {
      throw new Error('Ingen service worker-registrering hittades.');
    }
    /* Låt ett ev. fel från showNotification() propagera med sitt EGNA,
       exakta felmeddelande — ingen omskrivning här. */
    await reg.showNotification('VIFT lokal test', {
      body: 'Om du ser detta fungerar iPhones lokala notisvisning.',
      data: { url: '/' }
    });
  },

  /* ── V44 §2: PWA/push-diagnostik ──────────────────────────
     Visar ALDRIG p256dh/auth_key/JWT/VAPID private key eller hela
     endpointen — bara sista 10 tecknen av endpointen som identifierare
     samt värdnamnet (t.ex. "web.push.apple.com"), inte hela URL:en. */
  async getDiagnostics() {
    const diag = {
      permission: this.permissionState(),
      standalone: this.isStandalone(),
      serviceWorker: { registered: false, active: false, scriptURL: null, state: null },
      hasPushManagerOnRegistration: false,
      browserSubscription: { exists: false, endpointSuffix: null, providerHost: null },
      windowPushManager: { exists: ('pushManager' in window), matchesSwSubscription: null }
    };
    if (!('serviceWorker' in navigator)) return diag;

    let swEndpoint = null;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        diag.serviceWorker.registered = true;
        diag.hasPushManagerOnRegistration = 'pushManager' in reg;
        if (reg.active) {
          diag.serviceWorker.active     = true;
          diag.serviceWorker.scriptURL  = reg.active.scriptURL;
          diag.serviceWorker.state      = reg.active.state;
        }
        if (diag.hasPushManagerOnRegistration) {
          const sub = await reg.pushManager.getSubscription();
          if (sub) {
            swEndpoint = sub.endpoint;
            diag.browserSubscription.exists         = true;
            diag.browserSubscription.endpointSuffix = this._endpointSuffix(sub.endpoint);
            diag.browserSubscription.providerHost   = this._endpointHost(sub.endpoint);
          }
        }
      }
    } catch(e) {
      console.warn('[PushService] getDiagnostics fel:', e);
    }

    /* window.pushManager är INTE standard (PushManager nås normalt bara via
       en ServiceWorkerRegistration) — men kontrolleras exakt som efterfrågat.
       Full endpoint jämförs bara INTERNT här, aldrig returnerad. */
    if (diag.windowPushManager.exists && window.pushManager && typeof window.pushManager.getSubscription === 'function') {
      try {
        const wSub = await window.pushManager.getSubscription();
        diag.windowPushManager.matchesSwSubscription = !!(wSub && swEndpoint && wSub.endpoint === swEndpoint);
      } catch { diag.windowPushManager.matchesSwSubscription = null; }
    }

    return diag;
  },

  _endpointSuffix(endpoint) {
    return (endpoint && typeof endpoint === 'string') ? endpoint.slice(-10) : null;
  },

  _endpointHost(endpoint) {
    try { return new URL(endpoint).hostname; } catch { return null; }
  },

  /* ── V44 §6: registrerar lyssnaren för service workerns
     VIFT_PUSH_RECEIVED_DIAG-meddelande (bevis att SW mottog push-eventet).
     Innehåller ALDRIG payload/endpoint/känslig data, bara en timestamp. */
  _diag: { lastPushReceivedAt: null },

  _listenForPushDiag() {
    if (!('serviceWorker' in navigator) || this.__diagListenerRegistered) return;
    this.__diagListenerRegistered = true;
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'VIFT_PUSH_RECEIVED_DIAG') {
        this._diag.lastPushReceivedAt = e.data.receivedAt || Date.now();
      }
    });
  },

  /* ── Prenumerera ─────────────────────────────────────────── */

  async subscribe(deviceLabel = '') {
    const reason = this.blockReason();
    if (reason) throw new Error(reason);

    /* V42 §1: user_id måste hämtas INNAN vi rör browser-subscriptionen,
       så vi aldrig skapar/återanvänder en subscription vi ändå inte kan
       spara korrekt. */
    const token = Auth.getAccessToken();
    if (!token) throw new Error('Ej inloggad');
    const userId = this._decodeJwtSub(token);
    if (!userId) throw new Error('Kunde inte identifiera användar-ID från sessionen.');

    /* Hämta aktiv service worker */
    const reg = await navigator.serviceWorker.ready;

    /* V42 §2: reparationsflöde — återanvänd en redan befintlig
       browser-subscription (t.ex. en mobil som lokalt är "subscribed"
       men saknar DB-rad) istället för att alltid skapa en ny och riskera
       en onödig permission-prompt eller en duplicerad endpoint. Om den
       befintliga subscriptionen hör till en ANNAN VAPID-nyckel än den
       aktuella konfigurationen kan den inte återanvändas — då avregistreras
       den lokalt och en ny skapas. */
    const wantedKey = this._toUint8Array(this._vapidKey());
    let sub = await reg.pushManager.getSubscription();
    if (sub && !this._subMatchesCurrentKey(sub, wantedKey)) {
      await sub.unsubscribe();
      sub = null;
    }

    if (!sub) {
      /* Begär notisbehörighet */
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('permission-denied');

      /* Skapa Web Push subscription */
      sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: wantedKey
      });
    }

    const json = sub.toJSON();

    const payload = {
      user_id:      userId,
      endpoint:     json.endpoint,
      p256dh:       json.keys.p256dh,
      auth_key:     json.keys.auth,
      platform:     this._detectPlatform(),
      browser:      this._detectBrowser(),
      device_label: deviceLabel || (this._detectPlatform() + ' — ' + new Date().toLocaleDateString('sv-SE')),
      last_seen_at: new Date().toISOString(),
      /* V42 §2: nollställ ev. tidigare revoked_at — en reparerad/återanvänd
         subscription ska räknas som aktiv igen. */
      revoked_at:   null
    };

    /* V42 §3: success returneras ENDAST om både browser-subscription och
       DB-upsert lyckas. Ett DB-fel kastar ett tydligt fel och rör INTE
       den redan skapade/återanvända browser-subscriptionen — nästa
       Activate-försök kan reparera enligt §2 utan att användaren behöver
       rensa webbläsardata. */
    const res = await fetch(
      SUPABASE_URL + '/rest/v1/push_subscriptions?on_conflict=endpoint',
      {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': 'Bearer ' + token,
          'apikey':        SUPABASE_AKEY,
          'Prefer':        'resolution=merge-duplicates'
        },
        body: JSON.stringify(payload)
      }
    );
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.error('[PushService] subscribe: DB-upsert misslyckades', res.status, err);
      throw new Error('DB-fel (' + res.status + '): kunde inte spara prenumerationen på servern.');
    }

    return sub;
  },

  /* ── Avregistrera ────────────────────────────────────────── */

  async unsubscribe() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return;

      /* Markera som revokad i DB */
      const token = Auth.getAccessToken();
      if (token) {
        await fetch(
          SUPABASE_URL + '/rest/v1/push_subscriptions?endpoint=eq.' + encodeURIComponent(sub.endpoint),
          {
            method:  'PATCH',
            headers: {
              'Content-Type':  'application/json',
              'Authorization': 'Bearer ' + token,
              'apikey':        SUPABASE_AKEY
            },
            body: JSON.stringify({ revoked_at: new Date().toISOString() })
          }
        );
      }
      await sub.unsubscribe();
    } catch(e) {
      console.warn('[PushService] unsubscribe fel:', e);
    }
  },

  /* ── Testnotis ───────────────────────────────────────────── */

  async sendTest() {
    const token = Auth.getAccessToken();
    if (!token) throw new Error('Ej inloggad');

    /* V44 §3: rikta testet mot EXAKT den här browserns aktuella endpoint —
       inte "någon av användarens subscriptions". Utan detta diagnostiserar
       vi fel enhet så fort användaren har fler än en registrerad enhet.
       send-push validerar servern-sidan att endpointen faktiskt tillhör
       anroparen (se dess §3-säkerhetskrav) — ingen egen validering krävs
       här utöver att bara skicka med den. */
    let testEndpoint = null;
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg && reg.pushManager) {
          const sub = await reg.pushManager.getSubscription();
          if (sub) testEndpoint = sub.endpoint;
        }
      }
    } catch(e) {
      console.warn('[PushService] sendTest: kunde inte läsa aktuell endpoint:', e);
    }

    const body = {
      title: 'VIFT CRM — Testnotis',
      body:  'Pushnotiser fungerar! Du får notiser när AO tilldelas dig.',
      url:   '/'
    };
    if (testEndpoint) body.testEndpoint = testEndpoint;

    const res = await fetch(SUPABASE_URL + '/functions/v1/send-push', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { const j = await res.json(); msg = j.error || msg; } catch {}
      throw new Error(msg);
    }
    return res.json();
  },

  /* ── Notis vid ny AO ────────────────────────────────────── */

  /*
   * Skickar push-notis vid ny AO. Punkt 92: skickar till ansvarig(a) för
   * fastigheten (via propertyContacts) istället för broadcast.
   * Prioritet i Edge Function: primär kontakt → alla aktiva → broadcast-fallback.
   * Fire-and-forget — felet loggas men stoppar aldrig AO-skapandet.
   */
  async notifyNewAO(ao) {
    const token = Auth.getAccessToken();
    if (!token) {
      console.warn('[PushService] notifyNewAO: ej inloggad, hoppar över push');
      return;
    }

    const cuName    = (typeof getCu === 'function' && ao.customerId) ? (() => { const c = getCu(ao.customerId); return c ? (c.name || (c.firstName + ' ' + c.lastName).trim()) : ''; })() : '';
    const isAkut    = ao.priority === 'akut';
    const titleText = isAkut ? '🚨 AKUT arbetsorder' : 'Ny arbetsorder';
    const context   = (cuName || ao.address || '').trim();
    const bodyText  = context ? ao.title + ' – ' + context : ao.title;
    const url       = '/#/ao/' + ao.id;

    /* Punkt 92: försök riktad notis via fastighetsansvarig */
    const pushBody = { title: titleText, body: bodyText, url, aoId: ao.id };
    if (ao.propertyId) {
      pushBody.propertyId = ao.propertyId;
    } else {
      pushBody.broadcast = true;
    }

    try {
      const res = await fetch(SUPABASE_URL + '/functions/v1/send-push', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(pushBody)
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        console.warn('[PushService] notifyNewAO svar', res.status, ':', txt);
      } else {
        const result = await res.json().catch(() => ({}));
        console.log('[PushService] notifyNewAO skickad — enheter:', result.sent || 0, '/ revokade:', result.revoked || 0);
      }
    } catch(e) {
      console.warn('[PushService] notifyNewAO nätverksfel:', e);
    }
  },

  /*
   * V45: skickar push-notis till personal som NYLIGEN tilldelats en
   * BEFINTLIG arbetsorder (WorkOrderDetailPage._saveStaff / WorkOrdersPage
   * bulk "Lägg till personal"). Fire-and-forget — felet loggas men
   * påverkar aldrig AO-sparningen/bulkresultatet (anropas alltid EFTER
   * att WorkOrderService.updateStaff()/bulk-mutationen redan lyckats).
   *
   * EN request per AO (inte en per person) — backend (send-push §staffIds)
   * resolverar staffIds → auth-konton → subscriptions server-side.
   * Ändrar INTE notifyNewAO()/sendTest()/V44-diagnostiken.
   */
  async notifyStaffAssigned(ao, staffIds) {
    if (!ao || !ao.id) {
      console.warn('[PushService] notifyStaffAssigned: ogiltig AO, hoppar över push');
      return;
    }
    const ids = Array.from(new Set(
      (Array.isArray(staffIds) ? staffIds : []).filter(id => typeof id === 'string' && id)
    ));
    if (ids.length === 0) return;

    const token = Auth.getAccessToken();
    if (!token) {
      console.warn('[PushService] notifyStaffAssigned: ej inloggad, hoppar över push');
      return;
    }

    const pushBody = {
      title: 'Arbetsorder tilldelad',
      body:  'Du har tilldelats ' + ao.id + ': ' + (ao.title || ao.id),
      url:   '/#/ao/' + ao.id,
      aoId:  ao.id,
      staffIds: ids
    };

    try {
      const res = await fetch(SUPABASE_URL + '/functions/v1/send-push', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(pushBody)
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        console.warn('[PushService] notifyStaffAssigned svar', res.status, ':', txt);
      } else {
        const result = await res.json().catch(() => ({}));
        console.log('[PushService] notifyStaffAssigned skickad — enheter:', result.sent || 0, '/ revokade:', result.revoked || 0);
      }
    } catch(e) {
      console.warn('[PushService] notifyStaffAssigned nätverksfel:', e);
    }
  },

  /*
   * Punkt 92: generell hjälpfunktion för att skicka push till ansvarig
   * för en fastighet. Används av serviceintervall, rondering m.m.
   * Fire-and-forget.
   */
  async notifyProperty(propertyId, title, body, url) {
    const token = Auth.getAccessToken();
    if (!token) return;
    const pushBody = { title, body, url: url || '/' };
    if (propertyId) {
      pushBody.propertyId = propertyId;
    } else {
      pushBody.broadcast = true;
    }
    try {
      const res = await fetch(SUPABASE_URL + '/functions/v1/send-push', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(pushBody)
      });
      if (!res.ok) console.warn('[PushService] notifyProperty fel:', res.status);
      else {
        const r = await res.json().catch(()=>({}));
        console.log('[PushService] notifyProperty skickad:', r.sent, 'enheter, fastighet:', propertyId);
      }
    } catch(e) {
      console.warn('[PushService] notifyProperty nätverksfel:', e);
    }
  },

  /* ── Hjälpfunktioner ─────────────────────────────────────── */

  _toUint8Array(base64url) {
    const pad = '='.repeat((4 - base64url.length % 4) % 4);
    const b64 = (base64url + pad).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
  },

  _detectPlatform() {
    const ua = navigator.userAgent;
    if (/iphone/i.test(ua))  return 'iPhone';
    if (/ipad/i.test(ua))    return 'iPad';
    if (/android/i.test(ua)) return 'Android';
    return 'Desktop';
  },

  _detectBrowser() {
    const ua = navigator.userAgent;
    if (/CriOS/i.test(ua))                        return 'chrome-ios';
    if (/FxiOS/i.test(ua))                        return 'firefox-ios';
    if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) return 'safari';
    if (/Chrome/i.test(ua))                        return 'chrome';
    return 'unknown';
  }
};
