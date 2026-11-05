// ---------- Home · data (Home /dashboard + My tasks + Notifications + Activity, one prototype)
const TODAY = '2026-11-09', NOW = '09:30', ME = 'u1';
const A = id => 'https://claude.ai/artifact/' + id;
const U = { OV:A('RatKsWfTmDJLJHmn6mb7Zo'), EQ:A('BdwR4bNbiNMLSvfRAByEwC'), LOG:A('E36tnBkGL9obdikUQ5mbXf'), FIN:A('7ByfxnbtsgQTJdiwvvo1CY'), TN:A('BrLBitu3c2V4uixLQbXCNE'), WH:A('Mt8p55xkPkkexVWPC5eaGU'), JOBS:A('A7SMPtpTr3aedUDEnuSaxd'), ASSETS:A('89PDTuMiovgP9i3h4MJ1Tw'),
  FLOOR:'https://claude.ai/artifact/6xqFcEZZk49w86p5pAsisA', ASSET:'https://claude.ai/artifact/Rr5rwirCUMRy8gf5G6Vz7s', MODEL:'https://claude.ai/artifact/47miWruJVsednbzrFPij2b', GEAR:'https://claude.ai/artifact/D7N5PmXKrkcY2gzZXWeuvc', PEOPLE:'https://claude.ai/artifact/LPdsNGb4CRMfS6qk7j7Fsa', FINHUB:'https://claude.ai/artifact/5VnYTVW2pdA5r1qBRvdrom', SET:'https://claude.ai/artifact/Q3TeWuQPjzvXbAtmUV8Hg8', PLAN:'https://claude.ai/artifact/AKkgWzJ2gVR3dJTWnMB2Ui', WIZ:'https://claude.ai/artifact/GgtKxc5WZP33gXihgFTB9B' };
const PEOPLE = { u1:'Jayden Cole', u2:'Mel Torres', u3:'Sam Okafor', u4:'Tom Nguyen' };
const first = n => n.split(' ')[0], inits = n => n.split(' ').map(x => x[0]).join('');
const rnd = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(11);
const pick = a => a[Math.floor(rnd() * a.length)];
const addD = (d, n) => new Date((dayNum(d) + n) * 864e5).toISOString().slice(0,10);
const dayName = d => WD[new Date(d + 'T00:00:00Z').getUTCDay()];
const longDay = d => `${dayName(d)} ${+d.slice(8,10)} ${fmtD(d).split(' ')[1]}`;
const range = (a, b) => a === b ? fmtD(a) : fmtRange(a, b);

// Home widgets (the live registry, src/lib/dashboard-widgets.ts) — each maps to one piece of the standard layout
const WIDGETS = [
  ['finishSetupChecklist','Finish setup','Org setup checklist (currency, branding, location, team). Hides itself once complete.'],
  ['activationChecklist','Get started','First-run activation milestones. Hides itself once complete.'],
  ['statActiveJobs','Active jobs','Count of in-flight jobs. Opens Jobs on its segment.'],
  ['statOverdueReturns','Overdue returns','Count of returns past due. Opens Jobs on Out · overdue.'],
  ['statGearDeployed','Gear deployed','Assets checked out right now. Opens Assets on On jobs.'],
  ['statCrewBooked','Crew booked','Crew on the books. Opens Crew on On a job.'],
  ['needsAttention','Needs me','Exceptions from every list — blockers, overdue, unconfirmed, overbooked.'],
  ['onTheFloorNow','On now','On the floor, out today and due back.'],
  ['myTasks','My tasks','Your open tasks across every job.'],
  ['upcomingProjects','Coming up','Jobs booked ahead, soonest first.'],
  ['recentActivity','Recent activity','Scans, tests and maintenance updates across the org.'],
];
const FINISH = [['currency','Set your currency and tax details',false,U.SET,'Settings'],['logo','Add your logo',false,U.SET,'Settings › Branding'],['location','Add a location',true],['team','Invite your team',true]];
const ACTIVATION = [['model','Add a piece of gear you own',true],['asset','Add a real unit of it',true],['project','Create your first job',true],['lineItem','Put that gear on the job',true]];

// Needs me — the union of the lists' exception segments (derived, never stored); each row opens its record
const NEEDS = [
  { flag:'Blocking discussion', cls:'err', id:'#2341', sub:'Hilton Sydney gala dinner · risk assessment not signed, prep is held', where:'Overview', href:U.OV, list:['Jobs · Needs you', U.JOBS + '?seg=needs'] },
  { flag:'Overdue invoice', cls:'err', id:'INV-0038', sub:'Qantas · $8,400 · 12d overdue', where:'Finance', href:U.FIN, list:['Finance hub · Invoices · Overdue', U.FINHUB + '?seg=overdue'] },
  { flag:'Would be short', cls:'warn', id:'PXL', sub:'Martin MAC Aura PXL · short 2 on 13 – 14 Nov if #2350 Qantas confirms · #2341 Hilton gala', where:'Overbookings', href:U.GEAR, list:['Overbookings · This week', U.GEAR + '?seg=week'] },
  { flag:'Crew unconfirmed', cls:'warn', id:'#2341', sub:'Hilton Sydney gala dinner · 3 of 5 haven’t answered · Oli, Jess, Dev', where:'Logistics', href:U.LOG, list:['Crew · Unconfirmed', U.PEOPLE + '?seg=unconfirmed'] },
  { flag:'Test & tag overdue', cls:'warn', id:'AURA-02', sub:'Martin MAC Aura XB · tested 22 Oct 2025 · 18d overdue', where:'Asset', href:U.ASSET, list:['Assets · Needs attention', U.ASSETS + '?seg=attention'] },
  { flag:'Quote expires Thu', cls:'warn', id:'#2350', sub:'Qantas awards night · $41,200 · valid until Thu 12 Nov', where:'Finance', href:U.FIN, list:['Finance hub · Quotes · Sent', U.FINHUB + '?seg=sent'] },
  { flag:'Sub-hire overdue', cls:'warn', id:'SH-0019', sub:'Big Picture · LED panels on #2331 · due back Sat 7 Nov', where:'Equipment', href:U.EQ, list:['Suppliers · Overdue returns', U.PEOPLE + '?seg=overdue'] },
  { flag:'2 models due for service', cls:'warn', id:'', sub:'Sennheiser EW-DX SK beltpack · Shure ULXD4Q kit', where:'Model', href:U.MODEL, list:['Models · Due for T&T', U.MODEL + '?seg=due'] },
];
// On now — org-wide: on the floor, out today, due back
const ONNOW = [
  ['On the floor', U.FLOOR, [
    { name:'Atlassian town hall', id:'#2344', sub:'Atlassian · On site · 31 lines', rt:'back Fri 13 Nov', href:U.FLOOR },
    { name:'ICC Sydney trade show', id:'#2339', sub:'ICC Sydney · Deployed · 58 lines', rt:'back Thu 12 Nov', href:U.FLOOR } ]],
  ['Out today', U.WH, [
    { name:'Launch night', id:'#2340', sub:'Live Nation · Van 1 · 18 of 18 packed', rt:'13:00', mono:true, href:U.WH },
    { name:'Ogilvy product launch', id:'#2347', sub:'Ogilvy · Van 2 · packing 41 of 44', rt:'15:30', mono:true, href:U.WH } ]],
  ['Due back', U.FLOOR, [
    { name:'Sydney Opera House town hall', id:'#2331', sub:'Sydney Opera House · 41 lines still out', flag:'2d overdue', href:U.FLOOR },
    { name:'Canva sales kickoff', id:'#2336', sub:'Canva · 26 lines still out', flag:'1d overdue', href:U.FLOOR },
    { name:'Red Bull activation', id:'#2342', sub:'Red Bull · 12 lines', rt:'tomorrow', href:U.FLOOR } ]],
];
const UPCOMING = [
  { name:'Hilton Sydney gala dinner', id:'#2341', client:'Hilton Sydney', a:'2026-11-12', b:'2026-11-14', st:'Confirmed', cls:'info', lock:true },
  { name:'Qantas awards night', id:'#2350', client:'Qantas', a:'2026-11-14', b:'2026-11-14', st:'Quoted', cls:'info' },
  { name:'Corporate AGM', id:'#2338', client:'Atlassian', a:'2026-11-21', b:'2026-11-21', st:'Awaiting payment', cls:'warn', lock:true },
  { name:'UNSW graduation', id:'#2352', client:'UNSW', a:'2026-11-24', b:'2026-11-25', st:'Quoting', cls:'info' },
];
const STATS = [
  { k:'statActiveJobs', n:14, l:'Active jobs', s:'in flight', href:U.JOBS + '?seg=active', tip:'Jobs list · ?seg=active' },
  { k:'statOverdueReturns', n:ONNOW[2][2].filter(r => r.flag).length, l:'Overdue returns', s:'chase them', href:U.JOBS + '?seg=out&overdue=1', tip:'Jobs list · ?seg=out&overdue=1', bad:true },
  { k:'statGearDeployed', n:41, l:'Gear deployed', s:'65% of 63 out', href:U.ASSETS + '?seg=deployed', tip:'Assets list · ?seg=deployed' },
  { k:'statCrewBooked', n:9, l:'Crew booked', s:'on the books', href:U.PEOPLE + '?seg=on-job', tip:'Crew list · ?seg=on-job' },
];

