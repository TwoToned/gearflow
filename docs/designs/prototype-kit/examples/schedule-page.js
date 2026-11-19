// ---------- Schedule · data
const TODAY = '2026-11-09', ME = 'Jayden Cole';
const A = id => 'https://claude.ai/artifact/' + id;
const U = { over:A('RatKsWfTmDJLJHmn6mb7Zo'), equip:A('BdwR4bNbiNMLSvfRAByEwC'), logi:A('E36tnBkGL9obdikUQ5mbXf'), jobs:A('A7SMPtpTr3aedUDEnuSaxd'), assets:A('89PDTuMiovgP9i3h4MJ1Tw'), home:A('RPnGj7WnaWcknvQ8ShcRkf'), wizard:A('GgtKxc5WZP33gXihgFTB9B'), floor:A('6xqFcEZZk49w86p5pAsisA'), model:A('47miWruJVsednbzrFPij2b'), people:A('LPdsNGb4CRMfS6qk7j7Fsa'), gear:A('D7N5PmXKrkcY2gzZXWeuvc'), planner:A('AKkgWzJ2gVR3dJTWnMB2Ui'), scan:A('8Q2HVoRhLbSLz1Q9mCtayX'), fin:A('5VnYTVW2pdA5r1qBRvdrom') };
const rnd = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(11);
const addD = (d, n) => new Date((dayNum(d) + n) * 864e5).toISOString().slice(0,10);
// Fixture calendar: Mon 10 Nov 2026 anchors the week (11 Nov is a Tuesday in the fiction; 9 Nov prints with no weekday).
const dowM = d => (((dayNum(d) - dayNum('2026-11-10')) % 7) + 7) % 7;
const wdOf = d => ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][dowM(d)];
const weekOf = d => addD(d, -dowM(d));
const isWe = d => dowM(d) >= 5;
const dnum = d => +d.slice(8, 10);
const fmtDay = d => `${wdOf(d)} ${fmtD(d)}`;
const fmtSpan = (a, b) => a === b ? fmtDay(a) : a.slice(0, 7) === b.slice(0, 7) ? `${wdOf(a)} ${dnum(a)} – ${wdOf(b)} ${fmtD(b)}` : `${fmtDay(a)} – ${fmtDay(b)}`;
const fr = (a, b) => a === b ? fmtD(a) : fmtRange(a, b);
const dayList = (a, b) => { const o = []; for (let d = a; d <= b; d = addD(d, 1)) o.push(d); return o; };
const monthStart = d => d.slice(0, 8) + '01';
const monthEnd = d => { const t = new Date(dayNum(monthStart(d)) * 864e5); t.setUTCMonth(t.getUTCMonth() + 1, 0); return t.toISOString().slice(0, 10); };
const addMonth = (d, n) => { const t = new Date(dayNum(monthStart(d)) * 864e5); t.setUTCMonth(t.getUTCMonth() + n, 1); return t.toISOString().slice(0, 10); };
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const ST = { ENQUIRY:['Enquiry','','pen'], QUOTING:['Quoting','','pen'], QUOTED:['Quoted','info','pen'], AWAITING_PAYMENT:['Awaiting payment','warn','hard'], CONFIRMED:['Confirmed','ok','hard'], PREPPING:['Prepping','info','hard'], CHECKED_OUT:['Deployed','info','hard'], ON_SITE:['On site','live','hard'] };
const isHard = j => ST[j.status][2] === 'hard';
const swd = j => `<span class="dotw ${ST[j.status][1]}">${ST[j.status][0]}</span>`;
const PMS = ['Jayden Cole', 'Tom Nguyen', 'Mel Torres'];
const CATS = ['Lighting', 'Audio', 'Video', 'Power & rigging'];
// k, name, category, owned, out of service
const MODELS = [
  ['pxl','Martin MAC Aura PXL','Lighting',8,0], ['xb','Martin MAC Aura XB','Lighting',12,1,'AURA-06 has a fan fault; AURA-02 and AURA-10 are overdue for test & tag but still serviceable'], ['r2','Chauvet Rogue R2 Wash','Lighting',16,0], ['s4','ETC Source Four 750W','Lighting',24,1], ['tube','Astera Titan Tube','Lighting',20,0],
  ['y8','d&b Y8','Audio',16,0], ['ysub','d&b Y-SUB','Audio',8,0], ['sk','Sennheiser EW-DX SK beltpack','Audio',24,0], ['em4','Sennheiser EW-DX EM 4 receiver','Audio',8,0], ['ulx','Shure ULXD4Q wireless kit','Audio',4,0],
  ['udx','Barco UDX-4K32','Video',3,0], ['roe','ROE CB5 LED panel','Video',60,2], ['atem','Blackmagic ATEM Mini Extreme','Video',4,0],
  ['pd','Power distro 63A','Power & rigging',6,0], ['hoist','1t chain hoist','Power & rigging',16,0], ['truss','Truss 3m','Power & rigging',40,0],
].map(([k, name, cat, owned, oos, note]) => ({ k, name, cat, owned, oos, note: note || '' }));
const MK = Object.fromEntries(MODELS.map(m => [m.k, m]));
const svcN = m => m.owned - m.oos;

// num, name, client, contact, pm, status, start, end, total, items, truck, lines (hand-set)
const SEED = [
  ['2336','Canva sales kickoff','Canva','Rob Hale','Jayden Cole','ON_SITE','2026-11-06','2026-11-10',31210,34],
  ['2340','Launch night','Ogilvy','Tess Mackay','Tom Nguyen','CHECKED_OUT','2026-11-08','2026-11-09',14850,25],
  ['2337','Allianz leadership forum','Allianz','Nina Park','Tom Nguyen','CHECKED_OUT','2026-11-10','2026-11-11',18420,27,'',{ em4:5, y8:4, s4:6 }],
  ['2342','Mercedes dealer conference','Mercedes-Benz','Alan Voss','Tom Nguyen','PREPPING','2026-11-11','2026-11-13',36940,52,'',{ em4:5, y8:3, tube:6, truss:8 }],
  ['2341','Hilton Sydney gala dinner','Hilton Sydney','Priya Shah','Jayden Cole','CONFIRMED','2026-11-12','2026-11-14',23880,44,'Tue 11 Nov 06:30 · Van 2',{ pxl:6, xb:8, sk:12, y8:8, ysub:4, r2:4, s4:12, em4:3, ulx:2, hoist:8, truss:16, pd:3 }],
  ['2350','Qantas awards','Qantas','Hannah Lowe','Mel Torres','QUOTED','2026-11-13','2026-11-14',41200,58,'Thu 13 Nov 07:00 · Truck A',{ pxl:4, sk:8, y8:4, roe:24, udx:1, hoist:4, truss:10, pd:2 }],
  ['2349','Red Bull festival stage','Red Bull','Cal Dixon','Tom Nguyen','QUOTED','2026-11-14','2026-11-16',58300,71,'',{ sk:8, r2:6, y8:2, tube:10, truss:12 }],
  ['2343','Vivid previews','Destination NSW','Leo Park','Jayden Cole','ENQUIRY','2026-11-14','2026-11-16',null,0],
  ['2345','UNSW open day','UNSW','Mei Chen','Jayden Cole','CONFIRMED','2026-11-15','2026-11-15',9840,19],
  ['2347','Taronga twilight gala','Taronga Zoo','Grace Ng','Mel Torres','QUOTED','2026-11-16','2026-11-16',12760,22],
  ['2344','Atlassian town hall','Atlassian','Sarah Obi','Jayden Cole','CONFIRMED','2026-11-17','2026-11-18',27450,40],
  ['2346','UNSW graduation','UNSW','Mei Chen','Tom Nguyen','CONFIRMED','2026-11-18','2026-11-19',33120,48],
  ['2348','Mercedes EQ launch','Mercedes-Benz','Alan Voss','Tom Nguyen','QUOTED','2026-11-19','2026-11-20',44800,63],
  ['2338','Corporate AGM','Atlassian','Sarah Obi','Tom Nguyen','CONFIRMED','2026-11-21','2026-11-21',21780,26,'Thu 20 Nov 07:00 · Truck A'],
  ['2339','ICC Sydney trade show','ICC Sydney','Beth Wolfe','Jayden Cole','QUOTED','2026-11-24','2026-11-27',66400,88],
  ['2351','Optus staff awards','Optus','Dan Reilly','Mel Torres','CONFIRMED','2026-11-25','2026-11-25',15900,29],
  ['2353','Opera House town hall','Sydney Opera House','Isla Grant','Jayden Cole','QUOTING','2026-11-28','2026-11-28',null,0],
  ['2355','Spotify listening party','Spotify','Zoe Hart','Mel Torres','ENQUIRY','2026-12-02','2026-12-02',null,0],
  ['2354','Westpac Christmas party','Westpac','Ravi Shah','Tom Nguyen','QUOTED','2026-12-05','2026-12-05',17200,31],
  ['2356','Canva Christmas dinner','Canva','Rob Hale','Jayden Cole','CONFIRMED','2026-12-10','2026-12-11',19640,33],
].map(([num, name, client, contact, pm, status, s, e, total, items, truck, lines]) => ({ num, name, client, contact, pm, status, s, e, total, items, truck: truck || '', lines: lines || null }));

