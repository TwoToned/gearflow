// Run from this directory: NODE_PATH=$(npm root -g) node forms-check.cjs
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const errs = [];
  const ALL = ['asset', 'bulk', 'model', 'kit', 'location', 'client', 'crew', 'supplier', 'order', 'maint', 'sched'];
  const run = async (w, h, tag) => {
    const desk = tag === 'desk';
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await ctx.route('**/*', r => r.continue());
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(tag + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(tag + ' console: ' + m.text()); });
    const log = s => console.log(tag, s);
    const n = async sel => await p.locator(sel).count();
    const txt = async sel => (await p.locator(sel).first().textContent()).trim().replace(/\s+/g, ' ');
    const ROW = k => (desk ? `#tblwrap tr.row[data-k=${k}]` : `#list .lrow[data-k=${k}]`);
    const DOTS = k => (desk ? `#tblwrap [data-act=rowmenu][data-k=${k}]` : `#list [data-act=rowmenu][data-k=${k}]`);
    const sheetOpen = async () => (await n('.dlg')) === 1;
    const errCount = async () => await p.evaluate(() => [...document.querySelectorAll('.dlg .err')].filter(e => e.textContent.trim()).length);
    const shot = async name => p.screenshot({ path: `shots/${tag}-${name}.png` });
    const closeSheet = async () => { await p.keyboard.press('Escape'); await p.waitForTimeout(80); if (await n('.dlg') && !(await n('[data-act=discard]'))) { await p.keyboard.press('Escape'); await p.waitForTimeout(80); } if (await n('.dlg')) { const d = await n('[data-act=discard]'); if (d) await p.click('[data-act=discard]'); } await p.waitForTimeout(60); };
    const rowSavedText = async k => (await p.locator(ROW(k)).first().textContent()).replace(/\s+/g, ' ');
    await p.goto('file://' + process.cwd() + '/forms-prototype.html'); await p.waitForTimeout(500);
    // ---- gallery
    log('head: ' + await txt('.lphead h1') + ' · count ' + await txt('#count') + ' · rows ' + await n(desk ? '#tblwrap tr.row' : '#list .lrow[data-k]'));
    log('groups: ' + (await p.locator(desk ? '#tblwrap tr.grp' : '#list .lhead').allTextContents()).map(t => t.replace(/\s+/g, ' ').trim()).join(' | '));
    await shot('gallery');
    await p.fill('#q', 'cli'); log('search cli rows: ' + await n(desk ? '#tblwrap tr.row' : '#list .lrow[data-k]') + ' (expect 1)');
    await p.fill('#q', 'zzzz'); log('empty: ' + await txt('.empty')); await p.click('[data-act=clearq]:visible'); log('cleared rows: ' + await n(desk ? '#tblwrap tr.row' : '#list .lrow[data-k]'));
    // ---- page menu
    await p.click(desk ? '.lphead [data-act=pagemenu]' : '.phonehead [data-act=pagemenu]'); await p.waitForTimeout(120); log('page menu items: ' + await n('.menu a, .sheetwrap a')); await shot('pagemenu'); await p.keyboard.press('Escape');
    // ---- new job row opens the wizard (popup)
    const [pop] = await Promise.all([p.waitForEvent('popup', { timeout: 4000 }).catch(() => null), p.click(ROW('job'))]);
    log('new job row opens wizard popup: ' + !!pop + (pop ? ' ' + pop.url() : '')); if (pop) await pop.close().catch(() => { });
    await p.click(DOTS('job')); await p.waitForTimeout(100); log('job row menu: ' + (await p.locator('.menu a, .sheetwrap a').allTextContents()).map(t => t.replace(/\s+/g, ' ')).join(' | ')); await p.keyboard.press('Escape');
    // ---- every form: create (blank -> one validation error) + edit (prefilled)
    for (const k of ALL) {
      await p.click(ROW(k)); await p.waitForTimeout(150);
      const open = await sheetOpen(); const cls = await p.getAttribute('.dlg', 'class');
      if (k === 'order') await p.fill('#f-num', '');
      await p.click('.dlg .ft .btn-primary'); await p.waitForTimeout(80);
      const ec = await errCount();
      let fs = ''; if (!desk) fs = await p.evaluate(() => { const i = document.querySelector('.dlg input:not([type=checkbox]):not([type=date])'); return i ? getComputedStyle(i).fontSize : ''; });
      const foot = await p.evaluate(() => { const r = document.querySelector('.dlg .ft .btn-primary').getBoundingClientRect(); return Math.round(r.bottom) + '/' + innerHeight; });
      log(`${k} create: open=${open} class="${cls}" errors-after-blank-save=${ec} primary bottom=${foot}${fs ? ' input font=' + fs : ''}`);
      if (k === 'client' || k === 'crew') await shot(k + '-create-err');
      await closeSheet();
      await p.click(DOTS(k)); await p.waitForTimeout(100);
      await p.click('[data-act=open][data-m=edit]'); await p.waitForTimeout(150);
      const hv = await txt('.dlg .hd h2'); const pre = await p.evaluate(() => { const i = [...document.querySelectorAll('.dlg input:not([type=checkbox])')].filter(x => x.value && x.type !== 'date'); return i.length; });
      log(`${k} edit: open=${await sheetOpen()} title="${hv}" prefilled inputs=${pre} errors=${await errCount()}`);
      if (k === 'model' || k === 'kit' || k === 'client' || k === 'maint' || k === 'location') await shot(k + '-edit');
      await closeSheet();
    }
    // ---- CLIENT: dependent labels, inline error, save + Undo
    await p.click(ROW('client')); await p.waitForTimeout(100);
    log('client labels: ' + await txt('#fw-name label') + ' / contact name present=' + await n('#f-cname'));
    await p.click('[data-act=wsel][data-v=INDIVIDUAL]'); log('type Person -> ' + await txt('#fw-name label') + ' / contact name present=' + await n('#f-cname') + ' / contact hint: ' + await txt('.fsec:nth-child(2) .fh span'));
    await p.click('[data-act=wsel][data-v=COMPANY]');
    await p.fill('#f-name', ''); await p.type('#f-name', 'Acme'); await p.fill('#f-name', ''); await p.waitForTimeout(40);
    await p.fill('#f-email', 'not-an-email'); log('inline errors while typing (name touched + email): ' + await errCount() + ' · ' + (await p.locator('.dlg .err').allTextContents()).filter(Boolean).join(' | '));
    await shot('client-sel');
    await p.fill('#f-name', 'Acme Events'); await p.fill('#f-email', 'hello@acme.example'); await p.waitForTimeout(40);
    log('errors after fixing: ' + await errCount());
    await p.click('.dlg .ft .btn-primary'); await p.waitForTimeout(150);
    log('client saved: sheet open=' + await sheetOpen() + ' toast: ' + await txt('#toast') + ' · row: ' + (await rowSavedText('client')).slice(-60));
    await p.click('#toast [data-act=undo]'); await p.waitForTimeout(80);
    log('after Undo row: ' + (await rowSavedText('client')).includes('Saved') + ' (expect false)');
    // client edit: contacts rows
    await p.click(DOTS('client')); await p.click('[data-act=open][data-m=edit]'); await p.waitForTimeout(120);
    log('client edit contacts: ' + await n('.crows .crow') + ' rows');
    await p.click('[data-act=cshow]'); await p.fill('#c-n', 'Jo Park'); await p.fill('#c-r', 'Banquet manager'); await p.fill('#c-e', 'bad'); await p.click('[data-act=cadd]'); log('contact email error: ' + await txt('#c-ee'));
    await p.fill('#c-e', 'jo.park@hilton.example'); await p.click('[data-act=cadd]'); log('contacts after add: ' + await n('.crows .crow'));
    await p.click('[data-act=rm][data-k=contacts] >> nth=0'); log('contacts after remove: ' + await n('.crows .crow'));
    await p.click('.dlg .ft .btn-primary'); await p.waitForTimeout(100); log('client edit toast: ' + await txt('#toast'));
    await p.click('#toast [data-act=undo]'); await p.waitForTimeout(60);
    // discard prompt
    await p.click(DOTS('client')); await p.click('[data-act=open][data-m=edit]'); await p.fill('#f-name', 'Hilton Sydney 2'); await p.keyboard.press('Escape'); log('discard prompt: ' + await txt('.dlg .ft .discard')); await p.click('[data-act=keep]'); log('keep editing -> sheet open ' + await sheetOpen()); await p.keyboard.press('Escape'); await p.click('[data-act=discard]'); log('discarded -> sheet open ' + await sheetOpen());
    // ---- ASSET: search-first model, Enter picks top, add another
    await p.click(ROW('asset')); await p.waitForTimeout(100);
    await p.type('#f-model', 'aura'); await p.waitForTimeout(60); log('asset model results: ' + await n('#pl-model .res2') + ' top: ' + await txt('#pl-model .res2.on'));
    await p.keyboard.press('Enter'); await p.waitForTimeout(100);
    log('after Enter: model=' + await p.inputValue('#f-model') + ' tag=' + await p.inputValue('#f-tag'));
    await p.fill('#f-tag', 'AURA-03'); await p.waitForTimeout(40); log('dup tag error: ' + await txt('#e-tag'));
    await p.fill('#f-tag', 'AURA-07'); await p.fill('#f-serial', 'MA2043999');
    await p.click('.dlg .ft .again'); await p.waitForTimeout(150);
    log('add another: sheet open=' + await sheetOpen() + ' model kept=' + await p.inputValue('#f-model') + ' tag advanced=' + await p.inputValue('#f-tag') + ' serial cleared=' + (await p.inputValue('#f-serial') === '') + ' toast: ' + await txt('#toast'));
    await shot('asset-again');
    await p.click('[data-act=swform][data-k=bulk]'); await p.waitForTimeout(100); log('switch to bulk: header ' + await txt('.dlg .hd h2') + ' fields qty=' + await n('#f-qty'));
    await p.click('.dlg .ft .btn-primary'); await p.waitForTimeout(80); log('bulk blank errors: ' + await errCount());
    await closeSheet();
    // ---- CREW: add another keeps type/rates, clears names
    await p.click(ROW('crew')); await p.waitForTimeout(100);
    await p.fill('#f-first', 'Dev'); await p.fill('#f-last', 'Patel'); await p.selectOption('#f-type', 'EMPLOYEE'); await p.click('[data-act=moretoggle]'); await p.fill('#f-day', '-5'); log('crew negative rate: ' + await txt('#e-day')); await p.fill('#f-day', ''); log('blank rate stays blank, error: "' + await txt('#e-day') + '"'); await p.fill('#f-day', '700');
    await p.click('.dlg .ft .again'); await p.waitForTimeout(120);
    log('crew add another: first cleared=' + (await p.inputValue('#f-first') === '') + ' type kept=' + await p.inputValue('#f-type') + ' day kept=' + await p.inputValue('#f-day') + ' · header note: ' + await txt('.dlg .hd .t-small'));
    await p.fill('#f-first', 'Mia'); await p.fill('#f-last', 'Rossi'); await p.click('.dlg .ft .btn-primary'); await p.waitForTimeout(100); log('crew saved: ' + await txt('#toast'));
    await p.click('#toast [data-act=undo]');
    if (desk) await shot('crew-saved');
    // ---- LOCATION: search-first parent
    await p.click(ROW('location')); await p.waitForTimeout(100);
    await p.fill('#f-name', 'Bay 4'); await p.click('#f-parent'); await p.waitForTimeout(80); log('parent list: ' + await n('#pl-parent .res2') + ' items'); await p.type('#f-parent', 'van'); await p.waitForTimeout(60); log('parent filtered: ' + (await p.locator('#pl-parent .res2').allTextContents()).join(' | ')); await p.keyboard.press('Enter'); await p.waitForTimeout(80); log('parent set: ' + await p.inputValue('#f-parent'));
    if (desk) await shot('location-parent');
    await p.click('.dlg .ft .again'); await p.waitForTimeout(120); log('location add another: name cleared=' + (await p.inputValue('#f-name') === '') + ' parent kept=' + await p.inputValue('#f-parent'));
    await closeSheet();
    // ---- KIT: contents search-first + check mode
    await p.click(ROW('kit')); await p.waitForTimeout(100);
    log('kit mode hint: ' + await txt('#f-mode').catch(() => ''));
    await p.fill('#f-name', 'Spare wireless kit'); await p.fill('#f-tag', 'K-0042'); await p.waitForTimeout(40); log('kit dup tag: ' + await txt('#e-tag'));
    await p.fill('#f-tag', 'K-0060');
    await p.type('#f-contents', 'sk-'); await p.waitForTimeout(50); await p.keyboard.press('Enter'); await p.waitForTimeout(80);
    await p.type('#f-contents', 'paddle'); await p.waitForTimeout(50); await p.keyboard.press('Enter'); await p.waitForTimeout(80);
    log('kit contents rows: ' + await n('#rows-contents .crow') + ' · bulk qty inputs: ' + await n('#rows-contents input'));
    await p.click('[data-act=wsel][data-v=PER_ITEM]'); log('check mode hint: ' + (await p.locator('#f-mode').locator('xpath=..').textContent()).replace(/\s+/g, ' '));
    if (desk) await shot('kit-contents');
    await p.click('.dlg .ft .btn-primary'); await p.waitForTimeout(100); log('kit saved: ' + await txt('#toast')); await p.click('#toast [data-act=undo]');
    // ---- MAINT: multi assets, COMPLETED reveals Outcome
    await p.click(ROW('maint')); await p.waitForTimeout(100);
    await p.click('.dlg .ft .btn-primary'); log('maint blank errors: ' + await txt('#e-assets') + ' | ' + await txt('#e-title'));
    await p.type('#f-assets', 'aura-0'); await p.waitForTimeout(50); await p.keyboard.press('Enter'); await p.waitForTimeout(80); await p.type('#f-assets', 'sk-'); await p.waitForTimeout(50); await p.keyboard.press('Enter'); await p.waitForTimeout(80);
    log('maint assets chosen: ' + await n('#rows-assets .crow') + ' · outcome section before: ' + await n('.fsec .fh b:text-is("Outcome")'));
    await p.fill('#f-title', 'Annual check'); await p.selectOption('#f-status', 'COMPLETED'); await p.waitForTimeout(80);
    log('after COMPLETED: outcome=' + await n('.fsec .fh b:text-is("Outcome")') + ' completed date=' + await n('#f-done') + ' dispositions=' + await n('select[id^=d-]'));
    await p.fill('#f-done', '2026-11-01'); await p.waitForTimeout(40); log('completed before scheduled: ' + await txt('#e-done'));
    await p.click('[data-act=wsel][data-v=FAIL]'); log('FAIL -> default disposition: ' + await p.inputValue('select[id^=d-] >> nth=0'));
    await p.fill('#f-cost', '-3'); await p.waitForTimeout(40); log('cost negative: ' + await txt('#e-cost'));
    if (desk) await shot('maint-outcome'); else await shot('maint-outcome');
    await p.fill('#f-cost', ''); await p.fill('#f-done', '2026-11-12'); await p.click('.dlg .ft .btn-primary'); await p.waitForTimeout(100); log('maint saved: ' + await txt('#toast')); await p.click('#toast [data-act=undo]');
    // ---- SCHED stays a small dialog
    await p.click(ROW('sched')); await p.waitForTimeout(100); log('sched dialog class: ' + await p.getAttribute('.dlg', 'class') + ' fields=' + await n('.dlg .field'));
    await p.type('#f-model', 'aura'); await p.keyboard.press('Enter'); await p.fill('#f-name', 'Service'); await p.fill('#f-every', '0'); await p.waitForTimeout(40); log('interval 0: ' + await txt('#e-every')); await p.fill('#f-every', '130'); log('interval 130: ' + await txt('#e-every')); await p.fill('#f-every', '6'); await p.click('.dlg .ft .btn-primary'); await p.waitForTimeout(100); log('sched saved: ' + await txt('#toast'));
    // ---- MODEL dependents
    await p.click(ROW('model')); await p.waitForTimeout(100);
    await p.click('[data-act=moretoggle]'); log('model sale stock hidden=' + (await n('#f-saleQty') === 0)); await p.fill('#f-sale', '120'); await p.waitForTimeout(80); log('after sale price: sale stock shown=' + await n('#f-saleQty')); log('T&T profile hidden=' + (await n('#f-profile') === 0)); await p.check('#f-tt'); await p.waitForTimeout(80); log('after T&T: profile shown=' + await n('#f-profile') + ' validity=' + await n('#f-ttDays'));
    await p.fill('#f-day', '-1'); await p.waitForTimeout(40); log('model negative rate: ' + await txt('#e-day')); await p.fill('#f-day', ''); log('blank day rate: "' + await txt('#e-day') + '"');
    if (desk) await shot('model-create');
    await closeSheet();
    // ---- ORDER / SUPPLIER
    await p.click(ROW('order')); await p.waitForTimeout(100); await p.fill('#f-odate', '2026-11-10'); await p.fill('#f-edate', '2026-11-05'); await p.waitForTimeout(40); log('order expected before ordered: ' + await txt('#e-edate')); await p.fill('#f-edate', '2026-11-12'); await p.click('.dlg .ft .btn-primary'); await p.waitForTimeout(100); log('order saved: ' + await txt('#toast'));
    await p.click(ROW('supplier')); await p.waitForTimeout(100); await p.fill('#f-name', 'Big Picture'); await p.click('.dlg .ft .btn-primary'); await p.waitForTimeout(100); log('supplier saved: ' + await txt('#toast'));
    log('gallery saved marks: ' + await n(desk ? '#tblwrap .dotw.ok' : '#list .dotw.ok'));
    await shot('gallery-saved');
    // phone-specific: row card tap = create, ⋯ visible
    if (!desk) { log('phone dots visible: ' + await p.locator(DOTS('crew')).isVisible() + ' size ' + JSON.stringify(await p.locator(DOTS('crew')).boundingBox())); await p.click(ROW('crew')); await p.waitForTimeout(100); await shot('crew-sheet'); log('phone sheet height: ' + JSON.stringify(await p.evaluate(() => { const r = document.querySelector('.dlg').getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height), innerHeight]; }))); }
    log('page errors so far: ' + errs.length);
    await ctx.close();
  };
  await run(1440, 900, 'desk'); await run(390, 844, 'phone');
  await b.close();
  console.log('errors:', JSON.stringify(errs));
})();