// ---------- tasks (assigned to me, across every job)
const TASKS = [
  { id:'k1', title:'Send revised quote to Qantas', job:['#2350','Qantas awards night'], due:'2026-11-07', prio:'HIGH' },
  { id:'k2', title:'Chase Big Picture on the LED panels return', job:['#2331','Opera House town hall'], due:'2026-11-07' },
  { id:'k5', title:'Order spare gaffer tape for Launch night', job:['#2340','Launch night'], due:'2026-11-09' },
  { id:'k3', title:'Confirm the stage position with Priya', job:['#2341','Hilton gala'], due:'2026-11-10', prio:'HIGH' },
  { id:'k4', title:'Book the loading dock with Marco', job:['#2341','Hilton gala'], due:'2026-11-10' },
  { id:'k6', title:'Confirm PO 77812 covers the sub-hire', job:['#2341','Hilton gala'], due:'2026-11-11', prio:'HIGH' },
  { id:'k7', title:'Renew public liability certificate', job:null, due:'2026-11-14' },
  { id:'k8', title:'Book van service', job:null, due:null },
  { id:'d1', title:'Get Dan’s rigging cert', job:['#2341','Hilton gala'], due:'2026-11-07', done:'2026-11-06' },
  { id:'d2', title:'Site visit with Priya', job:['#2341','Hilton gala'], due:'2026-10-28', done:'2026-10-28' },
];
// ---------- notifications (derived feed; "read" is the live dismissal)
const NOTES = [
  { id:'n1', day:'2026-11-09', time:'08:30', sev:'error', type:'Overdue return', title:'Opera House town hall is 2 days overdue', desc:'Due back Sat 7 Nov · 41 items still out', href:U.FLOOR },
  { id:'n2', day:'2026-11-09', time:'08:30', sev:'error', type:'Overdue return', title:'Canva sales kickoff is 1 day overdue', desc:'Due back Sun 8 Nov · 26 items still out', href:U.FLOOR },
  { id:'n3', day:'2026-11-09', time:'07:45', sev:'warning', type:'Crew', title:'3 crew offers are waiting on a reply', desc:'#2341 Hilton gala · Oli Martin, Jess Tran, Dev Patel', href:U.LOG },
  { id:'n6', day:'2026-11-09', time:'06:00', sev:'info', type:'Upcoming', title:'Hilton Sydney gala dinner starts Wednesday', desc:'12 – 14 Nov · truck leaves Tue 11 Nov, 06:30', href:U.OV },
  { id:'n4', day:'2026-11-08', time:'17:10', sev:'warning', type:'Timesheets', title:'2 timesheets are waiting for approval', desc:'Dan Wu, Ash Reyes · #2339 ICC trade show', href:U.PLAN },
  { id:'n5', day:'2026-11-07', time:'09:00', sev:'warning', type:'Maintenance', title:'Lamp replacement is overdue', desc:'MAC Aura PXL L-0004 · was due Fri 6 Nov', href:U.ASSET },
  { id:'n7', day:'2026-11-06', time:'11:20', sev:'info', type:'Invitation', title:'Ari Nguyen hasn’t accepted the invitation', desc:'Sent Wed 4 Nov', href:U.SET, read:true },
  { id:'n9', day:'2026-11-03', time:'08:00', sev:'warning', type:'Maintenance', title:'Shure ULXD4Q kit K-0042 is due for service', desc:'Service was due Mon 3 Nov', href:U.ASSET, read:true },
  { id:'n8', day:'2026-11-02', time:'06:00', sev:'info', type:'Upcoming', title:'Corporate AGM starts in 19 days', desc:'Fri 21 Nov · Atlassian', href:U.OV, read:true },
  { id:'n10', day:'2026-10-30', time:'16:40', sev:'error', type:'Overdue return', title:'Atlassian bump-in kit came back late', desc:'Due Thu 29 Oct · returned Fri 30 Oct', href:U.FLOOR, read:true },
];
const SEV = { error:'err', warning:'warn', info:'info' };

