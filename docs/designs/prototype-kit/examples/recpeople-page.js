// ---------- People records · data  (record pages, pattern 4.2): Client · Crew member · Supplier · Supplier order
const TODAY = '2026-11-09';
const A = id => 'https://claude.ai/artifact/' + id;
const U = { OV:A('RatKsWfTmDJLJHmn6mb7Zo'), EQ:A('BdwR4bNbiNMLSvfRAByEwC'), LOG:A('E36tnBkGL9obdikUQ5mbXf'), FIN:A('7ByfxnbtsgQTJdiwvvo1CY'), JOBS:A('A7SMPtpTr3aedUDEnuSaxd'), ASSETS:A('89PDTuMiovgP9i3h4MJ1Tw'), ASSET:A('Rr5rwirCUMRy8gf5G6Vz7s'), HOME:A('RPnGj7WnaWcknvQ8ShcRkf'), FLOOR:A('6xqFcEZZk49w86p5pAsisA'), PEOPLE:A('LPdsNGb4CRMfS6qk7j7Fsa'), PLANNER:A('AKkgWzJ2gVR3dJTWnMB2Ui'), SCAN:A('8Q2HVoRhLbSLz1Q9mCtayX'), FINHUB:A('5VnYTVW2pdA5r1qBRvdrom'), SETTINGS:A('Q3TeWuQPjzvXbAtmUV8Hg8'), WIZARD:A('GgtKxc5WZP33gXihgFTB9B'), SCHEDULE:'https://claude.ai/artifact/49jbSumcZhVdCU9ZA3nqdm' };
const rnd = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(7);
const addD = (d, n) => new Date((dayNum(d) + n) * 864e5).toISOString().slice(0,10);
const dow = d => WD[(dayNum(d) + 3) % 7]; // fixture world: 11 Nov 2026 is a Tuesday
const fmtDay = d => d === TODAY ? fmtD(d) : `${dow(d)} ${fmtD(d)}`;
const fmtDY = d => d ? `${fmtD(d)} ${d.slice(0,4)}` : '—';
const dAgo = d => dayNum(TODAY) - dayNum(d);
const plural = (n, s, p) => `${n} ${n === 1 ? s : (p || s + 's')}`;
const dw = (cls, t) => `<span class="dotw ${cls}">${t}</span>`;
const kv = (k, v) => `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`;
const mono = t => `<span class="mono">${t}</span>`;
const fmtSize = b => b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' KB';
const range = (a, b) => !b || a === b ? fmtD(a) : fmtRange(a, b);
const when = d => { const n = dAgo(d.slice(0,10)); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n + 'd ago'; };
const CLIENT_TYPES = [['COMPANY','Company'],['INDIVIDUAL','Person'],['VENUE','Venue'],['PRODUCTION_COMPANY','Production company']];
const CREW_TYPES = [['EMPLOYEE','Employee'],['FREELANCER','Freelancer'],['CONTRACTOR','Contractor'],['VOLUNTEER','Volunteer']];
const CREW_STATUS = { ACTIVE:['Active','ok'], ON_LEAVE:['On leave','warn'], INACTIVE:['Inactive',''], ARCHIVED:['Archived',''] };
const ORDER_TYPES = [['PURCHASE','Purchase'],['SUBHIRE','Sub-hire'],['REPAIR','Repair'],['LABOUR','Labour'],['OTHER','Other']];
const lab = (arr, v) => (arr.find(x => x[0] === v) || [, v])[1];

// ---------- fixture
const mkEv = (at, who, text, kind, extra = {}) => ({ id:'e' + Math.floor(rnd() * 1e9), at, who, text, kind, ...extra });
function build() {
  const client = { id:'k0', type:'VENUE', name:'Hilton Sydney', cname:'Priya Shah', email:'priya.shah@hilton.example', phone:'02 9266 2000', billing:'488 George St, Sydney NSW 2000', shipping:'Loading dock, Kent St, Sydney NSW 2000', abn:'12 345 678 901', terms:'Net 14', disc:'5', exempt:false, profile:'DEPOSIT_BALANCE', dep:'50', notes:'Dock booking needed 24 h ahead. Kent St dock closes 17:00; after that, everything goes through the George St lift.', tags:'vip, hotel', active:true, mergedInto:null,
    xero:{ state:'LINKED', name:'Hilton Sydney Pty Ltd', at:'2026-11-09 07:40' },
    contacts:[{ id:'ct1', n:'Priya Shah', r:'Events manager', e:'priya.shah@hilton.example', p:'0412 555 010', primary:true }, { id:'ct2', n:'Tom Hadley', r:'AV coordinator', e:'tom.hadley@hilton.example', p:'0412 555 044' }, { id:'ct3', n:'Sofia Marin', r:'Accounts payable', e:'ap@hilton.example', p:'02 9266 2014' }],
    jobs:[{ id:'j1', num:'#2341', name:'Hilton Sydney gala dinner', from:'2026-11-12', to:'2026-11-14', status:'Confirmed', cls:'ok', total:23880, open:true },
      { id:'j2', num:'#2359', name:'Hilton NYE party', from:'2026-12-31', to:'2027-01-01', status:'Quoted', cls:'info', total:18400, open:true },
      { id:'j3', num:'#2318', name:'Hilton staff awards', from:'2026-10-17', to:'2026-10-18', status:'Completed', cls:'', total:9720 },
      { id:'j4', num:'#2296', name:'Hilton conference AV', from:'2026-08-21', to:'2026-08-22', status:'Completed', cls:'', total:18640 },
      { id:'j5', num:'#2271', name:'Hilton Christmas party', from:'2025-12-12', to:'2025-12-12', status:'Completed', cls:'', total:12400 },
      { id:'j6', num:'#2244', name:'Hilton gala dinner 2025', from:'2025-11-14', to:'2025-11-16', status:'Completed', cls:'', total:145640 }],
    docs:[{ id:'m1', kind:'Quote', num:'QT-2359', job:'#2359', label:'v1 · NYE party', amt:18400, date:'2026-11-04', status:'Sent', until:'2026-11-20' },
      { id:'m2', kind:'Invoice', num:'INV-0042', job:'#2341', label:'Balance', amt:11940, date:'2026-10-24', due:'2026-11-28', status:'Issued' },
      { id:'m3', kind:'Invoice', num:'INV-0041', job:'#2341', label:'Deposit 25%', amt:6567, date:'2026-11-06', due:'2026-11-20', status:'Paid', paid:'2026-11-08' },
      { id:'m4', kind:'Quote', num:'QT-2341', job:'#2341', label:'v2 · gala dinner', amt:23880, date:'2026-10-22', status:'Accepted' },
      { id:'m5', kind:'Invoice', num:'INV-0033', job:'#2318', label:'Balance', amt:4860, date:'2026-10-08', due:'2026-10-22', status:'Paid', paid:'2026-10-20' },
      { id:'m6', kind:'Invoice', num:'INV-0030', job:'#2318', label:'Deposit', amt:4860, date:'2026-09-12', due:'2026-09-26', status:'Paid', paid:'2026-09-24' },
      { id:'m7', kind:'Quote', num:'QT-2318', job:'#2318', label:'v1 · staff awards', amt:9720, date:'2026-09-08', status:'Accepted' },
      { id:'m8', kind:'Invoice', num:'INV-0021', job:'#2296', label:'Final', amt:18640, date:'2026-08-28', due:'2026-09-11', status:'Paid', paid:'2026-09-09' }],
    files:[{ id:'f1', name:'Hilton MSA 2026.pdf', size:412e3, by:'Mel Torres', at:'2026-02-03' }, { id:'f2', name:'Kent St dock plan.pdf', size:1.4e6, by:'Sam Okafor', at:'2025-11-10' }, { id:'f3', name:'Certificate of currency.pdf', size:238e3, by:'Jayden Cole', at:'2026-07-01' }, { id:'f4', name:'Rate agreement 2026.xlsx', size:61e3, by:'Mel Torres', at:'2026-02-03' }],
    events:[mkEv('2026-11-09 07:40','Xero','synced the contact · 1 contact, 8 documents','change'),
      mkEv('2026-11-08 10:12','Mel Torres','sent INV-0042 to Sofia Marin','money'),
      mkEv('2026-11-04 15:30','Jayden Cole','sent QT-2359 to Priya Shah','money'),
      mkEv('2026-11-08 09:05','Mel Torres','recorded a $6,567 payment on INV-0041','money'),
      mkEv('2026-10-27 16:48','Jayden Cole','Priya says the Kent St dock closes at 17:00, so the truck must be in by 16:30 on the 11th.','note'),
      mkEv('2026-10-24 11:20','Jayden Cole','confirmed #2341 and issued INV-0041 and INV-0042','job'),
      mkEv('2026-10-22 14:02','Priya Shah','accepted QT-2341 v2','money'),
      mkEv('2026-10-18 21:30','Ash Reyes','completed #2318 Hilton staff awards','job'),
      mkEv('2026-10-02 10:15','Jayden Cole','added the contact Sofia Marin','change'),
      mkEv('2026-08-28 09:00','Mel Torres','issued INV-0021 for #2296','money'),
      mkEv('2026-02-03 11:40','Mel Torres','uploaded Hilton MSA 2026.pdf and set payment terms to Net 14','change'),
      mkEv('2025-11-16 22:10','Ash Reyes','completed #2244 Hilton gala dinner 2025','job')] };

  const crew = { id:'c3', first:'Dev', last:'Patel', type:'FREELANCER', status:'ACTIVE', account:'', email:'dev.patel@mail.com', phone:'0431 220 118', day:'420', hour:'', ot:'1.5', dept:'Rigging', role:'Rigger', dob:'1990-02-11', abn:'64 118 902 337', address:'22 Marion St, Marrickville NSW 2204', ecn:'Anita Patel', ecp:'0412 555 771', notes:'High-risk work licence (dogging, rigging basic). Own harness and tools. Prefers early calls; no sets after 22:00 on weeknights.', tags:'trussing, motors, EWP',
    calls:[{ id:'a1', job:'#2341', jobName:'Hilton Sydney gala dinner', label:'Bump in', date:'2026-11-11', time:'08:00', hrs:10, state:'OFFERED', offered:'2026-11-07' },
      { id:'a2', job:'#2350', jobName:'Qantas awards', label:'Awards night', date:'2026-11-13', time:'16:00', hrs:8, state:'CONFIRMED' },
      { id:'a3', job:'#2340', jobName:'Launch night', label:'Launch night', date:'2026-11-14', time:'18:00', hrs:6, state:'DECLINED', note:'Clashes with #2350' },
      { id:'a4', job:'#2338', jobName:'Corporate AGM', label:'Rig and show', date:'2026-11-21', time:'09:00', hrs:8, state:'CONFIRMED' },
      { id:'a5', job:'#2331', jobName:'Westpac leadership summit', label:'Rig and strike', date:'2026-10-30', time:'07:00', hrs:10, state:'DONE' },
      { id:'a6', job:'#2327', jobName:'Atlassian all-hands', label:'Rig', date:'2026-10-22', time:'07:30', hrs:9, state:'DONE' }],
    times:[], avail:[{ id:'v1', type:'UNAVAILABLE', from:'2026-11-24', to:'2026-11-25', reason:'Family trip' }, { id:'v2', type:'PREFERRED', from:'2026-11-17', to:'2026-11-20', reason:'Keen for pre-lights' }, { id:'v3', type:'TENTATIVE', from:'2026-12-05', to:'2026-12-06', reason:'Maybe on another job' }],
    docs:[{ id:'d1', name:'High-risk work licence (RB).pdf', size:310e3, by:'Dev Patel', at:'2024-11-21', exp:'2026-11-21' }, { id:'d2', name:'White card.pdf', size:182e3, by:'Dev Patel', at:'2023-04-02', exp:null }, { id:'d3', name:'Working at heights.pdf', size:240e3, by:'Ash Reyes', at:'2025-03-03', exp:'2027-03-03' }, { id:'d4', name:'Public liability certificate.pdf', size:420e3, by:'Dev Patel', at:'2026-06-30', exp:'2027-06-30' }, { id:'d5', name:'ABN confirmation.pdf', size:96e3, by:'Mel Torres', at:'2025-07-14', exp:null }],
    ical:{ token:'k7f2a9d', tentative:false },
    events:[mkEv('2026-11-07 09:30','Jayden Cole','sent an offer for #2341 Bump in by SMS','call'),
      mkEv('2026-11-06 16:20','Dev Patel','declined #2340 Launch night · clashes with #2350','call'),
      mkEv('2026-11-04 11:05','Mel Torres','approved 3 timesheets · 27 h','time'),
      mkEv('2026-11-03 08:50','Dev Patel','added an availability block 24 – 25 Nov · Family trip','change'),
      mkEv('2026-11-02 14:12','Jayden Cole','Dev can lead the truss crew on #2341 if the second rigger is confirmed.','note'),
      mkEv('2026-10-31 18:40','Dev Patel','submitted timesheets for #2331','time'),
      mkEv('2026-10-12 10:00','Ash Reyes','uploaded Working at heights.pdf','change'),
      mkEv('2026-06-30 13:20','Dev Patel','uploaded Public liability certificate.pdf','change')] };
  const T = (id, date, job, s, e, brk, status, note) => ({ id, date, job, role:'Rigger', start:s, end:e, brk, hrs:(((+e.slice(0,2)) * 60 + +e.slice(3)) - ((+s.slice(0,2)) * 60 + +s.slice(3)) - brk) / 60, status, note });
  crew.times = [T('t1','2026-10-31','#2331','07:30','16:30',30,'PENDING'), T('t2','2026-10-30','#2331','07:00','17:30',30,'PENDING'), T('t3','2026-10-23','#2327','07:30','16:30',30,'APPROVED'), T('t4','2026-10-22','#2327','07:30','17:00',30,'APPROVED'), T('t5','2026-10-15','#2322','08:00','16:00',30,'APPROVED'), T('t6','2026-10-14','#2322','08:00','18:00',45,'DISPUTED','Break was taken on site, 30 not 45'), T('t7','2026-10-08','#2316','06:30','15:00',30,'APPROVED'), T('t8','2026-10-07','#2316','06:30','16:30',30,'APPROVED'), T('t9','2026-09-26','#2309','09:00','17:00',30,'APPROVED'), T('t10','2026-09-25','#2309','07:30','18:00',60,'APPROVED'), T('t11','2026-09-18','#2303','08:00','16:30',30,'APPROVED'), T('t12','2026-09-17','#2303','08:00','17:00',30,'APPROVED')];

  const supplier = { id:'s0', name:'Scene Change', cname:'Rowan Tait', email:'accounts@scenechange.com.au', phone:'02 9319 4400', web:'scenechange.com.au', address:'8 Euston Rd, Alexandria NSW 2015', acct:'TT-2209', terms:'Net 14', lead:'2 working days', notes:'Delivers to the Warehouse A dock before 10:00. Ring Rowan for same-day; Dani runs the yard.', tags:'staging', active:true,
    contacts:[{ id:'sc1', n:'Rowan Tait', r:'Account manager', e:'accounts@scenechange.com.au', p:'02 9319 4400', primary:true }, { id:'sc2', n:'Dani Cruz', r:'Dispatch and yard', e:'yard@scenechange.com.au', p:'0412 555 330' }],
    assets:[{ id:'x1', tag:'LX-02', model:'Flight case 4U', po:'PO-0391', status:'Reserved', cls:'info' }, { id:'x2', tag:'LX-04', model:'Flight case 6U', po:'PO-0391', status:'Available', cls:'ok' }],
    docs:[{ id:'sd1', name:'Hire terms 2026.pdf', size:520e3, by:'Mel Torres', at:'2026-01-20', exp:null }, { id:'sd2', name:'Certificate of currency.pdf', size:244e3, by:'Mel Torres', at:'2026-07-01', exp:'2027-06-30' }, { id:'sd3', name:'Price list Oct 2026.xlsx', size:88e3, by:'Jayden Cole', at:'2026-10-05', exp:null }],
    events:[mkEv('2026-11-05 10:20','Jayden Cole','raised SH-0013 for #2350 Qantas awards','order'),
      mkEv('2026-11-03 09:15','Sam Okafor','received SH-0012 · 14 units into Warehouse A','order'),
      mkEv('2026-10-28 14:00','Jayden Cole','raised SH-0012 for #2341 Hilton Sydney gala dinner','order'),
      mkEv('2026-10-30 08:40','Sam Okafor','returned SH-0011 · 6 units, nothing missing','order'),
      mkEv('2026-07-01 13:20','Mel Torres','uploaded Certificate of currency.pdf','change'),
      mkEv('2026-01-20 10:05','Mel Torres','set payment terms to Net 14','change')] };
  const L = (id, desc, qty, unit) => ({ id, desc, qty, unit });
  const oneLine = (id, desc, total) => [L(id + 'l', desc, 1, Math.round(total / 1.1))];
  const ord = (o) => ({ supplier:'Scene Change', ref:'', notes:'', invoice:null, returned:null, rdue:null, edate:null, received:null, files:[], events:[], ...o });
  const orders = [
    ord({ id:'o12', num:'SH-0012', type:'SUBHIRE', status:'RECEIVED', job:'#2341', jobName:'Hilton Sydney gala dinner', odate:'2026-10-28', received:'2026-11-03', edate:'2026-11-03', rdue:'2026-11-07', ref:'PO-0412', total:5258, notes:'Stage package for the ballroom. Needed on site until the bump out on the 14th, so the supplier return date has to move.',
      lines:[L('l1','Stage deck 2 × 1 m',8,420), L('l2','Stage deck 1 × 1 m',2,260), L('l3','Stair unit 3-step',2,310), L('l4','Handrail 2 m',2,140)],
      files:[{ id:'of1', name:'PO-0412.pdf', kind:'PO', size:96e3, by:'Jayden Cole', at:'2026-10-28' }, { id:'of2', name:'Delivery docket 3 Nov.pdf', kind:'Docket', size:310e3, by:'Sam Okafor', at:'2026-11-03' }],
      events:[mkEv('2026-11-08 00:01','Flow','return was due 7 Nov and is not recorded','status'), mkEv('2026-11-03 09:15','Sam Okafor','received 14 units into Warehouse A · docket signed','status'), mkEv('2026-10-28 14:10','Jayden Cole','sent PO-0412 to Rowan Tait','file'), mkEv('2026-10-28 14:00','Jayden Cole','created the order for #2341','status')] }),
    ord({ id:'o13', num:'SH-0013', type:'SUBHIRE', status:'ORDERED', job:'#2350', jobName:'Qantas awards', odate:'2026-11-05', edate:'2026-11-12', rdue:'2026-11-15', ref:'PO-0415', total:3190, lines:[L('m1','Stage deck 2 × 1 m',4,380), L('m2','Stair unit 3-step',2,310), L('m3','Stage skirt black 3 m',4,190)], files:[{ id:'of3', name:'PO-0415.pdf', kind:'PO', size:94e3, by:'Jayden Cole', at:'2026-11-05' }], events:[mkEv('2026-11-05 10:25','Jayden Cole','sent PO-0415 to Rowan Tait','file'), mkEv('2026-11-05 10:20','Jayden Cole','created the order for #2350','status')] }),
    ord({ id:'o11', num:'SH-0011', type:'SUBHIRE', status:'RECEIVED', job:'#2340', jobName:'Launch night', odate:'2026-10-22', edate:'2026-10-27', received:'2026-10-27', rdue:'2026-10-31', returned:'2026-10-30', total:2640, lines:oneLine('n','Stage package, 6 units',2640), invoice:{ name:'SC-INV-2210.pdf', size:140e3 }, files:[{ id:'of4', name:'SC-INV-2210.pdf', kind:'Invoice', size:140e3, by:'Mel Torres', at:'2026-11-02' }], events:[mkEv('2026-10-30 08:40','Sam Okafor','recorded the return · 6 units','status')] }),
    ord({ id:'o10', num:'SH-0010', type:'SUBHIRE', status:'RECEIVED', job:'#2331', jobName:'Westpac leadership summit', odate:'2026-10-01', edate:'2026-10-06', received:'2026-10-06', rdue:'2026-10-12', returned:'2026-10-11', total:4730, lines:oneLine('p','Stage package, 12 units',4730), invoice:{ name:'SC-INV-2188.pdf', size:132e3 } }),
    ord({ id:'o9', num:'SH-0009', type:'SUBHIRE', status:'RECEIVED', job:'#2316', jobName:'ABC gala night', odate:'2026-09-02', edate:'2026-09-08', received:'2026-09-08', rdue:'2026-09-14', returned:'2026-09-14', total:3872, lines:oneLine('q','Stage package, 9 units',3872), invoice:{ name:'SC-INV-2150.pdf', size:128e3 } }),
    ord({ id:'o8', num:'SH-0008', type:'SUBHIRE', status:'RECEIVED', job:'#2296', jobName:'Hilton conference AV', odate:'2026-08-10', edate:'2026-08-19', received:'2026-08-19', rdue:'2026-08-24', returned:'2026-08-23', total:6160, lines:oneLine('r','Stage package, 16 units',6160), invoice:{ name:'SC-INV-2121.pdf', size:133e3 } }),
    ord({ id:'o7', num:'SH-0007', type:'SUBHIRE', status:'RECEIVED', job:'#2288', jobName:'Telstra roadshow', odate:'2026-06-04', edate:'2026-06-10', received:'2026-06-10', rdue:'2026-06-14', returned:'2026-06-14', total:3300, lines:oneLine('s','Stage package, 8 units',3300), invoice:{ name:'SC-INV-2060.pdf', size:131e3 } }),
    ord({ id:'o98', num:'PO-0398', type:'PURCHASE', status:'RECEIVED', job:'', jobName:'', odate:'2026-04-02', edate:'2026-04-09', received:'2026-04-09', total:4180, lines:oneLine('t','Flight case 6U',4180), invoice:{ name:'SC-INV-1990.pdf', size:129e3 } }),
    ord({ id:'o91', num:'PO-0391', type:'PURCHASE', status:'RECEIVED', job:'', jobName:'', odate:'2026-02-11', edate:'2026-02-18', received:'2026-02-18', total:5090, lines:oneLine('u','Flight cases 4U and 6U',5090), invoice:{ name:'SC-INV-1944.pdf', size:127e3 } })];
  orders.forEach(o => { if (!o.events.length) o.events = [mkEv(o.odate + ' 10:00', 'Jayden Cole', 'created the order', 'status')]; });
  const subhires = [{ id:'h1', job:'#2341', jobName:'Hilton Sydney gala dinner', order:'SH-0012', cost:4780, charge:7200 }, { id:'h2', job:'#2350', jobName:'Qantas awards', order:'SH-0013', cost:2900, charge:4100 }, { id:'h3', job:'#2340', jobName:'Launch night', order:'SH-0011', cost:2400, charge:3600 }, { id:'h4', job:'#2331', jobName:'Westpac leadership summit', order:'SH-0010', cost:4300, charge:6400 }];
  supplier.subhires = subhires;
  return { client, crew, supplier, orders };
}
let D = build();

