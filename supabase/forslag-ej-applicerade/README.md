# Förslag som aldrig applicerats i STAGING

De här tre filerna låg tidigare i `supabase/migrations/`. De har aldrig registrerats i
STAGING:s `supabase_migrations.schema_migrations`. 2026-11-27 (G1/G4 del 2) flyttades de
hit så att `supabase db push` inte kan installera dem av misstag.

| Fil | Varför den inte ska köras som den är |
|---|---|
| `20261120000001_PROPOSAL_push_subscriptions_index.sql` | Indexet `push_subscriptions_user_id_active_idx` finns inte i STAGING. `CREATE INDEX CONCURRENTLY` kan inte köras inuti en migrationstransaktion. |
| `20261120000002_PROPOSAL_timeentries_read_lockdown.sql` | Skapar policyn `store_timeentries_read_lockdown`. I drift heter motsvarande policy `store_timeentries_no_direct_select`, och den skapas nu av `migrations/20261127000003_rekonstruerad_store_restrictive_policyer.sql`. Att köra båda ger en dubblett. |
| `20261123000001_PROPOSAL_work_order_log_ops.sql` | Ersatt av `migrations/20261124000002_work_order_log_ops.sql`. Förslaget skapar en äldre överlagring `work_order_log_append(text, jsonb)` som inte finns i drift. |

VIFT-CRM har fortfarande filerna i sin `supabase/migrations/`, se `supabase/AUKTORITATIV-KALLA.md`.
