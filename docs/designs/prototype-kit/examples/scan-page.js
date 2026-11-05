// ---------- Scan · check + test & tag · data
const TODAY = '2026-11-09';
const L = { ASSET:'https://claude.ai/artifact/Rr5rwirCUMRy8gf5G6Vz7s', LISTS:'https://claude.ai/artifact/D7N5PmXKrkcY2gzZXWeuvc', FLOOR:'https://claude.ai/artifact/6xqFcEZZk49w86p5pAsisA', HOME:'https://claude.ai/artifact/RPnGj7WnaWcknvQ8ShcRkf', PEOPLE:'https://claude.ai/artifact/LPdsNGb4CRMfS6qk7j7Fsa', FINANCE:'https://claude.ai/artifact/5VnYTVW2pdA5r1qBRvdrom', SETTINGS:'https://claude.ai/artifact/Q3TeWuQPjzvXbAtmUV8Hg8',
  JOB:'https://claude.ai/artifact/RatKsWfTmDJLJHmn6mb7Zo', JOBS:'https://claude.ai/artifact/A7SMPtpTr3aedUDEnuSaxd', ASSETS:'https://claude.ai/artifact/89PDTuMiovgP9i3h4MJ1Tw' };
const ME = 'Jayden Cole', TESTERS = ['Jayden Cole','Sam Okafor','Tom Nguyen','Mel Torres'];
const rnd = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(11);
const pick = a => a[Math.floor(rnd() * a.length)];
const addD = (d, n) => new Date((dayNum(d) + n) * 864e5).toISOString().slice(0,10);
const addMonths = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCMonth(t.getUTCMonth() + n); return t.toISOString().slice(0,10); };
const fmtDY = d => d.slice(0,4) === TODAY.slice(0,4) ? fmtD(d) : `${fmtD(d)} ${d.slice(0,4)}`;
const fmtW = d => `${WD[new Date(d + 'T00:00:00Z').getUTCDay()]} ${fmtD(d)}`;
const hhmm = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;

// Check items per model (the live ad-hoc check reads these from the model). t: pf pass/fail · m measurement · dd dropdown · n notes
const CHK = {
  head: [ {id:'lens',l:'Lens and front glass clean, no cracks',s:'Lens',t:'pf'}, {id:'yoke',l:'Yoke, clamp and safety fixing secure',s:'Yoke',t:'pf'}, {id:'home',l:'Pan and tilt home without noise',s:'Pan/tilt',t:'pf'}, {id:'fan',l:'Fans run, no overheating smell',s:'Fans',t:'pf'}, {id:'hrs',l:'Engine hours',s:'Engine hours',t:'m',u:'h',max:8000}, {id:'cos',l:'Cosmetic condition',s:'Cosmetic',t:'dd',o:[['Good',0],['Scuffed',0],['Damaged',1]]}, {id:'nt',t:'n'} ],
  pack: [ {id:'bat',l:'Battery contacts clean',s:'Contacts',t:'pf'}, {id:'dsp',l:'Display and buttons work',s:'Display',t:'pf'}, {id:'ant',l:'Antenna intact',s:'Antenna',t:'pf'}, {id:'cyc',l:'Battery cycles',s:'Cycles',t:'m',u:'cyc',max:300}, {id:'nt',t:'n'} ],
  rx: [ {id:'ant',l:'Antenna sockets undamaged',s:'Sockets',t:'pf'}, {id:'ear',l:'Rack ears straight',s:'Rack ears',t:'pf'}, {id:'pnl',l:'Front panel and display clear',s:'Panel',t:'pf'}, {id:'nt',t:'n'} ],
  proj: [ {id:'lens',l:'Lens clean, mount secure',s:'Lens',t:'pf'}, {id:'flt',l:'Air filters clean',s:'Filters',t:'pf'}, {id:'fan',l:'Fans run quietly',s:'Fans',t:'pf'}, {id:'hrs',l:'Light source hours',s:'Hours',t:'m',u:'h',max:20000}, {id:'nt',t:'n'} ],
  kit: [ {id:'cnt',l:'All four receivers present',s:'Receivers',t:'pf'}, {id:'ant',l:'Antennas and cables present',s:'Antennas',t:'pf'}, {id:'cas',l:'Case latches and foam intact',s:'Case',t:'pf'}, {id:'nt',t:'n'} ],
  distro: [ {id:'brk',l:'Breakers reset and labelled',s:'Breakers',t:'pf'}, {id:'out',l:'Outlets undamaged',s:'Outlets',t:'pf'}, {id:'nt',t:'n'} ],
  none: [],
};
// Test & tag profiles. `tests` rows are data-driven; thresholds are the profile's, never typed by the tester.
const PROFILES = {
  classI: { name:'Class I appliance', tests:[ {k:'earth',l:'Earth continuity',u:'Ω',th:1.0,op:'lt'}, {k:'ins',l:'Insulation resistance',u:'MΩ',th:1.0,op:'gte'}, {k:'leak',l:'Leakage current',u:'mA',th:5,op:'lte'} ] },
  classII: { name:'Class II appliance', noEarthPin:true, tests:[ {k:'ins',l:'Insulation resistance',u:'MΩ',th:2.0,op:'gte'}, {k:'leak',l:'Leakage current',u:'mA',th:5,op:'lte'} ] },
  distro: { name:'Power distribution', sub:true, outlets:6, tests:[ {k:'pol',l:'Polarity',kind:'pf'} ], subTests:[ {k:'e',l:'Earth',u:'Ω',th:1.0,op:'lt'}, {k:'i',l:'Insulation',u:'MΩ',th:1.0,op:'gte'} ] },
};
const VIS = [['cord','Cord condition, no cuts or abrasion'],['plug','Plug intact, pins straight'],['housing','Housing intact, no cracks'],['switch','Switches operate correctly'],['vents','Ventilation openings clear'],['grip','Cord grip secure'],['earthpin','Earth pin present, correct length'],['marks','Markings legible'],['mods','No unauthorised modifications']];
const METHODS = { INS:'Insulation resistance', LEAK:'Leakage current', BOTH:'Both' };
const ACTIONS = { NONE:'No action', REPAIRED:'Repaired', REMOVED:'Removed from service', ELEC:'Referred to electrician', DISPOSED:'Retire asset' };

