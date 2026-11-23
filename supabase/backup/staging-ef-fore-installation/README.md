# STAGING Edge Functions — installerade versioner före installation

Kopia **utanför Supabase** av de tre Edge Functions som GO-5–GO-8 ersätter. Källan är hämtad med Supabase-anslutningen (`get_edge_function`, bara läsning) från STAGING-projektet. Filerna är byte för byte den installerade källan.

Mappen ligger utanför `supabase/functions/` och kan därför inte deployas av misstag med `supabase functions deploy`.

| Funktion | Version | Senast deployad (UTC) | verify_jwt | `ezbr_sha256` (Supabase) |
|---|---|---|---|---|
| `store-key-write` | v3 | 2026-11-17 08:55:40 | true | `8ceb194e3f52d6ec0c1657065c7e81af58bd0a1942d9297a202a85e8b600d467` |
| `work-order-checklist-resolve` | v1 | 2026-11-16 09:40:48 | true | `52556e15a22ebbe6530ed2319e3ce2339cb896f54ec7519fa99c8f46e08b44ac` |
| `offer-attachment-upload` | v12 | 2026-10-30 08:50:11 | true | `eeb30150d4678a478d7056ad20802e08492c08b937e7f2c38e318e430c76c77c` |

SHA-256 för filerna i den här mappen:

```
0828ac780c274add408e65787033adbe3a0fef42a1cf81e4af3fe2b59fb130e2  store-key-write-v3/functions/store-key-write/index.ts
8fe18d66eff52598148113d4ca5306ba7d36a2ee698aa78a40f52b5d9f8d0a96  store-key-write-v3/functions/store-key-write/stamp-status.ts
d3d4bbc40b1bd30c6bad6dc3f26edce1508ca21110fdddda0f0f7048720d939d  work-order-checklist-resolve-v1/functions/work-order-checklist-resolve/index.ts
edb0013778d20a6ecf2eb46daf58de298db158d4a3a1b852aa60161f8648bca0  offer-attachment-upload-v12/functions/offer-attachment-upload/index.ts
a6082c26467af8997ca02279c4241ead7b2408b3fa931caa5f29cbec73ef2957  */functions/_shared/vift-auth.ts   (samma fil i alla tre)
```

Källorna innehåller inga hemligheter. Nycklarna läses med `Deno.env.get(...)`.

## Jämförelse med repot

| Funktion | Jämfört med | Resultat |
|---|---|---|
| `store-key-write` v3 | `5b239b8` (`index.ts`, `stamp-status.ts`) | **Identisk.** Förkontrollen för GO-6 (§2i) är godkänd. |
| `work-order-checklist-resolve` v1 | repot före `3f2dd7d` | Identisk utom importen: den installerade låser `supabase-js@2.118.0`. Repots nya version har samma låsning. Förkontrollen för GO-5 (§2g steg 2) är godkänd. |
| `_shared/vift-auth.ts` | repot HEAD | `checkViftAuth` och `hasPerm` är identiska. Repot har dessutom `canViewWorkOrder` och `isPathUnderAo`, som används av bild-EF:erna. Det är bara ett tillägg. |
| `offer-attachment-upload` v12 | repot HEAD | **Avviker.** Den installerade är nyare än repot: den använder atomiska `offer_attachment_append`, `offer_attachment_soft_delete` och `offer_events_append`, och den tillåter `apikey` i CORS. Repots version läser och skriver hela arrayen och saknar `apikey`. **§2e är NO-GO i nuvarande form**, se installationsplanen. |

## Återställning

Deploya mappens källa med samma namn, till exempel via Supabase-anslutningen (`deploy_edge_function` med filerna under `functions/`) eller med CLI från en kopia där filerna ligger under `supabase/functions/`. Behåll `verify_jwt = true`.
