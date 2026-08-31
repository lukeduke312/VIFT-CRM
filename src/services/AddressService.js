/**
 * AddressService v4 — Adressautokomplettering (återanvändbar)
 *
 * Koppling via HTML-attribut på adressinputen:
 *   oninput="AddressService.handleInput(this)"
 *   onblur="setTimeout(()=>AddressService.hideSuggestions(),150)"
 *   data-addr-zip="<id>"      — postnummerfält (valfritt)
 *   data-addr-city="<id>"     — stadsfält (valfritt)
 *   data-addr-country="<id>"  — landfält (valfritt)
 *   data-addr-lat="<id>"      — latitudfält (valfritt)
 *   data-addr-lng="<id>"      — longitudfält (valfritt)
 *
 * Om data-addr-zip/city finns:
 *   → adressfältet = gatuadress, zip/city fylls separat
 *   → relaterade fält töms om adressfältet töms
 * Om de saknas:
 *   → adressfältet = fullständig label (gatuadress, postnummer stad)
 *
 * Adresskälla (dataset.addrSource):
 *   'mapbox'   — vald från autocomplete
 *   'customer' — satt från vald kund/fastighet (AO-formulär)
 *   ''         — manuellt inskriven
 *
 * Token: window.VIFT_CONFIG.mapboxToken i config.js (rotmappen).
 * Lämnas tom → tyst fallback till manuell inmatning.
 *
 * NormalizedAddress: { label, address, zip, city, country, lat, lng, provider }
 */

