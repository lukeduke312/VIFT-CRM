/**
 * ImportExportConfigs.js — Registerkonfigurationer för generell import/export
 * F4-1/F4-2/F4-3/F4-4/F4-5: Alla register
 *
 * Kräver: ImportExportService (laddas dessförinnan i index.html)
 *
 * Relationsmotorn är registerspecifik: varje relation anger exakt vilket
 * state-register som söks (lookupIn) och via vilka fält (matchSets).
 * En namnmatchning mot 'customers' kan aldrig råka matcha 'properties'.
 *
 * resolveRelationsForRow() returnerar ett rikt resultat:
 *   { resolved, errors, relationsLog[] }
 * där varje logg-post innehåller: targetField, refValue, lookupIn,
 * matchedField, quality ('exact'|'ambiguous'|'unresolved'), candidates[]
 */

/* ═══════════════════════════════════════════════════════════════════════════
 * Konfigurationsformat
 * ═══════════════════════════════════════════════════════════════════════════
 * label            — plural visningsnamn
 * labelSingular    — singular
 * stateKey         — state[stateKey] = array (null för nästlade, t.ex. serviceIntervals)
 * idPrefix         — t.ex. 'KU', 'PROP'
 * schemaFn()       — Schema.xxx() för nya poster
 * targetPage       — Router.showPage() vid "Gå till register"
 * sensitiveFields  — exkluderas alltid från export om inte opts.includeSensitive
 * importDisabled   — true = import stöds ej (export-only register)
 * historicalImport — true = undertrycker automation (push, AO, billing, notiser)
 * fields[]         — { value, label, required?, type? }
 *   value börjar med '_' = referensfält (löses av relationsmotorn, sparas ej)
 * aliases          — { fieldName: [alias,...] } för auto-matchning
 * relations[]      — relationer till andra register:
 *   { targetField, required?, refFields[], lookupIn, matchSets[][], label }
 *   matchSets: varje element är en lista fält som sammanfogat ska matcha refValue
 * duplicateStrategies[] — {field/fields, label, caseInsensitive?, priority}
 * validate(mapped) → string[] — valideringsfel (körs före relationsupplösning)
 * coerce(obj)      — typmappar fält på plats
 * ═══════════════════════════════════════════════════════════════════════════ */

var IMPORT_EXPORT_CONFIGS = {};

/* ── Kunder ───────────────────────────────────────────────────────────────── */

IMPORT_EXPORT_CONFIGS.customer = {
  label: 'Kunder', labelSingular: 'Kund',
  stateKey: 'customers', idPrefix: 'KU',
  schemaFn: function () { return Schema.customer(); },
  targetPage: 'pg-crm',
  sensitiveFields: [],
  /* CUSTOMER IMPORT R2: `name` är INTE längre ovillkorligen required:true —
     kundimport tillåter numera antingen `name` ELLER ett komplett
     (firstName+lastName) privatpersonsnamn (se den kund-specifika
     mapping-kontrollen i ImportWizardPage._toStep4() och
     RAPPORT-CUSTOMER-IMPORT-R2.md §2). Labels förtydligade enligt samma
     rapport §1. */
  fields: [
    { value: 'name',           label: 'Kund-/företagsnamn'                        },
    { value: 'type',           label: 'Kundtyp'                                   },
    { value: 'orgNr',          label: 'Organisationsnummer'                        },
    { value: 'personnr',       label: 'Personnummer'                               },
    { value: 'firstName',      label: 'Förnamn'                                    },
    { value: 'lastName',       label: 'Efternamn'                                  },
    { value: 'contactPerson',  label: 'Kontaktperson'                              },
    { value: 'phone',          label: 'Telefon'                                    },
    { value: 'email',          label: 'E-post'                                     },
    { value: 'address',        label: 'Huvudadress'                                },
    { value: 'zip',            label: 'Postnummer'                                 },
    { value: 'city',           label: 'Ort'                                        },
    { value: 'invoiceAddress', label: 'Fakturaadress'                              },
    { value: 'invoiceZip',     label: 'Faktura-postnummer'                         },
    { value: 'invoiceCity',    label: 'Fakturaort'                                 },
    { value: 'customerNumber', label: 'Kundnummer'                                 },
    { value: 'externalId',     label: 'Externt ID'                                 },
    { value: 'externalSystem', label: 'Externt system'                             },
    { value: 'paymentTerms',   label: 'Betalningsvillkor (dagar)', type: 'int'     },
    { value: 'note',           label: 'Anteckning'                                 }
  ],
  aliases: {
    name:          ['namn', 'company', 'företag', 'foretagsnamn', 'företagsnamn', 'bolagsnamn'],
    orgNr:         ['orgnr', 'org.nr', 'org nr', 'organisationsnummer', 'cvr', 'vat'],
    personnr:      ['personnr', 'personnummer', 'pnr'],
    type:          ['typ', 'kundtyp'],
    firstName:     ['förnamn', 'fornamn', 'firstname', 'first name'],
    lastName:      ['efternamn', 'lastname', 'last name', 'surname'],
    contactPerson: ['kontaktperson', 'kontakt', 'contact', 'ansvarig'],
    phone:         ['telefon', 'tel', 'mobilnummer', 'mobil', 'mobile'],
    email:         ['e-post', 'epost', 'e-mail', 'mail'],
    address:       ['adress', 'gatuadress', 'street'],
    zip:           ['postnummer', 'zip', 'postcode', 'postal'],
    city:          ['ort', 'stad', 'city'],
    invoiceAddress:['fakturaadress', 'invoice address'],
    invoiceZip:    ['faktura postnummer', 'invoice zip', 'fakturapostnummer'],
    invoiceCity:   ['faktura ort', 'invoice city', 'fakturaort'],
    note:          ['anteckning', 'kommentar', 'notes', 'anmärkning'],
    customerNumber:['kundnummer', 'kund nr', 'customer number', 'kundid'],
    externalId:    ['externt id', 'external id', 'referens', 'ref', 'ext id', 'bokio id'],
    externalSystem:['externt system', 'external system', 'system'],
    paymentTerms:  ['betalningsvillkor', 'betvillkor', 'payment terms', 'netto']
  },
  relations: [],
  duplicateStrategies: [
    { field: 'orgNr',          label: 'Org.nr',   priority: 1 },
    { field: 'externalId',     label: 'Ext.ID',   priority: 2 },
    { field: 'customerNumber', label: 'Kundnr',   priority: 3 },
    { field: 'email',          label: 'E-post',   priority: 4, caseInsensitive: true },
    { fields: ['name','city'], label: 'Namn+ort', priority: 5, caseInsensitive: true }
  ],
  /* CUSTOMER IMPORT R2: körs på den REDAN FÖRBEREDDA raden (efter
     prepareImportRow() nedan har normaliserat `type` och ev. syntetiserat
     `name` från ett komplett firstName+lastName-par) — se
     validateImportRowsForType()s anropsordning
     (mapRow → prepareImportRow → resolveRelations → validate → warnings).
     Se RAPPORT-CUSTOMER-IMPORT-R2.md §2/§6/§7 för exakt block-matris. */
  validate: function (mapped) {
    var e = [];
    var hasCS = typeof CustomerService !== 'undefined';

    /* R2 §7/§9: typ är nu ALLTID obligatorisk på radnivå — saknas den helt
       (tom cell trots mappad kolumn) blockeras raden, den får aldrig tyst
       defaultas till schema-defaulten 'foretag' längre. */
    if (!mapped.type) {
      e.push('Kundtyp saknas.');
      return e;
    }
    /* V49A1/R1: okänd, icke-tom kundtyp blockeras — samma normalisering
       (CustomerService.normalizeType()) som prepareImportRow()/coerce()
       använder, en enda source of truth. Gissar aldrig. */
    var normType = hasCS ? CustomerService.normalizeType(mapped.type) : null;
    if (normType === null) {
      e.push('Okänd kundtyp "' + mapped.type + '". Tillåtna typer är Företag, Privatperson, BRF eller Fastighetsägare.');
      return e;
    }

    /* R2 §10-14: namnkrav är nu typmedvetet. Privatperson: name ELLER ett
       komplett firstName+lastName-par (prepareImportRow() syntetiserar
       redan `name` när båda finns, så denna gren blockerar bara genuint
       ofullständiga rader — bara firstName, bara lastName, eller inget
       alls). Organisation (foretag/brf/fastighetsagare): name krävs alltid
       — firstName/lastName kan ALDRIG ersätta ett organisationsnamn. */
    if (normType === 'privat') {
      var hasStructuredName = !!(mapped.firstName && mapped.lastName);
      if (!mapped.name && !hasStructuredName) {
        e.push('Privatperson saknar namn. Ange Kund-/företagsnamn eller både Förnamn och Efternamn.');
      }
    } else if (!mapped.name) {
      e.push('Organisation saknar Kund-/företagsnamn.');
    }

    return e;
  },

  /* CUSTOMER IMPORT R2 §8-11: liten, EXPLICIT förberedelsehook — INGEN ny
     generisk arkitektur, bara en valfri config-metod som
     validateImportRowsForType() anropar OM den finns (se dess ändrade
     anropsordning). Andra register (properties/articles/staff/…) saknar
     denna metod helt och deras beteende är därmed 100% oförändrat.
     Muterar ALDRIG originalraden — returnerar alltid en NY kopia, som sedan
     används genomgående för validate/warnings/dubblettdetektering OCH det
     faktiska importerade objektet (via resolveRelationsForRow()s
     Object.assign({}, mapped) — customer har inga relations[], så det
     förberedda värdet flödar oförändrat igenom). Detta garanterar att
     förhandsgranskning och faktisk import ser EXAKT samma data. */
  prepareImportRow: function (mapped) {
    var prepared = Object.assign({}, mapped);
    if (typeof CustomerService !== 'undefined') {
      /* Normaliserar type TIDIGT (inte bara vid coerce() som tidigare) så
         att validate()/warnings() nedan kan resonera typmedvetet redan vid
         förhandsgranskning. Följer samma tre-lägen-kontrakt som
         normalizeType() själv: känt värde normaliseras, tomt/okänt värde
         lämnas ORÖRT (gissar aldrig) — validate() fångar båda de senare
         fallen explicit. */
      var norm = CustomerService.normalizeType(prepared.type);
      if (norm) prepared.type = norm;
    }
    /* R2 §10/§11: SÄKER syntes, INTE gissning — två REDAN STRUKTURERADE
       källfält (firstName+lastName, användaren har redan delat upp namnet
       explicit) slås ihop till kompatibilitetsfältet `name`. Detta är
       motsatsen till namnsplit (som ALDRIG görs, se §11) — att slå ihop två
       kända, fullständiga delar är entydigt; att dela upp en okänd sträng
       är det aldrig. Körs ENDAST för privat, ENDAST om `name` saknas,
       ENDAST om BÅDA fälten finns — annars orört, validate() blockerar
       ofullständiga fall (bara firstName eller bara lastName). */
    if (prepared.type === 'privat' && !prepared.name && prepared.firstName && prepared.lastName) {
      prepared.name = (prepared.firstName + ' ' + prepared.lastName).trim();
    }
    return prepared;
  },

  /* CUSTOMER IMPORT R2 §16-18: WARN ONLY — blockerar aldrig, flyttar/gissar
     aldrig något. Körs på samma förberedda rad som validate(). Återanvänder
     den redan existerande `warnings`-arkitekturen i
     validateImportRowsForType()s resultatobjekt (tidigare bara använd för
     "ambiguous"-relationsträffar; customer har inga relations[] så detta är
     den första faktiska användningen av den för kunder). */
  warnings: function (mapped) {
    var w = [];
    var hasCS = typeof CustomerService !== 'undefined';
    var normType = hasCS ? CustomerService.normalizeType(mapped.type) : null;

    if (normType === 'privat') {
      var hasStructuredName = !!(mapped.firstName && mapped.lastName);
      if (mapped.name && !hasStructuredName) {
        w.push('Privatpersonen saknar komplett Förnamn/Efternamn och importeras med ett ostrukturerat namn. Kunden kan behöva granskas senare.');
      }
      if (mapped.name && hasStructuredName) {
        /* Enkel, säker jämförelse — trim + kollapsa whitespace + case-
           insensitive. Ingen avancerad namntolkning. Kastar ALDRIG data:
           båda källvärdena bevaras oförändrade, bara en varning läggs till. */
        var norm = function (s) { return (s || '').toLowerCase().trim().replace(/\s+/g, ' '); };
        if (norm(mapped.name) !== norm(mapped.firstName + ' ' + mapped.lastName)) {
          w.push('Fullständigt namn och Förnamn/Efternamn skiljer sig åt. Kontrollera uppgifterna.');
        }
      }
      if (mapped.orgNr && !mapped.personnr) {
        w.push('Privatpersonen har Organisationsnummer men saknar Personnummer. Kontrollera mappningen.');
      }
    } else if (normType) {
      if (mapped.personnr && !mapped.orgNr) {
        w.push('Organisationen har Personnummer men saknar Organisationsnummer. Kontrollera mappningen.');
      }
    }

    if (mapped.orgNr && mapped.personnr) {
      w.push('Både Organisationsnummer och Personnummer är ifyllda. Kontrollera uppgifterna.');
    }

    if (mapped.invoiceAddress && !mapped.address) {
      w.push('Fakturaadress finns men Huvudadress saknas. Kontrollera adressmappningen.');
    }
    if (mapped.invoiceAddress && (!mapped.invoiceZip || !mapped.invoiceCity)) {
      w.push('Fakturaadressen är ofullständig. Kontrollera faktura-postnummer och fakturaort.');
    }

    return w;
  },
  coerce: function (obj) {
    if (obj.paymentTerms !== undefined && obj.paymentTerms !== '') {
      var n = parseInt(obj.paymentTerms, 10); obj.paymentTerms = isNaN(n) ? 30 : n;
    }
    if (typeof obj.active === 'string') obj.active = obj.active.toLowerCase() !== 'nej' && obj.active !== '0' && obj.active !== 'false';
    /* V49A1: EN gemensam normaliserare (CustomerService.normalizeType())
       ersätter den tidigare lokala 3-posters tm-tabellen, som varken kände
       igen engelska varianter (company/private/…) eller normaliserade
       casing på redan-nästan-korrekta värden (t.ex. "Foretag"). Se
       RAPPORT-V49A1.md §9 för verifiering av laddningsordningen som gör
       detta anrop säkert. Okända värden ska aldrig nå hit — validate()
       ovan blockerar raden innan _runImport() någonsin anropar coerce()
       för den — men om obj.type ändå är okänt (t.ex. en framtida
       anropsväg som hoppar över validate()) lämnas det medvetet ORÖRT
       istället för att gissa, exakt som normalizeType() själv gör. */
    if (obj.type && typeof CustomerService !== 'undefined') {
      var norm = CustomerService.normalizeType(obj.type);
      if (norm) obj.type = norm;
    }
  }
};