const state = { view:'jobs', zoom:'week', anchor:'2026-11-10', day:'2026-11-13', seg:'all', q:'', f:{ status:[], cat:[], model:[], pm:[] }, sel:new Set(), lastSel:null, jobs:[], sub:[], undo:null, pending:null, mv:null, sh:null };
// ---------- seed the holds: hand-set lines first, then generated ones capped so nothing else ever overbooks
function holdsIn(jobs, mk, d) { let hard = 0, pen = 0; const hj = [], pj = []; for (const j of jobs) { if (j.s > d || j.e < d) continue; const q = j.lines[mk]; if (!q) continue; if (isHard(j)) { hard += q; hj.push([j, q]); } else { pen += q; pj.push([j, q]); } } return { hard, pen, hj, pj }; }
for (const s of SEED) if (s.lines) { state.jobs.push(s); }
for (const s of SEED) if (!s.lines) {
  s.lines = {};
  if (s.items) {
    const pool = MODELS.filter(m => !['pxl', 'xb', 'sk'].includes(m.k)).sort(() => rnd() - .5).slice(0, 4 + Math.floor(rnd() * 4));
    for (const m of pool) { const want = Math.max(1, Math.round(m.owned * (.08 + rnd() * .22))); let cap = want; for (const d of dayList(s.s, s.e)) { const h = holdsIn(state.jobs, m.k, d); cap = Math.min(cap, svcN(m) - h.hard - h.pen); } if (cap > 0) s.lines[m.k] = cap; }
  }
  state.jobs.push(s);
}
state.jobs.sort((a, b) => a.s.localeCompare(b.s) || a.num.localeCompare(b.num));
state.sub = [];

// ---------- derived (never stored)
let memo = new Map();
const jobBy = n => state.jobs.find(j => j.num === n);
function cellOf(m, d, jobs = state.jobs) { const h = holdsIn(jobs, m.k, d), svc = svcN(m), free = svc - h.hard, short = Math.max(0, -free); return { ...h, svc, free, short, extra: Math.max(0, h.hard + h.pen - svc) - short }; }
const C = (m, d) => { const k = m.k + d; if (!memo.has(k)) memo.set(k, cellOf(m, d)); return memo.get(k); };
function runsOf(days) { const o = []; for (const d of days) { const l = o[o.length - 1]; if (l && addD(l[1], 1) === d) l[1] = d; else o.push([d, d]); } return o; }
// per model: the days a job is short / would be short, as runs
function jobRuns(j, jobs, mode) {
  const out = [];
  for (const mk of Object.keys(j.lines)) { const m = MK[mk], q = j.lines[mk], days = [], val = {};
    for (const d of dayList(j.s, j.e)) { const c = cellOf(m, d, jobs); const v = mode === 'clash' ? c.short : Math.max(0, c.hard + q - c.svc); if (v > 0) { days.push(d); val[d] = v; } }
    for (const [a, b] of runsOf(days)) { const peak = Math.max(...dayList(a, b).map(d => val[d])); out.push({ m, from:a, to:b, short:peak, with:[...new Set(dayList(a, b).flatMap(d => cellOf(m, d, jobs).hj.map(x => x[0].num)))].filter(n => n !== j.num) }); }
  }
  return out;
}
const clashRuns = j => { const k = 'c' + j.num; if (!memo.has(k)) memo.set(k, isHard(j) ? jobRuns(j, state.jobs, 'clash') : []); return memo.get(k); };
const wouldRuns = j => { const k = 'w' + j.num; if (!memo.has(k)) memo.set(k, isHard(j) ? [] : jobRuns(j, state.jobs, 'would')); return memo.get(k); };
// the gates: what a write WOULD strand, compared with what is stranded already
function newShort(sim, movedNums) {
  const out = [];
  for (const n of movedNums) { const j = sim.find(x => x.num === n); if (!isHard(j)) continue;
    for (const mk of Object.keys(j.lines)) { const m = MK[mk], days = [], val = {};
      for (const d of dayList(j.s, j.e)) { const a = cellOf(m, d, sim).short, b = cellOf(m, d, state.jobs).short; if (a > b) { days.push(d); val[d] = a; } }
      for (const [a, b] of runsOf(days)) out.push({ job:j, m, from:a, to:b, short:Math.max(...dayList(a, b).map(d => val[d])), with:[...new Set(dayList(a, b).flatMap(d => cellOf(m, d, sim).hj.map(x => x[0].num)))].filter(x => x !== n) });
    } }
  return out;
}
const confirmImpact = nums => window.__previewDown ? (() => { throw new Error('preview down'); })() : newShort(state.jobs.map(j => nums.includes(j.num) ? { ...j, status:'CONFIRMED' } : j), nums);
const moveImpact = (nums, by) => window.__previewDown ? (() => { throw new Error('preview down'); })() : newShort(state.jobs.map(j => nums.includes(j.num) ? { ...j, s:addD(j.s, by), e:addD(j.e, by) } : j), nums);
const movable = j => !['CHECKED_OUT', 'ON_SITE'].includes(j.status);
function shortRun(m, d) { if (C(m, d).short <= 0) return null; let a = d, b = d; while (C(m, addD(a, -1)).short > 0) a = addD(a, -1); while (C(m, addD(b, 1)).short > 0) b = addD(b, 1); return { from:a, to:b, short:Math.max(...dayList(a, b).map(x => C(m, x).short)) }; }
const subFor = (mk, d) => state.sub.filter(s => s.k === mk && s.from <= d && s.to >= d);

