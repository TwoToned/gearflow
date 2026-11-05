// ---------- Forms gallery: every create/edit sheet on one component (RowEditorSheet)
const TODAY = '2026-11-09', ME = 'Jayden Cole';
const rnd = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(11);
const A = 'https://claude.ai/artifact/';
const U = { home: A + 'RPnGj7WnaWcknvQ8ShcRkf', wizard: A + 'GgtKxc5WZP33gXihgFTB9B', asset: A + 'Rr5rwirCUMRy8gf5G6Vz7s', model: A + '47miWruJVsednbzrFPij2b', people: A + 'LPdsNGb4CRMfS6qk7j7Fsa', gear: A + 'D7N5PmXKrkcY2gzZXWeuvc', floor: A + '6xqFcEZZk49w86p5pAsisA', planner: A + 'AKkgWzJ2gVR3dJTWnMB2Ui', scan: A + '8Q2HVoRhLbSLz1Q9mCtayX', finance: A + '5VnYTVW2pdA5r1qBRvdrom', settings: A + 'Q3TeWuQPjzvXbAtmUV8Hg8', jobs: A + 'A7SMPtpTr3aedUDEnuSaxd', assets: A + '89PDTuMiovgP9i3h4MJ1Tw' };
const state = { q: '', form: null, last: {}, recs: {}, clock: 41, undo: null };
const clone = o => JSON.parse(JSON.stringify(o));
const nowt = () => '09:' + String(state.clock).padStart(2, '0');

// ---------- sources for the search-first pickers
const MODELS = [['Martin MAC Aura XB', 'Lighting', 'AURA-', 2, 12], ['Martin MAC Aura PXL', 'Lighting', 'L-', 4, 8], ['d&b Y8', 'Audio', 'Y8-', 2, 16], ['Sennheiser EW-DX SK beltpack', 'Audio', 'SK-', 4, 24], ['Sennheiser EM4 receiver', 'Audio', 'A-', 4, 6], ['Shure ULXD4Q receiver', 'Audio', 'ULXD-', 2, 4], ['Barco UDX-4K32', 'Video', 'V-', 4, 3]].map(([n, c, p, w, own]) => ({ id: n, label: n, sub: `${c} · ${own} owned`, pre: p, w, cat: c }));
const BULKM = [['Omega clamp', 'OC-100'], ['Safety bond', 'SB-50'], ['XLR 5 m', 'XLR-5'], ['Gaffer tape, black', 'GT-B']].map(([n, c]) => ({ id: n, label: n, sub: 'Bulk stock', tg: c }));
const TAGS = new Set(['AURA-01', 'AURA-02', 'AURA-03', 'AURA-04', 'AURA-05', 'AURA-06', 'AURA-08', 'AURA-09', 'AURA-10', 'L-0001', 'L-0002', 'SK-0012', 'A-0301', 'V-0011', 'OC-100', 'SB-50']);
const KTAGS = new Set(['K-0042', 'K-0043', 'K-0051']);
const nextTag = (m) => { if (!m) return ''; for (let i = 1; i < 9999; i++) { const t = m.pre + String(i).padStart(m.w, '0').slice(-m.w); if (!TAGS.has(t)) return t; } return ''; };
const LOCS = { 'Warehouse A': ['B1', 'B2', 'B3', 'A3-14'], 'Warehouse B': ['C1', 'C2'], 'Van 2': [], 'Van 1': [] };
const PLACES = [['wa', 'Warehouse A', 'Warehouse · Sydney'], ['wa3', 'Warehouse A › Bay 3', 'Bay · 14 assets'], ['wb', 'Warehouse B', 'Warehouse · Alexandria'], ['v2', 'Van 2', 'Vehicle'], ['v1', 'Van 1', 'Vehicle'], ['hil', 'Hilton Sydney', 'Venue · 488 George St'], ['qh', 'Qantas Hangar', 'Venue · Mascot']].map(([id, label, sub]) => ({ id, label, sub }));
const ASSETS = [['AURA-01', 'Martin MAC Aura XB', 'Reserved'], ['AURA-02', 'Martin MAC Aura XB', 'T&T overdue'], ['AURA-03', 'Martin MAC Aura XB', 'Available'], ['AURA-06', 'Martin MAC Aura XB', 'Fan fault'], ['AURA-10', 'Martin MAC Aura XB', 'T&T overdue'], ['L-0001', 'Martin MAC Aura PXL', 'Available'], ['L-0002', 'Martin MAC Aura PXL', 'Reserved'], ['SK-0012', 'Sennheiser EW-DX SK beltpack', 'Available'], ['SK-0013', 'Sennheiser EW-DX SK beltpack', 'Available'], ['A-0301', 'Sennheiser EM4 receiver', 'Available'], ['V-0011', 'Barco UDX-4K32', 'Available']].map(([t, m, s]) => ({ id: t, label: m, tg: t, sub: s }));
const KITITEMS = [...ASSETS.filter(a => /^(SK|A-|ULXD)/.test(a.tg)).map(a => ({ ...a, bulk: false })), { id: 'ULXD4Q-1', label: 'Shure ULXD4Q receiver', tg: 'ULXD-01', sub: 'Available', bulk: false }, { id: 'ANT-1', label: 'Paddle antenna', tg: 'ANT-10', sub: 'Bulk stock', bulk: true }, { id: 'BATT-AA', label: 'AA battery, rechargeable', tg: 'BATT-01', sub: 'Bulk stock', bulk: true }, { id: 'XLR5', label: 'XLR 5 m', tg: 'XLR-5', sub: 'Bulk stock', bulk: true }];
const SUPPLIERS = ['Scene Change', 'Big Picture', 'Chameleon Touring', 'Martin Pro Audio'].map(n => ({ id: n, label: n, sub: n === 'Martin Pro Audio' ? 'Manufacturer' : 'Sub-hire' }));
const PROJECTS = [['#2341', 'Hilton Sydney gala dinner', '12 – 14 Nov'], ['#2338', 'Corporate AGM', '21 Nov'], ['#2340', 'Launch night', '27 Nov'], ['#2350', 'Qantas awards', '4 – 5 Dec']].map(([n, t, d]) => ({ id: n + ' ' + t, label: t, tg: n, sub: d }));
const PEOPLE = ['', 'Jayden Cole', 'Mel Torres', 'Sam Okafor', 'Tom Nguyen'];
const CATS = ['Lighting', 'Audio', 'Video', 'Rigging', 'Power', 'Cable', 'Staging'];
const CONDS = ['New', 'Good', 'Fair', 'Poor', 'Damaged'];

// ---------- field + section helpers
const fd = (k, label, o = {}) => ({ k, label, type: 'text', ...o });
const sel = (k, label, opts, o = {}) => fd(k, label, { type: 'select', opts, ...o });
const mny = (k, label, o = {}) => fd(k, label, { type: 'number', money: true, min: 0, ph: 'blank', ...o });
const isNew = (v, f) => f.mode === 'create', isEdit = (v, f) => f.mode === 'edit';
const emailOk = s => !s || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const MONEY = 'Enter an amount of 0 or more, or leave it blank';

