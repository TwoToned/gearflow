// ---------- Finance hub · data
const TODAY = '2026-11-09';
const FIN = 'https://claude.ai/artifact/7ByfxnbtsgQTJdiwvvo1CY', PEOPLE = 'https://claude.ai/artifact/LPdsNGb4CRMfS6qk7j7Fsa', SETTINGS = 'https://claude.ai/artifact/Q3TeWuQPjzvXbAtmUV8Hg8';
const JOBSURL = 'https://claude.ai/artifact/A7SMPtpTr3aedUDEnuSaxd', ASSETSURL = 'https://claude.ai/artifact/89PDTuMiovgP9i3h4MJ1Tw';
const rnd = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(77);
const addD = (d, n) => new Date((dayNum(d) + n) * 864e5).toISOString().slice(0, 10);
const left = d => dayNum(d) - dayNum(TODAY);
const PMS = ['Jayden', 'Mel', 'Tom'];
const PROFILE = { 'Hilton Sydney':['Priya Shah',25], 'Qantas':['Marcus Lee',25], 'Atlassian':['Nina Patel',25], 'Canva':['Ruby Chen',25], 'Sydney Opera House':['Hannah Brooks',30], 'Ogilvy':['Tom Ellis',25], 'UNSW':['Alan Ward',0], 'Live Nation':['Jess Cooper',30], 'ICC Sydney':['Ben Harris',25], 'Red Bull':['Kai Mori',25] };
const CL = Object.keys(PROFILE);
const JOBS = [['#2341','Hilton Sydney gala dinner','Hilton Sydney','Jayden'],['#2350','Qantas awards night','Qantas','Mel'],['#2340','Launch night','Ogilvy','Tom'],['#2338','Corporate AGM','Atlassian','Jayden'],['#2357','Sales kickoff','Canva','Mel'],['#2349','Festival stage','Red Bull','Tom'],['#2309','UNSW graduation','UNSW','Jayden'],['#2322','Ogilvy product launch','Ogilvy','Tom'],['#2331','Gala ball','Sydney Opera House','Mel'],['#2344','Town hall','ICC Sydney','Jayden'],['#2346','Summer tour','Live Nation','Tom'],['#2336','Conference','Live Nation','Mel'],['#2347','Trade show','ICC Sydney','Jayden'],['#2345','Charity ball','Sydney Opera House','Mel']];
const FILL = ['Awards lunch','Brand launch','Graduation night','Arena tour','Staff town hall','Festival main stage','Expo stand','Wedding reception','Fashion week','Film premiere','Roadshow','Exhibition fit-out','Press day','Gala auction'];
FILL.forEach((n, i) => JOBS.push(['#' + (2280 + i * 2), n, CL[(i * 3 + 1) % 10], PMS[i % 3]]));
const JB = JOBS.map(([num, name, client, pm]) => ({ num, name, client, pm, contact:PROFILE[client][0], dep:PROFILE[client][1] }));
const job = n => JB.find(j => j.num === n);
let Q = [], I = [], qn = 0, inn = 0;
const addQ = (num, v, status, o = {}) => Q.push({ id:'q' + (++qn), job:num, v, status, total:null, sentAt:null, validUntil:null, acceptedAt:null, ref:'', created:null, live:true, acked:false, pdf:true, ...o });
const addI = (num, kind, o = {}) => I.push({ id:'i' + (++inn), job:num, kind, pct:null, status:'ISSUED', no:null, total:0, paid:0, issued:null, due:null, xero:'SYNCED', xeroError:'', pdf:true, payments:[], voidReason:'', ...o });
// quotes · the hand-set story rows
addQ('#2341', 1, 'DRAFT', { created:'2026-10-20', live:false });
addQ('#2341', 2, 'SUPERSEDED', { total:24110, sentAt:'2026-10-28', validUntil:'2026-11-27' });
addQ('#2341', 3, 'ACCEPTED', { total:26268, sentAt:'2026-11-04', validUntil:'2026-12-04', acceptedAt:'2026-11-06', ref:'PO 77812' });
addQ('#2350', 1, 'SENT', { total:45320, sentAt:'2026-10-13', validUntil:'2026-11-12' });
addQ('#2347', 1, 'SENT', { total:11990, sentAt:'2026-10-15', validUntil:'2026-11-14' });
addQ('#2340', 1, 'SENT', { total:14850, sentAt:'2026-10-04', validUntil:'2026-11-03' });
addQ('#2344', 1, 'SENT', { total:12430, sentAt:'2026-10-08', validUntil:'2026-11-07' });
addQ('#2331', 1, 'SENT', { total:31900, sentAt:'2026-09-20', validUntil:'2026-10-20', acked:true });
addQ('#2336', 1, 'SENT', { total:20900, sentAt:'2026-10-26', validUntil:'2026-11-25', pdf:false });
addQ('#2338', 1, 'ACCEPTED', { total:21780, sentAt:'2026-10-24', validUntil:'2026-11-23', acceptedAt:'2026-10-28', ref:'PO 4471' });
addQ('#2357', 1, 'DRAFT', { created:'2026-11-02', total:9834 });
addQ('#2349', 1, 'DRAFT', { created:'2026-10-20', total:52470 });
addQ('#2309', 1, 'ACCEPTED', { total:8250, sentAt:'2026-09-12', validUntil:'2026-10-12', acceptedAt:'2026-09-15' });
addQ('#2322', 1, 'ACCEPTED', { total:14300, sentAt:'2026-10-02', validUntil:'2026-11-01', acceptedAt:'2026-10-06', ref:'PO 2290' });
addQ('#2345', 1, 'ACCEPTED', { total:17600, sentAt:'2026-10-18', validUntil:'2026-11-17', acceptedAt:'2026-10-21' });
addQ('#2346', 1, 'ACCEPTED', { total:38500, sentAt:'2026-10-30', validUntil:'2026-11-29', acceptedAt:'2026-11-03', ref:'Email 3 Nov' });
// quotes · filler jobs
const PAT = ['ACC','ACC','SENT','ACC','ACC','DEC','ACC','SENT','ACC','ACC','ACC','SENT','ACC','DRAFT'];
const fillAcc = [];
JB.slice(14).forEach((j, k) => {
  const p = PAT[k], tot = Math.round((3000 + rnd() * 32000) / 10) * 10;
  if (p === 'ACC') { const s = addD(TODAY, -(4 + Math.floor(rnd() * 36))); addQ(j.num, 1, 'ACCEPTED', { total:tot, sentAt:s, validUntil:addD(s, 30), acceptedAt:addD(s, 2 + Math.floor(rnd() * 4)) }); fillAcc.push(j.num); }
  else if (p === 'SENT') { const s = addD(TODAY, -(1 + Math.floor(rnd() * 13))); addQ(j.num, 1, 'SENT', { total:tot, sentAt:s, validUntil:addD(s, 30) }); }
  else if (p === 'DEC') { const s = addD(TODAY, -30); addQ(j.num, 1, 'DECLINED', { total:tot, sentAt:s, validUntil:addD(s, 30) }); }
  else addQ(j.num, 1, 'DRAFT', { total:tot, created:addD(TODAY, -21) });
});
// invoices · numbered ones are numbered after sorting by issue date, so numbers and dates agree
let drafts = 0; const CAP = addD(TODAY, -4);
addI('#2309', 'FULL', { total:8250, issued:'2026-10-08', due:'2026-10-22' });                                          // 18d overdue
addI('#2322', 'DEPOSIT', { pct:25, total:3575, issued:'2026-10-07', due:'2026-10-21', paid:3575, payments:[{ amount:3575, date:'2026-10-19', method:'BANK', ref:'OGI-2322-DEP' }] });
addI('#2322', 'BALANCE', { pct:75, total:10725, issued:'2026-10-21', due:'2026-11-04', paid:2000, payments:[{ amount:2000, date:'2026-11-03', method:'BANK', ref:'OGI part' }] }); // 5d overdue, part paid
addI('#2345', 'DEPOSIT', { pct:25, total:4400, issued:'2026-10-28', due:'2026-11-11', xero:'ERROR', xeroError:'Xero rejected the contact: no email address on file' });
fillAcc.forEach((num, k) => {
  const jq = Q.find(q => q.job === num), j = job(num), pct = j.dep || 100;
  let di = addD(jq.acceptedAt, 1 + Math.floor(rnd() * 3)); if (di > CAP) di = addD(CAP, -Math.floor(rnd() * 3));
  const dep = Math.round(jq.total * pct / 100 / 10) * 10;
  addI(num, pct === 100 ? 'FULL' : 'DEPOSIT', { pct:pct === 100 ? null : pct, total:dep, issued:di, due:addD(di, 14) });
  const bi = addD(di, 18 + Math.floor(rnd() * 14));
  if (pct < 100 && bi <= CAP) addI(num, 'BALANCE', { pct:100 - pct, total:jq.total - dep, issued:bi, due:addD(bi, 14) });
  else if (pct < 100 && drafts++ < 3) addI(num, 'BALANCE', { pct:100 - pct, total:jq.total - dep, status:'DRAFT', xero:null, pdf:false });
});
addI('#2280', 'CREDIT', { total:1200, issued:'2026-10-14', due:'2026-10-14' });
I.forEach(i => { if (i.status !== 'ISSUED' || i.paid || i.payments.length || i.job === '#2309' || i.job === '#2322' || i.job === '#2345' || i.kind === 'CREDIT') return; const d = i.due; if (d < TODAY) { i.paid = i.total; i.payments = [{ amount:i.total, date:addD(d, -2) < TODAY ? addD(d, -2) : addD(TODAY, -1), method:'BANK', ref:'' }]; } else { const r = rnd(); if (r < .5) { /* unpaid */ } else if (r < .7) { i.paid = Math.round(i.total * .5 / 10) * 10; i.payments = [{ amount:i.paid, date:addD(TODAY, -2), method:'BANK', ref:'part' }]; } else { i.paid = i.total; i.payments = [{ amount:i.total, date:addD(i.issued, 3) < TODAY ? addD(i.issued, 3) : addD(TODAY, -1), method:'BANK', ref:'' }]; } } });
{ const v = I.find(i => i.status === 'ISSUED' && !i.paid && i.kind !== 'CREDIT' && i.due >= TODAY && i.job !== '#2345'); if (v) { v.status = 'VOID'; v.voidReason = 'Wrong PO number'; v.xero = null; } }
const nums = I.filter(i => i.status !== 'DRAFT').sort((a, b) => a.issued.localeCompare(b.issued) || a.id.localeCompare(b.id));
nums.forEach((i, k) => { i.no = 'INV-' + String(40 - (nums.length - 1) + k).padStart(4, '0'); });
{ let n = 0; [...nums].reverse().forEach(i => { if (n < 2 && i.status === 'ISSUED' && i.kind !== 'CREDIT' && i.paid < i.total && i.xero === 'SYNCED') { i.xero = 'NOT'; n++; } }); }
I.forEach(i => { if (i.kind === 'CREDIT') i.xero = 'SYNCED'; });
addI('#2341', 'DEPOSIT', { pct:25, no:'INV-0041', total:6567, issued:'2026-11-06', due:'2026-11-20', paid:6567, payments:[{ amount:6567, date:'2026-11-08', method:'BANK', ref:'HIL-2341-DEP' }] });
// ---------- vocab
const QS = { DRAFT:['Draft',''], SENT:['Sent','info'], ACCEPTED:['Accepted','ok'], EXPIRED:['Expired','warn'], DECLINED:['Declined','err'], RECALLED:['Recalled','warn'], SUPERSEDED:['Superseded',''] };
const PS = { DRAFT:['Draft',''], ISSUED:['Issued','info'], PART:['Part paid','warn'], PAID:['Paid','ok'], OVERDUE:['Overdue','err'], VOID:['Void',''], CREDIT:['Credit','info'], DD:['Deposit due','warn'] };
const IK = { FULL:'Full', DEPOSIT:'Deposit', BALANCE:'Balance', CREDIT:'Credit note' }, METHODS = { BANK:'Bank transfer', CARD:'Card', CASH:'Cash', CHEQUE:'Cheque', OTHER:'Other' }, XL = { SYNCED:'Synced', NOT:'Not in Xero', ERROR:'Failed' };
const SEGS = { q:[['all','All'],['draft','Draft'],['sent','Sent'],['accepted','Accepted'],['expired','Expired']], i:[['all','All'],['draft','Draft'],['dd','Deposit due'],['issued','Issued'],['paid','Paid'],['overdue','Overdue']] };
const NOUN = { q:'quotes', i:'invoices' };
const ORD = { q:{ DRAFT:0, SENT:1, EXPIRED:2, ACCEPTED:3, DECLINED:4, RECALLED:5, SUPERSEDED:6 }, i:{ DD:0, DRAFT:1, OVERDUE:2, PART:3, ISSUED:4, PAID:5, CREDIT:6, VOID:7 } };
const ASC = { q:['draft','sent','expired'], i:['draft','dd','issued','overdue'] };
const VIEWS = { q:[{ name:'Expiring in 7 days', seg:'sent', f:{ valid:'soon' } }, { name:'Never sent', seg:'draft', f:{} }], i:[{ name:'Not in Xero', seg:'all', f:{ xero:['NOT','ERROR'] } }, { name:'Deposits to raise', seg:'dd', f:{} }] };
const BLANKF = () => ({ q:{ client:[], sent:'', valid:'' }, i:{ client:[], kind:[], issued:'', xero:[] } });
const state = { tab:'q', seg:{ q:'all', i:'all' }, f:BLANKF(), q:'', sort:null, dir:'asc', page:0, size:25, selected:new Set(), cols:{ contact:false, pm:false }, showDead:false, xero:true, undo:null, savedView:null, lastSel:null };
// ---------- derived (nothing below is stored: expired, overdue, part paid, deposit due, every money word)
const effQ = q => q.status === 'SENT' && q.validUntil && q.validUntil < TODAY ? 'EXPIRED' : q.status;
const qDead = q => ['SUPERSEDED','DECLINED','RECALLED'].includes(q.status) || (q.status === 'DRAFT' && !q.live);
const ackable = q => effQ(q) === 'EXPIRED' && !q.acked && -left(q.validUntil) <= 7;
const bal = i => i.kind === 'CREDIT' ? 0 : i.total - i.paid;
const payState = i => i.status === 'VOID' ? 'VOID' : i.status === 'DRAFT' ? 'DRAFT' : i.kind === 'CREDIT' ? 'CREDIT' : bal(i) <= 0 ? 'PAID' : i.due < TODAY ? 'OVERDUE' : i.paid > 0 ? 'PART' : 'ISSUED';
const lastPaid = i => (i.payments[i.payments.length - 1] || {}).date;
const chaseable = r => r.k === 'q' ? ['SENT','EXPIRED'].includes(r.st) : ['ISSUED','OVERDUE','PART'].includes(r.st);
const xeroable = r => state.xero && r.k === 'i' && !r.ghost && r.src.no && r.src.status === 'ISSUED' && r.src.kind !== 'CREDIT' && r.src.xero !== 'SYNCED';
const isDraft = r => !r.ghost && (r.k === 'q' ? r.st === 'DRAFT' : r.st === 'DRAFT');
function ghosts() { return JB.filter(j => j.dep && Q.some(q => q.job === j.num && q.status === 'ACCEPTED') && !I.some(i => i.job === j.num && i.kind === 'DEPOSIT' && i.status === 'ISSUED')).map(j => { const q = Q.find(x => x.job === j.num && x.status === 'ACCEPTED'); return { k:'i', ghost:true, id:'dd-' + j.num, st:'DD', job:j, ref:'—', total:Math.round(q.total * j.dep / 100), pct:j.dep, jobTotal:q.total, date:'' }; }); }
const qv = q => ({ k:'q', id:q.id, src:q, st:effQ(q), job:job(q.job), ref:q.job + ' v' + q.v, total:q.total, date:q.sentAt || q.created || '' });
const iv = i => ({ k:'i', id:i.id, src:i, st:payState(i), job:job(i.job), ref:i.no || 'Draft', total:i.kind === 'CREDIT' ? -i.total : i.total, date:i.status === 'ISSUED' && i.kind !== 'CREDIT' ? (bal(i) <= 0 ? (lastPaid(i) || i.due) : i.due) : (i.issued || '') });
const allRows = tab => tab === 'q' ? Q.map(qv) : [...I.map(iv), ...ghosts()];
function inSeg(r, s) {
  if (r.k === 'q') { const q = r.src; if (s === 'all') return state.showDead || !qDead(q); if (s === 'draft') return q.status === 'DRAFT' && q.live; if (s === 'sent') return r.st === 'SENT'; if (s === 'accepted') return r.st === 'ACCEPTED'; if (s === 'expired') return ackable(q); }
  else { if (s === 'dd') return !!r.ghost; if (r.ghost) return false; if (s === 'all') return state.showDead || r.st !== 'VOID'; if (s === 'draft') return r.st === 'DRAFT'; if (s === 'issued') return r.st === 'ISSUED' || r.st === 'PART'; if (s === 'paid') return r.st === 'PAID'; if (s === 'overdue') return r.st === 'OVERDUE'; }
  return false;
}
const segCount = (tab, s) => allRows(tab).filter(r => inSeg(r, s)).length;
function matches(r) {
  const t = state.tab, f = state.f[t], q = state.q.trim().toLowerCase();
  if (!inSeg(r, state.seg[t])) return false;
  if (q && ![r.job.name, r.job.num, r.job.client, r.job.contact, r.ref].some(x => String(x).toLowerCase().includes(q))) return false;
  if (f.client.length && !f.client.includes(r.job.client)) return false;
  if (t === 'q') { const s = r.src.sentAt; if (f.sent === 'week' && !(s && left(s) >= -7)) return false; if (f.sent === 'month' && !(s && left(s) >= -30)) return false; if (f.sent === 'older' && !(s && left(s) < -30)) return false; if (f.sent === 'never' && s) return false; if (f.valid === 'soon' && !(r.st === 'SENT' && left(r.src.validUntil) <= 7)) return false; }
  else { if (f.kind.length && !(r.ghost ? f.kind.includes('DEPOSIT') : f.kind.includes(r.src.kind))) return false; const d = r.ghost ? null : r.src.issued; if (f.issued === 'month' && !(d && d.slice(0, 7) === TODAY.slice(0, 7))) return false; if (f.issued === '30' && !(d && left(d) >= -30)) return false; if (f.issued === 'older' && !(d && left(d) < -30)) return false; if (f.xero.length && !(!r.ghost && r.src.no && f.xero.includes(r.src.xero))) return false; }
  return true;
}
function sorted(rows) {
  let k = state.sort, d = state.dir === 'asc' ? 1 : -1; if (!k) { k = 'date'; d = ASC[state.tab].includes(state.seg[state.tab]) ? 1 : -1; }
  const val = r => k === 'ref' ? r.ref : k === 'job' ? r.job.name : k === 'st' ? ORD[state.tab][r.st] : k === 'total' ? r.total : r.date;
  return [...rows].sort((a, b) => { const x = val(a), y = val(b); if (x == null || x === '') return 1; if (y == null || y === '') return -1; return (x > y ? 1 : x < y ? -1 : 0) * d; });
}
const rows = () => sorted(allRows(state.tab).filter(matches));
const rowById = id => allRows(state.tab).find(r => r.id === id);
const anyFilter = () => { const f = state.f[state.tab]; return Object.values(f).some(v => Array.isArray(v) ? v.length : v) || state.q; };
function snapshot() { const q = JSON.parse(JSON.stringify(Q)), i = JSON.parse(JSON.stringify(I)); return () => { Q = q; I = i; state.selected.clear(); render(); }; }
const pl = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const fm = n => n == null ? '—' : (n < 0 ? '−' : '') + money(Math.abs(n));
function words() {
  const sent = Q.filter(q => !qDead(q) && effQ(q) === 'SENT'), open = I.filter(i => ['ISSUED','PART'].includes(payState(i))), over = I.filter(i => payState(i) === 'OVERDUE');
  const mon = I.filter(i => i.status === 'ISSUED' && i.kind !== 'CREDIT' && i.issued.slice(0, 7) === TODAY.slice(0, 7));
  const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
  return { quoted:sum(sent, q => q.total), nSent:sent.length, soon:sent.filter(q => left(q.validUntil) <= 7).length, wait:sum(open, bal), nOpen:open.length, next:open.map(i => i.due).sort()[0], month:sum(mon, i => i.total), nMonth:mon.length, over:sum(over, bal), nOver:over.length, oldest:over.length ? Math.max(...over.map(i => -left(i.due))) : 0 };
}
// ---------- url state (a saved view is a link, a money word is a link)
function toUrl() { try { const p = new URLSearchParams(), t = state.tab, f = state.f[t]; p.set('tab', t === 'q' ? 'quotes' : 'invoices'); if (state.seg[t] !== 'all') p.set('seg', state.seg[t]); if (state.q) p.set('q', state.q); for (const [k, v] of Object.entries(f)) if (Array.isArray(v) ? v.length : v) p.set(k, Array.isArray(v) ? v.join(',') : v); history.replaceState(null, '', '?' + p.toString()); } catch (e) { /* file:// previews may refuse; the state still works */ } }
function fromUrl() { try { const p = new URLSearchParams(location.search); if (p.get('tab') === 'invoices') state.tab = 'i'; const t = state.tab, s = p.get('seg'); if (s && SEGS[t].some(x => x[0] === s)) state.seg[t] = s; if (p.get('q')) { state.q = p.get('q'); $('#q').value = state.q; } const f = state.f[t]; for (const k of Object.keys(f)) if (p.get(k)) f[k] = Array.isArray(f[k]) ? p.get(k).split(',') : p.get(k); } catch (e) { /* ignore */ } }
// ---------- render
function render() { renderChrome(); renderHead(); renderNote(); renderWords(); renderStrip(); renderToolbar(); renderTable(); renderList(); renderFoot(); renderBulk(); toUrl(); }
function renderChrome() {
  if (renderChrome.done) return; renderChrome.done = true;
  const items = [['Dashboard','blue','https://claude.ai/artifact/RPnGj7WnaWcknvQ8ShcRkf'],['Jobs','blue',JOBSURL],['Finance','green','#finance'],['Schedule','green','#schedule'],['Crew','purple','https://claude.ai/artifact/AKkgWzJ2gVR3dJTWnMB2Ui'],['Assets','amber',ASSETSURL],['Warehouse','teal','https://claude.ai/artifact/6xqFcEZZk49w86p5pAsisA'],['Test & tag','teal','https://claude.ai/artifact/8Q2HVoRhLbSLz1Q9mCtayX'],['Maintenance','amber','#maintenance']];
  $('#sidenav').innerHTML = items.map(([n, c, h]) => `<a href="${h}" class="${n === 'Finance' ? 'on' : ''}"><span class="patch" style="background:var(--${c}-soft, var(--paper-2))"></span>${n}</a>`).join('');
  const bn = [...document.querySelectorAll('.bottomnav a')]; ['https://claude.ai/artifact/RPnGj7WnaWcknvQ8ShcRkf', JOBSURL, 'https://claude.ai/artifact/8Q2HVoRhLbSLz1Q9mCtayX', 'https://claude.ai/artifact/6xqFcEZZk49w86p5pAsisA', ASSETSURL].forEach((h, k) => { if (bn[k]) bn[k].setAttribute('href', h); });
  const st = document.querySelector('.sidebar .foot a'); if (st) st.setAttribute('href', SETTINGS);
}
function renderHead() {
  const nq = segCount('q', 'all'), ni = segCount('i', 'all'), t = state.tab;
  const w = (k, n, c) => `<button class="fw ${t === k ? 'on' : ''}" data-act="tab" data-t="${k}">${n}<span class="n">${c}</span></button>`;
  $('#kindsw').innerHTML = w('q', 'Quotes', nq) + w('i', 'Invoices', ni);
  $('#kindrow').innerHTML = [['q','Quotes',nq],['i','Invoices',ni]].map(([k, n, c]) => `<button class="${t === k ? 'on' : ''}" data-act="tab" data-t="${k}">${n} <span class="n">${c}</span></button>`).join('');
  $('#phonesub').textContent = `${nq} quotes · ${ni} invoices · Xero ${state.xero ? 'connected' : 'not connected'}`;
  $('#q').placeholder = t === 'q' ? 'Search quote, job or client' : 'Search invoice, job or client';
}
function renderNote() { $('#xnote').innerHTML = !state.xero && state.tab === 'i' ? `<div class="fnote"><span><b>Xero isn’t connected.</b> Invoices stay in Flow and payments aren’t read back until it is.</span><a class="lnk" href="${SETTINGS}">Open Xero settings</a></div>` : ''; }
function renderWords() {
  const w = words(), mon = MON[+TODAY.slice(5, 7) - 1];
  const mk = (cls, t, s, f, l, num, sub) => `<button class="mw ${cls}" data-act="mw" data-t="${t}" data-s="${s}" ${f ? `data-x="${f}"` : ''} title="Opens ${NOUN[t]} › ${SEGS[t].find(x => x[0] === s)[1]}"><div class="l">${l}</div><div class="num">${num}</div><div class="s">${sub}</div></button>`;
  $('#mwords').innerHTML = mk('', 'q', 'sent', '', 'Quoted', money(w.quoted), `${w.nSent} sent${w.soon ? ` · ${w.soon} expiring in 7 days` : ''}`)
    + mk('', 'i', 'issued', '', 'Awaiting payment', money(w.wait), `${pl(w.nOpen, 'invoice')}${w.next ? ` · next due ${fmtD(w.next)}` : ''}`)
    + mk('', 'i', 'all', 'month', 'Invoiced this month', money(w.month), `${mon} · ${pl(w.nMonth, 'invoice')}`)
    + mk(w.nOver ? 'err' : '', 'i', 'overdue', '', 'Overdue', money(w.over), w.nOver ? `${pl(w.nOver, 'invoice')} · oldest ${w.oldest}d` : 'nothing overdue');
}
function renderStrip() {
  const t = state.tab, segs = SEGS[t];
  $('#strip').innerHTML = segs.map(([k, n], x) => { const c = segCount(t, k), last = x === segs.length - 1; return `<button class="${state.seg[t] === k ? 'on' : ''}" data-act="seg" data-k="${k}" style="${last && c ? 'color:var(--t-out)' : ''}">${n} <span class="n">${c}</span></button>`; }).join('');
}
const lbl = (a, f) => a.length > 1 ? a.length + ' chosen' : a.length ? f(a[0]) : '';
function renderToolbar() {
  const t = state.tab, f = state.f[t];
  const SL = { week:'Last 7 days', month:'Last 30 days', older:'Older', never:'Never sent' }, IL = { month:'This month', 30:'Last 30 days', older:'Older' };
  $('#fwords').innerHTML = filterWord('Client', 'client', lbl(f.client, x => x), 'fmenu')
    + (t === 'q' ? filterWord('Sent', 'sent', SL[f.sent] || '', 'smenu') + filterWord('Validity', 'valid', f.valid ? 'Expiring in 7 days' : '', 'smenu')
      : filterWord('Kind', 'kind', lbl(f.kind, x => IK[x]), 'fmenu') + filterWord('Issued', 'issued', IL[f.issued] || '', 'smenu') + (state.xero ? filterWord('Xero', 'xero', lbl(f.xero, x => XL[x]), 'fmenu') : ''))
    + (anyFilter() ? `<button class="lnk muted" data-act="clearf">Clear</button>` : '');
  $('#views').innerHTML = `<button class="fw ${state.savedView ? 'on' : ''}" data-act="viewsmenu">${state.savedView ? 'View: ' + esc(state.savedView) : 'Views ▾'}</button>`;
}
const jobLink = (j, txt, cls) => j.num === '#2341' ? `<a class="${cls}" href="${FIN}">${txt}</a>` : `<span class="${cls}">${txt}</span>`;
const clLink = j => `<a class="cl" href="${PEOPLE}">${esc(j.client)}</a>`;
function flagsOf(r) { const b = []; if (!r.ghost && r.k === 'q' && r.st !== 'DRAFT' && r.st !== 'SUPERSEDED' && !r.src.pdf) b.push('<span class="dotw warn" title="The render failed; Generate PDF is safe to retry — it never replaces a stored document">no PDF</span>'); return b.length ? `<span style="display:inline-flex;gap:10px;margin-left:10px">${b.join('')}</span>` : ''; }
function statusLines(r) {
  const [n, cls] = (r.k === 'q' ? QS : PS)[r.st]; let l2 = '', c2 = '';
  if (r.k === 'q') { if (r.st === 'SENT' && left(r.src.validUntil) <= 7) { const d = left(r.src.validUntil); l2 = d <= 0 ? 'expires today' : d + 'd left'; c2 = 'w'; } else if (r.st === 'EXPIRED') l2 = -left(r.src.validUntil) + 'd ago'; }
  else if (r.ghost) l2 = `${r.pct}% of ${money(r.jobTotal)}`; else if (r.st === 'OVERDUE') { l2 = -left(r.src.due) + 'd'; c2 = 'e'; } else if (r.st === 'PART') l2 = money(bal(r.src)) + ' to go';
  return [n, cls, l2, c2];
}
function datesCell(r) {
  if (r.k === 'q') { const q = r.src; if (!q.sentAt) return [q.status === 'DRAFT' ? 'Never sent' : '—', q.created ? 'created ' + fmtD(q.created) : '']; return ['Sent ' + fmtD(q.sentAt), r.st === 'ACCEPTED' ? 'accepted ' + fmtD(q.acceptedAt) + (q.ref ? ' · ' + esc(q.ref) : '') : (r.st === 'EXPIRED' || r.st === 'DECLINED' ? 'valid to ' : 'valid to ') + fmtD(q.validUntil)]; }
  if (r.ghost) return ['—', 'no deposit invoice issued']; const i = r.src;
  if (i.status === 'DRAFT') return ['Not issued', 'draft · unnumbered']; if (i.status === 'VOID') return ['Voided', esc(i.voidReason)]; if (i.kind === 'CREDIT') return ['Issued ' + fmtD(i.issued), 'credit note'];
  if (r.st === 'PAID') return ['Paid ' + fmtD(lastPaid(i)), 'issued ' + fmtD(i.issued)];
  return ['Due ' + fmtD(i.due), 'issued ' + fmtD(i.issued) + (i.paid ? ' · ' + money(i.paid) + ' paid' : '')];
}
const xeroCell = r => { if (r.ghost || !r.src.no || r.src.status === 'VOID') return '<span class="faint">—</span>'; const x = r.src.xero; return `<span class="dotw ${x === 'SYNCED' ? 'ok' : x === 'ERROR' ? 'err' : ''}" ${x === 'ERROR' ? `title="${esc(r.src.xeroError)}"` : ''}>${XL[x]}</span>`; };
function renderTable() {
  const t = state.tab, all = rows(), pr = all.slice(state.page * state.size, (state.page + 1) * state.size), allSel = pr.length && pr.every(r => state.selected.has(r.id));
  const cols = [34, t === 'q' ? 104 : 116, 0, 128, 150]; if (state.cols.contact) cols.push(112); if (state.cols.pm) cols.push(80); if (t === 'i' && state.xero) cols.push(108); cols.push(100, 40);
  let h = `<table class="tbl" style="min-width:0;table-layout:fixed;width:100%"><colgroup>${cols.map(w => w ? `<col style="width:${w}px">` : '<col>').join('')}</colgroup><thead><tr><th><button class="cb ${allSel ? 'on' : ''}" data-act="selall" aria-label="Select page"></button></th>${sortHead(t === 'q' ? 'Quote' : 'Invoice', 'ref')}${sortHead('Job', 'job')}${sortHead('Status', 'st')}${sortHead(t === 'q' ? 'Sent' : 'Date', 'date')}${state.cols.contact ? '<th>Contact</th>' : ''}${state.cols.pm ? '<th>PM</th>' : ''}${t === 'i' && state.xero ? '<th>Xero</th>' : ''}${sortHead('Total', 'total', 'r')}<th></th></tr></thead><tbody>`;
  if (!pr.length) h += `<tr><td colspan="${cols.length}"><div class="empty">${emptyMsg()}</div></td></tr>`;
  for (const r of pr) {
    const sel = state.selected.has(r.id), [sn, sc, l2, c2] = statusLines(r), [d1, d2] = datesCell(r), j = r.job;
    const first = r.k === 'q' ? `<span class="mono">${jobLink(j, j.num, 'jn')} <span class="muted">v${r.src.v}</span></span>` : `<span class="mono" style="font-weight:600">${r.ghost ? '<span class="faint">—</span>' : esc(r.ref)}</span><div class="sub">${r.ghost ? 'deposit' : IK[r.src.kind] + (r.src.pct ? ' ' + r.src.pct + '%' : '')}</div>`;
    const jobc = `<div class="ell"><b>${esc(j.name)}</b>${flagsOf(r)}</div><div class="sub ell">${r.k === 'i' ? jobLink(j, j.num, 'mono jn') + ' · ' : ''}${clLink(j)}</div>`;
    h += `<tr class="row ${sel ? 'sel' : ''} ${r.st === 'VOID' ? 'void' : ''} ${r.ghost ? 'gh' : ''}" data-act="open" data-id="${r.id}"><td><button class="cb ${sel ? 'on' : ''}" data-act="select" data-id="${r.id}" aria-label="Select ${esc(r.ref)}"></button></td><td>${first}</td><td style="min-width:0">${jobc}</td><td><span class="dotw ${sc}">${sn}</span>${l2 ? `<div class="sub ${c2}">${l2}</div>` : ''}</td><td><div class="mono t-small">${d1}</div><div class="sub ell">${d2}</div></td>${state.cols.contact ? `<td class="t-small muted">${esc(j.contact)}</td>` : ''}${state.cols.pm ? `<td class="t-small muted">${esc(j.pm)}</td>` : ''}${t === 'i' && state.xero ? `<td>${xeroCell(r)}</td>` : ''}<td class="r mono">${fm(r.total)}</td><td class="r"><button class="dots" data-act="rowmenu" data-id="${r.id}" aria-label="Actions">${ICON.dots}</button></td></tr>`;
  }
  $('#tblwrap').innerHTML = h + '</tbody></table>';
}
function emptyMsg() {
  const t = state.tab, s = state.seg[t];
  if (anyFilter()) return `<b>No ${NOUN[t]} match that</b>Loosen a filter or clear them. <button class="lnk" data-act="clearf">Clear filters</button>`;
  const M = { q:{ all:['No quotes yet', 'A quote starts on a job’s Finance tab — sending it freezes the price.'], draft:['No unsent drafts', 'Every quote you started has gone out.'], sent:['Nothing sitting out with a client', 'Sent quotes waiting on a yes show here, oldest first.'], accepted:['No accepted quotes', 'Accepted quotes unblock confirming the job.'], expired:['Nothing expired this week', 'Quotes past their valid-until date land here for 7 days, or until you acknowledge them.'] }, i:{ all:['No invoices yet', 'Invoices are raised from an accepted quote on the job’s Finance tab.'], draft:['No draft invoices', 'Drafts are unnumbered until they are issued.'], dd:['No deposits to raise', 'Every deposit-balance client has a deposit invoice.'], issued:['Nothing awaiting payment', 'Issued invoices inside their terms show here.'], paid:['Nothing paid yet', 'Paid invoices show here.'], overdue:['Nothing overdue', 'Every issued invoice is inside its terms.'] } };
  const [a, b] = M[t][s]; return `<b>${a}</b>${b}`;
}
function renderList() {
  const t = state.tab, all = rows(), pr = all.slice(0, (state.page + 1) * state.size);
  $('#list').innerHTML = pr.map(r => {
    const sel = state.selected.has(r.id), [sn, sc, l2] = statusLines(r), j = r.job, [d1] = datesCell(r);
    const sub = r.k === 'q' ? `${esc(j.num)} v${r.src.v} · ${d1} · ${esc(j.client)}` : r.ghost ? `${esc(j.num)} · ${r.pct}% deposit · ${esc(j.client)}` : `${esc(r.ref)} · ${d1} · ${esc(j.client)}`;
    return `<div class="lrow ${sel ? 'sel' : ''} ${r.st === 'VOID' ? 'void' : ''}" data-act="open" data-id="${r.id}"><button class="cb ${sel ? 'on' : ''}" data-act="select" data-id="${r.id}" aria-label="Select"></button><div class="grow" style="min-width:0"><div class="ttl ell">${esc(j.name)}${flagsOf(r)}</div><div class="sub ell">${sub}</div></div><div class="right"><span class="dotw ${sc}">${sn}${l2 && r.st === 'OVERDUE' ? ' ' + l2 : ''}</span><div class="mono t-small" style="margin-top:3px">${fm(r.total)}</div></div><button class="dots" data-act="rowmenu" data-id="${r.id}" aria-label="Actions">${ICON.dots}</button></div>`;
  }).join('') || `<div class="empty">${emptyMsg()}</div>`;
  if (all.length > pr.length) $('#list').innerHTML += `<button class="lrow" data-act="more" style="justify-content:center;color:var(--blue);font-weight:600">Show ${Math.min(state.size, all.length - pr.length)} more · ${all.length - pr.length} left</button>`;
}
function renderFoot() {
  const t = state.tab, all = rows(), n = all.length, from = state.page * state.size + 1, to = Math.min(n, (state.page + 1) * state.size), pages = Math.max(1, Math.ceil(n / state.size)), tot = all.reduce((s, r) => s + (r.total || 0), 0);
  const note = t === 'q' && state.seg.q === 'expired' ? ' · expired in the last 7 days and not acknowledged; older ones are under All' : '';
  $('#foot').innerHTML = `<span>${n} ${NOUN[t]}${n > state.size ? ` · ${from}–${to}` : ''} · Totals <span class="mono" style="color:var(--ink)">${fm(tot)}</span>${note}</span><span class="pg"><button data-act="page" data-d="-1" ${state.page === 0 ? 'disabled' : ''} aria-label="Previous page">‹</button><span class="mono t-small">${state.page + 1} / ${pages}</span><button data-act="page" data-d="1" ${state.page >= pages - 1 ? 'disabled' : ''} aria-label="Next page">›</button></span>`;
}
const selRows = () => { const ids = state.selected; return allRows(state.tab).filter(r => ids.has(r.id)); };
function renderBulk() {
  const n = state.selected.size, b = $('#bulk'); b.classList.toggle('open', n > 0); document.body.classList.toggle('hassel', n > 0); if (!n) return;
  const s = selRows(), ch = s.filter(chaseable).length, ak = s.filter(r => r.k === 'q' && ackable(r.src)).length, xs = s.filter(xeroable).length, dr = s.filter(isDraft).length;
  const B = (act, label, extra = '') => `<button class="btn btn-secondary btn-sm ${extra}" data-act="${act}">${label}</button>`;
  b.innerHTML = `<b style="font-size:13px">${n} selected</b>${ch ? B('bulkchase', `Chase ${ch}`) : ''}${ak ? B('bulkack', `Acknowledge ${ak}`) : ''}${xs ? B('bulkxero', `Sync to Xero ${xs}`) : ''}${B('bulkexport', `Export ${n}`, 'deskonly')}${dr ? `<button class="btn btn-secondary btn-sm" style="color:var(--t-out)" data-act="bulkdel">Delete ${dr} draft${dr > 1 ? 's' : ''}</button>` : ''}<button class="btn btn-icon btn-sm" data-act="clearsel" aria-label="Clear selection">✕</button>`;
}
// ---------- actions
function multiMenu(el, key, title, options, labelOf = x => x) { openMenu(el, title, [...options.map(o => ({ label:labelOf(o), act:'ftoggle', args:`data-k="${key}" data-v="${o}"`, on:state.f[state.tab][key].includes(o) })), '-', { label:'Clear', act:'fclear', args:`data-k="${key}"` }]); }
const SOPT = { sent:[['','Any time'],['week','Last 7 days'],['month','Last 30 days'],['older','Older'],['never','Never sent']], valid:[['','Any'],['soon','Expiring in 7 days']], issued:[['','Any time'],['month','This month'],['30','Last 30 days'],['older','Older']] };
function chaseText(r) {
  const j = r.job;
  if (r.k === 'q') { const q = r.src, d = left(q.validUntil); return `Hi ${j.contact.split(' ')[0]},\n\nFollowing up on quote ${j.num} v${q.v} for ${j.name} — ${money(q.total)} inc GST, sent ${fmtD(q.sentAt)}, ${d >= 0 ? `valid until ${fmtD(q.validUntil)} (${d} days left)` : `expired ${-d} days ago`}. Happy to adjust anything before you accept.`; }
  const i = r.src, d = left(i.due); return `Hi ${j.contact.split(' ')[0]},\n\nA reminder that invoice ${i.no} for ${j.name} — ${money(bal(i))} outstanding of ${money(i.total)} inc GST — ${d < 0 ? `was due ${fmtD(i.due)} (${-d} days ago)` : `is due ${fmtD(i.due)}`}. The invoice is attached again for reference.`;
}
function chaseDialog(rs) { closeLayer(); state.chase = rs.map(r => r.id); openDialog(`<div class="hd"><div class="t-overline">Chase</div><h2 style="font-size:18px">${rs.length === 1 ? 'Follow-up for ' + esc(rs[0].k === 'q' ? rs[0].ref : rs[0].src.no) : 'Follow-ups for ' + rs.length + ' ' + NOUN[state.tab]}</h2><div class="t-small muted" style="margin-top:4px">Flow never emails the client — this is text for your own mail client.</div></div><div class="bd"><textarea class="chasebox" readonly id="chasetxt">${esc(rs.map(chaseText).join('\n\n———\n\n'))}</textarea></div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="chasego">Copy ${rs.length === 1 ? 'follow-up' : rs.length}</button></div>`); }
function confirmDlg(over, title, bodyHtml, goAct, goLabel, args = '', keep = 'Keep it') { closeLayer(); openDialog(`<div class="hd"><div class="t-overline">${over}</div><h2 style="font-size:18px">${title}</h2></div><div class="bd"><div class="t-small" style="line-height:1.5">${bodyHtml}</div></div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">${keep}</button><button class="btn btn-secondary" style="color:var(--t-out)" data-act="${goAct}" ${args}>${goLabel}</button></div>`); }
function jobPicker(t) {
  state.pick = t; const js = JB.filter(j => t === 'i' ? Q.some(q => q.job === j.num && q.status === 'ACCEPTED') : true);
  const listHtml = q => js.filter(j => !q || (j.name + j.num + j.client).toLowerCase().includes(q)).slice(0, 8).map((j, k) => { const rem = t === 'i' ? (() => { const qq = Q.find(x => x.job === j.num && x.status === 'ACCEPTED'); const billed = I.filter(i => i.job === j.num && i.status !== 'VOID' && i.kind !== 'CREDIT').reduce((s, i) => s + i.total, 0); return Math.max(0, qq.total - billed); })() : null; return `<button class="pick ${k === 0 ? 'first' : ''}" data-act="newgo" data-id="${j.num}"><span class="mono muted" style="width:52px">${j.num}</span><span class="grow" style="min-width:0"><div class="ell" style="font-weight:600">${esc(j.name)}</div><div class="sub ell">${esc(j.client)}</div></span>${t === 'i' ? `<span class="mono t-small ${rem ? '' : 'faint'}">${rem ? money(rem) + ' to raise' : 'fully invoiced'}</span>` : ''}</button>`; }).join('') || '<div class="empty">No job matches</div>';
  jobPicker.render = listHtml; closeLayer();
  openDialog(`<div class="hd"><div class="t-overline">${t === 'i' ? 'New invoice' : 'New quote'}</div><h2 style="font-size:18px">Which job?</h2><div class="t-small muted" style="margin-top:4px">${t === 'i' ? 'Invoices are raised from an accepted quote, on the job’s Finance tab.' : 'Quotes are sent from the job’s Finance tab — sending freezes the price.'}</div></div><div class="bd"><div class="search" style="width:100%;border:1px solid var(--control-line);background:var(--paper-2);padding:0 12px"><span class="muted">⌕</span><input id="np-q" placeholder="Search job, number or client" autocomplete="off" style="border:0;background:transparent;height:34px"></div><div id="np-list" style="margin-top:8px">${listHtml('')}</div></div>`, d => $('#np-q', d).focus());
}
const payDialog = r => { const i = r.src, b = bal(i); closeLayer(); openDialog(`<div class="hd"><div class="t-overline">Record payment</div><h2 style="font-size:18px">${esc(i.no)} · ${esc(r.job.name)}</h2><div class="t-small muted" style="margin-top:4px">${money(b)} remaining of ${money(i.total)}. Paying a deposit in full can confirm an awaiting-payment job.</div></div><div class="bd"><div class="g3">${field('Amount', `<input id="py-amt" type="number" min="0" value="${b}">`)}${field('Received', `<input id="py-date" type="date" value="${TODAY}">`)}${field('Method', `<select id="py-method">${Object.entries(METHODS).map(([k, v]) => opt(k, v, 'BANK')).join('')}</select>`)}</div><div class="g2" style="margin-top:10px">${field('Reference', '<input id="py-ref" placeholder="bank ref, receipt #">')}${field('Notes', '<input id="py-notes" placeholder="Optional">')}</div>${state.xero ? '<div class="t-micro muted" style="margin-top:8px">Payments reconciled in Xero show up here on their own within the hour; record here only what Xero will not see.</div>' : ''}</div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="paygo" data-id="${r.id}">Record payment</button></div>`); };
function xeroDialog() {
  closeLayer(); const iss = I.filter(i => i.status === 'ISSUED' && i.kind !== 'CREDIT'), syn = iss.filter(i => i.xero === 'SYNCED').length, fail = iss.filter(i => i.xero === 'ERROR').length, top = iss.length - syn - fail;
  openDialog(state.xero ? `<div class="hd"><div class="t-overline">Xero</div><h2 style="font-size:18px">Two Toned Productions</h2></div><div class="bd"><div class="t-small" style="line-height:1.7"><span class="dotw ok">Connected</span><br>${syn} invoices synced${top ? ` · <span style="color:var(--warn)">${top} to push</span>` : ''}${fail ? ` · <span style="color:var(--t-out)">${fail} failed</span>` : ''} · payments are read back hourly. Flow owns the invoice numbers and PDFs; Xero owns the ledger.</div></div><div class="ft"><a class="lnk" href="${SETTINGS}">Open Xero settings</a><div style="flex:1"></div><button class="btn btn-secondary" data-act="xerocheck">Check payments now</button>${top + fail ? `<button class="btn btn-primary" data-act="xeropushall">Push ${top + fail}</button>` : '<button class="btn btn-secondary" data-act="close">Done</button>'}</div>`
    : `<div class="hd"><div class="t-overline">Xero</div><h2 style="font-size:18px">Not connected</h2></div><div class="bd"><div class="t-small" style="line-height:1.6">Invoices stay in Flow and payments aren’t read back until Xero is connected. Connect it in Settings; nothing here changes until you do.</div></div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Close</button><a class="btn btn-primary" href="${SETTINGS}">Open Xero settings</a></div>`);
}
function act(name, el, ev) {
  const id = el.dataset.id, r = id ? (rowById(id) || null) : null;
  switch (name) {
    case 'close': closeLayer(); break;
    case 'noop': closeLayer(); toast('Not wired in this prototype'); break;
    case 'tab': state.tab = el.dataset.t; state.selected.clear(); state.sort = null; state.page = 0; state.savedView = null; $('#q').value = state.q = ''; render(); break;
    case 'seg': state.seg[state.tab] = el.dataset.k; state.page = 0; state.savedView = null; state.selected.clear(); render(); break;
    case 'mw': { state.tab = el.dataset.t; state.f[state.tab] = BLANKF()[state.tab]; if (el.dataset.x) state.f[state.tab].issued = el.dataset.x; state.seg[state.tab] = el.dataset.s; state.q = ''; $('#q').value = ''; state.sort = null; state.page = 0; state.savedView = null; state.selected.clear(); render(); break; }
    case 'sort': if (state.sort === el.dataset.k) state.dir = state.dir === 'asc' ? 'desc' : 'asc'; else { state.sort = el.dataset.k; state.dir = 'asc'; } render(); break;
    case 'page': state.page = Math.max(0, state.page + +el.dataset.d); render(); break;
    case 'more': state.page++; render(); break;
    case 'fmenu': { const k = el.dataset.k; if (k === 'client') multiMenu(el, 'client', 'Client', CL); if (k === 'kind') multiMenu(el, 'kind', 'Kind', ['FULL','DEPOSIT','BALANCE'], x => IK[x]); if (k === 'xero') multiMenu(el, 'xero', 'Xero', ['SYNCED','NOT','ERROR'], x => XL[x]); break; }
    case 'ftoggle': { const a = state.f[state.tab][el.dataset.k], v = el.dataset.v, i = a.indexOf(v); i >= 0 ? a.splice(i, 1) : a.push(v); state.page = 0; state.savedView = null; render(); act('fmenu', el); break; }
    case 'fclear': state.f[state.tab][el.dataset.k] = []; closeLayer(); render(); break;
    case 'smenu': { const k = el.dataset.k; openMenu(el, { sent:'Sent', valid:'Validity', issued:'Issued' }[k], SOPT[k].map(([v, l]) => ({ label:l, act:'sset', args:`data-k="${k}" data-v="${v}"`, on:state.f[state.tab][k] === v }))); break; }
    case 'sset': state.f[state.tab][el.dataset.k] = el.dataset.v; state.page = 0; state.savedView = null; closeLayer(); render(); break;
    case 'clearf': state.f[state.tab] = BLANKF()[state.tab]; state.q = ''; $('#q').value = ''; state.savedView = null; state.page = 0; closeLayer(); render(); break;
    case 'viewsmenu': openMenu(el, 'Views', [{ sh:'Saved views · each one is a URL you can share' }, ...VIEWS[state.tab].map((v, i) => ({ label:v.name, act:'applyview', args:`data-i="${i}"`, on:state.savedView === v.name })), '-', { label:'Save current view…', act:'saveview' }, ...(state.savedView ? [{ label:'Clear view', act:'clearf' }] : [])]); break;
    case 'applyview': { const v = VIEWS[state.tab][+el.dataset.i]; state.f[state.tab] = { ...BLANKF()[state.tab], ...v.f }; state.seg[state.tab] = v.seg; state.savedView = v.name; state.page = 0; closeLayer(); render(); toast(`View “${v.name}” · the filters are in the URL, so the link is the view`); break; }
    case 'saveview': closeLayer(); openDialog(`<div class="hd"><div class="t-overline">Views</div><h2 style="font-size:18px">Save current view</h2></div><div class="bd">${field('Name', '<input id="v-name" placeholder="e.g. Chase this week">')}</div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="saveviewgo">Save</button></div>`, d => $('#v-name', d).focus()); break;
    case 'saveviewgo': { const n = $('#v-name', body).value.trim() || 'Untitled view'; VIEWS[state.tab].push({ name:n, seg:state.seg[state.tab], f:JSON.parse(JSON.stringify(state.f[state.tab])) }); state.savedView = n; closeLayer(); render(); toast(`Saved “${n}”`); break; }
    case 'pagemenu': openMenu(el, 'Finance', [{ label:`Export ${NOUN[state.tab]} (CSV)`, act:'exportpage' }, { label:'Columns', act:'colsmenu' }, { label:state.tab === 'q' ? 'Show superseded and declined' : 'Show voided invoices', act:'showdead', on:state.showDead }, '-', { sh:'Xero' }, { label:'Xero sync…', act:'xerodlg', small:state.xero ? 'Connected' : 'Not connected' }, ...(state.xero ? [{ label:'Check payments now', act:'xerocheck' }] : []), { label:'Xero settings', href:SETTINGS }, '-', { label:'Preview: Xero not connected', act:'xeroconn', on:!state.xero, small:'prototype' }]); break;
    case 'colsmenu': openMenu(el, 'Columns', [{ label:'Contact', act:'coltoggle', args:'data-c="contact"', on:state.cols.contact }, { label:'PM', act:'coltoggle', args:'data-c="pm"', on:state.cols.pm }, { sh:'Number, job, status, date and total are always shown' }]); break;
    case 'coltoggle': state.cols[el.dataset.c] = !state.cols[el.dataset.c]; closeLayer(); render(); break;
    case 'showdead': state.showDead = !state.showDead; closeLayer(); render(); break;
    case 'xerodlg': xeroDialog(); break;
    case 'xeroconn': state.xero = !state.xero; state.f.i.xero = []; closeLayer(); render(); toast(state.xero ? 'Preview: Xero connected' : 'Preview: Xero not connected — the Xero column, filter and Sync verb are gone'); break;
    case 'xerocheck': closeLayer(); toast('Xero checked · no new payments'); break;
    case 'xeropushall': { const undo = snapshot(); let n = 0; I.forEach(i => { if (i.status === 'ISSUED' && i.kind !== 'CREDIT' && i.xero !== 'SYNCED') { i.xero = 'SYNCED'; n++; } }); closeLayer(); render(); toast(`${n} invoices pushed to Xero as drafts`, undo); break; }
    case 'exportpage': closeLayer(); toast(`Exporting ${rows().length} ${NOUN[state.tab]} as CSV · the current view`); break;
    case 'new': openMenu(el, 'New', [{ label:'Invoice for a job…', act:'newpick', args:'data-t="i"' }, { label:'Quote for a job…', act:'newpick', args:'data-t="q"' }]); break;
    case 'newpick': jobPicker(el.dataset.t); break;
    case 'newgo': { const j = job(el.dataset.id), t = state.pick; closeLayer(); toast(`${j.num} ${esc(j.name)} · ${t === 'i' ? 'opens its Finance tab with Invoice ▾' : 'opens its Finance tab to send a quote'}${j.num === '#2341' ? ` · <a href="${FIN}" style="color:var(--blue);font-weight:600">Open</a>` : ''}`); break; }
    case 'open': if (ev && ev.target.closest('.cb,.dots,a')) break; if (r) { if (r.job.num === '#2341') window.location.href = FIN; else toast(`Opens ${r.job.num} Finance tab · this prototype only has #2341`); } break;
    case 'select': { if (ev && ev.shiftKey && state.lastSel) { const order = rows().map(x => x.id), a = order.indexOf(state.lastSel), b = order.indexOf(id); if (a >= 0 && b >= 0) for (const k of order.slice(Math.min(a, b), Math.max(a, b) + 1)) state.selected.add(k); } else state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id); state.lastSel = id; render(); break; }
    case 'selall': { const pr = rows().slice(state.page * state.size, (state.page + 1) * state.size), all = pr.every(x => state.selected.has(x.id)); pr.forEach(x => all ? state.selected.delete(x.id) : state.selected.add(x.id)); render(); break; }
    case 'clearsel': state.selected.clear(); render(); break;
    case 'rowmenu': {
      const it = [], stored = r.k === 'q' ? r.src.sentAt : r.src && r.src.no;
      it.push({ label:'Open on the job', href:r.job.num === '#2341' ? FIN : undefined, act:r.job.num === '#2341' ? undefined : 'open', args:`data-id="${r.id}"`, small:'Finance tab' });
      if (r.ghost) { it.push({ label:'Raise a deposit invoice…', act:'newgo', args:`data-id="${r.job.num}"` }); state.pick = 'i'; }
      else {
        if (stored && r.src.pdf !== false) it.push({ label:'Open PDF', act:'doc', args:`data-id="${r.id}"`, small:'stored copy' });
        else if (stored) it.push({ label:'Generate PDF', act:'genpdf', args:`data-id="${r.id}"`, small:'safe to retry' });
        else it.push({ label:'Preview draft', act:'doc', args:`data-id="${r.id}"`, small:'watermarked' });
        const mid = [];
        if (r.k === 'q') { if (['SENT','EXPIRED'].includes(r.st)) mid.push({ label:'Mark accepted…', act:'accept', args:`data-id="${r.id}"` }); if (ackable(r.src)) mid.push({ label:'Acknowledge expired', act:'ack', args:`data-id="${r.id}"` }); }
        else { if (['ISSUED','OVERDUE','PART'].includes(r.st)) mid.push({ label:'Record payment…', act:'pay', args:`data-id="${r.id}"` }); if (r.st === 'DRAFT') mid.push({ label:'Issue on the job…', act:'open', args:`data-id="${r.id}"` }); }
        if (chaseable(r)) mid.push({ label:'Chase · copy a follow-up', act:'chase', args:`data-id="${r.id}"` });
        if (xeroable(r)) mid.push({ label:r.src.xero === 'ERROR' ? 'Retry Xero push' : 'Push to Xero', act:'xeropush', args:`data-id="${r.id}"` });
        if (mid.length) it.push('-', ...mid);
        if (isDraft(r)) it.push('-', { label:'Delete draft…', act:'del', args:`data-id="${r.id}"`, danger:true });
        else if (r.k === 'i' && r.src.status === 'ISSUED' && r.src.kind !== 'CREDIT') it.push('-', { label:'Void…', act:'void', args:`data-id="${r.id}"`, danger:true });
        else if (r.k === 'q') it.push('-', { sh:'Decline, recall and new versions live on the job’s Finance tab' });
      }
      openMenu(el, r.k === 'q' ? `${r.job.num} v${r.src.v}` : r.ghost ? `${r.job.num} deposit` : (r.src.no || 'Draft invoice'), it); break; }
    case 'doc': closeLayer(); toast(r.src.sentAt || r.src.no ? `Opens the stored PDF · exactly the bytes ${r.k === 'q' ? 'sent ' + fmtD(r.src.sentAt) : 'issued ' + fmtD(r.src.issued)}` : 'Opens a draft preview · DRAFT PREVIEW — NOT SENT on every page'); break;
    case 'genpdf': { const undo = snapshot(); r.src.pdf = true; closeLayer(); render(); toast('PDF generated and attached · an existing document is never replaced', undo); break; }
    case 'accept': closeLayer(); openDialog(`<div class="hd"><div class="t-overline">Mark accepted</div><h2 style="font-size:18px">${esc(r.job.num)} v${r.src.v} · ${esc(r.job.name)}</h2><div class="t-small muted" style="margin-top:4px">${r.st === 'EXPIRED' ? 'Expiry is advisory — an expired quote can still be accepted as it stands. ' : ''}Accepting unblocks confirming the job; its status moves on if the automation is on.</div></div><div class="bd"><div class="g2">${field('Accepted on', `<input id="ac-date" type="date" value="${TODAY}">`)}${field('Reference', '<input id="ac-ref" placeholder="PO number, email subject">')}</div></div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="acceptgo" data-id="${r.id}">Mark accepted</button></div>`); break;
    case 'acceptgo': { const undo = snapshot(); r.src.status = 'ACCEPTED'; r.src.acceptedAt = $('#ac-date', body).value || TODAY; r.src.ref = $('#ac-ref', body).value.trim(); closeLayer(); render(); toast(`${esc(r.job.num)} v${r.src.v} accepted · ${esc(r.job.name)} can be confirmed`, undo); break; }
    case 'ack': { const undo = snapshot(); r.src.acked = true; closeLayer(); render(); toast(`${esc(r.job.num)} v${r.src.v} acknowledged · stays under All`, undo); break; }
    case 'bulkack': { const undo = snapshot(), s = selRows().filter(x => x.k === 'q' && ackable(x.src)); s.forEach(x => { x.src.acked = true; }); state.selected.clear(); closeLayer(); render(); toast(`${s.length} expired quotes acknowledged`, undo); break; }
    case 'chase': chaseDialog([r]); break;
    case 'bulkchase': { const s = selRows(), c = s.filter(chaseable); chaseDialog(c); break; }
    case 'chasego': { const txt = $('#chasetxt', body).value, n = state.chase.length; try { navigator.clipboard.writeText(txt).catch(() => {}); } catch (e) { /* clipboard may be blocked */ } closeLayer(); toast(`${n === 1 ? 'Follow-up' : n + ' follow-ups'} copied · paste into your mail`); break; }
    case 'pay': payDialog(r); break;
    case 'paygo': { const i = r.src, amt = +$('#py-amt', body).value, b = bal(i); if (!(amt > 0) || amt > b) { toast(`Enter an amount up to ${money(b)}`); break; } const undo = snapshot(); i.paid += amt; i.payments.push({ amount:amt, date:$('#py-date', body).value || TODAY, method:$('#py-method', body).value, ref:$('#py-ref', body).value }); closeLayer(); render(); toast(`${money(amt)} recorded against ${esc(i.no)} · ${i.paid >= i.total ? 'paid in full' : money(i.total - i.paid) + ' to go'}`, undo); break; }
    case 'void': { const i = r.src; confirmDlg('Void', `Void ${esc(i.no)}?`, `The number stays used and the document stays on file — the client may be holding that copy. ${i.xero === 'SYNCED' ? 'The invoice is voided in Xero as well. ' : ''}The job’s money picture recounts: ${money(i.total)} comes off “invoiced”, and its payment steps are recomputed. Raise the corrected invoice afterwards.${i.paid ? `<br><br><span style="color:var(--warn)">${money(i.paid)} is recorded against it. Void that payment first, or raise a credit note instead.</span>` : `<div style="margin-top:12px">${field('Why', '<input id="vd-why" placeholder="e.g. wrong PO number">')}</div>`}`, 'voidgo', 'Void invoice', `data-id="${r.id}" ${i.paid ? 'disabled style="opacity:.5;color:var(--t-out)"' : ''}`); break; }
    case 'voidgo': { const undo = snapshot(); r.src.status = 'VOID'; r.src.voidReason = ($('#vd-why', body) || {}).value || 'Voided'; state.selected.delete(r.id); closeLayer(); render(); toast(`${esc(r.src.no)} voided · the document stays on file`, undo); break; }
    case 'del': confirmDlg('Delete draft', `Delete this ${r.k === 'q' ? 'draft quote' : 'draft invoice'}?`, `Nothing was sent${r.k === 'i' ? ' and no number was used' : ''}, so there is nothing downstream to undo. The job keeps its pricing.`, 'delgo', 'Delete draft', `data-id="${r.id}"`, 'Keep it'); break;
    case 'delgo': { const undo = snapshot(); (r.k === 'q' ? (Q = Q.filter(x => x.id !== r.id)) : (I = I.filter(x => x.id !== r.id))); state.selected.delete(r.id); closeLayer(); render(); toast('Draft deleted', undo); break; }
    case 'bulkdel': { const n = selRows().filter(isDraft).length; confirmDlg('Delete', `Delete ${n} draft${n > 1 ? 's' : ''}?`, `Only drafts are deleted — nothing in the selection that was sent or issued is touched. No numbers were used and no client holds a copy.`, 'bulkdelgo', `Delete ${n} draft${n > 1 ? 's' : ''}`, '', 'Keep them'); break; }
    case 'bulkdelgo': { const undo = snapshot(), ids = new Set(selRows().filter(isDraft).map(x => x.id)); Q = Q.filter(x => !ids.has(x.id)); I = I.filter(x => !ids.has(x.id)); state.selected.clear(); closeLayer(); render(); toast(`${ids.size} draft${ids.size > 1 ? 's' : ''} deleted`, undo); break; }
    case 'xeropush': { const undo = snapshot(); const was = r.src.xero; r.src.xero = 'SYNCED'; r.src.xeroError = ''; closeLayer(); render(); toast(`${esc(r.src.no)} pushed to Xero as a draft${was === 'ERROR' ? ' · retry worked' : ''}`, undo); break; }
    case 'bulkxero': { const undo = snapshot(), s = selRows().filter(xeroable); s.forEach(x => { x.src.xero = 'SYNCED'; x.src.xeroError = ''; }); const skip = state.selected.size - s.length; state.selected.clear(); closeLayer(); render(); toast(`${pl(s.length, 'invoice')} pushed to Xero${skip ? ` · ${skip} skipped (drafts, void or already synced)` : ''}`, undo); break; }
    case 'bulkexport': { const n = state.selected.size; closeLayer(); toast(`Exporting ${n} ${NOUN[state.tab]} as CSV`); break; }
    case 'undo': if (state.undo) { state.undo(); state.undo = null; } $('#toast').classList.remove('open'); break;
    case 'toastclose': $('#toast').classList.remove('open'); break;
  }
}
document.addEventListener('input', ev => {
  if (ev.target.id === 'q') { state.q = ev.target.value; state.page = 0; state.savedView = null; render(); }
  if (ev.target.id === 'np-q') $('#np-list').innerHTML = jobPicker.render(ev.target.value.trim().toLowerCase());
});
document.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.id === 'np-q') { const f = $('#np-list .pick'); if (f) act('newgo', f); } });
fromUrl();
render();
