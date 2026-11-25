/**
 * vift-admin-storage — AVAKTIVERAD (2026-11-24). Var en tillfällig
 * underhållsfunktion (logotyp till vift-branding, städning av testobjekt).
 * Källan för den aktiva versionen finns i repot under samma namn i git-historiken.
 */
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
serve(() => new Response(JSON.stringify({ error: 'disabled' }), { status: 410, headers: { 'Content-Type': 'application/json' } }))
