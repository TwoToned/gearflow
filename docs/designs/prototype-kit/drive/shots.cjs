// Usage: node <kit>/drive/shots.cjs [dir-with-prototypes]  — writes shots/final-<name>-{desk,desk-sel,phone}.png at 2x for the user.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  for (const name of ['jobs', 'assets']) {
    const d = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await d.goto('file://' + process.cwd() + '/' + (process.argv[2] || '.') + '/' + name + '-prototype.html'); await d.waitForTimeout(600);
    await d.screenshot({ path: `shots/final-${name}-desk.png` });
    await d.click('#tblwrap tr.row .cb >> nth=1'); await d.click('#tblwrap tr.row .cb >> nth=4', { modifiers: ['Shift'] }); await d.waitForTimeout(200);
    await d.screenshot({ path: `shots/final-${name}-desk-sel.png` });
    await d.close();
    const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await p.goto('file://' + process.cwd() + '/' + (process.argv[2] || '.') + '/' + name + '-prototype.html'); await p.waitForTimeout(600);
    await p.screenshot({ path: `shots/final-${name}-phone.png` });
    await p.close();
  }
  await b.close();
})();
