const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const W = 150;
  const fill1 = async (p) => {
    const c = async (s, o) => { await p.click(s, o); await p.waitForTimeout(W); };
    await p.fill('[data-f=name][data-c=w]', 'Hilton Sydney gala dinner'); 
    await p.click('.cbin[data-cb=client]'); await p.fill('.cbin[data-cb=client]', 'hil'); await p.keyboard.press('Enter'); await p.waitForTimeout(W);
    await c('[data-act=caltoggle][data-c=w]'); await c('[data-act=calday][data-d="2026-11-12"]'); await c('[data-act=calday][data-d="2026-11-14"]');
    await p.selectOption('[data-f=type]', 'CORPORATE');
    await p.click('.cbin[data-cb=pms]'); await p.waitForTimeout(W); await c('.cbopt >> nth=0');
    await p.fill('.cbin[data-cb=tags]', 'gala'); await p.keyboard.press('Enter'); await p.keyboard.press('Escape'); await p.waitForTimeout(W);
    await p.click('#steps', { position: { x: 5, y: 2 }, force: true }); await p.waitForTimeout(W);
    return c;
  };
  for (const [tag, vp] of [['desk', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const p = await b.newPage({ viewport: vp, deviceScaleFactor: 2 });
    await p.goto('file://' + process.cwd() + '/wizard-prototype.html'); await p.waitForTimeout(500);
    const c = await fill1(p);
    await p.screenshot({ path: `shots/final-wizard-${tag === 'desk' ? 'desk' : 'phone'}.png` });
    await p.close();
  }
  // desk key state: What step, template lines, selection
  let p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await p.goto('file://' + process.cwd() + '/wizard-prototype.html'); await p.waitForTimeout(500);
  const c = await fill1(p);
  await c('[data-act=tplmenu]'); await c('[data-act=tplmanage]'); await c('[data-act=tplrowmenu] >> nth=0'); await c('[data-act=tpluse]');
  await c('[data-act=step][data-s="1"]');
  const cb = '#tblwrap tr.row .cb';
  await c(cb + ' >> nth=0'); await c(cb + ' >> nth=2', { modifiers: ['Shift'] });
  await p.screenshot({ path: 'shots/final-wizard-desk-sel.png' });
  // extra 1: step two search open
  await c('[data-act=clearsel]'); await p.click('#q'); await p.keyboard.type('barco', { delay: 10 }); await p.waitForTimeout(200);
  await p.screenshot({ path: 'shots/final-wizard-search.png' });
  await p.close();
  // extra 2: edit sheet gate on #2341
  p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await p.goto('file://' + process.cwd() + '/wizard-prototype.html'); await p.waitForTimeout(500);
  await p.click('.wzhead [data-act=pagemenu]'); await p.waitForTimeout(W); await p.click('[data-act=editexisting]'); await p.waitForTimeout(W);
  await p.click('[data-act=caltoggle][data-c=e]'); await p.waitForTimeout(W); await p.click('[data-act=calday][data-d="2026-11-19"]'); await p.click('[data-act=calday][data-d="2026-11-21"]'); await p.waitForTimeout(W);
  await p.click('[data-act=editsave]'); await p.waitForTimeout(250);
  await p.screenshot({ path: 'shots/final-wizard-gate.png' });
  await p.close();
  // phone: what step
  p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await p.goto('file://' + process.cwd() + '/wizard-prototype.html'); await p.waitForTimeout(500);
  const c2 = await fill1(p);
  await c2('[data-act=tplmenu]'); await c2('[data-act=tplmanage]'); await c2('[data-act=tplrowmenu] >> nth=0'); await c2('[data-act=tpluse]');
  await c2('[data-act=step][data-s="1"]'); await p.screenshot({ path: 'shots/final-wizard-phone-what.png' });
  await c2('[data-act=step][data-s="2"]'); await p.screenshot({ path: 'shots/final-wizard-phone-review.png' });
  await b.close();
})();