/* ── Fastigheter ──────────────────────────────────────────────────────────── */

IMPORT_EXPORT_CONFIGS.property = {
  label: 'Fastigheter', labelSingular: 'Fastighet',
  stateKey: 'properties', idPrefix: 'PROP',
  schemaFn: function () { return Schema.property(); },
  targetPage: 'pg-objects',
  sensitiveFields: ['accessCode', 'keyInfo'],
  fields: [
    { value: 'name',                label: 'Namn *',                  required: true },
    { value: 'propertyDesignation', label: 'Fastighetsbeteckning'                   },
    { value: 'address',             label: 'Adress'                                 },
    { value: 'zip',                 label: 'Postnummer'                             },
    { value: 'city',                label: 'Ort'                                    },
    { value: 'objectNumber',        label: 'Objektnummer'                           },
    { value: 'type',                label: 'Fastighetstyp'                          },
    { value: 'buildYear',           label: 'Byggnadsår'                             },
    { value: 'apartments',          label: 'Antal lägenheter',  type: 'int'         },
    { value: 'area',                label: 'Total yta (m²)',    type: 'float'       },
    { value: 'managementType',      label: 'Förvaltningsform'                       },
    { value: 'operationalArea',     label: 'Driftområde'                            },
    { value: 'status',              label: 'Status'                                 },
    { value: 'note',                label: 'Anteckning'                             },
    { value: '_customerRef',        label: 'Kund (kundnummer / org.nr / namn)'      }
  ],
  aliases: {
    name:                ['namn', 'fastighetens namn', 'property name'],
    propertyDesignation: ['fastighetsbeteckning', 'beteckning', 'fastbet', 'designation'],
    address:             ['adress', 'gatuadress', 'street'],
    zip:                 ['postnummer', 'zip', 'postcode'],
    city:                ['ort', 'stad', 'city'],
    objectNumber:        ['objektnummer', 'obj.nr', 'fastighetsnr'],
    type:                ['fastighetstyp', 'typ'],
    buildYear:           ['byggnadsår', 'byggår', 'build year', 'built'],
    apartments:          ['lägenheter', 'antal lägenheter', 'apartments', 'bostäder'],
    area:                ['area', 'yta', 'total yta', 'bta'],
    managementType:      ['förvaltningsform', 'management'],
    note:                ['anteckning', 'kommentar', 'note'],
    _customerRef:        ['kund', 'kundnummer', 'customer', 'org.nr', 'organisationsnummer']
  },
  relations: [
    {
      label: 'Kund',
      targetField: 'customerId', required: false,
      refFields: ['_customerRef'],
      lookupIn: 'customers',     /* söker ENDAST i state.customers */
      matchSets: [['customerNumber'], ['orgNr'], ['name']]
    }
  ],
  duplicateStrategies: [
    { field: 'propertyDesignation', label: 'Fastighetsbeteckning', priority: 1, caseInsensitive: true },
    { field: 'externalId',          label: 'Ext.ID',               priority: 2 },
    { fields: ['name','address'],   label: 'Namn+adress',          priority: 3, caseInsensitive: true }
  ],
  validate: function (mapped) {
    var e = [];
    if (!mapped.name) e.push('Namn saknas');
    return e;
  },
  coerce: function (obj) {
    if (obj.apartments !== undefined) { var n = parseInt(obj.apartments,10); obj.apartments = isNaN(n)?0:n; }
    if (obj.area !== undefined) { var f = parseFloat(obj.area); obj.area = isNaN(f)?0:f; }
    if (obj.buildYear !== undefined && obj.buildYear !== '') obj.buildYear = String(parseInt(obj.buildYear,10)||obj.buildYear);
  }
};

/* ── Objekt (lägenheter / lokaler) ───────────────────────────────────────── */

