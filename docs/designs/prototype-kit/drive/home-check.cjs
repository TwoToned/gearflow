// Usage (from this directory): node home-check.cjs [file.html]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const errs = [];
  const run = async (w, h, tag) => {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    p.on('pageerror', e => errs.push(tag + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(tag + ' console: ' + m.text()); });
    await p.goto('file://' + process.cwd() + '/' + (process.argv[2] || 'home-prototype.html')); await p.waitForTimeout(500);
    await p.evaluate(() => { window.__nav = null; document.addEventListener('click', e => { const a = e.target.closest('a[href]'); if (a && !a.getAttribute('href').startsWith('#')) { window.__nav = a.getAttribute('href'); e.preventDefault(); } }, true); });
    const D = tag === 'desk', log = s => console.log(tag, s), T = async s => (await p.locator(s).allTextContents()).map(x => x.replace(/\s+/g, ' ').trim());
    const view = async v => { await p.click((D ? '#viewsw' : '#phonetabs') + ` [data-v=${v}]`); await p.waitForTimeout(120); };
    const pagemenu = async () => { await p.click((D ? '.lphead' : '.phonehead') + ' [data-act=pagemenu]'); await p.waitForTimeout(150); };
    const toastTxt = async () => (await p.locator('#toast').textContent()).replace(/\s+/g, ' ').trim().replace(/Undo.*$/, '').replace(/✕/g, '').trim();
    const nav = async () => { const n = await p.evaluate(() => window.__nav); await p.evaluate(() => { window.__nav = null; }); return n; };
    const dialogOpen = async () => p.locator('.dlg').count();

    // ---------- HOME
    await log('h1: ' + (await T('#h1'))[0] + ' | view words: ' + (await T(D ? '#viewsw .fw' : '#phonetabs .chip')).join(' | '));
    await log('setup panel: ' + await p.locator('.setup').count() + ' · ' + (await T('.setup .shd'))[0] + ' · todo rows: ' + await p.locator('.setup .todo li').count());
    const stats = await p.locator('.stat').evaluateAll(els => els.map(e => e.querySelector('.n').textContent + ' ' + e.querySelector('.l').textContent + ' -> ' + e.getAttribute('href').replace('https://claude.ai/artifact/', '').slice(0, 4) + '…' + e.getAttribute('href').split('?')[1]));
    await log('stat words: ' + stats.join(' | '));
    if (D) { await p.hover('.stat >> nth=1'); await p.waitForTimeout(100); await log('tooltip: ' + await p.locator('.stat >> nth=1').evaluate(e => getComputedStyle(e, '::after').content)); await p.mouse.move(5, 5); }
    else { await log('stat grid columns: ' + await p.locator('.stats').evaluate(e => getComputedStyle(e).gridTemplateColumns.split(' ').length)); }
    await log('needs me rows: ' + await p.locator('.col >> nth=0 >> .hrow').count() + ' · heading: ' + (await T('.col >> nth=0 >> .shd'))[0]);
    await p.click('[data-act=needsall]'); await p.waitForTimeout(100); await log('needs me all rows: ' + await p.locator('.col >> nth=0 >> .hrow').count());
    await p.click('[data-act=needsall]');
    await log('on now groups: ' + (await T('.col >> nth=1 >> .gl')).join(' | '));
    const hrefs = await p.locator('.col >> nth=0 >> .hrow a.hmain').evaluateAll(a => a.map(x => x.getAttribute('href').replace('https://claude.ai/artifact/', '').slice(0, 9)));
    await log('needs-me hrefs: ' + hrefs.join(' '));
    await p.click('.col >> nth=0 >> .hrow >> nth=0 >> a.hmain'); await log('click needs row nav: ' + await nav());
    await p.click('.stat >> nth=1'); await log('click stat nav: ' + (await nav()));
    // row menu
    if (D) await p.hover('.col >> nth=0 >> .hrow >> nth=1');
    await p.click('[data-act=rmenu][data-g=need] >> nth=1'); await p.waitForTimeout(150);
    await log('row menu: ' + (await T('.menu .item, .menu a, .menu button, .sheetwrap .item, .sheetwrap a')).join(' | '));
    await p.screenshot({ path: `shots/home-${tag}-rowmenu.png` }); await p.keyboard.press('Escape');
    await p.click('[data-act=rmenu][data-g=now2] >> nth=0'); await p.waitForTimeout(120); await log('now row menu has list link: ' + (await T('.menu, .sheetwrap')).join('').includes('Floor')); await p.keyboard.press('Escape');
    await p.click('[data-act=needsall]'); await p.click('[data-act=needsall]');
    // setup dismiss + undo
    await p.click('[data-act=setupdismiss]'); await p.waitForTimeout(100);
    await log('after dismiss panel: ' + await p.locator('.setup').count() + ' toast: ' + await toastTxt());
    await p.screenshot({ path: `shots/home-${tag}-clean.png` });
    await p.click('[data-act=undo]'); await p.waitForTimeout(100); await log('after undo panel: ' + await p.locator('.setup').count());
    // page menu: setup toggle
    await pagemenu(); await log('page menu (home): ' + (await T('.menu button, .menu a, .sheetwrap button, .sheetwrap a')).join(' | '));
    await p.screenshot({ path: `shots/home-${tag}-pagemenu.png` });
    await p.click('[data-act=setuptoggle]'); await p.waitForTimeout(100); await log('setup toggle off: ' + await p.locator('.setup').count() + ' · toast ' + await toastTxt());
    await pagemenu(); await p.click('[data-act=setuptoggle]'); await p.waitForTimeout(100); await log('setup toggle on: ' + await p.locator('.setup').count());
    // customise
    await pagemenu(); await p.click('[data-act=customise]'); await p.waitForTimeout(150);
    await log('customise dialog: ' + await dialogOpen() + ' toggles: ' + await p.locator('.dlg .sw').count());
    await p.screenshot({ path: `shots/home-${tag}-customise.png` });
    await p.click('.dlg [data-k=statCrewBooked]'); await p.click('.dlg [data-k=recentActivity]'); await p.click('.dlg [data-k=upcomingProjects]'); await p.waitForTimeout(100);
    await log('after toggling 3 off: stats ' + await p.locator('.stat').count() + ' · recent activity sections ' + (await T('#v-home .shd')).filter(x => /Recent/.test(x)).length + ' · cols ' + await p.locator('.cols').count());
    await p.click('.dlg [data-act=wreset]'); await p.waitForTimeout(100);
    await log('reset: stats ' + await p.locator('.stat').count() + ' toast: ' + await toastTxt() + ' dialog: ' + await dialogOpen());
    await p.click('[data-act=undo]'); await p.waitForTimeout(100);
    await log('undo reset: stats ' + await p.locator('.stat').count());
    await pagemenu(); await p.click('[data-act=customise]'); await p.waitForTimeout(100);
    for (const k of ['finishSetupChecklist','needsAttention','onTheFloorNow','myTasks','upcomingProjects','recentActivity','statActiveJobs','statOverdueReturns','statGearDeployed','statCrewBooked']) { if ((await p.locator(`.dlg [data-k=${k}]`).getAttribute('aria-checked')) === 'true') await p.click(`.dlg [data-k=${k}]`); }
    await p.waitForTimeout(100); await log('all off: ' + (await T('#v-home .empty'))[0]);
    await p.click('.dlg [data-act=wreset]'); await p.waitForTimeout(100); await p.click('[data-act=toastclose]');
    await log('home my tasks heading: ' + (await T('#v-home .col >> nth=-2 >> .shd'))[0]);
    await log('home recent activity rows: ' + await p.locator('#v-home section .arow').count());
    // home task tick + undo
    await p.click('#v-home .trow >> nth=0 >> .vc'); await p.waitForTimeout(100); await log('home tick toast: ' + await toastTxt() + ' · open tasks now ' + (await T('#viewsw .fw, #phonetabs .chip')).join(',').match(/My tasks \d+/)[0]);
    await p.click('[data-act=undo]'); await p.waitForTimeout(100);
    await p.click('#v-home [data-act=view][data-v=tasks]'); await p.waitForTimeout(120); await log('"All ›" opens: ' + (await T('#h1'))[0]);
    await view('home'); await p.click('#v-home [data-act=view][data-v=activity]'); await p.waitForTimeout(120); await log('"All activity ›" opens: ' + (await T('#h1'))[0]);
    await view('home');
    if (!D) { await p.evaluate(() => document.querySelector('.content').scrollTo(0, 99999)); await p.waitForTimeout(100); await log('phone sticky primary visible: ' + await p.locator('#phoneprimary').isVisible() + ' text ' + (await T('#phoneprimary'))[0]); await p.screenshot({ path: `shots/home-${tag}-bottom.png` }); await p.evaluate(() => document.querySelector('.content').scrollTo(0, 0)); await p.click('#phoneprimary'); await log('phone primary (home) -> ' + await nav() + ' toast ' + await toastTxt()); }
    else { await p.click('#primary'); await log('primary (home) -> ' + await nav() + ' toast ' + await toastTxt()); }
    await log('home url hash: ' + await p.evaluate(() => location.hash));

    // ---------- MY TASKS
    await view('tasks'); await log('tasks: groups ' + (await T('#v-tasks .gl')).join(' | ') + ' · rows ' + await p.locator('#v-tasks .trow').count() + ' · hash ' + await p.evaluate(() => location.hash));
    await p.click('#v-tasks .trow >> nth=2 >> .vc'); await p.waitForTimeout(100);
    await log('tick: ' + await toastTxt() + ' · open ' + (await T('#strip button'))[0]);
    await p.click('[data-act=undo]'); await p.waitForTimeout(100); await log('undo tick: ' + (await T('#strip button'))[0]);
    if (D) await p.hover('#v-tasks .trow >> nth=0'); await p.click('#v-tasks [data-act=trowmenu] >> nth=0'); await p.waitForTimeout(120); await log('task menu: ' + (await T('.menu button, .menu a, .sheetwrap button, .sheetwrap a')).join(' | '));
    await p.click('[data-act=tduemenu]'); await p.waitForTimeout(120); await p.click('[data-act=tsetdue] >> nth=1'); await p.waitForTimeout(100); await log('set due: ' + await toastTxt()); await p.click('[data-act=undo]');
    await pagemenu(); await p.click('[data-act=tselmode]'); await p.waitForTimeout(100);
    await log('select mode: checkboxes ' + await p.locator('#v-tasks .trow .cb').count());
    await p.click('#v-tasks .trow .cb >> nth=0'); await p.click('#v-tasks .trow .cb >> nth=3', { modifiers: ['Shift'] }); await p.waitForTimeout(100);
    await log('bulk: ' + (await T('#bulk'))[0] + ' · phoneact hidden ' + !(await p.locator('#phoneact').isVisible()));
    await p.screenshot({ path: `shots/home-${tag}-tasks-sel.png` });
    await p.click('[data-act=tbulkdue]'); await p.waitForTimeout(100); await p.click('[data-act=tbulkduego] >> nth=1'); await p.waitForTimeout(100); await log('bulk due: ' + await toastTxt()); await p.click('[data-act=undo]'); await p.waitForTimeout(100);
    await p.click('#v-tasks .trow .cb >> nth=0'); await p.click('#v-tasks .trow .cb >> nth=3', { modifiers: ['Shift'] });
    await p.click('[data-act=tbulkdone]'); await p.waitForTimeout(100); await log('bulk done: ' + await toastTxt() + ' · ' + (await T('#strip button')).join(' / '));
    await p.click('[data-act=undo]'); await p.waitForTimeout(100); await log('bulk undo: ' + (await T('#strip button')).join(' / ') + ' bulk open ' + await p.locator('#bulk.open').count());
    await pagemenu(); await p.click('[data-act=tselmode]');
    await p.click('#strip [data-k=done]'); await p.waitForTimeout(100); await log('done tab rows: ' + await p.locator('#v-tasks .trow').count() + ' closed ' + await p.locator('#v-tasks .trow.closed').count());
    await p.click('#v-tasks .trow >> nth=0 >> .vc'); await log('reopen: ' + await toastTxt()); await p.click('[data-act=undo]');
    await p.click('#strip [data-k=open]');
    await p.click(D ? '#primary' : '#phoneprimary'); await p.waitForTimeout(150); await log('new task dialog: ' + await dialogOpen());
    await p.click('[data-act=tnewgo]'); await log('empty title keeps dialog: ' + await dialogOpen());
    await p.fill('#nt-title', 'Call Priya about the dock'); await p.click('[data-act=tnewgo]'); await p.waitForTimeout(100); await log('new task: ' + await toastTxt() + ' · rows ' + await p.locator('#v-tasks .trow').count()); await p.click('[data-act=undo]');
    // empty state: complete all
    await p.evaluate(() => { state.tasks.forEach(t => t.done = TODAY); render(); }); await log('tasks empty: ' + (await T('#v-tasks .empty'))[0]); await p.screenshot({ path: `shots/home-${tag}-tasks-empty.png` });
    await p.evaluate(() => { state.tasks = TASKS.map(t => ({ ...t })); render(); });

    // ---------- NOTIFICATIONS
    await view('notes'); await log('notes: groups ' + (await T('#v-notes .gl')).join(' | ') + ' · strip ' + (await T('#strip button')).join(' / '));
    await p.click('#strip [data-k=all]'); await p.waitForTimeout(100); await log('all rows: ' + await p.locator('#v-notes .nrow').count() + ' read ' + await p.locator('#v-notes .nrow.read').count()); await p.click('#strip [data-k=unread]');
    if (D) await p.hover('#v-notes .nrow >> nth=0'); await p.click('#v-notes [data-act=nrowmenu] >> nth=0'); await p.waitForTimeout(120); await log('note menu: ' + (await T('.menu button, .menu a, .sheetwrap button, .sheetwrap a')).join(' | '));
    await p.click('[data-act=nmark]'); await p.waitForTimeout(100); await log('mark read: ' + await toastTxt() + ' · unread ' + (await T('#strip button'))[0]); await p.click('[data-act=undo]'); await p.waitForTimeout(100); await log('undo: ' + (await T('#strip button'))[0]);
    await p.click('#v-notes .nrow .cb >> nth=0'); await p.click('#v-notes .nrow .cb >> nth=3', { modifiers: ['Shift'] }); await p.waitForTimeout(100);
    await log('bulk: ' + (await T('#bulk'))[0] + ' · selected rows ' + await p.locator('#v-notes .nrow.sel').count());
    await p.screenshot({ path: `shots/home-${tag}-notes-sel.png` });
    await p.click('[data-act=nbulkread]'); await p.waitForTimeout(100); await log('bulk read: ' + await toastTxt() + ' · ' + (await T('#strip button')).join(' / ')); await p.click('[data-act=undo]'); await p.waitForTimeout(100); await log('bulk undo: ' + (await T('#strip button')).join(' / '));
    await p.click(D ? '#primary' : '#phoneprimary'); await p.waitForTimeout(100); await log('mark all read: ' + await toastTxt() + ' · empty: ' + (await T('#v-notes .empty'))[0] + ' · primary visible ' + await p.locator(D ? '#primary' : '#phoneprimary').isVisible());
    await p.screenshot({ path: `shots/home-${tag}-notes-empty.png` });
    await p.click('[data-act=undo]'); await p.waitForTimeout(100); await log('undo all: ' + (await T('#strip button'))[0]);
    await p.click('#v-notes .nrow >> nth=0 >> a.hmain'); await p.waitForTimeout(100); await log('open marks read: ' + (await T('#strip button'))[0] + ' nav ' + await nav());
    await p.evaluate(() => { state.notes = NOTES.map(n => ({ ...n })); render(); });
    await pagemenu(); await log('notes page menu: ' + (await T('.menu button, .menu a, .sheetwrap button, .sheetwrap a')).join(' | ')); await p.keyboard.press('Escape');

    // ---------- ACTIVITY
    await view('activity'); await log('activity: strip ' + (await T('#strip button')).join(' / ') + ' · hash ' + await p.evaluate(() => location.hash) + ' · fwords ' + (await T('#fwords .fw')).join(' | '));
    const arows = () => p.locator('#v-activity .arow').count();
    await log('all rows on page: ' + await arows() + ' · foot: ' + (await T('#foot'))[0]);
    await p.click('#strip [data-k=mine]'); await p.waitForTimeout(100); await log('mine rows: ' + await arows() + ' hash ' + await p.evaluate(() => location.hash));
    await p.click('#strip [data-k=today]'); await p.waitForTimeout(100); await log('today rows: ' + await arows() + ' groups ' + (await T('#v-activity .gl')).join(' | '));
    await p.click('#strip [data-k=all]'); await p.waitForTimeout(100);
    await p.click('[data-act=afmenu][data-k=actor]'); await p.waitForTimeout(120); await p.click('[data-act=aftoggle][data-v=Agent]'); await p.waitForTimeout(100); await p.keyboard.press('Escape');
    await log('actor: agent -> rows ' + await arows() + ' · fwords ' + (await T('#fwords .fw')).join(' | ')); await p.screenshot({ path: `shots/home-${tag}-activity-filter.png` });
    await p.click('[data-act=aclear]'); await p.waitForTimeout(100);
    await p.click('[data-act=afmenu][data-k=entity]'); await p.waitForTimeout(120); await p.click('[data-act=aftoggle][data-v=Invoice]'); await p.click('[data-act=aftoggle][data-v=Quote]'); await p.keyboard.press('Escape');
    await log('entity: 2 chosen -> rows ' + await arows() + ' · ' + (await T('#fwords .fw'))[2]);
    await p.click('[data-act=afmenu][data-k=action]'); await p.waitForTimeout(120); await log('action menu items: ' + await p.locator('.menu button, .sheetwrap .item').count()); await p.click('[data-act=afclear]'); await p.waitForTimeout(100); await p.keyboard.press('Escape');
    await p.click('[data-act=aclear]'); await p.waitForTimeout(100);
    await p.fill('#q', 'qantas'); await p.waitForTimeout(100); await log('search qantas rows: ' + await arows()); await p.fill('#q', 'zzzz'); await p.waitForTimeout(100); await log('empty: ' + (await T('#v-activity .empty'))[0]); await p.screenshot({ path: `shots/home-${tag}-activity-empty.png` });
    await p.click('[data-act=aclear]'); await p.waitForTimeout(100);
    await p.click('[data-act=aviews]'); await p.waitForTimeout(120); await p.click('[data-act=aapplyview] >> nth=1'); await p.waitForTimeout(100); await log('view: ' + (await T('#views .fw'))[0] + ' / ' + (await T('#fwords .fw')).join(' | ') + ' rows ' + await arows()); await p.click('[data-act=aclear]'); await p.waitForTimeout(100);
    if (D) await p.hover('#v-activity .arow >> nth=0'); await p.click('#v-activity [data-act=amenu] >> nth=0'); await p.waitForTimeout(120); await log('activity row menu: ' + (await T('.menu button, .menu a, .sheetwrap button, .sheetwrap a')).join(' | '));
    await p.click('[data-act=ascope]'); await p.waitForTimeout(100); await log('scope: ' + (await T('#fwords .fw')).join(' | ') + ' rows ' + await arows()); await p.screenshot({ path: `shots/home-${tag}-activity-scope.png` }); await p.click('[data-act=ascopeclear]'); await p.waitForTimeout(100);
    await pagemenu(); await p.click('[data-act=aexport]'); await p.waitForTimeout(100); await log('export: ' + await toastTxt());
    if (D) { await p.click('[data-act=page][data-d="1"]'); await p.waitForTimeout(100); await log('page 2 rows: ' + await arows() + ' foot ' + (await T('#foot'))[0]); await p.click('[data-act=page][data-d="-1"]'); }
    else { await p.locator('[data-act=more]').scrollIntoViewIfNeeded(); await p.click('[data-act=more]'); await p.waitForTimeout(100); await log('after more rows: ' + await arows()); await p.evaluate(() => document.querySelector('.content').scrollTo(0, 0)); await log('activity phoneact hidden: ' + !(await p.locator('#phoneact').isVisible())); }
    // back
    if (!D) { await p.click('#phoneback'); await p.waitForTimeout(100); await log('phone back -> ' + (await T('#h1'))[0]); } else { await p.click('.crumb a'); await p.waitForTimeout(100); await log('crumb back -> ' + (await T('#h1'))[0]); }
    // keyboard shortcuts must not throw
    await p.keyboard.press('/'); await p.keyboard.press('Escape'); await p.keyboard.press('n'); await p.waitForTimeout(100);
    await p.close();
  };
  await run(1440, 900, 'desk'); await run(390, 844, 'phone');
  console.log('errors:', errs);
  await b.close();
})();
