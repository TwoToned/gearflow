// Drive: node schedule-check.cjs [file.html]  (run from this directory; shots land in shots/)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const errs = [];
  const run = async (w, h, tag) => {
    const ph = tag === 'phone';
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    p.on('pageerror', e => errs.push(tag + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(tag + ' console: ' + m.text()); });
    await p.goto('file://' + process.cwd() + '/' + (process.argv[2] || 'schedule-prototype.html')); await p.waitForTimeout(500);
    const log = s => console.log(tag, s), T = async sel => (await p.locator(sel).first().textContent()).trim().replace(/\s+/g, ' ');
    const wait = (n = 120) => p.waitForTimeout(n), shot = n => p.screenshot({ path: `shots/${tag}-${n}.png` });
    const toast = async () => (await p.locator('#toast').textContent()).trim().replace(/\s+/g, ' ');
    const count = sel => p.locator(sel).count();
    const strip = async () => (await p.locator('#strip button').allTextContents()).map(s => s.replace(/\s+/g, ' ')).join(' | ');
    const rows = ph ? '#list .lrow' : '.tlr', items = ph ? '.sheetwrap .item, .sheetwrap a' : '.menu button, .menu a';
    const close = async () => { await p.keyboard.press('Escape'); await wait(); };
    const stripk = k => p.click(`#strip [data-k=${k}]`);
    const nextDay = async n => { if (ph) { await p.click(`#daychips .chip >> nth=${n}`); await wait(); } };
    // ---------- initial
    log('count: ' + await T('#count') + ' · strip: ' + await strip()); log('views: ' + (await p.locator(ph ? '#phoneviews .fw' : '#viewsw .fw').allTextContents()).join(' | ') + ' · primary: ' + await T(ph ? '#phoneprimary' : '#primary') + ' href ' + (await p.locator(ph ? '#phoneprimary' : '#primary').getAttribute('href')));
    if (ph) { log('chips: ' + (await p.locator('#daychips .chip').allTextContents()).join(' | ')); log('cards on Thu 13: ' + await count(rows)); await shot('day-thu'); }
    else { log('rows: ' + await count('.tlr') + ' hard bars: ' + await count('.bar.hard') + ' pencilled bars: ' + await count('.bar.pen') + ' clash flags: ' + await count('.bar .dotw.err') + ' would-clash: ' + await count('.bar .dotw.warn') + ' day heads: ' + await count('.dh')); await shot('jobs-week'); }
    // ---------- strip segments
    for (const k of ['confirmed', 'pencilled', 'clashes', 'all']) { await stripk(k); await wait(); log(`seg ${k}: rows ${await count(rows)}`); }
    await stripk('clashes'); await wait(); await shot('clashes'); await stripk('all'); await wait();
    // ---------- range navigation and zoom
    await p.click('[data-act=nav][data-d="1"]'); await wait(); log('next: ' + await T('#wknav .wk') + ' rows ' + await count(rows) + ' · ' + await strip());
    await p.click('[data-act=nav][data-d="1"]'); await wait(); log('+2: ' + await T('#wknav .wk') + ' rows ' + await count(rows));
    await p.click('[data-act=nav][data-d="-1"]'); await p.click('[data-act=nav][data-d="-1"]'); await p.click('[data-act=nav][data-d="-1"]'); await wait(); log('prev: ' + await T('#wknav .wk') + ' rows ' + await count(rows)); await shot('lastweek');
    await p.click('[data-act=nav][data-d="0"]'); await wait(); log('today -> ' + await T('#wknav .wk'));
    if (!ph) {
      await p.click('[data-z=month]'); await wait(); log('month: ' + await T('#wknav .wk') + ' day cols ' + await count('.dh') + ' rows ' + await count('.tlr') + ' today col ' + await count('.tlh .dh.td')); await shot('jobs-month');
      await p.click('[data-act=nav][data-d="1"]'); await wait(); log('month next: ' + await T('#wknav .wk') + ' rows ' + await count('.tlr') + ' day cols ' + await count('.dh'));
      await p.click('[data-act=nav][data-d="0"]'); await wait(); log('month today: ' + await T('#wknav .wk'));
      await p.click('[data-z=week]'); await wait(); log('week again: ' + await T('#wknav .wk'));
    }
    // ---------- filters
    for (const k of ['status', 'cat', 'model', 'pm']) { await p.click(`#fwords [data-k=${k}]`); await wait(100); if (k === 'model' && !ph) await shot('modelmenu'); await p.click('[data-act=ftoggle] >> nth=' + (k === 'status' ? 4 : 1)); await wait(100); await p.keyboard.press('Escape'); await wait(); log(`${k}: ` + (await p.locator('#fwords .fw.on').allTextContents()).join(' | ') + ' rows: ' + await count(rows)); if (k === 'status') await shot('filter-status'); await p.click('[data-act=clearf]'); await wait(); }
    await p.fill('#q', 'qantas'); await wait(); log('search qantas rows: ' + await count(rows));
    await p.fill('#q', 'wireless'); await wait(); log('search model "wireless" rows: ' + await count(rows));
    await p.fill('#q', 'zzzz'); await wait(); log('empty: ' + await T('.empty')); await shot('empty'); await p.fill('#q', ''); await wait(); log('after clear rows: ' + await count(rows));
    // ---------- job sheet
    await nextDay(2);
    if (ph) await p.click('#list .lrow:has-text("#2342") .grow'); else await p.click('.bar:has-text("11 – 13")');
    await wait(150); log('job sheet: ' + await T(ph ? '.sheetwrap h2' : '.side h2') + ' | facts: ' + await T('.facts').then(s => s.slice(0, 150))); log('sheet clashes: ' + (await p.locator('.hrow').allTextContents()).map(s => s.replace(/\s+/g, ' ')).join(' ; '));
    log('open job href ' + (await p.locator('.sacts a.btn').getAttribute('href')) + ' · links ' + (await p.locator('.sacts a.lnk').allTextContents()).join(' | ')); await shot('jobsheet');
    // clash row → gear cell sheet → sub-hire
    await p.click('.hrow >> nth=0'); await wait(150); log('cell sheet: ' + await T(ph ? '.sheetwrap h2' : '.side h2') + ' · ' + (await p.locator('.sheetwrap .sh1, .side .sh1').first().textContent()).replace(/\s+/g, ' ').slice(0, 70)); log('held by: ' + (await p.locator('.hrow').allTextContents()).map(s => s.replace(/\s+/g, ' ')).join(' ; ')); await shot('cellsheet');
    await p.click('[data-act=subone]'); await wait(150); log('sub-hire dialog: ' + await T('.dlg .hd')); await shot('subhire');
    await p.selectOption('#sh-sup', 'Scene Change'); await p.click('#dlg-go'); await wait(); log('sub-hire toast: ' + await toast());
    if (!ph) { await p.click('#viewsw [data-v=gear]'); await wait(); log('gear after request: ' + await T('.gc.short >> nth=0')); }
    else { await p.click('#phoneviews [data-v=gear]'); await wait(); }
    await p.click('[data-act=undo]'); await wait(); log('undo → short cells: ' + await count(ph ? '#list .dotw.err' : '.gc.short') + ' requested: ' + await count('.gc .fs:has-text("requested")'));
    // ---------- gear view
    log('gear: count ' + await T('#count') + ' · strip ' + await strip());
    if (ph) { await nextDay(3); log('gear cards Thu: ' + await count(rows) + ' short: ' + await count('#list .dotw.err')); await shot('gear-thu'); }
    else { log('model rows: ' + await count('.tlr') + ' short cells: ' + await count('.gc.short') + ' pencilled-risk cells: ' + await count('.gc.pen') + ' day heads short: ' + (await p.locator('.dh i.r').allTextContents()).join(',')); await shot('gear'); }
    await stripk('short'); await wait(); log('gear short rows: ' + await count(rows)); await shot('gear-clashes');
    await stripk('short'); await wait(); await p.click(rows + ' .cb >> nth=0'); await wait(); log('gear bulk: ' + await T('#bulk')); await shot('gear-sel');
    await p.click('[data-act=subsel]'); await wait(150); log('bulk sub-hire: ' + await T('.dlg .hd')); await p.click('#dlg-go'); await wait(); log('bulk toast: ' + await toast()); await p.click('[data-act=undo]'); await wait(); log('after undo bulk open ' + await count('#bulk.open'));
    await stripk('risk'); await wait(); log('gear at-risk rows: ' + await count(rows)); await stripk('short'); await wait();
    await stripk('all'); await wait();
    // shortfall click on desktop
    if (!ph) { await p.click('.gc.short >> nth=0'); await wait(150); log('short cell → ' + await T('.side h2')); await close(); await p.click('.gc:not(.short) >> nth=3'); await wait(150); log('free cell → ' + await T('.side .sh1')); await close(); }
    // model row menu
    await p.click(rows + ' .dots >> nth=0'); await wait(150); log('model menu: ' + (await p.locator(items).allTextContents()).map(s => s.trim().replace(/\s+/g, ' ')).join(' | ')); await close();
    // day sheet
    if (!ph) { await p.click('.dh >> nth=3'); await wait(150); log('day sheet: ' + (await p.locator('.side .sh1').textContent()).replace(/\s+/g, ' ') + ' rows ' + await count('.side .hrow')); await shot('daysheet'); await close(); }
    await (ph ? p.click('#phoneviews [data-v=jobs]') : p.click('#viewsw [data-v=jobs]')); await wait();
    // ---------- tick + shift range + bulk confirm gate
    if (ph) { await nextDay(5); log('Sat/Sun cards: ' + await count(rows)); await nextDay(4); }
    const cbs = ph ? '#list .lrow .cb' : '.tlr .cb';
    const n = await count(cbs);
    await p.click(`${cbs} >> nth=${ph ? 0 : 4}`); await p.click(`${cbs} >> nth=${ph ? Math.min(2, n - 1) : 6}`, { modifiers: ['Shift'] }); await wait();
    log('selected: ' + await T('#bulk') + ' · open ' + await count('#bulk.open')); await shot('sel');
    if (!ph) {
      await p.click('[data-act=confirmsel]'); await wait(150); log('confirm gate: ' + (await p.locator('.dlg').textContent()).replace(/\s+/g, ' ').slice(0, 260)); await shot('confirm-gate');
      await p.click('.dlg [data-act=close] >> nth=0'); await wait(); log('after cancel: ' + await strip());
      await p.click('[data-act=confirmsel]'); await wait(150); await p.click('#dlg-go'); await wait(); log('confirm toast: ' + await toast() + ' · ' + await strip());
      await p.click('[data-act=undo]'); await wait(); log('undo confirm: ' + await strip() + ' sel ' + await count('#bulk.open'));
    }
    if (await count('#bulk.open')) await p.click('[data-act=clearsel]'); await wait(); log('cleared: open ' + await count('#bulk.open'));
    // select-all
    if (!ph) { await p.click('[data-act=selall]'); await wait(); log('select all: ' + await T('#bulk')); await p.click('[data-act=clearsel]'); await wait(); }
    // confirm #2350 from its row menu
    await p.locator(`${rows}:has-text("#2350") .dots`).first().click(); await wait(150); await p.click('[data-act=confirmone]'); await wait(150); log('row confirm gate: ' + (await p.locator('.dlg').textContent()).replace(/\s+/g, ' ').slice(0, 300)); await shot('confirm-2350'); await p.click('.dlg [data-act=close] >> nth=0'); await wait();
    // ---------- row menu
    await p.locator(`${rows}:has-text("#2341") .dots`).first().click(); await wait(150); log('job menu: ' + (await p.locator(items).allTextContents()).map(s => s.trim().replace(/\s+/g, ' ')).join(' | ')); await shot('jobmenu');
    // ---------- move dates with the gate (#2341 one day earlier lands on the EM4 receivers #2337 and #2342 hold)
    await p.click('[data-act=moveone]'); await wait(150); log('move dialog: ' + (await p.locator('.dlg .impact').first().textContent()).replace(/\s+/g, ' ')); await shot('move');
    await p.selectOption('#mv-by', '-1'); await wait(100); log('move by -1: ' + (await p.locator('.dlg .impact').first().textContent()).replace(/\s+/g, ' '));
    await p.click('#dlg-go'); await wait(150);
    log('move gate: ' + (await p.locator('.dlg').textContent()).replace(/\s+/g, ' ').slice(0, 240)); await shot('move-gate');
    await p.click('[data-act=movegogo]'); await wait(); log('move anyway toast: ' + await toast() + ' · strip ' + await strip()); await p.click('[data-act=undo]'); await wait(); log('undo move: ' + await strip());
    // a clean move (no gate): #2341 two days later
    await p.locator(`${rows}:has-text("#2341") .dots`).first().click(); await wait(150); await p.click('[data-act=moveone]'); await wait(150); await p.selectOption('#mv-by', '2'); await wait(100); await p.click('#dlg-go'); await wait(); log('clean move toast: ' + await toast() + ' · strip ' + await strip()); await p.click('[data-act=undo]'); await wait(); log('undo clean move: ' + await strip());
    // page menu
    await p.click(ph ? '.phonehead [data-act=pagemenu]' : '.lphead [data-act=pagemenu]'); await wait(150); log('page menu: ' + (await p.locator(items).allTextContents()).map(s => s.trim().replace(/\s+/g, ' ')).join(' | ')); await shot('pagemenu');
    await p.click('[data-act=mine]'); await wait(); log('only mine: ' + (await p.locator('#fwords .fw.on').allTextContents()).join(' | ') + ' rows ' + await count(rows)); await p.click('[data-act=clearf]'); await wait();
    await p.click(ph ? '.phonehead [data-act=pagemenu]' : '.lphead [data-act=pagemenu]'); await wait(150); await p.click('[data-act=export]'); await wait(); log('export toast: ' + await toast());
    // confirm gate fails open: break the preview and confirm still goes through
    await p.evaluate(() => { window.__previewDown = true; });
    await p.locator(`${rows}:has-text("#2349") .dots`).first().click().catch(async () => { await nextDay(0); }); await wait(150);
    if (await count('[data-act=confirmone]')) { await p.click('[data-act=confirmone]'); await wait(); log('fails open: ' + await toast()); await p.click('[data-act=undo]'); await wait(); }
    await p.evaluate(() => { window.__previewDown = false; });
  };
  await run(1440, 900, 'desk');
  await run(390, 844, 'phone');
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
