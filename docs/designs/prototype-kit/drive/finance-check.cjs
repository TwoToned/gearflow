// Run from this directory: NODE_PATH=$(npm root -g) node finance-check.cjs [file.html]
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const errs = [];
  const run = async (w, h, tag) => {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    p.on('pageerror', e => errs.push(tag + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(tag + ' console: ' + m.text()); });
    await p.goto('file://' + process.cwd() + '/' + (process.argv[2] || 'finance-prototype.html')); await p.waitForTimeout(400);
    const D = tag === 'desk', log = (...a) => console.log(tag, ...a);
    const rc = () => p.locator(D ? '#tblwrap tr.row' : '#list .lrow[data-id]').count();
    const wait = (n = 120) => p.waitForTimeout(n);
    const kind = t => p.click(D ? `#kindsw [data-t=${t}]` : `#kindrow [data-t=${t}]`);
    const rowDots = async txt => { const sel = D ? `#tblwrap tr.row:has-text("${txt}")` : `#list .lrow:has-text("${txt}")`; if (D) await p.hover(sel); await p.click(sel + ' .dots'); await wait(150); };
    const toastTxt = async () => (await p.locator('#toast').textContent()).trim();
    const strip = async () => (await p.locator('#strip button').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim()).join(' | ');
    await p.screenshot({ path: `shots/${tag}-1.png` });
    log('tabs:', (await p.locator(D ? '#kindsw .fw' : '#kindrow button').allTextContents()).join(' | '));
    log('money words:', (await p.locator('#mwords .mw').allTextContents()).join(' | '));
    log('quote strip:', await strip()); log('quote rows (page 1):', await rc());
    log('#2341 link href:', await p.locator('a.jn[href*="claude.ai"]').first().getAttribute('href'));
    // segments
    for (const k of ['draft', 'sent', 'accepted', 'expired']) { await p.click(`#strip [data-k=${k}]`); await wait(); log(`quotes ${k} rows:`, await rc()); }
    await p.screenshot({ path: `shots/${tag}-expired.png` });
    await p.click('#strip [data-k=all]');
    // money words deep-link
    await p.click('.mw >> nth=3'); await wait();
    log('overdue word → tab:', await p.locator(D ? '#kindsw .fw.on' : '#kindrow .on').textContent(), '| strip on:', await p.locator('#strip .on').textContent(), '| rows:', await rc(), '| url:', p.url().split('?')[1]);
    await p.click('.mw >> nth=2'); await wait();
    log('invoiced-this-month → fwords:', (await p.locator('#fwords .fw').allTextContents()).join(' | '), '| rows:', await rc());
    await p.click('.mw >> nth=0'); await wait(); log('quoted word → strip on:', await p.locator('#strip .on').textContent().then(s => s.trim()), '| rows:', await rc());
    await p.click('.mw >> nth=1'); await wait(); log('awaiting word → rows:', await rc());
    // invoices strip + filters
    await p.click('#strip [data-k=all]'); await wait(); log('invoice strip:', await strip()); log('invoice rows:', await rc());
    for (const k of ['draft', 'dd', 'issued', 'paid', 'overdue']) { await p.click(`#strip [data-k=${k}]`); await wait(); log(`invoices ${k} rows:`, await rc()); }
    await p.screenshot({ path: `shots/${tag}-overdue.png` });
    await p.click('#strip [data-k=all]');
    await p.click('[data-act=fmenu][data-k=client]'); await wait(); await p.click('[data-act=ftoggle][data-v="Qantas"]'); await wait(); await p.click('[data-act=ftoggle][data-v="Ogilvy"]'); await wait(); await p.keyboard.press('Escape');
    log('client filter:', (await p.locator('#fwords .fw').allTextContents()).join(' | '), '| rows:', await rc());
    await p.click('[data-act=clearf]'); await wait();
    await p.click('[data-act=smenu][data-k=issued]'); await wait(); await p.click('[data-act=sset][data-v=month]'); await wait(); log('issued=this month rows:', await rc());
    await p.click('[data-act=fmenu][data-k=xero]'); await wait(); await p.click('[data-act=ftoggle][data-v=NOT]'); await wait(); await p.click('[data-act=ftoggle][data-v=ERROR]'); await wait(); await p.keyboard.press('Escape');
    log('xero filter rows:', await rc(), '| fwords:', (await p.locator('#fwords .fw').allTextContents()).join(' | '));
    await p.click('[data-act=clearf]'); await wait();
    await p.fill('#q', 'qantas'); await wait(); log('search qantas rows:', await rc()); await p.fill('#q', ''); await wait();
    if (D) { await p.click('th button[data-k=total]'); await p.click('th button[data-k=total]'); await wait(); log('first total after desc sort:', await p.locator('#tblwrap tr.row >> nth=0 >> td.r.mono').textContent()); }
    // selection + bulk: chase the overdue two
    await p.click('#strip [data-k=overdue]'); await wait();
    const cb = D ? '#tblwrap tr.row .cb' : '#list .lrow .cb';
    await p.click(cb + ' >> nth=0'); await p.click(cb + ' >> nth=1', { modifiers: ['Shift'] }); await wait();
    log('bulk (overdue 2):', (await p.locator('#bulk').textContent()).trim().replace(/\s+/g, ' '));
    await p.screenshot({ path: `shots/${tag}-sel.png` });
    await p.click('[data-act=bulkchase]'); await wait(150);
    log('chase dialog:', (await p.locator('#chasetxt').inputValue()).slice(0, 90).replace(/\n/g, ' '), '...');
    await p.screenshot({ path: `shots/${tag}-chase.png` });
    await p.click('[data-act=chasego]'); await wait(); log('toast:', await toastTxt());
    await p.click('[data-act=clearsel]'); await wait();
    // Xero bulk sync + undo
    await p.click('#strip [data-k=all]'); await p.click('[data-act=fmenu][data-k=xero]'); await wait(); await p.click('[data-act=ftoggle][data-v=NOT]'); await wait(); await p.keyboard.press('Escape');
    const nNot = await rc(); await p.click(cb + ' >> nth=0'); await wait();
    log('bulk (not in xero):', (await p.locator('#bulk').textContent()).trim().replace(/\s+/g, ' '), '| rows:', nNot);
    await p.click('[data-act=bulkxero]'); await wait(); log('toast:', await toastTxt()); log('rows after sync:', await rc());
    await p.click('[data-act=undo]'); await wait(); log('rows after undo:', await rc()); await p.click('[data-act=clearf]'); await wait();
    // row menu: record payment on the 18d-overdue invoice, undo
    await p.click('#strip [data-k=overdue]'); await wait();
    const first = D ? await p.locator('#tblwrap tr.row >> nth=0').textContent() : await p.locator('#list .lrow >> nth=0').textContent();
    log('oldest overdue first:', first.replace(/\s+/g, ' ').trim().slice(0, 110));
    await rowDots('UNSW graduation'); await p.screenshot({ path: `shots/${tag}-rowmenu.png` });
    log('row menu:', (await p.locator(D ? '.menu button, .menu a' : '.sheetwrap .item, .sheetwrap a').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim()).join(' | '));
    await p.click('[data-act=pay]'); await wait(150); await p.fill('#py-amt', '3000'); await p.screenshot({ path: `shots/${tag}-paydlg.png` });
    await p.click('[data-act=paygo]'); await wait(); log('toast:', await toastTxt()); log('row now:', (await p.locator(D ? '#tblwrap tr.row >> nth=0' : '#list .lrow >> nth=0').textContent()).replace(/\s+/g, ' ').trim().slice(0, 120));
    await p.click('[data-act=undo]'); await wait(); log('after undo overdue rows:', await rc());
    // void with downstream-effects confirm, then undo
    await p.click('#strip [data-k=issued]'); await wait();
    await rowDots('Charity ball'); log('issued row menu:', (await p.locator(D ? '.menu button, .menu a' : '.sheetwrap .item, .sheetwrap a').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim()).join(' | '));
    await p.click('[data-act=void]'); await wait(150); await p.screenshot({ path: `shots/${tag}-voiddlg.png` });
    log('void dialog:', (await p.locator('.dlg .bd').textContent()).trim().slice(0, 120));
    await p.fill('#vd-why', 'wrong PO'); await p.click('[data-act=voidgo]'); await wait(); log('toast:', await toastTxt()); log('issued rows after void:', await rc());
    await p.click('[data-act=undo]'); await wait(); log('issued rows after undo:', await rc());
    // deposit due ghost rows
    await p.click('#strip [data-k=dd]'); await wait(); await rowDots('Corporate AGM'); log('deposit-due menu:', (await p.locator(D ? '.menu button, .menu a' : '.sheetwrap .item, .sheetwrap a').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim()).join(' | ')); await p.keyboard.press('Escape');
    // invoice draft delete + bulk delete confirm
    await p.click('#strip [data-k=draft]'); await wait(); await p.click(cb + ' >> nth=0'); await wait();
    log('bulk (draft):', (await p.locator('#bulk').textContent()).trim().replace(/\s+/g, ' '));
    await p.click('[data-act=bulkdel]'); await wait(150); await p.screenshot({ path: `shots/${tag}-deldlg.png` }); await p.click('[data-act=bulkdelgo]'); await wait(); log('toast:', await toastTxt()); log('drafts left:', await rc());
    await p.click('[data-act=undo]'); await wait(); log('drafts after undo:', await rc());
    // quotes: accept + acknowledge + generate PDF
    await kind('q'); await wait(); await p.click('#strip [data-k=expired]'); await wait();
    log('expired rows:', await rc(), '| first status:', (await p.locator(D ? '#tblwrap tr.row >> nth=0' : '#list .lrow >> nth=0').textContent()).replace(/\s+/g, ' ').trim().slice(0, 90));
    await rowDots('Launch night'); log('expired quote menu:', (await p.locator(D ? '.menu button, .menu a' : '.sheetwrap .item, .sheetwrap a').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim()).join(' | '));
    await p.click('[data-act=ack]'); await wait(); log('toast:', await toastTxt(), '| expired rows:', await rc()); await p.click('[data-act=undo]'); await wait(); log('after undo expired rows:', await rc());
    await rowDots('Town hall'); await p.click('[data-act=accept]'); await wait(150); await p.fill('#ac-ref', 'PO 9001'); await p.click('[data-act=acceptgo]'); await wait(); log('toast:', await toastTxt()); await p.click('[data-act=undo]'); await wait(); log('expired after undo:', await rc());
    await p.click('#strip [data-k=sent]'); await wait(); await rowDots('Conference'); await p.click('[data-act=genpdf]'); await wait(); log('toast:', await toastTxt());
    await p.click('#strip [data-k=all]'); await wait();
    await p.click('[data-act=smenu][data-k=valid]'); await wait(); await p.click('[data-act=sset][data-v=soon]'); await wait(); log('expiring in 7 days rows:', await rc()); await p.click('[data-act=clearf]');
    // paging
    if (D) { await p.click('[data-act=page][data-d="1"]'); await wait(); log('quotes page 2 rows:', await rc(), '| foot:', (await p.locator('#foot').textContent()).trim().replace(/\s+/g, ' ').slice(0, 70)); await p.click('[data-act=page][data-d="-1"]'); }
    else { await p.locator('[data-act=more]').scrollIntoViewIfNeeded(); await p.click('[data-act=more]'); await wait(); log('after more rows:', await rc()); await p.evaluate(() => window.scrollTo(0, 0)); }
    // page menu, columns, show dead, xero dialog, not connected preview
    await p.click(D ? '.lphead [data-act=pagemenu]' : '.phonehead [data-act=pagemenu]'); await wait(); await p.screenshot({ path: `shots/${tag}-pagemenu.png` });
    log('page menu:', (await p.locator(D ? '.menu button, .menu a' : '.sheetwrap .item, .sheetwrap a').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim()).join(' | '));
    await p.click('[data-act=showdead]'); await wait(); log('quotes All with superseded/declined:', (await strip()).split(' | ')[0]); 
    await p.click(D ? '.lphead [data-act=pagemenu]' : '.phonehead [data-act=pagemenu]'); await wait(); await p.click('[data-act=showdead]'); await wait();
    await kind('i'); await wait();
    await p.click(D ? '.lphead [data-act=pagemenu]' : '.phonehead [data-act=pagemenu]'); await wait(); await p.click('[data-act=xerodlg]'); await wait(150); await p.screenshot({ path: `shots/${tag}-xerodlg.png` }); log('xero dialog:', (await p.locator('.dlg .bd').textContent()).trim().replace(/\s+/g, ' ').slice(0, 110)); await p.keyboard.press('Escape');
    await p.click(D ? '.lphead [data-act=pagemenu]' : '.phonehead [data-act=pagemenu]'); await wait(); await p.click('[data-act=xeroconn]'); await wait();
    log('not connected → note:', (await p.locator('#xnote').textContent()).trim().slice(0, 60), '| xero th:', await p.locator('th:has-text("Xero")').count(), '| xero fw:', await p.locator('#fwords .fw:has-text("Xero")').count());
    await p.screenshot({ path: `shots/${tag}-noxero.png` });
    await p.click(cb + ' >> nth=0'); await wait(); log('bulk w/o xero:', (await p.locator('#bulk').textContent()).trim().replace(/\s+/g, ' ')); await p.click('[data-act=clearsel]');
    await p.click(D ? '.lphead [data-act=pagemenu]' : '.phonehead [data-act=pagemenu]'); await wait(); await p.click('[data-act=xeroconn]'); await wait();
    if (D) { await p.click('.lphead [data-act=pagemenu]'); await wait(); await p.click('[data-act=colsmenu]'); await wait(); await p.click('[data-act=coltoggle][data-c=contact]'); await wait(); log('contact column th:', await p.locator('th:has-text("Contact")').count()); await p.click('.lphead [data-act=pagemenu]'); await wait(); await p.click('[data-act=colsmenu]'); await wait(); await p.click('[data-act=coltoggle][data-c=contact]'); await wait(); }
    // new menu + job picker
    await p.click(D ? '.lphead [data-act=new]' : '#phoneact [data-act=new]'); await wait(); await p.screenshot({ path: `shots/${tag}-newmenu.png` });
    await p.click('[data-act=newpick][data-t=i]'); await wait(150); await p.fill('#np-q', 'hilton'); await wait(); await p.screenshot({ path: `shots/${tag}-picker.png` });
    log('picker rows:', await p.locator('#np-list .pick').count()); await p.keyboard.press('Enter'); await wait(); log('toast:', (await toastTxt()).replace(/\s+/g, ' ').slice(0, 120));
    // views
    await p.click('[data-act=viewsmenu]'); await wait(); await p.click('[data-act=applyview] >> nth=0'); await wait(); log('view:', (await p.locator('#views .fw').textContent()).trim(), '| rows:', await rc(), '| url:', p.url().split('?')[1]); await p.click('[data-act=clearf]'); await wait();
    // open a non-#2341 row → toast; sticky primary
    if (!D) log('phoneact visible:', await p.locator('#phoneact').isVisible());
    await kind('q'); await wait(); await p.click('#strip [data-k=all]'); await p.fill('#q', 'Wedding'); await wait(); await p.click(D ? '#tblwrap tr.row >> nth=0 >> td >> nth=2' : '#list .lrow >> nth=0 >> .grow'); await wait(); log('open toast:', await toastTxt()); await p.fill('#q', '');
    // empty state
    await p.fill('#q', 'zzzz'); await wait(); await p.screenshot({ path: `shots/${tag}-empty.png` }); log('empty:', (await p.locator(D ? '#tblwrap .empty' : '#list .empty').textContent()).replace(/\s+/g, ' ').trim()); await p.fill('#q', '');
    await p.close();
  };
  await run(1440, 900, 'desk'); await run(390, 844, 'phone');
  console.log('errors:', errs);
  await b.close();
})();