// ---------- range, filters, rows
function range() { if (isPhone() || state.zoom === 'week') { const s = weekOf(phoneAnchor()); return [s, addD(s, 6)]; } const s = monthStart(state.anchor); return [s, monthEnd(s)]; }
function phoneAnchor() { if (state.zoom === 'week') return state.anchor; return monthStart(state.anchor) === '2026-11-01' ? '2026-11-10' : addD(state.anchor, (7 - dowM(state.anchor)) % 7); }
const days = () => dayList(...range());
const lab = (a, rs) => a.length ? (a.length > 1 ? a.length + ' chosen' : rs ? rs(a[0]) : a[0]) : '';
const hasF = () => Object.values(state.f).some(v => v.length) || state.q;
const SEGS = [['all', 'All'], ['confirmed', 'Confirmed'], ['pencilled', 'Pencilled'], ['clashes', 'Clashes']];
const GSEGS = [['all', 'All'], ['short', 'Short'], ['risk', 'At risk']];
function jobOk(j, withQ = true, withGear = true) {
  const f = state.f, q = state.q.trim().toLowerCase();
  if (f.status.length && !f.status.includes(j.status)) return false;
  if (f.pm.length && !f.pm.includes(j.pm)) return false;
  if (withGear && f.cat.length && !Object.keys(j.lines).some(k => f.cat.includes(MK[k].cat))) return false;
  if (withGear && f.model.length && !Object.keys(j.lines).some(k => f.model.includes(k))) return false;
  if (withQ && q && !(`${j.num} ${j.name} ${j.client} ${j.pm}`.toLowerCase().includes(q) || Object.keys(j.lines).some(k => MK[k].name.toLowerCase().includes(q)))) return false;
  return true;
}
const inRange = j => { const [a, b] = range(); return j.e >= a && j.s <= b; };
const baseJobs = () => state.jobs.filter(j => inRange(j) && jobOk(j));
const segJob = (j, s) => s === 'all' || (s === 'confirmed' && isHard(j)) || (s === 'pencilled' && !isHard(j)) || (s === 'clashes' && clashRuns(j).length > 0);
const jobsShown = () => baseJobs().filter(j => segJob(j, state.seg));
function modelOk(m, withQ = true) {
  const f = state.f, q = state.q.trim().toLowerCase();
  if (f.cat.length && !f.cat.includes(m.cat)) return false;
  if (f.model.length && !f.model.includes(m.k)) return false;
  if (withQ && q && !(m.name.toLowerCase().includes(q) || m.cat.toLowerCase().includes(q))) return false;
  if (f.status.length || f.pm.length) { if (!state.jobs.some(j => inRange(j) && jobOk(j, false, false) && j.lines[m.k])) return false; }
  return true;
}
const mRange = m => days().map(d => C(m, d));
const segModel = (m, s) => s === 'all' || (s === 'short' && mRange(m).some(c => c.short > 0)) || (s === 'risk' && mRange(m).some(c => c.extra > 0));
const baseModels = () => MODELS.filter(m => modelOk(m));
const modelsShown = () => baseModels().filter(m => segModel(m, state.seg));
const shortModels = () => MODELS.filter(m => mRange(m).some(c => c.short > 0));
const visibleIds = () => state.view === 'jobs' ? jobsShown().map(j => j.num) : modelsShown().map(m => 'm_' + m.k);
function snapshot() { const j = state.jobs.map(x => ({ ...x })), s = state.sub.map(x => ({ ...x })); return () => { state.jobs = j; state.sub = s; state.sel.clear(); render(); }; }

// ---------- shell bits
function renderNav() {
  const items = [['Dashboard','blue',U.home],['Jobs','blue',U.jobs],['Finance','green',U.fin],['Schedule','green','#'],['Crew','purple',U.planner],['Assets','amber',U.assets],['Warehouse','teal',U.floor],['Test & tag','teal',U.gear],['Maintenance','amber',U.gear]];
  $('#sidenav').innerHTML = items.map(([n, c, h]) => `<a href="${h}" class="${n === 'Schedule' ? 'on' : ''}"><span class="patch" style="background:var(--${c}-soft, var(--paper-2))"></span>${n}</a>`).join('');
  const bn = document.querySelectorAll('.bottomnav a'), hs = [U.home, U.jobs, U.scan, U.floor, U.assets]; bn.forEach((a, i) => { a.setAttribute('href', hs[i]); });
}
function ensureDay() { const ds = days(); if (!ds.includes(state.day)) state.day = ds[Math.max(0, Math.min(6, dowM(state.day)))] || ds[0]; }
function render() {
  memo = new Map(); if (isPhone()) ensureDay();
  renderNav(); renderHead(); renderStrip(); renderToolbar();
  if (state.view === 'jobs') renderTimeline(); else renderGear();
  renderList(); renderDays(); renderFoot(); renderBulk();
}
const rangeLabel = () => { const [a, b] = range(); return isPhone() || state.zoom === 'week' ? fr(a, b) : `${MONTHS[+a.slice(5, 7) - 1]} ${a.slice(0, 4)}`; };
function renderHead() {
  const jobs = state.view === 'jobs', n = jobs ? jobsShown().length : modelsShown().length;
  $('#count').textContent = n;
  $('#hsub').innerHTML = `When jobs are live and what gear they hold · <span class="kbd">/</span> search <span class="kbd">n</span> new job`;
  const views = `<button class="fw ${jobs ? 'on' : ''}" data-act="view" data-v="jobs">Jobs</button><button class="fw ${!jobs ? 'on' : ''}" data-act="view" data-v="gear">Gear</button>`;
  $('#viewsw').innerHTML = views; $('#phoneviews').innerHTML = views;
  document.querySelectorAll('#viewsw .fw.on').forEach(b => { b.style.cssText = 'color:var(--ink);box-shadow:inset 0 -2px 0 var(--action-red)'; });
  const bj = baseJobs(), nc = bj.filter(j => segJob(j, 'clashes')).length;
  $('#phonesub').textContent = jobs ? `${rangeLabel()} · ${bj.length} jobs${nc ? ` · ${nc} clash` : ''}` : `${rangeLabel()} · ${baseModels().length} models${shortModels().length ? ` · ${shortModels().length} short` : ''}`;
}
function renderStrip() {
  const jobs = state.view === 'jobs', base = jobs ? baseJobs() : baseModels(), fn = jobs ? segJob : segModel;
  $('#strip').innerHTML = (jobs ? SEGS : GSEGS).map(([k, n]) => { const c = base.filter(x => fn(x, k)).length; return `<button class="${state.seg === k ? 'on' : ''}" data-act="seg" data-k="${k}" style="${(k === 'clashes' || k === 'short') && c ? 'color:var(--t-out)' : k === 'risk' && c ? 'color:var(--warn)' : ''}">${n} <span class="n">${c}</span></button>`; }).join('');
}
function renderToolbar() {
  $('#wknav').innerHTML = `<button class="step" data-act="nav" data-d="-1" aria-label="Previous">‹</button><span class="wk">${rangeLabel()}</span><button class="step" data-act="nav" data-d="1" aria-label="Next">›</button><button class="fw" data-act="nav" data-d="0">Today</button><span class="zoomw deskonly"><button class="zw ${state.zoom === 'week' ? 'on' : ''}" data-act="zoom" data-z="week">Week</button><button class="zw ${state.zoom === 'month' ? 'on' : ''}" data-act="zoom" data-z="month">Month</button></span>`;
  const f = state.f, fw = (l, k, v) => filterWord(l, k, v, 'fmenu').replace('data-k', 'data-b="f" data-k');
  $('#fwords').innerHTML = fw('Status', 'status', lab(f.status, s => ST[s][0])) + fw('Category', 'cat', lab(f.cat)) + fw('Model', 'model', lab(f.model, k => MK[k].name)) + fw('PM', 'pm', lab(f.pm)) + (hasF() ? `<button class="lnk muted" data-act="clearf">Clear</button>` : '');
  $('#views').innerHTML = '';
}

