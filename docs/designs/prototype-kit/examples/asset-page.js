// ---------- Asset detail · data
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const TODAY = '2026-11-09', NOWT = '09:41', ME = 'Jayden Cole';
const LIST = 'https://claude.ai/artifact/89PDTuMiovgP9i3h4MJ1Tw', OV = 'https://claude.ai/artifact/RatKsWfTmDJLJHmn6mb7Zo', WH = 'https://claude.ai/artifact/Mt8p55xkPkkexVWPC5eaGU', JOBSL = 'https://claude.ai/artifact/A7SMPtpTr3aedUDEnuSaxd', FINURL = 'https://claude.ai/artifact/7ByfxnbtsgQTJdiwvvo1CY';
const MODELURL = 'https://claude.ai/artifact/47miWruJVsednbzrFPij2b', GEAR = 'https://claude.ai/artifact/D7N5PmXKrkcY2gzZXWeuvc', SCANURL = 'https://claude.ai/artifact/8Q2HVoRhLbSLz1Q9mCtayX';
const rnd = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(11);
const addD = (d, n) => new Date((dayNum(d) + n) * 864e5).toISOString().slice(0, 10);
const dow = d => (((dayNum(d) - dayNum('2026-11-11') + 2) % 7) + 7) % 7; // fixture calendar: 11 Nov 2026 is a Tuesday
const wdn = d => WD[dow(d)];
const sd = d => `${wdn(d)} ${+d.slice(8, 10)} ${MON[+d.slice(5, 7) - 1]}`;
const rng = (a, b) => (!b || a === b) ? fmtD(a) : fmtRange(a, b);
const fmtL = d => d ? `${+d.slice(8, 10)} ${MON[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}` : '';
const addM = (d, m) => { let y = +d.slice(0, 4), mo = +d.slice(5, 7) - 1 + m; y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12; return `${y}-${String(mo + 1).padStart(2, '0')}-${d.slice(8, 10)}`; };
const until = d => dayNum(d) - dayNum(TODAY);
const mondayOf = d => addD(d, -((dow(d) + 6) % 7));
const atStr = s => { const d = s.slice(0, 10); return d === TODAY ? `Today ${s.slice(11)}` : `${sd(d)} ${s.slice(11)}`; };
const JOBS = {
  '#2341': { name: 'Hilton Sydney gala dinner', out: '2026-11-11' }, '#2338': { name: 'Corporate AGM' }, '#2340': { name: 'Launch night' }, '#2350': { name: 'Qantas awards' },
  '#2314': { name: 'UNSW graduation' }, '#2302': { name: 'Telstra roadshow' }, '#2296': { name: 'Marriott conference' }, '#2281': { name: 'Open day staging' },
};
const STATUS = { AVAILABLE: ['Available', 'ok'], DEPLOYED: ['Deployed', 'live'], RESERVED: ['Reserved', 'info'], IN_MAINTENANCE: ['In maintenance', 'warn'], RETIRED: ['Retired', ''], MISSING: ['Missing', 'err'] };
const BSTATE = { RESERVED: ['Reserved', 'info'], DEPLOYED: ['Deployed', 'live'], PENCILLED: ['Pencilled', ''], SERVICE: ['Service', 'warn'], RETURNED: ['Returned', 'ok'] };
const MSTATUS = { SCHEDULED: ['Scheduled', 'info'], IN_PROGRESS: ['In progress', 'warn'], OPEN: ['Open', 'warn'], DONE: ['Done', 'ok'] };
const MTYPE = { SERVICE: 'Service', REPAIR: 'Repair', TT: 'Test & tag', INSPECTION: 'Inspection' };
const RES = { PASS: ['Pass', 'ok'], FAIL: ['Fail', 'err'], NOTES: ['Notes', ''] };
const CONDS = ['New', 'Good', 'Fair', 'Poor', 'Needs repair'];
const LOCS = { 'Warehouse A': ['A1', 'A2', 'A3', 'A3-14', 'B1', 'B2', 'C4'], 'Warehouse B': ['B1', 'B2', 'D1'], 'Van 2': [], 'Workshop': ['Bench 1', 'Bench 2'] };
const MODELS = [
  { name: 'Martin MAC Aura XB', cat: 'Lighting', code: 'AURA', pad: 2, next: 7, own: 6, tt: true, repl: 3200, supplier: 'Martin Pro Audio' },
  { name: 'Martin MAC Aura PXL', cat: 'Lighting', code: 'L', pad: 4, next: 9, own: 8, tt: true, repl: 4100, supplier: 'Martin Pro Audio' },
  { name: 'Sennheiser EW-DX SK beltpack', cat: 'Audio', code: 'SK', pad: 4, next: 43, own: 42, tt: false, repl: 900, supplier: 'Sennheiser AU' },
  { name: 'Shure ULXD4Q', cat: 'Audio', code: 'ULXD', pad: 2, next: 4, own: 3, tt: true, repl: 4200, supplier: 'Shure Distribution' },
  { name: 'd&b Y8', cat: 'Audio', code: 'Y8', pad: 4, next: 9, own: 8, tt: true, repl: 3600, supplier: 'd&b audiotechnik' },
  { name: 'Barco UDX-4K32', cat: 'Video', code: 'V', pad: 4, next: 3, own: 2, tt: true, repl: 68000, supplier: 'Barco AU' },
  { name: 'Robe T1 Profile', cat: 'Lighting', code: 'T1', pad: 2, next: 5, own: 4, tt: true, repl: 7900, supplier: 'Robe Australia' },
  { name: 'GrandMA3 light', cat: 'Lighting', code: 'MA3', pad: 2, next: 3, own: 2, tt: true, repl: 29000, supplier: 'MA Lighting AU' },
  { name: 'Blackmagic ATEM 2 M/E', cat: 'Video', code: 'ATEM', pad: 2, next: 4, own: 3, tt: true, repl: 6200, supplier: 'Blackmagic AU' },
  { name: 'Rigging clamp bar', cat: 'Rigging', code: 'RC', pad: 4, next: 8, own: 7, tt: false, repl: 140, supplier: 'Prolyte AU' },
];
const BULKM = [['XLR 10m', 'XLR10'], ['Socapex 20m', 'SOCA20'], ['Powercon 5m', 'PC5']];
const fmtTag = (m, n) => `${m.code}-${String(n).padStart(m.pad, '0')}`;
const modelOf = name => MODELS.find(m => m.name === name);
const locStr = a => a.bin ? `${a.loc} / ${a.bin}` : a.loc;

// ---------- the asset world (hand-set rows tell the story; the rest is defaults)
const baseAsset = () => ({ serial: '', barcode: '', customName: '', tags: [], custom: {}, specs: [], owner: 'Owned', supplier: '', order: '', purchased: '', cost: null, repl: null, warranty: '', tt: { req: false, last: null, next: null }, svc: { every: null, last: null }, container: '', kit: null, parent: null, book: [], jobs: [], maint: [], checks: [], events: [], notes: '', notesBy: '', notesAt: '', threads: [], photos: [], docs: [], acc: { serial: [], bulk: [] }, lastScan: null, bin: '', cond: 'Good', status: 'AVAILABLE' });
const E = (at, who, text, job) => ({ at, who, text, job: job || '' });
const MDOCS = [['MAC Aura XB user manual.pdf', '4.8 MB', 'Manual'], ['Rigging and safety sheet.pdf', '310 KB', 'Safety'], ['DMX personality chart.pdf', '96 KB', 'Spec']];
let ASSETS = {};
ASSETS['AURA-01'] = { ...baseAsset(), tag: 'AURA-01', model: 'Martin MAC Aura XB', cat: 'Lighting', code: 'AURA', serial: 'MA2043116', barcode: '9318201004411', status: 'RESERVED', cond: 'Good', loc: 'Warehouse A', bin: 'B2', supplier: 'Martin Pro Audio', order: 'PO-1187', purchased: '2023-03-14', cost: 2640, repl: 3200, warranty: '2028-03-14', tags: ['moving head', 'touring'], custom: { Firmware: '1.4.2' }, specs: [['Weight', '7.9 kg'], ['Power', '400 W'], ['Source', 'LED 40 W RGBW']],
  tt: { req: true, last: '2025-11-19', next: '2026-11-19', rec: 'tt-0231' }, svc: { every: 6, last: '2026-06-12' }, container: 'LX-02',
  book: [{ job: '#2341', from: '2026-11-12', to: '2026-11-14', state: 'RESERVED', note: 'packed in case LX-02 · truck Tue 11 Nov 06:30' }, { job: '#2338', from: '2026-11-21', to: '2026-11-21', state: 'RESERVED', note: 'single day' }, { job: '#2350', from: '2026-12-04', to: '2026-12-05', state: 'PENCILLED', note: 'quote sent' }],
  jobs: [{ job: '#2314', out: '2026-10-29', back: '2026-10-31' }, { job: '#2302', out: '2026-10-13', back: '2026-10-16' }, { job: '#2296', out: '2026-10-01', back: '2026-10-03' }, { job: '#2281', out: '2026-09-17', back: '2026-09-19' }],
  maint: [{ id: 'm1', title: 'Annual service', type: 'SERVICE', status: 'SCHEDULED', date: '2026-12-12', result: '' }, { id: 'm2', title: 'Lamp engine replaced', type: 'SERVICE', status: 'DONE', date: '2026-06-12', result: 'PASS' }, { id: 'm3', title: 'Zoom motor noise', type: 'REPAIR', status: 'DONE', date: '2026-03-03', result: 'PASS', issue: true }, { id: 'm4', title: 'Test & tag', type: 'TT', status: 'DONE', date: '2025-11-19', result: 'PASS' }],
  checks: [
    { id: 's1', ctx: 'PREP', job: '#2341', who: 'Sam Okafor', at: '2026-11-07 16:40', recs: [{ label: 'Lens clean', r: 'PASS' }, { label: 'Pan / tilt travel', r: 'PASS', v: 'full range' }, { label: 'Fan noise', r: 'PASS', v: 'quiet' }, { label: 'Gobo wheel', r: 'NOTES', n: 'Dust spot on lens 2 — cosmetic', ph: 1 }] },
    { id: 's2', ctx: 'RETURN', job: '#2314', who: 'Sam Okafor', at: '2026-10-31 17:05', recs: [{ label: 'Lens clean', r: 'PASS' }, { label: 'Casing', r: 'PASS' }, { label: 'Clamp and safety bond', r: 'PASS' }] },
    { id: 's3', ctx: 'PREP', job: '#2314', who: 'Tom Nguyen', at: '2026-10-28 15:20', recs: [{ label: 'Lens clean', r: 'PASS' }, { label: 'Pan / tilt travel', r: 'PASS' }, { label: 'Fan noise', r: 'PASS' }] }],
  events: [E('2026-11-07 16:42', 'Sam Okafor', 'packed it into case LX-02 for', '#2341'), E('2026-11-03 09:00', 'Tom Nguyen', 'moved it from Warehouse B to Warehouse A / B2'), E('2026-06-12 14:00', 'Tom Nguyen', 'logged a service · lamp engine replaced'), E('2026-03-03 10:30', 'Jayden Cole', 'reported a fault · zoom motor noise'), E('2025-11-19 10:15', 'Tom Nguyen', 'passed test & tag · next due 19 Nov 2026'), E('2023-03-14 09:00', 'Mel Torres', 'added it · purchased from Martin Pro Audio')],
  notes: 'Lens 2 has a faint dust spot (7 Nov) — cosmetic, fine for the gala. Clean before the AGM.', notesBy: 'Sam Okafor', notesAt: '2026-11-07',
  threads: [{ id: 't1', by: 'Sam Okafor', at: 'Fri 7 Nov', text: 'Dust spot on lens 2 — fine to send out on the gala or do you want a spare?', status: 'open', replies: [{ by: 'Jayden Cole', at: 'Fri 7 Nov', text: 'Send it. AURA-05 is the spare if the client notices.' }] }],
  photos: [{ id: 'p1', name: 'AURA-01 front.jpg', size: '1.2 MB', by: 'Sam Okafor', at: '2023-03-15', primary: true }, { id: 'p2', name: 'Lens 2 dust spot.jpg', size: '860 KB', by: 'Sam Okafor', at: '2026-11-07' }],
  docs: MDOCS, acc: { serial: [{ tag: 'RC-0007', name: 'Rigging clamp bar' }], bulk: [{ id: 'b1', qty: 2, name: 'Omega clamp', model: true }, { id: 'b2', qty: 1, name: 'Safety bond', model: true }, { id: 'b3', qty: 1, name: 'Powercon 5m', model: false }] },
  lastScan: { at: '2026-11-07 16:42', who: 'Sam Okafor', where: 'Warehouse A', what: 'packing case LX-02' } };