IMPORT_EXPORT_CONFIGS.propertyObject = {
  label: 'Objekt (lägenheter/lokaler)', labelSingular: 'Objekt',
  stateKey: 'propertyObjects', idPrefix: 'OBJ',
  schemaFn: function () { return Schema.propertyObject(); },
  targetPage: 'pg-objects',
  sensitiveFields: ['doorCode', 'keyInformation'],
  fields: [
    { value: 'name',         label: 'Namn *',                          required: true  },
    { value: 'objectNumber', label: 'Objektnummer'                                     },
    { value: 'type',         label: 'Typ (lagenhet/lokal/etc.)'                        },
    { value: 'address',      label: 'Adress'                                           },
    { value: 'postalCode',   label: 'Postnummer'                                       },
    { value: 'city',         label: 'Ort'                                              },
    { value: 'entrance',     label: 'Port/Entré'                                       },
    { value: 'stairwell',    label: 'Trapphus'                                         },
    { value: 'floor',        label: 'Våning'                                           },
    { value: 'area',         label: 'Yta (m²)', type: 'float'                         },
    { value: 'status',       label: 'Status'                                           },
    { value: 'description',  label: 'Beskrivning'                                      },
    { value: '_propertyRef', label: 'Fastighet (beteckning / namn) *', required: true  },
    { value: '_customerRef', label: 'Kund (kundnummer / org.nr)'                       }
  ],
  aliases: {
    name:          ['namn', 'objektnamn', 'object name', 'lägenhet', 'lokal'],
    objectNumber:  ['objektnummer', 'lgh.nr', 'lägenhetsnummer', 'nr'],
    type:          ['typ', 'objekttyp'],
    address:       ['adress', 'address'],
    postalCode:    ['postnummer', 'zip'],
    city:          ['ort', 'stad', 'city'],
    entrance:      ['port', 'entré', 'entrance'],
    stairwell:     ['trapphus', 'trappa', 'stairwell'],
    floor:         ['våning', 'plan', 'floor'],
    area:          ['yta', 'area', 'kvm', 'm2'],
    description:   ['beskrivning', 'kommentar'],
    _propertyRef:  ['fastighet', 'fastighetsbeteckning', 'fastbet'],
    _customerRef:  ['kund', 'kundnummer', 'org.nr']
  },
  relations: [
    {
      label: 'Fastighet',
      targetField: 'propertyId', required: true,
      refFields: ['_propertyRef'],
      lookupIn: 'properties',  /* söker ENDAST i state.properties */
      matchSets: [['propertyDesignation'], ['objectNumber'], ['name']]
    },
    {
      label: 'Kund',
      targetField: 'customerId', required: false,
      refFields: ['_customerRef'],
      lookupIn: 'customers',   /* söker ENDAST i state.customers */
      matchSets: [['customerNumber'], ['orgNr'], ['name']]
    }
  ],
  duplicateStrategies: [
    { fields: ['propertyId','objectNumber'], label: 'Fastighet+objektnr', priority: 1 },
    { fields: ['propertyId','name'],         label: 'Fastighet+namn',     priority: 2, caseInsensitive: true }
  ],
  validate: function (mapped) {
    var e = [];
    if (!mapped.name) e.push('Namn saknas');
    return e;
  },
  coerce: function (obj) {
    if (obj.area !== undefined) { var f = parseFloat(obj.area); obj.area = isNaN(f)?0:f; }
    var validTypes = ['lagenhet','lokal','butik','kontor','forrad','garage','parkering','teknik','gemensamt','byggnad','annat'];
    if (obj.type) {
      var t = obj.type.toLowerCase().replace(/å/g,'a').replace(/ä/g,'a').replace(/ö/g,'o');
      obj.type = validTypes.indexOf(t) !== -1 ? t : 'annat';
    }
  }
};

/* ── Artiklar ─────────────────────────────────────────────────────────────── */

IMPORT_EXPORT_CONFIGS.article = {
  label: 'Artiklar', labelSingular: 'Artikel',
  stateKey: 'articles', idPrefix: 'ART',
  schemaFn: function () { return Schema.article(); },
  targetPage: 'pg-articles',
  sensitiveFields: [],
  fields: [
    { value: 'name',          label: 'Namn *',           required: true  },
    { value: 'articleNumber', label: 'Artikelnummer'                     },
    { value: 'category',      label: 'Kategori'                          },
    { value: 'unit',          label: 'Enhet (st/tim/m²)'                 },
    { value: 'buyPrice',      label: 'Inköpspris (kr)',  type: 'float'   },
    { value: 'sellPrice',     label: 'Säljpris (kr)',    type: 'float'   },
    { value: 'markup',        label: 'Pålägg (%)',       type: 'float'   },
    { value: 'vatRate',       label: 'Momssats (%)',     type: 'float'   },
    { value: 'supplier',      label: 'Leverantör'                        },
    { value: 'note',          label: 'Anteckning'                        }
  ],
  aliases: {
    name:          ['namn', 'artikel', 'benämning', 'description'],
    articleNumber: ['artikelnummer', 'art.nr', 'artnr', 'sku'],
    category:      ['kategori', 'category', 'typ'],
    unit:          ['enhet', 'unit'],
    buyPrice:      ['inköpspris', 'inpris', 'kostpris', 'buy price', 'cost'],
    sellPrice:     ['säljpris', 'utpris', 'pris', 'sell price', 'price'],
    markup:        ['pålägg', 'markup', 'marginal'],
    vatRate:       ['moms', 'momssats', 'vat', 'vat rate'],
    supplier:      ['leverantör', 'supplier', 'vendor'],
    note:          ['anteckning', 'kommentar', 'note']
  },
  relations: [],
  duplicateStrategies: [
    { field: 'articleNumber', label: 'Artikelnummer', priority: 1 },
    { field: 'name',          label: 'Namn',          priority: 2, caseInsensitive: true }
  ],
  validate: function (mapped) { return mapped.name ? [] : ['Namn saknas']; },
  coerce: function (obj) {
    ['buyPrice','sellPrice','markup','vatRate'].forEach(function (f) {
      if (obj[f] !== undefined && obj[f] !== '') {
        var n = parseFloat(String(obj[f]).replace(',','.')); obj[f] = isNaN(n)?0:n;
      }
    });
    if (typeof obj.active === 'string') obj.active = obj.active.toLowerCase() !== 'nej' && obj.active !== '0';
  }
};

/* ── Prisgrupper ──────────────────────────────────────────────────────────── */

IMPORT_EXPORT_CONFIGS.priceGroup = {
  label: 'Prisgrupper', labelSingular: 'Prisgrupp',
  stateKey: 'priceGroups', idPrefix: 'PG',
  schemaFn: function () { return Schema.priceGroup(); },
  targetPage: 'pg-pricegroups',
  sensitiveFields: [],
  fields: [
    { value: 'name',        label: 'Namn *',       required: true  },
    { value: 'hourRate',    label: 'Timtaxa (kr)', type: 'float'   },
    { value: 'description', label: 'Beskrivning'                   }
  ],
  aliases: {
    name:        ['namn', 'prisgrupp', 'price group'],
    hourRate:    ['timtaxa', 'timpris', 'hourrate', 'rate', 'kr/tim'],
    description: ['beskrivning', 'description', 'kommentar']
  },
  relations: [],
  duplicateStrategies: [
    { field: 'name', label: 'Namn', priority: 1, caseInsensitive: true }
  ],
  validate: function (mapped) { return mapped.name ? [] : ['Namn saknas']; },
  coerce: function (obj) {
    if (obj.hourRate !== undefined && obj.hourRate !== '') {
      var n = parseFloat(String(obj.hourRate).replace(',','.')); obj.hourRate = isNaN(n)?0:n;
    }
    if (typeof obj.active === 'string') obj.active = obj.active.toLowerCase() !== 'nej' && obj.active !== '0';
  }
};

/* ── Personal ─────────────────────────────────────────────────────────────── */
/* OBS: Import tillåter ALDRIG lösenord, PIN, token eller autentiseringsuppgifter.
 * Role 'admin' nedgraderas automatiskt till 'personal' — kräver manuell ändring.  */

IMPORT_EXPORT_CONFIGS.staff = {
  label: 'Personal', labelSingular: 'Personalpost',
  stateKey: 'staff', idPrefix: 'PRS',
  schemaFn: function () { return Schema.staff(); },
  targetPage: 'pg-staff',
  sensitiveFields: ['passwordHash', 'password', 'permissions'],
  requiresAdminRoleConfirm: true,
  fields: [
    { value: 'firstName', label: 'Förnamn *',        required: true  },
    { value: 'lastName',  label: 'Efternamn *',      required: true  },
    { value: 'email',     label: 'E-post'                            },
    { value: 'phone',     label: 'Telefon'                           },
    { value: 'title',     label: 'Titel/Befattning'                  },
    { value: 'role',      label: 'Roll (personal/chef)'              }
  ],
  aliases: {
    firstName: ['förnamn', 'first name', 'firstname'],
    lastName:  ['efternamn', 'last name', 'lastname', 'surname'],
    email:     ['e-post', 'epost', 'email', 'mail'],
    phone:     ['telefon', 'mobil', 'tel', 'phone'],
    title:     ['titel', 'befattning', 'title', 'job title'],
    role:      ['roll', 'behörighet', 'role']
  },
  relations: [],
  duplicateStrategies: [
    { field: 'email',                    label: 'E-post', priority: 1, caseInsensitive: true },
    { fields: ['firstName','lastName'],  label: 'Namn',   priority: 2, caseInsensitive: true }
  ],
  validate: function (mapped) {
    var e = [];
    if (!mapped.firstName) e.push('Förnamn saknas');
    if (!mapped.lastName)  e.push('Efternamn saknas');
    if (mapped.passwordHash || mapped.password) e.push('Lösenordsfält är inte tillåtna vid import');
    return e;
  },
  coerce: function (obj) {
    delete obj.password; delete obj.passwordHash; delete obj.permissions;
    if (obj.role) {
      var r = obj.role.toLowerCase();
      obj.role = (r === 'chef' || r === 'manager') ? 'chef' : 'personal';
      // admin-rollen sätts aldrig automatiskt via import
    } else { obj.role = 'personal'; }
    if (typeof obj.active === 'string') obj.active = obj.active.toLowerCase() !== 'nej' && obj.active !== '0';
  }
};