// ---------- the forms. Order follows the live components (asset-spec §9d.4); ★ = req
const FORMS = [
  { key: 'asset', name: 'Asset', noun: 'asset', group: 0, newR: '/assets/registry/new', editR: '/assets/registry/[id]/edit', over: 'Assets', cta: 'Create asset', again: ['model', 'loc', 'bin', 'cond'], moreLabel: 'Purchase and more details', reg: TAGS, regKey: 'tag', title: v => v.tag, kindSwitch: true,
    blank: () => ({ model: '', tag: '', serial: '', cond: 'New', loc: 'Warehouse A', bin: 'B2', pdate: '', price: '', supplier: '', order: '', warranty: '', fw: '', tags: '' }),
    seed: () => ({ model: 'Martin MAC Aura XB', tag: 'AURA-01', serial: 'MA2043116', name: '', status: 'RESERVED', cond: 'Good', loc: 'Warehouse A', bin: 'B2', pdate: '2023-03-14', price: '2640', supplier: 'Martin Pro Audio', order: 'PO-1187', warranty: '2028-03-14', fw: '3.2.1', tags: 'moving head, touring' }),
    onPick: (f, k, it) => { if (k === 'model' && !f.touched.tag) f.v.tag = nextTag(it); },
    advance: v => { v.tag = nextTag(MODELS.find(m => m.id === v.model)); v.serial = ''; },
    sections: [
      { t: 'Identity', hint: 'What it is and how you will find it.', fields: [
        fd('model', 'Equipment model', { type: 'pick', src: () => MODELS, req: true, ph: 'Search models — Aura, beltpack, d&b, Y8…', hint: f => f.mode === 'create' ? 'Search first · Enter picks the top result · each shows the next tag it would get' : '', tg: it => nextTag(it), dep: true, next: 'f-tag', reqMsg: 'Pick a model from the list' }),
        [fd('tag', 'Asset tag', { req: true, max: 50, mono: true, reqMsg: 'Asset tag is required', hint: f => f.mode === 'create' ? 'Suggested · scan a label to use that tag' : '', check: (v, f) => TAGS.has(v.tag.trim().toUpperCase()) && v.tag.trim().toUpperCase() !== f.orig?.tag ? `${v.tag.trim().toUpperCase()} is already used by another asset` : '' }), fd('serial', 'Serial number', { max: 100, mono: true })],
        fd('name', 'Custom name', { show: isEdit, ph: 'e.g. FOH key light' })] },
      { t: 'Condition & location', hint: 'Where it lives and what shape it is in.', fields: [
        [sel('status', 'Status', [['AVAILABLE', 'Available'], ['IN_MAINTENANCE', 'In maintenance'], ['RETIRED', 'Retired'], ['RESERVED', 'Reserved']], { show: isEdit }), sel('cond', 'Condition', CONDS.map(c => [c, c]))],
        [sel('loc', 'Location', Object.keys(LOCS).map(l => [l, l]), { dep: true }), sel('bin', 'Bin', (v) => [['', 'No bin'], ...(LOCS[v.loc] || []).map(b => [b, b])])]] },
      { t: 'Purchase', hint: 'Optional · warranty and depreciation.', opt: true, fields: [
        [fd('pdate', 'Purchase date', { type: 'date' }), mny('price', 'Purchase price ($)')],
        [fd('supplier', 'Supplier', { ph: 'No supplier' }), fd('order', 'Order #', { mono: true, ph: 'No order' })],
        fd('warranty', 'Warranty expiry', { type: 'date', check: v => v.warranty && v.pdate && v.warranty < v.pdate ? 'Warranty cannot end before the purchase date' : '' })] },
      { t: 'More details', hint: 'Tags and the org\'s custom fields. Notes live on the Notes tab.', opt: true, fields: [[fd('tags', 'Tags', { ph: 'moving head, touring' }), fd('fw', 'Firmware · custom field', { mono: true })]] }] },

  { key: 'bulk', name: 'Bulk stock', noun: 'bulk stock', group: 0, newR: '/assets/registry/new?kind=bulk', editR: '/assets/bulk/[id]/edit', over: 'the model page', cta: 'Create stock', moreLabel: 'Price per unit and tags', reg: TAGS, regKey: 'tag', title: v => v.tag, kindSwitch: true,
    blank: () => ({ model: '', tag: '', qty: '1', cond: '', loc: 'Warehouse A', bin: 'A3-14', price: '', tags: '' }),
    seed: () => ({ model: 'Omega clamp', tag: 'OC-100', qty: '40', status: 'AVAILABLE', loc: 'Warehouse A', bin: 'A3-14', price: '18.50', tags: 'rigging' }),
    sections: [
      { t: 'Identity', hint: 'What it is and how many you hold.', fields: [
        fd('model', 'Equipment model', { type: 'pick', src: () => BULKM, req: true, ph: 'Search bulk models — clamp, bond, XLR…', reqMsg: 'Pick a model from the list', hint: f => f.mode === 'create' ? 'Search first · Enter picks the top result' : '', dep: true, tg: it => it.tg, next: 'f-tag' }),
        [fd('tag', 'Stock code', { req: true, max: 50, mono: true, reqMsg: 'Stock code is required', check: (v, f) => TAGS.has(v.tag.trim().toUpperCase()) && v.tag.trim().toUpperCase() !== f.orig?.tag ? `${v.tag.trim().toUpperCase()} is already used by another asset` : '' }), fd('qty', 'Total quantity', { type: 'number', req: true, int: true, min: 1, reqMsg: 'Quantity is required', minMsg: 'Quantity must be 1 or more' })]] },
      { t: 'Status & location', hint: 'Where the stock sits.', fields: [[sel('status', 'Status', [['AVAILABLE', 'Available'], ['IN_MAINTENANCE', 'In maintenance'], ['RETIRED', 'Retired']], { show: isEdit }), sel('loc', 'Location', Object.keys(LOCS).map(l => [l, l]), { dep: true })], sel('bin', 'Bin', (v) => [['', 'No bin'], ...(LOCS[v.loc] || []).map(b => [b, b])])] },
      { t: 'More details', hint: 'Optional · valuation and tags.', opt: true, fields: [[mny('price', 'Price per unit ($)'), fd('tags', 'Tags', { ph: 'rigging, consumable' })]] }] },

  { key: 'model', name: 'Model', noun: 'model', group: 0, newR: '/assets/models/new', editR: '/assets/models/[id]/edit', over: 'Assets', cta: 'Create model', moreLabel: 'Xero, compliance and more', title: v => v.name,
    blank: () => ({ name: '', manufacturer: '', modelNumber: '', sku: '', cat: 'Lighting', atype: 'SERIALIZED', desc: '', day: '', week: '', month: '', purchase: '', repl: '', sale: '', saleQty: '', xr: '', xs: '', weight: '', power: '', tt: false, profile: 'Class I appliance', ttDays: '365', specs: '', tags: '', active: true, container: false }),
    seed: () => ({ name: 'Martin MAC Aura XB', manufacturer: 'Martin', modelNumber: 'MAC Aura XB', sku: 'MRT-AURA-XB', cat: 'Lighting', atype: 'SERIALIZED', desc: 'LED wash moving head with aura backlight effect.', day: '85', week: '340', month: '1020', purchase: '2640', repl: '3200', sale: '', saleQty: '', xr: '200', xs: '', weight: '7.9', power: '480', tt: true, profile: 'Class I appliance', ttDays: '365', specs: 'Zoom: 8° – 50°\nWeight: 7.9 kg', tags: 'moving head, wash', active: true, container: false }),
    sections: [
      { t: 'Identity', hint: 'What the thing is, not any one unit of it.', fields: [
        fd('name', 'Name', { req: true, max: 200, reqMsg: 'Name is required' }),
        [fd('manufacturer', 'Manufacturer', { max: 200 }), fd('modelNumber', 'Model number', { max: 100, mono: true })],
        [fd('sku', 'SKU', { max: 100, mono: true }), sel('cat', 'Category', CATS.map(c => [c, c]))],
        { k: 'atype', label: 'Asset type', type: 'words', opts: [['SERIALIZED', 'Serialised'], ['BULK', 'Bulk']], hint: 'Serialised units have a tag each · bulk is counted' },
        fd('desc', 'Description', { type: 'textarea', max: 2000 })] },
      { t: 'Pricing', hint: 'Rates are per hire period · a blank rate is blank, never $0.', fields: [
        [mny('day', 'Day rate ($)'), mny('week', 'Week rate ($)'), mny('month', 'Month rate ($)')],
        [mny('purchase', 'Purchase price ($)'), mny('repl', 'Replacement ($)'), mny('sale', 'Sale price ($)', { dep: true })],
        fd('saleQty', 'Sale stock quantity', { type: 'number', int: true, min: 0, show: v => v.sale !== '', ph: 'units on hand to sell' })] },
      { t: 'Xero coding', hint: 'Optional · account codes for rental and sale lines.', opt: true, fields: [[fd('xr', 'Rental account', { max: 50, mono: true }), fd('xs', 'Sale account', { max: 50, mono: true })]] },
      { t: 'Compliance', hint: 'Optional · weight, power and test & tag.', opt: true, fields: [
        [fd('weight', 'Weight (kg)', { type: 'number', min: 0, step: '0.1', ph: 'blank is not 0' }), fd('power', 'Power draw (W)', { type: 'number', int: true, min: 0 })],
        fd('tt', 'Requires test & tag', { type: 'check', dep: true }),
        [sel('profile', 'Test profile', ['Class I appliance', 'Class II appliance', 'Lead / cord set', 'Power board'].map(x => [x, x]), { show: v => v.tt }), fd('ttDays', 'Validity (days)', { type: 'number', int: true, min: 1, show: v => v.tt, minMsg: 'Validity must be 1 day or more' })]] },
      { t: 'More details', hint: 'Specifications, tags and status.', opt: true, fields: [fd('specs', 'Specifications', { type: 'textarea', ph: 'One per line — Zoom: 8° – 50°' }), fd('tags', 'Tags'), fd('active', 'Active · off archives the model', { type: 'check' }), fd('container', 'Packing container · holds other gear on a job', { type: 'check' })] }] },

  { key: 'kit', name: 'Kit', noun: 'kit', group: 0, newR: '/assets/kits/new', editR: '/assets/kits/[id]/edit', over: 'Kits', cta: 'Create kit', moreLabel: 'Case, Xero and more details', reg: KTAGS, regKey: 'tag', title: v => v.name,
    blank: () => ({ name: '', tag: '', cat: 'Audio', loc: 'Warehouse A', status: 'AVAILABLE', cond: 'New', mode: 'KIT_LEVEL', contents: [], caseType: '', dims: '', weight: '', xero: '', pdate: '', price: '', desc: '', tags: '' }),
    seed: () => ({ name: 'Shure ULXD4Q wireless kit', tag: 'K-0042', cat: 'Audio', loc: 'Warehouse A', status: 'AVAILABLE', cond: 'Good', mode: 'PER_ITEM', contents: [{ id: 'ULXD4Q-1', label: 'Shure ULXD4Q receiver', tg: 'ULXD-01', qty: 1, bulk: false }, { id: 'SK-0012', label: 'Sennheiser EW-DX SK beltpack', tg: 'SK-0012', qty: 1, bulk: false }, { id: 'ANT-1', label: 'Paddle antenna', tg: 'ANT-10', qty: 2, bulk: true }], caseType: 'Pelican 1650', dims: '740 × 450 × 270 mm', weight: '14.2', xero: '200', pdate: '2024-02-03', price: '6850', desc: '', tags: 'wireless' }),
    sections: [
      { t: 'Identity', hint: 'The case you pack and the check it gets.', fields: [
        [fd('name', 'Name', { req: true, max: 200, reqMsg: 'Name is required' }), fd('tag', 'Kit tag', { req: true, max: 50, mono: true, reqMsg: 'Asset tag is required', check: (v, f) => KTAGS.has(v.tag.trim().toUpperCase()) && v.tag.trim().toUpperCase() !== f.orig?.tag ? `${v.tag.trim().toUpperCase()} is already used by another kit` : '' })],
        [sel('cat', 'Category', CATS.map(c => [c, c])), sel('loc', 'Location', Object.keys(LOCS).map(l => [l, l]))],
        [sel('status', 'Status', [['AVAILABLE', 'Available'], ['CHECKED_OUT', 'Checked out'], ['IN_MAINTENANCE', 'In maintenance'], ['INCOMPLETE', 'Incomplete'], ['RETIRED', 'Retired']]), sel('cond', 'Condition', CONDS.map(c => [c, c]))],
        { k: 'mode', label: 'Check mode', type: 'words', dep: true, opts: [['KIT_LEVEL', 'One check for the case'], ['PER_ITEM', 'Check each item']], hint: v => v.mode === 'PER_ITEM' ? 'Each item below is ticked off on the way out and on return' : 'The case is checked as one thing · contents are not ticked individually' }] },
      { t: 'Contents', hint: 'Search an asset or bulk stock · Enter adds the top result.', fields: [{ k: 'contents', label: 'Add to the kit', type: 'contents', src: v => KITITEMS.filter(x => !v.contents.some(c => c.id === x.id)), ph: 'Search — beltpack, receiver, antenna…' }] },
      { t: 'Case', hint: 'Optional · what it travels in.', opt: true, fields: [[fd('caseType', 'Case type', { max: 200 }), fd('dims', 'Dimensions', { max: 200 })], fd('weight', 'Weight (kg)', { type: 'number', min: 0, step: '0.1', ph: 'blank is not 0' })] },
      { t: 'Xero coding', hint: 'Optional.', opt: true, fields: [fd('xero', 'Account code', { max: 50, mono: true })] },
      { t: 'More details', hint: 'Purchase and notes.', opt: true, fields: [[fd('pdate', 'Purchase date', { type: 'date' }), mny('price', 'Purchase price ($)')], fd('desc', 'Description', { type: 'textarea', max: 2000 }), fd('tags', 'Tags')] }] },

  { key: 'location', name: 'Location', noun: 'location', group: 0, newR: '/assets/locations/new', editR: '/assets/locations/[id]/edit', over: 'Locations', cta: 'Create location', again: ['parent', 'type'], moreLabel: 'Notes and tags', title: v => v.name,
    blank: () => ({ name: '', type: 'WAREHOUSE', parent: '', address: '', notes: '', tags: '', isDefault: false }),
    seed: () => ({ name: 'Bay 3', type: 'WAREHOUSE', parent: 'wa', address: '', notes: 'Lighting bay. Cases on the left, loose gear on the shelf.', tags: 'lighting', isDefault: false }),
    sections: [
      { t: 'Identity', hint: 'What it is called and what kind of place.', fields: [[fd('name', 'Name', { req: true, max: 200, reqMsg: 'Name is required' }), sel('type', 'Type', [['WAREHOUSE', 'Warehouse'], ['VENUE', 'Venue'], ['VEHICLE', 'Vehicle'], ['OFFSITE', 'Off-site']])]] },
      { t: 'Place', hint: 'Where it sits · search first.', fields: [fd('parent', 'Inside', { type: 'pick', src: (v, f) => PLACES.filter(p => p.label !== (f.orig?.name ? 'Warehouse A › ' + f.orig.name : '')), ph: 'Search places — Warehouse A, Van 2… (none for top level)', hint: 'A place can sit inside one other place · leave empty for top level', clearable: true }), fd('address', 'Address', { max: 500, ph: 'Optional' })] },
      { t: 'More details', hint: 'Notes and the default for new assets.', opt: true, fields: [fd('notes', 'Notes', { type: 'textarea', max: 1000, maxMsg: 'Keep it to 1,000 characters' }), fd('tags', 'Tags'), fd('isDefault', 'Default location for new assets', { type: 'check' })] }] },

  { key: 'client', name: 'Client', noun: 'client', group: 1, newR: '/clients/new', editR: '/clients/[id]/edit', over: 'Clients', cta: 'Create client', moreLabel: 'Billing and more details', title: v => v.name,
    blank: () => ({ type: 'COMPANY', name: '', cname: '', email: '', phone: '', billing: '', shipping: '', abn: '', terms: '', disc: '', exempt: false, profile: '', dep: '', notes: '', tags: '', contacts: [] }),
    seed: () => ({ type: 'COMPANY', name: 'Hilton Sydney', cname: 'Priya Shah', email: 'priya.shah@hilton.example', phone: '02 9266 2000', billing: '488 George St, Sydney NSW 2000', shipping: 'Loading dock, Kent St, Sydney NSW 2000', abn: '12 345 678 901', terms: 'Net 14', disc: '5', exempt: false, profile: 'DEPOSIT_BALANCE', dep: '50', notes: 'Dock booking needed 24 h ahead.', tags: 'venue, hotel', contacts: [{ n: 'Priya Shah', r: 'Events manager', e: 'priya.shah@hilton.example', p: '0412 555 010' }, { n: 'Marcus Lee', r: 'AV coordinator', e: 'marcus.lee@hilton.example', p: '0412 555 044' }] }),
    sections: [
      { t: 'Identity', hint: v => v.type === 'INDIVIDUAL' ? 'A person we hire to, not a business.' : 'Who is on the quote and the invoice.', fields: [
        { k: 'type', label: 'Type', type: 'words', dep: true, opts: [['COMPANY', 'Company'], ['INDIVIDUAL', 'Person'], ['VENUE', 'Venue'], ['PRODUCTION_COMPANY', 'Production company']] },
        fd('name', v => ({ COMPANY: 'Company name', INDIVIDUAL: 'Full name', VENUE: 'Venue name', PRODUCTION_COMPANY: 'Production company name' })[v.type], { req: true, max: 200, reqMsg: 'Name is required' })] },
      { t: 'Contact', hint: (v, f) => v.type === 'INDIVIDUAL' ? 'How to reach them.' : f.mode === 'create' ? 'Main contact · add more people from the record after you save.' : 'Main contact · the rest are listed below.', fields: [
        fd('cname', 'Contact name', { max: 200, show: v => v.type !== 'INDIVIDUAL', ph: 'Who we deal with day to day' }),
        [fd('email', 'Email', { type: 'email', max: 200, check: v => emailOk(v.email) ? '' : 'Invalid email' }), fd('phone', 'Phone', { type: 'tel', max: 50 })]] },
      { t: 'Address', hint: 'Billing goes on invoices · shipping is where gear is delivered.', fields: [fd('billing', 'Billing address', { max: 500 }), fd('shipping', 'Shipping address', { max: 500 })] },
      { t: 'Contacts', hint: (v) => `People at ${v.name || 'this client'} · each can be set on a job.`, show: isEdit, fields: [{ k: 'contacts', label: 'Contacts', type: 'contacts' }] },
      { t: 'More details', hint: 'Billing terms, tax and notes.', opt: true, fields: [
        [fd('abn', v => v.type === 'INDIVIDUAL' ? 'Tax ID' : 'ABN', { max: 50, mono: true }), sel('terms', 'Payment terms', [['', 'Org default'], ['On receipt', 'On receipt'], ['Net 7', 'Net 7'], ['Net 14', 'Net 14'], ['Net 30', 'Net 30']])],
        [fd('disc', 'Default discount (%)', { type: 'number', min: 0, max: 100, step: '0.5', ph: 'blank is none', rangeMsg: 'Enter 0 to 100, or leave it blank' }), sel('profile', 'Payment profile', [['', 'Org default'], ['FULL_UPFRONT', 'Full upfront'], ['DEPOSIT_BALANCE', 'Deposit and balance']], { dep: true })],
        fd('dep', 'Default deposit (%)', { type: 'number', min: 0, max: 100, show: v => v.profile === 'DEPOSIT_BALANCE', rangeMsg: 'Enter 0 to 100' }),
        fd('exempt', 'Tax exempt', { type: 'check' }), fd('notes', 'Notes', { type: 'textarea', max: 2000 }), fd('tags', 'Tags')] }] },

  { key: 'crew', name: 'Crew member', noun: 'crew member', group: 1, newR: '/crew/new', editR: '/crew/[id]/edit', over: 'Crew', cta: 'Add crew member', again: ['type', 'status', 'dept', 'role', 'day', 'hour', 'ot'], moreLabel: 'Department, role and personal', title: v => `${v.first} ${v.last}`.trim(),
    blank: () => ({ first: '', last: '', type: 'FREELANCER', status: 'ACTIVE', account: '', email: '', phone: '', day: '', hour: '', ot: '', dept: '', role: '', dob: '', abn: '', address: '', ecn: '', ecp: '', notes: '', tags: '' }),
    seed: () => ({ first: 'Oli', last: 'Martin', type: 'FREELANCER', status: 'ACTIVE', account: '', email: 'oli.martin@example.com', phone: '0412 555 118', day: '650', hour: '85', ot: '1.5', dept: 'Lighting', role: 'Lighting technician', dob: '1991-06-14', abn: '51 824 753 556', address: '12 Bourke St, Surry Hills NSW', ecn: 'Kim Martin', ecp: '0412 555 902', notes: 'Rigging ticket (dogging). Own tools.', tags: 'lighting, rigger' }),
    sections: [
      { t: 'Identity', hint: 'Who they are and how they work with us.', fields: [
        [fd('first', 'First name', { req: true, max: 200, reqMsg: 'First name is required' }), fd('last', 'Last name', { req: true, max: 200, reqMsg: 'Last name is required' })],
        [sel('type', 'Type', [['EMPLOYEE', 'Employee'], ['FREELANCER', 'Freelancer'], ['CONTRACTOR', 'Contractor'], ['VOLUNTEER', 'Volunteer']]), sel('status', 'Status', [['ACTIVE', 'Active'], ['ON_LEAVE', 'On leave'], ['INACTIVE', 'Inactive'], ['ARCHIVED', 'Archived']])],
        sel('account', 'Platform account', [['', 'Not linked'], ['mel', 'Mel Torres'], ['sam', 'Sam Okafor'], ['tom', 'Tom Nguyen']], { hint: 'Linking lets them sign in and see their own calls' })] },
      { t: 'Contact', hint: 'Calls and offers go out by SMS or email.', fields: [[fd('email', 'Email', { type: 'email', max: 200, check: v => emailOk(v.email) ? '' : 'Invalid email' }), fd('phone', 'Phone', { type: 'tel', max: 50 })]] },
      { t: 'Rates', hint: 'Defaults for new calls · blank is blank, never $0.', fields: [[mny('day', 'Day rate ($)'), mny('hour', 'Hourly ($)'), mny('ot', 'Overtime ×', { ph: 'e.g. 1.5' })]] },
      { t: 'More details', hint: 'Department, role and personal.', opt: true, fields: [
        [fd('dept', 'Department', { max: 100 }), sel('role', 'Default role', [['', 'None'], ...['Lighting technician', 'Audio A1', 'Audio A2', 'Video technician', 'Rigger', 'Stagehand', 'Driver'].map(x => [x, x])])],
        [fd('dob', 'Date of birth', { type: 'date' }), fd('abn', 'ABN / GST', { max: 50, mono: true })],
        fd('address', 'Address', { max: 500 }),
        [fd('ecn', 'Emergency contact', { max: 200 }), fd('ecp', 'Emergency phone', { type: 'tel', max: 50 })],
        fd('notes', 'Notes', { type: 'textarea', max: 2000 }), fd('tags', 'Tags')] }] },

  { key: 'supplier', name: 'Supplier', noun: 'supplier', group: 1, newR: '/suppliers/new', editR: '/suppliers/[id]/edit', over: 'Suppliers', cta: 'Create supplier', moreLabel: 'Account, terms and notes', title: v => v.name,
    blank: () => ({ name: '', cname: '', email: '', phone: '', web: '', address: '', acct: '', terms: '', lead: '', notes: '', tags: '' }),
    seed: () => ({ name: 'Scene Change', cname: 'Dani Cruz', email: 'hire@scenechange.example', phone: '02 9319 4400', web: 'scenechange.example', address: '8 Euston Rd, Alexandria NSW 2015', acct: 'TT-2209', terms: 'Net 14', lead: '2 working days', notes: 'Delivers to Warehouse A dock before 10:00.', tags: 'sub-hire, lighting' }),
    sections: [
      { t: 'Identity', hint: 'Who we buy or sub-hire from.', fields: [fd('name', 'Name', { req: true, max: 200, reqMsg: 'Name is required' })] },
      { t: 'Contact', hint: 'Who answers the phone.', fields: [fd('cname', 'Contact name', { max: 200 }), [fd('email', 'Email', { type: 'email', max: 200, check: v => emailOk(v.email) ? '' : 'Invalid email' }), fd('phone', 'Phone', { type: 'tel', max: 50 })], fd('web', 'Website', { max: 500, ph: 'example.com.au' })] },
      { t: 'Address', hint: 'Where to collect or send.', fields: [fd('address', 'Address', { max: 500 })] },
      { t: 'More details', hint: 'Account, terms and notes. Orders are raised from the record.', opt: true, fields: [[fd('acct', 'Account #', { max: 100, mono: true }), fd('terms', 'Payment terms', { max: 100 })], fd('lead', 'Default lead time', { max: 100, ph: 'e.g. 2 working days' }), fd('notes', 'Notes', { type: 'textarea', max: 2000 }), fd('tags', 'Tags')] }] },

  { key: 'order', name: 'Supplier order', noun: 'supplier order', group: 1, newR: '/suppliers/[id]/orders/new', editR: '/suppliers/[id]/orders/[orderId]/edit', over: 'the supplier', cta: 'Create order', moreLabel: 'Dates and notes', title: v => v.num,
    blank: () => ({ supplier: 'Scene Change', num: 'PO-0413', type: 'SUBHIRE', status: 'DRAFT', odate: '2026-11-09', edate: '', project: '', notes: '' }),
    seed: () => ({ supplier: 'Scene Change', num: 'PO-0412', type: 'SUBHIRE', status: 'ORDERED', odate: '2026-11-03', edate: '2026-11-10', project: '#2341 Hilton Sydney gala dinner', notes: 'Two Aura PXL, delivered to Warehouse A.' }),
    sections: [
      { t: 'Order', hint: 'Who it goes to and what it is.', fields: [
        fd('supplier', 'Supplier', { type: 'pick', src: () => SUPPLIERS, req: true, reqMsg: 'Supplier is required', ph: 'Search suppliers…', hint: f => f.mode === 'create' ? 'Prefilled when raised from a supplier record' : '' }),
        [fd('num', 'Order / PO #', { req: true, max: 100, mono: true, reqMsg: 'Order number is required' }), sel('type', 'Type', [['PURCHASE', 'Purchase'], ['SUBHIRE', 'Sub-hire'], ['REPAIR', 'Repair'], ['LABOUR', 'Labour'], ['OTHER', 'Other']])],
        sel('status', 'Status', [['DRAFT', 'Draft'], ['ORDERED', 'Ordered'], ['PARTIAL', 'Partly received'], ['RECEIVED', 'Received'], ['CANCELLED', 'Cancelled']])] },
      { t: 'Dates', hint: 'Optional · expected date feeds the job\'s sub-hire cover.', fields: [[fd('odate', 'Order date', { type: 'date' }), fd('edate', 'Expected date', { type: 'date', check: v => v.edate && v.odate && v.edate < v.odate ? 'Expected date cannot be before the order date' : '' })]] },
      { t: 'More details', hint: 'The job it covers, and notes.', opt: true, fields: [fd('project', 'For job', { type: 'pick', src: () => PROJECTS, ph: 'Search jobs — #2341, Hilton…', clearable: true, hint: 'Optional · links the order to a job' }), fd('notes', 'Notes', { type: 'textarea', max: 2000 })] }] },

  { key: 'maint', name: 'Maintenance job', noun: 'maintenance job', group: 2, newR: '/maintenance/new', editR: '/maintenance/[id]/edit', over: 'Maintenance', cta: 'Create job', moreLabel: 'Photos and tags', title: v => v.title,
    blank: () => ({ assets: [], title: '', type: 'REPAIR', status: 'SCHEDULED', by: 'Jayden Cole', to: '', desc: '', sched: '2026-11-12', done: '', cost: '', parts: '', result: '', next: '', disp: {}, tags: '' }),
    seed: () => ({ assets: ['AURA-06'], title: 'Fan fault — awaiting parts', type: 'REPAIR', status: 'AWAITING_PARTS', by: 'Sam Okafor', to: 'Tom Nguyen', desc: 'Head overheats after ten minutes. Fan bearing noisy.', sched: '2026-11-07', done: '', cost: '', parts: '', result: '', next: '', disp: {}, tags: 'fan' }),
    sections: [
      { t: 'Identity', hint: 'Which gear, and what is wrong.', fields: [
        { k: 'assets', label: 'Assets', type: 'multi', req: true, src: v => ASSETS.filter(a => !v.assets.includes(a.id)), ph: 'Search by tag or model — AURA-06, SK-0012…', hint: 'Search first · Enter adds the top result · add several for one job', reqMsg: 'Pick at least one asset', dep: true },
        fd('title', 'Title', { req: true, max: 200, reqMsg: 'Title is required' }),
        [sel('type', 'Type', [['REPAIR', 'Repair'], ['PREVENTATIVE', 'Preventative'], ['TEST_AND_TAG', 'Test & tag'], ['INSPECTION', 'Inspection'], ['CLEANING', 'Cleaning'], ['FIRMWARE_UPDATE', 'Firmware update']]), sel('status', 'Status', [['SCHEDULED', 'Scheduled'], ['AWAITING_PARTS', 'Awaiting parts'], ['IN_PROGRESS', 'In progress'], ['QA', 'QA'], ['COMPLETED', 'Completed'], ['CANCELLED', 'Cancelled']], { dep: true })],
        [sel('by', 'Reported by', PEOPLE.map(p => [p, p || 'Nobody'])), sel('to', 'Assigned to', PEOPLE.map(p => [p, p || 'Unassigned']))],
        fd('desc', 'Description', { type: 'textarea', max: 5000 })] },
      { t: 'Schedule', hint: v => v.status === 'COMPLETED' ? 'When it was booked and when it was finished.' : 'When it is booked for.', fields: [[fd('sched', 'Scheduled', { type: 'date' }), fd('done', 'Completed', { type: 'date', show: v => v.status === 'COMPLETED', check: v => v.status === 'COMPLETED' && v.done && v.sched && v.done < v.sched ? 'Completed cannot be before the scheduled date' : '' })]] },
      { t: 'Outcome', hint: 'Only for completed work · decides what happens to the gear.', show: v => v.status === 'COMPLETED', fields: [
        [mny('cost', 'Cost ($)'), fd('next', 'Next due', { type: 'date' })],
        fd('parts', 'Parts used', { max: 2000, ph: 'e.g. fan assembly, thermal paste' }),
        { k: 'result', label: 'Result', type: 'words', opts: [['PASS', 'Pass'], ['FAIL', 'Fail'], ['CONDITIONAL', 'Conditional']] },
        { k: 'disp', label: 'Each asset goes', type: 'disp' }] },
      { t: 'More details', hint: 'Photos and tags.', opt: true, fields: [fd('tags', 'Tags'), { k: 'photos', label: 'Photos', type: 'note', text: 'Photos are added from the job after it is saved · camera opens from your tap on phone.' }] }] },

  { key: 'sched', name: 'Service schedule', noun: 'service schedule', group: 2, small: true, newR: '/assets/models/[id] › Add schedule', editR: 'same dialog', over: 'the model page', cta: 'Create schedule', title: v => v.name,
    blank: () => ({ model: '', name: '', every: '12', anchor: '2026-11-09', how: '' }),
    seed: () => ({ model: 'Martin MAC Aura XB', name: 'Annual service', every: '12', anchor: '2025-12-12', how: 'Clean optics, lubricate zoom and focus, check fan.' }),
    sections: [{ t: null, fields: [
      fd('model', 'Model', { type: 'pick', src: () => MODELS, req: true, reqMsg: 'Model is required', ph: 'Search models…', tg: () => '' }),
      fd('name', 'Name', { req: true, max: 200, reqMsg: 'Name is required' }),
      [fd('every', 'Every (months)', { type: 'number', req: true, int: true, min: 1, max: 120, reqMsg: 'Interval is required', minMsg: 'Must be at least 1 month', maxMsg: 'Keep it to 120 months or fewer' }), fd('anchor', 'Starting from', { type: 'date', req: true, reqMsg: 'Anchor date is required' })],
      fd('how', 'Instructions', { type: 'textarea', max: 5000 })] }] },

  { key: 'job', name: 'New job', noun: 'job', group: 2, link: U.wizard, newR: '/projects/new', editR: '/projects/[id]/edit', over: 'the wizard', sections: [{ fields: [fd('a', 'a'), fd('b', 'b'), fd('c', 'c'), fd('d', 'd'), fd('e', 'e'), fd('f', 'f'), fd('g', 'g'), fd('h', 'h')] }] },
];
const GROUPS = ['Gear and places', 'People and suppliers', 'Maintenance and jobs'];
const FDEF = k => FORMS.find(x => x.key === k);
const flat = d => d.sections.flatMap(s => (s.fields || []).flatMap(x => Array.isArray(x) ? x : [x]));
const fcount = d => flat(d).length;
FORMS.forEach(d => { if (!d.link) state.recs[d.key] = d.seed(); });
const lab = (fdf, v) => typeof fdf.label === 'function' ? fdf.label(v) : fdf.label;
const cleanLabel = s => String(s).replace(/ \*$/, '').replace(/ \(.*\)$/, '').replace(/ · .*/, '').toLowerCase();
const labelOfSrc = (fdf, f, id) => { const it = (fdf.type === 'pick' ? fdf.src(f.v, f) : []).find(x => x.id === id); if (it) return it.label; if (fdf.k === 'parent') { const p = PLACES.find(x => x.id === id); return p ? p.label : ''; } return id || ''; };
const srcAll = (fdf, f) => { if (fdf.k === 'model') return fdf.src(); if (fdf.k === 'parent') return PLACES; return fdf.src(f.v, f); };
const pickLabel = (fdf, f) => { const v = f.v[fdf.k]; if (!v) return ''; const it = srcAll(fdf, f).find(x => x.id === v); return it ? it.label : v; };

