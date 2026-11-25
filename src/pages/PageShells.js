/**
 * PageShells — Placeholder-rendering för sidor som byggs i Fas 3+ (v75)
 * Fas 2-sidor (Kunder, AO, Tid, Faktura) har egna filer.
 * v75: gemensamma beräkningsfunktioner _lineExVat/_offRawExVat, offert-totaler-fix (alla 5 platser)
 * v93: send-offer-email — offerToken/sentBy server-side; auto-token+snapshot; rätt länk; ingen mailto-fallback
 * v94: patch state (offerPatch/attachmentPatches/emailEvent) före persist; kundvy via snapshot
 * v95: v4-patch; serverpatchar vid fel; attachment-validering; snapshot-kontroll; email_sent i tidslinje
 * v96: v5-patch; persist endast vid verkliga serverpatchar; korrekt misslyckad e-posthändelse
 * v102: ta bort auto-Att-göra från createAO; status-kontroll hel yta 44px; inga persistActivities-anrop
 * v161 (R2, V94): tog bort legacy mailto-baserad sendReminder()/dess knapp i
 *   _digitalLinkPanel — showReminderModal/_doSendReminder är nu enda
 *   påminnelsevägen; tog bort duplicerad intern "Påminnelse skickad"-post
 *   (serverns emailEvent är auktoritativ); commType skickas till
 *   send-offer-email för att skilja utskick/påminnelse i tidslinjen
 * v162 (R2.1, V95): _doSendEmail/_doSendReminder säkerställer nu tyst en
 *   giltig digital länk (_ensureActiveDigitalLink) innan utskick — ett
 *   färskt utkast utan publicToken kan nu faktiskt skickas; generera-länk
 *   sätter inte längre status=skickad/sentAt (det gjorde tidigare
 *   generateDigitalLink() felaktigt); påminnelse blockeras fail-closed på
 *   återkallad länk och förnyar tyst en förfallen länk innan utskick
 * v163 (R2.2, V96): persist()s bekräftade boolean-retur kontrolleras nu
 *   efter en ny/förnyad digital länk i BÅDE _doSendEmail och
 *   _doSendReminder — om skrivningen misslyckas görs ALDRIG ett
 *   send-offer-email-anrop (ingen chans att servern läser en stale/
 *   ännu-inte-sparad token)
 */

/* ── Offerter (v2 – tjänstemallar + kalkylator) ─────── */

/**
 * _lineExVat(l) — enda gemensam beräkning för en offertrads exklusive moms-belopp.
 *
 * Hanterar ALLA radtyper och datastrukturer:
 *  • service  → l.exVat (förkalkylerat av priskriget)
 *  • manual   → qty * unitPrice
 *  • fixed    → 1 * unitPrice  (ingen qty-fältet)
 *  • äldre rader utan type-fält → qty * unitPrice (fallback till l.total om qty/price saknas)
 *
 * OFFER CORE R1 — l.billingType (NYTT, valfritt fält, se
 * RAPPORT-VIFT-CRM-OFFER-CORE-R1.md §Prismodell för fullständig
 * spårning/motivering):
 *   • 'rate'  → returnerar ALLTID 0 här. Detta är den ENDA
 *     platsen som avgör detta, vilket automatiskt gör att VARJE
 *     anropare av denna funktion (kanonisk OCH de fåtal icke-kanoniska
 *     "l.total"-summerare i CustomersPage.js/ReportsPage.js/PDF-EF:erna,
 *     eftersom sparfunktionen nedan nu SKRIVER l.total = _lineExVat(l))
 *     automatiskt exkluderar rörliga à-priser från VARJE total
 *     — utan att de filerna behöver kännas till det nya fältet alls.
 *   • 'recurring' (återkommande månadsbelopp) → beräknas HÄR precis som
 *     'onetime' (qty*unitPrice, default qty=1) — SJÄLVA beloppet är
 *     alltså inte annorlunda. Det är _offRawExVat() nedan (den
 *     "klassiska" totalsumman) som medvetet EXKLUDERAR 'recurring'-rader
 *     ur sin summa (se där) — annars skulle ett återkommande månadsbelopp
 *     och ett engångsbelopp adderas till en meningslös blandad summa
 *     (kr/mån + kr blandat till ett tal), exakt det uppdraget varnar för.
 *   • Frånvarande billingType (ALL befintlig/legacy-data) = implicit
 *     'onetime' — INGEN ändrad beräkning, INGEN ändrad total, för någon
 *     befintlig offert. Bakåtkompatibilitet är alltså exakt, per
 *     konstruktion, inte en särskild migrering.
 *
 * OFFER CORE R1.1 — BLOCKER 1 (motbevis-granskad): R1 lade till ett
 * FJÄRDE billingType-värde, 'option', som en generisk "tillval"-radtyp
 * på RADNIVÅ. Men VIFT hade REDAN en kanonisk "Tillval / valfria
 * extratjänster"-modell: off.extras[] (se _offRawExVat/_offRawVat
 * nedan). Att ha två parallella, obesläktade "tillval"-koncept
 * (line.billingType='option' OCH off.extras) är exakt den dubblering
 * uppdraget varnar för — TA BORT 'option' som line-nivå-koncept. Det
 * kanoniska tillvalskonceptet är, och förblir, off.extras[] (se
 * e.includedInTotal nedan). 'option' tas bort ur wizardens val-lista
 * (_billingTypeOptionsHtml) så INGA NYA rader kan skapas med det —
 * eftersom denna release aldrig gått live finns ingen sparad
 * produktionsdata med billingType='option' att migrera.
 */
function _lineExVat(l) {
  /* I2 (2026-11-12): ONE authoritative implementation, shared with public-offer.html — src/shared/OfferCalc.js (verbatim move, parity-tested). The body below is only a fallback if that file failed to load. */
  if (typeof OfferCalc !== 'undefined') return OfferCalc.lineExVat(l);
  if (!l || l.type === 'text') return 0;
  if (l.billingType === 'rate') return 0;
  if (l.type === 'service')    return (l.exVat != null ? +l.exVat : 0);
  const qty  = (l.qty != null && l.qty !== '') ? +l.qty : 1;
  const up   = +(l.unitPrice || l.price || 0);
  const comp = Math.round(qty * up);
  /* Fallback: om beräkningen ger 0 men l.total är satt, använd l.total (bakåtkompatibilitet) */
  if (comp === 0 && l.total) return +l.total;
  return comp;
}

/**
 * OFFER CORE R1 — rena hjälpfunktioner för den återkommande
 * (månadsvisa) delen av en offert. Helt ADDITIVA: de läggs INTE ihop
 * med _offRawExVat() (se dess uteslutning av 'recurring' nedan) utan
 * redovisas som en EGEN, tydligt märkt summa (månad + härledd år) i
 * UI/PDF/public-offer — aldrig blandat till en enda vilseledande siffra.
 */
function _offRecurringLines(off) {
  return (off.lines || []).filter(l => l.billingType === 'recurring');
}
function _offRecurringMonthlyExVat(off) {
  /* I2 (2026-11-12): ONE authoritative implementation, shared with public-offer.html — src/shared/OfferCalc.js (verbatim move, parity-tested). The body below is only a fallback if that file failed to load. */
  if (typeof OfferCalc !== 'undefined') return OfferCalc.recurringMonthlyExVat(off);
  return Math.round(_offRecurringLines(off).reduce((s, l) => s + _lineExVat(l), 0));
}
function _offRecurringMonthlyVat(off) {
  /* I2 (2026-11-12): ONE authoritative implementation, shared with public-offer.html — src/shared/OfferCalc.js (verbatim move, parity-tested). The body below is only a fallback if that file failed to load. */
  if (typeof OfferCalc !== 'undefined') return OfferCalc.recurringMonthlyVat(off);
  return Math.round(_offRecurringLines(off).reduce((s, l) => s + Math.round(_lineExVat(l) * _normVat(l.vatRate) / 100), 0));
}
function _offRecurringMonthlyInclVat(off) {
  return _offRecurringMonthlyExVat(off) + _offRecurringMonthlyVat(off);
}
function _offRecurringAnnualExVat(off) {
  return _offRecurringMonthlyExVat(off) * 12;
}
function _offRecurringAnnualInclVat(off) {
  return _offRecurringMonthlyInclVat(off) * 12;
}

/** Rader med en explicit rörlig à-pris-semantik (visas men ingår aldrig i någon total). */
function _offRateAndOptionLines(off) {
  return (off.lines || []).filter(l => l.billingType === 'rate');
}

/**
 * OFFER CORE R1.1 — BLOCKER 1: kanonisk gate för om en off.extras[]-rad
 * ska räknas in i den committade totalsumman. Detta är den ENDA platsen
 * som avgör detta.
 *
 *   • e.includedInTotal === false  → EXPLICIT markerad som "Tillval, ej
 *     i totalsumman" (den etikett print/PDF-vyerna ALLTID visat —
 *     "Tillval (ej inkluderat i totalpriset)" — som R1.1:s oberoende
 *     granskning bevisade var FALSK för alla extras skapade före denna
 *     release, eftersom _offRawExVat/_offRawVat alltid räknat in DEM
 *     ändå). Denna rad exkluderas nu genuint.
 *   • Frånvarande fält (ALL data skapad FÖRE R1.1, dvs. VARJE historisk
 *     extra) = implicit "included" → EXAKT samma beteende/totalsumma
 *     som innan denna release. Ingen historisk offerts kundvisade total
 *     ändras tyst av denna release.
 *   • e.includedInTotal === true (nya extras som användaren INTE
 *     markerar som tillval) → samma "included"-beteende, explicit satt.
 */
function _extraIncludedInTotal(e) {
  /* I2 (2026-11-12): ONE authoritative implementation, shared with public-offer.html — src/shared/OfferCalc.js (verbatim move, parity-tested). The body below is only a fallback if that file failed to load. */
  if (typeof OfferCalc !== 'undefined') return OfferCalc.extraIncludedInTotal(e);
  return e.includedInTotal !== false;
}

/**
 * Summa ex. moms för ett helt offert-objekt (rader + extras) — DEN
 * "KLASSISKA" totalsumman (v75, oförändrad formel/beteende för ALL
 * befintlig data). OFFER CORE R1: exkluderar nu explicit
 * 'recurring'-rader (redovisas separat ovan) — 'rate'-rader
 * exkluderas redan implicit via _lineExVat()===0 men filtreras även
 * bort här för tydlighetens skull. OFFER CORE R1.1: extras filtreras nu
 * genom _extraIncludedInTotal (se ovan) — en offert UTAN några
 * explicit e.includedInTotal===false-extras (dvs. VARJE befintlig
 * offert, eftersom fältet är nytt) får exakt samma summa som innan
 * denna leverans.
 */
function _offRawExVat(off) {
  /* I2 (2026-11-12): ONE authoritative implementation, shared with public-offer.html — src/shared/OfferCalc.js (verbatim move, parity-tested). The body below is only a fallback if that file failed to load. */
  if (typeof OfferCalc !== 'undefined') return OfferCalc.rawExVat(off);
  const prLines = (off.lines  || []).filter(l => l.type !== 'text' && l.billingType !== 'recurring' && l.billingType !== 'rate');
  const extras  = (off.extras  || []).filter(_extraIncludedInTotal);
  const lineSum = prLines.reduce((s, l) => s + _lineExVat(l), 0);
  const extrSum = extras.reduce((s, e) => s + Math.round((+(e.qty||1)) * (+(e.unitPrice||0))), 0);
  return Math.round(lineSum + extrSum);
}

/** Tillval-extras som EJ ingår i totalsumman (visas separat, precis som rate-rader). */
function _offOptionalExtras(off) {
  return (off.extras || []).filter(e => !_extraIncludedInTotal(e));
}

/**
 * OFFER CORE R1.2 — BLOCKER 3: kanonisk, LIVE property-display-etikett
 * för CRM-ytor som HAR tillgång till state.properties (till skillnad
 * från public-offer.html/offer-pdf/offer-public-pdf, som är helt
 * fristående och bara kan läsa offertens egna sparade/snapshottade
 * fält — de fortsätter läsa off.address/s('address') rakt av, vilket
 * nu är korrekt eftersom _save() (se OffersPage._save()) redan
 * härleder off.address från propertyId vid varje sparning).
 *
 * Denna funktion används av CRM-vyer (offertdetalj) för att alltid visa
 * den AKTUELLA fastigheten direkt, utan att behöva vänta på en sparning
 * — t.ex. omedelbart efter att en offert redigerats och fastigheten
 * bytts, innan _save() körts. propertyId är den kanoniska relationen;
 * off.address är ENDAST en bakåtkompatibel fallback för offerter som
 * saknar ett giltigt/upplösningsbart propertyId (historisk data, eller
 * en sedan dess borttagen fastighet).
 */
/**
 * OFFER CORE R1.2 — RUT/ROT rendering hardening (defense in depth,
 * additional to the canonical _offerCalcTotals() fail-safe which already
 * excludes non-onetime lines from rutRotAmount). Several per-line ROW
 * RENDERERS (wizard editor cards, offer detail line list) read
 * `l.rutAmount` directly for their OWN local display (a RUT/ROT badge,
 * a "kundpris efter avdrag" line) — these must not show a reduction
 * badge/discounted price on a recurring/rate line just because
 * malformed or stale imported data happens to carry a leftover
 * rutAmount value. _setLineBillingType() already clears the field the
 * moment a user changes billingType in the UI, but this is the
 * second, independent line of defense at DISPLAY time, so a badge can
 * never appear even for data that reached this state some other way
 * (import, direct API write, an older session's in-memory state).
 */
function _effectiveRutAmount(l) {
  return (l.billingType || 'onetime') === 'onetime' ? (l.rutAmount || 0) : 0;
}

function _offPropertyDisplayText(off) {
  if (off.propertyId && typeof state !== 'undefined' && Array.isArray(state.properties)) {
    const p = state.properties.find(pr => pr.id === off.propertyId);
    if (p) return [p.name, p.address].filter(Boolean).join(' — ') || p.address || p.name || '';
  }
  return off.address || '';
}

/**
 * OFFER CORE R1.3 — BLOCKER 3 (motbevis-granskad): SAVE-TIME-specifik
 * härledning av off.address, MEDVETET separerad från
 * _offPropertyDisplayText() ovan (som är en ren READ/RENDER-hjälpare
 * utan kunskap om "vad användaren just gjorde i formuläret" — att
 * blanda in redigeringsavsikt där hade gjort den hjälparen tvetydig
 * för alla dess andra, rena läs-anrop).
 *
 * R1.2:s _save() föll ALLTID tillbaka på den REDAN SPARADE offertens
 * off.address när wizardData.propertyId var tomt — vilket inte kunde
 * skilja på två helt olika fall:
 *   (A) en genuint gammal offert som ALDRIG haft en fastighet (legacy
 *       fritext-adress ska bevaras), och
 *   (B) en offert som HADE en fastighet, där användaren just NU
 *       explicit valt "— Ingen specifik fastighet —" (adressen måste
 *       rensas, annars visar publika offerten/PDF:erna fortfarande en
 *       fastighet kunden uttryckligen tog bort).
 *
 * Skillnaden avgörs av OM DEN SPARADE OFFERTEN (innan denna sparning)
 * hade ett propertyId eller inte — inte av vad wizardData råkar
 * innehålla just nu:
 *   • wizardData.propertyId satt OCH upplösningsbart → dess
 *     fastighets-display VINNER (oförändrat från R1.2).
 *   • wizardData.propertyId tomt, OCH den tidigare sparade offerten
 *     HADE ett propertyId → adressen NOLLSTÄLLS (NYTT i R1.3 — detta
 *     är den explicita rensningen).
 *   • wizardData.propertyId tomt, OCH den tidigare sparade offerten
 *     ALDRIG hade ett propertyId (eller är en helt ny offert) →
 *     den befintliga fritext-adressen bevaras OFÖRÄNDRAD (legacy-fallet,
 *     identiskt med R1.2:s beteende för denna situation).
 */
function _deriveOfferAddressForSave(wizardData, existingOff) {
  if (wizardData.propertyId) {
    const resolved = _offPropertyDisplayText({ propertyId: wizardData.propertyId, address: '' });
    /* propertyId set but unresolvable (e.g. the property was deleted by
       someone else mid-session) — fall back to the existing address
       rather than blanking a genuinely-selected relation on a fluke. */
    return resolved || (existingOff && existingOff.address) || '';
  }
  const hadPropertyBefore = !!(existingOff && existingOff.propertyId);
  if (hadPropertyBefore) return '';
  return (existingOff && existingOff.address) || '';
}

/**
 * V48B5 R1 (blocker-korrigering av Gate C): kanoniska offert-BLOCK-ID:n.
 * Ersätter den tidigare, ALDRIG livegångna 8-ID-utvecklingsmodellen —
 * den lovade individuell flytt av 8 delar men flera outputytor
 * grupperade/ignorerade dem eller höll pris-blocket fast, så vald
 * ordning var inte sann över CRM/PDF/public. Eftersom V48B5 aldrig
 * committats/deployats finns inget produktionskontrakt att bevara:
 * denna fyra-block-modell är den enda som någonsin gått live.
 *
 * Vart och ett av de fyra blocken MÅSTE fysiskt kunna flyttas till
 * valfri position (1:a/2:a/3:e/4:e) på ALLA fem ytor (CRM-detaljvy,
 * printPdf, public-offer.html, offer-pdf, offer-public-pdf) — se
 * respektive ytas render*Block()-funktioner.
 *
 *   description:      Sammanfattning, Uppdragets omfattning, Ingår, Ingår ej
 *   pricing:           Offertrader, Tillval, delsumma/rabatt/moms/ROT-RUT/kundpris
 *   commercialTerms:  Betalningsvillkor, Giltighetstid
 *   generalTerms:      Allmänna villkor
 *
 * internalNote ingår ALDRIG (kundsynligt/interna fält blandas inte).
 * Bilagor ligger alltid fast EFTER offertinnehållet i denna release.
 */
const OFFER_SECTION_IDS = ['description', 'pricing', 'commercialTerms', 'generalTerms'];
const DEFAULT_OFFER_SECTION_ORDER = OFFER_SECTION_IDS.slice();

/**
 * Validerar/normaliserar en sparad sektionsordning: okända ID:n
 * kasseras (inkl. hela den gamla 8-ID-modellen — ingen migrering
 * behövs, se motivering ovan), dubbletter kasseras (första
 * förekomsten vinner), ID:n som saknas läggs till sist i
 * standardordning. Ogiltig/tom/icke-array-indata -> hela
 * standardordningen. En BEFINTLIG produktionsoffert (som aldrig haft
 * off.sectionOrder, eftersom B5 aldrig gått live) faller alltså
 * korrekt tillbaka på standardordningen.
 */
function _resolveSectionOrder(order) {
  if (!Array.isArray(order) || !order.length) return DEFAULT_OFFER_SECTION_ORDER.slice();
  const seen = {};
  const out = [];
  order.forEach(id => {
    if (typeof id === 'string' && OFFER_SECTION_IDS.indexOf(id) !== -1 && !seen[id]) {
      seen[id] = true;
      out.push(id);
    }
  });
  DEFAULT_OFFER_SECTION_ORDER.forEach(id => { if (!seen[id]) { seen[id] = true; out.push(id); } });
  return out;
}

/**
 * V38 §1/§4: kanonisk 0-safe momsnormalisering — samma semantik som
 * InvoiceService.normalizeVatRate (V35-V37). null/undefined/tomsträng
 * (inkl. whitespace-only) = inget värde satt -> fallback (25); explicit
 * numeriskt 0 eller '0' = 0 % (behålls exakt); giltigt 0-100 behålls
 * exakt; NaN/Infinity/negativt/>100 = ogiltigt -> fallback. Duplicerad
 * här (istället för att InvoicesPage/PageShells beror på InvoiceService)
 * eftersom offertflödet historiskt inte har något beroende på
 * InvoiceService, och vi inte ska koppla ihop de två modulerna i denna
 * smala VAT-hardening-omgång.
 */
function _normVat(value, fallback) {
  /* I2 (2026-11-12): ONE authoritative implementation, shared with public-offer.html — src/shared/OfferCalc.js (verbatim move, parity-tested). The body below is only a fallback if that file failed to load. */
  if (typeof OfferCalc !== 'undefined') return OfferCalc.normVat(value, fallback);
  if (fallback === undefined) fallback = 25;
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string' && value.trim() === '') return fallback;
  const n = Number(value);
  if (!isFinite(n) || n < 0 || n > 100) return fallback;
  return n;
}

/**
 * V48B5 R3 §10-12: gemensam parser/formatterare för penningfält som
 * bytt från <input type="number"> (aldrig grupperad visning i någon
 * webbläsare) till text-inputs med Svensk tusentalsgruppering vid
 * blur. Det INTERNA/sparade värdet är ALLTID ett rått numeriskt tal —
 * ALDRIG en formaterad sträng. Parsern tar bort mellanslag/NBSP
 * (tusentalsavskiljare, inkl. inklistrad NBSP) och tolkar svensk
 * decimalkomma. Formaterarens utdata används ENDAST för visning
 * (onblur) — aldrig sparat/skickat till någon beräkning.
 */
function _parseMoneyInput(v) {
  if (v === null || v === undefined) return 0;
  const cleaned = String(v).replace(/[\s ]/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : 0;
}
function _formatMoneyInput(n) {
  return Number(n || 0).toLocaleString('sv-SE');
}

/**
 * V39 §2: STRIKT write-validering för moms — medvetet SKILD från
 * _normVat()'s read/display-fallback-semantik. _normVat() är rätt för
 * att VISA/RÄKNA på redan lagrad data (ett odefinierat/ogiltigt värde
 * ska visas som om det vore 25 % snarare än att krascha). Men den får
 * ALDRIG användas för att avgöra vad som får SPARAS — annars kan ett
 * felaktigt värde (t.ex. 500, eller en trasig DOM-manipulation) tystas
 * till ett falskt giltigt 25 % i själva lagringen. Saknat/tomt värde
 * räknas HÄR som ogiltigt (ingen fallback vid skrivning) — används av
 * ArticlesPage._save() och ServiceTemplatesPage._save(), båda ställen
 * där fältet alltid förväntas ha ett värde vid sparning.
 */
function _strictVat(value) {
  if (value === null || value === undefined) return { ok: false, error: 'Momssats saknas.' };
  if (typeof value === 'string' && value.trim() === '') return { ok: false, error: 'Momssats saknas.' };
  const n = Number(value);
  if (!isFinite(n) || n < 0 || n > 100) return { ok: false, error: 'Ogiltig momssats.' };
  return { ok: true, value: n };
}

/**
 * V38 §4: summa moms (kr) för offertens rader+extras INNAN rabatt — varje
 * rad/tillägg använder sin EGEN vatRate (0-safe via _normVat), inte ett
 * hårdkodat 25 %. Textblock ger ingen moms (_lineExVat returnerar redan 0
 * för dem).
 * OFFER CORE R1: 'recurring'/'rate'-rader exkluderas HÄR av
 * samma skäl som i _offRawExVat() ovan — momsen på den klassiska
 * totalsumman ska inte inkludera ett rörligt à-pris (som inte är ett
 * köpt fast belopp) eller ett återkommande månadsbelopp (som redovisas
 * med sin EGEN moms i _offRecurringMonthlyVat()).
 */
function _offRawVat(off) {
  /* I2 (2026-11-12): ONE authoritative implementation, shared with public-offer.html — src/shared/OfferCalc.js (verbatim move, parity-tested). The body below is only a fallback if that file failed to load. */
  if (typeof OfferCalc !== 'undefined') return OfferCalc.rawVat(off);
  const prLines = (off.lines || []).filter(l => l.type !== 'text' && l.billingType !== 'recurring' && l.billingType !== 'rate');
  const extras  = (off.extras || []).filter(_extraIncludedInTotal);
  const lineVat  = prLines.reduce((s, l) => s + Math.round(_lineExVat(l) * _normVat(l.vatRate) / 100), 0);
  const extraVat = extras.reduce((s, e) => {
    const exVat = Math.round((+(e.qty||1)) * (+(e.unitPrice||0)));
    return s + Math.round(exVat * _normVat(e.vatRate) / 100);
  }, 0);
  return lineVat + extraVat;
}

/**
 * V38 §4: rabattbelopp — samma formel som tidigare fanns dupplicerad på
 * flera separata ställen (offertlista, wizard, detaljvy, print). Ingen
 * ändring av rabattens affärsregler, bara EN plats för formeln.
 */
function _offDiscountAmount(off, rawExVat) {
  /* I2 (2026-11-12): ONE authoritative implementation, shared with public-offer.html — src/shared/OfferCalc.js (verbatim move, parity-tested). The body below is only a fallback if that file failed to load. */
  if (typeof OfferCalc !== 'undefined') return OfferCalc.discountAmount(off, rawExVat);
  const d = off.discount || { type: 'none', value: 0 };
  if (!d.value) return 0;
  if (d.type === 'percent') return Math.round(rawExVat * Math.min(d.value, 100) / 100);
  return Math.min(Math.round(d.value), rawExVat);
}

/**
 * V38 §4: KANONISK offertekonomi — den enda platsen som räknar ut en
 * offerts ekonomiska totaler. Används av offertlistan, wizardens
 * sammanfattning, offertdetalj, kalkyl/preview och print/PDF-HTML.
 * (public-offer.html samt Edge Functions offer-pdf/offer-public-pdf kan
 * inte dela JS-kod med frontend-bundeln, men implementerar samma formel
 * — se V38-leveransrapporten.)
 *
 * Momsen räknas per rad/tillägg (dess egna vatRate, 0-safe), och
 * rabattens momseffekt fördelas PROPORTIONELLT mot fördelningen FÖRE
 * rabatt — exakt samma metod som redan används för fakturor i
 * InvoiceService.calcSummary (V35) — istället för ett generellt * 0.25
 * på den rabatterade ex-moms-summan (vilket antog att HELA offerten
 * alltid hade 25 % moms).
 *
 * RUT/ROT-beloppet är HELT OFÖRÄNDRAT (samma summering av l.rutAmount på
 * service-rader som redan användes) — bara momsdelen är fixad.
 */
function _offerCalcTotals(off) {
  /* I2 (2026-11-12): ONE authoritative implementation, shared with public-offer.html — src/shared/OfferCalc.js (verbatim move, parity-tested). The body below is only a fallback if that file failed to load. */
  if (typeof OfferCalc !== 'undefined') return OfferCalc.totals(off);
  const rawExVat = _offRawExVat(off);
  const rawVat   = _offRawVat(off);
  const discountAmount = _offDiscountAmount(off, rawExVat);
  const exVatAfterDiscount = rawExVat - discountAmount;
  const ratio = rawExVat > 0 ? (exVatAfterDiscount / rawExVat) : 1;
  const vatAmount = Math.round(rawVat * ratio);
  const totalInclVat = exVatAfterDiscount + vatAmount;
  /* OFFER CORE R1.1 — BLOCKER 5 (motbevis-granskad): RUT/ROT hör
     ENDAST till committad engångsprissättning. totalInclVat ovan
     innehåller redan ENDAST 'onetime'-rader (recurring/rate exkluderas
     i _offRawExVat/_offRawVat) — men rutRotAmount summerade tidigare
     l.rutAmount FRÅN ALLA icke-textrader, oavsett billingType. Om en
     rad bytte billingType till 'recurring'/'rate' med ett kvarvarande
     (nu inaktuellt) rutAmount-fält, blev customerPays = totalInclVat
     (som INTE innehöll radens belopp) MINUS rutRotAmount (som
     FELAKTIGT ÄNDÅ innehöll radens avdrag) — ett garanterat negativt,
     finansiellt absurt kundpris. Filtret nedan är ett "fail-safe" i
     SJÄLVA beräkningen (inte bara i UI:t som rensar fälten vid byte,
     se _setLineBillingType) — en kvarvarande/inaktuell rutAmount på en
     icke-onetime-rad kan ALDRIG längre påverka customerPays. */
  const rutRotAmount = Math.round((off.lines||[]).filter(l => l.type !== 'text' && (l.billingType||'onetime') === 'onetime').reduce((s,l) => s + (l.rutAmount||0), 0));
  const customerPays = totalInclVat - rutRotAmount;
  /* OFFER CORE R1 — additiva fält, aldrig blandade in i ovanstående
     klassiska totalsumma (se _offRawExVat). recurringMonthly*=0 för
     VARJE befintlig offert (inga 'recurring'-rader kan finnas i redan
     sparad data), så dessa fält är helt ofarliga att alltid inkludera
     i returvärdet — konsumenter som inte känner till dem ignorerar dem
     bara. */
  const recurringMonthlyExVat   = _offRecurringMonthlyExVat(off);
  const recurringMonthlyVat     = _offRecurringMonthlyVat(off);
  const recurringMonthlyInclVat = _offRecurringMonthlyInclVat(off);
  const recurringAnnualExVat    = recurringMonthlyExVat * 12;
  const recurringAnnualInclVat  = recurringMonthlyInclVat * 12;
  return {
    rawExVat, discountAmount, exVatAfterDiscount, vatAmount, totalInclVat, rutRotAmount, customerPays,
    recurringMonthlyExVat, recurringMonthlyVat, recurringMonthlyInclVat, recurringAnnualExVat, recurringAnnualInclVat
  };
}

/**
 * QA 2026-11-26 (offerter): moms uppdelad per momssats — ENDAST presentation.
 * Ingen ny ekonomiregel: underlaget är exakt OfferCalc:s egen per-rad-moms
 * (round(lineExVat × sats) per engångsrad/committat tillval, samma urval som
 * OfferCalc.rawVat) grupperad per sats och skalad med samma rabattkvot som
 * OfferCalc.totals(). Avrundningsresten fördelas (största rest) så att
 * summan av raderna ALLTID är exakt totals.vatAmount — aldrig en egen total.
 * Returnerar [{ rate, vat }] sorterat på sats (högst först); tom lista när
 * offerten saknar engångsbelopp.
 */
function _offVatBreakdown(off) {
  const t = _offerCalcTotals(off);
  const nv = (v) => (typeof OfferCalc !== 'undefined' ? OfferCalc.normVat(v) : _normVat(v));
  const exOf = (e) => (typeof OfferCalc !== 'undefined' ? OfferCalc.extraExVat(e) : Math.round((+(e.qty || 1)) * (+(e.unitPrice || 0))));
  const raw = {};
  (off.lines || []).filter(l => l.type !== 'text' && l.billingType !== 'recurring' && l.billingType !== 'rate').forEach(l => {
    const ex = _lineExVat(l); if (!ex) return;
    const r = nv(l.vatRate); raw[r] = (raw[r] || 0) + Math.round(ex * r / 100);
  });
  (off.extras || []).filter(_extraIncludedInTotal).forEach(e => {
    const ex = exOf(e); if (!ex) return;
    const r = nv(e.vatRate); raw[r] = (raw[r] || 0) + Math.round(ex * r / 100);
  });
  const rates = Object.keys(raw).map(Number).sort((a, b) => b - a);
  if (!rates.length) return [];
  const ratio = t.rawExVat > 0 ? (t.exVatAfterDiscount / t.rawExVat) : 1;
  const rows = rates.map(r => { const exact = raw[r] * ratio; return { rate: r, vat: Math.floor(exact), frac: exact - Math.floor(exact) }; });
  let rest = t.vatAmount - rows.reduce((s, x) => s + x.vat, 0);
  const order = rows.slice().sort((a, b) => b.frac - a.frac);
  for (let i = 0; rest > 0 && order.length; i = (i + 1) % order.length) { order[i].vat += 1; rest--; }
  for (let i = 0; rest < 0 && order.length; i = (i + 1) % order.length) { order[i].vat -= 1; rest++; }
  return rows.map(x => ({ rate: x.rate, vat: x.vat }));
}

/* QA 2026-11-26 (offerter): procentformat för momssatser ("25 %", "12,5 %"). */
function _offPct(r) { return String(r).replace('.', ',') + ' %'; }

/* QA 2026-11-26 (offerter): id som får ligga i en inline-händelse ('…').
   Endast [A-Za-z0-9_-] släpps igenom — annars tom sträng (inget anrop
   med data som kan bryta sig ut ur JS-strängen). */
function _offSafeId(v) { const s = String(v == null ? '' : v); return /^[A-Za-z0-9_-]+$/.test(s) ? s : ''; }

/**
 * OFFER CORE R1.1 — BLOCKER 2 (motbevis-granskad): kanonisk, KONCIS
 * primär-prisetikett för en offert, använd av VARJE kompakt/sammanfattande
 * yta (offertlistans kort, wizardens mobila sticky-totalrad, detaljvyns
 * hero/mobil-snabbinfo). R1 uppdaterade bara wizardens desktop-totalkort
 * (_totalsBarHtml) med den återkommande summeringen — en offert som
 * ENDAST har 'recurring'-rader (t.ex. Södra Heden) visade därför
 * fortfarande "0 kr" på alla andra ytor, eftersom de bara läste
 * _tot.totalInclVat (=0 för en sådan offert). Denna funktion är den ENDA
 * platsen som avgör vilket belopp som visas som "offertens primära
 * pris" — ingen yta ska längre läsa totalInclVat/customerPays direkt
 * för sitt huvudbelopp.
 *
 *   • Endast återkommande (klassisk bucket = 0): "8 000 kr/mån ex moms"
 *     — ALDRIG "0 kr". Kontraktsvärdet visas EX MOMS som primärt (se
 *     BLOCKER 6) — en momsberäknad "10 000 kr/mån" ersätter ALDRIG detta.
 *   • Blandad (både recurring och engångsbelopp): båda hinkarna syns
 *     tydligt separerade, ALDRIG summerade ihop till ett tal.
 *   • Endast engångsbelopp (VARJE befintlig offert idag): EXAKT samma
 *     beteende/text som innan R1.1 — inkl.-moms-belopp, med RUT/ROT-
 *     kundpris när tillämpligt.
 */
function _offPrimaryDisplay(off) {
  const t = _offerCalcTotals(off);
  const hasRecurring = t.recurringMonthlyExVat > 0;
  const hasOneTime   = t.rawExVat > 0;
  if (hasRecurring && hasOneTime) {
    /* OFFER CORE R1.2 — BLOCKER 2 (motbevis-granskad): den återgivna
       engångshinken måste vara den KANONISKA, RABATTERADE summan
       (t.exVatAfterDiscount), inte t.rawExVat (före rabatt). R1.1
       läste rawExVat direkt här, vilket för en offert med t.ex. 10 %
       rabatt på engångsbeloppet visade "12 000 kr engångs" trots att
       det verkliga, committade ex-moms-beloppet (efter rabatt) var
       10 800 kr — en tyst, missvisande siffra. Den befintliga
       rabatt-regeln (endast på engångshinken, ingen ny "återkommande
       rabatt"-motor) är oförändrad — bara VILKET tal som visas här
       är fixat. */
    const oneTimeLabel = t.discountAmount > 0 ? 'kr engångs ex moms efter rabatt' : 'kr engångs';
    return {
      compact: `${fmt(t.recurringMonthlyExVat)} kr/mån + ${fmt(t.exVatAfterDiscount)} ${oneTimeLabel}`,
      primary: `${fmt(t.recurringMonthlyExVat)} kr/mån`,
      secondary: `+ ${fmt(t.exVatAfterDiscount)} ${oneTimeLabel}`,
      isRecurring: true
    };
  }
  if (hasRecurring) {
    return {
      compact: `${fmt(t.recurringMonthlyExVat)} kr/mån ex moms`,
      primary: `${fmt(t.recurringMonthlyExVat)} kr/mån`,
      secondary: `${fmt(t.recurringAnnualExVat)} kr/år ex moms (härledd)`,
      isRecurring: true
    };
  }
  const val = t.rutRotAmount ? t.customerPays : t.totalInclVat;
  const lbl = t.rutRotAmount ? 'kund inkl. moms' : 'inkl. moms';
  /* OFFER CORE R1.3 — BLOCKER 2 (motbevis-granskad): a rate-only or
     optional-only offer has NO recurring component (hasRecurring=false)
     AND NO committed one-time amount (hasOneTime=false, since
     rawExVat===0 — rate lines are always 0-valued and an
     includedInTotal:false extra never enters rawExVat). The branch
     below previously fell straight through to totalInclVat (=0),
     showing the exact same misleading "0 kr" a recurring-only offer
     showed before R1.1 — there IS visible commercial pricing (a rate
     card, an optional extra), it's just none of it is a COMMITTED
     total. Never fabricate a fake total here — show a non-monetary
     commercial-representation label instead. */
  if (!hasRecurring && !hasOneTime) {
    const rateLines = _offRateAndOptionLines(off);
    const optExtras = _offOptionalExtras(off);
    const commercialCount = rateLines.length + optExtras.length;
    if (commercialCount > 0) {
      let secondary;
      if (commercialCount === 1) {
        const item = rateLines[0] || optExtras[0];
        const unit = (item.unit || '').trim();
        secondary = `${fmt(item.unitPrice || 0)} kr${unit ? '/' + unit : ''} ex moms`;
      } else {
        secondary = `${commercialCount} rörliga priser / tillval`;
      }
      return { compact: 'Rörliga priser', primary: 'Rörliga priser', secondary, isRecurring: false, hasNoCommittedTotal: true };
    }
  }
  return { compact: `${fmt(val)} kr ${lbl}`, primary: `${fmt(val)} kr`, secondary: lbl, isRecurring: false };
}

/**
 * OFFER CORE R1.3 — BLOCKER 2 (motbevis-granskad): kanonisk
 * konverterings-beslutshjälpare, ETT ställe som avgör OM en offert får
 * konverteras till en fastprisarbetsorder OCH VARFÖR inte (för korrekt
 * felmeddelande) — undviker att duplicera skälslogik i flera knappar/
 * modaler. R1.2 blockerade ENDAST recurring>0, vilket missade en
 * likvärdig finansiell bugg: en offert med ENDAST rate-rader (t.ex.
 * "440 kr/h", inget annat) eller ENDAST en exkluderad (includedInTotal:
 * false) tillval-extra har _offRawExVat===0 OCH
 * _offRecurringMonthlyExVat===0 — R1.2:s guard (`recurring > 0`)
 * släppte igenom en fixedPrice=0-arbetsorder ändå, exakt samma
 * finansiella bugg-klass som recurring-fallet.
 *   • recurring-komponent (ren eller blandad) → blockerad (R1.2,
 *     oförändrat skäl/beteende).
 *   • INGEN recurring OCH inget committat engångsbelopp (rawExVat<=0)
 *     → blockerad (NY R1.3-regel) — täcker rate-only, optional-only,
 *     och en helt tom offert. En offert med ett riktigt engångsbelopp
 *     (t.ex. 5000 kr + en extra rate-rad på 440/h) förblir OFÖRÄNDRAT
 *     tillåten — rawExVat är redan korrekt 5000 (rate-raden bidrar 0),
 *     så den blockeras INTE av denna nya regel. */
/**
 * OFFER CORE R1.5 — FINAL BLOCKER (motbevis-granskad, traced first): en
 * SEPARAT, ren LIVSCYKEL-beslutshjälpare för offert->AO-konvertering —
 * medvetet HÅLLEN ISÄR från den finansiella _offAOConversionDecision()
 * ovan/nedan, så att den funktionens semantik ("har offerten ett giltigt
 * committat pris att konvertera?") inte grumlas av frågan "FÅR den här
 * offerten överhuvudtaget konverteras just nu, oavsett pris?". De två
 * frågorna är ortogonala och båda måste svara ja.
 *
 * TRACE PERFORMED: `createAO()` körde tidigare ALDRIG någon egen kontroll
 * av `status`/`archived`/`deleted` alls — bara den finansiella
 * _offAOConversionDecision() och (efter att ha byggt hela AO-payloaden!)
 * ett dubbelkonverteringsskydd för `workOrderId`. Det gjorde att en
 * offert med status='godkänd' MEN archived=true (en fullt normal,
 * nåbar datakombination — arkivering ändrar aldrig status) fortfarande
 * kunde konverteras via ett direkt anrop, trots att den sekundära
 * knappraden REDAN korrekt villkorade sig på `!off.archived&&!off.deleted`
 * — en bevisad, redan existerande inkonsekvens mellan ytorna (se
 * motbevis). Denna funktion är nu den ENDA platsen som avgör
 * livscykel-behörigheten, använd av VARJE yta (hero-CTA, sekundär knapp,
 * säljassistent-tipset) OCH som en load-bearing kontroll INUTI
 * createAO() självt, INNAN den finansiella kontrollen körs (fail fast)
 * och INNAN någon AO-payload byggs.
 */
function _offAOCreateLifecycleDecision(off) {
  if (!off) return { allowed: false, reason: 'not-found' };
  if (off.archived) return { allowed: false, reason: 'archived' };
  if (off.deleted) return { allowed: false, reason: 'deleted' };
  if (off.status !== 'godkänd') return { allowed: false, reason: 'not-approved' };
  if (off.workOrderId) return { allowed: false, reason: 'already-converted' };
  return { allowed: true, reason: null };
}

function _offAOConversionDecision(off) {
  if (_offRecurringMonthlyExVat(off) > 0) return { allowed: false, reason: 'recurring' };
  /* OFFER CORE R1.4 — BLOCKER 1 (motbevis-granskad, traced first): the
     committed one-time amount that matters for AO eligibility/fixedPrice
     is the CANONICAL POST-DISCOUNT figure (_offerCalcTotals(off).
     exVatAfterDiscount), not the pre-discount _offRawExVat(off). R1.3's
     check here used rawExVat<=0, which correctly caught the rate-only/
     optional-only case (rawExVat IS 0 there) but would have WRONGLY
     allowed a 100%-discounted one-time offer through (rawExVat>0, but
     the actual committed amount is 0) — which would have produced a
     fixedPrice=0 fixed-price AO. TRACE PERFORMED: WorkOrderDetailPage's
     own manual price-editing UI (`if (!(fixedPrice > 0)) { showToast(
     'Ange ett fastpris större än 0 kr.'); return; }`) proves VIFT does
     NOT support a zero-price fixed-price AO anywhere in the existing
     product — so per the brief, this fails closed rather than
     inventing new zero-price semantics. A distinct reason
     ('discounted-to-zero') is returned when the offer DID have a raw
     one-time amount that a 100% (or otherwise total) discount reduced
     to zero, vs. 'no-committed-onetime' when there was never any
     one-time pricing at all (rate-only/optional-only) — so createAO()'s
     modal can explain the ACTUAL reason instead of a generic message. */
  const committedOneTime = _offerCalcTotals(off).exVatAfterDiscount;
  if (committedOneTime <= 0) {
    return { allowed: false, reason: _offRawExVat(off) > 0 ? 'discounted-to-zero' : 'no-committed-onetime' };
  }
  /* I2 (blocker round 2026-11-12, Lucas: fail closed): a fixed-price AO
     carries ONE ex-VAT amount that billing later charges at a single
     invoice-line VAT rate. An offer whose committed one-time lines/extras
     have MORE THAN ONE VAT rate cannot be represented that way (live:
     offer 6 040 kr incl. VAT -> invoice 6 375 kr). Until a per-line-VAT
     conversion exists, that one case is refused here — before any AO
     payload is built — and by every button that reads this decision. A
     uniform 25 % offer converts exactly as before (a uniform non-25 %
     offer is now refused too, see I2 VAT-FIX below). Not a status gate,
     not a price-change rule: only the automatic VAT-incorrect conversion. */
  /* I2 VAT-FIX (2026-11-12, independent review): the fixed-price billing
     candidate built from the AO (BillingQueueService, sourceType 'fixed')
     is ALWAYS a single line at vatRate 25. So the automatic conversion is
     only correct when the offer's committed one-time total is uniformly
     25 %. Everything else fails closed here: mixed rates ('mixed-vat',
     message unchanged), a single non-25 rate such as 12 % / 6 % / 0 %
     ('non-25-vat', message names the actual rate), and an undeterminable
     rate set ('vat-unknown'). Reverse charge does not exist in the offer
     data model today (no field anywhere), so there is nothing further to
     detect. This gates ONLY the automatic offer->AO conversion: manual AO
     creation, invoicing of ongoing AOs and price changes are untouched. */
  if (typeof OfferCalc === 'undefined') return { allowed: false, reason: 'vat-unknown' };
  const vatRates = OfferCalc.vatRatesInTotal(off);
  if (vatRates.length > 1) {
    return { allowed: false, reason: 'mixed-vat' };
  }
  if (vatRates.length !== 1) return { allowed: false, reason: 'vat-unknown' };
  if (vatRates[0] !== 25) return { allowed: false, reason: 'non-25-vat', vatRate: vatRates[0] };
  return { allowed: true, reason: null };
}

/* OFFER CORE R1.4 — BLOCKER 2: service-checklistmallar, flyttade hit
   (oförändrat innehåll) från OfferDetailPage.createAO() så den rena
   payload-byggaren nedan inte behöver DOM/service-koppling för att
   återanvända dem — samma konstant används av båda. */
const AO_SERVICE_CHECKLISTS = {
  'svc_altan': ['Kontrollera altanens skick före start', 'Flytta lösa föremål vid behov', 'Tvätta ytan enligt metod', 'Kontrollera resultat efter tvätt'],
  'svc_sten':  ['Kontrollera stenyta före start', 'Rensa smuts och ogräs', 'Tvätta stenläggning', 'Kontrollera fogar och efterbehandling'],
  'svc_hack':  ['Kontrollera höjd och sidor enligt offert', 'Klipp enligt specifikation', 'Samla upp och bortforsla avklipp', 'Slutkontrollera ytan'],
  'svc_fasad': ['Skydda fönster och detaljer', 'Tvätta fasad uppifrån och ner', 'Kontrollera att smuts är borta', 'Ta bort skydd och städa av'],
  'svc_fs':    ['Kontrollera objektets skick vid ankomst', 'Utför service enligt uppdrag', 'Dokumentera utfört arbete', 'Meddela kund vid avvikelse'],
  'svc_tf':    ['Kontrollera tekniska installationer', 'Utför förvaltningsuppgifter', 'Dokumentera status', 'Rapportera till kund'],
  'svc_ovr':   ['Kontrollera arbetsplats vid ankomst', 'Utför beskrivet arbete', 'Städa upp efter arbete', 'Rapportera utfört arbete']
};

/**
 * OFFER CORE R1.4 — BLOCKER 1/2 (motbevis-granskad): kanonisk, REN
 * offert->AO-konverteringspayload-byggare. Tar EMOT ENDAST `off` — ingen
 * DOM, inget WorkOrderService-anrop, inget `state.currentUser`/
 * `Date.now()`-beroende — så den kan testas direkt, och
 * `OfferDetailPage.createAO()` nedan använder DENNA SAMMA funktion
 * (ingen parallell, duplicerad algoritm) för de ekonomi-/innehålls-
 * beroende fälten.
 *
 *   • fixedPrice = _offerCalcTotals(off).exVatAfterDiscount — den
 *     KANONISKA, RABATTERADE engångssumman (BLOCKER 1). Innehåller
 *     redan committade extras (via _offRawExVat/_extraIncludedInTotal)
 *     men ALDRIG recurring/rate-rader eller RUT/ROT (RUT/ROT är en
 *     betalnings-/subventionsuppdelning, inte en sänkning av det
 *     underliggande tjänstevärdet — subtraheras medvetet INTE här).
 *   • title/description/checklist/estimatedHours byggs ENDAST från
 *     "committedLines" — icke-textrader vars billingType är 'onetime'
 *     (frånvarande fält = implicit onetime, oförändrat) — OCH
 *     committade extras (BLOCKER 2). En 'rate'/'recurring'-rad beskriver
 *     ett FRAMTIDA pris OM mer arbete beställs — den är inte köpt arbete
 *     bara för att offerten godkändes, och får därför ALDRIG bidra till
 *     AO:ns titel/beskrivning/checklista/estimerade timmar. En explicit
 *     EJ-committad (includedInTotal:false) tillval-extra behandlas
 *     likadant — den är synlig på offerten men inte köpt arbete.
 */
function _buildAOConversionPayload(off) {
  const allLines = off.lines || [];
  const prLines = allLines.filter(l => l.type !== 'text');
  const committedLines = prLines.filter(l => (l.billingType || 'onetime') === 'onetime');
  const svcLines = committedLines.filter(l => l.type === 'service');
  const svcNames = svcLines.map(l => l.templateName).filter(Boolean);
  const committedExtras = (off.extras || []).filter(_extraIncludedInTotal);

  const title = off.title
    || (svcNames.length ? svcNames.join(', ') : 'Arbete enligt offert ' + off.id);

  const descParts = [];
  if (off.scope)                                descParts.push(off.scope);
  if (off.summary && off.summary !== off.scope) descParts.push(off.summary);
  if (off.includes)                             descParts.push('Ingår: ' + off.includes);
  if (off.excludes)                             descParts.push('Ingår ej: ' + off.excludes);
  if (!descParts.length && committedLines.length) descParts.push(committedLines.map(l => l.templateName||l.description).filter(Boolean).join(', '));
  const description = descParts.join('\n\n');

  const checklist = [];
  let cIdx = 0;
  svcLines.forEach(l => {
    const tmplChecklist = AO_SERVICE_CHECKLISTS[l.templateId || l.priceRuleRef];
    const items = tmplChecklist || (l.templateName || l.description ? [l.templateName || l.description] : []);
    items.forEach(text => { checklist.push({ id: 'c' + (cIdx++), text, done: false }); });
  });
  /* Icke-service, icke-text COMMITTADE rader ger en enskild checklista-post. */
  committedLines.filter(l => l.type !== 'service').forEach(l => {
    if (l.description) checklist.push({ id: 'c' + (cIdx++), text: l.description, done: false });
  });
  /* BLOCKER 2 (committad Tillval): en committad extra representerar
     köpt arbete precis lika mycket som en committad manuell rad — den
     får inte tyst försvinna ur AO:ns arbetsomfattning bara för att den
     bor i off.extras[] istället för off.lines[]. En EJ-committad
     (includedInTotal:false) extra är redan filtrerad bort ovan. */
  committedExtras.forEach(e => {
    if (e.description) checklist.push({ id: 'c' + (cIdx++), text: e.description, done: false });
  });

  /* estimatedHours — ENDAST från committade rader/extras med enhet
     tim/h. En rate-rads timpris ("440 kr/h") beskriver vad YTTERLIGARE
     arbete skulle kosta OM det beställs — dess qty är inte förbrukad
     tid bara för att offerten godkändes. */
  let estimatedHours = 0;
  committedLines.forEach(l => {
    if ((l.unit === 'tim' || l.unit === 'h') && l.qty) estimatedHours += parseFloat(l.qty) || 0;
    (l.subLines||[]).forEach(sl => {
      if ((sl.unit === 'tim' || sl.unit === 'h') && sl.qty) estimatedHours += parseFloat(sl.qty) || 0;
    });
  });
  committedExtras.forEach(e => {
    if ((e.unit === 'tim' || e.unit === 'h') && e.qty) estimatedHours += parseFloat(e.qty) || 0;
  });

  const fixedPrice = _offerCalcTotals(off).exVatAfterDiscount;

  return { title, description, checklist, estimatedHours, fixedPrice };
}

/**
 * OFFER CORE R1.4 — BLOCKER 4 (motbevis-granskad): kanonisk CTA-text för
 * ett blockerat AO-konverteringsläge, härledd från SAMMA
 * _offAOConversionDecision(off).reason som modalen i createAO() redan
 * använder — INGEN egen skäls-logik duplicerad i knapplagret. R1.3
 * hårdkodade "Återkommande — kan ej konvertera" för VARJE blockerat
 * skäl, vilket blev sakligt fel så fort R1.4:s nya
 * 'no-committed-onetime'/'discounted-to-zero'-skäl kunde inträffa (en
 * ren rate-only- eller optional-only-offert har ALDRIG varit
 * "återkommande"). Används av båda de blockerade AO-knapparna (hero-CTA
 * och den sekundära "Skapa AO"-knappen) så de alltid är i synk.
 */
function _offAOBlockedCtaText(reason, vatRate) {
  if (reason === 'recurring') {
    return { label: 'Återkommande — kan ej konvertera', title: 'Återkommande offerter kan inte konverteras till en fastprisarbetsorder ännu' };
  }
  if (reason === 'discounted-to-zero') {
    return { label: 'Rabatterad till 0 kr — kan ej konvertera', title: 'Rabatten reducerar det committade engångsbeloppet till 0 kr' };
  }
  if (reason === 'mixed-vat') {
    return { label: 'Blandad moms — kan ej konvertera', title: 'Offerten har blandade momssatser som inte kan representeras korrekt som ett fastprisarbete' };
  }
  if (reason === 'non-25-vat') {
    const r = (vatRate === undefined || vatRate === null) ? '' : vatRate + ' %';
    return { label: 'Moms ' + r + ' — kan ej konvertera', title: 'Offertens moms (' + r + ') kan inte föras över korrekt till arbetsordern, som endast stödjer 25 %' };
  }
  if (reason === 'vat-unknown') {
    return { label: 'Moms okänd — kan ej konvertera', title: 'Offertens momssats kunde inte fastställas' };
  }
  return { label: 'Kan ej konvertera till AO', title: 'Offerten saknar ett committat engångsbelopp att konvertera' };
}

/* ── PART 1: OfferPriceRules — alla priser EXKLUSIVE MOMS ─── */
const OfferPriceRules = {
  altan: {
    tiers: [
      {max:30,  pricePerM2:95},
      {max:60,  pricePerM2:85},
      {max:100, pricePerM2:75},
      {max:150, pricePerM2:70},
      {max:Infinity, pricePerM2:65}
    ],
    minCharge: 1500,
    addons: {
      algae:     {label:'Algbehandling',        price:15,  unit:'m²'},
      stairs:    {label:'Trappsteg tillägg',    price:450, unit:'st'},
      treatment: {label:'Impregnering/efterbehandling', price:18, unit:'m²'},
      disposal:  {label:'Bortforsling',         price:750, unit:'st'}
    },
    vatRate: 25,
    rutApplicable: true,
    rutRate: 0.5
  },
  sten: {
    tiers: [
      {max:30,  pricePerM2:85},
      {max:60,  pricePerM2:72},
      {max:100, pricePerM2:62},
      {max:150, pricePerM2:55},
      {max:Infinity, pricePerM2:48}
    ],
    minCharge: 1500,
    addons: {
      weeds:        {label:'Ogräs- och algbehandling', price:12, unit:'m²'},
      jointing:     {label:'Fogsandning',              price:25, unit:'m²'},
      impregnation: {label:'Impregnering',             price:22, unit:'m²'},
      disposal:     {label:'Bortforsling',             price:600, unit:'st'}
    },
    vatRate: 25,
    rotApplicable: true,
    rotRate: 0.3
  },
  hack: {
    basePricePerLm: 55,
    heightFactors: {'≤ 1 m':1.0,'1–2 m':1.35,'2–3 m':1.75,'> 3 m':2.2},
    sideFactors:   {'1 sida':1.0,'2 sidor':1.8,'3 sidor':2.5},
    diffFactors:   {'Normal':1.0,'Svår (tät/gammal)':1.3},
    minCharge: 1200,
    addons: {
      disposal: {label:'Bortforsling klippt material', price:650, unit:'st'}
    },
    vatRate: 25,
    rutApplicable: true,
    rutRate: 0.5
  },
  fasad: {
    basePricePerM2: 60,
    floorFactors: {'1 vån':1.0,'2 vån':1.25,'3 vån':1.55,'4+ vån':1.85},
    minCharge: 2000,
    addons: {
      algae:    {label:'Algbehandling',       price:15,   unit:'m²'},
      softwash: {label:'Softwash-behandling', price:18,   unit:'m²'},
      lift:     {label:'Lift / ställning',    price:4500, unit:'st'},
      disposal: {label:'Bortforsling',        price:600,  unit:'st'}
    },
    vatRate: 25,
    rotApplicable: true,
    rotRate: 0.3
  }
};

/* ── PART 2: Helper functions ─── */
function _offTierPrice(area, tiers) {
  for (let i = 0; i < tiers.length; i++) {
    if (area <= tiers[i].max) return tiers[i].pricePerM2;
  }
  return tiers[tiers.length - 1].pricePerM2;
}

function _offTierLabel(area, tiers) {
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    const prev = i === 0 ? 0 : tiers[i-1].max;
    if (area <= t.max) {
      const fromLbl = prev === 0 ? '0' : (prev + 1);
      const toLbl   = t.max === Infinity ? '∞' : t.max;
      return fromLbl + '–' + toLbl + ' m²: ' + t.pricePerM2 + ' kr/m²';
    }
  }
  return '';
}


/* ── PART 3: OffersPage (v4 – steg-wizard + tjänstoverlay) ─── */
const OffersPage = {
  _editLines:    [],
  _editExtras:   [],
  _editSectionOrder: null,
  _sectionDragIdx: null,
  _lineDragIdx: null,
  _editOfferId:  null,
  _wizardStep:   1,
  _wizardData:   {},
  _activeSvcId:  null,
  _svcFields:    {},
  _svcEditIdx:   null,
  _svcReduction: 'ingen',   // 'ingen' | 'rut' | 'rot' — unified state, injected into calc
  _filter:       'alla',
  _search:       '',

  /* ── Tjänstemallar ─── */
  _T: [
    {
      id:'altan', name:'Altantvätt', icon:'refresh-cw', vatRate:25, defaultReduction:'rut',
      defaultDesc:'Altantvätt inkl. rengöring, avfettning och behandling.',
      fields:[
        {id:'area',      label:'Yta (m²)',       type:'number', req:true},
        {id:'material',  label:'Material/typ',   type:'chips',  opts:['Trä / Komposit','Betong','Natursten','Tegel','Annat'], def:'Trä / Komposit'},
        {id:'dirt',      label:'Smutsnivå',      type:'chips',  opts:['Lätt','Måttlig','Kraftig'], def:'Måttlig'},
        {id:'algae',     label:'Algbehandling',  type:'bool',   addLabel:'Algbehandling (+15 kr/m²)'},
        {id:'stairs',    label:'Trappsteg',      type:'bool',   addLabel:'Trappsteg (+450 kr/st)'},
        {id:'treatment', label:'Efterbehandling',type:'bool',   addLabel:'Impregnering (+18 kr/m²)'},
        {id:'disposal',  label:'Bortforsling',   type:'bool',   addLabel:'Bortforsling (+750 kr)'},
        {id:'rut',       label:'RUT-avdrag 50 %',type:'bool',   isRut:true},
      ],
      calc(f){
        const rules = OfferPriceRules.altan;
        const a = parseFloat(f.area) || 0;
        const pricePerM2 = _offTierPrice(a, rules.tiers);
        const tierLbl    = _offTierLabel(a, rules.tiers);
        let base = a * pricePerM2;
        if (a > 0 && base < rules.minCharge) base = rules.minCharge;
        const ls = [{desc:'Altantvätt ' + a + ' m² (' + (f.dirt||'Måttlig') + ')', qty:a, unit:'m²', price:pricePerM2}];
        if (a > 0 && a * pricePerM2 < rules.minCharge) {
          ls[0] = {desc:'Altantvätt ' + a + ' m² (minimidebitering)', qty:1, unit:'st', price:rules.minCharge};
        }
        if (f.algae)     ls.push({desc:rules.addons.algae.label,     qty:a, unit:'m²', price:rules.addons.algae.price});
        if (f.stairs)    ls.push({desc:rules.addons.stairs.label,    qty:1, unit:'st', price:rules.addons.stairs.price});
        if (f.treatment) ls.push({desc:rules.addons.treatment.label, qty:a, unit:'m²', price:rules.addons.treatment.price});
        if (f.disposal)  ls.push({desc:rules.addons.disposal.label,  qty:1, unit:'st', price:rules.addons.disposal.price});
        const exVat = Math.round(ls.reduce((s,l)=>s+l.qty*l.price,0));
        const totalIncVat = exVat + Math.round(exVat * rules.vatRate / 100);
        const rutAmt = f.rut ? Math.round(totalIncVat * rules.rutRate) : 0;
        return {ls, exVat, rutAmt, tierLbl, pricePerM2, inputValues:{...f}, priceRuleRef:'altan'};
      }
    },
    {
      id:'sten', name:'Stentvätt', icon:'layers', vatRate:25, defaultReduction:'rot',
      defaultDesc:'Högtryckstvätt av stenläggning, plattor och markytor.',
      fields:[
        {id:'area',         label:'Yta (m²)',    type:'number', req:true},
        {id:'material',     label:'Stentyp',     type:'chips',  opts:['Betongplattor','Natursten','Klinker','Asfalt','Annat'], def:'Betongplattor'},
        {id:'dirt',         label:'Smutsnivå',   type:'chips',  opts:['Lätt','Måttlig','Kraftig'], def:'Måttlig'},
        {id:'weeds',        label:'Ogräs/alger', type:'bool',   addLabel:'Ogräs- och algbehandling (+12 kr/m²)'},
        {id:'jointing',     label:'Fogsandning', type:'bool',   addLabel:'Fogsandning (+25 kr/m²)'},
        {id:'impregnation', label:'Impregnering',type:'bool',   addLabel:'Impregnering (+22 kr/m²)'},
        {id:'disposal',     label:'Bortforsling',type:'bool',   addLabel:'Bortforsling (+600 kr)'},
        {id:'rot',          label:'ROT-avdrag 30 %', type:'bool', isRot:true},
      ],
      calc(f){
        const rules = OfferPriceRules.sten;
        const a = parseFloat(f.area) || 0;
        const pricePerM2 = _offTierPrice(a, rules.tiers);
        const tierLbl    = _offTierLabel(a, rules.tiers);
        let base = a * pricePerM2;
        const ls = [{desc:'Stentvätt ' + a + ' m² (' + (f.dirt||'Måttlig') + ')', qty:a, unit:'m²', price:pricePerM2}];
        if (a > 0 && base < rules.minCharge) {
          ls[0] = {desc:'Stentvätt ' + a + ' m² (minimidebitering)', qty:1, unit:'st', price:rules.minCharge};
        }
        if (f.weeds)        ls.push({desc:rules.addons.weeds.label,       qty:a, unit:'m²', price:rules.addons.weeds.price});
        if (f.jointing)     ls.push({desc:rules.addons.jointing.label,    qty:a, unit:'m²', price:rules.addons.jointing.price});
        if (f.impregnation) ls.push({desc:rules.addons.impregnation.label,qty:a, unit:'m²', price:rules.addons.impregnation.price});
        if (f.disposal)     ls.push({desc:rules.addons.disposal.label,    qty:1, unit:'st', price:rules.addons.disposal.price});
        const exVat = Math.round(ls.reduce((s,l)=>s+l.qty*l.price,0));
        const totalIncVat = exVat + Math.round(exVat * rules.vatRate / 100);
        const rutAmt = f.rot ? Math.round(totalIncVat * rules.rotRate) : 0;
        return {ls, exVat, rutAmt, tierLbl, pricePerM2, inputValues:{...f}, priceRuleRef:'sten'};
      }
    },
    {
      id:'hack', name:'Häckklippning', icon:'scissors', vatRate:25, defaultReduction:'rut',
      defaultDesc:'Klippning av häck inkl. uppsamling av klippt material.',
      fields:[
        {id:'length',     label:'Löpmeter häck',   type:'number', req:true},
        {id:'height',     label:'Höjd',            type:'chips',  opts:['≤ 1 m','1–2 m','2–3 m','> 3 m'], def:'1–2 m'},
        {id:'sides',      label:'Antal sidor',     type:'chips',  opts:['1 sida','2 sidor','3 sidor'], def:'2 sidor'},
        {id:'difficulty', label:'Svårighet',       type:'chips',  opts:['Normal','Svår (tät/gammal)'], def:'Normal'},
        {id:'disposal',   label:'Bortforsling',    type:'bool',   addLabel:'Bortforsling (+650 kr)'},
        {id:'rut',        label:'RUT-avdrag 50 %', type:'bool',   isRut:true},
      ],
      calc(f){
        const rules = OfferPriceRules.hack;
        const lm  = parseFloat(f.length) || 0;
        const hf  = rules.heightFactors[f.height||'1–2 m'] || 1.35;
        const sf  = rules.sideFactors[f.sides||'2 sidor']  || 1.8;
        const df  = rules.diffFactors[f.difficulty||'Normal'] || 1.0;
        const prLm = Math.round(rules.basePricePerLm * hf * sf * df);
        let base = lm * prLm;
        const ls = [{desc:'Häckklippning ' + lm + ' lm (' + (f.height||'1–2 m') + ', ' + (f.sides||'2 sidor') + (f.difficulty&&f.difficulty!=='Normal'?', Svår':'') + ')', qty:lm, unit:'lm', price:prLm}];
        if (lm > 0 && base < rules.minCharge) {
          ls[0] = {desc:'Häckklippning ' + lm + ' lm (minimidebitering)', qty:1, unit:'st', price:rules.minCharge};
        }
        if (f.disposal) ls.push({desc:rules.addons.disposal.label, qty:1, unit:'st', price:rules.addons.disposal.price});
        const exVat = Math.round(ls.reduce((s,l)=>s+l.qty*l.price,0));
        const totalIncVat = exVat + Math.round(exVat * rules.vatRate / 100);
        const rutAmt = f.rut ? Math.round(totalIncVat * rules.rutRate) : 0;
        const tierLbl = lm + ' lm × ' + prLm + ' kr/lm';
        return {ls, exVat, rutAmt, tierLbl, pricePerM2:prLm, inputValues:{...f}, priceRuleRef:'hack'};
      }
    },
    {
      id:'fasad', name:'Fasadtvätt', icon:'building-2', vatRate:25, defaultReduction:'rot',
      defaultDesc:'Fasadtvätt inkl. förberedelse, tvätt och skyddsåtgärder.',
      fields:[
        {id:'area',     label:'Fasadyta (m²)',  type:'number', req:true},
        {id:'floors',   label:'Antal våningar', type:'chips',  opts:['1 vån','2 vån','3 vån','4+ vån'], def:'2 vån'},
        {id:'material', label:'Fasadmaterial',  type:'chips',  opts:['Puts / Betong','Tegel','Träpanel','Plåt','Annat'], def:'Puts / Betong'},
        {id:'algae',    label:'Algbehandling',  type:'bool',   addLabel:'Algbehandling (+15 kr/m²)'},
        {id:'softwash', label:'Softwash',       type:'bool',   addLabel:'Softwash-behandling (+18 kr/m²)'},
        {id:'lift',     label:'Lift/ställning', type:'bool',   addLabel:'Lift / ställning (+4 500 kr)'},
        {id:'disposal', label:'Bortforsling',   type:'bool',   addLabel:'Bortforsling (+600 kr)'},
        {id:'rot',      label:'ROT-avdrag 30 %',type:'bool',   isRot:true},
      ],
      calc(f){
        const rules = OfferPriceRules.fasad;
        const a  = parseFloat(f.area) || 0;
        const ff = rules.floorFactors[f.floors||'2 vån'] || 1.25;
        const pricePerM2 = Math.round(rules.basePricePerM2 * ff);
        let base = a * pricePerM2;
        const ls = [{desc:'Fasadtvätt ' + a + ' m² (' + (f.floors||'2 vån') + ')', qty:a, unit:'m²', price:pricePerM2}];
        if (a > 0 && base < rules.minCharge) {
          ls[0] = {desc:'Fasadtvätt ' + a + ' m² (minimidebitering)', qty:1, unit:'st', price:rules.minCharge};
        }
        if (f.algae)    ls.push({desc:rules.addons.algae.label,    qty:a, unit:'m²', price:rules.addons.algae.price});
        if (f.softwash) ls.push({desc:rules.addons.softwash.label, qty:a, unit:'m²', price:rules.addons.softwash.price});
        if (f.lift)     ls.push({desc:rules.addons.lift.label,     qty:1, unit:'st', price:rules.addons.lift.price});
        if (f.disposal) ls.push({desc:rules.addons.disposal.label, qty:1, unit:'st', price:rules.addons.disposal.price});
        const exVat = Math.round(ls.reduce((s,l)=>s+l.qty*l.price,0));
        const totalIncVat = exVat + Math.round(exVat * rules.vatRate / 100);
        const rutAmt = f.rot ? Math.round(totalIncVat * rules.rotRate) : 0;
        const tierLbl = (f.floors||'2 vån') + ': ' + pricePerM2 + ' kr/m²';
        return {ls, exVat, rutAmt, tierLbl, pricePerM2, inputValues:{...f}, priceRuleRef:'fasad'};
      }
    },
    {
      id:'fs', name:'Fastighetsservice', icon:'wrench', vatRate:25,
      defaultDesc:'Fastighetsservice och skötsel enligt överenskommelse.',
      fields:[
        {id:'type',     label:'Avtalstyp',              type:'chips',  opts:['Månadsavtal','Kvartal','Engångsuppdrag'], def:'Engångsuppdrag'},
        {id:'hours',    label:'Timmar per period',      type:'number', req:true},
        {id:'periods',  label:'Antal perioder',         type:'number', def:1},
        {id:'rate',     label:'Timpris ex moms (kr/h)', type:'number', def:695},
        {id:'material', label:'Material (kr)',          type:'number'},
        {id:'rot',      label:'ROT-avdrag 30 %',        type:'bool',   isRot:true},
      ],
      calc(f){
        const hrs  = parseFloat(f.hours)    || 0;
        const per  = parseInt(f.periods)    || 1;
        const rate = parseFloat(f.rate)     || 695;
        const type = f.type                 || 'Engångsuppdrag';
        const mat  = parseFloat(f.material) || 0;
        const ls = [{desc:'Fastighetsservice – ' + type + (per>1?' × '+per+' ggr':'') + ' (' + hrs + ' tim/period)', qty:hrs*per, unit:'tim', price:rate}];
        if (mat) ls.push({desc:'Material och förbrukningsmaterial', qty:1, unit:'st', price:mat});
        const exVat = Math.round(ls.reduce((s,l)=>s+l.qty*l.price,0));
        /* V38: respektera denna kalkylregels EGEN vatRate (satt på samma
           objekt, id:'fs' ovan) — this.vatRate, inte ett hårdkodat 0.25.
           calc() anropas alltid som tmpl.calc(f), så this === kalkylregeln. */
        const totalIncVat = exVat + Math.round(exVat * this.vatRate / 100);
        const rutAmt = f.rut ? Math.round(totalIncVat * 0.5) : f.rot ? Math.round(totalIncVat * 0.3) : 0;
        return {ls, exVat, rutAmt, tierLbl:'', pricePerM2:rate, inputValues:{...f}, priceRuleRef:'fs'};
      }
    },
    {
      id:'tf', name:'Teknisk förvaltning', icon:'settings', vatRate:25,
      defaultDesc:'Teknisk förvaltning av fastighet enligt förvaltningsavtal.',
      fields:[
        {id:'months',  label:'Antal månader',         type:'number', req:true, def:12},
        {id:'monthly', label:'Månadsavgift ex moms',  type:'number', req:true},
        {id:'setup',   label:'Uppstartskostnad (kr)',  type:'number'},
        {id:'ovk',     label:'OVK-besiktning ingår',  type:'bool',   addLabel:'OVK inkl. protokoll (+3 500 kr)'},
      ],
      calc(f){
        const months  = parseInt(f.months)         || 12;
        const monthly = parseFloat(f.monthly)      || 0;
        const setup   = parseFloat(f.setup)        || 0;
        const ls = [{desc:'Teknisk förvaltning (' + months + ' månader)', qty:months, unit:'mån', price:monthly}];
        if (setup) ls.push({desc:'Uppstart och fastighetsgenomgång', qty:1, unit:'st', price:setup});
        if (f.ovk)  ls.push({desc:'OVK-besiktning inkl. protokoll',  qty:1, unit:'st', price:3500});
        const exVat = Math.round(ls.reduce((s,l)=>s+l.qty*l.price,0));
        return {ls, exVat, rutAmt:0, tierLbl:'', pricePerM2:monthly, inputValues:{...f}, priceRuleRef:'tf'};
      }
    },
    {
      id:'ovr', name:'Övrigt arbete', icon:'activity', vatRate:25,
      defaultDesc:'Arbete på löpande räkning.',
      fields:[
        {id:'desc_svc', label:'Benämning',                type:'text',   req:true},
        {id:'qty',      label:'Antal timmar',             type:'number', req:true},
        {id:'rate',     label:'Timpris ex moms (kr/h)',   type:'number', def:695},
        {id:'material', label:'Material (kr)',            type:'number'},
        {id:'rut',      label:'RUT-avdrag 50 %',          type:'bool',   isRut:true},
        {id:'rot',      label:'ROT-avdrag 30 %',          type:'bool',   isRot:true},
      ],
      calc(f){
        const rate = parseFloat(f.rate)     || 695;
        const qty  = parseFloat(f.qty)      || 0;
        const mat  = parseFloat(f.material) || 0;
        const ls   = [{desc:f.desc_svc||'Arbete', qty, unit:'tim', price:rate}];
        if (mat) ls.push({desc:'Material', qty:1, unit:'st', price:mat});
        const exVat = Math.round(ls.reduce((s,l)=>s+l.qty*l.price,0));
        /* V38: this.vatRate — samma resonemang som fs-regeln ovan. */
        const totalIncVat = exVat + Math.round(exVat * this.vatRate / 100);
        const rutAmt = f.rut ? Math.round(totalIncVat * 0.5) : f.rot ? Math.round(totalIncVat * 0.3) : 0;
        return {ls, exVat, rutAmt, tierLbl:'', pricePerM2:rate, inputValues:{...f}, priceRuleRef:'ovr'};
      }
    },
  ],

  _getT() {
    if ((state.serviceTemplates||[]).length > 0) {
      return ServiceTemplateService.buildAllWizardTemplates();
    }
    return this._T;
  },

  _TERMS: {
    payment:  '30 dagar netto',
    validity: '30 dagar',
    general:  'Priser anges exklusive moms om inget annat anges. Eventuella tillkommande arbeten debiteras enligt löpande räkning efter godkännande. VIFT reserverar sig för dolda fel och förutsättningar som ej kunnat bedömas vid offerttillfället.'
  },

  /* ── Offertlista ─── */
  /* V48B1 §1/§2: KPI-beloppen bygger ALLTID på den kanoniska ekonomimotorn
     (_offerCalcTotals) — se _kpiOfferValue() nedan. Ingen duplicerad
     ekonomiberäkning i denna funktion. */
  _KPI_PAGAENDE_STATUSES:  ['skickad', 'påmind', 'väntar', 'ändring-begärd'],
  _KPI_OFFERERAT_STATUSES: ['skickad', 'påmind', 'väntar', 'ändring-begärd', 'godkänd', 'nekad', 'utgången'],

  /* Presentationshelper — returnerar ENDAST det kanoniska ex-moms-värdet
     efter rabatt. Duplicerar ingen logik: delegerar rakt av till
     _offerCalcTotals(), som förblir den enda platsen som räknar. */
  _kpiOfferValue(o) {
    return _offerCalcTotals(o).exVatAfterDiscount;
  },

  render() {
    const el = document.getElementById('pg-offer-content');
    if (!el) return;
    const all = (state.offers || []).slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    /* V48B1 §2: huvud-KPI:erna representerar AKTIVA offerter (samma
       exkluderingsprincip som _getKpi() redan följer för flik-räknarna).
       `all` (obeskuret) används fortfarande oförändrat av
       list-/arkiv-/papperskorgsflödena längre ned. */
    const active = all.filter(o => !o.deleted && !o.archived);
    const kUtkast   = {n: 0, v: 0};
    const kPagaende = {n: 0, v: 0};
    const kGodkand  = {n: 0, v: 0};
    const kTotalt   = {n: 0, v: 0};
    active.forEach(o => {
      const val = OffersPage._kpiOfferValue(o);
      if (o.status === 'utkast') { kUtkast.n++; kUtkast.v += val; }
      if (OffersPage._KPI_PAGAENDE_STATUSES.includes(o.status))  { kPagaende.n++; kPagaende.v += val; }
      if (o.status === 'godkänd') { kGodkand.n++; kGodkand.v += val; }
      if (OffersPage._KPI_OFFERERAT_STATUSES.includes(o.status)) { kTotalt.n++; kTotalt.v += val; }
    });

    const kpiCard = (lbl, k, variantCls) =>
      `<div class="off-kpi-card${variantCls?' '+variantCls:''}">
         <div class="off-kpi-lbl">${lbl}</div>
         <div class="off-kpi-val">${fmt(k.v)} kr</div>
         <div class="off-kpi-meta"><span class="off-kpi-count">${k.n} st</span><span class="off-kpi-unit">exkl. moms</span></div>
       </div>`;

    // Render static shell (KPI + toolbar + tabs container + results container).
    // The search input is part of the shell and is NOT re-rendered on keystroke.
    el.innerHTML =
      `<div class="off-kpi-row">
         ${kpiCard('Utkast', kUtkast)}
         ${kpiCard('Pågående', kPagaende)}
         ${kpiCard('Godkända', kGodkand, 'off-kpi-card--green')}
         ${kpiCard('Totalt offererat', kTotalt, 'off-kpi-card--navy')}
       </div>
       <div style="display:flex;gap:7px;align-items:center;margin-bottom:6px;">
         <div class="swrap" style="flex:1;">
           <span class="sico">${ic('search',16)}</span>
           <input id="off-search-input" type="search" placeholder="Sök offert, kund, titel eller ID…"
             value="${(this._search||'').replace(/"/g,'&quot;')}"
             oninput="OffersPage._onSearchInput(this)">
           ${this._search ? `<button class="off-clr-btn" onclick="OffersPage._clearSearch()" title="Rensa sökning">${ic('x',13)}</button>` : ''}
         </div>
         <button class="btn bp bsm" onclick="OffersPage.openCreate()">${ic('plus',14)} Ny offert</button>
       </div>
       <div class="off-tabs-wrap">
         <div id="off-tabs-row" class="ftabs off-tabs-desktop"></div>
         <div class="off-tabs-mobile-wrap">
           <label class="off-tabs-mobile-label" for="off-tabs-mobile">Status</label>
           <select id="off-tabs-mobile" class="off-tabs-mobile-select" onchange="OffersPage._setFilter(this.value)"></select>
         </div>
       </div>
       <div id="off-results"></div>`;

    this._renderTabRow();
    this._renderResults();
  },

  _getKpi() {
    const kpi = {utkast:0, skickad:0, godkänd:0, nekad:0, total:0};
    (state.offers||[]).forEach(o => {
      if (o.deleted || o.archived) return;
      if (kpi[o.status] !== undefined) kpi[o.status]++;
      kpi.total++;
    });
    return kpi;
  },

  /* V48B1 §4: EN sanningskälla för "Behöver åtgärd" — anropas identiskt
     från både _renderTabRow() (badge-räkning) och _renderResults()
     (faktisk filtrering), så de aldrig kan divergera. Exakt samma
     affärsdefinition som tidigare, bara konsoliderad till en plats. */
  _offerNeedsAction(o, now) {
    if (o.deleted || o.archived) return false;
    if (o.status === 'ändring-begärd') return true;
    if (o.status === 'godkänd' && !o.workOrderId) return true;
    const tokenActive = o.publicToken && !o.tokenRevokedAt && !(o.tokenExpiresAt && new Date(o.tokenExpiresAt).getTime() < now);
    if (tokenActive && !o.openCount && o.sentAt && (now - new Date(o.sentAt).getTime()) > 2 * 86400000) return true;
    if (o.tokenExpiresAt && !o.tokenRevokedAt && new Date(o.tokenExpiresAt).getTime() > now && (new Date(o.tokenExpiresAt).getTime() - now) < 3 * 86400000) return true;
    return false;
  },

  _renderTabRow(kpi) {
    const elDesktop = document.getElementById('off-tabs-row');
    const elMobile  = document.getElementById('off-tabs-mobile');
    if (!elDesktop && !elMobile) return;
    const c = kpi || this._getKpi();
    const f = this._filter || 'alla';
    const kpiPamind   = (state.offers||[]).filter(o=>!o.deleted&&!o.archived&&o.status==='påmind').length;
    const kpiArkiv    = (state.offers||[]).filter(o=>o.archived&&!o.deleted).length;
    const kpiPapperskorg = (state.offers||[]).filter(o=>o.deleted).length;
    const now7d = Date.now();
    const kpiAtgard = (state.offers||[]).filter(o => OffersPage._offerNeedsAction(o, now7d)).length;
    const tabs = [
      {v:'alla',         l:'Alla',                   n:c.total},
      {v:'utkast',       l:'Utkast',                 n:c.utkast},
      {v:'skickad',      l:'Skickade',               n:c.skickad},
      {v:'atgard',       l:'Behöver åtgärd',         n:kpiAtgard, urgent: kpiAtgard > 0},
      {v:'påmind',       l:'Påminda',                n:kpiPamind},
      {v:'godkänd',      l:'Godkända',               n:c.godkänd},
      {v:'nekad',        l:'Nekade',                 n:c.nekad},
      {v:'arkiverade',   l:'Arkiverade',             n:kpiArkiv},
      {v:'papperskorg',  l:'Papperskorg',            n:kpiPapperskorg},
    ];
    if (elDesktop) {
      elDesktop.innerHTML = tabs.map(t =>
        `<button class="ft ${f===t.v?'on':''}" onclick="OffersPage._setFilter('${t.v}')" style="${t.urgent?'color:var(--or);':''}">${t.l}${t.n?` <span style="background:${t.urgent?'var(--or)':'rgba(0,0,0,.10)'};${t.urgent?'color:#fff;':''}border-radius:9px;padding:0 5px;font-size:9px;">${t.n}</span>`:''}</button>`
      ).join('');
    }
    if (elMobile) {
      /* V48B1 §7: samma `tabs`-array som desktop-flikarna, samma
         OffersPage._filter-state, samma _setFilter()-anrop — mobilselect
         är enbart en annan PRESENTATION av exakt samma filterlogik. */
      elMobile.innerHTML = tabs.map(t =>
        `<option value="${t.v}"${f===t.v?' selected':''}>${t.l}${t.n?` (${t.n})`:''}</option>`
      ).join('');
    }
  },

  _setFilter(v) {
    this._filter = v;
    this._renderTabRow();
    this._renderResults();
  },

  _onSearchInput(inputEl) {
    this._search = inputEl.value;
    // Toggle clear button without touching the input element
    const wrap = inputEl.parentElement;
    let btn = wrap.querySelector('.off-clr-btn');
    if (this._search && !btn) {
      btn = document.createElement('button');
      btn.className = 'off-clr-btn';
      btn.title = 'Rensa sökning';
      btn.setAttribute('onclick', 'OffersPage._clearSearch()');
      btn.innerHTML = ic('x', 13);
      wrap.appendChild(btn);
    } else if (!this._search && btn) {
      btn.remove();
    }
    this._renderResults();
  },

  _clearSearch() {
    this._search = '';
    const inp = document.getElementById('off-search-input');
    if (inp) { inp.value = ''; inp.focus(); }
    const btn = document.querySelector('.off-clr-btn');
    if (btn) btn.remove();
    this._renderResults();
  },

  _renderResults() {
    const el = document.getElementById('off-results');
    if (!el) return;
    const all = (state.offers || []).slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const filterTab = this._filter || 'alla';
    const q = (this._search || '').toLowerCase().trim();

    let offers = all;
    if (filterTab === 'papperskorg') {
      offers = offers.filter(o => o.deleted);
    } else if (filterTab === 'arkiverade') {
      offers = offers.filter(o => o.archived && !o.deleted);
    } else if (filterTab === 'alla') {
      offers = offers.filter(o => !o.archived && !o.deleted);
    } else if (filterTab === 'atgard') {
      const nowA = Date.now();
      offers = offers.filter(o => OffersPage._offerNeedsAction(o, nowA));
    } else {
      offers = offers.filter(o => !o.archived && !o.deleted && o.status === filterTab);
    }
    if (q) offers = offers.filter(o => {
      const cu = getCu(o.customerId);
      const cuName = cu ? CustomerService.displayName(cu).toLowerCase() : '';
      return o.id.toLowerCase().includes(q)
        || (o.title||'').toLowerCase().includes(q)
        || cuName.includes(q)
        || (o.summary||'').toLowerCase().includes(q)
        || (o.status||'').toLowerCase().includes(q);
    });

    if (offers.length === 0) {
      const noBase = filterTab==='alla' && !q;
      const clearBtn = q ? `<button class="btn bs bsm" style="margin-top:10px;" onclick="OffersPage._clearSearch()">Rensa sökning</button>` : '';
      el.innerHTML = `<div class="empty">${ic('file-text',36)}
        <h3>${noBase?'Inga offerter':'Inga träffar'}</h3>
        <p>${noBase?'Klicka "Ny offert" för att komma igång':q?'Inga offerter matchar din sökning.':'Inga offerter i detta filter.'}</p>
        ${noBase?`<button class="btn bp bsm" onclick="OffersPage.openCreate()" style="margin-top:8px;">${ic('plus',12)} Ny offert</button>`:clearBtn}
      </div>`;
      return;
    }

    el.innerHTML = offers.map(o => {
      const cu      = getCu(o.customerId);
      const cuName  = cu ? CustomerService.displayName(cu) : '—';
      const disp    = o.title || o.id;
      const prLines = (o.lines||[]).filter(l=>l.type!=='text');
      const extras  = o.extras||[];
      const _tot    = _offerCalcTotals(o);
      const priceDisp = _offPrimaryDisplay(o);
      const insight = OffersPage._offerInsight(o);
      /* V48B1 §5: ingen egen JS-statusfärgkarta — kortets accent härleds
         från samma kanoniska statusClass()/sbdg() som statusbadgen ovan i
         kortet, via en data-attribut-baserad CSS-mappning (components.css). */
      const accentClass = statusClass(o.status);
      // Nästa aktivitet
      const nextActLine = (() => {
        const acts = (state.activities||[]).filter(a => a.relatedType==='offer' && a.relatedId===o.id && a.status==='open');
        if (!acts.length) {
          if (o.status==='skickad'||o.status==='påmind') {
            return `<span style="font-size:10px;color:var(--or);">${ic('bell',9)} Ingen uppföljning bokad</span>`;
          }
          return '';
        }
        const sorted = acts.slice().sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||''));
        const next = sorted[0];
        const isOverdue = next.dueDate && next.dueDate < tdy();
        const dateStr = next.dueDate ? new Date(next.dueDate+'T12:00:00').toLocaleDateString('sv-SE',{day:'numeric',month:'short'}) : '—';
        return isOverdue
          ? `<span style="font-size:10px;color:var(--rd);font-weight:700;">${ic('alert-circle',9)} Uppföljning försenad: ${dateStr}</span>`
          : `<span style="font-size:10px;color:var(--gr);">${ic('calendar-check',9)} Uppföljning: ${dateStr}</span>`;
      })();
      /* QA 2026-11-26: titeln (fritext) escapas — tidigare lagrad XSS i offertlistan. */
      return `<div class="list-item off-offer-card" data-status-accent="${accentClass}" onclick="Router.showPage('pg-offer-detail',{offerId:'${_offSafeId(o.id)}'})">
  <div class="off-offer-card-top">
    <div style="display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;">
      <span class="off-offer-card-id">${esc(o.id)}</span>
      ${sbdg(o.status)}
    </div>
    <div style="display:flex;align-items:baseline;gap:5px;flex-shrink:0;margin-left:8px;">
      <strong style="font-size:13px;color:var(--navy);">${priceDisp.primary}</strong>
      <span style="font-size:11px;color:var(--mt);">${priceDisp.secondary}</span>
    </div>
  </div>
  <div class="off-offer-card-title">${esc(disp)}</div>
  <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:6px;flex-wrap:wrap;">
    <div>
      ${cu
        ? `<button type="button" class="off-offer-card-cu off-offer-card-cu--link" onclick="event.stopPropagation();Router.showPage('pg-crm-detail',{customerId:'${cu.id}'})">${ic('user',11)} ${esc(cuName)}</button>`
        : `<div class="off-offer-card-cu">${ic('user',11)} ${esc(cuName)}</div>`}
      <div class="off-offer-card-meta">
        ${ic('calendar',9)} ${fmtDate(o.createdAt)}
        ${o.sentAt ? `&nbsp;·&nbsp;${ic('send',9)} Skickad ${fmtDate(o.sentAt)}` : ''}
        ${o.validUntil ? `&nbsp;·&nbsp;${ic('clock',9)} Giltig t.o.m. ${fmtDate(o.validUntil)}` : ''}
      </div>
      ${nextActLine ? `<div style="margin-top:3px;">${nextActLine}</div>` : ''}
      ${o.status === 'godkänd' && o.manualApproval ? `<div style="margin-top:3px;font-size:10px;color:var(--gr);display:flex;align-items:center;gap:3px;">${ic('check-circle',9)} Godkännande registrerat via ${esc(o.manualApproval.method||'—')}${o.manualApproval.registeredAt?' · '+fmtDate(o.manualApproval.registeredAt):''}</div>` : (o.status === 'godkänd' && o.customerApproval ? `<div style="margin-top:3px;font-size:10px;color:var(--gr);display:flex;align-items:center;gap:3px;">${ic('check-circle',9)} Godkänd av ${esc(o.customerApproval.approvedByName||'—')}${o.customerApproval.approvedAt?' · '+fmtDateTime(o.customerApproval.approvedAt):''}</div>` : '')}
    </div>
    ${insight ? `<span class="off-offer-insight ${insight.cls}" style="margin-top:0;">${insight.txt}</span>` : ''}
  </div>
</div>`;
    }).join('');
  },

  /* OFFER CORE R1.4 — BLOCKER 1: the old `_offerExVat(o)` (= pre-discount
     _offRawExVat(o)) is REMOVED — it is no longer called anywhere
     (createAO() now uses the canonical _buildAOConversionPayload(off),
     which derives fixedPrice from _offerCalcTotals(off).exVatAfterDiscount)
     and leaving it in place would be a live, financially-wrong footgun for
     any future caller. */

  /* OFFER CORE R1.2 — BLOCKER 4 (motbevis-granskad, traced first): the
     offer -> AO conversion flow (`createAO()` below) has always created
     a single `priceType:'fast'` AO with `fixedPrice: _offerExVat(off)`
     (= `_offRawExVat(off)`). Since R1, `_offRawExVat` intentionally
     EXCLUDES 'recurring' lines (by design — see its own header comment).
     A real Södra Heden-style offer (8000/mån, no one-time component)
     could therefore be approved and converted into a "fixed-price" AO
     worth 0 kr — a genuine, silent financial loss, not a display bug.
     TRACE PERFORMED: VIFT already has a genuine recurring-work
     destination, `RecurringOrderService`/`RecurringPage` ("Återkommande
     ärenden") — but it requires an explicit interval/schedule
     (dagligen/veckovis/månadsvis/eget + start/next date) that an Offer
     simply does not capture anywhere. Auto-deriving a schedule from an
     offer would be guessing, explicitly forbidden by this round's
     instructions, and building a proper offer->contract scheduling UI
     is a genuine new subsystem, explicitly out of scope for this
     release ("DO NOT BUILD A LARGE contract subsystem"). There is
     therefore no existing, small-to-reuse conversion target for a
     recurring commitment. Per the brief: FAIL CLOSED. This is the ONLY
     place that decides whether "Skapa arbetsorder"/"Skapa AO" may run —
     used both to gate the buttons (so the UI never even offers a
     doomed action) and inside createAO() itself as a second, load-
     bearing guard (never trust only the UI to have hidden a button). A
     PURE one-time offer (rate-card lines are already correctly
     excluded from _offRawExVat, so they never inflate/deflate this) is
     completely unaffected — see test 1/5. */
  /* OFFER CORE R1.3 — thin wrapper around the canonical
     _offAOConversionDecision(off) (see its own header comment for the
     full trace/decision, including the NEW rate-only/optional-only
     rule). Kept as a boolean-returning method since all 4 existing call
     sites (createAO() itself, the two "Skapa..." buttons, the sales-
     assistant tip) only ever needed a boolean — no behavior change to
     those call sites, just routed through the richer decision helper. */
  _offBlocksAOConversion(off) {
    return !_offAOConversionDecision(off).allowed;
  },

  _offerInsight(o) {
    const now = Date.now();
    const validDate  = o.validUntil ? new Date(o.validUntil).getTime() : null;
    const daysLeft   = validDate ? Math.round((validDate - now) / 86400000) : null;
    const sentDate   = o.sentAt ? new Date(o.sentAt).getTime() : null;
    const daysSent   = sentDate ? Math.round((now - sentDate) / 86400000) : null;

    /* Tokengiltighet */
    const tokenActive  = o.publicToken && !o.tokenRevokedAt;
    const tokenExpired = o.tokenExpiresAt && new Date(o.tokenExpiresAt).getTime() < now;
    const tokenDaysL   = o.tokenExpiresAt ? Math.round((new Date(o.tokenExpiresAt).getTime() - now) / 86400000) : null;

    if (o.status === 'godkänd' && o.workOrderId)  return {cls:'ins-godkand', txt: ic('check-circle',10) + ' Arbetsorder ' + o.workOrderId + ' skapad'};
    /* NOTE (R1.6 — ITEM 2): only tell the user to create an AO when it is
       actually possible right now — both the lifecycle guard (not
       archived/deleted/already-converted) and the financial guard (a
       real committed one-time amount) must agree. Otherwise show a
       neutral "Godkänd" — the specific reason belongs in the offer
       detail UI, not the list card. */
    if (o.status === 'godkänd' && !o.workOrderId) {
      const canCreateAO = _offAOCreateLifecycleDecision(o).allowed && _offAOConversionDecision(o).allowed;
      return {cls:'ins-godkand', txt: ic('check-circle',10) + (canCreateAO ? ' Godkänd — skapa arbetsorder' : ' Godkänd')};
    }
    if (o.status === 'nekad')           return {cls:'ins-nekad',   txt: ic('x-circle',10) + ' Nekad — följ upp orsak'};
    if (o.status === 'ändring-begärd')  return {cls:'ins-followup',txt: ic('edit-3',10) + ' Ändring begärd av kund — åtgärda'};
    if (o.status === 'utgången')        return {cls:'ins-nekad',   txt: ic('clock',10) + ' Utgången — förnya offerten'};
    /* Tokenaktiv men kund ej öppnat > 2 dagar — påminn */
    if (tokenActive && !tokenExpired && o.openCount === 0 && daysSent !== null && daysSent > 2)
      return {cls:'ins-followup', txt: ic('link',10) + ' Länk skickad men ej öppnad — påminn kunden'};
    /* Kund har öppnat men inte svarat */
    if (tokenActive && !tokenExpired && o.openCount > 0 && (o.status === 'skickad' || o.status === 'väntar') && daysSent > 3)
      return {cls:'ins-followup', txt: ic('eye',10) + ' Kund har öppnat — inväntar svar (' + (o.openCount||0) + ' visn.)'};
    /* Token snart utgången */
    if (tokenActive && tokenDaysL !== null && tokenDaysL >= 0 && tokenDaysL <= 3)
      return {cls:'ins-expiry', txt: '⚠️ Länk utgår om ' + tokenDaysL + ' dag' + (tokenDaysL===1?'':'ar')};
    if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 7) return {cls:'ins-expiry', txt: '⚠️ Offert utgår om ' + daysLeft + ' dag' + (daysLeft === 1 ? '' : 'ar')};
    if ((o.status === 'skickad' || o.status === 'väntar') && daysSent !== null && daysSent > 5) return {cls:'ins-followup', txt: ic('bell',10) + ' Skickad för ' + daysSent + ' dagar — dags följa upp'};
    if (o.status === 'skickad')  return {cls:'ins-skickad', txt: ic('send',10) + ' Skickad — inväntar svar'};
    if (o.status === 'väntar')   return {cls:'ins-followup',txt: ic('clock',10) + ' Väntar på svar'};
    if (o.status === 'utkast')   return {cls:'ins-utkast',  txt: ic('edit-3',10) + ' Utkast — färdigställ och skicka'};
    return null;
  },

  /* ── Wizard open ─── */
  /* V47: opts är en bakåtkompatibel, optional tredje parameter — gamla anrop
     som bara skickar (preCustomerId) fortsätter fungera exakt som tidigare.
     opts.onCreated(offer) anropas EFTER lyckad, riktig persist i _save() —
     aldrig vid avbrutet/misslyckat sparande. Används av SalesPage.createOffer(). */
  /* V48B4A: standalone ny-offert (inget opts.onCreated) kontrollerar FÖRST
     om ett giltigt, osparat lokalt utkast finns för denna användare — se
     _draftRead()/§9-§10 i RAPPORT-V48B4A. Kontextuella anrop (Sales→Offer
     m.fl., dvs. opts.onCreated är satt) och redigering av befintlig offert
     (openEdit) berörs ALDRIG av draft-autosave/recovery — se §22/§23. */
  openCreate(preCustomerId, opts) {
    /* V48B4A.1: DEFAULT flush (inte {flush:false}) — annars kastas en
       VÄNTANDE, ännu icke-debounce-utlöst ändring från en tidigare
       standalone-session bort tyst om användaren hinner byta authoring-läge
       (t.ex. öppna en kontextuell offert från Sales) innan 750ms passerat.
       Se _stopDraftAutosave()s kommentar och §7/§8 i RAPPORT-V48B4A-1. */
    this._stopDraftAutosave();
    const isStandalone = !(opts && typeof opts.onCreated === 'function');
    if (isStandalone) {
      const userId = this._resolveDraftUserId();
      if (userId) {
        this._draftUserId = userId;
        const draft = this._draftRead();
        if (draft) {
          this._pendingDraftOpenArgs = { preCustomerId: preCustomerId, opts: opts };
          this._showDraftRecoveryPrompt(draft);
          return;
        }
      }
      this._draftUserId = null;
    }
    this._initFreshOffer(preCustomerId, opts);
    this._showWizard();
    if (isStandalone) this._startDraftAutosave(null);
  },

  _initFreshOffer(preCustomerId, opts) {
    const T = this._TERMS;
    const today    = tdy();
    const validDef = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
    this._editLines    = [];
    this._editExtras   = [];
    this._editSectionOrder = DEFAULT_OFFER_SECTION_ORDER.slice();
    this._sectionDragIdx = null;
    this._editOfferId  = null;
    this._createOnCreated = (opts && typeof opts.onCreated === 'function') ? opts.onCreated : null;
    this._saveInFlight = false;
    this._wizardStep   = 1;
    this._stepMsg      = '';
    this._activeSvcId  = null;
    this._svcFields    = {};
    this._svcEditIdx   = null;
    this._svcReduction = 'ingen';
    this._discount     = {type:'percent', value:0};
    this._expandedLineIds = new Set();
    this._mobileTotalsExpanded = false;
    this._wizardData   = {
      customerId: preCustomerId || '', propertyId: '', title: '', date: today, validUntil: validDef,
      summary: '', scope: '', includes: '', excludes: '',
      paymentTerms: T.payment, validityText: T.validity, generalTerms: T.general, internalNote: '',
      /* V54B — samma "kontextuellt förhandsifyllnadsvärde"-mönster som
         preCustomerId ovan, buret via opts precis som opts.onCreated
         redan är. Ingen egen offertformulär-arkitektur duplicerad. */
      projectId: (opts && opts.projectId) || ''
    };
  },

  openEdit(offerId) {
    /* V48B4A.1: DEFAULT flush — se openCreate()s kommentar. */
    this._stopDraftAutosave();
    const off = getOff(offerId);
    if (!off) return;
    const T = this._TERMS;
    const today    = tdy();
    const validDef = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
    this._editLines    = (off.lines  || []).map(l => ({...l}));
    this._editExtras   = (off.extras || []).map(e => ({...e}));
    this._editSectionOrder = _resolveSectionOrder(off.sectionOrder);
    this._sectionDragIdx = null;
    this._editOfferId  = off.id;
    this._createOnCreated = null; /* V47: aldrig callback vid redigering av befintlig offert */
    this._saveInFlight = false;
    this._wizardStep   = 1;
    this._stepMsg      = '';
    this._activeSvcId  = null;
    this._svcFields    = {};
    this._svcEditIdx   = null;
    this._svcReduction = 'ingen';
    this._discount     = off.discount ? {...off.discount} : {type:'percent', value:0};
    this._expandedLineIds = new Set();
    this._mobileTotalsExpanded = false;
    this._wizardData  = {
      customerId:   off.customerId   || '',
      propertyId:   off.propertyId   || '',
      title:        off.title        || '',
      date:         (off.createdAt||'').split('T')[0] || today,
      validUntil:   off.validUntil   || validDef,
      summary:      off.summary      || '',
      scope:        off.scope        || '',
      includes:     off.includes     || '',
      excludes:     off.excludes     || '',
      paymentTerms: off.paymentTerms || T.payment,
      validityText: off.validityText || T.validity,
      generalTerms: off.generalTerms || T.general,
      internalNote: off.internalNote || '',
      projectId:    off.projectId    || ''
    };
    this._showWizard();
  },

  /* ── V48B4A: Offert-utkast (lokal autosave/recovery) ─────────────────────
     Skyddar ENDAST fristående "Ny offert" (inget opts.onCreated). Rör
     ALDRIG state.offers, persist(), Storage.setAll() eller DataSync — ren
     lokal, transient UI-skyddsmekanism. Se RAPPORT-V48B4A. */

  _DRAFT_VERSION: 1,
  _DRAFT_TTL_MS: 7 * 24 * 60 * 60 * 1000,
  _draftEnabled: false,
  _draftUserId: null,
  _draftCreatedAt: null,
  _draftSaveTimer: null,
  _draftWriteFailed: false,
  _draftInputHandler: null,
  _draftBeforeUnloadHandler: null,
  _draftStatusText: '',
  _pendingDraftOpenArgs: null,

  /* Stabil, opak användaridentitet — samma id som UserPrefsService/
     DashboardConfig redan namnrymdar sina localStorage-nycklar med.
     Returnerar null (inte 'unknown') om ingen säker identitet finns —
     draft ska då INTE aktiveras, se openCreate()/_startDraftAutosave(). */
  _resolveDraftUserId() {
    const u = (typeof state !== 'undefined') ? state.currentUser : null;
    if (u && u.id && u.id !== 'unknown') return u.id;
    return null;
  },

  _draftKey() {
    return this._draftUserId ? ('offerDraft_v1_new_' + this._draftUserId) : null;
  },

  /* Läser och validerar ett lokalt utkast. Fail-safe: korrupt JSON, fel
     envelope-shape, okänd version eller för gammalt utkast (>7 dagar)
     tas bort tyst och null returneras — ALDRIG en krasch, ALDRIG ett
     blint Object.assign av opålitligt innehåll in i wizardens state. */
  _draftRead() {
    const key = this._draftKey();
    if (!key) return null;
    let raw;
    try { raw = localStorage.getItem(key); } catch (e) { return null; }
    if (!raw) return null;
    let envelope;
    try { envelope = JSON.parse(raw); } catch (e) { this._draftRemove(); return null; }
    if (!envelope || typeof envelope !== 'object') { this._draftRemove(); return null; }
    if (envelope.version !== this._DRAFT_VERSION) { this._draftRemove(); return null; }
    if (envelope.kind !== 'new-offer') { this._draftRemove(); return null; }
    const d = envelope.data;
    if (!d || typeof d !== 'object') { this._draftRemove(); return null; }
    if (!d.wizardData || typeof d.wizardData !== 'object') { this._draftRemove(); return null; }
    if (!Array.isArray(d.lines)) { this._draftRemove(); return null; }
    if (!Array.isArray(d.extras)) { this._draftRemove(); return null; }
    if (!d.discount || typeof d.discount !== 'object') { this._draftRemove(); return null; }
    /* QA 2026-11-26: guiden har fyra steg (steg 4 = Granska & spara). */
    if (![1, 2, 3, 4].includes(d.wizardStep)) { this._draftRemove(); return null; }
    const stamp = Date.parse(envelope.updatedAt || envelope.createdAt || '');
    if (!isFinite(stamp)) { this._draftRemove(); return null; }
    if (Date.now() - stamp > this._DRAFT_TTL_MS) { this._draftRemove(); return null; }
    return envelope;
  },

  _draftRemove() {
    const key = this._draftKey();
    if (!key) return;
    try { localStorage.removeItem(key); } catch (e) {}
  },

  /* Ett HELT tomt utkast (ingen kund, ingen text, inga rader/tillval) ska
     varken skrivas eller ligga kvar — annars skulle t.ex. ett obetänksamt
     "Börja om" (som omedelbart startar en NY, tom draft-session) följt av
     en beforeunload-sista-flush kunna skapa en meningslös "återställ
     utkast"-prompt nästa gång, för ett utkast som facto inte innehöll
     något att återställa. */
  _isDraftEmpty() {
    const d = this._wizardData || {};
    const hasText = ['title','summary','scope','includes','excludes','internalNote']
      .some(k => (d[k] || '').trim());
    const hasCustomer = !!d.customerId;
    const hasLines  = (this._editLines  || []).length > 0;
    const hasExtras = (this._editExtras || []).length > 0;
    /* V48B5 Gate C: en offert vars ENDA ändring är en omordnad
       sektionsordning ska fortfarande räknas som "påbörjad" av
       stängningsvakten (Gate A) — annars skulle en användare som bara
       drar om avsnitten kunna stänga wizarden utan varning och tappa
       den ändringen. */
    const hasReorderedSections = Array.isArray(this._editSectionOrder) &&
      JSON.stringify(_resolveSectionOrder(this._editSectionOrder)) !== JSON.stringify(DEFAULT_OFFER_SECTION_ORDER);
    return !hasText && !hasCustomer && !hasLines && !hasExtras && !hasReorderedSections;
  },

  /* Skriver EXAKT den whitelistade, JSON-säkra delmängden av wizard-state —
     aldrig funktioner/DOM-referenser/opts.onCreated/svc-kalkylator-scratch
     (se §7/§19 i RAPPORT-V48B4A). `localStorage.setItem` kan kasta (kvot,
     privat läge) — try/catch, appen får ALDRIG krascha, och en spammig
     varning visas bara EN gång tills nästa lyckade skrivning. */
  _draftWrite() {
    if (!this._draftEnabled) return;
    const key = this._draftKey();
    if (!key) return;
    if (this._isDraftEmpty()) { this._draftRemove(); this._setDraftStatusText(''); return; }
    if (!this._draftCreatedAt) this._draftCreatedAt = new Date().toISOString();
    const envelope = {
      version: this._DRAFT_VERSION,
      kind: 'new-offer',
      createdAt: this._draftCreatedAt,
      updatedAt: new Date().toISOString(),
      data: {
        wizardStep: this._wizardStep,
        wizardData: Object.assign({}, this._wizardData),
        lines:      (this._editLines  || []).map(l => Object.assign({}, l)),
        extras:     (this._editExtras || []).map(e => Object.assign({}, e)),
        discount:   Object.assign({}, this._discount || { type: 'percent', value: 0 }),
        /* V48B5 Gate C: valfritt fält — INGEN version-bump av draft-
           envelopet. Ett äldre utkast (sparat innan denna gate fanns)
           saknar helt enkelt fältet vid återställning, vilket
           _resolveSectionOrder()/_restoreDraft() redan hanterar
           korrekt (-> standardordningen, exakt som innan). */
        sectionOrder: _resolveSectionOrder(this._editSectionOrder)
      }
    };
    try {
      localStorage.setItem(key, JSON.stringify(envelope));
      this._draftWriteFailed = false;
      this._setDraftStatusText('Lokalt utkast sparat ' +
        new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }));
    } catch (e) {
      if (!this._draftWriteFailed) {
        this._draftWriteFailed = true;
        showToast('Kunde inte autospara offertutkastet lokalt.');
      }
    }
  },

  _setDraftStatusText(text) {
    this._draftStatusText = text || '';
    const el = document.getElementById('off-draft-status');
    if (!el) return;
    el.textContent = this._draftStatusText;
    el.style.display = this._draftStatusText ? '' : 'none';
  },

  /* Delegerad input/change-lyssnare på #off-wizard-roten — täcker alla
     vanliga fält (text/number/select, inkl. CustomSelects riktiga
     bubblande change-event, se CustomSelect.js) UTAN att behöva röra
     dussintals enskilda inline-handlers. #off-wizard-elementet SJÄLVT
     byts aldrig ut av _rerender() (bara dess innerHTML), så lyssnaren
     överlever stegbyten/radändringar automatiskt. Strukturella actions
     (lägg till/ta bort rad, stegbyte, m.fl.) flushar explicit direkt —
     se respektive funktion. */
  _bindDraftListeners() {
    const wiz = document.getElementById('off-wizard');
    if (wiz) {
      this._draftInputHandler = () => this._scheduleDraftSave();
      wiz.addEventListener('input', this._draftInputHandler);
      wiz.addEventListener('change', this._draftInputHandler);
    }
    /* beforeunload är window-scopat, INTE knutet till #off-wizard-DOM-noden
       — måste tas bort explicit (se _unbindDraftListeners) annars läcker
       en ny lyssnare vid varje wizard-öppning (V48B4A §14/§32). Ingen
       preventDefault/returnValue — ren, icke-blockerande sista-flush. */
    this._draftBeforeUnloadHandler = () => { this._flushDraftNow(); };
    window.addEventListener('beforeunload', this._draftBeforeUnloadHandler);
  },

  _unbindDraftListeners() {
    const wiz = document.getElementById('off-wizard');
    if (wiz && this._draftInputHandler) {
      wiz.removeEventListener('input', this._draftInputHandler);
      wiz.removeEventListener('change', this._draftInputHandler);
    }
    this._draftInputHandler = null;
    if (this._draftBeforeUnloadHandler) {
      window.removeEventListener('beforeunload', this._draftBeforeUnloadHandler);
      this._draftBeforeUnloadHandler = null;
    }
    if (this._draftSaveTimer) { clearTimeout(this._draftSaveTimer); this._draftSaveTimer = null; }
  },

  _scheduleDraftSave() {
    if (!this._draftEnabled) return;
    if (this._draftSaveTimer) clearTimeout(this._draftSaveTimer);
    this._draftSaveTimer = setTimeout(() => { this._draftSaveTimer = null; this._draftWrite(); }, 750);
  },

  _flushDraftNow() {
    if (!this._draftEnabled) return;
    if (this._draftSaveTimer) { clearTimeout(this._draftSaveTimer); this._draftSaveTimer = null; }
    this._draftWrite();
  },

  /* Startar draft-läge för en fristående ny-offert-session. Ingen stabil
     användaridentitet → draft avstängs helt för sessionen, wizarden
     fungerar i övrigt precis som vanligt (§4 i RAPPORT-V48B4A). */
  _startDraftAutosave(existingDraftEnvelope) {
    const userId = this._resolveDraftUserId();
    if (!userId) {
      this._draftEnabled = false;
      this._draftUserId = null;
      showToast('Lokalt utkast kan inte autosparas i den här sessionen.');
      return;
    }
    this._draftEnabled     = true;
    this._draftUserId      = userId;
    this._draftWriteFailed = false;
    this._draftCreatedAt   = existingDraftEnvelope ? existingDraftEnvelope.createdAt : null;
    this._bindDraftListeners();
    this._setDraftStatusText(existingDraftEnvelope ? 'Lokalt utkast återställt' : '');
  },

  /* opts.flush===false hoppar över sista-flush (används av success-save,
     som redan explicit rensat draften — en flush där skulle återuppliva
     den precis borttagna draften, se _save()). Alla andra vägar (Avbryt/
     X/navigering/mode-switch) flushar som vanligt INNAN lyssnarna kopplas
     bort — se särskilt öppningsraderna i openCreate()/openEdit(), där
     DETTA flush-anrop (default, INTE {flush:false}) är vad som räddar en
     VÄNTANDE 750ms-debounced ändring från en tidigare standalone-session
     undan att kastas bort tyst när en ny authoring-session (edit eller
     kontextuell create) tar över samma wizard-instans (V48B4A.1 §7/§8).
     `_draftStatusText` nollställs alltid HÄR — annars skulle en gammal
     "Lokalt utkast sparat HH:MM"-status kunna läcka in i en SENARE,
     orelaterad authoring-session (kontextuell create eller edit) vars
     egen render bara villkorar synligheten på `!isEdit`, inte på
     `_draftEnabled` (V48B4A.1 §5/§6). En genuin restore-session sätter
     ändå ALLTID sin egen statustext explicit direkt efteråt, se
     _startDraftAutosave(). */
  _stopDraftAutosave(opts) {
    opts = opts || {};
    if (this._draftEnabled && opts.flush !== false) this._flushDraftNow();
    this._unbindDraftListeners();
    this._draftEnabled   = false;
    this._draftUserId    = null;
    this._draftCreatedAt = null;
    this._setDraftStatusText('');
  },

  _showDraftRecoveryPrompt(draft) {
    const stamp = draft.updatedAt || draft.createdAt;
    const dt = stamp ? new Date(stamp) : null;
    const timeStr = dt ? dt.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '';
    const todayStr = tdy();
    const isToday = dt && dt.toISOString().split('T')[0] === todayStr;
    const whenText = dt
      ? (isToday ? ('idag ' + timeStr) : (dt.toLocaleDateString('sv-SE') + ' ' + timeStr))
      : '';
    Modal.open({
      title: 'Osparat offertutkast',
      body: `<p style="font-size:14px;line-height:1.5;color:var(--tx);">Du har ett osparat offertutkast${whenText ? ' från ' + esc(whenText) : ''}.</p>`,
      buttons: [
        { label: 'Återställ utkast', cls: 'btn bp', onClick: () => { Modal.close(); OffersPage._restoreDraft(draft); } },
        { label: 'Börja om',         cls: 'btn bs', onClick: () => { Modal.close(); OffersPage._discardDraftAndStartFresh(); } }
      ]
    });
  },

  _restoreDraft(draft) {
    const T = this._TERMS;
    const d = draft.data;
    this._editLines    = (d.lines  || []).map(l => Object.assign({}, l));
    this._editExtras   = (d.extras || []).map(e => Object.assign({}, e));
    this._editSectionOrder = _resolveSectionOrder(d.sectionOrder);
    this._sectionDragIdx = null;
    this._editOfferId  = null;
    this._createOnCreated = null;
    this._saveInFlight = false;
    this._wizardStep   = (d.wizardStep >= 2 && d.wizardStep <= 4) ? d.wizardStep : 1;
    this._stepMsg      = '';
    this._activeSvcId  = null;
    this._svcFields    = {};
    this._svcEditIdx   = null;
    this._svcReduction = 'ingen';
    this._discount     = Object.assign({ type: 'percent', value: 0 }, d.discount || {});
    this._expandedLineIds = new Set();
    this._mobileTotalsExpanded = false;
    this._wizardData   = Object.assign({
      customerId: '', title: '', date: tdy(), validUntil: '',
      summary: '', scope: '', includes: '', excludes: '',
      paymentTerms: T.payment, validityText: T.validity, generalTerms: T.general, internalNote: ''
    }, d.wizardData || {});
    this._pendingDraftOpenArgs = null;
    this._showWizard();
    this._startDraftAutosave(draft);
    showToast('Offertutkast återställt');
  },

  _discardDraftAndStartFresh() {
    this._draftRemove();
    const args = this._pendingDraftOpenArgs || {};
    this._pendingDraftOpenArgs = null;
    this._initFreshOffer(args.preCustomerId, args.opts);
    this._showWizard();
    this._startDraftAutosave(null);
  },

  /* ── Wizard core ─── */
  _showWizard() {
    // Render wizard inside the content area so sidebar stays visible
    const pgOffer = document.getElementById('pg-offer');
    if (pgOffer && !pgOffer.classList.contains('active')) Router.showPage('pg-offer');
    const con = document.getElementById('pg-offer-content');
    if (!con) return;
    con.dataset.wiz = '1';
    // Override .con padding/gap so wizard fills the area cleanly. Bottom
    // padding is intentionally left OUT of this inline override (R1.6.8) —
    // it is owned by the #pg-offer-content[data-wiz="1"] CSS rule in
    // components.css instead, so the mobile bottom-nav reservation can
    // never be shadowed by an inline style. See that rule's comment for
    // the full scroll-ownership trace.
    con.style.cssText = 'padding-top:0;padding-left:0;padding-right:0;gap:0;display:block;box-sizing:border-box;max-width:none;width:100%;margin-left:0;margin-right:0;';
    con.innerHTML = '<div id="off-wizard"></div>';
    const wizEl = document.getElementById('off-wizard');
    wizEl.innerHTML = this._wizardHtml();
    /* QA 2026-11-26: livesummeringen följer ALLA fält i steg 2 (även
       benämningar, som inte anropar _refreshTotals) — delegerad lyssnare
       på #off-wizard, som lever lika länge som guiden. */
    wizEl.addEventListener('input', () => { if (this._wizardStep === 2) this._scheduleSummaryRefresh(); });
    wizEl.addEventListener('change', () => { if (this._wizardStep === 2) this._scheduleSummaryRefresh(); });
    const scroll = document.getElementById('content-scroll');
    if (scroll) scroll.scrollTop = 0;
    this._syncWizardFloor();
    if (!this._wizardResizeBound) {
      this._wizardResizeBound = true;
      window.addEventListener('resize', () => this._syncWizardFloor());
    }
  },

  /* OFFER CORE R1.6.9 — FINAL SHORT-CONTENT FOOTER ALIGNMENT (hardened in
     R1.6.10, both fixes below): reads #content-scroll's real, already-
     rendered clientHeight (an ELEMENT measurement — the same element the
     existing #content-scroll/.page CSS chain already depends on, NOT
     window.innerHeight and NOT a hardcoded viewport pixel value) and
     writes #off-wizard's own min-height directly, so the footer's
     `margin-top:auto` (components.css) has a real target to settle
     against on short steps. #pg-offer-content itself is never touched
     here — see components.css's own comment for why giving IT an
     explicit height would silently break the R1.6.8 long-content fix.

     R1.6.10 — BLOCKER 1 FIX: the real #mobile-bottom-nav element's OWN
     rendered height is read directly (getBoundingClientRect().height)
     instead of a hardcoded `57`. The nav's real height already includes
     `env(safe-area-inset-bottom)` (responsive.css, untouched) — reading
     it live makes the floor automatically safe-area-correct on an actual
     notched/home-indicator device without this file ever needing to know
     what a safe-area inset is, let alone hardcode one. `57` remains only
     as a last-resort fallback for the (non-production) case where the
     real nav element cannot be measured at all (e.g. not yet in the DOM).
     `12` is the one deliberate, fixed design-gap constant — the only
     number this method still hardcodes on purpose.

     R1.6.10 — BLOCKER 2 FIX: `wiz` is now resolved BEFORE the desktop
     breakpoint check, and the >=1024px branch explicitly clears any
     stale mobile-set inline min-height (`wiz.style.minHeight = ''`)
     before returning — previously an early `return` at >=1024px left a
     mobile-set inline min-height in place after a resize from mobile to
     desktop width, which is now fixed: desktop always ends up with zero
     inline min-height, restoring desktop's ordinary (untouched) CSS
     sizing.

     Guarded to <1024px, the same breakpoint Router.js already uses
     elsewhere. */
  _syncWizardFloor() {
    const wiz = document.getElementById('off-wizard');
    if (!wiz) return;
    if (window.innerWidth >= 1024) {
      wiz.style.minHeight = '';
      return;
    }
    const scroll = document.getElementById('content-scroll');
    if (!scroll) return;
    const nav = document.getElementById('mobile-bottom-nav');
    const navRectHeight = nav ? nav.getBoundingClientRect().height : 0;
    const navHeight = navRectHeight > 0 ? navRectHeight : 57;
    const target = scroll.clientHeight - navHeight - 12;
    wiz.style.minHeight = target > 0 ? target + 'px' : '';
  },

  /* V48B5 Gate A: SMAL seam för användarinitierad stängning (mobil-
     tillbaka, desktop-X, step-1 "Avbryt") — INTE för intern, bekräftad
     success-save (som fortsätter anropa _wizardClose() direkt, oförändrat)
     och INTE för step-tillbaka (_prevStep(), som aldrig stänger wizarden).
     Visar en bekräftelseruta ENDAST om ett standalone draft-läge är
     aktivt OCH något faktiskt fyllts i (_isDraftEmpty()===false) — en tom
     "Ny offert" stängs alltid direkt, precis som idag. Kontextuell create
     och redigering av befintlig offert har ALDRIG _draftEnabled===true
     (se V48B4A/§4/§21-22 i tidigare rundor), så de får AUTOMATISKT ingen
     guard, utan att behöva ett separat isEdit/kontextuell-villkor här. */
  _requestWizardClose() {
    if (this._draftEnabled && !this._isDraftEmpty()) {
      Modal.open({
        title: 'Stäng offert?',
        body: '<p style="font-size:14px;line-height:1.5;color:var(--tx);">Du har påbörjat en offert. Ditt lokala utkast sparas och kan återställas nästa gång.</p>',
        buttons: [
          { label: 'Fortsätt redigera',        cls: 'btn bs', onClick: () => Modal.close() },
          { label: 'Stäng och behåll utkast',  cls: 'btn bp', onClick: () => {
            Modal.close();
            /* Flusha den absolut senaste ändringen INNAN wizarden stängs —
               samma princip som redan används vid mode-switch (V48B4A.1
               §7/§8) — sedan _wizardClose() direkt, INTE
               _requestWizardClose(), så ingen rekursiv guard uppstår. */
            this._flushDraftNow();
            this._wizardClose();
          }},
          /* OFFER FINAL RC — "Stäng och ta bort utkast" saknades helt (denna
             knapp fanns aldrig, det var root cause: inte en trasig handler,
             utan en obefintlig). Använder EXAKT samma, redan etablerade
             mönster som _save()s bekräftade success-gren (rad ~4297):
             _draftRemove() FÖRST (medan _draftUserId fortfarande är satt —
             _wizardClose() nollställer den via _stopDraftAutosave()), sedan
             _wizardClose({skipDraftFlush:true}) — utan skipDraftFlush skulle
             _wizardClose()s vanliga flush (_stopDraftAutosave() defaultar
             till flush:true) omedelbart återuppliva den precis borttagna
             draften i localStorage. Denna guard (_draftEnabled === true)
             är ALDRIG sann i redigeringsläge (befintlig, sparad offert) —
             se _startDraftAutosave()/openEdit(), som aldrig anropar den —
             så denna gren, och därmed denna knapp, visas ALDRIG vid
             redigering av en sparad offert: att stänga en redigeringssession
             lämnar alltid den sparade offert-posten helt orörd, eftersom
             inget någonsin skrivits till en beständig draft för den. */
          { label: 'Stäng och ta bort utkast', cls: 'btn bd', onClick: () => {
            Modal.close();
            this._draftRemove();
            this._wizardClose({ skipDraftFlush: true });
          }}
        ]
      });
      return;
    }
    this._wizardClose();
  },

  /* V48B4A: opts.skipDraftFlush=true används ENDAST av _save()s bekräftade
     success-grenar, som redan explicit rensat draften (_draftRemove()) —
     en vanlig flush här skulle annars återuppliva den precis borttagna
     draften. Alla andra vägar (Avbryt/X/ingen opts) flushar som vanligt
     och lämnar draften orörd, se _stopDraftAutosave(). */
  _wizardClose(opts) {
    this._stopDraftAutosave({ flush: !(opts && opts.skipDraftFlush) });
    const con = document.getElementById('pg-offer-content');
    if (con) { delete con.dataset.wiz; con.style.cssText = ''; }
    document.getElementById('off-svc-overlay')?.remove();
    this.render();
  },

  _rerender() {
    const con = document.getElementById('pg-offer-content');
    if (!con || !con.dataset.wiz) return;
    const wiz = document.getElementById('off-wizard');
    if (wiz) wiz.innerHTML = this._wizardHtml();
    const scroll = document.getElementById('content-scroll');
    if (scroll) scroll.scrollTop = 0;
    this._syncWizardFloor();
  },

  /* QA 2026-11-26 (offerter) — GUIDEN I FYRA STEG. Samma data, radtyper,
     prismodell, utkast och sparning som tidigare; nytt är tydligare
     stegindelning (klickbar stegvisare med validering per steg), en
     livesummering med moms per sats och ett granskningssteg som visar
     exakt det som sparas (samma rendering som offertdetaljen). */
  _WIZ_STEPS: [
    { n: 1, label: 'Kund & uppdrag' },
    { n: 2, label: 'Tjänster & priser' },
    { n: 3, label: 'Villkor' },
    { n: 4, label: 'Granska & spara' }
  ],
  _stepMsg: '',

  _stepperHtml(variant) {
    const step = this._wizardStep;
    return `<ol class="offw-steps offw-steps--${variant}" aria-label="Steg i offertguiden">` + this._WIZ_STEPS.map(s => {
      const st = s.n < step ? ' is-done' : (s.n === step ? ' is-current' : '');
      return `<li><button type="button" class="offw-step${st}" onclick="OffersPage._goStep(${s.n})"${s.n === step ? ' aria-current="step"' : ''} title="Steg ${s.n}: ${s.label}">
          <span class="offw-step-n">${s.n < step ? ic('check', 13) : s.n}</span><span class="offw-step-l">${s.label}</span>
        </button></li>`;
    }).join('') + `</ol>`;
  },

  _wizardHtml() {
    const step = this._wizardStep;
    const isEdit = !!this._editOfferId;
    const S = this._WIZ_STEPS;
    const cur = S[step - 1] || S[0];

    // Header: sticky; stegvisaren i huvudet på dator, under huvudet på mobil.
    const hdr = `<div class="off-wiz-hdr offw-hdr">
      <button type="button" onclick="OffersPage._requestWizardClose()" title="Stäng" aria-label="Stäng offertguiden" class="off-wiz-hdr-close off-wiz-hdr-close--mobile">${ic('arrow-left',16)}</button>
      <div class="off-wiz-hdr-titlebox">
        <div class="off-wiz-hdr-title">${isEdit ? 'Redigera offert ' + esc(this._editOfferId) : 'Ny offert'}</div>
        <div class="offw-hdr-step">Steg ${step} av ${S.length} · ${cur.label}</div>
        ${!isEdit ? `<div id="off-draft-status" class="off-wiz-draft-status" style="display:${this._draftStatusText?'':'none'};">${esc(this._draftStatusText||'')}</div>` : ''}
      </div>
      ${this._stepperHtml('hdr')}
      <button type="button" onclick="OffersPage._requestWizardClose()" title="Stäng" aria-label="Stäng offertguiden" class="off-wiz-hdr-close off-wiz-hdr-close--desktop">${ic('x',15)}</button>
    </div>`;

    const nextLbl = { 1: 'Nästa: Tjänster', 2: 'Nästa: Villkor', 3: 'Nästa: Granska' }[step];
    const ftr = `<div class="off-wiz-ftr offw-ftr">
      <div id="offw-msg" class="offw-msg" role="alert"${this._stepMsg ? '' : ' hidden'}>${this._stepMsg ? ic('alert-circle',15) + '<span>' + esc(this._stepMsg) + '</span>' : ''}</div>
      <div class="offw-ftr-btns">
        ${step === 1
          ? `<button type="button" class="btn bs off-wiz-ftr-secondary" onclick="OffersPage._requestWizardClose()">Avbryt</button>`
          : `<button type="button" class="btn bs off-wiz-ftr-secondary" onclick="OffersPage._prevStep()">${ic('arrow-left',14)} Tillbaka</button>`}
        <span class="offw-ftr-pos">Steg ${step} av ${S.length}</span>
        ${step < S.length
          ? `<button type="button" class="btn bp off-wiz-ftr-primary" onclick="OffersPage._nextStep()">${nextLbl} ${ic('arrow-right',14)}</button>`
          : `<button type="button" id="offw-save-btn" class="btn bp off-wiz-ftr-primary" onclick="OffersPage._save()">${ic('save',14)} <span>${isEdit ? 'Spara ändringar' : 'Spara offert'}</span></button>`}
      </div>
    </div>`;

    /* Mobil livesummering (steg 2): kompakt rad som ligger kvar nederst
       medan man arbetar med raderna (sticky), samma _offerCalcTotals-kedja. */
    const mobileTotalsFlowHtml = step === 2
      ? `<div class="off-wiz-mobile-totals off-wiz-mobile-totals--flow offw-mbar" id="off-mobile-totals">${this._mobileTotalsHtml()}</div>`
      : '';
    return hdr + `<div class="off-wiz-inner-wide offw-inner offw-step-${step}">${this._stepperHtml('inline')}${this._stepHtml()}${mobileTotalsFlowHtml}</div>` + ftr;
  },

  /* Mobilens summeringsrad: huvudbelopp alltid med "exkl./inkl. moms";
     utfälld visar den samma summering som datorns sidopanel. */
  _mobileTotalsHtml() {
    const off  = { lines: this._editLines, extras: this._editExtras, discount: this._discount };
    const T    = _offerCalcTotals(off);
    const expanded = !!this._mobileTotalsExpanded;
    let lbl, val;
    if (T.rawExVat > 0) { lbl = T.rutRotAmount ? 'Kund betalar inkl. moms' : (T.recurringMonthlyExVat ? 'Engångsbelopp inkl. moms' : 'Totalt inkl. moms'); val = fmt(T.rutRotAmount ? T.customerPays : T.totalInclVat) + ' kr'; }
    else if (T.recurringMonthlyExVat) { lbl = 'Fast kostnad per månad exkl. moms'; val = fmt(T.recurringMonthlyExVat) + ' kr'; }
    else { lbl = 'Summering'; val = '—'; }
    return `<button type="button" class="off-wiz-mobile-totals-toggle" aria-expanded="${expanded}" onclick="OffersPage._toggleMobileTotals()">
        <span class="off-wiz-mobile-totals-lbl">${lbl}</span>
        <span class="off-wiz-mobile-totals-val">${val}</span>
        <span class="off-wiz-mobile-totals-chevron">${ic(expanded?'chevron-down':'chevron-up',14)}</span>
      </button>
      ${expanded ? `<div class="off-wiz-mobile-totals-detail">${OfferDetailPage._totalsRowsHtml(off, { compact: true })}</div>` : ''}`;
  },

  _toggleMobileTotals() {
    this._mobileTotalsExpanded = !this._mobileTotalsExpanded;
    const el = document.getElementById('off-mobile-totals');
    if (el) el.innerHTML = this._mobileTotalsHtml();
  },

  /* V48B3A: "+ Lägg till arbete" — mobil/tablet-ersättning för de fyra
     desktop-actioncardsen. En bottom sheet med samma fyra val, samma
     underliggande skapa-funktioner (_openSvcCalc/_addFixedLine/
     _addManualLine/_addTextBlock) — inga nya radtyper, ingen ny
     datamodell, bara en annan ingång till exakt samma funktioner. */
  _openAddWorkSheet() {
    let sh = document.getElementById('off-addwork-sheet');
    if (!sh) {
      sh = document.createElement('div');
      sh.id = 'off-addwork-sheet';
      sh.className = 'off-addwork-sheet';
      sh.onclick = e => { if (e.target === sh) OffersPage._closeAddWorkSheet(); };
      document.body.appendChild(sh);
    }
    sh.innerHTML = `<div class="off-addwork-sheet-panel">
      <div class="off-addwork-sheet-hd">
        <div class="off-addwork-sheet-title">Lägg till arbete</div>
        <button type="button" class="off-close-btn" onclick="OffersPage._closeAddWorkSheet()">${ic('x',14)}</button>
      </div>
      <button type="button" class="off-addwork-option" onclick="OffersPage._closeAddWorkSheet();OffersPage._openSvcCalc(null)">
        <span class="off-addwork-option-icon">${ic('zap',18)}</span>
        <span class="off-addwork-option-txt"><span class="off-addwork-option-title">Tjänst / kalkyl</span><span class="off-addwork-option-sub">VIFT:s prismodell — yta, tid, material</span></span>
      </button>
      <button type="button" class="off-addwork-option" onclick="OffersPage._closeAddWorkSheet();OffersPage._addFixedLine()">
        <span class="off-addwork-option-icon">${ic('tag',18)}</span>
        <span class="off-addwork-option-txt"><span class="off-addwork-option-title">Fastpris</span><span class="off-addwork-option-sub">Eget fast pris för uppdraget</span></span>
      </button>
      <button type="button" class="off-addwork-option" onclick="OffersPage._closeAddWorkSheet();OffersPage._addManualLine()">
        <span class="off-addwork-option-icon">${ic('plus',18)}</span>
        <span class="off-addwork-option-txt"><span class="off-addwork-option-title">Löpande rad</span><span class="off-addwork-option-sub">Antal × à-pris</span></span>
      </button>
      <button type="button" class="off-addwork-option" onclick="OffersPage._closeAddWorkSheet();OffersPage._addTextBlock()">
        <span class="off-addwork-option-icon">${ic('align-left',18)}</span>
        <span class="off-addwork-option-txt"><span class="off-addwork-option-title">Fritext</span><span class="off-addwork-option-sub">Information utan pris</span></span>
      </button>
      <button type="button" class="off-addwork-option" onclick="OffersPage._closeAddWorkSheet();OffersPage._addExtraAndShow()">
        <span class="off-addwork-option-icon">${ic('plus-circle',18)}</span>
        <span class="off-addwork-option-txt"><span class="off-addwork-option-title">Tillval</span><span class="off-addwork-option-sub">Valfri extratjänst, i eller utanför summan</span></span>
      </button>
    </div>`;
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(() => sh.classList.add('open'));
    else sh.classList.add('open');

    document.body.classList.add('off-addwork-open');
    if (!this._addWorkEscHandler) {
      this._addWorkEscHandler = e => { if (e.key === 'Escape') OffersPage._closeAddWorkSheet(); };
      document.addEventListener('keydown', this._addWorkEscHandler);
    }
  },

  _closeAddWorkSheet() {
    document.getElementById('off-addwork-sheet')?.remove();
    document.body.classList.remove('off-addwork-open');
    if (this._addWorkEscHandler) {
      document.removeEventListener('keydown', this._addWorkEscHandler);
      this._addWorkEscHandler = null;
    }
  },

  _stepHtml() {
    if (this._wizardStep === 1) return this._step1Html();
    if (this._wizardStep === 2) return this._step2Html();
    if (this._wizardStep === 3) return this._step3Html();
    return this._step4Html();
  },

  /* ── Steg 1: Kund & uppdrag ─── */
  _step1Html() {
    const d   = this._wizardData;
    const esc = s => (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return `
      <div class="offw-s1">
        <section class="card offw-card offw-s1-cu">
          <div class="card-header"><h3>${ic('user',15)} Kund</h3>
            <button type="button" class="btn bghost bsm off-new-cu-btn" onclick="OffersPage._quickNewCustomer()">${ic('user-plus',14)} Ny kund</button>
          </div>
          <div class="card-body">
            <div class="fg">
              <label for="off-cu">Kund <span class="offw-req" aria-hidden="true">*</span></label>
              ${CustomerPicker.render('off-cu',{value:d.customerId||'',placeholder:'— Välj kund —',onchange:"OffersPage._customerChanged(this.value)",searchProperties:true})}
            </div>
            <div id="offw-cu-info">${this._customerInfoHtml()}</div>
            <div class="fg" id="off-property-wrap">${this._propertyFieldHtml()}</div>
          </div>
        </section>
        <section class="card offw-card offw-s1-off">
          <div class="card-header"><h3>${ic('file-text',15)} Offert</h3></div>
          <div class="card-body">
            <div class="fg">
              <label for="off-title">Rubrik</label>
              <input id="off-title" value="${esc(d.title)}" placeholder="T.ex. Stentvätt Solvägen 3"
                oninput="OffersPage._wizardData.title=this.value">
              <div class="offw-help">Visas för kunden överst på offerten.</div>
            </div>
            <div class="g2">
              <div class="fg"><label for="off-date">Offertdatum</label>
                <input type="date" id="off-date" value="${esc(d.date)}"
                  oninput="OffersPage._wizardData.date=this.value"></div>
              <div class="fg"><label for="off-valid">Giltig till</label>
                <input type="date" id="off-valid" value="${esc(d.validUntil)}"
                  oninput="OffersPage._wizardData.validUntil=this.value"></div>
            </div>
          </div>
        </section>
        <section class="card offw-card offw-s1-desc">
          <div class="card-header"><h3>${ic('align-left',15)} Uppdragsbeskrivning</h3><span class="offw-opt">Valfritt</span></div>
          <div class="card-body">
            <div class="fg">
              <label for="off-summary">Kort sammanfattning</label>
              <textarea id="off-summary" rows="3" placeholder="T.ex. Stentvätt av marksten, ca 120 m², med algbehandling…"
                oninput="OffersPage._wizardData.summary=this.value">${esc(d.summary)}</textarea>
              <div class="offw-gen-row">
                <button type="button" class="btn bghost bsm off-gen-btn" onclick="OffersPage._genTextSuggestion()">${ic('zap',13)} Generera textförslag</button>
                ${d._lastGenFrom ? `<span class="offw-help">${ic('check',12)} Senast: ${esc(d._lastGenFrom)}</span>` : `<span class="offw-help">Fyller omfattning, ingår och ingår ej utifrån sammanfattningen.</span>`}
              </div>
            </div>
            <div class="fg">
              <label for="off-scope">Uppdragets omfattning</label>
              ${this._toolbarHtml('off-scope','scope')}
              <textarea id="off-scope" rows="4" placeholder="Beskriv vad uppdraget innebär…"
                oninput="OffersPage._wizardData.scope=this.value">${esc(d.scope)}</textarea>
            </div>
            <div class="g2">
              <div class="fg"><label for="off-includes">Vad ingår</label>
                <textarea id="off-includes" rows="3" placeholder="- Rengöring&#10;- Material…"
                  oninput="OffersPage._wizardData.includes=this.value">${esc(d.includes)}</textarea></div>
              <div class="fg"><label for="off-excludes">Vad ingår ej</label>
                <textarea id="off-excludes" rows="3" placeholder="- Målning&#10;- Elektriker…"
                  oninput="OffersPage._wizardData.excludes=this.value">${esc(d.excludes)}</textarea></div>
            </div>
          </div>
        </section>
      </div>`;
  },

  /* Vald kund: typ (BRF/Fastighetsägare/Företag/Privatperson) och kontakt —
     så att rätt mottagare och förutsättningar syns innan rader läggs till. */
  _customerInfoHtml() {
    const cu = getCu(this._wizardData.customerId);
    if (!cu) return `<div class="offw-help offw-cu-empty">${ic('info',13)}<span>Sök på namn, adress, org.nr eller fastighet. Saknas kunden — välj "Ny kund".</span></div>`;
    const norm = (CustomerService.normalizeType ? CustomerService.normalizeType(cu.type) : cu.type) || '';
    const addr = [cu.address, [cu.zip, cu.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return `<div class="offw-cu">
      <div class="offw-cu-top"><strong>${esc(CustomerService.displayName(cu))}</strong><span class="offd-cutype">${esc(CustomerService.typeLabel(cu.type))}</span></div>
      <div class="offw-cu-meta">
        ${cu.email ? `<span>${ic('mail',13)}<span>${esc(cu.email)}</span></span>` : `<span class="offd-warn">${ic('mail',13)}<span>Ingen e-post — behövs för att skicka offerten</span></span>`}
        ${cu.phone ? `<span>${ic('phone',13)}<span>${esc(cu.phone)}</span></span>` : ''}
        ${addr ? `<span>${ic('map-pin',13)}<span>${esc(addr)}</span></span>` : ''}
      </div>
      ${norm === 'privat' ? `<div class="offw-help">Privatperson — RUT/ROT kan anges per rad i nästa steg om kunden har rätt till avdraget.</div>` : ''}
    </div>`;
  },

  /* OFFER CORE R1 — PART B: återanvänder den REDAN etablerade
     CustomerPicker (src/components/CustomerPicker.js), exakt samma
     komponent/mönster som WorkOrdersPage._wizCustomerChanged() redan
     använder — ingen ny sök-implementation byggd för Offer. CustomerPicker
     söker redan på kundens eget namn/adress/postnr/ort/kontaktperson/
     org-nr/telefon (se dess egen _matches()), vilket räcker för att t.ex.
     "Södra Vägen 6" ska hitta kunden "Brf Södra Heden" så länge kundens
     EGEN adress är satt till den adressen — precis så en bostadsrätts-
     förening normalt registreras i VIFT (föreningens egen adress ÄR
     fastighetens adress). Se RAPPORT §Sökbar kund/fastighetsväljare.
     Fastighetsväljaren nedan är en EGEN, liten tillägg (INTE en ny
     sökkomponent): en vanlig, redan befintlig CustomSelect (samma
     generiska dropdown-komponent som användes för kundfältet INNAN denna
     leverans) begränsad till EXAKT den valda kundens egna fastigheter
     (property.customerId === customerId) — proportionerligt för en
     vanligtvis kort lista, och det finns ingen befintlig fastighets-
     sökkomponent i kodbasen att återanvända istället (spårat, se
     RAPPORT). Stabila ID:n hela vägen — ingen kundduplicering. */
  /* OFFER CORE R1.1 — BLOCKER 4: CustomerPicker anropas nu med
     searchProperties:true för Offer (och ENDAST för Offer — alla andra
     konsumenter av CustomerPicker fortsätter oförändrat, se
     CustomerPicker.js §sökutökning). När en träff kom via en fastighet
     (t.ex. sökning på "Södra Vägen 6") lägger CustomerPicker._pick()
     dess id i den dolda select-elementets dataset.matchedPropertyId
     INNAN change-eventet skickas — läses här och prioriteras FÖRE den
     redan existerande "endast en fastighet"-auto-selektionen, så att
     rätt customerId/propertyId-relation bevaras via stabila ID:n, utan
     att duplicera kunden eller gissa. */
  _customerChanged(customerId) {
    this._wizardData.customerId = customerId;
    const props = (state.properties||[]).filter(p => p.customerId === customerId);
    const cuSel = document.getElementById('off-cu');
    const matchedPropertyId = (cuSel && cuSel.dataset) ? cuSel.dataset.matchedPropertyId : '';
    if (matchedPropertyId && props.some(p => p.id === matchedPropertyId)) {
      this._wizardData.propertyId = matchedPropertyId;
    } else {
      const stillValid = props.some(p => p.id === this._wizardData.propertyId);
      if (!stillValid) this._wizardData.propertyId = props.length === 1 ? props[0].id : '';
    }
    const wrap = document.getElementById('off-property-wrap');
    if (wrap) wrap.innerHTML = this._propertyFieldHtml();
    const info = document.getElementById('offw-cu-info');
    if (info) info.innerHTML = this._customerInfoHtml();
    if (customerId && this._stepMsg) { this._stepMsg = ''; this._renderStepMsg(); }
    this._flushDraftNow();
  },

  _propertyFieldHtml() {
    const d = this._wizardData;
    if (!d.customerId) return '';
    const props = (state.properties||[]).filter(p => p.customerId === d.customerId);
    if (!props.length) return '';
    const opts = [{v:'',l:'— Ingen specifik fastighet —'}, ...props.map(p => ({
      v: p.id,
      l: [p.name, p.address].filter(Boolean).join(' — ') || p.address || p.id
    }))];
    return `<label>Fastighet</label>
      ${CustomSelect.render('off-property',{options:opts,value:d.propertyId||'',placeholder:'— Ingen specifik fastighet —',searchable:props.length>5,onchange:"OffersPage._wizardData.propertyId=this.value"})}`;
  },

  /* ── Snabbskapa ny kund ─── */
  _quickNewCustomer() {
    const body = `
      <p style="font-size:12px;color:var(--mt);margin:0 0 14px;">Kunden skapas direkt och väljs automatiskt på offerten.</p>
      <div class="fg"><label>Namn / Företag <span style="color:var(--rd)">*</span></label>
        <input id="qcu-name" placeholder="Förnamn Efternamn eller Företagsnamn AB"></div>
      <div class="g2">
        <div class="fg"><label>Telefon</label><input id="qcu-phone" placeholder="070-xxx xx xx"></div>
        <div class="fg"><label>E-post</label><input id="qcu-email" type="email" placeholder="namn@exempel.se"></div>
      </div>
      <div class="fg"><label>Gatuadress</label><input id="qcu-addr" placeholder="Storgatan 1"
        autocomplete="off"
        oninput="AddressService.handleInput(this)"
        onblur="setTimeout(()=>AddressService.hideSuggestions(),150)"
        data-addr-zip="qcu-zip" data-addr-city="qcu-city"></div>
      <div class="g2">
        <div class="fg"><label>Postnummer</label><input id="qcu-zip" placeholder="123 45"></div>
        <div class="fg"><label>Stad</label><input id="qcu-city" placeholder="Stockholm"></div>
      </div>`;
    Modal.open({
      title: ic('user-plus',14) + ' Skapa ny kund',
      body,
      buttons: [
        { label: 'Skapa & välj', cls: 'btn bp', onClick: () => {
          const name = document.getElementById('qcu-name')?.value.trim();
          if (!name) { showToast('Namn krävs'); return; }
          const cu = CustomerService.create({
            name, phone: document.getElementById('qcu-phone')?.value.trim()||'',
            email: document.getElementById('qcu-email')?.value.trim()||'',
            address: document.getElementById('qcu-addr')?.value.trim()||'',
            zip: document.getElementById('qcu-zip')?.value.trim()||'',
            city: document.getElementById('qcu-city')?.value.trim()||'',
            type: 'privat', status: 'aktiv'
          });
          this._wizardData.customerId = cu.id;
          Modal.close();
          this._rerender();
          /* V48B4A.1: programmatisk mutation, inget input/change-event
             uppstår på #off-wizard för den delegerade draft-lyssnaren att
             fånga — måste flushas explicit. No-op om draft-läge inte är
             aktivt (kontextuell/edit), se _flushDraftNow(). */
          this._flushDraftNow();
          showToast(name + ' skapad och vald');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('qcu-name')?.focus(), 80);
  },

  /* Rabattkontrollen visas bara när offerten har ett engångsbelopp. Ritas
     om från _refreshTotals() när det läget ändras — tidigare beräknades det
     bara när steg 2 först ritades (innan någon rad fanns), så en ny offert
     fick aldrig rabattfältet och texten påstod felaktigt att engångsbelopp
     saknades. */
  _discountAreaHtml() {
    const discType = this._discount?.type || 'percent';
    const discVal  = this._discount?.value || 0;
    const _discTot = _offerCalcTotals({ lines: this._editLines, extras: this._editExtras, discount: this._discount });
    const hasOneTimeForDiscount = _discTot.rawExVat > 0 || discVal > 0;
    const discountLabel = _discTot.recurringMonthlyExVat ? 'Rabatt på engångsbelopp' : 'Rabatt';
    return hasOneTimeForDiscount ? `
          <div class="off-discount-ctrl">
            <label>${discountLabel}</label>
            <div class="off-discount-ctrl-row">
              <select id="off-disc-type" class="off-discount-ctrl-type"
                onchange="OffersPage._discount.type=this.value;OffersPage._refreshTotals()">
                <option value="percent"${discType==='percent'?' selected':''}>%</option>
                <option value="fixed"${discType==='fixed'?' selected':''}>kr</option>
              </select>
              <input type="number" id="off-disc-val" value="${discVal}" min="0" step="1" placeholder="0"
                class="off-discount-ctrl-value"
                oninput="OffersPage._discount.value=parseFloat(this.value)||0;OffersPage._refreshTotals()">
            </div>
          </div>` : `<div class="off-discount-ctrl-hint" style="font-size:11px;color:var(--mt);margin-top:8px;">Ingen rabatt-kontroll visas — offerten har inget engångsbelopp att rabattera på (rabatt gäller endast engångsbelopp, ej återkommande/rörliga priser).</div>`;
  },

  /* ── Steg 2: Tjänster & priser ─── */
  _step2Html() {
    /* OFFER CORE R1.1 — BLOCKER 7: rabatten gäller endast engångsbeloppet
       (_discountAreaHtml döljer kontrollen när inget engångsbelopp finns). */
    return `
      <div class="off-wiz-s2">
        <div class="off-wiz-s2-lines">
          <div class="offw-sec-h"><h3>Lägg till på offerten</h3><span class="offw-help">Alla priser anges exkl. moms</span></div>
          <div class="off-action-cards off-action-cards--desktop offw-add">
            <button type="button" class="off-action-card" onclick="OffersPage._openSvcCalc(null)">
              <span class="off-action-card-icon">${ic('zap',16)}</span>
              <div><div class="off-action-card-title">Tjänst / kalkyl</div><div class="off-action-card-sub">VIFT:s prismodell</div></div>
            </button>
            <button type="button" class="off-action-card" onclick="OffersPage._addFixedLine()">
              <span class="off-action-card-icon">${ic('tag',16)}</span>
              <div><div class="off-action-card-title">Fastpris</div><div class="off-action-card-sub">Eget fast pris</div></div>
            </button>
            <button type="button" class="off-action-card" onclick="OffersPage._addManualLine()">
              <span class="off-action-card-icon">${ic('plus',16)}</span>
              <div><div class="off-action-card-title">Löpande rad</div><div class="off-action-card-sub">Antal × à-pris</div></div>
            </button>
            <button type="button" class="off-action-card" onclick="OffersPage._addTextBlock()">
              <span class="off-action-card-icon">${ic('align-left',16)}</span>
              <div><div class="off-action-card-title">Fritext</div><div class="off-action-card-sub">Info utan pris</div></div>
            </button>
            <button type="button" class="off-action-card" onclick="OffersPage._addExtraAndShow()">
              <span class="off-action-card-icon">${ic('plus-circle',16)}</span>
              <div><div class="off-action-card-title">Tillval</div><div class="off-action-card-sub">Valfri extratjänst</div></div>
            </button>
          </div>
          <button type="button" class="off-add-work-btn" onclick="OffersPage._openAddWorkSheet()">
            ${ic('plus',16)} Lägg till arbete
          </button>
          <div class="offw-sec-h"><h3>Offertrader</h3><span class="offw-help">Ordningen här är ordningen på offerten</span></div>
          <div id="off-lines">${this._linesHtml()}</div>
          <section class="offw-extras" id="offw-extras">
            <div class="offw-sec-h"><h3>${ic('plus-circle',15)} Tillval</h3><span class="offw-help">Valfria extratjänster. Avmarkera "I totalsumman" om kunden väljer själv.</span></div>
            <div id="off-extras">${this._extrasInnerHtml()}</div>
            <button type="button" class="btn bs bsm offw-add-extra" onclick="OffersPage._addExtra()">${ic('plus',13)} Lägg till tillval</button>
          </section>
        </div>
        <div class="off-wiz-s2-summ">
          <div id="off-totals-bar">${this._totalsBarHtml()}</div>
          <div id="off-discount-area">${this._discountAreaHtml()}</div>
        </div>
      </div>`;
  },

  /* Lägg till ett tillval och visa tillvalssektionen (ingång från korten). */
  _addExtraAndShow() {
    this._addExtra();
    const sec = document.getElementById('offw-extras');
    if (sec && sec.scrollIntoView) sec.scrollIntoView({ block: 'nearest' });
    setTimeout(() => {
      const inputs = document.querySelectorAll('#off-extras .off-extra-desc');
      if (inputs.length) inputs[inputs.length - 1].focus();
    }, 30);
  },

  /* ── Steg 3: Villkor ─── */
  _step3Html() {
    const d   = this._wizardData;
    const esc = s => (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return `
      <div class="offw-s3">
        <section class="card offw-card">
          <div class="card-header"><h3>${ic('receipt',15)} Offertvillkor</h3></div>
          <div class="card-body">
            <div class="g2">
              <div class="fg"><label for="off-payment">Betalningsvillkor</label>
                <input id="off-payment" value="${esc(d.paymentTerms)}" placeholder="T.ex. 30 dagar netto"
                  oninput="OffersPage._wizardData.paymentTerms=this.value"></div>
              <div class="fg"><label for="off-validity">Offertens giltighetstid</label>
                <input id="off-validity" value="${esc(d.validityText)}" placeholder="T.ex. 30 dagar"
                  oninput="OffersPage._wizardData.validityText=this.value"></div>
            </div>
            <div class="fg">
              <label for="off-terms">Allmänna villkor</label>
              <textarea id="off-terms" rows="7" placeholder="Allmänna villkor…"
                oninput="OffersPage._wizardData.generalTerms=this.value">${esc(d.generalTerms)}</textarea>
            </div>
          </div>
        </section>
        <section class="card offw-card">
          <div class="card-header"><h3>${ic('lock',15)} Intern anteckning</h3><span class="offw-opt">Visas inte för kunden</span></div>
          <div class="card-body">
            <textarea id="off-note" rows="3" placeholder="T.ex. kontaktperson, nyckelhämtning…" aria-label="Intern anteckning"
              oninput="OffersPage._wizardData.internalNote=this.value">${esc(d.internalNote)}</textarea>
          </div>
        </section>
        <section class="card offw-card">
          <div class="card-body">${this._sectionOrderHtml()}</div>
        </section>
      </div>`;
  },

  /* ── Steg 4: Granska & spara ─── */
  /* Visar EXAKT det som sparas: samma rensning av tomma rader som _save()
     (_cleanLines/_linesForSave) och samma rendering som offertdetaljen
     (OfferDetailPage._linesTableHtml/_totalsRowsHtml) — alla belopp ur
     OfferCalc. Varje del har "Ändra" som hoppar till rätt steg. */
  _step4Html() {
    const off = this._draftOfferObject();
    const d = this._wizardData;
    const cu = getCu(d.customerId);
    const issues = this._reviewIssues(off, cu);
    const edit = (n) => `<button type="button" class="btn bghost bsm offw-edit" onclick="OffersPage._goStep(${n})">${ic('pencil',13)} Ändra</button>`;
    const kv = (k, v) => (v ? `<div><dt>${k}</dt><dd>${v}</dd></div>` : '');
    const prop = d.propertyId ? (state.properties || []).find(p => p.id === d.propertyId) : null;
    const propTxt = prop ? ([prop.name, prop.address].filter(Boolean).join(' — ') || prop.id) : '';
    const rt = (v) => OfferDetailPage._renderText(v);
    const nPriced = off.lines.filter(l => l.type !== 'text').length;
    const nText = off.lines.length - nPriced;
    const order = _resolveSectionOrder(this._editSectionOrder).map(k => this._sectionLabels[k] || k);
    return `
      <div class="offw-review">
        <div class="offw-rv-intro">
          <h3>Granska offerten innan du sparar</h3>
          <p>Så här blir offerten. Beloppen är exakt de som sparas och visas för kunden.</p>
        </div>
        ${issues.length ? `<div class="offw-issues">${issues.map(i => `<div class="offd-hint is-${i.tone}">${ic(i.tone === 'danger' ? 'alert-circle' : (i.tone === 'warn' ? 'alert-triangle' : 'info'), 14)}<span>${esc(i.text)}</span></div>`).join('')}</div>` : ''}
        <section class="card offd-card">
          <div class="card-header"><h3>${ic('user',15)} Kund och uppdrag</h3>${edit(1)}</div>
          <div class="card-body">
            <dl class="offd-facts offw-rv-facts">
              ${kv('Kund', cu ? esc(CustomerService.displayName(cu)) + ' <span class="offd-cutype">' + esc(CustomerService.typeLabel(cu.type)) + '</span>' : '<span class="offd-warn">Ingen kund vald</span>')}
              ${kv('Fastighet', esc(propTxt))}
              ${kv('Rubrik', d.title ? esc(d.title) : '<span class="offd-warn">Ingen rubrik</span>')}
              ${kv('Offertdatum', d.date ? fmtDate(d.date) : '')}
              ${kv('Giltig till', d.validUntil ? fmtDate(d.validUntil) : '')}
            </dl>
            ${(d.summary || d.scope || d.includes || d.excludes) ? `<div class="offd-desc offw-rv-desc">
              ${d.summary ? `<div class="offd-field"><div class="offd-field-l">Sammanfattning</div><div class="offd-field-v off-rt">${rt(d.summary)}</div></div>` : ''}
              ${d.scope ? `<div class="offd-field"><div class="offd-field-l">Uppdragets omfattning</div><div class="offd-field-v off-rt">${rt(d.scope)}</div></div>` : ''}
              ${(d.includes || d.excludes) ? `<div class="offd-incl">
                ${d.includes ? `<div class="offd-incl-col is-in"><div class="offd-field-l">${ic('check',13)} Ingår</div><div class="offd-field-v off-rt">${rt(d.includes)}</div></div>` : ''}
                ${d.excludes ? `<div class="offd-incl-col is-out"><div class="offd-field-l">${ic('x',13)} Ingår ej</div><div class="offd-field-v off-rt">${rt(d.excludes)}</div></div>` : ''}
              </div>` : ''}
            </div>` : `<p class="offd-muted offw-rv-none">Ingen uppdragsbeskrivning.</p>`}
          </div>
        </section>
        <section class="card offd-card offd-content offw-rv-content">
          <div class="card-header"><h3>${ic('file-text',15)} Offertinnehåll <span class="bdg bdg-grey">${nPriced} ${nPriced === 1 ? 'prisrad' : 'prisrader'}${nText ? ' · ' + nText + ' textblock' : ''}${off.extras.length ? ' · ' + off.extras.length + ' tillval' : ''}</span></h3>${edit(2)}</div>
          ${OfferDetailPage._linesTableHtml(off, { idp: 'rv' })}
          ${OfferDetailPage._totalsRowsHtml(off)}
        </section>
        <section class="card offd-card">
          <div class="card-header"><h3>${ic('receipt',15)} Villkor</h3>${edit(3)}</div>
          <div class="card-body">
            <dl class="offd-facts offw-rv-facts">
              ${kv('Betalningsvillkor', esc(d.paymentTerms))}
              ${kv('Giltighetstid', esc(d.validityText))}
              ${kv('Ordning på offerten', esc(order.join(' → ')))}
            </dl>
            ${d.generalTerms ? `<div class="offd-field offw-rv-terms"><div class="offd-field-l">Allmänna villkor</div><p class="offd-terms">${esc(d.generalTerms)}</p></div>` : ''}
            ${d.internalNote ? `<div class="offd-note">${ic('lock',14)}<div><strong>Intern anteckning (visas inte för kunden)</strong><span>${esc(d.internalNote)}</span></div></div>` : ''}
          </div>
        </section>
      </div>`;
  },

  /* Kontroller i granskningssteget. "danger" = sparning nekas (samma regel
     som _save(): kund, minst en prisrad, OfferCalc.validate). "warn"/"info"
     = information, påverkar inte sparningen. Inga nya affärsregler. */
  _reviewIssues(off, cu) {
    const out = [];
    const d = this._wizardData;
    if (!cu) out.push({ tone: 'danger', text: 'Ingen kund är vald — välj kund i steg 1.' });
    if (!off.lines.some(l => l.type !== 'text')) out.push({ tone: 'danger', text: 'Offerten saknar prisrader — lägg till minst en i steg 2.' });
    if (typeof OfferCalc !== 'undefined' && OfferCalc.validate) {
      const v = OfferCalc.validate(off);
      v.issues.forEach(i => out.push({ tone: 'danger', text: i.message }));
    }
    if (!d.title) out.push({ tone: 'warn', text: 'Offerten saknar rubrik — kunden ser då bara offertnumret.' });
    if (cu && !cu.email) out.push({ tone: 'warn', text: 'Kunden saknar e-postadress. Lägg till den på kundkortet innan offerten skickas via e-post.' });
    if (d.validUntil && d.date && d.validUntil < d.date) out.push({ tone: 'warn', text: '"Giltig till" ligger före offertdatum.' });
    const T = _offerCalcTotals(off);
    if (cu && T.rutRotAmount > 0) {
      const norm = (CustomerService.normalizeType ? CustomerService.normalizeType(cu.type) : cu.type) || '';
      if (norm && norm !== 'privat') out.push({ tone: 'warn', text: 'Offerten har RUT/ROT-avdrag men kunden är registrerad som ' + CustomerService.typeLabel(cu.type) + '. Avdraget förutsätter att köparen har rätt till skattereduktion — kontrollera.' });
    }
    const dec = _offAOConversionDecision(off);
    if (!dec.allowed && (dec.reason === 'mixed-vat' || dec.reason === 'non-25-vat')) {
      const rates = (typeof OfferCalc !== 'undefined' ? OfferCalc.vatRatesInTotal(off) : []).map(r => _offPct(r)).join(' / ');
      out.push({ tone: 'info', text: 'Offerten har ' + (dec.reason === 'mixed-vat' ? 'blandade momssatser (' + rates + ')' : 'momssatsen ' + rates) + '. Den kan sparas och skickas, men kan inte göras om till arbetsorder automatiskt när den godkänts.' });
    }
    return out;
  },

  /* Rader som sparas: samma rensning som _save() alltid gjort (tomma
     fastpris/löpande rader och tomma textblock tas bort). */
  _cleanLines() {
    return this._editLines.filter(l => {
      if (l.type==='text')    return (l.blockTitle||'').trim()||(l.text||'').trim();
      if (l.type==='service') return true;
      return (l.description||'').trim()||(l.unitPrice||0)>0;
    });
  },
  _cleanExtras() {
    return this._editExtras.filter(e=>(e.description||'').trim()||(e.unitPrice||0)>0);
  },
  /* OFFER CORE R1: kanonisk _lineExVat() som sparat `total` (se _save()). */
  _linesForSave(cleanLines) {
    return cleanLines.map(l => (l.type==='service'||l.type==='text') ? {...l} : {...l, total: _lineExVat(l)});
  },
  _draftOfferObject() {
    const d = this._wizardData;
    return {
      id: this._editOfferId || 'NY', customerId: d.customerId || '', propertyId: d.propertyId || '', title: d.title || '',
      summary: d.summary || '', scope: d.scope || '', includes: d.includes || '', excludes: d.excludes || '',
      lines: this._linesForSave(this._cleanLines()), extras: this._cleanExtras(),
      discount: this._discount || { type: 'percent', value: 0 },
      validUntil: d.validUntil || '', paymentTerms: d.paymentTerms || '', validityText: d.validityText || '',
      generalTerms: d.generalTerms || '', internalNote: d.internalNote || '',
      sectionOrder: _resolveSectionOrder(this._editSectionOrder)
    };
  },

  /* Livesummering (steg 2): priserade rader i offertens ordning + samma
     summering som detaljvyn (exkl. moms, rabatt, moms per sats, inkl. moms,
     RUT/ROT). Uppdateras direkt vid varje ändring (_refreshTotals och den
     delegerade input-lyssnaren i _showWizard). */
  _totalsBarHtml() {
    const off = { lines: this._editLines, extras: this._editExtras, discount: this._discount };
    const priced = this._editLines.filter(l => l.type !== 'text');
    const nEx = this._editExtras.length;
    const items = priced.map(l => {
      const bt = l.billingType || 'onetime';
      const name = l.type === 'service' ? (l.templateName || 'Tjänst') : (l.description || (l.type === 'fixed' ? 'Fastpris' : 'Löpande rad'));
      const amount = bt === 'rate' ? this._billingPriceLabelHtml(l, 0) : (this._billingPriceLabelHtml(l, _lineExVat(l)));
      return `<li class="offw-sum-li${bt !== 'onetime' ? ' is-' + bt : ''}"><span class="offw-sum-ln">${esc(name)}</span><span class="offw-sum-la">${amount}</span></li>`;
    }).join('');
    return `<div class="off-totals-card offw-sum">
      <div class="off-totals-card-hd offw-sum-hd"><span>Sammanfattning</span><span class="offw-sum-n">${priced.length} ${priced.length === 1 ? 'prisrad' : 'prisrader'}${nEx ? ' · ' + nEx + ' tillval' : ''}</span></div>
      <div class="off-totals-card-body offw-sum-body">
        ${items ? `<ul class="offw-sum-lines" aria-label="Prisrader, exkl. moms">${items}</ul>` : ''}
        ${OfferDetailPage._totalsRowsHtml(off, { compact: true })}
      </div>
    </div>`;
  },

  _refreshSummaryOnly() {
    const bar = document.getElementById('off-totals-bar');
    if (bar) bar.innerHTML = this._totalsBarHtml();
    const mobileBar = document.getElementById('off-mobile-totals');
    if (mobileBar) mobileBar.innerHTML = this._mobileTotalsHtml();
  },

  _scheduleSummaryRefresh() {
    clearTimeout(this._sumTimer);
    this._sumTimer = setTimeout(() => this._refreshSummaryOnly(), 120);
  },

  /* ── Stegnavigering ─── */
  _captureStepFields() {
    if (this._wizardStep === 1) {
      const v = document.getElementById('off-cu')?.value;
      if (v) this._wizardData.customerId = v;
    }
    if (this._wizardStep === 3) {
      const map = {'off-payment':'paymentTerms','off-validity':'validityText','off-terms':'generalTerms','off-note':'internalNote'};
      Object.entries(map).forEach(([id,key]) => {
        const el = document.getElementById(id);
        if (el) this._wizardData[key] = el.value;
      });
    }
  },

  /* Valideringen per steg — samma krav som tidigare: kund (steg 1) och
     minst en prisrad (steg 2). */
  _stepError(n) {
    if (n === 1 && !this._wizardData.customerId) return 'Välj en kund för att gå vidare.';
    if (n === 2 && !this._editLines.some(l => l.type !== 'text')) return 'Lägg till minst en prisrad (tjänst, fastpris eller löpande rad) för att gå vidare.';
    return '';
  },

  _renderStepMsg() {
    const el = document.getElementById('offw-msg');
    if (!el) return;
    el.innerHTML = this._stepMsg ? ic('alert-circle',15) + '<span>' + esc(this._stepMsg) + '</span>' : '';
    el.hidden = !this._stepMsg;
  },

  _goStep(n) {
    const max = this._WIZ_STEPS.length;
    n = Math.max(1, Math.min(max, Number(n) || 1));
    const cur = this._wizardStep;
    if (n === cur) return;
    this._captureStepFields();
    if (n > cur) {
      for (let s = cur; s < n; s++) {
        const err = this._stepError(s);
        if (err) {
          this._stepMsg = err;
          if (s !== cur) { this._wizardStep = s; this._rerender(); } else this._renderStepMsg();
          showToast(err);
          return;
        }
      }
    }
    this._wizardStep = n;
    this._stepMsg = '';
    this._rerender();
    this._flushDraftNow();
  },

  _nextStep() { this._goStep(this._wizardStep + 1); },
  _prevStep() { this._goStep(this._wizardStep - 1); },

  /* ── Line card HTML ─── */
  _linesHtml() {
    if (!this._editLines.length) return `
      <div class="off-lines-empty">
        <div class="off-lines-empty-icon">${ic('file-text',22)}</div>
        <div class="off-lines-empty-txt">Inga rader ännu</div>
        <div class="off-lines-empty-sub">Lägg till ett arbete ovan</div>
      </div>`;
    const n = this._editLines.length;
    return this._editLines.map((l, i) => {
      let cardHtml;
      if (l.type === 'text')    cardHtml = this._renderTextCard(l, i);
      else if (l.type === 'service') cardHtml = this._renderServiceCard(l, i);
      else if (l.type === 'fixed')   cardHtml = this._renderFixedCard(l, i);
      else cardHtml = this._renderManualCard(l, i);
      return this._wrapLineReorder(cardHtml, i, n);
    }).join('');
  },

  /* V48B5 R3 §1-4: RADORDNING (LEVEL 2) — helt separat från
     off.sectionOrder (LEVEL 1, de fyra stora blocken). Alla fyra
     radtyper (service/fixed/manual/text) omsluts av SAMMA generiska
     omslag istället för att varje _render*Card()-funktion skulle
     behöva sin egen dupplicerade dra/pil-uppmärkning. `draggable` sätts
     ENDAST på det lilla drag-handtaget — inte hela raden — så att
     textmarkering/inmatning i kortets fält inte störs (desktop). Mobil
     använder ALLTID de explicita pilknapparna, aldrig HTML5 drag/drop.
     _editLines-arrayens ordning ÄR den sparade radordningen — inget
     nytt ordningsfält. */
  _wrapLineReorder(cardHtml, i, total) {
    return `<div class="off-line-reorder-row" data-idx="${i}"
        ondragover="event.preventDefault()"
        ondrop="event.preventDefault();OffersPage._lineDrop(${i})">
      <div class="off-line-reorder-controls">
        <span class="off-line-reorder-handle" draggable="true" aria-hidden="true"
          ondragstart="OffersPage._lineDragIdx=${i}">⋮⋮</span>
        <button type="button" class="off-line-reorder-btn" ${i===0?'disabled':''}
          onclick="OffersPage._moveLine(${i},-1)" aria-label="Flytta raden upp">${ic('chevron-up',12)}</button>
        <button type="button" class="off-line-reorder-btn" ${i===total-1?'disabled':''}
          onclick="OffersPage._moveLine(${i},1)" aria-label="Flytta raden ner">${ic('chevron-down',12)}</button>
      </div>
      <div class="off-line-reorder-content">${cardHtml}</div>
    </div>`;
  },

  _moveLine(index, delta) {
    const j = index + delta;
    if (j < 0 || j >= this._editLines.length) return;
    const tmp = this._editLines[index];
    this._editLines[index] = this._editLines[j];
    this._editLines[j] = tmp;
    const el = document.getElementById('off-lines');
    if (el) el.innerHTML = this._linesHtml();
    this._flushDraftNow();
  },

  _lineDrop(targetIdx) {
    const from = this._lineDragIdx;
    this._lineDragIdx = null;
    if (from == null || from === targetIdx) return;
    const moved = this._editLines.splice(from, 1)[0];
    this._editLines.splice(targetIdx, 0, moved);
    const el = document.getElementById('off-lines');
    if (el) el.innerHTML = this._linesHtml();
    this._flushDraftNow();
  },

  _renderServiceCard(l, i) {
    const exVat  = l.exVat || 0;
    const vat    = Math.round(exVat * _normVat(l.vatRate) / 100);
    const incVat = exVat + vat;
    const rutAmt = l.rutAmount || 0;
    const cust   = incVat - rutAmt;
    return `<div class="off-svc-card">
      <div class="off-svc-card-hd">
        <div class="off-svc-card-hd-main">
          <div class="off-svc-card-title">${esc(l.templateName||'Tjänst')}</div>
          <div class="off-svc-card-meta">${ic('zap',9)} Tjänst</div>
          ${l.calculationNote ? `<div class="off-svc-card-sub off-svc-card-sub--tight">Prisnivå: ${esc(String(l.calculationNote).replace('Prisnivå: ',''))}</div>` : ''}
          ${(l.subLines||[]).map(sl=>`<div class="off-svc-card-sub">${esc(sl.desc)} · ${esc(sl.qty)} ${esc(sl.unit)} × ${fmt(sl.price)} = <strong>${fmt(Math.round(sl.qty*sl.price))} kr</strong></div>`).join('')}
        </div>
        <div class="off-svc-card-hd-price">
          <div class="off-svc-card-price">${fmt(exVat)} kr</div>
          <div class="off-svc-card-price-sub">exkl. moms · moms ${_normVat(l.vatRate)} %</div>
          ${rutAmt ? `<div class="off-svc-card-rut">Kund betalar ${fmt(cust)} kr inkl. moms</div>` : ''}
        </div>
      </div>
      ${l.description ? `<div class="off-svc-card-desc-preview">${esc(l.description)}</div>` : ''}
      <input value="${(l.description||'').replace(/"/g,'&quot;')}" placeholder="Beskrivning på offerten…"
        class="off-svc-card-desc-input"
        oninput="OffersPage._editLines[${i}].description=this.value">
      <div class="off-svc-card-actions">
        <button type="button" class="btn bs bxs" onclick="OffersPage._openSvcCalc(${i})">${ic('pencil',10)} Redigera</button>
        <button type="button" class="btn bd bxs" onclick="OffersPage._removeLine(${i})">${ic('trash-2',10)} Ta bort</button>
      </div>
    </div>`;
  },

  /* V48B3A: kort mobil "läskort"-summering med Redigera-knapp för
     manuell/fastpris/fritext-rader — expand/collapse-state hålls i
     _expandedLineIds (per l.id), CSS avgör om summering eller editor visas
     (<1024px) medan desktop ALLTID visar editorn oförändrat (>=1024px,
     samma markup/inputs/onclick-handlers som innan B3A — bara omslutna i
     en .off-wiz-line-editor-wrapper). Ingen ny datamodell, ingen ny
     sparlogik — bara vilken DEL av samma markup som är synlig. */
  _toggleLineExpanded(id) {
    if (this._expandedLineIds.has(id)) this._expandedLineIds.delete(id);
    else this._expandedLineIds.add(id);
    const el = document.getElementById('off-lines');
    if (el) el.innerHTML = this._linesHtml();
  },

  _renderManualCard(l, i) {
    const units = ['st','tim','m','m²','m³','lm','kg','l','paket','mån'];
    const bt     = l.billingType || 'onetime';
    const total  = _lineExVat(l);   /* OFFER CORE R1: 0 för rate/option — se _lineExVat() */
    const incVat = total + Math.round(total * _normVat(l.vatRate) / 100);
    const rutAmt = _effectiveRutAmount(l);
    const cust   = incVat - rutAmt;
    const curRed = l.reductionType || 'ingen';
    const base   = Math.max(0, Math.min(+l.reductionBaseExVat || 0, total));
    const eligibleInclVat = base + Math.round(base * _normVat(l.vatRate) / 100);
    const expanded = this._expandedLineIds.has(l.id);
    const qtyMeta = (bt==='rate') ? '' : `${l.qty!=null?l.qty:1} ${esc(l.unit||'st')} × ${fmt(l.unitPrice||0)} kr`;
    /* OFFER CORE R1.6.6 — ITEM 4: the badge only moves into the secondary
       meta line when the title is a REAL description — if there's no
       description, the title itself already IS the billing-type label
       (see _billingTypeRowLabel above), so showing the badge too would
       just duplicate the same word again (the exact issue R1.6.5 already
       avoided by suppressing the badge in that case — preserved here,
       just relocated out of the title so a long real description can
       wrap to two lines without a badge competing inline with it). */
    const hasRealDesc = !!esc(l.description);
    /* bt==='rate' leaves qtyMeta empty (no committed qty×price makes
       sense for a rate line) — show "Moms X%" there instead, same
       secondary-meta pattern the fixed-price card already uses, so a
       rate row reads "Rörligt à-pris · Moms 25 %" instead of a bare
       badge with nothing after it. */
    const metaText = qtyMeta || `Moms ${_normVat(l.vatRate)}%`;
    const summary = `<div class="off-wiz-line-summary">
        <div class="off-wiz-line-summary-icon">${ic('minus',14)}</div>
        <div class="off-wiz-line-summary-body">
          <div class="off-wiz-line-summary-title">${hasRealDesc ? esc(l.description) : this._billingTypeRowLabel(l, 'Löpande rad')}</div>
          <div class="off-wiz-line-summary-meta">${hasRealDesc && this._billingTypeBadgeHtml(l) ? this._billingTypeBadgeHtml(l) + ' · ' : ''}${metaText}${rutAmt?` · ${curRed==='rot'?'ROT':'RUT'}-avdrag`:''}</div>
        </div>
        <div class="off-wiz-line-summary-price">${this._billingPriceLabelHtml(l, total)}</div>
      </div>
      <div class="off-wiz-line-summary-actions">
        <button type="button" class="off-wiz-line-summary-edit" onclick="OffersPage._toggleLineExpanded('${l.id}')">${ic('pencil',11)} Redigera</button>
        <button type="button" class="off-wiz-line-summary-remove" onclick="OffersPage._removeLine(${i})">${ic('trash-2',11)} Ta bort</button>
      </div>`;
    const redOpts = [
      {v:'ingen', l:'Ingen reduktion'},
      {v:'rut',   l:'RUT – 50 %'},
      {v:'rot',   l:'ROT – 30 %'},
    ];
    const editor = `<div class="off-wiz-line-editor">
      <div class="off-wiz-line-card-hd">
        <span class="off-wiz-line-card-type">${ic('minus',9)} ${this._billingTypeRowLabel(l, 'Manuell rad')}</span>
        <div class="off-wiz-line-card-spacer"></div>
        <strong class="off-wiz-line-card-total" id="off-lt-${i}">${this._billingPriceLabelHtml(l, total)}</strong>
        <button type="button" class="btn bs bxs off-wiz-line-editor-done" onclick="OffersPage._toggleLineExpanded('${l.id}')">${ic('check',10)} Klar</button>
        <button type="button" class="btn bd bxs" onclick="OffersPage._removeLine(${i})">${ic('x',10)}</button>
      </div>
      <input value="${(l.description||'').replace(/"/g,'&quot;')}" placeholder="Benämning" class="off-wiz-line-field-desc"
        oninput="OffersPage._editLines[${i}].description=this.value">
      <div class="off-wiz-line-manual-grid">
        <div><label class="off-wiz-line-field-label">Antal</label>
          <input type="number" value="${l.qty!=null?l.qty:1}" min="0" step="0.5"
            oninput="OffersPage._editLines[${i}].qty=parseFloat(this.value)||0;OffersPage._refreshTotals()"></div>
        <div><label class="off-wiz-line-field-label">Enhet</label>
          <select onchange="OffersPage._editLines[${i}].unit=this.value;OffersPage._refreshTotals();document.getElementById('off-lines').innerHTML=OffersPage._linesHtml();">
            ${units.map(u=>`<option${(l.unit||'st')===u?' selected':''}>` + u + `</option>`).join('')}
          </select></div>
        <div><label class="off-wiz-line-field-label">À-pris exkl. moms (kr)</label>
          <input type="text" inputmode="decimal" class="off-money-input" value="${_formatMoneyInput(l.unitPrice||0)}"
            oninput="OffersPage._editLines[${i}].unitPrice=_parseMoneyInput(this.value);OffersPage._refreshTotals()"
            onblur="this.value=_formatMoneyInput(OffersPage._editLines[${i}].unitPrice||0)"></div>
        <div><label class="off-wiz-line-field-label">Moms</label>
          <select onchange="OffersPage._editLines[${i}].vatRate=Number(this.value);OffersPage._refreshTotals()">
            ${this._vatOptionsHtml(_normVat(l.vatRate))}
          </select></div>
      </div>
      <div class="off-wiz-line-manual-grid off-wiz-line-billing-grid">
        <div><label class="off-wiz-line-field-label">Prissemantik</label>
          <select onchange="OffersPage._setLineBillingType(${i}, this.value);"
            title="Styr om priset ingår i offertens totalsumma">
            ${this._billingTypeOptionsHtml(bt)}
          </select></div>
      </div>
      ${bt==='recurring' ? `<div class="off-wiz-line-field-hint off-wiz-line-field-hint--neutral">Ingår i offertens återkommande månads-/årssumma, INTE i den vanliga totalsumman.</div>` : ''}
      ${(bt==='rate') ? `<div class="off-wiz-line-field-hint off-wiz-line-field-hint--neutral">Visas på offerten (t.ex. "${fmt(l.unitPrice||0)} kr/${esc(l.unit||'enhet')}") men ingår aldrig i någon totalsumma.</div>` : ''}
      ${bt==='onetime' ? `<div class="off-svc-reduction off-svc-reduction--line">
        <label class="off-svc-field-label--sub">Skattereduktion</label>
        <div class="off-svc-reduction-row">
          ${redOpts.map(o=>`<button type="button" class="off-svc-reduction-btn${curRed===o.v?' is-selected':''}"
            onclick="OffersPage._setLineReduction(${i},'${o.v}')">${o.l}</button>`).join('')}
        </div>
        <div class="off-svc-reduction-hint">Förutsätter att kunden har rätt till avdraget</div>
      </div>
      ${curRed !== 'ingen' ? `<div class="off-wiz-line-field" style="margin-top:8px;">
        <label class="off-wiz-line-field-label">Arbetskostnad för ROT/RUT, exkl. moms</label>
        <input type="text" inputmode="decimal" class="off-money-input" id="off-lredbase-${i}" value="${_formatMoneyInput(base)}"
          oninput="OffersPage._setLineReductionBase(${i}, this.value)"
          onblur="this.value=_formatMoneyInput(OffersPage._editLines[${i}].reductionBaseExVat||0)">
        <div class="off-wiz-line-field-hint">Endast arbetskostnaden får ligga till grund för avdraget.</div>
        <div class="off-wiz-line-field-hint off-wiz-line-field-hint--neutral" id="off-lredhint-${i}"${base?' style="display:none;"':''}>Ange arbetskostnaden för att beräkna avdraget.</div>
      </div>` : ''}
      <div class="off-line-reduction-calc" id="off-lredcalc-${i}"${rutAmt?'':' style="display:none;"'}>
        <div class="off-line-reduction-calc-row"><span>Avdragsgrundande arbetskostnad inkl. moms</span><span id="off-leligincl-${i}">${fmt(eligibleInclVat)} kr</span></div>
        <div class="off-line-reduction-calc-row"><span>Preliminärt ${curRed==='rot'?'ROT':'RUT'}-avdrag</span><span id="off-lrutamt-${i}">−${fmt(rutAmt)} kr</span></div>
        <div class="off-line-reduction-calc-row off-line-reduction-calc-row--total"><span>Kund betalar</span><span id="off-lcustpay-${i}">${fmt(cust)} kr</span></div>
      </div>` : ''}
    </div>`;
    return `<div class="off-wiz-line-card" data-expanded="${expanded?'1':'0'}">${summary}${editor}</div>`;
  },

  _renderTextCard(l, i) {
    const expanded = this._expandedLineIds.has(l.id);
    const preview = (l.text||'').slice(0, 80) + ((l.text||'').length > 80 ? '…' : '');
    const summary = `<div class="off-wiz-line-summary">
        <div class="off-wiz-line-summary-icon">${ic('align-left',14)}</div>
        <div class="off-wiz-line-summary-body">
          <div class="off-wiz-line-summary-title">${esc(l.blockTitle)||'Fritextblock'}</div>
          ${preview ? `<div class="off-wiz-line-summary-meta">${esc(preview)}</div>` : ''}
        </div>
      </div>
      <div class="off-wiz-line-summary-actions">
        <button type="button" class="off-wiz-line-summary-edit" onclick="OffersPage._toggleLineExpanded('${l.id}')">${ic('pencil',11)} Redigera</button>
        <button type="button" class="off-wiz-line-summary-remove" onclick="OffersPage._removeLine(${i})">${ic('trash-2',11)} Ta bort</button>
      </div>`;
    const editor = `<div class="off-wiz-line-editor">
      <div class="off-wiz-line-card-hd">
        <span class="off-wiz-line-card-type">${ic('align-left',9)} Fritextblock</span>
        <div class="off-wiz-line-card-spacer"></div>
        <button type="button" class="btn bs bxs off-wiz-line-editor-done" onclick="OffersPage._toggleLineExpanded('${l.id}')">${ic('check',10)} Klar</button>
        <button type="button" class="btn bd bxs" onclick="OffersPage._removeLine(${i})">${ic('x',10)}</button>
      </div>
      <input value="${(l.blockTitle||'').replace(/"/g,'&quot;')}" placeholder="Rubrik (t.ex. Förutsättningar)" class="off-wiz-line-field-title"
        oninput="OffersPage._editLines[${i}].blockTitle=this.value">
      <textarea rows="2" placeholder="Fritext som visas på offerten…"
        oninput="OffersPage._editLines[${i}].text=this.value">${esc(l.text||'')}</textarea>
    </div>`;
    return `<div class="off-wiz-line-card off-wiz-line-card--text" data-expanded="${expanded?'1':'0'}">${summary}${editor}</div>`;
  },

  /* ── Extras ─── */
  _extrasInnerHtml() {
    const units = ['st','tim','m','m²','kg','paket'];
    if (!this._editExtras.length) return `<p class="offw-help" style="margin:0 0 4px;">Inga tillval ännu.</p>`;
    /* QA 2026-11-26: samma fält och samma inline-logik som tidigare, men
       varje fält har en synlig etikett (tidigare bara platshållare) och
       raden har en egen layout med plats för "I totalsumman". */
    return this._editExtras.map((e, i) => {
      /* OFFER CORE R1.1 — BLOCKER 1: e.includedInTotal===false betyder
         "Tillval, ej i totalsumman" — frånvarande fält (all extras-data
         från FÖRE R1.1) betyder oförändrat "ingår" (se
         _extraIncludedInTotal i PageShells-toppen). */
      const included = e.includedInTotal !== false;
      return `
      <div class="off-extra-row offw-extra-row">
        <label class="offw-xc offw-xc-desc"><span>Tillval</span><input class="off-extra-desc" value="${(e.description||'').replace(/"/g,'&quot;')}" placeholder="T.ex. Impregnering"
          oninput="OffersPage._editExtras[${i}].description=this.value"></label>
        <label class="offw-xc offw-xc-qty"><span>Antal</span><input class="off-extra-qty" type="number" value="${e.qty||1}" min="0" step="0.5"
          oninput="OffersPage._editExtras[${i}].qty=parseFloat(this.value)||0;OffersPage._refreshTotals()"></label>
        <label class="offw-xc offw-xc-unit"><span>Enhet</span><select class="off-extra-unit" onchange="OffersPage._editExtras[${i}].unit=this.value">
          ${units.map(u=>`<option${(e.unit||'st')===u?' selected':''}>` + u + `</option>`).join('')}
        </select></label>
        <label class="offw-xc offw-xc-price"><span>À-pris exkl. moms</span><input class="off-extra-price" type="number" value="${e.unitPrice||0}" min="0" step="1" placeholder="0"
          oninput="OffersPage._editExtras[${i}].unitPrice=parseFloat(this.value)||0;OffersPage._refreshTotals()"></label>
        <label class="offw-xc offw-xc-vat"><span>Moms</span><select class="off-extra-vat" onchange="OffersPage._editExtras[${i}].vatRate=Number(this.value);OffersPage._refreshTotals()">
          ${this._vatOptionsHtml(_normVat(e.vatRate))}
        </select></label>
        <label class="off-extra-included offw-xc-inc" title="Avmarkerad = visas men ingår ej i totalsumman">
          <input type="checkbox" ${included?'checked':''}
            onchange="OffersPage._editExtras[${i}].includedInTotal=this.checked;OffersPage._refreshTotals();document.getElementById('off-extras').innerHTML=OffersPage._extrasInnerHtml();OffersPage._flushDraftNow();">
          <span>I totalsumman</span>
        </label>
        <button type="button" class="off-extra-remove btn bs bsm offw-xc-rm" aria-label="Ta bort tillval" title="Ta bort tillval" onclick="OffersPage._removeExtra(${i})">${ic('trash-2',14)}</button>
      </div>`;
    }).join('');
  },

  /* V41 §1: liten delad markup-helper för momsväljaren — INGEN ny
     ekonomisk beräkning, bara HTML för <option>-listan. Samma fyra
     satser (0/6/12/25) som artikelregistret redan använder. */
  _vatOptionsHtml(selectedVat) {
    return [0,6,12,25].map(r=>`<option value="${r}" ${r===selectedVat?'selected':''}>${r}%</option>`).join('');
  },

  /* OFFER CORE R1 — l.billingType-väljare, delad mellan Fastpris- och
     Manuell-radkorten (de två radtyper där en fri prissemantik är
     meningsfull). "onetime" (frånvarande/default) bevarar EXAKT
     befintligt beteende — se _lineExVat()/_offRawExVat() för den fulla
     motiveringen. Ingen ändring av vad "type" (fixed/manual/service/
     text) betyder — detta är ett HELT SEPARAT, ortogonalt fält. */
  _billingTypeOptionsHtml(selected) {
    /* OFFER CORE R1.1 — BLOCKER 1: 'option' borttaget härifrån. VIFT:s
       kanoniska "Tillval"-koncept är off.extras[] (se _addExtra/
       _extrasInnerHtml, med e.includedInTotal för att markera en extra
       som ej committad) — inte en andra, parallell radnivå-modell. */
    const opts = [
      {v:'onetime',   l:'Engångsbelopp'},
      {v:'recurring', l:'Återkommande (per månad)'},
      {v:'rate',      l:'Rörligt à-pris'} /* OFFER CORE R1.6.3 — TEXT SIMPLIFICATION: förklaringen ("ingår ej i totalsumman") finns redan som en egen hjälptext direkt under selecten (off-wiz-line-field-hint) — själva SELECT-etiketten behöver den inte upprepa, den fick bara texten att klippas i en native <select>. Värdet 'rate' är oförändrat. */
    ];
    const cur = selected || 'onetime';
    return opts.map(o=>`<option value="${o.v}"${cur===o.v?' selected':''}>${o.l}</option>`).join('');
  },

  /* Liten, tydlig etikett i sammanfattningsraden — samma tre "icke-
     engångsbelopp"-lägen som _billingTypeOptionsHtml, plus prisets
     enhetssuffix (t.ex. "/mån", "/h") när ett sådant är satt. */
  _billingTypeBadgeHtml(l) {
    const bt = l.billingType || 'onetime';
    if (bt === 'recurring') return `<span class="bdg bdg-blue off-billing-badge">Återkommande/mån</span>`;
    if (bt === 'rate')      return `<span class="bdg bdg-orange off-billing-badge">Rörligt à-pris</span>`;
    return '';
  },

  /* OFFER CORE R1.6.1 — ITEM 3: radkortets typ-rubrik ("FASTPRIS" i
     off-svc-card-meta / "Manuell rad" i off-wiz-line-card-type) fick
     tidigare ALLTID stå kvar oavsett billingType — vilseledande för en
     recurring- eller rate-rad. Härleds nu ALLTID från l.billingType
     (aldrig från enhetstext), med baseLabel som fallback för onetime
     (bevarar exakt "Fastpris"/"Manuell rad" för all befintlig onetime-
     data, byte-kompatibelt). */
  _billingTypeRowLabel(l, baseLabel) {
    const bt = l.billingType || 'onetime';
    if (bt === 'recurring') return 'Återkommande';
    if (bt === 'rate')      return 'Rörligt pris';
    return baseLabel;
  },

  /* Prisetiketten i sammanfattningsraden — "5 750 kr/mån" för
     återkommande rader (unit visas som suffix), annars oförändrat
     "X kr". Rate/option visar radens eget belopp + valfri enhet
     (t.ex. "440 kr/h") men detta belopp räknas ALDRIG in i någon
     totalsumma (se _lineExVat()). */
  _billingPriceLabelHtml(l, amountExVat) {
    const bt = l.billingType || 'onetime';
    const unit = (l.unit || '').trim();
    if (bt === 'recurring') return `${fmt(amountExVat)} kr${unit ? '/' + esc(unit) : '/mån'}`;
    if (bt === 'rate') return `${fmt(l.unitPrice||0)} kr${unit ? '/' + esc(unit) : ''}`;
    return `${fmt(amountExVat)} kr`;
  },

  /* OFFER CORE R1.6.3 — BLOCKER 2: DISPLAY-ONLY ex-moms amount for the
     editor's informational "ex. moms · X kr inkl." sub-line — NEVER used
     for committed totals, which continue to go exclusively through the
     canonical _lineExVat()/_offerCalcTotals() chain (untouched). For
     billingType='rate', _lineExVat() correctly, intentionally returns 0
     (a rate line must never enter the committed offer total) — but that
     same 0 was then also being used as the base for the VAT-inclusive
     INFORMATIONAL price shown to the user, making a real "440 kr/h"
     rate look like "0 kr inkl." moms. This helper is the single place
     that reconciles "0 for totals" with "real money for display": for
     'rate' it uses the line's actual unitPrice (the same number
     _billingPriceLabelHtml already shows as the primary price); for
     every other billingType it is byte-identical to _lineExVat(l), so
     recurring/one-time display is completely unchanged. */
  _lineDisplayExVat(l) {
    if ((l.billingType || 'onetime') === 'rate') return +(l.unitPrice || 0);
    return _lineExVat(l);
  },

  /* OFFER CORE R1.2 — BLOCKER 1 (motbevis-granskad): en NY tillval-rad
     måste vara ej-committad by default. "Tillval" har alltid, historiskt,
     kommunicerats till kund som en valfri extratjänst — ett osäkert
     default (includedInTotal:true, R1.1) gjorde att en användare som
     klickade "Lägg till tillval" utan att märka kryssrutan tyst ökade
     kundens committade totalsumma. Historisk data (fältet helt frånvarande,
     ALL data skapad före R1.1/R1.2) påverkas INTE av detta — den vägen
     går via _extraIncludedInTotal()'s "frånvarande fält = included"-regel,
     inte via denna konstruktor. Endast NYA rader skapade FRÅN OCH MED
     R1.2 får detta säkra default; användaren kan uttryckligen kryssa i
     "I totalsumman" för att committa den. */
  _addExtra() {
    this._editExtras.push({id:'E'+Date.now(), description:'', qty:1, unit:'st', unitPrice:0, vatRate:25, includedInTotal:false});
    const el = document.getElementById('off-extras');
    if (el) el.innerHTML = this._extrasInnerHtml();
    this._flushDraftNow();
  },

  _removeExtra(idx) {
    this._editExtras.splice(idx, 1);
    const el = document.getElementById('off-extras');
    if (el) el.innerHTML = this._extrasInnerHtml();
    this._refreshTotals();
    this._flushDraftNow();
  },

  /* ── New offer helpers ─── */

  _calcDiscount(rawExVat) {
    const d = this._discount;
    if (!d || !d.value) return 0;
    if (d.type === 'percent') return Math.round(rawExVat * Math.min(d.value, 100) / 100);
    return Math.min(Math.round(d.value), rawExVat);
  },

  /* V48B5 R1 (blocker-korrigering): fastpris/manuella rader räknar INTE
     längre RUT/ROT på hela radens inkl.-moms-belopp — det inkluderade
     ev. material/övriga kostnader och gav ett osäkert avdragsunderlag.
     Kanoniskt fält `reductionBaseExVat` (numeriskt, ex. moms, satt av
     användaren, klampat till [0, radens exVat]) anger hur stor del av
     raden som faktiskt är avdragsgrundande ARBETSKOSTNAD. RUT/ROT
     räknas bara på den delen, inkl. moms:
       eligibleExVat    = clamp(reductionBaseExVat, 0, _lineExVat(l))
       eligibleInclVat  = eligibleExVat + moms på eligibleExVat
       rutAmount        = round(eligibleInclVat * 0.30|0.50)
     Tjänsterader (type:'service') är OFÖRÄNDRADE i denna korrigering —
     de fortsätter använda sitt egna, redan testade calc()-kontrakt (se
     backlog-post "Offer Tax Reduction 2.0" i rapporten för en framtida
     audit av service-mallarnas arbets/material-uppdelning). */
  _calcLineRutAmount(l) {
    if (!l || !l.reductionType || l.reductionType === 'ingen') return 0;
    const exVat = _lineExVat(l);
    const base = Math.max(0, Math.min(+l.reductionBaseExVat || 0, exVat));
    const eligibleVat = Math.round(base * _normVat(l.vatRate) / 100);
    const eligibleInclVat = base + eligibleVat;
    const rate = l.reductionType === 'rot' ? 0.30 : 0.50;
    return Math.round(eligibleInclVat * rate);
  },

  /* V48B5 R1: etiketter för de FYRA kanoniska block-ID:na i
     reorder-UI:t (se OFFER_SECTION_IDS-kommentaren för vad varje block
     innehåller). "pricing" avser HELA pris-/rad-blocket (inte
     radernas egen inbördes ordning, som fortfarande styrs av
     _editLines-arrayens ordning precis som innan). */
  _sectionLabels: {
    description: 'Uppdragsbeskrivning', pricing: 'Pris och arbeten',
    commercialTerms: 'Offertvillkor', generalTerms: 'Allmänna villkor'
  },

  _sectionOrderHtml() {
    const order = _resolveSectionOrder(this._editSectionOrder);
    this._editSectionOrder = order;
    const labels = this._sectionLabels;
    return `<div class="off-section-order" id="off-section-order-wrap">
      <label class="off-svc-field-label--sub">Ordning på offerten</label>
      <div class="off-section-order-hint">Ändra i vilken ordning avsnitten visas för kunden — dra i listan (desktop) eller använd pilarna.</div>
      <div class="off-section-order-list">
        ${order.map((id, i) => `
          <div class="off-section-order-row" draggable="true" data-idx="${i}"
            ondragstart="OffersPage._sectionDragIdx=${i}"
            ondragover="event.preventDefault()"
            ondrop="event.preventDefault();OffersPage._sectionDrop(${i})">
            <span class="off-section-order-handle" aria-hidden="true">⋮⋮</span>
            <span class="off-section-order-label">${labels[id] || id}</span>
            <div class="off-section-order-btns">
              <button type="button" class="off-section-order-btn" ${i === 0 ? 'disabled' : ''} onclick="OffersPage._moveSection(${i},-1)" aria-label="Flytta upp">${ic('chevron-up', 12)}</button>
              <button type="button" class="off-section-order-btn" ${i === order.length - 1 ? 'disabled' : ''} onclick="OffersPage._moveSection(${i},1)" aria-label="Flytta ner">${ic('chevron-down', 12)}</button>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
  },

  _moveSection(idx, dir) {
    const order = _resolveSectionOrder(this._editSectionOrder);
    const j = idx + dir;
    if (j < 0 || j >= order.length) return;
    const t = order[idx]; order[idx] = order[j]; order[j] = t;
    this._editSectionOrder = order;
    const wrap = document.getElementById('off-section-order-wrap');
    if (wrap) wrap.outerHTML = this._sectionOrderHtml();
    this._flushDraftNow();
  },

  _sectionDrop(targetIdx) {
    const from = this._sectionDragIdx;
    this._sectionDragIdx = null;
    if (from == null || from === targetIdx) return;
    const order = _resolveSectionOrder(this._editSectionOrder);
    const moved = order.splice(from, 1)[0];
    order.splice(targetIdx, 0, moved);
    this._editSectionOrder = order;
    const wrap = document.getElementById('off-section-order-wrap');
    if (wrap) wrap.outerHTML = this._sectionOrderHtml();
    this._flushDraftNow();
  },

  /* OFFER CORE R1.1 — BLOCKER 5 (motbevis-granskad): en rad som byter
     billingType BORT FRÅN 'onetime' måste omedelbart förlora sin
     RUT/ROT-reduktion — annars kan en tidigare ifylld reduktion bli
     "kvarvarande" på en recurring/rate-rad och (innan detta fixades)
     driva customerPays negativt via _offerCalcTotals. Detta är en andra,
     UI-nivå-linje av försvar utöver fail-safe-filtret i
     _offerCalcTotals självt (rutRotAmount-beräkningen där ignorerar
     numera ändå icke-onetime-rader oavsett vad som händer här) — men
     att rensa fälten direkt gör att UI:t aldrig ens VISAR en
     missvisande kvarvarande reduktion för en rad som inte längre kan ha
     en. */
  _setLineBillingType(idx, val) {
    const l = this._editLines[idx];
    if (!l) return;
    l.billingType = val;
    if (val !== 'onetime') {
      l.reductionType = 'ingen';
      l.reductionBaseExVat = 0;
      l.rutAmount = 0;
    }
    this._refreshTotals();
    const el = document.getElementById('off-lines');
    if (el) el.innerHTML = this._linesHtml();
    this._flushDraftNow();
  },

  _setLineReduction(idx, val) {
    const l = this._editLines[idx];
    if (!l) return;
    l.reductionType = val;
    /* V48B5 R2 §4 (säker default): "ingen" nollställer, OCH att välja
       ROT/RUT nollställer arbetskostnadsunderlaget också — det förifylls
       ALDRIG längre med hela radens belopp (det antog tyst att hela
       raden var avdragsgrundande arbete, en osäker default). Användaren
       måste alltid själv ange den faktiska arbetskostnaden explicit; om
       hela raden verkligen är arbete kan användaren manuellt skriva in
       samma belopp som radens ex.-moms-summa. Avdraget är 0 kr tills
       dess (giltigt sparbart tillstånd, ingen skrämmande varningsruta). */
    l.reductionBaseExVat = 0;
    l.rutAmount = this._calcLineRutAmount(l);
    const el = document.getElementById('off-lines');
    if (el) el.innerHTML = this._linesHtml();
    this._refreshTotals();
    this._flushDraftNow();
  },

  _setLineReductionBase(idx, value) {
    const l = this._editLines[idx];
    if (!l) return;
    const exVat = _lineExVat(l);
    l.reductionBaseExVat = Math.max(0, Math.min(_parseMoneyInput(value), exVat));
    l.rutAmount = this._calcLineRutAmount(l);
    this._refreshTotals();
    this._flushDraftNow();
  },

  _addFixedLine() {
    const newId = 'F'+Date.now();
    this._editLines.push({id:newId, type:'fixed', description:'', unitPrice:0, vatRate:25, reductionType:'ingen', reductionBaseExVat:0, rutAmount:0, billingType:'onetime', unit:''});
    this._expandedLineIds.add(newId);
    const el = document.getElementById('off-lines');
    if (el) el.innerHTML = this._linesHtml();
    this._refreshTotals();
    this._flushDraftNow();
    setTimeout(() => {
      const inputs = document.querySelectorAll('#off-lines .off-fixed-name');
      if (inputs.length) inputs[inputs.length-1].focus();
    }, 50);
  },

  _renderFixedCard(l, i) {
    const bt     = l.billingType || 'onetime';
    const tot    = _lineExVat(l);   /* OFFER CORE R1: 0 för rate/option — se _lineExVat() */
    /* OFFER CORE R1.6.3 — BLOCKER 2: den informativa "ex. moms · X kr
       inkl."-raden ska visa vad RADENS PRIS blir inkl. moms (även för
       rate, där tot medvetet är 0 för totalsumman) — se
       _lineDisplayExVat(). committedExVat behåller namnet "tot" och
       används OFÖRÄNDRAT för allt som rör den committade summan
       (rutAmt/cust nedan, precis som innan). */
    const displayExVat = this._lineDisplayExVat(l);
    const incVat = displayExVat + Math.round(displayExVat * _normVat(l.vatRate) / 100);
    const rutAmt = _effectiveRutAmount(l);
    const cust   = incVat - rutAmt;
    const curRed = l.reductionType || 'ingen';
    const base   = Math.max(0, Math.min(+l.reductionBaseExVat || 0, tot));
    const eligibleInclVat = base + Math.round(base * _normVat(l.vatRate) / 100);
    const expanded = this._expandedLineIds.has(l.id);
    const summary = `<div class="off-wiz-line-summary">
        <div class="off-wiz-line-summary-icon">${ic('tag',14)}</div>
        <div class="off-wiz-line-summary-body">
          <div class="off-wiz-line-summary-title">${esc(l.description) ? esc(l.description) : this._billingTypeRowLabel(l, 'Fastpris')}</div>
          <div class="off-wiz-line-summary-meta">${esc(l.description) && this._billingTypeBadgeHtml(l) ? this._billingTypeBadgeHtml(l) + ' · ' : ''}Fastpris · moms ${_normVat(l.vatRate)} %${rutAmt?` · ${curRed==='rot'?'ROT':'RUT'}-avdrag`:''}</div>
        </div>
        <div class="off-wiz-line-summary-price">${this._billingPriceLabelHtml(l, tot)}</div>
      </div>
      <div class="off-wiz-line-summary-actions">
        <button type="button" class="off-wiz-line-summary-edit" onclick="OffersPage._toggleLineExpanded('${l.id}')">${ic('pencil',11)} Redigera</button>
        <button type="button" class="off-wiz-line-summary-remove" onclick="OffersPage._removeLine(${i})">${ic('trash-2',11)} Ta bort</button>
      </div>`;
    const redOpts = [
      {v:'ingen', l:'Ingen reduktion'},
      {v:'rut',   l:'RUT – 50 %'},
      {v:'rot',   l:'ROT – 30 %'},
    ];
    const editor = `<div class="off-wiz-line-editor">
      <div class="off-svc-card-hd">
        <div class="off-svc-card-hd-main">
          <div class="off-svc-card-meta">${ic('tag',9)} ${this._billingTypeRowLabel(l, 'Fastpris')}</div>
          <input class="off-fixed-name" value="${(l.description||'').replace(/"/g,'&quot;')}" placeholder="Benämning…"
            oninput="OffersPage._editLines[${i}].description=this.value">
        </div>
        <div class="off-svc-card-hd-price">
          <div class="off-svc-card-price" id="off-lt-${i}">${this._billingPriceLabelHtml(l, tot)}</div>
          <div class="off-svc-card-price-sub" id="off-lsub-${i}">exkl. moms · ${fmt(incVat)} kr inkl. moms</div>
        </div>
      </div>
      <div class="off-wiz-line-controls-grid">
        <div><label class="off-wiz-line-field-label">Pris exkl. moms (kr)</label>
          <input type="text" inputmode="decimal" class="off-money-input" value="${_formatMoneyInput(l.unitPrice||0)}"
            oninput="OffersPage._editLines[${i}].unitPrice=_parseMoneyInput(this.value);OffersPage._refreshTotals()"
            onblur="this.value=_formatMoneyInput(OffersPage._editLines[${i}].unitPrice||0)"></div>
        <div><label class="off-wiz-line-field-label">Moms</label>
          <select onchange="OffersPage._editLines[${i}].vatRate=Number(this.value);OffersPage._refreshTotals()">
            ${this._vatOptionsHtml(_normVat(l.vatRate))}
          </select></div>
        <div><label class="off-wiz-line-field-label">Prissemantik</label>
          <select onchange="OffersPage._setLineBillingType(${i}, this.value);"
            title="Styr om priset ingår i offertens totalsumma">
            ${this._billingTypeOptionsHtml(bt)}
          </select></div>
        <div><label class="off-wiz-line-field-label" title="Visas efter priset, t.ex. mån/h/m²">Enhet</label>
          <input value="${(l.unit||'').replace(/"/g,'&quot;')}" placeholder="t.ex. mån"
            oninput="OffersPage._editLines[${i}].unit=this.value;OffersPage._refreshTotals()"></div>
      </div>
      <div class="off-wiz-line-note-row">
        <label class="off-wiz-line-note-label">${ic('lock',9)} Intern anteckning</label>
        <input value="${(l.note||'').replace(/"/g,'&quot;')}" placeholder="Syns ej för kund"
          oninput="OffersPage._editLines[${i}].note=this.value" class="off-wiz-line-field-note off-wiz-line-note-input"></div>
      ${bt==='recurring' ? `<div class="off-wiz-line-field-hint off-wiz-line-field-hint--neutral">Ingår i offertens återkommande månads-/årssumma, INTE i den vanliga totalsumman.</div>` : ''}
      ${(bt==='rate') ? `<div class="off-wiz-line-field-hint off-wiz-line-field-hint--neutral">Visas på offerten men ingår aldrig i någon totalsumma.</div>` : ''}
      ${bt==='onetime' ? `<div class="off-svc-reduction off-svc-reduction--line">
        <label class="off-svc-field-label--sub">Skattereduktion</label>
        <div class="off-svc-reduction-row">
          ${redOpts.map(o=>`<button type="button" class="off-svc-reduction-btn${curRed===o.v?' is-selected':''}"
            onclick="OffersPage._setLineReduction(${i},'${o.v}')">${o.l}</button>`).join('')}
        </div>
        <div class="off-svc-reduction-hint">Förutsätter att kunden har rätt till avdraget</div>
      </div>
      ${curRed !== 'ingen' ? `<div class="off-wiz-line-field">
        <label class="off-wiz-line-field-label">Arbetskostnad för ROT/RUT, exkl. moms</label>
        <input type="text" inputmode="decimal" class="off-money-input" id="off-lredbase-${i}" value="${_formatMoneyInput(base)}"
          oninput="OffersPage._setLineReductionBase(${i}, this.value)"
          onblur="this.value=_formatMoneyInput(OffersPage._editLines[${i}].reductionBaseExVat||0)">
        <div class="off-wiz-line-field-hint">Endast arbetskostnaden får ligga till grund för avdraget.</div>
        <div class="off-wiz-line-field-hint off-wiz-line-field-hint--neutral" id="off-lredhint-${i}"${base?' style="display:none;"':''}>Ange arbetskostnaden för att beräkna avdraget.</div>
      </div>` : ''}
      <div class="off-line-reduction-calc" id="off-lredcalc-${i}"${rutAmt?'':' style="display:none;"'}>
        <div class="off-line-reduction-calc-row"><span>Avdragsgrundande arbetskostnad inkl. moms</span><span id="off-leligincl-${i}">${fmt(eligibleInclVat)} kr</span></div>
        <div class="off-line-reduction-calc-row"><span>Preliminärt ${curRed==='rot'?'ROT':'RUT'}-avdrag</span><span id="off-lrutamt-${i}">−${fmt(rutAmt)} kr</span></div>
        <div class="off-line-reduction-calc-row off-line-reduction-calc-row--total"><span>Kund betalar</span><span id="off-lcustpay-${i}">${fmt(cust)} kr</span></div>
      </div>` : ''}
      <div class="off-wiz-line-card-actions">
        <button type="button" class="btn bs bxs off-wiz-line-editor-done" onclick="OffersPage._toggleLineExpanded('${l.id}')">${ic('check',10)} Klar</button>
        <button type="button" class="btn bd bxs" onclick="OffersPage._removeLine(${i})">${ic('trash-2',10)} Ta bort</button>
      </div>
    </div>`;
    return `<div class="off-wiz-line-card off-wiz-line-card--fixed" data-expanded="${expanded?'1':'0'}">${summary}${editor}</div>`;
  },

  _toolbarHtml(fieldId, key) {
    const ins = (p,s,ph) => `OffersPage._insertFormat('${fieldId}','${key}','${p}','${s}','${ph}')`;
    return `<div class="off-toolbar">
      <button type="button" class="btn bs bxs" onclick="${ins('- ','','punkt')}" title="Punktlista">• Lista</button>
      <button type="button" class="btn bs bxs" onclick="${ins('**','**','text')}" title="Fet text"><b>B</b></button>
      <button type="button" class="btn bs bxs" onclick="${ins('\\n','','\\n')}" title="Radbrytning">↵</button>
    </div>`;
  },

  _insertFormat(fieldId, key, prefix, suffix, placeholder) {
    const el = document.getElementById(fieldId);
    if (!el) return;
    const s = el.selectionStart, e = el.selectionEnd;
    const sel = el.value.substring(s, e) || placeholder || 'text';
    const ins = prefix + sel + (suffix || '');
    el.value = el.value.substring(0, s) + ins + el.value.substring(e);
    el.focus();
    el.setSelectionRange(s + prefix.length, s + prefix.length + sel.length);
    const keyMap = {scope:'scope', includes:'includes', excludes:'excludes', summary:'summary'};
    if (keyMap[key]) this._wizardData[keyMap[key]] = el.value;
    /* V48B4A.1: programmatisk `el.value = ...` dispatchar INGET native
       input/change-event — den delegerade draft-lyssnaren ser det aldrig.
       Flusha explicit. No-op om draft-läge inte är aktivt. */
    this._flushDraftNow();
  },

  _genTextSuggestion() {
    const raw = document.getElementById('off-summary')?.value || this._wizardData.summary || '';
    this._wizardData.summary = document.getElementById('off-summary')?.value || this._wizardData.summary;
    const sum = raw.toLowerCase();

    const qtyMatch = sum.match(/(\d+(?:[.,]\d+)?)\s*(m²|m2|kvm|lm|löpmeter)/i);
    const qty = qtyMatch ? parseFloat((qtyMatch[1]||'').replace(',','.')) : null;
    const qtyUnit = qtyMatch ? (/(lm|löpmeter)/i.test(qtyMatch[2]) ? 'lm' : 'm²') : 'm²';
    const qtyStr = qty ? `ca ${qty} ${qtyUnit}` : '';

    // Multi-moment detection — verb takes priority over object; each DEFS entry fires independently
    const WASH_V = /\b(tvätta|tvättar|tvättat|rengöra|rengör|rengöring|högtryckstvätta|högtrycksvätta|softwash|spola|spolning|avlägsna smuts|algtvätt|algbehandla|få bort alger)\b/;
    const CLIP_V = /\b(klippa|klipper|klippt|trimma|trimmar|trimmat)\b/;
    const RIV_V  = /\b(riva|river|rivit|rivning|demontera|demonterar|demontering)\b/;

    const DEFS = [
      {
        id: 'rivning', label: 'Rivning / Demontering',
        trigger: s => RIV_V.test(s) || /montera ned|ta ned konstruktion|riva ut/.test(s),
        action: 'rivning och demontering av befintliga konstruktioner',
        scopeCtx: 'Arbetet utförs metodiskt och säkert med rätt skyddsutrustning och hantering av rivmaterial.',
        includes: ['Demontering och rivning av angivna konstruktioner','Sortering och borttransport av rivmaterial','Dokumentation inför efterföljande arbeten'],
        excludes: ['Hantering av farligt avfall (asbest, PCB) utan separat avtal','Nya konstruktioner eller igensättning','Återuppbyggnad efter rivning'],
      },
      {
        id: 'fasadpanel', label: 'Fasadpanel / Panelarbete',
        // Suppress if rivning is the primary verb — then that moment owns the panel work
        trigger: s => (/\b(fasadpanel|panelarbete|liggande panel|stående panel)\b|\bpanel\b/.test(s)) &&
                      !RIV_V.test(s) && !/fasadtvätt/.test(s),
        action: 'montering och byte av fasadpanel',
        scopeCtx: 'Arbetet innefattar mätning, tillpassning och montering av ny panel med korrekt infästning och tätning.',
        includes: ['Demontering av befintlig panel','Montering av ny fasadpanel enligt specifikation','Tätning och fogning'],
        excludes: ['Målning av ny panel (tillval)','Bärande konstruktioner utöver panel','Material ej specificerat i offert'],
      },
      {
        id: 'trall', label: 'Trall / Altangolv',
        trigger: s => /\b(trall|altangolv|altantrall|trallplank)\b/.test(s),
        action: 'byte eller montering av trall och altangolv',
        scopeCtx: 'Arbetet innefattar demontering av gammalt golv, anpassning av underlag och montering av nya trallbrädor.',
        includes: ['Demontering av befintlig trall','Montering av ny trall enligt specifikation','Justering av underlag och syll'],
        excludes: ['Impregnering eller oljning (tillval)','Rekonstruktion av bärande balk','Material ej specificerat i offert'],
      },
      {
        id: 'målning', label: 'Målning / Ytbehandling',
        trigger: s => /\b(måla|målar|målat|målning|ytbehandling|ytbehandla|lacka|lackar|lackering)\b/.test(s),
        action: 'målning och ytbehandling av angivna ytor',
        scopeCtx: 'Arbetet utförs av erfaren målare med rätt material och metod för aktuell yta och miljö.',
        includes: ['Förarbete: slipning, spackling och grundning','Målning med överenskommet material och antal lager','Skydd av angränsande ytor'],
        excludes: ['Borttagning av gammal färg utöver normalt förarbete','Specialbehandlingar (brandskyddsfärg, klotterskydd)','Material ej inkluderat i offert'],
      },
      {
        id: 'felsökning', label: 'Felsökning / Kontroll',
        trigger: s => /\b(felsök|felsöker|felsökt|felsökning|felsöka|diagnostiser|lokalisera|lokaliserar|lokaliserat|kontrollera|kontrollerar|kontrollerat|undersöka|undersöker|undersökt|besiktiga|besiktigar|besiktning|inventera|inventering|utreda|utreder|utredning|bedöma|bedömer)\b|hitta felet|hitta läckan|leta efter fel|hitta orsak/.test(s),
        action: 'felsökning och lokalisering av fel eller skada',
        scopeCtx: 'Arbetet utförs systematiskt av erfaren tekniker med rätt utrustning och dokumenteras skriftligt.',
        includes: ['Systematisk felsökning och diagnostik','Dokumentation av fynd och skadeläge','Skriftlig åtgärdsrapport med prioritering','Löpande kommunikation med uppdragsgivare'],
        excludes: ['Avhjälpande åtgärder utöver felsökning (offerteras separat)','Ingrepp i konstruktion utan separat avtal','Garanterat resultat vid dolda eller komplexa fel'],
      },
      {
        id: 'skadedjur', label: 'Skadedjursbekämpning',
        trigger: s => /\b(myror|myrproblem|råttor|möss|gnagare|getingar|vespa|skalbaggar|insektsangrepp|skadedjur|bekämpa|bekämpning|sanera|sanering|utrota)\b/.test(s),
        action: 'inspektion och bekämpning av skadedjur',
        scopeCtx: 'Arbetet innefattar kartläggning av angreppsvägar, åtgärdsplan och genomförande av bekämpning.',
        includes: ['Inspektion och kartläggning av angreppsvägar','Identifiering av skadedjursart och omfattning','Bekämpning och uppföljning','Skriftlig rapport efter utfört arbete'],
        excludes: ['Rivning eller byggarbeten för åtkomst (separat offert)','Garanterad utrotning vid kraftiga angrepp utan fortsatt avtal','Löpande förebyggande avtal (separat prissättning)'],
      },
      {
        id: 'återställning', label: 'Återställning',
        trigger: s => /återställ/.test(s),
        action: 'återställning av skadade ytor och konstruktioner',
        scopeCtx: 'Arbetet syftar till att återställa konstruktionen till ursprungligt eller godkänt skick.',
        includes: ['Bedömning av skadeomfattning','Reparation och återställning av drabbade delar','Kontroll och besiktning efter åtgärd','Dokumentation och rapport'],
        excludes: ['Förebyggande åtgärder utöver specificerat arbete','Orsaksutredning utan separat avtal','Material ej specificerat i offert'],
      },
      {
        id: 'stenreparation', label: 'Plattreparation / Markstenjustering',
        trigger: s => /\b(laga|lagning|reparera|justera|rikta|sättning|sättningar|komplettera|komplettering)\b/.test(s) &&
                      /\b(marksten|plattor|sten|uppfart|stenläggning|markytan?|gångbanor?)\b/.test(s),
        action: 'reparation och justering av marksten och belagda ytor',
        scopeCtx: 'Arbetet utförs med precision för att återställa jämna och stabila markytor.',
        includes: ['Uppbrytning och återläggning av skadade eller sjunkna plattor','Justering av underlag och sättningar','Återläggning och fogning','Kontroll och jämning av angränsande ytor'],
        excludes: ['Ny fogsand utöver fogning vid reparation (tillval)','Impregnering (tillval)','Helrenovering av yta utan separat offert'],
      },
      {
        id: 'reparation', label: 'Reparation / Åtgärd',
        trigger: s => /\b(fixa|fixar|fixat|laga|lagar|lagat|reparera|reparerar|reparerat|reparation|åtgärda|åtgärdar|åtgärdat|åtgärd|justera|justerar|justerat|byta|byter|bytt|byte|täta|tätar|tätat|tätning|komplettera|komplettering)\b/.test(s),
        action: 'reparation och åtgärd av angivna delar',
        scopeCtx: 'Arbetet utförs av erfaren personal med rätt kompetens och verktyg för respektive moment.',
        includes: ['Bedömning och planering av åtgärd','Reparation eller justering enligt beskrivning','Test och kontroll efter åtgärd','Städning och bortforsling av eget avfall'],
        excludes: ['Större utbyten utöver specificerad åtgärd','Material ej inkluderat i offert','Tillkommande arbeten som framkommer under utförandet'],
      },
      {
        id: 'altantvätt', label: 'Altantvätt',
        trigger: s => /\b(altantvätt)\b/.test(s) || (WASH_V.test(s) && /\b(altan|terrass|uteplats)\b/.test(s)),
        action: 'professionell rengöring av altan, räcken och träytor',
        scopeCtx: 'Arbetet utförs varsamt med metod anpassad för aktuellt träslag och ytskikt för att uppnå ett rent resultat utan att skada underlaget.',
        includes: ['Högtrycksrengöring anpassad för träyta','Biologisk algbehandling','Rengöring av räcken, trappor och trädetaljer','Eftersköljning och kontroll av utfört arbete'],
        excludes: ['Oljning eller impregnering (tillval)','Slipning eller utbyte av plankor','Målning'],
      },
      {
        id: 'fasadtvätt', label: 'Fasadtvätt / Utvändig tvätt',
        trigger: s => /\b(fasadtvätt)\b/.test(s) ||
                      (WASH_V.test(s) && /\b(fasad|hus|byggnad|fasadyta|fasaddel|sockel|vägg|puts|tegel)\b/.test(s)),
        action: 'professionell tvätt av fasad och utvändiga ytor',
        scopeCtx: 'Utförs av certifierad personal med metod och tryck anpassat efter materialtyp och föroreningsgrad för att uppnå ett rent och vårdat resultat utan att skada underlaget.',
        includes: ['Inventering och bedömning av fasadtyp och ytskikt','Högtrycks- eller softwashtvätt med anpassad metod','Biologisk algbehandling vid behov','Rengöring kring fönster, dörrar och detaljer'],
        excludes: ['Puts- eller murningsarbeten','Målning av fasad','Fönsterputsning (tillval)'],
      },
      {
        id: 'stentvätt', label: 'Stentvätt / Markytor',
        trigger: s => /\b(stentvätt|stenhögtryck)\b/.test(s) ||
                      (WASH_V.test(s) && /\b(sten|marksten|betongplattor|stenläggning|plattor|stenterrass|uppfart|entréyta|hårdgjord|markytor?|gångbana|gångväg)\b/.test(s)),
        action: 'högtrycksrengöring av marksten och belagda ytor',
        scopeCtx: 'Arbetet utförs med professionell utrustning och miljögodkända rengöringsmedel anpassade för aktuell yta och smutsnivå.',
        includes: ['Högtrycksrengöring av angiven yta','Biologisk algbehandling','Rengöring av kanter, kantstöd och detaljer','Efterspolning och kontroll av utfört arbete'],
        excludes: ['Ny fogsand efter tvätt (tillval)','Reparation av skadade plattor','Bortforsling av annat material'],
      },
      {
        id: 'taktvätt', label: 'Taktvätt / Mossrening',
        trigger: s => /\b(taktvätt|mossrening|mossborttagning)\b/.test(s) || (WASH_V.test(s) && /\btak\b/.test(s)),
        action: 'taktvätt och mossrening',
        scopeCtx: 'Arbetet utförs varsamt för att inte skada takbeläggning eller tätskikt.',
        includes: ['Manuell eller mekanisk mossborttagning','Högtryckssköljning av takyta','Biologisk mossdödare (förebyggande)','Kontroll av takrännor och stuprör'],
        excludes: ['Reparation av skadade takpannor','Tätning av genomföringar','Byte av takbeläggning'],
      },
      {
        id: 'fönsterputsning', label: 'Fönsterputsning',
        trigger: s => /\bfönsterputs|\b(glasrengöring)\b|putsa fönster/.test(s) || (WASH_V.test(s) && /fönster/.test(s)),
        action: 'professionell fönsterputsning',
        scopeCtx: 'Utförs med professionell utrustning och rengöringsmedel anpassade för glas och karmar.',
        includes: ['Putsning av angivna fönster in- och/eller utvändigt','Rengöring av fönsterkarmar och fönsterbräden'],
        excludes: ['Reparation av trasigt glas','Svåråtkomliga fönster utan ställning (pristillägg)','Inglasade balkonger (separat offert)'],
      },
      {
        id: 'häckklippning', label: 'Häckklippning',
        trigger: s => /häck/.test(s) || (CLIP_V.test(s) && /\b(buska|buskar|buskage)\b/.test(s)),
        action: 'häckklippning och formklippning av buskage',
        scopeCtx: 'Arbetet utförs med professionell utrustning av erfaren personal.',
        includes: ['Klippning och formning av häck och buskage','Uppsamling och borttransport av klippmaterial'],
        excludes: ['Trädfällning eller stubbrytning','Plantering eller komplettering av häck','Kemisk bekämpning av ogräs'],
      },
      {
        id: 'gräsklippning', label: 'Gräsklippning',
        trigger: s => /\b(gräsklippning|grästrimning|gräsmatta)\b/.test(s) || (CLIP_V.test(s) && /gräs/.test(s)),
        action: 'professionell gräsklippning',
        scopeCtx: 'Arbetet utförs med professionell utrustning anpassad efter ytans storlek.',
        includes: ['Klippning av gräsmatta till önskad höjd','Kantklippning längs gångbanor och rabatter','Uppsamling och borttransport av gräsklipp'],
        excludes: ['Gödning eller behandling av gräsmatta (tillval)','Nysådd eller lagning av fläckar','Borttagning av mossa'],
      },
      {
        id: 'ogräs', label: 'Ogräsrensning',
        trigger: s => /\b(ogräs|ogräsrensning|rensa ogräs|fogrensning|rensa fogar|ogräsfri)\b/.test(s),
        action: 'ogräsrensning och rensning av belagda ytor',
        scopeCtx: 'Arbetet utförs manuellt och med lämpliga verktyg för aktuell yta och fogbredd.',
        includes: ['Rensning av ogräs i fogar och längs kanter','Uppsamling och borttransport av ogräs','Eftersopning av rengjord yta'],
        excludes: ['Kemisk bekämpning utan separat avtal','Ny fogsand (tillval)','Markstensreparationer'],
      },
      {
        id: 'fogsand', label: 'Fogsand / Fogning',
        trigger: s => /\b(fogsand|fogning|foga|fogar|fogat)\b|lägga fogsand|fylla fogsand|fylla i fogsand/.test(s),
        action: 'läggning av fogsand och fogning av stenyta',
        scopeCtx: 'Arbetet utförs efter rengöring för optimal fästighet och hållbarhet.',
        includes: ['Bortsopning av gammal fogsand','Läggning av ny fogsand','Vattning och eftersopning'],
        excludes: ['Högtryckstvätt (tillval inför fogsand)','Justering av ojämna plattor','Material utöver specificerad mängd'],
      },
      {
        id: 'impregnering', label: 'Impregnering / Ytskydd',
        trigger: s => /impregner|träskydd|träolja|olja trä|stenimpregnering|markimpregnering/.test(s),
        action: 'impregnering och ytskyddsbehandling',
        scopeCtx: 'Arbetet utförs med godkänt skyddsmedel för aktuellt material och exponering.',
        includes: ['Rengöring av yta inför behandling','Applicering av impregnering / ytskyddsmedel','Kontroll av täckning och inträngning'],
        excludes: ['Slipning eller utbyte av plankor (tillval)','Målning (separat offert)','Material ej specificerat i offert'],
      },
      {
        id: 'markarbete', label: 'Markarbete / Schaktning',
        trigger: s => /\b(schakta|schaktning|gräva|grävning|dränera|dränering|dagvatten|markarbete|markarbeten)\b/.test(s),
        action: 'markarbete och schaktning',
        scopeCtx: 'Arbetet utförs med rätt maskinell utrustning och med hänsyn till befintliga ledningar.',
        includes: ['Schaktning och bortforsling av massor','Dränering eller dagvattenåtgärder enligt plan','Återfyllning och komprimering'],
        excludes: ['Ledningskartering (uppdragsgivarens ansvar)','Asfalts- eller plattläggning (tillval)','Specialmaskiner utöver offert'],
      },
      {
        id: 'snöröjning', label: 'Snöröjning / Halkbekämpning',
        trigger: s => /\b(snöröjning|plogga|ploggar|plogning|skotta|skottning|sanda|sandning|salta|saltning|halkbekämpning)\b/.test(s),
        action: 'snöröjning och halkbekämpning',
        scopeCtx: 'Arbetet utförs snabbt och effektivt för att säkerställa framkomlighet och säkerhet.',
        includes: ['Plogning och skottning av ytor och gångar','Sandning och/eller saltning vid halka','Bortforsling av snö vid behov'],
        excludes: ['Skador orsakade av plogutrustning på ej markerade hinder','Återställning av vegetation efter vintersäsong'],
      },
      {
        id: 'fastighetsservice', label: 'Fastighetsservice',
        trigger: s => /\b(fastighetsservice|förvaltning|rondering|tillsyn|skötsel|trapphus|tvättstuga|entré|källare|garage|förråd)\b/.test(s),
        action: 'fastighetsservice och löpande skötsel',
        scopeCtx: 'Arbetet utförs enligt överenskommen specifikation för att säkerställa fastighetens funktion och värde.',
        includes: ['Regelbundna tillsynsrundor med protokollföring','Felanmälan och åtgärd vid avvikelser','Rapportering till uppdragsgivare'],
        excludes: ['Större renoveringsarbeten','Specialisttjänster (el, VVS, hiss)','Material ej inkluderat i offert'],
      },
      {
        id: 'bygg', label: 'Bygg / Renovering',
        trigger: s => /\b(bygga|bygger|byggt|renovera|renoverar|renovering|nybyggnation)\b/.test(s),
        action: 'bygg och renoveringsarbete',
        scopeCtx: 'Arbetet utförs av behörig personal med rätt kompetens och material.',
        includes: ['Arbete och personal enligt offert','Nödvändig utrustning och skyddsmaterial','Dokumentation och besiktning vid behov'],
        excludes: ['Bygglov och myndighetskontakter (uppdragsgivarens ansvar)','Specialisttjänster (el, VVS) utöver offert','Material ej specificerat i offert'],
      },
    ];

    let matched = DEFS.filter(d => d.trigger(sum));

    // Suppress generic reparation when a more specific repair moment matched
    const specificRepair = matched.some(m => ['trall','fasadpanel','återställning','stenreparation'].includes(m.id));
    if (specificRepair) matched = matched.filter(m => m.id !== 'reparation');
    // Suppress generic reparation when rivning owns the action
    if (matched.some(m => m.id === 'rivning')) matched = matched.filter(m => m.id !== 'reparation');
    // Suppress fastighetsservice when more specific moments cover the work
    const hasSpecificWork = matched.some(m => !['fastighetsservice','reparation'].includes(m.id));
    if (hasSpecificWork) matched = matched.filter(m => m.id !== 'fastighetsservice');

    // Fallback: infer from added service lines when summary is empty/short
    if (matched.length === 0) {
      const svcLines = this._editLines.filter(l => l.type === 'service');
      if (svcLines.length) {
        const ids = svcLines.map(l => (l.templateId || l.priceRuleRef || '').toLowerCase()).join(' ');
        const fbId = /altan/.test(ids) ? 'altantvätt' : /fasad/.test(ids) ? 'fasadtvätt' :
                     /sten/.test(ids) ? 'stentvätt' : /häck/.test(ids) ? 'häckklippning' :
                     /fs|fastighet/.test(ids) ? 'fastighetsservice' : /fönster/.test(ids) ? 'fönsterputsning' : null;
        if (fbId) matched = [DEFS.find(d => d.id === fbId)].filter(Boolean);
      }
    }

    let scope, includes, excludes, label;

    if (matched.length === 0) {
      scope    = `Arbetet omfattar åtgärder enligt kundens beskrivning och avser de ytor och moment som anges i offerten. Utförandet anpassas efter platsens förutsättningar och eventuella avvikelser kommuniceras med kund innan tillkommande arbete påbörjas.`;
      includes = '- Arbete och personal enligt offert\n- Nödvändig utrustning och skyddsmaterial\n- Städning och bortforsling av eget avfall\n- Löpande kommunikation med kund';
      excludes = '- Material ej specificerat i offert\n- Tillkommande arbeten utöver offertens omfattning\n- Specialisttjänster utan separat avtal';
      label    = 'Generell';
    } else {
      label = matched.map(m => m.label).join(' + ');

      // Build scope — single moment vs multi-moment
      const actions = matched.map(m => m.action);
      if (matched.length === 1) {
        scope = `Arbetet omfattar ${actions[0]}${qtyStr ? ' (' + qtyStr + ')' : ''}. ${matched[0].scopeCtx}`;
      } else {
        const last = actions[actions.length - 1];
        const rest = actions.slice(0, -1);
        const actionStr = rest.join(', ') + ' samt ' + last;
        scope = `Uppdraget omfattar ${actionStr}${qtyStr ? ' (' + qtyStr + ')' : ''}. Samtliga moment utförs av VIFT:s personal med anpassad metod och utrustning för respektive yta och materialtyp. Eventuella avvikelser kommuniceras med kund innan tillkommande arbete påbörjas.`;
      }

      // Merge includes (deduplicated by first 22 chars)
      const inclSeen = new Set();
      const inclLines = [];
      for (const m of matched) {
        for (const inc of m.includes) {
          const key = inc.substring(0, 22);
          if (!inclSeen.has(key)) { inclSeen.add(key); inclLines.push('- ' + inc); }
        }
      }
      if (!inclLines.some(l => /städning/i.test(l))) {
        inclLines.push('- Städning av arbetsplats efter utfört arbete');
      }
      includes = inclLines.join('\n');

      // Merge excludes (deduplicated by first 22 chars)
      const exclSeen = new Set();
      const exclLines = [];
      for (const m of matched) {
        for (const exc of m.excludes) {
          const key = exc.substring(0, 22);
          if (!exclSeen.has(key)) { exclSeen.add(key); exclLines.push('- ' + exc); }
        }
      }
      if (!exclLines.some(l => /tillkommande/i.test(l))) {
        exclLines.push('- Tillkommande arbeten som framkommer under utförandet');
      }
      excludes = exclLines.join('\n');
    }

    this._wizardData.scope       = scope;
    this._wizardData.includes    = includes;
    this._wizardData.excludes    = excludes;
    this._wizardData._lastGenFrom = label + ' (' + new Date().toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'}) + ')';
    this._rerender();
    /* V48B4A.1: scope/includes/excludes sätts programmatiskt ovan — inget
       input/change-event uppstår. Flusha explicit. No-op om draft-läge
       inte är aktivt. */
    this._flushDraftNow();
    showToast('Textförslag baserat på: ' + label);
  },

  /* ── Totals ─── */
  _calcExVat(lines, extras) {
    const lSum = (lines||[]).filter(l=>l.type!=='text').reduce((s,l)=>s+_lineExVat(l),0);
    const eSum = (extras||[]).reduce((s,e)=>s+Math.round((+(e.qty||1))*(+(e.unitPrice||0))),0);
    return Math.round(lSum + eSum);
  },

  _calcRutAmt(lines) {
    return Math.round((lines||[]).filter(l=>l.type!=='text').reduce((s,l)=>s+(l.rutAmount||0),0));
  },

  _refreshTotals() {
    this._editLines.forEach((l, i) => {
      if (l.type === 'manual' || l.type === 'fixed') {
        /* OFFER CORE R1.6.3 — BLOCKER 2 (consistency): now derived from
           the canonical _lineExVat(l) (0 för rate/option, byte-identical
           to the old local Math.round(qty*unitPrice) formula for every
           other billingType) instead of a duplicated ad-hoc calc, so a
           LIVE edit's committed-amount handling can never drift from the
           render-time value used by _renderFixedCard()/_renderManualCard(). */
        const total = _lineExVat(l);
        /* V48B5 R1 §5: om pris/antal sänks så att radens exVat blir lägre
           än det sparade arbetskostnadsunderlaget, klampas underlaget ner
           till radens nya exVat INNAN rutAmount räknas om — annars skulle
           avdraget kunna räknas på ett belopp som inte längre finns kvar
           på raden. */
        if (l.reductionType && l.reductionType !== 'ingen') {
          l.reductionBaseExVat = Math.max(0, Math.min(+l.reductionBaseExVat || 0, total));
          l.rutAmount = this._calcLineRutAmount(l);
        } else {
          l.reductionBaseExVat = 0;
          l.rutAmount = 0;
        }
        const el = document.getElementById('off-lt-' + i);
        if (el) el.textContent = this._billingPriceLabelHtml(l, total);
        /* V41 §3: fastprisradens "ex. moms · X kr inkl."-subtext hade
           tidigare INGET id och uppdaterades aldrig här — en momsändring
           (eller prisändring) uppdaterade bara ex-momsbeloppet, inte det
           inkl-moms-belopp som redan stod skrivet på kortet.
           R1.6.3 — BLOCKER 2: subtexten är INFORMATIV, inte den
           committade summan — måste därför byggas på _lineDisplayExVat
           (verklig à-pris för rate), annars återkommer "0 kr inkl."-
           felet så fort användaren rör pris/moms-fältet efter render. */
        const displayExVat = this._lineDisplayExVat(l);
        const incVat = displayExVat + Math.round(displayExVat * _normVat(l.vatRate) / 100);
        if (l.type === 'fixed') {
          const subEl = document.getElementById('off-lsub-' + i);
          if (subEl) subEl.textContent = 'exkl. moms · ' + fmt(incVat) + ' kr inkl. moms';
        }
        /* V48B5 R1 §4 / R3 §11: arbetskostnadsfältets (om klampat) värde
           måste hänga med live — annars kan fältet visa ett tal högre än
           vad som faktiskt går att avdragsberäkna. R3: fältet är nu ett
           formaterat text-fält — vi rör ALDRIG dess DOM-värde medan
           användaren aktivt har det fokuserat (annars skulle skrivandet
           avbrytas av en programmatisk omformatering mitt i); annars
           visas det korrekt Svensk-grupperat. */
        const baseEl = document.getElementById('off-lredbase-' + i);
        if (baseEl && document.activeElement !== baseEl) {
          baseEl.value = _formatMoneyInput(l.reductionBaseExVat || 0);
        }
        const hintEl = document.getElementById('off-lredhint-' + i);
        if (hintEl) hintEl.style.display = (l.reductionType && l.reductionType !== 'ingen' && !l.reductionBaseExVat) ? '' : 'none';
        const calcEl = document.getElementById('off-lredcalc-' + i);
        if (calcEl) {
          if (l.rutAmount) {
            const eligibleVat = Math.round((l.reductionBaseExVat||0) * _normVat(l.vatRate) / 100);
            const eligibleInclVat = (l.reductionBaseExVat||0) + eligibleVat;
            const cust = incVat - l.rutAmount;
            calcEl.style.display = '';
            const eligEl = document.getElementById('off-leligincl-' + i);
            const rutAmtEl = document.getElementById('off-lrutamt-' + i);
            const custEl = document.getElementById('off-lcustpay-' + i);
            if (eligEl) eligEl.textContent = fmt(eligibleInclVat) + ' kr';
            if (rutAmtEl) rutAmtEl.textContent = '−' + fmt(l.rutAmount) + ' kr';
            if (custEl) custEl.textContent = fmt(cust) + ' kr';
          } else {
            calcEl.style.display = 'none';
          }
        }
      }
    });
    const bar = document.getElementById('off-totals-bar');
    if (bar) bar.innerHTML = this._totalsBarHtml();
    const mobileBar = document.getElementById('off-mobile-totals');
    if (mobileBar) mobileBar.innerHTML = this._mobileTotalsHtml();
    const discArea = document.getElementById('off-discount-area');
    if (discArea) {
      const shown = !!document.getElementById('off-disc-val');
      const t = _offerCalcTotals({ lines: this._editLines, extras: this._editExtras, discount: this._discount });
      const should = t.rawExVat > 0 || (this._discount?.value || 0) > 0;
      if (shown !== should) discArea.innerHTML = this._discountAreaHtml();
      else if (shown) {
        const lbl = discArea.querySelector('.off-discount-ctrl > label');
        if (lbl) lbl.textContent = t.recurringMonthlyExVat ? 'Rabatt på engångsbelopp' : 'Rabatt';
      }
    }
  },

  /* ── Line management ─── */
  _addManualLine() {
    const newId = 'M'+Date.now();
    this._editLines.push({id:newId,type:'manual',description:'',qty:1,unit:'st',unitPrice:0,vatRate:25,total:0,reductionType:'ingen',reductionBaseExVat:0,rutAmount:0,billingType:'onetime'});
    this._expandedLineIds.add(newId);
    const el = document.getElementById('off-lines');
    if (el) el.innerHTML = this._linesHtml();
    this._refreshTotals();
    this._flushDraftNow();
    setTimeout(() => {
      const inputs = document.querySelectorAll('#off-lines input[placeholder="Benämning"]');
      if (inputs.length) inputs[inputs.length-1].focus();
    }, 50);
  },

  _addTextBlock() {
    const newId = 'T'+Date.now();
    this._editLines.push({id:newId,type:'text',blockTitle:'',text:''});
    this._expandedLineIds.add(newId);
    const el = document.getElementById('off-lines');
    if (el) el.innerHTML = this._linesHtml();
    this._flushDraftNow();
  },

  _removeLine(idx) {
    this._editLines.splice(idx, 1);
    const el = document.getElementById('off-lines');
    if (el) el.innerHTML = this._linesHtml();
    this._refreshTotals();
    this._flushDraftNow();
  },

  /* ── Service calc overlay ─── */
  _openSvcCalc(editIdx) {
    this._svcEditIdx = editIdx;
    if (editIdx !== null && editIdx !== undefined) {
      const l = this._editLines[editIdx];
      if (l && l.type === 'service') {
        this._activeSvcId  = l.templateId || l.priceRuleRef;
        this._svcFields    = {...(l.inputValues || {})};
        this._svcReduction = l.reductionType || 'ingen';
      }
    } else {
      this._activeSvcId  = null;
      this._svcFields    = {};
      this._svcReduction = 'ingen';
    }

    let ov = document.getElementById('off-svc-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'off-svc-overlay';
      ov.onclick = e => { if (e.target === ov) OffersPage._closeSvcCalc(); };
      document.body.appendChild(ov);
    }
    this._svcOverlayUpdateOffset();
    /* V48B2: reaktiv istället för engångssnapshot — offsetten uppdateras
       om viewport-brytpunkten ändras medan overlayn är öppen (t.ex.
       rotation av surfplatta). Lyssnaren tas bort igen i _closeSvcCalc(). */
    if (!this._svcOverlayMQL) {
      this._svcOverlayMQL = window.matchMedia('(min-width: 1024px)');
      this._svcOverlayMQLHandler = () => this._svcOverlayUpdateOffset();
      this._svcOverlayMQL.addEventListener('change', this._svcOverlayMQLHandler);
    }
    ov.innerHTML = this._svcOverlayHtml();
    if (this._activeSvcId) setTimeout(() => { this._initChips(); this._updateSvcPreview(); }, 20);

    /* V48B3A DEL 13: egen, lokal scroll-lock-klass — delar INTE
       body.modal-open med Modal.js, som gör en ovillkorlig add/remove utan
       referensräkning (dokumenterad risk i V48B2:s rapport: en samtidigt
       öppnad/stängd vanlig Modal skulle annars kunna ta bort klassen
       medan kalkylatorn fortfarande är öppen). Städas i _closeSvcCalc(),
       som är den enda vägen ut (X, backdrop, Escape, och _addSvcLine():s
       lyckade spara-flöde anropar alla _closeSvcCalc()). */
    document.body.classList.add('off-svc-open');
    if (!this._svcEscHandler) {
      this._svcEscHandler = e => { if (e.key === 'Escape') OffersPage._closeSvcCalc(); };
      document.addEventListener('keydown', this._svcEscHandler);
    }
  },

  /* V48B2: overlayns vänsteroffset måste följa sidebarens FAKTISKA
     renderade bredd (240/56/xl beroende på breakpoint OCH ihopfälld-state
     — se layout.css #bottom-nav/body.sidebar-collapsed), vilket inte kan
     uttryckas via en statisk CSS-brytpunkt eftersom --sidebar-w är en fast
     token, inte den faktiskt renderade bredden. Detta är den enda
     kvarvarande JS-styrda layoutberäkningen i kalkylatorn. */
  _svcOverlayUpdateOffset() {
    const ov = document.getElementById('off-svc-overlay');
    if (!ov) return;
    const isDesktop = window.matchMedia('(min-width: 1024px)').matches;
    const sidebarW  = isDesktop ? (document.getElementById('bottom-nav')?.offsetWidth || 240) : 0;
    ov.style.left = sidebarW + 'px';
  },

  _closeSvcCalc() {
    document.getElementById('off-svc-overlay')?.remove();
    this._svcEditIdx = null;
    if (this._svcOverlayMQL && this._svcOverlayMQLHandler) {
      this._svcOverlayMQL.removeEventListener('change', this._svcOverlayMQLHandler);
    }
    this._svcOverlayMQL = null;
    this._svcOverlayMQLHandler = null;
    document.body.classList.remove('off-svc-open');
    if (this._svcEscHandler) {
      document.removeEventListener('keydown', this._svcEscHandler);
      this._svcEscHandler = null;
    }
  },

  /* V48B2: EN kalkylator, EN state, responsiv presentation — meny
     (desktop) och chip-rad (mobil) renderas nu ALLTID båda i samma DOM
     och CSS-brytpunkten (@media min-width:1024px, components.css) avgör
     vilken som visas, istället för att JS byggde två separata
     markup-varianter utifrån ett engångs-window.innerWidth-värde. */
  _svcOverlayHtml() {
    const isEdit     = this._svcEditIdx !== null && this._svcEditIdx !== undefined;
    const activeTmpl = this._getT().find(t => t.id === this._activeSvcId);

    const calcBody = activeTmpl
      ? this._svcCalcHtml(activeTmpl)
      : `<div class="off-svc-empty">
          <div class="off-svc-empty-icon">${ic('zap',28)}</div>
          <div class="off-svc-empty-title">Välj en tjänst <span class="off-svc-empty-hint-desktop">till vänster</span><span class="off-svc-empty-hint-mobile">ovan</span></div>
          <div class="off-svc-empty-sub">Alla priser exklusive moms</div>
        </div>`;

    /* V48B3A R3: vid redigering av en BEFINTLIG tjänsterad ska
       beskrivningsfältet förifyllas med den sparade l.description — inte
       mallens defaultDesc. Detta är nu kritiskt sedan R2 gjorde
       description-fältet till mobilens ENDA sätt att se/ändra
       kundbeskrivningen (ingen direkt input i read-cardet <1024px längre).
       Ny tjänst (ej edit) och tjänstebyte under edit (_activateSvc(...,
       false), som skriver ett NYTT defaultDesc till #svc-custom-desc
       separat) är oförändrade — se _activateSvc(). */
    const editLine = (isEdit && this._editLines[this._svcEditIdx]) ? this._editLines[this._svcEditIdx] : null;
    const descSource = (editLine && editLine.type === 'service')
      ? (editLine.description || (activeTmpl && activeTmpl.defaultDesc) || '')
      : ((activeTmpl && activeTmpl.defaultDesc) || '');
    const descVal  = esc(descSource);
    const addLabel = isEdit ? 'Uppdatera tjänst' : 'Lägg till i offert';

    const hdr = `<div class="off-svc-hdr">
      <div class="off-svc-hdr-title">
        <div class="off-svc-hdr-title-main">${ic('zap',13)} ${isEdit ? 'Redigera tjänst' : 'Lägg till tjänst'}</div>
        <div class="off-svc-hdr-title-sub">Alla priser exklusive moms</div>
      </div>
      <button type="button" onclick="OffersPage._closeSvcCalc()" class="off-close-btn">${ic('x',14)}</button>
    </div>`;

    const footer = `<div id="off-svc-footer" class="off-svc-footer">
      <div class="off-svc-footer-inner">
        <div class="fg">
          <label>Beskrivning på offerten</label>
          <input id="svc-custom-desc" value="${descVal}" placeholder="Kundvänlig beskrivning…" style="font-size:11px;">
        </div>
        <button type="button" class="btn bp bsm off-svc-add-btn" onclick="OffersPage._addSvcLine()">
          ${ic('plus',12)} ${addLabel}
        </button>
      </div>
    </div>`;

    /* V48B3A: den tidigare separata mobila chip-raden (.off-svc-chips-bar,
       små pills) är borttagen — DEL 9 kräver stora, tydliga touch-rader
       istället för små chips. EN lista (.off-svc-menu) återanvänds nu vid
       ALLA bredder: på desktop (>=1024px) en smal, alltid synlig
       sidomeny (oförändrat beteende från B2); på mobil/tablet (<1024px)
       en fullbredds "välj tjänst"-lista som visas i "pick"-fasen och
       döljs i "fields"-fasen (se data-svc-phase nedan och DEL 9/16). */
    const svcList = this._getT().map(t => {
      const active = t.id === this._activeSvcId;
      return `<button type="button" id="off-svc-menu-${t.id}"
        onclick="OffersPage._activateSvc('${t.id}',false)"
        class="off-svc-menu-item${active ? ' off-svc-menu-item--active' : ''}">
        ${ic(t.icon,16)}<span>${esc(t.name)}</span>
      </button>`;
    }).join('');

    /* Fasen härleds direkt ur activeTmpl — inget separat state att hålla i
       synk. <1024px: "pick" visar listan och döljer fältformuläret;
       "fields" gör tvärtom och visar en "Byt tjänst"-knapp. >=1024px
       ignorerar CSS:n denna attribut helt (båda alltid synliga, som i B2). */
    const phase = activeTmpl ? 'fields' : 'pick';
    const backBtn = activeTmpl
      ? `<button type="button" class="off-svc-back-to-picker" onclick="OffersPage._svcBackToPicker()">${ic('arrow-left',13)} Byt tjänst</button>`
      : '';

    return `<div class="off-svc-modal" data-svc-phase="${phase}">
      ${hdr}
      <div class="off-svc-layout">
        <div class="off-svc-menu">${svcList}</div>
        <div id="off-svc-body" class="off-svc-body">
          ${backBtn}
          <div id="off-svc-fields">${calcBody}</div>
        </div>
      </div>
      ${footer}
    </div>`;
  },

  /* V48B3A: mobil/tablet "byt tjänst" — går tillbaka till pick-fasen utan
     att stänga overlayn. Fält/state för den övergivna tjänsten kastas
     (samma väg som _activateSvc redan tar när !keepFields), ingen
     sparlogik/beräkning påverkas. */
  _svcBackToPicker() {
    this._activeSvcId = null;
    const ov = document.getElementById('off-svc-overlay');
    if (ov) ov.innerHTML = this._svcOverlayHtml();
  },

  _activateSvc(tId, keepFields) {
    this._activeSvcId = tId;
    this._getT().forEach(t => {
      const a = t.id === tId;
      const menuBtn = document.getElementById('off-svc-menu-' + t.id);
      if (menuBtn) menuBtn.classList.toggle('off-svc-menu-item--active', a);
    });
    const tmpl = this._getT().find(t => t.id === tId);
    if (!tmpl) return;
    if (!keepFields) {
      this._svcFields    = {};
      this._svcReduction = tmpl.defaultReduction || 'ingen';
      tmpl.fields.forEach(f => {
        if (f.isRut || f.isRot) return;  // handled by _svcReduction
        if (f.type === 'pricegroup') {
          const pgs = (state.priceGroups || []).filter(p => p.billingType !== 'monthly');
          const defId = f.def || (pgs[0] && pgs[0].id) || '';
          this._svcFields[f.id] = defId;
          const pg = pgs.find(p => p.id === defId);
          if (pg && !this._svcFields['rate']) this._svcFields['rate'] = pg.hourRate;
        } else if (f.def !== undefined)           this._svcFields[f.id] = f.def;
        else if (f.type==='chips'&&f.opts) this._svcFields[f.id] = f.opts[0];
        else if (f.type==='bool')          this._svcFields[f.id] = false;
        else if (f.type==='number')        this._svcFields[f.id] = 0;
        else                               this._svcFields[f.id] = '';
      });
    }
    // Full re-render (not just #off-svc-fields) — needed so the mobile
    // "Byt tjänst"-knapp/data-svc-phase-attributet uppdateras korrekt när
    // användaren väljer en tjänst för första gången från pick-listan.
    const ov = document.getElementById('off-svc-overlay');
    if (ov) {
      ov.innerHTML = this._svcOverlayHtml();
      setTimeout(() => { this._initChips(); this._updateSvcPreview(); }, 20);
    }
    // Update footer description to match the new service's default
    const descEl = document.getElementById('svc-custom-desc');
    if (descEl && !keepFields) descEl.value = tmpl.defaultDesc || '';
  },

  _svcCalcHtml(tmpl) {
    if (!tmpl) return '';
    const numF  = tmpl.fields.filter(f=>f.type==='number');
    const chipF = tmpl.fields.filter(f=>f.type==='chips');
    const txtF  = tmpl.fields.filter(f=>f.type==='text');
    const pgF   = tmpl.fields.filter(f=>f.type==='pricegroup');
    const boolF = tmpl.fields.filter(f=>f.type==='bool'&&!f.isRut&&!f.isRot);
    const curRed = this._svcReduction;
    const reqMark = f => f.req ? ` <span class="off-svc-field-req">*</span>` : '';
    let html = '';

    // ── Quantity / number inputs ──
    numF.forEach(f => {
      const unit = {area:'m²',length:'lm',hours:'tim',qty:'tim',months:'mån'}[f.id]||'';
      const val  = this._svcFields[f.id]!=null&&this._svcFields[f.id]!==0 ? this._svcFields[f.id] : (f.def||'');
      html += `<div class="off-svc-field">
        <label class="off-svc-field-label">${esc(f.label)}${reqMark(f)}</label>
        <div class="off-svc-field-row">
          <input type="number" id="svc-f-${f.id}" class="off-svc-field-number" value="${val}" min="0"
            step="${['rate','monthly','material'].includes(f.id)?'1':'0.5'}" placeholder="0"
            oninput="OffersPage._svcFields['${f.id}']=parseFloat(this.value)||0;OffersPage._updateSvcPreview()">
          ${unit?`<span class="off-svc-field-unit">${unit}</span>`:''}
        </div>
      </div>`;
    });

    // ── Price group selector ──
    pgF.forEach(f => {
      const pgs = (state.priceGroups || []).filter(p => p.active !== false && p.billingType !== 'monthly');
      const curVal = this._svcFields[f.id] || f.def || (pgs[0] && pgs[0].id) || '';
      html += `<div class="off-svc-field">
        <label class="off-svc-field-label">${esc(f.label)}${reqMark(f)}</label>
        <select id="svc-f-${f.id}" class="off-svc-field-select"
          onchange="OffersPage._svcFields['${f.id}']=this.value;var _pg=(state.priceGroups||[]).find(p=>p.id===this.value);if(_pg){OffersPage._svcFields['rate']=_pg.hourRate;var rEl=document.getElementById('svc-f-rate');if(rEl)rEl.value=_pg.hourRate;}OffersPage._updateSvcPreview()">
          ${pgs.map(pg => `<option value="${pg.id}" ${curVal===pg.id?'selected':''}>${esc(pg.name)} (${fmt(pg.hourRate)} kr/tim)</option>`).join('')}
        </select>
      </div>`;
    });

    // ── Text inputs ──
    txtF.forEach(f => {
      html += `<div class="off-svc-field">
        <label class="off-svc-field-label">${esc(f.label)}${reqMark(f)}</label>
        <input type="text" id="svc-f-${f.id}" class="off-svc-field-text" value="${esc(this._svcFields[f.id]||'')}" placeholder="${esc(f.label)}"
          oninput="OffersPage._svcFields['${f.id}']=this.value;OffersPage._updateSvcPreview()">
      </div>`;
    });

    // ── Chip selectors ──
    chipF.forEach(f => {
      html += `<div class="off-svc-field off-svc-field--compact">
        <label class="off-svc-field-label--sub">${esc(f.label)}</label>
        <div class="off-svc-field-chip-row" data-chips="${f.id}">
          ${(f.opts||[]).map(o=>`<button type="button" data-val="${o}" class="off-svc-field-chip"
            onclick="OffersPage._setChip('${f.id}','${o.replace(/'/g,"\\'")}',this)">${o}</button>`).join('')}
        </div>
      </div>`;
    });

    // ── Bool add-ons ──
    if (boolF.length) {
      html += `<div class="off-svc-field off-svc-field--compact">
        <label class="off-svc-field-label--sub">Tillval</label>
        <div class="off-svc-option-grid">`;
      boolF.forEach(f => {
        html += `<label class="off-svc-option">
          <input type="checkbox" id="svc-f-${f.id}" ${this._svcFields[f.id]?'checked':''}
            onchange="OffersPage._svcFields['${f.id}']=this.checked;OffersPage._updateSvcPreview()">
          <span>${f.addLabel||f.label}</span></label>`;
      });
      html += `</div></div>`;
    }

    // ── Unified tax reduction selector — always show all three options ──
    const redOpts = [
      {v:'ingen', l:'Ingen reduktion'},
      {v:'rut',   l:'RUT – 50 %'},
      {v:'rot',   l:'ROT – 30 %'},
    ];
    html += `<div class="off-svc-reduction">
      <label class="off-svc-field-label--sub">Skattereduktion</label>
      <div class="off-svc-reduction-row">
        ${redOpts.map(o=>`<button type="button" id="svc-red-${o.v}" class="off-svc-reduction-btn${curRed===o.v?' is-selected':''}"
          onclick="OffersPage._setReduction('${o.v}')">${o.l}</button>`).join('')}
      </div>
      <div class="off-svc-reduction-hint">Förutsätter att kunden har rätt till avdraget</div>
    </div>`;

    // ── Live preview ──
    html += `<div id="svc-preview" class="off-svc-preview">
      <div class="off-svc-preview-empty">Fyll i fälten ovan för att se kalkylen…</div>
    </div>`;
    return html;
  },

  /* ── Chips ─── */
  /* V48B2: state-klass (.is-selected) istället för att skriva
     el.style.background/color/borderColor/fontWeight direkt i JS.
     Samma tillstånd sätts i inputValues/reductionType som förut. */
  _setChip(fieldId, value, btn) {
    this._svcFields[fieldId] = value;
    const group = btn.closest('[data-chips]');
    if (group) {
      group.querySelectorAll('button').forEach(b => b.classList.toggle('is-selected', b === btn));
    }
    this._updateSvcPreview();
  },

  _setReduction(val) {
    this._svcReduction = val;
    ['ingen','rut','rot'].forEach(v => {
      const btn = document.getElementById('svc-red-' + v);
      if (!btn) return;
      btn.classList.toggle('is-selected', v === val);
    });
    this._updateSvcPreview();
  },

  _initChips() {
    const tmpl = this._getT().find(t => t.id === this._activeSvcId);
    if (!tmpl) return;
    tmpl.fields.filter(f=>f.type==='chips').forEach(f => {
      const val   = this._svcFields[f.id] || f.def || (f.opts&&f.opts[0]);
      const group = document.querySelector('[data-chips="' + f.id + '"]');
      if (!group) return;
      group.querySelectorAll('button').forEach(btn => {
        const a = btn.dataset.val === val || btn.textContent.trim() === val;
        btn.classList.toggle('is-selected', a);
      });
    });
  },

  /* ── Svc preview ─── */
  _updateSvcPreview() {
    const tmpl = this._getT().find(t => t.id === this._activeSvcId);
    const prev = document.getElementById('svc-preview');
    if (!tmpl || !prev) return;
    // Collect non-reduction fields from DOM
    tmpl.fields.forEach(f => {
      if (f.type === 'chips' || f.isRut || f.isRot) return;
      const el = document.getElementById('svc-f-' + f.id);
      if (!el) return;
      if (f.type==='bool')            this._svcFields[f.id] = el.checked;
      else if (f.type==='number')     this._svcFields[f.id] = parseFloat(el.value)||0;
      else if (f.type==='pricegroup') {
        this._svcFields[f.id] = el.value;
        const _pg = (state.priceGroups||[]).find(p=>p.id===el.value);
        if (_pg) this._svcFields['rate'] = _pg.hourRate;
      } else                          this._svcFields[f.id] = el.value;
    });
    // Inject unified reduction choice into calc fields
    const fields = {
      ...this._svcFields,
      rut: this._svcReduction === 'rut',
      rot: this._svcReduction === 'rot',
    };
    try {
      const result = tmpl.calc(fields);
      const {ls, exVat, rutAmt} = result;
      if (!exVat && exVat !== 0) {
        prev.innerHTML = `<div class="off-svc-preview-empty">Fyll i obligatoriska fält för att se kalkylen.</div>`;
        return;
      }
      const vat    = Math.round(exVat * _normVat(tmpl.vatRate) / 100);
      const incVat = exVat + vat;
      const custPr = incVat - (rutAmt||0);
      const redLbl = this._svcReduction === 'rut' ? 'RUT' : this._svcReduction === 'rot' ? 'ROT' : '';

      // Internal calc detail (small, muted)
      let html = '';
      if (result.tierLbl) {
        html += `<div class="off-svc-preview-tier">Prisnivå: ${result.tierLbl}</div>`;
      }
      html += `<div class="off-svc-preview-detail">`;
      ls.forEach(l => {
        html += `<div class="off-svc-preview-detail-line">${l.desc} · ${l.qty} ${l.unit} × ${fmt(l.price)} kr = ${fmt(Math.round(l.qty*l.price))} kr</div>`;
      });
      html += `</div>`;

      // Price rows
      html += `<div class="off-svc-preview-row"><span>Ex. moms</span><span>${fmt(exVat)} kr</span></div>`;
      html += `<div class="off-svc-preview-row off-svc-preview-row--vat"><span>Moms ${_normVat(tmpl.vatRate)}%</span><span>${fmt(vat)} kr</span></div>`;
      html += `<div class="off-svc-preview-row--total${rutAmt?' has-deduction':''}">
        <span>Totalt inkl. moms</span><span>${fmt(incVat)} kr</span></div>`;

      if (rutAmt) {
        html += `<div class="off-svc-preview-deduction">
          <span>Prelim. ${redLbl}-avdrag</span><span>-${fmt(rutAmt)} kr</span></div>`;
      }

      // Customer price — always shown, prominent
      const displayPrice = rutAmt ? custPr : incVat;
      html += `<div class="off-svc-preview-price">
        <span class="off-svc-preview-price-label">Kundpris inkl. moms</span>
        <span class="off-svc-preview-price-val">${fmt(displayPrice)} kr</span>
      </div>`;
      if (rutAmt) {
        html += `<div class="off-svc-preview-note">* Prelim., förutsätter rätt till avdraget</div>`;
      }

      prev.innerHTML = html;
    } catch(e) {
      prev.innerHTML = `<div class="off-svc-preview-empty">Fyll i obligatoriska fält (markerade *) för att se kalkyl.</div>`;
    }
  },

  /* ── Add/update service line ─── */
  _addSvcLine() {
    const tmpl = this._getT().find(t => t.id === this._activeSvcId);
    if (!tmpl) { showToast('Välj en tjänstetyp'); return; }
    // Collect non-reduction fields from DOM
    tmpl.fields.forEach(f => {
      if (f.type==='chips' || f.isRut || f.isRot) return;
      const el = document.getElementById('svc-f-' + f.id);
      if (!el) return;
      if (f.type==='bool')            this._svcFields[f.id] = el.checked;
      else if (f.type==='number')     this._svcFields[f.id] = parseFloat(el.value)||0;
      else if (f.type==='pricegroup') {
        this._svcFields[f.id] = el.value;
        const _pg = (state.priceGroups||[]).find(p=>p.id===el.value);
        if (_pg) this._svcFields['rate'] = _pg.hourRate;
      } else                          this._svcFields[f.id] = el.value;
    });
    // Inject unified reduction
    this._svcFields.rut = this._svcReduction === 'rut';
    this._svcFields.rot = this._svcReduction === 'rot';
    const missing = tmpl.fields.filter(f=>f.req&&!f.isRut&&!f.isRot&&!this._svcFields[f.id]&&this._svcFields[f.id]!==0);
    if (missing.length) { showToast('Fyll i: ' + missing.map(f=>f.label).join(', ')); return; }
    const result  = tmpl.calc(this._svcFields);
    const {ls, exVat, rutAmt} = result;
    const desc = (document.getElementById('svc-custom-desc')?.value||'').trim() || tmpl.defaultDesc;
    const lineData = {
      id:              'SVC' + Date.now(),
      type:            'service',
      templateId:      tmpl.id,
      templateName:    tmpl.name,
      description:     desc,
      subLines:        ls.map(l=>({...l})),
      exVat:           Math.round(exVat),
      vatRate:         tmpl.vatRate,
      rutAmount:       Math.round(rutAmt||0),
      reductionType:   this._svcReduction,
      total:           Math.round(exVat),
      inputValues:     {...this._svcFields},
      priceRuleRef:    tmpl.id,
      tierLbl:         result.tierLbl||'',
      calculationNote: result.tierLbl||''
    };
    const editIdx = this._svcEditIdx;
    if (editIdx !== null && editIdx !== undefined && this._editLines[editIdx]) {
      const prev = this._editLines[editIdx];
      lineData.id = prev.id;
      if (prev.description && desc === (tmpl.defaultDesc||'')) lineData.description = prev.description;
      this._editLines[editIdx] = lineData;
    } else {
      this._editLines.push(lineData);
    }
    this._closeSvcCalc();
    const el = document.getElementById('off-lines');
    if (el) el.innerHTML = this._linesHtml();
    this._refreshTotals();
    this._flushDraftNow();
    showToast(editIdx !== null && editIdx !== undefined ? tmpl.name + ' uppdaterad' : tmpl.name + ' tillagd');
  },

  /* ── Save ─── */
  /* V48B3B0 R1: _save() är nu async och väntar på ett BEKRÄFTAT persist()
     (Promise<boolean>, se state.js) innan success/onCreated/navigation körs
     — se RAPPORT-V48B3B0-R1.md DEL 10/12 för fullständig motivering. Detta
     är den kritiska anropsplatsen som tidigare kunde visa "Offert skapad"
     och köra V47:s opts.onCreated(newOff) trots att skrivningen till servern
     ännu inte ens hade skickats, än mindre bekräftats.
     _saveInFlight (DEL 11) förhindrar dubbla samtidiga sparningar om
     användaren dubbelklickar/trycker snabbt medan en sparning pågår. */
  async _save() {
    if (this._saveInFlight) return;
    this._saveInFlight = true;
    /* V3-standard: knappen visar "Sparar…" tills servern svarat. */
    const saveBtn = document.getElementById('offw-save-btn');
    const saveBtnHtml = saveBtn ? saveBtn.innerHTML : '';
    if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = ic('loader',14) + ' <span>Sparar…</span>'; }
    const fail = (msg, ms) => { this._stepMsg = msg; this._renderStepMsg(); showToast(msg, ms); };
    try {
      if (this._wizardStep === 3) {
        const map = {'off-payment':'paymentTerms','off-validity':'validityText','off-terms':'generalTerms','off-note':'internalNote'};
        Object.entries(map).forEach(([id,key]) => {
          const el = document.getElementById(id);
          if (el) this._wizardData[key] = el.value;
        });
      }
      const d = this._wizardData;
      if (!d.customerId) { fail('Välj en kund'); return; }
      const cleanLines = this._cleanLines();
      if (!cleanLines.some(l=>l.type!=='text')) { fail('Lägg till minst en offertrad eller tjänst'); return; }
      const cleanExtras = this._cleanExtras();
      /* G8: samma regel som fakturan — avdraget får inte överstiga totalen. */
      if (typeof OfferCalc !== 'undefined' && OfferCalc.validate) {
        const v = OfferCalc.validate({ lines: cleanLines, extras: cleanExtras, discount: this._discount });
        if (!v.ok) { fail(v.issues[0].message, 7000); return; }
      }
      const now  = new Date().toISOString();
      const data = {
        customerId:   d.customerId,
        title:        d.title        || '',
        summary:      d.summary      || '',
        scope:        d.scope        || '',
        includes:     d.includes     || '',
        excludes:     d.excludes     || '',
        lines:        cleanLines.map(l=>{
          /* (samma mappning som _linesForSave(), som granskningssteget använder) */
          if(l.type==='service'||l.type==='text') return {...l};
          /* OFFER CORE R1: återanvänder den KANONISKA _lineExVat() istället
             för en egen, naiv qty*unitPrice-omräkning — annars skulle
             en 'rate'/'option'-rad kunna spara ett felaktigt, icke-noll
             `total` som (via de befintliga icke-kanoniska summerarna i
             CustomersPage.js/ReportsPage.js) tyst räknas in i andra
             ställens offertsummor trots att den aldrig ska ingå i någon
             totalsumma. Se RAPPORT §Prismodell. */
          return {...l, total: _lineExVat(l)};
        }),
        extras:       cleanExtras,
        /* OFFER CORE R1 — PART B: offerten bär nu sin egen, explicit
           användarvalda `propertyId` (via CustomerPicker+fastighets-
           dropdownen i steg 1) när en sådan finns — tidigare sattes
           detta fält ALDRIG av formuläret alls (se kommentaren om
           `effectivePropertyId` nedan för det tidigare, endast-vid-
           redigering-genom-kontext-beteendet). */
        propertyId:   d.propertyId   || '',
        /* OFFER CORE R1.2 — BLOCKER 3 (traced first, see RAPPORT
           §Property/address-trace): propertyId is the CANONICAL
           relation; off.address is the field EVERY customer-facing
           surface (public-offer.html's facts, printPdf(), the digital
           link snapshot, offer-pdf, offer-public-pdf) already reads for
           "Fastighet: ..." — none of those surfaces have access to
           state.properties (public-offer.html/both PDFs are fully
           standalone/offline, reading only the offer's own stored/
           snapshotted fields). The wizard has NEVER had a manual
           address input bound to off.address (grep-verified — this
           field has been silently unpopulated since it was added to
           Schema.offer(), for every offer that has ever been saved).
           Deriving it HERE, automatically, at save time — the ONE
           place a resolved property is known — means every existing
           consumer of off.address gets the correct value with ZERO
           changes to their own rendering code, and the user never has
           to duplicate the address as free text.
           OFFER CORE R1.3 — BLOCKER 3 (motbevis-granskad): R1.2's
           inline fallback here ALWAYS reused the previously-saved
           off.address whenever d.propertyId was empty — indistinguishable
           from "genuinely never had a property" (legacy, preserve) vs.
           "the user just explicitly cleared a previously-set property"
           (must blank the now-stale address, or the public offer/PDFs
           would keep showing a property the user removed). Routed
           through the new _deriveOfferAddressForSave() (see its own
           header for the full A/B/C/D case breakdown), which is the
           ONLY place that combines the wizard's CURRENT propertyId with
           the offer's PREVIOUSLY-SAVED propertyId to distinguish those
           two cases — deliberately NOT folded into the render-only
           _offPropertyDisplayText(), which has no notion of "what the
           user just did". */
        address: _deriveOfferAddressForSave(d, this._editOfferId ? getOff(this._editOfferId) : null),
        validUntil:   d.validUntil   || '',
        paymentTerms: d.paymentTerms || '',
        validityText: d.validityText || '',
        generalTerms: d.generalTerms || '',
        internalNote: d.internalNote || '',
        discount:     this._discount || {type:'percent', value:0},
        sectionOrder: _resolveSectionOrder(this._editSectionOrder),
        updatedAt:    now
      };
      /* V54B R1 — blockerare 6: kontrollerade tidigare ENDAST
         `proj.customerId === d.customerId` — dvs. helt utan hänsyn till
         offertens fastighet, trots att offertformuläret INTE har något
         eget redigerbart fastighetsfält (offertens `propertyId` sätts
         bara vid skapande via kontext, se _initFreshOffer(), och rörs
         aldrig av detta formulär i övrigt). Den EFFEKTIVA fastigheten —
         den befintliga offertens `propertyId` vid redigering, annars
         tom vid nyskapande — måste ändå vägas in via den kanoniska
         `ProjectService.isChildCompatible()`, exakt som AO/Uppgift
         redan gör, annars kunde en offert bära en Projekt-koppling som
         är fastighets-inkompatibel (t.ex. ett enfastighetsprojekt med
         en annan fastighet hos samma kund). Vid inkompatibilitet
         BLOCKERAS sparningen istället för att tyst rensa kopplingen —
         samma disciplin som §15/blockerare 3 för Uppgifter. */
      /* OFFER CORE R1.4 — BLOCKER 3 (motbevis-granskad): the comment
         above (and the code it originally justified) predates the
         property picker's ability to explicitly clear a previously-set
         property — at that time the offer form genuinely had "no
         editable property field", so falling back to the EXISTING
         offer's propertyId when d.propertyId was empty was the only
         sane behavior. That assumption is no longer true: R1 added a
         real, explicit property field (`CustomerPicker`+the fastighets-
         dropdown), and `_wizardData.propertyId` is ALREADY correctly
         seeded from the existing offer when editing begins
         (`openEdit()`) and ALREADY correctly updated the instant the
         user changes or clears it (`_customerChanged()`/the property
         dropdown's onchange). Falling back to the existing offer's
         propertyId` here therefore does exactly one thing: it silently
         UNDOES an explicit clear/change for THIS validation step only
         — R1.3 already fixed the SAVED `address`/`propertyId` fields
         to correctly reflect a clear, but this separate compatibility
         check could still validate (and therefore allow) the OLD,
         no-longer-selected property. `effectivePropertyId` is now
         simply `d.propertyId || ''` — the same value that gets saved,
         with NO historical fallback. A legacy offer opened and re-saved
         without ever touching the property field is unaffected (its
         `_wizardData.propertyId` was already seeded to the same value
         this fallback would have produced). */
      const effectivePropertyId = d.propertyId || '';
      if (d.projectId) {
        const compatible = typeof ProjectService !== 'undefined' &&
          ProjectService.isChildCompatible(d.projectId, d.customerId, effectivePropertyId);
        if (!compatible) {
          showToast('Offerten kan inte kopplas till projektet — kund eller fastighet stämmer inte överens.');
          return;
        }
        data.projectId = d.projectId;
      } else {
        data.projectId = '';
      }
      const offerId = this._editOfferId;
      if (!offerId) {
        const newOff = Object.assign(Schema.offer(), data, {
          id: newId(state.offers,'OFF'), status:'utkast', timeline: [],
          createdAt: d.date ? d.date + 'T00:00:00.000Z' : now
        });
        OfferDetailPage._logEvt(newOff, 'create', 'Offert skapad');
        state.offers.push(newOff);
        /* C1 (2026-11-12): scoped to the key this code path mutated — an unrelated key's rejection (activityLog) is not this save's failure. */
        let ok = await persist({ keys: ['offers'] });
        /* N1 (2026-11-12): classify the failure before rolling back — see
           settlePersistFailure() in state.js. landed -> it WAS created
           (success path; a retry would have made a duplicate); diverged ->
           another session's offer now holds this number (conflict dialog,
           wizard stays open, nothing spliced out of the server's view);
           rejected -> rollback + journal forgotten (never re-created on
           the next load); not-landed/unknown -> rollback, kept as an
           "osparad ändring" (Återuppta/Kasta). */
        let _n1 = { fate: 'none' };
        if (!ok && typeof settlePersistFailure === 'function') {
          _n1 = await settlePersistFailure('offers', newOff.id);
          if (_n1.fate === 'landed') ok = true;
        }
        if (!ok && _n1.fate === 'diverged') {
          showToast('Offertnumret ' + newOff.id + ' användes samtidigt av en annan session — välj i konfliktdialogen. Offerten är inte sparad.', 7000);
          return;
        }
        if (!ok) {
          /* Rollback (strategi A, se RAPPORT DEL 12): ta bort den nyss
             pushade offerten ur lokal state igen så den inte visas som
             skapad. Wizarddata (_wizardData/_editLines/_editExtras) lämnas
             helt orörd — wizarden stängs INTE — så användaren kan trycka
             Spara igen utan att fylla i något på nytt. Ingen risk för
             dubblett-offert vid retry: ett nytt _save()-anrop bygger ett
             helt nytt newOff med ett nytt newId(). */
          const idx = state.offers.indexOf(newOff);
          if (idx !== -1) state.offers.splice(idx, 1);
          /* V48B3B0 R1.1: persist() -> Storage.setAll() hann redan skriva
             den nu tillbakarullade offerten till localStorage['vift_offers']
             synkront, innan nätverkssvaret var känt. Utan denna rad skulle
             en offline-reload (initState() -> Storage._localAll()) kunna
             återuppliva OFF-xxx trots att den aldrig sparades server-sidigt
             — se RAPPORT-V48B3B0-R1.1.md. */
          Storage.setLocal('offers', state.offers);
          if (_n1.fate === 'not-landed' || _n1.fate === 'unknown') {
            showToast('Offerten kunde inte sparas. Den ligger kvar som osparad — välj Återuppta eller Kasta i meddelandet överst.', 8000);
          } else {
            showToast('Kunde inte spara offerten — kontrollera anslutningen och försök igen');
          }
          return;
        }
        /* V47: callback körs EFTER lyckad, BEKRÄFTAD persist, aldrig innan — se openCreate(). */
        const onCreated = this._createOnCreated;
        this._createOnCreated = null;
        if (typeof onCreated === 'function') {
          try { onCreated(newOff); } catch (e) { console.warn('[OffersPage] onCreated-fel:', e); }
        }
        /* V48B4A: draften rensas HÄR, ENDAST efter bekräftad, lyckad
           persist — aldrig tidigare (se §21/§26). skipDraftFlush:true
           förhindrar att _wizardClose()s vanliga flush återuppliver den
           precis borttagna draften. */
        this._draftRemove();
        this._wizardClose({ skipDraftFlush: true });
        Router.showPage('pg-offer');
        showToast('Offert ' + newOff.id + ' skapad');
      } else {
        const idx = (state.offers||[]).findIndex(o=>o.id===offerId);
        if (idx < 0) return;
        const prevOffer = state.offers[idx];
        const updated = Object.assign({}, state.offers[idx], data);
        /* N1 (2026-11-12): the shallow copy above SHARED `timeline` with
           prevOffer, so _logEvt() pushed "Offert redigerad" into the copy
           the rollback below restores. After a failed save the restored
           offer therefore still differed from the server, and the next
           persist() of the key silently saved that event (and, via M4, it
           was replayed after reload). Own array for the edited copy. */
        updated.timeline = Array.isArray(prevOffer.timeline) ? prevOffer.timeline.slice() : [];
        OfferDetailPage._logEvt(updated, 'edit', 'Offert redigerad');
        state.offers[idx] = updated;
        /* C1 (2026-11-12): scoped to the key this code path mutated — an unrelated key's rejection (activityLog) is not this save's failure. */
        let ok = await persist({ keys: ['offers'] });
        let _n1 = { fate: 'none' };
        if (!ok && typeof settlePersistFailure === 'function') {
          _n1 = await settlePersistFailure('offers', offerId); // N1, see create above
          if (_n1.fate === 'landed') ok = true;
        }
        if (!ok && (_n1.fate === 'conflict' || _n1.fate === 'diverged')) {
          /* N1/conflict: state.offers already holds the SERVER's current
             offer (merge-write `current`, or adopted by the re-check).
             The old rollback below put `prevOffer` (this session's stale
             pre-edit copy) back over it, so the next persist() of the key
             sent it with the server's value as `previous` and silently
             reverted the other session's confirmed change. The edit is in
             the conflict dialog; the wizard stays open. */
          Storage.setLocal('offers', state.offers);
          showToast('Offerten ändrades samtidigt av en annan session — välj i konfliktdialogen.', 6000);
          return;
        }
        if (!ok) {
          /* Samma rollback-princip som ovan — återställ till exakt det
             offer-objekt som fanns innan detta redigeringsförsök.
             N1: by id after the await (the array may have been replaced). */
          const _ri = (state.offers || []).findIndex(o => o.id === offerId);
          if (_ri >= 0) state.offers[_ri] = prevOffer;
          /* V48B3B0 R1.1: samma lokala cache-synk som vid failed create. */
          Storage.setLocal('offers', state.offers);
          if (_n1.fate === 'not-landed' || _n1.fate === 'unknown') {
            showToast('Ändringarna kunde inte sparas. De ligger kvar som osparade — välj Återuppta eller Kasta i meddelandet överst.', 8000);
          } else {
            showToast('Kunde inte spara ändringarna — kontrollera anslutningen och försök igen');
          }
          return;
        }
        this._wizardClose();
        OfferDetailPage.render({offerId});
        showToast('Offert uppdaterad');
      }
    } finally {
      this._saveInFlight = false;
      if (saveBtn && document.body.contains(saveBtn)) { saveBtn.disabled = false; saveBtn.innerHTML = saveBtnHtml; }
    }
  }
};


/* ── PART 10: OfferDetailPage ─────────── */
const OfferDetailPage = {
  offerId: null,

  /* QA 2026-11-26 (offerter) — OFFERTDETALJ V3. En sammanhållen vy i samma
     mönster som arbetsorderdetaljen (aod-*): huvud med identitet (nummer,
     titel, version), kund, fastighet, giltighet och status; beloppsrad med
     exkl./inkl. moms (alltid utskrivet, siffrorna direkt ur
     _offerCalcTotals()/OfferCalc); EN primär åtgärd per status plus ett fåtal
     sekundära och resten i "⋮"-menyn (_actionModel). Därunder en lägesrad
     (vad händer nu?) och ett tvåkolumnsrutnät: offertens innehåll (i
     off.sectionOrder-ordning, som kunden ser det) till vänster; kundens
     svar, arbetsorder, digital länk, kund, intern anteckning, bilagor och
     säljtips till höger; historik sist. Inga nya statusövergångar eller
     affärsregler — varje knapp anropar exakt samma funktion som tidigare. */
  render(params) {
    const el = document.getElementById('pg-offer-detail-content');
    if (!el) return;
    const id = params && params.offerId;
    this.offerId = id;
    const off = id ? getOff(id) : null;
    if (typeof aoCloseOverflow === 'function') aoCloseOverflow();
    if (!off) { el.innerHTML = `<div class="empty">${ic('file-text',32)}<h3>Offert hittades inte</h3><p>Offerten kan ha raderats eller så saknar du behörighet.</p></div>`; return; }

    const sid = _offSafeId;
    const cu = getCu(off.customerId);
    const cuName = cu ? CustomerService.displayName(cu) : '—';
    const T = _offerCalcTotals(off);
    const vatRows = _offVatBreakdown(off);
    const hasOneTime = T.rawExVat > 0;
    const hasRecurring = !!T.recurringMonthlyExVat;
    const closed = !!(off.archived || off.deleted);
    const activeStatuses = ['utkast', 'skickad', 'påmind', 'väntar', 'ändring-begärd'];
    const daysLeft = off.validUntil ? Math.ceil((new Date(String(off.validUntil).slice(0, 10) + 'T23:59:59').getTime() - Date.now()) / 86400000) : null;
    const validCls = (activeStatuses.includes(off.status) && daysLeft !== null) ? (daysLeft < 0 ? ' is-late' : (daysLeft <= 7 ? ' is-warn' : '')) : '';
    const ver = Number(off.versionNumber) || 1;
    const propText = _offPropertyDisplayText(off);
    const parentId = sid(off.parentOfferId);

    // ── Beloppsrad (samma siffror som summeringen nedan och OfferCalc) ──
    const amt = (label, value, sub, cls) => `<div class="offd-amt${cls ? ' ' + cls : ''}"><dt>${label}</dt><dd>${value}</dd>${sub ? `<span class="offd-amt-sub">${sub}</span>` : ''}</div>`;
    const amounts = [];
    if (hasRecurring) amounts.push(amt('Fast kostnad per månad', fmt(T.recurringMonthlyExVat) + ' kr', 'exkl. moms · ' + fmt(T.recurringAnnualExVat) + ' kr/år', hasOneTime ? '' : 'is-main'));
    if (hasOneTime) {
      amounts.push(amt(hasRecurring ? 'Engångsbelopp exkl. moms' : 'Exkl. moms', fmt(T.exVatAfterDiscount) + ' kr', T.discountAmount ? 'efter rabatt −' + fmt(T.discountAmount) + ' kr' : ''));
      amounts.push(amt('Moms', fmt(T.vatAmount) + ' kr', vatRows.map(r => _offPct(r.rate)).join(' / ')));
      if (T.rutRotAmount) {
        amounts.push(amt(hasRecurring ? 'Engångsbelopp inkl. moms' : 'Totalt inkl. moms', fmt(T.totalInclVat) + ' kr', ''));
        amounts.push(amt('Kund betalar inkl. moms', fmt(T.customerPays) + ' kr', 'efter RUT/ROT −' + fmt(T.rutRotAmount) + ' kr', 'is-main'));
      } else {
        amounts.push(amt(hasRecurring ? 'Engångsbelopp inkl. moms' : 'Totalt inkl. moms', fmt(T.totalInclVat) + ' kr', '', 'is-main'));
      }
    }
    if (!hasOneTime && !hasRecurring) {
      const variable = _offRateAndOptionLines(off).length || _offOptionalExtras(off).length;
      amounts.push(amt('Prismodell', variable ? 'Rörliga priser' : 'Inga prisrader', variable ? 'ingår inte i någon totalsumma' : '', 'is-main'));
    }

    // ── Åtgärdsrad: en primär, några sekundära, resten i "⋮"-menyn ──
    const A = this._actionModel(off);
    const btn = (a, cls) => `<button type="button" class="btn ${cls} bsm${a.tone ? ' offd-btn--' + a.tone : ''}" onclick="${a.fn}"${a.title ? ` title="${esc(a.title)}"` : ''}>${ic(a.icon, 14)}<span>${esc(a.label)}</span></button>`;
    const menuRows = A.menu.map((it, i) => (it.divider && i > 0 ? '<div class="ao-overflow-divider" role="separator"></div>' : '') +
      (it.group ? `<div class="offd-menu-group">${esc(it.group)}</div>` : '') +
      `<button type="button" class="ao-overflow-menu-item${it.destructive ? ' ao-overflow-menu-item--red' : ''}" role="menuitem" onclick="aoCloseOverflow();${it.fn}">${ic(it.icon, 14)}<span>${esc(it.label)}</span></button>`).join('');
    const actionsHtml = `<div class="offd-actions" role="group" aria-label="Åtgärder">
        ${A.primary ? btn(A.primary, A.primary.variant || 'bp') : ''}
        ${A.inline.map(a => btn(a, 'bs')).join('')}
        ${A.menu.length ? `<div class="ao-overflow-wrap offd-more">
          <button type="button" class="ibtn offd-more-btn" id="offd-more-btn" aria-label="Fler åtgärder" title="Fler åtgärder" aria-haspopup="menu" aria-expanded="false" onclick="OfferDetailPage._toggleMenu('offd-more-menu',this)">${ic('more-vertical', 18)}</button>
          <div class="ao-overflow-menu offd-menu" id="offd-more-menu" role="menu" aria-label="Fler åtgärder">${menuRows}</div>
        </div>` : ''}
      </div>`;

    // ── Innehåll i kundens ordning (off.sectionOrder) ──
    const rt = (v) => OfferDetailPage._renderText(v);
    const fieldBlock = (label, html) => `<div class="offd-field"><div class="offd-field-l">${label}</div><div class="offd-field-v off-rt">${html}</div></div>`;
    const descriptionHtml = (off.summary || off.scope || off.includes || off.excludes) ? `
      <section class="card offd-card">
        <div class="card-header"><h3>${ic('align-left', 15)} Uppdragsbeskrivning</h3></div>
        <div class="card-body offd-desc">
          ${off.summary ? fieldBlock('Sammanfattning', rt(off.summary)) : ''}
          ${off.scope ? fieldBlock('Uppdragets omfattning', rt(off.scope)) : ''}
          ${(off.includes || off.excludes) ? `<div class="offd-incl">
            ${off.includes ? `<div class="offd-incl-col is-in"><div class="offd-field-l">${ic('check', 13)} Ingår</div><div class="offd-field-v off-rt">${rt(off.includes)}</div></div>` : ''}
            ${off.excludes ? `<div class="offd-incl-col is-out"><div class="offd-field-l">${ic('x', 13)} Ingår ej</div><div class="offd-field-v off-rt">${rt(off.excludes)}</div></div>` : ''}
          </div>` : ''}
        </div>
      </section>` : '';
    const nPriced = (off.lines || []).filter(l => l.type !== 'text').length;
    const pricingHtml = `
      <section class="card offd-card offd-content">
        <div class="card-header"><h3>${ic('file-text', 15)} Offertinnehåll</h3><span class="bdg bdg-grey">${nPriced} ${nPriced === 1 ? 'prisrad' : 'prisrader'}${(off.extras || []).length ? ' · ' + off.extras.length + ' tillval' : ''}</span></div>
        ${this._linesTableHtml(off, { idp: sid(off.id) })}
        ${this._totalsRowsHtml(off)}
      </section>`;
    const commercialTermsHtml = (off.paymentTerms || off.validityText) ? `
      <section class="card offd-card">
        <div class="card-header"><h3>${ic('receipt', 15)} Offertvillkor</h3></div>
        <div class="card-body"><dl class="offd-facts">
          ${off.paymentTerms ? `<div><dt>Betalningsvillkor</dt><dd class="off-rt">${rt(off.paymentTerms)}</dd></div>` : ''}
          ${off.validityText ? `<div><dt>Giltighetstid</dt><dd class="off-rt">${rt(off.validityText)}</dd></div>` : ''}
        </dl></div>
      </section>` : '';
    /* Säkerhet: allmänna villkor är fritext från guiden — escapas (renderades
       tidigare oescapat). Radbrytningar behålls. */
    const generalTermsHtml = off.generalTerms ? `
      <section class="card offd-card">
        <div class="card-header"><h3>${ic('file-text', 15)} Allmänna villkor</h3></div>
        <div class="card-body"><p class="offd-terms">${esc(off.generalTerms)}</p></div>
      </section>` : '';
    const renderers = { description: descriptionHtml, pricing: pricingHtml, commercialTerms: commercialTermsHtml, generalTerms: generalTermsHtml };
    const mainHtml = _resolveSectionOrder(off.sectionOrder).map(k => renderers[k] || '').join('');

    const sideHtml = [
      this._responseHtml(off),
      this._aoCardHtml(off),
      this._digitalLinkPanel(off),
      this._customerCardHtml(off, cu),
      off.internalNote ? `<div class="offd-note">${ic('lock', 14)}<div><strong>Intern anteckning</strong><span>${esc(off.internalNote)}</span></div></div>` : '',
      this._attachmentsPanel(off),
      this._salesAssistantHtml(off)
    ].join('');

    el.innerHTML = `
      <div class="offd">
        ${off.deleted ? `<div class="nbox offd-banner is-danger">${ic('trash', 14)} Offerten ligger i papperskorgen. Återställ den för att kunna arbeta vidare.</div>` : ''}
        ${off.archived && !off.deleted ? `<div class="nbox offd-banner">${ic('archive', 14)} Offerten är arkiverad och syns inte i standardlistorna.</div>` : ''}
        <header class="card offd-head">
          <div class="offd-head-top">
            <button type="button" class="btn bghost bsm offd-back" onclick="Router.back()" title="Tillbaka">${ic('arrow-left', 15)}<span class="offd-back-l">Tillbaka</span></button>
            <span class="offd-no">${esc(off.id)}</span>
            ${(ver > 1 || parentId) ? `<span class="bdg bdg-purple offd-ver">Version ${ver}</span>` : ''}
            <div class="offd-status">${this._statusMenuHtml(off)}</div>
          </div>
          <h2 class="offd-title">${esc(off.title || 'Offert utan rubrik')}</h2>
          <div class="offd-meta">
            ${cu ? `<span class="offd-meta-i offd-meta-cu"><a class="offd-cu-link" role="link" tabindex="0" onclick="Router.showPage('pg-crm-detail',{customerId:'${sid(cu.id)}'})" onkeydown="if(event.key==='Enter')this.click()">${ic('building-2', 14)}<span>${esc(cuName)}</span></a><span class="offd-cutype">${esc(CustomerService.typeLabel(cu.type))}</span></span>` : `<span class="offd-meta-i">${ic('building-2', 14)}<span>Ingen kund</span></span>`}
            ${propText ? `<span class="offd-meta-i">${ic('map-pin', 14)}<span>${esc(propText)}</span></span>` : ''}
            ${off.validUntil ? `<span class="offd-meta-i${validCls}">${ic('calendar', 14)}<span>Giltig t.o.m. ${fmtDate(off.validUntil)}${validCls === ' is-warn' ? ` (${daysLeft} ${daysLeft === 1 ? 'dag' : 'dagar'} kvar)` : ''}${validCls === ' is-late' ? ' (passerad)' : ''}</span></span>` : ''}
            ${off.createdAt ? `<span class="offd-meta-i">${ic('clock', 14)}<span>Skapad ${fmtDate(off.createdAt)}</span></span>` : ''}
            ${parentId ? `<a class="offd-meta-i is-link" role="link" tabindex="0" onclick="Router.showPage('pg-offer-detail',{offerId:'${parentId}'})" onkeydown="if(event.key==='Enter')this.click()">${ic('git-branch', 14)}<span>Ersätter ${esc(parentId)}</span></a>` : ''}
          </div>
          <dl class="offd-amounts">${amounts.join('')}</dl>
          ${actionsHtml}
        </header>
        ${this._statusStripHtml(off)}
        <div class="offd-grid">
          <div class="offd-main">
            ${mainHtml}
            ${this._timelineHtml(off)}
          </div>
          <aside class="offd-side" aria-label="Kund, svar och länk">${sideHtml}</aside>
        </div>
      </div>`;
  },

  /* Åtgärdsmodell per status — ENDAST befintliga funktioner och övergångar.
     Inventering av den tidigare vyn (alla finns kvar):
       huvud-CTA: utkast→showSendModal · skickad/påmind/väntar→_quickAction
         ('followup') · godkänd utan AO→createAO (spärrtext från
         _offAOBlockedCtaText vid momsspärr m.m.) · nekad→createNewVersion ·
         utgången→duplicate ("Förnya");
       knapprad: showReminderModal (skickad/påmind/väntar) · "Skapa AO"
         (dubblett av CTA, tas bort) · AO-länk · restoreOffer (arkiverad/
         borttagen) · openFlerAtgarder;
       Fler åtgärder: openEdit · printPdf · createNewVersion · duplicate ·
         archiveOffer · deleteOffer · permanentDeleteOffer;
       statusmeny: openApprovalModal · setStatus(nekad|väntar|utgången);
       paneler: digital länk (generera/återkalla/förläng/kopiera), bilagor,
         säljtips, historik (snabbloggning, kommentar, uppföljningar).
     Statusmenyns övergångar finns kvar i statusmärket och upprepas i
     "⋮"-menyn under rubriken Status så att de går att hitta. */
  _actionModel(off) {
    const id = _offSafeId(off.id);
    const A = (label, icon, fn, extra) => Object.assign({ label, icon, fn }, extra || {});
    const st = off.status;
    const closed = !!(off.archived || off.deleted);
    const sentLike = st === 'skickad' || st === 'påmind' || st === 'väntar';
    const fEdit = `OffersPage.openEdit('${id}')`;
    const fVer = `OfferDetailPage.createNewVersion('${id}')`;
    const fDup = `OfferDetailPage.duplicate('${id}')`;
    const fAppr = `OfferDetailPage.openApprovalModal('${id}')`;
    let primary = null;
    const inline = [];
    if (closed) {
      primary = A('Återställ offert', 'rotate-ccw', `OfferDetailPage.restoreOffer('${id}')`);
    } else if (st === 'utkast') {
      primary = A('Skicka offert', 'send', `OfferDetailPage.showSendModal('${id}')`);
      if (!this._hasActiveDigitalLink(off)) inline.push(A('Generera länk', 'link', `OfferDetailPage.generateDigitalLink('${id}')`));
      inline.push(A('Redigera', 'pencil', fEdit));
    } else if (sentLike) {
      primary = A('Boka uppföljning', 'bell', `OfferDetailPage._quickAction('${id}','followup')`);
      inline.push(A('Skicka påminnelse', 'send', `OfferDetailPage.showReminderModal('${id}')`));
      inline.push(A('Registrera godkännande', 'check-circle', fAppr));
    } else if (st === 'ändring-begärd') {
      primary = A('Skapa ny version', 'git-branch', fVer);
      inline.push(A('Redigera', 'pencil', fEdit));
    } else if (st === 'godkänd') {
      if (off.workOrderId) {
        primary = A('Öppna arbetsorder', 'clipboard-list', `Router.showPage('pg-ao-detail',{aoId:'${_offSafeId(off.workOrderId)}'})`);
      } else {
        const dec = _offAOConversionDecision(off);
        if (!dec.allowed) {
          const t = _offAOBlockedCtaText(dec.reason, dec.vatRate);
          primary = A(t.label, 'alert-triangle', 'OfferDetailPage.createAO()', { title: t.title, variant: 'bs', tone: 'blocked' });
        } else {
          primary = A('Skapa arbetsorder', 'clipboard-list', 'OfferDetailPage.createAO()');
        }
      }
    } else if (st === 'nekad') {
      primary = A('Skapa ny version', 'git-branch', fVer);
      inline.push(A('Registrera godkännande', 'check-circle', fAppr));
    } else if (st === 'utgången') {
      primary = A('Förnya offert', 'refresh-cw', fDup);
      inline.push(A('Återöppna offert', 'rotate-ccw', `OfferDetailPage.setStatus('väntar')`));
    }
    const shown = (fn) => [primary].concat(inline).some(a => a && a.fn === fn);
    const menu = [];
    if (!closed && !shown(fEdit)) menu.push(A('Redigera offert', 'pencil', fEdit));
    menu.push(A('Skriv ut / PDF', 'printer', `OfferDetailPage.printPdf('${id}')`));
    if (!off.deleted && !shown(fVer)) menu.push(A('Skapa ny version', 'git-branch', fVer));
    if (!off.deleted && !shown(fDup)) menu.push(A('Duplicera', 'copy', fDup));
    const statusActs = this._statusMenuActions(off).filter(a => !shown(a.onClick));
    statusActs.forEach((a, i) => menu.push(A(a.label, a.icon, a.onClick, i === 0 ? { divider: true, group: 'Status' } : null)));
    if (!closed) {
      menu.push(A('Arkivera', 'archive', `OfferDetailPage.archiveOffer('${id}')`, { divider: true }));
      menu.push(A('Flytta till papperskorgen', 'trash', `OfferDetailPage.deleteOffer('${id}')`, { destructive: true }));
    }
    if (off.deleted) menu.push(A('Radera permanent', 'trash-2', `OfferDetailPage.permanentDeleteOffer('${id}')`, { destructive: true, divider: true }));
    return { primary, inline, menu };
  },

  /* "⋮"-menyn: delade aoToggleOverflow (Escape/klick utanför/en meny i
     taget) + position:fixed så att menyn aldrig klipps av kortets kant —
     samma lösning som arbetsorderdetaljen (_toggleActionsMenu). */
  _toggleMenu(menuId, btn) {
    const menu = document.getElementById(menuId);
    if (!menu || !btn) return;
    const wasOpen = menu.classList.contains('open');
    aoToggleOverflow(menuId, btn);
    if (!wasOpen && menu.classList.contains('open')) {
      const r = btn.getBoundingClientRect();
      menu.style.position = 'fixed';
      /* Högerkant mot knappen, men alltid helt inom skärmen (knappen kan
         ligga till vänster när åtgärdsraden bryts på mobil). */
      const mw = menu.offsetWidth || 240;
      const left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8));
      menu.style.right = 'auto';
      menu.style.left = left + 'px';
      const below = window.innerHeight - r.bottom - 12;
      if (below < 260 && r.top > below) {
        menu.style.top = 'auto';
        menu.style.bottom = Math.max(8, window.innerHeight - r.top + 4) + 'px';
        menu.style.maxHeight = Math.max(160, r.top - 16) + 'px';
      } else {
        menu.style.bottom = 'auto';
        menu.style.top = (r.bottom + 4) + 'px';
        menu.style.maxHeight = Math.max(160, below) + 'px';
      }
      const first = menu.querySelector('button');
      if (first) setTimeout(() => first.focus(), 0);
    }
  },

  /* Lägesrad: "vad gäller nu?" — en mening per status, plus länköppningar,
     påminnelse och nästa inbokade uppföljning. Ren presentation. */
  _statusStripHtml(off) {
    const st = off.status;
    const now = Date.now();
    const ago = (iso) => { if (!iso) return null; const d = Math.floor((now - new Date(iso).getTime()) / 86400000); return d < 0 ? 0 : d; };
    const dagar = (n) => n + ' ' + (n === 1 ? 'dag' : 'dagar');
    let tone = 'neutral', icon = 'info', text = '';
    const subs = [];
    if (off.deleted) { tone = 'danger'; icon = 'trash'; text = 'I papperskorgen — återställ offerten för att arbeta vidare.'; }
    else if (off.archived) { icon = 'archive'; text = 'Arkiverad (' + statusLabel(st) + ').'; }
    else if (st === 'utkast') { text = 'Utkast — offerten är inte skickad till kunden ännu.'; }
    else if (st === 'skickad' || st === 'påmind' || st === 'väntar') {
      tone = 'info'; icon = 'send';
      const d = ago(off.sentAt);
      text = (off.sentAt ? 'Skickad ' + fmtDate(off.sentAt) : statusLabel(st)) + (d !== null ? ' · väntar på svar sedan ' + dagar(d) : '');
      const vl = off.validUntil ? Math.ceil((new Date(String(off.validUntil).slice(0, 10) + 'T23:59:59').getTime() - now) / 86400000) : null;
      if (vl !== null && vl < 0) { tone = 'warn'; subs.push('Giltighetstiden har passerat'); }
      else if (vl !== null && vl <= 7) { tone = 'warn'; subs.push(dagar(vl) + ' kvar av giltighetstiden'); }
      if (off.reminderSentAt) subs.push('Påminnelse skickad ' + fmtDate(off.reminderSentAt));
    }
    else if (st === 'ändring-begärd') { tone = 'warn'; icon = 'edit-3'; text = 'Kunden har begärt ändringar — skapa en ny version.'; }
    else if (st === 'godkänd') {
      tone = 'ok'; icon = 'check-circle';
      if (off.workOrderId) text = 'Godkänd — arbetsorder ' + off.workOrderId + ' är skapad.';
      else {
        const dec = _offAOConversionDecision(off);
        text = dec.allowed ? 'Godkänd — nästa steg är att skapa arbetsorder.' : 'Godkänd — kan inte bli arbetsorder automatiskt (se Arbetsorder).';
      }
    }
    else if (st === 'nekad') { tone = 'danger'; icon = 'x-circle'; text = 'Nekad' + (off.answeredAt ? ' ' + fmtDate(off.answeredAt) : '') + ' — skapa en ny version om kunden vill ha ett nytt förslag.'; }
    else if (st === 'utgången') { tone = 'warn'; icon = 'alert-circle'; text = 'Offerten har gått ut — förnya den för att skicka samma innehåll igen.'; }
    else if (st === 'ersatt') {
      const next = (state.offers || []).find(o => o.parentOfferId === off.id);
      text = 'Ersatt av en nyare version' + (next ? ' (' + next.id + ').' : '.');
    }
    else { text = statusLabel(st); }
    if (!closed(off) && off.publicToken && !off.tokenRevokedAt && ['skickad', 'påmind', 'väntar', 'utkast'].includes(st)) {
      subs.push(off.openedAt ? 'Kunden har öppnat länken ' + (off.openCount || 1) + ' ' + ((off.openCount || 1) === 1 ? 'gång' : 'gånger') : 'Länken är inte öppnad ännu');
    }
    if (!closed(off) && typeof ActivitiesService !== 'undefined') {
      const next = ActivitiesService.getByRelated('offer', off.id).filter(a => a.status === 'open' && a.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
      if (next) subs.push((next.dueDate < tdy() ? 'Försenad uppföljning ' : 'Nästa uppföljning ') + fmtDate(next.dueDate));
    }
    function closed(o) { return !!(o.archived || o.deleted); }
    return `<div class="offd-next tone-${tone}" role="status">
      <span class="offd-next-ico">${ic(icon, 16)}</span>
      <div class="offd-next-txt"><span class="offd-next-t">${esc(text)}</span>${subs.length ? `<span class="offd-next-s">${subs.map(esc).join(' · ')}</span>` : ''}</div>
    </div>`;
  },

  /* Offertrader som tabell (dator) / kort per rad (mobil), i exakt
     off.lines-ordning (textblock på sin plats). Alla belopp exkl. moms och
     ur _lineExVat — samma underlag som summeringen. Används av detaljvyn
     OCH guidens granskningssteg (samma rendering = samma innehåll). */
  _linesTableHtml(off, opts) {
    opts = opts || {};
    const lines = off.lines || [];
    const extras = off.extras || [];
    if (!lines.length && !extras.length) return `<div class="offd-empty">${ic('file-text', 18)}<span>Inga offertrader</span></div>`;
    const kr = (n) => fmt(n) + ' kr';
    const qtyTxt = (q) => String(q).replace('.', ',');
    const idp = opts.idp || 'x';
    const rows = lines.map((l, idx) => {
      if (l.type === 'text') {
        if (!l.blockTitle && !l.text) return '';
        return `<tr class="offd-lt-text"><td colspan="5">
          ${l.blockTitle ? `<div class="offd-lt-texth">${ic('align-left', 13)}<span>${esc(l.blockTitle)}</span></div>` : ''}
          ${l.text ? `<div class="offd-lt-textb">${esc(l.text)}</div>` : ''}
        </td></tr>`;
      }
      const bt = l.billingType || 'onetime';
      const isSvc = l.type === 'service';
      const isFixed = l.type === 'fixed';
      const ex = _lineExVat(l);
      const rut = _effectiveRutAmount(l);
      const vatTxt = _offPct(_normVat(l.vatRate));
      const name = isSvc ? (l.templateName || 'Tjänst') : (l.description || (isFixed ? 'Fastpris' : 'Rad'));
      const typeLbl = isSvc ? 'Tjänst' : (bt === 'rate' ? '' : (isFixed ? 'Fastpris' : 'Löpande'));
      const unit = (l.unit || '').trim();
      let qty, price, sum;
      if (isSvc) { qty = 'Kalkyl'; price = '—'; sum = kr(ex); }
      else if (bt === 'rate') { qty = '—'; price = kr(+(l.unitPrice || l.price || 0)) + (unit ? '/' + esc(unit) : ''); sum = 'Ingår ej'; }
      else if (isFixed) { qty = 'Fast pris'; price = kr(+(l.unitPrice || 0)); sum = kr(ex); }
      else { const q = (l.qty != null && l.qty !== '') ? l.qty : 1; qty = qtyTxt(q) + ' ' + esc(unit || 'st'); price = kr(+(l.unitPrice || l.price || 0)); sum = kr(ex); }
      if (bt === 'recurring') sum += '/' + (unit ? esc(unit) : 'mån');
      const badges = [
        typeLbl ? `<span class="offd-lt-type">${typeLbl}</span>` : '',
        bt === 'recurring' ? `<span class="bdg bdg-blue">Återkommande</span>` : '',
        bt === 'rate' ? `<span class="bdg bdg-orange">Rörligt à-pris</span>` : '',
        rut ? `<span class="bdg bdg-green">${l.reductionType === 'rot' ? 'ROT' : (l.reductionType === 'rut' ? 'RUT' : 'RUT/ROT')} −${kr(rut)}</span>` : ''
      ].join('');
      const meta = isSvc ? `Beräknad kalkyl · moms ${vatTxt}`
        : bt === 'rate' ? `À-pris ${price} exkl. moms · ingår inte i summan · moms ${vatTxt}`
        : isFixed ? `Fast pris · moms ${vatTxt}` : `${qty} × ${price} · moms ${vatTxt}`;
      const sub = (l.subLines || []);
      const kId = 'kalk-' + idp + '-' + idx;
      const kalk = (isSvc && opts.interactive !== false && (sub.length || l.calculationNote)) ? `
          <button type="button" class="off-line-kalk-btn" onclick="OfferDetailPage._toggleKalk('${kId}')">Visa beräkning</button>
          <div id="${kId}" style="display:none;" class="off-line-kalk">
            ${l.calculationNote ? `<div>${esc(l.calculationNote)}</div>` : ''}
            ${sub.map(s => `<div>${esc(s.desc)} · ${qtyTxt(s.qty)} ${esc(s.unit)} × ${fmt(s.price)} kr = ${fmt(Math.round((+s.qty || 0) * (+s.price || 0)))} kr exkl. moms</div>`).join('')}
          </div>` : '';
      return `<tr class="offd-lt-row${bt !== 'onetime' ? ' is-' + bt : ''}">
        <td class="offd-lt-main">
          <div class="offd-lt-name">${esc(name)}</div>
          <div class="offd-lt-badges">${badges}</div>
          ${isSvc && l.description ? `<div class="offd-lt-desc">${esc(l.description)}</div>` : ''}
          <div class="offd-lt-meta">${meta}</div>
          ${kalk}
        </td>
        <td class="offd-lt-num offd-lt-qty">${qty}</td>
        <td class="offd-lt-num offd-lt-price">${price}</td>
        <td class="offd-lt-num offd-lt-vat">${vatTxt}</td>
        <td class="offd-lt-num offd-lt-sum">${sum}</td>
      </tr>`;
    }).join('');
    const exRows = extras.map(e => {
      const inc = _extraIncludedInTotal(e);
      const exv = (typeof OfferCalc !== 'undefined') ? OfferCalc.extraExVat(e) : Math.round((+(e.qty || 1)) * (+(e.unitPrice || 0)));
      const vatTxt = _offPct(_normVat(e.vatRate));
      const qty = qtyTxt(e.qty || 1) + ' ' + esc(e.unit || 'st');
      return `<tr class="offd-lt-row is-extra${inc ? '' : ' is-optional'}">
        <td class="offd-lt-main">
          <div class="offd-lt-name">${esc(e.description || 'Tillval')}</div>
          <div class="offd-lt-badges"><span class="offd-lt-type">Tillval</span>${inc ? '<span class="bdg bdg-grey">Ingår i summan</span>' : '<span class="bdg bdg-purple">Ingår ej i summan</span>'}</div>
          <div class="offd-lt-meta">${qty} × ${fmt(e.unitPrice || 0)} kr · moms ${vatTxt}</div>
        </td>
        <td class="offd-lt-num offd-lt-qty">${qty}</td>
        <td class="offd-lt-num offd-lt-price">${fmt(e.unitPrice || 0)} kr</td>
        <td class="offd-lt-num offd-lt-vat">${vatTxt}</td>
        <td class="offd-lt-num offd-lt-sum">${fmt(exv)} kr</td>
      </tr>`;
    }).join('');
    const minNote = lines.some(l => l.type !== 'text' && String(l.description || '').includes('minimidebitering'))
      ? `<div class="offd-hint">${ic('info', 13)}<span><strong>Minimidebitering:</strong> Tjänsten har ett lägsta debiteringsbelopp som täcker etablering, utrustning och grundarbete.</span></div>` : '';
    return `<div class="offd-lt-cap">Belopp per rad exkl. moms</div><div class="offd-lt-wrap"><table class="offd-lt">
      <thead><tr><th scope="col">Beskrivning</th><th scope="col" class="offd-lt-num">Antal</th><th scope="col" class="offd-lt-num">À-pris exkl. moms</th><th scope="col" class="offd-lt-num">Moms</th><th scope="col" class="offd-lt-num">Belopp exkl. moms</th></tr></thead>
      <tbody>${rows}</tbody>
      ${exRows ? `<tbody class="offd-lt-extras"><tr class="offd-lt-sec"><th colspan="5" scope="rowgroup">${ic('plus', 13)} Tillval</th></tr>${exRows}</tbody>` : ''}
    </table></div>${minNote}`;
  },

  /* Summering — gemensam för detaljvyn, guidens livesummering och
     granskningssteget. Varje belopp är ett fält ur _offerCalcTotals()
     (OfferCalc.totals) eller _offVatBreakdown() (vars rader summerar exakt
     till vatAmount). Etiketter alltid med "exkl. moms"/"inkl. moms". */
  _totalsRowsHtml(off, opts) {
    opts = opts || {};
    const T = _offerCalcTotals(off);
    const vatRows = _offVatBreakdown(off);
    const hasOne = T.rawExVat > 0;
    const hasRec = !!T.recurringMonthlyExVat;
    const variable = _offRateAndOptionLines(off).length + _offOptionalExtras(off).length;
    const kr = (n) => fmt(n) + ' kr';
    const row = (l, v, cls) => `<div class="offd-tr${cls ? ' ' + cls : ''}"><span class="offd-tr-l">${l}</span><span class="offd-tr-v">${v}</span></div>`;
    const note = (t) => `<div class="offd-tr-note">${t}</div>`;
    let h = '';
    if (hasRec) {
      h += `<div class="offd-tg"><div class="offd-tg-h">Fast kostnad (återkommande)</div>` +
        row('Per månad exkl. moms', kr(T.recurringMonthlyExVat), 'is-strong') +
        row('Moms per månad', kr(T.recurringMonthlyVat)) +
        row('Per månad inkl. moms', kr(T.recurringMonthlyInclVat)) +
        row('Per år exkl. moms (härledd)', kr(T.recurringAnnualExVat), 'is-muted') + `</div>`;
    }
    if (hasOne) {
      const d = off.discount || {};
      h += `<div class="offd-tg">` + (hasRec ? `<div class="offd-tg-h">Engångsbelopp</div>` : '') +
        row('Summa exkl. moms', kr(T.rawExVat)) +
        (T.discountAmount ? row('Rabatt', '−' + kr(T.discountAmount), 'is-disc') +
          note(d.type === 'percent' ? _offPct(Math.min(+d.value || 0, 100)) + ' på engångsbeloppet' : 'Fast rabatt på engångsbeloppet') +
          row('Summa efter rabatt, exkl. moms', kr(T.exVatAfterDiscount)) : '') +
        row('Moms', kr(T.vatAmount)) +
        (vatRows.length > 1 ? vatRows.map(r => row('varav moms ' + _offPct(r.rate), kr(r.vat), 'is-sub')).join('')
          : (vatRows.length === 1 ? note('Momssats ' + _offPct(vatRows[0].rate)) : '')) +
        row('Totalt inkl. moms', kr(T.totalInclVat), T.rutRotAmount ? 'is-strong' : 'is-total') +
        (T.rutRotAmount ? row('RUT/ROT-avdrag (preliminärt)', '−' + kr(T.rutRotAmount), 'is-rut') +
          row('Kund betalar inkl. moms', kr(T.customerPays), 'is-total') +
          note('Avdraget är preliminärt och förutsätter att kunden har rätt till skattereduktion.') : '') +
        `</div>`;
    } else if (!hasRec) {
      h += variable ? row('Prismodell', 'Rörliga priser', 'is-strong') : row('Inga prisrader ännu', '—', 'is-muted');
    }
    if (variable) h += note(hasOne || hasRec ? 'Rörliga à-priser och tillval som inte ingår i summan räknas inte in ovan.' : 'Rörliga à-priser och tillval utanför summan ingår inte i någon totalsumma.');
    return `<div class="offd-totals${opts.compact ? ' is-compact' : ''}">${h}</div>`;
  },

  /* Kundens svar: digitalt godkännande (customerApproval), manuellt
     registrerat godkännande (manualApproval) eller kundens nekande/
     ändringsbegäran (offerEvents från offer-respond). Läser bara. */
  _responseHtml(off) {
    const st = off.status;
    const evOf = (type) => (state.offerEvents || []).filter(e => e.offerId === off.id && e.type === type).sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')))[0];
    const kv = (k, v) => (v ? `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>` : '');
    const card = (tone, icon, title, body) => `<section class="card offd-card offd-resp tone-${tone}">
      <div class="card-header"><h3>${ic(icon, 15)} ${title}</h3></div>
      <div class="card-body"><dl class="offd-facts is-compact">${body}</dl></div>
    </section>`;
    if (st === 'godkänd' && off.manualApproval) {
      const m = off.manualApproval;
      return card('ok', 'check-circle', 'Godkännande registrerat', kv('Via', m.method) + kv('Registrerat av', m.registeredBy) + kv('Datum', m.registeredAt ? fmtDateTime(m.registeredAt) : '') + kv('Kommentar', m.comment));
    }
    const ca = off.customerApproval || {};
    if (st === 'godkänd' && (ca.approvedAt || ca.approvedByName)) {
      return card('ok', 'check-circle', 'Godkänd av kunden', kv('Namn', ca.approvedByName) + kv('E-post', ca.approvedByEmail) + kv('Telefon', ca.approvedByPhone) + kv('Befattning', ca.approvedByPosition) + kv('Datum', ca.approvedAt ? fmtDateTime(ca.approvedAt) : '') + kv('Kommentar', ca.comment || ca.approvedByComment));
    }
    if (st === 'godkänd') return card('ok', 'check-circle', 'Godkänd', kv('Datum', off.answeredAt ? fmtDate(off.answeredAt) : '—'));
    if (st === 'nekad') {
      const e = evOf('declined');
      return card('danger', 'x-circle', e ? 'Kunden nekade offerten' : 'Nekad', kv('Orsak', off.declineReason) + (e ? kv('Namn', e.byCustomer) + kv('E-post', e.byEmail) + kv('Kommentar', e.comment) : '') + kv('Datum', (e && e.ts) ? fmtDateTime(e.ts) : (off.answeredAt ? fmtDate(off.answeredAt) : '')));
    }
    if (st === 'ändring-begärd') {
      const e = evOf('change_requested');
      return card('warn', 'edit-3', 'Kunden vill ha ändringar', e ? kv('Namn', e.byCustomer) + kv('E-post', e.byEmail) + kv('Önskemål', e.comment) + kv('Datum', e.ts ? fmtDateTime(e.ts) : '') : kv('Datum', off.answeredAt ? fmtDate(off.answeredAt) : '—'));
    }
    return '';
  },

  /* Koppling till arbetsorder: länk när AO finns; förklaring när en
     godkänd offert inte kan konverteras automatiskt (samma
     _offAOConversionDecision/_offAOBlockedCtaText som createAO()). */
  _aoCardHtml(off) {
    if (off.workOrderId) {
      const ao = (state.workOrders || []).find(a => a.id === off.workOrderId);
      const no = (ao && typeof WorkOrderService !== 'undefined' && WorkOrderService.displayNumberOrPending) ? WorkOrderService.displayNumberOrPending(ao) : off.workOrderId;
      return `<section class="card offd-card offd-ao">
        <div class="card-header"><h3>${ic('clipboard-list', 15)} Arbetsorder</h3>${ao ? sbdg(ao.status) : ''}</div>
        <div class="card-body">
          <a class="offd-linkrow" role="link" tabindex="0" onclick="Router.showPage('pg-ao-detail',{aoId:'${_offSafeId(off.workOrderId)}'})" onkeydown="if(event.key==='Enter')this.click()">
            ${ic('clipboard-list', 15)}<span><strong>${esc(no)}</strong>${ao && ao.title ? ' · ' + esc(ao.title) : ''}</span>${ic('chevron-right', 14)}
          </a>
        </div>
      </section>`;
    }
    if (off.status === 'godkänd' && !off.archived && !off.deleted) {
      const dec = _offAOConversionDecision(off);
      if (!dec.allowed) {
        const t = _offAOBlockedCtaText(dec.reason, dec.vatRate);
        return `<section class="card offd-card offd-resp offd-ao tone-warn">
          <div class="card-header"><h3>${ic('alert-triangle', 15)} Arbetsorder</h3></div>
          <div class="card-body"><p class="offd-muted">${esc(t.title)}</p></div>
        </section>`;
      }
    }
    return '';
  },

  _customerCardHtml(off, cu) {
    if (!cu) return '';
    const addr = [cu.address, [cu.zip, cu.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const tel = String(cu.phone || '').replace(/[^\d+]/g, '');
    return `<section class="card offd-card">
      <div class="card-header"><h3>${ic('user', 15)} Kund</h3><span class="offd-cutype">${esc(CustomerService.typeLabel(cu.type))}</span></div>
      <div class="card-body"><dl class="offd-facts is-compact">
        <div><dt>Namn</dt><dd><a class="offd-link" role="link" tabindex="0" onclick="Router.showPage('pg-crm-detail',{customerId:'${_offSafeId(cu.id)}'})" onkeydown="if(event.key==='Enter')this.click()">${esc(CustomerService.displayName(cu))}</a></dd></div>
        ${cu.email ? `<div><dt>E-post</dt><dd><a class="offd-link" href="mailto:${esc(cu.email)}">${esc(cu.email)}</a></dd></div>` : `<div><dt>E-post</dt><dd class="offd-warn">Saknas — behövs för att skicka offerten</dd></div>`}
        ${cu.phone ? `<div><dt>Telefon</dt><dd>${tel ? `<a class="offd-link" href="tel:${esc(tel)}">${esc(cu.phone)}</a>` : esc(cu.phone)}</dd></div>` : ''}
        ${addr ? `<div><dt>Adress</dt><dd>${esc(addr)}</dd></div>` : ''}
      </dl></div>
    </section>`;
  },

  /* Hopfällbart kortsidhuvud (Bilagor, Säljtips, Historik): rubriken är
     knappen. Öppet/stängt följer samma _detailSections-minne som förut. */
  _cardHead(off, key, defaultOpen, icon, title, count, actionsHtml) {
    const open = this._sectionIsOpen(off.id, key, defaultOpen);
    return { open, html: `<div class="card-header offd-ch">
      <button type="button" class="offd-ch-toggle" aria-expanded="${open}" onclick="OfferDetailPage._toggleSection('${_offSafeId(off.id)}','${key}',${!!defaultOpen})">
        ${ic(icon, 15)}<span>${esc(title)}</span>${count !== null && count !== undefined ? `<span class="offd-count">${count}</span>` : ''}<span class="offd-ch-chev">${ic(open ? 'chevron-up' : 'chevron-down', 15)}</span>
      </button>
      ${open && actionsHtml ? `<div class="offd-ch-acts">${actionsHtml}</div>` : ''}
    </div>` };
  },

  /* V48A §9 / R3 §10: progressiv disclosure — Digital länk/Bilagor/Säljtips/
     Historik. R3 ändrar defaultbeteendet från "alltid stängd" till
     datastyrt: Digital länk öppen om en aktiv länk finns, Bilagor öppen om
     minst en aktiv bilaga finns, Säljtips/Historik alltid stängda som
     default. Om användaren manuellt togglar en sektion under den aktuella
     detalj-sessionen (this._detailSections, inget persist/ny datamodell)
     respekteras det valet vid efterföljande render() tills sidan lämnas —
     _detailSections[offerId][key] är då explicit satt (true/false) och
     override:ar defaultOpen. Panelernas EGEN markup/logik (_digitalLinkPanel
     etc.) är helt oförändrad — de returnerar exakt samma HTML som innan, vi
     bara visar/döljer den bakom en rubrikknapp. Om panelen redan idag
     returnerar '' (t.ex. arkiverad/borttagen offert, inga säljtips) visas
     ingenting alls, precis som innan. */
  _detailSections: {},

  _sectionIsOpen(offerId, key, defaultOpen) {
    const rec = this._detailSections[offerId];
    if (rec && Object.prototype.hasOwnProperty.call(rec, key)) return rec[key];
    return !!defaultOpen;
  },

  _toggleSection(offerId, key, defaultOpen) {
    const current = this._sectionIsOpen(offerId, key, defaultOpen);
    if (!this._detailSections[offerId]) this._detailSections[offerId] = {};
    this._detailSections[offerId][key] = !current;
    this.render({offerId});
  },

  _sectionWrap(offerId, key, title, count, innerHtml, defaultOpen) {
    if (!innerHtml) return '';
    const open = this._sectionIsOpen(offerId, key, defaultOpen);
    const countLabel = (count !== null && count !== undefined) ? ` (${count})` : '';
    return `<div class="off-collapse">
      <button type="button" class="off-collapse-summary" aria-expanded="${open}" onclick="OfferDetailPage._toggleSection('${offerId}','${key}',${!!defaultOpen})">
        <span>${title}${countLabel}</span>
        ${ic(open ? 'chevron-up' : 'chevron-down', 14)}
      </button>
      ${open ? innerHtml : ''}
    </div>`;
  },

  /* R3 (tillägg): action-sheet → confirm/modal-övergång. Gamla mönstret
     "X(id);Modal.close()" stänger FEL modal när X() själv öppnar en ny
     Modal.confirm()/Modal.open() synkront (t.ex. archiveOffer/deleteOffer/
     permanentDeleteOffer/createNewVersion) — Modal.close() kör EFTER att
     den nya modalen redan öppnats och stänger då den nyöppnade istället
     för action-sheeten. Minsta säkra fix: stäng action-sheeten FÖRST,
     öppna sedan den riktiga åtgärden i nästa tick (setTimeout 0) så de
     aldrig krockar. printPdf/openEdit/duplicate öppnar ingen egen modal —
     lämnade oförändrade (X(id);Modal.close() är korrekt för dem). */
  _flerAtgarderThen(fn) {
    Modal.close();
    setTimeout(fn, 0);
  },

  /* QA 2026-11-26: den modala åtgärdslistan finns kvar (anropbar) men visar
     nu exakt samma poster som "⋮"-menyn i huvudet (_actionModel) — en
     källa för vilka åtgärder som finns. Varje post stänger först listan
     och kör sedan åtgärden (se _flerAtgarderThen). */
  openFlerAtgarder(offerId) {
    const off = getOff(offerId);
    if (!off) return;
    const model = this._actionModel(off);
    const items = [model.primary].concat(model.inline).filter(Boolean).concat(model.menu);
    const btns = items.map((it, i) => (it.divider && i > 0 ? '<hr style="border:none;border-top:1px solid var(--br);margin:6px 0;">' : '') +
      `<button type="button" class="action-sheet-btn${it.destructive ? ' action-sheet-btn--red' : ''}" onclick="OfferDetailPage._flerAtgarderThen(()=>{${it.fn}})">${ic(it.icon,16)} <span>${esc(it.label)}</span></button>`);
    Modal.open({
      /* R6 §4: ren textrubrik utan ikon — .modal-title är inte byggd som
         en icon+text-flexrad, så ikonen kunde hamna på egen rad ovanför
         texten. */
      title: 'Fler åtgärder',
      body: `<div class="action-sheet-list">${btns.join('')}</div>`,
      buttons: [{ label: 'Stäng', cls: 'btn bs', onClick: () => Modal.close() }]
    });
  },

  /* V48A §1-4 / R2 §1 / R3 §3-5: setStatus() är nu den enda kvarvarande
     generella statusmutatorn (kallas av hero-menyns kontextuella actions),
     och den har en inbyggd övergångsspärr. Detta rör INTE de fristående,
     redan kanoniska vägarna som skriver off.status direkt (_doSendEmail →
     'skickad', _doSendReminder → 'påmind', generateDigitalLink → 'skickad'
     från utkast, createNewVersion → 'ersatt', kundens publika svar via
     offer-respond) — de är oförändrade.

     R2/R3: 'godkänd' är BORTTAGET ur denna lista helt — status godkänd får
     ALDRIG sättas via setStatus()/en generell statusaction. Godkänd nås
     uteslutande via (1) kundens digitala svar (offer-respond, server-side)
     eller (2) det explicita registrerings-godkännandeflödet
     (openApprovalModal/_confirmApproval, R3 §3-4 — ersätter den gamla
     "Muntligt godkänd" som bara täckte muntliga godkännanden; nu täcker
     samma flöde även e-post/telefon/SMS/annat, och är tillgängligt även
     från 'nekad' enligt R3 §5). customerApproval representerar bara
     kundens faktiska digitala svar och får aldrig skapas/förfalskas via
     en generell statusändring eller via _confirmApproval().

     Tillåtna manuella övergångar via setStatus() (exakt de knappar/
     menyalternativ som nu erbjuds i _statusMenuActions()):
       skickad  → nekad | väntar | utgången
       påmind   → nekad | väntar | utgången
       väntar   → nekad | utgången
       nekad    → väntar   (R3 §6: "Återöppna offert" — en nekad offert kan senare accepteras/blir aktiv igen)
       utgången → väntar   (R3 §6: "Återöppna offert")
     Allt annat (bl.a. från/till utkast, godkänd, ersatt, ändring-begärd)
     blockeras — ingen mutation, ingen persist, ingen logg. 'godkänd' är
     INTE en målstatus någonstans i denna tabell (R2/R3): den nås
     uteslutande via kundens digitala svar eller det explicita, egna
     godkännande-registreringsflödet (openApprovalModal/_confirmApproval,
     se nedan) — aldrig via setStatus(). 'ersatt' är fortsatt låst (finns
     inte som källa i tabellen, kan bara nås framåt via createNewVersion()).
     Dessutom: en offert som redan har en kopplad AO (off.workOrderId) kan
     ALDRIG flyttas tillbaka till en aktiv pipeline-status via denna
     funktion (fail closed) — detta gäller även "Återöppna offert", men
     kan i praktiken inte inträffa idag eftersom workOrderId bara sätts
     från status 'godkänd', som inte är en källstatus i tabellen. */
  _MANUAL_STATUS_TRANSITIONS: {
    skickad:  ['nekad', 'väntar', 'utgången'],
    påmind:   ['nekad', 'väntar', 'utgången'],
    väntar:   ['nekad', 'utgången'],
    nekad:    ['väntar'],
    utgången: ['väntar']
  },

  /* V48B1 R2: samma grundprincip som Edge Function-valideringen — enbart
     pre-flight UX i frontend, Edge Function förblir auktoritativ. */
  _EMAIL_RE: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,

  /* Visar/döljer ett kompakt inline-fel i SEND/REMINDER-modalerna.
     Ersätter INTE global showToast() — se rapportens backlog-fynd om
     showToast(msg, 'error')-buggen (out of scope för denna hotfix). */
  _showInlineError(id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = ic('alert-circle', 12) + ' <span>' + esc(msg) + '</span>';
    el.hidden = false;
  },

  _clearInlineError(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.hidden = true;
    el.innerHTML = '';
  },

  /* Mappar Edge Function-fel (serverJson.error) till användarvänlig text.
     Rå providertext/tekniska fel visas ALDRIG som primär text — de loggas
     separat via console.error på anropsplatsen. */
  _friendlySendError(serverJson) {
    const code = (serverJson && serverJson.error) || '';
    const map = {
      invalid_recipient:       'E-postadressen verkar inte vara giltig. Kontrollera mottagaren och försök igen.',
      already_sent:            'Offerten har redan skickats under de senaste 5 minuterna.',
      rate_limited:            'För många utskick på kort tid. Vänta en minut och försök igen.',
      unauthorized:            'Du saknar behörighet att skicka offerten. Logga in igen eller kontakta administratör.',
      forbidden:                'Du saknar behörighet att skicka offerten. Logga in igen eller kontakta administratör.',
      provider_not_configured: 'E-posttjänsten är inte korrekt konfigurerad. Kontakta administratör.',
      send_failed:              'Offerten kunde inte skickas. Kontrollera e-postadressen och försök igen.'
    };
    return map[code] || 'Offerten kunde inte skickas. Försök igen.';
  },

  setStatus(status) {
    const off = getOff(this.offerId);
    if (!off) return;
    /* R4 §2: fail closed — en arkiverad/borttagen offert får aldrig
       statusmuteras via setStatus(), oavsett vad transition-tabellen annars
       skulle tillåtit. Andra, oberoende skyddslager utöver att menyn redan
       döljer actions för arkiverade/borttagna offerter. */
    if (off.archived || off.deleted) {
      console.warn('[OfferDetailPage] Statusändring blockerad — offerten är arkiverad eller borttagen:', off.id);
      showToast('Kan inte ändra status — offerten är arkiverad eller borttagen');
      return;
    }
    const prev = off.status;
    const allowedTargets = this._MANUAL_STATUS_TRANSITIONS[prev] || [];
    if (!allowedTargets.includes(status)) {
      console.warn('[OfferDetailPage] Otillåten statusövergång blockerad:', prev, '->', status);
      showToast('Den statusändringen är inte tillåten just nu');
      return;
    }
    /* V48A §4: fail closed — en offert med kopplad AO får aldrig flyttas
       tillbaka till en aktiv pipeline-status via en generell åtgärd. Detta
       kan i praktiken inte inträffa idag (workOrderId sätts bara från
       status 'godkänd', som saknar utgående transitioner ovan), men
       skyddet ligger kvar explicit som ett andra, oberoende lager. */
    if (off.workOrderId && ['utkast', 'skickad', 'påmind', 'väntar'].includes(status)) {
      console.warn('[OfferDetailPage] Statusändring blockerad — offerten har redan en kopplad AO:', off.workOrderId);
      showToast('Kan inte ändra status — offerten är redan kopplad till en arbetsorder');
      return;
    }
    off.status    = status;
    off.updatedAt = new Date().toISOString();
    if (status === 'skickad') off.sentAt          = new Date().toISOString();
    if (status === 'påmind')  off.reminderSentAt  = new Date().toISOString();
    if (status === 'godkänd' || status === 'nekad') off.answeredAt = new Date().toISOString();
    this._logEvt(off, 'status', 'Status: ' + statusLabel(prev) + ' → ' + statusLabel(status));
    this.render({offerId: this.offerId});
    /* G12: besked först efter serverns bekräftelse; avslag återställer offerten. */
    return confirmPersist('offers', off.id, { ok: 'Status: ' + statusLabel(status), fail: 'Statusändringen kunde inte sparas', onChange: () => this.render({offerId: off.id}) });
  },

  /* ─ Single-instance event handlers — inga läckor vid upprepad öppning ─ */
  _spCloseClick: null,
  _spCloseEsc:   null,

  /* V48A §6 / R2 §1 / R3 §2,§5,§6,§7: kontextuella menyalternativ för
     aktuell status — ENDAST redan befintliga, kanoniska actions, ren
     statusrelaterade affärsåtgärder. Ingen ny affärslogik.
     R3: "Skicka påminnelse" är INTE längre en statusåtgärd — flyttad
     tillbaka till hero-actionsraden (se render(), samma villkor som förut).
     R3: "Muntligt godkänd" ersatt av "Registrera godkännande"
     (openApprovalModal) — samma mål (status→godkänd) men med explicit
     metodval (E-post/Telefon/SMS/Annat), tillgänglig även från 'nekad'.
     R3: "Nekad" → "Markera som nekad" (tydligare actiontext).
     R3: "Återöppna offert" tillagd för nekad/utgången → väntar. */
  _statusMenuActions(off) {
    /* R4 §2: fail closed — en arkiverad/borttagen offert ska INTE kunna
       statusändras via menyn (Registrera godkännande/Markera som .../
       Återöppna). Övrig historikvisning påverkas inte. */
    if (off.archived || off.deleted) return [];

    const id = off.id;
    const sentLike = off.status === 'skickad' || off.status === 'påmind' || off.status === 'väntar';

    if (sentLike) {
      const actions = [
        { icon:'check-circle', label:'Registrera godkännande', onClick:`OfferDetailPage.openApprovalModal('${id}')` },
        { icon:'x-circle',     label:'Markera som nekad',        onClick:`OfferDetailPage.setStatus('nekad')` }
      ];
      if (off.status === 'skickad' || off.status === 'påmind') {
        actions.push({ icon:'clock', label:'Markera som väntar svar', onClick:`OfferDetailPage.setStatus('väntar')` });
      }
      actions.push({ icon:'alert-circle', label:'Markera som utgången', onClick:`OfferDetailPage.setStatus('utgången')` });
      return actions;
    }

    if (off.status === 'nekad') {
      return [
        { icon:'check-circle', label:'Registrera godkännande', onClick:`OfferDetailPage.openApprovalModal('${id}')` },
        { icon:'rotate-ccw',   label:'Återöppna offert',         onClick:`OfferDetailPage.setStatus('väntar')` }
      ];
    }

    if (off.status === 'utgången') {
      return [
        { icon:'rotate-ccw', label:'Återöppna offert', onClick:`OfferDetailPage.setStatus('väntar')` }
      ];
    }

    return [];
  },

  /* V48A §6-7 / R3 §8-9: ersätter den gamla, fritt-valbara 9-statusars
     popovern med en badge + (endast om kontextuella actions finns) en
     kompakt, ljus meny med en liten rubrik. Riktiga CSS-klasser istället
     för inline-style-block (components.css/responsive.css). */
  _statusMenuHtml(off) {
    const actions = this._statusMenuActions(off);
    const badge = sbdg(off.status);
    if (actions.length === 0) {
      return `<div class="off-status-wrap"><span class="off-status-badge-only">${badge}</span></div>`;
    }
    const rows = actions.map((a, i) => `<button type="button" role="menuitem" tabindex="-1" id="offd-status-item-${i}"
        class="off-status-popover-item" onclick="${a.onClick};OfferDetailPage._statusMenuClose();">
        <span class="off-status-popover-item-icon">${ic(a.icon,13)}</span><span class="off-status-popover-item-label">${esc(a.label)}</span>
      </button>`).join('');
    return `<div class="off-status-wrap">
      <button type="button" id="offd-status-btn" class="off-status-btn"
        onclick="OfferDetailPage._statusMenuToggle(event)"
        aria-haspopup="menu" aria-expanded="false" aria-label="Statusåtgärder">
        ${badge}
        <span class="off-status-arrow">${ic('chevron-down',12)}</span>
      </button>
      <div id="offd-status-popover" role="menu" aria-label="Statusåtgärder" class="off-status-popover">
        <div class="off-status-popover-title">Ändra status</div>
        ${rows}
      </div>
      <div id="offd-status-scrim" class="off-status-scrim" onclick="OfferDetailPage._statusMenuClose()"></div>
    </div>`;
  },

  _statusMenuClose() {
    const pop   = document.getElementById('offd-status-popover');
    const btn   = document.getElementById('offd-status-btn');
    const scrim = document.getElementById('offd-status-scrim');
    if (pop)   { pop.classList.remove('open'); }
    if (scrim) { scrim.classList.remove('open'); }
    if (btn) { btn.setAttribute('aria-expanded', 'false'); }
    if (this._spCloseClick) { document.removeEventListener('click', this._spCloseClick, true); this._spCloseClick = null; }
    if (this._spCloseEsc)   { document.removeEventListener('keydown', this._spCloseEsc);      this._spCloseEsc   = null; }
  },

  _statusMenuToggle(e) {
    e.stopPropagation();
    const pop   = document.getElementById('offd-status-popover');
    const btn   = document.getElementById('offd-status-btn');
    const scrim = document.getElementById('offd-status-scrim');
    if (!pop) return;

    /* Rensa alltid gamla handlers före eventuell ny registrering */
    if (this._spCloseClick) { document.removeEventListener('click', this._spCloseClick, true); this._spCloseClick = null; }
    if (this._spCloseEsc)   { document.removeEventListener('keydown', this._spCloseEsc);      this._spCloseEsc   = null; }

    const opening = !pop.classList.contains('open');
    if (!opening) {
      pop.classList.remove('open');
      if (scrim) scrim.classList.remove('open');
      if (btn) btn.setAttribute('aria-expanded', 'false');
      return;
    }

    pop.classList.add('open');
    if (scrim) scrim.classList.add('open');
    if (btn) btn.setAttribute('aria-expanded', 'true');

    /* R2 §2: containment-check istället för exakt !== btn — ev.target är
       ofta ett barn av knappen (badge-span/text/svg-ikon), inte btn själv,
       vilket gjorde att klick på knappens innehåll felaktigt räknades som
       "utanför" och genast stängde menyn igen (kapp-fas-lyssnare). */
    this._spCloseClick = function(ev) {
      if (!pop.contains(ev.target) && !(btn && btn.contains(ev.target))) { OfferDetailPage._statusMenuClose(); }
    };
    this._spCloseEsc = function(ev) {
      if (ev.key === 'Escape') { OfferDetailPage._statusMenuClose(); if (btn) btn.focus(); }
    };
    setTimeout(function() { document.addEventListener('click', OfferDetailPage._spCloseClick, true); }, 0);
    document.addEventListener('keydown', this._spCloseEsc);
  },

  /* R3 §3-5: minimal intern helper som ersätter/utvecklar den gamla
     "Muntligt godkänd" (_quickAction('verbal')) — LIVE-flödet visade att
     kunder godkänner via fler kanaler än bara muntligt (e-post/telefon/
     SMS/annat), inte bara via den publika digitala offertlänken. Öppnar
     en liten, befintlig VIFT-modal (samma .fg/label-mönster som övriga
     formulär i denna fil) med obligatoriskt metodval + valfri kommentar.
     Tillgänglig från skickad/påmind/väntar (som gamla "Muntligt godkänd")
     OCH från nekad (R3 §5 — en nekad offert är inte ett dead-end). */
  openApprovalModal(offerId) {
    const off = getOff(offerId);
    if (!off) return;
    /* R4 §2: fail closed redan här — inte bara i _confirmApproval(). */
    if (off.archived || off.deleted) { showToast('Kan inte registrera godkännande — offerten är arkiverad eller borttagen'); return; }
    Modal.open({
      title: ic('check-circle',14) + ' Registrera godkännande',
      body: `
        <div class="fg"><label>Godkännande via *</label>
          <select id="appr-method">
            <option value="">Välj...</option>
            <option value="E-post">E-post</option>
            <option value="Telefon">Telefon</option>
            <option value="SMS">SMS</option>
            <option value="Annat">Annat</option>
          </select></div>
        <div class="fg"><label>Kommentar / referens (valfritt)</label>
          <textarea id="appr-comment" rows="3" placeholder="T.ex. kontaktperson, referens…"></textarea></div>
        <div style="background:var(--bg);border-radius:var(--rs);padding:8px 12px;font-size:11px;color:var(--mt);">
          ${ic('info',10)} Detta registrerar ett manuellt godkännande från personal — inte kundens digitala svar.
        </div>`,
      buttons: [
        { label: ic('check-circle',12) + ' Bekräfta godkännande', cls: 'btn bp', onClick: () => this._confirmApproval(offerId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('appr-method')?.focus(), 80);
  },

  _confirmApproval(offerId) {
    const off = getOff(offerId);
    if (!off) return;
    /* R4 §2: andra, oberoende skyddslager — en arkiverad/borttagen offert
       får aldrig statusmuteras via detta flöde, oavsett vad ett direkt
       funktionsanrop försöker (fail closed, samma princip som setStatus()). */
    if (off.archived || off.deleted) { showToast('Kan inte registrera godkännande — offerten är arkiverad eller borttagen'); return; }
    const method = (document.getElementById('appr-method')?.value || '').trim();
    if (!method) { showToast('Välj hur godkännandet mottogs'); return; }
    /* Samma källstatusar som statusmenyns "Registrera godkännande"-alternativ
       erbjuds från (se _statusMenuActions) — fail closed om något annat. */
    const allowedFrom = ['skickad', 'påmind', 'väntar', 'nekad'];
    if (!allowedFrom.includes(off.status)) { showToast('Kan inte registrera godkännande i detta läge'); return; }
    const comment = (document.getElementById('appr-comment')?.value || '').trim();
    const now = new Date().toISOString();
    /* R5: currentUser-modellen använder normalt firstName/lastName, inte
       ett samlat .name-fält — bygg det riktiga namnet från dem i första
       hand, med samma robusta fallback-kedja (.name/.username/'Admin')
       som tidigare för konton som saknar för-/efternamn. */
    const _u = (typeof state !== 'undefined') ? state.currentUser : null;
    const registeredBy = _u
      ? ([_u.firstName, _u.lastName].filter(Boolean).join(' ') || _u.name || _u.username || 'Admin')
      : 'Admin';
    off.status    = 'godkänd';
    off.answeredAt = now;
    off.updatedAt  = now;
    /* R4 §1: manuellt registrerade godkännanden får sin EGEN provenienspost
       — customerApproval rörs ALDRIG här, den representerar uteslutande
       kundens egna digitala svar via offer-respond. Detta förhindrar att
       en gammal digital respons (t.ex. ett tidigare digitalt NEKANDE, vars
       customerApproval-fält historiskt kan innehålla svarsdata) av misstag
       tolkas som "kunden godkände digitalt" när det i själva verket är
       personal som registrerat ett manuellt godkännande i efterhand. */
    off.manualApproval = { method: method, comment: comment, registeredAt: now, registeredBy: registeredBy };
    this._logEvt(off, 'status', 'Godkännande registrerat via ' + method + (comment ? ': ' + comment : ''));
    Modal.close();
    this.render({offerId});
    return confirmPersist('offers', off.id, { ok: 'Godkännande registrerat (' + method + ')', fail: 'Godkännandet kunde inte sparas', onChange: () => this.render({offerId}) });
  },

  duplicate(offerId) {
    const off = getOff(offerId);
    if (!off) return;
    const now = new Date().toISOString();
    const newOff = Object.assign({}, JSON.parse(JSON.stringify(off)), {
      id: newId(state.offers, 'OFF'), status: 'utkast',
      title: (off.title || 'Offert') + ' (kopia)',
      versionNumber: 1, parentOfferId: '',
      sentAt: '', answeredAt: '', reminderSentAt: '', emailSentTo: '', workOrderId: '',
      archived: false, deleted: false,
      /* R4 §1: manuellt godkännande får ALDRIG följa med till en ny/duplicerad
         offert — den nya offerten har inte blivit godkänd av någon ännu. */
      manualApproval: null,
      /* R5: en duplicerad offert är en NY offert och ska börja utan
         gammalt kundsvar — annars ärver kopian originalets digitala
         customerApproval trots att JSON.parse(JSON.stringify(off)) klonar
         hela objektet. Samma tomma canonical struktur som Schema.offer(). */
      customerApproval: { token: '', approvedAt: null, approvedByName: '', approvedByEmail: '', ip: '', comment: '' },
      /* R5: digital offertlänk/publik snapshot tillhör den GAMLA offertens
         session och får ALDRIG delas med en ny offert — annars skulle
         originalets publika länk/lockedSnapshotJSON av misstag peka på/
         gälla för kopian. En ny länk måste alltid genereras separat via
         det befintliga generateDigitalLink()-flödet. */
      publicToken: '', tokenCreatedAt: '', tokenExpiresAt: '', tokenRevokedAt: '',
      openCount: 0, openedAt: '', lockedSnapshotJSON: '',
      /* R5: entydiga lifecycle-/responsfält som hör till originalets
         historik, inte den nya kopian. */
      declineReason: '', convertedAt: '',
      createdAt: now, updatedAt: now, timeline: []
    });
    this._logEvt(newOff, 'create', 'Duplicerad från ' + offerId);
    state.offers.push(newOff);
    return confirmPersist('offers', newOff.id, { ok: 'Kopia ' + newOff.id + ' skapad', fail: 'Kopian kunde inte sparas',
      onSaved: () => Router.showPage('pg-offer-detail', {offerId: newOff.id}), onChange: () => { try { Router.refreshCurrent(); } catch (e) {} } });
  },

  archiveOffer(offerId) {
    const off = getOff(offerId);
    if (!off) return;
    Modal.confirm('Arkivera offert ' + offerId + '? Den försvinner från standardlistorna men kan återställas.', () => {
      off.archived = true;
      off.updatedAt = new Date().toISOString();
      this._logEvt(off, 'arkiverad', 'Offert arkiverad');
      OffersPage._setFilter('arkiverade');
      Router.showPage('pg-offer');
      confirmPersist('offers', off.id, { ok: 'Offert arkiverad', fail: 'Arkiveringen kunde inte sparas', onChange: () => { try { Router.refreshCurrent(); } catch (e) {} } });
    });
  },

  deleteOffer(offerId) {
    const off = getOff(offerId);
    if (!off) return;
    Modal.confirm('Flytta offert ' + offerId + ' till papperskorgen?', () => {
      off.deleted = true;
      off.archived = false;
      off.updatedAt = new Date().toISOString();
      this._logEvt(off, 'borttagen', 'Offert flyttad till papperskorg');
      Router.showPage('pg-offer');
      confirmPersist('offers', off.id, { ok: 'Offert i papperskorgen', fail: 'Offerten kunde inte flyttas till papperskorgen', onChange: () => { try { Router.refreshCurrent(); } catch (e) {} } });
    });
  },

  restoreOffer(offerId) {
    const off = getOff(offerId);
    if (!off) return;
    off.archived = false;
    off.deleted  = false;
    off.updatedAt = new Date().toISOString();
    this._logEvt(off, 'återställd', 'Offert återställd');
    this.render({offerId});
    return confirmPersist('offers', off.id, { ok: 'Offert återställd', fail: 'Återställningen kunde inte sparas', onChange: () => this.render({offerId}) });
  },

  permanentDeleteOffer(offerId) {
    Modal.confirm('Radera offert ' + offerId + ' permanent? Detta går inte att ångra.', () => {
      const idx = (state.offers||[]).findIndex(o => o.id === offerId);
      if (idx >= 0) state.offers.splice(idx, 1);
      Router.showPage('pg-offer');
      confirmPersist('offers', offerId, { ok: 'Offert raderad', fail: 'Offerten kunde inte raderas', onChange: () => { try { Router.refreshCurrent(); } catch (e) {} } });
    });
  },

  createAO() {
    const off = getOff(this.offerId);
    if (!off) return;

    /* OFFER CORE R1.5 — FINAL BLOCKER (motbevis-granskad): load-bearing
       LIFECYCLE guard, checked FIRST — before the financial guard and
       BEFORE any AO payload is built — never trust only the UI to have
       hidden/disabled the button. See _offAOCreateLifecycleDecision()
       for the full trace/decision. This subsumes the old, separately-
       placed "Dubbelkonverteringsskydd" (workOrderId) check, which
       previously ran AFTER the financial guard and AFTER building the
       entire AO payload — wasted work for a request that was always
       going to be rejected, and NOT a fail-fast guard. */
    const lifecycle = _offAOCreateLifecycleDecision(off);
    if (!lifecycle.allowed) {
      if (lifecycle.reason === 'already-converted') {
        showToast('Offerten är redan konverterad till ' + off.workOrderId);
      } else if (lifecycle.reason === 'archived') {
        showToast('Arkiverade offerter kan inte konverteras till en arbetsorder — återställ offerten först.');
      } else if (lifecycle.reason === 'deleted') {
        showToast('Borttagna offerter kan inte konverteras till en arbetsorder — återställ offerten först.');
      } else {
        showToast('Offerten måste vara godkänd innan den kan konverteras till en arbetsorder.');
      }
      return;
    }

    /* OFFER CORE R1.2/R1.3/R1.4 — BLOCKER 4: load-bearing guard, never
       trust only the UI to have hidden the button — see
       _offAOConversionDecision() for the full trace/decision. A
       recurring offer (pure or mixed), an offer with no committed
       one-time amount at all (pure rate-card, an optional-only
       Tillval, or a one-time offer discounted to zero) must NEVER
       silently become a 0-kr fixed-price AO. The modal message is
       reason-specific — R1.4 adds the 'discounted-to-zero' case (a
       100%-discounted one-time offer is NOT the same situation as a
       rate-only offer, and deserves its own accurate explanation). */
    const aoDecision = _offAOConversionDecision(off);
    if (!aoDecision.allowed) {
      const bodyByReason = {
        recurring: `<p style="font-size:13px;line-height:1.6;">Den här offerten har en återkommande prisdel (${fmt(_offRecurringMonthlyExVat(off))} kr/mån) och kan inte konverteras till en vanlig fastprisarbetsorder — det skulle tyst tappa den återkommande delen av affären.</p>
             <p style="font-size:13px;line-height:1.6;">Stöd för att konvertera en återkommande offert till ett återkommande ärende/avtal finns inte ännu i denna version. Kontakta systemansvarig om detta behövs, eller hantera uppdraget manuellt via "Återkommande ärenden".</p>`,
        'discounted-to-zero': `<p style="font-size:13px;line-height:1.6;">Rabatten på den här offerten reducerar det committade engångsbeloppet till 0 kr. En fastprisarbetsorder på 0 kr stöds inte i VIFT.</p>
             <p style="font-size:13px;line-height:1.6;">Justera rabatten, eller hantera uppdraget manuellt, om arbetet ändå ska bli en arbetsorder.</p>`,
        'no-committed-onetime': `<p style="font-size:13px;line-height:1.6;">Den här offerten har inget committat engångsbelopp — bara rörliga à-priser och/eller icke-committade tillval — och kan därför inte konverteras till en fastprisarbetsorder. En fastprisarbetsorder på 0 kr skulle vara felaktig.</p>
             <p style="font-size:13px;line-height:1.6;">Lägg till en fast engångsrad i offerten, eller hantera uppdraget manuellt, om arbetet ändå ska bli en arbetsorder.</p>`,
        'mixed-vat': `<p style="font-size:13px;line-height:1.6;"><strong>Denna offert har blandade momssatser (${(typeof OfferCalc !== 'undefined' ? OfferCalc.vatRatesInTotal(off) : []).map(r => r + ' %').join(' / ')}) som inte kan representeras korrekt som ett fastprisarbete — konvertera inte automatiskt.</strong></p>
             <p style="font-size:13px;line-height:1.6;">En fastprisarbetsorder har ett enda belopp exkl. moms som faktureras med en momssats. Offertens moms (${fmt(_offerCalcTotals(off).vatAmount)} kr, totalt ${fmt(_offerCalcTotals(off).totalInclVat)} kr inkl. moms) skulle då inte stämma på fakturan. Ingen arbetsorder har skapats.</p>
             <p style="font-size:13px;line-height:1.6;"><strong>Obs:</strong> att skapa arbetsordern manuellt löser INTE detta automatiskt — faktureringskön sätter fortfarande 25 % moms på fastpris- och tidrader oavsett hur AO:n skapades. Om du skapar AO:n manuellt måste du själv, för hand, ändra både beloppet (exkl. moms) och momssatsen på den resulterande fakturaunderlagsraden innan fakturan skickas. Ett alternativ: dela upp offerten så att varje offert har en enda momssats.</p>`,
        /* I2 VAT-FIX: a single, uniform rate other than 25 % — NOT "blandad". */
        'non-25-vat': `<p style="font-size:13px;line-height:1.6;"><strong>Offertens moms (${esc(String(aoDecision.vatRate))} %) kan inte föras över korrekt till arbetsordern (som endast stödjer 25 %) — konvertera inte automatiskt.</strong></p>
             <p style="font-size:13px;line-height:1.6;">En fastprisarbetsorder faktureras i dag alltid med 25 % moms. Offertens moms (${fmt(_offerCalcTotals(off).vatAmount)} kr, totalt ${fmt(_offerCalcTotals(off).totalInclVat)} kr inkl. moms) skulle då inte stämma på fakturan. Ingen arbetsorder har skapats.</p>
             <p style="font-size:13px;line-height:1.6;"><strong>Obs:</strong> att skapa arbetsordern manuellt löser INTE momsproblemet automatiskt — faktureringskön sätter fortfarande 25 % moms på fastpris- och tidrader oavsett hur AO:n skapades. Om du skapar AO:n manuellt måste du själv, för hand, ändra både beloppet (exkl. moms) och momssatsen (till ${esc(String(aoDecision.vatRate))} %) på den resulterande fakturaunderlagsraden innan fakturan skickas — systemet gör inte detta åt dig.</p>`,
        'vat-unknown': `<p style="font-size:13px;line-height:1.6;"><strong>Offertens momssats kunde inte fastställas — konvertera inte automatiskt.</strong></p>
             <p style="font-size:13px;line-height:1.6;">Ingen arbetsorder har skapats. Ladda om sidan och försök igen. Om du skapar arbetsordern manuellt: tänk på att faktureringskön sätter 25 % moms på fastpris- och tidrader oavsett AO:ns ursprung — kontrollera och rätta momsen för hand på fakturaunderlaget innan fakturan skickas.</p>`
      };
      Modal.open({
        title: ic('alert-triangle', 14) + ' Kan inte skapa arbetsorder',
        body: bodyByReason[aoDecision.reason] || bodyByReason['no-committed-onetime'],
        buttons: [{ label: 'Stäng', cls: 'btn bp', onClick: () => Modal.close() }]
      });
      return;
    }

    /* OFFER CORE R1.4 — BLOCKER 1/2 (motbevis-granskad): ALL economics-
       and content-dependent fields (title/description/checklist/
       estimatedHours/fixedPrice) now come from the SAME pure
       _buildAOConversionPayload(off) that the test suite exercises
       directly — no parallel/duplicated algorithm. See that function's
       own header for the full rationale (canonical post-discount
       fixedPrice; committed-one-time-only work scope; committed
       extras represented, optional/rate/recurring never are). */
    const aoPayload = _buildAOConversionPayload(off);

    // Initial AO log entry
    const by = state.currentUser ? `${state.currentUser.firstName} ${state.currentUser.lastName}`.trim() : 'Admin';
    const aoLog = [{
      id: 'L' + Date.now(), type: 'created_from_offer',
      text: `${by} skapade AO från offert ${off.id}`,
      userName: by, timestamp: new Date().toISOString()
    }];
    /* QA FIX-ROUND 2026-11-12 (I2, AO-conversion part — NOT changed, only
       made visible): the AO carries ONE fixed price ex VAT
       (aoPayload.fixedPrice = exVatAfterDiscount) that billing later
       charges at the invoice line's VAT rate. For an offer whose one-time
       lines have MIXED VAT rates (e.g. a 0 % line) that cannot reproduce
       the offer's VAT. Changing the AO/billing price model is a separate,
       tracked design item (round report §I2); until then the difference
       is recorded on the AO's own log and shown to the user, never silent.
       I2 VAT-FIX: _offAOConversionDecision() now refuses every rate set
       other than exactly [25] before this point, so this note is a
       defensive no-op kept unchanged. */
    if (typeof OfferCalc !== 'undefined') {
      const _vr = OfferCalc.vatRatesInTotal(off);
      if (_vr.length > 1 || (_vr.length === 1 && _vr[0] !== 25)) {
        const _ot = OfferCalc.totals(off);
        const _txt = `Obs: offert ${off.id} har momssats ${_vr.map(r => r + ' %').join(' / ')} — moms enligt offerten ${fmt(_ot.vatAmount)} kr (totalt ${fmt(_ot.totalInclVat)} kr inkl. moms). Arbetsorderns fasta pris (${fmt(_ot.exVatAfterDiscount)} kr exkl. moms) faktureras med fakturaradens momssats — kontrollera momsen på fakturaunderlaget.`;
        aoLog.push({ id: 'L' + Date.now() + 'v', type: 'note', text: _txt, userName: by, timestamp: new Date().toISOString() });
        if (typeof showToast === 'function') showToast(_txt, 9000);
      }
    }

    /* R3-A FIX (independent-reviewer finding, round 4): the OLD code
       below this comment used to stamp `off.workOrderId`/`convertedAt`
       SYNCHRONOUSLY right after `WorkOrderService.create()` returned —
       but that return is only the OPTIMISTIC local object
       (`ao._pendingSync === true`); the real server ACK for the AO
       create is still in flight at that point. A later server
       rejection (e.g. a project-compatibility race) left the offer
       PERMANENTLY marked "converted" to an AO that was never actually
       created — a worse, silent variant of the exact bug V54B R2 (see
       the preserved comment that used to sit here) already fixed for
       the SYNCHRONOUS `{ok:false}` case; this is the same bug for the
       ASYNC rejection case.

       Fix: the AO list still shows the new row instantly (unchanged —
       that is `create()`'s existing, correct optimistic behavior). The
       offer's OWN permanent cross-reference (`workOrderId`,
       `convertedAt`, the timeline log entry, persist(), and navigation)
       now happens ONLY inside `onSettled`, once the real server ACK
       arrives — never before. A simple `_aoConversionPending` guard
       (cleared on both success and definite rejection) stops a second
       click from enqueuing a SECOND AO create while the first is still
       in flight — the per-entry idempotency key inside
       AOTimeSyncService already makes a genuine network-level retry of
       the SAME attempt safe, but a fresh button click is a NEW enqueue
       with a NEW id/key, which idempotency alone cannot prevent. */
    /* B1 FIX (independent-reviewer finding, round 5): the guard used to
       be the in-memory `off._aoConversionPending` flag alone — gone
       after a reload, even while the AO create is genuinely still in
       flight (or has ACKed but the commit hasn't run yet) server-side.
       Now checks AOTimeSyncService's DURABLE intent registry instead,
       which survives a reload — see that file's header. */
    if (typeof AOTimeSyncService !== 'undefined' && AOTimeSyncService.hasPendingIntent('offer_ao_conversion', off.id)) {
      showToast('Arbetsorder skapas redan för denna offert — vänta på bekräftelse innan du försöker igen.');
      return;
    }
    off._aoConversionPending = true;

    const ao = WorkOrderService.create({
      title:               aoPayload.title,
      description:         aoPayload.description,
      customerId:          off.customerId,
      propertyId:          off.propertyId || '',
      address:             _offPropertyDisplayText(off),
      internalNote:        off.internalNote || '',
      status:              'nytt',
      priority:            'normal',
      priceType:           'fast',
      fixedPrice:          aoPayload.fixedPrice,
      offerId:             off.id,
      /* V54B §12/J — en AO skapad från en projekt-kopplad offert ÄRVER
         projectId automatiskt (samma kund-/fastighetsinvariant gäller
         redan via propertyId/customerId ovan, som alltid härleds från
         offerten). Ingen kopiering av arrayer, ett enkelt fältvärde. */
      projectId:           off.projectId || '',
      sourceOfferId:       off.parentOfferId || off.id,
      sourceOfferVersionId:off.id,
      sourceOfferNumber:   off.id,
      estimatedHours:      aoPayload.estimatedHours || 0,
      checklist:           aoPayload.checklist,
      log:                 aoLog,
      staff: [], materials: [], notes: [], timeEntries: []
    }, {
      /* B1 FIX (independent-reviewer finding, round 5): the ACTUAL
         commit (off.workOrderId/convertedAt, the timeline log, closing
         follow-up activities, persist()) moved OUT of this in-memory
         callback and into the DURABLE 'offer_ao_conversion' intent
         handler (registered once below, at file load, via
         `_registerOfferAOConversionIntentHandler()`). AOTimeSyncService
         calls that handler itself — synchronously, right now, in the
         common case — but it ALSO durably remembers to call it again on
         the very next app load if the tab closes/crashes before it got
         the chance here. This `onSettled` is now only responsible for
         same-session UI niceties (clearing the in-memory pending flag,
         a toast, navigation, a re-render) — never the actual mutation,
         which is why none of that is lost on a reload anymore. */
      onSettledIntent: { kind: 'offer_ao_conversion', refId: off.id, versionNumber: off.versionNumber || 1 },
      onSettled: (r) => {
        off._aoConversionPending = false;
        if (r.ok) {
          if (this.offerId === off.id) this.render({ offerId: this.offerId });
          showToast('AO ' + WorkOrderService.displayNumberOrPending(r.ao) + ' skapad');
          setTimeout(() => Router.showPage('pg-ao-detail', { aoId: r.ao.id }), 800);
        } else if (r.final) {
          console.error('[PageShells] AO-skapande avvisades av servern för offert', off.id, ':', r.error);
          showToast('Arbetsordern kunde inte skapas (servern avvisade anropet: ' + (r.error || 'okänt fel') + '). Offerten är INTE markerad som konverterad — försök igen.');
          if (this.offerId === off.id) this.render({ offerId: this.offerId });
        }
        // else: transient — stays pending; the automatic outbox retry
        // (resumePending()) or this same tab's eventual AOTimeSyncService
        // retry will fire this same onSettled again once it actually
        // resolves — and, independently, will durably settle the intent
        // above regardless of whether this tab is even still open to see it.
      }
    });

    /* V54B R2 — blockerare 5: WorkOrderService.create() can return
       `{ok:false, error}` SYNCHRONOUSLY (a cheap, local, pre-network
       validation failure — e.g. a stale project/customer/property
       combination the client can already tell is invalid) — this is a
       DIFFERENT case from the async server ACK handled above, and is
       still safe to check immediately since create() never enqueued
       anything to the server in this branch at all. */
    if (!ao || ao.ok === false) {
      off._aoConversionPending = false;
      showToast((ao && ao.error) || 'Offerten kan inte konverteras till arbetsorder eftersom dess projektkoppling inte längre är giltig. Kontrollera projekt, kund och fastighet.');
      return;
    }
    // Optimistic-only feedback — NOT a conversion commit. The AO already
    // shows up in the AO list (create() pushed it into state.workOrders),
    // but the offer itself is untouched until onSettled fires above.
    this.render({ offerId: this.offerId });
  },

  /* ── Händelselogg ─── */
  _logEvt(off, type, text) {
    if (!off) return;
    if (!Array.isArray(off.timeline)) off.timeline = [];
    const user = (typeof state !== 'undefined' && state.currentUser) ? (state.currentUser.name || state.currentUser.username || 'Admin') : 'Admin';
    /* Lagras verbatim (rått), avsiktligt — samma princip som state.offerEvents
       nedan: historiken ska spara exakt vad som skrevs. Säkerheten ligger i
       att _timelineHtml() ALLTID escapar vid rendering (se nedan), inte här
       vid skrivning. Att escapa vid skrivning (en tidigare version av denna
       fix, 2026-11-16) skyddade bara NYA poster — redan sparade, äldre
       off.timeline-poster (skrivna innan den fixen fanns) hade förblivit
       oskyddade för alltid, eftersom ingenting läser om gammal lagrad data.
       Escapning vid rendering täcker gammal OCH ny data lika, utan att
       någon migrering av befintlig data behövs. */
    off.timeline.push({ ts: new Date().toISOString(), type, text, user });
  },

  _timelineHtml(off) {
    /* Kombinera interna händelser (off.timeline) med externa kundhändelser
       (state.offerEvents). Säkerhetsfix 2026-11-16 (XSS-granskning, andra
       omgången): interna poster escapas HÄR, vid varje rendering — täcker
       alltså även poster som redan låg sparade innan säkerhetsfixen fanns,
       inte bara nya. off.timeline lagrar fri text verbatim (se _logEvt
       ovan); extEvents nedan escapas redan vid sin egen push (V48B3B0,
       oförändrad) eftersom den koden bygger en NY, tillfällig post per
       rendering snarare än att läsa en redan lagrad — escapa den INTE här
       också, annars dubbel-escapas den (&amp; blir &amp;amp; osv). */
    const tl = (off.timeline || []).slice().map(function(e) {
      return Object.assign({}, e, { text: esc(e.text || ''), user: esc(e.user || ''), _src: 'internal' });
    });

    const extEvents = (state.offerEvents || []).filter(function(e) { return e.offerId === off.id; });
    const _extLabel = { opened:'Kund öppnade länk', approved:'Kund godkände offert', change_requested:'Kund begärde ändring', declined:'Kund nekade offert', revoked:'Länk återkallad', renewed:'Länk förnyad', email_sent:'Offert skickad via e-post' };
    /* V48B3B0 (säkerhetshotfix): e.comment/e.byCustomer/e.byEmail är kunddata,
       skickad av en extern, oautentiserad part via offer-respond. Den lagras
       verbatim (avsiktligt, för historik) men får ALDRIG tolkas som HTML vid
       rendering — bygg hela beskrivningen som ren text först, escapa den
       EN gång med kanoniska esc(), interpolera sedan i HTML. Interna
       labels (_extLabel, baseLabel) genereras av applikationen själv och
       innehåller inga special-tecken, så en gemensam esc() av hela strängen
       är säker och ändrar inget synligt för dem. */
    extEvents.forEach(function(e) {
      var baseLabel = e.type === 'email_sent' && e.status === 'failed'
        ? 'E-postutskick misslyckades'
        : e.type === 'email_sent' && e.commType === 'offer_reminder'
        ? 'Påminnelse skickad via e-post'
        : (_extLabel[e.type] || e.type);
      var recipientText = e.type === 'email_sent' && Array.isArray(e.recipients) && e.recipients.length
        ? ' — ' + e.recipients.join(', ')
        : '';
      var rawDesc = baseLabel + recipientText + (e.byCustomer ? ' — ' + e.byCustomer : '') + (e.byEmail ? ' (' + e.byEmail + ')' : '') + (e.comment ? ': ' + e.comment.slice(0,120) : '') + (e.error ? ': ' + String(e.error).slice(0,160) : '');
      var rawUser = e.sentBy || e.byCustomer || (e.type === 'email_sent' ? 'System' : 'Kund');
      tl.push({ ts: e.ts || e.sentAt || '', type: e.type, text: esc(rawDesc), user: esc(rawUser), _src:'customer' });
    });

    tl.sort(function(a, b) { return (b.ts || '').localeCompare(a.ts || ''); });

    const typeIcon = {create:'plus-circle', edit:'pencil', status:'refresh-cw', send:'send', pdf:'printer', comment:'message-square', ao:'clipboard-list', ring:'phone', email:'mail', followup:'bell', reminder:'clock', price:'dollar-sign', change:'edit-3', verbal:'thumbs-up', reason:'help-circle', tip:'message-square',
      opened:'eye', approved:'check-circle', change_requested:'edit-3', declined:'x-circle', revoked:'x-circle', renewed:'refresh-cw', email_sent:'send' };
    const typeColor = {create:'var(--navy)', edit:'var(--mt)', status:'var(--or)', send:'var(--blue)', pdf:'#6366f1', comment:'#0891b2', ao:'var(--grn)', ring:'var(--sky)', email:'var(--blue)', followup:'var(--or)', reminder:'var(--yl)', price:'#b45309', change:'var(--pu)', verbal:'var(--gr)', reason:'var(--mt)', tip:'var(--mt)',
      opened:'var(--sky)', approved:'var(--gr)', change_requested:'var(--or)', declined:'var(--rd)', revoked:'var(--rd)', renewed:'var(--blue)', email_sent:'var(--blue)' };
    const id = _offSafeId(off.id);
    const isSent = off.status === 'skickad' || off.status === 'påmind' || off.status === 'väntar';
    /* QA 2026-11-26: hopfällbart kort (rubriken är knappen), stängt som
       standard precis som tidigare "Historik"-sektionen. */
    const head = this._cardHead(off, 'timeline', false, 'activity', 'Historik och säljarbete', tl.length);
    if (!head.open) return `<section class="card offd-card offd-tl">${head.html}</section>`;
    return `<section class="card offd-card offd-tl">
      ${head.html}
      <div class="off-tl-action-bar">
        <span style="font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.4px;align-self:center;white-space:nowrap;">Åtgärd:</span>
        <button type="button" class="off-tl-action-btn" onclick="OfferDetailPage._quickAction('${id}','ring')">${ic('phone',11)} Ring kund</button>
        <button type="button" class="off-tl-action-btn" onclick="OfferDetailPage._quickAction('${id}','email')">${ic('mail',11)} Mailade kund</button>
        <button type="button" class="off-tl-action-btn" onclick="OfferDetailPage._quickAction('${id}','followup')">${ic('bell',11)} Uppföljning</button>
        <button type="button" class="off-tl-action-btn" onclick="OfferDetailPage._quickAction('${id}','reminder')">${ic('clock',11)} Påminnelse</button>
        ${isSent?`<button type="button" class="off-tl-action-btn" onclick="OfferDetailPage._quickAction('${id}','price')">${ic('dollar-sign',11)} Prisförhandling</button>`:''}
        ${isSent?`<button type="button" class="off-tl-action-btn" onclick="OfferDetailPage._quickAction('${id}','change')">${ic('edit-3',11)} Kund vill ändra</button>`:''}
        ${(!off.archived&&!off.deleted&&(isSent||off.status==='nekad'))?`<button type="button" class="off-tl-action-btn" onclick="OfferDetailPage.openApprovalModal('${id}')" style="background:rgba(21,128,61,.08);color:var(--gr);">${ic('check-circle',11)} Registrera godkännande</button>`:''}
        ${off.status==='nekad'?`<button type="button" class="off-tl-action-btn" onclick="OfferDetailPage._quickAction('${id}','reason')">${ic('help-circle',11)} Orsak nekad</button>`:''}
        ${(!off.archived&&!off.deleted&&off.status==='nekad')?`<button type="button" class="off-tl-action-btn" onclick="OfferDetailPage.setStatus('väntar')">${ic('rotate-ccw',11)} Återöppna offert</button>`:''}
        <button type="button" class="off-tl-action-btn" onclick="OfferDetailPage._quickAction('${id}','tip')">${ic('message-square',11)} Intern notering</button>
      </div>
      ${(() => {
        const openActs = ActivitiesService.getByRelated('offer', off.id).filter(a => a.status === 'open');
        if (!openActs.length) return '';
        const _fmtD = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('sv-SE', {day:'numeric',month:'short'}) : '—';
        return `<div style="padding:8px 14px 4px;border-top:1px solid var(--br);border-bottom:1px solid var(--br);background:rgba(255,181,39,.04);">
          <div style="font-size:10px;font-weight:700;color:var(--or);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px;display:flex;align-items:center;gap:5px;">
            ${ic('bell',10)} Inbokade uppföljningar (${openActs.length})
          </div>
          ${openActs.map(a => {
            const isOverdue = a.dueDate && a.dueDate < tdy();
            const staff     = getStaff(a.assignedTo);
            const staffName = staff ? `${staff.firstName} ${staff.lastName}` : '—';
            const dateStr   = a.dueDate ? _fmtD(a.dueDate) + (a.dueTime ? ' kl ' + a.dueTime : '') : '—';
            const priColor  = a.priority === 'hög' ? 'var(--rd)' : a.priority === 'låg' ? 'var(--mt)' : 'var(--or)';
            return `<div style="display:flex;align-items:flex-start;gap:8px;padding:5px 0;border-bottom:1px solid rgba(0,0,0,.05);">
              <span style="color:${isOverdue?'var(--rd)':priColor};flex-shrink:0;margin-top:1px;">${ic(ActivitiesService.typeIcon(a.type),13)}</span>
              <div style="flex:1;min-width:0;">
                <div style="font-size:12px;font-weight:700;color:${isOverdue?'var(--rd)':'var(--navy)'};">${dateStr}${isOverdue?' <span class="bdg bdg-red" style="font-size:9px;margin-left:4px;">Försenad</span>':''}</div>
                ${a.note?`<div style="font-size:11px;color:var(--tx);margin-top:1px;">${esc(a.note)}</div>`:''}
                <div style="font-size:10px;color:var(--mt);margin-top:1px;">${ic('user',9)} ${esc(staffName)}${a.priority&&a.priority!=='normal'?' · '+a.priority:''}</div>
              </div>
              <div style="display:flex;gap:4px;flex-shrink:0;">
                <button class="btn bxs bsu" style="font-size:11px;padding:3px 7px;" onclick="OfferDetailPage._completeActivity('${a.id}','${off.id}')" title="Markera klar">${ic('check',12)} Klar</button>
                <button class="btn bxs bs" style="font-size:11px;padding:3px 7px;" onclick="OfferDetailPage._rescheduleActivity('${a.id}','${off.id}')" title="Flytta">${ic('calendar',12)}</button>
              </div>
            </div>`;
          }).join('')}
        </div>`;
      })()}
      <div style="padding:0;">
        ${tl.length===0
          ? `<p style="padding:12px 14px;font-size:12px;color:var(--mt);">Inga händelser ännu.</p>`
          : tl.map(e => `<div class="off-tl-item">
              <span class="off-tl-dot" style="color:${typeColor[e.type]||'var(--mt)'};">${ic(typeIcon[e.type]||'circle',10)}</span>
              <div class="off-tl-body">
                <div class="off-tl-text">${e.text||''}</div>
                <div class="off-tl-meta">${e.ts ? fmtDateTime(e.ts) : ''} · ${e.user||''}</div>
              </div>
            </div>`).join('')}
        <div class="off-tl-comment">
          <input id="off-tl-inp" placeholder="Lägg till intern kommentar…" aria-label="Intern kommentar" style="flex:1;">
          <button type="button" class="btn bs bsm" onclick="OfferDetailPage._addComment('${id}')">${ic('send',13)} Spara</button>
        </div>
      </div>
    </section>`;
  },

  _quickAction(offerId, type) {
    const off = getOff(offerId);
    if (!off) return;
    const labels = {ring:'Ringde kund', email:'Mailade kund', followup:'Boka uppföljning', reminder:'Påminnelse satt', price:'Prisförhandling', change:'Kund vill ändra', verbal:'Muntligt godkänd', reason:'Orsak till nekad offert', tip:'Intern notering'};
    const label = labels[type] || type;

    // followup / reminder → rich activity-creation modal
    if (type === 'followup' || type === 'reminder') {
      const tomorrow = _ds(1);
      const staffOpts = (state.staff || []).filter(s => s.active !== false)
        .map(s => `<option value="${s.id}"${state.currentUser && s.id === state.currentUser.id ? ' selected' : ''}>${esc(s.firstName)} ${esc(s.lastName)}</option>`).join('');
      const actType = type === 'followup' ? 'followup' : 'call';
      Modal.open({
        title: `${ic('bell',14)} ${label}`,
        body: `<div style="display:flex;flex-direction:column;gap:10px;">
          <div class="fg"><label>Typ</label>
            <select id="act-type">
              <option value="followup"${actType==='followup'?' selected':''}>Uppföljning</option>
              <option value="call"${actType==='call'?' selected':''}>Ring kund</option>
              <option value="email">Mejl</option>
              <option value="meeting">Möte</option>
              <option value="task">Uppgift</option>
            </select></div>
          <div style="display:flex;gap:8px;">
            <div class="fg" style="flex:1;"><label>Datum</label><input type="date" id="act-date" value="${tomorrow}"></div>
            <div class="fg" style="width:90px;"><label>Tid</label><input type="time" id="act-time" value="09:00"></div>
          </div>
          <div class="fg"><label>Ansvarig</label><select id="act-assignee">${staffOpts}</select></div>
          <div class="fg"><label>Notering</label><textarea id="act-note" rows="2" placeholder="Vad ska göras?"></textarea></div>
          <div class="fg"><label>Prioritet</label>
            <select id="act-priority">
              <option value="normal">Normal</option>
              <option value="hög">Hög</option>
              <option value="låg">Låg</option>
            </select>
          </div>
        </div>`,
        buttons: [
          { label: 'Spara aktivitet', cls: 'btn bp', onClick: () => {
            const actT    = document.getElementById('act-type')?.value || 'followup';
            const date    = document.getElementById('act-date')?.value || tomorrow;
            const time    = document.getElementById('act-time')?.value || '';
            const assignee= document.getElementById('act-assignee')?.value || null;
            const note    = (document.getElementById('act-note')?.value || '').trim();
            const priority= document.getElementById('act-priority')?.value || 'normal';
            const cu      = getCu(off.customerId);
            const cuName  = cu ? cu.name : (off.customerId || off.id);
            const actTitle= `${ActivitiesService.typeLabel(actT)} — ${cuName}`;
            const act = ActivitiesService.create({
              title:       actTitle,
              type:        actT,
              relatedType: 'offer',
              relatedId:   off.id,
              customerId:  off.customerId || null,
              assignedTo:  assignee,
              dueDate:     date,
              dueTime:     time,
              note:        note,
              priority:    priority
            });
            const dateStr = new Date(date).toLocaleDateString('sv-SE', {day:'numeric',month:'short'});
            this._logEvt(off, 'followup', `Uppföljning bokad ${dateStr}${time?' kl '+time:''}${note?': '+note:''}`);
            off.updatedAt = new Date().toISOString();
            Sidebar.updateBadges();
            Modal.close();
            this.render({offerId});
            confirmPersist('offers', off.id, { ok: `Aktivitet skapad — ${dateStr}`, fail: 'Aktiviteten kunde inte sparas', onChange: () => this.render({offerId}) });
          }},
          { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
        ]
      });
      setTimeout(() => document.getElementById('act-note')?.focus(), 80);
      return;
    }

    // All other types: simple text modal
    Modal.open({
      title: label,
      body: `<div class="fg"><label>${label}</label><textarea id="qa-text" rows="3" placeholder="Anteckning…"></textarea></div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          const txt = (document.getElementById('qa-text')?.value || '').trim();
          this._logEvt(off, type, label + (txt ? ': ' + txt : ''));
          off.updatedAt = new Date().toISOString();
          if (type === 'verbal') {
            off.status = 'godkänd';
            off.answeredAt = new Date().toISOString();
            this._logEvt(off, 'status', 'Status: Skickad → Godkänd (muntligt)');
          }
          persist();
          Modal.close();
          this.render({offerId});
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('qa-text')?.focus(), 80);
  },

  _addComment(offerId) {
    const inp = document.getElementById('off-tl-inp');
    const txt = (inp?.value || '').trim();
    if (!txt) return;
    const off = getOff(offerId);
    if (!off) return;
    this._logEvt(off, 'comment', txt);
    off.updatedAt = new Date().toISOString();
    this.render({offerId});
    return confirmPersist('offers', off.id, { ok: 'Kommentar sparad', fail: 'Kommentaren kunde inte sparas', onChange: () => this.render({offerId}) });
  },

  _toggleKalk(kId) {
    const el  = document.getElementById(kId);
    const btn = el && el.previousElementSibling;
    if (!el) return;
    const show = el.style.display === 'none';
    el.style.display = show ? 'block' : 'none';
    if (btn && btn.classList.contains('off-line-kalk-btn')) {
      btn.textContent = show ? 'Dölj beräkning' : 'Visa beräkning';
    }
  },

  /* ── Text rendering ─── */
  _sanitizeText(raw) {
    if (!raw) return '';
    // Filter list lines that are garbage: too short, or known bad fragments
    const BAD = /^(göra|görs|gör|på|allting|allt|etc|osv|mm|m\.m\.|bl\.a\.|t\.ex\.)$/i;
    return raw.split('\n').filter(line => {
      if (!line.startsWith('- ')) return true; // keep non-list lines as-is
      const content = line.slice(2).trim();
      if (content.length < 5) return false;
      if (BAD.test(content)) return false;
      return true;
    }).join('\n');
  },

  _renderText(raw) {
    if (!raw) return '';
    raw = this._sanitizeText(raw);
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const lines = raw.split('\n');
    let html = '', inList = false;
    for (let line of lines) {
      // Bold: **text**
      line = esc(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      if (line.startsWith('## ')) {
        if (inList) { html += '</ul>'; inList = false; }
        html += `<div style="font-size:12px;font-weight:800;color:var(--navy);margin:6px 0 2px;">${line.slice(3)}</div>`;
      } else if (line.startsWith('- ')) {
        if (!inList) { html += '<ul class="off-rt-list">'; inList = true; }
        html += `<li>${line.slice(2)}</li>`;
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        if (line.trim()) html += `<div>${line}</div>`;
      }
    }
    if (inList) html += '</ul>';
    return html;
  },

  /* ── AI Säljassistent ─── */
  _salesAssistantHtml(off) {
    const now = Date.now();
    const sentDate  = off.sentAt ? new Date(off.sentAt).getTime() : null;
    const daysSent  = sentDate  ? Math.round((now - sentDate)  / 86400000) : null;
    const validDate = off.validUntil ? new Date(off.validUntil).getTime() : null;
    const daysLeft  = validDate ? Math.round((validDate - now) / 86400000) : null;
    const prLines   = (off.lines||[]).filter(l => l.type !== 'text');
    const extras    = off.extras||[];
    const _tot      = _offerCalcTotals(off);
    const rawExVat  = _tot.rawExVat;
    const exVat     = _tot.exVatAfterDiscount;
    const incVat    = _tot.totalInclVat;
    const rutAmt    = _tot.rutRotAmount;
    const cust      = _tot.customerPays;
    const tips = [];

    // Check open activities for this offer
    const offerActs   = (state.activities || []).filter(a => a.relatedType === 'offer' && a.relatedId === off.id && a.status === 'open');
    const overdueActs = offerActs.filter(a => a.dueDate && a.dueDate < tdy());
    const todayActs   = offerActs.filter(a => a.dueDate === tdy());
    const nextAct     = offerActs.sort((a,b) => (a.dueDate||'').localeCompare(b.dueDate||''))[0];

    if (overdueActs.length > 0) {
      const a = overdueActs[0];
      const daysAgo = Math.round((Date.now() - new Date(a.dueDate).getTime()) / 86400000);
      tips.push({icon:'alert-circle', color:'var(--rd)', title:`Försenad uppföljning (${daysAgo} dag${daysAgo===1?'':'ar'} sen)`, body:(a.note || 'Uppföljning krävs') + ` — planerat ${fmtDate(a.dueDate)}`, cta:'Markera klar', ctaFn:`ActivitiesService.complete('${a.id}');OfferDetailPage.render({offerId:'${off.id}'})`});
    } else if (todayActs.length > 0) {
      const a = todayActs[0];
      tips.push({icon:'bell', color:'var(--or)', title:'Uppföljning idag!', body:a.note || 'Planerad uppföljning att utföra idag.', cta:'Markera klar', ctaFn:`ActivitiesService.complete('${a.id}');OfferDetailPage.render({offerId:'${off.id}'})`});
    } else if (nextAct) {
      const dateStr = fmtDate(nextAct.dueDate);
      tips.push({icon:'calendar-check', color:'var(--gr)', title:`Nästa uppföljning: ${dateStr}`, body:nextAct.note || 'Uppföljning inbokad.', cta:'Boka ny', ctaFn:`OfferDetailPage._quickAction('${off.id}','followup')`});
    }

    if (off.status === 'utkast') {
      if (!prLines.length) {
        tips.push({icon:'alert-circle', color:'var(--rd)', title:'Offerten är tom', body:'Lägg till minst en tjänst eller rad i steg 2 innan du skickar.', cta:'Redigera', ctaFn:`OffersPage.openEdit('${off.id}')`});
      } else if (!off.scope && !off.summary) {
        tips.push({icon:'edit-3', color:'var(--mt)', title:'Lägg till uppdragsbeskrivning', body:'En tydlig uppdragsbeskrivning ökar vinstchansen avsevärt. Klicka Redigera och använd textgeneratorn.', cta:'Redigera & generera text', ctaFn:`OffersPage.openEdit('${off.id}')`});
      } else {
        tips.push({icon:'send', color:'var(--blue)', title:'Klar att skicka?', body:'Offerten ser komplett ut. Skicka den till kunden för att komma vidare i affären.', cta:'Skicka offert', ctaFn:`OfferDetailPage.showSendModal('${off.id}')`});
      }
      if (rutAmt > 0 && prLines.length > 0) {
        tips.push({icon:'info', color:'var(--gr)', title:`Lyft RUT/ROT i kommunikationen`, body:`Kunden betalar bara ${fmt(cust).toLocaleString('sv-SE')} kr efter avdraget. Nämn det redan i e-postmeddelandet — det är en tydlig och konkret säljpunkt.`});
      }
      if (prLines.length > 0 && cust > 20000) {
        tips.push({icon:'phone', color:'var(--mt)', title:'Ring kunden innan du skickar', body:`Stor affär (${fmt(cust)} kr kund) — ett samtal innan utskick ökar konverteringen avsevärt.`, cta:'Logga samtal', ctaFn:`OfferDetailPage._quickAction('${off.id}','ring')`});
      }
    }

    if (off.status === 'skickad' || off.status === 'påmind' || off.status === 'väntar') {
      if (daysSent !== null && daysSent > 7) {
        tips.push({icon:'alert-circle', color:'var(--rd)', title:`Skickad för ${daysSent} dagar sedan — risk för förlust`, body:'Äldre offerter konverterar sämre. Ring kunden direkt och håll liv i dialogen.', cta:'Logga samtal', ctaFn:`OfferDetailPage._quickAction('${off.id}','ring')`});
      } else if (daysSent !== null && daysSent >= 3) {
        tips.push({icon:'bell', color:'var(--or)', title:`Dags att följa upp (${daysSent} dagar sedan)`, body:'Skicka ett vänligt uppföljningsmejl och fråga om kunden har frågor kring offerten.', cta:'Logga uppföljning', ctaFn:`OfferDetailPage._quickAction('${off.id}','followup')`});
      }
      if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 5) {
        tips.push({icon:'clock', color:'var(--or)', title:`Giltighet utgår om ${daysLeft} dag${daysLeft===1?'':'ar'}`, body:'Kontakta kunden nu och förläng giltigheten om nödvändigt för att inte tappa affären.'});
      }
      if (rutAmt > 0) {
        tips.push({icon:'dollar-sign', color:'var(--gr)', title:'Lyft RUT/ROT-avdraget i uppföljningen', body:`Kunden betalar bara ${(cust).toLocaleString('sv-SE')} kr efter avdraget — en konkret och övertygande säljpunkt.`});
      }
      if (cust > 20000) {
        tips.push({icon:'phone', color:'var(--mt)', title:'Stor affär — personlig kontakt rekommenderas', body:'För offerter över 20 000 kr ökar chansen med ett personligt samtal snarare än enbart e-post.'});
      }
      if (!offerActs.length) {
        tips.push({icon:'bell', color:'var(--mt)', title:'Ingen uppföljning bokad', body:'Boka en uppföljning inom 3 dagar för bästa konvertering.', cta:'Boka uppföljning', ctaFn:`OfferDetailPage._quickAction('${off.id}','followup')`});
      }
    }

    if (off.status === 'påmind') {
      if (daysSent !== null && daysSent > 14) {
        tips.push({icon:'alert-circle', color:'var(--rd)', title:`Skickad påminnelse för ${daysSent} dagar sedan`, body:'Ring kunden direkt — ärendet riskerar att falla bort.', cta:'Logga samtal', ctaFn:`OfferDetailPage._quickAction('${off.id}','ring')`});
      }
    }

    if (off.status === 'nekad') {
      tips.push({icon:'help-circle', color:'var(--mt)', title:'Analysera varför affären föll', body:'Var det pris, timing, konkurrent eller omfattning? Logga orsaken för framtida lärdomar.', cta:'Logga orsak', ctaFn:`OfferDetailPage._quickAction('${off.id}','reason')`});
      tips.push({icon:'git-branch', color:'var(--blue)', title:'Föreslå nytt erbjudande', body:'Skapa en ny version och justera — antingen priset, villkoren eller tjänsternas omfattning. Många affärer återvinns med rätt anpassning.', cta:'Ny version', ctaFn:`OfferDetailPage.createNewVersion('${off.id}')`});
    }

    /* OFFER CORE R1.5 — FINAL BLOCKER (motbevis-granskad): added
       `&& !off.archived && !off.deleted` — this recommendation had NO
       lifecycle check at all, so an approved-but-archived/deleted offer
       could still be recommended for AO creation here even though the
       secondary button row already correctly hid its own "Skapa AO"
       button for that same offer. */
    if (off.status === 'godkänd' && !off.workOrderId && !off.archived && !off.deleted && !OffersPage._offBlocksAOConversion(off)) {
      tips.push({icon:'clipboard-list', color:'var(--gr)', title:'Skapa arbetsorder nu', body:'Offerten är godkänd — starta jobbet genom att skapa en arbetsorder direkt från offerten.', cta:'Skapa AO', ctaFn:`OfferDetailPage.createAO()`});
    }
    if (off.status === 'godkänd' && off.workOrderId) {
      tips.push({icon:'clipboard-list', color:'var(--gr)', title:`Arbetsorder ${off.workOrderId} skapad`, body:'Gå till arbetsordern för att planera, dokumentera och slutföra uppdraget.', cta:'Öppna AO', ctaFn:`Router.showPage('pg-ao-detail',{aoId:'${off.workOrderId}'})`});
    }

    if (!tips.length) return '';

    /* QA 2026-11-26: hopfällbart kort, stängt som standard (som tidigare). */
    const head = this._cardHead(off, 'salesAssistant', false, 'zap', 'Säljtips', tips.length);
    if (!head.open) return `<section class="card offd-card offd-tips">${head.html}</section>`;
    return `<section class="card offd-card offd-tips">
      ${head.html}
      <div class="card-body" style="padding:6px 14px 10px;display:flex;flex-direction:column;gap:8px;">
        ${tips.map(t=>`<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 10px;background:var(--bg);border-radius:var(--rs);">
          <span style="color:${t.color};flex-shrink:0;margin-top:1px;">${ic(t.icon,14)}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:700;color:var(--navy);margin-bottom:2px;">${esc(t.title)}</div>
            <div style="font-size:11px;color:var(--mt);line-height:1.4;">${esc(t.body)}</div>
            ${t.cta?`<button type="button" class="btn bs bsm" style="margin-top:6px;" onclick="${t.ctaFn}">${esc(t.cta)}</button>`:''}
          </div>
        </div>`).join('')}
      </div>
    </section>`;
  },

  /* ── PDF/Print ─── */
  printPdf(offerId) {
    const off = getOff(offerId);
    if (!off) return;
    const cu        = getCu(off.customerId);
    const cuName    = cu ? CustomerService.displayName(cu) : '—';
    const cuContact = cu ? cu.contactPerson || '' : '';
    const cuAddr    = cu ? [cu.address, cu.zip, cu.city].filter(Boolean).join(', ') : '';
    const cuPhone   = cu ? cu.phone || '' : '';
    const cuEmail   = cu ? cu.email || '' : '';
    const s         = state.settings || {};
    const co        = s.companyName    || 'VIFT Fastighetsservice & Förvaltning AB';
    const coPhone   = s.companyPhone   || '';
    const coEmail   = s.companyEmail   || '';
    const coAddr    = s.companyAddress || '';
    const orgNr     = s.orgNr          || '';
    const logoUrl   = BrandingService.logoLightAbsolute();

    const allLines = off.lines||[];
    const prLines  = allLines.filter(l=>l.type!=='text');
    const extras   = off.extras||[];
    const _tot     = _offerCalcTotals(off);
    const rawExVat = _tot.rawExVat;
    const _disc    = off.discount||{type:'percent',value:0};
    const discAmt  = _tot.discountAmount;
    const exVat    = _tot.exVatAfterDiscount;
    const vat      = _tot.vatAmount;
    const incVat   = _tot.totalInclVat;
    const rutAmt   = _tot.rutRotAmount;
    const cust     = _tot.customerPays;
    const hasRut   = rutAmt > 0;
    const fmt2     = n => (n||0).toLocaleString('sv-SE');
    const esc2     = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const san2     = s => OfferDetailPage._sanitizeText(s||'');

    // RUT or ROT label
    const rutLabel = (() => {
      const svcs = prLines.filter(l=>(l.rutAmount||0)>0);
      if (svcs.length === 0) return 'RUT/ROT-avdrag';
      return svcs.every(l=>l.reductionType==='rot') ? 'ROT-avdrag' : 'RUT-avdrag';
    })();

    /* V48B5 R4 §4: rader (inkl. textblock) MÅSTE fysiskt återges i EXAKT
       off.lines-arrayordning — text-rader ritas som en <tr> med
       colspan="4" i SAMMA tabell, på sin exakta position, istället för
       att samlas separat efter Tillval. */
    const lineRows = allLines.map(l => {
      if (l.type==='text') {
        if (!l.blockTitle && !l.text) return '';
        return `<tr class="txt-row"><td colspan="4">` +
          (l.blockTitle ? `<strong>${esc2(l.blockTitle)}</strong>` : '') +
          (l.text ? (l.blockTitle?'<br>':'') + `<span class="ld" style="white-space:pre-wrap;">${esc2(l.text)}</span>` : '') +
        `</td></tr>`;
      }
      if (l.type==='service') {
        const lExVat=l.exVat||0, lRate=_normVat(l.vatRate), lVat=Math.round(lExVat*lRate/100);
        return `<tr>
          <td><strong>${esc2(l.templateName||'Tjänst')}</strong>${l.description&&l.description!==l.templateName?'<br><span class="ld">'+esc2(l.description)+'</span>':''}</td>
          <td class="r">${fmt2(lExVat)} kr</td>
          <td class="r">${lRate}%</td>
          <td class="r fw">${fmt2(lExVat+lVat)} kr</td>
        </tr>`;
      }
      /* OFFER CORE R1.1 — BLOCKER 3: samma naiva `qty*unitPrice`-bugg som
         redan hittats/fixats i OfferDetailPage.render() och
         public-offer.html finns HÄR också — en rate-rad (billingType=
         'rate') fick sitt à-pris felaktigt räknat som en committad
         engångssumma. _lineExVat(l) är den kanoniska dispatchen (0 för
         rate, det verkliga beloppet annars) — samma fix, tredje stället. */
      const bt3 = l.billingType || 'onetime';
      const tot = _lineExVat(l);
      const lRate=_normVat(l.vatRate);
      if (bt3 === 'rate') {
        const rateInc = Math.round((l.unitPrice||0) * (1 + lRate/100));
        return `<tr class="xtra">
          <td>${esc2(l.description||'—')} <span class="ld" style="font-weight:700;">(rörligt à-pris, ingår ej i totalsumman)</span><br><span class="ld">à ${fmt2(l.unitPrice||0)} kr${l.unit?'/'+esc2(l.unit):''} ex. moms</span></td>
          <td class="r">${fmt2(l.unitPrice||0)} kr</td>
          <td class="r">${lRate}%</td>
          <td class="r fw">${fmt2(rateInc)} kr</td>
        </tr>`;
      }
      const recSuffix = bt3 === 'recurring' ? (l.unit ? '/'+esc2(l.unit) : '/mån') : '';
      return `<tr>
        <td>${esc2(l.description||'—')}${bt3==='recurring'?' <span class="ld" style="font-weight:700;">(återkommande)</span>':''}<br><span class="ld">${l.qty||1} ${l.unit||'st'} × ${fmt2(l.unitPrice||0)} kr ex. moms</span></td>
        <td class="r">${fmt2(tot)} kr${recSuffix}</td>
        <td class="r">${lRate}%</td>
        <td class="r fw">${fmt2(tot+Math.round(tot*lRate/100))} kr${recSuffix}</td>
      </tr>`;
    }).join('');

    const extrasRows = extras.length ? extras.map(e => {
      const tot=Math.round((e.qty||1)*(e.unitPrice||0));
      const eRate=_normVat(e.vatRate);
      const included = _extraIncludedInTotal(e);
      return `<tr class="xtra">
        <td>${esc2(e.description||'Tillval')}${!included?' <span class="ld" style="font-weight:700;">(ingår ej i totalsumman)</span>':''}<br><span class="ld">${e.qty||1} ${e.unit||'st'} × ${fmt2(e.unitPrice||0)} kr</span></td>
        <td class="r">${fmt2(tot)} kr</td>
        <td class="r">${eRate}%</td>
        <td class="r">${fmt2(tot+Math.round(tot*eRate/100))} kr</td>
      </tr>`;
    }).join('') : '';

    const defaultTerms = 'Offerten är giltig enligt angiven giltighetstid från offererat datum. Betalning 30 dagar netto. Dröjsmålsränta 8 % per år. Vid godkänd offert upprättas skriftlig orderbekräftelse. VIFT förbehåller sig rätten att justera priset vid väsentliga förändringar av uppdragets omfattning. Priser angivna exklusive moms om inget annat framgår.';
    const generalTermsBlock = `<div class="terms">
  <div class="terms-h">Allmänna villkor</div>
  <div class="terms-t">${off.generalTerms ? esc2(off.generalTerms).replace(/\n/g,'<br>') : esc2(defaultTerms)}</div>
</div>`;
    const footerLine = [coPhone?'Tel: '+coPhone:'', coEmail||'', orgNr?'Org.nr: '+orgNr:''].filter(Boolean).join('  ·  ');

    const html = `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="UTF-8">
<title>Offert ${esc2(off.id)} – ${esc2(cuName)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Helvetica Neue',Arial,Helvetica,sans-serif;font-size:13px;color:#1e293b;background:#fff;}
.pg{max-width:800px;margin:0 auto;padding:36px 44px;}

/* Header */
.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:20px;border-bottom:1px solid #f1f5f9;gap:28px;}
.hdr-accent{height:2px;background:linear-gradient(90deg,#0d2b4e 0%,#3b82f6 60%,transparent 100%);border-radius:2px;margin-bottom:26px;margin-top:-24px;}
.logo-wrap{display:flex;align-items:center;gap:0;}
.logo-img{max-height:44px;max-width:160px;width:auto;height:auto;object-fit:contain;display:block;}
.logo-fb{display:none;background:#0d2b4e;color:#fff;font-weight:900;font-size:18px;padding:9px 14px 8px;border-radius:6px;letter-spacing:-0.5px;line-height:1;}
.logo-sep{width:1px;background:#e8ecf0;height:36px;margin:0 14px;flex-shrink:0;}
.logo-co{font-size:11px;font-weight:700;color:#0d2b4e;line-height:1.4;}
.logo-detail{font-size:10px;color:#94a3b8;margin-top:3px;line-height:1.6;}

.off-meta{text-align:right;flex-shrink:0;padding-top:2px;}
.off-num-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.4px;color:#94a3b8;margin-bottom:2px;}
.off-num{font-size:20px;font-weight:900;color:#0d2b4e;letter-spacing:-0.5px;line-height:1;margin-bottom:4px;}
.off-title{font-size:11px;font-weight:600;color:#64748b;margin-bottom:3px;}
.off-date{font-size:10px;color:#94a3b8;line-height:1.6;}
.validity{display:inline-block;background:#f0f9ff;border:1px solid #bae6fd;color:#0369a1;font-size:9px;font-weight:700;padding:2px 9px;border-radius:20px;margin-top:5px;letter-spacing:.2px;}

/* Parties */
.parties{display:grid;grid-template-columns:1fr 1fr;gap:0;margin-bottom:24px;padding-bottom:20px;border-bottom:1px solid #f1f5f9;}
.party{padding:0 24px 0 0;}
.party:last-child{padding:0 0 0 24px;border-left:1px solid #f1f5f9;}
.p-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.9px;color:#94a3b8;margin-bottom:6px;}
.p-name{font-size:14px;font-weight:800;color:#0d2b4e;margin-bottom:4px;line-height:1.3;}
.p-det{font-size:11px;color:#64748b;line-height:1.75;}

/* Sections */
.sec{margin-bottom:16px;}
.sec-h{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;padding-bottom:6px;margin-bottom:10px;border-bottom:1px solid #f1f5f9;}
.sec-t{font-size:12px;line-height:1.8;color:#334155;}

/* Ingår/ingår ej */
.ie{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:22px;}
.ie-in{border-left:3px solid #4ade80;padding:8px 12px;}
.ie-out{border-left:3px solid #fb923c;padding:8px 12px;}
.ie-lbl-in{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#16a34a;margin-bottom:6px;}
.ie-lbl-out{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#c2410c;margin-bottom:6px;}
.ie-t{font-size:11px;line-height:1.75;white-space:pre-wrap;color:#374151;}
.ie-t.muted{color:#64748b;}

/* Table */
table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:6px;}
thead th{background:transparent;color:#64748b;padding:5px 10px 9px;font-size:9px;font-weight:700;letter-spacing:.5px;text-align:left;border-bottom:2px solid #0d2b4e;}
thead th.r{text-align:right;}
tbody td{padding:10px 10px;border-bottom:1px solid #f0f4f8;vertical-align:top;}
tbody tr:last-child td{border-bottom:none;}
tbody tr:nth-child(even) td{background:#fafbfc;}
td.r{text-align:right;white-space:nowrap;}
td.fw{font-weight:600;color:#0d2b4e;}
.ld{font-size:10px;color:#94a3b8;margin-top:2px;}
.xtra td{color:#94a3b8;font-style:italic;}

/* Totals */
.tot-wrap{display:flex;justify-content:flex-end;margin:8px 0 20px;}
.tot-box{min-width:260px;}
.tot-r{display:flex;justify-content:space-between;align-items:center;padding:6px 0;font-size:12px;color:#64748b;border-bottom:1px solid #f1f5f9;}
.tot-r.disc{color:#b45309;border-bottom:1px solid #f1f5f9;}
.tot-div{height:1px;background:#cbd5e1;margin:2px 0;border:none;}
.tot-fin{display:flex;justify-content:space-between;align-items:center;padding:10px 0 4px;font-size:18px;font-weight:900;color:#0d2b4e;border-bottom:none;}
.tot-r.rut-deduct{color:#16a34a;font-weight:700;border-bottom:none;font-size:13px;}

/* RUT/ROT */
.rut{display:flex;align-items:flex-start;gap:14px;background:#f0fdf4;border-left:4px solid #4ade80;border-radius:0 8px 8px 0;padding:13px 16px;margin-bottom:20px;}
.rut-icon{width:38px;height:38px;background:#16a34a;border-radius:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#fff;font-weight:900;font-size:11px;line-height:1.2;text-align:center;}
.rut-body{flex:1;}
.rut-lbl{font-size:11px;font-weight:700;color:#16a34a;margin-bottom:3px;}
.rut-amt{font-size:22px;font-weight:900;color:#16a34a;line-height:1;}
.rut-sub{font-size:11px;color:#374151;margin-top:4px;line-height:1.6;}
.rut-note{font-size:10px;color:#64748b;margin-top:4px;font-style:italic;line-height:1.5;}

/* Terms */
.terms{border-top:1px solid #f1f5f9;padding-top:14px;margin-top:16px;}
.terms-h{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.9px;color:#94a3b8;margin-bottom:7px;}
.terms-t{font-size:10px;color:#94a3b8;line-height:1.75;}

/* Footer */
.ftr{margin-top:24px;padding-top:10px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;font-size:9px;color:#94a3b8;}
.ftr-brand{font-weight:700;color:#475569;font-size:10px;}

@media print{body{padding:0;}.pg{padding:18px 22px;}@page{margin:10mm 14mm;size:A4;}}
</style>
</head>
<body>
<div class="pg">

<div class="hdr">
  <div class="logo-wrap">
    <img class="logo-img" src="${logoUrl}" alt="VIFT"
      onerror="this.style.display='none';this.nextElementSibling.style.display='inline-block'">
    <div class="logo-fb">VIFT</div>
    <div class="logo-sep"></div>
    <div class="logo-info">
      <div class="logo-co">${esc2(co)}</div>
      ${coAddr?`<div class="logo-detail">${esc2(coAddr)}</div>`:''}
      ${coPhone||coEmail?`<div class="logo-detail">${esc([coPhone?'Tel: '+esc2(coPhone):'',coEmail?esc2(coEmail):''].filter(Boolean).join('  ·  '))}</div>`:''}
    </div>
  </div>
  <div class="off-meta">
    <div class="off-num-lbl">Offert</div>
    <div class="off-num">${esc2(off.id)}</div>
    ${off.title?`<div class="off-title">${esc2(off.title)}</div>`:''}
    <div class="off-date">Datum: ${(off.createdAt||'').split('T')[0]||'—'}</div>
    ${off.validUntil?`<div><span class="validity">Giltig till ${esc2(off.validUntil)}</span></div>`:''}
  </div>
</div>
<div class="hdr-accent"></div>

<div class="parties">
  <div class="party">
    <div class="p-lbl">Offereras till</div>
    <div class="p-name">${esc2(cuName)}</div>
    <div class="p-det">${esc([cuContact?esc2(cuContact):'', cuPhone?'Tel: '+esc2(cuPhone):'', cuEmail?esc2(cuEmail):'', cuAddr?esc2(cuAddr):''].filter(Boolean).join('<br>'))}</div>
    ${(function(){
      /* OFFER CORE R1.2 — BLOCKER 3: printPdf() visade tidigare ALDRIG
         offertens fastighet alls (bara kundens EGEN adress ovan, som
         kan skilja sig helt från den offererade fastigheten — se
         Fastighetsbolaget AB/Box 123-fallet). Härlett via samma
         kanoniska _offPropertyDisplayText() som CRM-detaljvyn. */
      const propTxt = _offPropertyDisplayText(off);
      return propTxt ? `<div class="p-det" style="margin-top:4px;"><strong>Fastighet:</strong> ${esc2(propTxt)}</div>` : '';
    })()}
  </div>
  <div class="party">
    <div class="p-lbl">Utfärdare</div>
    <div class="p-det">${esc([orgNr?'Org.nr: '+esc2(orgNr):''].filter(Boolean).join('<br>'))}</div>
  </div>
</div>

${(() => {
  /* V48B5 R1/R2: EXAKT FYRA fysiskt flyttbara block — description/
     pricing/commercialTerms/generalTerms. "pricing" omfattar HELA det
     prisrelaterade innehållet (rader, tillval, textblock, delsumma/
     rabatt/moms/ROT-RUT-box, kundpris) och flyttas som en enhet.
     Godkännande-signaturrutan är INTE ett av de fyra blocken (R2 §2-
     korrigering — låg tidigare felaktigt inbäddad i pricing och
     flyttade med det) — den ligger FAST direkt efter den ordnade
     sekvensen, se koden efter renderers-loopen nedan. Sidfoten ligger
     alltid allra sist (administrativ metadata, inget offertinnehåll).
     B5 har aldrig gått live -> ingen legacy-position att bevara. */
  const descriptionBlock = off.summary?`<div class="sec"><div class="sec-h">Sammanfattning</div><div class="sec-t">${esc2(off.summary).replace(/\n/g,'<br>')}</div></div>`:'';
  const scopeBlock = off.scope?`<div class="sec"><div class="sec-h">Uppdragets omfattning</div><div class="sec-t">${esc2(off.scope).replace(/\n/g,'<br>')}</div></div>`:'';
  const includesExcludesBlock = off.includes||off.excludes?`<div class="ie">
    ${off.includes?`<div class="ie-in"><div class="ie-lbl-in">✓ Ingår i uppdraget</div><div class="ie-t">${esc2(san2(off.includes))}</div></div>`:''}
    ${off.excludes?`<div class="ie-out"><div class="ie-lbl-out">✗ Ingår ej</div><div class="ie-t muted">${esc2(san2(off.excludes))}</div></div>`:''}
  </div>`:'';
  const linesBlock = `<div class="sec-h">Offertrader</div>
<table>
  <thead><tr>
    <th>Tjänst / Beskrivning</th>
    <th class="r">Ex. moms</th>
    <th class="r">Moms</th>
    <th class="r">Inkl. moms</th>
  </tr></thead>
  <tbody>${lineRows}</tbody>
</table>`;
  /* V48B5 R4: textblocken ritas nu INLINE i lineRows (ovan), på sin
     exakta position i off.lines — inte längre samlade separat efter
     Tillval. */
  /* OFFER CORE R1.1 — BLOCKER 1: rubriken sa TIDIGARE ALLTID "ej
     inkluderat i totalpriset" trots att _offRawExVat/_offRawVat i
     verkligheten ALLTID räknade in extras i totalsumman — en bevisad
     motsägelse mellan text och siffra. Rubriken är nu sanningsenlig:
     "Tillval" om NÅGON extra faktiskt är committad (ingår i summan),
     annars den ursprungliga texten (endast om ALLA extras är explicit
     markerade som ej committade). Varje enskild rad har dessutom sin
     egen "(ingår ej i totalsumman)"-etikett ovan när tillämpligt. */
  const extrasBlock = extras.length?`<table style="margin-top:8px;"><thead><tr><th colspan="4" style="background:#475569;font-size:10px;">${extras.some(_extraIncludedInTotal)?'Tillval':'Tillval (ej inkluderat i totalpriset)'}</th></tr></thead><tbody>${extrasRows}</tbody></table>`:'';

  /* OFFER CORE R1.1 — BLOCKER 2/6: samma additiva återkommande-block +
     ex.-moms-primärvärde som wizardens totalkort/public-offer.html —
     en ren Södra Heden-offert (bara 'recurring'-rader) visade tidigare
     "0 kr" här (rawExVat/incVat är 0 när det inte finns någon
     engångskomponent), eftersom detta PDF-block bara läste den
     klassiska hinken. Kontraktsvärdet (ex. moms) är PRIMÄRT, en
     eventuell inkl.-moms-siffra är sekundär/informativ. */
  const totalsBlock = `<div class="tot-wrap">
  <div class="tot-box">
    ${_tot.recurringMonthlyExVat ? `
    <div class="tot-fin"><span>Fast kostnad per månad</span><span>${fmt2(_tot.recurringMonthlyExVat)} kr exkl. moms</span></div>
    <div class="tot-r"><span>Fast kostnad per år (härledd)</span><span>${fmt2(_tot.recurringAnnualExVat)} kr exkl. moms</span></div>
    <hr class="tot-div">` : ''}
    <div class="tot-r"><span>${_tot.recurringMonthlyExVat?'Engångsbelopp ex. moms':'Summa ex. moms'}</span><span>${fmt2(rawExVat)} kr</span></div>
    ${discAmt?`<div class="tot-r disc"><span>${_tot.recurringMonthlyExVat?'Rabatt på engångsbelopp':'Rabatt'}</span><span>−${fmt2(discAmt)} kr</span></div>`:''}
    <div class="tot-r"><span>Moms</span><span>${fmt2(vat)} kr</span></div>
    ${rawExVat > 0 ? `
    <hr class="tot-div">
    <div class="tot-fin"><span>${hasRut?'Totalt inkl. moms':(_tot.recurringMonthlyExVat?'Engångsbelopp inkl. moms':'Totalt att betala')}</span><span>${fmt2(incVat)} kr</span></div>
    ${hasRut?`<div class="tot-r rut-deduct" style="margin-top:4px;"><span>${rutLabel}</span><span>−${fmt2(rutAmt)} kr</span></div>`:''}` : ''}
  </div>
</div>
${(off.lines||[]).some(l=>(l.description||'').includes('minimidebitering'))?`<div style="margin-bottom:12px;padding:7px 10px;background:#fffbeb;border-left:3px solid #d97706;font-size:10px;color:#555;line-height:1.5;border-radius:0 4px 4px 0;"><strong>Minimidebitering:</strong> Tjänsten har ett lägsta debiteringsbelopp som täcker etablering, utrustning och grundarbete.</div>`:''}
${hasRut?`<div class="rut">
  <div class="rut-icon">${rutLabel.startsWith('ROT')?'ROT':'RUT'}</div>
  <div class="rut-body">
    <div class="rut-lbl">${rutLabel} — skattereduktion</div>
    <div class="rut-amt">${fmt2(cust)} kr</div>
    <div class="rut-sub">Kundpris inkl. moms &nbsp;·&nbsp; Preliminärt avdrag: −${fmt2(rutAmt)} kr &nbsp;·&nbsp; Totalt inkl. moms: ${fmt2(incVat)} kr</div>
    <div class="rut-note">* Avdraget är preliminärt och förutsätter att kunden har rätt till skattereduktion. VIFT administrerar ansökan direkt till Skatteverket.</div>
  </div>
</div>`:''}`;

  const commercialTermsBlock = (off.paymentTerms||off.validityText) ? `<div class="sec">
    <div class="sec-h">Offertvillkor</div>
    ${off.paymentTerms?`<div class="p-det" style="margin-bottom:6px;"><strong>Betalningsvillkor:</strong> ${esc2(off.paymentTerms)}</div>`:''}
    ${off.validityText?`<div class="p-det"><strong>Giltighetstid:</strong> ${esc2(off.validityText)}</div>`:''}
  </div>`:'';

  const renderers = {
    description: descriptionBlock + scopeBlock + includesExcludesBlock,
    pricing: linesBlock + extrasBlock + totalsBlock,
    commercialTerms: commercialTermsBlock,
    generalTerms: generalTermsBlock
  };
  return _resolveSectionOrder(off.sectionOrder).map(id => renderers[id] || '').join('');
})()}

<!-- V48B5 R2 §2: Godkännande/signaturrutan är INTE ett av de fyra
     flyttbara innehållsblocken (description/pricing/commercialTerms/
     generalTerms) — den ligger alltid FAST direkt efter den ordnade
     sekvensen, oavsett vald sectionOrder (fanns tidigare felaktigt
     inbäddad i pricing-blocket och flyttade med det). -->
<div style="margin-top:28px;border-top:1px solid #e2e8f0;padding-top:18px;">
  <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.9px;color:#94a3b8;margin-bottom:14px;">Godkännande</div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;">
    <div>
      <div style="height:36px;border-bottom:1px solid #94a3b8;margin-bottom:5px;"></div>
      <div style="font-size:10px;color:#64748b;">Godkänd av</div>
    </div>
    <div>
      <div style="height:36px;border-bottom:1px solid #94a3b8;margin-bottom:5px;"></div>
      <div style="font-size:10px;color:#64748b;">Datum</div>
    </div>
    <div>
      <div style="height:36px;border-bottom:1px solid #94a3b8;margin-bottom:5px;"></div>
      <div style="font-size:10px;color:#64748b;">Namnförtydligande</div>
    </div>
  </div>
</div>

<div class="ftr">
  <div>
    <span class="ftr-brand">${esc2(co)}</span>
    ${coAddr?' · '+esc2(coAddr):''}
  </div>
  <div>${footerLine}</div>
</div>

</div>
</body></html>`;

    /* ── Visa PDF i in-page overlay (fungerar på mobil, iPad, iPhone Safari och PWA) ── */
    const prev = document.getElementById('pdf-preview-ov');
    if (prev) prev.remove();

    const blob    = new Blob([html], {type: 'text/html'});
    const blobUrl = URL.createObjectURL(blob);

    const ov = document.createElement('div');
    ov.id = 'pdf-preview-ov';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#e8edf2;display:flex;flex-direction:column;padding-top:env(safe-area-inset-top);';

    const offLabel = esc2(off.id) + (off.title ? ' – ' + esc2(off.title) : '');

    ov.innerHTML = `
      <div style="flex-shrink:0;background:#0d2b4e;padding:10px 14px;display:flex;align-items:center;gap:8px;">
        <button id="pdf-close-btn" style="background:rgba(255,255,255,.15);border:none;color:#fff;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;">← Tillbaka</button>
        <span style="flex:1;color:#fff;font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${offLabel}</span>
        <button id="pdf-print-btn" style="background:#3b82f6;border:none;color:#fff;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;">Skriv ut</button>
      </div>
      <iframe id="pdf-frame" style="flex:1;border:none;width:100%;background:#fff;" title="Offert ${esc2(off.id)}"></iframe>
    `;
    document.body.appendChild(ov);

    /* Stäng: ta bort overlay och frigör blob-URL */
    document.getElementById('pdf-close-btn').onclick = () => {
      ov.remove();
      URL.revokeObjectURL(blobUrl);
    };

    /* Skriv ut via iframe (iframe + blob fungerar i alla moderna browsers inkl. iOS Safari) */
    document.getElementById('pdf-print-btn').onclick = () => {
      const fr = document.getElementById('pdf-frame');
      if (fr && fr.contentWindow) {
        try { fr.contentWindow.print(); }
        catch(_) { window.open(blobUrl, '_blank'); }
      }
    };

    /* Ladda HTML i iframe via blob-URL — säkert och utan popup-blockers */
    document.getElementById('pdf-frame').src = blobUrl;

    this._logEvt(off, 'pdf', 'PDF genererad');
    off.pdfGeneratedAt = new Date().toISOString();
    off.updatedAt = new Date().toISOString();
    persist();
  },

  /* ── Skicka offert via Edge Function (Resend) ─── */
  showSendModal(offerId) {
    const off = getOff(offerId);
    if (!off) return;
    const cu = getCu(off.customerId);
    const cuEmail    = cu ? (cu.email||'') : '';
    const firstName  = cu ? (cu.firstName||cu.name||'') : '';
    const _interpolate = (tmplStr, extra) => {
      const sentDate = off.sentAt ? new Date(off.sentAt).toLocaleDateString('sv-SE',{day:'numeric',month:'short',year:'numeric'}) : '—';
      const data = {
        offerId: off.id,
        titleSuffix: off.title ? ' – ' + off.title : '',
        firstName: firstName || 'kund',
        customerName: cu ? CustomerService.displayName(cu) : '',
        validUntil: off.validUntil || '—',
        paymentLine: off.paymentTerms ? 'Betalningsvillkor: ' + off.paymentTerms + '.' : '',
        sentDate,
        OFFER_LINK: '{{OFFER_LINK}}',
        ...(extra||{})
      };
      return (tmplStr||'').replace(/\{\{(\w+)\}\}/g, (_, k) => data[k] !== undefined ? data[k] : '');
    };

    const defaultTmpl = (state.emailTemplates||[]).find(t=>t.type==='send_offer') || {
      subject: 'Offert ' + off.id + (off.title?' – '+off.title:''),
      body: 'Hej {{firstName}},\n\nTack för ditt intresse. Bifogat hittar du vår offert ' + off.id + (off.title?' – '+off.title:'') + '.\n\nOfferten är giltig till ' + (off.validUntil||'—') + '.\n\nDu kan också se och svara på offerten online: {{OFFER_LINK}}\n\nMed vänliga hälsningar,\nVIFT Fastighetsservice'
    };

    const tmplOpts = (state.emailTemplates||[]).filter(t=>t.active!==false)
      .map(t => '<option value="' + t.id + '"' + (t.type==='send_offer'?' selected':'') + '>' + esc(t.name) + '</option>').join('');

    const subject = _interpolate(defaultTmpl.subject);
    const body2   = _interpolate(defaultTmpl.body);

    // Bilagor för offerten
    const offerAtts = (state.offerAttachments||[]).filter(a => a.offerId===off.id && !a.deleted && !a.hidden);
    const attCheckboxes = offerAtts.length > 0
      ? `<div class="fg"><label>Bifoga filer</label>
          <div style="display:flex;flex-direction:column;gap:4px;max-height:120px;overflow-y:auto;padding:6px;background:var(--bg);border:1px solid var(--br);border-radius:6px;">
            ${offerAtts.map(a => `<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
              <input type="checkbox" class="send-att-cb" value="${esc(a.id)}" ${a.includeInPublicView?'checked':''}>
              <span>${esc(a.displayName||a.originalFileName)}</span>
            </label>`).join('')}
          </div>
        </div>`
      : '';

    Modal.open({
      title: ic('send',14) + ' Skicka offert',
      wide: true,
      body: `
        ${tmplOpts ? `<div class="fg"><label>Mejlmall</label>
          <select id="send-tmpl" onchange="OfferDetailPage._applySendTemplate('${offerId}',this.value)">${tmplOpts}</select></div>` : ''}
        <div class="fg"><label>Till <small style="color:var(--mt);font-weight:400;">— kommaseparerade adresser</small></label>
          <input id="send-to" value="${esc(cuEmail)}" placeholder="kund@exempel.se, annan@exempel.se" type="email" style="width:100%;box-sizing:border-box;"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div class="fg"><label>CC</label>
            <input id="send-cc" placeholder="cc@exempel.se" type="email" style="width:100%;box-sizing:border-box;"></div>
          <div class="fg"><label>BCC</label>
            <input id="send-bcc" placeholder="bcc@exempel.se" type="email" style="width:100%;box-sizing:border-box;"></div>
        </div>
        <div class="fg"><label>Ämne</label>
          <input id="send-subject" value="${esc(subject)}" style="width:100%;box-sizing:border-box;"></div>
        <div class="fg"><label>Meddelande <small style="color:var(--mt);font-weight:400;">— ${ic('link',10)} {{OFFER_LINK}} ersätts med säker offertlänk (skapas automatiskt vid utskick)</small></label>
          <textarea id="send-body" rows="8" style="width:100%;box-sizing:border-box;">${esc(body2)}</textarea></div>
        ${attCheckboxes}
        <label style="display:flex;align-items:center;gap:8px;padding:8px 0;cursor:pointer;font-size:12px;">
          <input type="checkbox" id="send-followup" checked style="width:15px;height:15px;">
          <span>Skapa uppföljning automatiskt om <strong>3 dagar</strong></span>
        </label>
        <div style="background:var(--bg);border-radius:var(--rs);padding:8px 12px;font-size:11px;color:var(--mt);">
          ${ic('info',10)} Skickar via Resend. Händelselogg sparas i offerttidslinjen.
        </div>
        <div id="send-error" class="off-send-error" hidden></div>`,
      buttons: [
        { label: ic('send',13) + ' Skicka', cls: 'btn bp', onClick: () => this._doSendEmail(off) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('send-to')?.focus(), 80);
  },

  _applyServerPatches(off, json) {
    var changed = false;
    if (json.offerPatch) {
      var stateOff = (state.offers||[]).find(function(o){ return o.id === off.id; });
      if (stateOff) Object.assign(stateOff, json.offerPatch);
      Object.assign(off, json.offerPatch);
      changed = true;
    }
    if (json.attachmentPatches && json.attachmentPatches.length) {
      (state.offerAttachments||[]).forEach(function(a) {
        var p = json.attachmentPatches.find(function(x){ return x.id === a.id; });
        if (p) { a.lockedInVersion = p.lockedInVersion; changed = true; }
      });
    }
    if (json.emailEvent) {
      if (!Array.isArray(state.offerEvents)) state.offerEvents = [];
      // Undvik dubbletter (idempotens)
      if (!state.offerEvents.find(function(e){ return e.id === json.emailEvent.id; })) {
        state.offerEvents.push(json.emailEvent);
        changed = true;
      }
    }
    return changed;
  },

  async _doSendEmail(off) {
    this._clearInlineError('send-error');

    const toRaw   = (document.getElementById('send-to')?.value||'').trim();
    const ccRaw   = (document.getElementById('send-cc')?.value||'').trim();
    const bccRaw  = (document.getElementById('send-bcc')?.value||'').trim();
    const subject = (document.getElementById('send-subject')?.value||'').trim();
    const bodyTxt = (document.getElementById('send-body')?.value||'').trim();

    if (!toRaw)    { showToast('Fyll i e-postadress'); return; }
    if (typeof OfferCalc !== 'undefined' && OfferCalc.validate) {
      const v = OfferCalc.validate(off);
      if (!v.ok) { showToast('Offerten kan inte skickas: ' + v.issues[0].message, 7000); return; }
    }
    if (!subject)  { showToast('Ämnesrad saknas');     return; }
    if (!bodyTxt)  { showToast('Meddelandetext saknas'); return; }

    const parseEmails = s => s.split(/[\s,;]+/).map(e=>e.trim()).filter(Boolean);
    const recipients  = parseEmails(toRaw);
    const cc          = parseEmails(ccRaw);
    const bcc         = parseEmails(bccRaw);

    if (!recipients.length) { showToast('Ingen giltig e-postadress'); return; }

    /* V48B1 R2: pre-flight formatvalidering — samma grundprincip som
       Edge Function. Endast syntax, ingen DNS/mailbox-verifiering. Edge
       Function förblir auktoritativ. */
    if ([...recipients, ...cc, ...bcc].some(e => !this._EMAIL_RE.test(e))) {
      this._showInlineError('send-error', 'Kontrollera e-postadressen. En eller flera adresser är inte giltiga.');
      return;
    }

    const attachmentIds = [...document.querySelectorAll('.send-att-cb:checked')].map(cb => cb.value);

    // Konvertera plaintext body till enkel HTML
    const bodyHtml = '<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1e293b;">' +
      bodyTxt.replace(/\n/g,'<br>') + '</div>';

    // Knapp deaktivera för att undvika dubbelklick
    const sendBtn = document.querySelector('.modal-footer .btn.bp');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Skickar…'; }

    // R2.1 (Blocker 1): en helt ny offert har publicToken='' — utan detta
    // steg skulle "Skicka offert" på ett färskt utkast alltid misslyckas
    // med token_missing server-side. Att generera länken är INTE ett bevis
    // på att mejlet skickats (se _generateDigitalLinkMutation) — endast en
    // förutsättning för att länken i mejlet ska fungera. persist() awaitas
    // HÄR så Edge Function garanterat läser den nygenererade token/
    // snapshoten och inte en kapplöpning mot en ännu osynkad store-rad.
    //
    // R2.2 (Blocker 3): persist()s returvärde (samma bekräftade boolean-API
    // som redan används på andra håll i offert-koden, t.ex. rad 4298) MÅSTE
    // kontrolleras — en ny/förnyad token är en obligatorisk förutsättning
    // för att Edge Function ska kunna läsa den. Om skrivningen misslyckas
    // får vi ALDRIG anropa send-offer-email med en token servern inte kan
    // se: det skulle antingen 409:a med token_missing (om det var en helt
    // ny token) eller, värre, tyst skicka med en STALE token servern redan
    // känner till (om detta var en förnyelse av en utgången länk) — i
    // båda fallen ett förvirrande fel som döljer den verkliga orsaken
    // (misslyckad spara-operation). Regenererar INTE en till token i
    // samma försök — användaren får ett tydligt fel och kan trycka Skicka
    // igen (vilket gör ett nytt, eget ensure+persist-försök).
    if (this._ensureActiveDigitalLink(off)) {
      /* C1 (2026-11-12): scoped to the key this code path mutated — an unrelated key's rejection (activityLog) is not this save's failure. */
      const persisted = await persist({ keys: ['offers'] });
      if (!persisted) {
        this._showInlineError('send-error', 'Kunde inte spara den nygenererade offertlänken. Kontrollera anslutningen och försök igen.');
        if (sendBtn) { sendBtn.disabled = false; sendBtn.innerHTML = ic('send',13) + ' Skicka'; }
        return;
      }
    }

    let messageId  = '';
    let sendOk     = false;
    let sendErr    = '';
    let serverJson = {};
    let patchesApplied = false;

    // Skicka via Edge Function — offerToken och sentBy accepteras inte
    // längre från klienten alls: servern slår upp offertens token och
    // härleder avsändaren från den autentiserade JWT-identiteten (R2).
    try {
      const jwt = typeof Auth !== 'undefined' ? Auth.getAccessToken() : null;
      if (!jwt) throw new Error('Inte inloggad');

      const base  = (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '').replace(/\/$/, '');
      const efUrl = base + '/functions/v1/send-offer-email';
      const res   = await fetch(efUrl, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey': (typeof SUPABASE_AKEY !== 'undefined' ? SUPABASE_AKEY : ''),
          'Authorization': 'Bearer ' + jwt,
        },
        body: JSON.stringify({
          offerId:      off.id,
          commType:     'offer_sent',
          recipients,
          cc,
          bcc,
          subject,
          bodyHtml,
          attachmentIds,
        })
      });

      serverJson = await res.json().catch(() => ({}));

      // Applicera serverpatchar på state INNAN vi kontrollerar res.ok —
      // token, snapshot och bilagelås är redan sparade server-side
      patchesApplied = this._applyServerPatches(off, serverJson);

      if (res.ok) {
        sendOk    = true;
        messageId = serverJson.messageId || '';
      } else {
        sendErr = serverJson.detail || serverJson.error || ('HTTP ' + res.status);
      }
    } catch (e) {
      sendErr = String(e);
    }

    // Vid fel: bevara serverändringar med persist() och stanna kvar i dialogen
    if (!sendOk) {
      console.error('[send-offer-email] Fel:', sendErr);
      this._showInlineError('send-error', this._friendlySendError(serverJson));
      if (sendBtn) { sendBtn.disabled = false; sendBtn.innerHTML = ic('send',13) + ' Skicka'; }
      if (patchesApplied) persist();
      return;
    }

    // Endast vid lyckat utskick: uppdatera CRM-statusfält
    off.status      = 'skickad';
    off.sentAt      = off.sentAt || serverJson.sentAt || new Date().toISOString();
    off.emailSentTo = recipients[0];
    off.updatedAt   = new Date().toISOString();

    // LOGGA INTE email_sent internt — serverns emailEvent täcker det i den externa tidslinjen

    // Uppföljning — detta är en separat intern händelse, inte email_sent
    if (document.getElementById('send-followup')?.checked) {
      if (typeof ActivitiesService !== 'undefined') {
        ActivitiesService.create({
          title:       'Följ upp offert ' + off.id + (off.title?' – '+off.title:''),
          type:        'followup',
          relatedType: 'offer',
          relatedId:   off.id,
          customerId:  off.customerId || null,
          assignedTo:  state.currentUser?.id || null,
          dueDate:     _ds(3),
          dueTime:     '09:00',
          note:        'Offert skickad till ' + recipients.join(', ') + ' — följ upp om 3 dagar',
          priority:    'normal',
        });
        this._logEvt(off, 'followup', 'Uppföljning bokad om 3 dagar (automatisk)');
        if (typeof Sidebar !== 'undefined') Sidebar.updateBadges();
      }
    }

    persist();
    Modal.close();
    this.render({ offerId: off.id });
    // R2.1 (Blocker 4): mejlet skickades verkligen (Resend accepterade det)
    // — off.status='skickad' ovan är korrekt oavsett. Om servern signalerar
    // att historikposten trots interna omförsök inte kunde sparas ska
    // användaren ändå INTE se detta som ett vanligt "skicka igen"-fel
    // (det skulle kunna orsaka ett dubblettmejl) — bara en tydlig varning.
    if (serverJson.warning === 'history_not_persisted') {
      showToast('Offert skickad till ' + recipients.join(', ') + ' — men händelsen kunde inte sparas i historiken. Kontakta support om detta upprepas.', 'warning');
    } else {
      showToast('Offert skickad till ' + recipients.join(', '));
    }
  },

  _applySendTemplate(offerId, tmplId) {
    const off  = getOff(offerId);
    const cu   = getCu(off?.customerId);
    const tmpl = (state.emailTemplates||[]).find(t=>t.id===tmplId);
    if (!tmpl || !off) return;
    const firstName = cu ? (cu.firstName||cu.name||'') : '';
    const sentDate  = off.sentAt ? new Date(off.sentAt).toLocaleDateString('sv-SE',{day:'numeric',month:'short',year:'numeric'}) : '—';
    const data = {
      offerId: off.id, titleSuffix: off.title?' – '+off.title:'', firstName: firstName||'kund',
      validUntil: off.validUntil||'—', paymentLine: off.paymentTerms?'Betalningsvillkor: '+off.paymentTerms+'.':'',
      sentDate, OFFER_LINK: '{{OFFER_LINK}}'
    };
    const interp = s => (s||'').replace(/\{\{(\w+)\}\}/g, (_,k) => data[k]!==undefined?data[k]:'');
    const subj = document.getElementById('send-subject');
    const body = document.getElementById('send-body');
    if (subj) subj.value = interp(tmpl.subject);
    if (body) body.value = interp(tmpl.body);
  },

  showReminderModal(offerId) {
    const off = getOff(offerId);
    if (!off) return;
    const cu = getCu(off.customerId);
    const cuEmail = cu ? (cu.email||'') : '';
    const firstName = cu ? (cu.firstName||cu.name||'') : '';
    const tmpl = (state.emailTemplates||[]).find(t=>t.type==='reminder');
    const sentDate = off.sentAt ? new Date(off.sentAt).toLocaleDateString('sv-SE',{day:'numeric',month:'short',year:'numeric'}) : '—';
    const data = {
      offerId: off.id, titleSuffix: off.title?' – '+off.title:'', firstName: firstName||'kund',
      validUntil: off.validUntil||'—', sentDate, paymentLine:'', viftPhone:''
    };
    const interp = s => (s||'').replace(/\{\{(\w+)\}\}/g, (_,k) => data[k]!==undefined?data[k]:'');
    const subject = interp(tmpl?.subject || ('Påminnelse: Offert ' + off.id + (off.title?' – '+off.title:'')));
    const body2   = interp(tmpl?.body || ('Hej,\n\nPåminnelse om offert ' + off.id + '.\n\nMed vänliga hälsningar,\nVIFT Fastighetsservice'));

    Modal.open({
      title: ic('bell',14) + ' Skicka påminnelse',
      wide: true,
      body: `
        <div class="fg"><label>Till (e-post)</label>
          <input id="remind-to" value="${esc(cuEmail)}" placeholder="kund@exempel.se" type="email"></div>
        <div class="fg"><label>Ämne</label><input id="remind-subject" value="${esc(subject)}"></div>
        <div class="fg"><label>Meddelande</label>
          <textarea id="remind-body" rows="7">${esc(body2)}</textarea></div>
        <div style="background:var(--bg);border-radius:var(--rs);padding:8px 12px;font-size:11px;color:var(--mt);">
          ${ic('info',10)} Skickar via Resend. Status ändras till "Påmind".
        </div>
        <div id="remind-error" class="off-send-error" hidden></div>`,
      buttons: [
        { label: ic('bell',13) + ' Skicka påminnelse', cls: 'btn bp', onClick: () => this._doSendReminder(off) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('remind-to')?.focus(), 80);
  },

  async _doSendReminder(off) {
    this._clearInlineError('remind-error');

    const toRaw   = (document.getElementById('remind-to')?.value||'').trim();
    const subject = (document.getElementById('remind-subject')?.value||'').trim();
    const bodyTxt = (document.getElementById('remind-body')?.value||'').trim();
    if (!toRaw) { showToast('Fyll i e-postadress'); return; }

    const parseEmails = s => s.split(/[\s,;]+/).map(e=>e.trim()).filter(Boolean);
    const recipients  = parseEmails(toRaw);
    if (!recipients.length) { showToast('Ingen giltig e-postadress'); return; }

    /* V48B1 R2: pre-flight formatvalidering — samma grundprincip som
       Edge Function. Endast syntax, ingen DNS/mailbox-verifiering. Edge
       Function förblir auktoritativ. */
    if (recipients.some(e => !this._EMAIL_RE.test(e))) {
      this._showInlineError('remind-error', 'Kontrollera e-postadressen. En eller flera adresser är inte giltiga.');
      return;
    }

    const bodyHtml = '<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1e293b;">' +
      bodyTxt.replace(/\n/g,'<br>') + '</div>';

    // R2.1 (Blocker 1): en påminnelse får ALDRIG tyst återuppliva en
    // återkallad länk — det vore att skicka kunden en länk som ägaren
    // uttryckligen ogiltigförklarat. Fail closed, ingen serverbegäran görs.
    if (off.tokenRevokedAt) {
      this._showInlineError('remind-error', 'Länken är återkallad. Skapa en ny digital länk (eller skicka offerten på nytt) innan en påminnelse kan skickas.');
      return;
    }
    // R2.1 (Blocker 1): en saknad ELLER förfallen länk får inte resultera i
    // en påminnelse som pekar på en död URL. Till skillnad från "återkallad"
    // (en avsiktlig affärsbeslut som aldrig återupplivas tyst) är "förfallen"
    // bara tidens gång — här förnyas länken tyst med samma kanoniska
    // mutation som ett vanligt utskick använder, så påminnelsen alltid
    // pekar på en fungerande länk. Dokumenterat val, se rapporten.
    //
    // R2.2 (Blocker 3): precis som i _doSendEmail() måste persist()s
    // bekräftade boolean-retur kontrolleras — se den motsvarande kommentaren
    // där för fullständig motivering. Ingen serverbegäran görs om den
    // förnyade länken inte faktiskt gick att spara.
    if (this._ensureActiveDigitalLink(off)) {
      /* C1 (2026-11-12): scoped to the key this code path mutated — an unrelated key's rejection (activityLog) is not this save's failure. */
      const persisted = await persist({ keys: ['offers'] });
      if (!persisted) {
        this._showInlineError('remind-error', 'Kunde inte spara den förnyade offertlänken. Kontrollera anslutningen och försök igen.');
        return;
      }
    }

    const sendBtn = document.querySelector('.modal-footer .btn.bp');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Skickar…'; }

    let sendOk     = false;
    let sendErr    = '';
    let remindJson = {};
    let patchesApplied = false;
    try {
      const jwt   = typeof Auth !== 'undefined' ? Auth.getAccessToken() : null;
      if (!jwt) throw new Error('Inte inloggad');
      const base  = (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '').replace(/\/$/, '');
      const res   = await fetch(base + '/functions/v1/send-offer-email', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': (typeof SUPABASE_AKEY !== 'undefined' ? SUPABASE_AKEY : ''),
          'Authorization': 'Bearer ' + jwt
        },
        body: JSON.stringify({
          offerId: off.id,
          commType: 'offer_reminder',
          recipients, cc: [], bcc: [], subject, bodyHtml,
          attachmentIds: [],
        })
      });
      remindJson = await res.json().catch(()=>({}));

      // Applicera serverpatchar på state OAVSETT utskicksresultat
      patchesApplied = this._applyServerPatches(off, remindJson);

      sendOk = res.ok;
      if (!sendOk) sendErr = remindJson.detail || remindJson.error || ('HTTP ' + res.status);
    } catch(e) {
      sendErr = String(e);
    }

    // Vid fel: bevara serverändringar med persist() och stanna kvar i dialogen
    if (!sendOk) {
      console.error('[send-offer-email] Påminnelsefel:', sendErr);
      this._showInlineError('remind-error', this._friendlySendError(remindJson));
      if (sendBtn) { sendBtn.disabled = false; sendBtn.innerHTML = ic('bell',13) + ' Skicka påminnelse'; }
      if (patchesApplied) persist();
      return;
    }

    // Endast vid lyckat utskick: uppdatera CRM-statusfält
    off.status         = 'påmind';
    off.reminderSentAt = new Date().toISOString();
    off.updatedAt      = new Date().toISOString();

    // LOGGA INTE ett eget "sänt"-inlägg internt — serverns emailEvent
    // (commType: 'offer_reminder') täcker det redan i den externa
    // tidslinjen (state.offerEvents), precis som vid ett vanligt utskick.
    // En egen intern post här skulle vara en duplicerad, ej server-
    // verifierad "skickad"-post.

    persist();
    Modal.close();
    this.render({ offerId: off.id });
    // R2.1 (Blocker 4): se motsvarande kommentar i _doSendEmail() — samma
    // degraderade-men-verkligen-skickat-läge kan uppstå för en påminnelse.
    if (remindJson.warning === 'history_not_persisted') {
      showToast('Påminnelse skickad — men händelsen kunde inte sparas i historiken. Kontakta support om detta upprepas.', 'warning');
    } else {
      showToast('Påminnelse skickad');
    }
  },

  createNewVersion(offerId) {
    const off = getOff(offerId);
    if (!off) return;
    /* V48B3B0 (säkerhetshotfix, fail-closed guard): en redan ersatt offert
       får inte versioneras igen — den har redan en efterträdare (annars
       skulle stale/dubbla versionskedjor kunna skapas). Full concurrency-/
       revisionspolicy för alla statusar kommer i B3B1; detta är endast en
       snäv spärr mot den uppenbara stale-operationen. */
    if (off.status === 'ersatt') {
      showToast('Denna offert är redan ersatt av en nyare version — kan inte versioneras igen.');
      return;
    }
    const newVer = (off.versionNumber || 1) + 1;
    Modal.open({
      title: ic('git-branch',14) + ' Skapa ny version',
      body: `<p style="font-size:13px;margin-bottom:12px;">Skapa version <strong>${newVer}</strong> av ${off.id}?</p>
        <p style="font-size:12px;color:var(--mt);">Gamla versionen markeras som <em>Ersatt</em>. Den nya versionen kopierar alla rader, kund, text och villkor och sätts till <em>Utkast</em>.</p>`,
      buttons: [
        { label: ic('git-branch',12) + ' Skapa version ' + newVer, cls: 'btn bp', onClick: () => {
          const now = new Date().toISOString();
          off.status    = 'ersatt';
          off.updatedAt = now;
          /* V48B3B0 (säkerhetshotfix, defense-in-depth): den GAMLA versionens
             publika kundlänk får inte förbli aktiv efter att den ersatts —
             annars kan kunden fortsatt öppna/svara på en inaktuell offert
             (stängs även server-sidigt i offer-token-validate/offer-respond,
             se DEL 6/7). Endast tokenRevokedAt sätts — publicToken/
             tokenCreatedAt/tokenExpiresAt/lockedSnapshotJSON på DEN GAMLA
             posten rörs INTE, för att bevara intern historik. */
          if (off.publicToken && !off.tokenRevokedAt) {
            off.tokenRevokedAt = now;
          }
          this._logEvt(off, 'status', 'Version ' + (off.versionNumber||1) + ' ersatt av ny version');
          // Create new version
          const newOff = JSON.parse(JSON.stringify(off));
          newOff.id             = newId(state.offers, 'OFF');
          newOff.status         = 'utkast';
          newOff.versionNumber  = newVer;
          newOff.parentOfferId  = offerId;
          newOff.sentAt         = '';
          newOff.answeredAt     = '';
          newOff.reminderSentAt = '';
          newOff.emailSentTo    = '';
          newOff.workOrderId    = '';
          newOff.createdAt      = now;
          newOff.updatedAt      = now;
          newOff.timeline       = [];
          newOff.customerApproval = { token:'', approvedAt:null, approvedByName:'', approvedByEmail:'', ip:'', comment:'' };
          /* R4 §1: manuellt godkännande får ALDRIG följa med till en ny
             version — den nya versionen har inte blivit godkänd ännu. */
          newOff.manualApproval = null;
          /* R5: digital offertlänk/publik snapshot tillhör den GAMLA
             versionens session och får ALDRIG delas med den nya versionen
             — annars skulle den nya versionen kunna visa/ärva originalets
             publika länk/lockedSnapshotJSON innan en egen länk faktiskt
             genererats. Originalversionens värden (kvar på `off`) rörs inte. */
          newOff.publicToken        = '';
          newOff.tokenCreatedAt     = '';
          newOff.tokenExpiresAt     = '';
          newOff.tokenRevokedAt     = '';
          newOff.openCount          = 0;
          newOff.openedAt           = '';
          newOff.lockedSnapshotJSON = '';
          /* R5: entydiga lifecycle-/responsfält som hör till den ersatta
             versionens historik, inte den nya versionen. */
          newOff.declineReason = '';
          newOff.convertedAt   = '';
          this._logEvt(newOff, 'create', 'Version ' + newVer + ' skapad från ' + offerId + ' v' + (off.versionNumber||1));
          state.offers.push(newOff);
          Modal.close();
          confirmPersist('offers', newOff.id, { ok: 'Version ' + newVer + ' skapad: ' + newOff.id, fail: 'Den nya versionen kunde inte sparas',
            onSaved: () => Router.showPage('pg-offer-detail', {offerId: newOff.id}), onChange: () => { try { Router.refreshCurrent(); } catch (e) {} } });
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  /* ── Digital offertlänk — panel ────────────────────────── */
  _digitalLinkPanel(off) {
    if (off.archived || off.deleted) return '';
    /* QA 2026-11-26: alltid synligt kort i sidokolumnen (tidigare hopfällt).
       Samma funktioner: generateDigitalLink / revokeDigitalLink /
       extendDigitalLink / _copyLink. Länkens utgång heter "Länken gäller
       till" så den inte förväxlas med offertens giltighet. */
    const id = _offSafeId(off.id);
    const hasToken = !!off.publicToken;
    const revoked  = !!off.tokenRevokedAt;
    const expired  = off.tokenExpiresAt && new Date(off.tokenExpiresAt).getTime() < Date.now();

    if (!hasToken) {
      return `<section class="card offd-card offd-link">
        <div class="card-header"><h3>${ic('link',15)} Digital offertlänk</h3><span class="offd-pill">Ingen länk</span></div>
        <div class="card-body">
          <p class="offd-muted">Kunden kan läsa, godkänna, begära ändring eller neka offerten via en säker länk — utan inloggning.</p>
          <button type="button" class="btn bs bsm" onclick="OfferDetailPage.generateDigitalLink('${id}')">${ic('link',14)} Generera digital länk</button>
        </div>
      </section>`;
    }

    const host    = window.location.origin;
    const linkUrl = `${host}/public-offer.html?t=${off.publicToken}`;
    const expiryLabel = off.tokenExpiresAt ? 'Länken gäller till ' + fmtDate(off.tokenExpiresAt.slice(0,10)) : 'Inget slutdatum för länken';
    const pill = revoked ? `<span class="offd-pill is-danger">Återkallad</span>`
               : expired ? `<span class="offd-pill is-warn">Utgången</span>`
               : `<span class="offd-pill is-ok">Aktiv</span>`;
    const openInfo = off.openedAt
      ? `Öppnad ${off.openCount || 1} ${(off.openCount||1)===1?'gång':'gånger'}, första ${fmtDate(off.openedAt.slice(0,10))}`
      : 'Inte öppnad ännu';

    return `<section class="card offd-card offd-link">
      <div class="card-header"><h3>${ic('link',15)} Digital offertlänk</h3>${pill}</div>
      <div class="card-body">
        <div class="offd-link-row">
          <input id="off-pub-link" readonly value="${esc(linkUrl)}" aria-label="Offertlänk" onfocus="this.select()">
          <button type="button" class="btn bs bsm" onclick="OfferDetailPage._copyLink(document.getElementById('off-pub-link').value)">${ic('copy',14)} Kopiera</button>
        </div>
        <div class="offd-link-info"><span>${ic('calendar',13)} ${esc(expiryLabel)}</span><span>${ic('eye',13)} ${esc(openInfo)}</span></div>
        ${revoked ? `<div class="offd-hint is-danger">${ic('alert-circle',13)}<span>Länken är återkallad — kunden kan inte längre öppna den.</span></div>` : ''}
        <div class="offd-link-acts">
          ${!revoked ? `<button type="button" class="btn bs bsm" onclick="OfferDetailPage.revokeDigitalLink('${id}')">${ic('x-circle',14)} Återkalla länk</button>` : ''}
          <button type="button" class="btn bs bsm" onclick="OfferDetailPage.extendDigitalLink('${id}')">${ic('clock',14)} Förläng giltighetstid</button>
          <button type="button" class="btn bghost bsm" onclick="OfferDetailPage.generateDigitalLink('${id}')">${ic('refresh-cw',14)} Ny länk (ogiltigförklarar gammal)</button>
        </div>
      </div>
    </section>`;
  },

  _copyLink(url) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => showToast('Länk kopierad!')).catch(() => {
        const el = document.getElementById('off-pub-link');
        if (el) { el.select(); document.execCommand('copy'); showToast('Länk kopierad!'); }
      });
    } else {
      const el = document.getElementById('off-pub-link');
      if (el) { el.select(); document.execCommand('copy'); showToast('Länk kopierad!'); }
    }
  },

  /* ── Bilagor — panel ─────────────────────────────────────── */
  _attachmentsPanel(off) {
    if (off.archived || off.deleted) return '';
    const atts = (state.offerAttachments || []).filter(a => a.offerId === off.id && a.active !== false);
    const locked = !!off.publicToken && !off.tokenRevokedAt;

    const _attIcon = (mime) => {
      const m = (mime||'').toLowerCase();
      if (m.includes('pdf'))                                              return ic('file-text',15);
      if (m.includes('image'))                                            return ic('image',15);
      if (m.includes('spreadsheet')||m.includes('excel')||m.includes('csv')) return ic('table',15);
      if (m.includes('word')||m.includes('document'))                    return ic('file-text',15);
      if (m.includes('zip')||m.includes('compressed'))                   return ic('archive',15);
      return ic('paperclip',15);
    };
    const attRows = atts.length === 0
      ? `<p style="font-size:12px;color:var(--mt);margin:0;text-align:center;padding:12px 0;">Inga bilagor uppladdade</p>`
      : atts.sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0)).map(a => {
          const displayName = a.displayName || a.originalFileName || 'bilaga';
          const ext    = (a.originalFileName||'').split('.').pop().toUpperCase();
          const sizeLbl = a.sizeBytes > 1048576 ? (a.sizeBytes/1048576).toFixed(1)+' MB' : Math.round(a.sizeBytes/1024)+' KB';
          const metaParts = [ext, sizeLbl];
          if (a.lockedInVersion)    metaParts.push('låst');
          if (a.includeInPublicView)  metaParts.push('kundvy');
          if (a.includeInCombinedPdf) metaParts.push('PDF');
          return `<div class="att-row">
            <div class="att-row-icon">${_attIcon(a.mimeType)}</div>
            <div style="flex:1;min-width:0;">
              <div class="att-row-name" title="${esc(displayName)}">${esc(displayName)}</div>
              <div class="att-row-meta">${esc(metaParts.join(' · '))}</div>
            </div>
            <div class="att-row-actions">
              <button type="button" class="btn bs bsm" title="Visa" onclick="OfferDetailPage._viewAttachment('${esc(a.id)}')">${ic('eye',12)} Visa</button>
              <button type="button" class="btn bs bsm" title="Ladda ned" onclick="OfferDetailPage._downloadAttachment('${esc(a.id)}')">${ic('download',12)} Ladda ned</button>
              <button type="button" class="btn bs bsm" title="Redigera" onclick="OfferDetailPage._editAttachment('${esc(a.id)}','${esc(off.id)}')">${ic('edit-2',12)}</button>
              <button type="button" class="btn bs bsm" title="Ta bort" style="color:var(--rd);" onclick="OfferDetailPage._deleteAttachment('${esc(a.id)}','${esc(off.id)}')">${ic('trash-2',12)}</button>
            </div>
          </div>`;
        }).join('');

    const lockedNotice = locked ? `<div style="font-size:11px;color:var(--or);display:flex;align-items:center;gap:4px;margin-bottom:8px;">${ic('lock',11)} Bilagor som laddades upp innan digital länk genererades är versionslåsta.</div>` : '';

    /* QA 2026-11-26: hopfällbart kort (rubriken är knappen); öppet som
       standard när bilagor finns — samma regel som tidigare sektion.
       Uppladdning/Samlad PDF/Visa/Ladda ned/Redigera/Ta bort oförändrade. */
    const oid = _offSafeId(off.id);
    const head = this._cardHead(off, 'attachments', atts.length > 0, 'paperclip', 'Bilagor', atts.length,
      (atts.length > 0 ? `<button type="button" class="btn bs bsm" onclick="OfferDetailPage._generateCombinedPdf('${oid}')">${ic('file-text',14)} Samlad PDF</button>` : '') +
      `<button type="button" class="btn bs bsm" onclick="OfferDetailPage._openUploadDialog('${oid}','${oid}')">${ic('upload',14)} Ladda upp</button>`);
    if (!head.open) return `<section class="card offd-card offd-att">${head.html}</section>`;
    return `<section class="card offd-card offd-att">
      ${head.html}
      <div class="card-body">
        ${lockedNotice}
        <div class="att-dropzone" id="att-drop-${oid}" role="button" tabindex="0"
          ondragover="event.preventDefault();this.classList.add('att-dropzone-over')"
          ondragleave="this.classList.remove('att-dropzone-over')"
          ondrop="event.preventDefault();this.classList.remove('att-dropzone-over');OfferDetailPage._handleFileDrop(event,'${oid}','${oid}')"
          onclick="OfferDetailPage._openUploadDialog('${oid}','${oid}')"
          onkeydown="if(event.key==='Enter')this.click()"
        >
          ${ic('upload-cloud',18)} <span>Dra hit filer eller klicka för att välja</span>
        </div>
        <input type="file" id="att-file-${oid}" multiple accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.svg,.tiff,.docx,.xlsx,.pptx,.doc,.xls,.txt,.csv,.zip,.dwg" style="display:none;"
          onchange="OfferDetailPage._handleFileSelect(event,'${oid}','${oid}')">
        <div id="att-upload-progress-${oid}" style="margin-top:6px;font-size:11px;color:var(--mt);"></div>
        <div class="offd-att-list">
          ${attRows}
        </div>
      </div>
    </section>`;
  },

  _handleFileDrop(ev, offerId, versionId) {
    const files = Array.from(ev.dataTransfer.files || []);
    if (files.length) this._uploadFiles(files, offerId, versionId);
  },

  _handleFileSelect(ev, offerId, versionId) {
    const files = Array.from(ev.target.files || []);
    if (files.length) this._uploadFiles(files, offerId, versionId);
    ev.target.value = '';
  },

  _openUploadDialog(offerId, versionId) {
    const inp = document.getElementById('att-file-' + offerId);
    if (inp) inp.click();
  },

  async _uploadFiles(files, offerId, versionId) {
    const EDGE_BASE = (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '').replace(/\/$/, '');
    const progressEl = document.getElementById('att-upload-progress-' + offerId);
    if (progressEl) progressEl.textContent = 'Laddar upp ' + files.length + ' fil(er)…';

    let uploaded = 0, errors = 0;
    for (const file of files) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('offerId', offerId);
      fd.append('offerVersionId', versionId || offerId);
      fd.append('uploadedBy', (state.currentUser && state.currentUser.id) || '');
      try {
        const res = await fetch(EDGE_BASE + '/functions/v1/offer-attachment-upload', {
          method: 'POST',
          headers: {
            'apikey': (typeof SUPABASE_AKEY !== 'undefined' ? SUPABASE_AKEY : ''),
            'Authorization': 'Bearer ' + (Auth.getAccessToken() || '')
          },
          body: fd
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || res.status);
        /* P0-3 FIX (independent-reviewer regression): `json.attachment`
           is already the SERVER-CANONICAL object — the EF's RPC
           (offer_attachment_append, row-locked) already committed it
           atomically. Apply it locally by id only; do NOT call the
           generic persist() — that used to re-send the WHOLE
           state.offerAttachments array, a live unsafe write path for
           the exact same key the RPC protects server-side (see
           state.js's `_doPersist()` comment — `offerAttachments` is no
           longer in that list at all). Cache via Storage.setLocal()
           instead, same pattern as every other *SyncService in this
           engagement. */
        const att = Object.assign(Schema.offerAttachment(), json.attachment || {});
        if (!state.offerAttachments) state.offerAttachments = [];
        state.offerAttachments.push(att);
        uploaded++;
      } catch(e) {
        errors++;
        console.error('[uploadFiles]', file.name, e);
      }
    }
    if (typeof Storage !== 'undefined' && typeof Storage.setLocal === 'function') {
      Storage.setLocal('offerAttachments', state.offerAttachments);
    }
    if (progressEl) progressEl.textContent = uploaded + ' fil(er) uppladdade' + (errors ? ', ' + errors + ' fel' : '') + '.';
    setTimeout(() => { if (progressEl) progressEl.textContent = ''; }, 4000);
    this.render({offerId});
  },

  async _viewAttachment(attachmentId) {
    const EDGE_BASE = (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '').replace(/\/$/, '');
    const att = (state.offerAttachments || []).find(a => a.id === attachmentId);
    if (!att) return;

    /* Öppna same-origin laddningssida synkront — undviker about:blank i adressfältet
       och popup-blockering (fönster öppnat i direkt user-event, inte efter await). */
    const loadingUrl = window.location.origin + '/public-offer.html#attachment-loading';
    const previewWindow = window.open(loadingUrl, '_blank');

    if (!previewWindow) {
      showToast('Webbläsaren blockerade visningsfönstret', 'error');
      return;
    }

    try {
      showToast('Öppnar bilaga…');

      const res = await fetch(EDGE_BASE + '/functions/v1/offer-attachment-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': (typeof SUPABASE_AKEY !== 'undefined' ? SUPABASE_AKEY : ''),
          'Authorization': 'Bearer ' + (Auth.getAccessToken() || '')
        },
        body: JSON.stringify({
          attachmentId,
          offerId: att.offerId,
          mode: 'view'
        })
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || res.status);
      }

      if (!json.url || typeof json.url !== 'string') {
        throw new Error('Servern returnerade ingen visningslänk');
      }

      const targetUrl = new URL(json.url, EDGE_BASE).href;
      previewWindow.location.replace(targetUrl);
    } catch (e) {
      previewWindow.location.replace(
        window.location.origin + '/public-offer.html#attachment-error:' + encodeURIComponent(e.message || 'Okänt fel')
      );
      showToast('Fel vid visning: ' + e.message, 'error');
    }
  },

  async _downloadAttachment(attachmentId) {
    const EDGE_BASE = (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '').replace(/\/$/, '');
    const att = (state.offerAttachments || []).find(a => a.id === attachmentId);
    if (!att) return;
    try {
      showToast('Hämtar nedladdningslänk…');
      const res = await fetch(EDGE_BASE + '/functions/v1/offer-attachment-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': (typeof SUPABASE_AKEY !== 'undefined' ? SUPABASE_AKEY : ''),
          'Authorization': 'Bearer ' + (Auth.getAccessToken() || '')
        },
        body: JSON.stringify({
          attachmentId,
          offerId: att.offerId,
          mode: 'download'
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.status);
      const a = document.createElement('a');
      a.href = json.url;
      a.download = json.fileName || att.originalFileName || 'bilaga';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch(e) {
      showToast('Fel vid nedladdning: ' + e.message, 'error');
    }
  },

  _editAttachment(attachmentId, offerId) {
    const att = (state.offerAttachments || []).find(a => a.id === attachmentId);
    if (!att) return;
    Modal.open({
      title: 'Redigera bilaga',
      body: `<div style="display:flex;flex-direction:column;gap:12px;">
        <div>
          <label style="font-size:12px;font-weight:500;">Visningsnamn</label>
          <input id="att-edit-name" class="form-control" style="margin-top:4px;" value="${esc(att.displayName||att.originalFileName)}">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500;">Beskrivning</label>
          <textarea id="att-edit-desc" class="form-control" rows="2" style="margin-top:4px;">${esc(att.description||'')}</textarea>
        </div>
        <div style="display:flex;gap:12px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;">
            <input type="checkbox" id="att-edit-pub" ${att.includeInPublicView!==false?'checked':''}>
            Synlig i kundvy
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;">
            <input type="checkbox" id="att-edit-pdf" ${att.includeInCombinedPdf?'checked':''}>
            Inkludera i samlad PDF
          </label>
        </div>
      </div>`,
      okLabel: 'Spara',
      ok: () => {
        const patch = {
          attachmentId: att.id, offerId: offerId,
          displayName:          document.getElementById('att-edit-name').value.trim() || att.originalFileName,
          description:          document.getElementById('att-edit-desc').value.trim(),
          includeInPublicView:  document.getElementById('att-edit-pub').checked,
          includeInCombinedPdf: document.getElementById('att-edit-pdf').checked
        };
        this._patchAttachment(att, patch, offerId);
      }
    });
  },

  /* G12 (2026-11-23): bilagans metadata sparas via offer-attachment-upload
     (PATCH). Tidigare ändrades bara den lokala kopian — nyckeln är skriv-
     skyddad för den generiska sparvägen — så "Bilaga uppdaterad" visades
     medan servern (och kundvyn) var oförändrade. Lokalt läge uppdateras
     först när servern bekräftat; utan PATCH-stöd (äldre driftsatt EF)
     visas ett tydligt fel och ingenting ändras. */
  async _patchAttachment(att, patch, offerId) {
    const EDGE_BASE = (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '').replace(/\/$/, '');
    showToast('Sparar…');
    let res = null, j = {};
    try {
      res = await fetch(EDGE_BASE + '/functions/v1/offer-attachment-upload', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': (typeof SUPABASE_AKEY !== 'undefined' ? SUPABASE_AKEY : ''), 'Authorization': 'Bearer ' + (Auth.getAccessToken() || '') },
        body: JSON.stringify(patch)
      });
      j = await res.json().catch(() => ({}));
    } catch (e) {
      showToast('Bilagan kunde inte sparas (nätverksfel) — ingenting har ändrats. Försök igen.', 6000);
      return { ok: false };
    }
    if (!res.ok) {
      const why = res.status === 405 || j.error === 'method_not_allowed'
        ? 'servern stöder ännu inte ändring av bilagor (kräver installation av offer-attachment-upload)'
        : (j.error || ('HTTP ' + res.status));
      showToast('Bilagan kunde inte sparas: ' + why + '. Ingenting har ändrats.', 7000);
      return { ok: false };
    }
    const srv = j.attachment || {};
    ['displayName', 'description', 'includeInPublicView', 'includeInCombinedPdf', 'updatedAt'].forEach(k => {
      if (k in srv) att[k] = srv[k]; else if (k in patch) att[k] = patch[k];
    });
    if (typeof Storage !== 'undefined' && typeof Storage.setLocal === 'function') Storage.setLocal('offerAttachments', state.offerAttachments);
    Modal.close();
    this.render({offerId});
    showToast('Bilaga uppdaterad');
    return { ok: true };
  },

  async _deleteAttachment(attachmentId, offerId) {
    const att = (state.offerAttachments || []).find(a => a.id === attachmentId);
    if (!att) return;
    const confirmed = await Modal.confirm(`Ta bort bilagan "${esc(att.displayName||att.originalFileName)}"?`);
    if (!confirmed) return;

    const EDGE_BASE = (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '').replace(/\/$/, '');
    try {
      const res = await fetch(EDGE_BASE + '/functions/v1/offer-attachment-upload', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'apikey': (typeof SUPABASE_AKEY !== 'undefined' ? SUPABASE_AKEY : ''),
          'Authorization': 'Bearer ' + (Auth.getAccessToken() || '')
        },
        body: JSON.stringify({ attachmentId, offerId })
      });
      if (!res.ok) {
        const j = await res.json().catch(()=>({}));
        throw new Error(j.error || res.status);
      }
    } catch(e) {
      showToast('Fel vid borttagning: ' + e.message, 'error');
      return;
    }
    /* P0-3 FIX: the server (offer_attachment_soft_delete RPC) already
       committed `active:false`/`deletedAt` atomically — mirror it
       locally for immediate UI feedback only, and do NOT call the
       generic persist() (see _uploadFiles()'s comment above for the
       full reasoning; same fix, same key). */
    att.active = false;
    att.deletedAt = new Date().toISOString();
    if (typeof Storage !== 'undefined' && typeof Storage.setLocal === 'function') {
      Storage.setLocal('offerAttachments', state.offerAttachments);
    }
    this.render({offerId});
    showToast('Bilaga borttagen');
  },

  _generateCombinedPdf(offerId) {
    const atts = (state.offerAttachments || []).filter(a =>
      a.offerId === offerId && a.active !== false && a.includeInPublicView !== false
    );
    const embeddable = atts.filter(a => a.includeInCombinedPdf &&
      ['application/pdf','image/jpeg','image/png'].includes(a.mimeType));
    const separate   = atts.filter(a => !a.includeInCombinedPdf ||
      !['application/pdf','image/jpeg','image/png'].includes(a.mimeType));

    const sepHtml = separate.length ? `<div style="margin-top:10px;font-size:11px;color:var(--mt);">
      <strong>Hämtas separat:</strong> ${separate.map(a=>esc(a.displayName||a.originalFileName)).join(', ')}
    </div>` : '';

    /* V48B5 R3 §16: "okLabel"/"ok" är INGA fält Modal.open() faktiskt
       stödjer (den läser bara opts.buttons) — modalen renderade tidigare
       HELT UTAN knapp, så "Generera PDF" gick aldrig att klicka på.
       Fixat till samma buttons-array-form som resten av kodbasen
       använder (se _requestWizardClose()). */
    Modal.open({
      title: 'Samlad PDF',
      body: `<p style="font-size:12px;margin:0 0 10px;">Genererar en PDF med offertinnehållet plus ${embeddable.length} inbäddningsbara bilagor.</p>
        ${sepHtml}
        <p style="font-size:11px;color:var(--mt);margin-top:10px;">DOCX, XLSX och TXT-filer kan inte bäddas in utan konvertering och listas på en sista sida.</p>`,
      buttons: [
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() },
        { label: 'Generera PDF', cls: 'btn bp', onClick: () => {
          Modal.close();
          /* V48B5 R3 §17: öppnar en tom flik SYNKRONT, direkt i den
             riktiga klick-händelsen — innan någon async-väntan — så att
             Safari/mobilens popup-blockerare räknar den som en direkt
             användarinitierad åtgärd. */
          const pdfWindow = window.open('', '_blank');
          OfferDetailPage._requestCombinedPdf(offerId, pdfWindow);
        }}
      ]
    });
  },

  /* V48B5 R3 §15-19: den interna "Samlad PDF"-åtgärden ska öppna PDF:en
     direkt för visning istället för en blind nedladdning. `pdfWindow` är
     redan öppnad SYNKRONT av anroparens klick-händelse (se
     _generateCombinedPdf) — här navigerar vi bara den fönsterreferensen
     till blob-URL:en när PDF:en är klar. Om `pdfWindow` är null (t.ex.
     popup ändå blockerad, eller anropad utan ett fönster) faller vi
     tillbaka till den tidigare nedladdningsvägen så funktionen aldrig
     tyst misslyckas. */
  async _requestCombinedPdf(offerId, pdfWindow) {
    const EDGE_BASE = (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '').replace(/\/$/, '');
    try {
      showToast('Genererar PDF…');
      const res = await fetch(EDGE_BASE + '/functions/v1/offer-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': (typeof SUPABASE_AKEY !== 'undefined' ? SUPABASE_AKEY : ''),
          'Authorization': 'Bearer ' + (Auth.getAccessToken() || '')
        },
        body: JSON.stringify({ offerId })
      });
      if (!res.ok) {
        const j = await res.json().catch(()=>({}));
        throw new Error(j.error || res.status);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (pdfWindow && !pdfWindow.closed) {
        pdfWindow.location = url;
        /* Fördröjd cleanup — den nya fliken måste hinna ladda in
           blob-URL:en innan den återkallas, annars kan sidan visas tom. */
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        /* Popup blockerad (eller inget fönster skickades med) — säker
           nedladdningsfallback, samma beteende som innan denna gate. */
        const a = document.createElement('a');
        a.href = url;
        a.download = 'offert-' + offerId + '.pdf';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        showToast('PDF nedladdad (popup blockerades av webbläsaren).');
      }
    } catch(e) {
      if (pdfWindow && !pdfWindow.closed) pdfWindow.close();
      showToast('PDF-generering misslyckades: ' + e.message, 'error');
    }
  },

  /* ── Digital offertlänk — generera token ───────────────── */
  /* R2.1 (Blocker 1): kanoniska snapshot/token-mutationen extraherad ur den
     tidigare generateDigitalLink()-stängningen, oförändrad i sak — samma
     fält, samma låsning av bilagor, samma _logEvt. ENDA skillnaden mot
     föregångaren: den sätter INTE längre off.status='skickad'/off.sentAt.
     Att generera/förnya en publik länk är INTE ett bevis på att ett mejl
     skickats — den mutationen tillhör uteslutande ett bekräftat
     e-postutskick (_doSendEmail). Återanvänds av BÅDE den explicita
     "Generera länk"-knappen och (nytt) den kanoniska Skicka-flödet, som
     tyst säkerställer en giltig länk innan utskick i stället för att kräva
     att användaren manuellt utför ett dolt försteg. */
  _generateDigitalLinkMutation(off, days) {
    const offerId = off.id;
    const arr    = new Uint8Array(32);
    crypto.getRandomValues(arr);
    const token  = Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join('');
    const now    = new Date().toISOString();
    const expiry = new Date(Date.now() + days * 86400000).toISOString().slice(0,10);

    /* Lås snapshot av publika fält */
    const snapshot = {
      id: off.id, title: off.title, versionNumber: Number(off.versionNumber) || 1,
      lines: (off.lines||[]).map(function(l) {
        /* OFFER CORE R1: 'billingType' tillagt — utan detta skulle den
           publika länkens låsta snapshot tyst tappa fältet som avgör
           om raden är återkommande/rörlig/tillval/engångsbelopp, och
           public-offer.html skulle då rendera EXAKT samma rad som ett
           vanligt engångsbelopp (fel pris-semantik för kunden). */
        const p = {}; ['id','type','description','templateName','qty','unit','unitPrice','discount','total','vatRate','exVat','rutAmount','reductionType','reductionBaseExVat','subLines','text','blockTitle','billingType'].forEach(function(k){ if (k in l) p[k] = l[k]; }); return p;
      }),
      /* V39 §3: vatRate måste bevaras för extras precis som för lines —
         annars tappar snapshotet en tilläggsrads faktiska momssats och
         public-offer/offer-public-pdf tvingas gissa (fallback 25 %)
         istället för att räkna med den verkliga satsen.
         OFFER CORE R1.1 — BLOCKER 1: 'includedInTotal' tillagt — utan
         detta skulle den publika länken tyst tappa vilka extras som
         är committade vs valfria, och public-offer.html/
         offer-public-pdf skulle räkna in ALLA extras i totalsumman
         (fel för en explicit markerad valfri extra). */
      extras: (off.extras||[]).map(function(l) {
        const p = {}; ['id','description','qty','unit','unitPrice','vatRate','includedInTotal'].forEach(function(k){ if (k in l) p[k] = l[k]; }); return p;
      }),
      discount: off.discount, taxType: off.taxType, rotRutAmount: off.rotRutAmount,
      date: off.date || off.createdAt?.slice(0,10) || now.slice(0,10),
      validUntil: off.validUntil, paymentTerms: off.paymentTerms,
      validityText: off.validityText, terms: off.terms, includes: off.includes,
      excludes: off.excludes, scope: off.scope, summary: off.summary,
      /* BLOCKER 3: härlett via propertyId (med off.address som
         bakåtkompatibel fallback) i stället för att läsa off.address
         rakt av — skyddar mot en digital länk som genereras för en
         offert sparad FÖRE denna omgångs _save()-fix (t.ex. om
         länken genereras direkt efter ett API-anrop utan mellanliggande
         spara-klick). */
      generalTerms: off.generalTerms, address: _offPropertyDisplayText(off),
      sectionOrder: _resolveSectionOrder(off.sectionOrder),
      customerName: (() => { const cu = getCu(off.customerId); return cu ? (typeof CustomerService!=='undefined'?CustomerService.displayName(cu):cu.name||'') : ''; })(),
      publicAttachmentIds: (state.offerAttachments||[])
        .filter(function(a){ return a.offerId===offerId && a.active!==false && a.includeInPublicView===true; })
        .map(function(a){ return a.id; })
    };
    off.publicToken        = token;
    off.tokenCreatedAt     = now;
    off.tokenExpiresAt     = expiry + 'T23:59:59.000Z';
    off.tokenRevokedAt     = '';
    off.openCount          = 0;
    off.openedAt           = '';
    off.lockedSnapshotJSON = JSON.stringify(snapshot);
    off.updatedAt          = now;
    /* R2.1 Blocker 1: status/sentAt mutation BORTTAGEN härifrån — att
       generera en länk är inte ett bevis på att ett mejl skickats. Se
       _doSendEmail() för den enda platsen där off.status='skickad' sätts. */
    /* Versionslås aktiva bilagor som ännu inte är låsta */
    (state.offerAttachments || []).forEach(function(a) {
      if (a.offerId === offerId && a.active !== false && !a.lockedInVersion) {
        a.lockedInVersion = offerId + '-' + token.slice(0, 8);
      }
    });
    this._logEvt(off, 'send', 'Digital offertlänk genererad — giltig till ' + expiry + ' (' + days + ' dagar)');
    return { token, expiry };
  },

  /* R2.1 (Blocker 1): "aktiv giltig länk" = finns, inte återkallad, inte
     förfallen. Delas mellan send/reminder-flödet och (implicit) samma
     definition som offer-token-validate/index.ts redan använder server-side
     (tokenRevokedAt / tokenExpiresAt). */
  _hasActiveDigitalLink(off) {
    if (!off.publicToken || off.tokenRevokedAt) return false;
    if (off.tokenExpiresAt && new Date(off.tokenExpiresAt).getTime() < Date.now()) return false;
    return true;
  },

  /* R2.1 (Blocker 1): säkerställer tyst en giltig publik länk innan ett
     utskick, i stället för att kräva att användaren manuellt klickar
     "Generera länk" som ett dolt försteg först. Muterar off in-place men
     persisterar INTE själv — anroparen (_doSendEmail/_doSendReminder)
     awaitar persist() innan den faktiska server-begäran skickas, så att
     Edge Function garanterat läser den nygenererade token/snapshoten. */
  _ensureActiveDigitalLink(off) {
    if (this._hasActiveDigitalLink(off)) return false;
    this._generateDigitalLinkMutation(off, 30);
    return true;
  },

  generateDigitalLink(offerId) {
    const off = getOff(offerId);
    if (!off) return;

    const hasExisting = !!off.publicToken && !off.tokenRevokedAt;
    const confirmMsg  = hasExisting
      ? 'En aktiv länk finns redan. Generera ny länk? Den gamla ogiltigförklaras omedelbart.'
      : 'Generera digital offertlänk?';

    const _doGenerate = (days) => this._commitOfferChange(offerId,
      () => { this._generateDigitalLinkMutation(off, days); return true; },
      { ok: 'Länk genererad — giltig i ' + days + ' dagar',
        fail: 'Länken kunde INTE sparas av servern och fungerar inte för kunden' });

    Modal.open({
      title: ic('link',14) + ' Digital offertlänk',
      body: `<p style="font-size:13px;margin:0 0 12px;">${esc(confirmMsg)}</p>
        <div class="fg"><label>Giltighetstid</label>
          <select id="link-days">
            <option value="14">14 dagar</option>
            <option value="30" selected>30 dagar</option>
            <option value="60">60 dagar</option>
            <option value="90">90 dagar</option>
          </select>
        </div>
        <div style="background:var(--bg);border-radius:var(--rs);padding:8px 12px;font-size:11px;color:var(--mt);margin-top:10px;">
          ${ic('info',10)} Länken kräver ingen inloggning för kunden. Dela den via e-post, SMS eller kundportalen.
        </div>`,
      buttons: [
        { label: ic('link',12) + ' Generera länk', cls: 'btn bp', onClick: () => {
          const days = parseInt(document.getElementById('link-days')?.value || '30', 10);
          Modal.close();
          _doGenerate(days);
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  /* E2E OFF-04 (2026-11-23): länkåtgärderna (generera/återkalla/förläng)
     visade tidigare framgång direkt medan persist() gick i bakgrunden.
     Reproducerat: vid serverfel stod "Länk återkallad" kvar medan kundens
     länk fortfarande fungerade (offer-token-validate läser serverns
     tokenRevokedAt). Nu: mutera, visa "Sparar…", vänta på serverns svar
     för nyckeln offers; framgång först efter bekräftelse. Vid fel avgör
     settlePersistFailure() (N1) om ändringen landade, annars rullas
     offerten tillbaka och ett tydligt fel visas. `_offCommitting`
     spärrar dubbelklick. */
  async _commitOfferChange(offerId, mutate, msgs) {
    if (this._offCommitting) return false;
    const off0 = getOff(offerId);
    if (!off0) return false;
    const before = JSON.parse(JSON.stringify(off0));
    this._offCommitting = true;
    try {
      if (mutate() === false) return false;
      this.render({offerId});
      showToast('Sparar…');
      const ok = await persist({ keys: ['offers'] });
      if (!ok) {
        const n1 = (typeof settlePersistFailure === 'function') ? await settlePersistFailure('offers', offerId) : { fate: 'none' };
        if (n1.fate === 'diverged' || n1.fate === 'conflict') {
          this.render({offerId});
          showToast('Offerten ändrades samtidigt av en annan session — välj i konfliktdialogen.', 6000);
          return false;
        }
        if (n1.fate !== 'landed') {
          const idx = (state.offers || []).findIndex(o => o.id === offerId);
          if (idx >= 0) state.offers[idx] = before;
          try { Storage.setLocal('offers', state.offers); } catch (e) {}
          this.render({offerId});
          showToast(msgs.fail + (n1.fate === 'not-landed' || n1.fate === 'unknown'
            ? ' — ändringen ligger kvar som osparad; välj Återuppta eller Kasta i meddelandet överst.'
            : '. Försök igen.'), 8000);
          return false;
        }
      }
      this.render({offerId});
      showToast(msgs.ok);
      return true;
    } finally {
      this._offCommitting = false;
    }
  },

  revokeDigitalLink(offerId) {
    Modal.confirm('Återkalla offertlänken? Kunden kan inte längre öppna offerten via länken.', () => {
      this._commitOfferChange(offerId, () => {
        const off = getOff(offerId);
        if (!off) return false;
        off.tokenRevokedAt = new Date().toISOString();
        off.updatedAt      = new Date().toISOString();
        this._logEvt(off, 'send', 'Digital offertlänk återkallad');
        return true;
      }, { ok: 'Länk återkallad', fail: 'Länken är INTE återkallad — servern bekräftade inte ändringen och kunden kan fortfarande öppna den' });
    });
  },

  extendDigitalLink(offerId) {
    Modal.open({
      title: ic('clock',14) + ' Förläng giltighetstid',
      body: `<div class="fg"><label>Ny giltighetstid (från idag)</label>
        <select id="extend-days">
          <option value="7">7 dagar</option>
          <option value="14">14 dagar</option>
          <option value="30" selected>30 dagar</option>
          <option value="60">60 dagar</option>
          <option value="90">90 dagar</option>
        </select></div>`,
      buttons: [
        { label: 'Förläng', cls: 'btn bp', onClick: () => {
          const days = parseInt(document.getElementById('extend-days')?.value || '30', 10);
          const expiry = new Date(Date.now() + days * 86400000).toISOString().slice(0,10);
          Modal.close();
          this._commitOfferChange(offerId, () => {
            const off = getOff(offerId);
            if (!off) return false;
            off.tokenExpiresAt = expiry + 'T23:59:59.000Z';
            off.updatedAt      = new Date().toISOString();
            this._logEvt(off, 'send', 'Giltighetstid förlängd — ny utgång: ' + expiry);
            return true;
          }, { ok: 'Giltighetstid förlängd till ' + expiry, fail: 'Giltighetstiden är INTE förlängd — servern bekräftade inte ändringen' });
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  /* R2 (V94): den tidigare mailto-baserade "Skicka påminnelse" (öppnade
     lokal e-postklient, loggade "skickad" oavsett faktiskt utfall) är
     BORTTAGEN. Den enda kanoniska påminnelsevägen är nu:
     showReminderModal() -> _doSendReminder() -> send-offer-email
     (backend-bekräftat, se _digitalLinkPanel — dess knapprad innehåller
     inte längre en egen, oberoende påminnelseavsändare). */

  _completeActivity(actId, offerId) {
    const act = ActivitiesService._get(actId);
    if (!act) return;
    ActivitiesService.complete(actId);
    const off = getOff(offerId);
    if (off) {
      const user = state.currentUser ? (state.currentUser.name || state.currentUser.username || 'Admin') : 'Admin';
      const note = act.note ? `: ${act.note}` : '';
      this._logEvt(off, 'followup', `Uppföljning utförd${note}`);
      off.updatedAt = new Date().toISOString();
    }
    Sidebar.updateBadges();
    this.render({offerId});
    if (off) confirmPersist('offers', off.id, { ok: 'Uppföljning markerad klar', fail: 'Uppföljningen kunde inte sparas', onChange: () => this.render({offerId}) });
  },

  _rescheduleActivity(actId, offerId) {
    const act = ActivitiesService._get(actId);
    if (!act) return;
    const oldDate = act.dueDate;
    Modal.open({
      title: `${ic('calendar',14)} Flytta uppföljning`,
      body: `<div style="display:flex;gap:8px;">
        <div class="fg" style="flex:1;"><label>Nytt datum</label><input type="date" id="rs2-date" value="${act.dueDate||tdy()}"></div>
        <div class="fg" style="width:90px;"><label>Tid</label><input type="time" id="rs2-time" value="${act.dueTime||'09:00'}"></div>
      </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          const d = document.getElementById('rs2-date')?.value;
          const t = document.getElementById('rs2-time')?.value;
          if (!d) { showToast('Välj ett datum'); return; }
          ActivitiesService.reschedule(actId, d, t);
          const off = getOff(offerId);
          if (off) {
            const user    = state.currentUser ? (state.currentUser.name || state.currentUser.username || 'Admin') : 'Admin';
            const fromStr = oldDate ? new Date(oldDate + 'T12:00:00').toLocaleDateString('sv-SE', {day:'numeric',month:'short'}) : '—';
            const toStr   = new Date(d + 'T12:00:00').toLocaleDateString('sv-SE', {day:'numeric',month:'short'});
            this._logEvt(off, 'reminder', `Uppföljning flyttad från ${fromStr} till ${toStr}`);
            off.updatedAt = new Date().toISOString();
          }
          Modal.close();
          Sidebar.updateBadges();
          this.render({offerId});
          if (off) confirmPersist('offers', off.id, { ok: 'Uppföljning flyttad', fail: 'Flytten kunde inte sparas', onChange: () => this.render({offerId}) });
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  }
};

/* B1 FIX (independent-reviewer finding, round 5): registers the DURABLE
   handler for the 'offer_ao_conversion' settled intent — see
   AOTimeSyncService.js's header for the whole mechanism. Runs once, at
   script-load time (this file always loads before `initState()` can
   possibly run — see index.html's load order), so the handler is
   already registered by the time `initState()` calls
   `AOTimeSyncService.reconcileSettledIntents()`.

   Looks EVERYTHING up fresh via `intent.refId`/`intent.aoId` — never
   closes over the original `off`/`ao` objects from the call site, since
   on a reload those don't exist; this is the exact same function
   whether it runs synchronously in the original tab or on a future
   load after a crash. Idempotent by construction (AOTimeSyncService
   only ever calls an intent's handler once, tracked via `applied` —
   see that file), but the `off.workOrderId === intent.aoId` check below
   is a second, defensive layer in case this handler is ever invoked
   more than once for the same settled intent for any reason. */
if (typeof AOTimeSyncService !== 'undefined' && typeof AOTimeSyncService.registerIntentHandler === 'function') {
  /* B1 FOLLOW-UP FIX (independent-reviewer finding, round 6): this
     handler used to call `persist()` fire-and-forget (no `await`, no
     return, no check of its result) and then let `_tryApplyIntent()`
     treat "the handler's promise resolved without throwing" as
     success — but `persist()` is genuinely async and can resolve to
     `false` (the underlying `Storage.setAll()` write failed). The
     reviewer's real, runnable repro (two vm sandboxes sharing
     localStorage, `persist` stubbed to always resolve `false`) proved
     this durably PRUNED the intent anyway: the in-memory
     `off.workOrderId` was set (synchronous, before the failed write),
     but nothing was ever actually saved server-side, and the next
     "reload" (fresh offer object re-fetched from the server) had
     NOTHING left to retry from — the link was gone for good.

     Fix: this handler is now genuinely `async`, `await`s `persist()`,
     and returns an explicit `{ok, error}` contract — ONLY `{ok:true}`
     tells `_tryApplyIntent()` (see AOTimeSyncService.js) that it is
     safe to prune the durable intent; anything else (including a plain
     `undefined`/thrown error) leaves it in place for the next retry.

     Idempotency on a RETRY (same session, persist failed last time, or
     a later reconcile pass): the in-memory field mutation + timeline
     entry are only applied ONCE (`alreadyLinked` guard below) — a
     retry only re-attempts the actual `persist()` call, never
     re-pushes a second timeline entry for the same conversion. */
  AOTimeSyncService.registerIntentHandler('offer_ao_conversion', async function (intent, settleResult) {
    const off = getOff(intent.refId);
    if (!off) return { ok: true }; // offer no longer exists (e.g. deleted) -- nothing left to commit, not a failure to retry
    if (settleResult.ok) {
      const alreadyLinked = off.workOrderId === intent.aoId;
      if (!alreadyLinked) {
        const ao = getAO(intent.aoId);
        const disp = (typeof WorkOrderService !== 'undefined') ? WorkOrderService.displayNumberOrPending(ao || { id: intent.aoId }) : intent.aoId;
        const now = new Date().toISOString();
        off.workOrderId = intent.aoId;
        off.convertedAt = now;
        off.updatedAt   = now;
        if (!Array.isArray(off.timeline)) off.timeline = [];
        const user = (typeof state !== 'undefined' && state.currentUser) ? (state.currentUser.name || state.currentUser.username || 'Admin') : 'Admin';
        off.timeline.push({ ts: now, type: 'ao', text: 'Arbetsorder ' + disp + ' skapad från offert v' + (intent.versionNumber || off.versionNumber || 1), user });
      }
      /* NOTE: this canonical/production copy deliberately does NOT
         close open follow-up activities here — that is a genuine
         STAGING-only addition (found via the round-4 real merge
         against the actual staging clone), folded in ONLY on top of
         `STAGING-READY/PageShells.js`'s copy of this same handler, not
         here. See STAGING-READY/README.md. Do not copy it into this
         file — that would silently introduce a STAGING-only behavior
         into production. */
      let persisted;
      try {
        /* C1 (2026-11-12): scoped to the key this code path mutated — an unrelated key's rejection (activityLog) is not this save's failure. */
        persisted = await persist({ keys: ['offers'] });
      } catch (e) {
        console.error('[PageShells] persist() threw while committing offer->AO conversion for', intent.refId, ':', e);
        return { ok: false, error: 'persist_threw' };
      }
      if (!persisted) {
        console.error('[PageShells] persist() reported failure while committing offer->AO conversion for', intent.refId, '-- the durable intent is kept for retry, not pruned.');
        return { ok: false, error: 'persist_failed' };
      }
      if (typeof OfferDetailPage !== 'undefined' && OfferDetailPage.offerId === off.id && typeof OfferDetailPage.render === 'function') {
        OfferDetailPage.render({ offerId: off.id });
      }
      return { ok: true };
    } else if (settleResult.final) {
      console.error('[PageShells] AO-skapande avvisades slutgiltigt av servern för offert', intent.refId, '(reconciled):', settleResult.error);
      if (typeof OfferDetailPage !== 'undefined' && OfferDetailPage.offerId === off.id && typeof OfferDetailPage.render === 'function') {
        OfferDetailPage.render({ offerId: off.id });
      }
      return { ok: true }; // the REJECTION itself was fully "handled" (shown) -- nothing left to retry for this intent
    }
    // transient results never reach here (_tryApplyIntent only calls
    // the handler once `settled` is true, which only happens for ok or
    // final results — see AOTimeSyncService.js).
    return { ok: true };
  });
}

/* ── Fastigheter ──────────────────────── */
const PropertiesPage = {
  _q: '',
  _filter: 'aktiva',

  /* V30 §1: render() bygger bara SKELETTET (sökfält, flikar, tomma
     containers) en gång. renderList() fyller listan + select-all-cellen
     och anropas separat vid varje sök-/filterändring — sökfältets DOM-nod
     byts då aldrig ut, så den tappar aldrig fokus. Samma tvåfas-mönster
     som WorkOrdersPage/CustomersPage redan använde (rotorsaken till att
     BARA Fastigheter/Artiklar/Personal hade fokus-buggen: de saknade denna
     uppdelning och körde hela render() på varje tecken). */
  render() {
    const el = document.getElementById('pg-objects-content');
    if (!el) return;
    const canManage = Auth.can('customer_manage');
    el.innerHTML = `<div class="rg" data-rg="objects">
      ${RegisterUi.bar({
        id: 'prop-search', placeholder: 'Sök fastighet, adress, ort…', label: 'Sök fastighet (namn, adress, ort, nummer)', value: this._q,
        oninput: "PropertiesPage._q=this.value;RegisterUi.later('prop',function(){PropertiesPage.renderList()})",
        menu: [
          canManage ? { label: 'Importera', icon: 'upload', onclick: "Router.showPage('pg-import-wizard',{type:'property'})" } : null,
          { label: 'Exportera', icon: 'download', onclick: "ImportExportService.showExportMenu('property',this)" }
        ],
        primary: { label: 'Ny fastighet', onclick: 'PropertiesPage.openCreate()' }
      })}
      <div class="rg-filters"><div class="ftabs rg-seg" id="prop-filter-tabs" role="group" aria-label="Status"></div></div>
      <div id="prop-list" class="rg-listwrap"></div>
    </div>`;
    this.renderList();
  },

  renderList() {
    const listEl = document.getElementById('prop-list');
    if (!listEl) return;
    const allProps = state.properties || [];
    const aktiva    = allProps.filter(p => p.status !== 'inaktiv');
    const arkiverade = allProps.filter(p => p.status === 'inaktiv');
    const base = this._filter === 'arkiverade' ? arkiverade : aktiva;
    let props = base;
    if (this._q) {
      const q = this._q.toLowerCase();
      props = props.filter(p =>
        (p.name||'').toLowerCase().includes(q) || (p.address||'').toLowerCase().includes(q) || (p.city||'').toLowerCase().includes(q)
        || displayNumberOf(p).toLowerCase().includes(q) // display number (2026-11-12)
      );
    }
    const propActions = [
      { id: 'export', label: 'Exportera', icon: 'download', type: 'export' },
      this._filter === 'arkiverade'
        ? { id: 'reactivate', label: 'Återaktivera', icon: 'rotate-ccw', permission: 'customer_manage', type: 'confirm',
            confirmTitle: n => `Återaktivera ${n} fastighet${n===1?'':'er'}?`,
            confirmButtonLabel: n => `Återaktivera ${n}`,
            run: ids => PropertiesPage._bulkSetStatus(ids, 'aktiv') }
        : { id: 'archive', label: 'Arkivera', icon: 'archive', permission: 'customer_manage', type: 'confirm', destructive: true,
            confirmTitle: n => `Arkivera ${n} fastighet${n===1?'':'er'}?`,
            confirmDetail: 'Fastigheterna flyttas till Arkiverade och kan återaktiveras senare.',
            confirmButtonLabel: n => `Arkivera ${n}`,
            run: ids => PropertiesPage._bulkSetStatus(ids, 'inaktiv') }
    ];
    SelectionModel.init('property', { stateKey: 'properties', actions: propActions });
    const visibleIds = props.map(p => p.id);
    const selMode = SelectionModel.count() > 0;

    const tabsEl = document.getElementById('prop-filter-tabs');
    if (tabsEl) tabsEl.innerHTML = [['aktiva', 'Aktiva', aktiva.length], ['arkiverade', 'Arkiverade', arkiverade.length]].map(([k, l, n]) =>
      `<button type="button" class="ft ${this._filter===k?'on':''}" aria-pressed="${this._filter===k}" onclick="PropertiesPage._filter='${k}';PropertiesPage.renderList()">${l}<span class="ft-n">${n}</span></button>`).join('');

    const clear = this._q ? "PropertiesPage._q='';var i=document.getElementById('prop-search');if(i)i.value='';PropertiesPage.renderList()" : '';
    const head = RegisterUi.count(props.length, base.length, 'fastighet', 'fastigheter', { clear, selAll: props.length ? SelectionModel.selectAllHtml(visibleIds) : '' });
    if (props.length === 0) {
      listEl.innerHTML = (this._q
        ? RegisterUi.empty({ icon: 'search', title: 'Inga träffar', text: 'Inga fastigheter matchar sökningen.', action: `<button type="button" class="btn bs bsm" onclick="${clear}">Rensa sökning</button>` })
        : this._filter === 'arkiverade'
          ? RegisterUi.empty({ icon: 'archive', title: 'Inga arkiverade fastigheter', text: 'Arkiverade fastigheter visas här och kan återaktiveras.' })
          : RegisterUi.empty({ icon: 'building-2', title: 'Inga fastigheter ännu', text: 'Lägg upp den första fastigheten för att koppla arbetsorder, objekt och serviceintervall.',
              action: `<button type="button" class="btn bp bsm" onclick="PropertiesPage.openCreate()">${ic('plus',14)}<span>Ny fastighet</span></button>` }));
      return;
    }
    /* Antal objekt och öppna AO per fastighet — räknas EN gång per rendering
       (samma definition av "öppen" som kundregistret: CustomerService.getActiveAOs). */
    const nObj = {}, nAO = {};
    (state.propertyObjects || []).forEach(o => { if (o && o.propertyId) nObj[o.propertyId] = (nObj[o.propertyId] || 0) + 1; });
    (state.workOrders || []).forEach(a => { if (a && a.propertyId && !['klar','fakturerad','avbruten'].includes(a.status)) nAO[a.propertyId] = (nAO[a.propertyId] || 0) + 1; });
    const rows = props.map(p => {
      const cu = getCu(p.customerId);
      const cuName = cu ? CustomerService.displayName(cu) : '';
      const a = RegisterUi.arg(p.id);
      const addr = [p.address, [p.zip, p.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      const kind = [p.type, p.area ? fmt(p.area) + ' m²' : null].filter(Boolean).join(' · ');
      const aos = nAO[p.id] || 0, objs = nObj[p.id] || 0;
      const selected = SelectionModel.isSelected(p.id);
      return `<tr class="rg-row${selMode?' sel-mode':''}${selected?' selected':''}" data-sel-row-id="${esc(p.id)}" tabindex="0"
          onclick="SelectionModel.rowClick(${a}, function(){ PropertiesPage.openDetail(${a}); })"
          onkeydown="if(event.key==='Enter'&&event.target===this){PropertiesPage.openDetail(${a})}">
        <td class="rg-c-sel">${SelectionModel.checkboxHtml(p.id, p.name)}</td>
        <td class="rg-c-main">
          <div class="rg-title" title="${esc(p.name)}">${esc(p.name || '—')}</div>
          <div class="rg-sub">${esc(displayNumberOf(p))}${p.status === 'inaktiv' ? ' · Arkiverad' : ''}</div>
          <div class="rg-msub">${esc(addr || 'Adress saknas')}${cuName ? ' · ' + esc(cuName) : ''}</div>
        </td>
        <td class="rg-c-x" title="${esc(addr)}">${p.address ? esc(p.address) : '<span class="rg-none">Adress saknas</span>'}${(p.zip || p.city) ? `<span class="rg-l2">${esc([p.zip, p.city].filter(Boolean).join(' '))}</span>` : ''}</td>
        <td class="rg-c-x" title="${esc(cuName)}">${cuName ? esc(cuName) : '<span class="rg-none">Ingen kund</span>'}</td>
        <td class="rg-c-x rg-h-lg" title="${esc(kind)}">${p.type ? esc(p.type) : '<span class="rg-none">—</span>'}${p.area ? `<span class="rg-l2">${esc(fmt(p.area))} m²</span>` : ''}</td>
        <td class="rg-c-x c-num rg-h-md">${objs || '<span class="rg-none">0</span>'}</td>
        <td class="rg-c-x c-num">${aos ? `<span class="bdg bdg-blue">${aos}</span>` : '<span class="rg-none">0</span>'}</td>
        <td class="rg-c-end">
          ${aos ? `<span class="bdg bdg-blue rg-m-only">${aos} AO</span>` : ''}
          ${RegisterUi.openBtn(`PropertiesPage.openDetail(${a})`, 'Öppna ' + (p.name || 'fastighet'))}
        </td>
      </tr>`;
    }).join('');
    listEl.innerHTML = `<div class="dt-wrap rg-wrap">${head}
      <div class="dt-scroll"><table class="dtab rg-tbl${selMode?' sel-mode':''}">
        <thead><tr>
          <th class="rg-w-sel"><span class="sr-only">Markera</span></th>
          <th>Fastighet</th>
          <th class="rg-w-l">Adress</th>
          <th class="rg-w-m">Kund</th>
          <th class="rg-w-m rg-h-lg">Typ och yta</th>
          <th class="rg-w-xs c-num rg-h-md">Objekt</th>
          <th class="rg-w-xs c-num">Öppna AO</th>
          <th class="rg-w-end"><span class="sr-only">Öppna</span></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
  },

  /* Bulk arkivera/återaktivera — samma fält som PropertyDetailPage.toggleStatus()
     (p.status='aktiv'/'inaktiv', p.updatedAt), men EN persist() för hela batchen
     istället för en per post (SPRINT1 §18/V28 §1/§3/§7).
     Fail-closed: kräver customer_manage själv, inte bara i UI:t (V28 §1) —
     denna metod är publikt anropbar och skyddas annars bara av
     SelectionModel.runAction()s behörighetsfilter. Räknar bara poster som
     FAKTISKT bytte status; redan rätt status = unchanged (V28 §12), ingen
     persist om inget ändrades (V28 §7). */
  _BULK_ALLOWED_PROPERTY_STATUSES: ['aktiv', 'inaktiv'],

  _bulkSetStatus(ids, status) {
    if (typeof Auth === 'undefined' || !Auth.can('customer_manage')) {
      return { ok: false, error: 'Du saknar behörighet för denna åtgärd.', updated: 0, unchanged: 0 };
    }
    if (this._BULK_ALLOWED_PROPERTY_STATUSES.indexOf(status) === -1) {
      return { ok: false, error: 'Ogiltig status.', updated: 0, unchanged: 0 };
    }
    const now = new Date().toISOString();
    let updated = 0, unchanged = 0;
    (state.properties || []).forEach(p => {
      if (ids.indexOf(p.id) === -1) return;
      if (p.status === status) { unchanged++; return; }
      p.status = status; p.updatedAt = now; updated++;
    });
    if (updated > 0) { persist(); this.render(); }
    return { ok: true, updated, unchanged };
  },

  _formHtml(p) {
    const v = (k, d='') => { const val = p ? (p[k]!=null?p[k]:d) : d; return typeof val === 'string' ? esc(val) : val; };
    return `
      <div class="fg"><label>Namn / beteckning <span style="color:var(--rd)">*</span></label>
        <input id="prop-name" value="${v('name')}" placeholder="T.ex. Solvägen 1, Fastighet A…"></div>
      <div class="fg"><label>Ägare / kund</label>${CustomerPicker.render('prop-cu', { value: v('customerId'), placeholder: '— Välj kund —' })}</div>
      <div class="fg"><label>Gatuadress</label>
        <input id="prop-addr" value="${v('address')}" placeholder="Börja skriva adress…"
          autocomplete="off"
          oninput="AddressService.handleInput(this)"
          onblur="setTimeout(()=>AddressService.hideSuggestions(),150)"
          data-addr-zip="prop-zip" data-addr-city="prop-city"></div>
      <div class="g2">
        <div class="fg"><label>Postnummer</label><input id="prop-zip" value="${v('zip')}" placeholder="123 45"></div>
        <div class="fg"><label>Stad</label><input id="prop-city" value="${v('city')}" placeholder="Stockholm"></div>
      </div>
      <div class="g2">
        <div class="fg"><label>Typ</label>
          <select id="prop-type">
            ${['Flerbostadshus','Kontorsfastighet','Industrifastighet','BRF','Villa','Butiksfastighet','Lager','Övrigt'].map(t=>`<option ${v('type')===t?'selected':''}>${t}</option>`).join('')}
          </select></div>
        <div class="fg"><label>Yta (m²)</label>
          <input type="number" id="prop-area" value="${v('area',0)}" min="0" placeholder="0"></div>
      </div>
      <div class="fg"><label>Antal våningar</label>
        <input type="number" id="prop-floors" value="${v('floors',1)}" min="1" max="50"></div>
      ${!p && typeof Auth !== 'undefined' && Auth.can('objects_sensitive') ? `
      <div class="fg"><label>Portkod / åtkomst</label>
        <input id="prop-access" value="" placeholder="T.ex. 1234#" autocomplete="off">
        <div style="font-size:11px;color:var(--mt);margin-top:3px;">Sparas skyddat och visas bara för behöriga.</div></div>` : ''}
      ${p ? `<div style="font-size:12px;color:var(--mt);margin:2px 0 10px;">Portkod och nyckelinformation ändras i fastighetskortet (skyddad lagring).</div>` : ''}
      <div class="fg"><label>Anteckning</label>
        <textarea id="prop-note" rows="2" placeholder="Intern anteckning…">${v('note')}</textarea></div>`;
  },

  openCreate() {
    Modal.open({
      title: 'Ny fastighet',
      wide: true,
      body: this._formHtml(null),
      buttons: [
        { label: 'Skapa', cls: 'btn bp', onClick: () => PropertiesPage._save(null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('prop-name')?.focus(), 80);
  },

  openDetail(propId) {
    Router.showPage('pg-obj-detail', { propId });
  },

  openEdit(propId) {
    const p = (state.properties||[]).find(x=>x.id===propId);
    if (!p) return;
    Modal.open({
      title: `Redigera ${p.name}`,
      wide: true,
      body: this._formHtml(p),
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => PropertiesPage._save(propId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  /* Portkod sparas ALDRIG i fastighetsregistret (vift_properties läses av
     alla inloggade). Vid ny fastighet skickas den, för behörig användare,
     via den skyddade set-sensitive-fields-vägen — först när fastigheten
     själv bekräftats sparad. Befintliga fastigheters portkod ändras i
     fastighetskortet. Bekräftelse visas först efter serverns svar. */
  async _save(propId) {
    const name = document.getElementById('prop-name')?.value.trim();
    if (!name) { showToast('Namn krävs'); return; }
    if (this._saving) return;
    const data = {
      name,
      customerId: document.getElementById('prop-cu')?.value || '',
      address:    document.getElementById('prop-addr')?.value.trim() || '',
      zip:        document.getElementById('prop-zip')?.value.trim() || '',
      city:       document.getElementById('prop-city')?.value.trim() || '',
      type:       document.getElementById('prop-type')?.value || '',
      area:       parseFloat(document.getElementById('prop-area')?.value) || 0,
      floors:     parseInt(document.getElementById('prop-floors')?.value) || 1,
      note:       document.getElementById('prop-note')?.value.trim() || '',
      updatedAt:  new Date().toISOString()
    };
    const accessCode = (!propId && typeof Auth !== 'undefined' && Auth.can('objects_sensitive'))
      ? (document.getElementById('prop-access')?.value.trim() || '') : '';
    let newId = null;
    if (!propId) {
      state.properties = state.properties || [];
      newId = newSafeId('OBJ', state.properties); // K3 (2026-11-12): collision-safe
      state.properties.push({ ...data, id: newId, shortNumber: newShortNumber(newId, state.properties), createdAt: new Date().toISOString() }); // display number (2026-11-12)
    } else {
      const idx = (state.properties||[]).findIndex(x=>x.id===propId);
      if (idx < 0) return;
      state.properties[idx] = { ...state.properties[idx], ...data };
    }
    this._saving = true;
    Modal.close(); this.render();
    showToast('Sparar…');
    try {
      const ok = await persist({ keys: ['properties'] });
      if (!ok) { showToast('Fastigheten kunde inte sparas av servern — se meddelandet om osparade ändringar.', 6000); return; }
      if (newId && accessCode && typeof PropertyDetailPage !== 'undefined') {
        const r = await PropertyDetailPage._saveSensitiveFields({ propertyId: newId, accessCode });
        if (!r.ok) { showToast(name + ' skapad, men portkoden sparades INTE (' + (r.error || 'fel') + ') — ange den i fastighetskortet.', 7000); return; }
      }
      showToast(propId ? 'Fastighet uppdaterad' : `${name} skapad`);
    } finally {
      this._saving = false;
    }
  }
};

/* ── Register: gemensamma byggstenar (V3, 2026-11-26) ──────────────
 * Används av Kunder (CustomersPage.js), Fastigheter, Artiklar,
 * Prisgrupper, Personal, Offerttjänster och Uppgifter så att samma sak
 * ser ut och beter sig likadant (docs/V3-KOMPONENTSTANDARD.md §1–§7):
 * verktygsrad med sök till vänster, "⋮" för sekundära åtgärder och EN
 * primär åtgärd; räknarrad "Visar X av Y"; tomlägen; ⋮-meny per rad.
 * Rena HTML-hjälpare utan skrivningar. All data går genom esc(); id:n
 * till inline-anrop går genom arg() (JSON + esc, kan inte bryta sig ut
 * ur attributet). Stilar: src/styles/v3-register.css. */
const RegisterUi = {
  _timers: {},

  /** Id/värde som JS-strängliteral, säker inuti ett onclick="…"-attribut. */
  arg(v) { return esc(JSON.stringify(String(v == null ? '' : v))); },

  /** Säkert DOM-id av ett post-id (för menyer per rad). */
  domId(prefix, v) { return prefix + '-' + String(v == null ? '' : v).replace(/[^A-Za-z0-9_-]/g, '_'); },

  plural(n, one, many) { return n === 1 ? one : many; },

  /** Sökningen renderar bara om listan (fältet behåller fokus), 150 ms fördröjning. */
  later(key, fn) {
    clearTimeout(this._timers[key]);
    this._timers[key] = setTimeout(fn, 150);
  },

  /** Verktygsrad: sök | ⋮ (Importera/Exportera m.m.) | en primär åtgärd. */
  bar(o) {
    const items = (o.menu || []).filter(Boolean);
    return `<div class="rg-bar">
      <div class="swrap rg-search">
        <span class="sico" aria-hidden="true">${ic('search',16)}</span>
        <input type="search" id="${o.id}" placeholder="${esc(o.placeholder)}" aria-label="${esc(o.label || o.placeholder)}"
          value="${esc(o.value || '')}" autocomplete="off" oninput="${o.oninput}">
      </div>
      <div class="rg-bar-r">
        ${items.length ? this.menu(o.id + '-ovf', 'Fler åtgärder', items, 'rg-bar-more') : ''}
        ${o.primary ? `<button type="button" class="btn bp bsm rg-new" onclick="${o.primary.onclick}">${ic('plus',15)}<span>${esc(o.primary.label)}</span></button>` : ''}
      </div>
    </div>`;
  },

  /** "⋮"-meny (mönstret aoToggleOverflow/.ao-overflow-wrap). items: {label, icon, onclick, danger, sep}.
      Destruktiva poster läggs sist, avskilda och i röd text (anroparen ansvarar för bekräftelse). */
  menu(menuId, ariaLabel, items, cls) {
    items = (items || []).filter(Boolean);
    if (!items.length) return '';
    return `<div class="ao-overflow-wrap rg-menu${cls ? ' ' + cls : ''}" onclick="event.stopPropagation()">
      <button type="button" class="ibtn rg-more" aria-label="${esc(ariaLabel)}" title="${esc(ariaLabel)}" aria-haspopup="menu" aria-expanded="false"
        onclick="RegisterUi.toggleMenu('${menuId}',this)">${ic('more-vertical',16)}</button>
      <div class="ao-overflow-menu rg-menu-list" id="${menuId}" role="menu">
        ${items.map(it => `${it.sep ? '<div class="ao-overflow-divider" role="separator"></div>' : ''}<button type="button" class="ao-overflow-menu-item${it.danger ? ' ao-overflow-menu-item--red' : ''}" role="menuitem" onclick="aoCloseOverflow();${it.onclick}">${ic(it.icon,14)}<span>${esc(it.label)}</span></button>`).join('')}
      </div>
    </div>`;
  },

  /* Menyn läggs fast (position:fixed) intill knappen så att den aldrig
     klipps av tabellens rullbehållare; öppnas uppåt om det inte finns
     plats nedåt (bottenmenyn på mobil räknas bort). */
  toggleMenu(menuId, btn) {
    aoToggleOverflow(menuId, btn);
    const m = document.getElementById(menuId);
    if (!m || !btn) return;
    if (!m.classList.contains('open')) return;
    const r = btn.getBoundingClientRect();
    m.style.position = 'fixed';
    m.style.left = 'auto';
    m.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
    m.style.top = (r.bottom + 4) + 'px';
    const nav = document.getElementById('mobile-bottom-nav');
    const navH = nav && nav.getBoundingClientRect().height > 0 && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().height : 0;
    const floor = window.innerHeight - navH - 8;
    const h = m.offsetHeight;
    if (r.bottom + 4 + h > floor && r.top - 4 - h > 8) m.style.top = (r.top - 4 - h) + 'px';
    if (!this._scrollBound) {
      this._scrollBound = true;
      const close = () => { if (document.querySelector('.rg-menu-list.open')) aoCloseOverflow(); };
      const sc = document.getElementById('content-scroll');
      if (sc) sc.addEventListener('scroll', close, { passive: true });
      window.addEventListener('resize', close);
    }
    const first = m.querySelector('[role=menuitem]');
    if (first) first.focus({ preventScroll: true });
  },

  /** Räknarrad: "Visar X av Y <substantiv>" + ev. "Rensa filter" + "Välj alla". */
  count(shown, total, nounOne, nounMany, o) {
    o = o || {};
    const noun = this.plural(total, nounOne, nounMany);
    const txt = shown === total ? `${total} ${noun}` : `Visar ${shown} av ${total} ${noun}`;
    return `<div class="rg-count">
      <span class="rg-count-t" aria-live="polite">${esc(txt)}</span>
      ${o.clear ? `<button type="button" class="btn bghost bxs rg-clear" onclick="${o.clear}">${ic('x',12)}<span>Rensa filter</span></button>` : ''}
      ${o.selAll ? `<span class="ao-selall-cell rg-selall">${o.selAll}</span>` : ''}
    </div>`;
  },

  /** Tomläge: ikon, rubrik, en mening och en åtgärd om sådan finns. */
  empty(o) {
    return `<div class="empty rg-empty">${ic(o.icon || 'search',32)}<h3>${esc(o.title)}</h3>${o.text ? `<p>${esc(o.text)}</p>` : ''}${o.action || ''}</div>`;
  },

  /** Statusmärke för registerposter (punkt + text). */
  status(on, onLabel, offLabel) {
    return `<span class="bdg st ${on ? 'bdg-green' : 'bdg-grey'}"><span class="st-dot"></span>${esc(on ? onLabel : offLabel)}</span>`;
  },

  /** Öppna-knapp (chevron) längst till höger i raden. */
  openBtn(onclick, label, cls) {
    return `<button type="button" class="ibtn rg-open${cls ? ' ' + cls : ''}" title="${esc(label)}" aria-label="${esc(label)}" onclick="event.stopPropagation();${onclick}">${ic('chevron-right',16)}</button>`;
  }
};

/* ── Artiklar ─────────────────────────── */
const ArticlesPage = {
  _filter: 'alla',   // kategori ('alla' | kategorinyckel)
  _status: 'alla',   // V3 register: 'alla' | 'aktiva' | 'inaktiva' (standard 'alla' = samma urval som förut)
  _q: '',

  /* V30 §1: samma tvåfas-uppdelning som PropertiesPage (se kommentar där)
     — render() bygger skelettet en gång, renderList() uppdaterar bara
     listan/select-all/flikräknare vid sök- och filterändring, så
     sökfältet aldrig byts ut och tappar fokus. */
  _catLabels: { alla:'Alla', kemikalier:'Kemikalier', material:'Byggmaterial', forbruk:'Förbrukning', arbete:'Arbete', kostnad:'Kostnader' },

  render() {
    const el = document.getElementById('pg-articles-content');
    if (!el) return;
    el.innerHTML = `<div class="rg" data-rg="articles">
      ${RegisterUi.bar({
        id: 'art-search', placeholder: 'Sök benämning eller art.nr…', label: 'Sök artikel', value: this._q,
        oninput: "ArticlesPage._q=this.value;RegisterUi.later('art',function(){ArticlesPage.renderList()})",
        menu: [
          Auth.can('article_manage') ? { label: 'Importera', icon: 'upload', onclick: "Router.showPage('pg-import-wizard',{type:'article'})" } : null,
          { label: 'Exportera', icon: 'download', onclick: "ImportExportService.showExportMenu('article',this)" }
        ],
        primary: { label: 'Ny artikel', onclick: 'ArticlesPage.openCreate()' }
      })}
      <div class="rg-filters" id="art-filters"></div>
      <div id="art-list" class="rg-listwrap"></div>
    </div>`;
    this.renderList();
  },

  _clearFilters() {
    this._q = ''; this._filter = 'alla';
    const i = document.getElementById('art-search'); if (i) i.value = '';
    this.renderList();
  },

  renderList() {
    const listEl = document.getElementById('art-list');
    if (!listEl) return;
    const cats = ['alla','kemikalier','material','forbruk','arbete','kostnad'];
    const catLabels = this._catLabels;
    const all = state.articles || [];
    const isActive = a => a.active !== false; // saknat fält = aktiv (som _bulkSetActive)
    const nStatus = { alla: all.length, aktiva: all.filter(isActive).length };
    nStatus.inaktiva = all.length - nStatus.aktiva;
    const statusBase = this._status === 'aktiva' ? all.filter(isActive) : this._status === 'inaktiva' ? all.filter(a => !isActive(a)) : all;
    let searched = statusBase;
    if (this._q) {
      const q = this._q.toLowerCase();
      searched = searched.filter(a => (a.name||'').toLowerCase().includes(q) || String(a.articleNumber||'').toLowerCase().includes(q));
    }
    const nCat = {};
    searched.forEach(a => { nCat[a.category] = (nCat[a.category] || 0) + 1; });
    const arts = this._filter !== 'alla' ? searched.filter(a => a.category === this._filter) : searched;
    const artActions = [
      { id: 'export', label: 'Exportera', icon: 'download', type: 'export' },
      { id: 'activate', label: 'Aktivera', icon: 'eye', permission: 'article_manage', type: 'confirm',
        confirmTitle: n => `Aktivera ${n} artikel${n===1?'':'ar'}?`,
        confirmButtonLabel: n => `Aktivera ${n}`,
        run: ids => ArticlesPage._bulkSetActive(ids, true) },
      { id: 'deactivate', label: 'Inaktivera', icon: 'eye-off', permission: 'article_manage', type: 'confirm', destructive: true,
        confirmTitle: n => `Inaktivera ${n} artikel${n===1?'':'ar'}?`,
        confirmButtonLabel: n => `Inaktivera ${n}`,
        run: ids => ArticlesPage._bulkSetActive(ids, false) }
    ];
    SelectionModel.init('article', { stateKey: 'articles', actions: artActions });
    const artVisibleIds = arts.map(a => a.id);
    const selMode = SelectionModel.count() > 0;

    const fEl = document.getElementById('art-filters');
    if (fEl) fEl.innerHTML = `
      <div class="ftabs rg-seg" role="group" aria-label="Status">
        ${[['alla','Alla'],['aktiva','Aktiva'],['inaktiva','Inaktiva']].map(([k,l]) =>
          `<button type="button" class="ft ${this._status===k?'on':''}" aria-pressed="${this._status===k}" onclick="ArticlesPage._status='${k}';ArticlesPage.renderList()">${l}<span class="ft-n">${nStatus[k]}</span></button>`).join('')}
      </div>
      <div class="rg-chips" role="group" aria-label="Kategori">
        ${cats.map(c => UiKit.chip(c === 'alla' ? 'Alla kategorier' : catLabels[c], `ArticlesPage._filter='${c}';ArticlesPage.renderList()`, { on: this._filter === c, n: c === 'alla' ? searched.length : (nCat[c] || 0) })).join('')}
      </div>`;

    const filtered = !!this._q || this._filter !== 'alla';
    const head = RegisterUi.count(arts.length, statusBase.length, 'artikel', 'artiklar', {
      clear: filtered ? 'ArticlesPage._clearFilters()' : '',
      selAll: arts.length ? SelectionModel.selectAllHtml(artVisibleIds) : ''
    });
    if (arts.length === 0) {
      listEl.innerHTML = filtered
        ? RegisterUi.empty({ icon: 'search', title: 'Inga träffar', text: this._q ? 'Inga artiklar matchar sökningen.' : 'Inga artiklar i vald kategori.',
            action: `<button type="button" class="btn bs bsm" onclick="ArticlesPage._clearFilters()">Rensa filter</button>` })
        : this._status === 'inaktiva'
          ? RegisterUi.empty({ icon: 'eye-off', title: 'Inga inaktiva artiklar', text: 'Inaktiverade artiklar visas här och kan aktiveras igen.' })
          : RegisterUi.empty({ icon: 'package', title: 'Inga artiklar ännu', text: 'Lägg upp artiklar för material och arbete — eller importera en prislista.',
              action: Auth.can('article_manage') ? `<button type="button" class="btn bp bsm" onclick="ArticlesPage.openCreate()">${ic('plus',14)}<span>Ny artikel</span></button>` : '' });
      return;
    }

    const rows = arts.map(a => {
      const margin = a.buyPrice > 0 && a.sellPrice > 0
        ? Math.round((1 - a.buyPrice / a.sellPrice) * 100)
        : null;
      const mCls = margin === null ? '' : margin >= 30 ? 'rg-ok' : margin >= 10 ? 'rg-warn' : 'rg-bad';
      const id = RegisterUi.arg(a.id);
      const cat = catLabels[a.category] || a.category || '';
      const unit = a.unit || 'st';
      const vat = _normVat(a.vatRate);
      const selected = SelectionModel.isSelected(a.id);
      /* Priset i registret är exkl. moms (fältet "Försäljningspris ex moms";
         ProfitabilityService räknar sellPrice som exkl.) — tidigare stod
         felaktigt "inkl 25% moms" i listan. */
      return `<tr class="rg-row${selMode?' sel-mode':''}${selected?' selected':''}${isActive(a)?'':' rg-row--off'}" data-sel-row-id="${esc(a.id)}" tabindex="0"
          onclick="SelectionModel.rowClick(${id}, function(){ ArticlesPage.openEdit(${id}); })"
          onkeydown="if(event.key==='Enter'&&event.target===this){ArticlesPage.openEdit(${id})}">
        <td class="rg-c-sel">${SelectionModel.checkboxHtml(a.id, a.name)}</td>
        <td class="rg-c-x rg-num">${a.articleNumber ? esc(a.articleNumber) : '<span class="rg-none">—</span>'}</td>
        <td class="rg-c-main">
          <div class="rg-title" title="${esc(a.name)}">${esc(a.name || '—')}</div>
          <div class="rg-msub">${a.articleNumber ? 'Art.nr ' + esc(a.articleNumber) + ' · ' : ''}${esc(cat || 'Ingen kategori')}</div>
          <div class="rg-msub"><span class="rg-nw">${fmt(a.sellPrice)} kr/${esc(unit)} exkl. moms</span> · <span class="rg-nw">${vat} % moms</span>${margin !== null ? ` · <span class="rg-nw ${mCls}">${margin} % marginal</span>` : ''}</div>
        </td>
        <td class="rg-c-x rg-h-md">${cat ? `<span class="bdg ${catLabels[a.category] ? 'bdg-sky' : 'bdg-grey'}">${esc(cat)}</span>` : '<span class="rg-none">—</span>'}</td>
        <td class="rg-c-x rg-h-md">${esc(unit)}</td>
        <td class="rg-c-x c-num"><span class="rg-price">${fmt(a.sellPrice)} kr</span><span class="rg-l2">per ${esc(unit)} · ${vat} % moms</span></td>
        <td class="rg-c-x c-num rg-h-lg">${margin !== null ? `<span class="${mCls}">${margin} %</span>` : '<span class="rg-none">—</span>'}</td>
        <td class="rg-c-x">${RegisterUi.status(isActive(a), 'Aktiv', 'Inaktiv')}</td>
        <td class="rg-c-end">
          ${isActive(a) ? '' : `<span class="bdg bdg-grey rg-m-only">Inaktiv</span>`}
          ${RegisterUi.openBtn(`ArticlesPage.openEdit(${id})`, 'Öppna ' + (a.name || 'artikel'))}
        </td>
      </tr>`;
    }).join('');
    listEl.innerHTML = `<div class="dt-wrap rg-wrap">${head}
      <div class="dt-scroll"><table class="dtab rg-tbl${selMode?' sel-mode':''}">
        <thead><tr>
          <th class="rg-w-sel"><span class="sr-only">Markera</span></th>
          <th class="rg-w-xs">Art.nr</th>
          <th>Benämning</th>
          <th class="rg-w-m rg-h-md">Kategori</th>
          <th class="rg-w-xs rg-h-md">Enhet</th>
          <th class="rg-w-p c-num">Pris exkl. moms</th>
          <th class="rg-w-xs c-num rg-h-lg">Marginal</th>
          <th class="rg-w-xs">Status</th>
          <th class="rg-w-end"><span class="sr-only">Öppna</span></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
  },

  _formHtml(a) {
    const catLabels = { kemikalier:'Kemikalier', material:'Byggmaterial', forbruk:'Förbrukning', arbete:'Arbete', kostnad:'Kostnader' };
    return `
      <div class="g2">
        <div class="fg"><label>Artikelnummer</label>
          <input id="art-num" value="${a?esc(a.articleNumber||''):''}" placeholder="T.ex. 1001"></div>
        <div class="fg"><label>Kategori</label>
          <select id="art-cat">
            ${Object.entries(catLabels).map(([v,l])=>`<option value="${v}" ${a&&a.category===v?'selected':''}>${l}</option>`).join('')}
          </select></div>
      </div>
      <div class="fg"><label>Benämning <span style="color:var(--rd)">*</span></label>
        <input id="art-name" value="${a?esc(a.name||''):''}" placeholder="T.ex. Fogmassa Sikaflex 291i"></div>
      <div class="g2">
        <div class="fg"><label>Enhet</label>
          <select id="art-unit">${unitsHtml(a?a.unit:'st')}</select></div>
        <div class="fg"><label>Momssats</label>
          <select id="art-vat">
            ${(() => {
              /* V39 §1: EXAKT en option ska vara selected. Den gamla
                 `a&&a.vatRate===r?'selected':r===25?'selected':''`
                 markerade FELAKTIGT även 25% som selected för alla
                 artiklar (villkoret r===25 utvärderas oavsett a.vatRate
                 så fort a.vatRate inte matchade just den aktuella r:en) —
                 en artikel med vatRate:0 fick både "0% selected" OCH
                 "25% selected" i samma <select>. Nu beräknas den
                 normaliserade momssatsen EN gång och jämförs mot den. */
              const selVat = a ? _normVat(a.vatRate) : 25;
              return [0,6,12,25].map(r=>`<option value="${r}" ${r===selVat?'selected':''}>${r}%</option>`).join('');
            })()}
          </select></div>
      </div>
      <div class="g2">
        <div class="fg"><label>Inköpspris (kr/enhet)</label>
          <input type="number" id="art-buy" value="${a?a.buyPrice||0:0}" min="0" placeholder="0"></div>
        <div class="fg"><label>Försäljningspris ex moms (kr/enhet)</label>
          <input type="number" id="art-sell" value="${a?a.sellPrice||0:0}" min="0" placeholder="0"></div>
      </div>`;
  },

  openCreate() {
    if (!Auth.require('article_manage')) return;
    Modal.open({
      title: 'Ny artikel',
      body: this._formHtml(null),
      buttons: [
        { label: 'Skapa', cls: 'btn bp', onClick: () => ArticlesPage._save(null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('art-name')?.focus(), 80);
  },

  openEdit(artId) {
    const a = (state.articles||[]).find(x=>x.id===artId);
    if (!a) return;
    Modal.open({
      title: esc(a.name),
      wide: true,
      body: this._formHtml(a),
      buttons: [
        { label: a.active!==false ? `${ic('eye-off',13)} Inaktivera` : `${ic('eye',13)} Aktivera`,
          cls: 'btn bw', onClick: () => ArticlesPage._toggleActive(artId) },
        { label: 'Spara', cls: 'btn bp', onClick: () => ArticlesPage._save(artId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _save(artId) {
    const name = document.getElementById('art-name')?.value.trim();
    if (!name) { showToast('Benämning krävs'); return; }
    /* V39 §2: strikt write-validering — en ogiltig momssats ska blockera
       hela sparningen, INTE tystas till 25 % (_strictVat, ej _normVat). */
    const vatCheck = _strictVat(document.getElementById('art-vat')?.value);
    if (!vatCheck.ok) { showToast(vatCheck.error); return; }
    const data = {
      articleNumber: document.getElementById('art-num')?.value.trim() || '',
      name,
      category: document.getElementById('art-cat')?.value || 'material',
      unit:     document.getElementById('art-unit')?.value || 'st',
      vatRate:  vatCheck.value,
      buyPrice: parseFloat(document.getElementById('art-buy')?.value) || 0,
      sellPrice:parseFloat(document.getElementById('art-sell')?.value) || 0,
      updatedAt: new Date().toISOString()
    };
    /* G12: besked först efter serverns bekräftelse. */
    let savedId = artId;
    if (!artId) {
      savedId = newId(state.articles,'ART');
      state.articles.push({ ...data, id: savedId, active: true, createdAt: new Date().toISOString() });
    } else {
      const idx = (state.articles||[]).findIndex(a=>a.id===artId);
      if (idx < 0) return;
      state.articles[idx] = { ...state.articles[idx], ...data };
    }
    Modal.close(); this.render();
    return confirmPersist('articles', savedId, { ok: artId ? 'Artikel uppdaterad' : `${name} skapad`, fail: 'Artikeln kunde inte sparas', onChange: () => this.render() });
  },

  _toggleActive(artId) {
    const idx = (state.articles||[]).findIndex(a=>a.id===artId);
    if (idx < 0) return;
    state.articles[idx] = { ...state.articles[idx], active: !state.articles[idx].active, updatedAt: new Date().toISOString() };
    persist(); Modal.close();
    showToast(state.articles[idx].active ? 'Aktiverad' : 'Inaktiverad');
    this.render();
  },

  /* Bulk aktivera/inaktivera — samma fält som _toggleActive() (active,
     updatedAt), men EN persist() för hela batchen (SPRINT1 §18/V28 §1/§3/§7).
     Fail-closed: kräver article_manage själv (publikt anropbar). Räknar
     bara faktiskt ändrade poster; redan-samma-värde = unchanged, ingen
     persist om inget ändrades. */
  _bulkSetActive(ids, active) {
    if (typeof Auth === 'undefined' || !Auth.can('article_manage')) {
      return { ok: false, error: 'Du saknar behörighet för denna åtgärd.', updated: 0, unchanged: 0 };
    }
    if (typeof active !== 'boolean') {
      return { ok: false, error: 'Ogiltigt värde.', updated: 0, unchanged: 0 };
    }
    const now = new Date().toISOString();
    let updated = 0, unchanged = 0;
    (state.articles || []).forEach(a => {
      if (ids.indexOf(a.id) === -1) return;
      var current = a.active !== false; // saknat fält tolkas som aktiv, matchar renderingens a.active===false-check
      if (current === !!active) { unchanged++; return; }
      a.active = active; a.updatedAt = now; updated++;
    });
    if (updated > 0) { persist(); this.render(); }
    return { ok: true, updated, unchanged };
  }
};

/* ── Prisgrupper ──────────────────────── */
const PriceGroupsPage = {
  _tab: 'grupper',
  _q: '',

  /* V3 register (2026-11-26): flikarna Prisgrupper/Prisprofiler är en
     .ftabs-vyväxlare; sidrubriken upprepas inte (den står i toppraden);
     verktygsraden har sök, "⋮" och EN primär åtgärd som följer fliken. */
  render() {
    const el = document.getElementById('pg-pricegroups-content');
    if (!el) return;
    const tab = this._tab === 'profiler' ? 'profiler' : 'grupper';
    const nG = (state.priceGroups || []).length, nP = (state.priceProfiles || []).length;
    el.innerHTML = `<div class="rg" data-rg="pricegroups">
      ${RegisterUi.bar({
        id: 'pg-search', placeholder: tab === 'grupper' ? 'Sök prisgrupp…' : 'Sök prisprofil…', label: tab === 'grupper' ? 'Sök prisgrupp' : 'Sök prisprofil', value: this._q,
        oninput: "PriceGroupsPage._q=this.value;RegisterUi.later('pg',function(){PriceGroupsPage._renderTab()})",
        menu: tab === 'grupper' ? [
          Auth.can('article_manage') ? { label: 'Importera', icon: 'upload', onclick: "Router.showPage('pg-import-wizard',{type:'priceGroup'})" } : null,
          { label: 'Exportera', icon: 'download', onclick: "ImportExportService.showExportMenu('priceGroup',this)" }
        ] : [],
        primary: tab === 'grupper'
          ? { label: 'Ny prisgrupp', onclick: 'PriceGroupsPage.openCreate()' }
          : { label: 'Ny prisprofil', onclick: 'PriceGroupsPage.openCreateProfile()' }
      })}
      <div class="rg-filters">
        <div class="ftabs rg-seg" role="tablist" aria-label="Vy">
          <button type="button" class="ft ${tab==='grupper'?'on':''}" role="tab" aria-selected="${tab==='grupper'}" onclick="PriceGroupsPage._tab='grupper';PriceGroupsPage.render()">Prisgrupper<span class="ft-n">${nG}</span></button>
          <button type="button" class="ft ${tab==='profiler'?'on':''}" role="tab" aria-selected="${tab==='profiler'}" onclick="PriceGroupsPage._tab='profiler';PriceGroupsPage.render()">Prisprofiler<span class="ft-n">${nP}</span></button>
        </div>
      </div>
      <div id="pg-pricegroups-tab-body" class="rg-listwrap"></div>
    </div>`;
    this._renderTab();
  },

  _renderTab() {
    if (this._tab === 'profiler') this._renderProfiler(); else this._renderGrupper();
  },

  _clearSearch() {
    this._q = '';
    const i = document.getElementById('pg-search'); if (i) i.value = '';
    this._renderTab();
  },

  _match(...vals) {
    const q = (this._q || '').toLowerCase();
    return !q || vals.some(v => String(v || '').toLowerCase().includes(q));
  },

  _renderGrupper() {
    const el = document.getElementById('pg-pricegroups-tab-body');
    if (!el) return;
    const all = state.priceGroups || [];
    const pgs = all.filter(pg => this._match(pg.name, pg.description));
    const head = RegisterUi.count(pgs.length, all.length, 'prisgrupp', 'prisgrupper', { clear: this._q ? 'PriceGroupsPage._clearSearch()' : '' });
    if (!pgs.length) {
      el.innerHTML = this._q
        ? RegisterUi.empty({ icon: 'search', title: 'Inga träffar', text: 'Inga prisgrupper matchar sökningen.', action: `<button type="button" class="btn bs bsm" onclick="PriceGroupsPage._clearSearch()">Rensa sökning</button>` })
        : RegisterUi.empty({ icon: 'dollar-sign', title: 'Inga prisgrupper ännu', text: 'Prisgrupper anger timpriset (exkl. moms) för olika slags arbete, t.ex. Standard, Jour och Övertid.',
            action: Auth.can('article_manage') ? `<button type="button" class="btn bp bsm" onclick="PriceGroupsPage.openCreate()">${ic('plus',14)}<span>Ny prisgrupp</span></button>` : '' });
      return;
    }
    el.innerHTML = `<div class="dt-wrap rg-wrap">${head}
      <div class="dt-scroll"><table class="dtab rg-tbl rg-tbl--nosel">
        <thead><tr>
          <th>Prisgrupp</th>
          <th class="rg-w-p c-num">Timpris exkl. moms</th>
          <th class="rg-w-xs">Status</th>
          <th class="rg-w-end"><span class="sr-only">Öppna</span></th>
        </tr></thead>
        <tbody>${pgs.map(pg => {
          const id = RegisterUi.arg(pg.id);
          return `<tr class="rg-row${pg.active ? '' : ' rg-row--off'}" tabindex="0" onclick="PriceGroupsPage.openEdit(${id})"
              onkeydown="if(event.key==='Enter'&&event.target===this){PriceGroupsPage.openEdit(${id})}">
            <td class="rg-c-main">
              <div class="rg-title" title="${esc(pg.name)}">${esc(pg.name || '—')}</div>
              ${pg.description ? `<div class="rg-sub" title="${esc(pg.description)}">${esc(pg.description)}</div>` : ''}
              <div class="rg-msub">${fmt(pg.hourRate)} kr/tim exkl. moms</div>
            </td>
            <td class="rg-c-x c-num"><span class="rg-price">${fmt(pg.hourRate)} kr/tim</span></td>
            <td class="rg-c-x">${RegisterUi.status(!!pg.active, 'Aktiv', 'Inaktiv')}</td>
            <td class="rg-c-end">
              ${pg.active ? '' : `<span class="bdg bdg-grey rg-m-only">Inaktiv</span>`}
              ${RegisterUi.openBtn(`PriceGroupsPage.openEdit(${id})`, 'Öppna ' + (pg.name || 'prisgrupp'))}
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>`;
  },

  _renderProfiler() {
    const el = document.getElementById('pg-pricegroups-tab-body');
    if (!el) return;
    const all = (state.priceProfiles || []).slice().sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0));
    const pgs = state.priceGroups || [];
    const pgName = id => { const g = pgs.find(x=>x.id===id); return g ? g.name : (id||''); };
    const pps = all.filter(pp => this._match(pp.name, pp.notes, pgName(pp.defaultPriceGroupId)));
    const head = RegisterUi.count(pps.length, all.length, 'prisprofil', 'prisprofiler', { clear: this._q ? 'PriceGroupsPage._clearSearch()' : '' });
    if (!pps.length) {
      el.innerHTML = this._q
        ? RegisterUi.empty({ icon: 'search', title: 'Inga träffar', text: 'Inga prisprofiler matchar sökningen.', action: `<button type="button" class="btn bs bsm" onclick="PriceGroupsPage._clearSearch()">Rensa sökning</button>` })
        : RegisterUi.empty({ icon: 'users', title: 'Inga prisprofiler ännu', text: 'En prisprofil kopplar en kundgrupp (t.ex. BRF eller privatkund) till en standardprisgrupp.',
            action: Auth.can('article_manage') ? `<button type="button" class="btn bp bsm" onclick="PriceGroupsPage.openCreateProfile()">${ic('plus',14)}<span>Ny prisprofil</span></button>` : '' });
      return;
    }
    el.innerHTML = `<div class="dt-wrap rg-wrap">${head}
      <div class="dt-scroll"><table class="dtab rg-tbl rg-tbl--nosel">
        <thead><tr>
          <th>Prisprofil</th>
          <th class="rg-w-l">Standardprisgrupp</th>
          <th class="rg-w-end"><span class="sr-only">Redigera</span></th>
        </tr></thead>
        <tbody>${pps.map(pp => {
          const id = RegisterUi.arg(pp.id);
          const g = pgName(pp.defaultPriceGroupId);
          return `<tr class="rg-row" tabindex="0" onclick="PriceGroupsPage.openEditProfile(${id})"
              onkeydown="if(event.key==='Enter'&&event.target===this){PriceGroupsPage.openEditProfile(${id})}">
            <td class="rg-c-main">
              <div class="rg-title" title="${esc(pp.name)}">${esc(pp.name || '—')}</div>
              ${pp.notes ? `<div class="rg-sub" title="${esc(pp.notes)}">${esc(pp.notes)}</div>` : ''}
              <div class="rg-msub">Standardprisgrupp: ${g ? esc(g) : 'ingen'}</div>
            </td>
            <td class="rg-c-x" title="${esc(g)}">${g ? esc(g) : '<span class="rg-none">Ingen</span>'}</td>
            <td class="rg-c-end">
              <button type="button" class="ibtn rg-open" title="Redigera ${esc(pp.name || 'prisprofil')}" aria-label="Redigera ${esc(pp.name || 'prisprofil')}" onclick="event.stopPropagation();PriceGroupsPage.openEditProfile(${id})">${ic('pencil',15)}</button>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>`;
  },

  _formHtml(pg) {
    return `
      <div class="fg"><label>Namn <span style="color:var(--rd)">*</span></label>
        <input id="pg-name" value="${pg?esc(pg.name||''):''}" placeholder="T.ex. Standard, Jour, Övertid"></div>
      <div class="fg"><label>Timpris ex moms (kr/tim)</label>
        <input type="number" id="pg-rate" value="${pg?esc(pg.hourRate||0):0}" min="0"></div>
      <div class="fg"><label>Beskrivning</label>
        <input id="pg-desc" value="${pg?esc(pg.description||''):''}" placeholder="Valfri beskrivning"></div>`;
  },

  _profileFormHtml(pp) {
    const pgs = state.priceGroups || [];
    return `
      <div class="fg"><label>Namn <span style="color:var(--rd)">*</span></label>
        <input id="pp-name" value="${pp?esc(pp.name||''):''}" placeholder="T.ex. BRF, Privatkund"></div>
      <div class="fg"><label>Standard prisgrupp</label>
        <select id="pp-pg">
          <option value="">— Ingen —</option>
          ${pgs.map(g=>`<option value="${esc(g.id)}" ${pp&&pp.defaultPriceGroupId===g.id?'selected':''}>${esc(g.name)} (${fmt(g.hourRate)} kr/tim)</option>`).join('')}
        </select></div>
      <div class="fg"><label>Anteckningar</label>
        <textarea id="pp-notes" rows="2">${pp?esc(pp.notes||''):''}</textarea></div>`;
  },

  openCreate() {
    if (!Auth.require('article_manage')) return;
    Modal.open({
      title: 'Ny prisgrupp',
      body: this._formHtml(null),
      buttons: [
        { label: 'Skapa', cls: 'btn bp', onClick: () => PriceGroupsPage._save(null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('pg-name')?.focus(), 80);
  },

  openEdit(pgId) {
    const pg = (state.priceGroups||[]).find(x=>x.id===pgId);
    if (!pg) return;
    Modal.open({
      title: esc(pg.name),
      body: this._formHtml(pg),
      buttons: [
        { label: pg.active ? `${ic('eye-off',13)} Inaktivera` : `${ic('eye',13)} Aktivera`, cls: 'btn bw',
          onClick: () => { const idx=(state.priceGroups||[]).findIndex(x=>x.id===pgId); if(idx<0)return; state.priceGroups[idx].active=!state.priceGroups[idx].active; persist();Modal.close();PriceGroupsPage.render();showToast(state.priceGroups[idx].active?'Aktiverad':'Inaktiverad'); }},
        { label: 'Spara', cls: 'btn bp', onClick: () => PriceGroupsPage._save(pgId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  openCreateProfile() {
    if (!Auth.require('article_manage')) return;
    Modal.open({
      title: 'Ny prisprofil',
      body: this._profileFormHtml(null),
      buttons: [
        { label: 'Skapa', cls: 'btn bp', onClick: () => PriceGroupsPage._saveProfile(null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('pp-name')?.focus(), 80);
  },

  openEditProfile(ppId) {
    const pp = (state.priceProfiles||[]).find(x=>x.id===ppId);
    if (!pp) return;
    Modal.open({
      title: esc(pp.name),
      body: this._profileFormHtml(pp),
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => PriceGroupsPage._saveProfile(ppId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _save(pgId) {
    const name = document.getElementById('pg-name')?.value.trim();
    if (!name) { showToast('Namn krävs'); return; }
    const data = {
      name,
      hourRate: parseFloat(document.getElementById('pg-rate')?.value) || 0,
      description: document.getElementById('pg-desc')?.value.trim() || '',
      updatedAt: new Date().toISOString()
    };
    let savedId = pgId;
    if (!pgId) {
      state.priceGroups = state.priceGroups || [];
      savedId = newId(state.priceGroups,'PG');
      state.priceGroups.push({ ...data, id: savedId, active: true, createdAt: new Date().toISOString() });
    } else {
      const idx = (state.priceGroups||[]).findIndex(x=>x.id===pgId);
      if (idx < 0) return;
      state.priceGroups[idx] = { ...state.priceGroups[idx], ...data };
    }
    Modal.close(); this.render();
    return confirmPersist('priceGroups', savedId, { ok: pgId ? 'Prisgrupp uppdaterad' : `${name} skapad`, fail: 'Prisgruppen kunde inte sparas', onChange: () => this.render() });
  },

  _saveProfile(ppId) {
    const name = document.getElementById('pp-name')?.value.trim();
    if (!name) { showToast('Namn krävs'); return; }
    const data = {
      name,
      defaultPriceGroupId: document.getElementById('pp-pg')?.value || '',
      notes: document.getElementById('pp-notes')?.value.trim() || '',
      updatedAt: new Date().toISOString()
    };
    let savedId = ppId;
    state.priceProfiles = state.priceProfiles || [];
    if (!ppId) {
      const maxSort = state.priceProfiles.reduce((m,p)=>Math.max(m,p.sortOrder||0),0);
      savedId = newId(state.priceProfiles, 'PP');
      state.priceProfiles.push({ ...data, id: savedId, active: true, sortOrder: maxSort+10, createdAt: new Date().toISOString() });
    } else {
      const idx = state.priceProfiles.findIndex(x=>x.id===ppId);
      if (idx < 0) return;
      state.priceProfiles[idx] = { ...state.priceProfiles[idx], ...data };
    }
    Modal.close(); this.render();
    return confirmPersist('priceProfiles', savedId, { ok: ppId ? 'Prisprofil uppdaterad' : `${name} skapad`, fail: 'Prisprofilen kunde inte sparas', onChange: () => this.render() });
  }
};

/* ── Personal ─────────────────────────── */
const StaffPage = {
  _filter: 'aktiva',
  _q: '',

  /* V3 register (2026-11-26): tvåfasrendering som övriga register (sökfältet
     byts aldrig ut). F-19: "Inaktivera" stod som knapp på varje rad och
     pressade ihop namnen — åtgärden finns nu i radens "⋮"-meny (sist, röd,
     med bekräftelse) och som förut i redigeringsdialogen. */
  render() {
    const el = document.getElementById('pg-staff-content');
    if (!el) return;
    const canManage = Auth.can('staff_manage');
    el.innerHTML = `<div class="rg" data-rg="staff">
      ${RegisterUi.bar({
        id: 'staff-search', placeholder: 'Sök namn, titel, roll, telefon…', label: 'Sök personal (namn, titel, roll, telefon, e-post)', value: this._q,
        oninput: "StaffPage._q=this.value;RegisterUi.later('staff',function(){StaffPage.renderList()})",
        menu: [
          canManage ? { label: 'Importera', icon: 'upload', onclick: "Router.showPage('pg-import-wizard',{type:'staff'})" } : null,
          { label: 'Exportera', icon: 'download', onclick: "ImportExportService.showExportMenu('staff',this)" }
        ],
        primary: canManage ? { label: 'Ny personal', onclick: 'StaffPage.openCreate()' } : null
      })}
      <div class="rg-filters" id="staff-filters"></div>
      <div id="staff-list" class="rg-listwrap"></div>
    </div>`;
    this.renderList();
  },

  _clearSearch() {
    this._q = '';
    const i = document.getElementById('staff-search'); if (i) i.value = '';
    this.renderList();
  },

  renderList() {
    const el = document.getElementById('staff-list');
    if (!el) return;
    /* SPRINT1 §15: bara export i bulk. StaffPage._toggleActive() saknar
       skydd mot att inaktivera sig själv eller den sista superadmin-
       kontot — en bulk-variant av samma funktion skulle ärva den luckan
       och göra den mycket lättare att råka ut för. Ingen ny säkerhets-
       modell byggs i denna sprint, så bulk-inaktivering utelämnas
       medvetet tills den enskilda funktionen har motsvarande skydd. */
    SelectionModel.init('staff', { stateKey: 'staff', actions: [
      { id: 'export', label: 'Exportera', icon: 'download', type: 'export' }
    ] });
    const canManage = Auth.can('staff_manage');
    const all     = state.staff || [];
    const aktiva  = all.filter(s => s.active);
    const inaktiva = all.filter(s => !s.active);
    const base    = this._filter === 'aktiva' ? aktiva : inaktiva;
    const roleColor = (rid) => ({ admin:'bdg-red', chef:'bdg-orange', personal:'bdg-blue' }[rid] || 'bdg-grey');
    const roleLabel = (rid) => { const r = (state.roles||[]).find(x=>x.id===rid); return r ? r.label : (rid || '—'); };
    let list = base;
    if (this._q) {
      const q = this._q.toLowerCase();
      list = list.filter(s => [s.firstName, s.lastName, (s.firstName||'') + ' ' + (s.lastName||''), s.title, s.phone, s.email, s.username, roleLabel(s.role)]
        .some(v => String(v || '').toLowerCase().includes(q)));
    }
    const visibleIds = list.map(s => s.id);
    const selMode = SelectionModel.count() > 0;

    const fEl = document.getElementById('staff-filters');
    if (fEl) fEl.innerHTML = `<div class="ftabs rg-seg" role="group" aria-label="Status">
      ${[['aktiva','Aktiva',aktiva.length],['inaktiva','Inaktiva',inaktiva.length]].map(([k,l,n]) =>
        `<button type="button" class="ft ${this._filter===k?'on':''}" aria-pressed="${this._filter===k}" onclick="StaffPage._filter='${k}';StaffPage.renderList()">${l}<span class="ft-n">${n}</span></button>`).join('')}
    </div>`;

    const head = RegisterUi.count(list.length, base.length, 'person', 'personer', {
      clear: this._q ? 'StaffPage._clearSearch()' : '',
      selAll: list.length ? SelectionModel.selectAllHtml(visibleIds) : ''
    });
    if (list.length === 0) {
      el.innerHTML = this._q
        ? RegisterUi.empty({ icon: 'search', title: 'Inga träffar', text: 'Ingen personal matchar sökningen.', action: `<button type="button" class="btn bs bsm" onclick="StaffPage._clearSearch()">Rensa sökning</button>` })
        : this._filter === 'inaktiva'
          ? RegisterUi.empty({ icon: 'user-x', title: 'Ingen inaktiv personal', text: 'Personer som inaktiveras visas här och kan aktiveras igen.' })
          : RegisterUi.empty({ icon: 'users', title: 'Ingen aktiv personal', text: 'Lägg upp personal för att kunna tilldela arbetsorder och registrera tid.',
              action: canManage ? `<button type="button" class="btn bp bsm" onclick="StaffPage.openCreate()">${ic('plus',14)}<span>Ny personal</span></button>` : '' });
      return;
    }
    const rows = list.map(s => {
      const id = RegisterUi.arg(s.id);
      const name = ((s.firstName || '') + ' ' + (s.lastName || '')).trim() || s.username || '—';
      const selected = SelectionModel.isSelected(s.id);
      const role = roleLabel(s.role);
      const menu = canManage ? RegisterUi.menu(RegisterUi.domId('stm', s.id), 'Fler åtgärder för ' + name, [
        { label: 'Redigera', icon: 'pencil', onclick: `StaffPage.openEdit(${id})` },
        s.active
          ? { label: 'Inaktivera', icon: 'user-x', danger: true, sep: true, onclick: `StaffPage._confirmToggle(${id})` }
          : { label: 'Aktivera', icon: 'user-check', sep: true, onclick: `StaffPage._toggleActive(${id})` }
      ]) : '';
      return `<tr class="rg-row${selMode?' sel-mode':''}${selected?' selected':''}${s.active?'':' rg-row--off'}" data-sel-row-id="${esc(s.id)}"${canManage ? ' tabindex="0"' : ''}
          onclick="SelectionModel.rowClick(${id}, ${canManage ? `function(){ StaffPage.openEdit(${id}); }` : 'null'})"
          ${canManage ? `onkeydown="if(event.key==='Enter'&&event.target===this){StaffPage.openEdit(${id})}"` : ''}>
        <td class="rg-c-sel">${SelectionModel.checkboxHtml(s.id, name)}</td>
        <td class="rg-c-main">
          <div class="rg-person">${UiKit.avatar(s, 32)}<div class="rg-person-t">
            <div class="rg-title" title="${esc(name)}">${esc(name)}</div>
            <div class="rg-msub">${esc([s.title, role].filter(Boolean).join(' · '))}</div>
            ${s.phone ? `<div class="rg-msub">${esc(s.phone)}</div>` : ''}
          </div></div>
        </td>
        <td class="rg-c-x rg-h-md" title="${esc(s.title || '')}">${s.title ? esc(s.title) : '<span class="rg-none">Ingen titel</span>'}</td>
        <td class="rg-c-x"><span class="bdg ${roleColor(s.role)}" title="${esc(role)}">${esc(role)}</span></td>
        <td class="rg-c-x rg-num">${s.phone ? esc(s.phone) : '<span class="rg-none">—</span>'}</td>
        <td class="rg-c-x rg-h-xl" title="${esc(s.email || '')}">${s.email ? esc(s.email) : '<span class="rg-none">—</span>'}</td>
        <td class="rg-c-x">${RegisterUi.status(!!s.active, 'Aktiv', 'Inaktiv')}</td>
        <td class="rg-c-end">${menu}${canManage ? RegisterUi.openBtn(`StaffPage.openEdit(${id})`, 'Öppna ' + name, menu ? 'rg-d-only' : '') : ''}</td>
      </tr>`;
    }).join('');
    el.innerHTML = `<div class="dt-wrap rg-wrap">${head}
      <div class="dt-scroll"><table class="dtab rg-tbl${selMode?' sel-mode':''}">
        <thead><tr>
          <th class="rg-w-sel"><span class="sr-only">Markera</span></th>
          <th>Namn</th>
          <th class="rg-w-m rg-h-md">Titel</th>
          <th class="rg-w-m">Roll</th>
          <th class="rg-w-s">Telefon</th>
          <th class="rg-w-l rg-h-xl">E-post</th>
          <th class="rg-w-xs">Status</th>
          <th class="rg-w-end2"><span class="sr-only">Åtgärder</span></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
  },

  /* Inaktivering från radens meny kräver bekräftelse (V3-KOMPONENTSTANDARD §3).
     Själva ändringen är oförändrad: _toggleActive(). */
  _confirmToggle(staffId) {
    if (!Auth.require('staff_manage')) return;
    const s = (state.staff || []).find(x => x.id === staffId);
    if (!s) return;
    const name = ((s.firstName || '') + ' ' + (s.lastName || '')).trim() || s.username || 'personen';
    Modal.open({
      title: `${ic('user-x',16)} Inaktivera ${esc(name)}?`,
      body: `<p style="font-size:14px;line-height:1.5;color:var(--ink-2);margin:0;">${esc(name)} flyttas till fliken Inaktiva. Du kan aktivera personen igen när som helst.</p>`,
      buttons: [
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() },
        { label: `${ic('user-x',14)} Inaktivera`, cls: 'btn bd', onClick: () => StaffPage._toggleActive(staffId) }
      ]
    });
  },

  _formHtml(s) {
    const allRoles = state.roles || [];
    const activeRoles = allRoles.filter(r => r.active !== false);
    const fallbackRoles = [
      { id:'personal', label:'Tekniker / Personal', description:'', active:true },
      { id:'chef',     label:'Chef / Projektledare', description:'', active:true },
      { id:'admin',    label:'Admin', description:'', active:true }
    ];
    const displayRoles = activeRoles.length ? activeRoles : fallbackRoles;
    const activeTitles = (state.titles||[]).filter(t => t.active !== false);
    return `
      <div class="g2">
        <div class="fg"><label>Förnamn <span style="color:var(--rd)">*</span></label>
          <input id="sf-first" value="${s?esc(s.firstName):''}" placeholder="Förnamn" autocomplete="off"></div>
        <div class="fg"><label>Efternamn <span style="color:var(--rd)">*</span></label>
          <input id="sf-last" value="${s?esc(s.lastName):''}" placeholder="Efternamn" autocomplete="off"></div>
      </div>
      <div class="fg"><label>Titel / yrkesroll</label>
        ${activeTitles.length > 0 ? `
          <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
            <div id="sf-title-display" style="flex:1;">
              ${s && s.title
                ? `<span class="chip on">${esc(s.title)}</span>`
                : '<span style="font-size:12px;color:var(--mt);">Ingen titel vald</span>'}
            </div>
            <button type="button" class="btn bs bsm" onclick="StaffPage._openTitlePicker()">
              ${ic('list',13)} Välj titel
            </button>
          </div>
          <input type="hidden" id="sf-title" value="${s?esc(s.title||''):''}">
          ${s && s.title && !activeTitles.some(t => t.name === s.title)
            ? `<div class="nbox" style="margin-top:4px;font-size:11px;">⚠ "${esc(s.title)}" finns inte bland aktiva titlar</div>`
            : ''}` :
          `<div class="nbox" style="font-size:12px;">Inga aktiva titlar. <button type="button" class="btn bghost bxs" style="margin-left:4px;" onclick="Modal.close();Router.showPage('pg-admin')">Gå till Admin ${ic('arrow-right',10)}</button></div>
          <input type="hidden" id="sf-title" value="${s?esc(s.title||''):''}">`
        }</div>
      <div class="g2">
        <div class="fg"><label>Telefon</label>
          <input id="sf-phone" value="${s?esc(s.phone||''):''}" placeholder="070-XXX XX XX" type="tel"></div>
        <div class="fg"><label>E-post</label>
          <input id="sf-email" value="${s?esc(s.email||''):''}" placeholder="namn@vift.se" type="email"></div>
      </div>
      <div style="border-top:1px solid var(--br);margin:4px 0;"></div>
      <div class="fg"><label>Användarnamn <span style="color:var(--rd)">*</span></label>
        <input id="sf-uname" value="${s?esc(s.username||''):''}" placeholder="användarnamn" autocomplete="off"></div>
      <div class="fg"><label>Roll / behörighet</label>
        <input type="hidden" id="sf-role" value="${s?esc(s.role||'personal'):'personal'}">
        <div style="display:flex;flex-direction:column;gap:5px;margin-top:4px;">
          ${displayRoles.map(r => {
            const isSel = s ? s.role === r.id : r.id === 'personal';
            return `<div onclick="StaffPage._selectRole('${r.id}')" id="sf-role-opt-${r.id}"
              style="display:flex;align-items:center;gap:10px;padding:9px 12px;border:1.5px solid ${isSel?'var(--sky)':'var(--br)'};border-radius:var(--rs);cursor:pointer;transition:border-color .1s;">
              <div id="sf-role-dot-${r.id}" style="width:16px;height:16px;border-radius:50%;border:2px solid ${isSel?'var(--navy)':'var(--br)'};background:${isSel?'var(--navy)':'transparent'};flex-shrink:0;transition:all .1s;"></div>
              <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:700;">${esc(r.label)}</div>
                ${r.description?`<div style="font-size:11px;color:var(--mt);">${esc(r.description)}</div>`:''}
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div class="nbox" style="font-size:11px;color:var(--mt);">
        ${ic('lock',11)} Inloggning hanteras via Supabase Auth. ${s ? 'Lösenord ändras i Supabase Dashboard.' : 'Skapa inloggningskonto i Supabase Dashboard efter att personposten sparats.'}
      </div>`;
  },

  _openTitlePicker() {
    const titles = (state.titles || []).filter(t => t.active !== false);
    if (titles.length === 0) { showToast('Inga aktiva titlar. Gå till Admin → Titlar.'); return; }
    Modal.open({
      title: 'Välj titel',
      body: `
        <div class="fg" style="margin-bottom:8px;">
          <input id="tp-search" placeholder="Sök titel…" autocomplete="off"
            oninput="document.getElementById('tp-list').innerHTML=StaffPage._titlePickerItems(this.value)">
        </div>
        <div id="tp-list" style="max-height:280px;overflow-y:auto;">
          ${this._titlePickerItems('')}
        </div>`,
      buttons: [
        { label: 'Rensa val', cls: 'btn bw', onClick: () => StaffPage._selectTitleFromPicker('') },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('tp-search')?.focus(), 80);
  },

  _titlePickerItems(q) {
    const titles = (state.titles || []).filter(t => t.active !== false);
    const cur = document.getElementById('sf-title')?.value || '';
    const filtered = q ? titles.filter(t => t.name.toLowerCase().includes(q.toLowerCase())) : titles;
    if (!filtered.length) return '<p style="font-size:12px;color:var(--mt);padding:8px 0;">Inga aktiva titlar matchar</p>';
    return filtered.map(t => {
      const isSel = cur === t.name;
      const usageCount = (state.staff||[]).filter(s => s.title === t.name).length;
      return `<div class="crow" onclick="StaffPage._selectTitleFromPicker(${RegisterUi.arg(t.name)})"
        style="${isSel?'background:var(--navy10,#eef2ff);':''};cursor:pointer;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;">${esc(t.name)}</div>
          ${t.description ? `<div style="font-size:11px;color:var(--mt);">${esc(t.description)}</div>` : ''}
          ${usageCount > 0 ? `<div style="font-size:10px;color:var(--sky);">${usageCount} person${usageCount===1?'':'er'}</div>` : ''}
        </div>
        ${isSel ? `<span style="color:var(--grn);">${ic('check-circle',16)}</span>` : ''}
      </div>`;
    }).join('');
  },

  _selectTitleFromPicker(title) {
    const inp = document.getElementById('sf-title');
    if (inp) inp.value = title;
    const display = document.getElementById('sf-title-display');
    if (display) {
      display.innerHTML = title
        ? `<span class="chip on">${esc(title)}</span>`
        : '<span style="font-size:12px;color:var(--mt);">Ingen titel vald</span>';
    }
    Modal.close();
  },

  _selectRole(roleId) {
    document.getElementById('sf-role').value = roleId;
    const roles = (state.roles && state.roles.length
      ? state.roles.filter(r => r.active !== false)
      : [{ id:'personal' }, { id:'chef' }, { id:'admin' }]);
    roles.forEach(r => {
      const opt = document.getElementById('sf-role-opt-' + r.id);
      const dot = document.getElementById('sf-role-dot-' + r.id);
      const isSel = r.id === roleId;
      if (opt) opt.style.borderColor = isSel ? 'var(--sky)' : 'var(--br)';
      if (dot) {
        dot.style.borderColor = isSel ? 'var(--navy)' : 'var(--br)';
        dot.style.background  = isSel ? 'var(--navy)' : 'transparent';
      }
    });
  },

  openCreate() {
    if (!Auth.require('staff_manage')) return;
    Modal.open({
      title: 'Ny personal',
      body: this._formHtml(null),
      buttons: [
        { label: 'Skapa', cls: 'btn bp', onClick: () => StaffPage._save(null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => { document.getElementById('sf-first')?.focus(); }, 80);
  },

  openEdit(staffId) {
    if (!Auth.require('staff_manage')) return;
    const s = (state.staff||[]).find(x => x.id === staffId);
    if (!s) return;
    Modal.open({
      title: `${esc(s.firstName)} ${esc(s.lastName)}`,
      wide: true,
      body: this._formHtml(s),
      buttons: [
        { label: s.active ? `${ic('user-x',13)} Inaktivera` : `${ic('user-check',13)} Aktivera`,
          cls: s.active ? 'btn bw' : 'btn bsu',
          onClick: () => StaffPage._toggleActive(staffId) },
        { label: 'Spara', cls: 'btn bp', onClick: () => StaffPage._save(staffId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => { document.getElementById('sf-first')?.focus(); }, 80);
  },

  _save(staffId) {
    const first = document.getElementById('sf-first')?.value.trim();
    const last  = document.getElementById('sf-last')?.value.trim();
    const uname = document.getElementById('sf-uname')?.value.trim();
    if (!first || !last) { showToast('Förnamn och efternamn krävs'); return; }
    if (!uname)          { showToast('Användarnamn krävs'); return; }

    const data = {
      firstName: first, lastName: last,
      title:  document.getElementById('sf-title')?.value.trim() || '',
      phone:  document.getElementById('sf-phone')?.value.trim() || '',
      email:  document.getElementById('sf-email')?.value.trim() || '',
      username: uname,
      role: document.getElementById('sf-role')?.value || 'personal',
      updatedAt: new Date().toISOString()
    };

    /* E2E 2026-11-23: roll/behörighet är säkerhetsrelevant — "Sparat"
       visas först när servern bekräftat (commitElementChange i state.js),
       annars rollback och tydligt fel. */
    if (!staffId) {
      if ((state.staff||[]).find(s => s.username === uname)) { showToast('Användarnamnet används redan'); return; }
      const nid = newId(state.staff||[], 'ST');
      Modal.close();
      return commitElementChange('staff', nid, () => {
        state.staff.push({ ...data, id: nid, permissions: [], active: true, createdAt: new Date().toISOString() });
      }, { onChange: () => this.render(), ok: `${first} ${last} skapad — kom ihåg att skapa inloggningskonto i Supabase Dashboard`,
           fail: `${first} ${last} kunde inte skapas` });
    }
    const idx = (state.staff||[]).findIndex(s => s.id === staffId);
    if (idx < 0) return;
    if ((state.staff||[]).find(s => s.username === uname && s.id !== staffId)) { showToast('Användarnamnet används redan'); return; }
    const _cu = Auth.getUser();
    const isSelf = !!(_cu && _cu.id === staffId);
    const changedName = data.firstName + ' ' + data.lastName;
    Modal.close();
    return commitElementChange('staff', staffId, () => {
      const i = (state.staff||[]).findIndex(s => s.id === staffId);
      if (i < 0) return false;
      state.staff[i] = { ...state.staff[i], ...data };
    }, {
      onChange: () => this.render(),
      onSaved: () => {
        if (!isSelf) return;
        // Redigerar sig själv — uppdatera currentUser och re-rendera sidebar direkt
        state.currentUser = { ..._cu, firstName: data.firstName, lastName: data.lastName, role: data.role, username: data.username, title: data.title };
        /* T3-A: samma väg som indragna behörigheter (otillåten sida lämnas). */
        if (Auth.applyAuthorizationChange) Auth.applyAuthorizationChange('local'); else Auth._resolveUser();
        Sidebar.render();
      },
      ok: isSelf ? 'Sparat — dina behörigheter uppdaterade omedelbart' : 'Sparat — ' + changedName + ' ser nya behörigheter vid nästa inloggning',
      fail: 'Ändringen för ' + changedName + ' kunde inte sparas'
    });
  },

  _toggleActive(staffId) {
    /* V3 register: samma behörighet som redigeringen (openEdit) — anropet
       nås nu från radmenyn och ska inte kunna köras utan staff_manage. */
    if (!Auth.require('staff_manage')) return;
    const idx = (state.staff||[]).findIndex(s => s.id === staffId);
    if (idx < 0) return;
    state.staff[idx] = { ...state.staff[idx], active: !state.staff[idx].active, updatedAt: new Date().toISOString() };
    persist(); Modal.close();
    const nm = ((state.staff[idx].firstName || '') + ' ' + (state.staff[idx].lastName || '')).trim();
    const word = state.staff[idx].active ? 'aktiverad' : 'inaktiverad';
    showToast(nm ? nm + ' ' + word : word.charAt(0).toUpperCase() + word.slice(1));
    this.render();
  }
};

/* ── Offerttjänster & Prismodeller ─── */
const ServiceTemplatesPage = {
  _q: '',
  _filter: 'alla',
  _editSvcId: null,
  _editTiers: [],
  _editOptions: [],
  _testFields: {},
  _testReduction: 'ingen',

  /* V3 register (2026-11-26): sidrubriken upprepas inte (toppraden visar
     den); tvåfasrendering — sökningen byter aldrig ut sökfältet (förut
     renderades hela sidan om på varje tangenttryck och fältet tappade
     fokus). F-20: de fyra ikonknapparna per rad (Testkalkyl, Duplicera,
     Aktivera/Inaktivera, Redigera) ligger i radens "⋮"-meny med text;
     klick på raden öppnar redigeringen. Inga funktioner har tagits bort. */
  render() {
    const el = document.getElementById('pg-service-templates-content');
    if (!el) return;
    el.innerHTML = `<div class="rg" data-rg="services">
      ${RegisterUi.bar({
        id: 'svc-search', placeholder: 'Sök tjänst eller kategori…', label: 'Sök offerttjänst', value: this._q,
        oninput: "ServiceTemplatesPage._q=this.value;RegisterUi.later('svc',function(){ServiceTemplatesPage.renderList()})",
        primary: { label: 'Ny tjänst', onclick: 'ServiceTemplatesPage.openCreate()' }
      })}
      <div class="rg-filters" id="svc-filters"></div>
      <div id="svc-list" class="rg-listwrap"></div>
    </div>`;
    this.renderList();
  },

  _clearSearch() {
    this._q = '';
    const i = document.getElementById('svc-search'); if (i) i.value = '';
    this.renderList();
  },

  renderList() {
    const el = document.getElementById('svc-list');
    if (!el) return;
    const all = ServiceTemplateService.getAll().slice().sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0));
    const nAktiva   = all.filter(s=>s.active!==false).length;
    const nInaktiva = all.filter(s=>s.active===false).length;
    const base = all.filter(s => !(this._filter === 'aktiva' && s.active === false) && !(this._filter === 'inaktiva' && s.active !== false));
    const q = (this._q||'').toLowerCase();
    const filtered = q ? base.filter(s => (s.name||'').toLowerCase().includes(q) || (s.category||'').toLowerCase().includes(q)) : base;

    const fEl = document.getElementById('svc-filters');
    if (fEl) fEl.innerHTML = `<div class="ftabs rg-seg" role="group" aria-label="Status">
      ${[['alla','Alla',all.length],['aktiva','Aktiva',nAktiva],['inaktiva','Inaktiva',nInaktiva]].map(([v,l,n]) =>
        `<button type="button" class="ft ${this._filter===v?'on':''}" aria-pressed="${this._filter===v}" onclick="ServiceTemplatesPage._filter='${v}';ServiceTemplatesPage.renderList()">${l}<span class="ft-n">${n}</span></button>`).join('')}
    </div>`;

    const head = RegisterUi.count(filtered.length, base.length, 'tjänst', 'tjänster', { clear: q ? 'ServiceTemplatesPage._clearSearch()' : '' });
    if (filtered.length === 0) {
      el.innerHTML = q
        ? RegisterUi.empty({ icon: 'search', title: 'Inga träffar', text: 'Inga tjänster matchar sökningen.', action: `<button type="button" class="btn bs bsm" onclick="ServiceTemplatesPage._clearSearch()">Rensa sökning</button>` })
        : this._filter === 'inaktiva'
          ? RegisterUi.empty({ icon: 'eye-off', title: 'Inga inaktiva tjänster', text: 'Inaktiverade tjänster visas inte i offertguiden men finns kvar här.' })
          : RegisterUi.empty({ icon: 'zap', title: 'Inga offerttjänster ännu', text: 'En offerttjänst är en mall med prismodell och offerttexter som används i offertguiden.',
              action: `<button type="button" class="btn bp bsm" onclick="ServiceTemplatesPage.openCreate()">${ic('plus',14)}<span>Ny tjänst</span></button>` });
      return;
    }
    const rows = filtered.map(s => {
      const id = RegisterUi.arg(s.id);
      const on = s.active !== false;
      const model = ServiceTemplateService.modelLabel(s.pricingModel);
      const min = `${fmt(s.minChargeExVat||0)} kr`;
      const menu = RegisterUi.menu(RegisterUi.domId('svcm', s.id), 'Fler åtgärder för ' + (s.name || 'tjänsten'), [
        { label: 'Redigera', icon: 'pencil', onclick: `ServiceTemplatesPage.openEdit(${id})` },
        { label: 'Testkalkyl', icon: 'calculator', onclick: `ServiceTemplatesPage.openTest(${id})` },
        { label: 'Duplicera', icon: 'copy', onclick: `ServiceTemplatesPage.duplicate(${id})` },
        on
          ? { label: 'Inaktivera', icon: 'eye-off', danger: true, sep: true, onclick: `ServiceTemplatesPage._confirmDeactivate(${id})` }
          : { label: 'Aktivera', icon: 'eye', sep: true, onclick: `ServiceTemplatesPage.toggleActive(${id})` }
      ]);
      return `<tr class="rg-row${on ? '' : ' rg-row--off'}" tabindex="0" onclick="ServiceTemplatesPage.openEdit(${id})"
          onkeydown="if(event.key==='Enter'&&event.target===this){ServiceTemplatesPage.openEdit(${id})}">
        <td class="rg-c-main">
          <div class="rg-person"><span class="rg-svc-ico${on ? '' : ' is-off'}" aria-hidden="true">${ic(s.icon||'zap',16)}</span><div class="rg-person-t">
            <div class="rg-title" title="${esc(s.name)}">${esc(s.name || '—')}</div>
            <div class="rg-sub">${esc(s.category || 'Ingen kategori')}</div>
            <div class="rg-msub">${esc(model)} · min ${min} exkl. moms</div>
          </div></div>
        </td>
        <td class="rg-c-x" title="${esc(model)}">${esc(model)}</td>
        <td class="rg-c-x c-num"><span class="rg-price">${min}</span></td>
        <td class="rg-c-x">${RegisterUi.status(on, 'Aktiv', 'Inaktiv')}</td>
        <td class="rg-c-end">
          ${on ? '' : `<span class="bdg bdg-grey rg-m-only">Inaktiv</span>`}
          ${menu}${RegisterUi.openBtn(`ServiceTemplatesPage.openEdit(${id})`, 'Redigera ' + (s.name || 'tjänst'), 'rg-d-only')}
        </td>
      </tr>`;
    }).join('');
    el.innerHTML = `<div class="dt-wrap rg-wrap">${head}
      <div class="dt-scroll"><table class="dtab rg-tbl rg-tbl--nosel">
        <thead><tr>
          <th>Tjänst</th>
          <th class="rg-w-l">Prismodell</th>
          <th class="rg-w-p c-num">Minsta debitering exkl. moms</th>
          <th class="rg-w-xs">Status</th>
          <th class="rg-w-end2"><span class="sr-only">Åtgärder</span></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
  },

  /* Inaktivering från radens meny kräver bekräftelse (V3-KOMPONENTSTANDARD §3).
     Själva ändringen är oförändrad: toggleActive(). */
  _confirmDeactivate(id) {
    const svc = ServiceTemplateService.get(id);
    if (!svc) return;
    Modal.open({
      title: `${ic('eye-off',16)} Inaktivera ${esc(svc.name || 'tjänsten')}?`,
      body: `<p style="font-size:14px;line-height:1.5;color:var(--ink-2);margin:0;">Tjänsten visas inte längre i offertguiden. Du kan aktivera den igen när som helst.</p>`,
      buttons: [
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() },
        { label: `${ic('eye-off',14)} Inaktivera`, cls: 'btn bd', onClick: () => { Modal.close(); ServiceTemplatesPage.toggleActive(id); } }
      ]
    });
  },

  openCreate() {
    const newSvc = ServiceTemplateService.create({
      name:'Ny tjänst', icon:'zap', category:'Övrigt',
      pricingModel:'fixed', qtyField:'qty', basePricePerUnit:0,
      defaultDescription:'', includes:[], excludes:[]
    });
    this.openEdit(newSvc.id);
  },

  openEdit(id) {
    const svc = ServiceTemplateService.get(id);
    if (!svc) return;
    this._editSvcId = id;
    this._editTiers   = JSON.parse(JSON.stringify(svc.tiers || []));
    this._editOptions = JSON.parse(JSON.stringify(svc.options || []));
    this._testFields  = {};
    this._testReduction = svc.defaultReduction || 'ingen';
    Modal.open({
      title: `${ic('settings',14)} Redigera: ${esc(svc.name)}`,
      body: this._editBody(svc),
      wide: true,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => this._save() },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => { Modal.close(); this.render(); } }
      ]
    });
    setTimeout(() => this._initEditChips(), 30);
  },

  _editBody(svc) {
    const modelOpts = ['tiered_unit','factor_unit','factor_lm','hourly','monthly','hourly_custom','fixed'];
    const icons = ['zap','refresh-cw','layers','scissors','building-2','wrench','settings','activity','sparkles','leaf','droplets','truck','home','tool','star'];
    const reducts = [{v:'ingen',l:'Ingen'},{v:'rut',l:'RUT 50%'},{v:'rot',l:'ROT 30%'}];
    return `
      <!-- Grundinfo -->
      <div style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Grundinfo</div>
      <div class="g2" style="margin-bottom:8px;">
        <div class="fg"><label>Namn <span style="color:var(--rd)">*</span></label>
          <input id="svc-ed-name" value="${esc(svc.name)}"></div>
        <div class="fg"><label>Kategori</label>
          <input id="svc-ed-cat" value="${esc(svc.category||'')}" placeholder="T.ex. Tvätt & rengöring"></div>
      </div>
      <div class="g2" style="margin-bottom:8px;">
        <div class="fg"><label>Ikon</label>
          <select id="svc-ed-icon">
            ${icons.map(i=>`<option value="${i}" ${svc.icon===i?'selected':''}>${i}</option>`).join('')}
          </select></div>
        <div class="fg"><label>Enhet (t.ex. m², lm, tim)</label>
          <input id="svc-ed-unit" value="${esc(svc.unit||'st')}"></div>
      </div>
      <div class="g2" style="margin-bottom:8px;">
        <div class="fg"><label>Moms %</label>
          <input id="svc-ed-vat" type="number" value="${_normVat(svc.vatRate)}" min="0" max="100"></div>
        <div class="fg"><label>Minimidebitering ex moms</label>
          <input id="svc-ed-mincharge" type="number" value="${svc.minChargeExVat||0}" min="0"></div>
      </div>
      <div class="g2" style="margin-bottom:8px;">
        <div class="fg"><label>Standard skattereduktion</label>
          <select id="svc-ed-red">
            ${reducts.map(r=>`<option value="${r.v}" ${svc.defaultReduction===r.v?'selected':''}>${r.l}</option>`).join('')}
          </select></div>
        <div class="fg"><label>Sorteringsordning</label>
          <input id="svc-ed-sort" type="number" value="${svc.sortOrder||0}" min="0" step="5"></div>
      </div>
      <div class="fg" style="margin-bottom:12px;">
        <label><input type="checkbox" id="svc-ed-active" ${svc.active!==false?'checked':''}> Aktiv (visas i offertwizard)</label>
      </div>

      <!-- Prismodell -->
      <div style="border-top:1px solid var(--br);padding-top:12px;margin-bottom:8px;">
        <div style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Prismodell</div>
        <div class="fg" style="margin-bottom:8px;"><label>Modelltyp</label>
          <select id="svc-ed-model" onchange="ServiceTemplatesPage._onModelChange()">
            ${modelOpts.map(m=>`<option value="${m}" ${svc.pricingModel===m?'selected':''}>${ServiceTemplateService.modelLabel(m)}</option>`).join('')}
          </select></div>
        <div id="svc-ed-model-fields">${this._modelFields(svc)}</div>
      </div>

      <!-- Tillval -->
      <div style="border-top:1px solid var(--br);padding-top:12px;margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;">Tillval / Tillägg</div>
          <button type="button" class="btn bsu bxs" onclick="ServiceTemplatesPage._addOption()">${ic('plus',11)} Lägg till</button>
        </div>
        <div id="svc-ed-options">${this._optionsHtml()}</div>
      </div>

      <!-- Texter -->
      <div style="border-top:1px solid var(--br);padding-top:12px;margin-bottom:8px;">
        <div style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Offerttexter</div>
        <div class="fg" style="margin-bottom:8px;"><label>Standardbeskrivning</label>
          <textarea id="svc-ed-desc" rows="2" style="resize:vertical;">${esc(svc.defaultDescription||'')}</textarea></div>
        <div class="fg" style="margin-bottom:8px;"><label>Vad ingår (en per rad)</label>
          <textarea id="svc-ed-includes" rows="3" style="resize:vertical;">${esc((svc.includes||[]).join('\n'))}</textarea></div>
        <div class="fg" style="margin-bottom:8px;"><label>Vad ingår ej (en per rad)</label>
          <textarea id="svc-ed-excludes" rows="3" style="resize:vertical;">${esc((svc.excludes||[]).join('\n'))}</textarea></div>
        <div class="fg"><label>Intern kalkylnotis</label>
          <input id="svc-ed-note" value="${esc(svc.internalNote||'')}"></div>
      </div>

      <!-- Testkalkyl -->
      <div style="border-top:1px solid var(--br);padding-top:12px;">
        <div style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">${ic('calculator',11)} Testkalkyl</div>
        <div id="svc-test-area" style="background:var(--bg);border:1px solid var(--br);border-radius:var(--rs);padding:12px;font-size:12px;color:var(--mt);">
          Spara tjänsten och använd testkalkyl via listan.
        </div>
      </div>`;
  },

  _modelFields(svc) {
    const model = svc.pricingModel || 'fixed';
    if (model === 'tiered_unit') {
      return `<div style="margin-bottom:6px;"><label style="font-size:10px;font-weight:700;color:var(--mt);">Prisstegar (ex moms per enhet)</label>
        <div id="svc-ed-tiers">${this._tiersHtml()}</div>
        <button type="button" class="btn bsu bxs" style="margin-top:4px;" onclick="ServiceTemplatesPage._addTier()">${ic('plus',11)} Lägg till steg</button>
      </div>`;
    }
    if (model === 'factor_unit' || model === 'factor_lm') {
      const unitLabel = model === 'factor_lm' ? 'lm' : svc.unit || 'enhet';
      return `<div class="g2" style="margin-bottom:8px;">
        <div class="fg"><label>Baspris ex moms (kr/${unitLabel})</label>
          <input id="svc-ed-base" type="number" value="${svc.basePricePerUnit||0}" min="0"></div>
        <div class="fg"><label>Primärt mängdfält (t.ex. area, length)</label>
          <input id="svc-ed-qtyfield" value="${esc(svc.qtyField||'area')}"></div>
      </div>
      <div style="font-size:11px;color:var(--mt);">Faktorer redigeras i nästa version. Nuvarande faktorer behålls.</div>`;
    }
    if (model === 'hourly') {
      return `<div class="g2" style="margin-bottom:8px;">
        <div class="fg"><label>Standardtimpris ex moms (kr)</label>
          <input id="svc-ed-base" type="number" value="${svc.basePricePerUnit||695}" min="0"></div>
        <div class="fg"><label>Mängdfält</label>
          <input id="svc-ed-qtyfield" value="${esc(svc.qtyField||'hours')}"></div>
      </div>`;
    }
    if (model === 'monthly') {
      return `<div class="fg" style="margin-bottom:8px;"><label>Mängdfält (antal månader)</label>
        <input id="svc-ed-qtyfield" value="${esc(svc.qtyField||'months')}"></div>`;
    }
    if (model === 'hourly_custom') {
      return `<div class="g2" style="margin-bottom:8px;">
        <div class="fg"><label>Standardtimpris ex moms (kr)</label>
          <input id="svc-ed-base" type="number" value="${svc.basePricePerUnit||695}" min="0"></div>
        <div class="fg"><label>Mängdfält</label>
          <input id="svc-ed-qtyfield" value="${esc(svc.qtyField||'qty')}"></div>
      </div>`;
    }
    return `<div class="fg" style="margin-bottom:8px;"><label>Fastpris ex moms (kr)</label>
      <input id="svc-ed-base" type="number" value="${svc.basePricePerUnit||0}" min="0"></div>`;
  },

  _tiersHtml() {
    if (!this._editTiers.length) return '<div style="font-size:11px;color:var(--mt);padding:6px 0;">Inga steg tillagda.</div>';
    return this._editTiers.map((t,i) => `
      <div style="display:flex;gap:4px;align-items:center;margin-bottom:4px;">
        <div class="fg" style="flex:1;margin:0;"><input type="number" placeholder="Från (m²)" value="${t.from}" min="0"
          oninput="ServiceTemplatesPage._editTiers[${i}].from=parseFloat(this.value)||0"></div>
        <div class="fg" style="flex:1;margin:0;"><input type="number" placeholder="Till (tom=∞)" value="${t.to===null?'':t.to}" min="0"
          oninput="ServiceTemplatesPage._editTiers[${i}].to=this.value===''?null:(parseFloat(this.value)||0)"></div>
        <div class="fg" style="flex:1;margin:0;"><input type="number" placeholder="kr/enhet" value="${t.priceExVat}" min="0"
          oninput="ServiceTemplatesPage._editTiers[${i}].priceExVat=parseFloat(this.value)||0"></div>
        <button type="button" class="btn bd bxs" onclick="ServiceTemplatesPage._removeTier(${i})">${ic('x',11)}</button>
      </div>`).join('');
  },

  _addTier() {
    const last = this._editTiers[this._editTiers.length-1];
    const from = last ? (last.to !== null ? last.to + 1 : 0) : 0;
    this._editTiers.push({from, to:null, priceExVat:0});
    const el = document.getElementById('svc-ed-tiers');
    if (el) el.innerHTML = this._tiersHtml();
  },

  _removeTier(i) {
    this._editTiers.splice(i,1);
    const el = document.getElementById('svc-ed-tiers');
    if (el) el.innerHTML = this._tiersHtml();
  },

  _optionsHtml() {
    if (!this._editOptions.length) return '<div style="font-size:11px;color:var(--mt);padding:6px 0;">Inga tillval tillagda.</div>';
    return this._editOptions.map((o,i) => `
      <div style="display:flex;gap:4px;align-items:center;margin-bottom:4px;">
        <div class="fg" style="flex:2;margin:0;"><input placeholder="Namn" value="${esc(o.name||'')}"
          oninput="ServiceTemplatesPage._editOptions[${i}].name=this.value"></div>
        <div style="flex:1;min-width:0;">
          <select oninput="ServiceTemplatesPage._editOptions[${i}].type=this.value" style="width:100%;padding:6px 8px;border:1px solid var(--br);border-radius:var(--rs);font-size:12px;">
            <option value="fixed" ${o.type==='fixed'?'selected':''}>Fastpris</option>
            <option value="per_unit" ${o.type==='per_unit'?'selected':''}>Per enhet</option>
          </select>
        </div>
        <div class="fg" style="flex:1;margin:0;"><input type="number" placeholder="Pris ex moms" value="${o.priceExVat||0}" min="0"
          oninput="ServiceTemplatesPage._editOptions[${i}].priceExVat=parseFloat(this.value)||0"></div>
        <button type="button" class="btn bd bxs" onclick="ServiceTemplatesPage._removeOption(${i})">${ic('x',11)}</button>
      </div>`).join('');
  },

  _addOption() {
    this._editOptions.push({id:'opt_'+Date.now(), name:'', type:'fixed', priceExVat:0});
    const el = document.getElementById('svc-ed-options');
    if (el) el.innerHTML = this._optionsHtml();
  },

  _removeOption(i) {
    this._editOptions.splice(i,1);
    const el = document.getElementById('svc-ed-options');
    if (el) el.innerHTML = this._optionsHtml();
  },

  _onModelChange() {
    const model = document.getElementById('svc-ed-model')?.value || 'fixed';
    const svcId = this._editSvcId;
    const svc = ServiceTemplateService.get(svcId) || {};
    const mockSvc = {...svc, pricingModel: model};
    const el = document.getElementById('svc-ed-model-fields');
    if (el) el.innerHTML = this._modelFields(mockSvc);
    if (model === 'tiered_unit') {
      const tel = document.getElementById('svc-ed-tiers');
      if (tel) tel.innerHTML = this._tiersHtml();
    }
  },

  _initEditChips() {
    // Nothing complex needed — chips are rendered by _modelFields inline
  },

  _save() {
    const id   = this._editSvcId;
    const name = document.getElementById('svc-ed-name')?.value?.trim();
    if (!name) { showToast('Ange ett namn'); return; }
    /* V39 §2: strikt write-validering — svc-ed-vat är ett fritt
       number-input (min/max är bara UI-hintar, inte en verklig spärr).
       Ett ogiltigt värde (-1/101/500/NaN/Infinity/tomt) blockerar hela
       sparningen istället för att tystas till 25 %. */
    const vatCheck = _strictVat(document.getElementById('svc-ed-vat')?.value);
    if (!vatCheck.ok) { showToast(vatCheck.error); return; }
    const model  = document.getElementById('svc-ed-model')?.value || 'fixed';
    const base   = parseFloat(document.getElementById('svc-ed-base')?.value || 0) || 0;
    const qtyFld = document.getElementById('svc-ed-qtyfield')?.value?.trim() || 'qty';
    const changes = {
      name,
      category:           (document.getElementById('svc-ed-cat')?.value  || '').trim(),
      icon:               document.getElementById('svc-ed-icon')?.value  || 'zap',
      unit:               (document.getElementById('svc-ed-unit')?.value || 'st').trim(),
      vatRate:            vatCheck.value,
      minChargeExVat:     parseFloat(document.getElementById('svc-ed-mincharge')?.value) || 0,
      defaultReduction:   document.getElementById('svc-ed-red')?.value  || 'ingen',
      sortOrder:          parseInt(document.getElementById('svc-ed-sort')?.value) || 0,
      active:             document.getElementById('svc-ed-active')?.checked !== false,
      pricingModel:       model,
      basePricePerUnit:   base,
      qtyField:           qtyFld,
      tiers:              model === 'tiered_unit' ? this._editTiers.slice() : (ServiceTemplateService.get(id)?.tiers || []),
      options:            this._editOptions.slice(),
      defaultDescription: (document.getElementById('svc-ed-desc')?.value || '').trim(),
      includes:           (document.getElementById('svc-ed-includes')?.value || '').split('\n').map(s=>s.trim()).filter(Boolean),
      excludes:           (document.getElementById('svc-ed-excludes')?.value || '').split('\n').map(s=>s.trim()).filter(Boolean),
      internalNote:       (document.getElementById('svc-ed-note')?.value  || '').trim()
    };
    /* V39 §2: servicelagret validerar vatRate igen (defense-in-depth mot
       direktanrop) — result blir null om det av någon anledning ändå
       nekas där. */
    const result = ServiceTemplateService.update(id, changes);
    if (!result) { showToast('Kunde inte spara — ogiltig momssats.'); return; }
    Modal.close();
    this.render();
    showToast(`"${name}" sparad`);
  },

  toggleActive(id) {
    const svc = ServiceTemplateService.toggleActive(id);
    this.render();
    showToast(svc && svc.active !== false ? 'Aktiverad' : 'Inaktiverad');
  },

  duplicate(id) {
    const copy = ServiceTemplateService.duplicate(id);
    if (copy) { this.render(); showToast('Duplicerad — redigera kopian för att aktivera'); }
  },

  openTest(id) {
    const svc = ServiceTemplateService.get(id);
    if (!svc) return;
    const tmpl = ServiceTemplateService.buildWizardTemplate(svc);
    this._testFields = {};
    this._testReduction = svc.defaultReduction || 'ingen';
    // Pre-fill defaults
    (svc.fields||[]).forEach(f => {
      if (f.def !== undefined)           this._testFields[f.id] = f.def;
      else if (f.type==='chips'&&f.opts) this._testFields[f.id] = f.opts[0];
      else if (f.type==='bool')          this._testFields[f.id] = false;
      else if (f.type==='number')        this._testFields[f.id] = 0;
      else if (f.type==='pricegroup') {
        const pgs = (state.priceGroups || []).filter(p => p.billingType !== 'monthly');
        const defId = f.def || (pgs[0]&&pgs[0].id) || '';
        this._testFields[f.id] = defId;
        const pg = pgs.find(p=>p.id===defId);
        if (pg && !this._testFields['rate']) this._testFields['rate'] = pg.hourRate;
      } else                               this._testFields[f.id] = '';
    });
    const redOpts = [{v:'ingen',l:'Ingen'},{v:'rut',l:'RUT 50%'},{v:'rot',l:'ROT 30%'}];
    const fieldHtml = (svc.fields||[]).filter(f=>!f.isRut&&!f.isRot).map(f => {
      if (f.type === 'number') return `<div class="fg" style="margin-bottom:6px;"><label style="font-size:10px;">${esc(f.label)}</label>
        <input type="number" value="${f.def||0}" min="0" style="width:100%;"
          oninput="ServiceTemplatesPage._testFields['${f.id}']=parseFloat(this.value)||0;ServiceTemplatesPage._updateTestPreview('${id}')"></div>`;
      if (f.type === 'chips') return `<div style="margin-bottom:6px;"><div style="font-size:10px;font-weight:700;color:var(--mt);margin-bottom:3px;">${esc(f.label)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:3px;">
          ${(f.opts||[]).map(o=>`<button type="button"
            style="padding:3px 8px;border-radius:12px;border:1.5px solid var(--br);font-size:10px;cursor:pointer;background:${o===(f.def||f.opts[0])?'var(--navy)':'#fff'};color:${o===(f.def||f.opts[0])?'#fff':'var(--tx)'};"
            onclick="ServiceTemplatesPage._testFields['${f.id}']='${o.replace(/'/g,"\\'")}';this.closest('div').querySelectorAll('button').forEach(b=>{b.style.background='#fff';b.style.color='var(--tx)';});this.style.background='var(--navy)';this.style.color='#fff';ServiceTemplatesPage._updateTestPreview('${id}')">${o}</button>`).join('')}
        </div></div>`;
      if (f.type === 'bool') return `<div style="margin-bottom:6px;"><label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer;">
        <input type="checkbox" onchange="ServiceTemplatesPage._testFields['${f.id}']=this.checked;ServiceTemplatesPage._updateTestPreview('${id}')">
        <span>${f.addLabel||f.label}</span></label></div>`;
      if (f.type === 'pricegroup') {
        const pgs = (state.priceGroups || []).filter(p => p.billingType !== 'monthly');
        const defVal = f.def || (pgs[0]&&pgs[0].id) || '';
        return `<div class="fg" style="margin-bottom:6px;"><label style="font-size:10px;">${esc(f.label)}</label>
          <select style="width:100%;" onchange="ServiceTemplatesPage._testFields['${f.id}']=this.value;ServiceTemplatesPage._testFields['rate']=(state.priceGroups||[]).filter(p=>p.billingType!=='monthly').find(p=>p.id===this.value)?.hourRate||0;ServiceTemplatesPage._updateTestPreview('${id}')">
            ${pgs.map(pg=>`<option value="${pg.id}" ${(f.def||defVal)===pg.id?'selected':''}>${esc(pg.name)} (${fmt(pg.hourRate)} kr/tim)</option>`).join('')}
          </select></div>`;
      }
      return `<div class="fg" style="margin-bottom:6px;"><label style="font-size:10px;">${esc(f.label)}</label>
        <input type="text" value="" style="width:100%;"
          oninput="ServiceTemplatesPage._testFields['${f.id}']=this.value;ServiceTemplatesPage._updateTestPreview('${id}')"></div>`;
    }).join('');

    Modal.open({
      title: `${ic('calculator',14)} Testkalkyl: ${svc.name}`,
      body: `
        <div class="g2" style="gap:12px;">
          <div>${fieldHtml}
            <div style="padding-top:8px;border-top:1px solid var(--br);">
              <div style="font-size:10px;font-weight:700;color:var(--mt);margin-bottom:4px;">Skattereduktion</div>
              <div style="display:flex;gap:4px;">
                ${redOpts.map(o=>`<button type="button" id="test-red-${o.v}"
                  style="flex:1;padding:5px;border-radius:6px;border:1.5px solid ${this._testReduction===o.v?'var(--navy)':'var(--br)'};font-size:10px;font-weight:700;cursor:pointer;background:${this._testReduction===o.v?'var(--navy)':'#fff'};color:${this._testReduction===o.v?'#fff':'var(--mt)'};"
                  onclick="ServiceTemplatesPage._setTestReduction('${o.v}','${id}')">${o.l}</button>`).join('')}
              </div>
            </div>
          </div>
          <div id="svc-test-preview" style="background:var(--navy);color:#fff;border-radius:var(--rs);padding:12px;min-height:120px;">
            <div style="font-size:11px;opacity:.6;">Fyll i fälten för att se kalkyl…</div>
          </div>
        </div>`,
      buttons: [{ label: 'Stäng', cls: 'btn bs', onClick: () => Modal.close() }]
    });
    setTimeout(() => this._updateTestPreview(id), 50);
  },

  _setTestReduction(val, svcId) {
    this._testReduction = val;
    ['ingen','rut','rot'].forEach(v => {
      const btn = document.getElementById('test-red-' + v);
      if (!btn) return;
      btn.style.background  = v===val ? 'var(--navy)' : '#fff';
      btn.style.color       = v===val ? '#fff'        : 'var(--mt)';
      btn.style.borderColor = v===val ? 'var(--navy)' : 'var(--br)';
    });
    this._updateTestPreview(svcId);
  },

  _updateTestPreview(svcId) {
    const prev = document.getElementById('svc-test-preview');
    if (!prev) return;
    const svc  = ServiceTemplateService.get(svcId);
    if (!svc) return;
    const tmpl = ServiceTemplateService.buildWizardTemplate(svc);
    const fields = {...this._testFields, rut:this._testReduction==='rut', rot:this._testReduction==='rot'};
    try {
      const r = tmpl.calc(fields);
      const {ls, exVat, rutAmt} = r;
      const vat    = Math.round(exVat * _normVat(svc.vatRate) / 100);
      const incVat = exVat + vat;
      const custPr = incVat - (rutAmt||0);
      let html = '';
      if (r.tierLbl) html += `<div style="font-size:8px;opacity:.5;margin-bottom:4px;">${r.tierLbl}</div>`;
      html += `<div style="font-size:9px;opacity:.65;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,.12);">`;
      ls.forEach(l => { html += `<div>${l.desc} · ${l.qty} ${l.unit} × ${fmt(l.price)} kr = ${fmt(Math.round(l.qty*l.price))} kr</div>`; });
      html += `</div>`;
      html += `<div style="display:flex;justify-content:space-between;font-size:10px;opacity:.7;margin-bottom:2px;"><span>Ex. moms</span><span>${fmt(exVat)} kr</span></div>`;
      html += `<div style="display:flex;justify-content:space-between;font-size:10px;opacity:.7;margin-bottom:5px;"><span>Moms ${_normVat(svc.vatRate)}%</span><span>${fmt(vat)} kr</span></div>`;
      html += `<div style="display:flex;justify-content:space-between;font-size:11px;font-weight:700;padding-top:5px;border-top:1px solid rgba(255,255,255,.15);margin-bottom:${rutAmt?'4px':'8px'};"><span>Totalt inkl. moms</span><span>${fmt(incVat)} kr</span></div>`;
      if (rutAmt) {
        const redLbl = this._testReduction==='rut'?'RUT':'ROT';
        html += `<div style="display:flex;justify-content:space-between;font-size:10px;color:#86efac;margin-bottom:4px;"><span>Prelim. ${redLbl}-avdrag</span><span>-${fmt(rutAmt)} kr</span></div>`;
      }
      html += `<div style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,.13);border-radius:6px;padding:6px 9px;">
        <span style="font-size:10px;opacity:.8;">Kundpris inkl. moms</span>
        <span style="font-size:17px;font-weight:800;">${fmt(rutAmt?custPr:incVat)} kr</span></div>`;
      prev.innerHTML = html;
    } catch(e) {
      prev.innerHTML = `<div style="font-size:10px;opacity:.65;">Fyll i obligatoriska fält för att se kalkyl.</div>`;
    }
  }
};

/* ── Admin ────────────────────────────── */
const AdminPage = {
  _titleQ: '',
  _tab: 'foretag',

  /* V3 2026-11-26 (F-07, S-01): tio avsnitt i sex grupper. Dator (≥ 900 px):
     grupperad sidomeny till vänster om innehållet. Mobil/surfplatta: en
     rullista med samma grupper överst — inget avsnitt ligger dolt utanför
     skärmen (tidigare syntes 5 av 10 flikar på 390 px). Knapparna behåller
     klassen .admin-tab och onclick "AdminPage._tab='…'" (E2E ADMIN-01,
     ROLE-02, RENDER-01). Ikonen är betrodd statisk ic()-markup (fältet
     icon), etiketten escapas (QA 2026-11-25, A1/RENDER-01). */
  _NAV: [
    { group: 'Företag & profil', items: [
      { key: 'foretag',        label: 'Företag & varumärke', icon: 'building-2' } ] },
    { group: 'Ekonomi & priser', items: [
      { key: 'ekonomi',        label: 'Ekonomi',             icon: 'trending-up' },
      { key: 'priser',         label: 'Priser & tjänster',   icon: 'package' } ] },
    { group: 'Personal & behörighet', items: [
      { key: 'personal',       label: 'Personal & roller',   icon: 'users' } ] },
    { group: 'Fastighetskort', items: [
      { key: 'fastighetskort', label: 'Kategorier & fält',   icon: 'layers' },
      { key: 'ansvariga',      label: 'Ansvariga',           icon: 'user-check' },
      { key: 'avvikelse',      label: 'Avvikelser',          icon: 'alert-triangle' } ] },
    { group: 'Notiser & e-post', items: [
      { key: 'notiser',        label: 'Mobilnotiser',        icon: 'bell' },
      { key: 'epost',          label: 'E-post-mallar',       icon: 'mail' } ] },
    { group: 'System', items: [
      { key: 'system',         label: 'Data & import',       icon: 'server' },
      /* Sist och skilt från användarinställningarna: push-diagnostik och
         rensning av lokal cache (QA-tillägg 2026-11-26). */
      { key: 'teknik',         label: 'Teknik & underhåll',  icon: 'wrench' } ] }
  ],

  /* Förvalda varumärkesfärger. Alla primärfärger klarar vit text (≥ 4,5:1),
     eftersom V3 ritar sidomeny, primärknappar och aktiva filter med vit
     text på primärfärgen. Första posten är standard. */
  _PRESETS: {
    primaryColor: [
      { hex: '#0f3763', name: 'VIFT marinblå (standard)' },
      { hex: '#1a4b8c', name: 'Mörkblå' },
      { hex: '#134e4a', name: 'Petrol' },
      { hex: '#14532d', name: 'Skogsgrön' },
      { hex: '#7f1d1d', name: 'Vinröd' },
      { hex: '#1f2937', name: 'Grafit' }
    ],
    secondaryColor: [
      { hex: '#1d75d8', name: 'VIFT blå (standard)' },
      { hex: '#0e7490', name: 'Turkos' },
      { hex: '#15803d', name: 'Grön' },
      { hex: '#b45309', name: 'Bärnsten' },
      { hex: '#6d28d9', name: 'Lila' },
      { hex: '#475569', name: 'Skiffergrå' }
    ]
  },

  _go(key) {
    if (!key) return;
    this._tab = key;
    this.render();
    const c = document.getElementById('content-scroll');
    if (c && c.scrollTop > 0) c.scrollTop = 0;
  },

  /* Ändringar på den här enheten som servern ännu inte bekräftat:
     AO/tid-kön (AOTimeSyncService, vift_outbox), journalförda osparade
     ändringar (state.js, vift_persistJournal:*), pågående sparningar
     (DataSync) och aktivitetsloggens kö (ActivityService). */
  _localUnsynced() {
    const parts = [];
    const add = (label, fn) => { try { const n = Number(fn()) || 0; if (n > 0) parts.push({ label, n }); } catch (e) {} };
    add('arbetsorder-/tidsändringar i kö', () => typeof AOTimeSyncService !== 'undefined' && AOTimeSyncService.pendingCount ? AOTimeSyncService.pendingCount() : 0);
    add('osparade registerändringar', () => typeof _vfJournalPendingCount === 'function' ? _vfJournalPendingCount() : 0);
    add('sparningar pågår', () => typeof DataSync !== 'undefined' ? (DataSync._pendingWrites || 0) : 0);
    add('aktivitetsposter i kö', () => typeof ActivityService !== 'undefined' && Array.isArray(ActivityService._outbox) ? ActivityService._outbox.length : 0);
    return parts;
  },

  /* "Rensa lokal cache på den här enheten" (tidigare "Återställ demodata",
     som också körde localStorage.clear() — serverns data har aldrig
     påverkats). Behåller inloggningen och uppladdade logotyper (de finns
     bara lokalt). Finns det osparade ändringar krävs två tydliga
     bekräftelser som visar antalet. Bara admin_manage (eller 'all'). */
  _clearLocalCache() {
    if (!Auth.require('admin_manage')) return;
    const pending = this._localUnsynced();
    const total = pending.reduce((a, p) => a + p.n, 0);
    if (total > 0) {
      const list = pending.map(p => '• ' + p.n + ' ' + p.label).join('\n');
      if (!confirm('VARNING: ' + total + ' ändring' + (total === 1 ? '' : 'ar') + ' på den här enheten är INTE sparade på servern:\n' + list + '\n\nRensar du nu försvinner de för gott. Vill du fortsätta?')) return;
      if (!confirm('Bekräfta igen: radera ' + total + ' osparade ändring' + (total === 1 ? '' : 'ar') + ' och rensa den lokala cachen?')) return;
    } else if (!confirm('Rensa lokal cache på den här enheten?\n\nServerns data påverkas inte. Sidan laddas om och data hämtas på nytt från servern. Du förblir inloggad.')) {
      return;
    }
    const keep = [(Auth && Auth.SESSION_KEY) || 'vift_auth_v2', BrandingService._LS_LIGHT, BrandingService._LS_DARK];
    /* T3-A: utkorgar/journaler som tillhör ANDRA användare (eller saknar
       känd ägare, från en äldre version) på enheten behålls — de räknas inte
       i varningen ovan (bara egna) och får aldrig försvinna här. */
    try {
      const id = Auth.ownerIdentity ? Auth.ownerIdentity() : null;
      const mine = id ? '::' + id.env + '::' + id.email : null;
      Object.keys(localStorage).forEach(k => {
        if (/^vift_(outbox|settleIntents|persistJournal|activityOutbox)/.test(k) && (!mine || !k.endsWith(mine))) keep.push(k);
      });
    } catch (e) {}
    const saved = {};
    keep.forEach(k => { try { const v = localStorage.getItem(k); if (v !== null) saved[k] = v; } catch (e) {} });
    try { localStorage.clear(); } catch (e) {}
    Object.keys(saved).forEach(k => { try { localStorage.setItem(k, saved[k]); } catch (e) {} });
    location.reload();
  },

  _navHtml() {
    const cur = this._tab;
    const sel = `<label class="adm-nav-sel"><span class="sr-only">Välj avsnitt</span>
      <select id="adm-nav-select" class="ar-select" onchange="AdminPage._go(this.value)">
        ${this._NAV.map(g => `<optgroup label="${esc(g.group)}">${g.items.map(t => `<option value="${t.key}"${t.key === cur ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}</optgroup>`).join('')}
      </select></label>`;
    const list = `<div class="adm-nav-list">${this._NAV.map(g => `
      <div class="adm-nav-g">
        <div class="adm-nav-gl">${esc(g.group)}</div>
        ${g.items.map(t => `<button type="button" class="admin-tab adm-nav-i${t.key === cur ? ' is-on' : ''}"${t.key === cur ? ' aria-current="page"' : ''} onclick="AdminPage._tab='${t.key}';AdminPage.render()">${t.icon ? ic(t.icon, 16) : ''}<span>${esc(t.label)}</span></button>`).join('')}
      </div>`).join('')}</div>`;
    return `<nav class="adm-nav" aria-label="Admininställningar">${sel}${list}</nav>`;
  },

  /* Avsnittets rubrik (h2 — toppraden har sidans h1). actions = betrodd markup. */
  _head(title, desc, actions) {
    return `<div class="adm-head"><div class="adm-head-t"><h2>${esc(title)}</h2>${desc ? `<p>${esc(desc)}</p>` : ''}</div>${actions ? `<div class="adm-head-a">${actions}</div>` : ''}</div>`;
  },

  /* V3-kort. subHtml/actions/body = betrodd markup (data escapas av anroparen). */
  _card(icon, title, body, o) {
    o = o || {};
    /* V3-komponentstandard §6: .card > .card-header (h3 + åtgärd) > .card-body. */
    return `<section class="card ar-card${o.cls ? ' ' + o.cls : ''}"${o.id ? ` id="${o.id}"` : ''}>
      <div class="card-header ar-card-h"><div class="ar-card-ht"><h3>${icon ? ic(icon, 16) : ''}<span>${esc(title)}</span></h3>${o.subHtml ? `<p>${o.subHtml}</p>` : ''}</div>${o.actions ? `<div class="ar-card-a">${o.actions}</div>` : ''}</div>
      <div class="card-body ar-card-b${o.flush ? ' is-flush' : ''}">${body}</div>
    </section>`;
  },

  _activeBadge(on) { return `<span class="bdg ${on ? 'bdg-green' : 'bdg-grey'}">${on ? 'Aktiv' : 'Inaktiv'}</span>`; },

  /* Ikonknapp i listrader: synlig etikett via title, skärmläsare via aria-label.
     Id skickas via data-id (aldrig inklistrat i JS-koden). */
  _ibtn(icon, label, handler, id, o) {
    o = o || {};
    return `<button type="button" class="ibtn${o.danger ? ' is-danger' : ''}" title="${esc(o.title || label)}" aria-label="${esc(label)}"${id != null ? ` data-id="${esc(id)}"` : ''}${o.disabled ? ' disabled' : ''} onclick="${handler}">${ic(icon, 15)}</button>`;
  },

  /* ── Färghjälp ── */
  _normHex(v) {
    let s = String(v || '').trim().toLowerCase();
    if (s && s[0] !== '#') s = '#' + s;
    if (/^#[0-9a-f]{3}$/.test(s)) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    return /^#[0-9a-f]{6}$/.test(s) ? s : '';
  },
  _contrastWhite(hex) {
    const h = this._normHex(hex);
    if (!h) return 0;
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * lin(parseInt(h.slice(1, 3), 16)) + 0.7152 * lin(parseInt(h.slice(3, 5), 16)) + 0.0722 * lin(parseInt(h.slice(5, 7), 16));
    return 1.05 / (L + 0.05);
  },
  /* Bara en upplysning — ändrar inga färger (automatisk textfärg är backlog). */
  _contrastMsg(hex, field) {
    const r = this._contrastWhite(hex);
    const txt = r.toLocaleString('sv-SE', { maximumFractionDigits: 1 }) + ':1';
    if (r >= 4.5) return `<span class="adm-c-ok">${ic('check', 14)}<span>Vit text på färgen: ${txt} — läsbart</span></span>`;
    const where = field === 'primaryColor' ? 'Sidomenyn, primärknappar och aktiva filter' : 'Äldre vyer med färgtoning';
    return `<span class="adm-c-warn">${ic('alert-triangle', 14)}<span>Låg kontrast: vit text på färgen ger ${txt} (minst 4,5:1 behövs). ${where} blir svårlästa — välj en mörkare färg.</span></span>`;
  },

  _colorField(field, label, help) {
    const s = state.settings || {};
    const presets = this._PRESETS[field];
    const def = presets[0].hex;
    const cur = this._normHex(s[field]) || def;
    const lc = label.toLowerCase();
    return `<div class="adm-color" id="adm-color-${field}">
      <div class="adm-color-h"><span class="adm-color-l">${esc(label)}</span><span class="adm-color-d">${esc(help)}</span></div>
      <div class="adm-color-row">
        <input type="color" class="adm-color-in" value="${cur}" aria-label="Välj ${esc(lc)}"
          oninput="AdminPage._onColorInput(this.value,'${field}')"
          onchange="AdminPage._saveColor(this.value,'${field}')">
        <input type="text" class="adm-hex" value="${cur}" maxlength="7" spellcheck="false" autocomplete="off" aria-label="HEX-kod för ${esc(lc)}"
          oninput="AdminPage._onHexInput(this,'${field}')"
          onchange="AdminPage._onHexCommit(this,'${field}')"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">
        <button type="button" class="btn bghost bsm adm-color-reset"${cur === def ? ' hidden' : ''} onclick="AdminPage._applyPreset('${field}','${def}')">${ic('rotate-ccw', 14)}<span>Standard</span></button>
      </div>
      <div class="adm-presets" role="group" aria-label="Förvalda färger, ${esc(lc)}">
        ${presets.map(p => `<button type="button" class="adm-preset" data-hex="${p.hex}" style="--sw:${p.hex}" title="${esc(p.name)} ${p.hex}" aria-label="${esc(p.name)}" aria-pressed="${p.hex === cur}" onclick="AdminPage._applyPreset('${field}','${p.hex}')"></button>`).join('')}
      </div>
      <p class="adm-color-msg" id="adm-color-msg-${field}" aria-live="polite">${this._contrastMsg(cur, field)}</p>
    </div>`;
  },

  /* Titellistan (Personal & roller). Sökningen ritar bara om listan och
     räknaren — aldrig sökfältet — så att fokus och markör behålls
     (V3-komponentstandard §5; tidigare ritades hela sidan om per tangent). */
  _titleRowsHtml() {
    const allTitles = state.titles || [];
    const q = (this._titleQ || '').trim().toLowerCase();
    const titles = q ? allTitles.filter(t => typeof t === 'object' && t.name && t.name.toLowerCase().includes(q)) : allTitles;
    if (allTitles.length === 0) return `<p class="ar-empty">Inga titlar registrerade.</p>`;
    if (titles.length === 0) return `<p class="ar-empty">Ingen titel matchar "${esc(this._titleQ)}".</p>`;
    return titles.map(t => {
      const origIdx = allTitles.findIndex(x => x.id === t.id);
      const usageCount = (state.staff||[]).filter(st => st.title === t.name).length;
      return `<div class="adm-row${t.active ? '' : ' is-off'}">
        <div class="adm-row-m">
          <div class="adm-row-t"><span class="adm-row-n">${esc(t.name)}</span>${this._activeBadge(t.active)}</div>
          ${t.description ? `<div class="adm-row-s">${esc(t.description)}</div>` : ''}
          <div class="adm-row-x">${usageCount > 0
            ? `<button type="button" class="adm-link" onclick="AdminPage._showTitleStaffIdx(${origIdx})">${usageCount} ${usageCount === 1 ? 'person' : 'personer'}${ic('chevron-right',13)}</button>`
            : '<span class="adm-muted">Ej använd</span>'}</div>
        </div>
        <div class="adm-row-a">
          ${this._ibtn('pencil', 'Redigera ' + t.name, `AdminPage.openEditTitle(${origIdx})`, null, { title: 'Redigera' })}
          ${this._ibtn(t.active ? 'eye-off' : 'eye', (t.active ? 'Inaktivera ' : 'Aktivera ') + t.name, `AdminPage.toggleTitleActive(${origIdx})`, null, { title: t.active ? 'Inaktivera' : 'Aktivera' })}
          ${this._ibtn('trash', 'Ta bort ' + t.name, `AdminPage.removeTitle(${origIdx})`, null, { danger: true, title: usageCount > 0 ? `Används av ${usageCount} person(er)` : 'Ta bort' })}
        </div>
      </div>`;
    }).join('');
  },
  _titleCountText() {
    const all = (state.titles || []).length;
    const q = (this._titleQ || '').trim().toLowerCase();
    const n = q ? (state.titles || []).filter(t => t && t.name && t.name.toLowerCase().includes(q)).length : all;
    return `Visar ${n} av ${all}`;
  },
  _onTitleSearch(v) {
    this._titleQ = v;
    clearTimeout(this._titleT);
    this._titleT = setTimeout(() => {
      const list = document.getElementById('adm-title-list');
      const cnt = document.getElementById('adm-title-count');
      if (list) list.innerHTML = this._titleRowsHtml();
      if (cnt) cnt.textContent = this._titleCountText();
    }, 150);
  },

  render() {
    const el = document.getElementById('pg-admin-content');
    if (!el) return;
    if (!Auth.require('admin_manage')) {
      el.innerHTML = `<div class="empty">${ic('lock',32)}<h3>Behörighet saknas</h3><p>Du har inte tillgång till systeminställningar.</p></div>`;
      return;
    }
    const s = state.settings || {};
    const known = this._NAV.some(g => g.items.some(t => t.key === this._tab));
    if (!known) this._tab = 'foretag';

    const sections = {};
    /* Faktarutor (V3-komponentstandard §6): dl > div > dt + dd. Värden escapas. */
    const fact = (k, v, o) => `<div class="adm-fact${o && o.wide ? ' is-wide' : ''}"><dt>${esc(k)}</dt><dd>${v ? esc(v) : '<span class="adm-none">—</span>'}</dd></div>`;

    /* ── Företag & varumärke ───────────────────────────── */
    const logoBlock = (field, title, use, bgCls, statusOn, statusOff) => {
      /* Uppladdade loggor ligger i egna localStorage-nycklar (BrandingService),
         inte i settings — tidigare visades därför alltid "standardlogga". */
      let has = !!s[field];
      try { has = has || !!localStorage.getItem(field === 'logoLight' ? BrandingService._LS_LIGHT : BrandingService._LS_DARK); } catch (e) {}
      const src = field === 'logoLight' ? BrandingService.logoLight() : BrandingService.logoDark();
      const fid = 'adm-file-' + field;
      return `<div class="adm-logo">
        <div class="adm-logo-prev ${bgCls}"><img id="${field === 'logoLight' ? 'admin-preview-light' : 'admin-preview-dark'}" src="${esc(src)}" alt="${esc(title)}" onerror="this.style.opacity='.2'"></div>
        <div class="adm-logo-m">
          <div class="adm-logo-t">${esc(title)} ${has ? `<span class="bdg bdg-green">${ic('check',11)}${esc(statusOn)}</span>` : `<span class="bdg bdg-grey">${esc(statusOff)}</span>`}</div>
          <div class="adm-logo-s">${esc(use)}</div>
          <div class="adm-logo-a">
            <input type="file" id="${fid}" class="adm-file sr-only" accept=".svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg" onchange="AdminPage._uploadLogo(this,'${field}')">
            <label for="${fid}" class="btn bs bsm">${ic('upload',14)}<span>Ladda upp</span></label>
            ${has ? `<button type="button" class="btn bghost bsm" onclick="AdminPage._clearLogo('${field}')">${ic('x',14)}<span>Återställ</span></button>` : ''}
          </div>
        </div>
      </div>`;
    };
    const prim = this._normHex(s.primaryColor) || '#0f3763';
    sections.foretag =
      this._head('Företag & varumärke', 'Uppgifter, logotyper och färger som används i appen, offerter, PDF och e-post.') +
      this._card('building-2', 'Företagsuppgifter',
        `<dl class="adm-facts">
          ${fact('Företag', s.companyName, { wide: true })}${fact('Org.nr', s.orgNr)}
          ${fact('Slogan', s.slogan, { wide: true })}${fact('Moms-nr', s.vatNr)}
          ${fact('Telefon', s.companyPhone)}${fact('E-post', s.companyEmail)}${fact('Webbsida', s.website)}
          ${fact('Adress', s.companyAddress, { wide: true })}
        </dl>`,
        { actions: `<button type="button" class="btn bs bsm" onclick="AdminPage.openEditCompany()">${ic('pencil',14)}<span>Redigera</span></button>` }) +
      this._card('image', 'Logotyper',
        `<div class="adm-logos">
          ${logoBlock('logoLight', 'Ljus bakgrund', 'PDF, utskrift och e-post. SVG, PNG eller JPG, högst 3 MB.', 'is-light', 'Uppladdad', 'Standardlogga')}
          ${logoBlock('logoDark', 'Mörk bakgrund', 'Sidomeny, offertdetalj och sidhuvuden. Saknas den används den ljusa.', 'is-dark', 'Uppladdad', 'Ljus logga eller standard')}
        </div>`) +
      this._card('sliders', 'Varumärkesfärger',
        `<div class="adm-colors">
          ${this._colorField('primaryColor', 'Primärfärg', 'Sidomeny, primärknappar, aktiva filter och räknare')}
          ${this._colorField('secondaryColor', 'Sekundärfärg', 'Toning i äldre vyer (V3-gränssnittet använder primärfärgen)')}
          <div class="adm-brand-prev" aria-label="Förhandsvisning av färgerna">
            <div class="adm-prev-l">Förhandsvisning</div>
            <div class="adm-prev-row">
              <div class="adm-prev-side">
                <img src="${esc(BrandingService.logoForBg ? BrandingService.logoForBg(prim) : BrandingService.logoDark())}" alt="" onerror="this.style.display='none'">
                <span class="adm-prev-ni is-on">${ic('layout-dashboard',14)}<span>Dashboard</span></span>
                <span class="adm-prev-ni">${ic('clipboard-list',14)}<span>Arbetsorder</span></span>
              </div>
              <div class="adm-prev-ui">
                <span class="btn bp bsm adm-prev-btn">${ic('plus',14)}<span>Primärknapp</span></span>
                <span class="chip on adm-prev-chip">Aktivt filter<span class="chip-n">4</span></span>
                <span class="adm-prev-badge"><span>Räknare</span><span class="aol-badge">3</span></span>
              </div>
            </div>
          </div>
        </div>`,
        { subHtml: 'Klicka på en förvald färg, välj fritt i färgrutan eller skriv en HEX-kod. Förhandsvisningen uppdateras direkt; färgen sparas när du släpper valet.' });

    /* ── Ekonomi ───────────────────────────────────────── */
    sections.ekonomi =
      this._head('Ekonomi', 'Interna parametrar för lönsamhetsberäkningar.') +
      this._card('trending-up', 'Intern timkostnad',
        `<div class="adm-figure"><b>${esc(fmt(s.internalHourlyCost || 250))} kr/h</b><span>exkl. moms</span></div>
         <p class="ar-help">Används för att beräkna täckningsbidrag. Visas aldrig för kund i PDF eller e-post.</p>`,
        { actions: `<button type="button" class="btn bs bsm" onclick="AdminPage.openEditEkonomi()">${ic('pencil',14)}<span>Redigera</span></button>` }) +
      /* QA-tillägg 2026-11-26: tre olika timvärden blandades ihop (löneunderlaget
         kallade timmar × prisgruppens försäljningspris för "lönekostnad"). */
      this._card('info', 'Tre olika timvärden',
        `<dl class="adm-facts is-stack">
          <div class="adm-fact"><dt>Intern timkostnad</dt><dd>${esc(fmt(s.internalHourlyCost || 250))} kr/h exkl. moms — inställningen ovan. Används för täckningsbidrag och för "Intern kostnad (uppskattad)" i löneunderlaget.</dd></div>
          <div class="adm-fact"><dt>Försäljningspris</dt><dd>Prisgruppens timpris exkl. moms (t.ex. ${esc(((state.priceGroups || []).filter(p => p.active && p.hourRate > 0).map(p => p.id + ' ' + fmt(p.hourRate) + ' kr/h').slice(0, 4).join(', ')) || '—')}). Kopieras till varje tidpost och ger löneunderlagets "Debiterbart värde".</dd></div>
          <div class="adm-fact"><dt>Lönekostnad</dt><dd>Lön/timlön inklusive sociala avgifter. Finns inte i systemet i dag — personalregistret saknar lönedata.</dd></div>
        </dl>`,
        { actions: `<button type="button" class="btn bghost bsm" onclick="Router.showPage('pg-pricegroups')">${ic('dollar-sign',14)}<span>Prisgrupper</span>${ic('chevron-right',14)}</button>` });

    /* ── Personal & roller ─────────────────────────────── */
    const titleRows = this._titleRowsHtml();
    const roleRows = (state.roles||[]).length === 0
      ? `<p class="ar-empty">Inga roller definierade.</p>`
      : (state.roles||[]).map(r => {
          const permCount  = (r.permissions||[]).length;
          const staffCount = (state.staff||[]).filter(st => st.role === r.id).length;
          const isActive   = r.active !== false;
          return `<div class="adm-row${isActive ? '' : ' is-off'}">
            <div class="adm-row-m">
              <div class="adm-row-t"><span class="adm-row-n">${esc(r.label)}</span>${this._activeBadge(isActive)}${r.isBuiltin ? '<span class="bdg bdg-grey">Inbyggd</span>' : ''}</div>
              ${r.description ? `<div class="adm-row-s">${esc(r.description)}</div>` : ''}
              <div class="adm-row-x">
                <span class="adm-muted">${permCount === 0 ? 'Inga behörigheter' : permCount + ' behörighet' + (permCount === 1 ? '' : 'er') + (r.permissions && r.permissions.includes('all') ? ' (superadmin)' : '')}</span>
                ${staffCount > 0 ? `<button type="button" class="adm-link" data-id="${esc(r.id)}" onclick="AdminPage.showRoleStaff(this.dataset.id)">${staffCount} ${staffCount === 1 ? 'person' : 'personer'}${ic('chevron-right',13)}</button>` : ''}
              </div>
            </div>
            <div class="adm-row-a">
              ${this._ibtn('pencil', 'Redigera ' + r.label, 'AdminPage.openEditRole(this.dataset.id)', r.id, { title: 'Redigera behörigheter' })}
              ${this._ibtn(isActive ? 'eye-off' : 'eye', (isActive ? 'Inaktivera ' : 'Aktivera ') + r.label, 'AdminPage.toggleRoleActive(this.dataset.id)', r.id, { title: isActive ? 'Inaktivera' : 'Aktivera' })}
              ${!r.isBuiltin ? this._ibtn('trash', 'Ta bort ' + r.label, 'AdminPage.removeRole(this.dataset.id)', r.id, { danger: true, title: 'Ta bort' }) : ''}
            </div>
          </div>`;
        }).join('');
    sections.personal =
      this._head('Personal & roller', 'Behörighetsroller styr vad varje person får se och göra. Titlar är yrkesroller som visas på personalkortet.',
        `<button type="button" class="btn bs bsm" onclick="Router.showPage('pg-staff')">${ic('users',14)}<span>Personalregistret</span>${ic('chevron-right',14)}</button>`) +
      this._card('shield-check', 'Roller & behörigheter', `<div class="adm-list">${roleRows}</div>`,
        { flush: true, actions: `<button type="button" class="btn bs bsm" onclick="AdminPage.openAddRole()">${ic('plus',14)}<span>Ny roll</span></button>` }) +
      this._card('tag', 'Titlar / yrkesroller',
        `<div class="adm-search-row"><div class="adm-search swrap"><span class="sico" aria-hidden="true">${ic('search',14)}</span>
          <input type="search" placeholder="Sök titel" value="${esc(this._titleQ)}" aria-label="Sök titel"
            oninput="AdminPage._onTitleSearch(this.value)"></div>
          <span class="adm-count" id="adm-title-count" aria-live="polite">${this._titleCountText()}</span></div>
         <div class="adm-list" id="adm-title-list">${titleRows}</div>`,
        { flush: true, actions: `<button type="button" class="btn bs bsm" onclick="AdminPage.openAddTitle()">${ic('plus',14)}<span>Lägg till</span></button>` });

    /* ── Priser & tjänster ─────────────────────────────── */
    const regRow = (icon, name, desc, n, page) => `<button type="button" class="adm-link-row" onclick="Router.showPage('${page}')">
        <span class="adm-link-ico">${ic(icon,16)}</span>
        <span class="adm-row-m"><span class="adm-row-n">${esc(name)}</span><span class="adm-row-s">${esc(desc)}</span></span>
        <span class="adm-link-n">${n} aktiva</span>${ic('chevron-right',16)}
      </button>`;
    sections.priser =
      this._head('Priser & tjänster', 'Register för offerttjänster, artiklar och prisgrupper.') +
      this._card('package', 'Register',
        `<div class="adm-list">
          ${regRow('zap', 'Offerttjänster', 'Tjänster och prismodeller i offertkalkylatorn', (state.serviceTemplates||[]).filter(x=>x.active!==false).length, 'pg-service-templates')}
          ${regRow('package', 'Artiklar', 'Material och artiklar med priser', (state.articles||[]).filter(a=>a.active!==false).length, 'pg-articles')}
          ${regRow('dollar-sign', 'Prisgrupper', 'Timpriser per kund- eller arbetstyp', (state.priceGroups||[]).filter(p=>p.active).length, 'pg-pricegroups')}
        </div>`, { flush: true }) +
      this._card('layers', 'Inbyggda kalkylatormallar',
        `<div class="adm-list">${OffersPage._T.map(t => `<div class="adm-row">
            <span class="adm-row-ico">${ic(t.icon,15)}</span>
            <div class="adm-row-m">
              <div class="adm-row-t"><span class="adm-row-n">${esc(t.name)}</span><span class="bdg bdg-green">Aktiv</span></div>
              <div class="adm-row-s">${t.defaultReduction==='rut'?'RUT 50 %':t.defaultReduction==='rot'?'ROT 30 %':'Ingen reduktion'} · Moms ${esc(_normVat(t.vatRate))} % · ${t.fields.filter(f=>!f.isRut&&!f.isRot).length} fält</div>
            </div>
          </div>`).join('')}</div>`,
        { flush: true, subHtml: 'Definierar prismodell, RUT/ROT-typ och fält. Kan inte redigeras här.' });

    /* ── Data & system ─────────────────────────────────── */
    const stat = (label, n) => `<div class="adm-stat"><span>${esc(label)}</span><b>${esc(fmt(n))}</b></div>`;
    sections.system =
      this._head('Data & import', 'Översikt över registren samt import och export.') +
      this._card('server', 'Dataöversikt',
        `<div class="adm-stats">
          ${stat('Kunder', (state.customers||[]).length)}${stat('Arbetsorder', (state.workOrders||[]).length)}
          ${stat('Offerter', (state.offers||[]).length)}${stat('Fakturor', (state.invoices||[]).length)}
          ${stat('Återkommande', (state.recurringOrders||[]).length)}${stat('Tidsposter', (state.timeEntries||[]).length)}
        </div>`) +
      this._card('upload', 'Import & export',
        `<p class="ar-help">Importera kunder från CSV eller XLSX. Historik och ångra finns i importloggen.</p>
         <div class="adm-actions">
           <button type="button" class="btn bs bsm" onclick="Router.showPage('pg-import-wizard',{type:'customer'})">${ic('upload',14)}<span>Importera kunder</span></button>
           <button type="button" class="btn bs bsm" onclick="Router.showPage('pg-import-log',{})">${ic('history',14)}<span>Importlogg (${(state.importLogs||[]).length})</span></button>
         </div>`) +
      this._card('wrench', 'Teknik & underhåll',
        `<p class="ar-help">Push-diagnostik och rensning av lokal cache på den här enheten finns i ett eget avsnitt.</p>
         <div class="adm-actions"><button type="button" class="btn bs bsm" onclick="AdminPage._go('teknik')">${ic('wrench',14)}<span>Teknisk information och underhåll</span>${ic('chevron-right',14)}</button></div>`);

    /* ── Mobilnotiser ──────────────────────────────────── */
    const push    = typeof PushService !== 'undefined' ? PushService : null;
    const pSupp   = push ? push.isSupported() : false;
    const pState  = push ? push.permissionState() : 'unsupported';
    const pIOS    = push ? push.isIOS() : false;
    const pSA     = push ? push.isStandalone() : false;
    const pKey    = push ? push._vapidKey() : '';
    const pReason = push ? push.blockReason() : 'unsupported';

    const statusBadge = () => {
      if (!pSupp)                   return '<span class="bdg bdg-grey">Ej stödd</span>';
      if (pIOS && !pSA)             return '<span class="bdg bdg-grey">Kräver hemskärmsapp</span>';
      if (!pKey)                    return '<span class="bdg bdg-orange">VAPID saknas</span>';
      if (pState === 'denied')      return '<span class="bdg bdg-red">Blockerad</span>';
      if (pState === 'granted')     return '<span class="bdg bdg-green">Aktiv</span>';
      return '<span class="bdg bdg-grey">Ej aktiverad</span>';
    };
    const note = (tone, icon, title, body) => `<div class="ar-note is-${tone}" role="note">${ic(icon,16)}<div><strong>${title}</strong><p>${body}</p></div></div>`;
    const iosNote = pIOS && !pSA ? note('warn', 'phone', 'iPhone kräver hemskärmsapp',
      'Pushnotiser fungerar bara när CRM är installerat via Safari → Dela → Lägg till på hemskärmen. Öppna appen därifrån och kom sedan hit för att aktivera notiser.') : '';
    const deniedNote = pState === 'denied' ? note('danger', 'x-circle', 'Notiser blockerade av systemet',
      `Du har nekat notisbehörighet. Gå till ${pIOS ? 'iPhone-inställningar → VIFT CRM → Notiser' : 'webbläsarens webbplatsinställningar'} och tillåt notiser.`) : '';
    const vapidNote = !pKey ? note('warn', 'key', 'VAPID-nyckel saknas — notiser kan inte aktiveras',
      'Servern saknar den publika nyckeln för push. Åtgärden beskrivs under Teknik & underhåll.') : '';
    const vapidSteps = !pKey ? `<div class="adm-tech-steps">
        <strong>Åtgärda VAPID-nyckeln i 4 steg</strong>
        <p><code>window.VIFT_CONFIG.vapidPublicKey</code> är tom i <code>config.js</code> på servern.</p>
        <ol>
          <li>Generera nyckelpar: <code>npx web-push generate-vapid-keys --json</code></li>
          <li>Kopiera <code>publicKey</code>-värdet (börjar med B…)</li>
          <li>Redigera <code>config.js</code> på Loopia: <code>vapidPublicKey: 'B...'</code></li>
          <li>Ladda upp filen och ladda om sidan</li>
        </ol>
        <button type="button" class="btn bs bsm" onclick="location.reload()">${ic('refresh-cw',14)}<span>Ladda om sidan</span></button>
      </div>` : '';

    const canAct = pSupp && (!pIOS || pSA) && pKey && pState !== 'denied';
    /* V44 §1: lokal-notistest kräver INGEN VAPID-nyckel, INGEN subscription
       och ingen server — bara Notification API + service worker. Ska alltså
       vara tillgänglig oberoende av `canAct` (som bland annat kräver VAPID). */
    const canLocalTest = 'serviceWorker' in navigator && 'Notification' in window;
    const permTxt = pState === 'granted' ? 'Tillåten' : pState === 'denied' ? 'Blockerad' : pState === 'unsupported' ? 'Stöds inte' : 'Ej frågad';
    const browser = (() => { const ua = navigator.userAgent;
      return /CriOS/i.test(ua) ? 'Chrome (iOS)' : /FxiOS/i.test(ua) ? 'Firefox (iOS)' :
             /Safari/i.test(ua) && !/Chrome/i.test(ua) ? 'Safari' : /Chrome/i.test(ua) ? 'Chrome' : 'Okänd webbläsare'; })();
    const device = (pIOS ? 'iOS' : (navigator.platform || navigator.userAgent.split(' ').pop())) + ' · ' + browser;
    const reasonTxt =
      pReason === 'no-vapid-key'       ? 'VAPID-nyckel saknas i config.js — se Teknik & underhåll' :
      pReason === 'ios-not-standalone' ? 'Öppna appen från hemskärmen, inte i Safari' :
      pReason === 'permission-denied'  ? 'Behörighet blockerad — ändra i systeminställningarna' :
      pReason === 'unsupported'        ? 'Push API stöds ej i den här webbläsaren/OS-versionen' :
      'Kan ej aktivera just nu';

    sections.notiser =
      this._head('Mobilnotiser', 'Pushnotiser när en arbetsorder tilldelas dig eller vid viktiga händelser — även när appen är stängd.', `<span id="push-status-badge">${statusBadge()}</span>`) +
      this._card('phone', 'Den här enheten',
        `<!-- V42 §5: fylls i asynkront av _refreshPushStatus() efter render —
             visar reparationsläge om browsern har en lokal subscription
             som saknas/är revokad på servern. -->
         <div id="push-server-note"></div>
         ${iosNote}${deniedNote}${vapidNote}
         <dl class="adm-facts">
           ${fact('Behörighet', permTxt)}${fact('Appläge', pSA ? 'Hemskärmsapp' : 'Webbläsare')}
         </dl>
         <div class="adm-actions">
           ${canAct ? `
             <button type="button" class="btn bp bsm" onclick="AdminPage._activatePush()">${ic('bell',14)}<span>Aktivera notiser</span></button>
             <button type="button" class="btn bs bsm" onclick="AdminPage._testPush()">${ic('send',14)}<span>Skicka testnotis</span></button>
             <button type="button" class="btn bs bsm" onclick="AdminPage._deactivatePush()">${ic('x-circle',14)}<span>Stäng av</span></button>
           ` : `
             <button type="button" class="btn bp bsm" disabled>${ic('bell',14)}<span>Aktivera notiser</span></button>
             <span class="adm-muted">${esc(reasonTxt)}</span>
           `}
           ${canLocalTest ? `<button type="button" class="btn bs bsm" onclick="AdminPage._testLocalNotification()">${ic('phone',14)}<span>Testa lokal iPhone-notis</span></button>` : ''}
         </div>
         <div id="push-status-msg" class="adm-msg" aria-live="polite"></div>
         <!-- V44 §7: fylls i av _renderPushTestDiagBox() efter Skicka testnotis
              (provider/HTTP/endpoint-suffix för DEN HÄR enheten) — ihopfällt. -->
         <details class="ar-def adm-test-det">
           <summary>${ic('info',15)}<span>Detaljer om senaste testnotis</span>${ic('chevron-down',15)}</summary>
           <div class="ar-def-b"><div id="push-test-result-box"><p class="ar-help">Visas efter "Skicka testnotis".</p></div></div>
         </details>`,
        { actions: `<button type="button" class="btn bghost bsm" onclick="AdminPage._go('teknik')">${ic('wrench',14)}<span>Teknisk information</span></button>` });

    /* ── Teknik & underhåll (sist, skild från användarinställningar) ──
       QA-tillägg 2026-11-26: push-diagnostiken och rensningen av lokal
       cache samlas här. Diagnostiken visar bara den här enhetens status och
       endpoint-suffix — aldrig nycklar (utöver om den publika VAPID-nyckeln
       är konfigurerad), JWT eller andra användares endpoints. */
    const unsynced = this._localUnsynced();
    const unsyncedN = unsynced.reduce((a, p) => a + p.n, 0);
    sections.teknik =
      this._head('Teknisk information och underhåll', 'För felsökning och support. Påverkar bara den här enheten — inte andra användare eller serverns data.') +
      this._card('bell', 'Push-diagnostik för den här enheten',
        `<dl class="adm-facts">
           ${fact('Push API', pSupp ? 'Stödd' : 'Saknas')}${fact('Publik VAPID-nyckel', pKey ? 'Konfigurerad' : 'Saknas')}
           ${fact('Behörighet', permTxt)}${fact('Enhet', device)}
         </dl>
         <!-- V44 §2: fylls i asynkront av _refreshPushDiagBox() — PWA/push-
              diagnostik (permission/standalone/service worker/subscription),
              visar ALDRIG nycklar/JWT/hela endpointen. -->
         <div id="push-diag-box" class="adm-diag">Läser diagnostik…</div>
         ${vapidSteps}
         <p class="ar-help"><strong>Gammal version?</strong> Öppna webbläsarens inställningar → Rensa webbplatsdata för crm.viftfast.se → Ladda om. iOS 16.4+ krävs på iPhone.</p>`) +
      this._card('trash', 'Rensa lokal cache på den här enheten',
        `<p class="ar-help">Tar bort den data som appen sparat i den här webbläsaren (kopior av register, köer, lokala vyinställningar som dashboardlayout och sparade filter) och laddar om sidan. Allt hämtas sedan på nytt från servern.</p>
         <ul class="adm-bullets">
           <li><strong>Serverns data påverkas inte</strong> — inga kunder, arbetsordrar eller tider raderas.</li>
           <li>Du <strong>förblir inloggad</strong> och uppladdade logotyper (som bara finns på den här enheten) behålls.</li>
           <li>Ändringar som ännu inte nått servern försvinner. Därför kontrolleras kön först.</li>
         </ul>
         <div id="adm-unsynced">${unsyncedN > 0
           ? `<div class="ar-note is-danger" role="note">${ic('alert-triangle',16)}<div><strong>${unsyncedN} ändring${unsyncedN === 1 ? '' : 'ar'} på den här enheten är inte sparade på servern</strong><p>${unsynced.map(p => esc(p.n + ' ' + p.label)).join(' · ')}. Vänta tills de skickats (kräver nätverk) innan du rensar.</p></div></div>`
           : `<div class="ar-note is-info" role="note">${ic('check',16)}<div><strong>Inga osparade ändringar i kön</strong><p>Allt på den här enheten är bekräftat av servern.</p></div></div>`}</div>
         <div class="adm-actions"><button type="button" class="btn bd bsm" onclick="AdminPage._clearLocalCache()">${ic('trash',14)}<span>Rensa lokal cache på den här enheten</span></button></div>`,
        { cls: 'is-danger' });

    /* ── Fastighetskort: kategorier & fält ─────────────── */
    const propCats = (state.propertyCategories || []).sort((a,b) => (a.order||99)-(b.order||99));
    sections.fastighetskort =
      this._head('Kategorier & fält', 'Tekniska systemkategorier och deras fält i fastighetskortet.',
        `<button type="button" class="btn bp bsm" onclick="AdminPage.openAddCategory()">${ic('plus',14)}<span>Ny kategori</span></button>`) +
      this._card('layers', 'Kategorier',
        propCats.length === 0
          ? `<p class="ar-empty">Inga kategorier. Ladda om sidan för att läsa in standardkategorier.</p>`
          : `<div class="adm-list">${propCats.map(cat => {
              const activeFields = (cat.fields||[]).filter(f=>f.active!==false).length;
              const totalFields  = (cat.fields||[]).length;
              const on = cat.active !== false;
              return `<div class="adm-row${on ? '' : ' is-off'}">
                <span class="adm-row-ico">${ic(cat.icon||'folder',16)}</span>
                <div class="adm-row-m">
                  <div class="adm-row-t"><span class="adm-row-n">${esc(cat.label)}</span>${this._activeBadge(on)}</div>
                  <div class="adm-row-s">${activeFields} av ${totalFields} fält aktiva · <span class="adm-mono">${esc(cat.slug)}</span></div>
                </div>
                <div class="adm-row-a">
                  <button type="button" class="btn bs bsm" data-id="${esc(cat.id)}" onclick="AdminPage.openManageFields(this.dataset.id)">${ic('list',14)}<span>Fält</span></button>
                  ${this._ibtn('pencil', 'Redigera ' + cat.label, 'AdminPage.openEditCategory(this.dataset.id)', cat.id, { title: 'Redigera kategori' })}
                </div>
              </div>`;
            }).join('')}</div>`,
        { flush: propCats.length > 0 });

    /* ── Ansvariga: titelregister (Leverans D) ──────────── */
    const propRoles = state.propertyRoles || [];
    const scopeTxt = (r) => r.scope === 'property' ? 'Fastighet' : r.scope === 'object' ? 'Objekt' : 'Fastighet & objekt';
    sections.ansvariga =
      this._head('Ansvariga per fastighet', 'Titlar som kan kopplas till personal och kontakter per fastighet eller objekt.',
        `<button type="button" class="btn bp bsm" onclick="AdminPage.openAddPropRole()">${ic('plus',14)}<span>Ny titel</span></button>`) +
      this._card('user-check', 'Titelregister',
        propRoles.length === 0
          ? `<p class="ar-empty">Inga titlar. Lägg till t.ex. Ansvarig förvaltare, Fastighetsskötare eller Felanmälningskontakt.</p>`
          : `<div class="adm-list">${propRoles.map(r => {
              const on = r.active !== false;
              return `<div class="adm-row${on ? '' : ' is-off'}">
                <div class="adm-row-m">
                  <div class="adm-row-t"><span class="adm-row-n">${esc(r.name)}</span>${this._activeBadge(on)}</div>
                  <div class="adm-row-s">${scopeTxt(r)}${r.isInternal ? '' : ' · Extern'}${r.onlyOnePrimary ? ' · Max 1 primär' : ''}</div>
                </div>
                <div class="adm-row-a">
                  ${this._ibtn('pencil', 'Redigera ' + r.name, 'AdminPage.openEditPropRole(this.dataset.id)', r.id, { title: 'Redigera' })}
                  ${this._ibtn(on ? 'eye-off' : 'eye', (on ? 'Inaktivera ' : 'Aktivera ') + r.name, 'AdminPage.togglePropRole(this.dataset.id)', r.id, { title: on ? 'Inaktivera' : 'Aktivera' })}
                </div>
              </div>`;
            }).join('')}</div>`,
        { flush: propRoles.length > 0 });

    /* ── Avvikelsekategorier (Fas 4B) ──────────────────── */
    const devCats = state.deviationCategories || [];
    const safeColor = (c) => /^#[0-9a-f]{3,8}$/i.test(c || '') ? c : 'var(--muted)';
    sections.avvikelse =
      this._head('Avvikelsekategorier', 'Kategorier för strukturerade anmärkningar från ronderingar.',
        `<button type="button" class="btn bp bsm" onclick="AdminPage.openAddDevCat()">${ic('plus',14)}<span>Ny kategori</span></button>`) +
      this._card('alert-triangle', 'Kategorier',
        devCats.length === 0
          ? `<p class="ar-empty">Inga avvikelsekategorier ännu. Skapa din första kategori.</p>`
          : `<div class="adm-list">${devCats.map(c => {
              const on = c.active !== false;
              return `<div class="adm-row${on ? '' : ' is-off'}">
                <span class="adm-row-ico" style="color:${safeColor(c.color)}">${ic(c.icon||'alert-triangle',16)}</span>
                <div class="adm-row-m"><div class="adm-row-t"><span class="adm-row-n">${esc(c.name)}</span>${this._activeBadge(on)}</div></div>
                <div class="adm-row-a">
                  ${this._ibtn('pencil', 'Redigera ' + c.name, 'AdminPage.openEditDevCat(this.dataset.id)', c.id, { title: 'Redigera' })}
                  ${this._ibtn(on ? 'eye-off' : 'eye', (on ? 'Inaktivera ' : 'Aktivera ') + c.name, 'AdminPage.toggleDevCat(this.dataset.id)', c.id, { title: on ? 'Inaktivera' : 'Aktivera' })}
                </div>
              </div>`;
            }).join('')}</div>`,
        { flush: devCats.length > 0 });

    /* ── Punkt 80: E-post-mallar ───────────────────────────── */
    const tmpls = (state.emailTemplates || []).sort((a,b)=>(a.sortOrder||99)-(b.sortOrder||99));
    const typeLbl = { send_offer: 'Skicka offert', reminder: 'Påminnelse offert', approved: 'Tack för godkännande', followup: 'Uppföljning', declined: 'Tack för återkoppling', new_ao: 'Ny arbetsorder (intern)', 'övrigt': 'Övrigt' };
    sections.epost =
      this._head('E-post-mallar', 'Mallar för offertutskick, påminnelser och bekräftelser.',
        `<button type="button" class="btn bp bsm" onclick="AdminPage.openEditEmailTemplate(null)">${ic('plus',14)}<span>Ny mall</span></button>`) +
      this._card('mail', 'Mallar',
        tmpls.length === 0
          ? `<p class="ar-empty">Inga e-post-mallar. Skapa din första mall.</p>`
          : `<div class="adm-list">${tmpls.map(t => {
              const on = t.active !== false;
              return `<div class="adm-row${on ? '' : ' is-off'}">
                <div class="adm-row-m">
                  <div class="adm-row-t"><span class="adm-row-n">${esc(t.name||'Namnlös mall')}</span>${t.type && typeLbl[t.type] ? `<span class="cat-tag">${esc(typeLbl[t.type])}</span>` : ''}${this._activeBadge(on)}</div>
                  ${t.subject ? `<div class="adm-row-s"><b>Ämne:</b> ${esc(t.subject)}</div>` : ''}
                  <div class="adm-row-s adm-clamp">${esc((t.body||'').slice(0,160))}</div>
                </div>
                <div class="adm-row-a">
                  ${this._ibtn('pencil', 'Redigera ' + (t.name || 'mall'), 'AdminPage.openEditEmailTemplate(this.dataset.id)', t.id, { title: 'Redigera' })}
                  ${this._ibtn(on ? 'eye-off' : 'eye', (on ? 'Inaktivera ' : 'Aktivera ') + (t.name || 'mall'), 'AdminPage.toggleEmailTemplate(this.dataset.id)', t.id, { title: on ? 'Inaktivera' : 'Aktivera' })}
                </div>
              </div>`;
            }).join('')}</div>`,
        { flush: tmpls.length > 0, subHtml: 'Variabler: <code>{{firstName}}</code> <code>{{offerId}}</code> <code>{{validUntil}}</code> <code>{{viftPhone}}</code> m.fl.' });

    el.innerHTML = `<div class="adm">${this._navHtml()}<div class="adm-main" id="adm-main" data-tab="${this._tab}">${sections[this._tab] || sections.foretag}</div></div>`;

    /* V42 §5: statusBadge() ovan speglar bara browser-permission (synkront,
       tillgängligt vid render-tid). Serverregistreringen kan bara kollas
       async (nätverksanrop) — patchas in i DOM:et separat, utan att göra
       hela render() async. Fire-and-forget; om användaren hunnit byta
       flik innan svaret kommer skippas patchningen tyst (se _refreshPushStatus). */
    if (this._tab === 'notiser') this._refreshPushStatus();
    if (this._tab === 'teknik') this._refreshPushDiagBox();
  },

  /* V44 §2: hämtar PWA/push-diagnostik (permission/standalone/service worker/
     subscription) och patchar in den i redan renderad DOM. Samma "fire-and-
     forget, skippa om elementet är borta"-mönster som _refreshPushStatus(). */
  async _refreshPushDiagBox() {
    if (typeof PushService === 'undefined') return;
    let d;
    try { d = await PushService.getDiagnostics(); }
    catch { return; }

    const el = document.getElementById('push-diag-box');
    if (!el) return; /* användaren bytte flik under tiden */

    /* V3 2026-11-26 (F-21): samma diagnostik som förut, men bara inne i
       den ihopfällda "Teknisk information" — som en lugn faktalista. */
    const yn = (v) => v ? 'Ja' : 'Nej';
    const row = (k, v) => `<div class="dr"><span class="dk">${k}</span><span class="dv">${v}</span></div>`;
    el.innerHTML = `
      <div class="adm-diag-h">PWA/push-diagnostik</div>
      <div class="kv adm-kv adm-kv-sm">
        ${row('Notification.permission', esc(d.permission))}
        ${row('Standalone (display-mode)', yn(d.standalone))}
        ${row('Service worker', 'registrerad ' + yn(d.serviceWorker.registered).toLowerCase() + ' · aktiv ' + yn(d.serviceWorker.active).toLowerCase() + ' · state ' + esc(d.serviceWorker.state || '—'))}
        ${row('scriptURL', `<code>${esc(d.serviceWorker.scriptURL || '—')}</code>`)}
        ${row('registration.pushManager', yn(d.hasPushManagerOnRegistration))}
        ${row('Browser-subscription', yn(d.browserSubscription.exists) + (d.browserSubscription.exists
          ? ' · …' + esc(d.browserSubscription.endpointSuffix || '') + ' (' + esc(d.browserSubscription.providerHost || '?') + ')' : ''))}
        ${row('window.pushManager', yn(d.windowPushManager.exists) + (d.windowPushManager.exists
          ? ' · matchar SW-subscription: ' + (d.windowPushManager.matchesSwSubscription === null ? 'okänt' : yn(d.windowPushManager.matchesSwSubscription)) : ''))}
      </div>`;
  },

  /* Statusrad under knapparna (ok/err/info). text escapas alltid. */
  _pushMsg(kind, text) {
    const msg = document.getElementById('push-status-msg');
    if (!msg) return;
    msg.innerHTML = text ? `<span class="adm-msg-${kind}">${esc(text)}</span>` : '';
  },

  /* V44 §1: kör lokalt notistest — anropar bara PushService, ingen server/push. */
  async _testLocalNotification() {
    this._pushMsg('info', 'Skapar lokal testnotis…');
    try {
      await PushService.showLocalTestNotification();
      this._pushMsg('ok', 'Lokal test skickad till Notifications API.');
    } catch(e) {
      this._pushMsg('err', 'Lokal notis kunde inte skapas: ' + (e && e.message));
    }
  },

  /* V44 §7: rik diagnostikruta efter "Skicka testnotis" — Server (provider/
     HTTP/APNs-ID/endpoint-suffix) + Push-event (mottaget hos service workern,
     se _pollPushDiagReceived). Ligger under "Teknisk information". */
  _renderPushTestDiagBox(result, sentAt) {
    const el = document.getElementById('push-test-result-box');
    if (!el) return;
    const diag = result && result.diagnostics;
    const row = (k, v) => `<div class="dr"><span class="dk">${k}</span><span class="dv">${v}</span></div>`;
    const serverHtml = diag
      ? row('Provider', esc(diag.provider || '—')) + row('HTTP', diag.statusCode != null ? esc(diag.statusCode) : '—') +
        row('APNs-ID', esc(diag.apnsId || '—')) + row('Endpoint', '…' + esc(diag.endpointSuffix || '—')) +
        (diag.body ? row('Svar', esc(diag.body)) : '')
      : row('Server', 'ingen riktad diagnostik tillgänglig för det här svaret (t.ex. ingen aktuell enhets-endpoint kunde skickas)');

    el.innerHTML = `
      <div class="adm-diag-h">Senaste testnotis</div>
      <div class="kv adm-kv adm-kv-sm">
        ${serverHtml}
        ${row('Permission', esc(PushService.permissionState()))}
        ${row('Standalone', PushService.isStandalone() ? 'Ja' : 'Nej')}
        ${row('Push-event', '<span id="push-diag-received-status">Väntar…</span>')}
      </div>`;

    this._pollPushDiagReceived(sentAt, 0);
  },

  /* V44 §6/§7: pollar PushService._diag.lastPushReceivedAt (satt av SW:s
     VIFT_PUSH_RECEIVED_DIAG-meddelande) tills den syns eller det gått ~8s. */
  _pollPushDiagReceived(sentAt, attempt) {
    const statusEl = document.getElementById('push-diag-received-status');
    if (!statusEl) return; /* boxen borta — sluta polla */
    const receivedAt = (typeof PushService !== 'undefined') ? PushService._diag.lastPushReceivedAt : null;
    if (receivedAt && receivedAt >= sentAt) {
      statusEl.textContent = 'Mottaget (' + new Date(receivedAt).toLocaleTimeString('sv-SE') + ')';
      return;
    }
    if (attempt >= 16) {
      statusEl.textContent = 'Ej mottaget (efter 8 s)';
      return;
    }
    setTimeout(() => this._pollPushDiagReceived(sentAt, attempt + 1), 500);
  },

  /* V42 §5: hämtar faktisk serverregistreringsstatus och patchar in den i
     redan renderad DOM (badge + ev. reparationsnotis). Anropas efter varje
     render() av Notiser-fliken samt efter aktivera/testa/stäng av. */
  async _refreshPushStatus() {
    if (typeof PushService === 'undefined') return;
    let status;
    try { status = await PushService.getSubscriptionStatus(); }
    catch { return; }

    const badgeEl = document.getElementById('push-status-badge');
    const noteEl  = document.getElementById('push-server-note');
    if (!badgeEl && !noteEl) return; /* användaren bytte flik under tiden */

    if (status.browserSubscribed && status.serverRegistered) {
      if (badgeEl) badgeEl.innerHTML = `<span class="bdg bdg-green">${ic('check',11)}Aktiv på den här enheten</span>`;
      if (noteEl) noteEl.innerHTML = '';
    } else if (status.browserSubscribed && !status.serverRegistered) {
      if (badgeEl) badgeEl.innerHTML = `<span class="bdg bdg-orange">${ic('alert-triangle',11)}Behöver repareras</span>`;
      if (noteEl) noteEl.innerHTML = `
        <div class="ar-note is-warn" role="note">${ic('alert-triangle',16)}<div>
          <strong>Prenumerationen behöver repareras</strong>
          <p>Den här enheten har en lokal notisprenumeration, men den saknas (eller har gått ut) på servern — inga notiser kommer fram just nu.
          Klicka <strong>Aktivera notiser</strong> igen för att reparera. Ingen data rensas och du behöver inte tillåta notiser på nytt.</p>
        </div></div>`;
    }
    /* browserSubscribed=false: den ursprungliga permission-baserade badgen
       (Ej aktiverad / Blockerad / VAPID saknas m.fl.) är redan korrekt —
       lämnas orörd. */
  },

  /* ── E-post-mallar CRUD (Punkt 80) ──────────────────────── */
  openEditEmailTemplate(id) {
    const t = id ? (state.emailTemplates||[]).find(x=>x.id===id) : null;
    const isNew = !t;
    const typeOpts = [
      { key:'send_offer',  label:'Skicka offert'           },
      { key:'reminder',    label:'Påminnelse offert'       },
      { key:'approved',    label:'Tack för godkännande'    },
      { key:'followup',    label:'Uppföljning'             },
      { key:'declined',    label:'Tack för återkoppling'   },
      { key:'new_ao',      label:'Ny arbetsorder (intern)' },
      { key:'övrigt',      label:'Övrigt'                  }
    ].map(x=>`<option value="${x.key}"${(t?.type||'övrigt')===x.key?' selected':''}>${esc(x.label)}</option>`).join('');

    Modal.open({
      title: isNew ? ic('mail',13) + ' Ny e-post-mall' : ic('pencil',13) + ' Redigera e-post-mall',
      body: `<div style="display:flex;flex-direction:column;gap:12px;">
        <div style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end;">
          <div class="fg"><label>Mallnamn *</label><input class="form-control" id="et-name" value="${esc(t?.name||'')}" placeholder="Namn på mallen"></div>
          <div class="fg"><label>Typ</label><select class="form-control" id="et-type">${typeOpts}</select></div>
        </div>
        <div class="fg"><label>Ämnesrad *</label><input class="form-control" id="et-subj" value="${esc(t?.subject||'')}" placeholder="Ämnesrad med {{variabler}}"></div>
        <div class="fg">
          <label>Meddelandetext *</label>
          <textarea class="form-control" id="et-body" rows="10" style="font-family:monospace;font-size:12px;">${esc(t?.body||'')}</textarea>
          <div style="font-size:10px;color:var(--mt);margin-top:4px;">Tillgängliga variabler: <code>{{firstName}}</code> <code>{{offerId}}</code> <code>{{titleSuffix}}</code> <code>{{validUntil}}</code> <code>{{sentDate}}</code> <code>{{paymentLine}}</code> <code>{{viftPhone}}</code></div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;font-size:12px;">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" id="et-active" ${t?.active!==false?'checked':''}> Aktiv</label>
          <div class="fg" style="margin:0;display:flex;align-items:center;gap:6px;">
            <label style="margin:0;">Sortering</label>
            <input type="number" class="form-control" id="et-sort" value="${t?.sortOrder||99}" min="1" max="999" style="width:70px;">
          </div>
        </div>
      </div>`,
      okLabel: isNew ? 'Skapa mall' : 'Spara',
      ok: () => {
        const name = document.getElementById('et-name')?.value.trim();
        const subj = document.getElementById('et-subj')?.value.trim();
        const body = document.getElementById('et-body')?.value;
        if (!name || !subj || !body) { showToast('Namn, ämne och text krävs', 'error'); return; }
        const now = new Date().toISOString();
        if (t) {
          t.name      = name;
          t.type      = document.getElementById('et-type')?.value   || 'övrigt';
          t.subject   = subj;
          t.body      = body;
          t.active    = document.getElementById('et-active')?.checked !== false;
          t.sortOrder = parseInt(document.getElementById('et-sort')?.value||'99',10);
          t.updatedAt = now;
        } else {
          if (!state.emailTemplates) state.emailTemplates = [];
          state.emailTemplates.push({
            id:        newId(state.emailTemplates, 'ET'),
            name,
            type:      document.getElementById('et-type')?.value || 'övrigt',
            subject:   subj,
            body,
            active:    document.getElementById('et-active')?.checked !== false,
            sortOrder: parseInt(document.getElementById('et-sort')?.value||'99',10),
            createdAt: now,
            updatedAt: now
          });
        }
        Modal.close();
        AdminPage._tab = 'epost';
        AdminPage.render();
        const tplId = t ? t.id : state.emailTemplates[state.emailTemplates.length - 1].id;
        confirmPersist('emailTemplates', tplId, { ok: t ? 'Mall sparad' : 'Mall skapad', fail: 'Mallen kunde inte sparas', onChange: () => AdminPage.render() });
      }
    });
  },

  toggleEmailTemplate(id) {
    const t = (state.emailTemplates||[]).find(x=>x.id===id);
    if (!t) return;
    t.active    = !t.active;
    t.updatedAt = new Date().toISOString();
    persist();
    AdminPage._tab = 'epost';
    AdminPage.render();
    showToast(t.active ? 'Mall aktiverad' : 'Mall inaktiverad');
  },

  /* ── Avvikelsekategorier CRUD ────────────────────────── */

  openAddDevCat() {
    this._devCatForm(null);
  },

  openEditDevCat(id) {
    const c = (state.deviationCategories || []).find(x => x.id === id);
    if (c) this._devCatForm(c);
  },

  _devCatForm(cat) {
    const isEdit = !!cat;
    Modal.open({
      title: (isEdit ? ic('pencil',14) + ' Redigera' : ic('plus',14) + ' Ny') + ' avvikelsekategori',
      body: `
        <div class="fg"><label>Namn *</label>
          <input type="text" id="dc-name" value="${cat ? esc(cat.name) : ''}" placeholder="T.ex. Säkerhet, Skada, Slitage..."></div>
        <div class="fg"><label>Ikon (lucide-namn)</label>
          <input type="text" id="dc-icon" value="${cat ? esc(cat.icon||'alert-triangle') : 'alert-triangle'}" placeholder="alert-triangle"></div>
        <div class="fg"><label>Färg</label>
          <input type="color" id="dc-color" value="${cat ? (cat.color||'#6366f1') : '#6366f1'}" style="height:36px;width:60px;border:none;cursor:pointer;border-radius:6px;">
        </div>`,
      buttons: [
        { label: isEdit ? 'Spara' : 'Skapa', cls: 'btn bp', onClick: () => this._saveDevCat(cat ? cat.id : null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _saveDevCat(id) {
    const name  = ((document.getElementById('dc-name')||{}).value||'').trim();
    if (!name) { showToast('Ange namn'); return; }
    const icon  = ((document.getElementById('dc-icon')||{}).value||'alert-triangle').trim();
    const color = (document.getElementById('dc-color')||{}).value || '#6366f1';
    const now   = new Date().toISOString();
    if (id) {
      const c = (state.deviationCategories || []).find(x => x.id === id);
      if (c) { c.name = name; c.icon = icon; c.color = color; c.updatedAt = now; }
    } else {
      if (!state.deviationCategories) state.deviationCategories = [];
      state.deviationCategories.push(Object.assign(Schema.deviationCategory(), {
        id: newId(state.deviationCategories, 'DEVCAT'), name, icon, color, createdAt: now, updatedAt: now
      }));
    }
    persist();
    Modal.close();
    this.render();
  },

  toggleDevCat(id) {
    const c = (state.deviationCategories || []).find(x => x.id === id);
    if (!c) return;
    c.active = !c.active;
    c.updatedAt = new Date().toISOString();
    persist();
    this.render();
  },

  /* ── Titelregister för ansvariga (Leverans D) ────────────── */

  openAddPropRole() { this._propRoleForm(null); },
  openEditPropRole(id) {
    const r = (state.propertyRoles || []).find(x => x.id === id);
    if (r) this._propRoleForm(r);
  },
  _propRoleForm(role) {
    const isEdit = !!role;
    Modal.open({
      title: isEdit ? ic('pencil',14) + ' Redigera titel' : ic('plus',14) + ' Ny ansvarstitel',
      body: `
        <div class="fg"><label>Namn *</label>
          <input type="text" id="pr-name" value="${role ? esc(role.name) : ''}" placeholder="T.ex. Ansvarig förvaltare...">
        </div>
        <div class="fg"><label>Beskrivning</label>
          <input type="text" id="pr-desc" value="${role ? esc(role.description||'') : ''}" placeholder="Valfri beskrivning...">
        </div>
        <div class="fg"><label>Tillämpning</label>
          <select id="pr-scope" class="fi">
            <option value="property" ${!role||role.scope==='property'?'selected':''}>Fastighet</option>
            <option value="object" ${role&&role.scope==='object'?'selected':''}>Objekt</option>
            <option value="both" ${role&&role.scope==='both'?'selected':''}>Fastighet & objekt</option>
          </select>
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-top:6px;">
          <input type="checkbox" id="pr-primary" ${role&&role.onlyOnePrimary?'checked':''}> Max 1 primär per fastighet
        </label>`,
      buttons: [
        { label: isEdit ? 'Spara' : 'Skapa', cls: 'btn bp', onClick: () => this._savePropRole(role ? role.id : null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },
  _savePropRole(id) {
    const name = ((document.getElementById('pr-name')||{}).value||'').trim();
    if (!name) { showToast('Ange namn'); return; }
    const desc         = (document.getElementById('pr-desc')||{}).value||'';
    const scope        = (document.getElementById('pr-scope')||{}).value||'property';
    const onlyOnePrimary = !!(document.getElementById('pr-primary')||{}).checked;
    const data = { name, description: desc, scope, onlyOnePrimary };
    if (id) {
      PropertyContactService.updateRole(id, data);
    } else {
      PropertyContactService.createRole(data);
    }
    Modal.close();
    this.render();
  },
  togglePropRole(id) {
    PropertyContactService.toggleRoleActive(id);
    this.render();
  },

  /* ── Fält-CRUD per kategori ──────────────────────────────── */

  _labelToKey(label) {
    const latin = label.toLowerCase()
      .replace(/å/g,'a').replace(/ä/g,'a').replace(/ö/g,'o')
      .replace(/[^a-z0-9\s]/g,' ').trim().replace(/\s+/g,' ');
    const words = latin.split(' ').filter(Boolean);
    if (!words.length) return 'field';
    return words[0] + words.slice(1).map(w => w[0].toUpperCase() + w.slice(1)).join('');
  },

  _fieldTypeLabel(t) {
    return { text:'Text',textarea:'Lång text',date:'Datum',number:'Nummer',boolean:'Ja/Nej',
             dropdown:'Lista',link:'Länk',phone:'Telefon',email:'E-post',
             interval:'Intervall',status:'Status',comment:'Kommentar' }[t] || t;
  },

  _fieldHasData(catSlug, fieldKey) {
    return (state.properties||[]).some(p => {
      const t = (p.technicalSystems||{})[catSlug];
      if (!t || typeof t !== 'object') return false;
      return t[fieldKey] !== undefined && t[fieldKey] !== null && t[fieldKey] !== '';
    });
  },

  openManageFields(catId) {
    const cat = (state.propertyCategories||[]).find(c => c.id === catId);
    if (!cat) return;
    if (!cat.fields) cat.fields = [];
    const fields = [...cat.fields].sort((a,b) => (a.order||99)-(b.order||99));
    const typeColors = { date:'bdg-sky',number:'bdg-sky',boolean:'bdg-purple',
                         dropdown:'bdg-purple',status:'bdg-purple',interval:'bdg-purple',
                         link:'bdg-blue',phone:'bdg-green',email:'bdg-green',
                         textarea:'bdg-grey',comment:'bdg-grey' };

    const rows = fields.length === 0
      ? `<p style="font-size:12px;color:var(--mt);padding:8px 0;">Inga fält ännu. Lägg till ett fält för att komma igång.</p>`
      : fields.map((f, idx) => {
          const hasData  = this._fieldHasData(cat.slug, f.key);
          const typeCls  = typeColors[f.type] || 'bdg-grey';
          const inactive = f.active === false;
          return `
          <div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--bg);${inactive?'opacity:.55;':''}">
            <div style="display:flex;flex-direction:column;gap:2px;flex-shrink:0;">
              <button class="btn bxs bs" style="padding:2px 5px;font-size:10px;line-height:1;" ${idx===0?'disabled':''} onclick="AdminPage._moveField('${catId}','${f.id}',-1)">${ic('chevron-up',10)}</button>
              <button class="btn bxs bs" style="padding:2px 5px;font-size:10px;line-height:1;" ${idx===fields.length-1?'disabled':''} onclick="AdminPage._moveField('${catId}','${f.id}',1)">${ic('chevron-down',10)}</button>
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:700;color:var(--navy);${inactive?'text-decoration:line-through;':''}">${esc(f.label)}</div>
              <div style="display:flex;align-items:center;gap:4px;margin-top:2px;flex-wrap:wrap;">
                <span class="bdg ${typeCls}" style="font-size:9px;">${this._fieldTypeLabel(f.type)}</span>
                <span style="font-size:9px;color:var(--mt);">key: ${esc(f.key)}</span>
                ${hasData ? `<span class="bdg bdg-orange" style="font-size:9px;">${ic('database',8)} Har data</span>` : ''}
                ${f.required ? `<span class="bdg bdg-red" style="font-size:9px;">Obligatorisk</span>` : ''}
                ${inactive ? `<span style="font-size:9px;color:var(--mt);">Inaktiv</span>` : ''}
              </div>
            </div>
            <button class="btn bxs bs" title="Duplicera" onclick="AdminPage._duplicateField('${catId}','${f.id}')">${ic('copy',11)}</button>
            <button class="btn bxs bs" title="Redigera" onclick="AdminPage.openEditField('${catId}','${f.id}')">${ic('pencil',11)}</button>
            ${inactive
              ? `<button class="btn bxs bs" title="Aktivera" onclick="AdminPage._toggleFieldActive('${catId}','${f.id}',true)">${ic('eye',11)}</button>`
              : `<button class="btn bxs bs" title="Inaktivera" onclick="AdminPage._toggleFieldActive('${catId}','${f.id}',false)">${ic('eye-off',11)}</button>`}
            <button class="btn bxs bd" title="${hasData?'Har data — inaktivera istället':'Ta bort'}" ${hasData?'disabled style="opacity:.4;"':''} onclick="AdminPage._deleteField('${catId}','${f.id}')">${ic('trash',11)}</button>
          </div>`;
        }).join('');

    Modal.open({
      title: `${ic('list',14)} Fält — ${esc(cat.label)}`,
      wide: true,
      body: `
        <div style="margin-bottom:10px;display:flex;justify-content:flex-end;">
          <button class="btn bp bxs" onclick="AdminPage.openAddField('${catId}')">${ic('plus',13)} Lägg till fält</button>
        </div>
        <div id="field-list-${catId}">${rows}</div>`,
      buttons: [{ label: 'Stäng', cls: 'btn bs', onClick: () => Modal.close() }]
    });
  },

  openAddField(catId) {
    const cat = (state.propertyCategories||[]).find(c => c.id === catId);
    if (!cat) return;
    const nextOrder = ((cat.fields||[]).reduce((m,f)=>Math.max(m,f.order||0),0)) + 1;
    const types = ['text','textarea','date','number','boolean','dropdown','link','phone','email','interval','status','comment'];
    Modal.open({
      title: `${ic('plus',14)} Nytt fält — ${esc(cat.label)}`,
      wide: true,
      body: `
        <div class="g2">
          <div class="fg"><label>Fältnamn (label)</label>
            <input id="fl-label" placeholder="T.ex. Senaste service"
              oninput="(function(){var k=AdminPage._labelToKey(document.getElementById('fl-label').value);document.getElementById('fl-key').value=k;})()">
          </div>
          <div class="fg"><label>Nyckel (key, stabil)</label>
            <input id="fl-key" placeholder="senasteService" style="font-family:monospace;font-size:12px;">
          </div>
        </div>
        <div class="g2">
          <div class="fg"><label>Fälttyp</label>
            <select id="fl-type" onchange="AdminPage._toggleOptionsField()">
              ${types.map(t=>`<option value="${t}">${this._fieldTypeLabel(t)}</option>`).join('')}
            </select>
          </div>
          <div class="fg"><label>Sorteringsordning</label>
            <input type="number" id="fl-order" value="${nextOrder}">
          </div>
        </div>
        <div class="fg" id="fl-options-wrap" style="display:none;">
          <label>Valalternativ (ett per rad, för Lista/Status)</label>
          <textarea id="fl-options" rows="4" placeholder="T.ex.&#10;Godkänd&#10;Ej utförd&#10;Planerad"></textarea>
        </div>
        <div style="display:flex;gap:16px;margin-top:4px;">
          <label style="display:flex;align-items:center;gap:6px;font-weight:600;cursor:pointer;font-size:13px;">
            <input type="checkbox" id="fl-active" checked> Aktiv
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-weight:600;cursor:pointer;font-size:13px;">
            <input type="checkbox" id="fl-required"> Obligatorisk
          </label>
        </div>`,
      buttons: [
        { label: 'Spara fält', cls: 'btn bp', onClick: () => {
          const label   = document.getElementById('fl-label')?.value.trim();
          const key     = document.getElementById('fl-key')?.value.trim().replace(/[^a-zA-Z0-9_]/g,'');
          const type    = document.getElementById('fl-type')?.value || 'text';
          const order   = parseInt(document.getElementById('fl-order')?.value) || nextOrder;
          const active  = document.getElementById('fl-active')?.checked !== false;
          const required= !!document.getElementById('fl-required')?.checked;
          const optsRaw = document.getElementById('fl-options')?.value || '';
          const options = optsRaw.split('\n').map(s=>s.trim()).filter(Boolean);
          if (!label) { showToast('Fältnamn krävs'); return; }
          if (!key)   { showToast('Nyckel krävs (autogenereras från namn)'); return; }
          if (!cat.fields) cat.fields = [];
          if (cat.fields.some(f => f.key === key)) { showToast('Nyckel används redan i kategorin'); return; }
          const id = 'f-' + cat.slug + '-' + Date.now();
          cat.fields.push({ id, key, label, type, order, active, required, options });
          Modal.close();
          AdminPage.openManageFields(catId);
          confirmPersist('propertyCategories', cat.id, { ok: 'Fält tillagt', fail: 'Fältet kunde inte sparas', onChange: () => AdminPage.openManageFields(catId) });
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => AdminPage.openManageFields(catId) }
      ]
    });
    this._toggleOptionsField();
  },

  _toggleOptionsField() {
    const type = document.getElementById('fl-type')?.value;
    const wrap = document.getElementById('fl-options-wrap');
    if (wrap) wrap.style.display = ['dropdown','status'].includes(type) ? '' : 'none';
  },

  openEditField(catId, fieldId) {
    const cat   = (state.propertyCategories||[]).find(c => c.id === catId);
    const field = cat && (cat.fields||[]).find(f => f.id === fieldId);
    if (!cat || !field) return;
    const hasData = this._fieldHasData(cat.slug, field.key);
    const types   = ['text','textarea','date','number','boolean','dropdown','link','phone','email','interval','status','comment'];
    Modal.open({
      title: `${ic('pencil',14)} Redigera fält — ${esc(field.label)}`,
      wide: true,
      body: `
        <div class="g2">
          <div class="fg"><label>Fältnamn (label)</label>
            <input id="fl-label" value="${esc(field.label)}">
          </div>
          <div class="fg"><label>Nyckel (låst — ändra bryter befintlig data)</label>
            <input id="fl-key" value="${esc(field.key)}" disabled style="opacity:.5;background:var(--bg);font-family:monospace;font-size:12px;">
          </div>
        </div>
        <div class="g2">
          <div class="fg"><label>Fälttyp</label>
            <select id="fl-type" onchange="AdminPage._toggleOptionsField()">
              ${types.map(t=>`<option value="${t}" ${field.type===t?'selected':''}>${this._fieldTypeLabel(t)}</option>`).join('')}
            </select>
          </div>
          <div class="fg"><label>Sorteringsordning</label>
            <input type="number" id="fl-order" value="${field.order||99}">
          </div>
        </div>
        <div class="fg" id="fl-options-wrap" style="display:${['dropdown','status'].includes(field.type)?'':'none'};">
          <label>Valalternativ (ett per rad)</label>
          <textarea id="fl-options" rows="4">${esc((field.options||[]).join('\n'))}</textarea>
        </div>
        ${hasData ? `<div class="nbox" style="margin-top:6px;font-size:11px;">${ic('database',11)} Detta fält har data i ${(state.properties||[]).filter(p=>{const t=(p.technicalSystems||{})[cat.slug];return t&&typeof t==='object'&&t[field.key];}).length} fastighet(er). Ändring av typ kan ge oväntad rendering.</div>` : ''}
        <div style="display:flex;gap:16px;margin-top:4px;">
          <label style="display:flex;align-items:center;gap:6px;font-weight:600;cursor:pointer;font-size:13px;">
            <input type="checkbox" id="fl-active" ${field.active!==false?'checked':''}> Aktiv
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-weight:600;cursor:pointer;font-size:13px;">
            <input type="checkbox" id="fl-required" ${field.required?'checked':''}> Obligatorisk
          </label>
        </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          const label   = document.getElementById('fl-label')?.value.trim();
          const type    = document.getElementById('fl-type')?.value || field.type;
          const order   = parseInt(document.getElementById('fl-order')?.value) || field.order;
          const active  = document.getElementById('fl-active')?.checked !== false;
          const required= !!document.getElementById('fl-required')?.checked;
          const optsRaw = document.getElementById('fl-options')?.value || '';
          const options = optsRaw.split('\n').map(s=>s.trim()).filter(Boolean);
          if (!label) { showToast('Fältnamn krävs'); return; }
          Object.assign(field, { label, type, order, active, required, options });
          Modal.close();
          AdminPage.openManageFields(catId);
          confirmPersist('propertyCategories', cat.id, { ok: 'Fält uppdaterat', fail: 'Fältet kunde inte sparas', onChange: () => AdminPage.openManageFields(catId) });
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => AdminPage.openManageFields(catId) }
      ]
    });
    this._toggleOptionsField();
  },

  _toggleFieldActive(catId, fieldId, active) {
    const cat   = (state.propertyCategories||[]).find(c => c.id === catId);
    const field = cat && (cat.fields||[]).find(f => f.id === fieldId);
    if (!field) return;
    field.active = active;
    AdminPage.openManageFields(catId);
    confirmPersist('propertyCategories', cat.id, { ok: active ? 'Fält aktiverat' : 'Fält inaktiverat', fail: 'Ändringen kunde inte sparas', onChange: () => AdminPage.openManageFields(catId) });
  },

  _deleteField(catId, fieldId) {
    const cat = (state.propertyCategories||[]).find(c => c.id === catId);
    if (!cat) return;
    const field = (cat.fields||[]).find(f => f.id === fieldId);
    if (!field) return;
    if (this._fieldHasData(cat.slug, field.key)) {
      showToast('Fältet har data — inaktivera istället för att bevara data');
      return;
    }
    cat.fields = (cat.fields||[]).filter(f => f.id !== fieldId);
    AdminPage.openManageFields(catId);
    confirmPersist('propertyCategories', cat.id, { ok: 'Fält borttaget', fail: 'Fältet kunde inte tas bort', onChange: () => AdminPage.openManageFields(catId) });
  },

  _moveField(catId, fieldId, dir) {
    const cat = (state.propertyCategories||[]).find(c => c.id === catId);
    if (!cat || !cat.fields) return;
    const sorted = [...cat.fields].sort((a,b) => (a.order||99)-(b.order||99));
    const idx = sorted.findIndex(f => f.id === fieldId);
    if (idx < 0) return;
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const aOrd = sorted[idx].order || (idx + 1);
    const bOrd = sorted[swapIdx].order || (swapIdx + 1);
    sorted[idx].order    = bOrd;
    sorted[swapIdx].order = aOrd;
    AdminPage.openManageFields(catId);
    confirmPersist('propertyCategories', cat.id, { saving: false, fail: 'Ordningen kunde inte sparas', onChange: () => AdminPage.openManageFields(catId) });
  },

  _duplicateField(catId, fieldId) {
    const cat   = (state.propertyCategories||[]).find(c => c.id === catId);
    const field = cat && (cat.fields||[]).find(f => f.id === fieldId);
    if (!cat || !field) return;
    const maxOrder = (cat.fields||[]).reduce((m,f)=>Math.max(m,f.order||0),0);
    const baseKey  = field.key + '_kopia';
    let newKey = baseKey;
    let n = 2;
    while ((cat.fields||[]).some(f => f.key === newKey)) { newKey = baseKey + n; n++; }
    const newField = Object.assign({}, field, {
      id:    'f-' + cat.slug + '-' + Date.now(),
      key:   newKey,
      label: field.label + ' (kopia)',
      order: maxOrder + 1
    });
    cat.fields.push(newField);
    AdminPage.openManageFields(catId);
    confirmPersist('propertyCategories', cat.id, { ok: 'Fält duplicerat', fail: 'Fältet kunde inte sparas', onChange: () => AdminPage.openManageFields(catId) });
  },

  openAddCategory() {
    Modal.open({
      title: `${ic('plus',14)} Ny kategori`,
      body: `
        <div class="g2">
          <div class="fg"><label>Namn</label><input id="cat-label" placeholder="T.ex. Hiss"></div>
          <div class="fg"><label>Slug (unikt ID)</label><input id="cat-slug" placeholder="elevator"></div>
        </div>
        <div class="g2">
          <div class="fg"><label>Ikon (Lucide-namn)</label><input id="cat-icon" placeholder="folder" value="folder"></div>
          <div class="fg"><label>Sorteringsordning</label><input type="number" id="cat-order" value="${(state.propertyCategories||[]).length+1}"></div>
        </div>
        <div class="fg" style="margin-top:4px;">
          <label style="display:flex;align-items:center;gap:8px;font-weight:600;cursor:pointer;">
            <input type="checkbox" id="cat-active" checked> Aktiv (visas i fastighetskort)
          </label>
        </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          const label = document.getElementById('cat-label')?.value.trim();
          const slug  = document.getElementById('cat-slug')?.value.trim().toLowerCase().replace(/[^a-z0-9_]/g,'');
          const icon  = document.getElementById('cat-icon')?.value.trim() || 'folder';
          const order = parseInt(document.getElementById('cat-order')?.value) || 99;
          const active= document.getElementById('cat-active')?.checked !== false;
          if (!label || !slug) { showToast('Namn och slug krävs'); return; }
          if ((state.propertyCategories||[]).some(c => c.slug === slug)) { showToast('Slug redan används'); return; }
          const cats = state.propertyCategories || [];
          cats.push({ id: 'cat-'+slug, slug, label, icon, order, active, showByDefault: active, fields: [] });
          state.propertyCategories = cats;
          Modal.close();
          AdminPage.render();
          confirmPersist('propertyCategories', 'cat-' + slug, { ok: 'Kategori skapad', fail: 'Kategorin kunde inte sparas', onChange: () => AdminPage.render() });
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  openEditCategory(catId) {
    const cat = (state.propertyCategories||[]).find(c => c.id === catId);
    if (!cat) return;
    Modal.open({
      title: `${ic('pencil',14)} Redigera kategori`,
      body: `
        <div class="g2">
          <div class="fg"><label>Namn</label><input id="cat-label" value="${esc(cat.label)}"></div>
          <div class="fg"><label>Slug (låst)</label><input id="cat-slug" value="${esc(cat.slug)}" disabled style="opacity:.5;background:var(--bg);"></div>
        </div>
        <div class="g2">
          <div class="fg"><label>Ikon (Lucide-namn)</label><input id="cat-icon" value="${esc(cat.icon||'folder')}"></div>
          <div class="fg"><label>Sorteringsordning</label><input type="number" id="cat-order" value="${cat.order||99}"></div>
        </div>
        <div class="fg" style="margin-top:4px;">
          <label style="display:flex;align-items:center;gap:8px;font-weight:600;cursor:pointer;">
            <input type="checkbox" id="cat-active" ${cat.active!==false?'checked':''}> Aktiv (visas i fastighetskort)
          </label>
        </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          const label = document.getElementById('cat-label')?.value.trim();
          const icon  = document.getElementById('cat-icon')?.value.trim() || 'folder';
          const order = parseInt(document.getElementById('cat-order')?.value) || 99;
          const active= document.getElementById('cat-active')?.checked !== false;
          if (!label) { showToast('Namn krävs'); return; }
          Object.assign(cat, { label, icon, order, active });
          Modal.close();
          AdminPage.render();
          confirmPersist('propertyCategories', cat.id, { ok: 'Kategori sparad', fail: 'Kategorin kunde inte sparas', onChange: () => AdminPage.render() });
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  async _activatePush() {
    this._pushMsg('info', 'Aktiverar…');
    try {
      await PushService.subscribe();
      /* Rendera först så att beskedet inte skrivs över av den nya vyn. */
      AdminPage.render();
      this._pushMsg('ok', 'Notiser aktiverade på den här enheten.');
    } catch(e) {
      const text = e && e.message === 'permission-denied'
        ? 'Du nekade notisbehörighet. Tillåt i webbläsar-/systeminställningarna och försök igen.'
        : 'Fel: ' + (e && e.message);
      this._pushMsg('err', text);
    }
  },

  async _testPush() {
    const diagBox = document.getElementById('push-test-result-box');
    const ok  = await PushService.isSubscribed();
    if (!ok) {
      this._pushMsg('err', 'Aktivera notiser först.');
      return;
    }
    this._pushMsg('info', 'Skickar testnotis…');
    if (diagBox) diagBox.innerHTML = '';
    /* V44 §6/§7: tidsstämpel INNAN sändningen — Push-event-pollningen räknar
       bara diagnostikmeddelanden mottagna EFTER denna tidpunkt som "detta
       testets" träff, så en gammal, tidigare push inte felaktigt visas som svar. */
    const sentAt = Date.now();
    try {
      const result  = await PushService.sendTest();
      const sent    = Number(result && result.sent)    || 0;
      const revoked = Number(result && result.revoked) || 0;
      /* V42 §4: send-push svarar HTTP 200 även när sent===0 (t.ex. ingen
         registrerad enhet). Ett HTTP-OK-svar är INTE detsamma som att en
         notis faktiskt skickades — måste kontrollera response-body,
         annars visas falsk grön success trots att inget nått mobilen. */
      const more = ' Detaljer under "Detaljer om senaste testnotis".';
      if (sent > 0) {
        this._pushMsg('ok', 'Testnotis skickad till ' + sent + ' enhet' + (sent === 1 ? '' : 'er') + '.' + more);
      } else if (revoked > 0) {
        this._pushMsg('err', 'En gammal push-prenumeration hade gått ut och har avregistrerats. Aktivera notiser på nytt.');
      } else {
        const extra = result && result.message ? ' (' + String(result.message) + ')' : '';
        this._pushMsg('err', 'Ingen registrerad mobilenhet hittades. Aktivera notiser på nytt.' + extra);
      }
      this._refreshPushStatus();
      /* V44 §7: rik diagnostikruta (Server/Enhet/Push-event) — inte bara
         beskedet ovan. */
      this._renderPushTestDiagBox(result, sentAt);
    } catch(e) {
      this._pushMsg('err', 'Fel: ' + (e && e.message));
    }
  },

  async _deactivatePush() {
    this._pushMsg('info', 'Stänger av…');
    try {
      await PushService.unsubscribe();
      AdminPage.render();
      this._pushMsg('info', 'Notiser avstängda på den här enheten.');
    } catch(e) {
      this._pushMsg('err', 'Fel: ' + (e && e.message));
    }
  },

  openEditCompany() {
    if (!Auth.require('admin_manage')) return;
    const s = state.settings || {};
    Modal.open({
      title: ic('building-2',15) + ' Företagsinformation',
      body: `
        <div class="fg"><label>Företagsnamn</label><input id="co-name" value="${esc(s.companyName||'')}"></div>
        <div class="fg"><label>Slogan / verksamhetsbeskrivning</label><input id="co-slogan" value="${esc(s.slogan||'')}" placeholder="Fastighetsservice & Förvaltning"></div>
        <div class="g2">
          <div class="fg"><label>Telefon</label><input id="co-phone" value="${esc(s.companyPhone||'')}" type="tel"></div>
          <div class="fg"><label>E-post</label><input id="co-email" value="${esc(s.companyEmail||'')}" type="email"></div>
        </div>
        <div class="fg"><label>Adress</label><input id="co-addr" value="${esc(s.companyAddress||'')}"></div>
        <div class="fg"><label>Webbsida</label><input id="co-web" value="${esc(s.website||'')}" type="url" placeholder="https://"></div>
        <div class="g2">
          <div class="fg"><label>Org.nr</label><input id="co-orgnr" value="${esc(s.orgNr||'')}"></div>
          <div class="fg"><label>Moms-nr</label><input id="co-vatnr" value="${esc(s.vatNr||'')}"></div>
        </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          state.settings = {
            ...state.settings,
            companyName:    document.getElementById('co-name')?.value.trim()   || s.companyName,
            slogan:         document.getElementById('co-slogan')?.value.trim() || '',
            companyPhone:   document.getElementById('co-phone')?.value.trim()  || '',
            companyEmail:   document.getElementById('co-email')?.value.trim()  || '',
            companyAddress: document.getElementById('co-addr')?.value.trim()   || '',
            website:        document.getElementById('co-web')?.value.trim()    || '',
            orgNr:          document.getElementById('co-orgnr')?.value.trim()  || '',
            vatNr:          document.getElementById('co-vatnr')?.value.trim()  || ''
          };
          Modal.close(); AdminPage.render();
          confirmPersist('settings', null, { ok: 'Sparat', fail: 'Företagsuppgifterna kunde inte sparas' });
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  openEditEkonomi() {
    if (!Auth.require('admin_manage')) return;
    const s = state.settings || {};
    Modal.open({
      title: `${ic('trending-up',15)} Ekonomi & Lönsamhet`,
      body: `
        <div class="fg">
          <label>Intern timkostnad (kr/h ex moms)</label>
          <input type="number" id="ek-rate" value="${s.internalHourlyCost || 250}" min="0" step="10" style="font-size:16px;font-weight:700;text-align:center;">
          <p style="font-size:11px;color:var(--mt);margin-top:6px;line-height:1.5;">Standardkostnad per timme för personalen. Används i lönsamhetsberäkningar internt — visas aldrig för kund i PDF eller e-post.</p>
        </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          const rate = parseFloat(document.getElementById('ek-rate')?.value) || 250;
          state.settings = Object.assign({}, state.settings, { internalHourlyCost: rate });
          Modal.close(); AdminPage.render();
          confirmPersist('settings', null, { ok: `Intern timkostnad: ${fmt(rate)} kr/h`, fail: 'Timkostnaden kunde inte sparas' });
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _uploadLogo(input, field) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { showToast('Filen är för stor (max 3 MB)'); return; }
    const reader = new FileReader();
    reader.onload = e => {
      BrandingService.update({ [field]: e.target.result });
      AdminPage.render();
      showToast('Logga uppladdad');
    };
    reader.onerror = () => showToast('Kunde inte läsa filen');
    reader.readAsDataURL(file);
  },

  _clearLogo(field) {
    BrandingService.clearLogo(field);
    AdminPage.render();
    showToast('Logga återställd till standard');
  },

  /* QA 2026-11-25: färgväljaren sparade tidigare HELA vift_settings vid
     varje input-händelse (en skrivning per steg när man drar i väljaren —
     23 skrivningar på 15 s observerade i STAGING). Nu: förhandsvisning
     medan man drar (bara CSS-variabler, ingen skrivning), EN sparning när
     valet är klart (change), och ingen sparning om värdet är oförändrat.
     V3 2026-11-26: samma kedja för förvalda färger och HEX-fältet —
     förhandsvisning utan skrivning, exakt en sparning per valt värde
     (via BrandingService.update, som slår ihop med övriga inställningar). */
  _previewColor(value, field) {
    if (!/^#[0-9a-fA-F]{3,6}$/.test(value || '')) return;
    const v = field === 'primaryColor' ? 'primary' : 'secondary';
    try {
      document.documentElement.style.setProperty('--brand-' + v, value);
      document.documentElement.style.setProperty('--brand-' + v + '-text', BrandingService._yiqText(value));
    } catch (e) {}
  },

  _saveColor(value, field) {
    const v = this._normHex(value);
    if (!v) return;
    this._syncColorUI(field, v);
    if ((state.settings || {})[field] === v) return;
    BrandingService.update({ [field]: v });
  },

  /* Färgrutan (input): förhandsvisa + synka HEX-fält, förval och kontrasttext. */
  _onColorInput(value, field) {
    this._previewColor(value, field);
    this._syncColorUI(field, value);
  },

  /* HEX-fältet medan man skriver: förhandsvisa bara giltiga koder, skriv inget. */
  _onHexInput(el, field) {
    const v = this._normHex(el.value);
    el.classList.remove('is-bad');
    if (!v) return;
    this._previewColor(v, field);
    this._syncColorUI(field, v);
  },

  /* HEX-fältet klart (change/Enter): ogiltig kod → felmarkering och tillbaka
     till sparad färg, ingen skrivning; giltig → en sparning. */
  _onHexCommit(el, field) {
    const v = this._normHex(el.value);
    if (!v) {
      el.classList.add('is-bad');
      el.setAttribute('aria-invalid', 'true');
      try { BrandingService.applyColors(); } catch (e) {}
      const saved = this._normHex((state.settings || {})[field]) || this._PRESETS[field][0].hex;
      this._syncColorUI(field, saved, { keepHex: true });
      const msg = document.getElementById('adm-color-msg-' + field);
      if (msg) msg.innerHTML = `<span class="adm-c-warn">${ic('alert-triangle', 14)}<span>Ogiltig färgkod — ange sex hexadecimala tecken, t.ex. #0f3763.</span></span>`;
      return;
    }
    el.classList.remove('is-bad');
    el.removeAttribute('aria-invalid');
    el.value = v;
    this._previewColor(v, field);
    this._saveColor(v, field);
  },

  /* Förvald färg (eller Standard): förhandsvisa och spara en gång. */
  _applyPreset(field, hex) {
    const v = this._normHex(hex);
    if (!v) return;
    this._previewColor(v, field);
    this._saveColor(v, field);
  },

  _syncColorUI(field, hex, o) {
    const root = document.getElementById('adm-color-' + field);
    const v = this._normHex(hex);
    if (!root || !v) return;
    const pick = root.querySelector('.adm-color-in');
    if (pick && pick.value !== v) pick.value = v;
    const hexEl = root.querySelector('.adm-hex');
    if (hexEl && !(o && o.keepHex) && document.activeElement !== hexEl) { hexEl.value = v; hexEl.classList.remove('is-bad'); }
    root.querySelectorAll('.adm-preset').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.hex === v)));
    const reset = root.querySelector('.adm-color-reset');
    if (reset) reset.hidden = v === this._PRESETS[field][0].hex;
    const msg = document.getElementById('adm-color-msg-' + field);
    if (msg) msg.innerHTML = this._contrastMsg(v, field);
  },

  showRoleStaff(roleId) {
    const role = (state.roles||[]).find(r => r.id === roleId);
    const staffList = (state.staff||[]).filter(s => s.role === roleId);
    if (!staffList.length) { showToast('Ingen personal med denna roll'); return; }
    Modal.open({
      title: `${ic('users',15)} Personal med roll: ${esc(role ? role.label : roleId)}`,
      body: staffList.map(s => `
        <div class="crow adm-crow">
          <div class="adm-row-m">
            <div class="adm-row-n">${esc(s.firstName)} ${esc(s.lastName)}</div>
            <div class="adm-row-s">${esc(s.title||'')} ${s.email?'· '+esc(s.email):''}</div>
          </div>
          <span class="bdg ${s.active?'bdg-green':'bdg-grey'}">${s.active?'Aktiv':'Inaktiv'}</span>
        </div>`).join(''),
      buttons: [{ label: 'Stäng', cls: 'btn bs', onClick: () => Modal.close() }]
    });
  },

  toggleRoleActive(roleId) {
    const r = (state.roles||[]).find(x => x.id === roleId);
    if (!r) return;
    // Guard: don't deactivate the last active admin-level role
    if (r.active !== false) {
      const activeAdmins = (state.roles||[]).filter(x => x.active !== false && (x.permissions||[]).includes('all'));
      if (activeAdmins.length <= 1 && (r.permissions||[]).includes('all')) {
        showToast('Kan inte inaktivera – det finns bara en admin-roll'); return;
      }
    }
    r.active = r.active === false ? true : false;
    AdminPage.render();
    confirmPersist('roles', r.id, { ok: r.active ? 'Roll aktiverad' : 'Roll inaktiverad', fail: 'Rolländringen kunde inte sparas — behörigheterna är oförändrade', onChange: () => AdminPage.render() });
  },

  /* Listraden skickar titelns index (aldrig namnet inklistrat i onclick). */
  _showTitleStaffIdx(idx) {
    const t = (state.titles || [])[idx];
    if (t && t.name) this.showTitleStaff(t.name);
  },

  showTitleStaff(title) {
    const staffWithTitle = (state.staff||[]).filter(s => s.title === title);
    if (!staffWithTitle.length) { showToast('Ingen personal med denna titel'); return; }
    Modal.open({
      title: `${ic('users',15)} Personal med titel: ${esc(title)}`,
      body: staffWithTitle.map(s => `
        <div class="crow adm-crow" onclick="Modal.close();Router.showPage('pg-staff')">
          <div class="adm-row-m">
            <div class="adm-row-n">${esc(s.firstName)} ${esc(s.lastName)}</div>
            <div class="adm-row-s">${esc(s.email||'')}</div>
          </div>
          <span class="bdg ${s.active?'bdg-green':'bdg-grey'}">${s.active?'Aktiv':'Inaktiv'}</span>
        </div>`).join(''),
      buttons: [{ label: 'Stäng', cls: 'btn bs', onClick: () => Modal.close() }]
    });
  },

  openAddTitle() {
    if (!Auth.require('admin_manage')) return;
    Modal.open({
      title: ic('plus',14) + ' Lägg till titel',
      body: `
        <div class="fg"><label>Titel / yrkesroll <span style="color:var(--rd)">*</span></label>
          <input id="adm-title" placeholder="T.ex. Låssmed, VVS-tekniker…"
            onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('adm-title-desc')?.focus();}"></div>
        <div class="fg"><label>Beskrivning (valfritt)</label>
          <input id="adm-title-desc" placeholder="Kort beskrivning av yrkesrollen…"
            onkeydown="if(event.key==='Enter'){event.preventDefault();AdminPage._addTitle();}"></div>`,
      buttons: [
        { label: 'Lägg till', cls: 'btn bp', onClick: () => AdminPage._addTitle() },
        { label: 'Avbryt',   cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('adm-title')?.focus(), 80);
  },

  _addTitle() {
    const name = (document.getElementById('adm-title')?.value || '').trim();
    if (!name) { showToast('Ange en titel'); return; }
    if ((state.titles||[]).some(x => x.name.toLowerCase() === name.toLowerCase())) { showToast('Finns redan'); return; }
    const desc = (document.getElementById('adm-title-desc')?.value || '').trim();
    state.titles = state.titles || [];
    const newId_ = 'TIT-' + String(Date.now()).slice(-6);
    state.titles.push({ id: newId_, name, description: desc, active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    Modal.close(); AdminPage.render();
    confirmPersist('titles', newId_, { ok: `"${name}" tillagd`, fail: 'Titeln kunde inte sparas', onChange: () => AdminPage.render() });
  },

  openEditTitle(idx) {
    const t = (state.titles||[])[idx];
    if (!t) return;
    Modal.open({
      title: ic('pencil',14) + ' Redigera titel',
      body: `
        <div class="fg"><label>Titel / yrkesroll <span style="color:var(--rd)">*</span></label>
          <input id="adm-edit-title" value="${esc(t.name)}"
            onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('adm-edit-desc')?.focus();}"></div>
        <div class="fg"><label>Beskrivning</label>
          <input id="adm-edit-desc" value="${esc(t.description||'')}" placeholder="Kort beskrivning…"
            onkeydown="if(event.key==='Enter'){event.preventDefault();AdminPage._saveEditTitle(${idx});}"></div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => AdminPage._saveEditTitle(idx) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('adm-edit-title')?.focus(), 80);
  },

  _saveEditTitle(idx) {
    const name = (document.getElementById('adm-edit-title')?.value || '').trim();
    if (!name) { showToast('Ange en titel'); return; }
    const t = (state.titles||[])[idx];
    if (!t) return;
    const oldName = t.name;
    if (name.toLowerCase() !== oldName.toLowerCase() &&
        (state.titles||[]).some((x, i) => i !== idx && x.name.toLowerCase() === name.toLowerCase())) {
      showToast('Titeln finns redan'); return;
    }
    // Update staff records that had the old name
    (state.staff||[]).forEach(s => { if (s.title === oldName) s.title = name; });
    t.name = name;
    t.description = (document.getElementById('adm-edit-desc')?.value || '').trim();
    t.updatedAt = new Date().toISOString();
    Modal.close(); AdminPage.render();
    confirmPersist('titles', t.id, { ok: 'Titel uppdaterad', fail: 'Titeln kunde inte sparas', onChange: () => AdminPage.render() });
  },

  toggleTitleActive(idx) {
    const t = (state.titles||[])[idx];
    if (!t) return;
    t.active = !t.active;
    t.updatedAt = new Date().toISOString();
    AdminPage.render();
    confirmPersist('titles', t.id, { ok: t.active ? 'Titel aktiverad' : 'Titel inaktiverad', fail: 'Ändringen kunde inte sparas', onChange: () => AdminPage.render() });
  },

  removeTitle(idx) {
    const t = (state.titles||[])[idx];
    if (!t) return;
    const usageCount = (state.staff||[]).filter(s => s.title === t.name).length;
    if (usageCount > 0) { showToast(`Kan inte ta bort – används av ${usageCount} person${usageCount===1?'':'er'}`); return; }
    if (!confirm(`Ta bort titeln "${t.name}"?`)) return;
    state.titles.splice(idx, 1);
    AdminPage.render();
    confirmPersist('titles', t.id, { ok: 'Borttagen', fail: 'Titeln kunde inte tas bort', onChange: () => AdminPage.render() });
  },

  openAddRole() {
    if (!Auth.require('admin_manage')) return;
    Modal.open({
      title: ic('shield-check',15) + ' Ny anpassad roll',
      body: `
        <div class="fg"><label>Roll-ID (unik nyckel) <span style="color:var(--rd)">*</span></label>
          <input id="role-id" placeholder="t.ex. konsult, vikarie, tekniker2…" autocomplete="off"
            oninput="this.value=this.value.toLowerCase().replace(/[^a-z0-9_]/g,'')"></div>
        <div class="fg"><label>Visningsnamn <span style="color:var(--rd)">*</span></label>
          <input id="role-label" placeholder="T.ex. Konsult, Vikarie…" autocomplete="off"></div>
        <div class="fg"><label>Beskrivning</label>
          <input id="role-desc" placeholder="Kort beskrivning av rollen och dess tillgång…"></div>`,
      buttons: [
        { label: 'Skapa roll', cls: 'btn bp', onClick: () => AdminPage._addRole() },
        { label: 'Avbryt',    cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('role-id')?.focus(), 80);
  },

  _addRole() {
    const id    = document.getElementById('role-id')?.value.trim();
    const label = document.getElementById('role-label')?.value.trim();
    if (!id || !label) { showToast('ID och visningsnamn krävs'); return; }
    if ((state.roles||[]).some(r => r.id === id)) { showToast('Roll-ID används redan'); return; }
    state.roles = state.roles || [];
    state.roles.push({
      id, label, isBuiltin: false, active: true,
      description: document.getElementById('role-desc')?.value.trim() || '',
      permissions: []
    });
    Modal.close(); AdminPage.render();
    confirmPersist('roles', id, { ok: `Roll "${label}" skapad`, fail: 'Rollen kunde inte skapas', onChange: () => AdminPage.render() });
  },

  _PERMISSIONS: [
    { id:'all',                label:'Alla behörigheter (superadmin)' },
    { id:'dashboard_view',     label:'Se dashboard' },
    { id:'ao_create',          label:'Skapa / redigera arbetsorder' },
    { id:'ao_complete',        label:'Klarmarkera arbetsorder' },
    { id:'ao_view_all',        label:'Se alla arbetsorder' },
    { id:'customer_manage',    label:'Hantera kunder' },
    { id:'offer_manage',       label:'Hantera offerter' },
    { id:'invoice_view',       label:'Se fakturaunderlag' },
    { id:'invoice_create',     label:'Skapa fakturaunderlag' },
    { id:'article_manage',     label:'Hantera artiklar & prisgrupper' },
    { id:'staff_view',         label:'Se personal' },
    { id:'staff_manage',       label:'Hantera personal' },
    { id:'admin_manage',       label:'Adminpanel & systeminställningar' },
    { id:'reports_view',       label:'Se rapporter (exkluderar löneunderlag)' },
    { id:'payroll_view',       label:'Se löneunderlag & exportera lönedata' },
    { id:'payroll_manage',     label:'Attestera och korrigera löneunderlag' },
    { id:'recurring_manage',   label:'Hantera återkommande ärenden' },
    { id:'sales_manage',       label:'Hantera säljchanser' },
    { id:'objects_sensitive',  label:'Visa känsliga fält (portkod, nyckel, larm)' }
  ],

  _PERM_LABELS: {
    'all':               'Superadmin – full åtkomst',
    'dashboard_view':    'Visa dashboard',
    'ao_view_all':       'Visa alla arbetsordrar',
    'ao_view_own':       'Visa egna arbetsordrar',
    'ao_create':         'Skapa arbetsordrar',
    'ao_edit':           'Redigera arbetsordrar',
    'ao_complete':       'Avsluta/slutföra arbetsordrar',
    'ao_time':           'Registrera tid',
    'ao_material':       'Registrera material',
    'ao_checklist':      'Hantera checklista',
    'customer_manage':   'Hantera kunder & fastigheter',
    'offer_manage':      'Hantera offerter',
    'invoice_view':      'Visa fakturaunderlag',
    'invoice_create':    'Skapa/redigera fakturaunderlag',
    'staff_view':        'Visa personal',
    'staff_manage':      'Hantera personal',
    'admin_manage':      'Systeminställningar & roller',
    'article_manage':    'Hantera artiklar & prisgrupper',
    'recurring_manage':  'Hantera återkommande ärenden',
    'sales_manage':      'Hantera säljchanser',
    'reports_view':      'Visa rapporter (exkluderar löneunderlag)',
    'payroll_view':      'Visa löneunderlag och exportera lönedata',
    'payroll_manage':    'Attestera, korrigera och bulkattestera tidposter',
    'objects_sensitive': 'Visa känsliga objektfält (portkod, nyckel, larm)',
  },

  _PERM_GROUPS: [
    { label: 'Superadmin',         perms: ['all'] },
    { label: 'Dashboard',          perms: ['dashboard_view'] },
    { label: 'Arbetsorder',        perms: ['ao_view_all','ao_view_own','ao_create','ao_edit','ao_complete','ao_time','ao_material','ao_checklist'] },
    { label: 'Kunder & Offerter',  perms: ['customer_manage','offer_manage'] },
    { label: 'Fakturering',        perms: ['invoice_view','invoice_create'] },
    { label: 'Personal & Admin',   perms: ['staff_view','staff_manage','admin_manage','article_manage'] },
    { label: 'Löner',              perms: ['payroll_view','payroll_manage'] },
    { label: 'Övrigt',             perms: ['recurring_manage','sales_manage','reports_view'] },
    { label: 'Säkerhet & Åtkomst', perms: ['objects_sensitive'] }
  ],

  openEditRole(roleId) {
    const r = (state.roles||[]).find(x => x.id === roleId);
    if (!r) return;
    const perms = r.permissions || [];
    const permMap = this._PERM_LABELS || {};

    const groupsHtml = this._PERM_GROUPS.map((g, gi) => {
      const groupCheckedCount = g.perms.filter(pid => perms.includes(pid)).length;
      const rows = g.perms.map(pid => `
        <label style="display:flex;align-items:center;gap:8px;padding:6px 0 6px 12px;border-bottom:1px solid var(--bg);cursor:pointer;">
          <input type="checkbox" name="role-perm" value="${pid}" ${perms.includes(pid)?'checked':''}
            style="width:15px;height:15px;flex-shrink:0;" onchange="AdminPage._onPermChange(this)">
          <span style="font-size:12px;">${permMap[pid]||pid}</span>
        </label>`).join('');
      return `
        <div style="margin-top:8px;border:1px solid var(--br);border-radius:var(--rs);overflow:hidden;">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:var(--bg);border-bottom:1px solid var(--br);">
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:11px;font-weight:700;color:var(--navy);text-transform:uppercase;letter-spacing:.4px;">${esc(g.label)}</span>
              <span class="bdg bdg-${groupCheckedCount>0?'sky':'grey'}" style="font-size:9px;">${groupCheckedCount}/${g.perms.length}</span>
            </div>
            <button type="button" class="btn bghost bxs" style="font-size:10px;padding:2px 7px;"
              onclick="AdminPage._togglePermGroup(${gi})">Markera alla</button>
          </div>
          ${rows}
        </div>`;
    }).join('');

    Modal.open({
      title: `${ic('shield-check',15)} Redigera roll: ${esc(r.label)}`,
      wide: true,
      body: `
        <div class="fg"><label>Visningsnamn</label>
          <input id="role-edit-label" value="${esc(r.label)}" ${r.isBuiltin?'readonly style="background:var(--bg);"':''}></div>
        <div class="fg"><label>Beskrivning</label>
          <input id="role-edit-desc" value="${esc(r.description||'')}" placeholder="Kort beskrivning…"></div>
        <div style="margin-top:4px;">
          <div style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px;">Behörigheter</div>
          ${groupsHtml}
        </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => AdminPage._saveEditRole(roleId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _togglePermGroup(groupIdx) {
    const group = this._PERM_GROUPS[groupIdx];
    if (!group) return;
    const cbs = document.querySelectorAll('input[name="role-perm"]');
    const groupCbs = Array.from(cbs).filter(cb => group.perms.includes(cb.value));
    const allChecked = groupCbs.every(cb => cb.checked);
    groupCbs.forEach(cb => {
      cb.checked = !allChecked;
      this._onPermChange(cb);
    });
  },

  _onPermChange(checkbox) {
    if (checkbox.value === 'all' && checkbox.checked) {
      document.querySelectorAll('input[name="role-perm"]').forEach(cb => { cb.checked = cb.value === 'all'; });
    } else if (checkbox.value !== 'all' && checkbox.checked) {
      const allCb = document.querySelector('input[name="role-perm"][value="all"]');
      if (allCb) allCb.checked = false;
    }
  },

  _saveEditRole(roleId) {
    const idx = (state.roles||[]).findIndex(r => r.id === roleId);
    if (idx < 0) return;
    const label = document.getElementById('role-edit-label')?.value.trim();
    if (!label) { showToast('Visningsnamn krävs'); return; }
    const checked = Array.from(document.querySelectorAll('input[name="role-perm"]:checked')).map(cb => cb.value);
    const description = document.getElementById('role-edit-desc')?.value.trim() || '';
    Modal.close();
    /* E2E ROLE-02 (2026-11-23): framgång först efter serverns bekräftelse. */
    return commitElementChange('roles', roleId, () => {
      const i = (state.roles||[]).findIndex(r => r.id === roleId);
      if (i < 0) return false;
      state.roles[i] = { ...state.roles[i], label, description, permissions: checked };
    }, {
      onChange: () => { AdminPage.render(); if (Auth.applyAuthorizationChange) Auth.applyAuthorizationChange('local'); else Auth._resolveUser(); Sidebar.render(); },
      ok: 'Roll uppdaterad — behörigheter träder i kraft direkt',
      fail: 'Rollen "' + label + '" kunde inte sparas — behörigheterna är OFÖRÄNDRADE'
    });
  },

  removeRole(roleId) {
    const usageCount = (state.staff||[]).filter(s => s.role === roleId).length;
    if (usageCount > 0) { showToast(`Kan inte ta bort – används av ${usageCount} person${usageCount===1?'':'er'}`); return; }
    if (!confirm('Ta bort rollen?')) return;
    state.roles = (state.roles||[]).filter(r => r.id !== roleId);
    AdminPage.render();
    confirmPersist('roles', roleId, { ok: 'Roll borttagen', fail: 'Rollen kunde inte tas bort', onChange: () => AdminPage.render() });
  }
};

/* ── Shell-sidor utan rendering ───────── */
/* CalendarPage definieras i src/pages/CalendarPage.js */
/* ContractsPage definieras i src/pages/ContractsPage.js (Punkt 81) */
const InspectionsPage = { render() { RonderingPage.render(); } };
/* PayrollPage definieras i src/pages/PayrollPage.js (Punkt 76) */
/* ReportsPage definieras i src/pages/ReportsPage.js */

/* ── Hjälpfunktioner ──────────────────── */
function _shellEmpty(title, msg) {
  return `<div class="empty">${ic('settings',36)}<h3>${title}</h3><p>${msg}</p></div>`;
}

function _shellFull(title, msg) {
  return `
    <div class="card">
      <div class="card-header"><h3>${title}</h3></div>
      <div class="card-body"><div class="ibox">${msg}</div></div>
    </div>`;
}

function _renderShell(elId, title, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = _shellFull(title, msg);
}

/* ── Uppgifter (V53A) ────────────────────
 * V53A bygger vidare på det BEFINTLIGA aktivitets-konceptet (se
 * ActivitiesService.js:s huvudkommentar) — inget parallellt
 * uppgifts-system. Sidan har fått ett riktigt "Ny uppgift"-flöde,
 * redigering, ta bort, sökning, återöppning och en icke-scrollande
 * mobilfiltrering, men datamodellen (state.activities) och all
 * befintlig kontextuell skapande-kod (offert-/AO-uppföljningar) är
 * oförändrad och fortsätter fungera exakt som förut. */
const ActivitiesPage = {
  _filter: 'alla',
  _search: '',
  _tempCustomerId: '', // formulärets tillfälliga kund-val, styr fastighet/AO-listorna

  /* ── V53A R1 §1/§2 (oberoende reproducerad blockerare) ────────────────
     Sidåtkomst (['ao_view_all','ao_view_own']) räcker INTE som
     auktorisation för varje enskild mutation — en tekniker med bara
     ao_view_own kunde tidigare redigera/permanent-radera VILKEN uppgift
     som helst, inte bara sina egna. Centraliserade behörighetshjälpare
     istället för spridda, inkonsekventa kontroller — och de anropas BÅDE
     i UI:t (döljer/inaktiverar knappar) OCH i de faktiska muterande
     metoderna (UI-döljning räcker inte ensamt, se uppdraget). Modell:
       SKAPA     — vem som helst med sidåtkomst (samma konvention som
                    RecurringPage/SalesPage — inget extra skydd behövs).
       KLARMARKERA/ÅTERÖPPNA — egen tilldelad uppgift, ELLER ao_edit/
                    ao_view_all för valfri uppgift.
       REDIGERA  — samma regel som ovan.
       TA BORT   — kräver en HÖJD behörighet (ao_edit eller admin_manage)
                    — ren ao_view_own räcker ALDRIG för permanent radering,
                    oavsett ägarskap. */
  _isOwnTask(act) {
    const user = Auth.getUser();
    return !!(user && act && act.assignedTo === user.id);
  },
  _canEditTask(act) {
    return Auth.can('ao_edit') || Auth.can('ao_view_all') || this._isOwnTask(act);
  },
  _canCompleteTask(act) {
    return Auth.can('ao_edit') || Auth.can('ao_view_all') || this._isOwnTask(act);
  },
  _canDeleteTask(act) {
    return Auth.can('ao_edit') || Auth.can('admin_manage');
  },

  /* V3 register (2026-11-26): tvåfasrendering som övriga register —
     render() bygger verktygsrad (sök + EN primär åtgärd) och tomma
     behållare, renderList() fyller filter, räknare och tabell, så att
     sökfältet behåller fokus. Sidrubriken "Uppgifter" upprepas inte (den
     står i toppraden, S-03). Filtren är V3-chips i två grupper (öppna
     snabbval / klart och kopplingar) i stället för mörka piller (S-01).
     Urvalen och behörighetsreglerna per uppgift är oförändrade. */
  render(params = {}) {
    const el = document.getElementById('pg-activities-content');
    if (!el) return;
    if (params.filter) this._filter = params.filter;
    el.innerHTML = `<div class="rg" data-rg="tasks">
      ${RegisterUi.bar({
        id: 'act-search', placeholder: 'Sök uppgift, ansvarig, kund, AO…', label: 'Sök uppgift (titel, notering, ansvarig, kund, fastighet, AO)', value: this._search,
        oninput: "ActivitiesPage._search=this.value;RegisterUi.later('act',function(){ActivitiesPage.renderList()})",
        primary: { label: 'Ny uppgift', onclick: 'ActivitiesPage.openCreate()' }
      })}
      <div class="rg-filters" id="act-filters"></div>
      <div id="act-list" class="rg-listwrap"></div>
    </div>`;
    this.renderList();
  },

  _clearFilters() {
    this._filter = 'alla'; this._search = '';
    const i = document.getElementById('act-search'); if (i) i.value = '';
    this.renderList();
  },

  renderList() {
    const el = document.getElementById('act-list');
    if (!el) return;

    const today = tdy();
    const acts  = state.activities || [];
    const user  = state.currentUser;

    const openAll   = acts.filter(a => a.status === 'open');
    const overdue   = openAll.filter(a => a.dueDate && a.dueDate < today);
    const dueToday  = openAll.filter(a => a.dueDate === today);
    const upcoming  = openAll.filter(a => a.dueDate && a.dueDate > today);
    const mine      = openAll.filter(a => user && a.assignedTo === user.id);
    const done      = acts.filter(a => a.status === 'done');

    /* V53A R1 §3 (legacy-regression, oberoende bekräftad) — dessa två
       filter fanns i den ursprungliga "Att göra"-sidan (offert-/AO-
       uppföljningar, oavsett status) och togs tyst bort i V53A. Återställda
       identiskt (matchar HELA `acts`, inte bara öppna — precis som förut). */
    const offerLinked = acts.filter(a => a.relatedType === 'offer');
    const aoLinked     = acts.filter(a => a.relatedType === 'workOrder');

    const filter = this._filter;
    let base;
    if (filter === 'mina')           base = mine;
    else if (filter === 'idag')      base = dueToday;
    else if (filter === 'försenade') base = overdue;
    else if (filter === 'kommande')  base = upcoming;
    else if (filter === 'klara')     base = done;
    else if (filter === 'offerter')  base = offerLinked;
    else if (filter === 'ao')        base = aoLinked;
    else                             base = openAll; // 'alla' = alla öppna

    let filtered = this._search ? ActivitiesService.search(base, this._search) : base;
    filtered = (filter === 'klara') ? ActivitiesService.sortCompleted(filtered) : ActivitiesService.sortOpen(filtered);

    const chip = (key, label, cnt, o) => UiKit.chip(label, `ActivitiesPage.setFilter('${key}')`, Object.assign({ on: filter === key, n: cnt }, o || {}));
    const fEl = document.getElementById('act-filters');
    if (fEl) fEl.innerHTML = `
      <div class="rg-chips" role="group" aria-label="Öppna uppgifter">
        ${chip('alla', 'Alla öppna', openAll.length)}
        ${user ? chip('mina', 'Mina', mine.length, { icon: 'user' }) : ''}
        ${chip('försenade', 'Försenade', overdue.length, { icon: 'clock', tone: overdue.length ? 'danger' : '' })}
        ${chip('idag', 'Idag', dueToday.length, { icon: 'calendar' })}
        ${chip('kommande', 'Kommande', upcoming.length)}
      </div>
      <span class="rg-chips-sep" aria-hidden="true"></span>
      <div class="rg-chips" role="group" aria-label="Klart och kopplingar">
        ${chip('klara', 'Klart', done.length, { icon: 'check' })}
        ${chip('offerter', 'Offerter', offerLinked.length, { icon: 'file-text' })}
        ${chip('ao', 'Arbetsorder', aoLinked.length, { icon: 'clipboard-list' })}
      </div>`;

    const lnk = (icon, label, onclick) => `<button type="button" class="rg-link" onclick="event.stopPropagation();${onclick}">${ic(icon,12)}<span>${esc(label)}</span></button>`;
    const _relationHtml = (act) => {
      const parts = [];
      /* V53A R1 §6 — visa den KANONISKT upplösta kunden (offertens egen
         kund för en offert-länkad uppgift), inte ett ev. motsägelsefullt
         eget customerId-fält. */
      const resolvedCu = ActivitiesService.resolveCustomer(act);
      if (resolvedCu) parts.push(lnk('user', CustomerService.displayName(resolvedCu), `Router.showPage('pg-crm-detail',{customerId:${RegisterUi.arg(resolvedCu.id)}})`));
      if (act.propertyId) {
        const prop = getObj(act.propertyId);
        if (prop) parts.push(lnk('building-2', prop.name || prop.address || prop.id, `Router.showPage('pg-obj-detail',{propId:${RegisterUi.arg(act.propertyId)}})`));
      }
      if (act.relatedType === 'offer' && act.relatedId) {
        const off = getOff(act.relatedId);
        if (off) parts.push(lnk('file-text', 'Offert ' + act.relatedId, `Router.showPage('pg-offer-detail',{offerId:${RegisterUi.arg(act.relatedId)}})`));
      } else if (act.relatedType === 'workOrder' && act.relatedId) {
        const ao = getAO(act.relatedId);
        parts.push(lnk('clipboard-list', act.relatedId + (ao ? ' – ' + ao.title : ''), `Router.showPage('pg-ao-detail',{aoId:${RegisterUi.arg(act.relatedId)}})`));
      }
      return parts.join('');
    };

    const filteredSet = filter !== 'alla' || !!this._search;
    const head = RegisterUi.count(filtered.length, base.length, 'uppgift', 'uppgifter', { clear: filteredSet ? 'ActivitiesPage._clearFilters()' : '' });
    if (filtered.length === 0) {
      el.innerHTML = acts.length === 0
        ? RegisterUi.empty({ icon: 'check-square', title: 'Inga uppgifter ännu', text: 'Skapa den första uppgiften — allt från "att göra" till uppföljningar och inköp.',
            action: `<button type="button" class="btn bp bsm" onclick="ActivitiesPage.openCreate()">${ic('plus',14)}<span>Ny uppgift</span></button>` })
        : filter === 'klara' && !this._search
          ? RegisterUi.empty({ icon: 'check-circle', title: 'Inga klara uppgifter än', text: 'Uppgifter som markeras klara visas här.' })
          : RegisterUi.empty({ icon: 'search', title: 'Inga uppgifter matchar filtret', text: 'Prova ett annat filter eller rensa sökningen.',
              action: `<button type="button" class="btn bs bsm" onclick="ActivitiesPage._clearFilters()">Rensa filter</button>` });
      return;
    }

    const rows = filtered.map(act => {
      const isOverdue = act.status === 'open' && act.dueDate && act.dueDate < today;
      const isToday   = act.status === 'open' && act.dueDate === today;
      const isDone    = act.status === 'done';
      const staff     = act.assignedTo ? getStaff(act.assignedTo) : null;
      const staffName = staff ? `${staff.firstName} ${staff.lastName}` : 'Ej tilldelad';
      const relHtml   = _relationHtml(act);
      const id        = RegisterUi.arg(act.id);
      const title     = act.title || ActivitiesService.typeLabel(act.type);
      /* V53A R1 §1/§2 — klarmarkeringen togglar bara komplett/återöppna om
         användaren faktiskt har rätt till det (egen tilldelad uppgift,
         eller ao_edit/ao_view_all). Annars är knappen inaktiverad och har
         inget anrop alls — och toggleComplete() själv nekar ändå om den
         ändå anropas (se dess kommentar). */
      const canComplete = this._canCompleteTask(act);
      const canEdit     = this._canEditTask(act);
      const dateCls = isDone ? '' : isOverdue ? ' is-late' : isToday ? ' is-today' : '';
      const dateLabel = isDone
        ? `Klar ${act.completedAt ? fmtDate(act.completedAt) : ''}`.trim()
        : (act.dueDate ? `${fmtDate(act.dueDate)}${act.dueTime?' kl '+act.dueTime:''}` : 'Inget förfallodatum');
      const checkLabel = canComplete ? (isDone ? 'Återöppna' : 'Markera klar') : 'Du saknar behörighet för denna uppgift';
      const badges = [
        isOverdue ? `<span class="bdg bdg-red">Försenad</span>` : '',
        isToday ? `<span class="bdg bdg-orange">Idag</span>` : '',
        (act.priority==='akut'||act.priority==='hög') && !isDone ? `<span class="bdg ${act.priority==='akut'?'bdg-red':'bdg-orange'}">${esc(ActivitiesService.priorityLabel(act.priority))}</span>` : ''
      ].join('');
      return `<tr class="rg-row${isDone ? ' rg-row--done' : ''}" tabindex="0" onclick="ActivitiesPage.openEdit(${id})"
          onkeydown="if(event.key==='Enter'&&event.target===this){ActivitiesPage.openEdit(${id})}">
        <td class="rg-c-sel"><span class="rg-check-wrap" onclick="event.stopPropagation()"><button type="button" class="rg-check${isDone ? ' is-done' : ''}" role="checkbox" aria-checked="${isDone}"
            aria-label="${esc(checkLabel + ': ' + title)}" title="${esc(checkLabel)}" ${canComplete ? `onclick="ActivitiesPage.toggleComplete(${id})"` : 'disabled'}>${ic(isDone ? 'check-circle' : 'circle', 20)}</button></span></td>
        <td class="rg-c-main">
          <div class="rg-task-l1"><span class="rg-title" title="${esc(title)}">${esc(title)}</span>${badges}</div>
          ${relHtml ? `<div class="rg-rel">${relHtml}</div>` : ''}
          <div class="rg-msub rg-meta"><span>${ic(ActivitiesService.typeIcon(act.type),12)}${esc(ActivitiesService.typeLabel(act.type))}</span><span>${ic('user',12)}${esc(staffName)}</span><span class="rg-when${dateCls}">${ic('calendar',12)}${esc(dateLabel)}</span></div>
        </td>
        <td class="rg-c-x rg-h-md"><span class="rg-meta"><span>${ic(ActivitiesService.typeIcon(act.type),13)}${esc(ActivitiesService.typeLabel(act.type))}</span></span></td>
        <td class="rg-c-x" title="${esc(staffName)}">${staff ? `<span class="rg-person">${UiKit.avatar(staff, 22)}<span class="rg-person-n">${esc(staffName)}</span></span>` : '<span class="rg-none">Ej tilldelad</span>'}</td>
        <td class="rg-c-x"><span class="rg-when${dateCls}">${esc(dateLabel)}</span></td>
        <td class="rg-c-end">${canEdit ? RegisterUi.openBtn(`ActivitiesPage.openEdit(${id})`, 'Öppna ' + title) : ''}</td>
      </tr>`;
    }).join('');
    el.innerHTML = `<div class="dt-wrap rg-wrap">${head}
      <div class="dt-scroll"><table class="dtab rg-tbl rg-tasks">
        <thead><tr>
          <th class="rg-w-sel"><span class="sr-only">Klar</span></th>
          <th>Uppgift</th>
          <th class="rg-w-s rg-h-md">Typ</th>
          <th class="rg-w-m">Ansvarig</th>
          <th class="rg-w-m">Förfaller</th>
          <th class="rg-w-end"><span class="sr-only">Öppna</span></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
  },

  setFilter(key) {
    this._filter = key;
    this.renderList();
  },

  setSearch(q) {
    this._search = q || '';
    // Tvåfasrendering: bara listan byggs om, sökfältet behåller fokus och markörläge.
    this.renderList();
  },

  toggleComplete(id) {
    const act = ActivitiesService._get(id);
    if (!act) return;
    /* V53A R1 §1/§2 — metodnivå-spärr, inte bara UI-döljning (uppdragets
       uttryckliga krav): ett direkt anrop (t.ex. via konsolen) nekas
       precis lika säkert som ett klick på en dold/inaktiverad kryssruta. */
    if (!this._canCompleteTask(act)) { showToast('Du saknar behörighet för den åtgärden'); return; }
    const completing = act.status === 'open';
    if (completing) {
      ActivitiesService.complete(id);
      this._logCompletion(act);
    } else {
      ActivitiesService.reopen(id);
    }
    Sidebar.updateBadges();
    this.render();
    /* G12: besked först efter serverns bekräftelse. */
    confirmPersist('activities', id, { ok: completing ? 'Uppgift markerad klar' : 'Uppgift återöppnad', fail: 'Uppgiften kunde inte sparas', onChange: () => { Sidebar.updateBadges(); this.render(); } });
  },

  /* Bevarar den befintliga sido-effekten: en slutförd offert-/AO-länkad
     uppgift loggar en rad i offertens tidslinje respektive AO:ns
     noteringar — oförändrat beteende sedan innan V53A. */
  _logCompletion(act) {
    const ts   = new Date().toISOString();
    const user = state.currentUser ? (state.currentUser.name || state.currentUser.username || 'Admin') : 'Admin';
    const note = act.note ? `: ${act.note}` : '';
    if (act.relatedType === 'offer') {
      const off = getOff(act.relatedId);
      if (off) {
        if (!Array.isArray(off.timeline)) off.timeline = [];
        off.timeline.push({ ts, type: 'followup', text: `Uppföljning utförd${note}`, user });
        off.updatedAt = ts;
        persist();
      }
    } else if (act.relatedType === 'workOrder') {
      const ao = getAO(act.relatedId);
      if (ao) {
        if (!Array.isArray(ao.notes)) ao.notes = [];
        ao.notes.push({ ts, type: 'log', text: `Uppföljning utförd${note}`, user, createdBy: user });
        ao.updatedAt = ts;
        if (typeof WorkOrderService !== 'undefined' && typeof WorkOrderService._syncAO === 'function') {
          WorkOrderService._syncAO(ao, { notes: ao.notes, updatedAt: ao.updatedAt });
        }
        persist();
      }
    }
  },

  /* V53A R1/R2 (legacy-regression, oberoende bekräftad) — bevarar den
     BEFINTLIGA "Flytta"-funktionens (openReschedule(), fanns innan V53A)
     revisionslogg: en offert-/AO-länkad uppgifts förfallodatum- ELLER
     -tidsändring loggas som en rad på den länkade postens tidslinje/
     noteringar, med samma textformat som förut
     ("Uppföljning flyttad från X till Y") — R2 lägger till tiden i den
     texten (`kl HH:MM`) när en tid faktiskt finns, annars exakt oförändrat
     datum-bara-format (bakåtkompatibelt). Anropas bara när datum ELLER
     tid FAKTISKT ändrades (se _save()) — loggar aldrig dubbelt (en enda
     logg täcker båda fälten om båda ändras samtidigt) eller vid en
     oförändrad sparning. En uppgift utan relatedType (fristående, eller
     bara kund-/fastighetslänkad) har ingen tidslinje att logga på — no-op. */
  _logReschedule(existing, oldDate, newDate, oldTime, newTime) {
    if (!existing || !existing.relatedType) return;
    const ts      = new Date().toISOString();
    const user    = state.currentUser ? (state.currentUser.name || state.currentUser.username || 'Admin') : 'Admin';
    const _fmt = (d, t) => d ? new Date(d + 'T12:00:00').toLocaleDateString('sv-SE', {day:'numeric',month:'short'}) + (t ? ' kl ' + t : '') : '—';
    const fromStr = _fmt(oldDate, oldTime);
    const toStr   = _fmt(newDate, newTime);
    if (existing.relatedType === 'offer') {
      const off = getOff(existing.relatedId);
      if (off) {
        if (!Array.isArray(off.timeline)) off.timeline = [];
        off.timeline.push({ ts, type: 'reminder', text: `Uppföljning flyttad från ${fromStr} till ${toStr}`, user });
        off.updatedAt = ts;
        persist();
      }
    } else if (existing.relatedType === 'workOrder') {
      const ao = getAO(existing.relatedId);
      if (ao) {
        if (!Array.isArray(ao.notes)) ao.notes = [];
        ao.notes.push({ ts, type: 'log', text: `Uppföljning flyttad från ${fromStr} till ${toStr}`, user, createdBy: user });
        ao.updatedAt = ts;
        if (typeof WorkOrderService !== 'undefined' && typeof WorkOrderService._syncAO === 'function') {
          WorkOrderService._syncAO(ao, { notes: ao.notes, updatedAt: ao.updatedAt });
        }
        persist();
      }
    }
  },

  /* ── Skapa / redigera ─────────────────── */

  /* V53B §2 — kanonisk kontextuell skapa-API. `context` (valfritt)
     förhandsifyller ENDAST vid skapande — {customerId, propertyId,
     relatedType, relatedId} — och muterar ALDRIG något förrän
     användaren själv trycker "Skapa uppgift" (Avbryt = ingen mutation,
     precis som det generiska nollparameter-flödet redan garanterar).
     Det generiska "Ny uppgift"-anropet (Uppgifter-sidan, två befintliga
     ställen) fortsätter fungera oförändrat med context===undefined. */
  openCreate(context) {
    this._openForm(null, context);
  },

  openEdit(id) {
    const act = ActivitiesService._get(id);
    if (!act) return;
    /* V53A R1 §1/§2 — metodnivå-spärr: en obehörig kan inte öppna
       redigera-formuläret ens genom att anropa detta direkt. */
    if (!this._canEditTask(act)) { showToast('Du saknar behörighet att redigera denna uppgift'); return; }
    this._openForm(id);
  },

  _staffOptionsHtml(selectedId) {
    const activeStaff = (state.staff || []).filter(s => s.active);
    let html = `<option value="">— Ej tilldelad —</option>`;
    html += activeStaff.map(s => `<option value="${s.id}" ${selectedId===s.id?'selected':''}>${esc((s.firstName+' '+s.lastName).trim())}</option>`).join('');
    return html;
  },

  _propertyOptionsHtml(customerId, selectedId) {
    const props = customerId ? (state.properties||[]).filter(p => p.customerId === customerId) : [];
    let html = `<option value="">— Ingen fastighet —</option>`;
    html += props.map(p => `<option value="${p.id}" ${selectedId===p.id?'selected':''}>${esc(p.name||p.address||p.id)}</option>`).join('');
    return html;
  },

  /* V53B R1 — AO-listan förblir MEDVETET bara kund-filtrerad (som innan),
     inte fastighets-filtrerad — uppdraget kräver uttryckligen att man ska
     kunna välja en AO som hör till en ANNAN fastighet hos SAMMA kund (det
     är själva mekanismen som synkroniserar Fastighet TILL AO:n, se
     _aoChangedInForm nedan). Motsägelsen löses istället genom att en
     redan vald AO som inte längre matchar en NY vald Fastighet rensas
     (se _propertyChangedInForm), plus ett oberoende defensivt lager i
     _save() — inte genom att begränsa vilka AO:er som visas i listan. */
  _aoOptionsHtml(customerId, selectedId) {
    const aos = customerId ? (state.workOrders||[]).filter(a => a.customerId === customerId && !a.deleted) : [];
    let html = `<option value="">— Ingen arbetsorder —</option>`;
    html += aos.map(a => `<option value="${a.id}" ${selectedId===a.id?'selected':''}>${esc(a.id)} – ${esc(a.title||'')}</option>`).join('');
    return html;
  },

  _openForm(id, context) {
    const act = id ? ActivitiesService._get(id) : null;
    const isEdit = !!act;
    /* V53B §2/§14 — `ctx` gäller ENDAST vid skapande (aldrig vid
       redigering av en befintlig uppgift, oavsett vad som råkar skickas
       in) och är bara ett förhandsifyllnadsvärde `v()` faller tillbaka
       på — exakt samma mekanik som den befintliga `def`-parametern,
       bara med en extra, prioriterad källa emellan. */
    const ctx = (!isEdit && context) || {};
    const v = (field, def) => act ? (act[field] ?? def) : (ctx[field] ?? def ?? '');

    /* En uppgift som redan är länkad till en OFFERT (skapad kontextuellt
       från offertflödet, oförändrat sedan innan V53A) redigeras inte om
       via det nya AO-fältet — det skulle tyst kunna radera den befintliga
       offert-kopplingen. Visas istället som en fast, informativ rad. */
    const isOfferLinked = isEdit && act.relatedType === 'offer';
    /* V53B §5/§14 — kontextuell AO-skapande (t.ex. från WorkOrderDetail)
       återanvänder EXAKT samma AO-väljare/relation-mekanism som
       redigeringsläget redan har (ingen ny `workOrderId`-parallell) —
       väljaren förhandsifylls med ctx.relatedId, och _save() läser den
       precis som vanligt. */
    const currentAoId = isEdit
      ? (act.relatedType === 'workOrder' ? act.relatedId : '')
      : (ctx.relatedType === 'workOrder' ? (ctx.relatedId || '') : '');

    /* V53A R1 §6 (oberoende reproducerad blockerare) — Kund-fältet var
       fritt redigerbart ÄVEN för en offert-länkad uppgift, vilket kunde
       ge motsägelsefull metadata (uppgiften pekar på Offert X men har ett
       eget customerId som hör till en HELT ANNAN kund). En offert-länkad
       uppgifts kund är INTE en egen, fristående uppgift — den är samma
       kund som offerten faktiskt tillhör, punkt. Fältet blir därför
       skrivskyddat (samma mönster som AO-fältet ovan) och visar den
       KANONISKT upplösta kunden — löser även en legacy-post som helt
       saknar ett eget customerId. */
    const offerLinkedCustomer = isOfferLinked ? ActivitiesService.resolveCustomer(act) : null;

    /* Robusthet: en AO-länkad uppgift SKA i praktiken alltid ha sitt eget
       customerId satt redan vid skapandet (se t.ex.
       WorkOrderDetailPage.js:s kontextuella ActivitiesService.create()-
       anrop, som alltid skickar `customerId: ao.customerId`) — men om en
       genuint gammal post ändå saknar det helt får inte Fastighet/AO-
       listorna (som filtreras på vald kund) tystna bort AO-kopplingen bara
       för att formuläret öppnas och sparas om. Faller därför tillbaka till
       den länkade AO:ns egen kund i det fallet — samma säkra mönster som
       offert-grenen. */
    const fallbackAoCustomerId = (isEdit && !isOfferLinked && act.relatedType === 'workOrder' && act.relatedId && !act.customerId)
      ? ((getAO(act.relatedId) || {}).customerId || '')
      : '';

    this._tempCustomerId = isOfferLinked
      ? (offerLinkedCustomer ? offerLinkedCustomer.id : '')
      : (v('customerId', '') || fallbackAoCustomerId || '');
    /* V53B R1 — fångas en gång, används för att filtrera BÅDE Fastighet-
       väljarens initiala urval och AO-väljarens initiala lista (se
       _aoOptionsHtml() ovan) så att formuläret aldrig öppnas med en redan
       motsägelsefull Fastighet/AO-kombination. Samma "AO:n är auktoritativ"-
       princip som _save() upprätthåller: en REDIGERAD AO-länkad uppgift
       läser fastigheten från den FAKTISKA AO:n i state, inte från
       uppgiftens ev. egna (potentiellt inaktuella legacy-)propertyId-fält
       — så formuläret aldrig ens VISAR en redan motsägelsefull kombination
       för en post som fanns innan denna invariant infördes. */
    const linkedAoForForm = (isEdit && !isOfferLinked && act.relatedType === 'workOrder' && act.relatedId)
      ? getAO(act.relatedId) : null;
    const currentPropertyId = linkedAoForForm ? (linkedAoForForm.propertyId || '') : v('propertyId', '');
    /* V54B — Projekt-kopplingen har INGET eget UI-fält i detta formulär
       (samma "kontextuell metadata, inget synligt val" som customerId/
       propertyId redan har för offert-länkade uppgifter) — den bärs bara
       genom `context`/`existing` och skrivs oförändrad vid Spara, ELLER
       ärvs auktoritativt från en länkad AO (samma princip som ovan). En
       fristående (icke AO-länkad) uppgifts projectId kan alltså aldrig
       ändras via detta formulär, bara sättas vid kontextuellt skapande —
       se _save()s defensiva kund-konsistenskontroll längre ner. */
    this._tempProjectId = linkedAoForForm ? (linkedAoForForm.projectId || '') : v('projectId', '');

    Modal.open({
      title: isEdit ? 'Redigera uppgift' : 'Ny uppgift',
      body: `
        <div class="fg"><label>Titel <span style="color:var(--rd)">*</span></label>
          <input id="act-title" value="${esc(v('title',''))}" placeholder="T.ex. Ring kund om offert"></div>

        <div class="g2">
          <div class="fg"><label>Typ</label>
            <select id="act-type">
              ${ActivitiesService.TYPES.map(t=>`<option value="${t}" ${v('type','followup')===t?'selected':''}>${ActivitiesService.typeLabel(t)}</option>`).join('')}
            </select></div>
          <div class="fg"><label>Prioritet</label>
            <select id="act-priority">
              ${ActivitiesService.PRIORITIES.map(p=>`<option value="${p}" ${v('priority','normal')===p?'selected':''}>${ActivitiesService.priorityLabel(p)}</option>`).join('')}
            </select></div>
        </div>

        <div class="g2">
          <div class="fg"><label>Ansvarig</label>
            <select id="act-assignee">${this._staffOptionsHtml(v('assignedTo',''))}</select></div>
          <div class="fg"><label>Förfallodatum</label>
            <input type="date" id="act-duedate" value="${esc(v('dueDate',''))}"></div>
        </div>

        <div class="g2">
          <div class="fg"><label>Förfallotid (valfritt)</label>
            <input type="time" id="act-duetime" value="${esc(v('dueTime',''))}"></div>
          <div></div>
        </div>

        <div class="fg"><label>Notering</label>
          <textarea id="act-note" rows="2" placeholder="Valfri detalj…">${esc(v('note',''))}</textarea></div>

        <div class="g2">
          <div class="fg"><label>Kund (valfritt)</label>
            ${isOfferLinked
              ? `<div class="ibox" style="font-size:12px;">${ic('user',12)} ${offerLinkedCustomer ? esc(CustomerService.displayName(offerLinkedCustomer)) : 'Okänd kund'} — följer Offert ${esc(act.relatedId)}, kan inte ändras här.</div>`
              : `<select id="act-cu" onchange="ActivitiesPage._customerChangedInForm()">
                   <option value="">— Ingen kund —</option>
                   ${(state.customers||[]).map(c=>`<option value="${c.id}" ${this._tempCustomerId===c.id?'selected':''}>${esc(CustomerService.displayName(c))}</option>`).join('')}
                 </select>`}
          </div>
          <div class="fg"><label>Fastighet (valfritt)</label>
            <select id="act-prop" onchange="ActivitiesPage._propertyChangedInForm()">${this._propertyOptionsHtml(this._tempCustomerId, currentPropertyId)}</select></div>
        </div>

        ${isOfferLinked
          ? `<div class="fg"><label>Arbetsorder</label><div class="ibox" style="font-size:12px;">${ic('file-text',12)} Länkad till Offert ${esc(act.relatedId)} — kan inte ändras här.</div></div>`
          : `<div class="fg"><label>Arbetsorder (valfritt)</label>
               <select id="act-ao" onchange="ActivitiesPage._aoChangedInForm()">${this._aoOptionsHtml(this._tempCustomerId, currentAoId)}</select></div>`}
      `,
      buttons: [
        { label: isEdit ? 'Spara' : 'Skapa uppgift', cls: 'btn bp', onClick: () => this._save(id) },
        ...(isEdit && this._canDeleteTask(act) ? [{ label: 'Ta bort', cls: 'btn bd', onClick: () => { Modal.close(); this.openDeleteModal(id); } }] : []),
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });

    setTimeout(() => document.getElementById('act-title')?.focus(), 80);
  },

  /* Kundbyte i formuläret filtrerar om Fastighet/AO-listorna till den
     valda kunden (§11: "må filtreras om enkelt och säkert" — envägs,
     ingen komplex tvåvägs-cascading). Både Fastighet och AO nollställs —
     en kvarhållen fastighet/AO som hörde till FÖRRA kunden vore precis
     den typen av motsägelsefull relation V53B R1 stänger. */
  _customerChangedInForm() {
    const cuId = document.getElementById('act-cu')?.value || '';
    this._tempCustomerId = cuId;
    const propSel = document.getElementById('act-prop');
    if (propSel) propSel.innerHTML = this._propertyOptionsHtml(cuId, '');
    const aoSel = document.getElementById('act-ao');
    if (aoSel) aoSel.innerHTML = this._aoOptionsHtml(cuId, '');
  },

  /* V53B R1 — kanonisk Fastighet-byte-hanterare. BLOCKERARE-FIX: Fastighet
     och Arbetsorder var tidigare två OBEROENDE väljare — att byta Fastighet
     lämnade en redan vald AO orörd i DOM:en även om den AO:n tillhörde en
     HELT ANNAN fastighet hos SAMMA kund (kundbytet ovan fångar bara fallet
     där kunden själv byts, inte två fastigheter hos samma kund).
     AO-LISTANS INNEHÅLL förblir medvetet kund-filtrerat, inte fastighets-
     filtrerat (se _aoOptionsHtml()s kommentar — man ska fortfarande kunna
     välja en AO på en ANNAN fastighet, det är precis vad _aoChangedInForm()
     nedan synkroniserar från). Det som fixas här är enbart att en redan
     vald AO som INTE längre tillhör den nya fastigheten aldrig lämnas
     kvar som vald — den nollställs tyst istället för att bli en
     motsägelsefull kombination. */
  _propertyChangedInForm() {
    const propId = document.getElementById('act-prop')?.value || '';
    const aoSel = document.getElementById('act-ao');
    if (!aoSel) return;
    const currentAoId = aoSel.value || '';
    if (!currentAoId) return;
    const ao = getAO(currentAoId);
    const aoPropId = ao ? (ao.propertyId || '') : '';
    if (aoPropId !== propId) {
      aoSel.innerHTML = this._aoOptionsHtml(this._tempCustomerId, '');
    }
  },

  /* V53B R1 — kanonisk AO-byte-hanterare. Den valda arbetsordern är
     AUKTORITATIV för både Kund och Fastighet (samma invariant som
     _save() upprätthåller defensivt igen längre ner — se kommentaren
     där för varför BÅDA lagren behövs). AO-listan är redan kund-
     filtrerad så ett faktiskt kundbyte här är i praktiken bara ett
     extra säkerhetslager mot en stale DOM, inte den normala vägen.
     Fastighet sätts alltid till AO:ns EGEN fastighet (tom om AO:n
     saknar en) — en manuellt kvarhållen, avvikande fastighet får
     aldrig stå kvar bredvid den nyvalda AO:n. Att RENSA AO-väljaren
     (aoId === '') rör medvetet varken Kund eller Fastighet — uppgiften
     blir då helt enkelt en vanlig kund-/fastighetsuppgift. */
  _aoChangedInForm() {
    const aoId = document.getElementById('act-ao')?.value || '';
    if (!aoId) return;
    const ao = getAO(aoId);
    if (!ao) return;
    const cuSel = document.getElementById('act-cu');
    if (cuSel && cuSel.value !== (ao.customerId || '')) cuSel.value = ao.customerId || '';
    this._tempCustomerId = ao.customerId || '';
    const propSel = document.getElementById('act-prop');
    if (propSel) propSel.innerHTML = this._propertyOptionsHtml(this._tempCustomerId, ao.propertyId || '');
  },

  _save(id) {
    const title = document.getElementById('act-title')?.value.trim();
    if (!title) { showToast('Titel krävs'); return; }

    /* V53A R3 (oberoende reproducerad blockerare) — `dueTime` FÖRUTSÄTTER
       `dueDate`. Utan denna spärr kunde ett datum rensas medan en gammal
       tid blev kvar (eller en tid anges utan att ett datum någonsin
       fanns) — resultatet blev en uppgift som listas som "Inget
       förfallodatum", sorteras som datumlös, och vars tid blir osynlig/
       meningslös. `_logReschedule()`s "—"-datumformatering kunde då även
       producera en absurd logg som "flyttad från — till —". Den gamla,
       förvunna "Flytta"-funktionen krävde alltid ett datum. Blockerar
       HELT (ingen tyst dagens-datum-gissning, ingen tyst bortkastad
       tid) — användaren måste själv välja datum eller rensa tiden. */
    const dueDateVal = document.getElementById('act-duedate')?.value || '';
    const dueTimeVal = document.getElementById('act-duetime')?.value || '';
    if (dueTimeVal && !dueDateVal) { showToast('Välj ett förfallodatum för att ange förfallotid.'); return; }

    const isEdit = !!id;
    const existing = isEdit ? ActivitiesService._get(id) : null;
    if (isEdit && !existing) return;
    /* V53A R1 §1/§2 — metodnivå-spärr: Spara-knappen är redan dold/nekad
       via openEdit(), men denna kontroll skyddar mot ett direkt anrop. */
    if (isEdit && !this._canEditTask(existing)) { showToast('Du saknar behörighet att redigera denna uppgift'); return; }

    const isOfferLinked = isEdit && existing && existing.relatedType === 'offer';
    /* V53A R2 (legacy-regression, oberoende bekräftad) — fångar det GAMLA
       förfallodatumet OCH -tiden INNAN någon mutation, eftersom `existing`
       är samma objektreferens som ActivitiesService.update() skriver i
       (Object.assign). Behövs för att avgöra om datum ELLER tid FAKTISKT
       ändrades (se _logReschedule()). Den gamla, förvunna "Flytta"-
       funktionen stödde BÅDA fälten — R1 återställde bara datum-delen. */
    const oldDueDate = isEdit && existing ? existing.dueDate : null;
    const oldDueTime = isEdit && existing ? (existing.dueTime || '') : null;

    const data = {
      title,
      type:        document.getElementById('act-type')?.value || 'followup',
      priority:    document.getElementById('act-priority')?.value || 'normal',
      assignedTo:  document.getElementById('act-assignee')?.value || null,
      dueDate:     dueDateVal,
      /* V53A R2 — Förfallotid är valfri och rörs ALDRIG förutom av
         användarens egen inmatning i detta fält: ett tomt fält sparas
         som en avsiktlig tömning (''), aldrig ett tyst kvarlämnat gammalt
         värde och aldrig ett krav att en tid måste anges bara för att ett
         datum finns. (R3: men se valideringen ovan — tid UTAN datum är
         nu blockerad, inte bara "tillåten men meningslös".) */
      dueTime:     dueTimeVal,
      note:        document.getElementById('act-note')?.value.trim() || '',
      propertyId:  document.getElementById('act-prop')?.value || null
    };

    /* V53A R1 §6 — en offert-länkad uppgifts kund är ALDRIG fritt
       redigerbar (se _openForm()s kommentar): den följer alltid offertens
       egen kund, kanoniskt upplöst — läses INTE från ett #act-cu-fält som
       inte ens finns i DOM:en för detta fall. */
    if (isOfferLinked) {
      const off = getOff(existing.relatedId);
      data.customerId = off ? (off.customerId || null) : (existing.customerId || null);
    } else {
      data.customerId = document.getElementById('act-cu')?.value || null;
    }

    /* AO-relationen (relatedType/relatedId) rörs ALDRIG för en
       offert-länkad uppgift — se _openForm()s kommentar. För övriga
       uppgifter styrs den av AO-väljaren.

       V53B R1 — KANONISK INVARIANT, DEFENSIVT LAGER (oberoende
       reproducerad blockerare): den interaktiva synkroniseringen i
       _propertyChangedInForm()/_aoChangedInForm() räcker INTE ensam —
       den håller bara DOM:en konsekvent SÅ LÄNGE användaren faktiskt
       triggar onchange-händelserna. _save() måste garantera invarianten
       OBEROENDE av UI-tillstånd. Regeln: en vald arbetsorder är alltid
       AUKTORITATIV. customerId/propertyId härleds HÄR, ALLTID, från den
       faktiska AO:n i state — aldrig från vad Kund-/Fastighet-väljarna
       råkar visa i DOM:en. Detta gör det omöjligt att spara en AO
       tillsammans med en fastighet/kund den inte tillhör, även om DOM:en
       på något sätt manipulerats eller synkroniseringen ovan av någon
       anledning inte hann köra. */
    /* V54B — Projekt-relationsinvariant (§15): en AO-länkad uppgifts
       projectId är UNDERORDNAD AO:ns egen projectId — precis samma
       "AO:n är auktoritativ"-princip som customerId/propertyId ovan.
       Startvärde: det som redan bars av formuläret (kontext vid
       skapande, eller den befintliga postens värde vid redigering) —
       skrivs bara om nedan om en AO faktiskt är vald. */
    data.projectId = this._tempProjectId || null;

    if (!isOfferLinked) {
      const aoId = document.getElementById('act-ao')?.value || '';
      if (aoId) {
        const ao = getAO(aoId);
        if (!ao) { showToast('Vald arbetsorder kunde inte hittas — spara avbruten.'); return; }
        data.customerId  = ao.customerId || null;
        data.propertyId  = ao.propertyId || null;
        data.relatedType = 'workOrder';
        data.relatedId   = ao.id;
        /* §15 — om AO:n har ett projekt är DET auktoritativt. Om AO:n
           INTE har något projekt men uppgiften ändå bar ett projectId
           (kontextuellt skapad från ett Projekt, sedan kopplad till en
           AO som inte hör till samma projekt) blockeras sparningen
           HELT istället för att tyst skapa en motsägelsefull relation
           — användaren måste först länka AO:n till projektet. */
        if (ao.projectId) {
          data.projectId = ao.projectId;
        } else if (data.projectId) {
          showToast('Den valda arbetsordern är inte kopplad till projektet. Länka arbetsordern till projektet först.');
          return;
        }
      } else {
        data.relatedType = null;
        data.relatedId   = null;
      }
    }

    /* V53B R1 — samma invariant-princip för en FRISTÅENDE fastighets-
       koppling (ingen AO ovan satte customerId/propertyId auktoritativt):
       en stale/manipulerad DOM ska inte kunna spara en fastighet som
       tillhör en ANNAN kund än den valda. Gäller även offert-länkade
       uppgifter (Fastighet-fältet är inte skrivskyddat för dem — bara
       Kund och AO är det, se _openForm()). */
    if (data.relatedType !== 'workOrder' && data.propertyId) {
      const prop = getObj(data.propertyId);
      if (!prop || prop.customerId !== data.customerId) data.propertyId = null;
    }

    /* V54B R1 — blockerare 3: detta slutlager kontrollerade tidigare
       ENDAST kund-konsistens (proj.customerId === data.customerId) för
       en FRISTÅENDE (icke AO-auktoritativ) uppgifts Projekt-koppling —
       vilket lämnade fastighets-invarianten helt okontrollerad. En
       uppgift kunde alltså bära K1/P2/projectId=PRJ1 trots att PRJ1 är
       ett P1-enfastighetsprojekt (P1 och P2 båda hos K1) — en genuint
       ogiltig kombination som ändå kunde persistera. Kontrollen använder
       nu den KANONISKA `ProjectService.isChildCompatible()` (samma
       sanningskälla som AO/Offert redan använder) och BLOCKERAR
       sparningen med ett tydligt meddelande vid en verklig konflikt,
       istället för att tyst rensa kopplingen — en uppgift som
       uttryckligen skapats i ett Projekt-sammanhang ska inte tyst tappa
       den kopplingen bara för att formuläret sparas om. Gäller endast
       icke AO-auktoritativa uppgifter (AO-länkade hanteras redan
       ovan — AO:ns egen projectId vinner alltid där). */
    if (data.relatedType !== 'workOrder' && data.projectId) {
      const compatible = typeof ProjectService !== 'undefined' &&
        ProjectService.isChildCompatible(data.projectId, data.customerId, data.propertyId || '');
      if (!compatible) {
        showToast('Uppgiften kan inte kopplas till projektet — kund eller fastighet stämmer inte överens.');
        return;
      }
    }

    if (isEdit) {
      /* V53A R1/R2 (legacy-regression, oberoende bekräftad) — den gamla
         "Flytta"-funktionen loggade en rad på den länkade offerten/AO:n
         när förfallodatum ELLER -tid ändrades. Det generiska redigera-
         formuläret tappade tyst den sido-effekten. Loggas nu HÄR, EXAKT
         EN gång om NÅGONDERA fältet faktiskt ändrades (aldrig två loggar
         om båda ändras samtidigt, aldrig någon logg vid en oförändrad
         sparning — inklusive en avsiktlig tömning av tiden, vilket också
         räknas som en ändring). */
      if (data.dueDate !== oldDueDate || data.dueTime !== oldDueTime) {
        this._logReschedule(existing, oldDueDate, data.dueDate, oldDueTime, data.dueTime);
      }
      ActivitiesService.update(id, data);
    } else {
      id = ActivitiesService.create(data).id;
    }
    Modal.close();
    Sidebar.updateBadges();
    this.render();
    confirmPersist('activities', id, { ok: isEdit ? 'Uppgift uppdaterad' : 'Uppgift skapad', fail: 'Uppgiften kunde inte sparas', onChange: () => { Sidebar.updateBadges(); this.render(); } });
  },

  /* ── Ta bort ──────────────────────────── */

  openDeleteModal(id) {
    const act = ActivitiesService._get(id);
    if (!act) return;
    /* V53A R1 §1/§2 — metodnivå-spärr: en obehörig kan inte öppna
       bekräftelsedialogen ens genom att anropa detta direkt. Ren
       ao_view_own räcker ALDRIG för permanent radering. */
    if (!this._canDeleteTask(act)) { showToast('Du saknar behörighet att ta bort denna uppgift'); return; }
    Modal.open({
      title: `${ic('trash',14)} Ta bort uppgift`,
      body: `<p style="font-size:13px;color:var(--mt);">"${esc(act.title || ActivitiesService.typeLabel(act.type))}" tas bort permanent. Detta går inte att ångra.</p>`,
      buttons: [
        { label: `${ic('trash',12)} Ta bort`, cls: 'btn bd', onClick: () => {
          /* Andra, sista spärren precis innan den faktiska muteringen —
             skyddar mot att bekräftelseknappen anropas direkt (t.ex.
             konsolen) utan att gå via öppningskontrollen ovan. */
          if (!ActivitiesPage._canDeleteTask(act)) { Modal.close(); showToast('Du saknar behörighet att ta bort denna uppgift'); return; }
          ActivitiesService.delete(id);
          Modal.close();
          Sidebar.updateBadges();
          this.render();
          confirmPersist('activities', id, { ok: 'Uppgift borttagen', fail: 'Uppgiften kunde inte tas bort', onChange: () => { Sidebar.updateBadges(); this.render(); } });
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  }
};
