// ---------- Data -------------------------------------------------------------
const TODAY = '2026-11-09';
const SIB = { home:'https://claude.ai/artifact/RPnGj7WnaWcknvQ8ShcRkf', jobs:'https://claude.ai/artifact/A7SMPtpTr3aedUDEnuSaxd', finance:'https://claude.ai/artifact/5VnYTVW2pdA5r1qBRvdrom', planner:'https://claude.ai/artifact/AKkgWzJ2gVR3dJTWnMB2Ui', people:'https://claude.ai/artifact/LPdsNGb4CRMfS6qk7j7Fsa', assets:'https://claude.ai/artifact/89PDTuMiovgP9i3h4MJ1Tw', floor:'https://claude.ai/artifact/6xqFcEZZk49w86p5pAsisA', scan:'https://claude.ai/artifact/8Q2HVoRhLbSLz1Q9mCtayX' };
const MDY = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtDY = d => `${+d.slice(8,10)} ${MDY[+d.slice(5,7)-1]} ${d.slice(0,4)}`;
const clone = o => JSON.parse(JSON.stringify(o));
const pl = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;

// The permission registry — transcribed from src/lib/permissions.ts (PERMISSION_REGISTRY) and
// convex/lib/permissionsCore.ts (RESOURCES, rolePermissions). One source in the app; copied here only
// because a prototype cannot import.
const STD = [['read','View'],['create','Create'],['update','Edit'],['delete','Delete']];
const REG = [
  ['asset','Assets (serialised)',[...STD,['import','Import'],['export','Export']]],
  ['bulkAsset','Bulk assets',STD],
  ['model','Models',[...STD,['import','Import'],['export','Export']]],
  ['kit','Kits',STD],
  ['project','Projects',[...STD,['manage_line_items','Manage line items'],['generate_documents','Generate documents']]],
  ['client','Clients',STD],
  ['warehouse','Warehouse',[['read','View'],['check_out','Deploy'],['check_in','Return'],['scan','Scan'],['close','Close out']]],
  ['testTag','Test & tag',[...STD,['quick_test','Quick test'],['generate_reports','Generate reports']]],
  ['maintenance','Maintenance',STD],
  ['location','Locations',STD],
  ['document','Documents & PDFs',[['generate','Generate'],['send','Send']]],
  ['orgSettings','Organisation settings',[['read','View'],['update','Edit']]],
  ['orgMembers','Team members',[['read','View'],['invite','Invite'],['update_role','Change roles'],['remove','Remove']]],
  ['supplier','Suppliers',STD],
  ['subHire','Sub-hires',STD],
  ['crew','Crew',STD],
  ['reports','Reports',[['view','View'],['export','Export'],['create','Create saved reports'],['delete','Delete saved reports']]],
  ['checkItem','Check items',STD],
  ['invoice','Quotes & invoices',[...STD,['publish','Publish quote'],['issue','Issue invoice'],['void','Void invoice'],['xero_push','Push to Xero'],['xero_manage','Manage Xero connection'],['record_payment','Record payment'],['void_payment','Void payment']]],
  ['work','Work',STD],
];
const RES = REG.map(r => r[0]);
const ALLP = () => Object.fromEntries(REG.map(([k,,a]) => [k, a.map(x => x[0])]));
const C = 'create', R = 'read', U = 'update', D = 'delete';
const DEFAULT_PERMS = {
  owner: ALLP(), admin: ALLP(),
  manager: { asset:[C,R,U,'import','export'], bulkAsset:[C,R,U], model:[C,R,U,'import','export'], kit:[C,R,U], project:[C,R,U,'manage_line_items','generate_documents'], client:[C,R,U], warehouse:[R,'check_out','check_in','scan','close'], testTag:[C,R,U,'quick_test','generate_reports'], maintenance:[C,R,U], location:[C,R,U], document:['generate','send'], orgSettings:[R], orgMembers:[R], supplier:[C,R,U], subHire:[C,R,U], crew:[C,R,U], reports:['view','export','create','delete'], checkItem:[C,R,U,D], invoice:[C,R,U,'publish','issue','xero_push','record_payment'], work:[C,R,U,D] },
  member: { asset:[C,R,U], bulkAsset:[C,R,U], model:[C,R,U], kit:[R], project:[C,R,U,'manage_line_items','generate_documents'], client:[C,R,U], warehouse:[R,'check_out','check_in','scan'], testTag:[C,R,U,'quick_test'], maintenance:[C,R,U], location:[R], document:['generate'], orgSettings:[], orgMembers:[R], supplier:[R], subHire:[C,R], crew:[R], reports:['view'], checkItem:[R], invoice:[C,R], work:[C,R,U] },
  warehouse: { asset:[R], bulkAsset:[R], model:[R], kit:[R], project:[R], client:[R], warehouse:[R,'check_out','check_in','scan','close'], testTag:[R], maintenance:[R,C,U], location:[R], document:[], orgSettings:[], orgMembers:[], supplier:[R], subHire:[R], crew:[R], reports:['view'], checkItem:[R], invoice:[R], work:[C,R,U] },
  viewer: { asset:[R], bulkAsset:[R], model:[R], kit:[R], project:[R], client:[R], warehouse:[], testTag:[R], maintenance:[R], location:[R], document:[], orgSettings:[], orgMembers:[], supplier:[R], subHire:[R], crew:[R], reports:['view'], checkItem:[R], invoice:[R], work:[R] },
};
const ROLES = ['owner','admin','manager','member','warehouse','viewer'];
const ROLE_LABEL = { owner:'Owner', admin:'Admin', manager:'Manager', member:'Member', warehouse:'Warehouse', viewer:'Viewer' };
// src/lib/role-descriptions.ts ASSIGNABLE_ROLE_OPTIONS (+ owner, which is never assignable)
const ROLE_DESC = { owner:'Everything, always. Ownership is transferred, not granted.', admin:'Full access, including billing and settings.', manager:'Runs the day-to-day — projects, quotes, gear — without settings or billing.', member:'Creates and edits projects and gear. No settings access.', warehouse:'Check gear in and out, scan, close pull sheets. Read-only everywhere else.', viewer:'Read-only access across the app.' };
const ASSIGNABLE = ['admin','manager','member','warehouse','viewer'];
const BASE = r => { const a = REG.find(x => x[0] === r)[2][0][0]; return ['read','view'].includes(a) ? a : null; };
const ACTS = r => REG.find(x => x[0] === r)[2];
const TOTAL_ACTIONS = REG.reduce((n, r) => n + r[2].length, 0);
// Admin keeps the two actions that let someone fix permissions (proposal D-S3)
const LOCKED = { admin: new Set(['orgSettings.read','orgSettings.update','orgMembers.read','orgMembers.update_role']) };

const state = {
  route: 'index', q: '', mq: '', rf: [], sel: new Set(), last: null, expanded: new Set(), viewAs: 'owner',
  policy: 'DOMAIN_REQUEST', draft: null, xeroConfigured: true, sheet: null, inv: { role:'member' }, undo: null,
  perms: clone(DEFAULT_PERMS),
  members: [
    { id:'m1', name:'Jayden Cole', email:'jayden@twotoned.com.au', role:'owner', joined:'2024-03-04', me:true },
    { id:'m2', name:'Tom Nguyen', email:'tom@twotoned.com.au', role:'admin', joined:'2024-03-04' },
    { id:'m3', name:'Mel Torres', email:'mel@twotoned.com.au', role:'manager', joined:'2024-06-18' },
    { id:'m4', name:'Sam Okafor', email:'sam@twotoned.com.au', role:'warehouse', joined:'2024-09-02' },
    { id:'m5', name:'Oli Martin', email:'oli@twotoned.com.au', role:'member', joined:'2025-01-13' },
    { id:'m6', name:'Sam Kowalski', email:'sam.k@twotoned.com.au', role:'member', joined:'2025-02-24' },
    { id:'m7', name:'Jess Tran', email:'jess@twotoned.com.au', role:'member', joined:'2025-05-05' },
    { id:'m8', name:'Dev Patel', email:'dev@twotoned.com.au', role:'member', joined:'2025-08-11' },
    { id:'m9', name:'Dan Wu', email:'dan@bigpicture.com.au', role:'viewer', joined:'2025-10-20' },
  ],
  invites: [
    { id:'i1', email:'tom.brennan@gmail.com', role:'member', sent:'2026-11-06', expires:'2026-11-13', by:'Jayden Cole' },
    { id:'i2', email:'mia.rossi@outlook.com', role:'warehouse', sent:'2026-10-28', expires:'2026-11-04', by:'Jayden Cole' },
  ],
  requests: [ { id:'r1', name:'Ash Reyes', email:'ash.reyes@twotoned.com.au', asked:'2026-11-07' } ],
};