// ---------- snapshot (Undo)
function snapshot() { const s = JSON.stringify({ recs: state.recs, last: state.last, tags: [...TAGS], ktags: [...KTAGS] }); return () => { const o = JSON.parse(s); state.recs = o.recs; state.last = o.last; TAGS.clear(); o.tags.forEach(t => TAGS.add(t)); KTAGS.clear(); o.ktags.forEach(t => KTAGS.add(t)); render(); }; }

// ---------- gallery
const rowsOf = () => { const q = state.q.trim().toLowerCase(); return FORMS.filter(d => !q || (d.name + ' ' + d.newR + ' ' + d.over + ' ' + d.noun).toLowerCase().includes(q)); };
const lastCell = d => { const l = state.last[d.key]; return l ? `<span class="dotw ok">Saved ${l.t}</span><div class="sub">${esc(l.what)}</div>` : d.link ? '<span class="faint">Opens the wizard</span>' : '<span class="faint">—</span>'; };
const fieldsCell = d => d.link ? '3 steps' : `${fcount(d)} fields`;
function render() {
  $('.crumb').innerHTML = '<b>Forms</b>'; document.title = 'Forms · RVLT Flow';
  const all = rowsOf(); $('#count').textContent = all.length;
  $('.phonehead > div').innerHTML = `<div class="ttl ell">Forms</div><div class="ell t-micro muted" id="phonesub">${FORMS.length} forms · every create and edit sheet, one component</div>`;
  $('.sidebar .foot a').setAttribute('href', U.settings);
  const nav = (n, c, h) => `<a href="${h}"><span class="patch" style="background:var(--${c}-soft)"></span>${n}</a>`;
  $('#sidenav').innerHTML = nav('Dashboard', 'blue', U.home) + nav('Jobs', 'blue', U.jobs) + nav('Finance', 'green', U.finance) + nav('Schedule', 'green', U.planner) + nav('Crew', 'purple', U.people) + nav('Assets', 'amber', U.assets) + nav('Warehouse', 'teal', U.floor) + nav('Test & tag', 'teal', U.scan) + nav('Maintenance', 'amber', U.gear);
  let h = `<table class="tbl" style="min-width:0;table-layout:fixed;width:100%"><colgroup><col style="width:210px"><col><col style="width:90px"><col style="width:230px"><col style="width:40px"></colgroup><thead><tr><th>Form</th><th>Route it replaces</th><th class="r" style="text-align:right">Fields</th><th>Last saved</th><th></th></tr></thead><tbody>`;
  if (!all.length) h += `<tr><td colspan="5"><div class="empty"><b>No form matches that</b>Try client, crew, asset or kit. <button class="lnk" data-act="clearq">Clear search</button></div></td></tr>`;
  GROUPS.forEach((g, gi) => { const ds = all.filter(d => d.group === gi); if (!ds.length) return; h += `<tr class="grp"><td colspan="5">${g}<span class="n">${ds.length}</span></td></tr>`; ds.forEach(d => { h += `<tr class="row" data-act="rowopen" data-k="${d.key}"><td><div class="nm">${d.name}</div></td><td><span class="mono">${d.newR}</span><span class="arrow">→</span><span class="muted">${d.link ? 'the wizard · 3 steps' : d.small ? 'stays a small dialog · ' + d.editR : 'sheet over ' + d.over}</span>${d.link ? '' : d.small ? '' : `<div class="sub"><span class="mono">${d.editR}</span> → <span class="mono">?edit=1</span> on the record</div>`}</td><td class="r rt2" style="text-align:right">${fieldsCell(d)}</td><td>${lastCell(d)}</td><td class="r"><button class="dots" data-act="rowmenu" data-k="${d.key}" aria-label="${d.name} actions">⋯</button></td></tr>`; }); });
  $('#tblwrap').innerHTML = h + '</tbody></table>';
  $('#list').innerHTML = all.length ? GROUPS.map((g, gi) => { const ds = all.filter(d => d.group === gi); return ds.length ? `<div class="lrow lhead"><b>${g}</b><span class="mono faint">${ds.length}</span></div>` + ds.map(d => { const l = state.last[d.key]; return `<div class="lrow" data-act="rowopen" data-k="${d.key}"><div class="grow"><div class="ttl ell">${d.name}</div><div class="sub ell">${l ? `<span class="dotw ok">Saved ${l.t}</span> ${esc(l.what)}` : `<span class="mono">${d.newR}</span> → ${d.link ? 'wizard' : d.small ? 'dialog' : 'sheet'}`}</div></div><div class="right"><span class="mono muted" style="font-size:12px">${fieldsCell(d)}</span></div><button class="dots" data-act="rowmenu" data-k="${d.key}" aria-label="${d.name} actions">⋯</button></div>`; }).join('') : ''; }).join('') : `<div class="empty"><b>No form matches that</b>Try client, crew, asset or kit. <button class="lnk" data-act="clearq">Clear search</button></div>`;
  $('#foot').innerHTML = `<span>${all.length} forms · ${FORMS.filter(d => !d.link).length} sheets and dialogs, one component</span><span style="margin-left:auto">Row opens Create · ⋯ opens Edit with a sample record</span>`;
}

