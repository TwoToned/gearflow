// Usage (from this directory): node homelive-check.cjs [file.html]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const errs = [];
  const run = async (w, h, tag) => {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    p.on('pageerror', e => errs.push(tag + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(tag + ' console: ' + m.text()); });
    await p.goto('file://' + process.cwd() + '/' + (process.argv[2] || 'homelive-prototype.html')); await p.waitForTimeout(500);
    await p.evaluate(() => { window.__nav = null; document.addEventListener('click', e => { const a = e.target.closest('a[href]'); if (a && !a.getAttribute('href').startsWith('#')) { window.__nav = a.getAttribute('href'); e.preventDefault(); } }, true); });
    const D = tag === 'desk', log = s => console.log(tag, s), T = async s => (await p.locator(s).allTextContents()).map(x => x.replace(/\s+/g, ' ').trim());
    const order = async () => p.locator('.w').evaluateAll(els => els.map(e => e.dataset.wid));
    const toastTxt = async () => (await p.locator('#toast').textContent()).replace(/\s+/g, ' ').trim().replace(/Undo.*$/, '').replace(/✕/g, '').trim();
    const nav = async () => { const n = await p.evaluate(() => window.__nav); await p.evaluate(() => { window.__nav = null; }); return n; };
    const short = u => u ? u.replace('https://claude.ai/artifact/', '').slice(0, 6) + '…' + (u.split('?')[1] ? '?' + u.split('?')[1] : u.includes('#/') ? '#/' + u.split('#/')[1] : '') : u;
    const pagemenu = async () => { await p.click((D ? '.lphead' : '.phonehead') + ' [data-act=pagemenu]'); await p.waitForTimeout(150); };
    const A = (c, msg) => { if (!c) errs.push(tag + ' ASSERT: ' + msg); };

    await log('h1: ' + (await T('#h1'))[0] + ' | sub: ' + (D ? (await T('#hsub'))[0] : (await T('#phonesub'))[0]) + ' | title: ' + await p.title());
    const ord0 = await order(); await log('default order: ' + ord0.join(' '));
    A(ord0.join() === 'setup,statActiveJobs,statOverdueReturns,statGearDeployed,statCrewBooked,myTasks,needsAttention,onTheFloorNow,upcomingProjects,recentActivity', 'default order is the live (y,x) order');
    await log('headings: ' + (await T('.w .wh')).join(' | '));
    const stats = await p.locator('.statlink').evaluateAll(els => els.map(e => e.querySelector('.n').textContent + ' ' + e.querySelector('.l').textContent + ' -> ' + e.getAttribute('href').replace('https://claude.ai/artifact/', '').slice(0, 6) + '…' + (e.getAttribute('href').split('?')[1] || e.getAttribute('href').split('#')[1]) + ' [' + e.dataset.tip + ']'));
    await log('stat tiles: ' + stats.join(' | '));
    A(stats.length === 4 && stats.every(s => !/\/projects$/.test(s)), 'four stats, none to bare list');
    const tiles = await p.locator('.w.stat').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; }));
    await log('stat tile positions (left,top): ' + JSON.stringify(tiles));
    if (!D) A(tiles[0][1] === tiles[1][1] && tiles[2][1] === tiles[3][1] && tiles[2][1] > tiles[0][1] && tiles[0][0] === tiles[2][0], 'phone stats are a 2x2 grid');
    else A(tiles.every(t => t[1] === tiles[0][1]), 'desktop stats share one row');
    await p.locator('.statlink >> nth=1').scrollIntoViewIfNeeded(); await p.click('.statlink >> nth=1'); await log('click Overdue returns -> ' + short(await nav()));
    await p.click('.statlink >> nth=0'); await log('click Active jobs -> ' + short(await nav()));
    await p.click('.statlink >> nth=2'); await log('click Gear deployed -> ' + short(await nav()));
    await p.click('.statlink >> nth=3'); await log('click Crew booked -> ' + short(await nav()));
    if (D) { await p.hover('.statlink >> nth=1'); await p.waitForTimeout(100); await log('tooltip: ' + await p.locator('.statlink >> nth=1').evaluate(e => getComputedStyle(e, '::after').content)); await p.mouse.move(5, 5); }
    // primary
    const prim = D ? '#primary' : '#phoneprimary';
    await log('primary: ' + (await T(prim))[0] + ' -> ' + short(await p.getAttribute(prim, 'href')) + ' · red primaries visible: ' + await p.locator('.btn-primary:visible').count());
    A(await p.locator('.btn-primary:visible').count() === 1, 'one primary');
    // needs attention
    await p.locator('.w[data-wid=needsAttention]').scrollIntoViewIfNeeded();
    const na = async () => (await T('.w[data-wid=needsAttention] .na a .nt'));
    const n0 = await na(); await log('needs attention (' + n0.length + '): ' + n0.join(' | '));
    A(!n0.some(x => /overdue returns/.test(x)), 'overdue-returns line suppressed while its tile is on');
    await p.click('.w[data-wid=needsAttention] .na a >> nth=0'); await log('click blocker -> ' + short(await nav()));
    await p.click('.w[data-wid=needsAttention] .na a >> nth=3'); await log('click 4th line -> ' + short(await nav()));
    // my tasks
    await p.locator('.w[data-wid=myTasks]').scrollIntoViewIfNeeded();
    await log('my tasks: count ' + (await T('.w[data-wid=myTasks] .wh .n'))[0] + ' rows ' + await p.locator('.w[data-wid=myTasks] .trow').count() + ' · first: ' + (await T('.w[data-wid=myTasks] .trow >> nth=0 >> .ttl'))[0]);
    await p.click('.w[data-wid=myTasks] .trow >> nth=0 >> .vc'); await p.waitForTimeout(100);
    await log('tick -> toast: ' + await toastTxt() + ' · count ' + (await T('.w[data-wid=myTasks] .wh .n'))[0] + ' · rows ' + await p.locator('.w[data-wid=myTasks] .trow').count() + ' · first now: ' + (await T('.w[data-wid=myTasks] .trow >> nth=0 >> .ttl'))[0]);
    A((await T('.w[data-wid=myTasks] .wh .n'))[0] === '7', 'tick completes (8 -> 7)');
    await p.click('[data-act=undo]'); await p.waitForTimeout(100); await log('undo -> count ' + (await T('.w[data-wid=myTasks] .wh .n'))[0]);
    A((await T('.w[data-wid=myTasks] .wh .n'))[0] === '8', 'undo restores');
    await p.click('.w[data-wid=myTasks] .trow >> nth=0 >> a.hmain'); await log('click task row -> ' + short(await nav()));
    if (D) await p.hover('.w[data-wid=myTasks] .trow >> nth=1');
    await p.click('.w[data-wid=myTasks] [data-act=rmenu] >> nth=1'); await p.waitForTimeout(120);
    await log('task row menu: ' + (await T('.menu button, .menu a, .sheetwrap button, .sheetwrap a')).join(' | ')); await p.keyboard.press('Escape');
    // floor, upcoming, activity
    await p.locator('.w[data-wid=onTheFloorNow]').scrollIntoViewIfNeeded();
    await log('floor: ' + (await T('.w[data-wid=onTheFloorNow] .wh'))[0] + ' | rows: ' + (await T('.w[data-wid=onTheFloorNow] .hrow .ttl')).join(' · ') + ' | words: ' + (await T('.w[data-wid=onTheFloorNow] .rtc')).join(' / '));
    await p.click('.w[data-wid=onTheFloorNow] .hrow >> nth=0 >> a.hmain'); await log('click floor row -> ' + short(await nav()));
    await p.locator('.w[data-wid=upcomingProjects]').scrollIntoViewIfNeeded();
    await log('upcoming: ' + (await T('.w[data-wid=upcomingProjects] .wh'))[0] + ' | ' + (await T('.w[data-wid=upcomingProjects] .hrow .ttl')).join(' · '));
    await p.click('.w[data-wid=upcomingProjects] .wh a'); await log('upcoming View all -> ' + short(await nav()));
    await p.locator('.w[data-wid=recentActivity]').scrollIntoViewIfNeeded();
    await log('activity rows: ' + await p.locator('.w[data-wid=recentActivity] .arow').count());
    await p.click('.w[data-wid=recentActivity] .arow >> nth=2'); await log('click activity -> ' + short(await nav()));
    // setup dismiss + undo
    await p.locator('.w[data-wid=setup]').scrollIntoViewIfNeeded();
    await log('setup panel: ' + (await T('.w[data-wid=setup] .wh'))[0] + ' · todo ' + await p.locator('.todo li').count());
    await p.click('[data-act=setupdismiss]'); await p.waitForTimeout(100); await log('dismiss -> panel ' + await p.locator('.w[data-wid=setup]').count() + ' · toast ' + await toastTxt() + ' · order ' + (await order())[0]);
    await p.click('[data-act=undo]'); await p.waitForTimeout(100); await log('undo -> panel ' + await p.locator('.w[data-wid=setup]').count());
    // page menu
    await pagemenu(); await log('page menu: ' + (await T('.menu button, .menu a, .menu .sh, .sheetwrap button, .sheetwrap a, .sheetwrap .sh')).join(' | '));
    await p.screenshot({ path: `shots/homelive-${tag}-pagemenu.png` });
    if (!D) { A(await p.locator('[data-act=customise]').count() === 0, 'no Customise on phone'); await p.keyboard.press('Escape'); }
    else await p.keyboard.press('Escape');
    // states
    await pagemenu(); await p.click('[data-act=demo][data-v=clear]'); await p.waitForTimeout(100);
    await log('all-clear day: ' + (await T('.calmmsg b')).join(' | ')); await p.screenshot({ path: `shots/homelive-${tag}-clear.png` });
    await pagemenu(); await p.click('[data-act=demo][data-v=""]'); await p.waitForTimeout(100); await log('back to busy: tasks ' + await p.locator('.trow').count());
    await pagemenu(); await p.click('[data-act=demo][data-v=loading]'); await p.waitForTimeout(100); await log('loading skeletons: ' + await p.locator('.sk').count()); await p.waitForTimeout(1900); await log('after loading: skeletons ' + await p.locator('.sk').count());

    if (D) {
      // ---------- CUSTOMISE
      await pagemenu(); await p.click('[data-act=customise]'); await p.waitForTimeout(200);
      await log('customise on: strip "' + (await T('#cust .t'))[0] + '" · words ' + (await T('#cust .fw')).join(' | ') + ' · primary ' + (await T('#primary'))[0] + ' · handles ' + await p.locator('.wh[data-wid]').count() + ' · resize handles ' + await p.locator('.rsz:visible').count());
      A(await p.locator('.btn-primary:visible').count() === 1, 'one primary in customise');
      await p.screenshot({ path: 'shots/homelive-desk-customise.png' });
      // drag: My tasks onto Upcoming
      await p.evaluate(() => document.querySelector('.content').scrollTo(0, 0));
      const o1 = await order(); await p.dragAndDrop('.w[data-wid=myTasks] .wh', '.w[data-wid=needsAttention] .wh'); await p.waitForTimeout(150);
      const o2 = await order(); await log('drag My tasks onto On the floor now: ' + o2.join(' ') + ' · toast: ' + await toastTxt());
      A(o2.join() !== o1.join(), 'drag moved My tasks');
      await p.click('[data-act=undo]'); await p.waitForTimeout(100); A((await order()).join() === o1.join(), 'undo of drag'); await log('undo drag -> restored: ' + ((await order()).join() === o1.join()));
      // keyboard
      await p.focus('.wh[data-wid=needsAttention]'); await p.keyboard.press('ArrowUp'); await p.waitForTimeout(100);
      const o3 = await order(); await log('keyboard ArrowUp on Needs attention: ' + o3.slice(0, 4).join(' ') + ' · toast ' + await toastTxt() + ' · focus kept on ' + await p.evaluate(() => document.activeElement.dataset.wid));
      A(o3.indexOf('needsAttention') === o1.indexOf('needsAttention') - 1, 'arrow key moves up');
      await p.keyboard.press('ArrowDown'); await p.waitForTimeout(100); A((await order()).join() === o1.join(), 'arrow down returns');
      // menu path
      await p.click('.w[data-wid=recentActivity] [data-act=wmenu]'); await p.waitForTimeout(100);
      await log('widget menu: ' + (await T('.menu button, .menu .sh')).join(' | '));
      await p.click('[data-act=wmove][data-d="-1"]'); await p.waitForTimeout(100); await log('menu Move up -> ' + (await order()).slice(-3).join(' ') + ' · toast ' + await toastTxt());
      await p.click('[data-act=undo]'); await p.waitForTimeout(100);
      // width via menu
      await p.click('.w[data-wid=myTasks] [data-act=wmenu]'); await p.click('[data-act=wwidth][data-v="12"]'); await p.waitForTimeout(100);
      const wd = await p.locator('.w[data-wid=myTasks]').evaluate(e => Math.round(e.getBoundingClientRect().width)); await log('My tasks width Full -> ' + wd + 'px · toast ' + await toastTxt()); A(wd > 1000, 'width Full applies');
      await p.click('[data-act=undo]'); await p.waitForTimeout(100);
      // stat width capped at max 4
      await p.click('.w[data-wid=statActiveJobs] [data-act=wmenu]'); await log('stat width options: ' + (await T('.menu button')).filter(x => /of 12/.test(x)).join(' | ')); await p.keyboard.press('Escape');
      // corner resize
      await p.locator('.w[data-wid=myTasks] .rsz').scrollIntoViewIfNeeded(); const box = await p.locator('.w[data-wid=myTasks] .rsz').boundingBox(); await p.mouse.move(box.x + 9, box.y + 9); await p.mouse.down(); await p.mouse.move(box.x + 9 + 240, box.y + 9, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(120);
      await log('corner resize My tasks: ' + (await T('.w[data-wid=myTasks] .wh .rt'))[0] + ' · toast ' + await toastTxt()); A((await T('.w[data-wid=myTasks] .wh .rt'))[0] === '8 / 12', 'corner drag +2 columns'); await p.click('[data-act=undo]');
      // hide + add + undo
      await p.click('.w[data-wid=statCrewBooked] [data-act=wmenu]'); await p.click('[data-act=whide]'); await p.waitForTimeout(100);
      await log('hide Crew booked -> stats ' + await p.locator('.w.stat').count() + ' · toast ' + await toastTxt());
      await p.click('[data-act=undo]'); await p.waitForTimeout(100); await log('undo hide -> stats ' + await p.locator('.w.stat').count());
      await p.click('.w[data-wid=statOverdueReturns] [data-act=wmenu]'); await p.click('[data-act=whide]'); await p.waitForTimeout(100);
      await log('hide Overdue tile -> needs lines ' + (await na()).length + ' · has overdue line: ' + (await na()).some(x => /overdue returns/.test(x)));
      A((await na()).some(x => /overdue returns/.test(x)), 'overdue line returns when its tile is hidden');
      await p.click('[data-act=addw]'); await log('Add widget menu: ' + (await T('.menu button, .menu .sh')).join(' | ')); await p.screenshot({ path: 'shots/homelive-desk-addmenu.png' });
      await p.click('[data-act=wadd]'); await p.waitForTimeout(100); await log('added back -> last: ' + (await order()).slice(-1)[0] + ' · toast ' + await toastTxt());
      await p.click('[data-act=undo]'); await p.waitForTimeout(100);
      await p.click('[data-act=undo]').catch(() => {});
      // reset
      await p.click('[data-act=wreset]'); await p.waitForTimeout(100); await log('Reset layout -> ' + (await order()).join(' ') + ' · toast ' + await toastTxt());
      A((await order()).join() === ord0.join(), 'reset returns to default');
      await p.click('[data-act=undo]'); await p.waitForTimeout(100);
      // done
      await p.click('#primary'); await p.waitForTimeout(150); await log('Done -> edit off: ' + (await p.locator('.hboard.edit').count() === 0) + ' · primary ' + (await T('#primary'))[0] + ' · toast ' + await toastTxt());
      A(await p.locator('.hboard.edit').count() === 0, 'Done leaves customise');
    } else {
      await pagemenu(); await log('phone page menu items: ' + (await T('.sheetwrap .item, .sheetwrap a, .sheetwrap .sh')).join(' | ')); await p.keyboard.press('Escape');
      await log('row ⋯ size: ' + await p.locator('.trow .dots >> nth=0').evaluate(e => { const r = e.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height) + ' opacity ' + getComputedStyle(e).opacity; }));
      await log('tick size: ' + await p.locator('.trow .vc >> nth=0').evaluate(e => e.getBoundingClientRect().width + 'px'));
      await log('horizontal overflow: ' + await p.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.querySelector('.content').scrollWidth > document.querySelector('.content').clientWidth));
      const pa = await p.locator('#phoneact').boundingBox(); await log('sticky primary box: ' + JSON.stringify(pa));
      await p.evaluate(() => document.querySelector('.content').scrollTo(0, 99999)); await p.waitForTimeout(100);
      const pa2 = await p.locator('#phoneact').boundingBox(); await log('after scrolling to the end the primary is still at y=' + Math.round(pa2.y));
      A(Math.abs(pa.y - pa2.y) < 2, 'primary sticks');
    }
    await p.close();
  };
  await run(1440, 900, 'desk'); await run(390, 844, 'phone');
  console.log('assert failures: ' + errs.filter(e => /ASSERT/.test(e)).length);
  console.log('errors: ' + JSON.stringify(errs)); await b.close();
})();
