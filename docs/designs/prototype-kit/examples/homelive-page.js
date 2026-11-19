// ---------- Home · the live dashboard, calmer (v2). Same widgets, same default order/placement, same grid + Customise; only the skin changes.
const TODAY = '2026-11-09', NOW_MIN = 9 * 60 + 30, ME = 'Jayden Cole';
const A = id => 'https://claude.ai/artifact/' + id;
const U = { OV:A('RatKsWfTmDJLJHmn6mb7Zo'), LOG:A('E36tnBkGL9obdikUQ5mbXf'), FIN:A('7ByfxnbtsgQTJdiwvvo1CY'), TN:A('BrLBitu3c2V4uixLQbXCNE'), JOBS:A('A7SMPtpTr3aedUDEnuSaxd'), ASSETS:A('89PDTuMiovgP9i3h4MJ1Tw'),
  HOME:A('3d6zqfosL5hYRvXLBYLnhR'), FLOOR:A('6xqFcEZZk49w86p5pAsisA'), ASSET:A('Rr5rwirCUMRy8gf5G6Vz7s'), PEOPLE:A('LPdsNGb4CRMfS6qk7j7Fsa'), GEAR:A('D7N5PmXKrkcY2gzZXWeuvc'), FINHUB:A('5VnYTVW2pdA5r1qBRvdrom'),
  SET:A('Q3TeWuQPjzvXbAtmUV8Hg8'), WIZ:A('GgtKxc5WZP33gXihgFTB9B'), SCAN:A('8Q2HVoRhLbSLz1Q9mCtayX'), SCHED:A('49jbSumcZhVdCU9ZA3nqdm'), RECPEOPLE:A('D8UV81TDFpMEeUBxf2apUX'), RECGEAR:A('PDsjUdku2seVZAWfNC6W61') };
const addD = (d, n) => new Date((dayNum(d) + n) * 864e5).toISOString().slice(0, 10);
const left = d => dayNum(d) - dayNum(TODAY);
const first = n => n.split(' ')[0];
const pl = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

// ---------- the widget registry (src/lib/dashboard-widgets.ts): kind → title, description, default width (of 12), min/max width. Heights follow content.
// Two live kinds (finishSetupChecklist + activationChecklist) share ONE slot here: 'setup' — a single dismissable panel while either is incomplete.
const REG = {
  setup:{ t:'Finish setup', d:'Org setup and first-run milestones in one panel. Hides itself once complete or dismissed.', w:12, min:3 },
  myTasks:{ t:'My tasks', d:'Your open tasks across every job.', w:6, min:3 },
  onTheFloorNow:{ t:'On the floor now', d:'Live jobs currently checked out or on site.', w:12, min:4 },
  needsAttention:{ t:'Needs attention', d:'Org-wide risk lines: overdue, maintenance, crew offers, overbookings, quotes.', w:6, min:4 },
  statActiveJobs:{ t:'Active jobs', d:'Count of in-flight jobs.', w:3, min:2, max:4, stat:true },
  statOverdueReturns:{ t:'Overdue returns', d:'Count of jobs past their return date.', w:3, min:2, max:4, stat:true },
  statGearDeployed:{ t:'Gear deployed', d:'Assets checked out right now, with a utilisation meter.', w:3, min:2, max:4, stat:true },
  statCrewBooked:{ t:'Crew booked', d:'Crew currently on the books.', w:3, min:2, max:4, stat:true },
  upcomingProjects:{ t:'Upcoming', d:'Jobs booked ahead, soonest first.', w:12, min:3 },
  recentActivity:{ t:'Recent activity', d:'Scans, tests and maintenance updates across the org.', w:12, min:4 },
};
const ADD_ORDER = ['onTheFloorNow','needsAttention','statActiveJobs','statOverdueReturns','statGearDeployed','statCrewBooked','upcomingProjects','recentActivity','setup','myTasks']; // the live "Add widget" listing order (setup kinds last-but-one: they are the two checklists)
const DEFAULT_ORDER = ['setup','statActiveJobs','statOverdueReturns','statGearDeployed','statCrewBooked','myTasks','needsAttention','onTheFloorNow','upcomingProjects','recentActivity']; // the user's order: quick stats, then tasks (live DEFAULT_DASHBOARD_LAYOUT had the stats 5th)
const defaultW = () => Object.fromEntries(Object.entries(REG).map(([k, r]) => [k, r.w]));
const WIDTHS = [[3,'Quarter'],[4,'Third'],[6,'Half'],[8,'Two thirds'],[12,'Full']];

