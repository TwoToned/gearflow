// node packing-shots.cjs  → shots/final-packing-{desk,desk-sel,phone,versions,compare}.png at 2x
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const f = 'file://' + process.cwd() + '/packing-prototype.html';
  const d = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await d.goto(f); await d.waitForTimeout(700);
  await d.screenshot({ path: 'shots/final-packing-desk.png' });
  await d.click('.pk-side .pl .cb >> nth=1'); await d.click('.pk-side .pl .cb >> nth=3', { modifiers: ['Shift'] }); await d.waitForTimeout(200);
  await d.screenshot({ path: 'shots/final-packing-desk-sel.png' });
  await d.click('[data-act=clearsel]');
  await d.click('#desktabs [data-t=versions]'); await d.click('.vr[data-n="2"]'); await d.waitForTimeout(300);
  await d.evaluate(() => $('#toast').classList.remove('open'));
  await d.screenshot({ path: 'shots/final-packing-versions.png' });
  await d.click('.vr[data-n="2"] .dots'); await d.click('[data-act=cmpfor]'); await d.waitForTimeout(300);
  await d.screenshot({ path: 'shots/final-packing-compare.png' });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await p.goto(f); await p.waitForTimeout(700);
  await p.screenshot({ path: 'shots/final-packing-phone.png' });
  await b.close();
})();
