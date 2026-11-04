// node gearlists-check.cjs  (run from this directory; NODE_PATH=<global node_modules>)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const errs = [];
  const run = async (w, h, tag) => {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    p.on('pageerror', e => errs.push(tag + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|Content-Security-Policy/.test(m.text())) errs.push(tag + ' console: ' + m.text()); });
    await p.goto('file://' + process.cwd() + '/gearlists-prototype.html'); await p.waitForTimeout(400);
    const D = tag === 'desk';
    const log = s => console.log(tag, s);
    const rowSel = D ? '#tblwrap tr.row' : '#list .lrow[data-act=open]';
    const cb = rowSel + ' .cb';
    const rc = () => p.locator(rowSel).count();
    const strip = async () => (await p.locator('#strip button').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim()).join(' | ');
    const toastTxt = async () => (await p.locator('#toast').textContent()).trim().replace(/\s+/g, ' ');
    const hash = () => p.evaluate(() => location.hash);
    const shot = n => p.screenshot({ path: `shots/${tag}-${n}.png` });
    const sw = async k => { if (D) await p.click(`#sidenav a[data-k="${k}"]`); else { await p.click('.phonehead [data-act=listmenu]'); await p.waitForTimeout(150); await p.click(`.sheetwrap [data-act=list][data-k="${k}"]`); } await p.waitForTimeout(150); };
    const seg = async k => { await p.click(`#strip button[data-k="${k}"]`); await p.waitForTimeout(80); };
    const tickRange = async (a, z) => { await p.click(cb + ` >> nth=${a}`); await p.click(cb + ` >> nth=${z}`, { modifiers: ['Shift'] }); await p.waitForTimeout(80); };
    const bulkTxt = async () => (await p.locator('#bulk').textContent()).trim().replace(/\s+/g, ' ');
    const verb = async k => { await p.click(`#bulk [data-act=verb][data-k="${k}"]`); await p.waitForTimeout(120); };
    const undo = async () => { await p.click('#toast [data-act=undo]'); await p.waitForTimeout(100); };
    const pageMenu = async () => { await p.click(D ? '.lphead [data-act=pagemenu]' : '.phonehead [data-act=pagemenu]'); await p.waitForTimeout(150); };
    const rowMenu = async n => { if (D) await p.hover(rowSel + ` >> nth=${n}`); await p.click(rowSel + ` >> nth=${n} >> .dots`); await p.waitForTimeout(150); };
    const itemTxt = async () => (await p.locator('.menu button, .menu a, .sheetwrap .item').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim()).join(' | ');
    const field = async (name, v) => { await p.fill(`#layerbody [data-v="${name}"]`, v); };

    // ---- MODELS
    log('nav lists: ' + (D ? (await p.locator('#sidenav a[data-act=list]').allTextContents()).map(s => s.trim()).join(' | ') : 'phone uses the title sheet'));
    log('MODELS strip: ' + await strip()); log('rows: ' + await rc() + ' foot: ' + (await p.locator('#foot').textContent()).trim().replace(/\s+/g, ' ')); log('hash: ' + await hash());
    await shot('models');
    for (const k of ['stock', 'nostock', 'due', 'arch', 'all']) { await seg(k); log(`models seg ${k}: ${await rc()} rows`); }
    await seg('nostock'); log('no stock rows: ' + (await p.locator(rowSel).allTextContents()).map(s => s.replace(/\s+/g, ' ').slice(0, 40)).join(' || ')); await seg('all');
    await p.click('[data-act=fmenu][data-k=cat]'); await p.waitForTimeout(120); await p.click('[data-act=ftoggle][data-v="Lighting"]'); await p.keyboard.press('Escape');
    log('fwords: ' + (await p.locator('#fwords .fw').allTextContents()).join(' | ') + ' rows ' + await rc() + ' hash ' + await hash());
    await p.click('[data-act=clearf]'); await p.fill('#q', 'aura'); await p.waitForTimeout(80); log('search aura rows: ' + await rc()); await p.fill('#q', ''); await p.waitForTimeout(80);
    if (D) { await p.click('th button[data-k=day]'); await p.waitForTimeout(80); log('sort day first: ' + (await p.locator(rowSel + ' >> nth=0').textContent()).replace(/\s+/g, ' ').slice(0, 50)); await p.click('th button[data-k=name]'); await p.click('th button[data-k=name]'); await p.click('th button[data-k=name]'); }
    await tickRange(0, 3); log('bulk: ' + await bulkTxt()); await shot('models-sel');
    await verb('rates'); await field('val', '10'); await p.selectOption('#layerbody [data-v=op]', 'pct'); await shot('models-ratesdlg'); await p.click('[data-act=verbgo]'); await p.waitForTimeout(120);
    log('rates toast: ' + await toastTxt()); await undo(); log('bulk after undo: ' + await p.locator('#bulk.open').count());
    await tickRange(0, 1); await verb('archive'); log('archive dialog: ' + (await p.locator('.dlg h2').textContent())); await p.click('[data-act=verbgo]'); await p.waitForTimeout(100); log('archive toast: ' + await toastTxt()); await undo();
    await rowMenu(0); log('row menu: ' + await itemTxt()); await shot('models-rowmenu'); await p.keyboard.press('Escape');
    await pageMenu(); log('page menu: ' + await itemTxt()); await shot('models-pagemenu'); if (D) { await p.click('.menu [data-act=colsmenu]'); await p.waitForTimeout(100); await p.click('[data-act=coltoggle][data-c=value]'); await p.waitForTimeout(100); await p.click('.lphead [data-act=pagemenu]'); await p.waitForTimeout(100); await p.click('[data-act=colsmenu]'); await p.waitForTimeout(100); await p.click('[data-act=coltoggle][data-c=roi]'); await p.waitForTimeout(100); log('opt cols: ' + (await p.locator('th').allTextContents()).map(s => s.trim()).join('|')); await shot('models-cols'); await p.click('.lphead [data-act=pagemenu]'); await p.waitForTimeout(100); await p.click('[data-act=colsmenu]'); await p.click('[data-act=coltoggle][data-c=value]'); await p.click('.lphead [data-act=pagemenu]'); await p.waitForTimeout(100); await p.click('[data-act=colsmenu]'); await p.click('[data-act=coltoggle][data-c=roi]'); } else await p.keyboard.press('Escape');
    await p.click('[data-act=viewsmenu]'); await p.waitForTimeout(100); await p.click('[data-act=applyview] >> nth=0'); await p.waitForTimeout(100); log('view: ' + (await p.locator('#views .fw').textContent()) + ' / ' + await rc()); await p.click('[data-act=clearf]'); await seg('all');
    const before = await p.locator('#count').textContent();
    await p.click(D ? '#primary' : '#phoneprimary'); await p.waitForTimeout(150); await field('name', 'Elation Fuze Wash'); await p.click('[data-act=newgo]'); await p.waitForTimeout(100); log('new model: count ' + before + ' -> ' + (await p.locator('#count').textContent()) + ' ' + await toastTxt()); await undo(); log('after undo count ' + await p.locator('#count').textContent());
    await p.locator(rowSel + ' >> nth=0').click({ position: { x: 120, y: 12 } }).catch(() => {}); await p.waitForTimeout(400); log('model row opens: ' + p.url().slice(-40)); await (p.url().includes('gearlists-prototype.html') && !p.url().startsWith('chrome') && p.url().startsWith('file') ? 0 : p.goBack().catch(() => {})); await p.waitForTimeout(300);
    if (!D) { await p.locator('#list').scrollIntoViewIfNeeded(); }

    // ---- KITS
    await sw('kits'); log('KITS strip: ' + await strip() + ' rows ' + await rc() + ' hash ' + await hash()); await shot('kits');
    await seg('missing'); log('missing rows: ' + (await p.locator(rowSel).allTextContents()).map(s => s.replace(/\s+/g, ' ').slice(0, 70)).join(' || '));
    await seg('onjob'); log('on a job rows: ' + await rc()); await tickRange(0, 1); log('kits bulk: ' + await bulkTxt());
    await verb('kreturn'); log('force return dlg: ' + await p.locator('.dlg h2').textContent()); await p.click('[data-act=verbgo]'); await p.waitForTimeout(100); log('toast: ' + await toastTxt()); await undo();
    await seg('all'); await tickRange(0, 0); await verb('dup'); log('dup toast: ' + await toastTxt()); await undo(); log('kits foot: ' + (await p.locator('#foot').textContent()).trim().replace(/\s+/g, ' '));
    await tickRange(0, 0); await verb('archive'); await p.click('[data-act=verbgo]'); await p.waitForTimeout(100); log('archive toast: ' + await toastTxt()); await undo();
    await pageMenu(); log('kits page menu: ' + await itemTxt()); await p.click('.menu [data-act=showarch], .sheetwrap [data-act=showarch]'); await p.waitForTimeout(100); log('show retired rows: ' + await rc()); await pageMenu(); await p.click('[data-act=showarch]'); await p.waitForTimeout(100);

    // ---- LOCATIONS
    await sw('locations'); log('LOCATIONS strip: ' + await strip() + ' rows ' + await rc()); await shot('locations');
    for (const k of ['warehouses', 'vehicles', 'sites', 'empty', 'all']) { await seg(k); log(`locations seg ${k}: ${await rc()}`); }
    await p.click('[data-act=fmenu][data-k=type]'); await p.waitForTimeout(100); await p.click('[data-act=ftoggle][data-v="Vehicle"]'); await p.keyboard.press('Escape'); log('type filter rows: ' + await rc()); await p.click('[data-act=clearf]');
    await p.fill('#q', 'warehouse a'); await p.waitForTimeout(80); log('search rows: ' + await rc()); await p.fill('#q', ''); await p.waitForTimeout(80);
    await seg('warehouses'); await tickRange(0, 1); log('loc bulk: ' + await bulkTxt()); await verb('lmove'); await p.selectOption('#layerbody [data-v=dest]', { index: 3 }); await p.click('[data-act=verbgo]'); await p.waitForTimeout(100); log('move toast: ' + await toastTxt()); await undo();
    await seg('all'); await tickRange(0, 5); log('loc bulk (mixed): ' + await bulkTxt()); await verb('archive'); await p.click('[data-act=verbgo]'); await p.waitForTimeout(100); log('archive toast (gated): ' + await toastTxt()); await undo();

    // ---- MAINTENANCE
    await sw('maintenance'); log('MAINTENANCE strip: ' + await strip() + ' rows ' + await rc() + ' hash ' + await hash());
    await seg('overdue'); log('overdue rows: ' + (await p.locator(rowSel).allTextContents()).map(s => s.replace(/\s+/g, ' ').slice(0, 50)).join(' || ')); await shot('maintenance-overdue');
    await seg('scheduled'); log('scheduled rows: ' + await rc()); await seg('done'); log('done rows: ' + await rc() + ' first: ' + (await p.locator(rowSel + ' >> nth=0').textContent()).replace(/\s+/g, ' ').slice(0, 90)); await seg('open');
    await p.click('[data-act=fmenu][data-k=who]'); await p.waitForTimeout(100); await p.click('[data-act=ftoggle][data-v="Sam Okafor"]'); await p.keyboard.press('Escape'); log('assigned filter rows: ' + await rc()); await p.click('[data-act=clearf]');
    await tickRange(0, 2); log('maint bulk: ' + await bulkTxt()); await shot('maintenance-sel');
    await verb('assign'); await p.selectOption('#layerbody [data-v=who]', 'Mel Torres').catch(() => p.selectOption('#layerbody [data-v=who]', { index: 1 })); await p.click('[data-act=verbgo]'); await p.waitForTimeout(100); log('assign toast: ' + await toastTxt()); await undo();
    await tickRange(0, 2); await verb('resched'); await field('d', '2026-11-20'); await p.click('[data-act=verbgo]'); await p.waitForTimeout(100); log('resched toast: ' + await toastTxt()); await undo();
    await tickRange(0, 2); await verb('done'); log('done toast: ' + await toastTxt()); log('open after done: ' + (await strip())); await undo();
    await rowMenu(0); log('maint row menu: ' + await itemTxt()); await p.keyboard.press('Escape');
    await p.fill('#q', 'hoist'); await p.waitForTimeout(80); log('hoist rows: ' + await rc()); await rowMenu(0); log('schedule row menu: ' + await itemTxt()); await p.click('.menu [data-act=verb][data-k=checkoff], .sheetwrap [data-act=verb][data-k=checkoff]'); await p.waitForTimeout(100); log('checkoff toast: ' + await toastTxt()); await undo(); await p.fill('#q', ''); await p.waitForTimeout(80);
    await p.fill('#q', 'AURA-06'); await p.waitForTimeout(80); log('AURA-06 rows: ' + await rc()); await p.locator(rowSel + ' >> nth=0').click({ position: { x: 120, y: 12 } }); await p.waitForTimeout(400); log('AURA-06 opens: ' + p.url().slice(-40)); await (p.url().includes('gearlists-prototype.html') && !p.url().startsWith('chrome') && p.url().startsWith('file') ? 0 : p.goBack().catch(() => {})); await p.waitForTimeout(300); await p.fill('#q', ''); await p.waitForTimeout(80);
    await rowMenu(0); await p.click('.menu [data-act=verb][data-k=del], .sheetwrap [data-act=verb][data-k=del]'); await p.waitForTimeout(100); log('delete dialog: ' + await p.locator('.dlg h2').textContent()); await p.click('[data-act=verbgo]'); await p.waitForTimeout(100); log('delete toast: ' + await toastTxt()); await undo();
    await pageMenu(); await p.click('[data-act=schedules]'); await p.waitForTimeout(150); log('schedules dialog rows: ' + await p.locator('.dlg .rep').count()); await shot('maintenance-schedules'); await p.click('.dlg [data-act=schedoff] >> nth=0'); await p.waitForTimeout(100); log('deactivate: ' + await toastTxt()); await undo(); await p.keyboard.press('Escape');
    await p.click(D ? '#primary' : '#phoneprimary'); await p.waitForTimeout(150); await field('asset', 'AURA-03'); await field('title', 'Test issue'); await p.click('[data-act=newgo]'); await p.waitForTimeout(100); log('new maint: ' + await toastTxt()); await undo();
    await seg('open'); await p.click('[data-act=fmenu][data-k=type]'); await p.waitForTimeout(100); await p.click('[data-act=ftoggle][data-v="Repair"]'); await p.keyboard.press('Escape'); await p.fill('#q', 'zzzz'); await p.waitForTimeout(80); log('empty: ' + (await p.locator(D ? '#tblwrap .empty' : '#list .empty').textContent()).replace(/\s+/g, ' ')); await shot('maintenance-empty'); await p.click('[data-act=clearf]');

    // ---- TEST & TAG
    await sw('tt'); log('T&T strip: ' + await strip() + ' rows ' + await rc() + ' hash ' + await hash()); await shot('tt');
    log('first rows: ' + (await p.locator(rowSel).allTextContents()).slice(0, 3).map(s => s.replace(/\s+/g, ' ').slice(0, 80)).join(' || '));
    for (const k of ['overdue', 'passed', 'failed', 'all']) { await seg(k); log(`tt seg ${k}: ${await rc()}`); }
    await seg('all'); log('tt foot: ' + (await p.locator('#foot').textContent()).trim().replace(/\s+/g, ' ')); if (!D) { await p.locator('[data-act=more]').scrollIntoViewIfNeeded(); await p.click('[data-act=more]'); await p.waitForTimeout(100); log('after more: ' + await rc()); }
    await seg('overdue'); await tickRange(0, 1); log('tt bulk: ' + await bulkTxt()); await verb('tsched'); await p.click('[data-act=verbgo]'); await p.waitForTimeout(100); log('tsched toast: ' + await toastTxt()); await undo();
    await tickRange(0, 1); if (D) { await verb('tprint'); log('print toast: ' + await toastTxt()); }
    await pageMenu(); log('tt page menu: ' + await itemTxt()); await p.click('[data-act=reports]'); await p.waitForTimeout(150); log('reports: ' + await p.locator('.dlg .rep').count()); await shot('tt-reports'); await p.click('[data-act=repgo] >> nth=0'); log('report toast: ' + await toastTxt()); await p.keyboard.press('Escape');
    await seg('due'); await p.locator(rowSel + ' >> nth=0').click({ position: { x: 120, y: 12 } }); await p.waitForTimeout(400); log('tt first row opens: ' + p.url().slice(-40)); await (p.url().includes('gearlists-prototype.html') && !p.url().startsWith('chrome') && p.url().startsWith('file') ? 0 : p.goBack().catch(() => {})); await p.waitForTimeout(300);
    await p.click(D ? '#primary' : '#phoneprimary'); await p.waitForTimeout(150); await field('tag', 'AURA-03'); await p.click('[data-act=newgo]'); await p.waitForTimeout(100); log('register: ' + await toastTxt()); await undo();

    // ---- SALES STOCK
    await sw('sales'); log('SALES strip: ' + await strip() + ' rows ' + await rc()); await shot('sales');
    await seg('low'); log('low rows: ' + await rc()); await seg('out'); log('out rows: ' + (await p.locator(rowSel).allTextContents()).map(s => s.replace(/\s+/g, ' ').slice(0, 60)).join(' || ')); await seg('all');
    await rowMenu(0); log('sales row menu: ' + await itemTxt()); await p.click('.menu [data-act=verb][data-k=adjust], .sheetwrap [data-act=verb][data-k=adjust]'); await p.waitForTimeout(100); await field('delta', '24'); await field('why', 'Received PO #1234'); await p.click('[data-act=verbgo]'); await p.waitForTimeout(100); log('adjust toast: ' + await toastTxt()); await undo();
    log('primary label: ' + await p.locator(D ? '#primary' : '#phoneprimary').textContent()); await p.click(D ? '#primary' : '#phoneprimary'); await p.waitForTimeout(150); log('reorder dialog: ' + await p.locator('.dlg h2').textContent()); await shot('sales-reorder'); await p.click('[data-act=verbgo]'); await p.waitForTimeout(100); log('reorder toast: ' + await toastTxt()); log('primary after: ' + await p.locator(D ? '#primary' : '#phoneprimary').textContent()); await undo();

    // ---- OVERBOOKINGS
    await sw('overbookings'); log('OVERBOOKINGS strip: ' + await strip() + ' rows ' + await rc()); await shot('overbookings');
    log('week rows: ' + (await p.locator(rowSel).allTextContents()).map(s => s.replace(/\s+/g, ' ').slice(0, 70)).join(' || '));
    await seg('next30'); log('30d rows: ' + await rc()); await seg('all'); log('all rows: ' + await rc()); await seg('week');
    await p.click('[data-act=fmenu][data-k=kind]'); await p.waitForTimeout(100); await p.click('[data-act=ftoggle][data-v="Crew"]'); await p.keyboard.press('Escape'); log('crew filter rows: ' + await rc()); await p.click('[data-act=clearf]');
    log('primary: ' + await p.locator(D ? '#primary' : '#phoneprimary').textContent());
    await tickRange(0, 2); log('over bulk: ' + await bulkTxt()); await shot('overbookings-sel'); await verb('subhire'); await shot('overbookings-dlg'); await p.selectOption('#layerbody [data-v=sup]', 'Big Picture'); await p.click('[data-act=verbgo]'); await p.waitForTimeout(100); log('subhire toast: ' + await toastTxt()); log('primary after: ' + await p.locator(D ? '#primary' : '#phoneprimary').textContent()); await shot('overbookings-covered'); await undo(); log('primary after undo: ' + await p.locator(D ? '#primary' : '#phoneprimary').textContent());
    await p.click(D ? '#primary' : '#phoneprimary'); await p.waitForTimeout(150); log('primary dialog: ' + await p.locator('.dlg h2').textContent()); await p.keyboard.press('Escape');
    await rowMenu(0); log('over row menu: ' + await itemTxt()); await p.keyboard.press('Escape');
    await p.locator(rowSel + ' >> nth=0').click({ position: { x: 150, y: 12 } }); await p.waitForTimeout(500); log('overbooking row opens: ' + p.url().slice(0, 60)); await (p.url().includes('gearlists-prototype.html') && !p.url().startsWith('chrome') && p.url().startsWith('file') ? 0 : p.goBack().catch(() => {})); await p.waitForTimeout(500);
    log('hash after back: ' + await hash());

    // ---- URL state round trip + page menus of the rest
    await p.goto('file://' + process.cwd() + '/gearlists-prototype.html#list=maintenance&seg=overdue&f.type=Repair'); await p.waitForTimeout(300); log('deep link: strip on = ' + (await p.locator('#strip button.on').textContent()).replace(/\s+/g, ' ') + ' rows ' + await rc() + ' filter ' + (await p.locator('#fwords .fw.on').first().textContent()));
    await p.goto('file://' + process.cwd() + '/gearlists-prototype.html'); await p.waitForTimeout(300);
    if (!D) { await p.click('.phonehead [data-act=pagemenu]'); await p.waitForTimeout(200); log('phone page menu: ' + await itemTxt()); await shot('pagemenu'); await p.keyboard.press('Escape'); await p.click('.phonehead [data-act=listmenu]'); await p.waitForTimeout(200); await shot('listmenu'); await p.keyboard.press('Escape'); log('phoneact visible: ' + await p.locator('#phoneact').isVisible()); await p.click(cb + ' >> nth=0'); log('phoneact when selected: ' + await p.locator('#phoneact').isVisible() + ' bulk open: ' + await p.locator('#bulk.open').count()); await p.click('[data-act=clearsel]'); }
    await p.close();
  };
  await run(1440, 900, 'desk'); await run(390, 844, 'phone');
  console.log('errors:', errs);
  await b.close();
})();
