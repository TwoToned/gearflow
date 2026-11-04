// ---------- Gear lists · data (Models, Kits, Locations, Maintenance, Test & tag, Sales stock, Overbookings)
const TODAY = '2026-11-09';
const U = { eq:'https://claude.ai/artifact/BdwR4bNbiNMLSvfRAByEwC', ov:'https://claude.ai/artifact/RatKsWfTmDJLJHmn6mb7Zo', jobs:'https://claude.ai/artifact/A7SMPtpTr3aedUDEnuSaxd', assets:'https://claude.ai/artifact/89PDTuMiovgP9i3h4MJ1Tw', logi:'https://claude.ai/artifact/E36tnBkGL9obdikUQ5mbXf', wh:'https://claude.ai/artifact/Mt8p55xkPkkexVWPC5eaGU', model:'https://claude.ai/artifact/47miWruJVsednbzrFPij2b', asset:'https://claude.ai/artifact/Rr5rwirCUMRy8gf5G6Vz7s', scan:'https://claude.ai/artifact/8Q2HVoRhLbSLz1Q9mCtayX', home:'https://claude.ai/artifact/3d6zqfosL5hYRvXLBYLnhR', fin:'https://claude.ai/artifact/5VnYTVW2pdA5r1qBRvdrom', plan:'https://claude.ai/artifact/AKkgWzJ2gVR3dJTWnMB2Ui', people:'https://claude.ai/artifact/LPdsNGb4CRMfS6qk7j7Fsa', floor:'https://claude.ai/artifact/6xqFcEZZk49w86p5pAsisA' };
const jobUrl = n => n === '#2341' ? U.eq : U.ov;
const rnd = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(11);
const pick = a => a[Math.floor(rnd() * a.length)];
const addD = (d, n) => new Date((dayNum(d) + n) * 864e5).toISOString().slice(0,10);
const daysTo = d => dayNum(d) - dayNum(TODAY);
const PEOPLE = ['Jayden Cole', 'Sam Okafor', 'Tom Nguyen', 'Mel Torres'], TECH = ['Sam Okafor', 'Tom Nguyen', 'SafeTest Co'];
const JOBN = { '#2341':'Hilton Sydney gala dinner', '#2338':'Corporate AGM', '#2340':'Launch night', '#2350':'Qantas awards', '#2352':'Westpac Christmas party' };
const D = { models:[], kits:[], locations:[], maintenance:[], tt:[], sales:[], overbookings:[] };
let uid = 0; const nid = p => p + (uid++);

// Models
// [name, category, manufacturer, type, owned, unit value, day rate, code]
[['Martin MAC Aura XB','Lighting','Martin','S',8,3200,95,'AURA'],['Martin MAC Aura PXL','Lighting','Martin','S',6,4100,140,'L'],['Robe T1 Profile','Lighting','Robe','S',6,7900,120,'T1'],['Chauvet COLORado Panel Q40','Lighting','Chauvet','S',12,900,60,'CLRD'],['GrandMA3 light','Lighting','MA Lighting','S',1,29000,650,'MA3'],
 ['d&b Y8','Audio','d&b audiotechnik','S',16,4100,85,'Y8'],['d&b Y10P','Audio','d&b audiotechnik','S',8,5600,110,'Y10P'],['Sennheiser EW-DX SK beltpack','Audio','Sennheiser','S',24,1100,45,'SK'],['Sennheiser EM4 receiver','Audio','Sennheiser','S',6,3600,180,'A'],['Shure ULXD4Q','Audio','Shure','S',6,4200,160,'ULXD'],['Yamaha QL5','Audio','Yamaha','S',2,9800,320,'QL5'],['Shure SM58','Audio','Shure','S',30,190,12,'SM58'],
 ['Barco UDX-4K32','Video','Barco','S',3,68000,1800,'V'],['Absen PL2.5 panel','Video','Absen','S',80,1400,45,'PL25'],['Blackmagic ATEM 2 M/E','Video','Blackmagic','S',3,6200,260,'ATEM'],
 ['CM Lodestar 1T','Rigging','Columbus McKinnon','S',24,2400,40,'LODE'],['Prolyte H30V 3m','Rigging','Prolyte','S',60,420,18,'H30V'],
 ['XLR 10m','Cable','Generic','B',120,32,3,'XLR10'],['Socapex 20m','Cable','Generic','B',40,210,14,'SOCA20'],['Powercon 5m','Cable','Generic','B',60,28,3,'PC5'],['Steeldeck 2×1','Staging','Steeldeck','B',90,380,22,'SD21'],
 ['Martin MAC 700 Profile','Lighting','Martin','S',4,6100,0,'M700','arch'],['Chauvet Rogue R2','Lighting','Chauvet','S',6,1900,0,'R2','arch']].forEach(([name,cat,mfr,type,owned,unit,day,code,arch]) => {
  const out = Math.floor(rnd() * owned * (type === 'B' ? .4 : .45)), maint = type === 'S' && rnd() < .3 ? 1 : 0;
  const rates = rnd() < .9 ? 3 : 2;
  D.models.push({ id:nid('m'), name, cat, mfr, type, owned, out, maint, unit, day, week: rates >= 2 ? Math.round(day * 3.2) : null, month: rates >= 3 ? Math.round(day * 9) : null, code, dueTT: cat === 'Rigging' || cat === 'Staging' ? 0 : Math.floor(rnd() * 3), roi: Math.round(45 + rnd() * 260), tags: rnd() < .15 ? ['touring'] : [], acc: Math.floor(rnd() * 4), archived: !!arch });
});
const mdl = n => D.models.find(m => m.name === n);
Object.assign(mdl('Martin MAC Aura XB'), { owned:8, out:3, maint:1, dueTT:2, roi:214, day:95, week:304, month:855, acc:2 });
Object.assign(mdl('Martin MAC Aura PXL'), { owned:6, out:6, maint:0, dueTT:1, roi:188, day:140, week:448, month:1260, acc:3 });
Object.assign(mdl('Sennheiser EW-DX SK beltpack'), { owned:24, out:10, maint:1, dueTT:3, week:144, month:405 });
Object.assign(mdl('d&b Y8'), { owned:16, out:12, maint:0, dueTT:0, roi:241 });
Object.assign(mdl('Barco UDX-4K32'), { owned:3, out:2, maint:1, week:5760, month:16200 });
Object.assign(mdl('Sennheiser EM4 receiver'), { week:null });
Object.assign(mdl('Yamaha QL5'), { out:0, maint:0, roi:96 });
for (const m of D.models) { m.out = Math.min(m.out, m.owned - m.maint); }
const avail = m => m.owned - m.out - m.maint;

// Kits [tag, name, category, models, items, missing(which), job, location, value, condition]
[['K-0042','Shure ULXD4Q wireless kit','Audio',4,9,'PA805 antenna distribution','#2341','On job',38600,'Good'],['K-0017','Lighting touring pack','Lighting',3,14,'','#2341','On job',61200,'Good'],['K-0021','Video flypack','Video',5,11,'','','Warehouse A › B2',94300,'Good'],['K-0033','FOH audio rack','Audio',4,8,'','','Warehouse A › A3-14',52800,'Good'],['K-0008','Power distro 63A','Power',2,6,'','#2350','On job',14100,'Fair'],['K-0051','Comms kit (Clear-Com)','Comms',3,10,'Spare beltpack battery','','Warehouse A › C4',17900,'Good'],['K-0029','Foldback pack','Audio',3,12,'','','Warehouse A › A3-14',21700,'Good'],['K-0003','Truss starter 6 m','Rigging',2,16,'','','Warehouse B',9400,'Good'],['K-0060','Lectern & confidence pack','Audio',3,7,'Goose-neck mic','','Warehouse A › A1',6800,'Fair'],['K-0014','LED wash pack (8×)','Lighting',1,10,'','#2340','On job',28900,'Good'],['K-0072','Streaming desk','Video',4,9,'','','Warehouse A › B2',31200,'Good'],['K-0002','Backline starter','Audio',3,13,'','','Warehouse B',12400,'Poor'],['K-0009','Old strobe case','Lighting',1,4,'','','Warehouse B',1200,'Poor','arch']].forEach(([tag,name,cat,models,items,missing,job,loc,value,cond,arch]) => D.kits.push({ id:nid('k'), tag, name, cat, models, items, missing, job, loc, value, cond, tags: tag === 'K-0042' ? ['wireless'] : [], archived:!!arch }));