const POLICIES = [
  ['INVITE_ONLY','Invite only','Only an admin-sent invite can add someone to this organisation.'],
  ['DOMAIN_REQUEST','Allow domain requests','People whose verified email matches an existing member’s domain can ask to join.'],
  ['CLOSED','Closed','No self-serve path at all — not even discoverable by domain.'],
];
const policyLabel = v => POLICIES.find(p => p[0] === v)[1];

// Sections: one row per live /settings/* page (+ the kill switch, moved out of API keys into Danger zone)
const GROUPS = ['Organisation','People & access','Operations','Money','Integrations','Developer','Danger zone'];
const SECTIONS = [
  { k:'general', g:0, name:'General', desc:'Business details, country, timezone, defaults and automation', gate:['orgSettings','read'], gateTxt:'View organisation settings to open · Edit to save', kw:'business name abn address email phone website country timezone tax rate numbering project invoice number status automation crew time', st:{w:'Australia'},
    parts:[['Business','Name, email, phone, website, address, ABN, country'],['Timezone','Org timezone; “Auto (browser)” when unset'],['Project defaults','Default tax rate; project numbering; invoice numbering'],['Status automation','Four switches — quote sent, prep started, all checked out, all returned. Absent means on'],['Crew & time','Crew rate and timesheet defaults']], primary:'none — Save per part', note:'Invoice numbering and the default tax rate sit here today and belong with Billing (D-S5).' },
  { k:'branding', g:0, name:'Branding & documents', desc:'Colours, and the footer, terms and payment details printed on PDFs', gate:['orgSettings','read'], gateTxt:'View organisation settings', kw:'logo colours colors brand pdf footer terms conditions payment details quote validity payment terms', st:{w:'Branded',t:'ok'},
    parts:[['Branding & colours','Brand colour tokens for the UI and PDF documents'],['Documents','Footer text, terms & conditions (and the invoice toggle), payment details, quote validity days, payment terms days']], primary:'none — Save per part' },
  { k:'team', g:1, name:'Team', desc:'Members, invitations, join policy and what each role can do', gate:['orgMembers','read'], gateTxt:'View team members · Invite, Change roles, Remove to act', kw:'members people invite invitation role permission join policy domain request remove admin manager viewer warehouse' },
  { k:'sso', g:1, name:'Single sign-on', desc:'Sign in with your own identity provider', gate:['orgSettings','read'], gateTxt:'View organisation settings', kw:'saml oidc okta azure google login provisioning group mapping', st:{w:'Not set up',s:1},
    parts:[['Single sign-on','Enable / disable for the org'],['Identity providers','SAML 2.0 or OIDC providers'],['User provisioning','Create members on first sign-in; default role'],['Group-to-role mapping','Map IdP groups to built-in roles'],['Login behaviour','Whether password sign-in stays available'],['Pending approvals','Sign-ins waiting for an admin yes']], primary:'+ Add identity provider' },
  { k:'assets', g:2, name:'Assets', desc:'Tag format, containers, categories and suppliers', gate:['orgSettings','read'], gateTxt:'View organisation settings', kw:'asset tag prefix digits counter container category suppliers', st:{w:'TTP-00043 next',mono:1},
    parts:[['Asset tags','Prefix, digits and counter for auto-incrementing tags'],['Containers','Which categories hold cases, tubs and road boxes'],['Categories','Equipment categories and subcategories'],['Suppliers','Vendor contacts and procurement partners']], primary:'+ Add category' },
  { k:'custom-fields', g:2, name:'Custom fields', desc:'Your own attributes on assets — rig numbers, firmware, case colours', gate:['orgSettings','read'], gateTxt:'View organisation settings', kw:'attributes fields firmware', st:{w:'4 fields'},
    parts:[['Fields','Operator-defined attributes: name, type, required, where it shows']], primary:'+ Add field' },
  { k:'test-and-tag', g:2, name:'Test & tag', desc:'Tag ID format, default intervals and reminder emails', gate:['orgSettings','read'], gateTxt:'View organisation settings', kw:'testing interval reminder digest checkout policy tester', st:{w:'Every 6 months'},
    parts:[['Test & tag','ID prefix, digits, counter'],['Testing defaults','Default interval, equipment class, test method, deployment policy'],['Email reminders','Daily digest of overdue and due-soon items']], primary:'none — Save per part' },
  { k:'test-profiles', kid:1, g:2, name:'Test profiles', desc:'Which visual checks and electrical tests apply to each equipment type', gate:['orgSettings','read'], gateTxt:'View organisation settings', kw:'profiles visual electrical equipment type', st:{w:'9 profiles'},
    parts:[['Profiles','One per equipment type: visual checks, electrical tests']], primary:'+ Add profile', note:'Sub-page of Test & tag (/settings/test-and-tag/profiles).' },
  { k:'check-items', g:2, name:'Check items', desc:'Pre-use and return checks used on model and kit templates', gate:['checkItem','read'], gateTxt:'View check items', kw:'checklist pre-use return templates', st:{w:'14 items'},
    parts:[['Check items','Label, when it applies, which models and kits use it']], primary:'+ Add check item', note:'Deleting keeps checklist instances on past jobs.' },
  { k:'calendars', g:2, name:'Calendars', desc:'iCal feeds for Google, Apple and Outlook', gate:['orgSettings','read'], gateTxt:'View organisation settings', kw:'ical feed subscribe token', st:{w:'Feed active',t:'ok'},
    parts:[['Calendar feeds','One shared token; regenerating it stops every subscribed URL']], primary:'none — Copy feed URL in ⋯', note:'Regenerate token stays here and confirms what it breaks.' },
  { k:'displays', g:2, name:'Displays', desc:'Wall-screen URLs for the warehouse and the office', gate:['orgSettings','read'], gateTxt:'View organisation settings', kw:'screen tv wall display token url', st:{w:'2 screens'},
    parts:[['Displays','Warehouse TV, Office — each a revocable URL token']], primary:'+ New display' },
  { k:'billing', g:3, name:'Billing', desc:'Currency, tax rate and tax label for quotes and invoices', gate:['orgSettings','read'], gateTxt:'View organisation settings', kw:'currency tax gst rate label money', st:{w:'AUD · GST 10%'},
    parts:[['Billing','Currency, tax rate (%), tax label']], primary:'none — Save per part' },
  { k:'services', g:3, name:'Services', desc:'Reusable labour, transport and fee templates for quotes', gate:['orgSettings','read'], gateTxt:'View organisation settings', kw:'service templates labour transport fee rate', st:{w:'8 templates'},
    parts:[['Service templates','Title, unit, rate, tax, crew roles']], primary:'+ New template', note:'Deleting keeps the line items already on jobs.' },
  { k:'group-templates', g:3, name:'Group templates', desc:'Saved Project Groups you can drop onto a job', gate:['project','manage_line_items'], gateTxt:'Manage line items on projects', kw:'bundle group template', st:{w:'5 templates'},
    parts:[['Templates','Name, members, bundle price']], primary:'none — created from a job’s group ⋯' },
  { k:'xero', g:4, name:'Xero', desc:'Push invoices and resolve account coding', gate:['invoice','xero_manage'], gateTxt:'Manage Xero connection — owner and admin only. Also hidden when the deployment has no Xero app configured', kw:'accounting invoices chart of accounts tax rates payments sync coding', st:{w:'Connected',t:'ok'},
    parts:[['Connection','Connect / disconnect; the Xero organisation it is bound to'],['Account coding defaults','Default account and tax type; per-service defaults'],['Reference data','Chart of accounts and tax rates, cached from Xero'],['Client mapping','Flow clients matched to Xero contacts'],['Invoice numbering','Whether Xero or Flow numbers invoices'],['Payments','Check Xero for settled invoices now']], primary:'Disconnect — in ⋯, confirms', note:'“Not set up” when the org has never connected — a valid steady state. Connect redirects to Xero and returns with a toast.' },
  { k:'woocommerce', g:4, name:'WooCommerce', desc:'Bring web-shop orders in as jobs', gate:['orgSettings','read'], gateTxt:'View organisation settings', kw:'shop orders webhook wordpress product matching', st:{w:'Not set up',s:1},
    parts:[['Connection','Webhook between WooCommerce and Flow'],['Product matching','How shop products map to models'],['Date field mapping','Which order fields become job dates'],['Location mapping','Shop locations to Flow locations'],['Project defaults','Status, type and tags for new jobs'],['Recent orders','Last imports and failures'],['WordPress setup guide','Steps for the shop side']], primary:'Test connection — in ⋯' },
  { k:'mira', g:4, name:'Mira AI assistant', desc:'Her own model and API key, brought by this org', gate:['orgSettings','read'], gateTxt:'View organisation settings to open · Edit to save — admin and owner', kw:'ai assistant openrouter api key model base url write access llm', st:{w:'On · read-only',t:'ok'},
    parts:[['Connection','API key (write-only, stored encrypted), optional OpenAI-compatible base URL'],['Model','Model slug that supports tool calling'],['Let Mira make changes','Off: read and answer only. On: she may create and update, always as the asking member, and every high-risk action still waits for a human Confirm']], primary:'none — Save per part · Disconnect in ⋯', note:'Flipping “Let Mira make changes” revokes every member’s cached Mira key immediately, so the confirm dialog says so and the Undo toast flips it back (members get fresh keys).' },
  { k:'api-keys', g:5, name:'API keys', desc:'Scoped bearer keys for the API and MCP server', gate:['orgSettings','read'], gateTxt:'View organisation settings', kw:'api key mcp oauth token scope agent request log connect', st:{w:'3 keys'},
    parts:[['Keys','Name, preset, scopes, last used; revoke, rotate, request log'],['Connect an agent','Copy-paste recipes for Claude, Cursor, any MCP client']], primary:'+ Create key', note:'The emergency kill switch leaves this page for Danger zone.' },
  { k:'kill-switch', g:6, name:'API kill switch', desc:'Instantly reject every API key for this organisation', gate:['orgSettings','update'], gateTxt:'Edit organisation settings', kw:'emergency disable api keys danger', st:{w:'Off'},
    parts:[['Emergency kill switch','On: the next request any key makes fails with ORG_KILL_SWITCH, whatever its scopes']], primary:'none — one switch, confirms', note:'Moved from the API keys page: a lever you hope never to use should not sit beside the thing you use daily.' },
];
const SEC = Object.fromEntries(SECTIONS.map(s => [s.k, s]));

