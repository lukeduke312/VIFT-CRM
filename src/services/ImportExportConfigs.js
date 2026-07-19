/**
 * ImportExportConfigs.js — Registerkonfigurationer för generell import/export
 * F4-1: Registerkonfiguration och relationsmotor
 *
 * Definierar IMPORT_EXPORT_CONFIGS med poster för alla register.
 * Utökar sedan ImportExportService med generiska metoder.
 *
 * Kräver: ImportExportService (laddas dessförinnan i index.html)
 */

/* ── Konfigurationsformat ─────────────────────────────────────────────────────
 *
 * label            — registrets visningsnamn (plural)
 * labelSingular    — singular
 * stateKey         — state[stateKey] = array
 * idPrefix         — t.ex. 'KU', 'PROP', 'OBJ'
 * schemaFn()       — Schema.xxx() för nya poster
 * targetPage       — Router.showPage() vid "Gå till register"
 * sensitiveFields  — export inkluderar ALDRIG dessa som standard
 * fields[]         — { value, label, required?, type? }
 * aliases          — { fieldName: [alias,...] } för auto-matchning
 * relations[]      — relationer till andra register
 * duplicateStrategies[] — {field/fields, label, caseInsensitive?} i prioritetsordning
 * validate(mapped) → string[] — valideringsfel
 * coerce(obj)      — typmappar fält på plats
 * historicalImport — true = undertrycker automation (push, AO, billing)
 * ─────────────────────────────────────────────────────────────────────────── */

var IMPORT_EXPORT_CONFIGS = {};

/* ── Kunder ───────────────────────────────────────────────────────────────── */

IMPORT_EXPORT_CONFIGS.customer = {
  label: 'Kunder',
  labelSingular: 'Kund',
  stateKey: 'customers',
  idPrefix: 'KU',
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
    { field: 'orgNr',          label: 'Org.nr',    priority: 1 },
    { field: 'externalId',     label: 'Ext.ID',    priority: 2 },
    { field: 'customerNumber', label: 'Kundnr',    priority: 3 },
    { field: 'email',          label: 'E-post',    priority: 4, caseInsensitive: true },
    { fields: ['name', 'city'],label: 'Namn+ort',  priority: 5, caseInsensitive: true }
  ],
  validate: function (mapped) {
    var errors = [];
    if (!mapped.name) errors.push('Namn saknas');
    return errors;
  },
  coerce: function (obj) {
    if (obj.paymentTerms !== undefined && obj.paymentTerms !== '') {
      var n = parseInt(obj.paymentTerms, 10);
      obj.paymentTerms = isNaN(n) ? 30 : n;
    }
    if (typeof obj.active === 'string') {
      obj.active = obj.active.toLowerCase() !== 'nej' && obj.active !== '0' && obj.active !== 'false';
    }
    var typeMap = { privatperson: 'privat', företag: 'foretag', bostadsrättsförening: 'brf' };
    if (obj.type && typeMap[obj.type.toLowerCase()]) obj.type = typeMap[obj.type.toLowerCase()];
  }
};

/* ── Fastigheter ──────────────────────────────────────────────────────────── */