// ---------- derived (never stored)
const state = { rec:'client', orderId:'o12', tab:'overview', sel:new Set(), last:null, sheet:null, undo:null, w:{}, more:{}, cost:false, hist:'all', q:'' };
const order = () => D.orders.find(o => o.id === state.orderId);
const R = () => state.rec === 'order' ? order() : D[state.rec];
const crewName = () => `${D.crew.first} ${D.crew.last}`;
const docState = m => m.kind === 'Quote' ? (m.status === 'Sent' ? (m.until < TODAY ? ['Expired', ''] : [`Sent · expires in ${dayNum(m.until) - dayNum(TODAY)} days`, 'info']) : ['Accepted', 'ok']) : m.status === 'Paid' ? ['Paid', 'ok'] : m.due < TODAY ? [`${dAgo(m.due)}d overdue`, 'err'] : [`Due ${fmtD(m.due)}`, 'info'];
const overdueDocs = () => D.client.docs.filter(m => m.kind === 'Invoice' && m.status === 'Issued' && m.due < TODAY);
const unpaid = () => D.client.docs.filter(m => m.kind === 'Invoice' && m.status === 'Issued');
const outstanding = () => unpaid().reduce((s, m) => s + m.amt, 0);
const lifetime = () => D.client.jobs.filter(j => j.status === 'Completed').reduce((s, j) => s + j.total, 0);
const quotedOpen = () => D.client.docs.filter(m => m.kind === 'Quote' && m.status === 'Sent' && m.until >= TODAY).reduce((s, m) => s + m.amt, 0);
const callsWeek = () => D.crew.calls.filter(c => c.date >= TODAY && c.date <= '2026-11-15' && c.state !== 'DECLINED');
const unconfirmed = () => D.crew.calls.filter(c => c.state === 'OFFERED' && c.date >= TODAY);
const pendingTimes = () => D.crew.times.filter(t => t.status === 'PENDING');
const expDays = d => d.exp ? dayNum(d.exp) - dayNum(TODAY) : null;
const expiring = () => D.crew.docs.filter(d => d.exp && expDays(d) <= 30).sort((a, b) => a.exp < b.exp ? -1 : 1);
const ordState = o => { if (o.status === 'CANCELLED') return ['Cancelled', '']; if (o.status === 'DRAFT') return ['Draft', '']; if (o.type === 'SUBHIRE') { if (o.returned) return ['Returned', 'ok']; if (o.status === 'RECEIVED' || o.status === 'PARTIAL') return ['On hire', 'live']; return ['Ordered', 'info']; } return o.status === 'RECEIVED' ? ['Received', 'ok'] : o.status === 'PARTIAL' ? ['Partly received', 'warn'] : ['Ordered', 'info']; };
const onHire = o => o.type === 'SUBHIRE' && !o.returned && (o.status === 'RECEIVED' || o.status === 'PARTIAL');
const lateDays = o => onHire(o) && o.rdue && o.rdue < TODAY ? dAgo(o.rdue) : 0;
const units = o => o.lines.reduce((s, l) => s + l.qty, 0);
const ordSub = o => o.lines.reduce((s, l) => s + l.qty * l.unit, 0);
const ordTotal = o => Math.round(ordSub(o) * 1.1);
const openOrders = () => D.orders.filter(o => o.status !== 'CANCELLED' && o.status !== 'DRAFT' && (onHire(o) || o.status === 'ORDERED'));
const spend = () => D.orders.filter(o => o.status !== 'CANCELLED').reduce((s, o) => s + ordTotal(o), 0);
const marginPct = h => Math.round((h.charge - h.cost) / h.charge * 100);
function snapshot() {
  const s = JSON.stringify(D);
  return () => { D = JSON.parse(s); clearSel(); render(); };
}

// ---------- shell overrides (crumb trail, phone back chevron, sibling links, nav)
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
function closeLayer() { layer.classList.remove('open', 'dim'); body.innerHTML = ''; state.sheet = null; }
function closeLayerKeep() { const s = state.sheet; layer.classList.remove('open', 'dim'); body.innerHTML = ''; state.sheet = s; }
function go(href) { const a = document.createElement('a'); a.href = href; document.body.appendChild(a); a.click(); a.remove(); }
const REC_LABEL = { client:'Client', crew:'Crew member', supplier:'Supplier', order:'Supplier order' };
const NAV_ON = { client:'Clients', crew:'Crew', supplier:'Suppliers', order:'Suppliers' };
function shellInit() {
  const nav = [['Dashboard','blue',U.HOME],['Jobs','blue',U.JOBS],['Finance','green',U.FINHUB],['Schedule','green',U.SCHEDULE],['Crew','purple','@crew'],['Clients','purple','@client'],['Suppliers','purple','@supplier'],['Assets','amber',U.ASSETS],['Warehouse','teal',U.FLOOR],['Test & tag','teal','#tt'],['Maintenance','amber','#maintenance']];
  $('#sidenav').innerHTML = nav.map(([n, c, h]) => h[0] === '@' ? `<a href="#${h.slice(1)}" data-act="rec" data-k="${h.slice(1)}" data-nav="${n}"><span class="patch" style="background:var(--${c}-soft, var(--paper-2))"></span>${n}</a>` : `<a href="${h}" data-nav="${n}"><span class="patch" style="background:var(--${c}-soft, var(--paper-2))"></span>${n}</a>`).join('');
  $('.sidebar .foot a').href = U.SETTINGS;
  const bn = $$('.bottomnav a'); if (bn.length === 5) { bn[0].href = U.HOME; bn[1].href = U.JOBS; bn[2].href = U.SCAN; bn[3].href = U.FLOOR; bn[4].href = U.ASSETS; }
  const ph = $('.phonehead'); if (!$('.phonehead .back')) { ph.insertAdjacentHTML('afterbegin', `<a class="btn btn-icon btn-lg back" href="${U.PEOPLE}" aria-label="Back to the People list" style="color:var(--ink)">‹</a>`); ph.children[1].style.paddingLeft = '0'; }
}
function syncShell() {
  $$('#sidenav a').forEach(a => a.classList.toggle('on', a.dataset.nav === NAV_ON[state.rec]));
  $$('.bottomnav a').forEach((a, i) => a.classList.toggle('on', i === 1 && state.rec === 'client'));
  const peopleCrumb = { client:['Clients'], crew:['Crew'], supplier:['Suppliers'], order:['Suppliers'] }[state.rec][0], sep = '<span>›</span>', lk = (t, h, extra = '') => `<a href="${h}" ${extra} style="color:var(--muted)">${t}</a>`;
  const name = state.rec === 'order' ? order().num : state.rec === 'crew' ? crewName() : D[state.rec].name;
  $('.crumb').innerHTML = lk(peopleCrumb, U.PEOPLE) + sep + (state.rec === 'order' ? lk(esc(D.supplier.name), '#supplier', 'data-act="rec" data-k="supplier"') + sep : '') + `<b>${esc(name)}</b>`;
  $('.phonehead .ell').textContent = name;
}
const TABDEF = {
  client:[['overview','Overview'],['jobs','Jobs'],['money','Quotes & invoices'],['contacts','Contacts'],['files','Files'],['history','History']],
  crew:[['overview','Overview'],['calls','Calls'],['timesheets','Timesheets'],['availability','Availability'],['documents','Documents'],['history','History']],
  supplier:[['overview','Overview'],['orders','Orders'],['subhires','Sub-hires'],['assets','Assets'],['contacts','Contacts'],['documents','Documents'],['history','History']],
  order:[['overview','Overview'],['lines','Lines'],['files','Files'],['history','History']]
};
const TABARR = { client:{ jobs:() => D.client.jobs, money:() => D.client.docs, contacts:() => D.client.contacts, files:() => D.client.files }, crew:{ calls:() => D.crew.calls, timesheets:() => D.crew.times, availability:() => D.crew.avail, documents:() => D.crew.docs }, supplier:{ orders:() => D.orders, subhires:() => D.supplier.subhires, assets:() => D.supplier.assets, contacts:() => D.supplier.contacts, documents:() => D.supplier.docs }, order:{ lines:() => order().lines, files:() => order().files } };
const tabCount = k => { const f = TABARR[state.rec][k]; if (!f) return ''; const n = f().length; return k === 'timesheets' && pendingTimes().length ? `${pendingTimes().length}/${n}` : n; };
const validTab = (r, t) => TABDEF[r].some(x => x[0] === t);

// ---------- render
function render() {
  syncShell(); renderSwitch(); renderHead(); renderTabs(); renderBanner();
  $('#rbody').classList.toggle('hasrail', state.tab !== 'overview');
  const o = { client:ovClient, crew:ovCrew, supplier:ovSupplier, order:ovOrder }[state.rec];
  $('#pane').innerHTML = state.tab === 'overview' ? o() : renderList();
  $('#rail').innerHTML = state.tab === 'overview' ? '' : railHtml();
  renderBulk(); writeUrl();
}
function renderSwitch() {
  $('#swstrip').innerHTML = `<span class="lbl">Record</span>` + ['client','crew','supplier','order'].map(k => `<button class="wd ${state.rec === k ? 'on' : ''}" data-act="rec" data-k="${k}">${REC_LABEL[k]}</button>`).join('');
}
function headInfo() {
  const r = state.rec;
  if (r === 'client') { const c = D.client, p = c.contacts.find(x => x.primary); return { title:c.name, status:c.active ? dw('ok', 'Active') : dw('', c.mergedInto ? 'Merged' : 'Archived'), meta:[lab(CLIENT_TYPES, c.type), p && esc(p.n), p && `<a href="mailto:${esc(p.e)}" style="color:var(--muted)">${esc(p.e)}</a>`, p && esc(p.p)], sub:`${lab(CLIENT_TYPES, c.type)} · ${p ? p.n : 'no contact'} · ${plural(c.jobs.length, 'job')}`, primary:'Edit' }; }
  if (r === 'crew') { const c = D.crew, [sl, sc] = CREW_STATUS[c.status]; return { title:crewName(), status:dw(sc, sl), meta:[esc(c.role), esc(c.dept), lab(CREW_TYPES, c.type), `<a href="mailto:${esc(c.email)}" style="color:var(--muted)">${esc(c.email)}</a>`, esc(c.phone)], sub:`${c.role} · ${lab(CREW_TYPES, c.type)}${c.day ? ' · $' + c.day + '/day' : ''}`, primary:'Edit' }; }
  if (r === 'supplier') { const s = D.supplier; return { title:s.name, status:s.active ? dw('ok', 'Active') : dw('', 'Archived'), meta:[esc(s.cname), `<a href="mailto:${esc(s.email)}" style="color:var(--muted)">${esc(s.email)}</a>`, esc(s.phone), esc(s.web)], sub:`${s.cname} · ${plural(openOrders().length, 'open order')}`, primary:'Edit' }; }
  const o = order(), [sl, sc] = ordState(o);
  return { title:`<span class="mono">${esc(o.num)}</span>`, status:dw(sc, sl), meta:[lab(ORDER_TYPES, o.type), `<a href="#supplier" data-act="rec" data-k="supplier" style="color:var(--muted)">${esc(o.supplier)}</a>`, o.job && `<a href="${U.OV}" style="color:var(--muted)"><span class="mono">${esc(o.job)}</span> ${esc(o.jobName)}</a>`, o.type === 'SUBHIRE' && o.received ? range(o.received, o.rdue) : fmtD(o.odate), `<span class="mono">${money(ordTotal(o))}</span>`], sub:`${lab(ORDER_TYPES, o.type)} · ${o.supplier}${o.job ? ' · ' + o.job : ''}`, primary:'Edit' };
}
function renderHead() {
  const h = headInfo();
  $('#titlerow').innerHTML = `<h1 class="h1">${state.rec === 'order' ? h.title : esc(h.title)}</h1>${h.status}${state.rec === 'client' && D.client.tags ? `<span class="muted t-small">${esc(D.client.tags)}</span>` : ''}`;
  $('#metarow').innerHTML = h.meta.filter(Boolean).map((m, i) => (i ? '<span>·</span>' : '') + `<span>${m}</span>`).join('');
  $('#phonesub').textContent = h.sub;
  $('#actions').innerHTML = `<button class="btn btn-primary" data-act="edit">Edit</button><button class="btn btn-icon" data-act="pagemenu" aria-label="Page actions">⋯</button>`;
}
function renderTabs() {
  $('#tabs').innerHTML = TABDEF[state.rec].map(([k, n]) => { const c = tabCount(k); return `<button class="${state.tab === k ? 'on' : ''}" data-act="tab" data-k="${k}">${n}${c !== '' ? ` <span class="n">${c}</span>` : ''}</button>`; }).join('');
}
function renderBanner() {
  let h = '';
  if (state.rec === 'client' && !D.client.active) h = `<div class="quiet" style="margin-bottom:18px"><span>${D.client.mergedInto ? `Merged into ${esc(D.client.mergedInto)}. Its jobs, quotes, invoices, contacts and files moved there.` : 'Archived. Hidden from pickers and new jobs; its jobs, invoices and history stay as they were.'}</span>${D.client.mergedInto ? '' : `<button class="lnk" data-act="restore">Restore client</button>`}</div>`;
  if (state.rec === 'crew' && D.crew.status === 'INACTIVE') h = `<div class="quiet" style="margin-bottom:18px"><span>Inactive. Not offered new calls and left out of the planner's pickers; existing calls and timesheets stay.</span><button class="lnk" data-act="restore">Reactivate</button></div>`;
  if (state.rec === 'supplier' && !D.supplier.active) h = `<div class="quiet" style="margin-bottom:18px"><span>Archived. Hidden from pickers and new orders; orders, spend and documents stay as they were.</span><button class="lnk" data-act="restore">Restore supplier</button></div>`;
  $('#banner').innerHTML = h;
}
function writeUrl() { try { history.replaceState(null, '', '#' + state.rec + (state.rec === 'order' ? '/' + order().num : '') + (state.tab !== 'overview' ? '/' + state.tab : '')); } catch (e) { /* sandboxed preview: the URL stays as is */ } }

