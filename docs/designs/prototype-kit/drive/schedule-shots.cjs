const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const f = 'file://' + process.cwd() + '/schedule-prototype.html';
  const d = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await d.goto(f); await d.waitForTimeout(700);
  await d.screenshot({ path: 'shots/final-schedule-desk.png' });
  await d.click('.tlr .cb >> nth=3'); await d.click('.tlr .cb >> nth=5', { modifiers: ['Shift'] }); await d.waitForTimeout(200);
  await d.click('[data-act=confirmsel]'); await d.waitForTimeout(250);
  await d.screenshot({ path: 'shots/final-schedule-desk-sel.png' });
  await d.keyboard.press('Escape'); await d.click('[data-act=clearsel]');
  await d.click('#viewsw [data-v=gear]'); await d.waitForTimeout(200);
  await d.screenshot({ path: 'shots/final-schedule-gear.png' });
  await d.keyboard.press('Escape');
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await p.goto(f); await p.waitForTimeout(700); await p.screenshot({ path: 'shots/final-schedule-phone.png' });
  await b.close();
})();