/* ── Arbetsordrar (export primärt, import med historicalImport) ───────────── */

IMPORT_EXPORT_CONFIGS.workOrder = {
  label: 'Arbetsordrar', labelSingular: 'Arbetsorder',
  stateKey: 'workOrders', idPrefix: 'AO',
  schemaFn: function () { return Schema.workOrder(); },
  targetPage: 'pg-ao',
  sensitiveFields: ['accessCode'],
  historicalImport: true,   /* undertrycker push, auto-AO, billing, notiser */
  fields: [
    { value: 'title',         label: 'Titel *',         required: true    },
    { value: 'description',   label: 'Beskrivning'                        },
    { value: 'status',        label: 'Status'                             },
    { value: 'priority',      label: 'Prioritet'                          },
    { value: 'category',      label: 'Kategori'                           },
    { value: 'address',       label: 'Adress'                             },
    { value: 'contactPerson', label: 'Kontaktperson'                      },
    { value: 'phone',         label: 'Telefon'                            },
    { value: 'scheduledDate', label: 'Planerat datum'                     },
    { value: 'createdAt',     label: 'Skapad'                             },
    { value: 'completedAt',   label: 'Slutförd'                           },
    { value: '_customerRef',  label: 'Kund (kundnummer / org.nr / namn)'  },
    { value: '_propertyRef',  label: 'Fastighet (beteckning / namn)'      }
  ],
  aliases: {
    title:         ['titel', 'rubrik', 'ärende', 'title'],
    description:   ['beskrivning', 'detaljer', 'description'],
    status:        ['status'],
    priority:      ['prioritet', 'priority'],
    category:      ['kategori', 'typ', 'category'],
    address:       ['adress', 'address'],
    contactPerson: ['kontakt', 'kontaktperson', 'contact'],
    phone:         ['telefon', 'tel', 'phone'],
    scheduledDate: ['planerat', 'datum', 'scheduled', 'date'],
    createdAt:     ['skapad', 'created', 'datum'],
    completedAt:   ['slutförd', 'klar', 'completed'],
    _customerRef:  ['kund', 'kundnummer', 'customer'],
    _propertyRef:  ['fastighet', 'fastighetsbeteckning', 'property']
  },
  relations: [
    {
      label: 'Kund',
      targetField: 'customerId', required: false,
      refFields: ['_customerRef'],
      lookupIn: 'customers',   /* söker ENDAST i state.customers */
      matchSets: [['customerNumber'], ['orgNr'], ['name']]
    },
    {
      label: 'Fastighet',
      targetField: 'propertyId', required: false,
      refFields: ['_propertyRef'],
      lookupIn: 'properties',  /* söker ENDAST i state.properties */
      matchSets: [['propertyDesignation'], ['objectNumber'], ['name']]
    }
  ],
  duplicateStrategies: [
    { field: 'id',                       label: 'ID',            priority: 1 },
    { fields: ['customerId','title','scheduledDate'], label: 'Kund+titel+datum', priority: 2, caseInsensitive: true }
  ],
  validate: function (mapped) { return mapped.title ? [] : ['Titel saknas']; },
  coerce: function (obj) {
    var validStatus = ['nytt','pool','planerad','pågående','klar','fakturerad','avbruten'];
    if (obj.status && validStatus.indexOf(obj.status.toLowerCase()) !== -1) obj.status = obj.status.toLowerCase();
    else if (obj.status) obj.status = 'nytt';
    else obj.status = 'nytt';
    var validPrio = ['akut','hög','normal','låg'];
    if (!obj.priority || validPrio.indexOf(obj.priority.toLowerCase()) === -1) obj.priority = 'normal';
    else obj.priority = obj.priority.toLowerCase();
  }
};

/* ── Tidrapportering ─────────────────────────────────────────────────────── */

IMPORT_EXPORT_CONFIGS.timeEntry = {
  label: 'Tidrapportering', labelSingular: 'Tidpost',
  stateKey: 'timeEntries', idPrefix: 'TID',
  schemaFn: function () { return Schema.timeEntry(); },
  targetPage: 'pg-tid',
  sensitiveFields: [],
  historicalImport: true,
  fields: [
    { value: 'date',      label: 'Datum *',        required: true  },
    { value: 'startStr',  label: 'Starttid (HH:MM)'               },
    { value: 'endStr',    label: 'Sluttid (HH:MM)'                 },
    { value: 'minutes',   label: 'Minuter',        type: 'int'     },
    { value: 'comment',   label: 'Kommentar'                       },
    { value: 'billable',  label: 'Debiterbar (ja/nej)'             },
    { value: '_staffRef', label: 'Personal (e-post / namn)'        },
    { value: '_aoRef',    label: 'Arbetsorder-ID'                  }
  ],
  aliases: {
    date:      ['datum', 'date', 'dag'],
    startStr:  ['start', 'starttid', 'från', 'from'],
    endStr:    ['slut', 'sluttid', 'till', 'to'],
    minutes:   ['minuter', 'tid', 'duration', 'minutes'],
    comment:   ['kommentar', 'anteckning', 'comment'],
    billable:  ['debiterbar', 'fakturerbar', 'billable'],
    _staffRef: ['personal', 'medarbetare', 'staff', 'e-post', 'email'],
    _aoRef:    ['ao', 'arbetsorder', 'ao-id', 'work order']
  },
  relations: [
    {
      label: 'Personal',
      targetField: 'staffId', required: false,
      refFields: ['_staffRef'],
      lookupIn: 'staff',        /* söker ENDAST i state.staff */
      matchSets: [['email'], ['firstName', 'lastName']]
    },
    {
      label: 'Arbetsorder',
      targetField: 'aoId', required: false,
      refFields: ['_aoRef'],
      lookupIn: 'workOrders',   /* söker ENDAST i state.workOrders */
      matchSets: [['id'], ['title']]
    }
  ],
  duplicateStrategies: [
    { fields: ['staffId','date','startStr'], label: 'Personal+datum+start', priority: 1 }
  ],
  validate: function (mapped) { return mapped.date ? [] : ['Datum saknas']; },
  coerce: function (obj) {
    if (obj.minutes !== undefined && obj.minutes !== '') {
      var n = parseInt(obj.minutes, 10); obj.minutes = isNaN(n) ? 0 : n;
    }
    if (typeof obj.billable === 'string') {
      obj.billable = obj.billable.toLowerCase() !== 'nej' && obj.billable !== '0' && obj.billable !== 'false';
    }
  }
};

/* ── Fakturaunderlag ─────────────────────────────────────────────────────── */

IMPORT_EXPORT_CONFIGS.invoice = {
  label: 'Fakturaunderlag', labelSingular: 'Faktura',
  stateKey: 'invoices', idPrefix: 'INV',
  schemaFn: function () { return Schema.invoice(); },
  targetPage: 'pg-invoices',
  sensitiveFields: [],
  historicalImport: true,
  importDisabled: true,   /* komplexa rader — stöds i Fas 4-6 */
  fields: [
    { value: 'title',             label: 'Titel'                                       },
    { value: 'status',            label: 'Status'                                      },
    { value: 'dueDate',           label: 'Förfallodatum'                               },
    { value: 'paymentTerms',      label: 'Betalningsvillkor (dagar)', type: 'int'      },
    { value: 'customerReference', label: 'Kundreferens'                                },
    { value: 'ocr',               label: 'OCR / referensnr'                            },
    { value: 'note',              label: 'Anteckning'                                  },
    { value: 'createdAt',         label: 'Skapad'                                      },
    { value: 'sentAt',            label: 'Skickad'                                     },
    { value: 'paidAt',            label: 'Betald'                                      },
    { value: '_customerRef',      label: 'Kund (kundnummer / org.nr / namn)'           },
    { value: '_propertyRef',      label: 'Fastighet (beteckning / namn)'               }
  ],
  aliases: {
    title:             ['titel', 'rubrik'],
    status:            ['status'],
    dueDate:           ['förfallodag', 'förfallodatum', 'due', 'due date'],
    paymentTerms:      ['betalningsvillkor', 'payment terms', 'netto'],
    customerReference: ['kundreferens', 'er ref', 'reference'],
    ocr:               ['ocr', 'ref.nr', 'referensnummer'],
    note:              ['anteckning', 'kommentar', 'note'],
    sentAt:            ['skickad', 'sent'],
    paidAt:            ['betald', 'paid'],
    _customerRef:      ['kund', 'kundnummer'],
    _propertyRef:      ['fastighet', 'fastighetsbeteckning']
  },
  relations: [
    {
      label: 'Kund',
      targetField: 'customerId', required: false,
      refFields: ['_customerRef'],
      lookupIn: 'customers',
      matchSets: [['customerNumber'], ['orgNr'], ['name']]
    },
    {
      label: 'Fastighet',
      targetField: 'propertyId', required: false,
      refFields: ['_propertyRef'],
      lookupIn: 'properties',
      matchSets: [['propertyDesignation'], ['objectNumber'], ['name']]
    }
  ],
  duplicateStrategies: [
    { field: 'id',                    label: 'ID',              priority: 1 },
    { fields: ['customerId','ocr'],   label: 'Kund+OCR',        priority: 2 }
  ],
  validate: function () { return []; },
  coerce: function (obj) {
    if (obj.paymentTerms !== undefined && obj.paymentTerms !== '') {
      var n = parseInt(obj.paymentTerms, 10); obj.paymentTerms = isNaN(n) ? 30 : n;
    }
  }
};

