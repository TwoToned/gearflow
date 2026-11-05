// ---------- People lists (Crew · Clients · Suppliers) · ONE config-driven list renderer
const TODAY = '2026-11-09', WEEK_END = '2026-11-15';
const OV = 'https://claude.ai/artifact/RatKsWfTmDJLJHmn6mb7Zo', JOBSURL = 'https://claude.ai/artifact/A7SMPtpTr3aedUDEnuSaxd', ASSETSURL = 'https://claude.ai/artifact/89PDTuMiovgP9i3h4MJ1Tw';
const U = { planner:'https://claude.ai/artifact/AKkgWzJ2gVR3dJTWnMB2Ui', finance:'https://claude.ai/artifact/5VnYTVW2pdA5r1qBRvdrom', home:'https://claude.ai/artifact/3d6zqfosL5hYRvXLBYLnhR', floor:'https://claude.ai/artifact/6xqFcEZZk49w86p5pAsisA', settings:'https://claude.ai/artifact/Q3TeWuQPjzvXbAtmUV8Hg8' };
const rnd = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(11);
const pick = a => a[Math.floor(rnd() * a.length)];
const addD = (d, n) => new Date((dayNum(d) + n) * 864e5).toISOString().slice(0,10);
const dow = d => WD[(dayNum(d) + 3) % 7]; // fixture world: 11 Nov 2026 is a Tuesday (the other prototypes hard-code it)
const fmtDay = d => `${dow(d)} ${fmtD(d)}`;
const initials = n => n.replace(/[^A-Za-z ]/g, '').split(/\s+/).map(w => w[0]).slice(0,2).join('').toUpperCase();
const daysAgo = d => dayNum(TODAY) - dayNum(d);
const agoTxt = d => daysAgo(d) <= 0 ? 'today' : daysAgo(d) + 'd ago';
const plural = (n, s, p) => `${n} ${n === 1 ? s : p || s + 's'}`;
const phoneNo = () => `04${Math.floor(rnd()*90+10)} ${Math.floor(rnd()*900+100)} ${Math.floor(rnd()*900+100)}`;
const slug = n => n.toLowerCase().replace(/[^a-z ]/g, '').replace(/ /g, '.');