// ---------- Derived ------------------------------------------------------------
const role = () => state.viewAs;
const can = (res, a) => (state.perms[role()][res] || []).includes(a);
const gateOk = s => s.k === 'xero' ? can('invoice','xero_manage') && state.xeroConfigured : can(s.gate[0], s.gate[1]);
const visible = () => SECTIONS.filter(gateOk);
const canSettings = () => can('orgSettings','read') || can('orgMembers','read');
const isExpired = i => i.expires < TODAY;
const peopleIn = r => state.members.filter(m => m.role === r);
const granted = r => RES.reduce((n, k) => n + (state.perms[r][k] || []).length, 0);
const edited = r => JSON.stringify(RES.map(k => [...(state.perms[r][k] || [])].sort())) !== JSON.stringify(RES.map(k => [...(DEFAULT_PERMS[r][k] || [])].sort()));
const dirtyList = () => state.draft != null && state.draft !== state.policy ? [{ k:'policy', name:'Join policy' }] : [];
function statusOf(s) {
  if (s.k === 'team') { const n = state.members.length, i = state.invites.length; return { w: `${pl(n,'member')}${i ? ` · ${i} invited` : ''}` }; }
  return s.st;
}
const dotw = st => st ? `<span class="dotw ${st.t || ''}${st.mono ? ' mono' : ''}" style="${st.s ? 'color:var(--muted)' : ''}">${esc(st.w)}</span>` : '';
const avatar = (name, cls = '') => `<span class="av ${cls}">${esc(name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase())}</span>`;
const initialsInv = '@';
const visCount = () => visible().length;
function searchHits(s, q) {
  if (!q) return { hit: true };
  const t = q.toLowerCase().trim(); if (!t) return { hit: true };
  if (s.name.toLowerCase().includes(t) || s.desc.toLowerCase().includes(t)) return { hit: true };
  const part = (s.parts || []).find(p => (p[0] + ' ' + p[1]).toLowerCase().includes(t));
  if (part) return { hit: true, via: part[0] };
  const kw = s.kw.split(' ').find(w => w.includes(t));
  return kw ? { hit: true, via: kw } : { hit: false };
}
function snapshot() {
  const s = clone({ members: state.members, invites: state.invites, requests: state.requests, policy: state.policy, perms: state.perms, viewAs: state.viewAs });
  return () => { Object.assign(state, clone(s)); state.draft = null; state.sel.clear(); render(); };
}

// ---------- Chrome ---------------------------------------------------------------
function renderSide() {
  const items = [['Dashboard',SIB.home,'blue'],['Jobs',SIB.jobs,'blue'],['Finance',SIB.finance,'green'],['Schedule',SIB.planner,'green'],['Crew',SIB.people,'purple'],['Assets',SIB.assets,'amber'],['Warehouse',SIB.floor,'teal'],['Test & tag',SIB.scan,'teal'],['Maintenance','#','amber']];
  $('#sidenav').innerHTML = items.map(([n,h,c]) => `<a href="${h}"><span class="patch" style="background:var(--${c}-soft, var(--paper-2))"></span>${n}</a>`).join('');
  const f = $('.sidebar .foot a'); f.href = '#index'; f.dataset.act = 'goindex'; f.className = 't-small on'; f.style.cssText = 'display:block;padding:8px 10px';
}
function renderChrome() {
  const s = SEC[state.route], idx = state.route === 'index';
  $('.crumb').innerHTML = idx ? '<b>Settings</b>' : `<a href="#index" data-act="goindex" style="color:var(--muted)">Settings</a><span>›</span><b>${esc(s.name)}</b>`;
  const sub = idx ? (canSettings() ? `${visCount()} sections · ${visible().filter(x => x.st && x.st.s).length} not set up` : 'No access') : (s.k === 'team' ? 'Members, invites, join policy, roles' : s.desc);
  $('.phonehead').innerHTML = `${idx ? '<span style="width:12px"></span>' : '<a class="btn btn-icon btn-lg" href="#index" data-act="goindex" aria-label="Back to Settings" style="color:var(--ink)">‹</a>'}<div style="flex:1;min-width:0"><div class="ell" style="font-family:var(--display);font-weight:800;font-size:16px">${idx ? 'Settings' : esc(s.name)}</div><div class="ell t-micro muted" id="phonesub">${esc(sub)}</div></div><button class="btn btn-icon btn-lg" data-act="pagemenu" aria-label="Page actions">⋯</button>`;
}

// ---------- Views ------------------------------------------------------------------
const view = $('#view');
function render() {
  const h = location.hash.slice(1); state.route = SEC[h] ? h : 'index';
  renderSide(); renderChrome();
  if (!canSettings()) view.innerHTML = deniedView();
  else if (state.route === 'index') view.innerHTML = indexView();
  else if (state.route === 'team' ) view.innerHTML = teamView();
  else view.innerHTML = stubView(SEC[state.route]);
  if (canSettings() && state.route === 'index') renderIdx();
  if (canSettings() && state.route === 'team') { renderMembers(); renderInvites(); renderRequests(); renderPolicy(); renderRoles(); }
  renderBulk(); renderDirty(); renderPhoneAct();
  const q = $('#q'); if (q) q.value = state.q;
  const mq = $('#mq'); if (mq) mq.value = state.mq;
  if (!view.dataset.r || view.dataset.r !== state.route) { $('.content').scrollTop = 0; view.dataset.r = state.route; }
}
const deniedView = () => `<div class="denied"><h2>Access denied</h2><p>You don’t have permission to access settings.</p><button class="lnk" data-act="viewas">Preview as another role…</button></div>`;