ASSETS['AURA-03'] = { ...baseAsset(), tag: 'AURA-03', model: 'Martin MAC Aura XB', cat: 'Lighting', code: 'AURA', serial: 'MA2043118', status: 'DEPLOYED', cond: 'Fair', loc: 'Warehouse A', bin: 'A3', supplier: 'Martin Pro Audio', order: 'PO-1187', purchased: '2023-03-14', cost: 2640, repl: 3200, warranty: '2028-03-14', specs: [['Weight', '7.9 kg'], ['Power', '400 W']],
  tt: { req: true, last: '2025-10-28', next: '2026-10-28', rec: 'tt-0229' }, svc: { every: 6, last: '2026-07-20' }, container: 'LX-04',
  book: [{ job: '#2340', from: '2026-11-08', to: '2026-11-09', state: 'DEPLOYED', note: 'out Sat 8 Nov · due back today' }, { job: '#2341', from: '2026-11-12', to: '2026-11-14', state: 'RESERVED', note: 'case LX-04' }],
  jobs: [{ job: '#2314', out: '2026-10-29', back: '2026-10-31' }, { job: '#2302', out: '2026-10-13', back: '2026-10-16' }],
  maint: [{ id: 'm1', title: 'Zoom grinding at full travel', type: 'REPAIR', status: 'OPEN', date: '2026-11-08', result: '', issue: true }, { id: 'm2', title: 'Test & tag', type: 'TT', status: 'DONE', date: '2025-10-28', result: 'PASS' }],
  checks: [{ id: 's1', ctx: 'PREP', job: '#2340', who: 'Sam Okafor', at: '2026-11-07 15:30', recs: [{ label: 'Lens clean', r: 'PASS' }, { label: 'Zoom travel', r: 'FAIL', n: 'Grinding on full zoom', ph: 1 }] }],
  events: [E('2026-11-08 06:55', 'Tom Nguyen', 'deployed it to', '#2340'), E('2026-11-08 08:10', 'Tom Nguyen', 'reported a fault · zoom grinding at full travel', '#2340'), E('2023-03-14 09:00', 'Mel Torres', 'added it · purchased from Martin Pro Audio')],
  threads: [], photos: [], docs: MDOCS, acc: { serial: [], bulk: [{ id: 'b1', qty: 2, name: 'Omega clamp', model: true }, { id: 'b2', qty: 1, name: 'Safety bond', model: true }] },
  lastScan: { at: '2026-11-08 06:55', who: 'Tom Nguyen', where: 'Loading dock', what: 'deployed to #2340' } };
ASSETS['L-0007'] = { ...baseAsset(), tag: 'L-0007', model: 'Martin MAC Aura PXL', cat: 'Lighting', code: 'L', serial: 'PX3310007', status: 'IN_MAINTENANCE', cond: 'Needs repair', loc: 'Workshop', bin: 'Bench 1', supplier: 'Martin Pro Audio', purchased: '2024-02-02', cost: 3380, repl: 4100, warranty: '2026-02-02', specs: [['Weight', '9.4 kg'], ['Power', '620 W']],
  tt: { req: true, last: '2026-03-01', next: '2027-03-01', rec: 'tt-0312' }, svc: { every: 6, last: '2026-08-01' },
  jobs: [{ job: '#2314', out: '2026-10-29', back: '2026-10-31' }],
  maint: [{ id: 'm1', title: 'Pan motor failing', type: 'REPAIR', status: 'IN_PROGRESS', date: '2026-11-06', result: '', issue: true }, { id: 'm2', title: 'Test & tag', type: 'TT', status: 'DONE', date: '2026-03-01', result: 'PASS' }],
  checks: [{ id: 's1', ctx: 'RETURN', job: '#2314', who: 'Sam Okafor', at: '2026-10-31 17:20', recs: [{ label: 'Pan / tilt travel', r: 'FAIL', n: 'Pan stutters under load', ph: 2 }] }],
  events: [E('2026-11-06 11:10', 'Sam Okafor', 'booked it in for repair · pan motor failing'), E('2024-02-02 09:00', 'Mel Torres', 'added it · purchased from Martin Pro Audio')], photos: [], docs: MDOCS, acc: { serial: [], bulk: [] },
  lastScan: { at: '2026-11-06 11:10', who: 'Sam Okafor', where: 'Workshop', what: 'booked in for repair' } };
ASSETS['ULXD-03'] = { ...baseAsset(), tag: 'ULXD-03', model: 'Shure ULXD4Q', cat: 'Audio', code: 'ULXD', serial: 'SH88120043', status: 'AVAILABLE', cond: 'Good', loc: 'Warehouse A', bin: 'A3-14', supplier: 'Shure Distribution', purchased: '2024-08-20', cost: 3810, repl: 4200, warranty: '2027-08-20', specs: [['Channels', '4'], ['Band', 'G50']],
  tt: { req: true, last: '2026-01-10', next: '2027-01-10', rec: 'tt-0288' }, kit: { tag: 'K-0042', name: 'Shure ULXD4Q kit' },
  book: [{ job: '#2350', from: '2026-12-04', to: '2026-12-05', state: 'PENCILLED', note: 'in kit K-0042' }], jobs: [{ job: '#2314', out: '2026-10-29', back: '2026-10-31' }],
  maint: [{ id: 'm1', title: 'Test & tag', type: 'TT', status: 'DONE', date: '2026-01-10', result: 'PASS' }],
  checks: [{ id: 's1', ctx: 'RETURN', job: '#2314', who: 'Sam Okafor', at: '2026-10-31 17:12', recs: [{ label: 'Antenna ports', r: 'PASS' }, { label: 'Front panel', r: 'PASS' }] }],
  events: [E('2026-10-31 17:12', 'Sam Okafor', 'returned it into kit K-0042', '#2314'), E('2024-08-20 09:00', 'Mel Torres', 'added it · purchased from Shure Distribution')], photos: [], docs: [['ULXD4Q user guide.pdf', '3.1 MB', 'Manual']], acc: { serial: [], bulk: [{ id: 'b1', qty: 2, name: 'Rack ears', model: true }] },
  lastScan: { at: '2026-10-31 17:12', who: 'Sam Okafor', where: 'Warehouse A', what: 'return check into K-0042' } };
ASSETS['SK-0012'] = { ...baseAsset(), tag: 'SK-0012', model: 'Sennheiser EW-DX SK beltpack', cat: 'Audio', code: 'SK', serial: 'EW5510012', status: 'AVAILABLE', cond: 'Good', loc: 'Warehouse A', bin: 'A3-14', supplier: 'Sennheiser AU', purchased: '2025-05-06', cost: 780, repl: 900, warranty: '2027-05-06', specs: [['Band', 'Q1-9'], ['Battery', 'BA 70']],
  events: [E('2025-05-06 09:00', 'Mel Torres', 'added it · purchased from Sennheiser AU')], photos: [], docs: [['EW-DX quick guide.pdf', '1.4 MB', 'Manual']], acc: { serial: [], bulk: [{ id: 'b1', qty: 2, name: 'AA battery pack', model: true }] } };
ASSETS['RC-0007'] = { ...baseAsset(), tag: 'RC-0007', model: 'Rigging clamp bar', cat: 'Rigging', code: 'RC', status: 'RESERVED', cond: 'Good', loc: 'Warehouse A', bin: 'C4', supplier: 'Prolyte AU', purchased: '2023-03-14', cost: 96, repl: 140, parent: 'AURA-01', container: 'LX-02',
  book: [{ job: '#2341', from: '2026-11-12', to: '2026-11-14', state: 'RESERVED', note: 'with AURA-01' }], events: [E('2023-03-14 09:00', 'Mel Torres', 'added it · attached to AURA-01')], lastScan: { at: '2026-11-07 16:43', who: 'Sam Okafor', where: 'Warehouse A', what: 'packed with AURA-01' } };
const OTHERS = [['Warehouse A / A1', 'Warehouse A', 'A1'], ['Warehouse A / A3', 'Warehouse A', 'A3'], ['Warehouse B / B1', 'Warehouse B', 'B1'], ['Van 2', 'Van 2', '']];
const tagTaken = (t, except) => { const u = t.trim().toUpperCase(); if (u === except) return false; if (ASSETS[u]) return true; const m = MODELS.find(x => u.startsWith(x.code + '-')); if (m) { const n = parseInt(u.slice(m.code.length + 1), 10); if (n >= 1 && n < m.next) return true; } return false; };
const nextTag = m => { let n = m.next; while (ASSETS[fmtTag(m, n)]) n++; return fmtTag(m, n); };

// ---------- state
const state = { id: 'AURA-01', tab: 'overview', calOff: 0, hist: 'all', histN: 8, chk: 'ALL', mf: 'all', msel: new Set(), fsel: new Set(), moreChecks: false, expanded: new Set(), showResolved: false, composing: false, hl: '', form: null, undo: null, lastSel: null, csv: null };
const TABS = ['overview', 'availability', 'checks', 'maintenance', 'history', 'notes', 'files'];
const cur = () => ASSETS[state.id];
function snapshot() { const s = JSON.stringify({ A: ASSETS, id: state.id, tab: state.tab }); return () => { const o = JSON.parse(s); ASSETS = o.A; state.id = o.id; state.tab = o.tab; state.msel.clear(); state.fsel.clear(); render(); }; }
function writeHash() { try { history.replaceState(null, '', '#' + state.id + (state.tab !== 'overview' ? '/' + state.tab : '')); } catch (e) { /* file:// previews may refuse */ } }
function readHash() { const m = /^#([^/&]+)(?:\/(\w+))?/.exec(location.hash || ''); if (m) { state.id = decodeURIComponent(m[1]).toUpperCase(); if (m[2] && TABS.includes(m[2])) state.tab = m[2]; } const dm = /date=(\d{4}-\d{2}-\d{2})/.exec(location.hash || ''); if (dm) state.calOff = Math.floor((dayNum(dm[1]) - dayNum(calBase())) / 28) * 28; }
const calBase = () => addD(mondayOf(TODAY), isPhone() ? 0 : -14);

// ---------- derived (never stored)
const openMaint = a => a.maint.filter(m => m.status === 'OPEN' || m.status === 'IN_PROGRESS');
const nextService = a => { const sch = a.maint.filter(m => m.type === 'SERVICE' && (m.status === 'SCHEDULED' || m.status === 'IN_PROGRESS')).map(m => m.date).sort(); if (sch.length) return { d: sch[0], by: 'scheduled' }; if (a.svc.every && a.svc.last) return { d: addM(a.svc.last, a.svc.every), by: `every ${a.svc.every} months` }; return null; };
const allRecs = a => a.checks.flatMap(s => s.recs.map(r => ({ ...r, s })));
const lastCheck = a => [...a.checks].sort((x, y) => x.at < y.at ? 1 : -1)[0] || null;
const currentBooking = a => a.book.find(b => b.state === 'DEPLOYED') || a.book.filter(b => b.state === 'RESERVED').sort((x, y) => x.from < y.from ? -1 : 1)[0] || null;
const conflicts = a => { const b = a.book.filter(x => x.state !== 'PENCILLED'); const out = []; for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) if (b[i].from <= b[j].to && b[j].from <= b[i].to) out.push([b[i].job, b[j].job]); return out; };
function health(a) {
  const out = [], t = a.tt;
  if (a.status === 'RETIRED') return out;
  if (!t.req) out.push({ k: 'tt', sev: 'pass', title: 'Test & tag not required' });
  else if (!t.next) out.push({ k: 'tt', sev: 'unknown', title: 'Test & tag not checked', detail: 'No test & tag record on this asset.', act: ['Register', 'ttreg'] });
  else { const d = until(t.next); out.push(d < 0 ? { k: 'tt', sev: 'block', title: `Test & tag ${-d}d overdue`, detail: `last passed ${fmtD(t.last)}${t.last && t.last.slice(0,4) !== "2026" ? " " + t.last.slice(0,4) : ""} · was due ${fmtD(t.next)}`, act: ['Schedule test', 'sched', 'data-t="TT"'] } : d <= 30 ? { k: 'tt', sev: 'warn', title: `Test & tag due in ${d} days`, detail: `last passed ${fmtD(t.last)}${t.last && t.last.slice(0,4) !== "2026" ? " " + t.last.slice(0,4) : ""} · due ${fmtD(t.next)}`, act: ['Schedule test', 'sched', 'data-t="TT"'] } : { k: 'tt', sev: 'pass', title: `Test & tag current to ${fmtD(t.next)}` }); }
  const sv = nextService(a);
  if (!sv) out.push({ k: 'svc', sev: 'unknown', title: 'Service not checked', detail: 'No service schedule on this asset or its model.', act: ['Schedule service', 'sched', 'data-t="SERVICE"'] });
  else { const d = until(sv.d); out.push(d < 0 ? { k: 'svc', sev: 'block', title: `Service ${-d}d overdue`, detail: sv.by, act: ['Schedule service', 'sched', 'data-t="SERVICE"'] } : d <= 30 ? { k: 'svc', sev: 'warn', title: `Service due in ${d} days`, detail: `${fmtD(sv.d)} · ${sv.by}`, act: ['Open', 'tab', 'data-t="maintenance"'] } : { k: 'svc', sev: 'pass', title: `Next service ${fmtD(sv.d)}` }); }
  const lc = lastCheck(a);
  if (a.cond === 'Needs repair') out.push({ k: 'cond', sev: 'block', title: 'Marked needs repair', detail: openMaint(a)[0] ? openMaint(a)[0].title : 'no repair booked yet', act: openMaint(a)[0] ? ['Open', 'tab', 'data-t="maintenance"'] : ['Report issue', 'issue'] });
  else if (a.cond === 'Poor') out.push({ k: 'cond', sev: 'warn', title: 'Condition is poor', act: ['Report issue', 'issue'] });
  else if (!lc) out.push({ k: 'cond', sev: 'unknown', title: 'Condition not checked', detail: 'No prep or return check on record.', act: ['Open', 'tab', 'data-t="checks"'] });
  else { const bad = lc.recs.find(r => r.r === 'FAIL'); out.push(bad ? { k: 'cond', sev: 'warn', title: `Last check failed · ${bad.label}`, detail: `${lc.ctx === 'PREP' ? 'prep' : 'return'} ${lc.job} · ${fmtD(lc.at.slice(0, 10))}${bad.n ? ' · ' + bad.n : ''}`, act: ['Open', 'tab', 'data-t="checks"'] } : { k: 'cond', sev: 'pass', title: `${a.cond} · last check passed ${fmtD(lc.at.slice(0, 10))}` }); }
  if (a.status === 'MISSING') out.push({ k: 'where', sev: 'block', title: 'Marked missing', detail: a.lastScan ? `last scan ${atStr(a.lastScan.at)} · ${a.lastScan.where}` : 'never scanned' });
  else if (a.status === 'IN_MAINTENANCE') out.push({ k: 'where', sev: 'warn', title: 'In maintenance', detail: `${a.loc} · hidden from availability until it is back` });
  else if (a.status === 'DEPLOYED') { const b = a.book.find(x => x.state === 'DEPLOYED'), d = b ? until(b.to) : 0; out.push(d < 0 ? { k: 'where', sev: 'block', title: `${b.job} is ${-d}d overdue back`, detail: JOBS[b.job].name, act: ['Force return', 'forceret'] } : d === 0 ? { k: 'where', sev: 'warn', title: 'Due back today', detail: `${b.job} ${JOBS[b.job].name}`, act: ['Force return', 'forceret'] } : { k: 'where', sev: 'pass', title: `On ${b.job} until ${fmtD(b.to)}` }); }
  else out.push({ k: 'where', sev: 'pass', title: 'Not marked missing' });
  const cf = conflicts(a); out.push(cf.length ? { k: 'dbl', sev: 'block', title: `Double-booked · ${cf[0].join(' and ')}`, detail: 'the dates overlap', act: ['Open', 'tab', 'data-t="availability"'] } : { k: 'dbl', sev: 'pass', title: 'No double bookings' });
  const om = openMaint(a); if (om.length && a.cond !== 'Needs repair') out.push({ k: 'open', sev: 'warn', title: `${om.length} open ${om.length > 1 ? 'repairs' : 'repair'}`, detail: om[0].title, act: ['Open', 'tab', 'data-t="maintenance"'] });
  const o = { block: 0, unknown: 1, warn: 2, pass: 3 }; return out.sort((x, y) => o[x.sev] - o[y.sev]);
}
function summary(hs, a) { if (a.status === 'RETIRED') return ['Retired', 'Hidden from availability and every picker. History, test & tag record and documents are kept.', '']; const n = s => hs.filter(c => c.sev === s).length, clear = n('pass'); const lead = `${clear} of ${hs.length} checks clear`; return n('block') ? ["Can't go out", lead, 'color:var(--t-out)'] : (n('warn') || n('unknown')) ? ['Nearly ready', lead, ''] : ['Ready to go', lead, '']; }
const dw = (txt, cls) => `<span class="dotw ${cls || ''}">${txt}</span>`;
const statusWord = a => { const [n, c] = STATUS[a.status]; return dw(n, c); };
const jobLink = (j, extra) => `<a href="${OV}">${j} ${esc(JOBS[j].name)}</a>${extra || ''}`;
const events = a => { // history = past jobs + deployed + changes, newest first
  const ev = a.events.map(e => ({ at: e.at, kind: 'change', e }));
  a.jobs.forEach(j => ev.push({ at: j.back + ' 12:00', kind: 'job', j }));
  a.book.filter(b => b.state === 'DEPLOYED').forEach(b => ev.push({ at: b.from + ' 06:55', kind: 'job', j: { job: b.job, out: b.from, back: '', live: true } }));
  return ev.sort((x, y) => x.at < y.at ? 1 : -1);
};
const myOpenThreads = a => a.threads.filter(t => t.status === 'open');