// ---------- overview pieces
const todoList = rows => rows.length ? `<ul class="todo">${rows.map(t => `<li>${t.href ? `<a href="${t.href}">` : `<button data-act="${t.act}" ${t.args || ''}>`}<span class="dot ${t.bad ? 'bad' : ''}"></span><span class="grow">${t.text}</span><span class="more">${t.more} ›</span>${t.href ? '</a>' : '</button>'}</li>`).join('')}</ul>` : '';
const evRow = e => `<div class="ln muted"><b style="color:var(--ink-2)">${esc(e.who.split(' ')[0])}</b> ${esc(e.text)} <span class="faint">· ${esc(when(e.at))}</span></div>`;
const recent = (n = 4) => `<section class="sec2"><div class="ovl">Recent</div>${R().events.slice(0, n).map(evRow).join('')}<div class="links"><button class="lnk" data-act="tab" data-k="history">History ›</button></div></section>`;
const notesSec = (can) => `<section class="sec2"><div class="ovl">Notes</div>${R().notes ? `<p class="ln" style="margin:0;max-width:760px;color:var(--ink-2)">${esc(R().notes)}</p>` : `<p class="ln muted" style="margin:0">No notes yet.</p>`}<div class="links"><button class="lnk" data-act="editnotes">${R().notes ? 'Edit notes' : 'Add a note'}</button></div></section>`;
const jobRow = (j, alt) => `<a class="rrow" href="${U.OV}"><span class="id">${esc(j.num)}</span><span class="grow"><span class="ttl ell" style="display:block">${esc(j.name)}</span><span class="meta"><span>${range(j.from, j.to)}</span></span></span><span class="rt">${dw(j.cls, j.status)}${alt === 'amt' ? `<span class="amt">${money(j.total)}</span>` : ''}</span></a>`;
const tagLine = t => t ? t.split(',').map(x => x.trim()).filter(Boolean).join(' · ') : '';

function ovClient() {
  const c = D.client, od = overdueDocs(), sent = c.docs.filter(m => m.kind === 'Quote' && m.status === 'Sent' && m.until >= TODAY && dayNum(m.until) - dayNum(TODAY) <= 14);
  const todo = [...od.map(m => ({ text:`${mono(m.num)} ${mono(money(m.amt))} <span class="muted">· ${dAgo(m.due)}d overdue · ${m.job}</span>`, more:'Chase', act:'tabw', args:`data-k="money" data-w="overdue"`, bad:true })),
    ...unpaid().filter(m => m.due >= TODAY).map(m => ({ text:`${mono(money(m.amt))} due ${fmtD(m.due)} <span class="muted">· ${mono(m.num)} · ${m.job}</span>`, more:'Invoices', act:'tabw', args:'data-k="money" data-w="invoice"' })),    ...sent.map(m => ({ text:`${mono(m.num)} ${mono(money(m.amt))} not accepted <span class="muted">· expires in ${dayNum(m.until) - dayNum(TODAY)} days</span>`, more:'Quotes', act:'tabw', args:`data-k="money" data-w="quote"` })),
    ...(c.xero.state !== 'LINKED' ? [{ text:'Not mapped to a Xero contact <span class="muted">· invoices cannot sync</span>', more:'Map', act:'xeromap' }] : []),
    ...(!c.contacts.some(x => x.primary) ? [{ text:'No primary contact <span class="muted">· quotes have no one to go to</span>', more:'Contacts', act:'tab', args:'data-k="contacts"' }] : [])];
  const open = c.jobs.filter(j => j.open), openN = open.length;
  return `
  <section class="hero1"><div class="ovl">Account</div><h2>${outstanding() ? money(outstanding()) + ' outstanding' : 'Nothing outstanding'}</h2>
    <p class="lead">${plural(c.jobs.length, 'job')} · ${openN} open · ${money(lifetime())} lifetime${quotedOpen() ? ` · ${money(quotedOpen())} quoted` : ''}</p>${todoList(todo)}</section>
  <section class="sec2 facts3">
    <div><div class="ovl">Billing</div>${kv('ABN', mono(esc(c.abn || '—')))}${kv('Payment terms', esc(c.terms || 'Org default'))}${kv('Payment profile', c.profile === 'DEPOSIT_BALANCE' ? `Deposit and balance · <span class="mono">${esc(c.dep)}%</span>` : c.profile === 'FULL_UPFRONT' ? 'Full upfront' : 'Org default')}${kv('Default discount', c.disc ? `<span class="mono">${esc(c.disc)}%</span>` : '—')}${kv('Tax exempt', c.exempt ? 'Yes' : 'No')}</div>
    <div><div class="ovl">Addresses</div><p class="addr"><span class="k">Billing</span>${esc(c.billing || '—')}</p><p class="addr"><span class="k">Shipping</span>${esc(c.shipping || '—')}</p><div class="links"><button class="lnk" data-act="edit">Edit addresses</button></div></div>
    <div><div class="ovl">Xero</div>${kv('Contact', c.xero.state === 'LINKED' ? dw('ok', 'Mapped') : dw('warn', 'Not mapped'))}${c.xero.state === 'LINKED' ? kv('Xero name', esc(c.xero.name)) + kv('Last synced', `<span class="mono">${esc(when(c.xero.at))} ${esc(c.xero.at.slice(11))}</span>`) : ''}<div class="links"><button class="lnk" data-act="xerosync">Sync now</button><button class="lnk" data-act="xeromap">${c.xero.state === 'LINKED' ? 'Change mapping' : 'Map to Xero'}</button></div></div>
  </section>
  <section class="sec2"><div class="sh2">Open jobs <span class="n">${openN}</span><span class="r"><button class="lnk" data-act="tab" data-k="jobs">All ${c.jobs.length} jobs ›</button></span></div>${open.map(j => jobRow(j, 'amt')).join('') || `<div class="ln muted" style="padding:10px 0">No open jobs. <a class="lnk" href="${U.WIZARD}">New job</a></div>`}</section>
  <section class="sec2 facts3" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr)"><div><div class="ovl">Notes</div>${c.notes ? `<p class="ln" style="margin:0;max-width:640px;color:var(--ink-2)">${esc(c.notes)}</p>` : '<p class="ln muted" style="margin:0">No notes yet.</p>'}<div class="links"><button class="lnk" data-act="editnotes">${c.notes ? 'Edit notes' : 'Add a note'}</button></div></div><div><div class="ovl">Other contacts</div>${c.contacts.filter(p => !p.primary).slice(0, 3).map(p => `<div class="ln">${esc(p.n)} <span class="muted">· ${esc(p.r)}</span></div>`).join('') || '<div class="ln muted">None yet</div>'}<div class="links"><button class="lnk" data-act="tab" data-k="contacts">Contacts ›</button></div></div></section>
  ${recent()}`;
}
function ovCrew() {
  const c = D.crew, wk = callsWeek(), hrs = wk.reduce((s, x) => s + x.hrs, 0), un = unconfirmed(), ex = expiring(), pt = pendingTimes(), pth = pt.reduce((s, t) => s + t.hrs, 0);
  const next = D.crew.calls.filter(x => x.date >= TODAY && x.state !== 'DECLINED').sort((a, b) => a.date < b.date ? -1 : 1)[0];
  const todo = [...un.map(x => ({ text:`${mono(x.job)} ${esc(x.label)} not confirmed <span class="muted">· offered ${when(x.offered)}</span>`, more:'Resend offer', act:'resend', args:`data-id="${x.id}"` })),
    ...ex.map(d => ({ text: expDays(d) < 0 ? `${esc(d.name.replace(/\.[a-z]+$/, ''))} expired <span class="muted">· ${fmtD(d.exp)}</span>` : `${esc(d.name.replace(/\.[a-z]+$/, ''))} expires in ${plural(expDays(d), 'day')} <span class="muted">· ${fmtD(d.exp)}</span>`, more:'Documents', act:'tab', args:'data-k="documents"', bad:expDays(d) < 0 })),
    ...(pt.length ? [{ text:`${plural(pt.length, 'timesheet')} awaiting approval <span class="muted">· ${pth} h</span>`, more:'Review', act:'tabw', args:'data-k="timesheets" data-w="PENDING"' }] : [])];
  const upcoming = c.calls.filter(x => x.date >= TODAY).sort((a, b) => a.date < b.date ? -1 : 1).slice(0, 3);
  const blk = c.avail.filter(v => v.type === 'UNAVAILABLE' && v.to >= TODAY).sort((a, b) => a.from < b.from ? -1 : 1)[0];
  return `
  <section class="hero1"><div class="ovl">This week</div><h2>${wk.length ? `${plural(wk.length, 'call')} · ${hrs} h` : 'No calls this week'}</h2>
    <p class="lead">${next ? `Next: ${esc(next.label)} · <span class="mono">${next.job}</span> · ${fmtDay(next.date)} <span class="mono">${next.time}</span>` : 'Nothing booked'}</p>${todoList(todo)}</section>
  <section class="sec2 facts3">
    <div><div class="ovl">Rates</div>${kv('Day rate', c.day ? `<span class="mono">$${esc(c.day)}</span>` : '—')}${kv('Hourly', c.hour ? `<span class="mono">$${esc(c.hour)}</span>` : '—')}${kv('Overtime', c.ot ? `<span class="mono">×${esc(c.ot)}</span>` : '—')}<div class="links"><button class="lnk" data-act="edit">Edit rates</button></div></div>
    <div><div class="ovl">Role</div>${kv('Role', esc(c.role || '—'))}${kv('Department', esc(c.dept || '—'))}${kv('Type', lab(CREW_TYPES, c.type))}${kv('Skills', esc(tagLine(c.tags) || '—'))}${kv('Platform account', c.account ? esc(c.account) : '<span class="muted">Not linked</span>')}</div>
    <div><div class="ovl">Availability</div>${c.status === 'ON_LEAVE' ? `<div class="ln">${dw('warn', 'On leave')}</div>` : `<div class="ln">${dw('ok', 'Available')} <span class="muted">· no blocks today</span></div>`}${blk ? `<div class="ln muted">Unavailable ${range(blk.from, blk.to)}${blk.reason ? ' · ' + esc(blk.reason) : ''}</div>` : '<div class="ln muted">No leave booked</div>'}<div class="links"><button class="lnk" data-act="tab" data-k="availability">Availability ›</button></div></div>
  </section>
  <section class="sec2"><div class="sh2">Upcoming calls <span class="n">${c.calls.filter(x => x.date >= TODAY).length}</span><span class="r"><button class="lnk" data-act="tab" data-k="calls">All calls ›</button></span></div>${upcoming.map(callRowLink).join('') || '<div class="ln muted" style="padding:10px 0">No upcoming calls.</div>'}</section>
  <section class="sec2 facts3" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr)"><div><div class="ovl">Notes</div>${c.notes ? `<p class="ln" style="margin:0;max-width:640px;color:var(--ink-2)">${esc(c.notes)}</p>` : '<p class="ln muted" style="margin:0">No notes yet.</p>'}<div class="links"><button class="lnk" data-act="editnotes">${c.notes ? 'Edit notes' : 'Add a note'}</button></div></div><div><div class="ovl">Emergency contact</div><div class="ln">${esc(c.ecn || '—')}</div><div class="ln muted">${esc(c.ecp || '')}</div></div></section>
  ${recent()}`;
}
const callWord = c => c.state === 'CONFIRMED' ? dw('ok', 'Confirmed') : c.state === 'OFFERED' ? dw('warn', 'Unconfirmed') : c.state === 'DECLINED' ? dw('', 'Declined') : dw('', 'Worked');
const callRowLink = c => `<a class="rrow" href="${U.LOG}"><span class="id">${c.job}</span><span class="grow"><span class="ttl ell" style="display:block">${esc(c.label)} <span class="muted" style="font-weight:400">· ${esc(c.jobName)}</span></span><span class="meta"><span>${fmtDay(c.date)}</span><span class="mono">${c.time}</span><span>${c.hrs} h</span></span></span><span class="rt">${callWord(c)}</span></a>`;
function ovSupplier() {
  const s = D.supplier, late = D.orders.filter(o => lateDays(o) > 0), nextd = D.orders.filter(o => o.status === 'ORDERED' && o.edate >= TODAY).sort((a, b) => a.edate < b.edate ? -1 : 1);
  const hire = D.orders.filter(onHire).reduce((n, o) => n + units(o), 0), open = openOrders();
  const todo = [...late.map(o => ({ text:`${mono(o.num)} return ${lateDays(o)}d overdue <span class="muted">· ${plural(units(o), 'unit')} for ${o.job}</span>`, more:'Extend or return', act:'openorder', args:`data-id="${o.id}" data-then="extend"`, bad:true })),
    ...nextd.map(o => ({ text:`${mono(o.num)} delivers ${fmtDay(o.edate)} <span class="muted">· ${plural(units(o), 'unit')} for ${o.job}</span>`, more:'Order', act:'openorder', args:`data-id="${o.id}"` })),
    ...(!s.contacts.some(x => x.primary) ? [{ text:'No primary contact', more:'Contacts', act:'tab', args:'data-k="contacts"' }] : [])];
  const ordersN = D.orders.length;
  return `
  <section class="hero1"><div class="ovl">On hire now</div><h2>${hire ? plural(hire, 'unit') + ' on hire' : 'Nothing on hire'} · ${plural(open.length, 'open order')}</h2>
    <p class="lead">Used on ${plural(s.subhires.length, 'job')} this year · ${esc(s.tags || 'no tags')}</p>${todoList(todo)}</section>
  <section class="sec2 facts3">
    <div><div class="ovl">Spend</div><div class="ln"><b class="mono">${money(spend())}</b> <span class="muted">· this year</span></div><div class="ln muted">${plural(ordersN, 'order')} · <span class="mono">${money(spend() / ordersN)}</span> average</div><div class="links"><button class="lnk" data-act="tab" data-k="orders">Orders ›</button></div></div>
    <div><div class="ovl">Account</div>${kv('Account #', mono(esc(s.acct || '—')))}${kv('Payment terms', esc(s.terms || 'Org default'))}${kv('Default lead time', esc(s.lead || '—'))}</div>
    <div><div class="ovl">Address</div><p class="addr">${esc(s.address || '—')}</p><div class="ln muted">${s.web ? esc(s.web) : ''}</div><div class="links"><button class="lnk" data-act="tab" data-k="contacts">${plural(s.contacts.length, 'contact')} ›</button></div></div>
  </section>
  <section class="sec2"><div class="sh2">Open orders <span class="n">${open.length}</span><span class="r"><button class="lnk" data-act="neworder">+ New order</button></span></div>${open.map(o => `<button class="rrow" style="width:100%;text-align:left" data-act="openorder" data-id="${o.id}"><span class="id">${o.num}</span><span class="grow"><span class="ttl ell" style="display:block">${esc(o.jobName || lab(ORDER_TYPES, o.type))}</span><span class="meta"><span>${o.rdue ? range(o.edate || o.odate, o.rdue) : fmtD(o.odate)}</span><span>${plural(units(o), 'unit')}</span></span></span><span class="rt">${dw(ordState(o)[1], ordState(o)[0])}<span class="amt">${money(ordTotal(o))}</span></span></button>`).join('') || '<div class="ln muted" style="padding:10px 0">No open orders.</div>'}</section>
  <section class="sec2 facts3" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr)"><div><div class="ovl">Notes</div>${s.notes ? `<p class="ln" style="margin:0;max-width:640px;color:var(--ink-2)">${esc(s.notes)}</p>` : '<p class="ln muted" style="margin:0">No notes yet.</p>'}<div class="links"><button class="lnk" data-act="editnotes">${s.notes ? 'Edit notes' : 'Add a note'}</button></div></div><div><div class="ovl">Tags</div><div class="ln muted">${esc(tagLine(s.tags) || 'None')}</div></div></section>
  ${recent()}`;
}
function ovOrder() {
  const o = order(), [sl, sc] = ordState(o), late = lateDays(o), oh = onHire(o);
  const todo = [...(late ? [{ text:`Return ${late}d overdue <span class="muted">· was due ${fmtDay(o.rdue)}${o.job ? ', still needed on ' + o.job + ' until ' + fmtDay('2026-11-14') : ''}</span>`, more:'Extend hire', act:'extend', bad:true }] : []),
    ...(o.type !== 'PURCHASE' || o.status === 'RECEIVED' ? (!o.invoice && o.status !== 'DRAFT' && o.status !== 'CANCELLED' && o.status !== 'ORDERED' ? [{ text:'Supplier invoice not attached <span class="muted">· needed before the bill can be paid</span>', more:'Attach', act:'uploadinv' }] : []) : [])];
  const title = o.type === 'SUBHIRE' ? (oh ? `On hire · ${plural(units(o), 'unit')}` : sl === 'Returned' ? `Returned ${fmtD(o.returned)} · ${plural(units(o), 'unit')}` : `${sl} · ${plural(units(o), 'unit')}`) : `${sl} · ${plural(units(o), 'unit')}`;
  const lead = o.type === 'SUBHIRE' ? `${o.received ? 'Picked up ' + fmtD(o.received) : 'Ordered ' + fmtD(o.odate)}${o.returned ? ' · returned ' + fmtD(o.returned) : late ? '' : o.rdue ? ' · return due ' + fmtD(o.rdue) : ''} · ${money(ordTotal(o))} incl GST` : `${fmtD(o.odate)}${o.edate ? ' · expected ' + fmtD(o.edate) : ''}`;
  return `
  <section class="hero1"><div class="ovl">${o.type === 'SUBHIRE' ? 'Hire' : lab(ORDER_TYPES, o.type)}</div><h2>${title}</h2><p class="lead">${lead}</p>${todoList(todo)}</section>
  <section class="sec2 facts3">
    <div><div class="ovl">Dates</div>${kv('Ordered', fmtDY(o.odate))}${kv(o.type === 'SUBHIRE' ? 'Picked up' : 'Received', o.received ? fmtDY(o.received) : o.edate ? `<span class="muted">expected ${fmtDay(o.edate)}</span>` : '—')}${o.type === 'SUBHIRE' ? kv('Return due', o.rdue ? (late ? `<span class="dotw err">${fmtDY(o.rdue)}</span>` : fmtDY(o.rdue)) : '—') + kv('Returned', o.returned ? fmtDY(o.returned) : '—') : ''}</div>
    <div><div class="ovl">Payment</div>${kv('Subtotal', mono(money(ordSub(o))))}${kv('GST', mono(money(ordTotal(o) - ordSub(o))))}${kv('Total', `<b class="mono">${money(ordTotal(o))}</b>`)}${kv('Terms', esc(D.supplier.terms || 'Org default'))}${kv('Supplier invoice', o.invoice ? esc(o.invoice.name) : '<span class="muted">Not attached</span>')}</div>
    <div><div class="ovl">Order</div>${kv('Type', lab(ORDER_TYPES, o.type))}${kv('Purchase order', o.ref ? mono(esc(o.ref)) : '—')}${kv('Supplier', `<button class="lnk" data-act="rec" data-k="supplier">${esc(o.supplier)}</button>`)}${kv('Job', o.job ? `<a class="lnk" href="${U.OV}"><span class="mono">${esc(o.job)}</span> ${esc(o.jobName)}</a>` : '—')}${o.job ? `<div class="links"><a class="lnk" href="${U.EQ}">${esc(o.job)} Equipment ›</a></div>` : ''}</div>
  </section>
  <section class="sec2"><div class="sh2">Lines <span class="n">${o.lines.length}</span><span class="r"><button class="lnk" data-act="tab" data-k="lines">Lines ›</button></span></div><div class="ln muted">${plural(units(o), 'unit')} across ${plural(o.lines.length, 'line')}${o.lines.length ? ' · ' + o.lines.slice(0, 3).map(l => esc(l.desc)).join(', ') + (o.lines.length > 3 ? '…' : '') : ''}</div></section>
  <section class="sec2 facts3" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr)"><div><div class="ovl">Notes</div>${o.notes ? `<p class="ln" style="margin:0;max-width:640px;color:var(--ink-2)">${esc(o.notes)}</p>` : '<p class="ln muted" style="margin:0">No notes yet.</p>'}<div class="links"><button class="lnk" data-act="editnotes">${o.notes ? 'Edit notes' : 'Add a note'}</button></div></div><div><div class="ovl">Files</div><div class="ln">${plural(o.files.length, 'file')}</div><div class="ln muted">${o.files.map(f => esc(f.kind)).join(' · ') || 'None yet'}</div><div class="links"><button class="lnk" data-act="tab" data-k="files">Files ›</button></div></div></section>
  ${recent()}`;
}
// ---------- context rail (every tab except Overview)
function railHtml() {
  const r = state.rec;
  if (r === 'client') { const c = D.client; return `
   <div class="rs"><div class="ovl">Account</div><div class="ln"><b class="mono">${money(outstanding())}</b> <span class="muted">outstanding</span></div><div class="ln muted">${money(lifetime())} lifetime · ${plural(c.jobs.length, 'job')}</div></div>
   <div class="rs"><div class="ovl">Billing</div>${kv('ABN', mono(esc(c.abn || '—')))}${kv('Terms', esc(c.terms || 'Org default'))}${kv('Discount', c.disc ? mono(esc(c.disc) + '%') : '—')}${kv('Xero', c.xero.state === 'LINKED' ? dw('ok', 'Mapped') : dw('warn', 'Not mapped'))}<div class="links"><button class="lnk" data-act="edit">Edit client</button></div></div>
   <div class="rs"><div class="ovl">Billing address</div><p class="addr" style="margin:0">${esc(c.billing || '—')}</p></div>`; }
  if (r === 'crew') { const c = D.crew; return `
   <div class="rs"><div class="ovl">This week</div><div class="ln"><b>${plural(callsWeek().length, 'call')}</b> <span class="muted">· ${callsWeek().reduce((s, x) => s + x.hrs, 0)} h</span></div>${unconfirmed().length ? `<div class="ln">${dw('warn', unconfirmed().length + ' unconfirmed')}</div>` : ''}<div class="links"><button class="lnk" data-act="message">Message ${esc(c.first)}</button></div></div>
   <div class="rs"><div class="ovl">Rates</div>${kv('Day', c.day ? mono('$' + esc(c.day)) : '—')}${kv('Hourly', c.hour ? mono('$' + esc(c.hour)) : '—')}${kv('Overtime', c.ot ? mono('×' + esc(c.ot)) : '—')}<div class="links"><button class="lnk" data-act="edit">Edit crew member</button></div></div>
   <div class="rs"><div class="ovl">Role</div>${kv('Role', esc(c.role || '—'))}${kv('Type', lab(CREW_TYPES, c.type))}<div class="ln muted" style="font-size:12.5px;margin-top:4px">${esc(tagLine(c.tags))}</div></div>`; }
  if (r === 'supplier') { const s = D.supplier; return `
   <div class="rs"><div class="ovl">On hire</div><div class="ln"><b>${plural(D.orders.filter(onHire).reduce((n, o) => n + units(o), 0), 'unit')}</b> <span class="muted">· ${plural(openOrders().length, 'open order')}</span></div>${D.orders.some(o => lateDays(o) > 0) ? `<div class="ln">${dw('err', 'Return ' + Math.max(...D.orders.map(lateDays)) + 'd overdue')}</div>` : ''}</div>
   <div class="rs"><div class="ovl">Account</div>${kv('Account #', mono(esc(s.acct || '—')))}${kv('Terms', esc(s.terms || '—'))}${kv('Lead time', esc(s.lead || '—'))}${kv('Spend', mono(money(spend())))}<div class="links"><button class="lnk" data-act="edit">Edit supplier</button></div></div>
   <div class="rs"><div class="ovl">Address</div><p class="addr" style="margin:0">${esc(s.address || '—')}</p></div>`; }
  const o = order(); return `
   <div class="rs"><div class="ovl">Total</div><div class="ln"><b class="mono">${money(ordTotal(o))}</b> <span class="muted">incl GST</span></div><div class="ln muted">${plural(units(o), 'unit')} · ${plural(o.lines.length, 'line')}</div></div>
   <div class="rs"><div class="ovl">Hire</div>${kv('Ordered', fmtD(o.odate))}${kv('Picked up', o.received ? fmtD(o.received) : '—')}${o.type === 'SUBHIRE' ? kv('Return due', o.rdue ? (lateDays(o) ? `<span class="dotw err">${fmtD(o.rdue)}</span>` : fmtD(o.rdue)) : '—') : ''}${o.returned ? kv('Returned', fmtD(o.returned)) : ''}</div>
   <div class="rs"><div class="ovl">Supplier</div><div class="ln"><button class="lnk" data-act="rec" data-k="supplier">${esc(o.supplier)}</button></div>${kv('Purchase order', o.ref ? mono(esc(o.ref)) : '—')}${kv('Invoice', o.invoice ? 'Attached' : '<span class="muted">Not attached</span>')}</div>
   ${o.job ? `<div class="rs"><div class="ovl">Job</div><div class="ln"><a class="lnk" href="${U.OV}"><span class="mono">${esc(o.job)}</span> ${esc(o.jobName)}</a></div><div class="links"><a class="lnk" href="${U.EQ}">Equipment ›</a></div></div>` : ''}`;
}