// Locations [name, type, parent, assets, capacity, lastMove(date,time,who), address, note]
[['Warehouse A','WAREHOUSE','',412,600,['2026-11-09','08:12','Sam Okafor'],'14 Bourke Rd, Alexandria NSW',''],['B2','WAREHOUSE','Warehouse A',38,60,['2026-11-09','07:55','Sam Okafor'],'',''],['A3-14','WAREHOUSE','Warehouse A',24,40,['2026-11-06','16:40','Tom Nguyen'],'',''],['A1','WAREHOUSE','Warehouse A',17,40,['2026-11-05','11:02','Sam Okafor'],'',''],['C4','WAREHOUSE','Warehouse A',9,30,['2026-10-29','09:30','Tom Nguyen'],'',''],['Repair bench','WAREHOUSE','Warehouse A',6,12,['2026-11-09','08:30','Tom Nguyen'],'',''],['Warehouse B','WAREHOUSE','',88,200,['2026-11-03','14:15','Sam Okafor'],'Unit 4, 22 Dunning Ave, Rosebery NSW',''],['Van 1','VEHICLE','',0,80,['2026-11-04','17:48','Sam Okafor'],'Rego DX 41 TT',''],['Van 2','VEHICLE','',0,80,['2026-11-04','17:20','Tom Nguyen'],'Rego DX 77 TT','loads Tue 11 Nov 06:30 for #2341'],['Truck 3','VEHICLE','',54,300,['2026-11-02','06:10','Sam Okafor'],'Rego CM 02 QT',''],['Hilton Sydney · Grand Ballroom','VENUE','',0,null,['2026-10-21','10:00','Jayden Cole'],'488 George St, Sydney NSW','bumps in Wed 12 Nov'],['Qantas HQ · Mascot','VENUE','',0,null,['2026-09-18','12:30','Tom Nguyen'],'10 Bourke Rd, Mascot NSW',''],['Scene Change yard','OFFSITE','',6,null,['2026-11-05','13:05','Tom Nguyen'],'Marrickville NSW','sub-hire returns'],['Old store room','WAREHOUSE','',0,20,['2025-08-14','10:00','Sam Okafor'],'','','arch']].forEach(([name,type,parent,assets,cap,lm,addr,note,arch]) => D.locations.push({ id:nid('l'), name, type, parent, assets, cap, lm, addr, note, tags:[], archived:!!arch }));
// Maintenance
const MTYPE = { REPAIR:'Repair', PREVENTATIVE:'Preventative', TEST_AND_TAG:'Test & tag', INSPECTION:'Inspection', CLEANING:'Cleaning', FIRMWARE_UPDATE:'Firmware update' };
const MSTAT = { SCHEDULED:['Scheduled',''], AWAITING_PARTS:['Awaiting parts','warn'], IN_PROGRESS:['In progress','info'], QA:['QA','info'], COMPLETED:['Completed','ok'], CANCELLED:['Cancelled',''] };
const M = (asset, model, title, type, status, due, assigned, cost, by, extra) => D.maintenance.push({ id:nid('mt'), src:'record', asset, model, title, type, status, due, done:null, assigned, cost, by, result:'', tags:[], ...(extra||{}) });
M('AURA-06','Martin MAC Aura XB','Fan fault, overheats after 20 min','REPAIR','AWAITING_PARTS','2026-11-07','Tom Nguyen',240,'Sam Okafor');
M('L-0004','Martin MAC Aura PXL','Gobo wheel jams on cue 4','REPAIR','IN_PROGRESS','2026-11-11','Sam Okafor',0,'Jayden Cole');
M('SK-0012','Sennheiser EW-DX SK beltpack','Battery door cracked','REPAIR','SCHEDULED','2026-11-12','Tom Nguyen',35,'Sam Okafor');
M('AURA-06','Martin MAC Aura XB','Retest after repair','TEST_AND_TAG','SCHEDULED','2026-11-13','Tom Nguyen',0,'Tom Nguyen');
M('V-0011','Barco UDX-4K32','Lamp hours past 2,000 · service','PREVENTATIVE','SCHEDULED','2026-11-24','Barco AU (external)',1850,'Mel Torres');
M('A-0302','Sennheiser EM4 receiver','Antenna BNC loose, intermittent RF','REPAIR','IN_PROGRESS','2026-11-10','Sam Okafor',60,'Sam Okafor');
M('QL5-01','Yamaha QL5','Firmware 8.1 update','FIRMWARE_UPDATE','COMPLETED','2026-11-06','Tom Nguyen',0,'Tom Nguyen',{ done:'2026-11-06', result:'PASS' });
M('Y8-09','d&b Y8','Grille dent, driver check','INSPECTION','COMPLETED','2026-11-04','Sam Okafor',0,'Sam Okafor',{ done:'2026-11-04', result:'CONDITIONAL' });
M('ATEM-02','Blackmagic ATEM 2 M/E','HDMI port 3 dead','REPAIR','AWAITING_PARTS','2026-11-05','Tom Nguyen',190,'Jayden Cole');
M('T1-03','Robe T1 Profile','Lamp swap and clean','PREVENTATIVE','QA','2026-11-09','Sam Okafor',320,'Sam Okafor');
M('PL25-41','Absen PL2.5 panel','Module 3 dead pixels','REPAIR','SCHEDULED','2026-11-17','Tom Nguyen',140,'Sam Okafor');
for (const [a, mo, t, ty, st, d, who, c] of [['Y10P-04','d&b Y10P','Rigging points inspection','INSPECTION','SCHEDULED',addD(TODAY,6),'Sam Okafor',0],['CLRD-07','Chauvet COLORado Panel Q40','Deep clean, optics','CLEANING','SCHEDULED',addD(TODAY,9),'Tom Nguyen',0],['MA3-01','GrandMA3 light','Firmware 2.1 update','FIRMWARE_UPDATE','SCHEDULED',addD(TODAY,14),'Tom Nguyen',0],['ULXD-02','Shure ULXD4Q','Fan noise at 60%','REPAIR','IN_PROGRESS',addD(TODAY,2),'Sam Okafor',85],['SM58-11','Shure SM58','Grille replace x6','REPAIR','COMPLETED',addD(TODAY,-8),'Tom Nguyen',54],['T1-05','Robe T1 Profile','Pan belt tension','PREVENTATIVE','COMPLETED',addD(TODAY,-12),'Sam Okafor',0],['H30V-18','Prolyte H30V 3m','Bent chord, quarantine','REPAIR','CANCELLED',addD(TODAY,-4),'Tom Nguyen',0],['AURA-05','Martin MAC Aura XB','Zoom motor stalls','REPAIR','AWAITING_PARTS',addD(TODAY,-3),'Tom Nguyen',410],['L-0008','Martin MAC Aura PXL','Pixel ring dead segment','REPAIR','SCHEDULED',addD(TODAY,4),'Sam Okafor',0],['SK-0031','Sennheiser EW-DX SK beltpack','Charge contacts corroded','REPAIR','SCHEDULED',addD(TODAY,7),'Tom Nguyen',22]]) {
  const done = st === 'COMPLETED' ? d : null; M(a, mo, t, ty, st, d, who, c, pick(PEOPLE), done ? { done, result: pick(['PASS','PASS','PASS','CONDITIONAL']) } : {});
}
const S = (title, model, every, total, checked, due, assigned) => D.maintenance.push({ id:nid('mt'), src:'schedule', asset:'', model, title, type:'PREVENTATIVE', status:'SCHEDULED', due, done:null, assigned, cost:0, by:'Schedule', result:'', tags:[], every, total, checked });
S('Annual hoist inspection','CM Lodestar 1T','every 12 months',24,9,'2026-11-02','Sam Okafor');
S('Hazer service','Hazer (Unique 2.1)','every 90 days',4,4,'2026-11-18','Tom Nguyen');
S('Truss quarterly inspection','Prolyte H30V 3m','every 3 months',60,0,'2026-11-30','Sam Okafor');
S('Battery cycle test','Sennheiser EW-DX SK beltpack','every 6 months',24,16,'2026-11-08','Tom Nguyen');
const mOpen = r => r.status !== 'COMPLETED' && r.status !== 'CANCELLED';
const mOverdue = r => mOpen(r) && r.due < TODAY;

// Test & tag [asset tag, model, class, lastTest, result, intervalDays, tester, kind]
const T = (tag, model, cls, last, result, every, tester, extra) => D.tt.push({ id:nid('tt'), ttid:'TT-' + String(400 + D.tt.length).padStart(4,'0'), tag, model, cls, last, result, next: addD(last, every), tester, kind:'S', booked:null, ...(extra||{}) });
T('AURA-01','Martin MAC Aura XB','I','2025-11-19','PASS',365,'Sam Okafor');
T('L-0007','Martin MAC Aura PXL','I','2026-11-03','FAIL',365,'Tom Nguyen',{ note:'Earth continuity fail' });
T('AURA-02','Martin MAC Aura XB','I','2025-10-22','PASS',365,'Sam Okafor');
T('SK-0012','Sennheiser EW-DX SK beltpack','II','2026-05-30','PASS',180,'Tom Nguyen');
T('V-0011','Barco UDX-4K32','I','2026-03-11','PASS',365,'SafeTest Co');
T('XLR10','XLR 10m','II','2026-06-14','PASS',180,'Tom Nguyen',{ kind:'B', qty:120 });
T('SOCA20','Socapex 20m','I','2026-08-20','PASS',180,'Sam Okafor',{ kind:'B', qty:40 });
for (const [m, code, n] of [['Martin MAC Aura XB','AURA',6],['Martin MAC Aura PXL','L',5],['Robe T1 Profile','T1',4],['d&b Y8','Y8',5],['Shure ULXD4Q','ULXD',3],['Sennheiser EM4 receiver','A',3]]) for (let i = 3; i < 3 + n; i++) {
  const iv = pick([180, 365, 365]); const lastOff = -Math.floor(rnd() * (iv + 20)); const last = addD(TODAY, lastOff);
  T(code === 'L' || code === 'A' ? `${code}-${String(i * 3 + 1).padStart(4,'0')}` : `${code}-${String(i).padStart(2,'0')}`, m, pick(['I','I','II']), last, rnd() < .04 ? 'FAIL' : 'PASS', iv, pick(TECH));
}
D.tt = D.tt.filter((r, i, a) => a.findIndex(x => x.tag === r.tag) === i);
const ttOverdue = r => r.next < TODAY, ttDue = r => daysTo(r.next) <= 30;

// Sales stock [name, category, sku, price, onHand, reserved, reorderAt, resFor, supplier]
[['Gaffer tape black 48mm','Consumables','GT-48B',24,0,12,20,'#2341','Big Picture'],['Duracell AA 24-pack','Batteries','BAT-AA24',38,6,2,12,'','Big Picture'],['Duracell 9V 12-pack','Batteries','BAT-9V12',46,18,0,8,'',''],['Lee 201 gel sheet','Gels','GEL-L201',16,34,6,12,'#2350',''],['Lee 202 gel sheet','Gels','GEL-L202',16,9,0,12,'',''],['Cable ties 200mm ×100','Consumables','CT-200',9,48,0,15,'',''],['Velcro tape 25m','Consumables','VT-25',22,14,0,6,'',''],['Fog fluid 5L','Effects','FOG-5L',45,0,0,6,'','Scene Change'],['Haze fluid 5L','Effects','HAZ-5L',52,3,2,6,'#2340','Scene Change'],['Pro-tape white 24mm','Consumables','PT-24W',14,22,0,10,'',''],['Neutrik XLR female','Connectors','NC3FXX',8,120,0,40,'',''],['Neutrik XLR male','Connectors','NC3MXX',8,64,0,40,'',''],['Powercon 20A inline','Connectors','NAC3FCA',19,5,0,12,'',''],['Glow tape 25mm ×10m','Consumables','GLO-25',31,11,0,5,'#2341',''],['Earplugs (50 pairs)','Safety','EP-50',29,7,0,4,'',''],['Lens wipes ×200','Consumables','LW-200',18,26,0,8,'','']].forEach(([name,cat,sku,price,onHand,reserved,reorder,resFor,sup]) => D.sales.push({ id:nid('s'), name, cat, sku, price, onHand, reserved, reorder, resFor, sup, onOrder:0, archived:false }));

// Overbookings [kind, subject, short, unit, jobs, from, to, note]
const O = (kind, subject, short, unit, jobs, from, to, extra) => D.overbookings.push({ id:nid('o'), kind, subject, short, unit, jobs, from, to, sub:null, ...(extra||{}) });
O('gear','Martin MAC Aura PXL',2,'',['#2341','#2350'],'2026-11-13','2026-11-14',{ model:true });
O('gear','Absen PL2.5 panel',12,'',['#2338','#2340'],'2026-11-19','2026-11-21',{ model:true });
O('gear','Barco UDX-4K32',1,'',['#2340','#2338'],'2026-11-20','2026-11-21',{ model:true });
O('pencil','d&b Y8',4,'',['#2340','#2338'],'2026-11-19','2026-11-21',{ model:true });
O('pencil','Sennheiser EW-DX SK beltpack',6,'',['#2350','#2338'],'2026-11-13','2026-11-21',{ model:true });
O('pencil','Shure ULXD4Q',2,'',['#2341'],'2026-11-12','2026-11-14',{ model:true });
O('sale','Gaffer tape black 48mm',12,'',['#2341'],'2026-11-12','2026-11-14');
O('crew','Rigger · install',1,'crew',['#2341'],'2026-11-11','2026-11-12');
O('crew','Dev Patel · unconfirmed',1,'crew',['#2350'],'2026-11-13','2026-11-14');
O('crew','Oli Martin · double-booked',1,'crew',['#2341','#2350'],'2026-11-13','2026-11-14');
O('gear','CM Lodestar 1T',4,'',['#2352'],'2026-12-11','2026-12-12',{ model:true });
O('gear','Prolyte H30V 3m',8,'',['#2352'],'2026-12-11','2026-12-12',{ model:true });
const KIND = { gear:['overbooked','err'], pencil:['pencilled','warn'], sale:['to procure','warn'], crew:['crew','warn'] };
const SUPPLIERS = ['Scene Change','Big Picture','Chameleon Touring'];
// ---------- cell helpers
const dw = (cls, t) => `<span class="dotw ${cls}">${t}</span>`;
const mut = t => `<span class="muted">${t}</span>`;
const mono = t => `<span class="mono" style="font-size:12.5px">${esc(t)}</span>`;
const titleCell = (t, sub, flags) => `<div class="ell"><span class="ttl">${t}</span>${flags ? `<span class="flagrow">${flags}</span>` : ''}</div><div class="sub ell">${sub}</div>`;
const thumbOf = (txt, img) => `<span class="thumb ${img ? 'img' : ''}">${img ? '' : esc(txt.slice(0,2).toUpperCase())}</span>`;
const withThumb = (inner, txt, img) => `<span class="ib" style="gap:10px;min-width:0;width:100%">${thumbOf(txt, img)}<span style="min-width:0;flex:1">${inner}</span></span>`;
const jobLinks = jobs => jobs.map(n => `<a class="lnk" href="${jobUrl(n)}" style="font-weight:500"><span class="mono">${n}</span></a>`).join(' <span class="faint">·</span> ');
const dueW = (d, done) => done ? mut('Done ' + fmtD(done)) : d < TODAY ? dw('err', `${-daysTo(d)}d overdue`) : d === TODAY ? '<b style="font-weight:600">Today</b>' : mut(fmtD(d));
const dateY = d => d.slice(0,4) === TODAY.slice(0,4) ? fmtD(d) : fmtD(d) + ' ' + d.slice(0,4);
const lmWord = lm => (lm[0] === TODAY ? 'Today' : dateY(lm[0])) + ' <span class="mono" style="font-size:12px">' + lm[1] + '</span>';
const TLAB = { WAREHOUSE:'Warehouse', VEHICLE:'Vehicle', VENUE:'Venue', OFFSITE:'Offsite' };
const R = n => n == null ? '<span class="faint">—</span>' : String(n);