// ---------- fixture
const STATS = {
  statActiveJobs:{ n:18, l:'Active jobs', s:'in flight', href:U.JOBS + '?seg=active', tip:'Jobs list · ?seg=active' },
  statOverdueReturns:{ n:2, l:'Overdue returns', s:'67 items to chase', href:U.JOBS + '?seg=out&overdue=1', tip:'Jobs list · ?seg=out&overdue=1', bad:true },
  statGearDeployed:{ n:25, of:63, l:'Gear deployed', href:U.ASSETS + '?seg=deployed', tip:'Assets list · ?seg=deployed' },
  statCrewBooked:{ n:28, l:'Crew booked', s:'on the books', href:U.PEOPLE + '#/crew?seg=all', tip:'Crew list · ?seg=all' },
};
const SETUP = [['Set your currency and tax details', false, 'Settings'], ['Add your logo', false, 'Settings › Branding'], ['Add a location', true, 'Locations'], ['Invite your team', true, 'Team']];
const ACTIVATION = [true, true, true, true]; // first-run milestones — all done in this org, so only the setup half shows
const TASKS = [
  { id:'k1', title:'Send revised quote to Qantas', job:['#2350','Qantas awards'], due:'2026-11-07', hi:true },
  { id:'k2', title:'Chase Scene Change on the SH-0012 return', job:['#2341','Hilton gala'], due:'2026-11-07' },
  { id:'k5', title:'Order spare gaffer tape for Launch night', job:['#2340','Launch night'], due:'2026-11-09' },
  { id:'k3', title:'Confirm the stage position with Priya', job:['#2341','Hilton gala'], due:'2026-11-10', hi:true },
  { id:'k4', title:'Book the loading dock with Marco', job:['#2341','Hilton gala'], due:'2026-11-10' },
  { id:'k6', title:'Confirm PO 77812 covers the sub-hire', job:['#2341','Hilton gala'], due:'2026-11-11', hi:true },
  { id:'k7', title:'Renew public liability certificate', job:null, due:'2026-11-14' },
  { id:'k8', title:'Book van service', job:null, due:null },
];
const FLOOR_JOBS = [
  { name:'Sydney Opera House town hall', id:'#2331', client:'Sydney Opera House', items:41, st:'CHECKED_OUT', end:'2026-11-07' },
  { name:'Canva sales kickoff', id:'#2336', client:'Canva', items:26, st:'CHECKED_OUT', end:'2026-11-08' },
  { name:'ICC Sydney trade show', id:'#2339', client:'ICC Sydney', items:58, st:'ON_SITE', end:'2026-11-12' },
  { name:'Atlassian town hall', id:'#2344', client:'Atlassian', items:31, st:'ON_SITE', end:'2026-11-13' },
];
// Needs attention — the live chip tray's eleven kinds, derived counts; the overdue-returns kind is suppressed while its stat tile is on the board (the same fact never twice).
const NEEDS = [
  { k:'blocker', n:1, cls:'err', t:n => `<b>${n}</b> blocker needs you`, d:'#2341 Hilton gala', href:U.OV, tip:'Job · Overview' },
  { k:'overdue', n:2, cls:'err', t:n => `<b>${n}</b> overdue returns`, href:U.JOBS + '?seg=out&overdue=1', tip:'Jobs list · ?seg=out&overdue=1' },
  { k:'subhire', n:1, cls:'err', t:n => `<b>${n}</b> sub-hire overdue`, d:'SH-0012 Scene Change', href:U.PEOPLE + '#/suppliers?seg=overdue', tip:'Suppliers · ?seg=overdue' },
  { k:'invoices', n:2, cls:'err', t:n => `<b>${n}</b> invoices overdue`, d:'$16,975', mono:true, href:U.FINHUB + '?seg=overdue', tip:'Finance · Invoices · ?seg=overdue', isNew:true },
  { k:'hard', n:0, cls:'err', t:n => `<b>${n}</b> hard overbookings`, href:U.GEAR + '?seg=week', tip:'Overbookings' },
  { k:'pencilled', n:1, cls:'warn', t:n => `<b>${n}</b> pencilled collision`, d:'#2350 vs #2341', href:U.GEAR + '?seg=week', tip:'Overbookings · ?seg=week' },
  { k:'sale', n:0, cls:'warn', t:n => `<b>${n}</b> sale stock to procure`, href:U.GEAR + '?seg=week', tip:'Overbookings' },
  { k:'maint', n:2, cls:'warn', t:n => `<b>${n}</b> maintenance due`, href:U.GEAR + '#/maintenance?seg=due', tip:'Maintenance · ?seg=due' },
  { k:'models', n:2, cls:'warn', t:n => `<b>${n}</b> models due for service`, href:U.GEAR + '#/maintenance?seg=models', tip:'Maintenance · due for service' },
  { k:'offers', n:3, cls:'info', t:n => `<b>${n}</b> crew offers pending`, href:U.PEOPLE + '#/crew?seg=unconf', tip:'Crew list · ?seg=unconf' },
  { k:'expiring', n:1, cls:'warn', t:n => `<b>${n}</b> quote expiring`, d:'#2350 Qantas', href:U.FINHUB + '?seg=sent', tip:'Finance · Quotes · ?seg=sent' },
  { k:'quotesout', n:6, cls:'info', t:n => `<b>${n}</b> quotes out`, href:U.FINHUB + '?seg=sent', tip:'Finance · Quotes · ?seg=sent' },
];
const UPCOMING = [
  { name:'Hilton Sydney gala dinner', id:'#2341', client:'Hilton Sydney', a:'2026-11-12', b:'2026-11-14', st:'Confirmed', cls:'info', lock:true },
  { name:'Qantas awards night', id:'#2350', client:'Qantas', a:'2026-11-13', b:'2026-11-14', st:'Quoted', cls:'info' },
  { name:'Corporate AGM', id:'#2338', client:'Atlassian', a:'2026-11-21', b:'2026-11-21', st:'Awaiting payment', cls:'warn', lock:true },
  { name:'UNSW graduation', id:'#2352', client:'UNSW', a:'2026-11-24', b:'2026-11-25', st:'Quoting', cls:'info' },
];
const ACTIVITY = [
  { who:'Sam Okafor', v:'deployed', what:'Martin MAC Aura PXL ×8', prep:'to', obj:'Launch night', ago:'18m ago', href:U.OV },
  { who:'Tom Nguyen', v:'returned', what:'Sennheiser EW-DX SK beltpack SK-0012', prep:'from', obj:'Westpac Christmas party', ago:'41m ago', href:U.OV },
  { who:'Sam Okafor', test:'AURA-04', res:'PASS', ago:'1h ago', href:U.ASSET },
  { who:'Sam Okafor', maint:'Lamp replacement L-0004', st:'in progress', st_c:'warn', sub:'L-0004 MAC Aura PXL', ago:'2h ago', href:U.RECGEAR },
  { who:'Tom Nguyen', v:'deployed', what:'Barco UDX-4K32 V-0011', prep:'to', obj:'Ogilvy product launch', ago:'3h ago', href:U.OV },
  { who:'Sam Okafor', maint:'AURA-06 fan fault', st:'scheduled', st_c:'info', sub:'AURA-06 · awaiting parts, ETA 12 Nov', ago:'4h ago', href:U.RECGEAR },
  { who:'Sam Okafor', test:'SK-0012', res:'PASS', ago:'yesterday', href:U.ASSET },
  { who:'Mel Torres', maint:'Shure ULXD4Q kit K-0042 service', st:'scheduled', st_c:'info', sub:'K-0042 · Shure ULXD4Q kit', ago:'yesterday', href:U.RECGEAR },
  { who:'Tom Nguyen', v:'returned', what:'Cases BATT-01, LX-04', prep:'from', obj:'Red Bull activation', ago:'yesterday', href:U.OV },
];

