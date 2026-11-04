// ---------- Model detail · data  (record page, pattern 4.2)
const TODAY = '2026-11-09';
const U = {
  OV:'https://claude.ai/artifact/RatKsWfTmDJLJHmn6mb7Zo', JOBS:'https://claude.ai/artifact/A7SMPtpTr3aedUDEnuSaxd', ASSETS:'https://claude.ai/artifact/89PDTuMiovgP9i3h4MJ1Tw',
  ASSET:'https://claude.ai/artifact/Rr5rwirCUMRy8gf5G6Vz7s', FLOOR:'https://claude.ai/artifact/6xqFcEZZk49w86p5pAsisA', HOME:'https://claude.ai/artifact/3d6zqfosL5hYRvXLBYLnhR', FINANCE:'https://claude.ai/artifact/5VnYTVW2pdA5r1qBRvdrom', PEOPLE:'https://claude.ai/artifact/LPdsNGb4CRMfS6qk7j7Fsa', SETTINGS:'https://claude.ai/artifact/Q3TeWuQPjzvXbAtmUV8Hg8', SCAN:'https://claude.ai/artifact/8Q2HVoRhLbSLz1Q9mCtayX',
};
const rnd = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(11);
const addD = (d, n) => new Date((dayNum(d) + n) * 864e5).toISOString().slice(0,10);
const dow = d => WD[new Date(dayNum(d) * 864e5).getUTCDay()];
const fmtDay = d => `${dow(d)} ${fmtD(d)}`;
const plural = (n, s, p) => `${n} ${n === 1 ? s : (p || s + 's')}`;
const STATUS = { AVAILABLE:['Available','ok'], DEPLOYED:['Out','live'], RESERVED:['Reserved','info'], IN_MAINTENANCE:['In service','warn'], RETIRED:['Retired',''], MISSING:['Missing','err'] };
const GROUPS = [['all','All'],['available','Available'],['deployed','On jobs'],['maintenance','In service'],['due','Due for T&T'],['attention','Needs attention'],['retired','Retired']];
const J40 = { num:'#2340', name:'Launch night' }, J41 = { num:'#2341', name:'Hilton Sydney gala dinner' };
const SHELF = ['B2','A3-14','C1','B4','A2-09'];
const mkAsset = (n, status, o = {}) => ({ id:'a' + n, tag:'AURA-' + String(n).padStart(2,'0'), serial:'AU' + (4820113 + n * 371), status, condition:'Good', location:'Warehouse A', shelf:SHELF[n % SHELF.length], ttDue:addD(TODAY, 40 + ((n * 37) % 250)), maintDue:null, job:null, tags:[], owner:'Owned', ...o });
const state = {
  tab:'overview', dup:0,
  model:{ name:'Martin MAC Aura XB', manufacturer:'Martin', modelNumber:'MAC Aura XB', sku:'MAR-AURAXB', category:'Lighting', type:'Serialised',
    description:'LED wash moving head with a backlit aura ring. Our default wash for gala dinners and conference stages; the aura ring is what clients ask for by name.',
    daily:85, weekly:340, monthly:1100, purchase:2850, replacement:3200, salePrice:null, saleStock:null, xeroRental:'200', xeroSale:'',
    weight:18.4, power:650, tt:true, ttProfile:'Class I luminaire', ttDays:null,
    specs:[['Light source','19 × 15 W RGBW LED'],['Zoom','8° – 40°'],['Pan / tilt','540° / 270°'],['IP rating','IP20']], tags:['wash','moving head'], active:true, container:false },
  assets:[
    mkAsset(1,'DEPLOYED',{ location:'On job', shelf:'', job:J40 }),
    mkAsset(2,'DEPLOYED',{ location:'On job', shelf:'', job:J40, ttDue:'2026-10-30' }),
    mkAsset(3,'DEPLOYED',{ location:'On job', shelf:'', job:J40 }),
    mkAsset(4,'IN_MAINTENANCE',{ condition:'Needs repair', maintDue:'2026-11-13', location:'Warehouse B', shelf:'Bench' }),
    mkAsset(5,'RESERVED',{ job:J41, shelf:'LX-02' }), mkAsset(6,'RESERVED',{ job:J41, shelf:'LX-02' }), mkAsset(7,'RESERVED',{ job:J41, shelf:'LX-04' }), mkAsset(8,'RESERVED',{ job:J41, shelf:'LX-04' }),
    mkAsset(9,'AVAILABLE'), mkAsset(10,'AVAILABLE',{ ttDue:'2026-11-02' }), mkAsset(11,'AVAILABLE',{ ttDue:addD(TODAY, 12), location:'Warehouse B' }), mkAsset(12,'AVAILABLE',{ condition:'Fair', location:'Warehouse B', tags:['touring'] }),
    mkAsset(13,'RETIRED',{ location:'Warehouse B', condition:'Poor', shelf:'B4' }),
  ],
  acc:[
    { id:'k1', kind:'bulk', name:'Powercon 5m', qty:1, incl:'DEFAULT' }, { id:'k2', kind:'bulk', name:'Safety bond 1m', qty:1, incl:'DEFAULT' },
    { id:'k3', kind:'bulk', name:'Omega clamp', qty:2, incl:'DEFAULT' }, { id:'k4', kind:'custom', name:'Rain cover', qty:1, incl:'OPTIONAL' },
  ],
  checks:[
    { id:'c1', label:'Pan / tilt travel', desc:'Full range, no stutter or skipped steps', type:'PASS_FAIL', fail:[2,25] },
    { id:'c2', label:'Gobo wheel spin', desc:'Spins freely and indexes to every gobo', type:'PASS_FAIL', fail:[7,25] },
    { id:'c3', label:'Front lens and glass clean', desc:'', type:'PASS_FAIL', fail:[1,26] },
    { id:'c4', label:'Fan noise', desc:'Below 52 dB at 1 m, full output', type:'MEASUREMENT', fail:[4,29] },
    { id:'c5', label:'Dimmer curve', desc:'Linear, square or S-curve as the job requires', type:'DROPDOWN', fail:[0,22] },
    { id:'c6', label:'Condition notes', desc:'', type:'NOTES', fail:[0,0] },
  ],
  photos:[
    { id:'p1', name:'aura-front.jpg', c1:'#56606c', c2:'#1d242b', primary:true }, { id:'p2', name:'aura-side.jpg', c1:'#4a5a52', c2:'#1a2420', primary:false },
    { id:'p3', name:'aura-beam-wash.jpg', c1:'#5c4f72', c2:'#1d1a2b', primary:false }, { id:'p4', name:'aura-rear-connectors.jpg', c1:'#6b5646', c2:'#241b16', primary:false },
    { id:'p5', name:'aura-in-case.jpg', c1:'#4b5f73', c2:'#18222d', primary:false },
  ],
  docs:[
    { id:'d1', name:'MAC Aura XB user manual v1.4.pdf', size:4.2e6, by:'Sam Okafor', at:'2025-08-12' },
    { id:'d2', name:'Aura XB DMX chart.pdf', size:3.1e5, by:'Sam Okafor', at:'2025-08-12' },
    { id:'d3', name:'Martin service bulletin 2025-03.pdf', size:8.8e5, by:'Tom Nguyen', at:'2025-10-02' },
  ],
  activity:[['Sam Okafor','moved AURA-11 and AURA-12 to Warehouse B','Fri 7 Nov'],['Jayden Cole','changed the weekly rate $320 → $340','Thu 6 Nov'],['Mel Torres','set replacement cost to $3,200','Mon 3 Nov'],['Sam Okafor','added the check “Gobo wheel spin”','24 Oct'],['Tom Nguyen','uploaded aura-in-case.jpg','2 Oct']],
  bookings:[
    { num:'#2340', name:'Launch night', from:'2026-11-08', to:'2026-11-10', qty:3, status:'Out now', cls:'live' },
    { num:'#2341', name:'Hilton Sydney gala dinner', from:'2026-11-12', to:'2026-11-14', qty:4, status:'Confirmed', cls:'ok' },
    { num:'#2350', name:'Qantas awards', from:'2026-11-18', to:'2026-11-19', qty:6, status:'Confirmed', cls:'ok' },
    { num:'#2338', name:'Corporate AGM', from:'2026-11-21', to:'2026-11-21', qty:2, status:'Quoted', cls:'info' },
  ],
  // asset list ui (the Assets list's state, filtered to this model)
  group:'all', q:'', f:{ location:[], condition:[] }, sort:'tag', dir:'asc', page:0, size:10,
  sel:{ assets:new Set(), checks:new Set(), documents:new Set(), photos:new Set() }, last:{},
  roi:{ scope:'earned', all:false, cost:false, more:8 },
  sheet:null, undo:null,
};
// ROI: generated once, deterministic. Every row's revenue is its share of the job it went out on (incl. its slice of a kit / bundle price).
const RN = ['Ogilvy product launch','UNSW graduation','Westpac leadership summit','Atlassian all-hands','ABC gala night','Telstra roadshow','Canva offsite','Allianz awards','Vivid Sydney install','Aria wedding reception','NAB investor day','Optus launch','Google Cloud summit','Salesforce dinner'];
function genRoi(n, total, num0, date0, step) {
  const w = Array.from({ length:n }, () => .5 + rnd()), sw = w.reduce((s, x) => s + x, 0);
  const rows = w.map((x, i) => ({ id:'r' + num0 + '-' + i, num:'#' + (num0 - i * 2 - (rnd() * 2 | 0)), name:RN[(i * 5 + 3) % RN.length], date:addD(date0, -Math.round(i * step + rnd() * 6)), rev:Math.round(total * x / sw / 10) * 10, status:'Invoiced' }));
  rows[n - 1].rev += total - rows.reduce((s, r) => s + r.rev, 0);
  return rows;
}
const ROI_Y = genRoi(17, 41260, 2331, '2026-10-30', 21), ROI_OLD = genRoi(31, 77680, 2294, '2025-10-20', 20);
const ROI_BOOKED = [{ id:'rb1', num:'#2341', name:'Hilton Sydney gala dinner', date:'2026-11-12', rev:2760, status:'Confirmed' }, { id:'rb2', num:'#2350', name:'Qantas awards', date:'2026-11-18', rev:3540, status:'Confirmed' }, { id:'rb3', num:'#2338', name:'Corporate AGM', date:'2026-11-21', rev:1500, status:'Quoted' }];
const CHECK_LIB = [['Zoom travel','Smooth 8° to 40°, no hunting','PASS_FAIL'],['Colour mixing even','Flat white at 100% across the field','PASS_FAIL'],['Safety bond fitted','','PASS_FAIL'],['DMX in / out','Both ports pass a signal','PASS_FAIL'],['Strobe and shutter','','PASS_FAIL'],['Firmware version','','NOTES']];
const BULK_STOCK = ['Powercon 5m','Safety bond 1m','Omega clamp','Socapex 20m','XLR 10m','Sandbag 15kg','Gaffer tape (black)','Cable ramp'];
const TYPE_LABEL = { PASS_FAIL:'Pass / fail', NOTES:'Notes', MEASUREMENT:'Measurement', DROPDOWN:'Dropdown' };
const LOCS = ['Warehouse A','Warehouse B','Van 2'];
const SAMPLE_DOCS = [['MAC Aura XB rigging guide.pdf', 1.9e6], ['Aura XB spec sheet.pdf', 5.2e5], ['Gobo wheel replacement.pdf', 1.1e6]];
const SAMPLE_PHOTOS = [['aura-top-view.jpg','#5d6b57','#1d2419'], ['aura-label.jpg','#6a5a4a','#221a14']];
// ---------- derived
const owned = () => state.assets.filter(a => a.status !== 'RETIRED').length;
const cnt = s => state.assets.filter(a => a.status === s).length;
const nextDue = a => { const ds = [a.ttDue && ['T&T', a.ttDue], a.maintDue && ['Service', a.maintDue]].filter(Boolean).sort((x, y) => x[1] < y[1] ? -1 : 1); return ds[0] || null; };
const overdue = a => { const d = nextDue(a); return d && d[1] < TODAY; };
const ttOverdue = a => a.status !== 'RETIRED' && a.ttDue && a.ttDue < TODAY;
const dueSoon = a => { const d = nextDue(a); return d && d[1] >= TODAY && dayNum(d[1]) - dayNum(TODAY) <= 30; };
const attention = a => a.status === 'MISSING' || a.condition === 'Needs repair' || overdue(a);
function inGroup(a, g) { switch (g) { case 'all': return a.status !== 'RETIRED'; case 'available': return a.status === 'AVAILABLE'; case 'deployed': return a.status === 'DEPLOYED' || a.status === 'RESERVED'; case 'maintenance': return a.status === 'IN_MAINTENANCE'; case 'due': return a.status !== 'RETIRED' && (overdue(a) || dueSoon(a)); case 'attention': return a.status !== 'RETIRED' && attention(a); case 'retired': return a.status === 'RETIRED'; } }
function matches(a) {
  if (!inGroup(a, state.group)) return false;
  const q = state.q.trim().toLowerCase(); if (q && ![a.tag, a.serial, a.location, a.shelf, a.job && a.job.name].some(x => (x || '').toLowerCase().includes(q))) return false;
  const f = state.f; if (f.location.length && !f.location.includes(a.location)) return false; if (f.condition.length && !f.condition.includes(a.condition)) return false;
  return true;
}
function sorted(rs) { const k = state.sort, d = state.dir === 'asc' ? 1 : -1; return [...rs].sort((a, b) => { let x = a[k], y = b[k]; if (k === 'due') { x = (nextDue(a) || ['', '9999'])[1]; y = (nextDue(b) || ['', '9999'])[1]; } if (k === 'job') { x = a.job ? a.job.num : 'zzz'; y = b.job ? b.job.num : 'zzz'; } if (k === 'status') { x = Object.keys(STATUS).indexOf(a.status); y = Object.keys(STATUS).indexOf(b.status); } if (x == null) return 1; if (y == null) return -1; return (x > y ? 1 : x < y ? -1 : 0) * d; }); }
const rows = () => sorted(state.assets.filter(matches));
const asset = id => state.assets.find(a => a.id === id);
const fails = () => state.checks.filter(c => c.fail[1] > 0).map(c => ({ ...c, pct:Math.round(c.fail[0] / c.fail[1] * 100) })).sort((a, b) => b.pct - a.pct);
const primaryPhoto = () => state.photos.find(p => p.primary) || state.photos[0];
const photoBg = p => p ? `background:radial-gradient(ellipse at 50% 12%,rgba(255,248,230,.30),transparent 58%),linear-gradient(135deg,${p.c1},${p.c2})` : 'background:var(--paper-2)';
const roiRows = () => { const r = state.roi; let x = [...ROI_Y]; if (r.all) x = x.concat(ROI_OLD); if (r.scope === 'booked') x = x.concat(ROI_BOOKED); return x.sort((a, b) => a.date < b.date ? 1 : -1); };
const roiSum = rs => rs.reduce((s, r) => s + r.rev, 0);
const fleetCost = () => state.model.purchase == null ? null : state.model.purchase * owned();
const fmtPayback = p => p == null ? '—' : p.toFixed(1) + '×';
const freeOn = d => { const cap = owned() - (d < '2026-11-13' ? cnt('IN_MAINTENANCE') : 0); return cap - state.bookings.filter(b => b.from <= d && d <= b.to).reduce((s, b) => s + b.qty, 0); };
function snapshot() {
  const s = { model:JSON.parse(JSON.stringify(state.model)), assets:state.assets.map(a => ({ ...a, tags:[...a.tags], job:a.job && { ...a.job } })), acc:state.acc.map(a => ({ ...a })), checks:state.checks.map(c => ({ ...c, fail:[...c.fail] })), photos:state.photos.map(p => ({ ...p })), docs:state.docs.map(d => ({ ...d })), dup:state.dup };
  return () => { Object.assign(state, { model:s.model, assets:s.assets, acc:s.acc, checks:s.checks, photos:s.photos, docs:s.docs, dup:s.dup }); clearSel(); render(); };
}
// ---------- shell overrides (crumb trail, phone back chevron, sibling links)
function shellInit() {
  $('.crumb').innerHTML = `<a href="${U.ASSETS}" style="color:var(--muted)">Assets</a><span>›</span><a href="#models" data-act="models" style="color:var(--muted)">Models</a><span>›</span><b>MAC Aura XB</b>`;
  const ph = $('.phonehead'); if (!$('.phonehead .back')) { ph.insertAdjacentHTML('afterbegin', `<a class="btn btn-icon btn-lg back" href="#models" data-act="models" aria-label="Back to models" style="color:var(--ink)">‹</a>`); ph.children[1].style.paddingLeft = '0'; }
  const nav = [['Dashboard','blue',U.HOME],['Jobs','blue',U.JOBS],['Finance','green',U.FINANCE],['Schedule','green','#schedule'],['Crew','purple',U.PEOPLE],['Assets','amber',U.ASSETS],['Warehouse','teal',U.FLOOR],['Test & tag','teal','#tt'],['Maintenance','amber','#maintenance']];
  $('#sidenav').innerHTML = nav.map(([n, c, h]) => `<a href="${h}" class="${n === 'Assets' ? 'on' : ''}"><span class="patch" style="background:var(--${c}-soft, var(--paper-2))"></span>${n}</a>`).join('');
  $('.sidebar .foot a').href = U.SETTINGS;
  const bn = $$('.bottomnav a'); if (bn.length === 5) { bn[0].href = U.HOME; bn[1].href = U.JOBS; bn[2].href = U.SCAN; bn[3].href = U.FLOOR; bn[4].href = U.ASSETS; }
}
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
function closeLayer() { layer.classList.remove('open', 'dim'); body.innerHTML = ''; state.sheet = null; }
function go(href) { const a = document.createElement('a'); a.href = href; document.body.appendChild(a); a.click(); a.remove(); }
// ---------- render
const dw = (cls, t) => `<span class="dotw ${cls}">${t}</span>`;
const kv = (k, v) => `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`;
const rateLine = m => [m.daily != null && `<span class="mono">${money(m.daily)}</span>/day`, m.weekly != null && `<span class="mono">${money(m.weekly)}</span>/wk`].filter(Boolean).join(' · ');
const rateText = m => [m.daily != null && `${money(m.daily)}/day`, m.weekly != null && `${money(m.weekly)}/wk`].filter(Boolean).join(' · ');
function render() {
  renderHead(); renderTabs();
  $$('.pane').forEach(p => p.hidden = p.id !== 'pane-' + state.tab);
  $('#rbody').classList.toggle('hasrail', state.tab !== 'overview');
  renderBanner();
  ({ overview:renderOverview, assets:renderAssets, checks:renderChecks, documents:renderDocs, photos:renderPhotos, roi:renderRoi })[state.tab]();
  renderRail(); renderBulk(); writeUrl();
}
function renderHead() {
  const m = state.model;
  $('#titlerow').innerHTML = `<h1 class="h1">${esc(m.name)}</h1>${m.active ? dw('ok', 'Active') : dw('', 'Archived')}`;
  $('#metarow').innerHTML = `<span>${esc(m.category)}</span>${rateText(m) ? `<span>·</span><span>${rateLine(m)}</span>` : ''}`;
  $('#phonesub').textContent = `${m.category} · ${rateText(m)}`;
  const prim = m.active ? `<button class="btn btn-primary" data-act="new">+ New asset</button>` : `<button class="btn btn-primary" data-act="restore">Restore model</button>`;
  $('#actions').innerHTML = `${prim}<button class="btn btn-icon" data-act="pagemenu" aria-label="Page actions">⋯</button>`;
  $('#phoneprimary').outerHTML = m.active ? `<button class="btn btn-primary" data-act="new" id="phoneprimary">+ New asset</button>` : `<button class="btn btn-primary" data-act="restore" id="phoneprimary">Restore model</button>`;
}
function renderTabs() {
  const T = [['overview','Overview',''],['assets','Assets',owned()],['checks','Checks',state.checks.length],['documents','Documents',state.docs.length],['photos','Photos',state.photos.length],['roi','ROI','']];
  $('#tabs').innerHTML = T.map(([k, n, c]) => `<button class="${state.tab === k ? 'on' : ''}" data-act="tab" data-k="${k}">${n}${c !== '' ? ` <span class="n">${c}</span>` : ''}</button>`).join('');
}
function renderBanner() {
  const m = state.model;
  $('#banner').innerHTML = m.active ? '' : `<div class="quiet" style="margin-bottom:18px"><span>Archived. Hidden from the catalog and new quotes; its ${owned()} assets and every booking stay as they were.</span><button class="lnk" data-act="restore">Restore model</button></div>`;
}
function accRow(c, compact) {
  return `<div class="rrow ${compact ? 'flat' : ''}"><span class="num" style="min-width:24px">${c.qty}×</span><div class="grow"><div class="ttl ell" style="font-weight:${compact ? 500 : 600}">${esc(c.name)}</div>${compact ? '' : `<div class="meta"><span>${c.kind === 'bulk' ? 'bulk stock' : 'not in inventory'}</span></div>`}</div><span class="muted t-small">${c.incl === 'OPTIONAL' ? 'optional' : 'default'}</span><button class="dots" data-act="accmenu" data-id="${c.id}" aria-label="Accessory actions">${ICON.dots}</button></div>`;
}
function health() {
  const out = [], s = n => n === 1 ? '' : 's';
  state.assets.filter(a => a.status === 'IN_MAINTENANCE').forEach(a => out.push({ text:`<span class="mono">${a.tag}</span> in service${a.maintDue ? ` <span class="muted">· back ${fmtDay(a.maintDue)}</span>` : ''}`, act:'Open', href:U.ASSET }));
  const od = state.assets.filter(ttOverdue); if (od.length) out.push({ text:`${od.length} unit${s(od.length)} overdue for test &amp; tag <span class="muted">· ${od.map(a => `<span class="mono">${a.tag}</span>`).join(', ')}</span>`, act:'Review', go:'due' });
  fails().filter(f => f.pct >= 25).forEach(f => out.push({ text:`${esc(f.label)} fails ${f.pct}% of checks`, act:'Checks', tab:'checks', bad:true }));
  return out;
}
function renderOverview() {
  const m = state.model, held = state.assets.filter(a => a.status === 'RESERVED'), todo = health(), p = primaryPhoto();
  const yrs = roiSum(ROI_Y), tops = fails().slice(0, 3);
  const minFree = Math.min(...Array.from({ length:14 }, (_, i) => freeOn(addD(TODAY, i + 1))));
  const stock = `${owned()} owned · ${cnt('DEPLOYED')} out · ${cnt('IN_MAINTENANCE')} in service`;
  $('#pane-overview').innerHTML = `
  <section class="hero">
    <div><div class="photo" style="${photoBg(p)}">${p ? `<span class="cap">${esc(p.name)}</span><span class="cap2">Primary · ${state.photos.length} photo${state.photos.length === 1 ? '' : 's'}</span>` : ''}</div><div class="links"><button class="lnk" data-act="tab" data-k="photos">All photos ›</button></div></div>
    <div id="stock">
      <div class="ovl">Stock</div>
      <h2>${stock}</h2>
      <p class="lead">${cnt('AVAILABLE')} free${held.length ? ` · ${held.length} held for <span class="mono">${esc(held[0].job.num)}</span> ${esc(held[0].job.name)}` : ''}</p>
      ${todo.length ? `<ul class="todo">${todo.map(t => `<li>${t.href ? `<a href="${t.href}">` : `<button data-act="${t.tab ? 'tab' : 'goassets'}" data-k="${t.tab || t.go}">`}<span class="dot ${t.bad ? 'bad' : ''}"></span><span class="grow">${t.text}</span><span class="more">${t.act} ›</span>${t.href ? '</a>' : '</button>'}</li>`).join('')}</ul>` : ''}
      <p class="t-micro muted" style="margin:10px 0 0">${minFree >= 3 ? `Free units never drop below ${minFree} in the next 14 days` : `Free units drop to ${minFree} in the next 14 days`}</p>
    </div>
  </section>
  <section class="sec2 facts3">
    <div><div class="ovl">Earning</div><div class="ln"><b class="mono">${money(yrs)}</b> <span class="muted">· last 12 months</span></div><div class="ln muted">${plural(ROI_Y.length, 'job')} · <span class="mono">${money(yrs / owned())}</span> per unit</div><div class="links"><button class="lnk" data-act="tab" data-k="roi">ROI ›</button></div></div>
    <div><div class="ovl">Value</div><div class="ln">Replacement <b class="mono">${money(m.replacement)}</b> <span class="muted">each</span></div><div class="ln muted">${m.replacement != null ? `<span class="mono">${money(m.replacement * owned())}</span> across ${owned()} units` : 'No replacement cost set'}${m.monthly != null ? ` · <span class="mono">${money(m.monthly)}</span>/mo rate` : ''}</div><div class="links"><button class="lnk" data-act="edit">Edit pricing</button></div></div>
    <div><div class="ovl">Reliability</div>${tops.length ? tops.map(f => `<div class="ln">${esc(f.label)} <b class="mono">${f.pct}%</b> ${f.pct >= 25 ? dw('err', 'high') : ''}</div>`).join('') : `<div class="ln muted">No check data yet</div>`}<div class="links"><button class="lnk" data-act="tab" data-k="checks">Checks ›</button></div></div>
  </section>
  <section class="sec2" id="booked">
    <div class="sh2">Booked <span class="n">${state.bookings.length}</span><span class="r"><button class="lnk" data-act="sched">Schedule ›</button></span></div>
    <div class="ovl" style="margin:8px 0 2px">Free units · next 14 days</div>
    <div class="free">${Array.from({ length:14 }, (_, i) => { const d = addD(TODAY, i + 1), f = freeOn(d), low = f * 2 <= owned(); return `<div class="${low ? 'low' : ''}" title="${fmtDay(d)} · ${f} free"><i>${dow(d).slice(0, 2)} ${+d.slice(8)}</i>${f}</div>`; }).join('')}</div>
    <div style="margin-top:10px">${state.bookings.map(b => `<a class="rrow" href="${U.OV}"><span class="num" style="min-width:48px">${b.num}</span><span class="grow"><span class="ttl ell" style="display:block">${esc(b.name)}</span><span class="meta"><span>${b.from === b.to ? fmtD(b.from) : fmtRange(b.from, b.to)}</span></span></span><span class="mono t-small muted">×${b.qty}</span>${dw(b.cls, b.status)}</a>`).join('')}</div>
  </section>
  <section class="sec2" id="accs">
    <div class="sh2">Accessories <span class="n">${state.acc.length}</span><span class="r"><button class="lnk" data-act="accadd">+ Add</button></span></div>
    <p class="t-micro muted" style="margin:0 0 6px">Every asset of this model brings these. Optional ones are picked when the job is built.</p>
    ${state.acc.map(c => accRow(c)).join('') || `<div class="empty" style="padding:18px 0;text-align:left"><b>No accessories</b>Add what always travels with a unit: a power lead, a safety bond, a clamp.</div>`}
  </section>
  <section class="sec2 facts3">
    <div><div class="ovl">Model</div>${kv('Manufacturer', esc(m.manufacturer || '—'))}${kv('Model number', `<span class="mono">${esc(m.modelNumber || '—')}</span>`)}${kv('SKU', `<span class="mono">${esc(m.sku || '—')}</span>`)}${kv('Category', esc(m.category || '—'))}${kv('Type', esc(m.type))}</div>
    <div><div class="ovl">Technical</div>${kv('Weight', m.weight != null ? `<span class="mono">${m.weight} kg</span>` : '—')}${kv('Power draw', m.power != null ? `<span class="mono">${m.power} W</span>` : '—')}${m.specs.map(([k, v]) => kv(esc(k), esc(v))).join('')}</div>
    <div><div class="ovl">Compliance</div>${kv('Test &amp; tag', m.tt ? 'Required' : 'Not required')}${m.tt ? kv('Test profile', esc(m.ttProfile || '—')) + kv('Validity', m.ttDays ? `<span class="mono">${m.ttDays} days</span>` : 'Org default') : ''}${kv('Preventative service', `<button class="lnk" data-act="sched2">Schedules ›</button>`)}<div class="links"><button class="lnk" data-act="edit">Edit model</button></div></div>
  </section>
  ${m.description ? `<section class="sec2"><div class="ovl">Description</div><p class="ln muted" style="margin:0;max-width:760px">${esc(m.description)}</p></section>` : ''}
  <section class="sec2"><div class="ovl">Recent</div>${state.activity.slice(0, 4).map(([w, what, when]) => `<div class="ln muted"><b style="color:var(--ink-2)">${esc(w)}</b> ${esc(what)} <span class="faint">· ${esc(when)}</span></div>`).join('')}<div class="links"><button class="lnk" data-act="noop">All activity ›</button></div></section>`;
}
function renderRail() {
  const m = state.model, t = state.tab; if (t === 'overview') { $('#rail').innerHTML = ''; return; }
  $('#rail').innerHTML = `
   ${t !== 'assets' ? `<div class="rs"><div class="ovl">Stock</div><div class="ln"><b>${owned()} owned · ${cnt('DEPLOYED')} out · ${cnt('IN_MAINTENANCE')} in service</b></div></div>` : ''}
   <div class="rs"><div class="ovl">Value</div>${kv('Replacement', `<span class="mono">${money(m.replacement)}</span>`)}${kv('Monthly rate', `<span class="mono">${money(m.monthly)}</span>`)}<div class="links"><button class="lnk" data-act="edit">Edit model</button></div></div>
   <div class="rs"><div class="ovl">Model</div>${kv('Manufacturer', esc(m.manufacturer || '—'))}${kv('Model number', `<span class="mono">${esc(m.modelNumber || '—')}</span>`)}${kv('SKU', `<span class="mono">${esc(m.sku || '—')}</span>`)}${kv('Type', esc(m.type))}${kv('Test &amp; tag', m.tt ? 'Required' : 'Not required')}</div>
   <div class="rs"><div class="ovl">Technical</div>${kv('Weight', m.weight != null ? `<span class="mono">${m.weight} kg</span>` : '—')}${kv('Power draw', m.power != null ? `<span class="mono">${m.power} W</span>` : '—')}${m.specs.map(([k, v]) => kv(esc(k), esc(v))).join('')}</div>
   <div class="rs"><div class="sh2">Accessories <span class="n">${state.acc.length}</span><span class="r"><button class="lnk" data-act="accadd">+ Add</button></span></div>${state.acc.map(c => accRow(c, true)).join('') || '<div class="ln muted">None yet</div>'}</div>
   <div class="rs"><div class="ovl">Recent</div>${state.activity.slice(0, 3).map(([w, what, when]) => `<div class="ln muted" style="font-size:12.5px"><b style="color:var(--ink-2)">${esc(w.split(' ')[0])}</b> ${esc(what)} <span class="faint">· ${esc(when)}</span></div>`).join('')}</div>`;
}
// ---- Assets tab: the Assets list, filtered to this model (no head, no model column)
function renderAssets() {
  $('#strip').innerHTML = GROUPS.map(([k, n]) => { const c = state.assets.filter(a => inGroup(a, k)).length; return `<button class="${state.group === k ? 'on' : ''}" data-act="group" data-k="${k}" style="${k === 'attention' && c ? 'color:var(--t-out)' : ''}">${n} <span class="n">${c}</span></button>`; }).join('');
  const f = state.f, lbl = a => a.length ? (a.length > 1 ? a.length + ' chosen' : a[0]) : '';
  $('#fwords').innerHTML = filterWord('Location', 'location', lbl(f.location), 'fmenu') + filterWord('Condition', 'condition', lbl(f.condition), 'fmenu') + ((f.location.length || f.condition.length || state.q) ? `<button class="lnk muted" data-act="clearf">Clear</button>` : '');
  const all = rows(), pageRows = all.slice(state.page * state.size, (state.page + 1) * state.size), S = state.sel.assets, allSel = pageRows.length && pageRows.every(a => S.has(a.id));
  const dueCell = a => { const d = nextDue(a); if (!d) return '<span class="faint">—</span>'; const od = d[1] < TODAY, soon = dueSoon(a); return `<span class="${od ? 'dotw err' : soon ? 'dotw warn' : 'muted'}" style="font-size:12.5px">${od ? `${d[0]} ${dayNum(TODAY) - dayNum(d[1])}d overdue` : `${d[0]} ${fmtD(d[1])}`}</span>`; };
  const condWord = a => `<span class="${a.condition === 'Needs repair' ? 'dotw err' : a.condition === 'Poor' ? 'dotw warn' : 'muted'}" style="font-size:12.5px">${a.condition}</span>`;
  const sw = a => { const [n, c] = STATUS[a.status]; return `<span class="dotw ${c}">${n}</span>`; };
  let h = `<table class="tbl" style="min-width:0;table-layout:fixed;width:100%"><colgroup><col style="width:34px"><col style="width:96px"><col style="width:116px"><col style="width:104px"><col style="width:112px"><col style="width:128px"><col style="width:136px"><col><col style="width:40px"></colgroup><thead><tr><th><button class="cb ${allSel ? 'on' : ''}" data-act="selall" aria-label="Select page"></button></th>${sortHead('Tag', 'tag')}${sortHead('Serial', 'serial')}${sortHead('Status', 'status')}${sortHead('Condition', 'condition')}${sortHead('Location', 'location')}${sortHead('Next due', 'due')}${sortHead('On job', 'job')}<th></th></tr></thead><tbody>`;
  if (!pageRows.length) h += `<tr><td colspan="9"><div class="empty">${state.q || f.location.length || f.condition.length ? `<b>No assets match that</b>Loosen a filter or clear them. <button class="lnk" data-act="clearf">Clear filters</button>` : state.group === 'attention' ? `<b>Nothing needs attention</b>No missing units, nothing overdue for test &amp; tag, nothing marked for repair.` : !state.assets.length ? `<b>No assets yet</b>Add the first unit of this model. <button class="lnk" data-act="new">New asset</button>` : `<b>None in this segment</b>Every unit sits in another segment.`}</div></td></tr>`;
  for (const a of pageRows) {
    const sel = S.has(a.id);
    h += `<tr class="row ${sel ? 'sel' : ''}" data-act="open" data-id="${a.id}"><td><button class="cb ${sel ? 'on' : ''}" data-act="select" data-k="assets" data-id="${a.id}" aria-label="Select ${esc(a.tag)}"></button></td><td><a class="mono" href="${U.ASSET}" style="font-size:12.5px;color:var(--ink)">${esc(a.tag)}</a></td><td class="mono t-small muted">${esc(a.serial)}</td><td>${sw(a)}</td><td>${condWord(a)}</td><td class="t-small"><div class="ell">${a.status === 'DEPLOYED' ? '<span class="faint">on job</span>' : esc(a.location)}</div>${a.shelf ? `<div class="sub ell">${esc(a.shelf)}</div>` : ''}</td><td>${dueCell(a)}</td><td class="t-small" style="min-width:0">${a.job ? `<a href="${U.OV}" style="color:var(--blue);font-weight:500"><div class="mono ell" style="font-size:12px">${esc(a.job.num)}</div><div class="sub ell" style="color:var(--muted)">${esc(a.job.name)}</div></a>` : '<span class="faint">—</span>'}</td><td class="r"><button class="dots" data-act="rowmenu" data-id="${a.id}" aria-label="Asset actions">${ICON.dots}</button></td></tr>`;
  }
  $('#tblwrap').innerHTML = h + '</tbody></table>';
  const pr = all.slice(0, (state.page + 1) * state.size);
  $('#list').innerHTML = pr.map(a => { const sel = S.has(a.id), d = nextDue(a); return `<div class="lrow ${sel ? 'sel' : ''}" data-act="open" data-id="${a.id}"><button class="cb ${sel ? 'on' : ''}" data-act="select" data-k="assets" data-id="${a.id}" aria-label="Select ${esc(a.tag)}"></button><div class="grow" style="min-width:0"><div class="ttl ell mono" style="font-size:15px">${esc(a.tag)}</div><div class="sub ell">${a.job ? `${esc(a.job.num)} ${esc(a.job.name)}` : `${esc(a.location)}${a.shelf ? ' · ' + esc(a.shelf) : ''}`}</div>${overdue(a) || a.condition === 'Needs repair' ? `<div class="sub" style="display:flex;gap:10px">${overdue(a) ? dueCell(a) : ''}${a.condition === 'Needs repair' ? condWord(a) : ''}</div>` : ''}</div><div class="right">${sw(a)}</div><button class="dots" data-act="rowmenu" data-id="${a.id}" aria-label="Asset actions">${ICON.dots}</button></div>`; }).join('') || `<div class="empty"><b>No assets match that</b><button class="lnk" data-act="clearf">Clear filters</button></div>`;
  if (all.length > pr.length) $('#list').innerHTML += `<button class="lrow" data-act="more" style="justify-content:center;color:var(--blue);font-weight:600">Show ${Math.min(state.size, all.length - pr.length)} more · ${all.length - pr.length} left</button>`;
  $('#foot').innerHTML = pager(all.length, 'assets');
}
// ---- Checks tab
function renderChecks() {
  const S = state.sel.checks, cs = state.checks, allSel = cs.length && cs.every(c => S.has(c.id)), fs = fails().filter(f => f.fail[1] > 0);
  let h = `<div class="sh2">${cs.length ? `<button class="cb ${allSel ? 'on' : ''}" data-act="selall" data-k="checks" aria-label="Select all checks"></button>` : ''}Checks <span class="n">${cs.length}</span><span class="r"><button class="lnk" data-act="addcheck">+ Add check</button></span></div><p class="t-micro muted" style="margin:0 0 6px">These appear during warehouse prep and return, in this order.</p>`;
  h += cs.length ? cs.map((c, i) => `<div class="rrow ${S.has(c.id) ? 'sel' : ''}"><button class="cb ${S.has(c.id) ? 'on' : ''}" data-act="select" data-k="checks" data-id="${c.id}" aria-label="Select ${esc(c.label)}"></button><span class="num" style="min-width:18px">${i + 1}</span><div class="grow"><div class="ttl ell">${esc(c.label)}</div>${c.desc ? `<div class="meta"><span>${esc(c.desc)}</span></div>` : ''}</div><span class="muted t-small">${TYPE_LABEL[c.type]}</span><button class="dots" data-act="checkmenu" data-id="${c.id}" aria-label="Check actions">${ICON.dots}</button></div>`).join('') : `<div class="empty" style="text-align:left;padding:24px 0"><b>No checks assigned</b>Add check items from the <a class="lnk" href="${U.SETTINGS}">library</a> to run quality checks on this model during prep and return. <button class="lnk" data-act="addcheck">Add check</button></div>`;
  h += `<div class="sh2" style="margin-top:34px">Failure rates <span class="n">${fs.length ? plural(fs.length, 'check') + ' with data' : ''}</span></div>`;
  h += fs.length ? fs.map(f => `<div class="rrow flat" style="display:block;padding:10px 0"><div style="display:flex;gap:12px;align-items:baseline"><span class="ttl grow ell" style="font-size:13.5px;font-weight:500">${esc(f.label)}</span>${f.pct >= 25 ? dw('err', 'high') : ''}<span class="mono t-small" style="color:var(--muted)">${f.pct}% · ${f.fail[0]} of ${f.fail[1]}</span></div><div class="fbar"><i class="${f.pct >= 25 ? 'hi' : ''}" style="width:${Math.max(f.pct, 2)}%"></i></div></div>`).join('') : `<div class="empty" style="text-align:left;padding:18px 0"><b>No check data yet</b>Failure rates appear after checks are run on units of this model.</div>`;
  $('#pane-checks').innerHTML = h;
}
// ---- Documents tab (files rows, same shape as Tasks & notes files)
const fmtSize = b => b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' KB';
function renderDocs() {
  const S = state.sel.documents, ds = state.docs, allSel = ds.length && ds.every(d => S.has(d.id));
  $('#pane-documents').innerHTML = `<div class="sh2">${ds.length ? `<button class="cb ${allSel ? 'on' : ''}" data-act="selall" data-k="documents" aria-label="Select all documents"></button>` : ''}Manuals &amp; documents <span class="n">${ds.length}</span><span class="r"><span class="t-micro faint deskonly">or drop files here</span><button class="lnk" data-act="upload">Upload</button></span></div>`
   + (ds.length ? ds.map(d => `<div class="rrow ${S.has(d.id) ? 'sel' : ''}"><button class="cb ${S.has(d.id) ? 'on' : ''}" data-act="select" data-k="documents" data-id="${d.id}" aria-label="Select ${esc(d.name)}"></button><span class="thumbf">${esc(d.name.split('.').pop().toUpperCase())}</span><div class="grow"><button class="ttl ell" style="display:block;max-width:100%" data-act="docopen" data-id="${d.id}">${esc(d.name)}</button><div class="meta"><span>${fmtSize(d.size)}</span><span>${esc(d.by.split(' ')[0])} · ${fmtD(d.at)}</span></div></div><button class="dots" data-act="docmenu" data-id="${d.id}" aria-label="Document actions">${ICON.dots}</button></div>`).join('') : `<div class="empty" style="text-align:left;padding:24px 0"><b>No documents yet</b>Keep the manual, DMX chart and service bulletins with the model so the warehouse can find them. <button class="lnk" data-act="upload">Upload</button></div>`);
}
// ---- Photos tab
function renderPhotos() {
  const S = state.sel.photos, ps = state.photos, allSel = ps.length && ps.every(p => S.has(p.id));
  $('#pane-photos').innerHTML = `<div class="sh2">${ps.length ? `<button class="cb ${allSel ? 'on' : ''}" data-act="selall" data-k="photos" aria-label="Select all photos"></button>` : ''}Photos <span class="n">${ps.length}</span><span class="r"><span class="t-micro faint deskonly">The primary is the Overview hero</span><button class="lnk" data-act="photoup">Upload</button><button class="lnk phoneonly" data-act="photoup">Take photo</button></span></div>`
   + (ps.length ? `<div class="pgrid" style="margin-top:12px">${ps.map(p => `<div class="pt ${S.has(p.id) ? 'sel' : ''}"><div class="pimg" style="${photoBg(p)}" data-act="photoview" data-id="${p.id}"><button class="cb ${S.has(p.id) ? 'on' : ''}" data-act="select" data-k="photos" data-id="${p.id}" aria-label="Select ${esc(p.name)}"></button><button class="dots" data-act="photomenu" data-id="${p.id}" aria-label="Photo actions">${ICON.dots}</button></div><div class="cap"><span class="mono ell" style="max-width:150px">${esc(p.name)}</span>${p.primary ? dw('ok', 'Primary') : ''}</div></div>`).join('')}</div>` : `<div class="empty" style="text-align:left;padding:24px 0"><b>No photos yet</b>The first one you add becomes the primary. <button class="lnk" data-act="photoup">Upload</button></div>`);
}
// ---- ROI tab: revenue by default; cost and payback are opt-in
function renderRoi() {
  const r = state.roi, rs = roiRows(), rev = roiSum(rs), n = owned(), cost = fleetCost(), pay = cost ? rev / cost : null, still = cost != null ? Math.max(0, cost - rev) : null;
  const wd = (on, act, k, t) => `<button class="wd ${on ? 'on' : ''}" data-act="${act}" data-k="${k}">${t}</button>`;
  const shown = rs.slice(0, r.more);
  $('#pane-roi').innerHTML = `
  <div class="subtools">
    ${wd(r.scope === 'earned', 'roiscope', 'earned', 'Completed &amp; invoiced')}${wd(r.scope === 'booked', 'roiscope', 'booked', 'Including booked work')}
    <span class="faint">·</span>${wd(!r.all, 'roiwin', '12m', 'Last 12 months')}${wd(r.all, 'roiwin', 'all', 'All time')}
    <span class="grow"></span>
    <button class="wd ${r.cost ? 'on' : ''}" data-act="roicost">${r.cost ? 'Cost &amp; payback shown ✕' : 'Show cost &amp; payback'}</button>
    <span class="tipw"><!-- Tooltip must sit inside a TooltipProvider; there is no global one (model-roi-tab.smoke.test.tsx) --><button class="tipb" data-act="tip" aria-describedby="roitip">How is revenue counted?</button><span class="tipc" id="roitip" role="tooltip">Revenue is this model’s share of every job it went out on, including its slice of any kit or bundle price. Sub-hired units are excluded: that wasn’t your capital.</span></span>
  </div>
  ${r.all && r.scope === 'booked' ? `<div class="quiet" style="margin:10px 0 0">Partial picture: this model hit a scan limit. Revenue may be understated${r.cost ? ' and payback overstated' : ''}. Narrow the date range for exact figures.</div>` : ''}
  <div class="figs" style="padding-top:16px">
    <div><div class="ovl">Revenue attributed</div><div class="fig">${money(rev)}</div></div>
    <div><div class="ovl">Revenue per unit</div><div class="fig">${money(rev / n)}</div><div class="t-micro muted" style="margin-top:2px">${plural(n, 'unit')} owned</div></div>
    ${r.cost ? `<div><div class="ovl">Fleet cost</div><div class="fig">${cost != null ? money(cost) : '—'}</div><div class="t-micro muted" style="margin-top:2px">${plural(n, 'unit')} × <span class="mono">${money(state.model.purchase)}</span> purchase</div></div><div><div class="ovl">Paid for itself</div><div class="fig">${fmtPayback(pay)}</div></div>` : ''}
  </div>
  ${r.cost ? (cost == null ? `<p class="t-small muted" style="margin:-6px 0 18px">Set a purchase price on this model’s assets, or a default purchase price or replacement cost on the model, to see how far it is from paying for itself.</p>` : `<div style="margin:-6px 0 22px;max-width:560px"><div style="display:flex;justify-content:space-between;font-size:13px"><span>Cost recovered</span><span class="mono muted">${still > 0 ? `${money(still)} to break even` : 'Fully recovered'}</span></div><div class="fbar" style="height:5px"><i style="width:${Math.min(100, pay * 100)}%;background:var(--ok)"></i></div></div>`) : ''}
  <div class="sh2" style="padding-top:8px">Where it earned <span class="n">${rs.length}</span></div>
  ${rs.length ? shown.map(p => `<a class="rrow" href="${U.OV}"><span class="num" style="min-width:48px">${p.num}</span><span class="grow"><span class="ttl ell" style="display:block">${esc(p.name)}</span><span class="meta"><span>${fmtD(p.date)} ${p.date.slice(0, 4)}</span></span></span>${p.status === 'Invoiced' ? '' : dw(p.status === 'Quoted' ? 'info' : 'ok', p.status)}<span class="amt">${money(p.rev)}</span></a>`).join('') : `<div class="empty" style="text-align:left;padding:24px 0"><b>No revenue in this window</b>Widen the date range, or include booked work that hasn’t been invoiced yet.</div>`}
  <div class="lpfoot"><span>Totals · <span class="mono" style="color:var(--ink)">${money(rev)}</span> · ${plural(rs.length, 'job')}</span>${rs.length > shown.length ? `<button class="lnk" style="margin-left:auto" data-act="roimore">Show ${Math.min(25, rs.length - shown.length)} more · ${rs.length - shown.length} left</button>` : ''}</div>`;
}
// ---- bulk bar (the active tab's selection)
function renderBulk() {
  const k = state.tab, S = state.sel[k], n = S ? S.size : 0, b = $('#bulk'); b.classList.toggle('open', n > 0); document.body.classList.toggle('hassel', n > 0); if (!n) return;
  const clear = `<button class="btn btn-icon btn-sm" data-act="clearsel" aria-label="Clear selection">✕</button>`, danger = 'style="color:var(--t-out)"';
  if (k === 'assets') { const sel = state.assets.filter(a => S.has(a.id)), out = sel.filter(a => a.status === 'DEPLOYED').length; b.innerHTML = `<b style="font-size:13px">${n} selected</b><button class="btn btn-secondary btn-sm" data-act="bulkedit">Edit ${n}…</button><button class="btn btn-secondary btn-sm" data-act="bulkmove">Move ${n}…</button><button class="btn btn-secondary btn-sm" data-act="bulkmaint">Schedule service ${n}</button><button class="btn btn-secondary btn-sm deskonly" data-act="bulklabels">Print labels ${n}</button>${out ? `<button class="btn btn-secondary btn-sm" data-act="bulkreturn">Force return ${out}</button>` : ''}<button class="btn btn-secondary btn-sm" ${danger} data-act="bulkretire">Retire ${n}</button>${clear}`; }
  else b.innerHTML = `<b style="font-size:13px">${n} selected</b><button class="btn btn-secondary btn-sm" ${danger} data-act="bulkdel">Remove ${n}</button>${clear}`;
}
const clearSel = () => { for (const s of Object.values(state.sel)) s.clear(); };
function writeUrl() { try { const p = new URLSearchParams(); if (state.tab !== 'overview') p.set('tab', state.tab); history.replaceState(null, '', location.pathname + (p.toString() ? '?' + p : '')); } catch (e) { /* sandboxed preview: the URL stays as is */ } }
// ---------- sheets
function openSheet(html, focusSel) { body.innerHTML = html; layer.classList.add('open', 'dim'); const f = focusSel && $(focusSel, body); if (f) f.focus(); }
const fv = v => v == null ? '' : String(v);
const numOrNull = s => { s = String(s).trim(); if (s === '') return null; const n = Number(s); return n; };
function editHtml() {
  const s = state.sheet, d = s.draft, e = s.errs || {}, dup = s.mode === 'dup';
  const inp = (f, label, o = {}) => field(label, `<input data-f="${f}" value="${esc(d[f])}" ${o.ph ? `placeholder="${o.ph}"` : ''} ${o.num ? 'inputmode="decimal"' : ''} ${e[f] ? 'aria-invalid="true"' : ''}>${e[f] ? `<span class="errm">${e[f]}</span>` : ''}`, o.hint || '');
  const sw = (f, label, hint) => `<div class="swrow" data-act="dsw" data-f="${f}"><span class="sw ${d[f] ? 'on' : ''}"><i></i></span><span>${label}${hint ? ` <span class="muted t-small">· ${hint}</span>` : ''}</span></div>`;
  return `<div class="esheet" role="dialog" aria-modal="true" aria-label="${dup ? 'New model' : 'Edit model'}">
  <div class="eshd"><div class="t-overline">${dup ? 'New model · copied from ' + esc(state.model.name) : 'Model'}</div><h2>${dup ? 'Duplicate model' : 'Edit ' + esc(state.model.name)}</h2>${dup ? `<div class="t-micro muted" style="margin-top:4px">Copies rates, specifications, the accessory plan and checks. Assets, photos and documents stay with the original.</div>` : ''}</div>
  <div class="esbd">
   <div class="esec"><div class="sh2">Identity</div><div class="egrid">
     <div class="full">${inp('name', 'Name *')}</div>
     ${inp('manufacturer', 'Manufacturer', { ph:'e.g. Martin' })}${inp('modelNumber', 'Model number')}${inp('sku', 'SKU')}
     ${field('Category', `<select data-f="category">${['Lighting','Audio','Video','Rigging','Cable','Staging'].map(c => opt(c, c, d.category)).join('')}</select>`)}
     ${field('Asset type', `<select data-f="type">${opt('Serialised', 'Serialised · one tag per unit', d.type)}${opt('Bulk', 'Bulk · counted by quantity', d.type)}</select>`)}
     <div class="full">${field('Description', `<textarea data-f="description" rows="3">${esc(d.description)}</textarea>`)}</div></div></div>
   <div class="esec"><div class="sh2">Pricing</div><div class="egrid">
     ${inp('daily', 'Daily rate ($)', { num:1, ph:'0.00' })}${inp('weekly', 'Weekly rate ($)', { num:1, ph:'0.00' })}${inp('monthly', 'Monthly rate ($)', { num:1, ph:'0.00' })}
     ${inp('purchase', 'Purchase price ($)', { num:1, ph:'0.00', hint:'Cost: shown only on the ROI tab, behind Show cost' })}${inp('replacement', 'Replacement cost ($)', { num:1, ph:'0.00' })}
     ${inp('salePrice', 'Sale price ($)', { num:1, ph:'0.00', hint:'Auto-fills a Sale line’s unit price. Leave blank to enter it by hand.' })}${inp('saleStock', 'Sale stock', { num:1, ph:'0', hint:'New-stock sale pool, independent of rental assets.' })}</div></div>
   <div class="esec"><div class="sh2">Xero coding</div><div class="egrid">${inp('xeroRental', 'Rental account', { ph:'Inherit category default' })}${inp('xeroSale', 'Sale account', { ph:'Inherit category default' })}</div></div>
   <div class="esec"><div class="sh2">Compliance &amp; technical</div><div class="egrid">
     ${inp('weight', 'Weight (kg)', { num:1, ph:'0.00' })}${inp('power', 'Power draw (W)', { num:1, ph:'0' })}
     <div class="full">${sw('tt', 'Requires test &amp; tag')}</div>
     ${d.tt ? `${field('Test profile', `<select data-f="ttProfile">${['Class I luminaire','Class II appliance','Extension lead','Power distribution'].map(c => opt(c, c, d.ttProfile)).join('')}</select>`)}${inp('ttDays', 'Test validity (days)', { num:1, ph:'Org default (365)', hint:'Leave blank to use the org’s test &amp; tag settings.' })}` : ''}</div></div>
   <div class="esec"><div class="sh2">Specifications <span class="n">${d.specs.length}</span></div>
     ${d.specs.map(([k, v], i) => `<div class="sprow"><span class="k">${esc(k)}</span><input data-sp="${i}" value="${esc(v)}" aria-label="${esc(k)}"><button class="lnk muted" data-act="specdel" data-i="${i}" aria-label="Remove ${esc(k)}">Remove</button></div>`).join('')}
     <div class="sprow add"><input id="sp-k" placeholder="Key (e.g. Frequency response)"><input id="sp-v" placeholder="Value (e.g. 50 Hz – 15 kHz)"><button class="lnk" data-act="specadd">Add</button></div>
     ${d.specs.length ? '' : `<div class="t-micro muted">No specifications yet. Enter a key and value, then Enter.</div>`}</div>
   <div class="esec"><div class="sh2">Tags and status</div><div class="egrid"><div class="full">${inp('tags', 'Tags', { ph:'wash, moving head', hint:'Comma separated' })}</div>
     <div class="full">${sw('active', 'Active', 'Off archives the model: hidden from the catalog and new quotes')}${sw('container', 'Packing container', 'Cases and racks that other gear is packed into')}</div></div></div>
  </div>
  <div class="esft"><span class="t-small muted" id="dirtymsg">${s.dirty ? 'Unsaved changes' : ''}</span><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="${dup ? 'dupgo' : 'editgo'}">${dup ? 'Create model' : 'Save'}</button></div></div>`;
}
function draftFrom(m) { return { name:m.name, manufacturer:m.manufacturer, modelNumber:m.modelNumber, sku:m.sku, category:m.category, type:m.type, description:m.description, daily:fv(m.daily), weekly:fv(m.weekly), monthly:fv(m.monthly), purchase:fv(m.purchase), replacement:fv(m.replacement), salePrice:fv(m.salePrice), saleStock:fv(m.saleStock), xeroRental:m.xeroRental, xeroSale:m.xeroSale, weight:fv(m.weight), power:fv(m.power), tt:m.tt, ttProfile:m.ttProfile, ttDays:fv(m.ttDays), specs:m.specs.map(x => [...x]), tags:m.tags.join(', '), active:m.active, container:m.container }; }
function validate(d) { const e = {}; if (!d.name.trim()) e.name = 'Name is required'; for (const f of ['daily','weekly','monthly','purchase','replacement','salePrice','saleStock','weight','power','ttDays']) { const n = numOrNull(d[f]); if (n !== null && (isNaN(n) || n < 0)) e[f] = 'Enter a number, 0 or more'; } if (d.ttDays !== '' && numOrNull(d.ttDays) !== null && !e.ttDays && numOrNull(d.ttDays) < 1) e.ttDays = 'At least 1 day'; return e; }
function modelFrom(d) { const n = numOrNull; return { ...state.model, name:d.name.trim(), manufacturer:d.manufacturer.trim(), modelNumber:d.modelNumber.trim(), sku:d.sku.trim(), category:d.category, type:d.type, description:d.description.trim(), daily:n(d.daily), weekly:n(d.weekly), monthly:n(d.monthly), purchase:n(d.purchase), replacement:n(d.replacement), salePrice:n(d.salePrice), saleStock:n(d.saleStock), xeroRental:d.xeroRental.trim(), xeroSale:d.xeroSale.trim(), weight:n(d.weight), power:n(d.power), tt:d.tt, ttProfile:d.ttProfile, ttDays:d.tt ? n(d.ttDays) : null, specs:d.specs.map(x => [...x]), tags:d.tags.split(',').map(x => x.trim()).filter(Boolean), active:d.active, container:d.container }; }
function openEdit(mode) { state.sheet = { mode, draft:draftFrom(state.model), errs:{}, dirty:false }; if (mode === 'dup') { state.sheet.draft.name += ' (copy)'; state.sheet.draft.active = true; state.sheet.dirty = true; } closeLayerKeep(); openSheet(editHtml(), '[data-f="name"]'); }
function closeLayerKeep() { const s = state.sheet; layer.classList.remove('open', 'dim'); body.innerHTML = ''; state.sheet = s; }
function rerenderSheet(focus) { const t = $('.esbd', body), top = t ? t.scrollTop : 0; openSheet(state.sheet.mode === 'asset' ? assetSheetHtml() : editHtml(), focus); const t2 = $('.esbd', body); if (t2) t2.scrollTop = top; }
const nextTag = () => { const mx = Math.max(...state.assets.map(a => +a.tag.split('-')[1])); return 'AURA-' + String(mx + 1).padStart(2, '0'); };
function assetSheetHtml() {
  const s = state.sheet, d = s.draft, e = s.errs || {};
  return `<div class="esheet" role="dialog" aria-modal="true" aria-label="New asset"><div class="eshd"><div class="t-overline">New asset</div><h2>${esc(state.model.name)}</h2><div class="t-micro muted" style="margin-top:4px">${state.model.type === 'Bulk' ? 'Bulk stock is counted by quantity, not by serial.' : 'One tagged unit. Rates, accessories and checks come from the model.'}</div></div>
  <div class="esbd"><div class="esec"><div class="egrid">
   ${field('Tag *', `<input data-f="tag" class="mono" value="${esc(d.tag)}" ${e.tag ? 'aria-invalid="true"' : ''}>${e.tag ? `<span class="errm">${e.tag}</span>` : ''}`, 'Suggested from the last tag')}
   ${field('Serial number', `<input data-f="serial" class="mono" value="${esc(d.serial)}" placeholder="From the unit's plate">`)}
   ${field('Location', `<select data-f="location">${LOCS.map(l => opt(l, l, d.location)).join('')}</select>`)}
   ${field('Condition', `<select data-f="condition">${['Good','Fair','Poor'].map(c => opt(c, c, d.condition)).join('')}</select>`)}
   ${field('Purchase price ($)', `<input data-f="price" inputmode="decimal" value="${esc(d.price)}" placeholder="Model default" ${e.price ? 'aria-invalid="true"' : ''}>${e.price ? `<span class="errm">${e.price}</span>` : ''}`, 'Blank uses the model default')}
   ${field('Test &amp; tag due', `<input data-f="tt" value="${esc(d.tt)}" placeholder="${state.model.tt ? 'Set on first test' : 'Not required'}" ${state.model.tt ? '' : 'disabled'}>`)}</div></div></div>
  <div class="esft"><span class="t-small muted" id="dirtymsg"></span><div style="flex:1"></div><button class="lnk muted" data-act="newgo" data-more="1">Create and add another</button><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="newgo">Create asset</button></div></div>`;
}
// ---------- menus
function multiMenu(el, key, title, options) { openMenu(el, title, [...options.map(o => ({ label:o, act:'ftoggle', args:`data-k="${key}" data-v="${o}"`, on:state.f[key].includes(o) })), '-', { label:'Clear', act:'fclear', args:`data-k="${key}"` }]); }
const selIds = k => [...state.sel[k]];
const orderOf = k => ({ assets:() => rows().map(x => x.id), checks:() => state.checks.map(x => x.id), documents:() => state.docs.map(x => x.id), photos:() => state.photos.map(x => x.id) })[k]();
function act(name, el, ev) {
  const id = el.dataset.id, k = el.dataset.k, a = id && state.tab === 'assets' ? asset(id) : null;
  switch (name) {
    case 'close': if (state.sheet && state.sheet.dirty) { openDialog(`<div class="hd"><div class="t-overline">${state.sheet.mode === 'asset' ? 'New asset' : 'Model'}</div><h2 style="font-size:18px">Discard your changes?</h2></div><div class="bd"><div class="t-small" style="line-height:1.5">Nothing has been saved yet.</div></div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="reopen">Keep editing</button><button class="btn btn-secondary" style="color:var(--t-out)" data-act="discard">Discard</button></div>`); } else closeLayer(); break;
    case 'reopen': rerenderSheet(); break;
    case 'discard': closeLayer(); break;
    case 'noop': closeLayer(); toast('Not wired in this prototype'); break;
    case 'models': closeLayer(); toast('Opens the Models list · same list pattern as Assets'); break;
    case 'sched': closeLayer(); toast('Opens Schedule filtered to this model · the month grid with every booking'); break;
    case 'sched2': closeLayer(); toast('Opens Maintenance › Due · service schedules for this model'); break;
    case 'tab': closeLayer(); clearSel(); state.tab = k; render(); window.scrollTo(0, 0); { const c = $('.content'); if (c) c.scrollTop = 0; } break;
    case 'goassets': state.tab = 'assets'; state.group = k; state.page = 0; clearSel(); render(); break;
    case 'tip': el.nextElementSibling.classList.toggle('open'); break;
    case 'new': closeLayer(); state.sheet = { mode:'asset', draft:{ tag:nextTag(), serial:'', location:'Warehouse A', condition:'Good', price:'', tt:'' }, errs:{}, dirty:false }; closeLayerKeep(); openSheet(assetSheetHtml(), '[data-f="tag"]'); break;
    case 'newgo': { const d = state.sheet.draft, e = {}; const tag = d.tag.trim(); if (!tag) e.tag = 'Tag is required'; else if (state.assets.some(x => x.tag.toLowerCase() === tag.toLowerCase())) e.tag = `${tag} already exists`; const pr = numOrNull(d.price); if (pr !== null && (isNaN(pr) || pr < 0)) e.price = 'Enter a number, 0 or more'; if (Object.keys(e).length) { state.sheet.errs = e; rerenderSheet(); break; } const undo = snapshot(); const more = el.dataset.more; state.assets.push(mkAsset(+tag.split('-')[1] || 99, 'AVAILABLE', { id:'a' + (state.assets.length + 1), tag, serial:d.serial.trim() || '—', location:d.location, shelf:'', condition:d.condition, ttDue:state.model.tt ? null : null })); state.page = 0; if (more) { state.sheet = { mode:'asset', draft:{ tag:nextTag(), serial:'', location:d.location, condition:'Good', price:'', tt:'' }, errs:{}, dirty:false }; rerenderSheet('[data-f="serial"]'); render(); toast(`${esc(tag)} created · ready for the next one`, undo); } else { closeLayer(); render(); toast(`${esc(tag)} created in ${esc(d.location)} · inherits rates, accessories and checks`, undo); } break; }
    case 'edit': closeLayer(); openEdit('edit'); break;
    case 'dsw': { const f = el.dataset.f, s = state.sheet; s.draft[f] = !s.draft[f]; s.dirty = true; rerenderSheet(); break; }
    case 'specadd': { const kx = $('#sp-k', body).value.trim(), vx = $('#sp-v', body).value.trim(); if (!kx) { $('#sp-k', body).focus(); break; } state.sheet.draft.specs.push([kx, vx]); state.sheet.dirty = true; rerenderSheet('#sp-k'); break; }
    case 'specdel': state.sheet.draft.specs.splice(+el.dataset.i, 1); state.sheet.dirty = true; rerenderSheet(); break;
    case 'editgo': { const d = state.sheet.draft, e = validate(d); if (Object.keys(e).length) { state.sheet.errs = e; rerenderSheet(); const bad = $('[aria-invalid="true"]', body); if (bad) { bad.scrollIntoView({ block:'center' }); bad.focus(); } break; } const undo = snapshot(), was = state.model.active; state.model = modelFrom(d); closeLayer(); render(); toast(was && !state.model.active ? `${esc(state.model.name)} archived` : `${esc(state.model.name)} saved`, undo); break; }
    case 'dupgo': { const d = state.sheet.draft, e = validate(d); if (Object.keys(e).length) { state.sheet.errs = e; rerenderSheet(); break; } const undo = snapshot(); state.dup++; closeLayer(); toast(`“${esc(d.name.trim())}” created · ${state.acc.length} accessories and ${state.checks.length} checks copied, no assets · opens its page`, undo); break; }
    case 'pagemenu': openMenu(el, state.model.name, [{ label:'Edit model…', act:'edit' }, { label:'Duplicate model…', act:'dupopen' }, { label:`Print labels for all ${owned()}`, act:'labelsall' }, '-', { label:'Models', act:'models' }, { label:'Schedule for this model', act:'sched' }, '-', ...(state.model.active ? [{ label:'Archive model…', act:'archive', danger:true }] : [{ label:'Restore model', act:'restore' }])]); break;
    case 'dupopen': closeLayer(); openEdit('dup'); break;
    case 'labelsall': closeLayer(); toast(`Label sheet for ${owned()} assets · opens the print dialog`); break;
    case 'archive': closeLayer(); openDialog(`<div class="hd"><div class="t-overline">Archive</div><h2 style="font-size:18px">Archive ${esc(state.model.name)}?</h2></div><div class="bd"><div class="t-small" style="line-height:1.55">It disappears from the catalog and from new quotes. Nothing is deleted:<ul style="margin:8px 0 0 18px;padding:0"><li>${owned()} assets stay in the registry, with their history and test &amp; tag records.</li><li>${cnt('DEPLOYED')} out on ${esc(J40.num)} ${esc(J40.name)} finish there, and ${cnt('RESERVED')} held for ${esc(J41.num)} ${esc(J41.name)} keep their reservation.</li><li>Quotes and invoices that already list it are unchanged.</li></ul><div style="margin-top:8px">Restore it any time from Models › Archived.</div></div></div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Keep it</button><button class="btn btn-secondary" style="color:var(--t-out)" data-act="archivego">Archive model</button></div>`); break;
    case 'archivego': { const undo = snapshot(); state.model.active = false; closeLayer(); render(); toast(`${esc(state.model.name)} archived · hidden from new quotes`, undo); break; }
    case 'restore': { const undo = snapshot(); state.model.active = true; closeLayer(); render(); toast(`${esc(state.model.name)} restored`, undo); break; }
    // ---- assets list
    case 'group': state.group = k; state.page = 0; clearSel(); render(); break;
    case 'sort': if (state.sort === k) state.dir = state.dir === 'asc' ? 'desc' : 'asc'; else { state.sort = k; state.dir = 'asc'; } render(); break;
    case 'page': state.page = Math.max(0, state.page + +el.dataset.d); render(); break;
    case 'more': state.page++; render(); break;
    case 'fmenu': if (k === 'location') multiMenu(el, 'location', 'Location', LOCS.filter(l => state.assets.some(x => x.location === l))); if (k === 'condition') multiMenu(el, 'condition', 'Condition', ['Good', 'Fair', 'Poor', 'Needs repair']); break;
    case 'ftoggle': { const arr = state.f[k], v = el.dataset.v, i = arr.indexOf(v); i >= 0 ? arr.splice(i, 1) : arr.push(v); state.page = 0; render(); act('fmenu', el); break; }
    case 'fclear': state.f[k] = []; closeLayer(); render(); break;
    case 'clearf': state.f = { location:[], condition:[] }; state.q = ''; $('#q').value = ''; state.page = 0; closeLayer(); render(); break;
    case 'open': if (ev && ev.target.closest('.cb,.dots,a')) break; closeLayer(); go(U.ASSET); break;
    case 'select': { const S = state.sel[k]; if (ev && ev.shiftKey && state.last[k]) { const order = orderOf(k), i1 = order.indexOf(state.last[k]), i2 = order.indexOf(id); for (const x of order.slice(Math.min(i1, i2), Math.max(i1, i2) + 1)) S.add(x); } else S.has(id) ? S.delete(id) : S.add(id); state.last[k] = id; render(); break; }
    case 'selall': { const kk = k || 'assets', S = state.sel[kk], list = kk === 'assets' ? rows().slice(state.page * state.size, (state.page + 1) * state.size).map(x => x.id) : orderOf(kk), all = list.every(x => S.has(x)); list.forEach(x => all ? S.delete(x) : S.add(x)); render(); break; }
    case 'clearsel': clearSel(); render(); break;
    case 'rowmenu': openMenu(el, `${a.tag} · ${esc(state.model.name)}`, [{ label:'Open', href:U.ASSET, small:'Asset' }, { label:'Edit…', act:'noop' }, ...(a.job ? [{ label:`Job ${a.job.num}`, href:U.OV, small:'Overview' }] : []), '-', { label:'Move to…', act:'movemenu', args:`data-id="${a.id}"` }, { label:'Schedule service…', act:'maintone', args:`data-id="${a.id}"` }, { label:'Print label', act:'noop' }, '-', ...(a.status === 'DEPLOYED' ? [{ label:'Force return', act:'returnone', args:`data-id="${a.id}"` }] : []), { label:a.status === 'RETIRED' ? 'Reinstate' : 'Retire…', act:'retireone', args:`data-id="${a.id}"`, danger:a.status !== 'RETIRED' }]); break;
    case 'movemenu': openMenu(el, `Move ${a.tag} to`, LOCS.map(l => ({ label:l, act:'moveone', args:`data-id="${a.id}" data-v="${l}"`, on:a.location === l }))); break;
    case 'moveone': { const undo = snapshot(); asset(id).location = el.dataset.v; closeLayer(); render(); toast(`${esc(asset(id).tag)} moved to ${esc(el.dataset.v)}`, undo); break; }
    case 'maintone': { const undo = snapshot(), x = asset(id); x.maintDue = addD(TODAY, 3); if (x.status === 'AVAILABLE') x.status = 'IN_MAINTENANCE'; closeLayer(); render(); toast(`Service scheduled for ${esc(x.tag)} · ${fmtD(x.maintDue)}`, undo); break; }
    case 'returnone': { const undo = snapshot(), x = asset(id); x.status = 'AVAILABLE'; x.job = null; x.location = 'Warehouse A'; closeLayer(); render(); toast(`${esc(x.tag)} returned to Warehouse A · the job's line keeps its history`, undo); break; }
    case 'retireone': { const undo = snapshot(), x = asset(id); x.status = x.status === 'RETIRED' ? 'AVAILABLE' : 'RETIRED'; closeLayer(); render(); toast(x.status === 'RETIRED' ? `${esc(x.tag)} retired · hidden from availability, history kept` : `${esc(x.tag)} reinstated`, undo); break; }
    case 'bulkedit': closeLayer(); openDialog(`<div class="hd"><div class="t-overline">${state.sel.assets.size} assets</div><h2 style="font-size:18px">Edit together</h2></div><div class="bd" style="display:grid;gap:12px">${field('Condition', `<select id="b-cond">${opt('', 'Leave as is')}${['Good', 'Fair', 'Poor', 'Needs repair'].map(c => opt(c, c)).join('')}</select>`)}${field('Owner', `<select id="b-owner">${opt('', 'Leave as is')}${opt('Owned', 'Owned')}${opt('Sub-hire (Chameleon)', 'Sub-hire (Chameleon)')}</select>`)}<div class="t-micro muted">Only the fields you change are written · tag and serial stay unique per asset</div></div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="bulkeditgo">Save</button></div>`); break;
    case 'bulkeditgo': { const c = $('#b-cond', body).value, o = $('#b-owner', body).value, S = state.sel.assets; const undo = snapshot(), n = S.size; state.assets.forEach(x => { if (S.has(x.id)) { if (c) x.condition = c; if (o) x.owner = o; } }); S.clear(); closeLayer(); render(); toast(`${n} assets updated`, undo); break; }
    case 'bulkmove': openMenu(el, `Move ${state.sel.assets.size} to`, LOCS.map(l => ({ label:l, act:'bulkmovego', args:`data-v="${l}"` }))); break;
    case 'bulkmovego': { const S = state.sel.assets, undo = snapshot(), n = S.size, out = state.assets.filter(x => S.has(x.id) && x.status === 'DEPLOYED').length; state.assets.forEach(x => { if (S.has(x.id) && x.status !== 'DEPLOYED') x.location = el.dataset.v; }); S.clear(); closeLayer(); render(); toast(`${n - out} assets moved to ${esc(el.dataset.v)}${out ? ` · ${out} out on a job stay put` : ''}`, undo); break; }
    case 'bulklabels': { const n = state.sel.assets.size; closeLayer(); toast(`Label sheet for ${n} assets · opens the print dialog`); break; }
    case 'bulkmaint': { const S = state.sel.assets, undo = snapshot(), n = S.size; state.assets.forEach(x => { if (S.has(x.id)) { x.maintDue = addD(TODAY, 3); if (x.status === 'AVAILABLE') x.status = 'IN_MAINTENANCE'; } }); S.clear(); closeLayer(); render(); toast(`Service scheduled for ${n} assets · ${fmtD(addD(TODAY, 3))}`, undo); break; }
    case 'bulkreturn': { const S = state.sel.assets, undo = snapshot(); let n = 0; state.assets.forEach(x => { if (S.has(x.id) && x.status === 'DEPLOYED') { x.status = 'AVAILABLE'; x.job = null; x.location = 'Warehouse A'; n++; } }); S.clear(); closeLayer(); render(); toast(`${n} assets force-returned to Warehouse A`, undo); break; }
    case 'bulkretire': { const n = state.sel.assets.size; closeLayer(); openDialog(`<div class="hd"><div class="t-overline">Retire</div><h2 style="font-size:18px">Retire ${n} assets?</h2></div><div class="bd"><div class="t-small" style="line-height:1.5">Retired units leave availability and every picker, but keep their history, documents and test &amp; tag record. Anything out on a job is skipped. Reinstate from the Retired segment.</div></div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Keep them</button><button class="btn btn-secondary" style="color:var(--t-out)" data-act="bulkretirego">Retire ${n}</button></div>`); break; }
    case 'bulkretirego': { const S = state.sel.assets, undo = snapshot(); let n = 0, sk = 0; state.assets.forEach(x => { if (S.has(x.id)) { if (x.status === 'DEPLOYED') sk++; else { x.status = 'RETIRED'; n++; } } }); S.clear(); closeLayer(); render(); toast(`${n} assets retired${sk ? ` · ${sk} out on a job skipped` : ''}`, undo); break; }
    // ---- accessories
    case 'accadd': closeLayer(); openDialog(`<div class="hd"><div class="t-overline">Accessories</div><h2 style="font-size:18px">Add an accessory</h2></div><div class="bd"><div class="search" style="width:100%;height:40px"><span class="muted">⌕</span><input id="acc-q" placeholder="Search bulk stock, or type a custom accessory" autocomplete="off"></div><div id="acc-res" style="margin-top:8px"></div><div class="t-micro muted" style="margin-top:6px">Enter adds the first result as a default accessory, 1 per asset.</div></div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Close</button></div>`, d => { accSearch(''); $('#acc-q', d).focus(); }); break;
    case 'accaddgo': { const undo = snapshot(), nm = el.dataset.v, custom = el.dataset.custom === '1'; state.acc.push({ id:'k' + (state.acc.length + 5) + Math.floor(rnd() * 99), kind:custom ? 'custom' : 'bulk', name:nm, qty:1, incl:'DEFAULT' }); closeLayer(); render(); toast(`${esc(nm)} added${custom ? ' as a custom accessory' : ''} · 1 per asset, default`, undo); break; }
    case 'accmenu': { const c = state.acc.find(x => x.id === id); openMenu(el, c.name, [{ label:'Edit quantity and inclusion…', act:'accedit', args:`data-id="${id}"` }, { label:c.incl === 'OPTIONAL' ? 'Make default' : 'Make optional', act:'accincl', args:`data-id="${id}"` }, '-', { label:'Remove', act:'accremove', args:`data-id="${id}"`, danger:true }]); break; }
    case 'accincl': { const undo = snapshot(), c = state.acc.find(x => x.id === id); c.incl = c.incl === 'OPTIONAL' ? 'DEFAULT' : 'OPTIONAL'; closeLayer(); render(); toast(`${esc(c.name)} is now ${c.incl === 'OPTIONAL' ? 'optional · the PM picks it when adding' : 'default · added with every unit'}`, undo); break; }
    case 'accedit': { const c = state.acc.find(x => x.id === id); closeLayer(); openDialog(`<div class="hd"><div class="t-overline">Accessory</div><h2 style="font-size:18px">${esc(c.name)}</h2></div><div class="bd" style="display:grid;gap:12px">${field('Quantity per asset', `<div class="stepper"><button data-act="qty" data-d="-1" aria-label="Fewer">−</button><input id="acc-qty" value="${c.qty}" inputmode="numeric"><button data-act="qty" data-d="1" aria-label="More">+</button></div>`)}${field('Inclusion', `<select id="acc-incl">${opt('DEFAULT', 'Default · added with every unit', c.incl)}${opt('OPTIONAL', 'Optional · the PM picks it when adding', c.incl)}</select>`)}</div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="acceditgo" data-id="${id}">Save</button></div>`); break; }
    case 'qty': { const i = $('#acc-qty', body); i.value = Math.max(1, (+i.value || 1) + +el.dataset.d); break; }
    case 'acceditgo': { const undo = snapshot(), c = state.acc.find(x => x.id === id); c.qty = Math.max(1, Math.round(+$('#acc-qty', body).value || 1)); c.incl = $('#acc-incl', body).value; closeLayer(); render(); toast(`${esc(c.name)} · ${c.qty} per asset, ${c.incl === 'OPTIONAL' ? 'optional' : 'default'}`, undo); break; }
    case 'accremove': { const undo = snapshot(), c = state.acc.find(x => x.id === id); state.acc = state.acc.filter(x => x.id !== id); closeLayer(); render(); toast(`${esc(c.name)} removed from the plan · existing jobs keep what they already have`, undo); break; }
    // ---- checks
    case 'addcheck': { closeLayer(); const have = new Set(state.checks.map(c => c.label)), avail = CHECK_LIB.filter(c => !have.has(c[0])); openDialog(`<div class="hd"><div class="t-overline">Checks</div><h2 style="font-size:18px">Add check items</h2></div><div class="bd">${avail.length ? avail.map((c, i) => `<button class="res2" data-act="checkaddgo" data-i="${CHECK_LIB.indexOf(c)}"><span class="grow" style="flex:1;min-width:0"><div style="font-weight:600;font-size:13.5px">${esc(c[0])}</div>${c[1] ? `<div class="t-small muted">${esc(c[1])}</div>` : ''}</span><span class="muted t-small">${TYPE_LABEL[c[2]]}</span></button>`).join('') : `<div class="empty"><b>All check items already assigned</b>Create more in the <a class="lnk" href="${U.SETTINGS}">library</a>.</div>`}</div><div class="ft"><span class="t-small muted">From the <a class="lnk" href="${U.SETTINGS}">check library</a></span><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Done</button></div>`); break; }
    case 'checkaddgo': { const undo = snapshot(), c = CHECK_LIB[+el.dataset.i]; state.checks.push({ id:'c' + (state.checks.length + 7) + Math.floor(rnd() * 99), label:c[0], desc:c[1], type:c[2], fail:[0, 0] }); render(); toast(`“${esc(c[0])}” added to this model`, undo); act('addcheck', el); break; }
    case 'checkmenu': { const i = state.checks.findIndex(c => c.id === id); openMenu(el, state.checks[i].label, [...(i > 0 ? [{ label:'Move up', act:'checkmove', args:`data-id="${id}" data-d="-1"` }] : []), ...(i < state.checks.length - 1 ? [{ label:'Move down', act:'checkmove', args:`data-id="${id}" data-d="1"` }] : []), '-', { label:'Remove from model…', act:'checkremove', args:`data-id="${id}"`, danger:true }]); break; }
    case 'checkmove': { const undo = snapshot(), i = state.checks.findIndex(c => c.id === id), j = i + +el.dataset.d, [c] = state.checks.splice(i, 1); state.checks.splice(j, 0, c); closeLayer(); render(); toast(`“${esc(c.label)}” is now check ${j + 1}`, undo); break; }
    case 'checkremove': { const c = state.checks.find(x => x.id === id); closeLayer(); openDialog(`<div class="hd"><div class="t-overline">Checks</div><h2 style="font-size:18px">Remove “${esc(c.label)}” from this model?</h2></div><div class="bd"><div class="t-small" style="line-height:1.5">It stops appearing in prep and return for every unit of this model. Past results and failure rates stay on the records; the item stays in the library.</div></div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Keep it</button><button class="btn btn-secondary" style="color:var(--t-out)" data-act="checkremovego" data-id="${id}">Remove check</button></div>`); break; }
    case 'checkremovego': { const undo = snapshot(), c = state.checks.find(x => x.id === id); state.checks = state.checks.filter(x => x.id !== id); state.sel.checks.delete(id); closeLayer(); render(); toast(`“${esc(c.label)}” removed from this model`, undo); break; }
    // ---- documents
    case 'upload': closeLayer(); openDialog(`<div class="hd"><div class="t-overline">Documents</div><h2 style="font-size:18px">Upload</h2></div><div class="bd"><div class="t-small muted" style="margin-bottom:8px">PDF, Word, Excel or text. Pick a sample file in this prototype.</div>${SAMPLE_DOCS.map((d, i) => `<button class="res2" data-act="uploadgo" data-i="${i}"><span class="thumbf">PDF</span><span style="flex:1;min-width:0;font-size:13.5px;font-weight:600" class="ell">${esc(d[0])}</span><span class="muted t-small">${fmtSize(d[1])}</span></button>`).join('')}</div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button></div>`); break;
    case 'uploadgo': { const undo = snapshot(), p = SAMPLE_DOCS[+el.dataset.i]; state.docs.unshift({ id:'d' + (state.docs.length + 9), name:p[0], size:p[1], by:'Jayden Cole', at:TODAY }); closeLayer(); render(); toast(`${esc(p[0])} uploaded`, undo); break; }
    case 'docopen': closeLayer(); toast(`Opens ${esc(state.docs.find(d => d.id === id).name)} in a new tab`); break;
    case 'docmenu': { const d = state.docs.find(x => x.id === id); openMenu(el, d.name, [{ label:'Open', act:'docopen', args:`data-id="${id}"` }, { label:'Download', act:'noop' }, '-', { label:'Remove…', act:'docremove', args:`data-id="${id}"`, danger:true }]); break; }
    case 'docremove': { const d = state.docs.find(x => x.id === id); closeLayer(); openDialog(`<div class="hd"><div class="t-overline">Documents</div><h2 style="font-size:18px">Remove ${esc(d.name)}?</h2></div><div class="bd"><div class="t-small" style="line-height:1.5">It is removed from this model for everyone. Undo is offered right after.</div></div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Keep it</button><button class="btn btn-secondary" style="color:var(--t-out)" data-act="bulkdelgo" data-ids="${id}">Remove</button></div>`); break; }
    // ---- photos
    case 'photoup': closeLayer(); openDialog(`<div class="hd"><div class="t-overline">Photos</div><h2 style="font-size:18px">Upload</h2></div><div class="bd"><div class="t-small muted" style="margin-bottom:8px">${isPhone() ? 'Take a photo or choose from the library.' : 'JPG or PNG. Pick a sample in this prototype.'}</div>${SAMPLE_PHOTOS.map((p, i) => `<button class="res2" data-act="photoupgo" data-i="${i}"><span class="thumbf" style="background:linear-gradient(135deg,${p[1]},${p[2]});border:0"></span><span style="flex:1;font-size:13.5px;font-weight:600" class="mono">${esc(p[0])}</span></button>`).join('')}</div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button></div>`); break;
    case 'photoupgo': { const undo = snapshot(), p = SAMPLE_PHOTOS[+el.dataset.i]; state.photos.push({ id:'p' + (state.photos.length + 9), name:p[0], c1:p[1], c2:p[2], primary:!state.photos.length }); closeLayer(); render(); toast(`${esc(p[0])} added${state.photos.length === 1 ? ' as the primary photo' : ''}`, undo); break; }
    case 'photoview': if (ev && ev.target.closest('.cb,.dots')) break; closeLayer(); toast(`Opens ${esc(state.photos.find(p => p.id === id).name)} full size`); break;
    case 'photomenu': { const i = state.photos.findIndex(p => p.id === id), p = state.photos[i]; openMenu(el, p.name, [{ label:'View full size', act:'photoview', args:`data-id="${id}"` }, ...(p.primary ? [] : [{ label:'Set as primary', act:'setprimary', args:`data-id="${id}"` }]), ...(i > 0 ? [{ label:'Move earlier', act:'photomove', args:`data-id="${id}" data-d="-1"` }] : []), ...(i < state.photos.length - 1 ? [{ label:'Move later', act:'photomove', args:`data-id="${id}" data-d="1"` }] : []), '-', { label:'Remove…', act:'photoremove', args:`data-id="${id}"`, danger:true }]); break; }
    case 'setprimary': { const undo = snapshot(); state.photos.forEach(p => p.primary = p.id === id); closeLayer(); render(); toast(`${esc(state.photos.find(p => p.id === id).name)} is now the primary photo`, undo); break; }
    case 'photomove': { const undo = snapshot(), i = state.photos.findIndex(p => p.id === id), [p] = state.photos.splice(i, 1); state.photos.splice(i + +el.dataset.d, 0, p); closeLayer(); render(); toast(`${esc(p.name)} moved`, undo); break; }
    case 'photoremove': { const p = state.photos.find(x => x.id === id); closeLayer(); openDialog(`<div class="hd"><div class="t-overline">Photos</div><h2 style="font-size:18px">Remove ${esc(p.name)}?</h2></div><div class="bd"><div class="t-small" style="line-height:1.5">${p.primary ? 'This is the primary photo, so the next one becomes the hero and the catalog thumbnail.' : 'It is removed from this model for everyone.'} Undo is offered right after.</div></div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Keep it</button><button class="btn btn-secondary" style="color:var(--t-out)" data-act="bulkdelgo" data-ids="${id}">Remove</button></div>`); break; }
    case 'bulkdel': { const ids = selIds(state.tab), n = ids.length, what = { checks:'checks from this model', documents:'documents', photos:'photos' }[state.tab]; closeLayer(); openDialog(`<div class="hd"><div class="t-overline">Remove</div><h2 style="font-size:18px">Remove ${n} ${what}?</h2></div><div class="bd"><div class="t-small" style="line-height:1.5">${state.tab === 'checks' ? 'They stop appearing in prep and return for every unit. Past results stay on the records; the items stay in the library.' : 'They are removed from this model for everyone. Undo is offered right after.'}</div></div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Keep them</button><button class="btn btn-secondary" style="color:var(--t-out)" data-act="bulkdelgo" data-ids="${ids.join(',')}">Remove ${n}</button></div>`); break; }
    case 'bulkdelgo': { const ids = new Set(el.dataset.ids.split(',')), undo = snapshot(), key = { checks:'checks', documents:'docs', photos:'photos' }[state.tab]; const before = state[key].length; state[key] = state[key].filter(x => !ids.has(x.id)); if (key === 'photos' && state.photos.length && !state.photos.some(p => p.primary)) state.photos[0].primary = true; state.sel[state.tab].clear(); closeLayer(); render(); toast(`${before - state[key].length} ${before - state[key].length === 1 ? { checks:'check', docs:'document', photos:'photo' }[key] : { checks:'checks', docs:'documents', photos:'photos' }[key]} removed`, undo); break; }
    // ---- ROI
    case 'roiscope': state.roi.scope = k; state.roi.more = 8; render(); break;
    case 'roiwin': state.roi.all = k === 'all'; state.roi.more = 8; render(); break;
    case 'roicost': state.roi.cost = !state.roi.cost; render(); break;
    case 'roimore': state.roi.more += 25; render(); break;
    case 'undo': if (state.undo) { state.undo(); state.undo = null; } $('#toast').classList.remove('open'); break;
    case 'toastclose': $('#toast').classList.remove('open'); break;
  }
}
function accSearch(q) {
  q = q.trim().toLowerCase(); const have = new Set(state.acc.map(c => c.name)), hits = BULK_STOCK.filter(n => !have.has(n) && n.toLowerCase().includes(q));
  $('#acc-res', body).innerHTML = hits.slice(0, 6).map((n, i) => `<button class="res2 ${i === 0 ? 'on' : ''}" data-act="accaddgo" data-v="${esc(n)}"><span style="flex:1;font-size:13.5px;font-weight:600">${esc(n)}</span><span class="muted t-small">bulk stock</span></button>`).join('') + (q ? `<button class="res2 ${hits.length ? '' : 'on'}" data-act="accaddgo" data-custom="1" data-v="${esc(q.replace(/\b\w/, c => c.toUpperCase()))}"><span style="flex:1;font-size:13.5px">Add “${esc(q)}” as a custom accessory</span><span class="muted t-small">not in inventory</span></button>` : '');
}
document.addEventListener('input', ev => {
  const t = ev.target;
  if (t.id === 'q') { state.q = t.value; state.page = 0; renderAssets(); return; }
  if (t.id === 'acc-q') { accSearch(t.value); return; }
  if (state.sheet && t.dataset) { const s = state.sheet; if (t.dataset.f) s.draft[t.dataset.f] = t.value; else if (t.dataset.sp !== undefined) s.draft.specs[+t.dataset.sp][1] = t.value; else return; s.dirty = true; const m = $('#dirtymsg'); if (m) m.textContent = 'Unsaved changes'; if (s.errs && s.errs[t.dataset.f]) { delete s.errs[t.dataset.f]; t.removeAttribute('aria-invalid'); const em = t.parentElement.querySelector('.errm'); if (em) em.remove(); } }
});
document.addEventListener('change', ev => { const t = ev.target; if (state.sheet && t.dataset && t.dataset.f && t.tagName === 'SELECT') { state.sheet.draft[t.dataset.f] = t.value; state.sheet.dirty = true; const m = $('#dirtymsg'); if (m) m.textContent = 'Unsaved changes'; } });
document.addEventListener('keydown', ev => {
  if ((ev.key === 'n' || ev.key === 'N') && !ev.metaKey && !ev.ctrlKey && !ev.target.matches('input,textarea,select')) ev.preventDefault(); // the shortcut must not type an n into the field it focuses
  if (ev.key === 'Escape' && state.sheet && state.sheet.dirty && layer.classList.contains('open') && !$('.dlg', body)) { ev.stopImmediatePropagation(); act('close', document.body); return; }
  if (ev.key === 'Enter' && ev.target.id === 'acc-q') { const r = $('#acc-res .res2', body); if (r) { ev.preventDefault(); r.click(); } }
  if (ev.key === 'Enter' && (ev.target.id === 'sp-k' || ev.target.id === 'sp-v')) { ev.preventDefault(); act('specadd', document.body); }
  if (ev.key === 'Enter' && ev.target.matches && ev.target.matches('.esheet input[data-f]')) { ev.preventDefault(); }
}, true);
// ---------- boot
(function boot() {
  try { const p = new URLSearchParams(location.search), t = p.get('tab'); if (['overview','assets','checks','documents','photos','roi'].includes(t)) state.tab = t; if (t === 'details' || p.get('edit') === '1') state.openEdit = true; } catch (e) { /* no URL access */ }
  shellInit(); render();
  if (state.openEdit) openEdit('edit');
})();