const state = { list:'models', seg:'all', q:'', f:{}, sort:'name', dir:'asc', page:0, size:25, selected:new Set(), cols:{}, showArch:false, undo:null, savedView:null, lastSel:null, pending:null };
const L = {};
const cur = () => L[state.list];
const LIST_ORDER = ['models','kits','locations','maintenance','tt','sales','overbookings'];

// ---------- the seven lists (config only; the renderer below is shared)
L.models = {
  key:'models', title:'Models', crumb:'Models', noun:'models', search:'Search name or manufacturer', defSeg:'all', defSort:['name','asc'], base:() => true, hot:null,
  seg:[['all','All',m => !m.archived],['stock','With stock',m => !m.archived && avail(m) > 0],['nostock','No stock',m => !m.archived && avail(m) <= 0],['due','Due for T&T',m => !m.archived && m.dueTT > 0],['arch','Archived',m => m.archived]],
  cols:[
    { k:'name', label:'Model', main:true, sort:m => m.name.toLowerCase(), cell:m => withThumb(titleCell(esc(m.name), `${esc(m.cat)} · ${esc(m.mfr)}`, (m.day && (m.week == null || m.month == null)) ? dw('warn', 'rates incomplete') : ''), m.cat, m.cat !== 'Cable' && m.cat !== 'Rigging') },
    { k:'owned', label:'Owned', w:84, align:'r', sort:m => m.owned, cell:m => String(m.owned) },
    { k:'avail', label:'Available', w:96, align:'r', sort:avail, cell:m => avail(m) <= 0 ? `<span style="color:var(--t-out)">${avail(m)}</span>` : String(avail(m)) },
    { k:'day', label:'Day rate', w:104, align:'r', sort:m => m.day || 0, cell:m => m.day ? money(m.day) : '<span class="faint">—</span>' },
    { k:'value', label:'Value', w:110, align:'r', opt:true, sort:m => m.unit * m.owned, cell:m => money(m.unit * m.owned) },
    { k:'roi', label:'ROI', w:84, align:'r', opt:true, sort:m => m.roi, cell:m => m.roi + '%' },
    { k:'type', label:'Type', w:100, opt:true, sort:m => m.type, cell:m => mut(m.type === 'S' ? 'Serialised' : 'Bulk') },
    { k:'tags', label:'Tags', w:120, opt:true, cell:m => mut(m.tags.join(', ') || '—') },
  ],
  filters:[{ k:'cat', label:'Category', get:m => m.cat, opts:() => uniq(D.models.map(m => m.cat)) }, { k:'type', label:'Type', get:m => m.type === 'S' ? 'Serialised' : 'Bulk', opts:() => ['Serialised','Bulk'] }, { k:'mfr', label:'Manufacturer', get:m => m.mfr, opts:() => uniq(D.models.map(m => m.mfr)) }],
  text:m => [m.name, m.mfr, m.cat, m.code].join(' '),
  views:[{ name:'Lighting with stock', seg:'stock', f:{ cat:['Lighting'] } }, { name:'Incomplete rates', seg:'all', f:{} }],
  href:() => U.model,
  verbs:['rates','acc','checks','archive'],
  rowItems:m => [{ label:'Open', act:'open', args:`data-id="${m.id}"` }, '-', V('rates', 'Edit rates…', m), V('acc', 'Add accessory…', m), V('checks', 'Assign checks…', m), '-', { label:'Duplicate model', act:'noop' }, { label:'Print labels for all', act:'noop' }, '-', m.archived ? V('archive', 'Restore', m) : V('archive', 'Archive…', m, true)],
  pageItems:() => [{ label:'Categories', act:'noop', small:'14' }, '-', { label:'Import models (CSV)…', act:'noop' }, { label:'Import rates (CSV)…', act:'noop' }, { label:'Export this view (CSV)', act:'noop' }, '-', { label:'Columns', act:'colsmenu' }],
  primary:() => ({ label:'+ New model', act:'new' }),
  sub:rows => { const a = rows.filter(m => !m.archived); return `${a.reduce((s, m) => s + m.owned, 0).toLocaleString()} units owned · ${a.reduce((s, m) => s + m.out, 0)} out now · `; },
  phonesub:rows => { const a = rows.filter(m => !m.archived); return `${a.length} models · ${a.reduce((s, m) => s + m.owned, 0)} units · ${a.filter(m => avail(m) <= 0).length} no stock`; },
  card:m => ({ ttl:esc(m.name), sub:`${esc(m.cat)} · ${avail(m)} of ${m.owned} available`, right:m.day ? `<span class="mono" style="font-size:12.5px">${money(m.day)}/day</span>` : '', extra:avail(m) <= 0 && !m.archived ? dw('err', 'no stock') : '' }),
  none:{ t:'No models yet', d:'A model defines a type of gear; assets and bulk stock hang off it.', cta:'New model' },
  segEmpty:{ nostock:['Everything has stock', 'Every model has at least one unit free to book.'], due:['Nothing due for test & tag', 'No model has an asset due or overdue.'], arch:['Nothing archived', 'Archived models keep their history and leave every picker.'] },
  newForm:{ title:'New model', fields:[['Name', '<input data-v="name" placeholder="e.g. Martin MAC Aura XB">'], ['Category', () => `<select data-v="cat">${uniq(D.models.map(m => m.cat)).map(c => opt(c, c)).join('')}</select>`], ['Day rate', '<input data-v="day" inputmode="decimal" placeholder="Leave blank if not priced">']], make:v => ({ id:nid('m'), name:v.name, cat:v.cat, mfr:'—', type:'S', owned:0, out:0, maint:0, unit:0, day:v.day === '' ? null : +v.day, week:null, month:null, code:'NEW', dueTT:0, roi:0, tags:[], acc:0, archived:false }) },
};
L.kits = {
  key:'kits', title:'Kits', crumb:'Kits', noun:'kits', search:'Search kit name or tag', defSeg:'all', defSort:['tag','asc'], hot:'missing',
  base:k => !k.archived || state.showArch,
  seg:[['all','All',() => true],['complete','Complete',k => !k.missing],['missing','Missing items',k => !!k.missing],['onjob','On a job',k => !!k.job]],
  cols:[
    { k:'name', label:'Kit', main:true, sort:k => k.tag, cell:k => withThumb(titleCell(esc(k.name), `${mono(k.tag)} · ${k.models} models · ${esc(k.cat)}`, k.archived ? '<span class="faint">retired</span>' : ''), k.cat, true) },
    { k:'items', label:'Items', w:76, align:'r', sort:k => k.items, cell:k => String(k.items) },
    { k:'complete', label:'Complete', w:190, sort:k => k.missing ? 0 : 1, cell:k => k.missing ? `${dw('err', 'Missing 1')}<div class="sub ell">${esc(k.missing)}</div>` : dw('ok', 'Complete') },
    { k:'job', label:'On job', w:96, sort:k => k.job || 'zzz', cell:k => k.job ? jobLinks([k.job]) : '<span class="faint">—</span>' },
    { k:'loc', label:'Location', w:170, sort:k => k.loc, cell:k => k.job ? '<span class="faint">—</span>' : `<div class="ell">${esc(k.loc)}</div>` },
    { k:'value', label:'Value', w:110, align:'r', opt:true, sort:k => k.value, cell:k => money(k.value) },
    { k:'cond', label:'Condition', w:100, opt:true, sort:k => k.cond, cell:k => k.cond === 'Poor' ? dw('warn', 'Poor') : mut(k.cond) },
    { k:'tags', label:'Tags', w:110, opt:true, cell:k => mut(k.tags.join(', ') || '—') },
  ],
  filters:[{ k:'cat', label:'Category', get:k => k.cat, opts:() => uniq(D.kits.map(k => k.cat)) }, { k:'cond', label:'Condition', get:k => k.cond, opts:() => ['Good','Fair','Poor'] }],
  text:k => [k.name, k.tag, k.cat, k.job].join(' '),
  views:[{ name:'Kits to fix before Wed', seg:'missing', f:{} }],
  href:() => null,
  verbs:['dup','kprint','kreturn','archive'],
  rowItems:k => [{ label:'Open', act:'open', args:`data-id="${k.id}"` }, ...(k.job ? [{ label:`Job ${k.job}`, href:jobUrl(k.job), small:'Equipment' }] : []), '-', V('dup', 'Duplicate…', k), V('kprint', 'Print list', k), ...(k.job ? [V('kreturn', 'Force return', k)] : []), '-', k.archived ? V('archive', 'Reinstate', k) : V('archive', 'Archive…', k, true)],
  pageItems:() => [{ label:'Print kit lists for this view', act:'noop' }, { label:'Export this view (CSV)', act:'noop' }, '-', { label:'Columns', act:'colsmenu' }, { label:'Show retired kits', act:'showarch', on:state.showArch }],
  primary:() => ({ label:'+ New kit', act:'new' }),
  sub:rows => { const a = rows.filter(k => !k.archived); return `${a.reduce((s, k) => s + k.items, 0)} items in kits · ${a.filter(k => k.job).length} on jobs · `; },
  phonesub:rows => { const a = rows.filter(k => !k.archived); return `${a.length} kits · ${a.filter(k => k.job).length} on jobs · ${a.filter(k => k.missing).length} missing items`; },
  card:k => ({ ttl:esc(k.name), sub:`<span class="mono">${esc(k.tag)}</span> · ${k.job ? esc(k.job) + ' ' + esc(JOBN[k.job]) : esc(k.loc)}`, right:k.missing ? dw('err', 'Missing 1') : dw('ok', 'Complete'), extra:k.missing ? `<span class="muted">${esc(k.missing)}</span>` : '' }),
  none:{ t:'No kits yet', d:'Bundle gear that always travels together.', cta:'New kit' },
  segEmpty:{ missing:['No kit is missing anything', 'Every kit scanned in complete.'], onjob:['No kit is out', 'Kits on a job show here with the job number.'] },
  newForm:{ title:'New kit', fields:[['Name', '<input data-v="name" placeholder="e.g. Comms kit (Clear-Com)">'], ['Category', () => `<select data-v="cat">${uniq(D.kits.map(k => k.cat)).map(c => opt(c, c)).join('')}</select>`], ['Location', () => `<select data-v="loc">${['Warehouse A','Warehouse B'].map(c => opt(c, c)).join('')}</select>`]], make:v => ({ id:nid('k'), tag:'K-0' + (80 + uid % 19), name:v.name, cat:v.cat, models:0, items:0, missing:'', job:'', loc:v.loc, value:0, cond:'Good', tags:[], archived:false }) },
};
L.locations = {
  key:'locations', title:'Locations', crumb:'Locations', noun:'locations', search:'Search name, parent or address', defSeg:'all', defSort:['name','asc'], hot:null,
  base:l => !l.archived || state.showArch,
  seg:[['all','All',() => true],['warehouses','Warehouses',l => l.type === 'WAREHOUSE'],['vehicles','Vehicles',l => l.type === 'VEHICLE'],['sites','Sites',l => l.type === 'VENUE' || l.type === 'OFFSITE'],['empty','Empty',l => l.assets === 0]],
  cols:[
    { k:'name', label:'Location', main:true, sort:l => (l.parent ? l.parent + ' ' : '') + l.name.toLowerCase(), cell:l => titleCell(esc(l.name), `${TLAB[l.type]}${l.parent ? ' · in ' + esc(l.parent) : ''}${l.note ? ' · ' + esc(l.note) : ''}`, l.archived ? '<span class="faint">archived</span>' : '') },
    { k:'assets', label:'Assets', w:84, align:'r', sort:l => l.assets, cell:l => l.assets ? String(l.assets) : '<span class="faint">0</span>' },
    { k:'cap', label:'Capacity', w:170, sort:l => l.cap ? l.assets / l.cap : -1, cell:l => l.cap ? `<span class="mono" style="font-size:12.5px">${l.assets} / ${l.cap}</span><span class="bar ${l.assets / l.cap > .85 ? 'hi' : ''}"><i style="width:${Math.min(100, Math.round(100 * l.assets / l.cap))}%"></i></span>` : '<span class="faint">—</span>' },
    { k:'lm', label:'Last movement', w:190, sort:l => l.lm[0] + l.lm[1], cell:l => `${lmWord(l.lm)}<div class="sub ell">${esc(l.lm[2])}</div>` },
    { k:'addr', label:'Address', w:210, opt:true, cell:l => `<div class="ell muted">${esc(l.addr) || '—'}</div>` },
    { k:'tags', label:'Tags', w:100, opt:true, cell:l => mut(l.tags.join(', ') || '—') },
  ],
  filters:[{ k:'type', label:'Type', get:l => TLAB[l.type], opts:() => Object.values(TLAB) }, { k:'parent', label:'Parent', get:l => l.parent || '—', opts:() => uniq(D.locations.map(l => l.parent || '—')) }],
  text:l => [l.name, l.parent, l.addr, TLAB[l.type]].join(' '),
  views:[{ name:'Bins in Warehouse A', seg:'warehouses', f:{ parent:['Warehouse A'] } }],
  href:() => null,
  verbs:['lmove','lprint','archive'],
  rowItems:l => [{ label:'Open', act:'open', args:`data-id="${l.id}"` }, '-', V('lmove', 'Move contents…', l), V('lprint', 'Print bin labels', l), '-', l.archived ? V('archive', 'Reinstate', l) : V('archive', 'Archive…', l, true)],
  pageItems:() => [{ label:'Print bin labels for this view', act:'noop' }, { label:'Export this view (CSV)', act:'noop' }, '-', { label:'Columns', act:'colsmenu' }, { label:'Show archived', act:'showarch', on:state.showArch }],
  primary:() => ({ label:'+ New location', act:'new' }),
  sub:rows => { const a = rows.filter(l => !l.archived); return `${a.reduce((s, l) => s + l.assets, 0).toLocaleString()} assets placed · ${a.filter(l => !l.parent).length} top-level · `; },
  phonesub:rows => { const a = rows.filter(l => !l.archived); return `${a.length} locations · ${a.reduce((s, l) => s + l.assets, 0)} assets · ${a.filter(l => !l.assets).length} empty`; },
  card:l => ({ ttl:esc(l.name), sub:`${TLAB[l.type]}${l.parent ? ' · in ' + esc(l.parent) : ''} · ${l.assets} assets`, right:l.cap ? `<span class="mono" style="font-size:12.5px">${l.assets}/${l.cap}</span>` : '', extra:`<span class="muted">${lmWord(l.lm)}</span>` }),
  none:{ t:'No locations yet', d:'Add a warehouse, a vehicle or a venue so gear has somewhere to be.', cta:'New location' },
  segEmpty:{ empty:['Nothing is empty', 'Every location has at least one asset in it.'] },
  newForm:{ title:'New location', fields:[['Name', '<input data-v="name" placeholder="e.g. Bay 3">'], ['Type', '<select data-v="type">' + Object.entries(TLAB).map(([v, t]) => opt(v, t)).join('') + '</select>'], ['Inside', () => '<select data-v="parent">' + opt('', 'Nothing (top level)') + D.locations.filter(l => !l.parent && l.type === 'WAREHOUSE').map(l => opt(l.name, l.name)).join('') + '</select>']], make:v => ({ id:nid('l'), name:v.name, type:v.type, parent:v.parent, assets:0, cap:null, lm:[TODAY, '09:00', 'Jayden Cole'], addr:'', note:'', tags:[], archived:false }) },
};
L.maintenance = {
  key:'maintenance', title:'Maintenance', crumb:'Maintenance', noun:'records', search:'Search asset, issue or person', defSeg:'open', defSort:['due','asc'], hot:'overdue',
  base:r => r.status !== 'CANCELLED' || state.showArch,
  seg:[['open','Open',mOpen],['overdue','Overdue',mOverdue],['scheduled','Scheduled',r => mOpen(r) && r.status === 'SCHEDULED'],['done','Done',r => r.status === 'COMPLETED']],
  cols:[
    { k:'asset', label:'Asset', main:true, sort:r => (r.asset || r.model).toLowerCase(), cell:r => r.src === 'schedule' ? titleCell(esc(r.model), `${r.total} units · recurring`) : titleCell(`<span class="mono" style="font-size:13px">${esc(r.asset)}</span>`, esc(r.model)) },
    { k:'issue', label:'Issue', w:290, sort:r => r.title, cell:r => `<div class="ell">${esc(r.title)}</div><div class="sub ell">${r.src === 'schedule' ? `${esc(r.every)} · ${r.checked} of ${r.total} checked` : esc(MTYPE[r.type])}</div>` },
    { k:'status', label:'Status', w:150, sort:r => Object.keys(MSTAT).indexOf(r.status), cell:r => { const [n, c] = MSTAT[r.status]; return dw(c, n) + (r.result ? ` <span class="muted t-small">· ${r.result.toLowerCase()}</span>` : ''); } },
    { k:'due', label:'Due', w:130, sort:r => r.due, cell:r => dueW(r.due, r.done) },
    { k:'assigned', label:'Assigned', w:150, sort:r => r.assigned, cell:r => `<div class="ell">${esc(r.assigned)}</div>` },
    { k:'cost', label:'Cost', w:90, align:'r', opt:true, sort:r => r.cost, cell:r => r.cost ? money(r.cost) : '<span class="faint">—</span>' },
    { k:'by', label:'Reported by', w:130, opt:true, cell:r => mut(esc(r.by)) },
    { k:'tags', label:'Tags', w:100, opt:true, cell:r => mut(r.tags.join(', ') || '—') },
  ],
  filters:[{ k:'type', label:'Type', get:r => MTYPE[r.type], opts:() => Object.values(MTYPE) }, { k:'who', label:'Assigned', get:r => r.assigned, opts:() => uniq(D.maintenance.map(r => r.assigned)) }, { k:'status', label:'Status', get:r => MSTAT[r.status][0], opts:() => Object.values(MSTAT).map(x => x[0]) }],
  text:r => [r.asset, r.model, r.title, r.assigned, MTYPE[r.type]].join(' '),
  views:[{ name:'Mine', seg:'open', f:{ who:['Jayden Cole'] } }, { name:'Awaiting parts', seg:'open', f:{ status:['Awaiting parts'] } }],
  href:r => r.asset === 'AURA-01' ? U.asset : null,
  verbs:['assign','resched','done'],
  rowItems:r => [{ label:'Open', act:'open', args:`data-id="${r.id}"` }, ...(r.asset === 'AURA-01' ? [{ label:'Asset AURA-01', href:U.asset, small:'Asset' }] : []), '-', V('assign', 'Assign…', r), V('resched', 'Reschedule…', r), ...(r.src === 'schedule' ? [V('checkoff', 'Check off cycle', r)] : []), ...(mOpen(r) ? [V('done', 'Mark done', r)] : []), '-', V('del', 'Delete…', r, true)],
  pageItems:() => [{ label:'Service schedules…', act:'schedules', small:String(D.maintenance.filter(r => r.src === 'schedule').length) }, '-', { label:'Export this view (CSV)', act:'noop' }, '-', { label:'Columns', act:'colsmenu' }, { label:'Show cancelled', act:'showarch', on:state.showArch }],
  primary:() => ({ label:'+ Log maintenance', act:'new' }),
  sub:rows => { const o = rows.filter(mOpen); return `${o.length} open · ${o.filter(mOverdue).length} overdue · ${rows.filter(r => r.status === 'IN_PROGRESS').length} in progress · `; },
  phonesub:rows => { const o = rows.filter(mOpen); return `${o.length} open · ${o.filter(mOverdue).length} overdue`; },
  card:r => ({ ttl:r.src === 'schedule' ? esc(r.model) : `<span class="mono" style="font-size:14px">${esc(r.asset)}</span>`, sub:(r.src === 'schedule' ? '' : esc(r.model) + ' · ') + esc(r.title), right:(([n, c]) => dw(c, n))(MSTAT[r.status]), extra:`<span class="muted">${esc(r.assigned)}</span> · ${dueW(r.due, r.done)}` }),
  none:{ t:'No maintenance logged', d:'Log a repair or schedule recurring service.', cta:'Log maintenance' },
  segEmpty:{ overdue:['Nothing overdue', 'Every open job is on or ahead of its due date.'], scheduled:['Nothing scheduled', 'Book a service from an asset or log maintenance.'], done:['Nothing finished yet', 'Completed work lands here with its result.'] },
  newForm:{ title:'Log maintenance', fields:[['Asset tag', '<input data-v="asset" placeholder="e.g. AURA-03">'], ['Issue', '<input data-v="title" placeholder="What needs doing">'], ['Type', '<select data-v="type">' + Object.entries(MTYPE).map(([v, t]) => opt(v, t)).join('') + '</select>'], ['Due', `<input data-v="due" type="date" value="${addD(TODAY, 3)}">`], ['Assigned', '<select data-v="assigned">' + PEOPLE.map(p => opt(p, p)).join('') + '</select>']], make:v => ({ id:nid('mt'), src:'record', asset:v.asset || 'NEW-01', model:'—', title:v.title || 'Untitled', type:v.type, status:'SCHEDULED', due:v.due, done:null, assigned:v.assigned, cost:0, by:'Jayden Cole', result:'', tags:[] }) },
};
L.tt = {
  key:'tt', title:'Test & tag', crumb:'Test & tag', noun:'items', search:'Search tag, model or tester', defSeg:'due', defSort:['next','asc'], hot:'overdue', base:() => true,
  seg:[['due','Due',ttDue],['overdue','Overdue',ttOverdue],['passed','Passed',r => r.result === 'PASS' && !ttOverdue(r)],['failed','Failed',r => r.result === 'FAIL'],['all','All',() => true]],
  cols:[
    { k:'asset', label:'Asset', main:true, sort:r => r.tag, cell:r => titleCell(`<span class="mono" style="font-size:13px">${esc(r.tag)}</span>`, `${esc(r.model)} · ${mono(r.ttid)} · Class ${r.cls}${r.kind === 'B' ? ' · ' + r.qty + ' leads' : ''}`) },
    { k:'last', label:'Last test', w:120, sort:r => r.last, cell:r => mut(dateY(r.last)) },
    { k:'result', label:'Result', w:170, sort:r => r.result, cell:r => r.result === 'FAIL' ? `${dw('err', 'Failed')}${r.note ? `<div class="sub ell">${esc(r.note)}</div>` : ''}` : dw('ok', 'Passed') },
    { k:'next', label:'Next due', w:150, sort:r => r.next, cell:r => dueW(r.next) + (r.booked ? `<div class="sub ell">booked ${fmtD(r.booked)}</div>` : '') },
    { k:'tester', label:'Tester', w:140, sort:r => r.tester, cell:r => `<div class="ell">${esc(r.tester)}</div>` },
  ],
  filters:[{ k:'result', label:'Result', get:r => r.result === 'PASS' ? 'Passed' : 'Failed', opts:() => ['Passed','Failed'] }, { k:'tester', label:'Tester', get:r => r.tester, opts:() => TECH }, { k:'cls', label:'Class', get:r => 'Class ' + r.cls, opts:() => ['Class I','Class II'] }],
  text:r => [r.tag, r.model, r.ttid, r.tester].join(' '),
  views:[{ name:'Mine to retest', seg:'overdue', f:{ tester:['Tom Nguyen'] } }],
  href:r => r.tag === 'AURA-01' ? U.asset : null,
  verbs:['tsched','tprint','texport'],
  rowItems:r => [{ label:'Open', act:'open', args:`data-id="${r.id}"` }, { label:'Quick test', href:U.scan, small:'Scan' }, '-', V('tsched', 'Schedule test…', r), V('tprint', 'Print tag', r)],
  pageItems:() => [{ label:'Quick test', href:U.scan, small:'Scan' }, { label:'Reports…', act:'reports', small:'10' }, '-', { label:'Export registry (CSV)', act:'noop' }, '-', { label:'Columns', act:'colsmenu' }],
  primary:() => ({ label:'+ Register item', act:'new' }),
  sub:rows => `${rows.length} items registered · ${rows.filter(ttOverdue).length} overdue · ${rows.filter(r => r.result === 'FAIL').length} failed · `,
  phonesub:rows => `${rows.length} items · ${rows.filter(ttOverdue).length} overdue · ${rows.filter(r => r.result === 'FAIL').length} failed`,
  card:r => ({ ttl:`<span class="mono" style="font-size:14px">${esc(r.tag)}</span>`, sub:`${esc(r.model)} · last ${dateY(r.last)}`, right:dueW(r.next), extra:r.result === 'FAIL' ? dw('err', 'Failed') : '' }),
  none:{ t:'Nothing registered', d:'Register an item to start its test & tag history.', cta:'Register item' },
  segEmpty:{ overdue:['Nothing overdue', 'Every item is inside its test interval.'], failed:['No failures', 'Failed items stay here until they pass a retest.'], due:['Nothing due in the next 30 days', 'Items due within 30 days, and anything already overdue, show here.'] },
  newForm:{ title:'Register item', fields:[['Asset tag', '<input data-v="tag" placeholder="e.g. AURA-03">'], ['Class', '<select data-v="cls">' + opt('I', 'Class I') + opt('II', 'Class II') + '</select>'], ['Tester', '<select data-v="tester">' + TECH.map(t => opt(t, t)).join('') + '</select>']], make:v => ({ id:nid('tt'), ttid:'TT-0' + (440 + uid % 50), tag:v.tag || 'NEW-01', model:'—', cls:v.cls, last:TODAY, result:'PASS', next:addD(TODAY, 365), tester:v.tester, kind:'S', booked:null }) },
};
L.sales = {
  key:'sales', title:'Sales stock', crumb:'Sales stock', noun:'items', search:'Search item, SKU or category', defSeg:'all', defSort:['onHand','asc'], hot:'out', base:() => true,
  seg:[['all','All',() => true],['low','Low stock',s => s.onHand > 0 && s.onHand <= s.reorder],['out','Out of stock',s => s.onHand <= 0]],
  cols:[
    { k:'name', label:'Item', main:true, sort:s => s.name.toLowerCase(), cell:s => titleCell(esc(s.name), `${mono(s.sku)} · ${esc(s.cat)}`) },
    { k:'onHand', label:'On hand', w:120, align:'r', sort:s => s.onHand, cell:s => (s.onHand <= 0 ? `<span style="color:var(--t-out)">0</span>` : String(s.onHand)) + (s.onOrder ? `<div class="sub" style="font-family:var(--sans)">+${s.onOrder} on order</div>` : '') },
    { k:'reserved', label:'Reserved', w:110, align:'r', sort:s => s.reserved, cell:s => s.reserved ? `${s.reserved}<div class="sub" style="font-family:var(--mono)">${esc(s.resFor)}</div>` : '<span class="faint">0</span>' },
    { k:'reorder', label:'Reorder at', w:110, align:'r', sort:s => s.reorder, cell:s => String(s.reorder) },
    { k:'price', label:'Price', w:100, align:'r', sort:s => s.price, cell:s => money(s.price) },
    { k:'sup', label:'Supplier', w:140, opt:true, cell:s => mut(esc(s.sup) || '—') },
  ],
  filters:[{ k:'cat', label:'Category', get:s => s.cat, opts:() => uniq(D.sales.map(s => s.cat)) }],
  text:s => [s.name, s.sku, s.cat].join(' '),
  views:[{ name:'Needed this week', seg:'all', f:{} }],
  href:() => U.model,
  verbs:['adjust','reorder','sexport'],
  rowItems:s => [{ label:'Open model', act:'open', args:`data-id="${s.id}"` }, '-', V('adjust', 'Adjust stock…', s), V('reorder', 'Reorder…', s), V('level', 'Set reorder level…', s)],
  pageItems:() => [{ label:'Models', act:'noop', small:'22' }, { label:'Import stock count (CSV)…', act:'noop' }, { label:'Export this view (CSV)', act:'noop' }, '-', { label:'Columns', act:'colsmenu' }],
  primary:() => { const n = D.sales.filter(s => s.onHand <= s.reorder && !s.onOrder).length; return { label:n ? `Reorder ${n} low` : 'Reorder…', act:'primary-reorder' }; },
  sub:rows => `${rows.length} items · ${rows.filter(s => s.onHand <= 0).length} out · ${rows.filter(s => s.onHand > 0 && s.onHand <= s.reorder).length} low · `,
  phonesub:rows => `${rows.length} items · ${rows.filter(s => s.onHand <= 0).length} out · ${rows.filter(s => s.onHand > 0 && s.onHand <= s.reorder).length} low`,
  card:s => ({ ttl:esc(s.name), sub:`<span class="mono">${esc(s.sku)}</span> · ${money(s.price)} · reorder at ${s.reorder}`, right:`<span class="mono" style="font-size:14px;${s.onHand <= 0 ? 'color:var(--t-out)' : ''}">${s.onHand}</span>`, extra:s.reserved ? `<span class="muted">${s.reserved} reserved · ${esc(s.resFor)}</span>` : '' }),
  none:{ t:'No sale stock', d:'Models sold from the new-stock pool appear here.', cta:'' },
  segEmpty:{ low:['Nothing is running low', 'Every item is above its reorder level.'], out:['Nothing is out of stock', 'Every item has units on the shelf.'] },
};
L.overbookings = {
  key:'overbookings', title:'Overbookings', crumb:'Overbookings', noun:'shortfalls', search:'Search model, person or job', defSeg:'week', defSort:['subject','asc'], hot:'week', base:() => true,
  seg:[['week','This week',o => o.from <= addD(TODAY, 6)],['next30','Next 30 days',o => o.from <= addD(TODAY, 30)],['all','All',() => true]],
  cols:[
    { k:'subject', label:'Model', main:true, sort:o => ({ gear:0, pencil:1, sale:2, crew:3 })[o.kind] + o.from, cell:o => titleCell(esc(o.subject), o.kind === 'crew' ? 'Crew gap' : o.kind === 'sale' ? 'Sale stock to procure' : 'Gear over capacity', dw(KIND[o.kind][1], KIND[o.kind][0])) },
    { k:'short', label:'Short by', w:96, align:'r', sort:o => o.short, cell:o => String(o.short) + (o.unit ? ` <span class="muted" style="font-family:var(--sans)">${o.unit}</span>` : '') },
    { k:'jobs', label:'Jobs', w:150, sort:o => o.jobs[0], cell:o => jobLinks(o.jobs) },
    { k:'from', label:'Dates', w:130, sort:o => o.from, cell:o => fmtRange(o.from, o.to) },
    { k:'sub', label:'Sub-hire', w:200, sort:o => o.sub ? o.sub.supplier : 'zzz', cell:o => o.sub ? dw('ok', `Requested · ${esc(o.sub.supplier)}`) : (o.kind === 'gear' || o.kind === 'pencil') ? '<span class="faint">—</span>' : mut(o.kind === 'sale' ? 'reorder instead' : 'n/a') },
  ],
  filters:[{ k:'kind', label:'Kind', get:o => ({ gear:'Overbooked', pencil:'Pencilled', sale:'Sale stock', crew:'Crew' })[o.kind], opts:() => ['Overbooked','Pencilled','Sale stock','Crew'] }, { k:'job', label:'Job', get:o => o.jobs.join(' '), opts:() => Object.keys(JOBN), multi:true }],
  text:o => [o.subject, o.jobs.join(' '), ...o.jobs.map(j => JOBN[j])].join(' '),
  views:[{ name:'Gear still to cover', seg:'next30', f:{ kind:['Overbooked'] } }],
  href:o => o.jobs.includes('#2341') ? U.eq : null,
  verbs:['subhire','openjobs'],
  rowItems:o => [{ label:'Open', act:'open', args:`data-id="${o.id}"` }, ...o.jobs.map(j => ({ label:`Job ${j}`, href:jobUrl(j), small:j === '#2341' ? 'Equipment' : 'Overview' })), '-', ...((o.kind === 'gear' || o.kind === 'pencil') ? [V('subhire', 'Sub-hire…', o)] : []), ...(o.kind === 'sale' ? [{ label:'Reorder in Sales stock', act:'noop' }] : [])],
  pageItems:() => [{ label:'Schedule (timeline)', href:U.plan, small:'Planner' }, { label:'Crew planner', href:U.people, small:'People' }, '-', { label:'Export this view (CSV)', act:'noop' }, { label:'Print sheet', act:'noop' }],
  primary:() => { const n = shortGear().length; return { label:n ? `Sub-hire ${n} short` : 'Sub-hire…', act:'primary-subhire' }; },
  sub:rows => `${rows.filter(o => o.kind === 'gear').length} overbooked · ${rows.filter(o => o.kind === 'pencil').length} pencilled · ${rows.filter(o => o.kind === 'crew').length} crew gaps · `,
  phonesub:rows => `${rows.filter(o => o.kind === 'gear').length} overbooked · ${rows.filter(o => o.kind === 'pencil').length} pencilled · ${rows.filter(o => o.kind === 'crew').length} crew`,
  card:o => ({ ttl:esc(o.subject), sub:`${o.jobs.join(' · ')} · ${fmtRange(o.from, o.to)}`, right:`<span class="mono" style="font-size:14px">${o.short}${o.unit ? ' ' + o.unit : ''}</span>`, extra:o.sub ? dw('ok', 'Requested · ' + esc(o.sub.supplier)) : dw(KIND[o.kind][1], KIND[o.kind][0]) }),
  none:{ t:'No overbookings', d:'Every booking fits the stock and the crew.', cta:'' },
  segEmpty:{ week:['Nothing short this week', 'Gear, stock and crew all cover the next seven days.'], next30:['Nothing short in 30 days', 'Everything booked in the next month is covered.'] },
};
const uniq = a => [...new Set(a)].sort();
const shortGear = () => rowsOf('overbookings', true).filter(o => (o.kind === 'gear') && !o.sub);
function V(k, label, r, danger) { return { label, act:'verb', args:`data-k="${k}" data-id="${r.id}"`, danger }; }
// ---------- derived
const rowsOf = key => key === state.list ? rows() : D[key];
function baseRows() { const l = cur(); return D[l.key].filter(r => l.base(r)); }
function inSeg(l, r, k) { return l.seg.find(s => s[0] === k)[2](r); }
function rows() {
  const l = cur(), q = state.q.trim().toLowerCase();
  let r = baseRows().filter(x => inSeg(l, x, state.seg));
  if (q) r = r.filter(x => l.text(x).toLowerCase().includes(q));
  for (const f of l.filters) { const v = state.f[f.k]; if (v && v.length) r = r.filter(x => f.multi ? v.some(j => f.get(x).includes(j)) : v.includes(f.get(x))); }
  const c = l.cols.find(x => x.k === state.sort), d = state.dir === 'asc' ? 1 : -1;
  if (c && c.sort) r = [...r].sort((a, b) => { const x = c.sort(a), y = c.sort(b); return (x > y ? 1 : x < y ? -1 : 0) * d; });
  return r;
}
const byId = id => D[state.list].find(r => r.id === id);
const selectedRows = () => D[state.list].filter(r => state.selected.has(r.id));
const nameOf = r => r.name || r.asset || r.tag || r.subject || r.model;
function snapshot() { const s = structuredClone(D); return () => { for (const k in s) D[k] = s[k]; state.selected.clear(); render(); }; }
const go = url => { try { location.href = url; } catch (e) {} };
const visCols = () => cur().cols.filter(c => !c.opt || state.cols[cur().key + ':' + c.k]);

