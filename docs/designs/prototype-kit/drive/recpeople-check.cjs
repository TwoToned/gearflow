// Usage (from the recpeople dir): NODE_PATH=/opt/node-tools/node_modules node recpeople-check.cjs [file.html]
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const errs = [], fails = [];
  const file = 'file://' + process.cwd() + '/' + (process.argv[2] || 'recpeople-prototype.html');
  const run = async (w, h, tag) => {
    const ph = tag === 'phone';
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    p.on('pageerror', e => errs.push(tag + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(tag + ' console: ' + m.text()); });
    const ok = (c, m) => { if (!c) { fails.push(tag + ' FAIL ' + m); console.log(tag, 'FAIL', m); } else console.log(tag, 'ok  ', m); };
    const T = async s => ((await p.locator(s).first().textContent()) || '').replace(/\s+/g, ' ').trim();
    const W = ms => p.waitForTimeout(ms || 120);
    const shot = n => p.screenshot({ path: `shots/${tag}-${n}.png` });
    const toast = () => T('#toast');
    const undo = async () => { await p.click('#toast [data-act="undo"]'); await W(); };
    const rec = async k => { await p.click(`#swstrip [data-k="${k}"]`); await W(); };
    const tab = async k => { await p.click(`#tabs [data-k="${k}"]`); await W(); };
    const word = async k => { await p.click(`#pane [data-act=word][data-k="${k}"]`); await W(); };
    const pageMenu = async () => { await p.click(ph ? '.phonehead [data-act=pagemenu]' : '.rhead [data-act=pagemenu]'); await W(150); };
    const item = async t => { await p.locator('#layerbody [data-act]', { hasText: t }).first().click(); await W(150); };
    const hasItem = async t => (await p.locator('#layerbody [data-act], #layerbody a.item', { hasText: t }).count()) > 0;
    const rows = () => p.locator('#pane .rrow').count();
    const rowMenu = async n => { await p.locator('#pane .rrow .dots').nth(n).click(); await W(150); };
    const tick = async n => { await p.locator('#pane .rrow .cb').nth(n).click(); await W(); };
    const deep = async h => { await p.goto('about:blank'); await p.goto(file + h); await W(350); };
    const closeAll = async () => { await p.keyboard.press('Escape'); await W(80); };
    const primary = ph ? '#phoneprimary' : '#actions .btn-primary';
    const bulkBtn = t => p.locator('#bulk [data-act]', { hasText: t }).first();
    await p.goto(file); await W(500);
    // ================= CLIENT
    ok((await T('#titlerow h1')) === 'Hilton Sydney', 'client title');
    ok((await T('#titlerow')).includes('Active'), 'status dot-word: ' + (await T('#titlerow')));
    ok((await T('#phonesub')) === 'Venue · Priya Shah · 6 jobs', 'phone sub line: ' + (await T('#phonesub')));
    if (!ph) ok((await T('#metarow')).includes('priya.shah@hilton.example'), 'identity line has the primary contact');
    ok((await T('#tabs')).replace(/\s/g, '') === 'OverviewJobs6Quotes&invoices8Contacts3Files4History', 'tab strip: ' + (await T('#tabs')));
    ok((await T('#pane .hero1 h2')) === '$11,940 outstanding', 'outstanding is derived: ' + (await T('#pane .hero1 h2')));
    ok(await p.locator('#pane .todo li').count() === 2, 'two health rows (overdue invoice, quote expiring)');
    ok((await T('#pane .todo li')).includes('due 28 Nov') && !(await T('#pane')).includes('overdue'), 'calm row $11,940 due 28 Nov, nothing overdue');
    ok(await p.locator('.pill').count() === 0, 'no pills');
    ok(await p.locator('.btn-primary:visible').count() === 1 && (await T(primary)) === 'Edit', 'exactly one visible primary: Edit');
    ok((await p.locator('#rail').innerHTML()) === '', 'no rail on Overview');
    ok(await p.locator('#pane a.rrow[href="https://claude.ai/artifact/RatKsWfTmDJLJHmn6mb7Zo"]').count() === 2, 'open jobs link to Overview');
    ok(await p.locator('.crumb a[href="https://claude.ai/artifact/LPdsNGb4CRMfS6qk7j7Fsa"]').count() === 1 && (await T('.crumb')).includes('Clients›Hilton Sydney'.replace('›', ' › ').replace(/\s+/g, ' ')) || (await T('.crumb')).replace(/\s/g, '') === 'Clients›HiltonSydney', 'crumb links the People list: ' + (await T('.crumb')));
    await shot('client-overview');
    for (const k of ['jobs', 'money', 'contacts', 'files', 'history']) {
      await tab(k); ok(await p.locator('#pane').isVisible(), 'client tab ' + k); ok((await p.evaluate(() => location.hash)) === '#client/' + k, 'hash #client/' + k);
      ok(ph ? !(await p.locator('#rail').isVisible()) : await p.locator('#rail').isVisible(), 'rail ' + (ph ? 'hidden on phone' : 'visible') + ' on ' + k);
    }
    await tab('overview'); ok((await p.evaluate(() => location.hash)) === '#client', 'overview clears the tab hash');
    // overview todo navigates: Chase → Quotes & invoices, Overdue word
    await p.click('#pane .todo li >> nth=0'); await W(); ok((await T('#tabs .on')).startsWith('Quotes') && (await p.locator('#pane .rrow').count()) === 5, 'row opens Invoices (5 rows)');
    // ---- edit sheet
    await tab('overview'); await p.click(primary); await W(150);
    ok(await p.locator('.esheet').isVisible() && (await T('.esheet h2')) === 'Edit Hilton Sydney', 'Edit opens the client sheet');
    if (ph) ok((await p.locator('.esheet').boundingBox()).width >= 389, 'sheet is full width on phone');
    await shot('client-sheet');
    await p.fill('[data-f=name]', ''); await p.fill('[data-f=email]', 'nope'); await p.click('.esft [data-act=editgo]'); await W();
    ok((await p.locator('.errm').count()) === 2, 'inline validation: name + email');
    await p.fill('[data-f=name]', 'Hilton Sydney Hotel'); await p.fill('[data-f=email]', 'priya.shah@hilton.example'); await p.fill('[data-f=disc]', '120'); await p.click('.esft [data-act=editgo]'); await W();
    ok((await T('.errm')).includes('0 to 100'), 'inline validation: discount over 100');
    await p.fill('[data-f=disc]', '7'); await p.click('.esft [data-act=editgo]'); await W();
    ok((await T('#titlerow h1')) === 'Hilton Sydney Hotel' && (await toast()).includes('saved'), 'saved: ' + (await toast()));
    await undo(); ok((await T('#titlerow h1')) === 'Hilton Sydney', 'Undo restores the name');
    await p.click(primary); await W(); await p.fill('[data-f=abn]', 'X'); await p.click('.esft [data-act=close]'); await W();
    ok(await p.locator('.dlg').isVisible() && (await T('.dlg h2')).includes('Discard'), 'dirty cancel asks to discard');
    await p.click('.dlg [data-act=reopen]'); await W(); ok((await p.inputValue('[data-f=abn]')) === 'X', 'keep editing restores the draft'); await p.click('.esft [data-act=close]'); await p.click('.dlg [data-act=discard]'); await W();
    ok(!(await p.locator('.esheet').count()), 'discard closes the sheet');
    // ---- Jobs
    await tab('jobs'); ok((await rows()) === 6, 'jobs: 6 rows'); await word('open'); ok((await rows()) === 2, 'Open word: 2'); await word('done'); ok((await rows()) === 4, 'Completed word: 4'); await word('all');
    await tick(0); await tick(3); ok((await p.locator('#bulk.open').count()) === 1 && (await T('#bulk')).includes('2 selected') && (await T('#bulk')).includes('Copy 2 numbers'), 'bulk bar with counts in the verb: ' + (await T('#bulk')));
    if (ph) ok(!(await p.locator('#phoneact').isVisible()), 'bulk bar replaces the sticky primary on phone');
    await p.click('#bulk [data-act=clearsel]'); await W(); ok(!(await p.locator('#bulk.open').count()), 'clear selection');
    await tick(1); await p.locator('#pane .rrow .cb').nth(4).click({ modifiers: ['Shift'] }); await W(); ok((await T('#bulk')).includes('4 selected'), 'shift-click selects the range: ' + (await T('#bulk')));
    await p.click('#bulk [data-act=clearsel]'); await W();
    await rowMenu(0); ok(await hasItem('Equipment') && await hasItem('Finance'), 'jobs row ⋯: Open / Equipment / Finance'); await closeAll();
    // ---- Quotes & invoices
    await tab('money'); await word('all'); ok((await rows()) === 8, 'money: 8 rows'); ok((await T('#pane .subtools')).replace(/\s/g, '') === 'All8Quotes3Invoices5Overdue0', 'words with counts: ' + (await T('#pane .subtools')));
    await word('overdue'); ok((await rows()) === 0 && (await T('#pane .empty')).includes('Nothing in Overdue'), 'Overdue 0: empty state'); await word('invoice'); ok((await rows()) === 5, 'Invoices: 5');
    await tick(1); ok((await bulkBtn('reminder').count()) === 1, 'bulk: Send 1 reminder'); await bulkBtn('reminder').click(); await W(); ok((await toast()).includes('1 reminder sent'), 'reminder toast: ' + (await toast()));
    await rowMenu(1); await item('Record payment'); ok((await T('.dlg h2')).includes('INV-0042'), 'record payment dialog'); await p.click('.dlg [data-act=markpaidgo]'); await W();
    ok((await toast()).includes('marked paid'), 'toast: ' + (await toast()));
    await tab('overview'); ok((await T('#pane .hero1 h2')) === 'Nothing outstanding', 'outstanding recomputed: ' + (await T('#pane .hero1 h2')));
    await undo(); ok((await T('#pane .hero1 h2')) === '$11,940 outstanding', 'Undo restores outstanding');
    await tab('money'); await word('quote'); ok((await rows()) === 3, 'Quotes word: 3'); await word('all'); await shot('client-money');
    // ---- Contacts
    await tab('contacts'); ok((await rows()) === 3, 'contacts: 3'); await p.click('#pane .sh2 [data-act=contactadd]'); await W();
    await p.click('.dlg [data-act=contactgo]'); await W(); ok((await T('#c-err')) === 'Name is required', 'contact validation');
    await p.fill('#c-n', 'Ana Ruiz'); await p.fill('#c-e', 'ana@hilton.example'); await p.click('.dlg [data-act=contactgo]'); await W(); ok((await rows()) === 4 && (await toast()).includes('Ana Ruiz'), 'contact added: ' + (await toast()));
    await undo(); ok((await rows()) === 3, 'Undo removes the contact');
    await rowMenu(1); await item('Make primary'); ok((await p.locator('#pane .rrow >> nth=1').textContent()).includes('Primary'), 'make primary'); await undo();
    await tick(0); await tick(1); ok((await T('#bulk')).includes('Remove 1 of 2'), 'bulk remove skips the primary: ' + (await T('#bulk'))); await p.click('#bulk [data-act=bulkdel]'); await W(); ok((await T('.dlg')).includes('primary'), 'delete dialog names the primary rule'); await p.click('.dlg [data-act=rowdelgo]'); await W();
    ok((await rows()) === 2, 'removed 1, primary stayed'); await undo(); ok((await rows()) === 3, 'Undo restores contacts');
    // ---- Files
    await tab('files'); ok((await rows()) === 4, 'files: 4'); await p.click('#pane .sh2 [data-act=upload]'); await W(); await p.click('.dlg [data-act=uploadgo] >> nth=0'); await W(); ok((await rows()) === 5, 'file uploaded'); await undo(); ok((await rows()) === 4, 'Undo removes the upload');
    await tick(0); await tick(1); ok((await T('#bulk')).includes('Download 2') && (await T('#bulk')).includes('Remove 2'), 'files bulk: ' + (await T('#bulk'))); await p.click('#bulk [data-act=bulkdel]'); await W(); await p.click('.dlg [data-act=rowdelgo]'); await W(); ok((await rows()) === 2, 'bulk removed 2'); await undo();
    // ---- History
    await tab('history'); ok(await p.locator('#pane .gl').count() > 3, 'history is dated rows'); ok(await p.locator('#pane .cb').count() === 0, 'history has no checkboxes (Discussion rendering)');
    await p.click('#pane [data-act=histf][data-k=money]'); ok((await p.locator('#pane .hrow').count()) === 6, 'History › Money: 6 (incl. the reminder just sent)'); await p.click('#pane [data-act=histf][data-k=all]');
    ok((await p.locator('#pane .hrow').count()) === 8, 'first page 8'); await p.click('#pane [data-act=more]'); await W(); ok((await p.locator('#pane .hrow').count()) === 13, 'Show more → 13');
    await p.fill('#note', 'Priya confirmed the dock slot'); await p.keyboard.press('Enter'); await W(); ok((await T('#pane .hrow')).includes('Priya confirmed the dock slot') && (await toast()).includes('posted'), 'note posted'); await undo(); ok(!(await T('#pane')).includes('dock slot'), 'Undo removes the note');
    // ---- page menu: merge + archive
    await pageMenu(); ok(await hasItem('Edit client') && await hasItem('Merge into another client') && await hasItem('Sync with Xero') && await hasItem('Archive client'), 'client ⋯ items'); await shot('client-menu');
    await item('Merge into another client'); ok((await T('.dlg')).includes('6 jobs') && (await T('.dlg')).includes('8 quotes and invoices'), 'merge dialog names what moves');
    await p.selectOption('#m-to', 'Hilton Hotels Pty Ltd'); await p.click('.dlg [data-act=mergego]'); await W(); ok((await T('#banner')).includes('Merged into Hilton Hotels Pty Ltd') && (await T('#titlerow')).includes('Merged'), 'merged banner'); await undo(); ok(!(await T('#banner')), 'Undo un-merges');
    await pageMenu(); await item('Archive client'); ok((await T('.dlg')).includes('#2341') && (await T('.dlg')).includes('1 unpaid invoice ($11,940)'), 'archive dialog names downstream effects'); await p.click('.dlg [data-act=archivego]'); await W();
    ok((await T('#banner')).includes('Archived') && (await T('#titlerow')).includes('Archived'), 'archived banner'); await p.click('#banner [data-act=restore]'); await W(); ok(!(await T('#banner')), 'restore clears the banner');
    await tab('overview'); await p.click('#pane [data-act=xeromap]'); await W(); await p.click('.dlg [data-act=xeromapgo]'); await W(); ok((await toast()).includes('Mapped'), 'xero mapping'); await undo();
    await p.click('#pane [data-act=editnotes]'); await W(); await p.fill('#notes-t', 'New note text'); await p.click('.dlg [data-act=notesgo]'); await W(); ok((await T('#pane')).includes('New note text'), 'notes edited'); await undo();
    await shot('client-end');
    // ================= CREW
    await rec('crew');
    ok((await T('#titlerow h1')) === 'Dev Patel', 'crew title'); ok((await T('#phonesub')) === 'Rigger · Freelancer · $420/day', 'crew phone sub: ' + (await T('#phonesub')));
    ok((await T('#tabs')).replace(/\s/g, '') === 'OverviewCalls6Timesheets2/12Availability3Documents5History', 'crew tabs: ' + (await T('#tabs')));
    ok((await T('#pane .hero1 h2')) === '2 calls · 18 h', 'this week: ' + (await T('#pane .hero1 h2')));
    ok(await p.locator('#pane .todo li').count() === 3 && (await T('#pane .todo')).includes('expires in 12 days'), 'three derived rows incl. licence expires in 12 days');
    ok((await T('#pane .todo')).includes('Bump in not confirmed') && (await T('#pane .todo')).includes('2 timesheets awaiting approval'), 'unconfirmed + timesheets rows');
    ok(await p.locator('#pane a.rrow[href="https://claude.ai/artifact/E36tnBkGL9obdikUQ5mbXf"]').count() >= 3, 'calls link to Logistics');
    await shot('crew-overview');
    await p.click('#pane .todo li >> nth=0'); await W(); ok((await toast()).includes('Offer sent to Dev by SMS'), 'resend offer from the health row: ' + (await toast()));
    for (const k of ['calls', 'timesheets', 'availability', 'documents', 'history']) { await tab(k); ok(await p.locator('#pane').isVisible(), 'crew tab ' + k); }
    await tab('calls'); ok((await rows()) === 4 && (await T('#pane .subtools')).replace(/\s/g, '') === 'Upcoming4Past2All6', 'calls: Upcoming 4 · Past 2 · All 6'); await word('all'); ok((await rows()) === 6, 'All 6');
    await word('up'); await rowMenu(0); ok(await hasItem('Resend offer') && await hasItem('Mark confirmed') && await hasItem('Open in Logistics') && await hasItem('Remove from job'), 'call row ⋯'); await item('Mark confirmed'); ok((await T('#pane .rrow')).includes('Confirmed'), 'marked confirmed'); await undo(); ok((await T('#pane .rrow')).includes('Unconfirmed'), 'Undo back to unconfirmed');
    await tick(0); await tick(2); ok((await T('#bulk')).includes('Resend') && (await T('#bulk')).includes('Mark 1 confirmed'), 'calls bulk: ' + (await T('#bulk'))); await p.click('#bulk [data-act=clearsel]'); await W();
    await tab('timesheets'); ok((await rows()) === 8 && (await T('#pane .lpfoot')).includes('Show 4 more · 4 left'), 'timesheets page of 8, Show 4 more · 4 left'); await p.click('#pane [data-act=more]'); await W(); ok((await rows()) === 12, 'Show more → 12');
    await word('PENDING'); ok((await rows()) === 2, 'Pending word: 2'); await p.click('#pane .sh2 .cb'); await W(); ok((await T('#bulk')).includes('Approve 2'), 'select page → Approve 2'); await p.click('#bulk [data-act=bulk][data-v=approve]'); await W(); ok((await toast()).includes('2 timesheets approved'), 'approve toast: ' + (await toast())); ok((await rows()) === 0, 'approved rows leave Pending');
    await undo(); ok((await rows()) === 2, 'Undo restores pending'); await tab('overview'); await tab('timesheets');
    await word('all'); await rowMenu(0); await item('Dispute'); await p.fill('#d-r', 'Wrong break'); await p.click('.dlg [data-act=disputego]'); await W(); ok((await toast()).includes('disputed'), 'dispute'); await undo();
    await p.click('#pane .sh2 [data-act=logtime]'); await W(); await p.fill('#t-s', '16:00'); await p.fill('#t-e', '08:00'); await p.click('.dlg [data-act=timego]'); await W(); ok((await T('#t-err')).includes('End must be after start'), 'time validation');
    await p.fill('#t-s', '08:00'); await p.fill('#t-e', '12:00'); await p.click('.dlg [data-act=timego]'); await W(); ok((await rows()) === 8 && (await toast()).includes('pending approval'), 'time logged: ' + (await toast())); await undo();
    await shot('crew-timesheets');
    await tab('availability'); ok((await rows()) === 3, 'availability: 3'); await p.click('#pane .sh2 [data-act=availadd]'); await W(); await p.click('.dlg [data-act=availgo]'); await W(); ok((await rows()) === 4, 'block added'); await undo(); ok((await rows()) === 3, 'Undo removes block');
    await tick(0); await p.click('#bulk [data-act=bulkdel]'); await W(); ok((await T('.dlg')).includes('planner'), 'remove names planner effect'); await p.click('.dlg [data-act=rowdelgo]'); await W(); ok((await rows()) === 2, 'removed'); await undo();
    await tab('documents'); ok((await rows()) === 5 && (await T('#pane')).includes('expires in 12 days'), 'documents with expiry words'); await p.click('#pane .sh2 [data-act=upload]'); await W(); await p.click('.dlg [data-act=uploadgo] >> nth=0'); await W(); ok((await rows()) === 6, 'doc uploaded'); await undo();
    await rowMenu(0); await item('Change expiry'); await p.fill('#exp-d', '2027-11-21'); await p.click('.dlg [data-act=expirygo]'); await W(); ok(!(await T('#pane .rrow')).includes('expires in 12 days'), 'expiry changed'); await undo();
    await pageMenu(); ok(await hasItem('Message Dev') && await hasItem('Log time') && await hasItem('Calendar feed') && await hasItem('Make inactive') && await hasItem('Delete crew member') && await hasItem('Export timesheets'), 'crew ⋯ items'); await item('Message Dev'); await p.fill('#msg-t', 'Can you do 07:30?'); await p.click('.dlg [data-act=messagego]'); await W(); ok((await toast()).includes('Message sent'), 'message sent');
    await pageMenu(); await item('Calendar feed'); ok((await p.inputValue('#f-u')).includes('/api/crew/calendar/'), 'feed url'); await p.click('.dlg [data-act=feedtog]'); await W(); ok((await toast()).includes('tentative'), 'feed toggle'); await closeAll();
    await pageMenu(); await item('Make inactive'); ok((await T('.dlg')).includes('upcoming call'), 'inactive dialog names calls'); await p.click('.dlg [data-act=inactivego]'); await W(); ok((await T('#banner')).includes('Inactive'), 'inactive banner'); await undo(); ok(!(await T('#banner')), 'Undo reactivates');
    await pageMenu(); await item('Delete crew member'); ok((await T('.dlg')).includes('cannot be undone'), 'delete warns'); await closeAll();
    await tab('history'); ok((await p.locator('#pane .hrow').count()) >= 6, 'crew history rows');
    // edit sheet for crew
    await p.click(primary); await W(); ok((await T('.esheet h2')) === 'Edit Dev Patel', 'crew sheet'); await p.fill('[data-f=day]', '-1'); await p.click('.esft [data-act=editgo]'); await W(); ok((await T('.errm')).includes('0 or more'), 'crew rate validation'); await p.fill('[data-f=day]', '450'); await p.click('.esft [data-act=editgo]'); await W(); ok((await T('#phonesub')).includes('$450/day'), 'crew saved'); await undo();
    // ================= SUPPLIER
    await rec('supplier');
    ok((await T('#titlerow h1')) === 'Scene Change', 'supplier title'); ok((await T('#tabs')).replace(/\s/g, '') === 'OverviewOrders9Sub-hires4Assets2Contacts2Documents3History', 'supplier tabs: ' + (await T('#tabs')));
    ok((await T('#pane .hero1 h2')).startsWith('14 units on hire'), 'supplier hero: ' + (await T('#pane .hero1 h2'))); ok((await T('#pane .todo li >> nth=0')).includes('SH-0012 return 2d overdue'), 'SH-0012 return 2d overdue row');
    await shot('supplier-overview');
    await tab('orders'); ok((await rows()) === 9 && (await T('#pane .subtools')).replace(/\s/g, '') === 'All9Open2Overdue1', 'orders: All 9 · Open 2 · Overdue 1'); await word('late'); ok((await rows()) === 1, 'Overdue word: 1'); await word('all');
    await tick(0); await tick(1); ok((await T('#bulk')).includes('Delete 1 of 2') || (await T('#bulk')).includes('Delete 2'), 'orders bulk: ' + (await T('#bulk'))); await p.click('#bulk [data-act=clearsel]'); await W();
    await p.click('#pane [data-act=neworder]'); await W(); ok((await T('.esheet h2')) === 'New supplier order', 'new order sheet'); await p.fill('[data-f=num]', ''); await p.click('.esft [data-act=editgo]'); await W(); ok((await T('.errm')).includes('Order number is required'), 'order validation');
    await p.fill('[data-f=num]', 'SH-0014'); await p.fill('[data-f=odate]', '2026-11-09'); await p.fill('[data-f=edate]', '2026-11-01'); await p.click('.esft [data-act=editgo]'); await W(); ok((await T('.errm')).includes('Expected date cannot be before'), 'date order validation'); await p.fill('[data-f=edate]', '2026-11-20'); await p.click('.esft [data-act=editgo]'); await W();
    ok((await rows()) === 10 && (await toast()).includes('SH-0014 created'), 'order created: ' + (await toast())); await undo(); ok((await rows()) === 9, 'Undo removes the order');
    await p.locator('#pane .rrow >> nth=1').click({ position: { x: 150, y: 20 } }); await W(); ok((await T('#titlerow h1')) === 'SH-0012', 'whole-row click opens the order'); ok((await p.evaluate(() => location.hash)) === '#order/SH-0012', 'hash #order/SH-0012');
    await rec('supplier'); await tab('subhires'); ok((await rows()) === 4 && !(await T('#pane')).includes('Margin') && !(await T('#pane .rt')).includes('%'), 'sub-hires: cost and margin hidden by default'); await p.click('#pane [data-act=cost]'); await W(); ok((await T('#pane .rrow')).includes('%'), 'cost & margin opt-in'); await p.click('#pane [data-act=cost]');
    await tab('assets'); ok((await rows()) === 2, 'assets: 2'); await tab('contacts'); ok((await rows()) === 2, 'supplier contacts: 2'); await tab('documents'); ok((await rows()) === 3, 'supplier docs: 3');
    await pageMenu(); ok(await hasItem('New order') && await hasItem('Archive supplier') && await hasItem('Delete supplier'), 'supplier ⋯ items'); await item('Archive supplier'); ok((await T('.dlg')).includes('SH-0012') && (await T('.dlg')).includes('14 units'), 'archive dialog names SH-0012'); await p.click('.dlg [data-act=archivego]'); await W(); ok((await T('#banner')).includes('Archived'), 'supplier archived'); await undo();
    await pageMenu(); await item('Delete supplier'); ok((await T('.dlg')).includes('cannot be deleted'), 'delete gated while orders exist'); await closeAll();
    await tab('history'); ok((await p.locator('#pane .hrow').count()) >= 5, 'supplier history');
    // ================= ORDER
    await rec('order');
    ok((await T('#titlerow h1')) === 'SH-0012' && (await T('#titlerow')).includes('On hire'), 'order title + On hire'); ok((await T('#tabs')).replace(/\s/g, '') === 'OverviewLines4Files2History', 'order tabs: ' + (await T('#tabs')));
    ok((await T('#pane .todo')).includes('Return 2d overdue') && (await T('#pane .todo')).includes('Supplier invoice not attached'), 'overdue + invoice rows'); ok((await T('#pane')).includes('PO-0412'), 'PO ref'); ok(await p.locator('#pane a[href="https://claude.ai/artifact/BdwR4bNbiNMLSvfRAByEwC"]').count() >= 1, 'link to #2341 Equipment');
    ok((await T('.crumb')).replace(/\s/g, '') === 'Suppliers›SceneChange›SH-0012', 'order crumb: ' + (await T('.crumb')));
    await shot('order-overview');
    await p.click('#pane .todo li >> nth=0'); await W(); ok((await T('.dlg h2')).includes('Extend hire')); ok((await p.inputValue('#x-d')) === '2026-11-15', 'extend defaults to 15 Nov'); await p.click('.dlg [data-act=extendgo]'); await W();
    ok(!(await T('#pane .todo')).includes('overdue') && (await toast()).includes('no longer overdue'), 'extended: ' + (await toast())); await undo(); ok((await T('#pane .todo')).includes('Return 2d overdue'), 'Undo restores the overdue row');
    await p.click('#pane .todo li >> nth=1'); await W(); await p.click('.dlg [data-act=uploadgo]'); await W(); ok((await T('#pane .todo')).includes('Supplier invoice') === false && (await toast()).includes('supplier invoice'), 'invoice attached: ' + (await toast())); await undo();
    await tab('lines'); ok((await rows()) === 4 && (await T('#pane .tot')).includes('$5,258'), 'lines: 4, total $5,258'); await p.click('#pane .sh2 [data-act=lineadd]'); await W(); await p.click('.dlg [data-act=linego]'); await W(); ok((await T('#l-err')).includes('Description'), 'line validation');
    await p.fill('#l-d', 'Handrail 1 m'); await p.fill('#l-q', '2'); await p.fill('#l-u', '100'); await p.click('.dlg [data-act=linego]'); await W(); ok((await rows()) === 5 && (await T('#pane .tot')).includes('$5,478'), 'line added, total recalculated: ' + (await T('#pane .tot'))); await undo(); ok((await rows()) === 4, 'Undo removes the line');
    await tick(0); await p.click('#bulk [data-act=bulkdel]'); await W(); await p.click('.dlg [data-act=rowdelgo]'); await W(); ok((await rows()) === 3, 'line removed'); await undo();
    await tab('files'); ok((await rows()) === 2, 'order files: 2'); await tab('history'); ok((await p.locator('#pane .hrow').count()) === 4, 'order history');
    await pageMenu(); ok(await hasItem('Extend hire') && await hasItem('Mark returned') && await hasItem('Attach supplier invoice') && await hasItem('Duplicate order') && await hasItem('Delete order'), 'order ⋯ items'); await item('Mark returned'); await p.click('.dlg [data-act=markretgo]'); await W(); ok((await T('#titlerow')).includes('Returned'), 'marked returned'); await undo();
    await pageMenu(); await item('Duplicate order'); ok((await toast()).includes('SH-0014'), 'duplicate: ' + (await toast())); await undo();
    await pageMenu(); await item('Delete order'); ok((await T('.dlg')).includes('still on hire'), 'delete blocked while on hire'); await closeAll();
    await p.click(primary); await W(); ok((await T('.esheet h2')) === 'Edit SH-0012', 'order sheet'); ok(await p.locator('[data-f=rdue]').count() === 1, 'return due field for sub-hire'); await p.selectOption('[data-f=type]', 'PURCHASE'); await W(); ok(await p.locator('[data-f=rdue]').count() === 0, 'return due hides for a purchase'); await p.click('.esft [data-act=close]'); await p.click('.dlg [data-act=discard]'); await W();
    // ---- hash deep link + phone
    await deep('#supplier/orders'); ok((await T('#titlerow h1')) === 'Scene Change' && (await T('#tabs .on')).startsWith('Orders'), 'deep link #supplier/orders');
    await deep('#order/SH-0013/lines'); ok((await T('#titlerow h1')) === 'SH-0013' && (await rows()) === 3, 'deep link #order/SH-0013/lines');
    await deep('?edit=1#crew'); ok(await p.locator('.esheet').isVisible(), '?edit=1 opens the sheet');
    if (ph) {
      await deep('#client'); await p.click('.phonehead [data-act=pagemenu]'); await W(150); ok((await p.locator('#layerbody .sheetwrap').count()) === 1, 'phone ⋯ is a bottom sheet'); const it = await p.locator('#layerbody button.item').first().boundingBox(); ok(it && it.height >= 44, 'phone menu items ≥ 44 px: ' + (it && it.height)); await closeAll();
      await tab('jobs'); const row = await p.locator('#pane .rrow').first().boundingBox(); ok(row.height >= 56 && row.height <= 100, 'phone card height ' + row.height); const cb = await p.locator('#pane .rrow .cb').first().boundingBox(); ok(cb.width >= 22, 'phone checkbox 22 px'); const d = await p.locator('#pane .rrow .dots').first().boundingBox(); ok(d.width >= 40 && (await p.locator('#pane .rrow .dots').first().evaluate(e => getComputedStyle(e).opacity)) === '1', 'row ⋯ always visible, 40 px');
      ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal page scroll');
      ok(await p.locator('#phoneact').isVisible() && (await T('#phoneprimary')) === 'Edit', 'sticky primary Edit'); await p.click('#phoneprimary'); await W(); ok(await p.locator('.esheet').isVisible(), 'sticky primary opens the sheet'); const fs = await p.locator('.esheet input[data-f]').first().evaluate(e => getComputedStyle(e).fontSize); ok(fs === '16px', 'inputs 16 px'); await closeAll(); await p.keyboard.press('Escape'); await W();
      await deep('#supplier/orders'); await p.locator('#pane .rrow').nth(1).click({ position: { x: 120, y: 18 } }); await W(); ok((await T('#titlerow h1')) === 'SH-0012' || (await T('.phonehead .ell')) === 'SH-0012', 'phone card tap opens the order');
      await shot('phone-order');
    }
    await shot('end'); await p.close();
  };
  await run(1440, 900, 'desk'); await run(390, 844, 'phone');
  if (fails.length) console.log('FAILS', fails.length, fails.slice(0, 12));
  console.log('errors:', JSON.stringify(errs)); await b.close();
})();
