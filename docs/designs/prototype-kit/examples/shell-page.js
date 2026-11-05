// ---------- Shell · data (the app shell: one NAV table drives the sidebar, the rail, the More sheet and the @ pages in the palette)
const TODAY = '2026-11-09';
const A = id => 'https://claude.ai/artifact/' + id;
const U = {
  HOME:A('3d6zqfosL5hYRvXLBYLnhR'), JOBS:A('A7SMPtpTr3aedUDEnuSaxd'), OV:A('RatKsWfTmDJLJHmn6mb7Zo'), EQ:A('BdwR4bNbiNMLSvfRAByEwC'), LOG:A('E36tnBkGL9obdikUQ5mbXf'),
  FIN:A('7ByfxnbtsgQTJdiwvvo1CY'), WH:A('Mt8p55xkPkkexVWPC5eaGU'), ASSETS:A('89PDTuMiovgP9i3h4MJ1Tw'), ASSET:A('Rr5rwirCUMRy8gf5G6Vz7s'), MODEL:A('47miWruJVsednbzrFPij2b'),
  PEOPLE:A('LPdsNGb4CRMfS6qk7j7Fsa'), GEAR:A('D7N5PmXKrkcY2gzZXWeuvc'), PLAN:A('AKkgWzJ2gVR3dJTWnMB2Ui'), SCAN:A('8Q2HVoRhLbSLz1Q9mCtayX'), FINHUB:A('5VnYTVW2pdA5r1qBRvdrom'),
  SET:A('Q3TeWuQPjzvXbAtmUV8Hg8'), FORMS:A('REMbu5TYg5Nx6iJJoPLuGy'), WIZ:A('GgtKxc5WZP33gXihgFTB9B'), FLOOR:A('6xqFcEZZk49w86p5pAsisA'), PACK:A('HSAZTyzfjG2A7sCjUe9wsM'),
  SCHEDULE:'https://claude.ai/artifact/49jbSumcZhVdCU9ZA3nqdm', RECPEOPLE:'https://claude.ai/artifact/D8UV81TDFpMEeUBxf2apUX', RECGEAR:'https://claude.ai/artifact/PDsjUdku2seVZAWfNC6W61',
};
const rnd = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(7);

// Icons: 24px stroke set, drawn once, used by the sidebar, rail, bottom nav, More sheet and top bar.
const PATH = {
  home:'M3 11 12 3l9 8M5 9.5V20h5v-6h4v6h5V9.5', jobs:'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  finance:'M3 21h18M5 10v8M9 10v8M15 10v8M19 10v8M12 3 3 8h18z', schedule:'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  crew:'M16 20v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M20 20v-2a4 4 0 0 0-3-3.8M16 4.2a3.5 3.5 0 0 1 0 6.6',
  assets:'m12 3 8 4.5v9L12 21l-8-4.5v-9zM4 7.5 12 12l8-4.5M12 12v9', warehouse:'M3 10 12 4l9 6v10H3zM8 20v-6h8v6',
  tt:'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4', maint:'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z',
  clients:'M4 21V8l8-5 8 5v13M9 21v-6h6v6M9 11h.01M15 11h.01', suppliers:'M2 6h11v10H2zM13 9h4l3 3v4h-7M6.5 19.5a1.5 1.5 0 1 0 0-.01M17.5 19.5a1.5 1.5 0 1 0 0-.01',
  locations:'M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5', activity:'M3 12h4l3-8 4 16 3-8h4',
  settings:'M4 7h9M17 7h3M4 17h3M11 17h9M15 7a2 2 0 1 0 0 .01M9 17a2 2 0 1 0 0 .01', scan:'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10',
  search:'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3', bell:'M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 21a2 2 0 0 0 4 0',
  mira:'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z', more:'M5 12h.01M12 12h.01M19 12h.01',
};
const ic = (k, s = 16, sw = 1.9) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${PATH[k]}"/></svg>`;

// Who is signed in. Permissions follow convex/lib/permissionsCore.ts (manager / warehouse / viewer); the nav gates on `read` of the item's resource.
const ALLRES = ['asset','model','kit','project','client','warehouse','testTag','maintenance','location','supplier','crew','reports','invoice','orgSettings','orgMembers'];
const PERSONAS = {
  jayden:{ name:'Jayden Cole', first:'Jayden', ini:'JC', role:'Manager', email:'jayden@twotoned.com.au', read:ALLRES.filter(r => r !== 'orgMembers').concat(['orgMembers']), create:['project','asset','client','kit','model'], crew:true },
  sam:{ name:'Sam Okafor', first:'Sam', ini:'SO', role:'Warehouse', email:'sam@twotoned.com.au', read:ALLRES.filter(r => !/^org/.test(r)), create:[], crew:true },
  viewer:{ name:'Guest Viewer', first:'there', ini:'GV', role:'Viewer', email:'guest@twotoned.com.au', read:ALLRES.filter(r => !/^org/.test(r) && r !== 'warehouse'), create:[], crew:false },
};
const ORGS = [{ id:'tt', name:'Two Toned Productions', ini:'TT', role:'Manager' }, { id:'hs', name:'Harbour Staging Co', ini:'HS', role:'Viewer' }];

// NAV — the ONE table. g: 0 run the work, 1 crew and gear, 2 more. res: the resource whose `read` gates the item (null = everyone).
const NAV = [
  { k:'home', l:'Home', hue:'blue', g:0, url:U.HOME, i:'home', res:null },
  { k:'jobs', l:'Jobs', hue:'blue', g:0, url:U.JOBS, i:'jobs', res:'project', count:'38', subs:[['Templates', U.JOBS, 'project'], ['Overbookings', U.GEAR, 'project', ['err','5 overbooked']]] },
  { k:'finance', l:'Finance', hue:'green', g:0, url:U.FINHUB, i:'finance', res:'invoice', flag:['err','1 overdue'] },
  { k:'schedule', l:'Schedule', hue:'green', g:0, url:U.SCHEDULE, i:'schedule', res:'asset' },
  { k:'crew', l:'Crew', hue:'purple', g:1, url:U.PEOPLE, i:'crew', res:'crew', count:'28', subs:[['Planner', U.PLAN], ['Timesheets', U.PLAN]] },
  { k:'assets', l:'Assets', hue:'amber', g:1, url:U.ASSETS, i:'assets', res:'asset', count:'605', subs:[['Models', U.GEAR, 'model'], ['Categories', U.RECGEAR, 'model'], ['Kits', U.GEAR, 'kit'], ['Fleet ROI', U.GEAR, 'model'], ['Sales stock', U.GEAR, 'model']] },
  { k:'warehouse', l:'Warehouse', hue:'teal', g:1, url:U.FLOOR, i:'warehouse', res:'warehouse', subs:[['Returns', U.FLOOR, 'warehouse', ['warn','2 overdue']]] },
  { k:'tt', l:'Test & tag', hue:'teal', g:1, url:U.GEAR, i:'tt', res:'testTag', flag:['warn','4 overdue'], subs:[['Registry', U.GEAR], ['Quick test', U.SCAN], ['Reports', U.GEAR, 'reports']] },
  { k:'maint', l:'Maintenance', hue:'coral', g:1, url:U.GEAR, i:'maint', res:'maintenance', flag:['warn','5 overdue'], count:'20 open' },
  { k:'clients', l:'Clients', hue:null, g:2, url:U.PEOPLE, i:'clients', res:'client', count:'26' },
  { k:'suppliers', l:'Suppliers', hue:null, g:2, url:U.PEOPLE, i:'suppliers', res:'supplier', count:'13' },
  { k:'locations', l:'Locations', hue:null, g:2, url:U.GEAR, i:'locations', res:'location', count:'13' },
  { k:'activity', l:'Activity', hue:null, g:2, url:U.HOME, i:'activity', res:'reports' },
];
const SETTINGS = { k:'settings', l:'Settings', url:U.SET, i:'settings', subs:[['Team', U.SET], ['Branding', U.SET], ['Integrations', U.SET], ['Mira', U.SET]] };

