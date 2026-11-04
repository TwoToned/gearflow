// 2x screenshots: node home-shots.cjs  (run from this directory)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const url = 'file://' + process.cwd() + '/home-prototype.html';
  const d = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await d.goto(url); await d.waitForTimeout(700);
  await d.screenshot({ path: 'shots/final-home-desk.png' });
  // extra 1: setup dismissed, the stat word's target tooltip showing
  await d.click('[data-act=setupdismiss]'); await d.waitForTimeout(150); await d.click('[data-act=toastclose]'); await d.hover('.stat >> nth=1'); await d.waitForTimeout(150);
  await d.screenshot({ path: 'shots/final-home-desk-clean.png' }); await d.mouse.move(5, 5);
  // extra 2: customise dialog
  await d.click('.lphead [data-act=pagemenu]'); await d.waitForTimeout(150); await d.click('[data-act=customise]'); await d.waitForTimeout(200);
  await d.screenshot({ path: 'shots/final-home-desk-customise.png' }); await d.keyboard.press('Escape');
  // key state: Notifications with a range selected and the bulk bar
  await d.click('#viewsw [data-v=notes]'); await d.waitForTimeout(150);
  await d.click('#v-notes .nrow .cb >> nth=0'); await d.click('#v-notes .nrow .cb >> nth=3', { modifiers: ['Shift'] }); await d.waitForTimeout(200);
  await d.screenshot({ path: 'shots/final-home-desk-sel.png' });
  await d.close();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await p.goto(url); await p.waitForTimeout(700);
  await p.screenshot({ path: 'shots/final-home-phone.png' });
  await p.close(); await b.close();
})();