/* ── Ronderingsmallar ─────────────────────────────────────────────────────── */

IMPORT_EXPORT_CONFIGS.ronderingsmall = {
  label: 'Ronderingsmallar', labelSingular: 'Ronderingsmall',
  stateKey: 'ronderingsmallar', idPrefix: 'RMT',
  schemaFn: function () { return Schema.ronderingsmall(); },
  targetPage: 'pg-rondering',
  sensitiveFields: [],
  fields: [
    { value: 'name',        label: 'Namn *',        required: true  },
    { value: 'description', label: 'Beskrivning'                    },
    { value: 'interval',    label: 'Intervall'                      },
    { value: '_propertyRef',label: 'Fastighet (beteckning / namn)'  },
    { value: '_customerRef',label: 'Kund (kundnummer / org.nr)'     }
  ],
  aliases: {
    name:        ['namn', 'mall', 'template', 'name'],
    description: ['beskrivning', 'description'],
    interval:    ['intervall', 'frekvens', 'interval'],
    _propertyRef:['fastighet', 'fastighetsbeteckning'],
    _customerRef:['kund', 'kundnummer']
  },
  relations: [
    {
      label: 'Fastighet',
      targetField: 'propertyId', required: false,
      refFields: ['_propertyRef'],
      lookupIn: 'properties',
      matchSets: [['propertyDesignation'], ['name']]
    },
    {
      label: 'Kund',
      targetField: 'customerId', required: false,
      refFields: ['_customerRef'],
      lookupIn: 'customers',
      matchSets: [['customerNumber'], ['orgNr'], ['name']]
    }
  ],
  duplicateStrategies: [
    { field: 'name', label: 'Namn', priority: 1, caseInsensitive: true }
  ],
  validate: function (mapped) { return mapped.name ? [] : ['Namn saknas']; },
  coerce: function (obj) {
    var validIntervals = ['dagligen','veckovis','varannan_vecka','månadsvis','kvartalsvis','årsvis','eget'];
    if (!obj.interval || validIntervals.indexOf(obj.interval) === -1) obj.interval = 'månadsvis';
    if (typeof obj.active === 'string') obj.active = obj.active.toLowerCase() !== 'nej' && obj.active !== '0';
  }
};

/* ── Avvikelser ──────────────────────────────────────────────────────────── */

IMPORT_EXPORT_CONFIGS.avvikelse = {
  label: 'Avvikelser', labelSingular: 'Avvikelse',
  stateKey: 'avvikelser', idPrefix: 'AVV',
  schemaFn: function () { return Schema.avvikelse(); },
  targetPage: 'pg-rondering',
  sensitiveFields: [],
  historicalImport: true,
  fields: [
    { value: 'title',        label: 'Titel *',         required: true  },
    { value: 'comment',      label: 'Kommentar'                        },
    { value: 'priority',     label: 'Prioritet'                        },
    { value: 'status',       label: 'Status'                           },
    { value: 'createdAt',    label: 'Skapad'                           },
    { value: '_propertyRef', label: 'Fastighet (beteckning / namn)'    },
    { value: '_objectRef',   label: 'Objekt (objektnummer / namn)'     }
  ],
  aliases: {
    title:        ['titel', 'avvikelse', 'rubrik', 'title'],
    comment:      ['kommentar', 'beskrivning', 'comment'],
    priority:     ['prioritet', 'priority'],
    status:       ['status'],
    createdAt:    ['skapad', 'datum', 'created'],
    _propertyRef: ['fastighet', 'fastighetsbeteckning'],
    _objectRef:   ['objekt', 'objektnummer', 'lägenhet']
  },
  relations: [
    {
      label: 'Fastighet',
      targetField: 'propertyId', required: false,
      refFields: ['_propertyRef'],
      lookupIn: 'properties',   /* söker ENDAST i state.properties */
      matchSets: [['propertyDesignation'], ['name']]
    },
    {
      label: 'Objekt',
      targetField: 'objectId', required: false,
      refFields: ['_objectRef'],
      lookupIn: 'propertyObjects',  /* söker ENDAST i state.propertyObjects */
      matchSets: [['objectNumber'], ['name']]
    }
  ],
  duplicateStrategies: [
    { fields: ['propertyId','title','createdAt'], label: 'Fastighet+titel+datum', priority: 1, caseInsensitive: true }
  ],
  validate: function (mapped) { return mapped.title ? [] : ['Titel saknas']; },
  coerce: function (obj) {
    var validPrio = ['akut','hög','normal','låg'];
    if (!obj.priority || validPrio.indexOf(obj.priority.toLowerCase()) === -1) obj.priority = 'normal';
    else obj.priority = obj.priority.toLowerCase();
    var validStatus = ['öppen','åtgärdad','avskriven'];
    if (!obj.status || validStatus.indexOf(obj.status.toLowerCase()) === -1) obj.status = 'öppen';
    else obj.status = obj.status.toLowerCase();
  }
};

/* ── Kontaktpersoner (export-only, tillplattas från customer.contacts[]) ─── */

IMPORT_EXPORT_CONFIGS.customerContact = {
  label: 'Kontaktpersoner', labelSingular: 'Kontaktperson',
  stateKey: null,          /* nästlat i customer.contacts[] */
  importDisabled: true,
  targetPage: 'pg-crm',
  sensitiveFields: [],
  fields: [
    { value: 'customerId',   label: 'Kund-ID'     },
    { value: 'customerName', label: 'Kundnamn'    },
    { value: 'name',         label: 'Namn'        },
    { value: 'phone',        label: 'Telefon'     },
    { value: 'email',        label: 'E-post'      },
    { value: 'role',         label: 'Roll/Titel'  }
  ],
  exportFn: function () {
    var headers = ['Kund-ID', 'Kundnamn', 'Namn', 'Telefon', 'E-post', 'Roll/Titel'];
    var rows = [];
    (typeof state !== 'undefined' ? state.customers || [] : []).forEach(function (cu) {
      (cu.contacts || []).forEach(function (c) {
        rows.push([cu.id, cu.name || '', c.name || '', c.phone || '', c.email || '', c.role || '']);
      });
    });
    return { headers: headers, rows: rows };
  }
};

/* ── Materialrader (export-only, tillplattas från workOrder.materials[]) ─── */

IMPORT_EXPORT_CONFIGS.materialRow = {
  label: 'Materialrader', labelSingular: 'Materialsrad',
  stateKey: null,
  importDisabled: true,
  targetPage: 'pg-ao',
  sensitiveFields: [],
  historicalImport: true,
  fields: [
    { value: 'aoId',       label: 'AO-ID'        },
    { value: 'aoTitle',    label: 'AO-titel'     },
    { value: 'articleId',  label: 'Artikel-ID'   },
    { value: 'name',       label: 'Namn'         },
    { value: 'qty',        label: 'Antal'        },
    { value: 'unit',       label: 'Enhet'        },
    { value: 'buyPrice',   label: 'Inpris'       },
    { value: 'sellPrice',  label: 'Utpris'       },
    { value: 'addedAt',    label: 'Tillagd'      }
  ],
  exportFn: function () {
    var headers = ['AO-ID', 'AO-titel', 'Artikel-ID', 'Namn', 'Antal', 'Enhet', 'Inpris', 'Utpris', 'Tillagd'];
    var rows = [];
    (typeof state !== 'undefined' ? state.workOrders || [] : []).forEach(function (ao) {
      (ao.materials || []).forEach(function (m) {
        rows.push([ao.id, ao.title || '', m.articleId || '', m.name || '', m.qty != null ? m.qty : '', m.unit || '', m.buyPrice != null ? m.buyPrice : '', m.sellPrice != null ? m.sellPrice : '', m.addedAt || '']);
      });
    });
    return { headers: headers, rows: rows };
  }
};

/* ── Ronderingspass ───────────────────────────────────────────────────────── */

IMPORT_EXPORT_CONFIGS.ronderingPass = {
  label: 'Ronderingspass', labelSingular: 'Ronderingspass',
  stateKey: 'ronderingspass', idPrefix: 'RPASS',
  schemaFn: function () { return Schema.ronderingspass(); },
  targetPage: 'pg-rondering',
  sensitiveFields: [],
  historicalImport: true,
  fields: [
    { value: 'scheduledDate',  label: 'Planerat datum *',           required: true },
    { value: 'scheduledTime',  label: 'Planerad tid'                               },
    { value: 'status',         label: 'Status'                                     },
    { value: 'completedAt',    label: 'Slutförd'                                   },
    { value: 'internalNote',   label: 'Intern notering'                            },
    { value: '_mallRef',       label: 'Mall (namn / ID)'                           },
    { value: '_propertyRef',   label: 'Fastighet (beteckning / namn)'              },
    { value: '_customerRef',   label: 'Kund (kundnummer / org.nr)'                 }
  ],
  aliases: {
    scheduledDate: ['datum', 'planerat datum', 'date'],
    scheduledTime: ['tid', 'planerad tid', 'time'],
    status:        ['status'],
    completedAt:   ['slutförd', 'completed', 'klar'],
    internalNote:  ['notering', 'anteckning', 'note'],
    _mallRef:      ['mall', 'mallen', 'template', 'mallnamn'],
    _propertyRef:  ['fastighet', 'fastighetsbeteckning'],
    _customerRef:  ['kund', 'kundnummer']
  },
  relations: [
    {
      label: 'Ronderingsmall',
      targetField: 'mallId', required: false,
      refFields: ['_mallRef'],
      lookupIn: 'ronderingsmallar',
      matchSets: [['id'], ['name']]
    },
    {
      label: 'Fastighet',
      targetField: 'propertyId', required: false,
      refFields: ['_propertyRef'],
      lookupIn: 'properties',
      matchSets: [['propertyDesignation'], ['name']]
    },
    {
      label: 'Kund',
      targetField: 'customerId', required: false,
      refFields: ['_customerRef'],
      lookupIn: 'customers',
      matchSets: [['customerNumber'], ['orgNr'], ['name']]
    }
  ],
  duplicateStrategies: [
    { fields: ['mallId','propertyId','scheduledDate'], label: 'Mall+Fastighet+Datum', priority: 1 }
  ],
  validate: function (mapped) { return mapped.scheduledDate ? [] : ['Planerat datum saknas']; },
  coerce: function (obj) {
    var validStatus = ['planerat','pågående','slutfört','har_avvikelser'];
    if (!obj.status || validStatus.indexOf(obj.status.toLowerCase()) === -1) obj.status = 'planerat';
    else obj.status = obj.status.toLowerCase();
  }
};