// ---------- the sheet
function openForm(key, mode) {
  const d = FDEF(key); if (d.link) { window.open(d.link, '_blank'); return; }
  closeLayer();
  const v = mode === 'edit' ? clone(state.recs[key]) : d.blank();
  state.form = { def: d, mode, v, orig: mode === 'edit' ? clone(state.recs[key]) : null, touched: {}, tried: false, dirty: false, more: mode === 'edit', q: {}, open: {}, hi: {}, added: 0, discard: false, addc: false };
  if (mode === 'edit' && d.regKey) state.form.orig = { ...state.form.orig, [d.regKey]: state.form.orig[d.regKey] };
  try { history.replaceState(null, '', '#' + (mode === 'edit' ? 'edit' : 'new') + '/' + key); } catch (e) { }
  drawForm(mode === 'create' ? firstFocus(state.form) : null);
}
function firstFocus(f) { const x = flat(f.def).find(x => x.req && (!x.show || x.show(f.v, f))); return x ? 'f-' + x.k : null; }
const visible = (fdf, f) => !fdf.show || fdf.show(f.v, f);
function secVisible(s, f) { return (!s.show || s.show(f.v, f)) && (!s.opt || f.more || f.mode === 'edit'); }
function inputHTML(x, f) {
  const v = f.v, id = 'f-' + x.k, val = v[x.k] ?? '', L = lab(x, v), hintT = typeof x.hint === 'function' ? (x.hint.length > 1 ? x.hint(v, f) : x.hint(x.type === 'words' ? v : f)) : x.hint;
  const label = x.req && x.type !== 'check' ? `${esc(L)} *` : esc(L);
  const err = `<div class="err" id="e-${x.k}"></div>`, hint = hintT ? `<span class="t-micro muted">${esc(hintT)}</span>` : '';
  switch (x.type) {
    case 'check': return `<label class="chk"><input type="checkbox" id="${id}" ${val ? 'checked' : ''}><span>${esc(L)}</span></label>`;
    case 'note': return `<div class="cnote">${esc(x.text)}</div>`;
    case 'words': return `<div class="field"><label>${esc(L)}</label><div class="words" id="${id}">${x.opts.map(([o, t]) => `<button type="button" class="wd ${val === o ? 'on' : ''}" data-act="wsel" data-k="${x.k}" data-v="${o}">${t}</button>`).join('')}</div>${hintT ? `<span class="t-micro muted">${esc(typeof hintT === 'function' ? hintT(v) : hintT)}</span>` : ''}</div>`;
    case 'select': { const opts = typeof x.opts === 'function' ? x.opts(v) : x.opts; return `<div class="field" id="fw-${x.k}"><label>${label}</label><select id="${id}">${opts.map(([o, t]) => opt(o, esc(t), val)).join('')}</select>${hint}${err}</div>`; }
    case 'textarea': return `<div class="field" id="fw-${x.k}"><label>${label}</label><textarea id="${id}" rows="3" ${x.ph ? `placeholder="${esc(x.ph)}"` : ''}>${esc(val)}</textarea>${hint}${err}</div>`;
    case 'pick': return `<div class="field" id="fw-${x.k}"><label>${label}</label><div class="pk"><input id="${id}" class="pkin ${x.mono ? 'mono' : ''}" role="combobox" aria-expanded="${!!f.open[x.k]}" autocomplete="off" value="${esc(f.q[x.k] != null ? f.q[x.k] : pickLabel(x, f))}" placeholder="${esc(x.ph || '')}"><div class="pkl ${f.open[x.k] ? 'open' : ''}" id="pl-${x.k}">${f.open[x.k] ? listBody(x, f) : ''}</div></div>${hint}${err}</div>`;
    case 'multi': case 'contents': {
      const rows = x.type === 'multi' ? v.assets.map((a, i) => { const it = ASSETS.find(z => z.id === a); return `<div class="crow"><span class="id">${esc(a)}</span><div class="grow"><div style="font-weight:600">${esc(it ? it.label : a)}</div></div><span class="m">${esc(it ? it.sub : '')}</span><button type="button" class="x" data-act="rm" data-k="${x.k}" data-i="${i}" aria-label="Remove ${esc(a)}">✕</button></div>`; }).join('')
        : v.contents.map((c, i) => `<div class="crow"><span class="id">${esc(c.tg)}</span><div class="grow"><div style="font-weight:600">${esc(c.label)}</div></div>${c.bulk ? `<input id="q-${i}" type="number" min="1" value="${c.qty}" aria-label="Quantity">` : '<span class="m">1 unit</span>'}<button type="button" class="x" data-act="rm" data-k="${x.k}" data-i="${i}" aria-label="Remove ${esc(c.tg)}">✕</button></div>`).join('');
      return `<div class="field" id="fw-${x.k}"><label>${label}</label><div class="pk"><input id="${id}" class="pkin" role="combobox" autocomplete="off" value="${esc(f.q[x.k] || '')}" placeholder="${esc(x.ph || '')}"><div class="pkl ${f.open[x.k] ? 'open' : ''}" id="pl-${x.k}">${f.open[x.k] ? listBody(x, f) : ''}</div></div>${hint}${err}</div>${rows ? `<div class="crows" id="rows-${x.k}">${rows}</div>` : `<div class="cnote">${x.type === 'multi' ? 'No assets yet.' : 'Nothing in the kit yet.'}</div>`}`; }
    case 'disp': return `<div class="field"><label>${esc(L)}</label></div><div class="crows">${v.assets.length ? v.assets.map(a => `<div class="crow"><span class="id">${esc(a)}</span><div class="grow m">${esc((ASSETS.find(z => z.id === a) || {}).label || '')}</div><select id="d-${a}">${[['RETURN_TO_SERVICE', 'Return to service'], ['KEEP_OUT_OF_SERVICE', 'Keep out of service'], ['RETIRE', 'Retire']].map(([o, t]) => opt(o, t, v.disp[a] || (v.result === 'FAIL' ? 'KEEP_OUT_OF_SERVICE' : 'RETURN_TO_SERVICE'))).join('')}</select></div>`).join('') : '<div class="cnote">Pick the assets first.</div>'}</div>`;
    case 'contacts': return `<div class="crows">${v.contacts.map((c, i) => `<div class="crow"><div class="grow"><div style="font-weight:600">${esc(c.n)}</div><div class="m">${esc(c.r)}${c.e ? ' · ' + esc(c.e) : ''}${c.p ? ' · ' : ''}<span class="mono">${esc(c.p)}</span></div></div><button type="button" class="x" data-act="rm" data-k="contacts" data-i="${i}" aria-label="Remove ${esc(c.n)}">✕</button></div>`).join('') || '<div class="cnote">No contacts yet.</div>'}</div>${f.addc ? `<div class="minif"><div class="field"><label>Name *</label><input id="c-n" autocomplete="off"><div class="err" id="c-ne"></div></div><div class="field"><label>Role</label><input id="c-r"></div><div class="field"><label>Email</label><input id="c-e" type="email"><div class="err" id="c-ee"></div></div><div class="field"><label>Phone</label><input id="c-p" type="tel"></div><div class="full"><button type="button" class="btn btn-secondary btn-sm" data-act="cadd">Add contact</button><button type="button" class="lnk muted" data-act="cshow">Cancel</button></div></div>` : `<button type="button" class="lnk" data-act="cshow">+ Add contact</button>`}`;
    default: return `<div class="field" id="fw-${x.k}"><label>${label}</label><input id="${id}" type="${x.type === 'number' ? 'number' : x.type}" ${x.type === 'number' ? `inputmode="decimal" ${x.min != null ? `min="${x.min}"` : ''} ${x.max != null && x.type === 'number' ? `max="${x.max}"` : ''} step="${x.step || (x.money ? '0.01' : x.int ? '1' : 'any')}"` : x.max ? `maxlength="${x.max + 20}"` : ''} class="${x.mono ? 'mono' : ''}" value="${esc(val)}" ${x.ph ? `placeholder="${esc(x.ph)}"` : ''} autocomplete="off">${hint}${err}</div>`;
  }
}
function listBody(x, f) {
  const q = (f.q[x.k] || '').toLowerCase(), all = srcAll(x, f), tgOf = it => x.tg ? x.tg(it) : (it.tg || '');
  const res = all.filter(it => !q || (it.label + ' ' + (it.tg || '') + ' ' + (it.sub || '')).toLowerCase().includes(q)).slice(0, 6);
  f.res = f.res || {}; f.res[x.k] = res; const hi = Math.min(f.hi[x.k] || 0, Math.max(0, res.length - 1));
  return res.length ? res.map((it, i) => `<button type="button" class="res2 ${i === hi ? 'on' : ''}" data-act="pick" data-k="${x.k}" data-v="${esc(it.id)}"><div style="min-width:0"><div class="nm2">${esc(it.label)}</div><div class="t-micro muted">${esc(it.sub || '')}</div></div><span class="tg">${esc(tgOf(it))}</span></button>`).join('') : `<div class="none">Nothing matches “${esc(f.q[x.k] || '')}”</div>`;
}
function drawForm(focus, keep) {
  const f = state.form, d = f.def, edit = f.mode === 'edit', old = $('.dlg .bd', body), sc = old ? old.scrollTop : 0;
  const title = edit ? esc(d.title(f.orig)) : `New ${d.noun}`;
  const kinds = d.kindSwitch && !edit ? `<div class="words" style="margin-top:8px;border:0"><button class="wd ${d.key === 'asset' ? 'on' : ''}" data-act="swform" data-k="asset">Serialised unit</button><button class="wd ${d.key === 'bulk' ? 'on' : ''}" data-act="swform" data-k="bulk">Bulk stock</button></div>` : '';
  const ov = edit ? 'Edit ' + d.noun : 'Create';
  const hd = d.small ? `<div class="hd"><div class="t-overline">${ov}</div><h2 style="font-size:18px">${title}</h2></div>` : `<div class="hd"><div class="t-overline">${ov}</div><h2>${edit && d.key === 'asset' ? `<span class="mono" style="font-size:19px">${title}</span> · ${esc(f.orig.model)}` : title}</h2>${kinds}${f.added ? `<div class="t-small muted" style="margin-top:6px">${f.added} added this session · keeping ${(d.again || []).length ? d.keepText || 'the settings that repeat' : ''}</div>` : ''}</div>`;
  let bd = '', hidden = [];
  d.sections.forEach(s => {
    if (s.opt && !secVisible(s, f)) { hidden.push(s.t); return; }
    if (!secVisible(s, f)) return;
    const rows = (s.fields || []).map(x => { if (Array.isArray(x)) { const vis = x.filter(y => visible(y, f)); if (!vis.length) return ''; return `<div class="${vis.length === 3 ? 'g3' : vis.length === 1 ? '' : 'g2'}">${vis.map(y => inputHTML(y, f)).join('')}</div>`; } return visible(x, f) ? inputHTML(x, f) : ''; }).join('');
    const hint = typeof s.hint === 'function' ? s.hint(f.v, f) : s.hint;
    bd += `<div class="fsec">${s.t ? `<div class="fh"><b>${s.t}</b><span>${esc(hint || '')}</span></div>` : ''}${rows}</div>`;
  });
  if (hidden.length) bd += `<div class="fsec"><button type="button" class="lnk" data-act="moretoggle">${d.moreLabel || 'More details'} ▾</button></div>`;
  const again = d.again && !edit ? `<button class="btn btn-secondary again" data-act="formadd">Save and add another</button>` : '';
  const ft = f.discard ? `<div class="discard">Discard your changes?</div><button class="btn btn-secondary" data-act="keep">Keep editing</button><button class="btn btn-secondary" style="color:var(--t-out)" data-act="discard">Discard</button>` : `<div class="sp" style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button>${again}<button class="btn btn-primary" data-act="formgo">${edit ? 'Save' : d.cta}</button>`;
  openDialog(`${hd}<div class="bd">${bd}</div><div class="ft">${ft}</div>`, el => { el.classList.add(d.small ? 'small' : 'wide'); if (!d.small) el.classList.add('sheet'); const b = $('.bd', el); if (keep !== false) b.scrollTop = sc; if (focus) { const t = $('#' + focus, el); if (t) { t.focus(); if (t.select && !/^(f-(tag|model))$/.test(focus) === false) { try { t.select(); } catch (e) { } } if (keep && typeof keep === 'object' && t.setSelectionRange && keep.pos != null) { try { t.setSelectionRange(keep.pos, keep.pos); } catch (e) { } } } } });
  showErrs();
}

