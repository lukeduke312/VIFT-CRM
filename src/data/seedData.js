/**
 * seedData.js — Demo-data för att systemet ska se levande ut
 */

const SeedData = {

  settings: {
    companyName: 'VIFT Fastighetsservice & Förvaltning',
    companyPhone: '070-123 45 67',
    companyEmail: 'info@vift.se',
    companyAddress: 'Storgatan 12, 123 45 Stockholm',
    orgNr: '556XXX-XXXX',
    vatNr: 'SE556XXXXXX01',
    defaultVatRate: 25,
    defaultPaymentTerms: 30,
    invoicePrefix: 'F-',
    currentUser: null
  },

  staff: [
    {
      id: 'ST-001',
      firstName: 'Admin',
      lastName: 'VIFT',
      title: 'Systemadministratör',
      phone: '070-000 00 01',
      email: 'admin@vift.se',
      username: 'admin',
      password: '1234',
      role: 'admin',
      permissions: ['all'],
      active: true,
      createdAt: '2024-01-01'
    },
    {
      id: 'ST-002',
      firstName: 'Erik',
      lastName: 'Andersson',
      title: 'Fastighetstekniker',
      phone: '070-111 22 33',
      email: 'erik@vift.se',
      username: 'erik',
      password: '1234',
      role: 'personal',
      permissions: [],
      active: true,
      createdAt: '2024-01-15'
    },
    {
      id: 'ST-003',
      firstName: 'Maria',
      lastName: 'Karlsson',
      title: 'Projektledare',
      phone: '070-444 55 66',
      email: 'maria@vift.se',
      username: 'maria',
      password: '1234',
      role: 'chef',
      permissions: [],
      active: true,
      createdAt: '2024-02-01'
    }
  ],

  customers: [
    {
      id: 'K-001',
      type: 'brf',
      name: 'BRF Solgläntan',
      orgNr: '716400-1234',
      contactPerson: 'Lars Eriksson',
      phone: '08-123 45 67',
      email: 'styrelsen@solglantanbrf.se',
      address: 'Solvägen 1',
      zip: '123 45',
      city: 'Stockholm',
      note: 'Återkommande kund sedan 2020. Serviceavtal för gemensamma utrymmen.',
      contacts: [
        { name: 'Lars Eriksson', phone: '070-111 11 11', email: 'lars@exempel.se', role: 'Ordförande' },
        { name: 'Anna Berg', phone: '070-222 22 22', email: 'anna@exempel.se', role: 'Kassör' }
      ],
      active: true,
      createdAt: '2024-01-10'
    },
    {
      id: 'K-002',
      type: 'fastighetsagare',
      name: 'Fastighets AB Granit',
      orgNr: '556123-4567',
      contactPerson: 'Peter Svensson',
      phone: '08-987 65 43',
      email: 'peter@granit.se',
      address: 'Granitgatan 5',
      zip: '111 11',
      city: 'Stockholm',
      note: 'Kommersiella fastigheter. Prioriteras högt.',
      contacts: [
        { name: 'Peter Svensson', phone: '073-333 33 33', email: 'peter@granit.se', role: 'Förvaltningschef' }
      ],
      active: true,
      createdAt: '2024-01-20'
    },
    {
      id: 'K-003',
      type: 'privat',
      name: 'Johansson',
      firstName: 'Karin',
      lastName: 'Johansson',
      contactPerson: 'Karin Johansson',
      phone: '073-555 66 77',
      email: 'karin@privat.se',
      address: 'Villavägen 3',
      zip: '145 67',
      city: 'Sollentuna',
      note: 'Altanmålning 2023. Nöjd kund.',
      contacts: [],
      active: true,
      createdAt: '2024-03-01'
    },
    {
      id: 'K-004',
      type: 'brf',
      name: 'BRF Björkdalen',
      orgNr: '716400-5678',
      contactPerson: 'Gunnar Lindqvist',
      phone: '08-765 43 21',
      email: 'info@bjorkdalen.se',
      address: 'Björkvägen 10',
      zip: '135 79',
      city: 'Järfälla',
      note: 'Planerat serviceavtal under diskussion.',
      contacts: [
        { name: 'Gunnar Lindqvist', phone: '070-888 99 00', email: 'gunnar@bjorkdalen.se', role: 'Ordförande' }
      ],
      active: true,
      createdAt: '2024-04-01'
    }
  ],

  properties: [
    {
      id: 'OBJ-001',
      customerId: 'K-001',
      name: 'Solgläntan Hus A',
      address: 'Solvägen 1A',
      zip: '123 45',
      city: 'Stockholm',
      propertyDesignation: 'Stockholm Haga 1:234',
      buildYear: '1965',
      apartments: 24,
      status: 'aktiv',
      note: 'Hiss finns. OVK utförd 2023.',
      contacts: [],
      technicalSystems: {
        heating: 'Fjärrvärme',
        ventilation: 'FTX',
        elevator: 'Schindler 2000',
        alarm: 'Bosch BA9000'
      },
      inspections: {
        ovk: { lastDate: '2023-03-15', nextDate: '2026-03-15', status: 'godkänd' },
        sba: { lastDate: '2023-11-20', nextDate: '2024-11-20', status: 'godkänd' },
        hiss: { lastDate: '2023-06-10', nextDate: '2024-06-10', status: 'godkänd' }
      },
      documents: [],
      createdAt: '2024-01-10'
    },
    {
      id: 'OBJ-002',
      customerId: 'K-002',
      name: 'Granitgatan 5',
      address: 'Granitgatan 5',
      zip: '111 11',
      city: 'Stockholm',
      propertyDesignation: 'Stockholm Granit 2:1',
      buildYear: '1988',
      apartments: 0,
      status: 'aktiv',
      note: 'Kontorsfastighet, 6 plan.',
      contacts: [],
      technicalSystems: { heating: 'Bergvärme', ventilation: 'CAV' },
      inspections: {
        ovk: { lastDate: '2022-05-01', nextDate: '2025-05-01', status: 'godkänd' }
      },
      documents: [],
      createdAt: '2024-01-20'
    }
  ],

  priceGroups: [
    { id: 'PG-001', name: 'Standard', hourRate: 695, description: 'Normalt timpris', active: true, createdAt: '2024-01-01' },
    { id: 'PG-002', name: 'Akut / Jour', hourRate: 1250, description: 'Akut utryckning och jourtjänst', active: true, createdAt: '2024-01-01' },
    { id: 'PG-003', name: 'BRF-avtal', hourRate: 645, description: 'Avtalspris BRF-kunder', active: true, createdAt: '2024-01-01' },
    { id: 'PG-004', name: 'Intern tid', hourRate: 0, description: 'Intern tid utan debitering', active: true, createdAt: '2024-01-01' }
  ],

  workOrders: [
    {
      id: 'AO-001',
      title: 'Läckage balkong vån 3',
      description: 'Vatten tränger in vid balkongraden på vån 3. Behöver inspekteras och tätas.',
      customerId: 'K-001',
      propertyId: 'OBJ-001',
      address: 'Solvägen 1A, vån 3',
      contactPerson: 'Lars Eriksson',
      phone: '070-111 11 11',
      accessCode: '1234#',
      internalNote: '',
      status: 'pågående',
      priority: 'hög',
      priceType: 'timpris',
      fixedPrice: 0,
      priceGroupId: 'PG-001',
      staff: ['ST-002'],
      scheduledDate: new Date().toISOString().split('T')[0],
      scheduledStart: '08:00',
      scheduledEnd: '12:00',
      checklist: [
        { id: 'c1', text: 'Inspektera balkong', done: true },
        { id: 'c2', text: 'Identifiera läckagets ursprung', done: true },
        { id: 'c3', text: 'Täta med fogmassa', done: false },
        { id: 'c4', text: 'Kontrollera att läckaget är åtgärdat', done: false }
      ],
      materials: [
        { id: 'm1', articleId: '', name: 'Fogmassa Sikaflex', qty: 2, unit: 'st', buyPrice: 85, sellPrice: 145 }
      ],
      notes: [],
      timeEntries: [],
      invoiceId: '',
      createdAt: new Date(Date.now() - 2 * 24 * 3600000).toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'AO-002',
      title: 'OVK-kontroll Hus A',
      description: 'Obligatorisk ventilationskontroll enligt plan.',
      customerId: 'K-001',
      propertyId: 'OBJ-001',
      address: 'Solvägen 1A',
      contactPerson: 'Lars Eriksson',
      phone: '070-111 11 11',
      accessCode: '1234#',
      internalNote: '',
      status: 'klar',
      priority: 'normal',
      priceType: 'fastpris',
      fixedPrice: 4500,
      priceGroupId: '',
      staff: ['ST-002', 'ST-003'],
      scheduledDate: new Date(Date.now() - 5 * 24 * 3600000).toISOString().split('T')[0],
      scheduledStart: '09:00',
      scheduledEnd: '16:00',
      checklist: [
        { id: 'c1', text: 'Kontrollera alla tilluftsventiler', done: true },
        { id: 'c2', text: 'Kontrollera frånluftsventiler', done: true },
        { id: 'c3', text: 'Mäta luftflöden', done: true },
        { id: 'c4', text: 'Upprätta OVK-protokoll', done: true }
      ],
      materials: [],
      notes: [],
      timeEntries: [],
      invoiceId: '',
      createdAt: new Date(Date.now() - 6 * 24 * 3600000).toISOString(),
      updatedAt: new Date(Date.now() - 5 * 24 * 3600000).toISOString(),
      completedAt: new Date(Date.now() - 5 * 24 * 3600000).toISOString()
    },
    {
      id: 'AO-003',
      title: 'Akut – Värmepump ur funktion',
      description: 'Värmepumpen i källaren har slutat fungera. Kallt i fastigheten.',
      customerId: 'K-002',
      propertyId: 'OBJ-002',
      address: 'Granitgatan 5',
      contactPerson: 'Peter Svensson',
      phone: '073-333 33 33',
      accessCode: '9999*',
      internalNote: 'Ring Peter direkt vid ankomst',
      status: 'nytt',
      priority: 'akut',
      priceType: 'timpris',
      fixedPrice: 0,
      priceGroupId: 'PG-002',
      staff: [],
      scheduledDate: '',
      scheduledStart: '',
      scheduledEnd: '',
      checklist: [],
      materials: [],
      notes: [],
      timeEntries: [],
      invoiceId: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'AO-004',
      title: 'Fasadtvätt',
      description: 'Högtryckstvätt av fasad, alla sidor.',
      customerId: 'K-001',
      propertyId: 'OBJ-001',
      address: 'Solvägen 1A',
      contactPerson: 'Lars Eriksson',
      phone: '070-111 11 11',
      accessCode: '1234#',
      internalNote: '',
      status: 'pool',
      priority: 'normal',
      priceType: 'fastpris',
      fixedPrice: 8500,
      priceGroupId: '',
      staff: [],
      scheduledDate: '',
      scheduledStart: '',
      scheduledEnd: '',
      checklist: [],
      materials: [],
      notes: [],
      timeEntries: [],
      invoiceId: '',
      createdAt: new Date(Date.now() - 1 * 24 * 3600000).toISOString(),
      updatedAt: new Date(Date.now() - 1 * 24 * 3600000).toISOString()
    },
    {
      id: 'AO-005',
      title: 'Hissservice kvartalsvis',
      description: 'Kvartalskontroll och service av hiss.',
      customerId: 'K-001',
      propertyId: 'OBJ-001',
      address: 'Solvägen 1A',
      contactPerson: 'Anna Berg',
      phone: '070-222 22 22',
      accessCode: '1234#',
      internalNote: '',
      status: 'klar',
      priority: 'normal',
      priceType: 'fastpris',
      fixedPrice: 2200,
      priceGroupId: '',
      staff: ['ST-002'],
      scheduledDate: new Date(Date.now() - 10 * 24 * 3600000).toISOString().split('T')[0],
      scheduledStart: '10:00',
      scheduledEnd: '12:00',
      checklist: [
        { id: 'c1', text: 'Kontrollera bromsar', done: true },
        { id: 'c2', text: 'Smörj linor', done: true },
        { id: 'c3', text: 'Testköra hiss', done: true }
      ],
      materials: [],
      notes: [],
      timeEntries: [],
      invoiceId: '',
      createdAt: new Date(Date.now() - 11 * 24 * 3600000).toISOString(),
      updatedAt: new Date(Date.now() - 10 * 24 * 3600000).toISOString(),
      completedAt: new Date(Date.now() - 10 * 24 * 3600000).toISOString()
    }
  ],

  offers: [
    {
      id: 'OFF-001',
      customerId: 'K-004',
      propertyId: '',
      address: 'Björkvägen 10, Järfälla',
      internalNote: 'Kund intresserad av serviceavtal',
      lines: [
        { id: 'l1', description: 'Serviceavtal gemensamma utrymmen', qty: 12, unit: 'månad', unitPrice: 2500, discount: 0, total: 30000 },
        { id: 'l2', description: 'OVK-kontroll', qty: 1, unit: 'gång', unitPrice: 4500, discount: 0, total: 4500 }
      ],
      taxType: 'moms',
      rotRutAmount: 0,
      terms: '30 dagar netto',
      includes: 'Material ingår upp till 500 kr per tillfälle',
      excludes: 'Akutjobb utanför ordinarie servicetider',
      validUntil: new Date(Date.now() + 14 * 24 * 3600000).toISOString().split('T')[0],
      status: 'skickad',
      declineReason: '',
      salesOpportunityId: 'SO-002',
      workOrderId: '',
      sentAt: new Date(Date.now() - 8 * 24 * 3600000).toISOString(),
      answeredAt: '',
      createdAt: new Date(Date.now() - 9 * 24 * 3600000).toISOString(),
      updatedAt: new Date(Date.now() - 8 * 24 * 3600000).toISOString()
    }
  ],

  salesOpportunities: [
    {
      id: 'SO-001',
      customerId: 'K-003',
      propertyId: '',
      type: 'seasonal_job',
      title: 'Altantvätt – säsong 2025',
      reason: 'Karin Johansson fick altantvätt maj 2024. Det är snart ett år sedan.',
      aiTip: 'Inför säsongen 2025 är det rätt läge att ta kontakt. Kunden var nöjd senast och har en stor altan.',
      suggestedAction: 'Ring upp och fråga om de vill boka altan- och fasadtvätt inför sommaren.',
      priority: 'high',
      status: 'new',
      dueDate: new Date(Date.now() + 7 * 24 * 3600000).toISOString().split('T')[0],
      snoozedUntil: '',
      sourceType: 'work_order',
      sourceId: '',
      estimatedValue: 3500,
      convertedWorkOrderId: '',
      convertedQuoteId: '',
      createdAt: new Date(Date.now() - 1 * 24 * 3600000).toISOString(),
      updatedAt: new Date(Date.now() - 1 * 24 * 3600000).toISOString(),
      completedAt: '',
      completedBy: ''
    },
    {
      id: 'SO-002',
      customerId: 'K-004',
      propertyId: '',
      type: 'service_agreement',
      title: 'Serviceavtal BRF Björkdalen',
      reason: 'BRF Björkdalen har haft 4 arbetsorder senaste 12 månaderna utan avtal.',
      aiTip: 'Med ett serviceavtal sparar kunden pengar och ni får återkommande intäkt. Offert skickad men inget svar.',
      suggestedAction: 'Skicka påminnelse – offerten OFF-001 har inte besvarats på 8 dagar.',
      priority: 'high',
      status: 'contacted',
      dueDate: new Date(Date.now() + 2 * 24 * 3600000).toISOString().split('T')[0],
      snoozedUntil: '',
      sourceType: 'offer',
      sourceId: 'OFF-001',
      estimatedValue: 34500,
      convertedWorkOrderId: '',
      convertedQuoteId: 'OFF-001',
      createdAt: new Date(Date.now() - 10 * 24 * 3600000).toISOString(),
      updatedAt: new Date(Date.now() - 8 * 24 * 3600000).toISOString(),
      completedAt: '',
      completedBy: ''
    },
    {
      id: 'SO-003',
      customerId: 'K-001',
      propertyId: 'OBJ-001',
      type: 'upsell',
      title: 'Takinspektion efter vinter',
      reason: 'BRF Solgläntan har haft vattenskada (AO-001). Taket bör inspekteras.',
      aiTip: 'I samband med balkongläckaget finns anledning att erbjuda takinspektion. Förebyggande åtgärd.',
      suggestedAction: 'Erbjud takinspektion som tillägg till pågående arbete.',
      priority: 'medium',
      status: 'new',
      dueDate: new Date(Date.now() + 5 * 24 * 3600000).toISOString().split('T')[0],
      snoozedUntil: '',
      sourceType: 'work_order',
      sourceId: 'AO-001',
      estimatedValue: 5500,
      convertedWorkOrderId: '',
      convertedQuoteId: '',
      createdAt: new Date(Date.now() - 2 * 24 * 3600000).toISOString(),
      updatedAt: new Date(Date.now() - 2 * 24 * 3600000).toISOString(),
      completedAt: '',
      completedBy: ''
    },
    {
      id: 'SO-004',
      customerId: 'K-002',
      propertyId: 'OBJ-002',
      type: 'win_back',
      title: 'Uppföljning efter akutjobb',
      reason: 'Fastighets AB Granit har akut värmepumpfel. Bra läge att ta in ett löpande serviceavtal.',
      aiTip: 'Kunder är som mest mottagliga för avtal direkt efter ett akut problem lösts. Ta upp det efter AO-003.',
      suggestedAction: 'Presentera serviceavtal under pågående akutjobb.',
      priority: 'high',
      status: 'new',
      dueDate: new Date().toISOString().split('T')[0],
      snoozedUntil: '',
      sourceType: 'work_order',
      sourceId: 'AO-003',
      estimatedValue: 18000,
      convertedWorkOrderId: '',
      convertedQuoteId: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: '',
      completedBy: ''
    }
  ],

  activityLog: [
    {
      id: 'ACT-001',
      type: 'work_order_created',
      description: 'Arbetsorder AO-003 skapad – Akut: Värmepump ur funktion',
      timestamp: new Date().toISOString(),
      customerId: 'K-002', workOrderId: 'AO-003',
      propertyId: 'OBJ-002', offerId: '', invoiceId: '',
      salesOpportunityId: '', inspectionId: '', userId: 'ST-001'
    },
    {
      id: 'ACT-002',
      type: 'sales_opportunity_created',
      description: 'Säljchans skapad – Serviceavtal BRF Björkdalen',
      timestamp: new Date(Date.now() - 8 * 3600000).toISOString(),
      customerId: 'K-004', workOrderId: '', propertyId: '',
      offerId: '', invoiceId: '', salesOpportunityId: 'SO-002',
      inspectionId: '', userId: 'ST-001'
    },
    {
      id: 'ACT-003',
      type: 'offer_sent',
      description: 'Offert OFF-001 skickad till BRF Björkdalen',
      timestamp: new Date(Date.now() - 8 * 24 * 3600000).toISOString(),
      customerId: 'K-004', workOrderId: '', propertyId: '',
      offerId: 'OFF-001', invoiceId: '', salesOpportunityId: 'SO-002',
      inspectionId: '', userId: 'ST-001'
    },
    {
      id: 'ACT-004',
      type: 'work_order_completed',
      description: 'Arbetsorder AO-002 slutförd – OVK-kontroll Hus A',
      timestamp: new Date(Date.now() - 5 * 24 * 3600000).toISOString(),
      customerId: 'K-001', workOrderId: 'AO-002',
      propertyId: 'OBJ-001', offerId: '', invoiceId: '',
      salesOpportunityId: '', inspectionId: '', userId: 'ST-002'
    },
    {
      id: 'ACT-005',
      type: 'customer_created',
      description: 'Ny kund skapad – BRF Björkdalen',
      timestamp: new Date(Date.now() - 30 * 24 * 3600000).toISOString(),
      customerId: 'K-004', workOrderId: '', propertyId: '',
      offerId: '', invoiceId: '', salesOpportunityId: '',
      inspectionId: '', userId: 'ST-001'
    }
  ],

  timeEntries: [],
  contracts: [],
  inspections: [],
  articles: [
    // ── Kemikalier ──────────────────────────────────────────
    { id: 'ART-001', articleNumber: '1001', name: 'Fogmassa Sikaflex 291i',     category: 'kemikalier', unit: 'st',   buyPrice: 75,   sellPrice: 145,  vatRate: 25, active: true },
    { id: 'ART-002', articleNumber: '1002', name: 'Silikon transparent 300ml',  category: 'kemikalier', unit: 'st',   buyPrice: 45,   sellPrice: 89,   vatRate: 25, active: true },
    { id: 'ART-010', articleNumber: '1010', name: 'Avfettning 1L',              category: 'kemikalier', unit: 'st',   buyPrice: 55,   sellPrice: 110,  vatRate: 25, active: true },
    { id: 'ART-011', articleNumber: '1011', name: 'Rostskyddsfärg 0,5L',        category: 'kemikalier', unit: 'st',   buyPrice: 120,  sellPrice: 245,  vatRate: 25, active: true },
    { id: 'ART-012', articleNumber: '1012', name: 'Fogskum PU 750ml',           category: 'kemikalier', unit: 'st',   buyPrice: 68,   sellPrice: 135,  vatRate: 25, active: true },
    { id: 'ART-013', articleNumber: '1013', name: 'Akrylspackel 300ml',         category: 'kemikalier', unit: 'st',   buyPrice: 38,   sellPrice: 75,   vatRate: 25, active: true },

    // ── Byggmaterial ────────────────────────────────────────
    { id: 'ART-003', articleNumber: '1020', name: 'Skruv 6×50 (förpackning 50st)', category: 'material', unit: 'förp.', buyPrice: 38, sellPrice: 72, vatRate: 25, active: true },
    { id: 'ART-004', articleNumber: '1021', name: 'Expansionsbult M8×60',       category: 'material', unit: 'st',   buyPrice: 10,   sellPrice: 25,   vatRate: 25, active: true },
    { id: 'ART-005', articleNumber: '1022', name: 'Rörkoppling 15mm',           category: 'material', unit: 'st',   buyPrice: 32,   sellPrice: 68,   vatRate: 25, active: true },
    { id: 'ART-014', articleNumber: '1023', name: 'Kopplingsrör 22mm × 1m',     category: 'material', unit: 'st',   buyPrice: 85,   sellPrice: 165,  vatRate: 25, active: true },
    { id: 'ART-015', articleNumber: '1024', name: 'Kulventil 15mm',             category: 'material', unit: 'st',   buyPrice: 95,   sellPrice: 195,  vatRate: 25, active: true },
    { id: 'ART-016', articleNumber: '1025', name: 'Golvbrunn plastrens',        category: 'material', unit: 'st',   buyPrice: 110,  sellPrice: 220,  vatRate: 25, active: true },
    { id: 'ART-017', articleNumber: '1026', name: 'Drevmassa branddrev 10m',    category: 'material', unit: 'rul',  buyPrice: 145,  sellPrice: 290,  vatRate: 25, active: true },
    { id: 'ART-018', articleNumber: '1027', name: 'Gummitätning 20mm × 5m',     category: 'material', unit: 'rul',  buyPrice: 55,   sellPrice: 110,  vatRate: 25, active: true },

    // ── Förbrukningsmaterial ────────────────────────────────
    { id: 'ART-006', articleNumber: '1030', name: 'Plastfilm skyddsfilm 4m',    category: 'forbruk', unit: 'm',    buyPrice: 6,    sellPrice: 15,   vatRate: 25, active: true },
    { id: 'ART-019', articleNumber: '1031', name: 'Maskeringstejp 50mm',        category: 'forbruk', unit: 'rul',  buyPrice: 22,   sellPrice: 45,   vatRate: 25, active: true },
    { id: 'ART-020', articleNumber: '1032', name: 'Kabelstrumpa 10m',           category: 'forbruk', unit: 'st',   buyPrice: 35,   sellPrice: 70,   vatRate: 25, active: true },
    { id: 'ART-021', articleNumber: '1033', name: 'Engångshandskar (100-pack)', category: 'forbruk', unit: 'förp.', buyPrice: 45,  sellPrice: 90,   vatRate: 25, active: true },
    { id: 'ART-022', articleNumber: '1034', name: 'Sliprondell 125mm (10-pack)',category: 'forbruk', unit: 'förp.', buyPrice: 65,  sellPrice: 130,  vatRate: 25, active: true },

    // ── Arbete ──────────────────────────────────────────────
    { id: 'ART-007', articleNumber: '2001', name: 'Arbetstid standard',         category: 'arbete', unit: 'tim',  buyPrice: 0,    sellPrice: 695,  vatRate: 25, active: true },
    { id: 'ART-008', articleNumber: '2002', name: 'Akut/jourarbetstid',         category: 'arbete', unit: 'tim',  buyPrice: 0,    sellPrice: 1250, vatRate: 25, active: true },
    { id: 'ART-023', articleNumber: '2003', name: 'Övertid (OB)',               category: 'arbete', unit: 'tim',  buyPrice: 0,    sellPrice: 895,  vatRate: 25, active: true },
    { id: 'ART-024', articleNumber: '2004', name: 'Helgtid',                    category: 'arbete', unit: 'tim',  buyPrice: 0,    sellPrice: 995,  vatRate: 25, active: true },

    // ── Kostnader ───────────────────────────────────────────
    { id: 'ART-009', articleNumber: '3001', name: 'Resekostnad km',             category: 'kostnad', unit: 'km',   buyPrice: 0,   sellPrice: 5,    vatRate: 25, active: true },
    { id: 'ART-025', articleNumber: '3002', name: 'Parkeringskostnad',          category: 'kostnad', unit: 'gång', buyPrice: 0,   sellPrice: 0,    vatRate: 25, active: true },
    { id: 'ART-026', articleNumber: '3003', name: 'Utrustning/verktyg hyra',    category: 'kostnad', unit: 'dag',  buyPrice: 0,   sellPrice: 0,    vatRate: 25, active: true },
  ],
  invoices: []
};
