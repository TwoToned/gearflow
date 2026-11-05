// ---------- Crew planner + timesheets · data
const TODAY = '2026-11-09', ME = 'Jayden Cole';
const U = { logi:'https://claude.ai/artifact/E36tnBkGL9obdikUQ5mbXf', jobs:'https://claude.ai/artifact/A7SMPtpTr3aedUDEnuSaxd', assets:'https://claude.ai/artifact/89PDTuMiovgP9i3h4MJ1Tw', people:'https://claude.ai/artifact/LPdsNGb4CRMfS6qk7j7Fsa', home:'https://claude.ai/artifact/RPnGj7WnaWcknvQ8ShcRkf', floor:'https://claude.ai/artifact/6xqFcEZZk49w86p5pAsisA', fin:'https://claude.ai/artifact/5VnYTVW2pdA5r1qBRvdrom', scan:'https://claude.ai/artifact/8Q2HVoRhLbSLz1Q9mCtayX' };
const rnd = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(7);
const addD = (d, n) => new Date((dayNum(d) + n) * 864e5).toISOString().slice(0,10);
// The fixture calendar: Mon 10 Nov 2026 anchors the week (the brief's world has 11 Nov on a Tuesday), so weekday names come from here, not from Date.
const dowM = d => (((dayNum(d) - dayNum('2026-11-10')) % 7) + 7) % 7;
const wdOf = d => ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][dowM(d)];
const weekOf = d => addD(d, -dowM(d));
const isWe = d => dowM(d) >= 5;
const fmtDay = d => `${wdOf(d)} ${+d.slice(8,10)}`, fmtDayLong = d => `${wdOf(d)} ${fmtD(d)}`;
const hm = t => { const [h, m] = t.split(':'); return +h * 60 + +m; };
const dur = (s, e) => { let d = hm(e) - hm(s); if (d <= 0) d += 1440; return d / 60; };
const fh = h => (h % 1 === 0 ? h.toFixed(0) : h.toFixed(1)) + 'h';
const initials = n => n.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();
const lastName = n => n.split(' ').slice(-1)[0];
const av = (p, size = 28) => `<span class="av" style="width:${size}px;height:${size}px;font-size:${Math.round(size * .4)}px" title="${esc(p.name)}">${initials(p.name)}</span>`;

const JOBS = { '#2341':['Hilton Sydney gala dinner','Jayden Cole'], '#2350':['Qantas awards','Mel Torres'], '#2340':['Launch night','Tom Nguyen'], '#2338':['Corporate AGM','Jayden Cole'], '#2336':['Ogilvy product launch','Tom Nguyen'], '#2333':['UNSW graduation','Mel Torres'], '#2329':['Atlassian town hall','Mel Torres'], '#2331':['Canva product day','Tom Nguyen'] };
// call status → [word, dotw class]
const CST = { PENDING:['Pending',''], OFFERED:['Offered','info'], ACCEPTED:['Accepted','ok'], CONFIRMED:['Confirmed','ok'], DECLINED:['Declined','err'], COMPLETED:['Completed','ok'] };
const TST = { DRAFT:['Draft','',0], SUBMITTED:['Submitted','info',1], APPROVED:['Approved','ok',2], DISPUTED:['Queried','warn',3], EXPORTED:['Exported','',4] };
const TSEGS = [['submitted','Submitted',['SUBMITTED']],['approved','Approved',['APPROVED']],['queried','Queried',['DISPUTED']],['all','All',null]];
const SEGS = [['all','All'],['needs','Needs crew'],['unconfirmed','Unconfirmed'],['mine','Mine']];
const RATEU = { DAILY:'day', HOURLY:'h', FLAT:'flat' };
const RTYPE = { HOURLY:'Hourly', DAILY:'Daily', FLAT:'Flat' };

const state = {
  view:'planner', week:'2026-11-10', seg:'all', tseg:'submitted', day:'2026-11-11', q:'', sel:new Set(), lastSel:null, undo:null, od:null,
  f:{ role:[], skill:[], job:[], avail:[] }, tf:{ person:[], job:[], status:[], dates:'' }, sort:'date', dir:'desc', page:0, size:25, cols:{ by:false, notes:false }, savedView:null,
  roles:[
    { id:'r1', name:'Audio tech', short:'Audio', dept:'Audio', color:'teal', type:'DAILY', cost:450, charge:650, active:true },
    { id:'r2', name:'Rigger', dept:'Rigging', color:'amber', type:'DAILY', cost:420, charge:600, active:true },
    { id:'r3', name:'Driver', dept:'Transport', color:'blue', type:'DAILY', cost:380, charge:0, active:true },
    { id:'r4', name:'LX op', short:'LX op', dept:'Lighting', color:'purple', type:'DAILY', cost:480, charge:700, active:true },
    { id:'r5', name:'Stagehand', short:'Stage', dept:'Stage', color:'green', type:'HOURLY', cost:40, charge:58, active:true },
    { id:'r6', name:'Warehouse', short:'Whse', dept:'Warehouse', color:'teal', type:'HOURLY', cost:38, charge:0, active:true },
    { id:'r7', name:'Camera op', dept:'Vision', color:'blue', type:'DAILY', cost:440, charge:640, active:false },
  ],
  crew:[
    { id:'c1', name:'Oli Martin', roles:['r1','r2'], skills:['Rigging ticket','Dante','Heights'] },
    { id:'c2', name:'Sam Kowalski', roles:['r1','r5','r2'], skills:['Dante','Forklift'] },
    { id:'c3', name:'Jess Tran', roles:['r4','r1'], skills:['grandMA3','Dante'] },
    { id:'c4', name:'Dev Patel', roles:['r2','r5'], skills:['Rigging ticket','Heights'] },
    { id:'c5', name:'Mia Rossi', roles:['r4'], skills:['grandMA3'] },
    { id:'c6', name:'Tom Brennan', roles:['r3'], skills:['HR licence','Forklift'] },
    { id:'c7', name:'Ari Nguyen', roles:['r5','r1'], skills:['Forklift'] },
    { id:'c8', name:'Lena Fischer', roles:['r2'], skills:['Rigging ticket','Heights'] },
    { id:'c9', name:'Dan Wu', roles:['r5','r6'], skills:['Forklift'] },
    { id:'c10', name:'Ash Reyes', roles:['r5','r3'], skills:['HR licence'] },
  ],
  av:{ c7:{ '2026-11-11':['UNAVAILABLE','Leave'] }, c9:{ '2026-11-15':['UNAVAILABLE','Away'], '2026-11-16':['UNAVAILABLE','Away'] }, c8:{ '2026-11-14':['TENTATIVE','#2340 Launch night'] }, c5:{ '2026-11-12':['TENTATIVE','#2340 Launch night'] }, c3:{ '2026-11-12':['PREFERRED',''], '2026-11-13':['PREFERRED',''] } },
  svcs:[], calls:[], entries:[],
};
let seq = 100;
const nid = p => p + (seq++);
const S = (job, title, role, date, start, end, need) => { const s = { id:nid('s'), job, title, role, date, start, end, need }; state.svcs.push(s); return s; };
const C = (s, person, status, offered) => { const c = { id:nid('a'), svc:s.id, person, status, offered:offered || null }; state.calls.push(c); return c; };
// this week (10 – 16 Nov) · #2341 is the anchor job
{
  const s1 = S('#2341','Delivery','r3','2026-11-11','06:30','08:30',1); C(s1,'c6','CONFIRMED','2026-11-04');
  const s2 = S('#2341','Bump in','r2','2026-11-11','08:00','18:00',4); C(s2,'c1','CONFIRMED','2026-11-04'); C(s2,'c4','ACCEPTED','2026-11-05'); C(s2,'c8','OFFERED','2026-11-06');
  const s3 = S('#2341','Show day · audio','r1','2026-11-12','14:00','23:30',1); C(s3,'c1','CONFIRMED','2026-11-04');
  S('#2341','Show day · LX op','r4','2026-11-12','14:00','23:30',1);
  const s5 = S('#2341','Show day','r1','2026-11-13','15:00','23:00',2); C(s5,'c1','CONFIRMED','2026-11-04'); C(s5,'c2','PENDING');
  const s6 = S('#2341','Bump out','r5','2026-11-14','23:30','02:30',4); C(s6,'c1','PENDING'); C(s6,'c2','PENDING'); C(s6,'c4','PENDING');
  const s7 = S('#2341','Pickup','r3','2026-11-15','06:00','08:00',1); C(s7,'c6','CONFIRMED','2026-11-04');
  const s8 = S('#2350','Show day · LX op','r4','2026-11-13','16:00','23:00',1); C(s8,'c5','ACCEPTED','2026-11-05');
  const s9 = S('#2350','Show day · stage','r5','2026-11-13','12:00','22:00',2); C(s9,'c10','OFFERED','2026-11-08'); C(s9,'c9','DECLINED','2026-11-06');
  // next week
  const n1 = S('#2338','Event · audio','r1','2026-11-21','07:00','17:00',1); C(n1,'c3','CONFIRMED','2026-11-03');
  const n2 = S('#2338','Event · LX op','r4','2026-11-21','07:00','17:00',1); C(n2,'c5','OFFERED','2026-11-07');
  const n3 = S('#2338','Event · stage','r5','2026-11-21','07:00','17:00',2); C(n3,'c7','ACCEPTED','2026-11-06');
}
// last week (3 – 9 Nov) — completed calls, each with its timesheet entry
const PAST = [
  ['#2333','Event · audio','r1','2026-11-03','08:00','17:30',['c2']], ['#2333','Event · stage','r5','2026-11-03','08:00','17:30',['c9','c7']],
  ['#2333','Event · audio','r1','2026-11-04','08:00','17:00',['c2']], ['#2333','Event · stage','r5','2026-11-04','08:00','17:00',['c9']],
  ['#2336','Delivery','r3','2026-11-05','06:30','08:30',['c6']], ['#2336','Bump in','r2','2026-11-05','09:00','18:00',['c1','c4','c8']],
  ['#2336','Show day · audio','r1','2026-11-06','14:00','23:30',['c1']], ['#2336','Show day · LX op','r4','2026-11-06','14:00','23:30',['c3']], ['#2336','Show day · stage','r5','2026-11-06','14:00','23:30',['c9','c10']],
  ['#2336','Show day · audio','r1','2026-11-07','14:00','23:30',['c1']], ['#2336','Show day · LX op','r4','2026-11-07','14:00','23:30',['c3']], ['#2336','Show day · stage','r5','2026-11-07','14:00','23:30',['c9','c10']],
  ['#2336','Bump out','r2','2026-11-08','08:00','13:00',['c4','c8']], ['#2336','Bump out · stage','r5','2026-11-08','08:00','13:00',['c10','c9']], ['#2336','Pickup','r3','2026-11-08','13:00','15:00',['c6']],
];
const rshort = r => r.short || (r.name.length > 7 ? r.name.split(' ')[0].slice(0, 7) : r.name);
const role = id => state.roles.find(r => r.id === id), person = id => state.crew.find(c => c.id === id), svc = id => state.svcs.find(s => s.id === id);
const hoursOf = e => dur(e.start, e.end) - (e.brk || 0) / 60;
const tsTotal = e => e.rateType === 'HOURLY' ? e.rate * hoursOf(e) : e.rate;
function mkEntry(o) { const r = role(o.role); const e = { id:nid('t'), brk:null, notes:'', by:null, desc:'', job:null, ...o, rate:r.cost, rateType:r.type }; e.brk = e.brk == null ? (dur(e.start, e.end) >= 6 ? 30 : 0) : e.brk; state.entries.push(e); return e; }
{
  for (const [job, title, r, date, start, end, ppl] of PAST) { const s = S(job, title, r, date, start, end, ppl.length); for (const p of ppl) { C(s, p, 'COMPLETED', addD(date, -7)); mkEntry({ person:p, job, desc:title, date, start, end, role:r, svc:s.id }); } }
  const E = state.entries, by = (f) => E.filter(f);
  E.forEach(e => { e.status = e.job === '#2333' ? 'EXPORTED' : 'SUBMITTED'; });
  by(e => e.job === '#2333').forEach(e => { e.by = 'Mel Torres'; });
  by(e => e.date === '2026-11-05').forEach(e => { e.status = 'APPROVED'; e.by = 'Mel Torres'; });
  by(e => e.date === '2026-11-06').slice(0, 2).forEach(e => { e.status = 'APPROVED'; e.by = ME; });
  by(e => e.date === '2026-11-08' && e.person === 'c9').forEach(e => { e.status = 'DRAFT'; });
  by(e => e.date === '2026-11-08' && e.person === 'c8').forEach(e => { e.status = 'DRAFT'; });
  const dan = by(e => e.date === '2026-11-07' && e.person === 'c9')[0]; dan.end = '04:30'; dan.brk = 0; dan.status = 'DISPUTED'; dan.notes = 'Query: 14.5h with no break — check the finish time.';
  mkEntry({ person:'c9', job:null, desc:'Warehouse prep', date:'2026-11-04', start:'08:00', end:'16:00', role:'r6', status:'SUBMITTED' });
  mkEntry({ person:'c10', job:null, desc:'Warehouse prep', date:'2026-11-05', start:'08:00', end:'16:00', role:'r6', status:'SUBMITTED' });
  mkEntry({ person:'c9', job:null, desc:'Warehouse prep', date:'2026-11-06', start:'08:00', end:'12:00', role:'r6', status:'DRAFT' });
  const older = [['#2329','2026-10-27'],['#2329','2026-10-28'],['#2331','2026-10-30']];
  for (const [job, date] of older) for (const p of state.crew.filter(() => rnd() < .6)) { const r = p.roles[0]; mkEntry({ person:p.id, job, desc:'Event', date, start:'08:00', end:rnd() < .5 ? '17:00' : '18:30', role:r, status:'EXPORTED', by:'Mel Torres' }); }
}

