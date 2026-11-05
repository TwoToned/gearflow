// Usage (from this directory): node shell-shots.cjs  → shots/final-shell-*.png at 2×
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const open = async (w, h) => { const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 }); await p.goto('file://' + process.cwd() + '/shell-prototype.html'); await p.waitForTimeout(700); return p; };
  let p = await open(1440, 900);
  await p.screenshot({ path: 'shots/final-shell-desk.png' });
  await p.click('.tsearch'); await p.fill('#pq', 'aura'); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(150);
  await p.screenshot({ path: 'shots/final-shell-desk-sel.png' }); await p.close();
  p = await open(390, 844); await p.screenshot({ path: 'shots/final-shell-phone.png' });
  await p.click('.bottomnav [data-act=more]'); await p.waitForTimeout(150); await p.screenshot({ path: 'shots/final-shell-phone-more.png' }); await p.close();
  p = await open(1024, 768); await p.click('[data-act=collapse]'); await p.click('.tbtn[data-act=mira]'); await p.waitForTimeout(250);
  await p.screenshot({ path: 'shots/final-shell-tablet.png' }); await p.close();
  await b.close(); console.log('done');
})();