IMPORT_EXPORT_CONFIGS.property = {
  label: 'Fastigheter',
  labelSingular: 'Fastighet',
  stateKey: 'properties',
  idPrefix: 'PROP',
  schemaFn: function () { return Schema.property(); },
  targetPage: 'pg-objects',
  sensitiveFields: ['accessCode', 'keyInfo'],
  fields: [
    { value: 'name',                label: 'Namn *',                required: true },
    { value: 'propertyDesignation', label: 'Fastighetsbeteckning'               },
    { value: 'address',             label: 'Adress'                             },
    { value: 'zip',                 label: 'Postnummer'                         },
    { value: 'city',                label: 'Ort'                                },
    { value: 'objectNumber',        label: 'Objektnummer'                       },
    { value: 'type',                label: 'Fastighetstyp'                      },
    { value: 'buildYear',           label: 'Byggnadsår'                         },
    { value: 'apartments',          label: 'Antal lägenheter', type: 'int'      },
    { value: 'area',                label: 'Total yta (m²)',   type: 'float'    },
    { value: 'managementType',      label: 'Förvaltningsform'                   },
    { value: 'operationalArea',     label: 'Driftområde'                        },
    { value: 'status',              label: 'Status'                             },
    { value: 'note',                label: 'Anteckning'                         },
    { value: '_customerRef',        label: 'Kund (kundnummer/org.nr/namn)'      }
  ],
  aliases: {
    name:                ['namn', 'fastighetens namn', 'property name'],
    propertyDesignation: ['fastighetsbeteckning', 'beteckning', 'fastbet', 'designation'],
    address:             ['adress', 'gatuadress', 'street', 'address'],
    zip:                 ['postnummer', 'zip', 'postcode'],
    city:                ['ort', 'stad', 'city'],
    objectNumber:        ['objektnummer', 'obj.nr', 'fastighetsnr'],
    type:                ['fastighetstyp', 'typ', 'type'],
    buildYear:           ['byggnadsår', 'byggår', 'build year', 'built'],
    apartments:          ['lägenheter', 'antal lägenheter', 'apartments', 'bostäder'],
    area:                ['area', 'yta', 'total yta', 'bta'],
    managementType:      ['förvaltningsform', 'management'],
    note:                ['anteckning', 'kommentar', 'note', 'notes'],
    _customerRef:        ['kund', 'kundnummer', 'customer', 'org.nr', 'organisationsnummer']
  },
  relations: [
    {
      targetField: 'customerId',
      required: false,
      refFields: ['_customerRef'],
      lookupIn: 'customers',
      matchSets: [['customerNumber'], ['orgNr'], ['name']]
    }
  ],
  duplicateStrategies: [
    { field: 'propertyDesignation', label: 'Fastighetsbeteckning', priority: 1, caseInsensitive: true },
    { field: 'externalId',          label: 'Ext.ID',               priority: 2 },
    { fields: ['name', 'address'],  label: 'Namn+adress',          priority: 3, caseInsensitive: true }
  ],
  validate: function (mapped) {
    var errors = [];
    if (!mapped.name) errors.push('Namn saknas');
    return errors;
  },
  coerce: function (obj) {
    if (obj.apartments !== undefined) {
      var n = parseInt(obj.apartments, 10);
      obj.apartments = isNaN(n) ? 0 : n;
    }
    if (obj.area !== undefined) {
      var f = parseFloat(obj.area);
      obj.area = isNaN(f) ? 0 : f;
    }
    if (obj.buildYear !== undefined && obj.buildYear !== '') {
      obj.buildYear = String(parseInt(obj.buildYear, 10) || obj.buildYear);
    }
  }
};

/* ── Objekt (lägenheter/lokaler) ─────────────────────────────────────────── */