// Pages the prototype can sit on, so the sidebar's active state, the accordion and the breadcrumb trail can be seen.
const PAGES = {
  home:{ label:'Home', nav:'home', crumbs:[['Home']], title:'Home', sub:() => '9 Nov', bnav:'home' },
  job:{ label:'Job › Equipment', nav:'jobs', crumbs:[['Jobs', U.JOBS], ['#2341 Hilton Sydney gala dinner', U.OV], ['Equipment']], title:'#2341 Hilton gala dinner', sub:() => 'Equipment · Confirmed · 12 – 14 Nov', back:U.JOBS, bnav:'jobs',
    h1:'Hilton Sydney gala dinner', hsub:'#2341 · Hilton Sydney · 12 – 14 Nov · Jayden Cole', stub:['Equipment tab', U.EQ, 'The job page, its tabs and the Equipment lines render here.'] },
  asset:{ label:'Asset › AURA-01', nav:'assets', crumbs:[['Assets', U.ASSETS], ['AURA-01 Martin MAC Aura XB']], title:'AURA-01', sub:() => 'Martin MAC Aura XB · Reserved on #2341', back:U.ASSETS, bnav:'more',
    h1:'AURA-01', hsub:'Martin MAC Aura XB · Reserved on #2341 · LX-02', stub:['Asset detail', U.ASSET, 'The record page renders here: overview, history, maintenance, files.'] },
  crew:{ label:'Crew › Planner', nav:'crew', sub_:'Planner', crumbs:[['Crew', U.PEOPLE], ['Planner']], title:'Planner', sub:() => 'Crew · week of 9 Nov', back:U.PEOPLE, bnav:'more',
    h1:'Planner', hsub:'Crew · week of 9 Nov', stub:['Crew planner', U.PLAN, 'The lanes, offers and confirmations render here.'] },
  settings:{ label:'Settings › Team', nav:'settings', sub_:'Team', crumbs:[['Settings', U.SET], ['Team']], title:'Team', sub:() => 'Settings · 11 members', back:U.SET, bnav:'more',
    h1:'Team', hsub:'Settings · 11 members · 2 invitations', stub:['Settings › Team', U.SET, 'Members, invitations, join policy and the permission matrix render here.'] },
};

// Notifications (same fixture as the Home prototype's Notifications view; 6 unread)
const NOTES = [
  { id:'n1', day:'Today', time:'08:30', type:'Overdue return', cls:'err', title:'Opera House town hall is 2 days overdue', desc:'Due back 7 Nov · 41 items still out', href:U.FLOOR },
  { id:'n2', day:'Today', time:'08:30', type:'Overdue return', cls:'err', title:'Canva sales kickoff is 1 day overdue', desc:'Due back 8 Nov · 26 items still out', href:U.FLOOR },
  { id:'n3', day:'Today', time:'07:45', type:'Crew', cls:'warn', title:'3 crew offers are waiting on a reply', desc:'#2341 Hilton gala · Oli Martin, Jess Tran, Dev Patel', href:U.LOG },
  { id:'n6', day:'Today', time:'06:00', type:'Upcoming', cls:'info', title:'Hilton Sydney gala dinner starts Wednesday', desc:'12 – 14 Nov · truck leaves 11 Nov, 06:30', href:U.OV },
  { id:'n4', day:'Yesterday', time:'17:10', type:'Timesheets', cls:'warn', title:'2 timesheets are waiting for approval', desc:'Dan Wu, Ash Reyes · #2339 ICC trade show', href:U.PLAN },
  { id:'n5', day:'7 Nov', time:'09:00', type:'Maintenance', cls:'warn', title:'Lamp replacement is overdue', desc:'MAC Aura PXL L-0004 · was due 6 Nov', href:U.ASSET },
  { id:'n7', day:'6 Nov', time:'11:20', type:'Invitation', cls:'info', title:'Ari Nguyen hasn’t accepted the invitation', desc:'Sent 4 Nov', href:U.SET, read:true },
  { id:'n9', day:'3 Nov', time:'08:00', type:'Maintenance', cls:'warn', title:'Shure ULXD4Q kit K-0042 is due for service', desc:'Service was due 3 Nov', href:U.ASSET, read:true },
];

// ---------- Palette fixture: the things you can jump to, by number or by name
const J = (n, name, client, a, b, st, cls, flag) => ({ t:'job', id:'#' + n, name, sub:client, a, b, st, cls, flag, url:U.OV, num:n });
const JOBS = [
  J('2341','Hilton Sydney gala dinner','Hilton Sydney','2026-11-12','2026-11-14','Confirmed','info'),
  J('2350','Qantas awards night','Qantas','2026-11-13','2026-11-14','Quoted','info'),
  J('2338','Corporate AGM','Atlassian','2026-11-21','2026-11-21','Awaiting payment','warn'),
  J('2340','Launch night','Live Nation','2026-11-09','2026-11-10','Prepping','info'),
  J('2347','Ogilvy product launch','Ogilvy','2026-11-09','2026-11-11','Prepping','info'),
  J('2344','Atlassian town hall','Atlassian','2026-11-08','2026-11-13','Out','live'),
  J('2339','ICC Sydney trade show','ICC Sydney','2026-11-06','2026-11-12','Out','live'),
  J('2331','Sydney Opera House town hall','Sydney Opera House','2026-11-04','2026-11-07','Out · 2d overdue','err'),
  J('2336','Canva sales kickoff','Canva','2026-11-05','2026-11-08','Out · 1d overdue','err'),
  J('2342','Red Bull activation','Red Bull','2026-11-07','2026-11-10','Out','live'),
  J('2352','UNSW graduation','UNSW','2026-11-24','2026-11-25','Quoting','info'),
];
const AS = (tag, name, st, cls, sub, alt) => ({ t:'asset', id:tag, name, sub, st, cls, url:U.ASSET, alt:alt || '' });
const ASSETS = [
  AS('AURA-01','Martin MAC Aura XB','Reserved','info','on #2341 · LX-02'), AS('AURA-02','Martin MAC Aura XB','T&T overdue','warn','Warehouse A · B2'),
  AS('AURA-03','Martin MAC Aura XB','Available','ok','Warehouse A · B2'), AS('AURA-06','Martin MAC Aura XB','In repair','warn','fan fault · awaiting parts'),
  AS('AURA-10','Martin MAC Aura XB','T&T overdue','warn','Warehouse A · B2'), AS('L-0001','Martin MAC Aura PXL','Available','ok','Warehouse A · A3-14'),
  AS('L-0007','Martin MAC Aura PXL','Out','live','on #2339'), AS('SK-0012','Sennheiser EW-DX SK beltpack','Available','ok','Warehouse A · B2'),
  AS('A-0301','Sennheiser EM4 receiver','Available','ok','Warehouse A · B2'), AS('K-0042','Shure ULXD4Q kit','Due for service','warn','Warehouse A'),
  AS('V-0011','Barco UDX-4K32','Available','ok','Warehouse A · A3-14'), AS('LX-02','Lighting road case','Packed','info','for #2341'),
  AS('LX-04','Lighting road case','Available','ok','Warehouse A'), AS('VID-04','Video road case','Available','ok','Warehouse A'), AS('BATT-01','Battery case','Available','ok','Warehouse A · B2'),
];
const MODELS = ['Martin MAC Aura XB|12 units','Martin MAC Aura PXL|8 units','d&b Y8|12 units','Sennheiser EW-DX SK|24 units','Barco UDX-4K32|3 units','Shure ULXD4Q|6 units'].map(s => ({ t:'model', id:'Model', name:s.split('|')[0], sub:s.split('|')[1], url:U.MODEL }));
const CLIENTS = [['Hilton Sydney','contact Priya Shah'],['Qantas','1 quote out'],['Atlassian','2 jobs'],['Live Nation','1 job'],['Canva','1 job'],['ICC Sydney','1 job'],['Ogilvy','1 job'],['Red Bull','1 job'],['UNSW','1 quote']].map(([n, s]) => ({ t:'client', id:'Client', name:n, sub:s, url:U.RECPEOPLE, alt:n === 'Hilton Sydney' ? 'priya shah' : '' }));
const CREW = ['Oli Martin','Sam Kowalski','Jess Tran','Dev Patel','Mia Rossi','Tom Brennan','Ari Nguyen','Lena Fischer','Dan Wu','Ash Reyes'].map(n => ({ t:'crew', id:'Crew', name:n, sub:'', url:U.RECPEOPLE }));
const SUPPLIERS = ['Scene Change','Big Picture','Chameleon Touring'].map(n => ({ t:'supplier', id:'Supplier', name:n, sub:'', url:U.RECPEOPLE }));
const LOCS = [['Warehouse A','654 assets'],['B2','bin · Warehouse A'],['A3-14','bin · Warehouse A']].map(([n, s]) => ({ t:'location', id:'Location', name:n, sub:s, url:U.RECGEAR }));
const ENTITIES = [...JOBS, ...ASSETS, ...MODELS, ...CLIENTS, ...CREW, ...SUPPLIERS, ...LOCS];
const GROUPS = { job:['Jobs', U.JOBS], asset:['Assets', U.ASSETS], model:['Models', U.GEAR], client:['Clients', U.PEOPLE], crew:['Crew', U.PEOPLE], supplier:['Suppliers', U.PEOPLE], location:['Locations', U.GEAR] };
const keyOf = e => e.t + ':' + e.id + ':' + e.name;