// ---------- validation
function errorsOf(f) {
  const e = {}, v = f.v;
  flat(f.def).forEach(x => {
    const sec = f.def.sections.find(s => (s.fields || []).flat().includes(x)); if (sec && !secVisible(sec, f)) return; if (!visible(x, f)) return;
    const val = v[x.k], s = typeof val === 'string' ? val.trim() : val;
    if (x.type === 'multi') { if (x.req && !v.assets.length) e[x.k] = x.reqMsg; return; }
    if (x.type === 'contents' || x.type === 'contacts' || x.type === 'words' || x.type === 'disp' || x.type === 'note' || x.type === 'check') return;
    if (x.req && (s === '' || s == null)) { e[x.k] = x.reqMsg || `${cleanLabel(lab(x, v))} is required`.replace(/^./, c => c.toUpperCase()); return; }
    if (x.type === 'number' && s !== '') { const n = +s; if (isNaN(n)) e[x.k] = x.money ? MONEY : 'Enter a number'; else if (x.int && !Number.isInteger(n)) e[x.k] = 'Enter a whole number'; else if (x.min != null && n < x.min) e[x.k] = x.money ? MONEY : x.minMsg || x.rangeMsg || `Enter ${x.min} or more`; else if (x.max != null && n > x.max) e[x.k] = x.maxMsg || x.rangeMsg || `Enter ${x.max} or less`; }
    if (!e[x.k] && x.type !== 'number' && x.max && typeof s === 'string' && s.length > x.max) e[x.k] = x.maxMsg || `Keep it to ${x.max} characters`;
    if (!e[x.k] && x.check) { const m = x.check(v, f); if (m) e[x.k] = m; }
  });
  return e;
}
function showErrs() {
  const f = state.form; if (!f) return; const e = errorsOf(f); f.errs = e;
  flat(f.def).forEach(x => { const el = $('#e-' + x.k, body), w = $('#fw-' + x.k, body), show = (f.touched[x.k] || f.tried) && e[x.k]; if (el) el.textContent = show ? e[x.k] : ''; if (w) w.classList.toggle('bad', !!show); });
  return e;
}

