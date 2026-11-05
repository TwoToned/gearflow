// recgear — Gear records: location · kit · maintenance job · test & tag record · category (pattern 4.2)
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const TODAY = '2026-11-09', NOWT = '09:41', ME = 'Jayden Cole';
const AR = 'https://claude.ai/artifact/';
const U = { gear: AR + 'D7N5PmXKrkcY2gzZXWeuvc', asset: AR + 'Rr5rwirCUMRy8gf5G6Vz7s', model: AR + '47miWruJVsednbzrFPij2b', ov: AR + 'RatKsWfTmDJLJHmn6mb7Zo', scan: AR + '8Q2HVoRhLbSLz1Q9mCtayX', wh: AR + 'Mt8p55xkPkkexVWPC5eaGU', sched: 'https://claude.ai/artifact/49jbSumcZhVdCU9ZA3nqdm', forms: AR + 'REMbu5TYg5Nx6iJJoPLuGy', packing: AR + 'HSAZTyzfjG2A7sCjUe9wsM' };
const GL = k => U.gear + '#list=' + k;
const rnd = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(7);
const addD = (d, n) => new Date((dayNum(d) + n) * 864e5).toISOString().slice(0, 10);
const dow = d => (((dayNum(d) - dayNum('2026-11-11') + 2) % 7) + 7) % 7; // fixture calendar: 11 Nov 2026 is a Tuesday
const sd = d => `${WD[dow(d)]} ${+d.slice(8, 10)} ${MON[+d.slice(5, 7) - 1]}`;
const rng = (a, b) => (!b || a === b) ? fmtD(a) : fmtRange(a, b);
const fmtL = d => d ? `${+d.slice(8, 10)} ${MON[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}` : '';
const fmtY = d => d && d.slice(0, 4) !== TODAY.slice(0, 4) ? fmtL(d) : fmtD(d);
const addM = (d, m) => { let y = +d.slice(0, 4), mo = +d.slice(5, 7) - 1 + m; y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12; return `${y}-${String(mo + 1).padStart(2, '0')}-${d.slice(8, 10)}`; };
const until = d => dayNum(d) - dayNum(TODAY);
const atStr = s => { const d = s.slice(0, 10); return d === TODAY ? `Today ${s.slice(11)}` : `${fmtY(d)} ${s.slice(11)}`; };
const dw = (txt, cls) => `<span class="dotw ${cls || ''}">${txt}</span>`;
const plural = (n, a, b) => `${n} ${n === 1 ? a : (b || a + 's')}`;
const clone = o => JSON.parse(JSON.stringify(o));
const JOBS = {
  '#2341': { name: 'Hilton Sydney gala dinner', from: '2026-11-12', to: '2026-11-14', st: ['Confirmed', 'ok'] },
  '#2350': { name: 'Qantas awards', from: '2026-11-13', to: '2026-11-14', st: ['Confirmed', 'ok'] },
  '#2338': { name: 'Corporate AGM', from: '2026-11-21', to: '2026-11-21', st: ['Confirmed', 'ok'] },
  '#2340': { name: 'Launch night', from: '2026-11-27', to: '2026-11-27', st: ['Quoted', 'info'] },
  '#2314': { name: 'UNSW graduation', from: '2026-11-05', to: '2026-11-09', st: ['Checked out', 'live'] },
};
const jobLink = j => `<a href="${U.ov}"><span class="mono">${j}</span> ${esc(JOBS[j].name)}</a>`;

// ---------- the pool of assets homed in Warehouse A (derived counts everywhere read from it)
const BINS = [['A1', 17, 40], ['A2', 48, 60], ['A3-14', 24, 40], ['B1', 71, 80], ['B2', 38, 60], ['B3', 52, 60], ['C1', 44, 60], ['C2', 63, 80], ['C3', 37, 50], ['C4', 9, 30], ['Repair bench', 6, 12]];
const GENM = [['Martin MAC Aura PXL', 'L', 4, 'S', 2], ['d&b Y8', 'Y8', 4, 'S', 3], ['Sennheiser EW-DX SK beltpack', 'SK', 4, 'S', 4], ['Sennheiser EM4 receiver', 'A', 4, 'S', 2], ['Robe T1 Profile', 'T1', 2, 'S', 1], ['Chauvet COLORado Panel Q40', 'CLRD', 2, 'S', 3], ['Shure SM58', 'SM58', 2, 'S', 2], ['Prolyte H30V 3m', 'H30V', 2, 'S', 3], ['CM Lodestar 1T', 'LODE', 2, 'S', 1], ['XLR 10m', 'XLR10', 0, 'B', 3], ['Socapex 20m', 'SOCA20', 0, 'B', 2], ['Powercon 5m', 'PC5', 0, 'B', 2], ['Omega clamp', 'OC-100', 0, 'B', 1], ['Gaffer tape, black', 'GT-B', 0, 'B', 1]];
let POOL = [];
(function seedPool() {
  const used = new Set(), P = (bin, kind, tag, name, o) => { used.add(tag); POOL.push({ tag, name, kind, bin, st: 'Available', job: '', cs: '', fl: '', qty: kind === 'B' ? 20 + Math.floor(rnd() * 60) : 1, ...o }); };
  const AX = 'Martin MAC Aura XB';
  P('B2', 'S', 'AURA-01', AX, { st: 'Reserved', job: '#2341', cs: 'LX-02' }); P('B2', 'S', 'AURA-02', AX, { fl: 'T&T overdue' }); P('B2', 'S', 'AURA-03', AX, { cs: 'LX-02' }); P('B2', 'S', 'AURA-04', AX, { cs: 'LX-02' }); P('B2', 'S', 'AURA-05', AX, { cs: 'LX-02' }); P('Repair bench', 'S', 'AURA-06', AX, { st: 'In maintenance', fl: 'fan fault' }); P('B2', 'S', 'AURA-10', AX, { fl: 'T&T overdue' });
  P('B2', 'S', 'L-0001', 'Martin MAC Aura PXL', { cs: 'LX-02' }); P('B2', 'S', 'L-0002', 'Martin MAC Aura PXL', { cs: 'LX-02', st: 'Reserved', job: '#2341' }); P('Repair bench', 'S', 'L-0004', 'Martin MAC Aura PXL', { st: 'In maintenance', fl: 'gobo wheel' });
  P('A3-14', 'S', 'SK-0012', 'Sennheiser EW-DX SK beltpack', { fl: 'battery door' }); P('Repair bench', 'S', 'A-0302', 'Sennheiser EM4 receiver', { st: 'In maintenance', fl: 'antenna BNC' }); P('C2', 'S', 'V-0011', 'Barco UDX-4K32', { cs: 'VID-04' });
  [['LX-02', 'B2', 'Lighting road case'], ['LX-04', 'A2', 'Lighting road case'], ['VID-04', 'C2', 'Video road case'], ['BATT-01', 'C3', 'Battery charging case'], ['CS-01', 'A1', 'Road case'], ['CS-02', 'B1', 'Road case'], ['CS-03', 'B1', 'Road case'], ['CS-04', 'B3', 'Road case'], ['CS-05', 'C1', 'Road case'], ['CS-06', 'C2', 'Road case']].forEach(([t, b, n]) => P(b, 'C', t, n, {}));
  [['K-0042', 'A3-14', 'Shure ULXD4Q wireless kit', { st: 'Incomplete', job: '#2341' }], ['K-0017', 'A2', 'Lighting touring pack', { st: 'Reserved', job: '#2341' }], ['K-0021', 'B2', 'Video flypack', {}], ['K-0033', 'A3-14', 'FOH audio rack', {}], ['K-0029', 'A3-14', 'Foldback pack', {}], ['K-0051', 'C4', 'Comms kit (Clear-Com)', { st: 'Incomplete' }], ['K-0060', 'A1', 'Lectern & confidence pack', { st: 'Incomplete' }], ['K-0072', 'B2', 'Streaming desk', {}], ['K-0008', 'B1', 'Power distro 63A', { st: 'Reserved', job: '#2350' }], ['K-0014', 'C1', 'LED wash pack (8×)', { st: 'Reserved', job: '#2340' }]].forEach(([t, b, n, o]) => P(b, 'K', t, n, o));
  P('', 'S', 'SK-0041', 'Sennheiser EW-DX SK beltpack', {}); P('', 'S', 'SK-0042', 'Sennheiser EW-DX SK beltpack', {}); P('', 'S', 'Y8-12', 'd&b Y8', {});
  const cnt = {}; GENM.forEach(m => cnt[m[1]] = m[1] === 'SK' ? 43 : m[1] === 'A' ? 303 : m[1] === 'L' ? 5 : m[1] === 'Y8' ? 13 : 1);
  const mk = m => { let t; do { const n = cnt[m[1]]++; t = m[3] === 'B' ? m[1] : m[1] + '-' + String(n).padStart(m[2], '0'); } while (m[3] === 'S' && used.has(t)); return t; };
  BINS.forEach(([b, n]) => {
    let have = POOL.filter(p => p.bin === b).length;
    while (have < n) { const bulk = rnd() < .16, cand = GENM.filter(m => (m[3] === 'B') === bulk), m = cand[Math.floor(rnd() * cand.length)]; const tag = m[3] === 'B' ? m[1] + (POOL.filter(p => p.bin === b && p.tag.startsWith(m[1])).length ? '' : '') : mk(m); if (m[3] === 'B' && POOL.some(p => p.bin === b && p.tag === m[1])) continue; P(b, m[3], tag, m[0], {}); have++; }
  });
  // two more in the repair bench in maintenance, and nine out on UNSW graduation
  POOL.filter(p => p.bin === 'Repair bench' && p.st === 'Available').slice(0, 3).forEach(p => { p.st = 'In maintenance'; });
  POOL.filter(p => p.kind === 'S' && p.st === 'Available' && p.bin !== 'Repair bench' && !p.cs && !p.fl).filter((_, i) => i % 29 === 3).slice(0, 9).forEach(p => { p.st = 'Deployed'; p.job = '#2314'; });
  // fill each case with up to 5 loose units from its own bin
  POOL.filter(p => p.kind === 'C' && p.tag !== 'LX-02' && p.tag !== 'VID-04').forEach(c => { POOL.filter(p => p.kind === 'S' && p.bin === c.bin && !p.cs && p.st === 'Available' && !p.fl).slice(0, 4).forEach(p => { p.cs = c.tag; }); });
  const wt = p => p.fl || p.st === 'In maintenance' || p.st === 'Incomplete' ? 0 : p.st === 'Reserved' ? 1 : 2; // what needs a person first, then the rest by kind and tag
  POOL.sort((a, b) => wt(a) - wt(b) || ('SBKC'.indexOf(a.kind) - 'SBKC'.indexOf(b.kind)) || (a.tag < b.tag ? -1 : 1));
})();
const KINDN = { S: 'Serialised', B: 'Bulk', K: 'Kit', C: 'Case' };
const poolStatus = p => { const m = { Available: ['Available', 'ok'], Reserved: ['Reserved', 'info'], Deployed: ['Deployed', 'live'], 'In maintenance': ['In maintenance', 'warn'], Incomplete: ['Incomplete', 'warn'] }[p.st]; return dw(m[0], m[1]); };

// ---------- locations (Warehouse A + its bins are real records; the bins' contents are pool rows)
const LOCT = { WAREHOUSE: 'Warehouse', VENUE: 'Venue', VEHICLE: 'Vehicle', OFFSITE: 'Off-site' };
const LOCEV = [['2026-11-09 08:12', 'Sam Okafor', 'moved 4 assets into B2 from the dock'], ['2026-11-09 07:55', 'Sam Okafor', 'put away L-0003 and L-0005 in B2'], ['2026-11-09 07:40', 'Sam Okafor', 'received 2 beltpacks from Scene Change · SK-0041, SK-0042 have no bin yet'], ['2026-11-07 16:10', 'Tom Nguyen', 'moved AURA-06 to Repair bench · fan fault'], ['2026-11-06 16:40', 'Tom Nguyen', 'moved K-0033 to A3-14'], ['2026-11-06 09:15', 'Sam Okafor', 'printed 9 bin labels'], ['2026-11-05 11:02', 'Sam Okafor', 'moved 6 assets into A1'], ['2026-11-04 17:20', 'Tom Nguyen', 'returned 12 assets from #2296 Marriott conference · put away in C2'], ['2026-11-04 08:30', 'Jayden Cole', 'set Warehouse A as the default location for new assets'], ['2026-10-30 14:05', 'Sam Okafor', 'moved Y8-02, Y8-03 to C1'], ['2026-10-29 09:30', 'Tom Nguyen', 'moved 3 assets into C4'], ['2026-10-27 12:00', 'Sam Okafor', 'added bin C3'], ['2026-10-22 10:10', 'Jayden Cole', 'raised capacity to 600'], ['2026-10-14 15:45', 'Sam Okafor', 'moved K-0051 to C4'], ['2026-10-09 13:20', 'Tom Nguyen', 'put away 18 assets after #2288 · B1']];
const mkEv = a => a.map(([at, who, text, job]) => ({ at, who, text, job: job || '', kind: 'change' }));
let REC = { loc: {}, kit: {}, maint: {}, tt: {}, cat: {} };
REC.loc.wa = { id: 'wa', name: 'Warehouse A', type: 'WAREHOUSE', parent: '', address: '14 Industry Rd, Marrickville NSW', notes: 'Main warehouse. Dock is on the Industry Rd side; Van 2 loads at the roller door.', tags: 'main', isDefault: true, cap: 600, printed: true, events: mkEv(LOCEV), files: [{ id: 'f1', name: 'Warehouse A floor plan.pdf', size: '1.2 MB', at: '2026-09-30', by: 'Sam Okafor', pdf: true }, { id: 'f2', name: 'Bin label sheet A4.pdf', size: '88 KB', at: '2026-11-06', by: 'Sam Okafor', pdf: true }, { id: 'f3', name: 'Dock side.jpg', size: '2.4 MB', at: '2026-08-12', by: 'Tom Nguyen' }, { id: 'f4', name: 'Bay C racking.jpg', size: '1.9 MB', at: '2026-08-12', by: 'Tom Nguyen' }] };
BINS.forEach(([b, n, cap]) => { const id = b.toLowerCase().replace(/\s+/g, '-'); REC.loc[id] = { id, name: b, bin: b, type: 'WAREHOUSE', parent: 'wa', address: '', notes: '', tags: '', isDefault: false, cap, printed: !['C3', 'Repair bench'].includes(b), events: mkEv(LOCEV.filter(e => e[2].includes(b + ' ') || e[2].endsWith(b)).slice(0, 4).concat([['2026-11-0' + (2 + n % 5) + ' 1' + (n % 9) + ':' + (10 + n % 40), n % 2 ? 'Sam Okafor' : 'Tom Nguyen', `put away ${3 + n % 7} assets in ${b}`]])).sort((x, y) => x.at < y.at ? 1 : -1), files: [] }; });
const locChildren = () => Object.values(REC.loc).filter(l => l.parent === 'wa');
const locId = name => (Object.values(REC.loc).find(l => l.name === name) || {}).id;
const locPool = l => l.bin !== undefined ? POOL.filter(p => p.bin === l.bin) : POOL;
const binOf = (p) => p.bin || 'No bin';

// ---------- kit K-0042
const KIT_ITEMS = [
  { id: 'i1', tag: 'ULXD-01', name: 'Shure ULXD4Q receiver', serial: 'SHU-4Q-20418', qty: 1, bulk: false, present: true, pos: 'Slot 1', cond: 'Good' },
  { id: 'i2', tag: 'SK-0013', name: 'Sennheiser EW-DX SK beltpack', serial: 'EWDX-7731-0913', qty: 1, bulk: false, present: true, pos: 'Tray A1', cond: 'Good' },
  { id: 'i3', tag: 'SK-0014', name: 'Sennheiser EW-DX SK beltpack', serial: 'EWDX-7731-0914', qty: 1, bulk: false, present: true, pos: 'Tray A2', cond: 'Good' },
  { id: 'i4', tag: 'SK-0015', name: 'Sennheiser EW-DX SK beltpack', serial: 'EWDX-7731-0915', qty: 1, bulk: false, present: true, pos: 'Tray A3', cond: 'Good' },
  { id: 'i5', tag: 'SK-0016', name: 'Sennheiser EW-DX SK beltpack', serial: 'EWDX-7731-0916', qty: 1, bulk: false, present: true, pos: 'Tray A4', cond: 'Fair' },
  { id: 'i6', tag: 'PA-0003', name: 'PA805 antenna distribution', serial: 'PA805-22910', qty: 1, bulk: false, present: false, pos: 'Lid pocket', cond: 'Good' },
  { id: 'i7', tag: 'ANT-10', name: 'Paddle antenna', serial: '', qty: 3, bulk: true, present: true, pos: 'Side foam', cond: 'Good' },
];
REC.kit.k42 = { id: 'k42', tag: 'K-0042', name: 'Shure ULXD4Q wireless kit', cat: 'Audio', loc: 'Warehouse A', bin: 'A3-14', cond: 'Good', mode: 'PER_ITEM', caseType: 'Pelican 1650', dims: '740 × 450 × 270 mm', weight: 14.2, xero: '200', pdate: '2024-02-03', price: 6850, repl: 38600, desc: 'Four-channel wireless: receiver, four beltpacks, antenna distribution and paddles. Check frequencies before the truck.', tags: 'wireless', job: { id: '#2341', from: '2026-11-12', to: '2026-11-14', truck: '2026-11-11 06:30' }, retired: false, maintOpen: false, items: KIT_ITEMS, lastCheck: { at: '2026-11-04 15:10', who: 'Sam Okafor', ctx: 'Return from #2296' },
  checks: [{ id: 'c1', label: 'Case latches and lid foam intact', type: 'Pass / fail' }, { id: 'c2', label: 'Beltpacks charged', type: 'Pass / fail' }, { id: 'c3', label: 'Antennas present', type: 'Measurement', unit: 'count' }, { id: 'c4', label: 'Frequency block noted', type: 'Notes' }],
  runs: [{ id: 'r1', at: '2026-11-04 15:10', who: 'Sam Okafor', ctx: 'Return', job: '#2296', out: 'PA805 antenna distribution not in the case · 8 of 9 present' }, { id: 'r2', at: '2026-10-27 08:20', who: 'Tom Nguyen', ctx: 'Prep', job: '#2296', out: '9 of 9 present · all pass' }, { id: 'r3', at: '2026-10-09 17:05', who: 'Sam Okafor', ctx: 'Return', job: '#2288', out: '9 of 9 present · SK-0016 battery door loose' }],
  events: mkEv([['2026-11-04 15:10', 'Sam Okafor', 'checked it in after #2296 · PA805 antenna distribution missing', '#2296'], ['2026-11-04 15:12', 'Sam Okafor', 'marked PA-0003 missing'], ['2026-11-03 09:00', 'Jayden Cole', 'reserved it on #2341', '#2341'], ['2026-10-27 08:20', 'Tom Nguyen', 'checked it out to #2296', '#2296'], ['2026-10-09 17:05', 'Sam Okafor', 'checked it in after #2288 · SK-0016 battery door loose', '#2288'], ['2026-09-12 11:30', 'Jayden Cole', 'changed check mode to Check each item'], ['2026-02-03 10:00', 'Mel Torres', 'added it · purchased for $6,850']]),
  files: [{ id: 'f1', name: 'K-0042 open case.jpg', size: '2.8 MB', at: '2026-09-12', by: 'Sam Okafor' }, { id: 'f2', name: 'Packing diagram.pdf', size: '640 KB', at: '2026-09-12', by: 'Sam Okafor', pdf: true }, { id: 'f3', name: 'Frequency plan Nov.pdf', size: '120 KB', at: '2026-11-03', by: 'Jayden Cole', pdf: true }] };
const kitMissing = k => k.items.filter(i => !i.present);
const kitCount = k => k.items.reduce((s, i) => s + i.qty, 0);
const kitPresent = k => k.items.filter(i => i.present).reduce((s, i) => s + i.qty, 0);