const ASSETS = {};
const JOBS = { '2341':'Hilton Sydney gala dinner', '2340':'Launch night', '2338':'Corporate AGM', '2350':'Qantas awards' };
function mk(o) { ASSETS[o.tag] = { cond:'GOOD', maint:null, oos:false, job:null, lastCheck:null, tt:null, ...o }; return ASSETS[o.tag]; }
const chk = (d, by, pass, total) => ({ d, by, pass, total });
const ttl = (cls, months, last, extra={}) => ({ profile:cls, months, last, retired:false, ...extra });
const oct = () => `2026-10-${String(10 + Math.floor(rnd()*19)).padStart(2,'0')}`;
for (let i = 1; i <= 8; i++) {
  const tag = 'AURA-0' + i, prepped = i <= 4;
  mk({ tag, name:'Martin MAC Aura XB', model:'head', cat:'Lighting', serial:`4471-0${389+i}`, where:'Warehouse A / B2', job: prepped ? { n:'2341', state:'Prepped', case:'LX-02' } : null,
    lastCheck: chk(oct(), pick(['Sam Okafor','Tom Nguyen']), 6, 6), tt: ttl('classI', 3, { d:addD('2026-08-10', Math.floor(rnd()*30)), res:'PASS', by:'Sam Okafor', rd:{ earth:'0.2', ins:'41' } }, { ttTag:'TT-04' + (11 + i) }) });
}
Object.assign(ASSETS['AURA-01'], { lastCheck: chk('2026-10-28','Sam Okafor',6,6), tt: ttl('classI', 12, { d:'2025-11-19', res:'PASS', by:'Sam Okafor', rd:{ earth:'0.18', ins:'42' } }, { ttTag:'TT-0412' }) });
Object.assign(ASSETS['AURA-07'], { lastCheck:null, tt: ttl('classI', 3, { d:'2026-07-02', res:'PASS', by:'Tom Nguyen', rd:{ earth:'0.3', ins:'38' } }, { ttTag:'TT-0418' }) });
Object.assign(ASSETS['AURA-08'], { where:'Workshop', maint:'MJ-0177' });
for (let i = 1; i <= 8; i++) {
  const tag = 'L-000' + i, out = [1,2,3,4,7].includes(i);
  mk({ tag, name:'Martin MAC Aura PXL', model:'head', cat:'Lighting', serial:`5120-00${40+i}`, where: out ? 'Carriageworks, Eveleigh' : 'Warehouse A / B3', job: out ? { n:'2340', state:'Out', back:'2026-11-11' } : null,
    lastCheck: chk(oct(), 'Sam Okafor', 6, 6), tt: ttl('classI', 3, { d:addD('2026-08-20', Math.floor(rnd()*25)), res:'PASS', by:'Sam Okafor', rd:{ earth:'0.2', ins:'45' } }, { ttTag:'TT-05' + (20 + i) }) });
}
for (let i = 10; i <= 16; i++) mk({ tag:'SK-00' + i, name:'Sennheiser EW-DX SK beltpack', model:'pack', cat:'Audio', serial:`2209-${3300+i}`, where:'Warehouse A / A3-14', lastCheck: chk(oct(), 'Tom Nguyen', 4, 4) });
ASSETS['SK-0012'].lastCheck = chk('2026-11-05','Tom Nguyen',4,4);
for (let i = 0; i <= 4; i++) mk({ tag:'A-030' + i, name:'Sennheiser EM4 receiver', model:'rx', cat:'Audio', serial:`1188-${700+i}`, where:'Warehouse A / A3-15', lastCheck: chk(oct(), 'Sam Okafor', 3, 3),
  tt: ttl('classII', 6, { d:addD('2026-05-20', Math.floor(rnd()*60)), res:'PASS', by:'Tom Nguyen', rd:{ ins:'30' } }, { ttTag:'TT-06' + (10 + i) }) });
mk({ tag:'K-0042', name:'Shure ULXD4Q kit', model:'kit', cat:'Audio', serial:'K-0042', where:'Warehouse A / K-bay', lastCheck: chk('2026-10-20','Sam Okafor',3,3), tt: ttl('classII', 6, { d:'2026-06-20', res:'PASS', by:'Tom Nguyen', rd:{ ins:'25' } }, { ttTag:'TT-0701' }) });
mk({ tag:'V-0011', name:'Barco UDX-4K32', model:'proj', cat:'Video', serial:'7710-0011', where:'Warehouse A / V-bay', job:{ n:'2338', state:'Reserved' }, lastCheck: chk('2026-10-03','Tom Nguyen',4,4), tt: ttl('classI', 6, { d:'2026-05-12', res:'PASS', by:'Sam Okafor', rd:{ earth:'0.25', ins:'60' } }, { ttTag:'TT-0733' }) });
mk({ tag:'PD-02', name:'Power distro 6-way', model:'distro', cat:'Power', serial:'PD-02', where:'Warehouse A / P1', lastCheck: chk('2026-10-14','Sam Okafor',2,2), tt: ttl('distro', 3, { d:'2026-09-18', res:'PASS', by:'Tom Nguyen', rd:{ ins:'' } }, { ttTag:'TT-0802' }) });
mk({ tag:'PD-01', name:'Power distro 6-way (old)', model:'distro', cat:'Power', serial:'PD-01', where:'Warehouse A / P1', lastCheck:null, tt: ttl('distro', 3, { d:'2026-02-11', res:'FAIL', by:'Tom Nguyen' }, { retired:true, ttTag:'TT-0801' }) });
mk({ tag:'LX-04', name:'Road case LX-04', model:'none', cat:'Cases', serial:'', where:'Warehouse A / C2', job:{ n:'2341', state:'Prepped' } });
mk({ tag:'BATT-01', name:'Battery box BATT-01', model:'none', cat:'Power', serial:'', where:'Warehouse A / C4' });
ASSETS['A-0304'].oos = true; ASSETS['A-0304'].tt.last = { d:'2026-11-09', res:'FAIL', by:ME };
const ALIAS = {}; Object.values(ASSETS).forEach(a => { if (a.tt && a.tt.ttTag) ALIAS[a.tt.ttTag] = a.tag; });
const SAMPLES = ['AURA-01','L-0007','SK-0012','A-0301','PD-02','AURA-07','LX-04','XX-999'];

// ---------- state
let seq = 1, imgSeq = 412;
const E = (mode, tag, tone, verdict, detail, at, o={}) => ({ id:seq++, mode, tag, tone, verdict, detail, at, kind:'saved', ...o });
const state = { mode:'check', tag:null, drafts:{ check:null, tt:null }, tester:ME, sound:true, clock:10*60+42, showAll:false, undo:null,
  strip: [
    E('check','A-0301','ok','Saved','3 of 3 pass',10*60+39), E('check','SK-0014','ok','Saved','4 of 4 pass',10*60+36), E('check','SK-0011','warn','Saved','1 failed · marked damaged',10*60+33,{ failed:true }),
    E('check','XX-410','err','Unknown tag','Nothing carries this tag',10*60+30,{ kind:'exc' }), E('check','L-0003','ok','Saved','6 of 6 pass',10*60+27), E('check','L-0002','ok','Saved','6 of 6 pass',10*60+24),
    E('check','L-0001','ok','Saved','6 of 6 pass',10*60+20), E('check','AURA-05','ok','Saved','6 of 6 pass',10*60+17),
    E('tt','A-0302','ok','Saved','Pass · next 9 May 2027',10*60+40), E('tt','A-0303','ok','Saved','Pass · next 9 May 2027',10*60+37), E('tt','A-0304','err','Saved','Fail · insulation 0.4 MΩ · removed from service',10*60+34,{ failed:true }),
    E('tt','SK-0012','muted','Not registered','Battery gear is not on the register',10*60+31,{ kind:'exc' }), E('tt','AURA-03','ok','Saved','Pass · next 9 Feb 2027',10*60+28), E('tt','A-0300','ok','Saved','Pass · next 9 May 2027',10*60+25),
  ] };
state.strip.forEach(e => { const a = ASSETS[e.tag]; e.name = a ? a.name : ''; });

