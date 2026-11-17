const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const errs = [];
  const run = async (w, h, tag) => {
    const d = tag === 'desk', p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    p.on('pageerror', e => errs.push(tag + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(tag + ' console: ' + m.text()); });
    const log = s => console.log(tag, s), W = ms => p.waitForTimeout(ms || 120);
    const toast = async () => (await p.locator('#toast').textContent()).trim();
    await p.goto('file://' + process.cwd() + '/asset-prototype.html'); await W(400);
    log('tabs: ' + (await p.locator('#tabs button').allTextContents()).join(' | '));
    log('overview rail present: ' + await p.locator('.rail2').count());
    log('checks: ' + (await p.locator('.todo li').allTextContents()).join(' || '));
    for (const t of ['availability', 'checks', 'maintenance', 'history', 'notes', 'files']) { await p.click(`#tabs [data-t=${t}]`); await W(); log(`${t} rail: ${await p.locator('.rail2').count()} hash: ${await p.evaluate(() => location.hash)}`); }
    // availability
    await p.click('#tabs [data-t=availability]'); await p.click('[data-act=calnav][data-d="28"]'); await W(); log('cal range: ' + await p.locator('.rng').textContent()); await p.click('[data-act=calnav][data-d="0"]'); await p.click('.lb >> nth=1'); await W(); log('hl rows: ' + await p.locator('.rrow.hl').count());
    await p.click('.rrow [data-act=bkmenu] >> nth=0'); await W(); await p.screenshot({ path: `shots/${tag}-bkmenu.png` }); await p.keyboard.press('Escape');
    // checks
    await p.click('#tabs [data-t=checks]'); await p.click('[data-act=chkctx][data-k=RETURN]'); await W(); log('return sessions: ' + await p.locator('.gl').count()); await p.click('[data-act=chkctx][data-k=AD_HOC]'); await W(); log('adhoc empty: ' + await p.locator('.empty2').count()); await p.click('[data-act=chkctx][data-k=ALL]');
    // maintenance: tick, shift range, bulk, undo
    await p.click('#tabs [data-t=maintenance]'); await W(); await p.click('.rrow .cb >> nth=1'); await p.click('.rrow .cb >> nth=3', { modifiers: ['Shift'] }); await W(); log('bulk: ' + (await p.locator('#bulk').textContent()).trim()); await p.screenshot({ path: `shots/${tag}-maint-sel.png` });
    await p.click('[data-act=mdone]'); await W(200); log('toast: ' + await toast()); await p.click('[data-act=undo]'); await W(); log('bulk after undo open: ' + await p.locator('#bulk.open').count());
    await p.click('[data-act=mfilter][data-k=open]'); await W(); log('open rows: ' + await p.locator('.rrow:has(.dots)').count()); await p.click('[data-act=mfilter][data-k=all]');
    await p.click('.rrow [data-act=mrowmenu] >> nth=0'); await W(); await p.keyboard.press('Escape');
    // history
    await p.click('#tabs [data-t=history]'); await W(); log('history rows: ' + await p.locator('#view .rrow').count()); await p.click('[data-act=histmore]'); await W(); log('after more: ' + await p.locator('#view .rrow').count()); await p.click('[data-act=histf][data-k=job]'); await W(); log('jobs only: ' + await p.locator('#view .rrow').count()); await p.click('[data-act=histf][data-k=all]');
    // notes
    await p.click('#tabs [data-t=notes]'); await W(); await p.fill('#note', 'Lens 2 cleaned 9 Nov.'); await p.click('[data-act=compose]'); await W(); log('toast: ' + await toast()); await p.fill('#compose', 'Spare lens in LX-02?'); await p.click('[data-act=post]'); await W(); log('threads: ' + await p.locator('.thr').count()); await p.click('[data-act=resolve] >> nth=0'); await W(); log('toast: ' + await toast()); await p.click('[data-act=undo]');
    await p.click('[data-act=expand] >> nth=0'); await W(); await p.fill('[data-reply]', 'ok'); await p.keyboard.press('Enter'); await W(); log('reply toast: ' + await toast());
    // files
    await p.click('#tabs [data-t=files]'); await W(); await p.click('.ftile .cb >> nth=0'); await p.click('.ftile .cb >> nth=1', { modifiers: ['Shift'] }); await W(); log('files bulk: ' + (await p.locator('#bulk').textContent()).trim()); await p.screenshot({ path: `shots/${tag}-files-sel.png` }); await p.click('[data-act=fremove]'); await W(); log('toast: ' + await toast()); await p.click('[data-act=undo]'); await W(); await p.click(d ? '[data-act=fupload]' : '[data-act=fupload]'); await W(); log('photos after upload: ' + await p.locator('.ftile').count());
    // overview actions
    await p.click('#tabs [data-t=overview]'); await W(); await p.click('.todo li >> nth=0'); await W(); await p.screenshot({ path: `shots/${tag}-sched.png` }); await p.click('[data-act=schedgo]'); await W(200); log('toast: ' + await toast()); log('avail count: ' + await p.locator('#tabs [data-t=availability]').textContent()); await p.click('[data-act=undo]'); await W();
    await p.click('[data-act=attach]'); await W(); await p.click('[data-act=atkind][data-k=b]'); await p.click('[data-act=attachgo]'); await W(); log('toast: ' + await toast()); await p.click('[data-act=accmenu] >> nth=0'); await W(); await p.keyboard.press('Escape');
    // page menu
    await p.click(d ? '.rhead [data-act=pagemenu]' : '.phonehead [data-act=pagemenu]'); await W(200); log('menu: ' + (await p.locator(d ? '.menu button, .menu a' : '.sheetwrap .item').allTextContents()).map(s => s.trim()).join(' | ')); await p.screenshot({ path: `shots/${tag}-pagemenu.png` });
    await p.click('[data-act=move]'); await W(); await p.click('[data-act=moveto] >> nth=1'); await W(200); log('toast: ' + await toast() + ' | id: ' + (await p.locator('.rid, #phonesub').first().textContent()).trim()); await p.click('[data-act=undo]'); await W();
    await p.click(d ? '.rhead [data-act=pagemenu]' : '.phonehead [data-act=pagemenu]'); await p.click('[data-act=issue]'); await W(); await p.fill('#is-text', 'Gobo wheel sticks'); await p.click('[data-act=issuego]'); await W(200); log('toast: ' + await toast() + ' | headline: ' + await p.locator('#ready h2').textContent()); await p.click('[data-act=undo]'); await W();
    await p.click(d ? '.rhead [data-act=pagemenu]' : '.phonehead [data-act=pagemenu]'); await p.click('[data-act=label]'); await W(); await p.screenshot({ path: `shots/${tag}-label.png` }); await p.click('[data-act=labelprint]'); await W();
    await p.click(d ? '.rhead [data-act=pagemenu]' : '.phonehead [data-act=pagemenu]'); await p.click('[data-act=retire]'); await W(); await p.screenshot({ path: `shots/${tag}-retire.png` }); await p.click('[data-act=retirego]'); await W(200); log('retired header: ' + await p.locator('#tabs').textContent() + ' / ' + await p.locator('#ready h2').textContent()); await p.click('[data-act=undo]'); await W();
    // scan: confirm same tag, different tag
    if (d) { await p.click('.rhead [data-act=pagemenu]'); await p.click('#layerbody [data-act=scan]'); } else await p.click('#phoneact [data-act=scan]'); await W(); await p.screenshot({ path: `shots/${tag}-scan.png` }); await p.click('[data-act=scanread][data-tag=AURA-01]'); await W(200); log('toast: ' + await toast()); await p.click('[data-act=undo]');
    if (d) { await p.click('.rhead [data-act=pagemenu]'); await p.click('#layerbody [data-act=scan]'); } else await p.click('#phoneact [data-act=scan]'); await p.fill('#s-tag', 'zz-404'); await p.keyboard.press('Enter'); await W(); log('unknown: ' + await p.locator('#s-msg').textContent()); await p.click('[data-act=scanread][data-tag=AURA-03]'); await W(200); log('navigated: ' + await p.evaluate(() => location.hash) + ' ' + await p.locator('#ready h2').textContent());
    await p.click(d ? '.rhead [data-act=pagemenu]' : '.phonehead [data-act=pagemenu]'); await W(); log('deployed menu: ' + (await p.locator(d ? '.menu button' : '.sheetwrap .item').evaluateAll(els => els.map(e => e.textContent.trim() + (e.disabled ? '(off)' : '')))).join(' | ')); await p.click('#layerbody [data-act=forceret]'); await W(); await p.click('[data-act=forceretgo]'); await W(200); log('toast: ' + await toast()); await p.click('[data-act=undo]');
    // edit sheet: validation + save + undo
    await p.goto('file://' + process.cwd() + '/asset-prototype.html#AURA-01'); await W(300);
    if (d) await p.click('.rhead [data-act=edit]'); else { await p.click('.phonehead [data-act=pagemenu]'); await p.click('#layerbody [data-act=edit]'); } await W(200); await p.screenshot({ path: `shots/${tag}-edit.png` });
    await p.fill('#f-tag', 'AURA-03'); await p.click('[data-act=formgo]'); await W(); log('tag err: ' + await p.locator('#e-tag').textContent()); await p.fill('#f-tag', 'AURA-01'); await p.fill('#f-price', '-5'); await p.click('[data-act=formgo]'); await W(); log('price err: ' + await p.locator('#e-price').textContent());
    await p.fill('#f-price', ''); await p.selectOption('#f-cond', 'Fair'); await p.selectOption('#f-loc', 'Warehouse B'); await p.click('[data-act=formgo]'); await W(200); log('toast: ' + await toast()); await p.click('[data-act=undo]'); await W();
    // create sheet via like-this: search-first, add another
    await p.click(d ? '.rhead [data-act=pagemenu]' : '.phonehead [data-act=pagemenu]'); await p.click('[data-act=likethis]'); await W(200); log('create tag prefill: ' + await p.inputValue('#f-tag')); await p.screenshot({ path: `shots/${tag}-create.png` });
    await p.click('[data-act=formadd]'); await W(200); log('add another toast: ' + await toast() + ' next: ' + await p.inputValue('#f-tag')); await p.fill('#f-serial', 'MA2043999');
    await p.click('[data-act=changemodel]'); await W(); await p.fill('#m-q', 'beltpack'); await W(); log('results: ' + await p.locator('#m-res .res2').count()); await p.keyboard.press('Enter'); await W(); log('picked tag: ' + await p.inputValue('#f-tag'));
    await p.click('[data-act=formgo]'); await W(200); log('created: ' + await toast() + ' id ' + await p.evaluate(() => location.hash));
    log('new asset headline: ' + await p.locator('#ready h2').textContent() + ' / ' + (await p.locator('.todo li').allTextContents()).join(' || ')); await p.screenshot({ path: `shots/${tag}-new.png` });
    for (const t of ['availability', 'checks', 'maintenance', 'notes', 'files']) { await p.click(`#tabs [data-t=${t}]`); await W(); log(`${t} empty: ` + (await p.locator('.empty2 b').first().textContent().catch(() => 'none'))); }
    await p.click('#tabs [data-t=overview]'); await p.click(d ? '.rhead [data-act=pagemenu]' : '.phonehead [data-act=pagemenu]'); await p.click('[data-act=retire]'); await W(); await p.click('[data-act=deletedlg]'); await W(); await p.click('[data-act=deletego]'); await W(200); log('deleted: ' + await toast());
    await p.goto('file://' + process.cwd() + '/asset-prototype.html#NOPE-1'); await W(300); log('not found: ' + await p.locator('#view .empty2 b').textContent());
    await p.goto('file://' + process.cwd() + '/asset-prototype.html#AURA-01'); await W(300);
    await p.click(d ? '.rhead [data-act=pagemenu]' : '.phonehead [data-act=pagemenu]'); await p.click('[data-act=likethis]'); await W(); await p.click('[data-act=csv]'); await W(); await p.click('[data-act=csvfile]'); await W(); await p.screenshot({ path: `shots/${tag}-csv.png` }); await p.click('[data-act=csvgo]'); await W(200); log('csv: ' + await toast());
    if (!d) { log('phoneact visible: ' + await p.locator('#phoneact').isVisible()); }
    await p.close();
  };
  await run(1440, 900, 'desk'); await run(390, 844, 'phone');
  console.log('errors:', errs); await b.close();
})();
