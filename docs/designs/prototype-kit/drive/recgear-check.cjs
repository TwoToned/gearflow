// Usage (from the recgear dir): NODE_PATH=/opt/node-tools/node_modules node recgear-check.cjs [file.html]
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const errs = [], fails = [];
  const file = 'file://' + process.cwd() + '/' + (process.argv[2] || 'recgear-prototype.html');
  const run = async (w, h, tag) => {
    const d = tag === 'desk', p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 }); p.setDefaultTimeout(3000);
    p.on('pageerror', e => errs.push(tag + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(tag + ' console: ' + m.text()); });
    const log = s => console.log(tag, s), W = ms => p.waitForTimeout(ms || 120);
    const toast = async () => (await p.locator('#toast').textContent()).trim();
    const text = async sel => (await p.locator(sel).first().textContent().catch(() => '')).replace(/\s+/g, ' ').trim();
    const cnt = sel => p.locator(sel).count();
    const must = (cond, msg) => { if (!cond) { fails.push(tag + ': ' + msg); log('FAIL ' + msg); } };
    const step = async (name, fn) => { try { await fn(); } catch (e) { const m = e.message.split('\n').slice(0, 3).join(' | ').slice(0, 260); fails.push(tag + ': ' + name + ' → ' + m); log('FAIL ' + name + ' → ' + m); try { await p.keyboard.press('Escape'); } catch (x) { /* */ } } };
    const open = h => p.goto(file + '#' + h).then(() => p.reload()).then(() => W(350));
    const menuBtn = d ? '.rhead [data-act=pagemenu]' : '.phonehead [data-act=pagemenu]';
    const pm = async () => { await p.click(menuBtn); await W(150); };
    const items = async () => (await p.locator(d ? '.menu button, .menu a' : '.sheetwrap .item, .sheetwrap a').evaluateAll(els => els.map(e => e.textContent.trim().replace(/\s+/g, ' ') + (e.disabled ? '(off)' : '')))).join(' | ');
    const tab = async t => { await p.click(`#tabs [data-t=${t}]`); await W(); };
    const tick = async (i, mod) => p.click(`#view .rrow:has(.dots) .cb >> nth=${i}`, mod ? { modifiers: [mod] } : {});
    const clickMenu = async act => { await p.click(`#layerbody [data-act=${act}]`); await W(150); };
    const phoneMenuFix = async () => { /* phone sheets use .item buttons with the same data-act */ };

    // ================= LOCATION
    await step('loc overview', async () => {
      await open('loc/wa');
      log('loc tabs: ' + (await p.locator('#tabs button').allTextContents()).join(' | '));
      log('loc head: ' + await text('#ready h2') + ' · ' + await text('#ready .lead'));
      log('loc checks: ' + (await p.locator('.todo li').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim()).join(' || '));
      must(await cnt('.rail2') === 0, 'overview has no rail');
      must((await text('.todo')).includes('3 assets with no bin'), 'no-bin check');
      for (const t of ['contents', 'bins', 'jobs', 'history', 'files']) { await tab(t); must(await cnt('.rail2') === 1, `${t} rail present`); }
      log('loc hash: ' + await p.evaluate(() => location.hash));
    });
    await step('loc contents', async () => {
      await tab('contents');
      log('contents header: ' + (await p.locator('#view .words .wd').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim()).join(' | '));
      await p.click('[data-act=lf][data-v=nobin]'); await W(); const nb = await cnt('#view .rrow:has(.dots)'); log('no bin rows: ' + nb); must(nb === 3, 'no-bin filter = 3');
      await p.click('[data-act=lf][data-v=all]'); await W();
      await p.fill('#q', 'LX-02'); await W(); log('search LX-02 rows: ' + await cnt('#view .rrow:has(.dots)')); await p.fill('#q', ''); await W();
      log('rows shown (page 1): ' + await cnt('#view .rrow:has(.dots)')); await p.click('[data-act=more]'); await W(); log('after show more: ' + await cnt('#view .rrow:has(.dots)') + ' · ' + await text('.more') );
      await p.click('[data-act=binf]'); await W(150); await p.screenshot({ path: `shots/${tag}-binfilter.png` }); await clickMenu('binfset'); // first = any bin
      await p.click('[data-act=binf]'); await W(150); await p.click('#layerbody [data-act=binfset][data-v=B2]'); await W(); log('bin B2 chip: ' + await text('#view .fw') + ' rows ' + await cnt('#view .rrow:has(.dots)'));
      await tick(0); await tick(2, 'Shift'); await W(); log('bulk: ' + (await text('#bulk'))); await p.screenshot({ path: `shots/${tag}-contents-sel.png` });
      await p.click('[data-act=bulk][data-v=move]'); await W(); await p.screenshot({ path: `shots/${tag}-move.png` }); await p.selectOption('#bk-arg', 'C2'); await p.click('[data-act=bulkgo]'); await W(200); const t1 = await toast(); log('move toast: ' + t1); must(/moved to C2/.test(t1), 'move toast'); await p.click('[data-act=undo]'); await W(); must(!(await cnt('#bulk.open')), 'bulk closed after undo');
      await p.click('[data-act=binf]'); await p.click('#layerbody [data-act=binfset][data-v=""]'); await W();
      await p.click('#view .rrow [data-act=rowmenu] >> nth=0'); await W(); log('row menu: ' + await items()); await p.keyboard.press('Escape');
    });
    await step('loc bins', async () => {
      await tab('bins'); log('bins rows: ' + await cnt('#view .rrow:has(.dots)'));
      await p.click('[data-act=lf][data-v=nolabel]'); await W(); log('no label rows: ' + await cnt('#view .rrow:has(.dots)')); await p.click('[data-act=lf][data-v=all]'); await W();
      await tick(0); await tick(1); await W(); log('bins bulk: ' + await text('#bulk')); await p.click('[data-act=bulk][data-v=label]'); await W(200); log('label toast: ' + await toast()); await p.click('[data-act=undo]'); await W();
      await p.click('#view .rrow [data-act=rowmenu] >> nth=0'); await W(); log('bin row menu: ' + await items()); await clickMenu('go');
      await W(); log('after open bin: ' + await p.evaluate(() => location.hash)); await p.goBack().catch(() => { }); await open('loc/wa/bins');
      await p.click('[data-act=addbin]'); await W(); await p.fill('#ab-n', 'D1'); await p.fill('#ab-c', '40'); await p.click('[data-act=addbingo]'); await W(200); log('add bin: ' + await toast() + ' · count ' + await text('#tabs [data-t=bins]')); await p.click('[data-act=undo]'); await W();
    });
    await step('loc bins delete', async () => {
      await open('loc/wa/bins'); await p.click('#view .rrow [data-act=rowmenu] >> nth=2'); await W(); await p.click('#layerbody [data-act=rowdo][data-v=del]'); await W(200); await p.screenshot({ path: `shots/${tag}-bindelete.png` }); log('bin delete dlg: ' + await text('#layerbody .dlg h2')); await p.click('[data-act=bulkgo]'); await W(200); log('bin delete toast: ' + await toast()); await p.click('[data-act=undo]'); await W(); log('bins after undo: ' + await text('#tabs [data-t=bins]'));
    });
    await step('loc jobs/history/files', async () => {
      await tab('jobs'); log('jobs rows: ' + await cnt('#view .rrow:has(.dots)') + ' · ' + (await text('#view .rrow >> nth=1')));
      await tick(0); await W(); log('jobs bulk: ' + await text('#bulk')); await p.click('[data-act=selclear]');
      await tab('history'); log('history rows: ' + await cnt('#view .rrow')); await p.click('[data-act=histmore]'); await W(); log('after more: ' + await cnt('#view .rrow'));
      await p.click('[data-act=compose]'); await p.fill('#compose', 'Dock door sticks · tell Sam.'); await p.click('[data-act=post]'); await W(); log('note toast: ' + await toast()); await p.click('[data-act=histf][data-k=note]'); await W(); log('notes only: ' + await cnt('#view .rrow')); await p.click('[data-act=undo]'); await p.click('[data-act=histf][data-k=all]'); await W();
      await tab('files'); await p.click('.ftile .cb >> nth=0'); await p.click('.ftile .cb >> nth=1', { modifiers: ['Shift'] }); await W(); log('files bulk: ' + await text('#bulk')); await p.screenshot({ path: `shots/${tag}-files-sel.png` }); await p.click('[data-act=fremove]'); await W(); log('toast: ' + await toast()); await p.click('[data-act=undo]'); await W(); await p.click('[data-act=fupload]'); await W(); log('files after upload: ' + await cnt('.ftile'));
    });
    await step('loc page menu + dialogs', async () => {
      await open('loc/wa'); await pm(); log('loc menu: ' + await items()); await p.screenshot({ path: `shots/${tag}-pagemenu.png` });
      await clickMenu('printlabels'); await p.screenshot({ path: `shots/${tag}-labels.png` }); await p.click('[data-act=lblgo]'); await W(200); log('labels toast: ' + await toast()); await p.click('[data-act=undo]'); await W();
      await pm(); await clickMenu('movecontents'); await p.selectOption('#mc-from', '__none'); await p.selectOption('#bk-arg', 'C4'); await p.click('[data-act=mcgo]'); await W(200); log('move contents: ' + await toast()); await p.click('[data-act=undo]'); await W();
      await pm(); await clickMenu('count'); await p.screenshot({ path: `shots/${tag}-count.png` }); await p.click('#layerbody [data-act=close]'); await W();
            await pm(); await clickMenu('addbin'); await p.click('[data-act=addbingo]'); await W(); log('add bin empty err: ' + await text('#ab-e')); await p.click('#layerbody [data-act=close]'); await W();
      await pm(); await clickMenu('dellocdlg'); await p.screenshot({ path: `shots/${tag}-locdelete.png` }); await p.click('[data-act=dellocgo]'); await W(200); log('deleted loc toast: ' + await toast() + ' · view: ' + await text('#view .empty2 b')); await p.click('[data-act=undo]'); await W(); log('restored: ' + await text('#rhead h1, #phonetitle'));
    });
    await step('loc scan', async () => {
      await open('loc/wa'); if (d) { await pm(); await clickMenu('scan'); } else await p.click('#phoneact [data-act=scan]'); await W(); await p.screenshot({ path: `shots/${tag}-scan.png` });
      await p.selectOption('#s-bin', 'B2'); await p.click('[data-act=scanread][data-tag=SK-0201]'); await W(200); log('put away: ' + await toast()); await p.click('[data-act=undo]'); await W();
      if (d) { await pm(); await clickMenu('scan'); } else await p.click('#phoneact [data-act=scan]'); await W(); await p.fill('#s-tag', 'zz-404'); await p.keyboard.press('Enter'); await W(); log('unknown: ' + await text('#s-msg')); await p.click('[data-act=scanread][data-tag=AURA-03]'); await W(200); log('same-bin msg or move: ' + (await text('#s-msg')) + ' | ' + (await toast().catch(() => ''))); await p.keyboard.press('Escape');
    });
    await step('loc edit', async () => {
      await open('loc/wa'); if (d) await p.click('.rhead [data-act=edit]'); else { await pm(); await clickMenu('edit'); } await W(200); await p.screenshot({ path: `shots/${tag}-edit.png` });
      await p.fill('#f-name', ''); await p.click('[data-act=formgo]'); await W(); log('name err: ' + await text('#e-name'));
      await p.fill('#f-name', 'Warehouse A (Alexandria)'); await p.fill('#f-cap', '650'); await p.click('[data-act=formgo]'); await W(200); log('edit toast: ' + await toast() + ' · title ' + await text('#rhead h1, #phonetitle')); await p.click('[data-act=undo]'); await W();
      if (d) await p.click('.rhead [data-act=edit]'); else { await pm(); await clickMenu('edit'); } await p.fill('#f-name', 'x'); await p.click('#layerbody [data-act=close]'); await W(); log('discard prompt: ' + await text('#layerbody .discard')); await p.click('[data-act=discard]'); await W();
      await open('loc/b2'); log('bin page: ' + await text('#rhead h1, #phonetitle') + ' · crumb ' + await text('.topbar .crumb') + ' · tabs ' + (await p.locator('#tabs button').allTextContents()).join('|'));
    });

    // ================= KIT
    await step('kit', async () => {
      await open('kit/k42'); log('kit head: ' + await text('#rhead h1, #phonetitle') + ' · ' + await text('#ready h2') + ' · ' + await text('#ready .lead')); log('kit checks: ' + (await p.locator('.todo li').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim()).join(' || '));
      must((await text('.todo')).includes('1 item missing'), 'kit missing check');
      await tab('contents'); await p.click('[data-act=lf][data-v=missing]'); await W(); must(await cnt('#view .rrow:has(.dots)') === 1, 'missing = 1'); await tick(0); await W(); log('kit bulk: ' + await text('#bulk')); await p.screenshot({ path: `shots/${tag}-kit-sel.png` });
      await p.click('[data-act=bulk][data-v=pres]'); await W(200); log('present toast: ' + await toast()); await p.click('[data-act=undo]'); await W(); log('missing after undo: ' + await text('#tabs [data-t=contents]') + ' / ' + await cnt('#view .rrow:has(.dots)'));
      await p.click('[data-act=lf][data-v=all]'); await W(); await tick(1); await tick(3, 'Shift'); await W(); log('kit bulk2: ' + await text('#bulk')); await p.click('[data-act=bulk][data-v=rm]'); await W(200); log('remove toast: ' + await toast()); await p.click('[data-act=undo]'); await W();
      await p.click('#view .rrow [data-act=rowmenu] >> nth=5'); await W(); log('missing row menu: ' + await items()); await p.keyboard.press('Escape');
      await p.click('[data-act=additem]'); await W(); await p.fill('#cd-q', 'battery'); await W(); log('add item results: ' + await cnt('#cd-res .res2')); await p.click('#cd-res [data-act=additempick] >> nth=0'); await W(200); log('add item toast: ' + await toast()); await p.click('[data-act=undo]'); await W();
      await tab('checks'); log('checks rows: ' + await cnt('#view .rrow:has(.dots)') + ' recent: ' + await cnt('#view .rrow:not(:has(.dots))')); await p.click('[data-act=mode][data-v=KIT_LEVEL]'); await W(200); log('mode toast: ' + await toast()); await p.click('[data-act=undo]'); await W();
      await tick(0); await W(); log('checks bulk: ' + await text('#bulk')); await p.click('[data-act=bulk][data-v=rm]'); await W(200); await p.click('[data-act=undo]'); await W();
      await tab('history'); log('kit history rows: ' + await cnt('#view .rrow')); await tab('files'); log('kit files: ' + await cnt('.ftile'));
      await tab('overview'); await p.click('.todo li >> nth=1'); await W(200); log('repair toast: ' + await toast()); await p.click('[data-act=undo]'); await W();
      await p.click('.todo li >> nth=0'); await W(); log('find missing → tab ' + await p.evaluate(() => location.hash));
      await pm(); log('kit menu: ' + await items()); await clickMenu('kitlabel'); await p.screenshot({ path: `shots/${tag}-kitlabel.png` }); await p.click('[data-act=labelprint]'); await W();
      await pm(); await clickMenu('retirekit'); await p.screenshot({ path: `shots/${tag}-kitretire.png` }); await p.click('[data-act=retirekitgo]'); await W(200); log('retire toast: ' + await toast() + ' · ' + await text('#ready h2')); await p.click('[data-act=undo]'); await W();
      if (d) { await pm(); await clickMenu('scan'); } else await p.click('#phoneact [data-act=scan]'); await W(); await p.screenshot({ path: `shots/${tag}-kitscan.png` }); await p.click('[data-act=scanread][data-tag=SK-0013]'); await W(); log('already: ' + await text('#s-msg')); await p.click('[data-act=scanread][data-tag=ZZ-404]'); log('not part: ' + await text('#s-msg')); await p.click('[data-act=scanread][data-tag=PA-0003]'); await W(200); log('scan toast: ' + await toast() + ' · headline ' + await text('#ready h2, #phonesub')); await p.click('[data-act=undo]'); await W();
      if (d) await p.click('.rhead [data-act=edit]'); else { await pm(); await clickMenu('edit'); } await W(200); await p.screenshot({ path: `shots/${tag}-kitedit.png` }); await p.fill('#f-tag', 'K-0043'); await p.click('[data-act=formgo]'); await W(); log('tag err: ' + await text('#e-tag')); await p.fill('#f-tag', 'K-0042'); await p.click('[data-act=rm][data-k=contents] >> nth=0'); await p.click('[data-act=formgo]'); await W(200); log('kit edit toast: ' + await toast()); await p.click('[data-act=undo]'); await W();
    });

    // ================= MAINTENANCE
    await step('maint', async () => {
      await open('maint/m188'); log('maint head: ' + await text('#ready h2') + ' · ' + await text('#ready .lead') + ' · ' + await text('#rhead h1, #phonetitle')); log('maint checks: ' + (await p.locator('.todo li').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim()).join(' || '));
      must((await text('.todo')).includes('Parts on order · ETA 12 Nov'), 'parts on order check');
      await tab('parts'); log('parts: ' + await cnt('#view .rrow:has(.dots)') + ' · foot ' + await text('.foot1')); await p.click('[data-act=lf][data-v=ord]'); await W(); await tick(0); await tick(1); await W(); log('parts bulk: ' + await text('#bulk')); await p.screenshot({ path: `shots/${tag}-parts-sel.png` }); await p.click('[data-act=bulk][data-v=arr]'); await W(200); log('arrived toast: ' + await toast()); await p.click('[data-act=undo]'); await W();
      await p.click('[data-act=lf][data-v=all]'); await W(); await p.click('[data-act=addpart]'); await W(); await p.click('[data-act=addpartgo]'); await W(); log('part err: ' + await text('#ap-e')); await p.fill('#ap-n', 'Lens motor'); await p.fill('#ap-c', '60'); await p.click('[data-act=addpartgo]'); await W(200); log('part toast: ' + await toast()); await p.click('[data-act=undo]'); await W();
      await tab('assets'); log('assets rows: ' + await cnt('#view .rrow:has(.dots)')); await tick(0); await p.click('[data-act=bulk][data-v=rm]'); await W(200); log('last asset: ' + await toast()); await p.click('[data-act=selclear]').catch(() => { });
      await p.click('[data-act=addasset]'); await W(); await p.click('#cd-res [data-act=addassetpick] >> nth=0'); await W(200); log('add asset: ' + await toast() + ' · ' + await text('#tabs [data-t=assets]')); await p.click('[data-act=undo]'); await W();
      await tab('overview'); await p.click('.todo li >> nth=0'); await W(200); log('parts arrived: ' + await toast() + ' · head ' + await text('#ready h2')); await p.click('[data-act=undo]'); await W();
      await p.click('.todo li >> nth=1'); await W(); await p.screenshot({ path: `shots/${tag}-complete.png` }); log('complete dlg: ' + await text('#layerbody .dlg h2'));
      await p.click('[data-act=cres][data-v=FAIL]'); await W(); log('fail disposition default: ' + await p.inputValue('#c-d-AURA-06')); await p.click('[data-act=cres][data-v=PASS]'); await W(); log('pass disposition default: ' + await p.inputValue('#c-d-AURA-06'));
      await p.fill('#c-labour', '60'); await p.fill('#c-next', '2027-05-09'); await p.click('[data-act=cgo]'); await W(200); log('complete toast: ' + await toast()); log('after: ' + await text('#ready h2') + ' · ' + await text('#ready .lead') + ' · sections ' + (await p.locator('#view .shead .t, #view .ovl').allTextContents()).join(',')); await p.screenshot({ path: `shots/${tag}-completed.png` });
      await p.click('[data-act=undo]'); await W(); log('after undo: ' + await text('#ready h2'));
      await pm(); log('maint menu: ' + await items()); await clickMenu('complete'); await p.click('[data-act=cres][data-v=FAIL]'); await p.click('[data-act=cgo]'); await W(200); log('fail complete: ' + await toast()); await pm(); log('completed menu: ' + await items()); await clickMenu('reopen'); await W(200); log('reopen: ' + await toast()); await p.click('[data-act=undo]'); await W(); await p.click('[data-act=undo]').catch(() => { }); await W();
      await open('maint/m188'); await pm(); await clickMenu('delmaintdlg'); await p.screenshot({ path: `shots/${tag}-maintdel.png` }); await p.click('#layerbody [data-act=close]'); await W();
      await pm(); await clickMenu('canceljob'); await p.click('[data-act=canceljobgo]'); await W(200); log('cancel: ' + await toast() + ' · ' + await text('#ready h2')); await p.click('[data-act=undo]'); await W();
      await tab('history'); log('maint history: ' + await cnt('#view .rrow')); await tab('files'); log('maint files: ' + await cnt('.ftile'));
      await open('maint/m188'); if (d) await p.click('.rhead [data-act=edit]'); else { await pm(); await clickMenu('edit'); } await W(200); await p.selectOption('#f-status', 'COMPLETED'); await W(); await p.screenshot({ path: `shots/${tag}-maintedit.png` }); log('outcome section: ' + await cnt('#f-labour')); await p.click('[data-act=formgo]'); await W(200); log('edit→completed: ' + await toast() + ' · ' + await text('#ready h2')); await p.click('[data-act=undo]'); await W();
      if (!d) { await open('maint/m188'); log('phone sticky: ' + await text('#phoneact')); }
    });

    // ================= TEST & TAG
    await step('tt', async () => {
      await open('tt/tt402'); log('tt head: ' + await text('#rhead h1, #phonetitle') + ' · ' + await text('#ready h2')); log('tt checks: ' + (await p.locator('.todo li').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim()).join(' || '));
      must((await text('.todo')).includes('18d overdue — out of service until tested'), '18d overdue check');
      await tab('tests'); await p.click('[data-act=lf][data-v=fail]'); await W(); must(await cnt('#view .rrow:has(.dots)') === 1, 'failed = 1'); await p.click('[data-act=lf][data-v=all]'); await W(); await tick(0); await tick(2, 'Shift'); await W(); log('tests bulk: ' + await text('#bulk')); await p.screenshot({ path: `shots/${tag}-tests-sel.png` }); await p.click('[data-act=bulk][data-v=csv]'); await W(200); log('csv toast: ' + await toast()); await p.click('[data-act=selclear]').catch(() => { });
      await p.click('#view .rrow [data-act=rowmenu] >> nth=0'); await W(); log('test row menu: ' + await items()); await p.keyboard.press('Escape');
      await p.click('#view .rrow [data-act=rowmenu] >> nth=4'); await W(); log('failed row menu: ' + await items()); await p.keyboard.press('Escape');
      await p.click('[data-act=recordtest]'); await W(); await p.click('[data-act=rtgo]'); await W(); log('empty err: ' + await text('#rt-err')); await p.fill('#rt-earth', '0.45'); await p.fill('#rt-ins', '120'); await p.fill('#rt-leak', '0.3'); await W(); log('fail chip: ' + await text('#rt-res')); await p.screenshot({ path: `shots/${tag}-rt-fail.png` }); await p.click('[data-act=rtgo]'); await W(200); log('fail toast: ' + await toast() + ' · status ' + await text('#rhead .dotw, #phonesub')); await p.click('[data-act=undo]'); await W();
      await p.click('[data-act=recordtest]'); await W(); await p.fill('#rt-earth', '0.08'); await p.fill('#rt-ins', '299'); await p.fill('#rt-leak', '0.22'); await W(); log('pass chip: ' + await text('#rt-res')); await p.click('[data-act=rtgo]'); await W(200); log('pass toast: ' + await toast() + ' · status ' + await text('#rhead .dotw, #phonesub')); await p.screenshot({ path: `shots/${tag}-tt-passed.png` }); await p.click('[data-act=undo]'); await W();
      await tab('overview'); await p.click('.todo li >> nth=1'); await W(200); log('book toast: ' + await toast() + ' · checks ' + (await p.locator('.todo li').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim()).join(' || ')); await p.click('[data-act=undo]'); await W();
      await pm(); log('tt menu: ' + await items()); await clickMenu('printtag'); await p.screenshot({ path: `shots/${tag}-ttlabel.png` }); await p.click('#layerbody [data-act=close]'); await W();
      await pm(); await clickMenu('retirett'); await p.click('[data-act=retirettgo]'); await W(200); log('retire: ' + await toast() + ' · ' + await text('#ready h2')); await pm(); log('retired menu: ' + await items()); await p.keyboard.press('Escape'); await p.click('[data-act=undo]'); await W();
      await tab('history'); log('tt history: ' + await cnt('#view .rrow')); await tab('files'); log('tt files: ' + await cnt('.ftile'));
      await open('tt/tt402'); if (d) await p.click('.rhead [data-act=edit]'); else { await pm(); await clickMenu('edit'); } await W(200); await p.screenshot({ path: `shots/${tag}-ttedit.png` }); await p.fill('#f-months', '0'); await p.click('[data-act=formgo]'); await W(); log('interval err: ' + await text('#e-months')); await p.fill('#f-months', '6'); await p.click('[data-act=formgo]'); await W(200); log('tt edit: ' + await toast() + ' · next due ' + await text('.facts3 .fx')); await p.click('[data-act=undo]'); await W();
      if (!d) log('phone sticky: ' + await text('#phoneact'));
    });

    // ================= CATEGORY
    await step('cat', async () => {
      await open('cat/lighting'); log('cat head: ' + await text('#rhead h1, #phonetitle') + ' · ' + await text('#ready h2')); log('cat checks: ' + (await p.locator('.todo li').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim()).join(' || '));
      await tab('models'); log('models: ' + await cnt('#view .rrow:has(.dots)')); await p.click('[data-act=lf][data-v=norate]'); await W(); must(await cnt('#view .rrow:has(.dots)') === 2, 'norate = 2'); await tick(0); await tick(1, 'Shift'); await W(); log('cat bulk: ' + await text('#bulk')); await p.screenshot({ path: `shots/${tag}-cat-sel.png` });
      await p.click('[data-act=bulk][data-v=rate]'); await W(); await p.fill('#bk-arg', '85'); await p.click('[data-act=bulkgo]'); await W(200); log('rate toast: ' + await toast() + ' · header ' + await text('#rhead .dotw, #phonesub')); await p.click('[data-act=undo]'); await W();
      await p.click('[data-act=lf][data-v=all]'); await W(); await tick(0); await p.click('[data-act=bulk][data-v=move]'); await W(); await p.selectOption('#bk-arg', 'Video'); await p.click('[data-act=bulkgo]'); await W(200); log('move toast: ' + await toast() + ' · ' + await text('#tabs [data-t=models]')); await p.click('[data-act=undo]'); await W();
      await p.click('[data-act=incl]'); await W(); log('incl subcats rows: ' + await cnt('#view .rrow:has(.dots)')); await p.click('[data-act=incl]'); await W();
      await tab('kits'); log('kits: ' + await cnt('#view .rrow:has(.dots)')); await tab('subcategories'); log('subs: ' + await cnt('#view .rrow:has(.dots)'));
      await p.click('[data-act=addsub]'); await W(); await p.fill('#as-n', 'Followspots'); await p.click('[data-act=addsubgo]'); await W(200); log('add sub: ' + await toast() + ' · ' + await text('#tabs [data-t=subcategories]')); await p.click('[data-act=undo]'); await W();
      await tick(0); await W(); await p.click('[data-act=bulk][data-v=del]'); await W(); await p.screenshot({ path: `shots/${tag}-subdel.png` }); await p.click('[data-act=bulkgo]'); await W(200); log('sub delete: ' + await toast() + ' · ' + await text('#tabs [data-t=models]')); await p.click('[data-act=undo]'); await W();
      await p.click('#view .rrow a.ttl >> nth=0'); await W(); log('sub page: ' + await text('.topbar .crumb') + ' · ' + await text('#rhead h1, #phonetitle') + ' · tabs ' + (await p.locator('#tabs button').allTextContents()).join('|'));
      await open('cat/lighting'); await pm(); log('cat menu: ' + await items()); await clickMenu('delcat'); await p.screenshot({ path: `shots/${tag}-catdel.png` }); await p.click('#layerbody [data-act=close]'); await W();
      if (d) await p.click('.rhead [data-act=edit]'); else { await pm(); await clickMenu('edit'); } await W(200); await p.screenshot({ path: `shots/${tag}-catedit.png` }); await p.fill('#f-name', ''); await p.click('[data-act=formgo]'); await W(); log('cat name err: ' + await text('#e-name')); await p.fill('#f-name', 'Lighting & FX'); await p.selectOption('#f-ttcls', ''); await W(); log('months hidden: ' + (await cnt('#f-ttmonths'))); await p.click('[data-act=formgo]'); await W(200); log('cat edit: ' + await toast() + ' · ' + await text('#ready h2')); await p.click('[data-act=undo]'); await W();
      if (!d) log('phone sticky: ' + await text('#phoneact'));
    });

    // ================= switch + empties + not found
    await step('misc', async () => {
      await open('loc/wa'); await p.click('#recsw [data-t=kit]'); await W(); log('switch → ' + await p.evaluate(() => location.hash)); await p.click('#recsw [data-t=maint]'); await W(); log('switch → ' + await p.evaluate(() => location.hash));
      await open('nope/zz'); log('bad hash falls back: ' + await p.evaluate(() => location.hash) + ' ' + await text('#rhead h1, #phonetitle'));
      await open('loc/wa/contents'); await p.fill('#q', 'zzzz'); await W(); log('empty search: ' + await text('#view .empty2 b')); await p.click('[data-act=clearf]'); await W(); log('cleared rows: ' + await cnt('#view .rrow:has(.dots)'));
      await open('kit/k42/contents'); await p.click('[data-act=lf][data-v=bulk]'); await p.fill('#q', 'zz'); await W(); await p.keyboard.press('Escape');
      if (!d) { await open('loc/wa/contents'); await p.click('#view .rrow [data-act=rowmenu] >> nth=0'); await W(); await p.screenshot({ path: `shots/${tag}-rowsheet.png` }); log('phone row sheet: ' + await items()); await p.keyboard.press('Escape'); await tick(0); await W(); log('phone bulk visible: ' + await cnt('#bulk.open') + ' sticky hidden: ' + (await p.locator('#phoneact').isVisible() ? 'no' : 'yes')); await p.screenshot({ path: `shots/${tag}-sel.png` }); }
      const over = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 || document.body.scrollWidth > window.innerWidth + 1); must(!over || d, 'no horizontal page scroll on phone');
    });
    await p.close();
  };
  await run(1440, 900, 'desk');
  await run(390, 844, 'phone');
  console.log('fails:', fails.length ? fails : '[]');
  console.log('errors:', errs);
  await b.close();
})();
