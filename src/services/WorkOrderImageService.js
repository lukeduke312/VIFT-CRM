/**
 * WorkOrderImageService v1 — Supabase Storage (PRIVATE bucket) + signed URLs
 *
 * VIFT CRM 13 (riktad prestandarättning, FÖRSLAG — EJ INSTALLERAT): flyttar
 * NYA arbetsorder-foton (loggpost-bilder, se WorkOrderDetailPage._saveLog())
 * ut ur det inbäddade `imageData`-fältet (en base64-dataURL, tidigare sparad
 * rakt in i den gemensamma `vift_workOrders`-JSONB-arrayen i public.store)
 * och in i Supabase Storage. Arbetsordern behåller bara en kort referens
 * (`imagePath`) istället för hela bildens bytes.
 *
 * VARFÖR: `vift_workOrders` är EN enda, delad JSONB-rad för ALLA
 * arbetsordrar. Att bädda in en flera-MB bas64-bild i en enskild
 * loggpost gör att HELA den delade raden (alla ~30 arbetsordrar, inte
 * bara den aktuella) måste läsas, skickas och skrivas om vid minsta
 * ändring — oavsett vilken skrivväg som används. Se den samlade
 * slutrapporten (VIFT CRM 13) för den fullständiga, uppmätta orsaks-
 * analysen (WAL-volym, antal skrivningar).
 *
 * Mönstret nedan är en MEDVETEN, nästan ordagrann kopia av det redan
 * existerande, redan fungerande PropertyImageService.js (samma
 * åtkomstmodell: privat bucket, uppladdning med den inloggade
 * personalens egen JWT, signerade URL:er med cache) — INTE en ny,
 * uppfunnen arkitektur. Skillnaden mot PropertyImageService: ingen egen
 * Postgres-metadatatabell behövs här, eftersom bildens metadata (vilken
 * arbetsorder, vem, när) redan finns i loggpostens egna fält
 * (`ao.log[].userName`/`timestamp`/`id`) — att även skapa en separat
 * databastabell för exakt samma information hade varit en onödig,
 * ej begärd generell ombyggnad.
 *
 * RÄTTAT (acceptansgranskning, 2026-11-20 — åtkomstkontroll): tidigare
 * version av detta förslag föreslog en bucket-bred `TO authenticated`-
 * policy för SELECT/INSERT, som gav VARJE inloggad användare signerade
 * URL:er och uppladdningsrätt för VILKEN arbetsorders bilder som helst,
 * oavsett ao_view_own/ao_view_all — ett genuint fynd, inte en gissning:
 * en behörighetskontroll ENBART i frontend kan alltid kringgås av en
 * anropare som skickar sitt eget, giltiga JWT direkt mot Storage-API:et.
 * Läsning och uppladdning går nu via TVÅ nya, dedikerade Edge Functions
 * (`work-order-image-url`/`work-order-image-upload`) som FÖRST verifierar
 * att anroparen verkligen får se/redigera just DEN arbetsordern — samma
 * mönster som redan etablerat av offer-attachment-url/-upload i denna
 * kodbas, tillämpat på AO:ns redan existerande, källverifierade
 * ao_view_all/ao_view_own-regel (se `canViewWorkOrder()` i
 * `_shared/vift-auth.ts`).
 *
 * Bucket-typ:  private — bilder kräver signerade URL:er, inga publika URL:er.
 * Läsning:     work-order-image-url (service_role) → signerade URL:er (1h).
 * Uppladdning: work-order-image-upload (service_role) → Storage.
 * Radering:    authenticated users (Storage-nivå, DELETE-ENDAST policy) —
 *              KVARSTÅENDE, MEDVETET AVGRÄNSAT RESTRISK: vilken loggpost
 *              som får raderas kontrolleras idag ENDAST av frontend
 *              (WorkOrderDetailPage.deleteLogEntry()/ao_edit-gated UI),
 *              precis som för alla andra loggposter i denna kodbas — INTE
 *              av en EF. En DELETE-only policy har lägre allvarlighet än
 *              den ursprungliga READ/WRITE-luckan (en obehörig anropare
 *              kan i värsta fall RADERA en bild de inte borde kunna se,
 *              men kan fortfarande inte LÄSA eller SKRIVA en annan AO:s
 *              bilder) — men är fortsatt klient-kontrollerad, inte
 *              server-verifierad. Flaggas här explicit, inte dolt; en
 *              framtida `work-order-image-delete`-EF (samma mönster som
 *              de två nya ovan) skulle stänga även denna lucka helt.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SUPABASE SETUP — FÖRSLAG, EJ KÖRT. Kör i Supabase SQL-editorn (idempotent)
 * ENDAST efter separat, uttryckligt GO.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Steg 1: Skapa PRIVAT bucket ─────────────────────────────────────────
 *
 * INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
 * VALUES (
 *   'workorder-images',
 *   'workorder-images',
 *   false,                  -- PRIVAT: ingen publik åtkomst
 *   10485760,               -- max 10 MB per fil (samma gräns som property-images)
 *   ARRAY['image/jpeg','image/jpg','image/png','image/webp']
 * ) ON CONFLICT (id) DO NOTHING;
 *
 * ── Steg 2: Storage policies (idempotent) ───────────────────────────────
 *
 * DROP POLICY IF EXISTS "wo_images_storage_select" ON storage.objects;
 * DROP POLICY IF EXISTS "wo_images_storage_insert" ON storage.objects;
 * DROP POLICY IF EXISTS "wo_images_storage_delete" ON storage.objects;
 *
 * -- SELECT/INSERT: ENBART service_role (de två nya Edge Functions är nu
 * -- de ENDA legitima anroparna — de har redan verifierat ao_view_all/
 * -- ao_view_own/ao_edit/ao_checklist server-sidigt INNAN de når hit).
 * -- INGEN `TO authenticated`-variant för SELECT/INSERT längre.
 * CREATE POLICY "wo_images_storage_select"
 *   ON storage.objects FOR SELECT TO service_role
 *   USING (bucket_id = 'workorder-images');
 *
 * CREATE POLICY "wo_images_storage_insert"
 *   ON storage.objects FOR INSERT TO service_role
 *   WITH CHECK (bucket_id = 'workorder-images');
 *
 * -- DELETE: kvar som `TO authenticated` — se filhuvudets explicita,
 * -- avgränsade restrisk-notis ovan för varför detta INTE är lika allvarligt
 * -- som den ursprungliga READ/WRITE-luckan, och vad som skulle stänga den helt.
 * CREATE POLICY "wo_images_storage_delete"
 *   ON storage.objects FOR DELETE TO authenticated
 *   USING (bucket_id = 'workorder-images');
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Felscenarier
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Uppladdning misslyckas (nätverksfel ELLER 403 från EF:en, t.ex. om
 * anroparen saknar behörighet för just denna AO): upload() kastar ett
 * fel. Anroparen (WorkOrderDetailPage._saveLog()) visar felet och sparar
 * INTE loggposten — exakt samma "ingen låtsad framgång"-princip som redan
 * används av resolveChecklistItemAtomic() i denna kodbas. Ingen loggpost
 * utan sin avsedda bild sparas av misstag.
 *
 * Signerad URL kan inte genereras eller nekas (403/404 från EF:en):
 * getSignedUrls() filtrerar bort den posten — WorkOrderDetailPage visar då
 * ingen bild för den loggposten (samma "osynlig, ofarlig"-hantering som
 * PropertyImageService.list() redan gör för orphaned metadata).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

const WorkOrderImageService = {
  BUCKET: 'workorder-images',

  /* In-memory cache för signed URLs: { [storagePath]: { url, expiresAt } } */
  _urlCache: {},

  /* ── Interna helpers ──────────────────────────────────────── */

  _h(contentType) {
    const jwt = (typeof Auth !== 'undefined' && Auth.getAccessToken)
      ? (Auth.getAccessToken() || SUPABASE_AKEY)
      : SUPABASE_AKEY;
    const h = { 'apikey': SUPABASE_AKEY, 'Authorization': 'Bearer ' + jwt };
    if (contentType) h['Content-Type'] = contentType;
    return h;
  },

  /* ── Resize/komprimering ──────────────────────────────────────
   * MEDVETEN, nästan ordagrann kopia av den redan beprövade
   * RonderingUtforandePage._resizeImage() (samma algoritm: max 900px på
   * längsta sidan, JPEG-kvalitet 0.75) — INTE en refaktorering av den
   * delade koden (de två filerna är olika sidor/tjänster; att låta en
   * sida anropa en annan sidas "privata" _-prefixade hjälpmetod hade
   * varit ovanlig stil för denna kodbas). Dubbleringen av dessa ~12
   * raderna är ett medvetet, avgränsat val — inte en ny abstraktion. */
  _resizeImage(file) {
    return new Promise(function(resolve) {
      const reader = new FileReader();
      reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
          const MAX = 900;
          let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
          if (w > MAX || h > MAX) { const s = Math.min(MAX / w, MAX / h); w = Math.round(w * s); h = Math.round(h * s); }
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(cv.toDataURL('image/jpeg', 0.75));
        };
        img.onerror = function() { resolve(e.target.result); };
        img.src = e.target.result;
      };
      reader.onerror = function() { resolve(null); };
      reader.readAsDataURL(file);
    });
  },

  /* Konverterar en data: URL (vad _resizeImage()/canvas.toDataURL ger) till
     en Blob, så den kan laddas upp som binära bytes (inte som en text-
     kodad JSON-sträng) — håller uppladdningens storlek nära den faktiska
     bildstorleken, inte ~33% större (base64-overhead) i onödan. */
  _dataUrlToBlob(dataUrl) {
    const parts = dataUrl.split(',');
    const meta  = parts[0] || '';
    const mimeMatch = meta.match(/data:([^;]+);base64/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const binary = atob(parts[1] || '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  },

  /* ── Signed URL (batch, med cache, server-verifierad behörighet) ──
   * RÄTTAT (åtkomstkontroll): anropar INTE längre Storage:s sign-API
   * direkt (det skulle kräva en bucket-bred policy igen). Grupperar
   * istället begärda paths per arbetsorder (varje path har formatet
   * "<aoId>/<filnamn>", satt av upload() nedan) och POSTar VARJE
   * arbetsorders paths till den nya work-order-image-url-Edge-Function,
   * som FÖRST kontrollerar att DENNA inloggade användare verkligen får
   * se just DEN arbetsordern innan den signerar något. */
  async getSignedUrls(paths) {
    if (!paths || !paths.length) return {};

    const now     = Date.now();
    const result  = {};
    const missing = [];

    paths.forEach(p => {
      const c = this._urlCache[p];
      if (c && c.expiresAt > now) {
        result[p] = c.url;
      } else {
        missing.push(p);
      }
    });

    if (!missing.length) return result;

    /* Gruppera per aoId (path-prefixet FÖRE första "/") */
    const byAo = {};
    missing.forEach(p => {
      const aoId = String(p).split('/')[0] || '';
      if (!aoId) return;
      (byAo[aoId] = byAo[aoId] || []).push(p);
    });

    const expiry = now + 50 * 60 * 1000; /* 50 min cache */
    await Promise.all(Object.keys(byAo).map(async (aoId) => {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/work-order-image-url`,
          {
            method:  'POST',
            headers: this._h('application/json'),
            body:    JSON.stringify({ aoId, paths: byAo[aoId] })
          }
        );
        if (!res.ok) {
          console.warn('[WorkOrderImageService] work-order-image-url misslyckades för', aoId, ':', res.status);
          return;
        }
        const body = await res.json(); /* { urls: { [path]: signedUrl } } */
        const urls = (body && body.urls) || {};
        Object.keys(urls).forEach((path) => {
          this._urlCache[path] = { url: urls[path], expiresAt: expiry };
          result[path] = urls[path];
        });
      } catch (e) {
        console.warn('[WorkOrderImageService] getSignedUrls() error för', aoId, ':', e);
      }
    }));

    return result;
  },

  /* ── Upload ───────────────────────────────────────────────── */

  /**
   * Komprimerar (900px/JPEG 0.75, samma etablerade mönster som
   * RonderingUtforandePage) och laddar upp en bild. RÄTTAT
   * (åtkomstkontroll): skickas INTE längre direkt till Storage (det
   * skulle kräva en bucket-bred policy) — POSTas istället till den nya
   * work-order-image-upload-Edge-Function, som FÖRST kontrollerar
   * server-sidigt att DENNA inloggade användare verkligen får
   * redigera/logga på just DEN arbetsordern (ao_checklist/ao_edit +
   * ao_view_all/ao_view_own) innan den laddar upp något. Bucketens eget
   * mapp-prefix (`<aoId>/...`) sätts nu av EF:en själv, inte klienten.
   * Ingen separat metadata-rad skapas — se filhuvudets motivering.
   * @param {string} aoId  — arbetsorder-id
   * @param {File}   file
   * @returns {Promise<{ path: string }>}  — kastar ett Error vid misslyckande
   *          (INGEN tyst, "låtsad" framgång — anroparen MÅSTE hantera felet
   *          och INTE spara loggposten som om bilden sparats).
   */
  async upload(aoId, file) {
    const dataUrl = await this._resizeImage(file);
    if (!dataUrl) throw new Error('Kunde inte läsa/komprimera bilden');
    const blob = this._dataUrlToBlob(dataUrl);

    const form = new FormData();
    form.append('aoId', aoId);
    form.append('file', blob, 'image.jpg');

    const res = await fetch(
      `${SUPABASE_URL}/functions/v1/work-order-image-upload`,
      { method: 'POST', headers: this._h(false), body: form }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || err.message || `Uppladdning misslyckades (HTTP ${res.status})`);
    }
    const body = await res.json();
    return { path: body.path };
  },

  /* ── Remove ───────────────────────────────────────────────── */

  /**
   * Radera en bildfil från Storage. Åtkomstkontroll för VILKEN loggpost
   * som får raderas (och därmed om detta anrop ens görs) hanteras av
   * anroparen (WorkOrderDetailPage.deleteLogEntry(), ao_edit) — se
   * filhuvudets motivering.
   * @param {string} storagePath
   * @returns {Promise<boolean>} storageOk
   */
  async remove(storagePath) {
    if (!storagePath) return true;
    delete this._urlCache[storagePath];
    const res = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${this.BUCKET}/${storagePath}`,
      { method: 'DELETE', headers: this._h(false) }
    );
    if (!res.ok) console.warn('[WorkOrderImageService] Storage-radering misslyckades:', res.status);
    return res.ok;
  }
};
