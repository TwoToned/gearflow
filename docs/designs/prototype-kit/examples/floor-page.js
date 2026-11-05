// ============ The floor — warehouse floor + returning mode + pull sheet (prototype) ============
'use strict';
const TODAY = '2026-11-09';
const OV = 'https://claude.ai/artifact/RatKsWfTmDJLJHmn6mb7Zo', WH = 'https://claude.ai/artifact/Mt8p55xkPkkexVWPC5eaGU', JOBS = 'https://claude.ai/artifact/A7SMPtpTr3aedUDEnuSaxd', ASSETS = 'https://claude.ai/artifact/89PDTuMiovgP9i3h4MJ1Tw';
const ASSET = 'https://claude.ai/artifact/Rr5rwirCUMRy8gf5G6Vz7s';
const ME = 'Jayden Cole';
const PACKERS = ['Sam Okafor', 'Tom Nguyen', 'Dan Wu', 'Ash Reyes', 'Mia Rossi'];
const WDN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const wd = d => WDN[(new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7]; // fixture calendar: 11 Nov 2026 is a Tuesday
const addD = (d, n) => new Date((dayNum(d) + n) * 864e5).toISOString().slice(0, 10);
const dates = j => j.start === j.end ? fmtD(j.start) : fmtRange(j.start, j.end);
const short = n => { const [a, b] = n.split(' '); return a + ' ' + b[0] + '.'; };
const initials = n => n.split(' ').map(x => x[0]).join('');
const rnd = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(11);
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));

// ---------- the gear pool (the pull sheet's categories, shelves and tags)
const POOL = [
  { n: 'Martin MAC Aura PXL', cat: 'Lighting', shelf: 'B1-01', kind: 'ser', pre: 'L-', pad: 4, q: [4, 12] },
  { n: 'Martin MAC Aura XB', cat: 'Lighting', shelf: 'B1-02', kind: 'ser', pre: 'AURA-', pad: 2, q: [4, 8] },
  { n: 'Robe MegaPointe', cat: 'Lighting', shelf: 'B2-03', kind: 'ser', pre: 'RB-', pad: 3, q: [2, 6] },
  { n: 'ETC Source Four LED Series 3', cat: 'Lighting', shelf: 'B2-05', kind: 'ser', pre: 'S4-', pad: 3, q: [4, 10] },
  { n: 'grandMA3 compact console', cat: 'Lighting', shelf: 'B3-01', kind: 'ser', pre: 'MA-', pad: 2, q: [1, 1] },
  { n: 'd&b audiotechnik Y8 loudspeaker', cat: 'Audio', shelf: 'A1-02', kind: 'ser', pre: 'DB-', pad: 3, q: [4, 8] },
  { n: 'Sennheiser EW-DX SK beltpack', cat: 'Audio', shelf: 'A3-14', kind: 'ser', pre: 'SK-', pad: 4, q: [3, 8] },
  { n: 'Sennheiser EW-DX EM4 receiver', cat: 'Audio', shelf: 'A3-09', kind: 'ser', pre: 'A-', pad: 4, q: [1, 4] },
  { n: 'Shure ULXD4Q wireless kit', cat: 'Audio', shelf: 'A3-07', kind: 'kit', pre: 'K-', pad: 4, q: [1, 2], members: [['ULXD4Q quad receiver', 1], ['ULXD2/B58 handheld', 4]] },
  { n: 'Shure SM58 microphone', cat: 'Audio', shelf: 'A3-02', kind: 'ser', pre: 'SM-', pad: 3, q: [4, 10] },
  { n: 'Yamaha CL5 console', cat: 'Audio', shelf: 'A2-01', kind: 'ser', pre: 'CL-', pad: 2, q: [1, 1] },
  { n: 'Barco UDX-4K32 projector', cat: 'Video', shelf: 'V1-01', kind: 'ser', pre: 'V-', pad: 4, q: [1, 2] },
  { n: 'ROE Black Pearl BP2 LED panel', cat: 'Video', shelf: 'V2-04', kind: 'ser', pre: 'BP-', pad: 3, q: [6, 20] },
  { n: 'Blackmagic ATEM Mini Extreme', cat: 'Video', shelf: 'V1-06', kind: 'ser', pre: 'AT-', pad: 2, q: [1, 2] },
  { n: 'Motor 1 t chain hoist', cat: 'Rigging', shelf: 'R1-03', kind: 'ser', pre: 'CH-', pad: 3, q: [4, 12] },
  { n: '63 A power distro', cat: 'Power', shelf: 'P1-01', kind: 'ser', pre: 'PD-', pad: 3, q: [1, 3] },
  { n: 'SB900B rechargeable battery', cat: 'Audio', shelf: 'A4-01', kind: 'bulk', bin: 'B-SB900', q: [3, 12] },
  { n: 'Beltpack pouch', cat: 'Audio', shelf: 'A4-03', kind: 'bulk', bin: 'B-POUCH', q: [3, 12] },
  { n: 'XLR 10 m', cat: 'Cable', shelf: 'C1-01', kind: 'bulk', bin: 'B-XLR10', q: [3, 12] },
  { n: 'Powercon 5 m', cat: 'Cable', shelf: 'C1-04', kind: 'bulk', bin: 'B-PWC5', q: [3, 12] },
  { n: 'Cat6 50 m drum', cat: 'Cable', shelf: 'C2-02', kind: 'bulk', bin: 'B-CAT6', q: [3, 12] },
  { n: 'Black wrap', cat: 'Lighting', shelf: 'B4-02', kind: 'bulk', bin: 'B-WRAP', q: [3, 12] },
];
const CAT_ORDER = ['Lighting', 'Audio', 'Video', 'Rigging', 'Power', 'Cable'];
const KITMEM = { 'A-0192': 'K-0042', 'A-0193': 'K-0042' };
const SHELF = { 'AURA-90': ['Martin MAC Aura XB', 'B1-02'] };
const TAGC = { SK: 12, L: 1, AURA: 1, A: 301, K: 42, V: 11 };
let uidn = 1, lidn = 1;

// ---------- generate the jobs (lines own units; every count on a card is derived from them)
function mkUnits(p, qty, st) {
  return Array.from({ length: qty }, () => {
    if (p.kind === 'bulk') return { id: 'u' + uidn++, tag: null, st };
    const key = p.pre.replace('-', ''), n = TAGC[key] ?? 1; TAGC[key] = n + 1;
    return { id: 'u' + uidn++, tag: p.pre + String(n).padStart(p.pad, '0'), st };
  });
}
function mkLine(pi, qty, plan, end) {
  const p = POOL[pi], units = mkUnits(p, qty, 'pick');
  if (plan === 'packed') units.forEach(u => u.st = 'packed');
  else if (plan === 'out') units.forEach(u => u.st = 'out');
  else if (plan === 'back') units.forEach(u => { u.st = 'ok'; u.at = end; });
  else if (plan === 'part') { const k = Math.ceil(units.length / 2); units.forEach((u, i) => { if (i < k) { u.st = 'ok'; u.at = end; } else u.st = 'out'; }); }
  return { id: 'l' + lidn++, name: p.n, cat: p.cat, shelf: p.shelf, kind: p.kind, bin: p.bin, members: p.members, units };
}
function mkJob(m, idxs, plans, qOv = {}) {
  const lines = idxs.map((pi, i) => { const p = POOL[pi]; return mkLine(pi, qOv[pi] ?? ri(p.q[0], p.q[1]), plans[i], m.end); });
  return { done: false, pay: false, blocking: 0, ...m, lines };
}
const rep = (n, v) => Array(n).fill(v);
function buildJobs() {
  const J = [];
  const hilton = mkJob({ num: '2341', name: 'Hilton Sydney gala dinner', client: 'Hilton Sydney', start: '2026-11-12', end: '2026-11-14', truck: { d: '2026-11-11', t: '06:30', v: 'Van 2' }, packer: 'Sam Okafor', pm: ME },
    [0, 1, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], [...rep(4, 'packed'), 'pick', 'pick', ...rep(2, 'packed'), 'pick', ...rep(4, 'packed'), 'pick', ...rep(4, 'packed')], { 0: 12, 1: 8, 6: 6, 7: 2, 8: 2, 11: 1, 16: 24 });
  hilton.lines.forEach(l => { if (l.name.includes('EM4')) l.short = 2; });
  J.push(hilton);
  J.push(mkJob({ num: '2340', name: 'Launch night', client: 'Canva', start: '2026-11-13', end: '2026-11-13', truck: { d: '2026-11-12', t: '14:00', v: 'Van 1' }, packer: 'Tom Nguyen', pm: ME }, [1, 5, 6, 7, 9, 11, 12, 15, 18], rep(9, 'packed')));
  J.push(mkJob({ num: '2338', name: 'Corporate AGM', client: 'Atlassian', start: '2026-11-21', end: '2026-11-21', truck: { d: '2026-11-20', t: '07:00', v: 'Truck A' }, packer: null, pm: 'Tom Nguyen' }, [3, 5, 6, 9, 10, 11, 13, 15, 16, 17, 18, 19], rep(12, 'pick')));
  J.push(mkJob({ num: '2350', name: 'Qantas awards', client: 'Qantas', start: '2026-11-22', end: '2026-11-22', truck: { d: '2026-11-21', t: '08:00', v: 'Truck A' }, packer: null, pm: ME, pay: true }, [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 21], rep(20, 'pick')));
  J.push(mkJob({ num: '2344', name: 'Ogilvy product reveal', client: 'Ogilvy', start: '2026-11-11', end: '2026-11-11', truck: { d: '2026-11-10', t: '15:00', v: 'Van 2' }, packer: 'Dan Wu', pm: 'Tom Nguyen' }, [1, 5, 6, 9, 11, 12, 15, 18, 19, 20, 21], [...rep(8, 'packed'), ...rep(3, 'pick')]));
  J.push(mkJob({ num: '2346', name: 'UNSW open day', client: 'UNSW', start: '2026-11-11', end: '2026-11-11', truck: { d: '2026-11-10', t: '07:30', v: 'Van 1' }, packer: 'Ash Reyes', pm: 'Tom Nguyen' }, [5, 9, 10, 11, 15, 16, 18, 19], rep(8, 'pick')));
  J.push(mkJob({ num: '2347', name: 'Red Bull stage build', client: 'Red Bull', start: '2026-11-14', end: '2026-11-16', truck: { d: '2026-11-13', t: '06:00', v: 'Truck A' }, packer: 'Sam Okafor', pm: ME }, [0, 1, 2, 3, 4, 12, 14, 15, 16, 17, 18, 19, 20, 21, 13, 9], rep(16, 'packed')));
  J.push(mkJob({ num: '2345', name: 'Opera House talks', client: 'Sydney Opera House', start: '2026-11-12', end: '2026-11-12', truck: { d: '2026-11-11', t: '10:00', v: 'Van 1' }, packer: 'Mia Rossi', pm: 'Tom Nguyen' }, [5, 6, 9, 11, 18, 19], rep(6, 'packed')));
  J.push(mkJob({ num: '2349', name: 'Canva all-hands', client: 'Canva', start: '2026-11-18', end: '2026-11-18', truck: { d: '2026-11-17', t: '09:00', v: 'Van 2' }, packer: null, pm: 'Tom Nguyen' }, [5, 6, 9, 11, 18, 19, 20], rep(7, 'pick')));
  J.push(mkJob({ num: '2358', name: 'ICC Sydney conference', client: 'ICC Sydney', start: '2026-11-19', end: '2026-11-20', truck: { d: '2026-11-18', t: '12:00', v: 'Truck A' }, packer: 'Dan Wu', pm: ME, blocking: 1 }, [3, 5, 6, 7, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19], [...rep(5, 'packed'), ...rep(9, 'pick')]));
  // out
  J.push(mkJob({ num: '2333', name: 'UNSW graduation', client: 'UNSW', start: '2026-11-07', end: '2026-11-09', truck: { d: '2026-11-07', t: '06:00', v: 'Van 1' }, packer: 'Sam Okafor', pm: 'Tom Nguyen' }, [5, 6, 8, 9, 10, 11, 12, 15, 16, 17, 18, 19, 20, 21], rep(14, 'out')));
  J.push(mkJob({ num: '2329', name: 'Opera House Vivid install', client: 'Sydney Opera House', start: '2026-11-03', end: '2026-11-06', truck: { d: '2026-11-03', t: '07:00', v: 'Truck A' }, packer: 'Ash Reyes', pm: ME }, [0, 1, 2, 3, 4, 12, 14, 15, 16, 18, 19, 21], rep(12, 'out')));
  J.push(mkJob({ num: '2336', name: 'Atlassian town hall', client: 'Atlassian', start: '2026-11-08', end: '2026-11-10', truck: { d: '2026-11-08', t: '08:30', v: 'Van 2' }, packer: 'Dan Wu', pm: 'Tom Nguyen' }, [5, 6, 9, 11, 13, 15, 18, 19, 20], rep(9, 'out')));
  // returning
  const lnTour = mkJob({ num: '2331', name: 'Live Nation summer tour', client: 'Live Nation', start: '2026-11-05', end: '2026-11-08', truck: { d: '2026-11-05', t: '06:30', v: 'Truck A' }, packer: 'Sam Okafor', pm: ME, last: '09:12' }, [0, 6, 5, 7, 9, 11, 12, 13, 15, 16, 18, 19, 20, 21], [...rep(8, 'back'), 'part', ...rep(5, 'out')]);
  const pxl = lnTour.lines.find(l => l.name.includes('PXL')), sk = lnTour.lines.find(l => l.name.includes('beltpack'));
  pxl.units[2].st = 'dmg'; pxl.units[2].repair = true; sk.units[1].st = 'miss'; sk.units.slice(2, 4).forEach(u => u.at = '2026-11-09');
  J.push(lnTour);
  const og = mkJob({ num: '2327', name: 'Ogilvy town hall', client: 'Ogilvy', start: '2026-11-04', end: '2026-11-05', truck: { d: '2026-11-04', t: '07:00', v: 'Van 2' }, packer: 'Dan Wu', pm: 'Tom Nguyen', last: '08:41' }, [5, 6, 9, 10, 11, 13, 15, 16, 18, 19, 20], rep(11, 'back'));
  og.lines[1].units.forEach(u => u.at = '2026-11-07'); og.lines[4].units[0].st = 'dmg';
  J.push(og);
  J.push(mkJob({ num: '2325', name: 'Red Bull trade show', client: 'Red Bull', start: '2026-11-01', end: '2026-11-02', truck: { d: '2026-11-01', t: '07:30', v: 'Van 1' }, packer: 'Mia Rossi', pm: 'Tom Nguyen', last: '08:20' }, [0, 1, 5, 12, 15, 16, 18, 19, 20, 21], rep(10, 'back')));
  return J;
}