// ---------- list tabs (§4.1 shape without the head): words · rows with checkbox + row ⋯ · footer · bulk bar
const ext = n => (n.split('.').pop() || '').toUpperCase().slice(0, 4);
const expWord = d => { const n = expDays(d); return n == null ? '' : n < 0 ? dw('err', `expired ${fmtD(d.exp)}`) : n <= 30 ? dw('warn', `expires in ${plural(n, 'day')}`) : `<span class="muted t-small">to ${fmtDY(d.exp)}</span>`; };
const callOrder = (a, b) => { const ua = a.date >= TODAY, ub = b.date >= TODAY; return ua !== ub ? (ua ? -1 : 1) : ua ? (a.date < b.date ? -1 : 1) : (a.date < b.date ? 1 : -1); };
function filesCfg(arr, o = {}) {
  return { title:o.title || 'Documents', size:12, items:() => arr(), words:[['all', 'All', () => true]],
    row:f => ({ lead:`<span class="thumbf">${esc(ext(f.name))}</span>`, title:`<button class="ttl ell" style="display:block;max-width:100%;text-align:left" data-act="docopen" data-id="${f.id}">${esc(f.name)}</button>`, meta:[fmtSize(f.size), `${esc(f.by.split(' ')[0])} · ${fmtD(f.at)}`], rt:o.exp ? expWord(f) : o.kind ? `<span class="muted t-small">${esc(f.kind)}</span>` : '' }),
    menu:f => [{ label:'Open', act:'docopen', args:`data-id="${f.id}"` }, { label:'Download', act:'download', args:`data-id="${f.id}"` }, ...(o.exp ? [{ label:f.exp ? 'Change expiry…' : 'Set expiry…', act:'expiry', args:`data-id="${f.id}"` }] : []), '-', { label:'Remove…', act:'rowdel', args:`data-id="${f.id}"`, danger:true }],
    bulk:s => `<button class="btn btn-secondary btn-sm" data-act="bulk" data-v="download">Download ${s.length}</button>`, del:'files',
    tools:'<span class="t-micro faint deskonly">or drop files here</span>', add:[{ label:'Upload', act:o.upAct || 'upload' }], empty:`<b>No ${(o.title || 'documents').toLowerCase()} yet</b>${o.emptyText || 'Upload the first one.'} <button class="lnk" data-act="${o.upAct || 'upload'}">Upload</button>`,
    foot:its => `${plural(its.length, 'file')}${o.exp && its.some(d => d.exp) ? ' · ' + its.filter(d => d.exp && expDays(d) <= 30).length + ' expiring within 30 days' : ''}` };
}
function contactsCfg(o) {
  return { title:'Contacts', size:12, items:() => o.contacts, words:[['all', 'All', () => true]],
    row:p => ({ lead:`<span class="thumbf">${esc(p.n.split(' ').map(x => x[0]).join('').slice(0, 2))}</span>`, title:esc(p.n), meta:[esc(p.r), `<a href="mailto:${esc(p.e)}" style="color:var(--muted)">${esc(p.e)}</a>`, esc(p.p)], rt:p.primary ? dw('ok', 'Primary') : '' }),
    menu:p => [{ label:'Edit…', act:'contactedit', args:`data-id="${p.id}"` }, ...(p.primary ? [] : [{ label:'Make primary', act:'contactprimary', args:`data-id="${p.id}"` }]), { label:'Email', href:'mailto:' + p.e }, '-', { label:'Remove…', act:'rowdel', args:`data-id="${p.id}"`, danger:true }],
    bulk:s => '', del:'contacts', delOnly:p => !p.primary, add:[{ label:'+ Add contact', act:'contactadd' }], empty:`<b>No contacts yet</b>Add the people who book, approve and pay. <button class="lnk" data-act="contactadd">Add contact</button>`, foot:its => `${plural(its.length, 'contact')} · one is primary` };
}
const LISTS = {
  'client:jobs':() => ({ title:'Jobs', size:10, items:() => [...D.client.jobs].sort((a, b) => a.from < b.from ? 1 : -1), words:[['all', 'All', () => true], ['open', 'Open', j => j.open], ['done', 'Completed', j => !j.open]],
    row:j => ({ lead:`<span class="id">${esc(j.num)}</span>`, title:esc(j.name), href:U.OV, meta:[range(j.from, j.to)], rt:`${dw(j.cls, j.status)}<span class="amt">${money(j.total)}</span>` }),
    menu:j => [{ label:'Open', href:U.OV, small:'Overview' }, { label:'Equipment', href:U.EQ, small:'Equipment' }, { label:'Finance', href:U.FIN, small:'Finance' }, '-', { label:'Copy job number', act:'copyjob', args:`data-id="${j.id}"` }],
    bulk:s => `<button class="btn btn-secondary btn-sm" data-act="bulk" data-v="copyjobs">Copy ${s.length} numbers</button><button class="btn btn-secondary btn-sm deskonly" data-act="bulk" data-v="exportjobs">Export ${s.length}</button>`,
    add:[{ label:'+ New job', href:U.WIZARD }], empty:`<b>No jobs in this segment</b>Every job sits in another segment.`, foot:its => `Totals · <span class="mono" style="color:var(--ink)">${money(its.reduce((s, j) => s + j.total, 0))}</span> · ${plural(its.length, 'job')}` }),
  'client:money':() => ({ title:'Quotes & invoices', size:10, items:() => [...D.client.docs].sort((a, b) => b.date.localeCompare(a.date)), words:[['all', 'All', () => true], ['quote', 'Quotes', m => m.kind === 'Quote'], ['invoice', 'Invoices', m => m.kind === 'Invoice'], ['overdue', 'Overdue', m => m.kind === 'Invoice' && m.status === 'Issued' && m.due < TODAY]],
    row:m => { const [t, c] = docState(m); return { lead:`<span class="id">${esc(m.num)}</span>`, title:esc(m.label), href:U.FIN, meta:[`<span class="mono">${esc(m.job)}</span>`, `${m.kind === 'Quote' ? 'Sent' : 'Issued'} ${fmtD(m.date)}`], rt:`${dw(c, t)}<span class="amt">${money(m.amt)}</span>` }; },
    menu:m => [{ label:'Open in Finance', href:U.FIN, small:'Finance' }, { label:'Download PDF', act:'download', args:`data-id="${m.id}"` }, '-', ...(m.kind === 'Invoice' && m.status === 'Issued' ? [{ label:'Send reminder', act:'remind', args:`data-id="${m.id}"` }, { label:'Record payment…', act:'markpaid', args:`data-id="${m.id}"` }] : []), ...(m.kind === 'Quote' && m.status === 'Sent' ? [{ label:'Resend quote', act:'resendq', args:`data-id="${m.id}"` }] : [])],
    bulk:s => { const u = s.filter(m => m.kind === 'Invoice' && m.status === 'Issued').length; return `${u ? `<button class="btn btn-secondary btn-sm" data-act="bulk" data-v="remind">Send ${plural(u, 'reminder')}</button>` : ''}<button class="btn btn-secondary btn-sm deskonly" data-act="bulk" data-v="pdfs">Download ${s.length} PDFs</button>`; },
    empty:`<b>Nothing overdue</b>Every issued invoice is inside its terms.`, foot:its => `Outstanding · <span class="mono" style="color:var(--ink)">${money(outstanding())}</span>${overdueDocs().length ? ` · ${overdueDocs().length} overdue` : ''}` }),
  'client:contacts':() => contactsCfg(D.client),
  'client:files':() => filesCfg(() => D.client.files, { title:'Files', emptyText:'MSAs, rate agreements and site plans live here.' }),
  'supplier:contacts':() => contactsCfg(D.supplier),
  'supplier:documents':() => filesCfg(() => D.supplier.docs, { title:'Documents', exp:true, emptyText:'Hire terms, price lists and certificates of currency live here.' }),
  'crew:documents':() => filesCfg(() => D.crew.docs, { title:'Documents', exp:true, emptyText:'Licences, tickets and insurance, with the date each one lapses.' }),
  'order:files':() => filesCfg(() => order().files, { title:'Files', kind:true, upAct:'uploadfile', emptyText:'The purchase order, delivery docket and supplier invoice live here.' }),
  'crew:calls':() => ({ title:'Calls', size:10, items:() => [...D.crew.calls].sort(callOrder), words:[['up', 'Upcoming', c => c.date >= TODAY], ['past', 'Past', c => c.date < TODAY], ['all', 'All', () => true]],
    row:c => ({ lead:`<span class="id">${c.job}</span>`, title:`${esc(c.label)} <span class="muted" style="font-weight:400">· ${esc(c.jobName)}</span>`, href:U.LOG, meta:[fmtDay(c.date), `<span class="mono">${c.time}</span>`, `${c.hrs} h`, c.state === 'OFFERED' ? `offered ${when(c.offered)}` : c.note ? esc(c.note) : ''].filter(Boolean), rt:callWord(c), dim:c.state === 'DECLINED' }),
    menu:c => [{ label:'Open in Logistics', href:U.LOG, small:'Logistics' }, '-', ...(c.state === 'OFFERED' ? [{ label:'Resend offer', act:'resend', args:`data-id="${c.id}"` }, { label:'Mark confirmed', act:'confirmcall', args:`data-id="${c.id}"` }] : c.state === 'DECLINED' ? [{ label:'Send offer again', act:'resend', args:`data-id="${c.id}"` }] : c.state === 'CONFIRMED' ? [{ label:'Mark unconfirmed', act:'unconfirm', args:`data-id="${c.id}"` }] : []), ...(c.date >= TODAY ? ['-', { label:'Remove from job…', act:'rowdel', args:`data-id="${c.id}"`, danger:true }] : [])],
    bulk:s => { const o = s.filter(c => c.state === 'OFFERED' || c.state === 'DECLINED').length, f = s.filter(c => c.state === 'OFFERED').length; return `${o ? `<button class="btn btn-secondary btn-sm" data-act="bulk" data-v="resend">Resend ${plural(o, 'offer')}</button>` : ''}${f ? `<button class="btn btn-secondary btn-sm" data-act="bulk" data-v="confirm">Mark ${f} confirmed</button>` : ''}`; }, del:'calls', delOnly:c => c.date >= TODAY, delLabel:'Remove',
    empty:`<b>No calls here</b>Offers and confirmed calls show up as they are made in the crew planner. <a class="lnk" href="${U.PLANNER}">Crew planner</a>`, foot:its => `${plural(its.length, 'call')} · ${its.reduce((s, c) => s + c.hrs, 0)} h` }),
  'crew:timesheets':() => ({ title:'Timesheets', size:8, items:() => [...D.crew.times].sort((a, b) => b.date.localeCompare(a.date)), words:[['all', 'All', () => true], ['PENDING', 'Pending', t => t.status === 'PENDING'], ['APPROVED', 'Approved', t => t.status === 'APPROVED'], ['DISPUTED', 'Disputed', t => t.status === 'DISPUTED']],
    row:t => ({ lead:`<span class="id">${fmtD(t.date)}</span>`, title:`<span class="mono">${t.job}</span> <span class="muted" style="font-weight:400">· ${esc(t.role)}</span>`, meta:[`<span class="mono">${t.start} – ${t.end}</span>`, `break ${t.brk} min`, t.note && esc(t.note)].filter(Boolean), rt:`${dw(t.status === 'APPROVED' ? 'ok' : t.status === 'DISPUTED' ? 'err' : 'warn', t.status === 'APPROVED' ? 'Approved' : t.status === 'DISPUTED' ? 'Disputed' : 'Pending')}<span class="amt">${t.hrs.toFixed(1)} h</span>` }),
    menu:t => [...(t.status !== 'APPROVED' ? [{ label:'Approve', act:'approve', args:`data-id="${t.id}"` }] : []), ...(t.status !== 'DISPUTED' ? [{ label:'Dispute…', act:'dispute', args:`data-id="${t.id}"` }] : []), { label:'Edit…', act:'timeedit', args:`data-id="${t.id}"` }, '-', { label:'Delete…', act:'rowdel', args:`data-id="${t.id}"`, danger:true }],
    bulk:s => { const n = s.filter(t => t.status !== 'APPROVED').length; return n ? `<button class="btn btn-secondary btn-sm" data-act="bulk" data-v="approve">Approve ${n}</button>` : ''; }, del:'times', delLabel:'Delete',
    tools:'<button class="lnk deskonly" data-act="exportcsv">Export CSV</button>', add:[{ label:'Log time', act:'logtime' }], empty:`<b>No timesheets here</b>Hours logged against a call, or a general shift, appear here. <button class="lnk" data-act="logtime">Log time</button>`,
    foot:its => `Totals · <span class="mono" style="color:var(--ink)">${its.reduce((s, t) => s + t.hrs, 0).toFixed(1)} h</span>${pendingTimes().length ? ` · ${pendingTimes().reduce((s, t) => s + t.hrs, 0).toFixed(1)} h pending` : ''}` }),
  'crew:availability':() => ({ title:'Availability', size:12, items:() => [...D.crew.avail].sort((a, b) => a.from < b.from ? -1 : 1), words:[['all', 'All', () => true]],
    row:v => ({ lead:'', title:range(v.from, v.to), meta:[v.reason ? esc(v.reason) : 'No reason given', dayNum(v.to) - dayNum(v.from) + 1 + (dayNum(v.to) - dayNum(v.from) ? ' days' : ' day')], rt:dw(v.type === 'UNAVAILABLE' ? 'warn' : v.type === 'PREFERRED' ? 'ok' : 'info', v.type === 'UNAVAILABLE' ? 'Unavailable' : v.type === 'PREFERRED' ? 'Preferred' : 'Tentative') }),
    menu:v => [{ label:'Edit…', act:'availedit', args:`data-id="${v.id}"` }, '-', { label:'Remove…', act:'rowdel', args:`data-id="${v.id}"`, danger:true }],
    bulk:s => '', del:'avail', delLabel:'Remove', add:[{ label:'+ Add block', act:'availadd' }], empty:`<b>No blocks</b>Leave, other work and preferred weeks show in the planner. <button class="lnk" data-act="availadd">Add block</button>`, foot:its => `${plural(its.length, 'block')} · unavailable blocks hide ${D.crew.first} from the planner` }),
  'supplier:orders':() => ({ title:'Orders', size:10, items:() => [...D.orders].sort((a, b) => b.odate.localeCompare(a.odate)), words:[['all', 'All', () => true], ['open', 'Open', o => openOrders().includes(o)], ['late', 'Overdue', o => lateDays(o) > 0]],
    row:o => { const [t, c] = ordState(o); return { lead:`<span class="id">${esc(o.num)}</span>`, title:esc(o.jobName || (o.lines[0] ? o.lines[0].desc : lab(ORDER_TYPES, o.type))), open:'order', meta:[lab(ORDER_TYPES, o.type), o.type === 'SUBHIRE' && o.rdue ? range(o.received || o.edate || o.odate, o.rdue) : fmtD(o.odate), plural(units(o), 'unit'), lateDays(o) ? `<span class="dotw err">return ${lateDays(o)}d overdue</span>` : ''].filter(Boolean), rt:`${dw(c, t)}<span class="amt">${money(ordTotal(o))}</span>` }; },
    menu:o => [{ label:'Open', act:'openorder', args:`data-id="${o.id}"` }, { label:'Edit order…', act:'editorder', args:`data-id="${o.id}"` }, ...(onHire(o) ? ['-', { label:'Extend hire…', act:'openorder', args:`data-id="${o.id}" data-then="extend"` }, { label:'Mark returned…', act:'openorder', args:`data-id="${o.id}" data-then="return"` }] : []), '-', { label:'Delete…', act:'rowdel', args:`data-id="${o.id}"`, danger:true }],
    bulk:s => `<button class="btn btn-secondary btn-sm deskonly" data-act="bulk" data-v="exportorders">Export ${s.length}</button>`, del:'orders', delLabel:'Delete', delOnly:o => !onHire(o),
    add:[{ label:'+ New order', act:'neworder' }], empty:`<b>No orders here</b>Nothing is overdue. <button class="lnk" data-act="wordall">Show all</button>`, foot:its => `Spend · <span class="mono" style="color:var(--ink)">${money(its.reduce((s, o) => s + ordTotal(o), 0))}</span> · ${plural(its.length, 'order')}` }),
  'supplier:subhires':() => ({ title:'Sub-hires', size:10, items:() => D.supplier.subhires, words:[['all', 'All', () => true]],
    row:h => { const o = D.orders.find(x => x.num === h.order); return { lead:`<span class="id">${h.job}</span>`, title:esc(h.jobName), open:'subhire', meta:[`<span class="mono">${h.order}</span>`, o ? ordState(o)[0] : ''], rt:`<span class="amt">${money(h.charge)}</span>${state.cost ? `<span class="amt muted">${money(h.cost)}</span><span class="amt">${marginPct(h)}%</span>` : ''}` }; },
    menu:h => [{ label:'Open order', act:'openorderbynum', args:`data-v="${h.order}"` }, { label:'Open job', href:U.OV, small:'Overview' }],
    bulk:s => `<button class="btn btn-secondary btn-sm deskonly" data-act="bulk" data-v="exportsub">Export ${s.length}</button>`, tools:`<button class="wd ${state.cost ? 'on' : ''}" data-act="cost">${state.cost ? 'Cost &amp; margin shown ✕' : 'Show cost &amp; margin'}</button>`,
    empty:`<b>No sub-hires yet</b>Gear sub-hired from this supplier for a job shows here.`, foot:its => `Charged · <span class="mono" style="color:var(--ink)">${money(its.reduce((s, h) => s + h.charge, 0))}</span>${state.cost ? ` · cost ${money(its.reduce((s, h) => s + h.cost, 0))}` : ''}` }),
  'supplier:assets':() => ({ title:'Purchased assets', size:10, items:() => D.supplier.assets, words:[['all', 'All', () => true]],
    row:a => ({ lead:`<span class="id">${a.tag}</span>`, title:esc(a.model), href:U.ASSET, meta:[`bought on <span class="mono">${a.po}</span>`], rt:dw(a.cls, a.status) }),
    menu:a => [{ label:'Open', href:U.ASSET, small:'Asset' }, { label:'Print label', act:'printlabel', args:`data-id="${a.id}"` }],
    bulk:s => `<button class="btn btn-secondary btn-sm deskonly" data-act="bulk" data-v="labels">Print ${s.length} labels</button>`, empty:`<b>No assets from this supplier</b>Assets bought on a purchase order from here appear in the registry and here.`, foot:its => plural(its.length, 'asset') }),
  'order:lines':() => ({ title:'Lines', size:12, items:() => order().lines, words:[['all', 'All', () => true]],
    row:l => ({ lead:`<span class="id">${l.qty}×</span>`, title:esc(l.desc), meta:[`<span class="mono">${money(l.unit)}</span> each`], rt:`<span class="amt">${money(l.qty * l.unit)}</span>` }),
    menu:l => [{ label:'Edit line…', act:'lineedit', args:`data-id="${l.id}"` }, '-', { label:'Remove…', act:'rowdel', args:`data-id="${l.id}"`, danger:true }],
    bulk:s => '', del:'lines', delLabel:'Remove', add:[{ label:'+ Add line', act:'lineadd' }], empty:`<b>No lines yet</b>Add what was ordered: description, quantity and unit price. <button class="lnk" data-act="lineadd">Add line</button>`,
    after:() => { const o = order(), sub = ordSub(o); return `<div class="tot"><span>Subtotal <b>${money(sub)}</b></span><span>GST <b>${money(ordTotal(o) - sub)}</b></span><span>Total <b>${money(ordTotal(o))}</b></span></div><div class="sh2" style="margin-top:30px">Linked assets <span class="n">0</span></div><div class="ln muted">${o.type === 'PURCHASE' ? 'Assets registered against this purchase show here.' : 'Sub-hired gear is not ours, so nothing is registered against this order.'}</div>`; }, foot:its => `${plural(its.length, 'line')} · ${plural(its.reduce((s, l) => s + l.qty, 0), 'unit')}` })
};
const LIST = () => (LISTS[state.rec + ':' + state.tab] || (() => null))();
const lkey = () => state.rec + ':' + state.tab;
const curWord = cfg => { const w = state.w[lkey()] || cfg.words[0][0]; return cfg.words.find(x => x[0] === w) || cfg.words[0]; };
const visible = cfg => cfg.items().filter(curWord(cfg)[2]);
const pid = lead => { const m = /^<span class="id">(.*)<\/span>$/.exec(lead || ''); return m ? `<span class="phoneonly mono">${m[1]}</span>` : ''; };
function renderList() {
  if (state.tab === 'history') return renderHistory();
  const cfg = LIST(), all = cfg.items(), items = visible(cfg), lim = state.more[lkey()] || cfg.size, shown = items.slice(0, lim), S = state.sel, allSel = shown.length && shown.every(i => S.has(i.id)), wd = curWord(cfg);
  let h = `<div class="sh2">${shown.length ? `<button class="cb ${allSel ? 'on' : ''}" data-act="selall" aria-label="Select page"></button>` : ''}${cfg.title} <span class="n">${all.length}</span><span class="r">${cfg.tools || ''}${(cfg.add || []).map(a => a.href ? `<a class="lnk" href="${a.href}">${a.label}</a>` : `<button class="lnk" data-act="${a.act}">${a.label}</button>`).join('')}</span></div>`;
  if (cfg.words.length > 1) h += `<div class="subtools" style="margin-bottom:2px">${cfg.words.map(([k, n, fn]) => `<button class="wd ${wd[0] === k ? 'on' : ''}" data-act="word" data-k="${k}">${n} <span class="n mono" style="font-size:11.5px;font-weight:500;opacity:.7">${all.filter(fn).length}</span></button>`).join('')}</div>`;
  h += shown.map(it => { const r = cfg.row(it), on = S.has(it.id); return `<div class="rrow ${on ? 'sel' : ''} ${r.dim ? 'dim' : ''}" ${r.href || r.open ? `data-act="open" data-id="${it.id}" style="cursor:pointer"` : ''}><button class="cb ${on ? 'on' : ''}" data-act="select" data-id="${it.id}" aria-label="Select ${esc(String(it.num || it.name || it.n || it.label || it.id))}"></button>${r.lead || ''}<div class="grow"><div class="ttl ell">${r.title}</div><div class="meta">${pid(r.lead)}${r.meta.map(m => `<span>${m}</span>`).join('')}</div></div><div class="rt">${r.rt || ''}</div><button class="dots" data-act="rowmenu" data-id="${it.id}" aria-label="Row actions">${ICON.dots}</button></div>`; }).join('') || `<div class="empty" style="text-align:left;padding:24px 0;border-top:1px solid var(--line)">${all.length ? `<b>Nothing in ${wd[1]}</b>Every row sits in another segment. <button class="lnk" data-act="wordall">Show all</button>` : cfg.empty}</div>`;
  h += `<div class="lpfoot"><span>${cfg.foot(items)}</span>${items.length > shown.length ? `<button class="lnk" style="margin-left:auto" data-act="more">Show ${Math.min(25, items.length - shown.length)} more · ${items.length - shown.length} left</button>` : ''}</div>`;
  return h + (cfg.after ? cfg.after() : '');
}
// ---------- History: the Discussion rendering (dated rows, no cards) + a one-line composer
const HIST_WORDS = { client:[['all', 'All'], ['job', 'Jobs'], ['money', 'Money'], ['note', 'Notes'], ['change', 'Changes']], crew:[['all', 'All'], ['call', 'Calls'], ['time', 'Time'], ['note', 'Notes'], ['change', 'Changes']], supplier:[['all', 'All'], ['order', 'Orders'], ['note', 'Notes'], ['change', 'Changes']], order:[['all', 'All'], ['status', 'Status'], ['file', 'Files'], ['note', 'Notes']] };
function renderHistory() {
  const r = R(), W = HIST_WORDS[state.rec], ev = [...r.events].sort((a, b) => b.at.localeCompare(a.at)).filter(e => state.hist === 'all' || e.kind === state.hist), lim = state.more.hist || 8, shown = ev.slice(0, lim);
  let h = `<div class="compose"><input id="note" placeholder="Leave a note for the team" aria-label="Add a note" autocomplete="off"><button class="lnk" data-act="post">Post</button></div><div class="subtools" style="margin-bottom:6px">${W.map(([k, n]) => `<button class="wd ${state.hist === k ? 'on' : ''}" data-act="histf" data-k="${k}">${n}</button>`).join('')}</div>`, last = '';
  for (const e of shown) { const d = e.at.slice(0, 10); if (d !== last) { last = d; h += `<div class="gl">${d === TODAY ? 'Today' : fmtD(d) + (d.slice(0, 4) !== TODAY.slice(0, 4) ? ' ' + d.slice(0, 4) : '')}</div>`; } h += `<div class="hrow ${e.kind === 'note' ? 'note' : ''}"><span class="t">${e.at.slice(11)}</span><div class="grow"><span class="who">${esc(e.who.split(' ')[0])}</span> ${esc(e.text)}</div></div>`; }
  if (!shown.length) h += `<div class="empty" style="text-align:left;padding:24px 0"><b>${state.hist === 'all' ? 'No history yet' : 'Nothing under ' + W.find(x => x[0] === state.hist)[1]}</b>Changes, messages and notes show up here as they happen.</div>`;
  return h + `<div class="lpfoot"><span>${plural(ev.length, 'event')} · newest first</span>${ev.length > shown.length ? `<button class="lnk" style="margin-left:auto" data-act="more">Show ${Math.min(25, ev.length - shown.length)} more · ${ev.length - shown.length} left</button>` : ''}</div>`;
}
// ---------- bulk bar
const clearSel = () => { state.sel.clear(); state.last = null; };
function selItems() { const cfg = LIST(); return cfg ? cfg.items().filter(i => state.sel.has(i.id)) : []; }
function renderBulk() {
  const cfg = state.tab === 'overview' || state.tab === 'history' ? null : LIST(), n = cfg ? selItems().length : 0, b = $('#bulk'); b.classList.toggle('open', n > 0); document.body.classList.toggle('hassel', n > 0); if (!n) return;
  const s = selItems(), del = cfg.del ? s.filter(cfg.delOnly || (() => true)).length : 0;
  b.innerHTML = `<b style="font-size:13px">${n} selected</b>${cfg.bulk(s)}${cfg.del ? `<button class="btn btn-secondary btn-sm" style="color:var(--t-out)" data-act="bulkdel">${cfg.delLabel || 'Remove'} ${del === n ? n : del + ' of ' + n}</button>` : ''}<button class="btn btn-icon btn-sm" data-act="clearsel" aria-label="Clear selection">✕</button>`;
}