const state = {
  order:[...DEFAULT_ORDER], w:defaultW(), edit:false, drag:null,
  setupDismissed:false, tasks:TASKS.map(t => ({ ...t })), demo:null, undo:null,
};
const wsnap = () => JSON.stringify({ order:state.order, w:state.w, setupDismissed:state.setupDismissed, tasks:state.tasks });
function snapshot() { const s = wsnap(); return () => { const o = JSON.parse(s); Object.assign(state, o); render(); }; }
const live = msg => { const el = $('#live'); if (el) el.textContent = msg; };

// ---------- derived (nothing here is stored)
const dotw = (cls, txt) => `<span class="dotw ${cls}">${txt}</span>`;
const openTasks = () => state.tasks.filter(t => !t.done).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
const dueInfo = t => { if (!t.due) return { txt:'', cls:'' }; const d = left(t.due); return d < 0 ? { txt:`${-d}d overdue`, cls:'late' } : d === 0 ? { txt:'Today', cls:'today' } : { txt:fmtD(t.due), cls:'mono' }; };
const setupDone = () => SETUP.filter(s => s[1]).length + ACTIVATION.filter(Boolean).length;
const setupTotal = () => SETUP.length + ACTIVATION.length;
const setupVisible = () => !state.setupDismissed && setupDone() < setupTotal();
const isVisible = k => k !== 'setup' || setupVisible();
const needsRows = () => NEEDS.filter(r => r.n > 0 && !(r.k === 'overdue' && state.order.includes('statOverdueReturns')));
const backTxt = j => { const d = left(j.end); return d < 0 ? [`${-d}d overdue`, true] : d === 0 ? ['back today', false] : [`back in ${d}d`, false]; };
const floorJobs = () => FLOOR_JOBS.slice().sort((a, b) => a.end.localeCompare(b.end));
const rowMenuBtn = (g, i) => `<button class="dots" data-act="rmenu" data-g="${g}" data-i="${i}" aria-label="More">${ICON.dots}</button>`;
const skel = n => Array.from({ length:n }, () => '<div class="sk"></div>').join('');
const viewAll = (href, tip) => `<a class="lnk mutedl" href="${href}" title="${tip}">View all ›</a>`;