// ---------- data
const JOBS = [['#2341','Hilton Sydney gala dinner'],['#2340','Launch night'],['#2350','Qantas awards'],['#2338','Corporate AGM']];
const SHIFTS = [
  { j:0, label:'Delivery', date:'2026-11-11', time:'06:30', hrs:6 }, { j:0, label:'Bump in', date:'2026-11-11', time:'08:00', hrs:10 },
  { j:0, label:'Show day', date:'2026-11-12', time:'14:00', hrs:9 }, { j:0, label:'Show day 2', date:'2026-11-13', time:'14:00', hrs:9 },
  { j:0, label:'Bump out', date:'2026-11-14', time:'20:00', hrs:6 }, { j:1, label:'Launch night', date:'2026-11-14', time:'18:00', hrs:6 },
  { j:2, label:'Awards night', date:'2026-11-13', time:'16:00', hrs:8 }, { j:3, label:'Corporate AGM', date:'2026-11-21', time:'09:00', hrs:8 },
];
const ROLES = { 'Audio tech':['Audio',450,['FOH','monitors','RF','Dante']], 'Rigger':['Rigging',420,['trussing','motors','EWP','hoists']], 'Driver':['Logistics',380,['MR licence','forklift','Van 2']], 'LX op':['Lighting',480,['grandMA3','haze','followspot']], 'Stagehand':['Production',320,['load in','deck','Auslan']], 'Warehouse':['Warehouse',320,['prep','forklift','scan']] };
const call = (s, state, extra={}) => ({ ...SHIFTS[s], job:JOBS[SHIFTS[s].j][0], state, ...extra });
function buildCrew() {
  const out = [];
  const add = (name, role, type, o={}) => { const [dept, rate, sk] = ROLES[role]; out.push({ id:'c' + out.length, name, role, type, dept, rate:o.rate || rate, skills:o.skills || [sk[0], sk[1]], phone:o.phone === undefined ? phoneNo() : o.phone, email:o.email === undefined ? slug(name) + '@mail.com' : o.email, tags:o.tags || [], status:o.status || 'ACTIVE', leaveUntil:o.leaveUntil || null, calls:o.calls || [] }); };
  add('Oli Martin', 'Audio tech', 'Freelancer', { phone:'0400 111 222', skills:['FOH','monitors','RF'], tags:['senior'], calls:[call(1,'CONFIRMED'), call(2,'CONFIRMED'), call(3,'CONFIRMED')] });
  add('Sam Kowalski', 'Stagehand', 'Freelancer', { skills:['rigging','forklift'], calls:[call(0,'CONFIRMED'), call(1,'CONFIRMED'), call(4,'CONFIRMED')] });
  add('Jess Tran', 'LX op', 'Employee', { skills:['grandMA3','haze'], tags:['senior'], calls:[call(2,'CONFIRMED'), call(3,'CONFIRMED')] });
  add('Dev Patel', 'Rigger', 'Freelancer', { skills:['trussing','motors','EWP'], calls:[call(1,'OFFERED', { offeredOn:'2026-11-07' })] });
  add('Mia Rossi', 'LX op', 'Freelancer', { skills:['grandMA3','followspot'], calls:[call(7,'CONFIRMED')] });
  add('Tom Brennan', 'Driver', 'Employee', { skills:['MR licence','forklift'], tags:['licensed driver'], calls:[call(0,'CONFIRMED'), call(4,'CONFIRMED')] });
  add('Ari Nguyen', 'Stagehand', 'Freelancer', { skills:['load in','A1 audio'], email:null, status:'ON_LEAVE', leaveUntil:'2026-11-13' });
  add('Lena Fischer', 'Rigger', 'Employee', { skills:['truss','hoists'], calls:[call(4,'CONFIRMED'), call(5,'OFFERED', { offeredOn:'2026-11-08' })] });
  add('Dan Wu', 'Audio tech', 'Contractor', { skills:['monitors','Dante'], calls:[call(6,'CONFIRMED')] });
  add('Ash Reyes', 'Warehouse', 'Employee', { skills:['prep','scan'], calls:[call(0,'CONFIRMED'), call(1,'CONFIRMED')] });
  const names = ['Noa Berg','Kai Sullivan','Ruby Haddad','Eli Costa','Zoe Marchetti','Finn Oneill','Isla Chen','Max Doyle','Tia Waters','Ravi Menon','Lucy Ashford','Ben Tuilagi','Chloe Park','Jack Moreau','Nina Sokolov','Omar Hassan','Pia Kerr','Luke Brandt','Sia Nair','Will Hartley','Beth Quinn','Theo Rankin'];
  const roles = Object.keys(ROLES);
  names.forEach((n, i) => {
    const role = roles[i % roles.length], r = rnd();
    const calls = [], k = r < .45 ? 0 : r < .85 ? 1 : 2;
    for (let c = 0; c < k; c++) { const s = Math.floor(rnd() * SHIFTS.length); if (calls.some(x => x.date === SHIFTS[s].date)) continue; calls.push(call(s, rnd() < .1 ? 'OFFERED' : 'CONFIRMED', { offeredOn:addD(TODAY, -Math.floor(rnd() * 4)) })); }
    const st = i >= 19 ? 'INACTIVE' : i === 18 ? 'ARCHIVED' : i === 6 ? 'ON_LEAVE' : 'ACTIVE';
    add(n, role, rnd() < .7 ? 'Freelancer' : rnd() < .6 ? 'Employee' : 'Contractor', { calls:st === 'ACTIVE' ? calls : [], status:st, leaveUntil:st === 'ON_LEAVE' ? '2026-11-17' : null, tags:rnd() < .2 ? ['white card'] : [], skills:ROLES[role][2].slice(i % 2, i % 2 + 2) });
  });
  return out;
}
function buildClients() {
  const out = [];
  const add = (name, contact, type, o={}) => out.push({ id:'k' + out.length, name, contact, type, email:`${slug(contact)}@${slug(name).replace(/\./g,'')}.com.au`, openJobs:o.openJobs || 0, jobNums:o.jobNums || [], quoted:o.quoted || 0, outstanding:o.outstanding || 0, dueOn:o.dueOn || null, lastJob:o.lastJob || addD(TODAY, -Math.floor(rnd() * 120 + 10)), lifetime:o.lifetime || Math.round((8000 + rnd() * 160000) / 100) * 100, xero:o.xero || (rnd() < .78 ? 'LINKED' : rnd() < .7 ? 'NONE' : 'ERROR'), tags:o.tags || [], active:o.active !== false });
  add('Hilton Sydney', 'Priya Shah', 'Venue', { openJobs:1, jobNums:['#2341'], quoted:18400, outstanding:11940, dueOn:'2026-11-28', lastJob:'2026-10-18', lifetime:186400, xero:'LINKED', tags:['vip'] });
  add('Qantas', 'Marcus Lee', 'Company', { openJobs:1, jobNums:['#2350'], quoted:41200, lastJob:'2026-09-30', lifetime:212000, xero:'LINKED' });
  add('Ogilvy', 'Dani Kovacs', 'Company', { outstanding:6820, dueOn:'2026-10-22', lastJob:'2026-10-14', lifetime:64200, xero:'LINKED' });
  add('Sydney Opera House', 'Hannah Fox', 'Venue', { openJobs:2, quoted:9600, lastJob:'2026-11-02', lifetime:331000, xero:'LINKED', tags:['vip'] });
  add('Red Bull', 'Jonas Weir', 'Company', { openJobs:1, outstanding:3150, dueOn:'2026-11-03', lastJob:'2026-10-26', lifetime:48800, xero:'LINKED', tags:['outdoor'] });
  add('Live Nation', 'Cass Moreno', 'Production company', { openJobs:3, outstanding:22400, dueOn:'2026-11-24', lastJob:'2026-11-06', lifetime:402300, xero:'LINKED' });
  add('Atlassian', 'Ines Park', 'Company', { openJobs:1, quoted:15800, lastJob:'2026-08-21', lifetime:57500, xero:'ERROR' });
  add('Canva', 'Theo Lund', 'Company', { quoted:8200, lastJob:'2026-07-16', lifetime:39900, xero:'LINKED' });
  add('ICC Sydney', 'Rhea Dunn', 'Venue', { openJobs:1, lastJob:'2026-10-30', lifetime:142800, xero:'LINKED' });
  add('UNSW', 'Prof. Alan Reid', 'Company', { openJobs:0, outstanding:2480, dueOn:'2026-10-30', lastJob:'2026-10-11', lifetime:26100, xero:'NONE' });
  add('Spark Events', 'Mia Tan', 'Production company', { outstanding:9150, dueOn:'2026-10-07', lastJob:'2026-09-12', lifetime:73000, xero:'LINKED' });
  ['Mattel AU','Neon Collective','Sydney Dance Co','Vivid Live','Optus','Bondi Pavilion','Powerhouse Museum','Carriageworks','NSW Health','Woolworths Group','Salesforce ANZ','Tourism Australia','Sparrow Weddings','Harbour Brewing','Fox Studios'].forEach((n, i) => {
    const r = rnd();
    add(n, ['Lena Cho','Ravi Das','Ella Frost','Tom Ng','Sofia Rae','Jim Kerr','Aroha Bell','Ben Sato','Cleo Wynn','Max Ford','Isla Dent','Owen Gray','Pia Long','Rory Hale','Dee Moss'][i], ['Company','Venue','Production company','Individual'][i % 4], { openJobs:r < .35 ? 1 + Math.floor(rnd() * 2) : 0, quoted:r > .6 ? Math.round((3000 + rnd() * 30000) / 100) * 100 : 0, outstanding:r < .3 ? Math.round((1500 + rnd() * 9000) / 10) * 10 : 0, dueOn:addD(TODAY, Math.floor(rnd() * 40) - 14), tags:rnd() < .15 ? ['outdoor'] : [] });
  });
  ['Lumina Weddings','Old Fitzroy Theatre','Harbour Hire Pty'].forEach(n => add(n, 'Former contact', 'Company', { active:false, xero:'NONE', lastJob:addD(TODAY, -400) }));
  return out;
}
function buildSuppliers() {
  const out = [];
  const add = (name, contact, o={}) => out.push({ id:'s' + out.length, name, contact, phone:phoneNo(), email:`accounts@${slug(name).replace(/\./g,'')}.com.au`, acct:'AC-' + Math.floor(rnd() * 9000 + 1000), openOrders:o.openOrders || 0, onHire:o.onHire || 0, dueBack:o.dueBack || null, spend:o.spend ?? Math.round(rnd() * 40000 / 10) * 10, tags:o.tags || [], active:o.active !== false });
  add('Scene Change', 'Rowan Tait', { openOrders:2, onHire:14, dueBack:'2026-11-07', spend:38420, tags:['staging'] });
  add('Big Picture', 'Hana Cole', { openOrders:1, onHire:6, dueBack:'2026-11-15', spend:52900, tags:['video'] });
  add('Chameleon Touring', 'Gus Pereira', { openOrders:1, onHire:24, dueBack:'2026-11-21', spend:27800, tags:['trucking'] });
  add('Showtech Rentals', 'Dee Marlow', { openOrders:1, onHire:4, dueBack:'2026-11-14', spend:14250 });
  add('Stage Right Hire', 'Kyle Boyd', { spend:9800 });
  add('Lightbox AV', 'Nat Ibarra', { openOrders:1, onHire:8, dueBack:'2026-11-18', spend:21600, tags:['lighting'] });
  add('Rope & Truss Co', 'Sue Ahn', { spend:6400, tags:['rigging'] });
  add('Harbour Freight', 'Pete Lowe', { openOrders:1, onHire:0, spend:4300, tags:['trucking'] });
  add('Airwave Radio', 'Jo Park', { openOrders:1, onHire:12, dueBack:'2026-11-12', spend:3900 });
  add('Sydney Staging', 'Ivy Chen', { spend:17900, tags:['staging'] });
  add('Pixel Wall Hire', 'Dom Vega', { openOrders:1, onHire:30, dueBack:'2026-11-17', spend:44100, tags:['video'] });
  add('Quiet Rooms Acoustics', 'Mel Ross', { spend:2200 });
  add('Tent City', 'Alf Ward', { spend:11500 });
  add('Roadie Rentals', 'Closed account', { active:false, spend:1200 });
  add('LED Factory Direct', 'Closed account', { active:false, spend:0 });
  return out;
}
const DATA = { crew:buildCrew(), clients:buildClients(), suppliers:buildSuppliers(), meta:{ pendingTs:4 } };

// ---------- derived (never stored)
const live = r => r.active === undefined ? (r.status === 'ACTIVE' || r.status === 'ON_LEAVE') : r.active;
function cd(r) { // crew: everything about this week comes from the calls
  const calls = r.calls.filter(c => c.date >= TODAY).sort((a,b) => (a.date + a.time).localeCompare(b.date + b.time));
  const conf = calls.filter(c => c.state === 'CONFIRMED'), off = calls.filter(c => c.state === 'OFFERED');
  const hours = conf.filter(c => c.date <= WEEK_END).reduce((s,c) => s + c.hrs, 0);
  const onJob = conf.some(c => c.date <= WEEK_END), unconf = off.length > 0, leave = r.status === 'ON_LEAVE', on = live(r);
  const end = c => parseInt(c.time) + c.hrs; let clash = null;
  for (const a of calls) for (const b of calls) if (a !== b && a.date === b.date && parseInt(a.time) < end(b) && parseInt(b.time) < end(a)) clash = a.date;
  const word = !on ? ['Inactive','faint',4] : leave ? ['On leave','',3] : unconf ? ['Unconfirmed','warn',0] : onJob ? ['On a job','info',1] : ['Available','ok',2];
  const sub = unconf ? `${off[0].job} · asked ${agoTxt(off[0].offeredOn)}` : leave ? `back ${fmtDay(r.leaveUntil)}` : onJob ? `${hours} h confirmed` : '';
  return { calls, next:calls[0] || null, hours, onJob, unconf, leave, on, avail:on && !leave && !onJob, clash, word, sub, off };
}
const overdueDays = r => r.outstanding && r.dueOn && r.dueOn < TODAY ? daysAgo(r.dueOn) : 0;
const supOver = r => r.onHire && r.dueBack && r.dueBack < TODAY ? daysAgo(r.dueBack) : 0;
const dw = (cls, t, title='') => `<span class="dotw ${cls}" ${title?`title="${title}"`:''}>${t}</span>`;
const tagsSub = r => r.tags.length && !state.cols.tags ? ` · <span class="faint">${r.tags.map(esc).join(', ')}</span>` : '';
const who = (r, title, sub, flags='') => `<div class="who"><span class="thumb">${initials(r.name)}</span><div><div class="ell"><b>${title}</b>${flags}</div><div class="sub ell">${sub}</div></div></div>`;
const flagHtml = a => a.length ? `<span class="flags">${a.join('')}</span>` : '';
const XERO = { LINKED:['Linked','ok'], NONE:['Not linked',''], ERROR:['Sync error','err'] };