// ---------- state
const state = { mode: 'board', scope: 'week', rscope: 'out', stage: 'all', f: { packer: [], client: [], flags: [], job: [] }, needsMe: false,
  q: '', jobs: buildJobs(), selJobs: new Set(), selRows: new Set(), lastSel: null, strip: [], showRecent: false, hit: null, page: 0, size: 25, expanded: new Set(),
  sound: true, offline: false, queue: [], lastWrite: 0, undo: null, sel: null };
let stripSeq = 1, wseq = 0;

// ---------- derived (nothing below is stored)
const lineSt = l => l.units.some(u => u.st === 'pick') ? 'pick' : l.units.some(u => u.st === 'packed') ? 'packed' : l.units.some(u => u.st === 'out') ? 'out' : 'back';
const isBack = u => u.st === 'ok' || u.st === 'dmg' || u.st === 'miss';
function counts(j) {
  const c = { pick: 0, packed: 0, lines: j.lines.length, items: 0, out: 0, back: 0 };
  for (const l of j.lines) { const s = lineSt(l); if (s === 'pick') c.pick++; else if (s === 'packed') c.packed++; for (const u of l.units) { c.items++; if (u.st === 'out') c.out++; else if (isBack(u)) c.back++; } }
  return c;
}
function stageOf(j) { if (j.done) return null; const c = counts(j); if (c.back > 0) return 'returning'; if (c.out > 0) return 'out'; if (c.pick === 0) return 'ready'; if (c.packed > 0) return 'prepping'; return 'topick'; }
const STAGES = [['topick', 'To pick', 'var(--faint)'], ['prepping', 'Prepping', 'var(--ink-2)'], ['ready', 'Ready', 'var(--info)'], ['out', 'Out', 'var(--t-out)'], ['returning', 'Returning', 'var(--warn)']];
const preOut = s => s === 'topick' || s === 'prepping' || s === 'ready';
const overdueDays = j => { const c = counts(j); return c.out > 0 && j.end < TODAY ? dayNum(TODAY) - dayNum(j.end) : 0; };
const closeable = j => stageOf(j) === 'returning' && counts(j).out === 0;
function flagsOf(j) {
  const f = [], st = stageOf(j), c = counts(j);
  const sh = j.lines.filter(l => lineSt(l) === 'pick').reduce((a, l) => a + (l.short || 0), 0); if (sh) f.push({ k: 'short', cls: 'err', t: `short ${sh}` });
  const od = overdueDays(j); if (od) f.push({ k: 'overdue', cls: 'err', t: `${od}d overdue` });
  if (j.pay && preOut(st)) f.push({ k: 'pay', cls: 'warn', t: 'awaiting payment' });
  if (j.blocking) f.push({ k: 'blocking', cls: 'err', t: `${j.blocking} blocking` });
  const dm = j.lines.reduce((a, l) => a + l.units.filter(u => u.st === 'dmg').length, 0), ms = j.lines.reduce((a, l) => a + l.units.filter(u => u.st === 'miss').length, 0);
  if (dm) f.push({ k: 'damaged', cls: 'warn', t: `${dm} damaged` }); if (ms) f.push({ k: 'damaged', cls: 'err', t: `${ms} missing` });
  return f;
}
const flagHtml = (j, sep = '') => flagsOf(j).map(x => `<span class="dotw ${x.cls}">${x.t}</span>`).join(sep);
const needsMe = j => flagsOf(j).length > 0 || (preOut(stageOf(j)) && !j.packer) || closeable(j);
function inScope(j) {
  const s = stageOf(j); if (state.scope === 'all') return true;
  if (state.scope === 'mine') return j.pm === ME || j.packer === ME;
  const lim = state.scope === 'today' ? 1 : 6;
  if (preOut(s)) return dayNum(j.truck.d) - dayNum(TODAY) <= lim;
  if (s === 'out') return dayNum(j.end) - dayNum(TODAY) <= lim;
  return true;
}
function matches(j, ignoreScope) {
  if (j.done) return false;
  if (!ignoreScope && !inScope(j)) return false;
  const f = state.f;
  if (f.packer.length && !f.packer.includes(j.packer || 'Unassigned')) return false;
  if (f.client.length && !f.client.includes(j.client)) return false;
  if (f.flags.length && !flagsOf(j).some(x => f.flags.includes(x.k))) return false;
  if (state.needsMe && !needsMe(j)) return false;
  const q = state.q.trim().toLowerCase();
  if (q) { const r = resolveTag(q); if (r && r.kind !== 'unknown' && r.kind !== 'job') return true; if (!(j.name + ' ' + j.num + ' ' + j.client).toLowerCase().includes(q)) return false; }
  return true;
}
const boardJobs = () => state.jobs.filter(j => matches(j));
const byStage = (jobs, k) => jobs.filter(j => stageOf(j) === k).sort((a, b) => k === 'out' || k === 'returning' ? a.end.localeCompare(b.end) : (a.truck.d + a.truck.t).localeCompare(b.truck.d + b.truck.t));
const orderedJobs = () => { const js = boardJobs(); return STAGES.flatMap(([k]) => byStage(js, k)); };
const job = id => state.jobs.find(j => j.id === id || j.num === id);
state.jobs.forEach(j => j.id = 'j' + j.num);
const unitInfo = id => { for (const j of state.jobs) for (const l of j.lines) { const u = l.units.find(x => x.id === id); if (u) return { j, l, u }; } return null; };
const lateDays = (j, u) => u.st === 'out' ? (j.end < TODAY ? dayNum(TODAY) - dayNum(j.end) : 0) : (isBack(u) && u.at && u.at > j.end ? dayNum(u.at) - dayNum(j.end) : 0);
const ST = { ok: 'returned', dmg: 'damaged', miss: 'missing', out: 'out' };
// returning mode
const returnable = j => !j.done && j.lines.some(l => l.units.some(u => u.st === 'out' || isBack(u)));
function rowStats(j, l) { const s = { out: 0, ok: 0, dmg: 0, miss: 0, late: 0, n: l.units.length }; for (const u of l.units) { if (u.st in s) s[u.st]++; const d = lateDays(j, u); if (d > s.late) s.late = d; } return s; }
function rowMatch(j, l) {
  const s = rowStats(j, l), k = state.rscope;
  if (k === 'out') return s.out > 0; if (k === 'returned') return s.ok > 0; if (k === 'damaged') return s.dmg > 0; if (k === 'missing') return s.miss > 0; if (k === 'late') return s.late > 0; return true;
}
function rjobs() { return state.jobs.filter(j => returnable(j) && (!state.f.job.length || state.f.job.includes(j.id)) && (!state.f.client.length || state.f.client.includes(j.client))).sort((a, b) => a.end.localeCompare(b.end)); }
function rrows() {
  const out = []; for (const j of rjobs()) { const ls = j.lines.filter(l => rowMatch(j, l) && (l.units.some(u => u.st === 'out' || isBack(u)))); if (ls.length) out.push({ j, ls }); }
  return out;
}
const flatRows = () => rrows().flatMap(g => g.ls.map(l => ({ j: g.j, l })));
function rcounts() {
  const c = { out: 0, returned: 0, damaged: 0, missing: 0, late: 0 };
  for (const j of rjobs()) for (const l of j.lines) for (const u of l.units) { if (u.st === 'out') c.out++; if (u.st === 'ok') c.returned++; if (u.st === 'dmg') c.damaged++; if (u.st === 'miss') c.missing++; if (lateDays(j, u) > 0) c.late++; }
  return c;
}
const totalOut = () => state.jobs.filter(j => !j.done).reduce((a, j) => a + counts(j).out, 0);

