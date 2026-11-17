const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const f = 'file://' + process.cwd() + '/asset-prototype.html';
  const d = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await d.goto(f); await d.waitForTimeout(700); await d.screenshot({ path: 'shots/final-asset-desk.png' });
  await d.click('#tabs [data-t=maintenance]'); await d.click('.rrow .cb >> nth=1'); await d.click('.rrow .cb >> nth=3', { modifiers: ['Shift'] }); await d.waitForTimeout(200); await d.screenshot({ path: 'shots/final-asset-desk-sel.png' });
  await d.click('[data-act=mclear]'); await d.click('#tabs [data-t=availability]'); await d.waitForTimeout(200); await d.screenshot({ path: 'shots/final-asset-avail.png' });
  await d.click('.rhead [data-act=edit]'); await d.waitForTimeout(300); await d.screenshot({ path: 'shots/final-asset-edit.png' });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await p.goto(f); await p.waitForTimeout(700); await p.screenshot({ path: 'shots/final-asset-phone.png' });
  await b.close();
})();
