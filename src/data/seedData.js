/**
 * seedData.js — Demo-data för att systemet ska se levande ut
 */

// Hjälp: relativa datum
function _d(days) { return new Date(Date.now() + days * 86400000).toISOString(); }
function _ds(days) { return _d(days).split('T')[0]; }

const SeedData = {

  settings: {
    companyName: 'VIFT Fastighetsservice & Förvaltning',
    slogan: 'Fastighetsservice & Förvaltning',
    companyPhone: '070-123 45 67',
    companyEmail: 'info@vift.se',
    companyAddress: 'Storgatan 12, 123 45 Stockholm',
    website: '',
    orgNr: '556XXX-XXXX',
    vatNr: 'SE556XXXXXX01',
    primaryColor: '#0f3763',
    secondaryColor: '#1d75d8',
    logoLight: '',
    logoDark: '',
    logoIcon: '',
    defaultVatRate: 25,
    defaultPaymentTerms: 30,
    invoicePrefix: 'F-',
    bankgiro: '5555-1234',
    internalHourlyCost: 250,
    currentUser: null
  },

  staff: [
    {
      id: 'ST-001', firstName: 'Admin', lastName: 'VIFT',
      title: 'Systemadministratör', phone: '070-000 00 01', email: 'admin@vift.se',
      username: 'admin', password: '1234', role: 'admin', permissions: ['all'],
      active: true, createdAt: '2024-01-01'
    },
    {
      id: 'ST-002', firstName: 'Erik', lastName: 'Andersson',
      title: 'Fastighetstekniker', phone: '070-111 22 33', email: 'erik@vift.se',
      username: 'erik', password: '1234', role: 'personal', permissions: [],
      active: true, createdAt: '2024-01-15'
    },
    {
      id: 'ST-003', firstName: 'Maria', lastName: 'Karlsson',
      title: 'Projektledare', phone: '070-444 55 66', email: 'maria@vift.se',
      username: 'maria', password: '1234', role: 'chef', permissions: [],
      active: true, createdAt: '2024-02-01'
    },
    {
      id: 'ST-004', firstName: 'Jonas', lastName: 'Pettersson',
      title: 'Rörmokare', phone: '073-666 77 88', email: 'jonas@vift.se',
      username: 'jonas', password: '1234', role: 'personal', permissions: [],
      active: true, createdAt: '2024-03-10'
    },
    {
      id: 'ST-005', firstName: 'Sofia', lastName: 'Lindgren',
      title: 'Elektriker', phone: '072-888 99 00', email: 'sofia@vift.se',
      username: 'sofia', password: '1234', role: 'personal', permissions: [],
      active: true, createdAt: '2024-04-05'
    },
    {
      id: 'ST-006', firstName: 'Emma', lastName: 'Ekonom',
      title: 'Ekonomiassistent', phone: '070-000 00 06', email: 'emma@vift.se',
      username: 'emma', password: '1234', role: 'ekonomi', permissions: [],
      active: true, createdAt: '2024-05-01'
    }
  ],

  customers: [
    {
      id: 'K-001', type: 'brf', name: 'BRF Solgläntan', orgNr: '716400-1234',
      contactPerson: 'Lars Eriksson', phone: '08-123 45 67',
      email: 'styrelsen@solglantanbrf.se', address: 'Solvägen 1', zip: '123 45',
      city: 'Stockholm', note: 'Återkommande kund sedan 2020. Serviceavtal gemensamma utrymmen.',
      contacts: [
        { name: 'Lars Eriksson', phone: '070-111 11 11', email: 'lars@exempel.se', role: 'Ordförande' },
        { name: 'Anna Berg', phone: '070-222 22 22', email: 'anna@exempel.se', role: 'Kassör' }
      ],
      active: true, createdAt: '2024-01-10'
    },
    {
      id: 'K-002', type: 'fastighetsagare', name: 'Fastighets AB Granit', orgNr: '556123-4567',
      contactPerson: 'Peter Svensson', phone: '08-987 65 43', email: 'peter@granit.se',
      address: 'Granitgatan 5', zip: '111 11', city: 'Stockholm',
      note: 'Kommersiella fastigheter. Prioriteras högt.',
      contacts: [{ name: 'Peter Svensson', phone: '073-333 33 33', email: 'peter@granit.se', role: 'Förvaltningschef' }],
      active: true, createdAt: '2024-01-20'
    },
    {
      id: 'K-003', type: 'privat', name: 'Johansson', firstName: 'Karin', lastName: 'Johansson',
      contactPerson: 'Karin Johansson', phone: '073-555 66 77', email: 'karin@privat.se',
      address: 'Villavägen 3', zip: '145 67', city: 'Sollentuna',
      note: 'Altanmålning 2023. Nöjd kund.',
      contacts: [], active: true, createdAt: '2024-03-01'
    },
    {
      id: 'K-004', type: 'brf', name: 'BRF Björkdalen', orgNr: '716400-5678',
      contactPerson: 'Gunnar Lindqvist', phone: '08-765 43 21', email: 'info@bjorkdalen.se',
      address: 'Björkvägen 10', zip: '135 79', city: 'Järfälla',
      note: 'Planerat serviceavtal under diskussion. Fyra AO senaste 12 mån utan avtal.',
      contacts: [{ name: 'Gunnar Lindqvist', phone: '070-888 99 00', email: 'gunnar@bjorkdalen.se', role: 'Ordförande' }],
      active: true, createdAt: '2024-04-01'
    },
    {
      id: 'K-005', type: 'privat', name: 'Lindström', firstName: 'Johan', lastName: 'Lindström',
      contactPerson: 'Johan Lindström', phone: '076-321 54 87', email: 'johan.lindstrom@gmail.com',
      address: 'Ekvägen 12', zip: '168 32', city: 'Bromma',
      note: 'Villa med pool och altandäck. Underhållsmedveten kund.',
      contacts: [], active: true, createdAt: _ds(-45)
    },
    {
      id: 'K-006', type: 'brf', name: 'BRF Parkgatan', orgNr: '716401-9988',
      contactPerson: 'Birgitta Holm', phone: '08-654 32 10', email: 'styrelsen@brf-parkgatan.se',
      address: 'Parkgatan 8', zip: '112 34', city: 'Stockholm',
      note: 'Ny kund sedan i år. Söker fast servicepartner efter problem med tidigare leverantör.',
      contacts: [
        { name: 'Birgitta Holm', phone: '073-100 20 30', email: 'birgitta@brf-parkgatan.se', role: 'Ordförande' },
        { name: 'Mikael Strand', phone: '070-400 50 60', email: 'mikael@brf-parkgatan.se', role: 'Sekreterare' }
      ],
      active: true, createdAt: _ds(-30)
    },
    {
      id: 'K-007', type: 'fastighetsagare', name: 'Handelshuset AB', orgNr: '556789-1122',
      contactPerson: 'Caroline Björk', phone: '08-200 30 40', email: 'drift@handelshuset.se',
      address: 'Handelsgatan 22', zip: '103 12', city: 'Stockholm',
      note: 'Köpcentrum med 40-tal hyresgäster. Akut service med SLA-avtal.',
      contacts: [
        { name: 'Caroline Björk', phone: '076-550 66 77', email: 'caroline@handelshuset.se', role: 'Driftchef' }
      ],
      active: true, createdAt: _ds(-60)
    }
  ],

  properties: [
    {
      id: 'OBJ-001', customerId: 'K-001', name: 'Solgläntan Hus A',
      address: 'Solvägen 1A', zip: '123 45', city: 'Stockholm',
      type: 'Flerbostadshus',
      propertyDesignation: 'Stockholm Haga 1:234', buildYear: '1965', apartments: 24, floors: 6, area: 2800,
      status: 'aktiv', note: 'Hiss finns. OVK utförd 2023.',
      contacts: [
        { name: 'Anna Lindqvist', role: 'BRF-ordförande',     phone: '070-111 22 33', email: 'anna@solglantanbrf.se' },
        { name: 'Lars Pettersson', role: 'Fastighetsskötare', phone: '070-444 55 66', email: '' }
      ],
      notes: [
        { id: 'N001', text: 'Hiss inspekterad och godkänd 2023. Nästa besiktning planerad till 2024.', createdAt: '2024-01-15T09:00:00.000Z', createdBy: 'Admin' },
        { id: 'N002', text: 'BRF önskar att vi prioriterar trapphusunderhåll inför sommaren.', createdAt: '2024-03-10T14:30:00.000Z', createdBy: 'Admin' }
      ],
      technicalSystems: { heating: 'Fjärrvärme', ventilation: 'FTX', elevator: 'Schindler 2000', alarm: 'Bosch BA9000' },
      inspections: {
        ovk:  { lastDate: '2023-03-15', nextDate: '2026-03-15', status: 'godkänd' },
        sba:  { lastDate: '2023-11-20', nextDate: '2024-11-20', status: 'godkänd' },
        hiss: { lastDate: '2023-06-10', nextDate: '2024-06-10', status: 'godkänd' }
      },
      documents: [], createdAt: '2024-01-10'
    },
    {
      id: 'OBJ-002', customerId: 'K-002', name: 'Granitgatan 5',
      address: 'Granitgatan 5', zip: '111 11', city: 'Stockholm',
      type: 'Kontorsfastighet',
      propertyDesignation: 'Stockholm Granit 2:1', buildYear: '1988', apartments: 0, floors: 6, area: 4200,
      status: 'aktiv', note: 'Kontorsfastighet, 6 plan.',
      contacts: [
        { name: 'Marcus Svensson', role: 'Driftansvarig', phone: '08-222 33 44', email: 'marcus@fastighetsab.se' }
      ],
      notes: [],
      technicalSystems: { heating: 'Bergvärme', ventilation: 'CAV', electricity: '3-fas 400V' },
      inspections: { ovk: { lastDate: '2022-05-01', nextDate: '2025-05-01', status: 'godkänd' } },
      documents: [], createdAt: '2024-01-20'
    },
    {
      id: 'OBJ-003', customerId: 'K-004', name: 'Björkdalen Hus B',
      address: 'Björkvägen 10B', zip: '135 79', city: 'Järfälla',
      type: 'Flerbostadshus',
      propertyDesignation: 'Järfälla Björk 3:45', buildYear: '1978', apartments: 18, floors: 4, area: 1900,
      status: 'aktiv', note: 'Äldre installation. Behöver genomgripande OVK.',
      contacts: [
        { name: 'Eva Björk', role: 'BRF-styrelseordförande', phone: '070-777 88 99', email: 'eva@bjorkdalenbrf.se' }
      ],
      notes: [
        { id: 'N003', text: 'OVK kraftigt försenad sedan 2023. Styrelsen informerad. Åtgärd krävs snarast.', createdAt: _ds(-45) + 'T10:00:00.000Z', createdBy: 'Admin' }
      ],
      technicalSystems: { heating: 'Fjärrvärme', ventilation: 'F', water: 'Äldre stålrör, delvis åtgärdade 2015' },
      inspections: { ovk: { lastDate: '2020-09-01', nextDate: '2023-09-01', status: 'försenad' } },
      documents: [], createdAt: _ds(-60)
    },
    {
      id: 'OBJ-004', customerId: 'K-006', name: 'Parkgatan 8',
      address: 'Parkgatan 8', zip: '112 34', city: 'Stockholm',
      type: 'Flerbostadshus',
      propertyDesignation: 'Stockholm Park 5:12', buildYear: '2003', apartments: 32, floors: 8, area: 5100,
      status: 'aktiv', note: 'Nyare fastighet, bra skick. Söker proaktiv partner.',
      contacts: [
        { name: 'Sofia Nilsson',   role: 'Förvaltare',    phone: '070-321 65 43', email: 'sofia@parkbrf.se' },
        { name: 'Johan Eriksson',  role: 'Viceordförande', phone: '070-123 45 67', email: '' }
      ],
      notes: [],
      technicalSystems: { heating: 'Fjärrvärme', ventilation: 'FTX', alarm: 'Texecom Premier', elevator: 'KONE MonoSpace' },
      inspections: { ovk: { lastDate: _ds(-400), nextDate: _ds(200), status: 'godkänd' } },
      documents: [], createdAt: _ds(-30)
    }
  ],

  priceGroups: [
    { id:'PG-001', name:'Fastighetsservice avtal',    hourRate:392, billingType:'hourly',  description:'Äldre/låg prisnivå, återkommande kund',     active:true, createdAt:'2024-01-01' },
    { id:'PG-002', name:'Fastighetsservice standard', hourRate:430, billingType:'hourly',  description:'Normal BRF och fastighetsägare',             active:true, createdAt:'2024-01-01' },
    { id:'PG-003', name:'Engångsjobb / privat',       hourRate:595, billingType:'hourly',  description:'Privatkund eller uppdrag utan avtal',         active:true, createdAt:'2024-01-01' },
    { id:'PG-004', name:'Akut / kväll / helg',        hourRate:695, billingType:'hourly',  description:'Jour, kort varsel, obekväm arbetstid',       active:true, createdAt:'2024-01-01' },
    { id:'PG-005', name:'Teknisk förvaltning',        hourRate:0,   billingType:'monthly', description:'Månadsavtal, pris sätts manuellt per avtal', active:true, createdAt:'2024-01-01' },
  ],

  priceProfiles: [
    { id:'PP-001', name:'Privatkund',       defaultPriceGroupId:'PG-003', notes:'Privatpersoner utan avtal',             sortOrder:10, active:true, createdAt:'2024-01-01' },
    { id:'PP-002', name:'BRF',             defaultPriceGroupId:'PG-002', notes:'Bostadsrättsföreningar',                 sortOrder:20, active:true, createdAt:'2024-01-01' },
    { id:'PP-003', name:'Fastighetsägare', defaultPriceGroupId:'PG-002', notes:'Fastighetsägare med eller utan avtal',  sortOrder:30, active:true, createdAt:'2024-01-01' },
    { id:'PP-004', name:'Företag',         defaultPriceGroupId:'PG-002', notes:'Företag och kommersiella kunder',       sortOrder:40, active:true, createdAt:'2024-01-01' },
    { id:'PP-005', name:'Avtalskund',      defaultPriceGroupId:'PG-001', notes:'Kund med löpande avtal, lägre pris',   sortOrder:50, active:true, createdAt:'2024-01-01' },
  ],

  emailTemplates: [
    {
      id: 'ET-001', type: 'send_offer', name: 'Skicka offert', sortOrder: 10, active: true,
      subject: 'Offert {{offerId}}{{titleSuffix}} – VIFT Fastighetsservice',
      body: 'Hej {{firstName}},\n\nTack för att du vände dig till oss!\n\nBifogat hittar du offert {{offerId}}{{titleSuffix}}.\n\nOfferten är giltig till {{validUntil}}.\n{{paymentLine}}\nHör gärna av dig om du har frågor eller vill diskutera offerten.\n\nMed vänliga hälsningar,\nVIFT Fastighetsservice\n{{viftPhone}}'
    },
    {
      id: 'ET-002', type: 'reminder', name: 'Påminnelse offert', sortOrder: 20, active: true,
      subject: 'Påminnelse: Offert {{offerId}}{{titleSuffix}} – VIFT Fastighetsservice',
      body: 'Hej {{firstName}},\n\nJag ville bara påminna om offert {{offerId}}{{titleSuffix}} som vi skickade {{sentDate}}.\n\nOfferten är fortfarande giltig till {{validUntil}} och vi hoppas att du hunnit titta igenom den.\n\nHör gärna av dig om du har frågor – vi är glada att hjälpa!\n\nMed vänliga hälsningar,\nVIFT Fastighetsservice\n{{viftPhone}}'
    },
    {
      id: 'ET-003', type: 'approved', name: 'Tack för godkännande', sortOrder: 30, active: true,
      subject: 'Bekräftelse – Offert {{offerId}} godkänd',
      body: 'Hej {{firstName}},\n\nTack för att du valde VIFT Fastighetsservice!\n\nVi bekräftar härmed att offert {{offerId}}{{titleSuffix}} är godkänd.\n\nVi återkommer inom kort med planering och uppstart.\n\nMed vänliga hälsningar,\nVIFT Fastighetsservice\n{{viftPhone}}'
    },
    {
      id: 'ET-004', type: 'followup', name: 'Uppföljning efter skickad offert', sortOrder: 40, active: true,
      subject: 'Uppföljning: Offert {{offerId}}{{titleSuffix}}',
      body: 'Hej {{firstName}},\n\nJag hör av mig angående offert {{offerId}}{{titleSuffix}} som vi skickade för ett tag sedan.\n\nHar du haft möjlighet att titta igenom den? Vi finns tillgängliga för frågor och kan naturligtvis justera om det behövs.\n\nMed vänliga hälsningar,\nVIFT Fastighetsservice\n{{viftPhone}}'
    },
    {
      id: 'ET-005', type: 'declined', name: 'Tack för återkoppling (nekad)', sortOrder: 50, active: true,
      subject: 'Tack för din återkoppling – Offert {{offerId}}',
      body: 'Hej {{firstName}},\n\nTack för att du tog dig tid att återkoppla angående offert {{offerId}}{{titleSuffix}}.\n\nVi respekterar ditt beslut och hoppas att vi får möjlighet att hjälpa dig i framtiden.\n\nHör gärna av dig om du har frågor eller om situationen förändras.\n\nMed vänliga hälsningar,\nVIFT Fastighetsservice\n{{viftPhone}}'
    },
  ],

  workOrders: [
    // ── Pågående ────────────────────────────────────────────────────────────
    {
      id: 'AO-001', title: 'Läckage balkong vån 3',
      description: 'Vatten tränger in vid balkongraden på vån 3. Behöver inspekteras och tätas.',
      customerId: 'K-001', propertyId: 'OBJ-001', address: 'Solvägen 1A, vån 3',
      contactPerson: 'Lars Eriksson', phone: '070-111 11 11', accessCode: '1234#', internalNote: '',
      status: 'pågående', priority: 'hög', priceType: 'timpris', fixedPrice: 0, priceGroupId: 'PG-001', estimatedHours: 3,
      staff: ['ST-002'],
      scheduledDate: _ds(0), scheduledStart: '08:00', scheduledEnd: '12:00',
      checklist: [
        { id: 'c1', text: 'Inspektera balkong', done: true },
        { id: 'c2', text: 'Identifiera läckagets ursprung', done: true },
        { id: 'c3', text: 'Täta med fogmassa', done: false },
        { id: 'c4', text: 'Kontrollera att läckaget är åtgärdat', done: false }
      ],
      materials: [
        { id: 'm1', articleId: 'ART-001', name: 'Fogmassa Sikaflex 291i', qty: 2, unit: 'st', buyPrice: 75, sellPrice: 145, addedAt: _d(-1) },
        { id: 'm2', articleId: 'ART-004', name: 'Primer 290 DC', qty: 1, unit: 'fl', buyPrice: 110, sellPrice: 210, addedAt: _d(0) }
      ],
      notes: [
        { id: 'N-001', text: 'Läckan verkar komma inifrån balkongplattan, inte från fogar. Behöver troligen rivning av golvbeläggning för att nå tätskiktet.', staffName: 'Erik Andersson', timestamp: _d(-1) }
      ],
      log: [
        { id: 'LOG-001', type: 'log', text: 'Ankomst 08:05. Inspekterade balkong och konstaterade att vattnet tränger in via skadan i tätskiktet vid vägganslutningen.', userName: 'Erik Andersson', visibility: 'intern', timestamp: _d(-1) },
        { id: 'LOG-002', type: 'uppföljning', text: 'Kontakta kund när arbetet är klart för slutbesiktning.', userName: 'Erik Andersson', followUpDate: _ds(3), visibility: 'intern', timestamp: _d(-1) },
        { id: 'LOG-003', type: 'log', text: 'Påbörjat rengöring av ytor inför fogning. Fogmassa beställd.', userName: 'Erik Andersson', visibility: 'intern', timestamp: _d(0) }
      ],
      timeEntries: ['TE-001'], invoiceId: '',
      createdAt: _d(-2), updatedAt: _d(0)
    },
    {
      id: 'AO-008', title: 'Byte kablar serverhall',
      description: 'Byta befintliga kablar i serverhall plan 2. Inkl dragning av nya nätverkskablar.',
      customerId: 'K-007', propertyId: '', address: 'Handelsgatan 22, plan 2',
      contactPerson: 'Caroline Björk', phone: '076-550 66 77', accessCode: 'PORT22', internalNote: 'Arbete pågår dagtid, störa ej hyresgäst i rum 204',
      status: 'pågående', priority: 'hög', priceType: 'timpris', fixedPrice: 0, priceGroupId: 'PG-001',
      staff: ['ST-005', 'ST-002'],
      scheduledDate: _ds(0), scheduledStart: '07:00', scheduledEnd: '15:00',
      checklist: [
        { id: 'c1', text: 'Stäng av strömmen till serverhallen', done: true },
        { id: 'c2', text: 'Dra ny kabel CAT6A 40m', done: true },
        { id: 'c3', text: 'Montera patchpanel 24-port', done: false },
        { id: 'c4', text: 'Märk upp alla kablar', done: false },
        { id: 'c5', text: 'Testa anslutningar', done: false }
      ],
      materials: [
        { id: 'm1', articleId: 'ART-020', name: 'Kabelstrumpa 10m', qty: 3, unit: 'st', buyPrice: 35, sellPrice: 70 }
      ],
      notes: [], timeEntries: ['TE-002', 'TE-003'], invoiceId: '',
      createdAt: _d(-3), updatedAt: _d(0)
    },

    // ── Nytt ────────────────────────────────────────────────────────────────
    {
      id: 'AO-003', title: 'Akut – Värmepump ur funktion',
      description: 'Värmepumpen i källaren har slutat fungera. Kallt i fastigheten.',
      customerId: 'K-002', propertyId: 'OBJ-002', address: 'Granitgatan 5',
      contactPerson: 'Peter Svensson', phone: '073-333 33 33', accessCode: '9999*',
      internalNote: 'Ring Peter direkt vid ankomst',
      status: 'nytt', priority: 'akut', priceType: 'timpris', fixedPrice: 0, priceGroupId: 'PG-002',
      staff: [], scheduledDate: '', scheduledStart: '', scheduledEnd: '',
      checklist: [], materials: [], notes: [], timeEntries: [], invoiceId: '',
      createdAt: _d(0), updatedAt: _d(0)
    },
    {
      id: 'AO-006', title: 'Dörrtätning entréparti',
      description: 'Dörren till entrén drar kalluft. Tätningslister behöver bytas.',
      customerId: 'K-006', propertyId: 'OBJ-004', address: 'Parkgatan 8',
      contactPerson: 'Birgitta Holm', phone: '073-100 20 30', accessCode: 'PARK8',
      internalNote: '',
      status: 'nytt', priority: 'normal', priceType: 'timpris', fixedPrice: 0, priceGroupId: 'PG-001',
      staff: [], scheduledDate: '', scheduledStart: '', scheduledEnd: '',
      checklist: [
        { id: 'c1', text: 'Kontrollera befintliga tätningslister', done: false },
        { id: 'c2', text: 'Byt gummitätning runt dörrkarmen', done: false },
        { id: 'c3', text: 'Justera dörrens stängning', done: false }
      ],
      materials: [], notes: [], timeEntries: [], invoiceId: '',
      createdAt: _d(-1), updatedAt: _d(-1)
    },
    {
      id: 'AO-015', title: 'Akut – Vattenläcka källare',
      description: 'Kraftig vattenläcka i källarförrådet. Vattnet stiger. Akut ingripande krävs.',
      customerId: 'K-006', propertyId: 'OBJ-004', address: 'Parkgatan 8, källare',
      contactPerson: 'Mikael Strand', phone: '070-400 50 60', accessCode: 'PARK8',
      internalNote: 'VA-bolag kontaktat men kan ej komma förrän om 3h',
      status: 'nytt', priority: 'akut', priceType: 'timpris', fixedPrice: 0, priceGroupId: 'PG-002',
      staff: ['ST-004'], scheduledDate: _ds(0), scheduledStart: '', scheduledEnd: '',
      checklist: [
        { id: 'c1', text: 'Stäng av huvudkran', done: false },
        { id: 'c2', text: 'Identifiera läckagets källa', done: false },
        { id: 'c3', text: 'Pumpa ut vatten', done: false },
        { id: 'c4', text: 'Åtgärda röret', done: false }
      ],
      materials: [], notes: [], timeEntries: [], invoiceId: '',
      createdAt: _d(0), updatedAt: _d(0)
    },

    // ── Planerad ────────────────────────────────────────────────────────────
    {
      id: 'AO-007', title: 'Rörinspektion kök & badrum',
      description: 'Kamerainspektion av avloppsrör i kök och badrum. Peter önskar protokoll.',
      customerId: 'K-002', propertyId: 'OBJ-002', address: 'Granitgatan 5',
      contactPerson: 'Peter Svensson', phone: '073-333 33 33', accessCode: '9999*',
      internalNote: 'Kamerabil medhavs av Jonas',
      status: 'planerad', priority: 'normal', priceType: 'fastpris', fixedPrice: 3800, priceGroupId: '',
      staff: ['ST-004'],
      scheduledDate: _ds(1), scheduledStart: '10:00', scheduledEnd: '13:00',
      checklist: [
        { id: 'c1', text: 'Inspektera kökavlopp', done: false },
        { id: 'c2', text: 'Inspektera badrumsavlopp', done: false },
        { id: 'c3', text: 'Upprätta inspektionsrapport', done: false }
      ],
      materials: [], notes: [], timeEntries: [], invoiceId: '',
      createdAt: _d(-4), updatedAt: _d(-1)
    },
    {
      id: 'AO-013', title: 'Ventilationsrensning trapphus',
      description: 'Rensning av ventilationskanaler i alla trapphus. 3 trapphus.',
      customerId: 'K-004', propertyId: 'OBJ-003', address: 'Björkvägen 10B, Järfälla',
      contactPerson: 'Gunnar Lindqvist', phone: '070-888 99 00', accessCode: 'BJÖRK',
      internalNote: 'Planerat igår men kunden fick omboka. Nytt datum sätts.',
      status: 'planerad', priority: 'normal', priceType: 'timpris', fixedPrice: 0, priceGroupId: 'PG-001',
      staff: ['ST-002', 'ST-003'],
      scheduledDate: _ds(-1), scheduledStart: '08:00', scheduledEnd: '16:00',
      checklist: [
        { id: 'c1', text: 'Rensa trapphus 1 ventilation', done: false },
        { id: 'c2', text: 'Rensa trapphus 2 ventilation', done: false },
        { id: 'c3', text: 'Rensa trapphus 3 ventilation', done: false },
        { id: 'c4', text: 'Mäta luftflöden efter rensning', done: false }
      ],
      materials: [], notes: [], timeEntries: [], invoiceId: '',
      createdAt: _d(-7), updatedAt: _d(-1)
    },

    // ── Arbetspool ──────────────────────────────────────────────────────────
    {
      id: 'AO-004', title: 'Fasadtvätt',
      description: 'Högtryckstvätt av fasad, alla sidor.',
      customerId: 'K-001', propertyId: 'OBJ-001', address: 'Solvägen 1A',
      contactPerson: 'Lars Eriksson', phone: '070-111 11 11', accessCode: '1234#',
      internalNote: '',
      status: 'pool', priority: 'normal', priceType: 'fastpris', fixedPrice: 8500, priceGroupId: '',
      staff: [], scheduledDate: '', scheduledStart: '', scheduledEnd: '',
      checklist: [], materials: [], notes: [], timeEntries: [], invoiceId: '',
      createdAt: _d(-1), updatedAt: _d(-1)
    },
    {
      id: 'AO-009', title: 'Terrassdrän & markarbete',
      description: 'Anlägga ny dränering vid terrassen. Gräva 15m och lägga drän-rör.',
      customerId: 'K-004', propertyId: 'OBJ-003', address: 'Björkvägen 10, Järfälla',
      contactPerson: 'Gunnar Lindqvist', phone: '070-888 99 00', accessCode: 'BJÖRK',
      internalNote: '',
      status: 'pool', priority: 'låg', priceType: 'fastpris', fixedPrice: 22000, priceGroupId: '',
      staff: [], scheduledDate: '', scheduledStart: '', scheduledEnd: '',
      checklist: [
        { id: 'c1', text: 'Markering av grävområde', done: false },
        { id: 'c2', text: 'Grävarbete 15m', done: false },
        { id: 'c3', text: 'Lägg drän-rör', done: false },
        { id: 'c4', text: 'Återfyll och planera', done: false }
      ],
      materials: [], notes: [], timeEntries: [], invoiceId: '',
      createdAt: _d(-5), updatedAt: _d(-5)
    },
    {
      id: 'AO-010', title: 'Snöröjning & halkbekämpning',
      description: 'Akutavtal snöröjning parkeringsytan 800m². Saltning och sandning.',
      customerId: 'K-001', propertyId: 'OBJ-001', address: 'Solvägen 1, parkering',
      contactPerson: 'Anna Berg', phone: '070-222 22 22', accessCode: '1234#',
      internalNote: 'Utförs vid behov, max 3 tillfällen per faktura',
      status: 'pool', priority: 'normal', priceType: 'fastpris', fixedPrice: 1200, priceGroupId: '',
      staff: [], scheduledDate: '', scheduledStart: '', scheduledEnd: '',
      checklist: [], materials: [], notes: [], timeEntries: [], invoiceId: '',
      createdAt: _d(-3), updatedAt: _d(-3)
    },

    // ── Klar (redo för fakturering, ingen invoiceId) ─────────────────────
    {
      id: 'AO-002', title: 'OVK-kontroll Hus A',
      description: 'Obligatorisk ventilationskontroll enligt plan.',
      customerId: 'K-001', propertyId: 'OBJ-001', address: 'Solvägen 1A',
      contactPerson: 'Lars Eriksson', phone: '070-111 11 11', accessCode: '1234#', internalNote: '',
      status: 'klar', priority: 'normal', priceType: 'fastpris', fixedPrice: 4500, priceGroupId: '',
      staff: ['ST-002', 'ST-003'],
      scheduledDate: _ds(-5), scheduledStart: '09:00', scheduledEnd: '16:00',
      checklist: [
        { id: 'c1', text: 'Kontrollera alla tilluftsventiler', done: true },
        { id: 'c2', text: 'Kontrollera frånluftsventiler', done: true },
        { id: 'c3', text: 'Mäta luftflöden', done: true },
        { id: 'c4', text: 'Upprätta OVK-protokoll', done: true }
      ],
      materials: [], notes: [], timeEntries: [], invoiceId: '',
      createdAt: _d(-6), updatedAt: _d(-5), completedAt: _d(-5)
    },
    {
      id: 'AO-005', title: 'Hissservice kvartalsvis',
      description: 'Kvartalskontroll och service av hiss.',
      customerId: 'K-001', propertyId: 'OBJ-001', address: 'Solvägen 1A',
      contactPerson: 'Anna Berg', phone: '070-222 22 22', accessCode: '1234#', internalNote: '',
      status: 'klar', priority: 'normal', priceType: 'fastpris', fixedPrice: 2200, priceGroupId: '',
      staff: ['ST-002'],
      scheduledDate: _ds(-10), scheduledStart: '10:00', scheduledEnd: '12:00',
      checklist: [
        { id: 'c1', text: 'Kontrollera bromsar', done: true },
        { id: 'c2', text: 'Smörj linor', done: true },
        { id: 'c3', text: 'Testköra hiss', done: true }
      ],
      materials: [], notes: [], timeEntries: [], invoiceId: '',
      createdAt: _d(-11), updatedAt: _d(-10), completedAt: _d(-10)
    },
    {
      id: 'AO-011', title: 'Byte golvbrunn & tätskikt',
      description: 'Gammal golvbrunn i badrum byttes. Tätskikt kontrollerat och dellagat.',
      customerId: 'K-005', propertyId: '', address: 'Ekvägen 12, Bromma',
      contactPerson: 'Johan Lindström', phone: '076-321 54 87', accessCode: '', internalNote: '',
      status: 'klar', priority: 'normal', priceType: 'timpris', fixedPrice: 0, priceGroupId: 'PG-001',
      staff: ['ST-004'],
      scheduledDate: _ds(-6), scheduledStart: '09:00', scheduledEnd: '14:00',
      checklist: [
        { id: 'c1', text: 'Demontera gammal golvbrunn', done: true },
        { id: 'c2', text: 'Kontrollera och laga tätskikt', done: true },
        { id: 'c3', text: 'Montera ny golvbrunn', done: true },
        { id: 'c4', text: 'Täthetsprov', done: true }
      ],
      materials: [
        { id: 'm1', articleId: 'ART-016', name: 'Golvbrunn plastrens', qty: 1, unit: 'st', buyPrice: 110, sellPrice: 220 }
      ],
      notes: [], timeEntries: [], invoiceId: '',
      createdAt: _d(-8), updatedAt: _d(-6), completedAt: _d(-6)
    },
    {
      id: 'AO-012', title: 'VVS-service & tryckkontroll',
      description: 'Genomgång av VVS-systemet, kontroll av trycknivåer och tätning av småläckor.',
      customerId: 'K-002', propertyId: 'OBJ-002', address: 'Granitgatan 5',
      contactPerson: 'Peter Svensson', phone: '073-333 33 33', accessCode: '9999*', internalNote: '',
      status: 'klar', priority: 'normal', priceType: 'timpris', fixedPrice: 0, priceGroupId: 'PG-001',
      staff: ['ST-004', 'ST-002'],
      scheduledDate: _ds(-4), scheduledStart: '08:00', scheduledEnd: '15:00',
      checklist: [
        { id: 'c1', text: 'Kontrollera samtliga skarvar', done: true },
        { id: 'c2', text: 'Trycktesta systemet', done: true },
        { id: 'c3', text: 'Täta identifierade läckor', done: true },
        { id: 'c4', text: 'Rapport till kund', done: true }
      ],
      materials: [
        { id: 'm1', articleId: 'ART-015', name: 'Kulventil 15mm', qty: 2, unit: 'st', buyPrice: 95, sellPrice: 195 }
      ],
      notes: [], timeEntries: [], invoiceId: '',
      createdAt: _d(-6), updatedAt: _d(-4), completedAt: _d(-4)
    },

    // ── Fakturerad ──────────────────────────────────────────────────────────
    {
      id: 'AO-014', title: 'Elinstallation konferensrum',
      description: 'Installation av nytt belysningssystem och uttag i konferensrummet.',
      customerId: 'K-002', propertyId: 'OBJ-002', address: 'Granitgatan 5, plan 3',
      contactPerson: 'Peter Svensson', phone: '073-333 33 33', accessCode: '9999*', internalNote: '',
      status: 'fakturerad', priority: 'normal', priceType: 'timpris', fixedPrice: 0, priceGroupId: 'PG-001',
      staff: ['ST-005'],
      scheduledDate: _ds(-25), scheduledStart: '08:00', scheduledEnd: '16:00',
      checklist: [
        { id: 'c1', text: 'Dra kabel till belysning', done: true },
        { id: 'c2', text: 'Montera 8 st spotlights', done: true },
        { id: 'c3', text: 'Installera 4 st uttag', done: true },
        { id: 'c4', text: 'Test och kontroll', done: true }
      ],
      materials: [], notes: [], timeEntries: [], invoiceId: 'INV-001',
      createdAt: _d(-30), updatedAt: _d(-25), completedAt: _d(-25)
    }
  ],

  offers: [
    {
      id: 'OFF-001', customerId: 'K-004', propertyId: '', address: 'Björkvägen 10, Järfälla',
      internalNote: 'Kund intresserad av serviceavtal',
      lines: [
        { id: 'l1', description: 'Serviceavtal gemensamma utrymmen', qty: 12, unit: 'månad', unitPrice: 2500, vatRate: 25, discount: 0, total: 30000 },
        { id: 'l2', description: 'OVK-kontroll', qty: 1, unit: 'st', unitPrice: 4500, vatRate: 25, discount: 0, total: 4500 }
      ],
      taxType: 'moms', rotRutAmount: 0, terms: '30 dagar netto',
      includes: 'Material ingår upp till 500 kr per tillfälle',
      excludes: 'Akutjobb utanför ordinarie servicetider',
      validUntil: _ds(14), status: 'skickad', declineReason: '',
      salesOpportunityId: 'SO-002', workOrderId: '',
      sentAt: _d(-8), answeredAt: '', createdAt: _d(-9), updatedAt: _d(-8)
    },
    {
      id: 'OFF-002', customerId: 'K-005', propertyId: '', address: 'Ekvägen 12, Bromma',
      internalNote: 'Johan frågade om badrumsrenovering vid senaste jobbet',
      lines: [
        { id: 'l1', description: 'Rivning och bortforsling', qty: 1, unit: 'st', unitPrice: 8000, vatRate: 25, discount: 0, total: 8000 },
        { id: 'l2', description: 'Kakelläggning 14m²', qty: 14, unit: 'm²', unitPrice: 650, vatRate: 25, discount: 0, total: 9100 },
        { id: 'l3', description: 'Ny duschkabin inkl montering', qty: 1, unit: 'st', unitPrice: 12500, vatRate: 25, discount: 0, total: 12500 },
        { id: 'l4', description: 'VVS-arbete', qty: 8, unit: 'tim', unitPrice: 695, vatRate: 25, discount: 0, total: 5560 }
      ],
      taxType: 'rot', rotRutAmount: 18580, terms: '30 dagar netto',
      includes: 'Allt material, frakt och bortforsling',
      excludes: 'Elektriker om extra uttag önskas',
      validUntil: _ds(21), status: 'utkast', declineReason: '',
      salesOpportunityId: '', workOrderId: '',
      sentAt: '', answeredAt: '', createdAt: _d(-2), updatedAt: _d(-2)
    },
    {
      id: 'OFF-003', customerId: 'K-002', propertyId: 'OBJ-002', address: 'Granitgatan 5',
      internalNote: 'Fasadrenovering godkänd – starta planering',
      lines: [
        { id: 'l1', description: 'Ställningsarbete och montering', qty: 1, unit: 'st', unitPrice: 18000, vatRate: 25, discount: 5, total: 17100 },
        { id: 'l2', description: 'Fasadputsning 420m²', qty: 420, unit: 'm²', unitPrice: 280, vatRate: 25, discount: 0, total: 117600 },
        { id: 'l3', description: 'Målning 2 strykningar', qty: 420, unit: 'm²', unitPrice: 120, vatRate: 25, discount: 0, total: 50400 },
        { id: 'l4', description: 'Demontering & bortforsling ställning', qty: 1, unit: 'st', unitPrice: 8000, vatRate: 25, discount: 5, total: 7600 }
      ],
      taxType: 'moms', rotRutAmount: 0, terms: '50% förskott, 50% vid leverans',
      includes: 'Allt material, ställning, skyddsnät',
      excludes: 'Fönsterbyten',
      validUntil: _ds(-5), status: 'godkänd', declineReason: '',
      salesOpportunityId: 'SO-006', workOrderId: '',
      sentAt: _d(-18), answeredAt: _d(-5), createdAt: _d(-20), updatedAt: _d(-5)
    },
    {
      id: 'OFF-004', customerId: 'K-006', propertyId: 'OBJ-004', address: 'Parkgatan 8',
      internalNote: 'BRF vill ha komplett städ och underhållsoffert',
      lines: [
        { id: 'l1', description: 'Månadsvis städservice 8h/mån', qty: 12, unit: 'månad', unitPrice: 4960, vatRate: 25, discount: 0, total: 59520 },
        { id: 'l2', description: 'Kvartalstvätt fasad', qty: 4, unit: 'st', unitPrice: 6500, vatRate: 25, discount: 0, total: 26000 },
        { id: 'l3', description: 'Snöröjning (vid behov)', qty: 1, unit: 'fast pris', unitPrice: 15000, vatRate: 25, discount: 0, total: 15000 }
      ],
      taxType: 'moms', rotRutAmount: 0, terms: '30 dagar netto',
      includes: 'Allt städmaterial och utrustning',
      excludes: 'Akutinsatser utanför ordinarie tider',
      validUntil: _ds(4), status: 'skickad', declineReason: '',
      salesOpportunityId: 'SO-007', workOrderId: '',
      sentAt: _d(-3), answeredAt: '', createdAt: _d(-5), updatedAt: _d(-3)
    },
    {
      id: 'OFF-005', customerId: 'K-003', propertyId: '', address: 'Villavägen 3, Sollentuna',
      internalNote: 'Karin tackade nej till takjobb – för dyrt',
      lines: [
        { id: 'l1', description: 'Takinspekton och rensning hängrännor', qty: 1, unit: 'st', unitPrice: 3800, vatRate: 25, discount: 0, total: 3800 },
        { id: 'l2', description: 'Byte av 3m hängränna', qty: 3, unit: 'm', unitPrice: 450, vatRate: 25, discount: 0, total: 1350 }
      ],
      taxType: 'rot', rotRutAmount: 2575, terms: '10 dagar netto',
      includes: 'Material och bortforsling', excludes: '',
      validUntil: _ds(-20), status: 'nekad',
      declineReason: 'Kunden tyckte priset var för högt. Ska be granne göra det.',
      salesOpportunityId: '', workOrderId: '',
      sentAt: _d(-30), answeredAt: _d(-20), createdAt: _d(-32), updatedAt: _d(-20)
    }
  ],

  salesOpportunities: [
    {
      id: 'SO-001', customerId: 'K-003', propertyId: '', type: 'seasonal_job',
      title: 'Altantvätt – säsong 2025',
      reason: 'Karin Johansson fick altantvätt maj 2024. Det är snart ett år sedan.',
      aiTip: 'Inför säsongen 2025 är det rätt läge att ta kontakt. Kunden var nöjd senast och har en stor altan.',
      suggestedAction: 'Ring upp och fråga om de vill boka altan- och fasadtvätt inför sommaren.',
      priority: 'high', status: 'new',
      dueDate: _ds(7), snoozedUntil: '',
      sourceType: 'work_order', sourceId: '', estimatedValue: 3500,
      convertedWorkOrderId: '', convertedQuoteId: '',
      createdAt: _d(-1), updatedAt: _d(-1), completedAt: '', completedBy: ''
    },
    {
      id: 'SO-002', customerId: 'K-004', propertyId: '', type: 'service_agreement',
      title: 'Serviceavtal BRF Björkdalen',
      reason: 'BRF Björkdalen har haft 4 arbetsorder senaste 12 månaderna utan avtal.',
      aiTip: 'Med ett serviceavtal sparar kunden pengar och ni får återkommande intäkt. Offert skickad men inget svar.',
      suggestedAction: 'Skicka påminnelse – offerten OFF-001 har inte besvarats på 8 dagar.',
      priority: 'high', status: 'contacted',
      dueDate: _ds(2), snoozedUntil: '',
      sourceType: 'offer', sourceId: 'OFF-001', estimatedValue: 34500,
      convertedWorkOrderId: '', convertedQuoteId: 'OFF-001',
      createdAt: _d(-10), updatedAt: _d(-8), completedAt: '', completedBy: ''
    },
    {
      id: 'SO-003', customerId: 'K-001', propertyId: 'OBJ-001', type: 'upsell',
      title: 'Takinspektion efter vinter',
      reason: 'BRF Solgläntan har haft vattenskada (AO-001). Taket bör inspekteras.',
      aiTip: 'I samband med balkongläckaget finns anledning att erbjuda takinspektion. Förebyggande åtgärd.',
      suggestedAction: 'Erbjud takinspektion som tillägg till pågående arbete.',
      priority: 'medium', status: 'new',
      dueDate: _ds(5), snoozedUntil: '',
      sourceType: 'work_order', sourceId: 'AO-001', estimatedValue: 5500,
      convertedWorkOrderId: '', convertedQuoteId: '',
      createdAt: _d(-2), updatedAt: _d(-2), completedAt: '', completedBy: ''
    },
    {
      id: 'SO-004', customerId: 'K-002', propertyId: 'OBJ-002', type: 'win_back',
      title: 'Serviceavtal efter akutjobb',
      reason: 'Fastighets AB Granit har akut värmepumpfel. Bra läge att ta in ett löpande serviceavtal.',
      aiTip: 'Kunder är som mest mottagliga för avtal direkt efter ett akut problem lösts. Ta upp det efter AO-003.',
      suggestedAction: 'Presentera serviceavtal under pågående akutjobb.',
      priority: 'high', status: 'contact_needed',
      dueDate: _ds(0), snoozedUntil: '',
      sourceType: 'work_order', sourceId: 'AO-003', estimatedValue: 18000,
      convertedWorkOrderId: '', convertedQuoteId: '',
      createdAt: _d(0), updatedAt: _d(0), completedAt: '', completedBy: ''
    },
    {
      id: 'SO-005', customerId: 'K-003', propertyId: '', type: 'seasonal_job',
      title: 'Takrännor och stuprör inför hösten',
      reason: 'Karin tackade nej till takoffert men nämde att stuprören ser dåliga ut.',
      aiTip: 'Vänta tills kunden glömt det negativa beslutet. Kontakta igen om 3 veckor med fokus på stuprören.',
      suggestedAction: 'Ta kontakt om 3 veckor – erbjud enbart stuprör till lägre pris.',
      priority: 'low', status: 'snoozed',
      dueDate: _ds(21), snoozedUntil: _ds(21),
      sourceType: 'offer', sourceId: 'OFF-005', estimatedValue: 2200,
      convertedWorkOrderId: '', convertedQuoteId: '',
      createdAt: _d(-20), updatedAt: _d(-20), completedAt: '', completedBy: ''
    },
    {
      id: 'SO-006', customerId: 'K-002', propertyId: 'OBJ-002', type: 'quote_followup',
      title: 'Fasadrenovering Granitgatan 5',
      reason: 'Offert OFF-003 accepterades. Starta projektet.',
      aiTip: 'Kunden har tackat ja. Dags att boka in projektstart och ta förskottsbetalning.',
      suggestedAction: 'Schemalägg projektstart och fakturera förskott (50%).',
      priority: 'high', status: 'won',
      dueDate: _ds(-5), snoozedUntil: '',
      sourceType: 'offer', sourceId: 'OFF-003', estimatedValue: 192700,
      convertedWorkOrderId: '', convertedQuoteId: 'OFF-003',
      createdAt: _d(-20), updatedAt: _d(-5),
      completedAt: _d(-5), completedBy: 'ST-001'
    },
    {
      id: 'SO-007', customerId: 'K-006', propertyId: 'OBJ-004', type: 'service_agreement',
      title: 'Årsavtal BRF Parkgatan',
      reason: 'BRF Parkgatan är ny kund och söker en fast servicepartner.',
      aiTip: 'Ny kund med hög potential. Offert OFF-004 skickad. Kunden verkar nöjd efter dörrtätningsuppdraget.',
      suggestedAction: 'Följ upp offert OFF-004 som skickades igår.',
      priority: 'high', status: 'contacted',
      dueDate: _ds(3), snoozedUntil: '',
      sourceType: 'offer', sourceId: 'OFF-004', estimatedValue: 100520,
      convertedWorkOrderId: '', convertedQuoteId: 'OFF-004',
      createdAt: _d(-5), updatedAt: _d(-3), completedAt: '', completedBy: ''
    },
    {
      id: 'SO-008', customerId: 'K-007', propertyId: '', type: 'service_agreement',
      title: 'SLA-avtal Handelshuset',
      reason: 'Handelshuset AB har nu fått akutjobb två gånger på kort tid. Dags att erbjuda SLA.',
      aiTip: 'Kommersiella fastigheter med hög omsättning köper gärna förutsägbar kostnad och garanterade svarstider.',
      suggestedAction: 'Presentera SLA-paket med 2h garanterad responstid och fast månadsavgift.',
      priority: 'high', status: 'new',
      dueDate: _ds(1), snoozedUntil: '',
      sourceType: 'work_order', sourceId: 'AO-008', estimatedValue: 48000,
      convertedWorkOrderId: '', convertedQuoteId: '',
      createdAt: _d(-1), updatedAt: _d(-1), completedAt: '', completedBy: ''
    }
  ],

  recurringOrders: [
    {
      id: 'REC-001', title: 'Månadsservice VVS – Solgläntan',
      customerId: 'K-001', propertyId: 'OBJ-001', address: 'Solvägen 1A, 123 45 Stockholm',
      description: 'Månadsvis genomgång av VVS-systemet. Kontrollera trycknivåer, kranhuvuden, termostater och brunnar.',
      contactPerson: 'Lars Eriksson', phone: '070-111 11 11', internalNote: '',
      priority: 'normal', priceType: 'fastpris', priceGroupId: 'PG-003', fixedPrice: 1850,
      staff: ['ST-004'],
      interval: 'månadsvis', intervalDays: 30,
      startDate: '2025-01-01', nextDate: _ds(3), tillsvidare: true, endDate: '',
      checklist: [
        { text: 'Kontrollera varmvattenberedare' },
        { text: 'Rensa golvbrunnar källare' },
        { text: 'Kontrollera trycknivå fjärrvärme' },
        { text: 'Dokumentera avvikelser i logg' }
      ],
      status: 'aktiv', lastCreatedDate: _ds(-27),
      createdAt: '2025-01-01', updatedAt: _ds(-27)
    },
    {
      id: 'REC-002', title: 'Kvartalskontroll hiss – Solgläntan',
      customerId: 'K-001', propertyId: 'OBJ-001', address: 'Solvägen 1A, 123 45 Stockholm',
      description: 'Obligatorisk kvartalskontroll av hissen inkl smörjning, bromstest och provkörning.',
      contactPerson: 'Anna Berg', phone: '070-222 22 22', internalNote: 'Kontrollera alltid att hissloggen är uppdaterad',
      priority: 'hög', priceType: 'fastpris', priceGroupId: '', fixedPrice: 2200,
      staff: ['ST-002'],
      interval: 'kvartalsvis', intervalDays: 90,
      startDate: '2025-01-10', nextDate: _ds(1), tillsvidare: true, endDate: '',
      checklist: [
        { text: 'Bromstest – mät stoppavstånd' },
        { text: 'Smörj linor och styrskena' },
        { text: 'Kontrollera nödbelysning' },
        { text: 'Provkör hiss – alla våningar' },
        { text: 'Signera hissloggen' }
      ],
      status: 'aktiv', lastCreatedDate: _ds(-89),
      createdAt: '2025-01-10', updatedAt: _ds(-89)
    },
    {
      id: 'REC-003', title: 'Veckorondering Granitgatan 5',
      customerId: 'K-002', propertyId: 'OBJ-002', address: 'Granitgatan 5, 111 11 Stockholm',
      description: 'Veckovis rondering av fastigheten. Kontroll av gemensamma utrymmen, larm och belysning.',
      contactPerson: 'Peter Svensson', phone: '073-333 33 33', internalNote: '',
      priority: 'normal', priceType: 'fastpris', priceGroupId: '', fixedPrice: 950,
      staff: ['ST-002', 'ST-003'],
      interval: 'veckovis', intervalDays: 7,
      startDate: '2025-02-01', nextDate: _ds(2), tillsvidare: true, endDate: '',
      checklist: [
        { text: 'Kontroll källarentré och förråd' },
        { text: 'Kontroll ytterbelysning' },
        { text: 'Test brandlarmscentral' },
        { text: 'Kontroll parkeringsgarage' },
        { text: 'Notera avvikelser i ronderingslogg' }
      ],
      status: 'aktiv', lastCreatedDate: _ds(-7),
      createdAt: '2025-02-01', updatedAt: _ds(-7)
    },
    {
      id: 'REC-004', title: 'Halvårsservice BRF Björkdalen',
      customerId: 'K-004', propertyId: 'OBJ-003', address: 'Björkvägen 10B, 135 79 Järfälla',
      description: 'Halvårsvis teknisk genomgång av fastigheten. Fasadinspektionm, takavvattning, ventilation.',
      contactPerson: 'Gunnar Lindqvist', phone: '070-888 99 00', internalNote: '',
      priority: 'normal', priceType: 'fastpris', priceGroupId: '', fixedPrice: 5500,
      staff: ['ST-002', 'ST-003', 'ST-004'],
      interval: 'eget', intervalDays: 180,
      startDate: '2025-01-15', nextDate: _ds(5), tillsvidare: true, endDate: '',
      checklist: [
        { text: 'Fasadinspektion – notera sprickor' },
        { text: 'Takavvattning – rensa hängrännor' },
        { text: 'Ventilationskontroll alla plan' },
        { text: 'Kontrollera källarfukt' },
        { text: 'Rapport till styrelse' }
      ],
      status: 'aktiv', lastCreatedDate: _ds(-175),
      createdAt: '2025-01-15', updatedAt: _ds(-175)
    },
    {
      id: 'REC-005', title: 'Filterrensning ventilation – Handelshuset',
      customerId: 'K-007', propertyId: '', address: 'Handelsgatan 22, 103 12 Stockholm',
      description: 'Kvartalsmässig rensning och byte av luftfilter i ventilationsaggregat. 8 aggregat.',
      contactPerson: 'Caroline Björk', phone: '076-550 66 77', internalNote: 'Behöver lyftvagn. Aggregaten sitter högt.',
      priority: 'hög', priceType: 'fastpris', priceGroupId: '', fixedPrice: 7200,
      staff: ['ST-002'],
      interval: 'kvartalsvis', intervalDays: 90,
      startDate: _ds(-120), nextDate: _ds(12), tillsvidare: true, endDate: '',
      checklist: [
        { text: 'Byt filter aggregat 1–4' },
        { text: 'Byt filter aggregat 5–8' },
        { text: 'Rensa kondensatbrickor' },
        { text: 'Mäta luftflöde och luftkvalitet' }
      ],
      status: 'aktiv', lastCreatedDate: _ds(-78),
      createdAt: _ds(-120), updatedAt: _ds(-78)
    }
  ],

  invoices: [
    {
      id: 'INV-001', customerId: 'K-002', propertyId: 'OBJ-002',
      workOrderId: 'AO-014', offerId: '',
      lines: [
        { id: 'l1', description: 'Arbetstid elinstallation', qty: 6, unit: 'tim', unitPrice: 695, vatRate: 25, source: 'Tid', total: 4170 },
        { id: 'l2', description: 'Kabeldragning 25m CAT6A', qty: 25, unit: 'm', unitPrice: 28, vatRate: 25, source: 'Material', total: 700 },
        { id: 'l3', description: '8 st LED-spotlights Philips', qty: 8, unit: 'st', unitPrice: 485, vatRate: 25, source: 'Material', total: 3880 },
        { id: 'l4', description: '4 st eluttag + montering', qty: 4, unit: 'st', unitPrice: 320, vatRate: 25, source: 'Material', total: 1280 },
        { id: 'l5', description: 'Resekostnad', qty: 24, unit: 'km', unitPrice: 5, vatRate: 25, source: 'Övrigt', total: 120 }
      ],
      status: 'skickad', dueDate: _ds(15), paymentTerms: 30,
      note: 'Tack för uppdraget! Kontakta oss gärna för framtida service.',
      sentAt: _d(-15), paidAt: '',
      createdAt: _d(-17), updatedAt: _d(-15)
    },
    {
      id: 'INV-002', customerId: 'K-001', propertyId: 'OBJ-001',
      workOrderId: 'AO-005', offerId: '',
      lines: [
        { id: 'l1', description: 'Hissservice kvartalsvis – bromsar, linor, testköring', qty: 1, unit: 'fast pris', unitPrice: 2200, vatRate: 25, source: 'Fastpris', total: 2200 }
      ],
      status: 'betald', dueDate: _ds(-20), paymentTerms: 30,
      note: '', sentAt: _d(-40), paidAt: _d(-22),
      createdAt: _d(-42), updatedAt: _d(-22)
    },
    {
      id: 'INV-003', customerId: 'K-005', propertyId: '',
      workOrderId: 'AO-011', offerId: '',
      lines: [
        { id: 'l1', description: 'Byte golvbrunn inkl tätskiktskontroll', qty: 5, unit: 'tim', unitPrice: 695, vatRate: 25, source: 'Tid', total: 3475 },
        { id: 'l2', description: 'Golvbrunn plastrens', qty: 1, unit: 'st', unitPrice: 220, vatRate: 25, source: 'Material', total: 220 },
        { id: 'l3', description: 'Tätmassa och tillbehör', qty: 1, unit: 'st', unitPrice: 145, vatRate: 25, source: 'Material', total: 145 }
      ],
      status: 'utkast', dueDate: _ds(24), paymentTerms: 30,
      note: 'Arbete utfört ' + _ds(-6),
      sentAt: '', paidAt: '',
      createdAt: _d(-6), updatedAt: _d(-1)
    },
    {
      id: 'INV-004', customerId: 'K-003', propertyId: '',
      workOrderId: '', offerId: '',
      lines: [
        { id: 'l1', description: 'Altantvätt och impregnering 45m²', qty: 45, unit: 'm²', unitPrice: 85, vatRate: 25, source: 'Övrigt', total: 3825 },
        { id: 'l2', description: 'Fasadtvätt framsida', qty: 1, unit: 'fast pris', unitPrice: 1800, vatRate: 25, source: 'Fastpris', total: 1800 }
      ],
      status: 'förfallen', dueDate: _ds(-10), paymentTerms: 30,
      note: 'Påminnelse skickad 2 ggr. Kunden svarar ej.',
      sentAt: _d(-42), paidAt: '',
      createdAt: _d(-44), updatedAt: _d(-10)
    },
    {
      id: 'INV-005', customerId: 'K-005', propertyId: '',
      workOrderId: '', offerId: '',
      title: 'Badrumsrenovering',
      lines: [
        { id: 'l1', description: 'Rivning och bortforsling', qty: 1, unit: 'fast pris', unitPrice: 4500, vatRate: 25, source: 'Fastpris' },
        { id: 'l2', description: 'Kakelläggning 14m²', qty: 14, unit: 'm²', unitPrice: 650, vatRate: 25, source: 'Övrigt' },
        { id: 'l3', description: 'VVS-arbete (ROT-berättigat)', qty: 8, unit: 'tim', unitPrice: 695, vatRate: 25, source: 'Tid' },
        { id: 'l4', description: 'Material – kakelfix och fog', qty: 1, unit: 'st', unitPrice: 1280, vatRate: 25, source: 'Material' }
      ],
      status: 'utkast', dueDate: _ds(30), paymentTerms: 30,
      note: 'ROT-avdrag tillämpas för arbetstid (8 tim × 695 kr).',
      customerReference: 'Johan Lindström, Ekvägen 12',
      ocr: '',
      discount: { type: 'none', value: 0 },
      taxReduction: { type: 'rot', amount: 1668, basis: 5560, note: 'ROT 30% av arbete 5 560 kr' },
      sentAt: '', paidAt: '',
      createdAt: _d(-2), updatedAt: _d(-2)
    }
  ],

  timeEntries: [
    {
      id: 'TE-001', aoId: 'AO-001', staffId: 'ST-002', staffName: 'Erik Andersson',
      date: _ds(-1), startStr: '08:00', endStr: '12:00', minutes: 240,
      comment: 'Inspekterade balkong, identifierade ursprung vid balkongplatta',
      priceGroupId: 'PG-001', priceGroupName: 'Standard', hourRate: 695,
      billable: true, internal: false, createdAt: _d(-1)
    },
    {
      id: 'TE-002', aoId: 'AO-008', staffId: 'ST-005', staffName: 'Sofia Lindgren',
      date: _ds(0), startStr: '07:00', endStr: '12:00', minutes: 300,
      comment: 'Kabeldragning och installation belysning',
      priceGroupId: 'PG-001', priceGroupName: 'Standard', hourRate: 695,
      billable: true, internal: false, createdAt: _d(0)
    },
    {
      id: 'TE-003', aoId: 'AO-008', staffId: 'ST-002', staffName: 'Erik Andersson',
      date: _ds(0), startStr: '08:30', endStr: '12:00', minutes: 210,
      comment: 'Assisterade med kabelskarvning och test',
      priceGroupId: 'PG-001', priceGroupName: 'Standard', hourRate: 695,
      billable: true, internal: false, createdAt: _d(0)
    },
    {
      id: 'TE-004', aoId: 'AO-011', staffId: 'ST-004', staffName: 'Jonas Pettersson',
      date: _ds(-6), startStr: '09:00', endStr: '14:00', minutes: 300,
      comment: 'Byte golvbrunn och kontroll tätskikt',
      priceGroupId: 'PG-001', priceGroupName: 'Standard', hourRate: 695,
      billable: true, internal: false, createdAt: _d(-6)
    },
    {
      id: 'TE-005', aoId: 'AO-012', staffId: 'ST-004', staffName: 'Jonas Pettersson',
      date: _ds(-4), startStr: '08:00', endStr: '12:00', minutes: 240,
      comment: 'VVS-genomgång och tryckkontroll',
      priceGroupId: 'PG-001', priceGroupName: 'Standard', hourRate: 695,
      billable: true, internal: false, createdAt: _d(-4)
    },
    {
      id: 'TE-006', aoId: 'AO-012', staffId: 'ST-002', staffName: 'Erik Andersson',
      date: _ds(-4), startStr: '10:00', endStr: '15:00', minutes: 300,
      comment: 'Tätning av läckor och slutkontroll',
      priceGroupId: 'PG-001', priceGroupName: 'Standard', hourRate: 695,
      billable: true, internal: false, createdAt: _d(-4)
    }
  ],

  activityLog: [
    {
      id: 'ACT-001', type: 'work_order_created',
      description: 'Arbetsorder AO-015 skapad – Akut: Vattenläcka källare Parkgatan 8',
      timestamp: _d(0), customerId: 'K-006', workOrderId: 'AO-015',
      propertyId: 'OBJ-004', offerId: '', invoiceId: '', salesOpportunityId: '', userId: 'ST-001'
    },
    {
      id: 'ACT-002', type: 'work_order_created',
      description: 'Arbetsorder AO-003 skapad – Akut: Värmepump ur funktion Granitgatan 5',
      timestamp: _d(-0.2), customerId: 'K-002', workOrderId: 'AO-003',
      propertyId: 'OBJ-002', offerId: '', invoiceId: '', salesOpportunityId: '', userId: 'ST-001'
    },
    {
      id: 'ACT-003', type: 'sales_opportunity_created',
      description: 'Säljchans skapad – SLA-avtal Handelshuset',
      timestamp: _d(-1), customerId: 'K-007', workOrderId: '', propertyId: '',
      offerId: '', invoiceId: '', salesOpportunityId: 'SO-008', userId: 'ST-001'
    },
    {
      id: 'ACT-004', type: 'offer_sent',
      description: 'Offert OFF-004 skickad till BRF Parkgatan – 100 520 kr',
      timestamp: _d(-3), customerId: 'K-006', workOrderId: '', propertyId: '',
      offerId: 'OFF-004', invoiceId: '', salesOpportunityId: 'SO-007', userId: 'ST-001'
    },
    {
      id: 'ACT-005', type: 'work_order_completed',
      description: 'Arbetsorder AO-012 slutförd – VVS-service & tryckkontroll',
      timestamp: _d(-4), customerId: 'K-002', workOrderId: 'AO-012',
      propertyId: 'OBJ-002', offerId: '', invoiceId: '', salesOpportunityId: '', userId: 'ST-004'
    },
    {
      id: 'ACT-006', type: 'work_order_completed',
      description: 'Arbetsorder AO-011 slutförd – Byte golvbrunn & tätskikt',
      timestamp: _d(-6), customerId: 'K-005', workOrderId: 'AO-011',
      propertyId: '', offerId: '', invoiceId: '', salesOpportunityId: '', userId: 'ST-004'
    },
    {
      id: 'ACT-007', type: 'offer_answered',
      description: 'Offert OFF-003 accepterad av Fastighets AB Granit – Fasadrenovering',
      timestamp: _d(-5), customerId: 'K-002', workOrderId: '', propertyId: '',
      offerId: 'OFF-003', invoiceId: '', salesOpportunityId: 'SO-006', userId: 'ST-001'
    },
    {
      id: 'ACT-008', type: 'invoice_sent',
      description: 'Faktura INV-001 skickad till Fastighets AB Granit – 12 150 kr',
      timestamp: _d(-15), customerId: 'K-002', workOrderId: 'AO-014',
      propertyId: '', offerId: '', invoiceId: 'INV-001', salesOpportunityId: '', userId: 'ST-001'
    },
    {
      id: 'ACT-009', type: 'work_order_completed',
      description: 'Arbetsorder AO-002 slutförd – OVK-kontroll Hus A',
      timestamp: _d(-5), customerId: 'K-001', workOrderId: 'AO-002',
      propertyId: 'OBJ-001', offerId: '', invoiceId: '', salesOpportunityId: '', userId: 'ST-002'
    },
    {
      id: 'ACT-010', type: 'offer_sent',
      description: 'Offert OFF-001 skickad till BRF Björkdalen – 34 500 kr',
      timestamp: _d(-8), customerId: 'K-004', workOrderId: '', propertyId: '',
      offerId: 'OFF-001', invoiceId: '', salesOpportunityId: 'SO-002', userId: 'ST-001'
    },
    {
      id: 'ACT-011', type: 'invoice_paid',
      description: 'Faktura INV-002 betald av BRF Solgläntan – 2 200 kr',
      timestamp: _d(-22), customerId: 'K-001', workOrderId: '', propertyId: '',
      offerId: '', invoiceId: 'INV-002', salesOpportunityId: '', userId: 'ST-001'
    },
    {
      id: 'ACT-012', type: 'customer_created',
      description: 'Ny kund skapad – BRF Parkgatan',
      timestamp: _d(-30), customerId: 'K-006', workOrderId: '', propertyId: '',
      offerId: '', invoiceId: '', salesOpportunityId: '', userId: 'ST-001'
    },
    {
      id: 'ACT-013', type: 'customer_created',
      description: 'Ny kund skapad – Johan Lindström',
      timestamp: _d(-45), customerId: 'K-005', workOrderId: '', propertyId: '',
      offerId: '', invoiceId: '', salesOpportunityId: '', userId: 'ST-001'
    }
  ],

  contracts: [],
  inspections: [],

  ronderingsmallar: [
    {
      id: 'MALL-001',
      name: 'Standard BRF-rondering',
      customerId: '',
      propertyId: '',
      description: 'Komplett rondering för bostadsrättsföreningar med utomhus-, inomhus- och teknikkontroll.',
      interval: 'månadsvis',
      intervalDays: 30,
      active: true,
      categories: [
        {
          id: 'cat-1', name: 'Utomhusmiljö', sortOrder: 1,
          points: [
            { id: 'pt-1-1', title: 'Fasader', description: 'Kontrollera fasaders skick, sprickor, skador', requiresPhoto: false, canCreateAO: true, sortOrder: 1 },
            { id: 'pt-1-2', title: 'Belysning utomhus', description: 'Kontrollera att all utomhusbelysning fungerar', requiresPhoto: false, canCreateAO: true, sortOrder: 2 },
            { id: 'pt-1-3', title: 'Rent och snyggt', description: 'Skräp, ogräs, allmänt intryck', requiresPhoto: false, canCreateAO: false, sortOrder: 3 },
            { id: 'pt-1-4', title: 'Hårdgjorda ytor', description: 'Asfalt, plattor, gångar — sprickor eller ojämnheter', requiresPhoto: false, canCreateAO: true, sortOrder: 4 },
            { id: 'pt-1-5', title: 'Avfall/miljörum', description: 'Ordning i miljörum, kärl på plats', requiresPhoto: false, canCreateAO: false, sortOrder: 5 }
          ]
        },
        {
          id: 'cat-2', name: 'Inomhus', sortOrder: 2,
          points: [
            { id: 'pt-2-1', title: 'Entréer', description: 'Dörrautomatik, belysning, städning', requiresPhoto: false, canCreateAO: true, sortOrder: 1 },
            { id: 'pt-2-2', title: 'Trapphus', description: 'Lampor, städning, skador på väggar/golv', requiresPhoto: false, canCreateAO: true, sortOrder: 2 },
            { id: 'pt-2-3', title: 'Källare/förråd', description: 'Lås, belysning, ordning', requiresPhoto: false, canCreateAO: true, sortOrder: 3 },
            { id: 'pt-2-4', title: 'Soprum/miljörum inomhus', description: 'Sortering, lukt, skick', requiresPhoto: false, canCreateAO: false, sortOrder: 4 }
          ]
        },
        {
          id: 'cat-3', name: 'Teknik', sortOrder: 3,
          points: [
            { id: 'pt-3-1', title: 'Undercentral', description: 'Läckor, larm, tryck och temperatur', requiresPhoto: false, canCreateAO: true, sortOrder: 1 },
            { id: 'pt-3-2', title: 'Ventilation', description: 'Synliga filter, drift, ljudnivå', requiresPhoto: false, canCreateAO: true, sortOrder: 2 },
            { id: 'pt-3-3', title: 'Brand/SBA', description: 'Nödbelysning, brandvarnare, utrymningsvägar fria', requiresPhoto: true, canCreateAO: true, sortOrder: 3 },
            { id: 'pt-3-4', title: 'Lås/passersystem', description: 'Digitala lås, nyckelsystem, kodpaneler', requiresPhoto: false, canCreateAO: true, sortOrder: 4 }
          ]
        }
      ],
      createdAt: '2024-01-15T10:00:00.000Z',
      updatedAt: '2024-01-15T10:00:00.000Z',
      createdBy: 'ST-001'
    }
  ],

  ronderingar: [
    {
      id: 'RON-001',
      name: 'Månadsrondering BRF Solgläntan',
      templateId: 'MALL-001',
      templateName: 'Standard BRF-rondering',
      customerId: 'K-001',
      propertyId: '',
      description: '',
      internalNote: 'Genomförd utan problem. Två avvikelser noterade.',
      isDraft: false,
      images: [],
      categories: [
        {
          id: 'cat-1', name: 'Utomhusmiljö', sortOrder: 1,
          points: [
            { id: 'pt-1-1', title: 'Fasader', description: 'Kontrollera fasaders skick, sprickor, skador', requiresPhoto: false, canCreateAO: true, sortOrder: 1 },
            { id: 'pt-1-2', title: 'Belysning utomhus', description: 'Kontrollera att all utomhusbelysning fungerar', requiresPhoto: false, canCreateAO: true, sortOrder: 2 },
            { id: 'pt-1-3', title: 'Rent och snyggt', description: 'Skräp, ogräs, allmänt intryck', requiresPhoto: false, canCreateAO: false, sortOrder: 3 },
            { id: 'pt-1-4', title: 'Hårdgjorda ytor', description: 'Asfalt, plattor, gångar — sprickor eller ojämnheter', requiresPhoto: false, canCreateAO: true, sortOrder: 4 },
            { id: 'pt-1-5', title: 'Avfall/miljörum', description: 'Ordning i miljörum, kärl på plats', requiresPhoto: false, canCreateAO: false, sortOrder: 5 }
          ]
        },
        {
          id: 'cat-2', name: 'Inomhus', sortOrder: 2,
          points: [
            { id: 'pt-2-1', title: 'Entréer', description: 'Dörrautomatik, belysning, städning', requiresPhoto: false, canCreateAO: true, sortOrder: 1 },
            { id: 'pt-2-2', title: 'Trapphus', description: 'Lampor, städning, skador på väggar/golv', requiresPhoto: false, canCreateAO: true, sortOrder: 2 },
            { id: 'pt-2-3', title: 'Källare/förråd', description: 'Lås, belysning, ordning', requiresPhoto: false, canCreateAO: true, sortOrder: 3 },
            { id: 'pt-2-4', title: 'Soprum/miljörum inomhus', description: 'Sortering, lukt, skick', requiresPhoto: false, canCreateAO: false, sortOrder: 4 }
          ]
        },
        {
          id: 'cat-3', name: 'Teknik', sortOrder: 3,
          points: [
            { id: 'pt-3-1', title: 'Undercentral', description: 'Läckor, larm, tryck och temperatur', requiresPhoto: false, canCreateAO: true, sortOrder: 1 },
            { id: 'pt-3-2', title: 'Ventilation', description: 'Synliga filter, drift, ljudnivå', requiresPhoto: false, canCreateAO: true, sortOrder: 2 },
            { id: 'pt-3-3', title: 'Brand/SBA', description: 'Nödbelysning, brandvarnare, utrymningsvägar fria', requiresPhoto: true, canCreateAO: true, sortOrder: 3 },
            { id: 'pt-3-4', title: 'Lås/passersystem', description: 'Digitala lås, nyckelsystem, kodpaneler', requiresPhoto: false, canCreateAO: true, sortOrder: 4 }
          ]
        }
      ],
      occasions: [],
      recurringSetups: [],
      pricingType: 'tim',
      priceGroupId: 'PG-001',
      priceGroupName: 'Standard',
      hourRate: 695,
      fixedPrice: 0,
      debiterbar: true,
      status: 'har_avvikelser',
      performedBy: 'ST-002',
      performedByName: 'Erik Andersson',
      startedAt: _ds(-7) + 'T09:00:00.000Z',
      completedAt: _ds(-7) + 'T10:30:00.000Z',
      results: [
        {
          categoryId: 'cat-1', categoryName: 'Utomhusmiljö',
          points: [
            { pointId: 'pt-1-1', pointTitle: 'Fasader', status: 'ok', comment: '', deviationId: null, checkedAt: _ds(-7) + 'T09:10:00.000Z' },
            { pointId: 'pt-1-2', pointTitle: 'Belysning utomhus', status: 'avvikelse', comment: '', deviationId: 'AVV-001', checkedAt: _ds(-7) + 'T09:15:00.000Z' },
            { pointId: 'pt-1-3', pointTitle: 'Rent och snyggt', status: 'ok', comment: '', deviationId: null, checkedAt: _ds(-7) + 'T09:20:00.000Z' },
            { pointId: 'pt-1-4', pointTitle: 'Hårdgjorda ytor', status: 'ok', comment: '', deviationId: null, checkedAt: _ds(-7) + 'T09:25:00.000Z' },
            { pointId: 'pt-1-5', pointTitle: 'Avfall/miljörum', status: 'ok', comment: '', deviationId: null, checkedAt: _ds(-7) + 'T09:30:00.000Z' }
          ]
        },
        {
          categoryId: 'cat-2', categoryName: 'Inomhus',
          points: [
            { pointId: 'pt-2-1', pointTitle: 'Entréer', status: 'ok', comment: '', deviationId: null, checkedAt: _ds(-7) + 'T09:40:00.000Z' },
            { pointId: 'pt-2-2', pointTitle: 'Trapphus', status: 'avvikelse', comment: '', deviationId: 'AVV-002', checkedAt: _ds(-7) + 'T09:45:00.000Z' },
            { pointId: 'pt-2-3', pointTitle: 'Källare/förråd', status: 'ok', comment: '', deviationId: null, checkedAt: _ds(-7) + 'T09:50:00.000Z' },
            { pointId: 'pt-2-4', pointTitle: 'Soprum/miljörum inomhus', status: 'ej_aktuell', comment: 'Soprum renoveras', deviationId: null, checkedAt: _ds(-7) + 'T09:55:00.000Z' }
          ]
        },
        {
          categoryId: 'cat-3', categoryName: 'Teknik',
          points: [
            { pointId: 'pt-3-1', pointTitle: 'Undercentral', status: 'ok', comment: '', deviationId: null, checkedAt: _ds(-7) + 'T10:05:00.000Z' },
            { pointId: 'pt-3-2', pointTitle: 'Ventilation', status: 'ok', comment: '', deviationId: null, checkedAt: _ds(-7) + 'T10:10:00.000Z' },
            { pointId: 'pt-3-3', pointTitle: 'Brand/SBA', status: 'ok', comment: '', deviationId: null, checkedAt: _ds(-7) + 'T10:15:00.000Z' },
            { pointId: 'pt-3-4', pointTitle: 'Lås/passersystem', status: 'ok', comment: '', deviationId: null, checkedAt: _ds(-7) + 'T10:20:00.000Z' }
          ]
        }
      ],
      deviationIds: ['AVV-001', 'AVV-002'],
      createdAt: _ds(-8) + 'T08:00:00.000Z',
      updatedAt: _ds(-7) + 'T10:30:00.000Z'
    },
    {
      id: 'RON-002',
      name: 'Månadsrondering BRF Solgläntan',
      templateId: 'MALL-001',
      templateName: 'Standard BRF-rondering',
      customerId: 'K-001',
      propertyId: '',
      description: '',
      internalNote: '',
      isDraft: false,
      images: [],
      categories: [
        {
          id: 'cat-1', name: 'Utomhusmiljö', sortOrder: 1,
          points: [
            { id: 'pt-1-1', title: 'Fasader', description: 'Kontrollera fasaders skick, sprickor, skador', requiresPhoto: false, canCreateAO: true, sortOrder: 1 },
            { id: 'pt-1-2', title: 'Belysning utomhus', description: 'Kontrollera att all utomhusbelysning fungerar', requiresPhoto: false, canCreateAO: true, sortOrder: 2 },
            { id: 'pt-1-3', title: 'Rent och snyggt', description: 'Skräp, ogräs, allmänt intryck', requiresPhoto: false, canCreateAO: false, sortOrder: 3 },
            { id: 'pt-1-4', title: 'Hårdgjorda ytor', description: 'Asfalt, plattor, gångar — sprickor eller ojämnheter', requiresPhoto: false, canCreateAO: true, sortOrder: 4 },
            { id: 'pt-1-5', title: 'Avfall/miljörum', description: 'Ordning i miljörum, kärl på plats', requiresPhoto: false, canCreateAO: false, sortOrder: 5 }
          ]
        },
        {
          id: 'cat-2', name: 'Inomhus', sortOrder: 2,
          points: [
            { id: 'pt-2-1', title: 'Entréer', description: 'Dörrautomatik, belysning, städning', requiresPhoto: false, canCreateAO: true, sortOrder: 1 },
            { id: 'pt-2-2', title: 'Trapphus', description: 'Lampor, städning, skador på väggar/golv', requiresPhoto: false, canCreateAO: true, sortOrder: 2 },
            { id: 'pt-2-3', title: 'Källare/förråd', description: 'Lås, belysning, ordning', requiresPhoto: false, canCreateAO: true, sortOrder: 3 },
            { id: 'pt-2-4', title: 'Soprum/miljörum inomhus', description: 'Sortering, lukt, skick', requiresPhoto: false, canCreateAO: false, sortOrder: 4 }
          ]
        },
        {
          id: 'cat-3', name: 'Teknik', sortOrder: 3,
          points: [
            { id: 'pt-3-1', title: 'Undercentral', description: 'Läckor, larm, tryck och temperatur', requiresPhoto: false, canCreateAO: true, sortOrder: 1 },
            { id: 'pt-3-2', title: 'Ventilation', description: 'Synliga filter, drift, ljudnivå', requiresPhoto: false, canCreateAO: true, sortOrder: 2 },
            { id: 'pt-3-3', title: 'Brand/SBA', description: 'Nödbelysning, brandvarnare, utrymningsvägar fria', requiresPhoto: true, canCreateAO: true, sortOrder: 3 },
            { id: 'pt-3-4', title: 'Lås/passersystem', description: 'Digitala lås, nyckelsystem, kodpaneler', requiresPhoto: false, canCreateAO: true, sortOrder: 4 }
          ]
        }
      ],
      occasions: [{id: 'occ-1', date: _ds(7), time: '09:00', staffId: 'ST-002', staffName: 'Erik Andersson', comment: ''}],
      recurringSetups: [{id: 'rec-1', interval: 'månadsvis', intervalDays: 30, startDate: _ds(-1), endDate: '', tillsvidare: true, weekday: '', dayOfMonth: '1', staffId: 'ST-002', staffName: 'Erik Andersson'}],
      pricingType: 'tim',
      priceGroupId: 'PG-001',
      priceGroupName: 'Standard',
      hourRate: 695,
      fixedPrice: 0,
      debiterbar: true,
      status: 'planerad',
      performedBy: 'ST-002',
      performedByName: 'Erik Andersson',
      startedAt: '',
      completedAt: '',
      results: [],
      deviationIds: [],
      createdAt: _ds(-1) + 'T08:00:00.000Z',
      updatedAt: _ds(-1) + 'T08:00:00.000Z'
    }
  ],

  avvikelser: [
    {
      id: 'AVV-001',
      ronderingId: 'RON-001',
      categoryId: 'cat-1',
      pointId: 'pt-1-2',
      categoryName: 'Utomhusmiljö',
      pointTitle: 'Belysning utomhus',
      customerId: 'K-001',
      propertyId: '',
      title: 'Trasig belysning vid entré B',
      comment: 'Armatur blinkar vid entré B, troligtvis dålig ström eller trasig ljuskälla.',
      images: [],
      priority: 'normal',
      status: 'öppen',
      workOrderId: '',
      createdBy: 'ST-002',
      createdByName: 'Erik Andersson',
      createdAt: _ds(-7) + 'T09:15:00.000Z',
      updatedAt: _ds(-7) + 'T09:15:00.000Z'
    },
    {
      id: 'AVV-002',
      ronderingId: 'RON-001',
      categoryId: 'cat-2',
      pointId: 'pt-2-2',
      categoryName: 'Inomhus',
      pointTitle: 'Trapphus',
      customerId: 'K-001',
      propertyId: '',
      title: 'Skada på vägg trapphus plan 3',
      comment: 'Hål i väggen, troligen uppkört av möbel vid flytt.',
      images: [],
      priority: 'låg',
      status: 'öppen',
      workOrderId: '',
      createdBy: 'ST-002',
      createdByName: 'Erik Andersson',
      createdAt: _ds(-7) + 'T09:45:00.000Z',
      updatedAt: _ds(-7) + 'T09:45:00.000Z'
    }
  ],

  titles: [
    { id:'TIT-001', name:'Fastighetstekniker', description:'Ansvarar för teknisk drift och underhåll av fastigheter.', active:true, createdAt:'2024-01-01T00:00:00.000Z', updatedAt:'2024-01-01T00:00:00.000Z' },
    { id:'TIT-002', name:'Rörmokare',          description:'Utför rörinstallationer och VVS-arbeten.',                active:true, createdAt:'2024-01-01T00:00:00.000Z', updatedAt:'2024-01-01T00:00:00.000Z' },
    { id:'TIT-003', name:'Elektriker',         description:'Utför elinstallationer och elarbeten.',                  active:true, createdAt:'2024-01-01T00:00:00.000Z', updatedAt:'2024-01-01T00:00:00.000Z' },
    { id:'TIT-004', name:'Projektledare',      description:'Leder och koordinerar projekt och arbetslag.',            active:true, createdAt:'2024-01-01T00:00:00.000Z', updatedAt:'2024-01-01T00:00:00.000Z' },
    { id:'TIT-005', name:'Förvaltare',         description:'Ansvarar för förvaltning av fastigheter och kunder.',    active:true, createdAt:'2024-01-01T00:00:00.000Z', updatedAt:'2024-01-01T00:00:00.000Z' },
    { id:'TIT-006', name:'Städare',            description:'Utför städtjänster och lokalvård.',                      active:true, createdAt:'2024-01-01T00:00:00.000Z', updatedAt:'2024-01-01T00:00:00.000Z' },
    { id:'TIT-007', name:'Snickare',           description:'Utför snickeri- och byggnadsarbeten.',                   active:true, createdAt:'2024-01-01T00:00:00.000Z', updatedAt:'2024-01-01T00:00:00.000Z' },
    { id:'TIT-008', name:'Målare',             description:'Utför målnings- och ytbehandlingsarbeten.',              active:true, createdAt:'2024-01-01T00:00:00.000Z', updatedAt:'2024-01-01T00:00:00.000Z' },
    { id:'TIT-009', name:'Drifttekniker',      description:'Hanterar driftsäkerhet och tekniska system.',            active:true, createdAt:'2024-01-01T00:00:00.000Z', updatedAt:'2024-01-01T00:00:00.000Z' },
    { id:'TIT-010', name:'Väktare',            description:'Bevakning och säkerhetsarbete.',                         active:true, createdAt:'2024-01-01T00:00:00.000Z', updatedAt:'2024-01-01T00:00:00.000Z' },
    { id:'TIT-011', name:'Larmtekniker',       description:'Installation och service av larmsystem.',                active:true, createdAt:'2024-01-01T00:00:00.000Z', updatedAt:'2024-01-01T00:00:00.000Z' },
    { id:'TIT-012', name:'Låssmed',            description:'Installation och service av lås och passersystem.',      active:true, createdAt:'2024-01-01T00:00:00.000Z', updatedAt:'2024-01-01T00:00:00.000Z' },
    { id:'TIT-013', name:'VVS-tekniker',       description:'Specialiserad VVS-kompetens.',                           active:true, createdAt:'2024-01-01T00:00:00.000Z', updatedAt:'2024-01-01T00:00:00.000Z' },
    { id:'TIT-014', name:'Fastighetsskötare',  description:'Allmän skötsel och tillsyn av fastigheter.',             active:true, createdAt:'2024-01-01T00:00:00.000Z', updatedAt:'2024-01-01T00:00:00.000Z' },
    { id:'TIT-015', name:'Systemadministratör',description:'Administrerar IT-system och CRM.',                       active:true, createdAt:'2024-01-01T00:00:00.000Z', updatedAt:'2024-01-01T00:00:00.000Z' }
  ],

  roles: [
    {
      id: 'admin', label: 'Admin', isBuiltin: true, active: true,
      description: 'Full tillgång till alla funktioner och inställningar.',
      permissions: ['all']
    },
    {
      id: 'chef', label: 'Chef / Projektledare', isBuiltin: true, active: true,
      description: 'Kan hantera arbetsorder, kunder, offerter och se rapporter. Kan ej ändra systeminställningar.',
      permissions: ['dashboard_view','ao_view_all','ao_create','ao_edit','ao_complete','customer_manage','offer_manage','invoice_view','invoice_create','staff_view','reports_view','sales_manage','recurring_manage']
    },
    {
      id: 'personal', label: 'Tekniker / Personal', isBuiltin: true, active: true,
      description: 'Kan se egna tilldelade arbetsorder och pool. Kan registrera tid och material.',
      permissions: ['dashboard_view','ao_view_own','ao_time','ao_material','ao_checklist']
    },
    {
      id: 'ekonomi', label: 'Ekonomi', isBuiltin: true, active: true,
      description: 'Hanterar fakturering, rapporter och löneunderlag. Kan inte hantera personal eller systeminställningar.',
      permissions: ['dashboard_view','ao_view_all','invoice_view','invoice_create','reports_view']
    }
  ],

  articles: [
    // ── Kemikalier ──────────────────────────────────────────
    { id: 'ART-001', articleNumber: '1001', name: 'Fogmassa Sikaflex 291i',     category: 'kemikalier', unit: 'st',    buyPrice: 75,   sellPrice: 145,  vatRate: 25, active: true },
    { id: 'ART-002', articleNumber: '1002', name: 'Silikon transparent 300ml',  category: 'kemikalier', unit: 'st',    buyPrice: 45,   sellPrice: 89,   vatRate: 25, active: true },
    { id: 'ART-010', articleNumber: '1010', name: 'Avfettning 1L',              category: 'kemikalier', unit: 'st',    buyPrice: 55,   sellPrice: 110,  vatRate: 25, active: true },
    { id: 'ART-011', articleNumber: '1011', name: 'Rostskyddsfärg 0,5L',        category: 'kemikalier', unit: 'st',    buyPrice: 120,  sellPrice: 245,  vatRate: 25, active: true },
    { id: 'ART-012', articleNumber: '1012', name: 'Fogskum PU 750ml',           category: 'kemikalier', unit: 'st',    buyPrice: 68,   sellPrice: 135,  vatRate: 25, active: true },
    { id: 'ART-013', articleNumber: '1013', name: 'Akrylspackel 300ml',         category: 'kemikalier', unit: 'st',    buyPrice: 38,   sellPrice: 75,   vatRate: 25, active: true },

    // ── Byggmaterial ────────────────────────────────────────
    { id: 'ART-003', articleNumber: '1020', name: 'Skruv 6×50 (förpackning 50st)', category: 'material', unit: 'förp.', buyPrice: 38, sellPrice: 72,  vatRate: 25, active: true },
    { id: 'ART-004', articleNumber: '1021', name: 'Expansionsbult M8×60',       category: 'material', unit: 'st',    buyPrice: 10,   sellPrice: 25,   vatRate: 25, active: true },
    { id: 'ART-005', articleNumber: '1022', name: 'Rörkoppling 15mm',           category: 'material', unit: 'st',    buyPrice: 32,   sellPrice: 68,   vatRate: 25, active: true },
    { id: 'ART-014', articleNumber: '1023', name: 'Kopplingsrör 22mm × 1m',     category: 'material', unit: 'st',    buyPrice: 85,   sellPrice: 165,  vatRate: 25, active: true },
    { id: 'ART-015', articleNumber: '1024', name: 'Kulventil 15mm',             category: 'material', unit: 'st',    buyPrice: 95,   sellPrice: 195,  vatRate: 25, active: true },
    { id: 'ART-016', articleNumber: '1025', name: 'Golvbrunn plastrens',        category: 'material', unit: 'st',    buyPrice: 110,  sellPrice: 220,  vatRate: 25, active: true },
    { id: 'ART-017', articleNumber: '1026', name: 'Drevmassa branddrev 10m',    category: 'material', unit: 'rul',   buyPrice: 145,  sellPrice: 290,  vatRate: 25, active: true },
    { id: 'ART-018', articleNumber: '1027', name: 'Gummitätning 20mm × 5m',    category: 'material', unit: 'rul',   buyPrice: 55,   sellPrice: 110,  vatRate: 25, active: true },

    // ── Förbrukningsmaterial ────────────────────────────────
    { id: 'ART-006', articleNumber: '1030', name: 'Plastfilm skyddsfilm 4m',    category: 'forbruk', unit: 'm',     buyPrice: 6,    sellPrice: 15,   vatRate: 25, active: true },
    { id: 'ART-019', articleNumber: '1031', name: 'Maskeringstejp 50mm',        category: 'forbruk', unit: 'rul',   buyPrice: 22,   sellPrice: 45,   vatRate: 25, active: true },
    { id: 'ART-020', articleNumber: '1032', name: 'Kabelstrumpa 10m',           category: 'forbruk', unit: 'st',    buyPrice: 35,   sellPrice: 70,   vatRate: 25, active: true },
    { id: 'ART-021', articleNumber: '1033', name: 'Engångshandskar (100-pack)', category: 'forbruk', unit: 'förp.', buyPrice: 45,  sellPrice: 90,   vatRate: 25, active: true },
    { id: 'ART-022', articleNumber: '1034', name: 'Sliprondell 125mm (10-pack)',category: 'forbruk', unit: 'förp.', buyPrice: 65,  sellPrice: 130,  vatRate: 25, active: true },

    // ── Arbete ──────────────────────────────────────────────
    { id: 'ART-007', articleNumber: '2001', name: 'Arbetstid standard',         category: 'arbete',  unit: 'tim',   buyPrice: 0,    sellPrice: 695,  vatRate: 25, active: true },
    { id: 'ART-008', articleNumber: '2002', name: 'Akut/jourarbetstid',         category: 'arbete',  unit: 'tim',   buyPrice: 0,    sellPrice: 1250, vatRate: 25, active: true },
    { id: 'ART-023', articleNumber: '2003', name: 'Övertid (OB)',               category: 'arbete',  unit: 'tim',   buyPrice: 0,    sellPrice: 895,  vatRate: 25, active: true },
    { id: 'ART-024', articleNumber: '2004', name: 'Helgtid',                    category: 'arbete',  unit: 'tim',   buyPrice: 0,    sellPrice: 995,  vatRate: 25, active: true },

    // ── Kostnader ───────────────────────────────────────────
    { id: 'ART-009', articleNumber: '3001', name: 'Resekostnad km',             category: 'kostnad', unit: 'km',    buyPrice: 0,   sellPrice: 5,    vatRate: 25, active: true },
    { id: 'ART-025', articleNumber: '3002', name: 'Parkeringskostnad',          category: 'kostnad', unit: 'st',    buyPrice: 0,   sellPrice: 0,    vatRate: 25, active: true },
    { id: 'ART-026', articleNumber: '3003', name: 'Utrustning/verktyg hyra',    category: 'kostnad', unit: 'dag',   buyPrice: 0,   sellPrice: 0,    vatRate: 25, active: true },
  ],

  serviceTemplates: [
    {
      id:'svc_altan', name:'Altantvätt', icon:'refresh-cw', category:'Tvätt & rengöring',
      active:true, sortOrder:10, unit:'m²', vatRate:25, defaultReduction:'rut',
      minChargeExVat:1800, pricingModel:'tiered_unit', qtyField:'area', basePricePerUnit:null,
      tiers:[
        {from:0,  to:30,   priceExVat:120},
        {from:31, to:60,   priceExVat:110},
        {from:61, to:100,  priceExVat:100},
        {from:101,to:150,  priceExVat:90},
        {from:151,to:null, priceExVat:80}
      ],
      factors:{},
      options:[
        {id:'algae',     name:'Algbehandling',               type:'per_unit', priceExVat:15},
        {id:'stairs',    name:'Trappsteg tillägg',           type:'fixed',    priceExVat:450},
        {id:'treatment', name:'Impregnering/efterbehandling', type:'per_unit', priceExVat:18},
        {id:'disposal',  name:'Bortforsling',                type:'fixed',    priceExVat:750},
        {id:'furniture', name:'Flytt av möbler',             type:'fixed',    priceExVat:350}
      ],
      fields:[
        {id:'area',      label:'Yta (m²)',       type:'number', req:true},
        {id:'material',  label:'Material/typ',   type:'chips',  opts:['Trä / Komposit','Betong','Natursten','Tegel','Annat'], def:'Trä / Komposit'},
        {id:'dirt',      label:'Smutsnivå',      type:'chips',  opts:['Lätt','Måttlig','Kraftig'], def:'Måttlig'},
        {id:'algae',     label:'Algbehandling',  type:'bool',   addLabel:'Algbehandling (+15 kr/m²)'},
        {id:'stairs',    label:'Trappsteg',      type:'bool',   addLabel:'Trappsteg (+450 kr/st)'},
        {id:'treatment', label:'Efterbehandling',type:'bool',   addLabel:'Impregnering (+18 kr/m²)'},
        {id:'disposal',  label:'Bortforsling',   type:'bool',   addLabel:'Bortforsling (+750 kr)'},
        {id:'furniture', label:'Flytt av möbler',type:'bool',   addLabel:'Flytt av möbler (+350 kr)'}
      ],
      defaultDescription:'Altantvätt inkl. rengöring, avfettning och behandling.',
      includes:['Rengöringsmedel och förberedelse','Grundtvätt och avfettning','Uppsamling av grovsmuts'],
      excludes:['Reparationer och utbyte av material','Målning och ytbehandling'],
      internalNote:''
    },
    {
      id:'svc_sten', name:'Stentvätt', icon:'layers', category:'Tvätt & rengöring',
      active:true, sortOrder:20, unit:'m²', vatRate:25, defaultReduction:'rot',
      minChargeExVat:1800, pricingModel:'tiered_unit', qtyField:'area', basePricePerUnit:null,
      tiers:[
        {from:0,  to:30,   priceExVat:95},
        {from:31, to:60,   priceExVat:85},
        {from:61, to:100,  priceExVat:75},
        {from:101,to:150,  priceExVat:65},
        {from:151,to:null, priceExVat:55}
      ],
      factors:{},
      options:[
        {id:'weeds',        name:'Ogräs- och algbehandling', type:'per_unit', priceExVat:15},
        {id:'jointing',     name:'Fogsandning',              type:'per_unit', priceExVat:25},
        {id:'impregnation', name:'Impregnering',             type:'per_unit', priceExVat:28},
        {id:'disposal',     name:'Bortforsling',             type:'fixed',    priceExVat:750}
      ],
      fields:[
        {id:'area',         label:'Yta (m²)',    type:'number', req:true},
        {id:'material',     label:'Stentyp',     type:'chips',  opts:['Betongplattor','Natursten','Klinker','Asfalt','Annat'], def:'Betongplattor'},
        {id:'dirt',         label:'Smutsnivå',   type:'chips',  opts:['Lätt','Måttlig','Kraftig'], def:'Måttlig'},
        {id:'weeds',        label:'Ogräs/alger', type:'bool',   addLabel:'Ogräs- och algbehandling (+15 kr/m²)'},
        {id:'jointing',     label:'Fogsandning', type:'bool',   addLabel:'Fogsandning (+25 kr/m²)'},
        {id:'impregnation', label:'Impregnering',type:'bool',   addLabel:'Impregnering (+28 kr/m²)'},
        {id:'disposal',     label:'Bortforsling',type:'bool',   addLabel:'Bortforsling (+750 kr)'}
      ],
      defaultDescription:'Högtryckstvätt av stenläggning, plattor och markytor.',
      includes:['Högtryckstvätt','Rengöringsmedel','Uppsamling av smuts'],
      excludes:['Fogsandning (tillval)','Impregnering (tillval)'],
      internalNote:''
    },
    {
      id:'svc_hack', name:'Häckklippning', icon:'scissors', category:'Utemiljö',
      active:true, sortOrder:30, unit:'lm', vatRate:25, defaultReduction:'rut',
      minChargeExVat:1200, pricingModel:'factor_lm', qtyField:'length', basePricePerUnit:55,
      tiers:[],
      factors:{
        height:{'≤ 1 m':1.0,'1–2 m':1.35,'2–3 m':1.75,'> 3 m':2.2},
        sides:{'1 sida':1.0,'2 sidor':1.8,'3 sidor':2.5},
        difficulty:{'Normal':1.0,'Svår (tät/gammal)':1.3}
      },
      options:[
        {id:'disposal', name:'Bortforsling klippt material', type:'fixed', priceExVat:650}
      ],
      fields:[
        {id:'length',     label:'Löpmeter häck',   type:'number', req:true},
        {id:'height',     label:'Höjd',            type:'chips',  opts:['≤ 1 m','1–2 m','2–3 m','> 3 m'], def:'1–2 m'},
        {id:'sides',      label:'Antal sidor',     type:'chips',  opts:['1 sida','2 sidor','3 sidor'], def:'2 sidor'},
        {id:'difficulty', label:'Svårighet',       type:'chips',  opts:['Normal','Svår (tät/gammal)'], def:'Normal'},
        {id:'disposal',   label:'Bortforsling',    type:'bool',   addLabel:'Bortforsling (+650 kr)'}
      ],
      defaultDescription:'Klippning av häck inkl. uppsamling av klippt material.',
      includes:['Klippning av häck','Uppsamling av klippt material','Städning av arbetsområde'],
      excludes:['Bortforsling (tillval)','Plantering'],
      internalNote:'Ca 3 min/lm = 20 lm/tim. Timpris styrs av vald prisgrupp.'
    },
    {
      id:'svc_fasad', name:'Fasadtvätt', icon:'building-2', category:'Tvätt & rengöring',
      active:true, sortOrder:40, unit:'m²', vatRate:25, defaultReduction:'rot',
      minChargeExVat:3000, pricingModel:'factor_unit', qtyField:'area', basePricePerUnit:60,
      tiers:[],
      factors:{
        floors:{'1 vån':1.0,'2 vån':1.25,'3 vån':1.583,'4+ vån':2.0}
      },
      options:[
        {id:'algae',    name:'Algbehandling',       type:'per_unit', priceExVat:15},
        {id:'softwash', name:'Softwash-behandling', type:'per_unit', priceExVat:18},
        {id:'lift',     name:'Lift / ställning',    type:'fixed',    priceExVat:4500},
        {id:'disposal', name:'Bortforsling',        type:'fixed',    priceExVat:750}
      ],
      fields:[
        {id:'area',     label:'Fasadyta (m²)',  type:'number', req:true},
        {id:'floors',   label:'Antal våningar', type:'chips',  opts:['1 vån','2 vån','3 vån','4+ vån'], def:'2 vån'},
        {id:'material', label:'Fasadmaterial',  type:'chips',  opts:['Puts / Betong','Tegel','Träpanel','Plåt','Annat'], def:'Puts / Betong'},
        {id:'algae',    label:'Algbehandling',  type:'bool',   addLabel:'Algbehandling (+15 kr/m²)'},
        {id:'softwash', label:'Softwash',       type:'bool',   addLabel:'Softwash-behandling (+18 kr/m²)'},
        {id:'lift',     label:'Lift/ställning', type:'bool',   addLabel:'Lift / ställning (+4 500 kr)'},
        {id:'disposal', label:'Bortforsling',   type:'bool',   addLabel:'Bortforsling (+750 kr)'}
      ],
      defaultDescription:'Fasadtvätt inkl. förberedelse, tvätt och skyddsåtgärder.',
      includes:['Högtryckstvätt och rengöring','Skyddsövertäckning av fönster och mark','Rengöringsmedel'],
      excludes:['Ställning (tillval)','Målning','Reparationer'],
      internalNote:'4+ våningar: faktorn är 2.0 = 120 kr/m². Vid komplex ställning, överväg manuell offert.'
    },
    {
      id:'svc_fs', name:'Fastighetsservice', icon:'wrench', category:'Service & förvaltning',
      active:true, sortOrder:50, unit:'tim', vatRate:25, defaultReduction:'ingen',
      minChargeExVat:0, pricingModel:'hourly', qtyField:'hours', basePricePerUnit:430,
      tiers:[], factors:{}, options:[],
      fields:[
        {id:'priceGroupId', label:'Prisgrupp',              type:'pricegroup', def:'PG-002'},
        {id:'type',         label:'Avtalstyp',              type:'chips',  opts:['Månadsavtal','Kvartal','Engångsuppdrag'], def:'Engångsuppdrag'},
        {id:'hours',        label:'Timmar per period',      type:'number', req:true},
        {id:'periods',      label:'Antal perioder',         type:'number', def:1},
        {id:'rate',         label:'Timpris ex moms (kr/h)', type:'number', def:430},
        {id:'material',     label:'Material (kr)',          type:'number'}
      ],
      defaultDescription:'Fastighetsservice och skötsel enligt överenskommelse.',
      includes:['Löpande service och underhåll','Dokumentation av utfört arbete'],
      excludes:['Specialisttjänster (el, VVS, hiss)','Material utöver angiven summa'],
      internalNote:''
    },
    {
      id:'svc_tf', name:'Teknisk förvaltning', icon:'settings', category:'Service & förvaltning',
      active:true, sortOrder:60, unit:'mån', vatRate:25, defaultReduction:'ingen',
      minChargeExVat:0, pricingModel:'monthly', qtyField:'months', basePricePerUnit:0,
      tiers:[], factors:{},
      options:[
        {id:'ovk', name:'OVK-besiktning inkl. protokoll', type:'fixed', priceExVat:3500}
      ],
      fields:[
        {id:'months',  label:'Antal månader',         type:'number', req:true, def:12},
        {id:'monthly', label:'Månadsavgift ex moms',  type:'number', req:true},
        {id:'setup',   label:'Uppstartskostnad (kr)',  type:'number'},
        {id:'ovk',     label:'OVK ingår',             type:'bool',   addLabel:'OVK-besiktning inkl. protokoll (+3 500 kr)'}
      ],
      defaultDescription:'Teknisk förvaltning av fastighet enligt förvaltningsavtal.',
      includes:['Teknisk rådgivning','Tillsyn och rondering','Koordinering av underhåll'],
      excludes:['Akutarbeten utöver avtal','Specialisttjänster'],
      internalNote:''
    },
    {
      id:'svc_ovr', name:'Övrigt arbete', icon:'activity', category:'Övrigt',
      active:true, sortOrder:70, unit:'tim', vatRate:25, defaultReduction:'ingen',
      minChargeExVat:0, pricingModel:'hourly_custom', qtyField:'qty', basePricePerUnit:430,
      tiers:[], factors:{}, options:[],
      fields:[
        {id:'desc_svc', label:'Benämning',              type:'text',   req:true},
        {id:'qty',      label:'Antal timmar',           type:'number', req:true},
        {id:'rate',     label:'Timpris ex moms (kr/h)', type:'number', def:430},
        {id:'material', label:'Material (kr)',          type:'number'}
      ],
      defaultDescription:'Arbete på löpande räkning.',
      includes:[], excludes:[], internalNote:''
    }
  ]
};
