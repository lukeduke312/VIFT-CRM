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
  fields: [
    { value: 'name',           label: 'Namn *',                    required: true },
    { value: 'type',           label: 'Typ (privat/foretag/brf)'                  },
    { value: 'orgNr',          label: 'Organisationsnummer'                        },
    { value: 'personnr',       label: 'Personnummer'                               },
    { value: 'firstName',      label: 'Förnamn'                                    },
    { value: 'lastName',       label: 'Efternamn'                                  },
    { value: 'contactPerson',  label: 'Kontaktperson'                              },
    { value: 'phone',          label: 'Telefon'                                    },
    { value: 'email',          label: 'E-post'                                     },
    { value: 'address',        label: 'Adress'                                     },
    { value: 'zip',            label: 'Postnummer'                                 },
    { value: 'city',           label: 'Ort'                                        },
    { value: 'invoiceAddress', label: 'Fakturaadress'                              },
    { value: 'invoiceZip',     label: 'Faktura postnummer'                         },
    { value: 'invoiceCity',    label: 'Faktura ort'                                },
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
  validate: function (mapped) {
    var e = [];
    if (!mapped.name) e.push('Namn saknas');
    return e;
  },
  coerce: function (obj) {
    if (obj.paymentTerms !== undefined && obj.paymentTerms !== '') {
      var n = parseInt(obj.paymentTerms, 10); obj.paymentTerms = isNaN(n) ? 30 : n;
    }
    if (typeof obj.active === 'string') obj.active = obj.active.toLowerCase() !== 'nej' && obj.active !== '0' && obj.active !== 'false';
    var tm = { privatperson: 'privat', företag: 'foretag', bostadsrättsförening: 'brf' };
    if (obj.type && tm[obj.type.toLowerCase()]) obj.type = tm[obj.type.toLowerCase()];
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
        /* Flera träffar — ambiguöst, välj den första men markera */
        resolved[rel.targetField] = allCandidates[0].id;
        logEntry.quality      = 'ambiguous';
        logEntry.matchedField = allCandidates[0].matchedField;
        logEntry.matchedId    = allCandidates[0].id;
        logEntry.candidates   = allCandidates;
        if (rel.required) {
          errors.push('"' + refValue + '" matchar ' + allCandidates.length + ' poster i ' + rel.lookupIn + ' — välj manuellt (tog första: ' + allCandidates[0].id + ')');
        }

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
      var mapped    = mapRow(row);
      var relResult = ImportExportService.resolveRelationsForRow(mapped, entityType);
      var errors    = cfg.validate ? cfg.validate(mapped) : [];
      errors        = errors.concat(relResult.errors);
      var dup       = errors.length ? null : findDuplicate(mapped, relResult.resolved);
      var status    = errors.length ? 'error' : (dup ? 'duplicate' : 'new');

      results.push({
        rowIndex:     ri + 2,
        row:          row,
        mapped:       mapped,
        resolved:     relResult.resolved,
        relationsLog: relResult.relationsLog,
        status:       status,
        duplicate:    dup,
        errors:       errors,
        warnings:     relResult.relationsLog.filter(function (l) { return l.quality === 'ambiguous'; }).map(function (l) {
          return 'Relation "' + l.label + '": ambiguös matchning — ' + l.candidates.length + ' träffar i ' + l.lookupIn;
        })
      });
    });

    return results;
  },

  /* ── Export ───────────────────────────────────────────────────────────── */

  buildExportRowsForType: function (entityType, records, opts) {
    opts = opts || {};
    var cfg = IMPORT_EXPORT_CONFIGS[entityType];
    if (!cfg) return { headers: [], rows: [] };

    var sensitiveSet = {};
    (cfg.sensitiveFields || []).forEach(function (f) { sensitiveSet[f] = true; });

    var cols = (cfg.fields || []).filter(function (f) {
      if (f.value.charAt(0) === '_') return false;
      if (!opts.includeSensitive && sensitiveSet[f.value]) return false;
      return true;
    });

    var headers = cols.map(function (f) { return f.label.replace(' *', ''); });
    var rows = records.map(function (rec) {
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
    var recs  = records || (typeof state !== 'undefined' ? (state[cfg.stateKey] || []) : []);

    var items = [
      {
        icon: 'file-text',
        label: 'Exportera CSV' + (label ? ' (' + label + ')' : ''),
        fn: function () {
          var d = ImportExportService.buildExportRowsForType(entityType, recs);
          ImportExportService.downloadCSV(base + tag + '-' + ts + '.csv', d.headers, d.rows);
          if (typeof showToast !== 'undefined') showToast('Exporterar ' + recs.length + ' poster som CSV…');
        }
      },
      {
        icon: 'table',
        label: 'Exportera XLSX' + (label ? ' (' + label + ')' : ''),
        fn: function () {
          var d = ImportExportService.buildExportRowsForType(entityType, recs);
          ImportExportService.downloadXLSX(base + tag + '-' + ts + '.xlsx', [{ name: cfg.label, headers: d.headers, rows: d.rows }]);
          if (typeof showToast !== 'undefined') showToast('Exporterar ' + recs.length + ' poster som XLSX…');
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

    /* Positionera under knappen */
    var rect = btn.getBoundingClientRect();
    var mw   = 220;
    var left = Math.min(rect.left, window.innerWidth - mw - 8);
    menu.style.top  = (rect.bottom + 4) + 'px';
    menu.style.left = left + 'px';

    /* Stäng vid klick utanför */
    function _close(e) {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', _close, true); }
    }
    setTimeout(function () { document.addEventListener('click', _close, true); }, 10);
  }

});
