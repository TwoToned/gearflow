// Usage (from the directory holding the prototype): NODE_PATH=<global node_modules> node <kit>/drive/assets-check.cjs [file.html]
// `proxy` is only needed where outbound HTTPS goes through a proxy (cloud sessions); drop it locally.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const errs = [];
  const run = async (w, h, tag) => {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    p.on('pageerror', e => errs.push(tag + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(tag + ' console: ' + m.text()); });
    await p.goto('file://' + process.cwd() + '/' + (process.argv[2] || 'assets-prototype.html')); await p.waitForTimeout(400);
    await p.screenshot({ path: `shots/assets-${tag}-1.png` });
    const log = async (s) => console.log(tag, s);
    const rowSel = tag === 'desk' ? '#tblwrap tr.row' : '#list .lrow[data-act=open]';
    await log('strip: ' + (await p.locator('#strip button').allTextContents()).join(' | '));
    await log('rows: ' + await p.locator(rowSel).count() + ' foot: ' + (await p.locator('#foot').textContent()).trim());
    await p.click('#strip button[data-k="attention"]'); await p.waitForTimeout(100);
    await log('attention rows: ' + await p.locator(rowSel).count());
    await p.screenshot({ path: `shots/assets-${tag}-attention.png` });
    await p.click('#strip button[data-k="due"]'); await p.waitForTimeout(100);
    await log('due rows: ' + await p.locator(rowSel).count());
    await p.click('#strip button[data-k="all"]');
    await p.click('[data-act="fmenu"][data-k="category"]'); await p.waitForTimeout(150);
    await p.screenshot({ path: `shots/assets-${tag}-catmenu.png` });
    await p.click('[data-act="ftoggle"][data-v="Audio"]'); await p.waitForTimeout(100); await p.keyboard.press('Escape');
    await log('fwords: ' + (await p.locator('#fwords .fw').allTextContents()).join(' | ') + ' rows: ' + await p.locator(rowSel).count());
    await p.click('[data-act="clearf"]'); await p.waitForTimeout(100);
    await p.fill('#q', 'aura'); await p.waitForTimeout(100);
    await log('search rows: ' + await p.locator(rowSel).count());
    await p.fill('#q', ''); await p.waitForTimeout(100);
    if (tag === 'desk') {
      await p.click('th button[data-k="due"]'); await p.waitForTimeout(100);
      await log('first due after sort: ' + (await p.locator('#tblwrap tr.row >> nth=0').textContent()).replace(/\s+/g,' ').slice(0, 120));
      await p.click('th button[data-k="tag"]');
      await p.click('[data-act="groupmenu"]'); await p.waitForTimeout(150); await p.click('[data-act="groupset"][data-v="model"]'); await p.waitForTimeout(150);
      await log('group rows: ' + await p.locator('#tblwrap tr.grp').count());
      await p.screenshot({ path: `shots/assets-${tag}-grouped.png` });
      await p.click('[data-act="groupmenu"]'); await p.waitForTimeout(150); await p.click('[data-act="groupset"][data-v=""]'); await p.waitForTimeout(100);
    }
    const cb = rowSel + ' .cb';
    await p.click(cb + ' >> nth=0'); await p.waitForTimeout(100);
    await p.click(cb + ' >> nth=4', { modifiers: ['Shift'] }); await p.waitForTimeout(100);
    await log('bulk: ' + (await p.locator('#bulk').textContent()).trim().replace(/\s+/g, ' ').slice(0, 120));
    await p.screenshot({ path: `shots/assets-${tag}-sel.png` });
    await p.click('[data-act="bulkmove"]'); await p.waitForTimeout(150);
    await p.click('[data-act="bulkmovego"] >> nth=1'); await p.waitForTimeout(150);
    await log('toast: ' + (await p.locator('#toast').textContent()).trim());
    await p.click('[data-act="undo"]'); await p.waitForTimeout(100);
    await log('bulk after undo: ' + await p.locator('#bulk.open').count());
    if (tag === 'desk') {
      await p.hover('#tblwrap tr.row >> nth=0'); await p.click('#tblwrap tr.row >> nth=0 >> .dots'); await p.waitForTimeout(150);
      await p.screenshot({ path: `shots/assets-${tag}-rowmenu.png` }); await p.keyboard.press('Escape');
      await p.click('[data-act="view"][data-v="grid"]'); await p.waitForTimeout(200);
      await log('grid cards: ' + await p.locator('.acard').count());
      await p.screenshot({ path: `shots/assets-${tag}-grid.png` });
      await p.click('[data-act="view"][data-v="table"]'); await p.waitForTimeout(100);
      await p.click('.lphead [data-act=pagemenu]'); await p.waitForTimeout(150); await p.screenshot({ path: `shots/assets-${tag}-pagemenu.png` });
      await p.click('[data-act="colsmenu"]'); await p.waitForTimeout(150); await p.click('[data-act="coltoggle"][data-c="value"]'); await p.waitForTimeout(100);
      await log('value col: ' + await p.locator('th button[data-k="value"]').count());
      await p.click('.lphead [data-act=pagemenu]'); await p.waitForTimeout(150); await p.click('[data-act="colsmenu"]'); await p.waitForTimeout(150); await p.click('[data-act="coltoggle"][data-c="value"]'); await p.waitForTimeout(100);
      await p.click('[data-act="page"][data-d="1"]'); await p.waitForTimeout(100);
      await log('page 2: ' + (await p.locator('#foot').textContent()).trim());
      await p.click('[data-act="page"][data-d="-1"]');
      await p.click('[data-act="viewsmenu"]'); await p.waitForTimeout(150); await p.click('[data-act="applyview"] >> nth=0'); await p.waitForTimeout(150);
      await log('view: ' + (await p.locator('#views .fw').textContent()) + ' / ' + (await p.locator('#strip button.on').textContent()));
      await p.click('[data-act="clearf"]');
      await p.click('[data-act="kindmenu"]'); await p.waitForTimeout(150); await p.click('[data-act="kindset"][data-v="BULK"]'); await p.waitForTimeout(100);
      await log('bulk kind rows: ' + await p.locator(rowSel).count());
      await p.screenshot({ path: `shots/assets-${tag}-bulkkind.png` });
      await p.click('[data-act="clearf"]');
    } else {
      await p.click('.phonehead [data-act=pagemenu]'); await p.waitForTimeout(200); await p.screenshot({ path: `shots/assets-${tag}-pagemenu.png` }); await p.keyboard.press('Escape');
      await p.locator(rowSel + ' >> nth=0').click(); await p.waitForTimeout(100);
      await log('open toast: ' + (await p.locator('#toast').textContent()).trim());
      await p.locator('[data-act="more"]').scrollIntoViewIfNeeded(); await p.click('[data-act="more"]'); await p.waitForTimeout(100);
      await log('after more rows: ' + await p.locator(rowSel).count());
      await p.evaluate(() => window.scrollTo(0, 0));
      await log('phoneact visible: ' + await p.locator('#phoneact').isVisible());
      await p.click('#phoneact [data-act="scan"]'); await p.waitForTimeout(100);
      await log('scan toast: ' + (await p.locator('#toast').textContent()).trim());
    }
    await p.fill('#q', 'zzzz'); await p.waitForTimeout(100); await p.screenshot({ path: `shots/assets-${tag}-empty.png` }); await p.fill('#q', '');
    await p.close();
  };
  await run(1440, 900, 'desk'); await run(390, 844, 'phone');
  console.log('errors:', errs);
  await b.close();
})();
