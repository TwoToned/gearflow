// Usage (from the model dir): NODE_PATH=/opt/node-tools/node_modules node model-check.cjs [file.html]
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const errs = [], fails = [];
  const file = 'file://' + process.cwd() + '/' + (process.argv[2] || 'model-prototype.html');
  const run = async (w, h, tag) => {
    const ph = tag === 'phone';
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    p.on('pageerror', e => errs.push(tag + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(tag + ' console: ' + m.text()); });
    const ok = (c, m) => { if (!c) { fails.push(tag + ' FAIL ' + m); console.log(tag, 'FAIL', m); } else console.log(tag, 'ok  ', m); };
    const T = async s => ((await p.locator(s).first().textContent()) || '').replace(/\s+/g, ' ').trim();
    const W = ms => p.waitForTimeout(ms || 120);
    const shot = n => p.screenshot({ path: `shots/${tag}-${n}.png` });
    const toastText = async () => T('#toast');
    const undo = async () => { await p.click('#toast [data-act="undo"]'); await W(); };
    const tab = async k => { await p.click(`#tabs [data-k="${k}"]`); await W(); };
    const pageMenu = async () => { await p.click(ph ? '.phonehead [data-act=pagemenu]' : '.rhead [data-act=pagemenu]'); await W(150); };
    const primary = ph ? '#phoneprimary' : '#actions .btn-primary';
    const closeAll = async () => { await p.keyboard.press('Escape'); await W(80); };
    await p.goto(file); await W(500);
    // ---- overview
    ok((await T('#titlerow h1')) === 'Martin MAC Aura XB', 'title');
    ok((await T('#metarow')).includes('Lighting') && (await T('#metarow')).includes('$85/day') && (await T('#metarow')).includes('$340/wk') || ph, 'identity line has category + rates');
    ok((await T('#phonesub')) === 'Lighting · $85/day · $340/wk', 'phone sub line');
    ok((await T('#tabs')).replace(/\s/g, '') === 'OverviewAssets12Checks6Documents3Photos5ROI', 'tab strip: ' + (await T('#tabs')));
    ok((await T('#stock h2')) === '12 owned · 3 out · 1 in service', 'stock line: ' + (await T('#stock h2')));
    ok(await p.locator('#stock .todo li').count() === 3, 'three derived health rows');
    ok(await p.locator('.pill').count() === 0, 'no pills anywhere');
    ok(await p.locator('#pane-overview .photo').isVisible(), 'photo hero visible');
    ok(await p.locator(primary).isVisible() && (await T(primary)) === '+ New asset', 'primary visible: ' + (await T(primary)));
    ok(await p.locator('.btn-primary:visible').count() === 1, 'exactly one visible red primary on the page (' + await p.locator('.btn-primary:visible').count() + ')');
    ok(await p.locator('#rail').innerHTML() === '', 'no context rail on Overview');
    ok((await T('#booked')).includes('#2341') && (await p.locator('#booked a.rrow[href="https://claude.ai/artifact/RatKsWfTmDJLJHmn6mb7Zo"]').count()) === 4, 'booked rows link to the job');
    ok(await p.locator('#accs .rrow').count() === 4, 'accessory plan rows: 4');
    await shot('overview');
    // ---- tabs + url
    for (const k of ['assets', 'checks', 'documents', 'photos', 'roi']) {
      await tab(k); ok(await p.locator('#pane-' + k).isVisible(), 'tab ' + k + ' visible'); ok((await p.evaluate(() => location.search)) === '?tab=' + k, 'url state ?tab=' + k);
      ok(ph ? !(await p.locator('#rail').isVisible()) : (await p.locator('#rail').isVisible()), 'rail ' + (ph ? 'hidden on phone' : 'visible on ' + k));
    }
    await tab('overview'); ok(!(await p.evaluate(() => location.search)), 'overview clears ?tab');
    // ---- edit sheet: save, undo, validation, discard
    await p.click('#pane-overview [data-act=edit] >> nth=0'); await W(150);
    ok(await p.locator('.esheet').isVisible(), 'edit sheet opens (Edit pricing)');
    if (ph) ok((await p.locator('.esheet').boundingBox()).width >= 389, 'sheet is full width on phone');
    await shot('sheet');
    await p.fill('[data-f=daily]', '90'); await p.fill('[data-f=weekly]', '-5'); await p.click('.esft [data-act=editgo]'); await W();
    ok((await p.locator('.errm').count()) === 1, 'inline validation: negative weekly rate rejected');
    await p.fill('[data-f=weekly]', '360'); await p.fill('[data-f=name]', ''); await p.click('.esft [data-act=editgo]'); await W();
    ok((await T('.errm')).includes('Name is required'), 'inline validation: name required');
    await p.fill('[data-f=name]', 'Martin MAC Aura XB'); await p.fill('[data-f=salePrice]', ''); await p.click('.esft [data-act=editgo]'); await W();
    ok((await T('#metarow')).includes('$90/day') || (await T('#phonesub')).includes('$90/day'), 'saved: rate shows on the identity line');
    ok((await toastText()).includes('saved'), 'toast: ' + await toastText());
    await undo(); ok((await T('#phonesub')).includes('$85/day'), 'Undo restores the rate');
    await p.click('#pane-overview [data-act=edit] >> nth=0'); await W(); await p.fill('[data-f=sku]', 'X'); await p.click('.esft [data-act=close]'); await W();
    ok(await p.locator('.dlg').isVisible() && (await T('.dlg h2')).includes('Discard'), 'dirty cancel asks to discard');
    await p.click('.dlg [data-act=reopen]'); await W(); ok(await p.locator('.esheet').isVisible() && (await p.inputValue('[data-f=sku]')) === 'X', 'keep editing restores the draft');
    // specs editor inside the sheet
    await p.fill('#sp-k', 'Colour temp'); await p.fill('#sp-v', '2700 – 8000 K'); await p.press('#sp-v', 'Enter'); await W();
    ok(await p.locator('.sprow:not(.add)').count() === 5, 'specification added with Enter');
    await p.click('[data-act=specdel] >> nth=0'); await W(); ok(await p.locator('.sprow:not(.add)').count() === 4, 'specification removed');
    await p.click('[data-act=dsw][data-f=tt]'); await W(); ok(await p.locator('[data-f=ttProfile]').count() === 0, 'T&T off hides the profile fields');
    await p.click('.esft [data-act=close]'); await W(); await p.click('.dlg [data-act=discard]'); await W();
    ok(!(await p.locator('.esheet').count()) && !(await p.locator('.dlg').count()), 'discard closes everything');
    // ---- page menu
    await pageMenu(); await shot('pagemenu');
    const items = (await p.locator(ph ? '.sheetwrap .item' : '.menu button').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim());
    ok(items[0].startsWith('Edit') && items.some(i => i.startsWith('Duplicate')) && items.some(i => i.startsWith('Print labels for all 12')) && items[items.length - 1].startsWith('Archive'), 'page ⋯: ' + items.join(' | '));
    ok(await p.locator(ph ? '.sheetwrap .item.danger' : '.menu button.danger').count() === 1, 'one danger item, last');
    await p.click('[data-act=labelsall]'); await W(); ok((await toastText()).includes('12 assets'), 'print labels for all: ' + await toastText());
    await pageMenu(); await p.click('[data-act=dupopen]'); await W(); ok((await T('.esheet h2')) === 'Duplicate model' && (await p.inputValue('[data-f=name]')).endsWith('(copy)'), 'duplicate opens the sheet in create mode');
    await p.click('.esft [data-act=dupgo]'); await W(); ok((await toastText()).includes('created'), 'duplicate toast: ' + await toastText()); await undo();
    // archive
    await pageMenu(); await p.click('[data-act=archive]'); await W(); ok((await T('.dlg')).includes('12 assets stay') && (await T('.dlg')).includes('#2341'), 'archive confirm names downstream effects'); await shot('archive');
    await p.click('[data-act=archivego]'); await W();
    ok((await T('#phoneprimary')) === 'Restore model' && (await T('#banner')).includes('Archived'), 'archived: primary becomes Restore, banner shown');
    if (!ph) ok((await T('#titlerow')).includes('Archived'), 'archived dot-word');
    await undo(); ok((await T(primary)) === '+ New asset', 'Undo un-archives');
    // ---- new asset sheet
    await p.click(primary); await W(150); ok((await T('.esheet h2')) === 'Martin MAC Aura XB' && (await p.inputValue('[data-f=tag]')) === 'AURA-14', 'new asset: model preselected, tag suggested');
    await p.fill('[data-f=tag]', 'AURA-05'); await p.click('.esft [data-act=newgo] >> nth=1'); await W(); ok((await T('.errm')).includes('already exists'), 'duplicate tag rejected');
    await p.fill('[data-f=tag]', 'AURA-14'); await p.fill('[data-f=serial]', 'AU4824000'); await p.click('.esft .btn-primary'); await W();
    ok((await toastText()).includes('AURA-14 created'), 'asset created: ' + await toastText()); ok((await T('#tabs')).includes('Assets 13'), 'assets count 13');
    await undo(); ok((await T('#tabs')).includes('Assets 12'), 'Undo removes it');
    await p.keyboard.press('n'); await W(); ok(await p.locator('.esheet').isVisible(), 'n shortcut opens the sheet'); await closeAll();
    // ---- accessories
    await p.click('#accs [data-act=accadd]'); await W(); await p.fill('#acc-q', 'soca'); await W(); ok(await p.locator('#acc-res .res2').count() === 2, 'accessory search: stock hit + custom row'); await p.press('#acc-q', 'Enter'); await W();
    ok(await p.locator('#accs .rrow').count() === 5 && (await toastText()).includes('Socapex'), 'Enter adds the first result: ' + await toastText()); await undo(); ok(await p.locator('#accs .rrow').count() === 4, 'Undo removes it');
    await p.click('#accs [data-act=accadd]'); await W(); await p.fill('#acc-q', 'rain hood'); await W(); await p.click('#acc-res [data-custom="1"]'); await W(); ok((await toastText()).includes('custom accessory'), 'custom accessory added'); await undo();
    await p.click('#accs [data-act=accmenu] >> nth=0'); await W(); await p.click('[data-act=accedit]'); await W(); await p.click('[data-act=qty][data-d="1"]'); await p.selectOption('#acc-incl', 'OPTIONAL'); await p.click('[data-act=acceditgo]'); await W();
    ok((await T('#accs .rrow')).includes('2×') && (await T('#accs .rrow')).includes('optional'), 'accessory edited: ' + await T('#accs .rrow')); await undo();
    await p.click('#accs [data-act=accmenu] >> nth=1'); await W(); await p.click('[data-act=accremove]'); await W(); ok(await p.locator('#accs .rrow').count() === 3, 'accessory removed'); await undo(); ok(await p.locator('#accs .rrow').count() === 4, 'Undo restores');
    await p.click('#accs [data-act=accmenu] >> nth=3'); await W(); await p.click('[data-act=accincl]'); await W(); ok((await T('#accs .rrow >> nth=3')).includes('default'), 'optional → default toggle'); await undo();
    // ---- overview links
    await p.click('#stock .todo button[data-k="due"]'); await W(); ok((await T('#tabs .on')).startsWith('Assets') && (await T('#strip .on')).startsWith('Due for T&T'), 'todo row jumps to Assets › Due for T&T');
    await tab('overview'); await p.click('#pane-overview .facts3 [data-act=tab][data-k=roi]'); await W(); ok(await p.locator('#pane-roi').isVisible(), 'Earning › ROI');
    await tab('overview'); await p.click('#booked [data-act=sched]'); await W(); ok((await toastText()).includes('Schedule'), 'Schedule › toast');
    // ---- assets tab
    await tab('assets'); await p.click('#strip [data-k=all]'); await W();
    ok((await T('#strip')).replace(/\s/g, '') === 'All12Available4Onjobs7Inservice1DueforT&T4Needsattention3Retired1', 'strip counts: ' + await T('#strip'));
    const rowSel = ph ? '#list .lrow[data-act=open]' : '#tblwrap tr.row';
    ok(await p.locator(rowSel).count() === 10, 'first page 10 rows'); ok((await T('#foot')).includes('12 assets'), 'footer: ' + await T('#foot'));
    ok(!(await p.locator('#tblwrap th:has-text("Model")').count()) || ph, 'no Model column (it is this model)');
    await p.click('#strip [data-k=attention]'); await W(); ok(await p.locator(rowSel).count() === 3, 'needs attention: 3'); await shot('assets-attention');
    await p.click('#strip [data-k=retired]'); await W(); ok(await p.locator(rowSel).count() === 1, 'retired: 1');
    await p.click('#strip [data-k=all]'); await W();
    await p.click('[data-act=fmenu][data-k=location]'); await W(150); await p.click('[data-act=ftoggle][data-v="Warehouse B"]'); await W(); await closeAll();
    ok((await T('#fwords')).includes('Location: Warehouse B') && await p.locator(rowSel).count() === 3, 'location filter reads its value: ' + await T('#fwords') + ' → ' + await p.locator(rowSel).count());
    await p.click('[data-act=clearf]'); await W();
    await p.fill('#q', 'aura-1'); await W(); ok(await p.locator(rowSel).count() === 3, 'search "aura-1": 3'); await p.fill('#q', 'zzzz'); await W(); ok((await T('#pane-assets .empty')).includes('No assets match'), 'empty (nothing matches) state'); await shot('assets-empty'); await p.click('[data-act=clearf]'); await W();
    if (!ph) { await p.click('th button[data-k=due]'); await W(); ok((await T('#tblwrap tr.row')).includes('AURA-02'), 'sort by next due: ' + (await T('#tblwrap tr.row')).slice(0, 40)); await p.click('th button[data-k=tag]'); await W();
      await p.click('[data-act=page][data-d="1"]'); await W(); ok(await p.locator(rowSel).count() === 2 && (await T('#foot')).includes('11–12') || (await T('#foot')).includes('12 assets'), 'page 2: ' + await T('#foot')); await p.click('[data-act=page][data-d="-1"]'); await W(); }
    else { await p.locator('[data-act=more]').scrollIntoViewIfNeeded(); await p.click('[data-act=more]'); await W(); ok(await p.locator(rowSel).count() === 12, 'Show more → 12 rows'); await p.evaluate(() => document.querySelector('.content').scrollTop = 0); }
    // selection
    await p.click(rowSel + ' .cb >> nth=0'); await p.click(rowSel + ' .cb >> nth=2', { modifiers: ['Shift'] }); await W();
    const bulk = await T('#bulk'); ok(bulk.includes('3 selected') && bulk.includes('Move 3…') && bulk.includes('Retire 3') && (ph || bulk.includes('Print labels 3')), 'bulk bar: ' + bulk);
    ok(bulk.includes('Force return 3'), 'Force return counts only deployed (3)');
    ok(bulk.indexOf('Retire 3') > bulk.indexOf('Schedule service 3'), 'destructive last');
    if (ph) ok(!(await p.locator('#phoneact').isVisible()), 'bulk bar replaces the sticky primary on phone');
    await shot('assets-sel');
    await p.click('[data-act=bulkmove]'); await W(150); await p.click('[data-act=bulkmovego][data-v="Warehouse B"]'); await W();
    ok((await toastText()).includes('0 assets moved') || (await toastText()).includes('3 out on a job stay put'), 'bulk move skips out-on-job: ' + await toastText()); await undo();
    await p.click(rowSel + ' .cb >> nth=3'); await W(); await p.click('[data-act=bulkretire]'); await W(); ok((await T('.dlg h2')).startsWith('Retire'), 'retire confirm dialog'); await p.click('[data-act=bulkretirego]'); await W();
    ok((await toastText()).includes('retired') || (await toastText()).includes('Retire'), 'retire toast: ' + await toastText()); await undo(); ok((await T('#strip')).includes('All 12'), 'retire Undo');
    await p.click(rowSel + ' .cb >> nth=0'); await W(); await p.click('#bulk [data-act=clearsel]'); await W(); ok(!(await p.locator('#bulk.open').count()), '✕ clears the selection');
    await p.click(rowSel + ' .cb >> nth=3'); await W(); await p.click('[data-act=bulkmaint]'); await W(); ok((await toastText()).includes('Service scheduled'), 'schedule service: ' + await toastText()); await undo();
    await p.click(rowSel + ' .cb >> nth=4'); await W(); await p.click('[data-act=bulkedit]'); await W(); await p.selectOption('#b-cond', 'Fair'); await p.click('[data-act=bulkeditgo]'); await W(); ok((await toastText()).includes('updated'), 'edit together: ' + await toastText()); await undo();
    // row menu + force return
    await p.hover(rowSel + ' >> nth=0'); await p.click(rowSel + ' >> nth=0 >> .dots'); await W(150); await shot('rowmenu');
    const rm = (await p.locator(ph ? '.sheetwrap .item, .sheetwrap a.item' : '.menu button, .menu a.item').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim());
    ok(rm.some(x => x.startsWith('Force return')) && rm[rm.length - 1].startsWith('Retire'), 'row ⋯ (deployed): ' + rm.join(' | '));
    await p.click('[data-act=returnone]'); await W(); ok((await toastText()).includes('returned to Warehouse A'), 'force return: ' + await toastText()); await undo();
    await p.click(rowSel + ' >> nth=8 >> .dots'); await W(150); await p.click('[data-act=movemenu]'); await W(150); await p.click('[data-act=moveone][data-v="Van 2"]'); await W(); ok((await toastText()).includes('moved to Van 2'), 'move one: ' + await toastText()); await undo();
    // open row → asset
    const p2 = await b.newPage({ viewport: { width: w, height: h } }); const reqs = []; p2.on('requestfailed', r => reqs.push(r.url())); p2.on('request', r => reqs.push(r.url())); await p2.goto(file + '?tab=assets'); await p2.waitForTimeout(400);
    
    await p2.locator(ph ? '#list .lrow[data-act=open] >> nth=0 >> .grow' : '#tblwrap tr.row >> nth=0 >> td >> nth=2').click(); await p2.waitForTimeout(800); ok(reqs.some(u => u.includes('Rr5rwirCUMRy8gf5G6Vz7s')), 'row click navigates to Rr5rwirCUMRy8gf5G6Vz7s'); await p2.close();
    // ---- checks
    await tab('checks');
    ok(await p.locator('#pane-checks .rrow:not(.flat)').count() === 6, '6 checks'); ok((await T('#pane-checks')).includes('Gobo wheel spin') && (await T('#pane-checks')).includes('28%') && (await T('#pane-checks')).includes('high'), 'failure rates with a high flag');
    await shot('checks');
    await p.click('[data-act=addcheck] >> nth=0'); await W(); await p.click('[data-act=checkaddgo] >> nth=0'); await W(); ok(await p.locator('[data-act=checkaddgo]').count() === 5, 'picker stays open, item leaves the list'); await closeAll(); ok(await p.locator('#pane-checks .rrow:not(.flat)').count() === 7, 'check added'); await undo();
    await p.click('#pane-checks [data-act=checkmenu] >> nth=0'); await W(); await p.click('[data-act=checkmove][data-d="1"]'); await W(); ok((await T('#pane-checks .rrow >> nth=0')).includes('Gobo wheel spin'), 'move down'); await undo();
    await p.click('#pane-checks [data-act=checkmenu] >> nth=5'); await W(); await p.click('[data-act=checkremove]'); await W(); ok((await T('.dlg h2')).includes('Remove “Condition notes”'), 'remove confirm names the check'); await p.click('[data-act=checkremovego]'); await W(); ok(await p.locator('#pane-checks .rrow:not(.flat)').count() === 5, 'check removed'); await undo();
    await p.click('#pane-checks .rrow .cb >> nth=0'); await p.click('#pane-checks .rrow .cb >> nth=2', { modifiers: ['Shift'] }); await W(); ok((await T('#bulk')).includes('Remove 3'), 'bulk: Remove 3');
    await p.click('[data-act=bulkdel]'); await W(); await p.click('[data-act=bulkdelgo]'); await W(); ok(await p.locator('#pane-checks .rrow:not(.flat)').count() === 3, 'bulk removed 3'); await undo();
    await p.click('#pane-checks [data-act=selall]'); await W(); await p.click('[data-act=bulkdel]'); await W(); await p.click('[data-act=bulkdelgo]'); await W(); ok((await T('#pane-checks')).includes('No checks assigned') && (await T('#pane-checks')).includes('No check data yet'), 'empty states (checks + failure rates)'); await shot('checks-empty'); await undo();
    // ---- documents
    await tab('documents'); ok(await p.locator('#pane-documents .rrow').count() === 3, '3 documents');
    await p.click('#pane-documents [data-act=upload] >> nth=0'); await W(); await p.click('[data-act=uploadgo] >> nth=0'); await W(); ok(await p.locator('#pane-documents .rrow').count() === 4 && (await T('#tabs')).includes('Documents 4'), 'upload adds a row + count'); await undo();
    await p.click('#pane-documents [data-act=docmenu] >> nth=1'); await W(); await p.click('[data-act=docremove]'); await W(); await p.click('[data-act=bulkdelgo]'); await W(); ok(await p.locator('#pane-documents .rrow').count() === 2, 'document removed'); await undo();
    await p.click('#pane-documents .rrow .cb >> nth=0'); await p.click('#pane-documents .rrow .cb >> nth=1', { modifiers: ['Shift'] }); await W(); ok((await T('#bulk')).includes('Remove 2'), 'documents bulk: Remove 2'); await shot('documents-sel'); await p.click('#bulk [data-act=clearsel]');
    await p.click('#pane-documents [data-act=selall]'); await p.click('[data-act=bulkdel]'); await W(); await p.click('[data-act=bulkdelgo]'); await W(); ok((await T('#pane-documents')).includes('No documents yet'), 'documents empty state'); await undo();
    // ---- photos
    await tab('photos'); ok(await p.locator('#pane-photos .pt').count() === 5, '5 photos');
    await p.click('#pane-photos [data-act=photomenu] >> nth=2'); await W(); await p.click('[data-act=setprimary]'); await W(); ok((await T('#pane-photos .pt >> nth=2')).includes('Primary'), 'set primary');
    await tab('overview'); ok((await T('#pane-overview .photo')).includes('aura-beam-wash.jpg'), 'Overview hero follows the primary photo'); await tab('photos');
    await p.click('#pane-photos [data-act=photomenu] >> nth=0'); await W(); await p.click('[data-act=photomove][data-d="1"]'); await W(); ok((await T('#pane-photos .pt >> nth=1')).includes('aura-front.jpg'), 'move later');
    await p.click('#pane-photos [data-act=photoup] >> nth=0'); await W(); await p.click('[data-act=photoupgo] >> nth=0'); await W(); ok(await p.locator('#pane-photos .pt').count() === 6, 'photo uploaded');
    await p.click('#pane-photos .pt .cb >> nth=0'); await p.click('#pane-photos .pt .cb >> nth=2', { modifiers: ['Shift'] }); await W(); ok((await T('#bulk')).includes('Remove 3'), 'photos bulk: Remove 3'); await shot('photos-sel');
    await p.click('[data-act=bulkdel]'); await W(); await p.click('[data-act=bulkdelgo]'); await W(); ok(await p.locator('#pane-photos .pt').count() === 3, 'removed 3 photos'); await undo();
    // ---- ROI
    await tab('roi'); ok(await p.locator('#pane-roi .fig').count() === 2 && (await T('#pane-roi')).includes('$41,260') && !(await T('#pane-roi')).includes('Fleet cost'), 'ROI defaults to revenue only; cost hidden');
    ok(await p.locator('#pane-roi a.rrow').count() === 8, 'first 8 projects'); await p.click('[data-act=roimore]'); await W(); ok(await p.locator('#pane-roi a.rrow').count() === 17, 'Show more → 17');
    await p.click('[data-act=roicost]'); await W(); ok((await T('#pane-roi')).includes('Fleet cost') && (await T('#pane-roi')).includes('$34,200') && (await T('#pane-roi')).includes('1.2×') && (await T('#pane-roi')).includes('Fully recovered'), 'cost & payback opt-in: ' + (await T('#pane-roi')).slice(60, 260)); await shot('roi-cost');
    await p.click('[data-act=roiscope][data-k=booked]'); await W(); ok((await T('#pane-roi')).includes('$49,060'), 'including booked work: $49,060');
    await p.click('[data-act=roiwin][data-k=all]'); await W(); ok((await T('#pane-roi')).includes('$126,740') && (await T('#pane-roi .quiet')).includes('scan limit'), 'all time + booked: $126,740 and the partial-picture note');
    await p.click('[data-act=roiscope][data-k=earned]'); await p.click('[data-act=roiwin][data-k="12m"]'); await p.click('[data-act=roicost]'); await W();
    if (ph) await p.click('.tipb'); else await p.hover('.tipb'); await W(150); ok(await p.locator('#roitip').isVisible(), 'tooltip explains attribution'); await shot('roi-tip'); await p.mouse.move(5, 5);
    // ---- URL deep links
    await p.goto(file + '?tab=roi'); await W(300); ok(await p.locator('#pane-roi').isVisible(), '?tab=roi deep link');
    await p.goto(file + '?tab=details'); await W(300); ok(await p.locator('.esheet').isVisible(), '?tab=details opens the edit sheet (route redirect)');
    // phone / desktop specifics
    if (ph) { await p.goto(file); await W(300); await pageMenu(); ok(await p.locator('.sheetwrap').isVisible(), 'phone ⋯ is a bottom sheet'); ok((await p.locator('.sheetwrap .item').first().boundingBox()).height >= 47, '48 px sheet items'); await closeAll();
      ok(await p.evaluate(() => document.documentElement.scrollWidth <= 391), 'no horizontal page scroll'); }
    else { ok(await p.evaluate(() => document.documentElement.scrollWidth <= 1441), 'no horizontal page scroll'); }
    await p.close();
  };
  await run(1440, 900, 'desk'); await run(390, 844, 'phone');
  if (fails.length) console.log('FAILURES:\n' + fails.join('\n'));
  console.log('errors:', errs);
  await b.close();
})();