// ---------- derived
const activeC = c => c.status !== 'DECLINED';
const svcOf = c => svc(c.svc);
const cRole = c => c.role || svcOf(c).role, cStart = c => c.start || svcOf(c).start, cEnd = c => c.end || svcOf(c).end;
const filled = s => state.calls.filter(c => c.svc === s.id && activeC(c)).length;
const openN = s => Math.max(0, s.need - filled(s));
const weekDays = () => [0,1,2,3,4,5,6].map(i => addD(state.week, i));
const inWeek = d => d >= state.week && d <= addD(state.week, 6);
const isUnconf = c => ['PENDING','OFFERED','ACCEPTED'].includes(c.status);
const isMine = c => JOBS[svcOf(c).job][1] === ME;
const segCall = c => state.seg === 'unconfirmed' ? isUnconf(c) : state.seg === 'mine' ? isMine(c) : true;
const weekCalls = () => state.calls.filter(c => inWeek(svcOf(c).date));
const weekOpens = () => state.svcs.filter(s => inWeek(s.date) && openN(s) > 0);
const age = c => c.offered ? dayNum(TODAY) - dayNum(c.offered) : 0;
function availOf(pid, d, ex) {
  const a = (state.av[pid] || {})[d];
  if (a && a[0] === 'UNAVAILABLE') return { k:'unavailable', t:'Unavailable' + (a[1] ? ` · ${a[1]}` : ''), ref:a[1] };
  const cs = state.calls.filter(c => c.id !== ex && c.person === pid && activeC(c) && svcOf(c).date === d);
  if (cs.length) { const c = cs[0], s = svcOf(c); return { k:'booked', t:`Already on ${s.job} ${s.title} · ${cStart(c)}–${cEnd(c)}` }; }
  if (a && a[0] === 'TENTATIVE') return { k:'pencilled', t:'Pencilled' + (a[1] ? ` · ${a[1]}` : ''), ref:a[1] };
  if (a && a[0] === 'PREFERRED') return { k:'preferred', t:'Preferred this day' };
  return { k:'free', t:'Free' };
}
function candidates(s) {
  const rank = { preferred:0, free:1, pencilled:2 };
  return state.crew.filter(p => p.roles.includes(s.role) && !state.calls.some(c => c.svc === s.id && c.person === p.id))
    .map(p => ({ p, a:availOf(p.id, s.date) })).filter(x => x.a.k in rank).sort((x, y) => rank[x.a.k] - rank[y.a.k] || x.p.name.localeCompare(y.p.name));
}
const hasF = () => Object.values(state.f).some(v => v.length) || state.q;
function personOk(p) {
  const f = state.f, q = state.q.trim().toLowerCase();
  if (f.role.length && !f.role.some(r => p.roles.includes(r))) return false;
  if (f.skill.length && !f.skill.some(s => p.skills.includes(s))) return false;
  const mine = weekCalls().filter(c => c.person === p.id);
  if (f.job.length && !mine.some(c => f.job.includes(svcOf(c).job))) return false;
  if (q) { const hay = [p.name, ...p.roles.map(r => role(r).name), ...p.skills, ...mine.map(c => svcOf(c).job + ' ' + JOBS[svcOf(c).job][0])].join(' ').toLowerCase(); if (!hay.includes(q)) return false; }
  if (f.avail.length) { const ds = weekDays(), act = mine.filter(activeC); const ok = f.avail.some(a => a === 'Free' ? (!act.length && !ds.some(d => availOf(p.id, d).k === 'unavailable')) : a === 'Booked' ? act.length > 0 : a === 'Unavailable' ? ds.some(d => availOf(p.id, d).k === 'unavailable') : a === 'Pencilled' ? ds.some(d => availOf(p.id, d).k === 'pencilled') : ds.some(d => availOf(p.id, d).k === 'preferred')); if (!ok) return false; }
  if (state.seg === 'unconfirmed' || state.seg === 'mine') { if (!mine.some(c => activeC(c) && segCall(c))) return false; }
  return true;
}
const people = () => state.crew.filter(personOk).sort((a, b) => lastName(a.name).localeCompare(lastName(b.name)));
function opensOk(s) {
  const f = state.f, q = state.q.trim().toLowerCase();
  if (f.role.length && !f.role.includes(s.role)) return false; if (f.job.length && !f.job.includes(s.job)) return false;
  if (q && ![s.job, JOBS[s.job][0], s.title, role(s.role).name].join(' ').toLowerCase().includes(q)) return false; return true;
}
const needsList = () => weekOpens().filter(opensOk).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
const openTotal = () => weekOpens().reduce((n, s) => n + openN(s), 0);
const dimmed = c => (state.f.job.length && !state.f.job.includes(svcOf(c).job)) || ((state.seg === 'unconfirmed' || state.seg === 'mine') && !segCall(c));
const planned = p => weekCalls().filter(c => c.person === p.id && activeC(c)).reduce((h, c) => h + dur(cStart(c), cEnd(c)), 0);
const logged = p => state.entries.filter(e => e.person === p.id && inWeek(e.date) && (e.status === 'APPROVED' || e.status === 'EXPORTED')).reduce((h, e) => h + hoursOf(e), 0);
function snapR() { const u = snapshot(); return () => { u(); rolesDialog(); }; }
function snapshot() { const c = state.calls.map(x => ({ ...x })), e = state.entries.map(x => ({ ...x })), r = state.roles.map(x => ({ ...x })), s = state.svcs.map(x => ({ ...x })); return () => { state.calls = c; state.entries = e; state.roles = r; state.svcs = s; state.sel.clear(); render(); }; }
// timesheets
const tsDates = () => { const w = weekOf(TODAY); return { week:[w, addD(w, 6)], last:[addD(w, -7), addD(w, -1)], month:[addD(TODAY, -30), TODAY] }[state.tf.dates] || null; };
function tsMatch(e, seg) {
  const g = TSEGS.find(x => x[0] === (seg || state.tseg)); if (g[2] && !g[2].includes(e.status)) return false;
  const q = state.q.trim().toLowerCase(), p = person(e.person); if (q && ![p.name, e.job || '', e.job ? JOBS[e.job][0] : '', e.desc, e.notes].join(' ').toLowerCase().includes(q)) return false;
  const f = state.tf; if (f.person.length && !f.person.includes(e.person)) return false; if (f.job.length && !f.job.includes(e.job || 'General')) return false; if (f.status.length && !f.status.includes(e.status)) return false;
  const r = tsDates(); if (r && (e.date < r[0] || e.date > r[1])) return false; return true;
}
function tsRows() {
  const k = state.sort, d = state.dir === 'asc' ? 1 : -1;
  const val = { date:e => e.date + e.start, person:e => lastName(person(e.person).name), job:e => e.job || 'zzz', hours:hoursOf, total:tsTotal, status:e => TST[e.status][2] };
  return state.entries.filter(e => tsMatch(e)).sort((a, b) => { const x = val[k](a), y = val[k](b); return (x > y ? 1 : x < y ? -1 : 0) * d || a.date.localeCompare(b.date) || person(a.person).name.localeCompare(person(b.person).name); });
}
const tsHasF = () => Object.values(state.tf).some(v => v.length) || state.q;
const callById = id => state.calls.find(c => c.id === id), entryById = id => state.entries.find(e => e.id === id);

