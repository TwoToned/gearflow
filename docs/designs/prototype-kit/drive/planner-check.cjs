// Drive: node planner-check.cjs [file.html]  (run from this directory; shots land in shots/)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const errs = [];
  const run = async (w, h, tag) => {
    const ph = tag === 'phone';
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    p.on('pageerror', e => errs.push(tag + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(tag + ' console: ' + m.text()); });
    await p.goto('file://' + process.cwd() + '/' + (process.argv[2] || 'planner-prototype.html')); await p.waitForTimeout(500);
    const log = s => console.log(tag, s), T = async sel => (await p.locator(sel).first().textContent()).trim().replace(/\s+/g, ' ');
    const wait = (n = 120) => p.waitForTimeout(n), shot = n => p.screenshot({ path: `shots/${tag}-${n}.png` });
    const toast = async () => (await p.locator('#toast').textContent()).trim().replace(/\s+/g, ' ');
    const count = sel => p.locator(sel).count();
    log('strip: ' + (await p.locator('#strip button').allTextContents()).map(s => s.replace(/\s+/g, ' ')).join(' | '));
    log('views: ' + (await p.locator(ph ? '#phoneviews .fw' : '#viewsw .fw').allTextContents()).join(' | ') + ' · primary: ' + await T(ph ? '#phoneprimary' : '#primary'));
    if (ph) { log('day chips: ' + (await p.locator('#daychips .chip').allTextContents()).join(' | ')); log('cards: ' + await count('#list .lrow')); await shot('day-tue'); }
    else { log('people rows: ' + await count('.pgrid tbody tr') + ' blocks: ' + await count('.blk') + ' dim: ' + await count('.blk.dim')); await shot('planner'); }
    // ---- segments
    await p.click('#strip [data-k=needs]'); await wait();
    log('needs rows: ' + await count(ph ? '#list .lrow' : '#tblwrap tr.row') + ' first: ' + (await T(ph ? '#list .lrow' : '#tblwrap tr.row')).slice(0, 70)); await shot('needs');
    await p.click((ph ? '#list .lrow' : '#tblwrap tr.row') + ' .cb >> nth=0'); await p.click((ph ? '#list .lrow' : '#tblwrap tr.row') + ' .cb >> nth=1', { modifiers: ['Shift'] }); await wait();
    log('needs bulk: ' + await T('#bulk')); await shot('needs-sel');
    await p.click('[data-act=bulksugg]'); await wait(); log('suggest toast: ' + await toast());
    log('needs after: ' + await count(ph ? '#list .lrow' : '#tblwrap tr.row') + ' strip ' + (await T('#strip [data-k=needs]')));
    await p.click('[data-act=undo]'); await wait(); log('needs after undo: ' + await count(ph ? '#list .lrow' : '#tblwrap tr.row') + ' bulk open ' + await count('#bulk.open'));
    // open slot row menu
    await p.click((ph ? '#list .lrow' : '#tblwrap tr.row') + ' .dots >> nth=0'); await wait(150); log('open menu: ' + (await p.locator('.menu button, .menu a, .sheetwrap .item, .sheetwrap a').allTextContents()).map(s => s.trim().replace(/\s+/g, ' ')).join(' | ')); await shot('openmenu');
    await p.click('[data-act=openoffer]'); await wait(150); log('offer from slot: ' + await T('.dlg .hd')); log('person preselected: ' + await p.locator('#o-p').inputValue() + ' svc: ' + await p.locator('#o-s option:checked').textContent()); await shot('offer-slot');
    await p.click('[data-act=close] >> nth=1').catch(() => {}); await p.keyboard.press('Escape'); await wait();
    // ---- unconfirmed, mine
    await p.click('#strip [data-k=unconfirmed]'); await wait(); log('unconfirmed rows: ' + (ph ? await count('#list .lrow') : await count('.pgrid tbody tr') + ' dim ' + await count('.blk.dim')));
    await p.click('#strip [data-k=mine]'); await wait(); log('mine rows: ' + (ph ? await count('#list .lrow') : await count('.pgrid tbody tr') + ' dim ' + await count('.blk.dim')));
    await p.click('#strip [data-k=all]'); await wait();
    // ---- filters
    await p.click('#fwords [data-k=role]'); await wait(150); await shot('rolemenu');
    await p.click('[data-act=ftoggle] >> nth=1'); await wait(); await p.keyboard.press('Escape'); await wait();
    log('fwords: ' + (await p.locator('#fwords .fw').allTextContents()).join(' | ') + ' rows: ' + (ph ? await count('#list .lrow') : await count('.pgrid tbody tr')));
    await p.click('[data-act=clearf]'); await wait();
    for (const k of ['skill', 'job', 'avail']) { await p.click(`#fwords [data-k=${k}]`); await wait(100); await p.click('[data-act=ftoggle] >> nth=0'); await wait(100); await p.keyboard.press('Escape'); await wait(); log(`${k}: ` + (await p.locator('#fwords .fw.on').allTextContents()).join(' | ') + ' rows: ' + (ph ? await count('#list .lrow') : await count('.pgrid tbody tr'))); await p.click('[data-act=clearf]'); await wait(); }
    await p.fill('#q', 'lena'); await wait(); log('search lena rows: ' + (ph ? await count('#list .lrow') : await count('.pgrid tbody tr')));
    await p.fill('#q', 'zzzz'); await wait(); log('empty: ' + await T('.empty')); await shot('empty'); await p.fill('#q', ''); await wait();
    // ---- week navigation
    await p.click('[data-act=wk][data-d="1"]'); await wait(); log('next week: ' + await T('#wknav .wk') + ' strip ' + (await p.locator('#strip button').allTextContents()).map(s => s.replace(/\s+/g, ' ')).join(' | '));
    await p.click('[data-act=wk][data-d="-1"]'); await p.click('[data-act=wk][data-d="-1"]'); await wait(); log('last week: ' + await T('#wknav .wk') + ' blocks ' + await count('.blk') + (ph ? '' : ' hours cell: ' + await T('.pgrid tbody tr:nth-child(4) td.hrs'))); await shot('lastweek');
    await p.click('[data-act=wk][data-d="0"]'); await wait(); log('today -> ' + await T('#wknav .wk'));
    // ---- empty cell → offer sheet
    if (ph) { await p.click('#daychips .chip >> nth=2'); await wait(); await p.locator('#list .lrow[data-act=cell]').first().click(); }
    else { await p.locator('td.day.free[data-act=cell]').nth(3).click(); }
    await wait(150); log('offer sheet: ' + await T('.dlg .hd')); await shot('offer');
    const ariDay = '2026-11-11'; await p.selectOption('#o-d', ariDay); await wait(100); await p.selectOption('#o-p', { label: /Ari Nguyen/ }.test ? undefined : undefined).catch(() => {});
    await p.selectOption('#o-p', 'c7'); await wait(100); log('avail line (Ari Tue): ' + await T('.availline'));
    await p.selectOption('#o-d', '2026-11-12'); await wait(100); await p.selectOption('#o-p', 'c3'); await wait(100); log('avail line (Jess Wed): ' + await T('.availline') + ' svc: ' + await p.locator('#o-s option:checked').textContent());
    await shot('offer-jess');
    await p.click('#o-send'); await wait(60); log('send off → button: ' + await T('#dlg-go')); await p.click('#o-send'); await wait(60);
    await p.click('#dlg-go'); await wait(); log('offer toast: ' + await toast()); await p.click('[data-act=undo]'); await wait(); log('after undo blocks: ' + await count('.blk') + ' cards ' + await count('#list .lrow'));
    // primary
    await p.click(ph ? '#phoneprimary' : '#primary'); await wait(150); await p.click('#dlg-go'); await wait(); log('no person: ' + await toast()); await p.keyboard.press('Escape'); await wait();
    // ---- selection & bulk on calls
    if (!ph) {
      await p.click('.blk .cb >> nth=0'); await p.click('.blk .cb >> nth=5', { modifiers: ['Shift'] }); await wait(); log('bulk calls: ' + await T('#bulk')); await shot('bulk');
      await p.click('#strip [data-k=unconfirmed]'); await wait();
    }
    await p.click('#strip [data-k=all]'); await wait(); await p.click('[data-act=clearsel]').catch(() => {});
    if (!ph) {
      await p.click('[data-act=selall]'); await wait(); log('select-all bulk: ' + await T('#bulk')); await shot('selall');
      await p.click('[data-act=bulkoffer]'); await wait(); log('bulk offer toast: ' + await toast()); await p.click('[data-act=undo]'); await wait();
      await p.click('[data-act=selall]'); await p.click('[data-act=selall]'); await wait();
      // pick the confirmable ones: tick Dev (accepted) & Mia (accepted)
      const acc = p.locator('.blk', { hasText: 'Accepted' }); const n = await acc.count();
      for (let i = 0; i < n; i++) await acc.nth(i).locator('.cb').click();
      await wait(); log('accepted ticked: ' + n + ' bulk: ' + await T('#bulk')); await p.click('[data-act=bulkconfirm]'); await wait(); log('bulk confirm toast: ' + await toast()); await p.click('[data-act=undo]'); await wait();
      await p.locator('.blk .cb').nth(2).click(); await wait(); await p.click('[data-act=bulkcancel]'); await wait(150); log('cancel dialog: ' + (await T('.dlg h2'))); await shot('cancel'); await p.click('[data-act=cancelgo]'); await wait(); log('cancel toast: ' + await toast() + ' strip ' + await T('#strip [data-k=needs]')); await p.click('[data-act=undo]'); await wait(); log('after undo needs: ' + await T('#strip [data-k=needs]'));
      // block menu + edit
      await p.hover('.blk >> nth=1'); await p.click('.blk >> nth=1 >> .dots'); await wait(150); log('block menu: ' + (await p.locator('.menu button, .menu a').allTextContents()).map(s => s.trim().replace(/\s+/g, ' ')).join(' | ')); await shot('blockmenu'); await p.keyboard.press('Escape');
      await p.locator('.blk .b2 >> nth=1').click(); await wait(150); log('edit dialog: ' + await T('.dlg h2')); await shot('call-edit'); await p.fill('#e-rate', '455'); await p.click('[data-act=callgo]'); await wait(); log('edit toast: ' + await toast()); await p.click('[data-act=undo]'); await wait();
      // pending → offer via menu
      await p.locator('.blk', { hasText: 'Pending' }).first().hover(); await p.locator('.blk', { hasText: 'Pending' }).first().locator('.dots').click(); await wait(150); await p.click('[data-act=callstatus]'); await wait(); log('offer one toast: ' + await toast()); await p.click('[data-act=undo]'); await wait();
    } else {
      await p.click('#list .lrow[data-act=call] .cb >> nth=0'); await p.click('#list .lrow[data-act=call] .cb >> nth=1', { modifiers: ['Shift'] }).catch(() => {}); await wait(); log('phone bulk: ' + await T('#bulk') + ' · phoneact visible ' + await p.locator('#phoneact').isVisible()); await shot('bulk'); await p.click('[data-act=clearsel]'); await wait();
      log('phoneact visible after clear: ' + await p.locator('#phoneact').isVisible());
      await p.locator('#list .lrow[data-act=call]').first().click({ position: { x: 150, y: 20 } }); await wait(150); log('card tap → ' + await T('.dlg h2')); await shot('call-edit'); await p.keyboard.press('Escape'); await wait();
      await p.click('#list .lrow[data-act=call] .dots >> nth=0'); await wait(150); await shot('cardmenu'); await p.keyboard.press('Escape'); await wait();
    }
    // ---- page menu + roles
    await p.click(ph ? '.phonehead [data-act=pagemenu]' : '.lphead [data-act=pagemenu]'); await wait(150); log('page menu: ' + (await p.locator('.menu button, .menu a, .sheetwrap .item, .sheetwrap a').allTextContents()).map(s => s.trim().replace(/\s+/g, ' ')).join(' | ')); await shot('pagemenu');
    await p.click('[data-act=roles]'); await wait(150); log('roles: ' + await count('.rolerow') + ' rows'); await shot('roles');
    await p.click('.rolerow .dots >> nth=1'); await wait(150); await p.click('[data-act=roleedit]'); await wait(150); log('role form: ' + await T('.dlg h2')); await shot('roleform'); await p.fill('#r-cost', '430'); await p.click('[data-act=rolego]'); await wait(); log('role toast: ' + await toast()); await p.click('[data-act=undo]'); await wait();
    await p.click('[data-act=rolenew]'); await wait(150); await p.fill('#r-name', 'Vision tech'); await p.fill('#r-cost', '460'); await p.click('[data-act=rolego]'); await wait(); log('new role: ' + await toast() + ' rows ' + await count('.rolerow'));
    await p.click('.rolerow .dots >> nth=2'); await wait(150); await p.click('[data-act=rolearch]'); await wait(150); log('archive dlg: ' + await T('.dlg h2')); await p.click('[data-act=rolearchgo]'); await wait(); log('archive: ' + await toast()); await p.click('[data-act=undo]'); await wait(); await p.keyboard.press('Escape'); await wait();

    // ================= Timesheets
    await p.click(ph ? '#phoneviews [data-v=timesheets]' : '#viewsw [data-v=timesheets]'); await wait();
    log('TS strip: ' + (await p.locator('#strip button').allTextContents()).map(s => s.replace(/\s+/g, ' ')).join(' | ') + ' · primary: ' + await T(ph ? '#phoneprimary' : '#primary'));
    const rows = ph ? '#list .lrow' : '#tblwrap tr.row';
    log('TS submitted rows: ' + await count(rows)); await shot('ts');
    const cb = rows + ' .cb';
    await p.click(cb + ' >> nth=0'); await p.click(cb + ' >> nth=3', { modifiers: ['Shift'] }); await wait(); log('TS bulk: ' + await T('#bulk')); await shot('ts-sel');
    await p.click('[data-act=bulkapprove]'); await wait(); log('TS approve toast: ' + await toast() + ' | rows now ' + await count(rows)); await p.click('[data-act=undo]'); await wait(); log('TS after undo rows: ' + await count(rows) + ' bulk open ' + await count('#bulk.open'));
    await p.click(cb + ' >> nth=0'); await p.click(cb + ' >> nth=1'); await wait(); await p.click('[data-act=bulkquery]'); await wait(150); log('query dlg: ' + await T('.dlg h2')); await shot('ts-query'); await p.fill('#q-note', 'Check the finish time'); await p.click('[data-act=querygo]'); await wait(); log('query toast: ' + await toast()); await p.click('[data-act=undo]'); await wait();
    await p.click(cb + ' >> nth=0'); await wait(); await p.click('[data-act=bulkexport]'); await wait(); log('export toast: ' + await toast()); await p.click('[data-act=clearsel]'); await wait();
    await p.click('#strip [data-k=approved]'); await wait(); log('approved rows: ' + await count(rows));
    await p.click('#strip [data-k=queried]'); await wait(); log('queried rows: ' + await count(rows) + ' · ' + (await T(rows)).slice(0, 110)); await shot('ts-queried');
    await p.click('#strip [data-k=all]'); await wait(); log('all rows (page 1): ' + await count(rows) + ' foot: ' + await T('#foot'));
    if (!ph) {
      await p.click('th button[data-k=total]'); await p.click('th button[data-k=total]'); await wait(); log('first total desc: ' + await T('#tblwrap tr.row >> nth=0 >> td.r.mono >> nth=1'));
      await p.click('th button[data-k=date]'); await wait();
      await p.hover('#tblwrap tr.row >> nth=0'); await p.click('#tblwrap tr.row >> nth=0 >> .dots'); await wait(150); log('row menu: ' + (await p.locator('.menu button, .menu a').allTextContents()).map(s => s.trim().replace(/\s+/g, ' ')).join(' | ')); await shot('ts-rowmenu'); await p.click('[data-act=tsedit]'); await wait(150); log('entry edit: ' + await T('.dlg h2')); await shot('ts-edit'); await p.fill('#t-br', '45'); await p.click('[data-act=tsgo]'); await wait(); log('edit toast: ' + await toast()); await p.click('[data-act=undo]'); await wait();
      await p.click('[data-act=page][data-d="1"]'); await wait(); log('page 2 rows: ' + await count(rows) + ' foot: ' + await T('#foot')); await p.click('[data-act=page][data-d="-1"]'); await wait();
    } else {
      await p.locator('[data-act=more]').scrollIntoViewIfNeeded(); await p.click('[data-act=more]'); await wait(); log('after more rows: ' + await count('#list .lrow'));
      await p.evaluate(() => document.querySelector('.content').scrollTo(0, 0));
      await p.click('#list .lrow .dots >> nth=0'); await wait(150); await shot('ts-cardmenu'); await p.keyboard.press('Escape'); await wait();
    }
    for (const k of ['person', 'job', 'status']) { await p.click(`#fwords [data-k=${k}]`); await wait(100); await p.click('[data-act=ftoggle] >> nth=1'); await wait(100); await p.keyboard.press('Escape'); await wait(); log(`TS ${k}: ` + (await p.locator('#fwords .fw.on').allTextContents()).join(' | ') + ' rows ' + await count(rows)); await p.click('[data-act=clearf]'); await wait(); }
    await p.click('#fwords [data-act=datesmenu]'); await wait(100); await p.click('[data-act=dateset][data-v=week]'); await wait(); log('TS dates: ' + (await p.locator('#fwords .fw.on').allTextContents()).join(' | ') + ' rows ' + await count(rows)); await p.click('[data-act=clearf]'); await wait();
    await p.click('#views [data-act=viewsmenu]'); await wait(100); await p.click('[data-act=applyview] >> nth=0'); await wait(); log('TS view: ' + await T('#views .fw') + ' strip on: ' + await T('#strip .on')); await p.click('[data-act=clearf]'); await wait();
    await p.fill('#q', 'dan'); await wait(); log('TS search dan: ' + await count(rows)); await p.fill('#q', 'zzzz'); await wait(); await shot('ts-empty'); log('TS empty: ' + await T('.empty')); await p.fill('#q', ''); await wait();
    await p.click(ph ? '#phoneprimary' : '#primary'); await wait(150); log('log time: ' + await T('.dlg h2')); await shot('ts-log'); await p.click('.dlg .cb >> nth=1'); await p.click('.dlg .cb >> nth=3'); await p.click('[data-act=tsgo]'); await wait(); log('log toast: ' + await toast()); await p.click('[data-act=undo]'); await wait();
    await p.click(ph ? '.phonehead [data-act=pagemenu]' : '.lphead [data-act=pagemenu]'); await wait(150); log('TS page menu: ' + (await p.locator('.menu button, .menu a, .sheetwrap .item, .sheetwrap a').allTextContents()).map(s => s.trim().replace(/\s+/g, ' ')).join(' | ')); await shot('ts-pagemenu');
    if (!ph) { await p.click('[data-act=colsmenu]'); await wait(100); await p.click('[data-act=coltoggle][data-c=by]'); await wait(); log('cols: by shown → headers ' + (await p.locator('#tblwrap th').allTextContents()).join('|')); await shot('ts-cols'); }
    else { await p.click('[data-act=exportdlg]'); await wait(150); log('export dlg: ' + await T('.dlg h2')); await p.keyboard.press('Escape'); }
    await p.click(ph ? '#phoneviews [data-v=planner]' : '#viewsw [data-v=planner]'); await wait(); log('back to planner: ' + await T('.crumb'));
    await p.close();
  };
  await run(1440, 900, 'desk'); await run(390, 844, 'phone');
  console.log('errors:', errs);
  await b.close();
})();