// ---------- widget bodies
function bodyFor(k) {
  const loading = state.demo === 'loading', clear = state.demo === 'clear';
  if (k === 'setup') {
    const done = setupDone(), tot = setupTotal();
    return { count:`${done} of ${tot}`, right:`<button class="lnk mutedl" data-act="setupdismiss">Dismiss</button>`,
      body:`<div class="prog">${[...SETUP.map(s => s[1]), ...ACTIVATION].sort((a, b) => b - a).map(d => `<i class="${d ? 'd' : ''}"></i>`).join('')}</div><ul class="todo">${SETUP.map(s => `<li class="${s[1] ? 'd' : ''}"><a href="${U.SET}"><span class="dot"></span><span class="grow lbl">${esc(s[0])}</span><span class="where">${s[1] ? 'done' : s[2] + ' ›'}</span></a></li>`).join('')}</ul>` };
  }
  if (k === 'myTasks') {
    const o = clear ? [] : openTasks();
    return { count:loading ? '' : o.length, right:viewAll(U.HOME + '#tasks', 'My tasks · all open tasks'), body:loading ? skel(3) : o.length ? o.slice(0, 6).map(t => taskRow(t)).join('') : `<div class="calmmsg"><b>Nothing assigned to you.</b> Tasks assigned to you show up here.</div>` };
  }
  if (k === 'onTheFloorNow') {
    const js = clear ? [] : floorJobs();
    const rows = js.slice(0, 4).map((j, i) => floorRow(j, i)).join('');
    return { count:loading ? '' : js.length ? `${js.length} live` : '', right:viewAll(U.FLOOR, 'Warehouse · Floor'), body:loading ? skel(2) : js.length ? `<div class="cols2">${rows}</div>` : `<div class="calmmsg"><b>Nothing out right now.</b> The warehouse is full and calm. Enjoy it.</div>` };
  }
  if (k === 'needsAttention') {
    const rs = clear ? [] : needsRows();
    return { count:loading ? '' : rs.length, right:'', body:loading ? skel(2) : rs.length ? `<div class="na ${state.w.needsAttention < 6 ? 'one' : ''}">${rs.map(r => `<a href="${r.href}" title="${esc(r.tip)}"><span class="nt">${dotw(r.cls, r.t(r.n))}</span>${r.d ? `<span class="nd ${r.mono ? 'mono' : ''}">${esc(r.d)}</span>` : ''}</a>`).join('')}</div>` : `<div class="calmmsg"><b>All clear.</b> No overdue returns, no clashes, nothing waiting on you. Frame it.</div>` };
  }
  if (REG[k].stat) {
    const s = STATS[k], v = loading ? null : s.n;
    const sub = k === 'statGearDeployed' ? `${Math.round(s.n / s.of * 100)}% of ${s.of} out` : (k === 'statOverdueReturns' && !s.n ? 'all back' : s.s);
    const util = k === 'statGearDeployed' ? Math.round(s.n / s.of * 100) : 0;
    return { stat:true, body:`<a class="statlink ${s.bad && s.n ? 'bad' : ''}" href="${s.href}" data-tip="${esc(s.tip)}" aria-label="${s.l}: ${s.n}, ${sub}. Opens ${s.tip}"><span class="n">${v == null ? '<span class="faint">—</span>' : s.n}</span><span class="l">${s.l}</span><span class="s">${sub}</span>${k === 'statGearDeployed' ? `<span class="meter" aria-hidden="true"><i class="${util >= 85 ? 'hot' : util >= 60 ? '' : 'cool'}" style="width:${util}%;display:block"></i></span>` : ''}</a>` };
  }
  if (k === 'upcomingProjects') {
    const up = clear ? [] : UPCOMING;
    return { count:loading ? '' : up.length, right:viewAll(U.JOBS + '?seg=booked', 'Jobs list · ?seg=booked'), body:loading ? skel(3) : up.length ? `<div class="cols2">${up.slice(0, 4).map((r, i) => upRow(r, i)).join('')}</div>` : `<div class="calmmsg"><b>Nothing booked ahead.</b> Quote something.</div>` };
  }
  if (k === 'recentActivity') {
    const items = clear ? [] : ACTIVITY;
    const cols = state.w.recentActivity >= 9 ? '' : state.w.recentActivity >= 6 ? 'c2' : 'c1';
    return { count:loading ? '' : items.length ? 'scans, tests, maintenance' : '', right:viewAll(U.HOME + '#activity', 'Activity · the audit log'), body:loading ? skel(3) : items.length ? `<div class="acts ${cols}">${items.map(a => actRow(a)).join('')}</div>` : `<div class="calmmsg"><b>Quiet so far.</b> Scan some gear and it’ll show up here.</div>` };
  }
}
function taskRow(t) {
  const di = dueInfo(t), job = t.job ? `<span class="mono">${esc(t.job[0])}</span> ${esc(t.job[1])}` : 'Personal';
  return `<div class="trow" data-id="${t.id}"><button class="vc" data-act="ttoggle" data-id="${t.id}" aria-label="Complete ${esc(t.title)}"></button><a class="hmain" href="${U.TN}"><span class="grow"><span class="ttl">${esc(t.title)}</span><span class="sub">${job}${t.hi ? ' · ' + dotw('err', 'High') : ''}</span></span>${di.txt ? `<span class="rt ${di.cls}">${di.txt}</span>` : ''}</a>${rowMenuBtn('task', t.id)}</div>`;
}
function floorRow(j, i) {
  const [bt, late] = backTxt(j);
  return `<div class="hrow"><a class="hmain" href="${U.FLOOR}"><span class="grow"><span class="ttl">${esc(j.name)}<span class="id">${j.id}</span></span><span class="sub">${esc(j.client)} · ${pl(j.items, 'item')}</span></span><span class="rtc keep">${dotw(j.st === 'ON_SITE' ? 'ok' : 'info', j.st === 'ON_SITE' ? 'On site' : 'Out')}<span class="rt ${late ? 'late' : ''}">${bt}</span></span></a>${rowMenuBtn('floor', i)}</div>`;
}
function upRow(r, i) {
  return `<div class="hrow"><a class="hmain" href="${U.OV}"><span class="grow"><span class="ttl">${esc(r.name)}<span class="id">${r.id}</span></span><span class="sub">${esc(r.client)}</span></span><span class="rtc keep"><span>${dotw(r.cls, r.st)}${r.lock ? ` <span class="faint" title="Pricing locked">${ICON.lock}</span>` : ''}</span><span class="rt mono">${fmtRange(r.a, r.b)}</span></span></a>${rowMenuBtn('up', i)}</div>`;
}
function actRow(a) {
  let txt, sub;
  if (a.test) { txt = `<b>${a.test}</b> tested — ${dotw(a.res === 'PASS' ? 'ok' : 'err', a.res)}`; sub = `${a.who} · ${a.ago}`; }
  else if (a.maint) { txt = `<b>${esc(a.maint)}</b> — ${dotw(a.st_c, a.st)}`; sub = `${esc(a.sub)} · ${a.who} · ${a.ago}`; }
  else { txt = `<b>${esc(a.what)}</b> ${a.v} ${a.prep} <b>${esc(a.obj)}</b>`; sub = `${a.who} · ${a.ago}`; }
  return `<a class="arow" href="${a.href}"><span class="at">${txt}</span><span class="sub">${sub}</span></a>`;
}