// ---------- URL is the state (hash in the prototype; real query params in the app)
function writeURL(push) {
  try { const l = cur(), p = new URLSearchParams(); p.set('list', l.key); if (state.seg !== l.defSeg) p.set('seg', state.seg); if (state.q) p.set('q', state.q); if (state.sort !== l.defSort[0] || state.dir !== l.defSort[1]) { p.set('sort', state.sort); p.set('dir', state.dir); } for (const k in state.f) if (state.f[k].length) p.set('f.' + k, state.f[k].join('|')); if (state.page) p.set('page', state.page + 1); history[push ? 'pushState' : 'replaceState'](null, '', '#' + p.toString()); } catch (e) {}
}
function initList(key) { const l = L[key]; Object.assign(state, { list:key, seg:l.defSeg, q:'', f:{}, sort:l.defSort[0], dir:l.defSort[1], page:0, showArch:false, savedView:null, lastSel:null }); state.selected.clear(); l.filters.forEach(f => state.f[f.k] = []); }
function applyHash() {
  const p = new URLSearchParams(location.hash.slice(1)); const key = L[p.get('list')] ? p.get('list') : state.list; initList(key); const l = L[key];
  if (l.seg.some(s => s[0] === p.get('seg'))) state.seg = p.get('seg'); state.q = p.get('q') || ''; if (l.cols.some(c => c.k === p.get('sort'))) { state.sort = p.get('sort'); state.dir = p.get('dir') === 'desc' ? 'desc' : 'asc'; }
  l.filters.forEach(f => { const v = p.get('f.' + f.k); if (v) state.f[f.k] = v.split('|'); }); state.page = Math.max(0, (+p.get('page') || 1) - 1);
}

