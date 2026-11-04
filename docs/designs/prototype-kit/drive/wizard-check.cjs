const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const errs = [];
  const run = async (w, h, tag) => {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    p.on('pageerror', e => errs.push(tag + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(tag + ' console: ' + m.text()); });
    await p.goto('file://' + process.cwd() + '/wizard-prototype.html'); await p.waitForTimeout(400);
    const log = s => console.log(tag, s), W = 120;
    const shot = n => p.screenshot({ path: `shots/wizard-${tag}-${n}.png` });
    const toastTxt = async () => (await p.locator('#toast').textContent()).trim().replace(/\s+/g, ' ');
    const click = async (sel, o) => { await p.click(sel, o); await p.waitForTimeout(W); };
    const phone = tag === 'phone';
    // step one: validation, draft
    await click('[data-act=next]:visible');
    log('validation toast: ' + await toastTxt());
    await p.fill('[data-f=name][data-c=w]', 'Hilton Sydney gala dinner'); await p.waitForTimeout(W);
    log('sub: ' + (await p.locator(phone ? '#phonesub' : '#wzsub').textContent()).trim());
    // duplicate code
    await p.fill('[data-f=code][data-c=w]', '2341'); await click('[data-act=next]:visible');
    log('dup code error: ' + await p.locator('.ferr').first().textContent());
    await p.fill('[data-f=code][data-c=w]', '2352');
    // client combo
    await p.click('.cbin[data-cb=client]'); await p.waitForTimeout(W); await p.fill('.cbin[data-cb=client]', 'hil'); await p.waitForTimeout(W);
    await shot('combo');
    await p.keyboard.press('Enter'); await p.waitForTimeout(W);
    log('client: ' + await p.inputValue('.cbin[data-cb=client]') + ' · contact field: ' + await p.locator('.cbin[data-cb=contact]').count());
    await p.click('.cbin[data-cb=contact]'); await p.waitForTimeout(W); await click('.cbopt >> nth=1'); log('contact: ' + await p.inputValue('.cbin[data-cb=contact]'));
    // inline new client
    await p.click('.cbin[data-cb=client]'); await p.waitForTimeout(W); await p.fill('.cbin[data-cb=client]', 'Zed Productions'); await p.waitForTimeout(W);
    await click('.cbopt.new'); await p.fill('[data-nc=name]', 'Zed Productions'); await shot('newclient');
    await click('[data-act=ncgo]'); log('new client toast: ' + await toastTxt()); await click('[data-act=undo]');
    log('after undo client: "' + await p.inputValue('.cbin[data-cb=client]') + '"');
    await p.click('.cbin[data-cb=client]'); await p.waitForTimeout(W); await click('.cbopt >> nth=0');
    // dates
    await click('[data-act=caltoggle][data-c=w]'); await shot('cal');
    await click('[data-act=calday][data-d="2026-11-12"]'); await click('[data-act=calday][data-d="2026-11-14"]');
    log('dates: ' + (await p.locator('.datein').textContent()).trim());
    log('consequence: ' + (await p.locator('.conseq').textContent()).trim().replace(/\s+/g, ' '));
    await click('[data-act=caltoggle][data-c=w]'); await click('[data-act=calpreset][data-p="0"]'); log('preset 1 day: ' + (await p.locator('.datein').textContent()).trim());
    await click('[data-act=caltoggle][data-c=w]'); await click('[data-act=calday][data-d="2026-11-12"]'); await click('[data-act=calday][data-d="2026-11-14"]');
    await click('[data-act=wintoggle][data-c=w]'); await p.fill('[data-f=gStart]', '2026-11-11'); await p.fill('[data-f=gStartT]', '06:30'); await p.dispatchEvent('[data-f=gStart]', 'change'); await p.waitForTimeout(W);
    log('window: ' + (await p.locator('#when-w').textContent()).replace(/\s+/g, ' ').slice(0, 160));
    await click('[data-act=wintoggle][data-c=w]');
    // type, PM, tags
    await p.selectOption('[data-f=type]', 'CORPORATE');
    await p.click('.cbin[data-cb=pms]'); await p.waitForTimeout(W); await click('.cbopt >> nth=0');
    await p.fill('.cbin[data-cb=tags]', 'gala'); await p.waitForTimeout(W); await p.keyboard.press('Enter'); await p.waitForTimeout(W);
    await p.fill('.cbin[data-cb=tags]', 'vip'); await p.waitForTimeout(W); await p.keyboard.press('Enter'); await p.waitForTimeout(W);
    await p.keyboard.press('Escape'); await click('.chipw button >> nth=1'); log('chips: ' + (await p.locator('.chips').allTextContents()).join(' | '));
    await click('[data-act=more][data-c=w]'); log('discount prefill: ' + await p.inputValue('[data-f=discount]'));
    await p.fill('.cbin[data-cb=loc]', 'hilton'); await p.waitForTimeout(W); await p.keyboard.press('Enter'); await p.waitForTimeout(W);
    await shot('step1');
    // template
    await click('[data-act=tplmenu]'); await shot('tplmenu');
    await click('[data-act=tplpick] >> nth=0'); log('template toast: ' + await toastTxt()); log('template word: ' + (await p.locator('[data-act=tplmenu]').textContent()).trim());
    await click('[data-act=undo]'); log('lines after undo: ' + await p.evaluate(() => state.w.lines.length));
    // manage templates
    await click('[data-act=tplmenu]'); await click('[data-act=tplmanage]'); await shot('manage');
    await click('[data-act=tselect] >> nth=0'); await click('[data-act=tselect] >> nth=2', { modifiers: ['Shift'] });
    log('tpl bulk: ' + (await p.locator('.dlg .ft').textContent()).trim().replace(/\s+/g, ' '));
    await click('[data-act=tpldelete]'); await click('[data-act=tpldeletego]'); log('tpl delete toast: ' + await toastTxt() + ' · templates ' + await p.evaluate(() => state.templates.length));
    await click('[data-act=undo]'); log('templates after undo: ' + await p.evaluate(() => state.templates.length));
    await click('[data-act=tplmenu]'); await click('[data-act=tplmanage]'); await click('[data-act=tplrowmenu] >> nth=0'); await shot('tplrowmenu'); await click('[data-act=tpluse]');
    log('tpl use: lines ' + await p.evaluate(() => state.w.lines.length));
    // step 2
    await click('[data-act=step][data-s="1"]'); await p.waitForTimeout(150);
    log('what lines: ' + await p.locator(phone ? '#list .lrow' : '#tblwrap tr.row').count());
    await p.click('#q'); await p.keyboard.type('aura', { delay: 20 }); await p.waitForTimeout(150); await shot('what-search');
    await p.keyboard.press('Enter'); await p.waitForTimeout(150); log('enter add toast: ' + await toastTxt());
    await p.keyboard.press('Enter'); await p.waitForTimeout(150); log('second enter dialog: ' + await p.locator('.dlg h2').textContent());
    await p.fill('#le-qty', '9'); await click('[data-act=lsave]'); log('line save toast: ' + await toastTxt());
    await p.click('#q'); await p.keyboard.type('V-0011', { delay: 10 }); await p.keyboard.press('Enter'); await p.waitForTimeout(150); log('asset tag toast: ' + await toastTxt());
    await p.keyboard.type('barco', { delay: 10 }); await p.waitForTimeout(100);
    await p.keyboard.press('Escape'); await p.fill('#q', ''); await p.waitForTimeout(100);
    if (!phone) { await p.fill('#q', 'gaffer'); await click('[data-act=addkind][data-k=sale]'); await p.fill('#q', ''); }
    await click('[data-act=addkind][data-k=custom]'); await p.fill('#q', 'Stage manager walkie'); await p.waitForTimeout(100); await click('[data-act=addpick] >> nth=0'); log('custom toast: ' + await toastTxt());
    await click('[data-act=addkind][data-k=all]');
    await p.fill('#q', 'zzzz'); log('no match offers: ' + (await p.locator('#reslist .res2 >> nth=0').textContent()).trim().slice(0,60)); await p.fill('#q', '');
    if (!phone) { const qi = p.locator('.qtyin >> nth=0'); await qi.fill('30'); await qi.press('Enter'); await qi.blur(); await p.waitForTimeout(150); log('qty toast: ' + await toastTxt()); await click('[data-act=undo]'); }
    // selection
    const cb = phone ? '#list .lrow .cb' : '#tblwrap tr.row .cb';
    await click(cb + ' >> nth=0'); await click(cb + ' >> nth=2', { modifiers: ['Shift'] }); log('bulk: ' + (await p.locator('#bulk').textContent()).trim().replace(/\s+/g, ' ')); await shot('sel');
    if (await p.locator('[data-act=bulksub]').count()) { await click('[data-act=bulksub]'); log('subhire toast: ' + await toastTxt()); await click('[data-act=undo]'); }
    await click(cb + ' >> nth=0'); await click(cb + ' >> nth=2', { modifiers: ['Shift'] }).catch(() => {});
    const n0 = await p.evaluate(() => state.w.lines.length);
    await click('[data-act=bulkremove]'); log('remove: ' + n0 + ' -> ' + await p.evaluate(() => state.w.lines.length)); await click('[data-act=undo]'); log('after undo: ' + await p.evaluate(() => state.w.lines.length));
    await click('[data-act=linemenu]:visible >> nth=0'); await shot('linemenu'); await p.keyboard.press('Escape');
    log('footer: ' + (await p.locator('#wzfoot').textContent()).trim());
    // step 3
    if (await p.locator('[data-act=clearsel]:visible').count()) await click('[data-act=clearsel]'); await click('[data-act=next]:visible'); log('review rows: ' + await p.locator('.rv').count());
    await click('[data-act=startsmenu]'); await click('[data-act=startsset][data-v=ENQUIRY]'); await click('[data-act=startsmenu]'); await click('[data-act=startsset][data-v=QUOTING]');
    await shot('review');
    await click('[data-act=back]:visible'); await click('[data-act=next]:visible');
    // page menu / discard on a throwaway
    await click((phone ? '.phonehead ' : '.wzhead ') + '[data-act=pagemenu]'); await shot('pagemenu'); await p.keyboard.press('Escape');
    // create
    await click('[data-act=create]:visible'); log('create toast: ' + await toastTxt()); log('stub title: ' + (await p.locator(phone ? '#phonettl' : '#wzhead h1').textContent())); log('open job href: ' + await p.locator('a:has-text("Open job")').first().getAttribute('href'));
    await shot('stub');
    await click('[data-act=undo]'); log('after undo view: ' + await p.evaluate(() => state.view + ' step ' + state.step));
    await click('[data-act=create]:visible');
    // edit sheet on the created job
    await click('[data-act=editopen]:visible'); await shot('edit-created'); log('save disabled: ' + await p.locator('[data-act=editsave]').isDisabled());
    await p.fill('[data-f=name][data-c=e]', 'Hilton gala — ballroom'); await p.waitForTimeout(W); log('foot: ' + (await p.locator('#sheetfoot .nochg').textContent()));
    await click('[data-act=editsave]'); log('edit toast: ' + await toastTxt()); await click('[data-act=undo]');
    // #2341 date-move gate
    await click((phone ? '.phonehead ' : '.wzhead ') + '[data-act=pagemenu]'); await click('[data-act=editexisting]'); await shot('edit-2341');
    log('locked discount disabled: ' + await p.locator('[data-f=discount]').isDisabled());
    await click('[data-act=caltoggle][data-c=e]'); await click('[data-act=calday][data-d="2026-11-16"]'); await click('[data-act=calday][data-d="2026-11-17"]'); // no clash move
    await click('[data-act=editsave]'); log('no-clash save toast: ' + await toastTxt() + ' · dialog: ' + await p.locator('.nest').count()); await click('[data-act=undo]');
    await click('[data-act=editopen]:visible'); await click('[data-act=caltoggle][data-c=e]'); await click('[data-act=calday][data-d="2026-11-19"]'); await click('[data-act=calday][data-d="2026-11-21"]');
    await click('[data-act=editsave]'); log('gate: ' + (await p.locator('.nest .gatelist').textContent()).trim().replace(/\s+/g, ' ')); await shot('gate');
    await click('.nest button[data-act=closenest]'); log('sheet still open: ' + await p.locator('.eside').count());
    await click('[data-act=editsave]'); await click('[data-act=gosave]'); log('gate save toast: ' + await toastTxt() + ' · header: ' + (await p.locator('#wzhead .wzsub').textContent()).trim());
    await click('[data-act=undo]'); log('after undo dates: ' + await p.evaluate(() => state.jobs['2341'].start));
    // template edit + new template
    await click((phone ? '.phonehead ' : '.wzhead ') + '[data-act=pagemenu]'); await click('[data-act=new2]');
    await click('[data-act=tplmenu]'); await click('[data-act=tplmanage]'); await click('[data-act=tplrowmenu] >> nth=1'); await click('[data-act=tpledit]'); await shot('edit-template'); await click('[data-act=close] >> nth=-1').catch(()=>{}); await p.keyboard.press('Escape');
    await click('[data-act=tplmenu]'); await click('[data-act=newtpl]'); await p.fill('[data-f=name]', 'Wedding ceremony'); await click('[data-act=step][data-s="2"]'); await click('[data-act=create]:visible'); log('template created: ' + await toastTxt());
    // discard draft
    await p.fill('[data-f=name][data-c=w]', 'Throwaway'); await p.waitForTimeout(W);
    await click((phone ? '.phonehead ' : '.wzhead ') + '[data-act=pagemenu]'); await click('[data-act=discard]'); await click('[data-act=discardgo]'); log('discard toast: ' + await toastTxt()); await click('[data-act=undo]'); log('restored name: ' + await p.inputValue('[data-f=name][data-c=w]'));
    // enquiry escape
    await click('[data-act=enquiry]:visible'); log('enquiry toast: ' + await toastTxt());
    // empty templates state
    await click('[data-act=new2]').catch(()=>{});
    log('h-scroll: ' + await p.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.querySelector('.content').scrollWidth > document.querySelector('.content').clientWidth + 1));
    await p.close();
  };
  await run(1440, 900, 'desk'); await run(390, 844, 'phone');
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
