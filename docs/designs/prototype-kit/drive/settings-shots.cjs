// Run from this directory: NODE_PATH=<global node_modules> node settings-shots.cjs
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const file = 'file://' + process.cwd() + '/settings-prototype.html';
  const d = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await d.goto(file); await d.waitForTimeout(700);
  await d.screenshot({ path: 'shots/final-settings-desk.png' });
  await d.goto(file + '#team'); await d.waitForTimeout(500);
  await d.click('#t-members tbody tr >> nth=2 >> .cb'); await d.click('#t-members tbody tr >> nth=4 >> .cb', { modifiers: ['Shift'] }); await d.waitForTimeout(200);
  await d.screenshot({ path: 'shots/final-settings-desk-sel.png' });
  await d.keyboard.press('Escape');
  await d.evaluate(() => document.querySelector('#s-roles').scrollIntoView());
  await d.click('th [data-act="role"][data-v="manager"]'); await d.waitForTimeout(250);
  await d.screenshot({ path: 'shots/final-settings-rolesheet.png' });
  await d.close();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await p.goto(file); await p.waitForTimeout(700);
  await p.screenshot({ path: 'shots/final-settings-phone.png' });
  await p.goto(file + '#team'); await p.waitForTimeout(500);
  await p.click('#t-members .list .cb >> nth=2'); await p.click('#t-members .list .cb >> nth=3'); await p.waitForTimeout(200);
  await p.screenshot({ path: 'shots/final-settings-team-phone.png' });
  await p.close(); await b.close();
})();
