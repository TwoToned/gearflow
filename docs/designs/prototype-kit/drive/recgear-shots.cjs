// NODE_PATH=/opt/node-tools/node_modules node recgear-shots.cjs  → shots/final-recgear-*.png at deviceScaleFactor 2
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const f = 'file://' + process.cwd() + '/recgear-prototype.html';
  const W = ms => new Promise(r => setTimeout(r, ms));
  const d = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await d.goto(f + '#loc/wa'); await d.reload(); await W(700); await d.screenshot({ path: 'shots/final-recgear-desk.png' });
  await d.goto(f + '#loc/wa/contents'); await d.reload(); await W(500);
  await d.click('#view .rrow:has(.dots) .cb >> nth=0'); await d.click('#view .rrow:has(.dots) .cb >> nth=2', { modifiers: ['Shift'] }); await W(250); await d.screenshot({ path: 'shots/final-recgear-desk-sel.png' });
  await d.goto(f + '#maint/m188'); await d.reload(); await W(500); await d.click('.todo li >> nth=1'); await W(300); await d.screenshot({ path: 'shots/final-recgear-complete.png' });
  await d.click('[data-act=cgo]'); await W(300); await d.screenshot({ path: 'shots/final-recgear-completed.png' });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await p.goto(f + '#kit/k42'); await p.reload(); await W(700); await p.screenshot({ path: 'shots/final-recgear-phone.png' });
  await b.close();
})();
