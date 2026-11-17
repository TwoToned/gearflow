const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const url = 'file://' + process.cwd() + '/floor-prototype.html';
  const d = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await d.goto(url); await d.waitForTimeout(700);
  await d.fill('#q', 'SK-0012'); await d.press('#q', 'Enter'); await d.waitForTimeout(200);
  await d.screenshot({ path: 'shots/final-floor-desk.png' });
  await d.click('.fcard[data-id="j2341"] .cb'); await d.click('.fcard[data-id="j2344"] .cb'); await d.click('.fcard[data-id="j2346"] .cb'); await d.waitForTimeout(150);
  await d.screenshot({ path: 'shots/final-floor-desk-sel.png' });
  await d.click('#bulk [data-act="bulkpull"]'); await d.waitForTimeout(200); await d.screenshot({ path: 'shots/final-floor-pull.png' }); await d.keyboard.press('Escape');
  await d.click('#bulk [data-act="clearsel"]'); await d.click('#strip .go'); await d.waitForTimeout(150);
  const t = await d.evaluate(() => state.jobs.find(j => j.num === '2329').lines.find(l => l.units.every(u => u.tag && u.st === 'out')).units[0].tag);
  await d.fill('#q', t); await d.press('#q', 'Enter'); await d.waitForTimeout(200);
  await d.screenshot({ path: 'shots/final-floor-returning.png' });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await p.goto(url); await p.waitForTimeout(700); await p.screenshot({ path: 'shots/final-floor-phone.png' });
  await b.close();
})();