// ---------- verbs: one definition used by the row ⋯ and the bulk bar (never two implementations)
const dateField = (id, d) => `<input data-v="${id}" type="date" value="${d}">`;
const sel1 = (id, items, cur_) => `<select data-v="${id}">${items.map(x => Array.isArray(x) ? opt(x[0], x[1], cur_) : opt(x, x, cur_)).join('')}</select>`;
const archiveLabel = (n, s) => s.length && s.every(r => r.archived) ? `Restore ${n}` : `Archive ${n}`;
const VERBS = {
  rates:{ bulk:n => `Edit rates ${n}…`, elig:m => !m.archived, skip:'archived', form:s => ({ title:`Edit rates on ${s.length} model${s.length > 1 ? 's' : ''}`, cta:'Apply', body:`<div class="row2">${field('Rate', sel1('rate', [['day','Daily'],['week','Weekly'],['month','Monthly']]))}${field('Change', sel1('op', [['set','Set to ($)'],['mult','Multiply by'],['pct','Add percent']]))}</div>${field('Value', '<input data-v="val" inputmode="decimal" placeholder="e.g. 100, 1.1 or 10">', 'Models with no rate of that kind are skipped for multiply and percent; blank stays blank')}` }),
    apply:(s, v) => { const x = +v.val; if (v.val === '' || isNaN(x)) return { err:'Enter a value first' }; const key = v.rate; let n = 0; s.forEach(m => { const b = m[key]; if (v.op === 'set') { m[key] = Math.round(x); n++; } else if (b != null) { m[key] = Math.round(v.op === 'mult' ? b * x : b * (1 + x / 100)); n++; } }); return `${({ day:'Daily', week:'Weekly', month:'Monthly' })[v.rate]} rate updated on ${n} model${n === 1 ? '' : 's'}`; } },
  acc:{ bulk:n => `Add accessory ${n}…`, elig:m => !m.archived, skip:'archived', form:s => ({ title:`Add an accessory to ${s.length} model${s.length > 1 ? 's' : ''}`, cta:'Add', body:`${field('Accessory', sel1('acc', ['Power cable (IEC 3 m)','Omega clamp','Safety bond','Road case'].map(x => x)))}${field('Quantity per unit', '<input data-v="qty" inputmode="numeric" value="1">', 'Added to each model’s accessory plan; every unit brings them on a job')}` }), apply:(s, v) => { s.forEach(m => m.acc += +v.qty || 1); return `${v.acc} added to ${s.length} model${s.length > 1 ? 's' : ''}`; } },
  checks:{ bulk:n => `Assign checks ${n}…`, elig:m => !m.archived, skip:'archived', form:s => ({ title:`Assign checks to ${s.length} model${s.length > 1 ? 's' : ''}`, cta:'Assign', body:field('Check set', sel1('chk', ['Pre-hire visual','Lens & optics','RF scan before dispatch','Rigging inspection']), 'Scanned in and out against this list') }), apply:(s, v) => { s.forEach(m => m.checks = v.chk); return `“${v.chk}” assigned to ${s.length} model${s.length > 1 ? 's' : ''}`; } },
  archive:{ bulk:archiveLabel, danger:true, elig:r => !(state.list === 'locations' && r.assets > 0 && !r.archived), skip:'still hold assets', form:s => s.every(r => r.archived) ? null : ({ title:`Archive ${s.length} ${cur().noun}?`, cta:`Archive ${s.length}`, danger:true, body:`<div class="t-small" style="line-height:1.5">${{ models:'Archived models leave every picker and availability search. Assets, rates, ROI and documents keep their history; open jobs that use them are unaffected. Restore from the Archived segment.', kits:'A retired kit leaves availability and pickers. Its history and checks are kept. A kit that is on a job is skipped.', locations:'Archived locations leave the Move-to pickers. A location that still holds assets is skipped; move its contents first.' }[state.list]}</div>` }),
    apply:s => { const re = s.every(r => r.archived); s.forEach(r => r.archived = !re); return re ? `${s.length} restored` : `${s.length} archived · history kept`; } },
  dup:{ bulk:n => `Duplicate ${n}`, elig:() => true, apply:s => { s.forEach(k => D.kits.push({ ...structuredClone(k), id:nid('k'), tag:'K-0' + (80 + uid % 19), name:'Copy of ' + k.name, job:'', missing:'', loc:'Warehouse A', archived:false })); return `${s.length} kit${s.length > 1 ? 's' : ''} duplicated · copies start in Warehouse A, off any job`; } },
  kprint:{ bulk:n => `Print list ${n}`, desk:true, nowrite:true, elig:() => true, apply:s => `Pack list for ${s.length} kit${s.length > 1 ? 's' : ''} · opens the print dialog` },
  kreturn:{ bulk:n => `Force return ${n}`, elig:k => !!k.job, skip:'not on a job', form:s => ({ title:`Force return ${s.length} kit${s.length > 1 ? 's' : ''}?`, cta:`Force return ${s.length}`, danger:true, body:'<div class="t-small" style="line-height:1.5">Marks the kit and its contents back in Warehouse A without scanning. The job’s lines keep their history.</div>' }), apply:s => { s.forEach(k => { k.job = ''; k.loc = 'Warehouse A'; }); return `${s.length} kit${s.length > 1 ? 's' : ''} force-returned to Warehouse A`; } },
  lmove:{ bulk:n => `Move contents ${n}…`, elig:l => l.assets > 0, skip:'already empty', form:s => ({ title:`Move contents of ${s.length} location${s.length > 1 ? 's' : ''}`, cta:'Move', body:field('Move everything to', sel1('dest', D.locations.filter(l => !l.archived && !s.includes(l) && l.type !== 'VENUE').map(l => l.parent ? `${l.parent} › ${l.name}` : l.name)), 'Each asset gets a movement record; kits move with their contents') }), apply:(s, v) => { const dst = D.locations.find(l => (l.parent ? `${l.parent} › ${l.name}` : l.name) === v.dest); const n = s.reduce((a, l) => a + l.assets, 0); dst.assets += n; dst.lm = [TODAY, '09:41', 'Jayden Cole']; s.forEach(l => { l.assets = 0; l.lm = [TODAY, '09:41', 'Jayden Cole']; }); return `${n} assets moved to ${v.dest}`; } },
  lprint:{ bulk:n => `Print bin labels ${n}`, desk:true, nowrite:true, elig:() => true, apply:s => `Bin labels for ${s.length} location${s.length > 1 ? 's' : ''} · opens the print dialog` },
  assign:{ bulk:n => `Assign ${n}…`, elig:mOpen, skip:'already finished', form:s => ({ title:`Assign ${s.length} job${s.length > 1 ? 's' : ''}`, cta:'Assign', body:field('Assign to', sel1('who', [...PEOPLE.slice(0, 3), 'Barco AU (external)'])) }), apply:(s, v) => { s.forEach(r => r.assigned = v.who); return `${s.length} assigned to ${v.who}`; } },
  resched:{ bulk:n => `Reschedule ${n}…`, elig:mOpen, skip:'already finished', form:s => ({ title:`Reschedule ${s.length} job${s.length > 1 ? 's' : ''}`, cta:'Reschedule', body:field('New due date', dateField('d', addD(TODAY, 3)), 'Recurring service moves its next cycle too') }), apply:(s, v) => { s.forEach(r => r.due = v.d); return `${s.length} rescheduled to ${fmtD(v.d)}`; } },
  done:{ bulk:n => `Mark ${n} done`, elig:mOpen, skip:'already finished', apply:s => { s.forEach(r => { r.status = 'COMPLETED'; r.done = TODAY; r.result = 'PASS'; }); return `${s.length} marked done · result Pass · assets return to Available`; } },
  checkoff:{ bulk:n => `Check off ${n}`, elig:r => r.src === 'schedule', skip:'not recurring', apply:s => { s.forEach(r => { r.checked = 0; r.due = addD(r.due < TODAY ? TODAY : r.due, 90); }); return `Cycle completed · next due ${fmtD(s[0].due)}`; } },
  del:{ bulk:n => `Delete ${n}`, danger:true, elig:() => true, form:s => ({ title:'Delete this record?', cta:'Delete', danger:true, body:'<div class="t-small" style="line-height:1.5">The record and its notes are removed. The asset’s status is not changed; if it was held in maintenance for this job, release it from the asset.</div>' }), apply:s => { D.maintenance = D.maintenance.filter(r => !s.includes(r)); return 'Record deleted'; } },
  tsched:{ bulk:n => `Schedule ${n}…`, elig:() => true, form:s => ({ title:`Schedule test for ${s.length} item${s.length > 1 ? 's' : ''}`, cta:'Schedule', body:`<div class="row2">${field('Date', dateField('d', addD(TODAY, 2)))}${field('Tester', sel1('t', TECH))}</div>` }), apply:(s, v) => { s.forEach(r => { r.booked = v.d; r.tester = v.t; }); return `${s.length} booked for ${fmtD(v.d)} with ${v.t}`; } },
  tprint:{ bulk:n => `Print ${n} tags`, desk:true, nowrite:true, elig:() => true, apply:s => `Tag sheet for ${s.length} item${s.length > 1 ? 's' : ''} · opens the print dialog` },
  texport:{ bulk:n => 'Export report', desk:true, nowrite:true, elig:() => true, apply:s => `Compliance report for ${s.length} item${s.length > 1 ? 's' : ''} · PDF` },
  adjust:{ bulk:n => `Adjust stock ${n}…`, elig:() => true, form:s => ({ title:s.length === 1 ? `Adjust stock · ${s[0].name}` : `Adjust stock on ${s.length} items`, cta:'Apply', body:`${field('Change', '<input data-v="delta" inputmode="numeric" placeholder="e.g. 20, or -3 to correct down">', 'Added to each item’s on-hand count')}${field('Reason', '<input data-v="why" placeholder="e.g. Received PO #1234">')}` }), apply:(s, v) => { const d = parseInt(v.delta, 10); if (isNaN(d)) return { err:'Enter a change, like 20 or -3' }; s.forEach(r => r.onHand = Math.max(0, r.onHand + d)); s.forEach(r => { if (d > 0) r.onOrder = Math.max(0, r.onOrder - d); }); return `On hand ${d >= 0 ? '+' : ''}${d} on ${s.length} item${s.length > 1 ? 's' : ''}${v.why ? ' · ' + esc(v.why) : ''}`; } },
  reorder:{ bulk:n => `Reorder ${n}…`, elig:() => true, form:s => ({ title:`Reorder ${s.length} item${s.length > 1 ? 's' : ''}`, cta:'Draft purchase order', body:`${field('Supplier', sel1('sup', SUPPLIERS))}${field('Quantity each', '<input data-v="qty" inputmode="numeric" placeholder="Blank = top up to twice the reorder level">')}` }), apply:(s, v) => { s.forEach(r => r.onOrder = v.qty ? +v.qty : Math.max(r.reorder * 2 - r.onHand, 1)); return `Draft purchase order · ${s.length} item${s.length > 1 ? 's' : ''} from ${v.sup} · nothing sent yet`; } },
  level:{ bulk:n => `Set level ${n}…`, elig:() => true, form:s => ({ title:`Reorder level · ${s[0].name}`, cta:'Save', body:field('Reorder at', `<input data-v="lvl" inputmode="numeric" value="${s[0].reorder}">`, 'On hand at or below this reads as Low stock') }), apply:(s, v) => { s[0].reorder = +v.lvl || 0; return `Reorder level set to ${s[0].reorder}`; } },
  sexport:{ bulk:n => 'Export', desk:true, nowrite:true, elig:() => true, apply:s => `${s.length} item${s.length > 1 ? 's' : ''} exported · CSV` },
  subhire:{ bulk:n => `Sub-hire ${n} short…`, elig:o => (o.kind === 'gear' || o.kind === 'pencil') && !o.sub, skip:'crew and stock rows are not sub-hired', form:s => ({ title:`Sub-hire ${s.length} short model${s.length > 1 ? 's' : ''}`, cta:'Request', body:`${s.map(o => `<div class="ib t-small" style="justify-content:space-between"><span>${esc(o.subject)}</span><span class="mono">${o.short} short · ${fmtRange(o.from, o.to)}</span></div>`).join('')}${field('Supplier', sel1('sup', SUPPLIERS), 'Sends a request; nothing is booked until they confirm')}` }), apply:(s, v) => { s.forEach(o => o.sub = { supplier:v.sup }); return `Sub-hire requested from ${v.sup} · ${s.length} model${s.length > 1 ? 's' : ''} · shortfall stays until it arrives`; } },
  openjobs:{ bulk:n => `Open ${n} job${n > 1 ? 's' : ''}`, nowrite:true, elig:() => true, apply:s => { const js = [...new Set(s.flatMap(o => o.jobs))]; return `Opens ${js.join(', ')} in the Equipment tab`; } },
};
function openVerbDialog(k, ids) {
  const vb = VERBS[k], s = ids.map(id => D[state.list].find(r => r.id === id)); const f = vb.form(s); if (!f) return runVerb(k, s, {});
  state.pending = { k, ids };
  openDialog(`<div class="hd"><div class="t-overline">${esc(cur().title)}</div><h2 style="font-size:18px">${f.title}</h2></div><div class="bd">${f.body}</div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn ${f.danger ? 'btn-secondary' : 'btn-primary'}" ${f.danger ? 'style="color:var(--t-out)"' : ''} data-act="verbgo">${f.cta}</button></div>`);
}
function runVerb(k, sel, v, skipped = 0) {
  const vb = VERBS[k]; const undo = vb.nowrite ? null : snapshot(); let msg = vb.apply(sel, v);
  if (msg && msg.err) { toast(msg.err); return false; }
  if (skipped) msg += ` · ${skipped} skipped (${vb.skip})`;
  state.selected.clear(); closeLayer(); render(); toast(msg, undo); return true;
}
// ---------- render
function renderGearNav() {
  const main = (href, name, c, on) => `<a href="${href}" class="${on ? 'on' : ''}"><span class="patch" style="background:var(--${c}-soft, var(--paper-2))"></span>${name}</a>`;
  const lst = (k, name, c) => `<a href="#list=${k}" data-act="list" data-k="${k}" class="${state.list === k ? 'on' : ''}"><span class="patch" style="background:var(--${c}-soft, var(--paper-2))"></span>${name}</a>`;
  const sub = (k, name) => `<a href="#list=${k}" data-act="list" data-k="${k}" class="sub ${state.list === k ? 'on' : ''}">${name}</a>`;
  $('#sidenav').innerHTML = main(U.home, 'Dashboard', 'blue') + main(U.jobs, 'Jobs', 'blue') + main(U.fin, 'Finance', 'green') + main(U.plan, 'Schedule', 'green') + main(U.people, 'Crew', 'purple') + main(U.assets, 'Assets', 'amber') +
    `<a class="sub" href="${U.assets}">Registry<small style="margin-left:auto;color:var(--faint);font-size:11px">↗</small></a>` + sub('models', 'Models') + sub('kits', 'Kits') + sub('locations', 'Locations') + sub('sales', 'Sales stock') + sub('overbookings', 'Overbookings') +
    main(U.floor, 'Warehouse', 'teal') + lst('tt', 'Test & tag', 'teal') + lst('maintenance', 'Maintenance', 'amber');
}
function renderHead() {
  const l = cur(), base = baseRows(), p = l.primary();
  $('#title').textContent = l.title; $('#count').textContent = base.filter(r => !r.archived).length;
  $('#headsub').innerHTML = `${l.sub(base)}<span class="kbd">/</span> search${p.act === 'new' ? ` · <span class="kbd">n</span> ${esc(p.label.replace('+ ', '').toLowerCase())}` : ''}`;
  $('#phname').textContent = l.title; $('#phonesub').textContent = l.phonesub(base);
  for (const id of ['#primary', '#phoneprimary']) { $(id).textContent = p.label; $(id).dataset.act = p.act; }
  $('.crumb').innerHTML = `<a href="${U.assets}">Assets</a><span class="sep">›</span><b>${esc(l.crumb)}</b>`;
  document.title = `${l.title} · RVLT Flow`;
}
function renderStrip() {
  const l = cur(), base = baseRows();
  $('#strip').innerHTML = l.seg.map(([k, name, fn]) => { const c = base.filter(fn).length; return `<button class="${state.seg === k ? 'on' : ''}" data-act="seg" data-k="${k}" style="${l.hot === k && c ? 'color:var(--t-out)' : ''}">${name} <span class="n">${c}</span></button>`; }).join('');
}
function renderToolbar() {
  const l = cur(); $('#q').placeholder = l.search; if ($('#q').value !== state.q) $('#q').value = state.q;
  const lbl = a => a.length ? (a.length > 1 ? a.length + ' chosen' : a[0]) : '', any = l.filters.some(f => state.f[f.k].length) || state.q;
  $('#fwords').innerHTML = l.filters.map(f => filterWord(f.label, f.k, lbl(state.f[f.k]), 'fmenu')).join('') + (any ? `<button class="lnk muted" data-act="clearf">Clear</button>` : '');
  $('#views').innerHTML = `<button class="fw ${state.savedView ? 'on' : ''}" data-act="viewsmenu">${state.savedView ? 'View: ' + esc(state.savedView) : 'Views ▾'}</button>`;
}
function emptyHtml() {
  const l = cur(), filtered = state.q || l.filters.some(f => state.f[f.k].length);
  if (filtered) return `<div class="empty"><b>Nothing matches that</b>Loosen a filter or clear them. <button class="lnk" data-act="clearf">Clear filters</button></div>`;
  const s = l.segEmpty[state.seg]; if (s) return `<div class="empty"><b>${s[0]}</b>${s[1]}</div>`;
  return `<div class="empty"><b>${l.none.t}</b>${l.none.d}${l.none.cta ? ` <button class="lnk" data-act="new">${l.none.cta}</button>` : ''}</div>`;
}
function renderTable() {
  const l = cur(), all = rows(), pr = all.slice(state.page * state.size, (state.page + 1) * state.size), cols = visCols(), allSel = pr.length && pr.every(r => state.selected.has(r.id));
  let h = `<table class="tbl" style="min-width:0;table-layout:fixed;width:100%"><colgroup><col style="width:34px">${cols.map(c => c.main ? '<col>' : `<col style="width:${c.w}px">`).join('')}<col style="width:40px"></colgroup><thead><tr><th><button class="cb ${allSel ? 'on' : ''}" data-act="selall" aria-label="Select page"></button></th>${cols.map(c => c.sort ? sortHead(c.label, c.k, c.align) : `<th>${c.label}</th>`).join('')}<th></th></tr></thead><tbody>`;
  if (!pr.length) h += `<tr><td colspan="${cols.length + 2}">${emptyHtml()}</td></tr>`;
  for (const r of pr) { const s = state.selected.has(r.id); h += `<tr class="row ${s ? 'sel' : ''}" data-act="open" data-id="${r.id}"><td><button class="cb ${s ? 'on' : ''}" data-act="select" data-id="${r.id}" aria-label="Select ${esc(nameOf(r))}"></button></td>${cols.map(c => `<td class="${c.align === 'r' ? 'r' : ''}" style="min-width:0">${c.cell(r)}</td>`).join('')}<td class="r"><button class="dots" data-act="rowmenu" data-id="${r.id}" aria-label="Row actions">${ICON.dots}</button></td></tr>`; }
  $('#tblwrap').innerHTML = h + '</tbody></table>';
}
function renderList() {
  const l = cur(), all = rows(), pr = all.slice(0, (state.page + 1) * state.size);
  $('#list').innerHTML = pr.map(r => { const c = l.card(r), s = state.selected.has(r.id); return `<div class="lrow ${s ? 'sel' : ''}" data-act="open" data-id="${r.id}"><button class="cb ${s ? 'on' : ''}" data-act="select" data-id="${r.id}" aria-label="Select"></button><div class="grow" style="min-width:0"><div class="ttl ell">${c.ttl}</div><div class="sub ell">${c.sub}</div>${c.extra ? `<div class="sub ell" style="font-size:12.5px">${c.extra}</div>` : ''}</div><div class="right">${c.right || ''}</div><button class="dots" data-act="rowmenu" data-id="${r.id}" aria-label="Row actions">${ICON.dots}</button></div>`; }).join('') || emptyHtml();
  if (all.length > pr.length) $('#list').innerHTML += `<button class="lrow" data-act="more" style="justify-content:center;color:var(--blue);font-weight:600;width:100%">Show ${Math.min(state.size, all.length - pr.length)} more · ${all.length - pr.length} left</button>`;
}
function renderFoot() { $('#foot').innerHTML = pager(rows().length, cur().noun); }
function renderBulk() {
  const n = state.selected.size, b = $('#bulk'), l = cur(); b.classList.toggle('open', n > 0); document.body.classList.toggle('hassel', n > 0); if (!n) return;
  const sel = selectedRows();
  b.innerHTML = `<b style="font-size:13px">${n} selected</b>` + l.verbs.map(k => { const vb = VERBS[k], e = sel.filter(vb.elig).length; if (!e) return ''; return `<button class="btn btn-secondary btn-sm ${vb.desk ? 'deskonly' : ''}" ${vb.danger ? 'style="color:var(--t-out)"' : ''} data-act="verb" data-k="${k}">${vb.bulk(e, sel)}</button>`; }).join('') + `<button class="btn btn-icon btn-sm" data-act="clearsel" aria-label="Clear selection">✕</button>`;
}
function render(push) { renderGearNav(); renderHead(); renderStrip(); renderToolbar(); renderTable(); renderList(); renderFoot(); renderBulk(); writeURL(push === true); }