// ---------- input wiring (delegated on the layer body)
function readInput(t) {
  const f = state.form; if (!f) return; const id = t.id || '';
  if (id.startsWith('f-')) {
    const k = id.slice(2), x = flat(f.def).find(y => y.k === k); if (!x) return;
    f.dirty = true; f.touched[k] = true;
    if (x.type === 'pick' || x.type === 'multi' || x.type === 'contents') {
      f.q[k] = t.value; f.open[k] = true; f.hi[k] = 0;
      if (x.type === 'pick') { f.v[k] = ''; }
      const l = $('#pl-' + k, body); l.innerHTML = listBody(x, f); l.classList.add('open'); showErrs(); return;
    }
    f.v[k] = t.type === 'checkbox' ? t.checked : t.value;
    if (x.dep || t.tagName === 'SELECT' && x.dep) { drawForm(id, { pos: t.selectionStart }); return; }
    if (k === 'loc' || k === 'tt') drawForm(id, {});
    showErrs();
  } else if (/^q-\d+$/.test(id)) { f.v.contents[+id.slice(2)].qty = Math.max(1, +t.value || 1); f.dirty = true; }
  else if (id.startsWith('d-')) { f.v.disp[id.slice(2)] = t.value; f.dirty = true; }
}
document.addEventListener('input', ev => { if (state.form && ev.target.closest('#layerbody')) readInput(ev.target); });
document.addEventListener('change', ev => { if (state.form && ev.target.closest('#layerbody') && ev.target.tagName === 'SELECT') readInput(ev.target); });
document.addEventListener('focusin', ev => { const f = state.form, t = ev.target; if (!f || !t.classList || !t.classList.contains('pkin')) return; const k = t.id.slice(2), x = flat(f.def).find(y => y.k === k); if (!x) return; if (x.type === 'pick' && f.q[k] == null) { try { t.select(); } catch (e) { } } if (!f.open[k]) { f.open[k] = true; f.hi[k] = 0; if (x.type === 'pick' && f.q[k] == null) f.q[k] = ''; const l = $('#pl-' + k, body); l.innerHTML = listBody(x, f); l.classList.add('open'); } });
document.addEventListener('focusout', ev => { const f = state.form, t = ev.target; if (!f || !t.classList || !t.classList.contains('pkin')) return; const k = t.id.slice(2); setTimeout(() => { if (state.form !== f) return; const a = document.activeElement; if (a && a.id === t.id) return; f.open[k] = false; const x = flat(f.def).find(y => y.k === k); if (x && x.type === 'pick') delete f.q[k]; if (x && x.type !== 'pick') f.q[k] = ''; const l = $('#pl-' + k, body); if (l) { l.classList.remove('open'); } const inp = $('#f-' + k, body); if (inp && x) inp.value = x.type === 'pick' ? pickLabel(x, f) : ''; showErrs(); }, 120); });
document.addEventListener('mousedown', ev => { if (ev.target.closest('.pkl')) ev.preventDefault(); });
document.addEventListener('keydown', ev => {
  const f = state.form; if (!f) return; const t = ev.target;
  if (t.classList && t.classList.contains('pkin')) {
    const k = t.id.slice(2), x = flat(f.def).find(y => y.k === k), n = (f.res && f.res[k] || []).length;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); f.open[k] = true; f.hi[k] = ((f.hi[k] || 0) + (ev.key === 'ArrowDown' ? 1 : -1) + Math.max(n, 1)) % Math.max(n, 1); const l = $('#pl-' + k, body); l.innerHTML = listBody(x, f); l.classList.add('open'); return; }
    if (ev.key === 'Enter') { ev.preventDefault(); const it = (f.res && f.res[k] || [])[f.hi[k] || 0]; if (f.open[k] && it) pick(k, it.id); return; }
    return;
  }
  if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); act('formgo'); return; }
  if (ev.key === 'Enter' && t.tagName === 'INPUT' && t.type !== 'checkbox' && !(t.id || '').startsWith('q-')) { ev.preventDefault(); if ((t.id || '').startsWith('c-')) act('cadd'); else act('formgo'); }
}, true);
window.addEventListener('keydown', ev => { if (ev.key !== 'Escape' || !state.form) return; ev.stopPropagation(); ev.preventDefault(); const f = state.form, k = Object.keys(f.open).find(z => f.open[z]); if (k) { f.open[k] = false; const l = $('#pl-' + k, body); if (l) l.classList.remove('open'); return; } act('close'); }, true);