// ---------- maintenance job
const MTYPE = { REPAIR: 'Repair', PREVENTATIVE: 'Preventative', TEST_AND_TAG: 'Test & tag', INSPECTION: 'Inspection', CLEANING: 'Cleaning', FIRMWARE_UPDATE: 'Firmware update' };
const MSTAT = { SCHEDULED: ['Scheduled', ''], AWAITING_PARTS: ['Awaiting parts', 'warn'], IN_PROGRESS: ['In progress', 'info'], QA: ['QA', 'info'], COMPLETED: ['Completed', 'ok'], CANCELLED: ['Cancelled', ''] };
const RESN = { PASS: ['Pass', 'ok'], FAIL: ['Fail', 'err'], CONDITIONAL: ['Conditional', 'warn'] };
const DISP = { RETURN_TO_SERVICE: 'Return to service', KEEP_OUT_OF_SERVICE: 'Keep out of service', RETIRE: 'Retire asset' };
REC.maint.m188 = { id: 'm188', num: 'MT-0188', title: 'Fan fault, overheats after 20 min', type: 'REPAIR', status: 'AWAITING_PARTS', assets: [{ tag: 'AURA-06', model: 'Martin MAC Aura XB' }], by: 'Sam Okafor', to: 'Tom Nguyen', desc: 'Head overheats and drops output after about twenty minutes at full. Fan bearing is noisy when it spins up. Pulled from LX-02 on Fri 7 Nov.', sched: '2026-11-07', done: '', labour: 0, result: '', next: '', disp: {}, tags: 'fan', retest: '2026-11-13',
  parts: [{ id: 'p1', name: 'Fan assembly, MAC Aura XB', sup: 'Martin Pro Audio', qty: 1, cost: 185, st: 'ORDERED', eta: '2026-11-12' }, { id: 'p2', name: 'Fan bracket and screws', sup: 'Martin Pro Audio', qty: 1, cost: 40, st: 'ORDERED', eta: '2026-11-12' }, { id: 'p3', name: 'Thermal paste', sup: 'Workshop stock', qty: 1, cost: 15, st: 'ARRIVED', eta: '' }],
  events: mkEv([['2026-11-07 15:30', 'Tom Nguyen', 'ordered the fan assembly and bracket from Martin Pro Audio · ETA 12 Nov'], ['2026-11-07 14:50', 'Tom Nguyen', 'diagnosed a failed fan bearing · status Awaiting parts'], ['2026-11-07 11:20', 'Sam Okafor', 'reported it · pulled from LX-02, moved to Repair bench'], ['2026-11-07 11:21', 'Sam Okafor', 'marked AURA-06 In maintenance']]),
  files: [{ id: 'f1', name: 'Fan bearing.jpg', size: '1.6 MB', at: '2026-11-07', by: 'Tom Nguyen' }, { id: 'f2', name: 'Fault label.jpg', size: '1.1 MB', at: '2026-11-07', by: 'Sam Okafor' }] };
const partsTotal = m => m.parts.reduce((s, p) => s + (p.cost || 0) * p.qty, 0);
const mCost = m => partsTotal(m) + (+m.labour || 0);

// ---------- test & tag record
const TT_LIM = { earth: 0.2, ins: 1, leak: 3.5 };
const ttOk = t => t.vis && t.earth <= TT_LIM.earth && t.ins >= TT_LIM.ins && t.leak <= TT_LIM.leak;
REC.tt.tt402 = { id: 'tt402', num: 'TT-0402', tag: 'AURA-02', cls: 'Class I', appliance: 'Moving head luminaire', make: 'Martin', model: 'Martin MAC Aura XB', serial: 'MA2041577', loc: 'Warehouse A / B2', months: 12, retired: false, notes: '',
  tests: [{ id: 't6', at: '2025-10-22', who: 'Sam Okafor', vis: true, earth: 0.07, ins: 299, leak: 0.18 }, { id: 't5', at: '2024-10-18', who: 'Tom Nguyen', vis: true, earth: 0.06, ins: 299, leak: 0.21 }, { id: 't4', at: '2023-10-20', who: 'Sam Okafor', vis: true, earth: 0.08, ins: 287, leak: 0.24 }, { id: 't3', at: '2022-11-02', who: 'Sam Okafor', vis: true, earth: 0.07, ins: 299, leak: 0.2, note: 'Retest after the earth lead was replaced' }, { id: 't2', at: '2022-10-24', who: 'Sam Okafor', vis: true, earth: 0.41, ins: 299, leak: 0.19, note: 'Earth continuity above the limit', mt: 'MT-0151' }, { id: 't1', at: '2021-10-25', who: 'Tom Nguyen', vis: true, earth: 0.09, ins: 299, leak: 0.17 }],
  booked: null,
  events: mkEv([['2025-10-22 10:40', 'Sam Okafor', 'tested it · pass'], ['2025-10-22 10:41', 'Sam Okafor', 'printed the tag · next due 22 Oct 2026'], ['2024-10-18 09:15', 'Tom Nguyen', 'tested it · pass'], ['2023-10-20 11:00', 'Sam Okafor', 'tested it · pass'], ['2022-11-02 14:30', 'Sam Okafor', 'tested it · pass, retest after MT-0151'], ['2022-10-24 13:05', 'Sam Okafor', 'tested it · fail, earth continuity 0.41 Ω · raised MT-0151 and took it out of service'], ['2021-10-25 10:00', 'Tom Nguyen', 'registered it for test & tag · first test pass']]),
  files: [{ id: 'f1', name: 'AURA-02 certificate 2025.pdf', size: '74 KB', at: '2025-10-22', by: 'Sam Okafor', pdf: true }, { id: 'f2', name: 'AURA-02 certificate 2024.pdf', size: '71 KB', at: '2024-10-18', by: 'Tom Nguyen', pdf: true }, { id: 'f3', name: 'Rating plate.jpg', size: '1.3 MB', at: '2021-10-25', by: 'Tom Nguyen' }] };
const ttSorted = t => [...t.tests].sort((a, b) => a.at < b.at ? 1 : -1);
const ttLast = t => ttSorted(t)[0] || null;
const ttNext = t => { const l = ttLast(t); return l ? addM(l.at, t.months) : null; };
function ttState(t) { if (t.retired) return ['Retired', '']; const l = ttLast(t); if (!l) return ['Not tested', '']; if (!ttOk(l)) return ['Failed', 'err']; const d = until(ttNext(t)); return d < 0 ? ['Overdue', 'err'] : d <= 30 ? ['Due soon', 'warn'] : ['Current', 'ok']; }

// ---------- categories
const CMODELS = [['Martin MAC Aura XB', 8, 95, true], ['Martin MAC Aura PXL', 6, 140, true], ['Robe T1 Profile', 6, 120, true], ['Chauvet COLORado Panel Q40', 12, 60, true], ['GrandMA3 light', 1, 650, true, 'Class II · 6 months'], ['Martin MAC 700 Profile', 4, 0, true], ['Chauvet Rogue R2', 6, 0, true]];
const CAT_SUB = { 'moving-heads': ['Moving heads', [['Robe Pointe', 4, 95, true], ['Elation Proteus Hybrid', 2, 160, true]]], 'led-wash': ['LED wash', [['Chauvet STRIKE Array 4', 8, 45, true], ['Martin RUSH Par 2 RGBW', 6, 25, true]]], 'haze-fx': ['Haze & FX', [['Unique 2.1 hazer', 3, 70, false], ['Martin Atomic 3000', 4, 35, true]]] };
REC.cat.lighting = { id: 'lighting', name: 'Lighting', parent: '', icon: 'LX', desc: 'Moving lights, wash and effects fixtures, consoles and haze.', tags: 'fixtures', sort: 1, xero: '200', ttcls: 'Class I', ttmonths: 12, models: CMODELS.map(([n, own, day, tt, ov]) => ({ id: 'm-' + n.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: n, own, day, tt, ov: ov || '' })), kits: [{ id: 'kk1', tag: 'K-0017', name: 'Lighting touring pack', items: 14, st: 'Reserved', job: '#2341' }, { id: 'kk2', tag: 'K-0014', name: 'LED wash pack (8×)', items: 10, st: 'Reserved', job: '#2340' }, { id: 'kk3', tag: 'K-0009', name: 'Old strobe case', items: 4, st: 'Archived', job: '' }], subs: Object.keys(CAT_SUB) };
Object.entries(CAT_SUB).forEach(([id, [name, ms]]) => { REC.cat[id] = { id, name, parent: 'lighting', icon: '', desc: '', tags: '', sort: 1, xero: '', ttcls: 'Class I', ttmonths: 12, models: ms.map(([n, own, day, tt]) => ({ id: 'm-' + n.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: n, own, day, tt, ov: '' })), kits: [], subs: [] }; });
const catAll = c => [...c.models, ...c.subs.flatMap(s => REC.cat[s].models)];
const catAssets = (c, incl) => (incl ? catAll(c) : c.models).reduce((s, m) => s + m.own, 0);
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

const flat = d => d.sections.flatMap(s => (s.fields || []).flatMap(x => Array.isArray(x) ? x : [x]));
const fcount = d => flat(d).length;
const lab = (fdf, v) => typeof fdf.label === 'function' ? fdf.label(v) : fdf.label;
const cleanLabel = s => String(s).replace(/ \*$/, '').replace(/ \(.*\)$/, '').replace(/ · .*/, '').toLowerCase();
const labelOfSrc = (fdf, f, id) => { const it = (fdf.type === 'pick' ? fdf.src(f.v, f) : []).find(x => x.id === id); if (it) return it.label; if (fdf.k === 'parent') { const p = PLACES.find(x => x.id === id); return p ? p.label : ''; } return id || ''; };
const srcAll = (fdf, f) => { if (fdf.k === 'model') return fdf.src(); if (fdf.k === 'parent') return PLACES; return fdf.src(f.v, f); };
const pickLabel = (fdf, f) => { const v = f.v[fdf.k]; if (!v) return ''; const it = srcAll(fdf, f).find(x => x.id === v); return it ? it.label : v; };
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
  if (x.type === 'pick') { f.v[k] = id; if (f.def.onPick) f.def.onPick(f, k, it); drawForm(x.next || null); if (!x.next) { const nx = $('#f-' + k, body); } return; }
  if (x.type === 'multi') { f.v.assets.push(id); f.q[k] = ''; f.open[k] = true; f.hi[k] = 0; drawForm('f-' + k); return; }
  if (x.type === 'contents') { f.v.contents.push({ id: it.id, label: it.label, tg: it.tg, qty: 1, bulk: !!it.bulk }); f.q[k] = ''; f.open[k] = true; f.hi[k] = 0; drawForm('f-' + k); }
}

// ---------- commit
function diffLabels(f) { const o = f.orig, v = f.v, ch = []; flat(f.def).forEach(x => { if (['words', 'note'].includes(x.type) && x.type === 'note') return; if (JSON.stringify(o[x.k] ?? '') !== JSON.stringify(v[x.k] ?? '')) ch.push(x.k === 'contacts' ? 'contacts' : x.k === 'contents' ? 'contents' : x.k === 'disp' ? 'dispositions' : cleanLabel(lab(x, v))); }); return ch; }
function qrSvg(t) { let s = 0; for (const c of t) s = (s * 31 + c.charCodeAt(0)) % 2147483647 || 7; const R = () => (s = (s * 16807) % 2147483647) / 2147483647; const N = 25; let r = ''; const fin = (x, y) => (x < 7 && y < 7) || (x > N - 8 && y < 7) || (x < 7 && y > N - 8); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let on; if (fin(x, y)) { const ax = x > N - 8 ? x - (N - 7) : x, ay = y > N - 8 ? y - (N - 7) : y; on = ax === 0 || ax === 6 || ay === 0 || ay === 6 || (ax >= 2 && ax <= 4 && ay >= 2 && ay <= 4); } else on = R() > .52; if (on) r += `<rect x="${x}" y="${y}" width="1" height="1"/>`; } return `<svg viewBox="0 0 ${N} ${N}" width="150" height="150" shape-rendering="crispEdges" fill="#111">${r}</svg>`; }