// ---------- render
function render() { chrome(); renderHead(); renderTabs(); renderView(); renderBulk(); }
let chromeDone = false;
function chrome() {
  if (chromeDone) return; chromeDone = true;
  const nav = [['Dashboard', 'blue', 'https://claude.ai/artifact/3d6zqfosL5hYRvXLBYLnhR'], ['Jobs', 'blue', JOBSL], ['Finance', 'green', 'https://claude.ai/artifact/5VnYTVW2pdA5r1qBRvdrom'], ['Schedule', 'green', ''], ['Crew', 'purple', 'https://claude.ai/artifact/LPdsNGb4CRMfS6qk7j7Fsa'], ['Assets', 'amber', LIST], ['Warehouse', 'teal', 'https://claude.ai/artifact/6xqFcEZZk49w86p5pAsisA'], ['Test & tag', 'teal', ''], ['Maintenance', 'amber', '']];
  $('#sidenav').innerHTML = nav.map(([n, c, h]) => `<a ${h ? `href="${h}"` : 'href="#" data-act="noop"'} class="${n === 'Assets' ? 'on' : ''}"><span class="patch" style="background:var(--${c}-soft, var(--paper-2))"></span>${n}</a>`).join('');
  $('.phonehead').innerHTML = `<a class="btn btn-icon btn-lg" href="${LIST}" aria-label="Back to assets" style="color:var(--ink)">‹</a><div style="flex:1;min-width:0"><div class="ell" id="phonetitle" style="font-family:var(--display);font-weight:800;font-size:16px"></div><div class="ell t-micro muted" id="phonesub"></div></div><button class="btn btn-icon btn-lg" data-act="pagemenu" aria-label="Page actions">⋯</button>`;
}
function renderHead() {
  const a = cur(), cr = $('.topbar .crumb');
  if (!a) { cr.innerHTML = `<a href="${LIST}" style="color:var(--muted)">Assets</a><span>›</span><b>Not found</b>`; $('#rhead').innerHTML = ''; $('#phonetitle').textContent = 'Asset not found'; $('#phonesub').textContent = ''; return; }
  document.title = `${a.tag} · RVLT Flow`;
  cr.innerHTML = `<a href="${LIST}" style="color:var(--muted)">Assets</a><span>›</span><b class="mono" style="font-weight:600">${esc(a.tag)}</b>`;
  const thumb = `<span class="thumb img">${esc(a.cat.slice(0, 2).toUpperCase())}</span>`;
  $('#rhead').innerHTML = `<div class="who">${thumb}<div style="min-width:0"><div class="ttl"><h1 class="h1">${esc(a.tag)}</h1>${statusWord(a)}${a.customName ? `<span class="muted" style="font-size:14px">${esc(a.customName)}</span>` : ''}</div><div class="rid"><a href="${MODELURL}">${esc(a.model)}</a><span class="faint">·</span><span>${esc(a.cat)}</span><span class="faint">·</span><span>${esc(locStr(a))}</span></div></div></div><div class="acts"><button class="btn btn-primary" data-act="edit">Edit</button><button class="btn btn-icon" data-act="pagemenu" aria-label="More actions">⋯</button></div>`;
  $('#phonetitle').textContent = a.tag;
  $('#phonesub').innerHTML = `${statusWord(a).replace('class="dotw', 'style="font-size:11.5px" class="dotw')} <span class="faint">·</span> ${esc(a.model)} <span class="faint">·</span> ${esc(locStr(a))}`;
}
function tabCount(t, a) {
  switch (t) {
    case 'availability': return a.book.filter(b => b.to >= TODAY).length + a.maint.filter(m => m.status === 'SCHEDULED').length || '';
    case 'checks': return allRecs(a).length || '';
    case 'maintenance': return a.maint.length || '';
    case 'history': return events(a).length || '';
    case 'notes': return myOpenThreads(a).length || '';
    case 'files': return a.photos.length + a.docs.length || '';
    default: return '';
  }
}
function renderTabs() {
  const a = cur(); if (!a) { $('#tabs').innerHTML = ''; return; }
  const L = { overview: 'Overview', availability: 'Availability', checks: 'Checks', maintenance: 'Maintenance', history: 'History', notes: 'Notes', files: 'Files' };
  $('#tabs').innerHTML = TABS.map(t => { const c = tabCount(t, a); return `<button class="${state.tab === t ? 'on' : ''}" data-act="tab" data-t="${t}">${L[t]}${c !== '' ? ` <span class="n">${c}</span>` : ''}</button>`; }).join('');
}
function renderView() {
  const a = cur(), v = $('#view');
  if (!a) { v.innerHTML = `<div class="empty2"><b>Asset not found</b>It may have been deleted, or you don't have access to it. <a class="lnk" href="${LIST}">Back to assets</a></div>`; return; }
  const body = { overview: viewOverview, availability: viewAvail, checks: viewChecks, maintenance: viewMaint, history: viewHistory, notes: viewNotes, files: viewFiles }[state.tab](a);
  v.innerHTML = state.tab === 'overview' ? `<div class="ws one"><div class="col">${body}</div></div>` : `<div class="ws"><div class="col">${body}</div><aside class="rail2">${railHtml(a)}</aside></div>`;
}
// facts shared by Overview (grouped in three columns) and the rail (stacked) — one definition each
function factNow(a) {
  const L = [], b = currentBooking(a);
  if (a.parent) L.push(`Accessory of <a href="#" data-act="go" data-tag="${a.parent}" class="mono">${a.parent}</a>`);
  if (a.status === 'IN_MAINTENANCE') { const m = openMaint(a)[0]; L.push(`In the workshop${m ? ` · <span class="m">${esc(m.title)}</span>` : ''}`); }
  else if (b && (a.status === 'DEPLOYED' || a.status === 'RESERVED')) L.push(jobLink(b.job), `<span class="m">${rng(b.from, b.to)}${b.state === 'DEPLOYED' && b.to === TODAY ? ' · due back today' : ''}</span>`);
  else if (a.status === 'MISSING') L.push('Whereabouts unknown');
  else if (a.status === 'RETIRED') L.push('Retired · off the floor');
  else { const nx = a.book.filter(x => x.to >= TODAY && x.state !== 'PENCILLED').sort((x, y) => x.from < y.from ? -1 : 1)[0]; L.push('Not on a job'); if (nx) L.push(`<span class="m">Next ${jobLink(nx.job)} · ${rng(nx.from, nx.to)}</span>`); }
  if (a.container) L.push(`<span class="m">Case</span> <a href="${GEAR}" class="mono">${esc(a.container)}</a>`);
  if (a.kit) L.push(`<span class="m">In kit</span> <a href="${GEAR}" class="mono">${esc(a.kit.tag)}</a> <span class="m">${esc(a.kit.name)}</span>`);
  return L.map(x => `<div>${x}</div>`).join('');
}
function factScan(a) { const s = a.lastScan; return s ? `<div class="mono">${atStr(s.at)}</div><div><span class="m">${esc(s.who)} · ${esc(s.where)}</span></div><div class="m">${esc(s.what)}</div>` : `<div class="faint">No scan on record</div>`; }
function factValue(a) { return a.cost == null && a.repl == null ? '<div class="faint">No value set</div>' : `${a.repl != null ? `<div><span class="mono">${money(a.repl)}</span> <span class="m">replacement</span></div>` : ''}${a.cost != null ? `<div><span class="mono">${money(a.cost)}</span> <span class="m">paid${a.purchased ? ' ' + MON[+a.purchased.slice(5, 7) - 1] + ' ' + a.purchased.slice(0, 4) : ''}</span></div>` : ''}`; }
function factOwner(a) { return a.owner === 'Owned' ? '<div>Owned</div>' : `<div>${esc(a.owner)}</div>`; }
function railHtml(a) { return `<div class="rs"><div class="ovl">Now</div><div class="fx">${factNow(a)}</div></div><div class="rs"><div class="ovl">Last scan</div><div class="fx">${factScan(a)}</div></div><div class="rs"><div class="ovl">Value</div><div class="fx">${factValue(a)}</div></div><div class="rs"><div class="ovl">Owner</div><div class="fx">${factOwner(a)}</div></div>`; }