IMPORT_EXPORT_CONFIGS.propertyObject = {
  label: 'Objekt (lägenheter/lokaler)',
  labelSingular: 'Objekt',
  stateKey: 'propertyObjects',
  idPrefix: 'OBJ',
  schemaFn: function () { return Schema.propertyObject(); },
  targetPage: 'pg-objects',
  sensitiveFields: ['doorCode', 'keyInformation'],
  fields: [
    { value: 'name',         label: 'Namn *',                  required: true    },
    { value: 'objectNumber', label: 'Objektnummer'                               },
    { value: 'type',         label: 'Typ (lagenhet/lokal/etc.)'                  },
    { value: 'address',      label: 'Adress'                                     },
    { value: 'postalCode',   label: 'Postnummer'                                 },
    { value: 'city',         label: 'Ort'                                        },
    { value: 'entrance',     label: 'Port/Entré'                                 },
    { value: 'stairwell',    label: 'Trapphus'                                   },
    { value: 'floor',        label: 'Våning'                                     },
    { value: 'area',         label: 'Yta (m²)',     type: 'float'                },
    { value: 'status',       label: 'Status'                                     },
    { value: 'description',  label: 'Beskrivning'                                },
    { value: '_propertyRef', label: 'Fastighet (beteckning/namn) *', required: true },
    { value: '_customerRef', label: 'Kund (kundnummer/org.nr)'                   }
  ],
  aliases: {
    name:          ['namn', 'objektnamn', 'object name', 'lägenhet', 'lokal'],
    objectNumber:  ['objektnummer', 'lgh.nr', 'lägenhetsnummer', 'nr', 'object number'],
    type:          ['typ', 'objekttyp', 'type'],
    address:       ['adress', 'address'],
    postalCode:    ['postnummer', 'zip'],
    city:          ['ort', 'stad', 'city'],
    entrance:      ['port', 'entré', 'entrance'],
    stairwell:     ['trapphus', 'trappa', 'stairwell'],
    floor:         ['våning', 'plan', 'floor'],
    area:          ['yta', 'area', 'kvm', 'm2'],
    status:        ['status'],
    description:   ['beskrivning', 'kommentar', 'description'],
    _propertyRef:  ['fastighet', 'fastighetsbeteckning', 'property', 'fastbet'],
    _customerRef:  ['kund', 'kundnummer', 'org.nr', 'customer']
  },
  relations: [
    {
      targetField: 'propertyId',
      required: true,
      refFields: ['_propertyRef'],
      lookupIn: 'properties',
      matchSets: [['propertyDesignation'], ['objectNumber'], ['name']]
    },
    {
      targetField: 'customerId',
      required: false,
      refFields: ['_customerRef'],
      lookupIn: 'customers',
      matchSets: [['customerNumber'], ['orgNr'], ['name']]
    }
  ],
  duplicateStrategies: [
    { fields: ['propertyId', 'objectNumber'], label: 'Fastighet+objektnr', priority: 1 },
    { fields: ['propertyId', 'name'],         label: 'Fastighet+namn',     priority: 2, caseInsensitive: true }
  ],
  validate: function (mapped) {
    var errors = [];
    if (!mapped.name) errors.push('Namn saknas');
    return errors;
  },
  coerce: function (obj) {
    if (obj.area !== undefined) {
      var f = parseFloat(obj.area);
      obj.area = isNaN(f) ? 0 : f;
    }
    var validTypes = ['lagenhet','lokal','butik','kontor','forrad','garage','parkering','teknik','gemensamt','byggnad','annat'];
    if (obj.type) {
      var t = obj.type.toLowerCase().replace(/å/g,'a').replace(/ä/g,'a').replace(/ö/g,'o');
      if (validTypes.indexOf(t) === -1) obj.type = 'annat';
      else obj.type = t;
    }
  }
};

/* ── Artiklar ─────────────────────────────────────────────────────────────── */