// ---------- activity (the audit log; actions use the live labels, src/app/(app)/activity/page.tsx)
const JOBS = [['#2341','Hilton Sydney gala dinner'],['#2338','Corporate AGM'],['#2340','Launch night'],['#2350','Qantas awards night'],['#2344','Atlassian town hall'],['#2339','ICC Sydney trade show'],['#2331','Opera House town hall'],['#2336','Canva sales kickoff']];
const CREW = ['Oli Martin','Sam Kowalski','Jess Tran','Dev Patel','Mia Rossi','Tom Brennan','Ari Nguyen','Lena Fischer','Dan Wu','Ash Reyes'];
const TASKT = ['Book the loading dock with Marco','Confirm the stage position with Priya','Order spare gaffer tape','Send revised quote to Qantas','Get Dan’s rigging cert'];
const TPL = [
  ['Status Change','Job', j => `moved ${j[0]} ${j[1]} to ${pick(['Prepping','Confirmed','Quoted'])}`, () => U.OV, 3],
  ['Deploy','Job', j => `deployed ${8 + Math.floor(rnd() * 32)} items to ${j[0]} ${j[1]}`, () => U.FLOOR, 2, true],
  ['Return','Job', j => `returned ${6 + Math.floor(rnd() * 24)} items from ${j[0]} ${j[1]}`, () => U.FLOOR, 2, true],
  ['Assign','Crew call', j => `assigned ${pick(CREW)} to ${j[0]} · ${pick(['Rigger','Audio A1','Vision','Stagehand'])}`, () => U.LOG, 3],
  ['Create','Task', () => `created task “${pick(TASKT)}”`, () => U.TN, 2],
  ['Update','Task', () => `ticked off “${pick(TASKT)}”`, () => U.TN, 2],
  ['Quote Sent','Quote', j => `sent quote v${1 + Math.floor(rnd() * 3)} for ${j[0]} ${j[1]}`, () => U.FIN, 3],
  ['Invoice Issued','Invoice', j => `issued INV-00${40 + Math.floor(rnd() * 5)} for ${j[0]}`, () => U.FIN, 1],
  ['Synced to Xero','Invoice', () => `synced INV-00${40 + Math.floor(rnd() * 5)} to Xero`, () => U.FIN, 1],
  ['Update','Test & tag', () => `tested ${pick(['AURA-01','AURA-04','SK-0012','A-0301','V-0011'])} · ${pick(['pass','pass','pass','fail'])}`, () => U.ASSET, 4, true],
  ['Update','Maintenance', () => `scheduled lamp replacement on ${pick(['L-0004','L-0007','L-0011'])}`, () => U.ASSET, 4, true],
  ['Pricing Locked','Job', j => `locked pricing on ${j[0]} ${j[1]}`, () => U.OV, 3],
];
const ACT = [];
const ev = (day, time, who, action, entity, text, ref, href, o = {}) => ACT.push({ day, time, who, agent:!!o.agent, action, entity, text, ref, href, scan:!!o.scan });
// hand-set story rows
ev(TODAY,'09:12','u3','Update','Job','packed 14 items for #2340 Launch night','#2340',U.WH,{scan:true});
ev(TODAY,'08:48','u2','Invoice Issued','Invoice','issued INV-0044 · $4,200 deposit for #2338 Corporate AGM','#2338',U.FIN);
ev(TODAY,'08:31','u1','Update','Job','checked availability for #2350 Qantas awards night','#2350',U.OV,{agent:true});
ev(TODAY,'08:05','u4','Return','Job','returned 9 items from #2342 Red Bull activation','#2342',U.FLOOR,{scan:true});
ev('2026-11-08','16:20','u1','Update','Crew call','moved Delivery to Tue 11 · 06:30','#2341',U.LOG);
ev('2026-11-08','14:02','u3','Update','Test & tag','tested AURA-04 · pass','AURA-04',U.ASSET,{scan:true});
ev('2026-11-07','15:45','u2','Update','Invoice','recorded $5,970 on INV-0041','INV-0041',U.FIN);
ev('2026-11-07','11:10','u1','Update','Task','ticked off “Get Dan’s rigging cert”','#2341',U.TN);
for (let i = 0; i < 52; i++) {
  const t = TPL[Math.floor(rnd() * TPL.length)], j = pick(JOBS), who = pick(['u1','u2','u3','u4','u1']);
  const day = addD('2026-11-07', -Math.floor(i / 5.6)), time = `${String(7 + Math.floor(rnd() * 11)).padStart(2,'0')}:${String(Math.floor(rnd() * 60)).padStart(2,'0')}`;
  ev(day, time, who, t[0], t[1], t[2](j), t[1] === 'Invoice' || t[1] === 'Test & tag' || t[1] === 'Maintenance' ? j[0] : j[0], t[3](), { scan:!!t[5], agent:rnd() < .08 });
}
ACT.sort((a, b) => (b.day + b.time).localeCompare(a.day + a.time));
ACT.forEach((e, i) => { e.id = 'a' + i; });
const ACTIONS = [...new Set(ACT.map(e => e.action))], ENTITIES = [...new Set(ACT.map(e => e.entity))];
const AVIEWS = [{ name:'Agent writes', f:{ actor:['agent'] } }, { name:'Finance events', f:{ entity:['Quote','Invoice'] } }];

const VIEWS = [['home','Home'],['tasks','My tasks'],['notes','Notifications'],['activity','Activity']];
const state = { view:'home', seg:{ tasks:'open', notes:'unread', activity:'all' }, w:Object.fromEntries(WIDGETS.map(w => [w[0], true])), setup:{ show:true }, needsAll:false,
  tasks:TASKS.map(t => ({ ...t })), notes:NOTES.map(n => ({ ...n })), selMode:false, selT:new Set(), selN:new Set(), lastSel:null,
  q:'', f:{ actor:[], action:[], entity:[] }, scope:null, savedView:null, page:0, size:25, undo:null };

// ---------- derived
const taskOpen = t => !t.done, openTasks = () => state.tasks.filter(taskOpen), doneTasks = () => state.tasks.filter(t => t.done);
const dueInfo = t => { if (!t.due) return { label:'no date', cls:'', k:4 }; const d = dayNum(t.due) - dayNum(TODAY); return d < 0 ? { label:`${-d}d overdue`, cls:'late', k:0 } : d === 0 ? { label:'Today', cls:'today', k:1 } : d === 1 ? { label:'Tomorrow', cls:'', k:2 } : { label:longDay(t.due), cls:'', k:d <= 6 ? 2 : 3 }; };
const TGROUPS = ['Overdue','Today','This week','Later','No date'];
const groupOf = t => { const i = dueInfo(t); return i.k === 4 ? 4 : i.k; };
const unread = () => state.notes.filter(n => !n.read);
const ngroup = n => { const d = dayNum(TODAY) - dayNum(n.day); return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : d <= 7 ? 'This week' : 'Earlier'; };
const setupItems = () => [...(state.w.finishSetupChecklist ? FINISH : []), ...(state.w.activationChecklist && ACTIVATION.some(i => !i[2]) ? ACTIVATION : [])];
const setupVisible = () => state.setup.show && setupItems().some(i => !i[2]);
function aRows() {
  const q = state.q.trim().toLowerCase(), f = state.f;
  return ACT.filter(e => (state.seg.activity !== 'mine' || e.who === ME) && (state.seg.activity !== 'today' || e.day === TODAY)
    && (!q || [e.text, PEOPLE[e.who], e.ref, e.entity, e.action].some(x => x.toLowerCase().includes(q)))
    && (!f.actor.length || f.actor.includes(e.agent ? 'Agent' : 'Human')) && (!f.action.length || f.action.includes(e.action)) && (!f.entity.length || f.entity.includes(e.entity))
    && (!state.scope || e.ref === state.scope));
}
const task = id => state.tasks.find(t => t.id === id), note = id => state.notes.find(n => n.id === id);
function snapshot() { const s = JSON.stringify({ tasks:state.tasks, notes:state.notes, w:state.w, setup:state.setup }); return () => { const o = JSON.parse(s); state.tasks = o.tasks; state.notes = o.notes; state.w = o.w; state.setup = o.setup; state.selT.clear(); state.selN.clear(); render(); }; }
const setHash = () => { try { history.replaceState(null, '', '#' + state.view + (state.view === 'activity' ? '/' + state.seg.activity : '')); } catch (e) {} };