function viewOverview(a) {
  const hs = health(a), [head, lead, st] = summary(hs, a), todo = hs.filter(c => c.sev !== 'pass'), clear = hs.filter(c => c.sev === 'pass');
  const shown = state.moreChecks ? todo : todo.slice(0, 3);
  const row = c => `<li ${c.act ? `data-act="${c.act[1]}" ${c.act[2] || ''} data-from="check"` : ''}><span class="dot ${c.sev === 'block' ? 'bad' : c.sev === 'unknown' ? 'unk' : ''}"></span><div class="grow">${esc(c.title)}${c.detail ? ` <span class="muted">· ${esc(c.detail)}</span>` : ''}</div>${c.act ? `<span class="go">${c.act[0]} ›</span>` : ''}</li>`;
  const ready = `<section class="sec2" id="ready"><h2 style="${st}">${head}</h2><p class="lead">${esc(lead)}</p>${a.status === 'RETIRED' ? `<div class="links" style="margin-top:12px"><button class="lnk" data-act="reinstate">Reinstate ${esc(a.tag)}</button></div>` : `<ul class="todo">${shown.map(row).join('')}</ul>${todo.length > 3 ? `<button class="lnk muted" style="margin-top:10px" data-act="morechecks">${state.moreChecks ? 'Show fewer' : `and ${todo.length - 3} more`} ›</button>` : ''}<div class="clear">${clear.length ? `${clear.length} ${todo.length ? 'checks clear' : 'checks'} · ${clear.map(c => esc(c.title)).join(' · ')}` : ''}</div>`}</section>`;
  const facts = `<section class="sec2 facts3"><div><div class="ovl">Now</div><div class="fx">${factNow(a)}</div></div><div><div class="ovl">Last scan</div><div class="fx">${factScan(a)}</div></div><div><div class="ovl">Value &amp; owner</div><div class="fx">${factValue(a)}${factOwner(a)}</div></div></section>`;
  const D = [['Serial', a.serial && `<span class="mono">${esc(a.serial)}</span>`], ['Barcode', a.barcode && `<span class="mono">${esc(a.barcode)}</span>`], ['Purchased', a.purchased && `${fmtL(a.purchased)}${a.supplier ? ` <span class="muted">· ${esc(a.supplier)}${a.order ? ' · <span class="mono">' + esc(a.order) + '</span>' : ''}</span>` : ''}`], ['Warranty', a.warranty && (a.warranty < TODAY ? `<span class="dotw warn" style="font-size:13px">Expired ${fmtD(a.warranty)}</span>` : `To ${fmtL(a.warranty)}`)], ['Specs', a.specs.length && `${a.specs.map(s => `${esc(s[1])}`).join(' · ')} <span class="muted">· from the model</span>`], ...Object.entries(a.custom).filter(e => e[1]).map(([k, v]) => [k, `<span class="mono">${esc(v)}</span>`]), ['Tags', a.tags.length && `<span class="muted">${a.tags.map(esc).join(' · ')}</span>`]].filter(x => x[1]);
  const ident = `<section class="sec2"><div class="shead"><span class="t">Identity</span></div><div class="dl">${D.length ? D.map(([k, v]) => `<div><span class="k">${k}</span><span class="v">${v}</span></div>`).join('') : '<div class="muted">No identity facts yet · Edit adds serial, purchase and warranty.</div>'}</div></section>`;
  return ready + facts + ident + accSection(a);
}
function accSection(a) {
  if (a.parent) return '';
  const n = a.acc.serial.length + a.acc.bulk.length;
  const rows = [...a.acc.serial.map((c, i) => `<div class="rrow"><span class="thumb pdf" style="width:30px;height:30px">${esc((ASSETS[c.tag] ? ASSETS[c.tag].cat : 'Ri').slice(0, 2).toUpperCase())}</span><div class="grow"><div class="ttl">${esc(c.name)}</div><div class="meta"><span class="mono">${esc(c.tag)}</span>${ASSETS[c.tag] ? `<span>${esc(STATUS[ASSETS[c.tag].status][0].toLowerCase())}</span>` : ''}</div></div><div class="rt"><span class="mono">1×</span><button class="dots" data-act="accmenu" data-k="s" data-i="${i}" aria-label="Accessory actions">${ICON.dots}</button></div></div>`),
    ...a.acc.bulk.map((c, i) => `<div class="rrow"><span class="thumb pdf" style="width:30px;height:30px">${esc(c.name.slice(0, 2).toUpperCase())}</span><div class="grow"><div class="ttl">${esc(c.name)}</div><div class="meta"><span>${c.model ? 'from the model' : 'attached here'}</span><span>bulk</span></div></div><div class="rt"><span class="mono">${c.qty}×</span><button class="dots" data-act="accmenu" data-k="b" data-i="${i}" aria-label="Accessory actions">${ICON.dots}</button></div></div>`)];
  return `<section class="sec2"><div class="shead"><span class="t">Accessories<span class="n">${n}</span></span><span class="sright"><button class="lnk" data-act="attach">+ Attach</button></span></div>${rows.join('') || '<div class="empty2" style="padding:14px 0">None attached · the model adds its default accessories when this unit is booked.</div>'}</section>`;
}
// Availability
function viewAvail(a) {
  const weeks = isPhone() ? 4 : 8, N = weeks * 7, start = addD(calBase(), state.calOff), end = addD(start, N - 1);
  const items = [...a.jobs.map(j => ({ k: 'past', job: j.job, from: j.out, to: j.back, label: JOBS[j.job].name })), ...a.book.map(b => ({ k: b.state === 'DEPLOYED' ? 'dep' : b.state === 'PENCILLED' ? 'pen' : 'res', job: b.job, from: b.from, to: b.to, label: JOBS[b.job].name })), ...a.maint.filter(m => m.status === 'SCHEDULED').map(m => ({ k: 'svc', job: '', id: m.id, from: m.date, to: m.date, label: m.title }))].filter(x => x.to >= start && x.from <= end).sort((x, y) => x.from < y.from ? -1 : 1);
  const pos = d => (dayNum(d) - dayNum(start)) / N * 100;
  const lane = it => { const l = Math.max(0, pos(it.from)), w = Math.max(100 / N, (Math.min(dayNum(it.to), dayNum(end)) - Math.max(dayNum(it.from), dayNum(start)) + 1) / N * 100), right = l > 60; return `<div class="lane ${it.k === 'past' ? 'past' : ''}"><span class="lb" data-act="bkhl" data-k="${it.job || it.id}" style="${right ? `right:${Math.max(0, 100 - l - w)}%` : `left:${l}%`}">${it.job ? `<b>${it.job}</b>` : ''}${esc(it.label)}</span><span class="br ${it.k}" data-act="bkhl" data-k="${it.job || it.id}" style="left:${l}%;width:${w}%"></span></div>`; };
  const ticks = Array.from({ length: weeks }, (_, i) => addD(start, i * 7));
  const cal = `<div class="cal"><div class="ax">${ticks.map((d, i) => `<span style="left:${i / weeks * 100}%">${fmtD(d)}</span>`).join('')}</div>${ticks.slice(1).map((d, i) => `<span class="wk" style="left:${(i + 1) / weeks * 100}%"></span>`).join('')}${TODAY >= start && TODAY <= end ? `<span class="today" style="left:${pos(TODAY) + 50 / N}%"></span>` : ''}<div class="lanes">${items.map(lane).join('') || '<div class="nothing">Nothing booked in this window.</div>'}</div></div>`;
  const words = `<div class="words"><button class="wd" data-act="calnav" data-d="-28">‹ Earlier</button><button class="wd ${state.calOff === 0 ? 'on' : ''}" data-act="calnav" data-d="0">Today</button><button class="wd" data-act="calnav" data-d="28">Later ›</button><span class="sp"></span><span class="rng">${rng(start, end)}</span></div>`;
  const up = [...a.book.filter(b => b.to >= TODAY).map(b => ({ ...b, k: b.job })), ...a.maint.filter(m => m.status === 'SCHEDULED').map(m => ({ k: m.id, job: '', from: m.date, to: m.date, state: 'SERVICE', title: m.title, note: `${MTYPE[m.type].toLowerCase()} · ${a.svc.every ? 'every ' + a.svc.every + ' months' : 'one-off'}`, mid: m.id }))].sort((x, y) => x.from < y.from ? -1 : 1);
  const rows = up.map(b => { const [n, c] = BSTATE[b.state]; return `<div class="rrow ${state.hl === b.k ? 'hl' : ''}" id="bk-${b.k.replace('#', '')}"><span class="id">${b.job || ''}</span><div class="grow">${b.job ? `<a class="ttl" href="${OV}">${esc(JOBS[b.job].name)}</a>` : `<div class="ttl">${esc(b.title)}</div>`}<div class="meta"><span>${rng(b.from, b.to)}</span>${b.note ? `<span>${esc(b.note)}</span>` : ''}</div></div><div class="rt">${dw(n, c)}<button class="dots" data-act="bkmenu" data-k="${b.k}" aria-label="Booking actions">${ICON.dots}</button></div></div>`; }).join('');
  return `${words}${cal}<div class="shead" style="margin-top:14px"><span class="t">Bookings<span class="n">${up.length}</span></span></div>${rows || `<div class="empty2"><b>Nothing booked</b>No reservations or service ahead. It is free to quote.</div>`}<div class="foot1"><span>${up.length} upcoming</span><button class="lnk muted" data-act="tab" data-t="history">Past jobs are in History ›</button></div>`;
}
// Checks
function viewChecks(a) {
  const ctx = [['ALL', 'All'], ['PREP', 'Prep'], ['RETURN', 'Return'], ['AD_HOC', 'Ad hoc']];
  const ss = [...a.checks].filter(s => state.chk === 'ALL' || s.ctx === state.chk).sort((x, y) => x.at < y.at ? 1 : -1);
  const words = `<div class="words">${ctx.map(([k, n]) => `<button class="wd ${state.chk === k ? 'on' : ''}" data-act="chkctx" data-k="${k}">${n}</button>`).join('')}<span class="sp"></span><a class="lnk muted" href="${SCANURL}">Run an ad hoc check ›</a></div>`;
  const body = ss.map(s => `<div class="gl">${s.ctx === 'PREP' ? 'Prep' : s.ctx === 'RETURN' ? 'Return' : 'Ad hoc'} · <a href="${WH}" style="color:var(--ink-2)"><span class="mono">${s.job}</span> ${esc(JOBS[s.job].name)}</a> <span class="faint">· ${esc(s.who)} · ${atStr(s.at)}</span></div>${s.recs.map(r => { const [n, c] = RES[r.r]; return `<div class="cres"><div>${esc(r.label)}${r.v ? ` <span class="muted">· ${esc(r.v)}</span>` : ''}${r.ph ? ` <span class="faint">· ${r.ph} photo${r.ph > 1 ? 's' : ''}</span>` : ''}</div>${dw(n, c)}${r.n ? `<div class="n">${esc(r.n)}</div>` : ''}</div>`; }).join('')}`).join('');
  return `${words}${body || (state.chk === 'ALL' ? `<div class="empty2"><b>No check records yet</b>Results from warehouse prep and return land here, or run an ad hoc check.</div>` : `<div class="empty2"><b>Nothing matches</b>No ${state.chk.toLowerCase().replace('_', ' ')} checks. <button class="lnk" data-act="chkctx" data-k="ALL">Show all</button></div>`)}<div class="foot1"><span>${allRecs(a).length} results · ${a.checks.length} sessions</span></div>`;
}
// Maintenance
function viewMaint(a) {
  const F = [['all', 'All'], ['open', 'Open'], ['done', 'Done']];
  const rows = a.maint.filter(m => state.mf === 'all' || (state.mf === 'done' ? m.status === 'DONE' : m.status !== 'DONE')).sort((x, y) => x.date < y.date ? 1 : -1);
  const allSel = rows.length && rows.every(m => state.msel.has(m.id));
  const words = `<div class="words">${F.map(([k, n]) => `<button class="wd ${state.mf === k ? 'on' : ''}" data-act="mfilter" data-k="${k}">${n}</button>`).join('')}<span class="sp"></span><button class="lnk" data-act="sched">Schedule service…</button><button class="lnk muted" data-act="issue">Report issue…</button></div>`;
  const body = rows.map(m => { const sel = state.msel.has(m.id), [sn, sc] = MSTATUS[m.status], [rn, rc] = m.result ? RES[m.result] : []; return `<div class="rrow ${sel ? 'sel' : ''}"><button class="cb ${sel ? 'on' : ''}" data-act="msel" data-id="${m.id}" aria-label="Select ${esc(m.title)}"></button><div class="grow"><div class="ttl">${esc(m.title)}${m.issue ? ` <span class="dotw warn" style="font-size:11.5px;margin-left:8px">reported issue</span>` : ''}</div><div class="meta"><span>${MTYPE[m.type]}</span><span class="when">${m.status === 'DONE' ? 'Done' : 'Due'} ${fmtL(m.date)}</span></div></div><div class="rt">${rn ? dw(rn, rc) : ''}${dw(sn, sc)}<button class="dots" data-act="mrowmenu" data-id="${m.id}" aria-label="Maintenance actions">${ICON.dots}</button></div></div>`; }).join('');
  const hd = rows.length ? `<div class="rrow" style="min-height:34px;padding:6px 0;border-top:0"><button class="cb ${allSel ? 'on' : ''}" data-act="mselall" aria-label="Select all"></button><span class="muted" style="font-size:12px">Select all</span></div>` : '';
  const sv = nextService(a);
  return `${words}${hd}${body || `<div class="empty2"><b>${state.mf === 'all' ? 'No maintenance records' : 'Nothing matches'}</b>${state.mf === 'all' ? 'Servicing, repairs and test &amp; tag history land here.' : 'No ' + state.mf + ' records.'}</div>`}<div class="foot1"><span>${a.maint.length} records</span><span>${sv ? `Next service ${fmtD(sv.d)} · ${sv.by}` : 'No service schedule · not checked'}</span>${a.tt.rec ? `<a class="lnk muted" href="#" data-act="noop">Test &amp; tag record ›</a>` : ''}</div>`;
}
// History — the Discussion rendering: dated rows, no cards
function viewHistory(a) {
  const W = [['all', 'All'], ['job', 'Jobs'], ['change', 'Changes']];
  const ev = events(a).filter(e => state.hist === 'all' || e.kind === state.hist), shown = ev.slice(0, state.histN);
  let last = '', h = '';
  for (const e of shown) {
    const d = e.at.slice(0, 10); if (d !== last) { last = d; h += `<div class="gl">${d === TODAY ? 'Today' : sd(d) + (d.slice(0, 4) !== TODAY.slice(0, 4) ? ' ' + d.slice(0, 4) : '')}</div>`; }
    if (e.kind === 'job') { const j = e.j; h += `<div class="rrow"><span class="id">${j.job}</span><div class="grow"><a class="ttl" href="${OV}">${esc(JOBS[j.job].name)}</a><div class="meta"><span>${j.live ? `Deployed ${fmtD(j.out)} · still out` : `Deployed ${fmtD(j.out)} · returned ${fmtD(j.back)}`}</span></div></div><div class="rt">${dw(j.live ? 'Deployed' : 'Returned', j.live ? 'live' : 'ok')}</div></div>`; }
    else { const c = e.e; h += `<div class="rrow" style="min-height:44px"><span class="mono muted" style="width:44px;font-size:12px;flex:none">${e.at.slice(11)}</span><div class="grow" style="font-size:13.5px"><b>${esc(c.who.split(' ')[0])}</b> ${esc(c.text)}${c.job ? ` <a href="${OV}" class="mono" style="color:var(--ink-2)">${c.job}</a>` : ''}</div></div>`; }
  }
  const left = ev.length - shown.length;
  return `<div class="words">${W.map(([k, n]) => `<button class="wd ${state.hist === k ? 'on' : ''}" data-act="histf" data-k="${k}">${n}</button>`).join('')}</div>${h || '<div class="empty2"><b>No history yet</b>Jobs, moves and condition changes show up here as they happen.</div>'}${left > 0 ? `<button class="more" data-act="histmore">Show ${Math.min(8, left)} more · ${left} left</button>` : ''}<div class="foot1"><span>${ev.length} events · the audit trail, newest first</span></div>`;
}
// Notes — free text + the discussion
function thread(t) {
  const ex = state.expanded.has(t.id), res = t.status === 'resolved';
  return `<div class="thr ${res ? 'closed' : ''}"><div class="ib" style="gap:8px;align-items:flex-start;display:flex"><span class="av" style="margin-top:2px">${esc(t.by.split(' ').map(x => x[0]).join(''))}</span><div class="grow" style="flex:1;min-width:0"><div class="meta" style="display:flex;gap:10px;font-size:12px;color:var(--muted);margin-bottom:2px"><b style="color:var(--ink)">${esc(t.by)}</b><span class="faint">${esc(t.at)}</span>${res ? '<span class="faint">Resolved</span>' : ''}</div><div class="ln" style="white-space:pre-wrap">${esc(t.text)}</div><div style="display:flex;gap:14px;margin-top:4px"><button class="bit" data-act="expand" data-id="${t.id}">${t.replies.length ? `${t.replies.length} repl${t.replies.length > 1 ? 'ies' : 'y'}` : 'Reply'} ${ex ? '▾' : '›'}</button>${res ? `<button class="bit faint" data-act="reopen" data-id="${t.id}">Reopen</button>` : `<button class="bit faint" data-act="resolve" data-id="${t.id}">Resolve</button>`}</div>${ex ? `${t.replies.map(r => `<div class="reply"><b>${esc(r.by.split(' ')[0])}</b> <span class="faint">${esc(r.at)}</span><div>${esc(r.text)}</div></div>`).join('')}${res ? '' : `<div style="margin-top:8px"><input data-reply="${t.id}" placeholder="Reply… ↵ to send" class="quietin" style="width:100%"></div>`}` : ''}</div></div></div>`;
}
function viewNotes(a) {
  const open = myOpenThreads(a).length, res = a.threads.filter(t => t.status === 'resolved').length;
  return `<div class="shead"><span class="t">Note</span><span class="muted" style="font-size:12px">· on the asset, not printed</span></div><div class="note"><textarea id="note" rows="${Math.max(3, Math.min(9, Math.ceil((a.notes.length || 1) / 70) + 1))}" maxlength="2000" placeholder="Anything the next person should know about this unit…">${esc(a.notes)}</textarea><div class="foot" id="notefoot"><span>${a.notes ? `Saved · ${esc(a.notesBy)} · ${sd(a.notesAt)}` : 'Not written yet'}</span><span class="mono" id="notecnt" style="margin-left:auto">${a.notes.length.toLocaleString()} / 2,000</span></div></div>
  <div class="shead" style="margin-top:26px"><span class="t">Discussion<span class="n">${open} open</span></span></div>${state.composing ? `<div class="composebox"><textarea id="compose" rows="3" placeholder="What does the team need to know or decide? ⌘↵ posts"></textarea><div style="display:flex;gap:14px;margin-top:8px;align-items:center"><span class="sright"><button class="lnk muted" data-act="composecancel">Cancel</button><button class="btn btn-primary btn-sm" data-act="post">Post</button></span></div></div>` : `<button class="addline" data-act="compose">Start a discussion…</button>`}${a.threads.filter(t => t.status === 'open' || state.showResolved).map(thread).join('') || (state.composing ? '' : '<div class="empty2" style="padding:14px 0">No discussion yet.</div>')}${res ? `<div class="foot1"><button class="lnk muted" data-act="showres">${state.showResolved ? 'Hide' : 'Show'} ${res} resolved ›</button></div>` : ''}`;
}
// Files
function viewFiles(a) {
  const custom = a.photos.length > 0;
  const tiles = a.photos.map(p => { const sel = state.fsel.has(p.id); return `<div class="ftile ${sel ? 'sel' : ''}" data-act="fsel" data-id="${p.id}"><button class="cb ${sel ? 'on' : ''}" data-act="fsel" data-id="${p.id}" aria-label="Select ${esc(p.name)}"></button><div class="fimg ${p.primary ? '' : 'b'}">${p.name.endsWith('.jpg') ? 'IMG' : 'FILE'}<button class="dots" data-act="fmenu" data-id="${p.id}" aria-label="Photo actions">${ICON.dots}</button></div><div class="cap">${esc(p.name)}</div><div class="sub">${p.primary ? 'Primary · ' : ''}${esc(p.size)} · ${fmtD(p.at)}</div></div>`; }).join('');
  const docs = a.docs.map((d, i) => `<div class="rrow"><span class="thumb pdf" style="width:30px;height:30px">PDF</span><div class="grow"><div class="ttl">${esc(d[0])}</div><div class="meta"><span>${esc(d[2])}</span><span>${esc(d[1])}</span></div></div><div class="rt"><button class="dots" data-act="docmenu" data-i="${i}" aria-label="Document actions">${ICON.dots}</button></div></div>`).join('');
  return `<div class="shead"><span class="t">Photos<span class="n">${a.photos.length}</span></span><span class="sright"><button class="lnk" data-act="fupload">Upload</button><button class="lnk phoneonly" data-act="fphoto">Photo</button><span class="muted deskonly" style="font-size:12px">or drop files here</span></span></div><div class="muted" style="font-size:12.5px">${custom ? 'Custom photo shown · remove it to go back to the model photo.' : 'Showing the model photo · upload one to override it.'}</div>${tiles ? `<div class="fgrid">${tiles}</div>` : `<div class="empty2" style="margin-top:8px"><b>No photos on this unit</b>Upload one, or take it from the phone.</div>`}
  <div class="shead" style="margin-top:26px"><span class="t">From the model<span class="n">${a.docs.length}</span></span><span class="sright"><a class="lnk muted" href="${MODELURL}">Manage on the model ›</a></span></div>${docs || '<div class="empty2" style="padding:14px 0">No documents attached to this model.</div>'}`;
}
function renderBulk() {
  const b = $('#bulk'), a = cur(), nm = state.tab === 'maintenance' ? state.msel.size : 0, nf = state.tab === 'files' ? state.fsel.size : 0, n = nm + nf;
  b.classList.toggle('open', n > 0); document.body.classList.toggle('hassel', n > 0); if (!n || !a) return;
  b.innerHTML = nm ? `<b style="font-size:13px">${nm} selected</b><button class="btn btn-secondary btn-sm" data-act="mdone">Mark done ${nm}</button><button class="btn btn-secondary btn-sm" data-act="mresched">Reschedule…</button><button class="btn btn-icon btn-sm" data-act="mclear" aria-label="Clear selection">✕</button>` : `<b style="font-size:13px">${nf} selected</b>${nf === 1 ? '<button class="btn btn-secondary btn-sm" data-act="fprimary">Set as photo</button>' : ''}<button class="btn btn-secondary btn-sm" data-act="fdl">Download ${nf}</button><button class="btn btn-secondary btn-sm" style="color:var(--t-out)" data-act="fremove">Remove ${nf}</button><button class="btn btn-icon btn-sm" data-act="fclear" aria-label="Clear selection">✕</button>`;
}