// ---------- snapshot / undo (one closure per write, handed to the toast AND the strip)
const clone = x => JSON.parse(JSON.stringify(x));
function snapshot() {
  const s = clone(state.jobs), k = ++wseq; state.lastWrite = k; let done = false;
  const fn = () => { if (done) return; done = true; state.jobs = clone(s); state.selJobs.clear(); state.selRows.clear(); state.lastWrite = 0; state.strip = state.strip.filter(e => !(e.undo && e.undo.k === k)); render(); };
  fn.k = k; return fn;
}
function pushStrip(tone, tag, name, text, undo, extra = {}) {
  state.strip.unshift({ k: stripSeq++, tone, tag, name, text, undo: undo || null, ...extra }); state.strip = state.strip.slice(0, 8);
}

// ---------- scan pipeline (one resolver; board mode looks up, returning mode receives)
function resolveTag(raw) {
  const t = String(raw || '').trim().toUpperCase().replace(/^#/, ''); if (!t) return null;
  const live = state.jobs.filter(j => !j.done);
  const jb = live.find(j => j.num === t); if (jb) return { kind: 'job', j: jb };
  for (const j of live) for (const l of j.lines) for (const u of l.units) if (u.tag === t) return { kind: 'unit', j, l, u };
  const bins = []; for (const j of live) for (const l of j.lines) if (l.bin === t) bins.push({ j, l });
  if (bins.length) return { kind: 'bulk', t, bins };
  if (KITMEM[t]) return { kind: 'member', t, kit: KITMEM[t] };
  if (SHELF[t]) return { kind: 'shelf', t, a: SHELF[t] };
  return { kind: 'unknown', t };
}
function ensureVisible(j) { if (!matches(j)) { state.scope = 'all'; state.f = { packer: [], client: [], flags: [], job: [] }; state.needsMe = false; state.q = ''; state.stage = 'all'; } }
function doScan(raw) {
  const r = resolveTag(raw); if (!r) return;
  if (state.offline) { state.queue.push(raw); pushStrip('neu', r.t || raw.toUpperCase(), '', `saved on device · syncing · ${state.queue.length} waiting`); state.q = ''; $('#q').value = ''; render(); return; }
  state.hit = null; state.q = ''; $('#q').value = '';
  if (state.mode === 'returning') scanReturning(r); else scanBoard(r);
  state.hitScroll = !!state.hit; render(); const ci = $('#camres'); if (ci) ci.innerHTML = camResult();
}
const stageName = j => (STAGES.find(s => s[0] === stageOf(j)) || [])[1];
function scanBoard(r) {
  if (r.kind === 'job') { ensureVisible(r.j); state.hit = r.j.id; const c = counts(r.j); pushStrip('info', '#' + r.j.num, r.j.name, `${stageName(r.j)} · ${c.lines} lines · ${c.pick} to pick`, null, { acts: [{ label: 'Open', act: 'openjob', args: `data-id="${r.j.id}"`, primary: false }] }); return; }
  if (r.kind === 'unit') {
    const { j, l, u } = r; ensureVisible(j); state.hit = j.id; const nm = `#${j.num} ${j.name}`, open = { label: 'Open', act: 'openjob', args: `data-id="${j.id}"` };
    if (u.st === 'out') { const d = lateDays(j, u); pushStrip(d ? 'warn' : 'info', u.tag, l.name, `out on ${nm} · due back ${wd(j.end)} ${fmtD(j.end)}${d ? ` · ${d}d late` : ''}`, null, { acts: [{ label: 'Receive', act: 'receiveunit', args: `data-u="${u.id}"`, primary: true }, open] }); }
    else if (isBack(u)) pushStrip('neu', u.tag, l.name, `already back from ${nm} · ${ST[u.st]} ${fmtD(u.at)}`, null, { acts: [{ ...open, primary: false }] });
    else if (u.st === 'packed') pushStrip('info', u.tag, l.name, `packed for ${nm} · truck ${wd(j.truck.d)} ${j.truck.t}`, null, { acts: [{ ...open, primary: false }] });
    else pushStrip('neu', u.tag, l.name, `to pick for ${nm} · shelf ${l.shelf}`, null, { acts: [{ ...open, primary: false }] });
    return;
  }
  if (r.kind === 'bulk') {
    const outBins = r.bins.filter(b => b.l.units.some(u => u.st === 'out')), n = outBins.reduce((a, b) => a + b.l.units.filter(u => u.st === 'out').length, 0), nm = r.bins[0].l.name;
    if (outBins.length) pushStrip('info', r.t, nm, `${n} out on ${outBins.length} job${outBins.length > 1 ? 's' : ''}`, null, { acts: [{ label: 'Receive…', act: 'bulkpick', args: `data-t="${r.t}"`, primary: false }] });
    else { const b = r.bins[0]; ensureVisible(b.j); state.hit = b.j.id; pushStrip('neu', r.t, nm, `nothing out · on the shelf or packed for ${r.bins.length} job${r.bins.length > 1 ? 's' : ''}`, null, { acts: [{ label: 'Open', act: 'openjob', args: `data-id="${b.j.id}"`, primary: false }] }); }
    return;
  }
  guardStrip(r);
}
function guardStrip(r) {
  if (r.kind === 'member') pushStrip('warn', r.t, 'Kit member', `part of kit ${r.kit} · scan the kit instead`);
  else if (r.kind === 'shelf') pushStrip('neu', r.t, r.a[0], `on the shelf ${r.a[1]} · not on a job`);
  else pushStrip('err', r.t, '', 'unknown tag · not in this organisation', null, { acts: [{ label: 'Register', act: 'noop', args: '' }] });
}
function scanReturning(r) {
  if (r.kind === 'job') { state.f.job = [r.j.id]; state.rscope = 'out'; state.page = 0; pushStrip('info', '#' + r.j.num, r.j.name, `showing ${counts(r.j).out} items still out`); return; }
  if (r.kind === 'unit') {
    const { j, l, u } = r;
    if (u.st === 'out') { returnUnits([u.id], 'ok', true); return; }
    if (isBack(u)) { pushStrip('neu', u.tag, l.name, `already back · ${ST[u.st]} ${fmtD(u.at)} on #${j.num}`, null, { uid: u.id, outcome: true }); return; }
    pushStrip('warn', u.tag, l.name, `not checked out · it is ${u.st === 'packed' ? 'packed' : 'still to pick'} for #${j.num} ${j.name}`); return;
  }
  if (r.kind === 'bulk') {
    const outBins = r.bins.filter(b => b.l.units.some(u => u.st === 'out'));
    if (!outBins.length) { pushStrip('warn', r.t, r.bins[0].l.name, 'not checked out anywhere'); return; }
    if (outBins.length === 1) { returnUnits(outBins[0].l.units.filter(u => u.st === 'out').map(u => u.id), 'ok', true, r.t); return; }
    pushStrip('info', r.t, r.bins[0].l.name, `out on ${outBins.length} jobs · choose which`, null, { acts: [{ label: 'Choose job', act: 'bulkpick', args: `data-t="${r.t}"`, primary: false }] });
    bulkPick(r.t); return;
  }
  if (r.kind === 'shelf') { pushStrip('warn', r.t, r.a[0], 'not currently checked out anywhere'); return; }
  guardStrip(r);
}
// the one write behind every return: strip entry + toast share the same undo closure
function returnUnits(ids, st, fromScan, bin) {
  const first = unitInfo(ids[0]); if (!first) return;
  const undo = snapshot(); let late = 0;
  for (const id of ids) { const x = unitInfo(id); if (!x || x.u.st === st) continue; x.u.st = st; x.u.at = TODAY; if (st !== 'dmg') delete x.u.repair; late = Math.max(late, lateDays(x.j, x.u)); }
  const { j, l } = first, backN = l.units.filter(isBack).length, many = ids.length > 1;
  const tone = st === 'miss' ? 'err' : st === 'dmg' || late ? 'warn' : 'ok';
  const what = st === 'ok' ? 'returned' : ST[st];
  const text = `${what} ${many ? `${ids.length} items ` : ''}to #${j.num} ${j.name} · ${backN} of ${l.units.length} back${late ? ` · ${late}d late` : ''}`;
  if (fromScan) pushStrip(tone, bin || first.u.tag || '', l.name, text, undo, { uid: first.u.id, outcome: true });
  render(); toast(`${esc(bin || first.u.tag || l.name)} ${what}${many ? ` · ${ids.length} items` : ''}`, undo);
}
function bulkPick(t) {
  const bins = state.jobs.filter(j => !j.done).flatMap(j => j.lines.filter(l => l.bin === t && l.units.some(u => u.st === 'out')).map(l => ({ j, l })));
  if (!bins.length) return;
  openDialog(`<div class="hd"><div style="display:flex;align-items:center;gap:8px"><span class="mono" style="font-weight:700">${esc(t)}</span><span class="dotw info">Out on ${bins.length} jobs</span></div><h2 style="font-size:18px">Which job is this coming back from?</h2><div class="t-small muted" style="margin-top:4px">${esc(bins[0].l.name)} has no serials: say how many.</div></div><div class="bd">${bins.map(({ j, l }) => { const n = l.units.filter(u => u.st === 'out').length; return `<div class="gate"><div style="min-width:0"><div class="ell" style="font-weight:600">#${j.num} ${esc(j.name)}</div><div class="t-small muted">${n} out · due ${fmtD(j.end)}${overdueDays(j) ? ` · <span style="color:var(--t-out)">${overdueDays(j)}d overdue</span>` : ''}</div></div><div class="ib" style="gap:8px"><input type="number" min="1" max="${n}" value="${n}" id="bq-${l.id}" style="width:64px;height:34px;text-align:center" aria-label="Quantity"><button class="btn btn-secondary btn-sm" data-act="bulkret" data-l="${l.id}">Return</button></div></div>`; }).join('')}</div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button></div>`);
}

// ---------- render
function render() {
  const ph = isPhone();
  document.title = state.mode === 'returning' ? 'Returning · RVLT Flow' : 'The floor · RVLT Flow';
  renderNav('Warehouse'); wireNav(); renderHead(); renderStrip(ph); renderToolbar(ph); renderDock();
  if (state.mode === 'board') { renderBoard(); renderListBoard(); } else { renderReturning(); renderListReturning(); }
  renderFoot(); renderBulk();
  if (state.hitScroll) { state.hitScroll = false; const hit = $(isPhone() ? '.lrow.hit' : '.fcard.hit'); if (hit) hit.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
}
let navWired = false;
function wireNav() {
  if (navWired) return; navWired = true;
  const hrefs = { Dashboard: 'https://claude.ai/artifact/RPnGj7WnaWcknvQ8ShcRkf', Jobs: JOBS, Finance: 'https://claude.ai/artifact/5VnYTVW2pdA5r1qBRvdrom', Crew: 'https://claude.ai/artifact/LPdsNGb4CRMfS6qk7j7Fsa', Assets: ASSETS };
  document.querySelectorAll('#sidenav a').forEach(a => { const n = a.textContent.trim(); if (hrefs[n]) a.href = hrefs[n]; });
  const s = document.querySelector('.sidebar .foot a'); if (s) s.href = 'https://claude.ai/artifact/Q3TeWuQPjzvXbAtmUV8Hg8';
  const bn = document.querySelectorAll('.bottomnav a');
  bn.forEach(a => { const h = a.getAttribute('href'); if (h === '#home') a.href = 'https://claude.ai/artifact/RPnGj7WnaWcknvQ8ShcRkf'; if (h === '#jobs') a.href = JOBS; if (h === '#assets') a.href = ASSETS; if (h === '#warehouse') a.classList.add('on'); if (h === '#scan') a.setAttribute('data-act', 'camera'); });
  $('#camBtn').innerHTML = ICON.cam;
}
function renderHead() {
  const ret = state.mode === 'returning', live = state.jobs.filter(j => !j.done);
  $('#ttl').textContent = ret ? 'Returning' : 'The floor';
  document.querySelector('.crumb').innerHTML = `<a href="#warehouse" style="color:var(--muted)">Warehouse</a><span>›</span>${ret ? '<a href="#floor" data-act="togglemode" style="color:var(--muted)">The floor</a><span>›</span><b>Returning</b>' : '<b>The floor</b>'}`;
  document.querySelector('.phonehead .ell').textContent = ret ? 'Returning' : 'The floor';
  const od = live.filter(j => overdueDays(j)).length, rc = rcounts();
  if (ret) {
    $('#count').textContent = rcounts().out; $('#sub').innerHTML = `Scan anything coming back, from any job · every outcome has Undo${rc.late ? ` · <span class="dotw err" style="margin-left:6px">${rc.late} late</span>` : ''}`;
    $('#phonesub').textContent = `${rc.out} items out · ${rc.late} late`;
  } else {
    const nx = live.filter(j => preOut(stageOf(j))).sort((a, b) => (a.truck.d + a.truck.t).localeCompare(b.truck.d + b.truck.t))[0];
    $('#count').textContent = boardJobs().length;
    $('#sub').innerHTML = `9 Nov${nx ? ` · next truck ${wd(nx.truck.d)} ${nx.truck.t} <span class="mono">#${nx.num}</span>` : ''}${od ? ` · <span class="dotw err" style="margin-left:6px">${od} jobs overdue</span>` : ''}`;
    $('#phonesub').textContent = `${boardJobs().length} jobs · ${od} overdue`;
  }
}
const SCOPES = [['today', 'Today'], ['week', 'This week'], ['mine', 'Mine'], ['all', 'All']];
function scopeCount(k) { const keep = state.scope; state.scope = k; const n = state.jobs.filter(j => matches(j)).length; state.scope = keep; return n; }
function renderStrip(ph) {
  const el = $('#strip');
  if (state.mode === 'returning') {
    const c = rcounts();
    el.innerHTML = `<button class="back" data-act="togglemode">‹ The floor</button>` + [['out', 'Out'], ['returned', 'Returned'], ['damaged', 'Damaged'], ['missing', 'Missing'], ['late', 'Late']].map(([k, n]) => `<button class="${state.rscope === k ? 'on' : ''}" data-act="rscope" data-k="${k}" style="${(k === 'missing' || k === 'late') && c[k] ? 'color:var(--t-out)' : ''}">${n} <span class="n">${c[k]}</span></button>`).join('');
    return;
  }
  if (ph) {
    const js = boardJobs();
    el.innerHTML = `<button class="${state.stage === 'all' ? 'on' : ''}" data-act="stage" data-k="all">All <span class="n">${js.length}</span></button>` + STAGES.map(([k, n]) => `<button class="${state.stage === k ? 'on' : ''}" data-act="stage" data-k="${k}">${n} <span class="n">${js.filter(j => stageOf(j) === k).length}</span></button>`).join('');
  } else {
    el.innerHTML = SCOPES.map(([k, n]) => `<button class="${state.scope === k ? 'on' : ''}" data-act="scope" data-k="${k}">${n} <span class="n">${scopeCount(k)}</span></button>`).join('') + `<button class="go" data-act="togglemode">Returning <span class="n">${totalOut()}</span></button>`;
  }
}
function fval(arr, nameOf = x => x) { return arr.length ? (arr.length > 1 ? arr.length + ' chosen' : nameOf(arr[0])) : ''; }
function renderToolbar(ph) {
  const f = state.f, any = f.packer.length || f.client.length || f.flags.length || f.job.length || state.needsMe || state.q;
  let w = '';
  if (state.mode === 'board') {
    if (ph) w += SCOPES.map(([k, n]) => `<button class="fw scp ${state.scope === k ? 'on' : ''}" data-act="scope" data-k="${k}">${n}</button>`).join('');
    w += filterWord('Packer', 'packer', fval(f.packer), 'fmenu') + filterWord('Client', 'client', fval(f.client), 'fmenu') + filterWord('Flags', 'flags', fval(f.flags, k => FLAGNAMES[k]), 'fmenu');
    if (state.needsMe) w += `<button class="fw on" data-act="needsme">Only what needs me</button>`;
  } else {
    w += filterWord('Job', 'job', fval(f.job, id => '#' + job(id).num), 'fmenu') + filterWord('Client', 'client', fval(f.client), 'fmenu');
  }
  if (any) w += `<button class="lnk muted" data-act="clearf">Clear</button>`;
  $('#fwords').innerHTML = w;
  $('#views').innerHTML = state.mode === 'board' ? `<button class="fw" data-act="selallvis">${orderedJobs().length && orderedJobs().every(j => state.selJobs.has(j.id)) ? 'Clear selection' : 'Select all ' + orderedJobs().length}</button>` : '';
}
const FLAGNAMES = { short: 'Short', overdue: 'Overdue', pay: 'Awaiting payment', blocking: 'Blocking', damaged: 'Damaged or missing' };
function renderDock() {
  const ret = state.mode === 'returning';
  $('#q').placeholder = ret ? 'Scan anything coming back…' : (isPhone() ? 'Scan a tag, or type a job…' : 'Scan a tag, or type a job number or client…');
  $('#dockchip').innerHTML = `<span class="deskonly">Any job ·</span> ${ret ? 'Receive' : 'Look up'} ▾`;
  $('#dockoff').textContent = state.offline ? `Offline · ${state.queue.length} waiting` : '';
  const arr = state.strip, last = arr[0]; let h = '';
  if (last) {
    const canUndo = last.undo && state.lastWrite === last.undo.k;
    h += `<div class="result ${last.tone}"><div class="grow"><div class="rt"><span class="tg">${esc(last.tag)}</span><span class="ell" style="font-weight:600">${esc(last.name)}</span></div><div class="how">${esc(last.text)}</div></div>${canUndo ? `<button class="btn btn-secondary btn-sm" data-act="stripundo" data-k="${last.k}">${UNDOI} Undo</button>` : ''}${last.outcome && unitInfo(last.uid) ? `<button class="btn btn-secondary btn-sm" data-act="outcomemenu" data-u="${last.uid}">Outcome ▾</button>` : ''}${(last.acts || []).map(a => `<button class="btn ${a.primary ? 'btn-primary' : 'btn-secondary'} btn-sm" data-act="${a.act}" ${a.args}>${a.label}</button>`).join('')}<button class="btn btn-icon btn-sm" data-act="stripclose" aria-label="Dismiss">✕</button></div>`;
    if (arr.length > 1) h += `<div class="recent"><button class="lnk muted" style="align-self:flex-start" data-act="recent">${state.showRecent ? 'Hide recent' : `Recent ${arr.length - 1}`} ${state.showRecent ? '▴' : '▾'}</button>${state.showRecent ? arr.slice(1, 6).map(e => `<div class="rr"><span class="mono">${esc(e.tag)}</span><span>${esc(e.text)}</span></div>`).join('') : ''}</div>`;
  }
  $('#result').innerHTML = h;
}
const UNDOI = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/></svg>';

// ----- board (desktop) and cards (phone)
function cardFacts(j) {
  const s = stageOf(j), c = counts(j); let fx, pct, live = false;
  if (s === 'topick') { fx = `<span class="mono">${c.lines} lines</span><span class="muted">·</span><span>${c.pick} to pick</span>`; pct = (c.lines - c.pick) / c.lines; }
  else if (s === 'prepping') { fx = `<span class="mono">${c.lines} lines</span><span class="muted">·</span><span>${c.pick} to pick</span>`; pct = (c.lines - c.pick) / c.lines; }
  else if (s === 'ready') { fx = `<span class="mono">${c.lines} lines</span><span class="muted">·</span><span>all packed</span>`; pct = 1; }
  else if (s === 'out') { fx = `<span class="mono">${c.out} items</span><span class="muted">·</span><span>out</span>`; pct = 0; live = true; }
  else { fx = c.out ? `<span class="mono">${c.back} of ${c.items}</span><span class="muted">items back</span>` : `<span class="mono">${c.items} items</span><span class="muted">·</span><span>all back</span>`; pct = c.back / c.items; }
  return { fx, pct: Math.round(pct * 100), live };
}
function cardWho(j) {
  const s = stageOf(j);
  if (preOut(s)) return `<div class="who"><span class="mono" style="color:var(--ink-2)">Truck ${wd(j.truck.d)} ${j.truck.t}</span><span>·</span><span>${j.truck.v}</span></div><div class="who">${j.packer ? `<span class="av" style="width:16px;height:16px;font-size:8px">${initials(j.packer)}</span><span class="ell">${esc(short(j.packer))}</span>` : `<span class="dotw warn">no packer</span>`}</div>`;
  if (s === 'out') return `<div class="who"><span class="mono" style="color:var(--ink-2)">Left ${wd(j.truck.d)} ${j.truck.t}</span><span>·</span><span>${j.truck.v}</span></div>`;
  return `<div class="who"><span>Last scan <span class="mono" style="color:var(--ink-2)">${j.last || '—'}</span></span></div>`;
}
function fcard(j) {
  const sel = state.selJobs.has(j.id), f = cardFacts(j), fl = flagHtml(j);
  return `<div class="fcard ${sel ? 'sel' : ''} ${state.hit === j.id ? 'hit' : ''}" data-act="open" data-id="${j.id}"><div class="cr1"><button class="cb ${sel ? 'on' : ''}" data-act="select" data-id="${j.id}" aria-label="Select #${j.num}"></button><span class="mono t-small muted">#${j.num}</span><button class="dots" data-act="rowmenu" data-id="${j.id}" aria-label="Job actions">${ICON.dots}</button></div><div class="ttl ell">${esc(j.name)}</div><div class="sub ell">${esc(j.client)} · <span class="mono">${dates(j)}</span></div><div class="fx">${f.fx}</div><div class="mini ${f.live ? 'live' : ''}"><i style="width:${f.pct}%"></i></div>${cardWho(j)}${fl ? `<div class="flags">${fl}</div>` : ''}</div>`;
}
function renderBoard() {
  $('#tblwrap').innerHTML = ''; const js = boardJobs();
  const any = state.jobs.some(j => !j.done);
  if (!js.length) { $('#board').innerHTML = `<div class="empty">${any ? `<b>Nothing matches</b>Loosen a filter or widen the scope. <button class="lnk" data-act="clearf">Clear filters</button>` : `<b>The floor is clear</b>Jobs land here the moment they are confirmed and ready to prep.`}</div>`; return; }
  $('#board').innerHTML = `<div class="fboard">${STAGES.map(([k, n, dc]) => { const cs = byStage(js, k); return `<div class="fcol"><div class="bhead"><span class="dotw" style="--dc:${dc}">${n}</span><span class="n">${cs.length}</span></div>${cs.map(fcard).join('') || '<div class="bempty">Nothing here</div>'}</div>`; }).join('')}</div>`;
}
function renderListBoard() {
  const js = boardJobs(); let h = '', shown = 0; const cap = (state.page + 1) * state.size, total = js.filter(j => state.stage === 'all' || stageOf(j) === state.stage).length;
  for (const [k, n, dc] of STAGES) {
    if (state.stage !== 'all' && state.stage !== k) continue;
    const cs = byStage(js, k); if (!cs.length) continue;
    h += `<div class="lhead"><span class="dotw" style="--dc:${dc}">${n}</span><span class="n">${cs.length}</span></div>`;
    for (const j of cs) { if (shown++ >= cap) break; h += lrow(j); }
  }
  if (!h) h = `<div class="empty"><b>Nothing matches</b><button class="lnk" data-act="clearf">Clear filters</button></div>`;
  if (total > cap) h += `<button class="lrow" data-act="more" style="justify-content:center;color:var(--blue);font-weight:600">Show ${Math.min(state.size, total - cap)} more · ${total - cap} left</button>`;
  $('#list').innerHTML = h;
}
function lrow(j) {
  const sel = state.selJobs.has(j.id), c = counts(j), s = stageOf(j), fl = flagsOf(j);
  const right = s === 'topick' || s === 'prepping' ? `${c.pick} to pick` : s === 'ready' ? 'all packed' : s === 'out' ? `${c.out} out` : (c.out ? `${c.back} of ${c.items} back` : 'all back');
  const sub2 = preOut(s) ? `Truck ${wd(j.truck.d)} <span class="mono">${j.truck.t}</span> · ${j.packer ? esc(short(j.packer)) : '<span class="dotw warn" style="font-size:12px">no packer</span>'}` : s === 'out' ? `Left ${wd(j.truck.d)} <span class="mono">${j.truck.t}</span> · ${j.truck.v}` : `Last scan <span class="mono">${j.last || '—'}</span>`;
  return `<div class="lrow ${sel ? 'sel' : ''} ${state.hit === j.id ? 'hit' : ''}" data-act="open" data-id="${j.id}"><button class="cb ${sel ? 'on' : ''}" data-act="select" data-id="${j.id}" aria-label="Select #${j.num}"></button><div class="grow" style="min-width:0"><div class="ttl ell">${esc(j.name)}</div><div class="sub ell"><span class="mono">#${j.num}</span> · ${esc(j.client)} · <span class="mono">${dates(j)}</span></div><div class="sub ell">${sub2}</div></div><div class="right"><div class="mono t-small" style="font-weight:600">${right}</div><div class="sub">${fl[0] ? `<span class="dotw ${fl[0].cls}">${fl[0].t}</span>` : '&nbsp;'}</div></div><button class="dots" data-act="rowmenu" data-id="${j.id}" aria-label="Job actions">${ICON.dots}</button></div>`;
}

// ----- returning
function outcomeWords(j, l) {
  const s = rowStats(j, l), w = [];
  if (s.out) w.push(`<span class="dotw err">${s.out === s.n ? 'out' : s.out + ' out'}</span>`);
  if (s.ok) w.push(`<span class="dotw ok">${s.ok === s.n ? 'returned' : s.ok + ' back'}</span>`);
  if (s.dmg) { const rp = l.units.some(u => u.st === 'dmg' && u.repair); w.push(`<span class="dotw warn">${s.dmg} damaged${rp ? ' · repair raised' : ''}</span>`); }
  if (s.miss) w.push(`<span class="dotw err">${s.miss} missing</span>`);
  if (s.late) w.push(`<span class="dotw err mono" style="font-weight:600">${s.late}d late</span>`);
  return w.join('');
}
function rowSub(l) {
  const tags = l.units.filter(u => u.tag).map(u => u.tag);
  const t = l.kind === 'bulk' ? `bin ${l.bin}` : tags.length > 2 ? `${tags[0]} … ${tags[tags.length - 1]}` : tags.join(', ');
  return `<span class="mono">${t}</span> · ${l.shelf}`;
}
function chipsFor(j, l) {
  if (l.units.every(u => u.tag)) return l.units.map(u => `<button class="uchip ${u.st}" data-act="unitmenu" data-u="${u.id}">${u.tag} <i>${ST[u.st]}</i></button>`).join('');
  const g = {}; for (const u of l.units) (g[u.st] ||= []).push(u);
  return Object.entries(g).filter(([st]) => st === 'out' || isBack(st === 'ok' ? { st } : { st })).map(([st, us]) => `<button class="uchip ${st}" data-act="unitmenu" data-u="${us[0].id}" data-n="${us.length}"><span>×${us.length}</span> <i>${ST[st]}</i></button>`).join('');
}
function pagedGroups() {
  const flat = flatRows(), ph = isPhone();
  const slice = ph ? flat.slice(0, (state.page + 1) * state.size) : flat.slice(state.page * state.size, (state.page + 1) * state.size);
  const gs = []; for (const r of slice) { let g = gs[gs.length - 1]; if (!g || g.j !== r.j) { g = { j: r.j, ls: [] }; gs.push(g); } g.ls.push(r.l); }
  return { gs, flat, slice };
}
function groupHead(j, ph) {
  const c = counts(j), od = overdueDays(j);
  return { name: `<span class="mono muted t-small">#${j.num}</span> <b>${esc(j.name)}</b>`, meta: `${esc(j.client)} · due back ${fmtD(j.end)} · <span class="mono">${c.out}</span> out`, od };
}
function renderReturning() {
  $('#board').innerHTML = ''; const { gs, flat, slice } = pagedGroups(); const allSel = slice.length && slice.every(r => state.selRows.has(r.l.id));
  let h = `<table class="tbl rtbl"><colgroup><col style="width:34px"><col><col style="width:90px"><col style="width:300px"><col style="width:40px"></colgroup><thead><tr><th><button class="cb ${allSel ? 'on' : ''}" data-act="selallrows" aria-label="Select page"></button></th><th>Item</th><th class="r" style="text-align:right">Out</th><th>Outcome</th><th></th></tr></thead><tbody>`;
  if (!gs.length) h += `<tr><td colspan="5"><div class="empty">${state.jobs.some(returnable) ? `<b>Nothing here</b>No items in this outcome. <button class="lnk" data-act="rscope" data-k="out">Show what is still out</button>` : `<b>Nothing out</b>Every job is back on the shelf.`}</div></td></tr>`;
  for (const g of gs) {
    const j = g.j, gh = groupHead(j), allIn = g.ls.every(l => state.selRows.has(l.id));
    h += `<tr class="grp"><td><button class="cb ${allIn ? 'on' : ''}" data-act="selgroup" data-id="${j.id}" aria-label="Select all of #${j.num}"></button></td><td colspan="3"><div class="gname">${gh.name}<span class="muted t-small">${gh.meta}</span>${gh.od ? `<span class="dotw err">${gh.od}d overdue</span>` : ''}</div></td><td class="r"><button class="dots" data-act="groupmenu" data-id="${j.id}" aria-label="Job actions">${ICON.dots}</button></td></tr>`;
    for (const l of g.ls) {
      const sel = state.selRows.has(l.id), s = rowStats(j, l), open = state.expanded.has(l.id);
      h += `<tr class="row item ${sel ? 'sel' : ''}" data-act="expand" data-l="${l.id}"><td><button class="cb ${sel ? 'on' : ''}" data-act="selrow" data-l="${l.id}" aria-label="Select ${esc(l.name)}"></button></td><td style="min-width:0"><div class="ell"><b style="font-weight:600">${esc(l.name)}</b>${l.kind === 'kit' ? ' <span class="faint t-small">kit</span>' : ''}</div><div class="sub ell">${rowSub(l)}</div></td><td class="r mono">${s.out} / ${s.n}</td><td><div style="display:flex;gap:12px;flex-wrap:wrap">${outcomeWords(j, l)}</div></td><td class="r"><button class="dots" data-act="rowmenu2" data-l="${l.id}" aria-label="Item actions">${ICON.dots}</button></td></tr>`;
      if (open) h += `<tr class="exp"><td></td><td colspan="4">${chipsFor(j, l)}</td></tr>`;
    }
  }
  $('#tblwrap').innerHTML = h + '</tbody></table>'; $('#tblwrap').style.display = '';
}
function renderListReturning() {
  const { gs, flat, slice } = pagedGroups(); let h = '';
  if (!gs.length) h = `<div class="empty">${state.jobs.some(returnable) ? `<b>Nothing here</b>No items in this outcome.` : `<b>Nothing out</b>Every job is back on the shelf.`}</div>`;
  for (const g of gs) {
    const j = g.j, c = counts(j), od = overdueDays(j);
    h += `<div class="lhead"><span class="mono muted">#${j.num}</span><span class="ell">${esc(j.name)}</span><span class="n">${c.out} out</span>${od ? `<span class="dotw err" style="font-size:12px">${od}d overdue</span>` : ''}<span class="sp"></span><button class="dots" data-act="groupmenu" data-id="${j.id}" aria-label="Job actions">${ICON.dots}</button></div>`;
    for (const l of g.ls) {
      const sel = state.selRows.has(l.id), s = rowStats(j, l), ws = outcomeWords(j, l);
      h += `<div class="lrow ${sel ? 'sel' : ''}" data-act="expand" data-l="${l.id}"><button class="cb ${sel ? 'on' : ''}" data-act="selrow" data-l="${l.id}" aria-label="Select ${esc(l.name)}"></button><div class="grow" style="min-width:0"><div class="ttl ell">${esc(l.name)}</div><div class="sub ell">${rowSub(l)}</div>${state.expanded.has(l.id) ? `<div style="margin-top:6px">${chipsFor(j, l)}</div>` : ''}</div><div class="right"><div class="mono t-small" style="font-weight:600">${s.out} / ${s.n} out</div><div class="words">${ws}</div></div><button class="dots" data-act="rowmenu2" data-l="${l.id}" aria-label="Item actions">${ICON.dots}</button></div>`;
    }
  }
  if (flat.length > slice.length) h += `<button class="lrow" data-act="more" style="justify-content:center;color:var(--blue);font-weight:600">Show ${Math.min(state.size, flat.length - slice.length)} more · ${flat.length - slice.length} left</button>`;
  $('#list').innerHTML = h;
}
function renderFoot() {
  if (state.mode === 'board') {
    const js = boardJobs(), c = js.reduce((a, j) => { const k = counts(j); a.lines += k.lines; a.out += k.out; return a; }, { lines: 0, out: 0 });
    $('#foot').innerHTML = `<span>${js.length} jobs · ${c.lines} lines · ${c.out} items out</span><span style="margin-left:auto" class="deskonly">Columns come from the lines, not from dragging</span>`;
  } else { const n = flatRows().length; $('#foot').innerHTML = isPhone() ? `<span>${n} rows</span>` : pager(n, 'rows'); }
}
function renderBulk() {
  const b = $('#bulk'); const ret = state.mode === 'returning', n = ret ? state.selRows.size : state.selJobs.size;
  b.classList.toggle('open', n > 0); document.body.classList.toggle('hassel', n > 0); if (!n) return;
  if (ret) {
    const lines = [...state.selRows].map(id => rowById(id)).filter(Boolean), dm = lines.reduce((a, r) => a + r.l.units.filter(u => u.st === 'dmg' && !u.repair).length, 0), outN = lines.filter(r => r.l.units.some(u => u.st === 'out')).length;
    b.innerHTML = `<b style="font-size:13px">${n} selected</b>${outN ? `<button class="btn btn-secondary btn-sm" data-act="bulkret2">Return ${outN}</button><button class="btn btn-secondary btn-sm" data-act="bulkdmg">Mark damaged ${outN}</button>` : ''}${dm ? `<button class="btn btn-secondary btn-sm" data-act="bulkrepair">Raise repair ${dm}</button>` : ''}${outN ? `<button class="btn btn-secondary btn-sm" style="color:var(--t-out)" data-act="bulkmiss">Mark missing ${outN}</button>` : ''}<button class="btn btn-icon btn-sm" data-act="clearsel" aria-label="Clear selection">✕</button>`;
    return;
  }
  const js = [...state.selJobs].map(job).filter(Boolean), pre = js.filter(j => preOut(stageOf(j))).length, outJ = js.filter(j => counts(j).out > 0).length, cl = js.filter(closeable).length;
  b.innerHTML = `<b style="font-size:13px">${n} selected</b><button class="btn btn-secondary btn-sm" data-act="bulkpull">Print pull sheets ${n}</button>${pre ? `<button class="btn btn-secondary btn-sm" data-act="bulkpacker">Assign packer…</button>` : ''}${outJ ? `<button class="btn btn-secondary btn-sm" data-act="bulkreceive">Receive ${outJ}</button>` : ''}${cl ? `<button class="btn btn-secondary btn-sm" data-act="bulkclose">Close out ${cl}</button>` : ''}<button class="btn btn-icon btn-sm" data-act="clearsel" aria-label="Clear selection">✕</button>`;
}
const rowById = lid => { for (const j of state.jobs) { const l = j.lines.find(x => x.id === lid); if (l) return { j, l }; } return null; };

// ---------- pull sheet (print view of the same lines)
function paperFor(j) {
  const c = counts(j); const cats = CAT_ORDER.filter(k => j.lines.some(l => l.cat === k));
  let rows = '';
  for (const cat of cats) {
    rows += `<tr class="cat"><td colspan="5">${cat}</td></tr>`;
    for (const l of j.lines.filter(x => x.cat === cat).sort((a, b) => a.shelf.localeCompare(b.shelf))) {
      const tags = l.units.filter(u => u.tag).map(u => u.tag), tg = l.kind === 'bulk' ? l.bin : tags.length > 3 ? `${tags[0]} … ${tags[tags.length - 1]}` : tags.join(', ');
      rows += `<tr><td style="width:22px"><span class="bx"></span></td><td>${esc(l.name)}${l.short && lineSt(l) === 'pick' ? ` <span class="short">short ${l.short}</span>` : ''}</td><td class="q">${l.units.length}</td><td class="m">${tg}</td><td class="m">${l.shelf}</td></tr>`;
      if (l.members) for (const [mn, mq] of l.members) rows += `<tr class="sub"><td></td><td style="padding-left:18px">${mn}</td><td class="q">${mq * l.units.length}</td><td></td><td></td></tr>`;
    }
  }
  return `<div class="paper"><h3>Pull sheet · #${j.num} ${esc(j.name)}</h3><div class="meta"><span>Client <b>${esc(j.client)}</b></span><span>Event <b>${dates(j)}</b></span><span>Truck <b>${wd(j.truck.d)} ${fmtD(j.truck.d)} ${j.truck.t}</b> · ${j.truck.v}</span><span>Packer <b>${j.packer ? esc(j.packer) : '—'}</b></span><span><b>${c.lines}</b> lines · <b>${c.items}</b> items</span></div><table><thead><tr><th></th><th>Item</th><th class="q">Qty</th><th>Asset tag</th><th>Shelf</th></tr></thead><tbody>${rows}</tbody></table><div class="sign"><span>Picked by</span><span>Checked by</span><span>Loaded by</span></div></div>`;
}
function openPull(ids) {
  const js = ids.map(job).filter(Boolean); if (!js.length) return;
  closeLayer(); openDialog(`<div class="hd"><div class="t-overline">Documents</div><h2 style="font-size:18px">${js.length === 1 ? `Pull sheet · #${js[0].num}` : `${js.length} pull sheets`}</h2><div class="t-small muted" style="margin-top:2px">The same list the packer works from · print view</div></div><div class="bd" style="overflow:auto;max-height:62vh;padding:14px 22px">${js.map(paperFor).join('')}</div><div class="ft"><button class="btn btn-ghost" data-act="close">Close</button><div style="flex:1"></div><button class="btn btn-secondary" data-act="pdf">Save PDF</button><button class="btn btn-primary" data-act="printgo" data-n="${js.length}">Print${js.length > 1 ? ' ' + js.length : ''}</button></div>`);
  $('.dlg', body).classList.add('wide'); $('.dlg', body).style.width = 'min(820px,calc(100% - 32px))';
}

// ---------- camera sheet (no camera in a prototype: tap a label to simulate reading it)
function samples() {
  const o = state.jobs.find(j => j.num === '2333'), a = o.lines.find(l => l.name.includes('Y8')), k = o.lines.find(l => l.kind === 'kit');
  return state.mode === 'returning'
    ? [[a.units[0].tag, 'out on #2333'], [k.units[0].tag, 'kit out on #2333'], ['B-SB900', 'bin out on 4 jobs'], ['SK-0012', 'packed, not out'], ['A-0192', 'kit member'], ['AURA-90', 'on the shelf'], ['ZX-9931', 'unknown'], ['2331', 'job number']]
    : [['SK-0012', 'packed for #2341'], ['2341', 'job number'], [a.units[0].tag, 'out on #2333'], ['A-0301', 'to pick, short'], ['B-SB900', 'bin out on 4 jobs'], ['A-0192', 'kit member'], ['AURA-90', 'on the shelf'], ['ZX-9931', 'unknown']];
}
function camResult() { const e = state.strip[0]; return e ? `<div class="result ${e.tone}" style="margin-top:8px"><div class="grow"><div class="rt"><span class="tg">${esc(e.tag)}</span><span class="ell" style="font-weight:600">${esc(e.name)}</span></div><div class="how">${esc(e.text)}</div></div></div>` : '<div class="t-micro muted">Nothing read yet</div>'; }
function cameraSheet() {
  openDialog(`<div class="vf" style="height:${isPhone() ? 260 : 220}px;margin:12px"><div class="ret"><i></i><i></i><i></i><i></i></div><div style="position:absolute;left:0;right:0;top:12px;display:flex;justify-content:center"><span class="dotw" style="background:rgba(14,12,10,.7);padding:4px 10px;border-radius:999px;color:var(--teal)">Any job · ${state.mode === 'returning' ? 'Receive' : 'Look up'} · camera stays open</span></div></div><div class="bd" style="padding-top:0;gap:8px"><div class="t-micro muted">No camera in a prototype: tap a label to simulate reading it.</div><div style="display:flex;gap:6px;flex-wrap:wrap">${samples().map(([t, d]) => `<button class="uchip" data-act="scan" data-tag="${t}" data-stay="1" title="${d}">${t}</button>`).join('')}</div><div id="camres">${camResult()}</div></div><div class="ft"><button class="btn btn-ghost btn-sm" data-act="focusscan">Type a tag</button><div style="flex:1"></div><button class="btn btn-secondary btn-sm" data-act="close">Done</button></div>`);
}

// ---------- menus
function multiMenu(el, key, title, options, labelOf = x => x) { openMenu(el, title, [...options.map(o => ({ label: labelOf(o), act: 'ftoggle', args: `data-k="${key}" data-v="${o}"`, on: state.f[key].includes(o) })), '-', { label: 'Clear', act: 'fclear', args: `data-k="${key}"` }]); }
function pageMenu(el) {
  const ret = state.mode === 'returning', n = boardJobs().filter(j => preOut(stageOf(j))).length;
  openMenu(el, ret ? 'Returning' : 'The floor', [
    { label: ret ? 'Back to the floor' : 'Returning mode', act: 'togglemode', small: ret ? '' : String(totalOut()) },
    { label: 'Only what needs me', act: 'needsme', on: state.needsMe },
    '-', { sh: 'Documents' }, { label: `Pull sheets · jobs in view`, act: 'pullview', small: String(n) },
    '-', { label: 'Scan sounds', act: 'sound', on: state.sound }, { label: 'Work offline', act: 'offline', on: state.offline, small: 'demo' },
    '-', { sh: 'Prototype' }, { label: 'Scan a sample tag…', act: 'samplemenu' }, { label: 'Reset the demo', act: 'reset' }]);
}
function jobMenu(el, j) {
  const s = stageOf(j), it = [{ label: 'Open job', href: WH, small: 'Warehouse' }, { label: 'Job overview', href: OV }, '-', { sh: 'Documents' }, { label: 'Pull sheet', act: 'pull', args: `data-id="${j.id}"` }, { label: 'Packing list', act: 'noop' }, { label: 'Delivery docket', act: 'noop' }, '-'];
  if (preOut(s)) it.push({ label: 'Assign packer…', act: 'packermenu', args: `data-id="${j.id}"` });
  if (counts(j).out) it.push({ label: `Receive gear (${counts(j).out} out)`, act: 'receivejob', args: `data-id="${j.id}"` });
  if (closeable(j)) it.push({ label: 'Close out', act: 'closeone', args: `data-id="${j.id}"` });
  it.push('-', { sh: 'Admin · ignores item state' });
  if (preOut(s)) it.push({ label: 'Mark deployed…', act: 'markdlg', args: `data-id="${j.id}" data-m="deployed"` });
  if (s === 'out') it.push({ label: 'Mark returned…', act: 'markdlg', args: `data-id="${j.id}" data-m="returned"` });
  if (s === 'out' || s === 'returning') it.push({ label: 'Mark completed…', act: 'markdlg', args: `data-id="${j.id}" data-m="completed"` });
  openMenu(el, `#${j.num} ${j.name}`, it);
}

// ---------- writes
function applySt(units, st) { const undo = snapshot(); units.forEach(id => { const x = unitInfo(id); if (!x) return; x.u.st = st; if (st === 'out') delete x.u.at; else x.u.at = TODAY; if (st !== 'dmg') delete x.u.repair; }); return undo; }
function outIds(lids) { return lids.flatMap(lid => { const r = rowById(lid); return r ? r.l.units.filter(u => u.st === 'out').map(u => u.id) : []; }); }
function markDlg(j, m) {
  const c = counts(j), pending = m === 'deployed' ? c.items - c.out - c.back : c.out, word = { deployed: 'deployed', returned: 'returned', completed: 'completed' }[m];
  const warn = m === 'deployed' ? (pending ? `${pending} item${pending > 1 ? 's are' : ' is'} not scanned out yet. They will show as out without a scan.` : '') : (pending ? `${pending} item${pending > 1 ? 's have' : ' has'} not been scanned back. ${m === 'completed' ? 'They stay out on the record.' : 'They will show as returned without a scan.'}` : '');
  closeLayer(); openDialog(`<div class="hd"><div class="t-overline">Admin override</div><h2 style="font-size:18px">Mark #${j.num} as ${word}?</h2></div><div class="bd"><div class="t-small" style="line-height:1.5">${warn ? `<span style="color:var(--warn)">${warn}</span><br><br>` : ''}This ignores what the scanner has recorded. Scanning is how gear normally moves; use this when the floor and the system disagree. It is logged to the job's activity.</div></div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="markgo" data-id="${j.id}" data-m="${m}">Mark ${word}</button></div>`);
}

function act(name, el, ev) {
  const d = el ? el.dataset : {}, id = d.id, j = id ? job(id) : null;
  switch (name) {
    case 'close': closeLayer(); break;
    case 'noop': closeLayer(); toast('Not wired in this prototype'); break;
    case 'new': break;
    case 'scanfocus': if (isPhone()) cameraSheet(); else { $('#q').focus(); $('#q').select(); } break;
    case 'focusscan': closeLayer(); $('#q').focus(); break;
    case 'camera': cameraSheet(); break;
    case 'scan': { const t = d.tag; if (!d.stay) closeLayer(); doScan(t); break; }
    case 'modemenu': openMenu(el, 'Scan mode · any job', [{ label: 'Look up', act: 'setmode', args: 'data-m="board"', on: state.mode === 'board', small: 'offers Open / Receive' }, { label: 'Receive', act: 'setmode', args: 'data-m="returning"', on: state.mode === 'returning', small: 'records a return' }]); break;
    case 'setmode': state.mode = d.m; resetSel(); closeLayer(); render(); break;
    case 'togglemode': state.mode = state.mode === 'board' ? 'returning' : 'board'; if (state.mode === 'board') state.f.job = []; resetSel(); state.page = 0; closeLayer(); render(); break;
    case 'scope': state.scope = d.k; state.page = 0; render(); break;
    case 'stage': state.stage = d.k; state.page = 0; render(); break;
    case 'rscope': state.rscope = d.k; state.page = 0; state.selRows.clear(); render(); break;
    case 'more': state.page++; render(); break;
    case 'page': state.page = Math.max(0, state.page + +d.d); render(); break;
    case 'fmenu': {
      const k = d.k;
      if (k === 'packer') multiMenu(el, 'packer', 'Packer', [...PACKERS, 'Unassigned']);
      if (k === 'client') multiMenu(el, 'client', 'Client', [...new Set(state.jobs.filter(x => !x.done).map(x => x.client))].sort());
      if (k === 'flags') multiMenu(el, 'flags', 'Flags', Object.keys(FLAGNAMES), x => FLAGNAMES[x]);
      if (k === 'job') multiMenu(el, 'job', 'Job', state.jobs.filter(returnable).map(x => x.id), x => `#${job(x).num} ${job(x).name}`);
      break;
    }
    case 'ftoggle': { const a = state.f[d.k], v = d.v, i = a.indexOf(v); i >= 0 ? a.splice(i, 1) : a.push(v); state.page = 0; render(); act('fmenu', el); break; }
    case 'fclear': state.f[d.k] = []; closeLayer(); render(); break;
    case 'clearf': state.f = { packer: [], client: [], flags: [], job: [] }; state.needsMe = false; state.q = ''; $('#q').value = ''; state.page = 0; closeLayer(); render(); break;
    case 'needsme': state.needsMe = !state.needsMe; closeLayer(); render(); break;
    case 'pagemenu': pageMenu(el); break;
    case 'sound': state.sound = !state.sound; closeLayer(); toast(`Scan sounds ${state.sound ? 'on' : 'off'}`); break;
    case 'offline': {
      closeLayer(); state.offline = !state.offline;
      if (!state.offline && state.queue.length) { const q = state.queue.splice(0); const n = q.length; q.forEach(t => { const r = resolveTag(t); if (!r) return; state.mode === 'returning' ? scanReturning(r) : scanBoard(r); }); pushStrip('ok', 'Synced', '', `${n} scan${n > 1 ? 's' : ''} from the device applied in order`); }
      render(); toast(state.offline ? 'Working offline · scans are kept on this device' : 'Back online'); break;
    }
    case 'samplemenu': openMenu(el, 'Scan a sample tag', samples().map(([t, desc]) => ({ label: t, act: 'scan', args: `data-tag="${t}"`, small: desc }))); break;
    case 'reset': state.jobs = buildJobs(); state.jobs.forEach(x => x.id = 'j' + x.num); state.strip = []; resetSel(); state.hit = null; closeLayer(); render(); toast('Demo reset'); break;
    case 'recent': state.showRecent = !state.showRecent; render(); break;
    case 'stripclose': state.strip.shift(); render(); break;
    case 'stripundo': { const e = state.strip.find(s => s.k === +d.k); if (e && e.undo) { e.undo(); toast('Undone'); } break; }
    case 'undo': if (state.undo) { state.undo(); state.undo = null; } $('#toast').classList.remove('open'); break;
    case 'toastclose': $('#toast').classList.remove('open'); break;
    case 'openjob': window.location.href = WH; break;
    case 'open': if (ev && ev.target.closest('.cb,.dots')) break; window.location.href = WH; break;
    case 'select': {
      if (ev && ev.shiftKey && state.lastSel) { const order = orderedJobs().map(x => x.id), a = order.indexOf(state.lastSel), b = order.indexOf(id); if (a >= 0 && b >= 0) for (const k of order.slice(Math.min(a, b), Math.max(a, b) + 1)) state.selJobs.add(k); }
      else state.selJobs.has(id) ? state.selJobs.delete(id) : state.selJobs.add(id);
      state.lastSel = id; render(); break;
    }
    case 'selallvis': { const o = orderedJobs(); const all = o.every(x => state.selJobs.has(x.id)); o.forEach(x => all ? state.selJobs.delete(x.id) : state.selJobs.add(x.id)); render(); break; }
    case 'selrow': {
      const lid = d.l;
      if (ev && ev.shiftKey && state.lastSel) { const order = flatRows().map(x => x.l.id), a = order.indexOf(state.lastSel), b = order.indexOf(lid); if (a >= 0 && b >= 0) for (const k of order.slice(Math.min(a, b), Math.max(a, b) + 1)) state.selRows.add(k); }
      else state.selRows.has(lid) ? state.selRows.delete(lid) : state.selRows.add(lid);
      state.lastSel = lid; render(); break;
    }
    case 'selgroup': { const g = rrows().find(x => x.j.id === id); if (!g) break; const all = g.ls.every(l => state.selRows.has(l.id)); g.ls.forEach(l => all ? state.selRows.delete(l.id) : state.selRows.add(l.id)); render(); break; }
    case 'selallrows': { const sl = pagedGroups().slice, all = sl.every(r => state.selRows.has(r.l.id)); sl.forEach(r => all ? state.selRows.delete(r.l.id) : state.selRows.add(r.l.id)); render(); break; }
    case 'clearsel': resetSel(); render(); break;
    case 'expand': if (ev && ev.target.closest('.cb,.dots')) break; state.expanded.has(d.l) ? state.expanded.delete(d.l) : state.expanded.add(d.l); render(); break;
    case 'rowmenu': jobMenu(el, j); break;
    case 'groupmenu': openMenu(el, `#${j.num} ${j.name}`, [{ label: `Return everything still out (${counts(j).out})`, act: 'returnjob', args: `data-id="${j.id}"` }, '-', { label: 'Open job', href: WH, small: 'Warehouse' }, { label: 'Pull sheet', act: 'pull', args: `data-id="${j.id}"` }, ...(closeable(j) ? ['-', { label: 'Close out', act: 'closeone', args: `data-id="${j.id}"` }] : [])]); break;
    case 'rowmenu2': {
      const r = rowById(d.l), s = rowStats(r.j, r.l), it = [];
      if (s.out) it.push({ label: `Return${s.out > 1 ? ` all ${s.out} out` : ''}`, act: 'retline', args: `data-l="${d.l}" data-st="ok"` }, { label: 'Return as damaged', act: 'retline', args: `data-l="${d.l}" data-st="dmg"` });
      if (s.dmg) it.push({ label: 'Raise repair', act: 'repairline', args: `data-l="${d.l}"` });
      it.push({ label: 'Open asset', href: ASSET, small: '↗' }, { label: 'Open job', href: WH });
      if (s.out) it.push('-', { label: s.out > 1 ? `Mark ${s.out} missing` : 'Mark missing', act: 'retline', args: `data-l="${d.l}" data-st="miss"`, danger: true });
      openMenu(el, r.l.name, it); break;
    }
    case 'unitmenu': {
      const x = unitInfo(d.u), n = +d.n || 1, it = [];
      if (x.u.st !== 'ok') it.push({ label: n > 1 && x.u.st === 'out' ? 'Return 1' : 'Return', act: 'setunit', args: `data-u="${d.u}" data-st="ok"` });
      if (n > 1 && x.u.st === 'out') it.push({ label: `Return all ${n}`, act: 'setunits', args: `data-u="${d.u}" data-st="ok"` });
      if (x.u.st !== 'dmg') it.push({ label: 'Mark damaged', act: 'setunit', args: `data-u="${d.u}" data-st="dmg"` });
      if (x.u.st === 'dmg' && !x.u.repair) it.push({ label: 'Raise repair', act: 'repairunit', args: `data-u="${d.u}"` });
      if (x.u.st !== 'out') it.push({ label: 'Back to out', act: 'setunit', args: `data-u="${d.u}" data-st="out"` });
      if (x.u.tag) it.push({ label: 'Open asset', href: ASSET });
      if (x.u.st !== 'miss') it.push('-', { label: 'Mark missing', act: 'setunit', args: `data-u="${d.u}" data-st="miss"`, danger: true });
      openMenu(el, x.u.tag || x.l.name, it); break;
    }
    case 'outcomemenu': { const x = unitInfo(d.u); openMenu(el, x.u.tag || x.l.name, [{ label: 'Returned', act: 'setunit', args: `data-u="${d.u}" data-st="ok"`, on: x.u.st === 'ok' }, { label: 'Damaged', act: 'setunit', args: `data-u="${d.u}" data-st="dmg"`, on: x.u.st === 'dmg' }, ...(x.u.st === 'dmg' && !x.u.repair ? [{ label: 'Raise repair', act: 'repairunit', args: `data-u="${d.u}"` }] : []), '-', { label: 'Missing', act: 'setunit', args: `data-u="${d.u}" data-st="miss"`, danger: true, on: x.u.st === 'miss' }]); break; }
    case 'setunit': case 'setunits': {
      closeLayer(); const x = unitInfo(d.u); let ids = [d.u];
      if (name === 'setunits') ids = x.l.units.filter(u => u.st === 'out').map(u => u.id);
      if (d.st === 'out') { const undo = applySt(ids, 'out'); render(); toast(`${esc(x.u.tag || x.l.name)} back to out`, undo); break; }
      returnUnits(ids, d.st, state.strip[0] && state.strip[0].uid === d.u); break;
    }
    case 'retline': { closeLayer(); const r = rowById(d.l), ids = r.l.units.filter(u => u.st === 'out').map(u => u.id); if (ids.length) returnUnits(ids, d.st, false); break; }
    case 'receiveunit': { const x = unitInfo(d.u); if (x) { state.hit = x.j.id; returnUnits([d.u], 'ok', true); } break; }
    case 'bulkpick': closeLayer(); bulkPick(d.t); break;
    case 'bulkret': { const l = rowById(d.l), q = Math.max(1, Math.min(+($('#bq-' + d.l, body).value) || 1, l.l.units.filter(u => u.st === 'out').length)); const ids = l.l.units.filter(u => u.st === 'out').slice(0, q).map(u => u.id); closeLayer(); returnUnits(ids, 'ok', true, l.l.bin); break; }
    case 'returnjob': { closeLayer(); const jj = job(id), ids = jj.lines.flatMap(l => l.units.filter(u => u.st === 'out').map(u => u.id)); if (!ids.length) { toast('Nothing still out on that job'); break; } const undo = applySt(ids, 'ok'); render(); toast(`${ids.length} items returned to #${jj.num} · each one on time or late as it stands`, undo); break; }
    case 'receivejob': closeLayer(); state.mode = 'returning'; state.f.job = [id]; state.rscope = 'out'; state.page = 0; resetSel(); render(); break;
    case 'bulkreceive': { const ids = [...state.selJobs].filter(x => counts(job(x)).out > 0); state.mode = 'returning'; state.f.job = ids; state.rscope = 'out'; state.page = 0; resetSel(); render(); break; }
    case 'bulkret2': { const ids = outIds([...state.selRows]), n = state.selRows.size; const undo = applySt(ids, 'ok'); resetSel(); render(); toast(`${ids.length} items returned across ${n} rows`, undo); break; }
    case 'bulkdmg': { const ids = outIds([...state.selRows]), n = state.selRows.size; const undo = applySt(ids, 'dmg'); resetSel(); render(); toast(`${ids.length} items marked damaged across ${n} rows`, undo); break; }
    case 'bulkmiss': { const ids = outIds([...state.selRows]), n = state.selRows.size; const undo = applySt(ids, 'miss'); resetSel(); render(); toast(`${ids.length} items marked missing across ${n} rows · the jobs are told`, undo); break; }
    case 'bulkrepair': { const us = [...state.selRows].flatMap(l => rowById(l).l.units.filter(u => u.st === 'dmg' && !u.repair)); const undo = snapshot(); us.forEach(u => { unitInfo(u.id).u.repair = true; }); resetSel(); render(); toast(`${us.length} repairs raised in Maintenance`, undo); break; }
    case 'repairline': case 'repairunit': { closeLayer(); const us = name === 'repairunit' ? [unitInfo(d.u).u] : rowById(d.l).l.units.filter(u => u.st === 'dmg' && !u.repair); const undo = snapshot(); us.forEach(u => { unitInfo(u.id).u.repair = true; }); render(); toast(`${us.length} repair${us.length > 1 ? 's' : ''} raised in Maintenance`, undo); break; }
    case 'pull': closeLayer(); openPull([id]); break;
    case 'bulkpull': openPull([...state.selJobs]); break;
    case 'pullview': openPull(boardJobs().filter(x => preOut(stageOf(x))).map(x => x.id)); break;
    case 'printgo': closeLayer(); toast(`Sent ${d.n > 1 ? d.n + ' pull sheets' : 'the pull sheet'} to the printer`); break;
    case 'pdf': closeLayer(); toast('Pull sheet saved as PDF'); break;
    case 'packermenu': openMenu(el, 'Assign packer', [...PACKERS.map(p => ({ label: p, act: 'packergo', args: `data-id="${id}" data-p="${p}"`, on: j && j.packer === p })), '-', { label: 'Unassign', act: 'packergo', args: `data-id="${id}" data-p=""` }]); break;
    case 'bulkpacker': openMenu(el, `Assign packer for ${state.selJobs.size}`, [...PACKERS.map(p => ({ label: p, act: 'packergo', args: `data-p="${p}"` })), '-', { label: 'Unassign', act: 'packergo', args: 'data-p=""' }]); break;
    case 'packergo': {
      const ids = id ? [id] : [...state.selJobs], undo = snapshot(); let n = 0, sk = 0;
      ids.forEach(k => { const x = job(k); if (preOut(stageOf(x))) { x.packer = d.p || null; n++; } else sk++; });
      resetSel(); closeLayer(); render(); toast(d.p ? `${d.p} is packing ${n} job${n > 1 ? 's' : ''}${sk ? ` · ${sk} already out, left alone` : ''}` : `Packer cleared on ${n} job${n > 1 ? 's' : ''}`, undo); break;
    }
    case 'bulkclose': case 'closeone': {
      closeLayer(); const ids = name === 'closeone' ? [id] : [...state.selJobs], undo = snapshot(); let n = 0, sk = 0, left = 0;
      ids.forEach(k => { const x = job(k); if (closeable(x)) { x.done = true; n++; } else { sk++; left += counts(x).out; } });
      resetSel(); render(); toast(`${n} job${n > 1 ? 's' : ''} closed out${sk ? ` · ${sk} skipped${left ? ` (${left} items still out)` : ''}` : ''}`, undo); break;
    }
    case 'markdlg': markDlg(j, d.m); break;
    case 'markgo': {
      const undo = snapshot(), jj = job(id); jj.lines.forEach(l => l.units.forEach(u => { if (d.m === 'deployed' && (u.st === 'pick' || u.st === 'packed')) u.st = 'out'; if (d.m === 'returned' && u.st === 'out') { u.st = 'ok'; u.at = TODAY; } }));
      if (d.m === 'completed') jj.done = true; closeLayer(); resetSel(); render(); toast(`#${jj.num} marked ${d.m} · logged as an admin override`, undo); break;
    }
  }
}
function resetSel() { state.selJobs.clear(); state.selRows.clear(); state.lastSel = null; }
document.addEventListener('keydown', ev => { if (ev.target.id === 'q' && ev.key === 'Enter') { const v = ev.target.value; if (v.trim()) { ev.preventDefault(); doScan(v); } } });
document.addEventListener('input', ev => { if (ev.target.id === 'q') { state.q = ev.target.value; state.page = 0; state.hit = null; render(); } });
render();