// ---------- the timeline (desktop)
function dayHeads(ds, m, jobs) {
  return ds.map((d, i) => {
    const live = state.view === 'jobs' ? baseJobs().filter(j => j.s <= d && j.e >= d).length : 0, sh = state.view === 'gear' ? MODELS.filter(x => C(x, d).short > 0).length : 0;
    const sub = m ? '' : state.view === 'jobs' ? `<i>${live ? live + (live === 1 ? ' job' : ' jobs') : '·'}</i>` : `<i class="${sh ? 'r' : ''}">${sh ? sh + ' short' : '·'}</i>`;
    return `<button class="dh ${isWe(d) ? 'we' : ''} ${d === TODAY ? 'td' : ''}" data-act="dayopen" data-d="${d}" title="${fmtDay(d)}" style="grid-row:1;grid-column:${i + 1}"><span class="wd">${m ? wdOf(d)[0] : wdOf(d)}</span><b>${dnum(d)}</b>${sub}</button>`;
  }).join('');
}
const dayBg = ds => ds.map((d, i) => `<div class="dc ${isWe(d) ? 'we' : ''} ${d === TODAY ? 'td' : ''}" style="grid-column:${i + 1}"></div>`).join('');
function headRow(allSel, ids, ds, m) { return `<div class="tlh"><div class="tll" style="cursor:default"><button class="cb ${allSel ? 'on' : ''}" data-act="selall" aria-label="Select all shown"></button>${state.view === 'jobs' ? 'Job' : 'Model'}</div><div class="tld" style="--n:${ds.length}">${dayHeads(ds, m)}</div></div>`; }
function renderTimeline() {
  const ds = days(), n = ds.length, m = n > 8, [rs, re] = range(), L = jobsShown(), ids = L.map(j => j.num), allSel = ids.length && ids.every(i => state.sel.has(i));
  let h = `<div class="tl ${m ? 'm' : ''}" style="--n:${n}">` + headRow(allSel, ids, ds, m);
  if (!L.length) h += `<div class="empty">${hasF() || state.seg !== 'all' ? `<b>Nothing matches that</b>Loosen a filter or step to another ${m ? 'month' : 'week'}. <button class="lnk" data-act="clearf">Clear filters</button>` : `<b>No jobs in ${rangeLabel()}</b>Nothing is live. Step ‹ ›, or start one with + New job.`}</div>`;
  for (const j of L) {
    const sel = state.sel.has(j.num), a = Math.max(0, dayNum(j.s) - dayNum(rs)) + 1, b = Math.min(n - 1, dayNum(j.e) - dayNum(rs)) + 1, cr = clashRuns(j), wr = wouldRuns(j);
    const flag = cr.length ? `<span class="dotw err">clash</span>` : wr.length ? `<span class="dotw warn">would clash</span>` : '';
    const txt = m ? (b - a >= 1 ? `#${j.num}` : '') : fr(j.s, j.e);
    h += `<div class="tlr ${sel ? 'sel' : ''}" data-id="${j.num}"><div class="tll" data-act="jobopen" data-id="${j.num}"><button class="cb ${sel ? 'on' : ''}" data-act="select" data-id="${j.num}" aria-label="Select #${j.num}"></button><div class="tx"><div class="t1"><span class="jn">#${j.num}</span><span class="nm">${esc(j.name)}</span></div><div class="t2"><span class="c">${esc(j.client)}</span>${swd(j)}${isHard(j) ? '' : '<span class="tg">· pencilled</span>'}</div></div><button class="dots" data-act="jobmenu" data-id="${j.num}" aria-label="Job actions">${ICON.dots}</button></div><div class="tld" style="--n:${n}">${dayBg(ds)}<button class="bar ${isHard(j) ? 'hard' : 'pen'} ${cr.length ? 'clash' : ''} ${wr.length ? 'wc' : ''} ${sel ? 'sel' : ''} ${j.s < rs ? 'cl' : ''} ${j.e > re ? 'cr' : ''}" style="grid-column:${a} / ${b + 1}" data-act="jobopen" data-id="${j.num}" title="#${j.num} ${esc(j.name)} · ${fmtSpan(j.s, j.e)}"><span class="bt">${txt}</span>${flag}</button></div></div>`;
  }
  $('#tblwrap').innerHTML = h + '</div>';
}
// ---------- gear view: per-model free count per day
function gearCell(mo, d, m) {
  const c = C(mo, d), req = c.short > 0 && subFor(mo.k, d).length;
  if (c.short > 0) return `<button class="gc short" data-act="gcell" data-m="${mo.k}" data-d="${d}" title="${esc(mo.name)} · short ${c.short} on ${fmtDay(d)}"><span class="fn">${m ? '−' + c.short : `<span class="dotw err">short ${c.short}</span>`}</span><i class="fs">${req ? 'requested' : 'held ' + c.hard}</i></button>`;
  const pw = c.extra > 0;
  return `<button class="gc ${c.hard ? '' : 'z'} ${pw ? 'pen' : ''}" data-act="gcell" data-m="${mo.k}" data-d="${d}" title="${esc(mo.name)} · ${c.free} free on ${fmtDay(d)}"><span class="fn">${c.free}</span><i class="fs ${pw ? 'pw' : ''}">${pw ? 'pencilled −' + c.extra : ''}</i></button>`;
}
function renderGear() {
  const ds = days(), n = ds.length, m = n > 8, L = modelsShown(), ids = L.map(x => 'm_' + x.k), allSel = ids.length && ids.every(i => state.sel.has(i));
  let h = `<div class="tl ${m ? 'm' : ''}" style="--n:${n}">` + headRow(allSel, ids, ds, m);
  if (!L.length) h += `<div class="empty">${hasF() || state.seg !== 'all' ? `<b>No models match that</b>Loosen a filter. <button class="lnk" data-act="clearf">Clear filters</button>` : `<b>No gear to show</b>Add models in Assets.`}</div>`;
  for (const cat of CATS) {
    const ms = L.filter(x => x.cat === cat); if (!ms.length) continue;
    h += `<div class="gsec"><div>${cat}<span class="n">${ms.length}</span></div></div>`;
    for (const mo of ms) {
      const sel = state.sel.has('m_' + mo.k), sh = mRange(mo).some(c => c.short > 0);
      h += `<div class="tlr ${sel ? 'sel' : ''}"><div class="tll" data-act="gmodel" data-m="${mo.k}"><button class="cb ${sel ? 'on' : ''}" data-act="select" data-id="m_${mo.k}" aria-label="Select ${esc(mo.name)}"></button><div class="tx"><div class="t1"><span class="nm">${esc(mo.name)}</span></div><div class="t2"><span class="c">${mo.owned} owned${mo.oos ? ` · ${mo.oos} in service` : ''}</span></div></div><button class="dots" data-act="gearmenu" data-m="${mo.k}" aria-label="Model actions">${ICON.dots}</button></div><div class="tld" style="--n:${n}">${dayBg(ds)}${ds.map((d, i) => gearCell(mo, d, m).replace('class="gc', `style="grid-column:${i + 1}" class="gc`)).join('')}</div></div>`;
    }
  }
  $('#tblwrap').innerHTML = h + '</div>';
}
// ---------- phone: day chips + the day as cards
function renderDays() {
  const ds = days().slice(0, 7), chips = $('#daychips');
  if (!isPhone()) { chips.innerHTML = ''; return; }
  chips.innerHTML = ds.map(d => { let c = '·', cls = ''; if (state.view === 'jobs') { const k = baseJobs().filter(j => j.s <= d && j.e >= d), cl = k.filter(j => clashRuns(j).length).length; c = cl ? 'clash' : k.length ? k.length + (k.length === 1 ? ' job' : ' jobs') : '·'; cls = cl ? 'open' : ''; } else { const s = MODELS.filter(x => C(x, d).short > 0).length; c = s ? s + ' short' : 'ok'; cls = s ? 'open' : ''; } return `<button class="chip ${state.day === d ? 'on' : ''}" data-act="day" data-d="${d}"><b>${wdOf(d)} ${dnum(d)}</b><span class="chip-count ${cls}">${c}</span></button>`; }).join('');
}
function renderList() {
  const list = $('#list'), d = state.day;
  if (!isPhone()) { list.innerHTML = ''; return; }
  if (state.view === 'jobs') {
    const L = jobsShown().filter(j => j.s <= d && j.e >= d);
    list.innerHTML = L.length ? L.map(j => { const sel = state.sel.has(j.num), cr = clashRuns(j).length, wr = wouldRuns(j).length, k = dayNum(d) - dayNum(j.s) + 1, tot = dayNum(j.e) - dayNum(j.s) + 1;
      return `<div class="lrow ${sel ? 'sel' : ''}" data-act="jobopen" data-id="${j.num}"><button class="cb ${sel ? 'on' : ''}" data-act="select" data-id="${j.num}" aria-label="Select"></button><div class="grow"><div class="ttl ell"><span class="jn">#${j.num}</span>${esc(j.name)}</div><div class="sub ell">${esc(j.client)} · ${fr(j.s, j.e)}</div></div><div class="right">${swd(j)}${cr ? '<div><span class="dotw err" style="font-size:11.5px">clash</span></div>' : wr ? '<div><span class="dotw warn" style="font-size:11.5px">would clash</span></div>' : isHard(j) ? '' : '<div class="faint" style="font-size:11.5px">pencilled</div>'}</div><button class="dots" data-act="jobmenu" data-id="${j.num}" aria-label="Job actions">${ICON.dots}</button></div>`; }).join('')
      : `<div class="empty"><b>Nothing on ${fmtDay(d)}</b>${hasF() || state.seg !== 'all' ? 'No job matches those filters.' : 'No job is live this day.'}</div>`;
    return;
  }
  const L = modelsShown(); let h = '';
  for (const cat of CATS) { const ms = L.filter(x => x.cat === cat); if (!ms.length) continue; h += `<div class="sech ${h ? '' : 'first'}">${cat}<span class="n">${ms.length}</span></div>`;
    h += ms.map(mo => { const c = C(mo, d), sel = state.sel.has('m_' + mo.k); return `<div class="lrow ${sel ? 'sel' : ''}" data-act="gcell" data-m="${mo.k}" data-d="${d}"><button class="cb ${sel ? 'on' : ''}" data-act="select" data-id="m_${mo.k}" aria-label="Select"></button><div class="grow"><div class="ttl ell">${esc(mo.name)}</div><div class="sub ell">${mo.owned} owned${c.hard ? ` · held ${c.hard}` : ''}${c.extra > 0 ? ` · pencilled −${c.extra}` : ''}</div></div><div class="right">${c.short > 0 ? `<span class="dotw err">short ${c.short}</span>` : `<b class="mono" style="font-size:15px">${c.free}</b> <span class="faint" style="font-size:12px">free</span>`}</div><button class="dots" data-act="gearmenu" data-m="${mo.k}" aria-label="Model actions">${ICON.dots}</button></div>`; }).join(''); }
  list.innerHTML = h || `<div class="empty"><b>No models match that</b>Loosen a filter.</div>`;
}
function renderFoot() {
  $('#foot').innerHTML = state.view === 'jobs' ? `<span>Solid bar holds gear · dashed bar is pencilled and holds nothing</span>` : `<span>Free = serviceable − held by confirmed jobs · pencilled jobs never count until confirmed</span>`;
}
function renderBulk() {
  const n = state.sel.size, b = $('#bulk'); b.classList.toggle('open', n > 0); document.body.classList.toggle('hassel', n > 0); if (!n) return;
  let verbs = '';
  if (state.view === 'jobs') {
    const js = [...state.sel].map(jobBy).filter(Boolean), cf = js.filter(j => j.status === 'QUOTED').length;
    verbs = (cf ? `<button class="btn btn-secondary btn-sm" data-act="confirmsel">Confirm ${cf}</button>` : '') + `<button class="btn btn-secondary btn-sm" data-act="movesel">Move dates…</button>`;
  } else {
    const ms = [...state.sel].map(i => MK[i.slice(2)]).filter(m => m && mRange(m).some(c => c.short > 0));
    verbs = ms.length ? `<button class="btn btn-secondary btn-sm" data-act="subsel">Sub-hire ${ms.length} short</button>` : `<span class="muted t-small">none of these is short</span>`;
  }
  b.innerHTML = `<b style="font-size:13px">${n} selected</b>${verbs}<button class="btn btn-icon btn-sm" data-act="clearsel" aria-label="Clear selection">✕</button>`;
}