// ---------- forms (asset sheet — edit and create share one shape)
const optsLoc = cur_ => Object.keys(LOCS).map(l => opt(l, l, cur_)).join('');
const optsBin = (loc, cur_) => `<option value="">No bin</option>` + (LOCS[loc] || []).map(b => opt(b, b, cur_)).join('');
function readForm() { const f = state.form; if (!f) return; const g = id => { const e = $('#' + id, body); return e ? e.value : undefined; }; const set = (k, id) => { const v = g(id); if (v !== undefined) f[k] = v; };
  set('tag', 'f-tag'); set('serial', 'f-serial'); set('name', 'f-name'); set('status', 'f-status'); set('cond', 'f-cond'); set('loc', 'f-loc'); set('bin', 'f-bin'); set('pdate', 'f-pdate'); set('price', 'f-price'); set('supplier', 'f-supplier'); set('order', 'f-order'); set('warranty', 'f-warranty'); set('tags', 'f-tags'); set('fw', 'f-fw'); set('qty', 'f-qty'); if (g('f-model') !== undefined && f.mode === 'edit') f.model = g('f-model'); }
const ferr = (id, msg) => `<div class="err" id="e-${id}">${msg || ''}</div>`;
function drawForm(focus) {
  const f = state.form, edit = f.mode === 'edit', m = f.model ? modelOf(f.model) : null, bulk = f.kind === 'BULK';
  const modelStep = !edit && !f.model;
  const hd = `<div class="hd"><div class="t-overline">${edit ? 'Edit asset' : 'New asset'}</div><h2>${edit ? `<span class="mono" style="font-size:19px">${esc(f.orig)}</span> · ${esc(f.model)}` : f.model ? `New ${esc(f.model)}` : 'Which model?'}</h2>${edit ? '' : `<div class="words" style="margin-top:8px;border:0"><button class="wd ${!bulk ? 'on' : ''}" data-act="fkind" data-k="SER">Serialised unit</button><button class="wd ${bulk ? 'on' : ''}" data-act="fkind" data-k="BULK">Bulk stock</button></div>`}</div>`;
  let bd;
  if (modelStep) {
    const q = (f.mq || '').toLowerCase(), list = (bulk ? BULKM.map(([n, c]) => ({ name: n, cat: 'Bulk', code: c, bulk: true })) : MODELS).filter(x => !q || x.name.toLowerCase().includes(q) || x.code.toLowerCase().includes(q)).slice(0, 6);
    bd = `<div class="field"><label>Equipment model</label><input id="m-q" value="${esc(f.mq || '')}" placeholder="Search models — Aura, beltpack, d&amp;b, Y8…" autocomplete="off"><span class="t-micro muted">Search first · Enter picks the top result · then tag, serial and location</span></div><div id="m-res">${list.length ? list.map((x, i) => `<button class="res2 ${i === 0 ? 'on' : ''}" data-act="pickmodel" data-n="${esc(x.name)}"><div style="min-width:0"><div style="font-weight:600">${esc(x.name)}</div><div class="t-micro muted">${esc(x.cat)}${x.own ? ` · ${x.own} owned` : ''}</div></div><span class="tg">${x.bulk ? x.code : nextTag(x)}</span></button>`).join('') : '<div class="muted" style="padding:10px 4px;font-size:13px">No model matches · <button class="lnk" data-act="noop">New model…</button></div>'}</div>`;
  } else {
    const idn = `<div class="fsec"><div class="fh"><b>Identity</b><span>What it is and how you will find it.</span></div>${edit ? `<div class="field" style="margin-bottom:12px"><label>Equipment model</label><select id="f-model">${MODELS.map(x => opt(x.name, x.name, f.model)).join('')}</select></div>` : `<div class="t-small muted" style="margin:-4px 0 12px">${esc(f.model)} · <button class="lnk" data-act="changemodel">Change model</button></div>`}<div class="${bulk ? '' : 'g2'}" style="${bulk ? 'display:grid;gap:12px;grid-template-columns:1fr 1fr' : ''}"><div class="field"><label>${bulk ? 'Stock code' : 'Asset tag'} *</label><input id="f-tag" class="mono" value="${esc(f.tag)}" maxlength="50" autocomplete="off">${ferr('tag')}<span class="t-micro muted">${edit ? '' : 'Suggested · scan a label to use that tag'}</span></div>${bulk ? `<div class="field"><label>Quantity *</label><input id="f-qty" type="number" min="1" value="${esc(f.qty)}"></div>` : `<div class="field"><label>Serial number</label><input id="f-serial" class="mono" value="${esc(f.serial)}" maxlength="100">${ferr('serial')}</div>`}</div>${edit ? `<div class="field" style="margin-top:12px"><label>Custom name</label><input id="f-name" value="${esc(f.name)}" placeholder="e.g. FOH key light"></div>` : ''}</div>`;
    const cl = `<div class="fsec"><div class="fh"><b>${bulk ? 'Status' : 'Condition'} &amp; location</b><span>Where it lives and what shape it is in.</span></div><div class="g2">${edit ? `<div class="field"><label>Status</label><select id="f-status">${Object.entries(STATUS).filter(([k]) => k !== 'DEPLOYED' && k !== 'RESERVED' || k === f.status).map(([k, v]) => opt(k, v[0], f.status)).join('')}</select></div>` : ''}${bulk ? '' : `<div class="field"><label>Condition</label><select id="f-cond">${CONDS.map(c => opt(c, c, f.cond)).join('')}</select></div>`}<div class="field"><label>Location</label><select id="f-loc">${optsLoc(f.loc)}</select></div><div class="field"><label>Bin</label><select id="f-bin">${optsBin(f.loc, f.bin)}</select></div></div></div>`;
    const pur = `<div class="fsec"><div class="fh"><b>${bulk ? 'Valuation' : 'Purchase'}</b><span>Optional · warranty and depreciation.</span></div><div class="g2"><div class="field"><label>${bulk ? 'Price per unit ($)' : 'Purchase date'}</label>${bulk ? `<input id="f-price" type="number" step="0.01" min="0" value="${esc(f.price)}" placeholder="0.00">` : `<input id="f-pdate" type="date" value="${esc(f.pdate)}">`}${ferr(bulk ? 'price' : 'pdate')}</div>${bulk ? '' : `<div class="field"><label>Purchase price ($)</label><input id="f-price" type="number" step="0.01" min="0" value="${esc(f.price)}" placeholder="blank is not $0">${ferr('price')}</div><div class="field"><label>Supplier</label><input id="f-supplier" value="${esc(f.supplier)}" placeholder="No supplier"></div><div class="field"><label>Order #</label><input id="f-order" class="mono" value="${esc(f.order)}" placeholder="No order"></div><div class="field"><label>Warranty expiry</label><input id="f-warranty" type="date" value="${esc(f.warranty)}">${ferr('warranty')}</div>`}</div></div>`;
    const more = `<div class="fsec"><div class="fh"><b>More details</b><span>Tags and the org's custom fields.</span></div><div class="g2"><div class="field"><label>Tags</label><input id="f-tags" value="${esc(f.tags)}" placeholder="moving head, touring"></div>${bulk ? '' : `<div class="field"><label>Firmware <span class="faint">· custom field</span></label><input id="f-fw" class="mono" value="${esc(f.fw)}"></div>`}</div></div>`;
    bd = idn + cl + (edit || f.more ? pur + more : `<div class="fsec"><button class="lnk" data-act="moretoggle">Purchase and more details ▾</button></div>`);
  }
  const ft = edit ? `<div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="formgo">Save</button>` : `<button class="gh" data-act="csv">Import CSV…</button><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button>${f.model ? `<button class="btn btn-secondary" data-act="formadd">Save and add another</button><button class="btn btn-primary" data-act="formgo">Create ${bulk ? 'stock' : 'asset'}</button>` : ''}`;
  openDialog(`${hd}<div class="bd">${bd}</div><div class="ft">${ft}</div>`, d => { d.classList.add('wide'); const t = $(focus || (modelStep ? '#m-q' : '#f-tag'), d); if (t) { t.focus(); if (t.select && focus !== '#m-q') t.select(); } });
}
function openForm(mode, seed) {
  const a = cur();
  if (mode === 'edit') state.form = { mode, orig: a.tag, model: a.model, tag: a.tag, serial: a.serial, name: a.customName, status: a.status, cond: a.cond, loc: a.loc, bin: a.bin, pdate: a.purchased, price: a.cost == null ? '' : a.cost, supplier: a.supplier, order: a.order, warranty: a.warranty, tags: a.tags.join(', '), fw: a.custom.Firmware || '', kind: 'SER', qty: 1, more: true };
  else { const m = seed && modelOf(seed.model); state.form = { mode: 'create', model: m ? m.name : '', mq: '', tag: m ? nextTag(m) : '', serial: '', name: '', status: 'AVAILABLE', cond: seed ? 'New' : 'New', loc: seed ? seed.loc : 'Warehouse A', bin: seed ? seed.bin : '', pdate: '', price: seed && seed.cost != null ? seed.cost : '', supplier: seed ? seed.supplier : '', order: '', warranty: '', tags: seed ? seed.tags.join(', ') : '', fw: '', kind: 'SER', qty: 1, more: false }; }
  closeLayer(); drawForm();
}
function validate() {
  const f = state.form, e = {}, bulk = f.kind === 'BULK';
  if (!f.tag.trim()) e.tag = 'Asset tag is required'; else if (f.tag.length > 50) e.tag = 'Keep it to 50 characters'; else if (tagTaken(f.tag, f.mode === 'edit' ? f.orig : '')) e.tag = `${f.tag.trim().toUpperCase()} is already used by another asset`;
  if (f.price !== '' && (isNaN(+f.price) || +f.price < 0)) e.price = 'Enter an amount of 0 or more, or leave it blank';
  if (f.warranty && f.pdate && f.warranty < f.pdate) e.warranty = 'Warranty cannot end before the purchase date';
  if (bulk && (!(+f.qty >= 1))) e.tag = e.tag || 'Quantity must be 1 or more';
  Object.keys({ tag: 1, serial: 1, price: 1, warranty: 1, pdate: 1 }).forEach(k => { const el = $('#e-' + k, body); if (el) el.textContent = e[k] || ''; }); return e;
}
function commitEdit() {
  const f = state.form, a = cur(), undo = snapshot(), tag = f.tag.trim().toUpperCase(), ch = [];
  const set = (k, v, lbl) => { if ((a[k] ?? '') !== (v ?? '')) { ch.push(lbl); a[k] = v; } };
  set('serial', f.serial.trim(), 'serial'); set('customName', f.name.trim(), 'custom name'); set('status', f.status, 'status'); set('cond', f.cond, 'condition'); set('loc', f.loc, 'location'); set('bin', f.bin, 'bin'); set('purchased', f.pdate, 'purchase date'); set('supplier', f.supplier.trim(), 'supplier'); set('order', f.order.trim(), 'order #'); set('warranty', f.warranty, 'warranty');
  const price = f.price === '' ? null : +f.price; if (a.cost !== price) { ch.push('purchase price'); a.cost = price; }
  const tags = f.tags.split(',').map(x => x.trim()).filter(Boolean); if (tags.join('|') !== a.tags.join('|')) { ch.push('tags'); a.tags = tags; }
  if (f.fw.trim() !== (a.custom.Firmware || '')) { ch.push('firmware'); a.custom = { ...a.custom, Firmware: f.fw.trim() }; }
  if (f.model !== a.model) { const mm = modelOf(f.model); ch.push('model'); a.model = f.model; if (mm) { a.cat = mm.cat; a.code = mm.code; a.tt = { ...a.tt, req: mm.tt }; } }
  if (tag !== a.tag) { ch.push('tag'); const old = a.tag; delete ASSETS[old]; a.tag = tag; ASSETS[tag] = a; Object.values(ASSETS).forEach(x => { if (x.parent === old) x.parent = tag; }); state.id = tag; }
  if (ch.length) a.events.unshift(E(`${TODAY} ${NOWT}`, ME, `edited ${ch.join(', ')}`));
  closeLayer(); state.form = null; render(); writeHash(); toast(ch.length ? `${esc(a.tag)} saved · ${ch.join(', ')}` : `${esc(a.tag)} · nothing changed`, ch.length ? undo : null);
}
function commitCreate(again) {
  const f = state.form, m = modelOf(f.model), undo = snapshot(), tag = f.tag.trim().toUpperCase();
  if (f.kind === 'BULK') { closeLayer(); state.form = null; toast(`Bulk stock ${esc(tag)} × ${+f.qty} added to ${esc(f.model)} · it lives on the model page`, undo); return; }
  const n = { ...baseAsset(), tag, model: f.model, cat: m ? m.cat : 'Other', code: m ? m.code : '', serial: f.serial.trim(), status: 'AVAILABLE', cond: f.cond, loc: f.loc, bin: f.bin, purchased: f.pdate, cost: f.price === '' ? null : +f.price, repl: m ? m.repl : null, supplier: f.supplier.trim(), order: f.order.trim(), warranty: f.warranty, tags: f.tags.split(',').map(x => x.trim()).filter(Boolean), custom: f.fw.trim() ? { Firmware: f.fw.trim() } : {}, tt: { req: m ? m.tt : false, last: null, next: null }, events: [E(`${TODAY} ${NOWT}`, ME, `added it${f.loc ? ' · ' + (f.bin ? f.loc + ' / ' + f.bin : f.loc) : ''}`)] };
  ASSETS[tag] = n;
  if (again) { state.form = { ...f, tag: nextTag(m), serial: '' }; drawForm('#f-tag'); toast(`${esc(tag)} created · ${esc(f.model)} kept for the next one`, () => { undo(); }); return; }
  closeLayer(); state.form = null; state.id = tag; state.tab = 'overview'; render(); writeHash(); toast(`${esc(tag)} created · nothing is checked yet`, undo);
}