function pick(k, id) {
  const f = state.form, x = flat(f.def).find(y => y.k === k), all = srcAll(x, f), it = all.find(z => z.id === id); if (!it) return;
  f.dirty = true; f.touched[k] = true; f.open[k] = false; delete f.q[k];
  if (x.type === 'pick') { f.v[k] = id; if (f.def.onPick) f.def.onPick(f, k, it); drawForm(x.next || null); return; }
  if (x.type === 'multi') { f.v.assets.push(id); f.q[k] = ''; f.open[k] = true; f.hi[k] = 0; drawForm('f-' + k); return; }
  if (x.type === 'contents') { f.v.contents.push({ id: it.id, label: it.label, tg: it.tg, qty: 1, bulk: !!it.bulk }); f.q[k] = ''; f.open[k] = true; f.hi[k] = 0; drawForm('f-' + k); }
}

// ---------- commit
function diffLabels(f) { const o = f.orig, v = f.v, ch = []; flat(f.def).forEach(x => { if (['words', 'note'].includes(x.type) && x.type === 'note') return; if (JSON.stringify(o[x.k] ?? '') !== JSON.stringify(v[x.k] ?? '')) ch.push(x.k === 'contacts' ? 'contacts' : x.k === 'contents' ? 'contents' : x.k === 'disp' ? 'dispositions' : cleanLabel(lab(x, v))); }); return ch; }
function closeForm() { closeLayer(); state.form = null; try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { } }
function commit(again) {
  const f = state.form, d = f.def; f.tried = true; const e = showErrs();
  if (Object.keys(e).length) { const k = flat(d).find(x => e[x.k]).k, i = $('#f-' + k, body) || $('#fw-' + k, body); if (i && i.focus) i.focus(); return; }
  const v = clone(f.v); ['tag', 'num'].forEach(k => { if (typeof v[k] === 'string' && k === 'tag') v[k] = v[k].trim().toUpperCase(); });
  const undo = snapshot(); state.clock++; const title = d.title(v);
  if (d.regKey) { if (f.mode === 'edit') d.reg.delete(f.orig[d.regKey]); d.reg.add(v[d.regKey]); }
  if (f.mode === 'edit') {
    const ch = diffLabels({ ...f, v }); if (!ch.length) { state.clock--; closeForm(); toast(`${esc(title)} · nothing changed`); render(); return; }
    state.recs[d.key] = v; state.last[d.key] = { t: nowt(), what: `Edited ${title} · ${ch.join(', ')}` }; closeForm(); render(); toast(`${esc(title)} saved · ${esc(ch.join(', '))}`, undo); return;
  }
  state.last[d.key] = { t: nowt(), what: `Created ${title}` };
  if (again) {
    const keep = d.again || [], nv = d.blank(); keep.forEach(k => { nv[k] = v[k]; }); if (d.advance) d.advance(nv);
    f.v = nv; f.touched = {}; f.tried = false; f.dirty = false; f.added++; f.q = {}; f.open = {}; d.keepText = d.key === 'asset' ? 'model, location and condition' : d.key === 'crew' ? 'type, status and rates' : 'parent and type';
    render(); drawForm(d.key === 'asset' ? 'f-serial' : d.key === 'crew' ? 'f-first' : 'f-name', false); toast(`${esc(title)} created · ${d.key === 'asset' ? esc(v.model) + ' kept for the next one' : 'the form is ready for the next one'}`, undo); return;
  }
  const extra = d.key === 'client' ? ' · add contacts from its record' : d.key === 'asset' ? ' · nothing is checked yet' : d.key === 'supplier' ? ' · raise an order from its record' : '';
  closeForm(); render(); toast(`${esc(title)} created${extra}`, undo);
}