IMPORT_EXPORT_CONFIGS.article = {
  label: 'Artiklar',
  labelSingular: 'Artikel',
  stateKey: 'articles',
  idPrefix: 'ART',
  schemaFn: function () { return Schema.article(); },
  targetPage: 'pg-articles',
  sensitiveFields: [],
  fields: [
    { value: 'name',          label: 'Namn *',           required: true    },
    { value: 'articleNumber', label: 'Artikelnummer'                       },
    { value: 'category',      label: 'Kategori'                            },
    { value: 'unit',          label: 'Enhet (st/tim/m²)' },
    { value: 'buyPrice',      label: 'Inköpspris (kr)',  type: 'float'     },
    { value: 'sellPrice',     label: 'Säljpris (kr)',    type: 'float'     },
    { value: 'markup',        label: 'Pålägg (%)',       type: 'float'     },
    { value: 'vatRate',       label: 'Momssats (%)',     type: 'float'     },
    { value: 'supplier',      label: 'Leverantör'                          },
    { value: 'note',          label: 'Anteckning'                          }
  ],
  aliases: {
    name:          ['namn', 'artikel', 'benämning', 'description'],
    articleNumber: ['artikelnummer', 'art.nr', 'artnr', 'sku', 'item number'],
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
  validate: function (mapped) {
    var errors = [];
    if (!mapped.name) errors.push('Namn saknas');
    return errors;
  },
  coerce: function (obj) {
    ['buyPrice', 'sellPrice', 'markup', 'vatRate'].forEach(function (f) {
      if (obj[f] !== undefined && obj[f] !== '') {
        var n = parseFloat(String(obj[f]).replace(',', '.'));
        obj[f] = isNaN(n) ? 0 : n;
      }
    });
    if (typeof obj.active === 'string') {
      obj.active = obj.active.toLowerCase() !== 'nej' && obj.active !== '0';
    }
  }
};

/* ── Prisgrupper ──────────────────────────────────────────────────────────── */

IMPORT_EXPORT_CONFIGS.priceGroup = {
  label: 'Prisgrupper',
  labelSingular: 'Prisgrupp',
  stateKey: 'priceGroups',
  idPrefix: 'PG',
  schemaFn: function () { return Schema.priceGroup(); },
  targetPage: 'pg-pricegroups',
  sensitiveFields: [],
  fields: [
    { value: 'name',        label: 'Namn *',           required: true   },
    { value: 'hourRate',    label: 'Timtaxa (kr)',      type: 'float'    },
    { value: 'description', label: 'Beskrivning'                        }
  ],
  aliases: {
    name:        ['namn', 'prisgrupp', 'name', 'price group'],
    hourRate:    ['timtaxa', 'timpris', 'hourrate', 'rate', 'kr/tim'],
    description: ['beskrivning', 'description', 'kommentar']
  },
  relations: [],
  duplicateStrategies: [
    { field: 'name', label: 'Namn', priority: 1, caseInsensitive: true }
  ],
  validate: function (mapped) {
    var errors = [];
    if (!mapped.name) errors.push('Namn saknas');
    return errors;
  },
  coerce: function (obj) {
    if (obj.hourRate !== undefined && obj.hourRate !== '') {
      var n = parseFloat(String(obj.hourRate).replace(',', '.'));
      obj.hourRate = isNaN(n) ? 0 : n;
    }
    if (typeof obj.active === 'string') {
      obj.active = obj.active.toLowerCase() !== 'nej' && obj.active !== '0';
    }
  }
};

/* ── Personal ─────────────────────────────────────────────────────────────── */
/* OBS: Import av personal tillåter ALDRIG import av lösenord, PIN-koder,
 * autentiseringshemligheter eller tokens. Admin-rollen kräver extra bekräftelse. */

IMPORT_EXPORT_CONFIGS.staff = {
  label: 'Personal',
  labelSingular: 'Personalpost',
  stateKey: 'staff',
  idPrefix: 'PRS',
  schemaFn: function () { return Schema.staff(); },
  targetPage: 'pg-staff',
  sensitiveFields: ['passwordHash', 'password', 'permissions'],
  requiresAdminRoleConfirm: true,
  fields: [
    { value: 'firstName', label: 'Förnamn *',  required: true  },
    { value: 'lastName',  label: 'Efternamn *', required: true  },
    { value: 'email',     label: 'E-post'                      },
    { value: 'phone',     label: 'Telefon'                     },
    { value: 'title',     label: 'Titel/Befattning'            },
    { value: 'role',      label: 'Roll (personal/chef)'        }
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
    { field: 'email',                    label: 'E-post',      priority: 1, caseInsensitive: true },
    { fields: ['firstName', 'lastName'], label: 'Namn',        priority: 2, caseInsensitive: true }
  ],
  validate: function (mapped) {
    var errors = [];
    if (!mapped.firstName) errors.push('Förnamn saknas');
    if (!mapped.lastName)  errors.push('Efternamn saknas');
    if (mapped.passwordHash || mapped.password) {
      errors.push('Lösenordsfält är inte tillåtna vid import');
    }
    return errors;
  },
  coerce: function (obj) {
    // Säkra att inga lösenordsfält följer med
    delete obj.password;
    delete obj.passwordHash;
    delete obj.permissions;
    // Normalisera roll (aldrig sätt admin via import utan bekräftelse)
    if (obj.role) {
      var r = obj.role.toLowerCase();
      if (r === 'admin') obj.role = 'personal';  // nedgraderas, kräver manuell ändring
      else if (r === 'chef' || r === 'manager') obj.role = 'chef';
      else obj.role = 'personal';
    } else {
      obj.role = 'personal';
    }
    if (typeof obj.active === 'string') {
      obj.active = obj.active.toLowerCase() !== 'nej' && obj.active !== '0';
    }
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
 * Utökning av ImportExportService med generiska metoder
 * ═══════════════════════════════════════════════════════════════════════════ */

Object.assign(ImportExportService, {

  CONFIGS: IMPORT_EXPORT_CONFIGS,

  /**
   * Kontrollerar webbläsarens förmågor.
   * Returnerar { xlsxRead, xlsxWrite, csv, objectUrl, errors[] }
   */
  checkCapabilities: function () {
    var caps = { xlsxRead: true, xlsxWrite: true, csv: true, objectUrl: true, errors: [] };
    if (typeof FileReader === 'undefined')        { caps.xlsxRead = false; caps.csv = false; caps.errors.push('FileReader stöds inte'); }
    if (typeof TextEncoder === 'undefined')       { caps.xlsxWrite = false; caps.csv = false; caps.errors.push('TextEncoder stöds inte'); }
    if (typeof DOMParser === 'undefined')         { caps.xlsxRead = false; caps.errors.push('DOMParser stöds inte'); }
    if (typeof DecompressionStream === 'undefined') { caps.xlsxRead = false; caps.errors.push('DecompressionStream stöds inte (XLSX-import otillgänglig)'); }
    if (typeof URL === 'undefined' || !URL.createObjectURL) { caps.objectUrl = false; caps.errors.push('URL.createObjectURL stöds inte'); }
    return caps;
  },

  /**
   * Hämtar registerkonfiguration.
   */
  getConfig: function (entityType) {
    return IMPORT_EXPORT_CONFIGS[entityType] || null;
  },

  /**
   * Hämtar fältlista för steg 3 (kolumnmatchningsdropdown).
   */
  getFieldsForType: function (entityType) {
    var cfg = IMPORT_EXPORT_CONFIGS[entityType];
    return cfg ? cfg.fields : [];
  },

  /**
   * Konfigurationsstyrd auto-matchning (ersätter den gamla customer-only versionen).
   */
  autoMatchColumns: function (headers, entityType) {
    var cfg = IMPORT_EXPORT_CONFIGS[entityType];
    var aliases = cfg ? (cfg.aliases || {}) : {};
    var result = {};

    headers.forEach(function (h) {
      var lower = h.toLowerCase().trim();
      var matched = null;

      // Exakt match mot fältnamn
      if (aliases[lower]) { matched = lower; }

      // Match mot alias-listor
      if (!matched) {
        Object.keys(aliases).forEach(function (field) {
          if (matched) return;
          if (aliases[field].indexOf(lower) !== -1) matched = field;
        });
      }

      // Bakåtkompatibilitet: Bokio-profil för kunder
      if (!matched && entityType === 'customer' && ImportExportService.BOKIO_PROFILE.mappings[h]) {
        matched = ImportExportService.BOKIO_PROFILE.mappings[h];
      }

      result[h] = matched;
    });

    return result;
  },

  /**
   * Löser relationsfält i en mappad rad.
   * mapped: { fieldName: value, _propertyRef: '...', ... }
   * entityType: konfigurationsnyckeln
   * Returnerar { resolved: {}, errors: [] }
   * resolved innehåller alla mappade fält + interna ID:n (propertyId, customerId etc.)
   */
  resolveRelationsForRow: function (mapped, entityType) {
    var cfg = IMPORT_EXPORT_CONFIGS[entityType];
    if (!cfg || !cfg.relations || cfg.relations.length === 0) {
      return { resolved: Object.assign({}, mapped), errors: [] };
    }

    var resolved = Object.assign({}, mapped);
    var errors = [];

    cfg.relations.forEach(function (rel) {
      // Hitta referensvärdet från något av refFields
      var refValue = null;
      (rel.refFields || []).forEach(function (rf) {
        if (!refValue && resolved[rf]) refValue = String(resolved[rf]).trim();
      });

      // Ta bort referensfältet ur det upplösta objektet (ska inte sparas)
      (rel.refFields || []).forEach(function (rf) { delete resolved[rf]; });

      if (!refValue) {
        if (rel.required) errors.push('Referens till ' + rel.lookupIn + ' saknas (krävs)');
        return;
      }

      var arr = (typeof state !== 'undefined' ? state[rel.lookupIn] : null) || [];
      var match = null;

      (rel.matchSets || []).forEach(function (fieldSet) {
        if (match) return;
        for (var i = 0; i < arr.length; i++) {
          var item = arr[i];
          // Enkelt fält: jämför mot refValue
          if (fieldSet.length === 1) {
            var iv = String(item[fieldSet[0]] || '').toLowerCase();
            if (iv && iv === refValue.toLowerCase()) { match = item; break; }
          } else {
            // Sammansatt: ref är "val1 val2" — matchar mot fält[0]+' '+fält[1]
            var combined = fieldSet.map(function (f) { return String(item[f] || ''); }).join(' ').toLowerCase();
            if (combined && combined === refValue.toLowerCase()) { match = item; break; }
          }
        }
      });

      if (match) {
        resolved[rel.targetField] = match.id;
      } else if (rel.required) {
        errors.push('Hittade inte "' + refValue + '" i ' + rel.lookupIn);
      }
    });

    return { resolved: resolved, errors: errors };
  },

  /**
   * Generisk ravalidering med dublettdetektering.
   * parsedData: { headers, rows }
   * mapping:    { header → fieldName | null }
   * entityType: konfigurationsnyckel
   * Returnerar array av:
   *   { rowIndex, row, mapped, resolved, status, duplicate, errors, warnings }
   *   status: 'new' | 'duplicate' | 'error'
   *   duplicate: { match: label, item: existingObject } | null
   */
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
      var arr = (typeof state !== 'undefined' ? state[cfg.stateKey] : null) || [];
      var strats = cfg.duplicateStrategies || [];

      for (var s = 0; s < strats.length; s++) {
        var strat = strats[s];
        var fields = strat.fields ? strat.fields : [strat.field];

        // Hämta värden från mapped + resolvedRelations (för propertyId etc.)
        var allMapped = Object.assign({}, mapped, resolvedRelations || {});
        var refVals = fields.map(function (f) {
          return strat.caseInsensitive ? (allMapped[f] || '').toLowerCase() : (allMapped[f] || '');
        });
        if (refVals.some(function (v) { return !v; })) continue;

        for (var i = 0; i < arr.length; i++) {
          var item = arr[i];
          var itemVals = fields.map(function (f) {
            return strat.caseInsensitive ? (item[f] || '').toLowerCase() : (item[f] || '');
          });
          if (itemVals.every(function (v) { return !!v; }) &&
              refVals.every(function (v, j) { return v === itemVals[j]; })) {
            return { match: strat.label, item: item };
          }
        }
      }
      return null;
    }

    rows.forEach(function (row, ri) {
      var mapped = mapRow(row);

      // Lös relationer
      var relResult = ImportExportService.resolveRelationsForRow(mapped, entityType);

      // Validera
      var errors = cfg.validate ? cfg.validate(mapped) : [];
      errors = errors.concat(relResult.errors);

      // Dubblettdetektering
      var dup = null;
      if (errors.length === 0) {
        dup = findDuplicate(mapped, relResult.resolved);
      }

      var status = errors.length ? 'error' : (dup ? 'duplicate' : 'new');

      results.push({
        rowIndex:  ri + 2,
        row:       row,
        mapped:    mapped,
        resolved:  relResult.resolved,
        status:    status,
        duplicate: dup,
        errors:    errors,
        warnings:  []
      });
    });

    return results;
  },

  /**
   * Bygger exportrader för godtyckligt register.
   * opts.includeSensitive: false (default) — sensitiveFields exkluderas alltid
   * Returnerar { headers, rows }
   */
  buildExportRowsForType: function (entityType, records, opts) {
    opts = opts || {};
    var cfg = IMPORT_EXPORT_CONFIGS[entityType];
    if (!cfg) return { headers: [], rows: [] };

    // Bygg kolumner: alla fields utom _refFields (interna referensfält) och sensitiveFields
    var sensitiveSet = {};
    (cfg.sensitiveFields || []).forEach(function (f) { sensitiveSet[f] = true; });

    var cols = (cfg.fields || []).filter(function (f) {
      if (f.value.charAt(0) === '_') return false;  // referensfält
      if (!opts.includeSensitive && sensitiveSet[f.value]) return false;
      return true;
    });

    var headers = cols.map(function (f) { return f.label.replace(' *', ''); });

    var rows = records.map(function (rec) {
      return cols.map(function (col) {
        var v = rec[col.value];
        if (v == null) return '';
        if (col.type === 'float' || col.type === 'int') return v;
        return String(v);
      });
    });

    return { headers: headers, rows: rows };
  }

});
