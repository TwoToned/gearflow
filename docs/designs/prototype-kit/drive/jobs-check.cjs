// Usage (from the directory holding the prototype): NODE_PATH=<global node_modules> node <kit>/drive/jobs-check.cjs [file.html]
// `proxy` is only needed where outbound HTTPS goes through a proxy (cloud sessions); drop it locally.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const errs = [];
  const run = async (w, h, tag) => {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    p.on('pageerror', e => errs.push(tag + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(tag + ' console: ' + m.text()); });
    await p.goto('file://' + process.cwd() + '/' + (process.argv[2] || 'jobs-prototype.html')); await p.waitForTimeout(400);
    await p.screenshot({ path: `shots/jobs-${tag}-1.png`, fullPage: false });
    const log = async (s) => console.log(tag, s);
    await log('strip: ' + (await p.locator('#strip button').allTextContents()).join(' | '));
    await log('rows: ' + await p.locator(tag === 'desk' ? '#tblwrap tr.row' : '#list .lrow').count());
    await p.click('#strip button[data-k="out"]'); await p.waitForTimeout(100);
    await log('out rows: ' + await p.locator(tag === 'desk' ? '#tblwrap tr.row' : '#list .lrow').count());
    await p.click('#strip button[data-k="needs"]'); await p.waitForTimeout(100);
    await log('needs rows: ' + await p.locator(tag === 'desk' ? '#tblwrap tr.row' : '#list .lrow').count());
    await p.screenshot({ path: `shots/jobs-${tag}-needs.png` });
    await p.click('#strip button[data-k="all"]');
    await p.click('[data-act="fmenu"][data-k="status"]'); await p.waitForTimeout(150);
    await p.screenshot({ path: `shots/jobs-${tag}-statusmenu.png` });
    await p.click('[data-act="ftoggle"][data-v="CONFIRMED"]'); await p.waitForTimeout(100);
    await p.click('[data-act="ftoggle"][data-v="PREPPING"]'); await p.waitForTimeout(100);
    await p.keyboard.press('Escape');
    await log('fwords: ' + (await p.locator('#fwords .fw').allTextContents()).join(' | '));
    await log('filtered rows: ' + await p.locator(tag === 'desk' ? '#tblwrap tr.row' : '#list .lrow').count());
    await p.click('[data-act="clearf"]'); await p.waitForTimeout(100);
    await p.fill('#q', 'qantas'); await p.waitForTimeout(100);
    await log('search rows: ' + await p.locator(tag === 'desk' ? '#tblwrap tr.row' : '#list .lrow').count());
    await p.fill('#q', ''); await p.waitForTimeout(100);
    if (tag === 'desk') {
      await p.click('th button[data-k="total"]'); await p.click('th button[data-k="total"]'); await p.waitForTimeout(100);
      await log('first total after desc sort: ' + await p.locator('#tblwrap tr.row >> nth=0 >> td.r.mono').textContent());
      await p.click('th button[data-k="start"]');
    }
    const cb = tag === 'desk' ? '#tblwrap tr.row .cb' : '#list .lrow .cb';
    await p.click(cb + ' >> nth=0'); await p.waitForTimeout(100);
    await p.click(cb + ' >> nth=3', { modifiers: ['Shift'] }); await p.waitForTimeout(100);
    await log('bulk: ' + (await p.locator('#bulk').textContent()).trim().slice(0, 80));
    await p.screenshot({ path: `shots/jobs-${tag}-sel.png` });
    await p.click('[data-act="bulkpm"]'); await p.waitForTimeout(150);
    await p.click('[data-act="bulkpmgo"] >> nth=1'); await p.waitForTimeout(150);
    await log('toast: ' + (await p.locator('#toast').textContent()).trim());
    await p.click('[data-act="undo"]'); await p.waitForTimeout(100);
    await log('bulk after undo: ' + await p.locator('#bulk.open').count());
    if (tag === 'desk') {
      await p.hover('#tblwrap tr.row >> nth=0'); await p.click('#tblwrap tr.row >> nth=0 >> .dots'); await p.waitForTimeout(150);
      await p.screenshot({ path: `shots/jobs-${tag}-rowmenu.png` });
      await p.keyboard.press('Escape');
      await p.click('[data-act="viewsmenu"]'); await p.waitForTimeout(150);
      await p.click('[data-act="applyview"] >> nth=0'); await p.waitForTimeout(150);
      await log('view: ' + (await p.locator('#views .fw').textContent()) + ' / ' + (await p.locator('#fwords .fw').allTextContents()).join(' | '));
      await p.click('[data-act="clearf"]');
      await p.click('[data-act="view"][data-v="board"]'); await p.waitForTimeout(200);
      await log('board cols: ' + await p.locator('.bcol').count() + ' cards: ' + await p.locator('.bcard').count());
      await p.screenshot({ path: `shots/jobs-${tag}-board.png` });
      await p.click('[data-act="view"][data-v="table"]'); await p.waitForTimeout(100);
      await p.click(".lphead [data-act=pagemenu]"); await p.waitForTimeout(150); await p.screenshot({ path: `shots/jobs-${tag}-pagemenu.png` }); await p.keyboard.press("Escape");
      await p.click('[data-act="page"][data-d="1"]'); await p.waitForTimeout(100);
      await log('page 2 rows: ' + await p.locator('#tblwrap tr.row').count() + ' foot: ' + (await p.locator('#foot').textContent()).trim());
    } else {
      await p.click(".phonehead [data-act=pagemenu]"); await p.waitForTimeout(200); await p.screenshot({ path: `shots/jobs-${tag}-pagemenu.png` }); await p.keyboard.press('Escape');
      await p.locator('[data-act="more"]').scrollIntoViewIfNeeded(); await p.click('[data-act="more"]'); await p.waitForTimeout(100);
      await log('after more rows: ' + await p.locator('#list .lrow').count());
      await p.evaluate(() => window.scrollTo(0, 0));
      await log('phoneact visible: ' + await p.locator('#phoneact').isVisible());
    }
    await p.fill('#q', 'zzzz'); await p.waitForTimeout(100); await p.screenshot({ path: `shots/jobs-${tag}-empty.png` }); await p.fill('#q', '');
    await p.close();
  };
  await run(1440, 900, 'desk'); await run(390, 844, 'phone');
  console.log('errors:', errs);
  await b.close();
})();