// ---------- the board
function visibleOrder() { return state.order.filter(isVisible); }
function renderBoard() {
  const b = $('#hb'); b.classList.toggle('edit', state.edit);
  const ids = visibleOrder();
  if (!ids.length) { b.innerHTML = `<div class="empty" style="grid-column:1/-1"><b>Home is empty</b>Every widget is hidden. <button class="lnk" data-act="customise">Customise…</button></div>`; return; }
  b.innerHTML = ids.map((k, idx) => {
    const r = REG[k], c = bodyFor(k), w = state.w[k];
    const head = state.edit
      ? `<div class="wh" data-wid="${k}" tabindex="0" draggable="true" role="group" aria-label="${r.t}, position ${idx + 1} of ${ids.length}. Use arrow keys to move it." ><span class="grip" aria-hidden="true">⠿</span><span class="t">${r.t}</span><span class="sright"><span class="rt mono" style="font-size:11.5px">${w} / 12</span><button class="dots" data-act="wmenu" data-k="${k}" aria-label="${r.t} options">${ICON.dots}</button></span></div>`
      : c.stat ? '' : `<div class="wh"><span>${r.t}</span>${c.count !== '' && c.count != null ? `<span class="n">${c.count}</span>` : ''}<span class="sright">${c.right || ''}</span></div>`;
    return `<section class="w ${c.stat ? 'stat' : ''}" data-wid="${k}" style="--w:${w}">${head}<div class="wb">${c.body}</div><span class="rsz" data-rsz="${k}"></span></section>`;
  }).join('');
}
function renderChrome() {
  const first_ = first(ME);
  $('#h1').textContent = 'Good morning, ' + first_;
  $('#hsub').textContent = '9 November 2026 · Two Toned Productions';
  $('#phonesub').textContent = `Good morning, ${first_} · 9 Nov`;
  const pr = $('#primary'), pp = $('#phoneprimary');
  for (const x of [pr, pp]) { x.textContent = state.edit && x === pr ? 'Done' : '+ New job'; x.setAttribute('href', state.edit && x === pr ? '#' : U.WIZ); }
  const c = $('#cust'); c.style.display = state.edit ? '' : 'none';
  const avail = ADD_ORDER.filter(k => !state.order.includes(k) && (k !== 'setup' || setupVisible()));
  c.innerHTML = state.edit ? `<span class="t">Customising Home</span><span class="hint">Drag a title, or use its ⋯ (Move, Width, Hide). Changes save as you go.</span><button class="fw" data-act="addw" ${avail.length ? '' : 'disabled'}>Add widget ▾</button><button class="fw" data-act="wreset">Reset layout</button>` : '';
}
function render() { renderChrome(); renderBoard(); }