// ---------- Forms: the edit sheet (same component and field tables as the Forms prototype)
const Fd = (k, label, o = {}) => ({ k, label, ...o });
const TERMS = [['', 'Org default'], ['On receipt', 'On receipt'], ['Net 7', 'Net 7'], ['Net 14', 'Net 14'], ['Net 30', 'Net 30']];
const JOBMAP = { '#2341':'Hilton Sydney gala dinner', '#2350':'Qantas awards', '#2340':'Launch night', '#2338':'Corporate AGM' };
const FORMS = {
  client:{ title:'Client', name:r => r.name, sections:[
    { t:'Identity', hint:d => d.type === 'INDIVIDUAL' ? 'A person we hire to, not a business.' : 'Who is on the quote and the invoice.', f:[Fd('type', 'Type', { t:'words', opts:CLIENT_TYPES, full:1 }), Fd('name', d => ({ COMPANY:'Company name', INDIVIDUAL:'Full name', VENUE:'Venue name', PRODUCTION_COMPANY:'Production company name' })[d.type], { req:1, full:1, msg:'Name is required' })] },
    { t:'Contact', hint:'Main contact · the rest are in the Contacts tab.', f:[Fd('cname', 'Contact name', { full:1, show:d => d.type !== 'INDIVIDUAL' }), Fd('email', 'Email', { t:'email' }), Fd('phone', 'Phone', { t:'tel' })] },
    { t:'Address', hint:'Billing goes on invoices · shipping is where gear is delivered.', f:[Fd('billing', 'Billing address', { full:1 }), Fd('shipping', 'Shipping address', { full:1 })] },
    { t:'More details', hint:'Billing terms, tax and notes.', f:[Fd('abn', d => d.type === 'INDIVIDUAL' ? 'Tax ID' : 'ABN', { mono:1 }), Fd('terms', 'Payment terms', { t:'select', opts:TERMS }), Fd('disc', 'Default discount (%)', { t:'num', max:100, ph:'blank is none' }), Fd('profile', 'Payment profile', { t:'select', dep:1, opts:[['', 'Org default'], ['FULL_UPFRONT', 'Full upfront'], ['DEPOSIT_BALANCE', 'Deposit and balance']] }), Fd('dep', 'Default deposit (%)', { t:'num', max:100, show:d => d.profile === 'DEPOSIT_BALANCE' }), Fd('exempt', 'Tax exempt', { t:'check', full:1 }), Fd('notes', 'Notes', { t:'textarea', full:1 }), Fd('tags', 'Tags', { full:1 })] }] },
  crew:{ title:'Crew member', name:r => `${r.first} ${r.last}`, sections:[
    { t:'Identity', hint:'Who they are and how they work with us.', f:[Fd('first', 'First name', { req:1, msg:'First name is required' }), Fd('last', 'Last name', { req:1, msg:'Last name is required' }), Fd('type', 'Type', { t:'select', opts:CREW_TYPES }), Fd('status', 'Status', { t:'select', opts:[['ACTIVE', 'Active'], ['ON_LEAVE', 'On leave'], ['INACTIVE', 'Inactive'], ['ARCHIVED', 'Archived']] }), Fd('account', 'Platform account', { t:'select', full:1, opts:[['', 'Not linked'], ['Mel Torres', 'Mel Torres'], ['Sam Okafor', 'Sam Okafor'], ['Tom Nguyen', 'Tom Nguyen']], hint:'Linking lets them sign in and see their own calls' })] },
    { t:'Contact', hint:'Calls and offers go out by SMS or email.', f:[Fd('email', 'Email', { t:'email' }), Fd('phone', 'Phone', { t:'tel' })] },
    { t:'Rates', hint:'Defaults for new calls · blank is blank, never $0.', f:[Fd('day', 'Day rate ($)', { t:'num' }), Fd('hour', 'Hourly ($)', { t:'num' }), Fd('ot', 'Overtime ×', { t:'num', ph:'e.g. 1.5' })] },
    { t:'More details', hint:'Department, role and personal.', f:[Fd('dept', 'Department'), Fd('role', 'Default role', { t:'select', opts:[['', 'None'], ...['Lighting technician', 'Audio A1', 'Audio A2', 'Video technician', 'Rigger', 'Stagehand', 'Driver'].map(x => [x, x])] }), Fd('dob', 'Date of birth', { t:'date' }), Fd('abn', 'ABN / GST', { mono:1 }), Fd('address', 'Address', { full:1 }), Fd('ecn', 'Emergency contact'), Fd('ecp', 'Emergency phone', { t:'tel' }), Fd('notes', 'Notes', { t:'textarea', full:1 }), Fd('tags', 'Tags and skills', { full:1 })] }] },
  supplier:{ title:'Supplier', name:r => r.name, sections:[
    { t:'Identity', hint:'Who we buy or sub-hire from.', f:[Fd('name', 'Name', { req:1, full:1, msg:'Name is required' })] },
    { t:'Contact', hint:'Main contact · the rest are in the Contacts tab.', f:[Fd('cname', 'Contact name', { full:1 }), Fd('email', 'Email', { t:'email' }), Fd('phone', 'Phone', { t:'tel' }), Fd('web', 'Website', { full:1 })] },
    { t:'Address', hint:'Where to collect or send.', f:[Fd('address', 'Address', { full:1 })] },
    { t:'More details', hint:'Account, terms and notes.', f:[Fd('acct', 'Account #', { mono:1 }), Fd('terms', 'Payment terms', { t:'select', opts:TERMS }), Fd('lead', 'Default lead time', { full:1, ph:'e.g. 2 working days' }), Fd('notes', 'Notes', { t:'textarea', full:1 }), Fd('tags', 'Tags', { full:1 })] }] },
  order:{ title:'Supplier order', name:r => r.num, sections:[
    { t:'Order', hint:'Who it goes to and what it is.', f:[Fd('supplier', 'Supplier', { full:1, locked:1 }), Fd('num', 'Order / PO #', { req:1, mono:1, msg:'Order number is required' }), Fd('type', 'Type', { t:'select', dep:1, opts:ORDER_TYPES }), Fd('status', 'Status', { t:'select', full:1, opts:[['DRAFT', 'Draft'], ['ORDERED', 'Ordered'], ['PARTIAL', 'Partly received'], ['RECEIVED', 'Received'], ['CANCELLED', 'Cancelled']] })] },
    { t:'Dates', hint:'Optional · the return date drives the overdue flag.', f:[Fd('odate', 'Order date', { t:'date' }), Fd('edate', 'Expected date', { t:'date' }), Fd('rdue', 'Return due', { t:'date', show:d => d.type === 'SUBHIRE' })] },
    { t:'More details', hint:'The job it covers, and notes.', f:[Fd('project', 'For job', { t:'select', full:1, opts:[['', 'No job'], ...Object.entries(JOBMAP).map(([n, m]) => [n, `${n} ${m}`])] }), Fd('ref', 'Supplier reference', { mono:1 }), Fd('notes', 'Notes', { t:'textarea', full:1 })] }] }
};
const fv = v => v == null ? '' : v;
const lbl = (f, d) => typeof f.label === 'function' ? f.label(d) : f.label;
function sheetHtml() {
  const s = state.sheet, F = FORMS[s.rec], d = s.draft, e = s.errs || {}, create = s.mode === 'create';
  const fld = f => {
    if (f.show && !f.show(d)) return '';
    const err = e[f.k] ? `<span class="errm">${e[f.k]}</span>` : '', inv = e[f.k] ? 'aria-invalid="true"' : '', cls = f.full ? 'full' : '';
    if (f.t === 'check') return `<div class="full"><div class="swrow" data-act="dsw" data-f="${f.k}"><span class="sw ${d[f.k] ? 'on' : ''}"><i></i></span><span>${lbl(f, d)}</span></div></div>`;
    if (f.t === 'words') return `<div class="full">${field(lbl(f, d), `<div style="display:flex;gap:16px;flex-wrap:wrap">${f.opts.map(([v, n]) => `<button class="wd ${d[f.k] === v ? 'on' : ''}" data-act="dwd" data-f="${f.k}" data-v="${v}">${n}</button>`).join('')}</div>`)}</div>`;
    let inner;
    if (f.t === 'select') inner = `<select data-f="${f.k}" ${f.dep ? 'data-dep="1"' : ''}>${f.opts.map(([v, n]) => opt(v, n, d[f.k])).join('')}</select>`;
    else if (f.t === 'textarea') inner = `<textarea data-f="${f.k}" rows="3" ${inv}>${esc(d[f.k])}</textarea>`;
    else inner = `<input data-f="${f.k}" value="${esc(d[f.k])}" ${f.t === 'email' ? 'type="email" inputmode="email"' : f.t === 'tel' ? 'type="tel"' : f.t === 'date' ? 'type="date"' : f.t === 'num' ? 'inputmode="decimal"' : ''} ${f.mono ? 'class="mono"' : ''} ${f.ph ? `placeholder="${f.ph}"` : ''} ${f.locked ? 'disabled' : ''} ${inv}>`;
    return `<div class="${cls}">${field(lbl(f, d) + (f.req ? ' *' : ''), inner + err, f.hint || '')}</div>`;
  };
  return `<div class="esheet" role="dialog" aria-modal="true" aria-label="${create ? 'New ' : 'Edit '}${F.title.toLowerCase()}">
  <div class="eshd"><div class="t-overline">${create ? 'New' : F.title}</div><h2>${create ? 'New supplier order' : 'Edit ' + esc(F.name(s.src))}</h2>${create ? `<div class="t-micro muted" style="margin-top:4px">Raised for ${esc(D.supplier.name)}. Add its lines on the order once it is created.</div>` : ''}</div>
  <div class="esbd">${F.sections.map(sec => { const hint = typeof sec.hint === 'function' ? sec.hint(d) : sec.hint; return `<div class="esec"><div class="sh2">${sec.t}</div>${hint ? `<div class="t-micro muted" style="margin:-4px 0 10px">${hint}</div>` : ''}<div class="egrid">${sec.f.map(fld).join('')}</div></div>`; }).join('')}
   ${s.rec === 'client' ? `<div class="esec"><div class="sh2">Contacts</div><div class="t-small muted">${plural(D.client.contacts.length, 'contact')} · add, edit and choose the primary in the Contacts tab.</div></div>` : ''}</div>
  <div class="esft"><span class="t-small muted" id="dirtymsg">${s.dirty ? 'Unsaved changes' : ''}</span><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="editgo">${create ? 'Create order' : 'Save'}</button></div></div>`;
}
function openSheet(html, focusSel) { body.innerHTML = html; layer.classList.add('open', 'dim'); const f = focusSel && $(focusSel, body); if (f && !isPhone()) f.focus(); }
function rerenderSheet(focus) { const t = $('.esbd', body), top = t ? t.scrollTop : 0; openSheet(sheetHtml(), focus); const t2 = $('.esbd', body); if (t2) t2.scrollTop = top; }
function openEdit(rec, mode = 'edit', id) {
  const F = FORMS[rec], src = mode === 'create' ? { supplier:D.supplier.name, num:nextOrderNum(), type:'SUBHIRE', status:'DRAFT', odate:TODAY, edate:'', rdue:'', job:'', ref:'', notes:'' } : rec === 'order' ? D.orders.find(o => o.id === id) : D[rec], d = {};
  F.sections.forEach(sec => sec.f.forEach(f => { d[f.k] = f.k === 'project' ? fv(src.job) : f.t === 'check' ? !!src[f.k] : fv(src[f.k]); }));
  state.sheet = { rec, mode, id, src, draft:d, errs:{}, dirty:false }; closeLayerKeep(); openSheet(sheetHtml(), '[data-f]');
}
const nextOrderNum = () => 'SH-' + String(Math.max(...D.orders.filter(o => /^SH-/.test(o.num)).map(o => +o.num.slice(3))) + 1).padStart(4, '0');
function validate(F, d) {
  const e = {}, mailOk = v => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
  F.sections.forEach(sec => sec.f.forEach(f => { if (f.show && !f.show(d)) return; const v = String(d[f.k] ?? '').trim();
    if (f.req && !v) e[f.k] = f.msg || 'Required'; else if (f.t === 'email' && v && !mailOk(v)) e[f.k] = 'Invalid email';
    else if (f.t === 'num' && v) { const n = Number(v); if (isNaN(n) || n < 0) e[f.k] = 'Enter a number, 0 or more'; else if (f.max && n > f.max) e[f.k] = `Enter 0 to ${f.max}, or leave it blank`; } }));
  if (d.edate && d.odate && d.edate < d.odate) e.edate = 'Expected date cannot be before the order date';
  if (d.rdue && d.odate && d.type === 'SUBHIRE' && d.rdue < d.odate) e.rdue = 'Return cannot be before the order date';
  return e;
}
function saveSheet() {
  const s = state.sheet, F = FORMS[s.rec], d = s.draft, e = validate(F, d);
  if (Object.keys(e).length) { s.errs = e; rerenderSheet(); const bad = $('[aria-invalid="true"]', body); if (bad) { bad.scrollIntoView({ block:'center' }); bad.focus(); } return; }
  const undo = snapshot(), clean = {}; Object.entries(d).forEach(([k, v]) => clean[k] = typeof v === 'string' ? v.trim() : v);
  if (s.rec === 'order') {
    const { project, ...rest } = clean, jobn = project || '', ord = s.mode === 'create' ? { id:'o' + (40 + D.orders.length), supplier:D.supplier.name, lines:[], files:[], invoice:null, returned:null, received:null, events:[mkEv(TODAY + ' 09:41', 'Jayden Cole', 'created the order', 'status')] } : D.orders.find(o => o.id === s.id);
    Object.assign(ord, rest, { job:jobn, jobName:jobn ? JOBMAP[jobn] : '' }); if (s.mode === 'create') D.orders.unshift(ord);
    else ord.events.unshift(mkEv(TODAY + ' 09:41', 'Jayden Cole', 'edited the order', 'status'));
    if (s.mode === 'create') { closeLayer(); render(); toast(`${esc(ord.num)} created · draft, no lines yet`, undo); return; }
  } else { Object.assign(D[s.rec], clean); D[s.rec].events.unshift(mkEv(TODAY + ' 09:41', 'Jayden Cole', 'edited the record', 'change')); }
  const nm = F.name(s.rec === 'order' ? D.orders.find(o => o.id === s.id) : D[s.rec]); closeLayer(); render(); toast(`${esc(nm)} saved`, undo);
}