// ---------- actions
function act(name, el, ev) {
  const f = state.form;
  switch (name) {
    case 'noop': closeLayer(); toast('Not wired in this prototype'); break;
    case 'toastclose': $('#toast').classList.remove('open'); break;
    case 'undo': if (state.undo) { const u = state.undo; state.undo = null; u(); } $('#toast').classList.remove('open'); break;
    case 'clearq': state.q = ''; $('#q').value = ''; render(); break;
    case 'rowopen': openForm(el.dataset.k, 'create'); break;
    case 'open': openForm(el.dataset.k, el.dataset.m); break;
    case 'newjob': closeLayer(); window.open(U.wizard, '_blank'); break;
    case 'rowmenu': { const d = FDEF(el.dataset.k); openMenu(el, d.name, d.link ? [{ label: 'Create — open the wizard ↗', href: U.wizard, small: 'artifact' }, { label: 'Edit a job — same wizard ↗', href: U.wizard, small: 'artifact' }] : [{ label: `Create ${d.noun}…`, act: 'open', args: `data-k="${d.key}" data-m="create"`, small: d.newR.length < 26 ? d.newR : '' }, { label: `Edit ${esc(d.title(state.recs[d.key]))}…`, act: 'open', args: `data-k="${d.key}" data-m="edit"`, small: 'prefilled' }]); break; }
    case 'pagemenu': openMenu(el, 'Forms', [{ label: 'New job wizard', href: U.wizard, small: 'artifact' }, { sh: 'The records these sheets open over' }, { label: 'Assets list', href: U.assets }, { label: 'Asset detail', href: U.asset }, { label: 'Model detail', href: U.model }, { label: 'People lists', href: U.people }, { label: 'Gear lists', href: U.gear }, { label: 'Settings', href: U.settings }, '-', { sh: 'In a sheet · Esc closes, ⌘↵ saves' }]); break;
    case 'close': if (f && f.dirty && !f.discard) { f.discard = true; drawForm(null, true); } else if (f) closeForm(); else closeLayer(); break;
    case 'keep': f.discard = false; drawForm(null, true); break;
    case 'discard': closeForm(); toast('Changes discarded'); break;
    case 'formgo': if (f) commit(false); break;
    case 'formadd': if (f) commit(true); break;
    case 'moretoggle': f.more = true; drawForm(null, true); break;
    case 'wsel': f.v[el.dataset.k] = el.dataset.v; f.dirty = true; drawForm(null, true); break;
    case 'swform': { if (!f || f.def.key === el.dataset.k) break; openForm(el.dataset.k, 'create'); break; }
    case 'pick': pick(el.dataset.k, el.dataset.v); break;
    case 'rm': { const k = el.dataset.k, i = +el.dataset.i; f.dirty = true; (k === 'assets' ? f.v.assets : k === 'contents' ? f.v.contents : f.v.contacts).splice(i, 1); drawForm(null, true); break; }
    case 'cshow': f.addc = !f.addc; drawForm(f.addc ? 'c-n' : null, true); break;
    case 'cadd': { const n = $('#c-n', body), em = $('#c-e', body); if (!n) break; let bad = false; $('#c-ne', body).textContent = ''; $('#c-ee', body).textContent = ''; if (!n.value.trim()) { $('#c-ne', body).textContent = 'Name is required'; bad = true; } if (!emailOk(em.value.trim())) { $('#c-ee', body).textContent = 'Invalid email'; bad = true; } if (bad) { (n.value.trim() ? em : n).focus(); break; } f.v.contacts.push({ n: n.value.trim(), r: $('#c-r', body).value.trim(), e: em.value.trim(), p: $('#c-p', body).value.trim() }); f.dirty = true; f.addc = false; drawForm(null, true); break; }
  }
}
$('#q').addEventListener('input', e => { state.q = e.target.value; render(); });
document.addEventListener('keydown', ev => { if (ev.key === '/' && !state.form && !ev.target.matches('input,textarea,select')) { ev.preventDefault(); $('#q').focus(); } });
render();
{ const m = (location.hash || '').match(/^#(new|edit)\/(\w+)$/); if (m && FDEF(m[2])) openForm(m[2], m[1] === 'edit' ? 'edit' : 'create'); }
