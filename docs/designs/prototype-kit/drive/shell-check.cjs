// Usage (from this directory): node shell-check.cjs [file.html]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const errs = [];
  const run = async (w, h, tag) => {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    p.on('pageerror', e => errs.push(tag + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(tag + ' console: ' + m.text()); });
    await p.goto('file://' + process.cwd() + '/' + (process.argv[2] || 'shell-prototype.html')); await p.waitForTimeout(500);
    await p.evaluate(() => { window.__nav = null; document.addEventListener('click', e => { const a = e.target.closest('a[href]'); if (a && !a.getAttribute('href').startsWith('#')) { window.__nav = a.getAttribute('href'); e.preventDefault(); } }, true); });
    const D = tag === 'desk', log = s => console.log(tag, s), T = async s => (await p.locator(s).allTextContents()).map(x => x.replace(/\s+/g, ' ').trim());
    const nav = async () => { const n = await p.evaluate(() => window.__nav); await p.evaluate(() => { window.__nav = null; }); return n; };
    const short = u => u ? u.replace('https://claude.ai/artifact/', '').slice(0, 6) : u;
    const toastTxt = async () => (await p.locator('#toast').textContent()).replace(/\s+/g, ' ').trim().replace(/Undo.*$/, '').replace(/✕/g, '').trim();
    const setpage = async v => { await p.click(`[data-act=setpage][data-v=${v}]`); await p.waitForTimeout(120); };
    const closeAll = async () => { await p.keyboard.press('Escape'); await p.waitForTimeout(80); };
    const layerOpen = async () => p.evaluate(() => document.getElementById('layer').classList.contains('open'));
    const shot = n => p.screenshot({ path: `shots/${tag}-${n}.png` });

    // ---------- the frame
    await log('title: ' + (await p.title()) + ' | crumb: ' + (await T('.crumb'))[0]);
    if (D) {
      const sb = await p.locator('.sidebar').boundingBox(); await log('sidebar width: ' + Math.round(sb.width));
      await log('nav labels: ' + (await T('.sbscroll .ni:visible .lbl')).join(' | '));
      await log('nav groups: ' + await p.locator('.sbscroll .ngrp').count() + ' (third has overline "' + (await T('.ngrp.more .ov'))[0] + '") · active: ' + (await T('.ni.on')).join(','));
      await log('footer: ' + (await T('.sbfoot .ni .lbl')).join(',') + ' · user: ' + (await T('.userrow .who b'))[0] + ' / ' + (await T('.userrow .who span'))[0]);
      const hrefs = await p.locator('.sbscroll a.ni').evaluateAll(a => a.map(x => x.textContent.trim() + '→' + x.getAttribute('href').replace('https://claude.ai/artifact/', '').slice(0, 5)));
      await log('nav hrefs: ' + hrefs.join(' '));
      // every page: crumb + active module + accordion
      for (const v of ['job', 'asset', 'crew', 'settings', 'home']) {
        await setpage(v);
        await log(`page ${v}: crumb "${(await T('.crumb'))[0]}" · crumb links ${await p.locator('.crumb a').count()} (${(await p.locator('.crumb a').evaluateAll(a => a.map(x => x.getAttribute('href').replace('https://claude.ai/artifact/', '').slice(0, 5)))).join(',')}) · active ${(await T('.ni.on')).join('/')} · open subs ${(await T('.ng.open .si')).join(',') || '—'} · active sub ${(await T('.si.on')).join(',') || '—'}`);
        if (v === 'job') await shot('job');
      }
      // sub-toggle
      await p.hover('.ng[data-k=crew]'); await p.click('.ng[data-k=crew] .subt'); await p.waitForTimeout(80);
      await log('crew subs after toggle: ' + (await T('.ng[data-k=crew] .si')).join(',') + ' · open ' + await p.locator('.ng[data-k=crew].open').count());
      await p.click('.ng[data-k=crew] .subt'); await log('after 2nd toggle open: ' + await p.locator('.ng[data-k=crew].open').count());
      // rail
      await p.click('[data-act=collapse]'); await p.waitForTimeout(250);
      let sb2 = await p.locator('.sidebar').boundingBox(); await log('collapsed → rail width ' + Math.round(sb2.width) + ' · labels ' + (await T('.app.rl .sbscroll .ni:visible .lbl')).join('|') + ' · org ' + (await T('.orgrow .oi'))[0]);
      await p.screenshot({ path: 'shots/desk-rail.png' });
      await p.click('.ng[data-k=assets] .ni'); await p.waitForTimeout(120);
      await log('rail flyout (assets): ' + (await T('.pop .mrow')).join(' | ') + ' · nav ' + await nav()); await shot('flyout'); await closeAll();
      await p.click('.ni[data-act=fly][data-k=more]'); await log('rail More flyout: ' + (await T('.pop .mrow')).join(' | ')); await closeAll();
      await p.click('.ng[data-k=home] .ni'); await log('rail plain item nav: ' + short(await nav()));
      await p.keyboard.press('Control+b'); await p.waitForTimeout(250);
      sb2 = await p.locator('.sidebar').boundingBox(); await log('⌘B expands → width ' + Math.round(sb2.width));
      await p.keyboard.press('Control+b'); await p.waitForTimeout(250); await log('⌘B again → rail ' + Math.round((await p.locator('.sidebar').boundingBox()).width));
      await p.keyboard.press('Control+b'); await p.waitForTimeout(250);
      await p.setViewportSize({ width: 1000, height: 768 }); await p.waitForTimeout(350);
      await log('viewport 1000 → auto rail ' + Math.round((await p.locator('.sidebar').boundingBox()).width) + ' · collapse control present: ' + await p.locator('[data-act=collapse]').count()); await shot('auto-rail');
      await p.setViewportSize({ width: 1440, height: 900 }); await p.waitForTimeout(350);
      await log('back at 1440 → ' + Math.round((await p.locator('.sidebar').boundingBox()).width));
      // org + user menus
      await p.click('.orgrow'); await p.waitForTimeout(100); await log('org menu: ' + (await T('.pop .mrow')).join(' | ')); await shot('orgmenu');
      await p.click('.pop [data-act=orgswitch][data-id=hs]'); await p.waitForTimeout(150);
      await log('after switch: org ' + (await T('.orgrow .ot'))[0] + ' · toast "' + await toastTxt() + '" · nav ' + (await T('.sbscroll .ni:visible .lbl')).join(',') + ' · settings ' + await p.locator('.sbfoot a.ni').count() + ' · role ' + (await T('.userrow .who span'))[0] + ' · New job ' + await p.locator('#pghead [data-act=new]').count());
      await p.click('[data-act=undo]'); await p.waitForTimeout(120); await log('undo → org ' + (await T('.orgrow .ot'))[0] + ' · settings ' + await p.locator('.sbfoot a.ni').count());
      await p.click('.userrow'); await p.waitForTimeout(100); await log('user menu: ' + (await T('.pop .mrow, .pop .thw')).join(' | ')); await shot('usermenu');
      await p.click('.pop [data-act=theme][data-v=light]'); await p.waitForTimeout(100); await log('theme: ' + await p.evaluate(() => document.documentElement.dataset.theme)); await shot('light');
      await p.click('.userrow'); await p.click('.pop [data-act=theme][data-v=dark]'); await log('theme back: ' + await p.evaluate(() => document.documentElement.dataset.theme));
      await p.click('.userrow'); await p.click('.pop [data-act=shortcuts]'); await log('shortcuts dialog rows: ' + await p.locator('.dlg .kbd').count()); await closeAll();
      await p.click('.userrow'); await p.click('.pop [data-act=signout]'); await log('sign out toast: ' + await toastTxt());
      await p.click('.userrow'); await p.click('.pop a.mrow >> nth=0'); await log('account settings nav: ' + short(await nav()));
      // personas (permission gates)
      for (const v of ['sam', 'viewer', 'jayden']) {
        await p.click(`[data-act=setpersona][data-v=${v}]`); await p.waitForTimeout(100);
        await log(`persona ${v}: nav ${(await T('.sbscroll .ni:visible .lbl')).join(',')} · settings ${await p.locator('.sbfoot a.ni').count()} · New job ${await p.locator('#pghead [data-act=new]').count()} · needs-me rows ${await p.locator('.hrow').count()} · greeting ${(await T('#h1'))[0]}`);
      }
    }

    // ---------- ⌘K palette
    const open = async () => { if (D) await p.click('.tsearch'); else await p.click('.phonehead [data-act=palette]'); await p.waitForTimeout(120); };
    const rowsTxt = async () => T('#pres .pr');
    await open();
    await log('palette empty: groups ' + (await T('#pres .pg')).join(' | ') + ' · recent rows ' + (await rowsTxt()).slice(0, 5).map(x => x.slice(0, 22)).join(' / '));
    await shot('palette');
    await p.fill('#pq', '2341'); await p.waitForTimeout(80); await log('"2341": ' + (await T('#pres .pg')).join('|') + ' · first: ' + (await rowsTxt())[0]);
    if (D) { await p.keyboard.press('Enter'); await log('Enter opens: ' + short(await nav()) + ' · layer open ' + await layerOpen()); await open(); }
    await p.fill('#pq', 'aura'); await p.waitForTimeout(80); await log('"aura": groups ' + (await T('#pres .pg')).join(' | ') + ' · rows ' + (await rowsTxt()).length);
    if (D) { await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await log('arrow ×2 → active index ' + await p.locator('#pres .pr.on').getAttribute('data-i') + ' (' + (await T('#pres .pr.on'))[0].slice(0, 30) + ')'); await p.keyboard.press('ArrowUp'); await log('arrow up → ' + await p.locator('#pres .pr.on').getAttribute('data-i')); }
    await p.fill('#pq', 'hilton'); await p.waitForTimeout(80); await log('"hilton": groups ' + (await T('#pres .pg')).join(' | '));
    await p.fill('#pq', 'priya'); await p.waitForTimeout(80); await log('"priya": ' + (await rowsTxt()).join(' | '));
    await p.fill('#pq', 'aura 01'); await p.waitForTimeout(80); await log('"aura 01": first ' + (await rowsTxt())[0]);
    await p.fill('#pq', '14/11'); await p.waitForTimeout(80); await log('date "14/11": ' + (await T('#pres .pg')).join(' | ') + ' · ' + (await rowsTxt()).join(' / ').slice(0, 120));
    await p.fill('#pq', '14 nov'); await p.waitForTimeout(80); await log('date "14 nov": jobs ' + await p.locator('#pres .pr').count());
    await p.fill('#pq', '@sched'); await p.waitForTimeout(80); await log('@sched: ' + (await rowsTxt()).join(' | '));
    await p.fill('#pq', '@'); await p.waitForTimeout(80); await log('@ pages: ' + await p.locator('#pres .pr').count() + ' rows (sample: ' + (await rowsTxt()).slice(0, 4).join(' / ') + ')');
    await p.fill('#pq', '/'); await p.waitForTimeout(80); await log('/ actions: ' + (await T('#pres .pg')).join(' | ') + ' · ' + await p.locator('#pres .pr').count() + ' rows');
    await p.fill('#pq', '/new'); await p.waitForTimeout(80); await log('/new: ' + (await rowsTxt()).join(' | '));
    await p.fill('#pq', 'zzzz'); await p.waitForTimeout(80); await log('no match: ' + (await T('#pres .none'))[0]); await shot('palette-none');
    await p.fill('#pq', 'qantas'); await p.waitForTimeout(80);
    await p.click('#pres .pr >> nth=0'); await p.waitForTimeout(100); await log('click row nav: ' + short(await nav()) + ' · closed ' + !(await layerOpen()));
    await open(); await log('recent after open: ' + (await rowsTxt())[0].slice(0, 28)); await closeAll(); await log('Esc closes palette: ' + !(await layerOpen()));
    if (D) {
      await p.keyboard.press('Control+k'); await p.waitForTimeout(100); await log('⌘K opens: ' + await p.locator('.pal').count()); await p.keyboard.press('Control+k'); await p.waitForTimeout(100); await log('⌘K again closes: ' + await p.locator('.pal').count());
      await p.keyboard.press('/'); await p.waitForTimeout(100); await log('"/" key opens actions: input="' + await p.inputValue('#pq') + '"'); await closeAll();
      await p.keyboard.press('?'); await p.waitForTimeout(100); await log('"?" opens shortcuts: ' + await p.locator('.dlg').count()); await closeAll();
      await p.keyboard.press('n'); await p.waitForTimeout(80); await log('"n" → New job: ' + short(await nav()));
      await setpage('job'); await open(); await log('palette on a job: ' + (await T('#pres .pg')).join(' | ')); await closeAll(); await setpage('home');
    } else {
      await p.click('.phonehead [data-act=palette]'); await p.click('.pmodes [data-act=palseed][data-v="@"]'); await log('phone @ chip → input "' + await p.inputValue('#pq') + '" rows ' + await p.locator('#pres .pr').count()); await p.click('.pmodes [data-act=palseed][data-v="/"]'); await log('phone / chip → ' + await p.inputValue('#pq'));
      await p.click('.pal .cancel'); await log('Cancel closes: ' + !(await layerOpen()));
    }

    // ---------- Mira
    if (D) await p.click('.tbtn[data-act=mira]'); else await p.click('.phonehead [data-act=mira]');
    await p.waitForTimeout(150);
    await log('mira open: ' + await p.locator('#mira.open').count() + ' · messages ' + await p.locator('#mira .mm').count() + ' · card "' + (await T('.mcard h4'))[0] + '" · buttons ' + (await T('.mcard .acts button')).join(','));
    await shot('mira');
    await p.fill('#mi', 'thanks'); await p.keyboard.press('Enter'); await p.waitForTimeout(80); await log('send: messages ' + await p.locator('#mira .mm').count());
    await p.click('[data-act=miraconfirm]'); await p.waitForTimeout(100);
    await log('Confirm → card: ' + (await T('.mcard'))[0].slice(0, 70) + ' · toast "' + await toastTxt() + '"'); await shot('mira-done');
    await p.click('[data-act=undo]'); await p.waitForTimeout(100); await log('Undo → card back: ' + (await T('.mcard h4'))[0] + ' · confirm btn ' + await p.locator('[data-act=miraconfirm]').count());
    await p.click('[data-act=miradismiss]'); await log('Dismiss → ' + (await T('.mcard'))[0]);
    await p.click('#mira [data-act=miramenu]'); await log('mira menu: ' + (await T('.pop .mrow, .pop .wd')).join(' | '));
    await p.click('.pop [data-act=mira_new]'); await p.waitForTimeout(100); await log('New chat → card ' + (await T('.mcard h4'))[0] + ' · toast "' + await toastTxt() + '"');
    await p.click('#mira [data-act=miramenu]'); await p.click('.pop [data-act=miraperm][data-v="0"]'); await p.waitForTimeout(100); await log('write off → card: ' + (await T('.mcard'))[0].slice(0, 60) + ' · confirm btn ' + await p.locator('[data-act=miraconfirm]').count()); await shot('mira-readonly');
    await p.click('#mira [data-act=miramenu]'); await p.click('.pop [data-act=miraperm][data-v="1"]');
    if (D) { await p.keyboard.press('Escape'); await p.waitForTimeout(100); await log('Esc closes Mira: ' + (await p.locator('#mira.open').count() === 0)); } else { await p.click('#mira [data-act=mira]'); await p.waitForTimeout(100); await log('close ✕: ' + (await p.locator('#mira.open').count() === 0)); }

    // ---------- bell
    await p.click(D ? '.tbtn[data-act=bell]' : '.phonehead [data-act=bell]'); await p.waitForTimeout(120);
    await log('bell: header ' + (await T('.pop .ph'))[0] + ' · rows ' + await p.locator('.pop .nrow').count() + ' · unread ' + await p.locator('.pop .nrow:not(.rd)').count() + ' · groups ' + (await T('.pop .ndate')).join(','));
    await shot('bell');
    await p.click('.pop .nrow >> nth=2'); await p.waitForTimeout(100); await log('open row → nav ' + short(await nav()) + ' · count now ' + (await T(D ? '.tbtn[data-act=bell] .cnt' : '.phonehead [data-act=bell] .cnt'))[0]);
    await p.click(D ? '.tbtn[data-act=bell]' : '.phonehead [data-act=bell]'); await p.click('.pop [data-act=nmarkall]'); await p.waitForTimeout(100);
    await log('mark all read: count ' + (await T(D ? '.tbtn[data-act=bell] .cnt' : '.phonehead [data-act=bell] .cnt'))[0] + ' · toast "' + await toastTxt() + '"');
    await p.click('[data-act=undo]'); await p.waitForTimeout(100); await log('undo → count ' + (await T(D ? '.tbtn[data-act=bell] .cnt' : '.phonehead [data-act=bell] .cnt'))[0]);
    await p.click(D ? '.tbtn[data-act=bell]' : '.phonehead [data-act=bell]'); await p.click('.pop [data-act=nmarkall]'); await p.click(D ? '.tbtn[data-act=bell]' : '.phonehead [data-act=bell]'); await log('empty-ish: header ' + (await T('.pop .ph'))[0] + ' · mark-all link ' + await p.locator('.pop [data-act=nmarkall]').count() + ' · All notifications → ' + short(await p.locator('.pop .pf a').getAttribute('href'))); await closeAll();
    await p.click('[data-act=undo]').catch(() => {});

    // ---------- page menu
    await p.click(D ? '#pghead [data-act=pagemenu]' : '.phonehead [data-act=pagemenu]'); await p.waitForTimeout(100); await log('page ⋯: ' + (await T('.menu .item, .menu a, .sheetwrap a, .sheetwrap button')).join(' | ')); await closeAll();

    // ---------- phone: bottom nav, scan, More
    if (!D) {
      const bn = await p.locator('.bottomnav > *').evaluateAll(a => a.map(x => x.textContent.trim() + (x.classList.contains('on') ? '*' : '')));
      await log('bottom nav: ' + bn.join(' · ') + ' · bar height ' + Math.round((await p.locator('.bottomnav').boundingBox()).height));
      const sc = await p.locator('.bottomnav .scan').boundingBox(), bar = await p.locator('.bottomnav').boundingBox();
      await log(`scan circle ${Math.round(sc.width)}px, raised ${Math.round(bar.y - sc.y)}px above the bar, centred ${Math.round(sc.x + sc.width / 2)} of 390`);
      const prim = await p.locator('.phoneact .btn-primary').boundingBox(); await log('sticky primary: ' + (await T('.phoneact'))[0] + ' · h ' + Math.round(prim.height) + ' · clear of scan: ' + (prim.y + prim.height <= sc.y + 1 ? 'bottom ' + Math.round(prim.y + prim.height) + ' vs scan top ' + Math.round(sc.y) : 'OVERLAP'));
      await log('bottom nav hrefs: ' + (await p.locator('.bottomnav a').evaluateAll(a => a.map(x => x.getAttribute('href').replace('https://claude.ai/artifact/', '').slice(0, 5)))).join(' '));
      await p.click('.bottomnav .scanb'); await p.waitForTimeout(150); await log('scan → camera sheet: ' + await p.locator('.camv').count() + ' · samples ' + (await T('.samp')).join(',') + ' · nav ' + (await nav())); await shot('camera');
      await p.click('.samp[data-tag="AURA-01"]'); await log('read AURA-01: ' + (await T('#camres'))[0]);
      await p.click('.samp[data-tag="XX-999"]'); await log('read XX-999: ' + (await T('#camres'))[0]);
      await p.click('.dlg [data-act=close]'); await log('Done closes: ' + !(await layerOpen()));
      await p.click('.bottomnav [data-act=more]'); await p.waitForTimeout(150);
      const groups = await T('.moresheet .gh'); const items = await p.locator('.moresheet .mi').count();
      await log('More sheet: groups ' + groups.join(' | ') + ' · ' + items + ' rows · user "' + (await T('.moresheet .mu .who'))[0] + '"');
      await log('More rows: ' + (await T('.moresheet .mi')).join(' | '));
      const rh = await p.locator('.moresheet .mi >> nth=0').boundingBox(); await log('row height ' + Math.round(rh.height));
      await shot('more');
      await p.click('.moresheet [data-act=moredrill][data-k=crew]'); await p.waitForTimeout(100); await log('drill Crew: ' + (await T('.moresheet .mi')).join(' | ')); await shot('more-drill');
      await p.click('.moresheet [data-act=moreback]'); await log('back → rows ' + await p.locator('.moresheet .mi').count());
      await p.click('.moresheet [data-act=moredrill][data-k=assets]'); await log('drill Assets: ' + (await T('.moresheet .mi')).join(' | ')); await p.click('.moresheet [data-act=moreback]');
      await p.click('.moresheet [data-act=moredrill][data-k=tt]'); await log('drill T&T: ' + (await T('.moresheet .mi')).join(' | ')); await p.click('.moresheet [data-act=moreback]');
      await p.click('.moresheet .mu'); await p.waitForTimeout(100); await log('user row → menu: ' + (await T('.pop .mrow, .pop .thw')).join(' | '));
      await p.click('.pop [data-act=theme][data-v=light]'); await p.waitForTimeout(80); await log('phone theme: ' + await p.evaluate(() => document.documentElement.dataset.theme)); await shot('light');
      await p.click('.bottomnav [data-act=more]'); await p.click('.moresheet .mu'); await p.click('.pop [data-act=theme][data-v=dark]'); await p.waitForTimeout(80);
      await p.click('.bottomnav [data-act=more]'); await p.waitForTimeout(80);
      await p.mouse.click(195, 20); await p.waitForTimeout(80); await log('scrim closes More: ' + !(await layerOpen()));
      await p.click('.bottomnav [data-act=more]'); await p.click('.moresheet .mi >> nth=0'); await log('Schedule row nav: ' + (await nav()));
      // pages: back chevron + More active
      for (const v of ['job', 'asset', 'crew', 'settings']) { await setpage(v); await log(`phone ${v}: header "${(await T('.phonehead .pt'))[0]}" · back ${await p.locator('.phonehead .back').count() ? short(await p.locator('.phonehead .back').getAttribute('href')) : '—'} · active tab ${(await p.locator('.bottomnav .on').evaluateAll(a => a.map(x => x.textContent.trim()))).join(',')} · sticky ${await p.locator('.phoneact .btn').count()}`); if (v === 'job') await shot('job'); }
      await setpage('home');
      // alternative bottom nav
      await p.click('[data-act=setbnav][data-v=alt]'); await p.waitForTimeout(100);
      const bn2 = await p.locator('.bottomnav > *').evaluateAll(a => a.map(x => x.textContent.trim())); const fab = await p.locator('#fab').boundingBox(); const pa = await p.locator('.phoneact .btn-primary').boundingBox();
      await log('alternative: ' + bn2.join(' · ') + ' · floating Scan at ' + Math.round(fab.x) + ',' + Math.round(fab.y) + ' ' + Math.round(fab.width) + 'px · covers the sticky primary: ' + (fab.y < pa.y + pa.height && fab.y + fab.height > pa.y && fab.x + fab.width > pa.x ? 'YES' : 'no')); await shot('alt');
      await p.click('#fab'); await log('floating scan opens camera: ' + await p.locator('.camv').count()); await closeAll();
      await p.click('[data-act=setbnav][data-v=d1]');
      // personas on phone
      for (const v of ['sam', 'viewer', 'jayden']) { await p.click(`[data-act=setpersona][data-v=${v}]`); await log(`phone persona ${v}: bar ${(await p.locator('.bottomnav > *').evaluateAll(a => a.map(x => x.textContent.trim()))).join(' · ')} · sticky primary ${await p.locator('.phoneact:visible .btn').count()}`); }
      await p.click('[data-act=setpersona][data-v=viewer]'); await p.click('.bottomnav [data-act=more]'); await log('viewer More rows: ' + (await T('.moresheet .mi')).join(' | ')); await closeAll(); await p.click('[data-act=setpersona][data-v=jayden]');
    }
    // generic: no horizontal overflow, no console errors
    await log('horizontal overflow: ' + await p.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.querySelector('.content').scrollWidth > document.querySelector('.content').clientWidth));
    await log('red things on the page (primary excluded): ' + await p.evaluate(() => [...document.querySelectorAll('.sidebar *, .topbar *')].filter(e => { const c = getComputedStyle(e); return /224, 54, 61|214, 50, 58/.test(c.color + c.backgroundColor) && !e.closest('.brand'); }).length));
    await p.close();
  };
  await run(1440, 900, 'desk'); await run(390, 844, 'phone');
  console.log('errors:', JSON.stringify(errs)); await b.close();
})();