// ---------- shell bits
function renderNav() {
  const items = [['Dashboard','blue',U.home],['Jobs','blue',U.jobs],['Finance','green',U.fin],['Schedule','green','#'],['Crew','purple','#'],['Assets','amber',U.assets],['Warehouse','teal',U.floor],['Test & tag','teal',U.scan],['Maintenance','amber','#']];
  $('#sidenav').innerHTML = items.map(([n, c, h]) => `<a href="${h}" class="${n === 'Crew' ? 'on' : ''}"><span class="patch" style="background:var(--${c}-soft, var(--paper-2))"></span>${n}</a>`).join('');
  const bn = document.querySelectorAll('.bottomnav a'), hs = [U.home, U.jobs, U.scan, U.floor, U.assets]; bn.forEach((a, i) => { a.setAttribute('href', hs[i]); });
}

// ---------- render
function render() { renderNav(); renderHead(); renderStrip(); renderToolbar(); const pl = state.view === 'planner'; if (pl) { if (state.seg === 'needs') renderNeeds(); else renderGrid(); renderDays(); } else { renderTs(); $('#daychips').innerHTML = ''; } renderFoot(); renderBulk(); }
function renderHead() {
  const pl = state.view === 'planner', d = weekDays();
  $('#count').textContent = state.crew.length;
  $('.crumb').innerHTML = `<a href="${U.people}" style="color:var(--muted)">Crew</a> <span>›</span> <b>${pl ? 'Planner' : 'Timesheets'}</b>`;
  $('#hsub').innerHTML = pl ? `Who is booked, who is free, who still owes a yes · <span class="kbd">/</span> search <span class="kbd">n</span> offer a call` : `Time entries across the crew · submitted ones wait for you · <span class="kbd">/</span> search <span class="kbd">n</span> log time`;
  const views = `<button class="fw ${pl ? 'on' : ''}" data-act="view" data-v="planner">Planner</button><button class="fw ${!pl ? 'on' : ''}" data-act="view" data-v="timesheets">Timesheets</button>`;
  $('#viewsw').innerHTML = views; $('#phoneviews').innerHTML = views;
  document.querySelectorAll('#viewsw .fw.on').forEach(b => { b.style.cssText = 'color:var(--ink);box-shadow:inset 0 -2px 0 var(--action-red)'; });
  $('#primary').textContent = $('#phoneprimary').textContent = pl ? 'Offer call' : 'Log time';
  const nneed = openTotal(), nun = weekCalls().filter(c => activeC(c) && isUnconf(c)).length, nts = state.entries.filter(e => e.status === 'SUBMITTED').length;
  $('#phonesub').textContent = pl ? `${fmtRange(d[0], d[6])} · ${nneed} need crew · ${nun} unconfirmed` : `${nts} submitted · ${state.entries.filter(e => e.status === 'DISPUTED').length} queried`;
}
function renderStrip() {
  if (state.view === 'planner') {
    const cnt = { all:weekCalls().length, needs:openTotal(), unconfirmed:weekCalls().filter(c => activeC(c) && isUnconf(c)).length, mine:weekCalls().filter(c => activeC(c) && isMine(c)).length };
    $('#strip').innerHTML = SEGS.map(([k, n]) => `<button class="${state.seg === k ? 'on' : ''}" data-act="seg" data-k="${k}" style="${k === 'needs' && cnt[k] ? 'color:var(--t-out)' : ''}">${n} <span class="n">${cnt[k]}</span></button>`).join('');
  } else {
    const base = state.entries; $('#strip').innerHTML = TSEGS.map(([k, n, st]) => `<button class="${state.tseg === k ? 'on' : ''}" data-act="seg" data-k="${k}">${n} <span class="n">${st ? base.filter(e => st.includes(e.status)).length : base.length}</span></button>`).join('');
  }
}
function renderToolbar() {
  const pl = state.view === 'planner';
  $('#wknav').innerHTML = pl ? `<button class="step" data-act="wk" data-d="-1" aria-label="Previous week">‹</button><span class="wk">${fmtRange(state.week, addD(state.week, 6))}</span><button class="step" data-act="wk" data-d="1" aria-label="Next week">›</button><button class="fw" data-act="wk" data-d="0">Today</button>` : '';
  $('#q').placeholder = pl ? 'Search person, role, skill or job' : 'Search person, job or note';
  const lab = (a, rs) => a.length ? (a.length > 1 ? a.length + ' chosen' : rs ? rs(a[0]) : a[0]) : '';
  if (pl) {
    const f = state.f;
    $('#fwords').innerHTML = filterWord('Role', 'role', lab(f.role, r => role(r).name), 'fmenu').replace('data-k', 'data-b="f" data-k') + filterWord('Skill', 'skill', lab(f.skill), 'fmenu').replace('data-k', 'data-b="f" data-k') + filterWord('Job', 'job', lab(f.job), 'fmenu').replace('data-k', 'data-b="f" data-k') + filterWord('Availability', 'avail', lab(f.avail), 'fmenu').replace('data-k', 'data-b="f" data-k') + (hasF() ? `<button class="lnk muted" data-act="clearf">Clear</button>` : '');
    $('#views').innerHTML = '';
  } else {
    const f = state.tf, dl = { week:'This week', last:'Last week', month:'Last 30 days' }[f.dates] || '';
    $('#fwords').innerHTML = filterWord('Person', 'person', lab(f.person, p => person(p).name), 'fmenu').replace('data-k', 'data-b="tf" data-k') + filterWord('Job', 'job', lab(f.job), 'fmenu').replace('data-k', 'data-b="tf" data-k') + filterWord('Status', 'status', lab(f.status, s => TST[s][0]), 'fmenu').replace('data-k', 'data-b="tf" data-k') + filterWord('Dates', 'dates', dl, 'datesmenu') + (tsHasF() ? `<button class="lnk muted" data-act="clearf">Clear</button>` : '');
    $('#views').innerHTML = `<button class="fw ${state.savedView ? 'on' : ''}" data-act="viewsmenu">${state.savedView ? 'View: ' + esc(state.savedView) : 'Views ▾'}</button>`;
  }
}
function statusWord(c) { const [n, cls] = CST[c.status], a = c.status === 'OFFERED' ? age(c) : 0; return `<span class="dotw ${cls}">${n}${a > 0 ? `<span class="age ${a >= 3 ? 'stale' : ''}">${a}d</span>` : ''}</span>`; }
function block(c) {
  const s = svcOf(c), sel = state.sel.has(c.id), r = role(cRole(c));
  return `<div class="blk ${sel ? 'sel' : ''} ${dimmed(c) ? 'dim' : ''}" data-act="call" data-id="${c.id}"><div class="b1"><button class="cb ${sel ? 'on' : ''}" data-act="select" data-id="${c.id}" aria-label="Select call"></button><a href="${U.logi}" title="${esc(JOBS[s.job][0])} · ${esc(s.title)}">${s.job}</a><span class="role">${esc(rshort(r))}</span></div><div class="b2">${cStart(c)}–${cEnd(c)}</div><div class="b3">${statusWord(c)}</div><button class="dots" data-act="callmenu" data-id="${c.id}" aria-label="Call actions">${ICON.dots}</button></div>`;
}
function dayCell(p, d) {
  const cs = state.calls.filter(c => c.person === p.id && svcOf(c).date === d).sort((a, b) => cStart(a).localeCompare(cStart(b))), a = availOf(p.id, d), we = isWe(d);
  if (cs.length) return `<td class="day ${we ? 'we' : ''}">${cs.map(block).join('')}</td>`;
  let inner = '', cls = 'free';
  if (a.k === 'unavailable') { inner = `<div class="mk">Unavailable${a.ref ? `<span class="ref">${esc(a.ref)}</span>` : ''}</div>`; cls += ' off'; }
  else if (a.k === 'pencilled') inner = `<div class="mk"><span class="dotw warn">Pencilled</span><span class="ref">${esc(a.ref)}</span></div>`;
  else if (a.k === 'preferred') inner = `<div class="mk faint">Preferred</div>`;
  return `<td class="day ${we ? 'we' : ''} ${cls}" data-act="cell" data-p="${p.id}" data-d="${d}" title="Offer ${esc(p.name)} a call on ${fmtDayLong(d)}">${inner}</td>`;
}
function renderGrid() {
  const ds = weekDays(), ps = people(), allIds = weekCalls().filter(c => ps.some(p => p.id === c.person) && segCall(c)).map(c => c.id), allSel = allIds.length && allIds.every(i => state.sel.has(i));
  let h = `<table class="pgrid"><colgroup><col style="width:196px">${ds.map(() => '<col>').join('')}<col style="width:92px"></colgroup><thead><tr><th><span style="display:inline-flex;align-items:center;gap:10px"><button class="cb ${allSel ? 'on' : ''}" data-act="selall" aria-label="Select all calls shown" style="width:16px;height:16px"></button>Person</span></th>${ds.map(d => `<th class="day ${isWe(d) ? 'we' : ''}">${wdOf(d)}<span class="dn">${+d.slice(8)}</span></th>`).join('')}<th class="r" title="Planned from booked calls · logged from approved timesheets">Hours</th></tr></thead><tbody>`;
  if (!ps.length) h += `<tr><td colspan="9"><div class="empty">${hasF() ? `<b>No crew match that</b>Loosen a filter or clear them. <button class="lnk" data-act="clearf">Clear filters</button>` : `<b>No crew on the roster yet</b>Add crew before you plan a week. <a class="lnk" href="${U.people}">Open the crew list</a>`}</div></td></tr>`;
  for (const p of ps) { const pl = planned(p), lg = logged(p);
    h += `<tr><td class="who"><div style="display:flex;align-items:center;gap:10px;min-width:0">${av(p, 28)}<div style="min-width:0"><a class="nm" href="${U.people}">${esc(p.name)}</a><div class="rl">${esc(role(p.roles[0]).name)}</div></div></div></td>${ds.map(d => dayCell(p, d)).join('')}<td class="hrs">${pl ? fh(pl) : '<span class="faint">—</span>'}${lg ? `<span class="act"> / ${fh(lg)}</span>` : ''}</td></tr>`; }
  $('#tblwrap').innerHTML = h + '</tbody></table>';
}
function renderNeeds() {
  const L = needsList(), allSel = L.length && L.every(s => state.sel.has('o_' + s.id));
  let h = `<table class="tbl" style="min-width:0;table-layout:fixed;width:100%"><colgroup><col style="width:34px"><col style="width:76px"><col><col style="width:130px"><col style="width:96px"><col style="width:150px"><col style="width:40px"></colgroup><thead><tr><th><button class="cb ${allSel ? 'on' : ''}" data-act="selall" aria-label="Select all open calls"></button></th><th>Job</th><th>Call</th><th>Times</th><th>Needs</th><th>Free to offer</th><th></th></tr></thead><tbody>`;
  if (!L.length) h += `<tr><td colspan="7"><div class="empty">${hasF() ? `<b>No open calls match that</b>Loosen a filter. <button class="lnk" data-act="clearf">Clear filters</button>` : `<b>Every call this week has crew</b>Nothing to fill. Step to next week with ›.`}</div></td></tr>`;
  let last = '';
  for (const s of L) { if (s.date !== last) { last = s.date; h += `<tr class="grp"><td colspan="7">${fmtDayLong(s.date)}<span class="n">${L.filter(x => x.date === s.date).reduce((n, x) => n + openN(x), 0)}</span></td></tr>`; }
    const sel = state.sel.has('o_' + s.id), cands = candidates(s).slice(0, 3);
    h += `<tr class="row ${sel ? 'sel' : ''}" data-act="openrow" data-id="${s.id}"><td><button class="cb ${sel ? 'on' : ''}" data-act="select" data-id="o_${s.id}" aria-label="Select"></button></td><td><a class="jn" href="${U.logi}">${s.job}</a></td><td style="min-width:0"><div class="ell"><b>${esc(s.title)}</b></div><div class="sub ell">${esc(JOBS[s.job][0])} · ${esc(role(s.role).name)}</div></td><td class="mono t-small">${s.start}–${s.end}</td><td><span class="dotw err">needs ${openN(s)}</span></td><td>${cands.length ? `<span class="sugg"><span class="avs">${cands.map(x => `<span>${av(x.p, 22)}</span>`).join('')}</span>${cands[0].a.k === 'preferred' ? 'preferred first' : ''}</span>` : '<span class="faint t-small">no one free</span>'}</td><td><button class="dots" data-act="openmenu" data-id="${s.id}" aria-label="Open call actions">${ICON.dots}</button></td></tr>`; }
  $('#tblwrap').innerHTML = h + '</tbody></table>';
}
// phone: Needs crew list, or one day with people as cards
function renderDays() {
  const ds = weekDays();
  if (!ds.includes(state.day)) state.day = ds[Math.max(0, ds.indexOf(state.day)) || 1];
  const list = $('#list');
  if (state.seg === 'needs') {
    $('#daychips').innerHTML = ''; const L = needsList(); let h = '', last = '';
    if (!L.length) h = `<div class="empty"><b>${hasF() ? 'No open calls match that' : 'Every call this week has crew'}</b>${hasF() ? 'Loosen a filter.' : 'Nothing to fill.'}</div>`;
    for (const s of L) { if (s.date !== last) { last = s.date; h += `<div class="sech ${h ? '' : 'first'}">${fmtDayLong(s.date)}<span class="n">${L.filter(x => x.date === s.date).reduce((n, x) => n + openN(x), 0)}</span></div>`; } h += openCard(s); }
    list.innerHTML = h; return;
  }
  $('#daychips').innerHTML = ds.map(d => { const o = state.svcs.filter(s => s.date === d && openN(s) > 0).reduce((n, s) => n + openN(s), 0), n = state.calls.filter(c => svcOf(c).date === d && activeC(c)).length; return `<button class="chip ${state.day === d ? 'on' : ''}" data-act="day" data-d="${d}"><b>${wdOf(d)} ${+d.slice(8)}</b><span class="chip-count ${o ? 'open' : ''}">${o ? o + ' open' : n ? n + ' calls' : '·'}</span></button>`; }).join('');
  const d = state.day, ps = people(), cs = state.calls.filter(c => svcOf(c).date === d && ps.some(p => p.id === c.person) && (state.seg === 'all' || segCall(c))).sort((a, b) => cStart(a).localeCompare(cStart(b)));
  const opens = state.seg === 'all' ? state.svcs.filter(s => s.date === d && openN(s) > 0 && opensOk(s)) : [];
  const busy = new Set(cs.map(c => c.person));
  const free = state.seg === 'all' ? ps.filter(p => !busy.has(p.id) && availOf(p.id, d).k !== 'unavailable') : [], off = state.seg === 'all' ? ps.filter(p => !busy.has(p.id) && availOf(p.id, d).k === 'unavailable') : [];
  let h = '';
  const sec = (t, n, first) => `<div class="sech ${first ? 'first' : ''}">${t}<span class="n">${n}</span></div>`;
  if (opens.length) h += sec('Needs crew', opens.reduce((n, s) => n + openN(s), 0), true) + opens.map(openCard).join('');
  if (cs.length) h += sec('Booked', cs.length, !h) + cs.map(callCard).join('');
  if (free.length) h += sec('Free', free.length, !h) + free.map(p => freeCard(p, d)).join('');
  if (off.length) h += sec('Unavailable', off.length, !h) + off.map(p => freeCard(p, d)).join('');
  if (!h) h = `<div class="empty"><b>Nothing on ${fmtDayLong(d)}</b>${hasF() ? 'No one matches those filters.' : 'No calls and no open slots.'}</div>`;
  list.innerHTML = h;
}
function openCard(s) { const sel = state.sel.has('o_' + s.id); return `<div class="lrow ${sel ? 'sel' : ''}" data-act="openrow" data-id="${s.id}"><button class="cb ${sel ? 'on' : ''}" data-act="select" data-id="o_${s.id}" aria-label="Select"></button><div class="grow" style="min-width:0"><div class="ttl ell">${s.job} ${esc(s.title)}</div><div class="sub ell">${fmtDay(s.date)} · ${s.start}–${s.end} · ${esc(role(s.role).name)}</div></div><div class="right"><span class="dotw err">needs ${openN(s)}</span></div><button class="dots" data-act="openmenu" data-id="${s.id}" aria-label="Open call actions">${ICON.dots}</button></div>`; }
function callCard(c) { const p = person(c.person), s = svcOf(c), sel = state.sel.has(c.id); return `<div class="lrow ${sel ? 'sel' : ''}" data-act="call" data-id="${c.id}"><button class="cb ${sel ? 'on' : ''}" data-act="select" data-id="${c.id}" aria-label="Select"></button>${av(p, 32)}<div class="grow" style="min-width:0"><div class="ttl ell nm">${esc(p.name)}</div><div class="sub ell">${s.job} · ${cStart(c)}–${cEnd(c)}</div></div><div class="right">${statusWord(c)}</div><button class="dots" data-act="callmenu" data-id="${c.id}" aria-label="Call actions">${ICON.dots}</button></div>`; }
function freeCard(p, d) { const a = availOf(p.id, d); return `<div class="lrow" data-act="cell" data-p="${p.id}" data-d="${d}"><span style="width:22px;flex:none"></span>${av(p, 32)}<div class="grow" style="min-width:0"><div class="ttl ell nm">${esc(p.name)}</div><div class="sub ell">${esc(role(p.roles[0]).name)}${a.k === 'pencilled' ? ' · pencilled ' + esc(a.ref || '') : a.k === 'unavailable' ? ' · ' + esc(a.ref || '') : ''}</div></div><div class="right"><span class="dotw ${a.k === 'unavailable' ? 'err' : a.k === 'pencilled' ? 'warn' : a.k === 'preferred' ? 'ok' : ''}">${a.k === 'unavailable' ? 'Unavailable' : a.k === 'pencilled' ? 'Pencilled' : a.k === 'preferred' ? 'Preferred' : 'Free'}</span></div><button class="dots" data-act="cell" data-p="${p.id}" data-d="${d}" aria-label="Offer a call">${ICON.dots}</button></div>`; }
// timesheets
function tsStatus(e) { const [n, cls] = TST[e.status]; return `<span class="dotw ${cls}">${n}</span>${e.status === 'EXPORTED' ? `<span class="faint" style="margin-left:6px" title="Exported entries are locked">${ICON.lock}</span>` : ''}`; }
const rateTxt = e => `${money(e.rate)}/${RATEU[e.rateType]}`;
function renderTs() {
  const all = tsRows(), pageRows = all.slice(state.page * state.size, (state.page + 1) * state.size), allSel = pageRows.length && pageRows.every(e => state.sel.has(e.id));
  const nc = Object.values(state.cols).filter(Boolean).length;
  let h = `<table class="tbl" style="min-width:0;table-layout:fixed;width:100%"><colgroup><col style="width:34px"><col style="width:190px"><col><col style="width:200px"><col style="width:70px"><col style="width:96px"><col style="width:84px">${state.cols.by ? '<col style="width:104px">' : ''}${state.cols.notes ? '<col style="width:170px">' : ''}<col style="width:128px"><col style="width:40px"></colgroup><thead><tr><th><button class="cb ${allSel ? 'on' : ''}" data-act="selall" aria-label="Select page"></button></th>${sortHead('Person', 'person')}${sortHead('Job', 'job')}${sortHead('Date', 'date')}${sortHead('Hours', 'hours', 'r')}<th class="r">Rate</th>${sortHead('Total', 'total', 'r')}${state.cols.by ? '<th>Approved by</th>' : ''}${state.cols.notes ? '<th>Notes</th>' : ''}${sortHead('Status', 'status')}<th></th></tr></thead><tbody>`;
  if (!pageRows.length) h += `<tr><td colspan="${9 + nc}"><div class="empty">${tsHasF() || state.tseg !== 'all' ? `<b>${tsHasF() ? 'No entries match that' : 'Nothing ' + { submitted:'waiting for approval', approved:'approved yet', queried:'queried' }[state.tseg]}</b>${tsHasF() ? 'Loosen a filter or clear them. <button class="lnk" data-act="clearf">Clear filters</button>' : 'Switch to <button class="lnk" data-act="seg" data-k="all">All</button> to see every entry.'}` : `<b>No time entries yet</b>Log time for the crew, or wait for them to submit. <button class="lnk" data-act="new">Log time</button>`}</div></td></tr>`;
  for (const e of pageRows) { const p = person(e.person), sel = state.sel.has(e.id), ex = e.status === 'EXPORTED';
    h += `<tr class="row ${sel ? 'sel' : ''}" data-act="tsopen" data-id="${e.id}"><td><button class="cb ${sel ? 'on' : ''}" data-act="select" data-id="${e.id}" aria-label="Select entry"></button></td><td style="min-width:0"><div class="ell"><b>${esc(p.name)}</b></div><div class="sub ell">${esc(role(e.role).name)}</div></td><td style="min-width:0"><div class="ell">${e.job ? `<a class="jn" href="${U.logi}">${e.job}</a> <span class="mutedcell">${esc(JOBS[e.job][0])}</span>` : '<span class="mutedcell">General</span>'}</div><div class="sub ell">${esc(e.desc)}${e.notes && !state.cols.notes ? ` · <span class="${e.status === 'DISPUTED' ? '' : 'faint'}" style="${e.status === 'DISPUTED' ? 'color:var(--warn)' : ''}">${esc(e.notes)}</span>` : ''}</div></td><td><div class="mono t-small">${fmtDayLong(e.date)}</div><div class="sub mono" style="white-space:nowrap">${e.start}–${e.end}${e.brk ? ` · ${e.brk}m break` : ''}</div></td><td class="r mono">${fh(hoursOf(e))}</td><td class="r mono t-small muted">${rateTxt(e)}</td><td class="r mono">${money(tsTotal(e))}</td>${state.cols.by ? `<td class="t-small muted">${esc(e.by || '—')}</td>` : ''}${state.cols.notes ? `<td class="t-small muted ell">${esc(e.notes || '—')}</td>` : ''}<td>${tsStatus(e)}</td><td>${ex ? '' : `<button class="dots" data-act="tsmenu" data-id="${e.id}" aria-label="Entry actions">${ICON.dots}</button>`}</td></tr>`; }
  $('#tblwrap').innerHTML = h + '</tbody></table>';
  const shown = all.slice(0, (state.page + 1) * state.size);
  $('#list').innerHTML = (shown.length ? shown : []).map(e => { const p = person(e.person), sel = state.sel.has(e.id); return `<div class="lrow ${sel ? 'sel' : ''}" data-act="tsopen" data-id="${e.id}"><button class="cb ${sel ? 'on' : ''}" data-act="select" data-id="${e.id}" aria-label="Select"></button>${av(p, 32)}<div class="grow" style="min-width:0"><div class="ttl ell">${esc(p.name)}</div><div class="sub ell">${e.job || 'General'} · ${fmtDay(e.date)} · ${fh(hoursOf(e))}</div></div><div class="right">${tsStatus(e)}<div class="mono t-small" style="margin-top:3px">${money(tsTotal(e))}</div></div>${e.status === 'EXPORTED' ? '<span style="width:40px;flex:none"></span>' : `<button class="dots" data-act="tsmenu" data-id="${e.id}" aria-label="Entry actions">${ICON.dots}</button>`}</div>`; }).join('') || `<div class="empty"><b>${tsHasF() ? 'No entries match that' : 'Nothing here'}</b>${tsHasF() ? 'Loosen a filter.' : 'Switch to All to see every entry.'}</div>`;
  if (all.length > shown.length) $('#list').innerHTML += `<button class="lrow" data-act="more" style="justify-content:center;color:var(--blue);font-weight:600">Show ${Math.min(state.size, all.length - shown.length)} more · ${all.length - shown.length} left</button>`;
}
function renderFoot() {
  if (state.view === 'planner') {
    const cs = weekCalls().filter(activeC), conf = cs.filter(c => c.status === 'CONFIRMED').length, dec = weekCalls().length - cs.length, c = s => cs.filter(x => x.status === s).length;
    $('#foot').innerHTML = `<span>${state.crew.length} people · <b class="mono" style="color:var(--ink-2)">${conf}</b> of ${cs.length} confirmed · ${c('ACCEPTED')} accepted · ${c('OFFERED')} offered · ${c('PENDING')} pending${dec ? ` · <span style="color:var(--t-out)">${dec} declined</span>` : ''}</span>`;
  } else {
    const all = tsRows(), hrs = all.reduce((h, e) => h + hoursOf(e), 0), tot = all.reduce((h, e) => h + tsTotal(e), 0);
    $('#foot').innerHTML = pager(all.length, 'entries').replace('</span><span class="pg">', `</span><span>Totals · ${fh(hrs)} · ${money(tot)}</span><span class="pg">`);
  }
}
function selKinds() {
  const ids = [...state.sel], calls = ids.map(callById).filter(Boolean), opens = ids.filter(i => i.startsWith('o_')).map(i => svc(i.slice(2))).filter(Boolean), ents = ids.map(entryById).filter(Boolean);
  return { calls, opens, ents, n:ids.length };
}
function renderBulk() {
  const k = selKinds(), n = k.n, b = $('#bulk'); b.classList.toggle('open', n > 0); document.body.classList.toggle('hassel', n > 0); if (!n) return;
  let verbs = '';
  if (state.view === 'planner') {
    const off = k.calls.filter(c => c.status === 'PENDING').length, conf = k.calls.filter(c => c.status === 'ACCEPTED').length, canc = k.calls.filter(c => c.status !== 'COMPLETED').length;
    verbs = (off ? `<button class="btn btn-secondary btn-sm" data-act="bulkoffer">Offer ${off}</button>` : '') + (conf ? `<button class="btn btn-secondary btn-sm" data-act="bulkconfirm">Confirm ${conf}</button>` : '') + (k.opens.length ? `<button class="btn btn-secondary btn-sm" data-act="bulksugg">Offer to suggested ${k.opens.length}</button>` : '') + (canc ? `<button class="btn btn-secondary btn-sm" style="color:var(--t-out)" data-act="bulkcancel">Cancel ${canc}</button>` : '');
  } else {
    const ap = k.ents.filter(e => ['SUBMITTED','DISPUTED'].includes(e.status)).length, sb = k.ents.filter(e => e.status === 'DRAFT').length, q = k.ents.filter(e => ['SUBMITTED','APPROVED'].includes(e.status)).length;
    verbs = (ap ? `<button class="btn btn-secondary btn-sm" data-act="bulkapprove">Approve ${ap}</button>` : '') + (sb ? `<button class="btn btn-secondary btn-sm" data-act="bulksubmit">Submit ${sb}</button>` : '') + (q ? `<button class="btn btn-secondary btn-sm" data-act="bulkquery">Query…</button>` : '') + `<button class="btn btn-secondary btn-sm" data-act="bulkexport">Export</button>`;
  }
  b.innerHTML = `<b style="font-size:13px">${n} selected</b>${verbs}<button class="btn btn-icon btn-sm" data-act="clearsel" aria-label="Clear selection">✕</button>`;
}

