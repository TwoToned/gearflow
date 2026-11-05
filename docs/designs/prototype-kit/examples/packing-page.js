// ---------- Job #2341 · Packing and Versions · data
const TODAY = '2026-11-09';
const DAYS = 3;
const A = 'https://claude.ai/artifact/';
const OV = A + 'RatKsWfTmDJLJHmn6mb7Zo', EQUIP = A + 'BdwR4bNbiNMLSvfRAByEwC', LOG = A + 'E36tnBkGL9obdikUQ5mbXf', FIN = A + '7ByfxnbtsgQTJdiwvvo1CY', TN = A + 'BrLBitu3c2V4uixLQbXCNE', WH = A + 'Mt8p55xkPkkexVWPC5eaGU', JOBS = A + 'A7SMPtpTr3aedUDEnuSaxd', ASSETS = A + '89PDTuMiovgP9i3h4MJ1Tw';
const CATS = ['Audio', 'Lighting', 'Video', 'Rigging', 'Power'];
const INVOICED = 5970;

// id, category, name, qty, rate per day, options. plan/packed are case ids; flat = a flat price, not per day.
const BASE = [
  ['y8', 'Audio', 'd&b audiotechnik Y8 loudspeaker', 8, 60, { packed: 'x1', plan: 'x1' }],
  ['b22', 'Audio', 'd&b B22 subwoofer', 2, 90, { plan: 'x1' }],
  ['d20', 'Audio', 'd&b D20 amplifier', 2, 60, { plan: 'x1' }],
  ['sk', 'Audio', 'Sennheiser EW-DX SK beltpack', 6, 15, { packed: 'x1', plan: 'x1' }],
  ['em4', 'Audio', 'Sennheiser EW-DX EM4 receiver', 4, 45, {}],
  ['ulxd', 'Audio', 'Shure ULXD4Q wireless kit', 2, 140, { kit: 1, plan: 'x1' }],
  ['ad4q', 'Audio', 'Shure Axient AD4Q', 2, 120, { sub: 'Scene Change' }],
  ['ad2', 'Audio', 'Shure Axient AD2 handheld', 4, 28, { sub: 'Scene Change' }],
  ['cl5', 'Audio', 'Yamaha CL5 console', 1, 380, { plan: 'x2' }],
  ['rio', 'Audio', 'Yamaha Rio3224-D2 stage box', 1, 120, { plan: 'x2' }],
  ['mx418', 'Audio', 'Shure MX418 gooseneck', 2, 18, { plan: 'x2' }],
  ['mon', 'Audio', 'd&b M4 floor monitor', 2, 60, { plan: 'x2' }],
  ['pxl', 'Lighting', 'Martin MAC Aura PXL', 12, 85, { packed: 'x1', plan: 'x2' }],
  ['xb', 'Lighting', 'Martin MAC Aura XB', 6, 95, { plan: 'x2' }],
  ['r2x', 'Lighting', 'Chauvet Rogue R2X wash', 6, 60, { plan: 'x2' }],
  ['haz', 'Lighting', 'Hazer · MDG ATMe', 1, 90, {}],
  ['col', 'Lighting', 'Chauvet COLORado Panel Q40', 8, 45, { plan: 'x2' }],
  ['six', 'Lighting', 'Elation SixBar 1000 uplight', 16, 20, { plan: 'x2' }],
  ['s4', 'Lighting', 'ETC Source Four LED Lustr', 8, 55, { plan: 'x2' }],
  ['fsp', 'Lighting', 'Robert Juliat Lancelot followspot', 1, 320, {}],
  ['ma3', 'Lighting', 'grandMA3 compact XT', 1, 350, { plan: 'x2' }],
  ['node', 'Lighting', 'Luminex Ethernet-DMX node', 2, 40, { plan: 'x2' }],
  ['spl', 'Lighting', 'DMX splitter 8-way', 4, 12, { plan: 'x2' }],
  ['udx', 'Video', 'Barco UDX-4K32 projector', 1, 1100, { plan: 'x3' }],
  ['lens', 'Video', 'Barco TLD+ 1.2–1.7 lens', 1, 180, { plan: 'x3' }],
  ['atem', 'Video', 'Blackmagic ATEM 2 M/E', 1, 240, { plan: 'x3' }],
  ['cm', 'Video', 'Confidence monitor rig', 1, 450, { custom: 1, flat: 1, plan: 'x3' }],
  ['roe', 'Video', 'ROE Black Pearl BP2 LED panel', 36, 60, {}],
  ['nova', 'Video', 'Novastar MCTRL4K processor', 1, 150, {}],
  ['fib', 'Video', 'HDMI fibre extender pair', 2, 60, { plan: 'x3' }],
  ['dsp', 'Video', 'Panasonic 55 in confidence display', 2, 90, { plan: 'x3' }],
  ['trs', 'Rigging', '4 m truss section', 8, 18, {}],
  ['hst', 'Rigging', 'CM Lodestar 1 t chain hoist', 6, 55, { plan: 'x1' }],
  ['clp', 'Rigging', 'Half-coupler clamp', 24, 3, { plan: 'x1' }],
  ['bnd', 'Rigging', 'Safety bond 1 m', 24, 2, { plan: 'x1' }],
  ['shk', 'Rigging', 'Bow shackle 1 t', 16, 2, { plan: 'x1' }],
  ['tool', 'Rigging', 'Rigging tool roll', 1, 30, { plan: 'x1' }],
  ['dist', 'Power', '32 A 3-phase distro', 2, 120, { plan: 'x2' }],
  ['cab', 'Power', 'Cable & consumables', 1, 0, { flat: 1, plan: 'x2' }],
  ['cat', 'Power', 'Cat6 drum 50 m', 4, 15, { plan: 'x2' }],
  ['ramp', 'Power', 'Cable ramp 5-channel', 8, 10, { plan: 'x2' }],
  ['swx', 'Power', 'Core SWX Hypercore 98 battery', 6, 12, { plan: 'x4' }],
  ['chg', 'Power', 'V-mount 4-channel charger', 2, 15, { plan: 'x4' }],
  ['aa', 'Power', 'AA battery carton', 1, 90, { flat: 1, plan: 'x4' }],
];
const lineTotal = l => l.flat ? l.rate : l.qty * l.rate * DAYS;
const mkLines = () => BASE.map(([id, cat, name, qty, rate, o]) => ({ id, cat, name, qty, rate, kit: !!o.kit, sub: o.sub || '', custom: !!o.custom, flat: !!o.flat, plan: o.plan || null, packed: o.packed || null }));
// Tune the flat "Cable & consumables" line so v3's quote lands on the job's $23,880 (gear + $4,100 services).
const SERVICES3 = [{ id: 's1', name: 'Audio engineer · 3 days', amount: 2100 }, { id: 's2', name: 'Delivery · Van 2', amount: 600 }, { id: 's3', name: 'Rigging crew · 4', amount: 1400 }];
(function tune() {
  const ls = mkLines(), fixed = new Set(['y8', 'sk', 'em4', 'ulxd', 'udx', 'cm', 'cab', 'aa']);
  const sum = f => ls.filter(f).reduce((a, l) => a + lineTotal(l), 0);
  const want = 23880 - SERVICES3.reduce((a, s) => a + s.amount, 0);
  const free = sum(l => !fixed.has(l.id)), fix = sum(l => fixed.has(l.id) && l.id !== 'cab');
  const s = (want - 500 - fix) / free;
  BASE.forEach(r => { if (!fixed.has(r[0])) { const v = r[4] * s; r[4] = Math.max(1, v >= 20 ? Math.round(v / 5) * 5 : Math.round(v)); } });
  const rest = mkLines().filter(l => l.id !== 'cab').reduce((a, l) => a + lineTotal(l), 0);
  BASE.find(r => r[0] === 'cab')[4] = want - rest;
})();
const CASES0 = [
  { id: 'x1', name: 'LX-02', kind: 'Road case', sealed: false, inside: null },
  { id: 'x2', name: 'LX-04', kind: 'Road case', sealed: false, inside: null },
  { id: 'x3', name: 'VID-04', kind: 'Road case', sealed: false, inside: null },
  { id: 'x4', name: 'BATT-01', kind: 'Battery box', sealed: true, inside: 'x1' },
];
const cp = o => JSON.parse(JSON.stringify(o));
function mkVersions() {
  const v3 = { n: 3, label: '', at: 'Thu 6 Nov', by: 'Jayden Cole', note: 'quote v3 accepted Thu 6 Nov · PO 77812', lines: mkLines(), services: cp(SERVICES3), cases: cp(CASES0) };
  const v2 = cp(v3); Object.assign(v2, { n: 2, label: 'Hilton revisions', at: 'Tue 4 Nov', note: 'quote v2 sent · superseded' });
  v2.lines = v2.lines.filter(l => l.id !== 'haz' && l.id !== 'cm');
  const g = (v, id) => v.lines.find(l => l.id === id);
  g(v2, 'roe').qty = 24; g(v2, 'y8').qty = 6; g(v2, 'em4').rate = 40; g(v2, 'r2x').plan = 'x1'; g(v2, 'em4').plan = 'x1';
  v2.lines.push({ id: 'robe', cat: 'Lighting', name: 'Robe MegaPointe', qty: 4, rate: 110, kit: false, sub: '', custom: false, flat: false, plan: 'x2', packed: null });
  v2.services = v2.services.filter(s => s.id !== 's3');
  const v1 = cp(v2); Object.assign(v1, { n: 1, label: 'First pass', at: 'Mon 3 Nov', note: 'never sent' });
  v1.lines = v1.lines.filter(l => !['sk', 'ulxd', 'mx418'].includes(l.id)); g(v1, 'roe').qty = 16; g(v1, 'y8').qty = 4;
  return [v3, v2, v1];
}
const state = { tab: 'packing', versions: mkVersions(), live: 3, viewing: 3, sel: new Set(), lastSel: null, q: '', f: { cat: '', status: '' }, open: new Set(), drag: null, pending: [], undo: null, cmp: null, caseKind: 'inv', pickAsset: null };
// ---------- derived
const ver = n => state.versions.find(v => v.n === n);
const cur = () => ver(state.viewing);
const line = id => cur().lines.find(l => l.id === id);
const kase = (x, v = cur()) => v.cases.find(c => c.id === x);
const bucketOf = l => l.packed || l.plan || null;
const total = v => v.lines.reduce((a, l) => a + lineTotal(l), 0) + v.services.reduce((a, s) => a + s.amount, 0);
const planned = v => v.lines.filter(l => bucketOf(l)).length;
const units = ls => ls.reduce((a, l) => a + l.qty, 0);
const cmpLine = (a, b) => (!!b.packed - !!a.packed) || CATS.indexOf(a.cat) - CATS.indexOf(b.cat) || a.name.localeCompare(b.name);
const filtering = () => !!(state.q.trim() || state.f.cat || state.f.status);
function matches(l) {
  const q = state.q.trim().toLowerCase();
  if (q && !(l.name.toLowerCase().includes(q) || l.cat.toLowerCase().includes(q) || (kase(bucketOf(l)) || { name: '' }).name.toLowerCase().includes(q))) return false;
  if (state.f.cat && l.cat !== state.f.cat) return false;
  if (state.f.status === 'Not planned' && bucketOf(l)) return false;
  if (state.f.status === 'Planned' && !(l.plan && !l.packed)) return false;
  if (state.f.status === 'Packed' && !l.packed) return false;
  return true;
}
const inBucket = x => cur().lines.filter(l => bucketOf(l) === x && matches(l)).sort(cmpLine);
const allIn = x => cur().lines.filter(l => bucketOf(l) === x);
function snapshot() { const s = JSON.stringify({ v: state.versions, live: state.live, viewing: state.viewing }); return () => { const o = JSON.parse(s); state.versions = o.v; state.live = o.live; state.viewing = o.viewing; state.sel.clear(); render(); }; }
const money2 = n => (n < 0 ? '−' : '') + '$' + Math.round(Math.abs(n)).toLocaleString('en-AU');
const signed = n => n === 0 ? '$0' : (n > 0 ? '+' : '−') + '$' + Math.round(Math.abs(n)).toLocaleString('en-AU');
const vname = v => `v${v.n}${v.n === state.live ? ' · Live' : ''}`;
const vfull = v => `v${v.n}${v.label ? ' · ' + v.label : ''}`;
const plural = (n, w, w2) => `${n} ${n === 1 ? w : (w2 || w + 's')}`;
function diff(a, b) {
  const am = new Map(a.lines.map(l => [l.id, l])), bm = new Map(b.lines.map(l => [l.id, l]));
  const added = b.lines.filter(l => !am.has(l.id)).map(l => ({ t: l.name, d: l.flat ? 'flat price' : `×${l.qty} at ${money2(l.rate)}/day`, amt: lineTotal(l) }));
  const removed = a.lines.filter(l => !bm.has(l.id)).map(l => ({ t: l.name, d: l.flat ? 'flat price' : `×${l.qty} at ${money2(l.rate)}/day`, amt: -lineTotal(l) }));
  const changed = [];
  for (const l of b.lines) { const o = am.get(l.id); if (!o) continue; const parts = []; if (o.qty !== l.qty) parts.push(`qty ${o.qty} → ${l.qty}`); if (o.rate !== l.rate && !l.flat) parts.push(`${money2(o.rate)} → ${money2(l.rate)}/day`); if (parts.length) changed.push({ t: l.name, d: parts.join(' · '), amt: lineTotal(l) - lineTotal(o) }); }
  const sm = new Map(a.services.map(s => [s.id, s])), bs = new Map(b.services.map(s => [s.id, s]));
  const services = [...b.services.filter(s => !sm.has(s.id)).map(s => ({ t: s.name, d: 'added', amt: s.amount })), ...a.services.filter(s => !bs.has(s.id)).map(s => ({ t: s.name, d: 'removed', amt: -s.amount }))];
  const planDiff = b.lines.filter(l => am.has(l.id) && bucketOf(am.get(l.id)) !== bucketOf(l)).length;
  return { added, removed, changed, services, planDiff, totA: total(a), totB: total(b) };
}
// ---------- tabs
const TABS = () => [['overview', 'Overview', null, OV], ['equipment', 'Equipment', '44', EQUIP], ['packing', 'Packing', `${planned(cur())}/${cur().lines.length}`, null], ['logistics', 'Logistics', null, LOG], ['finance', 'Finance', null, FIN], ['tasks', 'Tasks & notes', '9/14', TN], ['versions', 'Versions', String(state.versions.length), null]];
// ---------- chrome
function fixChrome() {
  renderNav('Jobs');
  document.querySelector('.topbar .crumb').innerHTML = `<a href="${JOBS}" style="color:var(--muted)">Jobs</a><span>›</span><a href="${OV}" style="color:var(--muted)">#2341 Hilton gala</a><span>›</span><b>${state.tab === 'packing' ? 'Packing' : 'Versions'}</b>`;
  document.querySelector('.phonehead').innerHTML = `<a class="btn btn-icon btn-lg" href="${JOBS}" aria-label="Back" style="color:var(--ink)">‹</a><div style="flex:1;min-width:0"><div class="ell" style="font-family:var(--display);font-weight:800;font-size:16px">Hilton Sydney gala dinner</div><div class="ell t-micro muted" id="phonesub"></div></div><button class="btn btn-icon btn-lg" data-act="jobmenu" aria-label="Job actions">⋯</button>`;
  const nav = { Dashboard: 'https://claude.ai/artifact/RPnGj7WnaWcknvQ8ShcRkf', Jobs: JOBS, Finance: 'https://claude.ai/artifact/5VnYTVW2pdA5r1qBRvdrom', Schedule: 'https://claude.ai/artifact/AKkgWzJ2gVR3dJTWnMB2Ui', Crew: 'https://claude.ai/artifact/LPdsNGb4CRMfS6qk7j7Fsa', Assets: ASSETS, Warehouse: 'https://claude.ai/artifact/6xqFcEZZk49w86p5pAsisA', 'Test & tag': 'https://claude.ai/artifact/8Q2HVoRhLbSLz1Q9mCtayX', Maintenance: 'https://claude.ai/artifact/D7N5PmXKrkcY2gzZXWeuvc' };
  document.querySelectorAll('#sidenav a').forEach(a => { const h = nav[a.textContent.trim()]; if (h) a.href = h; });
  const bn = document.querySelectorAll('.bottomnav a'); const hrefs = ['https://claude.ai/artifact/RPnGj7WnaWcknvQ8ShcRkf', JOBS, 'https://claude.ai/artifact/8Q2HVoRhLbSLz1Q9mCtayX', 'https://claude.ai/artifact/6xqFcEZZk49w86p5pAsisA', ASSETS]; bn.forEach((a, i) => { a.href = hrefs[i]; });
  const st = document.querySelector('.sidebar .foot a'); if (st) st.href = 'https://claude.ai/artifact/Q3TeWuQPjzvXbAtmUV8Hg8';
}
function renderHead() {
  const v = cur(), isLive = v.n === state.live;
  $('#titlerow').innerHTML = `<h1 class="h1">Hilton Sydney gala dinner</h1><span class="dotw info">Confirmed</span><button class="lockbtn" data-act="lockmenu" title="Pricing locked" aria-label="Pricing locked">${ICON.lock}</button>`;
  $('#metarow').innerHTML = `<span class="mono">#2341</span><span>·</span><a href="#client">Hilton Sydney</a><span>·</span><span>Wed 12 – Fri 14 Nov · 3 days</span><span>·</span><button class="vchip" data-act="vmenu" aria-label="Versions">v${v.n}${isLive ? ' · Live' : ' · viewing'} ▾</button>`;
  $('#phonesub').innerHTML = `<span class="mono">#2341</span> · Confirmed · 12 – 14 Nov · v${v.n}${isLive ? ' live' : ' viewing'}`;
  $('#actions').innerHTML = `<button class="btn btn-secondary btn-sm" data-act="docs">Documents ▾</button><button class="btn btn-secondary btn-sm" data-act="edit">Edit</button><button class="btn btn-icon btn-sm" data-act="jobmenu" aria-label="More actions">⋯</button>`;
  $('#desktabs').innerHTML = TABS().map(([k, n, c, href]) => href ? `<a class="tab" href="${href}">${n}${c ? ` <span class="cnt">${c}</span>` : ''}</a>` : `<a class="tab ${state.tab === k ? 'on' : ''}" href="#${k}" data-act="tab" data-t="${k}">${n}${c ? ` <span class="cnt">${c}</span>` : ''}</a>`).join('');
  $('#phonetabs').innerHTML = TABS().map(([k, n, c, href]) => href ? `<a class="chip" href="${href}">${n}${c ? ` <span class="chip-count">${c}</span>` : ''}</a>` : `<a class="chip ${state.tab === k ? 'on' : ''}" href="#${k}" data-act="tab" data-t="${k}">${n}${c ? ` <span class="chip-count">${c}</span>` : ''}</a>`).join('');
  const el = $('#vstrip');
  if (!isLive) { el.className = 'quiet info'; el.innerHTML = `<span>Viewing <b>${esc(vfull(v))}</b>, a draft. Equipment, Packing and Finance show it; the warehouse, availability and invoices follow v${state.live}.</span><button class="lnk" data-act="makelive" data-n="${v.n}">Make v${v.n} live</button><button class="lnk" data-act="backlive">Back to live</button>`; } else { el.className = ''; el.innerHTML = ''; }
  const prim = state.tab === 'packing' ? ['addcase', '+ Add case'] : ['saveversion', 'Save as new version'];
  $('#tabprimary').innerHTML = `<button class="btn btn-primary" data-act="${prim[0]}">${prim[1]}</button>`;
  $('#phoneact').innerHTML = `<button class="btn btn-primary" data-act="${prim[0]}">${prim[1]}</button>`;
}
// ---------- packing
const statusWord = l => l.packed ? `<span class="dotw ok">Packed</span>` : '';
function glyph(l) { return l.packed && l.plan && l.plan !== l.packed ? `<span class="glyph" title="The plan says ${esc(kase(l.plan).name)}; the warehouse packed it elsewhere. What was packed wins.">Planned → <b>${esc(kase(l.plan).name)}</b></span>` : ''; }
function rowHtml(l) {
  const sel = state.sel.has(l.id), cs = kase(bucketOf(l));
  const tags = [l.kit ? 'Kit · moves whole' : '', l.sub ? `Sub-hire · ${esc(l.sub)}` : '', l.custom ? 'Custom' : ''].filter(Boolean);
  return `<div class="pl ${sel ? 'sel' : ''} ${l.packed ? 'packed' : ''}" data-act="select" data-id="${l.id}" draggable="${l.packed || (cs && cs.sealed) ? 'false' : 'true'}"><button class="cb ${sel ? 'on' : ''}" data-act="select" data-id="${l.id}" aria-label="Select ${esc(l.name)}"></button><span class="grip" title="Drag onto a case">⠿</span><div class="grow"><div class="ttl ell">${esc(l.name)}</div><div class="sub"><span>${esc(l.cat)}${tags.length ? ' · ' + tags.join(' · ') : ''}</span>${statusWord(l)}${glyph(l)}</div></div><span class="qty">${l.flat ? 'flat' : '×' + l.qty}</span><button class="dots" data-act="rowmenu" data-id="${l.id}" aria-label="Line actions">${ICON.dots}</button></div>`;
}
function cardHtml(x) {
  const un = x === null, c = un ? null : kase(x), all = allIn(x), shown = inBucket(x), LIM = un ? 10 : 6, expanded = state.open.has(x || 'un') || filtering();
  const list = expanded ? shown : shown.slice(0, LIM), left = shown.length - list.length;
  const allSel = shown.length && shown.every(l => state.sel.has(l.id));
  const pk = all.filter(l => l.packed).length;
  let h = `<section class="cc ${un ? 'un' : ''}" data-drop="case" data-x="${x || ''}"><header class="cc-h"><button class="cb ${allSel ? 'on' : ''}" data-act="selcard" data-x="${x || ''}" aria-label="Select all in ${un ? 'Unplanned' : esc(c.name)}"></button>`;
  if (un) h += `<span class="ttl2">Unplanned</span><span class="n">${all.length}</span>`;
  else h += `<span class="nm">${esc(c.name)}</span><span class="kd ell">${esc(c.kind)}${c.inside ? ' · in ' + esc(kase(c.inside).name) : ''}</span>${c.sealed ? `<span class="dotw ok" title="Sealed · label printed">Sealed</span>` : ''}<span class="n">${plural(all.length, 'line')}${pk ? ` · ${pk} packed` : ''}</span><button class="dots" data-act="casemenu" data-x="${x}" aria-label="Case actions">${ICON.dots}</button>`;
  h += `</header>`;
  if (un && !all.length) h += `<div class="cc-note"><span class="dotw ok">Every line has a case</span></div>`;
  else if (un && !filtering()) h += `<div class="cc-note deskonly">Drag a line onto a case, or tick lines and use Plan into…</div>`;
  else if (un && !shown.length) h += `<div class="cc-note">Nothing unplanned matches.</div>`;
  if (!un && !all.length) h += `<div class="cc-note">${c.sealed ? 'Sealed and empty.' : 'Drop lines here, or tick lines and use Plan into…'}</div>`;
  h += list.map(rowHtml).join('');
  if (left > 0) h += `<button class="more" data-act="showmore" data-x="${x || ''}">Show ${Math.min(left, 25)} more · ${left} left</button>`;
  return h + `</section>`;
}
function renderPacking() {
  const v = cur(), c = state.f, un = v.lines.filter(l => !bucketOf(l)).length;
  $('#fwords').innerHTML = filterWord('Category', 'cat', c.cat, 'fmenu') + filterWord('Status', 'status', c.status, 'fmenu') + (filtering() ? `<button class="lnk muted" data-act="clearf">Clear</button>` : '');
  const vis = v.lines.filter(matches).length;
  let board;
  if (filtering() && !vis) board = `<div class="empty" style="grid-column:1/-1"><b>No lines match that</b>Loosen the search or the filters. <button class="lnk" data-act="clearf">Clear filters</button></div>`;
  else board = `<div class="pk-side">${cardHtml(null)}</div><div class="pk-cases">${v.cases.map(cs => cardHtml(cs.id)).join('')}</div>`;
  $('#pkboard').innerHTML = board;
  const pk = v.lines.filter(l => l.packed).length;
  $('#foot').innerHTML = `<span>${plural(v.lines.length, 'line')} · ${units(v.lines)} units · ${pk} packed in the warehouse${filtering() ? ` · ${vis} shown` : ''}</span><span style="margin-left:auto" class="deskonly">${un ? `${plural(un, 'line')} not planned` : 'Nothing left to plan'}</span>`;
}
// ---------- versions (the Discussion rendering)
function vrow(v) {
  const prev = ver(v.n - 1), d = prev ? diff(prev, v) : null, view = v.n === state.viewing, live = v.n === state.live;
  const dl = d ? `vs v${prev.n}: ${d.added.length ? '+' + plural(d.added.length, 'line') : ''}${d.removed.length ? (d.added.length ? ' · ' : '') + '−' + plural(d.removed.length, 'line') : ''}${d.changed.length ? ((d.added.length || d.removed.length) ? ' · ' : '') + plural(d.changed.length, 'line') + ' changed' : ''}${d.services.length ? ' · services changed' : ''} · ${signed(d.totB - d.totA)}` : 'First version';
  return `<div class="vr ${view ? 'view' : ''}" data-act="vopen" data-n="${v.n}"><div class="when">${esc(v.at)}</div><div><div class="ttl"><span class="mono">v${v.n}</span>${v.label ? `<span class="lab">${esc(v.label)}</span>` : ''}${live ? `<span class="dotw live">Live</span>` : ''}${view && !live ? `<span class="dotw info">Viewing</span>` : ''}</div><div class="sub"><span class="phoneonly">${esc(v.at)} · </span>${plural(v.lines.length, 'line')} · ${planned(v)} planned<span class="deskonly"> · ${v.by} · ${esc(v.note)}</span></div><div class="sub">${dl}</div></div><div class="amt">${money2(total(v))}</div><button class="dots" data-act="vrowmenu" data-n="${v.n}" aria-label="v${v.n} actions">${ICON.dots}</button></div>`;
}
function renderVersions() {
  $('#vcount').textContent = state.versions.length;
  $('#vlist').innerHTML = [...state.versions].sort((a, b) => b.n - a.n).map(vrow).join('');
  $('#vfoot').innerHTML = `<span>v${state.live} is live — the warehouse, availability and invoices follow it. Every other version is a draft you can open, edit and make live.</span>`;
}
function renderBulk() {
  const n = state.sel.size, b = $('#bulk'), on = n > 0 && state.tab === 'packing';
  b.classList.toggle('open', on); document.body.classList.toggle('hassel', on); if (!on) return;
  const ls = [...state.sel].map(line).filter(Boolean), canUn = ls.filter(l => l.plan && !l.packed).length;
  b.innerHTML = `<b style="font-size:13px">${n} selected</b><button class="btn btn-secondary btn-sm" data-act="bulkplan">Plan ${n} into… ▾</button>${canUn ? `<button class="btn btn-secondary btn-sm" data-act="bulkunplan">Unplan ${canUn}</button>` : ''}<button class="btn btn-icon btn-sm" data-act="clearsel" aria-label="Clear selection">✕</button>`;
}
function render() {
  renderNav('Jobs'); renderHead();
  $('#packwrap').hidden = state.tab !== 'packing'; $('#verwrap').hidden = state.tab !== 'versions';
  if (state.tab === 'packing') renderPacking(); else renderVersions();
  renderBulk();
  document.querySelector('.topbar .crumb b').textContent = state.tab === 'packing' ? 'Packing' : 'Versions';
}
// ---------- writes
function planInto(ids, x, via) {
  const target = x ? kase(x) : null;
  if (target && target.sealed) { toast(`${esc(target.name)} is sealed — unseal it from its ⋯ to add lines`); return; }
  const undo = snapshot(); let moved = [], packed = 0, sealed = 0, same = 0;
  for (const id of ids) { const l = line(id); if (!l) continue; const from = kase(bucketOf(l));
    if (l.packed) { packed++; continue; } if (from && from.sealed) { sealed++; continue; } if ((l.plan || null) === (x || null)) { same++; continue; }
    l.plan = x || null; moved.push(l); }
  const skip = [packed ? `${packed} packed line${packed > 1 ? 's' : ''} stay (move in the warehouse)` : '', sealed ? `${sealed} in a sealed case` : '', same && !moved.length ? 'already there' : ''].filter(Boolean).join(' · ');
  if (!moved.length) { toast(`Nothing moved${skip ? ' · ' + skip : ''}`); return; }
  state.sel.clear(); closeLayer(); render();
  toast(`${moved.length === 1 ? esc(moved[0].name) : plural(moved.length, 'line')} → ${target ? esc(target.name) : 'Unplanned'}${skip ? ' · ' + skip : ''}`, undo);
}
function pickMenu(anchor, ids, title) {
  state.pending = ids; const v = cur();
  openMenu(anchor, title, [...v.cases.map(c => ({ label: `<span class="mono">${esc(c.name)}</span>`, act: 'planto', args: `data-x="${c.id}"`, small: c.sealed ? 'sealed' : plural(allIn(c.id).length, 'line') })), '-', { label: 'New case…', act: 'addcase' }]);
}
function confirmDlg(over, title, copy, okLabel, okAct, args = '', danger = false) {
  openDialog(`<div class="hd"><div class="t-overline">${over}</div><h2 style="font-size:18px">${title}</h2></div><div class="bd"><div class="t-small" style="line-height:1.5">${copy}</div></div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn ${danger ? 'btn-secondary' : 'btn-primary'}" style="${danger ? 'color:var(--t-out)' : ''}" data-act="${okAct}" ${args}>${okLabel}</button></div>`);
}
const ASSETS_LIST = [['LX-01', 'Road case 8U lighting', '#2350 Qantas awards'], ['LX-03', 'Road case 6U lighting', ''], ['LX-05', 'Road case 8U lighting', ''], ['VID-02', 'Road case projector', '#2340 Launch night'], ['VID-05', 'Road case video rack', ''], ['BATT-02', 'Battery box', ''], ['PEL-0007', 'Pelican 1740 case', ''], ['GAT-0003', 'Gator 6U rack case', '']];
function addCaseDialog() {
  const v = cur(), inv = state.caseKind === 'inv';
  openDialog(`<div class="hd"><div class="t-overline">Add case · ${esc(vfull(v))}</div><h2 style="font-size:18px">A case for this job</h2></div><div class="bd" style="gap:12px">
    <div class="segrow" style="border-bottom:1px solid var(--line)"><button class="${inv ? 'on' : ''}" data-act="casekind" data-k="inv">From inventory</button><button class="${!inv ? 'on' : ''}" data-act="casekind" data-k="custom">Custom</button><button disabled style="opacity:.5">Bulk tub <span class="n">later</span></button></div>
    ${inv ? `<div class="field"><label>Find a case</label><input id="c-q" placeholder="Tag or model" autocomplete="off"><div id="c-res" style="margin-top:4px">${assetRows('')}</div></div>` : ''}
    ${field('Name', `<input id="c-name" placeholder="${inv ? 'Defaults to the case tag' : 'e.g. Cable tub 2'}" value="${esc(state.pickAsset && inv ? state.pickAsset : '')}" maxlength="60">`)}
    ${field('Packed inside', `<select id="c-in" style="height:36px;border-radius:10px;background:var(--card);color:var(--ink);border:1px solid var(--control-line);padding:0 10px"><option value="">Not inside another case</option>${v.cases.filter(c => !c.inside).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>`)}
    ${field('Description', `<input id="c-desc" placeholder="Optional" maxlength="120">`)}
  </div><div class="ft"><span class="t-micro muted">Cases are never priced.</span><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="addcasego">Add case</button></div>`);
}
const assetRows = q => ASSETS_LIST.filter(a => !q || (a[0] + ' ' + a[1]).toLowerCase().includes(q.toLowerCase())).map(a => `<button class="res2 ${state.pickAsset === a[0] ? 'on' : ''}" data-act="pickasset" data-t="${a[0]}"><span class="mono">${a[0]}</span><span class="muted" style="flex:1">${a[1]}</span>${a[2] ? `<span class="dotw warn">In use · ${a[2]}</span>` : '<span class="dotw ok">Available</span>'}</button>`).join('') || '<div class="cc-note">No case matches.</div>';
function makeLiveDialog(t) {
  const o = ver(state.live), d = diff(o, t), lost = o.lines.filter(l => l.packed && !t.lines.find(x => x.id === l.id));
  const qtyCh = t.lines.filter(l => o.lines.find(x => x.id === l.id && x.qty !== l.qty)).map(l => { const x = o.lines.find(y => y.id === l.id); return `${l.name} ${l.qty - x.qty > 0 ? '+' : '−'}${Math.abs(l.qty - x.qty)}`; });
  const avail = [...d.added.map(r => `${r.t} +`), ...d.removed.map(r => `${r.t} −`)].length + qtyCh.length;
  const names = [...t.lines.filter(l => !o.lines.find(x => x.id === l.id)).map(l => `${l.name} +${l.qty}`), ...o.lines.filter(l => !t.lines.find(x => x.id === l.id)).map(l => `${l.name} −${l.qty}`), ...qtyCh].slice(0, 3).join(', ');
  const bal = total(t) - INVOICED, balNow = total(o) - INVOICED;
  openDialog(`<div class="hd"><div class="t-overline">Make v${t.n} live</div><h2 style="font-size:18px">${esc(vfull(t))} becomes the live version</h2></div><div class="bd" style="gap:0">
    <div class="lrw"><span class="k">Warehouse</span>The pick list follows v${t.n}: ${plural(t.lines.length, 'line')} (now ${o.lines.length}). Gear already packed carries over by lineage${lost.length ? `; <span style="color:var(--warn)">${plural(lost.length, 'packed line')} ${lost.length > 1 ? 'are' : 'is'} not on v${t.n}</span>` : ''}.</div>
    <div class="lrw"><span class="k">Availability</span>${avail ? `Demand changes on ${plural(avail, 'model')} — ${esc(names)}${avail > 3 ? ' and more' : ''}. Re-checked for 12 – 14 Nov; a shortage is named, never a block.` : 'No change in demand.'}</div>
    <div class="lrw"><span class="k">Invoices</span>INV-0041 (deposit ${money2(INVOICED)}, paid) stays. The quote total becomes <span class="mono">${money2(total(t))}</span> (now ${money2(total(o))}); the balance to raise moves from ${money2(balNow)} to <span class="mono">${money2(bal)}</span>.</div>
    <div class="t-micro muted" style="padding-top:10px">v${o.n} stays saved — nothing is deleted. This sends nothing to the client.</div>
  </div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="makelivego" data-n="${t.n}">Make v${t.n} live</button></div>`);
}
function openSheet(html) { body.innerHTML = html; layer.classList.add('open', 'dim'); }
function compareSheet() {
  const c = state.cmp, a = ver(c.a), b = ver(c.b), d = diff(a, b);
  const sec = (title, rows) => rows.length ? `<div class="cmp-h">${title}<span class="n">${rows.length}</span></div>${rows.map(r => `<div class="cmp-r"><div class="grow"><div class="t">${esc(r.t)}</div><div class="d">${esc(r.d)}</div></div><div class="amt">${signed(r.amt)}</div></div>`).join('')}` : '';
  const none = !d.added.length && !d.removed.length && !d.changed.length && !d.services.length;
  const nl = [a, b].find(v => v.n !== state.live);
  openSheet(`<div class="rsheet" role="dialog" aria-label="Compare versions"><div class="hd"><div class="t-overline">Compare · read only</div><h2>What changed</h2><div class="hdrow" style="margin-top:8px"><button class="lnk" style="color:var(--ink);font-size:13px" data-act="cmpside" data-s="a">${esc(vname(a))} ▾</button><span class="muted">→</span><button class="lnk" style="color:var(--ink);font-size:13px" data-act="cmpside" data-s="b">${esc(vname(b))} ▾</button><span class="muted t-small">${[a, b].map(v => v.label).filter(Boolean).map(esc).join(' → ')}</span></div></div><div class="bd">
    <div class="cmp-bridge"><span class="mono">${money2(d.totA)}</span><span class="muted">→</span><b>${money2(d.totB)}</b><span class="muted">·</span><b>${signed(d.totB - d.totA)}</b></div>
    ${none ? `<div class="empty"><b>No differences</b>These two versions have the same lines and prices.</div>` : sec('Added', d.added) + sec('Removed', d.removed) + sec('Changed', d.changed) + sec('Services', d.services)}
    ${d.planDiff ? `<div class="cmp-h">Packing plan<span class="n">${d.planDiff}</span></div><div class="cmp-r"><div class="grow"><div class="d">${plural(d.planDiff, 'line')} planned into a different case. Not priced.</div></div></div>` : ''}
  </div><div class="ft"><span class="t-micro muted">Totals include services</span><div style="flex:1"></div>${nl ? `<button class="btn btn-secondary" data-act="makelive" data-n="${nl.n}">Make v${nl.n} live</button>` : ''}<button class="btn btn-secondary" data-act="close">Close</button></div></div>`);
}
// ---------- actions
function act(name, el, ev) {
  const id = el && el.dataset.id, l = id ? line(id) : null, x = el && el.dataset.x;
  switch (name) {
    case 'close': closeLayer(); break;
    case 'noop': closeLayer(); toast('Not wired in this prototype'); break;
    case 'tab': state.tab = el.dataset.t; state.sel.clear(); closeLayer(); render(); $('.content').scrollTop = 0; break;
    case 'edit': toast('Opens the Basics sheet — see the Overview prototype'); break;
    case 'new': if (state.tab === 'packing') addCaseDialog(); else act('saveversion', null); break;
    case 'lockmenu': openMenu(el, 'Pricing locked', [{ sh: 'Locked by Jayden · Thu 6 Nov' }, { label: 'Prices are read-only; planning, quantities and cases still move', act: 'close' }, '-', { label: 'Unlock from Equipment', href: EQUIP }]); break;
    case 'docs': openMenu(el, 'Documents', [{ sh: 'Warehouse paperwork' }, { label: 'Manifest', act: 'doc', args: 'data-d="Manifest"', small: 'no prices' }, { label: 'Packing list', act: 'doc', args: 'data-d="Packing list"' }, { label: 'Return sheet', act: 'doc', args: 'data-d="Return sheet"' }, { label: 'Delivery docket', act: 'doc', args: 'data-d="Delivery docket"' }, { sh: 'Case labels' }, { label: `All ${cur().cases.length} case labels`, act: 'doc', args: 'data-d="Case labels"' }, ...cur().cases.map(c => ({ label: c.name, act: 'doc', args: `data-d="Label ${c.name}"` })), '-', { label: 'Quote and invoice PDFs are in Finance', href: FIN, small: '↗' }]); break;
    case 'doc': closeLayer(); toast(`${el.dataset.d} · opens the PDF in a new tab`); break;
    case 'jobmenu': { const pre = state.tab === 'packing' ? [{ sh: 'Packing' }, { label: 'Print all case labels', act: 'doc', args: 'data-d="Case labels"' }, { label: 'Manifest (no prices)', act: 'doc', args: 'data-d="Manifest"' }, { label: 'Select the unplanned lines', act: 'selunplanned' }, '-', { sh: 'Job' }] : [{ sh: 'Versions' }, { label: 'Compare two versions…', act: 'cmpopen' }, '-', { sh: 'Job' }]; openMenu(el, '#2341 Hilton gala', [...pre, { label: 'Comments & discussion', href: TN, small: '1 blocking' }, { label: 'Warehouse page', href: WH }, { label: 'Runsheet', act: 'noop' }, { label: 'Duplicate', act: 'noop' }, { label: 'Save as template', act: 'noop' }, '-', { label: 'Cancel job…', act: 'noop', danger: true }]); break; }
    case 'vmenu': openMenu(el, 'Versions', [...[...state.versions].sort((a, b) => b.n - a.n).map(v => ({ label: `v${v.n}${v.n === state.live ? ' · Live' : ''}${v.label ? ' · ' + esc(v.label) : ''}`, act: 'vswitch', args: `data-n="${v.n}"`, on: v.n === state.viewing, small: v.at.replace(/^\w+ /, '') })), '-', { label: `Save as new version…`, act: 'saveversion' }, { label: 'Compare…', act: 'cmpopen' }, { label: 'Manage versions', act: 'tab', args: 'data-t="versions"', small: 'V' }]); break;
    case 'vswitch': { state.viewing = +el.dataset.n; state.sel.clear(); closeLayer(); render(); toast(+el.dataset.n === state.live ? `Back to the live version, v${state.live}` : `Viewing ${esc(vfull(cur()))} — a draft, fully editable`); break; }
    case 'backlive': state.viewing = state.live; state.sel.clear(); render(); break;
    case 'vopen': { const n = +el.dataset.n; state.viewing = n; state.sel.clear(); render(); toast(n === state.live ? `Viewing the live version, v${n}` : `Viewing ${esc(vfull(ver(n)))} — Equipment, Packing and Finance now show it`); break; }
    case 'vtabmenu': openMenu(el, 'Versions', [{ label: 'Compare two versions…', act: 'cmpopen' }, { label: 'Quotes and invoices in Finance', href: FIN }, { label: 'Keyboard: V opens this tab', act: 'close', small: 'V' }]); break;
    case 'vrowmenu': { const n = +el.dataset.n, v = ver(n), live = n === state.live; openMenu(el, esc(vfull(v)), [{ label: n === state.viewing ? 'Viewing now' : 'Open this version', act: 'vswitch', args: `data-n="${n}"`, on: n === state.viewing }, ...(live ? [] : [{ label: `Make v${n} live…`, act: 'makelive', args: `data-n="${n}"` }]), { label: live ? (ver(n - 1) ? `Compare with v${n - 1}…` : 'Compare…') : `Compare with v${state.live}…`, act: 'cmpfor', args: `data-n="${n}"` }, { label: 'Rename…', act: 'vrename', args: `data-n="${n}"` }, { label: `Save a copy as new version…`, act: 'saveversion', args: `data-n="${n}"` }, ...(live ? [] : ['-', { label: 'Delete version…', act: 'vdelete', args: `data-n="${n}"`, danger: true }])]); break; }
    case 'cmpfor': { const n = +el.dataset.n; state.cmp = n === state.live ? { a: (ver(n - 1) || ver(n)).n, b: n } : { a: n, b: state.live }; closeLayer(); compareSheet(); break; }
    case 'cmpopen': { const o = state.versions.find(v => v.n !== state.live); state.cmp = { a: o.n, b: state.live }; closeLayer(); compareSheet(); break; }
    case 'cmpside': { const s = el.dataset.s; openMenu(el, 'Compare ' + (s === 'a' ? 'from' : 'to'), [...state.versions].sort((a, b) => b.n - a.n).map(v => ({ label: vname(v) + (v.label ? ' · ' + esc(v.label) : ''), act: 'cmpset', args: `data-s="${s}" data-n="${v.n}"`, on: state.cmp[s] === v.n }))); break; }
    case 'cmpset': state.cmp[el.dataset.s] = +el.dataset.n; closeLayer(); compareSheet(); break;
    case 'makelive': closeLayer(); makeLiveDialog(ver(+el.dataset.n)); break;
    case 'makelivego': {
      const t = ver(+el.dataset.n), o = ver(state.live), undo = snapshot(), lost = o.lines.filter(q => q.packed && !t.lines.find(z => z.id === q.id));
      state.live = t.n; state.viewing = t.n; state.sel.clear(); render();
      if (lost.length) { openDialog(`<div class="hd"><div class="t-overline">Make v${t.n} live</div><h2 style="font-size:18px">v${t.n} is live · ${plural(lost.length, 'item')} ${lost.length > 1 ? 'need' : 'needs'} a look</h2></div><div class="bd"><div class="t-small" style="line-height:1.6">${lost.map(q => `<div class="lrw"><span class="dotw warn">${esc(q.name)}</span> · ${q.qty} packed ${q.qty > 1 ? 'units are' : 'unit is'} not on v${t.n}. They stay checked out to this job until someone returns them.</div>`).join('')}</div></div><div class="ft"><div style="flex:1"></div><button class="btn btn-primary" data-act="close">Done</button></div>`); }
      else closeLayer();
      toast(`v${t.n} is live · the warehouse, availability and invoices follow it`, undo); break; }
    case 'saveversion': { const from = el && el.dataset.n ? ver(+el.dataset.n) : cur(), n = Math.max(...state.versions.map(v => v.n)) + 1; state.from = from.n; closeLayer();
      openDialog(`<div class="hd"><div class="t-overline">Save as new version</div><h2 style="font-size:18px">Save v${n} from ${esc(vfull(from))}</h2></div><div class="bd">${field('Name', `<input id="v-name" placeholder="e.g. With LED wall" maxlength="60">`, 'An internal name — never printed unless you tick it when sending.')}<div class="t-small muted" style="padding-top:8px;line-height:1.5">A full copy: lines, cases and the packing plan. The live version does not change and nothing is sent to the client.</div></div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="savegover" data-n="${from.n}">Save as v${n}</button></div>`, d => $('#v-name', d).focus()); break; }
    case 'savegover': { const from = ver(+el.dataset.n), undo = snapshot(), n = Math.max(...state.versions.map(v => v.n)) + 1, label = ($('#v-name', body).value || '').trim(); const c = cp(from); Object.assign(c, { n, label, at: 'Mon 9 Nov', by: 'Jayden Cole', note: 'never sent' }); state.versions.push(c); state.viewing = n; state.tab = 'versions'; closeLayer(); render(); toast(`Saved v${n}${label ? ` “${esc(label)}”` : ''} from v${from.n} · you are viewing it`, undo); break; }
    case 'vrename': { const v = ver(+el.dataset.n); closeLayer(); openDialog(`<div class="hd"><div class="t-overline">Rename</div><h2 style="font-size:18px">v${v.n}</h2></div><div class="bd">${field('Name', `<input id="v-name" value="${esc(v.label)}" maxlength="60" placeholder="e.g. With LED wall">`, 'An internal name — never printed unless checked at send time.')}</div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="vrenamego" data-n="${v.n}">Save name</button></div>`, d => $('#v-name', d).focus()); break; }
    case 'vrenamego': { const v = ver(+el.dataset.n), undo = snapshot(); v.label = ($('#v-name', body).value || '').trim(); closeLayer(); render(); toast(v.label ? `Labelled v${v.n} “${esc(v.label)}”` : `Cleared v${v.n}’s name`, undo); break; }
    case 'vdelete': { const v = ver(+el.dataset.n); closeLayer(); confirmDlg('Delete version', `Delete v${v.n}?`, `This permanently deletes v${v.n}${v.label ? ` (“${esc(v.label)}”)` : ''}, its ${plural(v.lines.length, 'line')} and its packing plan. The live version v${state.live} and its invoices are not touched. This can’t be undone.`, 'Delete version', 'vdeletego', `data-n="${v.n}"`, true); break; }
    case 'vdeletego': { const n = +el.dataset.n; state.versions = state.versions.filter(v => v.n !== n); if (state.viewing === n) state.viewing = state.live; closeLayer(); render(); toast(`Deleted v${n}`); break; }
    // packing
    case 'select': { if (ev && ev.shiftKey && state.lastSel) { const order = [...document.querySelectorAll('.pl[data-id]')].map(e => e.dataset.id), a = order.indexOf(state.lastSel), b = order.indexOf(id); if (a >= 0 && b >= 0) for (const k of order.slice(Math.min(a, b), Math.max(a, b) + 1)) state.sel.add(k); } else state.sel.has(id) ? state.sel.delete(id) : state.sel.add(id); state.lastSel = id; render(); break; }
    case 'selcard': { const shown = inBucket(x || null), all = shown.every(q => state.sel.has(q.id)); shown.forEach(q => all ? state.sel.delete(q.id) : state.sel.add(q.id)); render(); break; }
    case 'selunplanned': closeLayer(); cur().lines.filter(q => !bucketOf(q)).forEach(q => state.sel.add(q.id)); render(); break;
    case 'clearsel': state.sel.clear(); render(); break;
    case 'showmore': state.open.add(x || 'un'); render(); break;
    case 'fmenu': { const k = el.dataset.k, opts = k === 'cat' ? CATS : ['Not planned', 'Planned', 'Packed']; openMenu(el, k === 'cat' ? 'Category' : 'Status', [...opts.map(o => ({ label: o, act: 'fset', args: `data-k="${k}" data-v="${o}"`, on: state.f[k] === o })), '-', { label: 'Clear', act: 'fset', args: `data-k="${k}" data-v=""` }]); break; }
    case 'fset': state.f[el.dataset.k] = el.dataset.v; closeLayer(); render(); break;
    case 'clearf': state.f = { cat: '', status: '' }; state.q = ''; $('#q').value = ''; closeLayer(); render(); break;
    case 'tabmenu': openMenu(el, 'Packing', [{ label: 'Print all case labels', act: 'doc', args: 'data-d="Case labels"' }, { label: 'Manifest (no prices)', act: 'doc', args: 'data-d="Manifest"' }, '-', { label: 'Select the unplanned lines', act: 'selunplanned' }, { label: 'Show every line in every case', act: 'expandall' }, { label: 'Show fewer lines per case', act: 'collapseall' }, '-', { label: 'Open the warehouse page', href: WH }]); break;
    case 'expandall': state.open = new Set(['un', ...cur().cases.map(c => c.id)]); closeLayer(); render(); break;
    case 'collapseall': state.open.clear(); closeLayer(); render(); break;
    case 'rowmenu': { const c = kase(bucketOf(l)); openMenu(el, esc(l.name), [{ label: 'Plan into…', act: 'rowplan', args: `data-id="${l.id}"`, small: l.packed ? 'packed' : '' }, ...(l.plan && !l.packed ? [{ label: `Unplan (back from ${esc(kase(l.plan).name)})`, act: 'rowunplan', args: `data-id="${l.id}"` }] : []), '-', l.packed ? { label: 'Move it in the warehouse', href: WH } : { label: 'Show on Equipment', href: EQUIP }, { label: 'Open the warehouse page', href: WH }]); break; }
    case 'rowplan': if (l.packed) { closeLayer(); toast(`${esc(l.name)} is packed in ${esc(kase(l.packed).name)} — what was packed wins; move it in the warehouse`); break; } closeLayer(); { const a = document.querySelector(`.pl[data-id="${l.id}"] .dots`) || el; pickMenu(a, [l.id], 'Plan ' + esc(l.name) + ' into'); } break;
    case 'rowunplan': planInto([l.id], null); break;
    case 'bulkplan': pickMenu(el, [...state.sel], `Plan ${state.sel.size} into`); break;
    case 'bulkunplan': planInto([...state.sel].filter(q => { const z = line(q); return z && z.plan && !z.packed; }), null); break;
    case 'planto': planInto(state.pending, x || null); break;
    case 'casemenu': { const c = kase(x); openMenu(el, esc(c.name), [{ label: 'Rename…', act: 'caserename', args: `data-x="${x}"` }, { label: 'Print case label', act: 'doc', args: `data-d="Label ${esc(c.name)}"` }, { label: c.sealed ? 'Unseal case' : 'Seal case', act: 'caseseal', args: `data-x="${x}"` }, { label: state.open.has(x) ? 'Show fewer lines' : 'Show every line', act: 'casetoggle', args: `data-x="${x}"` }, '-', { label: 'Delete case…', act: 'casedelete', args: `data-x="${x}"`, danger: true }]); break; }
    case 'casetoggle': state.open.has(x) ? state.open.delete(x) : state.open.add(x); closeLayer(); render(); break;
    case 'caseseal': { const c = kase(x), undo = snapshot(); c.sealed = !c.sealed; closeLayer(); render(); toast(c.sealed ? `${esc(c.name)} sealed · label queued to print · lines stay put until it is unsealed` : `${esc(c.name)} unsealed`, undo); break; }
    case 'caserename': { const c = kase(x); closeLayer(); openDialog(`<div class="hd"><div class="t-overline">Rename case</div><h2 style="font-size:18px">${esc(c.name)}</h2></div><div class="bd">${field('Name', `<input id="c-name" value="${esc(c.name)}" maxlength="60">`)}</div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="carenamego" data-x="${x}">Save name</button></div>`, d => $('#c-name', d).focus()); break; }
    case 'carenamego': { const c = kase(x), n = ($('#c-name', body).value || '').trim(); if (!n) break; const undo = snapshot(), old = c.name; c.name = n; closeLayer(); render(); toast(`${esc(old)} renamed to ${esc(n)}`, undo); break; }
    case 'casedelete': { const c = kase(x), ls = allIn(x), pk = ls.filter(q => q.packed).length; closeLayer();
      if (pk) openDialog(`<div class="hd"><div class="t-overline">Delete case</div><h2 style="font-size:18px">${esc(c.name)} can’t be deleted yet</h2></div><div class="bd"><div class="t-small" style="line-height:1.5">${plural(pk, 'line')} ${pk > 1 ? 'are' : 'is'} packed in it. Unpack ${pk > 1 ? 'them' : 'it'} in the warehouse first; the plan alone never blocks a delete.</div></div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">OK</button><a class="btn btn-primary" href="${WH}">Open the warehouse page ↗</a></div>`);
      else confirmDlg('Delete case', `Delete ${esc(c.name)}?`, ls.length ? `${plural(ls.length, 'planned line')} go${ls.length === 1 ? 'es' : ''} back to Unplanned. Nothing is packed in it. The case itself returns to inventory.` : 'It is empty. The case returns to inventory.', 'Delete case', 'casedeletego', `data-x="${x}"`, true); break; }
    case 'casedeletego': { const c = kase(x), undo = snapshot(), n = allIn(x).length; cur().lines.forEach(q => { if (q.plan === x) q.plan = null; }); cur().cases = cur().cases.filter(z => z.id !== x); cur().cases.forEach(z => { if (z.inside === x) z.inside = null; }); closeLayer(); render(); toast(`${esc(c.name)} deleted${n ? ` · ${plural(n, 'line')} back to Unplanned` : ''}`, undo); break; }
    case 'addcase': closeLayer(); state.caseKind = 'inv'; state.pickAsset = null; addCaseDialog(); break;
    case 'casekind': state.caseKind = el.dataset.k; addCaseDialog(); break;
    case 'pickasset': { state.pickAsset = el.dataset.t; const nm = $('#c-name', body); if (nm) nm.value = el.dataset.t; $('#c-res', body).innerHTML = assetRows($('#c-q', body).value); break; }
    case 'addcasego': {
      const inv = state.caseKind === 'inv', nm = ($('#c-name', body).value || '').trim() || (inv ? state.pickAsset || '' : '');
      if (!nm) { toast(inv ? 'Pick a case from inventory, or switch to Custom' : 'Give the case a name'); break; }
      const a = inv ? ASSETS_LIST.find(z => z[0] === state.pickAsset) : null; const undo = snapshot(), v = cur(), nid = 'x' + (Math.max(...v.cases.map(z => +z.id.slice(1))) + 1);
      v.cases.push({ id: nid, name: nm, kind: a ? (a[1].split(' ')[0] === 'Battery' ? 'Battery box' : 'Road case') : 'Custom case', sealed: false, inside: $('#c-in', body).value || null });
      closeLayer(); render(); toast(`${esc(nm)} added to ${esc(vfull(v))} · drop lines into it`, undo); break; }
    case 'undo': if (state.undo) { state.undo(); state.undo = null; } $('#toast').classList.remove('open'); break;
    case 'toastclose': $('#toast').classList.remove('open'); break;
  }
}
// ---------- inputs, shortcuts, drag and drop
document.addEventListener('input', ev => {
  if (ev.target.id === 'q') { state.q = ev.target.value; render(); $('#q').focus(); }
  if (ev.target.id === 'c-q') $('#c-res', body).innerHTML = assetRows(ev.target.value);
});
document.addEventListener('keydown', ev => { if (ev.key.toLowerCase() === 'v' && !ev.metaKey && !ev.ctrlKey && !ev.altKey && !ev.target.matches('input,textarea,select') && !layer.classList.contains('open')) { act('tab', { dataset: { t: 'versions' } }); } });
const clearDrop = () => document.querySelectorAll('.drop-into').forEach(e => e.classList.remove('drop-into'));
document.addEventListener('dragstart', ev => { const src = ev.target.closest && ev.target.closest('.pl[draggable="true"]'); if (!src) return; const id = src.dataset.id; const ids = state.sel.has(id) && state.sel.size > 1 ? [...state.sel] : [id]; state.drag = ids; ev.dataTransfer.effectAllowed = 'move'; try { ev.dataTransfer.setData('text/plain', ids.join(',')); } catch (e) {} src.classList.add('dragging'); });
document.addEventListener('dragover', ev => { if (!state.drag) return; const t = ev.target.closest('[data-drop="case"]'); clearDrop(); if (!t) return; ev.preventDefault(); t.classList.add('drop-into'); });
document.addEventListener('drop', ev => { if (!state.drag) return; const t = ev.target.closest('[data-drop="case"]'); ev.preventDefault(); const ids = state.drag; state.drag = null; clearDrop(); if (!t) return; planInto(ids, t.dataset.x || null, 'drag'); });
document.addEventListener('dragend', () => { state.drag = null; clearDrop(); document.querySelectorAll('.dragging').forEach(e => e.classList.remove('dragging')); });
fixChrome();
render();