function indexView() {
  return `<div class="lphead"><div class="t"><div class="trow"><h1 class="h1">Settings<span class="cnt">${visCount()}</span></h1></div><div class="idl">Two Toned Productions · you are ${ROLE_LABEL[role()]} <span class="faint">· <span class="kbd">/</span> to find a setting</span></div></div><div class="hact"><button class="btn btn-icon deskonly" data-act="pagemenu" aria-label="More">⋯</button></div></div>
  <div class="ftoolbar" style="padding-top:10px"><div class="search"><span class="muted">⌕</span><input id="q" placeholder="Find a setting — a page, or what it controls" aria-label="Find a setting" autocomplete="off"></div></div>
  <div id="idx"></div><div class="lpfoot" id="idxfoot" style="margin-top:14px"></div>`;
}
function renderIdx() {
  const vis = visible(); let h = '', shown = 0;
  GROUPS.forEach((g, gi) => {
    const rows = vis.filter(s => s.g === gi).map(s => ({ s, m: searchHits(s, state.q) })).filter(x => x.m.hit);
    if (!rows.length) return;
    shown += rows.length;
    h += `<div class="gh"><b>${g}</b><span class="n">${rows.length}</span></div>` + rows.map(({ s, m }) => `<button class="irow ${s.kid ? 'kid' : ''}" data-act="open" data-k="${s.k}"><span class="nm">${esc(s.name)}</span><span class="ds">${esc(s.desc)}${m.via ? ` <em>· ${esc(m.via)}</em>` : ''}</span><span class="st">${dotw(statusOf(s))}</span><span class="chv">›</span></button>`).join('');
  });
  if (!shown) h = state.q ? `<div class="empty"><b>Nothing matches “${esc(state.q)}”</b>Try a page name — Team, Xero, Billing — or what it controls, like tax or timezone.</div>` : '';
  $('#idx').innerHTML = h;
  const hidden = SECTIONS.length - vis.length;
  $('#idxfoot').innerHTML = hidden ? `<span>${pl(hidden,'section')} hidden for ${ROLE_LABEL[role()]}: ${SECTIONS.filter(x => !gateOk(x)).map(x => esc(x.name)).join(', ')}</span>` : '';
  $('#idxfoot').style.display = hidden ? '' : 'none';
}

function teamView() {
  const act = canAct(), inv = can('orgMembers','invite');
  return `<div class="lphead"><div class="t"><div class="trow"><h1 class="h1">Team</h1></div><div class="idl">Who can sign in to Two Toned Productions, and what each role can do</div></div>
    <div class="hact">${inv ? `<button class="btn ${dirtyList().length ? 'btn-secondary' : 'btn-primary'} deskonly" data-act="new">+ Invite member</button>` : ''}<button class="btn btn-icon deskonly" data-act="pagemenu" aria-label="More">⋯</button></div></div>
  ${act ? '' : `<div class="quiet" style="margin-top:8px">You can view the team. Inviting, changing roles and removing people need Admin.</div>`}
  <section class="sx" id="s-members"><div class="sxh"><h2>Members</h2><span class="n" id="mcount"></span><div class="r"><div class="search"><span class="muted">⌕</span><input id="mq" placeholder="Search members" aria-label="Search members" autocomplete="off"></div><span id="mf" style="display:contents"></span></div></div><div id="t-members"></div></section>
  <section class="sx" id="s-invites"><div class="sxh"><h2>Invitations</h2><span class="n" id="icount"></span></div><div id="t-invites"></div></section>
  ${can('orgMembers','invite') ? `<section class="sx" id="s-reqs"><div class="sxh"><h2>Join requests</h2><span class="n" id="rcount"></span></div><div id="t-reqs"></div></section>` : ''}
  ${can('orgSettings','update') ? `<section class="sx" id="s-policy"><div class="sxh"><h2>Join policy</h2><span id="pdirty"></span></div><div id="t-policy"></div></section>` : ''}
  <section class="sx" id="s-roles"><div class="sxh"><h2>Roles &amp; permissions</h2><span class="n">${ROLES.length}</span><div class="r"><button class="fw" data-act="rolemenu">Edit role ▾</button></div></div><p class="hint deskonly">Select a role to see or edit its actions. Select a resource to see each action.</p><div id="t-roles"></div></section>`;
}
const canAct = () => can('orgMembers','update_role') || can('orgMembers','remove');

