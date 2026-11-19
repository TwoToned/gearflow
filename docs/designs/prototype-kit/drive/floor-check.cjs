// Drive: from the floor/ directory:  NODE_PATH=$(npm root -g) node floor-check.cjs
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const errs = [];
  const url = 'file://' + process.cwd() + '/floor-prototype.html';
  const run = async (w, h, tag) => {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    p.on('pageerror', e => errs.push(tag + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(tag + ' console: ' + m.text()); });
    await p.goto(url); await p.waitForTimeout(500);
    const log = s => console.log(tag, s);
    const desk = tag === 'desk';
    const cards = () => p.locator(desk ? '.fcard' : '#list .lrow[data-act="open"]').count();
    const shot = n => p.screenshot({ path: `shots/${tag}-${n}.png` });
    const toastTxt = async () => (await p.locator('#toast').textContent()).replace(/Undo|✕/g, '').trim();
    const dock = async (t) => { await p.fill('#q', t); await p.press('#q', 'Enter'); await p.waitForTimeout(150); };
    const resultTxt = async () => ((await p.locator('#result .result').first().textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    const menu = async (sel, nth = 0) => { await p.locator(sel).nth(nth).click({ force: true }); await p.waitForTimeout(150); };
    const itemTxt = async () => (await p.locator('#layerbody button, #layerbody a.item').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim());

    // ---- board
    log('strip: ' + (await p.locator('#strip button').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim()).join(' | '));
    log('cards (This week): ' + await cards());
    if (desk) log('columns: ' + (await p.locator('.fcol .bhead').allTextContents()).join(' | '));
    await shot('1-board');
    const scopeSel = k => desk ? `#strip button[data-act="scope"][data-k="${k}"]` : `#fwords button[data-act="scope"][data-k="${k}"]`;
    for (const k of ['today', 'mine', 'all', 'week']) { await p.click(scopeSel(k)); await p.waitForTimeout(80); log(`scope ${k}: cards ${await cards()}`); }
    if (!desk) { await p.click('#strip button[data-k="topick"]'); log('stage To pick (phone): ' + await cards()); await shot('2-stage'); await p.click('#strip button[data-k="all"]'); }
    // filters
    await p.click('[data-act="fmenu"][data-k="packer"]'); await p.waitForTimeout(150); await shot('3-packermenu');
    await p.click('[data-act="ftoggle"][data-v="Sam Okafor"]'); await p.keyboard.press('Escape');
    log('fwords: ' + (await p.locator('#fwords .fw').allTextContents()).join(' | ') + ' · cards ' + await cards());
    await p.click('[data-act="clearf"]');
    await p.click('[data-act="fmenu"][data-k="flags"]'); await p.waitForTimeout(100); await p.click('[data-act="ftoggle"][data-v="overdue"]'); await p.keyboard.press('Escape');
    log('flags Overdue → cards ' + await cards() + ' (all-time scope this week)');
    await p.click('[data-act="clearf"]');
    // dock as search
    await p.fill('#q', 'hilton'); await p.waitForTimeout(100); log('dock search "hilton": cards ' + await cards());
    await p.fill('#q', 'zzzz'); await p.waitForTimeout(100); log('dock search zzzz empty state: ' + (await p.locator(desk ? '#board .empty' : '#list .empty').count())); await shot('4-empty');
    await p.fill('#q', ''); await p.waitForTimeout(80);
    // scans in board mode
    await dock('2341'); log('scan 2341 → ' + await resultTxt()); log('hit card: ' + await p.locator(desk ? '.fcard.hit' : '.lrow.hit').count());
    await dock('SK-0012'); log('scan SK-0012 → ' + await resultTxt());
    await dock('A-0192'); log('scan kit member → ' + await resultTxt());
    await dock('AURA-90'); log('scan shelf → ' + await resultTxt());
    await dock('ZX-9931'); log('scan unknown → ' + await resultTxt());
    const outTag = await p.evaluate(() => state.jobs.find(j => j.num === '2333').lines.find(l => l.name.includes('Y8')).units[0].tag);
    await dock(outTag); log(`scan out tag ${outTag} → ` + await resultTxt()); await shot('5-scan-out');
    await p.click('#result [data-act="receiveunit"]'); await p.waitForTimeout(150);
    log('Receive → toast: ' + await toastTxt() + ' · strip: ' + await resultTxt());
    await p.click('#toast [data-act="undo"]'); await p.waitForTimeout(100);
    log('undo → unit st ' + await p.evaluate(t => { for (const j of state.jobs) for (const l of j.lines) for (const u of l.units) if (u.tag === t) return u.st; }, outTag));
    await p.click('#result [data-act="recent"]'); await p.waitForTimeout(80); log('recent rows: ' + await p.locator('#result .recent .rr').count());
    await p.click('#result [data-act="stripclose"]');
    // selection + bulk
    const cb = desk ? '.fcard .cb' : '#list .lrow .cb';
    await p.click(cb + ' >> nth=0'); await p.click(cb + ' >> nth=3', { modifiers: ['Shift'] }); await p.waitForTimeout(100);
    log('bulk: ' + (await p.locator('#bulk').textContent()).replace(/\s+/g, ' ').trim()); await shot('6-sel');
    await p.click('#bulk [data-act="bulkpacker"]'); await p.waitForTimeout(120);
    await p.click('[data-act="packergo"][data-p="Mia Rossi"]'); await p.waitForTimeout(120);
    log('assign packer toast: ' + await toastTxt());
    await p.click('#toast [data-act="undo"]'); await p.waitForTimeout(100); log('bulk after undo: ' + await p.locator('#bulk.open').count());
    await p.click(cb + ' >> nth=0'); await p.click(cb + ' >> nth=1'); await p.waitForTimeout(80);
    await p.click('#bulk [data-act="bulkpull"]'); await p.waitForTimeout(200);
    log('pull sheets open: ' + await p.locator('.paper').count() + ' · title: ' + (await p.locator('.dlg h2').textContent())); await shot('7-pullsheet');
    await p.click('[data-act="printgo"]'); log('print toast: ' + await toastTxt()); await p.click('#bulk [data-act="clearsel"]');
    // close out (returning column)
    await p.click(scopeSel('all')); await p.waitForTimeout(80);
    const retNums = await p.evaluate(() => state.jobs.filter(j => stageOf(j) === 'returning' && closeable(j)).map(j => j.id));
    for (const id of retNums) await p.click(`${cb}[data-id="${id}"]`);
    log('bulk (returning, closeable): ' + (await p.locator('#bulk').textContent()).replace(/\s+/g, ' ').trim());
    await p.click('#bulk [data-act="bulkclose"]'); await p.waitForTimeout(150);
    log('close out toast: ' + await toastTxt() + ' · cards ' + await cards());
    await p.click('#toast [data-act="undo"]'); await p.waitForTimeout(100); log('after undo cards ' + await cards());
    // card / group menus
    const dotsSel = desk ? `.fcard[data-id="j2341"] .dots` : `#list .lrow[data-id="j2341"] .dots`;
    await p.hover(desk ? '.fcard[data-id="j2341"]' : '#list .lrow[data-id="j2341"]'); await p.click(dotsSel); await p.waitForTimeout(150);
    log('card ⋯ (#2341): ' + (await itemTxt()).join(' | ')); await shot('8-cardmenu');
    await p.click('[data-act="pull"]'); await p.waitForTimeout(150); log('pull via card ⋯: ' + await p.locator('.paper').count()); await p.keyboard.press('Escape');
    await p.click(dotsSel); await p.click('[data-act="markdlg"][data-m="deployed"]'); await p.waitForTimeout(150);
    log('mark deployed dialog: ' + (await p.locator('.dlg .bd').textContent()).replace(/\s+/g, ' ').trim().slice(0, 120));
    await p.click('[data-act="markgo"]'); await p.waitForTimeout(150); log('mark toast: ' + await toastTxt() + ' · stage now ' + await p.evaluate(() => stageOf(job('2341'))));
    await p.click('#toast [data-act="undo"]'); await p.waitForTimeout(100); log('undo → stage ' + await p.evaluate(() => stageOf(job('2341'))));
    // page menu
    await menu(desk ? '.lphead [data-act=pagemenu]' : '.phonehead [data-act=pagemenu]'); log('page ⋯: ' + (await itemTxt()).join(' | ')); await shot('9-pagemenu');
    await p.click('[data-act="needsme"]'); log('only what needs me → cards ' + await cards() + ' · fwords ' + (await p.locator('#fwords .fw').allTextContents()).join(' | '));
    await p.click('[data-act="clearf"]');
    await menu(desk ? '.lphead [data-act=pagemenu]' : '.phonehead [data-act=pagemenu]'); await p.click('[data-act="offline"]'); await p.waitForTimeout(100);
    await dock('SK-0013'); log('offline scan: ' + await resultTxt() + ' · dock: ' + await p.locator('#dockoff').textContent());
    await menu(desk ? '.lphead [data-act=pagemenu]' : '.phonehead [data-act=pagemenu]'); await p.click('[data-act="offline"]'); await p.waitForTimeout(150); log('online again → ' + await resultTxt());
    // camera
    await p.click('#camBtn'); await p.waitForTimeout(150); await p.click('.dlg [data-act="scan"][data-tag="2341"]'); await p.waitForTimeout(120);
    log('camera tap 2341 → ' + (await p.locator('#camres').textContent()).replace(/\s+/g, ' ').trim()); await shot('10-camera'); await p.keyboard.press('Escape');
    if (desk) { await p.click('.lphead [data-act="scanfocus"]'); log('Scan primary focuses dock: ' + await p.evaluate(() => document.activeElement.id)); }
    else { await p.click('.bottomnav a[data-act="camera"]'); await p.waitForTimeout(120); log('Scan nav opens camera: ' + await p.locator('.vf').count()); await p.keyboard.press('Escape'); log('bottom nav warehouse on: ' + await p.locator('.bottomnav a.on').textContent()); }
    // dock mode chip
    await p.click('#dockchip'); await p.waitForTimeout(120); log('mode chip menu: ' + (await itemTxt()).join(' | ')); await p.click('[data-act="setmode"][data-m="returning"]'); await p.waitForTimeout(150);
    log('mode now: ' + await p.evaluate(() => state.mode)); await p.click('#strip .back'); await p.waitForTimeout(80);

    // ---- returning mode
    if (desk) await p.click('#strip .go'); else { await menu('.phonehead [data-act=pagemenu]'); await p.click('#layerbody [data-act="togglemode"]'); }
    await p.waitForTimeout(150);
    log('returning strip: ' + (await p.locator('#strip button').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim()).join(' | '));
    const rows = () => p.locator(desk ? '#tblwrap tr.item' : '#list .lrow[data-act="expand"]').count();
    log('rows (out): ' + await rows()); await shot('11-returning');
    for (const k of ['returned', 'damaged', 'missing', 'late', 'out']) { await p.click(`#strip [data-k="${k}"]`); log(`  ${k}: rows ${await rows()}`); }
    // scans in returning mode
    const outTag2 = await p.evaluate(() => state.jobs.find(j => j.num === '2329').lines.find(l => l.units.every(u => u.tag && u.st === 'out')).units[0].tag);
    await dock(outTag2); log('returning scan out tag → ' + await resultTxt()); await shot('12-returned-strip');
    await p.click('#result [data-act="outcomemenu"]'); await p.waitForTimeout(100); log('outcome menu: ' + (await itemTxt()).join(' | '));
    await p.click('[data-act="setunit"][data-st="dmg"]'); await p.waitForTimeout(120); log('→ damaged: ' + await resultTxt() + ' · toast: ' + await toastTxt());
    await p.click('#toast [data-act="undo"]'); await p.waitForTimeout(100);
    log('undo → ' + await p.evaluate(t => { for (const j of state.jobs) for (const l of j.lines) for (const u of l.units) if (u.tag === t) return u.st; }, outTag2));
    await dock(outTag2); await dock(outTag2); log('already back → ' + await resultTxt());
    await dock('SK-0012'); log('not out → ' + await resultTxt());
    await dock('B-SB900'); await p.waitForTimeout(150); log('bulk bin → dialog rows: ' + await p.locator('.dlg .gate').count()); await shot('13-bulk-dialog');
    await p.fill('.dlg .gate input >> nth=0', '3'); await p.click('.dlg [data-act="bulkret"] >> nth=0'); await p.waitForTimeout(150); log('bulk return → ' + await toastTxt());
    await p.click('#toast [data-act="undo"]'); await p.waitForTimeout(100);
    await dock('2331'); log('job number → ' + await resultTxt() + ' · fwords ' + (await p.locator('#fwords .fw').allTextContents()).join(' | ')); await shot('14-job-filter');
    await p.click('[data-act="clearf"]'); await p.waitForTimeout(80);
    // expand + unit chips + menus
    await p.click((desk ? '#tblwrap tr.item' : '#list .lrow[data-act="expand"]') + ' >> nth=0'); await p.waitForTimeout(100); log('chips: ' + await p.locator('.uchip').count());
    await p.click((desk ? '#tblwrap' : '#list') + ' .uchip >> nth=0'); await p.waitForTimeout(100); log('chip menu: ' + (await itemTxt()).join(' | ')); await p.keyboard.press('Escape');
    // row menu + selection bulk
    await p.click((desk ? '#tblwrap tr.item' : '#list .lrow[data-act="expand"]') + ' >> nth=1 >> .dots'); await p.waitForTimeout(100); log('row ⋯: ' + (await itemTxt()).join(' | ')); await p.keyboard.press('Escape');
    const rcb = desk ? '#tblwrap tr.item .cb' : '#list .lrow .cb';
    await p.click(rcb + ' >> nth=0'); await p.click(rcb + ' >> nth=4', { modifiers: ['Shift'] }); await p.waitForTimeout(100);
    log('returning bulk: ' + (await p.locator('#bulk').textContent()).replace(/\s+/g, ' ').trim()); await shot('15-returning-sel');
    const before = await p.evaluate(() => rcounts().out);
    await p.click('#bulk [data-act="bulkret2"]'); await p.waitForTimeout(150); log('bulk return toast: ' + await toastTxt() + ' · out ' + before + ' → ' + await p.evaluate(() => rcounts().out));
    await p.click('#toast [data-act="undo"]'); await p.waitForTimeout(100); log('undo → out ' + await p.evaluate(() => rcounts().out));
    await p.click(rcb + ' >> nth=1'); await p.click('#bulk [data-act="bulkmiss"]'); await p.waitForTimeout(100); log('mark missing toast: ' + await toastTxt()); await p.click('#toast [data-act="undo"]');
    // group menu, return job
    await p.click((desk ? '#tblwrap tr.grp' : '#list .lhead') + ' >> nth=0 >> .dots'); await p.waitForTimeout(100); log('group ⋯: ' + (await itemTxt()).join(' | ')); await p.keyboard.press('Escape');
    // paging
    if (desk) { await p.click('[data-act="page"][data-d="1"]'); await p.waitForTimeout(80); log('page 2 rows: ' + await rows() + ' · foot ' + (await p.locator('#foot').textContent()).replace(/\s+/g, ' ').trim()); await p.click('[data-act="page"][data-d="-1"]'); }
    else { await p.locator('[data-act="more"]').scrollIntoViewIfNeeded(); await p.click('[data-act="more"]'); log('after more rows: ' + await rows()); await p.evaluate(() => document.querySelector('.content').scrollTo(0, 0)); }
    // empty state
    await p.click('#strip [data-k="missing"]'); await p.click('[data-act="fmenu"][data-k="job"]'); await p.waitForTimeout(100); await p.click('[data-act="ftoggle"][data-v="j2325"]'); await p.keyboard.press('Escape'); await p.waitForTimeout(80);
    log('empty (missing on #2325): ' + (await p.locator('.empty').count())); await shot('16-returning-empty');
    await p.click('[data-act="clearf"]'); await p.click('#strip .back'); await p.waitForTimeout(100); log('back to the floor: ' + await p.evaluate(() => state.mode));
    // phone sheets
    if (!desk) { await menu('.phonehead [data-act=pagemenu]'); await shot('17-pagesheet'); await p.keyboard.press('Escape'); }
    await p.close();
  };
  await run(1440, 900, 'desk'); await run(390, 844, 'phone');
  // card click links to the warehouse job artifact
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); const reqs = [];
  await p.route('https://claude.ai/**', r => { reqs.push(r.request().url()); r.abort(); });
  await p.goto(url); await p.waitForTimeout(300);
  await p.click('.fcard[data-id="j2341"] .ttl'); await p.waitForTimeout(300);
  console.log('card click →', reqs.filter(u => u.includes('Mt8p55xkPkkexVWPC5eaGU')).length ? 'warehouse job artifact' : reqs);
  await b.close();
  console.log('errors:', errs);
})();
