const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const f = 'file://' + process.cwd() + '/model-prototype.html';
  const d = await b.newPage({ viewport:{width:1440,height:900}, deviceScaleFactor:2 });
  await d.goto(f); await d.waitForTimeout(700); await d.screenshot({ path:'shots/final-model-desk.png' });
  await d.click('#tabs [data-k=assets]'); await d.click('#strip [data-k=all]'); await d.click('#tblwrap tr.row .cb >> nth=1'); await d.click('#tblwrap tr.row .cb >> nth=3', { modifiers:['Shift'] }); await d.waitForTimeout(250);
  await d.screenshot({ path:'shots/final-model-desk-sel.png' });
  await d.click('#bulk [data-act=clearsel]'); await d.click('#tabs [data-k=roi]'); await d.click('[data-act=roicost]'); await d.waitForTimeout(200);
  await d.screenshot({ path:'shots/final-model-roi.png' });
  await d.goto(f + '?edit=1'); await d.waitForTimeout(500); await d.screenshot({ path:'shots/final-model-sheet.png' });
  await d.close();
  const p = await b.newPage({ viewport:{width:390,height:844}, deviceScaleFactor:2 });
  await p.goto(f); await p.waitForTimeout(700); await p.screenshot({ path:'shots/final-model-phone.png' });
  await p.close(); await b.close();
})();