// ---------- state, routing, shell
const TYPES = {
  loc: { label: 'Location', plural: 'Locations', list: 'locations', def: 'wa' },
  kit: { label: 'Kit', plural: 'Kits', list: 'kits', def: 'k42' },
  maint: { label: 'Maintenance job', plural: 'Maintenance', list: 'maintenance', def: 'm188' },
  tt: { label: 'Test & tag', plural: 'Test & tag', list: 'tt', def: 'tt402' },
  cat: { label: 'Category', plural: 'Categories', list: 'models', def: 'lighting' },
};
const TLAB = { overview: 'Overview', contents: 'Contents', bins: 'Bins', jobs: 'Jobs', history: 'History', files: 'Files', checks: 'Checks', assets: 'Assets', parts: 'Parts', tests: 'Tests', models: 'Models', kits: 'Kits', subcategories: 'Subcategories' };
const state = { type: 'loc', id: 'wa', tab: 'overview', sel: {}, filt: {}, n: {}, q: '', undo: null, lastSel: null, form: null, moreChecks: false, hist: 'all', histN: 8, composing: false, scanSeen: {} };
const cur = () => (REC[state.type] || {})[state.id];
function tabsOf(type, r) {
  if (type === 'loc') return r && r.bin !== undefined ? ['overview', 'contents', 'history', 'files'] : ['overview', 'contents', 'bins', 'jobs', 'history', 'files'];
  return { kit: ['overview', 'contents', 'checks', 'history', 'files'], maint: ['overview', 'assets', 'parts', 'history', 'files'], tt: ['overview', 'tests', 'history', 'files'], cat: ['overview', 'models', 'kits', 'subcategories'] }[type];
}
function tabCount(t, r) {
  const ty = state.type;
  switch (t) {
    case 'contents': return ty === 'loc' ? locPool(r).length : r.items.length;
    case 'bins': return locChildren().length;
    case 'jobs': return locJobs(r).length;
    case 'history': return r.events.length;
    case 'files': return r.files.length || '';
    case 'checks': return r.checks.length;
    case 'assets': return r.assets.length;
    case 'parts': return r.parts.length;
    case 'tests': return r.tests.length;
    case 'models': return r.models.length;
    case 'kits': return r.kits.length;
    case 'subcategories': return r.subs.length;
    default: return '';
  }
}
function snapshot() { const s = JSON.stringify({ R: REC, P: POOL, type: state.type, id: state.id, tab: state.tab }); return () => { const o = JSON.parse(s); REC = o.R; POOL = o.P; state.type = o.type; state.id = o.id; state.tab = o.tab; state.sel = {}; render(); writeHash(); }; }
function writeHash() { try { history.replaceState(null, '', '#' + state.type + '/' + state.id + (state.tab !== 'overview' ? '/' + state.tab : '')); } catch (e) { /* file:// previews may refuse */ } }
function readHash() { const m = /^#(\w+)\/([\w-]+)(?:\/(\w+))?/.exec(location.hash || ''); if (m && REC[m[1]]) { state.type = m[1]; state.id = m[2]; const r = cur(); state.tab = m[3] && r && tabsOf(m[1], r).includes(m[3]) ? m[3] : 'overview'; } }
function go(type, id, tab, keepFilt) { closeLayer(); state.type = type; state.id = id; state.tab = tab || 'overview'; state.sel = {}; state.q = ''; state.lastSel = null; state.histN = 8; state.composing = false; state.hist = 'all'; if (!keepFilt) state.filt = {}; state.n = {}; render(); writeHash(); const c = $('.content'); if (c) c.scrollTop = 0; }
const selKey = () => `${state.type}:${state.id}:${state.tab}`;
const selSet = () => (state.sel[selKey()] = state.sel[selKey()] || new Set());
const filt = (k, d) => state.filt[state.type + ':' + state.id + ':' + k] ?? d;
const setFilt = (k, v) => { state.filt[state.type + ':' + state.id + ':' + k] = v; state.n = {}; state.sel = {}; };
const locJobs = l => { const ids = l.bin !== undefined ? [] : ['#2341', '#2350', '#2338', '#2340', '#2314']; return ids.map(j => ({ id: j, n: POOL.filter(p => p.job === j).length })); };

// ---------- the sticky/primary + page menu per type
function primaryOf(r) { return state.type === 'maint' ? (r.status === 'COMPLETED' || r.status === 'CANCELLED' ? ['Edit', 'edit'] : ['Complete', 'complete']) : state.type === 'tt' ? ['Record test', 'recordtest'] : state.type === 'loc' || state.type === 'kit' ? ['Scan', 'scan'] : ['Edit', 'edit']; }
function statusOf(r) {
  switch (state.type) {
    case 'loc': { const n = locPool(r).length, p = Math.round(n / r.cap * 100); return dw(`${p}% full`, p >= 85 ? 'warn' : 'ok'); }
    case 'kit': { const k = kitStatus(r); return dw(k[0], k[1]); }
    case 'maint': { const [n, c] = MSTAT[r.status]; return dw(n, c); }
    case 'tt': { const [n, c] = ttState(r), nx = ttNext(r); return dw(n === 'Overdue' ? `${-until(nx)}d overdue` : n, c); }
    case 'cat': { const nr = r.models.filter(m => !m.day).length; return nr ? dw(`${plural(nr, 'model')} without rates`, 'warn') : dw('Rates set', 'ok'); }
  }
}
function kitStatus(k) { if (k.retired) return ['Retired', '']; if (k.maintOpen) return ['In maintenance', 'warn']; if (kitMissing(k).length) return ['Incomplete', 'warn']; if (k.job && until(k.job.to) >= 0) return ['Reserved', 'info']; return ['Available', 'ok']; }
function identOf(r) {
  switch (state.type) {
    case 'loc': { const p = r.parent ? REC.loc[r.parent] : null; return [`<span>${LOCT[r.type]}</span>`, r.address ? `<span>${esc(r.address)}</span>` : p ? `<a href="#" data-act="go" data-t="loc" data-id="${p.id}">Inside ${esc(p.name)}</a>` : '', r.bin === undefined ? `<span>${plural(locChildren().length, 'bin')}</span>` : ''].filter(Boolean); }
    case 'kit': return [`<span class="mono">${r.tag}</span>`, `<span>${esc(r.cat)}</span>`, `<a href="#" data-act="go" data-t="loc" data-id="${locId(r.bin)}">${esc(r.loc)} / ${esc(r.bin)}</a>`, `<span>${plural(kitCount(r), 'item')}</span>`];
    case 'maint': return [`<span>${MTYPE[r.type]}</span>`, `<span class="mono">${r.num}</span>`, `<a href="${U.asset}" class="mono">${r.assets[0].tag}</a>${r.assets.length > 1 ? ` <span class="muted">+${r.assets.length - 1}</span>` : ''}`, `<span>${esc(r.assets[0].model)}</span>`];
    case 'tt': return [`<span class="mono">${r.num}</span>`, `<span>${esc(r.cls)}</span>`];
    case 'cat': { const p = r.parent ? REC.cat[r.parent] : null; return [p ? `<a href="#" data-act="go" data-t="cat" data-id="${p.id}">Inside ${esc(p.name)}</a>` : '<span>Top level</span>', r.desc ? `<span>${esc(r.desc)}</span>` : ''].filter(Boolean); }
  }
}
const titleOf = r => state.type === 'tt' ? r.tag : state.type === 'kit' ? r.name : state.type === 'maint' ? r.title : r.name;
const thumbOf = r => state.type === 'loc' ? (r.bin !== undefined ? 'BN' : 'WH') : state.type === 'kit' ? 'KT' : state.type === 'maint' ? 'MT' : state.type === 'tt' ? 'TT' : (r.icon || r.name.slice(0, 2).toUpperCase());
const crumbOf = r => { const T = TYPES[state.type]; const mid = state.type === 'loc' && r.bin !== undefined ? `<a href="#" data-act="go" data-t="loc" data-id="wa" style="color:var(--muted)">Warehouse A</a><span>›</span>` : state.type === 'cat' && r.parent ? `<a href="#" data-act="go" data-t="cat" data-id="${r.parent}" style="color:var(--muted)">${esc(REC.cat[r.parent].name)}</a><span>›</span>` : ''; return `<a href="${GL(state.type === 'cat' ? 'models' : T.list)}" style="color:var(--muted)">Assets</a><span>›</span><a href="${GL(state.type === 'cat' ? 'models' : T.list)}" style="color:var(--muted)">${T.plural}</a><span>›</span>${mid}<b ${state.type === 'tt' || state.type === 'kit' ? 'class="mono"' : ''} style="font-weight:600">${esc(state.type === 'kit' ? r.tag : state.type === 'maint' ? r.num : state.type === 'tt' ? r.num : r.name)}</b>`; };

let chromeDone = false;
function chrome() {
  if (chromeDone) return; chromeDone = true;
  const nav = [['Dashboard', 'blue', AR + '3d6zqfosL5hYRvXLBYLnhR'], ['Jobs', 'blue', AR + 'A7SMPtpTr3aedUDEnuSaxd'], ['Finance', 'green', AR + '5VnYTVW2pdA5r1qBRvdrom'], ['Schedule', 'green', U.sched], ['Crew', 'purple', AR + 'LPdsNGb4CRMfS6qk7j7Fsa'], ['Assets', 'amber', GL('locations')], ['Warehouse', 'teal', AR + '6xqFcEZZk49w86p5pAsisA'], ['Test & tag', 'teal', GL('tt')], ['Maintenance', 'amber', GL('maintenance')]];
  $('#sidenav').innerHTML = nav.map(([n, c, h]) => `<a href="${h}" class="${n === 'Assets' ? 'on' : ''}"><span class="patch" style="background:var(--${c}-soft, var(--paper-2))"></span>${n}</a>`).join('');
  $('.phonehead').innerHTML = `<a class="btn btn-icon btn-lg" id="phoneback" href="${U.gear}" aria-label="Back to the list" style="color:var(--ink)">‹</a><div style="flex:1;min-width:0"><div class="ell" id="phonetitle" style="font-family:var(--display);font-weight:800;font-size:16px"></div><div class="ell t-micro muted" id="phonesub"></div></div><button class="btn btn-icon btn-lg" data-act="pagemenu" aria-label="Page actions">⋯</button>`;
}
function renderStrip() {
  $('#recsw').innerHTML = `<span class="lab">Record</span>` + Object.entries(TYPES).map(([k, t]) => `<button class="wd ${state.type === k ? 'on' : ''}" data-act="sw" data-t="${k}">${t.label}</button>`).join('');
}
function renderHead() {
  const r = cur(), cr = $('.topbar .crumb'), T = TYPES[state.type];
  if (!r) { cr.innerHTML = `<a href="${U.gear}" style="color:var(--muted)">Assets</a><span>›</span><b>Not found</b>`; $('#rhead').innerHTML = ''; $('#phonetitle').textContent = 'Not found'; $('#phonesub').textContent = ''; return; }
  document.title = `${titleOf(r)} · Gear records · RVLT Flow`;
  cr.innerHTML = crumbOf(r);
  const id = identOf(r), pe = primaryOf(r);
  $('#rhead').innerHTML = `<div class="who"><span class="thumb img">${esc(thumbOf(r))}</span><div style="min-width:0"><div class="ttl"><h1 class="h1 ${state.type === 'tt' ? 'mono' : ''}">${esc(titleOf(r))}</h1>${statusOf(r)}${flagsOf(r)}</div><div class="rid">${id.join('<span class="faint">·</span>')}</div></div></div><div class="acts"><button class="btn btn-primary" data-act="edit">Edit</button><button class="btn btn-icon" data-act="pagemenu" aria-label="More actions">⋯</button></div>`;
  $('#phonetitle').textContent = titleOf(r);
  $('#phonesub').innerHTML = statusOf(r).replace('class="dotw', 'style="font-size:11.5px" class="dotw') + ` <span class="faint">·</span> ${state.type === 'kit' ? r.tag : state.type === 'loc' ? plural(locPool(r).length, 'asset') : state.type === 'maint' ? esc(r.assets[0].tag) + ' · ' + esc(r.to || 'unassigned') : state.type === 'tt' ? esc(r.model) : plural(catAll(r).length, 'model')}`;
  $('#phoneback').href = GL(state.type === 'cat' ? 'models' : T.list);
  $('#phoneact').innerHTML = `<button class="btn btn-primary" data-act="${pe[1]}">${pe[1] === 'scan' ? ICON.scan + ' ' : ''}${pe[0]}</button>`;
}
function flagsOf(r) {
  return ''; // the status word carries it; the Overview check says the rest (no fact twice)
  if (state.type === 'tt') { const l = ttLast(r), d = ttNext(r) ? until(ttNext(r)) : 0; return !r.retired && l && ttOk(l) && d < 0 ? dw(`${-d}d overdue`, 'err') : ''; }
  if (state.type === 'kit') return kitMissing(r).length ? dw(plural(kitMissing(r).length, 'item') + ' missing', 'err') : '';
  if (state.type === 'loc') { const nb = POOL.filter(p => !p.bin).length; return r.bin === undefined && nb ? dw(`${nb} with no bin`, 'warn') : ''; }
  if (state.type === 'maint') { const o = r.parts.filter(p => p.st === 'ORDERED'); return o.length && r.status !== 'COMPLETED' ? dw(`parts ETA ${fmtD(o.map(p => p.eta).sort()[0])}`, 'warn') : ''; }
  return '';
}
function renderTabs() {
  const r = cur(); if (!r) { $('#tabs').innerHTML = ''; return; }
  $('#tabs').innerHTML = tabsOf(state.type, r).map(t => { const c = tabCount(t, r); return `<button class="${state.tab === t ? 'on' : ''}" data-act="tab" data-t="${t}">${TLAB[t]}${c !== '' && t !== 'overview' ? ` <span class="n">${c}</span>` : ''}</button>`; }).join('');
}
function renderView() {
  const r = cur(), v = $('#view');
  if (!r) { v.innerHTML = `<div class="empty2"><b>Record not found</b>It may have been deleted, or you don't have access to it. <a class="lnk" href="${U.gear}">Back to the lists</a></div>`; return; }
  if (!tabsOf(state.type, r).includes(state.tab)) state.tab = 'overview';
  const body = state.tab === 'overview' ? viewOverview(r) : viewTab(r);
  v.innerHTML = state.tab === 'overview' ? `<div class="ws one"><div class="col">${body}</div></div>` : `<div class="ws"><div class="col">${body}</div><aside class="rail2">${railHtml(r)}</aside></div>`;
}
function render() { chrome(); renderStrip(); renderHead(); renderTabs(); renderView(); renderBulk(); }
const railHtml = r => factsOf(r).map(f => `<div class="rs"><div class="ovl">${f.t}</div><div class="fx">${f.h}</div></div>`).join('');
function dlgShell(over, title, bd, ft, wide) { openDialog(`<div class="hd"><div class="t-overline">${over}</div><h2 style="font-size:18px">${title}</h2></div><div class="bd">${bd}</div><div class="ft">${ft}</div>`, d => { if (wide) d.classList.add('wide'); }); }
const okBtn = (act, label, danger) => `<div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn ${danger ? 'btn-secondary' : 'btn-primary'}" ${danger ? 'style="color:var(--t-out)"' : ''} data-act="${act}">${label}</button>`;
function commitWrite(fn, msg) { const undo = snapshot(); const m = fn(); closeLayer(); render(); writeHash(); toast(m || msg, undo); }
function logEv(r, text, job, kind) { if (!r.events) return; r.events.unshift({ at: `${TODAY} ${NOWT}`, who: ME, text, job: job || '', kind: kind || 'change' }); }

// ---------- facts (one definition each: the Overview shows them in three columns, the rail stacks them)
const pctOf = l => Math.round(locPool(l).length / l.cap * 100);
function factsOf(r) {
  switch (state.type) {
    case 'loc': {
      const P = locPool(r), n = P.length, out = P.filter(p => p.st === 'Deployed'), l = r.events[0];
      const jobs = [...new Set(out.map(p => p.job))];
      const place = r.address ? `<div>${esc(r.address)}</div><div><a class="lnk" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.address)}" target="_blank" rel="noopener">Open in Maps ${ICON.ext}</a></div>` : r.parent ? `<div>Inside <a href="#" data-act="go" data-t="loc" data-id="wa">Warehouse A</a></div><div class="m">14 Industry Rd, Marrickville NSW</div>` : '<div class="faint">No address set</div>';
      return [{ t: 'Now', h: `<div><span class="mono">${n}</span> <span class="m">of</span> <span class="mono">${r.cap}</span> <span class="m">· ${pctOf(r)}% full</span></div><div class="m">${n - out.length} in the building · ${out.length ? `${out.length} out on ${jobs.map(j => `<span class="mono">${j}</span>`).join(', ')}` : 'none out'}</div>` }, { t: 'Last movement', h: l ? `<div class="mono">${atStr(l.at)}</div><div class="m">${esc(l.who)}</div><div class="m">${esc(l.text)}</div>` : '<div class="faint">No movement on record</div>' }, { t: 'Place', h: place }];
    }
    case 'kit': {
      const j = r.job, lc = r.lastCheck;
      return [{ t: 'Now', h: `${j && until(j.to) >= 0 ? `<div>Reserved on ${jobLink(j.id)}</div><div class="m">${rng(j.from, j.to)} · truck ${sd(j.truck.slice(0, 10))} <span class="mono">${j.truck.slice(11)}</span></div>` : '<div>Not on a job</div>'}` }, { t: 'Last check', h: lc ? `<div class="mono">${atStr(lc.at)}</div><div class="m">${esc(lc.who)} · ${esc(lc.ctx)}</div><div class="m"><span class="mono">${kitPresent(r)}</span> of <span class="mono">${kitCount(r)}</span> present${r.mode === 'PER_ITEM' ? ' · each item checked' : ''}</div>` : '<div class="faint">Not checked</div>' }, { t: 'Value', h: `<div><span class="mono">${money(r.repl)}</span> <span class="m">replacement</span></div>${r.price != null ? `<div><span class="mono">${money(r.price)}</span> <span class="m">paid ${MON[+r.pdate.slice(5, 7) - 1]} ${r.pdate.slice(0, 4)}</span></div>` : ''}` }];
    }
    case 'maint': {
      const a = r.assets[0], P = POOL.find(x => x.tag === a.tag), since = until(r.sched);
      return [{ t: 'Now', h: r.status === 'COMPLETED' ? `<div>Took ${Math.max(1, dayNum(r.done) - dayNum(r.sched))} days</div><div class="m">${rng(r.sched, r.done)}</div>` : `<div><a href="${U.asset}" class="mono">${a.tag}</a> is ${P ? 'in ' + esc(P.bin || 'Warehouse A') : 'in the workshop'}</div><div class="m">Out of service ${-since}d · since ${fmtD(r.sched)}</div>${r.retest ? `<div class="m">Retest booked ${fmtD(r.retest)}</div>` : ''}` }, { t: 'Cost', h: `<div><span class="mono">${money(mCost(r))}</span> <span class="m">${r.status === 'COMPLETED' ? 'total' : 'estimate'}</span></div><div class="m">Parts <span class="mono">${money(partsTotal(r))}</span> · labour <span class="mono">${money(r.labour)}</span></div>` }, { t: 'People', h: `<div>${r.to ? esc(r.to) : '<span class="faint">Unassigned</span>'} <span class="m">assigned</span></div><div class="m">Reported by ${esc(r.by)} · ${fmtD(r.sched)}</div>${r.done ? `<div class="m">Completed ${fmtD(r.done)}</div>` : ''}` }];
    }
    case 'tt': {
      const l = ttLast(r), nx = ttNext(r), d = nx ? until(nx) : null, [sn, sc] = ttState(r);
      return [{ t: 'Next due', h: nx ? `<div>${fmtL(nx)}</div><div class="m">${d < 0 ? `<span style="color:var(--t-out)">${-d}d overdue</span>` : d === 0 ? 'Due today' : `in ${d} days`} · ${r.months} months after the last test</div>` : '<div class="faint">Not tested yet</div>' }, { t: 'Last test', h: l ? `<div class="mono">${fmtL(l.at)}</div><div class="m">${esc(l.who)} · ${ttOk(l) ? 'pass' : 'fail'}</div><div class="m"><span class="mono">${l.earth} Ω · ${l.ins >= 299 ? '>299' : l.ins} MΩ · ${l.leak} mA</span></div>` : '<div class="faint">None</div>' }, { t: 'Asset', h: `<div><a href="${U.asset}" class="mono">${r.tag}</a> <span class="m">${esc(r.model)}</span></div><div class="m">${esc(r.loc)}</div>` }];
    }
    case 'cat': {
      const own = catAssets(r, true), nm = catAll(r).length, tt = catAll(r).filter(m => m.tt).length;
      return [{ t: 'Stock', h: `<div><span class="mono">${nm}</span> models · <span class="mono">${own}</span> assets</div><div class="m">${r.models.length} directly here · ${plural(r.subs.length, 'subcategory', 'subcategories')}</div>` }, { t: 'Test & tag profile', h: r.ttcls ? `<div>${esc(r.ttcls)} · every <span class="mono">${r.ttmonths}</span> months</div><div class="m">Applies to ${tt} of ${nm} models${catAll(r).some(m => m.ov) ? ' · one overrides it' : ''}</div><div class="m">Visual · earth · insulation · leakage</div>` : '<div class="faint">No profile · models set their own</div>' }, { t: 'Rates', h: (() => { const nr = catAll(r).filter(m => !m.day).length; return nr ? `<div style="color:var(--warn)">${plural(nr, 'model')} without a day rate</div><div class="m">They cannot be quoted</div>` : '<div>Every model has a day rate</div>'; })() }];
    }
  }
}
function identRows(r) {
  const mono = v => `<span class="mono">${esc(v)}</span>`, mu = v => `<span class="muted">${esc(v)}</span>`;
  switch (state.type) {
    case 'loc': return [['Inside', r.parent ? `<a href="#" data-act="go" data-t="loc" data-id="${r.parent}">${esc(REC.loc[r.parent].name)}</a>` : 'Top level'], ['Default', r.isDefault ? 'New assets start here' : ''], ['Tags', r.tags && mu(r.tags)], ['Notes', r.notes && esc(r.notes)]].filter(x => x[1]);
    case 'kit': return [['Case', `${esc(r.caseType)} <span class="muted">· ${esc(r.dims)} · ${r.weight} kg</span>`], ['Check mode', r.mode === 'PER_ITEM' ? 'Check each item <span class="muted">· ticked off on the way out and back</span>' : 'One check for the case'], ['Purchased', r.pdate && fmtL(r.pdate)], ['Xero code', r.xero && mono(r.xero)], ['Tags', r.tags && mu(r.tags)], ['Description', r.desc && esc(r.desc)]].filter(x => x[1]);
    case 'maint': return [['Description', r.desc && esc(r.desc)], ['Tags', r.tags && mu(r.tags)]].filter(x => x[1]);
    case 'tt': return [['Appliance', esc(r.appliance)], ['Make', esc(r.make)], ['Serial', r.serial && mono(r.serial)], ['Interval', `${r.months} months <span class="muted">· from the model</span>`], ['Notes', r.notes && esc(r.notes)]].filter(x => x[1]);
    case 'cat': return [['Icon', r.icon && mono(r.icon)], ['Tags', r.tags && mu(r.tags)], ['Xero account', r.xero ? mono(r.xero) : mu('Inherits the org default')], ['Sort order', mono(r.sort)]].filter(x => x[1]);
  }
}

// ---------- health: derived, never stored. A check that cannot run says "not checked".
function health(r) {
  const out = [], ty = state.type; if (ty === 'kit' && r.retired) return out;
  if (ty === 'loc') {
    const kids = locChildren(), isBin = r.bin !== undefined, nb = isBin ? 0 : POOL.filter(p => !p.bin).length;
    if (nb) out.push({ sev: 'warn', title: plural(nb, 'asset') + ' with no bin', detail: POOL.filter(p => !p.bin).map(p => p.tag).join(', '), act: ['Assign bins', 'nobin'] });
    const kits = locPool(r).filter(p => p.kind === 'K' && p.st === 'Incomplete'); if (kits.length) out.push({ sev: 'warn', title: plural(kits.length, 'kit') + ' incomplete', detail: kits.map(k => k.tag).join(', '), act: ['Open', 'kitsinc'] });
    const un = isBin ? (r.printed ? [] : [r]) : kids.filter(k => !k.printed); if (un.length) out.push({ sev: 'warn', title: isBin ? 'No bin label printed' : `${plural(un.length, 'bin')} with no printed label`, detail: un.map(u => u.name).join(', '), act: ['Print labels', 'printlabels'] });
    (isBin ? [r] : kids).filter(k => pctOf(k) >= 85).forEach(k => out.push({ sev: 'warn', title: `${k.name} is ${pctOf(k)}% full`, detail: `${k.cap - locPool(k).length} spaces left`, act: isBin ? ['Move contents', 'movecontents'] : ['Open bins', 'tab', 'data-t="bins"'] }));
    out.push({ sev: 'unknown', title: 'Stocktake not checked', detail: 'No count on record for this location.', act: ['Start a count', 'count'] });
    if (![...(isBin ? [r] : kids)].some(k => pctOf(k) > 100)) out.push({ sev: 'pass', title: 'No bin over capacity' }); if (r.address || r.parent) out.push({ sev: 'pass', title: 'Address set' });
  }
  if (ty === 'kit') {
    const m = kitMissing(r), j = r.job, soon = j && until(j.from) <= 3 && until(j.to) >= 0;
    if (m.length) out.push({ sev: soon ? 'block' : 'warn', title: `${plural(m.length, 'item')} missing: ${m.map(i => i.name).join(', ')}`, detail: soon ? `needed for ${j.id}, truck ${sd(j.truck.slice(0, 10))} ${j.truck.slice(11)}` : 'since the last check', act: ['Find or replace', 'findmissing'] });
    r.items.filter(i => i.cond === 'Fair' && i.present).forEach(i => out.push({ sev: 'warn', title: `${i.tag} is in fair condition`, detail: 'battery door loose since #2288', act: ['Book repair', 'repairitem', `data-id="${i.id}"`] }));
    if (r.maintOpen) out.push({ sev: 'warn', title: 'In maintenance', detail: 'hidden from availability until it is back' });
    if (!r.lastCheck) out.push({ sev: 'unknown', title: 'Condition not checked', detail: 'No prep or return check on record.', act: ['Open', 'tab', 'data-t="checks"'] });
    else out.push({ sev: 'pass', title: `Condition ${r.cond.toLowerCase()}` });
    out.push({ sev: 'pass', title: 'Test & tag current on ULXD-01' }); out.push({ sev: 'pass', title: 'No double bookings' });
  }
  if (ty === 'maint') {
    const done = r.status === 'COMPLETED' || r.status === 'CANCELLED';
    if (!done) {
      const ord = r.parts.filter(p => p.st === 'ORDERED'); if (ord.length) out.push({ sev: 'warn', title: `Parts on order · ETA ${fmtD(ord.map(p => p.eta).sort()[0])}`, detail: ord.map(p => p.name).join(' · '), act: ['Mark arrived', 'partsarrived'] });
      out.push({ sev: 'warn', title: `${r.assets.map(a => a.tag).join(', ')} stays out of service until this is completed`, detail: 'hidden from availability and every picker', act: ['Complete', 'complete'] });
      if (!r.to) out.push({ sev: 'warn', title: 'Nobody assigned', act: ['Assign', 'edit'] });
      if (r.sched < TODAY && !r.parts.some(p => p.st === 'ORDERED')) out.push({ sev: 'warn', title: `Scheduled date ${fmtD(r.sched)} has passed`, act: ['Edit', 'edit'] });
    }
  }
  if (ty === 'tt') {
    const l = ttLast(r), nx = ttNext(r);
    if (r.retired) return out;
    if (!l) out.push({ sev: 'unknown', title: 'Test & tag not checked', detail: 'No test on record.', act: ['Record test', 'recordtest'] });
    else if (!ttOk(l)) out.push({ sev: 'block', title: `Failed ${fmtD(l.at)} — keep out of service`, detail: l.note || 'a reading is over its limit', act: ['Record retest', 'recordtest'] });
    else { const d = until(nx); if (d < 0) { out.push({ sev: 'block', title: `${-d}d overdue — out of service until tested`, detail: `was due ${fmtD(nx)} · last passed ${fmtL(l.at)}`, act: ['Record test', 'recordtest'] }); if (!r.booked) out.push({ sev: 'warn', title: 'No test booked', detail: 'no maintenance job for it yet', act: ['Book a test', 'booktest'] }); else out.push({ sev: 'pass', title: `Test booked ${fmtD(r.booked)}` }); } else if (d <= 30) out.push({ sev: 'warn', title: `Due in ${d} days`, detail: `was passed ${fmtL(l.at)}`, act: ['Record test', 'recordtest'] }); else out.push({ sev: 'pass', title: `Next due ${fmtL(nx)}` }); }
    if (l && ttOk(l)) out.push({ sev: 'pass', title: 'Last test passed', detail: 'all readings within limits' });
  }
  if (ty === 'cat') {
    const nr = catAll(r).filter(m => !m.day); if (nr.length) out.push({ sev: 'warn', title: `${plural(nr.length, 'model')} without a day rate`, detail: nr.map(m => m.name).join(', '), act: ['Set rates', 'norate'] });
    if (r.ttcls) out.push({ sev: 'pass', title: 'Test & tag profile set' }); else out.push({ sev: 'unknown', title: 'Test & tag profile not checked', detail: 'Models set their own.', act: ['Edit', 'edit'] });
    out.push({ sev: 'pass', title: r.xero ? `Xero account ${r.xero}` : 'Xero account inherits the org default' });
  }
  const o = { block: 0, unknown: 1, warn: 2, pass: 3 }; return out.sort((x, y) => o[x.sev] - o[y.sev]);
}
const VOC = { loc: ['Needs attention', 'Nearly tidy', 'All tidy'], kit: ["Can't go out", 'Nearly ready', 'Ready to go'], tt: ["Can't go out", 'Nearly current', 'Current'], cat: ['Needs attention', 'Nearly set up', 'Set up'], maint: ['', '', ''] };
function summary(hs, r) {
  const n = s => hs.filter(c => c.sev === s).length, clear = n('pass'), lead = `${clear} of ${hs.length} checks clear`, ty = state.type;
  if (ty === 'maint') { const m = { SCHEDULED: 'Booked', AWAITING_PARTS: 'Waiting on parts', IN_PROGRESS: 'Work under way', QA: 'In QA', COMPLETED: 'Completed', CANCELLED: 'Cancelled' }[r.status]; return [m, r.status === 'COMPLETED' ? `${RESN[r.result || 'PASS'][0]} · closed ${fmtD(r.done)}` : `Open ${until(TODAY) - until(r.sched)} days · ${plural(r.parts.filter(p => p.st === 'ORDERED').length, 'part')} on order`, '']; }
  if ((ty === 'tt' || ty === 'kit') && r.retired) return ['Retired', 'Hidden from the register and every picker. The record and certificates are kept.', ''];
  const v = VOC[ty]; return n('block') ? [v[0], lead, 'color:var(--t-out)'] : (n('warn') || n('unknown')) ? [v[1], lead, ''] : [v[2], lead, ''];
}
function viewOverview(r) {
  const hs = health(r), [head, lead, st] = summary(hs, r), todo = hs.filter(c => c.sev !== 'pass'), clear = hs.filter(c => c.sev === 'pass'), shown = state.moreChecks ? todo : todo.slice(0, 4);
  const row = c => `<li ${c.act ? `data-act="${c.act[1]}" ${c.act[2] || ''}` : ''}><span class="dot ${c.sev === 'block' ? 'bad' : c.sev === 'unknown' ? 'unk' : ''}"></span><div class="grow">${esc(c.title)}${c.detail ? ` <span class="muted">· ${esc(c.detail)}</span>` : ''}</div>${c.act ? `<span class="go">${c.act[0]} ›</span>` : ''}</li>`;
  const done = state.type === 'maint' && (r.status === 'COMPLETED' || r.status === 'CANCELLED'), ret = (state.type === 'tt' || state.type === 'kit') && r.retired;
  const ready = `<section class="sec2" id="ready"><h2 style="${st}">${head}</h2><p class="lead">${esc(lead)}</p>${ret ? `<div class="links" style="margin-top:12px"><button class="lnk" data-act="reinstate">Reinstate ${esc(r.tag)}</button></div>` : done ? `<div style="margin-top:12px"><button class="lnk" data-act="reopen">Reopen this job</button></div>` : `<ul class="todo">${shown.map(row).join('')}</ul>${todo.length > 4 ? `<button class="lnk muted" style="margin-top:10px" data-act="morechecks">${state.moreChecks ? 'Show fewer' : `and ${todo.length - 4} more`} ›</button>` : ''}<div class="clear">${clear.length ? `${clear.length} ${todo.length ? 'checks clear' : 'checks'} · ${clear.map(c => esc(c.title)).join(' · ')}` : ''}</div>`}</section>`;
  const f = factsOf(r), facts = `<section class="sec2 facts3">${f.map(x => `<div><div class="ovl">${x.t}</div><div class="fx">${x.h}</div></div>`).join('')}</section>`;
  const D = identRows(r), ident = `<section class="sec2"><div class="shead"><span class="t">${state.type === 'cat' ? 'Details' : 'Identity'}</span></div><div class="dl">${D.map(([k, v]) => `<div><span class="k">${k}</span><span class="v">${v}</span></div>`).join('')}</div></section>`;
  return ready + (done ? outcomeSection(r) : '') + facts + ident + extraSections(r);
}
function outcomeSection(r) {
  if (r.status === 'CANCELLED') return `<section class="sec2"><div class="shead"><span class="t">Outcome</span></div><div class="ln muted">Cancelled · no work was done and the gear was not touched.</div></section>`;
  const [rn, rc] = RESN[r.result || 'PASS'];
  return `<section class="sec2"><div class="shead"><span class="t">Outcome</span></div><div class="dl"><div><span class="k">Result</span><span class="v">${dw(rn, rc)}</span></div>${r.assets.map(a => `<div><span class="k">${a.tag}</span><span class="v">${DISP[(r.disp || {})[a.tag] || 'RETURN_TO_SERVICE']} <span class="muted">· <a href="${U.asset}">open asset</a></span></span></div>`).join('')}<div><span class="k">Next due</span><span class="v">${r.next ? fmtL(r.next) : '<span class="muted">Not set</span>'}</span></div><div><span class="k">Completed</span><span class="v">${fmtL(r.done)} <span class="muted">· ${esc(r.to || ME)}</span></span></div></div></section>`;
}
function extraSections(r) { return ''; }

// ---------- list tabs: one engine, five records' worth of configs
const qf = (rows, fn) => { const q = state.q.trim().toLowerCase(); return q ? rows.filter(x => fn(x).toLowerCase().includes(q)) : rows; };
const wc = (rows, fn) => rows.filter(fn).length;
function listHtml(cfg) {
  const all = cfg.rows, n = state.n[cfg.key] || 25, shown = all.slice(0, n), set = selSet(), allSel = shown.length && shown.every(x => set.has(cfg.rid(x)));
  const words = (cfg.words || []).map(([k, l, c]) => `<button class="wd ${cfg.fv === k ? 'on' : ''}" data-act="lf" data-k="${cfg.fk}" data-v="${k}">${l}${c != null ? ` <span class="faint mono" style="font-size:11.5px">${c}</span>` : ''}</button>`).join('');
  const bar = `<div class="words">${cfg.search ? `<div class="search"><span class="muted">⌕</span><input id="q" value="${esc(state.q)}" placeholder="${esc(cfg.search)}" aria-label="${esc(cfg.search)}" autocomplete="off"></div>` : ''}<div class="wsc">${words}${cfg.extra || ''}<span class="sp"></span>${cfg.extra2 || ''}${cfg.add ? `<button class="lnk" data-act="${cfg.add[1]}">${cfg.add[0]}</button>` : ''}</div></div>`;
  const rows = shown.map(x => {
    const d = cfg.render(x), id = cfg.rid(x), sel = set.has(id);
    const t = d.go ? `<a class="ttl" href="#" data-act="go" data-t="${d.go[0]}" data-id="${d.go[1]}">${d.title}</a>` : d.href ? `<a class="ttl" href="${d.href}">${d.title}</a>` : `<div class="ttl">${d.title}</div>`;
    return `<div class="rrow ${sel ? 'sel' : ''}"><button class="cb ${sel ? 'on' : ''}" data-act="rsel" data-id="${esc(id)}" aria-label="Select ${esc(id)}"></button>${d.idc ? `<span class="id" style="${d.idw ? 'width:' + d.idw + 'px' : ''}">${d.idc}</span>` : ''}<div class="grow">${t}<div class="meta">${d.idc ? `<span class="pid">${d.idc}</span>` : ''}${d.meta || ''}</div></div><div class="rt">${d.rt || ''}<button class="dots" data-act="rowmenu" data-id="${esc(id)}" aria-label="Actions for ${esc(id)}">${ICON.dots}</button></div></div>`;
  }).join('');
  const hd = all.length ? `<div class="rrow" style="min-height:34px;padding:6px 0;border-top:0"><button class="cb ${allSel ? 'on' : ''}" data-act="rselall" aria-label="Select all"></button><span class="muted" style="font-size:12px">${set.size ? `${set.size} selected` : 'Select all'}</span></div>` : '';
  const left = all.length - shown.length;
  const empty = !all.length ? `<div class="empty2"><b>${cfg.filtered || state.q ? 'Nothing matches' : cfg.empty[0]}</b>${cfg.filtered || state.q ? `Try another word, or <button class="lnk" data-act="clearf">clear the filters</button>.` : cfg.empty[1]}</div>` : '';
  return `${cfg.pre || ''}${bar}${hd}${rows}${empty}${left > 0 ? `<button class="more" data-act="more" data-k="${cfg.key}">Show ${Math.min(25, left)} more · ${left} left</button>` : ''}<div class="foot1"><span>${cfg.foot(all)}</span>${cfg.footR || ''}</div>${cfg.post || ''}`;
}
const poolLink = p => p.kind === 'S' ? U.asset : '';
function tabCfg(r) {
  const ty = state.type, tb = state.tab;
  if (ty === 'loc' && tb === 'contents') {
    const isBin = r.bin !== undefined, P = locPool(r), fk = 'k', fv = filt(fk, 'all'), bf = filt('bin', ''), nb = P.filter(p => !p.bin).length;
    let rows = P.filter(p => fv === 'all' || (fv === 'nobin' ? !p.bin : p.kind === fv)); if (bf) rows = rows.filter(p => (p.bin || 'No bin') === bf); rows = qf(rows, p => p.tag + ' ' + p.name + ' ' + p.cs + ' ' + p.bin);
    return { key: 'contents', rows, rid: p => p.tag, fk, fv, search: 'Search tag, model or case', filtered: fv !== 'all' || bf, empty: ['Nothing stored here yet', 'Scan an asset to put it away here.'],
      words: [['all', 'All', P.length], ['S', 'Serialised', wc(P, p => p.kind === 'S')], ['B', 'Bulk', wc(P, p => p.kind === 'B')], ['K', 'Kits', wc(P, p => p.kind === 'K')], ['C', 'Cases', wc(P, p => p.kind === 'C')], ...(isBin ? [] : [['nobin', 'No bin', nb]])],
      extra: isBin ? '' : `<button class="fw ${bf ? 'on' : ''}" data-act="binf">${bf ? 'Bin: ' + esc(bf) + ' ✕' : 'Bin ▾'}</button>`,
      render: p => { const holds = p.kind === 'C' ? POOL.filter(x => x.cs === p.tag).length : 0; return { idc: esc(p.tag), idw: 76, title: esc(p.name) + (p.fl ? ` <span class="dotw ${p.fl.includes('T&T') ? 'err' : 'warn'}" style="font-size:11.5px;margin-left:8px">${esc(p.fl)}</span>` : ''), href: p.kind === 'S' ? U.asset : '', go: p.tag === 'K-0042' ? ['kit', 'k42'] : null, meta: `<span>${KINDN[p.kind]}${p.kind === 'B' ? ` · ${p.qty} in stock` : ''}${holds ? ` · holds ${holds}` : ''}</span>${isBin ? '' : `<span class="when">${p.bin ? 'Bin ' + esc(p.bin) : '<span style="color:var(--warn)">No bin</span>'}</span>`}${p.cs ? `<span class="when">in ${esc(p.cs)}</span>` : ''}${p.job ? `<span class="when">${esc(p.job)}</span>` : ''}`, rt: poolStatus(p) }; },
      menu: p => [...(p.kind === 'S' ? [{ label: `Open ${p.tag}`, href: U.asset, small: 'Asset' }] : p.tag === 'K-0042' ? [{ label: 'Open K-0042', act: 'go', args: 'data-t="kit" data-id="k42"' }] : p.kind === 'K' ? [{ label: `Open ${p.tag}`, href: GL('kits'), small: 'Kits' }] : []), { label: p.kind === 'C' ? 'Move case and contents…' : 'Move to a bin…', act: 'rowdo', args: `data-v="move" data-id="${p.tag}"` }, { label: 'Print label…', act: 'rowdo', args: `data-v="label" data-id="${p.tag}"` }],
      bulk: n => [{ v: 'move', l: `Move ${n} to…` }, { v: 'label', l: `Print ${plural(n, 'label')}` }],
      ask: { move: rows => pickDlg('Move', `Move ${rows.length === 1 ? rows[0].tag : rows.length + ' items'} to`, 'Bin', `<option value="">No bin</option>` + BINS.map(b => `<option>${b[0]}</option>`).join(''), 'bulkgo', 'move', rows.some(x => x.kind === 'C') ? 'Cases take everything inside them along.' : 'Stays in ' + r.name + '.') },
      run: (v, rows, arg) => { if (v === 'label') return `${plural(rows.length, 'label')} sent to the label printer`; const tags = new Set(rows.map(x => x.tag)); let extra = 0; POOL.forEach(p => { if (tags.has(p.tag)) p.bin = arg || ''; else if (p.cs && tags.has(p.cs) && !tags.has(p.tag)) { p.bin = arg || ''; extra++; } }); logEv(r, `moved ${plural(rows.length, 'asset')} to ${arg || 'no bin'}`); return `${plural(rows.length, 'item')} moved to ${arg || 'no bin'}${extra ? ` · ${extra} inside cases went with them` : ''}`; },
      foot: all => `${all.length} of ${P.length} · stored here, newest bin first`, footR: `<button class="lnk muted" data-act="count">Start a count ›</button>` };
  }
  if (ty === 'loc' && tb === 'bins') {
    const K = locChildren(), fk = 'k', fv = filt(fk, 'all'); let rows = K.filter(k => fv === 'all' || (fv === 'full' ? pctOf(k) >= 85 : !k.printed)); rows = qf(rows, k => k.name);
    return { key: 'bins', rows, rid: k => k.id, fk, fv, search: 'Search bins', filtered: fv !== 'all', empty: ['No bins yet', 'Bins are locations inside this one. Add A1, B2…'], add: ['+ Add bin…', 'addbin'],
      words: [['all', 'All', K.length], ['full', 'Nearly full', wc(K, k => pctOf(k) >= 85)], ['nolabel', 'No label', wc(K, k => !k.printed)]],
      render: k => { const n = locPool(k).length, p = pctOf(k), l = k.events[0]; return { title: esc(k.name), go: ['loc', k.id], meta: `<span class="mono">${n} / ${k.cap}</span><span class="when">${l ? 'last move ' + atStr(l.at) : 'no movement'}</span>`, rt: `<span class="mono when" style="min-width:40px;text-align:right">${p}%</span>${k.printed ? '' : dw('no label', 'warn')}` }; },
      menu: k => [{ label: 'Open bin', act: 'go', args: `data-t="loc" data-id="${k.id}"` }, { label: 'Print label…', act: 'rowdo', args: `data-v="label" data-id="${k.id}"` }, { label: 'Move contents…', act: 'rowdo', args: `data-v="mc" data-id="${k.id}"` }, '-', { label: 'Delete bin…', act: 'rowdo', args: `data-v="del" data-id="${k.id}"`, danger: true }],
      bulk: n => [{ v: 'label', l: `Print ${plural(n, 'label')}` }, { v: 'mc', l: `Move contents of ${n}…` }, { v: 'del', l: `Delete ${plural(n, 'bin')}`, d: 1 }],
      ask: { mc: rows => pickDlg('Move contents', `Move everything out of ${rows.length === 1 ? rows[0].name : rows.length + ' bins'}`, 'Into', `<option value="">No bin</option>` + BINS.filter(b => !rows.some(k => k.name === b[0])).map(b => `<option>${b[0]}</option>`).join(''), 'bulkgo', 'mc', 'Cases take what is inside them along. Bins stay.'), del: rows => { const n = rows.reduce((s, k) => s + locPool(k).length, 0); dlgShell('Delete', `Delete ${rows.length === 1 ? rows[0].name : rows.length + ' bins'}?`, `<div class="t-small" style="line-height:1.55"><div>The bin goes; what was in it stays in Warehouse A. Downstream:</div><ul style="margin:10px 0 0;padding-left:18px;display:grid;gap:6px;color:var(--ink-2)"><li>${plural(n, 'asset')} lose their bin and show under <b>No bin</b> · pick lists show them as "Warehouse A"</li><li>Printed bin labels for ${rows.map(k => k.name).join(', ')} stop resolving</li><li>Movement history is kept</li></ul></div>`, okBtn('bulkgo', `Delete ${rows.length === 1 ? rows[0].name : rows.length + ' bins'}`, true).replace('data-act="bulkgo"', 'data-act="bulkgo" data-v="del"')); } },
      run: (v, rows, arg) => { if (v === 'label') { rows.forEach(k => { k.printed = true; }); return `${plural(rows.length, 'bin label')} sent to the label printer`; } const ids = new Set(rows.map(k => k.name)); if (v === 'mc') { let n = 0; POOL.forEach(p => { if (ids.has(p.bin)) { p.bin = arg || ''; n++; } }); logEv(REC.loc.wa, `moved the contents of ${[...ids].join(', ')} to ${arg || 'no bin'}`); return `${plural(n, 'asset')} moved to ${arg || 'no bin'}`; } let n = 0; POOL.forEach(p => { if (ids.has(p.bin)) { p.bin = ''; n++; } }); rows.forEach(k => delete REC.loc[k.id]); logEv(REC.loc.wa, `deleted ${[...ids].join(', ')}`); return `${plural(rows.length, 'bin')} deleted${n ? ` · ${n} assets now have no bin` : ''}`; },
      foot: all => `${all.length} bins · ${locPool(r).filter(p => p.bin).length} assets in a bin · ${POOL.filter(p => !p.bin).length} without` };
  }
  if (ty === 'loc' && tb === 'jobs') {
    const rows = qf(locJobs(r), j => j.id + JOBS[j.id].name);
    return { key: 'jobs', rows, rid: j => j.id, search: 'Search jobs', empty: ['No jobs use this place', 'A job lists a place when gear loads out of it.'],
      render: j => { const J = JOBS[j.id]; return { idc: j.id, idw: 56, title: esc(J.name), href: U.ov, meta: `<span>${rng(J.from, J.to)}</span><span>${j.n ? plural(j.n, 'asset') + ' from here' : 'nothing reserved yet'}</span>${j.id === '#2350' ? '<span style="color:var(--warn)">clashes with #2341</span>' : ''}`, rt: dw(J.st[0], J.st[1]) }; },
      menu: j => [{ label: 'Open job', href: U.ov, small: 'Overview' }, { label: 'Warehouse page', href: U.wh, small: 'Warehouse' }],
      bulk: n => [{ v: 'pick', l: `Print ${plural(n, 'pick list')}` }], run: (v, rows) => `${plural(rows.length, 'pick list')} sent to the printer`, foot: all => `${all.length} jobs load out of ${r.name}` };
  }
  if (ty === 'kit' && tb === 'contents') {
    const fk = 'k', fv = filt(fk, 'all'); let rows = r.items.filter(i => fv === 'all' || (fv === 'missing' ? !i.present : fv === 'bulk' ? i.bulk : !i.bulk)); rows = qf(rows, i => i.tag + i.name + i.serial);
    return { key: 'kc', rows, rid: i => i.id, fk, fv, search: 'Search tag, model or serial', filtered: fv !== 'all', empty: ['Nothing in this kit', 'Add the tracked assets and bulk stock it carries.'], add: ['+ Add item…', 'additem'],
      words: [['all', 'All', r.items.length], ['missing', 'Missing', kitMissing(r).length], ['serial', 'Serialised', wc(r.items, i => !i.bulk)], ['bulk', 'Bulk', wc(r.items, i => i.bulk)]],
      render: i => ({ idc: esc(i.tag), idw: 72, title: esc(i.name) + (i.cond === 'Fair' ? ` <span class="dotw warn" style="font-size:11.5px;margin-left:8px">fair</span>` : ''), href: i.bulk ? '' : U.asset, meta: `${i.serial ? `<span class="mono">${esc(i.serial)}</span>` : '<span>Bulk · counted</span>'}<span class="mono">×${i.qty}</span><span class="when">${esc(i.pos)}</span>`, rt: i.present ? dw('Present', 'ok') : dw('Missing', 'err') }),
      menu: i => [...(i.bulk ? [] : [{ label: `Open ${i.tag}`, href: U.asset, small: 'Asset' }]), i.present ? { label: 'Mark missing', act: 'rowdo', args: `data-v="miss" data-id="${i.id}"` } : { label: 'Mark present', act: 'rowdo', args: `data-v="pres" data-id="${i.id}"` }, ...(i.present ? [] : [{ label: 'Book a repair or replacement…', act: 'findmissing' }]), '-', { label: 'Remove from kit', act: 'rowdo', args: `data-v="rm" data-id="${i.id}"`, danger: true }],
      bulk: n => [{ v: 'pres', l: `Mark present ${n}` }, { v: 'miss', l: `Mark missing ${n}` }, { v: 'rm', l: `Remove ${n} from kit`, d: 1 }],
      run: (v, rows) => { const ids = new Set(rows.map(i => i.id)); if (v === 'rm') { r.items = r.items.filter(i => !ids.has(i.id)); logEv(r, `removed ${rows.map(i => i.tag).join(', ')} from the kit`); return `${plural(rows.length, 'item')} removed from ${r.tag}`; } r.items.forEach(i => { if (ids.has(i.id)) i.present = v === 'pres'; }); logEv(r, `marked ${rows.map(i => i.tag).join(', ')} ${v === 'pres' ? 'present' : 'missing'}`); return `${plural(rows.length, 'item')} marked ${v === 'pres' ? 'present' : 'missing'}${v === 'pres' && !kitMissing(r).length ? ` · ${r.tag} is complete` : ''}`; },
      foot: all => `${kitPresent(r)} of ${kitCount(r)} present · ${r.items.length} lines`, footR: `<button class="lnk muted" data-act="scan">Check by scanning ›</button>` };
  }
  if (ty === 'kit' && tb === 'checks') {
    const rows = qf(r.checks, c => c.label + c.type);
    const mode = `<div class="words" style="border:0;margin:0"><span class="muted" style="font-size:12.5px">Check mode</span><button class="wd ${r.mode === 'KIT_LEVEL' ? 'on' : ''}" data-act="mode" data-v="KIT_LEVEL">One check for the case</button><button class="wd ${r.mode === 'PER_ITEM' ? 'on' : ''}" data-act="mode" data-v="PER_ITEM">Check each item</button></div><div class="muted" style="font-size:12.5px;padding:6px 0 14px">${r.mode === 'PER_ITEM' ? 'Warehouse prep and return tick off every item against its own model checks. The kit checks below run once for the case.' : 'The case is checked as one thing with the checks below. Items are not ticked individually.'}</div>`;
    const runs = r.runs.map(x => `<div class="rrow" style="min-height:48px"><span class="id" style="width:58px">${fmtD(x.at.slice(0, 10))}</span><div class="grow"><div class="ttl" style="font-weight:500">${esc(x.ctx)} · <a href="${U.wh}" style="color:var(--ink-2)"><span class="mono">${x.job}</span></a></div><div class="meta"><span>${esc(x.who)}</span><span>${esc(x.out)}</span></div></div></div>`).join('');
    return { key: 'kchecks', rows, rid: c => c.id, pre: mode, empty: ['No kit checks', 'Assign checks and they run once per case.'], add: ['+ Assign check…', 'noop'],
      render: c => ({ title: esc(c.label), meta: `<span>${esc(c.type)}${c.unit ? ' · ' + c.unit : ''}</span>`, rt: '' }),
      menu: c => [{ label: 'Move up', act: 'noop' }, '-', { label: 'Remove from kit', act: 'rowdo', args: `data-v="rm" data-id="${c.id}"`, danger: true }],
      bulk: n => [{ v: 'rm', l: `Remove ${plural(n, 'check')}`, d: 1 }], run: (v, rows) => { const ids = new Set(rows.map(c => c.id)); r.checks = r.checks.filter(c => !ids.has(c.id)); logEv(r, `removed ${plural(rows.length, 'check')} from the kit`); return `${plural(rows.length, 'check')} removed from ${r.tag}`; },
      foot: all => `${all.length} kit checks · ${r.runs.length} recent runs`, post: `<div class="shead" style="margin-top:26px"><span class="t">Recent checks<span class="n">${r.runs.length}</span></span></div>${runs}` };
  }
  if (ty === 'maint' && tb === 'assets') {
    const rows = qf(r.assets, a => a.tag + a.model);
    return { key: 'massets', rows, rid: a => a.tag, search: 'Search affected assets', empty: ['No assets', 'A job needs at least one asset.'], add: ['+ Add asset…', 'addasset'],
      render: a => { const A = POOL.find(p => p.tag === a.tag); return { idc: esc(a.tag), idw: 72, title: esc(a.model), href: U.asset, meta: `<span>${A ? 'Bin ' + esc(A.bin || '—') : ''}</span>${r.status === 'COMPLETED' ? `<span>${DISP[(r.disp || {})[a.tag] || 'RETURN_TO_SERVICE']}</span>` : ''}`, rt: r.status === 'COMPLETED' ? dw(DISP[(r.disp || {})[a.tag] || 'RETURN_TO_SERVICE'] === DISP.RETURN_TO_SERVICE ? 'Back in service' : 'Out of service', (r.disp || {})[a.tag] === 'KEEP_OUT_OF_SERVICE' || (r.disp || {})[a.tag] === 'RETIRE' ? 'warn' : 'ok') : dw('Out of service', 'warn') }; },
      menu: a => [{ label: `Open ${a.tag}`, href: U.asset, small: 'Asset' }, '-', { label: 'Remove from job', act: 'rowdo', args: `data-v="rm" data-id="${a.tag}"`, danger: true, ...(r.assets.length < 2 ? { args: `data-v="rm" data-id="${a.tag}" disabled`, small: 'last asset' } : {}) }],
      bulk: n => [{ v: 'rm', l: `Remove ${n} from job`, d: 1 }], run: (v, rows) => { if (rows.length >= r.assets.length) return 'A job needs at least one asset · nothing removed'; const ids = new Set(rows.map(a => a.tag)); r.assets = r.assets.filter(a => !ids.has(a.tag)); logEv(r, `removed ${[...ids].join(', ')} from the job`); return `${plural(rows.length, 'asset')} removed · back in service if nothing else holds them`; },
      foot: all => `${all.length} affected · ${r.status === 'COMPLETED' ? 'dispositions set' : 'out of service while the job is open'}` };
  }
  if (ty === 'maint' && tb === 'parts') {
    const fk = 'k', fv = filt(fk, 'all'); let rows = r.parts.filter(p => fv === 'all' || (fv === 'ord' ? p.st === 'ORDERED' : p.st !== 'ORDERED')); rows = qf(rows, p => p.name + p.sup);
    return { key: 'mparts', rows, rid: p => p.id, fk, fv, filtered: fv !== 'all', search: 'Search parts', empty: ['No parts yet', 'Add what the repair uses · on-order parts hold the job at Awaiting parts.'], add: ['+ Add part…', 'addpart'],
      words: [['all', 'All', r.parts.length], ['ord', 'On order', wc(r.parts, p => p.st === 'ORDERED')], ['arr', 'Arrived', wc(r.parts, p => p.st !== 'ORDERED')]],
      render: p => ({ title: esc(p.name), meta: `<span>${esc(p.sup)}</span><span class="mono">×${p.qty}</span>${p.st === 'ORDERED' ? `<span class="when">ETA <span class="mono">${fmtD(p.eta)}</span></span>` : ''}`, rt: `<span class="mono" style="min-width:56px;text-align:right;color:var(--ink)">${money(p.cost * p.qty)}</span>${p.st === 'ORDERED' ? dw('On order', 'warn') : dw(p.st === 'INSTALLED' ? 'Installed' : 'Arrived', 'ok')}` }),
      menu: p => [p.st === 'ORDERED' ? { label: 'Mark arrived', act: 'rowdo', args: `data-v="arr" data-id="${p.id}"` } : { label: 'Mark on order', act: 'rowdo', args: `data-v="ord" data-id="${p.id}"` }, '-', { label: 'Remove part', act: 'rowdo', args: `data-v="rm" data-id="${p.id}"`, danger: true }],
      bulk: n => [{ v: 'arr', l: `Mark arrived ${n}` }, { v: 'rm', l: `Remove ${plural(n, 'part')}`, d: 1 }],
      run: (v, rows) => { const ids = new Set(rows.map(p => p.id)); if (v === 'rm') { r.parts = r.parts.filter(p => !ids.has(p.id)); logEv(r, `removed ${plural(rows.length, 'part')}`); return `${plural(rows.length, 'part')} removed · estimate now ${money(mCost(r))}`; } r.parts.forEach(p => { if (ids.has(p.id)) { p.st = v === 'arr' ? 'ARRIVED' : 'ORDERED'; if (v === 'ord' && !p.eta) p.eta = addD(TODAY, 3); } }); logEv(r, `marked ${rows.map(p => p.name).join(', ')} ${v === 'arr' ? 'arrived' : 'on order'}`); return `${plural(rows.length, 'part')} ${v === 'arr' ? 'arrived' : 'back on order'}${v === 'arr' && !r.parts.some(p => p.st === 'ORDERED') ? ' · nothing left on order, ready to start' : ''}`; },
      foot: all => `Parts ${money(partsTotal(r))} · labour ${money(r.labour)} · ${r.status === 'COMPLETED' ? 'total' : 'estimate'} ${money(mCost(r))}`, footR: '' };
  }
  if (ty === 'tt' && tb === 'tests') {
    const fk = 'k', fv = filt(fk, 'all'); let rows = ttSorted(r).filter(t => fv === 'all' || (fv === 'fail' ? !ttOk(t) : ttOk(t))); rows = qf(rows, t => t.who + t.at + (t.note || ''));
    return { key: 'tests', rows, rid: t => t.id, fk, fv, filtered: fv !== 'all', search: 'Search tester or date', empty: ['No tests yet', 'Record the first test and the next due date appears.'], add: ['+ Record test…', 'recordtest'],
      words: [['all', 'All', r.tests.length], ['pass', 'Passed', wc(r.tests, ttOk)], ['fail', 'Failed', wc(r.tests, t => !ttOk(t))]],
      render: t => ({ idc: `<span style="font-family:var(--sans);font-size:12.5px">${fmtY(t.at)}</span>`, idw: 92, title: `${ttOk(t) ? dw('Pass', 'ok') : dw('Fail', 'err')} <span class="muted" style="font-weight:500">· ${esc(t.who)}</span>`, meta: `<span class="mono">Earth ${t.earth} Ω</span><span class="mono">Insulation ${t.ins >= 299 ? '>299' : t.ins} MΩ @ 500 V</span><span class="mono">Leakage ${t.leak} mA</span><span>Visual ${t.vis ? 'pass' : 'fail'}</span>${t.note ? `<span>${esc(t.note)}</span>` : ''}${t.mt ? `<span class="when">raised <span class="mono">${t.mt}</span></span>` : ''}`, rt: '' }),
      menu: t => [{ label: 'Print certificate…', act: 'rowdo', args: `data-v="cert" data-id="${t.id}"` }, ...(t.id === (ttLast(r) || {}).id ? [{ label: 'Print tag…', act: 'printtag' }] : []), ...(t.mt ? [{ label: `Open ${t.mt}`, act: 'noop', small: 'repair' }] : [])],
      bulk: n => [{ v: 'cert', l: `Print ${plural(n, 'certificate')}` }, { v: 'csv', l: `Export ${n} (CSV)` }], run: (v, rows) => v === 'cert' ? `${plural(rows.length, 'certificate')} sent to the printer` : `${plural(rows.length, 'test')} exported · ${r.tag}-tests.csv`,
      foot: all => `${r.tests.length} tests · limits earth ≤ ${TT_LIM.earth} Ω, insulation ≥ ${TT_LIM.ins} MΩ, leakage ≤ ${TT_LIM.leak} mA`, footR: '' };
  }
  if (ty === 'cat' && tb === 'models') {
    const incl = filt('incl', false), fk = 'k', fv = filt(fk, 'all'); let rows = (incl ? catAll(r) : r.models).filter(m => fv === 'all' || (fv === 'norate' ? !m.day : m.tt)); rows = qf(rows, m => m.name);
    const base = incl ? catAll(r) : r.models;
    return { key: 'cmodels', rows, rid: m => m.id, fk, fv, filtered: fv !== 'all', search: 'Search models', empty: ['No models in this category', 'Move models here from the Models list.'],
      words: [['all', 'All', base.length], ['norate', 'No rate', wc(base, m => !m.day)], ['tt', 'Needs T&T', wc(base, m => m.tt)]],
      extra2: `<button class="wd ${incl ? 'on' : ''}" data-act="incl">Including subcategories</button>`,
      render: m => ({ title: esc(m.name) + (m.ov ? ` <span class="faint" style="font-weight:500;font-size:12px">· overrides: ${esc(m.ov)}</span>` : ''), href: U.model, meta: `<span class="mono">${m.own} owned</span>${m.tt ? `<span>T&amp;T ${m.ov ? 'override' : esc(r.ttcls + ' · ' + r.ttmonths + ' mo')}</span>` : '<span>No T&amp;T</span>'}`, rt: m.day ? `<span class="mono" style="color:var(--ink)">${money(m.day)}<span class="muted"> /day</span></span>` : dw('No rate', 'warn') }),
      menu: m => [{ label: 'Open model', href: U.model, small: 'Model' }, { label: 'Move to a category…', act: 'rowdo', args: `data-v="move" data-id="${m.id}"` }],
      bulk: n => [{ v: 'rate', l: `Set day rate ${n}…` }, { v: 'move', l: `Move ${n} to…` }],
      ask: { move: rows => pickDlg('Move', `Move ${rows.length === 1 ? rows[0].name : rows.length + ' models'} to`, 'Category', ['Audio', 'Video', 'Rigging', 'Power', 'Cable', 'Staging'].map(c => `<option>${c}</option>`).join(''), 'bulkgo', 'move', 'Their assets, rates and history go with them.'), rate: rows => pickDlg('Rates', `Set the day rate for ${rows.length === 1 ? rows[0].name : rows.length + ' models'}`, 'Day rate ($)', '', 'bulkgo', 'rate', 'Replaces the rate on every model chosen. Weekly and monthly rates are left alone.', '<input id="bk-arg" type="number" min="0" inputmode="decimal" placeholder="e.g. 95">') },
      run: (v, rows, arg) => { const ids = new Set(rows.map(m => m.id)); const all = [r, ...r.subs.map(s => REC.cat[s])]; if (v === 'rate') { all.forEach(c => c.models.forEach(m => { if (ids.has(m.id)) m.day = +arg || 0; })); return `Day rate ${money(+arg)} set on ${plural(rows.length, 'model')}`; } all.forEach(c => { c.models = c.models.filter(m => !ids.has(m.id)); }); return `${plural(rows.length, 'model')} moved to ${arg}`; },
      foot: all => `${all.length} models · ${all.reduce((s, m) => s + m.own, 0)} assets`, footR: `<a class="lnk muted" href="${GL('models')}">Models list ›</a>` };
  }
  if (ty === 'cat' && tb === 'kits') {
    const rows = qf(r.kits, k => k.tag + k.name);
    return { key: 'ckits', rows, rid: k => k.id, search: 'Search kits', empty: ['No kits in this category', 'Create a kit and file it here.'],
      render: k => ({ idc: k.tag, idw: 66, title: esc(k.name), href: GL('kits'), meta: `<span class="mono">${k.items} items</span>${k.job ? `<span class="when">${k.job}</span>` : ''}`, rt: dw(k.st, k.st === 'Archived' ? '' : 'info') }),
      menu: k => [{ label: `Open ${k.tag}`, href: GL('kits'), small: 'Kits' }, { label: 'Move to a category…', act: 'rowdo', args: `data-v="move" data-id="${k.id}"` }],
      bulk: n => [{ v: 'move', l: `Move ${n} to…` }], ask: { move: rows => pickDlg('Move', `Move ${rows.length === 1 ? rows[0].tag : rows.length + ' kits'} to`, 'Category', ['Audio', 'Video', 'Rigging', 'Power', 'Comms'].map(c => `<option>${c}</option>`).join(''), 'bulkgo', 'move', 'Kit contents and reservations are not affected.') },
      run: (v, rows, arg) => { const ids = new Set(rows.map(k => k.id)); r.kits = r.kits.filter(k => !ids.has(k.id)); return `${plural(rows.length, 'kit')} moved to ${arg}`; }, foot: all => `${all.length} kits`, footR: `<a class="lnk muted" href="${GL('kits')}">Kits list ›</a>` };
  }
  if (ty === 'cat' && tb === 'subcategories') {
    const rows = qf(r.subs.map(s => REC.cat[s]), c => c.name);
    return { key: 'csubs', rows, rid: c => c.id, search: 'Search subcategories', empty: ['No subcategories', 'Split a big category into parts, e.g. Moving heads.'], add: ['+ Add subcategory…', 'addsub'],
      render: c => ({ title: esc(c.name), go: ['cat', c.id], meta: `<span class="mono">${plural(c.models.length, 'model')}</span><span class="mono">${plural(catAssets(c), 'asset')}</span>`, rt: statusOfCat(c) }),
      menu: c => [{ label: 'Open subcategory', act: 'go', args: `data-t="cat" data-id="${c.id}"` }, '-', { label: 'Delete subcategory…', act: 'rowdo', args: `data-v="del" data-id="${c.id}"`, danger: true }],
      bulk: n => [{ v: 'del', l: `Delete ${n}`, d: 1 }],
      ask: { del: rows => dlgShell('Delete', `Delete ${rows.length === 1 ? rows[0].name : rows.length + ' subcategories'}?`, `<div class="t-small" style="line-height:1.55"><div>The grouping goes; the gear stays. Downstream:</div><ul style="margin:10px 0 0;padding-left:18px;display:grid;gap:6px;color:var(--ink-2)"><li>${plural(rows.reduce((s, c) => s + c.models.length, 0), 'model')} move up into ${esc(r.name)} · rates and assets are untouched</li><li>Saved views and filters that name ${rows.map(c => esc(c.name)).join(', ')} stop matching</li><li>Quote sections keep their own names</li></ul></div>`, okBtn('bulkgo', `Delete ${rows.length === 1 ? rows[0].name : rows.length + ' subcategories'}`, true).replace('data-act="bulkgo"', 'data-act="bulkgo" data-v="del"')) },
      run: (v, rows) => { rows.forEach(c => { r.models.push(...c.models); delete REC.cat[c.id]; r.subs = r.subs.filter(s => s !== c.id); }); return `${plural(rows.length, 'subcategory', 'subcategories')} deleted · models moved up to ${r.name}`; },
      foot: all => `${all.length} subcategories`, footR: '' };
  }
  return null;
}
const statusOfCat = c => { const nr = c.models.filter(m => !m.day).length; return nr ? dw(`${nr} without rate`, 'warn') : ''; };
function pickDlg(over, title, label, opts, act, verb, hint, custom) {
  closeLayer(); dlgShell(over, title, `<div class="field"><label>${label}</label>${custom || `<select id="bk-arg">${opts}</select>`}</div>${hint ? `<div class="t-micro muted">${hint}</div>` : ''}`, okBtn(act, over === 'Rates' ? 'Set rate' : over === 'Move contents' ? 'Move contents' : 'Move').replace(`data-act="${act}"`, `data-act="${act}" data-v="${verb}"`));
}
function viewTab(r) {
  const t = state.tab;
  if (t === 'history') return viewHistory(r);
  if (t === 'files') return viewFiles(r);
  const cfg = tabCfg(r); return cfg ? listHtml(cfg) : '';
}
function viewHistory(r) {
  const W = [['all', 'All'], ['note', 'Notes']];
  const ev = r.events.filter(e => state.hist === 'all' || e.kind === 'note'), shown = ev.slice(0, state.histN);
  let last = '', h = '';
  for (const e of shown) {
    const d = e.at.slice(0, 10); if (d !== last) { last = d; h += `<div class="gl">${d === TODAY ? 'Today' : sd(d) + (d.slice(0, 4) !== TODAY.slice(0, 4) ? ' ' + d.slice(0, 4) : '')}</div>`; }
    h += `<div class="rrow" style="min-height:44px"><span class="mono muted" style="width:44px;font-size:12px;flex:none">${e.at.slice(11)}</span><div class="grow" style="font-size:13.5px"><b>${esc(e.who.split(' ')[0])}</b> ${e.kind === 'note' ? `<span style="white-space:pre-wrap">${esc(e.text)}</span>` : esc(e.text)}${e.job ? ` <a href="${U.ov}" class="mono" style="color:var(--ink-2)">${e.job}</a>` : ''}</div></div>`;
  }
  const left = ev.length - shown.length;
  const comp = state.composing ? `<div class="composebox" style="margin:8px 0 10px"><textarea id="compose" rows="3" placeholder="What should the next person know? ⌘↵ posts"></textarea><div style="display:flex;gap:14px;margin-top:8px;align-items:center"><span class="sright" style="margin-left:auto"><button class="lnk muted" data-act="composecancel">Cancel</button><button class="btn btn-primary btn-sm" data-act="post">Post</button></span></div></div>` : `<button class="addline" data-act="compose">Add a note…</button>`;
  return `<div class="words">${W.map(([k, n]) => `<button class="wd ${state.hist === k ? 'on' : ''}" data-act="histf" data-k="${k}">${n}</button>`).join('')}</div>${comp}${h || '<div class="empty2"><b>No history yet</b>Moves, checks and edits show up here as they happen.</div>'}${left > 0 ? `<button class="more" data-act="histmore">Show ${Math.min(8, left)} more · ${left} left</button>` : ''}<div class="foot1"><span>${ev.length} events · the audit trail, newest first</span></div>`;
}
function viewFiles(r) {
  const set = selSet(), L = r.files;
  const tiles = L.map(p => { const sel = set.has(p.id); return `<div class="ftile ${sel ? 'sel' : ''}" data-act="rsel" data-id="${p.id}"><button class="cb ${sel ? 'on' : ''}" data-act="rsel" data-id="${p.id}" aria-label="Select ${esc(p.name)}"></button><div class="fimg ${p.pdf ? 'b' : ''}">${p.pdf ? 'PDF' : 'IMG'}<button class="dots" data-act="rowmenu" data-id="${p.id}" aria-label="File actions">${ICON.dots}</button></div><div class="cap">${esc(p.name)}</div><div class="sub">${esc(p.size)} · ${fmtD(p.at)}</div></div>`; }).join('');
  const what = state.type === 'maint' ? 'Photos and paperwork' : state.type === 'tt' ? 'Certificates and photos' : state.type === 'kit' ? 'Photos and packing diagrams' : 'Floor plans, labels and photos';
  return `<div class="shead"><span class="t">${what}<span class="n">${L.length}</span></span><span class="sright"><button class="lnk" data-act="fupload">Upload</button><button class="lnk phoneonly" data-act="fphoto">Photo</button><span class="muted deskonly" style="font-size:12px">or drop files here</span></span></div>${tiles ? `<div class="fgrid">${tiles}</div>` : `<div class="empty2" style="margin-top:8px"><b>No files yet</b>Upload one, or take it from the phone.</div>`}<div class="foot1"><span>${L.length} files</span></div>`;
}
function renderBulk() {
  const b = $('#bulk'), r = cur(), set = r ? (state.sel[selKey()] || new Set()) : new Set(), n = set.size;
  b.classList.toggle('open', n > 0); document.body.classList.toggle('hassel', n > 0); if (!n || !r) return;
  if (state.tab === 'files') { b.innerHTML = `<b style="font-size:13px">${n} selected</b><button class="btn btn-secondary btn-sm" data-act="fdl">Download ${n}</button><button class="btn btn-secondary btn-sm" style="color:var(--t-out)" data-act="fremove">Remove ${n}</button><button class="btn btn-icon btn-sm" data-act="selclear" aria-label="Clear selection">✕</button>`; return; }
  const cfg = tabCfg(r); if (!cfg) { b.classList.remove('open'); return; }
  b.innerHTML = `<b style="font-size:13px">${n} selected</b>${cfg.bulk(n).map(x => `<button class="btn btn-secondary btn-sm" ${x.d ? 'style="color:var(--t-out)"' : ''} data-act="bulk" data-v="${x.v}">${x.l}</button>`).join('')}<button class="btn btn-icon btn-sm" data-act="selclear" aria-label="Clear selection">✕</button>`;
}
function runBulk(cfg, v, rows, arg) { const undo = snapshot(), r = cur(); const msg = cfg.run(v, rows, arg); selSet().clear(); closeLayer(); render(); toast(msg, undo); }

// ---------- the Edit sheets: the Forms artifact's engine (copied above), five field tables
const TTCLS = ['Class I', 'Class II', 'Class 0I', 'Class III'];
const FORMS = {
  loc: { key: 'loc', noun: 'location', title: v => v.name, moreLabel: 'Notes and tags',
    to: r => ({ name: r.name, type: r.type, parent: r.parent, address: r.address, cap: r.cap, notes: r.notes, tags: r.tags, isDefault: r.isDefault }),
    apply: (v, r) => { if (r.bin !== undefined && v.name !== r.name) { POOL.forEach(p => { if (p.bin === r.name) p.bin = v.name; }); r.bin = v.name; } if (v.isDefault) Object.values(REC.loc).forEach(l => { l.isDefault = false; }); Object.assign(r, { name: v.name, type: v.type, parent: v.parent, address: v.address, cap: +v.cap || r.cap, notes: v.notes, tags: v.tags, isDefault: v.isDefault }); },
    sections: [
      { t: 'Identity', hint: 'What it is called and what kind of place.', fields: [[fd('name', 'Name', { req: true, max: 200, reqMsg: 'Name is required' }), sel('type', 'Type', [['WAREHOUSE', 'Warehouse'], ['VENUE', 'Venue'], ['VEHICLE', 'Vehicle'], ['OFFSITE', 'Off-site']])]] },
      { t: 'Place', hint: 'Where it sits · search first.', fields: [fd('parent', 'Inside', { type: 'pick', src: (v, f) => PLACES.filter(p => p.label !== f.orig.name), ph: 'Search places — Warehouse A, Van 2… (none for top level)', hint: 'A place can sit inside one other place · leave empty for top level', clearable: true }), [fd('address', 'Address', { max: 500, ph: 'Optional' }), fd('cap', 'Capacity (assets)', { type: 'number', int: true, min: 0, ph: 'blank is not 0' })]] },
      { t: 'More details', hint: 'Notes and the default for new assets.', opt: true, fields: [fd('notes', 'Notes', { type: 'textarea', max: 1000, maxMsg: 'Keep it to 1,000 characters' }), fd('tags', 'Tags'), fd('isDefault', 'Default location for new assets', { type: 'check' })] }] },
  kit: { key: 'kit', noun: 'kit', title: v => v.name, moreLabel: 'Case, Xero and more details', reg: KTAGS, regKey: 'tag',
    to: r => ({ name: r.name, tag: r.tag, cat: r.cat, loc: r.loc, bin: r.bin, cond: r.cond, mode: r.mode, contents: r.items.map(i => ({ id: i.id, label: i.name, tg: i.tag, qty: i.qty, bulk: i.bulk })), caseType: r.caseType, dims: r.dims, weight: String(r.weight), xero: r.xero, pdate: r.pdate, price: String(r.price), repl: String(r.repl), desc: r.desc, tags: r.tags }),
    apply: (v, r) => { const keep = new Map(r.items.map(i => [i.id, i])); r.items = v.contents.map(c => { const o = keep.get(c.id); return o ? { ...o, qty: c.qty } : { id: c.id, tag: c.tg, name: c.label, serial: '', qty: c.qty, bulk: c.bulk, present: true, pos: 'Unplaced', cond: 'Good' }; }); KTAGS.delete(r.tag); KTAGS.add(v.tag.trim().toUpperCase()); Object.assign(r, { name: v.name, tag: v.tag.trim().toUpperCase(), cat: v.cat, loc: v.loc, bin: v.bin, cond: v.cond, mode: v.mode, caseType: v.caseType, dims: v.dims, weight: v.weight === '' ? null : +v.weight, xero: v.xero, pdate: v.pdate, price: v.price === '' ? null : +v.price, repl: v.repl === '' ? null : +v.repl, desc: v.desc, tags: v.tags }); },
    sections: [
      { t: 'Identity', hint: 'The case you pack and the check it gets. Status follows from the contents.', fields: [
        [fd('name', 'Name', { req: true, max: 200, reqMsg: 'Name is required' }), fd('tag', 'Kit tag', { req: true, max: 50, mono: true, reqMsg: 'Asset tag is required', check: (v, f) => KTAGS.has(v.tag.trim().toUpperCase()) && v.tag.trim().toUpperCase() !== f.orig.tag ? `${v.tag.trim().toUpperCase()} is already used by another kit` : '' })],
        [sel('cat', 'Category', CATS.map(c => [c, c])), sel('cond', 'Condition', CONDS.map(c => [c, c]))],
        [sel('loc', 'Home', Object.keys(LOCS).map(l => [l, l])), sel('bin', 'Bin', [['', 'No bin'], ...BINS.map(b => [b[0], b[0]])])],
        { k: 'mode', label: 'Check mode', type: 'words', dep: true, opts: [['KIT_LEVEL', 'One check for the case'], ['PER_ITEM', 'Check each item']], hint: v => v.mode === 'PER_ITEM' ? 'Each item below is ticked off on the way out and on return' : 'The case is checked as one thing · contents are not ticked individually' }] },
      { t: 'Contents', hint: 'Search an asset or bulk stock · Enter adds the top result.', fields: [{ k: 'contents', label: 'Add to the kit', type: 'contents', src: v => KITITEMS.filter(x => !v.contents.some(c => c.id === x.id)), ph: 'Search — beltpack, receiver, antenna…' }] },
      { t: 'Case', hint: 'Optional · what it travels in.', opt: true, fields: [[fd('caseType', 'Case type', { max: 200 }), fd('dims', 'Dimensions', { max: 200 })], fd('weight', 'Weight (kg)', { type: 'number', min: 0, step: '0.1', ph: 'blank is not 0' })] },
      { t: 'Xero coding', hint: 'Optional.', opt: true, fields: [fd('xero', 'Account code', { max: 50, mono: true })] },
      { t: 'More details', hint: 'Purchase, value and notes.', opt: true, fields: [[fd('pdate', 'Purchase date', { type: 'date' }), mny('price', 'Purchase price ($)')], mny('repl', 'Replacement value ($)'), fd('desc', 'Description', { type: 'textarea', max: 2000 }), fd('tags', 'Tags')] }] },
  maint: { key: 'maint', noun: 'maintenance job', title: v => v.title, moreLabel: 'Photos and tags',
    to: r => ({ assets: r.assets.map(a => a.tag), title: r.title, type: r.type, status: r.status, by: r.by, to: r.to, desc: r.desc, sched: r.sched, done: r.done, labour: r.labour == null ? '' : String(r.labour), result: r.result, next: r.next, disp: { ...(r.disp || {}) }, tags: r.tags }),
    apply: (v, r) => { const wasDone = r.status === 'COMPLETED'; r.assets = v.assets.map(t => ({ tag: t, model: (r.assets.find(a => a.tag === t) || { model: (ASSETS.find(a => a.id === t) || {}).label || '' }).model })); Object.assign(r, { title: v.title, type: v.type, status: v.status, by: v.by, to: v.to, desc: v.desc, sched: v.sched, labour: v.labour === '' ? null : +v.labour, tags: v.tags }); if (v.status === 'COMPLETED') { r.done = v.done || TODAY; r.result = v.result || 'PASS'; r.next = v.next; r.disp = v.disp; } else if (wasDone) { r.done = ''; r.result = ''; r.disp = {}; } syncMaint(r); },
    sections: [
      { t: 'Identity', hint: 'Which gear, and what is wrong.', fields: [
        { k: 'assets', label: 'Assets', type: 'multi', req: true, src: v => ASSETS.filter(a => !v.assets.includes(a.id)), ph: 'Search by tag or model — AURA-06, SK-0012…', hint: 'Search first · Enter adds the top result · add several for one job', reqMsg: 'Pick at least one asset', dep: true },
        fd('title', 'Title', { req: true, max: 200, reqMsg: 'Title is required' }),
        [sel('type', 'Type', Object.entries(MTYPE)), sel('status', 'Status', Object.entries(MSTAT).map(([k, v]) => [k, v[0]]), { dep: true })],
        [sel('by', 'Reported by', PEOPLE.map(p => [p, p || 'Nobody'])), sel('to', 'Assigned to', PEOPLE.map(p => [p, p || 'Unassigned']))],
        fd('desc', 'Description', { type: 'textarea', max: 5000 })] },
      { t: 'Schedule', hint: v => v.status === 'COMPLETED' ? 'When it was booked and when it was finished.' : 'When it is booked for. Parts live on the Parts tab.', fields: [[fd('sched', 'Scheduled', { type: 'date' }), fd('done', 'Completed', { type: 'date', show: v => v.status === 'COMPLETED', check: v => v.status === 'COMPLETED' && v.done && v.sched && v.done < v.sched ? 'Completed cannot be before the scheduled date' : '' })]] },
      { t: 'Outcome', hint: 'Only for completed work · decides what happens to the gear. Cost is the parts plus this labour.', show: v => v.status === 'COMPLETED', fields: [[mny('labour', 'Labour ($)'), fd('next', 'Next due', { type: 'date' })], { k: 'result', label: 'Result', type: 'words', opts: [['PASS', 'Pass'], ['FAIL', 'Fail'], ['CONDITIONAL', 'Conditional']] }, { k: 'disp', label: 'Each asset goes', type: 'disp' }] },
      { t: 'More details', hint: 'Tags. Photos are added on the Files tab.', opt: true, fields: [fd('tags', 'Tags')] }] },
  tt: { key: 'tt', noun: 'test & tag record', title: v => v.tag, moreLabel: 'Notes',
    to: r => ({ cls: r.cls, appliance: r.appliance, make: r.make, model: r.model, serial: r.serial, loc: r.loc, months: String(r.months), notes: r.notes, tag: r.tag }),
    apply: (v, r) => { Object.assign(r, { cls: v.cls, appliance: v.appliance, make: v.make, model: v.model, serial: v.serial, loc: v.loc, months: +v.months, notes: v.notes }); },
    sections: [
      { t: 'Equipment', hint: v => `Test tag record for ${v.tag}. The asset itself is edited on its own page.`, fields: [[sel('cls', 'Equipment class', TTCLS.map(c => [c, c])), fd('appliance', 'Appliance type', { max: 100 })], [fd('make', 'Make', { max: 100 }), fd('model', 'Model', { max: 100 })], [fd('serial', 'Serial number', { max: 100, mono: true }), fd('loc', 'Location', { max: 200 })]] },
      { t: 'Schedule', hint: 'Next due is last test plus this interval · never stored.', fields: [fd('months', 'Test interval (months)', { type: 'number', int: true, min: 1, max: 60, req: true, reqMsg: 'Interval is required', rangeMsg: 'Enter 1 to 60 months', hint: 'From the model by default · change it to override for this unit' })] },
      { t: 'More details', hint: 'Notes.', opt: true, fields: [fd('notes', 'Notes', { type: 'textarea', max: 1000 })] }] },
  cat: { key: 'cat', noun: 'category', small: true, title: v => v.name,
    to: r => ({ name: r.name, parent: r.parent, desc: r.desc, icon: r.icon, sort: String(r.sort), tags: r.tags, xero: r.xero, ttcls: r.ttcls, ttmonths: String(r.ttmonths) }),
    apply: (v, r) => { Object.assign(r, { name: v.name, parent: v.parent, desc: v.desc, icon: v.icon, sort: +v.sort || 0, tags: v.tags, xero: v.xero, ttcls: v.ttcls, ttmonths: +v.ttmonths || 12 }); },
    sections: [
      { t: '', fields: [fd('name', 'Name', { req: true, max: 100, reqMsg: 'Name is required' }), [sel('parent', 'Inside', [['', 'Top level'], ...Object.values(REC.cat).filter(c => !c.parent).map(c => [c.id, c.name])]), fd('icon', 'Icon', { max: 10, ph: 'Short tag' })], fd('desc', 'Description', { type: 'textarea', max: 500 }), fd('tags', 'Tags'), [fd('sort', 'Sort order', { type: 'number', int: true, min: 0 }), fd('xero', 'Xero account', { max: 50, mono: true, ph: 'Inherit org default' })]] },
      { t: 'Default test & tag profile', hint: 'Models here inherit it unless they override.', fields: [sel('ttcls', 'Class', [['', 'None · models set their own'], ...TTCLS.map(c => [c, c])], { dep: true }), fd('ttmonths', 'Interval (months)', { type: 'number', int: true, min: 1, max: 60, show: v => v.ttcls, rangeMsg: 'Enter 1 to 60 months' })] }] },
};
const _drawForm = drawForm;
drawForm = function (focus, keep) { const f = state.form; if (f && f.def.key === 'maint' && f.v.status === 'COMPLETED') { f.v.result = f.v.result || 'PASS'; f.v.done = f.v.done || TODAY; } return _drawForm(focus, keep); };
function openEdit() {
  const r = cur(), d = FORMS[state.type], v = d.to(r); closeLayer();
  state.form = { def: d, mode: 'edit', v, orig: clone(v), touched: {}, tried: false, dirty: false, more: true, q: {}, open: {}, hi: {}, added: 0, discard: false, addc: false };
  if (state.type === 'cat') { const o = FORMS.cat.sections[0].fields[1][0]; o.opts = [['', 'Top level'], ...Object.values(REC.cat).filter(c => !c.parent && c.id !== r.id).map(c => [c.id, c.name])]; }
  drawForm(null);
}
function closeForm() { closeLayer(); state.form = null; }
function commitForm() {
  const f = state.form, d = f.def; f.tried = true; const e = showErrs();
  if (Object.keys(e).length) { const k = flat(d).find(x => e[x.k]).k, i = $('#f-' + k, body) || $('#fw-' + k, body); if (i && i.focus) i.focus(); return; }
  const v = clone(f.v), r = cur(), title = d.title(v), ch = diffLabels({ ...f, v });
  if (!ch.length) { closeForm(); toast(`${esc(title)} · nothing changed`); return; }
  const undo = snapshot(); d.apply(v, r); logEv(r, `edited ${ch.join(', ')}`); closeForm(); render(); toast(`${esc(title)} saved · ${esc(ch.join(', '))}`, undo);
}
// keep the pool's status in step with an open / completed maintenance job (derived from the job, never typed twice)
function syncMaint(r) {
  r.assets.forEach(a => { const p = POOL.find(x => x.tag === a.tag); if (!p) return; const dsp = (r.disp || {})[a.tag] || 'RETURN_TO_SERVICE'; if (r.status === 'COMPLETED') { if (dsp === 'RETURN_TO_SERVICE') { p.st = 'Available'; p.fl = ''; } else if (dsp === 'RETIRE') { POOL = POOL.filter(x => x !== p); } else p.st = 'In maintenance'; } else if (r.status !== 'CANCELLED') p.st = 'In maintenance'; });
}

// ---------- dialogs
const OUTSIDE = [['SK-0201', 'Sennheiser EW-DX SK beltpack', 'Warehouse B'], ['Y8-41', 'd&b Y8', 'Van 2'], ['V-0012', 'Barco UDX-4K32', 'Warehouse B']];
const SIMS = t => `<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center"><span class="t-micro muted">Simulate a read</span>${t.map(x => `<button class="lnk mono" data-act="scanread" data-tag="${x}">${x}</button>`).join('')}</div>`;
function scanDlg(msg) {
  const r = cur(), ty = state.type, isLoc = ty === 'loc';
  dlgShell(isLoc ? 'Put away' : 'Check', isLoc ? `Scan into ${esc(r.name)}` : `Check ${esc(r.tag)} by scanning`,
    `<div class="scanbox"><span>Point the camera at a tag · a USB scanner types it and presses Enter</span></div>${isLoc && r.bin === undefined ? `<div class="field"><label>Bin</label><select id="s-bin"><option value="">Keep its bin · none for new arrivals</option>${BINS.map(b => `<option>${b[0]}</option>`).join('')}</select></div>` : ''}<div class="field"><label>Tag</label><input id="s-tag" class="mono" placeholder="Scan or type a tag, Enter" autocomplete="off"><div class="err" id="s-msg">${msg || ''}</div></div><div class="t-small muted">${isLoc ? `A read of an asset tag moves it into <b style="color:var(--ink)">${esc(r.name)}</b>${r.bin !== undefined ? '' : ' and the bin chosen above'}. One undo reverses it.` : `Each tag read ticks that item off as present in <b class="mono" style="color:var(--ink)">${esc(r.tag)}</b>. ${kitMissing(r).length ? `<b style="color:var(--ink)">${kitMissing(r).length}</b> still to find.` : 'Everything is present.'}`}</div>${SIMS(isLoc ? ['AURA-03', 'SK-0201', 'Y8-41', 'V-0012', 'ZZ-404'] : ['SK-0013', 'ULXD-01', 'PA-0003', 'K-0051', 'ZZ-404'])}`,
    `<a class="gh" href="${U.scan}">Open the full scanner ↗</a><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Done</button>`);
  setTimeout(() => { const i = $('#s-tag', body); if (i) i.focus(); }, 30);
}
function scanRead(tag) {
  const r = cur(), t = (tag || '').trim().toUpperCase(), setMsg = m => { const e = $('#s-msg', body); if (e) e.textContent = m; };
  if (!t) return;
  if (state.type === 'loc') {
    const sb = $('#s-bin', body), bin = sb ? sb.value : (r.bin || ''), p = POOL.find(x => x.tag === t), out = OUTSIDE.find(x => x[0] === t);
    if (p) { { if (!bin || (p.bin || '') === bin) { setMsg(`${t} is already in ${p.bin ? 'bin ' + p.bin : 'Warehouse A with no bin'}${bin ? '' : ' · pick a bin above to move it'}.`); return; } const undo = snapshot(), from = p.bin || 'no bin'; p.bin = bin; logEv(REC.loc.wa, `moved ${t} from ${from} to ${bin || 'no bin'}`); closeLayer(); render(); toast(`${esc(t)} moved from ${esc(from)} to ${esc(bin || 'no bin')}`, undo); } return; }
    if (out) { const undo = snapshot(); POOL.push({ tag: t, name: out[1], kind: 'S', bin, st: 'Available', job: '', cs: '', fl: '', qty: 1 }); logEv(REC.loc.wa, `put away ${t} from ${out[2]}${bin ? ' in ' + bin : ''}`); closeLayer(); render(); toast(`${esc(t)} put away${bin ? ' in ' + esc(bin) : ' · no bin yet'} · from ${esc(out[2])}`, undo); return; }
    setMsg(`No asset tagged ${t}. Check the label, or add it as a new asset.`); return;
  }
  const it = r.items.find(i => i.tag === t);
  if (it) { if (it.present) { setMsg(`${t} is already ticked off.`); return; } const undo = snapshot(); it.present = true; r.lastCheck = { at: `${TODAY} ${NOWT}`, who: ME, ctx: 'Scan check' }; logEv(r, `ticked off ${t} by scan`); closeLayer(); render(); toast(`${esc(t)} ticked off · ${kitPresent(r)} of ${kitCount(r)} present${kitMissing(r).length ? '' : ' · ' + esc(r.tag) + ' is complete'}`, undo); return; }
  setMsg(t.startsWith('K-') ? `${t} is a different kit. Open it from the Kits list.` : `${t} is not part of ${r.tag}. Add it from Contents.`);
}
function labelDlg(title, code, sub, ser) { dlgShell('Label', title, `<div class="lbl"><div class="qr">${qrSvg(code)}</div><div><div class="t">${esc(code)}</div><div class="muted" style="font-size:13px;margin-top:2px">${esc(sub)}</div>${ser ? `<div class="muted mono" style="font-size:12px;margin-top:6px">${esc(ser)}</div>` : ''}</div></div><div class="t-micro muted">The QR encodes the tag only · a scan of it opens this page.</div>`, `<button class="gh" data-act="labeldl">Download PNG</button><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="labelprint">Print</button>`); }
function printLabelsDlg() {
  const r = cur(), K = r.bin !== undefined ? [r] : locChildren(), un = K.filter(k => !k.printed);
  state.lbl = state.lbl || 'un';
  dlgShell('Labels', r.bin !== undefined ? `Print label · ${esc(r.name)}` : 'Print bin labels', r.bin !== undefined ? `<div class="lbl"><div class="qr">${qrSvg('WA-' + r.name)}</div><div><div class="t">${esc(r.name)}</div><div class="muted" style="font-size:13px;margin-top:2px">Warehouse A · ${locPool(r).length} assets</div></div></div><div class="t-micro muted">A scan of the label opens this bin and offers to put an asset away in it.</div>` : `<div class="words" style="border:0"><button class="wd ${state.lbl === 'un' ? 'on' : ''}" data-act="lblmode" data-v="un">No label yet <span class="faint mono">${un.length}</span></button><button class="wd ${state.lbl === 'all' ? 'on' : ''}" data-act="lblmode" data-v="all">All bins <span class="faint mono">${K.length}</span></button></div><div class="t-small" style="line-height:1.6">${(state.lbl === 'un' ? un : K).map(k => `<span class="mono" style="margin-right:12px">${esc(k.name)}</span>`).join('') || '<span class="muted">Every bin has a label.</span>'}</div><div class="t-micro muted">One A4 sheet of 12 · the printer used for the last sheet.</div>`, `<div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="lblgo">Print ${r.bin !== undefined ? 'label' : plural((state.lbl === 'un' ? un : K).length, 'label')}</button>`);
}
function candDlg(over, title, cands, actName, hint) {
  state.cand = { cands, act: actName };
  dlgShell(over, title, `<div class="search" style="width:100%;height:40px"><span class="muted">⌕</span><input id="cd-q" placeholder="Search by tag or model" autocomplete="off"></div><div id="cd-res" style="margin-top:4px;max-height:280px;overflow:auto">${candList('')}</div>${hint ? `<div class="t-micro muted">${hint}</div>` : ''}`, `<div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Done</button>`);
  setTimeout(() => { const i = $('#cd-q', body); if (i) i.focus(); }, 30);
}
function candList(q) { const c = state.cand, rs = c.cands.filter(x => !q || (x.label + x.tg + (x.sub || '')).toLowerCase().includes(q.toLowerCase())).slice(0, 7); return rs.length ? rs.map(x => `<button class="res2" data-act="${c.act}" data-id="${esc(x.id)}"><div style="min-width:0"><div style="font-weight:600;font-size:13.5px">${esc(x.label)}</div><div class="t-micro muted">${esc(x.sub || '')}</div></div><span class="tg">${esc(x.tg)}</span></button>`).join('') : `<div class="none" style="padding:10px;font-size:13px;color:var(--muted)">Nothing matches “${esc(q)}”</div>`; }
function lastRtVals() { const g = id => { const e = $('#' + id, body); return e ? e.value.trim() : ''; }; return { date: g('rt-date') || TODAY, who: g('rt-who') || ME, vis: !!($('#rt-vis', body) || {}).checked, earth: g('rt-earth'), ins: g('rt-ins'), leak: g('rt-leak') }; }
function rtResult() {
  const v = lastRtVals(), out = $('#rt-res', body), bad = []; if (!out) return; const er = $('#rt-err', body); if (er) er.textContent = '';
  if (v.earth === '' || v.ins === '' || v.leak === '') { out.innerHTML = '<span class="muted">Enter all three readings</span>'; return; }
  if (+v.earth > TT_LIM.earth) bad.push(`earth ${v.earth} Ω is over ${TT_LIM.earth}`); if (+v.ins < TT_LIM.ins) bad.push(`insulation ${v.ins} MΩ is under ${TT_LIM.ins}`); if (+v.leak > TT_LIM.leak) bad.push(`leakage ${v.leak} mA is over ${TT_LIM.leak}`); if (!v.vis) bad.push('visual check failed');
  out.innerHTML = bad.length ? `${dw('Fail', 'err')} <span class="muted">· ${esc(bad.join(' · '))}</span><div class="t-micro muted" style="margin-top:4px">Saving takes ${esc(cur().tag)} out of service and raises a repair job.</div>` : `${dw('Pass', 'ok')} <span class="muted">· all readings inside the limits · next due ${fmtL(addM(v.date, cur().months))}</span>`;
}
function recordTestDlg() {
  const r = cur();
  dlgShell('Record test', `Test ${esc(r.tag)}`, `<div class="g2"><div class="field"><label>Tested on</label><input id="rt-date" type="date" value="${TODAY}"></div><div class="field"><label>Tester</label><select id="rt-who">${['Jayden Cole', 'Sam Okafor', 'Tom Nguyen'].map(p => opt(p, p, ME)).join('')}</select></div></div><label class="chk" style="margin:2px 0"><input id="rt-vis" type="checkbox" checked><span>Visual: cord, plug, housing, markings and vents all pass</span></label><div class="g3"><div class="field"><label>Earth continuity (Ω)</label><input id="rt-earth" type="number" step="0.01" min="0" inputmode="decimal" class="mono" placeholder="≤ ${TT_LIM.earth}"></div><div class="field"><label>Insulation (MΩ @ 500 V)</label><input id="rt-ins" type="number" step="1" min="0" inputmode="decimal" class="mono" placeholder="≥ ${TT_LIM.ins}"></div><div class="field"><label>Leakage (mA)</label><input id="rt-leak" type="number" step="0.01" min="0" inputmode="decimal" class="mono" placeholder="≤ ${TT_LIM.leak}"></div></div><div class="err" id="rt-err"></div><div id="rt-res" style="font-size:13.5px"><span class="muted">Enter all three readings</span></div>`, `<a class="gh" href="${U.scan}">Quick test in Scan ↗</a><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="rtgo">Record test</button>`, true);
  setTimeout(() => { const i = $('#rt-earth', body); if (i) i.focus(); }, 30);
}
const newMaint = (title, type, tag, model, sched, to, desc) => { const n = Object.keys(REC.maint).length + 188, id = 'm' + n; REC.maint[id] = { id, num: 'MT-0' + n, title, type, status: 'SCHEDULED', assets: [{ tag, model }], by: ME, to, desc, sched, done: '', labour: null, result: '', next: '', disp: {}, tags: '', retest: '', parts: [], events: [{ at: `${TODAY} ${NOWT}`, who: ME, text: 'created it', job: '', kind: 'change' }], files: [] }; return REC.maint[id]; };
function completeDlg() {
  const r = cur(), c = state.cmp, ord = r.parts.filter(p => p.st === 'ORDERED');
  const dsp = a => c.disp[a.tag] || (c.result === 'FAIL' ? 'KEEP_OUT_OF_SERVICE' : 'RETURN_TO_SERVICE');
  dlgShell('Complete', `Complete ${esc(r.num)}`, `<div class="field"><label>Result</label><div class="words" style="border:0">${Object.entries(RESN).map(([k, v]) => `<button class="wd ${c.result === k ? 'on' : ''}" data-act="cres" data-v="${k}">${v[0]}</button>`).join('')}</div></div><div class="g2"><div class="field"><label>Completed</label><input id="c-date" type="date" value="${c.date}"></div><div class="field"><label>Labour ($)</label><input id="c-labour" type="number" min="0" step="0.01" inputmode="decimal" class="mono" placeholder="blank is not $0" value="${c.labour}"></div></div><div class="field"><label>Next due</label><input id="c-next" type="date" value="${c.next}"></div><div class="field"><label>Each asset goes</label>${r.assets.map(a => `<div class="crow" style="border-top:0;padding:4px 0"><span class="id mono">${esc(a.tag)}</span><div class="grow m">${esc(a.model)}</div><select id="c-d-${esc(a.tag)}" style="width:190px">${Object.entries(DISP).map(([k, v]) => opt(k, v, dsp(a))).join('')}</select></div>`).join('')}</div><div class="t-small" style="line-height:1.55;color:var(--ink-2)">Cost will read <b class="mono" style="color:var(--ink)">${money(partsTotal(r) + (+c.labour || 0))}</b> · parts ${money(partsTotal(r))} from the Parts tab${ord.length ? `. <span style="color:var(--warn)">${plural(ord.length, 'part')} still on order</span> · mark ${ord.length > 1 ? 'them' : 'it'} arrived first if used` : ''}.</div>`, `<div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="cgo">Complete job</button>`, true);
}
function readComplete() { const g = id => { const e = $('#' + id, body); return e ? e.value : ''; }; const c = state.cmp; c.date = g('c-date') || c.date; c.labour = g('c-labour'); c.next = g('c-next'); cur().assets.forEach(a => { const v = g('c-d-' + a.tag); if (v) c.disp[a.tag] = v; }); }
const retireKitText = k => `<div class="t-small" style="line-height:1.55"><div>Leaves availability and every picker. What happens to the things downstream:</div><ul style="margin:10px 0 0;padding-left:18px;display:grid;gap:6px;color:var(--ink-2)">${k.job ? `<li>${k.job.id} ${esc(JOBS[k.job.id].name)} (${rng(k.job.from, k.job.to)}) loses this kit · the job's line stays and shows <b>short by 1</b></li>` : '<li>No job reservations to release</li>'}<li>Its ${plural(k.items.length, 'line')} go back to being loose assets in ${esc(k.loc)} · nothing is deleted</li><li>Checks, history and the packing diagram are kept</li><li>Reinstate any time</li></ul></div>`;

// ---------- page menu per record type
function pageMenu(el) {
  const r = cur(), ph = isPhone(), ty = state.type, T = [];
  if (ph) T.push({ label: 'Edit…', act: 'edit' });
  if (ty === 'loc') T.push(!ph ? { label: 'Scan to put away…', act: 'scan', small: '/' } : null, { label: r.bin === undefined ? 'Print bin labels…' : 'Print label…', act: 'printlabels' }, { label: 'Move contents…', act: 'movecontents' }, ...(r.bin === undefined ? [{ label: 'Add bin…', act: 'addbin' }] : []), { label: 'Start a count…', act: 'count' }, { label: 'Set as default location', act: 'setdefault', args: r.isDefault ? 'disabled' : '', small: r.isDefault ? 'already' : '' }, '-', { label: r.bin === undefined ? 'Delete location…' : 'Delete bin…', act: 'dellocdlg', danger: true });
  if (ty === 'kit') T.push(!ph ? { label: 'Check by scanning…', act: 'scan', small: '/' } : null, { label: 'Print label…', act: 'kitlabel' }, { label: 'Book a repair…', act: 'repairkit' }, { label: 'New kit like this…', act: 'noop', small: 'Duplicate' }, { label: 'Force return…', act: 'noop', args: 'disabled', small: 'deployed only' }, '-', r.retired ? { label: 'Reinstate', act: 'reinstate' } : { label: 'Retire kit…', act: 'retirekit', danger: true });
  if (ty === 'maint') T.push(...(r.status === 'COMPLETED' || r.status === 'CANCELLED' ? [{ label: 'Reopen job', act: 'reopen' }] : [{ label: 'Complete…', act: 'complete' }, ...(r.status !== 'IN_PROGRESS' ? [{ label: 'Start work', act: 'setstatus', args: 'data-v="IN_PROGRESS"' }] : []), ...(r.status === 'IN_PROGRESS' ? [{ label: 'Send to QA', act: 'setstatus', args: 'data-v="QA"' }] : []), ...(r.parts.some(p => p.st === 'ORDERED') ? [{ label: 'Mark parts arrived', act: 'partsarrived' }] : [])]), { label: 'Print job sheet…', act: 'noop' }, '-', ...(r.status !== 'COMPLETED' && r.status !== 'CANCELLED' ? [{ label: 'Cancel job…', act: 'canceljob' }] : []), { label: 'Delete job…', act: 'delmaintdlg', danger: true });
  if (ty === 'tt') T.push(...(r.retired ? [] : [{ label: 'Record test…', act: 'recordtest' }]), { label: 'Print tag…', act: 'printtag' }, ...(r.retired ? [] : [{ label: 'Book a test…', act: 'booktest' }]), { label: 'Open asset', href: U.asset, small: 'Asset' }, { label: 'Quick test in Scan', href: U.scan, small: 'Scan' }, '-', r.retired ? { label: 'Delete permanently…', act: 'deltt', danger: true } : { label: 'Retire…', act: 'retirett', danger: true });
  if (ty === 'cat') T.push({ label: 'Add subcategory…', act: 'addsub' }, { label: 'Models list', href: GL('models'), small: 'Models' }, { label: 'Kits list', href: GL('kits'), small: 'Kits' }, '-', { label: 'Delete category…', act: 'delcat', danger: true });
  openMenu(el, titleOf(r), T.filter(Boolean));
}

const effList = li => `<ul style="margin:10px 0 0;padding-left:18px;display:grid;gap:6px;color:var(--ink-2)">${li.map(x => `<li>${x}</li>`).join('')}</ul>`;
function act(name, el, ev) {
  const r = cur(), id = el && el.dataset ? el.dataset.id : null, f = state.form, ty = state.type;
  if (!r && !['close', 'noop', 'toastclose', 'undo', 'sw', 'go'].includes(name)) return;
  switch (name) {
    case 'close': if (f && f.dirty && !f.discard) { f.discard = true; drawForm(null, true); } else if (f) closeForm(); else closeLayer(); break;
    case 'noop': closeLayer(); toast('Not wired in this prototype'); break;
    case 'toastclose': $('#toast').classList.remove('open'); break;
    case 'undo': if (state.undo) { const u = state.undo; state.undo = null; u(); } $('#toast').classList.remove('open'); break;
    case 'sw': go(el.dataset.t, TYPES[el.dataset.t].def); break;
    case 'go': go(el.dataset.t, el.dataset.id || id); break;
    case 'tab': closeLayer(); state.tab = el.dataset.t; state.q = ''; state.n = {}; state.lastSel = null; state.composing = false; render(); writeHash(); break;
    case 'morechecks': state.moreChecks = !state.moreChecks; render(); break;
    case 'edit': closeLayer(); openEdit(); break;
    case 'pagemenu': pageMenu(el); break;
    // forms engine
    case 'keep': f.discard = false; drawForm(null, true); break;
    case 'discard': closeForm(); toast('Changes discarded'); break;
    case 'formgo': if (f) commitForm(); break;
    case 'moretoggle': f.more = true; drawForm(null, true); break;
    case 'wsel': f.v[el.dataset.k] = el.dataset.v; f.dirty = true; drawForm(null, true); break;
    case 'pick': pick(el.dataset.k, el.dataset.v); break;
    case 'rm': { const k = el.dataset.k, i = +el.dataset.i; f.dirty = true; (k === 'assets' ? f.v.assets : f.v.contents).splice(i, 1); drawForm(null, true); break; }
    // lists
    case 'lf': setFilt(el.dataset.k, el.dataset.v); render(); break;
    case 'incl': setFilt('incl', !filt('incl', false)); render(); break;
    case 'clearf': Object.keys(state.filt).filter(k => k.startsWith(ty + ':' + state.id + ':')).forEach(k => delete state.filt[k]); state.q = ''; state.n = {}; render(); break;
    case 'binf': openMenu(el, 'Bin', [{ label: 'Any bin', act: 'binfset', args: 'data-v=""', on: !filt('bin', '') }, { label: 'No bin', act: 'binfset', args: 'data-v="No bin"', on: filt('bin', '') === 'No bin' }, '-', ...BINS.map(b => ({ label: b[0], act: 'binfset', args: `data-v="${b[0]}"`, on: filt('bin', '') === b[0], small: String(POOL.filter(p => p.bin === b[0]).length) }))]); break;
    case 'binfset': closeLayer(); setFilt('bin', el.dataset.v); render(); break;
    case 'more': state.n[el.dataset.k] = (state.n[el.dataset.k] || 25) + 25; render(); break;
    case 'rsel': {
      const cfg = state.tab === 'files' ? null : tabCfg(r), vis = state.tab === 'files' ? r.files.map(x => x.id) : cfg.rows.slice(0, state.n[cfg.key] || 25).map(cfg.rid), set = selSet();
      if (ev && ev.shiftKey && state.lastSel && vis.includes(state.lastSel)) { const i1 = vis.indexOf(state.lastSel), i2 = vis.indexOf(id); vis.slice(Math.min(i1, i2), Math.max(i1, i2) + 1).forEach(k => set.add(k)); } else set.has(id) ? set.delete(id) : set.add(id);
      state.lastSel = id; render(); break; }
    case 'rselall': { const cfg = tabCfg(r), vis = cfg.rows.slice(0, state.n[cfg.key] || 25).map(cfg.rid), set = selSet(), all = vis.every(k => set.has(k)); vis.forEach(k => all ? set.delete(k) : set.add(k)); render(); break; }
    case 'selclear': selSet().clear(); render(); break;
    case 'rowmenu': {
      if (state.tab === 'files') { const p = r.files.find(x => x.id === id); openMenu(el, p.name, [{ label: 'Open', act: 'noop' }, { label: 'Download', act: 'fdl1', args: `data-id="${id}"` }, '-', { label: 'Remove', act: 'fremove1', args: `data-id="${id}"`, danger: true }]); break; }
      const cfg = tabCfg(r), row = cfg.rows.find(x => cfg.rid(x) === id) || cfg.rows[0]; openMenu(el, String(cfg.rid(row)), cfg.menu(row)); break; }
    case 'rowdo': case 'bulk': {
      const cfg = tabCfg(r), v = el.dataset.v, rows = name === 'bulk' ? cfg.rows.filter(x => selSet().has(cfg.rid(x))) : cfg.rows.filter(x => cfg.rid(x) === id); state.pend = { rows };
      closeLayer(); if (cfg.ask && cfg.ask[v]) cfg.ask[v](rows); else runBulk(cfg, v, rows); break; }
    case 'bulkgo': { const cfg = tabCfg(r), a = $('#bk-arg', body); runBulk(cfg, el.dataset.v, state.pend.rows, a ? a.value : ''); break; }
    // history · files
    case 'histf': state.hist = el.dataset.k; state.histN = 8; render(); break;
    case 'histmore': state.histN += 8; render(); break;
    case 'compose': state.composing = true; render(); { const c = $('#compose'); if (c) c.focus(); } break;
    case 'composecancel': state.composing = false; render(); break;
    case 'post': { const t = ($('#compose') || {}).value; if (!t || !t.trim()) { $('#compose').focus(); break; } const undo = snapshot(); logEv(r, t.trim(), '', 'note'); state.composing = false; state.hist = 'all'; render(); toast('Note added to the history', undo); break; }
    case 'fupload': case 'fphoto': { const undo = snapshot(), n = r.files.length + 1; r.files.unshift({ id: 'u' + n + r.files.length, name: name === 'fphoto' ? `Photo ${fmtD(TODAY)}.jpg` : `${titleOf(r).replace(/[^\w.-]+/g, '-')} upload ${n}.pdf`, size: '1.0 MB', at: TODAY, by: ME, pdf: name === 'fupload' }); logEv(r, 'added a file'); render(); toast('File added', undo); break; }
    case 'fdl1': state.sel[selKey()] = new Set([id]); closeLayer(); act('fdl'); break;
    case 'fdl': { const n = selSet().size; selSet().clear(); closeLayer(); render(); toast(`${plural(n, 'file')} downloaded`); break; }
    case 'fremove1': state.sel[selKey()] = new Set([id]); closeLayer(); act('fremove'); break;
    case 'fremove': { const undo = snapshot(), n = selSet().size; r.files = r.files.filter(x => !selSet().has(x.id)); selSet().clear(); render(); toast(`${plural(n, 'file')} removed`, undo); break; }
    // scanning, labels, counts
    case 'scan': closeLayer(); scanDlg(); break;
    case 'scanread': scanRead(el.dataset.tag); break;
    case 'count': closeLayer(); dlgShell('Count', `Count ${esc(r.name)}`, `<div class="t-small" style="line-height:1.6">A count compares what scanners read against the <b class="mono" style="color:var(--ink)">${locPool(r).length}</b> assets homed here. Anything unread is listed as missing at the end · nothing changes until you accept the result.</div>`, `<div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><a class="btn btn-primary" href="${U.scan}">Start in Scan</a>`); break;
    case 'printlabels': closeLayer(); printLabelsDlg(); break;
    case 'lblmode': state.lbl = el.dataset.v; printLabelsDlg(); break;
    case 'lblgo': { const undo = snapshot(), K = r.bin !== undefined ? [r] : locChildren(), t = state.lbl === 'all' || r.bin !== undefined ? K : K.filter(k => !k.printed); t.forEach(k => { k.printed = true; }); logEv(REC.loc.wa, `printed ${plural(t.length, 'bin label')}`); closeLayer(); render(); toast(`${plural(t.length, 'bin label')} sent to the label printer`, undo); break; }
    case 'kitlabel': closeLayer(); labelDlg(`Print label · ${esc(r.tag)}`, r.tag, r.name, r.caseType); break;
    case 'printtag': closeLayer(); { const l = ttLast(r); labelDlg(`Print tag · ${esc(r.tag)}`, r.tag, `${r.model} · ${r.cls}`, `${l ? 'Tested ' + fmtL(l.at) + ' · next ' + fmtL(ttNext(r)) : 'Not tested'}`); } break;
    case 'labeldl': closeLayer(); toast('Label PNG saved'); break;
    case 'labelprint': closeLayer(); toast('Label sent to the label printer'); break;
    case 'nobin': state.tab = 'contents'; state.q = ''; setFilt('k', 'nobin'); render(); writeHash(); break;
    case 'kitsinc': state.tab = 'contents'; state.q = ''; setFilt('k', 'K'); render(); writeHash(); break;
    case 'findmissing': closeLayer(); state.tab = 'contents'; state.q = ''; setFilt('k', 'missing'); render(); writeHash(); break;
    case 'norate': state.tab = 'models'; state.q = ''; setFilt('k', 'norate'); render(); writeHash(); break;
    case 'mode': { if (r.mode === el.dataset.v) break; const undo = snapshot(); r.mode = el.dataset.v; logEv(r, `changed check mode to ${r.mode === 'PER_ITEM' ? 'Check each item' : 'One check for the case'}`); render(); toast(`Check mode: ${r.mode === 'PER_ITEM' ? 'check each item' : 'one check for the case'}`, undo); break; }
    case 'setdefault': { closeLayer(); const undo = snapshot(); Object.values(REC.loc).forEach(l => { l.isDefault = false; }); r.isDefault = true; logEv(r, 'set it as the default location for new assets'); render(); toast(`${esc(r.name)} is now the default location for new assets`, undo); break; }
    case 'movecontents': { closeLayer(); const isBin = r.bin !== undefined, nb = POOL.filter(p => !p.bin).length; dlgShell('Move contents', isBin ? `Move everything out of ${esc(r.name)}` : 'Move contents between bins', `${isBin ? '' : `<div class="field"><label>From</label><select id="mc-from"><option value="__none">No bin · ${nb} assets</option>${BINS.map(b => `<option value="${b[0]}">${b[0]} · ${POOL.filter(p => p.bin === b[0]).length} assets</option>`).join('')}</select></div>`}<div class="field"><label>Into</label><select id="bk-arg">${BINS.filter(b => b[0] !== r.bin).map(b => `<option>${b[0]}</option>`).join('')}${isBin ? '<option value="">No bin</option>' : ''}</select></div><div class="t-micro muted">Cases take what is inside them along. Bins stay · nothing leaves ${isBin ? 'Warehouse A' : esc(r.name)}.</div>`, okBtn('mcgo', 'Move contents')); break; }
    case 'mcgo': { const undo = snapshot(), to = $('#bk-arg', body).value, fe = $('#mc-from', body), from = fe ? (fe.value === '__none' ? '' : fe.value) : r.bin; if (from === to) { closeLayer(); break; } let n = 0; POOL.forEach(p => { if ((p.bin || '') === from) { p.bin = to; n++; } }); logEv(REC.loc.wa, `moved ${plural(n, 'asset')} from ${from || 'no bin'} to ${to || 'no bin'}`); closeLayer(); render(); toast(`${plural(n, 'asset')} moved from ${from || 'no bin'} to ${to || 'no bin'}`, undo); break; }
    // adds
    case 'addbin': closeLayer(); dlgShell('Bins', 'Add a bin', `<div class="g2"><div class="field"><label>Name *</label><input id="ab-n" class="mono" placeholder="e.g. D1" autocomplete="off"><div class="err" id="ab-e"></div></div><div class="field"><label>Capacity (assets)</label><input id="ab-c" type="number" min="0" placeholder="blank is not 0"></div></div><div class="t-micro muted">A bin is a location inside Warehouse A · its label is printed from the Bins tab.</div>`, okBtn('addbingo', 'Add bin')); setTimeout(() => $('#ab-n', body).focus(), 30); break;
    case 'addbingo': { const n = $('#ab-n', body).value.trim(); if (!n) { $('#ab-e', body).textContent = 'Name is required'; break; } if (Object.values(REC.loc).some(l => l.name.toLowerCase() === n.toLowerCase())) { $('#ab-e', body).textContent = `${n} already exists`; break; } const c = $('#ab-c', body).value; commitWrite(() => { const k = n.toLowerCase().replace(/\s+/g, '-'); REC.loc[k] = { id: k, name: n, bin: n, type: 'WAREHOUSE', parent: 'wa', address: '', notes: '', tags: '', isDefault: false, cap: c === '' ? 0 : +c, printed: false, events: [], files: [] }; logEv(REC.loc.wa, `added bin ${n}`); return `Bin ${n} added to Warehouse A`; }); break; }
    case 'additem': closeLayer(); candDlg('Kit', `Add to ${esc(r.tag)}`, KITITEMS.filter(x => !r.items.some(i => i.id === x.id)).map(x => ({ id: x.id, label: x.label, tg: x.tg, sub: x.sub })), 'additempick', 'Serialised units are tracked by tag · bulk stock is counted.'); break;
    case 'additempick': { const x = KITITEMS.find(z => z.id === id), undo = snapshot(); r.items.push({ id: x.id, tag: x.tg, name: x.label, serial: '', qty: 1, bulk: !!x.bulk, present: true, pos: 'Unplaced', cond: 'Good' }); logEv(r, `added ${x.tg} to the kit`); closeLayer(); render(); toast(`${esc(x.tg)} added to ${esc(r.tag)}`, undo); break; }
    case 'addasset': closeLayer(); candDlg('Maintenance', `Add an asset to ${esc(r.num)}`, ASSETS.filter(a => !r.assets.some(z => z.tag === a.id)).map(a => ({ id: a.id, label: a.label, tg: a.tg, sub: a.sub })), 'addassetpick', 'It goes out of service with the others until the job completes.'); break;
    case 'addassetpick': { const a = ASSETS.find(z => z.id === id), undo = snapshot(); r.assets.push({ tag: a.id, model: a.label }); syncMaint(r); logEv(r, `added ${a.id} to the job`); closeLayer(); render(); toast(`${esc(a.id)} added to ${esc(r.num)} · out of service`, undo); break; }
    case 'addpart': closeLayer(); dlgShell('Parts', 'Add a part', `<div class="field"><label>Part *</label><input id="ap-n" placeholder="e.g. Lens motor" autocomplete="off"><div class="err" id="ap-e"></div></div><div class="g2"><div class="field"><label>Supplier</label><select id="ap-s">${['Martin Pro Audio', 'Workshop stock', 'Scene Change', 'Big Picture'].map(s => `<option>${s}</option>`).join('')}</select></div><div class="field"><label>Quantity</label><input id="ap-q" type="number" min="1" value="1"></div></div><div class="g2"><div class="field"><label>Price each ($)</label><input id="ap-c" type="number" min="0" step="0.01" inputmode="decimal" class="mono" placeholder="blank is not $0"></div><div class="field"><label>ETA</label><input id="ap-e2" type="date" value="${addD(TODAY, 3)}"></div></div><div class="t-micro muted">A part with an ETA is on order · clear the date if you already have it.</div>`, okBtn('addpartgo', 'Add part')); setTimeout(() => $('#ap-n', body).focus(), 30); break;
    case 'addpartgo': { const n = $('#ap-n', body).value.trim(); if (!n) { $('#ap-e', body).textContent = 'Part name is required'; break; } const c = $('#ap-c', body).value, eta = $('#ap-e2', body).value; commitWrite(() => { r.parts.push({ id: 'p' + (r.parts.length + 5), name: n, sup: $('#ap-s', body).value, qty: Math.max(1, +$('#ap-q', body).value || 1), cost: c === '' ? null : +c, st: eta ? 'ORDERED' : 'ARRIVED', eta }); logEv(r, `added part ${n}`); return `${n} added · estimate ${money(mCost(r))}`; }); break; }
    case 'addsub': closeLayer(); dlgShell('Categories', `Add a subcategory to ${esc(r.name)}`, `<div class="field"><label>Name *</label><input id="as-n" placeholder="e.g. Followspots" autocomplete="off"><div class="err" id="as-e"></div></div>`, okBtn('addsubgo', 'Add subcategory')); setTimeout(() => $('#as-n', body).focus(), 30); break;
    case 'addsubgo': { const n = $('#as-n', body).value.trim(); if (!n) { $('#as-e', body).textContent = 'Name is required'; break; } const k = n.toLowerCase().replace(/[^a-z0-9]+/g, '-'); if (REC.cat[k]) { $('#as-e', body).textContent = `${n} already exists`; break; } commitWrite(() => { REC.cat[k] = { id: k, name: n, parent: r.id, icon: '', desc: '', tags: '', sort: 1, xero: '', ttcls: r.ttcls, ttmonths: r.ttmonths, models: [], kits: [], subs: [] }; r.subs.push(k); return `${n} added under ${r.name}`; }); break; }
    // maintenance
    case 'partsarrived': { closeLayer(); const undo = snapshot(), n = r.parts.filter(p => p.st === 'ORDERED').length; r.parts.forEach(p => { if (p.st === 'ORDERED') p.st = 'ARRIVED'; }); if (r.status === 'AWAITING_PARTS') r.status = 'IN_PROGRESS'; logEv(r, `marked ${plural(n, 'part')} arrived${r.status === 'IN_PROGRESS' ? ' · status In progress' : ''}`); render(); toast(`${plural(n, 'part')} arrived · ${esc(r.num)} is In progress`, undo); break; }
    case 'setstatus': { closeLayer(); const undo = snapshot(); r.status = el.dataset.v; logEv(r, `set status to ${MSTAT[r.status][0]}`); render(); toast(`${esc(r.num)} · ${MSTAT[r.status][0]}`, undo); break; }
    case 'complete': closeLayer(); state.cmp = { result: 'PASS', date: TODAY, labour: r.labour == null ? '' : String(r.labour), next: '', disp: {} }; completeDlg(); break;
    case 'cres': readComplete(); state.cmp.result = el.dataset.v; state.cmp.disp = {}; completeDlg(); break;
    case 'cgo': { readComplete(); const c = state.cmp; commitWrite(() => { r.status = 'COMPLETED'; r.done = c.date; r.result = c.result; r.labour = c.labour === '' ? null : +c.labour; r.next = c.next; r.disp = {}; r.assets.forEach(a => { r.disp[a.tag] = c.disp[a.tag] || (c.result === 'FAIL' ? 'KEEP_OUT_OF_SERVICE' : 'RETURN_TO_SERVICE'); }); syncMaint(r); const back = r.assets.filter(a => r.disp[a.tag] === 'RETURN_TO_SERVICE').map(a => a.tag), stay = r.assets.filter(a => r.disp[a.tag] !== 'RETURN_TO_SERVICE').map(a => a.tag); logEv(r, `completed it · ${RESN[c.result][0].toLowerCase()} · ${money(mCost(r))}${back.length ? ' · ' + back.join(', ') + ' back in service' : ''}${stay.length ? ' · ' + stay.join(', ') + ' kept out of service' : ''}`); return `${r.num} completed · ${RESN[c.result][0].toLowerCase()} · ${money(mCost(r))}${back.length ? ` · ${back.join(', ')} back in service` : ''}${stay.length ? ` · ${stay.join(', ')} kept out` : ''}`; }); break; }
    case 'reopen': { closeLayer(); const undo = snapshot(); r.status = 'IN_PROGRESS'; r.done = ''; r.result = ''; r.disp = {}; syncMaint(r); logEv(r, 'reopened it'); render(); toast(`${esc(r.num)} reopened · assets back out of service`, undo); break; }
    case 'canceljob': closeLayer(); dlgShell('Cancel', `Cancel ${esc(r.num)}?`, `<div class="t-small" style="line-height:1.55">The job stays on record as Cancelled. ${effList([`${r.assets.map(a => a.tag).join(', ')} go back in service as they are`, `${plural(r.parts.filter(p => p.st === 'ORDERED').length, 'part')} on order are not cancelled with the supplier`, 'History and photos are kept'])}</div>`, okBtn('canceljobgo', 'Cancel job', true)); break;
    case 'canceljobgo': commitWrite(() => { r.status = 'CANCELLED'; r.assets.forEach(a => { const p = POOL.find(x => x.tag === a.tag); if (p) { p.st = 'Available'; p.fl = ''; } }); logEv(r, 'cancelled it'); return `${r.num} cancelled · assets back in service`; }); break;
    case 'delmaintdlg': closeLayer(); dlgShell('Delete', `Delete ${esc(r.num)}?`, `<div class="t-small" style="line-height:1.55">Removes the record and its photos for good. Downstream:${effList([`${r.assets.map(a => a.tag).join(', ')} come back into service`, `${plural(r.parts.length, 'part line')} and ${money(mCost(r))} of cost leave the maintenance spend`, 'The asset history keeps its "reported a fault" line', '<b>This cannot be undone.</b> Cancel keeps the record instead'])}</div>`, okBtn('delmaintgo', `Delete ${r.num}`, true)); break;
    case 'delmaintgo': { const undo = snapshot(), n = r.num; r.assets.forEach(a => { const p = POOL.find(x => x.tag === a.tag); if (p) { p.st = 'Available'; p.fl = ''; } }); delete REC.maint[r.id]; closeLayer(); render(); toast(`${esc(n)} deleted`, undo); break; }
    case 'repairitem': { const it = r.items.find(i => i.id === id), undo = snapshot(), m = newMaint(`${it.name} — ${it.cond === 'Fair' ? 'battery door loose' : 'repair'}`, 'REPAIR', it.tag, it.name, addD(TODAY, 2), 'Tom Nguyen', `Raised from kit ${r.tag}.`); logEv(r, `booked ${m.num} for ${it.tag}`); render(); toast(`${m.num} booked for ${esc(it.tag)} · Tue 11 Nov`, undo); break; }
    case 'repairkit': { closeLayer(); const undo = snapshot(), m = newMaint(`Check ${r.name}`, 'INSPECTION', r.items[0].tag, r.items[0].name, addD(TODAY, 2), 'Tom Nguyen', `Raised from kit ${r.tag}.`); logEv(r, `booked ${m.num}`); render(); toast(`${m.num} booked · inspection`, undo); break; }
    // kit retire
    case 'retirekit': closeLayer(); dlgShell('Retire', `Retire ${esc(r.tag)}?`, retireKitText(r), `<button class="gh dng" disabled style="opacity:.4;cursor:default" title="Has history · retire instead">Delete permanently…</button>${okBtn('retirekitgo', `Retire ${r.tag}`, true).replace('<div style="flex:1"></div>', '<div style="flex:1"></div>')}`); break;
    case 'retirekitgo': commitWrite(() => { r.retired = true; const j = r.job; r.job = null; logEv(r, 'retired it'); return `${r.tag} retired · off the floor, history kept${j ? ` · ${j.id} is short by 1` : ''}`; }); break;
    case 'reinstate': { closeLayer(); const undo = snapshot(); r.retired = false; logEv(r, 'reinstated it'); render(); toast(`${esc(r.tag)} reinstated`, undo); break; }
    // test & tag
    case 'recordtest': closeLayer(); recordTestDlg(); break;
    case 'rtgo': {
      const v = lastRtVals(), e = $('#rt-err', body); if (v.earth === '' || v.ins === '' || v.leak === '') { e.textContent = 'Enter all three readings · a blank reading is not a zero'; break; }
      const t = { id: 't' + (r.tests.length + 10), at: v.date, who: v.who, vis: v.vis, earth: +v.earth, ins: +v.ins, leak: +v.leak }, ok = ttOk(t), undo = snapshot();
      r.tests.push(t); r.booked = null;
      if (!ok) { const m = newMaint(`Failed test & tag — ${r.tag}`, 'REPAIR', r.tag, r.model, TODAY, 'Tom Nguyen', `Test ${fmtL(v.date)}: earth ${v.earth} Ω, insulation ${v.ins} MΩ, leakage ${v.leak} mA.`); t.mt = m.num; const p = POOL.find(x => x.tag === r.tag); if (p) { p.st = 'In maintenance'; p.fl = 'T&T failed'; } logEv(r, `tested it · fail · raised ${m.num} and took it out of service`); closeLayer(); render(); toast(`${esc(r.tag)} failed · ${m.num} raised, kept out of service`, undo); }
      else { const p = POOL.find(x => x.tag === r.tag); if (p && p.fl.includes('T&T')) p.fl = ''; logEv(r, 'tested it · pass'); closeLayer(); render(); toast(`${esc(r.tag)} passed · next due ${fmtL(ttNext(r))}`, undo); }
      break; }
    case 'booktest': { closeLayer(); const undo = snapshot(), m = newMaint(`Test & tag — ${r.tag}`, 'TEST_AND_TAG', r.tag, r.model, addD(TODAY, 1), 'Tom Nguyen', `Raised from ${r.num}.`); r.booked = addD(TODAY, 1); logEv(r, `booked a test · ${m.num} for ${fmtD(r.booked)}`); render(); toast(`${m.num} booked for ${fmtD(r.booked)} · Tom Nguyen`, undo); break; }
    case 'retirett': closeLayer(); dlgShell('Retire', `Retire ${esc(r.num)}?`, `<div class="t-small" style="line-height:1.55">Takes ${esc(r.tag)} off the test &amp; tag register. Downstream:${effList([`${esc(r.tag)} stops showing as overdue and is no longer blocked from jobs for lack of a test`, 'The register, reports and every picker stop listing it', `${plural(r.tests.length, 'test')} and ${plural(r.files.length, 'certificate')} are kept`, 'Reinstate any time · delete is offered once it is retired'])}</div>`, okBtn('retirettgo', `Retire ${r.num}`, true)); break;
    case 'retirettgo': commitWrite(() => { r.retired = true; logEv(r, 'retired it'); return `${r.num} retired · off the register, tests kept`; }); break;
    case 'deltt': closeLayer(); dlgShell('Delete', `Delete ${esc(r.num)} permanently?`, `<div class="t-small" style="line-height:1.55">Removes the record, its ${plural(r.tests.length, 'test')} and certificates from the register. The asset ${esc(r.tag)} is untouched. <b>This cannot be undone.</b></div>`, okBtn('deltgo', `Delete ${r.num}`, true)); break;
    case 'deltgo': { const undo = snapshot(); delete REC.tt[r.id]; closeLayer(); render(); toast(`${esc(r.num)} deleted · this cannot be undone`, undo); break; }
    // location + category delete
    case 'dellocdlg': { closeLayer(); const P = locPool(r), kids = r.bin === undefined ? locChildren() : []; dlgShell('Delete', `Delete ${esc(r.name)}?`, `<div class="t-small" style="line-height:1.55">Removes the ${r.bin === undefined ? 'location' : 'bin'}. What happens to the things downstream:${effList([`${plural(P.length, 'asset')} lose their home and show <b>No location</b> until they are put away`, ...(kids.length ? [`${plural(kids.length, 'bin')} are deleted with it`] : []), ...(r.isDefault ? ['New assets will have no default location'] : []), ...(r.bin === undefined ? ['Jobs that load out of it keep their dates · their pick lists lose the address'] : []), 'Movement history is kept', '<b>This cannot be undone</b> · Undo is offered for a few seconds'])}</div>`, okBtn('dellocgo', `Delete ${r.name}`, true)); break; }
    case 'dellocgo': { const undo = snapshot(), n = r.name, isBin = r.bin !== undefined; if (isBin) { POOL.forEach(p => { if (p.bin === r.bin) p.bin = ''; }); delete REC.loc[r.id]; state.id = 'wa'; state.tab = 'bins'; } else { Object.keys(REC.loc).forEach(k => delete REC.loc[k]); } closeLayer(); render(); writeHash(); toast(`${esc(n)} deleted`, undo); break; }
    case 'delcat': closeLayer(); dlgShell('Delete', `Delete ${esc(r.name)}?`, `<div class="t-small" style="line-height:1.55">Removes the category. Downstream:${effList([`${plural(r.models.length, 'model')} and ${plural(r.kits.length, 'kit')} become <b>Uncategorised</b> · their assets and rates are untouched`, r.subs.length ? `${plural(r.subs.length, 'subcategory', 'subcategories')} move up to the top level` : 'No subcategories to move', 'Saved views and filters that name it stop matching', 'Quote sections keep their own names'])}</div>`, okBtn('delcatgo', `Delete ${r.name}`, true)); break;
    case 'delcatgo': { const undo = snapshot(), n = r.name; r.subs.forEach(s => { REC.cat[s].parent = ''; }); delete REC.cat[r.id]; closeLayer(); render(); writeHash(); toast(`${esc(n)} deleted`, undo); break; }
  }
}
const tabCfgBinsRun = () => '';

// ---------- listeners
document.addEventListener('input', ev => {
  const t = ev.target;
  if (t.id === 'q') { state.q = t.value; state.n = {}; const pos = t.selectionStart; renderView(); renderBulk(); const i = $('#q'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch (e) { /* number inputs */ } } }
  if (t.id === 'cd-q') { $('#cd-res', body).innerHTML = candList(t.value); }
  if (/^rt-/.test(t.id) && t.id !== 'rt-date' || t.id === 'rt-date') rtResult();
});
document.addEventListener('change', ev => { if (ev.target.id === 'rt-vis') rtResult(); });
document.addEventListener('keydown', ev => {
  const t = ev.target;
  if (ev.key === 'Enter' && t.id === 's-tag') { ev.preventDefault(); scanRead(t.value); }
  if (ev.key === 'Enter' && t.id === 'cd-q') { ev.preventDefault(); const first = $('#cd-res [data-act]', body); if (first) act(first.dataset.act, first); }
  if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey) && t.id === 'compose') act('post', t);
}, false);
window.addEventListener('keydown', ev => { // page keys replace the list-page '/', 'n' of the kit
  if (!['/', 'n', 'N', 'e'].includes(ev.key) || ev.metaKey || ev.ctrlKey || ev.target.matches('input,textarea,select') || $('#layer').classList.contains('open')) return;
  ev.stopImmediatePropagation(); ev.preventDefault();
  if (ev.key === '/') { const q = $('#q'); if (q) q.focus(); else act('scan', null); } else if (ev.key === 'e') act('edit', null);
}, true);
window.addEventListener('hashchange', () => { const o = state.type + state.id + state.tab; readHash(); if (o !== state.type + state.id + state.tab) { state.sel = {}; render(); } });
readHash();
render();