// --- members
const memRows = () => state.members.filter(m => (!state.rf.length || state.rf.includes(m.role)) && (!state.mq || (m.name + ' ' + m.email).toLowerCase().includes(state.mq.toLowerCase())));
const cbx = (key, on, name, dis) => `<button class="cb ${on ? 'on' : ''}${dis ? ' dis' : ''}" data-act="select" data-key="${key}" aria-label="Select ${esc(name)}" aria-pressed="${on}"></button>`;
const dotsb = (key, label) => `<button class="dots" data-act="rowmenu" data-key="${key}" aria-label="${esc(label)} actions">${ICON.dots}</button>`;
function renderMembers() {
  const rows = memRows(), act = canAct();
  $('#mcount').textContent = state.members.length;
  $('#mf').innerHTML = filterWord('Role', 'role', state.rf.length ? (state.rf.length === 1 ? ROLE_LABEL[state.rf[0]] : `${state.rf.length} chosen`) : '', 'rolef') + (state.rf.length || state.mq ? `<button class="fw" data-act="clearf">Clear</button>` : '');
  if (!rows.length) { $('#t-members').innerHTML = `<div class="emptyl"><b>Nothing matches.</b> No member fits “${esc(state.mq || state.rf.map(r => ROLE_LABEL[r]).join(', '))}”.</div>`; return; }
  const allOn = rows.every(m => state.sel.has('m:' + m.id));
  const roleCell = m => m.role === 'owner' || !can('orgMembers','update_role') ? `<span class="rolew ${m.role === 'owner' ? 'owner' : ''}">${ROLE_LABEL[m.role]}</span>` : `<button class="rolew" data-act="rolepick" data-key="m:${m.id}">${ROLE_LABEL[m.role]}</button>`;
  const rowMenu = m => dotsb('m:' + m.id, m.name);
  $('#t-members').innerHTML = `<div class="tblwrap"><table class="tbl"><thead><tr>${act ? `<th style="width:36px"><button class="cb ${allOn ? 'on' : ''}" data-act="selpage" data-g="m" aria-label="Select all members"></button></th>` : ''}<th>Member</th><th style="width:150px">Role</th><th style="width:120px">Joined</th><th style="width:44px"></th></tr></thead><tbody>${rows.map(m => { const on = state.sel.has('m:' + m.id); return `<tr class="${on ? 'sel' : ''}">${act ? `<td>${cbx('m:' + m.id, on, m.name)}</td>` : ''}<td><div class="who">${avatar(m.name)}<div style="min-width:0"><div class="ell"><b>${esc(m.name)}</b>${m.me ? ' <span class="faint">· you</span>' : ''}</div><div class="sub ell">${esc(m.email)}</div></div></div></td><td>${roleCell(m)}</td><td class="mono jn">${fmtDY(m.joined)}</td><td class="r">${rowMenu(m)}</td></tr>`; }).join('')}</tbody></table></div>
  <div class="list">${rows.map(m => { const on = state.sel.has('m:' + m.id); return `<div class="lrow ${on ? 'sel' : ''}">${act ? cbx('m:' + m.id, on, m.name) : ''}${avatar(m.name)}<div style="flex:1;min-width:0"><div class="ttl ell">${esc(m.name)}${m.me ? ' <span class="faint" style="font-weight:500">· you</span>' : ''}</div><div class="sub ell">${esc(m.email)}</div></div><div class="right t-small ${m.role === 'owner' ? '' : 'muted'}" style="font-weight:600">${ROLE_LABEL[m.role]}</div>${rowMenu(m)}</div>`; }).join('')}</div>
  ${state.rf.length || state.mq ? `<div class="lpfoot"><span>${rows.length} of ${state.members.length} members shown</span></div>` : ''}`;
}
// --- invites
function renderInvites() {
  const rows = state.invites, act = canAct();
  $('#icount').textContent = rows.length;
  if (!rows.length) { $('#t-invites').innerHTML = `<div class="emptyl"><b>None yet.</b> Nobody is waiting to join${can('orgMembers','invite') ? ' — + Invite member sends one' : ''}.</div>`; return; }
  const stat = i => isExpired(i) ? `<span class="dotw warn">Expired ${fmtD(i.expires)}</span>` : `<span class="dotw info">Pending</span>`;
  const allOn = rows.every(i => state.sel.has('i:' + i.id));
  const dots = i => can('orgMembers','invite') || can('orgMembers','remove') ? dotsb('i:' + i.id, i.email) : '';
  $('#t-invites').innerHTML = `<div class="tblwrap"><table class="tbl"><thead><tr>${act ? `<th style="width:36px"><button class="cb ${allOn ? 'on' : ''}" data-act="selpage" data-g="i" aria-label="Select all invitations"></button></th>` : ''}<th>Invited</th><th style="width:150px">Role</th><th style="width:170px">Status</th><th style="width:44px"></th></tr></thead><tbody>${rows.map(i => { const on = state.sel.has('i:' + i.id); return `<tr class="${on ? 'sel' : ''}">${act ? `<td>${cbx('i:' + i.id, on, i.email)}</td>` : ''}<td><div class="who">${avatar('@', 'inv')}<div style="min-width:0"><div class="ell"><b>${esc(i.email)}</b></div><div class="sub ell">Sent ${fmtD(i.sent)} by ${esc(i.by)}</div></div></div></td><td><span class="rolew">${ROLE_LABEL[i.role]}</span></td><td>${stat(i)}</td><td class="r">${dots(i)}</td></tr>`; }).join('')}</tbody></table></div>
  <div class="list">${rows.map(i => { const on = state.sel.has('i:' + i.id); return `<div class="lrow ${on ? 'sel' : ''}">${act ? cbx('i:' + i.id, on, i.email) : ''}${avatar('@', 'inv')}<div style="flex:1;min-width:0"><div class="ttl ell" style="font-size:14.5px">${esc(i.email)}</div><div class="sub ell">${ROLE_LABEL[i.role]} · sent ${fmtD(i.sent)}</div></div><div class="right">${stat(i)}</div>${dots(i)}</div>`; }).join('')}</div>`;
}
// --- join requests
function renderRequests() {
  if (!$('#t-reqs')) return;
  const rows = state.requests, act = can('orgMembers','invite');
  $('#rcount').textContent = rows.length;
  if (!rows.length) { $('#t-reqs').innerHTML = `<div class="emptyl">${state.policy === 'DOMAIN_REQUEST' ? '<b>None yet.</b> People at twotoned.com.au can ask to join from the sign-in page.' : `<b>Off.</b> Join policy is ${policyLabel(state.policy)}, so nobody can ask.`}</div>`; return; }
  const allOn = rows.every(r => state.sel.has('r:' + r.id));
  $('#t-reqs').innerHTML = `<div class="tblwrap"><table class="tbl"><thead><tr><th style="width:36px"><button class="cb ${allOn ? 'on' : ''}" data-act="selpage" data-g="r" aria-label="Select all requests"></button></th><th>Asked to join</th><th style="width:300px">Via</th><th style="width:44px"></th></tr></thead><tbody>${rows.map(r => { const on = state.sel.has('r:' + r.id); return `<tr class="${on ? 'sel' : ''}"><td>${cbx('r:' + r.id, on, r.name)}</td><td><div class="who">${avatar(r.name)}<div style="min-width:0"><div class="ell"><b>${esc(r.name)}</b></div><div class="sub ell">${esc(r.email)}</div></div></div></td><td class="t-small muted">Matching domain · asked ${fmtD(r.asked)}</td><td class="r">${dotsb('r:' + r.id, r.name)}</td></tr>`; }).join('')}</tbody></table></div>
  <div class="list">${rows.map(r => { const on = state.sel.has('r:' + r.id); return `<div class="lrow ${on ? 'sel' : ''}">${cbx('r:' + r.id, on, r.name)}${avatar(r.name)}<div style="flex:1;min-width:0"><div class="ttl ell">${esc(r.name)}</div><div class="sub ell">${esc(r.email)} · asked ${fmtD(r.asked)}</div></div>${dotsb('r:' + r.id, r.name)}</div>`; }).join('')}</div>`;
}
// --- join policy (inline fields, Save per section through the dirty bar)
function renderPolicy() {
  const el = $('#t-policy'); if (!el) return;
  const cur = state.draft ?? state.policy, dirty = dirtyList().length > 0;
  $('#pdirty').innerHTML = dirty ? '<span class="dotw warn">Unsaved</span>' : '';
  el.innerHTML = POLICIES.map(([v, l, d]) => `<button class="rdo ${cur === v ? 'on' : ''}" data-act="policy" data-v="${v}" role="radio" aria-checked="${cur === v}"><span class="dot"></span><span><b>${l}</b><span class="d">${d}${v === 'DOMAIN_REQUEST' ? ` Matches <span class="mono">twotoned.com.au</span>.` : ''}</span></span></button>`).join('');
}
// --- roles & permissions: the calm read-only grid
function renderRoles() {
  const el = $('#t-roles'); if (!el) return;
  const cell = (r, k) => { const have = (state.perms[r][k] || []).length, tot = ACTS(k).length; return have === tot ? `<td class="all">All</td>` : have === 0 ? `<td class="none">—</td>` : `<td>${have}/${tot}</td>`; };
  const th = r => { const n = peopleIn(r).length; return `<th><button data-act="role" data-v="${r}">${ROLE_LABEL[r]}</button><div class="sub muted">${pl(n, 'person', 'people')}${edited(r) ? ' · <span class="warnw">edited</span>' : ''}</div></th>`; };
  let body = '';
  REG.forEach(([k, label, acts]) => {
    const open = state.expanded.has(k);
    body += `<tr class="res ${open ? 'open' : ''}" data-act="xres" data-v="${k}"><td><span class="chv">▸</span>${label}<span class="n">${acts.length}</span></td>${ROLES.map(r => cell(r, k)).join('')}</tr>`;
    if (open) acts.forEach(([a, al]) => { body += `<tr class="act"><td>${al}</td>${ROLES.map(r => `<td>${(state.perms[r][k] || []).includes(a) ? ICON.check : ''}</td>`).join('')}</tr>`; });
  });
  el.innerHTML = `<div class="mxwrap"><table class="mx"><thead><tr><th>Resource</th>${ROLES.map(th).join('')}</tr></thead><tbody>${body}</tbody><tfoot><tr><td>Actions granted</td>${ROLES.map(r => `<td>${granted(r)}/${TOTAL_ACTIONS}</td>`).join('')}</tr></tfoot></table></div>
  <div class="rolesl">${ROLES.map(r => { const n = peopleIn(r).length; return `<button class="lrow" data-act="role" data-v="${r}" style="border-top:1px solid var(--line)"><div style="flex:1;min-width:0"><div class="ttl">${ROLE_LABEL[r]}${edited(r) ? ' <span class="warnw" style="font-weight:500;font-size:12px">· edited</span>' : ''}</div><div class="sub ell">${pl(n, 'person', 'people')} · ${granted(r)} of ${TOTAL_ACTIONS} actions</div></div><span class="chv" style="color:var(--faint)">›</span></button>`; }).join('')}</div>`;
}

// --- stub
function stubView(s) {
  const st = statusOf(s);
  return `<div class="lphead"><div class="t"><div class="trow"><h1 class="h1">${esc(s.name)}</h1>${dotw(st)}</div><div class="idl">${esc(s.desc)}</div></div><div class="hact"><button class="btn btn-icon deskonly" data-act="pagemenu" aria-label="More">⋯</button></div></div>
  <div class="quiet" style="margin-top:10px"><b>Stub.</b> This section adopts the same shape as <a href="#team" data-act="open" data-k="team" style="color:var(--blue)">Team</a>: a record-page header, one block per part below, inline fields with Save per part, a Save / Discard bar while anything is edited, row ⋯ for verbs, Undo on every reversible write.</div>
  <section class="sx"><div class="sxh"><h2>On this page</h2><span class="n">${s.parts.length}</span></div>${s.parts.map(p => `<div class="stubrow"><b>${esc(p[0])}</b><span>${esc(p[1])}</span></div>`).join('')}</section>
  <section class="sx"><div class="sxh"><h2>Page</h2></div><div class="stubrow"><b>Primary</b><span>${esc(s.primary || 'none')}</span></div><div class="stubrow"><b>Permission gate</b><span>${esc(s.gateTxt)}</span></div>${s.note ? `<div class="stubrow"><b>Note</b><span>${esc(s.note)}</span></div>` : ''}</section>`;
}