// ---------- State
const state = {
  page:'home', persona:'jayden', org:'tt', collapsed:false, theme:'dark', openSubs:new Set(), bnav:'d1',
  read:new Set(NOTES.filter(n => n.read).map(n => n.id)),
  mira:false, miraStep:'ask', miraExtra:[], miraWrite:true, camSheet:false,
  recent:['job:#2341:Hilton Sydney gala dinner', 'asset:AURA-01:Martin MAC Aura XB', 'client:Client:Hilton Sydney', 'job:#2350:Qantas awards night', 'asset:LX-02:Lighting road case'],
  pal:{ q:'', i:0, items:[] }, moreDrill:null, undo:null,
};
try { const t = localStorage.getItem('shell-theme'), c = localStorage.getItem('shell-collapsed'); if (t === 'light') state.theme = 'light'; if (c === '1') state.collapsed = true; } catch (e) {}
const org = () => ORGS.find(o => o.id === state.org);
const persona = () => PERSONAS[state.persona];
const perms = () => state.org === 'hs' ? PERSONAS.viewer : persona();
const can = res => !res || perms().read.includes(res);
const canCreate = res => perms().create.includes(res);
const canSettings = () => can('orgSettings') || can('orgMembers');
const unreadN = () => NOTES.filter(n => !state.read.has(n.id)).length;
const autoRail = () => !isPhone() && window.innerWidth <= 1023;
const railMode = () => !isPhone() && (state.collapsed || window.innerWidth <= 1023);
const pg = () => PAGES[state.page];
const hueVar = h => h ? `var(--${h})` : 'var(--muted)';
const dw = (cls, w) => `<span class="dotw ${cls}">${w}</span>`;
const navVisible = () => NAV.filter(n => can(n.res));
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------- Sidebar / rail
function itemHtml(n) {
  const subs = (n.subs || []).filter(s => can(s[2]));
  const P = pg(), on = P.nav === n.k, open = state.openSubs.has(n.k) || on;
  return `<div class="ng ${open && subs.length ? 'open' : ''}" data-k="${n.k}"><a class="ni ${on ? (P.sub_ ? 'cur' : 'on') : ''}" href="${n.url}" style="--h:${hueVar(n.hue)}" ${subs.length ? `data-act="navrow" data-k="${n.k}"` : ''} title="${n.l}" ${on ? 'aria-current="page"' : ''}><span class="ic">${ic(n.i)}</span><span class="lbl">${n.l}</span></a>${subs.length ? `<button class="subt" data-act="subtoggle" data-k="${n.k}" aria-label="Show ${n.l} pages" aria-expanded="${open}">›</button><div class="subs">${subs.map(s => `<a class="si ${on && P.sub_ === s[0] ? 'on' : ''}" href="${s[1]}">${s[0]}</a>`).join('')}</div>` : ''}</div>`;
}
function sidebarHtml() {
  const nav = navVisible(), g = i => nav.filter(n => n.g === i);
  const more = g(2), pm = perms(), o = org();
  const settingsOn = pg().nav === 'settings';
  return `<div class="brand"><a href="${U.HOME}" aria-label="RVLT Flow — Home"><span class="r">R</span><span class="bn">RVLT <span class="flow">Flow</span></span></a></div>
  <button class="orgrow" data-act="orgmenu" aria-haspopup="menu" aria-label="Organisation: ${esc(o.name)}" title="${esc(o.name)}"><span class="ot">${esc(o.name)}</span><span class="oi">${o.ini}</span><span class="car">▾</span></button>
  <nav class="sbscroll" aria-label="Main">
    <div class="ngrp">${g(0).map(itemHtml).join('')}</div>
    <div class="ngrp">${g(1).map(itemHtml).join('')}</div>
    ${more.length ? `<div class="ngrp more"><span class="ov">More</span>${more.map(itemHtml).join('')}</div>
    <div class="ngrp moreitem" style="display:none"><div class="ng"><button class="ni" data-act="fly" data-k="more" style="--h:var(--muted)" aria-haspopup="menu"><span class="ic">${ic('more')}</span><span class="lbl">More</span></button></div></div>` : ''}
  </nav>
  <div class="sbfoot">
    ${canSettings() ? `<div class="ng ${settingsOn ? 'open' : ''}"><a class="ni ${settingsOn && !pg().sub_ ? 'on' : ''}" href="${U.SET}" data-act="navrow" data-k="settings" style="--h:var(--muted)" title="Settings" ${settingsOn ? 'aria-current="page"' : ''}><span class="ic">${ic('settings')}</span><span class="lbl">Settings</span></a><button class="subt" data-act="subtoggle" data-k="settings" aria-label="Show Settings pages">›</button><div class="subs">${SETTINGS.subs.map(s => `<a class="si ${settingsOn && pg().sub_ === s[0] ? 'on' : ''}" href="${s[1]}">${s[0]}</a>`).join('')}</div></div>` : ''}
    <button class="userrow" data-act="usermenu" aria-haspopup="menu" aria-label="Account menu"><span class="avt">${pm === PERSONAS.viewer && state.org === 'hs' ? persona().ini : persona().ini}</span><span class="who"><b>${esc(persona().name)}</b><span>${state.org === 'hs' ? 'Viewer' : persona().role} · ${esc(o.ini)}</span></span></button>
    ${autoRail() ? '' : `<button class="colrow" data-act="collapse" aria-label="${state.collapsed ? 'Expand' : 'Collapse'} sidebar">${state.collapsed ? '<span>›</span>' : '<span class="t">‹ Collapse</span><span class="kbd">⌘B</span>'}</button>`}
  </div>`;
}

// ---------- Top bar, phone header, bottom nav
function crumbHtml() {
  const c = pg().crumbs;
  return c.map((s, i) => i === c.length - 1 ? `<b>${esc(s[0])}</b>` : `<a href="${s[1]}">${esc(s[0])}</a><span class="sep">›</span>`).join('');
}
function topbarHtml() {
  const n = unreadN();
  return `<nav class="crumb" aria-label="Breadcrumb">${crumbHtml()}</nav>
  <button class="tsearch" data-act="palette" aria-label="Search or jump to (⌘K)">${ic('search', 15)}<span class="t">Search or jump to…</span><span class="kbd">⌘K</span></button>
  <button class="tbtn ${state.mira ? 'on' : ''}" data-act="mira" aria-label="Ask Mira" aria-pressed="${state.mira}">${ic('mira', 15)}<span>Mira</span></button>
  <button class="tbtn" data-act="bell" aria-label="Notifications, ${n} unread" aria-haspopup="menu">${ic('bell', 15)}<span class="cnt ${n ? '' : 'zero'}">${n}</span></button>`;
}
function phoneheadHtml() {
  const P = pg(), n = unreadN();
  return `${P.back ? `<a class="btn btn-icon btn-lg back" href="${P.back}" aria-label="Back" style="color:var(--ink)">‹</a>` : ''}
  <div class="pt" style="${P.back ? 'padding-left:0' : ''}"><div class="ell">${esc(P.title)}</div><div class="ell t-micro muted" id="phonesub">${esc(P.sub())}</div></div>
  <button class="hb" data-act="palette" aria-label="Search">${ic('search', 20)}</button>
  <button class="hb" data-act="mira" aria-label="Ask Mira">${ic('mira', 20)}</button>
  <button class="hb" data-act="bell" aria-label="Notifications, ${n} unread">${ic('bell', 20)}<span class="cnt ${n ? '' : 'zero'}">${n}</span></button>
  <button class="btn btn-icon btn-lg" data-act="pagemenu" aria-label="Page actions">⋯</button>`;
}
function bottomnavHtml() {
  const P = pg(), can_w = can('warehouse'), alt = state.bnav === 'alt';
  const it = (k, href, i, label, extra = '') => `<a href="${href}" class="${P.bnav === k ? 'on' : ''}" ${extra}>${ic(i, 22, 1.8)}<span>${label}</span></a>`;
  const more = `<button class="${P.bnav === 'more' ? 'on' : ''}" data-act="more" aria-haspopup="dialog">${ic('more', 22, 2.6)}<span>More</span></button>`;
  if (alt) return it('home', U.HOME, 'home', 'Home') + it('jobs', U.JOBS, 'jobs', 'Jobs') + (can_w ? it('wh', U.FLOOR, 'warehouse', 'Warehouse') : '') + it('crew', U.PEOPLE, 'crew', 'Crew') + it('assets', U.ASSETS, 'assets', 'Assets');
  return it('home', U.HOME, 'home', 'Home') + it('jobs', U.JOBS, 'jobs', 'Jobs')
    + (can_w ? `<a href="${U.SCAN}" class="scanb" data-act="camera" aria-label="Scan"><span class="scan">${ic('scan', 24, 2)}</span><span class="lb">Scan</span></a>` : '')
    + (can_w ? it('wh', U.FLOOR, 'warehouse', 'Warehouse') : '') + more;
}

