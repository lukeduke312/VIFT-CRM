/**
 * PropertyImageService v2 — Supabase Storage (PRIVATE bucket) + signed URLs
 *
 * Bucket-typ:  private — bilder kräver signerade URL:er, inga direkta publika URL:er.
 * Läsning:     authenticated users → signerade URL:er (1 timme, cachas 50 min).
 * Uppladdning: authenticated users → POST till Storage API.
 * Radering:    created_by kan radera egna bilder (RLS på metadata-tabellen).
 *              Storage-fil: alla authenticated (behöver path för att radera).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SUPABASE SETUP — kör följande SQL i Supabase SQL-editorn (idempotent)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Steg 1: Skapa PRIVAT bucket ─────────────────────────────────────────
 *
 * INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
 * VALUES (
 *   'property-images',
 *   'property-images',
 *   false,                  -- PRIVAT: ingen publik åtkomst
 *   10485760,               -- max 10 MB per fil
 *   ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif','image/heic','image/heif']
 * ) ON CONFLICT (id) DO NOTHING;
 *
 * ── Steg 2: Storage policies (idempotent) ───────────────────────────────
 *
 * -- Radera befintliga policies för denna bucket
 * DROP POLICY IF EXISTS "prop_images_storage_select" ON storage.objects;
 * DROP POLICY IF EXISTS "prop_images_storage_insert" ON storage.objects;
 * DROP POLICY IF EXISTS "prop_images_storage_delete" ON storage.objects;
 *
 * -- SELECT: authenticated users kan generera signed URLs och läsa filer
 * CREATE POLICY "prop_images_storage_select"
 *   ON storage.objects FOR SELECT TO authenticated
 *   USING (bucket_id = 'property-images');
 *
 * -- INSERT: authenticated users kan ladda upp
 * CREATE POLICY "prop_images_storage_insert"
 *   ON storage.objects FOR INSERT TO authenticated
 *   WITH CHECK (bucket_id = 'property-images');
 *
 * -- DELETE: authenticated users kan radera (Storage-nivå)
 * -- Metadata-tabellens RLS kontrollerar vem som får radera metadata
 * CREATE POLICY "prop_images_storage_delete"
 *   ON storage.objects FOR DELETE TO authenticated
 *   USING (bucket_id = 'property-images');
 *
 * ── Steg 3: Metadata-tabell (idempotent) ────────────────────────────────
 *
 * CREATE TABLE IF NOT EXISTS public.property_images (
 *   id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
 *   property_id   TEXT        NOT NULL,
 *   storage_path  TEXT        NOT NULL UNIQUE,
 *   title         TEXT        NOT NULL DEFAULT '',
 *   category      TEXT                 DEFAULT '',
 *   description   TEXT                 DEFAULT '',
 *   tech_section  TEXT                 DEFAULT '',
 *   created_by    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
 *   created_at    TIMESTAMPTZ DEFAULT now() NOT NULL
 * );
 *
 * CREATE INDEX IF NOT EXISTS property_images_property_id_idx ON public.property_images (property_id);
 * CREATE INDEX IF NOT EXISTS property_images_created_at_idx  ON public.property_images (created_at DESC);
 *
 * ALTER TABLE public.property_images ENABLE ROW LEVEL SECURITY;
 *
 * ── Steg 4: RLS på metadata-tabellen (idempotent) ───────────────────────
 *
 * -- Radera befintliga
 * DROP POLICY IF EXISTS "prop_images_select" ON public.property_images;
 * DROP POLICY IF EXISTS "prop_images_insert" ON public.property_images;
 * DROP POLICY IF EXISTS "prop_images_delete" ON public.property_images;
 * DROP POLICY IF EXISTS "prop_images_delete_own" ON public.property_images;
 *
 * -- SELECT: alla inloggade kan se alla bilder
 * CREATE POLICY "prop_images_select"
 *   ON public.property_images FOR SELECT TO authenticated
 *   USING (true);
 *
 * -- INSERT: inloggad kan lägga till bilder kopplade till sig själv
 * CREATE POLICY "prop_images_insert"
 *   ON public.property_images FOR INSERT TO authenticated
 *   WITH CHECK (auth.uid() = created_by);
 *
 * -- DELETE: användare kan radera egna bilder
 * --         (admin kan radera alla via Supabase-dashboarden eller service role)
 * CREATE POLICY "prop_images_delete_own"
 *   ON public.property_images FOR DELETE TO authenticated
 *   USING (auth.uid() = created_by);
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Felscenarier
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Storage-fil raderas, metadata finns kvar:
 *   → list() försöker generera signed URL → Supabase returnerar fel
 *   → _getSignedUrls() kastar bort poster med fel → syns ej i galleri
 *   → Metadata-raden blir en "zombie" (ofarlig, ej synlig)
 *
 * Metadata raderas, Storage-fil finns kvar:
 *   → Filen syns ej i galleri (galleri läser från metadata-tabell)
 *   → Storage-filen är orphaned → kan rensas manuellt i Supabase-dashboarden
 *   → Ingen påverkan på UI
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

const PropertyImageService = {
  BUCKET: 'property-images',
  TABLE:  'property_images',

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

  _userId() {
    try {
      const t = (typeof Auth !== 'undefined') ? Auth.getAccessToken() : null;
      if (!t) return null;
      return JSON.parse(atob(t.split('.')[1])).sub || null;
    } catch(e) { return null; }
  },

  /* ── Signed URL (batch, med cache) ───────────────────────── */

  /**
   * Hämtar signerade URL:er för en lista paths.
   * Cachar i _urlCache (50 min). Filtrerar bort fel-svar.
   * @param {string[]} paths
   * @returns {Promise<{ [path]: string }>}  path → signedUrl
   */
  async _getSignedUrls(paths) {
    if (!paths.length) return {};

    /* Separera cachade från okachade */
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
        console.warn('[PropertyImageService] Batch signed URL misslyckades:', res.status);
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
    } catch(e) {
      console.warn('[PropertyImageService] _getSignedUrls() error:', e);
    }
    return result;
  },

  /* ── Upload ───────────────────────────────────────────────── */

  /**
   * Ladda upp bild till Storage och spara metadata i property_images.
   * @param {string} propertyId
   * @param {File}   file
   * @param {{ title, category, description, techSection }} meta
   * @returns {Promise<{ id, storage_path, signedUrl, ...row }>}
   */
  async upload(propertyId, file, meta) {
    const ext  = (file.name || '').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${propertyId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const mime = file.type || 'image/jpeg';

    /* 1. Ladda upp fil */
    const storRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${this.BUCKET}/${path}`,
      { method: 'POST', headers: this._h(mime), body: file }
    );
    if (!storRes.ok) {
      const err = await storRes.json().catch(() => ({}));
      throw new Error(err.message || err.error || `Uppladdning misslyckades (HTTP ${storRes.status})`);
    }

    /* 2. Spara metadata */
    const row = {
      property_id:  propertyId,
      storage_path: path,
      title:        (meta.title       || '').trim(),
      category:     (meta.category    || ''),
      description:  (meta.description || '').trim(),
      tech_section: (meta.techSection || ''),
      created_by:   this._userId()
    };
    const metaRes = await fetch(
      `${SUPABASE_URL}/rest/v1/${this.TABLE}`,
      {
        method:  'POST',
        headers: Object.assign(this._h('application/json'), { 'Prefer': 'return=representation' }),
        body:    JSON.stringify(row)
      }
    );
    if (!metaRes.ok) console.warn('[PropertyImageService] Metadata-sparning misslyckades:', metaRes.status);
    const saved = metaRes.ok ? (await metaRes.json())[0] : { ...row, id: `tmp-${Date.now()}` };

    /* 3. Generera signed URL för den nya bilden */
    const urls = await this._getSignedUrls([path]);
    return { ...saved, signedUrl: urls[path] || null };
  },

  /* ── List ─────────────────────────────────────────────────── */

  /**
   * Hämta alla bilder för en fastighet med signerade URL:er.
   * @param {string} propertyId
   * @returns {Promise<Array<{ id, storage_path, title, category, signedUrl, ... }>>}
   */
  async list(propertyId) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${this.TABLE}` +
      `?property_id=eq.${encodeURIComponent(propertyId)}&order=created_at.asc`,
      { headers: this._h(false) }
    );
    if (!res.ok) {
      console.warn('[PropertyImageService] list() misslyckades:', res.status);
      return [];
    }
    const rows = await res.json();
    if (!rows.length) return [];

    /* Hämta signerade URL:er i ett batch-anrop */
    const urlMap = await this._getSignedUrls(rows.map(r => r.storage_path));

    /* Filtrera bort rader där signed URL inte kunde genereras (orphaned metadata) */
    return rows
      .map(r => ({ ...r, signedUrl: urlMap[r.storage_path] || null }))
      .filter(r => r.signedUrl !== null);
  },

  /* ── Remove ───────────────────────────────────────────────── */

  /**
   * Radera bild från Storage + metadata.
   * RLS-policy kräver att användaren är created_by för metadata-raden.
   * Storage-filen raderas alltid (authenticated policy på storage.objects).
   *
   * @param {string} id          — property_images.id (uuid)
   * @param {string} storagePath — sökväg i bucketen
   * @returns {Promise<{ storageOk: boolean, metaOk: boolean }>}
   */
  async remove(id, storagePath) {
    /* Ogiltigförklara cache för denna path */
    delete this._urlCache[storagePath];

    /* Radera Storage-fil */
    const storRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${this.BUCKET}/${storagePath}`,
      { method: 'DELETE', headers: this._h(false) }
    );
    if (!storRes.ok) console.warn('[PropertyImageService] Storage-radering misslyckades:', storRes.status);

    /* Radera metadata (kräver att auth.uid() = created_by via RLS) */
    const metaRes = await fetch(
      `${SUPABASE_URL}/rest/v1/${this.TABLE}?id=eq.${encodeURIComponent(id)}`,
      { method: 'DELETE', headers: this._h(false) }
    );
    if (!metaRes.ok) {
      const status = metaRes.status;
      if (status === 403) throw new Error('Du kan bara radera dina egna bilder');
      throw new Error(`Metadata-radering misslyckades (HTTP ${status})`);
    }

    return { storageOk: storRes.ok, metaOk: metaRes.ok };
  }
};