// ---------- derived
const A = tag => ASSETS[tag];
const normTag = raw => { const t = String(raw || '').trim().toUpperCase(); return ALIAS[t] || t; };
const dr = () => state.drafts[state.mode];
function kindOf() {
  if (!state.tag) return 'ready'; const a = A(state.tag); if (!a) return 'unknown';
  if (state.mode === 'check') return CHK[a.model].length === 0 ? 'nochecks' : 'asset';
  if (!a.tt) return 'notreg'; if (a.tt.retired) return 'retired'; return 'asset';
}
const dueOf = a => a.tt && a.tt.last && a.tt.last.res === 'PASS' ? addMonths(a.tt.last.d, a.tt.months) : null;
const overdueDays = a => { const due = dueOf(a); return due && !a.tt.retired ? dayNum(TODAY) - dayNum(due) : 0; };
function statusOf(a) {
  if (a.maint) return ['In maintenance', 'warn']; if (a.oos) return ['Out of service', 'err'];
  if (a.job && a.job.state === 'Out') return ['Out', 'err']; if (a.job) return [a.job.state, 'info']; return ['Available', 'ok'];
}
function newDraft(a) {
  if (state.mode === 'check') { const items = {}; CHK[a.model].forEach(it => { if (it.t !== 'n') items[it.id] = { r:null, v:'', note:'', showNote:false, photos:[] }; }); return { touched:false, items, cond:'GOOD', notes:'', photos:[] }; }
  const p = PROFILES[a.tt.profile];
  return { touched:false, vis:{}, lastVis:null, method:'INS', rd:{}, pol:null, outlets: p.sub ? Array.from({ length:p.outlets }, () => ({ e:'', i:'' })) : [], action:'REMOVED', fnotes:'', quick:null };
}
const dirty = () => { const d = dr(); return !!(d && d.touched); };
// -- check mode
const itRes = (it, st) => {
  if (it.t === 'pf') return st.r;
  if (it.t === 'm') { const n = parseFloat(st.v); if (st.v === '' || isNaN(n)) return null; return (it.max != null && n > it.max) || (it.min != null && n < it.min) ? 'FAIL' : 'PASS'; }
  if (it.t === 'dd') { if (!st.v) return null; return it.o.find(o => o[0] === st.v)[1] ? 'FAIL' : 'PASS'; }
};
const rowsOf = a => CHK[a.model].filter(it => it.t !== 'n');
function checkSummary(a, d) {
  const rows = rowsOf(a); let pass = 0, fail = 0, left = 0, need = null;
  rows.forEach(it => { const st = d.items[it.id], r = itRes(it, st); if (!r) left++; else if (r === 'PASS') pass++; else { fail++; if (!need && (!st.note.trim() || !st.photos.length)) need = it; } });
  return { rows:rows.length, pass, fail, left, need };
}
// -- test & tag
const evalOp = (v, th, op) => op === 'lt' ? v < th : op === 'lte' ? v <= th : v >= th;
const opSym = { lt:'<', lte:'≤', gte:'≥' };
const num = s => { const n = parseFloat(s); return s === '' || isNaN(n) ? null : n; };
function ttCalc(a, d) {
  const p = PROFILES[a.tt.profile], vis = VIS.filter(([k]) => !(p.noEarthPin && k === 'earthpin'));
  const ticked = vis.filter(([k]) => d.vis[k]).length;
  const visual = ticked === 0 ? 'PENDING' : ticked === vis.length ? 'PASS' : 'FAIL';
  const tests = p.tests.filter(t => t.kind === 'pf' || (t.k === 'ins' ? d.method !== 'LEAK' : t.k === 'leak' ? d.method !== 'INS' : true));
  let elec = 'PASS', pendingE = null;
  tests.forEach(t => {
    const r = d.rd[t.k] || {};
    if (t.kind === 'pf') { if (!d.pol) { elec = elec === 'FAIL' ? 'FAIL' : 'PENDING'; pendingE = pendingE || t.l; } else if (d.pol === 'FAIL') elec = 'FAIL'; return; }
    if (r.na) return; const n = num(r.v || ''); if (n == null) { if (elec !== 'FAIL') elec = 'PENDING'; pendingE = pendingE || t.l; return; } if (!evalOp(n, t.th, t.op)) elec = 'FAIL';
  });
  let sub = 'PASS'; const subFails = [];
  if (p.sub) d.outlets.forEach((o, i) => { p.subTests.forEach(t => { const n = num(o[t.k]); if (n == null) { if (sub !== 'FAIL') sub = 'PENDING'; } else if (!evalOp(n, t.th, t.op)) { sub = 'FAIL'; subFails.push(i + 1); } }); });
  const all = [visual, elec, p.sub ? sub : 'PASS'];
  const overall = all.includes('PENDING') ? 'PENDING' : all.includes('FAIL') ? 'FAIL' : 'PASS';
  return { p, vis, ticked, visual, tests, elec, sub, subFails, overall, pendingE, next: overall === 'PASS' ? addMonths(TODAY, a.tt.months) : null };
}
function failWhat(a, d, c) {
  const bits = [];
  if (c.visual === 'FAIL') bits.push(`${c.vis.length - c.ticked} visual not ticked`);
  c.tests.forEach(t => { if (t.kind === 'pf') { if (d.pol === 'FAIL') bits.push('polarity'); return; } const r = d.rd[t.k] || {}, n = num(r.v || ''); if (!r.na && n != null && !evalOp(n, t.th, t.op)) bits.push(`${t.l.split(' ')[0].toLowerCase()} ${n} ${t.u}`); });
  if (c.subFails.length) bits.push(`outlet ${c.subFails.join(', ')}`);
  return bits.join(' · ');
}
function blockers() {
  const k = kindOf(); if (k !== 'asset') return 'Scan a tag first'; const a = A(state.tag), d = dr();
  if (state.mode === 'check') { const s = checkSummary(a, d); if (s.need) return `${s.need.s || s.need.l} needs a reason and a photo`; if (s.left) return `${s.left} item${s.left > 1 ? 's' : ''} left to answer`; return ''; }
  const c = ttCalc(a, d); if (c.overall !== 'PENDING') return '';
  if (c.visual === 'PENDING') return 'Visual inspection not done'; if (c.pendingE) return `Enter ${c.pendingE.toLowerCase()}, or mark it N/A`; return 'Sub-test readings missing';
}
function snapshotEntry() { /* each save builds its own closure — see save() */ }