// ---------- Page body (a calm Home, or a stub that says which prototype renders here)
function pageHtml() {
  const P = pg(), p = persona();
  if (state.page === 'home') {
    const rows = [
      ['Blocking discussion','err','#2341','Hilton Sydney gala dinner · risk assessment not signed, prep is held','Overview ›',U.OV],
      ['Overdue invoice','err','INV-0038','Qantas · $8,400 · 12d overdue','Finance ›',U.FIN],
      ['Would be short','warn','L-PXL','Martin MAC Aura PXL · short 2 on 13 – 14 Nov if #2350 confirms','Overbookings ›',U.GEAR],
      ['Quote expires Thu','warn','#2350','Qantas awards night · $41,200 · valid until 12 Nov','Finance ›',U.FIN],
    ].filter(r => can(r[0] === 'Overdue invoice' || r[0] === 'Quote expires Thu' ? 'invoice' : 'project'));
    return { head:`<div><h1 class="h1" id="h1">Good morning, ${esc(p.first)}</h1><div class="sub">${P.sub()}</div></div><div style="flex:1"></div>${canCreate('project') ? `<a class="btn btn-primary" data-act="new" href="${U.WIZ}">+ New job</a>` : ''}<button class="dots always" data-act="pagemenu" aria-label="Page actions">⋯</button>`,
      body:`<div class="stats"><a class="stat" href="${U.JOBS}"><span class="n">14</span><span class="l">Active jobs</span></a><a class="stat err" href="${U.JOBS}"><span class="n">2</span><span class="l">Overdue returns</span></a><a class="stat" href="${U.ASSETS}"><span class="n">41</span><span class="l">Gear deployed</span></a><a class="stat" href="${U.PEOPLE}"><span class="n">9</span><span class="l">Crew booked</span></a></div>
        <div class="shd">Needs me <span class="n">${rows.length}</span></div>
        ${rows.map(r => `<a class="hrow" href="${r[5]}"><span class="fl">${dw(r[1], r[0])}</span><span class="id">${r[2]}</span><span class="sb">${esc(r[3])}</span><span class="wh">${r[4]}</span></a>`).join('') || '<div class="pstub">Nothing needs you.</div>'}
        <div class="pstub" style="padding:18px 0 0;border:0"><span class="muted">On now, Coming up, My tasks and Recent activity are the Home prototype. This page is only here so the shell has something calm to sit around.</span> <a class="lnk" href="${U.HOME}">Open Home ›</a></div>` };
  }
  return { head:`<div><h1 class="h1">${esc(P.h1)}</h1><div class="sub">${esc(P.hsub)}</div></div><div style="flex:1"></div><button class="dots always" data-act="pagemenu" aria-label="Page actions">⋯</button>`,
    body:`<div class="pstub"><b>${P.stub[0]}</b> — ${P.stub[2]}<br><a class="lnk" href="${P.stub[1]}">Open the ${P.stub[0]} prototype ›</a></div>` };
}
function protoHtml() {
  const w = (cur, k, label, act) => `<button class="wd ${cur === k ? 'on' : ''}" data-act="${act}" data-v="${k}">${label}</button>`;
  return `<div class="ov">Prototype only — not part of the design</div>
  <div class="ln"><span class="lb">Current page</span>${Object.entries(PAGES).map(([k, v]) => w(state.page, k, v.label, 'setpage')).join('')}</div>
  <div class="ln"><span class="lb">Signed in as</span>${Object.entries(PERSONAS).map(([k, v]) => w(state.persona, k, `${v.name.split(' ')[0]} · ${v.role}`, 'setpersona')).join('')}</div>
  <div class="ln"><span class="lb">Bottom nav (phone)</span>${w(state.bnav, 'd1', 'Proposed (D1)', 'setbnav')}${w(state.bnav, 'alt', 'Alternative: five + floating Scan', 'setbnav')}</div>
  <div class="note">Each nav destination links to its published prototype. “Signed in as” shows the permission gates (Sam has no Settings or New job; the Guest also loses Warehouse and Scan). ${state.bnav === 'alt' ? '<b>The alternative:</b> the floating button sits on top of the sticky primary and the last row’s ⋯ — that is why D1 puts Scan inside the bar.' : ''}</div>`;
}

// ---------- Render
function render() {
  document.documentElement.dataset.theme = state.theme;
  const app = $('#app'); app.classList.toggle('rl', railMode());
  $('.sidebar').innerHTML = sidebarHtml();
  $('.sidebar').classList.toggle('rail72', railMode());
  const rl = railMode(); $$('.sidebar .moreitem').forEach(e => e.style.display = rl ? 'block' : 'none'); $$('.sidebar .ngrp.more').forEach(e => e.style.display = rl ? 'none' : '');
  $('.topbar').innerHTML = topbarHtml();
  $('.phonehead').innerHTML = phoneheadHtml();
  $('.bottomnav').innerHTML = bottomnavHtml();
  const pgd = pageHtml(); $('#pghead').innerHTML = pgd.head; $('#pagebody').innerHTML = pgd.body;
  $('#protoctl').innerHTML = protoHtml();
  $('#phoneact').innerHTML = state.page === 'home' && canCreate('project') ? `<a class="btn btn-primary" data-act="new" href="${U.WIZ}">+ New job</a>` : '';
  $('#phoneact').style.display = state.page === 'home' && canCreate('project') ? '' : 'none';
  $('#fab').classList.toggle('show', state.bnav === 'alt' && can('warehouse'));
  document.title = `${pg().crumbs.map(c => c[0]).slice(-1)[0]} — RVLT Flow`;
  if (state.mira) renderMira();
}
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// ---------- Popovers (bell, user, org, flyout): anchored on desktop, bottom sheet on phone
function openPop(anchor, html, { w = 300, side = 'below', align = 'left' } = {}) {
  closeLayer();
  if (isPhone()) { body.innerHTML = `<div class="pop"><div class="grab" style="width:36px;height:4px;border-radius:2px;background:var(--line-2);margin:10px auto 2px;flex:none"></div>${html}</div>`; $('.pop', body).style.position = 'absolute'; layer.classList.add('open', 'dim'); return; }
  body.innerHTML = `<div class="pop" style="width:${w}px">${html}</div>`; const m = $('.pop', body), r = anchor.getBoundingClientRect();
  m.style.visibility = 'hidden'; layer.classList.add('open'); const mh = m.offsetHeight, mw = m.offsetWidth;
  let top, left;
  if (side === 'right') { top = r.top; left = r.right + 8; } else if (side === 'above') { top = r.top - mh - 6; left = r.left; } else { top = r.bottom + 6; left = align === 'right' ? r.right - mw : r.left; }
  if (left + mw > innerWidth - 8) left = innerWidth - mw - 8; if (left < 8) left = 8; if (top + mh > innerHeight - 8) top = Math.max(8, innerHeight - mh - 8); if (top < 8) top = 8;
  m.style.top = top + 'px'; m.style.left = left + 'px'; m.style.visibility = '';
}
const mrow = (label, act, args = '', o = {}) => o.href ? `<a class="mrow" href="${o.href}" data-act="${o.act || 'closesoon'}">${label}${o.small ? `<span class="sm">${o.small}</span>` : ''}</a>` : `<button class="mrow ${o.danger ? 'danger' : ''}" data-act="${act}" ${args}>${o.on ? ICON.check + ' ' : ''}${label}${o.small ? `<span class="sm">${o.small}</span>` : ''}</button>`;