// --- bulk + dirty + phone primary
function renderBulk() {
  const keys = [...state.sel]; const b = $('#bulk');
  const m = keys.filter(k => k[0] === 'm').length, i = keys.filter(k => k[0] === 'i').length, r = keys.filter(k => k[0] === 'r').length, n = keys.length;
  b.classList.toggle('open', n > 0); document.body.classList.toggle('hassel', n > 0);
  if (!n) { b.innerHTML = ''; return; }
  const btn = (a, l, c, red) => `<button class="btn btn-secondary btn-sm" ${red ? 'style="color:var(--t-out)"' : ''} data-act="${a}">${l}${c ? ' ' + c : ''}</button>`;
  b.innerHTML = `<b style="font-size:13px">${n} selected</b>` +
    (m && can('orgMembers','update_role') ? btn('bulkrole', 'Change role…', m) : '') + (i && can('orgMembers','invite') ? btn('bulkresend', 'Resend', i) : '') + (r ? btn('bulkapprove', 'Approve', r) : '') +
    (m && can('orgMembers','remove') ? btn('bulkremove', 'Remove', m, true) : '') + (i && can('orgMembers','remove') ? btn('bulkrevoke', 'Revoke', i, true) : '') + (r ? btn('bulkreject', 'Reject', r, true) : '') +
    `<button class="btn btn-icon btn-sm" data-act="clearsel" aria-label="Clear selection">✕</button>`;
}
function renderDirty() {
  let d = $('#dirty'); if (!d) { d = document.createElement('div'); d.id = 'dirty'; d.className = 'bulk'; document.body.appendChild(d); }
  const list = state.route === 'team' ? dirtyList() : [];
  d.classList.toggle('open', list.length > 0); document.body.classList.toggle('hasdirty', list.length > 0);
  d.style.bottom = (!isPhone() && state.sel.size) ? '84px' : '';
  d.innerHTML = list.length ? `<b style="font-size:13px">${list.map(x => x.name).join(', ')} <span class="faint" style="font-weight:500">· unsaved</span></b><button class="btn btn-ghost btn-sm" data-act="discard">Discard</button><button class="btn btn-primary btn-sm" data-act="save">Save ${list.length === 1 ? list[0].name.toLowerCase() : list.length + ' sections'}</button>` : '';
}
function renderPhoneAct() {
  const pa = $('#phoneact'); pa.innerHTML = state.route === 'team' && can('orgMembers','invite') ? `<button class="btn btn-primary" data-act="new">+ Invite member</button>` : '';
  pa.style.display = pa.innerHTML ? '' : 'none';
}

// ---------- Dialogs / menus ----------------------------------------------------------
const roleItems = (cur, act, args, skip = []) => ASSIGNABLE.filter(r => !skip.includes(r)).map(r => ({ label: ROLE_LABEL[r], act, args: `${args} data-v="${r}"`, on: cur === r, small: '' }));
function inviteDialog() {
  state.inv = { role: 'member' };
  openDialog(`<div class="hd"><div class="t-overline">Team</div><h2>Invite a member</h2></div><div class="bd" style="gap:16px">${field('Email', '<input id="inv-email" type="email" placeholder="name@company.com" autocomplete="off" style="width:100%">', '')}<div id="inv-err" class="ferr" style="margin-top:-8px"></div><div class="field"><label>Role</label><div id="inv-roles"></div></div></div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary btn-sm" data-act="close">Cancel</button><button class="btn btn-primary btn-sm" data-act="invitego">Send invite</button></div>`, () => { invRoles(); setTimeout(() => $('#inv-email').focus(), 30); $('#inv-email').addEventListener('keydown', e => { if (e.key === 'Enter') act('invitego'); }); });
}
const invRoles = () => { $('#inv-roles').innerHTML = ASSIGNABLE.map(r => `<button class="rd2 ${state.inv.role === r ? 'on' : ''}" data-act="invrole" data-v="${r}"><span class="dot"></span><span><b>${ROLE_LABEL[r]}</b><span class="d">${ROLE_DESC[r]}</span></span></button>`).join(''); };
function confirmDialog(title, body, label, go, args = '') {
  openDialog(`<div class="hd"><h2>${title}</h2></div><div class="bd"><div style="font-size:14px;color:var(--ink-2);line-height:1.5">${body}</div></div><div class="ft"><div style="flex:1"></div><button class="btn btn-secondary btn-sm" data-act="close">Cancel</button><button class="btn btn-primary btn-sm" data-act="${go}" ${args}>${label}</button></div>`);
}
const nameOf = key => { const [k, id] = [key[0], key.slice(2)]; return k === 'm' ? state.members.find(m => m.id === id).name : k === 'i' ? state.invites.find(i => i.id === id).email : state.requests.find(r => r.id === id).name; };
const namesList = keys => { const n = keys.map(nameOf); return n.length <= 3 ? n.join(', ') : `${n.slice(0, 3).join(', ')} and ${n.length - 3} more`; };

// Role sheet (view for everyone, edit for orgSettings:update, never for Owner)
function openRole(r) {
  const editable = can('orgSettings','update') && r !== 'owner';
  state.sheet = { r, draft: clone(state.perms[r]), editable };
  openDialog(`<div class="hd"><div class="t-overline">Role</div><h2>${ROLE_LABEL[r]}</h2><div class="t-small muted" style="margin-top:4px">${ROLE_DESC[r]} ${peopleIn(r).length ? `· ${peopleIn(r).map(m => m.name).join(', ')}` : '· Nobody holds this role'}</div>${r === 'owner' ? '<div class="t-small faint" style="margin-top:6px">Owner is fixed: it always holds every action.</div>' : (editable ? '<div class="t-small faint" style="margin-top:6px">Proposed (D-S3): per-org overrides of the built-in roles. Today these are constants in code.</div>' : '')}</div><div class="bd" id="rbody"></div><div class="ft"><span class="t-small muted" id="rcnt"></span><button class="btn btn-ghost btn-sm" id="rreset" data-act="rreset" style="display:none">Reset to defaults</button><div style="flex:1"></div><button class="btn btn-secondary btn-sm" data-act="close">${editable ? 'Cancel' : 'Close'}</button>${editable ? '<button class="btn btn-primary btn-sm" id="rsave" data-act="rsave">Save role</button>' : ''}</div>`, d => { d.classList.add('wide'); renderSheet(); });
}
function renderSheet() {
  const { r, draft, editable } = state.sheet; const lock = (k, a) => (LOCKED[r] || new Set()).has(k + '.' + a);
  $('#rbody').innerHTML = REG.map(([k, label, acts]) => { const have = draft[k] || []; const all = acts.every(a => have.includes(a[0]));
    return `<div class="rrow"><div class="rh"><b>${label}</b>${editable ? `<button class="allb" data-act="rall" data-res="${k}">${all ? 'Clear' : 'All'}</button>` : ''}</div><div class="acts">${acts.map(([a, al]) => { const on = have.includes(a), lk = editable && lock(k, a); return `<label class="${on ? '' : 'off'} ${lk ? 'lk' : ''}" ${editable && !lk ? `data-act="rtoggle" data-res="${k}" data-a="${a}"` : ''}><span class="cb ${on ? 'on' : ''}" ${lk || !editable ? 'style="opacity:.5"' : ''}></span>${al}${lk ? ICON.lock : ''}</label>`; }).join('')}</div></div>`; }).join('');
  const n = RES.reduce((c, k) => c + (draft[k] || []).length, 0), ch = RES.reduce((c, k) => c + ACTS(k).filter(a => (draft[k] || []).includes(a[0]) !== (state.perms[r][k] || []).includes(a[0])).length, 0);
  $('#rcnt').textContent = `${n} of ${TOTAL_ACTIONS} actions${ch ? ` · ${pl(ch, 'change')}` : ''}`;
  const rs = $('#rreset'); if (rs) rs.style.display = editable && JSON.stringify(RES.map(k => [...(draft[k] || [])].sort())) !== JSON.stringify(RES.map(k => [...(DEFAULT_PERMS[r][k] || [])].sort())) ? '' : 'none';
  const sv = $('#rsave'); if (sv) { sv.disabled = !ch; sv.style.opacity = ch ? '' : '.45'; sv.textContent = ch ? `Save ${ROLE_LABEL[r]} (${ch})` : 'Save role'; }
}

