const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const f = 'file://' + process.cwd() + '/forms-prototype.html';
  const d = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await d.goto(f); await d.waitForTimeout(800);
  // one saved row so "last saved" reads
  await d.click('tr.row[data-k=crew]'); await d.fill('#f-first', 'Mia'); await d.fill('#f-last', 'Rossi'); await d.click('.dlg .ft .btn-primary'); await d.waitForTimeout(300);
  await d.click('#toast [data-act=toastclose]'); await d.mouse.move(700, 120); await d.waitForTimeout(200);
  await d.screenshot({ path: 'shots/final-forms-desk.png' });
  await d.click('tr.row[data-k=client]'); await d.waitForTimeout(250);
  await d.type('#f-name', 'Hilton Events'); await d.type('#f-cname', 'Priya Shah'); await d.type('#f-email', 'priya.shah@hilton'); await d.fill('#f-email', 'priya.shah@'); await d.waitForTimeout(150);
  await d.screenshot({ path: 'shots/final-forms-desk-sel.png' });
  await d.keyboard.press('Escape'); await d.click('[data-act=discard]'); await d.click('#toast [data-act=toastclose]').catch(()=>{}); await d.waitForTimeout(100);
  await d.click('tr.row[data-k=model]'); await d.waitForTimeout(200); await d.fill('#f-name', 'd&b Y8'); await d.fill('#f-manufacturer', 'd&b audiotechnik'); await d.click('[data-act=moretoggle]'); await d.fill('#f-sale', '1200'); await d.check('#f-tt'); await d.evaluate(() => document.querySelector('.dlg .bd').scrollTop = 120); await d.waitForTimeout(150);
  await d.screenshot({ path: 'shots/final-forms-model.png' }); await d.keyboard.press('Escape'); await d.click('[data-act=discard]'); await d.click('#toast [data-act=toastclose]').catch(()=>{});
  await d.click('tr.row[data-k=maint]'); await d.waitForTimeout(200); await d.type('#f-assets', 'aura-0'); await d.keyboard.press('Enter'); await d.type('#f-assets', 'sk-'); await d.keyboard.press('Enter'); await d.fill('#f-title', 'Annual check'); await d.selectOption('#f-status', 'COMPLETED'); await d.fill('#f-done', '2026-11-12'); await d.waitForTimeout(100); await d.click('.dlg .bd [data-act=wsel][data-v=CONDITIONAL]'); await d.evaluate(() => document.querySelector('.dlg .bd').scrollTop = 330); await d.waitForTimeout(150);
  await d.screenshot({ path: 'shots/final-forms-maint.png' }); await d.keyboard.press('Escape'); await d.click('[data-act=discard]'); await d.click('#toast [data-act=toastclose]').catch(()=>{});
  await d.click('tr.row[data-k=kit]'); await d.waitForTimeout(200); await d.fill('#f-name', 'Spare wireless kit'); await d.type('#f-contents', 'sk-'); await d.keyboard.press('Enter'); await d.type('#f-contents', 'pad'); await d.keyboard.press('Enter'); await d.click('[data-act=wsel][data-v=PER_ITEM]'); await d.type('#f-contents', 'a-0'); await d.waitForTimeout(150); await d.evaluate(() => document.querySelector('.dlg .bd').scrollTop = 260); await d.waitForTimeout(100);
  await d.screenshot({ path: 'shots/final-forms-kit.png' }); await d.keyboard.press('Escape'); await d.keyboard.press('Escape'); await d.click('[data-act=discard]'); await d.click('#toast [data-act=toastclose]').catch(()=>{});
  await d.click('#toast [data-act=toastclose]').catch(()=>{}); await d.click('tr.row[data-k=location]'); await d.waitForTimeout(200); await d.fill('#f-name', 'Bay 4'); await d.click('#f-parent'); await d.type('#f-parent', 'war'); await d.waitForTimeout(150);
  await d.screenshot({ path: 'shots/final-forms-location.png' });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await p.goto(f); await p.waitForTimeout(800);
  await p.click('#list .lrow[data-k=crew]'); await p.waitForTimeout(250); await p.fill('#f-first', 'Dev'); await p.fill('#f-last', ''); await p.type('#f-last', 'Patel'); await p.fill('#f-email', 'dev@'); await p.waitForTimeout(150);
  await p.screenshot({ path: 'shots/final-forms-phone.png' });
  await b.close();
})();
