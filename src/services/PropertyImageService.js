/**
 * PropertyImageService v1
 *
 * Hanterar uppladdning, listning och borttagning av fastighetsbilder
 * via Supabase Storage (bucket: property-images) + metadata-tabell (property_images).
 *
 * Bucket-typ: public  — URL:er är stabila och kräver inget token för visning.
 * Skrivning:  kräver giltigt JWT (authenticated role).
 * Radering:   kräver giltigt JWT (authenticated role).
 *
 * Setup krävs i Supabase (se nedan):
 *   1. Bucket: property-images  (public: true, max 10 MB, JPEG/PNG/WEBP/HEIC)
 *   2. Tabell: public.property_images (se SQL längre ner)
 *   3. Storage policies (authenticated INSERT/DELETE, public SELECT)
 *   4. RLS policies på tabellen
 *
 * ── Supabase-setup SQL ───────────────────────────────────────────────────
 *
 * -- 1. Skapa bucket (kör i SQL-editorn i Supabase-dashboarden)
 * insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
 * values (
 *   'property-images', 'property-images', true, 10485760,
 *   array['image/jpeg','image/jpg','image/png','image/webp','image/gif','image/heic','image/heif']
 * ) on conflict (id) do nothing;
 *
 * -- 2. Storage policies
 * create policy "prop_images_storage_select"
 *   on storage.objects for select to public
 *   using (bucket_id = 'property-images');
 *
 * create policy "prop_images_storage_insert"
 *   on storage.objects for insert to authenticated
 *   with check (bucket_id = 'property-images');
 *
 * create policy "prop_images_storage_delete"
 *   on storage.objects for delete to authenticated
 *   using (bucket_id = 'property-images');
 *
 * -- 3. Metadata-tabell
 * create table public.property_images (
 *   id            uuid        default gen_random_uuid() primary key,
 *   property_id   text        not null,
 *   storage_path  text        not null,
 *   title         text        not null default '',
 *   category      text                 default '',
 *   description   text                 default '',
 *   tech_section  text                 default '',
 *   created_by    uuid        references auth.users(id) on delete set null,
 *   created_at    timestamptz default now() not null
 * );
 * create index on public.property_images (property_id);
 * create index on public.property_images (created_at desc);
 * alter table public.property_images enable row level security;
 *
 * -- 4. RLS policies på tabellen
 * create policy "prop_images_select"
 *   on public.property_images for select to authenticated using (true);
 *
 * create policy "prop_images_insert"
 *   on public.property_images for insert to authenticated
 *   with check (auth.uid() = created_by);
 *
 * create policy "prop_images_delete"
 *   on public.property_images for delete to authenticated using (true);
 *
 * ─────────────────────────────────────────────────────────────────────────
 */

const PropertyImageService = {
  BUCKET: 'property-images',
  TABLE:  'property_images',

  _authHeaders(fileType) {
    const jwt = (typeof Auth !== 'undefined' && Auth.getAccessToken)
      ? (Auth.getAccessToken() || SUPABASE_AKEY)
      : SUPABASE_AKEY;
    const h = {
      'apikey':        SUPABASE_AKEY,
      'Authorization': 'Bearer ' + jwt
    };
    if (fileType) h['Content-Type'] = fileType;
    return h;
  },

  _jsonHeaders() {
    return Object.assign(this._authHeaders(), { 'Content-Type': 'application/json' });
  },

  /* Public URL för en bild-path (bucket är public) */
  publicUrl(path) {
    return `${SUPABASE_URL}/storage/v1/object/public/${this.BUCKET}/${path}`;
  },

  /* Hämta auth.users.id ur JWT payload */
  _userId() {
    try {
      const t = Auth.getAccessToken();
      if (!t) return null;
      return JSON.parse(atob(t.split('.')[1])).sub || null;
    } catch(e) { return null; }
  },

  /**
   * Ladda upp bild + spara metadata.
   * @param {string} propertyId
   * @param {File}   file
   * @param {{ title, category, description, techSection }} meta
   * @returns {Promise<{ id, property_id, storage_path, title, category, publicUrl }>}
   */
  async upload(propertyId, file, meta) {
    const ext  = (file.name || '').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g,'') || 'jpg';
    const path = `${propertyId}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
    const mime = file.type || 'image/jpeg';

    /* 1. Ladda upp fil till Storage */
    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${this.BUCKET}/${path}`,
      { method: 'POST', headers: this._authHeaders(mime), body: file }
    );
    if (!uploadRes.ok) {
      const err = await uploadRes.json().catch(() => ({}));
      throw new Error(err.message || err.error || `Uppladdning misslyckades (HTTP ${uploadRes.status})`);
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
        headers: Object.assign(this._jsonHeaders(), { 'Prefer': 'return=representation' }),
        body:    JSON.stringify(row)
      }
    );

    const saved = metaRes.ok ? (await metaRes.json())[0] : { ...row, id: `local-${Date.now()}` };
    if (!metaRes.ok) console.warn('[PropertyImageService] Metadata-sparning misslyckades:', metaRes.status);

    return { ...saved, publicUrl: this.publicUrl(path) };
  },

  /**
   * Hämta alla bilder för en fastighet.
   * @param {string} propertyId
   * @returns {Promise<Array>}
   */
  async list(propertyId) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${this.TABLE}?property_id=eq.${encodeURIComponent(propertyId)}&order=created_at.asc`,
      { headers: this._authHeaders(false) }
    );
    if (!res.ok) {
      console.warn('[PropertyImageService] list() misslyckades:', res.status);
      return [];
    }
    const rows = await res.json();
    return rows.map(r => ({ ...r, publicUrl: this.publicUrl(r.storage_path) }));
  },

  /**
   * Ta bort bild från Storage + metadata-tabell.
   * @param {string} id          — property_images.id (uuid)
   * @param {string} storagePath — sökväg i bucketen
   * @returns {Promise<boolean>}
   */
  async remove(id, storagePath) {
    /* Ta bort fil från Storage */
    const storRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${this.BUCKET}/${storagePath}`,
      { method: 'DELETE', headers: this._authHeaders(false) }
    );
    if (!storRes.ok) console.warn('[PropertyImageService] Storage-radering misslyckades:', storRes.status);

    /* Ta bort metadata */
    const metaRes = await fetch(
      `${SUPABASE_URL}/rest/v1/${this.TABLE}?id=eq.${encodeURIComponent(id)}`,
      { method: 'DELETE', headers: this._authHeaders(false) }
    );
    return metaRes.ok;
  }
};