// ---------- sheets (side on desktop, bottom on phone)
function openSide(html) {
  if (isPhone()) { body.innerHTML = `<div class="sheetwrap"><div class="grab"></div>${html}<div style="height:8px"></div></div>`; layer.classList.add('open', 'dim'); }
  else { body.innerHTML = `<div class="side">${html}</div>`; layer.classList.remove('dim'); layer.classList.add('open'); }
}
const shHead = (kick, title, sub) => `<div class="sh1"><div style="min-width:0"><div class="kick">${kick}</div><h2>${title}</h2>${sub || ''}</div><button class="x" data-act="close" aria-label="Close">✕</button></div>`;
const lk = (t, h) => `<a class="lnk" href="${h}">${t} ›</a>`;
function jobSheet(num) {
  const j = jobBy(num), cr = clashRuns(j), wr = wouldRuns(j), mk = Object.keys(j.lines), units = mk.reduce((n, k) => n + j.lines[k], 0), days_ = dayNum(j.e) - dayNum(j.s) + 1;
  const rows = (runs, cls) => runs.map(r => `<button class="hrow" data-act="gcell" data-m="${r.m.k}" data-d="${r.from}"><span class="dotw ${cls}">short ${r.short}</span><span class="g">${esc(r.m.name)}${r.with.length ? ` · with ${r.with.map(x => '#' + x).join(', ')}` : ''}</span><span class="r">${fr(r.from, r.to)}</span></button>`).join('');
  const html = shHead(`#${j.num}`, esc(j.name), `<div>${swd(j)}<span class="faint" style="font-size:12px;margin-left:8px">${isHard(j) ? 'holds its gear' : 'pencilled · holds nothing'}</span></div>`) +
    `<div class="sb"><dl class="facts"><dt>When</dt><dd>${fmtSpan(j.s, j.e)} <span class="muted">· ${days_} ${days_ === 1 ? 'day' : 'days'}</span></dd>${j.truck ? `<dt>Truck</dt><dd class="mono" style="font-size:12.5px">${j.truck}</dd>` : ''}<dt>Client</dt><dd>${esc(j.client)}${j.contact ? `<span class="muted"> · ${esc(j.contact)}</span>` : ''}</dd><dt>PM</dt><dd>${esc(j.pm)}</dd><dt>Value</dt><dd class="mono">${j.total == null ? '<span class="faint">not quoted</span>' : money(j.total)}</dd><dt>Gear</dt><dd>${mk.length ? `${mk.length} models · ${units} units` : '<span class="faint">none planned</span>'}${j.items ? `<span class="muted"> · ${j.items} lines</span>` : ''}</dd></dl>` +
    (cr.length ? `<div class="sbh">Clashes <span class="n">${cr.length}</span></div>${rows(cr, 'err')}` : '') +
    (wr.length ? `<div class="sbh">Would clash if confirmed <span class="n">${wr.length}</span></div>${rows(wr, 'warn')}` : '') +
    `<div class="sacts"><a class="btn btn-secondary" href="${U.over}">Open job</a>${lk('Equipment', U.equip)}${lk('Logistics', U.logi)}</div>` +
    `<div class="sacts" style="border-top:0;padding-top:4px">${j.status === 'QUOTED' ? `<button class="lnk" data-act="confirmone" data-id="${j.num}">Confirm…</button>` : ''}${movable(j) ? `<button class="lnk" data-act="moveone" data-id="${j.num}">Move dates…</button>` : '<span class="faint t-small">Out of the building · dates are locked</span>'}</div></div>`;
  openSide(html);
}
function cellSheet(mk, d) {
  const m = MK[mk], c = C(m, d), run = shortRun(m, d), reqs = run ? state.sub.filter(s => s.k === mk && s.from <= run.to && s.to >= run.from) : subFor(mk, d);
  const head = run ? `<span class="dotw err">short ${run.short}</span><span class="faint" style="font-size:12px;margin-left:8px">${fr(run.from, run.to)}</span>` : `<span class="mono" style="font-size:13px">${c.free} free</span>${c.extra > 0 ? ` <span class="dotw warn" style="margin-left:6px">pencilled −${c.extra}</span>` : ''}<span class="faint" style="font-size:12px;margin-left:8px">${fmtDay(d)}</span>`;
  const row = ([j, q], cls = '') => `<button class="hrow" data-act="jobopen" data-id="${j.num}"><span class="jn">#${j.num}</span><span class="g ${cls}">${esc(j.name)}</span><span class="r">${q}</span></button>`;
  const html = shHead(m.cat, esc(m.name), `<div>${head}</div>`) +
    `<div class="sb"><dl class="facts"><dt>Day</dt><dd>${fmtDay(d)}</dd><dt>Serviceable</dt><dd class="mono">${c.svc} <span class="muted">of ${m.owned}</span>${m.oos ? `<div class="muted" style="font-size:12px;font-family:var(--sans)">${m.oos} in service${m.note ? ` · ${esc(m.note)}` : ''}</div>` : ''}</dd><dt>Held</dt><dd class="mono">${c.hard}</dd><dt>Free</dt><dd class="mono">${run ? '<span style="color:var(--t-out)">−' + c.short + '</span>' : c.free}</dd></dl>` +
    (c.hj.length ? `<div class="sbh">Held by <span class="n">${c.hj.length}</span></div>${c.hj.map(x => row(x)).join('')}` : '') +
    (c.pj.length ? `<div class="sbh">Pencilled, holds nothing <span class="n">${c.pj.length}</span></div>${c.pj.map(x => row(x, 'muted')).join('')}${c.extra > 0 ? `<div style="font-size:12.5px;padding:6px 0 0"><span class="dotw warn">pencilled −${c.extra}</span> <span class="muted">would be short ${c.extra} if ${c.pj.map(x => '#' + x[0].num).join(' + ')} ${c.pj.length > 1 ? 'confirm' : 'confirms'}</span></div>` : ''}` : '') +
    (reqs.length ? `<div class="sbh">Sub-hire requested <span class="n">${reqs.length}</span></div>${reqs.map(s => `<div class="hrow"><span class="g">${esc(s.supplier)}</span><span class="r">${s.qty} · ${fr(s.from, s.to)}</span></div>`).join('')}<div class="muted" style="font-size:12px;padding-top:4px">The shortfall stays until the gear arrives.</div>` : '') +
    `<div class="sacts">${run ? `<button class="btn btn-secondary" data-act="subone" data-m="${mk}" data-d="${d}">Sub-hire ${run.short}…</button>` : ''}${lk('Overbookings', U.gear)}${lk('Open model', U.model)}</div></div>`;
  openSide(html);
}
function daySheet(d) {
  const L = state.jobs.filter(j => j.s <= d && j.e >= d), sh = MODELS.filter(m => C(m, d).short > 0);
  const html = shHead(wdOf(d), `${fmtD(d)}`, `<div class="muted" style="font-size:12.5px">${L.length} ${L.length === 1 ? 'job' : 'jobs'} live${sh.length ? ` · ${sh.length} short` : ''}</div>`) +
    `<div class="sb">${L.length ? `<div class="sbh" style="border-top:0">Live jobs <span class="n">${L.length}</span></div>${L.map(j => `<button class="hrow" data-act="jobopen" data-id="${j.num}"><span class="jn">#${j.num}</span><span class="g">${esc(j.name)}</span><span class="r" style="font-family:var(--sans)">${swd(j)}</span></button>`).join('')}` : '<div class="empty" style="padding:24px 0"><b>Nothing booked</b>No job is live this day.</div>'}${sh.length ? `<div class="sbh">Short <span class="n">${sh.length}</span></div>${sh.map(m => `<button class="hrow" data-act="gcell" data-m="${m.k}" data-d="${d}"><span class="dotw err">short ${C(m, d).short}</span><span class="g">${esc(m.name)}</span></button>`).join('')}` : ''}</div>`;
  openSide(html);
}