const AddressService = {
  PROVIDER: 'mapbox',
  _debounceTimer: null,
  _results: [],
  _currentInput: null,

  _token() {
    return (window.VIFT_CONFIG && window.VIFT_CONFIG.mapboxToken) || '';
  },

  /* ── Publik API ────────────────────────────────────────────── */

  async search(query) {
    if (!this._token() || (query || '').trim().length < 3) return [];
    try {
      return await this._fetchMapbox(query.trim());
    } catch(e) {
      console.warn('[AddressService] search() fel:', e);
      return [];
    }
  },

  /* ── Mapbox-implementation ─────────────────────────────────── */

  async _fetchMapbox(query) {
    const url = 'https://api.mapbox.com/geocoding/v5/mapbox.places/'
      + encodeURIComponent(query) + '.json'
      + '?access_token=' + encodeURIComponent(this._token())
      + '&country=se&language=sv&types=address&limit=5';
    const res = await fetch(url);
    if (res.status === 401 || res.status === 403) {
      console.warn('[AddressService] Mapbox HTTP ' + res.status + ' — kontrollera token och domänbegränsning i config.js');
      throw new Error('Mapbox HTTP ' + res.status);
    }
    if (!res.ok) throw new Error('Mapbox HTTP ' + res.status);
    const { features = [] } = await res.json();
    return features.map(f => this._normalizeMapbox(f));
  },

  _normalizeMapbox(f) {
    const streetName = f.text    || '';
    const houseNum   = f.address || '';
    const address    = houseNum ? streetName + ' ' + houseNum : streetName;
    let zip = '', city = '', country = 'Sverige';
    (f.context || []).forEach(c => {
      const type = (c.id || '').split('.')[0];
      if      (type === 'postcode') zip     = c.text || '';
      else if (type === 'place')   city    = c.text || '';
      else if (type === 'country') country = c.text || 'Sverige';
    });
    return {
      label:    f.place_name || address,
      address,
      zip,
      city,
      country,
      lat:      f.center ? f.center[1] : null,
      lng:      f.center ? f.center[0] : null,
      /* 0-1, Mapbox egen "hur säker är denna träff"-signal — används av
         geocodeWorkAddress() nedan för att hellre visa INGEN nål än en
         övertygat FEL nål när frågan är tvetydig (t.ex. en gatuadress som
         förekommer i flera städer och vi saknar postnummer/ort att
         disambiguera med). */
      relevance: typeof f.relevance === 'number' ? f.relevance : null,
      provider: 'mapbox'
    };
  },

  /* ── Arbetsordrar: adressträng + geokodning med tillit ──────────────
   * V51B ARBETSORDER §6/§8 — bygger EN konsekvent frågesträng för både
   * autokomplettering och kart-geokodning, och avgör om ett Mapbox-svar
   * är tillräckligt säkert för att sätta en nål.
   */

  /* Bygger "gata, postnr ort" (+ ev land) — hoppar över tomma delar.
     Country utelämnas om den är tom/"Sverige" (default, se _normalizeMapbox)
     eftersom Mapbox-anropet redan är landbegränsat via &country=se. */
  formatQuery(street, zip, city, country) {
    const line2 = [zip, city].filter(Boolean).join(' ');
    const parts = [street, line2].filter(Boolean);
    if (country && country !== 'Sverige') parts.push(country);
    return parts.join(', ');
  },

  /* Geokoda en frågesträng och returnera { lat, lng } bara om resultatet
     är tillräckligt säkert att lita på, annars null (INGEN nål hellre än
     en FEL nål — se uppdragets §8).

     R1 §5 — HÄRDAD: en tidigare version tillät en bar gatuadress (ingen
     postnummer/ort-kontext alls) att sätta en nål om Mapboxs egen
     `relevance`-poäng var >= 0.8. Det gick INTE att bevisa i denna miljö
     (ingen nätverksåtkomst till riktiga Mapbox här) att `relevance` verkligen
     särskiljer "rätt gata, rätt stad" från "rätt gata, FEL stad" — Mapbox
     relevance mäter hur väl frågan matchar TRÄFFENS EGEN textrepresentation
     (stavning/ordning), INTE huruvida just den staden var den avsedda, så en
     bar gatuadress som råkar finnas i flera svenska städer kan mycket väl få
     samma höga relevance oavsett vilken stad Mapbox råkar returnera överst.
     Eftersom detta INTE kunde bevisas säkert, och uppdraget uttryckligen
     kräver att "no pin" väger tyngre än en obevisad konfidenssignal:
     hasCityContext:false GER ALDRIG en nål längre, oavsett relevance. En bar
     gatuadress utan postnummer/ort NÅGONSTANS i fallback-kedjan (varken på
     AO:n själv, den länkade fastigheten, eller kunden) resulterar numera
     alltid i ingen sparad koordinat — hellre än att riskera exakt den
     produktionsbugg detta arbete finns till för att eliminera. */
  async geocodeTrusted(query, hasCityContext) {
    if (!hasCityContext) return null;
    const results = await this.search(query);
    if (!results.length) return null;
    const best = results[0];
    if (best.lat == null || best.lng == null) return null;
    return { lat: best.lat, lng: best.lng };
  },

  /* R2 §1 — deterministisk gatunamn-normalisering, ENDAST för att avgöra
     om en legacy-AO:s egen gatuadress FAKTISKT syftar på samma plats som
     en länkad fastighet/kund, innan postnr/ort får lånas därifrån. Ingen
     fuzzy-matchning — bara trim, gemener, kollapsad whitespace och säker
     ytlig skiljeteckensnormalisering (så "Fastighetsgatan 1" och
     " FASTIGHETSGATAN   1 " räknas som samma gata, men "Specialgatan 10"
     aldrig matchar "Fastighetsgatan 1"). */
  _normalizeStreet(s) {
    return (s || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,]/g, '');
  },

  /* ── EN KANONISK adress-resolver för arbetsordrar — R1 §1/canonical ──
   * Tidigare fanns TVÅ separata kopior av denna fallback-kedja (en i
   * Dashboard.js för kartan, en förenklad/felaktig i WorkOrderService.js
   * för geokodning-vid-spara) som kunde DIVERGERA: WorkOrderService byggde
   * bara AO:ns EGNA address/zip/city, aldrig fastighetens/kundens — så en
   * legacy-AO med bara en gatuadress kunde geokodas fel (utan postnr/ort)
   * varje gång update() kördes, trots att Dashboard-kartans egen,
   * KORREKTA kedja visste bättre. Nu finns EN version, här, och BÅDA
   * WorkOrderService.geocodeAddressIfNeeded() och Dashboard._initOpsMap()
   * anropar den — de kan aldrig divergera igen.
   *
   * R2 §1 (oberoende reproducerad blockerare) — SÄKER LEGACY-BERIKNING:
   * steg 2/3 nedan (låna postnr/ort från länkad fastighet/kund för en
   * legacy-AO:s bara gatuadress) fick TIDIGARE göra det oavsett om AO:ns
   * gatuadress ens syftade på samma plats som fastigheten/kunden. Ett
   * AO med `address:"Specialgatan 10"` länkat till en fastighet på
   * "Fastighetsgatan 1, Göteborg" kunde alltså få frågan
   * "Specialgatan 10, Göteborg" — en plats som mycket väl kan ligga i en
   * helt annan stad än den fastigheten faktiskt är i. Nu krävs att AO:ns
   * (normaliserade) gatuadress är IDENTISK med den länkade entitetens
   * gatuadress innan postnr/ort lånas — annars ingen stadskontext alls,
   * och (se geocodeTrusted() ovan) ingen sparad koordinat.
   *
   * Prövas i strikt ordning, returnerar första träffen:
   *   1. AO:ns EGNA strukturerade fält (address + zip/city).
   *   2. Legacy: AO:ns gatuadress MATCHAR länkad FASTIGHETS gatuadress
   *      (normaliserad jämförelse) → låna fastighetens postnr/ort.
   *   3. Legacy: AO:ns gatuadress MATCHAR länkad KUNDS gatuadress
   *      (normaliserad jämförelse) → låna kundens postnr/ort.
   *   4. Fastighetens EGEN adress (inkl. dess postnr/ort) — om AO:n helt
   *      saknar egen adress men har en länkad fastighet MED adress.
   *   5. R2.2 §4/§5 (oberoende reproducerad blockerare) — KUNDENS EGEN
   *      adress (inkl. dess postnr/ort) — ENDAST om AO:n helt saknar egen
   *      adress OCH det antingen inte finns någon länkad fastighet alls,
   *      eller den länkade fastigheten helt saknar en egen adress. En
   *      länkad fastighet MED en gatuadress (även utan postnr/ort) är
   *      fortfarande den troliga arbetsplatsen och vinner ALLTID över
   *      kundens adress — kundfallbacken finns bara för att en tidigare
   *      omgång lät displayAddress()/resolveWorkOrderDisplayAddress()
   *      VISA en kundadress-fallback för en sådan AO, men gav den ALDRIG
   *      en geokodningsväg — en legacy-AO länkad bara till en kund (ingen
   *      fastighet) kunde alltså aldrig få en nål på kartan, trots att
   *      Dashboard-etiketten och AO-detaljen redan visade en fullständig
   *      adress. Samma hasCityContext-regel som fastighetsgrenen: bara
   *      om kunden har postnr ELLER ort får resultatet lita på en nål.
   *   6. Sista utväg: AO:ns bara gatuadress, UTAN postnr/ort-kontext alls
   *      — hasCityContext:false, vilket (se geocodeTrusted() ovan) aldrig
   *      längre kan sätta en nål.
   * Returnerar null om AO:n saknar adress helt (inget att försöka alls). */
  resolveWorkOrderQuery(ao) {
    if (!ao) return null;
    if (ao.address && (ao.zip || ao.city)) {
      return { query: this.formatQuery(ao.address, ao.zip, ao.city, ao.country), hasCityContext: true };
    }
    const prop = ao.propertyId ? getObj(ao.propertyId) : null;
    const cu   = ao.customerId ? getCu(ao.customerId) : null;
    const aoStreetNorm = this._normalizeStreet(ao.address);
    const streetMatches = (entityAddress) => !!aoStreetNorm && aoStreetNorm === this._normalizeStreet(entityAddress);
    if (ao.address && prop && (prop.zip || prop.city) && streetMatches(prop.address)) {
      return { query: this.formatQuery(ao.address, prop.zip, prop.city, ''), hasCityContext: true };
    }
    if (ao.address && cu && (cu.zip || cu.city) && streetMatches(cu.address)) {
      return { query: this.formatQuery(ao.address, cu.zip, cu.city, ''), hasCityContext: true };
    }
    if (!ao.address && prop && prop.address) {
      return { query: this.formatQuery(prop.address, prop.zip, prop.city, ''), hasCityContext: !!(prop.zip || prop.city) };
    }
    if (!ao.address && (!prop || !prop.address) && cu && cu.address) {
      return { query: this.formatQuery(cu.address, cu.zip, cu.city, ''), hasCityContext: !!(cu.zip || cu.city) };
    }
    if (ao.address) {
      return { query: ao.address, hasCityContext: false };
    }
    return null;
  },

  /* R2.1 §11 — delad DISPLAY-resolver, medvetet SKILD från
     resolveWorkOrderQuery()/geocodeTrusted() ovan (geokodningsförtroende
     och visningsfallback är RELATERADE men INTE samma beslut — en
     legacy-AO utan egen adress kan säkert VISA en länkad fastighets-
     /kundadress som läsfallback, samtidigt som blocker #1:s strikta
     gatumatchningskrav fortfarande styr om en KOORDINAT får sparas).
     Precedens:
       1. AO:ns EGNA sparade strukturerade adress (historisk
          ögonblicksbild) vinner ALLTID om den finns.
       2. Om AO:n saknar egen gatuadress helt: länkad FASTIGHETS egna
          strukturerade adress.
       3. Annars: länkad KUNDS egna strukturerade adress.
       4. Annars: tomt (inget att visa).
     Skriver ALDRIG till AO:n, fastigheten eller kunden — ren läsning,
     säker att anropa från vilken visningsyta som helst (Dashboard,
     AO-detalj, m.fl.) utan biverkningar. En BEFINTLIG AO-gata ersätts
     ALDRIG av live masterdata — bara ett genuint TOMT AO-adressfält
     faller tillbaka till den länkade posten. */
  resolveWorkOrderDisplayAddress(ao) {
    if (!ao) return { address: '', zip: '', city: '', country: '' };
    if (ao.address) {
      return { address: ao.address, zip: ao.zip || '', city: ao.city || '', country: ao.country || '' };
    }
    const prop = ao.propertyId ? getObj(ao.propertyId) : null;
    if (prop && prop.address) {
      return { address: prop.address, zip: prop.zip || '', city: prop.city || '', country: '' };
    }
    const cu = ao.customerId ? getCu(ao.customerId) : null;
    if (cu && cu.address) {
      return { address: cu.address, zip: cu.zip || '', city: cu.city || '', country: '' };
    }
    return { address: '', zip: '', city: '', country: '' };
  },

  /* R2 §2/§3, kompletterad i R2.1 §11/§12 — delad kompakt formatterare för
     att VISA en AO:s (eller dess länkade fallbacks) strukturerade
     arbetsadress (AO-detalj, Dashboard, m.fl.) och för att bygga en
     Google Maps-destination. Återanvänder formatQuery() rakt av — samma
     "gata, postnr ort[, land om inte Sverige]"-formatering som redan
     gäller för geokodningsfrågor, så ett icke-standardland (t.ex.
     Belgien) aldrig tyst försvinner ur varken visningen eller
     Maps-länken, utan att "Sverige" i onödan skrivs ut för normalfallet. */
  displayAddress(ao) {
    const resolved = this.resolveWorkOrderDisplayAddress(ao);
    if (!resolved.address) return '';
    return this.formatQuery(resolved.address, resolved.zip, resolved.city, resolved.country);
  },

  /* ── R2.5 — EN KANONISK skapande-tids-adress-normaliserare ──────────
   * Oberoende reproducerad blockerare: R2–R2.4:s state-maskin-arkitektur
   * garanterar en säker strukturerad adress-snapshot bara för
   * huvudguiden (WorkOrdersPage) och redigera-dialogen
   * (WorkOrderDetailPage). VIFT har FLERA andra produktionsvägar som
   * skapar AO:er direkt: RecurringOrderService.createNextAO(),
   * RonderingService.createAOFromAvvikelse(),
   * ServiceIntervalService.createAOForInterval(),
   * PageShells.js:s offert→AO-konvertering, PropertyDetailPage.js:s
   * direktskapande-flöde. Ingen av dessa byggde tidigare in en
   * strukturerad zip/city-snapshot i den nya AO:n — de skickade bara en
   * bar gatuadress (ofta en exakt kopia av en länkad fastighets/kunds
   * `.address`) och litade på att geokodningen SENARE skulle låna
   * postnr/ort. Det bröt mot arkitekturens grundprincip: AO:N ÄGER SIN
   * EGEN SNAPSHOT — om fastighetens/kundens adress ändras EFTER att
   * AO:n skapats får AO:ns historik inte plötsligt sakna postnr/ort bara
   * för att den aldrig fick sin egen kopia från början.
   *
   * Denna funktion körs EN GÅNG, centralt, inifrån
   * WorkOrderService.create() — INTE update() (en befintlig AO:s
   * snapshot-semantik, R1 §4, är oförändrad: en sparad adress följer
   * ALDRIG automatiskt framtida masterdata-ändringar). Genom att hooka
   * in den i create() själv slipper varje enskilt anropsställe
   * duplicera sin egen adress-logik — exakt den typ av divergens-risk
   * (Dashboard vs. WorkOrderService, R1 blockerare #1) denna omgångs
   * hela arkitektur finns till för att förhindra.
   *
   * Regler, prövade i strikt ordning (samma säkra normaliserade
   * gatumatchning som resolveWorkOrderQuery(), ALDRIG fuzzy):
   *   A. Anroparen skickade redan en KOMPLETT strukturerad adress
   *      (gata + postnr ELLER ort) → rör INGENTING, bevara exakt.
   *   B. Anroparen skickade INGEN adress alls, men en länkad fastighet
   *      har en egen adress → snapshotta fastighetens gata+postnr+ort.
   *   C. Ingen fastighetsadress (eller ingen fastighet), men en länkad
   *      kund har en egen adress → snapshotta kundens gata+postnr+ort.
   *   D. Anroparen skickade en BAR gata som (normaliserat) MATCHAR den
   *      länkade fastighetens gata → bevara gatan, kopiera SÄKERT
   *      fastighetens postnr/ort.
   *   E. Bar gata matchar istället den länkade kundens gata (och ingen
   *      säkrare fastighetsmatchning finns) → kopiera kundens postnr/ort.
   *   F. Bar gata som varken matchar fastighet eller kund (en genuint
   *      annan/anpassad adress) → bevara gatan OFÖRÄNDRAD, HITTA INTE PÅ
   *      postnr/ort — hellre ingen nål än en nål i fel stad (R1 §5).
   * En AO markerad addressOverride===true (manuell/särskild adress)
   * rörs ALDRIG av denna funktion — det är redan användarens egna,
   * medvetna data (samma princip som "särskild adress är användardata",
   * R2.4 Invariant C). */
  /* R2.6 §5/§6 (oberoende reproducerad blockerare) — R2.5 normaliserade
     bara adress-FÄLTEN (address/zip/city), aldrig LÄGES-metadatan
     (addressSource/addressOverride). Schema.workOrder() default för
     addressOverride är `false` — en RIKTIG boolean, inte `undefined` —
     så varje programmatiskt skapad AO som inte själv satte
     addressOverride fick tyst `addressOverride:false` ändå (via
     Object.assign(Schema.workOrder(), data, ...)). WorkOrderDetailPage.js
     litar RAKT AV på en redan-boolean addressOverride (R1 §3s legacy-
     härledning körs bara när fältet är `undefined`) — så en genuint
     anpassad/avvikande adress (Fall F) öppnades i redigera-läge som om
     den vore en vanlig standardadress, och en Återkommande-post med
     addressSource='manual' kunde generera en AO som såg ut som
     default-läge. Denna funktion sätter nu BÅDA — fälten OCH
     addressSource/addressOverride — enligt samma strikta,
     icke-gissande gatumatchning som redan gällde för fälten.
     Invariant för VARJE ny AO efter denna funktion:
       property-läge → addressSource='property', addressOverride=false
       kund-läge     → addressSource='customer', addressOverride=false
       eget/särskilt → addressSource='manual',   addressOverride=true
     En anropare som REDAN skickat addressOverride===true (t.ex.
     huvudguidens särskilda-adress-läge) litas på fullt ut och rörs
     ALDRIG — det är redan användarens medvetna, fullständiga data. En
     anropare som skickat ett EXPLICIT giltigt addressSource ('property'|
     'customer'|'manual') respekteras också — denna funktion skriver
     ALDRIG över ett explicit val, den fyller bara i det som saknas. */
  resolveCreateAddressSnapshot(ao) {
    if (!ao) return;
    if (ao.addressOverride === true) return;

    const explicitSource = (ao.addressSource === 'property' || ao.addressSource === 'customer' || ao.addressSource === 'manual')
      ? ao.addressSource : '';

    /* Ett explicit 'manual'-val är alltid en medveten, egen adress —
       aldrig auto-berikad från fastighet/kund, oavsett om gata/postnr/ort
       redan är kompletta (t.ex. RecurringOrderService.createNextAO() från
       en Återkommande-post i "annan arbetsadress"-läge). */
    if (explicitSource === 'manual') {
      ao.addressOverride = true;
      return;
    }

    const prop = ao.propertyId ? getObj(ao.propertyId) : null;
    const cu   = ao.customerId ? getCu(ao.customerId) : null;
    const aoStreetNorm = this._normalizeStreet(ao.address);
    const streetMatches = (entityAddress) => !!aoStreetNorm && aoStreetNorm === this._normalizeStreet(entityAddress);

    if (ao.address && (ao.zip || ao.city)) { // Fall A — redan komplett
      if (explicitSource === 'property' || explicitSource === 'customer') {
        ao.addressOverride = false;
        return;
      }
      // Inget explicit val — klassificera konservativt via gatumatchning.
      if (prop && streetMatches(prop.address)) { ao.addressSource = 'property'; ao.addressOverride = false; return; }
      if (cu && streetMatches(cu.address))     { ao.addressSource = 'customer'; ao.addressOverride = false; return; }
      ao.addressSource = 'manual'; ao.addressOverride = true;
      return;
    }

    if (!ao.address) {
      if (prop && prop.address) { // Fall B
        ao.address = prop.address; ao.zip = prop.zip || ''; ao.city = prop.city || '';
        ao.addressSource = 'property'; ao.addressOverride = false;
        return;
      }
      if (cu && cu.address) { // Fall C
        ao.address = cu.address; ao.zip = cu.zip || ''; ao.city = cu.city || '';
        ao.addressSource = 'customer'; ao.addressOverride = false;
        return;
      }
      return; // inget att snapshotta
    }

    /* R2.7 §8/§9/§10 (oberoende reproducerad blockerare) — KÄLL-
       klassificering och GEOKOD-tillit är TVÅ SKILDA beslut. Fall D/E
       krävde tidigare att den länkade posten HADE postnr/ort för att ens
       räknas som "matchar fastigheten/kunden" — en fastighet vars
       masterdata bara har en gata (inget postnr/ort ännu) klassade då
       FELAKTIGT en exakt matchande AO-gata som "manual"/särskild, trots
       att det uppenbart är en vanlig standardadress vars geografiska
       kontext bara råkar saknas. Källan avgörs nu ENBART av gatumatchning
       — postnr/ort kopieras separat, EFTERÅT, bara om de faktiskt finns.
       Om de saknas förblir ao.zip/ao.city tomma, vilket redan gör att
       resolveWorkOrderQuery()/geocodeTrusted() korrekt vägrar sätta en
       nål (hasCityContext:false) — men adressen är fortfarande
       property/customer-läge, INTE en påhittad särskild adress. */
    if (prop && streetMatches(prop.address)) { // Fall D — källa=fastighet
      if (prop.zip || prop.city) { ao.zip = prop.zip || ''; ao.city = prop.city || ''; }
      ao.addressSource = 'property'; ao.addressOverride = false;
      return;
    }
    if (cu && streetMatches(cu.address)) { // Fall E — källa=kund
      if (cu.zip || cu.city) { ao.zip = cu.zip || ''; ao.city = cu.city || ''; }
      ao.addressSource = 'customer'; ao.addressOverride = false;
      return;
    }
    // Fall F — bevara gatan, ingen gissad kontext, klassificera som egen/särskild.
    ao.addressSource = 'manual';
    ao.addressOverride = true;
  },

  /* R2.5 §9 — konservativ, bakåtkompatibel parser för det Återkommande-
     modulens HISTORISKA hopslagna adress-strängformat (innan denna
     omgång separerade gata/postnr/ort som egna fält på RecurringOrder).
     Stödjer ENDAST de format RecurringPage faktiskt skrivit historiskt:
       "Gata, 123 45 Ort"   (postnr+ort ihopslaget med mellanslag)
       "Gata, 123 45, Ort"  (postnr och ort som separata kommadelar)
     INGEN aggressiv gissning på godtyckliga strängar. Om formatet inte
     känns igen bevaras HELA den ursprungliga strängen som gata, utan
     postnr/ort — samma "hellre ingen nål än fel stad"-princip (R1 §5)
     gäller lika mycket för legacy recurring-poster som för legacy AO:er. */
  parseLegacyCombinedAddress(str) {
    const s = (str || '').trim();
    if (!s) return { street: '', zip: '', city: '' };
    const parts = s.split(',').map(p => p.trim()).filter(p => p !== '');
    if (!parts.length) return { street: '', zip: '', city: '' };
    const street = parts[0];
    const zipOnlyRe = /^\d{3}\s?\d{2}$/;
    const zipCityRe = /^(\d{3}\s?\d{2})\s+(.+)$/;
    if (parts.length >= 3 && zipOnlyRe.test(parts[1])) {
      // "Gata, 123 45, Ort" — ev. fler kommadelar slås ihop till orten.
      return { street, zip: parts[1], city: parts.slice(2).join(', ') };
    }
    if (parts.length === 2) {
      const m = parts[1].match(zipCityRe);
      if (m) return { street, zip: m[1], city: m[2] }; // "Gata, 123 45 Ort"
      if (zipOnlyRe.test(parts[1])) return { street, zip: parts[1], city: '' };
    }
    return { street: s, zip: '', city: '' }; // okänt format — bevara som bar sträng
  },

  /* ── UI ────────────────────────────────────────────────────── */

  handleInput(inputEl) {
    clearTimeout(this._debounceTimer);
    this._currentInput = inputEl;
    const q = (inputEl.value || '').trim();

    if (!this._token()) {
      console.warn('[AddressService] Token saknas — ange window.VIFT_CONFIG.mapboxToken i config.js');
      this.hideSuggestions();
      return;
    }

    /* Töm relaterade fält när adressfältet töms manuellt */
    if (!q) {
      this._clearRelated(inputEl);
      this.hideSuggestions();
      return;
    }

    this._clearCoords(inputEl);
    if (q.length < 3) { this.hideSuggestions(); return; }

    this._debounceTimer = setTimeout(async () => {
      this._renderDropdown(null);
      const results = await this.search(q);
      this._results = results;
      this._renderDropdown(results);
    }, 300);
  },

  _renderDropdown(results) {
    this.hideSuggestions();
    const inputEl = this._currentInput;
    if (!inputEl) return;

    const el = document.createElement('div');
    el.id = 'addr-dropdown-portal';
    el.className = 'addr-dropdown';

    const rect = inputEl.getBoundingClientRect();
    el.style.cssText = [
      'position:fixed',
      'top:'   + (rect.bottom + 4) + 'px',
      'left:'  + rect.left + 'px',
      'width:' + rect.width + 'px',
      'z-index:9999'
    ].join(';');

    if (results === null) {
      el.innerHTML = '<div class="addr-status">Söker adress…</div>';
    } else if (!results.length) {
      el.innerHTML = '<div class="addr-status">Inga adressförslag hittades</div>';
    } else {
      el.innerHTML = results.map((r, i) => {
        const meta = [r.zip, r.city].filter(Boolean).join(' ');
        return '<div class="addr-item" onmousedown="AddressService.selectSuggestion(' + i + ')">'
          + '<div class="addr-item-street">' + this._esc(r.address || r.label) + '</div>'
          + (meta ? '<div class="addr-item-meta">' + this._esc(meta) + '</div>' : '')
          + '</div>';
      }).join('');
    }

    document.body.appendChild(el);
  },

  selectSuggestion(idx) {
    const r = this._results[idx];
    if (!r) return;
    const inputEl = this._currentInput;
    if (!inputEl) return;

    const ds = inputEl.dataset;
    const hasFields = ds.addrZip || ds.addrCity;

    const set = (id, val) => {
      if (!id) return;
      const el = document.getElementById(id);
      if (!el) return;
      el.value = val != null ? String(val) : '';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };

    if (hasFields) {
      inputEl.value = r.address || '';
      set(ds.addrZip,     r.zip     || '');
      set(ds.addrCity,    r.city    || '');
      set(ds.addrCountry, r.country || 'Sverige');
      set(ds.addrLat,     r.lat != null ? r.lat : '');
      set(ds.addrLng,     r.lng != null ? r.lng : '');
    } else {
      /* Inga separata fält — fyll med fullständig adress */
      inputEl.value = r.address
        ? (r.address + (r.zip || r.city ? ', ' + [r.zip, r.city].filter(Boolean).join(' ') : ''))
        : (r.label || '');
    }

    inputEl.dataset.addrSource = 'mapbox';
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));

    this.hideSuggestions();
    inputEl.focus();
  },

  hideSuggestions() {
    document.getElementById('addr-dropdown-portal')?.remove();
  },

  /* Töm koordinatfält (anropas vid varje tangenttryckning för att invalidera gamla koordinater) */
  _clearCoords(inputEl) {
    if (!inputEl) return;
    const ds = inputEl.dataset;
    [ds.addrLat, ds.addrLng].forEach(id => {
      if (!id) return;
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  },

  /* Töm alla relaterade fält (anropas när adressfältet töms) */
  _clearRelated(inputEl) {
    if (!inputEl) return;
    const ds = inputEl.dataset;
    [ds.addrZip, ds.addrCity, ds.addrCountry, ds.addrLat, ds.addrLng].forEach(id => {
      if (!id) return;
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    delete inputEl.dataset.addrSource;
  },

  _esc(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  },

  /* ── Fas 2: byt mot Lantmäteriet via Supabase Edge Function ─────────────
   *
   * async _fetchLantmateriet(query) {
   *   const res = await fetch('/api/address-search?q=' + encodeURIComponent(query), {
   *     headers: { 'Authorization': 'Bearer ' + Auth.getAccessToken() }
   *   });
   *   if (!res.ok) throw new Error('Edge Function HTTP ' + res.status);
   *   const items = await res.json();
   *   return items.map(r => this._normalizeLantmateriet(r));
   * },
   *
   * _normalizeLantmateriet(r) {
   *   return { label: ..., address: ..., zip: ..., city: ..., country: 'Sverige',
   *            lat: ..., lng: ..., provider: 'lantmateriet' };
   * },
   *
   * Och i search(): byt return await this._fetchMapbox(q)
   *             mot return await this._fetchLantmateriet(q)
   * ─────────────────────────────────────────────────────────────────────── */
};