// ---------- dialogs
function dlgShell(over, title, bd, ft, wide) { openDialog(`<div class="hd"><div class="t-overline">${over}</div><h2 style="font-size:18px">${title}</h2></div><div class="bd">${bd}</div><div class="ft">${ft}</div>`, d => { if (wide) d.classList.add('wide'); }); }
function qrSvg(t) { let s = 0; for (const c of t) s = (s * 31 + c.charCodeAt(0)) % 2147483647 || 7; const R = () => (s = (s * 16807) % 2147483647) / 2147483647; const N = 25; let r = ''; const fin = (x, y) => (x < 7 && y < 7) || (x > N - 8 && y < 7) || (x < 7 && y > N - 8); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let on; if (fin(x, y)) { const ax = x > N - 8 ? x - (N - 7) : x, ay = y > N - 8 ? y - (N - 7) : y; on = ax === 0 || ax === 6 || ay === 0 || ay === 6 || (ax >= 2 && ax <= 4 && ay >= 2 && ay <= 4); } else on = R() > .52; if (on) r += `<rect x="${x}" y="${y}" width="1" height="1"/>`; } return `<svg viewBox="0 0 ${N} ${N}" width="150" height="150" shape-rendering="crispEdges" fill="#111">${r}</svg>`; }
function openScan(msg) { dlgShell('Scan', 'Scan a tag', `<div class="scanbox"><span>Point the camera at a tag · a USB scanner types it and presses Enter</span></div><div class="field"><label>Tag</label><input id="s-tag" class="mono" placeholder="Scan or type a tag, Enter" autocomplete="off"><div class="err" id="s-msg">${msg || ''}</div></div><div class="t-small muted">A read of <b class="mono" style="color:var(--ink)">${esc(state.id)}</b> confirms this unit here. A different tag opens that asset.</div><div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center"><span class="t-micro muted">Simulate a read</span>${['AURA-01', 'AURA-03', 'L-0007', 'ULXD-03', 'SK-0012', 'ZZ-404'].map(t => `<button class="lnk mono" data-act="scanread" data-tag="${t}">${t}</button>`).join('')}</div>`, `<div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button>`); setTimeout(() => { const i = $('#s-tag', body); if (i) i.focus(); }, 30); }
function go(tag, tab) { state.id = tag; state.tab = tab || 'overview'; state.msel.clear(); state.fsel.clear(); state.lastSel = null; state.hl = ''; state.histN = 8; state.expanded.clear(); state.composing = false; closeLayer(); render(); writeHash(); const c = $('.content'); if (c) c.scrollTop = 0; }
const retireText = a => { const up = a.book.filter(b => b.to >= TODAY && b.state !== 'PENCILLED'), sv = a.maint.filter(m => m.status === 'SCHEDULED'); return `<div class="t-small" style="line-height:1.55"><div>Leaves availability and every picker. What happens to the things downstream:</div><ul style="margin:10px 0 0;padding-left:18px;display:grid;gap:6px;color:var(--ink-2)">${up.length ? up.map(b => `<li>${b.job} ${esc(JOBS[b.job].name)} (${rng(b.from, b.to)}) loses this unit · the job's line stays and shows <b>short by 1</b></li>`).join('') : '<li>No job reservations to release</li>'}${sv.length ? `<li>${sv.length} scheduled ${sv.length > 1 ? 'services are' : 'service is'} cancelled (${sv.map(m => fmtD(m.date)).join(', ')})</li>` : ''}${a.acc.serial.length ? `<li>${a.acc.serial.map(c => c.tag).join(', ')} detaches and goes back to stock</li>` : ''}<li>History, check results, the test &amp; tag record and documents are kept</li><li>Reinstate any time from the Retired segment</li></ul></div>`; };

// ---------- actions
function act(name, el, ev) {
  const a = cur(), id = el && el.dataset ? el.dataset.id : null;
  if (!a && !['close', 'noop', 'toastclose', 'undo'].includes(name)) return;
  switch (name) {
    case 'close': closeLayer(); state.form = null; break;
    case 'noop': closeLayer(); toast('Not wired in this prototype'); break;
    case 'toastclose': $('#toast').classList.remove('open'); break;
    case 'undo': if (state.undo) { state.undo(); state.undo = null; } $('#toast').classList.remove('open'); break;
    case 'sw': el.classList.toggle('on'); break;
    case 'tab': closeLayer(); state.tab = el.dataset.t; state.msel.clear(); state.fsel.clear(); state.lastSel = null; state.composing = false; render(); writeHash(); break;
    case 'go': closeLayer(); go(el.dataset.tag); break;
    case 'morechecks': state.moreChecks = !state.moreChecks; render(); break;
    case 'edit': closeLayer(); openForm('edit'); break;
    case 'pagemenu': { const dep = a.status === 'DEPLOYED', ret = a.status === 'RETIRED'; openMenu(el, `${a.tag} · ${a.model}`, [isPhone() ? { label: 'Edit…', act: 'edit' } : { label: 'Scan a tag…', act: 'scan', small: '/' }, { label: 'Move to…', act: 'move', args: dep ? 'disabled' : '', small: dep ? 'on a job' : '' }, { label: 'Schedule service…', act: 'sched' }, { label: 'Report issue…', act: 'issue' }, { label: 'Print label…', act: 'label' }, { label: 'New asset like this…', act: 'likethis', small: 'Duplicate' }, '-', { label: 'Force return…', act: 'forceret', args: dep ? '' : 'disabled', small: dep ? '' : 'deployed only' }, '-', ret ? { label: 'Reinstate', act: 'reinstate' } : { label: 'Retire…', act: 'retire', danger: true }]); break; }
    case 'scan': closeLayer(); openScan(); break;
    case 'scanread': { const t = (el.dataset.tag || '').trim().toUpperCase(); if (!t) break; if (t === state.id) { const undo = snapshot(); a.lastScan = { at: `${TODAY} ${NOWT}`, who: ME, where: a.loc, what: 'confirmed on the asset page' }; a.events.unshift(E(`${TODAY} ${NOWT}`, ME, 'confirmed it by scan')); closeLayer(); render(); toast(`${esc(t)} confirmed · last scan ${NOWT}`, undo); } else if (ASSETS[t]) { go(t); toast(`Different tag · opened ${esc(t)}`); } else { const m = $('#s-msg', body); if (m) m.textContent = `No asset tagged ${t}. Check the label, or add it as a new asset.`; } break; }
    case 'move': openMenu(el, `Move ${a.tag} to`, [{ sh: 'Recent places' }, ...OTHERS.map(([l, loc, bin]) => ({ label: l, act: 'moveto', args: `data-loc="${loc}" data-bin="${bin}"`, on: a.loc === loc && a.bin === bin })), '-', { label: 'Another place…', act: 'moveother' }]); break;
    case 'moveto': { const undo = snapshot(), from = locStr(a); a.loc = el.dataset.loc; a.bin = el.dataset.bin; a.events.unshift(E(`${TODAY} ${NOWT}`, ME, `moved it from ${from} to ${locStr(a)}`)); closeLayer(); render(); toast(`${esc(a.tag)} moved to ${esc(locStr(a))}`, undo); break; }
    case 'moveother': closeLayer(); dlgShell('Move', `Move ${esc(a.tag)}`, `<div class="g2"><div class="field"><label>Location</label><select id="mv-loc">${optsLoc(a.loc)}</select></div><div class="field"><label>Bin</label><select id="mv-bin">${optsBin(a.loc, a.bin)}</select></div></div>`, `<div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="movego">Move</button>`); break;
    case 'movego': { const undo = snapshot(), from = locStr(a); a.loc = $('#mv-loc', body).value; a.bin = $('#mv-bin', body).value; a.events.unshift(E(`${TODAY} ${NOWT}`, ME, `moved it from ${from} to ${locStr(a)}`)); closeLayer(); render(); toast(`${esc(a.tag)} moved to ${esc(locStr(a))}`, undo); break; }
    case 'sched': { const t = (el && el.dataset && el.dataset.t) || 'SERVICE'; closeLayer(); dlgShell('Maintenance', `Schedule for ${esc(a.tag)}`, `<div class="g2"><div class="field"><label>Type</label><select id="sc-type">${Object.entries(MTYPE).map(([k, v]) => opt(k, v, t)).join('')}</select></div><div class="field"><label>Date</label><input id="sc-date" type="date" value="${addD(TODAY, 3)}"></div></div><div class="field"><label>Title</label><input id="sc-title" value="${t === 'TT' ? 'Test &amp; tag' : 'Service'}"></div><div class="field"><label>Assigned to</label><select id="sc-who">${['Tom Nguyen', 'Sam Okafor', 'Jayden Cole'].map(p => opt(p, p, 'Tom Nguyen')).join('')}</select></div><div class="t-micro muted">The model's service rule is every ${a.svc.every || 6} months · this adds a one-off on top.</div>`, `<div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="schedgo">Schedule</button>`); break; }
    case 'schedgo': { const type = $('#sc-type', body).value, date = $('#sc-date', body).value || addD(TODAY, 3), title = $('#sc-title', body).value.trim() || MTYPE[type], undo = snapshot(); a.maint.unshift({ id: 'm' + (a.maint.length + 10), title, type, status: 'SCHEDULED', date, result: '' }); a.events.unshift(E(`${TODAY} ${NOWT}`, ME, `scheduled ${title.toLowerCase()} for ${fmtD(date)}`)); closeLayer(); render(); toast(`${esc(title)} scheduled for ${esc(a.tag)} · ${fmtD(date)}`, undo); break; }
    case 'issue': closeLayer(); { const b = currentBooking(a); dlgShell('Maintenance', `Report an issue · ${esc(a.tag)}`, `<div class="field"><label>What is wrong</label><select id="is-type">${['Fault', 'Damage', 'Missing part', 'Other'].map(x => opt(x, x, 'Fault')).join('')}</select></div><div class="field"><label>Describe it</label><textarea id="is-text" rows="3" placeholder="e.g. Zoom grinds at full travel"></textarea></div><div class="t-small muted">${b ? `Linked to <b style="color:var(--ink)">${b.job} ${esc(JOBS[b.job].name)}</b> so the job's readiness sees it.` : 'Not on a job · recorded against the asset only.'} <button class="lnk muted" data-act="noop">Add a photo</button></div>`, `<div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="issuego">Report issue</button>`); } break;
    case 'issuego': { const txt = $('#is-text', body).value.trim(); if (!txt) { $('#is-text', body).focus(); break; } const ty = $('#is-type', body).value, undo = snapshot(); a.maint.unshift({ id: 'm' + (a.maint.length + 10), title: txt.slice(0, 60), type: 'REPAIR', status: 'OPEN', date: TODAY, result: '', issue: true }); if (ty !== 'Other') a.cond = 'Needs repair'; a.events.unshift(E(`${TODAY} ${NOWT}`, ME, `reported ${ty.toLowerCase()} · ${txt.slice(0, 50).toLowerCase()}`)); closeLayer(); render(); toast(`Issue reported on ${esc(a.tag)}${ty !== 'Other' ? ' · marked needs repair' : ''}`, undo); break; }
    case 'label': closeLayer(); dlgShell('Label', `Print label · ${esc(a.tag)}`, `<div class="lbl"><div class="qr">${qrSvg(a.tag)}</div><div><div class="t">${esc(a.tag)}</div><div class="muted" style="font-size:13px;margin-top:2px">${esc(a.model)}</div><div class="muted mono" style="font-size:12px;margin-top:6px">${esc(a.serial || 'no serial')}</div></div></div><div class="t-micro muted">The QR encodes the tag only · a scan of it opens this page.</div>`, `<button class="gh" data-act="labeldl">Download PNG</button><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="labelprint">Print</button>`); break;
    case 'labeldl': closeLayer(); toast(`${esc(a.tag)}-qr.png saved`); break;
    case 'labelprint': closeLayer(); toast(`Label for ${esc(a.tag)} sent to the label printer`); break;
    case 'likethis': closeLayer(); openForm('create', a); break;
    case 'newasset': closeLayer(); openForm('create'); break;
    case 'forceret': { const b = a.book.find(x => x.state === 'DEPLOYED'); closeLayer(); dlgShell('Force return', `Force return ${esc(a.tag)}?`, `<div class="t-small" style="line-height:1.55">For when scanning is not possible. What happens:<ul style="margin:10px 0 0;padding-left:18px;display:grid;gap:6px;color:var(--ink-2)"><li>${b ? `${b.job} ${esc(JOBS[b.job].name)}'s line for this unit is marked <b>returned</b>` : 'Its project assignments are marked returned'}</li><li>Status goes back to <b>Available</b> in ${esc(locStr(a))}</li><li>The return check is skipped · the history says who forced it</li></ul></div>`, `<div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="forceretgo">Force return</button>`); break; }
    case 'forceretgo': { const undo = snapshot(), b = a.book.find(x => x.state === 'DEPLOYED'); a.status = 'AVAILABLE'; if (b) { a.jobs.unshift({ job: b.job, out: b.from, back: TODAY }); a.book = a.book.filter(x => x !== b); } a.events.unshift(E(`${TODAY} ${NOWT}`, ME, 'force-returned it', b ? b.job : '')); closeLayer(); render(); toast(`${esc(a.tag)} force-returned to ${esc(locStr(a))}`, undo); break; }
    case 'retire': closeLayer(); dlgShell('Retire', `Retire ${esc(a.tag)}?`, retireText(a), `<button class="gh dng" data-act="deletedlg" ${a.events.length > 2 || a.jobs.length ? 'disabled style="opacity:.4;cursor:default" title="Has history · retire instead"' : ''}>Delete permanently…</button><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Keep it</button><button class="btn btn-secondary" style="color:var(--t-out)" data-act="retirego">Retire ${esc(a.tag)}</button>`); break;
    case 'retirego': { const undo = snapshot(); a.status = 'RETIRED'; a.book = a.book.filter(b => b.state === 'DEPLOYED'); a.maint = a.maint.filter(m => m.status !== 'SCHEDULED'); a.events.unshift(E(`${TODAY} ${NOWT}`, ME, 'retired it')); closeLayer(); render(); toast(`${esc(a.tag)} retired · off the floor, history kept`, undo); break; }
    case 'reinstate': { const undo = snapshot(); a.status = 'AVAILABLE'; a.events.unshift(E(`${TODAY} ${NOWT}`, ME, 'reinstated it')); closeLayer(); render(); toast(`${esc(a.tag)} reinstated`, undo); break; }
    case 'deletedlg': closeLayer(); dlgShell('Delete', `Delete ${esc(a.tag)} permanently?`, `<div class="t-small" style="line-height:1.55">Removes the asset and its maintenance and test &amp; tag history. Only possible while it has no job history. <b>This cannot be undone.</b></div>`, `<div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-secondary" style="color:var(--t-out)" data-act="deletego">Delete ${esc(a.tag)}</button>`); break;
    case 'deletego': { const t = a.tag; delete ASSETS[t]; closeLayer(); go('AURA-01'); toast(`${esc(t)} deleted · this cannot be undone`); break; }
    case 'ttreg': { const undo = snapshot(); a.tt = { ...a.tt, req: true, last: null, next: TODAY, rec: 'tt-new' }; a.events.unshift(E(`${TODAY} ${NOWT}`, ME, 'registered it for test & tag')); render(); toast(`${esc(a.tag)} registered for test & tag · first test is due today`, undo); break; }
    // overview · accessories
    case 'attach': closeLayer(); dlgShell('Accessories', `Attach to ${esc(a.tag)}`, `<div class="words" style="border:0"><button class="wd on" data-act="atkind" data-k="s">Serialised</button><button class="wd" data-act="atkind" data-k="b">Bulk</button></div><div id="at-body">${attachBody('s')}</div>`, `<div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="attachgo">Attach</button>`); state.atk = 's'; break;
    case 'atkind': state.atk = el.dataset.k; $$('.dlg .words .wd').forEach(w => w.classList.toggle('on', w.dataset.k === state.atk)); $('#at-body', body).innerHTML = attachBody(state.atk); break;
    case 'attachgo': { const undo = snapshot(); if (state.atk === 's') { const t = $('#at-s', body).value, m = { 'RC-0008': 'Rigging clamp bar', 'RC-0009': 'Rigging clamp bar', 'CB-0021': 'Cable ramp' }[t]; a.acc.serial.push({ tag: t, name: m }); toast(`${esc(t)} attached to ${esc(a.tag)}`, undo); } else { const n = $('#at-b', body).value, q = Math.max(1, +$('#at-q', body).value || 1); a.acc.bulk.push({ id: 'b' + (a.acc.bulk.length + 10), qty: q, name: n, model: false }); toast(`${q}× ${esc(n)} attached to ${esc(a.tag)}`, undo); } closeLayer(); render(); break; }
    case 'accmenu': { const k = el.dataset.k, i = +el.dataset.i, c = k === 's' ? a.acc.serial[i] : a.acc.bulk[i]; openMenu(el, c.name, [...(k === 's' && ASSETS[c.tag] ? [{ label: `Open ${c.tag}`, act: 'go', args: `data-tag="${c.tag}"` }] : []), ...(k === 'b' && c.model ? [{ label: 'Open model', href: MODELURL, small: 'Model' }, { label: 'Detach', act: 'detach', args: 'disabled', small: 'from the model' }] : [{ label: 'Detach', act: 'detach', args: `data-k="${k}" data-i="${i}"`, danger: true }])]); break; }
    case 'detach': { const undo = snapshot(), k = el.dataset.k, i = +el.dataset.i, c = (k === 's' ? a.acc.serial : a.acc.bulk).splice(i, 1)[0]; closeLayer(); render(); toast(`${esc(c.tag || c.name)} detached from ${esc(a.tag)}`, undo); break; }
    // availability
    case 'calnav': { const d = +el.dataset.d; state.calOff = d === 0 ? 0 : state.calOff + d; render(); break; }
    case 'bkhl': state.hl = state.hl === el.dataset.k ? '' : el.dataset.k; render(); { const r = $('#bk-' + state.hl.replace('#', '')); if (r && r.scrollIntoView) r.scrollIntoView({ block: 'nearest' }); } break;
    case 'bkmenu': { const k = el.dataset.k, b = a.book.find(x => x.job === k); openMenu(el, b ? `${b.job} ${JOBS[b.job].name}` : 'Service', b ? [{ label: 'Open job', href: OV, small: 'Overview' }, { label: 'Warehouse page', href: WH, small: 'Warehouse' }] : [{ label: 'Reschedule…', act: 'mresched1', args: `data-id="${k}"` }, { label: 'Cancel service', act: 'mcancel', args: `data-id="${k}"`, danger: true }]); break; }
    // checks / history
    case 'chkctx': state.chk = el.dataset.k; render(); break;
    case 'histf': state.hist = el.dataset.k; state.histN = 8; render(); break;
    case 'histmore': state.histN += 8; render(); break;
    // maintenance
    case 'mfilter': state.mf = el.dataset.k; render(); break;
    case 'msel': { const vis = a.maint.filter(m => state.mf === 'all' || (state.mf === 'done' ? m.status === 'DONE' : m.status !== 'DONE')).sort((x, y) => x.date < y.date ? 1 : -1).map(m => m.id); if (ev && ev.shiftKey && state.lastSel) { const i1 = vis.indexOf(state.lastSel), i2 = vis.indexOf(id); vis.slice(Math.min(i1, i2), Math.max(i1, i2) + 1).forEach(k => state.msel.add(k)); } else state.msel.has(id) ? state.msel.delete(id) : state.msel.add(id); state.lastSel = id; render(); break; }
    case 'mselall': { const vis = a.maint.filter(m => state.mf === 'all' || (state.mf === 'done' ? m.status === 'DONE' : m.status !== 'DONE')), all = vis.every(m => state.msel.has(m.id)); vis.forEach(m => all ? state.msel.delete(m.id) : state.msel.add(m.id)); render(); break; }
    case 'mclear': state.msel.clear(); render(); break;
    case 'mrowmenu': { const m = a.maint.find(x => x.id === id); openMenu(el, m.title, [{ label: 'Open record', act: 'noop' }, ...(m.status !== 'DONE' ? [{ label: 'Mark done', act: 'mdone1', args: `data-id="${id}"` }, { label: 'Reschedule…', act: 'mresched1', args: `data-id="${id}"` }] : []), '-', { label: 'Test & tag record', act: 'noop', small: m.type === 'TT' ? '' : 'n/a', args: m.type === 'TT' ? '' : 'disabled' }]); break; }
    case 'mdone1': { state.msel = new Set([id]); closeLayer(); act('mdone', el); break; }
    case 'mdone': { const undo = snapshot(); let n = 0; a.maint.forEach(m => { if (state.msel.has(m.id) && m.status !== 'DONE') { m.status = 'DONE'; m.date = TODAY; n++; } }); const skipped = state.msel.size - n; state.msel.clear(); if (a.cond === 'Needs repair' && !openMaint(a).length) a.cond = 'Fair'; if (n) a.events.unshift(E(`${TODAY} ${NOWT}`, ME, `marked ${n} maintenance ${n > 1 ? 'records' : 'record'} done`)); closeLayer(); render(); toast(`${n} marked done${skipped ? ` · ${skipped} already done` : ''}${a.cond === 'Fair' && n ? ' · condition back to Fair' : ''}`, undo); break; }
    case 'mresched1': state.msel = new Set([id]); closeLayer(); act('mresched', el); break;
    case 'mresched': closeLayer(); dlgShell('Maintenance', `Reschedule ${state.msel.size} ${state.msel.size > 1 ? 'records' : 'record'}`, `<div class="field"><label>New date</label><input id="rs-date" type="date" value="${addD(TODAY, 7)}"></div><div class="t-micro muted">Done records are skipped · the readiness check follows the new date.</div>`, `<div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="mreschedgo">Reschedule</button>`); break;
    case 'mreschedgo': { const d = $('#rs-date', body).value; if (!d) break; const undo = snapshot(); let n = 0; a.maint.forEach(m => { if (state.msel.has(m.id) && m.status !== 'DONE') { m.date = d; n++; } }); state.msel.clear(); closeLayer(); render(); toast(`${n} rescheduled to ${fmtD(d)}`, undo); break; }
    case 'mcancel': { const undo = snapshot(); a.maint = a.maint.filter(m => m.id !== id); closeLayer(); render(); toast('Service cancelled', undo); break; }
    // notes
    case 'compose': state.composing = true; render(); { const c = $('#compose'); if (c) c.focus(); } break;
    case 'composecancel': state.composing = false; render(); break;
    case 'post': { const t = ($('#compose') || {}).value; if (!t || !t.trim()) { $('#compose').focus(); break; } const undo = snapshot(); a.threads.unshift({ id: 't' + (a.threads.length + 10), by: ME, at: sd(TODAY), text: t.trim(), status: 'open', replies: [] }); state.composing = false; render(); toast('Discussion started', undo); break; }
    case 'expand': state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id); render(); break;
    case 'resolve': { const undo = snapshot(); a.threads.find(t => t.id === id).status = 'resolved'; render(); toast('Resolved', undo); break; }
    case 'reopen': { const undo = snapshot(); a.threads.find(t => t.id === id).status = 'open'; render(); toast('Reopened', undo); break; }
    case 'showres': state.showResolved = !state.showResolved; render(); break;
    // files
    case 'fsel': { if (ev && ev.target.closest('.dots')) break; const vis = a.photos.map(p => p.id); if (ev && ev.shiftKey && state.lastSel && vis.includes(state.lastSel)) { const i1 = vis.indexOf(state.lastSel), i2 = vis.indexOf(id); vis.slice(Math.min(i1, i2), Math.max(i1, i2) + 1).forEach(k => state.fsel.add(k)); } else state.fsel.has(id) ? state.fsel.delete(id) : state.fsel.add(id); state.lastSel = id; render(); break; }
    case 'fclear': state.fsel.clear(); render(); break;
    case 'fupload': case 'fphoto': { const undo = snapshot(), n = a.photos.length + 1; a.photos.unshift({ id: 'p' + (n + 20), name: name === 'fphoto' ? `Photo ${fmtD(TODAY)}.jpg` : `${a.tag} upload ${n}.jpg`, size: '1.0 MB', by: ME, at: TODAY, primary: a.photos.length === 0 }); render(); toast(`Photo added to ${esc(a.tag)}`, undo); break; }
    case 'fmenu': { const p = a.photos.find(x => x.id === id); openMenu(el, p.name, [{ label: 'Open', act: 'noop' }, { label: 'Set as photo', act: 'fprimary1', args: `data-id="${id}"`, on: p.primary }, { label: 'Download', act: 'fdl1', args: `data-id="${id}"` }, '-', { label: 'Remove', act: 'fremove1', args: `data-id="${id}"`, danger: true }]); break; }
    case 'docmenu': { const d = a.docs[+el.dataset.i]; openMenu(el, d[0], [{ label: 'Open', act: 'noop' }, { label: 'Download', act: 'noop' }, { label: 'Manage on the model', href: MODELURL, small: 'Model' }]); break; }
    case 'fprimary1': state.fsel = new Set([id]); closeLayer(); act('fprimary', el); break;
    case 'fprimary': { const undo = snapshot(), k = [...state.fsel][0]; a.photos.forEach(p => { p.primary = p.id === k; }); state.fsel.clear(); closeLayer(); render(); toast('Primary photo changed', undo); break; }
    case 'fdl1': state.fsel = new Set([id]); closeLayer(); act('fdl', el); break;
    case 'fdl': { const n = state.fsel.size; state.fsel.clear(); closeLayer(); render(); toast(`${n} file${n > 1 ? 's' : ''} downloaded`); break; }
    case 'fremove1': state.fsel = new Set([id]); closeLayer(); act('fremove', el); break;
    case 'fremove': { const undo = snapshot(), n = state.fsel.size, hadPrimary = a.photos.some(p => p.primary && state.fsel.has(p.id)); a.photos = a.photos.filter(p => !state.fsel.has(p.id)); if (hadPrimary && a.photos.length) a.photos[0].primary = true; state.fsel.clear(); render(); toast(`${n} photo${n > 1 ? 's' : ''} removed${a.photos.length ? '' : ' · back to the model photo'}`, undo); break; }
    // forms
    case 'formgo': { readForm(); const e = validate(); if (Object.keys(e).length) { const k = Object.keys(e)[0], i = $('#f-' + k, body); if (i) i.focus(); break; } state.form.mode === 'edit' ? commitEdit() : commitCreate(false); break; }
    case 'formadd': { readForm(); const e = validate(); if (Object.keys(e).length) { const k = Object.keys(e)[0], i = $('#f-' + k, body); if (i) i.focus(); break; } commitCreate(true); break; }
    case 'pickmodel': { const f = state.form; f.model = el.dataset.n; const m = modelOf(f.model); if (m) { f.tag = nextTag(m); f.supplier = f.supplier || m.supplier; } else { const bm = BULKM.find(b => b[0] === f.model); f.tag = bm ? bm[1] : ''; } drawForm(); break; }
    case 'changemodel': readForm(); state.form.model = ''; state.form.mq = ''; drawForm('#m-q'); break;
    case 'fkind': readForm(); state.form.kind = el.dataset.k; state.form.model = ''; state.form.mq = ''; drawForm('#m-q'); break;
    case 'moretoggle': readForm(); state.form.more = true; drawForm(); break;
    case 'locchg': break;
    case 'csv': { readForm(); closeLayer(); state.csv = null; csvDialog(); break; }
    case 'csvfile': state.csv = [['AURA-08', 'Martin MAC Aura XB', 'new'], ['SK-0043', 'Sennheiser EW-DX SK beltpack', 'new'], ['AURA-03', 'Martin MAC Aura XB', 'update · location → Warehouse A / A1'], ['Y9-0001', 'd&b Y9', 'error · unknown model']]; csvDialog(); break;
    case 'csvgo': { const undo = snapshot(); const m1 = modelOf('Martin MAC Aura XB'), m2 = modelOf('Sennheiser EW-DX SK beltpack'); [['AURA-08', m1], ['SK-0043', m2]].forEach(([t, m]) => { ASSETS[t] = { ...baseAsset(), tag: t, model: m.name, cat: m.cat, code: m.code, status: 'AVAILABLE', cond: 'New', loc: 'Warehouse A', bin: '', repl: m.repl, tt: { req: m.tt, last: null, next: null }, events: [E(`${TODAY} ${NOWT}`, ME, 'added it · CSV import')] }; }); ASSETS['AURA-03'].loc = 'Warehouse A'; ASSETS['AURA-03'].bin = 'A1'; closeLayer(); state.form = null; render(); toast('CSV imported · 2 created · 1 updated · 1 skipped', undo); break; }
  }
}
function attachBody(k) { return k === 's' ? `<div class="field"><label>Accessory asset</label><select id="at-s">${[['RC-0008', 'Rigging clamp bar'], ['RC-0009', 'Rigging clamp bar'], ['CB-0021', 'Cable ramp']].map(([t, n]) => `<option value="${t}">${t} · ${n}</option>`).join('')}</select></div><div class="t-micro muted">One unit, tracked by tag · it travels and deploys with ${esc(cur().tag)}.</div>` : `<div class="g2"><div class="field"><label>Bulk item</label><select id="at-b">${BULKM.map(([n]) => `<option>${n}</option>`).join('')}</select></div><div class="field"><label>Quantity</label><input id="at-q" type="number" min="1" value="1"></div></div><div class="t-micro muted">Counted, not tagged · ships with this unit.</div>`; }
function csvDialog() {
  const rows = state.csv;
  dlgShell('Import', 'Import assets from CSV', `<div class="t-small muted" style="line-height:1.55"><b style="color:var(--ink-2)">Expected columns</b> · modelName (required), assetTag (auto if empty), serialNumber, customName, status, condition, locationName, purchaseDate, purchasePrice, supplierName, notes. Existing assets are matched by asset tag and updated.</div>${rows ? `<div>${rows.map(r => `<div class="rrow" style="min-height:40px;padding:6px 0"><span class="mono" style="width:70px;font-size:12.5px">${r[0]}</span><div class="grow" style="font-size:13px">${esc(r[1])}</div>${dw(r[2].split(' ')[0], r[2].startsWith('new') ? 'ok' : r[2].startsWith('update') ? 'info' : 'err')}</div>`).join('')}<div class="t-micro muted" style="margin-top:6px">${rows.filter(r => r[2].startsWith('error')).length} row will be skipped · ${rows[3][2]}</div></div>` : `<div><button class="btn btn-secondary" data-act="csvfile">Choose file…</button> <span class="t-micro muted" style="margin-left:8px">asset-import.csv · 4 rows (sample)</span></div>`}`, `<div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button>${rows ? '<button class="btn btn-primary" data-act="csvgo">Import 3 rows</button>' : ''}`, true);
}

// ---------- listeners
document.addEventListener('input', ev => {
  const t = ev.target;
  if (t.id === 'note') { const c = $('#notecnt'); if (c) c.textContent = t.value.length.toLocaleString() + ' / 2,000'; const f = $('#notefoot span'); if (f) f.innerHTML = '<span style="color:var(--warn)">Unsaved · click away to save</span>'; }
  if (t.id === 'm-q' && state.form) { state.form.mq = t.value; const pos = t.selectionStart; drawForm('#m-q'); const i = $('#m-q', body); if (i) i.setSelectionRange(pos, pos); }
  if (t.id === 'f-tag' && state.form) { const v = t.value.trim(), el = $('#e-tag', body); if (el) el.textContent = !v ? 'Asset tag is required' : tagTaken(v, state.form.mode === 'edit' ? state.form.orig : '') ? `${v.toUpperCase()} is already used by another asset` : ''; }
});
document.addEventListener('change', ev => { const t = ev.target; if ((t.id === 'f-loc' || t.id === 'mv-loc')) { const bin = $(t.id === 'f-loc' ? '#f-bin' : '#mv-bin', body); if (bin) bin.innerHTML = optsBin(t.value, ''); } });
document.addEventListener('focusout', ev => { const t = ev.target; if (t.id === 'note') { const a = cur(); if (a && t.value !== a.notes) { const undo = snapshot(); a.notes = t.value; a.notesBy = ME; a.notesAt = TODAY; toast('Note saved', undo); const f = $('#notefoot span'); if (f) f.textContent = `Saved · ${ME} · ${sd(TODAY)}`; } } });
document.addEventListener('keydown', ev => {
  const t = ev.target;
  if (ev.key === 'Enter' && t.id === 's-tag') { ev.preventDefault(); act('scanread', { dataset: { tag: t.value } }); }
  if (ev.key === 'Enter' && t.id === 'm-q') { ev.preventDefault(); const first = $('#m-res [data-act="pickmodel"]', body); if (first) act('pickmodel', first); }
  if (ev.key === 'Enter' && t.dataset && t.dataset.reply && t.value.trim()) { const a = cur(), undo = snapshot(), th = a.threads.find(x => x.id === t.dataset.reply); th.replies.push({ by: ME, at: sd(TODAY), text: t.value.trim() }); render(); toast('Reply posted', undo); }
  if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey) && t.id === 'compose') act('post', t);
}, false);
window.addEventListener('keydown', ev => { // page keys: replace the list-page '/' and 'n' of the kit
  if (!['/', 'n', 'N', 'e'].includes(ev.key) || ev.metaKey || ev.ctrlKey || ev.target.matches('input,textarea,select') || $('#layer').classList.contains('open')) return;
  ev.stopImmediatePropagation(); ev.preventDefault(); if (ev.key === '/') act('scan', null); else if (ev.key === 'e') act('edit', null); else act('newasset', null);
}, true);
window.addEventListener('hashchange', () => { const o = state.id, ot = state.tab; readHash(); if (o !== state.id || ot !== state.tab) render(); });
readHash();
render();
