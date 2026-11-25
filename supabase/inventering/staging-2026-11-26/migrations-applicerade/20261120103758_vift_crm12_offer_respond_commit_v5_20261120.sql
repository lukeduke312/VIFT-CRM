-- FÖRSLAG v5, EJ INSTALLERAT. Supersederar v4 (offer_respond_fix_v4/001_offer_respond_commit_v4.sql).
-- v4 i övrigt oförändrat -- v5 rättar EN bekräftad brist i v4:s eget
-- fingeravtryck, identifierad vid den externa acceptansgranskningen
-- (2026-11-20) och oberoende bekräftad av mig: se RÄTTNING 3 nedan.
--
-- BEKRÄFTAD BRIST I v3 (ÅTGÄRDAD I v4, OFÖRÄNDRAD HÄR): cache-uppslaget
-- `where fn_name = 'offer_respond_commit' and idem_key = p_request_id` slog
-- igen på ENDAST request-ID:t. Om SAMMA p_request_id någonsin återanvänds
-- med ANDRA parametrar (klientbugg, kolliderat/återanvänt ID, eller en
-- förväxlingsattack) returnerade v3 TYST det gamla, cachade resultatet --
-- fel svar till anroparen, utan att någon läsare kan upptäcka det.
--
-- RÄTTNING 1 (innehållsfingeravtryck, FRÅN v4): ett md5-fingeravtryck av
-- samtliga parametrar som påverkar utfallet (p_token/p_offer_version/
-- p_action/p_name/p_email/p_comment/p_change_category/p_decline_reason)
-- lagras INUTI det cachade `result`-objektet under den interna nyckeln `_fp`
-- -- INTE som en ny kolumn på `public.op_idempotency`. Skälet: tabellen
-- delas med invoice_append_checked/time_entry_create (enligt tidigare
-- dokumentation i detta uppdrag), vars faktiska INSERT-satser inte finns
-- tillgängliga för granskning här. Att lägga till en NY KOLUMN hade krävt
-- att alla delade callers either skickar den eller att den är nullable --
-- en risk som helt undviks genom att i stället bara lägga en extra nyckel
-- i den JSONB som redan är per-funktion (fn_name='offer_respond_commit'
-- särskiljer raden från andra funktioners cache-poster helt och hållet).
-- `_fp` STRIPPAS ALLTID innan något returneras till anroparen -- se
-- v_result nedan. Vid cache-träff: om det nya anropets fingeravtryck INTE
-- matchar det lagrade -> `idempotency_key_conflict` (hårt, synligt fel).
-- Om det matchar -> äkta repris, oförändrat beteende från v3.
--
-- RÄTTNING 2 (längdspärr, FRÅN v4): p_request_id längre än 128 tecken
-- avvisas EXPLICIT (`invalid_request_id`), FÖRE radlåset tas och FÖRE något
-- annat rör värdet. 128 tecken: generöst för varje UUID-baserat schema
-- (36 tecken) plus ett rimligt prefix, men begränsar lagrings-/indexkostnaden
-- i en tabell som delas med andra funktioner -- inte en gissning, ett
-- medvetet, generöst men begränsat val.
--
-- RÄTTNING 3 (NY I v5 -- entydigt fingeravtryck): v4:s fingeravtryck byggdes
-- genom strängkonkatenering med ETT '|'-tecken som avgränsare MELLAN fälten,
-- UTAN att '|' inuti ett fältvärde själv undkoms/eskejpas på något sätt.
-- Det betyder att två OLIKA kombinationer av indata kunde ge en IDENTISK
-- textsträng före md5() -- en verklig hash-kollision, inte bara teoretisk.
-- Konkret, bekräftat exempel: (p_comment='a|b', p_change_category='c') och
-- (p_comment='a', p_change_category='b|c') byggde båda strängen
-- '...a|b|c...' eftersom konkatenering inte vet var ETT fält slutar och
-- NÄSTA börjar när fältvärdet självt innehåller avgränsartecknet. Två
-- faktiskt OLIKA anrop med samma request-ID skulle alltså (med en låg men
-- verklig sannolikhet, eller en avsiktligt konstruerad kommentar/
-- kategori-sträng) kunna undgå idempotenskontrollen helt -- exakt den
-- lucka v4 skulle stänga, nu återöppnad via en annan väg.
--
-- LÖSNING: `jsonb_build_array(...)::text` istället för `||'|'||`-
-- konkatenering. Varje fält serialiseras som sin EGEN, citattecken-
-- avgränsade och korrekt JSON-eskejpade sträng (eller tal, för
-- p_offer_version) -- fältgränserna avgörs av JSON-syntaxens egna
-- kommatecken och hakparenteser, INTE av att leta efter ett tecken som kan
-- förekomma INUTI ett fältvärde. Detta är en entydig, strukturerad
-- representation: två olika indata-kombinationer kan inte längre ge samma
-- text (JSON-arrayens struktur gör gränsen mellan element omöjlig att
-- förväxla med innehållet i ett element, oavsett vilka tecken
-- fältvärdena själva innehåller).