// ---------- render
function render() {
  const f = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.f : null;
  const caret = f && document.activeElement.selectionStart != null ? document.activeElement.selectionStart : null;
  renderChrome(); renderStrip(); renderCard(); renderLast(); renderPrimary();
  if (f) { const el = document.querySelector(`[data-f="${f}"]`); if (el) { el.focus(); try { if (caret != null) el.setSelectionRange(caret, caret); } catch (e) {} } }
}
const MODES = [['check','Check'],['tt','Test & tag']];
const modeName = () => state.mode === 'tt' ? 'Test & tag' : 'Check';
function renderChrome() {
  $('#sidenav').innerHTML = ''; renderNav(state.mode === 'tt' ? 'Test & tag' : 'Warehouse');
  const hrefs = { Dashboard:L.HOME, Jobs:L.JOBS, Finance:L.FINANCE, Crew:L.PEOPLE, Assets:L.ASSETS, Warehouse:L.FLOOR, 'Test & tag':L.LISTS, Maintenance:L.LISTS };
  document.querySelectorAll('#sidenav a').forEach(a => { const h = hrefs[a.textContent.trim()]; if (h) a.setAttribute('href', h); });
  const sf = document.querySelector('.sidebar .foot a'); if (sf) sf.setAttribute('href', L.SETTINGS);
  $('#q').placeholder = state.mode === 'tt' ? 'Scan or enter test tag…' : 'Scan or enter asset tag…';
  $('.camb').innerHTML = ICON.cam;
  $('#headsub').textContent = `Warehouse A · ${fmtW(TODAY)} · ${state.tester}`;
  $('#phonesub').textContent = `${modeName()} · ${state.tester} · Warehouse A`;
}
const savedCount = m => state.strip.filter(e => e.mode === m && e.kind === 'saved').length;
function renderStrip() { $('#strip').innerHTML = MODES.map(([k, n]) => `<button class="${state.mode === k ? 'on' : ''}" data-act="mode" data-m="${k}">${n} <span class="n">${savedCount(k)}</span></button>`).join(''); }
const photoRow = (list, key) => `<div class="phs">${list.map((p, i) => `<div class="ph"><span>${p}</span><button data-act="delph" data-k="${key}" data-p="${i}" aria-label="Remove photo">✕</button></div>`).join('')}<button class="addph" data-act="addph" data-k="${key}">${isPhone() ? 'Take photo' : 'Add photo'}${list.length ? '' : ''}</button></div>`;
const pfWords = (r, a1, a2, data) => `<div class="pf"><button class="pw pass ${r === 'PASS' ? 'on' : ''}" data-act="${a1}" ${data}>Pass</button><button class="pw fail ${r === 'FAIL' ? 'on' : ''}" data-act="${a2}" ${data}>Fail</button></div>`;
const word = r => r ? `<span class="dotw ${r === 'PASS' ? 'ok' : 'err'}">${r === 'PASS' ? 'Pass' : 'Fail'}</span>` : '';
function identity(a) {
  const [st, tone] = statusOf(a), flags = [];
  const od = overdueDays(a); if (od > 0) flags.push(`<span class="dotw err">T&amp;T overdue ${od}d</span>`);
  if (a.cond === 'DAMAGED') flags.push('<span class="dotw err">Damaged</span>');
  if (a.maint) flags.push(`<span class="dotw info">${a.maint}</span>`);
  const idl = [a.cat, a.serial ? `S/N ${a.serial}` : '', state.mode === 'tt' && a.tt && a.tt.ttTag ? a.tt.ttTag : ''].filter(Boolean).join(' · ');
  return `<div class="sc-id"><div style="flex:1;min-width:0"><div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap"><span class="tg">${esc(a.tag)}</span><span class="dotw ${tone}">${st}</span>${flags.join('')}</div><div class="nm ell"><a href="${L.ASSET}">${esc(a.name)}</a></div><div class="idl ell">${esc(idl)}</div></div><button class="dots" data-act="cardmenu" aria-label="Asset actions">${ICON.dots}</button></div>`;
}
function facts(a) {
  const lc = a.lastCheck, tt = a.tt, due = dueOf(a), od = overdueDays(a);
  const jobV = a.job ? `<a href="${L.JOB}">#${a.job.n} ${esc(JOBS[a.job.n])}</a> · ${a.job.state}` : '<span class="muted">No job</span>';
  const whereV = esc(a.where) + (a.job && a.job.case ? ` · in <span class="mono">${a.job.case}</span>` : '');
  const lcV = lc ? `${fmtD(lc.d)} · <span class="mono">${lc.pass}/${lc.total}</span> pass · ${esc(lc.by)}` : '<span class="muted">not checked</span>';
  let ttV = '<span class="muted">Not on the register</span>';
  if (tt) ttV = tt.retired ? '<span class="muted">Retired from the register</span>' : tt.last ? `<a href="${L.LISTS}">${fmtD(tt.last.d)} · ${tt.last.res === 'PASS' ? 'Pass' : 'Fail'}</a>${due ? ` · due <span class="${od > 0 ? 'err' : ''}" style="${od > 0 ? 'color:var(--t-out)' : ''}">${fmtDY(due)}</span>` : ''}` : '<span class="muted">not tested</span>';
  const other = a.job && a.job.state === 'Out' ? `<div class="sc-note"><span class="dotw err">On #${a.job.n} ${esc(JOBS[a.job.n])}</span>Back ${fmtW(a.job.back)}. A ${state.mode === 'tt' ? 'test' : 'check'} here is recorded on the asset, not the job.</div>` : '';
  return `<div class="sfacts"><div class="sf"><div class="k">Where</div><div class="v">${whereV}</div></div><div class="sf"><div class="k">On job</div><div class="v">${jobV}</div></div><div class="sf"><div class="k">Last check</div><div class="v">${lcV}</div></div><div class="sf"><div class="k">Last T&amp;T</div><div class="v">${ttV}</div></div></div>${other}`;
}
function ckRow(it, st) {
  const r = itRes(it, st); let ctl = '';
  if (it.t === 'pf') ctl = pfWords(r, 'ckp', 'ckf', `data-i="${it.id}"`);
  if (it.t === 'm') ctl = `<input class="fin" inputmode="decimal" data-f="v:${it.id}" value="${esc(st.v)}" placeholder="—" aria-label="${esc(it.l)}"><span class="unit2">${it.u}</span><span class="lim">≤ ${it.max}</span>${word(r)}`;
  if (it.t === 'dd') ctl = `<select class="sel2" data-f="dd:${it.id}" aria-label="${esc(it.l)}"><option value="">Choose…</option>${it.o.map(o => `<option ${st.v === o[0] ? 'selected' : ''}>${o[0]}</option>`).join('')}</select>${word(r)}`;
  const nw = r !== 'FAIL' ? `<button class="nw ${st.showNote || st.note ? 'on' : ''}" data-act="cknote" data-i="${it.id}">note</button>` : '';
  const fail = r === 'FAIL' ? `<div class="failbox"><div class="q">What happened? A reason and a photo are required.</div><textarea class="ta" data-f="note:${it.id}" placeholder="Describe the failure…">${esc(st.note)}</textarea>${photoRow(st.photos, it.id)}</div>` : '';
  const note = r !== 'FAIL' && (st.showNote || st.note) ? `<div style="padding:0 0 10px"><textarea class="ta" data-f="note:${it.id}" placeholder="Note for this item…" style="min-height:48px">${esc(st.note)}</textarea></div>` : '';
  return `<div class="ckrow"><div class="ckl">${esc(it.l)}${nw}</div>${ctl}</div>${fail}${note}`;
}
function checkForm(a, d) {
  const s = checkSummary(a, d), failAny = s.fail > 0, cond = failAny ? 'DAMAGED' : d.cond;
  const hasN = CHK[a.model].some(i => i.t === 'n');
  return `<div class="sc-sec"><span>Checklist</span><span class="n">${s.rows - s.left}/${s.rows}</span><span class="sp"></span><button class="w" data-act="passall">Pass all</button></div>
    ${rowsOf(a).map(it => ckRow(it, d.items[it.id])).join('')}
    <div class="fwline" style="border-top:1px solid var(--line)"><span class="lab">Condition</span><div class="fwrow">${[['GOOD','Good'],['WORN','Worn'],['DAMAGED','Damaged']].map(([k, n]) => `<button class="wd ${cond === k ? 'on' : ''} ${failAny && k !== 'DAMAGED' ? 'lock' : ''}" data-act="cond" data-v="${k}">${n}</button>`).join('')}</div>${failAny ? '<span class="t-small muted">set by the failed item</span>' : ''}</div>
    ${hasN ? `<div class="sc-sec"><span>Notes</span></div><textarea class="ta" data-f="notes" placeholder="Anything the next person should know…">${esc(d.notes)}</textarea>` : ''}
    <div class="sc-sec"><span>Photos</span><span class="n">${d.photos.length}</span></div>${photoRow(d.photos, '_')}`;
}
function ttForm(a, d) {
  const c = ttCalc(a, d), p = c.p, vw = c.visual === 'PENDING' ? '<span class="dotw">not inspected</span>' : c.visual === 'PASS' ? '<span class="dotw ok">Pass</span>' : `<span class="dotw err">Fail · ${c.vis.length - c.ticked} not ticked</span>`;
  const ew = c.elec === 'PENDING' ? '<span class="dotw">not entered</span>' : word(c.elec);
  const rows = c.tests.map(t => {
    if (t.kind === 'pf') return `<div class="ckrow"><div class="ckl">${t.l}</div>${pfWords(d.pol, 'polp', 'polf', '')}</div>`;
    const r = d.rd[t.k] || { v:'', na:false }, n = num(r.v || ''), res = r.na ? null : n == null ? null : evalOp(n, t.th, t.op) ? 'PASS' : 'FAIL';
    return `<div class="ckrow"><div class="ckl">${t.l}<div class="lim" style="margin-top:2px">${opSym[t.op]} ${t.th} ${t.u} · <button class="nw ${r.na ? 'on' : ''}" style="margin-left:0" data-act="na" data-k="${t.k}">N/A</button></div></div>${r.na ? '<span class="dotw">N/A</span>' : `<input class="fin" inputmode="decimal" data-f="rd:${t.k}" value="${esc(r.v || '')}" placeholder="—" aria-label="${t.l}"><span class="unit2">${t.u}</span>${word(res) || '<span class="dotw" style="visibility:hidden">Pass</span>'}`}</div>`;
  }).join('');
  const sub = p.sub ? `<div class="sc-sec"><span>Outlets</span><span class="n">${d.outlets.length}</span>${c.sub === 'PENDING' ? '<span class="dotw">not entered</span>' : word(c.sub)}<span class="sp"></span><button class="w" data-act="outminus" aria-label="Remove outlet">−</button><button class="w" data-act="outplus" aria-label="Add outlet">+</button></div>
    ${d.outlets.map((o, i) => { const re = num(o.e), ri = num(o.i), bad = (re != null && !evalOp(re, 1.0, 'lt')) || (ri != null && !evalOp(ri, 1.0, 'gte')), done = re != null && ri != null; return `<div class="outrow"><span class="ol">Outlet ${i + 1}</span><input class="fin w" inputmode="decimal" data-f="out:${i}:e" value="${esc(o.e)}" placeholder="—" aria-label="Outlet ${i + 1} earth"><span class="unit2">Ω</span><input class="fin w" inputmode="decimal" data-f="out:${i}:i" value="${esc(o.i)}" placeholder="—" aria-label="Outlet ${i + 1} insulation"><span class="unit2">MΩ</span><span style="flex:1"></span><span class="dotw ${bad ? 'err' : done ? 'ok' : ''}" aria-label="${bad ? 'Fail' : done ? 'Pass' : 'not entered'}"></span></div>`; }).join('')}` : '';
  const failBlock = c.overall === 'FAIL' ? `<div class="fwline" style="border-top:1px solid var(--line)"><span class="lab">Failure action</span><button class="fw" data-act="factmenu">${ACTIONS[d.action]} ▾</button></div><textarea class="ta" data-f="fnotes" placeholder="Failure notes (optional)…">${esc(d.fnotes)}</textarea><div class="sc-note"><span class="dotw err">Flags the asset</span>${esc(a.tag)} ${d.action === 'REMOVED' ? 'is marked out of service and leaves availability' : d.action === 'DISPOSED' ? 'leaves the register' : 'is flagged'} until retested. Create maintenance job is in ⋯.</div>` : '';
  const resTone = c.overall === 'PASS' ? 'ok' : c.overall === 'FAIL' ? 'err' : '';
  return `<div class="fwline" style="border-top:1px solid var(--line);margin-top:2px"><button class="fw" data-act="tester">Tested by: ${esc(state.tester)} ▾</button><button class="fw" data-act="methodmenu">Method: ${METHODS[d.method]} ▾</button></div>
    ${d.quick ? `<div class="sc-note" style="padding-top:0"><span class="dotw info">Repeated from ${fmtD(d.quick)}</span>Review the ticks and readings, then save.</div>` : ''}
    <div class="sc-sec"><span>Visual inspection</span><span class="n">${c.ticked}/${c.vis.length}</span>${vw}<span class="sp"></span><button class="w" data-act="visall">Pass all</button></div>
    <div class="vgrid">${c.vis.map(([k, l], i) => `<div class="vrow ${d.vis[k] ? 'on' : ''}" data-act="vis" data-k="${k}" data-idx="${i}" role="checkbox" aria-checked="${!!d.vis[k]}"><span class="cb ${d.vis[k] ? 'on' : ''}"></span><span>${l}</span></div>`).join('')}</div>
    <div class="sc-sec"><span>Electrical</span><span class="n">${p.name}</span>${ew}</div>${rows}${sub}
    <div class="sc-sec"><span>Result</span></div>
    <div class="resline"><span class="dotw ${resTone}" style="font-family:var(--display);font-size:18px;font-weight:800">${c.overall === 'PENDING' ? 'not finished' : c.overall === 'PASS' ? 'Pass' : 'Fail'}</span><span class="due">${c.next ? `Next due <b class="mono" style="color:var(--ink)">${fmtDY(c.next)}</b> · every ${a.tt.months} months` : c.overall === 'FAIL' ? 'Next due after repair' : `Next due from the ${a.tt.months}-month interval`}</span></div>${failBlock}`;
}
function renderCard() {
  const k = kindOf(), a = A(state.tag), el = $('#card');
  if (k === 'ready') { el.innerHTML = `<div class="ready"><b>Scan a tag to ${state.mode === 'tt' ? 'test it' : 'check it'}</b>Point the camera at a label, or type the tag and press Enter. Last scans are below.</div>`; return; }
  if (k === 'unknown') { el.innerHTML = `<div class="state"><span class="tg">${esc(state.tag)}</span><div class="h">No asset carries this tag</div><div class="m">Nothing in Two Toned Productions has this tag or test tag. Check the label, or register the asset.</div><div class="acts"><button class="lnk" data-act="focus">Scan again</button><button class="lnk muted" data-act="focus">Type the tag</button><button class="lnk muted" data-act="register">Register an asset with this tag</button></div></div>`; return; }
  if (k === 'nochecks') { el.innerHTML = `${identity(a)}<div class="state" style="padding-top:18px"><div class="h">No check items for this model</div><div class="m">${esc(a.name)} has none, so there is nothing to answer.</div><div class="acts"><a class="lnk" href="${L.SETTINGS}">Add check items ↗</a><button class="lnk muted" data-act="focus">Scan another</button></div></div>`; return; }
  if (k === 'notreg') { el.innerHTML = `${identity(a)}<div class="state" style="padding-top:18px"><div class="h">Not on the test &amp; tag register</div><div class="m">${esc(a.name)} is battery or passive gear, so it has no test profile.</div><div class="acts"><button class="lnk" data-act="addreg">Add to the register</button><button class="lnk muted" data-act="focus">Scan another</button></div></div>`; return; }
  if (k === 'retired') { el.innerHTML = `${identity(a)}${facts(a)}<div class="state" style="padding-top:18px"><div class="h">Retired from test &amp; tag</div><div class="m">${esc(a.tag)} was retired from the register. Reactivating puts it back on the interval and starts this test.</div><div class="acts"><button class="lnk" data-act="reactivate">Reactivate and test</button><button class="lnk muted" data-act="focus">Scan another</button></div></div>`; return; }
  const d = dr();
  const b = blockers();
  el.innerHTML = `${identity(a)}${facts(a)}${state.mode === 'check' ? checkForm(a, d) : ttForm(a, d)}<div class="hintd deskonly"><span>${b || 'Ready to save'}</span><span class="faint">Ctrl ↵ saves · / scans</span></div>`;
}
function primaryHtml() {
  const k = kindOf();
  if (k !== 'asset') return `<button class="btn btn-primary" data-act="scanprimary">Scan</button>`;
  const dis = blockers() ? 'disabled' : '';
  return `<div class="split"><button class="btn btn-primary a" data-act="save" data-v="next" ${dis}>Save and scan next</button><button class="btn btn-primary b" data-act="savemenu" aria-label="More save options" ${dis}>▾</button></div>`;
}
function renderPrimary() {
  const h = primaryHtml(), b = kindOf() === 'asset' ? blockers() : '';
  $('#deskprimary').innerHTML = h;
  const pa = $('#phoneact'); pa.innerHTML = h + `<div class="t-small">${kindOf() === 'asset' ? (b || 'Ready to save') : 'or type a tag above'}</div>`;
}
const toneDot = t => t === 'err' ? 'err' : t === 'warn' ? 'warn' : t === 'ok' ? 'ok' : t === 'info' ? 'info' : '';
function renderLast() {
  const all = state.strip.filter(e => e.mode === state.mode), n = isPhone() ? 3 : 5, rows = state.showAll ? all : all.slice(0, n), left = all.length - rows.length;
  const saved = all.filter(e => e.kind === 'saved'), bad = saved.filter(e => e.failed).length;
  const sum = state.mode === 'tt' ? `${saved.length - bad} pass · ${bad} fail` : `${saved.length - bad} clean · ${bad} failed`;
  $('#last').innerHTML = `<div class="sc-sec" style="padding-top:26px"><span>Last scans</span><span class="n">${all.length}</span><span class="sp"></span><span class="t-small muted">${sum}</span></div>` +
    (all.length ? rows.map(e => `<div class="ls" data-act="rescan" data-tag="${esc(e.tag)}"><div class="l1"><b>${esc(e.tag)}</b><span class="nm ell">${esc(e.name)}</span></div><div class="l2"><span class="dotw ${toneDot(e.tone)}">${esc(e.verdict)}</span><span class="ell">${esc(e.detail)}</span></div><span class="t">${hhmm(e.at)}</span>${e.undo ? `<button class="uw" data-act="stripundo" data-id="${e.id}">Undo</button>` : '<span class="uw none"></span>'}<button class="dots" data-act="lsmenu" data-id="${e.id}" aria-label="Scan actions">${ICON.dots}</button></div>`).join('') : '<div class="lfoot">Nothing scanned yet.</div>') +
    (left > 0 ? `<div class="lmore"><button data-act="showmore">Show ${left} more · ${left} left</button></div>` : state.showAll && all.length > n ? `<div class="lmore"><button data-act="showless">Show fewer</button></div>` : '') +
    `<div class="lfoot">This session only · <a href="${L.LISTS}" style="color:var(--blue)">Test &amp; tag list ↗</a></div>`;
}