function bellPop(anchor) {
  const n = unreadN(); const days = []; NOTES.forEach(x => { if (!days.includes(x.day)) days.push(x.day); });
  const html = `<div class="ph"><b>Notifications</b><span class="n">${n} unread</span>${n ? '<button class="lnk" data-act="nmarkall">Mark all read</button>' : ''}</div>
  <div class="pbody">${NOTES.length ? days.map(d => `<div class="ndate">${d}</div>${NOTES.filter(x => x.day === d).map(x => `<a class="nrow ${state.read.has(x.id) ? 'rd' : ''}" href="${x.href}" data-act="nopen" data-id="${x.id}"><span class="u"></span><span class="tx"><div class="tt">${esc(x.title)}</div><div class="ds">${dw(x.cls, x.type)} · ${esc(x.desc)}</div></span><span class="tm">${x.time}</span></a>`).join('')}`).join('') : '<div class="empty"><b>All caught up</b>Nothing needs your attention.</div>'}</div>
  <div class="pf"><a class="lnk" href="${U.HOME}" data-act="closesoon">All notifications ›</a></div>`;
  openPop(anchor, html, { w: 400, align: 'right' });
}
function orgPop(anchor) {
  const html = `<div class="mhd">Organisations</div><div style="padding:0 6px 6px">${ORGS.map(o => `<button class="mrow" data-act="orgswitch" data-id="${o.id}">${state.org === o.id ? ICON.check : '<span style="width:14px"></span>'}<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(o.name)}</span><span class="sm">${o.role}</span></button>`).join('')}</div>`;
  openPop(anchor, html, { w: 280, side: railMode() ? 'right' : 'below' });
}
function userPop(anchor) {
  const p = persona();
  const html = `<div style="padding:12px 16px 8px"><div style="font-size:13.5px;font-weight:600">${esc(p.name)}</div><div class="t-micro muted">${esc(p.email)}</div></div><div class="hr"></div>
  <div style="padding:6px">${mrow('Account settings', '', '', { href: U.SET })}${p.crew ? mrow('My crew profile', '', '', { href: U.RECPEOPLE }) : ''}${state.persona === 'jayden' ? '' : ''}
  <div class="thw"><span class="lb">Theme</span>${['dark','light'].map(t => `<button class="wd ${state.theme === t ? 'on' : ''}" data-act="theme" data-v="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
  ${isPhone() ? '' : mrow('Keyboard shortcuts', 'shortcuts', '', { small: '?' })}</div><div class="hr"></div>
  <div style="padding:6px">${mrow('Sign out', 'signout', '', { danger: true })}</div>`;
  openPop(anchor, html, { w: 250, side: railMode() ? 'right' : 'above' });
}
function flyPop(anchor, k) {
  if (k === 'more') { const items = NAV.filter(n => n.g === 2 && can(n.res)); openPop(anchor, `<div class="mhd">More</div><div style="padding:0 6px 6px">${items.map(n => mrow(`<span class="ic" style="display:inline-flex;color:var(--muted)">${ic(n.i, 15)}</span>${n.l}`, '', '', { href: n.url })).join('')}</div>`, { w: 210, side: 'right' }); return; }
  const n = k === 'settings' ? SETTINGS : NAV.find(x => x.k === k); const subs = (n.subs || []).filter(s => can(s[2]));
  openPop(anchor, `<div class="mhd">${n.l}</div><div style="padding:0 6px 6px">${mrow(`Open ${n.l}`, '', '', { href: n.url })}${subs.map(s => mrow(s[0], '', '', { href: s[1], small: s[3] ? s[3][1] : '' })).join('')}</div>`, { w: 220, side: 'right' });
}

// ---------- More sheet (phone): every destination that is not in the bar, with counts
function moreItems() {
  const v = k => NAV.find(n => n.k === k), ok = k => can(v(k).res);
  const row = (n, label) => ({ n, label: label || n.l });
  const g = [
    ['Plan', [ok('schedule') && row(v('schedule')), ok('finance') && row(v('finance')), ok('jobs') && { n:{ k:'ob', i:'jobs', hue:'blue', url:U.GEAR, flag:['err','5 overbooked'] }, label:'Overbookings' }, ok('jobs') && { n:{ k:'tpl', i:'jobs', hue:'blue', url:U.JOBS }, label:'Job templates' }]],
    ['Crew and gear', [ok('crew') && row(v('crew')), ok('assets') && row(v('assets')), ok('tt') && row(v('tt')), ok('maint') && row(v('maint')), ok('locations') && row(v('locations')), ok('warehouse') && { n:{ k:'ret', i:'warehouse', hue:'teal', url:U.FLOOR, flag:['warn','2 overdue'] }, label:'Returns' }]],
    ['People', [ok('clients') && row(v('clients')), ok('suppliers') && row(v('suppliers'))]],
    ['Account', [ok('activity') && row(v('activity')), canSettings() && { n:SETTINGS, label:'Settings' }]],
  ];
  return g.map(([h, items]) => [h, items.filter(Boolean)]).filter(([, i]) => i.length);
}
function moreSheet() {
  closeLayer(); const p = persona(), o = org(); const dr = state.moreDrill;
  const row = ({ n, label }) => { const subs = (n.subs || []).filter(s => can(s[2])); const rt = `<span class="rt">${n.count ? `<span class="mono">${n.count}</span>` : ''}${n.flag ? dw(n.flag[0], n.flag[1]) : ''}${subs.length ? '<span class="ch">›</span>' : ''}</span>`;
    return subs.length ? `<button class="mi" data-act="moredrill" data-k="${n.k}" style="--h:${hueVar(n.hue)}"><span class="ic">${ic(n.i, 20)}</span>${label}${rt}</button>` : `<a class="mi" href="${n.url}" data-act="closesoon" style="--h:${hueVar(n.hue)}"><span class="ic">${ic(n.i, 20)}</span>${label}${rt}</a>`; };
  let inner;
  if (dr) {
    const n = dr === 'settings' ? SETTINGS : NAV.find(x => x.k === dr), subs = (n.subs || []).filter(s => can(s[2]));
    inner = `<div class="mdh"><button class="btn btn-icon btn-lg" data-act="moreback" aria-label="Back to More" style="color:var(--ink)">‹</button><b>${n.l}</b></div><div class="ms"><a class="mi" href="${n.url}" data-act="closesoon" style="--h:${hueVar(n.hue)};border-top:0"><span class="ic">${ic(n.i, 20)}</span>Open ${n.l}</a>${subs.map(s => `<a class="mi" href="${s[1]}" data-act="closesoon"><span class="ic"></span>${s[0]}${s[3] ? `<span class="rt">${dw(s[3][0], s[3][1])}</span>` : ''}</a>`).join('')}</div>`;
  } else {
    inner = `<button class="mu" data-act="usermenu" aria-label="Account menu"><span class="avt" style="width:36px;height:36px">${p.ini}</span><span class="who"><b>${esc(p.name)}</b><span>${state.org === 'hs' ? 'Viewer' : p.role} · ${esc(o.name)} ▾</span></span></button>
    <div class="ms">${moreItems().map(([h, items]) => `<div class="gh">${h}</div>${items.map(row).join('')}`).join('')}</div>`;
  }
  body.innerHTML = `<div class="moresheet" role="dialog" aria-label="More"><div class="grab"></div>${inner}</div>`; layer.classList.add('open', 'dim');
}

// ---------- ⌘K palette
function matchEntities(q) {
  const nq = norm(q); if (!nq) return [];
  const out = [];
  ENTITIES.forEach(e => {
    const id = norm(e.id), name = norm(e.name), words = e.name.toLowerCase().split(/\s+/).map(norm), hay = norm(e.id + ' ' + e.name + ' ' + (e.alt || '') + ' ' + (e.sub || ''));
    let s = 0;
    if (e.t === 'job' && e.num === nq.replace(/^#/, '')) s = 100; else if (id === nq) s = 100; else if (id.startsWith(nq)) s = 90; else if (e.t === 'job' && e.num.startsWith(nq) && /^\d+$/.test(nq)) s = 85; else if (name.startsWith(nq)) s = 80; else if (words.some(w => w.startsWith(nq))) s = 70; else if (hay.includes(nq)) s = 40;
    if (s) out.push({ e, s });
  });
  return out;
}
function parseDate(q) {
  q = q.trim().toLowerCase(); let m;
  if ((m = q.match(/^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?$/))) return `${m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : '2026'}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if ((m = q.match(/^(\d{1,2})\s+([a-z]{3})[a-z]*$/))) { const mi = MON.findIndex(x => x.toLowerCase() === m[2]); if (mi >= 0) return `2026-${String(mi + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return null;
}
const ACTIONS = () => {
  const P = state.page, a = [];
  if (P === 'job') a.push({ id:'This job', name:'Open Equipment', sub:'#2341', url:U.EQ, ctx:'On #2341' }, { id:'This job', name:'Open Logistics', sub:'#2341', url:U.LOG, ctx:'On #2341' }, { id:'This job', name:'Generate pick list', sub:'#2341 · PDF', url:U.WH, ctx:'On #2341' }, { id:'This job', name:'Duplicate job', sub:'#2341', url:U.WIZ, ctx:'On #2341' });
  if (P === 'asset') a.push({ id:'This asset', name:'Print label', sub:'AURA-01', url:U.ASSET, ctx:'On AURA-01' }, { id:'This asset', name:'Log maintenance', sub:'AURA-01', url:U.ASSET, ctx:'On AURA-01' });
  if (canCreate('project')) a.push({ id:'New', name:'New job', sub:'Wizard', url:U.WIZ, kbd:'N' });
  if (can('warehouse')) a.push(isPhone() ? { id:'Scan', name:'Scan', sub:'Look a tag up', act:'camera', url:U.SCAN } : { id:'Scan', name:'Scan', sub:'Look a tag up', url:U.SCAN });
  if (canCreate('asset')) a.push({ id:'New', name:'New asset', sub:'', url:U.FORMS });
  if (canCreate('client')) a.push({ id:'New', name:'New client', sub:'', url:U.FORMS });
  if (can('warehouse')) a.push({ id:'Go', name:'Open the warehouse floor', sub:'', url:U.FLOOR });
  a.push({ id:'Theme', name:state.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', sub:'', act:'themeflip' });
  a.push({ id:'Go', name:'Account settings', sub:'', url:U.SET });
  if (canSettings()) a.push({ id:'Go', name:'Settings', sub:'', url:U.SET });
  a.push({ id:'Session', name:'Sign out', sub:'', act:'signout' });
  return a;
};
const PAGELIST = () => { const l = []; navVisible().forEach(n => { l.push({ id:'Page', name:n.l, sub:'', url:n.url }); (n.subs || []).filter(s => can(s[2])).forEach(s => l.push({ id:'Page', name:`${n.l} › ${s[0]}`, sub:'', url:s[1] })); }); if (canSettings()) { l.push({ id:'Page', name:'Settings', sub:'', url:U.SET }); SETTINGS.subs.forEach(s => l.push({ id:'Page', name:`Settings › ${s[0]}`, sub:'', url:s[1] })); } return l; };
function palModel(q) {
  const groups = []; let mode = 'search';
  if (q.startsWith('/')) { mode = 'actions'; const nq = norm(q.slice(1)); const a = ACTIONS().filter(x => !nq || norm(x.name + ' ' + x.sub).includes(nq)); const ctx = a.filter(x => x.ctx), glob = a.filter(x => !x.ctx); if (ctx.length) groups.push({ h:ctx[0].ctx, rows:ctx.map(x => ({ kind:'action', ...x })) }); if (glob.length) groups.push({ h:'Actions', rows:glob.map(x => ({ kind:'action', ...x })) }); return { mode, groups }; }
  if (q.startsWith('@')) { mode = 'pages'; const nq = norm(q.slice(1)); const p = PAGELIST().filter(x => !nq || norm(x.name).includes(nq)); if (p.length) groups.push({ h:'Pages', rows:p.map(x => ({ kind:'page', ...x })) }); return { mode, groups }; }
  if (!q.trim()) {
    const rec = state.recent.map(k => ENTITIES.find(e => keyOf(e) === k)).filter(Boolean);
    groups.push({ h:'Recent', rows:rec.map(e => ({ kind:'ent', e })) });
    const a = ACTIONS().filter(x => !x.ctx).slice(0, 4); const c = ACTIONS().filter(x => x.ctx);
    if (c.length) groups.push({ h:c[0].ctx, rows:c.map(x => ({ kind:'action', ...x })) });
    groups.push({ h:'Actions', rows:a.map(x => ({ kind:'action', ...x })) });
    return { mode:'empty', groups };
  }
  const d = parseDate(q);
  if (d) { const js = JOBS.filter(j => j.a <= d && d <= j.b); groups.push({ h:`Jobs on ${fmtD(d)}`, n:js.length, rows:js.map(e => ({ kind:'ent', e })), empty:'No jobs on this date' }); groups.push({ h:'Open', rows:[{ kind:'page', id:'Schedule', name:`Schedule at ${fmtD(d)}`, sub:'', url:U.SCHEDULE }] }); return { mode:'date', groups }; }
  const m = matchEntities(q).filter(x => can(x.e.t === 'job' ? 'project' : x.e.t === 'asset' || x.e.t === 'model' ? 'asset' : x.e.t === 'client' ? 'client' : x.e.t === 'crew' ? 'crew' : x.e.t === 'supplier' ? 'supplier' : 'location'));
  const by = {}; m.forEach(x => (by[x.e.t] = by[x.e.t] || []).push(x));
  Object.entries(by).sort((a, b) => Math.max(...b[1].map(x => x.s)) - Math.max(...a[1].map(x => x.s))).forEach(([t, arr]) => {
    arr.sort((a, b) => b.s - a.s); groups.push({ h:GROUPS[t][0], n:arr.length, rows:arr.slice(0, 4).map(x => ({ kind:'ent', e:x.e })), more:arr.length > 4 ? [arr.length - 4, GROUPS[t][1], GROUPS[t][0]] : null });
  });
  const acts = ACTIONS().filter(x => !x.ctx && norm(x.name).includes(norm(q)));
  if (acts.length) groups.push({ h:'Actions', rows:acts.map(x => ({ kind:'action', ...x })) });
  return { mode:'search', groups };
}
function palRowHtml(r, i) {
  if (r.kind === 'ent') { const e = r.e; return `<a class="pr" role="option" data-i="${i}" href="${e.url}" data-act="palopen" data-key="${esc(keyOf(e))}"><span class="id">${esc(e.id)}</span><span class="nm">${esc(e.name)}${e.sub ? `<span class="sb">${esc(e.sub)}</span>` : ''}</span><span class="rt">${e.st ? dw(e.cls, e.st) : ''}${e.t === 'job' ? `<span class="mono">${fmtRange(e.a, e.b)}</span>` : ''}</span></a>`; }
  if (r.act) return `<a class="pr" role="option" data-i="${i}" href="${r.url || '#'}" data-act="${r.act}"><span class="id">${esc(r.id)}</span><span class="nm">${esc(r.name)}${r.sub ? `<span class="sb">${esc(r.sub)}</span>` : ''}</span><span class="rt">${r.kbd ? `<span class="kbd">${r.kbd}</span>` : ''}</span></a>`;
  return `<a class="pr" role="option" data-i="${i}" href="${r.url}" data-act="palopen"><span class="id">${esc(r.id)}</span><span class="nm">${esc(r.name)}${r.sub ? `<span class="sb">${esc(r.sub)}</span>` : ''}</span><span class="rt">${r.kbd ? `<span class="kbd">${r.kbd}</span>` : ''}</span></a>`;
}
function renderPalResults() {
  const q = state.pal.q, M = palModel(q); let i = 0, h = '';
  M.groups.forEach(g => { h += `<div class="pg">${g.h}${g.n != null ? `<span class="n">${g.n}</span>` : ''}${g.more ? `<a class="more" href="${g.more[1]}">Show all ${g.more[0] + 4} in ${g.more[2]} ›</a>` : ''}</div>`; if (!g.rows.length) h += `<div class="none" style="padding:6px 18px 10px;text-align:left;font-size:13px">${g.empty || ''}</div>`; g.rows.forEach(r => { h += palRowHtml(r, i++); }); });
  state.pal.n = i; if (state.pal.i >= i) state.pal.i = Math.max(0, i - 1);
  if (!i) h = `<div class="none"><b>Nothing matches “${esc(q)}”</b>Try a job number, an asset tag or a client name. <span class="faint">@ pages · / actions</span></div>`;
  $('#pres').innerHTML = h; markPal(false);
  const hints = $('#palhints'); if (hints) hints.innerHTML = M.mode === 'actions' ? '<span><span class="kbd">/</span>actions for this page, then global</span>' : M.mode === 'pages' ? '<span><span class="kbd">@</span>pages</span>' : M.mode === 'date' ? '<span>date: jobs on that day</span>' : '<span><span class="kbd">@</span>pages</span><span><span class="kbd">/</span>actions</span><span>or type a date</span>';
}
function markPal(scroll = true) { $$('#pres .pr').forEach(e => e.classList.toggle('on', +e.dataset.i === state.pal.i)); const on = $('#pres .pr.on'); if (on && scroll) on.scrollIntoView({ block: 'nearest' }); }
function openPalette(seed = '') {
  closeLayer(); state.pal = { q:seed, i:0, n:0 };
  body.innerHTML = `<div class="pal" role="dialog" aria-label="Search"><div class="pin">${ic('search', 18)}<input id="pq" type="text" autocomplete="off" spellcheck="false" placeholder="Jump to a job, asset or client…" value="${esc(seed)}" aria-controls="pres"><span class="kbd">Esc</span><button class="cancel" data-act="close">Cancel</button></div>
  <div class="pmodes"><button data-act="palseed" data-v="@"><b>@</b>Pages</button><button data-act="palseed" data-v="/"><b>/</b>Actions</button>${can('warehouse') ? '<button data-act="camera"><b>⌗</b>Scan a tag</button>' : ''}</div>
  <div class="pres" id="pres" role="listbox"></div>
  <div class="pfoot"><span><span class="kbd">↑</span><span class="kbd">↓</span>move</span><span><span class="kbd">Enter</span>open</span><span id="palhints" style="display:contents"></span><span style="margin-left:auto"><span class="kbd">Esc</span>close</span></div></div>`;
  layer.classList.add('open', 'dim'); renderPalResults(); const inp = $('#pq'); inp.focus(); inp.setSelectionRange(seed.length, seed.length);
}

// ---------- Mira (top-bar button, calm side panel; a danger:high action stops at a Confirm card a human clicks)
function miraHtml() {
  const p = persona(), cardOn = state.miraStep;
  const ask = state.miraWrite;
  const card = cardOn === 'ask' ? `<div class="mcard ${ask ? '' : 'off'}">${ask ? dw('warn', 'Needs your confirmation') : dw('mute', 'Write access is off')}
      <h4>Create sub-hire order (draft)</h4>
      <dl><dt>Supplier</dt><dd>Scene Change</dd><dt>Items</dt><dd>2 × Martin MAC Aura PXL</dd><dt>Dates</dt><dd class="mono">13 – 14 Nov</dd><dt>For</dt><dd>#2350 Qantas awards night</dd><dt>Estimate</dt><dd class="mono">$1,120</dd></dl>
      ${ask ? `<div class="acts"><button class="btn-ink" data-act="miraconfirm">Confirm</button><button class="lnk muted" data-act="miradismiss">Dismiss</button></div>
      <div class="why">Mira cannot approve this itself. Confirming replays exactly this call as you. <code>subHireOrders.create</code> · danger high</div>` : `<div class="why">Mira can look things up but not change them until an admin turns on write access. <a class="lnk" href="${U.SET}">Settings › Mira ›</a></div>`}</div>`
    : cardOn === 'done' ? `<div class="mcard done">${dw('ok', 'Confirmed by you · 09:14')}<h4>Sub-hire order created as a draft</h4><div class="why">2 × Martin MAC Aura PXL from Scene Change, 13 – 14 Nov, for #2350. <a class="lnk" href="${U.EQ}">Open the sub-hire ›</a></div></div>`
    : `<div class="mcard off">${dw('mute', 'Dismissed · nothing was changed')}</div>`;
  const msgs = `<div class="mdate">Today</div>
  <div class="mm"><div class="who"><span class="avt" style="width:20px;height:20px;font-size:9px">${p.ini}</span>You<span class="tm">09:12</span></div><div class="tx">Can we take Qantas (#2350) without hurting Hilton?</div></div>
  <div class="mm"><div class="who">${ic('mira', 14)}Mira<span class="tm">09:12</span></div>
    <div class="tool">checked availability · Martin MAC Aura PXL · 13 – 14 Nov</div><div class="tool">read lines on #2341 and #2350</div>
    <div class="tx" style="margin-top:8px"><p>#2350 is only quoted, so it holds nothing yet. If it confirms, 13 – 14 Nov needs 10 Aura PXL (6 for #2341, 4 for #2350) against the 8 you own, so <b>#2341 Hilton would be short 2</b>.</p><p>The cheapest cover is 2 from Scene Change for 13 – 14 Nov. I have drafted the sub-hire order for you to confirm.</p></div></div>${card}</div>
  ${state.miraExtra.map(m => `<div class="mm"><div class="who">${m.me ? `<span class="avt" style="width:20px;height:20px;font-size:9px">${p.ini}</span>You` : `${ic('mira', 14)}Mira`}<span class="tm">${m.t}</span></div><div class="tx">${esc(m.x)}</div></div>`).join('')}`;
  return `<div class="mh"><b>${ic('mira', 16)}Mira</b><span class="ctx">Looking at: ${esc(pg().crumbs.slice(-1)[0][0])}</span><span class="sp"></span><button class="hb2" data-act="miramenu" aria-label="Mira options">⋯</button><button class="hb2" data-act="mira" aria-label="Close Mira">✕</button></div>
  <div class="mbody" id="mbody">${msgs}</div>
  <div class="mfoot"><input id="mi" type="text" placeholder="Ask Mira…" autocomplete="off"><button class="send" data-act="mirasend">Send</button></div>`;
}
function renderMira() { const keep = $('#mi') ? $('#mi').value : ''; $('#mira').innerHTML = miraHtml(); if (keep) $('#mi').value = keep; $('#mira').classList.toggle('open', state.mira); }

// ---------- Camera sheet (copied from the Scan prototype; outside a job, Scan looks the tag up)
const SAMPLES = { 'AURA-01':['AURA-01 · Martin MAC Aura XB', 'Reserved on #2341 · in LX-02 · Warehouse A', U.ASSET], 'L-0007':['L-0007 · Martin MAC Aura PXL', 'Out on #2339 ICC Sydney trade show · back 12 Nov', U.ASSET], 'SK-0012':['SK-0012 · Sennheiser EW-DX SK beltpack', 'Available · Warehouse A · B2', U.ASSET], 'XX-999':['XX-999', 'Not on the register — nothing to open', null] };
function cameraSheet(res) {
  closeLayer(); const ph = isPhone(); const r = res && SAMPLES[res];
  openDialog(`<div class="camv" style="height:${ph ? 300 : 250}px;margin:12px"><div class="ret"><i></i><i></i><i></i><i></i></div><div style="position:absolute;left:14px;top:12px">${dw('live', 'Camera live')}</div><div style="position:absolute;right:14px;top:12px" class="t-micro">Look up</div></div>
  <div class="bd" style="padding-top:0;gap:10px"><div class="t-micro muted">No camera in a prototype: tap a tag to simulate a read. The real camera starts from this tap, runs one at a time, and is released when this closes or the app is hidden.</div>
  <div style="display:flex;gap:14px;flex-wrap:wrap">${Object.keys(SAMPLES).map(t => `<button class="samp" data-act="camread" data-tag="${t}">${t}</button>`).join('')}</div>
  <div class="camres" id="camres">${r ? `<div><span class="id">${esc(r[0].split(' · ')[0])}</span>${r[0].includes(' · ') ? ' · ' + esc(r[0].split(' · ')[1]) : ''}</div><div class="muted" style="margin:2px 0 6px">${esc(r[1])}</div>${r[2] ? `<a class="lnk" href="${r[2]}">Open asset ›</a>` : ''}` : '<span class="muted">Waiting for a tag. On a warehouse job, Scan acts on the job’s current stage instead.</span>'}</div></div>
  <div class="ft"><div style="flex:1"></div><button class="btn btn-secondary btn-sm" data-act="close">Done</button></div>`);
}
function shortcutsDialog() {
  const rows = [['⌘K','Search: jump to a job, asset or client'],['/','Actions (for this page, then global)'],['@','Pages'],['N','New job (on Home and the Jobs list)'],['⌘B','Collapse or expand the sidebar'],['↑ ↓  Enter','Move and open in the palette'],['?','This list'],['Esc','Close the top layer']];
  openDialog(`<div class="hd"><h2 style="margin:0">Keyboard shortcuts</h2></div><div class="bd" style="gap:2px">${rows.map(r => `<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-top:1px solid var(--line)"><span style="font-size:13.5px;color:var(--ink-2)">${r[1]}</span><span class="kbd">${r[0]}</span></div>`).join('')}</div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary btn-sm" data-act="close">Done</button></div>`);
}

// ---------- Actions
function snapshotShell() { const s = { read:new Set(state.read), org:state.org, miraStep:state.miraStep, miraExtra:state.miraExtra.slice() }; return () => { state.read = s.read; state.org = s.org; state.miraStep = s.miraStep; state.miraExtra = s.miraExtra; closeLayer(); render(); }; }
function go(url) { const a = document.createElement('a'); a.href = url; a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove(); }
function act(name, el, ev) {
  switch (name) {
    case 'close': closeLayer(); break;
    case 'noop': closeLayer(); break;
    case 'closesoon': setTimeout(closeLayer, 0); break;
    case 'toastclose': $('#toast').classList.remove('open'); break;
    case 'undo': if (state.undo) { const u = state.undo; state.undo = null; u(); $('#toast').classList.remove('open'); } break;
    case 'new': if (el && !(el.getAttribute('href') || '').includes('claude.ai')) break; if (!el) go(U.WIZ); break;
    case 'palette': openPalette(''); break;
    case 'palseed': { const q = el.dataset.v; state.pal.q = q; const inp = $('#pq'); inp.value = q; inp.focus(); state.pal.i = 0; renderPalResults(); break; }
    case 'palopen': { if (el.dataset.key) { state.recent = [el.dataset.key, ...state.recent.filter(k => k !== el.dataset.key)].slice(0, 5); } setTimeout(closeLayer, 0); break; }
    case 'mira': closeLayer(); state.mira = !state.mira; render(); renderMira(); if (state.mira) setTimeout(() => $('#mi') && $('#mi').focus(), 30); break;
    case 'miramenu': openPop(el, `<div style="padding:6px">${mrow('New chat', 'mira_new')}${mrow('Mira settings', '', '', { href: U.SET })}<div class="hr" style="margin:4px 0"></div><div class="mhd" style="padding-bottom:6px">Write access (an org setting)</div><div class="thw" style="padding-top:0"><button class="wd ${state.miraWrite ? 'on' : ''}" data-act="miraperm" data-v="1">On</button><button class="wd ${!state.miraWrite ? 'on' : ''}" data-act="miraperm" data-v="0">Off</button></div></div>`, { w: 250, align: 'right' }); break;
    case 'miraperm': state.miraWrite = el.dataset.v === '1'; closeLayer(); renderMira(); toast(state.miraWrite ? 'Mira can now make changes (each high-risk one still needs a click)' : 'Mira is read-only again; every member’s cached key is revoked', null); break;
    case 'mira_new': { const undo = snapshotShell(); state.miraStep = 'ask'; state.miraExtra = []; closeLayer(); renderMira(); toast('New chat', undo); break; }
    case 'miraconfirm': { const undo = snapshotShell(); state.miraStep = 'done'; renderMira(); toast('Sub-hire order created as a draft', () => { undo(); renderMira(); }); break; }
    case 'miradismiss': state.miraStep = 'dismissed'; renderMira(); break;
    case 'mirasend': { const i = $('#mi'); const v = i.value.trim(); if (!v) break; state.miraExtra.push({ me:true, x:v, t:'09:15' }, { x:'This panel is a stub. In the app Mira answers by calling the same operations as the API, as you — try the Confirm card above.', t:'09:15' }); i.value = ''; renderMira(); const b = $('#mbody'); b.scrollTop = b.scrollHeight; $('#mi').focus(); break; }
    case 'bell': bellPop(el); break;
    case 'nopen': { state.read.add(el.dataset.id); setTimeout(() => { closeLayer(); render(); }, 0); break; }
    case 'nmarkall': { const undo = snapshotShell(), n = unreadN(); NOTES.forEach(x => state.read.add(x.id)); closeLayer(); render(); toast(`${n} notifications marked read`, undo); break; }
    case 'orgmenu': orgPop(el); break;
    case 'orgswitch': { const o = ORGS.find(x => x.id === el.dataset.id); if (o.id === state.org) { closeLayer(); break; } const undo = snapshotShell(); state.org = o.id; state.page = 'home'; closeLayer(); render(); toast(`Switched to ${o.name}`, undo); break; }
    case 'usermenu': userPop(el); break;
    case 'theme': state.theme = el.dataset.v; try { localStorage.setItem('shell-theme', state.theme); } catch (e) {} closeLayer(); render(); break;
    case 'themeflip': state.theme = state.theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('shell-theme', state.theme); } catch (e) {} closeLayer(); render(); break;
    case 'shortcuts': closeLayer(); shortcutsDialog(); break;
    case 'signout': closeLayer(); toast('Signed out (the prototype stays signed in)', null); break;
    case 'collapse': state.collapsed = !state.collapsed; try { localStorage.setItem('shell-collapsed', state.collapsed ? '1' : '0'); } catch (e) {} render(); break;
    case 'subtoggle': { const k = el.dataset.k; state.openSubs.has(k) ? state.openSubs.delete(k) : state.openSubs.add(k); const g = el.closest('.ng'); g.classList.toggle('open'); el.setAttribute('aria-expanded', g.classList.contains('open')); break; }
    case 'navrow': if (railMode()) { ev.preventDefault(); flyPop(el, el.dataset.k); } break;
    case 'fly': flyPop(el, el.dataset.k); break;
    case 'camera': if (ev && ev.preventDefault) ev.preventDefault(); cameraSheet(); break;
    case 'camread': { $('#camres').innerHTML = (r => `<div><span class="id">${esc(r[0].split(' · ')[0])}</span>${r[0].includes(' · ') ? ' · ' + esc(r[0].split(' · ')[1]) : ''}</div><div class="muted" style="margin:2px 0 6px">${esc(r[1])}</div>${r[2] ? `<a class="lnk" href="${r[2]}">Open asset ›</a>` : ''}`)(SAMPLES[el.dataset.tag]); break; }
    case 'more': state.moreDrill = null; moreSheet(); break;
    case 'moredrill': state.moreDrill = el.dataset.k; moreSheet(); break;
    case 'moreback': state.moreDrill = null; moreSheet(); break;
    case 'pagemenu': openMenu(el, pg().label, state.page === 'home' ? [{ label:'Warehouse', href:U.FLOOR, small:'↗' }, { label:'Add gear', href:U.FORMS, small:'↗' }, { label:'Customise…', href:U.HOME, small:'↗' }] : [{ label:'Open the prototype for this page', href:pg().stub[1], small:'↗' }]); break;
    case 'setpage': state.page = el.dataset.v; closeLayer(); render(); break;
    case 'setpersona': state.persona = el.dataset.v; closeLayer(); render(); break;
    case 'setbnav': state.bnav = el.dataset.v; render(); break;
  }
}

// ---------- Keyboard (capture phase, ahead of the kit's list-page shortcuts which expect a #q search box this page does not have)
window.addEventListener('keydown', ev => {
  const typing = ev.target.matches && ev.target.matches('input,textarea,select');
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); ev.stopImmediatePropagation(); if ($('.pal', body) && layer.classList.contains('open')) closeLayer(); else openPalette(''); return; }
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'b' && !isPhone()) { ev.preventDefault(); ev.stopImmediatePropagation(); act('collapse'); return; }
  if (ev.target.id === 'pq') {
    const n = state.pal.n || 0;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); state.pal.i = n ? (state.pal.i + 1) % n : 0; markPal(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); state.pal.i = n ? (state.pal.i - 1 + n) % n : 0; markPal(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); const on = $('#pres .pr.on'); if (on) on.click(); }
    else if (ev.key === 'Backspace' && !ev.target.value) { /* nothing to drill out of */ }
    return;
  }
  if (ev.target.id === 'mi' && ev.key === 'Enter') { ev.preventDefault(); act('mirasend'); return; }
  if (ev.key === 'Escape' && !layer.classList.contains('open') && state.mira) { state.mira = false; render(); renderMira(); return; }
  if (typing || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if (layer.classList.contains('open')) return;
  if (ev.key === '/') { ev.preventDefault(); ev.stopImmediatePropagation(); openPalette('/'); }
  else if (ev.key === '?') { ev.preventDefault(); ev.stopImmediatePropagation(); shortcutsDialog(); }
  else if ((ev.key === 'n' || ev.key === 'N') && state.page === 'home' && canCreate('project')) { ev.preventDefault(); ev.stopImmediatePropagation(); go(U.WIZ); }
  else if (ev.key === 'n' || ev.key === 'N') { ev.stopImmediatePropagation(); }
}, true);
document.addEventListener('input', ev => { if (ev.target.id === 'pq') { state.pal.q = ev.target.value; state.pal.i = 0; renderPalResults(); } });
document.addEventListener('mouseover', ev => { const r = ev.target.closest && ev.target.closest('#pres .pr'); if (r && +r.dataset.i !== state.pal.i) { state.pal.i = +r.dataset.i; markPal(false); } });

// ---------- boot
render();