// ---------- Actions ----------------------------------------------------------------------
function go(k) { if (dirtyList().length && k !== 'team') { confirmDialog('Discard unsaved changes?', `${dirtyList().map(x => x.name).join(', ')} has changes you haven’t saved.`, 'Discard and leave', 'leave', `data-k="${k}"`); return; } nav(k); }
function nav(k) { state.sel.clear(); state.draft = null; closeLayer(); location.hash = k === 'index' ? 'index' : k; if (location.hash.slice(1) === k || (k === 'index' && !SEC[location.hash.slice(1)])) render(); }
window.addEventListener('hashchange', () => { state.sel.clear(); render(); });
function setRole(keys, r) {
  const undo = snapshot(); let n = 0, skip = [];
  keys.forEach(key => { const id = key.slice(2); if (key[0] === 'm') { const m = state.members.find(x => x.id === id); if (m.role === 'owner') { skip.push(m.name); return; } if (m.role !== r) { m.role = r; n++; } } else if (key[0] === 'i') { const v = state.invites.find(x => x.id === id); if (v.role !== r) { v.role = r; n++; } } });
  closeLayer(); state.sel.clear(); render();
  toast(n ? `Role set to ${ROLE_LABEL[r]} for ${n}${skip.length ? ` · ${skip[0]} (owner) stays` : ''}` : (skip.length ? `${skip[0]} is the owner — role unchanged` : `Already ${ROLE_LABEL[r]}`), n ? undo : null);
}
function act(name, el, ev) {
  const key = el && el.dataset ? el.dataset.key : null;
  switch (name) {
    case 'close': closeLayer(); break;
    case 'goindex': go('index'); break;
    case 'open': go(el.dataset.k); break;
    case 'leave': nav(el.dataset.k); break;
    case 'undo': if (state.undo) { state.undo(); state.undo = null; } $('#toast').classList.remove('open'); break;
    case 'toastclose': $('#toast').classList.remove('open'); break;
    case 'noop': closeLayer(); break;
    case 'pagemenu': {
      const t = state.route === 'team';
      openMenu(el, state.route === 'index' ? 'Settings' : SEC[state.route].name, [
        ...(t ? [{ label:'Go to Join policy', act:'jump', args:'data-v="s-policy"' }, { label:'Go to Roles & permissions', act:'jump', args:'data-v="s-roles"' }, '-'] : []),
        { label:'Copy link', act:'copylink' }, '-', { sh:'Prototype only' }, { label:'Preview as role…', act:'viewas' }]); break; }
    case 'copylink': closeLayer(); toast('Link copied'); break;
    case 'jump': closeLayer(); { const e = document.getElementById(el.dataset.v); if (e) e.scrollIntoView({ block:'start' }); } break;
    case 'viewas': openMenu(el, 'Preview this page as', ROLES.map(r => ({ label: ROLE_LABEL[r], act:'setview', args:`data-v="${r}"`, on: role() === r, small: r === 'owner' ? 'you' : '' }))); break;
    case 'setview': { const prev = state.viewAs; state.viewAs = el.dataset.v; state.sel.clear(); closeLayer(); render(); toast(`Previewing as ${ROLE_LABEL[state.viewAs]}`, () => { state.viewAs = prev; render(); }); break; }
    case 'select': {
      const k = el.dataset.key;
      if (ev && ev.shiftKey && state.last && state.last !== k) { const all = [...document.querySelectorAll('.cb[data-act="select"]')].filter(e => e.offsetParent !== null).map(e => e.dataset.key); const a = all.indexOf(state.last), b = all.indexOf(k); if (a > -1 && b > -1) all.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(x => state.sel.add(x)); }
      else if (state.sel.has(k)) state.sel.delete(k); else state.sel.add(k);
      state.last = k; renderMembers(); renderInvites(); renderRequests(); renderBulk(); renderDirty(); break; }
    case 'selpage': { const g = el.dataset.g, ks = (g === 'm' ? memRows() : g === 'i' ? state.invites : state.requests).map(x => g + ':' + x.id); const all = ks.every(x => state.sel.has(x)); ks.forEach(x => all ? state.sel.delete(x) : state.sel.add(x)); renderMembers(); renderInvites(); renderRequests(); renderBulk(); renderDirty(); break; }
    case 'clearsel': state.sel.clear(); renderMembers(); renderInvites(); renderRequests(); renderBulk(); renderDirty(); break;
    case 'rolef': openMenu(el, 'Role', [...ROLES.map(r => ({ label: ROLE_LABEL[r], act:'rolefx', args:`data-v="${r}"`, on: state.rf.includes(r) })), '-', { label:'Clear', act:'clearf' }]); break;
    case 'rolefx': { const v = el.dataset.v; state.rf = state.rf.includes(v) ? state.rf.filter(x => x !== v) : [...state.rf, v]; renderMembers(); act('rolef', $('#mf .fw')); break; }
    case 'clearf': state.rf = []; state.mq = ''; closeLayer(); $('#mq').value = ''; renderMembers(); break;
    case 'new': if (state.route === 'team' && can('orgMembers','invite')) inviteDialog(); break;
    case 'invrole': state.inv.role = el.dataset.v; invRoles(); break;
    case 'invitego': {
      const email = $('#inv-email').value.trim().toLowerCase(), err = $('#inv-err');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = 'Enter a full email address, like name@company.com.'; break; }
      if (state.members.some(m => m.email === email)) { err.textContent = `${email} is already a member.`; break; }
      if (state.invites.some(i => i.email === email)) { err.textContent = `${email} already has an invitation — use Resend on it.`; break; }
      const undo = snapshot(); state.invites.unshift({ id:'i' + (Date.now() % 100000), email, role: state.inv.role, sent: TODAY, expires: '2026-11-16', by:'Jayden Cole' });
      closeLayer(); render(); toast(`Invite sent to ${esc(email)} as ${ROLE_LABEL[state.inv.role]}`, undo); break; }
    case 'rolepick': { const k = el.dataset.key, m = state.members.find(x => x.id === k.slice(2)); openMenu(el, `Role for ${m.name}`, roleItems(m.role, 'setrole1', `data-key="${k}"`)); break; }
    case 'setrole1': setRole([el.dataset.key], el.dataset.v); break;
    case 'bulkrole': { const ks = [...state.sel].filter(k => k[0] === 'm' || k[0] === 'i'); openMenu(el, `Set role for ${ks.length}`, roleItems(null, 'setrolen', '')); break; }
    case 'setrolen': setRole([...state.sel].filter(k => k[0] === 'm' || k[0] === 'i'), el.dataset.v); break;
    case 'rowmenu': {
      const k = el.dataset.key, t = k[0], id = k.slice(2);
      if (t === 'm') { const m = state.members.find(x => x.id === id); openMenu(el, m.name, [ ...(can('orgMembers','update_role') && m.role !== 'owner' ? [{ label:'Change role…', act:'rolepick2', args:`data-key="${k}"` }] : []), { label:'Copy email', act:'copyemail', args:`data-key="${k}"` }, ...(can('orgMembers','remove') && m.role !== 'owner' ? ['-', { label:'Remove from team…', act:'removeone', args:`data-key="${k}"`, danger:true }] : []) ]); }
      else if (t === 'i') { const v = state.invites.find(x => x.id === id); openMenu(el, v.email, [ ...(can('orgMembers','invite') ? [{ label:'Resend invite', act:'resend', args:`data-key="${k}"` }, { label:'Change role…', act:'rolepick2', args:`data-key="${k}"` }] : []), { label:'Copy invite link', act:'copylink2' }, ...(can('orgMembers','remove') ? ['-', { label:'Revoke invitation…', act:'revokeone', args:`data-key="${k}"`, danger:true }] : []) ]); }
      else { const r = state.requests.find(x => x.id === id); openMenu(el, r.name, [{ label:'Approve as Member', act:'approve1', args:`data-key="${k}" data-v="member"` }, { label:'Approve as…', act:'approvepick', args:`data-key="${k}"` }, '-', { label:'Reject request…', act:'rejectone', args:`data-key="${k}"`, danger:true }]); }
      break; }
    case 'rolepick2': { const k = el.dataset.key, id = k.slice(2), cur = (k[0] === 'm' ? state.members : state.invites).find(x => x.id === id).role; closeLayer(); openMenu($(`[data-act="rowmenu"][data-key="${k}"]`) || el, 'Change role', roleItems(cur, 'setrole1', `data-key="${k}"`)); break; }
    case 'copyemail': { closeLayer(); toast('Email copied'); break; }
    case 'copylink2': { closeLayer(); toast('Invite link copied'); break; }
    case 'resend': { const v = state.invites.find(x => x.id === el.dataset.key.slice(2)); v.sent = TODAY; v.expires = '2026-11-16'; closeLayer(); render(); toast(`Invite re-sent to ${esc(v.email)}`); break; }
    case 'bulkresend': { const ks = [...state.sel].filter(k => k[0] === 'i'); ks.forEach(k => { const v = state.invites.find(x => x.id === k.slice(2)); v.sent = TODAY; v.expires = '2026-11-16'; }); state.sel.clear(); render(); toast(`Re-sent ${pl(ks.length, 'invite')}`); break; }
    case 'removeone': closeLayer(); { const k = el.dataset.key; confirmDialog(`Remove ${esc(nameOf(k))} from the organisation?`, 'They lose access immediately. Their past activity, comments and assignments are preserved.', 'Remove member', 'removego', `data-keys="${k}"`); } break;
    case 'bulkremove': { const ks = [...state.sel].filter(k => k[0] === 'm'); const okk = ks.filter(k => state.members.find(m => m.id === k.slice(2)).role !== 'owner'); confirmDialog(`Remove ${okk.length} from the organisation?`, `${esc(namesList(okk))} lose access immediately. Their past activity, comments and assignments are preserved.${okk.length < ks.length ? ' The owner is skipped.' : ''}`, `Remove ${okk.length}`, 'removego', `data-keys="${ks.join(',')}"`); break; }
    case 'removego': { const ks = el.dataset.keys.split(','), undo = snapshot(); let n = 0, sk = 0, first = ''; ks.forEach(k => { const i = state.members.findIndex(m => m.id === k.slice(2)); if (i > -1 && state.members[i].role !== 'owner') { first = first || state.members[i].name; state.members.splice(i, 1); n++; } else sk++; }); closeLayer(); state.sel.clear(); render(); toast(n ? `Removed ${n === 1 ? esc(first) : n + ' members'}${sk ? ` · ${sk} skipped (owner)` : ''}` : 'The owner can’t be removed', n ? undo : null); break; }
    case 'revokeone': closeLayer(); confirmDialog(`Revoke invitation for ${esc(nameOf(el.dataset.key))}?`, 'The pending invitation link stops working immediately. You can send a fresh invite later.', 'Revoke invitation', 'revokego', `data-keys="${el.dataset.key}"`); break;
    case 'bulkrevoke': { const ks = [...state.sel].filter(k => k[0] === 'i'); confirmDialog(`Revoke ${ks.length} invitation${ks.length === 1 ? '' : 's'}?`, `${esc(namesList(ks))} — their links stop working immediately. You can send fresh invites later.`, `Revoke ${ks.length}`, 'revokego', `data-keys="${ks.join(',')}"`); break; }
    case 'revokego': { const ks = el.dataset.keys.split(','), undo = snapshot(); state.invites = state.invites.filter(i => !ks.includes('i:' + i.id)); closeLayer(); state.sel.clear(); render(); toast(`Revoked ${pl(ks.length, 'invitation')}`, undo); break; }
    case 'approve1': { const undo = snapshot(), k = el.dataset.key, r = state.requests.find(x => x.id === k.slice(2)); state.requests = state.requests.filter(x => x !== r); state.members.push({ id:'m' + (Date.now() % 100000), name:r.name, email:r.email, role:el.dataset.v, joined:TODAY }); closeLayer(); state.sel.clear(); render(); toast(`${esc(r.name)} joined as ${ROLE_LABEL[el.dataset.v]}`, undo); break; }
    case 'approvepick': { const k = el.dataset.key; closeLayer(); openMenu($(`[data-act="rowmenu"][data-key="${k}"]`) || el, 'Approve as', roleItems(null, 'approve1', `data-key="${k}"`)); break; }
    case 'bulkapprove': { const undo = snapshot(), ks = [...state.sel].filter(k => k[0] === 'r'); ks.forEach(k => { const r = state.requests.find(x => x.id === k.slice(2)); state.members.push({ id:'m' + r.id, name:r.name, email:r.email, role:'member', joined:TODAY }); }); state.requests = state.requests.filter(r => !ks.includes('r:' + r.id)); state.sel.clear(); render(); toast(`Approved ${ks.length} as Member`, undo); break; }
    case 'rejectone': closeLayer(); confirmDialog(`Reject ${esc(nameOf(el.dataset.key))}?`, 'They’re told the request wasn’t approved. They can ask again.', 'Reject request', 'rejectgo', `data-keys="${el.dataset.key}"`); break;
    case 'bulkreject': { const ks = [...state.sel].filter(k => k[0] === 'r'); confirmDialog(`Reject ${ks.length} request${ks.length === 1 ? '' : 's'}?`, `${esc(namesList(ks))} are told the request wasn’t approved.`, `Reject ${ks.length}`, 'rejectgo', `data-keys="${ks.join(',')}"`); break; }
    case 'rejectgo': { const ks = el.dataset.keys.split(','), undo = snapshot(); state.requests = state.requests.filter(r => !ks.includes('r:' + r.id)); closeLayer(); state.sel.clear(); render(); toast(`Rejected ${pl(ks.length, 'request')}`, undo); break; }
    case 'policy': state.draft = el.dataset.v === state.policy ? null : el.dataset.v; renderPolicy(); renderDirty(); $('.hact .btn').className = $('.hact .btn').className.replace(/btn-(primary|secondary)/, dirtyList().length ? 'btn-secondary' : 'btn-primary'); break;
    case 'discard': state.draft = null; renderPolicy(); renderDirty(); $('.hact .btn').className = $('.hact .btn').className.replace(/btn-(primary|secondary)/, 'btn-primary'); toast('Changes discarded'); break;
    case 'save': { const undo = snapshot(); state.policy = state.draft; state.draft = null; render(); toast(`Join policy: ${policyLabel(state.policy)}`, undo); break; }
    case 'role': openRole(el.dataset.v); break;
    case 'rolemenu': openMenu(el, 'Edit role', ROLES.map(r => ({ label: ROLE_LABEL[r], act:'role', args:`data-v="${r}"`, small: r === 'owner' ? 'fixed' : edited(r) ? 'edited' : '' }))); break;
    case 'xres': { const v = el.dataset.v; state.expanded.has(v) ? state.expanded.delete(v) : state.expanded.add(v); renderRoles(); break; }
    case 'rtoggle': { const s = state.sheet, k = el.dataset.res, a = el.dataset.a, cur = new Set(s.draft[k] || []), base = BASE(k); if (cur.has(a)) { cur.delete(a); if (a === base) cur.clear(); } else { cur.add(a); if (base) cur.add(base); } s.draft[k] = ACTS(k).map(x => x[0]).filter(x => cur.has(x)); renderSheet(); break; }
    case 'rall': { const s = state.sheet, k = el.dataset.res, acts = ACTS(k).map(x => x[0]), all = acts.every(a => (s.draft[k] || []).includes(a)); const lk = LOCKED[s.r] || new Set(); s.draft[k] = all ? acts.filter(a => lk.has(k + '.' + a)) : acts; renderSheet(); break; }
    case 'rreset': state.sheet.draft = clone(DEFAULT_PERMS[state.sheet.r]); renderSheet(); break;
    case 'rsave': { const s = state.sheet; if (el.disabled) break; const undo = snapshot(); state.perms[s.r] = clone(s.draft); closeLayer(); render(); toast(`${ROLE_LABEL[s.r]} permissions saved — ${pl(peopleIn(s.r).length, 'person', 'people')} affected`, undo); break; }
  }
}
// bare search inputs: partial renders so focus survives typing
document.addEventListener('input', e => {
  if (e.target.id === 'q') { state.q = e.target.value; renderIdx(); renderChrome(); }
  if (e.target.id === 'mq') { state.mq = e.target.value; renderMembers(); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !layer.classList.contains('open') && state.sel.size) { state.sel.clear(); render(); } });
render();
