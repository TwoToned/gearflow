// Run from this directory: NODE_PATH=$(npm root -g) node people-check.cjs
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const errs = [];
  const run = async (w, h, tag) => {
    const desk = tag === 'desk';
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    p.on('pageerror', e => errs.push(tag + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(tag + ' console: ' + m.text()); });
    const R = desk ? '#tblwrap tr.row' : '#list .lrow[data-id]', CB = R + ' .cb';
    const log = s => console.log(tag, s);
    const n = async sel => await p.locator(sel).count();
    const txt = async sel => (await p.locator(sel).first().textContent()).trim().replace(/\s+/g, ' ');
    const go = async (hash) => { await p.goto('file://' + process.cwd() + '/people-prototype.html' + (hash || '')); await p.waitForTimeout(350); };
    await go();
    await p.screenshot({ path: `shots/people-${tag}-1.png` });
    // ---- CREW
    log('crew strip: ' + (await p.locator('#strip button').allTextContents()).join(' | '));
    log('crew rows: ' + await n(R) + ' head: ' + await txt('#title') + ' ' + await txt('#count') + ' foot: ' + await txt('#foot'));
    log('crew first row: ' + await txt(R));
    await p.click('#strip button[data-k="unconf"]'); await p.waitForTimeout(100);
    const unc = await p.locator(R).allTextContents();
    log('unconfirmed rows: ' + unc.length + ' · Dev Patel present: ' + unc.some(t => t.includes('Dev Patel')) + ' · hash: ' + await p.evaluate(() => location.hash));
    await p.screenshot({ path: `shots/people-${tag}-unconf.png` });
    await p.click('#strip button[data-k="inactive"]'); log('inactive rows: ' + await n(R));
    await p.click('#strip button[data-k="onjob"]'); log('on a job rows: ' + await n(R));
    await p.click('#strip button[data-k="avail"]'); log('available rows: ' + await n(R));
    await p.click('#strip button[data-k="all"]');
    await p.click('[data-act="fmenu"][data-k="type"]'); await p.waitForTimeout(150);
    await p.screenshot({ path: `shots/people-${tag}-filtermenu.png` });
    await p.click('[data-act="ftoggle"][data-v="Freelancer"]'); await p.waitForTimeout(100);
    await p.click('[data-act="ftoggle"][data-v="Employee"]'); await p.waitForTimeout(100);
    await p.keyboard.press('Escape');
    log('fwords: ' + (await p.locator('#fwords .fw').allTextContents()).join(' | ') + ' rows: ' + await n(R) + ' hash: ' + await p.evaluate(() => location.hash));
    await p.click('[data-act="clearf"]'); await p.waitForTimeout(100);
    await p.fill('#q', 'rigger'); await p.waitForTimeout(100); log('search rigger rows: ' + await n(R));
    await p.fill('#q', 'zzzz'); await p.waitForTimeout(100); log('empty: ' + await txt('.empty')); await p.screenshot({ path: `shots/people-${tag}-empty.png` });
    await p.fill('#q', '');
    if (desk) {
      await p.click('th button[data-k="rate"]'); await p.click('th button[data-k="rate"]'); await p.waitForTimeout(100);
      log('first rate after desc: ' + await txt(R + ' >> nth=0 >> td.r.mono >> nth=1') .catch(() => ''));
      await p.click('th button[data-k="status"]'); await p.waitForTimeout(100);
    }
    // selection + shift range
    await p.click(CB + ' >> nth=0'); await p.click(CB + ' >> nth=3', { modifiers: ['Shift'] }); await p.waitForTimeout(100);
    log('bulk: ' + await txt('#bulk'));
    await p.screenshot({ path: `shots/people-${tag}-sel.png` });
    // message
    await p.click('#bulk [data-act="bmsg"]'); await p.waitForTimeout(150);
    await p.fill('#m-text', 'Truck leaves 06:30'); await p.click('[data-act="msggo"]'); await p.waitForTimeout(100);
    log('message toast: ' + await txt('#toast'));
    // assign to job + undo
    const uBefore = await txt('#strip button[data-k="unconf"] .n');
    await p.click(CB + ' >> nth=0'); await p.click(CB + ' >> nth=2', { modifiers: ['Shift'] }); await p.waitForTimeout(100);
    await p.click('#bulk [data-act="bassign"]'); await p.waitForTimeout(150);
    await p.click('[data-act="assigngo"] >> nth=1'); await p.waitForTimeout(150);
    log('assign toast: ' + await txt('#toast') + ' · unconfirmed ' + uBefore + ' -> ' + await txt('#strip button[data-k="unconf"] .n'));
    await p.click('[data-act="undo"]'); await p.waitForTimeout(100);
    log('after undo unconfirmed: ' + await txt('#strip button[data-k="unconf"] .n') + ' bulk open: ' + await n('#bulk.open'));
    // tag
    await p.click(CB + ' >> nth=1'); await p.click('#bulk [data-act="btag"]'); await p.fill('#t-tag', 'night'); await p.click('[data-act="taggo"]'); await p.waitForTimeout(100);
    log('tag toast: ' + await txt('#toast')); await p.click('[data-act="undo"]');
    // deactivate (confirm) + undo
    await p.click(CB + ' >> nth=0'); await p.click(CB + ' >> nth=4', { modifiers: ['Shift'] }); await p.click('#bulk [data-act="bdeact"]'); await p.waitForTimeout(150);
    await p.screenshot({ path: `shots/people-${tag}-confirm.png` });
    await p.click('[data-act="deactgo"]'); await p.waitForTimeout(100);
    log('deactivate toast: ' + await txt('#toast') + ' · inactive ' + await txt('#strip button[data-k="inactive"] .n'));
    await p.click('[data-act="undo"]'); await p.waitForTimeout(100); log('after undo inactive: ' + await txt('#strip button[data-k="inactive"] .n'));
    // row menu
    await p.click('#strip button[data-k="unconf"]'); await p.waitForTimeout(100);
    if (desk) await p.hover(R + ' >> nth=0');
    await p.click(R + ' >> nth=0 >> .dots'); await p.waitForTimeout(150);
    await p.screenshot({ path: `shots/people-${tag}-rowmenu.png` });
    log('row menu: ' + (await p.locator('#layerbody button, #layerbody a.item').allTextContents()).join(' | '));
    await p.click('[data-act="rresend"]'); await p.waitForTimeout(100); log('resend toast: ' + await txt('#toast')); await p.click('[data-act="undo"]');
    await p.click(R + ' >> nth=0', { position: { x: 120, y: 12 } }); await p.waitForTimeout(100); log('open toast: ' + await txt('#toast'));
    await p.click('#strip button[data-k="all"]');
    // page menu, log time, columns
    await p.click((desk ? '.lphead' : '.phonehead') + ' [data-act="pagemenu"]'); await p.waitForTimeout(200);
    await p.screenshot({ path: `shots/people-${tag}-pagemenu.png` });
    log('page menu: ' + (await p.locator('#layerbody button, #layerbody a.item').allTextContents()).join(' | '));
    await p.click('[data-act="rlog"]'); await p.waitForTimeout(150); await p.screenshot({ path: `shots/people-${tag}-logtime.png` });
    await p.click('[data-act="loggo"]'); await p.waitForTimeout(100); log('log time toast: ' + await txt('#toast')); await p.click('[data-act="undo"]');
    await p.click((desk ? '.lphead' : '.phonehead') + ' [data-act="pagemenu"]'); await p.click('[data-act="rexp"]'); await p.click('[data-act="rexpgo"]'); log('export toast: ' + await txt('#toast'));
    if (desk) {
      await p.click('.lphead [data-act="pagemenu"]'); await p.click('[data-act="colsmenu"]'); await p.click('[data-act="coltoggle"][data-c="email"]'); await p.waitForTimeout(100);
      log('headers with email: ' + (await p.locator('#tblwrap th').allTextContents()).join('|')); await p.screenshot({ path: `shots/people-${tag}-cols.png` });
      await p.click('.lphead [data-act="pagemenu"]'); await p.click('[data-act="colsmenu"]'); await p.click('[data-act="coltoggle"][data-c="email"]');
    }
    // views
    await p.click('[data-act="viewsmenu"]'); await p.click('[data-act="applyview"] >> nth=0'); await p.waitForTimeout(100);
    log('view: ' + await txt('#views .fw') + ' / ' + (await p.locator('#fwords .fw').allTextContents()).join(' | ') + ' rows ' + await n(R) + ' hash ' + await p.evaluate(() => location.hash));
    await p.click('[data-act="viewsmenu"]'); await p.click('[data-act="saveview"]'); await p.fill('#v-name', 'Mine'); await p.click('[data-act="saveviewgo"]'); log('saved view: ' + await txt('#toast'));
    await p.click('[data-act="clearf"]');
    await p.click('#strip button[data-k="all"]');
    // paging
    if (desk) { await p.click('[data-act="page"][data-d="1"]'); await p.waitForTimeout(100); log('page 2 rows: ' + await n(R) + ' foot: ' + await txt('#foot') + ' hash ' + await p.evaluate(() => location.hash)); await p.click('[data-act="page"][data-d="-1"]'); }
    else { await p.locator('[data-act="more"]').scrollIntoViewIfNeeded().catch(() => {}); if (await n('[data-act="more"]')) { await p.click('[data-act="more"]'); await p.waitForTimeout(100); } log('after more rows: ' + await n(R)); await p.evaluate(() => document.querySelector('.content').scrollTo(0, 0)); }
    // ---- SWITCH to CLIENTS
    if (desk) { await p.click('#sidenav a[data-k="clients"]'); } else { await p.click('[data-act="listsheet"]'); await p.waitForTimeout(200); await p.screenshot({ path: `shots/people-${tag}-listsheet.png` }); await p.click('#layerbody [data-act="nav"][data-k="clients"]'); }
    await p.waitForTimeout(150);
    log('clients: ' + await txt('#title') + ' · nav on: ' + (desk ? await txt('#sidenav a.on') : '-') + ' · hash ' + await p.evaluate(() => location.hash) + ' · strip: ' + (await p.locator('#strip button').allTextContents()).join(' | '));
    log('clients first row: ' + await txt(R));
    await p.screenshot({ path: `shots/people-${tag}-clients.png` });
    if (desk) log('headers: ' + (await p.locator('#tblwrap th').allTextContents()).join('|'));
    log('Hilton open-job link: ' + await p.locator(R + ' a.jl').first().getAttribute('href') .catch(() => 'none (phone cards)'));
    await p.click('#strip button[data-k="overdue"]'); await p.waitForTimeout(100);
    const od = await p.locator(R).allTextContents(); log('overdue rows: ' + od.length + ' · Ogilvy 18d: ' + od.some(t => t.includes('Ogilvy') && t.includes('18d overdue')));
    await p.screenshot({ path: `shots/people-${tag}-overdue.png` });
    await p.click('#strip button[data-k="all"]');
    await p.click(CB + ' >> nth=0'); await p.click(CB + ' >> nth=2', { modifiers: ['Shift'] }); await p.waitForTimeout(100);
    log('clients bulk: ' + await txt('#bulk'));
    await p.click('#bulk [data-act="bmerge"]'); await p.waitForTimeout(150); await p.screenshot({ path: `shots/people-${tag}-merge.png` });
    const before = await txt('#count'); await p.click('[data-act="mergego"]'); await p.waitForTimeout(100);
    log('merge toast: ' + await txt('#toast') + ' · count ' + before + ' -> ' + await txt('#count')); await p.click('[data-act="undo"]'); await p.waitForTimeout(100); log('after undo count: ' + await txt('#count'));
    await p.click(CB + ' >> nth=0'); await p.click(CB + ' >> nth=2', { modifiers: ['Shift'] }); await p.click('#bulk [data-act="barch"]'); await p.waitForTimeout(100); await p.click('[data-act="archgo"]'); await p.waitForTimeout(100);
    log('archive toast (all have open jobs, none archived):' + await txt('#toast'));
    await p.fill('#q', 'canva'); await p.waitForTimeout(100); await p.click(CB + ' >> nth=0'); await p.click('#bulk [data-act="barch"]'); await p.waitForTimeout(100); await p.click('[data-act="archgo"]'); await p.waitForTimeout(100); await p.fill('#q', '');
    log('archive toast: ' + await txt('#toast') + ' · archived seg ' + await txt('#strip button[data-k="archived"] .n')); await p.click('[data-act="undo"]'); await p.waitForTimeout(100);
    await p.click('#strip button[data-k="archived"]'); await p.waitForTimeout(100); log('archived rows: ' + await n(R));
    if (desk) { await p.hover(R + ' >> nth=0'); await p.click(R + ' >> nth=0 >> .dots'); log('archived row menu: ' + (await p.locator('#layerbody button, #layerbody a.item').allTextContents()).join(' | ')); await p.keyboard.press('Escape'); }
    await p.click('#strip button[data-k="all"]');
    if (desk) { await p.click('.lphead [data-act="pagemenu"]'); log('clients page menu: ' + (await p.locator('#layerbody button, #layerbody a.item').allTextContents()).join(' | ')); await p.keyboard.press('Escape'); await p.click('th button[data-k="out"]'); await p.waitForTimeout(100); log('sorted by outstanding asc first: ' + await txt(R)); }
    // ---- SUPPLIERS
    if (desk) await p.click('#sidenav a[data-k="suppliers"]'); else { await p.click('[data-act="listsheet"]'); await p.click('#layerbody [data-act="nav"][data-k="suppliers"]'); }
    await p.waitForTimeout(150);
    log('suppliers: ' + await txt('#title') + ' · strip: ' + (await p.locator('#strip button').allTextContents()).join(' | ') + ' · first: ' + (await txt(R)));
    await p.screenshot({ path: `shots/people-${tag}-suppliers.png` });
    await p.click('#strip button[data-k="overdue"]'); await p.waitForTimeout(100); const so = await p.locator(R).allTextContents(); log('overdue returns: ' + so.length + ' ' + (so[0] || '').slice(0, 70));
    await p.click('#strip button[data-k="all"]'); await p.fill('#q', 'tent'); await p.waitForTimeout(100); await p.click(CB + ' >> nth=0'); await p.click('#bulk [data-act="barch"]'); await p.click('[data-act="archgo"]'); await p.waitForTimeout(100); log('supplier archive toast: ' + await txt('#toast')); await p.click('[data-act="undo"]'); await p.fill('#q', '');
    await p.click('#strip button[data-k="orders"]');
    await p.click(CB + ' >> nth=0'); await p.click('#bulk [data-act="barch"]'); await p.click('[data-act="archgo"]'); await p.waitForTimeout(100); log('supplier archive toast (open orders stay): ' + await txt('#toast'));
    await p.click('#strip button[data-k="all"]');
    // back button
    await p.goBack().catch(() => {}); await p.waitForTimeout(200); log('after back: ' + await txt('#title'));
    // deep link
    await go('#/clients?seg=overdue&type=Company');
    log('deep link: ' + await txt('#title') + ' · on seg: ' + await txt('#strip button.on') + ' · fwords: ' + (await p.locator('#fwords .fw').allTextContents()).join(' | ') + ' rows ' + await n(R));
    if (!desk) { log('phoneact visible: ' + await p.locator('#phoneact').isVisible() + ' · label: ' + await txt('#phoneprimary')); await p.click('#phoneprimary'); log('new toast: ' + await txt('#toast')); await p.click(CB + ' >> nth=0'); log('phoneact after tick: ' + await p.locator('#phoneact').isVisible() + ' bulk: ' + await txt('#bulk')); await p.screenshot({ path: `shots/people-${tag}-phonesel.png` }); }
    await p.close();
  };
  await run(1440, 900, 'desk'); await run(390, 844, 'phone');
  console.log('errors:', errs);
  await b.close();
})();