/* ── Återkommande ronderingar (export-only, state.ronderingar) ───────────── */

IMPORT_EXPORT_CONFIGS.ronderingSchema = {
  label: 'Återkommande ronderingar', labelSingular: 'Rondering',
  stateKey: 'ronderingar',
  importDisabled: true,   /* komplexa nästlade strukturer, import planeras senare */
  targetPage: 'pg-rondering',
  sensitiveFields: [],
  fields: [
    { value: 'name',          label: 'Namn'           },
    { value: 'templateName',  label: 'Mall'           },
    { value: 'status',        label: 'Status'         },
    { value: 'customerId',    label: 'Kund-ID'        },
    { value: 'propertyId',    label: 'Fastighets-ID'  },
    { value: 'pricingType',   label: 'Pristyp'        },
    { value: 'debiterbar',    label: 'Debiterbar'     },
    { value: 'completedAt',   label: 'Slutförd'       },
    { value: 'createdAt',     label: 'Skapad'         }
  ],
  aliases: {},
  relations: [],
  duplicateStrategies: [
    { field: 'id', label: 'ID', priority: 1 }
  ],
  validate: function () { return []; },
  coerce: function () {}
};

/* ── Serviceintervall (export-only, tillplattas från property.serviceIntervals[]) */

IMPORT_EXPORT_CONFIGS.serviceInterval = {
  label: 'Serviceintervall', labelSingular: 'Serviceintervall',
  stateKey: null,
  importDisabled: true,    /* nästlat i property.serviceIntervals[], import planeras */
  targetPage: 'pg-objects',
  sensitiveFields: [],
  fields: [
    { value: 'propertyId',          label: 'Fastighets-ID'     },
    { value: 'propertyName',        label: 'Fastighetsnamn'    },
    { value: 'id',                  label: 'Intervall-ID'      },
    { value: 'title',               label: 'Titel'             },
    { value: 'category',            label: 'Kategori'          },
    { value: 'lastDone',            label: 'Senast utfört'     },
    { value: 'intervalType',        label: 'Intervalltyp'      },
    { value: 'intervalDays',        label: 'Intervall (dagar)' },
    { value: 'nextDue',             label: 'Nästa förfall'     },
    { value: 'responsibleStaffId',  label: 'Ansvarig personal' },
    { value: 'supplier',            label: 'Leverantör'        },
    { value: 'autoCreateAO',        label: 'Skapa AO auto'     }
  ],
  exportFn: function () {
    var headers = ['Fastighets-ID','Fastighetsnamn','Intervall-ID','Titel','Kategori','Senast utfört','Intervalltyp','Intervall (dagar)','Nästa förfall','Ansvarig personal','Leverantör','Skapa AO auto'];
    var rows = [];
    (typeof state !== 'undefined' ? state.properties || [] : []).forEach(function (prop) {
      (prop.serviceIntervals || []).forEach(function (si) {
        rows.push([prop.id, prop.name || '', si.id || '', si.title || '', si.category || '', si.lastDone || '', si.intervalType || '', si.intervalDays != null ? si.intervalDays : '', si.nextDue || '', si.responsibleStaffId || '', si.supplier || '', si.autoCreateAO ? 'Ja' : 'Nej']);
      });
    });
    return { headers: headers, rows: rows };
  }
};

