const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const url = 'file://' + process.cwd() + '/gearlists-prototype.html';
  const d = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await d.goto(url + '#list=maintenance&seg=overdue'); await d.waitForTimeout(600);
  await d.screenshot({ path: 'shots/final-gearlists-desk.png' });
  await d.click('#tblwrap tr.row .cb >> nth=0'); await d.click('#tblwrap tr.row .cb >> nth=2', { modifiers: ['Shift'] }); await d.waitForTimeout(200);
  await d.screenshot({ path: 'shots/final-gearlists-desk-sel.png' });
  await d.goto(url + '#list=overbookings'); await d.reload(); await d.waitForTimeout(500);
  await d.screenshot({ path: 'shots/final-gearlists-overbookings.png' });
  await d.goto(url + '#list=tt'); await d.reload(); await d.waitForTimeout(500);
  await d.screenshot({ path: 'shots/final-gearlists-tt.png' });
  await d.close();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await p.goto(url + '#list=maintenance&seg=overdue'); await p.waitForTimeout(600);
  await p.screenshot({ path: 'shots/final-gearlists-phone.png' });
  await b.close();
})();
