const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const f = 'file://' + process.cwd() + '/people-prototype.html';
  const d = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await d.goto(f); await d.waitForTimeout(700);
  await d.screenshot({ path: 'shots/final-people-desk.png' });
  await d.click('#strip button[data-k="all"]');
  await d.click('#tblwrap tr.row .cb >> nth=1'); await d.click('#tblwrap tr.row .cb >> nth=4', { modifiers: ['Shift'] }); await d.waitForTimeout(200);
  await d.screenshot({ path: 'shots/final-people-desk-sel.png' });
  await d.click('[data-act="clearsel"]'); await d.click('#sidenav a[data-k="clients"]'); await d.click('#strip button[data-k="overdue"]'); await d.waitForTimeout(200);
  await d.screenshot({ path: 'shots/final-people-clients.png' });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await p.goto(f); await p.waitForTimeout(700);
  await p.screenshot({ path: 'shots/final-people-phone.png' });
  await b.close();
})();