// ---------- dialogs
const dlg = (kick, title, body, foot) => `<div class="hd"><div class="t-overline">${kick}</div><h2 style="font-size:18px">${title}</h2></div><div class="bd" style="gap:14px">${body}</div><div class="ft">${foot}</div>`;
const sel2 = (id, opts, cur) => `<select id="${id}">${opts.map(([v, l]) => opt(v, l, cur)).join('')}</select>`;
const footBtns = (go, label, extra = '') => `${extra}<div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" id="dlg-go" data-act="${go}">${label}</button>`;
const availHtml = a => a ? `<span class="dotw ${{ unavailable:'err', booked:'warn', pencilled:'warn', preferred:'ok', free:'ok' }[a.k]}">${esc(a.t)}</span>${['unavailable','booked'].includes(a.k) ? ' <span class="muted">· you can still offer; they will see the clash</span>' : ''}` : '<span class="muted">Choose a person to check their day</span>';
function defaultSvcFor(p, d) {
  const ss = state.svcs.filter(s => s.date === d); if (!ss.length) return '';
  const per = p ? person(p) : null, pick = ss.find(s => openN(s) > 0 && (!per || per.roles.includes(s.role))) || ss.find(s => openN(s) > 0) || ss[0]; return pick.id;
}
function applySvc(o) { const s = svc(o.s); if (!s) { o.role = ''; return; } o.role = s.role; o.start = s.start; o.end = s.end; o.rate = role(s.role).cost; }
function readOd() { const o = state.od, g = i => document.getElementById(i); if (g('o-p')) o.p = g('o-p').value; if (g('o-d')) o.d = g('o-d').value; if (g('o-s')) o.s = g('o-s').value; if (g('o-r')) o.role = g('o-r').value; if (g('o-st')) o.start = g('o-st').value; if (g('o-en')) o.end = g('o-en').value; if (g('o-rate')) o.rate = g('o-rate').value; }
function offerDialog() {
  const o = state.od, ss = state.svcs.filter(s => s.date === o.d), a = o.p ? availOf(o.p, o.d) : null, r = role(o.role);
  openDialog(dlg(o.p ? `${esc(person(o.p).name)} · ${fmtDayLong(o.d)}` : 'This week', 'Offer a call',
    field('Person', sel2('o-p', [['', 'Choose a person…'], ...state.crew.slice().sort((x, y) => lastName(x.name).localeCompare(lastName(y.name))).map(p => { const av2 = availOf(p.id, o.d); return [p.id, `${p.name} · ${role(p.roles[0]).name}${['unavailable','booked','pencilled'].includes(av2.k) ? ' · ' + av2.k : ''}`]; })], o.p)) + `<div class="availline">${availHtml(a)}</div>` +
    `<div class="g2">${field('Day', sel2('o-d', weekDays().map(d => [d, fmtDayLong(d)]), o.d))}${field('Job service', ss.length ? sel2('o-s', ss.map(s => [s.id, `${s.job} ${s.title} · ${role(s.role).name}${openN(s) ? ' · needs ' + openN(s) : ' · full'}`]), o.s) : '<div class="t-small muted" style="padding:9px 0">No services planned this day. Add one on the job’s <a href="' + U.logi + '">Logistics tab</a>.</div>')}</div>` +
    `<div class="g3">${field('Role', sel2('o-r', state.roles.filter(x => x.active).map(x => [x.id, x.name]), o.role))}${field('Start', `<input id="o-st" type="time" value="${o.start || ''}">`)}${field('End', `<input id="o-en" type="time" value="${o.end || ''}">`)}</div>` +
    `<div class="g2">${field('Cost rate ($)', `<input id="o-rate" inputmode="decimal" value="${o.rate ?? ''}" class="mono">`, r ? `${RTYPE[r.type]} · from the role` : '')}<div></div></div>` +
    `<label class="ib t-small" style="gap:8px;cursor:pointer"><span class="sw ${o.now ? 'on' : ''}" id="o-send" data-act="sw"><i></i></span>Send the offer now · otherwise it waits as Pending</label>`,
    footBtns('offergo', o.now ? 'Offer call' : 'Save as pending')));
}
function openOffer(p, d, s) { const o = state.od = { p:p || '', d, s:s || defaultSvcFor(p, d), now:true }; applySvc(o); offerDialog(); }
function callDialog(c) {
  const p = person(c.person), s = svcOf(c), r = role(cRole(c)), a = c.status === 'OFFERED' ? age(c) : 0;
  openDialog(dlg(`<a href="${U.logi}" style="color:var(--muted)">${s.job} ${esc(JOBS[s.job][0])}</a> · ${fmtDayLong(s.date)}`, esc(p.name),
    `<div class="t-small" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b>${esc(s.title)}</b>${statusWord(c)}${c.offered && c.status !== 'PENDING' ? `<span class="muted">offered ${fmtD(c.offered)}</span>` : ''}</div><div class="availline">${availHtml(availOf(c.person, s.date, c.id))}</div>` +
    `<div class="g3">${field('Role', sel2('e-r', state.roles.filter(x => x.active || x.id === cRole(c)).map(x => [x.id, x.name]), cRole(c)))}${field('Start', `<input id="e-st" type="time" value="${cStart(c)}">`)}${field('End', `<input id="e-en" type="time" value="${cEnd(c)}">`)}</div>` +
    field('Cost rate ($)', `<input id="e-rate" inputmode="decimal" class="mono" value="${c.rate ?? r.cost}">`, `${RTYPE[r.type]} · override only for this call`),
    footBtns('callgo', 'Save', `<button class="btn btn-ghost" style="color:var(--t-out)" data-act="cancelone" data-id="${c.id}">Cancel call</button>`).replace('data-act="callgo"', `data-act="callgo" data-id="${c.id}"`)));
}
function cancelDialog(ids) {
  const cs = ids.map(callById).filter(Boolean), notified = cs.filter(c => ['OFFERED','ACCEPTED','CONFIRMED'].includes(c.status)).length;
  openDialog(dlg('Cancel', `Cancel ${cs.length} call${cs.length > 1 ? 's' : ''}?`, `<div class="t-small" style="line-height:1.5">The call${cs.length > 1 ? 's go' : ' goes'} and the slot${cs.length > 1 ? 's open' : ' opens'} again under <b>Needs crew</b>.${notified ? ` ${notified} ${notified > 1 ? 'people have' : 'person has'} been offered or confirmed and will be told.` : ''} Their timesheets for these days stay as they are.</div>`, `<div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Keep ${cs.length > 1 ? 'them' : 'it'}</button><button class="btn btn-secondary" style="color:var(--t-out)" data-act="cancelgo" data-ids="${cs.map(c => c.id).join(',')}">Cancel ${cs.length} call${cs.length > 1 ? 's' : ''}</button>`));
}
function rolesDialog() {
  const mgr = true, act = state.roles.filter(r => r.active), arch = state.roles.filter(r => !r.active);
  const use = r => state.crew.filter(p => p.roles.includes(r.id)).length;
  const row = (r, i, n) => `<div class="rolerow ${r.active ? '' : 'arch'}"><span class="sw8" style="background:var(--${r.color})"></span><div style="min-width:0"><b>${esc(r.name)}</b><div class="sub">${esc(r.dept)} · ${use(r)} ${use(r) === 1 ? 'person' : 'people'}</div></div><span class="muted t-small hide-m">${RTYPE[r.type]}</span><span class="mono t-small" style="text-align:right">${mgr ? money(r.cost) : '—'}</span><span class="mono t-small hide-m" style="text-align:right">${mgr && r.charge ? money(r.charge) : '—'}</span><span class="mono t-small muted hide-m" style="text-align:right">/${RATEU[r.type]}</span><button class="dots" style="opacity:1" data-act="rolemenu" data-id="${r.id}" aria-label="Role actions">${ICON.dots}</button></div>`;
  body.innerHTML = `<div class="dlg wide"><div class="hd"><div class="t-overline">Crew settings</div><h2 style="font-size:18px">Crew roles &amp; rates</h2><div class="t-small muted" style="margin-top:4px">Roles set the cost rate crew get on a call and the charge rate on the quote. Cost and charge show for managers only.</div></div><div class="bd"><div class="rolehead"><span></span><span>Role</span><span class="hide-m">Rate type</span><span style="text-align:right">Cost</span><span class="hide-m" style="text-align:right">Charge</span><span class="hide-m"></span><span></span></div>${act.map(row).join('')}${arch.length ? `<div class="sech first" style="padding-left:0">Archived<span class="n">${arch.length}</span></div>${arch.map(row).join('')}` : ''}</div><div class="ft"><button class="btn btn-secondary" data-act="rolenew">New role</button><div style="flex:1"></div><button class="btn btn-primary" data-act="close">Done</button></div></div>`;
  layer.classList.add('open', 'dim');
}
function roleForm(r) {
  const n = !r; r = r || { name:'', dept:'', color:'teal', type:'DAILY', cost:'', charge:'', desc:'' };
  openDialog(dlg('Crew roles', n ? 'New role' : 'Edit ' + esc(r.name),
    `<div class="g2">${field('Name', `<input id="r-name" value="${esc(r.name)}" placeholder="e.g. Camera op">`)}${field('Department', `<input id="r-dept" value="${esc(r.dept)}" placeholder="e.g. Vision">`)}</div><div class="g2">${field('Colour', sel2('r-color', ['teal','amber','blue','purple','green'].map(c => [c, c[0].toUpperCase() + c.slice(1)]), r.color))}${field('Rate type', sel2('r-type', Object.entries(RTYPE), r.type))}</div><div class="g2">${field('Cost rate ($)', `<input id="r-cost" inputmode="decimal" class="mono" value="${r.cost}" placeholder="blank is not $0">`, 'What the crew member is paid')}${field('Charge rate ($)', `<input id="r-charge" inputmode="decimal" class="mono" value="${r.charge || ''}" placeholder="blank is not $0">`, 'What the quote charges')}</div>`,
    footBtns('rolego', n ? 'Create role' : 'Save').replace('data-act="rolego"', `data-act="rolego" data-id="${n ? '' : r.id}"`)));
}
function tsForm(e) {
  const n = !e, p = n ? null : person(e.person);
  const jobs = [['', 'General · no job'], ...Object.keys(JOBS).map(j => [j, `${j} ${JOBS[j][0]}`])];
  openDialog(dlg(n ? 'Timesheets' : `${esc(p.name)} · ${fmtDayLong(e.date)}`, n ? 'Log time' : 'Edit time entry',
    (n ? field('People', `<div style="max-height:176px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:2px 12px">${state.crew.map(c => `<label class="chk"><button type="button" class="cb" data-act="lt-pick" data-id="${c.id}" aria-label="${esc(c.name)}"></button>${esc(c.name)}<span class="muted t-small" style="margin-left:auto">${esc(role(c.roles[0]).name)}</span></label>`).join('')}</div>`, 'Tick everyone who worked the same hours') : '') +
    `<div class="g2">${field('Job', sel2('t-job', jobs, n ? '#2336' : e.job || ''))}${field('Date', `<input id="t-date" type="date" value="${n ? '2026-11-08' : e.date}">`)}</div><div class="g3">${field('Start', `<input id="t-st" type="time" value="${n ? '08:00' : e.start}">`)}${field('End', `<input id="t-en" type="time" value="${n ? '16:00' : e.end}">`)}${field('Break (min)', `<input id="t-br" inputmode="numeric" class="mono" value="${n ? '30' : e.brk || 0}">`)}</div>` +
    field('Description', `<input id="t-desc" value="${n ? '' : esc(e.desc)}" placeholder="What they did">`) + field('Notes', `<textarea class="in" id="t-notes">${n ? '' : esc(e.notes)}</textarea>`),
    footBtns('tsgo', n ? 'Log time' : 'Save', n ? '' : (e.status === 'EXPORTED' ? '' : `<button class="btn btn-ghost" style="color:var(--t-out)" data-act="tsdelete" data-id="${e.id}">Delete entry</button>`)).replace('data-act="tsgo"', `data-act="tsgo" data-id="${n ? '' : e.id}"`)));
}
function queryDialog(ids) {
  const es = ids.map(entryById).filter(e => e && ['SUBMITTED','APPROVED'].includes(e.status));
  if (!es.length) { toast('Only submitted or approved entries can be queried'); return; }
  openDialog(dlg('Timesheets', `Query ${es.length} ${es.length > 1 ? 'entries' : 'entry'}`, `<div class="t-small" style="line-height:1.5">${es.length > 1 ? 'They return' : 'It returns'} to the crew member as <b>Queried</b>. They fix the hours and submit again. Approved entries lose their approval.</div>` + field('What needs checking', `<textarea class="in" id="q-note" placeholder="e.g. No break logged on a 14 hour day"></textarea>`, 'Saved on the entry’s notes'), footBtns('querygo', `Query ${es.length}`).replace('data-act="querygo"', `data-act="querygo" data-ids="${es.map(e => e.id).join(',')}"`)));
}