// ---------- dialogs
const dlg = (over, title, bodyHtml, foot) => openDialog(`<div class="hd"><div class="t-overline">${over}</div><h2 style="font-size:18px">${title}</h2></div><div class="bd">${bodyHtml}</div><div class="ft"><div style="flex:1"></div>${foot}</div>`);
const cancelBtn = '<button class="btn btn-secondary" data-act="close">Cancel</button>';
const confirmDlg = (over, title, text, goAct, goLabel, args = '', danger = true) => dlg(over, title, `<div class="t-small" style="line-height:1.55">${text}</div>`, `${cancelBtn}<button class="btn ${danger ? 'btn-secondary' : 'btn-primary'}" ${danger ? 'style="color:var(--t-out)"' : ''} data-act="${goAct}" ${args}>${goLabel}</button>`);
const commit = (fn, msg, canUndo = true) => { const undo = snapshot(); fn(); closeLayer(); render(); toast(msg, canUndo ? undo : null); };
const logEv = (kind, text, who = 'Jayden Cole') => R().events.unshift(mkEv(TODAY + ' 09:41', who, text, kind));
const SAMPLES = {
  client:[['Hilton site induction.pdf', 640e3], ['Hilton PO terms 2026.pdf', 188e3], ['Ballroom rigging plan.pdf', 2.1e6]],
  crew:[['Elevated work platform ticket.pdf', 280e3, '2028-05-30'], ['First aid certificate.pdf', 150e3, '2027-01-12'], ['Police check.pdf', 120e3, null]],
  supplier:[['Delivery schedule Nov.pdf', 90e3], ['Insurance certificate.pdf', 230e3, '2027-06-30'], ['Rate card 2027.xlsx', 77e3]],
  order:[['SC-INV-2231.pdf', 138e3, 'Invoice'], ['Return docket.pdf', 260e3, 'Docket'], ['Photos of damage.pdf', 1.2e6, 'Other']]
};
function uploadDlg(rec, invoice) {
  const list = invoice ? [SAMPLES.order[0]] : SAMPLES[rec];
  dlg(invoice ? 'Supplier invoice' : 'Upload', invoice ? 'Attach the invoice' : 'Upload a file', `<div class="t-small muted" style="margin-bottom:8px">PDF, image, Word or Excel. Pick a sample file in this prototype.</div>${list.map((f, i) => `<button class="res2" data-act="uploadgo" data-i="${i}" data-inv="${invoice ? 1 : ''}"><span class="thumbf">${esc(ext(f[0]))}</span><span style="flex:1;min-width:0"><span class="ell" style="display:block;font-size:13.5px;font-weight:600">${esc(f[0])}</span><span class="muted t-small">${fmtSize(f[1])}${f[2] && rec === 'crew' ? ' · expires ' + fmtDY(f[2]) : f[2] && rec === 'supplier' ? ' · expires ' + fmtDY(f[2]) : f[2] ? ' · ' + f[2] : ''}</span></span></button>`).join('')}`, cancelBtn);
}
function pageMenuItems() {
  const r = state.rec;
  if (r === 'client') return [{ label:'Edit client…', act:'edit' }, { label:'New job for this client', href:U.WIZARD, small:'Wizard' }, '-', { label:'Sync with Xero', act:'xerosync' }, { label:D.client.xero.state === 'LINKED' ? 'Change Xero mapping…' : 'Map to Xero…', act:'xeromap' }, { label:'Merge into another client…', act:'merge' }, '-', { label:'Clients', href:U.PEOPLE, small:'List' }, '-', ...(D.client.active ? [{ label:'Archive client…', act:'archive', danger:true }] : [{ label:'Restore client', act:'restore' }])];
  if (r === 'crew') { const un = unconfirmed()[0]; return [{ label:'Edit crew member…', act:'edit' }, { label:`Message ${D.crew.first}…`, act:'message' }, ...(un ? [{ label:`Resend offer · ${un.label} ${un.job}`, act:'resend', args:`data-id="${un.id}"` }] : []), { label:'Log time…', act:'logtime' }, { label:'Add availability block…', act:'availadd' }, '-', { label:'Calendar feed…', act:'feed' }, { label:'Export timesheets (CSV)', act:'exportcsv' }, { label:'Crew planner', href:U.PLANNER, small:'Planner' }, '-', ...(D.crew.status === 'INACTIVE' ? [{ label:'Reactivate', act:'restore' }] : [{ label:'Make inactive…', act:'inactive', danger:true }]), { label:'Delete crew member…', act:'deletecrew', danger:true }]; }
  if (r === 'supplier') return [{ label:'Edit supplier…', act:'edit' }, { label:'New order…', act:'neworder' }, { label:'Add contact…', act:'contactadd' }, { label:'Upload document…', act:'upload' }, '-', { label:'Suppliers', href:U.PEOPLE, small:'List' }, '-', ...(D.supplier.active ? [{ label:'Archive supplier…', act:'archive', danger:true }] : [{ label:'Restore supplier', act:'restore' }]), { label:'Delete supplier…', act:'delsup', danger:true }];
  const o = order(); return [{ label:'Edit order…', act:'edit' }, ...(onHire(o) ? [{ label:'Extend hire…', act:'extend' }, { label:'Mark returned…', act:'markret' }] : o.status === 'ORDERED' ? [{ label:'Receive the gear…', act:'receive' }] : []), { label:o.invoice ? 'Replace supplier invoice…' : 'Attach supplier invoice…', act:'uploadinv' }, { label:'Duplicate order', act:'dupord' }, ...(o.job ? ['-', { label:`${o.job} Equipment`, href:U.EQ, small:'Equipment' }, { label:`${o.job} Overview`, href:U.OV, small:'Overview' }] : []), '-', { label:'Delete order…', act:'delorder', danger:true }];
}
const ARR = { files:() => state.rec === 'client' ? D.client.files : state.rec === 'order' ? order().files : state.rec === 'crew' ? D.crew.docs : D.supplier.docs, contacts:() => D[state.rec].contacts, calls:() => D.crew.calls, times:() => D.crew.times, avail:() => D.crew.avail, orders:() => D.orders, lines:() => order().lines };
function delDialog(ids) {
  const cfg = LIST(), k = cfg.del || 'files', nm = n => plural(n, { files:'file', contacts:'contact', calls:'call', times:'timesheet', avail:'block', orders:'order', lines:'line' }[k]);
  const items = ARR[k]().filter(x => ids.includes(x.id)), ok = items.filter(cfg.delOnly || (() => true)), skip = items.length - ok.length;
  const fx = { files:'It is removed for everyone who can see this record. Undo is offered right after.', contacts:'Jobs that used them as the contact fall back to the primary contact. The primary cannot be removed: make someone else primary first.', calls:`They leave the job's crew list and the planner. Anyone already confirmed is not messaged: use Message first.`, times:'The hours leave this person’s totals and the export. Approved hours that were already exported stay in that export.', avail:'The planner treats those days as open again. Calls already booked are unchanged.', orders:`The order, its lines and its files are deleted. Sub-hire cover on the job is released. Orders still on hire cannot be deleted: return them first.`, lines:'The order total is recalculated. Nothing is sent to the supplier.' }[k];
  if (!ok.length) { closeLayer(); toast(k === 'orders' ? 'Orders still on hire stay: return them first' : 'Nothing to remove'); return; }
  confirmDlg('Remove', `Remove ${items.length === 1 ? esc(String(items[0].name || items[0].num || items[0].desc || items[0].label || items[0].n || nm(1))) : nm(ok.length)}?`, `${fx}${skip ? `<br><br>${plural(skip, 'row')} will be skipped.` : ''}`, 'rowdelgo', `${k === 'times' || k === 'orders' ? 'Delete' : 'Remove'} ${ok.length === 1 ? '' : ok.length}`.trim(), `data-ids="${ok.map(x => x.id).join(',')}"`);
}
function delGo(ids) {
  const cfg = LIST(), k = cfg.del, a = ARR[k](), keep = new Set(ids), undo = snapshot(); let n = 0;
  for (let i = a.length - 1; i >= 0; i--) if (keep.has(a[i].id) && (k !== 'contacts' || !a[i].primary)) { a.splice(i, 1); n++; }
  clearSel(); closeLayer(); render(); toast(`${plural(n, 'row')} removed${k === 'contacts' && keep.size > n ? ' · the primary contact stays' : ''}`, undo);
}