// ---------- dialogs
const dlg = (kick, title, bodyH, foot) => `<div class="hd"><div class="t-overline">${kick}</div><h2 style="font-size:18px">${title}</h2></div><div class="bd" style="gap:14px">${bodyH}</div><div class="ft">${foot}</div>`;
const footBtns = (go, label, extra = '') => `${extra}<div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" id="dlg-go" data-act="${go}">${label}</button>`;
function impactRows(imps, verb) { return imps.map(i => `<div class="impact"><div><span class="dotw err">short ${i.short}</span> <b>${esc(i.m.name)}</b> <span class="muted">· ${fr(i.from, i.to)}</span></div><div class="why">${i.with.length ? i.with.map(x => `#${x} ${esc(jobBy(x).name)}`).join(', ') + ` would be short ${i.short} × ${esc(i.m.name)}${verb === 'Confirming' ? ` if #${i.job.num} confirms` : ` once #${i.job.num} moves`}` : `${verb} #${i.job.num} takes the last of the stock`}</div></div>`).join(''); }
function headsUp(kick, title, intro, imps, verb, goAct, goLabel) {
  openDialog(dlg(kick, `<span class="gate-ico">${ICON.warn}</span>${title}`, `<div class="t-small muted" style="line-height:1.5">${intro}</div><div>${impactRows(imps, verb)}</div><div class="t-small muted">This is a heads-up, not a block. You can go ahead and fix the stock after.</div>`, footBtns(goAct, goLabel)));
}
function requestConfirm(ids) {
  const js = ids.map(jobBy).filter(Boolean), ok = js.filter(j => j.status === 'QUOTED'), skipped = js.length - ok.length;
  if (!ok.length) { toast(`Nothing to confirm · ${skipped} skipped (only Quoted jobs can be confirmed)`); return; }
  const nums = ok.map(j => j.num); let imps = [];
  try { imps = confirmImpact(nums); } catch (e) { imps = []; }           // fails OPEN: a broken preview never blocks the write
  state.pending = { nums, skipped };
  if (!imps.length) { doConfirm(); return; }
  closeLayer(); headsUp('Confirm', `Confirming ${nums.length === 1 ? '#' + nums[0] : nums.length + ' jobs'} leaves ${imps.length === 1 ? 'a model' : imps.length + ' models'} short`, 'Pencilled jobs hold nothing. Once confirmed they take real stock, and some of it is already held.', imps, 'Confirming', 'confirmgo', `Confirm ${nums.length}${imps.length ? ' anyway' : ''}`);
}
function doConfirm() {
  const { nums, skipped } = state.pending, undo = snapshot();
  state.jobs.forEach(j => { if (nums.includes(j.num)) j.status = 'CONFIRMED'; });
  state.sel.clear(); closeLayer(); render();
  const nc = nums.reduce((n, x) => n + clashRuns(jobBy(x)).length, 0);
  toast(`Confirmed ${nums.length}${skipped ? ` · ${skipped} skipped (only Quoted jobs can be confirmed)` : ''}${nc ? ` · ${nc} clash${nc > 1 ? 'es' : ''} to sort` : ''}`, undo);
}
const BYS = [[-7, '1 week earlier'], [-2, '2 days earlier'], [-1, '1 day earlier'], [1, '1 day later'], [2, '2 days later'], [3, '3 days later'], [7, '1 week later']];
function moveDialog(ids) {
  const js = ids.map(jobBy).filter(Boolean), mv = js.filter(movable), locked = js.length - mv.length;
  if (!mv.length) { closeLayer(); toast('Out of the building · deployed and on-site jobs keep their dates'); return; }
  state.mv = { nums: mv.map(j => j.num), by: state.mv && state.mv.by || 1, locked };
  moveDialogRender();
}
function moveDialogRender() {
  const { nums, by, locked } = state.mv, js = nums.map(jobBy);
  openDialog(dlg('Move dates', `Move ${js.length === 1 ? '#' + js[0].num + ' ' + esc(js[0].name) : js.length + ' jobs'}`, `${field('Move by', `<select id="mv-by">${BYS.map(([v, l]) => opt(v, l, by)).join('')}</select>`)}<div>${js.slice(0, 6).map(j => `<div class="impact"><div><span class="mono muted">#${j.num}</span> ${esc(j.name)}</div><div class="why mono">${fr(j.s, j.e)} → <span style="color:var(--ink)">${fr(addD(j.s, by), addD(j.e, by))}</span></div></div>`).join('')}${js.length > 6 ? `<div class="t-small muted">and ${js.length - 6} more</div>` : ''}</div>${locked ? `<div class="t-small muted">${locked} skipped · deployed and on-site jobs keep their dates.</div>` : ''}`, footBtns('movego', 'Move dates')));
}
function doMove() {
  const { nums, by, locked } = state.mv, undo = snapshot();
  state.jobs.forEach(j => { if (nums.includes(j.num)) { j.s = addD(j.s, by); j.e = addD(j.e, by); } });
  state.jobs.sort((a, b) => a.s.localeCompare(b.s) || a.num.localeCompare(b.num)); state.sel.clear(); closeLayer(); render();
  const nc = state.jobs.filter(j => isHard(j) && clashRuns(j).length).length;
  toast(`Moved ${nums.length} ${nums.length === 1 ? 'job' : 'jobs'} ${by > 0 ? 'later' : 'earlier'} by ${Math.abs(by)}d${locked ? ` · ${locked} skipped (out of the building)` : ''}${nc ? '' : ' · no clashes'}`, undo);
}
const SUPPLIERS = ['Scene Change', 'Big Picture', 'Chameleon Touring'];
function subDialog(items) {
  state.sh = { items, supplier:'Big Picture' };
  openDialog(dlg('Sub-hire', items.length === 1 ? `Sub-hire ${esc(items[0].m.name)}` : `Sub-hire ${items.length} short models`, `${field('Supplier', `<select id="sh-sup">${SUPPLIERS.map(s => opt(s, s, 'Big Picture')).join('')}</select>`)}<div>${items.map((it, i) => `<div class="impact" style="flex-direction:row;align-items:center;gap:12px"><div style="flex:1;min-width:0"><div class="ell"><b>${esc(it.m.name)}</b></div><div class="why">${fr(it.from, it.to)} · short ${it.short}</div></div><input type="number" min="1" id="sh-q${i}" value="${it.short}" style="width:76px;text-align:right;font-family:var(--mono)" aria-label="Quantity"></div>`).join('')}</div><div class="t-small muted" style="line-height:1.5">A request goes to the supplier as a draft. The shortfall stays on the schedule until the gear arrives.</div>`, footBtns('subgo', 'Request sub-hire')));
}
const shortItem = (m, d) => { const r = shortRun(m, d); return r && { m, from:r.from, to:r.to, short:r.short }; };

// ---------- menus
function multi(el, key, title, options, labelOf = x => x) { openMenu(el, title, [...options.map(o => ({ label:labelOf(o), act:'ftoggle', args:`data-k="${key}" data-v="${o}"`, on:state.f[key].includes(o) })), '-', { label:'Clear', act:'fclear', args:`data-k="${key}"` }]); }
function selectRange(id, order, ev) { if (ev && ev.shiftKey && state.lastSel && order.includes(state.lastSel)) { const a = order.indexOf(state.lastSel), b = order.indexOf(id); for (const k of order.slice(Math.min(a, b), Math.max(a, b) + 1)) state.sel.add(k); } else state.sel.has(id) ? state.sel.delete(id) : state.sel.add(id); state.lastSel = id; }
const shiftRange = (dir) => {
  if (isPhone() || state.zoom === 'week') { state.anchor = addD(weekOf(phoneAnchor()), 7 * dir); state.day = addD(state.day, 7 * dir); }
  else state.anchor = addMonth(state.anchor, dir);
};

function act(name, el, ev) {
  const id = el.dataset.id;
  switch (name) {
    case 'close': closeLayer(); break;
    case 'noop': closeLayer(); toast('Not wired in this prototype'); break;
    case 'view': state.view = el.dataset.v; state.sel.clear(); state.seg = 'all'; closeLayer(); render(); break;
    case 'seg': state.seg = el.dataset.k; state.sel.clear(); closeLayer(); render(); break;
    case 'nav': { const d = +el.dataset.d; if (d === 0) { state.anchor = state.zoom === 'month' && !isPhone() ? '2026-11-01' : '2026-11-10'; state.day = '2026-11-10'; } else shiftRange(d); state.sel.clear(); closeLayer(); render(); break; }
    case 'zoom': { const z = el.dataset.z; if (z === state.zoom) break; if (z === 'month') state.anchor = monthStart(weekOf(state.anchor)); else state.anchor = monthStart(state.anchor) === '2026-11-01' ? '2026-11-10' : addD(monthStart(state.anchor), (7 - dowM(monthStart(state.anchor))) % 7); state.zoom = z; state.sel.clear(); closeLayer(); render(); break; }
    case 'day': state.day = el.dataset.d; render(); break;
    case 'dayopen': daySheet(el.dataset.d); break;
    case 'fmenu': { const k = el.dataset.k;
      if (k === 'status') multi(el, 'status', 'Status', Object.keys(ST), s => ST[s][0]);
      if (k === 'cat') multi(el, 'cat', 'Category', CATS);
      if (k === 'model') multi(el, 'model', 'Model', MODELS.map(m => m.k), k2 => MK[k2].name);
      if (k === 'pm') multi(el, 'pm', 'PM', PMS);
      break; }
    case 'ftoggle': { const a = state.f[el.dataset.k], v = el.dataset.v, i = a.indexOf(v); i >= 0 ? a.splice(i, 1) : a.push(v); render(); const anchor = $(`#fwords [data-k="${el.dataset.k}"]`); if (anchor) act('fmenu', anchor); break; }
    case 'fclear': state.f[el.dataset.k] = []; closeLayer(); render(); break;
    case 'clearf': state.f = { status:[], cat:[], model:[], pm:[] }; state.q = ''; $('#q').value = ''; state.seg = 'all'; closeLayer(); render(); break;
    case 'pagemenu': { const mine = state.f.pm.length === 1 && state.f.pm[0] === ME;
      openMenu(el, 'Schedule', [{ label:'Only my jobs', act:'mine', on:mine }, '-', { label:'Overbookings', href:U.gear, small:'Gear lists' }, { label:'Crew planner', href:U.planner, small:'Crew' }, { label:'Logistics', href:U.logi, small:'Job tab' }, '-', { label:'Export this range (CSV)', act:'export' }, { label:'Copy link to this view', act:'copylink' }]); break; }
    case 'mine': { const mine = state.f.pm.length === 1 && state.f.pm[0] === ME; state.f.pm = mine ? [] : [ME]; closeLayer(); render(); break; }
    case 'export': closeLayer(); toast(`Exporting ${rangeLabel()} as CSV`); break;
    case 'copylink': closeLayer(); toast('Link copied · the view, range and filters are in the URL'); break;
    case 'new': if (el.tagName === 'A' && ev && ev.type === 'click') break; window.open(U.wizard, '_blank'); break;
    case 'select': { selectRange(id, visibleIds(), ev); render(); break; }
    case 'selall': { const ids = visibleIds(), all = ids.length && ids.every(i => state.sel.has(i)); ids.forEach(i => all ? state.sel.delete(i) : state.sel.add(i)); render(); break; }
    case 'clearsel': state.sel.clear(); render(); break;
    case 'jobopen': { if (ev && ev.target.closest('.cb,.dots,a')) break; jobSheet(id); break; }
    case 'jobmenu': { const j = jobBy(id);
      openMenu(el, `#${j.num} ${esc(j.name)}`, [{ label:'Open job', href:U.over, small:'Overview' }, { label:'Equipment', href:U.equip, small:'tab' }, { label:'Logistics', href:U.logi, small:'tab' }, '-', ...(j.status === 'QUOTED' ? [{ label:'Confirm…', act:'confirmone', args:`data-id="${id}"` }] : []), ...(movable(j) ? [{ label:'Move dates…', act:'moveone', args:`data-id="${id}"` }] : []), '-', { label:'Copy link', act:'copylink' }]); break; }
    case 'gcell': cellSheet(el.dataset.m, el.dataset.d || days()[0]); break;
    case 'gmodel': { if (ev && ev.target.closest('.cb,.dots,a')) break; const m = MK[el.dataset.m], c = days().find(d => C(m, d).short > 0) || days()[0]; cellSheet(m.k, c); break; }
    case 'gearmenu': { const m = MK[el.dataset.m], r = days().map(d => shortItem(m, d)).find(Boolean);
      openMenu(el, esc(m.name), [{ label:'Open model', href:U.model, small:'Model' }, { label:'Overbookings', href:U.gear, small:'Gear lists' }, ...(r ? ['-', { label:`Sub-hire ${r.short}…`, act:'subone', args:`data-m="${m.k}" data-d="${r.from}"` }] : [])]); break; }
    case 'confirmone': closeLayer(); requestConfirm([id]); break;
    case 'confirmsel': closeLayer(); requestConfirm([...state.sel]); break;
    case 'confirmgo': doConfirm(); break;
    case 'moveone': closeLayer(); moveDialog([id]); break;
    case 'movesel': closeLayer(); moveDialog([...state.sel]); break;
    case 'movego': { const { nums, by } = state.mv; let imps = []; try { imps = moveImpact(nums, by); } catch (e) { imps = []; }
      if (!imps.length) { doMove(); break; }
      closeLayer(); headsUp('Move dates', `Moving ${nums.length === 1 ? '#' + nums[0] : nums.length + ' jobs'} ${by > 0 ? 'later' : 'earlier'} by ${Math.abs(by)}d leaves ${imps.length === 1 ? 'a model' : imps.length + ' models'} short`, 'Gear is held by date. The new dates land on stock another confirmed job already holds.', imps, 'Moving', 'movegogo', 'Move anyway'); break; }
    case 'movegogo': doMove(); break;
    case 'subone': { const it = shortItem(MK[el.dataset.m], el.dataset.d); closeLayer(); if (it) subDialog([it]); break; }
    case 'subsel': { const its = [...state.sel].map(i => MK[i.slice(2)]).filter(Boolean).map(m => days().map(d => shortItem(m, d)).find(Boolean)).filter(Boolean); closeLayer(); if (its.length) subDialog(its); break; }
    case 'subgo': { const sup = $('#sh-sup').value, undo = snapshot(), its = state.sh.items; let n = 0; its.forEach((it, i) => { const q = Math.max(1, +$(`#sh-q${i}`).value || it.short); state.sub.push({ k:it.m.k, qty:q, from:it.from, to:it.to, supplier:sup }); n += q; });
      state.sel.clear(); closeLayer(); render(); toast(`Sub-hire requested from ${esc(sup)} · ${its.length === 1 ? `${n} × ${esc(its[0].m.name)}` : `${n} units across ${its.length} models`} · still short until it arrives`, undo); break; }
    case 'undo': if (state.undo) { state.undo(); state.undo = null; } $('#toast').classList.remove('open'); break;
    case 'toastclose': $('#toast').classList.remove('open'); break;
  }
}
document.addEventListener('input', ev => { if (ev.target.id === 'q') { state.q = ev.target.value; render(); } });
document.addEventListener('change', ev => { if (ev.target.id === 'mv-by' && state.mv) { state.mv.by = +ev.target.value; moveDialogRender(); } });
render();