// ---------- actions
function multiMenu(el, f) { openMenu(el, f.label, [...f.opts().map(o => ({ label:o, act:'ftoggle', args:`data-k="${f.k}" data-v="${esc(o)}"`, on:state.f[f.k].includes(o) })), '-', { label:'Clear', act:'fclear', args:`data-k="${f.k}"` }]); }
function listItems() { return LIST_ORDER.map(k => ({ label:L[k].title, act:'list', args:`data-k="${k}"`, on:state.list === k, small:String(D[k].filter(r => L[k].base(r) && !r.archived).length) })); }
function act(name, el, ev) {
  const id = el.dataset.id, l = cur();
  switch (name) {
    case 'close': closeLayer(); break;
    case 'noop': closeLayer(); toast('Not wired in this prototype'); break;
    case 'list': closeLayer(); initList(el.dataset.k); state.size = 25; render(true); window.scrollTo(0, 0); { const c = $('.content'); if (c) c.scrollTop = 0; } break;
    case 'listmenu': openMenu(el, 'Lists', listItems()); break;
    case 'seg': state.seg = el.dataset.k; state.page = 0; state.selected.clear(); render(); break;
    case 'sort': if (state.sort === el.dataset.k) state.dir = state.dir === 'asc' ? 'desc' : 'asc'; else { state.sort = el.dataset.k; state.dir = 'asc'; } render(); break;
    case 'page': state.page = Math.max(0, state.page + +el.dataset.d); render(); break;
    case 'more': state.page++; render(); break;
    case 'fmenu': multiMenu(el, l.filters.find(f => f.k === el.dataset.k)); break;
    case 'ftoggle': { const arr = state.f[el.dataset.k], v = el.dataset.v, i = arr.indexOf(v); i >= 0 ? arr.splice(i, 1) : arr.push(v); state.page = 0; state.savedView = null; render(); act('fmenu', el); break; }
    case 'fclear': state.f[el.dataset.k] = []; closeLayer(); render(); break;
    case 'clearf': l.filters.forEach(f => state.f[f.k] = []); state.q = ''; $('#q').value = ''; state.savedView = null; state.page = 0; closeLayer(); render(); break;
    case 'viewsmenu': openMenu(el, 'Views', [{ sh:'Saved views · each one is a URL you can share' }, ...l.views.map((v, i) => ({ label:v.name, act:'applyview', args:`data-i="${i}"`, on:state.savedView === v.name })), '-', { label:'Save current view…', act:'saveview' }, ...(state.savedView ? [{ label:'Clear view', act:'clearf' }] : [])]); break;
    case 'applyview': { const v = l.views[+el.dataset.i]; l.filters.forEach(f => state.f[f.k] = (v.f && v.f[f.k]) ? [...v.f[f.k]] : []); state.seg = v.seg || l.defSeg; state.savedView = v.name; state.page = 0; closeLayer(); render(); toast(`View “${v.name}” · the filters are in the URL, so the link is the view`); break; }
    case 'saveview': closeLayer(); openDialog(`<div class="hd"><div class="t-overline">Views</div><h2 style="font-size:18px">Save current view</h2></div><div class="bd">${field('Name', `<input id="v-name" placeholder="e.g. Gear still to cover" value="">`)}</div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="saveviewgo">Save</button></div>`, d => $('#v-name', d).focus()); break;
    case 'saveviewgo': { const nm = $('#v-name', body).value.trim() || 'Untitled view'; l.views.push({ name:nm, seg:state.seg, f:structuredClone(state.f) }); state.savedView = nm; closeLayer(); render(); toast(`Saved “${nm}”`); break; }
    case 'pagemenu': openMenu(el, l.title, [...(isPhone() ? [{ sh:'Lists' }, ...listItems(), '-'] : []), ...l.pageItems()]); break;
    case 'colsmenu': { const opts = l.cols.filter(c => c.opt); openMenu(el, 'Columns', [...opts.map(c => ({ label:c.label, act:'coltoggle', args:`data-c="${c.k}"`, on:!!state.cols[l.key + ':' + c.k] })), { sh:'The other columns are always shown' }]); break; }
    case 'coltoggle': state.cols[l.key + ':' + el.dataset.c] = !state.cols[l.key + ':' + el.dataset.c]; closeLayer(); render(); break;
    case 'showarch': state.showArch = !state.showArch; closeLayer(); render(); break;
    case 'open': { if (ev && ev.target.closest('.cb,.dots,a')) break; closeLayer(); const r = byId(id), u = l.href(r); if (u) go(u); else toast(`Opens ${esc(nameOf(r))} · its record page is a separate surface`); break; }
    case 'select': { if (ev && ev.shiftKey && state.lastSel) { const order = rows().map(x => x.id), i1 = order.indexOf(state.lastSel), i2 = order.indexOf(id); for (const k of order.slice(Math.min(i1, i2), Math.max(i1, i2) + 1)) state.selected.add(k); } else state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id); state.lastSel = id; render(); break; }
    case 'selall': { const pr = rows().slice(state.page * state.size, (state.page + 1) * state.size), all = pr.every(x => state.selected.has(x.id)); pr.forEach(x => all ? state.selected.delete(x.id) : state.selected.add(x.id)); render(); break; }
    case 'clearsel': state.selected.clear(); render(); break;
    case 'rowmenu': { const r = byId(id); openMenu(el, nameOf(r), l.rowItems(r)); break; }
    case 'verb': { const vb = VERBS[el.dataset.k], sel = id ? [byId(id)] : selectedRows(), e = sel.filter(vb.elig); closeLayer(); if (!e.length) { toast('Nothing in that selection can do this'); break; } state.skipped = sel.length - e.length; if (vb.form && vb.form(e)) openVerbDialog(el.dataset.k, e.map(r => r.id)); else runVerb(el.dataset.k, e, {}, state.skipped); break; }
    case 'verbgo': { const p = state.pending, vb = VERBS[p.k], sel = p.ids.map(i => D[state.list].find(r => r.id === i)), v = {}; $('#layerbody').querySelectorAll('[data-v]').forEach(x => v[x.dataset.v] = x.value); runVerb(p.k, sel, v, state.skipped || 0); break; }
    case 'primary-reorder': { const low = D.sales.filter(s => s.onHand <= s.reorder && !s.onOrder); closeLayer(); if (!low.length) { toast('Nothing is low. Everything is above its reorder level.'); break; } state.selected = new Set(low.map(s => s.id)); state.skipped = 0; openVerbDialog('reorder', low.map(s => s.id)); break; }
    case 'primary-subhire': { const sh = shortGear(); closeLayer(); if (!sh.length) { toast('Every short model already has a sub-hire request.'); break; } state.skipped = 0; openVerbDialog('subhire', sh.map(o => o.id)); break; }
    case 'new': { closeLayer(); const f = l.newForm; if (!f) { toast('Not wired in this prototype'); break; } openDialog(`<div class="hd"><div class="t-overline">${esc(l.title)}</div><h2 style="font-size:18px">${f.title}</h2></div><div class="bd">${f.fields.map(([lab, inner]) => field(lab, typeof inner === 'function' ? inner() : inner)).join('')}</div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="newgo">Create</button></div>`, d => { const i = d.querySelector('input'); if (i && !isPhone()) i.focus(); }); break; }
    case 'newgo': { const v = {}; $('#layerbody').querySelectorAll('[data-v]').forEach(x => v[x.dataset.v] = x.value); const first = l.newForm.fields[0]; if (!v[Object.keys(v)[0]].trim()) { toast('Give it a name first'); break; } const undo = snapshot(); const r = l.newForm.make(v); D[l.key].unshift(r); closeLayer(); state.q = ''; state.seg = l.defSeg === 'due' ? 'all' : (inSeg(l, r, l.defSeg) ? l.defSeg : l.seg[0][0]); state.sort = l.defSort[0]; state.dir = l.defSort[1]; render(); toast(`${esc(nameOf(r))} created`, undo); break; }
    case 'schedules': closeLayer(); openSchedules(); break;
    case 'schedoff': { const undo = snapshot(); D.maintenance = D.maintenance.filter(r => r.id !== id); closeLayer(); render(); openSchedules(); toast('Schedule deactivated · open cycles are kept', undo); break; }
    case 'schednew': { const undo = snapshot(); D.maintenance.push({ id:nid('mt'), src:'schedule', asset:'', model:'Moving-head wash (all)', title:'Lens & fan clean', type:'PREVENTATIVE', status:'SCHEDULED', due:addD(TODAY, 21), done:null, assigned:'Tom Nguyen', cost:0, by:'Schedule', result:'', tags:[], every:'every 60 days', total:18, checked:0 }); render(); openSchedules(); toast('Schedule added · first cycle due ' + fmtD(addD(TODAY, 21)), undo); break; }
    case 'reports': closeLayer(); openDialog(`<div class="hd"><div class="t-overline">Test &amp; tag</div><h2 style="font-size:18px">Reports</h2></div><div class="bd" style="gap:0">${['Asset register|Every item with its current status, for auditors and insurers','Overdue and failed|Items that need action now','Test session|Results from a session in a date range','Item history|Full history for one tag','Upcoming tests|The schedule for a date range','Equipment classes|Fleet by class and appliance type','Tester activity|Tests by each tester','Failure log|Failures with reasons and actions','Bulk asset status|Bulk lead batches','Compliance statement|AS/NZS 3760 statement for clients or venues'].map(x => { const [n, d] = x.split('|'); return `<div class="rep"><div><div style="font-weight:600">${n}</div><div class="d">${d}</div></div><button data-act="repgo" data-n="${n}">PDF</button><button data-act="repgo" data-n="${n}" style="margin-left:6px">CSV</button></div>`; }).join('')}</div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Done</button></div>`); break;
    case 'repgo': toast(`${el.dataset.n} · ${el.textContent} generated`); break;
    case 'undo': if (state.undo) { state.undo(); state.undo = null; } $('#toast').classList.remove('open'); break;
    case 'toastclose': $('#toast').classList.remove('open'); break;
  }
}
function openSchedules() {
  const ss = D.maintenance.filter(r => r.src === 'schedule');
  openDialog(`<div class="hd"><div class="t-overline">Maintenance</div><h2 style="font-size:18px">Service schedules</h2></div><div class="bd" style="gap:0">${ss.map(r => `<div class="rep"><div><div style="font-weight:600">${esc(r.title)} · ${esc(r.model)}</div><div class="d">${esc(r.every)} · next ${fmtD(r.due)} · ${r.total} units · ${esc(r.assigned)}</div></div><button data-act="schedoff" data-id="${r.id}" style="color:var(--t-out)">Deactivate</button></div>`).join('') || '<div class="empty"><b>No schedules</b>Recurring service shows up as rows in Maintenance.</div>'}</div><div class="ft"><button class="lnk" data-act="schednew">+ New schedule</button><div style="flex:1"></div><button class="btn btn-secondary" data-act="close">Done</button></div>`);
}
document.addEventListener('input', ev => { if (ev.target.id === 'q') { state.q = ev.target.value; state.page = 0; state.savedView = null; render(); } });
window.addEventListener('popstate', () => { applyHash(); render(); });
window.addEventListener('hashchange', () => { const p = new URLSearchParams(location.hash.slice(1)); if (p.get('list') !== state.list || (p.get('seg') || cur().defSeg) !== state.seg) { applyHash(); render(); } });
$('.phonehead > div').innerHTML = `<button class="ell phtitle" data-act="listmenu" aria-label="Switch list" style="font-family:var(--display);font-weight:800;font-size:16px"><span id="phname"></span><span class="chev">▾</span></button><div class="ell t-micro muted" id="phonesub"></div>`;
applyHash(); render();