// ---------- shell wiring (nav none: sidebar + bottom nav are wired here)
(function wire() {
  const items = [['Dashboard','#home','blue',true],['Jobs',U.JOBS,'blue'],['Finance',U.FINHUB,'green'],['Schedule','#schedule','green'],['Crew',U.PEOPLE,'purple'],['Assets',U.ASSETS,'amber'],['Warehouse',U.FLOOR,'teal'],['Test & tag','#test','teal'],['Maintenance','#maintenance','amber']];
  $('#sidenav').innerHTML = items.map(([n,h,c,on]) => `<a href="${h}" ${on ? 'data-act="view" data-v="home"' : ''} class="${on ? 'on' : ''}"><span class="patch" style="background:var(--${c}-soft, var(--paper-2))"></span>${n}</a>`).join('');
  const bn = $('.bottomnav');
  bn.querySelector('a[href="#home"]').classList.add('on');
  bn.querySelector('a[href="#jobs"]').href = U.JOBS; bn.querySelector('a[href="#warehouse"]').href = U.FLOOR; bn.querySelector('a[href="#assets"]').href = U.ASSETS;
  const ph = $('.phonehead'); const back = document.createElement('button'); back.id = 'phoneback'; back.className = 'btn btn-icon btn-lg'; back.setAttribute('data-act', 'view'); back.setAttribute('data-v', 'home'); back.setAttribute('aria-label', 'Back to Home'); back.style.cssText = 'color:var(--ink);display:none'; back.textContent = '‹'; ph.insertBefore(back, ph.firstChild);
  const h = location.hash.replace('#', '').split('/'); if (VIEWS.some(v => v[0] === h[0])) { state.view = h[0]; if (h[0] === 'activity' && ['mine','today','all'].includes(h[1])) state.seg.activity = h[1]; }
})();

// ---------- render
function render() { renderChrome(); renderStrip(); renderToolbar(); for (const v of ['home','tasks','notes','activity']) $('#v-' + v).style.display = state.view === v ? '' : 'none'; ({ home:renderHome, tasks:renderTasks, notes:renderNotes, activity:renderActivity })[state.view](); renderFoot(); renderBulk(); }
function counts() { return { tasks:openTasks().length, notes:unread().length }; }
function renderChrome() {
  const c = counts(), v = state.view, v0 = $('#v-' + v);
  const meta = {
    home:{ h:'Good morning, ' + first(PEOPLE[ME]), sub:'9 November · Two Toned Productions', p:'+ New job', href:U.WIZ, phone:'Home', psub:'9 Nov · Two Toned Productions' },
    tasks:{ h:`My tasks<span class="cnt">${c.tasks}</span>`, sub:'Open tasks assigned to you, across every job', p:'+ New task', href:'#', phone:'My tasks', psub:'Open tasks assigned to you' },
    notes:{ h:`Notifications<span class="cnt">${c.notes}</span>`, sub:c.notes ? 'Opening one marks it read · they clear themselves when the cause is fixed' : 'All caught up', p:c.notes ? 'Mark all read' : '', href:'#', phone:'Notifications', psub:c.notes ? `${c.notes} unread` : 'All caught up' },
    activity:{ h:`Activity<span class="cnt">${ACT.length}</span>`, sub:'The audit trail of every action your team and agents took', p:'', href:'#', phone:'Activity', psub:'Everything your team and agents did' },
  }[v];
  $('#h1').innerHTML = meta.h; $('#hsub').textContent = meta.sub; $('#phonesub').textContent = meta.psub; $('.phonehead .ell').textContent = meta.phone;
  $('.crumb').innerHTML = v === 'home' ? '<b>Dashboard</b>' : `<a href="#home" data-act="view" data-v="home" style="color:var(--muted)">Dashboard</a><span>›</span><b>${meta.phone}</b>`;
  const pr = $('#primary'), pp = $('#phoneprimary'); for (const b of [pr, pp]) { b.textContent = meta.p; b.setAttribute('href', meta.href); b.style.display = meta.p ? '' : 'none'; }
  $('#phoneact').style.display = meta.p ? '' : 'none'; if (!meta.p) $('#phoneact').style.setProperty('display', 'none', 'important'); else $('#phoneact').style.removeProperty('display');
  $('#phoneback').style.display = v === 'home' ? 'none' : '';
  $('#viewsw').innerHTML = VIEWS.map(([k, n]) => `<button class="fw ${v === k ? 'on' : ''}" data-act="view" data-v="${k}">${n}${k === 'tasks' && c.tasks ? ` <span class="mono faint" style="margin-left:4px">${c.tasks}</span>` : ''}${k === 'notes' && c.notes ? ` <span class="mono faint" style="margin-left:4px">${c.notes}</span>` : ''}</button>`).join('');
  $('#phonetabs').innerHTML = VIEWS.map(([k, n]) => `<button class="chip ${v === k ? 'on' : ''}" data-act="view" data-v="${k}">${n}${k === 'tasks' && c.tasks ? ` <span class="chip-count">${c.tasks}</span>` : ''}${k === 'notes' && c.notes ? ` <span class="chip-count">${c.notes}</span>` : ''}</button>`).join('');
}
function renderStrip() {
  const el = $('#strip'), v = state.view; el.style.display = v === 'home' ? 'none' : '';
  const segs = v === 'tasks' ? [['open','Open',openTasks().length],['done','Done',doneTasks().length]] : v === 'notes' ? [['unread','Unread',unread().length],['all','All',state.notes.length]] : [['mine','Mine',ACT.filter(e => e.who === ME).length],['today','Today',ACT.filter(e => e.day === TODAY).length],['all','All',ACT.length]];
  el.innerHTML = v === 'home' ? '' : segs.map(([k, n, c]) => `<button class="${state.seg[v] === k ? 'on' : ''}" data-act="seg" data-k="${k}">${n} <span class="n">${c}</span></button>`).join('');
}
function renderToolbar() {
  const el = $('#toolbar'), on = state.view === 'activity'; el.style.display = on ? '' : 'none'; if (!on) return;
  const f = state.f, w = (label, key) => filterWord(label, key, f[key].length ? (f[key].length > 1 ? f[key].length + ' chosen' : f[key][0]) : '', 'afmenu');
  $('#fwords').innerHTML = w('Actor','actor') + w('Action','action') + w('Entity','entity') + (state.scope ? `<button class="fw on" data-act="ascopeclear">Record: ${esc(state.scope)}</button>` : '') + (Object.values(f).some(a => a.length) || state.q || state.scope ? `<button class="fw" data-act="aclear" style="color:var(--blue)">Clear</button>` : '');
  $('#views').innerHTML = `<button class="fw ${state.savedView ? 'on' : ''}" data-act="aviews">${state.savedView ? 'View: ' + esc(state.savedView) : 'Views ▾'}</button>`;
}
function renderFoot() { const el = $('#foot'); if (state.view !== 'activity') { el.innerHTML = ''; el.style.display = 'none'; return; } el.style.display = ''; const n = aRows().length; el.innerHTML = isPhone() ? `<span>${n} events</span>` : pager(n, 'events'); }

