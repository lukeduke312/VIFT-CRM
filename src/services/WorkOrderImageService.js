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
 * Bucket-typ:  private — bilder kräver signerade URL:er, inga publika URL:er.
 * Läsning:     authenticated users → signerade URL:er (1 timme, cachas 50 min).
 * Uppladdning: authenticated users → POST till Storage API.
 * Radering:    authenticated users (Storage-nivå) — åtkomstkontrollen för
 *              VILKEN loggpost som får raderas hanteras redan idag av
 *              WorkOrderDetailPage.deleteLogEntry()/ao_edit-behörigheten,
 *              precis som för alla andra loggposter — denna service
 *              lägger inte till ett NYTT, separat skyddslager för det.
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
 *   ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif','image/heic','image/heif']
 * ) ON CONFLICT (id) DO NOTHING;
 *
 * ── Steg 2: Storage policies (idempotent) ───────────────────────────────
 *
 * DROP POLICY IF EXISTS "wo_images_storage_select" ON storage.objects;
 * DROP POLICY IF EXISTS "wo_images_storage_insert" ON storage.objects;
 * DROP POLICY IF EXISTS "wo_images_storage_delete" ON storage.objects;
 *
 * -- SELECT: authenticated users kan generera signed URLs och läsa filer
 * -- (samma öppenhetsgrad som arbetsordrar redan har för inloggad personal
 * -- med ao_view_all/ao_view_own — denna policy lägger inte till någon NY
 * -- begränsning eller lättnad jämfört med det).
 * CREATE POLICY "wo_images_storage_select"
 *   ON storage.objects FOR SELECT TO authenticated
 *   USING (bucket_id = 'workorder-images');
 *
 * -- INSERT: authenticated users kan ladda upp
 * CREATE POLICY "wo_images_storage_insert"
 *   ON storage.objects FOR INSERT TO authenticated
 *   WITH CHECK (bucket_id = 'workorder-images');
 *
 * -- DELETE: authenticated users kan radera (Storage-nivå) — se
 * -- motiveringen i filhuvudet ovan för varför ingen ytterligare
 * -- metadata-tabell/RLS-lager läggs till här.
 * CREATE POLICY "wo_images_storage_delete"
 *   ON storage.objects FOR DELETE TO authenticated
 *   USING (bucket_id = 'workorder-images');
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Felscenarier
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Uppladdning misslyckas: upload() kastar ett fel. Anroparen (WorkOrder-
 * DetailPage._saveLog()) visar felet och sparar INTE loggposten — exakt
 * samma "ingen låtsad framgång"-princip som redan används av
 * resolveChecklistItemAtomic() i denna kodbas. Ingen loggpost utan sin
 * avsedda bild sparas av misstag.
 *
 * Signerad URL kan inte genereras (t.ex. filen raderad manuellt i Storage):
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

  /* ── Signed URL (batch, med cache) ───────────────────────────
   * MEDVETEN kopia av PropertyImageService._getSignedUrls()s exakta
   * batchnings-/cache-mönster, mot denna tjänsts egen bucket. Ingen
   * delad hjälpfunktion att bryta ut finns idag i kodbasen för detta --
   * två oberoende, identiska implementationer mot var sin bucket är
   * redan hur PropertyImageService självt är byggt, inte en ny
   * abstraktion som införs här. */
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

    try {
      const res = await fetch(
        `${SUPABASE_URL}/storage/v1/object/sign/${this.BUCKET}`,
        {
          method:  'POST',
          headers: this._h('application/json'),
          body:    JSON.stringify({ paths: missing, expiresIn: 3600 })
        }
      );
      if (!res.ok) {
        console.warn('[WorkOrderImageService] Batch signed URL misslyckades:', res.status);
        return result;
      }
      const items = await res.json(); /* [{ path, signedURL, error }] */
      const expiry = now + 50 * 60 * 1000; /* 50 min cache */
      (items || []).forEach(item => {
        if (!item.error && item.signedURL) {
          const url = SUPABASE_URL + item.signedURL;
          this._urlCache[item.path] = { url, expiresAt: expiry };
          result[item.path] = url;
        }
      });
    } catch (e) {
      console.warn('[WorkOrderImageService] getSignedUrls() error:', e);
    }
    return result;
  },

  /* ── Upload ───────────────────────────────────────────────── */

  /**
   * Komprimerar (900px/JPEG 0.75, samma etablerade mönster som
   * RonderingUtforandePage) och laddar upp en bild till Storage.
   * Ingen separat metadata-rad skapas — se filhuvudets motivering.
   * @param {string} aoId  — arbetsorder-id, används som mapp-prefix i bucketen
   * @param {File}   file
   * @returns {Promise<{ path: string }>}  — kastar ett Error vid misslyckande
   *          (INGEN tyst, "låtsad" framgång — anroparen MÅSTE hantera felet
   *          och INTE spara loggposten som om bilden sparats).
   */
  async upload(aoId, file) {
    const dataUrl = await this._resizeImage(file);
    if (!dataUrl) throw new Error('Kunde inte läsa/komprimera bilden');
    const blob = this._dataUrlToBlob(dataUrl);
    const path = `${aoId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;

    const storRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${this.BUCKET}/${path}`,
      { method: 'POST', headers: this._h('image/jpeg'), body: blob }
    );
    if (!storRes.ok) {
      const err = await storRes.json().catch(() => ({}));
      throw new Error(err.message || err.error || `Uppladdning misslyckades (HTTP ${storRes.status})`);
    }
    return { path };
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