// ---------- shell wiring (nav none: sidebar + bottom nav are wired here; Home is active)
(function wire() {
  const items = [['Home','#home','blue',true],['Jobs',U.JOBS,'blue'],['Finance',U.FINHUB,'green'],['Schedule',U.SCHED,'green'],['Crew',U.PEOPLE,'purple'],['Assets',U.ASSETS,'amber'],['Warehouse',U.FLOOR,'teal'],['Test & tag',U.GEAR,'teal'],['Maintenance',U.GEAR,'amber']];
  $('#sidenav').innerHTML = items.map(([n, h, c, on]) => `<a href="${h}" ${on ? 'data-act="noop" aria-current="page"' : ''} class="${on ? 'on' : ''}"><span class="patch" style="background:var(--${c}-soft, var(--paper-2))"></span>${n}</a>`).join('');
  const bn = $('.bottomnav');
  bn.querySelector('a[href="#home"]').classList.add('on');
  bn.querySelector('a[href="#jobs"]').href = U.JOBS; bn.querySelector('a[href="#warehouse"]').href = U.FLOOR; bn.querySelector('a[href="#assets"]').href = U.ASSETS; bn.querySelector('a[href="#scan"]').href = U.SCAN;
  const s = $('.sidebar .foot a'); if (s) s.href = U.SET;
  if (location.hash === '#loading') state.demo = 'loading'; if (location.hash === '#clear') state.demo = 'clear';
})();

// ---------- layout moves (every one snapshots → toast with Undo)
function moveTo(k, toIdx, quiet) {
  const vis = visibleOrder(), from = vis.indexOf(k); if (from < 0) return; toIdx = Math.max(0, Math.min(vis.length - 1, toIdx)); if (toIdx === from) return;
  const undo = snapshot(), target = vis[toIdx];
  state.order.splice(state.order.indexOf(k), 1); state.order.splice(state.order.indexOf(target) + (toIdx > from ? 1 : 0), 0, k);
  render(); live(`${REG[k].t} moved to position ${toIdx + 1} of ${vis.length}`);
  toast(`Moved ${REG[k].t} to ${toIdx + 1} of ${vis.length}`, undo);
}
function setWidth(k, w, quiet) {
  const r = REG[k]; w = Math.max(r.min, Math.min(r.max || 12, w)); if (w === state.w[k]) return;
  const undo = snapshot(); state.w[k] = w; render(); if (!quiet) toast(`${r.t} · ${w} of 12 wide`, undo); return undo;
}
function wmenu(el) {
  const k = el.dataset.k, r = REG[k], vis = visibleOrder(), i = vis.indexOf(k), cur = state.w[k];
  openMenu(el, r.t, [
    ...(i > 0 ? [{ label:'Move up', act:'wmove', args:`data-k="${k}" data-d="-1"` }] : []), ...(i < vis.length - 1 ? [{ label:'Move down', act:'wmove', args:`data-k="${k}" data-d="1"` }] : []),
    '-', { sh:'Width' }, ...WIDTHS.filter(([n]) => n >= r.min && n <= (r.max || 12)).map(([n, l]) => ({ label:`${l} · ${n} of 12`, act:'wwidth', args:`data-k="${k}" data-v="${n}"`, on:n === cur })),
    '-', { label:'Hide from Home', act:'whide', args:`data-k="${k}"` },
  ]);
}