// ---- Home
const dotw = (cls, txt) => `<span class="dotw ${cls}">${esc(txt)}</span>`;
function rowMenuBtn(g, i) { return `<button class="dots" data-act="rmenu" data-g="${g}" data-i="${i}" aria-label="More">${ICON.dots}</button>`; }
function needRow(r, i) { return `<div class="hrow"><a class="hmain" href="${r.href}"><span class="grow"><span class="ttl">${dotw(r.cls, r.flag)}${r.id ? `<span class="id">${esc(r.id)}</span>` : ''}</span><span class="sub">${esc(r.sub)}</span></span><span class="where">${r.where} ›</span></a>${rowMenuBtn('need', i)}</div>`; }
function nowRow(r, gi, i) { return `<div class="hrow"><a class="hmain" href="${r.href}"><span class="grow"><span class="ttl">${esc(r.name)}<span class="id">${esc(r.id)}</span></span><span class="sub">${esc(r.sub)}</span></span>${r.flag ? dotw('err', r.flag) : `<span class="rt ${r.mono ? 'mono' : ''}">${esc(r.rt)}</span>`}</a>${rowMenuBtn('now' + gi, i)}</div>`; }
function upRow(r, i) { return `<div class="hrow"><a class="hmain" href="${U.OV}"><span class="grow"><span class="ttl">${esc(r.name)}<span class="id">${esc(r.id)}</span></span><span class="sub">${esc(r.client)} · ${range(r.a, r.b)}</span></span>${dotw(r.cls, r.st)}${r.lock ? `<span class="faint" title="Pricing locked">${ICON.lock}</span>` : ''}</a>${rowMenuBtn('up', i)}</div>`; }
function setupPanel() {
  const items = setupItems(), done = items.filter(i => i[2]).length, todo = items.filter(i => !i[2]);
  return `<section class="setup"><div class="shd">Finish setup <span class="n">${done} / ${items.length}</span><span class="sright"><button class="lnk muted" data-act="setupdismiss">Dismiss</button></span></div><div class="prog">${items.map(i => `<i class="${i[2] ? 'd' : ''}"></i>`).join('')}</div><ul class="todo">${todo.map(i => `<li><a href="${i[3] || U.SET}"><span class="dot"></span><span class="grow">${esc(i[1])}</span><span class="muted t-small">${i[4] || 'Settings'} ›</span></a></li>`).join('')}</ul></section>`;
}
function activityGroupRows(rows, max) {
  let h = '', last = '';
  for (const e of rows.slice(0, max)) { const g = e.day === TODAY ? 'Today' : e.day === addD(TODAY, -1) ? 'Yesterday' : longDay(e.day); if (g !== last) { h += `<div class="gl ${last ? '' : 'first'}">${g}</div>`; last = g; } h += actRow(e, false); }
  return h;
}
function actRow(e, full) {
  const p = PEOPLE[e.who];
  return `<div class="arow"><a class="hmain" href="${e.href}"><span class="ini ${e.agent ? 'agent' : ''}">${inits(p)}</span><span class="grow"><span class="atxt"><b>${esc(p)}</b> ${esc(e.text)}</span>${full ? `<span class="sub">${esc(e.action)} · ${esc(e.entity)}${e.agent ? ' · ' + dotw('info', 'agent') : ''}</span>` : ''}</span><span class="when">${e.time}</span></a>${full ? `<button class="dots" data-act="amenu" data-id="${e.id}" aria-label="More">${ICON.dots}</button>` : ''}</div>`;
}
function renderHome() {
  const w = state.w; let h = '';
  if (setupVisible()) h += setupPanel();
  const st = STATS.filter(s => w[s.k]);
  if (st.length) h += `<div class="stats ${st.length < 4 ? 'solo' : ''}">${st.map(s => `<a class="stat ${s.bad && s.n ? 'bad' : ''}" href="${s.href}" data-tip="${s.tip}" aria-label="${s.l}: ${s.n}. Opens ${s.tip}"><span class="n">${s.n}</span><span class="l">${s.l}</span><span class="s">${s.k === 'statOverdueReturns' && !s.n ? 'all back' : s.s}</span></a>`).join('')}</div>`;
  const needs = state.needsAll ? NEEDS : NEEDS.slice(0, 6), more = NEEDS.length - needs.length;
  const nowN = ONNOW.reduce((a, g) => a + g[2].length, 0);
  const left = w.needsAttention ? `<div class="col"><div class="shd">Needs me <span class="n">${NEEDS.length}</span></div>${needs.map((r, i) => needRow(r, i)).join('')}${more > 0 ? `<div class="more"><button class="lnk muted" data-act="needsall">and ${more} more ›</button></div>` : state.needsAll ? `<div class="more"><button class="lnk muted" data-act="needsall">show fewer</button></div>` : ''}</div>` : '';
  const right = w.onTheFloorNow ? `<div class="col"><div class="shd">On now <span class="n">${nowN}</span></div>${ONNOW.map(([label, href, rows], gi) => `<div class="gl ${gi ? '' : 'first'}"><a href="${href}">${label}</a><span class="n">${rows.length}</span></div>${rows.map((r, i) => nowRow(r, gi, i)).join('')}`).join('')}</div>` : '';
  if (left || right) h += `<div class="cols ${left && right ? '' : 'one'}">${left}${right}</div>`;
  const open = openTasks().slice().sort((a, b) => dueInfo(a).k - dueInfo(b).k || (a.due || '9').localeCompare(b.due || '9'));
  const tk = w.myTasks ? `<div class="col"><div class="shd">My tasks <span class="n">${open.length}</span><span class="sright"><a class="lnk" href="#tasks" data-act="view" data-v="tasks">All ›</a></span></div>${open.length ? open.slice(0, 4).map(t => taskRow(t, true)).join('') : `<div class="calmmsg"><b>Nothing assigned to you.</b> Tasks assigned to you show up here.</div>`}</div>` : '';
  const up = w.upcomingProjects ? `<div class="col"><div class="shd">Coming up <span class="n">${UPCOMING.length}</span><span class="sright"><a class="lnk" href="${U.JOBS}?seg=booked">All jobs ›</a></span></div>${UPCOMING.map((r, i) => upRow(r, i)).join('')}</div>` : '';
  if (tk || up) h += `<div class="cols ${tk && up ? '' : 'one'}">${tk}${up}</div>`;
  if (w.recentActivity) { const scans = ACT.filter(e => e.scan); h += `<section style="padding-top:22px;border-top:1px solid var(--line);margin-top:14px"><div class="shd">Recent activity <span class="n">scans, tests, maintenance</span><span class="sright"><a class="lnk" href="#activity" data-act="view" data-v="activity">All activity ›</a></span></div>${scans.length ? activityGroupRows(scans, 6) : `<div class="calmmsg"><b>Quiet so far.</b> Scan some gear and it’ll show up here.</div>`}</section>`; }
  if (!h) h = `<div class="empty"><b>Home is empty</b>Every widget is switched off. <button class="lnk" data-act="customise">Customise…</button></div>`;
  $('#v-home').innerHTML = h;
}

