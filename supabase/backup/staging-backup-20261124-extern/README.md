# Kopia av `vift_staging_backup_20261124` utanför Supabase (STAGING)

Själva kopian ligger **inte** i repot, eftersom den innehåller verksamhetsdata från STAGING. Den finns i ZIP-filen `VIFT-STAGING-backup-20261124-extern-kopia.zip`, som Lucas förvarar.

ZIP-filens SHA-256:

    7e2693d509b19dc44a1eec9082c7ff5c8f0b0f50e5acee11c8bbe09740fc84c2

`MANIFEST.txt` listar antal, md5-summor och SHA-256 för varje fil i kopian. Med den kan en kopia kontrolleras utan att datan ligger i git.

## Verifiering 2026-11-24

Kopian verifierades med `tools/staging-backup-export.js --fran-csv … --provata-lokalt`:

- Summorna är identiska med databasens:
  - store: 40 nycklar;
  - op_idempotency: 2 146 poster;
  - funktioner: 50.
- Den lokala återställningsprovningen gav samma md5 för alla 40 nycklar och tog med alla 2 146 idempotensposter.
- Samma resultat fås när kontrollen körs från den uppackade ZIP-filen.
- Kopian innehåller inga lösenord, portkoder, nyckelfält med värden eller hemliga nycklar.

Återställning kräver GO. Se `LASMIG.md` i ZIP-filen och `supabase/manual/staging_restore_from_backup_20261124.sql`.