begin;

do $$
begin
  if to_regprocedure('public.offer_respond_commit(text,int,text,text,text,text,text,text,text,text)') is not null
     or to_regprocedure('public.offer_respond_commit(text,int,text,text,text,text,text,text,text)') is not null
     or to_regprocedure('public.offer_respond_commit(text,int,text,text,text,text,text,text)') is not null then
    raise exception 'OFFER_RESPOND_COMMIT STOP: funktionen finns redan (v1/v2/v3/v4/annan version); granska innan den ersätts';
  end if;
end $$;

create function public.offer_respond_commit(
  p_token            text,
  p_offer_version    int,
  p_action           text,
  p_name             text,
  p_email            text,
  p_comment          text,
  p_decline_reason   text,
  p_ip               text,
  p_change_category  text default '',
  p_request_id       text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_offers jsonb;
  v_idx    int;
  v_off    jsonb;
  -- v_now FÅR INTE sättas här -- se v2/v3:s motivering (DECLARE-initierare
  -- evalueras före den blockerande `for update`-raden). Oförändrat.
  v_now    timestamptz;
  v_now_text text;
  v_new_status text;
  v_event_type text;
  v_event      jsonb;
  v_cached     jsonb;
  v_result     jsonb;
  v_fingerprint text;
begin
  -- NYTT I v4: längdspärr på p_request_id, FÖRE allt annat (inklusive
  -- NULL-kontrollerna nedan, eftersom detta är ett strukturellt
  -- förkastande, inte en affärsregel).
  if p_request_id is not null and length(p_request_id) > 128 then
    raise exception 'invalid_request_id';
  end if;

  -- Oförändrat från v2/v3: explicit NULL-kontroll FÖRE varje jämförelse/användning.
  if p_token is null or length(p_token) < 32 then
    raise exception 'invalid_token';
  end if;
  if p_action is null or p_action not in ('approve', 'change_request', 'decline') then
    raise exception 'invalid_action';
  end if;
  if p_offer_version is null then
    raise exception 'invalid_action';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'name_required';
  end if;
  if p_email is null or btrim(p_email) = '' or p_email not like '%@%' then
    raise exception 'name_required';
  end if;

  -- Radlås INNAN något läses för validering -- oförändrat från v2/v3.
  select value into v_offers from public.store where key = 'vift_offers' for update;

  v_now      := clock_timestamp();
  v_now_text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  if v_offers is null or jsonb_typeof(v_offers) <> 'array' then
    raise exception 'not_found';
  end if;

  select (ord - 1)::int into v_idx
    from jsonb_array_elements(v_offers) with ordinality as t(elem, ord)
    where elem ->> 'publicToken' = p_token
    limit 1;
  if v_idx is null then
    raise exception 'not_found';
  end if;
  v_off := v_offers -> v_idx;

  -- NYTT I v4: fingeravtrycket beräknas ALLTID när ett request-ID finns,
  -- oavsett om det blir en cache-träff eller inte -- det behövs i båda
  -- fallen (jämförelse vid träff, lagring vid nytt anrop).
  if p_request_id is not null and btrim(p_request_id) <> '' then
    -- RÄTTAT I v5 (se RÄTTNING 3 i filhuvudet): jsonb_build_array(...)::text
    -- istället för '|'-konkatenering -- varje fält citeras/eskejpas för sig
    -- av JSON-serialiseringen, så ett '|' (eller citattecken, eller något
    -- annat tecken) INUTI ett fältvärde kan aldrig förväxlas med en
    -- fältgräns.
    v_fingerprint := md5(
      jsonb_build_array(
        coalesce(p_token, ''),
        p_offer_version,
        coalesce(p_action, ''),
        coalesce(p_name, ''),
        coalesce(p_email, ''),
        coalesce(p_comment, ''),
        coalesce(p_change_category, ''),
        coalesce(p_decline_reason, '')
      )::text
    );

    create table if not exists public.op_idempotency (
      fn_name    text        not null,
      idem_key   text        not null,
      result     jsonb       not null,
      created_at timestamptz not null default now(),
      primary key (fn_name, idem_key)
    );
    select result into v_cached from public.op_idempotency
      where fn_name = 'offer_respond_commit' and idem_key = p_request_id
      for update;

    if v_cached is not null then
      -- NYTT I v4: jämför fingeravtryck INNAN något returneras.
      if (v_cached ->> '_fp') is distinct from v_fingerprint then
        raise exception 'idempotency_key_conflict';
      end if;
      -- Äkta repris, oförändrat beteende från v3: returnera cachat resultat,
      -- med `_fp` strippat (den interna nyckeln ska aldrig nå anroparen).
      return (v_cached - '_fp') || jsonb_build_object('isReplay', true);
    end if;
    -- Ingen cache-träff -- samma resonemang som v3 om samtidiga tvillingar
    -- (radlåset serialiserar dem; en misslyckad första tvilling rullas
    -- tillbaka utan att skriva cache, så den andra utvärderas normalt).
  end if;

  -- Samma valideringar som v2/v3, körda EFTER låset (och EFTER
  -- idempotenskontrollen ovan, som är en ren läsning/jämförelse och inte
  -- ändrar något som dessa kontroller beror på).
  if coalesce(v_off ->> 'tokenRevokedAt', '') <> '' then
    raise exception 'revoked';
  end if;
  if coalesce(v_off ->> 'tokenExpiresAt', '') <> '' then
    if (v_off ->> 'tokenExpiresAt')::timestamptz < v_now then
      raise exception 'expired';
    end if;
  end if;

  if coalesce((v_off ->> 'versionNumber')::int, 1) is distinct from p_offer_version then
    raise exception 'version_mismatch:%', coalesce((v_off ->> 'versionNumber')::int, 1);
  end if;

  if (v_off ->> 'status') in ('godkänd', 'nekad') then
    raise exception 'already_answered:%', (v_off ->> 'status');
  end if;

  v_new_status := case p_action
    when 'approve'        then 'godkänd'
    when 'change_request' then 'ändring-begärd'
    when 'decline'        then 'nekad'
  end;

  v_off := v_off || jsonb_build_object(
    'status', v_new_status, 'answeredAt', v_now_text, 'updatedAt', v_now_text
  );

  if p_action = 'approve' then
    v_off := v_off || jsonb_build_object(
      'customerApproval', jsonb_build_object(
        'token', p_token, 'approvedAt', v_now_text,
        'approvedByName', p_name, 'approvedByEmail', p_email,
        'ip', p_ip, 'comment', coalesce(p_comment, '')
      )
    );
  end if;

  if p_action = 'decline' then
    v_off := v_off || jsonb_build_object('declineReason', coalesce(nullif(p_decline_reason, ''), 'annat'));
  end if;

  v_offers := jsonb_set(v_offers, array[v_idx::text], v_off);
  update public.store set value = v_offers, updated_at = v_now where key = 'vift_offers';

  -- Oförändrat från v2/v3: händelseloggen i samma transaktion som statusändringen.
  v_event_type := case p_action
    when 'approve'        then 'approved'
    when 'change_request' then 'change_requested'
    when 'decline'         then 'declined'
  end;
  v_event := jsonb_build_object(
    'id',                    'oe-' || gen_random_uuid()::text,
    'offerId',               v_off ->> 'id',
    'offerVersion',          coalesce((v_off ->> 'versionNumber')::int, 1),
    'type',                  v_event_type,
    'ts',                    v_now_text,
    'byUser',                '',
    'byCustomer',            p_name,
    'byEmail',               p_email,
    'ip',                    coalesce(p_ip, ''),
    'comment',               coalesce(p_comment, ''),
    'changeRequestCategory', coalesce(p_change_category, ''),
    'declineReason',         coalesce(nullif(p_decline_reason, ''), ''),
    'requestId',             coalesce(p_request_id, '')
  );
  perform public.offer_events_append(v_event);

  -- v_result = exakt payloaden som returneras till anroparen -- ALDRIG
  -- utökad med `_fp`. v_cached = v_result + `_fp`, ENDAST det som lagras.
  v_result := jsonb_build_object(
    'offerId',      v_off ->> 'id',
    'offerVersion', coalesce((v_off ->> 'versionNumber')::int, 1),
    'offerTitle',   coalesce(v_off ->> 'title', v_off ->> 'id'),
    'newStatus',    v_new_status,
    'answeredAt',   v_now_text
  );

  if p_request_id is not null and btrim(p_request_id) <> '' then
    v_cached := v_result || jsonb_build_object('_fp', v_fingerprint);
    insert into public.op_idempotency(fn_name, idem_key, result)
      values ('offer_respond_commit', p_request_id, v_cached)
      on conflict (fn_name, idem_key) do nothing;
  end if;

  return v_result || jsonb_build_object('isReplay', false);
end;
$function$;

alter function public.offer_respond_commit(text,int,text,text,text,text,text,text,text,text) owner to postgres;
revoke all on function public.offer_respond_commit(text,int,text,text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.offer_respond_commit(text,int,text,text,text,text,text,text,text,text) to service_role;

commit;
