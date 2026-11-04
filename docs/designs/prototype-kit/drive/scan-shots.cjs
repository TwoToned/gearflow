// 2x screenshots: node scan-shots.cjs
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const open = async (w, h) => { const p = await b.newPage({ viewport:{ width:w, height:h }, deviceScaleFactor:2 }); await p.goto('file://' + process.cwd() + '/scan-prototype.html'); await p.waitForTimeout(700); return p; };
  const w1 = p => p.waitForTimeout(150);
  const nt = async p => { await p.evaluate(() => document.querySelector('#toast').classList.remove('open')); };
  const answer = async (p, fail) => {
    await p.click('[data-act=passall]'); await p.fill('[data-f="v:hrs"]', '4120'); await p.selectOption('[data-f="dd:cos"]', 'Good');
    if (fail) { await p.click('[data-act=ckf][data-i=yoke]'); await p.fill('[data-f="note:yoke"]', 'Clamp bolt sheared'); await p.click('.failbox [data-act=addph]'); }
    await w1(p);
  };
  // desktop: check form mid-flight with a fail
  let d = await open(1440, 900);
  await answer(d, true); await d.evaluate(() => { document.querySelector('.content').scrollTop = 0; });
  await nt(d); await d.screenshot({ path:'shots/final-scan-desk.png' });
  // desktop key state: just saved — ready card, toast + Undo, last scans strip
  await d.click('#deskprimary [data-act=save]'); await w1(d);
  await d.screenshot({ path:'shots/final-scan-desk-sel.png' });
  // extra: test & tag fail on the distro
  await d.click('#strip button[data-m=tt]'); await d.fill('#q', 'PD-02'); await d.press('#q', 'Enter'); await w1(d);
  await d.click('.sc-sec:has-text("Visual inspection") [data-act=visall]'); await d.click('[data-act=polp]');
  for (let i = 0; i < 6; i++) { await d.fill(`[data-f="out:${i}:e"]`, '0.2'); await d.fill(`[data-f="out:${i}:i"]`, i === 2 ? '0.4' : '12'); }
  await w1(d); await d.evaluate(() => { document.querySelector('.content').scrollTop = 560; }); await w1(d);
  await nt(d); await d.screenshot({ path:'shots/final-scan-tt-desk.png' });
  await d.close();
  // phone
  let p = await open(390, 844);
  await answer(p, false);
  await p.evaluate(() => { document.querySelector('.content').scrollTop = 0; });
  await nt(p); await p.screenshot({ path:'shots/final-scan-phone.png' });
  await p.click('.camb'); await w1(p);
  await p.screenshot({ path:'shots/final-scan-phone-camera.png' });
  await p.close(); await b.close();
})();