// ---------- actions
const idsOf = () => [...state.sel];
function setRec(k, id) { closeLayer(); clearSel(); state.rec = k; state.tab = 'overview'; state.hist = 'all'; state.more = {}; if (k === 'order') state.orderId = id || 'o12'; render(); window.scrollTo(0, 0); const c = $('.content'); if (c) c.scrollTop = 0; }
function setTab(k) { closeLayer(); clearSel(); state.tab = k; render(); window.scrollTo(0, 0); const c = $('.content'); if (c) c.scrollTop = 0; }
function act(name, el, ev) {
  el = el || document.body; const id = el.dataset.id, k = el.dataset.k, r = state.rec;
  switch (name) {
    case 'close': if (state.sheet && state.sheet.dirty) { dlg('Discard', 'Discard your changes?', '<div class="t-small" style="line-height:1.5">Nothing has been saved yet.</div>', '<button class="btn btn-secondary" data-act="reopen">Keep editing</button><button class="btn btn-secondary" style="color:var(--t-out)" data-act="discard">Discard</button>'); } else closeLayer(); break;
    case 'reopen': rerenderSheet(); break;
    case 'discard': closeLayer(); break;
    case 'noop': closeLayer(); toast('Not wired in this prototype'); break;
    case 'new': { const t = state.tab; closeLayer(); if (r === 'supplier') act('neworder', document.body); else if (t === 'contacts') act('contactadd', document.body); break; }
    case 'rec': setRec(k, id); break;
    case 'tab': setTab(k); break;
    case 'tabw': state.w[r + ':' + k] = el.dataset.w; setTab(k); break;
    case 'word': state.w[lkey()] = k; state.more[lkey()] = 0; clearSel(); render(); break;
    case 'wordall': state.w[lkey()] = LIST().words[0][0]; render(); break;
    case 'more': state.more[state.tab === 'history' ? 'hist' : lkey()] = (state.more[state.tab === 'history' ? 'hist' : lkey()] || (state.tab === 'history' ? 8 : LIST().size)) + 25; render(); break;
    case 'histf': state.hist = k; state.more.hist = 0; render(); break;
    case 'post': { const t = $('#note'), v = t ? t.value.trim() : ''; if (!v) { if (t) t.focus(); toast('Write something first'); break; } const undo = snapshot(); logEv('note', v); render(); toast('Note posted to History', undo); break; }
    case 'cost': state.cost = !state.cost; render(); break;
    case 'pagemenu': openMenu(el, esc(r === 'order' ? order().num : r === 'crew' ? crewName() : D[r].name), pageMenuItems()); break;
    case 'edit': closeLayer(); openEdit(r, 'edit', r === 'order' ? state.orderId : undefined); break;
    case 'editorder': closeLayer(); openEdit('order', 'edit', id); break;
    case 'neworder': closeLayer(); openEdit('order', 'create'); break;
    case 'dsw': { const f = el.dataset.f, s = state.sheet; s.draft[f] = !s.draft[f]; s.dirty = true; rerenderSheet(); break; }
    case 'dwd': { const s = state.sheet; s.draft[el.dataset.f] = el.dataset.v; s.dirty = true; rerenderSheet(); break; }
    case 'editgo': saveSheet(); break;
    case 'undo': if (state.undo) { state.undo(); state.undo = null; } $('#toast').classList.remove('open'); break;
    case 'toastclose': $('#toast').classList.remove('open'); break;
    // ---- selection
    case 'select': { const cfg = LIST(), order_ = visible(cfg).slice(0, state.more[lkey()] || cfg.size).map(x => x.id); if (ev && ev.shiftKey && state.last) { const i1 = order_.indexOf(state.last), i2 = order_.indexOf(id); for (const x of order_.slice(Math.min(i1, i2), Math.max(i1, i2) + 1)) state.sel.add(x); } else state.sel.has(id) ? state.sel.delete(id) : state.sel.add(id); state.last = id; render(); break; }
    case 'selall': { const cfg = LIST(), list = visible(cfg).slice(0, state.more[lkey()] || cfg.size).map(x => x.id), all = list.every(x => state.sel.has(x)); list.forEach(x => all ? state.sel.delete(x) : state.sel.add(x)); render(); break; }
    case 'clearsel': clearSel(); render(); break;
    case 'open': { if (ev && ev.target.closest('.cb,.dots,a,button.ttl')) break; const cfg = LIST(), it = cfg.items().find(x => x.id === id), rw = cfg.row(it); if (rw.href) { closeLayer(); go(rw.href); } else if (rw.open === 'order') act('openorder', { dataset:{ id } }); else if (rw.open === 'subhire') act('openorderbynum', { dataset:{ v:it.order } }); break; }
    case 'rowmenu': { const cfg = LIST(), it = cfg.items().find(x => x.id === id); openMenu(el, esc(String(it.name || it.num || it.n || it.label || it.desc || it.tag || it.job || cfg.title)), cfg.menu(it)); break; }
    case 'rowdel': closeLayer(); delDialog([id]); break;
    case 'bulkdel': closeLayer(); delDialog(idsOf()); break;
    case 'rowdelgo': delGo(el.dataset.ids.split(',')); break;
    case 'bulk': bulk(el.dataset.v); break;
    // ---- shared record verbs
    case 'archive': closeLayer(); if (r === 'client') { const open = D.client.jobs.filter(j => j.open); confirmDlg('Archive', `Archive ${esc(D.client.name)}?`, `Nothing is deleted. It leaves the client picker and new jobs; you can restore it from this page.<ul><li>${plural(open.length, 'open job')} (${open.map(j => esc(j.num)).join(', ')}) keep running, and their documents still go to the right contact.</li><li>${plural(unpaid().length, 'unpaid invoice')} (${money(outstanding())}) stay collectible${overdueDocs().length ? ', including the ' + overdueDocs().length + ' overdue' : ''}.</li><li>Quote and invoice history, files and notes stay.</li><li>The Xero contact is left alone.</li></ul>`, 'archivego', 'Archive client'); } else confirmDlg('Archive', `Archive ${esc(D.supplier.name)}?`, `It leaves the supplier picker and new orders. Nothing is deleted:<ul><li>${plural(openOrders().length, 'open order')} stay open, including ${D.orders.filter(onHire).map(o => esc(o.num)).join(', ') || 'none on hire'}.</li><li>${plural(D.orders.filter(onHire).reduce((n, o) => n + units(o), 0), 'unit')} on hire still need returning.</li><li>Spend, contacts and documents stay.</li></ul>`, 'archivego', 'Archive supplier'); break;
    case 'archivego': commit(() => { R().active = false; logEv('change', 'archived the record'); }, `${esc(r === 'client' ? D.client.name : D.supplier.name)} archived · hidden from pickers`); break;
    case 'restore': commit(() => { if (r === 'crew') D.crew.status = 'ACTIVE'; else R().active = true; logEv('change', 'restored the record'); }, `${esc(r === 'crew' ? crewName() : D[r].name)} ${r === 'crew' ? 'reactivated' : 'restored'}`); break;
    case 'editnotes': closeLayer(); dlg('Notes', 'Notes', `<textarea id="notes-t" rows="5" aria-label="Notes">${esc(R().notes)}</textarea><div class="t-micro muted" style="margin-top:6px">Visible to everyone who can open this record.</div>`, `${cancelBtn}<button class="btn btn-primary" data-act="notesgo">Save</button>`); setTimeout(() => { const t = $('#notes-t', body); if (t && !isPhone()) t.focus(); }, 30); break;
    case 'notesgo': { const v = $('#notes-t', body).value.trim(); commit(() => { R().notes = v; logEv('change', 'edited the notes'); }, 'Notes saved'); break; }
    case 'docopen': { const f = ARR.files().find(x => x.id === id); closeLayer(); toast(`Opens ${esc(f.name)} in a new tab`); break; }
    case 'download': closeLayer(); toast(state.tab === 'money' ? 'Downloading the PDF' : `Downloading ${esc((ARR.files().find(x => x.id === id) || {}).name || 'file')}`); break;
    case 'upload': closeLayer(); uploadDlg(r); break;
    case 'uploadfile': closeLayer(); uploadDlg('order'); break;
    case 'uploadinv': closeLayer(); uploadDlg('order', true); break;
    case 'uploadgo': { const inv = el.dataset.inv === '1', i = +el.dataset.i, f = (inv ? [SAMPLES.order[0]] : SAMPLES[r])[i]; commit(() => { const rec = { id:'u' + Math.floor(rnd() * 1e6), name:f[0], size:f[1], by:'Jayden Cole', at:TODAY }; if (r === 'crew' || r === 'supplier') rec.exp = f[2] || null; if (r === 'order') { rec.kind = inv ? 'Invoice' : (f[2] || 'Other'); if (rec.kind === 'Invoice') order().invoice = { name:f[0], size:f[1] }; } ARR.files().unshift(rec); logEv(r === 'order' ? 'file' : 'change', `uploaded ${f[0]}`); }, `${esc(f[0])} ${inv ? 'attached as the supplier invoice' : 'uploaded'}`); break; }
    case 'expiry': { const f = ARR.files().find(x => x.id === id); closeLayer(); dlg('Expiry', esc(f.name), field('Expires', `<input id="exp-d" type="date" value="${fv(f.exp)}">`, 'Leave blank if it does not lapse. 30 days before, it shows on the Overview.'), `${cancelBtn}<button class="btn btn-primary" data-act="expirygo" data-id="${id}">Save</button>`); break; }
    case 'expirygo': { const v = $('#exp-d', body).value; commit(() => { ARR.files().find(x => x.id === id).exp = v || null; }, v ? `Expiry set to ${fmtDY(v)}` : 'Expiry cleared'); break; }
    // ---- contacts
    case 'contactadd': case 'contactedit': { closeLayer(); const p = name === 'contactedit' ? D[r].contacts.find(x => x.id === id) : { n:'', r:'', e:'', p:'' }; dlg('Contacts', name === 'contactedit' ? esc(p.n) : 'Add a contact', `<div style="display:grid;gap:12px">${field('Name *', `<input id="c-n" value="${esc(p.n)}">`)}${field('Role', `<input id="c-r" value="${esc(p.r)}" placeholder="e.g. Events manager">`)}${field('Email', `<input id="c-e" type="email" value="${esc(p.e)}">`)}${field('Phone', `<input id="c-p" type="tel" value="${esc(p.p)}">`)}<span class="errm" id="c-err"></span></div>`, `${cancelBtn}<button class="btn btn-primary" data-act="contactgo" ${name === 'contactedit' ? `data-id="${id}"` : ''}>${name === 'contactedit' ? 'Save' : 'Add contact'}</button>`); setTimeout(() => { const t = $('#c-n', body); if (t && !isPhone()) t.focus(); }, 30); break; }
    case 'contactgo': { const n = $('#c-n', body).value.trim(), e = $('#c-e', body).value.trim(); if (!n) { $('#c-err', body).textContent = 'Name is required'; break; } if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { $('#c-err', body).textContent = 'Invalid email'; break; }
      commit(() => { const a = D[r].contacts, v = { n, r:$('#c-r', body).value.trim(), e, p:$('#c-p', body).value.trim() }; if (id) Object.assign(a.find(x => x.id === id), v); else a.push({ id:'ct' + Math.floor(rnd() * 1e6), ...v, primary:!a.length }); logEv('change', `${id ? 'edited' : 'added'} the contact ${n}`); }, `${esc(n)} ${id ? 'saved' : 'added to contacts'}`); break; }
    case 'contactprimary': { const p = D[r].contacts.find(x => x.id === id); commit(() => { D[r].contacts.forEach(x => x.primary = x.id === id); logEv('change', `made ${p.n} the primary contact`); }, `${esc(p.n)} is now the primary contact`); break; }
    // ---- client
    case 'copyjob': closeLayer(); toast(`${esc(D.client.jobs.find(j => j.id === id).num)} copied`); break;
    case 'remind': { const m = D.client.docs.find(x => x.id === id); closeLayer(); logEv('money', `sent a payment reminder for ${m.num}`); render(); toast(`Reminder for ${esc(m.num)} sent to ${esc((D.client.contacts.find(c => /payable/i.test(c.r)) || D.client.contacts[0]).n)}`); break; }
    case 'resendq': { const m = D.client.docs.find(x => x.id === id); closeLayer(); logEv('money', `resent ${m.num}`); render(); toast(`${esc(m.num)} resent to ${esc(D.client.contacts.find(c => c.primary).n)}`); break; }
    case 'markpaid': { const m = D.client.docs.find(x => x.id === id); closeLayer(); confirmDlg('Payment', `Record a payment on ${esc(m.num)}?`, `Records ${money(m.amt)} received today in full. The invoice shows Paid here and in Finance; a partial payment is recorded from Finance.`, 'markpaidgo', 'Record payment', `data-id="${id}"`, false); break; }
    case 'markpaidgo': { const m = D.client.docs.find(x => x.id === id); commit(() => { m.status = 'Paid'; m.paid = TODAY; logEv('money', `recorded a ${money(m.amt)} payment on ${m.num}`); }, `${esc(m.num)} marked paid · ${money(m.amt)} recorded today`); break; }
    case 'xerosync': closeLayer(); commit(() => { D.client.xero.at = TODAY + ' 09:41'; logEv('change', 'synced the contact with Xero', 'Xero'); }, 'Xero contact synced · 8 documents checked', false); break;
    case 'xeromap': closeLayer(); dlg('Xero', 'Map to a Xero contact', field('Xero contact', `<select id="x-c">${['Hilton Sydney Pty Ltd', 'Hilton Hotels Pty Ltd', 'Hilton Sydney (old)'].map(n => opt(n, n, D.client.xero.name)).join('')}${opt('__new', 'Create a new contact in Xero')}</select>`, 'Invoices and payments sync against this contact.'), `${cancelBtn}<button class="btn btn-primary" data-act="xeromapgo">Save mapping</button>`); break;
    case 'xeromapgo': { const v = $('#x-c', body).value; commit(() => { D.client.xero = { state:'LINKED', name:v === '__new' ? D.client.name + ' (new)' : v, at:TODAY + ' 09:41' }; logEv('change', `mapped the contact to ${D.client.xero.name} in Xero`); }, `Mapped to ${esc(D.client.xero.name)}`); break; }
    case 'merge': closeLayer(); dlg('Merge', `Merge ${esc(D.client.name)} into another client`, `${field('Keep this client', `<select id="m-to">${['Hilton Hotels Pty Ltd', 'Hilton Sydney Hotel', 'Hilton Worldwide'].map(n => opt(n, n)).join('')}</select>`)}<div class="t-small" style="line-height:1.55;margin-top:12px">Everything on ${esc(D.client.name)} moves to the client you keep:<ul><li>${plural(D.client.jobs.length, 'job')} and ${plural(D.client.docs.length, 'quote or invoice', 'quotes and invoices')}</li><li>${plural(D.client.contacts.length, 'contact')} and ${plural(D.client.files.length, 'file')}</li></ul>${esc(D.client.name)} is then archived. The Xero mapping of the client you keep is used. Undo is offered right after.</div>`, `${cancelBtn}<button class="btn btn-secondary" style="color:var(--t-out)" data-act="mergego">Merge</button>`); break;
    case 'mergego': { const to = $('#m-to', body).value; commit(() => { D.client.active = false; D.client.mergedInto = to; logEv('change', `merged into ${to}`); }, `Merged into ${esc(to)} · ${D.client.jobs.length} jobs, ${D.client.docs.length} documents and ${D.client.contacts.length} contacts moved`); break; }
    // ---- crew
    case 'resend': { const c = D.crew.calls.find(x => x.id === id); closeLayer(); c.state = 'OFFERED'; c.offered = TODAY; logEv('call', `sent an offer for ${c.job} ${c.label} by SMS`); render(); toast(`Offer sent to ${esc(D.crew.first)} by SMS · ${esc(c.label)}, ${fmtDay(c.date)} ${c.time}`); break; }
    case 'confirmcall': { const c = D.crew.calls.find(x => x.id === id); commit(() => { c.state = 'CONFIRMED'; logEv('call', `marked ${c.job} ${c.label} confirmed`); }, `${esc(c.label)} on ${esc(c.job)} marked confirmed`); break; }
    case 'unconfirm': { const c = D.crew.calls.find(x => x.id === id); commit(() => { c.state = 'OFFERED'; }, `${esc(c.label)} back to unconfirmed`); break; }
    case 'message': closeLayer(); state.ch = 'sms'; dlg('Message', `Message ${esc(D.crew.first)}`, `<div class="subtools" style="padding:0 0 10px"><button class="wd on" data-act="msgch" data-k="sms">SMS · ${esc(D.crew.phone)}</button><button class="wd" data-act="msgch" data-k="email">Email</button></div><textarea id="msg-t" rows="4" placeholder="Short and specific: what, where, when"></textarea>`, `${cancelBtn}<button class="btn btn-primary" data-act="messagego">Send</button>`); break;
    case 'msgch': $$('.dlg .wd').forEach(b => b.classList.toggle('on', b === el)); state.ch = k; break;
    case 'messagego': { const t = $('#msg-t', body).value.trim(); if (!t) { $('#msg-t', body).focus(); break; } closeLayer(); logEv('call', `messaged ${D.crew.first} by ${state.ch === 'email' ? 'email' : 'SMS'}: ${t.slice(0, 60)}`); render(); toast(`Message sent to ${esc(D.crew.first)} by ${state.ch === 'email' ? 'email' : 'SMS'}`); break; }
    case 'logtime': case 'timeedit': { closeLayer(); const t = name === 'timeedit' ? D.crew.times.find(x => x.id === id) : { date:TODAY, job:'#2331', start:'08:00', end:'16:30', brk:30, note:'' }; dlg('Timesheet', name === 'timeedit' ? 'Edit time' : 'Log time', `<div style="display:grid;gap:12px">${field('Call', `<select id="t-j">${[...new Set([...D.crew.calls.map(c => c.job), t.job, 'General shift'])].map(j => opt(j, j, t.job)).join('')}</select>`)}${field('Date', `<input id="t-d" type="date" value="${t.date}">`)}<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">${field('Start', `<input id="t-s" type="time" value="${t.start}">`)}${field('End', `<input id="t-e" type="time" value="${t.end}">`)}${field('Break (min)', `<input id="t-b" inputmode="numeric" value="${t.brk}">`)}</div>${field('Notes', `<input id="t-n" value="${esc(t.note || '')}">`)}<span class="errm" id="t-err"></span></div>`, `${cancelBtn}<button class="btn btn-primary" data-act="timego" ${name === 'timeedit' ? `data-id="${id}"` : ''}>${name === 'timeedit' ? 'Save' : 'Log time'}</button>`); break; }
    case 'timego': { const s = $('#t-s', body).value, e = $('#t-e', body).value, b = +$('#t-b', body).value || 0, d = $('#t-d', body).value; if (!s || !e || e <= s || !d) { $('#t-err', body).textContent = 'End must be after start'; break; } const hrs = ((+e.slice(0, 2)) * 60 + +e.slice(3) - (+s.slice(0, 2)) * 60 - +s.slice(3) - b) / 60;
      commit(() => { const v = { date:d, job:$('#t-j', body).value, start:s, end:e, brk:b, hrs, note:$('#t-n', body).value.trim() }; if (id) Object.assign(D.crew.times.find(x => x.id === id), v, { status:'PENDING' }); else D.crew.times.unshift({ id:'t' + Math.floor(rnd() * 1e6), role:D.crew.role, status:'PENDING', ...v }); logEv('time', `${id ? 'edited' : 'logged'} ${hrs.toFixed(1)} h on ${v.job}`); }, `${hrs.toFixed(1)} h ${id ? 'saved' : 'logged'} · pending approval`); break; }
    case 'approve': { const t = D.crew.times.find(x => x.id === id); commit(() => { t.status = 'APPROVED'; logEv('time', `approved ${t.hrs.toFixed(1)} h on ${t.job}`); }, `${t.hrs.toFixed(1)} h approved`); break; }
    case 'dispute': { const t = D.crew.times.find(x => x.id === id); closeLayer(); dlg('Timesheet', `Dispute ${fmtD(t.date)} · ${t.job}?`, field('Reason', `<textarea id="d-r" rows="3" placeholder="What doesn’t match?"></textarea>`, `${esc(D.crew.first)} is asked to correct or confirm it.`), `${cancelBtn}<button class="btn btn-secondary" style="color:var(--t-out)" data-act="disputego" data-id="${id}">Dispute</button>`); break; }
    case 'disputego': { const t = D.crew.times.find(x => x.id === id), v = $('#d-r', body).value.trim(); commit(() => { t.status = 'DISPUTED'; t.note = v || t.note; logEv('time', `disputed ${t.hrs.toFixed(1)} h on ${t.job}`); }, `${t.hrs.toFixed(1)} h disputed · ${esc(D.crew.first)} is asked to correct it`); break; }
    case 'availadd': case 'availedit': { closeLayer(); const v = name === 'availedit' ? D.crew.avail.find(x => x.id === id) : { type:'UNAVAILABLE', from:addD(TODAY, 14), to:addD(TODAY, 14), reason:'' }; dlg('Availability', name === 'availedit' ? 'Edit block' : 'Add availability block', `<div style="display:grid;gap:12px">${field('Type', `<select id="v-t">${opt('UNAVAILABLE', 'Unavailable', v.type)}${opt('TENTATIVE', 'Tentative', v.type)}${opt('PREFERRED', 'Preferred', v.type)}</select>`)}<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${field('Start date *', `<input id="v-f" type="date" value="${v.from}">`)}${field('End date *', `<input id="v-e" type="date" value="${v.to}">`)}</div>${field('Reason', `<input id="v-r" value="${esc(v.reason)}">`)}<span class="errm" id="v-err"></span></div>`, `${cancelBtn}<button class="btn btn-primary" data-act="availgo" ${name === 'availedit' ? `data-id="${id}"` : ''}>${name === 'availedit' ? 'Save' : 'Add block'}</button>`); break; }
    case 'availgo': { const f = $('#v-f', body).value, e = $('#v-e', body).value; if (!f || !e || e < f) { $('#v-err', body).textContent = 'End date cannot be before the start date'; break; } commit(() => { const v = { type:$('#v-t', body).value, from:f, to:e, reason:$('#v-r', body).value.trim() }; if (id) Object.assign(D.crew.avail.find(x => x.id === id), v); else D.crew.avail.push({ id:'v' + Math.floor(rnd() * 1e6), ...v }); logEv('change', `${id ? 'edited' : 'added'} an availability block ${range(f, e)}`); }, `Block ${range(f, e)} ${id ? 'saved' : 'added'}`); break; }
    case 'feed': closeLayer(); dlg('Calendar', 'Calendar feed', `<div class="t-small muted" style="line-height:1.5;margin-bottom:10px">Subscribe from Google Calendar, Apple Calendar or Outlook. The feed lists ${esc(D.crew.first)}’s confirmed calls.</div>${field('Feed URL', `<input id="f-u" readonly value="https://flow.rvlt.app/api/crew/calendar/${D.crew.ical.token}" class="mono" style="font-size:12px">`)}<div class="swrow" data-act="feedtog" style="margin-top:10px"><span class="sw ${D.crew.ical.tentative ? 'on' : ''}"><i></i></span><span>Include unconfirmed calls <span class="muted t-small">· marked tentative</span></span></div>`, `<button class="lnk muted" data-act="feedregen">Regenerate link</button><div style="flex:1"></div>${cancelBtn}<button class="btn btn-primary" data-act="feedcopy">Copy link</button>`); break;
    case 'feedcopy': closeLayer(); toast('Feed link copied'); break;
    case 'feedtog': { const undo = snapshot(); D.crew.ical.tentative = !D.crew.ical.tentative; act('feed', document.body); toast(D.crew.ical.tentative ? 'Unconfirmed calls now appear as tentative' : 'Only confirmed calls appear', undo); break; }
    case 'feedregen': { const undo = snapshot(); D.crew.ical.token = 'r' + Math.floor(rnd() * 9e5 + 1e5); act('feed', document.body); toast('New link generated · the old one stops working', undo); break; }
    case 'exportcsv': closeLayer(); toast(`Timesheets for ${esc(crewName())} exported · ${D.crew.times.length} rows`); break;
    case 'inactive': { closeLayer(); const up = D.crew.calls.filter(c => c.date >= TODAY && c.state !== 'DECLINED'); confirmDlg('Make inactive', `Make ${esc(crewName())} inactive?`, `They stop appearing in the planner and in new offers. Nothing is deleted:<ul><li>${plural(up.length, 'upcoming call')} (${up.map(c => esc(c.job)).join(', ')}) stay until someone reassigns them.</li><li>${plural(D.crew.times.length, 'timesheet')} and ${plural(pendingTimes().length, 'pending approval', 'pending approvals')} stay.</li><li>Reactivate from this page at any time.</li></ul>`, 'inactivego', 'Make inactive'); break; }
    case 'inactivego': commit(() => { D.crew.status = 'INACTIVE'; logEv('change', 'set the status to Inactive'); }, `${esc(crewName())} is inactive · ${plural(D.crew.calls.filter(c => c.date >= TODAY && c.state !== 'DECLINED').length, 'upcoming call')} stay`); break;
    case 'deletecrew': closeLayer(); confirmDlg('Delete', `Delete ${esc(crewName())}?`, `Removes them from the roster for good. Past calls and timesheets stay on their jobs but are no longer linked to a person.<br><br>This cannot be undone. If you only want to stop offering them work, make them inactive instead.`, 'deletecrewgo', 'Delete crew member'); break;
    case 'deletecrewgo': closeLayer(); toast(`${esc(crewName())} deleted · opens the Crew list`); break;
    // ---- supplier / order
    case 'openorder': { setRec('order', id); if (el.dataset.then === 'extend') act('extend', document.body); else if (el.dataset.then === 'return') act('markret', document.body); break; }
    case 'openorderbynum': { const o = D.orders.find(x => x.num === el.dataset.v); setRec('order', o.id); break; }
    case 'delsup': closeLayer(); if (D.orders.length) { dlg('Delete', `Delete ${esc(D.supplier.name)}?`, `<div class="t-small" style="line-height:1.55">${plural(D.orders.length, 'order')} are attached, so it cannot be deleted. Archive it instead: it leaves the pickers and keeps its spend and history.</div>`, `${cancelBtn}<button class="btn btn-primary" data-act="archive">Archive instead…</button>`); } break;
    case 'printlabel': closeLayer(); toast('Label printed'); break;
    case 'extend': { const o = order(); closeLayer(); dlg('Sub-hire', `Extend hire on ${esc(o.num)}`, `${field('New return date', `<input id="x-d" type="date" value="${o.job === '#2341' ? '2026-11-15' : addD(o.rdue || TODAY, 3)}">`, `Currently due ${fmtDY(o.rdue)}${lateDays(o) ? ` · ${lateDays(o)}d overdue` : ''}. Tell ${esc(o.supplier)} before you save: the supplier may charge for the extra days.`)}`, `${cancelBtn}<button class="btn btn-primary" data-act="extendgo">Extend hire</button>`); break; }
    case 'extendgo': { const v = $('#x-d', body).value, o = order(); if (!v || v < o.odate) break; commit(() => { o.rdue = v; o.events.unshift(mkEv(TODAY + ' 09:41', 'Jayden Cole', `extended the return to ${fmtD(v)}`, 'status')); }, `Hire extended to ${fmtD(v)} · ${esc(o.num)} is no longer overdue`); break; }
    case 'markret': { const o = order(); closeLayer(); dlg('Sub-hire', `Mark ${esc(o.num)} returned`, `${field('Returned on', `<input id="r-d" type="date" value="${TODAY}">`, `${plural(units(o), 'unit')} go back to ${esc(o.supplier)}. The order closes and the sub-hire cover on ${esc(o.job || 'the job')} ends.`)}`, `${cancelBtn}<button class="btn btn-primary" data-act="markretgo">Mark returned</button>`); break; }
    case 'markretgo': { const v = $('#r-d', body).value || TODAY, o = order(); commit(() => { o.returned = v; o.events.unshift(mkEv(TODAY + ' 09:41', 'Jayden Cole', `recorded the return of ${units(o)} units`, 'status')); }, `${esc(o.num)} returned · ${plural(units(o), 'unit')} back with ${esc(o.supplier)}`); break; }
    case 'receive': { const o = order(); closeLayer(); confirmDlg('Receive', `Receive the gear on ${esc(o.num)}?`, `Marks ${plural(units(o), 'unit')} received today. A sub-hire becomes On hire and its return date starts counting.`, 'receivego', 'Receive', '', false); break; }
    case 'receivego': { const o = order(); commit(() => { o.status = 'RECEIVED'; o.received = TODAY; o.events.unshift(mkEv(TODAY + ' 09:41', 'Jayden Cole', `received ${units(o)} units`, 'status')); }, `${esc(o.num)} received · now on hire`); break; }
    case 'dupord': { closeLayer(); const undo = snapshot(), o = order(), n = JSON.parse(JSON.stringify(o)); n.id = 'o' + (40 + D.orders.length); n.num = nextOrderNum(); n.status = 'DRAFT'; n.received = null; n.returned = null; n.invoice = null; n.files = []; n.odate = TODAY; n.events = [mkEv(TODAY + ' 09:41', 'Jayden Cole', `copied from ${o.num}`, 'status')]; D.orders.unshift(n); render(); toast(`${esc(n.num)} created as a draft copy of ${esc(o.num)} · lines kept, files and dates not`, undo); break; }
    case 'delorder': { const o = order(); closeLayer(); if (onHire(o)) dlg('Delete', `Delete ${esc(o.num)}?`, `<div class="t-small" style="line-height:1.55">${plural(units(o), 'unit')} are still on hire. Mark the order returned first, then delete it.</div>`, `${cancelBtn}<button class="btn btn-primary" data-act="markret">Mark returned…</button>`); else confirmDlg('Delete', `Delete ${esc(o.num)}?`, `Deletes the order, its ${plural(o.lines.length, 'line')} and ${plural(o.files.length, 'file')}.${o.job ? ` Sub-hire cover on ${esc(o.job)} is released.` : ''} Spend on ${esc(o.supplier)} drops by ${money(ordTotal(o))}. Undo is offered right after.`, 'delordergo', 'Delete order'); break; }
    case 'delordergo': { const o = order(), undo = snapshot(); D.orders = D.orders.filter(x => x.id !== o.id); setRec('supplier'); toast(`${esc(o.num)} deleted`, undo); break; }
    case 'lineadd': case 'lineedit': { closeLayer(); const l = name === 'lineedit' ? order().lines.find(x => x.id === id) : { desc:'', qty:1, unit:'' }; dlg('Lines', name === 'lineedit' ? 'Edit line' : 'Add a line', `<div style="display:grid;gap:12px">${field('Description *', `<input id="l-d" value="${esc(l.desc)}" placeholder="e.g. Stage deck 2 × 1 m">`)}<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${field('Quantity', `<input id="l-q" inputmode="numeric" value="${l.qty}">`)}${field('Unit price ($)', `<input id="l-u" inputmode="decimal" value="${fv(l.unit)}">`)}</div><span class="errm" id="l-err"></span></div>`, `${cancelBtn}<button class="btn btn-primary" data-act="linego" ${name === 'lineedit' ? `data-id="${id}"` : ''}>${name === 'lineedit' ? 'Save' : 'Add line'}</button>`); break; }
    case 'linego': { const d = $('#l-d', body).value.trim(), q = Math.round(+$('#l-q', body).value), u = +$('#l-u', body).value; if (!d) { $('#l-err', body).textContent = 'Description is required'; break; } if (!(q >= 1) || isNaN(u) || u < 0 || $('#l-u', body).value.trim() === '') { $('#l-err', body).textContent = 'Quantity 1 or more, and a unit price of 0 or more'; break; } commit(() => { const o = order(); if (id) Object.assign(o.lines.find(x => x.id === id), { desc:d, qty:q, unit:u }); else o.lines.push({ id:'l' + Math.floor(rnd() * 1e6), desc:d, qty:q, unit:u }); o.events.unshift(mkEv(TODAY + ' 09:41', 'Jayden Cole', `${id ? 'edited' : 'added'} the line ${d}`, 'status')); }, `${esc(d)} ${id ? 'saved' : 'added'} · total ${money(ordTotal(order()))}`); break; }
  }
}
function bulk(v) {
  const s = selItems(), n = s.length;
  switch (v) {
    case 'copyjobs': closeLayer(); toast(`${n} job numbers copied`); break;
    case 'exportjobs': case 'exportorders': case 'exportsub': closeLayer(); toast(`${n} rows exported to CSV`); break;
    case 'download': case 'pdfs': closeLayer(); toast(`Downloading ${n} ${v === 'pdfs' ? 'PDFs' : 'files'}`); break;
    case 'labels': closeLayer(); toast(`Label sheet for ${n} assets · opens the print dialog`); break;
    case 'remind': { const u = s.filter(m => m.kind === 'Invoice' && m.status === 'Issued'); closeLayer(); u.forEach(m => logEv('money', `sent a payment reminder for ${m.num}`)); clearSel(); render(); toast(`${plural(u.length, 'reminder')} sent${u.length < n ? ` · ${n - u.length} not unpaid invoices, skipped` : ''}`); break; }
    case 'resend': { const o = s.filter(c => c.state === 'OFFERED' || c.state === 'DECLINED'); closeLayer(); o.forEach(c => { c.state = 'OFFERED'; c.offered = TODAY; logEv('call', `sent an offer for ${c.job} ${c.label} by SMS`); }); clearSel(); render(); toast(`${plural(o.length, 'offer')} sent to ${esc(D.crew.first)} by SMS${o.length < n ? ` · ${n - o.length} already confirmed, skipped` : ''}`); break; }
    case 'confirm': { const f = s.filter(c => c.state === 'OFFERED'); commit(() => { f.forEach(c => { const x = D.crew.calls.find(y => y.id === c.id); x.state = 'CONFIRMED'; }); logEv('call', `marked ${f.length} calls confirmed`); clearSel(); }, `${f.length} calls marked confirmed${f.length < n ? ` · ${n - f.length} were not waiting on a yes` : ''}`); break; }
    case 'approve': { const p = s.filter(t => t.status !== 'APPROVED'); commit(() => { p.forEach(t => D.crew.times.find(y => y.id === t.id).status = 'APPROVED'); logEv('time', `approved ${plural(p.length, 'timesheet')} · ${p.reduce((a, t) => a + t.hrs, 0).toFixed(1)} h`); clearSel(); }, `${plural(p.length, 'timesheet')} approved · ${p.reduce((a, t) => a + t.hrs, 0).toFixed(1)} h${p.length < n ? ` · ${n - p.length} already approved` : ''}`); break; }
  }
}
// ---------- input handling
document.addEventListener('input', ev => {
  const t = ev.target;
  if (state.sheet && t.dataset && t.dataset.f) { const s = state.sheet; s.draft[t.dataset.f] = t.value; s.dirty = true; const m = $('#dirtymsg'); if (m) m.textContent = 'Unsaved changes'; if (s.errs && s.errs[t.dataset.f]) { delete s.errs[t.dataset.f]; t.removeAttribute('aria-invalid'); const em = t.parentElement.querySelector('.errm'); if (em) em.remove(); } }
});
document.addEventListener('change', ev => { const t = ev.target; if (state.sheet && t.dataset && t.dataset.f && t.tagName === 'SELECT') { state.sheet.draft[t.dataset.f] = t.value; state.sheet.dirty = true; if (t.dataset.dep) rerenderSheet(); else { const m = $('#dirtymsg'); if (m) m.textContent = 'Unsaved changes'; } } });
document.addEventListener('keydown', ev => {
  if ((ev.key === 'n' || ev.key === 'N') && !ev.metaKey && !ev.ctrlKey && !ev.target.matches('input,textarea,select')) ev.preventDefault();
  if (ev.key === 'Escape' && state.sheet && state.sheet.dirty && layer.classList.contains('open') && !$('.dlg', body)) { ev.stopImmediatePropagation(); act('close', document.body); return; }
  if (ev.key === 'Enter' && ev.target.id === 'note') { ev.preventDefault(); act('post', document.body); }
  if (ev.key === 'Enter' && ev.target.matches && ev.target.matches('.esheet input[data-f]')) ev.preventDefault();
}, true);
// ---------- boot
(function boot() {
  try { const h = location.hash.replace('#', '').split('/'); if (['client', 'crew', 'supplier', 'order'].includes(h[0])) { state.rec = h[0]; if (h[0] === 'order') { const o = D.orders.find(x => x.num === h[1]); if (o) state.orderId = o.id; if (h[2] && validTab('order', h[2])) state.tab = h[2]; } else if (h[1] && validTab(h[0], h[1])) state.tab = h[1]; } const q = new URLSearchParams(location.search); if (q.get('edit') === '1') state.openEdit = true; } catch (e) { /* no URL access */ }
  shellInit(); render();
  if (state.openEdit) openEdit(state.rec, 'edit', state.rec === 'order' ? state.orderId : undefined);
})();