// ---- My tasks
function taskRow(t, home) {
  const di = dueInfo(t), sel = state.selT.has(t.id), done = !!t.done;
  const lead = state.selMode && !home && !done ? `<button class="cb ${sel ? 'on' : ''}" data-act="tselect" data-id="${t.id}" aria-label="Select ${esc(t.title)}"></button>` : `<button class="vc ${done ? 'on' : ''}" data-act="ttoggle" data-id="${t.id}" aria-label="${done ? 'Reopen' : 'Complete'} ${esc(t.title)}">${done ? ICON.check : ''}</button>`;
  const job = t.job ? `<span class="mono">${esc(t.job[0])}</span> ${esc(t.job[1])}` : 'Personal';
  return `<div class="trow ${sel ? 'sel' : ''} ${done ? 'closed' : ''}" data-id="${t.id}">${lead}<a class="hmain" href="${U.TN}" style="padding:2px 0"><span class="grow"><span class="ttl">${esc(t.title)}</span><span class="tmeta"><span>${job}</span>${t.prio === 'HIGH' && !done ? '<span class="hi">High</span>' : ''}${done ? `<span>done ${longDay(t.done)}</span>` : `<span class="${di.cls}">${di.label}</span>`}</span></span></a><button class="dots" data-act="trowmenu" data-id="${t.id}" aria-label="More">${ICON.dots}</button></div>`;
}
function renderTasks() {
  const done = state.seg.tasks === 'done'; let h = '';
  if (done) { const d = doneTasks().sort((a, b) => b.done.localeCompare(a.done)); h = d.length ? d.map(t => taskRow(t)).join('') : `<div class="empty"><b>Nothing done yet</b>Tasks you complete show up here.</div>`; }
  else { const o = openTasks(); if (!o.length) h = `<div class="empty"><b>Nothing assigned to you</b>Tasks assigned to you will show up here. <button class="lnk" data-act="primary">+ New task</button></div>`;
    else TGROUPS.forEach((g, gi) => { const rows = o.filter(t => groupOf(t) === gi).sort((a, b) => (a.due || '9').localeCompare(b.due || '9')); if (rows.length) h += `<div class="gl ${h ? '' : 'first'}"><span ${gi === 0 ? 'style="color:var(--t-out)"' : ''}>${g}</span><span class="n">${rows.length}</span></div>` + rows.map(t => taskRow(t)).join(''); }); }
  $('#v-tasks').innerHTML = h;
}

// ---- Notifications
function noteRow(n) {
  const sel = state.selN.has(n.id), unr = !n.read;
  return `<div class="nrow ${unr ? '' : 'read'} ${sel ? 'sel' : ''}"><button class="cb ${sel ? 'on' : ''}" data-act="nselect" data-id="${n.id}" aria-label="Select ${esc(n.title)}"></button><a class="hmain" href="${n.href}" data-act="nopen" data-id="${n.id}" style="padding:4px 0"><span class="grow"><span class="ttl">${esc(n.title)}</span><span class="sub">${dotw(SEV[n.sev], n.type)} <span class="faint">·</span> ${esc(n.desc)}</span></span><span class="when">${n.time}</span></a><button class="dots" data-act="nrowmenu" data-id="${n.id}" aria-label="More">${ICON.dots}</button></div>`;
}
function nVisible() { return state.seg.notes === 'unread' ? unread() : state.notes; }
function renderNotes() {
  const rows = nVisible(); let h = '';
  if (!rows.length) h = `<div class="empty"><b>All caught up</b>${state.seg.notes === 'unread' ? 'No unread notifications. We’ll alert you when something needs your attention.' : 'No notifications.'} ${state.seg.notes === 'unread' && state.notes.length ? '<button class="lnk" data-act="seg" data-k="all">Show all</button>' : ''}</div>`;
  else ['Today','Yesterday','This week','Earlier'].forEach(g => { const r = rows.filter(n => ngroup(n) === g); if (r.length) h += `<div class="gl ${h ? '' : 'first'}">${g}<span class="n">${r.length}</span></div>` + r.map(noteRow).join(''); });
  $('#v-notes').innerHTML = h;
}

// ---- Activity
function renderActivity() {
  const rows = aRows(), page = isPhone() ? rows.slice(0, (state.page + 1) * state.size) : rows.slice(state.page * state.size, (state.page + 1) * state.size);
  let h = '', last = '';
  if (!rows.length) h = `<div class="empty"><b>No activity matches that</b>Loosen a filter or clear them. <button class="lnk" data-act="aclear">Clear filters</button></div>`;
  for (const e of page) { const g = e.day === TODAY ? 'Today · ' + longDay(e.day) : e.day === addD(TODAY, -1) ? 'Yesterday · ' + longDay(e.day) : longDay(e.day); if (g !== last) { h += `<div class="gl ${last ? '' : 'first'}">${g}</div>`; last = g; } h += actRow(e, true); }
  if (isPhone() && rows.length > page.length) h += `<button class="lrow" data-act="more" style="justify-content:center;color:var(--blue);font-weight:600">Show ${Math.min(state.size, rows.length - page.length)} more · ${rows.length - page.length} left</button>`;
  $('#v-activity').innerHTML = h;
}

// ---- bulk bar
function renderBulk() {
  const b = $('#bulk'); let n = 0, html = '';
  if (state.view === 'tasks' && state.selMode && state.selT.size) { n = state.selT.size; html = `<b style="font-size:13px">${n} selected</b><button class="btn btn-secondary btn-sm" data-act="tbulkdone">Done ${n}</button><button class="btn btn-secondary btn-sm" data-act="tbulkdue">Set due…</button><button class="btn btn-icon btn-sm" data-act="tclear" aria-label="Clear selection">✕</button>`; }
  if (state.view === 'notes' && state.selN.size) { n = state.selN.size; const sel = [...state.selN].map(note), nu = sel.filter(x => !x.read).length, nr = sel.length - nu; html = `<b style="font-size:13px">${n} selected</b>${nu ? `<button class="btn btn-secondary btn-sm" data-act="nbulkread">Mark read ${nu}</button>` : ''}${nr ? `<button class="btn btn-secondary btn-sm" data-act="nbulkunread">Mark unread ${nr}</button>` : ''}<button class="btn btn-icon btn-sm" data-act="nclear" aria-label="Clear selection">✕</button>`; }
  b.classList.toggle('open', n > 0); document.body.classList.toggle('hassel', n > 0); if (n) b.innerHTML = html;
}

