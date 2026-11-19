// ---------- shared helpers (list pages)
const $ = (s, el=document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const isPhone = () => window.matchMedia('(max-width:859px)').matches;
const money = n => n == null ? '—' : '$' + Math.round(n).toLocaleString('en-AU');
const ICON = {
  dots:'<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  check:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="m5 12 5 5L20 7"/></svg>',
  lock:'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  warn:'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  shield:'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  up:'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m6 15 6-6 6 6"/></svg>',
  down:'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m6 9 6 6 6-6"/></svg>',
  cam:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>',
  ext:'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M10 14 21 3M21 14v7H3V3h7"/></svg>',
  scan:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10"/></svg>',
};
const WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const dayNum = d => Math.round(Date.UTC(+d.slice(0,4), +d.slice(5,7)-1, +d.slice(8,10)) / 864e5);
const fmtD = d => d ? `${+d.slice(8,10)} ${MON[+d.slice(5,7)-1]}` : '';
const fmtRange = (a, b) => !a && !b ? '—' : !b ? `From ${fmtD(a)}` : !a ? `Until ${fmtD(b)}` : a.slice(0,7) === b.slice(0,7) ? `${+a.slice(8,10)} – ${fmtD(b)}` : `${fmtD(a)} – ${fmtD(b)}`;
const layer = $('#layer'), body = $('#layerbody');
function closeLayer() { layer.classList.remove('open','dim'); body.innerHTML = ''; }
function openMenu(anchor, title, items) {
  const inner = items.map(it => it === '-' ? '<div class="hr"></div>' : it.sh ? `<div class="sh">${it.sh}</div>` : it.href ? `<a class="item" href="${it.href}" style="display:flex;align-items:center;gap:8px;width:100%;height:32px;padding:0 10px;border-radius:8px;color:inherit">${it.label}<small style="margin-left:auto;color:var(--muted);font-size:11.5px">${it.small||'↗'}</small></a>` : `<button class="${it.danger?'danger':''}" data-act="${it.act}" ${it.args||''}>${it.on?ICON.check+' ':''}${it.label}${it.small?`<small style="margin-left:auto;color:var(--muted);font-size:11.5px">${it.small}</small>`:''}</button>`).join('');
  if (isPhone()) { body.innerHTML = `<div class="sheetwrap"><div class="grab"></div><div class="hd">${title}</div><div style="overflow:auto">${inner.replace(/<button class="(danger)?"/g, (m,d)=>`<button class="item ${d||''}"`)}</div><div style="height:12px"></div></div>`; layer.classList.add('dim'); }
  else { body.innerHTML = `<div class="menu" style="width:290px"><div class="hd">${title}</div>${inner}</div>`; const m = $('.menu', body), r = anchor.getBoundingClientRect(); m.style.visibility='hidden'; layer.classList.add('open'); const mh = m.offsetHeight, mw = m.offsetWidth; let top = r.bottom + 6, left = r.left; if (left + mw > window.innerWidth - 8) left = r.right - mw; if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6); if (left < 8) left = 8; m.style.top = top+'px'; m.style.left = left+'px'; m.style.visibility=''; }
  layer.classList.add('open');
}
function openDialog(html, after) { body.innerHTML = `<div class="dlg">${html}</div>`; layer.classList.add('open','dim'); if (after) after($('.dlg', body)); }
function toast(msg, undo) { const t = $('#toast'); t.innerHTML = `<span>${msg}</span>${undo?`<button class="btn btn-secondary btn-sm" data-act="undo">Undo</button>`:''}<button class="btn btn-icon btn-sm" data-act="toastclose" aria-label="Dismiss">✕</button>`; t.classList.add('open'); state.undo = undo || null; clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('open'), 6000); }
const field = (label, inner, hint='') => `<div class="field"><label>${label}</label>${inner}${hint?`<span class="t-micro muted">${hint}</span>`:''}</div>`;
const opt = (v, label, cur) => `<option value="${v}" ${v===cur?'selected':''}>${label}</option>`;
function renderNav(active) {
  if ($('#sidenav').children.length) return;
  const items = [['Dashboard','blue'],['Jobs','blue'],['Finance','green'],['Schedule','green'],['Crew','purple'],['Assets','amber'],['Warehouse','teal'],['Test & tag','teal'],['Maintenance','amber']];
  $('#sidenav').innerHTML = items.map(([n,c]) => `<a href="#${n.toLowerCase()}" class="${n===active?'on':''}"><span class="patch" style="background:var(--${c}-soft, var(--paper-2))"></span>${n}</a>`).join('');
}
function filterWord(label, key, value, act) { return `<button class="fw ${value?'on':''}" data-act="${act}" data-k="${key}">${value ? esc(label) + ': ' + esc(value) : esc(label) + ' ▾'}</button>`; }
function sortHead(label, key, align='') { const on = state.sort === key; return `<th class="${align}" style="${align==='r'?'text-align:right':''}"><button data-act="sort" data-k="${key}" class="${on?'sorted':''}">${label}${on ? (state.dir === 'asc' ? ICON.up : ICON.down) : ''}</button></th>`; }
function pager(total, label) {
  const from = state.page * state.size + 1, to = Math.min(total, (state.page + 1) * state.size), pages = Math.max(1, Math.ceil(total / state.size));
  return `<span>${total.toLocaleString()} ${label}${total > state.size ? ` · ${from}–${to}` : ''}</span><span class="pg"><button data-act="page" data-d="-1" ${state.page===0?'disabled':''} aria-label="Previous page">‹</button><span class="mono t-small">${state.page+1} / ${pages}</span><button data-act="page" data-d="1" ${state.page>=pages-1?'disabled':''} aria-label="Next page">›</button></span>`;
}
document.addEventListener('click', ev => { const el = ev.target.closest('[data-act]'); if (!el) return; if (el.tagName === 'A' && !(el.href||'').includes('claude.ai')) ev.preventDefault(); ev.stopPropagation(); act(el.dataset.act, el, ev); });
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') { closeLayer(); return; } if (ev.target.matches('input,textarea,select')) return; if (layer.classList.contains('open')) return; if (ev.key === '/') { ev.preventDefault(); $('#q').focus(); } if (ev.key === 'n' || ev.key === 'N') act('new', $('[data-act="new"]')); });
window.addEventListener('resize', () => { clearTimeout(render.t); render.t = setTimeout(render, 120); });