// ---------- actions
function rowTarget(g, i) {
  if (g === 'task') { const t = state.tasks.find(x => x.id === i); return { title:t.title, items:[{ label:'Open on the job', href:U.TN, small:t.job ? t.job[0] : 'Personal' }, '-', { label:'Due today', act:'tdue', args:`data-id="${i}" data-v="${TODAY}"` }, { label:'Due tomorrow', act:'tdue', args:`data-id="${i}" data-v="${addD(TODAY, 1)}"` }, { label:'Mark done', act:'ttoggle', args:`data-id="${i}"` }] }; }
  if (g === 'floor') { const j = floorJobs()[+i]; return { title:j.name, items:[{ label:'Open on the floor', href:U.FLOOR, small:j.id }, { label:'Open job', href:U.OV, small:'Overview' }, '-', { label:'Copy link', act:'copylink' }] }; }
  const r = UPCOMING[+i]; return { title:r.name, items:[{ label:'Open job', href:U.OV, small:r.id }, { label:'Jobs · Booked', href:U.JOBS + '?seg=booked', small:'List' }, '-', { label:'Copy link', act:'copylink' }] };
}
function act(name, el, ev) {
  el = el || $('#primary');
  const id = el.dataset.id;
  switch (name) {
    case 'close': closeLayer(); break;
    case 'noop': closeLayer(); break;
    case 'new': break;
    case 'primary': if (state.edit) act('customdone', el); break;
    case 'pagemenu': {
      const items = [{ label:'Warehouse', href:U.FLOOR, small:'The floor' }, { label:'Add gear', href:U.ASSETS + '?new=1', small:'Assets' }, '-'];
      if (isPhone()) items.push({ sh:'Customise Home is on desktop · your arrangement shows here in the same order' });
      else items.push({ label:'Customise…', act:'customise', small:state.edit ? 'on' : '' });
      items.push('-', { sh:'Prototype' }, { label:'Preview loading state', act:'demo', args:'data-v="loading"' }, { label:state.demo === 'clear' ? 'Back to the busy day' : 'Preview an all-clear day', act:'demo', args:`data-v="${state.demo === 'clear' ? '' : 'clear'}"` });
      openMenu(el, 'Home', items); break; }
    case 'demo': { closeLayer(); state.demo = el.dataset.v || null; render(); if (state.demo === 'loading') setTimeout(() => { state.demo = null; render(); }, 1800); break; }
    case 'customise': closeLayer(); if (isPhone()) { toast('Customise Home is on desktop'); break; } state.edit = true; render(); toast('Customising Home · drag a title, or use its ⋯'); setTimeout(() => { const h = $('.wh[data-wid]'); if (h) h.focus(); }, 30); break;
    case 'customdone': { state.edit = false; render(); toast('Home saved · this is how it opens'); break; }
    case 'wmenu': wmenu(el); break;
    case 'wmove': { closeLayer(); const k = el.dataset.k, vis = visibleOrder(); moveTo(k, vis.indexOf(k) + +el.dataset.d); setTimeout(() => { const h = $(`.wh[data-wid="${k}"]`); if (h) h.focus(); }, 20); break; }
    case 'wwidth': closeLayer(); setWidth(el.dataset.k, +el.dataset.v); break;
    case 'whide': { closeLayer(); const k = el.dataset.k, undo = snapshot(); state.order = state.order.filter(x => x !== k); render(); toast(`${REG[k].t} hidden · Add widget brings it back`, undo); break; }
    case 'addw': { const avail = ADD_ORDER.filter(k => !state.order.includes(k) && (k !== 'setup' || setupVisible())); openMenu(el, 'Add a widget', avail.length ? avail.flatMap(k => [{ label:REG[k].t, act:'wadd', args:`data-k="${k}"` }, { sh:REG[k].d }]) : [{ sh:'Every widget is already on your board.' }]); break; }
    case 'wadd': { closeLayer(); const k = el.dataset.k, undo = snapshot(); state.order.push(k); state.w[k] = REG[k].w; render(); toast(`${REG[k].t} added at the bottom`, undo); setTimeout(() => { const s = $(`.w[data-wid="${k}"]`); if (s) s.scrollIntoView({ block:'nearest' }); }, 20); break; }
    case 'wreset': { const undo = snapshot(); state.order = [...DEFAULT_ORDER]; state.w = defaultW(); render(); toast('Home is back to the standard layout', undo); break; }
    case 'setupdismiss': { const undo = snapshot(); state.setupDismissed = true; render(); toast('Setup panel dismissed for the whole team', undo); break; }
    case 'ttoggle': { closeLayer(); const t = state.tasks.find(x => x.id === id), undo = snapshot(); t.done = TODAY; render(); toast(`Done · “${esc(t.title)}”`, undo); break; }
    case 'tdue': { closeLayer(); const t = state.tasks.find(x => x.id === id), undo = snapshot(); t.due = el.dataset.v; render(); toast(`“${esc(t.title)}” · due ${el.dataset.v === TODAY ? 'today' : 'tomorrow'}`, undo); break; }
    case 'rmenu': { const r = rowTarget(el.dataset.g, el.dataset.i); openMenu(el, r.title, r.items); break; }
    case 'copylink': closeLayer(); toast('Link copied'); break;
    case 'undo': if (state.undo) { state.undo(); state.undo = null; } $('#toast').classList.remove('open'); break;
    case 'toastclose': $('#toast').classList.remove('open'); break;
  }
}

