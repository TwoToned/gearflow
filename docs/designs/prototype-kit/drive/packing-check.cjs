// Usage (from this directory): node packing-check.cjs [file.html]
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const errs = [];
  const run = async (w, h, tag) => {
    const phone = tag === 'phone';
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    p.on('pageerror', e => errs.push(tag + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(tag + ' console: ' + m.text()); });
    await p.goto('file://' + process.cwd() + '/' + (process.argv[2] || 'packing-prototype.html')); await p.waitForTimeout(400);
    const log = s => console.log(tag, s);
    const T = () => p.locator('#toast').textContent().then(t => t.replace(/\s+/g, ' ').trim());
    const rows = sel => p.locator(sel + ' .pl').count();
    const unCount = () => p.evaluate(() => ver(state.viewing).lines.filter(l => !bucketOf(l)).length);
    const caseLines = x => p.evaluate(x => allIn(x).length, x);
    const shot = n => p.screenshot({ path: `shots/${tag}-${n}.png` });
    const tabs = phone ? '#phonetabs' : '#desktabs';
    log('tabs: ' + (await p.locator(tabs + ' > *').allTextContents()).map(t => t.replace(/\s+/g, ' ').trim()).join(' | '));
    log('cards: ' + await p.locator('.cc').count() + ' · unplanned: ' + await unCount() + ' · LX-02: ' + await caseLines('x1') + ' · primary: ' + (await p.locator(phone ? '#phoneact .btn-primary' : '#tabprimary .btn-primary').textContent()));
    log('glyph row: ' + (await p.locator('.glyph').first().textContent()).trim() + ' · sealed: ' + await p.locator('.cc .dotw.ok:text("Sealed")').count());
    await shot('1-packing');
    // search + filters + empty
    await p.fill('#q', 'beltpack'); await p.waitForTimeout(100); log('search beltpack rows: ' + await p.locator('.pl').count());
    await p.fill('#q', 'zzzz'); await p.waitForTimeout(100); log('empty state: ' + (await p.locator('#pkboard .empty').textContent()).trim().slice(0, 60)); await shot('2-empty');
    await p.click('[data-act=clearf]'); await p.waitForTimeout(100);
    await p.click('[data-act=fmenu][data-k=cat]'); await p.waitForTimeout(120); await p.click('[data-act=fset][data-v=Video]'); await p.waitForTimeout(100);
    await p.click('[data-act=fmenu][data-k=status]'); await p.waitForTimeout(120); await p.click('[data-act=fset][data-v="Not planned"]'); await p.waitForTimeout(100);
    log('fwords: ' + (await p.locator('#fwords .fw').allTextContents()).join(' | ') + ' · rows: ' + await p.locator('.pl').count());
    await p.click('[data-act=clearf]'); await p.waitForTimeout(100);
    // tick + shift-tick + bulk plan + undo
    const cb = '.pk-side .pl .cb';
    await p.click(cb + ' >> nth=0'); await p.click(cb + ' >> nth=2', { modifiers: ['Shift'] }); await p.waitForTimeout(100);
    log('bulk: ' + (await p.locator('#bulk').textContent()).trim().replace(/\s+/g, ' '));
    await shot('3-selected');
    await p.click('[data-act=bulkplan]'); await p.waitForTimeout(150); await shot('4-planpick');
    await p.click('[data-act=planto][data-x=x2]'); await p.waitForTimeout(150);
    log('toast: ' + await T() + ' · unplanned: ' + await unCount() + ' · LX-04: ' + await caseLines('x2'));
    await p.click('#toast [data-act=undo]'); await p.waitForTimeout(100);
    log('after undo unplanned: ' + await unCount() + ' · LX-04: ' + await caseLines('x2') + ' · bulk open: ' + await p.locator('#bulk.open').count());
    // tick card header
    await p.click('.cc.un .cc-h .cb'); await p.waitForTimeout(100); log('select all unplanned: ' + (await p.locator('#bulk b').textContent())); await p.click('[data-act=clearsel]'); await p.waitForTimeout(100);
    // drag and drop (desktop)
    if (!phone) {
      await p.locator('.pk-side .pl:has-text("Hazer")').dragTo(p.locator('.cc[data-x=x1] .cc-h'), { targetPosition: { x: 60, y: 20 } }); await p.waitForTimeout(200);
      log('drag Hazer → LX-02: ' + await T() + ' · unplanned: ' + await unCount()); await p.click('#toast [data-act=undo]'); await p.waitForTimeout(100);
      await p.locator('.pk-side .pl:has-text("Hazer")').dragTo(p.locator('.cc[data-x=x4] .cc-h'), { targetPosition: { x: 60, y: 20 } }); await p.waitForTimeout(200);
      log('drag onto sealed: ' + await T() + ' · unplanned: ' + await unCount());
      await p.locator('.cc[data-x=x1] .pl:has-text("Shure ULXD4Q")').dragTo(p.locator('.cc.un .cc-h'), { targetPosition: { x: 60, y: 20 } }); await p.waitForTimeout(200);
      log('drag out to Unplanned: ' + await T() + ' · unplanned: ' + await unCount()); await p.click('#toast [data-act=undo]'); await p.waitForTimeout(100);
      await p.locator('.pk-side .pl:has-text("Hazer") .grip').hover(); await shot('5-hover');
    }
    // packed row ⋯ + row menu
    await p.hover('.pk-side .pl >> nth=0'); await p.click('.pk-side .pl >> nth=0 >> .dots'); await p.waitForTimeout(150); await shot('6-rowmenu');
    await p.click('[data-act=rowplan]'); await p.waitForTimeout(150);
    await p.click('[data-act=planto][data-x=x3]'); await p.waitForTimeout(150); log('row plan: ' + await T());
    await p.click('.cc[data-x=x3] .pl:has-text("Sennheiser EW-DX EM4") .dots'); await p.waitForTimeout(150);
    await p.click('[data-act=rowunplan]'); await p.waitForTimeout(150); log('row unplan: ' + await T());
    await p.click('.cc[data-x=x1] .pl:has-text("loudspeaker") .dots'); await p.waitForTimeout(150); await p.click('[data-act=rowplan]'); await p.waitForTimeout(100); log('packed line plan: ' + await T());
    // show more
    await p.click('.cc[data-x=x1] [data-act=showmore]'); await p.waitForTimeout(100); log('LX-02 rows after show more: ' + await rows('.cc[data-x=x1]'));
    // case menu
    await p.hover('.cc[data-x=x2] .cc-h'); await p.click('.cc[data-x=x2] .cc-h .dots'); await p.waitForTimeout(150); await shot('7-casemenu');
    await p.click('[data-act=caseseal]'); await p.waitForTimeout(100); log('seal: ' + await T()); await p.click('#toast [data-act=undo]'); await p.waitForTimeout(100);
    await p.click('.cc[data-x=x2] .cc-h .dots'); await p.click('[data-act=doc]'); await p.waitForTimeout(100); log('print label: ' + await T());
    await p.click('.cc[data-x=x2] .cc-h .dots'); await p.click('[data-act=caserename]'); await p.fill('#c-name', 'LX-04 (lighting)'); await p.click('[data-act=carenamego]'); await p.waitForTimeout(100); log('rename: ' + await T()); await p.click('#toast [data-act=undo]'); await p.waitForTimeout(100);
    await p.click('.cc[data-x=x1] .cc-h .dots'); await p.click('[data-act=casedelete]'); await p.waitForTimeout(100); log('delete blocked: ' + (await p.locator('.dlg h2').textContent())); await shot('8-deleteblocked'); await p.keyboard.press('Escape');
    await p.click('.cc[data-x=x3] .cc-h .dots'); await p.click('[data-act=casedelete]'); await p.waitForTimeout(100); await p.click('[data-act=casedeletego]'); await p.waitForTimeout(100); log('delete VID-04: ' + await T() + ' · cards: ' + await p.locator('.cc').count()); await p.click('#toast [data-act=undo]'); await p.waitForTimeout(100); log('undo cards: ' + await p.locator('.cc').count());
    // add case
    await p.click(phone ? '#phoneact [data-act=addcase]' : '#tabprimary [data-act=addcase]'); await p.waitForTimeout(150);
    await p.fill('#c-q', 'VID'); await p.waitForTimeout(100); log('asset results: ' + await p.locator('#c-res .res2').count()); await shot('9-addcase');
    await p.click('[data-act=pickasset][data-t=VID-05]'); await p.waitForTimeout(100); log('name prefilled: ' + await p.inputValue('#c-name'));
    await p.click('[data-act=casekind][data-k=custom]'); await p.waitForTimeout(100); await p.fill('#c-name', 'Cable tub 2'); await p.click('[data-act=addcasego]'); await p.waitForTimeout(150);
    log('add case: ' + await T() + ' · cards: ' + await p.locator('.cc').count()); await p.click('#toast [data-act=undo]'); await p.waitForTimeout(100);
    // menus
    if (!phone) {
      await p.click('[data-act=tabmenu]'); await p.waitForTimeout(100); log('tab menu items: ' + await p.locator('.menu button, .menu a.item').count()); await p.keyboard.press('Escape');
      await p.click('[data-act=docs]'); await p.waitForTimeout(100); log('docs menu items: ' + await p.locator('.menu button, .menu a.item').count()); await p.keyboard.press('Escape');
      await p.click('.jh [data-act=jobmenu]'); await p.waitForTimeout(100); log('job menu items: ' + await p.locator('.menu button, .menu a.item').count()); await p.keyboard.press('Escape');
      await p.click('[data-act=lockmenu]'); await p.waitForTimeout(100); await p.keyboard.press('Escape');
    } else {
      await p.click('.phonehead [data-act=jobmenu]'); await p.waitForTimeout(150); await shot('10-jobmenu'); log('job sheet items: ' + await p.locator('.sheetwrap .item').count()); await p.keyboard.press('Escape');
    }
    // version chip menu → switch to v2 and see its plan
    if (!phone) { await p.click('.vchip'); await p.waitForTimeout(120); await shot('11-vchip'); await p.click('[data-act=vswitch][data-n="2"]'); }
    else { await p.click('#phonetabs [data-t=versions]'); await p.waitForTimeout(150); await p.click('.vr >> nth=1'); }
    await p.waitForTimeout(150);
    log('viewing: ' + (await p.locator('#vstrip').textContent()).trim().slice(0, 70) + ' · toast: ' + (await T()).slice(0, 60));
    await p.click((phone ? '#phonetabs' : '#desktabs') + ' [data-t=packing]'); await p.waitForTimeout(150);
    log('v2 packing tab: ' + (await p.locator(tabs + ' .on').textContent()).replace(/\s+/g, ' ').trim() + ' · lines ' + await p.evaluate(() => cur().lines.length)); await shot('12-v2-packing');
    // versions tab
    await p.click(tabs + ' [data-t=versions]'); await p.waitForTimeout(150); log('version rows: ' + await p.locator('.vr').count() + ' · primary: ' + (await p.locator(phone ? '#phoneact .btn-primary' : '#tabprimary .btn-primary').textContent())); await shot('13-versions');
    // row menu → compare
    await p.click('.vr[data-n="2"] .dots'); await p.waitForTimeout(150); await shot('14-vrowmenu'); log('v2 row menu: ' + (await p.locator('.menu button, .sheetwrap .item').allTextContents()).map(s => s.trim()).join(' | '));
    await p.click('[data-act=cmpfor]'); await p.waitForTimeout(200); log('compare: ' + (await p.locator('.rsheet .cmp-bridge').textContent()).replace(/\s+/g, ' ') + ' · sections: ' + (await p.locator('.rsheet .cmp-h').allTextContents()).join(' | ')); await shot('15-compare');
    await p.click('[data-act=cmpside][data-s=a]'); await p.waitForTimeout(120); await p.click('[data-act=cmpset][data-n="1"]'); await p.waitForTimeout(150); log('compare v1→v3: ' + (await p.locator('.rsheet .cmp-bridge').textContent()).replace(/\s+/g, ' '));
    await p.click('.rsheet [data-act=close]'); await p.waitForTimeout(100);
    // make live v2 (dialog), confirm, undo
    await p.click('.vr[data-n="2"] .dots'); await p.click('#layerbody [data-act=makelive]'); await p.waitForTimeout(150); await shot('16-makelive'); log('make live dlg: ' + (await p.locator('.dlg .lrw .k').allTextContents()).join(' | '));
    await p.click('[data-act=makelivego]'); await p.waitForTimeout(150); log('live now: ' + await p.evaluate(() => state.live) + ' · toast: ' + (await T()).slice(0, 50)); await p.click('#toast [data-act=undo]'); await p.waitForTimeout(100); log('undo live: ' + await p.evaluate(() => state.live));
    // make live v1 → conflicts
    await p.click('.vr[data-n="1"] .dots'); await p.click('#layerbody [data-act=makelive]'); await p.click('[data-act=makelivego]'); await p.waitForTimeout(150); log('v1 live conflict: ' + (await p.locator('.dlg h2').textContent()).trim()); await shot('17-conflicts'); await p.click('.dlg [data-act=close]'); await p.click('#toast [data-act=undo]'); await p.waitForTimeout(100);
    // save as new version, undo
    await p.click(phone ? '#phoneact [data-act=saveversion]' : '#tabprimary [data-act=saveversion]'); await p.waitForTimeout(150); await p.fill('#v-name', 'With LED wall'); await p.click('[data-act=savegover]'); await p.waitForTimeout(150);
    log('saved: ' + (await T()).slice(0, 70) + ' · rows ' + await p.locator('.vr').count()); await p.click('#toast [data-act=undo]'); await p.waitForTimeout(100); log('undo rows: ' + await p.locator('.vr').count());
    // rename + delete
    await p.click('.vr[data-n="2"] .dots'); await p.click('[data-act=vrename]'); await p.fill('#v-name', 'Hilton revisions 2'); await p.click('[data-act=vrenamego]'); await p.waitForTimeout(100); log('rename: ' + await T()); await p.click('#toast [data-act=undo]'); await p.waitForTimeout(100);
    await p.click('.vr[data-n="3"] .dots'); await p.waitForTimeout(100); log('live row menu has delete: ' + await p.locator('[data-act=vdelete]').count()); await p.keyboard.press('Escape');
    await p.click('.vr[data-n="1"] .dots'); await p.click('[data-act=vdelete]'); await p.waitForTimeout(100); await shot('18-vdelete'); await p.click('[data-act=vdeletego]'); await p.waitForTimeout(100); log('deleted v1 · rows ' + await p.locator('.vr').count());
    // keyboard shortcut v
    await p.click('#desktabs [data-t=packing], #phonetabs [data-t=packing]'.split(', ')[phone ? 1 : 0]); await p.waitForTimeout(100); await p.keyboard.press('v'); await p.waitForTimeout(100); log('V key tab: ' + await p.evaluate(() => state.tab));
    // plan everything → every line has a case
    await p.click((phone ? '#phonetabs' : '#desktabs') + ' [data-t=packing]'); await p.waitForTimeout(100);
    await p.evaluate(() => { cur().lines.forEach(l => { if (!bucketOf(l)) l.plan = 'x1'; }); render(); }); log('all planned note: ' + (await p.locator('.cc.un .cc-note').textContent()).trim()); await shot('19-allplanned');
    // phone specifics
    if (phone) {
      await p.evaluate(() => { state.versions = mkVersions(); state.live = 3; state.viewing = 3; state.sel.clear(); state.tab = 'packing'; render(); });
      await p.evaluate(() => { document.querySelector('.content').scrollTop = 0; });
      log('phone cards min-height: ' + await p.locator('.pl >> nth=0').evaluate(e => e.getBoundingClientRect().height) + ' · cb: ' + await p.locator('.pl .cb >> nth=0').evaluate(e => e.getBoundingClientRect().width) + ' · dots: ' + await p.locator('.pl .dots >> nth=0').evaluate(e => e.getBoundingClientRect().width));
      await p.click('.pl >> nth=1'); await p.waitForTimeout(100); log('tap select → sticky bar: ' + (await p.locator('#bulk').textContent()).trim().replace(/\s+/g, ' ') + ' · phoneact visible: ' + await p.locator('#phoneact').isVisible()); await shot('20-phonesel');
      await p.click('[data-act=bulkplan]'); await p.waitForTimeout(150); await shot('21-phoneplan'); log('plan sheet items: ' + await p.locator('.sheetwrap .item').count()); await p.keyboard.press('Escape'); await p.click('[data-act=clearsel]');
      await p.evaluate(() => document.querySelector('.content').scrollTo(0, 99999)); await p.waitForTimeout(100); await shot('22-phonebottom');
    }
    await p.close();
  };
  await run(1440, 900, 'desk'); await run(390, 844, 'phone');
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