// ---------- actions
function multi(el, bagName, key, title, options, labelOf = x => x) { openMenu(el, title, [...options.map(o => ({ label:labelOf(o), act:'ftoggle', args:`data-b="${bagName}" data-k="${key}" data-v="${o}"`, on:state[bagName][key].includes(o) })), '-', { label:'Clear', act:'fclear', args:`data-b="${bagName}" data-k="${key}"` }]); }
function selectRange(id, order, ev) { if (ev && ev.shiftKey && state.lastSel && order.includes(state.lastSel)) { const a = order.indexOf(state.lastSel), b = order.indexOf(id); for (const k of order.slice(Math.min(a, b), Math.max(a, b) + 1)) state.sel.add(k); } else state.sel.has(id) ? state.sel.delete(id) : state.sel.add(id); state.lastSel = id; }
function visibleIds() {
  if (state.view === 'timesheets') return tsRows().slice(state.page * state.size, (state.page + 1) * state.size).map(e => e.id);
  if (state.seg === 'needs') return needsList().map(s => 'o_' + s.id);
  if (isPhone()) { const d = state.day, ps = people(); return [...state.svcs.filter(s => s.date === d && openN(s) > 0 && opensOk(s)).map(s => 'o_' + s.id), ...state.calls.filter(c => svcOf(c).date === d && ps.some(p => p.id === c.person) && segCall(c)).sort((a, b) => cStart(a).localeCompare(cStart(b))).map(c => c.id)]; }
  const ps = people(), ds = weekDays(); return ps.flatMap(p => ds.flatMap(d => state.calls.filter(c => c.person === p.id && svcOf(c).date === d).sort((a, b) => cStart(a).localeCompare(cStart(b))).map(c => c.id)));
}
function offerCalls(cs) { let done = 0; const skipped = []; for (const c of cs) { const a = availOf(c.person, svcOf(c).date, c.id); if (a.k === 'unavailable') { skipped.push(`${person(c.person).name} is unavailable ${fmtDay(svcOf(c).date)}`); continue; } c.status = 'OFFERED'; c.offered = TODAY; done++; } return { done, skipped }; }
function addCall(s, pid, status, extra = {}) { const r = role(extra.role || s.role); const c = { id:nid('a'), svc:s.id, person:pid, status, offered:status === 'OFFERED' ? TODAY : null, ...extra }; if (c.role === s.role) delete c.role; if (c.start === s.start) delete c.start; if (c.end === s.end) delete c.end; c.rate = extra.rate ?? r.cost; c.rateType = r.type; state.calls.push(c); return c; }
function act(name, el, ev) {
  const id = el.dataset.id;
  switch (name) {
    case 'close': closeLayer(); break;
    case 'noop': closeLayer(); toast('Not wired in this prototype'); break;
    case 'view': state.view = el.dataset.v; state.sel.clear(); state.q = ''; $('#q').value = ''; state.page = 0; state.sort = 'date'; state.dir = 'desc'; closeLayer(); render(); break;
    case 'seg': if (state.view === 'planner') state.seg = el.dataset.k; else { state.tseg = el.dataset.k; state.page = 0; } state.sel.clear(); closeLayer(); render(); break;
    case 'wk': { const d = +el.dataset.d, i = Math.max(0, weekDays().indexOf(state.day)); state.week = d === 0 ? '2026-11-10' : addD(state.week, 7 * d); state.sel.clear(); state.day = weekDays()[d === 0 ? 1 : i]; render(); break; }
    case 'day': state.day = el.dataset.d; render(); break;
    case 'sort': if (state.sort === el.dataset.k) state.dir = state.dir === 'asc' ? 'desc' : 'asc'; else { state.sort = el.dataset.k; state.dir = el.dataset.k === 'date' ? 'desc' : 'asc'; } render(); break;
    case 'page': state.page = Math.max(0, state.page + +el.dataset.d); render(); break;
    case 'more': state.page++; render(); break;
    case 'fmenu': { const b = el.dataset.b, k = el.dataset.k;
      if (b === 'f') { if (k === 'role') multi(el, 'f', 'role', 'Role', state.roles.filter(r => r.active).map(r => r.id), r => role(r).name); if (k === 'skill') multi(el, 'f', 'skill', 'Skill', [...new Set(state.crew.flatMap(p => p.skills))].sort()); if (k === 'job') multi(el, 'f', 'job', 'Job', ['#2341','#2350','#2338','#2336'], j => `${j} ${JOBS[j][0]}`); if (k === 'avail') multi(el, 'f', 'avail', 'Availability this week', ['Free','Booked','Unavailable','Pencilled','Preferred']); }
      else { if (k === 'person') multi(el, 'tf', 'person', 'Person', state.crew.map(p => p.id), p => person(p).name); if (k === 'job') multi(el, 'tf', 'job', 'Job', ['General', ...Object.keys(JOBS)], j => JOBS[j] ? `${j} ${JOBS[j][0]}` : j); if (k === 'status') multi(el, 'tf', 'status', 'Status', Object.keys(TST), s => TST[s][0]); }
      break; }
    case 'ftoggle': { const a = state[el.dataset.b][el.dataset.k], v = el.dataset.v, i = a.indexOf(v); i >= 0 ? a.splice(i, 1) : a.push(v); state.page = 0; state.savedView = null; render(); act('fmenu', el); break; }
    case 'fclear': state[el.dataset.b][el.dataset.k] = []; closeLayer(); render(); break;
    case 'datesmenu': openMenu(el, 'Dates', [['', 'Any time'], ['week', 'This week'], ['last', 'Last week'], ['month', 'Last 30 days']].map(([v, l]) => ({ label:l, act:'dateset', args:`data-v="${v}"`, on:state.tf.dates === v }))); break;
    case 'dateset': state.tf.dates = el.dataset.v; state.page = 0; state.savedView = null; closeLayer(); render(); break;
    case 'clearf': state.f = { role:[], skill:[], job:[], avail:[] }; state.tf = { person:[], job:[], status:[], dates:'' }; state.q = ''; $('#q').value = ''; state.savedView = null; state.page = 0; closeLayer(); render(); break;
    case 'viewsmenu': openMenu(el, 'Views', [{ sh:'Saved views · each one is a URL you can share' }, { label:'Needs approving, last week', act:'applyview', args:'data-i="0"', on:state.savedView === 'Needs approving, last week' }, { label:'Queried entries', act:'applyview', args:'data-i="1"', on:state.savedView === 'Queried entries' }, '-', { label:'Save current view…', act:'noop' }, ...(state.savedView ? [{ label:'Clear view', act:'clearf' }] : [])]); break;
    case 'applyview': { const v = [['Needs approving, last week', 'submitted', { dates:'week' }], ['Queried entries', 'queried', {}]][+el.dataset.i]; state.tf = { person:[], job:[], status:[], dates:'', ...v[2] }; state.tseg = v[1]; state.savedView = v[0]; state.page = 0; closeLayer(); render(); toast(`View “${v[0]}” · the filters are in the URL, so the link is the view`); break; }
    case 'pagemenu': if (state.view === 'planner') openMenu(el, 'Crew planner', [{ label:'Crew list', href:U.people, small:'People' }, { label:'Crew roles & rates…', act:'roles', small:state.roles.filter(r => r.active).length + ' roles' }, '-', { label:'Export this week (CSV)', act:'noop' }, { label:'Print this week', act:'noop' }]); else openMenu(el, 'Timesheets', [{ label:'Crew list', href:U.people, small:'People' }, { label:'Crew roles & rates…', act:'roles', small:state.roles.filter(r => r.active).length + ' roles' }, '-', ...(isPhone() ? [] : [{ label:'Columns', act:'colsmenu' }]), { label:'Export all…', act:'exportdlg' }]); break;
    case 'colsmenu': openMenu(el, 'Columns', [{ label:'Approved by', act:'coltoggle', args:'data-c="by"', on:state.cols.by }, { label:'Notes', act:'coltoggle', args:'data-c="notes"', on:state.cols.notes }, { sh:'Person, job, date, hours, rate, total and status are always shown' }]); break;
    case 'coltoggle': state.cols[el.dataset.c] = !state.cols[el.dataset.c]; closeLayer(); render(); break;
    case 'new': closeLayer(); if (state.view === 'planner') { const d = isPhone() ? state.day : (weekDays().find(x => state.svcs.some(s => s.date === x && openN(s) > 0)) || weekDays()[1]); openOffer('', d); } else tsForm(null); break;
    case 'select': { selectRange(id, visibleIds(), ev); render(); break; }
    case 'selall': { const ids = visibleIds(), all = ids.every(i => state.sel.has(i)); ids.forEach(i => all ? state.sel.delete(i) : state.sel.add(i)); render(); break; }
    case 'clearsel': state.sel.clear(); render(); break;
    // planner · calls
    case 'cell': { if (ev && ev.target.closest('a')) break; closeLayer(); openOffer(el.dataset.p, el.dataset.d); break; }
    case 'call': { if (ev && ev.target.closest('.cb,.dots,a')) break; callDialog(callById(id)); break; }
    case 'openrow': { if (ev && ev.target.closest('.cb,.dots,a')) break; const s = svc(id), c = candidates(s)[0]; openOffer(c ? c.p.id : '', s.date, s.id); break; }
    case 'callmenu': { const c = callById(id), p = person(c.person), s = svcOf(c);
      openMenu(el, `${esc(p.name)} · ${s.job} ${esc(s.title)}`, [...(c.status === 'PENDING' ? [{ label:'Offer', act:'callstatus', args:`data-id="${id}" data-s="OFFERED"` }] : []), ...(c.status === 'OFFERED' ? [{ label:'Resend offer', act:'callstatus', args:`data-id="${id}" data-s="OFFERED"` }, { label:'Mark accepted (they said yes)', act:'callstatus', args:`data-id="${id}" data-s="ACCEPTED"` }, { label:'Mark declined', act:'callstatus', args:`data-id="${id}" data-s="DECLINED"` }] : []), ...(c.status === 'ACCEPTED' ? [{ label:'Confirm', act:'callstatus', args:`data-id="${id}" data-s="CONFIRMED"` }] : []), '-', { label:'Edit call…', act:'editcall', args:`data-id="${id}"` }, { label:'Open job', href:U.logi, small:'Logistics' }, { label:'Open crew member', href:U.people, small:'People' }, ...(c.status !== 'COMPLETED' ? ['-', { label:'Cancel call…', act:'cancelone', args:`data-id="${id}"`, danger:true }] : [])]); break; }
    case 'editcall': closeLayer(); callDialog(callById(id)); break;
    case 'callstatus': { const c = callById(id), undo = snapshot(), p = person(c.person); const was = c.status; if (el.dataset.s === 'OFFERED') { const r = offerCalls([c]); if (!r.done) { toast(`Skipped · ${r.skipped[0]}`); closeLayer(); break; } } else c.status = el.dataset.s; closeLayer(); render(); toast(`${esc(p.name)} · ${CST[c.status][0]}${was === c.status ? ' again' : ''} · ${svcOf(c).job} ${esc(svcOf(c).title)}`, undo); break; }
    case 'openmenu': { const s = svc(id); openMenu(el, `${s.job} ${esc(s.title)} · needs ${openN(s)}`, [{ label:'Offer to…', act:'openoffer', args:`data-id="${id}"` }, { label:'Offer to suggested', act:'sugone', args:`data-id="${id}"` }, { label:'Open job', href:U.logi, small:'Logistics' }]); break; }
    case 'openoffer': { closeLayer(); const s = svc(id), c = candidates(s)[0]; openOffer(c ? c.p.id : '', s.date, s.id); break; }
    case 'sugone': { const s = svc(id), c = candidates(s).find(x => x.a.k !== 'pencilled') || candidates(s)[0]; closeLayer(); if (!c) { toast('No one free for that call'); break; } const undo = snapshot(); addCall(s, c.p.id, 'OFFERED'); render(); toast(`Offered ${esc(c.p.name)} · ${s.job} ${esc(s.title)}`, undo); break; }
    case 'sw': el.classList.toggle('on'); if (el.id === 'o-send') { state.od.now = el.classList.contains('on'); const g = $('#dlg-go'); if (g) g.textContent = state.od.now ? 'Offer call' : 'Save as pending'; } break;
    case 'offergo': { readOd(); const o = state.od; if (!o.p) { toast('Choose a person first'); break; } if (!o.s) { toast('Pick a job service — there is none on this day'); break; } const undo = snapshot(), s = svc(o.s), p = person(o.p); const c = addCall(s, o.p, 'PENDING', { role:o.role, start:o.start, end:o.end, rate:+o.rate || role(o.role).cost }); let msg = `Saved ${esc(p.name)} as pending`; if (o.now) { const r = offerCalls([c]); msg = r.done ? `Offered ${esc(p.name)} · ${s.job} ${esc(s.title)}, ${fmtDay(s.date)}` : `Saved pending · ${r.skipped[0]}`; } closeLayer(); if (!inWeek(s.date)) state.week = weekOf(s.date); render(); toast(msg, undo); break; }
    case 'callgo': { const c = callById(id), undo = snapshot(), s = svcOf(c); const v = k => document.getElementById(k).value; c.role = v('e-r') === s.role ? undefined : v('e-r'); c.start = v('e-st') === s.start ? undefined : v('e-st'); c.end = v('e-en') === s.end ? undefined : v('e-en'); c.rate = +v('e-rate') || c.rate; closeLayer(); render(); toast(`${esc(person(c.person).name)} · call updated`, undo); break; }
    case 'cancelone': closeLayer(); cancelDialog([id]); break;
    case 'cancelgo': { const undo = snapshot(), ids = el.dataset.ids.split(','); const n = ids.length; state.calls = state.calls.filter(c => !ids.includes(c.id)); state.sel.clear(); closeLayer(); render(); toast(`${n} call${n > 1 ? 's' : ''} cancelled · ${n > 1 ? 'the slots are' : 'the slot is'} open again`, undo); break; }
    case 'bulkoffer': { const undo = snapshot(), cs = selKinds().calls.filter(c => c.status === 'PENDING'), r = offerCalls(cs); state.sel.clear(); render(); toast(`Offered ${r.done}${r.skipped.length ? ` · ${r.skipped.length} skipped (${r.skipped.join('; ')})` : ' · each one ran its own availability check'}`, undo); break; }
    case 'bulkconfirm': { const undo = snapshot(), k = selKinds(), cs = k.calls.filter(c => c.status === 'ACCEPTED'), skip = k.calls.length - cs.length; cs.forEach(c => { c.status = 'CONFIRMED'; }); state.sel.clear(); render(); toast(`Confirmed ${cs.length}${skip ? ` · ${skip} skipped, still waiting on a yes` : ''}`, undo); break; }
    case 'bulksugg': { const undo = snapshot(), os = selKinds().opens; let done = 0; const none = []; for (const s of os) { for (let i = 0; i < openN(s); i++) { const c = candidates(s).find(x => x.a.k !== 'pencilled'); if (!c) { none.push(s.title); break; } addCall(s, c.p.id, 'OFFERED'); done++; } } state.sel.clear(); render(); toast(`Offered ${done} to free crew${none.length ? ` · ${none.length} had no one free` : ''}`, undo); break; }
    case 'bulkcancel': closeLayer(); cancelDialog(selKinds().calls.filter(c => c.status !== 'COMPLETED').map(c => c.id)); break;
    // roles & rates (/crew/settings)
    case 'roles': closeLayer(); rolesDialog(); break;
    case 'rolemenu': { const r = role(id), i = state.roles.indexOf(r); openMenu(el, r.name, [{ label:'Edit…', act:'roleedit', args:`data-id="${id}"` }, ...(r.active ? [{ label:'Move up', act:'rolemove', args:`data-id="${id}" data-d="-1"` }, { label:'Move down', act:'rolemove', args:`data-id="${id}" data-d="1"` }, '-', { label:'Archive…', act:'rolearch', args:`data-id="${id}"`, danger:true }] : [{ label:'Restore', act:'rolerestore', args:`data-id="${id}"` }])]); break; }
    case 'roleedit': closeLayer(); roleForm(role(id)); break;
    case 'rolenew': roleForm(null); break;
    case 'rolego': { const v = k => document.getElementById(k).value.trim(), name = v('r-name'); if (!name) { toast('A role needs a name'); break; } const undo = snapR(); const d = { name, dept:v('r-dept'), color:v('r-color'), type:v('r-type'), cost:v('r-cost') === '' ? null : +v('r-cost'), charge:v('r-charge') === '' ? 0 : +v('r-charge') }; if (id) Object.assign(role(id), d); else state.roles.push({ id:nid('r'), active:true, ...d }); render(); rolesDialog(); toast(id ? `${esc(name)} updated · new calls use the new rate` : `${esc(name)} added`, undo); break; }
    case 'rolemove': { const undo = snapR(), act2 = state.roles.filter(r => r.active), i = act2.findIndex(r => r.id === id), j = i + +el.dataset.d; if (j >= 0 && j < act2.length) { const a = state.roles.indexOf(act2[i]), b = state.roles.indexOf(act2[j]); [state.roles[a], state.roles[b]] = [state.roles[b], state.roles[a]]; } rolesDialog(); toast('Role order changed', undo); break; }
    case 'rolearch': { const r = role(id), people_ = state.crew.filter(p => p.roles.includes(id)).length, calls_ = state.calls.filter(c => cRole(c) === id).length; closeLayer(); openDialog(dlg('Crew roles', `Archive “${esc(r.name)}”?`, `<div class="t-small" style="line-height:1.5">${people_} ${people_ === 1 ? 'person has' : 'people have'} this role and ${calls_} call${calls_ === 1 ? '' : 's'} use it. They keep it. It just stops appearing when you add crew to a new job. You can restore it later.</div>`, `<div style="flex:1"></div><button class="btn btn-secondary" data-act="roles">Keep it</button><button class="btn btn-secondary" style="color:var(--t-out)" data-act="rolearchgo" data-id="${id}">Archive</button>`)); break; }
    case 'rolearchgo': { const undo = snapR(); role(id).active = false; render(); rolesDialog(); toast(`${esc(role(id).name)} archived`, undo); break; }
    case 'rolerestore': { const undo = snapR(); role(id).active = true; render(); rolesDialog(); toast(`${esc(role(id).name)} restored`, undo); break; }
    // timesheets
    case 'tsopen': { if (ev && ev.target.closest('.cb,.dots,a')) break; const e = entryById(id); if (e.status === 'EXPORTED') { toast('Exported entries are locked'); break; } tsForm(e); break; }
    case 'tsmenu': { const e = entryById(id), p = person(e.person); openMenu(el, `${esc(p.name)} · ${fmtDay(e.date)}`, [{ label:'Edit entry…', act:'tsedit', args:`data-id="${id}"` }, ...(['DRAFT','DISPUTED'].includes(e.status) ? [{ label:'Submit', act:'tsset', args:`data-id="${id}" data-s="SUBMITTED"` }] : []), ...(['SUBMITTED','DISPUTED'].includes(e.status) ? [{ label:'Approve', act:'tsset', args:`data-id="${id}" data-s="APPROVED"` }] : []), ...(['SUBMITTED','APPROVED'].includes(e.status) ? [{ label:'Query…', act:'tsquery', args:`data-id="${id}"` }] : []), { label:'Open crew member', href:U.people, small:'People' }, '-', { label:'Delete entry…', act:'tsdelete', args:`data-id="${id}"`, danger:true }]); break; }
    case 'tsedit': closeLayer(); tsForm(entryById(id)); break;
    case 'tsset': { const e = entryById(id), undo = snapshot(); e.status = el.dataset.s; if (e.status === 'APPROVED') e.by = ME; closeLayer(); render(); toast(`${esc(person(e.person).name)} · ${fmtDay(e.date)} · ${TST[e.status][0]}`, undo); break; }
    case 'tsquery': closeLayer(); queryDialog([id]); break;
    case 'bulkquery': closeLayer(); queryDialog([...state.sel]); break;
    case 'querygo': { const undo = snapshot(), note = $('#q-note', body).value.trim(), ids = el.dataset.ids.split(','); ids.forEach(i => { const e = entryById(i); e.status = 'DISPUTED'; e.by = null; if (note) e.notes = 'Query: ' + note; }); state.sel.clear(); closeLayer(); render(); toast(`${ids.length} ${ids.length > 1 ? 'entries' : 'entry'} queried · back with the crew member`, undo); break; }
    case 'bulkapprove': { const undo = snapshot(), k = selKinds(), es = k.ents.filter(e => ['SUBMITTED','DISPUTED'].includes(e.status)), skip = k.ents.length - es.length; es.forEach(e => { e.status = 'APPROVED'; e.by = ME; }); state.sel.clear(); render(); toast(`Approved ${es.length}${skip ? ` · ${skip} skipped (draft, approved or exported)` : ''}`, undo); break; }
    case 'bulksubmit': { const undo = snapshot(), es = selKinds().ents.filter(e => e.status === 'DRAFT'); es.forEach(e => { e.status = 'SUBMITTED'; }); state.sel.clear(); render(); toast(`Submitted ${es.length}`, undo); break; }
    case 'bulkexport': { const n = state.sel.size; closeLayer(); toast(`Exporting ${n} ${n > 1 ? 'entries' : 'entry'} as CSV`); break; }
    case 'exportdlg': closeLayer(); openDialog(dlg('Timesheets', 'Export timesheets', `<div class="g2">${field('From', '<input type="date" id="x-from">')}${field('To', '<input type="date" id="x-to">')}</div><div class="t-small muted">Leave both empty to export every entry. Ticked rows export from the bulk bar instead.</div>`, footBtns('exportgo', 'Export CSV'))); break;
    case 'exportgo': closeLayer(); toast('Exporting timesheets as CSV'); break;
    case 'tsdelete': closeLayer(); openDialog(dlg('Delete', 'Delete this entry?', `<div class="t-small" style="line-height:1.5">The hours leave the timesheet and the crew member’s total. Approved entries stop counting toward pay. This can be undone for the next few seconds.</div>`, `<div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Keep it</button><button class="btn btn-secondary" style="color:var(--t-out)" data-act="tsdeletego" data-id="${id}">Delete entry</button>`)); break;
    case 'tsdeletego': { const undo = snapshot(); state.entries = state.entries.filter(e => e.id !== id); state.sel.delete(id); closeLayer(); render(); toast('Entry deleted', undo); break; }
    case 'lt-pick': el.classList.toggle('on'); break;
    case 'tsgo': { const v = k => document.getElementById(k).value, undo = snapshot(); const job = v('t-job') || null, date = v('t-date'), st = v('t-st'), en = v('t-en'), brk = +v('t-br') || 0;
      if (id) { const e = entryById(id); Object.assign(e, { job, date, start:st, end:en, brk, desc:v('t-desc') || e.desc, notes:v('t-notes') }); closeLayer(); render(); toast('Time entry updated', undo); break; }
      const ids = [...body.querySelectorAll('.cb.on')].map(b => b.dataset.id); if (!ids.length) { toast('Tick at least one person'); break; }
      ids.forEach(pid => mkEntry({ person:pid, job, desc:v('t-desc') || 'Event', date, start:st, end:en, brk, notes:v('t-notes'), role:person(pid).roles[0], status:'DRAFT' })); state.tseg = 'all'; closeLayer(); render(); toast(`Logged time for ${ids.length} ${ids.length > 1 ? 'people' : 'person'} · saved as Draft`, undo); break; }
    case 'undo': if (state.undo) { state.undo(); state.undo = null; } $('#toast').classList.remove('open'); break;
    case 'toastclose': $('#toast').classList.remove('open'); break;
  }
}
document.addEventListener('input', ev => { if (ev.target.id === 'q') { state.q = ev.target.value; state.page = 0; render(); } });
document.addEventListener('change', ev => {
  const i = ev.target.id; if (!['o-p', 'o-d', 'o-s', 'o-r'].includes(i) || !state.od) return;
  const o = state.od, prev = { ...o }; readOd();
  if (i === 'o-d') { o.s = defaultSvcFor(o.p, o.d); applySvc(o); }
  if (i === 'o-s') applySvc(o);
  if (i === 'o-p' && o.p && !svc(o.s)?.role) applySvc(o);
  if (i === 'o-r') o.rate = role(o.role).cost;
  offerDialog();
});
render();
