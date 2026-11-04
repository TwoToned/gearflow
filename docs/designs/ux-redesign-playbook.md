# UX redesign playbook — how to redesign the remaining surfaces

**Status:** program guide, 2026-11-04. Companion to
[`ux-unification-2026-10.md`](./ux-unification-2026-10.md) (the spec, "the main
spec" below). Branch `claude/ux-unification-design-2026-10`, draft PR #1358.

This document is written for an agent session that is handed one sentence —
"redesign the warehouse floor", "do the asset detail page" — and has to produce the
same four things every finished surface so far has produced, in the same language,
without re-deriving the method. Read it top to bottom once; then §9 is the brief for
the surface you were given and §7 is the kit you build it with.

The method is not negotiable; the design of each surface is. Everything below that
says "never" was learned by shipping the wrong thing first.

---

## 0. The four deliverables (definition of done)

A surface is done when all four exist and the user has seen the screenshots:

1. **A clickable prototype**, published as a Claude artifact — desktop 1440 and phone
   390, every control wired, Undo on every write, zero page errors under the
   Playwright drive (§6).
2. **Screenshots sent to the user** at 2× — desktop, desktop with a selection or the
   surface's key state, phone.
3. **A section in the main spec** — the proposal in words, with evidence from the
   live code, the prototype link, a `Phone` subsection, and any decision that changes
   DESIGN.md or a FEATUREDOC appended to the §12 table.
4. **A commit on the program branch, pushed** — `docs(ux): …`, atomic, the prototype
   link added to the list at the top of the main spec.

Not done: a prototype without a spec section, a spec section without a prototype, a
desktop-only prototype, anything the Playwright drive could not click, a design that
drops a live feature without naming it in the keep/move/remove table (§2.2).

---

## 1. The loop

Seven steps, always in this order, one surface at a time. Budget: a list or detail
page is half a day of agent time; a working surface like the warehouse floor is a
day. Do not batch surfaces — each one is a conversation with the user and the next
one benefits from their answer.

| # | Step | Output | Tool |
|---|---|---|---|
| 1 | Inventory the live surface | A fact list (§2.1) | Explore agent, read-only |
| 2 | Keep the structure, decide what moves | The keep / move / remove table (§2.2) | You |
| 3 | Design on the language | A one-screen description per breakpoint (§3, §4, §5) | You |
| 4 | Build the prototype | `<name>-page.js` + `<name>-body.html` assembled with the kit (§7) | Kit |
| 5 | Drive it | `errors: []` on desktop and phone, shots in `shots/` (§6) | Playwright |
| 6 | Publish, send screenshots | Artifact URL, six PNGs to the user (§6.4) | Artifact, SendUserFile |
| 7 | Spec section, commit, push | Main spec updated, pushed (§8) | git |

If the user answers between steps, fold the answer in and continue; do not restart.
If the user says "it feels busy" at step 6, that is a calm pass (§3.9), not a redesign.

---

## 2. Inventory and structure

### 2.1 Inventory (step 1)

Brief an Explore agent with the route(s) and the component directory from the §9
brief. It reports, as facts with file:line, not opinions:

- Every control on the page: toolbar buttons, filters, tabs, row buttons, menus (open
  them in the code: every `DropdownMenuItem`, every `onSelect`), dialogs and sheets
  with their fields, keyboard shortcuts, bulk actions.
- Every state DESIGN.md §8 requires: loading, empty (first-run vs no-match), error,
  permission-gated (`PermissionGate`, `RequirePermission`), offline/syncing where it
  applies, locked (lifecycle tier).
- Every fact a row or card shows, and which ones are derived vs stored.
- Counts the page shows or could show (what the quick strip will count).
- What persists where (`localStorage` keys, `?query` params, saved views).
- Which FEATUREDOCS and main-spec sections already cover it.
- The phone rendering today, literally: what collapses, what is unreachable.

Write the inventory into the spec section's "Why" paragraph as evidence. Do not
paste it as a list into the spec; the spec says what is wrong, with two or three
file references, and moves on.

### 2.2 Keep the structure (step 2)

The rule the whole program runs on: **the live page, cleaned up.** The warehouse job
page had three fresh directions prototyped (case board, pick walk, scanner-first) and
all three were rejected for "the page we have, with the noise removed". Every surface
since has kept its structure and only moved things. Do the same:

- The page keeps its sections in their order, its tabs, its nouns, its routes.
- Every live feature is housed somewhere in the design. Produce a three-column
  table — **keep · move · remove** — and put it in your working notes; anything in
  "remove" needs a sentence in the spec saying why and where its job went. Removing
  a feature nobody asked to remove is the most common way a proposal gets a no.
- Merging is allowed when two surfaces show the same facts (Tasks + Notes + Files
  became one tab; Overview's context cards replaced the sidebar on that one tab).
  Splitting is almost never.
- New capability is allowed only when it closes a gap the inventory found
  (dashboard tiles that lose their number on click → URL-driven filters).

---

## 3. The language

These are the rules every published prototype follows. They are the house style;
the spec's §3 principles and DESIGN.md are their source. When in doubt, open the
Overview prototype (the calmest surface) and copy what it does.

### 3.1 Chrome
- No card chrome around lists, toolbars or sections. A hairline between rows, a
  hairline under a toolbar. Backgrounds are the page.
- Sections are a heading line, not a band. Section headings are 12–13 px, 600 weight,
  with a muted mono count after them.
- Footers are one muted line (`38 jobs · 1–25  ‹ 1 / 2 ›`, `Totals · $23,880`).
- One accent on a page: the primary button. Everything else is ink, muted, faint.

### 3.2 Words, not controls
- Toolbar choices are words with the active one underlined in red
  (`Table  Board`, `Pick  Prepped  Out`), never segmented controls, never icon
  buttons with tooltips.
- Filters are words that read their value: `Status ▾` → `Status: Confirmed ✕` →
  `Status: 2 chosen ✕`. `Clear` appears when anything is set.
- Search is a bare input whose placeholder says what it matches.
- Tabs are words with counts (`Equipment 44`, `Tasks & notes 9/14`).

### 3.3 Status and flags
- Status is a dot and a word (`● Confirmed`), coloured by intent: ok green, warn
  amber, live/out red, info ink-2, neutral muted. Never a filled pill, never a badge.
- Flags print inline after the title as red or amber dot-words (`1 blocking`,
  `overbooked`, `18d overdue`). Tags are muted text after a middle dot.
- Lock state is the small lock glyph next to the status word with a tooltip.
- Derived, never stored: "needs you", "overdue", "due soon", readiness. A check that
  cannot run says `not checked`, never passes.

### 3.4 Actions
- **One primary per page**, top right on desktop, sticky bar on phone. Everything
  else is in the page ⋯ (desktop head, phone header).
- **No per-row buttons.** Row verbs live in the row ⋯ (hover-only on desktop, always
  visible and 40 px on phone) and in the bulk bar. This was applied to every
  surface after the warehouse's `Pack & prep` button was removed; do not bring one
  back "because this row is special". The exceptions that survive are accessory
  rows on the warehouse page (`Pack 5 with parent`) — they act *below* a line.
- Secondary row verbs that used to be small buttons (`Accept`, `Send`, `Issue`) are
  menu items.
- Destructive verbs are last in a menu, red, and confirm in a dialog that says what
  happens to the things downstream (reservations, documents, history).
- Every write toasts, and every reversible write's toast has **Undo** backed by a
  snapshot closure. A second surface that wants to undo the same write is handed the
  same closure, never a second implementation.

### 3.5 Selection and bulk
- Always-on checkboxes on every row, desktop and phone, with select-page in the
  header. Shift-click selects the visible range in DOM order.
- The bulk bar appears on the first tick, replaces the phone's sticky primary, and
  offers contextual verbs with counts in the verb (`Force return 3`, `Sub-hire 2
  short`). Destructive last, red. `✕` clears.
- A bulk write runs each row's own gates and skips what it can't do; the toast says
  what was skipped ("deployed ones stay on their job").
- Scanning stays the single-unit path on warehouse surfaces; ticks are for the rest.

### 3.6 Editing
- Inline first (qty, price, dates, times, container), one edit sheet for the rest,
  dialogs only for creating and confirming. Search-first add (type, Enter adds with
  defaults, second Enter opens the editor).
- Blank means blank. A money field left empty is not `$0`; `$0` is a price.
- Previews that could block are **non-blocking gates**: run the check before the
  write, show a heads-up dialog only when it finds something, fail open on error.

### 3.7 Numbers and text
- Money right-aligned, mono, no cents in lists (`$23,880`), cents only on finance
  documents and inline editors. Margin and cost hidden by default, opt-in.
- Dates as `12 – 14 Oct`, `31 Oct – 3 Nov`, `Starts 16 Nov`, `3d overdue`. Times in
  mono. Identifiers (`#2341`, `AURA-01`, serials) in mono.
- Copy is domain words in sentence case. Empty states name the next action.
  "Nothing matches" and "none yet" are different sentences.
- Numbers go in the count slots (strip, section heading, footer), not in prose.

### 3.8 Layout numbers
- Desktop content column 1170 px at 1440; sidebar 220. Tables ≤ 8 visible columns;
  more are opt-in from ⋯ › Columns. Narrow desktops (860–1300 px) get a fixed table
  layout with the flexible column ellipsised, never wrapping facts per word.
- Rows 44 px (child) / 52 px (desktop) / 60–64 px (phone). Checkbox 16 px desktop,
  22 px phone. Inputs 16 px font on phone.
- Type: Archivo display, Hanken Grotesk text, Geist Mono numbers. Tokens are the
  Espresso dark set in the kit's `style.html`; do not invent colours.

### 3.9 The calm pass
Every surface got a second pass titled "calm" after the user said it looked busy.
Apply it in the first pass now, as a checklist before you drive:

- [ ] no card borders or filled bands remain
- [ ] no pills; every status is dot + word
- [ ] no icon-only toolbar buttons; words with an underline
- [ ] no per-row buttons; ⋯ hover-only on desktop
- [ ] one primary, red; nothing else is red except live state and flags
- [ ] tags and secondary facts are muted; nothing competes with the title
- [ ] footers and section heads are one muted line
- [ ] the same fact is never shown twice on one screen

---

## 4. Surface patterns

Pick the one that matches the surface in §9 and follow it. The list pattern is fully
specified in the main spec §9b; the others are specified here for the first time.

### 4.1 List page (main spec §9b)
Head `Name · count` + one primary + ⋯ · quick strip with counts, last segment the
exception set · bare search + filter words + `Views ▾` · whole-row open, always-on
checkboxes, ≤ 8 columns, dot-word status · footer pager · contextual bulk bar ·
phone cards + sticky primary · **URL is the state**. Prototypes: Jobs, Assets.
Every other list (§9.5 below) is this shell with its own strip words.

### 4.2 Record page (asset, model, client, crew member, supplier, location, kit, maintenance job, T&T record)
The job page is the reference (Overview prototype). A record page is:

- **`DetailHeader`** (main spec §5.9): title · status dot-word · lock glyph; an
  identity line in muted text (`AURA-01 · Martin MAC Aura XB · Lighting · Warehouse
  A / B2`); one primary (`Edit` for most records, `Scan` for an asset on phone) and
  a ⋯ with the rest (duplicate, print label, retire, delete). Breadcrumb is a real
  trail. On phone the header is the phone header (name + identity line) and the
  primary is the sticky bar.
- **Controlled tabs** with `?tab=` deep links (the job page's `VALID_TABS` rule);
  the first tab is **Overview**: the record's at-a-glance state as calm Panel cards
  — a readiness/health checklist where the record has one (asset: T&T, service,
  condition, on job), the key facts, the current relationships (on job / in kit /
  assigned to). Overview shows no table.
- **The other tabs are lists** in the §4.1 pattern minus the head: a toolbar line,
  rows, footer. History and activity are the Tasks & notes "Discussion" rendering —
  dated rows, no cards.
- **A context rail on every tab except Overview** (job page rule #1063): the same
  facts Overview composes into cards, so nothing shows twice.
- Photos / documents are a grid with the same checkbox + bulk rules as files on
  Tasks & notes.
- The form behind `Edit` is the §4.5 sheet, not a separate page, unless it is a
  wizard.

### 4.3 Tabbed hub (the job page — done; the warehouse job page — locked)
Reference only. Rules that transfer: Overview is home and must be calm; the
lifecycle stepper and lock strip sit above the tabs because they change every tab;
readiness checks navigate to the tab that fixes them; a tab strip under the phone
header with counts; one sticky primary per tab.

### 4.4 Working surface (warehouse floor, returns station, scan/check page, T&T quick test, crew planner)
Someone stands at this page with a scanner or a phone and acts, repeatedly. The
warehouse job page (locked) is the reference:

- **A scan dock at the top** (main spec §5.7): one input, keyboard wedge + camera,
  the active target inside it, a mode toggle, a result strip of the last scans with
  Undo. One pipeline for every scan; the dock is the only loud control besides the
  primary.
- **A stage strip** of words with counts replacing tabs and steppers (`To pick 18 ·
  Prepped 24 · Out 0`); the active stage underlined, a thin progress bar under it.
- **One table or one board**, never both; cards only where the thing being handled
  is a container or a job, rows for lines.
- **The sticky primary reflects the selection** (`Prep ▾` → `Prep 2 + accessories`;
  `Receive all` → `Receive 1`) with `tick lines, or scan` under it when nothing is
  ticked.
- `Only what needs me` in the page ⋯ filters to the current user's work.
- Offline/syncing is a neutral strip entry, not a banner.

### 4.5 Form and wizard (every `/new` and `/edit` route)
- **Edit is a sheet** opened from the record's primary; it is the `RowEditorSheet`
  shape (main spec §5.8): fields in the order the record shows them, inline
  validation, one Save that calls the same mutation inline edits call. The
  `/[id]/edit` routes become redirects to `?edit=1` on the record.
- **Create is a sheet too** for records with ≤ 8 fields (location, category, kit,
  client, supplier, crew member, maintenance job): opened from the list's primary,
  search-first where a parent exists (model before asset). The `/new` routes stay
  as deep links that open the sheet over the list.
- **A wizard only for the job** (`/projects/new`): three steps — Who and when ·
  What (the search-first add, same component as the Equipment tab) · Review — with
  the steps as words with the active one underlined, Back/Next as the sticky pair
  on phone, and a `Create as enquiry` escape on step one. The wizard writes a
  draft from step one so nothing is lost.
- Fields: Zod schema is the source (derive variants with `.omit()`/`.pick()`);
  `blankableNumber` for optional money; dates as a range picker that shows the
  availability consequence; pickers are the Radix combobox pickers (`combobox-picker.tsx`).
- Phone: a sheet is full-height, inputs 16 px, the Save button sticky.

### 4.6 Home (dashboard)
- Calm like Overview: no card chrome, four stat words with numbers that **deep-link
  to the list segment they count** (`/projects?seg=out`), then two columns — what
  needs me (the union of the lists' exception segments, each row a link into its
  record) and what is on now (on the floor, out today, due back). Recent activity is
  the Discussion rendering. Setup / activation checklists stay as a single
  dismissable Panel at the top until complete.
- The customise bar and grid layout stay in the ⋯ (`Customise…`); the default
  layout is the one above. Widgets keep their data hooks.
- Phone: one column in the same order, the stat words as a 2×2 grid.

### 4.7 Settings
- One index page of sections as a list (name, one-line description, status word
  like `Connected`, `Not set up`, `3 members`), each section a record page in the
  §4.2 shape without tabs. Danger zone last. Forms are inline with Save per section,
  not one giant form. Phone: the index is the More sheet's Settings entry.

---

## 5. Phone rules (every surface)

Breakpoint `max-width: 859px`. The phone is its own surface, not a collapsed
desktop. Checklist:

- [ ] phone header: page name + a one-line count/identity line + ⋯ (page menu as a
      bottom sheet that closes on tap)
- [ ] tab strip or stage strip under the header, scrolling, active one underlined,
      counts kept
- [ ] quick strip and filter words scroll sideways; the search is full width above
- [ ] rows are cards: title, one muted sub line, status at the right, 22 px checkbox,
      thumbnail where the record has one; 60–64 px tall; whole card opens
- [ ] one sticky primary above the bottom nav (44 px); the bulk bar replaces it
      while anything is selected; nothing floats over content
- [ ] menus and dialogs are bottom sheets with 48 px items
- [ ] row ⋯ always visible, 40 px; no hover-only affordance anywhere
- [ ] inputs 16 px; safe areas via inline `env()`
- [ ] paging is `Show 25 more · n left`
- [ ] desktop-only things (board, grid, columns menu, drag hints, export) are hidden,
      not squeezed; the phone shows what it can do
- [ ] scan opens from a user gesture; one live camera at a time

The bottom nav is `Home · Jobs · Scan · Warehouse · Assets` in the kit; the main
spec's D1 proposes `More` in the last slot. Keep the kit's nav until D1 gets a yes.

---

## 6. Driving and publishing

### 6.1 Drive script
Copy `prototype-kit/drive/jobs-check.cjs`, rename, and adapt the selectors. It must:

- open the prototype at **1440×900** and **390×844**, `deviceScaleFactor: 1`, no
  `isMobile` (older prototypes lack a viewport meta; the kit's shell has one, but
  keep the drives uniform);
- collect `pageerror` and console errors into `errs` and print `errors: []` last;
- click every segment, open every filter menu and toggle a value, search, sort each
  sortable header, page, tick one row then shift-click a range, run one bulk action
  and Undo it, open a row ⋯, open the page ⋯, apply a saved view, hit the empty
  state, and on phone tap a card, `Show more`, and the sticky primary;
- take a screenshot after each state into `shots/`.

Re-render replaces the DOM: take fresh locators after every click (`>> nth=`), never
hold element handles. A click that times out on "element is not visible" usually
means two elements share a `data-act` (desktop head and phone header both have
`pagemenu`) — scope the selector (`.lphead [data-act=pagemenu]`).

### 6.2 What "passes"
`errors: []` on both viewports, every assertion printed with the value you expect,
and you have **looked at** the screenshots (Read the PNGs). Common things the
screenshots catch that the drive does not: a `colspan` wider than the column count
shrinking a fixed-layout table; a strip that wraps instead of scrolling; a filter
word row overflowing on phone; the same fact twice.

### 6.3 Publish
- `Artifact` publish with the assembled HTML; icon `table` for lists, `clipboard`
  for working surfaces, `file` for records. Same file path keeps the URL on every
  republish — never rename the file of a published prototype.
- Publishing an artifact this session did not publish (a locked one from an
  earlier session) requires `url`; a publish without it creates a stray artifact.
- Link sibling artifacts from the prototype (row ⋯ `Open` → the Overview artifact,
  `Warehouse page` → the warehouse artifact, phone tab strip → the job tabs) so the
  user can walk between surfaces. URLs are in the main spec's link list.
- Sessions hold at most ten artifact watches; past that, comments on a prototype do
  not wake the session. Tell the user once.

### 6.4 Screenshots to the user
`prototype-kit/drive/shots.cjs` produces `final-<name>-desk.png`,
`final-<name>-desk-sel.png` and `final-<name>-phone.png` at 2×. Send all of them in
one `SendUserFile` with a one-line caption. Send them before writing the spec
section; the user reacts to pictures, not prose.

---

## 7. The prototype kit (`docs/designs/prototype-kit/`)

Vanilla HTML/JS, one file per published prototype, no build. The Jobs and Assets
prototypes were assembled from exactly these files (byte-identical).

| File | What it is |
|---|---|
| `shell.html` | Document skeleton: fonts, `__STYLE__`, the list-page CSS layer (head, strip, toolbar, table, footer, grid, board, phone), sidebar, top bar, phone header, `__BODY__`, bottom nav, `#layer` (menus, sheets, dialogs), `#bulk`, `#toast`, `__JS__` |
| `style.html` | The `<style>` block every job prototype shares: Espresso tokens, type, buttons, inputs, table, rows, menus, sheets, dialogs, toast, the calm layer, the phone layer |
| `core.js` | `$`, `esc`, `isPhone`, `money`, `ICON`, date helpers, `openMenu`, `openDialog`, `toast(msg, undo)`, `field`, `opt`, `renderNav`, `filterWord`, `sortHead`, `pager`, the `[data-act]` click delegation, `/` and `n` shortcuts, resize → `render()` |
| `assemble.mjs` | `node assemble.mjs <dir>/<name> "<title>" "<crumb>" [jobs\|assets\|none]` → `<name>-prototype.html` |
| `examples/jobs-*`, `examples/assets-*` | The two list prototypes' page files — copy the closest one |
| `drive/*.cjs` | Playwright drives and the 2× screenshot script |

### 7.1 A page file
`<name>-page.js` has four parts, in this order, and nothing else:

1. **Data.** A `TODAY` constant, sibling artifact URLs, vocab tables (`STATUS`,
   `GROUPS`), a seeded `rnd` (never `Math.random` — the drive must see the same
   data every run), generated rows plus two or three hand-set rows that make the
   screenshots tell the story (one blocking, one overdue, one needing repair).
   Realistic volume: 38 jobs, 63 assets, 44 lines — enough to page, not enough to
   hide the hand-set rows.
2. **Derived.** Pure functions over `state`: `inGroup`, `matches`, `sorted`,
   `rows()`, `needsYou`/`attention`, `snapshot()` (deep-copies the rows, returns the
   restore closure Undo calls).
3. **Render.** `render()` calls `renderHead`, `renderStrip`, `renderToolbar`,
   `renderTable`, `renderList` (phone cards, always rendered — CSS decides),
   `renderFoot`, `renderBulk`. Full re-render on every change; string templates; the
   table and the list read the same `rows()`.
4. **Actions.** One `act(name, el, ev)` switch. Every `data-act` in the markup has a
   case. Writes: `const undo = snapshot(); …mutate…; closeLayer(); render();
   toast('what happened', undo)`. Menus are `openMenu(el, title, items)` where an
   item is `{label, act, args, on?, danger?, small?, href?}` or `'-'` or `{sh}`.
   Dialogs are `openDialog(html, focusFn)` with `data-act="close"` and a
   `…go` action. Filters re-open their own menu after a toggle so multi-select
   feels continuous.

`<name>-body.html` is the page's static markup inside `section.page.lp`: head,
`#strip`, the toolbar (`#q`, `#fwords`, `.fstrip`, `#views`), `#tblwrap`, `#list`,
`#foot`, `#phoneact`. Reuse the ids; `core.js` and the CSS depend on them.

### 7.2 Adding CSS
Append to the `<style>` block in `shell.html` under a comment naming the surface,
or inline in the body for one-offs. Use the tokens (`var(--ink)`, `--muted`,
`--faint`, `--line`, `--paper`, `--paper-2`, `--select`, `--action-red`, `--ok`,
`--warn`, `--t-out`, `--blue`). Phone overrides go inside the existing
`@media (max-width:859px)` block. Never add a second breakpoint.

### 7.3 Working directory
Build in the session scratchpad (`…/scratchpad/proto/`), not in the repo. When the
surface is accepted, copy its `-page.js` and `-body.html` into
`prototype-kit/examples/` with the commit — the published HTML itself is not
committed (the artifact is the record).

---

## 8. The spec section

Append to the main spec in route order (list pages are §9b; use `9c`, `9d` … for
the remaining operations surfaces, `6c` for shell/home, `7b`… for job-page tabs).
Template:

```markdown
## 9c. Warehouse › Floor and Returns — v1 proposal (prototype 2026-11-xx, awaiting a yes)

**Prototype:** https://claude.ai/artifact/… — desktop 1440 and phone 390, every
control wired (…one line listing what is clickable…).

### 9c.1 Why
Three or four sentences. What the live page is (file paths), what the inventory
found wrong (two concrete things with `file:line`), what the user said.

### 9c.2 The page
What stays, what moves, what goes — prose, not the working table, with each
removed thing's job named. Head, strip words, toolbar, rows/cards, footer, primary.

### 9c.3 <The surface's own thing>
One subsection per feature that needed design (the scan dock, the returns board,
the readiness list…). Rules in bullets, each one a sentence a developer can test.

### 9c.4 Phone
The §5 checklist as it applies here, in bullets.

### 9c.5 Code
Which primitives (§5 of the main spec) it composes, which components are reused,
which go.
```

Then:
- add the prototype to the **Clickable prototypes** list at the top of the main spec
  (`- Warehouse floor: https://… — v1 (§9c).`);
- append any decision that changes DESIGN.md or a FEATUREDOC to the **§12 table**
  (`D14 | … | Recommended | Alternative`), numbered after the last;
- commit as `docs(ux): <surface> — <one line>` with the Co-Authored-By and
  Claude-Session trailers the session requires, and push to the program branch.

CI on PR #1358: the Hygiene job is red on `pnpm audit` (`systeminformation` via
`shadcn`, pre-existing on `main`, commented once). Do not comment again; do not try
to fix it in this PR. Every other check must stay green — a docs commit cannot break
them unless a committed example fails lint (the kit is in the ESLint ignore list).

---

## 9. Briefs for the remaining surfaces

Order is by how often someone is on the page. Each brief: routes, live files to
inventory, what to keep, what to change, primary, strip words, phone, decisions to
raise, siblings to link. "Pattern" names the §4 shape.

### 9.1 Warehouse floor + returns station + pull sheet — pattern 4.4
- **Routes:** `/warehouse`, `/warehouse/returns`, `/warehouse/[projectId]/pull-sheet`.
- **Live:** `src/app/(app)/warehouse/page.tsx` (954 lines, the floor),
  `src/app/(app)/warehouse/returns/page.tsx` (656), `src/components/warehouse/*`
  (the job-page components; `scan-card`, `scan-history-strip`, `scan-intake-status`,
  `return-tab`, `close-out-tab`, `warehouse-stages.ts`). Main spec §9.1, §9.3, and
  the §9 mockup artboard "the floor board".
- **Keep:** the job cards as the unit; the stage vocabulary from `warehouse-stages.ts`;
  the scan button; the returns flow's per-item outcomes (returned / damaged /
  missing / late) and its Undo.
- **Change:** the floor becomes a board of job cards in stage columns (`To pick ·
  Prepping · Ready · Out · Returning`) with the §9b card facts (number, client,
  dates, `18 lines · 4 to pick`, who is packing, truck/time), a scan dock at the top
  whose scope is "any job" (a scan tells you which job and offers to open it or
  receive it), and a quick strip of `Today · This week · Mine · All`. Returns is the
  same page in a `Returning` mode: the dock receives, the strip shows outcomes, the
  board shows what is still out per job; the separate route stays as a deep link.
  The pull sheet is a document (print/PDF), not a page: it becomes `Documents ▾ ›
  Pull sheet` on the warehouse job page and a print view.
- **Primary:** `Scan` (focuses the dock) on desktop; the dock itself on phone.
- **Phone:** the board is a list of job cards grouped by stage with the stage strip
  under the header; receive mode is one tap from the page ⋯ and from the Scan nav
  item (context-aware scan, main spec §6.3).
- **Decisions:** D6 (manual mark deployed/returned leave the cards) is already in
  §12; raise whether the returns route survives as more than a deep link.
- **Siblings:** warehouse job `Mt8p55xkPkkexVWPC5eaGU`, Overview
  `RatKsWfTmDJLJHmn6mb7Zo`, Jobs list `A7SMPtpTr3aedUDEnuSaxd`.

### 9.2 Asset detail — pattern 4.2
- **Route:** `/assets/registry/[id]` (+ `/edit` → sheet).
- **Live:** `src/app/(app)/assets/registry/[id]/page.tsx` (993 lines; tabs
  `availability · checks · files · history · maintenance · notes`),
  `src/components/assets/{asset-accessories-manager,asset-checks-tab,asset-qr-code,asset-form}.tsx`.
- **Keep:** every tab's data; the QR/label; accessories manager; check history.
- **Change:** add an **Overview** tab as the landing tab (health checklist: T&T,
  service, condition, missing/on job; identity facts; current job / kit / case;
  accessories as rows), `DetailHeader` with `AURA-01 · Martin MAC Aura XB` and the
  status dot-word, `Edit` primary, ⋯ (Move to, Schedule service, Print label,
  Duplicate, Force return, Retire). Availability becomes a calm calendar strip +
  the list of bookings; Checks/Maintenance/History/Notes/Files are list tabs in the
  §4.1 toolbar-less shape. Context rail: location, value, owner, last scan.
- **Primary:** `Edit` desktop; `Scan` sticky on phone (opens the camera, a read of
  this tag confirms, a different tag navigates).
- **Phone:** tab strip with counts; cards; the sticky primary.
- **Decisions:** Overview as the landing tab (mirrors the job page's #1061);
  `/edit` becomes a sheet.
- **Siblings:** Assets list `89PDTuMiovgP9i3h4MJ1Tw`, warehouse job.

### 9.3 Model detail — pattern 4.2
- **Route:** `/assets/models/[id]` (+ `/edit`, `/new`).
- **Live:** `src/app/(app)/assets/models/[id]/page.tsx` (916 lines; tabs
  `assets · checks · details · documents · photos · roi`),
  `src/components/assets/{model-form,model-accessories-manager,model-checks-tab,model-failure-analytics,model-roi-tab,specifications-editor}.tsx`.
- **Keep:** ROI tab (it has a smoke test for the Tooltip provider crash — keep the
  pattern), failure analytics, specifications editor, accessories, photos.
- **Change:** Overview landing tab (stock line `12 owned · 3 out · 1 in service`,
  rates, replacement value, ROI headline, the accessory plan as rows, the photo as
  the hero), `DetailHeader` with category and rates on the identity line; Assets tab
  is the Assets list filtered to this model (§4.1 without the head — reuse the
  list, do not rebuild it); Details becomes the edit sheet.
- **Primary:** `+ New asset` (model preselected). ⋯: Edit, Duplicate model, Print
  labels for all, Archive.
- **Phone:** as 9.2.
- **Decisions:** none expected beyond the Overview landing tab.

### 9.4 New job wizard + job edit — pattern 4.5
- **Routes:** `/projects/new`, `/projects/[id]/edit`, `/projects/templates`.
- **Live:** `src/components/projects/project-wizard.tsx`,
  `src/app/(app)/projects/[id]/edit/page.tsx` (71 lines — a thin page around the
  form), templates list.
- **Keep:** every field the wizard collects; templates as a starting point; the
  client quick-create.
- **Change:** three steps as words (`Who and when · What · Review`), a draft written
  at step one, the `What` step is the Equipment tab's search-first add
  (`BdwR4bNbiNMLSvfRAByEwC`) embedded, availability shown as you add, `Create as
  enquiry` escape; job edit becomes the Overview's `Edit` sheet (dates with the
  date-move impact gate, client, type, PM, tags, numbering).
- **Primary:** `Next` / `Create job`; sticky pair on phone.
- **Decisions:** `/edit` becomes a sheet (same as 9.2); templates become `Start from
  template ▾` on step one rather than a separate list.
- **Siblings:** Overview, Equipment, Jobs list.

### 9.5 The remaining lists — pattern 4.1 (one prototype can cover several)
Build one prototype per row below only where the strip or the columns differ
materially from Jobs/Assets; otherwise write the row's spec line and move on.

| List | Route · live table | Strip words | Columns (≤ 8) | Bulk |
|---|---|---|---|---|
| Crew | `/crew` · `crew/crew-table.tsx` | All · Available this week · On a job · Unconfirmed · Inactive | Name (role, skills) · Status · Next call · This week (hours) · Rate · Phone | Message, Assign to job…, Add tag, Deactivate |
| Clients | `/clients` · `clients/client-table.tsx` (+ `clients-dashboard.tsx`) | All · Active jobs · Quoting · Overdue invoices · Archived | Client (contact) · Open jobs · Quoted · Outstanding · Last job · Xero | Add tag, Merge…, Export, Archive |
| Suppliers | `/suppliers` · `suppliers/supplier-table.tsx` | All · Open orders · Overdue returns · Archived | Supplier (contact) · Open orders · On hire now · Due back · Spend YTD | Export, Archive |
| Locations | `/locations` · `locations/location-table.tsx` | All · Warehouses · Vehicles · Sites · Empty | Location (type, parent) · Assets · Capacity · Last movement | Move contents…, Print bin labels, Archive |
| Kits | `/kits` · kits page | All · Complete · Missing items · On a job | Kit (model count) · Items · Complete · On job · Value | Duplicate, Print list, Archive |
| Models | `/assets/models` · `assets/model-table.tsx` | All · With stock · No stock · Due for T&T · Archived | Model (category) · Owned · Available · Day rate · Value · ROI | Edit rates…, Add accessory…, Archive |
| Maintenance | `/maintenance`, `/maintenance/due` · maintenance pages | Open · Overdue · Scheduled · Done | Asset (model) · Issue · Status · Due · Assigned · Cost | Assign…, Reschedule…, Mark done |
| Test & tag | `/test-and-tag`, `/registry`, `/reports` | Due · Overdue · Passed · Failed · All | Asset (model) · Last test · Result · Next due · Tester | Schedule…, Print tags, Export report |
| Sales stock | `/assets/sales-stock` · `assets/sales-stock-table.tsx` | All · Low stock · Out of stock | Item · On hand · Reserved · Reorder at · Price | Adjust stock…, Reorder…, Export |
| Overbookings | `/overbookings` | This week · Next 30 days · All | Model · Short by · Jobs · Dates · Sub-hire | Sub-hire…, Open job |
| Schedule (availability) | `/availability` | — (a timeline, pattern 4.4) | — | — |
| Activity, My tasks, Notifications | `/activity`, `/my-tasks`, `/notifications` | Mine · Today · All | the Discussion rendering (dated rows) | Mark read, Done |

`/maintenance/due` and `/test-and-tag/registry` are segments of their list, not
pages. Each list's ⋯ carries its import/export and its related pages
(Models ↔ Categories, Locations ↔ Print bin labels).

### 9.6 Home (dashboard) — pattern 4.6
- **Route:** `/dashboard`. **Live:** `src/app/(app)/dashboard/page.tsx`,
  `src/components/dashboard/{dashboard-grid,dashboard-customize-bar}.tsx`,
  `widgets/{stat-tile-widgets,needs-attention-widget,on-the-floor-now-widget,upcoming-projects-widget,my-tasks-widget,recent-activity-widget,activation-checklist-widget,finish-setup-checklist-widget}.tsx`.
- **Change:** the stat tiles become four words with numbers that deep-link to list
  segments (today they link to bare `/projects` and `/assets/registry`); "needs
  attention" is the union of the lists' exception segments; the grid/customise
  stays behind ⋯. Phone: one column.
- **Decisions:** the default layout replaces the customisable grid as the default
  (customise stays available).

### 9.7 Packing tab and Versions on the job page — pattern 4.3 (tab-level)
- **Live:** `src/components/projects/packing-tab.tsx`,
  `versions-panel.tsx`, `version-strip.tsx`, `version-switcher.tsx`. Main spec
  D3 (withdrawn: the tab stays), §7 (Equipment prototype dropped its Packing view).
- **Change:** Packing is container cards with drag-and-drop case planning and the
  warehouse job page's `Planned →` glyphs, nothing priced; Versions is a dated list
  in the Discussion rendering with `Make live` / `Compare` in the row ⋯ and the
  version chip in the header. Both get the phone tab strip entry.
- **Siblings:** Equipment, Overview, warehouse job.

### 9.8 Forms — pattern 4.5
Asset (`asset-form.tsx`, `bulk-asset-form.tsx`, `csv-import-dialog.tsx`), model,
client (+ `client-contacts-manager`), crew member, supplier (+ orders), location,
kit, maintenance (+ `service-schedule-dialog`). One prototype: the asset create
sheet (search-first by model, then tag/serial/location, with "add another" that
keeps the model) and the asset edit sheet, as the template for the rest; the spec
lists each form's field order.

### 9.9 Crew planner + timesheets — pattern 4.4
- **Live:** `src/app/(app)/crew/planner/page.tsx` (1090 lines), `/crew/timesheets`,
  `/crew/settings`. Logistics' crew lanes (`E36tnBkGL9obdikUQ5mbXf`) are the
  reference rendering for calls.
- **Change:** a week grid of people × days with calls as blocks, the same offer /
  confirm vocabulary and bulk verbs as Logistics (`Offer 3`, `Confirm 2`), a
  `Needs crew` strip segment; timesheets as a list with approve bulk.
- **Phone:** day mode (one day, people as cards) — Logistics' phone day mode.

### 9.10 Scan and check surfaces — pattern 4.4
- **Live:** `src/app/(app)/check/[assetTag]/page.tsx` (235 lines;
  `item-check-form`, `scan-history-strip`), `/test-and-tag/quick-test`.
- **Change:** both become the scan dock + a result card (asset identity, the check
  form as inline fields, the last scans strip). Phone-first; desktop is the same
  centred column.

### 9.11 Org finance hub — pattern 4.1 + 4.6
- **Live:** `src/app/(app)/finance/page.tsx` (335 lines). Job Finance
  (`7ByfxnbtsgQTJdiwvvo1CY`) is the reference for money tiles and rows.
- **Change:** four money words (quoted, awaiting payment, invoiced this month,
  overdue), then two lists in the §4.1 shape with strips: Quotes (`Draft · Sent ·
  Accepted · Expired`) and Invoices (`Draft · Issued · Paid · Overdue`), bulk
  `Send reminder`, `Export`, `Sync to Xero`.

### 9.12 Settings — pattern 4.7
Eighteen pages under `/settings/*` (`src/components/settings/*`). One prototype:
the index list and one section (Team, the richest: members, invites, join policy,
permission matrix). The rest adopt the shape by spec.

### 9.13 Shell — main spec §6
Not a prototype of its own; every prototype carries it. Raise D1 (bottom nav with
Scan + More) when the next phone-heavy surface (9.1) is accepted, and switch the
kit's bottom nav then.

---

## 10. Rejected directions — do not re-propose

| Rejected | Where | Why |
|---|---|---|
| Case board, pick walk, scanner-first warehouse | warehouse job, 2026-10-27 | New mental models; "the live page, cleaned up" won |
| A big per-row `Pack & prep` / `Prep 8` / `Deploy 6` button | warehouse phone, then desktop | Duplicated scan and ⋯, acted on one line; checkboxes + the stage primary replaced it everywhere |
| Per-row secondary buttons (`Accept`, `Send`, `Issue`, `Advance`) | Finance, Equipment, Overview | Row verbs live in ⋯ and the bulk bar |
| Segmented controls, icon-only toolbars, filled pills, badge counts | every calm pass | Words with an underline, dot + word |
| Card chrome around lists and sections | every calm pass | Hairlines and spacing |
| Context sidebar on the Overview tab | Overview | The same facts twice on one screen |
| Horizontal-scroll fact strips on phone | Logistics | Two-column grid |
| Per-word wrapping of Where/When cells on narrow desktop | Logistics | Six fixed columns, ellipsis |
| A view switch for Packing inside Equipment | Equipment | D3 withdrawn; the tab stays |
| `localStorage` as the filter store | lists | URL state (D11) |
| Floating action buttons on phone | shell | Sticky bar above the nav; nothing floats |
| A separate decoder or platform `BarcodeDetector` | scanner | One WASM engine (CLAUDE.md) |

---

## 11. Bookkeeping

- **Branch:** `claude/ux-unification-design-2026-10` (PR #1358, merged) carried
  §6b–§9b; the twelve remaining surfaces (§6c, §7b, §7c, §9c–§9k) landed on
  `claude/festive-gauss-gg3r1c`. Push after every surface; never rebase.
- **Links:** the main spec's top list is the index of prototypes; the mockup canvas
  `HHjfzi1NUL5PEQDQMxM6KU` holds the static artboards.
- **Artifacts so far:** Overview `RatKsWfTmDJLJHmn6mb7Zo`, Equipment
  `BdwR4bNbiNMLSvfRAByEwC`, Logistics `E36tnBkGL9obdikUQ5mbXf`, Finance
  `7ByfxnbtsgQTJdiwvvo1CY`, Tasks & notes `BrLBitu3c2V4uixLQbXCNE`, Warehouse job
  `Mt8p55xkPkkexVWPC5eaGU` (locked — republish only with `url`), Jobs
  `A7SMPtpTr3aedUDEnuSaxd`, Assets `89PDTuMiovgP9i3h4MJ1Tw`; v1 of the rest (2026-11-04):
  Home `3d6zqfosL5hYRvXLBYLnhR`, Packing + Versions `HSAZTyzfjG2A7sCjUe9wsM`, New job
  wizard `GgtKxc5WZP33gXihgFTB9B`, Floor `6xqFcEZZk49w86p5pAsisA`, Asset detail
  `Rr5rwirCUMRy8gf5G6Vz7s`, Model detail `47miWruJVsednbzrFPij2b`, People lists
  `LPdsNGb4CRMfS6qk7j7Fsa`, Gear lists `D7N5PmXKrkcY2gzZXWeuvc`, Crew planner
  `AKkgWzJ2gVR3dJTWnMB2Ui`, Scan `8Q2HVoRhLbSLz1Q9mCtayX`, Finance hub
  `5VnYTVW2pdA5r1qBRvdrom`, Settings `Q3TeWuQPjzvXbAtmUV8Hg8`, Forms `REMbu5TYg5Nx6iJJoPLuGy`.
- **Decisions:** D1–D64 in the main spec §12; the next is D65.
- **Fixture canon** (keep new prototypes consistent with these): `TODAY` 2026-11-09,
  and 11 Nov is a Tuesday in the fiction (so 9 Nov is a Sunday; print `9 Nov` with no
  weekday). AURA-01 is Reserved on #2341 in LX-02, T&T 12-monthly, last passed 19 Nov
  2025, due 19 Nov (10 days); the overdue T&T units are AURA-02 and AURA-10; the fan
  fault awaiting parts is AURA-06. #2338 is Corporate AGM (Fri 21 Nov) in every
  prototype except the Jobs list, where it predates the canon.
- **Running surfaces in parallel:** the twelve v1 prototypes were built by one Sonnet
  agent each from a shared brief, then reviewed together for drift (fixture
  contradictions, crumb separators, fonts in the dock). Brief every agent with the
  fixture canon above and the sibling-link placeholders, and plan for the usage
  limit: twelve agents at once ran through it once.
- **The user's standing preferences:** brief explanations, no fluff, solution first;
  Overview is home and must be calm; checkboxes and bulk actions instead of per-row
  buttons, everywhere; show screenshots, then ask for the yes.