// ---------- drag to reorder (title is the handle) + keyboard (arrow keys on a focused title) + corner resize (snaps to columns)
document.addEventListener('dragstart', ev => { const h = ev.target.closest && ev.target.closest('.wh[data-wid]'); if (!h || !state.edit) return; state.drag = h.dataset.wid; ev.dataTransfer.effectAllowed = 'move'; try { ev.dataTransfer.setData('text/plain', state.drag); } catch (e) {} setTimeout(() => { const s = $(`.w[data-wid="${state.drag}"]`); if (s) s.classList.add('drag'); }, 0); });
document.addEventListener('dragover', ev => { if (!state.drag) return; const s = ev.target.closest && ev.target.closest('.w'); if (!s || s.dataset.wid === state.drag) return; ev.preventDefault(); document.querySelectorAll('.w.dropt').forEach(x => x.classList.remove('dropt')); s.classList.add('dropt'); });
document.addEventListener('drop', ev => { if (!state.drag) return; const s = ev.target.closest && ev.target.closest('.w'); ev.preventDefault(); if (s && s.dataset.wid !== state.drag) { const k = state.drag; state.drag = null; moveTo(k, visibleOrder().indexOf(s.dataset.wid)); } });
document.addEventListener('dragend', () => { state.drag = null; document.querySelectorAll('.w.drag,.w.dropt').forEach(x => x.classList.remove('drag', 'dropt')); });
document.addEventListener('keydown', ev => {
  const h = ev.target.closest && ev.target.closest('.wh[data-wid]'); if (!h || !state.edit) return;
  const k = h.dataset.wid, vis = visibleOrder(), i = vis.indexOf(k);
  const d = { ArrowUp:-1, ArrowLeft:-1, ArrowDown:1, ArrowRight:1 }[ev.key];
  if (d) { ev.preventDefault(); moveTo(k, i + d); setTimeout(() => { const n = $(`.wh[data-wid="${k}"]`); if (n) n.focus(); }, 20); }
  else if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); wmenu($('.dots', h)); }
  else if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); act('whide', { dataset:{ k } }); }
});
document.addEventListener('pointerdown', ev => {
  const g = ev.target.closest && ev.target.closest('[data-rsz]'); if (!g || !state.edit) return; ev.preventDefault(); ev.stopPropagation();
  const k = g.dataset.rsz, sec = g.closest('.w'), board = $('#hb'), colW = (board.getBoundingClientRect().width + 32) / 12, startX = ev.clientX, w0 = state.w[k], r = REG[k], undo = snapshot();
  g.setPointerCapture(ev.pointerId);
  const mv = e => { const w = Math.max(r.min, Math.min(r.max || 12, w0 + Math.round((e.clientX - startX) / colW))); if (w !== state.w[k]) { state.w[k] = w; sec.style.setProperty('--w', w); const t = sec.querySelector('.wh .rt'); if (t) t.textContent = w + ' / 12'; } };
  const up = () => { g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); if (state.w[k] !== w0) { render(); toast(`${r.t} · ${state.w[k]} of 12 wide`, undo); } };
  g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up);
});
window.addEventListener('resize', () => { if (isPhone() && state.edit) { state.edit = false; render(); } });
render();
