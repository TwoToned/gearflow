// 2x screenshots: node homelive-shots.cjs  (run from this directory)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const url = 'file://' + process.cwd() + '/homelive-prototype.html';
  const d = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await d.goto(url); await d.waitForTimeout(800);
  await d.screenshot({ path: 'shots/final-homelive-desk.png' });
  // key state: Customise, Needs attention just moved up with the keyboard (Undo toast), dashed frames + corner handles
  await d.click('.lphead [data-act=pagemenu]'); await d.waitForTimeout(150); await d.click('[data-act=customise]'); await d.waitForTimeout(250);
  await d.click('[data-act=toastclose]');
  await d.focus('.wh[data-wid=needsAttention]'); await d.keyboard.press('ArrowUp'); await d.waitForTimeout(250);
  await d.screenshot({ path: 'shots/final-homelive-desk-sel.png' });
  await d.close();
  // extra: the whole board on one tall screen, with a stat tile's target tooltip
  const f = await b.newPage({ viewport: { width: 1440, height: 1560 }, deviceScaleFactor: 2 });
  await f.goto(url); await f.waitForTimeout(800); await f.hover('.statlink >> nth=1'); await f.waitForTimeout(150);
  await f.screenshot({ path: 'shots/final-homelive-desk-full.png' }); await f.close();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await p.goto(url); await p.waitForTimeout(800);
  await p.screenshot({ path: 'shots/final-homelive-phone.png' });
  // extra: phone, scrolled to the stats 2x2 + needs attention
  await p.evaluate(() => document.querySelector('.w[data-wid=needsAttention]').scrollIntoView({ block:'start' })); await p.waitForTimeout(200);
  await p.screenshot({ path: 'shots/final-homelive-phone-stats.png' });
  await p.close(); await b.close();
})();
