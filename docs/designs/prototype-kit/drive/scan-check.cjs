// Drive: node scan-check.cjs  (run from this directory; NODE_PATH = global node_modules)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const errs = [];
  const run = async (w, h, tag) => {
    const phone = tag === 'phone';
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    p.on('pageerror', e => errs.push(tag + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(tag + ' console: ' + m.text()); });
    await p.goto('file://' + process.cwd() + '/scan-prototype.html'); await p.waitForTimeout(500);
    const log = s => console.log(tag, s), w1 = () => p.waitForTimeout(120);
    const PRI = phone ? '#phoneact' : '#deskprimary';
    const PM = phone ? '.phonehead [data-act=pagemenu]' : '.lphead [data-act=pagemenu]';
    const txt = async sel => (await p.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
    const item = t => p.locator('#layerbody button, #layerbody a', { hasText: t }).first();
    const scan = async t => { await p.fill('#q', t); await p.press('#q', 'Enter'); await w1(); };
    const assert = (name, ok, v) => log(`${ok ? 'ok  ' : 'FAIL'} ${name}${v !== undefined ? ': ' + v : ''}`);
    await p.screenshot({ path: `shots/${tag}-1-load.png` });

    // initial state
    log('strip: ' + (await p.locator('#strip button').allTextContents()).join(' | '));
    assert('primary disabled until answered', await p.locator(`${PRI} [data-act=save]`).first().isDisabled());
    assert('hint says items left', (await txt('#phoneact .t-small')).includes('6 items left'), await txt('#phoneact .t-small'));
    assert('last scans rows (check, collapsed)', await p.locator('#last .ls').count() === (phone ? 3 : 5), await p.locator('#last .ls').count());

    // pass all + undo
    await p.click('[data-act=passall]'); await w1();
    assert('pass all marks 4', (await txt('#toast')).includes('4 items marked Pass'), await txt('#toast'));
    await p.click('#toast [data-act=undo]'); await w1();
    assert('undo restores', (await txt('.sc-sec:has-text("Checklist") .n')) === '0/6', await txt('.sc-sec:has-text("Checklist") .n'));
    await p.click('[data-act=passall]'); await w1();
    await p.fill('[data-f="v:hrs"]', '4120'); await p.selectOption('[data-f="dd:cos"]', 'Good'); await w1();
    assert('primary enabled when all answered', !(await p.locator(`${PRI} [data-act=save]`).first().isDisabled()));
    // fail one item: needs reason + photo, condition locked
    await p.click('[data-act=ckf][data-i=yoke]'); await w1();
    assert('fail blocks save with reason hint', (await txt('#phoneact .t-small')).includes('Yoke needs a reason and a photo'), await txt('#phoneact .t-small'));
    assert('condition locked to Damaged', (await txt('.fwline .wd.on')) === 'Damaged', await txt('.fwline .wd.on'));
    await p.screenshot({ path: `shots/${tag}-2-fail.png` });
    await p.fill('[data-f="note:yoke"]', 'Clamp bolt sheared'); await p.click('.failbox [data-act=addph]'); await w1();
    assert('fail + reason + photo enables save', !(await p.locator(`${PRI} [data-act=save]`).first().isDisabled()));
    await p.click('.failbox .ph button'); await w1();
    assert('removing the photo blocks again', await p.locator(`${PRI} [data-act=save]`).first().isDisabled());
    await p.click('[data-act=ckp][data-i=yoke]'); await w1();
    await p.click('[data-act=cknote][data-i=lens]'); await w1();
    assert('item note field opens', await p.locator('[data-f="note:lens"]').count() === 1);
    await p.click('.fwline .wd[data-v=WORN]'); await w1();
    await p.click('.sc-sec:has-text("Photos") ~ .phs [data-act=addph]'); await w1();
    assert('general photo added', await p.locator('.sc-sec:has-text("Photos") ~ .phs .ph').count() === 1);

    // save + both undo surfaces
    const before = +(await p.locator('#strip button.on .n').innerText());
    await p.click(`${PRI} [data-act=save]`); await w1();
    assert('save toast has Undo', (await txt('#toast')).includes('Check saved · AURA-01'), await txt('#toast'));
    assert('card cleared to ready', (await txt('#card')).includes('Scan a tag to check it'));
    assert('strip count +1', +(await p.locator('#strip button.on .n').innerText()) === before + 1);
    assert('top row has Undo word', await p.locator('#last .ls >> nth=0 >> .uw[data-act=stripundo]').count() === 1);
    await p.screenshot({ path: `shots/${tag}-3-saved.png` });
    await p.click('#last .ls >> nth=0 >> .uw'); await w1();
    assert('strip Undo restores the draft', (await txt('#card')).includes('AURA-01') && await p.locator('[data-act=ckp]').count() > 0);
    assert('strip count back', +(await p.locator('#strip button.on .n').innerText()) === before);
    await p.click(`${PRI} [data-act=save]`); await w1(); // save again
    await p.click('#toast [data-act=undo]'); await w1(); // toast Undo = same closure
    assert('toast Undo restores too', (await txt('#card')).includes('AURA-01'));
    await p.keyboard.press('Control+Enter'); await w1();
    assert('Ctrl+Enter saves', (await txt('#card')).includes('Scan a tag'));

    // scan states
    await scan('L-0007');
    assert('on another job says so', (await txt('#card')).includes('On #2340 Launch night'), (await txt('#card')).slice(0, 120));
    await p.screenshot({ path: `shots/${tag}-4-otherjob.png` });
    await scan('XX-999');
    assert('unknown tag state', (await txt('#card')).includes('No asset carries this tag'));
    await p.screenshot({ path: `shots/${tag}-5-unknown.png` });
    await scan('LX-04'); assert('no check items state', (await txt('#card')).includes('No check items for this model'));
    await p.click('#card a.lnk'); // settings link (navigates nowhere in file://) -- ignore result
    await p.goto('file://' + process.cwd() + '/scan-prototype.html'); await p.waitForTimeout(400);
    await scan('SK-0012'); await p.click('[data-act=passall]'); await w1();
    await scan('AURA-02');
    assert('dirty scan asks to discard', (await txt('#layerbody')).includes('Discard this check?'));
    await p.click('.dlg [data-act=close]'); await w1(); assert('keep editing keeps SK-0012', (await txt('#card')).includes('SK-0012'));
    await scan('AURA-02'); await p.click('[data-act=discardgo]'); await w1();
    assert('discard opens next', (await txt('#card')).includes('AURA-02'));

    // camera sheet
    await p.click(phone ? '.camb' : '.camb'); await w1();
    assert('camera sheet opens', (await txt('#layerbody')).includes('Camera live'));
    await p.screenshot({ path: `shots/${tag}-6-camera.png` });
    await p.click('#layerbody .samp >> text=A-0301'); await w1();
    assert('camera read loads asset and closes the sheet', (await txt('#card')).includes('A-0301') && !(await p.locator('#layer.open').count()));
    if (phone) { await p.click('.bottomnav a[data-act=camera]'); await w1(); assert('nav Scan opens camera', (await txt('#layerbody')).includes('Camera live')); await p.click('#layerbody .dlg [data-act=close]'); await w1(); }
    const nav = await p.locator('.bottomnav a.on').allTextContents(); assert('bottom nav Scan active', nav.join('').includes('Scan'), nav.join('|'));

    // menus
    await p.click('#card [data-act=cardmenu]'); await w1();
    assert('card menu', (await txt('#layerbody')).includes('Create maintenance job') && (await txt('#layerbody')).includes('Open asset'));
    await p.screenshot({ path: `shots/${tag}-7-cardmenu.png` });
    await p.keyboard.press('Escape'); await w1();
    await p.click(PM); await w1();
    assert('page menu has T&T list + sounds', (await txt('#layerbody')).includes('Test & tag list') && (await txt('#layerbody')).includes('Scan sounds'));
    await item('Scan sounds').click(); await w1(); assert('sound toggle toasts', (await txt('#toast')).includes('Scan sounds off'));

    // ---- Test & tag
    await p.click('#strip button[data-m=tt]'); await w1();
    assert('mode switched, active underlined', (await txt('#strip button.on')).startsWith('Test & tag'));
    await scan('AURA-01');
    assert('T&T form rendered', await p.locator('.vrow').count() === 9, await p.locator('.vrow').count());
    assert('primary disabled (visual not done)', await p.locator(`${PRI} [data-act=save]`).first().isDisabled() && (await txt('#phoneact .t-small')).includes('Visual inspection not done'));
    await p.click('.vrow >> nth=1'); await p.click('.vrow >> nth=4', { modifiers: ['Shift'] }); await w1();
    assert('shift-click ticks range', (await txt('.sc-sec:has-text("Visual inspection") .n')) === '4/9', await txt('.sc-sec:has-text("Visual inspection") .n'));
    await p.click('.sc-sec:has-text("Visual inspection") [data-act=visall]'); await w1();
    assert('visual pass all', (await txt('.sc-sec:has-text("Visual inspection")')).includes('9/9'));
    await p.fill('[data-f="rd:earth"]', '0.2'); await p.fill('[data-f="rd:ins"]', '45'); await w1();
    assert('primary enabled', !(await p.locator(`${PRI} [data-act=save]`).first().isDisabled()), await txt('.resline'));
    assert('next due derived 9 Nov 2027', (await txt('.resline')).includes('9 Nov 2027'), await txt('.resline'));
    await p.click('[data-act=methodmenu]'); await w1(); await item('Both').click(); await w1();
    assert('method Both adds leakage row', await p.locator('[data-f="rd:leak"]').count() === 1);
    assert('blank leakage blocks (never a pass)', (await txt('#phoneact .t-small')).includes('Enter leakage current'), await txt('#phoneact .t-small'));
    await p.click('[data-act=na][data-k=leak]'); await w1();
    assert('N/A releases it', !(await p.locator(`${PRI} [data-act=save]`).first().isDisabled()));
    await p.click('[data-act=tester]'); await w1(); await item('Sam Okafor').click(); await w1();
    assert('tester session-wide', (await txt('#phonesub')).includes('Sam Okafor') && (await txt('[data-act=tester]')).includes('Sam Okafor'));
    await p.click('#card [data-act=cardmenu]'); await w1(); await item('Quick pass').click(); await w1();
    assert('quick pass fills from last', (await txt('#card')).includes('Repeated from 19 Nov'));
    await p.screenshot({ path: `shots/${tag}-8-tt.png` });
    await p.click(`${PRI} [data-act=savemenu]`); await w1();
    assert('save menu has print label', (await txt('#layerbody')).includes('Save and print label'));
    await item('Save and print label').click(); await w1();
    assert('print variant toast', (await txt('#toast')).includes('label queued'), await txt('#toast'));
    assert('T&T entry saved w/ next due', (await txt('#last .ls >> nth=0')).includes('Pass · next 9 Nov 2027'), await txt('#last .ls >> nth=0'));
    // fail path on distro
    await scan('PD-02');
    assert('outlets rendered', await p.locator('.outrow').count() === 6);
    await p.click('.sc-sec:has-text("Visual inspection") [data-act=visall]'); await p.click('[data-act=polp]');
    for (let i = 0; i < 6; i++) { await p.fill(`[data-f="out:${i}:e"]`, '0.2'); await p.fill(`[data-f="out:${i}:i"]`, i === 2 ? '0.4' : '12'); }
    await w1();
    assert('outlet 3 insulation fails the test', (await txt('.resline')).startsWith('Fail'), await txt('.resline'));
    assert('failure block + flag line', (await txt('#card')).includes('Flags the asset'));
    await p.click('[data-act=outplus]'); await w1(); assert('outlet added; a decided fail still saves', await p.locator('.outrow').count() === 7 && !(await p.locator(`${PRI} [data-act=save]`).first().isDisabled()));
    await p.click('[data-act=outminus]'); await w1();
    await p.click('[data-act=factmenu]'); await w1(); await item('Referred to electrician').click(); await w1();
    await p.screenshot({ path: `shots/${tag}-9-ttfail.png` });
    await p.click(`${PRI} [data-act=savemenu]`); await w1(); await item('Save and create maintenance job').click(); await w1();
    assert('maintenance dialog prefilled', (await p.inputValue('#mIssue')).startsWith('Failed T&T'), await p.inputValue('#mIssue'));
    await p.click('[data-act=maintgo]'); await w1();
    assert('maintenance job created + toast Undo', (await txt('#toast')).includes('Maintenance job MJ-'), await txt('#toast'));
    assert('fail row listed', (await txt('#last')).includes('Fail · '), '');
    await p.click('#toast [data-act=undo]'); await w1();
    // not on register / retired / add
    await scan('SK-0012'); assert('not on register state', (await txt('#card')).includes('Not on the test & tag register'));
    await p.click('[data-act=addreg]'); await w1(); assert('added to register -> form', await p.locator('.vrow').count() === 9);
    await scan('PD-01'); assert('retired state', (await txt('#card')).includes('Retired from test & tag'));
    await p.click('[data-act=reactivate]'); await w1(); assert('reactivate opens form', await p.locator('.outrow').count() === 6);
    await p.click('#toast [data-act=undo]'); await w1();
    await scan('AURA-03'); await p.click('#card [data-act=cardmenu]'); await w1(); await item('Retire from test').click(); await w1();
    assert('retire confirm names downstream', (await txt('#layerbody')).includes('stops counting'));
    await p.click('[data-act=retirego]'); await w1(); assert('retired -> state', (await txt('#card')).includes('Retired from test & tag'));
    await p.click('#toast [data-act=undo]'); await w1(); assert('retire undone -> form', await p.locator('.vrow').count() === 9);
    await scan('AURA-05'); // dirty? untouched -> fine
    // last scans: show more, row menu, empty
    await p.click('#last [data-act=showmore]'); await w1();
    assert('show more expands', await p.locator('#last .ls').count() > (phone ? 3 : 5), await p.locator('#last .ls').count());
    await p.click('#last .ls [data-act=lsmenu] >> nth=0'); await w1(); assert('row menu', (await txt('#layerbody')).includes('Scan it again')); await p.keyboard.press('Escape'); await w1();
    await p.click(PM); await w1(); await item('Clear last scans').click(); await w1();
    assert('empty last scans', (await txt('#last')).includes('Nothing scanned yet.'));
    await p.click('#toast [data-act=undo]'); await w1(); assert('clear undone', await p.locator('#last .ls').count() > 0);
    await p.click('#card [data-act=cardmenu]'); await w1(); await item('Clear this scan').click(); await w1();
    assert('clear scan -> ready, primary becomes Scan', (await txt(PRI)).startsWith('Scan'), await txt(PRI));
    await p.click(`${PRI} [data-act=scanprimary]`); await w1();
    assert(phone ? 'phone Scan primary opens camera' : 'desktop Scan primary focuses dock', phone ? (await txt('#layerbody')).includes('Camera live') : await p.evaluate(() => document.activeElement.id === 'q'));
    await p.screenshot({ path: `shots/${tag}-10-end.png` });
    await p.close();
  };
  await run(1440, 900, 'desk'); await run(390, 844, 'phone');
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
