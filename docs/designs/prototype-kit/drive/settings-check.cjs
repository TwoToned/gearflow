// Run from this directory: NODE_PATH=<global node_modules> node settings-check.cjs [file.html]
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const errs = [];
  const file = 'file://' + process.cwd() + '/' + (process.argv[2] || 'settings-prototype.html');
  const run = async (w, h, tag) => {
    const phone = tag === 'phone';
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    p.on('pageerror', e => errs.push(tag + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(tag + ' console: ' + m.text()); });
    const log = s => console.log(tag, s);
    const wait = (n = 120) => p.waitForTimeout(n);
    const toastText = async () => ((await p.locator('#toast').textContent()) || '').replace(/Undo|✕/g, '').trim();
    const undo = async () => { await p.click('#toast [data-act="undo"]'); await wait(); };
    const mrows = () => p.locator(phone ? '#t-members .list .lrow' : '#t-members tbody tr').count();
    const irows = () => p.locator(phone ? '#t-invites .list .lrow' : '#t-invites tbody tr').count();
    const rrows = () => p.locator(phone ? '#t-reqs .list .lrow' : '#t-reqs tbody tr').count();
    const cbs = (sec) => p.locator(phone ? `${sec} .list .cb` : `${sec} tbody .cb`);
    const dots = (sec, i) => p.locator(phone ? `${sec} .list .dots` : `${sec} tbody .dots`).nth(i);
    const openMenuFor = async (sec, i) => { if (!phone) await p.locator(`${sec} tbody tr`).nth(i).hover(); await dots(sec, i).click(); await wait(); };
    const goto = async (hash) => { await p.goto(file + (hash ? '#' + hash : '')); await wait(400); };

    // ---- index
    await goto('');
    await p.screenshot({ path: `shots/check-${tag}-index.png` });
    log('groups: ' + (await p.locator('.gh b').allTextContents()).join(' | '));
    log('index rows: ' + await p.locator('.irow').count());
    log('count word: ' + (await p.locator('.lphead .cnt').textContent()));
    log('statuses: ' + (await p.locator('.irow .st').allTextContents()).slice(0, 5).join(' | '));
    if (!phone) { await p.keyboard.press('/'); log('slash focuses search: ' + await p.evaluate(() => document.activeElement.id)); }
    await p.fill('#q', 'tax'); await wait();
    log('search "tax": ' + (await p.locator('.irow .nm').allTextContents()).join(', '));
    await p.fill('#q', 'timezone'); await wait();
    log('search "timezone": ' + (await p.locator('.irow').count()) + ' · ' + (await p.locator('.irow .ds').first().textContent()));
    await p.fill('#q', 'zzzz'); await wait();
    log('search none: ' + (await p.locator('#idx .empty b').textContent()));
    await p.fill('#q', ''); await wait();
    // every row opens its section (stub or team) and back
    const keys = await p.locator('.irow').evaluateAll(els => els.map(e => e.dataset.k));
    let opened = 0, stubOk = 0;
    for (const k of keys) {
      await p.click(`.irow[data-k="${k}"]`); await wait(60);
      await (phone ? p.locator('.phonehead .ell').first().textContent() : p.locator('.set h1').textContent());
      opened++;
      if (k !== 'team') { if ((await p.locator('.quiet').count()) && (await p.locator('.stubrow').count())) stubOk++; }
      if (opened === 3) await p.screenshot({ path: `shots/check-${tag}-stub.png` });
      await p.click(phone ? '.phonehead [data-act="goindex"]' : '.crumb [data-act="goindex"]'); await wait(60);
    }
    log(`rows opened: ${opened} · stubs with parts+gate: ${stubOk} (expect ${keys.length - 1})`);
    await p.click('[data-act="pagemenu"] >> visible=true'); await wait(); log('index page menu: ' + (await p.locator(phone ? '.sheetwrap .item' : '.menu button').allTextContents()).join(' | ')); await p.keyboard.press('Escape');
    // preview as role
    await p.click('[data-act="pagemenu"] >> visible=true'); await p.click('[data-act="viewas"]'); await wait(); await p.click('[data-act="setview"][data-v="manager"]'); await wait();
    log('as manager rows: ' + await p.locator('.irow').count() + ' · footer: ' + ((await p.locator('#idxfoot').textContent()) || '').trim().slice(0, 40));
    log('xero visible as manager: ' + await p.locator('.irow[data-k="xero"]').count());
    await p.click('.irow[data-k="team"]'); await wait();
    log('manager team: note=' + await p.locator('.quiet').count() + ' checkboxes=' + await p.locator('#t-members .cb').count() + ' invite primary=' + await p.locator('[data-act="new"] >> visible=true').count() + ' policy section=' + await p.locator('#s-policy').count());
    await p.screenshot({ path: `shots/check-${tag}-manager.png` });
    await p.click('[data-act="pagemenu"] >> visible=true'); await p.click('[data-act="viewas"]'); await wait(); await p.click('[data-act="setview"][data-v="viewer"]'); await wait();
    log('as viewer: ' + (await p.locator('.denied h2').textContent()));
    await p.click('.denied [data-act="viewas"]'); await wait(); await p.click('[data-act="setview"][data-v="owner"]'); await wait();

    // ---- team
    await goto('team');
    log('members: ' + await mrows() + ' · invites ' + await irows() + ' · requests ' + await rrows());
    log('primary: ' + (phone ? await p.locator('#phoneact .btn-primary').textContent() : await p.locator('.hact .btn-primary').textContent()));
    // search + filter
    await p.fill('#mq', 'okafor'); await wait(); log('search okafor: ' + await mrows());
    await p.fill('#mq', 'zzzz'); await wait(); log('search none: ' + (await p.locator('#t-members .emptyl').textContent()).slice(0, 30));
    await p.fill('#mq', ''); await wait();
    await p.click('#mf [data-act="rolef"]'); await wait(); await p.click('[data-act="rolefx"][data-v="member"]'); await wait(150);
    log('filter word: ' + (await p.locator('#mf .fw').first().textContent()).trim() + ' → rows ' + await mrows());
    await p.keyboard.press('Escape'); await p.click('#mf [data-act="clearf"]'); await wait();
    log('cleared: ' + await mrows());
    // tick + shift range, bulk with owner in range
    await cbs('#t-members').nth(0).click(); await wait(60);
    await cbs('#t-members').nth(2).click({ modifiers: ['Shift'] }); await wait();
    log('bulk (owner,admin,manager): ' + (await p.locator('#bulk').textContent()).trim());
    await p.screenshot({ path: `shots/check-${tag}-sel.png` });
    await p.click('#bulk [data-act="bulkrole"]'); await wait(); await p.click('[data-act="setrolen"][data-v="viewer"]'); await wait();
    log('toast: ' + await toastText());
    log('roles now: ' + (await p.locator(phone ? '#t-members .list .right' : '#t-members tbody td:nth-child(3)').allTextContents()).slice(0, 4).join(','));
    await undo(); log('after undo: ' + (await p.locator(phone ? '#t-members .list .right' : '#t-members tbody td:nth-child(3)').allTextContents()).slice(0, 4).join(',') + ' · bulk open ' + await p.locator('#bulk.open').count());
    // bulk remove skips owner
    await cbs('#t-members').nth(0).click(); await cbs('#t-members').nth(8).click({ modifiers: ['Shift'] }); await wait();
    await p.keyboard.press('Escape'); log('escape clears selection: ' + await p.locator('#bulk.open').count());
    await cbs('#t-members').nth(7).click(); await cbs('#t-members').nth(8).click(); await cbs('#t-members').nth(0).click(); await wait();
    await p.click('#bulk [data-act="bulkremove"]'); await wait(); log('remove dialog: ' + (await p.locator('.dlg .hd h2').textContent()) + ' — ' + (await p.locator('.dlg .bd').textContent()).slice(0, 110));
    await p.screenshot({ path: `shots/check-${tag}-removedlg.png` });
    await p.click('[data-act="removego"]'); await wait(); log('toast: ' + await toastText() + ' → members ' + await mrows());
    await undo(); log('undo → members ' + await mrows());
    // role word / row menu
    if (!phone) { await p.locator('#t-members tbody .rolew').nth(4).click(); await wait(); log('role menu: ' + (await p.locator('.menu button').allTextContents()).join(' | ')); await p.click('[data-act="setrole1"][data-v="manager"]'); await wait(); log('toast: ' + await toastText()); await undo(); }
    await openMenuFor('#t-members', 8); log('member menu: ' + (await p.locator(phone ? '.sheetwrap .item' : '.menu button').allTextContents()).join(' | '));
    await p.click('[data-act="removeone"]'); await wait(); await p.click('[data-act="removego"]'); await wait(); log('remove one: ' + await toastText() + ' → ' + await mrows()); await undo();
    await openMenuFor('#t-members', 0); log('owner menu: ' + (await p.locator(phone ? '.sheetwrap .item' : '.menu button').allTextContents()).join(' | ')); await p.keyboard.press('Escape');
    // invites
    await openMenuFor('#t-invites', 1); log('invite menu: ' + (await p.locator(phone ? '.sheetwrap .item' : '.menu button').allTextContents()).join(' | '));
    await p.click('[data-act="resend"]'); await wait(); log('resend: ' + await toastText() + ' · status ' + (await p.locator(phone ? '#t-invites .list .dotw' : '#t-invites tbody .dotw').allTextContents()).join(','));
    await openMenuFor('#t-invites', 0); await p.click('[data-act="revokeone"]'); await wait(); await p.click('[data-act="revokego"]'); await wait(); log('revoke: ' + await toastText() + ' → invites ' + await irows());
    await undo(); log('undo → invites ' + await irows());
    await cbs('#t-invites').nth(0).click(); await cbs('#t-invites').nth(1).click(); await wait(); log('invite bulk: ' + (await p.locator('#bulk').textContent()).trim());
    await p.click('#bulk [data-act="bulkresend"]'); await wait(); log('bulk resend: ' + await toastText());
    await p.click('#t-invites .cb >> nth=0').catch(() => {});
    await p.keyboard.press('Escape'); await wait();
    // requests
    await openMenuFor('#t-reqs', 0); log('request menu: ' + (await p.locator(phone ? '.sheetwrap .item' : '.menu button').allTextContents()).join(' | '));
    await p.click('[data-act="approve1"]'); await wait(); log('approve: ' + await toastText() + ' → members ' + await mrows() + ' requests ' + await rrows()); await undo(); log('undo → members ' + await mrows() + ' requests ' + await rrows());
    // invite dialog
    await p.click(phone ? '#phoneact .btn-primary' : '.hact .btn-primary'); await wait(); await p.screenshot({ path: `shots/check-${tag}-invite.png` });
    await p.click('[data-act="invitego"]'); log('invite empty: ' + await p.locator('#inv-err').textContent());
    await p.fill('#inv-email', 'dan@bigpicture.com.au'); await p.click('[data-act="invitego"]'); log('invite member: ' + await p.locator('#inv-err').textContent());
    await p.fill('#inv-email', 'mia.rossi@outlook.com'); await p.click('[data-act="invitego"]'); log('invite dup: ' + await p.locator('#inv-err').textContent());
    await p.fill('#inv-email', 'Lena.Fischer@twotoned.com.au'); await p.click('[data-act="invrole"][data-v="viewer"]'); await p.click('[data-act="invitego"]'); await wait();
    log('invited: ' + await toastText() + ' → invites ' + await irows()); await undo(); log('undo → invites ' + await irows());
    if (!phone) { await p.keyboard.press('n'); await wait(); log('n opens invite: ' + await p.locator('#inv-email').count()); await p.keyboard.press('Escape'); }
    // policy dirty
    await p.evaluate(() => document.querySelector('#s-policy').scrollIntoView());
    await p.click('.rdo[data-v="CLOSED"]'); await wait();
    log('dirty bar: ' + (await p.locator('#dirty').textContent()).trim() + ' · open ' + await p.locator('#dirty.open').count() + ' · header primary class ' + (phone ? 'phone sticky hidden=' + (await p.locator('#phoneact').isHidden()) : await p.locator('.hact .btn').first().getAttribute('class')));
    await p.screenshot({ path: `shots/check-${tag}-dirty.png` });
    await p.click('#dirty [data-act="discard"]'); await wait(); log('discard: ' + await p.locator('#dirty.open').count() + ' · selected ' + await p.locator('.rdo.on b').textContent());
    await p.click('.rdo[data-v="INVITE_ONLY"]'); await wait(); await p.click('#dirty [data-act="save"]'); await wait(); log('save: ' + await toastText() + ' · requests text: ' + ((await p.locator('#t-reqs .emptyl, #t-reqs tbody tr').count()) ? 'ok' : ''));
    log('requests section after Invite only: ' + (await p.locator('#t-reqs').textContent()).trim().slice(0, 50)); await undo(); log('undo → ' + await p.locator('.rdo.on b').textContent());
    await p.click('.rdo[data-v="CLOSED"]'); await wait(); await p.click(phone ? '.phonehead [data-act="goindex"]' : '.crumb [data-act="goindex"]'); await wait();
    log('leave guard: ' + (await p.locator('.dlg .hd h2').textContent())); await p.click('[data-act="close"] >> nth=-1').catch(() => {}); await p.keyboard.press('Escape'); await wait();
    await p.click(phone ? '.phonehead [data-act="goindex"]' : '.crumb [data-act="goindex"]'); await wait(); await p.click('[data-act="leave"]'); await wait(); log('left to: ' + await p.locator('.irow').count() + ' rows (index)');
    await goto('team');
    // roles
    await p.evaluate(() => document.querySelector('#s-roles').scrollIntoView());
    if (!phone) {
      log('matrix: ' + await p.locator('.mx tbody tr.res').count() + ' resources × ' + await p.locator('.mx thead th').count() + ' cols · footer ' + (await p.locator('.mx tfoot td').allTextContents()).join(' '));
      await p.click('tr.res[data-v="invoice"]'); await wait(); log('expanded rows: ' + await p.locator('.mx tr.act').count());
      await p.screenshot({ path: `shots/check-${tag}-matrix.png` });
      await p.click('tr.res[data-v="invoice"]');
    }
    await p.click((phone ? '.rolesl ' : 'th ') + '[data-act="role"][data-v="manager"]').catch(async () => { await p.click('[data-act="role"][data-v="manager"] >> visible=true'); }); await wait();
    log('role sheet: ' + (await p.locator('.dlg h2').textContent()) + ' · ' + (await p.locator('#rcnt').textContent()));
    await p.click('[data-act="rtoggle"][data-res="client"][data-a="delete"]'); await wait(); log('toggle: ' + (await p.locator('#rcnt').textContent()) + ' · save label ' + (await p.locator('#rsave').textContent()));
    await p.click('[data-act="rtoggle"][data-res="project"][data-a="read"]'); await wait(); log('view off clears the rest: ' + (await p.locator('#rcnt').textContent()));
    await p.screenshot({ path: `shots/check-${tag}-rolesheet.png` });
    await p.click('[data-act="rreset"]'); await wait(); log('reset: ' + (await p.locator('#rcnt').textContent()));
    await p.click('[data-act="rtoggle"][data-res="client"][data-a="delete"]'); await p.click('#rsave'); await wait(); log('saved: ' + await toastText());
    log('edited marker: ' + (await p.locator('.warnw').count()));
    await undo(); log('undo → edited markers ' + await p.locator('.warnw').count());
    await p.click('[data-act="role"][data-v="admin"] >> visible=true'); await wait(); log('admin locks: ' + await p.locator('.acts label.lk').count()); await p.keyboard.press('Escape');
    await p.click('[data-act="role"][data-v="owner"] >> visible=true'); await wait(); log('owner sheet save button: ' + await p.locator('#rsave').count()); await p.keyboard.press('Escape'); await wait();
    if (!phone) { await p.click('[data-act="rolemenu"]'); await wait(); log('edit role menu: ' + (await p.locator('.menu button').allTextContents()).join(' | ')); await p.keyboard.press('Escape'); }
    // page menu
    await p.click('[data-act="pagemenu"] >> visible=true'); await wait(); log('team page menu: ' + (await p.locator(phone ? '.sheetwrap .item' : '.menu button').allTextContents()).join(' | ')); await p.click('[data-act="jump"] >> nth=0'); await wait();
    // phone sticky primary + bulk replacing
    if (phone) {
      await p.evaluate(() => document.querySelector('.content').scrollTo(0, 0));
      log('sticky primary visible: ' + await p.locator('#phoneact .btn-primary').isVisible());
      await cbs('#t-members').nth(1).click(); await wait(); log('sticky hidden when selected: ' + await p.locator('#phoneact').isHidden() + ' · bulk ' + (await p.locator('#bulk').textContent()).trim());
      await p.click('#bulk [data-act="clearsel"]');
      await p.click('.phonehead [data-act="pagemenu"]'); await wait(); await p.screenshot({ path: `shots/check-phone-menu.png` }); await p.keyboard.press('Escape');
    }
    await p.close();
  };
  await run(1440, 900, 'desk');
  await run(390, 844, 'phone');
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
