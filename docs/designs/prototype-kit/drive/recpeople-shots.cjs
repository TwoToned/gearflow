const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const f = 'file://' + process.cwd() + '/recpeople-prototype.html';
  const d = await b.newPage({ viewport:{width:1440,height:900}, deviceScaleFactor:2 });
  await d.goto(f); await d.waitForTimeout(700); await d.screenshot({ path:'shots/final-recpeople-desk.png' });
  await d.click('#tabs [data-k=money]'); await d.waitForTimeout(100); await d.click('#pane .rrow .cb >> nth=1'); await d.click('#pane .rrow .cb >> nth=4', { modifiers:['Shift'] }); await d.waitForTimeout(250);
  await d.screenshot({ path:'shots/final-recpeople-desk-sel.png' });
  await d.click('#swstrip [data-k=order]'); await d.waitForTimeout(250); await d.screenshot({ path:'shots/final-recpeople-order.png' });
  await d.click('#swstrip [data-k=crew]'); await d.waitForTimeout(250); await d.screenshot({ path:'shots/final-recpeople-crew.png' });
  await d.close();
  const p = await b.newPage({ viewport:{width:390,height:844}, deviceScaleFactor:2 });
  await p.goto(f); await p.waitForTimeout(700); await p.screenshot({ path:'shots/final-recpeople-phone.png' });
  await p.close(); await b.close();
})();
