# G5 — Atomisk loggpost i arbetsorder

Status 2026-11-23: **klienten BYGGD och lokalt testad; serverdelen FÖRSLAG, ej installerad.**

## Problem

En loggpost skickades som `patch_ao` med arbetsorderns **hela** `log`-array. Två enheter som lägger till poster i samma AO samtidigt kan då skriva över varandra — den senast skrivna arrayen vinner och den andra posten försvinner (reproducerat: E2E AO-07).

## Lösning

| Del | Var | Status |
|---|---|---|
| Klient: `WorkOrderService.appendLogEntry()/removeLogEntry()` → `AOTimeSyncService.appendLog()/removeLog()` (samma varaktiga utkorg, idempotensnycklar, ordning per AO) | `src/services/*`, `WorkOrderDetailPage._saveLog/deleteLogEntry` | BYGGD |
| Klient: sonderar en gång per session om servern stöder åtgärden (`append_log` med tomma fält → `unknown_action` = stöds inte). Utan stöd används den gamla vägen oförändrat. | `AOTimeSyncService.supportsLogOps()` | BYGGD |
| Server: åtgärderna `append_log {aoId, entry}` och `remove_log {aoId, entryId}` i `ao-time-write` | Edge Function (källa saknas i repot, G4) | FÖRSLAG nedan |
| Server: RPC `work_order_log_append/remove` (radlås, idempotent på post-id) | `supabase/migrations/20261123000001_PROPOSAL_work_order_log_ops.sql` | FÖRSLAG |

Klienten kan installeras före servern: den fortsätter då som i dag (AO-07 kvarstår tills servern har åtgärden). När servern får åtgärden börjar klienterna använda den utan ny klientinstallation.

## Edge Function — tillägg i `ao-time-write` (förslag)

Lägg till två fall bredvid `patch_ao`, med **samma behörighetskontroll som `patch_ao`** (inloggad, aktiv användare; AO-mutationsrätt; får se AO:n) och samma idempotens-tabell (`op_idempotency`) som övriga åtgärder:

```ts
case 'append_log': {
  if (!body.aoId || !body.entry?.id) return definite(400, 'missing_fields');
  await assertCanMutateAo(ctx, body.aoId);           // samma som patch_ao
  const ao = await rpc('work_order_log_append', { p_ao_id: body.aoId, p_entry: sanitizeLogEntry(body.entry, ctx) });
  return ok({ workOrder: ao });
}
case 'remove_log': {
  if (!body.aoId || !body.entryId) return definite(400, 'missing_fields');
  await assertCanMutateAo(ctx, body.aoId);
  const ao = await rpc('work_order_log_remove', { p_ao_id: body.aoId, p_entry_id: body.entryId });
  return ok({ workOrder: ao });
}
```

`sanitizeLogEntry` ska bara släppa igenom kända fält (`id, type, text, imagePath, visibility, userName, timestamp`), tvinga `imageData` till tom sträng (inga inbäddade bilder) och sätta `userName` från den inloggade användaren. Svaret för en okänd åtgärd ska förbli `400 unknown_action` — klientens sondering bygger på det.

## Tester

- Lokalt (simulerad server med åtgärden): **AO-07B** — två enheter skriver samtidigt, båda posterna finns kvar; borttagning tar bara bort sin post; ingen `patch_ao` med hel logg.
- Lokalt (simulerad server utan åtgärden, som STAGING i dag): LOG-01..05 och AO-09 oförändrat gröna; AO-07 kvarstår som känt fel.
- **STAGING efter installation (kräver GO):** två inloggade enheter, samma AO, loggpost samtidigt → båda finns efter omladdning; dubbelt skickad post (tappat svar) → en post; användare utan rätt till AO:n → 403.