// ---------- list configs: ONE renderer reads these
const countBy = (arr, fn) => { const m = {}; arr.forEach(r => [].concat(fn(r)).forEach(v => { if (v) m[v] = (m[v] || 0) + 1; })); return m; };
const LISTS = {
  crew: {
    key:'crew', title:'Crew', noun:'crew', one:'crew member', search:'Search name, role, skill or email', primary:'+ Add crew member', exc:'unconf',
    sort:['status','asc'], sortBy:{ name:r => r.name.split(' ').slice(-1)[0] + r.name, status:r => cd(r).word[2], next:r => cd(r).next ? cd(r).next.date + cd(r).next.time : '9999', hours:r => cd(r).hours, rate:r => r.rate },
    segs:[['all','All',r => live(r)],['avail','Available this week',r => cd(r).avail],['onjob','On a job',r => cd(r).onJob],['unconf','Unconfirmed',r => cd(r).unconf],['inactive','Inactive',r => !live(r)]],
    text:r => [r.name, r.role, r.skills.join(' '), r.email || '', r.dept].join(' '),
    filters:[['status','Status',r => cd(r).word[0]],['type','Type',r => r.type],['role','Role',r => r.role],['dept','Department',r => r.dept],['tag','Tag',r => r.tags]],
    cols:[
      { k:'name', label:'Name', sort:'name', cell:r => who(r, esc(r.name), `${esc(r.role)} · ${esc(r.skills.join(', '))}${tagsSub(r)}`, flagHtml([cd(r).clash ? dw('warn', `clash ${fmtD(cd(r).clash)}`, 'Two calls overlap on this day') : ''].filter(Boolean))) },
      { k:'status', label:'Status', sort:'status', w:150, cell:r => { const d = cd(r); return `${dw(d.word[1], d.word[0])}<div class="sub ell">${esc(d.sub)}</div>`; } },
      { k:'next', label:'Next call', sort:'next', w:168, cell:r => { const c = cd(r).next; return c ? `<div class="mono t-small">${fmtDay(c.date)} ${c.time}</div><div class="sub ell">${c.job} ${esc(c.label)}</div>` : '<span class="faint">—</span>'; } },
      { k:'hours', label:'This week', sort:'hours', w:92, align:'r', cell:r => cd(r).hours ? `<span class="mono">${cd(r).hours} h</span>` : '<span class="faint">—</span>' },
      { k:'rate', label:'Rate /day', sort:'rate', w:92, align:'r', cell:r => `<span class="mono">${money(r.rate)}</span>` },
      { k:'phone', label:'Phone', w:124, cell:r => r.phone ? `<span class="mono t-small">${r.phone}</span>` : '<span class="faint">—</span>' },
      { k:'email', label:'Email', opt:true, w:210, cell:r => r.email ? `<span class="t-small muted ell" style="display:block">${esc(r.email)}</span>` : '<span class="faint">no email</span>' },
      { k:'type', label:'Type', opt:true, w:100, cell:r => `<span class="t-small muted">${r.type}</span>` },
      { k:'dept', label:'Department', opt:true, w:104, cell:r => `<span class="t-small muted">${r.dept}</span>` },
      { k:'tags', label:'Tags', opt:true, w:120, cell:r => `<span class="t-small muted">${r.tags.join(', ') || '—'}</span>` },
    ],
    card:r => { const d = cd(r); return { t:esc(r.name), s:`${esc(r.role)} · ${d.next ? fmtDay(d.next.date) + ' ' + d.next.time : 'no calls'}`, x:d.clash ? dw('warn', `clash ${fmtD(d.clash)}`) : '', rt:dw(d.word[1], d.word[0]), rb:d.hours ? `<span class="mono t-small">${d.hours} h</span>` : '' }; },
    sub:rows => { const L = rows.filter(live); return `${L.length} on the roster · ${L.filter(r => cd(r).onJob).length} on a job this week · ${L.reduce((s,r) => s + cd(r).hours, 0)} h confirmed · 96 h approved in the last 7 days`; },
    phoneSub:rows => `${rows.filter(live).length} crew · ${rows.filter(r => cd(r).onJob).length} on a job · ${rows.filter(r => cd(r).unconf).length} unconfirmed`,
    empty:{ none:['No crew yet','Add the people you call before the next job.','+ Add crew member'], seg:{ unconf:['Everyone has answered','Every offer has a yes or a no.'], inactive:['No inactive crew','Deactivated people land here with their history.'], onjob:['Nobody is on a job this week',''], avail:['Nobody is free this week',''] } },
    views:[{ name:'Freelancers free this week', seg:'avail', f:{ type:['Freelancer'] } }, { name:'Riggers', f:{ role:['Rigger'] } }],
    rowMenu:r => { const d = cd(r); return [{ label:'Open', act:'open', args:`data-id="${r.id}"` }, { label:'Open in planner', href:U.planner, small:'Planner' }, '-', { label:'Message…', act:'rmsg', args:`data-id="${r.id}"` }, { label:'Assign to job…', act:'rassign', args:`data-id="${r.id}"` }, d.unconf ? { label:'Resend offer', act:'rresend', args:`data-id="${r.id}"`, small:'SMS' } : null, { label:'Log time…', act:'rlog', args:`data-id="${r.id}"` }, '-', live(r) ? { label:'Deactivate…', act:'rdeact', args:`data-id="${r.id}"`, danger:true } : { label:'Reactivate', act:'rreact', args:`data-id="${r.id}"` }].filter(Boolean); },
    bulk:sel => { const n = sel.length; return [`<button class="btn btn-secondary btn-sm" data-act="bmsg">Message ${n}</button>`, `<button class="btn btn-secondary btn-sm" data-act="bassign">Assign ${n} to job…</button>`, `<button class="btn btn-secondary btn-sm" data-act="btag">Add tag…</button>`, `<button class="btn btn-secondary btn-sm" style="color:var(--t-out)" data-act="bdeact">Deactivate ${n}</button>`]; },
    pageMenu:() => [{ label:'Planner', href:U.planner, small:'Crew calendar' }, { label:'Timesheets', href:U.planner, small:`${DATA.meta.pendingTs} to approve` }, { label:'Crew settings', act:'toast', args:'data-m="Opens Crew settings · roles, default rates, offer templates"', small:'roles · rates' }, '-', { label:'Log time…', act:'rlog' }, { label:'Export timesheets…', act:'rexp' }, { label:'Import crew (CSV)…', act:'toast', args:'data-m="Import opens the CSV mapper · not prototyped"' }, { label:'Export this view (CSV)', act:'toast', args:'data-m="Exporting this view as CSV"' }, '-', { label:'Columns', act:'colsmenu' }],
  },
  clients: {
    key:'clients', title:'Clients', noun:'clients', one:'client', search:'Search client, contact or email', primary:'+ New client', exc:'overdue',
    sort:['open','desc'], sortBy:{ name:r => r.name, open:r => r.openJobs, quoted:r => r.quoted, out:r => r.outstanding, last:r => r.lastJob, xero:r => r.xero, lifetime:r => r.lifetime },
    segs:[['all','All',r => r.active],['active','Active jobs',r => r.active && r.openJobs > 0],['quoting','Quoting',r => r.active && r.quoted > 0],['overdue','Overdue invoices',r => r.active && overdueDays(r) > 0],['archived','Archived',r => !r.active]],
    text:r => [r.name, r.contact, r.email].join(' '),
    filters:[['type','Type',r => r.type],['xero','Xero',r => XERO[r.xero][0]],['tag','Tag',r => r.tags]],
    cols:[
      { k:'name', label:'Client', sort:'name', cell:r => who(r, esc(r.name), `${esc(r.contact)} · ${r.type}${tagsSub(r)}`) },
      { k:'open', label:'Open jobs', sort:'open', w:92, align:'r', cell:r => r.openJobs ? `<span class="mono">${r.openJobs}</span>${r.jobNums.length ? `<div class="sub"><a class="jl mono" href="${r.id === 'k0' ? OV : JOBSURL}">${r.jobNums[0]}</a></div>` : ''}` : '<span class="faint">—</span>' },
      { k:'quoted', label:'Quoted', sort:'quoted', w:104, align:'r', cell:r => r.quoted ? `<span class="mono">${money(r.quoted)}</span>` : '<span class="faint">—</span>' },
      { k:'out', label:'Outstanding', sort:'out', w:124, align:'r', cell:r => r.outstanding ? `<span class="mono">${money(r.outstanding)}</span><div class="sub">${overdueDays(r) ? dw('err', `${overdueDays(r)}d overdue`) : `due ${fmtD(r.dueOn)}`}</div>` : '<span class="faint">—</span>' },
      { k:'last', label:'Last job', sort:'last', w:104, cell:r => `<span class="mono t-small">${fmtD(r.lastJob)}</span>` },
      { k:'xero', label:'Xero', sort:'xero', w:112, cell:r => dw(XERO[r.xero][1], XERO[r.xero][0]) },
      { k:'type', label:'Type', opt:true, w:130, cell:r => `<span class="t-small muted">${r.type}</span>` },
      { k:'email', label:'Email', opt:true, w:210, cell:r => `<span class="t-small muted ell" style="display:block">${esc(r.email)}</span>` },
      { k:'lifetime', label:'Lifetime', sort:'lifetime', opt:true, w:100, align:'r', cell:r => `<span class="mono">${money(r.lifetime)}</span>` },
      { k:'tags', label:'Tags', opt:true, w:110, cell:r => `<span class="t-small muted">${r.tags.join(', ') || '—'}</span>` },
    ],
    card:r => ({ t:esc(r.name), s:`${esc(r.contact)} · ${r.openJobs ? plural(r.openJobs, 'open job') : 'no open jobs'}`, x:'', rt:r.outstanding ? `<span class="mono">${money(r.outstanding)}</span>` : '<span class="faint">—</span>', rb:overdueDays(r) ? dw('err', `${overdueDays(r)}d overdue`) : (r.quoted ? `<span class="t-small muted">${money(r.quoted)} quoted</span>` : '') }),
    sub:rows => { const A = rows.filter(r => r.active); return `${A.filter(r => r.openJobs).length} with open jobs (${A.reduce((s,r) => s + r.openJobs, 0)} live) · ${money(A.reduce((s,r) => s + r.quoted, 0))} quoted · ${money(A.reduce((s,r) => s + r.outstanding, 0))} outstanding`; },
    phoneSub:rows => `${rows.filter(r => r.active).length} clients · ${rows.filter(r => r.active && overdueDays(r)).length} overdue`,
    empty:{ none:['No clients yet','Add a client to start quoting and tracking their jobs.','+ New client'], seg:{ overdue:['Nobody is overdue','Every issued invoice is inside its terms.'], archived:['No archived clients','Archived clients keep their history and land here.'], active:['No client has an open job',''], quoting:['No quotes are waiting on an answer',''] } },
    views:[{ name:'Chase list', seg:'overdue' }, { name:'Venues', f:{ type:['Venue'] } }],
    rowMenu:r => [{ label:'Open', act:'open', args:`data-id="${r.id}"` }, r.jobNums.length ? { label:`Open job ${r.jobNums[0]}`, href:r.id === 'k0' ? OV : JOBSURL, small:'Overview' } : null, { label:'New job for client…', act:'toast', args:`data-m="Opens the New job wizard with ${esc(r.name)} filled in"` }, r.outstanding ? { label:'Open invoices', href:U.finance, small:'Finance' } : null, r.xero === 'LINKED' ? { label:'Open in Xero', act:'toast', args:'data-m="Opens the Xero contact in a new tab"' } : null, '-', { label:'Add tag…', act:'rtag', args:`data-id="${r.id}"` }, '-', r.active ? { label:'Archive…', act:'rarch', args:`data-id="${r.id}"`, danger:true } : { label:'Reactivate', act:'rreact', args:`data-id="${r.id}"` }].filter(Boolean),
    bulk:sel => { const n = sel.length; return [`<button class="btn btn-secondary btn-sm" data-act="btag">Add tag…</button>`, n > 1 ? `<button class="btn btn-secondary btn-sm" data-act="bmerge">Merge ${n}…</button>` : '', `<button class="btn btn-secondary btn-sm deskonly" data-act="bexport">Export</button>`, `<button class="btn btn-secondary btn-sm" style="color:var(--t-out)" data-act="barch">Archive ${n}</button>`]; },
    pageMenu:() => [{ label:'Suppliers', act:'nav', args:'data-k="suppliers"', small:'People' }, { label:'Invoices', href:U.finance, small:`${DATA.clients.filter(r => r.active && overdueDays(r)).length} overdue` }, '-', { label:'Sync contacts from Xero', act:'toast', args:'data-m="Xero sync queued · 1 contact needs review (Atlassian)"', small:'Xero' }, { label:'Import clients (CSV)…', act:'toast', args:'data-m="Import opens the CSV mapper · not prototyped"' }, { label:'Export this view (CSV)', act:'toast', args:'data-m="Exporting this view as CSV"' }, '-', { label:'Columns', act:'colsmenu' }],
  },
  suppliers: {
    key:'suppliers', title:'Suppliers', noun:'suppliers', one:'supplier', search:'Search supplier, contact or account #', primary:'+ New supplier', exc:'overdue',
    sort:['due','asc'], sortBy:{ name:r => r.name, orders:r => r.openOrders, hire:r => r.onHire, due:r => r.dueBack || '9999', spend:r => r.spend },
    segs:[['all','All',r => r.active],['orders','Open orders',r => r.active && r.openOrders > 0],['overdue','Overdue returns',r => r.active && supOver(r) > 0],['archived','Archived',r => !r.active]],
    text:r => [r.name, r.contact, r.acct, r.email].join(' '),
    filters:[['tag','Tag',r => r.tags]],
    cols:[
      { k:'name', label:'Supplier', sort:'name', cell:r => who(r, esc(r.name), `${esc(r.contact)}${tagsSub(r)}`) },
      { k:'orders', label:'Open orders', sort:'orders', w:104, align:'r', cell:r => r.openOrders ? `<span class="mono">${r.openOrders}</span>` : '<span class="faint">—</span>' },
      { k:'hire', label:'On hire now', sort:'hire', w:104, align:'r', cell:r => r.onHire ? `<span class="mono">${r.onHire}</span><div class="sub">items</div>` : '<span class="faint">—</span>' },
      { k:'due', label:'Due back', sort:'due', w:132, cell:r => r.onHire && r.dueBack ? `<span class="mono t-small">${fmtDay(r.dueBack)}</span><div class="sub">${supOver(r) ? dw('err', `${supOver(r)}d overdue`) : `in ${daysAgo(r.dueBack) * -1}d`}</div>` : '<span class="faint">—</span>' },
      { k:'spend', label:'Spend YTD', sort:'spend', w:112, align:'r', cell:r => r.spend ? `<span class="mono">${money(r.spend)}</span>` : '<span class="faint">—</span>' },
      { k:'phone', label:'Phone', opt:true, w:124, cell:r => `<span class="mono t-small">${r.phone}</span>` },
      { k:'acct', label:'Account #', opt:true, w:104, cell:r => `<span class="mono t-small">${r.acct}</span>` },
      { k:'email', label:'Email', opt:true, w:210, cell:r => `<span class="t-small muted ell" style="display:block">${esc(r.email)}</span>` },
      { k:'tags', label:'Tags', opt:true, w:110, cell:r => `<span class="t-small muted">${r.tags.join(', ') || '—'}</span>` },
    ],
    card:r => ({ t:esc(r.name), s:`${esc(r.contact)} · ${r.openOrders ? plural(r.openOrders, 'open order') : 'no open orders'}`, x:'', rt:r.onHire && r.dueBack ? `<span class="mono t-small">${fmtD(r.dueBack)}</span>` : '<span class="faint">—</span>', rb:supOver(r) ? dw('err', `${supOver(r)}d overdue`) : (r.onHire ? `<span class="t-small muted">${r.onHire} on hire</span>` : '') }),
    sub:rows => { const A = rows.filter(r => r.active); return `${A.filter(r => r.openOrders).length} with open orders (${A.reduce((s,r) => s + r.openOrders, 0)} orders) · ${A.reduce((s,r) => s + r.onHire, 0)} items on hire · ${money(A.reduce((s,r) => s + r.spend, 0))} spent this year`; },
    phoneSub:rows => `${rows.filter(r => r.active).length} suppliers · ${rows.filter(r => r.active && supOver(r)).length} overdue returns`,
    empty:{ none:['No suppliers yet','Add the companies you hire from or buy from.','+ New supplier'], seg:{ overdue:['Nothing is overdue back','Every sub-hire is inside its return date.'], archived:['No archived suppliers','Archived suppliers keep their orders and land here.'], orders:['No open orders',''] } },
    views:[{ name:'Overdue back', seg:'overdue' }, { name:'Video hire', f:{ tag:['video'] } }],
    rowMenu:r => [{ label:'Open', act:'open', args:`data-id="${r.id}"` }, { label:'Orders…', act:'toast', args:`data-m="Opens ${esc(r.name)} orders · not prototyped"`, small:`${r.openOrders}` }, { label:'New order…', act:'toast', args:'data-m="Opens a new sub-hire order"' }, r.onHire ? { label:'Returns', href:U.floor, small:'Warehouse' } : null, { label:'Email supplier…', act:'rmsg', args:`data-id="${r.id}"` }, '-', { label:'Add tag…', act:'rtag', args:`data-id="${r.id}"` }, '-', r.active ? { label:'Archive…', act:'rarch', args:`data-id="${r.id}"`, danger:true } : { label:'Reactivate', act:'rreact', args:`data-id="${r.id}"` }].filter(Boolean),
    bulk:sel => { const n = sel.length; return [`<button class="btn btn-secondary btn-sm deskonly" data-act="bexport">Export</button>`, `<button class="btn btn-secondary btn-sm" data-act="btag">Add tag…</button>`, `<button class="btn btn-secondary btn-sm" style="color:var(--t-out)" data-act="barch">Archive ${n}</button>`]; },
    pageMenu:() => [{ label:'Returns', href:U.floor, small:`${DATA.suppliers.filter(r => r.active && supOver(r)).length} overdue` }, { label:'Clients', act:'nav', args:'data-k="clients"', small:'People' }, '-', { label:'Import suppliers (CSV)…', act:'toast', args:'data-m="Import opens the CSV mapper · not prototyped"' }, { label:'Export this view (CSV)', act:'toast', args:'data-m="Exporting this view as CSV"' }, '-', { label:'Columns', act:'colsmenu' }],
  },
};
const ORDER = ['crew','clients','suppliers'];
const VIEWS = { crew:[...LISTS.crew.views], clients:[...LISTS.clients.views], suppliers:[...LISTS.suppliers.views] };

