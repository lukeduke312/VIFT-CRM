/**
 * PushService — Web Push subscription-hantering
 *
 * Flöde:
 *   1. PushService.canSubscribe()  — kontrollera stöd + iOS standalone-krav
 *   2. PushService.subscribe()     — begär permission + skapa subscription + spara i DB
 *   3. PushService.sendTest()      — anropa Edge Function send-push med testnotis
 *   4. PushService.unsubscribe()   — avregistrera enheten
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

  /* ── Prenumerera ─────────────────────────────────────────── */

  async subscribe(deviceLabel = '') {
    const reason = this.blockReason();
    if (reason) throw new Error(reason);

    /* Begär notisbehörighet */
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('permission-denied');

    /* Hämta aktiv service worker */
    const reg = await navigator.serviceWorker.ready;

    /* Skapa Web Push subscription */
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: this._toUint8Array(this._vapidKey())
    });

    const json = sub.toJSON();

    /* Spara i Supabase */
    const token = Auth.getAccessToken();
    if (!token) throw new Error('Ej inloggad');

    const payload = {
      endpoint:     json.endpoint,
      p256dh:       json.keys.p256dh,
      auth_key:     json.keys.auth,
      platform:     this._detectPlatform(),
      browser:      this._detectBrowser(),
      device_label: deviceLabel || (this._detectPlatform() + ' — ' + new Date().toLocaleDateString('sv-SE')),
      last_seen_at: new Date().toISOString()
    };

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
      const err = await res.text();
      throw new Error('DB-fel: ' + err);
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

    const res = await fetch(SUPABASE_URL + '/functions/v1/send-push', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({
        title: 'VIFT CRM — Testnotis',
        body:  'Pushnotiser fungerar! Du får notiser när AO tilldelas dig.',
        url:   '/'
      })
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
   * Skickar push-notis (broadcast) till alla prenumeranter när en ny AO skapas.
   * Kräver att send-push Edge Function stöder { broadcast: true }.
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

    try {
      const res = await fetch(SUPABASE_URL + '/functions/v1/send-push', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
          title:     titleText,
          body:      bodyText,
          url:       url,
          aoId:      ao.id,
          broadcast: true
        })
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