// ---------- actions
function tick() { return ++state.clock; }
function pushEntry(e) { state.strip.unshift(e); state.strip = state.strip.slice(0, 40); if (e.undo) { e.exp = Date.now() + 10000; setTimeout(() => { e.undo = null; renderLast(); }, 10000); } }
function scan(raw) {
  const t = normTag(raw); if (!t) return; $('#q').value = '';
  if (t === state.tag) { toast(`${t} is already open`); return; }
  if (dirty()) { openDialog(`<div class="hd"><h2>Discard this ${state.mode === 'tt' ? 'test' : 'check'}?</h2></div><div class="bd"><div class="t-small muted" style="padding:2px 0 8px">${esc(state.tag)} has answers that are not saved. Opening ${esc(t)} drops them.</div></div><div class="ft"><button class="btn btn-ghost btn-sm" data-act="close">Keep editing</button><div style="flex:1"></div><button class="btn btn-primary btn-sm" data-act="discardgo" data-tag="${esc(t)}">Discard and open ${esc(t)}</button></div>`); return; }
  load(t);
}
function load(t) {
  state.tag = t; state.drafts = { check:null, tt:null }; closeLayer();
  const a = A(t), k = kindOf(), at = tick();
  if (k === 'asset') state.drafts[state.mode] = newDraft(a);
  else if (k === 'unknown') pushEntry(E(state.mode, t, 'err', 'Unknown tag', 'Nothing carries this tag', at, { kind:'exc', name:'' }));
  else if (k === 'nochecks') pushEntry(E(state.mode, t, 'muted', 'No check items', 'Model has none', at, { kind:'exc', name:a.name }));
  else if (k === 'notreg') pushEntry(E(state.mode, t, 'muted', 'Not registered', 'Not on the test & tag register', at, { kind:'exc', name:a.name }));
  render(); const c = document.querySelector('.content'); if (c) c.scrollTop = 0;
}
function clearCard() { state.tag = null; state.drafts = { check:null, tt:null }; }
function save(variant) {
  if (blockers()) return; const a = A(state.tag), d = dr(), mode = state.mode;
  const prevA = structuredClone(a), prevTag = state.tag, prevDraft = structuredClone(d), at = tick(); let entry, msg;
  if (mode === 'check') {
    const s = checkSummary(a, d), failed = s.fail > 0;
    a.lastCheck = { d:TODAY, by:state.tester, pass:s.pass, total:s.rows }; a.cond = failed ? 'DAMAGED' : d.cond;
    entry = E('check', a.tag, failed ? 'warn' : 'ok', 'Saved', failed ? `${s.fail} failed · marked damaged` : `${s.pass} of ${s.rows} pass`, at, { name:a.name, failed });
    msg = `Check saved · ${a.tag}${failed ? ' · marked damaged' : ''}`;
  } else {
    const c = ttCalc(a, d), res = c.overall; let detail;
    a.tt.last = { d:TODAY, res, by:state.tester, rd:{ earth:(d.rd.earth || {}).v, ins:(d.rd.ins || {}).v } };
    if (res === 'PASS') { detail = `Pass · next ${fmtDY(c.next)}`; a.oos = false; }
    else { detail = `Fail · ${failWhat(a, d, c)} · ${ACTIONS[d.action].toLowerCase()}`; if (d.action === 'REMOVED') a.oos = true; if (d.action === 'DISPOSED') a.tt.retired = true; }
    entry = E('tt', a.tag, res === 'PASS' ? 'ok' : 'err', 'Saved', detail, at, { name:a.name, failed:res === 'FAIL' });
    msg = `${res === 'PASS' ? 'Pass' : 'Fail'} saved · ${a.tag}`;
  }
  const undo = () => { ASSETS[prevA.tag] = prevA; state.strip = state.strip.filter(e => e.id !== entry.id); if (!state.tag) { state.tag = prevTag; state.mode = mode; state.drafts[mode] = prevDraft; } render(); };
  entry.undo = undo; pushEntry(entry);
  if (variant === 'print') msg += ' · label queued';
  if (variant === 'stay') { state.drafts[mode] = newDraft(A(state.tag)); } else clearCard();
  state.showAll = false; render(); toast(msg, undo);
  if (variant === 'maint') openMaint(prevA.tag, entry);
  else if (!isPhone() && variant !== 'stay') $('#q').focus();
}
function openMaint(tag, entry) {
  const a = A(tag), mode = entry ? entry.mode : state.mode; let issue = '';
  if (entry && entry.failed) issue = (mode === 'tt' ? 'Failed T&T: ' : 'Failed check: ') + entry.detail.replace(/^Fail · /, '').replace(' · marked damaged', '');
  openDialog(`<div class="hd"><div style="display:flex;align-items:center;gap:10px"><span class="tg">${esc(tag)}</span><span class="t-small muted">${esc(a.name)}</span></div><h2>Create maintenance job</h2></div><div class="bd" style="gap:14px">${field('Issue', `<textarea class="ta" id="mIssue" placeholder="What needs doing…">${esc(issue)}</textarea>`)}${field('Priority', `<div class="prio"><button class="wd on" data-act="mprio" data-v="Normal">Normal</button><button class="wd" data-act="mprio" data-v="High">High</button></div>`)}<div class="t-small muted">Opens an unassigned job on ${esc(tag)}; ${a.job ? `#${a.job.n} stays linked.` : 'it is not on a job.'}</div></div><div class="ft"><button class="btn btn-ghost btn-sm" data-act="close">Cancel</button><div style="flex:1"></div><button class="btn btn-primary btn-sm" data-act="maintgo" data-tag="${esc(tag)}">Create job</button></div>`, dlg => { const t = $('#mIssue', dlg); if (t && !isPhone()) t.focus(); });
}
function cameraSheet() {
  const ph = isPhone();
  openDialog(`<div class="vf" style="height:${ph ? 320 : 270}px;margin:12px"><div class="ret"><i></i><i></i><i></i><i></i></div><div style="position:absolute;left:14px;top:12px"><span class="dotw live">Camera live</span></div><div style="position:absolute;right:14px;top:12px" class="t-micro">${modeName()}</div></div><div class="bd" style="padding-top:0;gap:10px"><div class="t-micro muted">No camera in a prototype: tap a tag to simulate a read. The real camera starts from this tap, runs one at a time, and is released when this closes or the app is hidden.</div><div style="display:flex;gap:14px;flex-wrap:wrap">${SAMPLES.map(t => `<button class="samp" data-act="scan" data-tag="${t}">${t}</button>`).join('')}</div><div class="t-micro faint">AURA-01 ready · L-0007 out on another job · SK-0012 not on the register · LX-04 no check items · PD-02 has outlets · XX-999 unknown</div></div><div class="ft"><button class="btn btn-ghost btn-sm" data-act="camtype">Type a tag</button><div style="flex:1"></div><button class="btn btn-secondary btn-sm" data-act="close">Done</button></div>`);
}
const setItem = (id, fn) => { const d = dr(); fn(d.items[id]); d.touched = true; render(); };
function act(name, el, ev) {
  const d = dr();
  switch (name) {
    case 'close': closeLayer(); break;
    case 'noop': closeLayer(); break;
    case 'new': case 'focus': closeLayer(); $('#q').focus(); break;
    case 'mode': { state.mode = el.dataset.m; state.showAll = false; if (kindOf() === 'asset' && !dr()) state.drafts[state.mode] = newDraft(A(state.tag)); render(); break; }
    case 'scanprimary': if (isPhone()) cameraSheet(); else $('#q').focus(); break;
    case 'camera': cameraSheet(); break;
    case 'camtype': closeLayer(); $('#q').focus(); break;
    case 'scan': closeLayer(); scan(el.dataset.tag); break;
    case 'discardgo': load(el.dataset.tag); break;
    case 'rescan': scan(el.dataset.tag); break;
    case 'showmore': state.showAll = true; renderLast(); break;
    case 'showless': state.showAll = false; renderLast(); break;
    case 'pagemenu': openMenu(el, 'Scan', [ {sh:'Session'}, {label:'Scan sounds', act:'sound', on:state.sound, small:state.sound ? 'On' : 'Off'}, {label:'Clear this scan', act:'clear'}, '-', {sh:'Go to'}, {label:'Test & tag list', href:L.LISTS}, {label:'Assets', href:L.ASSETS}, {label:'Check items (settings)', href:L.SETTINGS}, '-', {label:'Clear last scans', act:'clearlast', danger:true} ]); break;
    case 'sound': { state.sound = !state.sound; closeLayer(); toast(`Scan sounds ${state.sound ? 'on' : 'off'}`); break; }
    case 'clear': { if (dirty()) { openDialog(`<div class="hd"><h2>Discard this ${state.mode === 'tt' ? 'test' : 'check'}?</h2></div><div class="bd"><div class="t-small muted" style="padding:2px 0 8px">${esc(state.tag)} has answers that are not saved.</div></div><div class="ft"><button class="btn btn-ghost btn-sm" data-act="close">Keep editing</button><div style="flex:1"></div><button class="btn btn-primary btn-sm" data-act="clearconfirm">Discard</button></div>`); } else { closeLayer(); clearCard(); render(); } break; }
    case 'clearconfirm': closeLayer(); clearCard(); render(); break;
    case 'clearlast': { const prev = state.strip.slice(), pm = state.mode; closeLayer(); state.strip = state.strip.filter(e => e.mode !== pm); render(); toast(`Cleared ${prev.filter(e => e.mode === pm).length} scans`, () => { state.strip = prev; render(); }); break; }
    case 'cardmenu': {
      const a = A(state.tag), tt = state.mode === 'tt', ok = kindOf() === 'asset';
      openMenu(el, `${a.tag} · ${a.name}`, [ {label:'Open asset', href:L.ASSET}, ...(ok && tt && a.tt.last && a.tt.last.rd ? [{label:'Quick pass: repeat the last test', act:'quickpass'}] : []), ...(ok ? [{label: tt ? 'Pass all visual' : 'Pass all', act: tt ? 'visall' : 'passall'}] : []), {label:'Create maintenance job…', act:'maintopen'}, {label:'Print label', act:'printlabel'}, {label:'Open in test & tag list', href:L.LISTS}, '-', {label:'Clear this scan', act:'clear'}, ...(a.tt && !a.tt.retired ? [{label:'Retire from test & tag…', act:'retire', danger:true}] : []) ]); break; }
    case 'maintopen': closeLayer(); openMaint(state.tag, null); break;
    case 'mprio': document.querySelectorAll('.prio .wd').forEach(b => b.classList.toggle('on', b === el)); break;
    case 'maintgo': {
      const tag = el.dataset.tag, a = A(tag), prev = structuredClone(a), id = 'MJ-' + String(188 + seq), at = tick(); a.maint = id;
      const e = E(state.mode, tag, 'info', 'Maintenance job', `${id} opened`, at, { kind:'maint', name:a.name });
      const undo = () => { ASSETS[tag] = prev; state.strip = state.strip.filter(x => x.id !== e.id); render(); };
      e.undo = undo; closeLayer(); pushEntry(e); render(); toast(`Maintenance job ${id} created for ${tag}`, undo); break; }
    case 'printlabel': closeLayer(); toast(`Label queued for ${state.tag}`); break;
    case 'register': closeLayer(); toast('Opens the new-asset sheet with this tag filled in'); break;
    case 'addreg': { const a = A(state.tag), prev = structuredClone(a); a.tt = ttl('classI', 3, null, { ttTag:'TT-09' + String(a.serial || '00').slice(-2) }); closeLayer(); load(a.tag); toast(`${a.tag} added to the register`, () => { ASSETS[prev.tag] = prev; render(); }); break; }
    case 'reactivate': { const a = A(state.tag), prev = structuredClone(a); a.tt.retired = false; load(a.tag); toast(`${a.tag} reactivated`, () => { ASSETS[prev.tag] = prev; state.drafts.tt = null; render(); }); break; }
    case 'retire': { closeLayer(); const a = A(state.tag); openDialog(`<div class="hd"><h2>Retire ${esc(a.tag)} from test &amp; tag?</h2></div><div class="bd"><div class="t-small muted" style="padding:2px 0 8px">It leaves the register and its due date stops counting, so it won't appear in Due or Overdue. Its test history stays.</div></div><div class="ft"><button class="btn btn-ghost btn-sm" data-act="close">Cancel</button><div style="flex:1"></div><button class="btn btn-primary btn-sm" data-act="retirego">Retire</button></div>`); break; }
    case 'retirego': { const a = A(state.tag), prev = structuredClone(a); a.tt.retired = true; state.drafts.tt = null; closeLayer(); render(); toast(`${a.tag} retired from test & tag`, () => { ASSETS[prev.tag] = prev; if (state.tag === prev.tag && !state.drafts.tt && state.mode === 'tt') state.drafts.tt = newDraft(prev); render(); }); break; }
    // ---- check
    case 'ckp': setItem(el.dataset.i, s => s.r = s.r === 'PASS' ? null : 'PASS'); break;
    case 'ckf': setItem(el.dataset.i, s => s.r = s.r === 'FAIL' ? null : 'FAIL'); break;
    case 'cknote': setItem(el.dataset.i, s => s.showNote = !s.showNote); break;
    case 'passall': { const a = A(state.tag), prev = structuredClone(d); let n = 0; rowsOf(a).forEach(it => { const s = d.items[it.id]; if (it.t === 'pf' && !s.r) { s.r = 'PASS'; n++; } }); d.touched = true; closeLayer(); render(); toast(n ? `${n} items marked Pass` : 'Nothing left to pass', n ? () => { state.drafts.check = prev; render(); } : null); break; }
    case 'cond': { if (checkSummary(A(state.tag), d).fail) break; d.cond = el.dataset.v; d.touched = true; render(); break; }
    case 'addph': { const n = 'IMG_0' + (imgSeq++); const k = el.dataset.k; (k === '_' ? d.photos : d.items[k].photos).push(n); d.touched = true; render(); break; }
    case 'delph': { const k = el.dataset.k; (k === '_' ? d.photos : d.items[k].photos).splice(+el.dataset.p, 1); d.touched = true; render(); break; }
    // ---- test & tag
    case 'vis': {
      const a = A(state.tag), c = ttCalc(a, d), idx = +el.dataset.idx, k = el.dataset.k, nv = !d.vis[k];
      if (ev && ev.shiftKey && d.lastVis != null) { const [lo, hi] = [Math.min(idx, d.lastVis), Math.max(idx, d.lastVis)]; for (let i = lo; i <= hi; i++) d.vis[c.vis[i][0]] = nv; } else d.vis[k] = nv;
      d.lastVis = idx; d.touched = true; render(); break; }
    case 'visall': { const a = A(state.tag), prev = structuredClone(d), c = ttCalc(a, d); c.vis.forEach(([k]) => d.vis[k] = true); d.touched = true; closeLayer(); render(); toast('Visual inspection: all pass', () => { state.drafts.tt = prev; render(); }); break; }
    case 'na': { const r = d.rd[el.dataset.k] = d.rd[el.dataset.k] || { v:'', na:false }; r.na = !r.na; d.touched = true; render(); break; }
    case 'polp': d.pol = d.pol === 'PASS' ? null : 'PASS'; d.touched = true; render(); break;
    case 'polf': d.pol = d.pol === 'FAIL' ? null : 'FAIL'; d.touched = true; render(); break;
    case 'outplus': d.outlets.push({ e:'', i:'' }); d.touched = true; render(); break;
    case 'outminus': if (d.outlets.length > 1) { d.outlets.pop(); d.touched = true; render(); } break;
    case 'tester': openMenu(el, 'Tested by', TESTERS.map(t => ({ label:t, act:'settester', args:`data-v="${t}"`, on:t === state.tester }))); break;
    case 'settester': state.tester = el.dataset.v; closeLayer(); render(); toast(`Tester set to ${state.tester} for this session`); break;
    case 'methodmenu': openMenu(el, 'Test method', Object.entries(METHODS).map(([k, n]) => ({ label:n, act:'setmethod', args:`data-v="${k}"`, on:d.method === k }))); break;
    case 'setmethod': d.method = el.dataset.v; d.touched = true; closeLayer(); render(); break;
    case 'factmenu': openMenu(el, 'Failure action', Object.entries(ACTIONS).map(([k, n]) => ({ label:n, act:'setfact', args:`data-v="${k}"`, on:d.action === k }))); break;
    case 'setfact': d.action = el.dataset.v; d.touched = true; closeLayer(); render(); break;
    case 'quickpass': {
      const a = A(state.tag), last = a.tt.last, prev = structuredClone(d), c = ttCalc(a, d); closeLayer();
      if (!last || !last.rd) { toast('No previous record: complete the full test'); break; }
      c.vis.forEach(([k]) => d.vis[k] = true); Object.entries(last.rd).forEach(([k, v]) => { if (v) d.rd[k] = { v, na:false }; });
      if (a.tt.profile === 'distro') d.pol = 'PASS'; d.quick = last.d; d.touched = true; render(); toast(`Filled from ${fmtD(last.d)}`, () => { state.drafts.tt = prev; render(); }); break; }
    // ---- save
    case 'save': save(el.dataset.v || 'next'); break;
    case 'savemenu': { const fail = state.mode === 'tt' ? ttCalc(A(state.tag), dr()).overall === 'FAIL' : checkSummary(A(state.tag), dr()).fail > 0; openMenu(el, 'Save', [ {label:'Save and scan next', act:'save', args:'data-v="next"'}, {label:'Save and keep this asset open', act:'save', args:'data-v="stay"'}, ...(state.mode === 'tt' ? [{label:'Save and print label', act:'save', args:'data-v="print"'}] : []), ...(fail ? [{label:'Save and create maintenance job', act:'save', args:'data-v="maint"'}] : []) ]); break; }
    // ---- last scans
    case 'stripundo': { const e = state.strip.find(x => x.id === +el.dataset.id); if (e && e.undo) { const u = e.undo; e.undo = null; u(); toast('Undone'); } break; }
    case 'lsmenu': { const e = state.strip.find(x => x.id === +el.dataset.id), a = A(e.tag); openMenu(el, `${e.tag}${a ? ' · ' + a.name : ''}`, [ ...(a ? [{label:'Open asset', href:L.ASSET}] : []), {label:'Scan it again', act:'rescan', args:`data-tag="${esc(e.tag)}"`}, ...(e.failed ? [{label:'Create maintenance job…', act:'lsmaint', args:`data-id="${e.id}"`}] : []) ]); break; }
    case 'lsmaint': { const e = state.strip.find(x => x.id === +el.dataset.id); closeLayer(); openMaint(e.tag, e); break; }
    case 'undo': if (state.undo) { state.undo(); state.undo = null; } $('#toast').classList.remove('open'); break;
    case 'toastclose': $('#toast').classList.remove('open'); break;
  }
}

// ---------- input wiring
document.addEventListener('input', ev => {
  const f = ev.target.dataset && ev.target.dataset.f; if (!f) return; const d = dr(); if (!d) return; d.touched = true; const v = ev.target.value, [k, a, b] = f.split(':');
  if (k === 'v' || k === 'dd') d.items[a].v = v; else if (k === 'note') d.items[a].note = v; else if (k === 'notes') d.notes = v; else if (k === 'fnotes') d.fnotes = v;
  else if (k === 'rd') d.rd[a] = { v, na:false }; else if (k === 'out') d.outlets[+a][b] = v;
  render();
});
document.addEventListener('keydown', ev => {
  if (ev.target.id === 'q' && ev.key === 'Enter') { ev.preventDefault(); scan(ev.target.value); }
  if (ev.ctrlKey && ev.key === 'Enter') { ev.preventDefault(); save('next'); }
});

// ---------- boot: shell overrides
document.querySelector('.crumb').innerHTML = `<a href="${L.FLOOR}" style="color:var(--muted)">Warehouse</a><span>›</span><b>Scan</b>`;
document.querySelectorAll('.bottomnav a').forEach(a => { const h = { '#home':L.HOME, '#jobs':L.JOBS, '#warehouse':L.FLOOR, '#assets':L.ASSETS }[a.getAttribute('href')]; if (h) a.setAttribute('href', h); });
const scanNav = document.querySelector('.bottomnav a[href="#scan"]'); scanNav.classList.add('on'); scanNav.setAttribute('data-act', 'camera');
load('AURA-01');