// ---------- actions
function multiMenu(el, key, title, options) { openMenu(el, title, [...options.map(o => ({ label:o, act:'aftoggle', args:`data-k="${key}" data-v="${esc(o)}"`, on:state.f[key].includes(o) })), '-', { label:'Clear', act:'afclear', args:`data-k="${key}"` }]); }
function rangeSelect(set, order, id, ev) { if (ev && ev.shiftKey && state.lastSel && order.includes(state.lastSel)) { const a = order.indexOf(state.lastSel), b = order.indexOf(id); for (const k of order.slice(Math.min(a, b), Math.max(a, b) + 1)) set.add(k); } else set.has(id) ? set.delete(id) : set.add(id); state.lastSel = id; }
const taskOrder = () => [...$('#v-tasks').querySelectorAll('.trow')].map(r => r.dataset.id);
function rowTarget(g, i) { if (g === 'need') return NEEDS[i]; if (g === 'up') return { ...UPCOMING[i], href:U.OV, list:['Jobs · Booked', U.JOBS + '?seg=booked'] }; const gi = +g.slice(3); const r = ONNOW[gi][2][i]; return { ...r, list:[gi === 2 ? 'Floor · Returning' : gi === 1 ? 'Warehouse · Out today' : 'Jobs · Out', gi ? U.FLOOR : U.JOBS + '?seg=out'] }; }
function act(name, el, ev) {
  el = el || $('#primary');
  const id = el.dataset.id;
  switch (name) {
    case 'close': closeLayer(); break;
    case 'noop': closeLayer(); toast('Not wired in this prototype'); break;
    case 'view': closeLayer(); state.view = el.dataset.v; state.page = 0; state.selMode = false; state.selT.clear(); state.selN.clear(); setHash(); render(); $('.content').scrollTop = 0; break;
    case 'seg': state.seg[state.view] = el.dataset.k; state.page = 0; state.selT.clear(); state.selN.clear(); setHash(); render(); break;
    case 'new': case 'primary': {
      if (state.view === 'home') { toast('Opens the New job wizard'); break; }
      if (state.view === 'tasks') { openDialog(`<div class="hd"><div class="t-overline">My tasks</div><h2 style="font-size:18px">New task</h2></div><div class="bd">${field('Task', '<input id="nt-title" placeholder="What needs doing?" maxlength="200">')}<div class="g2" style="margin-top:12px">${field('Job', `<select id="nt-job"><option value="">Personal</option>${JOBS.map(j => `<option value="${j[0]}">${j[0]} ${j[1]}</option>`).join('')}</select>`)}${field('Due', `<select id="nt-due"><option value="${TODAY}">Today</option><option value="${addD(TODAY,1)}">Tomorrow</option><option value="${addD(TODAY,5)}">This week</option><option value="">No date</option></select>`)}</div></div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="tnewgo">Add task</button></div>`, () => setTimeout(() => $('#nt-title', body).focus(), 30)); break; }
      if (state.view === 'notes') { act('nmarkall', el); break; }
      break; }
    case 'pagemenu': {
      const v = state.view;
      if (v === 'home') openMenu(el, 'Home', [{ label:'Warehouse', href:U.FLOOR, small:'The floor' }, { label:'Add gear', href:U.ASSETS + '?new=1', small:'Assets' }, '-', { label:'Setup panel', act:'setuptoggle', on:setupVisible(), small:`${setupItems().filter(i => i[2]).length} of ${setupItems().length}` }, { label:'Customise…', act:'customise' }]);
      if (v === 'tasks') openMenu(el, 'My tasks', [{ label:state.selMode ? 'Done selecting' : 'Select tasks…', act:'tselmode' }, { label:'Tasks & notes on a job', href:U.TN }, '-', { label:'Print task list', act:'noop' }]);
      if (v === 'notes') openMenu(el, 'Notifications', [{ label:'Mark all read', act:'nmarkall' }, { label:'Show read', act:'seg', args:'data-k="all"', on:state.seg.notes === 'all' }, '-', { label:'Notification settings', href:U.SET, small:'Settings' }]);
      if (v === 'activity') openMenu(el, 'Activity', [{ label:'Export CSV', act:'aexport', small:`${aRows().length} events` }, { label:'Clear filters', act:'aclear' }, '-', { label:'Activity settings', href:U.SET, small:'Settings' }]);
      break; }
    // ---- home
    case 'customise': closeLayer(); openCustomise(); break;
    case 'wtoggle': { const k = el.dataset.k; state.w[k] = !state.w[k]; const sw = el.querySelector('.sw') || el; sw.classList.toggle('on', state.w[k]); render(); break; }
    case 'wreset': { const undo = snapshot(); state.w = Object.fromEntries(WIDGETS.map(w => [w[0], true])); closeLayer(); render(); toast('Home is back to the standard layout', undo); break; }
    case 'wgrid': closeLayer(); toast('Opens the drag-and-resize grid · your saved arrangement is kept'); break;
    case 'setuptoggle': { const undo = snapshot(); state.setup.show = !setupVisible(); closeLayer(); render(); toast(state.setup.show ? 'Setup panel shown' : 'Setup panel hidden', undo); break; }
    case 'setupdismiss': { const undo = snapshot(); state.setup.show = false; render(); toast('Setup panel dismissed · bring it back from the page ⋯', undo); break; }
    case 'needsall': state.needsAll = !state.needsAll; render(); break;
    case 'rmenu': { const r = rowTarget(el.dataset.g, +el.dataset.i); openMenu(el, r.name || r.flag, [{ label:'Open', href:r.href, small:r.where || 'Record' }, { label:r.list[0], href:r.list[1], small:'List' }, '-', { label:'Copy link', act:'copylink' }]); break; }
    case 'copylink': closeLayer(); toast('Link copied'); break;
    // ---- tasks
    case 'ttoggle': { const t = task(id), undo = snapshot(); if (t.done) { delete t.done; toast(`“${esc(t.title)}” reopened`, undo); } else { t.done = TODAY; state.selT.delete(id); toast(`Done · “${esc(t.title)}”`, undo); } render(); break; }
    case 'trowmenu': { const t = task(id); openMenu(el, t.title, [{ label:'Open on the job', href:U.TN, small:t.job ? t.job[0] : 'Personal' }, '-', { label:t.done ? 'Reopen' : 'Mark done', act:'ttoggle', args:`data-id="${id}"` }, ...(t.done ? [] : [{ label:'Set due…', act:'tduemenu', args:`data-id="${id}"` }, { label:'Select tasks…', act:'tselmode' }])]); break; }
    case 'tduemenu': openMenu(el, 'Due', [['Today', TODAY],['Tomorrow', addD(TODAY,1)],['Next Monday', addD(TODAY,7)],['No date','']].map(([l, v]) => ({ label:l, act:'tsetdue', args:`data-id="${id}" data-v="${v}"` }))); break;
    case 'tsetdue': { const t = task(id), undo = snapshot(); t.due = el.dataset.v || null; closeLayer(); render(); toast(`“${esc(t.title)}” · due ${t.due ? longDay(t.due) : 'cleared'}`, undo); break; }
    case 'tselmode': closeLayer(); state.selMode = !state.selMode; state.selT.clear(); render(); break;
    case 'tselect': rangeSelect(state.selT, taskOrder(), id, ev); render(); break;
    case 'tclear': state.selT.clear(); render(); break;
    case 'tbulkdone': { const undo = snapshot(), n = state.selT.size; state.tasks.forEach(t => { if (state.selT.has(t.id)) t.done = TODAY; }); state.selT.clear(); render(); toast(`${n} tasks done`, undo); break; }
    case 'tbulkdue': openMenu(el, `Due for ${state.selT.size}`, [['Today', TODAY],['Tomorrow', addD(TODAY,1)],['Next Monday', addD(TODAY,7)]].map(([l, v]) => ({ label:l, act:'tbulkduego', args:`data-v="${v}"` }))); break;
    case 'tbulkduego': { const undo = snapshot(), n = state.selT.size; state.tasks.forEach(t => { if (state.selT.has(t.id)) t.due = el.dataset.v; }); state.selT.clear(); closeLayer(); render(); toast(`${n} tasks · due ${longDay(el.dataset.v)}`, undo); break; }
    case 'tnewgo': { const title = $('#nt-title', body).value.trim(); if (!title) { $('#nt-title', body).focus(); break; } const j = $('#nt-job', body).value, undo = snapshot(); state.tasks.unshift({ id:'k' + (100 + state.tasks.length), title, job:j ? JOBS.find(x => x[0] === j) : null, due:$('#nt-due', body).value || null }); closeLayer(); state.seg.tasks = 'open'; render(); toast(`Added “${esc(title)}”`, undo); break; }
    // ---- notifications
    case 'nselect': rangeSelect(state.selN, [...$('#v-notes').querySelectorAll('.nrow .cb')].map(b => b.dataset.id), id, ev); render(); break;
    case 'nclear': state.selN.clear(); render(); break;
    case 'nopen': { const n = note(id); if (n && !n.read) { n.read = true; render(); } break; }
    case 'nrowmenu': { const n = note(id); openMenu(el, n.title, [{ label:'Open', href:n.href, small:n.type }, '-', { label:n.read ? 'Mark unread' : 'Mark read', act:'nmark', args:`data-id="${id}"` }, { label:'Notification settings', href:U.SET }]); break; }
    case 'nmark': { const n = note(id), undo = snapshot(); n.read = !n.read; closeLayer(); render(); toast(n.read ? 'Marked read' : 'Marked unread', undo); break; }
    case 'nbulkread': { const undo = snapshot(); let c = 0; state.selN.forEach(i => { const n = note(i); if (!n.read) { n.read = true; c++; } }); state.selN.clear(); render(); toast(`${c} marked read`, undo); break; }
    case 'nbulkunread': { const undo = snapshot(); let c = 0; state.selN.forEach(i => { const n = note(i); if (n.read) { n.read = false; c++; } }); state.selN.clear(); render(); toast(`${c} marked unread`, undo); break; }
    case 'nmarkall': { closeLayer(); const u = unread(); if (!u.length) { toast('Nothing unread'); break; } const undo = snapshot(); u.forEach(n => n.read = true); state.selN.clear(); render(); toast(`${u.length} notifications marked read`, undo); break; }
    // ---- activity
    case 'afmenu': { const k = el.dataset.k; if (k === 'actor') multiMenu(el, 'actor', 'Actor', ['Human','Agent']); if (k === 'action') multiMenu(el, 'action', 'Action', ACTIONS); if (k === 'entity') multiMenu(el, 'entity', 'Entity', ENTITIES); break; }
    case 'aftoggle': { const a = state.f[el.dataset.k], v = el.dataset.v, i = a.indexOf(v); i >= 0 ? a.splice(i, 1) : a.push(v); state.page = 0; state.savedView = null; render(); act('afmenu', el); break; }
    case 'afclear': state.f[el.dataset.k] = []; closeLayer(); state.page = 0; render(); break;
    case 'aclear': state.f = { actor:[], action:[], entity:[] }; state.q = ''; $('#q').value = ''; state.scope = null; state.savedView = null; state.page = 0; closeLayer(); render(); break;
    case 'aviews': openMenu(el, 'Views', [{ sh:'Saved views · each one is a URL you can share' }, ...AVIEWS.map((v, i) => ({ label:v.name, act:'aapplyview', args:`data-i="${i}"`, on:state.savedView === v.name })), ...(state.savedView ? ['-', { label:'Clear view', act:'aclear' }] : [])]); break;
    case 'aapplyview': { const v = AVIEWS[+el.dataset.i]; state.f = { actor:[], action:[], entity:[], ...v.f }; state.savedView = v.name; state.page = 0; closeLayer(); render(); toast(`View “${v.name}” · the filters are in the URL`); break; }
    case 'amenu': { const e = ACT.find(x => x.id === id); openMenu(el, e.ref, [{ label:'Open record', href:e.href, small:e.entity }, { label:`Only ${e.ref}`, act:'ascope', args:`data-ref="${esc(e.ref)}"` }, '-', { label:'Copy link', act:'copylink' }]); break; }
    case 'ascope': state.scope = el.dataset.ref; state.page = 0; closeLayer(); render(); break;
    case 'ascopeclear': state.scope = null; render(); break;
    case 'aexport': closeLayer(); toast(`Activity log exported · ${aRows().length} events as CSV`); break;
    case 'page': state.page = Math.max(0, state.page + +el.dataset.d); render(); $('.content').scrollTop = 0; break;
    case 'more': state.page++; render(); break;
    case 'undo': if (state.undo) { state.undo(); state.undo = null; } $('#toast').classList.remove('open'); break;
    case 'toastclose': $('#toast').classList.remove('open'); break;
  }
}
function openCustomise() {
  const rows = WIDGETS.map(([k, t, d]) => `<div class="wrow"><div class="grow"><div class="ttl">${t}</div><div class="sub">${d}</div></div><button class="sw ${state.w[k] ? 'on' : ''}" data-act="wtoggle" data-k="${k}" role="switch" aria-checked="${!!state.w[k]}" aria-label="Show ${t}"><i></i></button></div>`).join('');
  openDialog(`<div class="hd"><div class="t-overline">Home</div><h2 style="font-size:18px">Customise Home</h2></div><div class="bd"><p class="t-small muted" style="margin:0 0 6px;line-height:1.5">Home opens on the standard layout: setup, four numbers, what needs you, what’s on now. Switch pieces off here. Your saved grid arrangement is kept.</p>${rows}</div><div class="ft"><button class="btn btn-ghost" data-act="wreset">Reset to default</button><button class="btn btn-ghost deskonly" data-act="wgrid">Arrange on a grid…</button><div style="flex:1"></div><button class="btn btn-primary" data-act="close">Done</button></div>`);
}
document.addEventListener('input', ev => { if (ev.target.id === 'q') { state.q = ev.target.value; state.page = 0; state.savedView = null; render(); } });
render();
