// ---------- Wizard · data (New job in three steps, job edit sheet, Start from template)
const TODAY = '2026-11-09';
const URLS = { jobs:'https://claude.ai/artifact/A7SMPtpTr3aedUDEnuSaxd', ov:'https://claude.ai/artifact/RatKsWfTmDJLJHmn6mb7Zo', eq:'https://claude.ai/artifact/BdwR4bNbiNMLSvfRAByEwC', assets:'https://claude.ai/artifact/89PDTuMiovgP9i3h4MJ1Tw' };
const rnd = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(7);
const addD = (d, n) => new Date((dayNum(d) + n) * 864e5).toISOString().slice(0, 10);
// fixture calendar: 11 Nov 2026 is a Tuesday (BRIEF), one day earlier than the real calendar
const dow = d => (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7;
const wdOf = d => WD[dow(d)];
const longD = d => `${wdOf(d)} ${+d.slice(8, 10)}`;
const longRange = (a, b) => !a ? '' : !b ? `${longD(a)} ${MON[+a.slice(5, 7) - 1]}` : a === b ? `${longD(a)} ${MON[+a.slice(5, 7) - 1]}` : a.slice(0, 7) === b.slice(0, 7) ? `${longD(a)} – ${longD(b)} ${MON[+b.slice(5, 7) - 1]}` : `${longD(a)} ${MON[+a.slice(5, 7) - 1]} – ${longD(b)} ${MON[+b.slice(5, 7) - 1]}`;
const rng = (a, b) => !a ? '—' : !b || a === b ? fmtD(a) : fmtRange(a, b);
const nDays = (a, b) => a && b ? dayNum(b) - dayNum(a) + 1 : 0;
const STATUS = { ENQUIRY:['Enquiry', ''], QUOTING:['Quoting', 'info'], QUOTED:['Quoted', 'info'], AWAITING_PAYMENT:['Awaiting payment', 'warn'], CONFIRMED:['Confirmed', 'info'], PREPPING:['Prepping', 'warn'] };
const HARD = ['AWAITING_PAYMENT', 'CONFIRMED', 'PREPPING', 'CHECKED_OUT', 'ON_SITE', 'RETURNED', 'COMPLETED', 'INVOICED'];
const TYPES = [['DRY_HIRE', 'Dry hire'], ['WET_HIRE', 'Wet hire'], ['INSTALLATION', 'Installation'], ['TOUR', 'Tour'], ['CORPORATE', 'Corporate'], ['THEATRE', 'Theatre'], ['FESTIVAL', 'Festival'], ['CONFERENCE', 'Conference'], ['OTHER', 'Other']];
const typeName = v => (TYPES.find(t => t[0] === v) || [0, 'Other'])[1];
const PEOPLE = [{ id:'u1', name:'Jayden Cole', role:'Ops · PM' }, { id:'u2', name:'Mel Torres', role:'Accounts' }, { id:'u3', name:'Sam Okafor', role:'Warehouse' }, { id:'u4', name:'Tom Nguyen', role:'Ops' }];
const TAGS = ['gala', 'corporate', 'awards', 'conference', 'launch', 'festival', 'install', 'repeat client', 'vip'];
const LOCS = [{ id:'l1', name:'Hilton Sydney · Grand Ballroom', addr:'488 George St' }, { id:'l2', name:'ICC Sydney · Pyrmont Theatre', addr:'14 Darling Dr' }, { id:'l3', name:'Qantas Campus · Mascot', addr:'10 Bourke Rd' }, { id:'l4', name:'Bondi Pavilion', addr:'Queen Elizabeth Dr' }, { id:'l5', name:'Customs House', addr:'31 Alfred St' }];
const CAT_ORDER = ['Lighting', 'Audio', 'Video', 'Rigging', 'Consumables', 'Other'];
const CATALOG = [
  { id:'m1', kind:'gear', name:'Martin MAC Aura XB', cat:'Lighting', unit:90, stock:16, acc:1 },
  { id:'m2', kind:'gear', name:'Martin MAC Aura PXL', cat:'Lighting', unit:85, stock:24, acc:1 },
  { id:'m10', kind:'gear', name:'Chauvet Rogue R2X wash', cat:'Lighting', unit:60, stock:8 },
  { id:'m3', kind:'gear', name:'d&b Y8', cat:'Audio', unit:120, stock:16, acc:2 },
  { id:'m4', kind:'gear', name:'Sennheiser EW-DX EM4 receiver', cat:'Audio', unit:95, stock:6, acc:2 },
  { id:'m5', kind:'gear', name:'Sennheiser EW-DX SK beltpack', cat:'Audio', unit:25, stock:12, acc:4 },
  { id:'m6', kind:'gear', name:'Shure ULXD handheld', cat:'Audio', unit:55, stock:8 },
  { id:'m7', kind:'gear', name:'Shure SM58', cat:'Audio', unit:12, stock:24 },
  { id:'k1', kind:'kit', name:'Shure ULXD4Q kit', cat:'Audio', unit:320, stock:3, tag:'K-0042', members:['ULXD4Q receiver ×1', 'Handheld ×4'] },
  { id:'k2', kind:'kit', name:'EW-DX presenter kit', cat:'Audio', unit:210, stock:2, members:['EM2 receiver ×1', 'SK beltpack ×2', 'ME2 lavalier ×2'] },
  { id:'m8', kind:'gear', name:'Barco UDX-4K32 projector', cat:'Video', unit:1900, stock:2, acc:1 },
  { id:'m9', kind:'gear', name:'Panasonic PT-RZ120 projector', cat:'Video', unit:650, stock:3 },
  { id:'k3', kind:'kit', name:'Lectern AV kit', cat:'Video', unit:180, stock:2, members:['Lectern ×1', 'MX418 ×1', 'Lectern light ×1'] },
  { id:'m11', kind:'gear', name:'4 m truss section', cat:'Rigging', unit:18, stock:30 },
  { id:'s1', kind:'sale', name:'Gaffer tape, black', cat:'Consumables', unit:14, stock:40 },
  { id:'s2', kind:'sale', name:'AA batteries ×24', cat:'Consumables', unit:22, stock:30 },
  { id:'g1', kind:'group', name:'Presenter audio', cat:'Audio', unit:260, members:['EM4 ×1', 'SK beltpack ×2', 'ME2 lavalier ×2'] },
  { id:'g2', kind:'group', name:'Drum mic pack', cat:'Audio', unit:140, members:['Beta 52A ×1', 'SM57 ×3', 'e604 ×3', 'KSM137 ×2'] },
];
const cat1 = id => CATALOG.find(c => c.id === id);
const ASSETS = { 'AURA-01':'m1', 'L-0001':'m2', 'SK-0012':'m5', 'A-0301':'m4', 'K-0042':'k1', 'V-0011':'m8' };
// Other jobs' gear, the one availability source: window (first/last day) + model -> qty. #2341's own entry is live data too.
const BOOK = [
  { num:'#2341', name:'Hilton Sydney gala dinner', s:'2026-11-11', e:'2026-11-14', lines:{ m2:8, m1:6, m3:6, m4:4, m5:8, k1:1, m8:1 } },
  { num:'#2350', name:'Qantas awards night', s:'2026-11-12', e:'2026-11-15', lines:{ m2:6, m4:2, m6:2, m3:2, k2:1 } },
  { num:'#2340', name:'Launch night', s:'2026-11-13', e:'2026-11-13', lines:{ m2:6, m3:4, m8:1, m10:4 } },
  { num:'#2338', name:'Corporate AGM', s:'2026-11-21', e:'2026-11-21', lines:{ m8:2, m4:4, m5:6, k1:1, m7:4 } },
];
const USED_CODES = ['2338', '2340', '2341', '2350', '2351'];
const blankFields = () => ({ name:'', code:'', clientId:'', contactId:'', type:'OTHER', pms:[], tags:[], desc:'', locId:'', siteName:'', sitePhone:'', siteEmail:'', start:'', end:'', gStart:'', gStartT:'', gEnd:'', gEndT:'', discount:'', discountTouched:false });
const state = {
  view:'wizard', step:0, nextNum:2352, startsAs:'', stash:null, created:null, jobRef:'2341', cb:null, add:{ q:'', kind:'all', sel:0, last:null }, sel:new Set(), tsel:new Set(), lastSel:null, undo:null,
  draft:{ saved:false }, errs:{ w:{}, e:{} }, ui:{ w:{ cal:false, win:false, more:false, month:'', newc:null }, e:{ cal:false, win:false, more:true, month:'', newc:null } }, e:null, lastPhone:null,
  clients:[
    { id:'c1', name:'Hilton Sydney', disc:5, contacts:[{ id:'ct1', name:'Priya Shah', primary:true, role:'Events' }, { id:'ct2', name:'Marco Bell', role:'Venue ops' }] },
    { id:'c2', name:'Qantas Events', disc:0, contacts:[{ id:'ct3', name:'Dana Whitfield', primary:true, role:'Events' }] },
    { id:'c3', name:'Meridian Group', disc:10, contacts:[{ id:'ct4', name:'Helen Park', primary:true, role:'Comms' }, { id:'ct5', name:'Ian Cho', role:'Finance' }] },
    { id:'c4', name:'Harbourlight Events', disc:0, contacts:[{ id:'ct6', name:'Noor Haddad', primary:true, role:'Producer' }] },
    { id:'c5', name:'Studio Eleven', disc:0, contacts:[{ id:'ct7', name:'Ben Archer', primary:true, role:'Producer' }] },
    { id:'c6', name:'Coastline Festival Co', disc:0, contacts:[{ id:'ct8', name:'Tess Murray', primary:true, role:'Production' }] },
  ],
  jobs:{ '2341': Object.assign(blankFields(), { num:'2341', name:'Hilton Sydney gala dinner', code:'2341', clientId:'c1', contactId:'ct1', status:'CONFIRMED', locked:true, type:'CORPORATE', pms:['u1'], tags:['gala', 'corporate'], desc:'400-pax gala dinner, Grand Ballroom. LED wall, stage, PA and lighting; venue supplies 3-phase.', locId:'l1', siteName:'Priya Shah', sitePhone:'0412 555 019', siteEmail:'priya.shah@hilton.com', start:'2026-11-12', end:'2026-11-14', gStart:'2026-11-11', gStartT:'06:30', gEnd:'2026-11-14', gEndT:'23:00', discount:'5', discountTouched:true, total:23880 }) },
  templates:[],
};
function mkTpl(id, name, type, tags, desc, lines, used, extra) { return Object.assign(blankFields(), { id, name, type, tags, desc, lines, used, tpl:true, code:'' }, extra || {}); }
state.templates = [
  mkTpl('t1', 'Gala dinner — ballroom', 'CORPORATE', ['gala'], 'Ballroom gala: LED wall, stage, PA and lighting.', [['m2', 8], ['m1', 6], ['m3', 6], ['m5', 8], ['m4', 4], ['m8', 1]], 6),
  mkTpl('t2', 'Corporate AGM — one room', 'CONFERENCE', ['conference'], 'Single room, lectern, projection and radio mics.', [['m8', 1], ['k3', 1], ['m4', 2], ['m5', 4], ['m7', 4]], 9, { clientId:'c3', discount:'10' }),
  mkTpl('t3', 'Product launch night', 'CORPORATE', ['launch'], 'Stage wash, reveal moment, two screens.', [['m2', 6], ['m10', 4], ['m3', 4], ['m8', 1], ['g1', 1]], 4),
  mkTpl('t4', 'Awards night — stage and FOH', 'THEATRE', ['awards'], 'Full stage and front-of-house rig.', [['m2', 10], ['m1', 4], ['m3', 8], ['m6', 4], ['m4', 4], ['m8', 2]], 3),
  mkTpl('t5', 'Dry hire — small audio', 'DRY_HIRE', [], 'Speakers, mics and cables.', [['m3', 2], ['m7', 4], ['s1', 2]], 14),
  mkTpl('t6', 'Festival stage — mid', 'FESTIVAL', ['festival'], 'Mid-size outdoor stage, truss and lighting.', [['m11', 12], ['m10', 8], ['m2', 8], ['m3', 8]], 2),
];
function freshW(tpl) { return Object.assign(blankFields(), { code: tpl ? '' : String(state.nextNum), tpl:!!tpl, tplId:'', lines:[] }); }
state.w = freshW(false);
let lineSeq = 100;
const F = c => c === 'w' ? state.w : state.e.f;
const UI = c => state.ui[c];
const client = id => state.clients.find(x => x.id === id);
const person = id => PEOPLE.find(p => p.id === id);
const loc = id => LOCS.find(x => x.id === id);
const tplById = id => state.templates.find(t => t.id === id);
// ---------- derived
const windowOf = f => { const s = f.gStart || f.start, e = f.gEnd || f.end; return s && e ? [s, e] : null; };
const stockOf = mid => { const c = cat1(mid); return c ? c.stock : 0; };
function bookedMax(mid, win, excl) { let m = 0; for (let d = dayNum(win[0]); d <= dayNum(win[1]); d++) { let t = 0; for (const b of BOOK) { if (b.num === excl) continue; if (dayNum(b.s) <= d && d <= dayNum(b.e)) t += b.lines[mid] || 0; } m = Math.max(m, t); } return m; }
const freeOf = (mid, win, excl) => Math.max(0, stockOf(mid) - bookedMax(mid, win, excl));
const jobsHolding = (mid, win, excl) => BOOK.filter(b => b.num !== excl && b.lines[mid] && dayNum(b.s) <= dayNum(win[1]) && dayNum(b.e) >= dayNum(win[0]));
const overlapJobs = (win, excl) => BOOK.filter(b => b.num !== excl && dayNum(b.s) <= dayNum(win[1]) && dayNum(b.e) >= dayNum(win[0]));
const stockLine = l => (l.kind === 'gear' || l.kind === 'kit') && !l.sub;
function needByModel(lines) { const m = {}; for (const l of lines) if (stockLine(l) && l.mid) m[l.mid] = (m[l.mid] || 0) + l.qty; return m; }
function shortOf(l, f) { const win = windowOf(f); if (!win || !stockLine(l) || !l.mid) return 0; const need = needByModel(f.lines)[l.mid] || 0; return Math.max(0, need - freeOf(l.mid, win)); }
function gateRows(linesMap, win, excl) { const out = []; for (const [mid, need] of Object.entries(linesMap)) { const free = freeOf(mid, win, excl); if (need > free) out.push({ name:cat1(mid).name, qty:need - free, jobs:jobsHolding(mid, win, excl).map(b => b.num) }); } return out.sort((a, b) => b.qty - a.qty); }
const days = () => nDays(state.w.start, state.w.end);
const lineGross = l => l.unit == null ? null : (l.per === 'DAY' ? l.unit * l.qty * (days() || 1) : l.unit * l.qty);
const lineTotal = l => { const g = lineGross(l); return g == null ? null : Math.max(0, g - (l.disc || 0)); };
const hireTotal = () => state.w.lines.reduce((s, l) => s + (lineTotal(l) || 0), 0);
const discAmt = () => { const p = parseFloat(state.w.discount); return isNaN(p) ? 0 : Math.round(hireTotal() * p / 100); };
const ordered = () => [...state.w.lines].sort((a, b) => CAT_ORDER.indexOf(a.cat) - CAT_ORDER.indexOf(b.cat) || a.seq - b.seq);
const isTpl = c => c === 'w' ? state.w.tpl : state.e.tpl;
const stepNames = () => state.w.tpl ? ['Basics', 'What', 'Review'] : ['Who and when', 'What', 'Review'];
const startsAs = () => state.w.startsAs || (state.w.lines.length ? 'QUOTING' : 'ENQUIRY');
function validate(f, o) {
  const e = {}; if (!f.name.trim()) e.name = 'Name is required'; else if (f.name.length > 200) e.name = 'Keep it under 200 characters';
  if (!o.tpl) { const c = String(f.code || '').trim(); if (!c) e.code = 'Project code is required.'; else if (c.length > 50) e.code = 'Keep it under 50 characters'; else if (USED_CODES.includes(c) && c !== o.self) e.code = `Project code “${c}” is already in use.`; }
  if (f.siteEmail && !/^\S+@\S+\.\S+$/.test(f.siteEmail)) e.siteEmail = 'Invalid email';
  if (f.discount !== '' && (isNaN(+f.discount) || +f.discount < 0 || +f.discount > 100)) e.discount = 'Between 0 and 100';
  if (f.start && f.end && f.end < f.start) e.dates = 'The end is before the start';
  return e;
}
function snapshot() {
  const s = structuredClone({ w:state.w, draft:state.draft, clients:state.clients, templates:state.templates, jobs:state.jobs, book:BOOK, view:state.view, step:state.step, created:state.created, jobRef:state.jobRef, nextNum:state.nextNum, stash:state.stash, startsAs:state.startsAs, sel:[...state.sel] });
  return () => { const c = structuredClone(s); Object.assign(state, { w:c.w, draft:c.draft, clients:c.clients, templates:c.templates, jobs:c.jobs, view:c.view, step:c.step, created:c.created, jobRef:c.jobRef, nextNum:c.nextNum, stash:c.stash, startsAs:c.startsAs, sel:new Set(c.sel) }); BOOK.length = 0; BOOK.push(...c.book); closeLayer(); renderAll(); };
}
const fld = (label, inner, err, hint, cls) => `<div class="field ${err ? 'err' : ''} ${cls || ''}"><label>${label}</label>${inner}${err ? `<span class="ferr">${esc(err)}</span>` : hint ? `<span class="fhint">${hint}</span>` : ''}</div>`;
const statusWord = s => `<span class="dotw ${STATUS[s][1]}">${STATUS[s][0]}</span>`;
// ---------- shell wiring
function renderNav() {
  if ($('#sidenav').children.length) return;
  const items = [['Dashboard', 'blue', 'https://claude.ai/artifact/3d6zqfosL5hYRvXLBYLnhR'], ['Jobs', 'blue', URLS.jobs], ['Finance', 'green', 'https://claude.ai/artifact/5VnYTVW2pdA5r1qBRvdrom'], ['Schedule', 'green', 'https://claude.ai/artifact/AKkgWzJ2gVR3dJTWnMB2Ui'], ['Crew', 'purple', 'https://claude.ai/artifact/LPdsNGb4CRMfS6qk7j7Fsa'], ['Assets', 'amber', URLS.assets], ['Warehouse', 'teal', 'https://claude.ai/artifact/6xqFcEZZk49w86p5pAsisA'], ['Test & tag', 'teal', '#'], ['Maintenance', 'amber', '#']];
  $('#sidenav').innerHTML = items.map(([n, c, h]) => `<a href="${h}" class="${n === 'Jobs' ? 'on' : ''}"><span class="patch" style="background:var(--${c}-soft, var(--paper-2))"></span>${n}</a>`).join('');
}
$('.sidebar .foot a').setAttribute('href', 'https://claude.ai/artifact/Q3TeWuQPjzvXbAtmUV8Hg8');
{ const bn = document.querySelectorAll('.bottomnav a'); const hs = ['https://claude.ai/artifact/3d6zqfosL5hYRvXLBYLnhR', URLS.jobs, 'https://claude.ai/artifact/8Q2HVoRhLbSLz1Q9mCtayX', 'https://claude.ai/artifact/6xqFcEZZk49w86p5pAsisA', URLS.assets]; bn.forEach((a, i) => a.setAttribute('href', hs[i])); }
$('.crumb').innerHTML = `<a href="${URLS.jobs}" style="color:var(--muted)">Jobs</a><span>›</span><b id="crumbb">New job</b>`;
$('.phonehead').innerHTML = `<a class="btn btn-icon btn-lg" href="${URLS.jobs}" aria-label="Back to Jobs" style="color:var(--ink)">‹</a><div style="flex:1;min-width:0"><div class="ell" id="phonettl" style="font-family:var(--display);font-weight:800;font-size:16px">New job</div><div class="ell t-micro muted" id="phonesub"></div></div><button class="btn btn-icon btn-lg" data-act="pagemenu" aria-label="Page actions">⋯</button>`;
// ---------- render
function render() { if (isPhone() === state.lastPhone) return; renderAll(); }
function renderAll() {
  state.lastPhone = isPhone(); renderNav();
  document.body.classList.toggle('hassel', state.view === 'wizard' && state.step === 1 && state.sel.size > 0);
  if (state.view === 'job') { renderStub(); return; }
  renderHead(); renderSteps(); renderBody(); renderFoot(); renderPhoneAct(); renderBulk();
}
function subHtml() {
  const w = state.w;
  if (w.tpl) return `<span>Templates keep lines, groups and notes · dates are optional</span>`;
  return state.draft.saved ? `<span class="saved">${ICON.check}<span>Draft <span class="mono">#${state.nextNum}</span> saved</span></span>` : `<span>Draft <span class="mono">#${state.nextNum}</span> starts when you name the job</span>`;
}
function setSub() {
  const w = state.w; const el = $('#wzsub'); if (el) el.innerHTML = subHtml();
  const ph = $('#phonesub'); if (ph) ph.textContent = (w.tpl ? 'New template' : state.draft.saved ? `Draft #${state.nextNum} saved` : `Draft #${state.nextNum}`) + ' · ' + stepNames()[state.step];
  $('#phonettl').textContent = w.tpl ? 'New template' : 'New job'; $('#crumbb').textContent = w.tpl ? 'New template' : 'New job';
}
function renderHead() {
  const w = state.w, last = state.step === 2;
  const left = state.step === 0 ? (w.tpl ? `<button class="lnk muted" data-act="tplcancel">Cancel</button>` : `<button class="lnk muted" data-act="enquiry">Create as enquiry</button>`) : `<button class="lnk muted" data-act="back">Back</button>`;
  $('#wzhead').innerHTML = `<div class="wzhead"><div class="grow"><h1 class="h1">${w.tpl ? 'New template' : 'New job'}</h1><div class="wzsub" id="wzsub"></div></div><div class="wzact deskonly">${left}<button class="btn btn-primary" data-act="${last ? 'create' : 'next'}">${last ? (w.tpl ? 'Create template' : 'Create job') : 'Next'}</button><button class="btn btn-icon" data-act="pagemenu" aria-label="More">⋯</button></div></div>`;
  setSub();
}
function renderSteps() {
  $('#steps').style.display = '';
  $('#steps').innerHTML = stepNames().map((s, i) => `<button class="${state.step === i ? 'on' : ''}" data-act="step" data-s="${i}">${s}${i === 1 ? ` <span class="n">${state.w.lines.length}</span>` : ''}</button>`).join('');
}
function renderBody() {
  const el = $('#wzbody');
  if (state.step === 0) el.innerHTML = stepOne();
  else if (state.step === 1) { el.innerHTML = stepTwo(); renderResults(); renderLines(); }
  else el.innerHTML = '<input id="q" aria-hidden="true" tabindex="-1" style="position:absolute;opacity:0;width:0;height:0;pointer-events:none">' + stepThree();
}
function renderFoot() {
  const f = $('#wzfoot'); if (state.view !== 'wizard' || state.step !== 1) { f.style.display = 'none'; return; }
  f.style.display = ''; const d = days(), n = state.w.lines.length;
  f.innerHTML = `<span>${n ? `${n} line${n > 1 ? 's' : ''} · ` : ''}Totals · <b class="mono" style="color:var(--ink)">${money(hireTotal())}</b> · ${d ? `priced for ${d} day${d > 1 ? 's' : ''}` : 'priced for 1 day · dates not set'}</span>`;
}
function renderPhoneAct() {
  const w = state.w, last = state.step === 2;
  const left = state.step === 0 ? (w.tpl ? `<button class="btn btn-secondary" data-act="tplcancel">Cancel</button>` : `<button class="btn btn-secondary" data-act="enquiry">Create as enquiry</button>`) : `<button class="btn btn-secondary" data-act="back">Back</button>`;
  $('#phoneact').innerHTML = `${left}<button class="btn btn-primary" data-act="${last ? 'create' : 'next'}">${last ? (w.tpl ? 'Create template' : 'Create job') : 'Next'}</button>`;
}
// ---------- step one · fields (shared with the edit sheet)
function fieldsHtml(c) {
  const X = F(c), U = UI(c), E = state.errs[c] || {}, tpl = isTpl(c), edit = c === 'e';
  const idq = c === 'w' ? 'id="q"' : '';
  const head = (t) => edit ? `<div class="fsec">${t}</div>` : '';
  const lockedDisc = edit && state.e.locked;
  const cl = client(X.clientId);
  const discHint = lockedDisc ? `<span class="lockhint">${ICON.lock} Pricing locked · unlock from the strip above the tabs on the Overview</span>` : (!X.discountTouched && cl && cl.disc ? `From ${esc(cl.name)}’s default — edit anytime` : '');
  const nameRow = `<div class="${tpl ? '' : 'row2 nr'}">${fld('Name', `<input class="bigin" ${idq} data-f="name" data-c="${c}" value="${esc(X.name)}" maxlength="200" placeholder="e.g. Summer Festival 2026" autocomplete="off">`, E.name)}${tpl ? '' : fld('Project code', `<input class="mono" data-f="code" data-c="${c}" value="${esc(X.code)}" maxlength="50" placeholder="Auto: ${state.nextNum}" autocomplete="off">`, E.code)}</div>`;
  const clientRow = `<div class="row2">${fld('Client', comboHtml(c, 'client', cl ? cl.name : '', 'Select client…') + newClientHtml(c))}${X.clientId ? fld('Contact', comboHtml(c, 'contact', (cl && cl.contacts.find(k => k.id === X.contactId) || {}).name || '', cl && cl.contacts.find(k => k.primary) ? 'Primary contact (default)' : 'Select contact…'), '', 'Who this job’s documents address') : '<div></div>'}</div>`;
  const when = `<div id="when-${c}">${whenHtml(c)}</div>`;
  const tr = `<div class="row2">${fld('Type', `<select data-f="type" data-c="${c}">${TYPES.map(t => `<option value="${t[0]}" ${t[0] === X.type ? 'selected' : ''}>${t[1]}</option>`).join('')}</select>`)}${fld('Project manager(s)', comboHtml(c, 'pms', '', 'Add manager…') + `<div class="chips">${X.pms.map(id => `<span class="chipw">${esc(person(id).name)}<button data-act="cbrm" data-c="${c}" data-key="pms" data-v="${id}" aria-label="Remove ${esc(person(id).name)}">✕</button></span>`).join('')}</div>`)}</div>`;
  const tags = fld('Tags', comboHtml(c, 'tags', '', 'Add tags…') + `<div class="chips">${X.tags.map(t => `<span class="chipw">${esc(t)}<button data-act="cbrm" data-c="${c}" data-key="tags" data-v="${esc(t)}" aria-label="Remove ${esc(t)}">✕</button></span>`).join('')}</div>`);
  const desc = fld('Description', `<textarea data-f="desc" data-c="${c}" rows="2" maxlength="2000" placeholder="Brief description of the job">${esc(X.desc)}</textarea>`);
  const where = `<div class="fgrid">${fld('Location', comboHtml(c, 'loc', (loc(X.locId) || {}).name || '', 'Select location…') + newLocHtml(c))}<div class="row3">${fld('Site contact', `<input data-f="siteName" data-c="${c}" value="${esc(X.siteName)}" placeholder="Contact person on site">`)}${fld('Phone', `<input data-f="sitePhone" data-c="${c}" value="${esc(X.sitePhone)}" placeholder="+61 400 000 000">`)}${fld('Email', `<input type="email" data-f="siteEmail" data-c="${c}" value="${esc(X.siteEmail)}" placeholder="contact@example.com">`, E.siteEmail)}</div></div>`;
  const money_ = tpl ? '' : fld('Discount (%)', `<input class="mono" inputmode="decimal" data-f="discount" data-c="${c}" value="${esc(X.discount)}" placeholder="0" style="max-width:140px" ${lockedDisc ? 'disabled' : ''}>`, E.discount, discHint);
  if (edit) return `<div class="fgrid">${nameRow}${clientRow}${when}${tr}${tags}${desc}</div>${head('Where')}${where}${tpl ? '' : head('Money') + money_}<div class="fhint" style="padding-top:18px">Status moves from the stepper on the Overview, so every move runs the same checks. It is not a field here.</div><div class="fhint" style="padding-top:6px;color:var(--faint)">Prototype: move #2341 to 19 – 21 Nov to see the date-move heads-up. Moving the rental dates carries the project window with them.</div>`;
  const more = `<button class="lnk muted" data-act="more" data-c="${c}" style="margin-top:2px">${U.more ? 'Fewer details ▴' : 'Site, description and discount ▾'}</button>`;
  return `<div class="fgrid">${nameRow}${clientRow}${when}${tr}${tags}${more}${U.more ? `${desc}${where}${money_}` : ''}</div>`;
}
function comboHtml(c, key, value, ph) { return `<div class="combo" data-c="${c}" data-key="${key}"><input class="cbin" data-cb="${key}" data-c="${c}" value="${esc(value)}" placeholder="${ph}" autocomplete="off" aria-label="${esc(ph.replace('…', ''))}"><div class="cbl" hidden></div></div>`; }
function newClientHtml(c) {
  const n = UI(c).newc; if (!n || n.kind !== 'client') return '';
  return `<div class="newc"><div class="t-overline">New client</div><div class="row2"><div class="field"><label>Name</label><input data-nc="name" data-c="${c}" value="${esc(n.name)}" placeholder="e.g. Acme Productions" autocomplete="off"></div><div class="field"><label>Type</label><select data-nc="type" data-c="${c}">${[['COMPANY', 'Company'], ['INDIVIDUAL', 'Individual'], ['VENUE', 'Venue'], ['PRODUCTION_COMPANY', 'Production company']].map(t => `<option value="${t[0]}" ${t[0] === n.type ? 'selected' : ''}>${t[1]}</option>`).join('')}</select></div></div><div class="row2"><div class="field"><label>Contact name</label><input data-nc="cn" data-c="${c}" value="${esc(n.cn)}" placeholder="Primary contact person"></div><div class="field"><label>Contact email</label><input type="email" data-nc="ce" data-c="${c}" value="${esc(n.ce)}" placeholder="email@example.com"></div></div><div class="acts"><button class="btn btn-secondary btn-sm" data-act="ncgo" data-c="${c}">Create client</button><button class="lnk muted" data-act="nccancel" data-c="${c}">Cancel</button></div></div>`;
}
function newLocHtml(c) {
  const n = UI(c).newc; if (!n || n.kind !== 'loc') return '';
  return `<div class="newc"><div class="t-overline">New location</div><div class="field"><label>Name</label><input data-nc="name" data-c="${c}" value="${esc(n.name)}" placeholder="e.g. Town Hall · Main Hall" autocomplete="off"></div><div class="acts"><button class="btn btn-secondary btn-sm" data-act="nlgo" data-c="${c}">Create location</button><button class="lnk muted" data-act="nccancel" data-c="${c}">Cancel</button></div></div>`;
}
function whenHtml(c) {
  const X = F(c), U = UI(c), E = state.errs[c] || {}, d = nDays(X.start, X.end);
  const val = X.start ? `${longRange(X.start, X.end)}${d ? ` · ${d} day${d > 1 ? 's' : ''}` : ' · pick an end date'}` : '';
  const btn = `<button class="datein ${U.cal ? 'open' : ''}" data-act="caltoggle" data-c="${c}" aria-label="Rental dates">${val ? `<span>${val}</span>` : `<span class="ph">${isTpl(c) ? 'Optional for templates' : 'Pick the rental dates'}</span>`}<span class="faint">▾</span></button>`;
  const win = windowOf(X);
  const pw = X.gStart || X.gEnd;
  const winLine = U.win ? `<div class="win"><div class="wr"><label>Starts</label><input type="date" data-f="gStart" data-c="${c}" value="${X.gStart}" aria-label="Project window starts"><input type="time" data-f="gStartT" data-c="${c}" value="${X.gStartT}" aria-label="Project starts time"></div><div class="wr"><label>Ends</label><input type="date" data-f="gEnd" data-c="${c}" value="${X.gEnd}" aria-label="Project window ends"><input type="time" data-f="gEndT" data-c="${c}" value="${X.gEndT}" aria-label="Project ends time"></div><div class="fhint">Blank means the same as rental${X.start ? ` (${rng(X.start, X.end)})` : ''}. <button class="lnk muted" data-act="winreset" data-c="${c}">Reset to rental</button></div>${winSoft(X)}</div>` : '';
  const winWord = `<div style="padding-top:6px;font-size:12.5px;color:var(--muted)">Project window · ${pw ? `<span class="mono" style="color:var(--ink-2)">${rng(X.gStart || X.start, X.gEnd || X.end)}${X.gStartT ? ' ' + X.gStartT : ''}</span>` : 'same as rental'} · <button class="lnk" data-act="wintoggle" data-c="${c}">${U.win ? 'Done' : 'Change'}</button></div>`;
  return `${fld(isTpl(c) ? 'Dates' : 'Rental dates', btn, E.dates)}${U.cal ? calHtml(c) : ''}${winWord}${winLine}${conseqHtml(c)}`;
}
function winSoft(X) { if (X.gStart && X.start && X.gStart > X.start) return `<div class="softw">The project window starts after the rental window — usually load-in is on or before the rental start.</div>`; if (X.gEnd && X.end && X.gEnd < X.end) return `<div class="softw">The project window ends before the rental window — usually load-out is on or after the rental end.</div>`; return ''; }
function conseqHtml(c) {
  const X = F(c); if (c === 'e') return `<div class="conseq"><div class="l">Saving checks the new dates against gear on other jobs.</div></div>`;
  const win = windowOf(X); if (!win) return `<div class="conseq"><div class="l"><span class="dotw">Availability not checked</span><span>pick dates</span></div></div>`;
  const ov = overlapJobs(win), lines = X.lines;
  const l1 = ov.length ? `<div class="l"><span class="dotw info">${ov.length} other job${ov.length > 1 ? 's' : ''} in these dates</span><span>${ov.map(b => `<span class="mono">${b.num}</span> ${esc(b.name)}`).join(' · ')}</span></div>` : `<div class="l"><span class="dotw ok">No other jobs in these dates</span></div>`;
  let l2; if (!lines.length) l2 = `<div class="l"><span class="dotw">Gear not checked yet</span><span>add some on the next step</span></div>`; else { const sh = lines.filter(l => shortOf(l, X) > 0).length; l2 = sh ? `<div class="l"><span class="dotw err">${sh} line${sh > 1 ? 's' : ''} short</span><span>sub-hire from the next step</span></div>` : `<div class="l"><span class="dotw ok">All ${lines.length} lines free</span></div>`; }
  return `<div class="conseq">${l1}${l2}</div>`;
}
function calHtml(c) {
  const X = F(c), U = UI(c), ph = isPhone(); const base = U.month || (X.start || TODAY).slice(0, 7);
  const nextYm = ym => { let [y, m] = ym.split('-').map(Number); m++; if (m > 12) { m = 1; y++; } return `${y}-${String(m).padStart(2, '0')}`; };
  const prevYm = ym => { let [y, m] = ym.split('-').map(Number); m--; if (m < 1) { m = 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; };
  const months = ph ? [base] : [base, nextYm(base)];
  const excl = c === 'e' ? '#' + state.e.ref : null;
  const mh = (ym, i) => { const [y, m] = ym.split('-').map(Number); return `<div class="mh">${i === 0 ? `<button data-act="calnav" data-c="${c}" data-d="-1" aria-label="Previous month">‹</button>` : '<span></span>'}<span>${MON[m - 1]} ${y}</span>${i === months.length - 1 ? `<button data-act="calnav" data-c="${c}" data-d="1" aria-label="Next month">›</button>` : '<span></span>'}</div>`; };
  const grid = ym => { const [y, m] = ym.split('-').map(Number); const off = (dow(`${ym}-01`) + 6) % 7, n = new Date(Date.UTC(y, m, 0)).getUTCDate(); let h = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(w => `<span class="wd">${w}</span>`).join(''); for (let i = 0; i < off; i++) h += '<span></span>'; for (let d = 1; d <= n; d++) { const ds = `${ym}-${String(d).padStart(2, '0')}`, cls = ['cald']; if (ds === X.start) cls.push('st'); if (ds === X.end) cls.push('en'); if (X.start && X.end && ds > X.start && ds < X.end) cls.push('in'); if (ds === TODAY) cls.push('today'); const bk = BOOK.filter(b => b.num !== excl && ds >= b.s && ds <= b.e); h += `<button class="${cls.join(' ')}" data-act="calday" data-c="${c}" data-d="${ds}" ${bk.length ? `title="${esc(bk.map(b => b.num + ' ' + b.name).join(' · '))}"` : ''}>${d}${bk.length ? '<i class="bk"></i>' : ''}</button>`; } return `<div class="calg">${h}</div>`; };
  const sum = X.start ? (X.end ? `${longRange(X.start, X.end)} · ${nDays(X.start, X.end)} day${nDays(X.start, X.end) > 1 ? 's' : ''}` : `${longD(X.start)} · pick the last day`) : 'Pick the first day';
  return `<div class="cal"><div class="calmonths">${months.map((ym, i) => `<div class="calm">${mh(ym, i)}${grid(ym)}</div>`).join('')}</div><div class="calfoot">${['1 day', '2 days', 'Weekend', '1 week'].map((p, i) => `<button class="lnk" data-act="calpreset" data-c="${c}" data-p="${i}">${p}</button>`).join('')}${X.start ? `<button class="lnk muted" data-act="calclear" data-c="${c}">Clear</button>` : ''}<span class="sum">${sum}</span></div><div class="fhint" style="padding-bottom:6px">A dot under a day means another job has gear out.</div></div>`;
}
function stepOne() {
  const w = state.w;
  const tools = w.tpl ? '' : `<div class="tools"><button class="fw ${w.tplId ? 'on' : ''}" data-act="tplmenu">${w.tplId ? 'Template: ' + esc(tplById(w.tplId).name) : 'Start from template ▾'}</button></div>`;
  return `${tools}${fieldsHtml('w')}<div class="hintl">${w.tpl ? 'Next: the lines the template carries.' : 'Next adds gear. You can skip it — Equipment is where gear lives afterwards.'}</div>`;
}
// ---------- combobox (client, contact, location, managers, tags)
function cbOptions(c, key, q) {
  const X = F(c), ql = q.toLowerCase(); let o = [];
  if (key === 'client') o = state.clients.map(x => ({ v:x.id, l:x.name, d:(x.contacts[0] || {}).name || '' }));
  if (key === 'contact') o = ((client(X.clientId) || { contacts:[] }).contacts).map(x => ({ v:x.id, l:x.name, d:x.primary ? 'Primary' : x.role }));
  if (key === 'loc') o = LOCS.map(x => ({ v:x.id, l:x.name, d:x.addr }));
  if (key === 'pms') o = PEOPLE.filter(p => !X.pms.includes(p.id)).map(p => ({ v:p.id, l:p.name, d:p.role }));
  if (key === 'tags') o = TAGS.filter(t => !X.tags.includes(t)).map(t => ({ v:t, l:t, d:'' }));
  o = o.filter(x => !ql || x.l.toLowerCase().includes(ql)).slice(0, 8);
  if (key === 'client') o.push({ v:'__new', l:'New client…', d:q.trim() ? `“${q.trim()}”` : '', nw:true });
  if (key === 'loc') o.push({ v:'__new', l:'New location…', d:q.trim() ? `“${q.trim()}”` : '', nw:true });
  if (key === 'tags' && ql && !TAGS.includes(ql) && !X.tags.includes(ql)) o.push({ v:q.trim(), l:`Add “${q.trim()}”`, d:'', nw:true });
  return o;
}
function cbRender() {
  const s = state.cb; if (!s) return; const box = $(`.combo[data-c="${s.c}"][data-key="${s.key}"] .cbl`); if (!box) return;
  const o = cbOptions(s.c, s.key, s.q); s.n = o.length; s.sel = Math.min(s.sel, Math.max(0, o.length - 1)); box.hidden = false;
  box.innerHTML = o.length ? o.map((x, i) => `<button class="cbopt ${x.nw ? 'new' : ''} ${i === s.sel ? 'on' : ''}" data-act="cbpick" data-c="${s.c}" data-key="${s.key}" data-v="${esc(x.v)}">${esc(x.l)}${x.d ? `<small>${esc(x.d)}</small>` : ''}</button>`).join('') : `<div class="cbnone">${s.key === 'contact' ? 'This client has no contacts yet.' : 'Nothing matches.'}</div>`;
}
function closeCombo() {
  const s = state.cb; if (!s) return; const box = $(`.combo[data-c="${s.c}"][data-key="${s.key}"]`);
  if (box) { $('.cbl', box).hidden = true; if (!['pms', 'tags'].includes(s.key)) { const X = F(s.c); const lab = s.key === 'client' ? (client(X.clientId) || {}).name : s.key === 'loc' ? (loc(X.locId) || {}).name : ((client(X.clientId) || { contacts:[] }).contacts.find(k => k.id === X.contactId) || {}).name; $('.cbin', box).value = lab || ''; } else $('.cbin', box).value = ''; }
  state.cb = null;
}
function cbPick(c, key, v) {
  const X = F(c), U = UI(c);
  if (v === '__new') { const q = state.cb ? state.cb.q : ''; closeCombo(); U.newc = key === 'loc' ? { kind:'loc', name:q } : { kind:'client', name:q, type:'COMPANY', cn:'', ce:'' }; refreshForm(c); const i = $(`[data-nc="name"][data-c="${c}"]`); if (i) i.focus(); return; }
  if (key === 'client') { if (X.clientId !== v) { X.clientId = v; X.contactId = ''; const cl = client(v); if (!X.discountTouched && cl) X.discount = cl.disc ? String(cl.disc) : ''; } }
  else if (key === 'contact') X.contactId = v;
  else if (key === 'loc') X.locId = v;
  else if (key === 'pms') { if (!X.pms.includes(v)) X.pms.push(v); }
  else if (key === 'tags') { if (v && !X.tags.includes(v)) X.tags.push(v); }
  closeCombo(); touch(c); refreshForm(c);
  if (['pms', 'tags'].includes(key)) { const i = $(`.cbin[data-cb="${key}"][data-c="${c}"]`); if (i) i.focus(); }
}
function refreshForm(c) {
  if (c === 'w') { renderBody(); setSub(); } else if (state.e) { const b = $('#sheetbody'); if (b) { const st = b.scrollTop; b.innerHTML = fieldsHtml('e'); b.scrollTop = st; sheetFoot(); } }
}
function refreshWhen(c) { const el = $(`#when-${c}`); if (el) el.innerHTML = whenHtml(c); if (c === 'e') sheetFoot(); }
function touch(c) { if (c === 'w') { const w = state.w; if (!w.tpl && w.name.trim() && !state.draft.saved) state.draft.saved = true; setSub(); } else sheetFoot(); }
// ---------- step two · What (the Equipment tab's search-first add, embedded)
function stepTwo() {
  const w = state.w, win = windowOf(w);
  const meta = win ? `<span>Availability for <b class="mono" style="color:var(--ink-2)">${rng(win[0], win[1])}</b></span><span>·</span><span>pencilled, not held, until the job is Confirmed</span>` : `<span class="dotw">Availability not checked</span><span>dates aren’t set</span><button class="lnk" data-act="step" data-s="0">Set dates</button>`;
  return `<div class="addwrap"><div class="addin"><span class="muted">⌕</span><input id="q" value="${esc(state.add.q)}" placeholder="Model, kit, asset tag, supplier item…" aria-label="Search the catalog" autocomplete="off"><span class="kbd">↵</span></div><div class="addkinds" id="addkinds"></div><div class="reslist" id="reslist"></div><div class="addmeta">${meta}</div></div><div id="lineshost"></div>`;
}
const KINDS = [['all', 'All'], ['gear', 'Gear'], ['kit', 'Kits'], ['subhire', 'Sub-hire'], ['custom', 'Custom'], ['sale', 'Sale'], ['group', 'Groups']];
function addResults() {
  const a = state.add, q = a.q.trim(), ql = q.toLowerCase(), out = [];
  const tag = Object.keys(ASSETS).find(t => t.toLowerCase() === ql);
  if (tag && (a.kind === 'all' || a.kind === 'gear' || a.kind === 'kit')) { const c = cat1(ASSETS[tag]); out.push({ kind:'asset', tag, c }); }
  for (const c of CATALOG) {
    if (a.kind === 'subhire') { if (c.kind !== 'gear') continue; } else if (a.kind !== 'all' && a.kind !== 'custom' && c.kind !== a.kind) continue; else if (a.kind === 'custom') continue;
    if (ql && !c.name.toLowerCase().includes(ql)) continue;
    out.push(a.kind === 'subhire' ? { kind:'subhire', c } : { kind:c.kind, c });
  }
  if (ql && a.kind !== 'sale' && a.kind !== 'group') { out.push({ kind:'custom', name:q }); if (a.kind === 'all' || a.kind === 'subhire') out.push({ kind:'subhire', name:q, c:null }); }
  if (!ql && (a.kind === 'all' || a.kind === 'custom')) out.push({ kind:'custom', name:'' });
  return out.slice(0, ql ? 8 : 6);
}
function resMeta(r) {
  const w = state.w, win = windowOf(w); const c = r.c; const here = c && w.lines.find(l => l.mid === c.id && !l.sub);
  if (r.kind === 'custom') return r.name ? 'add it as a custom line · price it after' : 'type a description for a custom line';
  if (r.kind === 'subhire') return c ? `${win ? freeOf(c.id, win) : '—'} of ours free · hire the rest in from a supplier` : 'from a supplier · source it on the Equipment tab';
  if (r.kind === 'sale') return `sells for ${money(c.unit)} each · ${c.stock} on hand`;
  if (r.kind === 'group') return `group of ${c.members.length} · ${c.members.join(', ')} · ${money(c.unit)}/d`;
  const av = !win ? '<span>availability not checked</span>' : (() => { const f = freeOf(c.id, win), s = c.stock; return f === 0 ? '<span style="color:var(--t-out)">none free</span>' : f <= Math.max(2, s * .2) ? `<span style="color:var(--warn)">only ${f} of ${s} free</span>` : `${f} of ${s} free`; })();
  const base = `${av} · ${money(c.unit)}/d${c.acc ? ` · ${c.acc} accessor${c.acc > 1 ? 'ies' : 'y'}` : ''}`;
  if (r.kind === 'asset') return `<span class="mono">${r.tag}</span> · one unit, serial assigned · ${base}`;
  if (r.kind === 'kit') return `${c.tag ? `<span class="mono">${c.tag}</span> · ` : ''}${base} · ${c.members.join(', ')}`;
  return base + (here ? ` · <span style="color:var(--info)">already ×${here.qty} here → ×${here.qty + 1}</span>` : '');
}
function renderResults() {
  const a = state.add, res = addResults(); a.sel = Math.min(a.sel, Math.max(0, res.length - 1)); a.res = res;
  $('#addkinds').innerHTML = KINDS.map(([k, n]) => `<button class="${a.kind === k ? 'on' : ''}" data-act="addkind" data-k="${k}">${n}</button>`).join('');
  const tg = { gear:'', asset:'asset', kit:'Kit', sale:'Sale', group:'Group', subhire:'Sub-hire', custom:'Custom' };
  $('#reslist').innerHTML = res.length ? res.map((r, i) => `<button class="res2 ${i === a.sel ? 'on' : ''}" data-act="addpick" data-i="${i}"><div style="flex:1;min-width:0"><div class="ell"><span class="tt">${r.kind === 'custom' ? (r.name ? `Add “${esc(r.name)}” as a custom line` : 'Custom line…') : r.kind === 'subhire' && !r.c ? `Sub-hire “${esc(r.name)}”` : esc(r.c.name)}</span>${tg[r.kind] ? `<span class="tg">${tg[r.kind]}</span>` : ''}</div><div class="mm ell">${resMeta(r)}</div></div>${i === a.sel ? '<span class="kbd">↵</span>' : ''}</button>`).join('') : `<div class="cbnone">Nothing matches “${esc(a.q)}”.</div>`;
  $('#reslist').insertAdjacentHTML('beforeend', `<div class="hintl">Enter adds one · Enter again with nothing typed opens it · <span class="kbd">Esc</span> closes</div>`);
}
function addPick(i) {
  const a = state.add, r = (a.res || [])[i]; if (!r) return;
  if (r.kind === 'custom' && !r.name) { toast('Type a description first'); $('#q').focus(); return; }
  const undo = snapshot(); const w = state.w; let l, msg;
  const c = r.c;
  if (r.kind === 'custom') { l = { id:'L' + lineSeq++, seq:lineSeq, kind:'custom', mid:null, name:r.name, cat:'Other', qty:1, unit:null, per:'FLAT', disc:0, serials:[], note:'' }; msg = `Added “${esc(l.name)}” · unpriced until you price it`; }
  else if (r.kind === 'subhire') { l = { id:'L' + lineSeq++, seq:lineSeq, kind:'gear', sub:true, mid:c ? c.id : null, name:c ? c.name : r.name, cat:c ? c.cat : 'Other', qty:1, unit:c ? c.unit : null, per:'DAY', disc:0, serials:[], note:'' }; msg = `Sub-hire ${esc(l.name)} added · pick the supplier on Equipment`; }
  else {
    const ex = w.lines.find(x => x.mid === c.id && !x.sub);
    if (ex) { ex.qty += 1; if (r.kind === 'asset') ex.serials.push(r.tag); msg = `${esc(c.name)} is now ×${ex.qty}${shortOf(ex, w) ? ` · <b style="color:var(--t-out)">short ${shortOf(ex, w)}</b>` : ''}`; a.last = ex.id; a.q = ''; a.sel = 0; afterAdd(msg, undo); return; }
    l = { id:'L' + lineSeq++, seq:lineSeq, kind:c.kind, mid:c.id, name:c.name, cat:c.cat, qty:1, unit:c.unit, per:c.kind === 'sale' ? 'FLAT' : 'DAY', disc:0, serials:r.kind === 'asset' ? [r.tag] : [], note:'', members:c.members };
    msg = `Added ${esc(c.name)} to ${c.cat}`; w.lines.push(l); const s = shortOf(l, w); if (s) msg += ` · <b style="color:var(--t-out)">short ${s}</b>`;
    a.last = l.id; a.q = ''; a.sel = 0; afterAdd(msg, undo); return;
  }
  w.lines.push(l); a.last = l.id; a.q = ''; a.sel = 0; afterAdd(msg, undo);
}
function afterAdd(msg, undo) { touch('w'); toast(msg, undo); renderSteps(); renderResults(); renderLines(); const q = $('#q'); if (q) { q.value = ''; q.focus(); } }
function lineSub(l) {
  if (l.sub) return `Sub-hire · supplier on Equipment`;
  if (l.kind === 'kit') return `Kit${l.serials.length ? ' · ' + l.serials.join(', ') : ''} · ${(l.members || []).join(', ')}`;
  if (l.kind === 'group') return `Group of ${(l.members || []).length} · bundle`;
  if (l.kind === 'sale') return 'Sale · new stock';
  if (l.kind === 'custom') return 'Custom line';
  const c = cat1(l.mid); return `${l.cat}${l.serials.length ? ' · <span class="mono">' + l.serials.join(', ') + '</span>' : ''}${c && c.acc ? ` · ${c.acc} accessories` : ''}`;
}
function lineFlag(l) { const s = shortOf(l, state.w); if (l.sub) return '<span class="dotw info">sub-hire</span>'; if (s) return `<span class="dotw err">short ${s}</span>`; if (l.unit == null) return '<span class="dotw warn">unpriced</span>'; return ''; }
function renderLines() {
  const w = state.w, lines = ordered(); const host = $('#lineshost'); if (!host) return;
  const allSel = lines.length && lines.every(l => state.sel.has(l.id));
  const rate = l => l.unit == null ? '<span class="faint">—</span>' : `${money(l.unit)}<span class="faint">${l.per === 'DAY' ? '/d' : ''}</span>`;
  let tbl;
  if (!lines.length) tbl = `<div class="empty"><b>No gear on this job yet</b>Type a model, kit or asset tag above — Enter adds it. Or skip: Equipment is where gear lives afterwards.</div>`;
  else {
    let h = `<table class="tbl" style="min-width:0;table-layout:fixed;width:100%"><colgroup><col style="width:34px"><col><col style="width:84px"><col style="width:92px"><col style="width:100px"><col style="width:110px"><col style="width:40px"></colgroup><thead><tr><th><button class="cb ${allSel ? 'on' : ''}" data-act="selall" aria-label="Select all"></button></th><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Total</th><th>Gear</th><th></th></tr></thead><tbody>`; let cur = '';
    for (const l of lines) {
      if (l.cat !== cur) { cur = l.cat; h += `<tr class="grp"><td colspan="7">${cur}<span class="n">${lines.filter(x => x.cat === cur).length}</span></td></tr>`; }
      const sel = state.sel.has(l.id), t = lineTotal(l);
      h += `<tr class="row ${sel ? 'sel' : ''}" data-act="lineedit" data-id="${l.id}"><td><button class="cb ${sel ? 'on' : ''}" data-act="select" data-id="${l.id}" aria-label="Select ${esc(l.name)}"></button></td><td><div class="ell" style="font-weight:600">${esc(l.name)}</div><div class="ell" style="font-size:12px;color:var(--muted);margin-top:1px">${lineSub(l)}</div></td><td class="r"><input class="qtyin" data-qty="${l.id}" value="${l.qty}" inputmode="numeric" aria-label="Quantity of ${esc(l.name)}"></td><td class="r mono">${rate(l)}</td><td class="r mono">${t == null ? '<span class="faint">—</span>' : money(t)}</td><td>${lineFlag(l)}</td><td><button class="dots" data-act="linemenu" data-id="${l.id}" aria-label="Row actions">${ICON.dots}</button></td></tr>`;
    }
    tbl = h + '</tbody></table>';
  }
  const cards = lines.map(l => { const sel = state.sel.has(l.id), t = lineTotal(l); return `<div class="lrow ${sel ? 'sel' : ''}" data-act="lineedit" data-id="${l.id}"><button class="cb ${sel ? 'on' : ''}" data-act="select" data-id="${l.id}" aria-label="Select"></button><div class="grow" style="min-width:0"><div class="ttl ell">${esc(l.name)}</div><div class="sub ell">×${l.qty} · ${l.unit == null ? 'unpriced' : money(l.unit) + (l.per === 'DAY' ? '/d' : '')} · ${l.cat}</div></div><div class="right"><div class="mono" style="font-size:14px">${t == null ? '—' : money(t)}</div><div style="font-size:12px;min-height:16px">${lineFlag(l)}</div></div><button class="dots" data-act="linemenu" data-id="${l.id}" aria-label="Row actions">${ICON.dots}</button></div>`; }).join('');
  host.innerHTML = `<div class="shead">Lines <span class="n">${lines.length}</span></div><div class="tblwrap" id="tblwrap" style="overflow:visible">${tbl}</div><div class="list" id="list">${cards}</div>`;
  renderFoot(); renderBulk(); document.body.classList.toggle('hassel', state.sel.size > 0);
}
function renderBulk() {
  const n = state.sel.size, b = $('#bulk'); const on = state.view === 'wizard' && state.step === 1 && n > 0; b.classList.toggle('open', on); if (!on) return;
  const picked = state.w.lines.filter(l => state.sel.has(l.id)), shorts = picked.filter(l => shortOf(l, state.w) > 0).length;
  b.innerHTML = `<b style="font-size:13px">${n} selected</b>${shorts ? `<button class="btn btn-secondary btn-sm" data-act="bulksub">Sub-hire ${shorts} short</button>` : ''}<button class="btn btn-secondary btn-sm" data-act="bulkremove" style="color:var(--t-out)">Remove ${n}</button><button class="btn btn-icon btn-sm" data-act="clearsel" aria-label="Clear selection">✕</button>`;
}
function lineDialog(l) {
  const gross = lineGross(l) || 0, pct = l.discMode === '%' && gross ? Math.round(l.disc / gross * 1000) / 10 + '%' : (l.disc || '');
  openDialog(`<div class="hd"><div class="t-overline">Edit line</div><h2 style="font-size:18px">${esc(l.name)}</h2></div><div class="bd"><div class="row2">${fld('Quantity', `<div class="stepper"><button data-act="lstep" data-d="-1" aria-label="Less">−</button><input id="le-qty" value="${l.qty}" inputmode="numeric"><button data-act="lstep" data-d="1" aria-label="More">+</button></div>`, '', stockLine(l) && windowOf(state.w) ? `${freeOf(l.mid, windowOf(state.w))} free for these dates` : '')}${fld('Price (each)', `<input id="le-unit" class="mono" inputmode="decimal" value="${l.unit == null ? '' : l.unit}" placeholder="not priced">`, '', 'Blank means blank — it is not $0')}</div><div style="height:14px"></div><div class="row2">${fld('Charged', `<div class="tools" style="padding:6px 0 0">${[['DAY','Per day'],['FLAT','Flat']].map(([v,n]) => `<button class="fw" style="${l.per === v ? 'color:var(--ink);box-shadow:inset 0 -2px 0 var(--action-red)' : ''}" data-act="lper" data-v="${v}">${n}</button>`).join('')}</div>`)}${fld('Discount', `<input id="le-disc" class="mono" value="${esc(pct)}" placeholder="85 or 10%">`, '', 'A dollar amount, or a percentage')}</div><div style="height:14px"></div>${fld('Note', `<textarea id="le-note" rows="2" placeholder="Shown on the packing list">${esc(l.note)}</textarea>`)}</div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="lsave" data-id="${l.id}">Save line</button></div>`);
  state.ldraft = { id:l.id, per:l.per };
}
// ---------- step three · Review
function stepThree() {
  const w = state.w, cl = client(w.clientId), ct = cl && cl.contacts.find(k => k.id === w.contactId), lines = ordered(), win = windowOf(w), d = days();
  const ed = s => `<button class="lnk" data-act="step" data-s="${s}">Edit</button>`;
  const cats = new Set(lines.map(l => l.cat)).size, shortN = lines.filter(l => shortOf(l, w) > 0).length, unp = lines.filter(l => l.unit == null && !l.sub).length;
  const hire = hireTotal(), da = discAmt(), net = hire - da, sa = startsAs();
  const gear = win ? (lines.length ? (shortN ? `<span class="dotw err">${shortN} line${shortN > 1 ? 's' : ''} short</span> <span class="muted">· sub-hire from the Equipment tab after you create</span>` : `<span class="dotw ok">All ${lines.length} lines free</span>`) : '<span class="dotw">Gear not checked yet</span> <span class="muted">· no lines</span>') : '<span class="dotw">Availability not checked</span> <span class="muted">· no dates</span>';
  if (w.tpl) return `<div><div class="rv"><div class="k">Template</div><div class="v"><div class="nm">${esc(w.name || 'Untitled template')}</div><div class="ln2">${typeName(w.type)}${w.tags.length ? ' · ' + w.tags.map(esc).join(' · ') : ''}</div></div>${ed(0)}</div><div class="rv"><div class="k">What</div><div class="v">${lines.length} line${lines.length === 1 ? '' : 's'} in ${cats} categor${cats === 1 ? 'y' : 'ies'}<div class="ln2">Dates, crew and deployment state are never copied from a template.</div></div>${ed(1)}</div></div>`;
  return `<div>
  <div class="rv"><div class="k">Job</div><div class="v"><div class="nm">${esc(w.name || 'Untitled job')}</div><div class="ln2"><span class="mono">#${esc(w.code || state.nextNum)}</span> · ${typeName(w.type)}${cl ? ' · ' + esc(cl.name) : ''}${ct ? ' · ' + esc(ct.name) : ''}</div><div class="ln2">${w.pms.length ? 'PM ' + w.pms.map(id => esc(person(id).name)).join(', ') : '<span class="faint">No manager yet</span>'}${w.tags.length ? ' · ' + w.tags.map(esc).join(' · ') : ''}</div></div>${ed(0)}</div>
  <div class="rv"><div class="k">When</div><div class="v">${w.start ? `${longRange(w.start, w.end)}${d ? ` · ${d} day${d > 1 ? 's' : ''}` : ''}` : '<span class="faint">No dates yet</span>'}<div class="ln2">Project window ${w.gStart || w.gEnd ? `<span class="mono">${rng(w.gStart || w.start, w.gEnd || w.end)}${w.gStartT ? ' ' + w.gStartT : ''}</span>` : 'same as rental'}</div><div class="ln2">${gear}</div></div>${ed(0)}</div>
  <div class="rv"><div class="k">Where</div><div class="v">${loc(w.locId) ? esc(loc(w.locId).name) : '<span class="faint">No location yet</span>'}${w.siteName ? `<div class="ln2">${esc(w.siteName)}${w.sitePhone ? ' · <span class="mono">' + esc(w.sitePhone) + '</span>' : ''}</div>` : ''}</div>${ed(0)}</div>
  <div class="rv"><div class="k">What</div><div class="v">${lines.length ? `${lines.length} line${lines.length > 1 ? 's' : ''} in ${cats} categor${cats > 1 ? 'ies' : 'y'}${unp ? ` · <span class="dotw warn">${unp} unpriced</span>` : ''}` : '<span class="faint">No gear yet — add it from the Equipment tab</span>'}${lines.length ? `<div class="ln2">${lines.slice(0, 4).map(l => `${esc(l.name)} ×${l.qty}`).join(' · ')}${lines.length > 4 ? ` · +${lines.length - 4} more` : ''}</div><div class="tot"><span>Hire${d ? ` (${d} day${d > 1 ? 's' : ''})` : ''}</span><span class="mono">${money(hire)}</span>${da ? `<span>Discount ${esc(w.discount)}%</span><span class="mono">−${money(da)}</span>` : ''}<span class="b">Total ex GST</span><span class="b mono">${money(net)}</span></div>` : ''}</div>${ed(1)}</div>
  <div class="rv"><div class="k">Starts as</div><div class="v"><button class="startsw" data-act="startsmenu">${statusWord(sa)}<span style="color:var(--faint)">▾</span></button><div class="ln2">Status moves on from the Overview stepper. Gear is pencilled, not held, until the job is Confirmed.</div></div><span></span></div>
  <div class="rv"><div class="k">Creates</div><div class="v">Job <span class="mono">#${esc(w.code || state.nextNum)}</span> as ${STATUS[sa][0]} · ${lines.length} line${lines.length === 1 ? '' : 's'} · ${w.pms.length} manager${w.pms.length === 1 ? '' : 's'}${state.draft.saved ? '<div class="ln2">Finishes the draft you already have — nothing is duplicated.</div>' : ''}</div><span></span></div>
  </div>`;
}
// ---------- the job stub (the Overview header) + edit sheet
function curJob() { return state.jobs[state.jobRef]; }
function renderStub() {
  const j = curJob(); document.body.classList.remove('hassel'); $('#bulk').classList.remove('open');
  $('#steps').style.display = 'none'; $('#wzfoot').style.display = 'none';
  const cl = client(j.clientId), d = nDays(j.start, j.end), st = STATUS[j.status] || STATUS.ENQUIRY;
  $('#crumbb').textContent = '#' + j.num + ' ' + j.name; $('#phonettl').textContent = j.name;
  $('#phonesub').innerHTML = `<span class="mono">#${j.num}</span> · ${STATUS[j.status][0]}${j.start ? ' · ' + rng(j.start, j.end) : ''}`;
  const fresh = state.created === j.num;
  $('#wzhead').innerHTML = `<div class="stub"><div class="wzhead"><div class="grow"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h1 class="h1">${esc(j.name)}</h1>${statusWord(j.status)}${j.locked ? `<span class="lockbtn" title="Pricing locked" aria-label="Pricing locked">${ICON.lock}</span>` : ''}</div><div class="wzsub" style="margin-top:6px"><span class="mono">#${j.num}</span><span>·</span><span>${cl ? esc(cl.name) : '<span class="faint">No client</span>'}</span><span>·</span><span>${j.start ? `${rng(j.start, j.end)} · ${d} day${d > 1 ? 's' : ''}` : 'No dates'}</span>${j.total ? `<span>·</span><span class="mono">${money(j.total)}</span>` : ''}${j.pms.length ? `<span>·</span><span>${esc(person(j.pms[0]).name)}</span>` : ''}</div></div><div class="wzact deskonly"><button class="btn btn-secondary btn-sm" data-act="editopen">Edit</button><a class="btn btn-primary btn-sm" href="${URLS.ov}">Open job</a><button class="btn btn-icon btn-sm" data-act="pagemenu" aria-label="More">⋯</button></div></div>
  <div class="stubnote">${fresh ? `<div class="row"><span class="k">Created</span><span>${j.lineCount || 0} line${j.lineCount === 1 ? '' : 's'}${j.net != null ? ` · <span class="mono">${money(j.net)}</span> ex GST` : ''} · starts as ${STATUS[j.status][0]}</span></div>` : ''}<div class="row"><span class="k">${fresh ? 'Next' : 'This page'}</span><span class="muted">${fresh ? 'Open the job to price it, send the quote and plan logistics.' : 'Stands in for the Overview header so the Edit sheet has a home.'} The full page is the <a href="${URLS.ov}">Overview prototype</a>.</span></div></div></div>`;
  $('#wzbody').innerHTML = '<input id="q" aria-hidden="true" tabindex="-1" style="position:absolute;opacity:0;width:0;height:0;pointer-events:none">';
  $('#phoneact').innerHTML = `<button class="btn btn-secondary" data-act="editopen">Edit</button><a class="btn btn-primary" href="${URLS.ov}" style="text-decoration:none;color:#fff">Open job</a>`;
}
function openEdit(ref, tplId) {
  const src = tplId ? tplById(tplId) : state.jobs[ref];
  state.e = { ref, tplId, tpl:!!tplId, locked:!!src.locked, f:structuredClone(Object.fromEntries(Object.keys(blankFields()).map(k => [k, src[k]]))), origCode:src.code };
  state.e.f.tpl = !!tplId; state.e.f.lines = []; state.e.orig = JSON.stringify(state.e.f);
  state.ui.e = { cal:false, win:!!(src.gStart || src.gEnd), more:true, month:'', newc:null }; state.errs.e = {};
  closeLayer(); body.innerHTML = `<div class="dlg eside" role="dialog" aria-label="Edit job"><div class="hd"><div class="t-overline">${tplId ? 'Edit template' : 'Edit job'}${tplId ? '' : ` · <span class="mono">#${esc(src.num)}</span>`}</div><div class="shh"><h2>${esc(src.name)}</h2><button class="btn btn-icon" data-act="close" aria-label="Close">✕</button></div></div><div class="bd" id="sheetbody">${fieldsHtml('e')}</div><div class="ft" id="sheetfoot"></div></div>`;
  layer.classList.add('open', 'dim'); sheetFoot();
}
const LABELS = { name:'name', code:'number', clientId:'client', contactId:'contact', start:'dates', end:'dates', gStart:'project window', gStartT:'project window', gEnd:'project window', gEndT:'project window', type:'type', pms:'managers', tags:'tags', desc:'description', locId:'location', siteName:'site contact', sitePhone:'site contact', siteEmail:'site contact', discount:'discount' };
function changed() { const e = state.e, o = JSON.parse(e.orig), out = []; for (const k of Object.keys(LABELS)) if (JSON.stringify(e.f[k]) !== JSON.stringify(o[k]) && !out.includes(LABELS[k])) out.push(LABELS[k]); return out; }
function sheetFoot() { const f = $('#sheetfoot'); if (!f || !state.e) return; const ch = changed(); f.innerHTML = `<span class="nochg">${ch.length ? ch.join(', ') + ' changed' : 'No changes'}</span><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="editsave" ${ch.length ? '' : 'disabled'}>Save changes</button>`; }
function editSave(force) {
  const e = state.e, f = e.f; const errs = validate(f, { tpl:e.tpl, self:e.origCode }); state.errs.e = errs;
  if (Object.keys(errs).length) { refreshForm('e'); const fe = $('#sheetbody .field.err'); if (fe) fe.scrollIntoView({ block:'center' }); return; }
  const job = e.tpl ? tplById(e.tplId) : state.jobs[e.ref];
  if (!force && !e.tpl && HARD.includes(job.status)) {
    const o = windowOf(job), n = windowOf(f);
    if (n && (!o || o[0] !== n[0] || o[1] !== n[1])) {
      const rows = gateRows(BOOK.find(b => b.num === '#' + job.num).lines, n, '#' + job.num);
      if (rows.length) { gateDialog(rows, n); return; }
    }
  }
  commitEdit();
}
function nest(html) { const old = $('.nest', body); if (old) old.remove(); body.insertAdjacentHTML('beforeend', `<div class="nest"><div class="nscrim" data-act="closenest"></div><div class="dlg">${html}</div></div>`); }
function gateDialog(rows, n) {
  const vis = rows.slice(0, 5), more = rows.length - vis.length;
  nest(`<div class="hd"><span class="dotw warn">Heads-up</span><h2 style="font-size:18px">Moving these dates creates a shortage</h2></div><div class="bd"><ul class="gatelist">${vis.map(r => `<li><span class="q">${r.qty} ×</span><span>${esc(r.name)} <span class="muted">— also booked on ${r.jobs.map(j => `<span class="mono">${j}</span>`).join(', ')}</span></span></li>`).join('')}${more > 0 ? `<li class="muted" style="font-size:12px">+${more} more</li>` : ''}</ul><div class="t-small muted" style="margin-top:12px">${rng(n[0], n[1])} · this is a heads-up, not a block — you can still save.</div></div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="closenest">Cancel</button><button class="btn btn-primary" data-act="gosave">Save anyway</button></div>`);
}
function commitEdit() {
  const e = state.e, f = e.f, ch = changed(); const undo = snapshot();
  const job = e.tpl ? tplById(e.tplId) : state.jobs[e.ref];
  for (const k of Object.keys(LABELS)) job[k] = structuredClone(f[k]);
  if (!e.tpl) { const b = BOOK.find(x => x.num === '#' + job.num); const w = windowOf(job); if (b && w) { b.s = w[0]; b.e = w[1]; } }
  closeLayer(); renderAll(); toast(`${e.tpl ? 'Template' : '#' + job.num} saved · ${ch.join(', ')}`, undo);
}
// ---------- templates
function tplMenu(el) {
  const items = [{ sh:'Start from a template · lines come with it, dates are cleared' }, ...[...state.templates].sort((a, b) => b.used - a.used).slice(0, 5).map(t => ({ label:esc(t.name), act:'tplpick', args:`data-id="${t.id}"`, small:`${t.lines.length} lines`, on:state.w.tplId === t.id })), '-'];
  if (state.w.tplId) items.push({ label:'Start from scratch', act:'tplclear' });
  items.push({ label:'Manage templates…', act:'tplmanage', small:String(state.templates.length) }, { label:'New template…', act:'newtpl' });
  openMenu(el, 'Start from template', items);
}
function applyTemplate(id) {
  const t = tplById(id), w = state.w, undo = snapshot(); t.used++;
  w.tplId = id; w.type = t.type; w.tags = [...t.tags]; w.desc = t.desc; if (t.clientId && !w.clientId) { w.clientId = t.clientId; const cl = client(t.clientId); if (cl && !w.discountTouched) w.discount = cl.disc ? String(cl.disc) : ''; }
  w.lines = t.lines.map(([mid, qty]) => { const c = cat1(mid); return { id:'L' + lineSeq++, seq:lineSeq, kind:c.kind, mid, name:c.name, cat:c.cat, qty, unit:c.unit, per:c.kind === 'sale' ? 'FLAT' : 'DAY', disc:0, serials:[], note:'', members:c.members }; });
  touch('w'); closeLayer(); renderAll(); toast(`Started from ${esc(t.name)} · ${w.lines.length} lines come with it`, undo);
}
function tplDialogInner() {
  const ts = state.templates, n = state.tsel.size;
  const rows = ts.length ? ts.map(t => { const sel = state.tsel.has(t.id), cl = client(t.clientId); return `<div class="tplrow"><button class="cb ${sel ? 'on' : ''}" data-act="tselect" data-id="${t.id}" aria-label="Select ${esc(t.name)}" style="width:${isPhone() ? 22 : 16}px;height:${isPhone() ? 22 : 16}px"></button><div class="grow"><div class="nm ell">${esc(t.name)}</div><div class="sb ell">${typeName(t.type)}${cl ? ' · ' + esc(cl.name) : ''} · used ${t.used}×</div></div><span class="mono muted" style="font-size:12.5px">${t.lines.length} lines</span><button class="dots" data-act="tplrowmenu" data-id="${t.id}" aria-label="Row actions">${ICON.dots}</button></div>`; }).join('') : `<div class="empty"><b>No templates yet</b>Save a job as a template from its ⋯ menu, or make one here.</div>`;
  return `<div class="hd"><div class="t-overline">Templates</div><h2 style="font-size:18px">Manage templates <span class="mono muted" style="font-size:14px;font-weight:500;margin-left:6px">${ts.length}</span></h2></div><div class="bd" style="padding:0;max-height:52vh">${rows}</div><div class="ft"><button class="lnk" data-act="newtpl">New template…</button>${n ? `<b style="font-size:13px">${n} selected</b><button class="btn btn-secondary btn-sm" data-act="tpldelete" style="color:var(--t-out)">Delete ${n}</button><button class="btn btn-icon btn-sm" data-act="tclear" aria-label="Clear selection">✕</button>` : `<div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Done</button>`}</div>`;
}
function tplDialog() { state.tsel.clear(); openDialog(tplDialogInner()); }
function tplRefresh() { const d = $('.dlg', body); if (d && !d.classList.contains('eside')) d.innerHTML = tplDialogInner(); }
function menuOver(anchor, title, items) { const keep = body.innerHTML; openMenu(anchor, title, items); body.insertAdjacentHTML('afterbegin', keep + '<div class="mscrim" data-act="closemenu"></div>'); }
// ---------- actions
function startOver() { state.w = freshW(false); state.step = 0; state.view = 'wizard'; state.draft = { saved:false }; state.startsAs = ''; state.sel.clear(); state.add = { q:'', kind:'all', sel:0, last:null }; state.errs.w = {}; state.ui.w = { cal:false, win:false, more:false, month:'', newc:null }; closeLayer(); renderAll(); }
function goStep(s) {
  const w = state.w;
  if (s > 0 && state.step === 0) { const e = validate(w, { tpl:w.tpl }); state.errs.w = e; if (Object.keys(e).length) { renderBody(); const fe = $('.field.err'); if (fe) fe.scrollIntoView({ block:'center' }); toast(Object.values(e)[0]); return false; } }
  state.step = s; state.errs.w = {}; closeCombo(); renderAll(); if (s === 1 && !isPhone()) { const q = $('#q'); if (q) q.focus(); } else window.scrollTo(0, 0); $('.content').scrollTop = 0; return true;
}
function act(name, el, ev) {
  const id = el && el.dataset ? el.dataset.id : null, c = el && el.dataset ? el.dataset.c : null;
  switch (name) {
    case 'close': closeLayer(); break;
    case 'closenest': { const n = $('.nest', body); if (n) n.remove(); break; }
    case 'closemenu': body.querySelectorAll('.menu,.sheetwrap,.mscrim').forEach(n => n.remove()); break;
    case 'noop': closeLayer(); toast('Not wired in this prototype'); break;
    case 'new': if (state.view === 'job') startOver(); break;
    case 'step': { const s = +el.dataset.s; if (s === state.step) break; goStep(s); break; }
    case 'next': goStep(Math.min(2, state.step + 1)); break;
    case 'back': goStep(Math.max(0, state.step - 1)); break;
    case 'more': UI(c).more = !UI(c).more; refreshForm(c); break;
    case 'caltoggle': UI(c).cal = !UI(c).cal; refreshWhen(c); break;
    case 'wintoggle': UI(c).win = !UI(c).win; refreshWhen(c); break;
    case 'winreset': { const X = F(c); X.gStart = X.gEnd = X.gStartT = X.gEndT = ''; refreshWhen(c); touch(c); break; }
    case 'calnav': { const U = UI(c), X = F(c), base = U.month || (X.start || TODAY).slice(0, 7); let [y, m] = base.split('-').map(Number); m += +el.dataset.d; if (m > 12) { m = 1; y++; } if (m < 1) { m = 12; y--; } U.month = `${y}-${String(m).padStart(2, '0')}`; refreshWhen(c); break; }
    case 'calday': { const X = F(c), d = el.dataset.d; if (!X.start || (X.start && X.end)) { if (X.start && X.end) UI(c).prev = { s:X.start, g:[X.gStart, X.gEnd] }; X.start = d; X.end = ''; } else if (d < X.start) { X.end = X.start; X.start = d; } else { X.end = d; UI(c).cal = false; const pv = UI(c).prev; if (c === 'e' && pv && (pv.g[0] || pv.g[1])) { const dl = dayNum(X.start) - dayNum(pv.s); if (pv.g[0]) X.gStart = addD(pv.g[0], dl); if (pv.g[1]) X.gEnd = addD(pv.g[1], dl); } UI(c).prev = null; } if (X.end) state.errs[c] = {}; refreshWhen(c); touch(c); break; }
    case 'calpreset': { const X = F(c), p = +el.dataset.p; let s = X.start || TODAY; if (p === 2) { s = addD(s, (5 - dow(s) + 7) % 7); } X.start = s; X.end = addD(s, [0, 1, 2, 6][p]); UI(c).cal = false; refreshWhen(c); touch(c); break; }
    case 'calclear': { const X = F(c); X.start = X.end = ''; refreshWhen(c); touch(c); break; }
    case 'cbpick': cbPick(c, el.dataset.key, el.dataset.v); break;
    case 'cbrm': { const X = F(c), k = el.dataset.key, v = el.dataset.v; X[k] = X[k].filter(x => x !== v); touch(c); refreshForm(c); break; }
    case 'nccancel': UI(c).newc = null; refreshForm(c); break;
    case 'ncgo': {
      const n = UI(c).newc; if (!n.name.trim()) { toast('Give the client a name'); break; }
      const undo = snapshot(); const k = { id:'c' + (state.clients.length + 1) + 'n', name:n.name.trim(), disc:0, contacts:n.cn.trim() ? [{ id:'ct' + (900 + state.clients.length), name:n.cn.trim(), primary:true, role:'Primary' }] : [] };
      state.clients.push(k); const X = F(c); X.clientId = k.id; X.contactId = ''; UI(c).newc = null; touch(c); refreshForm(c); toast(`Client ${esc(k.name)} created and selected`, undo); break;
    }
    case 'nlgo': {
      const n = UI(c).newc; if (!n.name.trim()) { toast('Give the location a name'); break; }
      const undo = snapshot(); const l = { id:'l' + (LOCS.length + 1), name:n.name.trim(), addr:'' }; LOCS.push(l); const X = F(c); X.locId = l.id; UI(c).newc = null; touch(c); refreshForm(c);
      toast(`Location ${esc(l.name)} created and selected`, () => { undo(); LOCS.pop(); }); break;
    }
    case 'enquiry': {
      const w = state.w, e = validate(w, { tpl:false }); if (Object.keys(e).length) { state.errs.w = e; renderBody(); toast(Object.values(e)[0]); break; }
      createJob(true); break;
    }
    case 'create': {
      const w = state.w, e = validate(w, { tpl:w.tpl }); if (Object.keys(e).length) { state.errs.w = e; state.step = 0; renderAll(); toast(Object.values(e)[0]); break; }
      if (w.tpl) createTemplate(); else createJob(false); break;
    }
    case 'startsmenu': openMenu(el, 'Starts as', [['ENQUIRY', 'Enquiry'], ['QUOTING', 'Quoting']].map(([v, l]) => ({ label:l, act:'startsset', args:`data-v="${v}"`, on:startsAs() === v })).concat([{ sh:'Confirmed and later come from the Overview stepper, with its checks' }])); break;
    case 'startsset': state.startsAs = el.dataset.v; closeLayer(); renderAll(); break;
    case 'tplmenu': tplMenu(el); break;
    case 'tplpick': closeLayer(); applyTemplate(id); break;
    case 'tplclear': { const undo = snapshot(); const w = state.w; w.tplId = ''; w.lines = []; closeLayer(); renderAll(); toast('Back to a blank job · the template’s lines are removed', undo); break; }
    case 'tplmanage': closeLayer(); tplDialog(); break;
    case 'tselect': { if (ev && ev.shiftKey && state.tlast) { const order = state.templates.map(t => t.id), a = order.indexOf(state.tlast), b = order.indexOf(id); for (const k of order.slice(Math.min(a, b), Math.max(a, b) + 1)) state.tsel.add(k); } else state.tsel.has(id) ? state.tsel.delete(id) : state.tsel.add(id); state.tlast = id; tplRefresh(); break; }
    case 'tclear': state.tsel.clear(); tplRefresh(); break;
    case 'tplrowmenu': menuOver(el, tplById(id).name, [{ label:'Use for a new job', act:'tpluse', args:`data-id="${id}"` }, { label:'Edit template…', act:'tpledit', args:`data-id="${id}"` }, '-', { label:'Delete…', act:'tpldeleteone', args:`data-id="${id}"`, danger:true }]); break;
    case 'tpluse': { closeLayer(); if (state.view === 'job') startOver(); applyTemplate(id); break; }
    case 'tpledit': closeLayer(); openEdit(null, id); break;
    case 'tpldeleteone': body.querySelectorAll('.menu,.sheetwrap,.mscrim').forEach(n => n.remove()); state.tsel = new Set([id]); act('tpldelete', el); break;
    case 'tpldelete': { const n = state.tsel.size, names = [...state.tsel].map(i => tplById(i).name); nest(`<div class="hd"><div class="t-overline">Delete</div><h2 style="font-size:18px">${n === 1 ? `Delete “${esc(names[0])}”?` : `Delete ${n} templates?`}</h2></div><div class="bd"><div class="t-small" style="line-height:1.5">This removes the template. Jobs already created from it are not affected.</div></div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="closenest">Cancel</button><button class="btn btn-secondary" style="color:var(--t-out)" data-act="tpldeletego">Delete ${n === 1 ? 'template' : n + ' templates'}</button></div>`); break; }
    case 'tpldeletego': { const undo = snapshot(), n = state.tsel.size; state.templates = state.templates.filter(t => !state.tsel.has(t.id)); if (state.w.tplId && !tplById(state.w.tplId)) state.w.tplId = ''; state.tsel.clear(); const nn = $('.nest', body); if (nn) nn.remove(); body.querySelectorAll('.menu,.sheetwrap,.mscrim').forEach(x => x.remove()); renderAll(); tplRefresh(); toast(`${n} template${n > 1 ? 's' : ''} deleted · jobs made from them are untouched`, () => { undo(); }); break; }
    case 'newtpl': { closeLayer(); state.stash = structuredClone({ w:state.w, step:state.step, draft:state.draft, startsAs:state.startsAs, view:state.view }); state.view = 'wizard'; state.w = freshW(true); state.step = 0; state.sel.clear(); state.errs.w = {}; state.ui.w = { cal:false, win:false, more:false, month:'', newc:null }; renderAll(); break; }
    case 'tplcancel': { if (state.stash) { const s = state.stash; state.stash = null; Object.assign(state, { w:s.w, step:s.step, draft:s.draft, startsAs:s.startsAs, view:s.view }); } else startOver(); renderAll(); break; }
    case 'select': {
      if (ev && ev.shiftKey && state.lastSel) { const order = ordered().map(x => x.id), a = order.indexOf(state.lastSel), b = order.indexOf(id); for (const k of order.slice(Math.min(a, b), Math.max(a, b) + 1)) state.sel.add(k); }
      else state.sel.has(id) ? state.sel.delete(id) : state.sel.add(id);
      state.lastSel = id; renderLines(); break;
    }
    case 'selall': { const all = ordered(); const every = all.every(x => state.sel.has(x.id)); all.forEach(x => every ? state.sel.delete(x.id) : state.sel.add(x.id)); renderLines(); break; }
    case 'clearsel': state.sel.clear(); renderLines(); break;
    case 'addkind': state.add.kind = el.dataset.k; state.add.sel = 0; renderResults(); $('#q').focus(); break;
    case 'addpick': addPick(+el.dataset.i); break;
    case 'lineedit': { if (ev && ev.target.closest('.cb,.dots,input')) break; const l = state.w.lines.find(x => x.id === id); if (l) lineDialog(l); break; }
    case 'linemenu': { const l = state.w.lines.find(x => x.id === id), s = shortOf(l, state.w); openMenu(el, l.name, [{ label:'Edit…', act:'lineedit', args:`data-id="${id}"` }, ...(s ? [{ label:`Sub-hire the shortfall · ${s}`, act:'subhireone', args:`data-id="${id}"` }] : []), '-', { label:'Remove', act:'removeone', args:`data-id="${id}"`, danger:true }]); break; }
    case 'removeone': { const undo = snapshot(), l = state.w.lines.find(x => x.id === id); state.w.lines = state.w.lines.filter(x => x.id !== id); state.sel.delete(id); closeLayer(); renderSteps(); renderLines(); toast(`Removed ${esc(l.name)}`, undo); break; }
    case 'subhireone': { subhire([id]); break; }
    case 'bulksub': subhire([...state.sel]); break;
    case 'bulkremove': { const undo = snapshot(), n = state.sel.size; state.w.lines = state.w.lines.filter(x => !state.sel.has(x.id)); state.sel.clear(); renderSteps(); renderLines(); toast(`Removed ${n} line${n > 1 ? 's' : ''}`, undo); break; }
    case 'lstep': { const i = $('#le-qty', body); i.value = Math.max(1, (parseInt(i.value, 10) || 1) + +el.dataset.d); break; }
    case 'lper': { state.ldraft.per = el.dataset.v; body.querySelectorAll('[data-act="lper"]').forEach(b => { const on = b.dataset.v === state.ldraft.per; b.style.color = on ? 'var(--ink)' : ''; b.style.boxShadow = on ? 'inset 0 -2px 0 var(--action-red)' : 'none'; }); break; }
    case 'lsave': {
      const l = state.w.lines.find(x => x.id === id), undo = snapshot();
      l.qty = Math.max(1, parseInt($('#le-qty', body).value, 10) || 1); const u = $('#le-unit', body).value.trim(); l.unit = u === '' ? null : Math.max(0, parseFloat(u) || 0); l.per = state.ldraft.per; l.note = $('#le-note', body).value;
      const dv = $('#le-disc', body).value.trim(), g = lineGross(l) || 0; if (/%$/.test(dv)) { l.discMode = '%'; l.disc = Math.round(g * (parseFloat(dv) || 0) / 100); } else { l.discMode = '$'; l.disc = parseFloat(dv) || 0; }
      closeLayer(); renderLines(); renderSteps(); toast(`${esc(l.name)} · ×${l.qty}${l.unit == null ? ' · unpriced' : ' · ' + money(lineTotal(l))}`, undo); const q = $('#q'); if (q && !isPhone()) q.focus(); break;
    }
    case 'pagemenu': {
      if (state.view === 'job') openMenu(el, '#' + curJob().num, [{ label:'Edit job…', act:'editopen' }, { label:'Open job', href:URLS.ov, small:'Overview' }, ...(state.jobRef !== '2341' ? [{ label:'Edit an existing job (#2341)', act:'editexisting' }] : []), '-', { label:'Start another job', act:'new2' }]);
      else openMenu(el, state.w.tpl ? 'New template' : 'New job', [{ label:'Edit an existing job (#2341)', act:'editexisting' }, ...(state.draft.saved && !state.w.tpl ? ['-', { label:'Discard draft…', act:'discard', danger:true }] : [])]);
      break;
    }
    case 'new2': startOver(); break;
    case 'editopen': closeLayer(); openEdit(state.jobRef); break;
    case 'editexisting': closeLayer(); state.jobRef = '2341'; state.view = 'job'; renderAll(); openEdit('2341'); break;
    case 'editsave': editSave(false); break;
    case 'gosave': { const n = $('.nest', body); if (n) n.remove(); editSave(true); break; }
    case 'discard': closeLayer(); openDialog(`<div class="hd"><div class="t-overline">Draft</div><h2 style="font-size:18px">Discard draft #${state.nextNum}?</h2></div><div class="bd"><div class="t-small" style="line-height:1.5">Nothing was sent or reserved. The job number is released and the lines you added here are dropped.</div></div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Keep draft</button><button class="btn btn-secondary" style="color:var(--t-out)" data-act="discardgo">Discard draft</button></div>`); break;
    case 'discardgo': { const undo = snapshot(); startOver(); toast(`Draft discarded`, undo); break; }
    case 'undo': if (state.undo) { state.undo(); state.undo = null; } $('#toast').classList.remove('open'); break;
    case 'toastclose': $('#toast').classList.remove('open'); break;
  }
}
function subhire(ids) {
  const undo = snapshot(), w = state.w; let n = 0, add = [];
  for (const id of ids) { const l = w.lines.find(x => x.id === id); if (!l) continue; const s = shortOf(l, w); if (!s) continue; n += s; l.qty -= s; add.push({ id:'L' + lineSeq++, seq:lineSeq, kind:'gear', sub:true, mid:l.mid, name:l.name, cat:l.cat, qty:s, unit:l.unit, per:'DAY', disc:0, serials:[], note:'' }); }
  w.lines = w.lines.filter(l => l.qty > 0).concat(add); state.sel.clear(); closeLayer(); renderSteps(); renderLines(); toast(`Sub-hiring ${n} short · supplier is picked on the Equipment tab`, undo);
}
function createJob(enquiry) {
  const undo = snapshot(), w = state.w; const lines = enquiry ? [] : w.lines; const num = String(w.code).trim(); const keep = w.lines; if (enquiry) w.lines = [];
  const hire = hireTotal(), net = hire - discAmt(), status = enquiry ? 'ENQUIRY' : startsAs();
  const job = Object.assign(blankFields(), Object.fromEntries(Object.keys(blankFields()).map(k => [k, structuredClone(w[k])])), { num, status, lineCount:lines.length, net: lines.length ? net : null, total: 0 });
  state.jobs[num] = job; USED_CODES.push(num);
  if (lines.length) BOOK.push({ num:'#' + num, name:w.name, s:(windowOf(w) || ['', ''])[0], e:(windowOf(w) || ['', ''])[1], lines:needByModel(lines) });
  if (enquiry) w.lines = keep;
  state.created = num; state.jobRef = num; state.view = 'job'; state.nextNum++; state.sel.clear(); closeLayer(); renderAll();
  toast(enquiry ? `Enquiry #${num} created · gear and review skipped` : `Job #${num} created · ${lines.length} line${lines.length === 1 ? '' : 's'}${lines.length ? ' · ' + money(net) + ' ex GST' : ''}`, () => { undo(); USED_CODES.splice(USED_CODES.indexOf(num), 1); });
}
function createTemplate() {
  const w = state.w, undo = snapshot(); const t = Object.assign(blankFields(), Object.fromEntries(Object.keys(blankFields()).map(k => [k, structuredClone(w[k])])), { id:'t' + (state.templates.length + 10), tpl:true, used:0, code:'', lines:w.lines.filter(l => l.mid).map(l => [l.mid, l.qty]) });
  state.templates.unshift(t);
  if (state.stash) { const s = state.stash; state.stash = null; Object.assign(state, { w:s.w, step:s.step, draft:s.draft, startsAs:s.startsAs, view:s.view }); } else startOver();
  closeLayer(); renderAll(); toast(`Template ${esc(t.name)} created · ${t.lines.length} lines`, undo);
}
// ---------- input wiring (no re-render while typing)
document.addEventListener('input', ev => {
  const t = ev.target;
  if (t.dataset && t.dataset.f) { const X = F(t.dataset.c); if (!X) return; X[t.dataset.f] = t.value; if (t.dataset.f === 'discount') X.discountTouched = true; const fl = t.closest('.field'); if (fl && fl.classList.contains('err')) { fl.classList.remove('err'); const er = $('.ferr', fl); if (er) er.remove(); } touch(t.dataset.c); }
  else if (t.dataset && t.dataset.cb) { if (!state.cb || state.cb.key !== t.dataset.cb || state.cb.c !== t.dataset.c) state.cb = { c:t.dataset.c, key:t.dataset.cb, q:'', sel:0 }; state.cb.q = t.value; state.cb.sel = 0; cbRender(); }
  else if (t.dataset && t.dataset.nc) { const n = UI(t.dataset.c).newc; if (n) n[t.dataset.nc] = t.value; }
  else if (t.id === 'q' && state.view === 'wizard' && state.step === 1) { state.add.q = t.value; state.add.sel = 0; renderResults(); }
});
document.addEventListener('change', ev => {
  const t = ev.target;
  if (t.dataset && t.dataset.f && ['gStart', 'gStartT', 'gEnd', 'gEndT'].includes(t.dataset.f)) refreshWhen(t.dataset.c);
  if (t.dataset && t.dataset.nc && t.tagName === 'SELECT') { const n = UI(t.dataset.c).newc; if (n) n.type = t.value; }
  if (t.dataset && t.dataset.qty) {
    const l = state.w.lines.find(x => x.id === t.dataset.qty), n = Math.max(1, parseInt(t.value, 10) || 1); if (!l || n === l.qty) { renderLines(); return; }
    const undo = snapshot(), old = l.qty; l.qty = n; renderSteps(); renderLines(); toast(`${esc(l.name)} · ×${old} → ×${n}${shortOf(l, state.w) ? ` · <b style="color:var(--t-out)">short ${shortOf(l, state.w)}</b>` : ''}`, undo);
  }
});
document.addEventListener('focusin', ev => { const t = ev.target; if (t.classList && t.classList.contains('cbin')) { state.cb = { c:t.dataset.c, key:t.dataset.cb, q:'', sel:0 }; cbRender(); if (!['pms', 'tags'].includes(t.dataset.cb)) t.select(); } });
document.addEventListener('mousedown', ev => { if (state.cb && !ev.target.closest('.combo')) closeCombo(); });
document.addEventListener('keydown', ev => {
  const t = ev.target;
  if (t.classList && t.classList.contains('cbin') && state.cb) {
    if (ev.key === 'ArrowDown') { state.cb.sel = Math.min(state.cb.n - 1, state.cb.sel + 1); cbRender(); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { state.cb.sel = Math.max(0, state.cb.sel - 1); cbRender(); ev.preventDefault(); }
    else if (ev.key === 'Enter') { const o = cbOptions(state.cb.c, state.cb.key, state.cb.q)[state.cb.sel]; if (o) cbPick(state.cb.c, state.cb.key, o.v); ev.preventDefault(); }
    return;
  }
  if (t.id === 'q' && state.view === 'wizard' && state.step === 1) {
    const a = state.add;
    if (ev.key === 'ArrowDown') { a.sel = Math.min((a.res || []).length - 1, a.sel + 1); renderResults(); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { a.sel = Math.max(0, a.sel - 1); renderResults(); ev.preventDefault(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); if (!a.q.trim() && a.last) { const l = state.w.lines.find(x => x.id === a.last); if (l) { lineDialog(l); return; } } if (a.q.trim()) addPick(a.sel); }
    return;
  }
  if (t.dataset && t.dataset.f === 'name' && ev.key === 'Enter' && t.dataset.c === 'w') { ev.preventDefault(); goStep(1); return; }
  if (t.dataset && t.dataset.nc === 'name' && ev.key === 'Enter') { ev.preventDefault(); const n = UI(t.dataset.c).newc; act(n.kind === 'loc' ? 'nlgo' : 'ncgo', { dataset:{ c:t.dataset.c } }); }
});
window.addEventListener('keydown', ev => {
  if (ev.key !== 'Escape') return;
  if ($('.nest', body)) { $('.nest', body).remove(); ev.stopImmediatePropagation(); return; }
  if ($('.mscrim', body)) { act('closemenu', null); ev.stopImmediatePropagation(); return; }
  if (state.cb) { closeCombo(); ev.stopImmediatePropagation(); return; }
}, true);
renderAll();