/* ── Rapporter (exportOnly, aggregerad statistik) ─────────────────────────── */
IMPORT_EXPORT_CONFIGS.report = {
  label: 'Rapporter', labelSingular: 'Rapport',
  stateKey: null,
  importable: false,
  fields: [],
  exportFn: function (opts) {
    /* Läs aktiv period och flik satta av ReportsPage._exportAll() */
    var cfg      = IMPORT_EXPORT_CONFIGS.report;
    var range    = cfg._currentRange || { from: '', to: '', label: 'alla' };
    var activeTab = cfg._currentTab  || 'alla';

    var sheets = [];
    var ao    = (typeof state !== 'undefined' ? state.workOrders  || [] : []).filter(function(a){ return !a.deleted && !a.archived; });
    var te    = (typeof state !== 'undefined' ? state.timeEntries || [] : []);
    var avv   = (typeof state !== 'undefined' ? state.avvikelser  || [] : []);
    var invs  = (typeof state !== 'undefined' ? state.invoices    || [] : []);
    var cus   = (typeof state !== 'undefined' ? state.customers   || [] : []);
    var props = (typeof state !== 'undefined' ? state.properties  || [] : []);
    var staff = (typeof state !== 'undefined' ? state.staff       || [] : []);

    function inPeriod(d) {
      if (!range.from || !d) return true; /* om period ej satt, ta med allt */
      var ds = d.slice(0, 10);
      return ds >= range.from && ds <= range.to;
    }
    function cuName(id) { var c = cus.find(function(x){return x.id===id;}); return c ? (c.name||c.id) : id||''; }
    function propName(id) { var p = props.find(function(x){return x.id===id;}); return p ? (p.name||p.address||p.id) : id||''; }
    function staffName(id) { var s = staff.find(function(x){return x.id===id;}); return s ? ((s.firstName||'')+' '+(s.lastName||'')).trim() : id||''; }

    /* Filtrera per register med korrekt datumfält:
       AO       → scheduledDate (utförandedatum) eller createdAt
       Tid      → date / startDate (utförandedatum)
       Faktura  → invoiceDate (fakturadatum)
       Avvikelse → date / createdAt (rapportdatum)
       Serviceintervall → nextDate (förfallodatum) */
    var aoInPeriod   = ao.filter(function(a){ return inPeriod(a.scheduledDate || a.createdAt || a.date); });
    var teInPeriod   = te.filter(function(e){ return inPeriod(e.date || e.startDate); });
    var invInPeriod  = invs.filter(function(i){ return inPeriod(i.invoiceDate || i.date) && i.status !== 'makulerad'; });
    var avvInPeriod  = avv.filter(function(a){ return inPeriod(a.date || a.createdAt); });

    /* Periodrad som första rad i alla sheets */
    var periodInfo = 'Period: ' + range.label + ' (' + (range.from || '–') + ' – ' + (range.to || '–') + ')';

    /* ── Sheet 1: AO per status (period) */
    var statusCount = {};
    aoInPeriod.forEach(function(a){ statusCount[a.status] = (statusCount[a.status]||0) + 1; });
    sheets.push({ name: 'AO per status', headers: ['Status','Antal','Period'], rows:
      [[periodInfo, '', '']].concat(Object.keys(statusCount).map(function(k){ return [k, statusCount[k], range.label]; })) });

    /* ── Sheet 2: AO per kund (period, topp 30) */
    var cuCount = {};
    aoInPeriod.forEach(function(a){ if(a.customerId){ cuCount[a.customerId]=(cuCount[a.customerId]||0)+1; } });
    sheets.push({ name: 'AO per kund', headers: ['Kund','Antal AO','Period'], rows:
      [[periodInfo,'','']].concat(Object.keys(cuCount).sort(function(a,b){return cuCount[b]-cuCount[a];}).slice(0,30)
        .map(function(id){ return [cuName(id), cuCount[id], range.label]; })) });

    /* ── Sheet 3: AO per fastighet (period, topp 30) */
    var propCount = {};
    aoInPeriod.forEach(function(a){ if(a.propertyId){ propCount[a.propertyId]=(propCount[a.propertyId]||0)+1; } });
    sheets.push({ name: 'AO per fastighet', headers: ['Fastighet','Antal AO','Period'], rows:
      [[periodInfo,'','']].concat(Object.keys(propCount).sort(function(a,b){return propCount[b]-propCount[a];}).slice(0,30)
        .map(function(id){ return [propName(id), propCount[id], range.label]; })) });

    /* ── Sheet 4: Tid per personal (period, tim via duration-fält) */
    var staffHours = {};
    teInPeriod.forEach(function(t){
      if(t.staffId){
        var h = parseFloat(t.duration) || (t.minutes ? t.minutes/60 : 0);
        staffHours[t.staffId] = (staffHours[t.staffId]||0) + h;
      }
    });
    sheets.push({ name: 'Tid per personal', headers: ['Personal','Timmar','Period'], rows:
      [[periodInfo,'','']].concat(Object.keys(staffHours).sort(function(a,b){return staffHours[b]-staffHours[a];})
        .map(function(id){ return [staffName(id), Math.round(staffHours[id]*10)/10, range.label]; })) });

    /* ── Sheet 5: Ekonomi — fakturerat (period) */
    var cuRev = {};
    invInPeriod.forEach(function(i){ if(i.customerId){ cuRev[i.customerId]=(cuRev[i.customerId]||0)+(parseFloat(i.amount)||0); } });
    var totalFak = invInPeriod.reduce(function(s,i){ return s+(parseFloat(i.amount)||0); }, 0);
    sheets.push({ name: 'Fakturerat per kund', headers: ['Kund','Fakturerat (kr)','Period'], rows:
      [[periodInfo, totalFak.toFixed(2), ''], ['Kund (topp 30)','Belopp',range.label]].concat(
        Object.keys(cuRev).sort(function(a,b){return cuRev[b]-cuRev[a];}).slice(0,30)
          .map(function(id){ return [cuName(id), cuRev[id].toFixed(2), range.label]; })) });

    /* ── Sheet 6: Avvikelser per fastighet (period) */
    var avvProp = {};
    avvInPeriod.forEach(function(a){ if(a.propertyId){ avvProp[a.propertyId]=(avvProp[a.propertyId]||0)+1; } });
    sheets.push({ name: 'Avvikelser per fastighet', headers: ['Fastighet','Antal avvikelser','Period'], rows:
      [[periodInfo,'','']].concat(Object.keys(avvProp).sort(function(a,b){return avvProp[b]-avvProp[a];})
        .map(function(id){ return [propName(id), avvProp[id], range.label]; })) });

    /* ── Sheet 7: Avvikelser per feltyp (period) */
    var avvType = {};
    avvInPeriod.forEach(function(a){ var t=a.issueType||a.type||'okänd'; avvType[t]=(avvType[t]||0)+1; });
    sheets.push({ name: 'Avvikelser per feltyp', headers: ['Feltyp','Antal','Period'], rows:
      [[periodInfo,'','']].concat(Object.keys(avvType).sort(function(a,b){return avvType[b]-avvType[a];})
        .map(function(t){ return [t, avvType[t], range.label]; })) });

    /* Filnamn: VIFT_rapport_{flik}_{from}_{to}.xlsx */
    var tabSlug  = activeTab.replace(/[^a-zåäö0-9]+/gi, '-');
    var fromSlug = range.from || new Date().toISOString().slice(0, 10);
    var toSlug   = range.to   || fromSlug;
    var filename = 'VIFT_rapport_' + tabSlug + '_' + fromSlug + '_' + toSlug + '.xlsx';

    return { headers: ['Rapport'], rows: [['Se flikar i XLSX']], _sheets: sheets, _filename: filename };
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
 * Utökning av ImportExportService med generiska metoder
 * ═══════════════════════════════════════════════════════════════════════════ */

Object.assign(ImportExportService, {

  CONFIGS: IMPORT_EXPORT_CONFIGS,

  /* ── Capabilities ─────────────────────────────────────────────────────── */

  checkCapabilities: function () {
    var caps = { xlsxRead: true, xlsxWrite: true, csv: true, objectUrl: true, errors: [] };
    if (typeof FileReader === 'undefined')          { caps.xlsxRead = false; caps.csv = false; caps.errors.push('FileReader stöds inte'); }
    if (typeof TextEncoder === 'undefined')         { caps.xlsxWrite = false; caps.csv = false; caps.errors.push('TextEncoder stöds inte'); }
    if (typeof DOMParser === 'undefined')           { caps.xlsxRead = false; caps.errors.push('DOMParser stöds inte'); }
    if (typeof DecompressionStream === 'undefined') { caps.xlsxRead = false; caps.errors.push('DecompressionStream stöds inte (XLSX-import ej tillgänglig)'); }
    if (typeof URL === 'undefined' || !URL.createObjectURL) { caps.objectUrl = false; caps.errors.push('URL.createObjectURL stöds inte'); }
    return caps;
  },

  /* ── Config-åtkomst ───────────────────────────────────────────────────── */

  getConfig: function (entityType) {
    return IMPORT_EXPORT_CONFIGS[entityType] || null;
  },

  getFieldsForType: function (entityType) {
    var cfg = IMPORT_EXPORT_CONFIGS[entityType];
    return cfg ? cfg.fields : [];
  },

  /* ── Auto-matchning ───────────────────────────────────────────────────── */

  autoMatchColumns: function (headers, entityType) {
    var cfg = IMPORT_EXPORT_CONFIGS[entityType];
    var aliases = cfg ? (cfg.aliases || {}) : {};
    var result = {};

    headers.forEach(function (h) {
      var lower = h.toLowerCase().trim();
      var matched = null;

      if (aliases[lower]) matched = lower;

      if (!matched) {
        Object.keys(aliases).forEach(function (field) {
          if (matched) return;
          if (aliases[field].indexOf(lower) !== -1) matched = field;
        });
      }

      if (!matched && entityType === 'customer' && ImportExportService.BOKIO_PROFILE.mappings[h]) {
        matched = ImportExportService.BOKIO_PROFILE.mappings[h];
      }

      result[h] = matched;
    });

    return result;
  },

  /* ── Relationsmotor ───────────────────────────────────────────────────── */

  /**
   * Löser alla relationsfält för en mappad rad.
   * Varje relation söker ENBART i sitt eget register (lookupIn).
   *
   * Returnerar:
   *   {
   *     resolved: {},        — mappade fält + lösta interna IDs
   *     errors: [],          — obligatoriska relationer som inte löstes
   *     relationsLog: [{     — detaljerad matchningsinfo per relation
   *       targetField, label, refValue, lookupIn,
   *       quality: 'exact' | 'ambiguous' | 'unresolved',
   *       matchedField,      — t.ex. 'propertyDesignation'
   *       matchedId,         — internt ID vid exact/ambiguous
   *       candidates: []     — alla träffar vid ambiguous
   *     }]
   *   }
   */
  resolveRelationsForRow: function (mapped, entityType) {
    var cfg = IMPORT_EXPORT_CONFIGS[entityType];
    if (!cfg || !cfg.relations || cfg.relations.length === 0) {
      return { resolved: Object.assign({}, mapped), errors: [], relationsLog: [] };
    }

    var resolved     = Object.assign({}, mapped);
    var errors       = [];
    var relationsLog = [];

    cfg.relations.forEach(function (rel) {
      var refValue = null;
      (rel.refFields || []).forEach(function (rf) {
        if (!refValue && resolved[rf]) refValue = String(resolved[rf]).trim();
      });

      /* Rensa referensfält — ska inte sparas på entiteten */
      (rel.refFields || []).forEach(function (rf) { delete resolved[rf]; });

      var logEntry = {
        targetField:  rel.targetField,
        label:        rel.label || rel.targetField,
        refValue:     refValue,
        lookupIn:     rel.lookupIn,
        quality:      'unresolved',
        matchedField: null,
        matchedId:    null,
        candidates:   []
      };

      if (!refValue) {
        if (rel.required) {
          errors.push('"' + (rel.label || rel.targetField) + '"-referens saknas (krävs) — sökt i ' + rel.lookupIn);
        }
        relationsLog.push(logEntry);
        return;
      }

      /* Sök ENBART i state[rel.lookupIn] — aldrig i annat register */
      var arr = (typeof state !== 'undefined' ? state[rel.lookupIn] : null) || [];
      var allCandidates = [];

      (rel.matchSets || []).forEach(function (fieldSet) {
        for (var i = 0; i < arr.length; i++) {
          var item = arr[i];
          var matched = false;
          var matchedField = null;

          if (fieldSet.length === 1) {
            var iv = String(item[fieldSet[0]] || '').toLowerCase();
            if (iv && iv === refValue.toLowerCase()) {
              matched = true;
              matchedField = fieldSet[0];
            }
          } else {
            /* Sammansatt matchning: ref = "val1 val2", fält sammanfogas med mellanslag */
            var combined = fieldSet.map(function (f) { return String(item[f] || ''); }).join(' ').toLowerCase();
            if (combined.trim() && combined.trim() === refValue.toLowerCase()) {
              matched = true;
              matchedField = fieldSet.join('+');
            }
          }

          if (matched) {
            var alreadyAdded = allCandidates.some(function (c) { return c.id === item.id; });
            if (!alreadyAdded) allCandidates.push({ id: item.id, matchedField: matchedField, item: item });
          }
        }
      });

      if (allCandidates.length === 1) {
        /* Exakt en träff */
        resolved[rel.targetField] = allCandidates[0].id;
        logEntry.quality      = 'exact';
        logEntry.matchedField = allCandidates[0].matchedField;
        logEntry.matchedId    = allCandidates[0].id;
        logEntry.candidates   = allCandidates;

      } else if (allCandidates.length > 1) {
        /* Flera träffar — kräver manuellt val, löses aldrig automatiskt */
        logEntry.quality      = 'ambiguous';
        logEntry.matchedField = null;
        logEntry.matchedId    = null;
        logEntry.candidates   = allCandidates;
        logEntry.required     = !!rel.required;
        /* resolved[rel.targetField] lämnas tomt — ImportWizardPage._relChoices löser det */

      } else {
        /* Ingen träff */
        if (rel.required) {
          errors.push('"' + refValue + '" hittades inte i ' + rel.lookupIn + ' (sökte i ' + (rel.matchSets || []).map(function (s) { return s.join('+'); }).join(', ') + ')');
        }
      }

      relationsLog.push(logEntry);
    });

    return { resolved: resolved, errors: errors, relationsLog: relationsLog };
  },

  /* ── Generisk radvalidering ───────────────────────────────────────────── */

  validateImportRowsForType: function (parsedData, mapping, entityType) {
    var cfg = IMPORT_EXPORT_CONFIGS[entityType];
    if (!cfg) return [];

    var headers = parsedData.headers;
    var rows    = parsedData.rows;
    var results = [];

    function mapRow(row) {
      var obj = {};
      headers.forEach(function (h, ci) {
        var field = mapping[h];
        if (field) obj[field] = (row[ci] == null ? '' : String(row[ci])).trim();
      });
      return obj;
    }

    function findDuplicate(mapped, resolvedRelations) {
      var arr    = (typeof state !== 'undefined' ? state[cfg.stateKey] : null) || [];
      var strats = cfg.duplicateStrategies || [];

      for (var s = 0; s < strats.length; s++) {
        var strat  = strats[s];
        var fields = strat.fields ? strat.fields : [strat.field];
        var allM   = Object.assign({}, mapped, resolvedRelations || {});
        var refV   = fields.map(function (f) {
          return strat.caseInsensitive ? (allM[f] || '').toLowerCase() : (allM[f] || '');
        });
        if (refV.some(function (v) { return !v; })) continue;

        for (var i = 0; i < arr.length; i++) {
          var item   = arr[i];
          var itemV  = fields.map(function (f) {
            return strat.caseInsensitive ? (item[f] || '').toLowerCase() : (item[f] || '');
          });
          if (itemV.every(function (v) { return !!v; }) &&
              refV.every(function (v, j) { return v === itemV[j]; })) {
            return { match: strat.label, item: item };
          }
        }
      }
      return null;
    }

    rows.forEach(function (row, ri) {
      var mapped = mapRow(row);
      /* CUSTOMER IMPORT R2 §8/§19/§20: valfri, EXPLICIT per-config
         förberedelsehook — körs INNAN relationsupplösning/validering, så att
         förhandsgranskning, dubblettdetektering OCH den faktiska importerade
         posten (via resolveRelationsForRow()s passthrough för register utan
         relations[]) alla ser EXAKT samma, förberedda data. Register utan
         `prepareImportRow` (properties/articles/staff/…) är helt opåverkade
         — `mapped` förblir precis mapRow()s råa utdata för dem, som innan. */
      if (cfg.prepareImportRow) mapped = cfg.prepareImportRow(mapped) || mapped;

      var relResult = ImportExportService.resolveRelationsForRow(mapped, entityType);
      var errors    = cfg.validate ? cfg.validate(mapped) : [];
      errors        = errors.concat(relResult.errors);
      var dup       = errors.length ? null : findDuplicate(mapped, relResult.resolved);
      var status    = errors.length ? 'error' : (dup ? 'duplicate' : 'new');

      var ambigLogs   = relResult.relationsLog.filter(function (l) { return l.quality === 'ambiguous'; });
      var relWarnings = ambigLogs.map(function (l) {
        return 'Relation "' + l.label + '": ' + l.candidates.length + ' träffar i ' + l.lookupIn + ' — välj manuellt';
      });
      /* CUSTOMER IMPORT R2 §17: valfri per-config warn-only-hook (WARN,
         aldrig BLOCK) — kombineras med de redan existerande
         relations-varningarna. Register utan `cfg.warnings` (alla utom
         customer idag) är helt opåverkade. */
      var cfgWarnings = cfg.warnings ? cfg.warnings(mapped) : [];

      results.push({
        rowIndex:             ri + 2,
        row:                  row,
        mapped:               mapped,
        resolved:             relResult.resolved,
        relationsLog:         relResult.relationsLog,
        status:               status,
        duplicate:            dup,
        errors:               errors,
        needsRelation:        ambigLogs.length > 0,
        hasRequiredAmbiguous: ambigLogs.some(function (l) { return l.required; }),
        warnings:             relWarnings.concat(cfgWarnings)
      });
    });

    return results;
  },

  /* ── Export ───────────────────────────────────────────────────────────── */

  buildExportRowsForType: function (entityType, records, opts) {
    opts = opts || {};
    var cfg = IMPORT_EXPORT_CONFIGS[entityType];
    if (!cfg) return { headers: [], rows: [] };

    /* Nästlade register med exportFn() hanteras separat */
    if (cfg.exportFn && !records) {
      return cfg.exportFn(opts);
    }

    var sensitiveSet = {};
    (cfg.sensitiveFields || []).forEach(function (f) { sensitiveSet[f] = true; });

    var cols = (cfg.fields || []).filter(function (f) {
      if (f.value.charAt(0) === '_') return false;
      if (!opts.includeSensitive && sensitiveSet[f.value]) return false;
      return true;
    });

    var headers = cols.map(function (f) { return f.label.replace(' *', ''); });
    var rows = (records || []).map(function (rec) {
      return cols.map(function (col) {
        var v = rec[col.value];
        if (v == null) return '';
        if (Array.isArray(v)) return v.length ? v.length + ' poster' : '';
        if (col.type === 'float' || col.type === 'int') return v;
        return String(v);
      });
    });

    return { headers: headers, rows: rows };
  },

  /**
   * Generisk export-meny (inline dropdown).
   * entityType: konfigurationsnyckel
   * btn:        det klickade knapp-elementet (för positionering)
   * records:    poster att exportera (null = alla i state)
   * label:      optional etikett (t.ex. "filtrerade", "markerade")
   */
  showExportMenu: function (entityType, btn, records, label) {
    var cfg = IMPORT_EXPORT_CONFIGS[entityType];
    if (!cfg) return;

    var ts    = new Date().toISOString().slice(0, 10);
    var base  = cfg.label.toLowerCase().replace(/[^a-zåäö0-9]+/gi, '-');
    var tag   = label ? '-' + label : '';
    /* För nästlade register (exportFn): records=null, data byggs av exportFn */
    var recs  = cfg.exportFn && !records ? null : (records || (typeof state !== 'undefined' ? (state[cfg.stateKey] || []) : []));

    var items = [
      {
        icon: 'file-text',
        label: 'Exportera CSV' + (label ? ' (' + label + ')' : ''),
        fn: function () {
          var d = ImportExportService.buildExportRowsForType(entityType, recs);
          ImportExportService.downloadCSV(base + tag + '-' + ts + '.csv', d.headers, d.rows);
          if (typeof showToast !== 'undefined') showToast('Exporterar ' + d.rows.length + ' poster som CSV…');
        }
      },
      {
        icon: 'grid',
        label: 'Exportera XLSX' + (label ? ' (' + label + ')' : ''),
        fn: function () {
          var d = ImportExportService.buildExportRowsForType(entityType, recs);
          var sheets = d._sheets || [{ name: cfg.label, headers: d.headers, rows: d.rows }];
          var xlsxFilename = d._filename || (base + tag + '-' + ts + '.xlsx');
          ImportExportService.downloadXLSX(xlsxFilename, sheets);
          var total = sheets.reduce(function(s,sh){ return s + sh.rows.length; }, 0);
          if (typeof showToast !== 'undefined') showToast('Exporterar rapport som XLSX (' + sheets.length + ' flikar)…');
        }
      },
      {
        icon: 'settings',
        label: 'Avancerat exportcenter…',
        fn: function () {
          /* V30 §3: origin-aware "Tillbaka"-navigation i Exportcenter.
             Router.currentPage är redan den enda källan till "var är
             användaren nu" — inga nya router-mekanismer, bara vidarebefordra
             det till ExportCenterPage via params. */
          if (typeof Router === 'undefined') return;
          var opts = { type: entityType };
          if (Router.currentPage && Router.currentPage !== 'pg-export-center') {
            opts.sourcePage = Router.currentPage;
            opts.sourceLabel = (Router.PAGE_TITLES && Router.PAGE_TITLES[Router.currentPage] || {}).title || '';
          }
          Router.showPage('pg-export-center', opts);
        }
      }
    ];

    /* Rita dropdown */
    var existing = document.getElementById('_imp-exp-menu');
    if (existing) existing.remove();

    var menu = document.createElement('div');
    menu.id = '_imp-exp-menu';
    menu.style.cssText = 'position:fixed;z-index:9999;background:var(--card);border:1px solid var(--border);border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.16);padding:4px;min-width:220px;';

    items.forEach(function (item) {
      var row = document.createElement('button');
      row.type = 'button';
      row.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;padding:9px 12px;background:none;border:none;border-radius:7px;font-size:13px;color:var(--text);cursor:pointer;text-align:left;';
      row.innerHTML = (typeof ic !== 'undefined' ? ic(item.icon, 14) : '') + ' ' + item.label;
      row.onmouseover = function () { this.style.background = 'var(--bg)'; };
      row.onmouseout  = function () { this.style.background = 'none'; };
      row.onclick = function () { menu.remove(); item.fn(); };
      menu.appendChild(row);
    });

    document.body.appendChild(menu);

    /* Positionera under knappen — men öppna UPPÅT istället om menyn annars
       skulle hamna utanför viewporten nedåt (t.ex. när knappen sitter i den
       fasta BulkActionBar:en längst ner). SPRINT1 §8/§21: menyn får aldrig
       rendera utanför synligt fönster. */
    var rect      = btn.getBoundingClientRect();
    var mw        = 220;
    var menuH     = menu.offsetHeight || (items.length * 38 + 8);
    var left      = Math.min(Math.max(8, rect.left), window.innerWidth - mw - 8);
    var fitsBelow = (rect.bottom + 4 + menuH) <= window.innerHeight;
    menu.style.left = left + 'px';
    if (fitsBelow) {
      menu.style.top = (rect.bottom + 4) + 'px';
    } else {
      menu.style.top = Math.max(8, rect.top - menuH - 4) + 'px';
    }

    /* Stäng vid klick utanför eller Escape */
    function _close(e) {
      if (e && e.type === 'keydown' && e.key !== 'Escape') return;
      if (e && e.type === 'click' && menu.contains(e.target)) return;
      menu.remove();
      document.removeEventListener('click', _close, true);
      document.removeEventListener('keydown', _close, true);
    }
    setTimeout(function () {
      document.addEventListener('click', _close, true);
      document.addEventListener('keydown', _close, true);
    }, 10);
  }

});