// ---------- state (flat, because core's sortHead/pager read state.sort/dir/page/size)
const fresh = k => ({ seg:'all', q:'', f:Object.fromEntries(LISTS[k].filters.map(x => [x[0], []])), sort:LISTS[k].sort[0], dir:LISTS[k].sort[1], page:0, selected:new Set(), savedView:null, cols:{} });
const STASH = {};
const state = { cur:'crew', size:25, undo:null, lastSel:null, target:null, ...fresh('crew') };
const KEEP = ['seg','q','f','sort','dir','page','selected','savedView','cols'];
function switchTo(k) { if (k === state.cur) return; STASH[state.cur] = Object.fromEntries(KEEP.map(x => [x, state[x]])); Object.assign(state, STASH[k] || fresh(k)); state.cur = k; state.selected = new Set(); state.lastSel = null; $('#q').value = state.q; }
const L = () => LISTS[state.cur], D = () => DATA[state.cur], rec = id => D().find(r => r.id === id);
const selRows = () => D().filter(r => state.selected.has(r.id));
function snapshot() { const s = JSON.stringify(DATA); return () => { const o = JSON.parse(s); for (const k in o) DATA[k] = o[k]; state.selected.clear(); render(); }; }

// ---------- URL is the state
function toHash() {
  const p = new URLSearchParams(), l = L();
  if (state.seg !== 'all') p.set('seg', state.seg); if (state.q) p.set('q', state.q);
  for (const [k, v] of Object.entries(state.f)) if (v.length) p.set(k, v.join('|'));
  if (state.sort !== l.sort[0] || state.dir !== l.sort[1]) p.set('sort', state.sort + '.' + state.dir);
  if (state.page) p.set('page', state.page + 1);
  const s = p.toString(); return '#/' + state.cur + (s ? '?' + s : '');
}
function fromHash() {
  const m = (location.hash || '').match(/^#\/(crew|clients|suppliers)(?:\?(.*))?$/); if (!m) return false;
  switchTo(m[1]); Object.assign(state, fresh(m[1]), { cols:state.cols }); const p = new URLSearchParams(m[2] || '');
  state.seg = L().segs.some(s => s[0] === p.get('seg')) ? p.get('seg') : 'all'; state.q = p.get('q') || '';
  for (const f of L().filters) if (p.get(f[0])) state.f[f[0]] = p.get(f[0]).split('|');
  if (p.get('sort')) { const [a, b] = p.get('sort').split('.'); state.sort = a; state.dir = b; } state.page = Math.max(0, (+p.get('page') || 1) - 1); $('#q').value = state.q; return true;
}
function syncUrl() { const push = state.pushNext; state.pushNext = false; try { const h = toHash(); if (h !== location.hash) history[push ? 'pushState' : 'replaceState'](null, '', h); } catch (e) {} }

// ---------- derived rows
function inSeg(r, seg) { return L().segs.find(s => s[0] === seg)[2](r); }
function matches(r) {
  if (!inSeg(r, state.seg)) return false;
  const q = state.q.trim().toLowerCase(); if (q && !L().text(r).toLowerCase().includes(q)) return false;
  for (const [k,, get] of L().filters) { const sel = state.f[k]; if (sel.length && ![].concat(get(r)).some(v => sel.includes(v))) return false; }
  return true;
}
function rows() { const key = L().sortBy[state.sort] || (r => r[state.sort]), d = state.dir === 'asc' ? 1 : -1; return D().filter(matches).sort((a,b) => { const x = key(a), y = key(b); return (x > y ? 1 : x < y ? -1 : 0) * d || a.name.localeCompare(b.name); }); }
const anyFilter = () => state.q || Object.values(state.f).some(v => v.length);

// ---------- render
function render() { renderNav(); renderHead(); renderStrip(); renderToolbar(); renderTable(); renderList(); renderFoot(); renderBulk(); syncUrl(); }
function renderNav() {
  $('.sidebar .foot a').setAttribute('href', U.settings);
  const ext = (n, c, href) => `<a href="${href}"><span class="patch" style="background:var(--${c}-soft)"></span>${n}</a>`, nav = (n, c, k) => `<a href="#/${k}" data-act="nav" data-k="${k}" class="${state.cur === k ? 'on' : ''}"><span class="patch" style="background:var(--${c}-soft)"></span>${n}</a>`, stub = (n, c) => `<a href="#" data-act="noop"><span class="patch" style="background:var(--${c}-soft)"></span>${n}</a>`;
  $('#sidenav').innerHTML = ext('Dashboard','blue',U.home) + ext('Jobs','blue',JOBSURL) + ext('Finance','green',U.finance) + stub('Schedule','green') + nav('Crew','purple','crew') + nav('Clients','purple','clients') + nav('Suppliers','purple','suppliers') + ext('Assets','amber',ASSETSURL) + ext('Warehouse','teal',U.floor) + stub('Test & tag','teal') + stub('Maintenance','amber');
}
function renderHead() {
  const l = L(), n = D().filter(live).length;
  $('#title').textContent = l.title; $('#count').textContent = n; $('.crumb').innerHTML = `<b>${l.title}</b>`; document.title = `${l.title} · RVLT Flow`;
  $('#headsub').innerHTML = `${l.sub(D())} · <span class="kbd">/</span> search · <span class="kbd">n</span> new`;
  $('#primary').textContent = l.primary; $('#phoneprimary').textContent = l.primary; $('#q').placeholder = l.search;
  $('.phonehead > div').innerHTML = `<button class="ttlbtn" data-act="listsheet">${l.title} <i>▾</i></button><div class="ell t-micro muted" id="phonesub">${l.phoneSub(D())}</div>`;
}
function renderStrip() { const l = L(); $('#strip').innerHTML = l.segs.map(([k, n, fn]) => { const c = D().filter(fn).length; return `<button class="${state.seg === k ? 'on' : ''}" data-act="seg" data-k="${k}" style="${k === l.exc && c ? 'color:var(--t-out)' : ''}">${n} <span class="n">${c}</span></button>`; }).join(''); }
function renderToolbar() {
  const lbl = a => a.length ? (a.length > 1 ? a.length + ' chosen' : a[0]) : '';
  $('#fwords').innerHTML = L().filters.map(([k, label]) => filterWord(label, k, lbl(state.f[k]), 'fmenu')).join('') + (anyFilter() ? `<button class="lnk muted" data-act="clearf">Clear</button>` : '');
  $('#views').innerHTML = `<button class="fw ${state.savedView ? 'on' : ''}" data-act="viewsmenu">${state.savedView ? 'View: ' + esc(state.savedView) : 'Views ▾'}</button>`;
}
const visCols = () => L().cols.filter(c => !c.opt || state.cols[c.k]);
function renderTable() {
  const l = L(), all = rows(), pageRows = all.slice(state.page * state.size, (state.page + 1) * state.size), allSel = pageRows.length && pageRows.every(r => state.selected.has(r.id)), cols = visCols();
  let h = `<table class="tbl" style="min-width:0;table-layout:fixed;width:100%"><colgroup><col style="width:34px">${cols.map(c => `<col${c.w ? ` style="width:${c.w}px"` : ''}>`).join('')}<col style="width:40px"></colgroup><thead><tr><th><button class="cb ${allSel ? 'on' : ''}" data-act="selall" aria-label="Select page"></button></th>${cols.map(c => c.sort ? sortHead(c.label, c.sort, c.align) : `<th class="${c.align || ''}" style="${c.align === 'r' ? 'text-align:right' : ''}">${c.label}</th>`).join('')}<th></th></tr></thead><tbody>`;
  if (!pageRows.length) h += `<tr><td colspan="${cols.length + 2}">${emptyHtml()}</td></tr>`;
  for (const r of pageRows) { const sel = state.selected.has(r.id); h += `<tr class="row ${sel ? 'sel' : ''}" data-act="open" data-id="${r.id}"><td><button class="cb ${sel ? 'on' : ''}" data-act="select" data-id="${r.id}" aria-label="Select ${esc(r.name)}"></button></td>${cols.map(c => `<td class="${c.align || ''}" style="${c.k === 'name' ? 'min-width:0' : ''}">${c.cell(r)}</td>`).join('')}<td class="r"><button class="dots" data-act="rowmenu" data-id="${r.id}" aria-label="${esc(l.one)} actions">${ICON.dots}</button></td></tr>`; }
  $('#tblwrap').innerHTML = h + '</tbody></table>';
}
function emptyHtml() {
  const e = L().empty;
  if (anyFilter()) return `<div class="empty"><b>No ${L().noun} match that</b>Loosen a filter or clear them. <button class="lnk" data-act="clearf">Clear filters</button></div>`;
  const s = e.seg[state.seg]; if (s) return `<div class="empty"><b>${s[0]}</b>${s[1]}</div>`;
  return `<div class="empty"><b>${e.none[0]}</b>${e.none[1]} <button class="lnk" data-act="new">${e.none[2].replace('+ ', '')}</button></div>`;
}
function renderList() {
  const l = L(), all = rows(), pageRows = all.slice(0, (state.page + 1) * state.size);
  $('#list').innerHTML = pageRows.map(r => { const c = l.card(r), sel = state.selected.has(r.id); return `<div class="lrow ${sel ? 'sel' : ''}" data-act="open" data-id="${r.id}"><button class="cb ${sel ? 'on' : ''}" data-act="select" data-id="${r.id}" aria-label="Select"></button><div class="grow" style="min-width:0"><div class="ttl ell">${c.t}</div><div class="sub ell">${c.s}</div>${c.x ? `<div class="sub">${c.x}</div>` : ''}</div><div class="right">${c.rt}<div style="margin-top:3px">${c.rb || ''}</div></div><button class="dots" data-act="rowmenu" data-id="${r.id}" aria-label="${esc(l.one)} actions">${ICON.dots}</button></div>`; }).join('') || emptyHtml();
  if (all.length > pageRows.length) $('#list').innerHTML += `<button class="lrow" data-act="more" style="justify-content:center;color:var(--blue);font-weight:600">Show ${Math.min(state.size, all.length - pageRows.length)} more · ${all.length - pageRows.length} left</button>`;
}
function renderFoot() { $('#foot').innerHTML = pager(rows().length, L().noun); }
function renderBulk() { const n = state.selected.size, b = $('#bulk'); b.classList.toggle('open', n > 0); document.body.classList.toggle('hassel', n > 0); if (!n) return; b.innerHTML = `<b style="font-size:13px">${n} selected</b>${L().bulk(selRows()).join('')}<button class="btn btn-icon btn-sm" data-act="clearsel" aria-label="Clear selection">✕</button>`; }

// ---------- dialogs
const dlgHead = (over, title) => `<div class="hd"><div class="t-overline">${over}</div><h2 style="font-size:18px">${title}</h2></div>`;
const dlgFoot = (go, label, danger) => `<div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn ${danger ? 'btn-secondary' : 'btn-primary'}" style="${danger ? 'color:var(--t-out)' : ''}" data-act="${go}">${label}</button></div>`;
const confirmDlg = (over, title, text, go, label) => openDialog(`${dlgHead(over, title)}<div class="bd"><div class="t-small" style="line-height:1.5">${text}</div></div>${dlgFoot(go, label, true)}`);
function msgDialog(ids) {
  state.target = ids; const l = L(), n = ids.length;
  openDialog(`${dlgHead(plural(n, l.one, l.noun), 'Message')}<div class="bd">${field('Send by', `<select id="m-ch">${l.key === 'crew' ? opt('SMS', 'SMS', 'SMS') + opt('Email', 'Email', '') : opt('Email', 'Email', 'Email')}</select>`)}${field('Message', `<textarea id="m-text" placeholder="${l.key === 'crew' ? 'e.g. Truck leaves 06:30 Tuesday, Dock B' : 'e.g. Can you confirm the return date?'}"></textarea>`)}</div>${dlgFoot('msggo', 'Send')}`, d => $('#m-text', d).focus());
}
function jobMenu(el, title, go) { openMenu(el, title, SHIFTS.filter(s => s.date <= '2026-11-14' || s.j === 3).map((s, i) => ({ label:`${JOBS[s.j][0]} ${s.label}`, small:`${fmtDay(s.date)} ${s.time}`, act:go, args:`data-i="${SHIFTS.indexOf(s)}"` }))); }

// ---------- actions
function multiMenu(el, key) {
  const f = L().filters.find(x => x[0] === key), counts = countBy(D().filter(L().segs[0][2]), f[2]);
  openMenu(el, f[1], [...Object.keys(counts).sort().map(o => ({ label:o, act:'ftoggle', args:`data-k="${key}" data-v="${esc(o)}"`, on:state.f[key].includes(o), small:String(counts[o]) })), '-', { label:'Clear', act:'fclear', args:`data-k="${key}"` }]);
}
function skipNote(skipped, why) { return skipped ? ` · ${skipped} skipped (${why})` : ''; }
function act(name, el, ev) {
  const id = el.dataset.id, r = id ? rec(id) : null, l = L();
  switch (name) {
    case 'close': closeLayer(); break;
    case 'noop': closeLayer(); toast('Not part of this prototype'); break;
    case 'toast': closeLayer(); toast(el.dataset.m); break;
    case 'new': closeLayer(); toast(`Opens the ${l.primary.replace('+ ', '')} form`); break;
    case 'nav': closeLayer(); { const k = el.dataset.k; if (k !== state.cur) { switchTo(k); state.pushNext = true; render(); } } break;
    case 'listsheet': openMenu(el, 'People', ORDER.map(k => ({ label:LISTS[k].title, act:'nav', args:`data-k="${k}"`, on:k === state.cur, small:String(DATA[k].filter(live).length) }))); break;
    case 'seg': state.seg = el.dataset.k; state.page = 0; state.savedView = null; state.selected.clear(); state.pushNext = true; render(); break;
    case 'sort': if (state.sort === el.dataset.k) state.dir = state.dir === 'asc' ? 'desc' : 'asc'; else { state.sort = el.dataset.k; state.dir = 'asc'; } render(); break;
    case 'page': state.page = Math.max(0, state.page + +el.dataset.d); render(); break;
    case 'more': state.page++; render(); break;
    case 'fmenu': multiMenu(el, el.dataset.k); break;
    case 'ftoggle': { const a = state.f[el.dataset.k], v = el.dataset.v, i = a.indexOf(v); i >= 0 ? a.splice(i, 1) : a.push(v); state.page = 0; state.savedView = null; render(); const w = $(`#fwords .fw[data-k="${el.dataset.k}"]`); if (w) multiMenu(w, el.dataset.k); break; }
    case 'fclear': state.f[el.dataset.k] = []; closeLayer(); render(); break;
    case 'clearf': Object.assign(state, { f:fresh(state.cur).f, q:'', savedView:null, page:0 }); $('#q').value = ''; closeLayer(); render(); break;
    case 'viewsmenu': openMenu(el, 'Views', [{ sh:'Saved views · each one is a URL you can share' }, ...VIEWS[state.cur].map((v, i) => ({ label:v.name, act:'applyview', args:`data-i="${i}"`, on:state.savedView === v.name })), '-', { label:'Save current view…', act:'saveview' }, ...(state.savedView ? [{ label:'Clear view', act:'clearf' }] : [])]); break;
    case 'applyview': { const v = VIEWS[state.cur][+el.dataset.i]; Object.assign(state, { f:{ ...fresh(state.cur).f, ...(v.f || {}) }, seg:v.seg || 'all', savedView:v.name, page:0, q:'' }); $('#q').value = ''; closeLayer(); state.pushNext = true; render(); toast(`View “${v.name}” · the filters are in the URL, so the link is the view`); break; }
    case 'saveview': closeLayer(); openDialog(`${dlgHead('Views', 'Save current view')}<div class="bd">${field('Name', `<input id="v-name" placeholder="e.g. Free Tue – Fri" value="">`)}<label class="ib t-small" style="gap:8px;margin-top:10px;cursor:pointer"><span class="sw" data-act="sw"><i></i></span>Make this my default for ${l.title}</label></div>${dlgFoot('saveviewgo', 'Save')}`, d => $('#v-name', d).focus()); break;
    case 'sw': el.classList.toggle('on'); break;
    case 'saveviewgo': { const n = $('#v-name', body).value.trim() || 'Untitled view'; VIEWS[state.cur].push({ name:n, f:JSON.parse(JSON.stringify(state.f)), seg:state.seg }); state.savedView = n; closeLayer(); render(); toast(`Saved “${n}”`); break; }
    case 'pagemenu': { const items = l.pageMenu(); if (isPhone()) items.unshift({ sh:'Switch list' }, ...ORDER.filter(k => k !== state.cur).map(k => ({ label:LISTS[k].title, act:'nav', args:`data-k="${k}"`, small:String(DATA[k].filter(live).length) })), '-'); openMenu(el, l.title, items); break; }
    case 'colsmenu': openMenu(el, 'Columns', [...l.cols.filter(c => c.opt).map(c => ({ label:c.label, act:'coltoggle', args:`data-c="${c.k}"`, on:state.cols[c.k] })), { sh:'The default columns are always shown' }]); break;
    case 'coltoggle': state.cols[el.dataset.c] = !state.cols[el.dataset.c]; closeLayer(); render(); break;
    case 'open': { if (ev && ev.target.closest('.cb,.dots,a')) break; closeLayer(); const t = { crew:'crew', clients:'client', suppliers:'supplier' }[state.cur]; try { location.href = 'https://claude.ai/artifact/D8UV81TDFpMEeUBxf2apUX#' + t; } catch (e) {} break; }
    case 'select': { if (ev && ev.shiftKey && state.lastSel) { const order = rows().map(x => x.id), a = order.indexOf(state.lastSel), b = order.indexOf(id); for (const k of order.slice(Math.min(a, b), Math.max(a, b) + 1)) state.selected.add(k); } else state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id); state.lastSel = id; render(); break; }
    case 'selall': { const pr = rows().slice(state.page * state.size, (state.page + 1) * state.size), all = pr.every(x => state.selected.has(x.id)); pr.forEach(x => all ? state.selected.delete(x.id) : state.selected.add(x.id)); render(); break; }
    case 'clearsel': state.selected.clear(); render(); break;
    case 'rowmenu': openMenu(el, r.name, l.rowMenu(r)); break;
    // ---- messaging (crew, suppliers)
    case 'rmsg': closeLayer(); msgDialog([id]); break;
    case 'bmsg': msgDialog([...state.selected]); break;
    case 'msggo': { const ids = state.target, ch = $('#m-ch', body).value, who = D().filter(x => ids.includes(x.id)), skip = who.filter(x => ch === 'Email' ? !x.email : !x.phone).length; closeLayer(); state.selected.clear(); render(); toast(`${ch} sent to ${who.length - skip} ${who.length - skip === 1 ? l.one : l.noun}${skipNote(skip, ch === 'Email' ? 'no email on file' : 'no phone')}`); break; }
    // ---- crew
    case 'rassign': closeLayer(); state.target = [id]; jobMenu(el, `Assign ${r.name}`, 'assigngo'); break;
    case 'bassign': state.target = [...state.selected]; jobMenu(el, `Assign ${state.selected.size} to a job`, 'assigngo'); break;
    case 'assigngo': { const s = SHIFTS[+el.dataset.i], undo = snapshot(); let n = 0, skip = 0, dup = 0; for (const x of D().filter(x => state.target.includes(x.id))) { if (!cd(x).on || cd(x).leave) { skip++; continue; } if (x.calls.some(c => c.date === s.date && c.time === s.time)) { dup++; continue; } x.calls.push({ ...s, job:JOBS[s.j][0], state:'OFFERED', offeredOn:TODAY }); n++; } closeLayer(); state.selected.clear(); render(); toast(`Offered ${JOBS[s.j][0]} ${s.label} to ${n} · they show as Unconfirmed until they answer${skipNote(skip, 'inactive or on leave')}${dup ? ` · ${dup} already on it` : ''}`, undo); break; }
    case 'rresend': { const undo = snapshot(); cd(r).off.forEach(c => { const m = r.calls.find(x => x.job === c.job && x.time === c.time && x.date === c.date); m.offeredOn = TODAY; }); closeLayer(); render(); toast(`Offer resent to ${esc(r.name)} by SMS`, undo); break; }
    case 'rdeact': closeLayer(); state.target = [id]; confirmDlg('Deactivate', `Deactivate ${esc(r.name)}?`, cd(r).onJob ? `${esc(r.name)} has confirmed calls this week, so they stay active until those finish.` : `${esc(r.name)} drops out of offers and the planner. Their history, timesheets and rates stay. Reactivate any time.`, 'deactgo', 'Deactivate'); break;
    case 'bdeact': closeLayer(); state.target = [...state.selected]; confirmDlg('Deactivate', `Deactivate ${state.selected.size} crew?`, `They drop out of offers and the planner; history, timesheets and rates stay. Anyone with a confirmed call this week stays active until it finishes.`, 'deactgo', `Deactivate ${state.selected.size}`); break;
    case 'deactgo': { const undo = snapshot(); let n = 0, stay = []; for (const x of D().filter(x => state.target.includes(x.id))) { if (cd(x).onJob) { stay.push(x.name); continue; } x.status = 'INACTIVE'; n++; } closeLayer(); state.selected.clear(); render(); toast(`${n} deactivated${stay.length ? ` · ${stay.length} on a job stay${stay.length === 1 ? 's' : ''} (${stay.slice(0, 2).join(', ')}${stay.length > 2 ? '…' : ''})` : ''}`, n ? undo : null); break; }
    case 'rlog': closeLayer(); openDialog(`${dlgHead('Timesheets', 'Log time')}<div class="bd">${field('Crew member', `<select id="lt-who">${DATA.crew.filter(live).map(c => opt(c.id, esc(c.name), r && r.id === c.id ? c.id : '')).join('')}</select>`)}${field('Assignment', `<select id="lt-job">${JOBS.map(j => opt(j[0], `${j[0]} ${j[1]}`, '#2341')).join('')}</select>`)}<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">${field('Date', `<input id="lt-d" value="2026-11-09">`)}${field('Start', `<input id="lt-s" value="08:00">`)}${field('End', `<input id="lt-e" value="17:00">`)}</div>${field('Break (minutes)', `<input id="lt-b" value="30">`)}${field('Notes', `<textarea id="lt-n" placeholder="Optional"></textarea>`)}</div>${dlgFoot('loggo', 'Log time')}`); break;
    case 'loggo': { const undo = snapshot(), c = rec($('#lt-who', body).value), toMin = v => { const [h, m] = v.split(':'); return (+h) * 60 + (+m || 0); }, hrs = Math.max(0, (toMin($('#lt-e', body).value) - toMin($('#lt-s', body).value) - (+$('#lt-b', body).value || 0)) / 60); DATA.meta.pendingTs++; closeLayer(); render(); toast(`Logged ${hrs} h for ${esc(c.name)} · waiting in Timesheets for approval`, undo); break; }
    case 'rexp': closeLayer(); openDialog(`${dlgHead('Timesheets', 'Export timesheets')}<div class="bd"><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${field('From', `<input value="2026-11-03">`)}${field('To', `<input value="2026-11-09">`)}</div><div class="t-small muted" style="margin-top:10px">Approved entries only · one CSV row per entry.</div></div>${dlgFoot('rexpgo', 'Export')}`); break;
    case 'rexpgo': closeLayer(); toast('Exporting approved timesheets, 3 – 9 Nov, as CSV'); break;
    // ---- shared by all three
    case 'rreact': { const undo = snapshot(); if (state.cur === 'crew') r.status = 'ACTIVE'; else r.active = true; closeLayer(); render(); toast(`${esc(r.name)} reactivated`, undo); break; }
    case 'rtag': case 'btag': closeLayer(); state.target = name === 'rtag' ? [id] : [...state.selected]; openDialog(`${dlgHead(plural(state.target.length, l.one, l.noun), 'Add a tag')}<div class="bd">${field('Tag', `<input id="t-tag" placeholder="e.g. vip" value="">`)}</div>${dlgFoot('taggo', 'Add')}`, d => $('#t-tag', d).focus()); break;
    case 'taggo': { const t = $('#t-tag', body).value.trim(); if (!t) break; const undo = snapshot(); let n = 0; D().filter(x => state.target.includes(x.id)).forEach(x => { if (!x.tags.includes(t)) { x.tags.push(t); n++; } }); closeLayer(); state.selected.clear(); render(); toast(`“${esc(t)}” added to ${plural(n, l.one, l.noun)}`, undo); break; }
    case 'bexport': { const n = state.selected.size; closeLayer(); toast(`Exporting ${plural(n, l.one, l.noun)} as CSV`); break; }
    case 'rarch': { closeLayer(); const open = r.openJobs || r.openOrders || r.onHire; if (open) { toast(`${esc(r.name)} has ${r.openJobs ? plural(r.openJobs, 'open job') : r.openOrders ? plural(r.openOrders, 'open order') : r.onHire + ' items on hire'} · finish or move ${r.openJobs ? 'it' : 'them'} first`); break; } state.target = [id]; confirmDlg('Archive', `Archive ${esc(r.name)}?`, `They leave the active list and the pickers, but keep their history, ${state.cur === 'clients' ? 'jobs, quotes and invoices' : 'orders and spend'}. Reactivate from the Archived segment.`, 'archgo', 'Archive'); break; }
    case 'barch': closeLayer(); state.target = [...state.selected]; confirmDlg('Archive', `Archive ${plural(state.selected.size, l.one, l.noun)}?`, `They leave the active list and the pickers, but keep their history. Anyone with an open ${state.cur === 'clients' ? 'job' : 'order or hire'} stays active.`, 'archgo', `Archive ${state.selected.size}`); break;
    case 'archgo': { const undo = snapshot(); let n = 0, stay = []; for (const x of D().filter(x => state.target.includes(x.id))) { if (x.openJobs || x.openOrders || x.onHire) { stay.push(x.name); continue; } x.active = false; n++; } closeLayer(); state.selected.clear(); render(); toast(`${n} archived${stay.length ? ` · ${stay.length} with open work stay${stay.length === 1 ? 's' : ''} (${stay.slice(0, 2).join(', ')}${stay.length > 2 ? '…' : ''})` : ''}`, n ? undo : null); break; }
    // ---- clients: merge
    case 'bmerge': { closeLayer(); const sel = selRows(); openDialog(`${dlgHead(plural(sel.length, 'client'), 'Merge clients')}<div class="bd"><div class="t-small muted" style="margin-bottom:8px">Keep which record? Jobs, quotes, invoices and contacts from the others move onto it.</div>${sel.map((x, i) => `<label class="rad"><input type="radio" name="keep" value="${x.id}" ${i === 0 ? 'checked' : ''}>${esc(x.name)}<span class="sub">${x.openJobs ? plural(x.openJobs, 'open job') : 'no open jobs'} · ${XERO[x.xero][0]} in Xero</span></label>`).join('')}</div>${dlgFoot('mergego', `Merge ${sel.length}`, true)}`); break; }
    case 'mergego': { const undo = snapshot(), sel = selRows(), keep = sel.find(x => x.id === body.querySelector('input[name=keep]:checked').value), gone = sel.filter(x => x !== keep); gone.forEach(g => { keep.openJobs += g.openJobs; keep.jobNums.push(...g.jobNums); keep.quoted += g.quoted; keep.outstanding += g.outstanding; keep.lifetime += g.lifetime; keep.tags = [...new Set([...keep.tags, ...g.tags])]; if (g.lastJob > keep.lastJob) keep.lastJob = g.lastJob; }); DATA.clients = DATA.clients.filter(x => !gone.includes(x)); closeLayer(); state.selected.clear(); render(); toast(`${gone.length + 1} clients merged into ${esc(keep.name)}`, undo); break; }
    case 'undo': if (state.undo) { state.undo(); state.undo = null; } $('#toast').classList.remove('open'); break;
    case 'toastclose': $('#toast').classList.remove('open'); break;
  }
}
document.addEventListener('input', ev => { if (ev.target.id === 'q') { state.q = ev.target.value; state.page = 0; state.savedView = null; render(); } });
window.addEventListener('popstate', () => { if (fromHash()) render(); });
if (!fromHash()) $('#q').value = '';
render();
